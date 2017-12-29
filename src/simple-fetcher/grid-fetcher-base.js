'use strict';

module.exports = GridFetcherBase;

var SimpleFetcherBase = require('simple-fetcher-base.js');
var GridImageBase = require('grid-image-base.js');
var LinkedList = require('linked-list.js');

/* global Promise: false */

var TILE_STATE_ACTIVE = 0;
var TILE_STATE_PENDING_STOP = 1;
var TILE_STATE_STOPPED = 2;
var TILE_STATE_TERMINATED = 3;

function GridFetcherBase(options) {
    SimpleFetcherBase.call(this, options);
    this._gridFetcherBaseCache = [];
    this._events = {
        'data': [],
        'tile-terminated': []
    };
}

GridFetcherBase.prototype = Object.create(SimpleFetcherBase.prototype);

GridFetcherBase.prototype.fetchTile = function(level, tileX, tileY, fetchTask) {
    throw 'imageDecoderFramework error: GridFetcherBase.fetchTile is not implemented by inheritor';
};

GridFetcherBase.prototype.on = function(event, listener) {
    var listeners = this._events[event];
    if (!listeners) {
        throw 'imageDecoderFramework error: Unexpected event ' + event + ' in GridFetcherBase';
    }
    listeners.push(listener);
};

GridFetcherBase.prototype.startFetch = function startFetch(fetchContext, imagePartParams) {
    var fetchData = {
        activeTilesCount: 0,
        activeTilesCountWithSingleListener: 0,
        tileListeners: [],
        fetchContext: fetchContext,
        isPendingStop: false,
        isActive: false,
        imagePartParams: imagePartParams,
        self: this
    };
    
    fetchContext.on('stop', onFetchStop, fetchData);
    fetchContext.on('resume', onFetchResume, fetchData);
    fetchContext.on('terminate', onFetchTerminate, fetchData);

    var tilesToStartX = [];
    var tilesToStartY = [];
    var tilesToStartTileContexts = [];
    
    var tilesRange = GridImageBase.getTilesRange(this.getImageParams(), imagePartParams);
    fetchData.activeTilesCount = (tilesRange.maxTileX - tilesRange.minTileX) * (tilesRange.maxTileY - tilesRange.minTileY);
    for (var tileX = tilesRange.minTileX; tileX < tilesRange.maxTileX; ++tileX) {
        for (var tileY = tilesRange.minTileY; tileY < tilesRange.maxTileY; ++tileY) {
            var tileContext = this._addToCache(tileX, tileY, fetchData);
            if (tileContext === null) {
                continue;
            }

            tilesToStartX.push(tileX);
            tilesToStartY.push(tileY);
            tilesToStartTileContexts.push(tileContext);
        }
    }
    
    onFetchResume.call(fetchData);
    
    for (var i = 0; i < tilesToStartX.length; ++i) {
        this._loadTile(fetchData.imagePartParams.level, tilesToStartX[i], tilesToStartY[i], tilesToStartTileContexts[i]);
    }
};

GridFetcherBase.prototype._checkIfShouldStop = function tryStopFetch(fetchData) {
    if (!fetchData.isPendingStop || fetchData.activeTilesCountWithSingleListener > 0) {
        return;
    }
    
    fetchData.isPendingStop = false;
    fetchData.isActive = false;
    this._changeSingleListenerCountOfOverlappingFetches(fetchData, +1);
    fetchData.fetchContext.stopped();
};
    
GridFetcherBase.prototype._changeSingleListenerCountOfOverlappingFetches =
        function changeSingleListenerCountOfOverlappingFetches(fetchData, addValue) {
            
    for (var i = 0; i < fetchData.tileListeners.length; ++i) {
        var tileContext = fetchData.tileListeners[i].tileContext;
        this._changeSingleListenerCount(tileContext.dependFetches, /*singleListenerAddValue=*/addValue);
    }
};

GridFetcherBase.prototype._decrementActiveTiles = function(tileDependFetches) {
    var singleActiveFetch = null;
    var hasActiveFetches = false;
    var iterator = tileDependFetches.getFirstIterator();
    while (iterator !== null) {
        var fetchData = tileDependFetches.getValue(iterator);
        iterator = tileDependFetches.getNextIterator(iterator);

        --fetchData.activeTilesCount;
        if (fetchData.activeTilesCount === 0) {
            fetchData.isActive = false;
            fetchData.fetchContext.done();
        }
    }
};

GridFetcherBase.prototype._changeSingleListenerCount = function(tileDependFetches, singleListenerAddValue) {
    var singleActiveFetch = null;
    var hasActiveFetches = false;
    var iterator = tileDependFetches.getFirstIterator();
    while (iterator !== null) {
        var fetchData = tileDependFetches.getValue(iterator);
        iterator = tileDependFetches.getNextIterator(iterator);

        if (!fetchData.isActive) {
            continue;
        } else if (singleActiveFetch === null) {
            singleActiveFetch = fetchData;
            hasActiveFetches = true;
        } else if (hasActiveFetches) {
            // Not single anymore
            return;
        }
    }
    
    if (singleActiveFetch !== null) {
        singleActiveFetch.activeTilesCountWithSingleListener += singleListenerAddValue;
        this._checkIfShouldStop(singleActiveFetch);
    }
};

function onFetchStop() {
    /* jshint validthis: true */
    var fetchData = this;

    fetchData.isPendingStop = true;
    fetchData.self._checkIfShouldStop(fetchData);
}

function onFetchResume() {
    /* jshint validthis: true */
    var fetchData = this;
    fetchData.isPendingStop = false;
    
    fetchData.self._changeSingleListenerCountOfOverlappingFetches(fetchData, -1);
    fetchData.isActive = true;
}

function onFetchTerminate() {
    /* jshint validthis: true */
    var fetchData = this;
    
    if (fetchData.isActive) {
        throw 'imageDecoderFramework error: Unexpected grid fetch terminated of a still active fetch';
    }
    
    for (var i = 0; i < fetchData.tileListeners.length; ++i) {
        fetchData.tileListeners[i].tileContext.dependFetches.remove(fetchData.tileListeners[i].iterator);
    }
}

GridFetcherBase.prototype._loadTile = function loadTile(level, tileX, tileY, tileContext) {
    var tileKey = {
        fetchWaitTask: true,
        tileX: tileX,
        tileY: tileY,
        level: level
    };
    
    var self = this;
    var tileFetchApi = {
        dataReady: function(result) {
            if (tileContext.tileState !== TILE_STATE_ACTIVE && tileContext.tileState !== TILE_STATE_PENDING_STOP) {
                throw 'imageDecoderFramework error: either stopped or already terminated in GridFetcherBase.fetchTile()';
            }
            if (self._gridFetcherBaseCache[level][tileX][tileY] !== tileContext) {
                throw 'imageDecoderFramework error: Unexpected fetch in GridFetcherBase.gridFetcherBaseCache';
            }
            var data = {
                tileKey: tileKey,
                tileContent: result
            };
            for (var i = 0; i < self._events.data.length; ++i) {
                self._events.data[i](data);
            }
        },
        
        terminate: function() {
            if (tileContext.tileState !== TILE_STATE_ACTIVE && tileContext.tileState !== TILE_STATE_PENDING_STOP) {
                throw 'imageDecoderFramework error: either stopped or already terminated in GridFetcherBase.fetchTile()';
            }
            if (self._gridFetcherBaseCache[level][tileX][tileY] !== tileContext) {
                throw 'imageDecoderFramework error: Unexpected fetch in GridFetcherBase.gridFetcherBaseCache';
            }
            tileContext.tileState = TILE_STATE_TERMINATED;
            self._gridFetcherBaseCache[level][tileX][tileY] = null;
            
            for (var i = 0; i < self._events['tile-terminated'].length; ++i) {
                self._events['tile-terminated'][i](tileKey);
            }
            
            self._decrementActiveTiles(tileContext.dependFetches);
            self._changeSingleListenerCount(tileContext.dependFetches, /*singleListenerAddValue=*/-1);
        },
        /* TODO: enable stop & resume
        on: function(event, handler) {
            if (event !== 'stop' && event !== 'resume') {
                throw 'imageDecoderFramework error: GridFetcherBase tile.on unexpected event ' + event + ': expected stop or resume';
            }
            
            tileContext[event + 'Listeners'].push(handler);
        }
        
        stopped: function() {
            if (tileContext.tileState !== TILE_STATE_PENDING_STOP) {
                throw 'imageDecoderFramework error: Unexpected stopped call. Either: 1. No stop requested or, 2. resume was called ' +
                    'till then or, 3. Already called stopped or, 4. Already called terminate';
            }
        }
        */
    };
    
    this.fetchTile(level, tileX, tileY, tileFetchApi);
};

GridFetcherBase.prototype._addToCache = function addToCache(tileX, tileY, fetchData) {
    var levelCache = this._gridFetcherBaseCache[fetchData.imagePartParams.level];
    if (!levelCache) {
        levelCache = [];
        this._gridFetcherBaseCache[fetchData.imagePartParams.level] = levelCache;
    }
    
    var xCache = levelCache[tileX];
    if (!xCache) {
        xCache = [];
        levelCache[tileX] = xCache;
    }
    
    var tileContext = xCache[tileY];
    var isNew = false;
    if (!tileContext) {
        tileContext = {
            dependFetches: new LinkedList(),
            stopListeners: [],
            resumeListeners: [],
            tileState: TILE_STATE_ACTIVE
        };
        xCache[tileY] = tileContext;
        ++fetchData.activeTilesCountWithSingleListener;
        isNew = true;
    }
    
    fetchData.tileListeners.push({
        tileContext: tileContext,
        iterator: tileContext.dependFetches.add(fetchData)
    });
    return isNew ? tileContext : null;
};