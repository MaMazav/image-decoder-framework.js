'use strict';

module.exports = FetchClientBase;

var SimpleFetchContext = require('simplefetchcontext.js');
var SimpleFetcher = require('simplefetcher.js');
var DataPublisher = require('datapublisher.js');

function FetchClientBase(options) {
    this._statusCallback = null;
    this._url = null;
    this._options = options;
    this._isReady = false;
    this._dataPublisher = this.createDataPublisherInternal();
}

// Methods for implementor

FetchClientBase.prototype.getSizesParamsInternal = function getSizesParamsInternal() {
    throw 'FetchClientBase error: getSizesParamsInternal is not implemented';
};

FetchClientBase.prototype.fetchInternal = function fetch(dataKey) {
    throw 'FetchClientBase error: fetchInternal is not implemented';
};

FetchClientBase.prototype.getDataKeysInternal = function getDataKeysInternal(imagePartParams) {
    throw 'FetchClientBase error: getDataKeysInternal is not implemented';
};

FetchClientBase.prototype.createDataPublisherInternal = function createDataPublisherInternal() {
    return new DataPublisher();
};

FetchClientBase.prototype.getUrlInternal = function getUrlInternal() {
    return this._url;
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
    this._isReady = true;
    
    if (this._statusCallback) {
        this._statusCallback({
            isReady: true,
            exception: null
        });
    }
};

FetchClientBase.prototype.createFetchContext = function createFetchContext(
    imagePartParams, contextVars) {
    
    var dataKeys = this.getDataKeysInternal(imagePartParams);
    return new SimpleFetchContext(contextVars, dataKeys, this._dataPublisher);
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
    return this.getSizesParamsInternal();
};

FetchClientBase.prototype.reconnect = function reconnect() {
    // Do nothing
};

FetchClientBase.prototype._ensureReady = function ensureReady() {
    if (!this._isReady) {
        throw 'FetchClientBase error: fetch client is not opened';
    }
};