'use strict';

module.exports = SimpleFetcher;

var SimpleImageDataContext = require('simpleimagedatacontext.js');
var SimpleNonProgressiveFetchHandle = require('simplenonprogressivefetchhandle.js');
var DataPublisher = require('datapublisher.js');

/* global Promise: false */

function SimpleFetcher(fetchFunction, options) {
    this._url = null;
    this._options = options || {};
    this._fetchFunction = fetchFunction;
    this._isReady = true;
    this._dataListeners = [];
}

// Fetcher implementation

SimpleFetcher.prototype.reconnect = function reconnect() {
    this._ensureReady();
};

SimpleFetcher.prototype.on = function on(event, listener) {
    if (event !== 'data') {
        throw 'SimpleFetcher: Unexpected event ' + event + '. Expected "data"';
    }
    this._dataListeners.push(listener);
};

SimpleFetcher.prototype.fetch = function fetch(imagePartParams) {
    this._ensureReady();

	var self = this;
    var keys = [];
    var values = [];
	
	function dataCallback(dataKey, data, isFetchEnded) {
        keys.push(dataKey);
        values.push(data);
        if (keys.length === 1) {
            setImmediate(emitData);
        }
	}
	
	function queryIsKeyNeedFetch(dataKey) {
		// TODO
	}
    
    function emitData() {
        var localKeys = keys;
        var localValues = values;
        keys = [];
        values = [];
        for (var i = 0; i < self._dataListeners.length; ++i) {
            self._dataListeners[i](keys, values);
        }
    }
	
    if (!this._fetcherMethods.fetchProgressive) {
        var fetchHandle = new SimpleNonProgressiveFetchHandle(this._fetcherMethods, dataCallback, queryIsKeyNeedFetch, this._options);
        fetchHandle.fetch(dataKeys);
        return fetchHandle;
    }
    
    return this._fetcherMethods.fetchProgressive(imagePartParams, dataKeys, dataCallback, queryIsKeyNeedFetch, maxQuality);
};

SimpleFetcher.prototype.startMovableFetch = function startMovableFetch(imageDataContext, movableFetchState) {
    movableFetchState.moveToImageDataContext = null;
	movableFetchState.fetchHandle = this.fetch(imageDataContext);
};

SimpleFetcher.prototype.moveFetch = function moveFetch(imageDataContext, movableFetchState) {
    var isAlreadyMoveRequested = !!movableFetchState.moveToImageDataContext;
    movableFetchState.moveToImageDataContext = imageDataContext;
    if (isAlreadyMoveRequested) {
        return;
    }
    
    var self = this;
	movableFetchState.fetchHandle.stopAsync().then(function() {
        var moveToImageDataContext = movableFetchState.moveToImageDataContext;
        movableFetchState.moveToImageDataContext = null;
        movableFetchState.fetchHandle = self.fetch(moveToImageDataContext);
    });
};

SimpleFetcher.prototype.close = function close(closedCallback) {
    this._ensureReady();
    this._isReady = false;
    return new Promise(function(resolve, reject) {
        // NOTE: Wait for all fetchHandles to finish?
        resolve();
    });
};

SimpleFetcher.prototype._ensureReady = function ensureReady() {
    if (!this._isReady) {
        throw 'SimpleFetcher error: fetch client is not opened';
    }
};
