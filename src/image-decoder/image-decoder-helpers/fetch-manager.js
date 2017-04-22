'use strict';

module.exports = FetchManager;

var imageHelperFunctions = require('image-helper-functions.js');
var FetchJob = require('fetch-job.js');
var ImageParamsRetrieverProxy = require('image-params-retriever-proxy.js');
var LinkedList = require('linked-list.js');

/* global console: false */
/* global Promise: false */

function FetchManager(fetcher, options) {
    ImageParamsRetrieverProxy.call(this);

    options = options || {};
    var serverRequestsLimit = options.serverRequestsLimit || 5;
    
    this._fetcher = fetcher;
    this._internalSizesParams = null;
    this._showLog = options.showLog;
    
    if (this._showLog) {
        // Old IE
        throw 'showLog is not supported on this browser';
    }
	
	if (!fetcher.on) {
		throw 'ImageDecoderFramework error: Fetcher has no method on()';
	}
	if (!fetcher.open) {
		throw 'ImageDecoderFramework error: Fetcher has no method open()';
	}
    if (!fetcher.close) {
		throw 'ImageDecoderFramework error: Fetcher has no method close()';
	}
    if (!fetcher.fetch) {
		throw 'ImageDecoderFramework error: Fetcher has no method fetch()';
	}
    if (!fetcher.moveFetch) {
		throw 'ImageDecoderFramework error: Fetcher has no method moveFetch()';
	}
    if (!fetcher.startMovableFetch) {
		throw 'ImageDecoderFramework error: Fetcher has no method startMovableFetch()';
	}
    
    var serverRequestScheduler = imageHelperFunctions.createScheduler(
        options.showLog,
        options.serverRequestPrioritizer,
        'serverRequest',
        createServerRequestDummyResource,
        serverRequestsLimit);
    
    this._serverRequestPrioritizer = serverRequestScheduler.prioritizer;
    
    this._scheduler = serverRequestScheduler.scheduler;
    this._channelHandleCounter = 0;
    this._channelHandles = [];
    this._requestById = [];
    this._scheduledJobsList = new LinkedList();
}

FetchManager.prototype = Object.create(ImageParamsRetrieverProxy.prototype);

FetchManager.prototype.open = function open(url) {
    var promise = this._fetcher.open(url);
    var self = this;
    return promise.then(function(result) {
        self._internalSizesParams = result;
        return result;
    });
};

FetchManager.prototype.on = function on(event, callback) {
    this._fetcher.on(event, callback);
};

FetchManager.prototype.close = function close() {
    return this._fetcher.close();
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

FetchManager.prototype.createChannel = function createChannel() {
	var self = this;
    return new Promise(function(resolve, reject) {
        var channelHandle = ++self._channelHandleCounter;
        self._channelHandles[channelHandle] = new FetchJob(
            self._fetcher,
            self._scheduler,
            self._scheduledJobsList,
            FetchJob.FETCH_TYPE_CHANNEL,
            /*contextVars=*/null);

        resolve(channelHandle);
    });
};

FetchManager.prototype.moveChannel = function moveChannel(
    channelHandle, imagePartParams) {
    
    var channel = this._channelHandles[channelHandle];
    channel.fetch(imagePartParams);
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
        FetchJob.FETCH_TYPE_ONLY_WAIT_FOR_DATA : */FetchJob.FETCH_TYPE_REQUEST;
    
    var fetchJob = new FetchJob(
        this._fetcher, this._scheduler, this._scheduledJobsList, fetchType, contextVars);
    
    contextVars.fetchJob = fetchJob;
    
    if (this._requestById[requestId] !== undefined) {
        throw 'Duplication of requestId ' + requestId;
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

FetchManager.prototype.setServerRequestPrioritizerData =
    function setServerRequestPrioritizerData(prioritizerData) {

    if (this._serverRequestPrioritizer === null) {
        throw 'No serverRequest prioritizer has been set';
    }
    
    if (this._showLog) {
        console.log('setServerRequestPrioritizerData(' + prioritizerData + ')');
    }
    
    prioritizerData.image = this;
    this._serverRequestPrioritizer.setPrioritizerData(prioritizerData);
    this._yieldFetchJobs();
};

FetchManager.prototype._getImageParamsInternal = function getImageParamsInternal() {
    return this._internalSizesParams;
};

FetchManager.prototype._yieldFetchJobs = function yieldFetchJobs() {
    var iterator = this._scheduledJobsList.getFirstIterator();
    while (iterator !== null) {
        var fetchJob = this._scheduledJobsList.getValue(iterator);
        iterator = this._scheduledJobsList.getNextIterator(iterator);
        
        fetchJob.checkIfShouldYield();
    }
};

function internalTerminatedCallback(contextVars, isAborted) {
    delete contextVars.self._requestById[contextVars.requestId];
}

function createServerRequestDummyResource() {
    return {};
}