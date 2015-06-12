var n=function(){function d(a,c,b,f){var k=this;f=f||{};var e=l.toString(),g=m.g(),e=e.replace("SCRIPT_PLACEHOLDER",g),e=URL.createObjectURL(new Blob(["(",e,")()"],{type:"application/javascript"}));this.f=[];this.d=[];this.m=[];this.n=[];this.j=new Worker(e);this.j.onmessage=function(a){h(k,a)};this.o=null;this.h=0;this.r=f.functionsBufferSize||5;this.k=[];this.j.postMessage({p:"ctor",Q:a,I:c,b:b,a:++q,v:!1,N:d.u()})}function l(){importScripts("SCRIPT_PLACEHOLDER");m.C()}function h(a,c){var b=c.data.a;
switch(c.data.type){case "functionCalled":--a.h;p(a);break;case "promiseResult":var f=a.d[b];delete a.d[b];f.resolve(c.data.result);break;case "promiseFailure":f=a.d[b];delete a.d[b];f.reject(c.data.reason);break;case "userData":null!==a.o&&a.o(c.data.W);break;case "callback":b=a.f[c.data.a];if(void 0===b)throw"Unexpected message from SlaveWorker of callback ID: "+c.data.a+". Maybe should indicate isMultipleTimesCallback = true on creation?";b.q||a.t(a.f[c.data.a]);null!==b.s&&b.s.apply(null,c.data.b);
break;case "subWorkerCtor":var b=new Worker(c.data.P),e=c.data.c;a.m[e]=b;a.n.push(b);b.onmessage=function(b){k(a,b.ports,!1,{p:"subWorkerOnMessage",c:e,data:b.data})};break;case "subWorkerPostMessage":b=a.m[c.data.c];b.postMessage(c.data.data);break;case "subWorkerTerminate":b=a.m[c.data.c];b.terminate();break;default:throw"Unknown message from AsyncProxySlave of type: "+c.data.type;}}function k(a,c,b,f){a.h>=a.r?a.k.push({V:c,L:b,message:f}):e(a,c,b,f)}function e(a,c,b,f){b&&++a.h;a.j.postMessage(f,
c)}function p(a){for(;a.h<a.r&&0<a.k.length;){var c=a.k.shift();e(a,c.V,c.L,c.message)}}var q=0,v=!1,r=function(){var a=location.href,c=a.lastIndexOf("/");0<=c&&(a=a.substring(0,c));return a}();d.prototype.U=function(a){this.o=a};d.prototype.terminate=function(){this.j.terminate();for(var a=0;a<this.n.length;++a)this.n[a].terminate()};d.prototype.G=function(a,c,b){b=b||{};var f=!!b.isReturnPromise,d=b.transferables,l=b.pathsToTransferablesInPromiseResult,g=++q,h=null,r=this;f&&(h=new Promise(function(a,
b){r.d[g]={resolve:a,reject:b}}));(b.isSendImmediately?e:k)(this,d,!0,{p:a,b:c||[],a:g,v:f,O:l});if(f)return h};d.prototype.X=function(a,c,b){b=b||{};var f=++q;c={M:!0,q:!!b.isMultipleTimeCallback,a:f,H:c,w:b.pathsToTransferables};this.f[f]={q:!!b.isMultipleTimeCallback,a:f,s:a,w:b.pathsToTransferables};return c};d.prototype.t=function(a){delete this.f[a.a]};d.u=function(){v=!0;return r};d.D=function(a){if(r!==a&&v)throw"Previous values returned from getMasterEntryUrl is wrong. Avoid calling it within the slave c`tor";
r=a};return d}();var t=function(){function d(d){if(null===h)throw"AsyncProxy internal error: SubWorkerEmulationForChrome not initialized";this.i=++l;h[this.i]=this;self.postMessage({type:"subWorkerCtor",c:this.i,P:d})}var l=0,h=null;d.K=function(d){h=d};d.prototype.postMessage=function(d,e){self.postMessage({type:"subWorkerPostMessage",c:this.i,data:d},e)};d.prototype.terminate=function(d,e){self.postMessage({type:"subWorkerTerminate",c:this.i},e)};return d}(),m=function(){function d(){var a=self[r],c=[null].concat(k(arguments));
return new (Function.prototype.bind.apply(a,c))}function l(a,c){if(void 0!==a){for(var b=Array(a.length),f=0;f<a.length;++f){for(var d=a[f],e=c,g=0;g<d.length;++g)e=e[d[g]];b[f]=e}return b}}function h(a){var c=a.data.p,b=a.data.b,f=a.data.a,l=a.data.v,k=a.data.O;switch(c){case "ctor":n.D(a.data.N);f=a.data.Q;r=a.data.I;for(var g=0;g<f.length;++g)importScripts(f[g]);q=d.apply(null,b);return;case "subWorkerOnMessage":v[a.data.c].onmessage({data:a.data.data});return}b=Array(a.data.b.length);for(g=0;g<
a.data.b.length;++g){var h=a.data.b[g];void 0!==h&&null!==h&&h.M&&(h=e.A(h));b[g]=h}for(var g=q,p;g&&!(p=q[c]);)g=g.__proto__;if(!p)throw"AsyncProxy error: could not find function "+p;b=p.apply(q,b);l&&e.B(f,b,k);self.postMessage({type:"functionCalled",a:a.data.a,result:null})}function k(a){for(var c=Array(a.length),b=0;b<a.length;++b)c[b]=a[b];return c}var e={},p=null,q,v={},r;e.C=function(){self.onmessage=h};e.T=function(a){d=a};e.S=function(a){p=a};e.R=function(a){self.postMessage({type:"userData",
W:a})};e.B=function(a,c,b){c.then(function(c){var d=l(b,c);self.postMessage({type:"promiseResult",a:a,result:c},d)})["catch"](function(b){self.postMessage({type:"promiseFailure",a:a,reason:b})})};e.A=function(a){var c=!1;return function(){if(c)throw"Callback is called twice but isMultipleTimeCallback = false";var b=k(arguments);null!==p&&p.call(q,"callback",a.H,b);var d=l(a.w,b);self.postMessage({type:"callback",a:a.a,b:b},d);a.q||(c=!0)}};e.g=function(){return u.g(Error())};void 0===self.Worker&&
(t.K(v),self.Worker=t);return e}();var u=function(){function d(){this.l={};this.e=null}d.prototype.F=function(l){l=d.g(l);this.l[l]||(this.l[l]=!0,this.e=null)};d.prototype.J=function(){if(null===this.e){this.e=[];for(var d in this.l)this.e.push(d)}return this.e};d.g=function(d){var h=d.stack.trim(),k=/at (|[^ ]+ \()([^ ]+):\d+:\d+/.exec(h);if(k&&""!==k[2])return k[2];if((k=(new RegExp(/.+\/(.*?):\d+(:\d+)*$/)).exec(h))&&""!==k[1])return k[1];if(void 0!=d.fileName)return d.fileName;throw"ImageDecoderFramework.js: Could not get current script URL";
};return d}();self.AsyncProxy={};self.AsyncProxy.AsyncProxySlave=m;self.AsyncProxy.AsyncProxyMaster=n;self.AsyncProxy.ScriptsToImportPool=u;t.prototype.postMessage=t.prototype.postMessage;t.prototype.terminate=t.prototype.terminate;m.setSlaveSideCreator=m.T;m.setBeforeOperationListener=m.S;m.sendUserDataToMaster=m.R;m.wrapPromiseFromSlaveSide=m.B;m.wrapCallbackFromSlaveSide=m.A;n.prototype.setUserDataHandler=n.prototype.U;n.prototype.terminate=n.prototype.terminate;n.prototype.callFunction=n.prototype.G;
n.prototype.wrapCallback=n.prototype.X;n.prototype.freeCallback=n.prototype.t;n.getEntryUrl=n.u;u.prototype.addScriptFromErrorWithStackTrace=u.prototype.F;u.prototype.getScriptsForWorkerImport=u.prototype.J;

var n=function(){function b(e,g){this.w=e;this.d=this.m=g;this.l=Array(this.m);this.v=[]}b.prototype={B:function(e,g){if(0<this.d){--this.d;var b=this.l.pop();void 0===b&&(b=this.w());e(b,g)}else this.v.push({t:e,f:g})},F:function(e){if(0<this.v.length){var b=this.v.pop();b.t(e,b.f)}else this.l.push(e),++this.d},G:function(){return!1}};return b}();var p=function(){function b(){this.p={g:null,q:this};this.n={i:null,q:this};this.h=0;this.n.g=this.p;this.p.i=this.n}b.prototype.add=function(e,b){if(null===b||void 0===b)b=this.n;this.o(b);++this.h;var l={K:e,i:b,g:b.g,q:this};l.g.i=l;return b.g=l};b.prototype.remove=function(e){this.o(e);--this.h;e.g.i=e.i;e.i.g=e.g;e.q=null};b.prototype.D=function(e){this.o(e);return e.K};b.prototype.C=function(){return this.r(this.p)};b.prototype.L=function(){return this.M(this.n)};b.prototype.r=function(e){this.o(e);
return e.i===this.n?null:e.i};b.prototype.M=function(e){this.o(e);return e.g===this.p?null:e.g};b.prototype.o=function(e){if(e.q!==this)throw"iterator must be of the current LinkedList";};return b}();var u=function(){function b(a,h,c,d){d=d||{};this.w=a;this.m=h;this.k=c;this.e=d.showLog;this.c=d.schedulerName;this.u=d.numNewJobs||20;this.J=d.numJobsBeforeRerankOldPriorities||20;this.d=this.m;this.l=Array(this.m);this.H=d.resourcesGuaranteedForHighPriority||0;this.j=0;this.b=[];this.a=new p;this.A=0}function e(a,h){for(var c=null,d=h,e=[],f=a.a.C();null!==f;){var b=a.a.r(f),m=a.a.D(f),g=a.k.getPriority(m.f);if(0>g)q(a,f),--a.j,m.s(m.f);else{if(void 0===d||g>d)d=g,c=f;a.e&&(void 0===e[g]?e[g]=
1:++e[g])}f=b}f=null;null!==c&&(f=q(a,c),--a.j);if(a.e){b=c="";void 0!==a.c&&(c=a.c+"'s ",b=a.c+"'s ");c+="Jobs list:";for(m=0;m<e.length;++m)void 0!==e[m]&&(c+=e[m]+" jobs of priority "+m+";");console.log(c);null!==f&&console.log(b+(" dequeued new job of priority "+d))}k(a);return f}function g(a,h,c){++a.j;var d=a.a.C();a.a.add(h,d);t(a);a.e&&(h="",void 0!==a.c&&(h=a.c+"'s "),console.log(h+(" enqueued job of priority "+c)));a.a.h<=a.u||(c=a.a.L(),c=q(a,c),l(a,c));k(a)}function l(a,h){var c=a.k.getPriority(h.f);
0>c?(--a.j,h.s(h.f)):(void 0===a.b[c]&&(a.b[c]=[]),a.b[c].push(h))}function v(a,h){++a.d;var c=a.d<=a.H?a.I:0;--a.d;c=e(a,c);if(null!==c)k(a),r(a,c,h);else if(a.j>a.a.h)a.l.push(h),++a.d;else{for(var d,b=a.b.length-1;0<=b;--b){var f=a.b[b];if(void 0!==f&&0!==f.length){for(var g=f.length-1;0<=g;--g){c=f[g];d=a.k.getPriority(c.f);if(d>=b){f.length=g;break}else 0>d?(--a.j,c.s(c.f)):(void 0===a.b[d]&&(a.b[d]=[]),a.b[d].push(c));c=null}if(null!==c)break;f.length=0}}null===c?(a.l.push(h),++a.d):(a.e&&(b=
"",void 0!==a.c&&(b=a.c+"'s "),console.log(b+(" dequeued old job of priority "+d))),--a.j,k(a),r(a,c,h))}k(a)}function r(a,h,c){++a.A;if(a.A>=a.J){a.A=0;var d=a.b,b=a.a;if(0!==d.length){a.b=[];a.a=new p;for(var f=0;f<d.length;++f)if(void 0!==d[f])for(var e=0;e<d[f].length;++e)l(a,d[f][e]);for(f=b.C();null!==f;)d=b.D(f),l(a,d),f=b.r(f);b="";void 0!==a.c&&(b=a.c+"'s ");b+="rerank: ";for(f=a.b.length-1;0<=f;--f)if(d=a.b[f],void 0!==d){for(a.e&&(b+=d.length+" jobs in priority "+f+";");0<d.length&&a.a.h<
a.u;){var e=d.pop(),g=a;g.a.add(e,void 0);t(g)}if(a.a.h>=a.u&&!a.e)break}a.e&&console.log(b);k(a)}}a.e&&(f="",void 0!==a.c&&(f=a.c+"'s "),a=a.k.getPriority(h.f),console.log(f+(" scheduled job of priority "+a)));h.t(c,h.f)}function q(a,b){var c=a.a.D(b);a.a.remove(b);t(a);return c}function t(a){if(a.e){for(var b=a.a.N(),c=0;null!==b;)++c,b=a.a.r(b);if(c!==a.a.h)throw"Unexpected count of new jobs";}}function k(a){if(a.e){for(var b=0,c=0;c<a.b.length;++c){var d=a.b[c];void 0!==d&&(b+=d.length)}if(b+
a.a.h!==a.j)throw"Unexpected count of jobs";}}b.prototype={B:function(a,b,c){var d=this.k.getPriority(b);0>d?c(b):(a={t:a,s:c,f:b},b=null,d>=(self.d<=self.H?self.I:0)&&(0===this.d?b=null:(--this.d,b=this.l.pop(),void 0===b&&(b=this.w()),k(this))),null!==b?r(this,a,b):(g(this,a,d),k(self)))},F:function(a,b){if(this.e){var c="";void 0!==this.c&&(c=this.c+"'s ");var d=this.k.getPriority(b);console.log(c+(" job done of priority "+d))}v(this,a);k(self)},G:function(a,b,c,d,l){var f=this.k.getPriority(b);
if(0>f)return c(b),v(this,l),!0;var q=e(this,f);k(self);if(null===q)return!1;d(b);g(this,{t:a,s:c,f:b},f);k(self);r(this,q,l);k(self);return!0}};return b}();self.ResourceScheduler={};self.ResourceScheduler.PriorityScheduler=u;self.ResourceScheduler.LifoScheduler=n;u.prototype.enqueueJob=u.prototype.B;u.prototype.tryYield=u.prototype.G;u.prototype.jobDone=u.prototype.F;n.prototype.enqueueJob=n.prototype.B;n.prototype.tryYield=n.prototype.G;n.prototype.jobDone=n.prototype.F;

(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.imageDecoder = f()}})(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
'use strict';

module.exports.ViewerImageDecoder = require('viewerimagedecoder.js');
module.exports.ImageDecoder = require('imagedecoder.js');
module.exports.FetchClientBase = require('fetchclientbase.js');
module.exports.ImageDecoderImageryProvider = require('imagedecoderimageryprovider.js');
module.exports.CesiumImageDecoderLayerManager = require('_cesiumimagedecoderlayermanager.js');
module.exports.ImageDecoderRegionLayer = require('imagedecoderregionlayer.js');
},{"_cesiumimagedecoderlayermanager.js":3,"fetchclientbase.js":7,"imagedecoder.js":10,"imagedecoderimageryprovider.js":5,"imagedecoderregionlayer.js":22,"viewerimagedecoder.js":21}],2:[function(require,module,exports){
'use strict';

module.exports = calculateFrustum;

/* global Cesium: false */

var imageHelperFunctions = require('imagehelperfunctions.js');

var MAX_RECURSIVE_LEVEL_ON_FAILED_TRANSFORM = 4;

function calculateFrustum(cesiumWidget) {
    var screenSize = {
        x: cesiumWidget.scene.canvas.width,
        y: cesiumWidget.scene.canvas.height
    };
    
    var points = [];
    searchBoundingPoints(
        0, 0, screenSize.x, screenSize.y, points, cesiumWidget, /*recursive=*/0);

    var frustumRectangle = Cesium.Rectangle.fromCartographicArray(points);

    var frustumData = imageHelperFunctions.calculateFrustum2DFromBounds(
        frustumRectangle, screenSize);
                
    return frustumData;
}
    
function searchBoundingPoints(
    minX, minY, maxX, maxY, points, cesiumWidget, recursiveLevel) {
    
    var transformedPoints = 0;
    transformedPoints += transformAndAddPoint(
        minX, minY, cesiumWidget, points);
    transformedPoints += transformAndAddPoint(
        maxX, minY, cesiumWidget, points);
    transformedPoints += transformAndAddPoint(
        minX, maxY, cesiumWidget, points);
    transformedPoints += transformAndAddPoint(
        maxX, maxY, cesiumWidget, points);

    var maxLevel = MAX_RECURSIVE_LEVEL_ON_FAILED_TRANSFORM;
    
    if (transformedPoints === 4 || recursiveLevel >= maxLevel) {
        return;
    }
    
    ++recursiveLevel;
    
    var middleX = (minX + maxX) / 2;
    var middleY = (minY + maxY) / 2;
    
    searchBoundingPoints(
        minX, minY, middleX, middleY, points, cesiumWidget, recursiveLevel);

    searchBoundingPoints(
        minX, middleY, middleX, maxY, points, cesiumWidget, recursiveLevel);

    searchBoundingPoints(
        middleX, minY, maxX, middleY, points, cesiumWidget, recursiveLevel);

    searchBoundingPoints(
        middleX, middleY, maxX, maxY, points, cesiumWidget, recursiveLevel);
}

function transformAndAddPoint(x, y, cesiumWidget, points) {
    
    var screenPoint = new Cesium.Cartesian2(x, y);
    var ellipsoid = cesiumWidget.scene.mapProjection.ellipsoid;
    var point3D = cesiumWidget.scene.camera.pickEllipsoid(screenPoint, ellipsoid);
    
    if (point3D === undefined) {
        return 0;
    }

    var cartesian = ellipsoid.cartesianToCartographic(point3D);
    if (cartesian === undefined) {
        return 0;
    }
    
    points.push(cartesian);
    return 1;
}
},{"imagehelperfunctions.js":15}],3:[function(require,module,exports){
'use strict';

module.exports = CesiumImageDecoderLayerManager;

var CanvasImageryProvider = require('canvasimageryprovider.js');
var ViewerImageDecoder = require('viewerimagedecoder.js');
var CesiumFrustumCalculator = require('_cesiumfrustumcalculator.js');

/* global Cesium: false */

function CesiumImageDecoderLayerManager(options) {
    this._options = Object.create(options);
    this._options.minFunctionCallIntervalMilliseconds =
        options.minFunctionCallIntervalMilliseconds || 100;
    this._url = options.url;

    this._targetCanvas = document.createElement('canvas');
    this._imageryProvider = new CanvasImageryProvider(this._targetCanvas);
    this._imageryLayer = new Cesium.ImageryLayer(this._imageryProvider);

    this._canvasUpdatedCallbackBound = this._canvasUpdatedCallback.bind(this);
    
    this._image = new ViewerImageDecoder(
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
    var frustum = CesiumFrustumCalculator.calculateFrustum(this._widget);
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
},{"_cesiumfrustumcalculator.js":2,"canvasimageryprovider.js":4,"viewerimagedecoder.js":21}],4:[function(require,module,exports){
'use strict';

module.exports = CanvasImageryProvider;

/* global Cesium: false */
/* global DeveloperError: false */
/* global Credit: false */

/**
 * Provides a Single Canvas imagery tile.  The image is assumed to use a
 * {@link GeographicTilingScheme}.
 *
 * @alias CanvasImageryProvider
 * @constructor
 *
 * @param {canvas} Canvas for the tile.
 * @param {Object} options Object with the following properties:
 * @param {Credit|String} [options.credit] A credit for the data source, which is displayed on the canvas.
 *
 * @see ArcGisMapServerImageryProvider
 * @see BingMapsImageryProvider
 * @see GoogleEarthImageryProvider
 * @see OpenStreetMapImageryProvider
 * @see TileMapServiceImageryProvider
 * @see WebMapServiceImageryProvider
 */
function CanvasImageryProvider(canvas, options) {
    if (options === undefined) {
        options = {};
    }

    //>>includeStart('debug', pragmas.debug);
    if (canvas === undefined) {
        throw new DeveloperError('canvas is required.');
    }
    //>>includeEnd('debug');

    this._canvas = canvas;

    this._errorEvent = new Event('CanvasImageryProviderStatus');

    this._ready = false;

    var credit = options.credit;
    if (typeof credit === 'string') {
        credit = new Credit(credit);
    }
    this._credit = credit;
}

CanvasImageryProvider.prototype = {
    /**
     * Gets the width of each tile, in pixels. This function should
     * not be called before {@link CanvasImageryProvider#ready} returns true.
     * @memberof CanvasImageryProvider.prototype
     * @type {Number}
     * @readonly
     */
    get tileWidth() {
            //>>includeStart('debug', pragmas.debug);
            if (!this._ready) {
                    throw new DeveloperError('tileWidth must not be called before the imagery provider is ready.');
            }
            //>>includeEnd('debug');

            return this._canvas.width;
    },

    /**
     * Gets the height of each tile, in pixels.  This function should
     * not be called before {@link CanvasImageryProvider#ready} returns true.
     * @memberof CanvasImageryProvider.prototype
     * @type {Number}
     * @readonly
     */
    get tileHeight() {
            //>>includeStart('debug', pragmas.debug);
            if (!this._ready) {
                    throw new DeveloperError('tileHeight must not be called before the imagery provider is ready.');
            }
            //>>includeEnd('debug');

            return this._canvas.height;
    },

    /**
     * Gets the maximum level-of-detail that can be requested.  This function should
     * not be called before {@link CanvasImageryProvider#ready} returns true.
     * @memberof CanvasImageryProvider.prototype
     * @type {Number}
     * @readonly
     */
    get maximumLevel() {
            //>>includeStart('debug', pragmas.debug);
            if (!this._ready) {
                    throw new DeveloperError('maximumLevel must not be called before the imagery provider is ready.');
            }
            //>>includeEnd('debug');

            return 0;
    },

    /**
     * Gets the minimum level-of-detail that can be requested.  This function should
     * not be called before {@link CanvasImageryProvider#ready} returns true.
     * @memberof CanvasImageryProvider.prototype
     * @type {Number}
     * @readonly
     */
    get minimumLevel() {
            //>>includeStart('debug', pragmas.debug);
            if (!this._ready) {
                    throw new DeveloperError('minimumLevel must not be called before the imagery provider is ready.');
            }
            //>>includeEnd('debug');

            return 0;
    },

    /**
     * Gets the tiling scheme used by this provider.  This function should
     * not be called before {@link CanvasImageryProvider#ready} returns true.
     * @memberof CanvasImageryProvider.prototype
     * @type {TilingScheme}
     * @readonly
     */
    get tilingScheme() {
            //>>includeStart('debug', pragmas.debug);
            if (!this._ready) {
                    throw new DeveloperError('tilingScheme must not be called before the imagery provider is ready.');
            }
            //>>includeEnd('debug');

            return this._tilingScheme;
    },

    /**
     * Gets the rectangle, in radians, of the imagery provided by this instance.  This function should
     * not be called before {@link CanvasImageryProvider#ready} returns true.
     * @memberof CanvasImageryProvider.prototype
     * @type {Rectangle}
     * @readonly
     */
    get rectangle() {
            return this._tilingScheme.rectangle;
    },

    /**
     * Gets the tile discard policy.  If not undefined, the discard policy is responsible
     * for filtering out "missing" tiles via its shouldDiscardImage function.  If this function
     * returns undefined, no tiles are filtered.  This function should
     * not be called before {@link CanvasImageryProvider#ready} returns true.
     * @memberof CanvasImageryProvider.prototype
     * @type {TileDiscardPolicy}
     * @readonly
     */
    get tileDiscardPolicy() {
            //>>includeStart('debug', pragmas.debug);
            if (!this._ready) {
                    throw new DeveloperError('tileDiscardPolicy must not be called before the imagery provider is ready.');
            }
            //>>includeEnd('debug');

            return undefined;
    },

    /**
     * Gets an event that is raised when the imagery provider encounters an asynchronous error.  By subscribing
     * to the event, you will be notified of the error and can potentially recover from it.  Event listeners
     * are passed an instance of {@link TileProviderError}.
     * @memberof CanvasImageryProvider.prototype
     * @type {Event}
     * @readonly
     */
    get errorEvent() {
            return this._errorEvent;
    },

    /**
     * Gets a value indicating whether or not the provider is ready for use.
     * @memberof CanvasImageryProvider.prototype
     * @type {Boolean}
     * @readonly
     */
    get ready() {
            return this._ready;
    },

    /**
     * Gets the credit to display when this imagery provider is active.  Typically this is used to credit
     * the source of the imagery.  This function should not be called before {@link CanvasImageryProvider#ready} returns true.
     * @memberof CanvasImageryProvider.prototype
     * @type {Credit}
     * @readonly
     */
    get credit() {
            return this._credit;
    },

    /**
     * Gets a value indicating whether or not the images provided by this imagery provider
     * include an alpha channel.  If this property is false, an alpha channel, if present, will
     * be ignored.  If this property is true, any images without an alpha channel will be treated
     * as if their alpha is 1.0 everywhere.  When this property is false, memory usage
     * and texture upload time are reduced.
     * @memberof CanvasImageryProvider.prototype
     * @type {Boolean}
     * @readonly
     */
    get hasAlphaChannel() {
            return true;
    }
};

CanvasImageryProvider.prototype.setRectangle = function setRectangle(rectangle) {
    
    this._tilingScheme = new Cesium.GeographicTilingScheme({
        rectangle: rectangle,
        numberOfLevelZeroTilesX: 1,
        numberOfLevelZeroTilesY: 1
    });
    
    if (!this._ready) {
        this._ready = true;
        Cesium.TileProviderError.handleSuccess(this._errorEvent);
    }
};

CanvasImageryProvider.prototype.getTileWidth = function getTileWidth() {
    return this.tileWidth;
};

CanvasImageryProvider.prototype.getTileHeight = function getTileHeight() {
    return this.tileHeight;
};

CanvasImageryProvider.prototype.getMaximumLevel = function getMaximumLevel() {
    return this.maximumLevel;
};

CanvasImageryProvider.prototype.getMinimumLevel = function getMinimumLevel() {
    return this.minimumLevel;
};

CanvasImageryProvider.prototype.isReady = function isReady() {
    return this.ready;
};

CanvasImageryProvider.prototype.getCredit = function getCredit() {
    return this.credit;
};

CanvasImageryProvider.prototype.getRectangle = function getRectangle() {
    return this.tilingScheme.rectangle;
};

CanvasImageryProvider.prototype.getTilingScheme = function getTilingScheme() {
    return this.tilingScheme;
};

CanvasImageryProvider.prototype.getTileDiscardPolicy = function getTileDiscardPolicy() {
    return this.tileDiscardPolicy;
};

CanvasImageryProvider.prototype.getErrorEvent = function getErrorEvent() {
    return this.errorEvent;
};

CanvasImageryProvider.prototype.getHasAlphaChannel = function getHasAlphaChannel() {
    return this.hasAlphaChannel;
};

/**
 * Gets the credits to be displayed when a given tile is displayed.
 *
 * @param {Number} x The tile X coordinate.
 * @param {Number} y The tile Y coordinate.
 * @param {Number} level The tile level;
 * @returns {Credit[]} The credits to be displayed when the tile is displayed.
 *
 * @exception {DeveloperError} <code>getTileCredits</code> must not be called before the imagery provider is ready.
 */
CanvasImageryProvider.prototype.getTileCredits = function(x, y, level) {
    return undefined;
};

/**
 * Requests the image for a given tile.  This function should
 * not be called before {@link CanvasImageryProvider#ready} returns true.
 *
 * @param {Number} x The tile X coordinate.
 * @param {Number} y The tile Y coordinate.
 * @param {Number} level The tile level.
 * @returns {Promise} A promise for the image that will resolve when the image is available, or
 *          undefined if there are too many active requests to the server, and the request
 *          should be retried later.  The resolved image may be either an
 *          Image or a Canvas DOM object.
 *
 * @exception {DeveloperError} <code>requestImage</code> must not be called before the imagery provider is ready.
 */
CanvasImageryProvider.prototype.requestImage = function(x, y, level) {
    //>>includeStart('debug', pragmas.debug);
    if (!this._ready) {
            throw new DeveloperError('requestImage must not be called before the imagery provider is ready.');
    }
    //>>includeEnd('debug');

    return this._canvas;
};

/**
 * Picking features is not currently supported by this imagery provider, so this function simply returns
 * undefined.
 *
 * @param {Number} x The tile X coordinate.
 * @param {Number} y The tile Y coordinate.
 * @param {Number} level The tile level.
 * @param {Number} longitude The longitude at which to pick features.
 * @param {Number} latitude  The latitude at which to pick features.
 * @return {Promise} A promise for the picked features that will resolve when the asynchronous
 *                   picking completes.  The resolved value is an array of {@link ImageryLayerFeatureInfo}
 *                   instances.  The array may be empty if no features are found at the given location.
 *                   It may also be undefined if picking is not supported.
 */
CanvasImageryProvider.prototype.pickFeatures = function() {
        return undefined;
};
},{}],5:[function(require,module,exports){
'use strict';

module.exports = ImageDecoderImageryProvider;

var WorkerProxyImageDecoder = require('workerproxyimagedecoder.js');
var CesiumFrustumCalculator = require('_cesiumfrustumcalculator.js');
var imageHelperFunctions = require('imagehelperfunctions.js');

/* global Cesium: false */
/* global DeveloperError: false */
/* global Credit: false */
/* global Promise: false */

/**
 * Provides a ImageDecoder client imagery tile.  The image is assumed to use a
 * {@link GeographicTilingScheme}.
 *
 * @alias ImageDecoderImageryProvider
 * @constructor
 *
 * @param {Object} options Object with the following properties:
 * @param {String} options.url The url for the tile.
 * @param {Rectangle} [options.rectangle=Rectangle.MAX_VALUE] The rectangle, in radians, covered by the image.
 * @param {Credit|String} [options.credit] A credit for the data source, which is displayed on the canvas.
 * @param {Object} [options.proxy] A proxy to use for requests. This object is expected to have a getURL function which returns the proxied URL, if needed.
 * @param {boolean} [options.adaptProportions] determines if to adapt the proportions of the rectangle provided to the image pixels proportions.
 *
 * @see ArcGisMapServerImageryProvider
 * @see BingMapsImageryProvider
 * @see GoogleEarthImageryProvider
 * @see OpenStreetMapImageryProvider
 * @see TileMapServiceImageryProvider
 * @see WebMapServiceImageryProvider
 */
function ImageDecoderImageryProvider(options) {
    if (options === undefined) {
        options = {};
    }

    var url = options.url;
    var adaptProportions = options.adaptProportions;
    this._rectangle = options.rectangle;
    this._proxy = options.proxy;
    this._maxNumQualityLayers = options.maxNumQualityLayers;
    this._updateFrustumInterval = 1000 || options.updateFrustumInterval;
    this._credit = options.credit;
    
    if (typeof this._credit === 'string') {
        this._credit = new Credit(this._credit);
    }
    
    if (this._rectangle === undefined) {
        this._rectangle = Cesium.Rectangle.fromDegrees(-180, -90, 180, 90);
    }
    
    if (adaptProportions === undefined) {
        adaptProportions = true;
    }

    //>>includeStart('debug', pragmas.debug);
    if (url === undefined) {
            throw new DeveloperError('url is required.');
    }
    //>>includeEnd('debug');

    this._url = url;

    this._tilingScheme = undefined;

    this._tileWidth = 0;
    this._tileHeight = 0;

    this._errorEvent = new Event('ImageDecoderImageryProviderStatus');

    this._ready = false;
    this._statusCallback = null;
    this._cesiumWidget = null;
    this._updateFrustumIntervalHandle = null;
    

    var imageUrl = url;
    if (this._proxy !== undefined) {
        // NOTE: Is that the correct logic?
        imageUrl = this._proxy.getURL(imageUrl);
    }
        
    this._image = new WorkerProxyImageDecoder({
        serverRequestPrioritizer: 'frustum',
        decodePrioritizer: 'frustum'
    });

    this._url = imageUrl;
}

ImageDecoderImageryProvider.prototype = {
    /**
     * Gets the URL of the ImageDecoder server (including target).
     * @memberof ImageDecoderImageryProvider.prototype
     * @type {String}
     * @readonly
     */
    get url() {
        return this._url;
    },

    /**
     * Gets the proxy used by this provider.
     * @memberof ImageDecoderImageryProvider.prototype
     * @type {Proxy}
     * @readonly
     */
    get proxy() {
        return this._proxy;
    },

    /**
     * Gets the width of each tile, in pixels. This function should
     * not be called before {@link ImageDecoderImageryProvider#ready} returns true.
     * @memberof ImageDecoderImageryProvider.prototype
     * @type {Number}
     * @readonly
     */
    get tileWidth() {
        //>>includeStart('debug', pragmas.debug);
        if (!this._ready) {
                throw new DeveloperError('tileWidth must not be called before the imagery provider is ready.');
        }
        //>>includeEnd('debug');

        return this._tileWidth;
    },

    /**
     * Gets the height of each tile, in pixels.  This function should
     * not be called before {@link ImageDecoderImageryProvider#ready} returns true.
     * @memberof ImageDecoderImageryProvider.prototype
     * @type {Number}
     * @readonly
     */
    get tileHeight() {
        //>>includeStart('debug', pragmas.debug);
        if (!this._ready) {
                throw new DeveloperError('tileHeight must not be called before the imagery provider is ready.');
        }
        //>>includeEnd('debug');

        return this._tileHeight;
    },

    /**
     * Gets the maximum level-of-detail that can be requested.  This function should
     * not be called before {@link ImageDecoderImageryProvider#ready} returns true.
     * @memberof ImageDecoderImageryProvider.prototype
     * @type {Number}
     * @readonly
     */
    get maximumLevel() {
        //>>includeStart('debug', pragmas.debug);
        if (!this._ready) {
                throw new DeveloperError('maximumLevel must not be called before the imagery provider is ready.');
        }
        //>>includeEnd('debug');

        return this._numResolutionLevels - 1;
    },

    /**
     * Gets the minimum level-of-detail that can be requested.  This function should
     * not be called before {@link ImageDecoderImageryProvider#ready} returns true.
     * @memberof ImageDecoderImageryProvider.prototype
     * @type {Number}
     * @readonly
     */
    get minimumLevel() {
        //>>includeStart('debug', pragmas.debug);
        if (!this._ready) {
                throw new DeveloperError('minimumLevel must not be called before the imagery provider is ready.');
        }
        //>>includeEnd('debug');

        return 0;
    },

    /**
     * Gets the tiling scheme used by this provider.  This function should
     * not be called before {@link ImageDecoderImageryProvider#ready} returns true.
     * @memberof ImageDecoderImageryProvider.prototype
     * @type {TilingScheme}
     * @readonly
     */
    get tilingScheme() {
        //>>includeStart('debug', pragmas.debug);
        if (!this._ready) {
            throw new DeveloperError('tilingScheme must not be called before the imagery provider is ready.');
        }
        //>>includeEnd('debug');

        return this._tilingScheme;
    },

    /**
     * Gets the rectangle, in radians, of the imagery provided by this instance.  This function should
     * not be called before {@link ImageDecoderImageryProvider#ready} returns true.
     * @memberof ImageDecoderImageryProvider.prototype
     * @type {Rectangle}
     * @readonly
     */
    get rectangle() {
        return this._tilingScheme.rectangle;
    },

    /**
     * Gets the tile discard policy.  If not undefined, the discard policy is responsible
     * for filtering out "missing" tiles via its shouldDiscardImage function.  If this function
     * returns undefined, no tiles are filtered.  This function should
     * not be called before {@link ImageDecoderImageryProvider#ready} returns true.
     * @memberof ImageDecoderImageryProvider.prototype
     * @type {TileDiscardPolicy}
     * @readonly
     */
    get tileDiscardPolicy() {
        //>>includeStart('debug', pragmas.debug);
        if (!this._ready) {
            throw new DeveloperError('tileDiscardPolicy must not be called before the imagery provider is ready.');
        }
        //>>includeEnd('debug');

        return undefined;
    },

    /**
     * Gets an event that is raised when the imagery provider encounters an asynchronous error.  By subscribing
     * to the event, you will be notified of the error and can potentially recover from it.  Event listeners
     * are passed an instance of {@link TileProviderError}.
     * @memberof ImageDecoderImageryProvider.prototype
     * @type {Event}
     * @readonly
     */
    get errorEvent() {
        return this._errorEvent;
    },

    /**
     * Gets a value indicating whether or not the provider is ready for use.
     * @memberof ImageDecoderImageryProvider.prototype
     * @type {Boolean}
     * @readonly
     */
    get ready() {
        return this._ready;
    },

    /**
     * Gets the credit to display when this imagery provider is active.  Typically this is used to credit
     * the source of the imagery.  This function should not be called before {@link ImageDecoderImageryProvider#ready} returns true.
     * @memberof ImageDecoderImageryProvider.prototype
     * @type {Credit}
     * @readonly
     */
    get credit() {
        return this._credit;
    },

    /**
     * Gets a value indicating whether or not the images provided by this imagery provider
     * include an alpha channel.  If this property is false, an alpha channel, if present, will
     * be ignored.  If this property is true, any images without an alpha channel will be treated
     * as if their alpha is 1.0 everywhere.  When this property is false, memory usage
     * and texture upload time are reduced.
     * @memberof ImageDecoderImageryProvider.prototype
     * @type {Boolean}
     * @readonly
     */
    get hasAlphaChannel() {
        return true;
    }
};

ImageDecoderImageryProvider.prototype.setExceptionCallback =
    function setExceptionCallback(exceptionCallback) {
    
    this._exceptionCallback = exceptionCallback;
};

ImageDecoderImageryProvider.prototype.open = function open(widgetOrViewer) {
    if (this._updateFrustumIntervalHandle !== null) {
        throw new DeveloperError('Cannot set two parent viewers.');
    }
    
    if (widgetOrViewer === undefined) {
        throw new DeveloperError('widgetOrViewer should be given. It is ' +
            'needed for frustum calculation for the priority mechanism');
    }
    
    this._image.setStatusCallback(this._statusCallback.bind(this));
    this._image.open(this._url);
    
    this._cesiumWidget = widgetOrViewer;
    
    this._updateFrustumIntervalHandle = setInterval(
        this._setPriorityByFrustum.bind(this),
        this._updateFrustumInterval);
};

ImageDecoderImageryProvider.prototype.close = function close() {
    clearInterval(this._updateFrustumIntervalHandle);
    this._image.close();
};

ImageDecoderImageryProvider.prototype.getTileWidth = function getTileWidth() {
    return this.tileWidth;
};

ImageDecoderImageryProvider.prototype.getTileHeight = function getTileHeight() {
    return this.tileHeight;
};

ImageDecoderImageryProvider.prototype.getMaximumLevel = function getMaximumLevel() {
    return this.maximumLevel;
};

ImageDecoderImageryProvider.prototype.getMinimumLevel = function getMinimumLevel() {
    return this.minimumLevel;
};

ImageDecoderImageryProvider.prototype.getUrl = function getUrl() {
    return this.url;
};

ImageDecoderImageryProvider.prototype.getProxy = function getProxy() {
    return this.proxy;
};

ImageDecoderImageryProvider.prototype.isReady = function isReady() {
    return this.ready;
};

ImageDecoderImageryProvider.prototype.getCredit = function getCredit() {
    return this.credit;
};

ImageDecoderImageryProvider.prototype.getRectangle = function getRectangle() {
    return this.tilingScheme.rectangle;
};

ImageDecoderImageryProvider.prototype.getTilingScheme = function getTilingScheme() {
    return this.tilingScheme;
};

ImageDecoderImageryProvider.prototype.getTileDiscardPolicy = function getTileDiscardPolicy() {
    return this.tileDiscardPolicy;
};

ImageDecoderImageryProvider.prototype.getErrorEvent = function getErrorEvent() {
    return this.errorEvent;
};

ImageDecoderImageryProvider.prototype.getHasAlphaChannel = function getHasAlphaChannel() {
    return this.hasAlphaChannel;
};

/**
 * Gets the credits to be displayed when a given tile is displayed.
 *
 * @param {Number} x The tile X coordinate.
 * @param {Number} y The tile Y coordinate.
 * @param {Number} level The tile level;
 * @returns {Credit[]} The credits to be displayed when the tile is displayed.
 *
 * @exception {DeveloperError} <code>getTileCredits</code> must not be called before the imagery provider is ready.
 */
ImageDecoderImageryProvider.prototype.getTileCredits = function(x, y, level) {
    return undefined;
};

/**
 * Requests the image for a given tile.  This function should
 * not be called before {@link ImageDecoderImageryProvider#ready} returns true.
 *
 * @param {Number} x The tile X coordinate.
 * @param {Number} y The tile Y coordinate.
 * @param {Number} level The tile level.
 * @returns {Promise} A promise for the image that will resolve when the image is available, or
 *          undefined if there are too many active requests to the server, and the request
 *          should be retried later.  The resolved image may be either an
 *          Image or a Canvas DOM object.
 *
 * @exception {DeveloperError} <code>requestImage</code> must not be called before the imagery provider is ready.
 */
ImageDecoderImageryProvider.prototype.requestImage = function(x, y, level) {
    //>>includeStart('debug', pragmas.debug);
    if (!this._ready) {
        throw new DeveloperError('requestImage must not be called before the imagery provider is ready.');
    }
    //>>includeEnd('debug');
    
    var self = this;
    
    var numResolutionLevelsToCut = this._numResolutionLevels - level - 1;
    
    var minX = x * this._tileWidth;
    var minY = y * this._tileHeight;
    var maxXExclusive = (x + 1) * this._tileWidth;
    var maxYExclusive = (y + 1) * this._tileHeight;
    
    var levelWidth = this._image.getLevelWidth(numResolutionLevelsToCut);
    var levelHeight = this._image.getLevelHeight(numResolutionLevelsToCut);
    
    var canvas = document.createElement('canvas');
    canvas.width = this._tileWidth;
    canvas.height = this._tileHeight;
    
    var context = canvas.getContext('2d');
    context.clearRect(0, 0, this._tileWidth, this._tileHeight);
    
    if (minX >= levelWidth ||
        minY >= levelHeight ||
        maxXExclusive <= 0 ||
        maxYExclusive <= 0) {
        
        return canvas;
    }
    
    var offsetX = 0;
    var offsetY = 0;
    maxXExclusive = Math.min(maxXExclusive, levelWidth);
    maxYExclusive = Math.min(maxYExclusive, levelHeight);
    
    if (minX < 0) {
        offsetX = -minX;
        minX = 0;
    }
    
    if (minY < 0) {
        offsetY = -minY;
        minY = 0;
    }
    
    var imagePartParams = {
        minX: minX,
        minY: minY,
        maxXExclusive: maxXExclusive,
        maxYExclusive: maxYExclusive,
        numResolutionLevelsToCut: numResolutionLevelsToCut,
        maxNumQualityLayers: this._maxNumQualityLayers,
        
        requestPriorityData: {
            imageRectangle: this._rectangle
        }
    };
    
    var resolve, reject;
    var requestPixelsPromise = new Promise(function(resolve_, reject_) {
        resolve = resolve_;
        reject = reject_;
        
        self._image.requestPixelsProgressive(
            imagePartParams,
            pixelsDecodedCallback,
            terminatedCallback);
    });
    
    function pixelsDecodedCallback(decoded) {
        var partialTileWidth = decoded.width;
        var partialTileHeight = decoded.height;

        var canvasTargetX = offsetX + decoded.xInOriginalRequest;
        var canvasTargetY = offsetY + decoded.yInOriginalRequest;
        
        if (partialTileWidth > 0 && partialTileHeight > 0) {
            var imageData = context.getImageData(
                canvasTargetX, canvasTargetY, partialTileWidth, partialTileHeight);
                
            imageData.data.set(decoded.pixels);
            context.putImageData(imageData, canvasTargetX, canvasTargetY);
        }
    }

    function terminatedCallback(isAborted) {
        if (isAborted) {
            reject('Fetch request or decode aborted');
        } else {
            resolve(canvas);
        }
    }

    return requestPixelsPromise;
};

ImageDecoderImageryProvider.prototype._setPriorityByFrustum =
    function setPriorityByFrustum() {
    
    if (!this._ready) {
        return;
    }
    
    var frustumData = CesiumFrustumCalculator.calculateFrustum(
        this._cesiumWidget, this);
    
    if (frustumData === null) {
        return;
    }
    
    frustumData.imageRectangle = this.getRectangle();
    frustumData.exactNumResolutionLevelsToCut = null;

    this._image.setServerRequestPrioritizerData(frustumData);
    this._image.setDecodePrioritizerData(frustumData);
};

/**
 * Picking features is not currently supported by this imagery provider, so this function simply returns
 * undefined.
 *
 * @param {Number} x The tile X coordinate.
 * @param {Number} y The tile Y coordinate.
 * @param {Number} level The tile level.
 * @param {Number} longitude The longitude at which to pick features.
 * @param {Number} latitude  The latitude at which to pick features.
 * @return {Promise} A promise for the picked features that will resolve when the asynchronous
 *                   picking completes.  The resolved value is an array of {@link ImageryLayerFeatureInfo}
 *                   instances.  The array may be empty if no features are found at the given location.
 *                   It may also be undefined if picking is not supported.
 */
ImageDecoderImageryProvider.prototype.pickFeatures = function() {
        return undefined;
};

ImageDecoderImageryProvider.prototype._statusCallback =
    function internalStatusCallback(status) {
    
    if (status.exception !== null && this._exceptionCallback !== null) {
        this._exceptionCallback(status.exception);
    }

    if (!status.isReady || this._ready) {
        return;
    }
    
    this._ready = status.isReady;
    
    // This is wrong if COD or COC exists besides main header COD
    this._numResolutionLevels = this._image.getDefaultNumResolutionLevels();
    this._maxNumQualityLayers = this._maxNumQualityLayers;
    //this._numResolutionLevels = 1;
        
    this._tileWidth = this._image.getTileWidth();
    this._tileHeight = this._image.getTileHeight();
        
    var bestLevel = this._numResolutionLevels - 1;
    var levelZeroWidth = this._image.getLevelWidth(bestLevel);
    var levelZeroHeight = this._image.getLevelHeight(bestLevel);
    
    var levelZeroTilesX = Math.ceil(levelZeroWidth / this._tileWidth);
    var levelZeroTilesY = Math.ceil(levelZeroHeight / this._tileHeight);

    imageHelperFunctions.fixBounds(
        this._rectangle,
        this._image,
        this._adaptProportions);
    var rectangleWidth = this._rectangle.east - this._rectangle.west;
    var rectangleHeight = this._rectangle.north - this._rectangle.south;
    
    var bestLevelScale = 1 << bestLevel;
    var pixelsWidthForCesium = this._tileWidth * levelZeroTilesX * bestLevelScale;
    var pixelsHeightForCesium = this._tileHeight * levelZeroTilesY * bestLevelScale;
    
    // Cesium works with full tiles only, thus fix the geographic bounds so
    // the pixels lies exactly on the original bounds
    
    var geographicWidthForCesium =
        rectangleWidth * pixelsWidthForCesium / this._image.getLevelWidth();
    var geographicHeightForCesium =
        rectangleHeight * pixelsHeightForCesium / this._image.getLevelHeight();
    
    var fixedEast = this._rectangle.west + geographicWidthForCesium;
    var fixedSouth = this._rectangle.north - geographicHeightForCesium;
    
    this._tilingSchemeParams = {
        west: this._rectangle.west,
        east: fixedEast,
        south: fixedSouth,
        north: this._rectangle.north,
        levelZeroTilesX: levelZeroTilesX,
        levelZeroTilesY: levelZeroTilesY,
        maximumLevel: bestLevel
    };
    
    this._tilingScheme = createTilingScheme(this._tilingSchemeParams);
        
    Cesium.TileProviderError.handleSuccess(this._errorEvent);
};

function createTilingScheme(params) {
    var geographicRectangleForCesium = new Cesium.Rectangle(
        params.west, params.south, params.east, params.north);
    
    var tilingScheme = new Cesium.GeographicTilingScheme({
        rectangle: geographicRectangleForCesium,
        numberOfLevelZeroTilesX: params.levelZeroTilesX,
        numberOfLevelZeroTilesY: params.levelZeroTilesY
    });
    
    return tilingScheme;
}
},{"_cesiumfrustumcalculator.js":2,"imagehelperfunctions.js":15,"workerproxyimagedecoder.js":19}],6:[function(require,module,exports){
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
},{"linkedlist.js":16}],7:[function(require,module,exports){
'use strict';

module.exports = FetchClientBase;

var SimpleFetchContext = require('simplefetchcontext.js');
var SimpleFetcher = require('simplefetcher.js');
var DataPublisher = require('datapublisher.js');

function FetchClientBase(options) {
    this._statusCallback = null;
    this._url = null;
    this._options = options;
    this._isReady = false;
    this._dataPublisher = this.createDataPublisherInternal();
}

// Methods for implementor

FetchClientBase.prototype.getSizesParamsInternal = function getSizesParamsInternal() {
    throw 'FetchClientBase error: getSizesParamsInternal is not implemented';
};

FetchClientBase.prototype.fetchInternal = function fetch(dataKey) {
    throw 'FetchClientBase error: fetchInternal is not implemented';
};

FetchClientBase.prototype.getDataKeysInternal = function getDataKeysInternal(imagePartParams) {
    throw 'FetchClientBase error: getDataKeysInternal is not implemented';
};

FetchClientBase.prototype.createDataPublisherInternal = function createDataPublisherInternal() {
    return new DataPublisher();
};

FetchClientBase.prototype.getUrlInternal = function getUrlInternal() {
    return this._url;
};

// FetchClient implementation

FetchClientBase.prototype.setStatusCallback = function setStatusCallback(
    statusCallback) {
    
    this._statusCallback = statusCallback;
};

FetchClientBase.prototype.open = function open(url) {
    if (this._url || this._isReady) {
        throw 'FetchClientBase error: Cannot open twice';
    }
    
    if (!url) {
        throw 'FetchClientBase error: no URL provided';
    }
    
    this._url = url;
    this._isReady = true;
    
    if (this._statusCallback) {
        this._statusCallback({
            isReady: true,
            exception: null
        });
    }
};

FetchClientBase.prototype.createFetchContext = function createFetchContext(
    imagePartParams, contextVars) {
    
    var dataKeys = this.getDataKeysInternal(imagePartParams);
    return new SimpleFetchContext(contextVars, dataKeys, this._dataPublisher);
};

FetchClientBase.prototype.createRequestFetcher = function createRequestFetcher() {
    return new SimpleFetcher(this, /*isChannel=*/false, this._dataPublisher, this._options);
};

FetchClientBase.prototype.createChannelFetcher = function createChannelFetcher() {
    return new SimpleFetcher(this, /*isChannel=*/true, this._dataPublisher, this._options);
};

FetchClientBase.prototype.close = function close(closedCallback) {
    this._ensureReady();
    
    this._isReady = false;
    
    if (this._statusCallback) {
        this._statusCallback({
            isReady: true,
            exception: null
        });
    }
    
    if (closedCallback) {
        closedCallback();
    }
};

FetchClientBase.prototype.getSizesParams = function getSizesParams(closedCallback) {
    this._ensureReady();
    return this.getSizesParamsInternal();
};

FetchClientBase.prototype.reconnect = function reconnect() {
    // Do nothing
};

FetchClientBase.prototype._ensureReady = function ensureReady() {
    if (!this._isReady) {
        throw 'FetchClientBase error: fetch client is not opened';
    }
};
},{"datapublisher.js":6,"simplefetchcontext.js":8,"simplefetcher.js":9}],8:[function(require,module,exports){
'use strict';

function SimpleFetchContext(contextVars, dataKeys, dataPublisher) {
    this._contextVars = contextVars;
    this._dataByKey = {};
    this._dataKeysFetchedCount = 0;
    this._dataListeners = [];
    this._dataKeys = dataKeys;
    this._dataPublisher = dataPublisher;
    
    this._subscribeHandles = [];
    
    var dataFetchedBound = this._dataFetched.bind(this);
    for (var i = 0; i < dataKeys.length; ++i) {
        var subscribeHandle = this._dataPublisher.subscribe(
            dataKeys[i], dataFetchedBound);
        
        this._subscribeHandles.push(subscribeHandle);
    }
}

SimpleFetchContext.prototype.getDataKeys = function getDataKeys() {
    return this._dataKeys;
};

SimpleFetchContext.prototype.hasData = function hasData() {
    return this.isDone();
};

SimpleFetchContext.prototype.getFetchedData = function getFetchedData() {
    if (!this.hasData()) {
        throw 'SimpleFetchContext error: cannot call getFetchedData before hasData = true';
    }
    
    return this._dataByKey;
};

SimpleFetchContext.prototype.on = function on(event, listener) {
    if (event !== 'data') {
        throw 'SimpleFetchContext error: Unexpected event ' + event;
    }
    
    this._dataListeners.push(listener);
};

SimpleFetchContext.prototype.isDone = function isDone() {
    return this._dataKeysFetchedCount === this._dataKeys.length;
};

SimpleFetchContext.prototype.release = function release() {
    for (var i = 0; i < this._subscribeHandles.length; ++i) {
        this._dataPublisher.unsubscribe(this._subscribeHandles[i]);
    }
    
    this._subscribeHandles = [];
};

SimpleFetchContext.prototype._dataFetched = function dataFetched(key, data) {
    if (!this._dataByKey[key]) {
        ++this._dataKeysFetchedCount;
    }
    
    this._dataByKey[key] = data;
    
    if (this.hasData()) {
        for (var i = 0; i < this._dataListeners.length; ++i) {
            this._dataListeners[i](this, this._contextVars);
        }
    }
};
},{}],9:[function(require,module,exports){
'use strict';

function SimpleFetcher(fetchClient, isChannel, dataPublisher, options) {
    this._fetchClient = fetchClient;
    this._dataPublisher = dataPublisher;
    this._isChannel = isChannel;
    this._stopListeners = [];
    this._fetchLimit = (options || {}).fetchLimitPerFetcher || 2;
    this._remainingKeysToFetch = null;
    this._activeFetches = {};
    this._activeFetchesCount = 0;
    
    this._fetchSucceededBound = this._fetchSucceeded.bind(this);
    this._fetchFailedBound = this._fetchFailed.bind(this);
}

SimpleFetcher.prototype.fetch = function fetch(fetchContext) {
    if (!this._isChannel && this._remainingKeysToFetch !== null) {
        throw 'SimpleFetcher error: Cannot fetch while another fetch in progress';
    }
    
    this._remainingKeysToFetch = fetchContext.getDataKeys();
    while (this._activeFetchesCount < this._fetchLimit) {
        if (!this._fetchSingleKey()) {
            break;
        }
    }
};

SimpleFetcher.prototype.on = function on(event, listener) {
    if (event !== 'stop') {
        throw 'SimpleFetcher error: Unexpected event ' + event;
    }
    
    this.stopListeners.push(listener);
};

SimpleFetcher.prototype.abortAsync = function abortAsync() {
    if (this._isChannel) {
        throw 'SimpleFetcher error: cannot abort channel fetcher';
    }
    
    // Do nothing
};

SimpleFetcher.prototype._fetchSingleKey = function fetchSingleKey() {
    if (this._remainingKeysToFetch.length === 0) {
        return false;
    }
    
    var self = this;
    var key = this._remainingKeysToFetch.pop();
    this._activeFetches.push(key);
    
    this._fetchClient.fetchInternal(key)
        .then(function resolved(result) {
            self._dataPublisher.publish(key, result);
            self.fetchedEnded(null, key, result);
        }).catch(function failed(reason) {
            // NOTE: Should create an API in ImageDecoderFramework to update on error
            self.fetchEnded(reason, key);
        });
    
    return true;
};

SimpleFetcher.prototype._fetchEnded = function fetchEnded(error, key, result) {
    delete this._activeFetches.key;
    this._fetchSingleKey();
};
},{}],10:[function(require,module,exports){
'use strict';

module.exports = ImageDecoder;

var WorkerProxyFetchManager = require('workerproxyfetchmanager.js');
var imageHelperFunctions = require('imageHelperFunctions.js');
var DecodeJobsPool = require('decodejobspool.js');
var WorkerProxyPixelsDecoder = require('workerproxypixelsdecoder.js');

/* global console: false */
/* global Promise: false */

function ImageDecoder(imageImplementationClassName, options) {
    options = options || {};
    var decodeWorkersLimit = options.workersLimit || 5;
    
    this._tileWidth = options.tileWidth || 256;
    this._tileHeight = options.tileHeight || 256;
    this._showLog = !!options.showLog;
    
    if (this._showLog) {
        // Old IE
        throw 'showLog is not supported on this browser';
    }

    this._sizesParams = null;
    this._sizesCalculator = null;
    this._channelStates = [];
    this._decoders = [];
    this._imageImplementationClassName = imageImplementationClassName;
    this._imageImplementation = imageHelperFunctions.getImageImplementation(imageImplementationClassName);
    this._fetchManager = new WorkerProxyFetchManager(
        imageImplementationClassName, options);
    
    var decodeScheduler = imageHelperFunctions.createScheduler(
        this._showLog,
        options.decodePrioritizer,
        'decode',
        this._createDecoder.bind(this),
        decodeWorkersLimit);
    
    this._decodePrioritizer = decodeScheduler.prioritizer;

    this._requestsDecodeJobsPool = new DecodeJobsPool(
        this._fetchManager,
        decodeScheduler.scheduler,
        this._tileWidth,
        this._tileHeight,
        /*onlyWaitForDataAndDecode=*/false);
        
    this._channelsDecodeJobsPool = new DecodeJobsPool(
        this._fetchManager,
        decodeScheduler.scheduler,
        this._tileWidth,
        this._tileHeight,
        /*onlyWaitForDataAndDecode=*/true);
}

ImageDecoder.prototype.setStatusCallback = function setStatusCallback(statusCallback) {
    this._statusCallback = statusCallback;
    this._fetchManager.setStatusCallback(statusCallback);
};
    
ImageDecoder.prototype.setServerRequestPrioritizerData =
    function setServerRequestPrioritizerData(prioritizerData) {
    
    this._fetchManager.setServerRequestPrioritizerData(
        prioritizerData);
};

ImageDecoder.prototype.setDecodePrioritizerData =
    function setDecodePrioritizerData(prioritizerData) {
    
    if (this._decodePrioritizer === null) {
        throw 'No decode prioritizer has been set';
    }
    
    if (this._showLog) {
        console.log('setDecodePrioritizerData(' + prioritizerData + ')');
    }
    
    var prioritizerDataModified = Object.create(prioritizerData);
    prioritizerDataModified.image = this;
    
    this._decodePrioritizer.setPrioritizerData(prioritizerDataModified);
};

ImageDecoder.prototype.open = function open(url) {
    this._fetchManager.open(url);
};

ImageDecoder.prototype.close = function close(closedCallback) {
    for (var i = 0; i < this._decoders.length; ++i) {
        this._decoders[i].terminate();
    }

    this._fetchManager.close(closedCallback);
};

ImageDecoder.prototype.getLevelWidth = function getLevelWidth(numResolutionLevelsToCut) {
    validateSizesCalculator(this);
    var width = this._sizesCalculator.getLevelWidth(
        numResolutionLevelsToCut);

    return width;
};

ImageDecoder.prototype.getLevelHeight = function getLevelHeight(numResolutionLevelsToCut) {
    validateSizesCalculator(this);
    var height = this._sizesCalculator.getLevelHeight(
        numResolutionLevelsToCut);

    return height;
};

ImageDecoder.prototype.getTileWidth = function getTileWidth() {
    validateSizesCalculator(this);
    return this._tileWidth;
};

ImageDecoder.prototype.getTileHeight = function getTileHeight() {
    validateSizesCalculator(this);
    return this._tileHeight;
};

ImageDecoder.prototype.getDefaultNumResolutionLevels = function getDefaultNumResolutionLevels() {
    validateSizesCalculator(this);
    var numLevels = this._sizesCalculator.getDefaultNumResolutionLevels();
    
    return numLevels;
};

ImageDecoder.prototype.getDefaultNumQualityLayers = function getDefaultNumQualityLayers() {
    validateSizesCalculator(this);
    var numLayers = this._sizesCalculator.getDefaultNumQualityLayers();
    
    return numLayers;
};

ImageDecoder.prototype.createChannel = function createChannel(
    createdCallback) {
    
    validateSizesCalculator(this);
    
    var self = this;
    
    function channelCreated(channelHandle) {
        self._channelStates[channelHandle] = {
            decodeJobsListenerHandle: null
        };
        
        createdCallback(channelHandle);
    }
    
    this._fetchManager.createChannel(
        channelCreated);
};

ImageDecoder.prototype.requestPixels = function requestPixels(imagePartParams) {
    validateSizesCalculator(this);
    
    var level = imagePartParams.numResolutionLevelsToCut;
    var levelWidth = this._sizesCalculator.getLevelWidth(level);
    var levelHeight = this._sizesCalculator.getLevelHeight(level);
    
    var resolve, reject;
    var accumulatedResult = {};
    
    var self = this;
    var promise = new Promise(startPromise);
    return promise;
    
    function startPromise(resolve_, reject_) {
        resolve = resolve_;
        reject = reject_;
        
        self._requestsDecodeJobsPool.forkDecodeJobs(
            imagePartParams,
            internalCallback,
            internalTerminatedCallback,
            levelWidth,
            levelHeight,
            /*isProgressive=*/false);
    }
    
    function internalCallback(decodedData) {
        copyPixelsToAccumulatedResult(decodedData, accumulatedResult);
    }
    
    function internalTerminatedCallback(isAborted) {
        if (isAborted) {
            reject('Request was aborted due to failure or priority');
        } else {
            resolve(accumulatedResult);
        }
    }
};

ImageDecoder.prototype.requestPixelsProgressive = function requestPixelsProgressive(
    imagePartParams,
    callback,
    terminatedCallback,
    imagePartParamsNotNeeded,
    channelHandle) {
    
    validateSizesCalculator(this);
    
    var level = imagePartParams.numResolutionLevelsToCut;
    var levelWidth = this._sizesCalculator.getLevelWidth(level);
    var levelHeight = this._sizesCalculator.getLevelHeight(level);
    
    var channelState = null;
    var decodeJobsPool;
    if (channelHandle === undefined) {
        decodeJobsPool = this._requestsDecodeJobsPool;
    } else {
        decodeJobsPool = this._channelsDecodeJobsPool;
        
        channelState = this._channelStates[channelHandle];
        
        if (channelState === undefined) {
            throw 'Channel handle does not exist';
        }
        
        this._fetchManager.moveChannel(channelHandle, imagePartParams);
    }
    
    var listenerHandle = decodeJobsPool.forkDecodeJobs(
        imagePartParams,
        callback,
        terminatedCallback,
        levelWidth,
        levelHeight,
        /*isProgressive=*/true,
        imagePartParamsNotNeeded);
        
    if (channelHandle !== undefined &&
        channelState.decodeJobsListenerHandle !== null) {
        
        // Unregister after forked new jobs, so no termination occurs meanwhile
        decodeJobsPool.unregisterForkedJobs(
            channelState.decodeJobsListenerHandle);
    }
    
    if (channelState !== null) {
        channelState.decodeJobsListenerHandle = listenerHandle;
    }
};

ImageDecoder.prototype.reconnect = function reconnect() {
    this._fetchManager.reconnect();
};

ImageDecoder.prototype._getSizesCalculator = function getSizesCalculator() {
    validateSizesCalculator(this);
    
    return this._sizesCalculator;
};

ImageDecoder.prototype._getSizesParams = function getSizesParams() {
    if (this._sizesParams === null) {
        this._sizesParams = {
            imageParams: this._fetchManager.getSizesParams(),
            applicativeTileWidth: this._tileWidth,
            applicativeTileHeight:  this._tileHeight
        };
    }
    
    return this._sizesParams;
};

ImageDecoder.prototype._createDecoder = function createDecoder() {
    var decoder = new WorkerProxyPixelsDecoder(this._imageImplementationClassName, this._options);
    this._decoders.push(decoder);
    
    return decoder;
};

function validateSizesCalculator(self) {
    if (self._sizesCalculator !== null) {
        return;
    }
    
    var sizesParams = self._getSizesParams();
    self._sizesCalculator = self._imageImplementation.createImageParamsRetriever(
        sizesParams.imageParams);
}

function copyPixelsToAccumulatedResult(decodedData, accumulatedResult) {
    var bytesPerPixel = 4;
    var sourceStride = decodedData.width * bytesPerPixel;
    var targetStride =
        decodedData.originalRequestWidth * bytesPerPixel;
    
    if (accumulatedResult.pixels === undefined) {
        var size =
            targetStride * decodedData.originalRequestHeight;
            
        accumulatedResult.pixels = new Uint8Array(size);
        accumulatedResult.xInOriginalRequest = 0;
        accumulatedResult.yInOriginalRequest = 0;
        
        var width = decodedData.originalRequestWidth;
        accumulatedResult.originalRequestWidth = width;
        accumulatedResult.width = width;

        var height = decodedData.originalRequestHeight;
        accumulatedResult.originalRequestHeight = height;
        accumulatedResult.height = height;
    }
    
    accumulatedResult.allRelevantBytesLoaded =
        decodedData.allRelevantBytesLoaded;

    var sourceOffset = 0;
    var targetOffset =
        decodedData.xInOriginalRequest * bytesPerPixel + 
        decodedData.yInOriginalRequest * targetStride;
    
    for (var i = 0; i < decodedData.height; ++i) {
        var sourceSubArray = decodedData.pixels.subarray(
            sourceOffset, sourceOffset + sourceStride);
        
        accumulatedResult.pixels.set(sourceSubArray, targetOffset);
        
        sourceOffset += sourceStride;
        targetOffset += targetStride;
    }
}
},{"decodejobspool.js":12,"imageHelperFunctions.js":14,"workerproxyfetchmanager.js":18,"workerproxypixelsdecoder.js":20}],11:[function(require,module,exports){
'use strict';

module.exports = DecodeJob;

var LinkedList = require('linkedlist.js');

var requestIdCounter = 0;

function DecodeJob(
    imagePartParams,
    fetchManager,
    decodeScheduler,
    onlyWaitForDataAndDecode) {
    
    this._isAborted = false;
    this._isTerminated = false;
    this._isFetchRequestTerminated = false;
    this._isFirstStage = true;
    this._isManuallyAborted = false;

    this._firstDecodeResult = null;
    this._pendingDecodeResult = null;
    this._activeSubJobs = 1;
    this._imagePartParams = imagePartParams;
    this._decodeScheduler = decodeScheduler;
    this._jobSequenceId = 0;
    this._lastFinishedJobSequenceId = -1;
    this._progressiveStagesDone = 0;
    this._listenersLinkedList = new LinkedList();
    this._progressiveListenersCount = 0;
    this._requestId = ++requestIdCounter;
    this._allRelevantBytesLoaded = 0;
    this._fetchManager = fetchManager;
    this._startDecodeBound = this._startDecode.bind(this);
    this._decodeAbortedBound = this._decodeAborted.bind(this);
    
    fetchManager.createRequest(
        imagePartParams,
        this,
        this._dataReadyForDecode,
        this._fetchTerminated,
        onlyWaitForDataAndDecode,
        this._requestId);
}

DecodeJob.prototype.registerListener = function registerListener(listenerHandle) {
    var iterator = this._listenersLinkedList.add(listenerHandle);
    
    if (listenerHandle.isProgressive) {
        ++this._progressiveListenersCount;
        
        if (this._progressiveListenersCount === 1) {
            this._fetchManager.setIsProgressiveRequest(
                this._requestId, true);
        }
    }
    
    var unregisterHandle = iterator;
    return unregisterHandle;
};

DecodeJob.prototype.unregisterListener = function unregisterListener(unregisterHandle) {
    var iterator = unregisterHandle;
    var listenerHandle = this._listenersLinkedList.getValue(iterator);

    this._listenersLinkedList.remove(unregisterHandle);
    
    if (listenerHandle.isProgressive) {
        --this._progressiveListenersCount;
    }
    
    if (this._listenersLinkedList.getCount() === 0) {
        this._fetchManager.manualAbortRequest(
            this._requestId);
        
        this._isAborted = true;
        this._isTerminated = true;
        this._isFetchRequestTerminated = true;
        this._isManuallyAborted = true;
    } else if (this._progressiveListenersCount === 0) {
        this._fetchManager.setIsProgressiveRequest(
            this._requestId, false);
    }
};

DecodeJob.prototype.getIsTerminated = function getIsTerminated() {
    return this._isTerminated;
};

DecodeJob.prototype._dataReadyForDecode = function dataReadyForDecode(dataForDecode) {
    if (this._isAbortedNoTermination() ||
        this._listenersLinkedList.getCount() === 0) {
        
        // NOTE: Should find better way to clean job if listeners list
        // is empty
        
        return;
    }
    
    if (this._isFirstStage) {
        this._firstDecodeResult = {
            dataForDecode: dataForDecode
        };
    } else {
        this._pendingDecodeResult = {
            dataForDecode: dataForDecode
        };
    
        if (this._isAlreadyScheduledNonFirstJob) {
            return;
        }
        
        this._isAlreadyScheduledNonFirstJob = true;
    }
    
    if (this._isTerminated) {
        throw 'Job has already been terminated';
    }
    
    this._isFirstStage = false;
    ++this._activeSubJobs;
    
    var jobContext = {
        self: this,
        imagePartParams: this._imagePartParams,
        progressiveStagesDone: this._progressiveStagesDone
    };
    
    this._decodeScheduler.enqueueJob(
        this._startDecodeBound, jobContext, this._decodeAbortedBound);
};

DecodeJob.prototype._startDecode = function startDecode(decoder, jobContext) {
    var decodeResult;
    if (this._firstDecodeResult !== null) {
        decodeResult = this._firstDecodeResult;
        this._firstDecodeResult = null;
    } else {
        decodeResult = this._pendingDecodeResult;
        this._pendingDecodeResult = null;
        
        this._isAlreadyScheduledNonFirstJob = false;
    }
    
    jobContext.allRelevantBytesLoaded = decodeResult.dataForDecode.allRelevantBytesLoaded;
    
    if (this._isAbortedNoTermination()) {
        --this._activeSubJobs;
        this._decodeScheduler.jobDone(decoder, jobContext);
        checkIfAllTerminated(this);
        
        return;
    }
    
    var jobSequenceId = ++this._jobSequenceId;
    
    var params = this._imagePartParams;
    var width = params.maxXExclusive - params.minX;
    var height = params.maxYExclusive - params.minY;

    decoder.decode(decodeResult.dataForDecode).then(pixelsDecodedCallbackInClosure);
    
    //var regionToParse = {
    //    left: dataForDecode.headersCodestream.offsetX,
    //    top: dataForDecode.headersCodestream.offsetY,
    //    right: dataForDecode.headersCodestream.offsetX + width,
    //    bottom: dataForDecode.headersCodestream.offsetY + height
    //};
    //
    //jpxImageResource.parseCodestreamAsync(
    //    jpxHeaderParseEndedCallback,
    //    dataForDecode.headersCodestream.codestream,
    //    0,
    //    dataForDecode.headersCodestream.codestream.length,
    //    { isOnlyParseHeaders: true });
    //
    //jpxImageResource.addPacketsDataToCurrentContext(dataForDecode.packetsData);
    //
    //jpxImageResource.decodeCurrentContextAsync(
    //    pixelsDecodedCallbackInClosure, { regionToParse: regionToParse });
        
    var self = this;
    
    function pixelsDecodedCallbackInClosure(decodeResult) {
        self._pixelsDecodedCallback(
            decoder,
            decodeResult,
            jobSequenceId,
            jobContext);
        
        self = null;
    }
};

DecodeJob.prototype._pixelsDecodedCallback = function pixelsDecodedCallback(
    decoder, decodeResult, jobSequenceId, jobContext) {
    
    this._decodeScheduler.jobDone(decoder, jobContext);
    --this._activeSubJobs;
    
    var relevantBytesLoadedDiff =
        jobContext.allRelevantBytesLoaded - this._allRelevantBytesLoaded;
    this._allRelevantBytesLoaded = jobContext.allRelevantBytesLoaded;
    
    if (this._isAbortedNoTermination()) {
        checkIfAllTerminated(this);
        return;
    }
    
    var lastFinished = this._lastFinishedJobSequenceId;
    if (lastFinished > jobSequenceId) {
        // Do not refresh pixels with lower quality layer than
        // what was already returned
        
        checkIfAllTerminated(this);
        return;
    }
    
    this._lastFinishedJobSequenceId = jobSequenceId;
    
    var tileParams = this._imagePartParams;
    
    var iterator = this._listenersLinkedList.getFirstIterator();
    while (iterator !== null) {
        var listenerHandle = this._listenersLinkedList.getValue(iterator);
        var originalParams = listenerHandle.imagePartParams;
        
        var offsetX = tileParams.minX - originalParams.minX;
        var offsetY = tileParams.minY - originalParams.minY;
        var width = originalParams.maxXExclusive - originalParams.minX;
        var height = originalParams.maxYExclusive - originalParams.minY;
        
        listenerHandle.allRelevantBytesLoaded += relevantBytesLoadedDiff;
        
        var decodedOffsetted = {
            originalRequestWidth: width,
            originalRequestHeight: height,
            xInOriginalRequest: offsetX,
            yInOriginalRequest: offsetY,
            
            width: decodeResult.width,
            height: decodeResult.height,
            pixels: decodeResult.pixels,
            
            allRelevantBytesLoaded: listenerHandle.allRelevantBytesLoaded
        };
        
        listenerHandle.callback(decodedOffsetted);
        
        iterator = this._listenersLinkedList.getNextIterator(iterator);
    }

    checkIfAllTerminated(this);
};

DecodeJob.prototype._fetchTerminated = function fetchTerminated(isAborted) {
    if (this._isManuallyAborted) {
        // This situation might occur if request has been terminated,
        // but user's terminatedCallback has not been called yet. It
        // happens on WorkerProxyFetchManager due to thread
        // message delay.
        
        return;
    }

    if (this._isFetchRequestTerminated) {
        throw 'Double termination of fetch request';
    }
    
    this._isFetchRequestTerminated = true;
    --this._activeSubJobs;
    this._isAborted |= isAborted;
    
    checkIfAllTerminated(this);
};

DecodeJob.prototype._decodeAborted = function decodeAborted(jobContext) {
    this._isAborted = true;
    
    if (this._firstDecodeResult !== null) {
        this._firstDecodeResult = null;
    } else {
        this._pendingDecodeResult = null;
        this._isAlreadyScheduledNonFirstJob = false;
    }
    
    --this._activeSubJobs;
    
    checkIfAllTerminated(this);
};

DecodeJob.prototype._isAbortedNoTermination = function _isAbortedNoTermination() {
    if (this._isManuallyAborted) {
        return;
    }
    
    if (this._isTerminated) {
        throw 'Unexpected job state of terminated: Still runnin sub-jobs';
    }
    
    return this._isAborted;
};

//function jpxHeaderParseEndedCallback() {
//    // Do nothing
//}

function checkIfAllTerminated(self) {
    if (self._activeSubJobs < 0) {
        throw 'Inconsistent number of decode jobs';
    }
    
    if (self._activeSubJobs > 0) {
        return;
    }
    
    if (self._isAlreadyScheduledNonFirstJob) {
        throw 'Inconsistent isAlreadyScheduledNonFirstJob flag';
    }
    
    self._isTerminated = true;
    var linkedList = self._listenersLinkedList;
    self._listenersLinkedList = null;

    var iterator = linkedList.getFirstIterator();
    
    while (iterator !== null) {
        var listenerHandle = linkedList.getValue(iterator);
        listenerHandle.isAnyDecoderAborted |= self._isAborted;
        
        var remaining = --listenerHandle.remainingDecodeJobs;
        if (remaining < 0) {
            throw 'Inconsistent number of done requests';
        }
        
        var isListenerDone = remaining === 0;
        if (isListenerDone) {
            listenerHandle.isTerminatedCallbackCalled = true;
            listenerHandle.terminatedCallback(
                listenerHandle.isAnyDecoderAborted);
        }
        
        iterator = linkedList.getNextIterator(iterator);
    }
}
},{"linkedlist.js":16}],12:[function(require,module,exports){
'use strict';

module.exports = DecodeJobsPool;

var DecodeJob = require('decodejob.js');

function DecodeJobsPool(
    fetchManager,
    decodeScheduler,
    tileWidth,
    tileHeight,
    onlyWaitForDataAndDecode) {
    
    this._tileWidth = tileWidth;
    this._tileHeight = tileHeight;
    this._activeRequests = [];
    this._onlyWaitForDataAndDecode = onlyWaitForDataAndDecode;
    
    this._fetchManager = fetchManager;
    
    this._decodeScheduler = decodeScheduler;
}

DecodeJobsPool.prototype.forkDecodeJobs = function forkDecodeJobs(
    imagePartParams,
    callback,
    terminatedCallback,
    levelWidth,
    levelHeight,
    isProgressive,
    imagePartParamsNotNeeded) {
    
    var minX = imagePartParams.minX;
    var minY = imagePartParams.minY;
    var maxX = imagePartParams.maxXExclusive;
    var maxY = imagePartParams.maxYExclusive;
    var level = imagePartParams.numResolutionLevelsToCut || 0;
    var layer = imagePartParams.maxNumQualityLayers;
    var priorityData = imagePartParams.requestPriorityData;
                
    var isMinAligned =
        minX % this._tileWidth === 0 && minY % this._tileHeight === 0;
    var isMaxXAligned = maxX % this._tileWidth === 0 || maxX === levelWidth;
    var isMaxYAligned = maxY % this._tileHeight === 0 || maxY === levelHeight;
    var isOrderValid = minX < maxX && minY < maxY;
    
    if (!isMinAligned || !isMaxXAligned || !isMaxYAligned || !isOrderValid) {
        throw 'imagePartParams for decoders is not aligned to ' +
            'tile size or not in valid order';
    }
    
    var requestsInLevel = getOrAddValue(this._activeRequests, level, []);
    var requestsInQualityLayer = getOrAddValue(
        requestsInLevel, imagePartParams.maxNumQualityLayers, []);
        
    var numTilesX = Math.ceil((maxX - minX) / this._tileWidth);
    var numTilesY = Math.ceil((maxY - minY) / this._tileHeight);
    
    var listenerHandle = {
        imagePartParams: imagePartParams,
        callback: callback,
        terminatedCallback: terminatedCallback,
        remainingDecodeJobs: numTilesX * numTilesY,
        isProgressive: isProgressive,
        isAnyDecoderAborted: false,
        isTerminatedCallbackCalled: false,
        allRelevantBytesLoaded: 0,
        unregisterHandles: []
    };
    
    for (var x = minX; x < maxX; x += this._tileWidth) {
        var requestsInX = getOrAddValue(requestsInQualityLayer, x, []);
        var singleTileMaxX = Math.min(x + this._tileWidth, levelWidth);
        
        for (var y = minY; y < maxY; y += this._tileHeight) {
            var singleTileMaxY = Math.min(y + this._tileHeight, levelHeight);
            
            var isTileNotNeeded = isUnneeded(
                x,
                y,
                singleTileMaxX,
                singleTileMaxY,
                imagePartParamsNotNeeded);
                
            if (isTileNotNeeded) {
                --listenerHandle.remainingDecodeJobs;
                continue;
            }
        
            var decodeJobContainer = getOrAddValue(requestsInX, y, {});
            
            if (decodeJobContainer.job === undefined ||
                decodeJobContainer.job.getIsTerminated()) {
                
                var singleTileImagePartParams = {
                    minX: x,
                    minY: y,
                    maxXExclusive: singleTileMaxX,
                    maxYExclusive: singleTileMaxY,
                    numResolutionLevelsToCut: level,
                    maxNumQualityLayers: layer,
                    requestPriorityData: priorityData
                };
                
                decodeJobContainer.job = new DecodeJob(
                    singleTileImagePartParams,
                    this._fetchManager,
                    this._decodeScheduler,
                    this._onlyWaitForDataAndDecode);
            }
            
            var unregisterHandle =
                decodeJobContainer.job.registerListener(listenerHandle);
            listenerHandle.unregisterHandles.push({
                unregisterHandle: unregisterHandle,
                job: decodeJobContainer.job
            });
        }
    }
    
    if (!listenerHandle.isTerminatedCallbackCalled &&
        listenerHandle.remainingDecodeJobs === 0) {
        
        listenerHandle.isTerminatedCallbackCalled = true;
        listenerHandle.terminatedCallback(listenerHandle.isAnyDecoderAborted);
    }
    
    return listenerHandle;
};

DecodeJobsPool.prototype.unregisterForkedJobs = function unregisterForkedJobs(listenerHandle) {
    if (listenerHandle.remainingDecodeJobs === 0) {
        // All jobs has already been terminated, no need to unregister
        return;
    }
    
    for (var i = 0; i < listenerHandle.unregisterHandles.length; ++i) {
        var handle = listenerHandle.unregisterHandles[i];
        if (handle.job.getIsTerminated()) {
            continue;
        }
        
        handle.job.unregisterListener(handle.unregisterHandle);
    }
};

function isUnneeded(
    minX, minY, maxX, maxY, imagePartParamsNotNeeded) {
    
    if (imagePartParamsNotNeeded === undefined) {
        return false;
    }
    
    for (var i = 0; i < imagePartParamsNotNeeded.length; ++i) {
        var notNeeded = imagePartParamsNotNeeded[i];
        var isInX = minX >= notNeeded.minX && maxX <= notNeeded.maxXExclusive;
        var isInY = minY >= notNeeded.minY && maxY <= notNeeded.maxYExclusive;
        
        if (isInX && isInY) {
            return true;
        }
    }
    
    return false;
}

function getOrAddValue(parentArray, index, defaultValue) {
    var subArray = parentArray[index];
    if (subArray === undefined) {
        subArray = defaultValue;
        parentArray[index] = subArray;
    }
    
    return subArray;
}
},{"decodejob.js":11}],13:[function(require,module,exports){
'use strict';

module.exports = FrustumRequestsPrioritizer;
var PRIORITY_ABORT_NOT_IN_FRUSTUM = -1;
var PRIORITY_CALCULATION_FAILED = 0;
var PRIORITY_TOO_GOOD_RESOLUTION = 1;
var PRIORITY_NOT_IN_FRUSTUM = 2;
var PRIORITY_LOWER_RESOLUTION = 3;

var PRIORITY_MINORITY_IN_FRUSTUM = 4;
var PRIORITY_PARTIAL_IN_FRUSTUM = 5;
var PRIORITY_MAJORITY_IN_FRUSTUM = 6;
var PRIORITY_FULLY_IN_FRUSTUM = 7;

var ADD_PRIORITY_TO_LOW_QUALITY = 5;

var PRIORITY_HIGHEST = 13;

var log2 = Math.log(2);

function FrustumRequestsPrioritizer(
    isAbortRequestsNotInFrustum, isPrioritizeLowProgressiveStage) {
    
    this._frustumData = null;
    this._isAbortRequestsNotInFrustum = isAbortRequestsNotInFrustum;
    this._isPrioritizeLowProgressiveStage = isPrioritizeLowProgressiveStage;
}

Object.defineProperty(
    FrustumRequestsPrioritizer.prototype, 'minimalLowQualityPriority', {
        get: function minimalLowQualityPriority() {
            return PRIORITY_MINORITY_IN_FRUSTUM + ADD_PRIORITY_TO_LOW_QUALITY;
        }
    }
);
    
FrustumRequestsPrioritizer.prototype.setPrioritizerData = function setPrioritizerData(prioritizerData) {
    this._frustumData = prioritizerData;
};

FrustumRequestsPrioritizer.prototype.getPriority = function getPriority(jobContext) {
    var imagePartParams = jobContext.imagePartParams;
    if (imagePartParams.requestPriorityData.overrideHighestPriority) {
        return PRIORITY_HIGHEST;
    }

    var priority = this._getPriorityInternal(imagePartParams);
    var isInFrustum = priority >= PRIORITY_MINORITY_IN_FRUSTUM;
    
    if (this._isAbortRequestsNotInFrustum && !isInFrustum) {
        return PRIORITY_ABORT_NOT_IN_FRUSTUM;
    }
    
    var prioritizeLowProgressiveStage = 0;
    
    if (this._isPrioritizeLowProgressiveStage && isInFrustum) {
        if (jobContext.progressiveStagesDone === undefined) {
            throw 'Missing progressive stage information';
        }
        
        prioritizeLowProgressiveStage =
            jobContext.progressiveStagesDone === 0 ? ADD_PRIORITY_TO_LOW_QUALITY :
            jobContext.progressiveStagesDone === 1 ? 1 :
            0;
    }
    
    return priority + prioritizeLowProgressiveStage;
};

FrustumRequestsPrioritizer.prototype._getPriorityInternal = function getPriorityInternal(imagePartParams) {
    if (this._frustumData === null) {
        return PRIORITY_CALCULATION_FAILED;
    }
    
    if (this._frustumData.imageRectangle === undefined) {
        throw 'No imageRectangle information passed in setPrioritizerData';
    }
    
    var exactFrustumLevel = this._frustumData.exactNumResolutionLevelsToCut;
    
    if (this._frustumData.exactNumResolutionLevelsToCut === undefined) {
        throw 'No exactNumResolutionLevelsToCut information passed in ' +
            'setPrioritizerData. Use null if unknown';
    }
    
    var tileWest = this._pixelToCartographicX(
        imagePartParams.minX, imagePartParams);
    var tileEast = this._pixelToCartographicX(
        imagePartParams.maxXExclusive, imagePartParams);
    var tileNorth = this._pixelToCartographicY(
        imagePartParams.minY, imagePartParams);
    var tileSouth = this._pixelToCartographicY(
        imagePartParams.maxYExclusive, imagePartParams);
    
    var tilePixelsWidth =
        imagePartParams.maxXExclusive - imagePartParams.minX;
    var tilePixelsHeight =
        imagePartParams.maxYExclusive - imagePartParams.minY;
    
    var requestToFrustumResolutionRatio;
    var tileLevel = imagePartParams.numResolutionLevelsToCut || 0;
    if (exactFrustumLevel === null) {
        var tileResolutionX = tilePixelsWidth / (tileEast - tileWest);
        var tileResolutionY = tilePixelsHeight / (tileNorth - tileSouth);
        var tileResolution = Math.max(tileResolutionX, tileResolutionY);
        var frustumResolution = this._frustumData.resolution;
        requestToFrustumResolutionRatio = tileResolution / frustumResolution;
    
        if (requestToFrustumResolutionRatio > 2) {
            return PRIORITY_TOO_GOOD_RESOLUTION;
        }
    } else if (tileLevel < exactFrustumLevel) {
        return PRIORITY_TOO_GOOD_RESOLUTION;
    }
    
    var frustumRectangle = this._frustumData.rectangle;
    var intersectionWest = Math.max(frustumRectangle.west, tileWest);
    var intersectionEast = Math.min(frustumRectangle.east, tileEast);
    var intersectionSouth = Math.max(frustumRectangle.south, tileSouth);
    var intersectionNorth = Math.min(frustumRectangle.north, tileNorth);
    
    var intersectionWidth = intersectionEast - intersectionWest;
    var intersectionHeight = intersectionNorth - intersectionSouth;
    
    if (intersectionWidth < 0 || intersectionHeight < 0) {
        return PRIORITY_NOT_IN_FRUSTUM;
    }
    
    if (exactFrustumLevel !== null) {
        if (tileLevel > exactFrustumLevel) {
            return PRIORITY_LOWER_RESOLUTION;
        }
    } else if (tileLevel > 0 && requestToFrustumResolutionRatio < 0.25) {
        return PRIORITY_LOWER_RESOLUTION;
    }
    
    var intersectionArea = intersectionWidth * intersectionHeight;
    var tileArea = (tileEast - tileWest) * (tileNorth - tileSouth);
    var partInFrustum = intersectionArea / tileArea;
    
    if (partInFrustum > 0.99) {
        return PRIORITY_FULLY_IN_FRUSTUM;
    } else if (partInFrustum > 0.7) {
        return PRIORITY_MAJORITY_IN_FRUSTUM;
    } else if (partInFrustum > 0.3) {
        return PRIORITY_PARTIAL_IN_FRUSTUM;
    } else {
        return PRIORITY_MINORITY_IN_FRUSTUM;
    }
};

FrustumRequestsPrioritizer.prototype._pixelToCartographicX = function pixelToCartographicX(
    x, imagePartParams) {
    
    var relativeX = x / this._frustumData.image.getLevelWidth(
        imagePartParams.numResolutionLevelsToCut);
    
    var imageRectangle = this._frustumData.imageRectangle;
    var rectangleWidth = imageRectangle.east - imageRectangle.west;
    
    var xProjected = imageRectangle.west + relativeX * rectangleWidth;
    return xProjected;
};

FrustumRequestsPrioritizer.prototype._pixelToCartographicY = function tileToCartographicY(
    y, imagePartParams, image) {
    
    var relativeY = y / this._frustumData.image.getLevelHeight(
        imagePartParams.numResolutionLevelsToCut);
    
    var imageRectangle = this._frustumData.imageRectangle;
    var rectangleHeight = imageRectangle.north - imageRectangle.south;
    
    var yProjected = imageRectangle.north - relativeY * rectangleHeight;
    return yProjected;
};
},{}],14:[function(require,module,exports){
'use strict';

var FrustumRequestsPrioritizer = require('frustumrequestsprioritizer.js');

module.exports = {
    calculateFrustum2DFromBounds: calculateFrustum2DFromBounds,
    createScheduler: createScheduler,
    fixBounds: fixBounds,
    alignParamsToTilesAndLevel: alignParamsToTilesAndLevel,
    getImageImplementation: getImageImplementation,
    getScriptsForWorkerImport: getScriptsForWorkerImport
};

// Avoid strict mode error
var globals;

// Avoid jshint error
/* global self: false */
    
var log2 = Math.log(2);

var imageDecoderFrameworkScript = new AsyncProxy.ScriptsToImportPool();
imageDecoderFrameworkScript.addScriptFromErrorWithStackTrace(new Error());
var scriptsForWorkerToImport = imageDecoderFrameworkScript.getScriptsForWorkerImport();

function calculateFrustum2DFromBounds(
    bounds, screenSize) {
    
    var screenPixels =
        screenSize.x * screenSize.x + screenSize.y * screenSize.y;
    
    var boundsWidth = bounds.east - bounds.west;
    var boundsHeight = bounds.north - bounds.south;
    var boundsDistance =
        boundsWidth * boundsWidth + boundsHeight * boundsHeight;
    
    var resolution = Math.sqrt(screenPixels / boundsDistance);
    
    var frustumData = {
        resolution: resolution,
        rectangle: bounds,
        
        // Redundant, but enables to avoid already-performed calculation
        screenSize: screenSize
    };
    
    return frustumData;
}
    
function createScheduler(
    showLog, prioritizerType, schedulerName, createResource, resourceLimit) {
    
    var prioritizer;
    var scheduler;
    
    if (prioritizerType === undefined) {
        prioritizer = null;
        
        scheduler = new ResourceScheduler.LifoScheduler(
            createResource,
            resourceLimit);
    } else {
        var limitResourceByLowQualityPriority = false;
        
        if (prioritizerType === 'frustum') {
            limitResourceByLowQualityPriority = true;
            prioritizer = new FrustumRequestsPrioritizer();
        } else if (prioritizerType === 'frustumOnly') {
            limitResourceByLowQualityPriority = true;
            prioritizer = new FrustumRequestsPrioritizer(
                /*isAbortRequestsNotInFrustum=*/true,
                /*isPrioritizeLowQualityStage=*/true);
        } else {
            prioritizer = prioritizerType;
        }
        
        var options = {
            schedulerName: schedulerName,
            showLog: showLog
        };
        
        if (limitResourceByLowQualityPriority) {
            options.resourceGuaranteedForHighPriority = resourceLimit - 2;
            options.highPriorityToGuaranteeResource =
                prioritizer.minimalLowQualityPriority;
        }
        
        scheduler = new ResourceScheduler.PriorityScheduler(
            createResource,
            resourceLimit,
            prioritizer,
            options);
    }
    
    return {
        prioritizer: prioritizer,
        scheduler: scheduler
    };
}
    
function fixBounds(bounds, image, adaptProportions) {
    if (!adaptProportions) {
        return;
    }

    var rectangleWidth = bounds.east - bounds.west;
    var rectangleHeight = bounds.north - bounds.south;

    var pixelsAspectRatio =
        image.getLevelWidth() / image.getLevelHeight();
    var rectangleAspectRatio = rectangleWidth / rectangleHeight;
    
    if (pixelsAspectRatio < rectangleAspectRatio) {
        var oldWidth = rectangleWidth;
        rectangleWidth = rectangleHeight * pixelsAspectRatio;
        var substractFromWidth = oldWidth - rectangleWidth;
        
        bounds.east -= substractFromWidth / 2;
        bounds.west += substractFromWidth / 2;
    } else {
        var oldHeight = rectangleHeight;
        rectangleHeight = rectangleWidth / pixelsAspectRatio;
        var substractFromHeight = oldHeight - rectangleHeight;
        
        bounds.north -= substractFromHeight / 2;
        bounds.south += substractFromHeight / 2;
    }
}

function alignParamsToTilesAndLevel(
    region, imageDecoder) {
    
    var sizesCalculator = imageDecoder._getSizesCalculator();
    var tileWidth = imageDecoder.getTileWidth();
    var tileHeight = imageDecoder.getTileHeight();
    
    var regionMinX = region.minX;
    var regionMinY = region.minY;
    var regionMaxX = region.maxXExclusive;
    var regionMaxY = region.maxYExclusive;
    var screenWidth = region.screenWidth;
    var screenHeight = region.screenHeight;
    
    var isValidOrder = regionMinX < regionMaxX && regionMinY < regionMaxY;
    if (!isValidOrder) {
        throw 'Parameters order is invalid';
    }
    
    if (regionMaxX < 0 || regionMinX >= sizesCalculator.getLevelWidth() ||
        regionMaxY < 0 || regionMinY >= sizesCalculator.getLevelHeight()) {
        
        return null;
    }
    
    var maxLevel =
        sizesCalculator.getDefaultNumResolutionLevels() - 1;

    var levelX = Math.log((regionMaxX - regionMinX) / screenWidth ) / log2;
    var levelY = Math.log((regionMaxY - regionMinY) / screenHeight) / log2;
    var level = Math.ceil(Math.min(levelX, levelY));
    level = Math.max(0, Math.min(maxLevel, level));
    
    var levelWidth = sizesCalculator.getLevelWidth(level);
    var imageWidth = sizesCalculator.getLevelWidth();
    var levelHeight = sizesCalculator.getLevelHeight(level);
    var imageHeight = sizesCalculator.getLevelHeight();
    
    var scaleX = imageWidth / levelWidth;
    var scaleY = imageHeight / levelHeight;
    
    var minTileX = Math.floor(regionMinX / (scaleX * tileWidth));
    var minTileY = Math.floor(regionMinY / (scaleY * tileHeight));
    var maxTileX = Math.ceil(regionMaxX / (scaleX * tileWidth));
    var maxTileY = Math.ceil(regionMaxY / (scaleY * tileHeight));
    
    var minX = Math.max(0, Math.min(levelWidth, minTileX * tileWidth));
    var maxX = Math.max(0, Math.min(levelWidth, maxTileX * tileWidth));
    var minY = Math.max(0, Math.min(levelHeight, minTileY * tileHeight));
    var maxY = Math.max(0, Math.min(levelHeight, maxTileY * tileHeight));
    
    var imagePartParams = {
        minX: minX,
        minY: minY,
        maxXExclusive: maxX,
        maxYExclusive: maxY,
        numResolutionLevelsToCut: level
    };
    
    var positionInImage = {
        minX: minX * scaleX,
        minY: minY * scaleY,
        maxXExclusive: maxX * scaleX,
        maxYExclusive: maxY * scaleY
    };
    
    return {
        imagePartParams: imagePartParams,
        positionInImage: positionInImage
    };
}

function getImageImplementation(imageImplementationClassName) {
    return  (window && window[imageImplementationClassName]) ||
            (globals && globals[imageImplementationClassName]) ||
            (self && self[imageImplementationClassName]);
}

function getScriptsForWorkerImport(imageImplementation, options) {
    return scriptsForWorkerToImport.concat(
        imageImplementation.getScriptsToImport());
}
},{"frustumrequestsprioritizer.js":13}],15:[function(require,module,exports){
arguments[4][14][0].apply(exports,arguments)
},{"dup":14,"frustumrequestsprioritizer.js":13}],16:[function(require,module,exports){
'use strict';

var LinkedList = (function LinkedListClosure() {
    function LinkedList() {
        this._first = { _prev: null, _parent: this };
        this._last = { _next: null, _parent: this };
        this._count = 0;
        
        this._last._prev = this._first;
        this._first._next = this._last;
    }
    
    LinkedList.prototype.add = function add(value, addBefore) {
        if (addBefore === null || addBefore === undefined) {
            addBefore = this._last;
        }
        
        this._validateIteratorOfThis(addBefore);
        
        ++this._count;
        
        var newNode = {
            _value: value,
            _next: addBefore,
            _prev: addBefore._prev,
            _parent: this
        };
        
        newNode._prev._next = newNode;
        addBefore._prev = newNode;
        
        return newNode;
    };
    
    LinkedList.prototype.remove = function remove(iterator) {
        this._validateIteratorOfThis(iterator);
        
        --this._count;
        
        iterator._prev._next = iterator._next;
        iterator._next._prev = iterator._prev;
        iterator._parent = null;
    };
    
    LinkedList.prototype.getValue = function getValue(iterator) {
        this._validateIteratorOfThis(iterator);
        
        return iterator._value;
    };
    
    LinkedList.prototype.getFirstIterator = function getFirstIterator() {
        var iterator = this.getNextIterator(this._first);
        return iterator;
    };
    
    LinkedList.prototype.getLastIterator = function getFirstIterator() {
        var iterator = this.getPrevIterator(this._last);
        return iterator;
    };
    
    LinkedList.prototype.getNextIterator = function getNextIterator(iterator) {
        this._validateIteratorOfThis(iterator);

        if (iterator._next === this._last) {
            return null;
        }
        
        return iterator._next;
    };
    
    LinkedList.prototype.getPrevIterator = function getPrevIterator(iterator) {
        this._validateIteratorOfThis(iterator);

        if (iterator._prev === this._first) {
            return null;
        }
        
        return iterator._prev;
    };
    
    LinkedList.prototype.getCount = function getCount() {
        return this._count;
    };
    
    LinkedList.prototype._validateIteratorOfThis =
        function validateIteratorOfThis(iterator) {
        
        if (iterator._parent !== this) {
            throw 'iterator must be of the current LinkedList';
        }
    };
    
    return LinkedList;
})();
},{}],17:[function(require,module,exports){
'use strict';

// Suppress "Unnecessary directive 'use strict'" for the slaveScriptContent function
/*jshint -W034 */

module.exports.getScriptUrl = function getScriptUrl() {
    return slaveScriptUrl;
};

var slaveScriptBlob = new Blob(
    ['(', slaveScriptContent.toString(), ')()'],
    { type: 'application/javascript' });
var slaveScriptUrl = URL.createObjectURL(slaveScriptBlob);

function slaveScriptContent() {
    'use strict';
    
    var isReady = false;

    AsyncProxy.AsyncProxySlave.setBeforeOperationListener(beforeOperationListener);

    function beforeOperationListener(operationType, operationName, args) {
        /* jshint validthis: true */
        
        if (operationType !== 'callback' || operationName !== 'statusCallback') {
            return;
        }
        
        if (isReady || !args[0].isReady) {
            return null;
        }
        
        var sizes = this._getSizesParams();
        isReady = true;
        
        AsyncProxy.AsyncProxySlave.sendUserDataToMaster(sizes);
    }
}
},{}],18:[function(require,module,exports){
'use strict';

module.exports = WorkerProxyFetchManager;

var imageHelperFunctions = require('imagehelperfunctions.js');
var sendImageParametersToMaster = require('sendimageparameterstomaster.js');

function WorkerProxyFetchManager(imageImplementationClassName, options) {
    this._imageWidth = null;
    this._imageHeight = null;
    this._sizesParams = null;
    this._currentStatusCallbackWrapper = null;
    
    var ctorArgs = [options];
    
    this._imageImplementation = imageHelperFunctions.getImageImplementation(imageImplementationClassName);

    var scriptsToImport = imageHelperFunctions.getScriptsForWorkerImport(
        this._imageImplementation, options);
    scriptsToImport = scriptsToImport.concat([sendImageParametersToMaster.getScriptUrl()]);
    
    this._workerHelper = new AsyncProxy.AsyncProxyMaster(
        scriptsToImport, 'FetchManager', ctorArgs);
    
    var boundUserDataHandler = this._userDataHandler.bind(this);
    this._workerHelper.setUserDataHandler(boundUserDataHandler);
}

WorkerProxyFetchManager.prototype.setStatusCallback = function setStatusCallback(statusCallback) {
    if (this._currentStatusCallbackWrapper !== null) {
        this._workerHelper.freeCallback(this._currentStatusCallbackWrapper);
    }
    
    var callbackWrapper = this._workerHelper.wrapCallbackFromMasterSide(
        statusCallback, 'statusCallback', /*isMultipleTimeCallback=*/true);
    
    this._currentStatusCallbackWrapper = callbackWrapper;
    this._workerHelper.callFunction('setStatusCallback', [callbackWrapper]);
};

WorkerProxyFetchManager.prototype.open = function open(url) {
    this._workerHelper.callFunction('open', [url]);
};

WorkerProxyFetchManager.prototype.close = function close(closedCallback) {
    var self = this;
    
    var callbackWrapper = this._workerHelper.wrapCallbackFromMasterSide(
        internalClosedCallback, 'closedCallback');
        
    this._workerHelper.callFunction('close', [callbackWrapper]);
    
    function internalClosedCallback() {
        self._workerHelper.terminate();
        
        if (closedCallback !== undefined) {
            closedCallback();
        }
    }
};

WorkerProxyFetchManager.prototype.createChannel = function createChannel(
    createdCallback) {
    
    var callbackWrapper = this._workerHelper.wrapCallbackFromMasterSide(
        createdCallback,
        'FetchManager_createChannelCallback');
    
    var args = [callbackWrapper];
    this._workerHelper.callFunction('createChannel', args);
};

WorkerProxyFetchManager.prototype.moveChannel = function moveChannel(
    channelHandle, imagePartParams) {
    
    var args = [channelHandle, imagePartParams];
    this._workerHelper.callFunction('moveChannel', args);
};

WorkerProxyFetchManager.prototype.createRequest = function createRequest(
    fetchParams,
    callbackThis,
    callback,
    terminatedCallback,
    isOnlyWaitForData,
    requestId) {
    
    //var pathToArrayInPacketsData = [0, 'data', 'buffer'];
    //var pathToHeadersCodestream = [1, 'codestream', 'buffer'];
    //var transferablePaths = [
    //    pathToArrayInPacketsData,
    //    pathToHeadersCodestream
    //];
    
    var transferablePaths = this._imageImplementation.getTransferablePathsOfRequestCallback();
    
    var internalCallbackWrapper =
        this._workerHelper.wrapCallbackFromMasterSide(
            callback.bind(callbackThis),
            'requestTilesProgressiveCallback',
            /*isMultipleTimeCallback=*/true,
            transferablePaths);
    
    var internalTerminatedCallbackWrapper =
        this._workerHelper.wrapCallbackFromMasterSide(
            internalTerminatedCallback,
            'requestTilesProgressiveTerminatedCallback',
            /*isMultipleTimeCallback=*/false);
            
    var args = [
        fetchParams,
        /*callbackThis=*/{ dummyThis: 'dummyThis' },
        internalCallbackWrapper,
        internalTerminatedCallbackWrapper,
        isOnlyWaitForData,
        requestId];
        
    var self = this;
    
    this._workerHelper.callFunction('createRequest', args);
    
    function internalTerminatedCallback(isAborted) {
        self._workerHelper.freeCallback(internalCallbackWrapper);
        terminatedCallback.call(callbackThis, isAborted);
    }
};

WorkerProxyFetchManager.prototype.manualAbortRequest = function manualAbortRequest(
    requestId) {
    
    var args = [requestId];
    this._workerHelper.callFunction(
        'manualAbortRequest', args);
};

WorkerProxyFetchManager.prototype.setIsProgressiveRequest = function setIsProgressiveRequest(
    requestId, isProgressive) {
    
    var args = [requestId, isProgressive];
    this._workerHelper.callFunction('setIsProgressiveRequest', args);
};

WorkerProxyFetchManager.prototype.setServerRequestPrioritizerData =
    function setServerRequestPrioritizerData(prioritizerData) {
    
    this._workerHelper.callFunction(
        'setServerRequestPrioritizerData',
        [ prioritizerData ],
        { isSendImmediately: true });
};

WorkerProxyFetchManager.prototype.reconnect = function reconnect() {
    this._workerHelper.callFunction('reconnect');
};

WorkerProxyFetchManager.prototype.getSizesParams = function getSizesParams() {
    if (this._sizesParams === null) {
        throw 'Image is not ready yet';
    }
    
    return this._sizesParams;
};

WorkerProxyFetchManager.prototype._userDataHandler = function userDataHandler(sizesParams) {
    this._sizesParams = sizesParams;
};
},{"imagehelperfunctions.js":15,"sendimageparameterstomaster.js":17}],19:[function(require,module,exports){
'use strict';

module.exports = WorkerProxyImageDecoder;

var imageHelperFunctions = require('imagehelperfunctions.js');
var sendImageParametersToMaster = require('sendimageparameterstomaster.js');

function WorkerProxyImageDecoder(imageImplementationClassName, options) {
    this._imageWidth = null;
    this._imageHeight = null;
    this._sizesParams = null;
    this._tileWidth = 0;
    this._tileHeight = 0;
    this._currentStatusCallbackWrapper = null;
    
    var ctorArgs = [imageImplementationClassName, options];

    this._imageImplementation = imageHelperFunctions.getImageImplementation(imageImplementationClassName);
    
    var scriptsToImport = imageHelperFunctions.getScriptsForWorkerImport(
        this._imageImplementation, options);
    scriptsToImport = scriptsToImport.concat([sendImageParametersToMaster.getScriptUrl()]);

    this._workerHelper = new AsyncProxy.AsyncProxyMaster(
        scriptsToImport, 'ImageDecoder', ctorArgs);
    
    var boundUserDataHandler = this._userDataHandler.bind(this);
    this._workerHelper.setUserDataHandler(boundUserDataHandler);
}

WorkerProxyImageDecoder.prototype.setStatusCallback = function setStatusCallback(statusCallback) {
    if (this._currentStatusCallbackWrapper !== null) {
        this._workerHelper.freeCallback(this._currentStatusCallbackWrapper);
    }
    
    var callbackWrapper = this._workerHelper.wrapCallbackFromMasterSide(
        statusCallback, 'statusCallback', /*isMultipleTimeCallback=*/true);
    
    this._currentStatusCallbackWrapper = callbackWrapper;
    this._workerHelper.callFunction('setStatusCallback', [callbackWrapper]);
};

WorkerProxyImageDecoder.prototype.open = function open(url) {
    this._workerHelper.callFunction('open', [url]);
};

WorkerProxyImageDecoder.prototype.close = function close(closedCallback) {
    var self = this;
    
    var callbackWrapper = this._workerHelper.wrapCallbackFromMasterSide(
        internalClosedCallback, 'closedCallback');
        
    this._workerHelper.callFunction('close', [callbackWrapper]);
    
    function internalClosedCallback() {
        self._workerHelper.terminate();
        
        if (closedCallback !== undefined) {
            closedCallback();
        }
    }
};

WorkerProxyImageDecoder.prototype.getLevelWidth = function getLevelWidth(numResolutionLevelsToCut) {
    if (this._sizesCalculator === null) {
        throw 'Image is not ready yet';
    }

    var width = this._sizesCalculator.getLevelWidth(
        numResolutionLevelsToCut);
    return width;
};

WorkerProxyImageDecoder.prototype.getLevelHeight = function getLevelHeight(numResolutionLevelsToCut) {
    if (this._sizesCalculator === null) {
        throw 'Image is not ready yet';
    }
    
    var height = this._sizesCalculator.getLevelHeight(
        numResolutionLevelsToCut);
    return height;
};

WorkerProxyImageDecoder.prototype.getTileWidth = function getTileWidth() {
    if (this._tileWidth === 0) {
        throw 'Image is not ready yet';
    }

    return this._tileWidth;
};

WorkerProxyImageDecoder.prototype.getTileHeight = function getTileHeight() {
    if (this._tileHeight === 0) {
        throw 'Image is not ready yet';
    }

    return this._tileHeight;
};

WorkerProxyImageDecoder.prototype.getDefaultNumResolutionLevels = function getDefaultNumResolutionLevels() {
    if (this._sizesCalculator === null) {
        throw 'Image is not ready yet';
    }
    
    var numLevels = this._sizesCalculator.getDefaultNumResolutionLevels();
    return numLevels;
};

WorkerProxyImageDecoder.prototype.getDefaultNumQualityLayers = function getDefaultNumQualityLayers() {
    if (this._sizesCalculator === null) {
        throw 'Image is not ready yet';
    }
    
    var numLayers = this._sizesCalculator.getDefaultNumQualityLayers();
    return numLayers;
};

WorkerProxyImageDecoder.prototype.createChannel = function createChannel(
    createdCallback) {
    
    var callbackWrapper = this._workerHelper.wrapCallbackFromMasterSide(
        createdCallback, 'ImageDecoder_createChannelCallback');
    
    var args = [callbackWrapper];
    this._workerHelper.callFunction('createChannel', args);
};

WorkerProxyImageDecoder.prototype.requestPixels = function requestPixels(imagePartParams) {
    var pathToPixelsArray = ['pixels', 'buffer'];
    var transferables = [pathToPixelsArray];
    
    var args = [imagePartParams];
    
    this._workerHelper.callFunction('requestPixels', args, {
        isReturnPromise: true,
        pathsToTransferablesInPromiseResult: transferables
    });
};

WorkerProxyImageDecoder.prototype.requestPixelsProgressive = function requestPixelsProgressive(
    imagePartParams,
    callback,
    terminatedCallback,
    imagePartParamsNotNeeded,
    channelHandle) {
    
    var transferables;
    
    // NOTE: Cannot pass it as transferables because it is passed to all
    // listener callbacks, thus after the first one the buffer is not valid
    
    //var pathToPixelsArray = [0, 'pixels', 'buffer'];
    //transferables = [pathToPixelsArray];
    
    var internalCallbackWrapper =
        this._workerHelper.wrapCallbackFromMasterSide(
            callback,
            'requestPixelsProgressiveCallback',
            /*isMultipleTimeCallback=*/true,
            transferables);
    
    var internalTerminatedCallbackWrapper =
        this._workerHelper.wrapCallbackFromMasterSide(
            internalTerminatedCallback,
            'requestPixelsProgressiveTerminatedCallback',
            /*isMultipleTimeCallback=*/false);
            
    var args = [
        imagePartParams,
        internalCallbackWrapper,
        internalTerminatedCallbackWrapper,
        imagePartParamsNotNeeded,
        channelHandle];
    
    this._workerHelper.callFunction('requestPixelsProgressive', args);
        
    var self = this;
    
    function internalTerminatedCallback(isAborted) {
        self._workerHelper.freeCallback(internalCallbackWrapper);
        
        terminatedCallback(isAborted);
    }
};

WorkerProxyImageDecoder.prototype.setServerRequestPrioritizerData =
    function setServerRequestPrioritizerData(prioritizerData) {
    
    this._workerHelper.callFunction(
        'setServerRequestPrioritizerData',
        [ prioritizerData ],
        { isSendImmediately: true });
};

WorkerProxyImageDecoder.prototype.setDecodePrioritizerData =
    function setDecodePrioritizerData(prioritizerData) {
    
    this._workerHelper.callFunction(
        'setDecodePrioritizerData',
        [ prioritizerData ],
        { isSendImmediately: true });
};

WorkerProxyImageDecoder.prototype.reconnect = function reconnect() {
    this._workerHelper.callFunction('reconnect');
};

WorkerProxyImageDecoder.prototype._getSizesCalculator = function getSizesCalculator() {
    if (this._sizesCalculator === null) {
        throw 'Image is not ready yet';
    }
    
    return this._sizesCalculator;
};

WorkerProxyImageDecoder.prototype._getSizesParams = function getSizesParams() {
    if (this._sizesParams === null) {
        throw 'Image is not ready yet';
    }
    
    return this._sizesParams;
};

WorkerProxyImageDecoder.prototype._userDataHandler = function userDataHandler(sizesParams) {
    this._sizesParams = sizesParams;
    this._tileWidth = sizesParams.applicativeTileWidth;
    this._tileHeight = sizesParams.applicativeTileHeight;
    this._sizesCalculator = this._imageImplementation.createImageParamsRetriever(
        sizesParams.imageParams);
};
},{"imagehelperfunctions.js":15,"sendimageparameterstomaster.js":17}],20:[function(require,module,exports){
'use strict';

// Suppress "Unnecessary directive 'use strict'" for the slaveScriptContent function
/*jshint -W034 */

/* global self: false */

module.exports = WorkerProxyPixelsDecoder;

var imageHelperFunctions = require('imagehelperfunctions.js');

var decoderSlaveScriptBlob = new Blob(
    ['(', decoderSlaveScriptBody.toString(), ')()'],
    { type: 'application/javascript' });
var decoderSlaveScriptUrl = URL.createObjectURL(decoderSlaveScriptBlob);

function WorkerProxyPixelsDecoder(imageImplementationClassName) {
    this._imageImplementation = imageHelperFunctions.getImageImplementation(
        imageImplementationClassName);
    
    var scriptsToImport = imageHelperFunctions.getScriptsForWorkerImport(
        this._imageImplementation);
    scriptsToImport = scriptsToImport.concat([decoderSlaveScriptUrl]);
    
    var args = [imageImplementationClassName];
    
    this._workerHelper = new AsyncProxy.AsyncProxyMaster(
        scriptsToImport,
        'ArbitraryClassName',
        args);
}

WorkerProxyPixelsDecoder.prototype.decode = function decode(dataForDecode) {
    var transferables = this._imageImplementation.getTransferablesOfRequestCallback(dataForDecode);
    var resultTransferables = [0, 'pixels', 'buffer'];
    
    var args = [dataForDecode];
    var options = {
        transferables: transferables,
        pathsToTransferablesInPromiseResult: resultTransferables,
        isReturnPromise: true
    };
    
    return this._workerHelper.callFunction('decode', args, options);
};

function decoderSlaveScriptBody() {
    'use strict';

    AsyncProxy.AsyncProxySlave.setSlaveSideCreator(createDecoder);

    function createDecoder(imageImplementationClassName) {
        var imageImplementation = self[imageImplementationClassName];
        return imageImplementation.createDecoder();
    }
}
},{"imagehelperfunctions.js":15}],21:[function(require,module,exports){
'use strict';

module.exports = ViewerImageDecoder;

var ImageDecoder = require('imagedecoder.js');
var WorkerProxyImageDecoder = require('workerproxyimagedecoder.js');
var imageHelperFunctions = require('imagehelperfunctions.js');

var PENDING_CALL_TYPE_PIXELS_UPDATED = 1;
var PENDING_CALL_TYPE_REPOSITION = 2;

var REGION_OVERVIEW = 0;
var REGION_DYNAMIC = 1;

function ViewerImageDecoder(canvasUpdatedCallback, options) {
    this._canvasUpdatedCallback = canvasUpdatedCallback;
    
    this._adaptProportions = options.adaptProportions;
    this._cartographicBounds = options.cartographicBounds;
    this._maxNumQualityLayers = options.maxNumQualityLayers;
    this._isMainImageOnUi = options.isMainImageOnUi;
    this._showLog = options.showLog;
    this._allowMultipleChannelsInSession =
        options.allowMultipleChannelsInSession;
    this._minFunctionCallIntervalMilliseconds =
        options.minFunctionCallIntervalMilliseconds;
        
    this._lastRequestIndex = 0;
    this._pendingUpdateViewArea = null;
    this._regions = [];
    this._targetCanvas = null;
    
    this._callPendingCallbacksBound = this._callPendingCallbacks.bind(this);
    this._createdChannelBound = this._createdChannel.bind(this);
    
    this._pendingCallbacksIntervalHandle = 0;
    this._pendingCallbackCalls = [];
    this._exceptionCallback = null;
    this._canShowDynamicRegion = false;
    
    if (this._cartographicBounds === undefined) {
        this._cartographicBounds = {
            west: -175.0,
            east: 175.0,
            south: -85.0,
            north: 85.0
        };
    }
    
    if (this._adaptProportions === undefined) {
        this._adaptProportions = true;
    }
    
    var ImageType = this._isMainImageOnUi ?
        ImageDecoder: WorkerProxyImageDecoder;
        
    this._image = new ImageType({
        serverRequestPrioritizer: 'frustumOnly',
        decodePrioritizer: 'frustumOnly',
        showLog: this._showLog
        });
    
    this._image.setStatusCallback(this._internalStatusCallback.bind(this));
}

ViewerImageDecoder.prototype.setExceptionCallback = function setExceptionCallback(exceptionCallback) {
    this._exceptionCallback = exceptionCallback;
};
    
ViewerImageDecoder.prototype.open = function open(url) {
    this._image.open(url);
};

ViewerImageDecoder.prototype.close = function close() {
    this._image.close();
    this._isReady = false;
    this._canShowDynamicRegion = false;
    this._targetCanvas = null;
};

ViewerImageDecoder.prototype.setTargetCanvas = function setTargetCanvas(canvas) {
    this._targetCanvas = canvas;
};

ViewerImageDecoder.prototype.updateViewArea = function updateViewArea(frustumData) {
    if (this._targetCanvas === null) {
        throw 'Cannot update dynamic region before setTargetCanvas()';
    }
    
    if (!this._canShowDynamicRegion) {
        this._pendingUpdateViewArea = frustumData;
        
        return;
    }
    
    var bounds = frustumData.rectangle;
    var screenSize = frustumData.screenSize;
    
    var regionParams = {
        minX: bounds.west * this._scaleX + this._translateX,
        minY: bounds.north * this._scaleY + this._translateY,
        maxXExclusive: bounds.east * this._scaleX + this._translateX,
        maxYExclusive: bounds.south * this._scaleY + this._translateY,
        screenWidth: screenSize.x,
        screenHeight: screenSize.y
    };
    
    var alignedParams =
        imageHelperFunctions.alignParamsToTilesAndLevel(
            regionParams, this._image);
    
    var isOutsideScreen = alignedParams === null;
    if (isOutsideScreen) {
        return;
    }
    
    alignedParams.imagePartParams.maxNumQualityLayers = this._maxNumQualityLayers;

    var isSameRegion =
        this._dynamicFetchParams !== undefined &&
        this._isImagePartsEqual(
            alignedParams.imagePartParams,
            this._dynamicFetchParams.imagePartParams);
    
    if (isSameRegion) {
        return;
    }
    
    frustumData.imageRectangle = this._cartographicBoundsFixed;
    frustumData.exactNumResolutionLevelsToCut =
        alignedParams.imagePartParams.numResolutionLevelsToCut;
    
    this._image.setDecodePrioritizerData(frustumData);
    this._image.setServerRequestPrioritizerData(frustumData);

    this._dynamicFetchParams = alignedParams;
    
    var allowAdditionalChannel = false;
    var moveExistingChannel = !this._allowMultipleChannelsInSession;
    this._fetch(
        REGION_DYNAMIC,
        alignedParams,
        allowAdditionalChannel,
        moveExistingChannel);
};

ViewerImageDecoder.prototype._isImagePartsEqual = function isImagePartsEqual(first, second) {
    var isEqual =
        this._dynamicFetchParams !== undefined &&
        first.minX === second.minX &&
        first.minY === second.minY &&
        first.maxXExclusive === second.maxXExclusive &&
        first.maxYExclusive === second.maxYExclusive &&
        first.numResolutionLevelsToCut === second.numResolutionLevelsToCut;
    
    return isEqual;
};

ViewerImageDecoder.prototype._fetch = function fetch(
    regionId,
    fetchParams,
    allowAdditionalChannel,
    moveExistingChannel) {
    
    var requestIndex = ++this._lastRequestIndex;
    
    var imagePartParams = fetchParams.imagePartParams;
    imagePartParams.requestPriorityData =
        imagePartParams.requestPriorityData || {};
    
    imagePartParams.requestPriorityData.requestIndex = requestIndex;

    var minX = fetchParams.positionInImage.minX;
    var minY = fetchParams.positionInImage.minY;
    var maxX = fetchParams.positionInImage.maxXExclusive;
    var maxY = fetchParams.positionInImage.maxYExclusive;
    
    var west = (minX - this._translateX) / this._scaleX;
    var east = (maxX - this._translateX) / this._scaleX;
    var north = (minY - this._translateY) / this._scaleY;
    var south = (maxY - this._translateY) / this._scaleY;
    
    var position = {
        west: west,
        east: east,
        north: north,
        south: south
    };
    
    var canReuseOldData = false;
    var fetchParamsNotNeeded;
    
    var region = this._regions[regionId];
    if (region !== undefined) {
        var newResolution = imagePartParams.numResolutionLevelsToCut;
        var oldResolution = region.imagePartParams.numResolutionLevelsToCut;
        
        canReuseOldData = newResolution === oldResolution;
        
        if (canReuseOldData && region.isDone) {
            fetchParamsNotNeeded = [ region.imagePartParams ];
        }

        if (regionId !== REGION_OVERVIEW) {
            var addedPendingCall = this._checkIfRepositionNeeded(
                region, imagePartParams, position);
            
            if (addedPendingCall) {
                this._notifyNewPendingCalls();
            }
        }
    }
    
    var self = this;
    
    var channelHandle = moveExistingChannel ? this._channelHandle: undefined;

    this._image.requestPixelsProgressive(
        fetchParams.imagePartParams,
        callback,
        terminatedCallback,
        fetchParamsNotNeeded,
        channelHandle);
    
    function callback(decoded) {
        self._tilesDecodedCallback(
            regionId,
            fetchParams,
            position,
            decoded);
    }
    
    function terminatedCallback(isAborted) {
        if (isAborted &&
            imagePartParams.requestPriorityData.overrideHighestPriority) {
            
            // NOTE: Bug in kdu_server causes first request to be sent wrongly.
            // Then Chrome raises ERR_INVALID_CHUNKED_ENCODING and the request
            // never returns. Thus perform second request.
            
            self._image.requestPixelsProgressive(
                fetchParams.imagePartParams,
                callback,
                terminatedCallback,
                fetchParamsNotNeeded);
        }
        
        self._fetchTerminatedCallback(
            regionId,
            fetchParams.imagePartParams.requestPriorityData,
            isAborted,
            allowAdditionalChannel);
    }
};

ViewerImageDecoder.prototype._fetchTerminatedCallback = function fetchTerminatedCallback(
    regionId, priorityData, isAborted, allowAdditionalChannel) {
    
    var region = this._regions[regionId];
    if (region === undefined) {
        return;
    }
    
    if (!priorityData.overrideHighestPriority &&
        priorityData.requestIndex !== this._lastRequestIndex) {
    
        return;
    }
    
    region.isDone = !isAborted && this._isReady;
    
    if (allowAdditionalChannel) {
        this._image.createChannel(
            this._createdChannelBound);
    }
};

ViewerImageDecoder.prototype._createdChannel = function createdChannel(channelHandle) {
    this._channelHandle = channelHandle;
    this._startShowingDynamicRegion();
};

ViewerImageDecoder.prototype._startShowingDynamicRegion = function startShowingDynamicRegion() {
    this._canShowDynamicRegion = true;
    
    if (this._pendingUpdateViewArea !== null) {
        this.updateViewArea(this._pendingUpdateViewArea);
        
        this._pendingUpdateViewArea = null;
    }
};

ViewerImageDecoder.prototype._tilesDecodedCallback = function tilesDecodedCallback(
    regionId, fetchParams, position, decoded) {
    
    if (!this._isReady) {
        return;
    }
    
    var region = this._regions[regionId];
    if (region === undefined) {
        region = {};
        this._regions[regionId] = region;
        
        switch (regionId) {
            case REGION_DYNAMIC:
                region.canvas = this._targetCanvas;
                break;
                
            case REGION_OVERVIEW:
                region.canvas = document.createElement('canvas');
                break;
            
            default:
                throw 'Unexpected regionId ' + regionId;
        }
    }
    
    var partParams = fetchParams.imagePartParams;
    if (!partParams.requestPriorityData.overrideHighestPriority &&
        partParams.requestPriorityData.requestIndex < region.currentDisplayRequestIndex) {
        
        return;
    }
    
    this._checkIfRepositionNeeded(region, partParams, position);
        
    this._pendingCallbackCalls.push({
        type: PENDING_CALL_TYPE_PIXELS_UPDATED,
        region: region,
        decoded: decoded
    });
    
    this._notifyNewPendingCalls();
};

ViewerImageDecoder.prototype._checkIfRepositionNeeded = function checkIfRepositionNeeded(
    region, newPartParams, newPosition) {
    
    var oldPartParams = region.imagePartParams;
    var level = newPartParams.numResolutionLevelsToCut;
    
    var needReposition =
        oldPartParams === undefined ||
        oldPartParams.minX !== newPartParams.minX ||
        oldPartParams.minY !== newPartParams.minY ||
        oldPartParams.maxXExclusive !== newPartParams.maxXExclusive ||
        oldPartParams.maxYExclusive !== newPartParams.maxYExclusive ||
        oldPartParams.numResolutionLevelsToCut !== level;
    
    if (!needReposition) {
        return false;
    }
    
    var copyData;
    var intersection;
    var reuseOldData = false;
    if (oldPartParams !== undefined &&
        oldPartParams.numResolutionLevelsToCut === level) {
        
        intersection = {
            minX: Math.max(oldPartParams.minX, newPartParams.minX),
            minY: Math.max(oldPartParams.minY, newPartParams.minY),
            maxX: Math.min(oldPartParams.maxXExclusive, newPartParams.maxXExclusive),
            maxY: Math.min(oldPartParams.maxYExclusive, newPartParams.maxYExclusive)
        };
        reuseOldData =
            intersection.maxX > intersection.minX &&
            intersection.maxY > intersection.minY;
    }
    
    if (reuseOldData) {
        copyData = {
            fromX: intersection.minX - oldPartParams.minX,
            fromY: intersection.minY - oldPartParams.minY,
            toX: intersection.minX - newPartParams.minX,
            toY: intersection.minY - newPartParams.minY,
            width: intersection.maxX - intersection.minX,
            height: intersection.maxY - intersection.minY
        };
    }
    
    region.imagePartParams = newPartParams;
    region.isDone = false;
    region.currentDisplayRequestIndex = newPartParams.requestPriorityData.requestIndex;
    
    var repositionArgs = {
        type: PENDING_CALL_TYPE_REPOSITION,
        region: region,
        position: newPosition,
        copyData: copyData,
        pixelsWidth: newPartParams.maxXExclusive - newPartParams.minX,
        pixelsHeight: newPartParams.maxYExclusive - newPartParams.minY
    };
    
    this._pendingCallbackCalls.push(repositionArgs);
    
    return true;
};

ViewerImageDecoder.prototype._notifyNewPendingCalls = function notifyNewPendingCalls() {
    if (!this._isNearCallbackCalled) {
        this._callPendingCallbacks();
    }
};

ViewerImageDecoder.prototype._callPendingCallbacks = function callPendingCallbacks() {
    if (this._pendingCallbackCalls.length === 0 || !this._isReady) {
        this._isNearCallbackCalled = false;
        return;
    }
    
    if (this._isNearCallbackCalled) {
        clearTimeout(this._pendingCallbacksIntervalHandle);
    }
    
    if (this._minFunctionCallIntervalMilliseconds !== undefined) {
        this._pendingCallbacksIntervalHandle =
            setTimeout(this._callPendingCallbacksBound,
            this._minFunctionCallIntervalMilliseconds);
            
        this._isNearCallbackCalled = true;
    }

    var newPosition = null;
    
    for (var i = 0; i < this._pendingCallbackCalls.length; ++i) {
        var callArgs = this._pendingCallbackCalls[i];
        
        if (callArgs.type === PENDING_CALL_TYPE_REPOSITION) {
            this._repositionCanvas(callArgs);
            newPosition = callArgs.position;
        } else if (callArgs.type === PENDING_CALL_TYPE_PIXELS_UPDATED) {
            this._pixelsUpdated(callArgs);
        } else {
            throw 'Internal ViewerImageDecoder Error: Unexpected call type ' +
                callArgs.type;
        }
    }
    
    this._pendingCallbackCalls.length = 0;
    
    this._canvasUpdatedCallback(newPosition);
};

ViewerImageDecoder.prototype._pixelsUpdated = function pixelsUpdated(pixelsUpdatedArgs) {
    var region = pixelsUpdatedArgs.region;
    var decoded = pixelsUpdatedArgs.decoded;
    if (decoded.width === 0 || decoded.height === 0) {
        return;
    }
    
    var x = decoded.xInOriginalRequest;
    var y = decoded.yInOriginalRequest;
    
    var context = region.canvas.getContext('2d');
    var imageData = context.createImageData(decoded.width, decoded.height);
    imageData.data.set(decoded.pixels);
    
    context.putImageData(imageData, x, y);
};

ViewerImageDecoder.prototype._repositionCanvas = function repositionCanvas(repositionArgs) {
    var region = repositionArgs.region;
    var position = repositionArgs.position;
    var copyData = repositionArgs.copyData;
    var pixelsWidth = repositionArgs.pixelsWidth;
    var pixelsHeight = repositionArgs.pixelsHeight;
    
    var imageDataToCopy;
    var context = region.canvas.getContext('2d');
    
    if (copyData !== undefined) {
        imageDataToCopy = context.getImageData(
            copyData.fromX, copyData.fromY, copyData.width, copyData.height);
    }
    
    region.canvas.width = pixelsWidth;
    region.canvas.height = pixelsHeight;
    
    if (region !== this._regions[REGION_OVERVIEW]) {
        this._copyOverviewToCanvas(
            context, position, pixelsWidth, pixelsHeight);
    }
    
    if (copyData !== undefined) {
        context.putImageData(imageDataToCopy, copyData.toX, copyData.toY);
    }
    
    region.position = position;
};

ViewerImageDecoder.prototype._copyOverviewToCanvas = function copyOverviewToCanvas(
    context, canvasPosition, canvasPixelsWidth, canvasPixelsHeight) {
    
    var sourcePosition = this._regions[REGION_OVERVIEW].position;
    var sourcePixels =
        this._regions[REGION_OVERVIEW].imagePartParams;
    
    var sourcePixelsWidth =
        sourcePixels.maxXExclusive - sourcePixels.minX;
    var sourcePixelsHeight =
        sourcePixels.maxYExclusive - sourcePixels.minY;
    
    var sourcePositionWidth =
        sourcePosition.east - sourcePosition.west;
    var sourcePositionHeight =
        sourcePosition.north - sourcePosition.south;
        
    var sourceResolutionX =
        sourcePixelsWidth / sourcePositionWidth;
    var sourceResolutionY =
        sourcePixelsHeight / sourcePositionHeight;
    
    var targetPositionWidth =
        canvasPosition.east - canvasPosition.west;
    var targetPositionHeight =
        canvasPosition.north - canvasPosition.south;
        
    var cropWidth = targetPositionWidth * sourceResolutionX;
    var cropHeight = targetPositionHeight * sourceResolutionY;
    
    var cropOffsetPositionX =
        canvasPosition.west - sourcePosition.west;
    var cropOffsetPositionY =
        sourcePosition.north - canvasPosition.north;
        
    var cropPixelOffsetX = cropOffsetPositionX * sourceResolutionX;
    var cropPixelOffsetY = cropOffsetPositionY * sourceResolutionY;
    
    context.drawImage(
        this._regions[REGION_OVERVIEW].canvas,
        cropPixelOffsetX, cropPixelOffsetY, cropWidth, cropHeight,
        0, 0, canvasPixelsWidth, canvasPixelsHeight);
};

ViewerImageDecoder.prototype._internalStatusCallback = function statusCallback(status) {
    if (this._exceptionCallback !== null && status.exception !== null) {
        this._exceptionCallback(status.exception);
    }

    if (this._isReady || !status.isReady) {
        return;
    }
    
    this._isReady = true;
    
    var fixedBounds = {
        west: this._cartographicBounds.west,
        east: this._cartographicBounds.east,
        south: this._cartographicBounds.south,
        north: this._cartographicBounds.north
    };
    imageHelperFunctions.fixBounds(
        fixedBounds, this._image, this._adaptProportions);
    this._cartographicBoundsFixed = fixedBounds;
    
    var imageWidth = this._image.getLevelWidth();
    var imageHeight = this._image.getLevelHeight();

    var rectangleWidth = fixedBounds.east - fixedBounds.west;
    var rectangleHeight = fixedBounds.north - fixedBounds.south;
    this._scaleX = imageWidth / rectangleWidth;
    this._scaleY = -imageHeight / rectangleHeight;
    
    this._translateX = -fixedBounds.west * this._scaleX;
    this._translateY = -fixedBounds.north * this._scaleY;
    
    var overviewParams = {
        minX: 0,
        minY: 0,
        maxXExclusive: imageWidth,
        maxYExclusive: imageHeight,
        screenWidth: 1,
        screenHeight: 1
    };
    
    var overviewAlignedParams =
        imageHelperFunctions.alignParamsToTilesAndLevel(
            overviewParams, this._image);
            
    overviewAlignedParams.imagePartParams.requestPriorityData =
        overviewAlignedParams.imagePartParams.requestPriorityData || {};
    
    overviewAlignedParams.imagePartParams.requestPriorityData.overrideHighestPriority = true;
    overviewAlignedParams.imagePartParams.maxNumQualityLayers = 1;
    
    var allowAdditionalChannel =
        !this._allowMultipleChannelsInSession;
        
    this._fetch(
        REGION_OVERVIEW,
        overviewAlignedParams,
        allowAdditionalChannel);
    
    if (this._allowMultipleChannelsInSession) {
        this._startShowingDynamicRegion();
    }
};
},{"imagedecoder.js":10,"imagehelperfunctions.js":15,"workerproxyimagedecoder.js":19}],22:[function(require,module,exports){
'use strict';

var ViewerImageDecoder = require('viewerimagedecoder.js');
var LeafletFrustumCalculator = require('leafletfrustumcalculator.js');

/* global L: false */

module.exports = L.Class.extend({
    initialize: function initialize(options) {
        this._options = Object.create(options);
        
        if (options.latLngBounds !== undefined) {
            this._options.cartographicBounds = {
                west: options.latLngBounds.getWest(),
                east: options.latLngBounds.getEast(),
                south: options.latLngBounds.getSouth(),
                north: options.latLngBounds.getNorth()
            };
        }
        
        this._targetCanvas = null;
        this._canvasPosition = null;
        this._canvasUpdatedCallbackBound = this._canvasUpdatedCallback.bind(this);
        this._image = null;
        this._exceptionCallback = null;
    },
    
    setExceptionCallback: function setExceptionCallback(exceptionCallback) {
        this._exceptionCallback = exceptionCallback;
        if (this._image !== null) {
            this._image.setExceptionCallback(exceptionCallback);
        }
    },
    
    _createImage: function createImage() {
        if (this._image === null) {
            this._image = new ViewerImageDecoder(
                this._canvasUpdatedCallbackBound,
                this._options);
            
            if (this._exceptionCallback !== null) {
                this._image.setExceptionCallback(this._exceptionCallback);
            }
            
            this._image.open(this._options.url);
        }
    },

    onAdd: function onAdd(map) {
        if (this._map !== undefined) {
            throw 'Cannot add this layer to two maps';
        }
        
        this._map = map;
        this._createImage();

        // create a DOM element and put it into one of the map panes
        this._targetCanvas = L.DomUtil.create(
            'canvas', 'image-decoder-layer-canvas leaflet-zoom-animated');
        
        this._image.setTargetCanvas(this._targetCanvas);
        
        this._canvasPosition = null;
            
        map.getPanes().mapPane.appendChild(this._targetCanvas);

        // add a viewreset event listener for updating layer's position, do the latter
        map.on('viewreset', this._moved, this);
        map.on('move', this._moved, this);

        if (L.Browser.any3d) {
            map.on('zoomanim', this._animateZoom, this);
        }

        this._moved();
    },

    onRemove: function onRemove(map) {
        if (map !== this._map) {
            throw 'Removed from wrong map';
        }
        
        map.off('viewreset', this._moved, this);
        map.off('move', this._moved, this);
        map.off('zoomanim', this._animateZoom, this);
        
        // remove layer's DOM elements and listeners
        map.getPanes().mapPane.removeChild(this._targetCanvas);
        this._targetCanvas = null;
        this._canvasPosition = null;

        this._map = undefined;
        
        this._image.close();
        this._image = null;
    },
    
    _moved: function () {
        this._moveCanvases();

        var frustumData = LeafletFrustumCalculator.calculateFrustum(this._map);
        
        this._image.updateViewArea(frustumData);
    },
    
    _canvasUpdatedCallback: function canvasUpdatedCallback(newPosition) {
        if (newPosition !== null) {
            this._canvasPosition = newPosition;
            this._moveCanvases();
        }
    },
    
    _moveCanvases: function moveCanvases() {
        if (this._canvasPosition === null) {
            return;
        }
    
        // update layer's position
        var west = this._canvasPosition.west;
        var east = this._canvasPosition.east;
        var south = this._canvasPosition.south;
        var north = this._canvasPosition.north;
        
        var topLeft = this._map.latLngToLayerPoint([north, west]);
        var bottomRight = this._map.latLngToLayerPoint([south, east]);
        var size = bottomRight.subtract(topLeft);
        
        L.DomUtil.setPosition(this._targetCanvas, topLeft);
        this._targetCanvas.style.width = size.x + 'px';
        this._targetCanvas.style.height = size.y + 'px';
    },
    
    _animateZoom: function animateZoom(options) {
        // NOTE: All method (including using of private method
        // _latLngToNewLayerPoint) was copied from ImageOverlay,
        // as Leaflet documentation recommends.
        
        var west =  this._canvasPosition.west;
        var east =  this._canvasPosition.east;
        var south = this._canvasPosition.south;
        var north = this._canvasPosition.north;

        var topLeft = this._map._latLngToNewLayerPoint(
            [north, west], options.zoom, options.center);
        var bottomRight = this._map._latLngToNewLayerPoint(
            [south, east], options.zoom, options.center);
        
        var scale = this._map.getZoomScale(options.zoom);
        var size = bottomRight.subtract(topLeft);
        var sizeScaled = size.multiplyBy((1 / 2) * (1 - 1 / scale));
        var origin = topLeft.add(sizeScaled);
        
        this._targetCanvas.style[L.DomUtil.TRANSFORM] =
            L.DomUtil.getTranslateString(origin) + ' scale(' + scale + ') ';
    }
});
},{"leafletfrustumcalculator.js":23,"viewerimagedecoder.js":21}],23:[function(require,module,exports){
'use strict';

var imageHelperFunctions = require('imagehelperfunctions.js');

module.exports = function calculateFrustum(leafletMap) {
    var screenSize = leafletMap.getSize();
    var bounds = leafletMap.getBounds();

    var cartographicBounds = {
        west: bounds.getWest(),
        east: bounds.getEast(),
        south: bounds.getSouth(),
        north: bounds.getNorth()
    };
    
    var frustumData = imageHelperFunctions.calculateFrustum2DFromBounds(
        cartographicBounds, screenSize);

    return frustumData;
};
},{"imagehelperfunctions.js":15}]},{},[1])(1)
});

