'use strict';

module.exports = DataPublisher;

var LinkedList = require('linkedlist.js');

function DataPublisher() {
    this._subscribersByKey = {};
}

DataPublisher.prototype.publish = function publish(key, data) {
    var subscribers = this._subscribersByKey[key];
    if (!subscribers) {
        return;
    }
    
    var iterator = subscribers.subscribersList.getFirstIterator();
    while (iterator !== null) {
        var subscriber = subscribers.subscribersList.getValue(iterator);
        subscriber(key, data);
        
        iterator = subscribers.subscribersList.getNextIterator(iterator);
    }
    
    
};

DataPublisher.prototype.subscribe = function subscribe(key, subscriber) {
    var subscribers = this._subscribersByKey[key];
    if (!subscribers) {
        subscribers = {
            subscribersList: new LinkedList(),
            subscribersNeverGotResultCount: 0
        };
        this._subscribersByKey[key] = subscribers;
    }
    
    ++subscribers.subscribersNeverGotResultCount;
    
    var iterator = subscribers.subscribersList.add({
        subscriber: subscriber,
        isGotResult: false
    });
    
    var handle = {
        _iterator: iterator,
        _key: key
    };
    return handle;
};

DataPublisher.prototype.unsubscribe = function unsubscribe(handle) {
    var subscribers = this._subscribersByKey[handle._key];
    if (!subscribers) {
        throw 'DataPublisher error: subscriber was not registered';
    }
    
    var subscriber = subscribers.subscribersList.getValue(handle._iterator);
    subscribers.subscribersList.remove(handle._iterator);
    if (subscribers.subscribersList.getCount() === 0) {
        delete this._subscribersByKey[handle._key];
    } else if (!subscriber.isGotResult) {
        --subscribers.subscribersNeverGotResultCount;
    }
};

DataPublisher.prototype.isKeyNeedFetch = function isKeyNeedFetch(key) {
    var subscribers = this._subscribersByKey[key];
    return (!!subscribers) && (subscribers.subscribersNeverGotResultCount > 0);
};