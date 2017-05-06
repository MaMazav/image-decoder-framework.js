'use strict';

module.exports = WorkerProxyFetcher;

function WorkerProxyFetcher(scriptsToImport, ctorName, options) {
	this._options = options || {};
	this._internalSizesParams = null;
	this._tileWidth = 0;
	this._tileHeight = 0;

	asyncProxy.AsyncProxyFactory.initialize(this, scriptsToImport, ctorName, [options]);
}

asyncProxy.AsyncProxyFactory.addMethods(WorkerProxyFetcher, {
	close: [{isReturnPromise: true}],
	setPrioritizerType: [],
	setFetchPrioritizerData: [],
	setIsProgressiveRequest: [],
	createMovableFetch: [{isReturnPromise: true}],
	moveFetch: [],
	createRequest: [],
	manualAbortRequest: []
});

WorkerProxyFetcher.prototype.open = function open(url) {
	throw 'imageDecoderFramework error: open() should not be called on WorkerProxyFetcher; Call openInternal() instead';
};

WorkerProxyFetcher.prototype.startFetch = function startFetch(fetchContext, imagePartParams) {
    throw 'imageDecoderFramework error: startFetch() should not be called on WorkerProxyFetcher; Call createRequest() instead';
};

WorkerProxyFetcher.prototype.startMovableFetch = function startFetch(fetchContext, imagePartParams) {
    throw 'imageDecoderFramework error: startFetch() should not be called on WorkerProxyFetcher; Call createMovableFetch() instead';
};

WorkerProxyFetcher.prototype.openInternal = function openInternal(url) {
	var self = this;
	var workerHelper = asyncProxy.AsyncProxyFactory.getWorkerHelper(this);

	return workerHelper.callFunction('openInternal', [url], { isReturnPromise: true })
		.then(function(data) {
			self._internalSizesParams = data;
			self.getImageParams();
			return data;
		});
};

WorkerProxyFetcher.prototype.getImageParams = function getImageParams() {
	if (!this._internalSizesParams) {
		throw 'imageDecoderFramework error: not opened yet';
	}
	return this._internalSizesParams;
};

WorkerProxyFetcher.prototype.on = function on(event, callback) {
    var transferablePaths = this._options.transferablePathsOfDataCallback;
	var workerHelper = asyncProxy.AsyncProxyFactory.getWorkerHelper(this);
    
    var callbackWrapper = workerHelper.wrapCallback(
        callback, event + '-callback', {
            isMultipleTimeCallback: true,
            pathsToTransferables: transferablePaths
        }
    );
	
	return workerHelper.callFunction('on', [event, callbackWrapper]);
};

/*
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
        { dummyThis: 'dummyThis' },
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
};*/