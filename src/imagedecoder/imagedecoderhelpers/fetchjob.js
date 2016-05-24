'use strict';

module.exports = FetchJob;

FetchJob.FETCH_TYPE_REQUEST = 1;
FetchJob.FETCH_TYPE_CHANNEL = 2; // movable
FetchJob.FETCH_TYPE_ONLY_WAIT_FOR_DATA = 3;

function FetchJob(fetcher, scheduler, fetchType, contextVars) {
    this._fetcher = fetcher;
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
	this._isChannelStartedFetch = false;
    this._contextVars = contextVars;
    this._isOnlyWaitForData = fetchType === FetchJob.FETCH_TYPE_ONLY_WAIT_FOR_DATA;
    this._useScheduler = fetchType === FetchJob.FETCH_TYPE_REQUEST;
    this._imageDataContext = null;
    this._resource = null;
    this._abortedBound = this._aborted.bind(this);
	this._fetchHandle = null;
    //this._alreadyTerminatedWhenAllDataArrived = false;
    
    if (fetchType === FetchJob.FETCH_TYPE_CHANNEL) {
        this._movableFetchState = {};
    } else {
        this._movableFetchState = null;
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
    
    if (this._fetchHandle !== null) {
        this._fetchHandle.abortAsync().then(this._abortedBound);
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

FetchJob.prototype.setIsProgressive = function setIsProgressive(isProgressive) {
    this._isProgressive = isProgressive;
	if (this._imageDataContext !== null) {
		this._imageDataContext.setIsProgressive(isProgressive);
	}
};

FetchJob.prototype.getIsProgressive = function getIsProgressive() {
    return this._isProgressive;
};

FetchJob.prototype._startFetch = function startFetch() {
    var imageDataContext = this._fetcher.createImageDataContext(
        this._imagePartParams);
    
    this._imageDataContext = imageDataContext;
	this._imageDataContext.setIsProgressive(this._isProgressive);

    if (imageDataContext.isDone()) {
        for (var i = 0; i < this._dataListeners.length; ++i) {
            this._dataListeners[i].call(this, this._contextVars, imageDataContext);
        }

        this._fetchTerminated(/*isAborted=*/false);
        //this._alreadyTerminatedWhenAllDataArrived = true;
        
        return;
    }
    
    if (imageDataContext.hasData()) {
        for (var j = 0; j < this._dataListeners.length; ++j) {
            this._dataListeners[j].call(this, this._contextVars, imageDataContext);
        }
    }
    
    var self = this;
    imageDataContext.on('data', function() {
        self._dataCallback(imageDataContext);
    });
    
    if (!this._isOnlyWaitForData) {
		if (!this._isChannel) {
			this._fetchHandle = this._fetcher.fetch(imageDataContext);
		} else if (this._isChannelStartedFetch) {
			this._fetcher.moveFetch(imageDataContext, this._movableFetchState);
		} else {
			this._fetcher.startMovableFetch(imageDataContext, this._movableFetchState);
			this._isChannelStartedFetch = true;
		}
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
    
    // Channel is not really terminated, but only fetches a new region
    // (see moveChannel()).
    if (!this._isChannel) {
        this._isTerminated = true;
        
        for (var i = 0; i < this._terminatedListeners.length; ++i) {
            this._terminatedListeners[i](
                this._contextVars, this._imageDataContext, isAborted);
        }
    }
    
    if (this._imageDataContext !== null && !this._isFailure) {
        this._imageDataContext.release();
    }
};

FetchJob.prototype._continueFetch = function continueFetch() {
    if (this.isChannel) {
        throw 'Unexpected call to continueFetch on channel';
    }
    
    this._fetchHandle = this._fetcher.fetch(this._imageDataContext);
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
            this._dataListeners[i].call(this, this._contextVars, imageDataContext);
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
            
			var isYielded = this._scheduler.tryYield(
				continueYieldedRequest,
				this,
				fetchAbortedByScheduler,
				fetchYieldedByScheduler,
				this._resource);
            
			if (isYielded) {
                this._fetchHandle.abortAsync().then(this._abortedBound);
            }
        }
    } catch (e) {
        this._isFailure = true;
        fetchAbortedByScheduler(this);
    }
};

FetchJob.prototype._aborted = function aborted() {
    // TODO: It seems that this function is totally historical code. Should review it.
    
    //if (this._alreadyTerminatedWhenAllDataArrived) {
    //    // Resources were already released ASAP
    //    return;
    //}
    
    if (this._isYielded || this._resource === null) {
        throw 'Unexpected request state on stopped';
    }
    
    if (this._isOnlyWaitForData ||
        this._fetchHandle === null) {
        
        throw 'Unexpected request type on stopped';
    }
    
    /*
    if (!isAborted) {
        if (!this._isTerminated) {
            throw '"stopped" listener was called with isAborted=false but ' +
                'imageDataContext "data" listener was not called yet';
        }
        
        return;
    }
    //*/
    
    var scheduler = this._scheduler;
    
    var isYielded = scheduler.tryYield(
        continueYieldedRequest,
        this,
        fetchAbortedByScheduler,
        fetchYieldedByScheduler,
        this._resource);
    
    if (isYielded || this._isTerminated) {
        this._fetchHandle = null;
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