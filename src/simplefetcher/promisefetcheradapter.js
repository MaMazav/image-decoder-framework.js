'use strict';

module.exports = PromiseFetcherAdapter;

var PromiseFetchAdapterFetchHandle = require('promisefetcheradapterfetchhandle.js');

/* global Promise: false */

function PromiseFetcherAdapter(promiseFetcher, options) {
    this._url = null;
    this._options = options || {};
    this._promiseFetcher = promiseFetcher;
    this._dataListeners = [];
    this._isReady = false;
    this._activeFetches = 0;
    this._resolveClose = null;
    this._rejectClose = null;
}

// Fetcher implementation

PromiseFetcherAdapter.prototype.open = function open(url) {
    var self = this;
    return this._promiseFetcher.open(url).then(function(result) {
        self._isReady = true;
        return result;
    });
};

PromiseFetcherAdapter.prototype.close = function close(closedCallback) {
    this._ensureReady();
    this._isReady = false;
    var self = this;
    return new Promise(function(resolve, reject) {
        self._resolveClose = resolve;
        self._rejectClose = reject;
        self._checkIfClosed();
    });
};

PromiseFetcherAdapter.prototype.reconnect = function reconnect() {
    this._ensureReady();
};

PromiseFetcherAdapter.prototype.on = function on(event, listener) {
    if (event !== 'data') {
        throw 'PromiseFetcherAdapter: Unexpected event ' + event + '. Expected "data"';
    }
    this._dataListeners.push(listener);
};

PromiseFetcherAdapter.prototype.fetch = function fetch(imagePartParams) {
    this._ensureReady();
    ++this._activeFetches;
	var fetchHandle = new PromiseFetchAdapterFetchHandle(imagePartParams);

    var self = this;
    this._promiseFetcher.fetch(imagePartParams)
        .then(function(result) {
            self._afterFetch(fetchHandle, result);
        }).catch(function(reason) {
            self._afterFailedFetch(reason);
        });
	
	return fetchHandle;
};

PromiseFetcherAdapter.prototype.startMovableFetch = function startMovableFetch(imagePartParams, movableFetchState) {
    this._ensureReady();
	
	var fetchHandle = new PromiseFetchAdapterFetchHandle(imagePartParams);
    
    var self = this;
    movableFetchState._currentFetchHandle = null;
    movableFetchState._pendingFetchHandle = fetchHandle;
    movableFetchState._startNextFetch =  startNextFetch;
    
    function startNextFetch(prevFetchResult) {
        if (movableFetchState._currentFetchHandle !== null) {
            var endedFetchHandle = movableFetchState._currentFetchHandle;
            movableFetchState._currentFetchHandle = null;
            self._afterFetch(endedFetchHandle, prevFetchResult);
        }
        
        if (movableFetchState._pendingFetchHandle !== null && self._isReady) {
            ++self._activeFetches;
            movableFetchState._currentFetchHandle = movableFetchState._pendingFetchHandle;
			movableFetchState._pendingFetchHandle = null;
            self._promiseFetcher.fetch(imagePartParams)
                .then(startNextFetch)
                .catch(startNextFetch);
        }
        return prevFetchResult;
    }
    
    startNextFetch();
    
    return fetchHandle;
};

PromiseFetcherAdapter.prototype.moveFetch = function moveFetch(imagePartParams, movableFetchState) {
    this._ensureReady();
	
	var fetchHandle = new PromiseFetchAdapterFetchHandle(imagePartParams);
	
	if (movableFetchState._pendingFetchHandle !== null) {
		movableFetchState._pendingFetchHandle.terminate(/*isAborted=*/true);
	}
    movableFetchState._pendingFetchHandle = fetchHandle;
    if (movableFetchState._currentFetchHandle === null) {
        movableFetchState._startNextFetch();
    }
    
    return fetchHandle;
};

PromiseFetcherAdapter.prototype._ensureReady = function ensureReady() {
    if (!this._isReady) {
        throw 'PromiseFetcherAdapter error: fetch client is not opened';
    }
};

PromiseFetcherAdapter.prototype._checkIfClosed = function checkIfClosed() {
    if (this._activeFetches === 0 && !this._isReady) {
        this._resolveClose();
    }
};

PromiseFetcherAdapter.prototype._afterFetch = function(fetchHandle, result) {
	fetchHandle.terminate(/*isAborted=*/false);
	var imagePartParams = fetchHandle.getImagePartParams();
    --this._activeFetches;
    for (var i = 0; i < this._dataListeners.length; ++i) {
        this._dataListeners[i](result, imagePartParams);
    }
    this._checkIfClosed();
    return result;
};

PromiseFetcherAdapter.prototype._afterFailedFetch = function(reason) {
    --this._activeFetches;
    this._checkIfClosed();
    return reason;
};