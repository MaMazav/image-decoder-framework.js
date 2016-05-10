'use strict';

module.exports = SimpleImageDataContext;

var HashMap = require('hashmap.js');

function SimpleImageDataContext(contextVars, dataKeys, imagePartParams, dataPublisher, hasher) {
    this._contextVars = contextVars;
    this._dataByKey = new HashMap(hasher);
    this._dataToReturn = {
        imagePartParams: JSON.parse(JSON.stringify(imagePartParams)),
        fetchedItems: []
    };
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

SimpleImageDataContext.prototype.getDataKeys = function getDataKeys() {
    return this._dataKeys;
};

SimpleImageDataContext.prototype.hasData = function hasData() {
    return this.isDone();
};

SimpleImageDataContext.prototype.getFetchedData = function getFetchedData() {
    if (!this.hasData()) {
        throw 'SimpleImageDataContext error: cannot call getFetchedData before hasData = true';
    }
    
    return this._dataToReturn;
};

SimpleImageDataContext.prototype.on = function on(event, listener) {
    if (event !== 'data') {
        throw 'SimpleImageDataContext error: Unexpected event ' + event;
    }
    
    this._dataListeners.push(listener);
};

SimpleImageDataContext.prototype.isDone = function isDone() {
    return this._dataKeysFetchedCount === this._dataKeys.length;
};

SimpleImageDataContext.prototype.release = function release() {
    for (var i = 0; i < this._subscribeHandles.length; ++i) {
        this._dataPublisher.unsubscribe(this._subscribeHandles[i]);
    }
    
    this._subscribeHandles = [];
};

SimpleImageDataContext.prototype.setIsProgressive = function setIsProgressive(isProgressive) {
    // Do nothing
};

SimpleImageDataContext.prototype._dataFetched = function dataFetched(key, data) {
    if (this._dataByKey.tryAdd(key, function() {}).isNew) {
        ++this._dataKeysFetchedCount;
        this._dataToReturn.fetchedItems.push({
            key: key,
            data: data
        });
    }
    
    if (this.hasData()) {
        for (var i = 0; i < this._dataListeners.length; ++i) {
            this._dataListeners[i](this, this._contextVars);
        }
    }
};