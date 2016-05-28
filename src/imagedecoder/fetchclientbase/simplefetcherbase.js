'use strict';

module.exports = SimpleFetcherBase;

var SimpleImageDataContext = require('simpleimagedatacontext.js');
var SimpleFetchHandle = require('simplefetchhandle.js');
var DataPublisher = require('datapublisher.js');

/* global Promise: false */

function SimpleFetcherBase(options) {
    this._url = null;
    this._options = options || {};
    this._isReady = true;
    this._dataPublisher = this.createDataPublisherInternal(this);
}

// Methods for implementor

SimpleFetcherBase.prototype.fetchInternal = function fetch(dataKey) {
    throw 'SimpleFetcherBase error: fetchInternal is not implemented';
};

SimpleFetcherBase.prototype.getDataKeysInternal = function getDataKeysInternal(imagePartParams) {
    throw 'SimpleFetcherBase error: getDataKeysInternal is not implemented';
};

SimpleFetcherBase.prototype.getHashCodeInternal = function getHashCodeInternal(dataKey) {
    throw 'SimpleFetcherBase error: getHashCode is not implemented';
};

SimpleFetcherBase.prototype.isEqualInternal = function isEqualInternal(dataKey1, dataKey2) {
    throw 'SimpleFetcherBase error: isEqual is not implemented';
};

SimpleFetcherBase.prototype.createDataPublisherInternal = function createDataPublisherInternal() {
    return new DataPublisher(this);
};

SimpleFetcherBase.prototype.fetchProgressiveInternal = function fetchProgressiveInternal(dataKeys, dataCallback, queryIsKeyNeedFetch) {
    this._ensureReady();
    var fetchHandle = new SimpleFetchHandle(this, dataCallback, queryIsKeyNeedFetch, this._options);
	fetchHandle.fetch(dataKeys);
	return fetchHandle;
};

// FetchClient implementation

SimpleFetcherBase.prototype.createImageDataContext = function createImageDataContext(
    imagePartParams) {
    
    this._ensureReady();
    var dataKeys = this.getDataKeysInternal(imagePartParams);
    return new SimpleImageDataContext(dataKeys, imagePartParams, this._dataPublisher, this);
};

SimpleFetcherBase.prototype.fetch = function fetch(imageDataContext) {
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
	
	return this.fetchProgressiveInternal(imageDataContext.getDataKeys(), dataCallback, queryIsKeyNeedFetch, maxQuality);
};

SimpleFetcherBase.prototype.startMovableFetch = function startMovableFetch(imageDataContext, movableFetchState) {
	movableFetchState.fetchHandle = this.fetch(imageDataContext);
};

SimpleFetcherBase.prototype.moveFetch = function moveFetch(imageDataContext, movableFetchState) {
	movableFetchState.fetchHandle.abortAsync();
	movableFetchState.fetchHandle = this.fetch(imageDataContext);
};

SimpleFetcherBase.prototype.close = function close(closedCallback) {
    this._ensureReady();
    this._isReady = false;
    return new Promise(function(resolve, reject) {
        // NOTE: Wait for all fetchHandles to finish?
        resolve();
    });
};

SimpleFetcherBase.prototype.reconnect = function reconnect() {
    this._ensureReady();
    return this.reconnectInternal();
};

SimpleFetcherBase.prototype._ensureReady = function ensureReady() {
    if (!this._isReady) {
        throw 'SimpleFetcherBase error: fetch client is not opened';
    }
};

// Hasher implementation

SimpleFetcherBase.prototype.getHashCode = function getHashCode(key) {
    return this.getHashCodeInternal(key.dataKey);
};

SimpleFetcherBase.prototype.isEqual = function isEqual(key1, key2) {
    return key1.maxQuality == key2.maxQuality &&
		this.isEqualInternal(key1.dataKey, key2.dataKey);
};