'use strict';

module.exports = HashMap;

var LinkedList = require('linkedlist.js');

function HashMap(hasher) {
    this._byKey = [];
	this._hasher = hasher;
}

HashMap.prototype.getFromKey = function getFromKey(key) {
	var hashCode = this._hasher.getHashCode(key);
    var hashElements = this._byKey[hashCode];
    if (!hashElements) {
		return null;
    }
	
    var iterator = hashElements.getFirstIterator();
    while (iterator !== null) {
        var item = hashElements.getValue(iterator);
        if (this._hasher.isEqual(item.key, key)) {
			return item.value;
		}
        
        iterator = hashElements.getNextIterator(iterator);
    }

	return null;
};

HashMap.prototype.getFromIterator = function getFromIterator(iterator) {
	return iterator._hashElements.getValue(iterator._internalIterator).value;
};

HashMap.prototype.tryAdd = function tryAdd(key, createValue) {
	var hashCode = this._hasher.getHashCode(key);
    var hashElements = this._byKey[hashCode];
    if (!hashElements) {
		hashElements = new LinkedList();
		this._byKey[hashCode] = hashElements ;
    }
	
	var iterator = {
		_hashCode: hashCode,
		_hashElements: hashElements,
		_internalIterator: null
	};
	
    iterator._internalIterator = hashElements.getFirstIterator();
    while (iterator._internalIterator !== null) {
        var item = hashElements.getValue(iterator._internalIterator);
        if (this._hasher.isEqual(item.key, key)) {
			return {
				iterator: iterator,
				isNew: false,
				value: item.value
			};
		}
        
        iterator._internalIterator = hashElements.getNextIterator(iterator._internalIterator);
    }
	
	var value = createValue();
	iterator._internalIterator = hashElements.add({
		key: key,
		value: value
	});
	
	return {
		iterator: iterator,
		isNew: true,
		value: value
	};
};

HashMap.prototype.remove = function remove(iterator) {
	iterator._hashElements.remove(iterator._internalIterator);
	if (iterator._hashElements.getCount() === 0) {
		delete this._byKey[iterator._hashCode];
	}
};