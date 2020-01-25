'use strict';

module.exports = WorkerProxyFetchManager;

function WorkerProxyFetchManager(fetcher, options) {
    this._options = options || {};
    this._internalSizesParams = null;
    this._tileWidth = 0;
    this._tileHeight = 0;

    asyncProxy.AsyncProxyFactory.initialize(
        this, fetcher.scriptsToImport, 'imageDecoderFramework.FetchManager', [fetcher, options]);
}

asyncProxy.AsyncProxyFactory.addMethods(WorkerProxyFetchManager, {
    close: [{isReturnPromise: true}],
    setPrioritizerType: [],
    setFetchPrioritizerData: [],
    setIsProgressiveRequest: [],
    createMovableFetch: [{isReturnPromise: true}],
    moveFetch: [],
    createRequest: [],
    manualAbortRequest: []
});

WorkerProxyFetchManager.prototype.open = function open(openArg) {
    var self = this;
    var workerHelper = asyncProxy.AsyncProxyFactory.getWorkerHelper(this);

    return workerHelper.callFunction('open', [openArg], { isReturnPromise: true })
        .then(function(data) {
            self._internalSizesParams = data;
            self.getImageParams();
            return data;
        });
};

WorkerProxyFetchManager.prototype.getImageParams = function getImageParams() {
    if (!this._internalSizesParams) {
        throw 'imageDecoderFramework error: not opened yet';
    }
    return this._internalSizesParams;
};

WorkerProxyFetchManager.prototype.on = function on(event, callback) {
    var transferablePaths = this._options.transferablePathsOfDataCallback;
    var workerHelper = asyncProxy.AsyncProxyFactory.getWorkerHelper(this);
    
    var callbackWrapper = workerHelper.wrapCallback(
        callback, event + '-callback', {
            isMultipleTimeCallback: true,
            pathsToTransferables: transferablePaths
        }
    );
    
    return workerHelper.callFunction('on', [event, callbackWrapper]);
};