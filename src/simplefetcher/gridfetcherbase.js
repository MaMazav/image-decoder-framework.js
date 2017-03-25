'use strict';

module.exports = GridFetcherBase;

var GridImageBase = require('gridimagebase');

/* global console: false */
/* global Promise: false */

function GridFetcherBase() {
	this._gridFetcherBaseCache = [];
}

GridFetcherBase.prototype.open = function(url) {
	throw 'imageDecoderFramework error: GridFetcherBase.open is not implemented by inheritor';
};

GridFetcherBase.prototype.fetchTile = function(url) {
	throw 'imageDecoderFramework error: GridFetcherBase.fetchTile is not implemented by inheritor';
};

GridFetcherBase.prototype.fetch = function fetch(imagePartParams) {
	var tilesRange = GridImageBase.getTilesRange(this._imageParams, imagePartParams);
	
	var promises = [];
	for (var tileX = tilesRange.minTileX; tileX < tilesRange.maxTileX; ++tileX) {
		for (var tileY = tilesRange.minTileY; tileY < tilesRange.maxTileY; ++tileY) {
			var promise = this._loadTile(imagePartParams.level, tileX, tileY);
			promises.push(promise);
		}
	}
	
	return Promise.all(promises);
};

GridFetcherBase.prototype._loadTile = function loadTile(level, tileX, tileY) {
	var levelCache = this._gridFetcherBaseCache[level];
	if (!levelCache) {
		levelCache = [];
		this._gridFetcherBaseCache[level] = levelCache;
	}
	
	var xCache = levelCache[tileX];
	if (!xCache) {
		xCache = [];
		levelCache[tileX] = xCache;
	}
	
	var promise = xCache[tileY];
	if (!promise) {
		promise = this.fetchTile(level, tileX, tileY).then(function(result) {
			xCache[tileY] = null;
			return result;
		});
		xCache[tileY] = promise;
	}
	
	return promise.then(function(result) {
		return {
			tileKey: {
				fetchWaitTask: true,
				tileX: tileX,
				tileY: tileY,
				level: level
			},
			content: result
		};
	});
};
