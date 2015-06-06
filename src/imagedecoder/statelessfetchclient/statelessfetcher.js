'use strict';

function StatelessFetcher(fetchClient, isChannel) {
    this._fetchClient = fetchClient;
    this._isChannel = isChannel;
    this._stopListeners = [];
    this._activeFetchContext = null;
    this._pendingFetchContext;
    
    this._fetchSucceededBound = this._fetchSucceeded.bind(this);
    this._fetchFailedBound = this._fetchFailed.bind(this);
}

StatelessFetcher.prototype.fetch = function fetch(fetchContext) {
    if (this._activeFetchContext !== null) {
        if (!this._isChannel) {
            throw 'StatelessFetcher error: Cannot fetch while another fetch in progress';
        }
        
        this._pendingFetchContext = fetchContext;
        return;
    }
    
    this._fetchClient.fetchInternal(fetchContext.getImagePartParams())
        .then(this._fetchSucceededBound)
        .catch(this._fetchFailedBound);
};

StatelessFetcher.prototype.on = function on(event, listener) {
    if (event !== 'stop') {
        throw 'StatelessFetcher error: Unexpected event ' + event;
    }
    
    this.stopListeners.push(listener);
};

StatelessFetcher.prototype.abortAsync = function abortAsync() {
    if (this._isChannel) {
        throw 'StatelessFetcher error: cannot abort channel fetcher';
    }
    
    // Do nothing
};

StatelessFetcher.prototype._fetchSucceeded = function fetchSucceeded(result) {
    this._fetchEnded(null, result);
};

StatelessFetcher.prototype._fetchFailed = function fetchFailed(reason) {
    this._fetchEnded(reason);
};

StatelessFetcher.prototype._fetchEnded = function fetchEnded(error, result) {
    if (!error) {
        this._activeFetchContext.fetchEnded(result);
    }
    
    if (this._isChannel) {
        this._activeFetchContext = null;
        
        if (this._pendingFetchContext !== null) {
            var fetchContext = this._pendingFetchContext;
            this.fetch(fetchContext);
            return;
        }
    }
};