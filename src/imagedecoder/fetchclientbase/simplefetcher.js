'use strict';

module.exports = SimpleFetcher;

function SimpleFetcher(fetchClient, isChannel, dataPublisher, options) {
    this._fetchClient = fetchClient;
    this._dataPublisher = dataPublisher;
    this._isChannel = isChannel;
    this._stopListeners = [];
    this._fetchLimit = (options || {}).fetchLimitPerFetcher || 2;
    this._keysToFetch = null;
	this._nextKeyToFetch = 0;
    this._activeFetches = {};
    this._activeFetchesCount = 0;
    this._isAborted = false;
    this._isStoppedCalled = false;
}

SimpleFetcher.prototype.fetch = function fetch(imageDataContext) {
    if (!this._isChannel && this._keysToFetch !== null) {
        throw 'SimpleFetcher error: Request fetcher can fetch only one region';
    }
    
    this._keysToFetch = imageDataContext.getDataKeys();
	this._nextKeyToFetch = 0;
    while (this._activeFetchesCount < this._fetchLimit) {
        if (!this._fetchSingleKey()) {
            break;
        }
    }
};

SimpleFetcher.prototype.on = function on(event, listener) {
    if (event !== 'stop') {
        throw 'SimpleFetcher error: Unexpected event ' + event;
    }
    
    this._stopListeners.push(listener);
};

SimpleFetcher.prototype.abortAsync = function abortAsync() {
    if (this._isChannel) {
        throw 'SimpleFetcher error: cannot abort channel fetcher';
    }
    
    if (this._keysToFetch !== null && this._nextKeyToFetch < this._keysToFetch.length) {
        this._isAborted = true;
    }
    this._onAborted(/*isAborted=*/true);
};

SimpleFetcher.prototype._fetchSingleKey = function fetchSingleKey() {
    var key;
    do {
        if (this._nextKeyToFetch >= this._keysToFetch.length) {
            return false;
        }
        key = this._keysToFetch[this._nextKeyToFetch++];
    } while (!this._dataPublisher.isKeyNeedFetch(key));
    
    var self = this;
    this._activeFetches[key] = true;
    ++this._activeFetchesCount;
    
    this._fetchClient.fetchInternal(key)
        .then(function resolved(result) {
            self._dataPublisher.publish(key, result);
            self._fetchEnded(null, key, result);
        }).catch(function failed(reason) {
            self._fetchClient._onError(reason);
            self._fetchEnded(reason, key);
        });
    
    return true;
};

SimpleFetcher.prototype._fetchEnded = function fetchEnded(error, key, result) {
    delete this._activeFetches[key];
    --this._activeFetchesCount;
    
    this._fetchSingleKey();
};

SimpleFetcher.prototype._onAborted = function onStopped(isAborted) {
    if (this._activeFetchesCount === 0 && !this._isStoppedCalled) {
        this._isStoppedCalled = true;
        for (var i = 0; i < this._stopListeners.length; ++i) {
            this._stopListeners[i].call(this, isAborted);
        }
    }
};