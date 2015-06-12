'use strict';

function SimpleFetchContext(contextVars, dataKeys, dataPublisher) {
    this._contextVars = contextVars;
    this._dataByKey = {};
    this._dataKeysFetchedCount = 0;
    this._dataListeners = [];
    this._dataKeys = dataKeys;
    this._dataPublisher = dataPublisher;
    
    this._subscribeHandles = [];
    
    var dataFetchedBound = this._dataFetched.bind(this);
    for (var i = 0; i < dataKeys.length; ++i) {
        var subscribeHandle = this._dataPublisher.subscribe(
            dataKeys[i], dataFetchedBound);
        
        this._subscribeHandles.push(subscribeHandle);
    }
}

SimpleFetchContext.prototype.getDataKeys = function getDataKeys() {
    return this._dataKeys;
};

SimpleFetchContext.prototype.hasData = function hasData() {
    return this.isDone();
};

SimpleFetchContext.prototype.getFetchedData = function getFetchedData() {
    if (!this.hasData()) {
        throw 'SimpleFetchContext error: cannot call getFetchedData before hasData = true';
    }
    
    return this._dataByKey;
};

SimpleFetchContext.prototype.on = function on(event, listener) {
    if (event !== 'data') {
        throw 'SimpleFetchContext error: Unexpected event ' + event;
    }
    
    this._dataListeners.push(listener);
};

SimpleFetchContext.prototype.isDone = function isDone() {
    return this._dataKeysFetchedCount === this._dataKeys.length;
};

SimpleFetchContext.prototype.release = function release() {
    for (var i = 0; i < this._subscribeHandles.length; ++i) {
        this._dataPublisher.unsubscribe(this._subscribeHandles[i]);
    }
    
    this._subscribeHandles = [];
};

SimpleFetchContext.prototype._dataFetched = function dataFetched(key, data) {
    if (!this._dataByKey[key]) {
        ++this._dataKeysFetchedCount;
    }
    
    this._dataByKey[key] = data;
    
    if (this.hasData()) {
        for (var i = 0; i < this._dataListeners.length; ++i) {
            this._dataListeners[i](this, this._contextVars);
        }
    }
};