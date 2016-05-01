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
    this._imageDataContext = null;
    this._fetcher = null;
    this._resource = null;
	this._fetchStoppedByFetchClientBound = this._fetchStoppedByFetchClient.bind(this);
	//this._alreadyTerminatedWhenAllDataArrived = false;
    
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
    var imageDataContext = this._fetchClient.createImageDataContext(
        this._imagePartParams, this);
    
    this._imageDataContext = imageDataContext;

    if (imageDataContext.isDone()) {
        for (var i = 0; i < this._dataListeners.length; ++i) {
            this._dataListeners[i](this._contextVars, imageDataContext);
        }

        this._fetchTerminated(/*isAborted=*/false);
		//this._alreadyTerminatedWhenAllDataArrived = true;
        
        return;
    }
    
    if (imageDataContext.hasData()) {
        for (var j = 0; j < this._dataListeners.length; ++j) {
            this._dataListeners[j](this._contextVars, imageDataContext);
        }
    }
    
	var self = this;
    imageDataContext.on('data', function() {
		self._dataCallback(imageDataContext);
	});
    
    if (!this._isOnlyWaitForData) {
        this._fetcher.fetch(imageDataContext);
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
            this._contextVars, this._imageDataContext, isAborted);
    }
    
    if (this._imageDataContext !== null && !this._isFailure) {
        this._imageDataContext.release();
    }
};

FetchJob.prototype._continueFetch = function continueFetch() {
    if (this.isChannel) {
        throw 'Unexpected call to continueFetch on channel';
    }
    
    var fetcher = this._fetchClient.createRequestFetcher();
    
    this._fetcher = fetcher;
    fetcher.on('stop', this._fetchStoppedByFetchClientBound);
    fetcher.fetch(this._imageDataContext);
};

FetchJob.prototype._dataCallback = function dataCallback(imageDataContext) {
    try {
        if (this._isYielded || this._isTerminated) {
            throw 'Unexpected request state on fetch callback';
        }
            
        if (imageDataContext !== this._imageDataContext) {
            throw 'Unexpected imageDataContext';
        }

        ++this._progressiveStagesDone;
        
        
        for (var i = 0; i < this._dataListeners.length; ++i) {
            this._dataListeners[i](this._contextVars, imageDataContext);
        }
        
		if (imageDataContext.isDone()) {
			this._fetchTerminated(/*isAborted=*/false);
			//this._alreadyTerminatedWhenAllDataArrived = true;
			return;
		}
		
        if (this._useScheduler) {
            if (this._resource === null) {
                throw 'No resource allocated but fetch callback called';
            }
            
            var scheduler = this._scheduler;
            
            if (scheduler.shouldYieldOrAbort(this)) {
                this._fetcher.abortAsync();
            }
        }
    } catch (e) {
        this._isFailure = true;
        fetchAbortedByScheduler(this);
    }
};

FetchJob.prototype._fetchStoppedByFetchClient = function fetchStoppedByFetchClient(isAborted) {
	//if (this._alreadyTerminatedWhenAllDataArrived) {
	//	// Resources were already released ASAP
	//	return;
	//}
	
    if (this._isYielded || this._resource === null) {
        throw 'Unexpected request state on stopped';
    }
    
    if (this._isOnlyWaitForData ||
        this._fetcher === null) {
        
        throw 'Unexpected request type on stopped';
    }
    
    if (!isAborted) {
        if (!this._isTerminated) {
            throw '"stopped" listener was called with isAborted=false but ' +
                'imageDataContext "data" listener was not called yet';
        }
        
        return;
    }
    
    var scheduler = this._scheduler;
    
    var isYielded = scheduler.tryYield(
        continueYieldedRequest,
        this,
        fetchAbortedByScheduler,
        fetchYieldedByScheduler,
        this._resource);
    
    if (isYielded || this._isTerminated) {
        scheduler.jobDone(this._resource, this);
        
        return;
    }
    
    this._continueFetch();
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
    if (self._imageDataContext !== null) {
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
        self._fetcher.on('stop', self._fetchStoppedByFetchClientBound);
    }
    
    self._startFetch();
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