'use strict';

module.exports = StatelessFetchClient;

var StatelessFetchContext = require('statelessfetchcontext');
var StatelessFetcher = require('statelessfetcher');

function StatelessFetchClient() {
    this._statusCallback = null;
    this._url = null;
    this._isReady = false;
}

// Methods for implementor

StatelessFetchClient.prototype.getSizesParamsInternal = function getSizesParamsInternal() {
    throw 'StatelessFetchClient error: getSizesParamsInternal is not implemented';
};

StatelessFetchClient.prototype.fetchInternal = function fetch(imagePartParams) {
    throw 'StatelessFetchClient error: fetchInternal is not implemented';
};

StatelessFetchClient.prototype.getUrlInternal = function getUrlInternal() {
    return this._url;
};

// FetchClient implementation

StatelessFetchClient.prototype.setStatusCallback = function setStatusCallback(
    statusCallback) {
    
    this._statusCallback = statusCallback;
};

StatelessFetchClient.prototype.open = function open(url) {
    if (this._url || this._isReady) {
        throw 'StatelessFetchClient error: Cannot open twice';
    }
    
    if (!url) {
        throw 'StatelessFetchClient error: no URL provided';
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

StatelessFetchClient.prototype.createFetchContext = function createFetchContext(
    imagePartParams, contextVars) {
    
    return new StatelessFetchContext(imagePartParams, contextVars);
};

StatelessFetchClient.prototype.createRequestFetcher = function createRequestFetcher() {
    return new StatelessFetcher(this, /*isChannel=*/false);
};

StatelessFetchClient.prototype.createChannelFetcher = function createChannelFetcher() {
    return new StatelessFetcher(this, /*isChannel=*/true);
};

StatelessFetchClient.prototype.close = function close(closedCallback) {
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

StatelessFetchClient.prototype.getSizesParams = function getSizesParams(closedCallback) {
    this._ensureReady();
    return this.getSizesParamsInternal();
};

StatelessFetchClient.prototype.reconnect = function reconnect() {
    // Do nothing
};

StatelessFetchClient.prototype._ensureReady = function ensureReady() {
    if (!this._isReady) {
        throw 'StatelessFetchClient error: fetch client is not opened';
    }
};