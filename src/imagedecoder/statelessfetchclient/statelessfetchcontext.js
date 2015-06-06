'use strict';

function StatelessFetchContext(imagePartParams, contextVars) {
    this._imagePartParams = imagePartParams;
    this._contextVars = contextVars;
    this._data = null;
    this._dataListeners = [];
}

StatelessFetchContext.prototype.hasData = function hasData() {
    return this._data !== null;
};

StatelessFetchContext.prototype.getFetchedData = function getFetchedData() {
    if (this._data === null) {
        throw 'StatelessFetchContext error: cannot call getFetchedData before hasData = true';
    }
    
    return this._data;
};

StatelessFetchContext.prototype.on = function on(event, listener) {
    if (event !== 'data') {
        throw 'StatelessFetchContext error: Unexpected event ' + event;
    }
    
    this._dataListeners.push(listener);
};

StatelessFetchContext.prototype.isDone = function isDone() {
    return this._data !== null;
};

StatelessFetchContext.prototype.release = function release() {
    // Do nothing
};

StatelessFetchContext.prototype.fetchEnded = function fetchEnded(result) {
    if (result === null) {
        throw 'StatelessFetchContext error: result must not be null';
    }
    
    this._data = result;
    
    for (var i = 0; i < this._dataListeners.length; ++i) {
        this._dataListeners[i](this, this._contextVars);
    }
};