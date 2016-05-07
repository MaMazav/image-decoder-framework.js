'use strict';

module.exports = FetchManager;

var imageHelperFunctions = require('imagehelperfunctions.js');
var FetchJob = require('fetchjob.js');
var ImageParamsRetrieverProxy = require('imageparamsretrieverproxy.js');

/* global console: false */

function FetchManager(options) {
    ImageParamsRetrieverProxy.call(this, options.imageImplementationClassName);

    var serverRequestsLimit = options.serverRequestsLimit || 5;
    
    this._fetchClient = this._imageImplementation.createFetchClient();
    this._showLog = options.showLog;
    
    if (this._showLog) {
        // Old IE
        throw 'showLog is not supported on this browser';
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
}

FetchManager.prototype = Object.create(ImageParamsRetrieverProxy.prototype);

FetchManager.prototype.setStatusCallback = function setStatusCallback(statusCallback) {
    this._fetchClient.setStatusCallback(statusCallback);
};

FetchManager.prototype.open = function open(url) {
    this._fetchClient.open(url);
};

FetchManager.prototype.close = function close(closedCallback) {
    this._fetchClient.close(closedCallback);
};

FetchManager.prototype.setIsProgressiveRequest = function setIsProgressiveRequest(
    requestId, isProgressive) {
    
    var scheduledRequest = this._requestById[requestId];
    if (scheduledRequest === undefined) {
        // This situation might occur if request has been terminated,
        // but user's terminatedCallback has not been called yet. It
        // happens on WorkerProxyFetchManager due to thread
        // message delay.
        
        return null;
    }
    
    return scheduledRequest.getContextVars();
};

FetchManager.prototype.createChannel = function createChannel(
    createdCallback) {
    
    var channelHandle = ++this._channelHandleCounter;
    this._channelHandles[channelHandle] = new FetchJob(
        this._fetchClient,
        this._scheduler,
        FetchJob.FETCH_TYPE_CHANNEL,
        /*contextVars=*/null);

    createdCallback(channelHandle);
};

FetchManager.prototype.moveChannel = function moveChannel(
    channelHandle, imagePartParams) {
    
    var channel = this._channelHandles[channelHandle];
    channel.fetch(imagePartParams);
};

FetchManager.prototype.createRequest = function createRequest(
    fetchParams,
    callbackThis,
    callback,
    terminatedCallback,
    isOnlyWaitForData,
    requestId) {
    
    var contextVars = {
        progressiveStagesDone: 0,
        isProgressive: false,
        isLastCallbackCalledWithoutLowQualityLayerLimit: false,
        callbackThis: callbackThis,
        callback: callback,
        terminatedCallback: terminatedCallback,
        requestId: requestId,
        self: this
    };
    
    var fetchType = isOnlyWaitForData ?
        FetchJob.FETCH_TYPE_ONLY_WAIT_FOR_DATA : FetchJob.FETCH_TYPE_REQUEST;
    
    var scheduledRequest = new FetchJob(
        this._fetchClient, this._scheduler, fetchType, contextVars);
    
    if (this._requestById[requestId] !== undefined) {
        throw 'Duplication of requestId ' + requestId;
    } else if (requestId !== undefined) {
        this._requestById[requestId] = scheduledRequest;
    }
    
    scheduledRequest.on('data', internalCallback);
    scheduledRequest.on('terminated', internalTerminatedCallback);
    
    scheduledRequest.fetch(fetchParams);
};

FetchManager.prototype.manualAbortRequest = function manualAbortRequest(
    requestId) {
    
    var scheduledRequest = this._requestById[requestId];
    
    if (scheduledRequest === undefined) {
        // This situation might occur if request has been terminated,
        // but user's terminatedCallback has not been called yet. It
        // happens on WorkerProxyFetchManager due to web worker
        // message delay.
        
        return;
    }
    
    scheduledRequest.manualAbortRequest();
    delete this._requestById[requestId];
};

FetchManager.prototype.reconnect = function reconnect() {
    this._fetchClient.reconnect();
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
    };

FetchManager.prototype._getSizesParamsInternal = function getSizesParamsInternal() {
    var sizesParams = this._fetchClient.getSizesParams();
    return sizesParams;
};

function internalCallback(contextVars, imageDataContext) {
    var isLimitToLowQualityLayer = 
        contextVars.progressiveStagesDone === 0;
    
    // See comment at internalTerminatedCallback method
    contextVars.isLastCallbackCalledWithoutLowQualityLayerLimit |=
        contextVars.isProgressive &&
        !isLimitToLowQualityLayer;
    
    if (!contextVars.isProgressive) {
        return;
    }
    
    var maxNumQualityLayers =
        isLimitToLowQualityLayer ? 1 : undefined;
    
    ++contextVars.progressiveStagesDone;
    
    extractDataAndCallCallback(
        contextVars, imageDataContext, maxNumQualityLayers);
}

function internalTerminatedCallback(contextVars, imageDataContext, isAborted) {
    if (!contextVars.isLastCallbackCalledWithoutLowQualityLayerLimit) {
        // This condition come to check if another decoding should be done.
        // One situation it may happen is when the request is not
        // progressive, then the decoding is done only on termination.
        // Another situation is when only the first stage has been reached,
        // thus the callback was called with only the first quality layer
        // (for performance reasons). Thus another decoding should be done.
        
        extractDataAndCallCallback(contextVars, imageDataContext);
    }
    
    contextVars.terminatedCallback.call(
        contextVars.callbackThis, isAborted);
    
    delete contextVars.self._requestById[contextVars.requestId];
}

function extractDataAndCallCallback(
    contextVars, imageDataContext, maxNumQualityLayers) {
    
    var dataForDecode = imageDataContext.getFetchedData(maxNumQualityLayers);
    
    contextVars.callback.call(
        contextVars.callbackThis, dataForDecode);
}

function createServerRequestDummyResource() {
    return {};
}