'use strict';

module.exports = DataPublisher;

var LinkedList = require('linkedlist.js');
var HashMap = require('hashmap.js');

function DataPublisher(hasher) {
    this._subscribersByKey = new HashMap(hasher);
}

DataPublisher.prototype.publish = function publish(key, data, fetchEnded) {
    var subscribers = this._subscribersByKey.getFromKey(key);
    if (!subscribers) {
        return;
    }
    
    var iterator = subscribers.subscribersList.getFirstIterator();
    var listeners = [];
    while (iterator !== null) {
        var subscriber = subscribers.subscribersList.getValue(iterator);
	
		if (!subscriber.isEnded) {
			listeners.push(subscriber.listener);
			if (fetchEnded) {
				--subscribers.subscribersNotEndedCount;
				subscriber.isEnded = true;
			}
		}
        
        iterator = subscribers.subscribersList.getNextIterator(iterator);
    }
    
    // Call only after collecting all listeners, so the list will not be destroyed while iterating
    for (var i = 0; i < listeners.length; ++i) {
        listeners[i].call(this, key, data, fetchEnded);
    }
};

DataPublisher.prototype.subscribe = function subscribe(key, subscriber) {
    var subscribers = this._subscribersByKey.tryAdd(key, function() {
        return {
            subscribersList: new LinkedList(),
            subscribersNotEndedCount: 0
        };
    });
    
    ++subscribers.value.subscribersNotEndedCount;
    
    var listIterator = subscribers.value.subscribersList.add({
        listener: subscriber,
        isEnded: false
    });
    
    var handle = {
        _listIterator: listIterator,
        _hashIterator: subscribers.iterator
    };
    return handle;
};

DataPublisher.prototype.unsubscribe = function unsubscribe(handle) {
    var subscribers = this._subscribersByKey.getFromIterator(handle._hashIterator);
    
    var subscriber = subscribers.subscribersList.getValue(handle._listIterator);
    subscribers.subscribersList.remove(handle._listIterator);
    if (subscribers.subscribersList.getCount() === 0) {
        this._subscribersByKey.remove(handle._hashIterator);
    } else if (!subscriber.isEnded) {
        --subscribers.subscribersNotEndedCount;
        subscriber.isEnded = true;
    }
};

DataPublisher.prototype.isKeyNeedFetch = function isKeyNeedFetch(key) {
    var subscribers = this._subscribersByKey.getFromKey(key);
    return (!!subscribers) && (subscribers.subscribersNotEndedCount > 0);
};