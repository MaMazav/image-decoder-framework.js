'use strict';

var GridLevelCalculator = require('grid-level-calculator.js');

module.exports = GridImageBase;

/* global Promise: false */

var FETCH_WAIT_TASK = 0;
var DECODE_TASK = 1;

function GridImageBase(fetcher) {
	this._fetcher = fetcher;
	this._imageParams = null;
	this._waitingFetches = {};
    this._levelCalculator = null;
}

GridImageBase.prototype.opened = function opened(imageDecoder) {
    this._imageParams = imageDecoder.getImageParams();
    imageDecoder.onFetcherEvent('data', this._onDataFetched.bind(this));
    imageDecoder.onFetcherEvent('tile-terminated', this._onTileTerminated.bind(this));
};

GridImageBase.prototype.getLevelCalculator = function getLevelCalculator() {
    if (this._levelCalculator === null) {
        this._levelCalculator = new GridLevelCalculator(this._imageParams);
    }
	return this._levelCalculator;
};

GridImageBase.prototype.getDecodeWorkerTypeOptions = function getDecodeWorkerTypeOptions() {
	throw 'imageDecoderFramework error: GridImageBase.getDecodeWorkerTypeOptions is not implemented by inheritor';
};

GridImageBase.prototype.getDecoderWorkersInputRetreiver = function getDecoderWorkersInputRetreiver() {
	return this;
};

GridImageBase.prototype.decodeTaskStarted = function decodeTaskStarted(task) {
	var self = this;
	task.on('allDependTasksTerminated', function() {
		self.dataReadyForDecode(task);
		task.terminate();
	});
};

GridImageBase.prototype.getFetcher = function getFetcher() {
	return this._fetcher;
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

	if (this._imageParams === null) {
		this._imageParams = this.getImageParams(); // imageParams that returned by fetcher.open()
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
	var levelWidth  = imageParams.imageWidth  * Math.pow(2, imagePartParams.level - imageParams.imageLevel);
	var levelHeight = imageParams.imageHeight * Math.pow(2, imagePartParams.level - imageParams.imageLevel);
	var levelTilesX = Math.ceil(levelWidth  / imageParams.tileWidth );
	var levelTilesY = Math.ceil(levelHeight / imageParams.tileHeight);
	return {
		minTileX: Math.max(0, Math.floor(imagePartParams.minX / imageParams.tileWidth )),
		minTileY: Math.max(0, Math.floor(imagePartParams.minY / imageParams.tileHeight)),
		maxTileX: Math.min(levelTilesX, Math.ceil(imagePartParams.maxXExclusive / imageParams.tileWidth )),
		maxTileY: Math.min(levelTilesY, Math.ceil(imagePartParams.maxYExclusive / imageParams.tileHeight))
	};
};
