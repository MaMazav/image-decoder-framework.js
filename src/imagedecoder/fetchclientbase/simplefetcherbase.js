'use strict';

module.exports = SimpleFetcherBase;

var SimpleImageDataContext = require('simpleimagedatacontext.js');
var SimpleFetchHandle = require('simplefetchhandle.js');
var DataPublisher = require('datapublisher.js');

/* global Promise: false */

function SimpleFetcherBase(options) {
    this._url = null;
    this._isReady = true;
    this._options = options;
    this._isReady = false;
    this._dataPublisher = this.createDataPublisherInternal(this);
}

// Methods for implementor

SimpleFetcherBase.prototype.fetchInternal = function fetch(dataKey) {
    throw 'SimpleFetcherBase error: fetchInternal is not implemented';
};

SimpleFetcherBase.prototype.getDataKeysInternal = function getDataKeysInternal(imagePartParams) {
    throw 'SimpleFetcherBase error: getDataKeysInternal is not implemented';
};

SimpleFetcherBase.prototype.createDataPublisherInternal = function createDataPublisherInternal() {
    return new DataPublisher(this);
};

SimpleFetcherBase.prototype.getHashCode = function getHashCode(tileKey) {
    throw 'SimpleFetcherBase error: getHashCode is not implemented';
};

SimpleFetcherBase.prototype.isEqual = function getHashCode(key1, key2) {
    throw 'SimpleFetcherBase error: isEqual is not implemented';
};

// FetchClient implementation

SimpleFetcherBase.prototype.createImageDataContext = function createImageDataContext(
    imagePartParams, contextVars) {
    
    var dataKeys = this.getDataKeysInternal(imagePartParams);
    return new SimpleImageDataContext(contextVars, dataKeys, imagePartParams, this._dataPublisher, this);
};

SimpleFetcherBase.prototype.fetch = function fetch(imageDataContext, fetchChannelState) {
    var fetchHandle;
    if (!fetchChannelState) {
        fetchHandle = new SimpleFetchHandle(this, /*isChannel=*/false, this._dataPublisher, this._options);
    } else if (fetchChannelState.fetchHandle) {
        fetchHandle = fetchChannelState.fetchHandle;
    } else {
        fetchHandle = new SimpleFetchHandle(this, /*isChannel=*/true, this._dataPublisher, this._options);
        fetchChannelState.fetchHandle = fetchHandle;
    }
    fetchHandle.fetch(imageDataContext);
    return fetchHandle;
};

SimpleFetcherBase.prototype.close = function close(closedCallback) {
    return new Promise(function(resolve, reject) {
        // NOTE: Wait for all fetchHandles to finish?
        this._ensureReady();
        this._isReady = false;
        resolve();
    });
};

SimpleFetcherBase.prototype.reconnect = function reconnect() {
    return this.reconnectInternal();
};

SimpleFetcherBase.prototype._ensureReady = function ensureReady() {
    if (!this._isReady) {
        throw 'SimpleFetcherBase error: fetch client is not opened';
    }
};