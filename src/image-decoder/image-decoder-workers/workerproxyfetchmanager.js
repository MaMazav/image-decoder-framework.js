'use strict';

module.exports = WorkerProxyFetchManager;

var imageHelperFunctions = require('image-helper-functions.js');
var sendImageParametersToMaster = require('sendimageparameterstomaster.js');
var ImageParamsRetrieverProxy = require('image-params-retriever-proxy.js');

function WorkerProxyFetchManager(options) {
    ImageParamsRetrieverProxy.call(this);

    this._imageWidth = null;
    this._imageHeight = null;
    this._internalSizesParams = null;
    this._options = options;
    
    var ctorArgs = [options];
    var scriptsToImport = options.scriptsToImport.concat([sendImageParametersToMaster.getScriptUrl()]);
    
    this._workerHelper = new AsyncProxy.AsyncProxyMaster(
        scriptsToImport, 'imageDecoderFramework.FetchManager', ctorArgs);
    
    var boundUserDataHandler = this._userDataHandler.bind(this);
    this._workerHelper.setUserDataHandler(boundUserDataHandler);
}

WorkerProxyFetchManager.prototype = Object.create(ImageParamsRetrieverProxy.prototype);

WorkerProxyFetchManager.prototype.open = function open(dataCallback, url) {
    return this._workerHelper.callFunction('open', [url], { isReturnPromise: true });
};

WorkerProxyFetchManager.prototype.close = function close() {
    var self = this;
    return this._workerHelper
        .callFunction('close', [], { isReturnPromise: true })
        .then(function() {
            self._workerHelper.terminate();
        });
};

WorkerProxyFetchManager.prototype.on = function on(event, callback) {
    var transferablePaths = this._options.transferablePathsOfDataCallback;
    
    var callbackWrapper = this._workerHelper.wrapCallback(
        callback, event + '-callback', {
            isMultipleTimeCallback: true,
            pathsToTransferables: transferablePaths
        }
    );

    this._fetcher.on(event, callbackWrapper);
};

WorkerProxyFetchManager.prototype.createChannel = function createChannel() {
    return this._workerHelper.callFunction(
        'createChannel', [], { isReturnPromise: true });
};

WorkerProxyFetchManager.prototype.moveChannel = function moveChannel(
    channelHandle, imagePartParams) {
    
    var args = [channelHandle, imagePartParams];
    this._workerHelper.callFunction('moveChannel', args);
};

WorkerProxyFetchManager.prototype.createRequest = function createRequest(
    fetchParams,
    callbackThis,
    terminatedCallback,
    isOnlyWaitForData,
    requestId) {
    
    var internalTerminatedCallbackWrapper =
        this._workerHelper.wrapCallback(
            internalTerminatedCallback, 'requestTilesProgressiveTerminatedCallback', {
                isMultipleTimeCallback: false
            }
        );
            
    var args = [
        fetchParams,
        /*callbackThis=*/{ dummyThis: 'dummyThis' },
        internalTerminatedCallbackWrapper,
        isOnlyWaitForData,
        requestId];
        
    var self = this;
    
    this._workerHelper.callFunction('createRequest', args);
    
    function internalTerminatedCallback(isAborted) {
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

WorkerProxyFetchManager.prototype._getImageParamsInternal = function getImageParamsInternal() {
    return this._internalSizesParams;
};

WorkerProxyFetchManager.prototype._userDataHandler = function userDataHandler(data) {
    this._internalSizesParams = data.sizesParams;
};