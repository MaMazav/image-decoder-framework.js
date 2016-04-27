'use strict';

module.exports = WorkerProxyImageDecoder;

var imageHelperFunctions = require('imagehelperfunctions.js');
var sendImageParametersToMaster = require('sendimageparameterstomaster.js');
var createImageDecoderSlaveSide = require('createimagedecoderonslaveside.js');

function WorkerProxyImageDecoder(imageImplementationClassName, options) {
    this._imageWidth = null;
    this._imageHeight = null;
    this._sizesParams = null;
    this._tileWidth = 0;
    this._tileHeight = 0;
    this._currentStatusCallbackWrapper = null;
	this._sizesCalculator = null;
    
	var optionsInternal = imageHelperFunctions.createInternalOptions(imageImplementationClassName, options);
    var ctorArgs = [imageImplementationClassName, optionsInternal];

    this._imageImplementation = imageHelperFunctions.getImageImplementation(imageImplementationClassName);
    
    var scriptsToImport = imageHelperFunctions.getScriptsForWorkerImport(
        this._imageImplementation, options);
    scriptsToImport = scriptsToImport.concat([
        sendImageParametersToMaster.getScriptUrl(),
        createImageDecoderSlaveSide.getScriptUrl()]);

    this._workerHelper = new AsyncProxy.AsyncProxyMaster(
        scriptsToImport, 'imageDecoderFramework.ImageDecoder', ctorArgs);
    
    var boundUserDataHandler = this._userDataHandler.bind(this);
    this._workerHelper.setUserDataHandler(boundUserDataHandler);
}

WorkerProxyImageDecoder.prototype.setStatusCallback = function setStatusCallback(statusCallback) {
    if (this._currentStatusCallbackWrapper !== null) {
        this._workerHelper.freeCallback(this._currentStatusCallbackWrapper);
    }
    
    var callbackWrapper = this._workerHelper.wrapCallback(
        statusCallback, 'statusCallback', { isMultipleTimeCallback: true });
    
    this._currentStatusCallbackWrapper = callbackWrapper;
    this._workerHelper.callFunction('setStatusCallback', [callbackWrapper]);
};

WorkerProxyImageDecoder.prototype.open = function open(url) {
    this._workerHelper.callFunction('open', [url]);
};

WorkerProxyImageDecoder.prototype.close = function close(closedCallback) {
    var self = this;
    
    var callbackWrapper = this._workerHelper.wrapCallback(
        internalClosedCallback, 'closedCallback');
        
    this._workerHelper.callFunction('close', [callbackWrapper]);
    
    function internalClosedCallback() {
        self._workerHelper.terminate();
        
        if (closedCallback !== undefined) {
            closedCallback();
        }
    }
};

WorkerProxyImageDecoder.prototype.getLevelWidth = function getLevelWidth(numResolutionLevelsToCut) {
    if (this._sizesCalculator === null) {
        throw 'Image is not ready yet';
    }

    var width = this._sizesCalculator.getLevelWidth(
        numResolutionLevelsToCut);
    return width;
};

WorkerProxyImageDecoder.prototype.getLevelHeight = function getLevelHeight(numResolutionLevelsToCut) {
    if (this._sizesCalculator === null) {
        throw 'Image is not ready yet';
    }
    
    var height = this._sizesCalculator.getLevelHeight(
        numResolutionLevelsToCut);
    return height;
};

WorkerProxyImageDecoder.prototype.getTileWidth = function getTileWidth() {
    if (this._tileWidth === 0) {
        throw 'Image is not ready yet';
    }

    return this._tileWidth;
};

WorkerProxyImageDecoder.prototype.getTileHeight = function getTileHeight() {
    if (this._tileHeight === 0) {
        throw 'Image is not ready yet';
    }

    return this._tileHeight;
};

WorkerProxyImageDecoder.prototype.getDefaultNumResolutionLevels = function getDefaultNumResolutionLevels() {
    if (this._sizesCalculator === null) {
        throw 'Image is not ready yet';
    }
    
    var numLevels = this._sizesCalculator.getDefaultNumResolutionLevels();
    return numLevels;
};

WorkerProxyImageDecoder.prototype.getDefaultNumQualityLayers = function getDefaultNumQualityLayers() {
    if (this._sizesCalculator === null) {
        throw 'Image is not ready yet';
    }
    
    var numLayers = this._sizesCalculator.getDefaultNumQualityLayers();
    return numLayers;
};

WorkerProxyImageDecoder.prototype.createChannel = function createChannel(
    createdCallback) {
    
    var callbackWrapper = this._workerHelper.wrapCallback(
        createdCallback, 'ImageDecoder_createChannelCallback');
    
    var args = [callbackWrapper];
    this._workerHelper.callFunction('createChannel', args);
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

WorkerProxyImageDecoder.prototype._getSizesCalculator = function getSizesCalculator() {
    if (this._sizesCalculator === null) {
        throw 'Image is not ready yet';
    }
    
    return this._sizesCalculator;
};

WorkerProxyImageDecoder.prototype._getSizesParams = function getSizesParams() {
    if (this._sizesParams === null) {
        throw 'Image is not ready yet';
    }
    
    return this._sizesParams;
};

WorkerProxyImageDecoder.prototype._userDataHandler = function userDataHandler(sizesParams) {
    this._sizesParams = sizesParams;
    this._tileWidth = sizesParams.applicativeTileWidth;
    this._tileHeight = sizesParams.applicativeTileHeight;
    this._sizesCalculator = this._imageImplementation.createImageParamsRetriever(
        sizesParams.imageParams);
};