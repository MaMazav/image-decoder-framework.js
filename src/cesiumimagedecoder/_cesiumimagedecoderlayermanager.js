'use strict';

module.exports = CesiumImageDecoderLayerManager;

var CanvasImageryProvider = require('canvasimageryprovider.js');
var ViewerImageDecoder = require('viewerimagedecoder.js');
var calculateFrustum = require('_cesiumfrustumcalculator.js');

/* global Cesium: false */

function CesiumImageDecoderLayerManager(imageImplementationClassName, options) {
	this._options = options || {};
	
	if (this._options.rectangle !== undefined) {
		this._options = JSON.parse(JSON.stringify(options));
		this._options.cartographicBounds = {
			west: options.rectangle.west,
			east: options.rectangle.east,
			south: options.rectangle.south,
			north: options.rectangle.north
		};
	}
	
    this._options.minFunctionCallIntervalMilliseconds =
        options.minFunctionCallIntervalMilliseconds || 100;
    this._url = options.url;

    this._targetCanvas = document.createElement('canvas');
    this._imageryProvider = new CanvasImageryProvider(this._targetCanvas);
    this._imageryLayer = new Cesium.ImageryLayer(this._imageryProvider);

    this._canvasUpdatedCallbackBound = this._canvasUpdatedCallback.bind(this);
    
    this._image = new ViewerImageDecoder(
		imageImplementationClassName,
        this._canvasUpdatedCallbackBound,
        this._options);
    
    this._image.setTargetCanvas(this._targetCanvas);
    
    this._updateFrustumBound = this._updateFrustum.bind(this);
}

CesiumImageDecoderLayerManager.prototype.setExceptionCallback = function setExceptionCallback(exceptionCallback) {
    this._image.setExceptionCallback(exceptionCallback);
};

CesiumImageDecoderLayerManager.prototype.open = function open(widgetOrViewer) {
    this._widget = widgetOrViewer;
    this._layers = widgetOrViewer.scene.imageryLayers;
    
    this._image.open(this._url);
    this._layers.add(this._imageryLayer);
    
    // NOTE: Is there an event handler to register instead?
    // (Cesium's event controllers only expose keyboard and mouse
    // events, but there is no event for frustum changed
    // programmatically).
    this._intervalHandle = setInterval(
        this._updateFrustumBound,
        500);
};

CesiumImageDecoderLayerManager.prototype.close = function close() {
    this._image.close();
    clearInterval(this._intervalHandle);

    this._layers.remove(this._imageryLayer);
};

CesiumImageDecoderLayerManager.prototype.getImageryLayer = function getImageryLayer() {
    return this._imageryLayer;
};

CesiumImageDecoderLayerManager.prototype._updateFrustum = function updateFrustum() {
    var frustum = calculateFrustum(this._widget);
    if (frustum !== null) {
        this._image.updateViewArea(frustum);
    }
};

CesiumImageDecoderLayerManager.prototype._canvasUpdatedCallback = function canvasUpdatedCallback(newPosition) {
    if (newPosition !== null) {
        var rectangle = new Cesium.Rectangle(
            newPosition.west,
            newPosition.south,
            newPosition.east,
            newPosition.north);
        
        this._imageryProvider.setRectangle(rectangle);
    }
    
    this._removeAndReAddLayer();
};

CesiumImageDecoderLayerManager.prototype._removeAndReAddLayer = function removeAndReAddLayer() {
    var index = this._layers.indexOf(this._imageryLayer);
    
    if (index < 0) {
        throw 'Layer was removed from viewer\'s layers  without ' +
            'closing layer manager. Use CesiumImageDecoderLayerManager.' +
            'close() instead';
    }
    
    this._layers.remove(this._imageryLayer, /*destroy=*/false);
    this._layers.add(this._imageryLayer, index);
};