'use strict';

module.exports = FetchClientBase;

var SimpleImageDataContext = require('simpleimagedatacontext.js');
var SimpleFetcher = require('simplefetcher.js');
var DataPublisher = require('datapublisher.js');

function FetchClientBase(options) {
    this._statusCallback = null;
    this._url = null;
    this._options = options;
    this._isReady = false;
    this._sizesParams = null;
    this._dataPublisher = this.createDataPublisherInternal(this);
}

// Methods for implementor

FetchClientBase.prototype.openInternal = function openInternal(url) {
    throw 'FetchClientBase error: openInternal is not implemented';
};

FetchClientBase.prototype.fetchInternal = function fetch(dataKey) {
    throw 'FetchClientBase error: fetchInternal is not implemented';
};

FetchClientBase.prototype.getDataKeysInternal = function getDataKeysInternal(imagePartParams) {
    throw 'FetchClientBase error: getDataKeysInternal is not implemented';
};

FetchClientBase.prototype.createDataPublisherInternal = function createDataPublisherInternal() {
    return new DataPublisher(this);
};

FetchClientBase.prototype.getHashCode = function getHashCode(tileKey) {
    throw 'FetchClientBase error: getHashCode is not implemented';
};

FetchClientBase.prototype.isEqual = function getHashCode(key1, key2) {
    throw 'FetchClientBase error: isEqual is not implemented';
};

// FetchClient implementation

FetchClientBase.prototype.setStatusCallback = function setStatusCallback(
    statusCallback) {
    
    this._statusCallback = statusCallback;
};

FetchClientBase.prototype.open = function open(url) {
    if (this._url || this._isReady) {
        throw 'FetchClientBase error: Cannot open twice';
    }
    
    if (!url) {
        throw 'FetchClientBase error: no URL provided';
    }
    
    this._url = url;
    this.openInternal(url)
        .then(this._opened.bind(this))
        .catch(this._onError.bind(this));
};

FetchClientBase.prototype.createImageDataContext = function createImageDataContext(
    imagePartParams, contextVars) {
    
    var dataKeys = this.getDataKeysInternal(imagePartParams);
    return new SimpleImageDataContext(contextVars, dataKeys, imagePartParams, this._dataPublisher, this);
};

FetchClientBase.prototype.createRequestFetcher = function createRequestFetcher() {
    return new SimpleFetcher(this, /*isChannel=*/false, this._dataPublisher, this._options);
};

FetchClientBase.prototype.createChannelFetcher = function createChannelFetcher() {
    return new SimpleFetcher(this, /*isChannel=*/true, this._dataPublisher, this._options);
};

FetchClientBase.prototype.close = function close(closedCallback) {
    this._ensureReady();
    
    this._isReady = false;
    
    if (this._statusCallback) {
        this._statusCallback({
            isReady: true,
            exception: null
        });
    }
    
    if (closedCallback) {
        closedCallback();
    }
};

FetchClientBase.prototype.getSizesParams = function getSizesParams(closedCallback) {
    this._ensureReady();
    return this._sizesParams;
};

FetchClientBase.prototype.reconnect = function reconnect() {
    return this.reconnectInternal();
};

FetchClientBase.prototype._ensureReady = function ensureReady() {
    if (!this._isReady) {
        throw 'FetchClientBase error: fetch client is not opened';
    }
};

FetchClientBase.prototype._opened = function opened(sizesParams) {
    this._isReady = true;
    this._sizesParams = sizesParams;
    
    if (this._statusCallback) {
        this._statusCallback({
            isReady: true,
            exception: null
        });
    }
};

FetchClientBase.prototype._onError = function onError(error) {
    // NOTE: Should define API between ImageDecoderFramework and FetchClient for error notifications
};