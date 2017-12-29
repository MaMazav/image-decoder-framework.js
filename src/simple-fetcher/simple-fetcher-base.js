'use strict';

var SimpleMovableFetch = require('simple-movable-fetch.js');

module.exports = SimpleFetcherBase;

/* global Promise: false */

function SimpleFetcherBase(options) {
    this._maxActiveFetchesInMovableFetch = (options || {}).maxActiveFetchesInMovableFetch || 2;
    this._indirectCloseIndication = { isCloseRequested: false };
}

SimpleFetcherBase.prototype.startMovableFetch = function startMovableFetch(fetchContext, imagePartParams) {
    var movableFetch = new SimpleMovableFetch(
        this, this._indirectCloseIndication, fetchContext, this._maxActiveFetchesInMovableFetch);
    
    movableFetch.start(imagePartParams);
};

SimpleFetcherBase.prototype.close = function close() {
    if (this.startMovableFetch !== SimpleFetcherBase.prototype.startMovableFetch) {
        throw 'imageDecoderFramework error: Must override Fetcher.close() when Fetcher.startMovableFetch() was overriden';
    }
    this._indirectCloseIndication.isCloseRequested = true;
    return Promise.resolve();
};