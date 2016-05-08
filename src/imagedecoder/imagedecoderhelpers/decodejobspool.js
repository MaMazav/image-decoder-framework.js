'use strict';

module.exports = DecodeJobsPool;

var DecodeJob = require('decodejob.js');

function DecodeJobsPool(
    fetchManager,
    decodeScheduler,
    tileWidth,
    tileHeight,
    onlyWaitForDataAndDecode) {
    
    this._tileWidth = tileWidth;
    this._tileHeight = tileHeight;
    this._activeRequests = [];
    this._onlyWaitForDataAndDecode = onlyWaitForDataAndDecode;
    
    this._fetchManager = fetchManager;
    
    this._decodeScheduler = decodeScheduler;
}

DecodeJobsPool.prototype.forkDecodeJobs = function forkDecodeJobs(
    imagePartParams,
    callback,
    terminatedCallback,
    levelWidth,
    levelHeight,
    isProgressive,
    imagePartParamsNotNeeded) {
    
    var minX = imagePartParams.minX;
    var minY = imagePartParams.minY;
    var maxX = imagePartParams.maxXExclusive;
    var maxY = imagePartParams.maxYExclusive;
    var level = imagePartParams.level || 0;
    var layer = imagePartParams.maxNumQualityLayers;
    var priorityData = imagePartParams.requestPriorityData;
                
    var isMinAligned =
        minX % this._tileWidth === 0 && minY % this._tileHeight === 0;
    var isMaxXAligned = maxX % this._tileWidth === 0 || maxX === levelWidth;
    var isMaxYAligned = maxY % this._tileHeight === 0 || maxY === levelHeight;
    var isOrderValid = minX < maxX && minY < maxY;
    
    if (!isMinAligned || !isMaxXAligned || !isMaxYAligned || !isOrderValid) {
        throw 'imagePartParams for decoders is not aligned to ' +
            'tile size or not in valid order';
    }
    
    var requestsInLevel = getOrAddValue(this._activeRequests, level, []);
    var requestsInQualityLayer = getOrAddValue(
        requestsInLevel, imagePartParams.maxNumQualityLayers, []);
        
    var numTilesX = Math.ceil((maxX - minX) / this._tileWidth);
    var numTilesY = Math.ceil((maxY - minY) / this._tileHeight);
    
    var listenerHandle = {
        imagePartParams: imagePartParams,
        callback: callback,
        terminatedCallback: terminatedCallback,
        remainingDecodeJobs: numTilesX * numTilesY,
        isProgressive: isProgressive,
        isAnyDecoderAborted: false,
        isTerminatedCallbackCalled: false,
        allRelevantBytesLoaded: 0,
        unregisterHandles: []
    };
    
    for (var x = minX; x < maxX; x += this._tileWidth) {
        var requestsInX = getOrAddValue(requestsInQualityLayer, x, []);
        var singleTileMaxX = Math.min(x + this._tileWidth, levelWidth);
        
        for (var y = minY; y < maxY; y += this._tileHeight) {
            var singleTileMaxY = Math.min(y + this._tileHeight, levelHeight);
            
            var isTileNotNeeded = isUnneeded(
                x,
                y,
                singleTileMaxX,
                singleTileMaxY,
                imagePartParamsNotNeeded);
                
            if (isTileNotNeeded) {
                --listenerHandle.remainingDecodeJobs;
                continue;
            }
        
            var decodeJobContainer = getOrAddValue(requestsInX, y, {});
            
            if (decodeJobContainer.job === undefined ||
                decodeJobContainer.job.getIsTerminated()) {
                
                var singleTileImagePartParams = {
                    minX: x,
                    minY: y,
                    maxXExclusive: singleTileMaxX,
                    maxYExclusive: singleTileMaxY,
                    level: level,
                    maxNumQualityLayers: layer,
                    requestPriorityData: priorityData
                };
                
                decodeJobContainer.job = new DecodeJob(
                    singleTileImagePartParams,
                    this._fetchManager,
                    this._decodeScheduler,
                    this._onlyWaitForDataAndDecode);
            }
            
            var unregisterHandle =
                decodeJobContainer.job.registerListener(listenerHandle);
            listenerHandle.unregisterHandles.push({
                unregisterHandle: unregisterHandle,
                job: decodeJobContainer.job
            });
        }
    }
    
    if (!listenerHandle.isTerminatedCallbackCalled &&
        listenerHandle.remainingDecodeJobs === 0) {
        
        listenerHandle.isTerminatedCallbackCalled = true;
        listenerHandle.terminatedCallback(listenerHandle.isAnyDecoderAborted);
    }
    
    return listenerHandle;
};

DecodeJobsPool.prototype.unregisterForkedJobs = function unregisterForkedJobs(listenerHandle) {
    if (listenerHandle.remainingDecodeJobs === 0) {
        // All jobs has already been terminated, no need to unregister
        return;
    }
    
    for (var i = 0; i < listenerHandle.unregisterHandles.length; ++i) {
        var handle = listenerHandle.unregisterHandles[i];
        if (handle.job.getIsTerminated()) {
            continue;
        }
        
        handle.job.unregisterListener(handle.unregisterHandle);
    }
};

function isUnneeded(
    minX, minY, maxX, maxY, imagePartParamsNotNeeded) {
    
    if (imagePartParamsNotNeeded === undefined) {
        return false;
    }
    
    for (var i = 0; i < imagePartParamsNotNeeded.length; ++i) {
        var notNeeded = imagePartParamsNotNeeded[i];
        var isInX = minX >= notNeeded.minX && maxX <= notNeeded.maxXExclusive;
        var isInY = minY >= notNeeded.minY && maxY <= notNeeded.maxYExclusive;
        
        if (isInX && isInY) {
            return true;
        }
    }
    
    return false;
}

function getOrAddValue(parentArray, index, defaultValue) {
    var subArray = parentArray[index];
    if (subArray === undefined) {
        subArray = defaultValue;
        parentArray[index] = subArray;
    }
    
    return subArray;
}