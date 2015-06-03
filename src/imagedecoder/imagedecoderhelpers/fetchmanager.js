'use strict';

module.exports = FetchManager;

var imageHelperFunctions = require('imagehelperfunctions.js');
var ScheduledRequestManager = require('scheduledrequestmanager.js');

/* global console: false */

function FetchManager(imageImplementationClassName, options) {
    var serverRequestsLimit = options.serverRequestsLimit || 5;
    
    this._imageImplementation = imageHelperFunctions.getImageImplementation(imageImplementationClassName);
    this._fetcher = this._imageImplementation.createFetcher();
    this._showLog = options.showLog;
    this._sizesCalculator = null;
    
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
    
    this._requestManager = new ScheduledRequestManager(
        this._fetcher, serverRequestScheduler.scheduler);
}

FetchManager.prototype.setStatusCallback = function setStatusCallback(statusCallback) {
    this._fetcher.setStatusCallback(statusCallback);
};

FetchManager.prototype.open = function open(url) {
    this._fetcher.open(url);
};

FetchManager.prototype.close = function close(closedCallback) {
    this._fetcher.close(closedCallback);
};

FetchManager.prototype.getSizesParams = function getSizesParams() {
    var sizesParams = this._fetcher.getSizesParams();
    return sizesParams;
};

FetchManager.prototype.setIsProgressiveRequest = function setIsProgressiveRequest(
    requestId, isProgressive) {
    
    var contextVars = this._requestManager.getContextVars(requestId);
    if (contextVars !== null) {
        contextVars.isProgressive = isProgressive;
    }
};

FetchManager.prototype.createMovableRequestHandle = function createMovableRequestHandle(
    createdCallback) {
    
    var requestHandle = this._requestManager.createMovableRequestHandle();
    createdCallback(requestHandle);
};

FetchManager.prototype.moveRequest = function moveRequest(
    movableRequestHandle, imagePartParams) {
    
    this._requestManager.moveRequest(
        movableRequestHandle, imagePartParams);
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
        terminatedCallback: terminatedCallback
    };
    
    this._requestManager.createRequest(
        fetchParams,
        contextVars,
        internalCallback,
        internalTerminatedCallback,
        isOnlyWaitForData,
        requestId);
};

FetchManager.prototype.manualAbortNonMovableRequest = function manualAbortNonMovableRequest(
    requestId) {
    
    this._requestManager.manualAbortNonMovableRequest(requestId);
};

FetchManager.prototype.reconnect = function reconnect() {
    this._fetcher.reconnect();
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

FetchManager.prototype.getLevelWidth = function getLevelWidth(numResolutionLevelsToCut) {
    this._validateSizesCalculator();
    var width = this._sizesCalculator.getLevelWidth(
        numResolutionLevelsToCut);

    return width;
};

FetchManager.prototype.getLevelHeight = function getLevelHeight(numResolutionLevelsToCut) {
    this._validateSizesCalculator();
    var height = this._sizesCalculator.getLevelHeight(
        numResolutionLevelsToCut);

    return height;
};

FetchManager.prototype.getDefaultNumResolutionLevels = function getDefaultNumResolutionLevels() {
    this._validateSizesCalculator();
    var numLevels = this._sizesCalculator.getDefaultNumResolutionLevels();
    
    return numLevels;
};
    
FetchManager.prototype._validateSizesCalculator = function validateSizesCalculator() {
    if (this._sizesCalculator !== null) {
        return;
    }
    
    this._imageParams = this.getSizesParams();
    this._sizesCalculator = this._imageImplementation.createImageParamsRetriever(
        this._imageParams);
};

function internalCallback(contextVars, requestContext) {
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
        contextVars, requestContext, maxNumQualityLayers);
}

function internalTerminatedCallback(contextVars, requestContext, isAborted) {
    if (!contextVars.isLastCallbackCalledWithoutLowQualityLayerLimit) {
        // This condition come to check if another decoding should be done.
        // One situation it may happen is when the request is not
        // progressive, then the decoding is done only on termination.
        // Another situation is when only the first stage has been reached,
        // thus the callback was called with only the first quality layer
        // (for performance reasons). Thus another decoding should be done.
        
        extractDataAndCallCallback(contextVars, requestContext);
    }
    
    contextVars.terminatedCallback.call(
        contextVars.callbackThis, isAborted);
}

function extractDataAndCallCallback(
    contextVars, requestContext, maxNumQualityLayers) {
    
    var dataForDecode = requestContext.getDataForDecode(maxNumQualityLayers);
    
    contextVars.callback.call(
        contextVars.callbackThis, dataForDecode);
}

function createServerRequestDummyResource() {
    return {};
}

return FetchManager;