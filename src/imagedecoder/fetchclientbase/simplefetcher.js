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
    
    this._fetchSucceededBound = this._fetchSucceeded.bind(this);
    this._fetchFailedBound = this._fetchFailed.bind(this);
}

SimpleFetcher.prototype.fetch = function fetch(fetchContext) {
    if (!this._isChannel && this._remainingKeysToFetch !== null) {
        throw 'SimpleFetcher error: Cannot fetch while another fetch in progress';
    }
    
    this._remainingKeysToFetch = fetchContext.getDataKeys();
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
    
    this.stopListeners.push(listener);
};

SimpleFetcher.prototype.abortAsync = function abortAsync() {
    if (this._isChannel) {
        throw 'SimpleFetcher error: cannot abort channel fetcher';
    }
    
    // Do nothing
};

SimpleFetcher.prototype._fetchSingleKey = function fetchSingleKey() {
    if (this._remainingKeysToFetch.length === 0) {
        return false;
    }
    
    var self = this;
    var key = this._remainingKeysToFetch.pop();
    this._activeFetches.push(key);
    
    this._fetchClient.fetchInternal(key)
        .then(function resolved(result) {
            self._dataPublisher.publish(key, result);
            self.fetchedEnded(null, key, result);
        }).catch(function failed(reason) {
            // NOTE: Should create an API in ImageDecoderFramework to update on error
            self.fetchEnded(reason, key);
        });
    
    return true;
};

SimpleFetcher.prototype._fetchEnded = function fetchEnded(error, key, result) {
    delete this._activeFetches.key;
    this._fetchSingleKey();
};