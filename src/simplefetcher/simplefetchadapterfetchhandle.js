'use strict';

module.exports = SimpleFetchAdapterFetchHandle;

/* global Promise: false */

function SimpleFetchAdapterFetchHandle(imagePartParams, parentFetcher, parentFetchState) {
	this._imagePartParams = imagePartParams;
	this._parentFetcher = parentFetcher;
	this._parentFetchState = parentFetchState;
	this._stopPromise = null;
	this._terminatedListeners = [];
	this._isTerminated = false;
	this._isDisposed = false;
}

SimpleFetchAdapterFetchHandle.prototype._onTerminated = function onTerminated(isAborted) {
	if (this._isTerminated) {
		throw 'imageDecoderFramework error: FetchHandle double terminate';
	}
	this._isTerminated = true;
	for (var i = 0; i < this._terminatedListeners.length; ++i) {
		this._terminatedListeners[i](isAborted);
	}
};

// Fetcher implementation

SimpleFetchAdapterFetchHandle.prototype.stopAsync = function stopAsync() {
	if (this._isTerminated) {
		throw 'imageDecoderFramework error: FetchHandle double terminate';
	}
	if (this._parentFetchState.pendingFetch !== null || this._parentFetchState.pendingFetch.handle === this) {
		this._parentFetchState.isPendingFetchStopped = true;
		return Promise.resolve();
	}
	
	if (this._stopPromise !== null) {
		var self = this;
		this._stopPromise = new Promise(function(resolve, reject) {
			self.on('terminated', resolve);
		});
	}

	return this._stopPromise;
};

SimpleFetchAdapterFetchHandle.prototype.setIsProgressive = function setIsProgressive(isProgressive) {
	// Do nothing
};

SimpleFetchAdapterFetchHandle.prototype.on = function on(event, listener) {
	if (event !== 'terminated') {
		throw 'imageDecoderFramework error: FetchHandle.on with unsupported event ' + event + '. Only terminated event is supported';
	}
	this._terminatedListeners.push(listener);
};

SimpleFetchAdapterFetchHandle.prototype.resume = function resume() {
	if (this._isTerminated) {
		throw 'imageDecoderFramework error: cannot resume stopped FetchHandle';
	}
	if (this._parentFetchState.pendingFetch === null ||
		this._parentFetchState.pendingFetch.handle !== this ||
		!this._parentFetchState.isPendingFetchStopped) {

			throw 'imageDecoderFramework error: FetchHandle is not stopped or already terminated';
	}
	
	this._parentFetchState.isPendingFetchStopped = false;
	this._parentFetcher._startAndTerminateFetches(this._parentFetchState);
};

SimpleFetchAdapterFetchHandle.prototype.dispose = function dispose() {
	if (!this._isTerminated) {
		throw 'imageDecoderFramework error: cannot dispose non-terminated FetchHandle';
	}
	if (this._isDisposed) {
		throw 'imageDecoderFramework error: FetchHandle double dispose';
	}
	this._isDisposed = true;
};
