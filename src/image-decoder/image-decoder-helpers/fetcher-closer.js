'use strict';

module.exports = FetcherCloser;

/* global Promise: false */

function FetcherCloser() {
    this._resolveClose = null;
    this._activeFetches = 0;
    this._isClosed = false;
}

FetcherCloser.prototype.changeActiveFetchesCount = function changeActiveFetchesCount(addValue) {
    if (this._isClosed) {
        throw 'imageDecoderFramework error: Unexpected change of active fetches count after closed';
    }
    this._activeFetches += addValue;
    
    if (this._activeFetches === 0 && this._resolveClose) {
        this._isClosed = true;
        this._resolveClose();
    }
};

FetcherCloser.prototype.isCloseRequested = function isCloseRequested() {
    return this._isClosed || (this._resolveClose !== null);
};

FetcherCloser.prototype.close = function close() {
    if (this.isCloseRequested()) {
        throw 'imageDecoderFramework error: close() called twice';
    }
    var self = this;
    return new Promise(function(resolve, reject) {
        self._resolveClose = resolve;
        if (self._activeFetches === 0) {
            self._resolveClose();
        }
    });
};