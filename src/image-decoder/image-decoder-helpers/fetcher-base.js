'use strict';

module.exports = FetcherBase;

var imageHelperFunctions = require('image-helper-functions.js');
var FetchContext = require('fetch-context.js');
var LinkedList = require('linked-list.js');
var FetcherCloser = require('fetcher-closer.js');
var SimpleMovableFetch = require('simple-movable-fetch.js');

/* global console: false */
/* global Promise: false */

function FetcherBase(options) {
    options = options || {};
	
	var self = this;
    var serverRequestsLimit = options.serverRequestsLimit || 5;
    
    self._showLog = options.showLog;
	self._maxActiveFetchesInMovableFetch = options.maxActiveFetchesInMovableFetch || 2;
    
    if (self._showLog) {
        // Old IE
        throw 'imageDecoderFramework error: showLog is not supported on this browser';
    }
	
    var serverRequestScheduler = imageHelperFunctions.createScheduler(
        options.showLog,
        options.serverRequestPrioritizer,
        'serverRequest',
        createServerRequestDummyResource,
        serverRequestsLimit);
    
    self._serverRequestPrioritizer = serverRequestScheduler.prioritizer;
    
    self._scheduler = serverRequestScheduler.scheduler;
    self._movableHandleCounter = 0;
    self._movableHandles = [];
    self._requestById = [];
	self._imageParams = null;
    self._scheduledJobsList = new LinkedList();
	self._fetcherCloser = new FetcherCloser();
}

FetcherBase.prototype.open = function open(url) {
    throw 'imageDecoderFramework error: open() is not implemented by FetcherBase inheritor';
};

FetcherBase.prototype.on = function on(event, callback) {
    throw 'imageDecoderFramework error: on() is not implemented by FetcherBase inheritor';
};

FetcherBase.prototype.close = function close() {
	if (this.startMovableFetch !== FetcherBase.prototype.startMovableFetch) {
		throw 'imageDecoderFramework error: Must override FetcherBase.close() when FetcherBase.startMovableFetch() was override';
	}
    return this._fetcherCloser.close();
};

FetcherBase.prototype.openInternal = function openInternal(url) {
	var self = this;
    return this.open(url).then(function(result) {
		self._imageParams = result;
		return result;
	});
};

FetcherBase.prototype.getImageParams = function getImageParams() {
	return this._imageParams;
};

FetcherBase.prototype.startFetch = function startFetch(fetchContext, imagePartParams) {
    throw 'imageDecoderFramework error: startFetch() is not implemented by FetcherBase inheritor';
};

FetcherBase.prototype.startMovableFetch = function startFetch(fetchContext, imagePartParams) {
    var movableFetch = new SimpleMovableFetch(
		this, this._fetcherCloser, fetchContext, this._maxActiveFetchesInMovableFetch);
	
	movableFetch.start(imagePartParams);
};

FetcherBase.prototype.setIsProgressiveRequest = function setIsProgressiveRequest(
    requestId, isProgressive) {
    
    var fetchJob = this._requestById[requestId];
    if (fetchJob === undefined) {
        // This situation might occur if request has been terminated,
        // but user's terminatedCallback has not been called yet. It
        // happens on WorkerProxyFetcherBase due to thread
        // message delay.
        
        return null;
    }
    
    fetchJob.setIsProgressive(isProgressive);
};

FetcherBase.prototype.createMovableFetch = function createMovableFetch() {
	var self = this;
    return new Promise(function(resolve, reject) {
        var movableHandle = ++self._movableHandleCounter;
        self._movableHandles[movableHandle] = new FetchContext(
            self,
            self._scheduler,
            self._scheduledJobsList,
            FetchContext.FETCH_TYPE_MOVABLE,
            /*contextVars=*/null);

        resolve(movableHandle);
    });
};

FetcherBase.prototype.moveFetch = function moveFetch(
    movableHandle, imagePartParams) {
    
    var movable = this._movableHandles[movableHandle];
    movable.fetch(imagePartParams);
};

FetcherBase.prototype.createRequest = function createRequest(
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
        this, this._scheduler, this._scheduledJobsList, fetchType, contextVars);
    
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

FetcherBase.prototype.manualAbortRequest = function manualAbortRequest(
    requestId) {
    
    var fetchJob = this._requestById[requestId];
    
    if (fetchJob === undefined) {
        // This situation might occur if request has been terminated,
        // but user's terminatedCallback has not been called yet. It
        // happens on WorkerProxyFetcherBase due to web worker
        // message delay.
        
        return;
    }
    
    fetchJob.manualAbortRequest();
    delete this._requestById[requestId];
};

FetcherBase.prototype.setServerRequestPrioritizerData =
    function setServerRequestPrioritizerData(prioritizerData) {

    if (this._serverRequestPrioritizer === null) {
        throw 'imageDecoderFramework error: No serverRequest prioritizer has been set';
    }
    
    if (this._showLog) {
        console.log('setServerRequestPrioritizerData(' + prioritizerData + ')');
    }
    
    prioritizerData.image = this;
    this._serverRequestPrioritizer.setPrioritizerData(prioritizerData);
    this._yieldFetchJobs();
};

FetcherBase.prototype._yieldFetchJobs = function yieldFetchJobs() {
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

function createServerRequestDummyResource() {
    return {};
}