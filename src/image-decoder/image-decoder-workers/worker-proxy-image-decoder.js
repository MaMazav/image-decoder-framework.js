'use strict';

var ImageParamsRetrieverProxy = require('image-params-retriever-proxy.js');
var imageHelperFunctions = require('image-helper-functions.js');

module.exports = WorkerProxyImageDecoder;

function WorkerProxyImageDecoder(image, options) {
	ImageParamsRetrieverProxy.call(this);
    
    if ('function' !== typeof image.createLevelCalculator) {
        throw 'imageDecoderFramework error: Missing method image.createLevelCalculator()';
    }
    
	asyncProxy.AsyncProxyFactory.initialize(
        this,
        image.scriptsToImport,
        'imageDecoderFramework.ImageDecoder',
        [{ctorName: image.ctorName}, options]);
	
    this._image = image;
    this._levelCalculator = null;
	this._internalSizesParams = null;
	this._tileWidth = 0;
	this._tileHeight = 0;
}

WorkerProxyImageDecoder.prototype = Object.create(ImageParamsRetrieverProxy.prototype);

asyncProxy.AsyncProxyFactory.addMethods(WorkerProxyImageDecoder, {
	setFetchPrioritizerData: [],
	setDecodePrioritizerData: [],
	setFetchPrioritizerType: [],
	setDecodePrioritizerType: [],
	close: [{isReturnPromise: true}],
	createMovableFetch: [{isReturnPromise: true}],
	requestPixels: [{isReturnPromise: true}]
});

WorkerProxyImageDecoder.prototype.open = function open(url) {
	var self = this;
	var workerHelper = asyncProxy.AsyncProxyFactory.getWorkerHelper(this);
	return workerHelper.callFunction('open', [url], { isReturnPromise: true })
		.then(function(data) {
			self._internalSizesParams = data.sizesParams;
			self._tileWidth = data.applicativeTileWidth;
			self._tileHeight = data.applicativeTileHeight;
			self.getImageParams();
            
            self._levelCalculator = self._image.createLevelCalculator(self);
            imageHelperFunctions.ensureLevelCalculator(self._levelCalculator);
			return data;
		});
};

WorkerProxyImageDecoder.prototype._getImageParamsInternal = function getImageParamsInternal() {
	if (!this._internalSizesParams) {
		throw 'imageDecoderFramework error: not opened yet';
	}
	return this._internalSizesParams;
};

WorkerProxyImageDecoder.prototype.getTileWidth = function getTileWidth() {
	this._getImageParamsInternal(); // ensure already opened
	return this._tileWidth;
};

WorkerProxyImageDecoder.prototype.getTileHeight = function getTileHeight() {
	this._getImageParamsInternal(); // ensure already opened
	return this._tileHeight;
};

WorkerProxyImageDecoder.prototype.onFetcherEvent = function onFetcherEvent(event, callback) {
	var transferables;

	var workerHelper = asyncProxy.AsyncProxyFactory.getWorkerHelper(this);
    
	var internalCallbackWrapper =
		workerHelper.wrapCallback(
			callback, 'onFetcherEventCallback', {
				isMultipleTimeCallback: true,
				pathsToTransferables: transferables
			}
		);
    
    var args = [event, callback];
    
    workerHelper.callFunction('on', args);
};

WorkerProxyImageDecoder.prototype.requestPixelsProgressive = function requestPixelsProgressive(
		imagePartParams,
		callback,
		terminatedCallback,
		imagePartParamsNotNeeded,
		movableHandle) {
	
	var transferables;
	var workerHelper = asyncProxy.AsyncProxyFactory.getWorkerHelper(this);

	// NOTE: Cannot pass it as transferables because it is passed to all
	// listener callbacks, thus after the first one the buffer is not valid
	
	//var pathToPixelsArray = [0, 'pixels', 'buffer'];
	//transferables = [pathToPixelsArray];
	
	var internalCallbackWrapper =
		workerHelper.wrapCallback(
			callback, 'requestPixelsProgressiveCallback', {
				isMultipleTimeCallback: true,
				pathsToTransferables: transferables
			}
		);
	
	var internalTerminatedCallbackWrapper =
		workerHelper.wrapCallback(
			internalTerminatedCallback, 'requestPixelsProgressiveTerminatedCallback', {
				isMultipleTimeCallback: false
			}
		);
			
	var args = [
		imagePartParams,
		internalCallbackWrapper,
		internalTerminatedCallbackWrapper,
		imagePartParamsNotNeeded,
		movableHandle];
	
	workerHelper.callFunction('requestPixelsProgressive', args);
		
	var self = this;
	
	function internalTerminatedCallback(isAborted) {
		workerHelper.freeCallback(internalCallbackWrapper);
		
		terminatedCallback(isAborted);
	}		
};