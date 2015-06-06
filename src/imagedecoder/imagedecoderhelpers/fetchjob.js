'use strict';

module.exports = FetchJob;

FetchJob.FETCH_TYPE_REQUEST = 1;
FetchJob.FETCH_TYPE_CHANNEL = 2;
FetchJob.FETCH_TYPE_ONLY_WAIT_FOR_DATA = 3;

function FetchJob(fetchClient, scheduler, fetchType, contextVars) {
    this._fetchClient = fetchClient;
    this._scheduler = scheduler;
    
    this._dataListeners = [];
    this._terminatedListeners = [];
    
    this._imagePartParams = null;
    this._progressiveStagesDone = 0;
    
    this._isYielded = false;
    this._isFailure = false;
    this._isTerminated = false;
    this._isManuallyAborted = false;
    this._isChannel = fetchType === FetchJob.FETCH_TYPE_CHANNEL;
    this._contextVars = contextVars;
    this._isOnlyWaitForData = fetchType === FetchJob.FETCH_TYPE_ONLY_WAIT_FOR_DATA;
    this._useScheduler = fetchType === FetchJob.FETCH_TYPE_REQUEST;
    this._fetchContext = null;
    this._fetcher = null;
    this._resource = null;
    
    if (fetchType === FetchJob.FETCH_TYPE_CHANNEL) {
        this._fetcher = this._fetchClient.createChannelFetcher();
    } else {
        this._fetcher = null;
    }
}

FetchJob.prototype.fetch = function fetch(imagePartParams) {
    if (this._isChannel) {
        this._imagePartParams = imagePartParams;
        this._startFetch();
        return;
    }
    
    if (this._imagePartParams !== null) {
        throw 'Cannot fetch twice on fetch type of "request"';
    }
    
    this._imagePartParams = imagePartParams;
    
    if (!this._useScheduler) {
        startRequest(/*resource=*/null, this);
        return;
    }
    
    this._scheduler.enqueueJob(startRequest, this, fetchAbortedByScheduler);
};

FetchJob.prototype.manualAbortRequest = function manualAbortRequest() {
    this._isManuallyAborted = true;
    this._isTerminated = true;
    
    if (this._fetcher !== null) {
        this._fetcher.abortAsync();
    }
};

FetchJob.prototype.getContextVars = function getContextVars(requestId) {
    return this._contextVars;
};

FetchJob.prototype.on = function on(event, listener) {
    switch (event) {
        case 'data':
            this._dataListeners.push(listener);
            break;
        case 'terminated':
            this._terminatedListeners.push(listener);
            break;
        default:
            throw 'Unexpected event ' + event;
    }
};

FetchJob.prototype._startFetch = function startFetch() {
    var fetchContext = this._fetchClient.createFetchContext(
        this._imagePartParams, this);
    
    this._fetchContext = fetchContext;

    if (fetchContext.isDone()) {
        for (var i = 0; i < this._dataListeners; ++i) {
            this._dataListeners[i](this._contextVars, fetchContext);
        }

        this._fetchTerminated(/*isAborted=*/false);
        
        return;
    }
    
    if (fetchContext.hasData()) {
        for (var j = 0; j < this._dataListeners; ++j) {
            this._dataListeners[j](this._contextVars, fetchContext);
        }
    }
    
    fetchContext.on('data', dataCallback);
    
    if (!this._isOnlyWaitForData) {
        this._fetcher.fetch(fetchContext);
    }
};

FetchJob.prototype._fetchTerminated = function fetchTerminated(isAborted) {
    if (this._isYielded || this._isTerminated) {
        throw 'Unexpected request state on terminated';
    }
    
    if (this._resource !== null) {
        if (isAborted) {
            throw 'Unexpected request termination without resource allocated';
        }

        this._scheduler.jobDone(this._resource, this);

        this._resource = null;
    } else if (!isAborted && this._useScheduler) {
        throw 'Job expected to have resource on successful termination';
    }
    
    if (this._isChannel) {
        // Channel is not really terminated, but only fetches a new region
        // (see moveChannel()).
        
        return;
    }
    
    this._isTerminated = true;
    
    for (var i = 0; i < this._terminatedListeners.length; ++i) {
        this._terminatedListeners[i](
            this._contextVars, this._fetchContext, isAborted);
    }
    
    if (this._fetchContext !== null && !this._isFailure) {
        this._fetchContext.release();
    }
};

FetchJob.prototype._continueFetch = function continueFetch() {
    if (this.isChannel) {
        throw 'Unexpected call to continueFetch on channel';
    }
    
    var fetcher = this._fetchClient.createRequestFetcher();
    
    this._fetcher = fetcher;
    fetcher.on('stop', fetchStoppedByFetchClient);
    fetcher.fetch(this._fetchContext);
};

// Properties for FrustumRequesetPrioritizer

Object.defineProperty(FetchJob.prototype, 'imagePartParams', {
    get: function getImagePartParams() {
        return this._imagePartParams;
    }
});

Object.defineProperty(FetchJob.prototype, 'progressiveStagesDone', {
    get: function getProgressiveStagesDone() {
        return this._progressiveStagesDone;
    }
});

function startRequest(resource, self) {
    if (self._fetchContext !== null) {
        throw 'Unexpected restart of already started request';
    }
    
    if (self._isManuallyAborted) {
        if (resource !== null) {
            self._scheduler.jobDone(resource, self);
        }
        
        return;
    }
    
    self._resource = resource;
    
    if (!self._isOnlyWaitForData) {
        self._fetcher = self._fetchClient.createRequestFetcher();
        self._fetcher.on('stop', fetchStoppedByFetchClient);
    }
    
    self._startFetch();
}

function dataCallback(fetchContext, self) {
    try {
        if (self._isYielded || self._isTerminated) {
            throw 'Unexpected request state on fetch callback';
        }
            
        if (fetchContext !== self._fetchContext) {
            throw 'Unexpected fetchContext';
        }

        ++self._progressiveStagesDone;
        
        
        for (var i = 0; i < self._dataListeners; ++i) {
            self._dataListeners[i](self._contextVars, fetchContext);
        }
        
        if (self._useScheduler) {
            if (self._resource === null) {
                throw 'No resource allocated but fetch callback called';
            }
            
            if (fetchContext.isDone()) {
                self._fetchTerminated(/*isAborted=*/false);
                return;
            }
            
            var scheduler = self._scheduler;
            
            if (scheduler.shouldYieldOrAbort(self)) {
                self._fetcher.abortAsync();
            }
        }
    } catch (e) {
        self._isFailure = true;
        fetchAbortedByScheduler(self);
    }
}

function fetchStoppedByFetchClient(self, isAborted) {
    if (self._isYielded || self._resource === null) {
        throw 'Unexpected request state on stopped';
    }
    
    if (self._isOnlyWaitForData ||
        self._fetcher === null) {
        
        throw 'Unexpected request type on stopped';
    }
    
    if (!isAborted) {
        if (!self._isTerminated) {
            throw '"stopped" listener was called with isAborted=false but ' +
                'fetchContext "data" listener was not called yet';
        }
        
        return;
    }
    
    var scheduler = self._scheduler;
    
    var isYielded = scheduler.tryYield(
        continueYieldedRequest,
        self,
        fetchAbortedByScheduler,
        fetchYieldedByScheduler,
        self._resource);
    
    if (isYielded || self._isTerminated) {
        scheduler.jobDone(self._resource, self);
        
        return;
    }
    
    self._continueFetch();
}

function continueYieldedRequest(resource, self) {
    if (self._isManuallyAborted || self._isFailure) {
        self._scheduler.jobDone(self._resource, self);
        
        return;
    }
    
    if (!self.isYielded || self.isTerminated) {
        throw 'Unexpected request state on continue';
    }
    
    self.isYielded = false;
    self.resource = resource;
    
    self._continueFetch();
}

function fetchYieldedByScheduler(self) {
    if (self._isYielded || self._isTerminated) {
        throw 'Unexpected request state on yield';
    }
    
    self._isYielded = true;
    self._resource = null;
}

function fetchAbortedByScheduler(self) {
    self._isYielded = false;
    self._resource = null;
    self._fetchTerminated(/*isAborted=*/true);
}