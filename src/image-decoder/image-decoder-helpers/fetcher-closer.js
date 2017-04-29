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
	return new Promise(function(resolve, reject) {
		this._resolveClose = resolve;
		if (this._activeFetches === 0) {
			this._resolveClose();
		}
	});
};