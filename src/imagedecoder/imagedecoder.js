'use strict';

module.exports = ImageDecoder;

var WorkerProxyFetchManager = require('workerproxyfetchmanager.js');
var imageHelperFunctions = require('imageHelperFunctions.js');
var DecodeJobsPool = require('decodejobspool.js');
var WorkerProxyPixelsDecoder = require('workerproxypixelsdecoder.js');

/* global console: false */
/* global Promise: false */

function ImageDecoder(imageImplementationClassName, options) {
    this._options = options || {};
    var decodeWorkersLimit = this._options.workersLimit || 5;
    
    this._tileWidth = this._options.tileWidth || 256;
    this._tileHeight = this._options.tileHeight || 256;
    this._showLog = !!this._options.showLog;
    
    /*if (this._showLog) {
        // Old IE
        throw 'showLog is not supported on this browser';
    }*/

    this._sizesParams = null;
    this._sizesCalculator = null;
    this._channelStates = [];
    this._decoders = [];
    this._imageImplementationClassName = imageImplementationClassName;
    this._imageImplementation = imageHelperFunctions.getImageImplementation(imageImplementationClassName);

	var optionsFetchManager = imageHelperFunctions.createInternalOptions(imageImplementationClassName, this._options);
    this._fetchManager = new WorkerProxyFetchManager(optionsFetchManager);
    
    var decodeScheduler = imageHelperFunctions.createScheduler(
        this._showLog,
        this._options.decodePrioritizer,
        'decode',
        this._createDecoder.bind(this),
        decodeWorkersLimit);
    
    this._decodePrioritizer = decodeScheduler.prioritizer;

    this._requestsDecodeJobsPool = new DecodeJobsPool(
        this._fetchManager,
        decodeScheduler.scheduler,
        this._tileWidth,
        this._tileHeight,
        /*onlyWaitForDataAndDecode=*/false);
        
    this._channelsDecodeJobsPool = new DecodeJobsPool(
        this._fetchManager,
        decodeScheduler.scheduler,
        this._tileWidth,
        this._tileHeight,
        /*onlyWaitForDataAndDecode=*/true);
}

ImageDecoder.prototype.setStatusCallback = function setStatusCallback(statusCallback) {
    this._statusCallback = statusCallback;
    this._fetchManager.setStatusCallback(statusCallback);
};
    
ImageDecoder.prototype.setServerRequestPrioritizerData =
    function setServerRequestPrioritizerData(prioritizerData) {
    
    this._fetchManager.setServerRequestPrioritizerData(
        prioritizerData);
};

ImageDecoder.prototype.setDecodePrioritizerData =
    function setDecodePrioritizerData(prioritizerData) {
    
    if (this._decodePrioritizer === null) {
        throw 'No decode prioritizer has been set';
    }
    
    if (this._showLog) {
        console.log('setDecodePrioritizerData(' + prioritizerData + ')');
    }
    
    var prioritizerDataModified = Object.create(prioritizerData);
    prioritizerDataModified.image = this;
    
    this._decodePrioritizer.setPrioritizerData(prioritizerDataModified);
};

ImageDecoder.prototype.open = function open(url) {
    this._fetchManager.open(url);
};

ImageDecoder.prototype.close = function close(closedCallback) {
    for (var i = 0; i < this._decoders.length; ++i) {
        this._decoders[i].terminate();
    }

    this._fetchManager.close(closedCallback);
};

ImageDecoder.prototype.getLevelWidth = function getLevelWidth(numResolutionLevelsToCut) {
    validateSizesCalculator(this);
    var width = this._sizesCalculator.getLevelWidth(
        numResolutionLevelsToCut);

    return width;
};

ImageDecoder.prototype.getLevelHeight = function getLevelHeight(numResolutionLevelsToCut) {
    validateSizesCalculator(this);
    var height = this._sizesCalculator.getLevelHeight(
        numResolutionLevelsToCut);

    return height;
};

ImageDecoder.prototype.getTileWidth = function getTileWidth() {
    validateSizesCalculator(this);
    return this._tileWidth;
};

ImageDecoder.prototype.getTileHeight = function getTileHeight() {
    validateSizesCalculator(this);
    return this._tileHeight;
};

ImageDecoder.prototype.getDefaultNumResolutionLevels = function getDefaultNumResolutionLevels() {
    validateSizesCalculator(this);
    var numLevels = this._sizesCalculator.getDefaultNumResolutionLevels();
    
    return numLevels;
};

ImageDecoder.prototype.getDefaultNumQualityLayers = function getDefaultNumQualityLayers() {
    validateSizesCalculator(this);
    var numLayers = this._sizesCalculator.getDefaultNumQualityLayers();
    
    return numLayers;
};

ImageDecoder.prototype.createChannel = function createChannel(
    createdCallback) {
    
    validateSizesCalculator(this);
    
    var self = this;
    
    function channelCreated(channelHandle) {
        self._channelStates[channelHandle] = {
            decodeJobsListenerHandle: null
        };
        
        createdCallback(channelHandle);
    }
    
    this._fetchManager.createChannel(
        channelCreated);
};

ImageDecoder.prototype.requestPixels = function requestPixels(imagePartParams) {
    validateSizesCalculator(this);
    
    var level = imagePartParams.numResolutionLevelsToCut;
    var levelWidth = this._sizesCalculator.getLevelWidth(level);
    var levelHeight = this._sizesCalculator.getLevelHeight(level);
    
    var resolve, reject;
    var accumulatedResult = {};
    
    var self = this;
    var promise = new Promise(startPromise);
    return promise;
    
    function startPromise(resolve_, reject_) {
        resolve = resolve_;
        reject = reject_;
        
        self._requestsDecodeJobsPool.forkDecodeJobs(
            imagePartParams,
            internalCallback,
            internalTerminatedCallback,
            levelWidth,
            levelHeight,
            /*isProgressive=*/false);
    }
    
    function internalCallback(decodedData) {
        copyPixelsToAccumulatedResult(decodedData, accumulatedResult);
    }
    
    function internalTerminatedCallback(isAborted) {
        if (isAborted) {
            reject('Request was aborted due to failure or priority');
        } else {
            resolve(accumulatedResult);
        }
    }
};

ImageDecoder.prototype.requestPixelsProgressive = function requestPixelsProgressive(
    imagePartParams,
    callback,
    terminatedCallback,
    imagePartParamsNotNeeded,
    channelHandle) {
    
    validateSizesCalculator(this);
    
    var level = imagePartParams.numResolutionLevelsToCut;
    var levelWidth = this._sizesCalculator.getLevelWidth(level);
    var levelHeight = this._sizesCalculator.getLevelHeight(level);
    
    var channelState = null;
    var decodeJobsPool;
    if (channelHandle === undefined) {
        decodeJobsPool = this._requestsDecodeJobsPool;
    } else {
        decodeJobsPool = this._channelsDecodeJobsPool;
        
        channelState = this._channelStates[channelHandle];
        
        if (channelState === undefined) {
            throw 'Channel handle does not exist';
        }
    }
    
    var listenerHandle = decodeJobsPool.forkDecodeJobs(
        imagePartParams,
        callback,
        terminatedCallback,
        levelWidth,
        levelHeight,
        /*isProgressive=*/true,
        imagePartParamsNotNeeded);
        
    if (channelHandle !== undefined) {
        if (channelState.decodeJobsListenerHandle !== null) {
			// Unregister after forked new jobs, so no termination occurs meanwhile
			decodeJobsPool.unregisterForkedJobs(
				channelState.decodeJobsListenerHandle);
		}
        channelState.decodeJobsListenerHandle = listenerHandle;
        this._fetchManager.moveChannel(channelHandle, imagePartParams);
    }
};

ImageDecoder.prototype.reconnect = function reconnect() {
    this._fetchManager.reconnect();
};

ImageDecoder.prototype._getSizesCalculator = function getSizesCalculator() {
    validateSizesCalculator(this);
    
    return this._sizesCalculator;
};

ImageDecoder.prototype._getSizesParams = function getSizesParams() {
    if (this._sizesParams === null) {
        this._sizesParams = {
            imageParams: this._fetchManager.getSizesParams(),
            applicativeTileWidth: this._tileWidth,
            applicativeTileHeight:  this._tileHeight
        };
    }
    
    return this._sizesParams;
};

ImageDecoder.prototype._createDecoder = function createDecoder() {
    var decoder = new WorkerProxyPixelsDecoder(this._options);
    this._decoders.push(decoder);
    
    return decoder;
};

function validateSizesCalculator(self) {
    if (self._sizesCalculator !== null) {
        return;
    }
    
    var sizesParams = self._getSizesParams();
    self._sizesCalculator = self._imageImplementation.createImageParamsRetriever(
        sizesParams.imageParams);
}

function copyPixelsToAccumulatedResult(decodedData, accumulatedResult) {
    var bytesPerPixel = 4;
    var sourceStride = decodedData.width * bytesPerPixel;
    var targetStride =
        decodedData.originalRequestWidth * bytesPerPixel;
    
    if (accumulatedResult.pixels === undefined) {
        var size =
            targetStride * decodedData.originalRequestHeight;
            
        accumulatedResult.pixels = new Uint8Array(size);
        accumulatedResult.xInOriginalRequest = 0;
        accumulatedResult.yInOriginalRequest = 0;
        
        var width = decodedData.originalRequestWidth;
        accumulatedResult.originalRequestWidth = width;
        accumulatedResult.width = width;

        var height = decodedData.originalRequestHeight;
        accumulatedResult.originalRequestHeight = height;
        accumulatedResult.height = height;
    }
    
    accumulatedResult.allRelevantBytesLoaded =
        decodedData.allRelevantBytesLoaded;

    var sourceOffset = 0;
    var targetOffset =
        decodedData.xInOriginalRequest * bytesPerPixel + 
        decodedData.yInOriginalRequest * targetStride;
    
    for (var i = 0; i < decodedData.height; ++i) {
        var sourceSubArray = decodedData.pixels.subarray(
            sourceOffset, sourceOffset + sourceStride);
        
        accumulatedResult.pixels.set(sourceSubArray, targetOffset);
        
        sourceOffset += sourceStride;
        targetOffset += targetStride;
    }
}