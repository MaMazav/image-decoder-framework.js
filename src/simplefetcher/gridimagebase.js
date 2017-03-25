'use strict';

module.exports = GridImageBase;

/* global console: false */
/* global Promise: false */

var FETCH_WAIT_TASK = 0;
var DECODE_TASK = 1;

function GridImageBase(fetchManager) {
	this._fetchManager = fetchManager;
	this._decoderWorkers = null;
	this._imageParams = null;
	this._waitingFetches = {};
}

GridImageBase.prototype.getDecodeTaskTypeOptions = function getDecodeTaskTypeOptions() {
	throw 'imageDecoderFramework error: GridImageBase.getDecodeTaskTypeOptions is not implemented by inheritor';
};

GridImageBase.prototype.getFetchManager = function getFetchManager() {
	return this._fetchManager;
};

GridImageBase.prototype.getDecoderWorkers = function getDecoderWorkers() {
	if (this._decoderWorkers === null) {
		this._imageParams = this._fetchManager.getImageParams(); // imageParams that returned by fetcher.open()
		this._decoderWorkers = new AsyncProxy.PromiseDependencyWorkers(this);
		this._fetchManager.on('data', this._onDataFetched.bind(this));
	}
	return this._decoderWorkers;
};

// level calculations

GridImageBase.prototype.getLevelWidth = function getLevelWidth(level) {
	var imageParams = this._fetchManager.getImageParams();
	return imageParams.tileWidth  * imageParams.lowestLevelTilesX * Math.pow(2, level);
};

GridImageBase.prototype.getLevelHeight = function getLevelHeight(level) {
	var imageParams = this._fetchManager.getImageParams();
	return imageParams.tileHeight * imageParams.lowestLevelTilesY * Math.pow(2, level);
};

GridImageBase.prototype.getLevel = function getDefaultNumResolutionLevels(regionImageLevel) {
	var imageParams = this._fetchManager.getImageParams();
	var imageLevel = imageParams.levels - 1;
	
	var log2 = Math.log(2);
	var levelX = Math.log(regionImageLevel.screenWidth  / (regionImageLevel.maxXExclusive - regionImageLevel.minX)) / log2;
	var levelY = Math.log(regionImageLevel.screenHeight / (regionImageLevel.maxYExclusive - regionImageLevel.minY)) / log2;
	var level = Math.ceil(Math.min(levelX, levelY));
	level = Math.max(0, Math.min(0, level) + imageLevel);
	
	return level;
};

// PromiseDependencyWorkersInputRetreiver implementation

GridImageBase.prototype.getPromiseTaskProperties = function(taskKey) {
	if (taskKey.fetchWaitTask) {
		return {
			taskType: FETCH_WAIT_TASK,
			dependsOnTasks: [],
			isDisableWorker: true
		};
	}
	
	var imagePartParams = taskKey;
	var tilesRange = GridImageBase.getTilesRange(this._imageParams, imagePartParams);
	
	var depends = new Array((tilesRange.maxTileX - tilesRange.minTileX) * (tilesRange.maxTileY - tilesRange.minTileY));
	var i = 0;
	for (var tileX = tilesRange.minTileX; tileX < tilesRange.maxTileX; ++tileX) {
		for (var tileY = tilesRange.minTileY; tileY < tilesRange.maxTileY; ++tileY) {
			depends[i++] = {
				fetchWaitTask: true,
				tileX: tileX,
				tileY: tileY,
				level: imagePartParams.level
			};
		}
	}
	
	return {
		taskType: DECODE_TASK,
		dependsOnTasks: depends,
		isDisableWorker: false
	};
};

GridImageBase.prototype.preWorkerProcess = function(dependsTaskResults, dependsTaskKeys, taskKey) {
	if (taskKey.fetchWaitTask) {
		var self = this;
		return new Promise(function(resolve, reject) {
			var strKey = self.getKeyAsString(taskKey);
			self._waitingFetches[strKey] = resolve;
		});
	}
	return Promise.resolve({
		tileContents: dependsTaskResults,
		tileIndices: dependsTaskKeys,
		imagePartParams: taskKey,
		tileWidth: this._imageParams.tileWidth,
		tileHeight: this._imageParams.tileHeight
	});
};

GridImageBase.prototype.getTaskTypeOptions = function(taskType) {
	if (taskType === FETCH_WAIT_TASK) {
		return {};
	} else if (taskType === DECODE_TASK) {
		return this.getDecodeTaskTypeOptions();
	} else {
		throw 'imageDecoderFramework internal error: GridImageBase.getTaskTypeOptions got unexpected task type ' + taskType;
	}
};

GridImageBase.prototype.getKeyAsString = function(key) {
	if (key.fetchWaitTask) {
		return 'fetchWait:' + key.tileX + ',' + key.tileY + ':' + key.level;
	}
	// Otherwise it's a imagePartParams key passed by imageDecoderFramework lib. Just create a unique string
	return JSON.stringify(key);
};

// Auxiliary methods

GridImageBase.prototype._onDataFetched = function(fetchedTiles, imagePartParams) {
	for (var i = 0; i < fetchedTiles.length; ++i) {
		var strKey = this.getKeyAsString(fetchedTiles[i].tileKey);
		var waitingPromise = this._waitingFetches[strKey];
		if (waitingPromise) {
			delete this._waitingFetches[strKey];
			waitingPromise(fetchedTiles[i].content);
		}
	}
};

GridImageBase.getTilesRange = function(imageParams, imagePartParams) {
	var levelTilesX = imageParams.lowestLevelTilesX << imagePartParams.level;
	var levelTilesY = imageParams.lowestLevelTilesY << imagePartParams.level;
	return {
		minTileX: Math.max(0, Math.floor(imagePartParams.minX / imageParams.tileWidth )),
		minTileY: Math.max(0, Math.floor(imagePartParams.minY / imageParams.tileHeight)),
		maxTileX: Math.min(levelTilesX, Math.ceil(imagePartParams.maxXExclusive / imageParams.tileWidth )),
		maxTileY: Math.min(levelTilesY, Math.ceil(imagePartParams.maxYExclusive / imageParams.tileHeight))
	};
};