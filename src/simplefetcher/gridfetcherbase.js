'use strict';

module.exports = GridFetcherBase;

var GridImageBase = require('gridimagebase');
var LinkedList = require('linkedlist.js');
var SimpleFetchAdapterFetchHandle = require('simplefetchadapterfetchhandle.js');

/* global console: false */
/* global Promise: false */

function GridFetcherBase(options) {
	options = options || {};
	var self = this;
	self._maxActiveFetchesInChannel = options.maxActiveFetchesInChannel || 2;
	self._gridFetcherBaseCache = [];
    self._dataListeners = [];
	self._terminatedListeners = [];
	self._pendingFetchHandles = new LinkedList();
    self._isReady = true;
    self._activeFetches = 0;
    self._resolveClose = null;
    self._rejectClose = null;
}

GridFetcherBase.prototype.fetchTile = function(level, tileX, tileY, fetchTask) {
	throw 'imageDecoderFramework error: GridFetcherBase.fetchTile is not implemented by inheritor';
};

GridFetcherBase.prototype.getImageParams = function() {
	throw 'imageDecoderFramework error: GridFetcherBase.getImageParams is not implemented by inheritor';
};

GridFetcherBase.prototype.open = function(url) {
	throw 'imageDecoderFramework error: GridFetcherBase.open is not implemented by inheritor';
};

GridFetcherBase.prototype.close = function close(closedCallback) {
    this._ensureReady();
    this._isReady = false;
    var self = this;
    return new Promise(function(resolve, reject) {
        self._resolveClose = resolve;
        self._rejectClose = reject;
        self._checkIfClosed();
    });
};

GridFetcherBase.prototype.on = function on(event, listener) {
    switch (event) {
		case 'data':
			this._dataListeners.push(listener);
			break;
		case 'tileTerminated':
			this._terminatedListeners.push(listener);
			break;
        default:
			throw 'imageDecoderFramework error: Unexpected event ' + event + '. Expected "data" or "tileTerminated"';
    }
};

GridFetcherBase.prototype.fetch = function fetch(imagePartParams) {
	return this.startMovableFetch(imagePartParams, {});
};

GridFetcherBase.prototype.startMovableFetch = function startMovableFetch(imagePartParams, movableFetchState) {
    this._ensureReady();
	
	movableFetchState.activeFetchesInChannel = [];
	movableFetchState.pendingFetch = null;
	movableFetchState.isPendingFetchStopped = false;
	
	return this.moveFetch(imagePartParams, movableFetchState);
};

GridFetcherBase.prototype.moveFetch = function moveFetch(imagePartParams, movableFetchState) {
    this._ensureReady();
	
	var handle = new SimpleFetchAdapterFetchHandle(imagePartParams, this, movableFetchState);
	var newFetch = {
		handle: handle,
		singleListenerCount: 0,
		state: movableFetchState,
		imagePartParams: imagePartParams,
		pendingIterator: this._pendingFetchHandles.add(handle),
		tileListeners: [],
		activeTiles: 0
	};
	if (movableFetchState.pendingFetch) {
		this._pendingFetchHandles.remove(movableFetchState.pendingFetch.pendingIterator);
		movableFetchState.pendingFetch.handle._onTerminated();
	}
	movableFetchState.pendingFetch = newFetch;
	this._startAndTerminateFetches(movableFetchState);
	
	return handle;
};

GridFetcherBase.prototype._ensureReady = function ensureReady() {
    if (!this._isReady) {
        throw 'imageDecoderFramework error: fetch client is not opened';
    }
};

GridFetcherBase.prototype._checkIfClosed = function checkIfClosed() {
    if (this._activeFetches > 0 || this._isReady) {
		return;
	}
	this._resolveClose();
    
	var it = this._pendingFetchHandles.getFirstIterator();
	while (it !== null) {
		var handle = this._pendingFetchHandles.getValue(it);
		it = this._pendingFetchHandles.getNextIterator(it);
		
		handle._onTerminated();
	}
};

GridFetcherBase.prototype._startAndTerminateFetches = function startAndTerminateFetches(fetchState) {
	var fetchesToTerminate = fetchState.activeFetchesInChannel.length;
	if (fetchState.pendingFetch === null && fetchesToTerminate > 0) { // Don't terminate last fetch if no pending new fetch
		var lastFetch = fetchState.activeFetchesInChannel[fetchesToTerminate - 1];
		if (lastFetch.activeTiles > 0) {
			--fetchesToTerminate;
		}
	}
	for (var i = fetchesToTerminate - 1; i >= 0; --i) {
		var fetch = fetchState.activeFetchesInChannel[i];
		if (fetch.singleListenerCount !== 0 && fetch.activeTiles > 0) {
			continue;
		}

		this._pendingFetchHandles.remove(fetch.pendingIterator);
		fetch.handle._onTerminated();
		--this._activeFetches;
		// Inefficient for large maxActiveFetchesInChannel, but maxActiveFetchesInChannel should be small
		fetchState.activeFetchesInChannel.splice(i, 1);
		
		for (var j = 0; j < fetch.tileListeners.length; ++j) {
			var tileListener = fetch.tileListeners[j];
			tileListener.dependFetches.remove(tileListener.iterator);
			if (tileListener.dependFetches.getCount() === 1) {
				var it = tileListener.dependFetches.getFirstIterator();
				var otherFetch = tileListener.dependFetches.getValue(it);
				++otherFetch.singleListenerCount;
			}
		}
	}
	
	this._checkIfClosed();
	if (!this._isReady) {
		return;
	}

	var newFetch = fetchState.pendingFetch;
	if (fetchState.activeFetchesInChannel.length >= this._maxActiveFetchesInChannel ||
		newFetch === null ||
		fetchState.isPendingFetchStopped) {

			return;
	}
	
	fetchState.pendingFetch = null;
	fetchState.activeFetchesInChannel.push(newFetch);
	
    ++this._activeFetches;
	var tilesRange = GridImageBase.getTilesRange(this.getImageParams(), newFetch.imagePartParams);
	newFetch.activeTiles = (tilesRange.maxTileX - tilesRange.minTileX) * (tilesRange.maxTileY - tilesRange.minTileY);
	
	for (var tileX = tilesRange.minTileX; tileX < tilesRange.maxTileX; ++tileX) {
		for (var tileY = tilesRange.minTileY; tileY < tilesRange.maxTileY; ++tileY) {
			this._loadTile(tileX, tileY, newFetch);
		}
	}
};

GridFetcherBase.prototype._loadTile = function loadTile(tileX, tileY, newFetch) {
	var dependFetches = this._addToCache(tileX, tileY, newFetch);
	var isTerminated = false;
	var level = newFetch.imagePartParams.level;
	var tileKey = {
		fetchWaitTask: true,
		tileX: tileX,
		tileY: tileY,
		level: level
	};
	
	var self = this;
	this.fetchTile(level, tileX, tileY, {
		onData: function(result) {
			if (isTerminated) {
				throw 'imageDecoderFramework error: already terminated in GridFetcherBase.fetchTile()';
			}
			for (var i = 0; i < self._dataListeners.length; ++i) {
				self._dataListeners[i]({
					tileKey: tileKey,
					tileContent: result
				}, newFetch.imagePartParams);
			}
		},
		
		onTerminated: function() {
			if (isTerminated) {
				throw 'imageDecoderFramework error: double termination in GridFetcherBase.fetchTile()';
			}
			self._gridFetcherBaseCache[newFetch.imagePartParams.level][tileX][tileY] = null;
			
			for (var i = 0; i < self._terminatedListeners.length; ++i) {
				self._terminatedListeners[i](tileKey);
			}
			
			var iterator = dependFetches.getFirstIterator();
			var fetchToReduce;
			while (iterator !== null) {
				fetchToReduce = dependFetches.getValue(iterator);
				iterator = dependFetches.getNextIterator(iterator);
				
				--fetchToReduce.activeTiles;
				if (fetchToReduce.activeTiles === 0) {
					self._startAndTerminateFetches(fetchToReduce.state);
				}
			}
			
			if (dependFetches.getCount() !== 1 || fetchToReduce.activeTiles === 0) {
				return;
			}
			
			var it = dependFetches.getFirstIterator();
			var fetch = dependFetches.getValue(it);
			--fetch.singleListenerCount;
			self._startAndTerminateFetches(fetch.state);
		}
	});
};

GridFetcherBase.prototype._addToCache = function addToCache(tileX, tileY, newFetch) {
	var levelCache = this._gridFetcherBaseCache[newFetch.imagePartParams.level];
	if (!levelCache) {
		levelCache = [];
		this._gridFetcherBaseCache[newFetch.imagePartParams.level] = levelCache;
	}
	
	var xCache = levelCache[tileX];
	if (!xCache) {
		xCache = [];
		levelCache[tileX] = xCache;
	}
	
	var dependFetches = xCache[tileY];
	if (!dependFetches) {
		dependFetches = new LinkedList();
		xCache[tileY] = dependFetches;
		++newFetch.singleListenerCount;
	}
	
	if (dependFetches.getCount() !== 1) {
		newFetch.tileListeners.push({
			dependFetches: dependFetches,
			iterator: dependFetches.add(newFetch)
		});
		return dependFetches;
	}

	var it = dependFetches.getFirstIterator();
	var oldFetch = dependFetches.getValue(it);
	newFetch.tileListeners.push({
		dependFetches: dependFetches,
		iterator: dependFetches.add(newFetch)
	});

	--oldFetch.singleListenerCount;
	this._startAndTerminateFetches(oldFetch.state);
	
	return dependFetches;
};