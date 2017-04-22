'use strict';

module.exports = GridTaskContext;

/* global console: false */
/* global Promise: false */

GridTaskContext.FETCH_WAIT_TASK = 0;
GridTaskContext.DECODE_TASK = 1;

function GridTaskContext(imageParams, taskKey, dependencyWorkersCallbacks) {
	this._imageParams = imageParams;
	this._taskKey = taskKey;
	this._dependencyWorkersCallbacks = dependencyWorkersCallbacks;
	this._dependResults = null;
	this._tilesRange = null;
	
	if (taskKey.fetchWaitTask) {
		return;
	}
	
	var imagePartParams = taskKey;
	var range = GridImageBase.getTilesRange(imageParams, imagePartParams);
	this._dependResults = new Array((range.maxTileX - range.minTileX) * (range.maxTileY - range.minTileY));
	this._tilesRange = range;
	
	var i = 0;
	for (var tileX = range.minTileX; tileX < range.maxTileX; ++tileX) {
		for (var tileY = range.minTileY; tileY < range.maxTileY; ++tileY) {
			dependencyWorkersCallbacks.registerTaskDependency({
				fetchWaitTask: true,
				tileX: tileX,
				tileY: tileY,
				level: imagePartParams.level
			});
		}
	}
}

GridTaskContext.prototype.getTaskType = function getTaskType() {
	return taskKey.fetchWaitTask ? GridTaskContext.FETCH_WAIT_TASK : GridTaskContext.DECODE_TASK;
};

GridTaskContext.prototype.onDependencyTaskResult = function onDependencyTaskResult(value, key) {
	var x = key.tileX - this._tilesRange.minTileX;
	var y = key.tileY - this._tilesRange.minTileY;
	var width = this._tilesRange.maxTileX - this._tilesRange.minTileX;
	var index = x + y * width;
	
	this._dependResults[index] = value;
};

GridTaskContext.prototype.statusUpdated  = function onDependencyTaskResult(status) {
	// TODO
};