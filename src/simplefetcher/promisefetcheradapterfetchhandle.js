'use strict';

module.exports = PromiseFetcherAdapterFetchHandle;

/* global Promise: false */

function PromiseFetcherAdapterFetchHandle(imagePartParams) {
	this._imagePartParams = imagePartParams;
	this._stopPromise = null;
	this._terminatedListeners = [];
	this._isTerminated = false;
	this._isDisposed = false;
}

PromiseFetcherAdapterFetchHandle.prototype.getImagePartParams = function getImagePartParams() {
	return this._imagePartParams;
};

PromiseFetcherAdapterFetchHandle.prototype.terminate = function terminate(isAborted) {
	if (this._isTerminated) {
		throw 'imageDecoderFramework error: FetchHandle double terminate';
	}
	this._isTerminated = true;
	for (var i = 0; i < this._terminatedListeners.length; ++i) {
		this._terminatedListeners[i](isAborted);
	}
};

// Fetcher implementation

PromiseFetcherAdapterFetchHandle.prototype.stopAsync = function stopAsync() {
	if (this._stopPromise !== null) {
		var self = this;
		this._stopPromise = new Promise(function(resolve, reject) {
			self.on('terminated', resolve);
		});
	}

	return this._stopPromise;
};

PromiseFetcherAdapterFetchHandle.prototype.setIsProgressive = function moveFetch(isProgressive) {
	// Do nothing
};

PromiseFetcherAdapterFetchHandle.prototype.on = function on(event, listener) {
	if (event !== 'terminated') {
		throw 'imageDecoderFramework error: FetchHandle.on with unsupported event ' + event + '. Only terminated event is supported';
	}
	this._terminatedListeners.push(listener);
};

PromiseFetcherAdapterFetchHandle.prototype.resume = function resume() {
	if (this._isTerminated) {
		throw 'imageDecoderFramework error: cannot resume stopped FetchHandle';
	}
};

PromiseFetcherAdapterFetchHandle.prototype.dispose = function dispose() {
	if (!this._isTerminated) {
		throw 'imageDecoderFramework error: cannot dispose non-terminated FetchHandle';
	}
	if (this._isDisposed) {
		throw 'imageDecoderFramework error: FetchHandle double dispose';
	}
	this._isDisposed = true;
};
