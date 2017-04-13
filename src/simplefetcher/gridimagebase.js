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

GridImageBase.prototype.getDecodeWorkerTypeOptions = function getDecodeWorkerTypeOptions() {
	throw 'imageDecoderFramework error: GridImageBase.getDecodeWorkerTypeOptions is not implemented by inheritor';
};

GridImageBase.prototype.decodeTaskStarted = function decodeTaskStarted(task) {
	var self = this;
	task.on('allDependTasksTerminated', function() {
		self.dataReadyForDecode(task);
		task.terminate();
	});
};

GridImageBase.prototype.getFetchManager = function getFetchManager() {
	return this._fetchManager;
};

GridImageBase.prototype.getDecoderWorkers = function getDecoderWorkers() {
	if (this._decoderWorkers === null) {
		this._imageParams = this._fetchManager.getImageParams(); // imageParams that returned by fetcher.open()
		this._decoderWorkers = new AsyncProxy.DependencyWorkers(this);
		this._fetchManager.on('data', this._onDataFetched.bind(this));
		this._fetchManager.on('tileTerminated', this._onTileTerminated.bind(this));
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

// DependencyWorkersInputRetreiver implementation

GridImageBase.prototype.getWorkerTypeOptions = function(taskType) {
	if (taskType === FETCH_WAIT_TASK) {
		return null;
	} else if (taskType === DECODE_TASK) {
		return this.getDecodeWorkerTypeOptions();
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

GridImageBase.prototype.taskStarted = function(task) {	
	var self = this;
	
	if (task.key.fetchWaitTask) {
		var strKey = this.getKeyAsString(task.key);
		this._waitingFetches[strKey] = task;
		return;
	}

	var imagePartParams = task.key;
	var tilesRange = GridImageBase.getTilesRange(this._imageParams, imagePartParams);
	
	var i = 0;
	for (var tileX = tilesRange.minTileX; tileX < tilesRange.maxTileX; ++tileX) {
		for (var tileY = tilesRange.minTileY; tileY < tilesRange.maxTileY; ++tileY) {
			task.registerTaskDependency({
				fetchWaitTask: true,
				tileX: tileX,
				tileY: tileY,
				level: imagePartParams.level
			});
		}
	}
	
	this.decodeTaskStarted(task);
};

GridImageBase.prototype.dataReadyForDecode = function dataReadyForDecode(task) {
	task.dataReady({
		tileContents: task.dependTaskResults,
		tileIndices: task.dependTaskKeys,
		imagePartParams: task.key,
		tileWidth: this._imageParams.tileWidth,
		tileHeight: this._imageParams.tileHeight
	}, DECODE_TASK);
};

// Auxiliary methods

GridImageBase.prototype._onDataFetched = function(fetchedTile) {
	var strKey = this.getKeyAsString(fetchedTile.tileKey);
	var waitingTask = this._waitingFetches[strKey];
	if (waitingTask) {
		waitingTask.dataReady(fetchedTile.tileContent, FETCH_WAIT_TASK);
	}
};

GridImageBase.prototype._onTileTerminated = function(tileKey) {
	var strKey = this.getKeyAsString(tileKey);
	var waitingTask = this._waitingFetches[strKey];
	if (waitingTask) {
		waitingTask.terminate();
		this._waitingFetches[strKey] = null;
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
