'use strict';

module.exports = WorkerProxyImageDecoder;

var imageHelperFunctions = require('imagehelperfunctions.js');
var sendImageParametersToMaster = require('sendimageparameterstomaster.js');
var createImageDecoderSlaveSide = require('createimagedecoderonslaveside.js');
var ImageParamsRetrieverProxy = require('imageparamsretrieverproxy.js');

function WorkerProxyImageDecoder(imageImplementationClassName, options) {
    ImageParamsRetrieverProxy.call(this);

    this._imageWidth = null;
    this._imageHeight = null;
    this._tileWidth = 0;
    this._tileHeight = 0;
    
    var optionsInternal = imageHelperFunctions.createInternalOptions(imageImplementationClassName, options);
    var ctorArgs = [imageImplementationClassName, optionsInternal];
    
    var scriptsToImport = imageHelperFunctions.getScriptsForWorkerImport(
        this._imageImplementation, options);
    scriptsToImport = scriptsToImport.concat([
        sendImageParametersToMaster.getScriptUrl(),
        createImageDecoderSlaveSide.getScriptUrl()]);

    this._workerHelper = new AsyncProxy.AsyncProxyMaster(
        scriptsToImport, 'imageDecoderFramework.ImageDecoder', ctorArgs);
    
    var boundImageOpened = this._imageOpened.bind(this);
    this._workerHelper.setUserDataHandler(boundImageOpened);
}

WorkerProxyImageDecoder.prototype = Object.create(ImageParamsRetrieverProxy.prototype);

WorkerProxyImageDecoder.prototype.getTileWidth = function getTileWidth() {
    this.getImageParams();
    return this._tileWidth;
};

WorkerProxyImageDecoder.prototype.getTileHeight = function getTileHeight() {
    this.getImageParams();
    return this._tileHeight;
};

WorkerProxyImageDecoder.prototype.open = function open(url) {
    var self = this;
    return this._workerHelper.callFunction('open', [url], { isReturnPromise: true })
        .then(function(imageParams) {
            self._imageOpened(imageParams);
            return imageParams;
        });
};

WorkerProxyImageDecoder.prototype.close = function close() {
    return this._workerHelper.callFunction('close', [], { isReturnPromise: true });
};

WorkerProxyImageDecoder.prototype.createChannel = function createChannel() {
    this._workerHelper.callFunction(
        'createChannel', [], { isReturnPromise: true });
};

WorkerProxyImageDecoder.prototype.requestPixels = function requestPixels(imagePartParams) {
    var pathToPixelsArray = ['data', 'buffer'];
    var transferables = [pathToPixelsArray];
    
    var args = [imagePartParams];
    
    this._workerHelper.callFunction('requestPixels', args, {
        isReturnPromise: true,
        pathsToTransferablesInPromiseResult: transferables
    });
};

WorkerProxyImageDecoder.prototype.requestPixelsProgressive = function requestPixelsProgressive(
    imagePartParams,
    callback,
    terminatedCallback,
    imagePartParamsNotNeeded,
    channelHandle) {
    
    var transferables;
    
    // NOTE: Cannot pass it as transferables because it is passed to all
    // listener callbacks, thus after the first one the buffer is not valid
    
    //var pathToPixelsArray = [0, 'pixels', 'buffer'];
    //transferables = [pathToPixelsArray];
    
    var internalCallbackWrapper =
        this._workerHelper.wrapCallback(
            callback, 'requestPixelsProgressiveCallback', {
                isMultipleTimeCallback: true,
                pathsToTransferables: transferables
            }
        );
    
    var internalTerminatedCallbackWrapper =
        this._workerHelper.wrapCallback(
            internalTerminatedCallback, 'requestPixelsProgressiveTerminatedCallback', {
                isMultipleTimeCallback: false
            }
        );
            
    var args = [
        imagePartParams,
        internalCallbackWrapper,
        internalTerminatedCallbackWrapper,
        imagePartParamsNotNeeded,
        channelHandle];
    
    this._workerHelper.callFunction('requestPixelsProgressive', args);
        
    var self = this;
    
    function internalTerminatedCallback(isAborted) {
        self._workerHelper.freeCallback(internalCallbackWrapper);
        
        terminatedCallback(isAborted);
    }
};

WorkerProxyImageDecoder.prototype.setServerRequestPrioritizerData =
    function setServerRequestPrioritizerData(prioritizerData) {
    
    this._workerHelper.callFunction(
        'setServerRequestPrioritizerData',
        [ prioritizerData ],
        { isSendImmediately: true });
};

WorkerProxyImageDecoder.prototype.setDecodePrioritizerData =
    function setDecodePrioritizerData(prioritizerData) {
    
    this._workerHelper.callFunction(
        'setDecodePrioritizerData',
        [ prioritizerData ],
        { isSendImmediately: true });
};

WorkerProxyImageDecoder.prototype.reconnect = function reconnect() {
    this._workerHelper.callFunction('reconnect');
};

WorkerProxyImageDecoder.prototype.alignParamsToTilesAndLevel = function alignParamsToTilesAndLevel(region) {
	return imageHelperFunctions.alignParamsToTilesAndLevel(region, this);
};

WorkerProxyImageDecoder.prototype._imageOpened = function imageOpened(data) {
    this._internalSizesParams = data.sizesParams;
    this._tileWidth = data.applicativeTileWidth;
    this._tileHeight = data.applicativeTileHeight;
    this.getImageParams();
};

WorkerProxyImageDecoder.prototype._getImageParamsInternal = function getImageParamsInternal() {
    return this._internalSizesParams;
};