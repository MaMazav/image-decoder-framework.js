'use strict';

module.exports = FetchJob;

FetchJob.FETCH_TYPE_REQUEST = 1;
FetchJob.FETCH_TYPE_CHANNEL = 2; // movable
FetchJob.FETCH_TYPE_ONLY_WAIT_FOR_DATA = 3;

FetchJob.FETCH_STATUS_WAIT_FOR_FETCH_CALL = 1;
FetchJob.FETCH_STATUS_REQUEST_WAIT_FOR_SCHEDULE = 2;
FetchJob.FETCH_STATUS_ACTIVE = 3;
FetchJob.FETCH_STATUS_REQUEST_ABOUT_TO_YIELD = 4;
FetchJob.FETCH_STATUS_REQUEST_ABOUT_TO_YIELD_PENDING_NEW_DATA = 5;
FetchJob.FETCH_STATUS_REQUEST_YIELDED = 6;
FetchJob.FETCH_STATUS_REQUEST_YIELDED_PENDING_NEW_DATA = 7;
FetchJob.FETCH_STATUS_REQUEST_ABOUT_TO_ABORT = 8;
FetchJob.FETCH_STATUS_REQUEST_TERMINATED = 9;
FetchJob.FETCH_STATUS_UNEXPECTED_FAILURE = 10;

function FetchJob(fetcher, scheduler, fetchType, contextVars) {
    this._fetcher = fetcher;
    this._scheduler = scheduler;
    
    this._dataListeners = [];
    this._terminatedListeners = [];
    
    this._imagePartParams = null;
    this._progressiveStagesDone = 0;
    
    this._state = FetchJob.FETCH_STATUS_WAIT_FOR_FETCH_CALL;
    /*
    this._isAboutToYield = false;
    this._isYielded = false;
    this._isFailure = false;
    this._isTerminated = false;
    this._isManuallyAborted = false;
    this._hasNewDataTillYield = false;
	this._isChannelStartedFetch = false;
    */
    this._isChannel = fetchType === FetchJob.FETCH_TYPE_CHANNEL;
    this._contextVars = contextVars;
    this._isOnlyWaitForData = fetchType === FetchJob.FETCH_TYPE_ONLY_WAIT_FOR_DATA;
    this._useScheduler = fetchType === FetchJob.FETCH_TYPE_REQUEST;
    this._imageDataContext = null;
    this._resource = null;
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
		if (this._imageDataContext !== null) {
			this._imageDataContext.dispose();
		}
        this._imagePartParams = imagePartParams;
        this._startFetch();
        return;
    }
    
    if (this._imagePartParams !== null) {
        throw 'Cannot fetch twice on fetch type of "request"';
    }
    
    if (this._state !== FetchJob.FETCH_STATUS_WAIT_FOR_FETCH_CALL) {
        this._state = FetchJob.FETCH_STATUS_UNEXPECTED_FAILURE;
        throw 'Unexpected state on fetch(): ' + this._state;
    }

    this._imagePartParams = imagePartParams;
    this._state = FetchJob.FETCH_STATUS_REQUEST_WAIT_FOR_SCHEDULE;
    
    if (!this._useScheduler) {
        startRequest(/*resource=*/null, this);
        return;
    }
    
    this._scheduler.enqueueJob(startRequest, this, fetchAbortedByScheduler);
};

FetchJob.prototype.manualAbortRequest = function manualAbortRequest() {
    switch (this._state) {
        case FetchJob.FETCH_STATUS_REQUEST_TERMINATED:
        case FetchJob.FETCH_STATUS_UNEXPECTED_FAILURE:
            return;
        case FetchJob.FETCH_STATUS_REQUEST_ABOUT_TO_ABORT:
            throw 'Double call to manualAbortRequest()';
        case FetchJob.FETCH_STATUS_ACTIVE:
            var self = this;
            this._state = FetchJob.FETCH_STATUS_REQUEST_ABOUT_TO_ABORT;
            if (self._isOnlyWaitForData) {
                self._fetchTerminated(/*isAborted=*/true);
            } else {
                this._fetchHandle.stopAsync().then(function() {
                    self._fetchTerminated(/*isAborted=*/true);
                });
            }
            break;
        case FetchJob.FETCH_STATUS_WAIT_FOR_FETCH_CALL:
            this._state= FetchJob.FETCH_STATUS_REQUEST_TERMINATED;
            return;
        case FetchJob.FETCH_STATUS_REQUEST_WAIT_FOR_SCHEDULE:
        case FetchJob.FETCH_STATUS_REQUEST_ABOUT_TO_YIELD:
        case FetchJob.FETCH_STATUS_REQUEST_ABOUT_TO_YIELD_PENDING_NEW_DATA:
        case FetchJob.FETCH_STATUS_REQUEST_YIELDED:
        case FetchJob.FETCH_STATUS_REQUEST_YIELDED_PENDING_NEW_DATA:
            this._state = FetchJob.FETCH_STATUS_REQUEST_ABOUT_TO_ABORT;
            break;
        default:
            throw 'Unknown state in manualAbortRequest() implementation: ' + this._state;
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
    
    var prevState = this._state;
    this._imageDataContext = imageDataContext;
	this._imageDataContext.setIsProgressive(this._isProgressive);
    this._state = FetchJob.FETCH_STATUS_ACTIVE;
    
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
		} else if (prevState !== FetchJob.FETCH_STATUS_WAIT_FOR_FETCH_CALL) {
			this._fetcher.moveFetch(imageDataContext, this._movableFetchState);
		} else {
			this._fetcher.startMovableFetch(imageDataContext, this._movableFetchState);
		}
    }
};

FetchJob.prototype._fetchTerminated = function fetchTerminated(isAborted) {
    switch (this._state) {
        case FetchJob.FETCH_STATUS_REQUEST_ABOUT_TO_ABORT:
            break;
        case FetchJob.FETCH_STATUS_ACTIVE:
        case FetchJob.FETCH_STATUS_REQUEST_ABOUT_TO_YIELD:
        case FetchJob.FETCH_STATUS_REQUEST_ABOUT_TO_YIELD_PENDING_NEW_DATA:
            if (isAborted) {
                this._state = FetchJob.FETCH_STATUS_UNEXPECTED_FAILURE;
                throw 'Unexpected abort when fetch is active';
            }
            break;
        default:
            throw 'Unexpected state on fetch terminated: ' + this._state;
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
        this._state = FetchJob.FETCH_STATUS_REQUEST_TERMINATED;
        
        for (var i = 0; i < this._terminatedListeners.length; ++i) {
            this._terminatedListeners[i](
                this._contextVars, this._imageDataContext, isAborted);
        }
    }
    
    if (this._imageDataContext !== null && this._state !== FetchJob.FETCH_STATUS_UNEXPECTED_FAILURE) {
        this._imageDataContext.dispose();
        this._imageDataContext = null;
    }
};

FetchJob.prototype._dataCallback = function dataCallback(imageDataContext) {
    try {
        if (imageDataContext !== this._imageDataContext) {
            throw 'Unexpected imageDataContext';
        }

        ++this._progressiveStagesDone;
        
        switch (this._state) {
            case FetchJob.FETCH_STATUS_ACTIVE:
                break;
            case FetchJob.FETCH_STATUS_REQUEST_ABOUT_TO_YIELD:
                this._state = FetchJob.FETCH_STATUS_REQUEST_ABOUT_TO_YIELD_PENDING_NEW_DATA;
                return;
            case FetchJob.FETCH_STATUS_REQUEST_YIELDED:
                this._state = FetchJob.FETCH_STATUS_REQUEST_YIELDED_PENDING_NEW_DATA;
                return;
            case FetchJob.FETCH_STATUS_REQUEST_ABOUT_TO_YIELD_PENDING_NEW_DATA:
            case FetchJob.FETCH_STATUS_REQUEST_YIELDED_PENDING_NEW_DATA:
            case FetchJob.FETCH_STATUS_UNEXPECTED_FAILURE:
            case FetchJob.FETCH_STATUS_REQUEST_ABOUT_TO_ABORT:
                return;
                
            default:
                throw 'Unexpected state in data callback: ' + this._state;
        }
        
        this._hasNewData();
        
        if (!this._useScheduler || this._state === FetchJob.FETCH_STATUS_REQUEST_TERMINATED) {
            return;
        }
        
        if (this._resource === null) {
            throw 'No resource allocated but fetch callback called';
        }
            
        if (!this._scheduler.shouldYieldOrAbort(this._resource)) {
            return;
        }
        
        this._state = FetchJob.FETCH_STATUS_REQUEST_ABOUT_TO_YIELD;
        var self = this;
        this._fetchHandle.stopAsync().then(function() {
            if (self._fetchState === FetchJob.FETCH_STATUS_REQUEST_ABOUT_TO_ABORT) {
                self._fetchTerminated(/*isAborted=*/true);
                return;
            }
            
            var isYielded = self._scheduler.tryYield(
                continueYieldedRequest,
                self,
                fetchAbortedByScheduler,
                fetchYieldedByScheduler,
                self._resource);
            
            if (!isYielded) {
                if (self._state === FetchJob.FETCH_STATUS_REQUEST_ABOUT_TO_YIELD_PENDING_NEW_DATA) {
                    self._hasNewData();
                } else if (self._state !== FetchJob.FETCH_STATUS_REQUEST_ABOUT_TO_YIELD) {
                    throw 'Unexpected state on tryYield() false: ' + self._state;
                }
                self._state = FetchJob.FETCH_STATUS_ACTIVE;
                self._fetchHandle.resume();
            }
        }).catch(function() {
            self._state = FetchJob.FETCH_STATUS_UNEXPECTED_FAILURE;
            fetchAbortedByScheduler(self);
        });
    } catch (e) {
        this._state = FetchJob.FETCH_STATUS_UNEXPECTED_FAILURE;
        fetchAbortedByScheduler(this);
    }
};

FetchJob.prototype._hasNewData = function hasNewData() {
    for (var i = 0; i < this._dataListeners.length; ++i) {
        this._dataListeners[i].call(this, this._contextVars, this._imageDataContext);
    }
    
    if (this._imageDataContext.isDone()) {
        this._fetchTerminated(/*isAborted=*/false);
    }
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
    if (self._imageDataContext !== null || self._resource !== null) {
        throw 'Unexpected restart of already started request';
    }
    
    if (self._state === FetchJob.FETCH_STATUS_REQUEST_ABOUT_TO_ABORT) {
        self._fetchTerminated(/*isAborted=*/true);
        return;
    } else if (self._state !== FetchJob.FETCH_STATUS_REQUEST_WAIT_FOR_SCHEDULE) {
        throw 'Unexpected state on schedule: ' + self._state;
    }
    
    self._resource = resource;
    
    self._startFetch();
}

function continueYieldedRequest(resource, self) {
    if (self.isChannel) {
        throw 'Unexpected call to continueYieldedRequest on channel';
    }

    if (self._state === FetchJob.FETCH_STATUS_REQUEST_ABOUT_TO_ABORT ||
        self._state === FetchJob.FETCH_STATUS_UNEXPECTED_FAILURE) {
        
        self._scheduler.jobDone(resource, self);
        return;
    }
    
    if (self._state === FetchJob.FETCH_STATUS_REQUEST_YIELDED_PENDING_NEW_DATA) {
        self._hasNewData();
    } else if (self._state !== FetchJob.FETCH_STATUS_REQUEST_YIELDED) {
        throw 'Unexpected request state on continue: ' + self._state;
    }
    
    self._state = FetchJob.FETCH_STATUS_ACTIVE;
    self._resource = resource;
    
    self._fetchHandle.resume();
}

function fetchYieldedByScheduler(self) {
    var nextState;
    self._resource = null;
    switch (self._state) {
        case FetchJob.FETCH_STATUS_REQUEST_ABOUT_TO_YIELD_PENDING_NEW_DATA:
            self._state = FetchJob.FETCH_STATUS_REQUEST_YIELDED_PENDING_NEW_DATA;
            break;
        case FetchJob.FETCH_STATUS_REQUEST_ABOUT_TO_YIELD:
            self._state = FetchJob.FETCH_STATUS_REQUEST_YIELDED;
            break;
        default:
            self._state = FetchJob.FETCH_STATUS_UNEXPECTED_FAILURE;
            throw 'Unexpected request state on yield process: ' + self._state;
    }
}

function fetchAbortedByScheduler(self) {
    self._resource = null;
    self._fetchTerminated(/*isAborted=*/true);
}