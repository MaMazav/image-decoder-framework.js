'use strict';

module.exports = WorkerProxyFetchManager;

var imageHelperFunctions = require('imagehelperfunctions.js');
var sendImageParametersToMaster = require('sendimageparameterstomaster.js');

function WorkerProxyFetchManager(imageImplementationClassName, options) {
    this._imageWidth = null;
    this._imageHeight = null;
    this._sizesParams = null;
    this._currentStatusCallbackWrapper = null;
    
    var ctorArgs = [options];
    
    this._imageImplementation = imageHelperFunctions.getImageImplementation(imageImplementationClassName);

    var scriptsToImport = imageHelperFunctions.getScriptsForWorkerImport(
        this._imageImplementation, options);
    scriptsToImport = scriptsToImport.concat([sendImageParametersToMaster.getScriptUrl()]);
    
    this._workerHelper = new AsyncProxy.AsyncProxyMaster(
        scriptsToImport, 'FetchManager', ctorArgs);
    
    var boundUserDataHandler = this._userDataHandler.bind(this);
    this._workerHelper.setUserDataHandler(boundUserDataHandler);
}

WorkerProxyFetchManager.prototype.setStatusCallback = function setStatusCallback(statusCallback) {
    if (this._currentStatusCallbackWrapper !== null) {
        this._workerHelper.freeCallback(this._currentStatusCallbackWrapper);
    }
    
    var callbackWrapper = this._workerHelper.wrapCallbackFromMasterSide(
        statusCallback, 'statusCallback', /*isMultipleTimeCallback=*/true);
    
    this._currentStatusCallbackWrapper = callbackWrapper;
    this._workerHelper.callFunction('setStatusCallback', [callbackWrapper]);
};

WorkerProxyFetchManager.prototype.open = function open(url) {
    this._workerHelper.callFunction('open', [url]);
};

WorkerProxyFetchManager.prototype.close = function close(closedCallback) {
    var self = this;
    
    var callbackWrapper = this._workerHelper.wrapCallbackFromMasterSide(
        internalClosedCallback, 'closedCallback');
        
    this._workerHelper.callFunction('close', [callbackWrapper]);
    
    function internalClosedCallback() {
        self._workerHelper.terminate();
        
        if (closedCallback !== undefined) {
            closedCallback();
        }
    }
};

WorkerProxyFetchManager.prototype.createChannel = function createChannel(
    createdCallback) {
    
    var callbackWrapper = this._workerHelper.wrapCallbackFromMasterSide(
        createdCallback,
        'FetchManager_createChannelCallback');
    
    var args = [callbackWrapper];
    this._workerHelper.callFunction('createChannel', args);
};

WorkerProxyFetchManager.prototype.moveChannel = function moveChannel(
    channelHandle, imagePartParams) {
    
    var args = [channelHandle, imagePartParams];
    this._workerHelper.callFunction('moveChannel', args);
};

WorkerProxyFetchManager.prototype.createRequest = function createRequest(
    fetchParams,
    callbackThis,
    callback,
    terminatedCallback,
    isOnlyWaitForData,
    requestId) {
    
    //var pathToArrayInPacketsData = [0, 'data', 'buffer'];
    //var pathToHeadersCodestream = [1, 'codestream', 'buffer'];
    //var transferablePaths = [
    //    pathToArrayInPacketsData,
    //    pathToHeadersCodestream
    //];
    
    var transferablePaths = this._imageImplementation.getTransferablePathsOfRequestCallback();
    
    var internalCallbackWrapper =
        this._workerHelper.wrapCallbackFromMasterSide(
            callback.bind(callbackThis),
            'requestTilesProgressiveCallback',
            /*isMultipleTimeCallback=*/true,
            transferablePaths);
    
    var internalTerminatedCallbackWrapper =
        this._workerHelper.wrapCallbackFromMasterSide(
            internalTerminatedCallback,
            'requestTilesProgressiveTerminatedCallback',
            /*isMultipleTimeCallback=*/false);
            
    var args = [
        fetchParams,
        /*callbackThis=*/{ dummyThis: 'dummyThis' },
        internalCallbackWrapper,
        internalTerminatedCallbackWrapper,
        isOnlyWaitForData,
        requestId];
        
    var self = this;
    
    this._workerHelper.callFunction('createRequest', args);
    
    function internalTerminatedCallback(isAborted) {
        self._workerHelper.freeCallback(internalCallbackWrapper);
        terminatedCallback.call(callbackThis, isAborted);
    }
};

WorkerProxyFetchManager.prototype.manualAbortRequest = function manualAbortRequest(
    requestId) {
    
    var args = [requestId];
    this._workerHelper.callFunction(
        'manualAbortRequest', args);
};

WorkerProxyFetchManager.prototype.setIsProgressiveRequest = function setIsProgressiveRequest(
    requestId, isProgressive) {
    
    var args = [requestId, isProgressive];
    this._workerHelper.callFunction('setIsProgressiveRequest', args);
};

WorkerProxyFetchManager.prototype.setServerRequestPrioritizerData =
    function setServerRequestPrioritizerData(prioritizerData) {
    
    this._workerHelper.callFunction(
        'setServerRequestPrioritizerData',
        [ prioritizerData ],
        { isSendImmediately: true });
};

WorkerProxyFetchManager.prototype.reconnect = function reconnect() {
    this._workerHelper.callFunction('reconnect');
};

WorkerProxyFetchManager.prototype.getSizesParams = function getSizesParams() {
    if (this._sizesParams === null) {
        throw 'Image is not ready yet';
    }
    
    return this._sizesParams;
};

WorkerProxyFetchManager.prototype._userDataHandler = function userDataHandler(sizesParams) {
    this._sizesParams = sizesParams;
};