'use strict';

module.exports = SimpleFetcher;

var SimpleImageDataContext = require('simpleimagedatacontext.js');
var SimpleNonProgressiveFetchHandle = require('simplenonprogressivefetchhandle.js');
var DataPublisher = require('datapublisher.js');

/* global Promise: false */

function SimpleFetcher(fetcherMethods, options) {
    this._url = null;
    this._fetcherMethods = fetcherMethods;
    this._options = options || {};
    this._isReady = true;
    
    if (!this._fetcherMethods.getDataKeys) {
        throw 'SimpleFetcher error: getDataKeys is not implemented';
    }
    if (!this._fetcherMethods.fetch && !this._fetcherMethods.fetchProgressive) {
        throw 'SimpleFetcher error: Neither fetch nor fetchProgressive methods are implemented';
    }
    
    if (!this._fetcherMethods.getHashCode) {
        throw 'SimpleFetcher error: getHashCode is not implemented';
    }
    if (!this._fetcherMethods.isEqual) {
        throw 'SimpleFetcher error: isEqual is not implemented';
    }

    this._hasher = {
        _fetcherMethods: this._fetcherMethods,
        getHashCode: function(dataKey) {
            return this._fetcherMethods.getHashCode(dataKey);
        },
        isEqual: function(key1, key2) {
            if (key1.maxQuality !== key2.maxQuality) {
                return false;
            }

            return this._fetcherMethods.isEqual(key1.dataKey, key2.dataKey);
        }
    };

    if (this._fetcherMethods.createDataPublisher) {
        this._dataPublisher = this.fetcherMethods.createDataPublisher(this._hasher);
    } else {
        this._dataPublisher = new DataPublisher(this._hasher);
    }
}

// Fetcher implementation

SimpleFetcher.prototype.reconnect = function reconnect() {
    this._ensureReady();
    if (!this._fetcherMethods.reconnect) {
        throw 'SimpleFetcher error: reconnect is not implemented';
    }
    this._fetcherMethods.reconnect();
};

SimpleFetcher.prototype.createImageDataContext = function createImageDataContext(
    imagePartParams) {
    
    this._ensureReady();
    var dataKeys = this._fetcherMethods.getDataKeys(imagePartParams);
    return new SimpleImageDataContext(dataKeys, imagePartParams, this._dataPublisher, this._hasher);
};

SimpleFetcher.prototype.fetch = function fetch(imageDataContext) {
    this._ensureReady();
    var imagePartParams = imageDataContext.getImagePartParams();
    var dataKeys = imageDataContext.getDataKeys();
	var maxQuality = imageDataContext.getMaxQuality();

	var self = this;
	
	function dataCallback(dataKey, data, isFetchEnded) {
		var key = {
			dataKey: dataKey,
			maxQuality: maxQuality
		};
		self._dataPublisher.publish(key, data, isFetchEnded);
	}
	
	function queryIsKeyNeedFetch(dataKey) {
		var key = {
			dataKey: dataKey,
			maxQuality: maxQuality
		};
		return self._dataPublisher.isKeyNeedFetch(key);
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
