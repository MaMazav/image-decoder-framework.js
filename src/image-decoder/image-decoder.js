'use strict';

module.exports = ImageDecoder;

var imageHelperFunctions = require('image-helper-functions.js');
var DecodeJobsPool = require('decode-jobs-pool.js');
var ImageParamsRetrieverProxy = require('image-params-retriever-proxy.js');
var FetchManager = require('fetch-manager.js');
var WorkerProxyFetchManager = require('worker-proxy-fetch-manager.js');
var WorkerProxyImageDecoder = require('worker-proxy-image-decoder.js');

/* global console: false */
/* global Promise: false */

ImageDecoder.alignParamsToTilesAndLevel = imageHelperFunctions.alignParamsToTilesAndLevel;

ImageDecoder.fromImage = function fromImage(image, options) {
    var isIndirectCreationNeeded = imageHelperFunctions.isIndirectCreationNeeded(
        image, 'image', ImageDecoder._imageExpectedMethods);
    
    if (!isIndirectCreationNeeded || !image.useWorker) {
        return new ImageDecoder(image, options);
    } else {
        return new WorkerProxyImageDecoder(image, options);
    }
};

ImageDecoder._imageExpectedMethods = ['opened', 'getLevelCalculator', 'getFetcher', 'getDecoderWorkersInputRetreiver'];

function ImageDecoder(image, options) {
    ImageParamsRetrieverProxy.call(this);
    
    this._options = options || {};
    this._decodeWorkersLimit = this._options.decodeWorkersLimit || 5;
    
    this._tileWidth = this._options.tileWidth || 256;
    this._tileHeight = this._options.tileHeight || 256;
    this._showLog = !!this._options.showLog;
    this._fetchManager = null;
    this._decodeDependencyWorkers = null;
    this._requestsDecodeJobsPool = null;
    this._movablesDecodeJobsPool = null;
    this._levelCalculator = null;
    this._fetchRequestId = 0;
    
    /*if (this._showLog) {
        // Old IE
        throw 'imageDecoderFramework error: showLog is not supported on this browser';
    }*/

    this._movableStates = [];
    this._decoders = [];
    
    this._decodeScheduler = null;
    this._decodePrioritizer = null;
    this._prioritizerType = null;

    this._image = imageHelperFunctions.getOrCreateInstance(
        image, 'image', ImageDecoder._imageExpectedMethods);
}

ImageDecoder.prototype = Object.create(ImageParamsRetrieverProxy.prototype);

ImageDecoder.prototype.getTileWidth = function getTileWidth() {
    return this._tileWidth;
};

ImageDecoder.prototype.getTileHeight = function getTileHeight() {
    return this._tileHeight;
};
    
ImageDecoder.prototype.setFetchPrioritizerData =
    function setFetchPrioritizerData(prioritizerData) {

    this._validateFetcher();
    
    this._fetchManager.setFetchPrioritizerData(
        prioritizerData);
};

ImageDecoder.prototype.setDecodePrioritizerData =
    function setDecodePrioritizerData(prioritizerData) {

    this._validateDecoder();
    
    if (this._decodePrioritizer === null) {
        throw 'imageDecoderFramework error: No decode prioritizer has been set';
    }
    
    if (this._showLog) {
        console.log('setDecodePrioritizerData(' + prioritizerData + ')');
    }
    
    var prioritizerDataModified = Object.create(prioritizerData);
    prioritizerDataModified.image = this;
    
    this._decodePrioritizer.setPrioritizerData(prioritizerDataModified);
};

ImageDecoder.prototype.setDecodePrioritizerType = function setPrioritizerType(prioritizerType) {
    if (this._decodeScheduler !== null) {
        throw 'imageDecoderFramework error: Cannot set prioritizer type at this time';
    }
    
    this._prioritizerType = prioritizerType;
};

ImageDecoder.prototype.setFetchPrioritizerType = function setPrioritizerType(prioritizerType) {
    this._validateFetcher();
    this._fetchManager.setPrioritizerType(prioritizerType);
};

ImageDecoder.prototype.open = function open(url) {
    this._validateFetcher();

    var self = this;
    var promise = this._fetchManager.open(url);
    return promise.then(function (sizesParams) {
        self._internalSizesParams = sizesParams;
        self._image.opened(self);
        self._levelCalculator = self._image.getLevelCalculator();
        imageHelperFunctions.ensureLevelCalculator(self._levelCalculator);
        return {
            sizesParams: sizesParams,
            applicativeTileWidth : self.getTileWidth(),
            applicativeTileHeight: self.getTileHeight()
        };
    });
};

ImageDecoder.prototype.close = function close() {
    this._validateFetcher();
    this._validateDecoder();
    
    for (var i = 0; i < this._decoders.length; ++i) {
        this._decoders[i].terminate();
    }

    var self = this;
    return this._fetchManager.close().then(function() {
        self._decodeDependencyWorkers.terminateInactiveWorkers();
    });
};

ImageDecoder.prototype.onFetcherEvent = function onFetcherEvent(event, callback) {
    this._validateFetcher();
    this._fetchManager.on(event, callback);
};

ImageDecoder.prototype.createMovableFetch = function createMovableFetch() {
    this._validateFetcher();
    this.getImageParams();
    
    var self = this;
    
    return this._fetchManager.createMovableFetch().then(function(movableHandle) {
        self._movableStates[movableHandle] = {
            decodeJobsListenerHandle: null
        };
        
        return movableHandle;
    });
};

ImageDecoder.prototype.requestPixels = function requestPixels(imagePartParams) {
    this._validateDecoder();
    this.getImageParams();
    
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
            internalTerminatedCallback);
    }
    
    function internalCallback(decodedData) {
        self._copyPixelsToAccumulatedResult(decodedData, accumulatedResult);
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
    movableHandle) {
    
    this._validateDecoder();
    this.getImageParams();
    
    var movableState = null;
    var decodeJobsPool;
    if (movableHandle === undefined) {
        decodeJobsPool = this._requestsDecodeJobsPool;
    } else {
        decodeJobsPool = this._movablesDecodeJobsPool;
        
        movableState = this._movableStates[movableHandle];
        
        if (movableState === undefined) {
            throw 'imageDecoderFramework error: Movable handle does not exist';
        }
    }
    
    var listenerHandle = decodeJobsPool.forkDecodeJobs(
        imagePartParams,
        callback,
        terminatedCallback || function() { },
        imagePartParamsNotNeeded);
        
    if (movableHandle !== undefined) {
        if (movableState.decodeJobsListenerHandle !== null) {
            // Unregister after forked new jobs, so no termination occurs meanwhile
            decodeJobsPool.unregisterForkedJobs(
                movableState.decodeJobsListenerHandle);
        }
        movableState.decodeJobsListenerHandle = listenerHandle;
        this._fetchManager.moveFetch(movableHandle, imagePartParams);
    } else {
        this._fetchManager.createRequest(++this._fetchRequestId, imagePartParams);
    }
};

ImageDecoder.prototype.getLevelCalculator = function getLevelCalculator() {
    return this._levelCalculator;
};

// Internal Methods

ImageDecoder.prototype._validateFetcher = function validateFetcher() {
    if (this._fetchManager !== null) {
        return;
    }

    var fetcher = this._image.getFetcher();
    var isIndirectCreationNeeded = imageHelperFunctions.isIndirectCreationNeeded(
        fetcher, 'fetcher', FetchManager.fetcherExpectedMethods);
    
    if (!isIndirectCreationNeeded || !fetcher.useWorker) {
        this._fetchManager = new FetchManager(fetcher, this._options);
    } else {
        this._fetchManager = new WorkerProxyFetchManager(
            fetcher, this._options);
    }
};

ImageDecoder.prototype._validateDecoder = function validateComponents() {
    if (this._decodeDependencyWorkers !== null) {
        return;
    }
    
    var decodeScheduling = imageHelperFunctions.createPrioritizer(
        this._decodeWorkersLimit,
        this._prioritizerType,
        'decode',
        this._showLog);
    
    if (decodeScheduling.prioritizer !== null) {
        this._decodeScheduler = new dependencyWorkers.DependencyWorkersTaskScheduler(
            this._decodeWorkersLimit, decodeScheduling.schedulerOptions);
        this._decodePrioritizer = decodeScheduling.prioritizer;
    } else {
        this._decodeScheduler = new resourceScheduler.LifoScheduler(
            createDummyResource,
            this._decodeWorkersLimit,
            decodeScheduling.schedulerOptions);
        this._decodePrioritizer = null;
    }

    var inputRetreiver = this._image.getDecoderWorkersInputRetreiver();
    this._decodeDependencyWorkers = new dependencyWorkers.SchedulerDependencyWorkers(
        this._decodeScheduler, inputRetreiver);
    
    this._requestsDecodeJobsPool = new DecodeJobsPool(
        this._decodeDependencyWorkers,
        this._decodePrioritizer,
        this._tileWidth,
        this._tileHeight);
        
    this._movablesDecodeJobsPool = new DecodeJobsPool(
        this._decodeDependencyWorkers,
        this._decodePrioritizer,
        this._tileWidth,
        this._tileHeight);
};

ImageDecoder.prototype._getImageParamsInternal = function getImageParamsInternal() {
    return this._internalSizesParams;
};

ImageDecoder.prototype._copyPixelsToAccumulatedResult =
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
};

function createDummyResource()
{
}