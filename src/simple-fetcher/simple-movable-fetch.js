'use strict';

var FetchContextApi = require('fetch-context-api.js');

module.exports = SimpleMovableFetch;

var FETCH_STATE_WAIT_FOR_MOVE = 1;
var FETCH_STATE_ACTIVE = 2;
var FETCH_STATE_STOPPING = 3;
var FETCH_STATE_STOPPED = 4;
var FETCH_STATE_TERMINATED = 5;

function SimpleMovableFetch(fetcher, indirectCloseIndication, fetchContext, maxActiveFetchesInMovableFetch) {
    this._fetcher = fetcher;
    this._indirectCloseIndication = indirectCloseIndication;
    this._movableFetchContext = fetchContext;
    this._maxActiveFetchesInMovableFetch = maxActiveFetchesInMovableFetch;
    
    this._lastFetch = null;
    this._activeFetchesInMovableFetch = 0;
    this._pendingImagePartParams = null;
    this._movableState = FETCH_STATE_WAIT_FOR_MOVE;
    
    this._isProgressive = false;
    this._isProgressiveChangedCalled = false;
    
    fetchContext.on('move', this._onMove, this);
    fetchContext.on('terminate', this._onTerminated, this);
    fetchContext.on('isProgressiveChanged', this._onIsProgressiveChanged, this);
    fetchContext.on('stop', this._onStop, this);
    fetchContext.on('resume', this._onResume, this);
}

SimpleMovableFetch.prototype.start = function start(imagePartParams) {
    this._onMove(imagePartParams);
};

SimpleMovableFetch.prototype._onIsProgressiveChanged = function isProgressiveChanged(isProgressive) {
    this._isProgressive = isProgressive;
    var lastActiveFetch = this._getLastFetchActive();
    if (lastActiveFetch !== null) {
        lastActiveFetch._onEvent('isProgressiveChanged', isProgressive);
    } else {
        this._isProgressiveChangedCalled = true;
    }
};

SimpleMovableFetch.prototype._onStop = function stop(isAborted) {
    this._switchState(FETCH_STATE_STOPPING, FETCH_STATE_ACTIVE);
    var lastActiveFetch = this._getLastFetchActive();
    if (lastActiveFetch !== null) {
        lastActiveFetch._onEvent('stop', isAborted);
    }
};

SimpleMovableFetch.prototype._onResume = function resume() {
    this._switchState(FETCH_STATE_ACTIVE, FETCH_STATE_STOPPED, FETCH_STATE_STOPPING);

    if (this._lastFetch === null) {
        throw 'imageDecoderFramework error: resuming non stopped fetch';
    }
    
    if (this._isProgressiveChangedCalled) {
        this._isProgressiveChangedCalled = false;
        this._lastFetch._onEvent('isProgressiveChanged', this._isProgressive);
    }
    this._lastFetch._onEvent('resume');
};

SimpleMovableFetch.prototype._onTerminated = function onTerminated(isAborted) {
    throw 'imageDecoderFramework error: Unexpected termination of movable fetch';
};

SimpleMovableFetch.prototype._onMove = function move(imagePartParams) {
    this._pendingImagePartParams = imagePartParams;
    this._movableState = FETCH_STATE_ACTIVE;
    this._tryStartPendingFetch();
};

SimpleMovableFetch.prototype._tryStartPendingFetch = function tryStartPendingFetch() {
    if (this._indirectCloseIndication.isCloseRequested ||
        this._activeFetchesInMovableFetch >= this._maxActiveFetchesInMovableFetch ||
        this._pendingImagePartParams === null ||
        this._movableState !== FETCH_STATE_ACTIVE) {

            return;
    }
    
    var newFetch = {
        imagePartParams: this._pendingImagePartParams,
        state: FETCH_STATE_ACTIVE,

        fetchContext: null,
        self: this
    };
    
    this._pendingImagePartParams = null;
    ++this._activeFetchesInMovableFetch;
    
    newFetch.fetchContext = new FetchContextApi();
    newFetch.fetchContext.on('internalStopped', onSingleFetchStopped, newFetch);
    newFetch.fetchContext.on('internalDone', onSingleFetchDone, newFetch);
    
    this._fetcher.startFetch(newFetch.fetchContext, newFetch.imagePartParams);
};

SimpleMovableFetch.prototype._singleFetchStopped = function singleFetchStopped(fetch, isDone) {
    --this._activeFetchesInMovableFetch;
    this._lastFetch = null;
    fetch.state = FETCH_STATE_TERMINATED;

    this._tryStartPendingFetch();
};

SimpleMovableFetch.prototype._getLastFetchActive = function getLastFetchActive() {
    if (this._movableState === FETCH_STATE_STOPPED || this._lastFetch === null) {
        return null;
    }
    
    if (this._lastFetch.state === FETCH_STATE_ACTIVE) {
        return this._lastFetch.fetchContext;
    }
    return null;
};

SimpleMovableFetch.prototype._switchState = function switchState(targetState, expectedState, expectedState2, expectedState3) {
    if (this._movableState !== expectedState && this._movableState !== expectedState2 && this._movableState !== expectedState3) {
        throw 'imageDecoderFramework error: Unexpected state ' + this._movableState + ', expected ' + expectedState + ' or ' + expectedState2 + ' or ' + expectedState3;
    }
    this._movableState = targetState;
};

SimpleMovableFetch.prototype._isLastFetch = function isLastFetch(fetch) {
    return this._lastFetch === fetch && this._pendingImagePartParams === null;
};

function onSingleFetchStopped() {
    /* jshint validthis: true */
    var fetch = this;
    var movableFetch = fetch.self;
    
    if (fetch.state !== FETCH_STATE_STOPPING) {
        throw 'imageDecoderFramework error: Unexpected state of fetch ' + fetch.state + ' on stopped';
    }
    
    if (movableFetch._isLastFetch(fetch)) {
        fetch.state = FETCH_STATE_STOPPED;
        movableFetch._switchState(FETCH_STATE_STOPPED, FETCH_STATE_STOPPING);
        movableFetch._movableFetchContext.stopped();
    } else {
        movableFetch._singleFetchStopped(fetch);
    }
}

function onSingleFetchDone() {
    /* jshint validthis: true */
    var fetch = this;
    var movableFetch = fetch.self;

    if (fetch.state !== FETCH_STATE_ACTIVE && fetch.state !== FETCH_STATE_STOPPING) {
        throw 'imageDecoderFramework error: Unexpected state of fetch ' + fetch.state + ' on done';
    }

    fetch.state = FETCH_STATE_TERMINATED;
    if (movableFetch._isLastFetch(fetch)) {
        movableFetch._switchState(FETCH_STATE_WAIT_FOR_MOVE, FETCH_STATE_ACTIVE, FETCH_STATE_STOPPING);
        movableFetch._movableFetchContext.done();
    }
    movableFetch._singleFetchStopped(fetch);
}