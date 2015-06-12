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
    
    var iterator = subscribers.getFirstIterator();
    while (iterator !== null) {
        var subscriber = subscribers.getValue(iterator);
        subscriber(key, data);
        
        iterator = subscribers.getNextIterator(iterator);
    }
};

DataPublisher.prototype.subscribe = function subscribe(key, subscriber) {
    var subscribers = this._subscribersByKey[key];
    if (!subscribers) {
        subscribers = new LinkedList();
        this._subscribersByKey[key] = subscribers;
    }
    
    var iterator = subscribers.add(subscriber);
    return {
        _iterator: iterator,
        _key: key
    };
};

DataPublisher.prototype.unsubscribe = function unsubscribe(handle) {
    var subscribers = this._subscribersByKey[handle._key];
    if (!subscribers) {
        throw 'DataPublisher error: subscriber was not registered';
    }
    
    subscribers.remove(handle._iterator);
};