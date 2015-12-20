'use strict';

function SimpleFetcher(fetchClient, isChannel, dataPublisher, options) {
    this._fetchClient = fetchClient;
    this._dataPublisher = dataPublisher;
    this._isChannel = isChannel;
    this._stopListeners = [];
    this._fetchLimit = (options || {}).fetchLimitPerFetcher || 2;
    this._remainingKeysToFetch = null;
    this._activeFetches = {};
    this._activeFetchesCount = 0;
    this._isAborted = false;
    this._isStoppedCalled = false;
    
    this._fetchSucceededBound = this._fetchSucceeded.bind(this);
    this._fetchFailedBound = this._fetchFailed.bind(this);
}

SimpleFetcher.prototype.fetch = function fetch(fetchContext) {
    if (!this._isChannel && this._remainingKeysToFetch !== null) {
        throw 'SimpleFetcher error: Request fetcher can fetch only one region';
    }
    
    this._remainingKeysToFetch = fetchContext.getDataKeys();
    while (this._activeFetchesCount < this._fetchLimit) {
        if (!this._fetchSingleKey()) {
            break;
        }
    }
    
    this._onStopped();
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
    
    if (this._remainingKeysToFetch.length > 0) {
        this._isAborted = true;
    }
    this._onStopped();
};

SimpleFetcher.prototype._fetchSingleKey = function fetchSingleKey() {
    var key;
    do {
        if (this._remainingKeysToFetch.length === 0) {
            return false;
        }
        key = this._remainingKeysToFetch.pop();
    } while (this._dataPublisher.isKeyNeedFetch(key));
    
    var self = this;
    this._activeFetches[key] = true;
    ++this._activeFetchesCount;
    
    this._fetchClient.fetchInternal(key)
        .then(function resolved(result) {
            self._dataPublisher.publish(key, result);
            self._fetchedEnded(null, key, result);
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
    this._onStopped();
};

SimpleFetcher.prototype._onStopped = function onStopped() {
    if (this._activeFetchesCount === 0 && !this._isStoppedCalled) {
        this._isStoppedCalled = true;
        for (var i = 0; i < this._stopListeners.length; ++i) {
            this._stopListeners[i]();
        }
    }
};