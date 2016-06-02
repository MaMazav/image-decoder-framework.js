'use strict';

module.exports = SimpleImageDataContext;

var HashMap = require('hashmap.js');

function SimpleImageDataContext(dataKeys, imagePartParams, dataPublisher, hasher) {
    this._dataByKey = new HashMap(hasher);
    this._dataToReturn = {
        imagePartParams: JSON.parse(JSON.stringify(imagePartParams)),
        fetchedItems: []
    };
	this._maxQuality = imagePartParams.quality;
    this._fetchEndedCount = 0;
	this._fetchedLowQualityCount = 0;
    this._dataListeners = [];
    this._dataKeys = dataKeys;
    this._imagePartParams = imagePartParams;
    this._dataPublisher = dataPublisher;
	this._isProgressive = false;
	this._isDisposed = false;
    
    this._subscribeHandles = [];
    
    var dataFetchedBound = this._dataFetched.bind(this);
    for (var i = 0; i < dataKeys.length; ++i) {
        var subscribeHandle = this._dataPublisher.subscribe(
			{ dataKey: dataKeys[i], maxQuality: this._maxQuality },
			dataFetchedBound);
        
        this._subscribeHandles.push(subscribeHandle);
    }
}

// Not part of ImageDataContext interface, only service for SimpleFetcherBase
SimpleImageDataContext.prototype.getMaxQuality = function getMaxQuality() {
	return this._maxQuality;
};

SimpleImageDataContext.prototype.getDataKeys = function getDataKeys() {
    return this._dataKeys;
};

SimpleImageDataContext.prototype.getImagePartParams = function getImagePartParams() {
    return this._imagePartParams;
};

SimpleImageDataContext.prototype.hasData = function hasData() {
    return this._fetchedLowQualityCount == this._dataKeys.length;
};

SimpleImageDataContext.prototype.getFetchedData = function getFetchedData() {
    if (!this.hasData()) {
        throw 'SimpleImageDataContext error: cannot call getFetchedData before hasData = true';
    }
    
    return this._dataToReturn;
};

SimpleImageDataContext.prototype.on = function on(event, listener) {
	if (this._isDisposed) {
		throw 'Cannot register to event on disposed ImageDataContext';
	}
    if (event !== 'data') {
        throw 'SimpleImageDataContext error: Unexpected event ' + event;
    }
    
    this._dataListeners.push(listener);
};

SimpleImageDataContext.prototype.isDone = function isDone() {
    return this._fetchEndedCount === this._dataKeys.length;
};

SimpleImageDataContext.prototype.dispose = function dispose() {
	this._isDisposed = true;
    for (var i = 0; i < this._subscribeHandles.length; ++i) {
        this._dataPublisher.unsubscribe(this._subscribeHandles[i]);
    }
    
    this._subscribeHandles = [];
	this._dataListeners = [];
};

SimpleImageDataContext.prototype.setIsProgressive = function setIsProgressive(isProgressive) {
	var oldIsProgressive = this._isProgressive;
    this._isProgressive = isProgressive;
	if (!oldIsProgressive && isProgressive && this.hasData()) {
		for (var i = 0; i < this._dataListeners.length; ++i) {
            this._dataListeners[i](this);
        }
	}
};

SimpleImageDataContext.prototype._dataFetched = function dataFetched(key, data, fetchEnded) {
	if (this._isDisposed) {
		throw 'Unexpected dataFetched listener call on disposed ImageDataContext';
	}

	var self = this;
	var added = this._dataByKey.tryAdd(key, function() {
		// Executed if new item
        self._dataToReturn.fetchedItems.push({
            key: key.dataKey,
            data: data
        });
		++self._fetchedLowQualityCount;
		return {
			fetchEnded: false,
			fetchedItemsOffset: self._dataToReturn.fetchedItems.length - 1
		};
	});
	
    if (added.value.fetchEnded) {
		// Already fetched full quality, nothing to refresh
		return;
	}
	
	this._dataToReturn.fetchedItems[added.value.fetchedItemsOffset].data = data;
	if (fetchEnded)
	{
		added.value.fetchEnded = true;
        ++this._fetchEndedCount;
    }
    
    if (this.isDone() || (this.hasData() && this._isProgressive)) {
        for (var i = 0; i < this._dataListeners.length; ++i) {
            this._dataListeners[i](this);
        }
    }
};