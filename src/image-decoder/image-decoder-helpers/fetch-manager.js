'use strict';

module.exports = FetchManager;

var imageHelperFunctions = require('image-helper-functions.js');
var FetchContext = require('fetch-context.js');
var LinkedList = require('linked-list.js');
var FetcherCloser = require('fetcher-closer.js');

/* global console: false */
/* global Promise: false */

FetchManager.fetcherExpectedMethods = ['open', 'on', 'close', 'startFetch', 'startMovableFetch'];

function FetchManager(fetcher, options) {
    options = options || {};
    
    this._fetchesLimit = options.fetchesLimit || 5;
    this._showLog = options.showLog;
    
    if (this._showLog) {
        // Old IE
        throw 'imageDecoderFramework error: showLog is not supported on this browser';
    }
    
    this._scheduler = null;
    this._fetchPrioritizer = null;
    this._prioritizerType = null;
        
    this._movableHandleCounter = 0;
    this._movableHandles = [];
    this._requestById = [];
    this._imageParams = null;
    this._scheduledJobsList = new LinkedList();
    this._fetcherCloser = new FetcherCloser();
    
    this._fetcher = imageHelperFunctions.getOrCreateInstance(
        fetcher, 'fetcher', FetchManager.fetcherExpectedMethods);
}

FetchManager.prototype.open = function open(url) {
    var fetchScheduler = imageHelperFunctions.createPrioritizer(
        this._fetchesLimit,
        this._prioritizerType,
        'fetch',
        this._showLog);
    
    this._fetchPrioritizer = fetchScheduler.prioritizer;
    if (fetchScheduler.prioritizer !== null) {
        this._scheduler = new resourceScheduler.PriorityScheduler(
            createDummyResource,
            this._fetchesLimit,
            fetchScheduler.prioritizer,
            fetchScheduler.schedulerOptions);
    } else {
        this._scheduler = new resourceScheduler.LifoScheduler(
            createDummyResource,
            this._fetchesLimit,
            fetchScheduler.schedulerOptions);
    }

    var self = this;
    return this._fetcher.open(url).then(function(result) {
        self._imageParams = result;
        return result;
    });
};

FetchManager.prototype.on = function on(event, callback, arg) {
    return this._fetcher.on(event, callback, arg);
};

FetchManager.prototype.close = function close() {
    var self = this;
    var resolve_ = null;
    var reject_ = null;

    function waitForActiveFetches(result) {
        self._fetcherCloser.close()
            .then(function() {
                resolve_(result);
            }).catch(reject_);
    }
    
    return new Promise(function(resolve, reject) {
        resolve_ = resolve;
        reject_ = reject;
        self._fetcher.close()
            .then(waitForActiveFetches)
            .catch(reject);
    });
};

FetchManager.prototype.setPrioritizerType = function setPrioritizerType(prioritizerType) {
    if (this._scheduler !== null) {
        throw 'imageDecoderFramework error: cannot set prioritizer type after FetchManager.open() called';
    }
    this._prioritizerType = prioritizerType;
};

FetchManager.prototype.getImageParams = function getImageParams() {
    return this._imageParams;
};

FetchManager.prototype.setIsProgressiveRequest = function setIsProgressiveRequest(
    requestId, isProgressive) {
    
    var fetchJob = this._requestById[requestId];
    if (fetchJob === undefined) {
        // This situation might occur if request has been terminated,
        // but user's terminatedCallback has not been called yet. It
        // happens on WorkerProxyFetchManager due to thread
        // message delay.
        
        return null;
    }
    
    fetchJob.setIsProgressive(isProgressive);
};

FetchManager.prototype.createMovableFetch = function createMovableFetch() {
    var self = this;
    return new Promise(function(resolve, reject) {
        var movableHandle = ++self._movableHandleCounter;
        self._movableHandles[movableHandle] = new FetchContext(
            self._fetcher,
            self._fetcherCloser,
            self._scheduler,
            self._scheduledJobsList,
            FetchContext.FETCH_TYPE_MOVABLE,
            /*contextVars=*/null);

        resolve(movableHandle);
    });
};

FetchManager.prototype.moveFetch = function moveFetch(
    movableHandle, imagePartParams) {
    
    var movable = this._movableHandles[movableHandle];
    movable.fetch(imagePartParams);
};

FetchManager.prototype.createRequest = function createRequest(
    requestId, imagePartParams) {
    
    var contextVars = {
        progressiveStagesDone: 0,
        isLastCallbackCalledWithoutLowQualityLimit: false,
        requestId: requestId,
        fetchJob: null,
        self: this
    };
    
    var fetchType = /*isOnlyWaitForData ?
        FetchContext.FETCH_TYPE_ONLY_WAIT_FOR_DATA : */FetchContext.FETCH_TYPE_REQUEST;
    
    var fetchJob = new FetchContext(
        this._fetcher,
        this._fetcherCloser,
        this._scheduler,
        this._scheduledJobsList,
        fetchType,
        contextVars);
    
    contextVars.fetchJob = fetchJob;
    
    if (this._requestById[requestId] !== undefined) {
        throw 'imageDecoderFramework error: Duplication of requestId ' + requestId;
    } else if (requestId !== undefined) {
        this._requestById[requestId] = fetchJob;
    }
    
    fetchJob.on('terminated', internalTerminatedCallback);
    
    fetchJob.fetch(imagePartParams);
    
    this._yieldFetchJobs();
};

FetchManager.prototype.manualAbortRequest = function manualAbortRequest(
    requestId) {
    
    var fetchJob = this._requestById[requestId];
    
    if (fetchJob === undefined) {
        // This situation might occur if request has been terminated,
        // but user's terminatedCallback has not been called yet. It
        // happens on WorkerProxyFetchManager due to web worker
        // message delay.
        
        return;
    }
    
    fetchJob.manualAbortRequest();
    delete this._requestById[requestId];
};

FetchManager.prototype.setFetchPrioritizerData =
    function setFetchPrioritizerData(prioritizerData) {

    if (this._fetchPrioritizer === null) {
        throw 'imageDecoderFramework error: No fetch prioritizer has been set';
    }
    
    if (this._showLog) {
        console.log('setFetchPrioritizerData(' + prioritizerData + ')');
    }
    
    prioritizerData.image = this;
    this._fetchPrioritizer.setPrioritizerData(prioritizerData);
    this._yieldFetchJobs();
};

FetchManager.prototype._yieldFetchJobs = function yieldFetchJobs() {
    var iterator = this._scheduledJobsList.getFirstIterator();
    while (iterator !== null) {
        var fetchJob = this._scheduledJobsList.getValue(iterator);
        iterator = this._scheduledJobsList.getNextIterator(iterator);
        
        fetchJob.checkIfShouldYield();
    }
};

function internalTerminatedCallback(contextVars) {
    delete contextVars.self._requestById[contextVars.requestId];
}

function createDummyResource() {
    return {};
}