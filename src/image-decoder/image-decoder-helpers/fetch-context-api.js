'use strict';

module.exports = FetchContextApi;

function FetchContextApi() {
	this._events = {
		isProgressiveChanged: [],
		move: [],
		terminate: [],
		
		stop: [],
		resume: [],
		
		internalStopped: [],
		internalDone: []
	};
}

FetchContextApi.prototype.stopped = function stopped() {
	this._onEvent('internalStopped', /*isAborted=*/false);
};

FetchContextApi.prototype.done = function done() {
	this._onEvent('internalDone');
};

FetchContextApi.prototype.on = function on(event, listener, listenerThis) {
	var listeners = this._events[event];
	if (!listeners) {
		throw 'imageDecoderFramework error: event ' + event + ' does not exist in FetchContext';
	}
	listeners.push({
		listener: listener,
		listenerThis: listenerThis || this
	});
	
	return this;
};

FetchContextApi.prototype._onEvent = function onEvent(event, arg1, arg2) {
	var listeners = this._events[event];
	for (var i = 0; i < listeners.length; ++i) {
		listeners[i].listener.call(listeners[i].listenerThis, arg1, arg2);
	}
};