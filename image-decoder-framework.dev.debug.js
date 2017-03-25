var LifoScheduler=function LifoSchedulerClosure(){function LifoScheduler(createResource,jobsLimit){this._resourceCreator=createResource;this._jobsLimit=jobsLimit;this._freeResourcesCount=this._jobsLimit;this._freeResources=new Array(this._jobsLimit);this._pendingJobs=[]}LifoScheduler.prototype.enqueueJob=function enqueueJob(jobFunc,jobContext){if(this._freeResourcesCount>0){--this._freeResourcesCount;var resource=this._freeResources.pop();if(resource===undefined)resource=this._resourceCreator();this._schedule(jobFunc,
resource,jobContext)}else this._pendingJobs.push({jobFunc:jobFunc,jobContext:jobContext})};LifoScheduler.prototype._schedule=function schedule(jobFunc,resource,jobContext){var callbacks=new LifoSchedulerCallbacks(this,resource);jobFunc(resource,jobContext,callbacks)};function LifoSchedulerCallbacks(scheduler,resource){this._scheduler=scheduler;this._resource=resource}LifoSchedulerCallbacks.prototype["jobDone"]=function jobDone(){if(this._scheduler._pendingJobs.length>0){var nextJob=this._scheduler._pendingJobs.pop();
this._scheduler._schedule(nextJob.jobFunc,this._resource,nextJob.jobContext)}else{this._scheduler._freeResources.push(this._resource);++this._scheduler._freeResourcesCount}};LifoSchedulerCallbacks.prototype["shouldYieldOrAbort"]=function shouldYieldOrAbort(){return false};LifoSchedulerCallbacks.prototype["tryYield"]=function tryYield(){return false};return LifoScheduler}();var LinkedList=function LinkedListClosure(){function LinkedList(){this.clear()}LinkedList.prototype.clear=function clear(){this._first={_prev:null,_parent:this};this._last={_next:null,_parent:this};this._count=0;this._last._prev=this._first;this._first._next=this._last};LinkedList.prototype.add=function add(value,addBefore){if(addBefore===null||addBefore===undefined)addBefore=this._last;this._validateIteratorOfThis(addBefore);++this._count;var newNode={_value:value,_next:addBefore,_prev:addBefore._prev,
_parent:this};newNode._prev._next=newNode;addBefore._prev=newNode;return newNode};LinkedList.prototype.remove=function remove(iterator){this._validateIteratorOfThis(iterator);--this._count;iterator._prev._next=iterator._next;iterator._next._prev=iterator._prev;iterator._parent=null};LinkedList.prototype.getFromIterator=function getFromIterator(iterator){this._validateIteratorOfThis(iterator);return iterator._value};LinkedList.prototype.getFirstIterator=function getFirstIterator(){var iterator=this.getNextIterator(this._first);
return iterator};LinkedList.prototype.getLastIterator=function getFirstIterator(){var iterator=this.getPrevIterator(this._last);return iterator};LinkedList.prototype.getNextIterator=function getNextIterator(iterator){this._validateIteratorOfThis(iterator);if(iterator._next===this._last)return null;return iterator._next};LinkedList.prototype.getPrevIterator=function getPrevIterator(iterator){this._validateIteratorOfThis(iterator);if(iterator._prev===this._first)return null;return iterator._prev};LinkedList.prototype.getCount=
function getCount(){return this._count};LinkedList.prototype._validateIteratorOfThis=function validateIteratorOfThis(iterator){if(iterator._parent!==this)throw"iterator must be of the current LinkedList";};return LinkedList}();var PriorityScheduler=function PrioritySchedulerClosure(){function PriorityScheduler(createResource,jobsLimit,prioritizer,options){options=options||{};this._resourceCreator=createResource;this._jobsLimit=jobsLimit;this._prioritizer=prioritizer;this._showLog=options["showLog"];this._schedulerName=options["schedulerName"];this._numNewJobs=options["numNewJobs"]||20;this._numJobsBeforeRerankOldPriorities=options["numJobsBeforeRerankOldPriorities"]||20;this._freeResourcesCount=this._jobsLimit;this._freeResources=
new Array(this._jobsLimit);this._resourcesGuaranteedForHighPriority=options["resourcesGuaranteedForHighPriority"]||0;this._highPriorityToGuaranteeResource=options["highPriorityToGuaranteeResource"]||0;this._logCallIndentPrefix=">";this._pendingJobsCount=0;this._oldPendingJobsByPriority=[];this._newPendingJobsLinkedList=new LinkedList;this._schedulesCounter=0}PriorityScheduler.prototype.enqueueJob=function enqueueJob(jobFunc,jobContext,jobAbortedFunc){log(this,"enqueueJob() start",+1);var priority=
this._prioritizer["getPriority"](jobContext);if(priority<0){jobAbortedFunc(jobContext);log(this,"enqueueJob() end: job aborted",-1);return}var job={jobFunc:jobFunc,jobAbortedFunc:jobAbortedFunc,jobContext:jobContext};var minPriority=getMinimalPriorityToSchedule(this);var resource=null;if(priority>=minPriority)resource=tryGetFreeResource(this);if(resource!==null){schedule(this,job,resource);log(this,"enqueueJob() end: job scheduled",-1);return}enqueueNewJob(this,job,priority);ensurePendingJobsCount(this);
log(this,"enqueueJob() end: job pending",-1)};function jobDoneInternal(self,resource,jobContext){if(self._showLog){var priority=self._prioritizer["getPriority"](jobContext);log(self,"jobDone() start: job done of priority "+priority,+1)}resourceFreed(self,resource);ensurePendingJobsCount(self);log(self,"jobDone() end",-1)}function shouldYieldOrAbortInternal(self,jobContext){log(self,"shouldYieldOrAbort() start",+1);var priority=self._prioritizer["getPriority"](jobContext);var result=priority<0||hasNewJobWithHigherPriority(self,
priority);log(self,"shouldYieldOrAbort() end",-1);return result}function tryYieldInternal(self,jobContinueFunc,jobContext,jobAbortedFunc,jobYieldedFunc,resource){log(self,"tryYield() start",+1);var priority=self._prioritizer["getPriority"](jobContext);if(priority<0){jobAbortedFunc(jobContext);resourceFreed(self,resource);log(self,"tryYield() end: job aborted",-1);return true}var higherPriorityJob=tryDequeueNewJobWithHigherPriority(self,priority);ensurePendingJobsCount(self);if(higherPriorityJob===
null){log(self,"tryYield() end: job continues",-1);return false}jobYieldedFunc(jobContext);var job={jobFunc:jobContinueFunc,jobAbortedFunc:jobAbortedFunc,jobContext:jobContext};enqueueNewJob(self,job,priority);ensurePendingJobsCount(self);schedule(self,higherPriorityJob,resource);ensurePendingJobsCount(self);log(self,"tryYield() end: job yielded",-1);return true}function hasNewJobWithHigherPriority(self,lowPriority){var currentNode=self._newPendingJobsLinkedList.getFirstIterator();log(self,"hasNewJobWithHigherPriority() start",
+1);while(currentNode!==null){var nextNode=self._newPendingJobsLinkedList.getNextIterator(currentNode);var job=self._newPendingJobsLinkedList.getFromIterator(currentNode);var priority=self._prioritizer["getPriority"](job.jobContext);if(priority<0){extractJobFromLinkedList(self,currentNode);--self._pendingJobsCount;job.jobAbortedFunc(job.jobContext);currentNode=nextNode;continue}if(priority>lowPriority){log(self,"hasNewJobWithHigherPriority() end: returns true",-1);return true}currentNode=nextNode}log(self,
"hasNewJobWithHigherPriority() end: returns false",-1);return false}function tryDequeueNewJobWithHigherPriority(self,lowPriority){log(self,"tryDequeueNewJobWithHigherPriority() start",+1);var jobToScheduleNode=null;var highestPriorityFound=lowPriority;var countedPriorities=[];var currentNode=self._newPendingJobsLinkedList.getFirstIterator();while(currentNode!==null){var nextNode=self._newPendingJobsLinkedList.getNextIterator(currentNode);var job=self._newPendingJobsLinkedList.getFromIterator(currentNode);
var priority=self._prioritizer["getPriority"](job.jobContext);if(priority<0){extractJobFromLinkedList(self,currentNode);--self._pendingJobsCount;job.jobAbortedFunc(job.jobContext);currentNode=nextNode;continue}if(highestPriorityFound===undefined||priority>highestPriorityFound){highestPriorityFound=priority;jobToScheduleNode=currentNode}if(!self._showLog){currentNode=nextNode;continue}if(countedPriorities[priority]===undefined)countedPriorities[priority]=1;else++countedPriorities[priority];currentNode=
nextNode}var jobToSchedule=null;if(jobToScheduleNode!==null){jobToSchedule=extractJobFromLinkedList(self,jobToScheduleNode);--self._pendingJobsCount}if(self._showLog){var jobsListMessage="tryDequeueNewJobWithHigherPriority(): Jobs list:";for(var i=0;i<countedPriorities.length;++i)if(countedPriorities[i]!==undefined)jobsListMessage+=countedPriorities[i]+" jobs of priority "+i+";";log(self,jobsListMessage);if(jobToSchedule!==null)log(self,"tryDequeueNewJobWithHigherPriority(): dequeued new job of priority "+
highestPriorityFound)}ensurePendingJobsCount(self);log(self,"tryDequeueNewJobWithHigherPriority() end",-1);return jobToSchedule}function tryGetFreeResource(self){log(self,"tryGetFreeResource() start",+1);if(self._freeResourcesCount===0)return null;--self._freeResourcesCount;var resource=self._freeResources.pop();if(resource===undefined)resource=self._resourceCreator();ensurePendingJobsCount(self);log(self,"tryGetFreeResource() end",-1);return resource}function enqueueNewJob(self,job,priority){log(self,
"enqueueNewJob() start",+1);++self._pendingJobsCount;var firstIterator=self._newPendingJobsLinkedList.getFirstIterator();addJobToLinkedList(self,job,firstIterator);if(self._showLog)log(self,"enqueueNewJob(): enqueued job of priority "+priority);if(self._newPendingJobsLinkedList.getCount()<=self._numNewJobs){ensurePendingJobsCount(self);log(self,"enqueueNewJob() end: _newPendingJobsLinkedList is small enough",-1);return}var lastIterator=self._newPendingJobsLinkedList.getLastIterator();var oldJob=extractJobFromLinkedList(self,
lastIterator);enqueueOldJob(self,oldJob);ensurePendingJobsCount(self);log(self,"enqueueNewJob() end: One job moved from new job list to old job list",-1)}function enqueueOldJob(self,job){log(self,"enqueueOldJob() start",+1);var priority=self._prioritizer["getPriority"](job.jobContext);if(priority<0){--self._pendingJobsCount;job.jobAbortedFunc(job.jobContext);log(self,"enqueueOldJob() end: job aborted",-1);return}if(self._oldPendingJobsByPriority[priority]===undefined)self._oldPendingJobsByPriority[priority]=
[];self._oldPendingJobsByPriority[priority].push(job);log(self,"enqueueOldJob() end: job enqueued to old job list",-1)}function rerankPriorities(self){log(self,"rerankPriorities() start",+1);var originalOldsArray=self._oldPendingJobsByPriority;var originalNewsList=self._newPendingJobsLinkedList;if(originalOldsArray.length===0){log(self,"rerankPriorities() end: no need to rerank",-1);return}self._oldPendingJobsByPriority=[];self._newPendingJobsLinkedList=new LinkedList;for(var i=0;i<originalOldsArray.length;++i){if(originalOldsArray[i]===
undefined)continue;for(var j=0;j<originalOldsArray[i].length;++j)enqueueOldJob(self,originalOldsArray[i][j])}var iterator=originalNewsList.getFirstIterator();while(iterator!==null){var value=originalNewsList.getFromIterator(iterator);enqueueOldJob(self,value);iterator=originalNewsList.getNextIterator(iterator)}var message="rerankPriorities(): ";for(var i=self._oldPendingJobsByPriority.length-1;i>=0;--i){var highPriorityJobs=self._oldPendingJobsByPriority[i];if(highPriorityJobs===undefined)continue;
if(self._showLog)message+=highPriorityJobs.length+" jobs in priority "+i+";";while(highPriorityJobs.length>0&&self._newPendingJobsLinkedList.getCount()<self._numNewJobs){var job=highPriorityJobs.pop();addJobToLinkedList(self,job)}if(self._newPendingJobsLinkedList.getCount()>=self._numNewJobs&&!self._showLog)break}if(self._showLog)log(self,message);ensurePendingJobsCount(self);log(self,"rerankPriorities() end: rerank done",-1)}function resourceFreed(self,resource){log(self,"resourceFreed() start",
+1);++self._freeResourcesCount;var minPriority=getMinimalPriorityToSchedule(self);--self._freeResourcesCount;var job=tryDequeueNewJobWithHigherPriority(self,minPriority);if(job!==null){ensurePendingJobsCount(self);schedule(self,job,resource);ensurePendingJobsCount(self);log(self,"resourceFreed() end: new job scheduled",-1);return}var hasOldJobs=self._pendingJobsCount>self._newPendingJobsLinkedList.getCount();if(!hasOldJobs){self._freeResources.push(resource);++self._freeResourcesCount;ensurePendingJobsCount(self);
log(self,"resourceFreed() end: no job to schedule",-1);return}var numPriorities=self._oldPendingJobsByPriority.length;var jobPriority;for(var priority=numPriorities-1;priority>=0;--priority){var jobs=self._oldPendingJobsByPriority[priority];if(jobs===undefined||jobs.length===0)continue;for(var i=jobs.length-1;i>=0;--i){job=jobs[i];jobPriority=self._prioritizer["getPriority"](job.jobContext);if(jobPriority>=priority){jobs.length=i;break}else if(jobPriority<0){--self._pendingJobsCount;job.jobAbortedFunc(job.jobContext)}else{if(self._oldPendingJobsByPriority[jobPriority]===
undefined)self._oldPendingJobsByPriority[jobPriority]=[];self._oldPendingJobsByPriority[jobPriority].push(job)}job=null}if(job!==null)break;jobs.length=0}if(job===null){self._freeResources.push(resource);++self._freeResourcesCount;ensurePendingJobsCount(self);log(self,"resourceFreed() end: no non-aborted job to schedule",-1);return}if(self._showLog)log(self,"resourceFreed(): dequeued old job of priority "+jobPriority);--self._pendingJobsCount;ensurePendingJobsCount(self);schedule(self,job,resource);
ensurePendingJobsCount(self);log(self,"resourceFreed() end: job scheduled",-1)}function schedule(self,job,resource){log(self,"schedule() start",+1);++self._schedulesCounter;if(self._schedulesCounter>=self._numJobsBeforeRerankOldPriorities){self._schedulesCounter=0;rerankPriorities(self)}if(self._showLog){var priority=self._prioritizer["getPriority"](job.jobContext);log(self,"schedule(): scheduled job of priority "+priority)}var callbacks=new PrioritySchedulerCallbacks(self,resource,job.jobContext);
job.jobFunc(resource,job.jobContext,callbacks);log(self,"schedule() end",-1)}function addJobToLinkedList(self,job,addBefore){log(self,"addJobToLinkedList() start",+1);self._newPendingJobsLinkedList.add(job,addBefore);ensureNumberOfNodes(self);log(self,"addJobToLinkedList() end",-1)}function extractJobFromLinkedList(self,iterator){log(self,"extractJobFromLinkedList() start",+1);var value=self._newPendingJobsLinkedList.getFromIterator(iterator);self._newPendingJobsLinkedList.remove(iterator);ensureNumberOfNodes(self);
log(self,"extractJobFromLinkedList() end",-1);return value}function ensureNumberOfNodes(self){if(!self._showLog)return;log(self,"ensureNumberOfNodes() start",+1);var iterator=self._newPendingJobsLinkedList.getFirstIterator();var expectedCount=0;while(iterator!==null){++expectedCount;iterator=self._newPendingJobsLinkedList.getNextIterator(iterator)}if(expectedCount!==self._newPendingJobsLinkedList.getCount())throw"Unexpected count of new jobs";log(self,"ensureNumberOfNodes() end",-1)}function ensurePendingJobsCount(self){if(!self._showLog)return;
log(self,"ensurePendingJobsCount() start",+1);var oldJobsCount=0;for(var i=0;i<self._oldPendingJobsByPriority.length;++i){var jobs=self._oldPendingJobsByPriority[i];if(jobs!==undefined)oldJobsCount+=jobs.length}var expectedCount=oldJobsCount+self._newPendingJobsLinkedList.getCount();if(expectedCount!==self._pendingJobsCount)throw"Unexpected count of jobs";log(self,"ensurePendingJobsCount() end",-1)}function getMinimalPriorityToSchedule(self){log(self,"getMinimalPriorityToSchedule() start",+1);if(self._freeResourcesCount<=
self._resourcesGuaranteedForHighPriority){log(self,"getMinimalPriorityToSchedule() end: guarantee resource for high priority is needed",-1);return self._highPriorityToGuaranteeResources}log(self,"getMinimalPriorityToSchedule() end: enough resources, no need to guarantee resource for high priority",-1);return 0}function log(self,msg,addIndent){if(!self._showLog)return;if(addIndent===-1)self._logCallIndentPrefix=self._logCallIndentPrefix.substr(1);if(self._schedulerName!==undefined)console.log(self._logCallIndentPrefix+
"PriorityScheduler "+self._schedulerName+": "+msg);else console.log(self._logCallIndentPrefix+"PriorityScheduler: "+msg);if(addIndent===1)self._logCallIndentPrefix+=">"}function PrioritySchedulerCallbacks(scheduler,resource,context){this._isValid=true;this._scheduler=scheduler;this._resource=resource;this._context=context}PrioritySchedulerCallbacks.prototype._checkValidity=function checkValidity(){if(!this._isValid)throw"ResourceScheduler error: Already terminated job";};PrioritySchedulerCallbacks.prototype._clearValidity=
function(){this._isValid=false;this._resource=null;this._context=null;this._scheduler=null};PrioritySchedulerCallbacks.prototype["jobDone"]=function jobDone(){this._checkValidity();jobDoneInternal(this._scheduler,this._resource,this._context);this._clearValidity()};PrioritySchedulerCallbacks.prototype["shouldYieldOrAbort"]=function(){this._checkValidity();return shouldYieldOrAbortInternal(this._scheduler,this._context)};PrioritySchedulerCallbacks.prototype["tryYield"]=function tryYield(jobContinueFunc,
jobAbortedFunc,jobYieldedFunc){this._checkValidity();var isYielded=tryYieldInternal(this._scheduler,jobContinueFunc,this._context,jobAbortedFunc,jobYieldedFunc,this._resource);if(isYielded)this._clearValidity();return isYielded};return PriorityScheduler}();self["ResourceScheduler"]={};self["ResourceScheduler"]["PriorityScheduler"]=PriorityScheduler;self["ResourceScheduler"]["LifoScheduler"]=LifoScheduler;PriorityScheduler.prototype["enqueueJob"]=PriorityScheduler.prototype.enqueueJob;LifoScheduler.prototype["enqueueJob"]=LifoScheduler.prototype.enqueueJob;

(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.imageDecoderFramework = f()}})(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
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
    if (frustumRectangle.east < frustumRectangle.west || frustumRectangle.north < frustumRectangle.south) {
        frustumRectangle = {
            east: Math.max(frustumRectangle.east, frustumRectangle.west),
            west: Math.min(frustumRectangle.east, frustumRectangle.west),
            north: Math.max(frustumRectangle.north, frustumRectangle.south),
            south: Math.min(frustumRectangle.north, frustumRectangle.south)
        };
    }

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
},{"imagehelperfunctions.js":12}],2:[function(require,module,exports){
'use strict';

module.exports = CesiumImageDecoderLayerManager;

var CanvasImageryProvider = require('canvasimageryprovider.js');
var ViewerImageDecoder = require('viewerimagedecoder.js');
var calculateCesiumFrustum = require('_cesiumfrustumcalculator.js');

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
    this._imageryProviders = [
        new CanvasImageryProvider(this._targetCanvas),
        new CanvasImageryProvider(this._targetCanvas)
    ];
    this._imageryLayerShown = new Cesium.ImageryLayer(this._imageryProviders[0]);
    this._imageryLayerPending = new Cesium.ImageryLayer(this._imageryProviders[1]);

    this._canvasUpdatedCallbackBound = this._canvasUpdatedCallback.bind(this);
    
    this._isPendingUpdateCallback = false;
    this._isWhileReplaceLayerShown = false;
    this._pendingPositionRectangle = null;
    
    this._image = new ViewerImageDecoder(
        imageImplementationClassName,
        this._canvasUpdatedCallbackBound,
        this._options);
    
    this._image.setTargetCanvas(this._targetCanvas);
    
    this._updateFrustumBound = this._updateFrustum.bind(this);
    this._postRenderBound = this._postRender.bind(this);
}

CesiumImageDecoderLayerManager.prototype.setExceptionCallback = function setExceptionCallback(exceptionCallback) {
    this._image.setExceptionCallback(exceptionCallback);
};

CesiumImageDecoderLayerManager.prototype.open = function open(widgetOrViewer) {
    this._widget = widgetOrViewer;
    this._layers = widgetOrViewer.scene.imageryLayers;
    widgetOrViewer.scene.postRender.addEventListener(this._postRenderBound);
    
    this._image.open(this._url);
    this._layers.add(this._imageryLayerShown);
    
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

    this._layers.remove(this._imageryLayerShown);
    this._widget.removeEventListener(this._postRenderBound);
    if (this._isWhileReplaceLayerShown) {
        this._isWhileReplaceLayerShown = false;
        this._isPendingUpdateCallback = false;
        this._layers.remove(this._imageryLayerPending);
    }
};

CesiumImageDecoderLayerManager.prototype.getImageryLayers = function getImageryLayers() {
    return [this._imageryLayerShown, this._imageryLayerPending];
};

CesiumImageDecoderLayerManager.prototype._updateFrustum = function updateFrustum() {
    var frustum = calculateCesiumFrustum(this._widget);
    if (frustum !== null) {
        this._image.updateViewArea(frustum);
    }
};

CesiumImageDecoderLayerManager.prototype._canvasUpdatedCallback = function canvasUpdatedCallback(newPosition) {
    if (this._isWhileReplaceLayerShown) {
        this._isPendingUpdateCallback = true;
        this._pendingPositionRectangle = newPosition;
    }
    
    if (newPosition !== null) {
        var rectangle = new Cesium.Rectangle(
            newPosition.west,
            newPosition.south,
            newPosition.east,
            newPosition.north);
        
        this._imageryProviders[0].setRectangle(rectangle);
        this._imageryProviders[1].setRectangle(rectangle);
    }
    
    this._removeAndReAddLayer();
};

CesiumImageDecoderLayerManager.prototype._removeAndReAddLayer = function removeAndReAddLayer() {
    var index = this._layers.indexOf(this._imageryLayerShown);
    
    if (index < 0) {
        throw 'Layer was removed from viewer\'s layers  without ' +
            'closing layer manager. Use CesiumImageDecoderLayerManager.' +
            'close() instead';
    }
    
    this._isWhileReplaceLayerShown = true;
    this._layers.add(this._imageryLayerPending, index);
};

CesiumImageDecoderLayerManager.prototype._postRender = function postRender() {
    if (!this._isWhileReplaceLayerShown)
        return;
    
    this._isWhileReplaceLayerShown = false;
    this._layers.remove(this._imageryLayerShown, /*destroy=*/false);
    
    var swap = this._imageryLayerShown;
    this._imageryLayerShown = this._imageryLayerPending;
    this._imageryLayerPending = swap;
    
    if (this._isPendingUpdateCallback) {
        this._isPendingUpdateCallback = false;
        this._canvasUpdatedCallback(this._pendingPositionRectangle);
    }
};
},{"_cesiumfrustumcalculator.js":1,"canvasimageryprovider.js":3,"viewerimagedecoder.js":19}],3:[function(require,module,exports){
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
},{}],4:[function(require,module,exports){
'use strict';

module.exports = ImageDecoderImageryProvider;

var WorkerProxyImageDecoder = require('workerproxyimagedecoder.js');
var calculateCesiumFrustum = require('_cesiumfrustumcalculator.js');
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
function ImageDecoderImageryProvider(decoder, options) {
    var url = options.url;
    this._adaptProportions = options.adaptProportions;
    this._rectangle = options.rectangle;
    this._proxy = options.proxy;
    this._updateFrustumInterval = 1000 || options.updateFrustumInterval;
    this._credit = options.credit;
    
    if (typeof this._credit === 'string') {
        this._credit = new Credit(this._credit);
    }
    
    if (this._rectangle === undefined) {
        this._rectangle = Cesium.Rectangle.fromDegrees(-180, -90, 180, 90);
    }
    
    if (this._adaptProportions === undefined) {
        this._adaptProportions = true;
    }

    options = JSON.parse(JSON.stringify(options || {}));
    options.cartographicBounds = {
        west: this._rectangle.west,
        east: this._rectangle.east,
        south: this._rectangle.south,
        north: this._rectangle.north
    };
    
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
    this._exceptionCallback = null;
    this._cesiumWidget = null;
    this._updateFrustumIntervalHandle = null;
    

    var imageUrl = url;
    if (this._proxy !== undefined) {
        // NOTE: Is that the correct logic?
        imageUrl = this._proxy.getURL(imageUrl);
    }
    
    this._decoder = decoder;
	this._image = decoder.getImage();

    /*
    this._decoder = new WorkerProxyImageDecoder(imageImplementationClassName, {
        serverRequestPrioritizer: 'frustum',
        decodePrioritizer: 'frustum'
    });*/

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
    
    this._decoder.open(this._url)
		.then(this._opened.bind(this))
		.catch(this._onException.bind(this));
    
    this._cesiumWidget = widgetOrViewer;
    
    this._updateFrustumIntervalHandle = setInterval(
        this._setPriorityByFrustum.bind(this),
        this._updateFrustumInterval);
};

ImageDecoderImageryProvider.prototype.close = function close() {
    clearInterval(this._updateFrustumIntervalHandle);
    this._decoder.close();
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
ImageDecoderImageryProvider.prototype.requestImage = function(x, y, cesiumLevel) {
    //>>includeStart('debug', pragmas.debug);
    if (!this._ready) {
        throw new DeveloperError('requestImage must not be called before the imagery provider is ready.');
    }
    //>>includeEnd('debug');
    
    var self = this;
    
    var levelFactor = Math.pow(2, this._numResolutionLevels - cesiumLevel - 1);
    var minX = x * this._tileWidth  * levelFactor;
    var minY = y * this._tileHeight * levelFactor;
    var maxXExclusive = (x + 1) * this._tileWidth  * levelFactor;
    var maxYExclusive = (y + 1) * this._tileHeight * levelFactor;
    
    var level = alignedParams.imagePartParams.level;
    var levelWidth  = this._image.getLevelWidth(level);
    var levelHeight = this._image.getLevelHeight(level);
    
    var alignedParams = imageHelperFunctions.alignParamsToTilesAndLevel({
        minX: minX,
        minY: minY,
        maxXExclusive: maxXExclusive,
        maxYExclusive: maxYExclusive,
        levelWidth: levelWidth,
        levelHeight: levelHeight,
        screenWidth: this._tileWidth,
        screenHeight: this._tileHeight
    }, this._decoder, this._image);
    
    var scaledCanvas = document.createElement('canvas');
    scaledCanvas.width = this._tileWidth;
    scaledCanvas.height = this._tileHeight;
    
    var scaledContext = scaledCanvas.getContext('2d');
    scaledContext.clearRect(0, 0, this._tileWidth, this._tileHeight);
    
    var tempPixelWidth  = alignedParams.imagePartParams.maxXExclusive - alignedParams.imagePartParams.minX;
    var tempPixelHeight = alignedParams.imagePartParams.maxYExclusive - alignedParams.imagePartParams.minY;
    if (tempPixelWidth <= 0 || tempPixelHeight <= 0) {
        return scaledCanvas;
    }
    
    var tempCanvas = document.createElement('canvas');
    tempCanvas.width = tempPixelWidth;
    tempCanvas.height = tempPixelHeight;
    var tempContext = tempCanvas.getContext('2d');
    tempContext.clearRect(0, 0, tempPixelWidth, tempPixelHeight);
    
    alignedParams.imagePartParams.quality = this._quality;
    alignedParams.imagePartParams.requestPriorityData = {
        imageRectangle: this._rectangle
    };
    
    var resolve, reject;
    var requestPixelsPromise = new Promise(function(resolve_, reject_) {
        resolve = resolve_;
        reject = reject_;
        
        self._decoder.requestPixelsProgressive(
            alignedParams.imagePartParams,
            pixelsDecodedCallback,
            terminatedCallback);
    });
    
    function pixelsDecodedCallback(decoded) {
        var partialTileWidth = decoded.imageData.width;
        var partialTileHeight = decoded.imageData.height;

        if (partialTileWidth > 0 && partialTileHeight > 0) {
            tempContext.putImageData(
                decoded.imageData,
                decoded.xInOriginalRequest,
                decoded.yInOriginalRequest);
        }
    }

    function terminatedCallback(isAborted) {
        if (isAborted) {
            reject('Fetch request or decode aborted');
        } else {
            scaledContext.drawImage(
                tempCanvas,
                0, 0, tempPixelWidth, tempPixelHeight,
                alignedParams.croppedScreen.minX, alignedParams.croppedScreen.minY,
                alignedParams.croppedScreen.maxXExclusive, alignedParams.croppedScreen.maxYExclusive);
                
            resolve(scaledCanvas);
        }
    }

    return requestPixelsPromise;
};

ImageDecoderImageryProvider.prototype._setPriorityByFrustum =
    function setPriorityByFrustum() {
    
    if (!this._ready) {
        return;
    }
    
    var frustumData = calculateCesiumFrustum(
        this._cesiumWidget, this);
    
    if (frustumData === null) {
        return;
    }
    
    frustumData.imageRectangle = this.getRectangle();
    frustumData.exactlevel = null;

    this._decoder.setServerRequestPrioritizerData(frustumData);
    this._decoder.setDecodePrioritizerData(frustumData);
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

ImageDecoderImageryProvider.prototype._onException = function onException(reason) {
    if (this._exceptionCallback !== null) {
		this._exceptionCallback(reason);
    }
};

ImageDecoderImageryProvider.prototype._opened = function opened() {
    if (this._ready) {
        throw 'ImageDecoderImageryProvider error: opened() was called more than once!';
    }
    
    this._ready = true;

    // This is wrong if COD or COC exists besides main header COD
    this._numResolutionLevels = this._decoder.getNumResolutionLevelsForLimittedViewer();
    this._quality = this._decoder.getHighestQuality();
    var maximumCesiumLevel = this._numResolutionLevels - 1;
        
    this._tileWidth = this._decoder.getTileWidth();
    this._tileHeight = this._decoder.getTileHeight();
        
    var bestLevel = this._decoder.getImageLevel();
    var bestLevelWidth  = this._decoder.getImageWidth ();
    var bestLevelHeight = this._decoder.getImageHeight();
    
    var lowestLevelTilesX = Math.ceil(bestLevelWidth  / this._tileWidth ) >> maximumCesiumLevel;
    var lowestLevelTilesY = Math.ceil(bestLevelHeight / this._tileHeight) >> maximumCesiumLevel;

    imageHelperFunctions.fixBounds(
        this._rectangle,
        this._decoder,
        this._adaptProportions);
    var rectangleWidth  = this._rectangle.east  - this._rectangle.west;
    var rectangleHeight = this._rectangle.north - this._rectangle.south;
    
    var bestLevelScale = 1 << maximumCesiumLevel;
    var pixelsWidthForCesium  = this._tileWidth  * lowestLevelTilesX * bestLevelScale;
    var pixelsHeightForCesium = this._tileHeight * lowestLevelTilesY * bestLevelScale;
    
    // Cesium works with full tiles only, thus fix the geographic bounds so
    // the pixels lies exactly on the original bounds
    
    var geographicWidthForCesium =
        rectangleWidth * pixelsWidthForCesium / bestLevelWidth;
    var geographicHeightForCesium =
        rectangleHeight * pixelsHeightForCesium / bestLevelHeight;
    
    var fixedEast  = this._rectangle.west  + geographicWidthForCesium;
    var fixedSouth = this._rectangle.north - geographicHeightForCesium;
    
    this._tilingSchemeParams = {
        west: this._rectangle.west,
        east: fixedEast,
        south: fixedSouth,
        north: this._rectangle.north,
        levelZeroTilesX: lowestLevelTilesX,
        levelZeroTilesY: lowestLevelTilesY,
        maximumLevel: maximumCesiumLevel
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
},{"_cesiumfrustumcalculator.js":1,"imagehelperfunctions.js":12,"workerproxyimagedecoder.js":18}],5:[function(require,module,exports){
'use strict';

module.exports = ImageDecoder;

var imageHelperFunctions = require('imageHelperFunctions.js');
var DecodeJobsPool = require('decodejobspool.js');
var ImageParamsRetrieverProxy = require('imageparamsretrieverproxy.js');
var setDecoderSlaveSideCreator = require('setdecoderslavesidecreator.js');

/* global console: false */
/* global Promise: false */

ImageDecoder.alignParamsToTilesAndLevel = imageHelperFunctions.alignParamsToTilesAndLevel;

function ImageDecoder(image, options) {
    ImageParamsRetrieverProxy.call(this);
    
    this._options = options || {};
    //var decodeWorkersLimit = this._options.workersLimit || 5;
    
    this._tileWidth = this._options.tileWidth || 256;
    this._tileHeight = this._options.tileHeight || 256;
    this._showLog = !!this._options.showLog;
    this._fetchManager = null;
    this._decodeDependencyWorkers = null;
    this._requestsDecodeJobsPool = null;
    this._channelsDecodeJobsPool = null;
	this._fetchRequestId = 0;
    
    /*if (this._showLog) {
        // Old IE
        throw 'showLog is not supported on this browser';
    }*/

    this._channelStates = [];
    this._decoders = [];

    /* TODO
    var decodeScheduler = imageHelperFunctions.createScheduler(
        this._showLog,
        this._options.decodePrioritizer,
        'decode',
        function createResource() {
            return {};
        },
        decodeWorkersLimit);
    */
    
    //this._decodePrioritizer = decodeScheduler.prioritizer;
    
    this._image = image;
    if (!this._image.getFetchManager) {
        throw 'Image.getFetchManager() is not implemented by image ctor argument!';
    }
    if (!this._image.getDecoderWorkers) {
        throw 'Image.getDecoderWorkers() is not implemented by image ctor argument';
    }
}

ImageDecoder.prototype = Object.create(ImageParamsRetrieverProxy.prototype);

ImageDecoder.prototype.getTileWidth = function getTileWidth() {
    return this._tileWidth;
};

ImageDecoder.prototype.getTileHeight = function getTileHeight() {
    return this._tileHeight;
};
    
ImageDecoder.prototype.setServerRequestPrioritizerData =
    function setServerRequestPrioritizerData(prioritizerData) {

    this._validateFetcher();
    
    // TODO
    //this._fetchManager.setServerRequestPrioritizerData(
    //    prioritizerData);
};

ImageDecoder.prototype.setDecodePrioritizerData =
    function setDecodePrioritizerData(prioritizerData) {

    this._validateDecoder();
    
    // TODO
    if (!ImageDecoder.undefinedVar) { // Avoid unreachable warning
        return;
    }
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
    this._validateFetcher();
    
    var self = this;
    var promise = this._fetchManager.open(url);
    return promise.then(function (sizesParams) {
        self._internalSizesParams = sizesParams;
        return {
            sizesParams: sizesParams,
            applicativeTileWidth : self.getTileWidth(),
            applicativeTileHeight: self.getTileHeight()
        };
    });
};

ImageDecoder.prototype.close = function close() {
    this._validateFetcher();
    this._validateDecoder();
    
    for (var i = 0; i < this._decoders.length; ++i) {
        this._decoders[i].terminate();
    }

    return this._fetchManager.close();
};

ImageDecoder.prototype.createChannel = function createChannel() {
    this._validateFetcher();
    this.getImageParams();
    
    var self = this;
    
    return this._fetchManager.createChannel().then(function(channelHandle) {
        self._channelStates[channelHandle] = {
            decodeJobsListenerHandle: null
        };
        
        return channelHandle;
    });
};

ImageDecoder.prototype.requestPixels = function requestPixels(imagePartParams) {
    this._validateDecoder();
    this.getImageParams();
    
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
            internalTerminatedCallback);
    }
    
    function internalCallback(decodedData) {
        self._copyPixelsToAccumulatedResult(decodedData, accumulatedResult);
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
    
    this._validateDecoder();
    this.getImageParams();
    
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
    }
    
    var listenerHandle = decodeJobsPool.forkDecodeJobs(
        imagePartParams,
        callback,
        terminatedCallback,
        imagePartParamsNotNeeded);
        
    if (channelHandle !== undefined) {
        if (channelState.decodeJobsListenerHandle !== null) {
            // Unregister after forked new jobs, so no termination occurs meanwhile
            decodeJobsPool.unregisterForkedJobs(
                channelState.decodeJobsListenerHandle);
        }
        channelState.decodeJobsListenerHandle = listenerHandle;
        this._fetchManager.moveChannel(channelHandle, imagePartParams);
    } else {
		this._fetchManager.createRequest(++this._fetchRequestId, imagePartParams);
	}
};

ImageDecoder.prototype.reconnect = function reconnect() {
    this._validateFetcher();
    
    this._fetchManager.reconnect();
};

ImageDecoder.prototype.getImage = function getImage() {
    return this._image;
};

// Internal Methods

ImageDecoder.prototype._validateFetcher = function validateFetcher() {
    if (this._fetchManager === null) {
        this._fetchManager = this._image.getFetchManager();
    }
};

ImageDecoder.prototype._validateDecoder = function validateComponents() {
    if (this._decodeDependencyWorkers !== null) {
        return;
    }
    
    this._decodeDependencyWorkers = this._image.getDecoderWorkers();
    
    this._requestsDecodeJobsPool = new DecodeJobsPool(
        this._decodeDependencyWorkers,
        this._tileWidth,
        this._tileHeight);
        
    this._channelsDecodeJobsPool = new DecodeJobsPool(
        this._decodeDependencyWorkers,
        this._tileWidth,
        this._tileHeight);
};

ImageDecoder.prototype._getImageParamsInternal = function getImageParamsInternal() {
    return this._internalSizesParams;
};

ImageDecoder.prototype._copyPixelsToAccumulatedResult =
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
};
},{"decodejobspool.js":7,"imageHelperFunctions.js":11,"imageparamsretrieverproxy.js":15,"setdecoderslavesidecreator.js":17}],6:[function(require,module,exports){
'use strict';

module.exports = DecodeJob;

var LinkedList = require('linkedlist.js');

var requestIdCounter = 0;

function DecodeJob(listenerHandle, imagePartParams) {
    this._isFirstStage = true;
    this._listenerHandle = listenerHandle;
    this._imagePartParams = imagePartParams;
    this._allRelevantBytesLoaded = 0;
    var requestParams = listenerHandle.imagePartParams;
    this._offsetX = imagePartParams.minX - requestParams.minX;
    this._offsetY = imagePartParams.minY - requestParams.minY;
    this._requestWidth = requestParams.maxXExclusive - requestParams.minX;
    this._requestHeight = requestParams.maxYExclusive - requestParams.minY;
}

DecodeJob.prototype.onData = function onData(decodeResult) {
    this._isFirstStage = false;

    var relevantBytesLoadedDiff =
        decodeResult.allRelevantBytesLoaded - this._allRelevantBytesLoaded;
    this._allRelevantBytesLoaded = decodeResult.allRelevantBytesLoaded;
    this._listenerHandle.allRelevantBytesLoaded += relevantBytesLoadedDiff;
    
    var decodedOffsetted = {
        originalRequestWidth: this._requestWidth,
        originalRequestHeight: this._requestHeight,
        xInOriginalRequest: this._offsetX,
        yInOriginalRequest: this._offsetY,
        
        imageData: decodeResult,
        
        allRelevantBytesLoaded: this._listenerHandle.allRelevantBytesLoaded
    };
    
    this._listenerHandle.callback(decodedOffsetted);
};

DecodeJob.prototype.onTerminated = function onTerminated() {
    //this._listenerHandle.isAnyDecoderAborted |= this._isAborted;
    
    var remaining = --this._listenerHandle.remainingDecodeJobs;
    if (remaining < 0) {
        throw 'Inconsistent number of done requests';
    }
    
    var isListenerDone = remaining === 0;
    if (isListenerDone) {
        this._listenerHandle.isTerminatedCallbackCalled = true;
        this._listenerHandle.terminatedCallback(
            this._listenerHandle.isAnyDecoderAborted);
    }
};
},{"linkedlist.js":13}],7:[function(require,module,exports){
'use strict';

module.exports = DecodeJobsPool;

var DecodeJob = require('decodejob.js');

function DecodeJobsPool(
    decodeDependencyWorkers,
    tileWidth,
    tileHeight) {
    
    this._tileWidth = tileWidth;
    this._tileHeight = tileHeight;
    
    this._decodeDependencyWorkers = decodeDependencyWorkers;
}

DecodeJobsPool.prototype.forkDecodeJobs = function forkDecodeJobs(
    imagePartParams,
    callback,
    terminatedCallback,
    imagePartParamsNotNeeded) {
    
    var minX = imagePartParams.minX;
    var minY = imagePartParams.minY;
    var maxX = imagePartParams.maxXExclusive;
    var maxY = imagePartParams.maxYExclusive;
    var level = imagePartParams.level || 0;
    var quality = imagePartParams.quality;
    var priorityData = imagePartParams.requestPriorityData;
                
    var isMinAligned =
        minX % this._tileWidth === 0 && minY % this._tileHeight === 0;
    var isMaxXAligned = maxX % this._tileWidth  === 0 || maxX === imagePartParams.levelWidth;
    var isMaxYAligned = maxY % this._tileHeight === 0 || maxY === imagePartParams.levelHeight;
    var isOrderValid = minX < maxX && minY < maxY;
    
    if (!isMinAligned || !isMaxXAligned || !isMaxYAligned || !isOrderValid) {
        throw 'imagePartParams for decoders is not aligned to ' +
            'tile size or not in valid order';
    }
    
    var numTilesX = Math.ceil((maxX - minX) / this._tileWidth);
    var numTilesY = Math.ceil((maxY - minY) / this._tileHeight);
    
    var listenerHandle = {
        imagePartParams: imagePartParams,
        callback: callback,
        terminatedCallback: terminatedCallback,
        remainingDecodeJobs: numTilesX * numTilesY,
        isAnyDecoderAborted: false,
        isTerminatedCallbackCalled: false,
        allRelevantBytesLoaded: 0,
        unregisterHandles: []
    };
    
    for (var x = minX; x < maxX; x += this._tileWidth) {
        var singleTileMaxX = Math.min(x + this._tileWidth, imagePartParams.levelWidth);
        
        for (var y = minY; y < maxY; y += this._tileHeight) {
            var singleTileMaxY = Math.min(y + this._tileHeight, imagePartParams.levelHeight);
            
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
            
            var singleTileImagePartParams = {
                minX: x,
                minY: y,
                maxXExclusive: singleTileMaxX,
                maxYExclusive: singleTileMaxY,
                levelWidth: imagePartParams.levelWidth,
                levelHeight: imagePartParams.levelHeight,
                level: level,
                quality: quality,
                requestPriorityData: priorityData
            };

            var decodeJob = new DecodeJob(
                listenerHandle,
                singleTileImagePartParams);

            var taskHandle =
                this._decodeDependencyWorkers.startTask(
                    singleTileImagePartParams, decodeJob);
            
            listenerHandle.unregisterHandles.push(taskHandle);
        }
    }
    
    if (!listenerHandle.isTerminatedCallbackCalled &&
        listenerHandle.remainingDecodeJobs === 0) {
        
        listenerHandle.isTerminatedCallbackCalled = true;
        listenerHandle.terminatedCallback(listenerHandle.isAnyDecoderAborted);
    }
    
    return listenerHandle;
};

DecodeJobsPool.prototype.unregisterForkedJobs = function unregisterForkedJobs(
    listenerHandle) {
            
    if (listenerHandle.remainingDecodeJobs === 0) {
        // All jobs has already been terminated, no need to unregister
        return;
    }
    
    for (var i = 0; i < listenerHandle.unregisterHandles.length; ++i) {
        listenerHandle.unregisterHandles[i].unregister();
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
},{"decodejob.js":6}],8:[function(require,module,exports){
'use strict';

module.exports = FetchJob;

FetchJob.FETCH_TYPE_REQUEST = 1;
FetchJob.FETCH_TYPE_CHANNEL = 2; // movable
FetchJob.FETCH_TYPE_ONLY_WAIT_FOR_DATA = 3;

FetchJob.FETCH_STATUS_WAIT_FOR_FETCH_CALL = 1;
FetchJob.FETCH_STATUS_REQUEST_WAIT_FOR_SCHEDULE = 2;
FetchJob.FETCH_STATUS_ACTIVE = 3;
FetchJob.FETCH_STATUS_REQUEST_ABOUT_TO_YIELD = 4;
FetchJob.FETCH_STATUS_REQUEST_YIELDED = 6;
FetchJob.FETCH_STATUS_REQUEST_ABOUT_TO_ABORT = 8;
FetchJob.FETCH_STATUS_REQUEST_TERMINATED = 9;
FetchJob.FETCH_STATUS_UNEXPECTED_FAILURE = 10;

function FetchJob(fetcher, scheduler, scheduledJobsList, fetchType, contextVars) {
    this._fetcher = fetcher;
    this._scheduler = scheduler;
    this._scheduledJobsList = scheduledJobsList;
    this._scheduledJobsListIterator = null;
    
    this._terminatedListeners = [];
    
    this._imagePartParams = null;
    
    this._state = FetchJob.FETCH_STATUS_WAIT_FOR_FETCH_CALL;
    this._isChannel = fetchType === FetchJob.FETCH_TYPE_CHANNEL;
    this._contextVars = contextVars;
    this._isOnlyWaitForData = fetchType === FetchJob.FETCH_TYPE_ONLY_WAIT_FOR_DATA;
    this._useScheduler = fetchType === FetchJob.FETCH_TYPE_REQUEST;
    this._resource = null;
    this._fetchHandle = null;
    this._fetchTerminatedBound = this._fetchTerminated.bind(this);
    //this._alreadyTerminatedWhenAllDataArrived = false;
    
    if (fetchType === FetchJob.FETCH_TYPE_CHANNEL) {
        this._movableFetchState = {};
    } else {
        this._movableFetchState = null;
    }
}

FetchJob.prototype.fetch = function fetch(imagePartParams) {
    if (this._isChannel) {
        this._imagePartParams = imagePartParams;
        this._startFetch();
        return;
    }
    
    if (this._imagePartParams !== null) {
        throw 'Cannot fetch twice on fetch type of "request"';
    }
    
    if (this._state !== FetchJob.FETCH_STATUS_WAIT_FOR_FETCH_CALL) {
        this._state = FetchJob.FETCH_STATUS_UNEXPECTED_FAILURE;
        throw 'Unexpected state on fetch(): ' + this._state;
    }

    this._imagePartParams = imagePartParams;
    this._state = FetchJob.FETCH_STATUS_REQUEST_WAIT_FOR_SCHEDULE;
    
    if (!this._useScheduler) {
        startRequest(/*resource=*/null, this);
        return;
    }
    
    this._scheduler.enqueueJob(startRequest, this, fetchAbortedByScheduler);
};

FetchJob.prototype.manualAbortRequest = function manualAbortRequest() {
    switch (this._state) {
        case FetchJob.FETCH_STATUS_REQUEST_TERMINATED:
        case FetchJob.FETCH_STATUS_UNEXPECTED_FAILURE:
            return;
        case FetchJob.FETCH_STATUS_REQUEST_ABOUT_TO_ABORT:
            throw 'Double call to manualAbortRequest()';
        case FetchJob.FETCH_STATUS_ACTIVE:
            var self = this;
            this._state = FetchJob.FETCH_STATUS_REQUEST_ABOUT_TO_ABORT;
            if (self._isOnlyWaitForData) {
                self._fetchTerminated(/*isAborted=*/true);
            } else {
                this._fetchHandle.stopAsync().then(function() {
                    self._fetchTerminated(/*isAborted=*/true);
                });
            }
            break;
        case FetchJob.FETCH_STATUS_WAIT_FOR_FETCH_CALL:
            this._state = FetchJob.FETCH_STATUS_REQUEST_TERMINATED;
            return;
        case FetchJob.FETCH_STATUS_REQUEST_WAIT_FOR_SCHEDULE:
        case FetchJob.FETCH_STATUS_REQUEST_ABOUT_TO_YIELD:
        case FetchJob.FETCH_STATUS_REQUEST_YIELDED:
            this._state = FetchJob.FETCH_STATUS_REQUEST_ABOUT_TO_ABORT;
            break;
        default:
            throw 'Unknown state in manualAbortRequest() implementation: ' + this._state;
    }
};

FetchJob.prototype.getContextVars = function getContextVars(requestId) {
    return this._contextVars;
};

FetchJob.prototype.on = function on(event, listener) {
    switch (event) {
        case 'terminated':
            this._terminatedListeners.push(listener);
            break;
        default:
            throw 'Unexpected event ' + event;
    }
};

FetchJob.prototype.setIsProgressive = function setIsProgressive(isProgressive) {
    this._isProgressive = isProgressive;
    if (this._fetchHandle !== null) {
        this._fetchHandle.setIsProgressive(isProgressive);
    }
};

FetchJob.prototype.getIsProgressive = function getIsProgressive() {
    return this._isProgressive;
};

FetchJob.prototype._startFetch = function startFetch() {
    var prevState = this._state;
    this._state = FetchJob.FETCH_STATUS_ACTIVE;
    
    if (this._isOnlyWaitForData) {
        this._fetchHandle = this._extractAlreadyFetchedData();
    } else if (!this._isChannel) {
        this._fetchHandle = this._fetcher.fetch(this._imagePartParams);
    } else if (prevState !== FetchJob.FETCH_STATUS_WAIT_FOR_FETCH_CALL) {
        this._fetchHandle = this._fetcher.moveFetch(
            this._imagePartParams, this._movableFetchState);
    } else {
        this._fetchHandle = this._fetcher.startMovableFetch(
            this._imagePartParams, this._movableFetchState);
    }
    this._fetchHandle.on('terminated', this._fetchTerminatedBound);
    this._fetchHandle.setIsProgressive(this._isProgressive);
};

FetchJob.prototype._fetchTerminated = function fetchTerminated(isAborted) {
    switch (this._state) {
        case FetchJob.FETCH_STATUS_REQUEST_ABOUT_TO_ABORT:
            break;
        case FetchJob.FETCH_STATUS_ACTIVE:
        case FetchJob.FETCH_STATUS_REQUEST_ABOUT_TO_YIELD:
            if (isAborted) {
                this._state = FetchJob.FETCH_STATUS_UNEXPECTED_FAILURE;
                throw 'Unexpected abort when fetch is active';
            }
            break;
        default:
            throw 'Unexpected state on fetch terminated: ' + this._state;
    }
    
    if (this._resource !== null) {
        if (isAborted) {
            throw 'Unexpected request termination without resource allocated';
        }

        this._scheduledJobsList.remove(this._scheduledJobsListIterator);
        this._schedulerCallbacks.jobDone();

        this._resource = null;
    } else if (!isAborted && this._useScheduler) {
        throw 'Job expected to have resource on successful termination';
    }
    
    // Channel is not really terminated, but only fetches a new region
    // (see moveChannel()).
    if (this._isChannel) {
		return;
	}
	
	this._state = FetchJob.FETCH_STATUS_REQUEST_TERMINATED;
	
	for (var i = 0; i < this._terminatedListeners.length; ++i) {
		this._terminatedListeners[i](this._contextVars, isAborted);
	}
    
    if (this._fetchHandle !== null &&
        this._state !== FetchJob.FETCH_STATUS_UNEXPECTED_FAILURE) {
            
        this._fetchHandle.dispose();
        this._fetchHandle = null;
    }
};

FetchJob.prototype.checkIfShouldYield = function checkIfShouldYield() {
    try {
        if (!this._useScheduler || this._state === FetchJob.FETCH_STATUS_REQUEST_TERMINATED) {
            return;
        }
        
        if (this._resource === null) {
            throw 'No resource allocated but fetch callback called';
        }
            
        if (!this._schedulerCallbacks.shouldYieldOrAbort()) {
            return;
        }
        
        this._state = FetchJob.FETCH_STATUS_REQUEST_ABOUT_TO_YIELD;
        var self = this;
        this._fetchHandle.stopAsync().then(function() {
            if (self._fetchState === FetchJob.FETCH_STATUS_REQUEST_ABOUT_TO_ABORT) {
                self._fetchTerminated(/*isAborted=*/true);
                return;
            }
            
            var isYielded = self._schedulerCallbacks.tryYield(
                continueYieldedRequest,
                fetchAbortedByScheduler,
                fetchYieldedByScheduler);
            
            if (!isYielded) {
                if (self._state !== FetchJob.FETCH_STATUS_REQUEST_ABOUT_TO_YIELD) {
                    throw 'Unexpected state on tryYield() false: ' + self._state;
                }
                self._state = FetchJob.FETCH_STATUS_ACTIVE;
                self._fetchHandle.resume();
            }
        }).catch(function() {
            self._state = FetchJob.FETCH_STATUS_UNEXPECTED_FAILURE;
            fetchAbortedByScheduler(self);
        });
    } catch (e) {
        this._state = FetchJob.FETCH_STATUS_UNEXPECTED_FAILURE;
        fetchAbortedByScheduler(this);
    }
};

// Properties for FrustumRequesetPrioritizer

Object.defineProperty(FetchJob.prototype, 'imagePartParams', {
    get: function getImagePartParams() {
        return this._imagePartParams;
    }
});

function startRequest(resource, self, callbacks) {
    if (self._fetchHandle !== null || self._resource !== null) {
        throw 'Unexpected restart of already started request';
    }
    
    if (self._state === FetchJob.FETCH_STATUS_REQUEST_ABOUT_TO_ABORT) {
        self._fetchTerminated(/*isAborted=*/true);
        return;
    } else if (self._state !== FetchJob.FETCH_STATUS_REQUEST_WAIT_FOR_SCHEDULE) {
        throw 'Unexpected state on schedule: ' + self._state;
    }
    
    self._resource = resource;
	self._schedulerCallbacks = callbacks;

    if (resource !== null) {
        self._scheduledJobsListIterator = self._scheduledJobsList.add(self);
    }
    
    self._startFetch();
}

function continueYieldedRequest(resource, self) {
    if (self.isChannel) {
        throw 'Unexpected call to continueYieldedRequest on channel';
    }

    if (self._state === FetchJob.FETCH_STATUS_REQUEST_ABOUT_TO_ABORT ||
        self._state === FetchJob.FETCH_STATUS_UNEXPECTED_FAILURE) {
        
        self._schedulerCallbacks.jobDone();
        return;
    }
    
    if (self._state !== FetchJob.FETCH_STATUS_REQUEST_YIELDED) {
        throw 'Unexpected request state on continue: ' + self._state;
    }
    
    self._state = FetchJob.FETCH_STATUS_ACTIVE;
    self._resource = resource;
    
    self._scheduledJobsListIterator = self._scheduledJobsList.add(self);
    self._fetchHandle.resume();
}

function fetchYieldedByScheduler(self) {
    var nextState;
    self._resource = null;
    self._scheduledJobsList.remove(self._scheduledJobsListIterator);
    if (self.state === FetchJob.FETCH_STATUS_REQUEST_ABOUT_TO_YIELD) {
        self._state = FetchJob.FETCH_STATUS_REQUEST_YIELDED;
    } else {
        self._state = FetchJob.FETCH_STATUS_UNEXPECTED_FAILURE;
        throw 'Unexpected request state on yield process: ' + self._state;
    }
}

function fetchAbortedByScheduler(self) {
    self._resource = null;
    self._fetchTerminated(/*isAborted=*/true);
}
},{}],9:[function(require,module,exports){
'use strict';

module.exports = FetchManager;

var imageHelperFunctions = require('imagehelperfunctions.js');
var FetchJob = require('fetchjob.js');
var ImageParamsRetrieverProxy = require('imageparamsretrieverproxy.js');
var LinkedList = require('linkedlist.js');

/* global console: false */
/* global Promise: false */

function FetchManager(fetcher, options) {
    ImageParamsRetrieverProxy.call(this);

    options = options || {};
    var serverRequestsLimit = options.serverRequestsLimit || 5;
    
    this._fetcher = fetcher;
    this._internalSizesParams = null;
    this._showLog = options.showLog;
    
    if (this._showLog) {
        // Old IE
        throw 'showLog is not supported on this browser';
    }
	
	if (!fetcher.on) {
		throw 'ImageDecoderFramework error: Fetcher has no method on()';
	}
	if (!fetcher.open) {
		throw 'ImageDecoderFramework error: Fetcher has no method open()';
	}
    if (!fetcher.close) {
		throw 'ImageDecoderFramework error: Fetcher has no method close()';
	}
    if (!fetcher.reconnect) {
		throw 'ImageDecoderFramework error: Fetcher has no method reconnect()';
	}
    if (!fetcher.fetch) {
		throw 'ImageDecoderFramework error: Fetcher has no method fetch()';
	}
    if (!fetcher.moveFetch) {
		throw 'ImageDecoderFramework error: Fetcher has no method moveFetch()';
	}
    if (!fetcher.startMovableFetch) {
		throw 'ImageDecoderFramework error: Fetcher has no method startMovableFetch()';
	}
    
    var serverRequestScheduler = imageHelperFunctions.createScheduler(
        options.showLog,
        options.serverRequestPrioritizer,
        'serverRequest',
        createServerRequestDummyResource,
        serverRequestsLimit);
    
    this._serverRequestPrioritizer = serverRequestScheduler.prioritizer;
    
    this._scheduler = serverRequestScheduler.scheduler;
    this._channelHandleCounter = 0;
    this._channelHandles = [];
    this._requestById = [];
    this._scheduledJobsList = new LinkedList();
}

FetchManager.prototype = Object.create(ImageParamsRetrieverProxy.prototype);

FetchManager.prototype.open = function open(url) {
    var promise = this._fetcher.open(url);
    var self = this;
    return promise.then(function(result) {
        self._internalSizesParams = result;
        return result;
    });
};

FetchManager.prototype.on = function on(event, callback) {
    this._fetcher.on(event, callback);
};

FetchManager.prototype.close = function close() {
    return this._fetcher.close();
};

FetchManager.prototype.setIsProgressiveRequest = function setIsProgressiveRequest(
    requestId, isProgressive) {
    
    var fetchJob = this._requestById[requestId];
    if (fetchJob === undefined) {
        // This situation might occur if request has been terminated,
        // but user's terminatedCallback has not been called yet. It
        // happens on WorkerProxyFetchManager due to thread
        // message delay.
        
        return null;
    }
    
    fetchJob.setIsProgressive(isProgressive);
};

FetchManager.prototype.createChannel = function createChannel() {
	var self = this;
    return new Promise(function(resolve, reject) {
        var channelHandle = ++self._channelHandleCounter;
        self._channelHandles[channelHandle] = new FetchJob(
            self._fetcher,
            self._scheduler,
            self._scheduledJobsList,
            FetchJob.FETCH_TYPE_CHANNEL,
            /*contextVars=*/null);

        resolve(channelHandle);
    });
};

FetchManager.prototype.moveChannel = function moveChannel(
    channelHandle, imagePartParams) {
    
    var channel = this._channelHandles[channelHandle];
    channel.fetch(imagePartParams);
};

FetchManager.prototype.createRequest = function createRequest(
    requestId, imagePartParams) {
    
    var contextVars = {
        progressiveStagesDone: 0,
        isLastCallbackCalledWithoutLowQualityLimit: false,
        requestId: requestId,
        fetchJob: null,
        self: this
    };
    
    var fetchType = /*isOnlyWaitForData ?
        FetchJob.FETCH_TYPE_ONLY_WAIT_FOR_DATA : */FetchJob.FETCH_TYPE_REQUEST;
    
    var fetchJob = new FetchJob(
        this._fetcher, this._scheduler, this._scheduledJobsList, fetchType, contextVars);
    
    contextVars.fetchJob = fetchJob;
    
    if (this._requestById[requestId] !== undefined) {
        throw 'Duplication of requestId ' + requestId;
    } else if (requestId !== undefined) {
        this._requestById[requestId] = fetchJob;
    }
    
    fetchJob.on('terminated', internalTerminatedCallback);
    
    fetchJob.fetch(imagePartParams);
    
    this._yieldFetchJobs();
};

FetchManager.prototype.manualAbortRequest = function manualAbortRequest(
    requestId) {
    
    var fetchJob = this._requestById[requestId];
    
    if (fetchJob === undefined) {
        // This situation might occur if request has been terminated,
        // but user's terminatedCallback has not been called yet. It
        // happens on WorkerProxyFetchManager due to web worker
        // message delay.
        
        return;
    }
    
    fetchJob.manualAbortRequest();
    delete this._requestById[requestId];
};

FetchManager.prototype.reconnect = function reconnect() {
    this._fetcher.reconnect();
};

FetchManager.prototype.setServerRequestPrioritizerData =
    function setServerRequestPrioritizerData(prioritizerData) {

    if (this._serverRequestPrioritizer === null) {
        throw 'No serverRequest prioritizer has been set';
    }
    
    if (this._showLog) {
        console.log('setServerRequestPrioritizerData(' + prioritizerData + ')');
    }
    
    prioritizerData.image = this;
    this._serverRequestPrioritizer.setPrioritizerData(prioritizerData);
    this._yieldFetchJobs();
};

FetchManager.prototype._getImageParamsInternal = function getImageParamsInternal() {
    return this._internalSizesParams;
};

FetchManager.prototype._yieldFetchJobs = function yieldFetchJobs() {
    var iterator = this._scheduledJobsList.getFirstIterator();
    while (iterator !== null) {
        var fetchJob = this._scheduledJobsList.getValue(iterator);
        iterator = this._scheduledJobsList.getNextIterator(iterator);
        
        fetchJob.checkIfShouldYield();
    }
};

function internalTerminatedCallback(contextVars, isAborted) {
    delete contextVars.self._requestById[contextVars.requestId];
}

function createServerRequestDummyResource() {
    return {};
}
},{"fetchjob.js":8,"imagehelperfunctions.js":12,"imageparamsretrieverproxy.js":15,"linkedlist.js":13}],10:[function(require,module,exports){
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
    
    var exactFrustumLevel = this._frustumData.exactlevel;
    
    if (this._frustumData.exactlevel === undefined) {
        throw 'No exactlevel information passed in ' +
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
    var tileLevel = imagePartParams.level || 0;
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
    
    var relativeX = x / imagePartParams.levelWidth;
    
    var imageRectangle = this._frustumData.imageRectangle;
    var rectangleWidth = imageRectangle.east - imageRectangle.west;
    
    var xProjected = imageRectangle.west + relativeX * rectangleWidth;
    return xProjected;
};

FrustumRequestsPrioritizer.prototype._pixelToCartographicY = function tileToCartographicY(
    y, imagePartParams, image) {
    
    var relativeY = y / imagePartParams.levelHeight;
    
    var imageRectangle = this._frustumData.imageRectangle;
    var rectangleHeight = imageRectangle.north - imageRectangle.south;
    
    var yProjected = imageRectangle.north - relativeY * rectangleHeight;
    return yProjected;
};
},{}],11:[function(require,module,exports){
'use strict';

var FrustumRequestsPrioritizer = require('frustumrequestsprioritizer.js');

module.exports = {
    calculateFrustum2DFromBounds: calculateFrustum2DFromBounds,
    createScheduler: createScheduler,
    fixBounds: fixBounds,
    alignParamsToTilesAndLevel: alignParamsToTilesAndLevel,
};

// Avoid jshint error
/* global self: false */
/* global globals: false */
    
//var log2 = Math.log(2);

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

    var pixelsAspectRatio = image.getImageWidth() / image.getImageHeight();
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
    region, imageDecoder, image) {
    
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
    
    var defaultLevelWidth = imageDecoder.getImageWidth();
    var defaultLevelHeight = imageDecoder.getImageHeight();
    if (regionMaxX < 0 || regionMinX >= defaultLevelWidth ||
        regionMaxY < 0 || regionMinY >= defaultLevelHeight) {
        
        return null;
    }
    
    //var maxLevel =
    //    imageDecoder.getDefaultNumResolutionLevels() - 1;

    //var levelX = Math.log((regionMaxX - regionMinX) / screenWidth ) / log2;
    //var levelY = Math.log((regionMaxY - regionMinY) / screenHeight) / log2;
    //var level = Math.ceil(Math.min(levelX, levelY));
    //level = Math.max(0, Math.min(maxLevel, level));
    var level = image.getLevel(region);
    var levelWidth = image.getLevelWidth(level);
    var levelHeight = image.getLevelHeight(level);
    
    var scaleX = defaultLevelWidth / levelWidth;
    var scaleY = defaultLevelHeight / levelHeight;
    
    var minTileX = Math.floor(regionMinX / (scaleX * tileWidth ));
    var minTileY = Math.floor(regionMinY / (scaleY * tileHeight));
    var maxTileX = Math.ceil (regionMaxX / (scaleX * tileWidth ));
    var maxTileY = Math.ceil (regionMaxY / (scaleY * tileHeight));
    
    var minX = minTileX * tileWidth;
    var minY = minTileY * tileHeight;
    var maxX = maxTileX * tileWidth;
    var maxY = maxTileY * tileHeight;
    
    var croppedMinX = Math.max(0, Math.min(levelWidth , minX));
    var croppedMinY = Math.max(0, Math.min(levelHeight, minY));
    var croppedMaxX = Math.max(0, Math.min(levelWidth , maxX));
    var croppedMaxY = Math.max(0, Math.min(levelHeight, maxY));
    
    var imageParamsToScreenScaleX = screenWidth  / (maxX - minX);
    var imageParamsToScreenScaleY = screenHeight / (maxY - minY);
    
    var imagePartParams = {
        minX: croppedMinX,
        minY: croppedMinY,
        maxXExclusive: croppedMaxX,
        maxYExclusive: croppedMaxY,
        levelWidth: levelWidth,
        levelHeight: levelHeight,
        level: level
    };
    
    var positionInImage = {
        minX: croppedMinX * scaleX,
        minY: croppedMinY * scaleY,
        maxXExclusive: croppedMaxX * scaleX,
        maxYExclusive: croppedMaxY * scaleY
    };
    
    var croppedScreen = {
        minX : Math.floor((croppedMinX - minX) * imageParamsToScreenScaleX),
        minY : Math.floor((croppedMinY - minY) * imageParamsToScreenScaleY),
        maxXExclusive : Math.ceil((croppedMaxX - minX) * imageParamsToScreenScaleX),
        maxYExclusive : Math.ceil((croppedMaxY - minY) * imageParamsToScreenScaleY)
    };
    
    return {
        imagePartParams: imagePartParams,
        positionInImage: positionInImage,
        croppedScreen: croppedScreen
    };
}

function getClassInGlobalObject(globalObject, className) {
    if (globalObject[className]) {
        return globalObject[className];
    }
    
    var result = globalObject;
    var path = className.split('.');
    for (var i = 0; i < path.length; ++i) {
        result = result[path[i]];
    }
    
    return result;
}
},{"frustumrequestsprioritizer.js":10}],12:[function(require,module,exports){
arguments[4][11][0].apply(exports,arguments)
},{"dup":11,"frustumrequestsprioritizer.js":10}],13:[function(require,module,exports){
'use strict';

module.exports = LinkedList;

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
},{}],14:[function(require,module,exports){
'use strict';

// Suppress "Unnecessary directive 'use strict'" for the slaveScriptContent function
/*jshint -W034 */

var ImageDecoder = require('imagedecoder.js');

module.exports.getScriptUrl = function getScriptUrl() {
    return slaveScriptUrl;
};

var slaveScriptBlob = new Blob(
    ['(', slaveScriptContent.toString(), ')()'],
    { type: 'application/javascript' });
var slaveScriptUrl = URL.createObjectURL(slaveScriptBlob);

function slaveScriptContent() {
    'use strict';
    AsyncProxy.AsyncProxySlave.setSlaveSideCreator(function() {
        var argumentsAsArray = new Array(arguments.length + 1);
        argumentsAsArray[0] = null;
        for (var i = 0; i < arguments.length; ++i) {
            argumentsAsArray[i + 1] = arguments[i];
        }
        
        var instance = new (Function.prototype.bind.apply(imageDecoderFramework.ImageDecoder, argumentsAsArray));
        
        return instance;
    });
}
},{"imagedecoder.js":5}],15:[function(require,module,exports){
'use strict';

module.exports = ImageParamsRetrieverProxy;

function ImageParamsRetrieverProxy() {
    this._sizesParams = null;
}

ImageParamsRetrieverProxy.prototype.getImageLevel = function getImageLevel() {
    var sizesParams = this.getImageParams();

    return sizesParams.imageLevel;
};

ImageParamsRetrieverProxy.prototype.getImageWidth = function getImageWidth() {
    var sizesParams = this.getImageParams();

    return sizesParams.imageWidth;
};

ImageParamsRetrieverProxy.prototype.getImageHeight = function getImageHeight() {
    var sizesParams = this.getImageParams();

    return sizesParams.imageHeight;
};

ImageParamsRetrieverProxy.prototype.getNumResolutionLevelsForLimittedViewer = function getNumResolutionLevelsForLimittedViewer() {
    var sizesParams = this.getImageParams();

    return sizesParams.numResolutionLevelsForLimittedViewer;
};

ImageParamsRetrieverProxy.prototype.getLowestQuality = function getLowestQuality() {
    var sizesParams = this.getImageParams();

    return sizesParams.lowestQuality;
};

ImageParamsRetrieverProxy.prototype.getHighestQuality = function getHighestQuality() {
    var sizesParams = this.getImageParams();

    return sizesParams.highestQuality;
};

ImageParamsRetrieverProxy.prototype.getImageParams = function getImageParams() {
    if (!this._sizesParams) {
        this._sizesParams = this._getImageParamsInternal();
        if (!this._sizesParams) {
            throw 'getImageParamsInternal() returned falsy value; Maybe image not ready yet?';
        }
        
        if (this._sizesParams.imageLevel === undefined) {
            throw 'getImageParamsInternal() result has no imageLevel property';
        }
        
        if (this._sizesParams.imageWidth === undefined) {
            throw 'getImageParamsInternal() result has no imageWidth property';
        }
        
        if (this._sizesParams.imageHeight === undefined) {
            throw 'getImageParamsInternal() result has no imageHeight property';
        }
        
        if (this._sizesParams.numResolutionLevelsForLimittedViewer === undefined) {
            throw 'getImageParamsInternal() result has no numResolutionLevelsForLimittedViewer property';
        }
        
        if (this._sizesParams.lowestQuality === undefined) {
            throw 'getImageParamsInternal() result has no lowestQuality property';
        }
        
        if (this._sizesParams.highestQuality === undefined) {
            throw 'getImageParamsInternal() result has no highestQuality property';
        }
    }
    
    return this._sizesParams;
};

ImageParamsRetrieverProxy.prototype._getImageParamsInternal = function getImageParamsInternal() {
    throw 'ImageParamsRetrieverProxy inheritor did not implement _getImageParamsInternal()';
};
},{}],16:[function(require,module,exports){
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
        
        var data = { sizesParams: this.getImageParams() };
        
        // getTileWidth and getTileHeight exists only in ImageDecoder but not in FetchManager
        if (this.getTileWidth) {
            data.applicativeTileWidth = this.getTileWidth();
        }
        if (this.getTileHeight) {
            data.applicativeTileHeight = this.getTileHeight();
        }
        
        AsyncProxy.AsyncProxySlave.sendUserDataToMaster(data);
        isReady = true;
    }
}
},{}],17:[function(require,module,exports){
'use strict';

// Suppress "Unnecessary directive 'use strict'" for the slaveScriptContent function
/*jshint -W034 */

/* global self: false */
/* global imageDecoderFramework: false */

module.exports.getScriptUrl = function getScriptUrl() {
    return decoderSlaveScriptUrl;
};

var imageHelperFunctions = require('imagehelperfunctions.js');

var decoderSlaveScriptBlob = new Blob(
    ['(', decoderSlaveScriptBody.toString(), ')()'],
    { type: 'application/javascript' });
var decoderSlaveScriptUrl = URL.createObjectURL(decoderSlaveScriptBlob);

//function WorkerProxyPixelsDecoder(options) {
//    this._options = options || {};
//    this._imageImplementation = imageHelperFunctions.getImageImplementation(
//        options.imageImplementationClassName);
//    
//    var scriptsToImport = (this._options.scriptsToImport || []).concat([decoderSlaveScriptUrl]);
//    var args = [this._options];
//    
//    this._workerHelper = new AsyncProxy.AsyncProxyMaster(
//        scriptsToImport,
//        'ArbitraryClassName',
//        args);
//}
//
//WorkerProxyPixelsDecoder.prototype.decode = function decode(dataForDecode) {
//    //var transferables = this._imageImplementation.getTransferableOfDecodeArguments(dataForDecode);
//    var resultTransferables = [['data', 'buffer']];
//    
//    var args = [dataForDecode];
//    var options = {
//        //transferables: transferables,
//        pathsToTransferablesInPromiseResult: resultTransferables,
//        isReturnPromise: true
//    };
//    
//    return this._workerHelper.callFunction('decode', args, options);
//};

//WorkerProxyPixelsDecoder.prototype.terminate = function terminate() {
//    this._workerHelper.terminate();
//};

function decoderSlaveScriptBody() {
    'use strict';

    AsyncProxy.AsyncProxySlave.setSlaveSideCreator(function createDecoder(options) {
        //var imageImplementation = self[options.imageImplementationClassName];
        var imageImplementation = imageDecoderFramework.Internals.imageHelperFunctions.getImageImplementation(options.imageImplementationClassName);
        return imageImplementation.createPixelsDecoder();
    });
}
},{"imagehelperfunctions.js":12}],18:[function(require,module,exports){
'use strict';

module.exports = WorkerProxyImageDecoder;

var imageHelperFunctions = require('imagehelperfunctions.js');
var sendImageParametersToMaster = require('sendimageparameterstomaster.js');
var createImageDecoderSlaveSide = require('createimagedecoderonslaveside.js');
var ImageParamsRetrieverProxy = require('imageparamsretrieverproxy.js');

function WorkerProxyImageDecoder(imageImplementationClassName, options) {
    ImageParamsRetrieverProxy.call(this);

    this._imageWidth = null;
    this._imageHeight = null;
    this._tileWidth = 0;
    this._tileHeight = 0;
    
    var optionsInternal = imageHelperFunctions.createInternalOptions(imageImplementationClassName, options);
    var ctorArgs = [imageImplementationClassName, optionsInternal];
    
    var scriptsToImport = imageHelperFunctions.getScriptsForWorkerImport(
        this._imageImplementation, options);
    scriptsToImport = scriptsToImport.concat([
        sendImageParametersToMaster.getScriptUrl(),
        createImageDecoderSlaveSide.getScriptUrl()]);

    this._workerHelper = new AsyncProxy.AsyncProxyMaster(
        scriptsToImport, 'imageDecoderFramework.ImageDecoder', ctorArgs);
    
    var boundImageOpened = this._imageOpened.bind(this);
    this._workerHelper.setUserDataHandler(boundImageOpened);
}

WorkerProxyImageDecoder.prototype = Object.create(ImageParamsRetrieverProxy.prototype);

WorkerProxyImageDecoder.prototype.getTileWidth = function getTileWidth() {
    this.getImageParams();
    return this._tileWidth;
};

WorkerProxyImageDecoder.prototype.getTileHeight = function getTileHeight() {
    this.getImageParams();
    return this._tileHeight;
};

WorkerProxyImageDecoder.prototype.open = function open(url) {
    var self = this;
    return this._workerHelper.callFunction('open', [url], { isReturnPromise: true })
        .then(function(imageParams) {
            self._imageOpened(imageParams);
            return imageParams;
        });
};

WorkerProxyImageDecoder.prototype.close = function close() {
    return this._workerHelper.callFunction('close', [], { isReturnPromise: true });
};

WorkerProxyImageDecoder.prototype.createChannel = function createChannel() {
    this._workerHelper.callFunction(
        'createChannel', [], { isReturnPromise: true });
};

WorkerProxyImageDecoder.prototype.requestPixels = function requestPixels(imagePartParams) {
    var pathToPixelsArray = ['data', 'buffer'];
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
        this._workerHelper.wrapCallback(
            callback, 'requestPixelsProgressiveCallback', {
                isMultipleTimeCallback: true,
                pathsToTransferables: transferables
            }
        );
    
    var internalTerminatedCallbackWrapper =
        this._workerHelper.wrapCallback(
            internalTerminatedCallback, 'requestPixelsProgressiveTerminatedCallback', {
                isMultipleTimeCallback: false
            }
        );
            
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

WorkerProxyImageDecoder.prototype.alignParamsToTilesAndLevel = function alignParamsToTilesAndLevel(region) {
	return imageHelperFunctions.alignParamsToTilesAndLevel(region, this);
};

WorkerProxyImageDecoder.prototype._imageOpened = function imageOpened(data) {
    this._internalSizesParams = data.sizesParams;
    this._tileWidth = data.applicativeTileWidth;
    this._tileHeight = data.applicativeTileHeight;
    this.getImageParams();
};

WorkerProxyImageDecoder.prototype._getImageParamsInternal = function getImageParamsInternal() {
    return this._internalSizesParams;
};
},{"createimagedecoderonslaveside.js":14,"imagehelperfunctions.js":12,"imageparamsretrieverproxy.js":15,"sendimageparameterstomaster.js":16}],19:[function(require,module,exports){
'use strict';

module.exports = ViewerImageDecoder;

var ImageDecoder = require('imagedecoder.js');
var WorkerProxyImageDecoder = require('workerproxyimagedecoder.js');
var imageHelperFunctions = require('imagehelperfunctions.js');

var PENDING_CALL_TYPE_PIXELS_UPDATED = 1;
var PENDING_CALL_TYPE_REPOSITION = 2;

var REGION_OVERVIEW = 0;
var REGION_DYNAMIC = 1;

function ViewerImageDecoder(decoder, canvasUpdatedCallback, options) {
    this._canvasUpdatedCallback = canvasUpdatedCallback;
    
    this._adaptProportions = options.adaptProportions;
    this._cartographicBounds = options.cartographicBounds;
    this._isMainImageOnUi = options.isMainImageOnUi;
    this._showLog = options.showLog;
    this._allowMultipleChannelsInSession =
        options.allowMultipleChannelsInSession;
    this._minFunctionCallIntervalMilliseconds =
        options.minFunctionCallIntervalMilliseconds;
    this._overviewResolutionX = options.overviewResolutionX || 100;
    this._overviewResolutionY = options.overviewResolutionY || 100;
        
    this._lastRequestIndex = 0;
    this._pendingUpdateViewArea = null;
    this._regions = [];
    this._targetCanvas = null;
    
    this._callPendingCallbacksBound = this._callPendingCallbacks.bind(this);
    this._createdChannelBound = this._createdChannel.bind(this);
    
    this._pendingCallbacksIntervalHandle = 0;
    this._pendingCallbackCalls = [];
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
    
    this._decoder = decoder;
    /*
    var ImageType = this._isMainImageOnUi ?
        ImageDecoder: WorkerProxyImageDecoder;

    this._image = new ImageType(imageImplementationClassName, {
        serverRequestPrioritizer: 'frustumOnly',
        // TODO decodePrioritizer: 'frustumOnly',
        showLog: this._showLog
    });
    */
    
    this._image = decoder.getImage();
}

ViewerImageDecoder.prototype.setExceptionCallback = function setExceptionCallback(exceptionCallback) {
    // TODO: Support exceptionCallback in every place needed
	this._exceptionCallback = exceptionCallback;
};
    
ViewerImageDecoder.prototype.open = function open(url) {
    return this._decoder.open(url)
        .then(this._opened.bind(this))
        .catch(this._exceptionCallback);
};

ViewerImageDecoder.prototype.close = function close() {
    var promise = this._decoder.close();
    promise.catch(this._exceptionCallback);
    this._isReady = false;
    this._canShowDynamicRegion = false;
    this._targetCanvas = null;
	return promise;
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
            regionParams, this._decoder, this._image);
    
    var isOutsideScreen = alignedParams === null;
    if (isOutsideScreen) {
        return;
    }
    
    alignedParams.imagePartParams.quality = this._quality;

    var isSameRegion =
        this._dynamicFetchParams !== undefined &&
        this._isImagePartsEqual(
            alignedParams.imagePartParams,
            this._dynamicFetchParams.imagePartParams);
    
    if (isSameRegion) {
        return;
    }
    
    frustumData.imageRectangle = this._cartographicBoundsFixed;
    frustumData.exactlevel =
        alignedParams.imagePartParams.level;
    
    this._decoder.setDecodePrioritizerData(frustumData);
    this._decoder.setServerRequestPrioritizerData(frustumData);

    this._dynamicFetchParams = alignedParams;
    
    var startDynamicRegionOnTermination = false;
    var moveExistingChannel = !this._allowMultipleChannelsInSession;
    this._fetch(
        REGION_DYNAMIC,
        alignedParams,
        startDynamicRegionOnTermination,
        moveExistingChannel);
};

ViewerImageDecoder.prototype.getBounds = function getCartographicBounds() {
    if (!this._isReady) {
        throw 'ViewerImageDecoder error: Image is not ready yet';
    }
    return this._cartographicBoundsFixed;
};

ViewerImageDecoder.prototype._isImagePartsEqual = function isImagePartsEqual(first, second) {
    var isEqual =
        this._dynamicFetchParams !== undefined &&
        first.minX === second.minX &&
        first.minY === second.minY &&
        first.maxXExclusive === second.maxXExclusive &&
        first.maxYExclusive === second.maxYExclusive &&
        first.level === second.level;
    
    return isEqual;
};

ViewerImageDecoder.prototype._fetch = function fetch(
    regionId,
    fetchParams,
    startDynamicRegionOnTermination,
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
        var newResolution = imagePartParams.level;
        var oldResolution = region.imagePartParams.level;
        
        canReuseOldData = newResolution === oldResolution;
        
        if (canReuseOldData && region.donePartParams) {
            fetchParamsNotNeeded = [ region.donePartParams ];
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

    this._decoder.requestPixelsProgressive(
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
            
            self._decoder.requestPixelsProgressive(
                fetchParams.imagePartParams,
                callback,
                terminatedCallback,
                fetchParamsNotNeeded);
        }
        
        self._fetchTerminatedCallback(
            regionId,
            fetchParams.imagePartParams.requestPriorityData,
            isAborted,
            startDynamicRegionOnTermination);
    }
};

ViewerImageDecoder.prototype._fetchTerminatedCallback = function fetchTerminatedCallback(
    regionId, priorityData, isAborted, startDynamicRegionOnTermination) {
    
    var region = this._regions[regionId];
    if (region === undefined) {
        return;
    }
    
    if (!priorityData.overrideHighestPriority &&
        priorityData.requestIndex !== this._lastRequestIndex) {
    
        return;
    }
    
    region.isDone = !isAborted && this._isReady;
	if (region.isDone) {
		region.donePartParams = region.imagePartParams;
	}
    
    if (startDynamicRegionOnTermination) {
        this._decoder.createChannel().then(this._createdChannelBound);
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
	var oldDonePartParams = region.donePartParams;
    var level = newPartParams.level;
    
    var needReposition =
        oldPartParams === undefined ||
        oldPartParams.minX !== newPartParams.minX ||
        oldPartParams.minY !== newPartParams.minY ||
        oldPartParams.maxXExclusive !== newPartParams.maxXExclusive ||
        oldPartParams.maxYExclusive !== newPartParams.maxYExclusive ||
        oldPartParams.level !== level;
    
    if (!needReposition) {
        return false;
    }
    
    var copyData;
    var intersection;
	var newDonePartParams;
    var reuseOldData = false;
    var scaleX;
    var scaleY;
    if (oldPartParams !== undefined) {
        scaleX = newPartParams.levelWidth  / oldPartParams.levelWidth;
        scaleY = newPartParams.levelHeight / oldPartParams.levelHeight;
        
        intersection = {
            minX: Math.max(oldPartParams.minX * scaleX, newPartParams.minX),
            minY: Math.max(oldPartParams.minY * scaleY, newPartParams.minY),
            maxX: Math.min(oldPartParams.maxXExclusive * scaleX, newPartParams.maxXExclusive),
            maxY: Math.min(oldPartParams.maxYExclusive * scaleY, newPartParams.maxYExclusive)
        };
        reuseOldData =
            intersection.maxX > intersection.minX &&
            intersection.maxY > intersection.minY;
    }
    
    if (reuseOldData) {
        copyData = {
            fromX: intersection.minX / scaleX - oldPartParams.minX,
            fromY: intersection.minY / scaleY - oldPartParams.minY,
            fromWidth : (intersection.maxX - intersection.minX) / scaleX,
            fromHeight: (intersection.maxY - intersection.minY) / scaleY,
            toX: intersection.minX - newPartParams.minX,
            toY: intersection.minY - newPartParams.minY,
            toWidth : intersection.maxX - intersection.minX,
            toHeight: intersection.maxY - intersection.minY,
        };
	
		if (oldDonePartParams && oldPartParams.level === level) {
			newDonePartParams = {
				minX: Math.max(oldDonePartParams.minX, newPartParams.minX),
				minY: Math.max(oldDonePartParams.minY, newPartParams.minY),
				maxXExclusive: Math.min(oldDonePartParams.maxXExclusive, newPartParams.maxXExclusive),
				maxYExclusive: Math.min(oldDonePartParams.maxYExclusive, newPartParams.maxYExclusive)
			};
		}
	}
    
    region.imagePartParams = newPartParams;
    region.isDone = false;
    region.currentDisplayRequestIndex = newPartParams.requestPriorityData.requestIndex;
    
    var repositionArgs = {
        type: PENDING_CALL_TYPE_REPOSITION,
        region: region,
        position: newPosition,
		donePartParams: newDonePartParams,
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
    if (decoded.imageData.width === 0 || decoded.imageData.height === 0) {
        return;
    }
    
    var x = decoded.xInOriginalRequest;
    var y = decoded.yInOriginalRequest;
    
    var context = region.canvas.getContext('2d');
    //var imageData = context.createImageData(decoded.width, decoded.height);
    //imageData.data.set(decoded.pixels);
    
    context.putImageData(decoded.imageData, x, y);
};

ViewerImageDecoder.prototype._repositionCanvas = function repositionCanvas(repositionArgs) {
    var region = repositionArgs.region;
    var position = repositionArgs.position;
	var donePartParams = repositionArgs.donePartParams;
    var copyData = repositionArgs.copyData;
    var pixelsWidth = repositionArgs.pixelsWidth;
    var pixelsHeight = repositionArgs.pixelsHeight;
    
    var imageDataToCopy;
    var context = region.canvas.getContext('2d');
    
    if (copyData !== undefined) {
        if (copyData.fromWidth === copyData.toWidth && copyData.fromHeight === copyData.toHeight) {
            imageDataToCopy = context.getImageData(
                copyData.fromX, copyData.fromY, copyData.fromWidth, copyData.fromHeight);
        } else {
            if (!this._tmpCanvas) {
                this._tmpCanvas = document.createElement('canvas');
                this._tmpCanvasContext = this._tmpCanvas.getContext('2d');
            }
            
            this._tmpCanvas.width  = copyData.toWidth;
            this._tmpCanvas.height = copyData.toHeight;
            this._tmpCanvasContext.drawImage(
                region.canvas,
                copyData.fromX, copyData.fromY, copyData.fromWidth, copyData.fromHeight,
                0, 0, copyData.toWidth, copyData.toHeight);
            
            imageDataToCopy = this._tmpCanvasContext.getImageData(
                0, 0, copyData.toWidth, copyData.toHeight);
        }
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
	region.donePartParams = donePartParams;
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

ViewerImageDecoder.prototype._opened = function opened() {
    this._isReady = true;
    
    var fixedBounds = {
        west: this._cartographicBounds.west,
        east: this._cartographicBounds.east,
        south: this._cartographicBounds.south,
        north: this._cartographicBounds.north
    };
    imageHelperFunctions.fixBounds(
        fixedBounds, this._decoder, this._adaptProportions);
    this._cartographicBoundsFixed = fixedBounds;
    
    var imageWidth  = this._decoder.getImageWidth ();
    var imageHeight = this._decoder.getImageHeight();
    this._quality = this._decoder.getHighestQuality();

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
        screenWidth: this._overviewResolutionX,
        screenHeight: this._overviewResolutionY
    };
    
    var overviewAlignedParams =
        imageHelperFunctions.alignParamsToTilesAndLevel(
            overviewParams, this._decoder, this._image);
            
    overviewAlignedParams.imagePartParams.requestPriorityData =
        overviewAlignedParams.imagePartParams.requestPriorityData || {};
    
    overviewAlignedParams.imagePartParams.requestPriorityData.overrideHighestPriority = true;
    overviewAlignedParams.imagePartParams.quality = this._decoder.getLowestQuality();
    
    var startDynamicRegionOnTermination =
        !this._allowMultipleChannelsInSession;
        
    this._fetch(
        REGION_OVERVIEW,
        overviewAlignedParams,
        startDynamicRegionOnTermination);
    
    if (this._allowMultipleChannelsInSession) {
        this._startShowingDynamicRegion();
    }
};
},{"imagedecoder.js":5,"imagehelperfunctions.js":12,"workerproxyimagedecoder.js":18}],20:[function(require,module,exports){
'use strict';

module.exports.ViewerImageDecoder = require('viewerimagedecoder.js');
module.exports.ImageDecoder = require('imagedecoder.js');
module.exports.FetchManager = require('fetchmanager.js');
module.exports.PromiseFetcherAdapter = require('promisefetcheradapter.js');
module.exports.GridImageBase = require('gridimagebase.js');
module.exports.GridFetcherBase = require('gridfetcherbase.js');
module.exports.GridDecoderWorkerBase = require('griddecoderworkerbase.js');
//module.exports.SimpleFetcher = require('simplefetcher.js');
//module.exports.SimplePixelsDecoderBase = require('simplepixelsdecoderbase.js');
module.exports.CesiumImageDecoderLayerManager = require('_cesiumimagedecoderlayermanager.js');
module.exports.ImageDecoderImageryProvider = require('imagedecoderimageryprovider.js');
module.exports.ImageDecoderRegionLayer = require('imagedecoderregionlayer.js');

},{"_cesiumimagedecoderlayermanager.js":2,"fetchmanager.js":9,"griddecoderworkerbase.js":23,"gridfetcherbase.js":24,"gridimagebase.js":25,"imagedecoder.js":5,"imagedecoderimageryprovider.js":4,"imagedecoderregionlayer.js":21,"promisefetcheradapter.js":26,"viewerimagedecoder.js":19}],21:[function(require,module,exports){
'use strict';

var ViewerImageDecoder = require('viewerimagedecoder.js');
var calculateLeafletFrustum = require('leafletfrustumcalculator.js');

/* global L: false */
/* global self: false */

if (self.L) {
    module.exports = L.Class.extend(createImageDecoderRegionLayerFunctions());
} else {
    module.exports = function() {
        throw new Error('Cannot instantiate ImageDecoderRegionLayer: No Leaflet namespace in scope');
    };
}

function createImageDecoderRegionLayerFunctions() {
    return {
        initialize: function initialize(options) {
            this._options = options || {};
            
            if (this._options.latLngBounds !== undefined) {
                this._options = {};
                for (var member in options) {
                    this._options[member] = options[member];
                }
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
            this._viewerImageDecoder = null;
            this._exceptionCallback = null;
        },
        
        setExceptionCallback: function setExceptionCallback(exceptionCallback) {
            this._exceptionCallback = exceptionCallback;
            if (this._viewerImageDecoder !== null) {
                this._viewerImageDecoder.setExceptionCallback(exceptionCallback);
            }
        },
        
        _createImage: function createImage() {
            if (this._viewerImageDecoder === null) {
                this._viewerImageDecoder = new ViewerImageDecoder(
                    this._options.imageDecoder,
                    this._canvasUpdatedCallbackBound,
                    this._options);
                
                if (this._exceptionCallback !== null) {
                    this._viewerImageDecoder.setExceptionCallback(this._exceptionCallback);
                }
                
                this._viewerImageDecoder.open(this._options.url).catch(this._exceptionCallback);
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
            
            this._viewerImageDecoder.setTargetCanvas(this._targetCanvas);
            
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
            
            this._viewerImageDecoder.close();
            this._viewerImageDecoder = null;
        },
        
        _moved: function () {
            this._moveCanvases();

            var frustumData = calculateLeafletFrustum(this._map);
            
            this._viewerImageDecoder.updateViewArea(frustumData);
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
            if (this._canvasPosition === null) {
                return;
            }
        
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
    };
}
},{"leafletfrustumcalculator.js":22,"viewerimagedecoder.js":19}],22:[function(require,module,exports){
'use strict';

var imageHelperFunctions = require('imagehelperfunctions.js');

module.exports = function calculateLeafletFrustum(leafletMap) {
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
},{"imagehelperfunctions.js":12}],23:[function(require,module,exports){
'use strict';

module.exports = GridDecoderWorkerBase;

/* global Promise : false */
/* global ImageData : false */

function GridDecoderWorkerBase() {
    GridDecoderWorkerBase.prototype.start = function decode(decoderInput) {
        var imagePartParams = decoderInput.imagePartParams;
        var width  = imagePartParams.maxXExclusive - imagePartParams.minX;
        var height = imagePartParams.maxYExclusive - imagePartParams.minY;
        var result = new ImageData(width, height);
        var promises = [];
		var tilePosition  = {minX: 0, minY: 0, maxXExclusive: 0, maxYExclusive: 0};
		var regionInImage = {minX: 0, minY: 0, maxXExclusive: 0, maxYExclusive: 0}; 
		var offset = {x: 0, y: 0};
		var tile = {tileX: 0, tileY: 0, level: 0, position: tilePosition, content: null};
		for (var i = 0; i < decoderInput.tileIndices.length; ++i) {
			tilePosition.minX          = decoderInput.tileIndices[i].tileX * decoderInput.tileWidth ;
			tilePosition.minY          = decoderInput.tileIndices[i].tileY * decoderInput.tileHeight;
			tilePosition.maxXExclusive = tilePosition.minX + decoderInput.tileWidth;
			tilePosition.maxYExclusive = tilePosition.minY + decoderInput.tileHeight;
			
			regionInImage.minX          = Math.max(tilePosition.minX, imagePartParams.minX);
			regionInImage.minY          = Math.max(tilePosition.minY, imagePartParams.minY);
			regionInImage.maxXExclusive = Math.min(tilePosition.maxXExclusive, imagePartParams.maxXExclusive);
			regionInImage.maxYExclusive = Math.min(tilePosition.maxYExclusive, imagePartParams.maxYExclusive);
			
			offset.x = regionInImage.minX - imagePartParams.minX;
			offset.y = regionInImage.minY - imagePartParams.minY;
			
			tile.tileY = decoderInput.tileIndices[i].tileY;
			tile.tileX = decoderInput.tileIndices[i].tileX;
			tile.level = decoderInput.tileIndices[i].level;
			tile.content = decoderInput.tileContents[i];
            promises.push(this.decodeRegion(result, offset, regionInImage, tile));
        }
        
        return Promise.all(promises).then(function() {
            return result;
        });
    };
    
    GridDecoderWorkerBase.prototype.decodeRegion = function decodeRegion(targetImageData, imagePartParams, key, fetchedData) {
        throw 'SimplePixelsDecoderBase error: decodeRegion is not implemented';
    };
}
},{}],24:[function(require,module,exports){
'use strict';

module.exports = GridFetcherBase;

var GridImageBase = require('gridimagebase');

/* global console: false */
/* global Promise: false */

function GridFetcherBase() {
	this._gridFetcherBaseCache = [];
}

GridFetcherBase.prototype.open = function(url) {
	throw 'imageDecoderFramework error: GridFetcherBase.open is not implemented by inheritor';
};

GridFetcherBase.prototype.fetchTile = function(url) {
	throw 'imageDecoderFramework error: GridFetcherBase.fetchTile is not implemented by inheritor';
};

GridFetcherBase.prototype.fetch = function fetch(imagePartParams) {
	var tilesRange = GridImageBase.getTilesRange(this._imageParams, imagePartParams);
	
	var promises = [];
	for (var tileX = tilesRange.minTileX; tileX < tilesRange.maxTileX; ++tileX) {
		for (var tileY = tilesRange.minTileY; tileY < tilesRange.maxTileY; ++tileY) {
			var promise = this._loadTile(imagePartParams.level, tileX, tileY);
			promises.push(promise);
		}
	}
	
	return Promise.all(promises);
};

GridFetcherBase.prototype._loadTile = function loadTile(level, tileX, tileY) {
	var levelCache = this._gridFetcherBaseCache[level];
	if (!levelCache) {
		levelCache = [];
		this._gridFetcherBaseCache[level] = levelCache;
	}
	
	var xCache = levelCache[tileX];
	if (!xCache) {
		xCache = [];
		levelCache[tileX] = xCache;
	}
	
	var promise = xCache[tileY];
	if (!promise) {
		promise = this.fetchTile(level, tileX, tileY).then(function(result) {
			xCache[tileY] = null;
			return result;
		});
		xCache[tileY] = promise;
	}
	
	return promise.then(function(result) {
		return {
			tileKey: {
				fetchWaitTask: true,
				tileX: tileX,
				tileY: tileY,
				level: level
			},
			content: result
		};
	});
};

},{"gridimagebase":25}],25:[function(require,module,exports){
'use strict';

module.exports = GridImageBase;

/* global console: false */
/* global Promise: false */

var FETCH_WAIT_TASK = 0;
var DECODE_TASK = 1;

function GridImageBase(fetchManager) {
	this._fetchManager = fetchManager;
	this._decoderWorkers = null;
	this._imageParams = null;
	this._waitingFetches = {};
}

GridImageBase.prototype.getDecodeTaskTypeOptions = function getDecodeTaskTypeOptions() {
	throw 'imageDecoderFramework error: GridImageBase.getDecodeTaskTypeOptions is not implemented by inheritor';
};

GridImageBase.prototype.getFetchManager = function getFetchManager() {
	return this._fetchManager;
};

GridImageBase.prototype.getDecoderWorkers = function getDecoderWorkers() {
	if (this._decoderWorkers === null) {
		this._imageParams = this._fetchManager.getImageParams(); // imageParams that returned by fetcher.open()
		this._decoderWorkers = new AsyncProxy.PromiseDependencyWorkers(this);
		this._fetchManager.on('data', this._onDataFetched.bind(this));
	}
	return this._decoderWorkers;
};

// level calculations

GridImageBase.prototype.getLevelWidth = function getLevelWidth(level) {
	var imageParams = this._fetchManager.getImageParams();
	return imageParams.tileWidth  * imageParams.lowestLevelTilesX * Math.pow(2, level);
};

GridImageBase.prototype.getLevelHeight = function getLevelHeight(level) {
	var imageParams = this._fetchManager.getImageParams();
	return imageParams.tileHeight * imageParams.lowestLevelTilesY * Math.pow(2, level);
};

GridImageBase.prototype.getLevel = function getDefaultNumResolutionLevels(regionImageLevel) {
	var imageParams = this._fetchManager.getImageParams();
	var imageLevel = imageParams.levels - 1;
	
	var log2 = Math.log(2);
	var levelX = Math.log(regionImageLevel.screenWidth  / (regionImageLevel.maxXExclusive - regionImageLevel.minX)) / log2;
	var levelY = Math.log(regionImageLevel.screenHeight / (regionImageLevel.maxYExclusive - regionImageLevel.minY)) / log2;
	var level = Math.ceil(Math.min(levelX, levelY));
	level = Math.max(0, Math.min(0, level) + imageLevel);
	
	return level;
};

// PromiseDependencyWorkersInputRetreiver implementation

GridImageBase.prototype.getPromiseTaskProperties = function(taskKey) {
	if (taskKey.fetchWaitTask) {
		return {
			taskType: FETCH_WAIT_TASK,
			dependsOnTasks: [],
			isDisableWorker: true
		};
	}
	
	var imagePartParams = taskKey;
	var tilesRange = GridImageBase.getTilesRange(this._imageParams, imagePartParams);
	
	var depends = new Array((tilesRange.maxTileX - tilesRange.minTileX) * (tilesRange.maxTileY - tilesRange.minTileY));
	var i = 0;
	for (var tileX = tilesRange.minTileX; tileX < tilesRange.maxTileX; ++tileX) {
		for (var tileY = tilesRange.minTileY; tileY < tilesRange.maxTileY; ++tileY) {
			depends[i++] = {
				fetchWaitTask: true,
				tileX: tileX,
				tileY: tileY,
				level: imagePartParams.level
			};
		}
	}
	
	return {
		taskType: DECODE_TASK,
		dependsOnTasks: depends,
		isDisableWorker: false
	};
};

GridImageBase.prototype.preWorkerProcess = function(dependsTaskResults, dependsTaskKeys, taskKey) {
	if (taskKey.fetchWaitTask) {
		var self = this;
		return new Promise(function(resolve, reject) {
			var strKey = self.getKeyAsString(taskKey);
			self._waitingFetches[strKey] = resolve;
		});
	}
	return Promise.resolve({
		tileContents: dependsTaskResults,
		tileIndices: dependsTaskKeys,
		imagePartParams: taskKey,
		tileWidth: this._imageParams.tileWidth,
		tileHeight: this._imageParams.tileHeight
	});
};

GridImageBase.prototype.getTaskTypeOptions = function(taskType) {
	if (taskType === FETCH_WAIT_TASK) {
		return {};
	} else if (taskType === DECODE_TASK) {
		return this.getDecodeTaskTypeOptions();
	} else {
		throw 'imageDecoderFramework internal error: GridImageBase.getTaskTypeOptions got unexpected task type ' + taskType;
	}
};

GridImageBase.prototype.getKeyAsString = function(key) {
	if (key.fetchWaitTask) {
		return 'fetchWait:' + key.tileX + ',' + key.tileY + ':' + key.level;
	}
	// Otherwise it's a imagePartParams key passed by imageDecoderFramework lib. Just create a unique string
	return JSON.stringify(key);
};

// Auxiliary methods

GridImageBase.prototype._onDataFetched = function(fetchedTiles, imagePartParams) {
	for (var i = 0; i < fetchedTiles.length; ++i) {
		var strKey = this.getKeyAsString(fetchedTiles[i].tileKey);
		var waitingPromise = this._waitingFetches[strKey];
		if (waitingPromise) {
			delete this._waitingFetches[strKey];
			waitingPromise(fetchedTiles[i].content);
		}
	}
};

GridImageBase.getTilesRange = function(imageParams, imagePartParams) {
	var levelTilesX = imageParams.lowestLevelTilesX << imagePartParams.level;
	var levelTilesY = imageParams.lowestLevelTilesY << imagePartParams.level;
	return {
		minTileX: Math.max(0, Math.floor(imagePartParams.minX / imageParams.tileWidth )),
		minTileY: Math.max(0, Math.floor(imagePartParams.minY / imageParams.tileHeight)),
		maxTileX: Math.min(levelTilesX, Math.ceil(imagePartParams.maxXExclusive / imageParams.tileWidth )),
		maxTileY: Math.min(levelTilesY, Math.ceil(imagePartParams.maxYExclusive / imageParams.tileHeight))
	};
};

},{}],26:[function(require,module,exports){
'use strict';

module.exports = PromiseFetcherAdapter;

var PromiseFetchAdapterFetchHandle = require('promisefetcheradapterfetchhandle.js');

/* global Promise: false */

function PromiseFetcherAdapter(promiseFetcher, options) {
    this._url = null;
    this._options = options || {};
    this._promiseFetcher = promiseFetcher;
    this._dataListeners = [];
    this._isReady = false;
    this._activeFetches = 0;
    this._resolveClose = null;
    this._rejectClose = null;
}

// Fetcher implementation

PromiseFetcherAdapter.prototype.open = function open(url) {
    var self = this;
    return this._promiseFetcher.open(url).then(function(result) {
        self._isReady = true;
        return result;
    });
};

PromiseFetcherAdapter.prototype.close = function close(closedCallback) {
    this._ensureReady();
    this._isReady = false;
    var self = this;
    return new Promise(function(resolve, reject) {
        self._resolveClose = resolve;
        self._rejectClose = reject;
        self._checkIfClosed();
    });
};

PromiseFetcherAdapter.prototype.reconnect = function reconnect() {
    this._ensureReady();
};

PromiseFetcherAdapter.prototype.on = function on(event, listener) {
    if (event !== 'data') {
        throw 'PromiseFetcherAdapter: Unexpected event ' + event + '. Expected "data"';
    }
    this._dataListeners.push(listener);
};

PromiseFetcherAdapter.prototype.fetch = function fetch(imagePartParams) {
    this._ensureReady();
    ++this._activeFetches;
	var fetchHandle = new PromiseFetchAdapterFetchHandle(imagePartParams);

    var self = this;
    this._promiseFetcher.fetch(imagePartParams)
        .then(function(result) {
            self._afterFetch(fetchHandle, result);
        }).catch(function(reason) {
            self._afterFailedFetch(reason);
        });
	
	return fetchHandle;
};

PromiseFetcherAdapter.prototype.startMovableFetch = function startMovableFetch(imagePartParams, movableFetchState) {
    this._ensureReady();
	
	var fetchHandle = new PromiseFetchAdapterFetchHandle(imagePartParams);
    
    var self = this;
    movableFetchState._currentFetchHandle = null;
    movableFetchState._pendingFetchHandle = fetchHandle;
    movableFetchState._startNextFetch =  startNextFetch;
    
    function startNextFetch(prevFetchResult) {
        if (movableFetchState._currentFetchHandle !== null) {
            var endedFetchHandle = movableFetchState._currentFetchHandle;
            movableFetchState._currentFetchHandle = null;
            self._afterFetch(endedFetchHandle, prevFetchResult);
        }
        
        if (movableFetchState._pendingFetchHandle !== null && self._isReady) {
            ++self._activeFetches;
            movableFetchState._currentFetchHandle = movableFetchState._pendingFetchHandle;
			movableFetchState._pendingFetchHandle = null;
            self._promiseFetcher.fetch(imagePartParams)
                .then(startNextFetch)
                .catch(startNextFetch);
        }
        return prevFetchResult;
    }
    
    startNextFetch();
    
    return fetchHandle;
};

PromiseFetcherAdapter.prototype.moveFetch = function moveFetch(imagePartParams, movableFetchState) {
    this._ensureReady();
	
	var fetchHandle = new PromiseFetchAdapterFetchHandle(imagePartParams);
	
	if (movableFetchState._pendingFetchHandle !== null) {
		movableFetchState._pendingFetchHandle.terminate(/*isAborted=*/true);
	}
    movableFetchState._pendingFetchHandle = fetchHandle;
    if (movableFetchState._currentFetchHandle === null) {
        movableFetchState._startNextFetch();
    }
    
    return fetchHandle;
};

PromiseFetcherAdapter.prototype._ensureReady = function ensureReady() {
    if (!this._isReady) {
        throw 'PromiseFetcherAdapter error: fetch client is not opened';
    }
};

PromiseFetcherAdapter.prototype._checkIfClosed = function checkIfClosed() {
    if (this._activeFetches === 0 && !this._isReady) {
        this._resolveClose();
    }
};

PromiseFetcherAdapter.prototype._afterFetch = function(fetchHandle, result) {
	fetchHandle.terminate(/*isAborted=*/false);
	var imagePartParams = fetchHandle.getImagePartParams();
    --this._activeFetches;
    for (var i = 0; i < this._dataListeners.length; ++i) {
        this._dataListeners[i](result, imagePartParams);
    }
    this._checkIfClosed();
    return result;
};

PromiseFetcherAdapter.prototype._afterFailedFetch = function(reason) {
    --this._activeFetches;
    this._checkIfClosed();
    return reason;
};
},{"promisefetcheradapterfetchhandle.js":27}],27:[function(require,module,exports){
'use strict';

module.exports = PromiseFetcherAdapterFetchHandle;

/* global Promise: false */

function PromiseFetcherAdapterFetchHandle(imagePartParams) {
	this._imagePartParams = imagePartParams;
	this._stopPromise = null;
	this._terminatedListeners = [];
	this._isTerminated = false;
	this._isDisposed = false;
}

PromiseFetcherAdapterFetchHandle.prototype.getImagePartParams = function getImagePartParams() {
	return this._imagePartParams;
};

PromiseFetcherAdapterFetchHandle.prototype.terminate = function terminate(isAborted) {
	if (this._isTerminated) {
		throw 'imageDecoderFramework error: FetchHandle double terminate';
	}
	this._isTerminated = true;
	for (var i = 0; i < this._terminatedListeners.length; ++i) {
		this._terminatedListeners[i](isAborted);
	}
};

// Fetcher implementation

PromiseFetcherAdapterFetchHandle.prototype.stopAsync = function stopAsync() {
	if (this._stopPromise !== null) {
		var self = this;
		this._stopPromise = new Promise(function(resolve, reject) {
			self.on('terminated', resolve);
		});
	}

	return this._stopPromise;
};

PromiseFetcherAdapterFetchHandle.prototype.setIsProgressive = function moveFetch(isProgressive) {
	// Do nothing
};

PromiseFetcherAdapterFetchHandle.prototype.on = function on(event, listener) {
	if (event !== 'terminated') {
		throw 'imageDecoderFramework error: FetchHandle.on with unsupported event ' + event + '. Only terminated event is supported';
	}
	this._terminatedListeners.push(listener);
};

PromiseFetcherAdapterFetchHandle.prototype.resume = function resume() {
	if (this._isTerminated) {
		throw 'imageDecoderFramework error: cannot resume stopped FetchHandle';
	}
};

PromiseFetcherAdapterFetchHandle.prototype.dispose = function dispose() {
	if (!this._isTerminated) {
		throw 'imageDecoderFramework error: cannot dispose non-terminated FetchHandle';
	}
	if (this._isDisposed) {
		throw 'imageDecoderFramework error: FetchHandle double dispose';
	}
	this._isDisposed = true;
};

},{}]},{},[20])(20)
});
//# sourceMappingURL=data:application/json;charset:utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJzcmMvY2VzaXVtaW1hZ2VkZWNvZGVyL19jZXNpdW1mcnVzdHVtY2FsY3VsYXRvci5qcyIsInNyYy9jZXNpdW1pbWFnZWRlY29kZXIvX2Nlc2l1bWltYWdlZGVjb2RlcmxheWVybWFuYWdlci5qcyIsInNyYy9jZXNpdW1pbWFnZWRlY29kZXIvY2FudmFzaW1hZ2VyeXByb3ZpZGVyLmpzIiwic3JjL2Nlc2l1bWltYWdlZGVjb2Rlci9pbWFnZWRlY29kZXJpbWFnZXJ5cHJvdmlkZXIuanMiLCJzcmMvaW1hZ2VkZWNvZGVyL2ltYWdlZGVjb2Rlci5qcyIsInNyYy9pbWFnZWRlY29kZXIvaW1hZ2VkZWNvZGVyaGVscGVycy9kZWNvZGVqb2IuanMiLCJzcmMvaW1hZ2VkZWNvZGVyL2ltYWdlZGVjb2RlcmhlbHBlcnMvZGVjb2Rlam9ic3Bvb2wuanMiLCJzcmMvaW1hZ2VkZWNvZGVyL2ltYWdlZGVjb2RlcmhlbHBlcnMvZmV0Y2hqb2IuanMiLCJzcmMvaW1hZ2VkZWNvZGVyL2ltYWdlZGVjb2RlcmhlbHBlcnMvZmV0Y2htYW5hZ2VyLmpzIiwic3JjL2ltYWdlZGVjb2Rlci9pbWFnZWRlY29kZXJoZWxwZXJzL2ZydXN0dW1yZXF1ZXN0c3ByaW9yaXRpemVyLmpzIiwic3JjL2ltYWdlZGVjb2Rlci9pbWFnZWRlY29kZXJoZWxwZXJzL2ltYWdlSGVscGVyRnVuY3Rpb25zLmpzIiwic3JjL2ltYWdlZGVjb2Rlci9pbWFnZWRlY29kZXJoZWxwZXJzL2xpbmtlZGxpc3QuanMiLCJzcmMvaW1hZ2VkZWNvZGVyL2ltYWdlZGVjb2RlcndvcmtlcnMvY3JlYXRlaW1hZ2VkZWNvZGVyb25zbGF2ZXNpZGUuanMiLCJzcmMvaW1hZ2VkZWNvZGVyL2ltYWdlZGVjb2RlcndvcmtlcnMvaW1hZ2VwYXJhbXNyZXRyaWV2ZXJwcm94eS5qcyIsInNyYy9pbWFnZWRlY29kZXIvaW1hZ2VkZWNvZGVyd29ya2Vycy9zZW5kaW1hZ2VwYXJhbWV0ZXJzdG9tYXN0ZXIuanMiLCJzcmMvaW1hZ2VkZWNvZGVyL2ltYWdlZGVjb2RlcndvcmtlcnMvc2V0ZGVjb2RlcnNsYXZlc2lkZWNyZWF0b3IuanMiLCJzcmMvaW1hZ2VkZWNvZGVyL2ltYWdlZGVjb2RlcndvcmtlcnMvd29ya2VycHJveHlpbWFnZWRlY29kZXIuanMiLCJzcmMvaW1hZ2VkZWNvZGVyL3ZpZXdlcmltYWdlZGVjb2Rlci5qcyIsInNyYy9pbWFnZWRlY29kZXJleHBvcnRzLmpzIiwic3JjL2xlYWZsZXRpbWFnZWRlY29kZXIvaW1hZ2VkZWNvZGVycmVnaW9ubGF5ZXIuanMiLCJzcmMvbGVhZmxldGltYWdlZGVjb2Rlci9sZWFmbGV0ZnJ1c3R1bWNhbGN1bGF0b3IuanMiLCJzcmMvc2ltcGxlZmV0Y2hlci9ncmlkZGVjb2RlcndvcmtlcmJhc2UuanMiLCJzcmMvc2ltcGxlZmV0Y2hlci9ncmlkZmV0Y2hlcmJhc2UuanMiLCJzcmMvc2ltcGxlZmV0Y2hlci9ncmlkaW1hZ2ViYXNlLmpzIiwic3JjL3NpbXBsZWZldGNoZXIvcHJvbWlzZWZldGNoZXJhZGFwdGVyLmpzIiwic3JjL3NpbXBsZWZldGNoZXIvcHJvbWlzZWZldGNoZXJhZGFwdGVyZmV0Y2hoYW5kbGUuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7QUNBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMxRkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNqSkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3RVQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM5bEJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM5U0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3hEQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzNJQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNsVEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BOQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3pLQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7Ozs7QUM3TkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMzRkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzdCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNqRkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDN0NBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMzREE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzlKQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDcG9CQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDZEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMvS0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNuQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQy9DQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNyRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN2SkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQy9JQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBIiwiZmlsZSI6ImdlbmVyYXRlZC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzQ29udGVudCI6WyIoZnVuY3Rpb24gZSh0LG4scil7ZnVuY3Rpb24gcyhvLHUpe2lmKCFuW29dKXtpZighdFtvXSl7dmFyIGE9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtpZighdSYmYSlyZXR1cm4gYShvLCEwKTtpZihpKXJldHVybiBpKG8sITApO3ZhciBmPW5ldyBFcnJvcihcIkNhbm5vdCBmaW5kIG1vZHVsZSAnXCIrbytcIidcIik7dGhyb3cgZi5jb2RlPVwiTU9EVUxFX05PVF9GT1VORFwiLGZ9dmFyIGw9bltvXT17ZXhwb3J0czp7fX07dFtvXVswXS5jYWxsKGwuZXhwb3J0cyxmdW5jdGlvbihlKXt2YXIgbj10W29dWzFdW2VdO3JldHVybiBzKG4/bjplKX0sbCxsLmV4cG9ydHMsZSx0LG4scil9cmV0dXJuIG5bb10uZXhwb3J0c312YXIgaT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2Zvcih2YXIgbz0wO288ci5sZW5ndGg7bysrKXMocltvXSk7cmV0dXJuIHN9KSIsIid1c2Ugc3RyaWN0JztcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gY2FsY3VsYXRlRnJ1c3R1bTtcclxuXHJcbi8qIGdsb2JhbCBDZXNpdW06IGZhbHNlICovXHJcblxyXG52YXIgaW1hZ2VIZWxwZXJGdW5jdGlvbnMgPSByZXF1aXJlKCdpbWFnZWhlbHBlcmZ1bmN0aW9ucy5qcycpO1xyXG5cclxudmFyIE1BWF9SRUNVUlNJVkVfTEVWRUxfT05fRkFJTEVEX1RSQU5TRk9STSA9IDQ7XHJcblxyXG5mdW5jdGlvbiBjYWxjdWxhdGVGcnVzdHVtKGNlc2l1bVdpZGdldCkge1xyXG4gICAgdmFyIHNjcmVlblNpemUgPSB7XHJcbiAgICAgICAgeDogY2VzaXVtV2lkZ2V0LnNjZW5lLmNhbnZhcy53aWR0aCxcclxuICAgICAgICB5OiBjZXNpdW1XaWRnZXQuc2NlbmUuY2FudmFzLmhlaWdodFxyXG4gICAgfTtcclxuICAgIFxyXG4gICAgdmFyIHBvaW50cyA9IFtdO1xyXG4gICAgc2VhcmNoQm91bmRpbmdQb2ludHMoXHJcbiAgICAgICAgMCwgMCwgc2NyZWVuU2l6ZS54LCBzY3JlZW5TaXplLnksIHBvaW50cywgY2VzaXVtV2lkZ2V0LCAvKnJlY3Vyc2l2ZT0qLzApO1xyXG5cclxuICAgIHZhciBmcnVzdHVtUmVjdGFuZ2xlID0gQ2VzaXVtLlJlY3RhbmdsZS5mcm9tQ2FydG9ncmFwaGljQXJyYXkocG9pbnRzKTtcclxuICAgIGlmIChmcnVzdHVtUmVjdGFuZ2xlLmVhc3QgPCBmcnVzdHVtUmVjdGFuZ2xlLndlc3QgfHwgZnJ1c3R1bVJlY3RhbmdsZS5ub3J0aCA8IGZydXN0dW1SZWN0YW5nbGUuc291dGgpIHtcclxuICAgICAgICBmcnVzdHVtUmVjdGFuZ2xlID0ge1xyXG4gICAgICAgICAgICBlYXN0OiBNYXRoLm1heChmcnVzdHVtUmVjdGFuZ2xlLmVhc3QsIGZydXN0dW1SZWN0YW5nbGUud2VzdCksXHJcbiAgICAgICAgICAgIHdlc3Q6IE1hdGgubWluKGZydXN0dW1SZWN0YW5nbGUuZWFzdCwgZnJ1c3R1bVJlY3RhbmdsZS53ZXN0KSxcclxuICAgICAgICAgICAgbm9ydGg6IE1hdGgubWF4KGZydXN0dW1SZWN0YW5nbGUubm9ydGgsIGZydXN0dW1SZWN0YW5nbGUuc291dGgpLFxyXG4gICAgICAgICAgICBzb3V0aDogTWF0aC5taW4oZnJ1c3R1bVJlY3RhbmdsZS5ub3J0aCwgZnJ1c3R1bVJlY3RhbmdsZS5zb3V0aClcclxuICAgICAgICB9O1xyXG4gICAgfVxyXG5cclxuICAgIHZhciBmcnVzdHVtRGF0YSA9IGltYWdlSGVscGVyRnVuY3Rpb25zLmNhbGN1bGF0ZUZydXN0dW0yREZyb21Cb3VuZHMoXHJcbiAgICAgICAgZnJ1c3R1bVJlY3RhbmdsZSwgc2NyZWVuU2l6ZSk7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgIHJldHVybiBmcnVzdHVtRGF0YTtcclxufVxyXG4gICAgXHJcbmZ1bmN0aW9uIHNlYXJjaEJvdW5kaW5nUG9pbnRzKFxyXG4gICAgbWluWCwgbWluWSwgbWF4WCwgbWF4WSwgcG9pbnRzLCBjZXNpdW1XaWRnZXQsIHJlY3Vyc2l2ZUxldmVsKSB7XHJcbiAgICBcclxuICAgIHZhciB0cmFuc2Zvcm1lZFBvaW50cyA9IDA7XHJcbiAgICB0cmFuc2Zvcm1lZFBvaW50cyArPSB0cmFuc2Zvcm1BbmRBZGRQb2ludChcclxuICAgICAgICBtaW5YLCBtaW5ZLCBjZXNpdW1XaWRnZXQsIHBvaW50cyk7XHJcbiAgICB0cmFuc2Zvcm1lZFBvaW50cyArPSB0cmFuc2Zvcm1BbmRBZGRQb2ludChcclxuICAgICAgICBtYXhYLCBtaW5ZLCBjZXNpdW1XaWRnZXQsIHBvaW50cyk7XHJcbiAgICB0cmFuc2Zvcm1lZFBvaW50cyArPSB0cmFuc2Zvcm1BbmRBZGRQb2ludChcclxuICAgICAgICBtaW5YLCBtYXhZLCBjZXNpdW1XaWRnZXQsIHBvaW50cyk7XHJcbiAgICB0cmFuc2Zvcm1lZFBvaW50cyArPSB0cmFuc2Zvcm1BbmRBZGRQb2ludChcclxuICAgICAgICBtYXhYLCBtYXhZLCBjZXNpdW1XaWRnZXQsIHBvaW50cyk7XHJcblxyXG4gICAgdmFyIG1heExldmVsID0gTUFYX1JFQ1VSU0lWRV9MRVZFTF9PTl9GQUlMRURfVFJBTlNGT1JNO1xyXG4gICAgXHJcbiAgICBpZiAodHJhbnNmb3JtZWRQb2ludHMgPT09IDQgfHwgcmVjdXJzaXZlTGV2ZWwgPj0gbWF4TGV2ZWwpIHtcclxuICAgICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBcclxuICAgICsrcmVjdXJzaXZlTGV2ZWw7XHJcbiAgICBcclxuICAgIHZhciBtaWRkbGVYID0gKG1pblggKyBtYXhYKSAvIDI7XHJcbiAgICB2YXIgbWlkZGxlWSA9IChtaW5ZICsgbWF4WSkgLyAyO1xyXG4gICAgXHJcbiAgICBzZWFyY2hCb3VuZGluZ1BvaW50cyhcclxuICAgICAgICBtaW5YLCBtaW5ZLCBtaWRkbGVYLCBtaWRkbGVZLCBwb2ludHMsIGNlc2l1bVdpZGdldCwgcmVjdXJzaXZlTGV2ZWwpO1xyXG5cclxuICAgIHNlYXJjaEJvdW5kaW5nUG9pbnRzKFxyXG4gICAgICAgIG1pblgsIG1pZGRsZVksIG1pZGRsZVgsIG1heFksIHBvaW50cywgY2VzaXVtV2lkZ2V0LCByZWN1cnNpdmVMZXZlbCk7XHJcblxyXG4gICAgc2VhcmNoQm91bmRpbmdQb2ludHMoXHJcbiAgICAgICAgbWlkZGxlWCwgbWluWSwgbWF4WCwgbWlkZGxlWSwgcG9pbnRzLCBjZXNpdW1XaWRnZXQsIHJlY3Vyc2l2ZUxldmVsKTtcclxuXHJcbiAgICBzZWFyY2hCb3VuZGluZ1BvaW50cyhcclxuICAgICAgICBtaWRkbGVYLCBtaWRkbGVZLCBtYXhYLCBtYXhZLCBwb2ludHMsIGNlc2l1bVdpZGdldCwgcmVjdXJzaXZlTGV2ZWwpO1xyXG59XHJcblxyXG5mdW5jdGlvbiB0cmFuc2Zvcm1BbmRBZGRQb2ludCh4LCB5LCBjZXNpdW1XaWRnZXQsIHBvaW50cykge1xyXG4gICAgXHJcbiAgICB2YXIgc2NyZWVuUG9pbnQgPSBuZXcgQ2VzaXVtLkNhcnRlc2lhbjIoeCwgeSk7XHJcbiAgICB2YXIgZWxsaXBzb2lkID0gY2VzaXVtV2lkZ2V0LnNjZW5lLm1hcFByb2plY3Rpb24uZWxsaXBzb2lkO1xyXG4gICAgdmFyIHBvaW50M0QgPSBjZXNpdW1XaWRnZXQuc2NlbmUuY2FtZXJhLnBpY2tFbGxpcHNvaWQoc2NyZWVuUG9pbnQsIGVsbGlwc29pZCk7XHJcbiAgICBcclxuICAgIGlmIChwb2ludDNEID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICByZXR1cm4gMDtcclxuICAgIH1cclxuXHJcbiAgICB2YXIgY2FydGVzaWFuID0gZWxsaXBzb2lkLmNhcnRlc2lhblRvQ2FydG9ncmFwaGljKHBvaW50M0QpO1xyXG4gICAgaWYgKGNhcnRlc2lhbiA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgcmV0dXJuIDA7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHBvaW50cy5wdXNoKGNhcnRlc2lhbik7XHJcbiAgICByZXR1cm4gMTtcclxufSIsIid1c2Ugc3RyaWN0JztcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gQ2VzaXVtSW1hZ2VEZWNvZGVyTGF5ZXJNYW5hZ2VyO1xyXG5cclxudmFyIENhbnZhc0ltYWdlcnlQcm92aWRlciA9IHJlcXVpcmUoJ2NhbnZhc2ltYWdlcnlwcm92aWRlci5qcycpO1xyXG52YXIgVmlld2VySW1hZ2VEZWNvZGVyID0gcmVxdWlyZSgndmlld2VyaW1hZ2VkZWNvZGVyLmpzJyk7XHJcbnZhciBjYWxjdWxhdGVDZXNpdW1GcnVzdHVtID0gcmVxdWlyZSgnX2Nlc2l1bWZydXN0dW1jYWxjdWxhdG9yLmpzJyk7XHJcblxyXG4vKiBnbG9iYWwgQ2VzaXVtOiBmYWxzZSAqL1xyXG5cclxuZnVuY3Rpb24gQ2VzaXVtSW1hZ2VEZWNvZGVyTGF5ZXJNYW5hZ2VyKGltYWdlSW1wbGVtZW50YXRpb25DbGFzc05hbWUsIG9wdGlvbnMpIHtcclxuICAgIHRoaXMuX29wdGlvbnMgPSBvcHRpb25zIHx8IHt9O1xyXG4gICAgXHJcbiAgICBpZiAodGhpcy5fb3B0aW9ucy5yZWN0YW5nbGUgIT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIHRoaXMuX29wdGlvbnMgPSBKU09OLnBhcnNlKEpTT04uc3RyaW5naWZ5KG9wdGlvbnMpKTtcclxuICAgICAgICB0aGlzLl9vcHRpb25zLmNhcnRvZ3JhcGhpY0JvdW5kcyA9IHtcclxuICAgICAgICAgICAgd2VzdDogb3B0aW9ucy5yZWN0YW5nbGUud2VzdCxcclxuICAgICAgICAgICAgZWFzdDogb3B0aW9ucy5yZWN0YW5nbGUuZWFzdCxcclxuICAgICAgICAgICAgc291dGg6IG9wdGlvbnMucmVjdGFuZ2xlLnNvdXRoLFxyXG4gICAgICAgICAgICBub3J0aDogb3B0aW9ucy5yZWN0YW5nbGUubm9ydGhcclxuICAgICAgICB9O1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICB0aGlzLl9vcHRpb25zLm1pbkZ1bmN0aW9uQ2FsbEludGVydmFsTWlsbGlzZWNvbmRzID1cclxuICAgICAgICBvcHRpb25zLm1pbkZ1bmN0aW9uQ2FsbEludGVydmFsTWlsbGlzZWNvbmRzIHx8IDEwMDtcclxuICAgIHRoaXMuX3VybCA9IG9wdGlvbnMudXJsO1xyXG5cclxuICAgIHRoaXMuX3RhcmdldENhbnZhcyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2NhbnZhcycpO1xyXG4gICAgdGhpcy5faW1hZ2VyeVByb3ZpZGVycyA9IFtcclxuICAgICAgICBuZXcgQ2FudmFzSW1hZ2VyeVByb3ZpZGVyKHRoaXMuX3RhcmdldENhbnZhcyksXHJcbiAgICAgICAgbmV3IENhbnZhc0ltYWdlcnlQcm92aWRlcih0aGlzLl90YXJnZXRDYW52YXMpXHJcbiAgICBdO1xyXG4gICAgdGhpcy5faW1hZ2VyeUxheWVyU2hvd24gPSBuZXcgQ2VzaXVtLkltYWdlcnlMYXllcih0aGlzLl9pbWFnZXJ5UHJvdmlkZXJzWzBdKTtcclxuICAgIHRoaXMuX2ltYWdlcnlMYXllclBlbmRpbmcgPSBuZXcgQ2VzaXVtLkltYWdlcnlMYXllcih0aGlzLl9pbWFnZXJ5UHJvdmlkZXJzWzFdKTtcclxuXHJcbiAgICB0aGlzLl9jYW52YXNVcGRhdGVkQ2FsbGJhY2tCb3VuZCA9IHRoaXMuX2NhbnZhc1VwZGF0ZWRDYWxsYmFjay5iaW5kKHRoaXMpO1xyXG4gICAgXHJcbiAgICB0aGlzLl9pc1BlbmRpbmdVcGRhdGVDYWxsYmFjayA9IGZhbHNlO1xyXG4gICAgdGhpcy5faXNXaGlsZVJlcGxhY2VMYXllclNob3duID0gZmFsc2U7XHJcbiAgICB0aGlzLl9wZW5kaW5nUG9zaXRpb25SZWN0YW5nbGUgPSBudWxsO1xyXG4gICAgXHJcbiAgICB0aGlzLl9pbWFnZSA9IG5ldyBWaWV3ZXJJbWFnZURlY29kZXIoXHJcbiAgICAgICAgaW1hZ2VJbXBsZW1lbnRhdGlvbkNsYXNzTmFtZSxcclxuICAgICAgICB0aGlzLl9jYW52YXNVcGRhdGVkQ2FsbGJhY2tCb3VuZCxcclxuICAgICAgICB0aGlzLl9vcHRpb25zKTtcclxuICAgIFxyXG4gICAgdGhpcy5faW1hZ2Uuc2V0VGFyZ2V0Q2FudmFzKHRoaXMuX3RhcmdldENhbnZhcyk7XHJcbiAgICBcclxuICAgIHRoaXMuX3VwZGF0ZUZydXN0dW1Cb3VuZCA9IHRoaXMuX3VwZGF0ZUZydXN0dW0uYmluZCh0aGlzKTtcclxuICAgIHRoaXMuX3Bvc3RSZW5kZXJCb3VuZCA9IHRoaXMuX3Bvc3RSZW5kZXIuYmluZCh0aGlzKTtcclxufVxyXG5cclxuQ2VzaXVtSW1hZ2VEZWNvZGVyTGF5ZXJNYW5hZ2VyLnByb3RvdHlwZS5zZXRFeGNlcHRpb25DYWxsYmFjayA9IGZ1bmN0aW9uIHNldEV4Y2VwdGlvbkNhbGxiYWNrKGV4Y2VwdGlvbkNhbGxiYWNrKSB7XHJcbiAgICB0aGlzLl9pbWFnZS5zZXRFeGNlcHRpb25DYWxsYmFjayhleGNlcHRpb25DYWxsYmFjayk7XHJcbn07XHJcblxyXG5DZXNpdW1JbWFnZURlY29kZXJMYXllck1hbmFnZXIucHJvdG90eXBlLm9wZW4gPSBmdW5jdGlvbiBvcGVuKHdpZGdldE9yVmlld2VyKSB7XHJcbiAgICB0aGlzLl93aWRnZXQgPSB3aWRnZXRPclZpZXdlcjtcclxuICAgIHRoaXMuX2xheWVycyA9IHdpZGdldE9yVmlld2VyLnNjZW5lLmltYWdlcnlMYXllcnM7XHJcbiAgICB3aWRnZXRPclZpZXdlci5zY2VuZS5wb3N0UmVuZGVyLmFkZEV2ZW50TGlzdGVuZXIodGhpcy5fcG9zdFJlbmRlckJvdW5kKTtcclxuICAgIFxyXG4gICAgdGhpcy5faW1hZ2Uub3Blbih0aGlzLl91cmwpO1xyXG4gICAgdGhpcy5fbGF5ZXJzLmFkZCh0aGlzLl9pbWFnZXJ5TGF5ZXJTaG93bik7XHJcbiAgICBcclxuICAgIC8vIE5PVEU6IElzIHRoZXJlIGFuIGV2ZW50IGhhbmRsZXIgdG8gcmVnaXN0ZXIgaW5zdGVhZD9cclxuICAgIC8vIChDZXNpdW0ncyBldmVudCBjb250cm9sbGVycyBvbmx5IGV4cG9zZSBrZXlib2FyZCBhbmQgbW91c2VcclxuICAgIC8vIGV2ZW50cywgYnV0IHRoZXJlIGlzIG5vIGV2ZW50IGZvciBmcnVzdHVtIGNoYW5nZWRcclxuICAgIC8vIHByb2dyYW1tYXRpY2FsbHkpLlxyXG4gICAgdGhpcy5faW50ZXJ2YWxIYW5kbGUgPSBzZXRJbnRlcnZhbChcclxuICAgICAgICB0aGlzLl91cGRhdGVGcnVzdHVtQm91bmQsXHJcbiAgICAgICAgNTAwKTtcclxufTtcclxuXHJcbkNlc2l1bUltYWdlRGVjb2RlckxheWVyTWFuYWdlci5wcm90b3R5cGUuY2xvc2UgPSBmdW5jdGlvbiBjbG9zZSgpIHtcclxuICAgIHRoaXMuX2ltYWdlLmNsb3NlKCk7XHJcbiAgICBjbGVhckludGVydmFsKHRoaXMuX2ludGVydmFsSGFuZGxlKTtcclxuXHJcbiAgICB0aGlzLl9sYXllcnMucmVtb3ZlKHRoaXMuX2ltYWdlcnlMYXllclNob3duKTtcclxuICAgIHRoaXMuX3dpZGdldC5yZW1vdmVFdmVudExpc3RlbmVyKHRoaXMuX3Bvc3RSZW5kZXJCb3VuZCk7XHJcbiAgICBpZiAodGhpcy5faXNXaGlsZVJlcGxhY2VMYXllclNob3duKSB7XHJcbiAgICAgICAgdGhpcy5faXNXaGlsZVJlcGxhY2VMYXllclNob3duID0gZmFsc2U7XHJcbiAgICAgICAgdGhpcy5faXNQZW5kaW5nVXBkYXRlQ2FsbGJhY2sgPSBmYWxzZTtcclxuICAgICAgICB0aGlzLl9sYXllcnMucmVtb3ZlKHRoaXMuX2ltYWdlcnlMYXllclBlbmRpbmcpO1xyXG4gICAgfVxyXG59O1xyXG5cclxuQ2VzaXVtSW1hZ2VEZWNvZGVyTGF5ZXJNYW5hZ2VyLnByb3RvdHlwZS5nZXRJbWFnZXJ5TGF5ZXJzID0gZnVuY3Rpb24gZ2V0SW1hZ2VyeUxheWVycygpIHtcclxuICAgIHJldHVybiBbdGhpcy5faW1hZ2VyeUxheWVyU2hvd24sIHRoaXMuX2ltYWdlcnlMYXllclBlbmRpbmddO1xyXG59O1xyXG5cclxuQ2VzaXVtSW1hZ2VEZWNvZGVyTGF5ZXJNYW5hZ2VyLnByb3RvdHlwZS5fdXBkYXRlRnJ1c3R1bSA9IGZ1bmN0aW9uIHVwZGF0ZUZydXN0dW0oKSB7XHJcbiAgICB2YXIgZnJ1c3R1bSA9IGNhbGN1bGF0ZUNlc2l1bUZydXN0dW0odGhpcy5fd2lkZ2V0KTtcclxuICAgIGlmIChmcnVzdHVtICE9PSBudWxsKSB7XHJcbiAgICAgICAgdGhpcy5faW1hZ2UudXBkYXRlVmlld0FyZWEoZnJ1c3R1bSk7XHJcbiAgICB9XHJcbn07XHJcblxyXG5DZXNpdW1JbWFnZURlY29kZXJMYXllck1hbmFnZXIucHJvdG90eXBlLl9jYW52YXNVcGRhdGVkQ2FsbGJhY2sgPSBmdW5jdGlvbiBjYW52YXNVcGRhdGVkQ2FsbGJhY2sobmV3UG9zaXRpb24pIHtcclxuICAgIGlmICh0aGlzLl9pc1doaWxlUmVwbGFjZUxheWVyU2hvd24pIHtcclxuICAgICAgICB0aGlzLl9pc1BlbmRpbmdVcGRhdGVDYWxsYmFjayA9IHRydWU7XHJcbiAgICAgICAgdGhpcy5fcGVuZGluZ1Bvc2l0aW9uUmVjdGFuZ2xlID0gbmV3UG9zaXRpb247XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGlmIChuZXdQb3NpdGlvbiAhPT0gbnVsbCkge1xyXG4gICAgICAgIHZhciByZWN0YW5nbGUgPSBuZXcgQ2VzaXVtLlJlY3RhbmdsZShcclxuICAgICAgICAgICAgbmV3UG9zaXRpb24ud2VzdCxcclxuICAgICAgICAgICAgbmV3UG9zaXRpb24uc291dGgsXHJcbiAgICAgICAgICAgIG5ld1Bvc2l0aW9uLmVhc3QsXHJcbiAgICAgICAgICAgIG5ld1Bvc2l0aW9uLm5vcnRoKTtcclxuICAgICAgICBcclxuICAgICAgICB0aGlzLl9pbWFnZXJ5UHJvdmlkZXJzWzBdLnNldFJlY3RhbmdsZShyZWN0YW5nbGUpO1xyXG4gICAgICAgIHRoaXMuX2ltYWdlcnlQcm92aWRlcnNbMV0uc2V0UmVjdGFuZ2xlKHJlY3RhbmdsZSk7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHRoaXMuX3JlbW92ZUFuZFJlQWRkTGF5ZXIoKTtcclxufTtcclxuXHJcbkNlc2l1bUltYWdlRGVjb2RlckxheWVyTWFuYWdlci5wcm90b3R5cGUuX3JlbW92ZUFuZFJlQWRkTGF5ZXIgPSBmdW5jdGlvbiByZW1vdmVBbmRSZUFkZExheWVyKCkge1xyXG4gICAgdmFyIGluZGV4ID0gdGhpcy5fbGF5ZXJzLmluZGV4T2YodGhpcy5faW1hZ2VyeUxheWVyU2hvd24pO1xyXG4gICAgXHJcbiAgICBpZiAoaW5kZXggPCAwKSB7XHJcbiAgICAgICAgdGhyb3cgJ0xheWVyIHdhcyByZW1vdmVkIGZyb20gdmlld2VyXFwncyBsYXllcnMgIHdpdGhvdXQgJyArXHJcbiAgICAgICAgICAgICdjbG9zaW5nIGxheWVyIG1hbmFnZXIuIFVzZSBDZXNpdW1JbWFnZURlY29kZXJMYXllck1hbmFnZXIuJyArXHJcbiAgICAgICAgICAgICdjbG9zZSgpIGluc3RlYWQnO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICB0aGlzLl9pc1doaWxlUmVwbGFjZUxheWVyU2hvd24gPSB0cnVlO1xyXG4gICAgdGhpcy5fbGF5ZXJzLmFkZCh0aGlzLl9pbWFnZXJ5TGF5ZXJQZW5kaW5nLCBpbmRleCk7XHJcbn07XHJcblxyXG5DZXNpdW1JbWFnZURlY29kZXJMYXllck1hbmFnZXIucHJvdG90eXBlLl9wb3N0UmVuZGVyID0gZnVuY3Rpb24gcG9zdFJlbmRlcigpIHtcclxuICAgIGlmICghdGhpcy5faXNXaGlsZVJlcGxhY2VMYXllclNob3duKVxyXG4gICAgICAgIHJldHVybjtcclxuICAgIFxyXG4gICAgdGhpcy5faXNXaGlsZVJlcGxhY2VMYXllclNob3duID0gZmFsc2U7XHJcbiAgICB0aGlzLl9sYXllcnMucmVtb3ZlKHRoaXMuX2ltYWdlcnlMYXllclNob3duLCAvKmRlc3Ryb3k9Ki9mYWxzZSk7XHJcbiAgICBcclxuICAgIHZhciBzd2FwID0gdGhpcy5faW1hZ2VyeUxheWVyU2hvd247XHJcbiAgICB0aGlzLl9pbWFnZXJ5TGF5ZXJTaG93biA9IHRoaXMuX2ltYWdlcnlMYXllclBlbmRpbmc7XHJcbiAgICB0aGlzLl9pbWFnZXJ5TGF5ZXJQZW5kaW5nID0gc3dhcDtcclxuICAgIFxyXG4gICAgaWYgKHRoaXMuX2lzUGVuZGluZ1VwZGF0ZUNhbGxiYWNrKSB7XHJcbiAgICAgICAgdGhpcy5faXNQZW5kaW5nVXBkYXRlQ2FsbGJhY2sgPSBmYWxzZTtcclxuICAgICAgICB0aGlzLl9jYW52YXNVcGRhdGVkQ2FsbGJhY2sodGhpcy5fcGVuZGluZ1Bvc2l0aW9uUmVjdGFuZ2xlKTtcclxuICAgIH1cclxufTsiLCIndXNlIHN0cmljdCc7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IENhbnZhc0ltYWdlcnlQcm92aWRlcjtcclxuXHJcbi8qIGdsb2JhbCBDZXNpdW06IGZhbHNlICovXHJcbi8qIGdsb2JhbCBEZXZlbG9wZXJFcnJvcjogZmFsc2UgKi9cclxuLyogZ2xvYmFsIENyZWRpdDogZmFsc2UgKi9cclxuXHJcbi8qKlxyXG4gKiBQcm92aWRlcyBhIFNpbmdsZSBDYW52YXMgaW1hZ2VyeSB0aWxlLiAgVGhlIGltYWdlIGlzIGFzc3VtZWQgdG8gdXNlIGFcclxuICoge0BsaW5rIEdlb2dyYXBoaWNUaWxpbmdTY2hlbWV9LlxyXG4gKlxyXG4gKiBAYWxpYXMgQ2FudmFzSW1hZ2VyeVByb3ZpZGVyXHJcbiAqIEBjb25zdHJ1Y3RvclxyXG4gKlxyXG4gKiBAcGFyYW0ge2NhbnZhc30gQ2FudmFzIGZvciB0aGUgdGlsZS5cclxuICogQHBhcmFtIHtPYmplY3R9IG9wdGlvbnMgT2JqZWN0IHdpdGggdGhlIGZvbGxvd2luZyBwcm9wZXJ0aWVzOlxyXG4gKiBAcGFyYW0ge0NyZWRpdHxTdHJpbmd9IFtvcHRpb25zLmNyZWRpdF0gQSBjcmVkaXQgZm9yIHRoZSBkYXRhIHNvdXJjZSwgd2hpY2ggaXMgZGlzcGxheWVkIG9uIHRoZSBjYW52YXMuXHJcbiAqXHJcbiAqIEBzZWUgQXJjR2lzTWFwU2VydmVySW1hZ2VyeVByb3ZpZGVyXHJcbiAqIEBzZWUgQmluZ01hcHNJbWFnZXJ5UHJvdmlkZXJcclxuICogQHNlZSBHb29nbGVFYXJ0aEltYWdlcnlQcm92aWRlclxyXG4gKiBAc2VlIE9wZW5TdHJlZXRNYXBJbWFnZXJ5UHJvdmlkZXJcclxuICogQHNlZSBUaWxlTWFwU2VydmljZUltYWdlcnlQcm92aWRlclxyXG4gKiBAc2VlIFdlYk1hcFNlcnZpY2VJbWFnZXJ5UHJvdmlkZXJcclxuICovXHJcbmZ1bmN0aW9uIENhbnZhc0ltYWdlcnlQcm92aWRlcihjYW52YXMsIG9wdGlvbnMpIHtcclxuICAgIGlmIChvcHRpb25zID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICBvcHRpb25zID0ge307XHJcbiAgICB9XHJcblxyXG4gICAgLy8+PmluY2x1ZGVTdGFydCgnZGVidWcnLCBwcmFnbWFzLmRlYnVnKTtcclxuICAgIGlmIChjYW52YXMgPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIHRocm93IG5ldyBEZXZlbG9wZXJFcnJvcignY2FudmFzIGlzIHJlcXVpcmVkLicpO1xyXG4gICAgfVxyXG4gICAgLy8+PmluY2x1ZGVFbmQoJ2RlYnVnJyk7XHJcblxyXG4gICAgdGhpcy5fY2FudmFzID0gY2FudmFzO1xyXG5cclxuICAgIHRoaXMuX2Vycm9yRXZlbnQgPSBuZXcgRXZlbnQoJ0NhbnZhc0ltYWdlcnlQcm92aWRlclN0YXR1cycpO1xyXG5cclxuICAgIHRoaXMuX3JlYWR5ID0gZmFsc2U7XHJcblxyXG4gICAgdmFyIGNyZWRpdCA9IG9wdGlvbnMuY3JlZGl0O1xyXG4gICAgaWYgKHR5cGVvZiBjcmVkaXQgPT09ICdzdHJpbmcnKSB7XHJcbiAgICAgICAgY3JlZGl0ID0gbmV3IENyZWRpdChjcmVkaXQpO1xyXG4gICAgfVxyXG4gICAgdGhpcy5fY3JlZGl0ID0gY3JlZGl0O1xyXG59XHJcblxyXG5DYW52YXNJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlID0ge1xyXG4gICAgLyoqXHJcbiAgICAgKiBHZXRzIHRoZSB3aWR0aCBvZiBlYWNoIHRpbGUsIGluIHBpeGVscy4gVGhpcyBmdW5jdGlvbiBzaG91bGRcclxuICAgICAqIG5vdCBiZSBjYWxsZWQgYmVmb3JlIHtAbGluayBDYW52YXNJbWFnZXJ5UHJvdmlkZXIjcmVhZHl9IHJldHVybnMgdHJ1ZS5cclxuICAgICAqIEBtZW1iZXJvZiBDYW52YXNJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlXHJcbiAgICAgKiBAdHlwZSB7TnVtYmVyfVxyXG4gICAgICogQHJlYWRvbmx5XHJcbiAgICAgKi9cclxuICAgIGdldCB0aWxlV2lkdGgoKSB7XHJcbiAgICAgICAgICAgIC8vPj5pbmNsdWRlU3RhcnQoJ2RlYnVnJywgcHJhZ21hcy5kZWJ1Zyk7XHJcbiAgICAgICAgICAgIGlmICghdGhpcy5fcmVhZHkpIHtcclxuICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRGV2ZWxvcGVyRXJyb3IoJ3RpbGVXaWR0aCBtdXN0IG5vdCBiZSBjYWxsZWQgYmVmb3JlIHRoZSBpbWFnZXJ5IHByb3ZpZGVyIGlzIHJlYWR5LicpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIC8vPj5pbmNsdWRlRW5kKCdkZWJ1ZycpO1xyXG5cclxuICAgICAgICAgICAgcmV0dXJuIHRoaXMuX2NhbnZhcy53aWR0aDtcclxuICAgIH0sXHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZXRzIHRoZSBoZWlnaHQgb2YgZWFjaCB0aWxlLCBpbiBwaXhlbHMuICBUaGlzIGZ1bmN0aW9uIHNob3VsZFxyXG4gICAgICogbm90IGJlIGNhbGxlZCBiZWZvcmUge0BsaW5rIENhbnZhc0ltYWdlcnlQcm92aWRlciNyZWFkeX0gcmV0dXJucyB0cnVlLlxyXG4gICAgICogQG1lbWJlcm9mIENhbnZhc0ltYWdlcnlQcm92aWRlci5wcm90b3R5cGVcclxuICAgICAqIEB0eXBlIHtOdW1iZXJ9XHJcbiAgICAgKiBAcmVhZG9ubHlcclxuICAgICAqL1xyXG4gICAgZ2V0IHRpbGVIZWlnaHQoKSB7XHJcbiAgICAgICAgICAgIC8vPj5pbmNsdWRlU3RhcnQoJ2RlYnVnJywgcHJhZ21hcy5kZWJ1Zyk7XHJcbiAgICAgICAgICAgIGlmICghdGhpcy5fcmVhZHkpIHtcclxuICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRGV2ZWxvcGVyRXJyb3IoJ3RpbGVIZWlnaHQgbXVzdCBub3QgYmUgY2FsbGVkIGJlZm9yZSB0aGUgaW1hZ2VyeSBwcm92aWRlciBpcyByZWFkeS4nKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAvLz4+aW5jbHVkZUVuZCgnZGVidWcnKTtcclxuXHJcbiAgICAgICAgICAgIHJldHVybiB0aGlzLl9jYW52YXMuaGVpZ2h0O1xyXG4gICAgfSxcclxuXHJcbiAgICAvKipcclxuICAgICAqIEdldHMgdGhlIG1heGltdW0gbGV2ZWwtb2YtZGV0YWlsIHRoYXQgY2FuIGJlIHJlcXVlc3RlZC4gIFRoaXMgZnVuY3Rpb24gc2hvdWxkXHJcbiAgICAgKiBub3QgYmUgY2FsbGVkIGJlZm9yZSB7QGxpbmsgQ2FudmFzSW1hZ2VyeVByb3ZpZGVyI3JlYWR5fSByZXR1cm5zIHRydWUuXHJcbiAgICAgKiBAbWVtYmVyb2YgQ2FudmFzSW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZVxyXG4gICAgICogQHR5cGUge051bWJlcn1cclxuICAgICAqIEByZWFkb25seVxyXG4gICAgICovXHJcbiAgICBnZXQgbWF4aW11bUxldmVsKCkge1xyXG4gICAgICAgICAgICAvLz4+aW5jbHVkZVN0YXJ0KCdkZWJ1ZycsIHByYWdtYXMuZGVidWcpO1xyXG4gICAgICAgICAgICBpZiAoIXRoaXMuX3JlYWR5KSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IERldmVsb3BlckVycm9yKCdtYXhpbXVtTGV2ZWwgbXVzdCBub3QgYmUgY2FsbGVkIGJlZm9yZSB0aGUgaW1hZ2VyeSBwcm92aWRlciBpcyByZWFkeS4nKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAvLz4+aW5jbHVkZUVuZCgnZGVidWcnKTtcclxuXHJcbiAgICAgICAgICAgIHJldHVybiAwO1xyXG4gICAgfSxcclxuXHJcbiAgICAvKipcclxuICAgICAqIEdldHMgdGhlIG1pbmltdW0gbGV2ZWwtb2YtZGV0YWlsIHRoYXQgY2FuIGJlIHJlcXVlc3RlZC4gIFRoaXMgZnVuY3Rpb24gc2hvdWxkXHJcbiAgICAgKiBub3QgYmUgY2FsbGVkIGJlZm9yZSB7QGxpbmsgQ2FudmFzSW1hZ2VyeVByb3ZpZGVyI3JlYWR5fSByZXR1cm5zIHRydWUuXHJcbiAgICAgKiBAbWVtYmVyb2YgQ2FudmFzSW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZVxyXG4gICAgICogQHR5cGUge051bWJlcn1cclxuICAgICAqIEByZWFkb25seVxyXG4gICAgICovXHJcbiAgICBnZXQgbWluaW11bUxldmVsKCkge1xyXG4gICAgICAgICAgICAvLz4+aW5jbHVkZVN0YXJ0KCdkZWJ1ZycsIHByYWdtYXMuZGVidWcpO1xyXG4gICAgICAgICAgICBpZiAoIXRoaXMuX3JlYWR5KSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IERldmVsb3BlckVycm9yKCdtaW5pbXVtTGV2ZWwgbXVzdCBub3QgYmUgY2FsbGVkIGJlZm9yZSB0aGUgaW1hZ2VyeSBwcm92aWRlciBpcyByZWFkeS4nKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAvLz4+aW5jbHVkZUVuZCgnZGVidWcnKTtcclxuXHJcbiAgICAgICAgICAgIHJldHVybiAwO1xyXG4gICAgfSxcclxuXHJcbiAgICAvKipcclxuICAgICAqIEdldHMgdGhlIHRpbGluZyBzY2hlbWUgdXNlZCBieSB0aGlzIHByb3ZpZGVyLiAgVGhpcyBmdW5jdGlvbiBzaG91bGRcclxuICAgICAqIG5vdCBiZSBjYWxsZWQgYmVmb3JlIHtAbGluayBDYW52YXNJbWFnZXJ5UHJvdmlkZXIjcmVhZHl9IHJldHVybnMgdHJ1ZS5cclxuICAgICAqIEBtZW1iZXJvZiBDYW52YXNJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlXHJcbiAgICAgKiBAdHlwZSB7VGlsaW5nU2NoZW1lfVxyXG4gICAgICogQHJlYWRvbmx5XHJcbiAgICAgKi9cclxuICAgIGdldCB0aWxpbmdTY2hlbWUoKSB7XHJcbiAgICAgICAgICAgIC8vPj5pbmNsdWRlU3RhcnQoJ2RlYnVnJywgcHJhZ21hcy5kZWJ1Zyk7XHJcbiAgICAgICAgICAgIGlmICghdGhpcy5fcmVhZHkpIHtcclxuICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRGV2ZWxvcGVyRXJyb3IoJ3RpbGluZ1NjaGVtZSBtdXN0IG5vdCBiZSBjYWxsZWQgYmVmb3JlIHRoZSBpbWFnZXJ5IHByb3ZpZGVyIGlzIHJlYWR5LicpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIC8vPj5pbmNsdWRlRW5kKCdkZWJ1ZycpO1xyXG5cclxuICAgICAgICAgICAgcmV0dXJuIHRoaXMuX3RpbGluZ1NjaGVtZTtcclxuICAgIH0sXHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZXRzIHRoZSByZWN0YW5nbGUsIGluIHJhZGlhbnMsIG9mIHRoZSBpbWFnZXJ5IHByb3ZpZGVkIGJ5IHRoaXMgaW5zdGFuY2UuICBUaGlzIGZ1bmN0aW9uIHNob3VsZFxyXG4gICAgICogbm90IGJlIGNhbGxlZCBiZWZvcmUge0BsaW5rIENhbnZhc0ltYWdlcnlQcm92aWRlciNyZWFkeX0gcmV0dXJucyB0cnVlLlxyXG4gICAgICogQG1lbWJlcm9mIENhbnZhc0ltYWdlcnlQcm92aWRlci5wcm90b3R5cGVcclxuICAgICAqIEB0eXBlIHtSZWN0YW5nbGV9XHJcbiAgICAgKiBAcmVhZG9ubHlcclxuICAgICAqL1xyXG4gICAgZ2V0IHJlY3RhbmdsZSgpIHtcclxuICAgICAgICAgICAgcmV0dXJuIHRoaXMuX3RpbGluZ1NjaGVtZS5yZWN0YW5nbGU7XHJcbiAgICB9LFxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2V0cyB0aGUgdGlsZSBkaXNjYXJkIHBvbGljeS4gIElmIG5vdCB1bmRlZmluZWQsIHRoZSBkaXNjYXJkIHBvbGljeSBpcyByZXNwb25zaWJsZVxyXG4gICAgICogZm9yIGZpbHRlcmluZyBvdXQgXCJtaXNzaW5nXCIgdGlsZXMgdmlhIGl0cyBzaG91bGREaXNjYXJkSW1hZ2UgZnVuY3Rpb24uICBJZiB0aGlzIGZ1bmN0aW9uXHJcbiAgICAgKiByZXR1cm5zIHVuZGVmaW5lZCwgbm8gdGlsZXMgYXJlIGZpbHRlcmVkLiAgVGhpcyBmdW5jdGlvbiBzaG91bGRcclxuICAgICAqIG5vdCBiZSBjYWxsZWQgYmVmb3JlIHtAbGluayBDYW52YXNJbWFnZXJ5UHJvdmlkZXIjcmVhZHl9IHJldHVybnMgdHJ1ZS5cclxuICAgICAqIEBtZW1iZXJvZiBDYW52YXNJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlXHJcbiAgICAgKiBAdHlwZSB7VGlsZURpc2NhcmRQb2xpY3l9XHJcbiAgICAgKiBAcmVhZG9ubHlcclxuICAgICAqL1xyXG4gICAgZ2V0IHRpbGVEaXNjYXJkUG9saWN5KCkge1xyXG4gICAgICAgICAgICAvLz4+aW5jbHVkZVN0YXJ0KCdkZWJ1ZycsIHByYWdtYXMuZGVidWcpO1xyXG4gICAgICAgICAgICBpZiAoIXRoaXMuX3JlYWR5KSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IERldmVsb3BlckVycm9yKCd0aWxlRGlzY2FyZFBvbGljeSBtdXN0IG5vdCBiZSBjYWxsZWQgYmVmb3JlIHRoZSBpbWFnZXJ5IHByb3ZpZGVyIGlzIHJlYWR5LicpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIC8vPj5pbmNsdWRlRW5kKCdkZWJ1ZycpO1xyXG5cclxuICAgICAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcclxuICAgIH0sXHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZXRzIGFuIGV2ZW50IHRoYXQgaXMgcmFpc2VkIHdoZW4gdGhlIGltYWdlcnkgcHJvdmlkZXIgZW5jb3VudGVycyBhbiBhc3luY2hyb25vdXMgZXJyb3IuICBCeSBzdWJzY3JpYmluZ1xyXG4gICAgICogdG8gdGhlIGV2ZW50LCB5b3Ugd2lsbCBiZSBub3RpZmllZCBvZiB0aGUgZXJyb3IgYW5kIGNhbiBwb3RlbnRpYWxseSByZWNvdmVyIGZyb20gaXQuICBFdmVudCBsaXN0ZW5lcnNcclxuICAgICAqIGFyZSBwYXNzZWQgYW4gaW5zdGFuY2Ugb2Yge0BsaW5rIFRpbGVQcm92aWRlckVycm9yfS5cclxuICAgICAqIEBtZW1iZXJvZiBDYW52YXNJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlXHJcbiAgICAgKiBAdHlwZSB7RXZlbnR9XHJcbiAgICAgKiBAcmVhZG9ubHlcclxuICAgICAqL1xyXG4gICAgZ2V0IGVycm9yRXZlbnQoKSB7XHJcbiAgICAgICAgICAgIHJldHVybiB0aGlzLl9lcnJvckV2ZW50O1xyXG4gICAgfSxcclxuXHJcbiAgICAvKipcclxuICAgICAqIEdldHMgYSB2YWx1ZSBpbmRpY2F0aW5nIHdoZXRoZXIgb3Igbm90IHRoZSBwcm92aWRlciBpcyByZWFkeSBmb3IgdXNlLlxyXG4gICAgICogQG1lbWJlcm9mIENhbnZhc0ltYWdlcnlQcm92aWRlci5wcm90b3R5cGVcclxuICAgICAqIEB0eXBlIHtCb29sZWFufVxyXG4gICAgICogQHJlYWRvbmx5XHJcbiAgICAgKi9cclxuICAgIGdldCByZWFkeSgpIHtcclxuICAgICAgICAgICAgcmV0dXJuIHRoaXMuX3JlYWR5O1xyXG4gICAgfSxcclxuXHJcbiAgICAvKipcclxuICAgICAqIEdldHMgdGhlIGNyZWRpdCB0byBkaXNwbGF5IHdoZW4gdGhpcyBpbWFnZXJ5IHByb3ZpZGVyIGlzIGFjdGl2ZS4gIFR5cGljYWxseSB0aGlzIGlzIHVzZWQgdG8gY3JlZGl0XHJcbiAgICAgKiB0aGUgc291cmNlIG9mIHRoZSBpbWFnZXJ5LiAgVGhpcyBmdW5jdGlvbiBzaG91bGQgbm90IGJlIGNhbGxlZCBiZWZvcmUge0BsaW5rIENhbnZhc0ltYWdlcnlQcm92aWRlciNyZWFkeX0gcmV0dXJucyB0cnVlLlxyXG4gICAgICogQG1lbWJlcm9mIENhbnZhc0ltYWdlcnlQcm92aWRlci5wcm90b3R5cGVcclxuICAgICAqIEB0eXBlIHtDcmVkaXR9XHJcbiAgICAgKiBAcmVhZG9ubHlcclxuICAgICAqL1xyXG4gICAgZ2V0IGNyZWRpdCgpIHtcclxuICAgICAgICAgICAgcmV0dXJuIHRoaXMuX2NyZWRpdDtcclxuICAgIH0sXHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZXRzIGEgdmFsdWUgaW5kaWNhdGluZyB3aGV0aGVyIG9yIG5vdCB0aGUgaW1hZ2VzIHByb3ZpZGVkIGJ5IHRoaXMgaW1hZ2VyeSBwcm92aWRlclxyXG4gICAgICogaW5jbHVkZSBhbiBhbHBoYSBjaGFubmVsLiAgSWYgdGhpcyBwcm9wZXJ0eSBpcyBmYWxzZSwgYW4gYWxwaGEgY2hhbm5lbCwgaWYgcHJlc2VudCwgd2lsbFxyXG4gICAgICogYmUgaWdub3JlZC4gIElmIHRoaXMgcHJvcGVydHkgaXMgdHJ1ZSwgYW55IGltYWdlcyB3aXRob3V0IGFuIGFscGhhIGNoYW5uZWwgd2lsbCBiZSB0cmVhdGVkXHJcbiAgICAgKiBhcyBpZiB0aGVpciBhbHBoYSBpcyAxLjAgZXZlcnl3aGVyZS4gIFdoZW4gdGhpcyBwcm9wZXJ0eSBpcyBmYWxzZSwgbWVtb3J5IHVzYWdlXHJcbiAgICAgKiBhbmQgdGV4dHVyZSB1cGxvYWQgdGltZSBhcmUgcmVkdWNlZC5cclxuICAgICAqIEBtZW1iZXJvZiBDYW52YXNJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlXHJcbiAgICAgKiBAdHlwZSB7Qm9vbGVhbn1cclxuICAgICAqIEByZWFkb25seVxyXG4gICAgICovXHJcbiAgICBnZXQgaGFzQWxwaGFDaGFubmVsKCkge1xyXG4gICAgICAgICAgICByZXR1cm4gdHJ1ZTtcclxuICAgIH1cclxufTtcclxuXHJcbkNhbnZhc0ltYWdlcnlQcm92aWRlci5wcm90b3R5cGUuc2V0UmVjdGFuZ2xlID0gZnVuY3Rpb24gc2V0UmVjdGFuZ2xlKHJlY3RhbmdsZSkge1xyXG4gICAgXHJcbiAgICB0aGlzLl90aWxpbmdTY2hlbWUgPSBuZXcgQ2VzaXVtLkdlb2dyYXBoaWNUaWxpbmdTY2hlbWUoe1xyXG4gICAgICAgIHJlY3RhbmdsZTogcmVjdGFuZ2xlLFxyXG4gICAgICAgIG51bWJlck9mTGV2ZWxaZXJvVGlsZXNYOiAxLFxyXG4gICAgICAgIG51bWJlck9mTGV2ZWxaZXJvVGlsZXNZOiAxXHJcbiAgICB9KTtcclxuICAgIFxyXG4gICAgaWYgKCF0aGlzLl9yZWFkeSkge1xyXG4gICAgICAgIHRoaXMuX3JlYWR5ID0gdHJ1ZTtcclxuICAgICAgICBDZXNpdW0uVGlsZVByb3ZpZGVyRXJyb3IuaGFuZGxlU3VjY2Vzcyh0aGlzLl9lcnJvckV2ZW50KTtcclxuICAgIH1cclxufTtcclxuXHJcbkNhbnZhc0ltYWdlcnlQcm92aWRlci5wcm90b3R5cGUuZ2V0VGlsZVdpZHRoID0gZnVuY3Rpb24gZ2V0VGlsZVdpZHRoKCkge1xyXG4gICAgcmV0dXJuIHRoaXMudGlsZVdpZHRoO1xyXG59O1xyXG5cclxuQ2FudmFzSW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5nZXRUaWxlSGVpZ2h0ID0gZnVuY3Rpb24gZ2V0VGlsZUhlaWdodCgpIHtcclxuICAgIHJldHVybiB0aGlzLnRpbGVIZWlnaHQ7XHJcbn07XHJcblxyXG5DYW52YXNJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlLmdldE1heGltdW1MZXZlbCA9IGZ1bmN0aW9uIGdldE1heGltdW1MZXZlbCgpIHtcclxuICAgIHJldHVybiB0aGlzLm1heGltdW1MZXZlbDtcclxufTtcclxuXHJcbkNhbnZhc0ltYWdlcnlQcm92aWRlci5wcm90b3R5cGUuZ2V0TWluaW11bUxldmVsID0gZnVuY3Rpb24gZ2V0TWluaW11bUxldmVsKCkge1xyXG4gICAgcmV0dXJuIHRoaXMubWluaW11bUxldmVsO1xyXG59O1xyXG5cclxuQ2FudmFzSW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5pc1JlYWR5ID0gZnVuY3Rpb24gaXNSZWFkeSgpIHtcclxuICAgIHJldHVybiB0aGlzLnJlYWR5O1xyXG59O1xyXG5cclxuQ2FudmFzSW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5nZXRDcmVkaXQgPSBmdW5jdGlvbiBnZXRDcmVkaXQoKSB7XHJcbiAgICByZXR1cm4gdGhpcy5jcmVkaXQ7XHJcbn07XHJcblxyXG5DYW52YXNJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlLmdldFJlY3RhbmdsZSA9IGZ1bmN0aW9uIGdldFJlY3RhbmdsZSgpIHtcclxuICAgIHJldHVybiB0aGlzLnRpbGluZ1NjaGVtZS5yZWN0YW5nbGU7XHJcbn07XHJcblxyXG5DYW52YXNJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlLmdldFRpbGluZ1NjaGVtZSA9IGZ1bmN0aW9uIGdldFRpbGluZ1NjaGVtZSgpIHtcclxuICAgIHJldHVybiB0aGlzLnRpbGluZ1NjaGVtZTtcclxufTtcclxuXHJcbkNhbnZhc0ltYWdlcnlQcm92aWRlci5wcm90b3R5cGUuZ2V0VGlsZURpc2NhcmRQb2xpY3kgPSBmdW5jdGlvbiBnZXRUaWxlRGlzY2FyZFBvbGljeSgpIHtcclxuICAgIHJldHVybiB0aGlzLnRpbGVEaXNjYXJkUG9saWN5O1xyXG59O1xyXG5cclxuQ2FudmFzSW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5nZXRFcnJvckV2ZW50ID0gZnVuY3Rpb24gZ2V0RXJyb3JFdmVudCgpIHtcclxuICAgIHJldHVybiB0aGlzLmVycm9yRXZlbnQ7XHJcbn07XHJcblxyXG5DYW52YXNJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlLmdldEhhc0FscGhhQ2hhbm5lbCA9IGZ1bmN0aW9uIGdldEhhc0FscGhhQ2hhbm5lbCgpIHtcclxuICAgIHJldHVybiB0aGlzLmhhc0FscGhhQ2hhbm5lbDtcclxufTtcclxuXHJcbi8qKlxyXG4gKiBHZXRzIHRoZSBjcmVkaXRzIHRvIGJlIGRpc3BsYXllZCB3aGVuIGEgZ2l2ZW4gdGlsZSBpcyBkaXNwbGF5ZWQuXHJcbiAqXHJcbiAqIEBwYXJhbSB7TnVtYmVyfSB4IFRoZSB0aWxlIFggY29vcmRpbmF0ZS5cclxuICogQHBhcmFtIHtOdW1iZXJ9IHkgVGhlIHRpbGUgWSBjb29yZGluYXRlLlxyXG4gKiBAcGFyYW0ge051bWJlcn0gbGV2ZWwgVGhlIHRpbGUgbGV2ZWw7XHJcbiAqIEByZXR1cm5zIHtDcmVkaXRbXX0gVGhlIGNyZWRpdHMgdG8gYmUgZGlzcGxheWVkIHdoZW4gdGhlIHRpbGUgaXMgZGlzcGxheWVkLlxyXG4gKlxyXG4gKiBAZXhjZXB0aW9uIHtEZXZlbG9wZXJFcnJvcn0gPGNvZGU+Z2V0VGlsZUNyZWRpdHM8L2NvZGU+IG11c3Qgbm90IGJlIGNhbGxlZCBiZWZvcmUgdGhlIGltYWdlcnkgcHJvdmlkZXIgaXMgcmVhZHkuXHJcbiAqL1xyXG5DYW52YXNJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlLmdldFRpbGVDcmVkaXRzID0gZnVuY3Rpb24oeCwgeSwgbGV2ZWwpIHtcclxuICAgIHJldHVybiB1bmRlZmluZWQ7XHJcbn07XHJcblxyXG4vKipcclxuICogUmVxdWVzdHMgdGhlIGltYWdlIGZvciBhIGdpdmVuIHRpbGUuICBUaGlzIGZ1bmN0aW9uIHNob3VsZFxyXG4gKiBub3QgYmUgY2FsbGVkIGJlZm9yZSB7QGxpbmsgQ2FudmFzSW1hZ2VyeVByb3ZpZGVyI3JlYWR5fSByZXR1cm5zIHRydWUuXHJcbiAqXHJcbiAqIEBwYXJhbSB7TnVtYmVyfSB4IFRoZSB0aWxlIFggY29vcmRpbmF0ZS5cclxuICogQHBhcmFtIHtOdW1iZXJ9IHkgVGhlIHRpbGUgWSBjb29yZGluYXRlLlxyXG4gKiBAcGFyYW0ge051bWJlcn0gbGV2ZWwgVGhlIHRpbGUgbGV2ZWwuXHJcbiAqIEByZXR1cm5zIHtQcm9taXNlfSBBIHByb21pc2UgZm9yIHRoZSBpbWFnZSB0aGF0IHdpbGwgcmVzb2x2ZSB3aGVuIHRoZSBpbWFnZSBpcyBhdmFpbGFibGUsIG9yXHJcbiAqICAgICAgICAgIHVuZGVmaW5lZCBpZiB0aGVyZSBhcmUgdG9vIG1hbnkgYWN0aXZlIHJlcXVlc3RzIHRvIHRoZSBzZXJ2ZXIsIGFuZCB0aGUgcmVxdWVzdFxyXG4gKiAgICAgICAgICBzaG91bGQgYmUgcmV0cmllZCBsYXRlci4gIFRoZSByZXNvbHZlZCBpbWFnZSBtYXkgYmUgZWl0aGVyIGFuXHJcbiAqICAgICAgICAgIEltYWdlIG9yIGEgQ2FudmFzIERPTSBvYmplY3QuXHJcbiAqXHJcbiAqIEBleGNlcHRpb24ge0RldmVsb3BlckVycm9yfSA8Y29kZT5yZXF1ZXN0SW1hZ2U8L2NvZGU+IG11c3Qgbm90IGJlIGNhbGxlZCBiZWZvcmUgdGhlIGltYWdlcnkgcHJvdmlkZXIgaXMgcmVhZHkuXHJcbiAqL1xyXG5DYW52YXNJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlLnJlcXVlc3RJbWFnZSA9IGZ1bmN0aW9uKHgsIHksIGxldmVsKSB7XHJcbiAgICAvLz4+aW5jbHVkZVN0YXJ0KCdkZWJ1ZycsIHByYWdtYXMuZGVidWcpO1xyXG4gICAgaWYgKCF0aGlzLl9yZWFkeSkge1xyXG4gICAgICAgICAgICB0aHJvdyBuZXcgRGV2ZWxvcGVyRXJyb3IoJ3JlcXVlc3RJbWFnZSBtdXN0IG5vdCBiZSBjYWxsZWQgYmVmb3JlIHRoZSBpbWFnZXJ5IHByb3ZpZGVyIGlzIHJlYWR5LicpO1xyXG4gICAgfVxyXG4gICAgLy8+PmluY2x1ZGVFbmQoJ2RlYnVnJyk7XHJcblxyXG4gICAgcmV0dXJuIHRoaXMuX2NhbnZhcztcclxufTtcclxuXHJcbi8qKlxyXG4gKiBQaWNraW5nIGZlYXR1cmVzIGlzIG5vdCBjdXJyZW50bHkgc3VwcG9ydGVkIGJ5IHRoaXMgaW1hZ2VyeSBwcm92aWRlciwgc28gdGhpcyBmdW5jdGlvbiBzaW1wbHkgcmV0dXJuc1xyXG4gKiB1bmRlZmluZWQuXHJcbiAqXHJcbiAqIEBwYXJhbSB7TnVtYmVyfSB4IFRoZSB0aWxlIFggY29vcmRpbmF0ZS5cclxuICogQHBhcmFtIHtOdW1iZXJ9IHkgVGhlIHRpbGUgWSBjb29yZGluYXRlLlxyXG4gKiBAcGFyYW0ge051bWJlcn0gbGV2ZWwgVGhlIHRpbGUgbGV2ZWwuXHJcbiAqIEBwYXJhbSB7TnVtYmVyfSBsb25naXR1ZGUgVGhlIGxvbmdpdHVkZSBhdCB3aGljaCB0byBwaWNrIGZlYXR1cmVzLlxyXG4gKiBAcGFyYW0ge051bWJlcn0gbGF0aXR1ZGUgIFRoZSBsYXRpdHVkZSBhdCB3aGljaCB0byBwaWNrIGZlYXR1cmVzLlxyXG4gKiBAcmV0dXJuIHtQcm9taXNlfSBBIHByb21pc2UgZm9yIHRoZSBwaWNrZWQgZmVhdHVyZXMgdGhhdCB3aWxsIHJlc29sdmUgd2hlbiB0aGUgYXN5bmNocm9ub3VzXHJcbiAqICAgICAgICAgICAgICAgICAgIHBpY2tpbmcgY29tcGxldGVzLiAgVGhlIHJlc29sdmVkIHZhbHVlIGlzIGFuIGFycmF5IG9mIHtAbGluayBJbWFnZXJ5TGF5ZXJGZWF0dXJlSW5mb31cclxuICogICAgICAgICAgICAgICAgICAgaW5zdGFuY2VzLiAgVGhlIGFycmF5IG1heSBiZSBlbXB0eSBpZiBubyBmZWF0dXJlcyBhcmUgZm91bmQgYXQgdGhlIGdpdmVuIGxvY2F0aW9uLlxyXG4gKiAgICAgICAgICAgICAgICAgICBJdCBtYXkgYWxzbyBiZSB1bmRlZmluZWQgaWYgcGlja2luZyBpcyBub3Qgc3VwcG9ydGVkLlxyXG4gKi9cclxuQ2FudmFzSW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5waWNrRmVhdHVyZXMgPSBmdW5jdGlvbigpIHtcclxuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xyXG59OyIsIid1c2Ugc3RyaWN0JztcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyO1xyXG5cclxudmFyIFdvcmtlclByb3h5SW1hZ2VEZWNvZGVyID0gcmVxdWlyZSgnd29ya2VycHJveHlpbWFnZWRlY29kZXIuanMnKTtcclxudmFyIGNhbGN1bGF0ZUNlc2l1bUZydXN0dW0gPSByZXF1aXJlKCdfY2VzaXVtZnJ1c3R1bWNhbGN1bGF0b3IuanMnKTtcclxudmFyIGltYWdlSGVscGVyRnVuY3Rpb25zID0gcmVxdWlyZSgnaW1hZ2VoZWxwZXJmdW5jdGlvbnMuanMnKTtcclxuXHJcbi8qIGdsb2JhbCBDZXNpdW06IGZhbHNlICovXHJcbi8qIGdsb2JhbCBEZXZlbG9wZXJFcnJvcjogZmFsc2UgKi9cclxuLyogZ2xvYmFsIENyZWRpdDogZmFsc2UgKi9cclxuLyogZ2xvYmFsIFByb21pc2U6IGZhbHNlICovXHJcblxyXG4vKipcclxuICogUHJvdmlkZXMgYSBJbWFnZURlY29kZXIgY2xpZW50IGltYWdlcnkgdGlsZS4gIFRoZSBpbWFnZSBpcyBhc3N1bWVkIHRvIHVzZSBhXHJcbiAqIHtAbGluayBHZW9ncmFwaGljVGlsaW5nU2NoZW1lfS5cclxuICpcclxuICogQGFsaWFzIEltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlclxyXG4gKiBAY29uc3RydWN0b3JcclxuICpcclxuICogQHBhcmFtIHtPYmplY3R9IG9wdGlvbnMgT2JqZWN0IHdpdGggdGhlIGZvbGxvd2luZyBwcm9wZXJ0aWVzOlxyXG4gKiBAcGFyYW0ge1N0cmluZ30gb3B0aW9ucy51cmwgVGhlIHVybCBmb3IgdGhlIHRpbGUuXHJcbiAqIEBwYXJhbSB7UmVjdGFuZ2xlfSBbb3B0aW9ucy5yZWN0YW5nbGU9UmVjdGFuZ2xlLk1BWF9WQUxVRV0gVGhlIHJlY3RhbmdsZSwgaW4gcmFkaWFucywgY292ZXJlZCBieSB0aGUgaW1hZ2UuXHJcbiAqIEBwYXJhbSB7Q3JlZGl0fFN0cmluZ30gW29wdGlvbnMuY3JlZGl0XSBBIGNyZWRpdCBmb3IgdGhlIGRhdGEgc291cmNlLCB3aGljaCBpcyBkaXNwbGF5ZWQgb24gdGhlIGNhbnZhcy5cclxuICogQHBhcmFtIHtPYmplY3R9IFtvcHRpb25zLnByb3h5XSBBIHByb3h5IHRvIHVzZSBmb3IgcmVxdWVzdHMuIFRoaXMgb2JqZWN0IGlzIGV4cGVjdGVkIHRvIGhhdmUgYSBnZXRVUkwgZnVuY3Rpb24gd2hpY2ggcmV0dXJucyB0aGUgcHJveGllZCBVUkwsIGlmIG5lZWRlZC5cclxuICogQHBhcmFtIHtib29sZWFufSBbb3B0aW9ucy5hZGFwdFByb3BvcnRpb25zXSBkZXRlcm1pbmVzIGlmIHRvIGFkYXB0IHRoZSBwcm9wb3J0aW9ucyBvZiB0aGUgcmVjdGFuZ2xlIHByb3ZpZGVkIHRvIHRoZSBpbWFnZSBwaXhlbHMgcHJvcG9ydGlvbnMuXHJcbiAqXHJcbiAqIEBzZWUgQXJjR2lzTWFwU2VydmVySW1hZ2VyeVByb3ZpZGVyXHJcbiAqIEBzZWUgQmluZ01hcHNJbWFnZXJ5UHJvdmlkZXJcclxuICogQHNlZSBHb29nbGVFYXJ0aEltYWdlcnlQcm92aWRlclxyXG4gKiBAc2VlIE9wZW5TdHJlZXRNYXBJbWFnZXJ5UHJvdmlkZXJcclxuICogQHNlZSBUaWxlTWFwU2VydmljZUltYWdlcnlQcm92aWRlclxyXG4gKiBAc2VlIFdlYk1hcFNlcnZpY2VJbWFnZXJ5UHJvdmlkZXJcclxuICovXHJcbmZ1bmN0aW9uIEltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlcihkZWNvZGVyLCBvcHRpb25zKSB7XHJcbiAgICB2YXIgdXJsID0gb3B0aW9ucy51cmw7XHJcbiAgICB0aGlzLl9hZGFwdFByb3BvcnRpb25zID0gb3B0aW9ucy5hZGFwdFByb3BvcnRpb25zO1xyXG4gICAgdGhpcy5fcmVjdGFuZ2xlID0gb3B0aW9ucy5yZWN0YW5nbGU7XHJcbiAgICB0aGlzLl9wcm94eSA9IG9wdGlvbnMucHJveHk7XHJcbiAgICB0aGlzLl91cGRhdGVGcnVzdHVtSW50ZXJ2YWwgPSAxMDAwIHx8IG9wdGlvbnMudXBkYXRlRnJ1c3R1bUludGVydmFsO1xyXG4gICAgdGhpcy5fY3JlZGl0ID0gb3B0aW9ucy5jcmVkaXQ7XHJcbiAgICBcclxuICAgIGlmICh0eXBlb2YgdGhpcy5fY3JlZGl0ID09PSAnc3RyaW5nJykge1xyXG4gICAgICAgIHRoaXMuX2NyZWRpdCA9IG5ldyBDcmVkaXQodGhpcy5fY3JlZGl0KTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgaWYgKHRoaXMuX3JlY3RhbmdsZSA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgdGhpcy5fcmVjdGFuZ2xlID0gQ2VzaXVtLlJlY3RhbmdsZS5mcm9tRGVncmVlcygtMTgwLCAtOTAsIDE4MCwgOTApO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBpZiAodGhpcy5fYWRhcHRQcm9wb3J0aW9ucyA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgdGhpcy5fYWRhcHRQcm9wb3J0aW9ucyA9IHRydWU7XHJcbiAgICB9XHJcblxyXG4gICAgb3B0aW9ucyA9IEpTT04ucGFyc2UoSlNPTi5zdHJpbmdpZnkob3B0aW9ucyB8fCB7fSkpO1xyXG4gICAgb3B0aW9ucy5jYXJ0b2dyYXBoaWNCb3VuZHMgPSB7XHJcbiAgICAgICAgd2VzdDogdGhpcy5fcmVjdGFuZ2xlLndlc3QsXHJcbiAgICAgICAgZWFzdDogdGhpcy5fcmVjdGFuZ2xlLmVhc3QsXHJcbiAgICAgICAgc291dGg6IHRoaXMuX3JlY3RhbmdsZS5zb3V0aCxcclxuICAgICAgICBub3J0aDogdGhpcy5fcmVjdGFuZ2xlLm5vcnRoXHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICAvLz4+aW5jbHVkZVN0YXJ0KCdkZWJ1ZycsIHByYWdtYXMuZGVidWcpO1xyXG4gICAgaWYgKHVybCA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgICAgIHRocm93IG5ldyBEZXZlbG9wZXJFcnJvcigndXJsIGlzIHJlcXVpcmVkLicpO1xyXG4gICAgfVxyXG4gICAgLy8+PmluY2x1ZGVFbmQoJ2RlYnVnJyk7XHJcblxyXG4gICAgdGhpcy5fdXJsID0gdXJsO1xyXG5cclxuICAgIHRoaXMuX3RpbGluZ1NjaGVtZSA9IHVuZGVmaW5lZDtcclxuXHJcbiAgICB0aGlzLl90aWxlV2lkdGggPSAwO1xyXG4gICAgdGhpcy5fdGlsZUhlaWdodCA9IDA7XHJcblxyXG4gICAgdGhpcy5fZXJyb3JFdmVudCA9IG5ldyBFdmVudCgnSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyU3RhdHVzJyk7XHJcblxyXG4gICAgdGhpcy5fcmVhZHkgPSBmYWxzZTtcclxuICAgIHRoaXMuX2V4Y2VwdGlvbkNhbGxiYWNrID0gbnVsbDtcclxuICAgIHRoaXMuX2Nlc2l1bVdpZGdldCA9IG51bGw7XHJcbiAgICB0aGlzLl91cGRhdGVGcnVzdHVtSW50ZXJ2YWxIYW5kbGUgPSBudWxsO1xyXG4gICAgXHJcblxyXG4gICAgdmFyIGltYWdlVXJsID0gdXJsO1xyXG4gICAgaWYgKHRoaXMuX3Byb3h5ICE9PSB1bmRlZmluZWQpIHtcclxuICAgICAgICAvLyBOT1RFOiBJcyB0aGF0IHRoZSBjb3JyZWN0IGxvZ2ljP1xyXG4gICAgICAgIGltYWdlVXJsID0gdGhpcy5fcHJveHkuZ2V0VVJMKGltYWdlVXJsKTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgdGhpcy5fZGVjb2RlciA9IGRlY29kZXI7XHJcblx0dGhpcy5faW1hZ2UgPSBkZWNvZGVyLmdldEltYWdlKCk7XHJcblxyXG4gICAgLypcclxuICAgIHRoaXMuX2RlY29kZXIgPSBuZXcgV29ya2VyUHJveHlJbWFnZURlY29kZXIoaW1hZ2VJbXBsZW1lbnRhdGlvbkNsYXNzTmFtZSwge1xyXG4gICAgICAgIHNlcnZlclJlcXVlc3RQcmlvcml0aXplcjogJ2ZydXN0dW0nLFxyXG4gICAgICAgIGRlY29kZVByaW9yaXRpemVyOiAnZnJ1c3R1bSdcclxuICAgIH0pOyovXHJcblxyXG4gICAgdGhpcy5fdXJsID0gaW1hZ2VVcmw7XHJcbn1cclxuXHJcbkltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlci5wcm90b3R5cGUgPSB7XHJcbiAgICAvKipcclxuICAgICAqIEdldHMgdGhlIFVSTCBvZiB0aGUgSW1hZ2VEZWNvZGVyIHNlcnZlciAoaW5jbHVkaW5nIHRhcmdldCkuXHJcbiAgICAgKiBAbWVtYmVyb2YgSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZVxyXG4gICAgICogQHR5cGUge1N0cmluZ31cclxuICAgICAqIEByZWFkb25seVxyXG4gICAgICovXHJcbiAgICBnZXQgdXJsKCkge1xyXG4gICAgICAgIHJldHVybiB0aGlzLl91cmw7XHJcbiAgICB9LFxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2V0cyB0aGUgcHJveHkgdXNlZCBieSB0aGlzIHByb3ZpZGVyLlxyXG4gICAgICogQG1lbWJlcm9mIEltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlci5wcm90b3R5cGVcclxuICAgICAqIEB0eXBlIHtQcm94eX1cclxuICAgICAqIEByZWFkb25seVxyXG4gICAgICovXHJcbiAgICBnZXQgcHJveHkoKSB7XHJcbiAgICAgICAgcmV0dXJuIHRoaXMuX3Byb3h5O1xyXG4gICAgfSxcclxuXHJcbiAgICAvKipcclxuICAgICAqIEdldHMgdGhlIHdpZHRoIG9mIGVhY2ggdGlsZSwgaW4gcGl4ZWxzLiBUaGlzIGZ1bmN0aW9uIHNob3VsZFxyXG4gICAgICogbm90IGJlIGNhbGxlZCBiZWZvcmUge0BsaW5rIEltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlciNyZWFkeX0gcmV0dXJucyB0cnVlLlxyXG4gICAgICogQG1lbWJlcm9mIEltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlci5wcm90b3R5cGVcclxuICAgICAqIEB0eXBlIHtOdW1iZXJ9XHJcbiAgICAgKiBAcmVhZG9ubHlcclxuICAgICAqL1xyXG4gICAgZ2V0IHRpbGVXaWR0aCgpIHtcclxuICAgICAgICAvLz4+aW5jbHVkZVN0YXJ0KCdkZWJ1ZycsIHByYWdtYXMuZGVidWcpO1xyXG4gICAgICAgIGlmICghdGhpcy5fcmVhZHkpIHtcclxuICAgICAgICAgICAgICAgIHRocm93IG5ldyBEZXZlbG9wZXJFcnJvcigndGlsZVdpZHRoIG11c3Qgbm90IGJlIGNhbGxlZCBiZWZvcmUgdGhlIGltYWdlcnkgcHJvdmlkZXIgaXMgcmVhZHkuJyk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIC8vPj5pbmNsdWRlRW5kKCdkZWJ1ZycpO1xyXG5cclxuICAgICAgICByZXR1cm4gdGhpcy5fdGlsZVdpZHRoO1xyXG4gICAgfSxcclxuXHJcbiAgICAvKipcclxuICAgICAqIEdldHMgdGhlIGhlaWdodCBvZiBlYWNoIHRpbGUsIGluIHBpeGVscy4gIFRoaXMgZnVuY3Rpb24gc2hvdWxkXHJcbiAgICAgKiBub3QgYmUgY2FsbGVkIGJlZm9yZSB7QGxpbmsgSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyI3JlYWR5fSByZXR1cm5zIHRydWUuXHJcbiAgICAgKiBAbWVtYmVyb2YgSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZVxyXG4gICAgICogQHR5cGUge051bWJlcn1cclxuICAgICAqIEByZWFkb25seVxyXG4gICAgICovXHJcbiAgICBnZXQgdGlsZUhlaWdodCgpIHtcclxuICAgICAgICAvLz4+aW5jbHVkZVN0YXJ0KCdkZWJ1ZycsIHByYWdtYXMuZGVidWcpO1xyXG4gICAgICAgIGlmICghdGhpcy5fcmVhZHkpIHtcclxuICAgICAgICAgICAgICAgIHRocm93IG5ldyBEZXZlbG9wZXJFcnJvcigndGlsZUhlaWdodCBtdXN0IG5vdCBiZSBjYWxsZWQgYmVmb3JlIHRoZSBpbWFnZXJ5IHByb3ZpZGVyIGlzIHJlYWR5LicpO1xyXG4gICAgICAgIH1cclxuICAgICAgICAvLz4+aW5jbHVkZUVuZCgnZGVidWcnKTtcclxuXHJcbiAgICAgICAgcmV0dXJuIHRoaXMuX3RpbGVIZWlnaHQ7XHJcbiAgICB9LFxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2V0cyB0aGUgbWF4aW11bSBsZXZlbC1vZi1kZXRhaWwgdGhhdCBjYW4gYmUgcmVxdWVzdGVkLiAgVGhpcyBmdW5jdGlvbiBzaG91bGRcclxuICAgICAqIG5vdCBiZSBjYWxsZWQgYmVmb3JlIHtAbGluayBJbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIjcmVhZHl9IHJldHVybnMgdHJ1ZS5cclxuICAgICAqIEBtZW1iZXJvZiBJbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlXHJcbiAgICAgKiBAdHlwZSB7TnVtYmVyfVxyXG4gICAgICogQHJlYWRvbmx5XHJcbiAgICAgKi9cclxuICAgIGdldCBtYXhpbXVtTGV2ZWwoKSB7XHJcbiAgICAgICAgLy8+PmluY2x1ZGVTdGFydCgnZGVidWcnLCBwcmFnbWFzLmRlYnVnKTtcclxuICAgICAgICBpZiAoIXRoaXMuX3JlYWR5KSB7XHJcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRGV2ZWxvcGVyRXJyb3IoJ21heGltdW1MZXZlbCBtdXN0IG5vdCBiZSBjYWxsZWQgYmVmb3JlIHRoZSBpbWFnZXJ5IHByb3ZpZGVyIGlzIHJlYWR5LicpO1xyXG4gICAgICAgIH1cclxuICAgICAgICAvLz4+aW5jbHVkZUVuZCgnZGVidWcnKTtcclxuXHJcbiAgICAgICAgcmV0dXJuIHRoaXMuX251bVJlc29sdXRpb25MZXZlbHMgLSAxO1xyXG4gICAgfSxcclxuXHJcbiAgICAvKipcclxuICAgICAqIEdldHMgdGhlIG1pbmltdW0gbGV2ZWwtb2YtZGV0YWlsIHRoYXQgY2FuIGJlIHJlcXVlc3RlZC4gIFRoaXMgZnVuY3Rpb24gc2hvdWxkXHJcbiAgICAgKiBub3QgYmUgY2FsbGVkIGJlZm9yZSB7QGxpbmsgSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyI3JlYWR5fSByZXR1cm5zIHRydWUuXHJcbiAgICAgKiBAbWVtYmVyb2YgSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZVxyXG4gICAgICogQHR5cGUge051bWJlcn1cclxuICAgICAqIEByZWFkb25seVxyXG4gICAgICovXHJcbiAgICBnZXQgbWluaW11bUxldmVsKCkge1xyXG4gICAgICAgIC8vPj5pbmNsdWRlU3RhcnQoJ2RlYnVnJywgcHJhZ21hcy5kZWJ1Zyk7XHJcbiAgICAgICAgaWYgKCF0aGlzLl9yZWFkeSkge1xyXG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IERldmVsb3BlckVycm9yKCdtaW5pbXVtTGV2ZWwgbXVzdCBub3QgYmUgY2FsbGVkIGJlZm9yZSB0aGUgaW1hZ2VyeSBwcm92aWRlciBpcyByZWFkeS4nKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgLy8+PmluY2x1ZGVFbmQoJ2RlYnVnJyk7XHJcblxyXG4gICAgICAgIHJldHVybiAwO1xyXG4gICAgfSxcclxuXHJcbiAgICAvKipcclxuICAgICAqIEdldHMgdGhlIHRpbGluZyBzY2hlbWUgdXNlZCBieSB0aGlzIHByb3ZpZGVyLiAgVGhpcyBmdW5jdGlvbiBzaG91bGRcclxuICAgICAqIG5vdCBiZSBjYWxsZWQgYmVmb3JlIHtAbGluayBJbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIjcmVhZHl9IHJldHVybnMgdHJ1ZS5cclxuICAgICAqIEBtZW1iZXJvZiBJbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlXHJcbiAgICAgKiBAdHlwZSB7VGlsaW5nU2NoZW1lfVxyXG4gICAgICogQHJlYWRvbmx5XHJcbiAgICAgKi9cclxuICAgIGdldCB0aWxpbmdTY2hlbWUoKSB7XHJcbiAgICAgICAgLy8+PmluY2x1ZGVTdGFydCgnZGVidWcnLCBwcmFnbWFzLmRlYnVnKTtcclxuICAgICAgICBpZiAoIXRoaXMuX3JlYWR5KSB7XHJcbiAgICAgICAgICAgIHRocm93IG5ldyBEZXZlbG9wZXJFcnJvcigndGlsaW5nU2NoZW1lIG11c3Qgbm90IGJlIGNhbGxlZCBiZWZvcmUgdGhlIGltYWdlcnkgcHJvdmlkZXIgaXMgcmVhZHkuJyk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIC8vPj5pbmNsdWRlRW5kKCdkZWJ1ZycpO1xyXG5cclxuICAgICAgICByZXR1cm4gdGhpcy5fdGlsaW5nU2NoZW1lO1xyXG4gICAgfSxcclxuXHJcbiAgICAvKipcclxuICAgICAqIEdldHMgdGhlIHJlY3RhbmdsZSwgaW4gcmFkaWFucywgb2YgdGhlIGltYWdlcnkgcHJvdmlkZWQgYnkgdGhpcyBpbnN0YW5jZS4gIFRoaXMgZnVuY3Rpb24gc2hvdWxkXHJcbiAgICAgKiBub3QgYmUgY2FsbGVkIGJlZm9yZSB7QGxpbmsgSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyI3JlYWR5fSByZXR1cm5zIHRydWUuXHJcbiAgICAgKiBAbWVtYmVyb2YgSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZVxyXG4gICAgICogQHR5cGUge1JlY3RhbmdsZX1cclxuICAgICAqIEByZWFkb25seVxyXG4gICAgICovXHJcbiAgICBnZXQgcmVjdGFuZ2xlKCkge1xyXG4gICAgICAgIHJldHVybiB0aGlzLl90aWxpbmdTY2hlbWUucmVjdGFuZ2xlO1xyXG4gICAgfSxcclxuXHJcbiAgICAvKipcclxuICAgICAqIEdldHMgdGhlIHRpbGUgZGlzY2FyZCBwb2xpY3kuICBJZiBub3QgdW5kZWZpbmVkLCB0aGUgZGlzY2FyZCBwb2xpY3kgaXMgcmVzcG9uc2libGVcclxuICAgICAqIGZvciBmaWx0ZXJpbmcgb3V0IFwibWlzc2luZ1wiIHRpbGVzIHZpYSBpdHMgc2hvdWxkRGlzY2FyZEltYWdlIGZ1bmN0aW9uLiAgSWYgdGhpcyBmdW5jdGlvblxyXG4gICAgICogcmV0dXJucyB1bmRlZmluZWQsIG5vIHRpbGVzIGFyZSBmaWx0ZXJlZC4gIFRoaXMgZnVuY3Rpb24gc2hvdWxkXHJcbiAgICAgKiBub3QgYmUgY2FsbGVkIGJlZm9yZSB7QGxpbmsgSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyI3JlYWR5fSByZXR1cm5zIHRydWUuXHJcbiAgICAgKiBAbWVtYmVyb2YgSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZVxyXG4gICAgICogQHR5cGUge1RpbGVEaXNjYXJkUG9saWN5fVxyXG4gICAgICogQHJlYWRvbmx5XHJcbiAgICAgKi9cclxuICAgIGdldCB0aWxlRGlzY2FyZFBvbGljeSgpIHtcclxuICAgICAgICAvLz4+aW5jbHVkZVN0YXJ0KCdkZWJ1ZycsIHByYWdtYXMuZGVidWcpO1xyXG4gICAgICAgIGlmICghdGhpcy5fcmVhZHkpIHtcclxuICAgICAgICAgICAgdGhyb3cgbmV3IERldmVsb3BlckVycm9yKCd0aWxlRGlzY2FyZFBvbGljeSBtdXN0IG5vdCBiZSBjYWxsZWQgYmVmb3JlIHRoZSBpbWFnZXJ5IHByb3ZpZGVyIGlzIHJlYWR5LicpO1xyXG4gICAgICAgIH1cclxuICAgICAgICAvLz4+aW5jbHVkZUVuZCgnZGVidWcnKTtcclxuXHJcbiAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcclxuICAgIH0sXHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZXRzIGFuIGV2ZW50IHRoYXQgaXMgcmFpc2VkIHdoZW4gdGhlIGltYWdlcnkgcHJvdmlkZXIgZW5jb3VudGVycyBhbiBhc3luY2hyb25vdXMgZXJyb3IuICBCeSBzdWJzY3JpYmluZ1xyXG4gICAgICogdG8gdGhlIGV2ZW50LCB5b3Ugd2lsbCBiZSBub3RpZmllZCBvZiB0aGUgZXJyb3IgYW5kIGNhbiBwb3RlbnRpYWxseSByZWNvdmVyIGZyb20gaXQuICBFdmVudCBsaXN0ZW5lcnNcclxuICAgICAqIGFyZSBwYXNzZWQgYW4gaW5zdGFuY2Ugb2Yge0BsaW5rIFRpbGVQcm92aWRlckVycm9yfS5cclxuICAgICAqIEBtZW1iZXJvZiBJbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlXHJcbiAgICAgKiBAdHlwZSB7RXZlbnR9XHJcbiAgICAgKiBAcmVhZG9ubHlcclxuICAgICAqL1xyXG4gICAgZ2V0IGVycm9yRXZlbnQoKSB7XHJcbiAgICAgICAgcmV0dXJuIHRoaXMuX2Vycm9yRXZlbnQ7XHJcbiAgICB9LFxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2V0cyBhIHZhbHVlIGluZGljYXRpbmcgd2hldGhlciBvciBub3QgdGhlIHByb3ZpZGVyIGlzIHJlYWR5IGZvciB1c2UuXHJcbiAgICAgKiBAbWVtYmVyb2YgSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZVxyXG4gICAgICogQHR5cGUge0Jvb2xlYW59XHJcbiAgICAgKiBAcmVhZG9ubHlcclxuICAgICAqL1xyXG4gICAgZ2V0IHJlYWR5KCkge1xyXG4gICAgICAgIHJldHVybiB0aGlzLl9yZWFkeTtcclxuICAgIH0sXHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZXRzIHRoZSBjcmVkaXQgdG8gZGlzcGxheSB3aGVuIHRoaXMgaW1hZ2VyeSBwcm92aWRlciBpcyBhY3RpdmUuICBUeXBpY2FsbHkgdGhpcyBpcyB1c2VkIHRvIGNyZWRpdFxyXG4gICAgICogdGhlIHNvdXJjZSBvZiB0aGUgaW1hZ2VyeS4gIFRoaXMgZnVuY3Rpb24gc2hvdWxkIG5vdCBiZSBjYWxsZWQgYmVmb3JlIHtAbGluayBJbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIjcmVhZHl9IHJldHVybnMgdHJ1ZS5cclxuICAgICAqIEBtZW1iZXJvZiBJbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlXHJcbiAgICAgKiBAdHlwZSB7Q3JlZGl0fVxyXG4gICAgICogQHJlYWRvbmx5XHJcbiAgICAgKi9cclxuICAgIGdldCBjcmVkaXQoKSB7XHJcbiAgICAgICAgcmV0dXJuIHRoaXMuX2NyZWRpdDtcclxuICAgIH0sXHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZXRzIGEgdmFsdWUgaW5kaWNhdGluZyB3aGV0aGVyIG9yIG5vdCB0aGUgaW1hZ2VzIHByb3ZpZGVkIGJ5IHRoaXMgaW1hZ2VyeSBwcm92aWRlclxyXG4gICAgICogaW5jbHVkZSBhbiBhbHBoYSBjaGFubmVsLiAgSWYgdGhpcyBwcm9wZXJ0eSBpcyBmYWxzZSwgYW4gYWxwaGEgY2hhbm5lbCwgaWYgcHJlc2VudCwgd2lsbFxyXG4gICAgICogYmUgaWdub3JlZC4gIElmIHRoaXMgcHJvcGVydHkgaXMgdHJ1ZSwgYW55IGltYWdlcyB3aXRob3V0IGFuIGFscGhhIGNoYW5uZWwgd2lsbCBiZSB0cmVhdGVkXHJcbiAgICAgKiBhcyBpZiB0aGVpciBhbHBoYSBpcyAxLjAgZXZlcnl3aGVyZS4gIFdoZW4gdGhpcyBwcm9wZXJ0eSBpcyBmYWxzZSwgbWVtb3J5IHVzYWdlXHJcbiAgICAgKiBhbmQgdGV4dHVyZSB1cGxvYWQgdGltZSBhcmUgcmVkdWNlZC5cclxuICAgICAqIEBtZW1iZXJvZiBJbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlXHJcbiAgICAgKiBAdHlwZSB7Qm9vbGVhbn1cclxuICAgICAqIEByZWFkb25seVxyXG4gICAgICovXHJcbiAgICBnZXQgaGFzQWxwaGFDaGFubmVsKCkge1xyXG4gICAgICAgIHJldHVybiB0cnVlO1xyXG4gICAgfVxyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5zZXRFeGNlcHRpb25DYWxsYmFjayA9XHJcbiAgICBmdW5jdGlvbiBzZXRFeGNlcHRpb25DYWxsYmFjayhleGNlcHRpb25DYWxsYmFjaykge1xyXG4gICAgXHJcbiAgICB0aGlzLl9leGNlcHRpb25DYWxsYmFjayA9IGV4Y2VwdGlvbkNhbGxiYWNrO1xyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5vcGVuID0gZnVuY3Rpb24gb3Blbih3aWRnZXRPclZpZXdlcikge1xyXG4gICAgaWYgKHRoaXMuX3VwZGF0ZUZydXN0dW1JbnRlcnZhbEhhbmRsZSAhPT0gbnVsbCkge1xyXG4gICAgICAgIHRocm93IG5ldyBEZXZlbG9wZXJFcnJvcignQ2Fubm90IHNldCB0d28gcGFyZW50IHZpZXdlcnMuJyk7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGlmICh3aWRnZXRPclZpZXdlciA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgdGhyb3cgbmV3IERldmVsb3BlckVycm9yKCd3aWRnZXRPclZpZXdlciBzaG91bGQgYmUgZ2l2ZW4uIEl0IGlzICcgK1xyXG4gICAgICAgICAgICAnbmVlZGVkIGZvciBmcnVzdHVtIGNhbGN1bGF0aW9uIGZvciB0aGUgcHJpb3JpdHkgbWVjaGFuaXNtJyk7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHRoaXMuX2RlY29kZXIub3Blbih0aGlzLl91cmwpXHJcblx0XHQudGhlbih0aGlzLl9vcGVuZWQuYmluZCh0aGlzKSlcclxuXHRcdC5jYXRjaCh0aGlzLl9vbkV4Y2VwdGlvbi5iaW5kKHRoaXMpKTtcclxuICAgIFxyXG4gICAgdGhpcy5fY2VzaXVtV2lkZ2V0ID0gd2lkZ2V0T3JWaWV3ZXI7XHJcbiAgICBcclxuICAgIHRoaXMuX3VwZGF0ZUZydXN0dW1JbnRlcnZhbEhhbmRsZSA9IHNldEludGVydmFsKFxyXG4gICAgICAgIHRoaXMuX3NldFByaW9yaXR5QnlGcnVzdHVtLmJpbmQodGhpcyksXHJcbiAgICAgICAgdGhpcy5fdXBkYXRlRnJ1c3R1bUludGVydmFsKTtcclxufTtcclxuXHJcbkltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlci5wcm90b3R5cGUuY2xvc2UgPSBmdW5jdGlvbiBjbG9zZSgpIHtcclxuICAgIGNsZWFySW50ZXJ2YWwodGhpcy5fdXBkYXRlRnJ1c3R1bUludGVydmFsSGFuZGxlKTtcclxuICAgIHRoaXMuX2RlY29kZXIuY2xvc2UoKTtcclxufTtcclxuXHJcbkltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlci5wcm90b3R5cGUuZ2V0VGlsZVdpZHRoID0gZnVuY3Rpb24gZ2V0VGlsZVdpZHRoKCkge1xyXG4gICAgcmV0dXJuIHRoaXMudGlsZVdpZHRoO1xyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5nZXRUaWxlSGVpZ2h0ID0gZnVuY3Rpb24gZ2V0VGlsZUhlaWdodCgpIHtcclxuICAgIHJldHVybiB0aGlzLnRpbGVIZWlnaHQ7XHJcbn07XHJcblxyXG5JbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlLmdldE1heGltdW1MZXZlbCA9IGZ1bmN0aW9uIGdldE1heGltdW1MZXZlbCgpIHtcclxuICAgIHJldHVybiB0aGlzLm1heGltdW1MZXZlbDtcclxufTtcclxuXHJcbkltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlci5wcm90b3R5cGUuZ2V0TWluaW11bUxldmVsID0gZnVuY3Rpb24gZ2V0TWluaW11bUxldmVsKCkge1xyXG4gICAgcmV0dXJuIHRoaXMubWluaW11bUxldmVsO1xyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5nZXRVcmwgPSBmdW5jdGlvbiBnZXRVcmwoKSB7XHJcbiAgICByZXR1cm4gdGhpcy51cmw7XHJcbn07XHJcblxyXG5JbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlLmdldFByb3h5ID0gZnVuY3Rpb24gZ2V0UHJveHkoKSB7XHJcbiAgICByZXR1cm4gdGhpcy5wcm94eTtcclxufTtcclxuXHJcbkltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlci5wcm90b3R5cGUuaXNSZWFkeSA9IGZ1bmN0aW9uIGlzUmVhZHkoKSB7XHJcbiAgICByZXR1cm4gdGhpcy5yZWFkeTtcclxufTtcclxuXHJcbkltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlci5wcm90b3R5cGUuZ2V0Q3JlZGl0ID0gZnVuY3Rpb24gZ2V0Q3JlZGl0KCkge1xyXG4gICAgcmV0dXJuIHRoaXMuY3JlZGl0O1xyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5nZXRSZWN0YW5nbGUgPSBmdW5jdGlvbiBnZXRSZWN0YW5nbGUoKSB7XHJcbiAgICByZXR1cm4gdGhpcy50aWxpbmdTY2hlbWUucmVjdGFuZ2xlO1xyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5nZXRUaWxpbmdTY2hlbWUgPSBmdW5jdGlvbiBnZXRUaWxpbmdTY2hlbWUoKSB7XHJcbiAgICByZXR1cm4gdGhpcy50aWxpbmdTY2hlbWU7XHJcbn07XHJcblxyXG5JbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlLmdldFRpbGVEaXNjYXJkUG9saWN5ID0gZnVuY3Rpb24gZ2V0VGlsZURpc2NhcmRQb2xpY3koKSB7XHJcbiAgICByZXR1cm4gdGhpcy50aWxlRGlzY2FyZFBvbGljeTtcclxufTtcclxuXHJcbkltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlci5wcm90b3R5cGUuZ2V0RXJyb3JFdmVudCA9IGZ1bmN0aW9uIGdldEVycm9yRXZlbnQoKSB7XHJcbiAgICByZXR1cm4gdGhpcy5lcnJvckV2ZW50O1xyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5nZXRIYXNBbHBoYUNoYW5uZWwgPSBmdW5jdGlvbiBnZXRIYXNBbHBoYUNoYW5uZWwoKSB7XHJcbiAgICByZXR1cm4gdGhpcy5oYXNBbHBoYUNoYW5uZWw7XHJcbn07XHJcblxyXG4vKipcclxuICogR2V0cyB0aGUgY3JlZGl0cyB0byBiZSBkaXNwbGF5ZWQgd2hlbiBhIGdpdmVuIHRpbGUgaXMgZGlzcGxheWVkLlxyXG4gKlxyXG4gKiBAcGFyYW0ge051bWJlcn0geCBUaGUgdGlsZSBYIGNvb3JkaW5hdGUuXHJcbiAqIEBwYXJhbSB7TnVtYmVyfSB5IFRoZSB0aWxlIFkgY29vcmRpbmF0ZS5cclxuICogQHBhcmFtIHtOdW1iZXJ9IGxldmVsIFRoZSB0aWxlIGxldmVsO1xyXG4gKiBAcmV0dXJucyB7Q3JlZGl0W119IFRoZSBjcmVkaXRzIHRvIGJlIGRpc3BsYXllZCB3aGVuIHRoZSB0aWxlIGlzIGRpc3BsYXllZC5cclxuICpcclxuICogQGV4Y2VwdGlvbiB7RGV2ZWxvcGVyRXJyb3J9IDxjb2RlPmdldFRpbGVDcmVkaXRzPC9jb2RlPiBtdXN0IG5vdCBiZSBjYWxsZWQgYmVmb3JlIHRoZSBpbWFnZXJ5IHByb3ZpZGVyIGlzIHJlYWR5LlxyXG4gKi9cclxuSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5nZXRUaWxlQ3JlZGl0cyA9IGZ1bmN0aW9uKHgsIHksIGxldmVsKSB7XHJcbiAgICByZXR1cm4gdW5kZWZpbmVkO1xyXG59O1xyXG5cclxuLyoqXHJcbiAqIFJlcXVlc3RzIHRoZSBpbWFnZSBmb3IgYSBnaXZlbiB0aWxlLiAgVGhpcyBmdW5jdGlvbiBzaG91bGRcclxuICogbm90IGJlIGNhbGxlZCBiZWZvcmUge0BsaW5rIEltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlciNyZWFkeX0gcmV0dXJucyB0cnVlLlxyXG4gKlxyXG4gKiBAcGFyYW0ge051bWJlcn0geCBUaGUgdGlsZSBYIGNvb3JkaW5hdGUuXHJcbiAqIEBwYXJhbSB7TnVtYmVyfSB5IFRoZSB0aWxlIFkgY29vcmRpbmF0ZS5cclxuICogQHBhcmFtIHtOdW1iZXJ9IGxldmVsIFRoZSB0aWxlIGxldmVsLlxyXG4gKiBAcmV0dXJucyB7UHJvbWlzZX0gQSBwcm9taXNlIGZvciB0aGUgaW1hZ2UgdGhhdCB3aWxsIHJlc29sdmUgd2hlbiB0aGUgaW1hZ2UgaXMgYXZhaWxhYmxlLCBvclxyXG4gKiAgICAgICAgICB1bmRlZmluZWQgaWYgdGhlcmUgYXJlIHRvbyBtYW55IGFjdGl2ZSByZXF1ZXN0cyB0byB0aGUgc2VydmVyLCBhbmQgdGhlIHJlcXVlc3RcclxuICogICAgICAgICAgc2hvdWxkIGJlIHJldHJpZWQgbGF0ZXIuICBUaGUgcmVzb2x2ZWQgaW1hZ2UgbWF5IGJlIGVpdGhlciBhblxyXG4gKiAgICAgICAgICBJbWFnZSBvciBhIENhbnZhcyBET00gb2JqZWN0LlxyXG4gKlxyXG4gKiBAZXhjZXB0aW9uIHtEZXZlbG9wZXJFcnJvcn0gPGNvZGU+cmVxdWVzdEltYWdlPC9jb2RlPiBtdXN0IG5vdCBiZSBjYWxsZWQgYmVmb3JlIHRoZSBpbWFnZXJ5IHByb3ZpZGVyIGlzIHJlYWR5LlxyXG4gKi9cclxuSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5yZXF1ZXN0SW1hZ2UgPSBmdW5jdGlvbih4LCB5LCBjZXNpdW1MZXZlbCkge1xyXG4gICAgLy8+PmluY2x1ZGVTdGFydCgnZGVidWcnLCBwcmFnbWFzLmRlYnVnKTtcclxuICAgIGlmICghdGhpcy5fcmVhZHkpIHtcclxuICAgICAgICB0aHJvdyBuZXcgRGV2ZWxvcGVyRXJyb3IoJ3JlcXVlc3RJbWFnZSBtdXN0IG5vdCBiZSBjYWxsZWQgYmVmb3JlIHRoZSBpbWFnZXJ5IHByb3ZpZGVyIGlzIHJlYWR5LicpO1xyXG4gICAgfVxyXG4gICAgLy8+PmluY2x1ZGVFbmQoJ2RlYnVnJyk7XHJcbiAgICBcclxuICAgIHZhciBzZWxmID0gdGhpcztcclxuICAgIFxyXG4gICAgdmFyIGxldmVsRmFjdG9yID0gTWF0aC5wb3coMiwgdGhpcy5fbnVtUmVzb2x1dGlvbkxldmVscyAtIGNlc2l1bUxldmVsIC0gMSk7XHJcbiAgICB2YXIgbWluWCA9IHggKiB0aGlzLl90aWxlV2lkdGggICogbGV2ZWxGYWN0b3I7XHJcbiAgICB2YXIgbWluWSA9IHkgKiB0aGlzLl90aWxlSGVpZ2h0ICogbGV2ZWxGYWN0b3I7XHJcbiAgICB2YXIgbWF4WEV4Y2x1c2l2ZSA9ICh4ICsgMSkgKiB0aGlzLl90aWxlV2lkdGggICogbGV2ZWxGYWN0b3I7XHJcbiAgICB2YXIgbWF4WUV4Y2x1c2l2ZSA9ICh5ICsgMSkgKiB0aGlzLl90aWxlSGVpZ2h0ICogbGV2ZWxGYWN0b3I7XHJcbiAgICBcclxuICAgIHZhciBsZXZlbCA9IGFsaWduZWRQYXJhbXMuaW1hZ2VQYXJ0UGFyYW1zLmxldmVsO1xyXG4gICAgdmFyIGxldmVsV2lkdGggID0gdGhpcy5faW1hZ2UuZ2V0TGV2ZWxXaWR0aChsZXZlbCk7XHJcbiAgICB2YXIgbGV2ZWxIZWlnaHQgPSB0aGlzLl9pbWFnZS5nZXRMZXZlbEhlaWdodChsZXZlbCk7XHJcbiAgICBcclxuICAgIHZhciBhbGlnbmVkUGFyYW1zID0gaW1hZ2VIZWxwZXJGdW5jdGlvbnMuYWxpZ25QYXJhbXNUb1RpbGVzQW5kTGV2ZWwoe1xyXG4gICAgICAgIG1pblg6IG1pblgsXHJcbiAgICAgICAgbWluWTogbWluWSxcclxuICAgICAgICBtYXhYRXhjbHVzaXZlOiBtYXhYRXhjbHVzaXZlLFxyXG4gICAgICAgIG1heFlFeGNsdXNpdmU6IG1heFlFeGNsdXNpdmUsXHJcbiAgICAgICAgbGV2ZWxXaWR0aDogbGV2ZWxXaWR0aCxcclxuICAgICAgICBsZXZlbEhlaWdodDogbGV2ZWxIZWlnaHQsXHJcbiAgICAgICAgc2NyZWVuV2lkdGg6IHRoaXMuX3RpbGVXaWR0aCxcclxuICAgICAgICBzY3JlZW5IZWlnaHQ6IHRoaXMuX3RpbGVIZWlnaHRcclxuICAgIH0sIHRoaXMuX2RlY29kZXIsIHRoaXMuX2ltYWdlKTtcclxuICAgIFxyXG4gICAgdmFyIHNjYWxlZENhbnZhcyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2NhbnZhcycpO1xyXG4gICAgc2NhbGVkQ2FudmFzLndpZHRoID0gdGhpcy5fdGlsZVdpZHRoO1xyXG4gICAgc2NhbGVkQ2FudmFzLmhlaWdodCA9IHRoaXMuX3RpbGVIZWlnaHQ7XHJcbiAgICBcclxuICAgIHZhciBzY2FsZWRDb250ZXh0ID0gc2NhbGVkQ2FudmFzLmdldENvbnRleHQoJzJkJyk7XHJcbiAgICBzY2FsZWRDb250ZXh0LmNsZWFyUmVjdCgwLCAwLCB0aGlzLl90aWxlV2lkdGgsIHRoaXMuX3RpbGVIZWlnaHQpO1xyXG4gICAgXHJcbiAgICB2YXIgdGVtcFBpeGVsV2lkdGggID0gYWxpZ25lZFBhcmFtcy5pbWFnZVBhcnRQYXJhbXMubWF4WEV4Y2x1c2l2ZSAtIGFsaWduZWRQYXJhbXMuaW1hZ2VQYXJ0UGFyYW1zLm1pblg7XHJcbiAgICB2YXIgdGVtcFBpeGVsSGVpZ2h0ID0gYWxpZ25lZFBhcmFtcy5pbWFnZVBhcnRQYXJhbXMubWF4WUV4Y2x1c2l2ZSAtIGFsaWduZWRQYXJhbXMuaW1hZ2VQYXJ0UGFyYW1zLm1pblk7XHJcbiAgICBpZiAodGVtcFBpeGVsV2lkdGggPD0gMCB8fCB0ZW1wUGl4ZWxIZWlnaHQgPD0gMCkge1xyXG4gICAgICAgIHJldHVybiBzY2FsZWRDYW52YXM7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHZhciB0ZW1wQ2FudmFzID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnY2FudmFzJyk7XHJcbiAgICB0ZW1wQ2FudmFzLndpZHRoID0gdGVtcFBpeGVsV2lkdGg7XHJcbiAgICB0ZW1wQ2FudmFzLmhlaWdodCA9IHRlbXBQaXhlbEhlaWdodDtcclxuICAgIHZhciB0ZW1wQ29udGV4dCA9IHRlbXBDYW52YXMuZ2V0Q29udGV4dCgnMmQnKTtcclxuICAgIHRlbXBDb250ZXh0LmNsZWFyUmVjdCgwLCAwLCB0ZW1wUGl4ZWxXaWR0aCwgdGVtcFBpeGVsSGVpZ2h0KTtcclxuICAgIFxyXG4gICAgYWxpZ25lZFBhcmFtcy5pbWFnZVBhcnRQYXJhbXMucXVhbGl0eSA9IHRoaXMuX3F1YWxpdHk7XHJcbiAgICBhbGlnbmVkUGFyYW1zLmltYWdlUGFydFBhcmFtcy5yZXF1ZXN0UHJpb3JpdHlEYXRhID0ge1xyXG4gICAgICAgIGltYWdlUmVjdGFuZ2xlOiB0aGlzLl9yZWN0YW5nbGVcclxuICAgIH07XHJcbiAgICBcclxuICAgIHZhciByZXNvbHZlLCByZWplY3Q7XHJcbiAgICB2YXIgcmVxdWVzdFBpeGVsc1Byb21pc2UgPSBuZXcgUHJvbWlzZShmdW5jdGlvbihyZXNvbHZlXywgcmVqZWN0Xykge1xyXG4gICAgICAgIHJlc29sdmUgPSByZXNvbHZlXztcclxuICAgICAgICByZWplY3QgPSByZWplY3RfO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHNlbGYuX2RlY29kZXIucmVxdWVzdFBpeGVsc1Byb2dyZXNzaXZlKFxyXG4gICAgICAgICAgICBhbGlnbmVkUGFyYW1zLmltYWdlUGFydFBhcmFtcyxcclxuICAgICAgICAgICAgcGl4ZWxzRGVjb2RlZENhbGxiYWNrLFxyXG4gICAgICAgICAgICB0ZXJtaW5hdGVkQ2FsbGJhY2spO1xyXG4gICAgfSk7XHJcbiAgICBcclxuICAgIGZ1bmN0aW9uIHBpeGVsc0RlY29kZWRDYWxsYmFjayhkZWNvZGVkKSB7XHJcbiAgICAgICAgdmFyIHBhcnRpYWxUaWxlV2lkdGggPSBkZWNvZGVkLmltYWdlRGF0YS53aWR0aDtcclxuICAgICAgICB2YXIgcGFydGlhbFRpbGVIZWlnaHQgPSBkZWNvZGVkLmltYWdlRGF0YS5oZWlnaHQ7XHJcblxyXG4gICAgICAgIGlmIChwYXJ0aWFsVGlsZVdpZHRoID4gMCAmJiBwYXJ0aWFsVGlsZUhlaWdodCA+IDApIHtcclxuICAgICAgICAgICAgdGVtcENvbnRleHQucHV0SW1hZ2VEYXRhKFxyXG4gICAgICAgICAgICAgICAgZGVjb2RlZC5pbWFnZURhdGEsXHJcbiAgICAgICAgICAgICAgICBkZWNvZGVkLnhJbk9yaWdpbmFsUmVxdWVzdCxcclxuICAgICAgICAgICAgICAgIGRlY29kZWQueUluT3JpZ2luYWxSZXF1ZXN0KTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgZnVuY3Rpb24gdGVybWluYXRlZENhbGxiYWNrKGlzQWJvcnRlZCkge1xyXG4gICAgICAgIGlmIChpc0Fib3J0ZWQpIHtcclxuICAgICAgICAgICAgcmVqZWN0KCdGZXRjaCByZXF1ZXN0IG9yIGRlY29kZSBhYm9ydGVkJyk7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgc2NhbGVkQ29udGV4dC5kcmF3SW1hZ2UoXHJcbiAgICAgICAgICAgICAgICB0ZW1wQ2FudmFzLFxyXG4gICAgICAgICAgICAgICAgMCwgMCwgdGVtcFBpeGVsV2lkdGgsIHRlbXBQaXhlbEhlaWdodCxcclxuICAgICAgICAgICAgICAgIGFsaWduZWRQYXJhbXMuY3JvcHBlZFNjcmVlbi5taW5YLCBhbGlnbmVkUGFyYW1zLmNyb3BwZWRTY3JlZW4ubWluWSxcclxuICAgICAgICAgICAgICAgIGFsaWduZWRQYXJhbXMuY3JvcHBlZFNjcmVlbi5tYXhYRXhjbHVzaXZlLCBhbGlnbmVkUGFyYW1zLmNyb3BwZWRTY3JlZW4ubWF4WUV4Y2x1c2l2ZSk7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgcmVzb2x2ZShzY2FsZWRDYW52YXMpO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4gcmVxdWVzdFBpeGVsc1Byb21pc2U7XHJcbn07XHJcblxyXG5JbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlLl9zZXRQcmlvcml0eUJ5RnJ1c3R1bSA9XHJcbiAgICBmdW5jdGlvbiBzZXRQcmlvcml0eUJ5RnJ1c3R1bSgpIHtcclxuICAgIFxyXG4gICAgaWYgKCF0aGlzLl9yZWFkeSkge1xyXG4gICAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIFxyXG4gICAgdmFyIGZydXN0dW1EYXRhID0gY2FsY3VsYXRlQ2VzaXVtRnJ1c3R1bShcclxuICAgICAgICB0aGlzLl9jZXNpdW1XaWRnZXQsIHRoaXMpO1xyXG4gICAgXHJcbiAgICBpZiAoZnJ1c3R1bURhdGEgPT09IG51bGwpIHtcclxuICAgICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGZydXN0dW1EYXRhLmltYWdlUmVjdGFuZ2xlID0gdGhpcy5nZXRSZWN0YW5nbGUoKTtcclxuICAgIGZydXN0dW1EYXRhLmV4YWN0bGV2ZWwgPSBudWxsO1xyXG5cclxuICAgIHRoaXMuX2RlY29kZXIuc2V0U2VydmVyUmVxdWVzdFByaW9yaXRpemVyRGF0YShmcnVzdHVtRGF0YSk7XHJcbiAgICB0aGlzLl9kZWNvZGVyLnNldERlY29kZVByaW9yaXRpemVyRGF0YShmcnVzdHVtRGF0YSk7XHJcbn07XHJcblxyXG4vKipcclxuICogUGlja2luZyBmZWF0dXJlcyBpcyBub3QgY3VycmVudGx5IHN1cHBvcnRlZCBieSB0aGlzIGltYWdlcnkgcHJvdmlkZXIsIHNvIHRoaXMgZnVuY3Rpb24gc2ltcGx5IHJldHVybnNcclxuICogdW5kZWZpbmVkLlxyXG4gKlxyXG4gKiBAcGFyYW0ge051bWJlcn0geCBUaGUgdGlsZSBYIGNvb3JkaW5hdGUuXHJcbiAqIEBwYXJhbSB7TnVtYmVyfSB5IFRoZSB0aWxlIFkgY29vcmRpbmF0ZS5cclxuICogQHBhcmFtIHtOdW1iZXJ9IGxldmVsIFRoZSB0aWxlIGxldmVsLlxyXG4gKiBAcGFyYW0ge051bWJlcn0gbG9uZ2l0dWRlIFRoZSBsb25naXR1ZGUgYXQgd2hpY2ggdG8gcGljayBmZWF0dXJlcy5cclxuICogQHBhcmFtIHtOdW1iZXJ9IGxhdGl0dWRlICBUaGUgbGF0aXR1ZGUgYXQgd2hpY2ggdG8gcGljayBmZWF0dXJlcy5cclxuICogQHJldHVybiB7UHJvbWlzZX0gQSBwcm9taXNlIGZvciB0aGUgcGlja2VkIGZlYXR1cmVzIHRoYXQgd2lsbCByZXNvbHZlIHdoZW4gdGhlIGFzeW5jaHJvbm91c1xyXG4gKiAgICAgICAgICAgICAgICAgICBwaWNraW5nIGNvbXBsZXRlcy4gIFRoZSByZXNvbHZlZCB2YWx1ZSBpcyBhbiBhcnJheSBvZiB7QGxpbmsgSW1hZ2VyeUxheWVyRmVhdHVyZUluZm99XHJcbiAqICAgICAgICAgICAgICAgICAgIGluc3RhbmNlcy4gIFRoZSBhcnJheSBtYXkgYmUgZW1wdHkgaWYgbm8gZmVhdHVyZXMgYXJlIGZvdW5kIGF0IHRoZSBnaXZlbiBsb2NhdGlvbi5cclxuICogICAgICAgICAgICAgICAgICAgSXQgbWF5IGFsc28gYmUgdW5kZWZpbmVkIGlmIHBpY2tpbmcgaXMgbm90IHN1cHBvcnRlZC5cclxuICovXHJcbkltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlci5wcm90b3R5cGUucGlja0ZlYXR1cmVzID0gZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcclxufTtcclxuXHJcbkltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlci5wcm90b3R5cGUuX29uRXhjZXB0aW9uID0gZnVuY3Rpb24gb25FeGNlcHRpb24ocmVhc29uKSB7XHJcbiAgICBpZiAodGhpcy5fZXhjZXB0aW9uQ2FsbGJhY2sgIT09IG51bGwpIHtcclxuXHRcdHRoaXMuX2V4Y2VwdGlvbkNhbGxiYWNrKHJlYXNvbik7XHJcbiAgICB9XHJcbn07XHJcblxyXG5JbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlLl9vcGVuZWQgPSBmdW5jdGlvbiBvcGVuZWQoKSB7XHJcbiAgICBpZiAodGhpcy5fcmVhZHkpIHtcclxuICAgICAgICB0aHJvdyAnSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyIGVycm9yOiBvcGVuZWQoKSB3YXMgY2FsbGVkIG1vcmUgdGhhbiBvbmNlISc7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHRoaXMuX3JlYWR5ID0gdHJ1ZTtcclxuXHJcbiAgICAvLyBUaGlzIGlzIHdyb25nIGlmIENPRCBvciBDT0MgZXhpc3RzIGJlc2lkZXMgbWFpbiBoZWFkZXIgQ09EXHJcbiAgICB0aGlzLl9udW1SZXNvbHV0aW9uTGV2ZWxzID0gdGhpcy5fZGVjb2Rlci5nZXROdW1SZXNvbHV0aW9uTGV2ZWxzRm9yTGltaXR0ZWRWaWV3ZXIoKTtcclxuICAgIHRoaXMuX3F1YWxpdHkgPSB0aGlzLl9kZWNvZGVyLmdldEhpZ2hlc3RRdWFsaXR5KCk7XHJcbiAgICB2YXIgbWF4aW11bUNlc2l1bUxldmVsID0gdGhpcy5fbnVtUmVzb2x1dGlvbkxldmVscyAtIDE7XHJcbiAgICAgICAgXHJcbiAgICB0aGlzLl90aWxlV2lkdGggPSB0aGlzLl9kZWNvZGVyLmdldFRpbGVXaWR0aCgpO1xyXG4gICAgdGhpcy5fdGlsZUhlaWdodCA9IHRoaXMuX2RlY29kZXIuZ2V0VGlsZUhlaWdodCgpO1xyXG4gICAgICAgIFxyXG4gICAgdmFyIGJlc3RMZXZlbCA9IHRoaXMuX2RlY29kZXIuZ2V0SW1hZ2VMZXZlbCgpO1xyXG4gICAgdmFyIGJlc3RMZXZlbFdpZHRoICA9IHRoaXMuX2RlY29kZXIuZ2V0SW1hZ2VXaWR0aCAoKTtcclxuICAgIHZhciBiZXN0TGV2ZWxIZWlnaHQgPSB0aGlzLl9kZWNvZGVyLmdldEltYWdlSGVpZ2h0KCk7XHJcbiAgICBcclxuICAgIHZhciBsb3dlc3RMZXZlbFRpbGVzWCA9IE1hdGguY2VpbChiZXN0TGV2ZWxXaWR0aCAgLyB0aGlzLl90aWxlV2lkdGggKSA+PiBtYXhpbXVtQ2VzaXVtTGV2ZWw7XHJcbiAgICB2YXIgbG93ZXN0TGV2ZWxUaWxlc1kgPSBNYXRoLmNlaWwoYmVzdExldmVsSGVpZ2h0IC8gdGhpcy5fdGlsZUhlaWdodCkgPj4gbWF4aW11bUNlc2l1bUxldmVsO1xyXG5cclxuICAgIGltYWdlSGVscGVyRnVuY3Rpb25zLmZpeEJvdW5kcyhcclxuICAgICAgICB0aGlzLl9yZWN0YW5nbGUsXHJcbiAgICAgICAgdGhpcy5fZGVjb2RlcixcclxuICAgICAgICB0aGlzLl9hZGFwdFByb3BvcnRpb25zKTtcclxuICAgIHZhciByZWN0YW5nbGVXaWR0aCAgPSB0aGlzLl9yZWN0YW5nbGUuZWFzdCAgLSB0aGlzLl9yZWN0YW5nbGUud2VzdDtcclxuICAgIHZhciByZWN0YW5nbGVIZWlnaHQgPSB0aGlzLl9yZWN0YW5nbGUubm9ydGggLSB0aGlzLl9yZWN0YW5nbGUuc291dGg7XHJcbiAgICBcclxuICAgIHZhciBiZXN0TGV2ZWxTY2FsZSA9IDEgPDwgbWF4aW11bUNlc2l1bUxldmVsO1xyXG4gICAgdmFyIHBpeGVsc1dpZHRoRm9yQ2VzaXVtICA9IHRoaXMuX3RpbGVXaWR0aCAgKiBsb3dlc3RMZXZlbFRpbGVzWCAqIGJlc3RMZXZlbFNjYWxlO1xyXG4gICAgdmFyIHBpeGVsc0hlaWdodEZvckNlc2l1bSA9IHRoaXMuX3RpbGVIZWlnaHQgKiBsb3dlc3RMZXZlbFRpbGVzWSAqIGJlc3RMZXZlbFNjYWxlO1xyXG4gICAgXHJcbiAgICAvLyBDZXNpdW0gd29ya3Mgd2l0aCBmdWxsIHRpbGVzIG9ubHksIHRodXMgZml4IHRoZSBnZW9ncmFwaGljIGJvdW5kcyBzb1xyXG4gICAgLy8gdGhlIHBpeGVscyBsaWVzIGV4YWN0bHkgb24gdGhlIG9yaWdpbmFsIGJvdW5kc1xyXG4gICAgXHJcbiAgICB2YXIgZ2VvZ3JhcGhpY1dpZHRoRm9yQ2VzaXVtID1cclxuICAgICAgICByZWN0YW5nbGVXaWR0aCAqIHBpeGVsc1dpZHRoRm9yQ2VzaXVtIC8gYmVzdExldmVsV2lkdGg7XHJcbiAgICB2YXIgZ2VvZ3JhcGhpY0hlaWdodEZvckNlc2l1bSA9XHJcbiAgICAgICAgcmVjdGFuZ2xlSGVpZ2h0ICogcGl4ZWxzSGVpZ2h0Rm9yQ2VzaXVtIC8gYmVzdExldmVsSGVpZ2h0O1xyXG4gICAgXHJcbiAgICB2YXIgZml4ZWRFYXN0ICA9IHRoaXMuX3JlY3RhbmdsZS53ZXN0ICArIGdlb2dyYXBoaWNXaWR0aEZvckNlc2l1bTtcclxuICAgIHZhciBmaXhlZFNvdXRoID0gdGhpcy5fcmVjdGFuZ2xlLm5vcnRoIC0gZ2VvZ3JhcGhpY0hlaWdodEZvckNlc2l1bTtcclxuICAgIFxyXG4gICAgdGhpcy5fdGlsaW5nU2NoZW1lUGFyYW1zID0ge1xyXG4gICAgICAgIHdlc3Q6IHRoaXMuX3JlY3RhbmdsZS53ZXN0LFxyXG4gICAgICAgIGVhc3Q6IGZpeGVkRWFzdCxcclxuICAgICAgICBzb3V0aDogZml4ZWRTb3V0aCxcclxuICAgICAgICBub3J0aDogdGhpcy5fcmVjdGFuZ2xlLm5vcnRoLFxyXG4gICAgICAgIGxldmVsWmVyb1RpbGVzWDogbG93ZXN0TGV2ZWxUaWxlc1gsXHJcbiAgICAgICAgbGV2ZWxaZXJvVGlsZXNZOiBsb3dlc3RMZXZlbFRpbGVzWSxcclxuICAgICAgICBtYXhpbXVtTGV2ZWw6IG1heGltdW1DZXNpdW1MZXZlbFxyXG4gICAgfTtcclxuICAgIFxyXG4gICAgdGhpcy5fdGlsaW5nU2NoZW1lID0gY3JlYXRlVGlsaW5nU2NoZW1lKHRoaXMuX3RpbGluZ1NjaGVtZVBhcmFtcyk7XHJcbiAgICAgICAgXHJcbiAgICBDZXNpdW0uVGlsZVByb3ZpZGVyRXJyb3IuaGFuZGxlU3VjY2Vzcyh0aGlzLl9lcnJvckV2ZW50KTtcclxufTtcclxuXHJcbmZ1bmN0aW9uIGNyZWF0ZVRpbGluZ1NjaGVtZShwYXJhbXMpIHtcclxuICAgIHZhciBnZW9ncmFwaGljUmVjdGFuZ2xlRm9yQ2VzaXVtID0gbmV3IENlc2l1bS5SZWN0YW5nbGUoXHJcbiAgICAgICAgcGFyYW1zLndlc3QsIHBhcmFtcy5zb3V0aCwgcGFyYW1zLmVhc3QsIHBhcmFtcy5ub3J0aCk7XHJcbiAgICBcclxuICAgIHZhciB0aWxpbmdTY2hlbWUgPSBuZXcgQ2VzaXVtLkdlb2dyYXBoaWNUaWxpbmdTY2hlbWUoe1xyXG4gICAgICAgIHJlY3RhbmdsZTogZ2VvZ3JhcGhpY1JlY3RhbmdsZUZvckNlc2l1bSxcclxuICAgICAgICBudW1iZXJPZkxldmVsWmVyb1RpbGVzWDogcGFyYW1zLmxldmVsWmVyb1RpbGVzWCxcclxuICAgICAgICBudW1iZXJPZkxldmVsWmVyb1RpbGVzWTogcGFyYW1zLmxldmVsWmVyb1RpbGVzWVxyXG4gICAgfSk7XHJcbiAgICBcclxuICAgIHJldHVybiB0aWxpbmdTY2hlbWU7XHJcbn0iLCIndXNlIHN0cmljdCc7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IEltYWdlRGVjb2RlcjtcclxuXHJcbnZhciBpbWFnZUhlbHBlckZ1bmN0aW9ucyA9IHJlcXVpcmUoJ2ltYWdlSGVscGVyRnVuY3Rpb25zLmpzJyk7XHJcbnZhciBEZWNvZGVKb2JzUG9vbCA9IHJlcXVpcmUoJ2RlY29kZWpvYnNwb29sLmpzJyk7XHJcbnZhciBJbWFnZVBhcmFtc1JldHJpZXZlclByb3h5ID0gcmVxdWlyZSgnaW1hZ2VwYXJhbXNyZXRyaWV2ZXJwcm94eS5qcycpO1xyXG52YXIgc2V0RGVjb2RlclNsYXZlU2lkZUNyZWF0b3IgPSByZXF1aXJlKCdzZXRkZWNvZGVyc2xhdmVzaWRlY3JlYXRvci5qcycpO1xyXG5cclxuLyogZ2xvYmFsIGNvbnNvbGU6IGZhbHNlICovXHJcbi8qIGdsb2JhbCBQcm9taXNlOiBmYWxzZSAqL1xyXG5cclxuSW1hZ2VEZWNvZGVyLmFsaWduUGFyYW1zVG9UaWxlc0FuZExldmVsID0gaW1hZ2VIZWxwZXJGdW5jdGlvbnMuYWxpZ25QYXJhbXNUb1RpbGVzQW5kTGV2ZWw7XHJcblxyXG5mdW5jdGlvbiBJbWFnZURlY29kZXIoaW1hZ2UsIG9wdGlvbnMpIHtcclxuICAgIEltYWdlUGFyYW1zUmV0cmlldmVyUHJveHkuY2FsbCh0aGlzKTtcclxuICAgIFxyXG4gICAgdGhpcy5fb3B0aW9ucyA9IG9wdGlvbnMgfHwge307XHJcbiAgICAvL3ZhciBkZWNvZGVXb3JrZXJzTGltaXQgPSB0aGlzLl9vcHRpb25zLndvcmtlcnNMaW1pdCB8fCA1O1xyXG4gICAgXHJcbiAgICB0aGlzLl90aWxlV2lkdGggPSB0aGlzLl9vcHRpb25zLnRpbGVXaWR0aCB8fCAyNTY7XHJcbiAgICB0aGlzLl90aWxlSGVpZ2h0ID0gdGhpcy5fb3B0aW9ucy50aWxlSGVpZ2h0IHx8IDI1NjtcclxuICAgIHRoaXMuX3Nob3dMb2cgPSAhIXRoaXMuX29wdGlvbnMuc2hvd0xvZztcclxuICAgIHRoaXMuX2ZldGNoTWFuYWdlciA9IG51bGw7XHJcbiAgICB0aGlzLl9kZWNvZGVEZXBlbmRlbmN5V29ya2VycyA9IG51bGw7XHJcbiAgICB0aGlzLl9yZXF1ZXN0c0RlY29kZUpvYnNQb29sID0gbnVsbDtcclxuICAgIHRoaXMuX2NoYW5uZWxzRGVjb2RlSm9ic1Bvb2wgPSBudWxsO1xyXG5cdHRoaXMuX2ZldGNoUmVxdWVzdElkID0gMDtcclxuICAgIFxyXG4gICAgLyppZiAodGhpcy5fc2hvd0xvZykge1xyXG4gICAgICAgIC8vIE9sZCBJRVxyXG4gICAgICAgIHRocm93ICdzaG93TG9nIGlzIG5vdCBzdXBwb3J0ZWQgb24gdGhpcyBicm93c2VyJztcclxuICAgIH0qL1xyXG5cclxuICAgIHRoaXMuX2NoYW5uZWxTdGF0ZXMgPSBbXTtcclxuICAgIHRoaXMuX2RlY29kZXJzID0gW107XHJcblxyXG4gICAgLyogVE9ET1xyXG4gICAgdmFyIGRlY29kZVNjaGVkdWxlciA9IGltYWdlSGVscGVyRnVuY3Rpb25zLmNyZWF0ZVNjaGVkdWxlcihcclxuICAgICAgICB0aGlzLl9zaG93TG9nLFxyXG4gICAgICAgIHRoaXMuX29wdGlvbnMuZGVjb2RlUHJpb3JpdGl6ZXIsXHJcbiAgICAgICAgJ2RlY29kZScsXHJcbiAgICAgICAgZnVuY3Rpb24gY3JlYXRlUmVzb3VyY2UoKSB7XHJcbiAgICAgICAgICAgIHJldHVybiB7fTtcclxuICAgICAgICB9LFxyXG4gICAgICAgIGRlY29kZVdvcmtlcnNMaW1pdCk7XHJcbiAgICAqL1xyXG4gICAgXHJcbiAgICAvL3RoaXMuX2RlY29kZVByaW9yaXRpemVyID0gZGVjb2RlU2NoZWR1bGVyLnByaW9yaXRpemVyO1xyXG4gICAgXHJcbiAgICB0aGlzLl9pbWFnZSA9IGltYWdlO1xyXG4gICAgaWYgKCF0aGlzLl9pbWFnZS5nZXRGZXRjaE1hbmFnZXIpIHtcclxuICAgICAgICB0aHJvdyAnSW1hZ2UuZ2V0RmV0Y2hNYW5hZ2VyKCkgaXMgbm90IGltcGxlbWVudGVkIGJ5IGltYWdlIGN0b3IgYXJndW1lbnQhJztcclxuICAgIH1cclxuICAgIGlmICghdGhpcy5faW1hZ2UuZ2V0RGVjb2RlcldvcmtlcnMpIHtcclxuICAgICAgICB0aHJvdyAnSW1hZ2UuZ2V0RGVjb2RlcldvcmtlcnMoKSBpcyBub3QgaW1wbGVtZW50ZWQgYnkgaW1hZ2UgY3RvciBhcmd1bWVudCc7XHJcbiAgICB9XHJcbn1cclxuXHJcbkltYWdlRGVjb2Rlci5wcm90b3R5cGUgPSBPYmplY3QuY3JlYXRlKEltYWdlUGFyYW1zUmV0cmlldmVyUHJveHkucHJvdG90eXBlKTtcclxuXHJcbkltYWdlRGVjb2Rlci5wcm90b3R5cGUuZ2V0VGlsZVdpZHRoID0gZnVuY3Rpb24gZ2V0VGlsZVdpZHRoKCkge1xyXG4gICAgcmV0dXJuIHRoaXMuX3RpbGVXaWR0aDtcclxufTtcclxuXHJcbkltYWdlRGVjb2Rlci5wcm90b3R5cGUuZ2V0VGlsZUhlaWdodCA9IGZ1bmN0aW9uIGdldFRpbGVIZWlnaHQoKSB7XHJcbiAgICByZXR1cm4gdGhpcy5fdGlsZUhlaWdodDtcclxufTtcclxuICAgIFxyXG5JbWFnZURlY29kZXIucHJvdG90eXBlLnNldFNlcnZlclJlcXVlc3RQcmlvcml0aXplckRhdGEgPVxyXG4gICAgZnVuY3Rpb24gc2V0U2VydmVyUmVxdWVzdFByaW9yaXRpemVyRGF0YShwcmlvcml0aXplckRhdGEpIHtcclxuXHJcbiAgICB0aGlzLl92YWxpZGF0ZUZldGNoZXIoKTtcclxuICAgIFxyXG4gICAgLy8gVE9ET1xyXG4gICAgLy90aGlzLl9mZXRjaE1hbmFnZXIuc2V0U2VydmVyUmVxdWVzdFByaW9yaXRpemVyRGF0YShcclxuICAgIC8vICAgIHByaW9yaXRpemVyRGF0YSk7XHJcbn07XHJcblxyXG5JbWFnZURlY29kZXIucHJvdG90eXBlLnNldERlY29kZVByaW9yaXRpemVyRGF0YSA9XHJcbiAgICBmdW5jdGlvbiBzZXREZWNvZGVQcmlvcml0aXplckRhdGEocHJpb3JpdGl6ZXJEYXRhKSB7XHJcblxyXG4gICAgdGhpcy5fdmFsaWRhdGVEZWNvZGVyKCk7XHJcbiAgICBcclxuICAgIC8vIFRPRE9cclxuICAgIGlmICghSW1hZ2VEZWNvZGVyLnVuZGVmaW5lZFZhcikgeyAvLyBBdm9pZCB1bnJlYWNoYWJsZSB3YXJuaW5nXHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgaWYgKHRoaXMuX2RlY29kZVByaW9yaXRpemVyID09PSBudWxsKSB7XHJcbiAgICAgICAgdGhyb3cgJ05vIGRlY29kZSBwcmlvcml0aXplciBoYXMgYmVlbiBzZXQnO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBpZiAodGhpcy5fc2hvd0xvZykge1xyXG4gICAgICAgIGNvbnNvbGUubG9nKCdzZXREZWNvZGVQcmlvcml0aXplckRhdGEoJyArIHByaW9yaXRpemVyRGF0YSArICcpJyk7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHZhciBwcmlvcml0aXplckRhdGFNb2RpZmllZCA9IE9iamVjdC5jcmVhdGUocHJpb3JpdGl6ZXJEYXRhKTtcclxuICAgIHByaW9yaXRpemVyRGF0YU1vZGlmaWVkLmltYWdlID0gdGhpcztcclxuICAgIFxyXG4gICAgdGhpcy5fZGVjb2RlUHJpb3JpdGl6ZXIuc2V0UHJpb3JpdGl6ZXJEYXRhKHByaW9yaXRpemVyRGF0YU1vZGlmaWVkKTtcclxufTtcclxuXHJcbkltYWdlRGVjb2Rlci5wcm90b3R5cGUub3BlbiA9IGZ1bmN0aW9uIG9wZW4odXJsKSB7XHJcbiAgICB0aGlzLl92YWxpZGF0ZUZldGNoZXIoKTtcclxuICAgIFxyXG4gICAgdmFyIHNlbGYgPSB0aGlzO1xyXG4gICAgdmFyIHByb21pc2UgPSB0aGlzLl9mZXRjaE1hbmFnZXIub3Blbih1cmwpO1xyXG4gICAgcmV0dXJuIHByb21pc2UudGhlbihmdW5jdGlvbiAoc2l6ZXNQYXJhbXMpIHtcclxuICAgICAgICBzZWxmLl9pbnRlcm5hbFNpemVzUGFyYW1zID0gc2l6ZXNQYXJhbXM7XHJcbiAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgICAgc2l6ZXNQYXJhbXM6IHNpemVzUGFyYW1zLFxyXG4gICAgICAgICAgICBhcHBsaWNhdGl2ZVRpbGVXaWR0aCA6IHNlbGYuZ2V0VGlsZVdpZHRoKCksXHJcbiAgICAgICAgICAgIGFwcGxpY2F0aXZlVGlsZUhlaWdodDogc2VsZi5nZXRUaWxlSGVpZ2h0KClcclxuICAgICAgICB9O1xyXG4gICAgfSk7XHJcbn07XHJcblxyXG5JbWFnZURlY29kZXIucHJvdG90eXBlLmNsb3NlID0gZnVuY3Rpb24gY2xvc2UoKSB7XHJcbiAgICB0aGlzLl92YWxpZGF0ZUZldGNoZXIoKTtcclxuICAgIHRoaXMuX3ZhbGlkYXRlRGVjb2RlcigpO1xyXG4gICAgXHJcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IHRoaXMuX2RlY29kZXJzLmxlbmd0aDsgKytpKSB7XHJcbiAgICAgICAgdGhpcy5fZGVjb2RlcnNbaV0udGVybWluYXRlKCk7XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIHRoaXMuX2ZldGNoTWFuYWdlci5jbG9zZSgpO1xyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVyLnByb3RvdHlwZS5jcmVhdGVDaGFubmVsID0gZnVuY3Rpb24gY3JlYXRlQ2hhbm5lbCgpIHtcclxuICAgIHRoaXMuX3ZhbGlkYXRlRmV0Y2hlcigpO1xyXG4gICAgdGhpcy5nZXRJbWFnZVBhcmFtcygpO1xyXG4gICAgXHJcbiAgICB2YXIgc2VsZiA9IHRoaXM7XHJcbiAgICBcclxuICAgIHJldHVybiB0aGlzLl9mZXRjaE1hbmFnZXIuY3JlYXRlQ2hhbm5lbCgpLnRoZW4oZnVuY3Rpb24oY2hhbm5lbEhhbmRsZSkge1xyXG4gICAgICAgIHNlbGYuX2NoYW5uZWxTdGF0ZXNbY2hhbm5lbEhhbmRsZV0gPSB7XHJcbiAgICAgICAgICAgIGRlY29kZUpvYnNMaXN0ZW5lckhhbmRsZTogbnVsbFxyXG4gICAgICAgIH07XHJcbiAgICAgICAgXHJcbiAgICAgICAgcmV0dXJuIGNoYW5uZWxIYW5kbGU7XHJcbiAgICB9KTtcclxufTtcclxuXHJcbkltYWdlRGVjb2Rlci5wcm90b3R5cGUucmVxdWVzdFBpeGVscyA9IGZ1bmN0aW9uIHJlcXVlc3RQaXhlbHMoaW1hZ2VQYXJ0UGFyYW1zKSB7XHJcbiAgICB0aGlzLl92YWxpZGF0ZURlY29kZXIoKTtcclxuICAgIHRoaXMuZ2V0SW1hZ2VQYXJhbXMoKTtcclxuICAgIFxyXG4gICAgdmFyIHJlc29sdmUsIHJlamVjdDtcclxuICAgIHZhciBhY2N1bXVsYXRlZFJlc3VsdCA9IHt9O1xyXG4gICAgXHJcbiAgICB2YXIgc2VsZiA9IHRoaXM7XHJcbiAgICB2YXIgcHJvbWlzZSA9IG5ldyBQcm9taXNlKHN0YXJ0UHJvbWlzZSk7XHJcbiAgICByZXR1cm4gcHJvbWlzZTtcclxuICAgIFxyXG4gICAgZnVuY3Rpb24gc3RhcnRQcm9taXNlKHJlc29sdmVfLCByZWplY3RfKSB7XHJcbiAgICAgICAgcmVzb2x2ZSA9IHJlc29sdmVfO1xyXG4gICAgICAgIHJlamVjdCA9IHJlamVjdF87XHJcbiAgICAgICAgXHJcbiAgICAgICAgc2VsZi5fcmVxdWVzdHNEZWNvZGVKb2JzUG9vbC5mb3JrRGVjb2RlSm9icyhcclxuICAgICAgICAgICAgaW1hZ2VQYXJ0UGFyYW1zLFxyXG4gICAgICAgICAgICBpbnRlcm5hbENhbGxiYWNrLFxyXG4gICAgICAgICAgICBpbnRlcm5hbFRlcm1pbmF0ZWRDYWxsYmFjayk7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGZ1bmN0aW9uIGludGVybmFsQ2FsbGJhY2soZGVjb2RlZERhdGEpIHtcclxuICAgICAgICBzZWxmLl9jb3B5UGl4ZWxzVG9BY2N1bXVsYXRlZFJlc3VsdChkZWNvZGVkRGF0YSwgYWNjdW11bGF0ZWRSZXN1bHQpO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBmdW5jdGlvbiBpbnRlcm5hbFRlcm1pbmF0ZWRDYWxsYmFjayhpc0Fib3J0ZWQpIHtcclxuICAgICAgICBpZiAoaXNBYm9ydGVkKSB7XHJcbiAgICAgICAgICAgIHJlamVjdCgnUmVxdWVzdCB3YXMgYWJvcnRlZCBkdWUgdG8gZmFpbHVyZSBvciBwcmlvcml0eScpO1xyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgIHJlc29sdmUoYWNjdW11bGF0ZWRSZXN1bHQpO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxufTtcclxuXHJcbkltYWdlRGVjb2Rlci5wcm90b3R5cGUucmVxdWVzdFBpeGVsc1Byb2dyZXNzaXZlID0gZnVuY3Rpb24gcmVxdWVzdFBpeGVsc1Byb2dyZXNzaXZlKFxyXG4gICAgaW1hZ2VQYXJ0UGFyYW1zLFxyXG4gICAgY2FsbGJhY2ssXHJcbiAgICB0ZXJtaW5hdGVkQ2FsbGJhY2ssXHJcbiAgICBpbWFnZVBhcnRQYXJhbXNOb3ROZWVkZWQsXHJcbiAgICBjaGFubmVsSGFuZGxlKSB7XHJcbiAgICBcclxuICAgIHRoaXMuX3ZhbGlkYXRlRGVjb2RlcigpO1xyXG4gICAgdGhpcy5nZXRJbWFnZVBhcmFtcygpO1xyXG4gICAgXHJcbiAgICB2YXIgY2hhbm5lbFN0YXRlID0gbnVsbDtcclxuICAgIHZhciBkZWNvZGVKb2JzUG9vbDtcclxuICAgIGlmIChjaGFubmVsSGFuZGxlID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICBkZWNvZGVKb2JzUG9vbCA9IHRoaXMuX3JlcXVlc3RzRGVjb2RlSm9ic1Bvb2w7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICAgIGRlY29kZUpvYnNQb29sID0gdGhpcy5fY2hhbm5lbHNEZWNvZGVKb2JzUG9vbDtcclxuICAgICAgICBcclxuICAgICAgICBjaGFubmVsU3RhdGUgPSB0aGlzLl9jaGFubmVsU3RhdGVzW2NoYW5uZWxIYW5kbGVdO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGlmIChjaGFubmVsU3RhdGUgPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgICAgICB0aHJvdyAnQ2hhbm5lbCBoYW5kbGUgZG9lcyBub3QgZXhpc3QnO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuICAgIFxyXG4gICAgdmFyIGxpc3RlbmVySGFuZGxlID0gZGVjb2RlSm9ic1Bvb2wuZm9ya0RlY29kZUpvYnMoXHJcbiAgICAgICAgaW1hZ2VQYXJ0UGFyYW1zLFxyXG4gICAgICAgIGNhbGxiYWNrLFxyXG4gICAgICAgIHRlcm1pbmF0ZWRDYWxsYmFjayxcclxuICAgICAgICBpbWFnZVBhcnRQYXJhbXNOb3ROZWVkZWQpO1xyXG4gICAgICAgIFxyXG4gICAgaWYgKGNoYW5uZWxIYW5kbGUgIT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIGlmIChjaGFubmVsU3RhdGUuZGVjb2RlSm9ic0xpc3RlbmVySGFuZGxlICE9PSBudWxsKSB7XHJcbiAgICAgICAgICAgIC8vIFVucmVnaXN0ZXIgYWZ0ZXIgZm9ya2VkIG5ldyBqb2JzLCBzbyBubyB0ZXJtaW5hdGlvbiBvY2N1cnMgbWVhbndoaWxlXHJcbiAgICAgICAgICAgIGRlY29kZUpvYnNQb29sLnVucmVnaXN0ZXJGb3JrZWRKb2JzKFxyXG4gICAgICAgICAgICAgICAgY2hhbm5lbFN0YXRlLmRlY29kZUpvYnNMaXN0ZW5lckhhbmRsZSk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGNoYW5uZWxTdGF0ZS5kZWNvZGVKb2JzTGlzdGVuZXJIYW5kbGUgPSBsaXN0ZW5lckhhbmRsZTtcclxuICAgICAgICB0aGlzLl9mZXRjaE1hbmFnZXIubW92ZUNoYW5uZWwoY2hhbm5lbEhhbmRsZSwgaW1hZ2VQYXJ0UGFyYW1zKTtcclxuICAgIH0gZWxzZSB7XHJcblx0XHR0aGlzLl9mZXRjaE1hbmFnZXIuY3JlYXRlUmVxdWVzdCgrK3RoaXMuX2ZldGNoUmVxdWVzdElkLCBpbWFnZVBhcnRQYXJhbXMpO1xyXG5cdH1cclxufTtcclxuXHJcbkltYWdlRGVjb2Rlci5wcm90b3R5cGUucmVjb25uZWN0ID0gZnVuY3Rpb24gcmVjb25uZWN0KCkge1xyXG4gICAgdGhpcy5fdmFsaWRhdGVGZXRjaGVyKCk7XHJcbiAgICBcclxuICAgIHRoaXMuX2ZldGNoTWFuYWdlci5yZWNvbm5lY3QoKTtcclxufTtcclxuXHJcbkltYWdlRGVjb2Rlci5wcm90b3R5cGUuZ2V0SW1hZ2UgPSBmdW5jdGlvbiBnZXRJbWFnZSgpIHtcclxuICAgIHJldHVybiB0aGlzLl9pbWFnZTtcclxufTtcclxuXHJcbi8vIEludGVybmFsIE1ldGhvZHNcclxuXHJcbkltYWdlRGVjb2Rlci5wcm90b3R5cGUuX3ZhbGlkYXRlRmV0Y2hlciA9IGZ1bmN0aW9uIHZhbGlkYXRlRmV0Y2hlcigpIHtcclxuICAgIGlmICh0aGlzLl9mZXRjaE1hbmFnZXIgPT09IG51bGwpIHtcclxuICAgICAgICB0aGlzLl9mZXRjaE1hbmFnZXIgPSB0aGlzLl9pbWFnZS5nZXRGZXRjaE1hbmFnZXIoKTtcclxuICAgIH1cclxufTtcclxuXHJcbkltYWdlRGVjb2Rlci5wcm90b3R5cGUuX3ZhbGlkYXRlRGVjb2RlciA9IGZ1bmN0aW9uIHZhbGlkYXRlQ29tcG9uZW50cygpIHtcclxuICAgIGlmICh0aGlzLl9kZWNvZGVEZXBlbmRlbmN5V29ya2VycyAhPT0gbnVsbCkge1xyXG4gICAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIFxyXG4gICAgdGhpcy5fZGVjb2RlRGVwZW5kZW5jeVdvcmtlcnMgPSB0aGlzLl9pbWFnZS5nZXREZWNvZGVyV29ya2VycygpO1xyXG4gICAgXHJcbiAgICB0aGlzLl9yZXF1ZXN0c0RlY29kZUpvYnNQb29sID0gbmV3IERlY29kZUpvYnNQb29sKFxyXG4gICAgICAgIHRoaXMuX2RlY29kZURlcGVuZGVuY3lXb3JrZXJzLFxyXG4gICAgICAgIHRoaXMuX3RpbGVXaWR0aCxcclxuICAgICAgICB0aGlzLl90aWxlSGVpZ2h0KTtcclxuICAgICAgICBcclxuICAgIHRoaXMuX2NoYW5uZWxzRGVjb2RlSm9ic1Bvb2wgPSBuZXcgRGVjb2RlSm9ic1Bvb2woXHJcbiAgICAgICAgdGhpcy5fZGVjb2RlRGVwZW5kZW5jeVdvcmtlcnMsXHJcbiAgICAgICAgdGhpcy5fdGlsZVdpZHRoLFxyXG4gICAgICAgIHRoaXMuX3RpbGVIZWlnaHQpO1xyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVyLnByb3RvdHlwZS5fZ2V0SW1hZ2VQYXJhbXNJbnRlcm5hbCA9IGZ1bmN0aW9uIGdldEltYWdlUGFyYW1zSW50ZXJuYWwoKSB7XHJcbiAgICByZXR1cm4gdGhpcy5faW50ZXJuYWxTaXplc1BhcmFtcztcclxufTtcclxuXHJcbkltYWdlRGVjb2Rlci5wcm90b3R5cGUuX2NvcHlQaXhlbHNUb0FjY3VtdWxhdGVkUmVzdWx0ID1cclxuICAgIGZ1bmN0aW9uIGNvcHlQaXhlbHNUb0FjY3VtdWxhdGVkUmVzdWx0KGRlY29kZWREYXRhLCBhY2N1bXVsYXRlZFJlc3VsdCkge1xyXG4gICAgICAgIFxyXG4gICAgdmFyIGJ5dGVzUGVyUGl4ZWwgPSA0O1xyXG4gICAgdmFyIHNvdXJjZVN0cmlkZSA9IGRlY29kZWREYXRhLndpZHRoICogYnl0ZXNQZXJQaXhlbDtcclxuICAgIHZhciB0YXJnZXRTdHJpZGUgPVxyXG4gICAgICAgIGRlY29kZWREYXRhLm9yaWdpbmFsUmVxdWVzdFdpZHRoICogYnl0ZXNQZXJQaXhlbDtcclxuICAgIFxyXG4gICAgaWYgKGFjY3VtdWxhdGVkUmVzdWx0LnBpeGVscyA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgdmFyIHNpemUgPVxyXG4gICAgICAgICAgICB0YXJnZXRTdHJpZGUgKiBkZWNvZGVkRGF0YS5vcmlnaW5hbFJlcXVlc3RIZWlnaHQ7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgIGFjY3VtdWxhdGVkUmVzdWx0LnBpeGVscyA9IG5ldyBVaW50OEFycmF5KHNpemUpO1xyXG4gICAgICAgIGFjY3VtdWxhdGVkUmVzdWx0LnhJbk9yaWdpbmFsUmVxdWVzdCA9IDA7XHJcbiAgICAgICAgYWNjdW11bGF0ZWRSZXN1bHQueUluT3JpZ2luYWxSZXF1ZXN0ID0gMDtcclxuICAgICAgICBcclxuICAgICAgICB2YXIgd2lkdGggPSBkZWNvZGVkRGF0YS5vcmlnaW5hbFJlcXVlc3RXaWR0aDtcclxuICAgICAgICBhY2N1bXVsYXRlZFJlc3VsdC5vcmlnaW5hbFJlcXVlc3RXaWR0aCA9IHdpZHRoO1xyXG4gICAgICAgIGFjY3VtdWxhdGVkUmVzdWx0LndpZHRoID0gd2lkdGg7XHJcblxyXG4gICAgICAgIHZhciBoZWlnaHQgPSBkZWNvZGVkRGF0YS5vcmlnaW5hbFJlcXVlc3RIZWlnaHQ7XHJcbiAgICAgICAgYWNjdW11bGF0ZWRSZXN1bHQub3JpZ2luYWxSZXF1ZXN0SGVpZ2h0ID0gaGVpZ2h0O1xyXG4gICAgICAgIGFjY3VtdWxhdGVkUmVzdWx0LmhlaWdodCA9IGhlaWdodDtcclxuICAgIH1cclxuICAgIFxyXG4gICAgYWNjdW11bGF0ZWRSZXN1bHQuYWxsUmVsZXZhbnRCeXRlc0xvYWRlZCA9XHJcbiAgICAgICAgZGVjb2RlZERhdGEuYWxsUmVsZXZhbnRCeXRlc0xvYWRlZDtcclxuXHJcbiAgICB2YXIgc291cmNlT2Zmc2V0ID0gMDtcclxuICAgIHZhciB0YXJnZXRPZmZzZXQgPVxyXG4gICAgICAgIGRlY29kZWREYXRhLnhJbk9yaWdpbmFsUmVxdWVzdCAqIGJ5dGVzUGVyUGl4ZWwgKyBcclxuICAgICAgICBkZWNvZGVkRGF0YS55SW5PcmlnaW5hbFJlcXVlc3QgKiB0YXJnZXRTdHJpZGU7XHJcbiAgICBcclxuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgZGVjb2RlZERhdGEuaGVpZ2h0OyArK2kpIHtcclxuICAgICAgICB2YXIgc291cmNlU3ViQXJyYXkgPSBkZWNvZGVkRGF0YS5waXhlbHMuc3ViYXJyYXkoXHJcbiAgICAgICAgICAgIHNvdXJjZU9mZnNldCwgc291cmNlT2Zmc2V0ICsgc291cmNlU3RyaWRlKTtcclxuICAgICAgICBcclxuICAgICAgICBhY2N1bXVsYXRlZFJlc3VsdC5waXhlbHMuc2V0KHNvdXJjZVN1YkFycmF5LCB0YXJnZXRPZmZzZXQpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHNvdXJjZU9mZnNldCArPSBzb3VyY2VTdHJpZGU7XHJcbiAgICAgICAgdGFyZ2V0T2Zmc2V0ICs9IHRhcmdldFN0cmlkZTtcclxuICAgIH1cclxufTsiLCIndXNlIHN0cmljdCc7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IERlY29kZUpvYjtcclxuXHJcbnZhciBMaW5rZWRMaXN0ID0gcmVxdWlyZSgnbGlua2VkbGlzdC5qcycpO1xyXG5cclxudmFyIHJlcXVlc3RJZENvdW50ZXIgPSAwO1xyXG5cclxuZnVuY3Rpb24gRGVjb2RlSm9iKGxpc3RlbmVySGFuZGxlLCBpbWFnZVBhcnRQYXJhbXMpIHtcclxuICAgIHRoaXMuX2lzRmlyc3RTdGFnZSA9IHRydWU7XHJcbiAgICB0aGlzLl9saXN0ZW5lckhhbmRsZSA9IGxpc3RlbmVySGFuZGxlO1xyXG4gICAgdGhpcy5faW1hZ2VQYXJ0UGFyYW1zID0gaW1hZ2VQYXJ0UGFyYW1zO1xyXG4gICAgdGhpcy5fYWxsUmVsZXZhbnRCeXRlc0xvYWRlZCA9IDA7XHJcbiAgICB2YXIgcmVxdWVzdFBhcmFtcyA9IGxpc3RlbmVySGFuZGxlLmltYWdlUGFydFBhcmFtcztcclxuICAgIHRoaXMuX29mZnNldFggPSBpbWFnZVBhcnRQYXJhbXMubWluWCAtIHJlcXVlc3RQYXJhbXMubWluWDtcclxuICAgIHRoaXMuX29mZnNldFkgPSBpbWFnZVBhcnRQYXJhbXMubWluWSAtIHJlcXVlc3RQYXJhbXMubWluWTtcclxuICAgIHRoaXMuX3JlcXVlc3RXaWR0aCA9IHJlcXVlc3RQYXJhbXMubWF4WEV4Y2x1c2l2ZSAtIHJlcXVlc3RQYXJhbXMubWluWDtcclxuICAgIHRoaXMuX3JlcXVlc3RIZWlnaHQgPSByZXF1ZXN0UGFyYW1zLm1heFlFeGNsdXNpdmUgLSByZXF1ZXN0UGFyYW1zLm1pblk7XHJcbn1cclxuXHJcbkRlY29kZUpvYi5wcm90b3R5cGUub25EYXRhID0gZnVuY3Rpb24gb25EYXRhKGRlY29kZVJlc3VsdCkge1xyXG4gICAgdGhpcy5faXNGaXJzdFN0YWdlID0gZmFsc2U7XHJcblxyXG4gICAgdmFyIHJlbGV2YW50Qnl0ZXNMb2FkZWREaWZmID1cclxuICAgICAgICBkZWNvZGVSZXN1bHQuYWxsUmVsZXZhbnRCeXRlc0xvYWRlZCAtIHRoaXMuX2FsbFJlbGV2YW50Qnl0ZXNMb2FkZWQ7XHJcbiAgICB0aGlzLl9hbGxSZWxldmFudEJ5dGVzTG9hZGVkID0gZGVjb2RlUmVzdWx0LmFsbFJlbGV2YW50Qnl0ZXNMb2FkZWQ7XHJcbiAgICB0aGlzLl9saXN0ZW5lckhhbmRsZS5hbGxSZWxldmFudEJ5dGVzTG9hZGVkICs9IHJlbGV2YW50Qnl0ZXNMb2FkZWREaWZmO1xyXG4gICAgXHJcbiAgICB2YXIgZGVjb2RlZE9mZnNldHRlZCA9IHtcclxuICAgICAgICBvcmlnaW5hbFJlcXVlc3RXaWR0aDogdGhpcy5fcmVxdWVzdFdpZHRoLFxyXG4gICAgICAgIG9yaWdpbmFsUmVxdWVzdEhlaWdodDogdGhpcy5fcmVxdWVzdEhlaWdodCxcclxuICAgICAgICB4SW5PcmlnaW5hbFJlcXVlc3Q6IHRoaXMuX29mZnNldFgsXHJcbiAgICAgICAgeUluT3JpZ2luYWxSZXF1ZXN0OiB0aGlzLl9vZmZzZXRZLFxyXG4gICAgICAgIFxyXG4gICAgICAgIGltYWdlRGF0YTogZGVjb2RlUmVzdWx0LFxyXG4gICAgICAgIFxyXG4gICAgICAgIGFsbFJlbGV2YW50Qnl0ZXNMb2FkZWQ6IHRoaXMuX2xpc3RlbmVySGFuZGxlLmFsbFJlbGV2YW50Qnl0ZXNMb2FkZWRcclxuICAgIH07XHJcbiAgICBcclxuICAgIHRoaXMuX2xpc3RlbmVySGFuZGxlLmNhbGxiYWNrKGRlY29kZWRPZmZzZXR0ZWQpO1xyXG59O1xyXG5cclxuRGVjb2RlSm9iLnByb3RvdHlwZS5vblRlcm1pbmF0ZWQgPSBmdW5jdGlvbiBvblRlcm1pbmF0ZWQoKSB7XHJcbiAgICAvL3RoaXMuX2xpc3RlbmVySGFuZGxlLmlzQW55RGVjb2RlckFib3J0ZWQgfD0gdGhpcy5faXNBYm9ydGVkO1xyXG4gICAgXHJcbiAgICB2YXIgcmVtYWluaW5nID0gLS10aGlzLl9saXN0ZW5lckhhbmRsZS5yZW1haW5pbmdEZWNvZGVKb2JzO1xyXG4gICAgaWYgKHJlbWFpbmluZyA8IDApIHtcclxuICAgICAgICB0aHJvdyAnSW5jb25zaXN0ZW50IG51bWJlciBvZiBkb25lIHJlcXVlc3RzJztcclxuICAgIH1cclxuICAgIFxyXG4gICAgdmFyIGlzTGlzdGVuZXJEb25lID0gcmVtYWluaW5nID09PSAwO1xyXG4gICAgaWYgKGlzTGlzdGVuZXJEb25lKSB7XHJcbiAgICAgICAgdGhpcy5fbGlzdGVuZXJIYW5kbGUuaXNUZXJtaW5hdGVkQ2FsbGJhY2tDYWxsZWQgPSB0cnVlO1xyXG4gICAgICAgIHRoaXMuX2xpc3RlbmVySGFuZGxlLnRlcm1pbmF0ZWRDYWxsYmFjayhcclxuICAgICAgICAgICAgdGhpcy5fbGlzdGVuZXJIYW5kbGUuaXNBbnlEZWNvZGVyQWJvcnRlZCk7XHJcbiAgICB9XHJcbn07IiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBEZWNvZGVKb2JzUG9vbDtcclxuXHJcbnZhciBEZWNvZGVKb2IgPSByZXF1aXJlKCdkZWNvZGVqb2IuanMnKTtcclxuXHJcbmZ1bmN0aW9uIERlY29kZUpvYnNQb29sKFxyXG4gICAgZGVjb2RlRGVwZW5kZW5jeVdvcmtlcnMsXHJcbiAgICB0aWxlV2lkdGgsXHJcbiAgICB0aWxlSGVpZ2h0KSB7XHJcbiAgICBcclxuICAgIHRoaXMuX3RpbGVXaWR0aCA9IHRpbGVXaWR0aDtcclxuICAgIHRoaXMuX3RpbGVIZWlnaHQgPSB0aWxlSGVpZ2h0O1xyXG4gICAgXHJcbiAgICB0aGlzLl9kZWNvZGVEZXBlbmRlbmN5V29ya2VycyA9IGRlY29kZURlcGVuZGVuY3lXb3JrZXJzO1xyXG59XHJcblxyXG5EZWNvZGVKb2JzUG9vbC5wcm90b3R5cGUuZm9ya0RlY29kZUpvYnMgPSBmdW5jdGlvbiBmb3JrRGVjb2RlSm9icyhcclxuICAgIGltYWdlUGFydFBhcmFtcyxcclxuICAgIGNhbGxiYWNrLFxyXG4gICAgdGVybWluYXRlZENhbGxiYWNrLFxyXG4gICAgaW1hZ2VQYXJ0UGFyYW1zTm90TmVlZGVkKSB7XHJcbiAgICBcclxuICAgIHZhciBtaW5YID0gaW1hZ2VQYXJ0UGFyYW1zLm1pblg7XHJcbiAgICB2YXIgbWluWSA9IGltYWdlUGFydFBhcmFtcy5taW5ZO1xyXG4gICAgdmFyIG1heFggPSBpbWFnZVBhcnRQYXJhbXMubWF4WEV4Y2x1c2l2ZTtcclxuICAgIHZhciBtYXhZID0gaW1hZ2VQYXJ0UGFyYW1zLm1heFlFeGNsdXNpdmU7XHJcbiAgICB2YXIgbGV2ZWwgPSBpbWFnZVBhcnRQYXJhbXMubGV2ZWwgfHwgMDtcclxuICAgIHZhciBxdWFsaXR5ID0gaW1hZ2VQYXJ0UGFyYW1zLnF1YWxpdHk7XHJcbiAgICB2YXIgcHJpb3JpdHlEYXRhID0gaW1hZ2VQYXJ0UGFyYW1zLnJlcXVlc3RQcmlvcml0eURhdGE7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgIHZhciBpc01pbkFsaWduZWQgPVxyXG4gICAgICAgIG1pblggJSB0aGlzLl90aWxlV2lkdGggPT09IDAgJiYgbWluWSAlIHRoaXMuX3RpbGVIZWlnaHQgPT09IDA7XHJcbiAgICB2YXIgaXNNYXhYQWxpZ25lZCA9IG1heFggJSB0aGlzLl90aWxlV2lkdGggID09PSAwIHx8IG1heFggPT09IGltYWdlUGFydFBhcmFtcy5sZXZlbFdpZHRoO1xyXG4gICAgdmFyIGlzTWF4WUFsaWduZWQgPSBtYXhZICUgdGhpcy5fdGlsZUhlaWdodCA9PT0gMCB8fCBtYXhZID09PSBpbWFnZVBhcnRQYXJhbXMubGV2ZWxIZWlnaHQ7XHJcbiAgICB2YXIgaXNPcmRlclZhbGlkID0gbWluWCA8IG1heFggJiYgbWluWSA8IG1heFk7XHJcbiAgICBcclxuICAgIGlmICghaXNNaW5BbGlnbmVkIHx8ICFpc01heFhBbGlnbmVkIHx8ICFpc01heFlBbGlnbmVkIHx8ICFpc09yZGVyVmFsaWQpIHtcclxuICAgICAgICB0aHJvdyAnaW1hZ2VQYXJ0UGFyYW1zIGZvciBkZWNvZGVycyBpcyBub3QgYWxpZ25lZCB0byAnICtcclxuICAgICAgICAgICAgJ3RpbGUgc2l6ZSBvciBub3QgaW4gdmFsaWQgb3JkZXInO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICB2YXIgbnVtVGlsZXNYID0gTWF0aC5jZWlsKChtYXhYIC0gbWluWCkgLyB0aGlzLl90aWxlV2lkdGgpO1xyXG4gICAgdmFyIG51bVRpbGVzWSA9IE1hdGguY2VpbCgobWF4WSAtIG1pblkpIC8gdGhpcy5fdGlsZUhlaWdodCk7XHJcbiAgICBcclxuICAgIHZhciBsaXN0ZW5lckhhbmRsZSA9IHtcclxuICAgICAgICBpbWFnZVBhcnRQYXJhbXM6IGltYWdlUGFydFBhcmFtcyxcclxuICAgICAgICBjYWxsYmFjazogY2FsbGJhY2ssXHJcbiAgICAgICAgdGVybWluYXRlZENhbGxiYWNrOiB0ZXJtaW5hdGVkQ2FsbGJhY2ssXHJcbiAgICAgICAgcmVtYWluaW5nRGVjb2RlSm9iczogbnVtVGlsZXNYICogbnVtVGlsZXNZLFxyXG4gICAgICAgIGlzQW55RGVjb2RlckFib3J0ZWQ6IGZhbHNlLFxyXG4gICAgICAgIGlzVGVybWluYXRlZENhbGxiYWNrQ2FsbGVkOiBmYWxzZSxcclxuICAgICAgICBhbGxSZWxldmFudEJ5dGVzTG9hZGVkOiAwLFxyXG4gICAgICAgIHVucmVnaXN0ZXJIYW5kbGVzOiBbXVxyXG4gICAgfTtcclxuICAgIFxyXG4gICAgZm9yICh2YXIgeCA9IG1pblg7IHggPCBtYXhYOyB4ICs9IHRoaXMuX3RpbGVXaWR0aCkge1xyXG4gICAgICAgIHZhciBzaW5nbGVUaWxlTWF4WCA9IE1hdGgubWluKHggKyB0aGlzLl90aWxlV2lkdGgsIGltYWdlUGFydFBhcmFtcy5sZXZlbFdpZHRoKTtcclxuICAgICAgICBcclxuICAgICAgICBmb3IgKHZhciB5ID0gbWluWTsgeSA8IG1heFk7IHkgKz0gdGhpcy5fdGlsZUhlaWdodCkge1xyXG4gICAgICAgICAgICB2YXIgc2luZ2xlVGlsZU1heFkgPSBNYXRoLm1pbih5ICsgdGhpcy5fdGlsZUhlaWdodCwgaW1hZ2VQYXJ0UGFyYW1zLmxldmVsSGVpZ2h0KTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHZhciBpc1RpbGVOb3ROZWVkZWQgPSBpc1VubmVlZGVkKFxyXG4gICAgICAgICAgICAgICAgeCxcclxuICAgICAgICAgICAgICAgIHksXHJcbiAgICAgICAgICAgICAgICBzaW5nbGVUaWxlTWF4WCxcclxuICAgICAgICAgICAgICAgIHNpbmdsZVRpbGVNYXhZLFxyXG4gICAgICAgICAgICAgICAgaW1hZ2VQYXJ0UGFyYW1zTm90TmVlZGVkKTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBpZiAoaXNUaWxlTm90TmVlZGVkKSB7XHJcbiAgICAgICAgICAgICAgICAtLWxpc3RlbmVySGFuZGxlLnJlbWFpbmluZ0RlY29kZUpvYnM7XHJcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgdmFyIHNpbmdsZVRpbGVJbWFnZVBhcnRQYXJhbXMgPSB7XHJcbiAgICAgICAgICAgICAgICBtaW5YOiB4LFxyXG4gICAgICAgICAgICAgICAgbWluWTogeSxcclxuICAgICAgICAgICAgICAgIG1heFhFeGNsdXNpdmU6IHNpbmdsZVRpbGVNYXhYLFxyXG4gICAgICAgICAgICAgICAgbWF4WUV4Y2x1c2l2ZTogc2luZ2xlVGlsZU1heFksXHJcbiAgICAgICAgICAgICAgICBsZXZlbFdpZHRoOiBpbWFnZVBhcnRQYXJhbXMubGV2ZWxXaWR0aCxcclxuICAgICAgICAgICAgICAgIGxldmVsSGVpZ2h0OiBpbWFnZVBhcnRQYXJhbXMubGV2ZWxIZWlnaHQsXHJcbiAgICAgICAgICAgICAgICBsZXZlbDogbGV2ZWwsXHJcbiAgICAgICAgICAgICAgICBxdWFsaXR5OiBxdWFsaXR5LFxyXG4gICAgICAgICAgICAgICAgcmVxdWVzdFByaW9yaXR5RGF0YTogcHJpb3JpdHlEYXRhXHJcbiAgICAgICAgICAgIH07XHJcblxyXG4gICAgICAgICAgICB2YXIgZGVjb2RlSm9iID0gbmV3IERlY29kZUpvYihcclxuICAgICAgICAgICAgICAgIGxpc3RlbmVySGFuZGxlLFxyXG4gICAgICAgICAgICAgICAgc2luZ2xlVGlsZUltYWdlUGFydFBhcmFtcyk7XHJcblxyXG4gICAgICAgICAgICB2YXIgdGFza0hhbmRsZSA9XHJcbiAgICAgICAgICAgICAgICB0aGlzLl9kZWNvZGVEZXBlbmRlbmN5V29ya2Vycy5zdGFydFRhc2soXHJcbiAgICAgICAgICAgICAgICAgICAgc2luZ2xlVGlsZUltYWdlUGFydFBhcmFtcywgZGVjb2RlSm9iKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGxpc3RlbmVySGFuZGxlLnVucmVnaXN0ZXJIYW5kbGVzLnB1c2godGFza0hhbmRsZSk7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgXHJcbiAgICBpZiAoIWxpc3RlbmVySGFuZGxlLmlzVGVybWluYXRlZENhbGxiYWNrQ2FsbGVkICYmXHJcbiAgICAgICAgbGlzdGVuZXJIYW5kbGUucmVtYWluaW5nRGVjb2RlSm9icyA9PT0gMCkge1xyXG4gICAgICAgIFxyXG4gICAgICAgIGxpc3RlbmVySGFuZGxlLmlzVGVybWluYXRlZENhbGxiYWNrQ2FsbGVkID0gdHJ1ZTtcclxuICAgICAgICBsaXN0ZW5lckhhbmRsZS50ZXJtaW5hdGVkQ2FsbGJhY2sobGlzdGVuZXJIYW5kbGUuaXNBbnlEZWNvZGVyQWJvcnRlZCk7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHJldHVybiBsaXN0ZW5lckhhbmRsZTtcclxufTtcclxuXHJcbkRlY29kZUpvYnNQb29sLnByb3RvdHlwZS51bnJlZ2lzdGVyRm9ya2VkSm9icyA9IGZ1bmN0aW9uIHVucmVnaXN0ZXJGb3JrZWRKb2JzKFxyXG4gICAgbGlzdGVuZXJIYW5kbGUpIHtcclxuICAgICAgICAgICAgXHJcbiAgICBpZiAobGlzdGVuZXJIYW5kbGUucmVtYWluaW5nRGVjb2RlSm9icyA9PT0gMCkge1xyXG4gICAgICAgIC8vIEFsbCBqb2JzIGhhcyBhbHJlYWR5IGJlZW4gdGVybWluYXRlZCwgbm8gbmVlZCB0byB1bnJlZ2lzdGVyXHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IGxpc3RlbmVySGFuZGxlLnVucmVnaXN0ZXJIYW5kbGVzLmxlbmd0aDsgKytpKSB7XHJcbiAgICAgICAgbGlzdGVuZXJIYW5kbGUudW5yZWdpc3RlckhhbmRsZXNbaV0udW5yZWdpc3RlcigpO1xyXG4gICAgfVxyXG59O1xyXG5cclxuZnVuY3Rpb24gaXNVbm5lZWRlZChcclxuICAgIG1pblgsIG1pblksIG1heFgsIG1heFksIGltYWdlUGFydFBhcmFtc05vdE5lZWRlZCkge1xyXG4gICAgXHJcbiAgICBpZiAoaW1hZ2VQYXJ0UGFyYW1zTm90TmVlZGVkID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICByZXR1cm4gZmFsc2U7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgaW1hZ2VQYXJ0UGFyYW1zTm90TmVlZGVkLmxlbmd0aDsgKytpKSB7XHJcbiAgICAgICAgdmFyIG5vdE5lZWRlZCA9IGltYWdlUGFydFBhcmFtc05vdE5lZWRlZFtpXTtcclxuICAgICAgICB2YXIgaXNJblggPSBtaW5YID49IG5vdE5lZWRlZC5taW5YICYmIG1heFggPD0gbm90TmVlZGVkLm1heFhFeGNsdXNpdmU7XHJcbiAgICAgICAgdmFyIGlzSW5ZID0gbWluWSA+PSBub3ROZWVkZWQubWluWSAmJiBtYXhZIDw9IG5vdE5lZWRlZC5tYXhZRXhjbHVzaXZlO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGlmIChpc0luWCAmJiBpc0luWSkge1xyXG4gICAgICAgICAgICByZXR1cm4gdHJ1ZTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHJldHVybiBmYWxzZTtcclxufSIsIid1c2Ugc3RyaWN0JztcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gRmV0Y2hKb2I7XHJcblxyXG5GZXRjaEpvYi5GRVRDSF9UWVBFX1JFUVVFU1QgPSAxO1xyXG5GZXRjaEpvYi5GRVRDSF9UWVBFX0NIQU5ORUwgPSAyOyAvLyBtb3ZhYmxlXHJcbkZldGNoSm9iLkZFVENIX1RZUEVfT05MWV9XQUlUX0ZPUl9EQVRBID0gMztcclxuXHJcbkZldGNoSm9iLkZFVENIX1NUQVRVU19XQUlUX0ZPUl9GRVRDSF9DQUxMID0gMTtcclxuRmV0Y2hKb2IuRkVUQ0hfU1RBVFVTX1JFUVVFU1RfV0FJVF9GT1JfU0NIRURVTEUgPSAyO1xyXG5GZXRjaEpvYi5GRVRDSF9TVEFUVVNfQUNUSVZFID0gMztcclxuRmV0Y2hKb2IuRkVUQ0hfU1RBVFVTX1JFUVVFU1RfQUJPVVRfVE9fWUlFTEQgPSA0O1xyXG5GZXRjaEpvYi5GRVRDSF9TVEFUVVNfUkVRVUVTVF9ZSUVMREVEID0gNjtcclxuRmV0Y2hKb2IuRkVUQ0hfU1RBVFVTX1JFUVVFU1RfQUJPVVRfVE9fQUJPUlQgPSA4O1xyXG5GZXRjaEpvYi5GRVRDSF9TVEFUVVNfUkVRVUVTVF9URVJNSU5BVEVEID0gOTtcclxuRmV0Y2hKb2IuRkVUQ0hfU1RBVFVTX1VORVhQRUNURURfRkFJTFVSRSA9IDEwO1xyXG5cclxuZnVuY3Rpb24gRmV0Y2hKb2IoZmV0Y2hlciwgc2NoZWR1bGVyLCBzY2hlZHVsZWRKb2JzTGlzdCwgZmV0Y2hUeXBlLCBjb250ZXh0VmFycykge1xyXG4gICAgdGhpcy5fZmV0Y2hlciA9IGZldGNoZXI7XHJcbiAgICB0aGlzLl9zY2hlZHVsZXIgPSBzY2hlZHVsZXI7XHJcbiAgICB0aGlzLl9zY2hlZHVsZWRKb2JzTGlzdCA9IHNjaGVkdWxlZEpvYnNMaXN0O1xyXG4gICAgdGhpcy5fc2NoZWR1bGVkSm9ic0xpc3RJdGVyYXRvciA9IG51bGw7XHJcbiAgICBcclxuICAgIHRoaXMuX3Rlcm1pbmF0ZWRMaXN0ZW5lcnMgPSBbXTtcclxuICAgIFxyXG4gICAgdGhpcy5faW1hZ2VQYXJ0UGFyYW1zID0gbnVsbDtcclxuICAgIFxyXG4gICAgdGhpcy5fc3RhdGUgPSBGZXRjaEpvYi5GRVRDSF9TVEFUVVNfV0FJVF9GT1JfRkVUQ0hfQ0FMTDtcclxuICAgIHRoaXMuX2lzQ2hhbm5lbCA9IGZldGNoVHlwZSA9PT0gRmV0Y2hKb2IuRkVUQ0hfVFlQRV9DSEFOTkVMO1xyXG4gICAgdGhpcy5fY29udGV4dFZhcnMgPSBjb250ZXh0VmFycztcclxuICAgIHRoaXMuX2lzT25seVdhaXRGb3JEYXRhID0gZmV0Y2hUeXBlID09PSBGZXRjaEpvYi5GRVRDSF9UWVBFX09OTFlfV0FJVF9GT1JfREFUQTtcclxuICAgIHRoaXMuX3VzZVNjaGVkdWxlciA9IGZldGNoVHlwZSA9PT0gRmV0Y2hKb2IuRkVUQ0hfVFlQRV9SRVFVRVNUO1xyXG4gICAgdGhpcy5fcmVzb3VyY2UgPSBudWxsO1xyXG4gICAgdGhpcy5fZmV0Y2hIYW5kbGUgPSBudWxsO1xyXG4gICAgdGhpcy5fZmV0Y2hUZXJtaW5hdGVkQm91bmQgPSB0aGlzLl9mZXRjaFRlcm1pbmF0ZWQuYmluZCh0aGlzKTtcclxuICAgIC8vdGhpcy5fYWxyZWFkeVRlcm1pbmF0ZWRXaGVuQWxsRGF0YUFycml2ZWQgPSBmYWxzZTtcclxuICAgIFxyXG4gICAgaWYgKGZldGNoVHlwZSA9PT0gRmV0Y2hKb2IuRkVUQ0hfVFlQRV9DSEFOTkVMKSB7XHJcbiAgICAgICAgdGhpcy5fbW92YWJsZUZldGNoU3RhdGUgPSB7fTtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgICAgdGhpcy5fbW92YWJsZUZldGNoU3RhdGUgPSBudWxsO1xyXG4gICAgfVxyXG59XHJcblxyXG5GZXRjaEpvYi5wcm90b3R5cGUuZmV0Y2ggPSBmdW5jdGlvbiBmZXRjaChpbWFnZVBhcnRQYXJhbXMpIHtcclxuICAgIGlmICh0aGlzLl9pc0NoYW5uZWwpIHtcclxuICAgICAgICB0aGlzLl9pbWFnZVBhcnRQYXJhbXMgPSBpbWFnZVBhcnRQYXJhbXM7XHJcbiAgICAgICAgdGhpcy5fc3RhcnRGZXRjaCgpO1xyXG4gICAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIFxyXG4gICAgaWYgKHRoaXMuX2ltYWdlUGFydFBhcmFtcyAhPT0gbnVsbCkge1xyXG4gICAgICAgIHRocm93ICdDYW5ub3QgZmV0Y2ggdHdpY2Ugb24gZmV0Y2ggdHlwZSBvZiBcInJlcXVlc3RcIic7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGlmICh0aGlzLl9zdGF0ZSAhPT0gRmV0Y2hKb2IuRkVUQ0hfU1RBVFVTX1dBSVRfRk9SX0ZFVENIX0NBTEwpIHtcclxuICAgICAgICB0aGlzLl9zdGF0ZSA9IEZldGNoSm9iLkZFVENIX1NUQVRVU19VTkVYUEVDVEVEX0ZBSUxVUkU7XHJcbiAgICAgICAgdGhyb3cgJ1VuZXhwZWN0ZWQgc3RhdGUgb24gZmV0Y2goKTogJyArIHRoaXMuX3N0YXRlO1xyXG4gICAgfVxyXG5cclxuICAgIHRoaXMuX2ltYWdlUGFydFBhcmFtcyA9IGltYWdlUGFydFBhcmFtcztcclxuICAgIHRoaXMuX3N0YXRlID0gRmV0Y2hKb2IuRkVUQ0hfU1RBVFVTX1JFUVVFU1RfV0FJVF9GT1JfU0NIRURVTEU7XHJcbiAgICBcclxuICAgIGlmICghdGhpcy5fdXNlU2NoZWR1bGVyKSB7XHJcbiAgICAgICAgc3RhcnRSZXF1ZXN0KC8qcmVzb3VyY2U9Ki9udWxsLCB0aGlzKTtcclxuICAgICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHRoaXMuX3NjaGVkdWxlci5lbnF1ZXVlSm9iKHN0YXJ0UmVxdWVzdCwgdGhpcywgZmV0Y2hBYm9ydGVkQnlTY2hlZHVsZXIpO1xyXG59O1xyXG5cclxuRmV0Y2hKb2IucHJvdG90eXBlLm1hbnVhbEFib3J0UmVxdWVzdCA9IGZ1bmN0aW9uIG1hbnVhbEFib3J0UmVxdWVzdCgpIHtcclxuICAgIHN3aXRjaCAodGhpcy5fc3RhdGUpIHtcclxuICAgICAgICBjYXNlIEZldGNoSm9iLkZFVENIX1NUQVRVU19SRVFVRVNUX1RFUk1JTkFURUQ6XHJcbiAgICAgICAgY2FzZSBGZXRjaEpvYi5GRVRDSF9TVEFUVVNfVU5FWFBFQ1RFRF9GQUlMVVJFOlxyXG4gICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgY2FzZSBGZXRjaEpvYi5GRVRDSF9TVEFUVVNfUkVRVUVTVF9BQk9VVF9UT19BQk9SVDpcclxuICAgICAgICAgICAgdGhyb3cgJ0RvdWJsZSBjYWxsIHRvIG1hbnVhbEFib3J0UmVxdWVzdCgpJztcclxuICAgICAgICBjYXNlIEZldGNoSm9iLkZFVENIX1NUQVRVU19BQ1RJVkU6XHJcbiAgICAgICAgICAgIHZhciBzZWxmID0gdGhpcztcclxuICAgICAgICAgICAgdGhpcy5fc3RhdGUgPSBGZXRjaEpvYi5GRVRDSF9TVEFUVVNfUkVRVUVTVF9BQk9VVF9UT19BQk9SVDtcclxuICAgICAgICAgICAgaWYgKHNlbGYuX2lzT25seVdhaXRGb3JEYXRhKSB7XHJcbiAgICAgICAgICAgICAgICBzZWxmLl9mZXRjaFRlcm1pbmF0ZWQoLyppc0Fib3J0ZWQ9Ki90cnVlKTtcclxuICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgIHRoaXMuX2ZldGNoSGFuZGxlLnN0b3BBc3luYygpLnRoZW4oZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgc2VsZi5fZmV0Y2hUZXJtaW5hdGVkKC8qaXNBYm9ydGVkPSovdHJ1ZSk7XHJcbiAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBicmVhaztcclxuICAgICAgICBjYXNlIEZldGNoSm9iLkZFVENIX1NUQVRVU19XQUlUX0ZPUl9GRVRDSF9DQUxMOlxyXG4gICAgICAgICAgICB0aGlzLl9zdGF0ZSA9IEZldGNoSm9iLkZFVENIX1NUQVRVU19SRVFVRVNUX1RFUk1JTkFURUQ7XHJcbiAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICBjYXNlIEZldGNoSm9iLkZFVENIX1NUQVRVU19SRVFVRVNUX1dBSVRfRk9SX1NDSEVEVUxFOlxyXG4gICAgICAgIGNhc2UgRmV0Y2hKb2IuRkVUQ0hfU1RBVFVTX1JFUVVFU1RfQUJPVVRfVE9fWUlFTEQ6XHJcbiAgICAgICAgY2FzZSBGZXRjaEpvYi5GRVRDSF9TVEFUVVNfUkVRVUVTVF9ZSUVMREVEOlxyXG4gICAgICAgICAgICB0aGlzLl9zdGF0ZSA9IEZldGNoSm9iLkZFVENIX1NUQVRVU19SRVFVRVNUX0FCT1VUX1RPX0FCT1JUO1xyXG4gICAgICAgICAgICBicmVhaztcclxuICAgICAgICBkZWZhdWx0OlxyXG4gICAgICAgICAgICB0aHJvdyAnVW5rbm93biBzdGF0ZSBpbiBtYW51YWxBYm9ydFJlcXVlc3QoKSBpbXBsZW1lbnRhdGlvbjogJyArIHRoaXMuX3N0YXRlO1xyXG4gICAgfVxyXG59O1xyXG5cclxuRmV0Y2hKb2IucHJvdG90eXBlLmdldENvbnRleHRWYXJzID0gZnVuY3Rpb24gZ2V0Q29udGV4dFZhcnMocmVxdWVzdElkKSB7XHJcbiAgICByZXR1cm4gdGhpcy5fY29udGV4dFZhcnM7XHJcbn07XHJcblxyXG5GZXRjaEpvYi5wcm90b3R5cGUub24gPSBmdW5jdGlvbiBvbihldmVudCwgbGlzdGVuZXIpIHtcclxuICAgIHN3aXRjaCAoZXZlbnQpIHtcclxuICAgICAgICBjYXNlICd0ZXJtaW5hdGVkJzpcclxuICAgICAgICAgICAgdGhpcy5fdGVybWluYXRlZExpc3RlbmVycy5wdXNoKGxpc3RlbmVyKTtcclxuICAgICAgICAgICAgYnJlYWs7XHJcbiAgICAgICAgZGVmYXVsdDpcclxuICAgICAgICAgICAgdGhyb3cgJ1VuZXhwZWN0ZWQgZXZlbnQgJyArIGV2ZW50O1xyXG4gICAgfVxyXG59O1xyXG5cclxuRmV0Y2hKb2IucHJvdG90eXBlLnNldElzUHJvZ3Jlc3NpdmUgPSBmdW5jdGlvbiBzZXRJc1Byb2dyZXNzaXZlKGlzUHJvZ3Jlc3NpdmUpIHtcclxuICAgIHRoaXMuX2lzUHJvZ3Jlc3NpdmUgPSBpc1Byb2dyZXNzaXZlO1xyXG4gICAgaWYgKHRoaXMuX2ZldGNoSGFuZGxlICE9PSBudWxsKSB7XHJcbiAgICAgICAgdGhpcy5fZmV0Y2hIYW5kbGUuc2V0SXNQcm9ncmVzc2l2ZShpc1Byb2dyZXNzaXZlKTtcclxuICAgIH1cclxufTtcclxuXHJcbkZldGNoSm9iLnByb3RvdHlwZS5nZXRJc1Byb2dyZXNzaXZlID0gZnVuY3Rpb24gZ2V0SXNQcm9ncmVzc2l2ZSgpIHtcclxuICAgIHJldHVybiB0aGlzLl9pc1Byb2dyZXNzaXZlO1xyXG59O1xyXG5cclxuRmV0Y2hKb2IucHJvdG90eXBlLl9zdGFydEZldGNoID0gZnVuY3Rpb24gc3RhcnRGZXRjaCgpIHtcclxuICAgIHZhciBwcmV2U3RhdGUgPSB0aGlzLl9zdGF0ZTtcclxuICAgIHRoaXMuX3N0YXRlID0gRmV0Y2hKb2IuRkVUQ0hfU1RBVFVTX0FDVElWRTtcclxuICAgIFxyXG4gICAgaWYgKHRoaXMuX2lzT25seVdhaXRGb3JEYXRhKSB7XHJcbiAgICAgICAgdGhpcy5fZmV0Y2hIYW5kbGUgPSB0aGlzLl9leHRyYWN0QWxyZWFkeUZldGNoZWREYXRhKCk7XHJcbiAgICB9IGVsc2UgaWYgKCF0aGlzLl9pc0NoYW5uZWwpIHtcclxuICAgICAgICB0aGlzLl9mZXRjaEhhbmRsZSA9IHRoaXMuX2ZldGNoZXIuZmV0Y2godGhpcy5faW1hZ2VQYXJ0UGFyYW1zKTtcclxuICAgIH0gZWxzZSBpZiAocHJldlN0YXRlICE9PSBGZXRjaEpvYi5GRVRDSF9TVEFUVVNfV0FJVF9GT1JfRkVUQ0hfQ0FMTCkge1xyXG4gICAgICAgIHRoaXMuX2ZldGNoSGFuZGxlID0gdGhpcy5fZmV0Y2hlci5tb3ZlRmV0Y2goXHJcbiAgICAgICAgICAgIHRoaXMuX2ltYWdlUGFydFBhcmFtcywgdGhpcy5fbW92YWJsZUZldGNoU3RhdGUpO1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgICB0aGlzLl9mZXRjaEhhbmRsZSA9IHRoaXMuX2ZldGNoZXIuc3RhcnRNb3ZhYmxlRmV0Y2goXHJcbiAgICAgICAgICAgIHRoaXMuX2ltYWdlUGFydFBhcmFtcywgdGhpcy5fbW92YWJsZUZldGNoU3RhdGUpO1xyXG4gICAgfVxyXG4gICAgdGhpcy5fZmV0Y2hIYW5kbGUub24oJ3Rlcm1pbmF0ZWQnLCB0aGlzLl9mZXRjaFRlcm1pbmF0ZWRCb3VuZCk7XHJcbiAgICB0aGlzLl9mZXRjaEhhbmRsZS5zZXRJc1Byb2dyZXNzaXZlKHRoaXMuX2lzUHJvZ3Jlc3NpdmUpO1xyXG59O1xyXG5cclxuRmV0Y2hKb2IucHJvdG90eXBlLl9mZXRjaFRlcm1pbmF0ZWQgPSBmdW5jdGlvbiBmZXRjaFRlcm1pbmF0ZWQoaXNBYm9ydGVkKSB7XHJcbiAgICBzd2l0Y2ggKHRoaXMuX3N0YXRlKSB7XHJcbiAgICAgICAgY2FzZSBGZXRjaEpvYi5GRVRDSF9TVEFUVVNfUkVRVUVTVF9BQk9VVF9UT19BQk9SVDpcclxuICAgICAgICAgICAgYnJlYWs7XHJcbiAgICAgICAgY2FzZSBGZXRjaEpvYi5GRVRDSF9TVEFUVVNfQUNUSVZFOlxyXG4gICAgICAgIGNhc2UgRmV0Y2hKb2IuRkVUQ0hfU1RBVFVTX1JFUVVFU1RfQUJPVVRfVE9fWUlFTEQ6XHJcbiAgICAgICAgICAgIGlmIChpc0Fib3J0ZWQpIHtcclxuICAgICAgICAgICAgICAgIHRoaXMuX3N0YXRlID0gRmV0Y2hKb2IuRkVUQ0hfU1RBVFVTX1VORVhQRUNURURfRkFJTFVSRTtcclxuICAgICAgICAgICAgICAgIHRocm93ICdVbmV4cGVjdGVkIGFib3J0IHdoZW4gZmV0Y2ggaXMgYWN0aXZlJztcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBicmVhaztcclxuICAgICAgICBkZWZhdWx0OlxyXG4gICAgICAgICAgICB0aHJvdyAnVW5leHBlY3RlZCBzdGF0ZSBvbiBmZXRjaCB0ZXJtaW5hdGVkOiAnICsgdGhpcy5fc3RhdGU7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGlmICh0aGlzLl9yZXNvdXJjZSAhPT0gbnVsbCkge1xyXG4gICAgICAgIGlmIChpc0Fib3J0ZWQpIHtcclxuICAgICAgICAgICAgdGhyb3cgJ1VuZXhwZWN0ZWQgcmVxdWVzdCB0ZXJtaW5hdGlvbiB3aXRob3V0IHJlc291cmNlIGFsbG9jYXRlZCc7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICB0aGlzLl9zY2hlZHVsZWRKb2JzTGlzdC5yZW1vdmUodGhpcy5fc2NoZWR1bGVkSm9ic0xpc3RJdGVyYXRvcik7XHJcbiAgICAgICAgdGhpcy5fc2NoZWR1bGVyQ2FsbGJhY2tzLmpvYkRvbmUoKTtcclxuXHJcbiAgICAgICAgdGhpcy5fcmVzb3VyY2UgPSBudWxsO1xyXG4gICAgfSBlbHNlIGlmICghaXNBYm9ydGVkICYmIHRoaXMuX3VzZVNjaGVkdWxlcikge1xyXG4gICAgICAgIHRocm93ICdKb2IgZXhwZWN0ZWQgdG8gaGF2ZSByZXNvdXJjZSBvbiBzdWNjZXNzZnVsIHRlcm1pbmF0aW9uJztcclxuICAgIH1cclxuICAgIFxyXG4gICAgLy8gQ2hhbm5lbCBpcyBub3QgcmVhbGx5IHRlcm1pbmF0ZWQsIGJ1dCBvbmx5IGZldGNoZXMgYSBuZXcgcmVnaW9uXHJcbiAgICAvLyAoc2VlIG1vdmVDaGFubmVsKCkpLlxyXG4gICAgaWYgKHRoaXMuX2lzQ2hhbm5lbCkge1xyXG5cdFx0cmV0dXJuO1xyXG5cdH1cclxuXHRcclxuXHR0aGlzLl9zdGF0ZSA9IEZldGNoSm9iLkZFVENIX1NUQVRVU19SRVFVRVNUX1RFUk1JTkFURUQ7XHJcblx0XHJcblx0Zm9yICh2YXIgaSA9IDA7IGkgPCB0aGlzLl90ZXJtaW5hdGVkTGlzdGVuZXJzLmxlbmd0aDsgKytpKSB7XHJcblx0XHR0aGlzLl90ZXJtaW5hdGVkTGlzdGVuZXJzW2ldKHRoaXMuX2NvbnRleHRWYXJzLCBpc0Fib3J0ZWQpO1xyXG5cdH1cclxuICAgIFxyXG4gICAgaWYgKHRoaXMuX2ZldGNoSGFuZGxlICE9PSBudWxsICYmXHJcbiAgICAgICAgdGhpcy5fc3RhdGUgIT09IEZldGNoSm9iLkZFVENIX1NUQVRVU19VTkVYUEVDVEVEX0ZBSUxVUkUpIHtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgdGhpcy5fZmV0Y2hIYW5kbGUuZGlzcG9zZSgpO1xyXG4gICAgICAgIHRoaXMuX2ZldGNoSGFuZGxlID0gbnVsbDtcclxuICAgIH1cclxufTtcclxuXHJcbkZldGNoSm9iLnByb3RvdHlwZS5jaGVja0lmU2hvdWxkWWllbGQgPSBmdW5jdGlvbiBjaGVja0lmU2hvdWxkWWllbGQoKSB7XHJcbiAgICB0cnkge1xyXG4gICAgICAgIGlmICghdGhpcy5fdXNlU2NoZWR1bGVyIHx8IHRoaXMuX3N0YXRlID09PSBGZXRjaEpvYi5GRVRDSF9TVEFUVVNfUkVRVUVTVF9URVJNSU5BVEVEKSB7XHJcbiAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKHRoaXMuX3Jlc291cmNlID09PSBudWxsKSB7XHJcbiAgICAgICAgICAgIHRocm93ICdObyByZXNvdXJjZSBhbGxvY2F0ZWQgYnV0IGZldGNoIGNhbGxiYWNrIGNhbGxlZCc7XHJcbiAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICBpZiAoIXRoaXMuX3NjaGVkdWxlckNhbGxiYWNrcy5zaG91bGRZaWVsZE9yQWJvcnQoKSkge1xyXG4gICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHRoaXMuX3N0YXRlID0gRmV0Y2hKb2IuRkVUQ0hfU1RBVFVTX1JFUVVFU1RfQUJPVVRfVE9fWUlFTEQ7XHJcbiAgICAgICAgdmFyIHNlbGYgPSB0aGlzO1xyXG4gICAgICAgIHRoaXMuX2ZldGNoSGFuZGxlLnN0b3BBc3luYygpLnRoZW4oZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgICAgIGlmIChzZWxmLl9mZXRjaFN0YXRlID09PSBGZXRjaEpvYi5GRVRDSF9TVEFUVVNfUkVRVUVTVF9BQk9VVF9UT19BQk9SVCkge1xyXG4gICAgICAgICAgICAgICAgc2VsZi5fZmV0Y2hUZXJtaW5hdGVkKC8qaXNBYm9ydGVkPSovdHJ1ZSk7XHJcbiAgICAgICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHZhciBpc1lpZWxkZWQgPSBzZWxmLl9zY2hlZHVsZXJDYWxsYmFja3MudHJ5WWllbGQoXHJcbiAgICAgICAgICAgICAgICBjb250aW51ZVlpZWxkZWRSZXF1ZXN0LFxyXG4gICAgICAgICAgICAgICAgZmV0Y2hBYm9ydGVkQnlTY2hlZHVsZXIsXHJcbiAgICAgICAgICAgICAgICBmZXRjaFlpZWxkZWRCeVNjaGVkdWxlcik7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBpZiAoIWlzWWllbGRlZCkge1xyXG4gICAgICAgICAgICAgICAgaWYgKHNlbGYuX3N0YXRlICE9PSBGZXRjaEpvYi5GRVRDSF9TVEFUVVNfUkVRVUVTVF9BQk9VVF9UT19ZSUVMRCkge1xyXG4gICAgICAgICAgICAgICAgICAgIHRocm93ICdVbmV4cGVjdGVkIHN0YXRlIG9uIHRyeVlpZWxkKCkgZmFsc2U6ICcgKyBzZWxmLl9zdGF0ZTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIHNlbGYuX3N0YXRlID0gRmV0Y2hKb2IuRkVUQ0hfU1RBVFVTX0FDVElWRTtcclxuICAgICAgICAgICAgICAgIHNlbGYuX2ZldGNoSGFuZGxlLnJlc3VtZSgpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfSkuY2F0Y2goZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgICAgIHNlbGYuX3N0YXRlID0gRmV0Y2hKb2IuRkVUQ0hfU1RBVFVTX1VORVhQRUNURURfRkFJTFVSRTtcclxuICAgICAgICAgICAgZmV0Y2hBYm9ydGVkQnlTY2hlZHVsZXIoc2VsZik7XHJcbiAgICAgICAgfSk7XHJcbiAgICB9IGNhdGNoIChlKSB7XHJcbiAgICAgICAgdGhpcy5fc3RhdGUgPSBGZXRjaEpvYi5GRVRDSF9TVEFUVVNfVU5FWFBFQ1RFRF9GQUlMVVJFO1xyXG4gICAgICAgIGZldGNoQWJvcnRlZEJ5U2NoZWR1bGVyKHRoaXMpO1xyXG4gICAgfVxyXG59O1xyXG5cclxuLy8gUHJvcGVydGllcyBmb3IgRnJ1c3R1bVJlcXVlc2V0UHJpb3JpdGl6ZXJcclxuXHJcbk9iamVjdC5kZWZpbmVQcm9wZXJ0eShGZXRjaEpvYi5wcm90b3R5cGUsICdpbWFnZVBhcnRQYXJhbXMnLCB7XHJcbiAgICBnZXQ6IGZ1bmN0aW9uIGdldEltYWdlUGFydFBhcmFtcygpIHtcclxuICAgICAgICByZXR1cm4gdGhpcy5faW1hZ2VQYXJ0UGFyYW1zO1xyXG4gICAgfVxyXG59KTtcclxuXHJcbmZ1bmN0aW9uIHN0YXJ0UmVxdWVzdChyZXNvdXJjZSwgc2VsZiwgY2FsbGJhY2tzKSB7XHJcbiAgICBpZiAoc2VsZi5fZmV0Y2hIYW5kbGUgIT09IG51bGwgfHwgc2VsZi5fcmVzb3VyY2UgIT09IG51bGwpIHtcclxuICAgICAgICB0aHJvdyAnVW5leHBlY3RlZCByZXN0YXJ0IG9mIGFscmVhZHkgc3RhcnRlZCByZXF1ZXN0JztcclxuICAgIH1cclxuICAgIFxyXG4gICAgaWYgKHNlbGYuX3N0YXRlID09PSBGZXRjaEpvYi5GRVRDSF9TVEFUVVNfUkVRVUVTVF9BQk9VVF9UT19BQk9SVCkge1xyXG4gICAgICAgIHNlbGYuX2ZldGNoVGVybWluYXRlZCgvKmlzQWJvcnRlZD0qL3RydWUpO1xyXG4gICAgICAgIHJldHVybjtcclxuICAgIH0gZWxzZSBpZiAoc2VsZi5fc3RhdGUgIT09IEZldGNoSm9iLkZFVENIX1NUQVRVU19SRVFVRVNUX1dBSVRfRk9SX1NDSEVEVUxFKSB7XHJcbiAgICAgICAgdGhyb3cgJ1VuZXhwZWN0ZWQgc3RhdGUgb24gc2NoZWR1bGU6ICcgKyBzZWxmLl9zdGF0ZTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgc2VsZi5fcmVzb3VyY2UgPSByZXNvdXJjZTtcclxuXHRzZWxmLl9zY2hlZHVsZXJDYWxsYmFja3MgPSBjYWxsYmFja3M7XHJcblxyXG4gICAgaWYgKHJlc291cmNlICE9PSBudWxsKSB7XHJcbiAgICAgICAgc2VsZi5fc2NoZWR1bGVkSm9ic0xpc3RJdGVyYXRvciA9IHNlbGYuX3NjaGVkdWxlZEpvYnNMaXN0LmFkZChzZWxmKTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgc2VsZi5fc3RhcnRGZXRjaCgpO1xyXG59XHJcblxyXG5mdW5jdGlvbiBjb250aW51ZVlpZWxkZWRSZXF1ZXN0KHJlc291cmNlLCBzZWxmKSB7XHJcbiAgICBpZiAoc2VsZi5pc0NoYW5uZWwpIHtcclxuICAgICAgICB0aHJvdyAnVW5leHBlY3RlZCBjYWxsIHRvIGNvbnRpbnVlWWllbGRlZFJlcXVlc3Qgb24gY2hhbm5lbCc7XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKHNlbGYuX3N0YXRlID09PSBGZXRjaEpvYi5GRVRDSF9TVEFUVVNfUkVRVUVTVF9BQk9VVF9UT19BQk9SVCB8fFxyXG4gICAgICAgIHNlbGYuX3N0YXRlID09PSBGZXRjaEpvYi5GRVRDSF9TVEFUVVNfVU5FWFBFQ1RFRF9GQUlMVVJFKSB7XHJcbiAgICAgICAgXHJcbiAgICAgICAgc2VsZi5fc2NoZWR1bGVyQ2FsbGJhY2tzLmpvYkRvbmUoKTtcclxuICAgICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGlmIChzZWxmLl9zdGF0ZSAhPT0gRmV0Y2hKb2IuRkVUQ0hfU1RBVFVTX1JFUVVFU1RfWUlFTERFRCkge1xyXG4gICAgICAgIHRocm93ICdVbmV4cGVjdGVkIHJlcXVlc3Qgc3RhdGUgb24gY29udGludWU6ICcgKyBzZWxmLl9zdGF0ZTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgc2VsZi5fc3RhdGUgPSBGZXRjaEpvYi5GRVRDSF9TVEFUVVNfQUNUSVZFO1xyXG4gICAgc2VsZi5fcmVzb3VyY2UgPSByZXNvdXJjZTtcclxuICAgIFxyXG4gICAgc2VsZi5fc2NoZWR1bGVkSm9ic0xpc3RJdGVyYXRvciA9IHNlbGYuX3NjaGVkdWxlZEpvYnNMaXN0LmFkZChzZWxmKTtcclxuICAgIHNlbGYuX2ZldGNoSGFuZGxlLnJlc3VtZSgpO1xyXG59XHJcblxyXG5mdW5jdGlvbiBmZXRjaFlpZWxkZWRCeVNjaGVkdWxlcihzZWxmKSB7XHJcbiAgICB2YXIgbmV4dFN0YXRlO1xyXG4gICAgc2VsZi5fcmVzb3VyY2UgPSBudWxsO1xyXG4gICAgc2VsZi5fc2NoZWR1bGVkSm9ic0xpc3QucmVtb3ZlKHNlbGYuX3NjaGVkdWxlZEpvYnNMaXN0SXRlcmF0b3IpO1xyXG4gICAgaWYgKHNlbGYuc3RhdGUgPT09IEZldGNoSm9iLkZFVENIX1NUQVRVU19SRVFVRVNUX0FCT1VUX1RPX1lJRUxEKSB7XHJcbiAgICAgICAgc2VsZi5fc3RhdGUgPSBGZXRjaEpvYi5GRVRDSF9TVEFUVVNfUkVRVUVTVF9ZSUVMREVEO1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgICBzZWxmLl9zdGF0ZSA9IEZldGNoSm9iLkZFVENIX1NUQVRVU19VTkVYUEVDVEVEX0ZBSUxVUkU7XHJcbiAgICAgICAgdGhyb3cgJ1VuZXhwZWN0ZWQgcmVxdWVzdCBzdGF0ZSBvbiB5aWVsZCBwcm9jZXNzOiAnICsgc2VsZi5fc3RhdGU7XHJcbiAgICB9XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGZldGNoQWJvcnRlZEJ5U2NoZWR1bGVyKHNlbGYpIHtcclxuICAgIHNlbGYuX3Jlc291cmNlID0gbnVsbDtcclxuICAgIHNlbGYuX2ZldGNoVGVybWluYXRlZCgvKmlzQWJvcnRlZD0qL3RydWUpO1xyXG59IiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBGZXRjaE1hbmFnZXI7XHJcblxyXG52YXIgaW1hZ2VIZWxwZXJGdW5jdGlvbnMgPSByZXF1aXJlKCdpbWFnZWhlbHBlcmZ1bmN0aW9ucy5qcycpO1xyXG52YXIgRmV0Y2hKb2IgPSByZXF1aXJlKCdmZXRjaGpvYi5qcycpO1xyXG52YXIgSW1hZ2VQYXJhbXNSZXRyaWV2ZXJQcm94eSA9IHJlcXVpcmUoJ2ltYWdlcGFyYW1zcmV0cmlldmVycHJveHkuanMnKTtcclxudmFyIExpbmtlZExpc3QgPSByZXF1aXJlKCdsaW5rZWRsaXN0LmpzJyk7XHJcblxyXG4vKiBnbG9iYWwgY29uc29sZTogZmFsc2UgKi9cclxuLyogZ2xvYmFsIFByb21pc2U6IGZhbHNlICovXHJcblxyXG5mdW5jdGlvbiBGZXRjaE1hbmFnZXIoZmV0Y2hlciwgb3B0aW9ucykge1xyXG4gICAgSW1hZ2VQYXJhbXNSZXRyaWV2ZXJQcm94eS5jYWxsKHRoaXMpO1xyXG5cclxuICAgIG9wdGlvbnMgPSBvcHRpb25zIHx8IHt9O1xyXG4gICAgdmFyIHNlcnZlclJlcXVlc3RzTGltaXQgPSBvcHRpb25zLnNlcnZlclJlcXVlc3RzTGltaXQgfHwgNTtcclxuICAgIFxyXG4gICAgdGhpcy5fZmV0Y2hlciA9IGZldGNoZXI7XHJcbiAgICB0aGlzLl9pbnRlcm5hbFNpemVzUGFyYW1zID0gbnVsbDtcclxuICAgIHRoaXMuX3Nob3dMb2cgPSBvcHRpb25zLnNob3dMb2c7XHJcbiAgICBcclxuICAgIGlmICh0aGlzLl9zaG93TG9nKSB7XHJcbiAgICAgICAgLy8gT2xkIElFXHJcbiAgICAgICAgdGhyb3cgJ3Nob3dMb2cgaXMgbm90IHN1cHBvcnRlZCBvbiB0aGlzIGJyb3dzZXInO1xyXG4gICAgfVxyXG5cdFxyXG5cdGlmICghZmV0Y2hlci5vbikge1xyXG5cdFx0dGhyb3cgJ0ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogRmV0Y2hlciBoYXMgbm8gbWV0aG9kIG9uKCknO1xyXG5cdH1cclxuXHRpZiAoIWZldGNoZXIub3Blbikge1xyXG5cdFx0dGhyb3cgJ0ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogRmV0Y2hlciBoYXMgbm8gbWV0aG9kIG9wZW4oKSc7XHJcblx0fVxyXG4gICAgaWYgKCFmZXRjaGVyLmNsb3NlKSB7XHJcblx0XHR0aHJvdyAnSW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBGZXRjaGVyIGhhcyBubyBtZXRob2QgY2xvc2UoKSc7XHJcblx0fVxyXG4gICAgaWYgKCFmZXRjaGVyLnJlY29ubmVjdCkge1xyXG5cdFx0dGhyb3cgJ0ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogRmV0Y2hlciBoYXMgbm8gbWV0aG9kIHJlY29ubmVjdCgpJztcclxuXHR9XHJcbiAgICBpZiAoIWZldGNoZXIuZmV0Y2gpIHtcclxuXHRcdHRocm93ICdJbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IEZldGNoZXIgaGFzIG5vIG1ldGhvZCBmZXRjaCgpJztcclxuXHR9XHJcbiAgICBpZiAoIWZldGNoZXIubW92ZUZldGNoKSB7XHJcblx0XHR0aHJvdyAnSW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBGZXRjaGVyIGhhcyBubyBtZXRob2QgbW92ZUZldGNoKCknO1xyXG5cdH1cclxuICAgIGlmICghZmV0Y2hlci5zdGFydE1vdmFibGVGZXRjaCkge1xyXG5cdFx0dGhyb3cgJ0ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogRmV0Y2hlciBoYXMgbm8gbWV0aG9kIHN0YXJ0TW92YWJsZUZldGNoKCknO1xyXG5cdH1cclxuICAgIFxyXG4gICAgdmFyIHNlcnZlclJlcXVlc3RTY2hlZHVsZXIgPSBpbWFnZUhlbHBlckZ1bmN0aW9ucy5jcmVhdGVTY2hlZHVsZXIoXHJcbiAgICAgICAgb3B0aW9ucy5zaG93TG9nLFxyXG4gICAgICAgIG9wdGlvbnMuc2VydmVyUmVxdWVzdFByaW9yaXRpemVyLFxyXG4gICAgICAgICdzZXJ2ZXJSZXF1ZXN0JyxcclxuICAgICAgICBjcmVhdGVTZXJ2ZXJSZXF1ZXN0RHVtbXlSZXNvdXJjZSxcclxuICAgICAgICBzZXJ2ZXJSZXF1ZXN0c0xpbWl0KTtcclxuICAgIFxyXG4gICAgdGhpcy5fc2VydmVyUmVxdWVzdFByaW9yaXRpemVyID0gc2VydmVyUmVxdWVzdFNjaGVkdWxlci5wcmlvcml0aXplcjtcclxuICAgIFxyXG4gICAgdGhpcy5fc2NoZWR1bGVyID0gc2VydmVyUmVxdWVzdFNjaGVkdWxlci5zY2hlZHVsZXI7XHJcbiAgICB0aGlzLl9jaGFubmVsSGFuZGxlQ291bnRlciA9IDA7XHJcbiAgICB0aGlzLl9jaGFubmVsSGFuZGxlcyA9IFtdO1xyXG4gICAgdGhpcy5fcmVxdWVzdEJ5SWQgPSBbXTtcclxuICAgIHRoaXMuX3NjaGVkdWxlZEpvYnNMaXN0ID0gbmV3IExpbmtlZExpc3QoKTtcclxufVxyXG5cclxuRmV0Y2hNYW5hZ2VyLnByb3RvdHlwZSA9IE9iamVjdC5jcmVhdGUoSW1hZ2VQYXJhbXNSZXRyaWV2ZXJQcm94eS5wcm90b3R5cGUpO1xyXG5cclxuRmV0Y2hNYW5hZ2VyLnByb3RvdHlwZS5vcGVuID0gZnVuY3Rpb24gb3Blbih1cmwpIHtcclxuICAgIHZhciBwcm9taXNlID0gdGhpcy5fZmV0Y2hlci5vcGVuKHVybCk7XHJcbiAgICB2YXIgc2VsZiA9IHRoaXM7XHJcbiAgICByZXR1cm4gcHJvbWlzZS50aGVuKGZ1bmN0aW9uKHJlc3VsdCkge1xyXG4gICAgICAgIHNlbGYuX2ludGVybmFsU2l6ZXNQYXJhbXMgPSByZXN1bHQ7XHJcbiAgICAgICAgcmV0dXJuIHJlc3VsdDtcclxuICAgIH0pO1xyXG59O1xyXG5cclxuRmV0Y2hNYW5hZ2VyLnByb3RvdHlwZS5vbiA9IGZ1bmN0aW9uIG9uKGV2ZW50LCBjYWxsYmFjaykge1xyXG4gICAgdGhpcy5fZmV0Y2hlci5vbihldmVudCwgY2FsbGJhY2spO1xyXG59O1xyXG5cclxuRmV0Y2hNYW5hZ2VyLnByb3RvdHlwZS5jbG9zZSA9IGZ1bmN0aW9uIGNsb3NlKCkge1xyXG4gICAgcmV0dXJuIHRoaXMuX2ZldGNoZXIuY2xvc2UoKTtcclxufTtcclxuXHJcbkZldGNoTWFuYWdlci5wcm90b3R5cGUuc2V0SXNQcm9ncmVzc2l2ZVJlcXVlc3QgPSBmdW5jdGlvbiBzZXRJc1Byb2dyZXNzaXZlUmVxdWVzdChcclxuICAgIHJlcXVlc3RJZCwgaXNQcm9ncmVzc2l2ZSkge1xyXG4gICAgXHJcbiAgICB2YXIgZmV0Y2hKb2IgPSB0aGlzLl9yZXF1ZXN0QnlJZFtyZXF1ZXN0SWRdO1xyXG4gICAgaWYgKGZldGNoSm9iID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICAvLyBUaGlzIHNpdHVhdGlvbiBtaWdodCBvY2N1ciBpZiByZXF1ZXN0IGhhcyBiZWVuIHRlcm1pbmF0ZWQsXHJcbiAgICAgICAgLy8gYnV0IHVzZXIncyB0ZXJtaW5hdGVkQ2FsbGJhY2sgaGFzIG5vdCBiZWVuIGNhbGxlZCB5ZXQuIEl0XHJcbiAgICAgICAgLy8gaGFwcGVucyBvbiBXb3JrZXJQcm94eUZldGNoTWFuYWdlciBkdWUgdG8gdGhyZWFkXHJcbiAgICAgICAgLy8gbWVzc2FnZSBkZWxheS5cclxuICAgICAgICBcclxuICAgICAgICByZXR1cm4gbnVsbDtcclxuICAgIH1cclxuICAgIFxyXG4gICAgZmV0Y2hKb2Iuc2V0SXNQcm9ncmVzc2l2ZShpc1Byb2dyZXNzaXZlKTtcclxufTtcclxuXHJcbkZldGNoTWFuYWdlci5wcm90b3R5cGUuY3JlYXRlQ2hhbm5lbCA9IGZ1bmN0aW9uIGNyZWF0ZUNoYW5uZWwoKSB7XHJcblx0dmFyIHNlbGYgPSB0aGlzO1xyXG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKGZ1bmN0aW9uKHJlc29sdmUsIHJlamVjdCkge1xyXG4gICAgICAgIHZhciBjaGFubmVsSGFuZGxlID0gKytzZWxmLl9jaGFubmVsSGFuZGxlQ291bnRlcjtcclxuICAgICAgICBzZWxmLl9jaGFubmVsSGFuZGxlc1tjaGFubmVsSGFuZGxlXSA9IG5ldyBGZXRjaEpvYihcclxuICAgICAgICAgICAgc2VsZi5fZmV0Y2hlcixcclxuICAgICAgICAgICAgc2VsZi5fc2NoZWR1bGVyLFxyXG4gICAgICAgICAgICBzZWxmLl9zY2hlZHVsZWRKb2JzTGlzdCxcclxuICAgICAgICAgICAgRmV0Y2hKb2IuRkVUQ0hfVFlQRV9DSEFOTkVMLFxyXG4gICAgICAgICAgICAvKmNvbnRleHRWYXJzPSovbnVsbCk7XHJcblxyXG4gICAgICAgIHJlc29sdmUoY2hhbm5lbEhhbmRsZSk7XHJcbiAgICB9KTtcclxufTtcclxuXHJcbkZldGNoTWFuYWdlci5wcm90b3R5cGUubW92ZUNoYW5uZWwgPSBmdW5jdGlvbiBtb3ZlQ2hhbm5lbChcclxuICAgIGNoYW5uZWxIYW5kbGUsIGltYWdlUGFydFBhcmFtcykge1xyXG4gICAgXHJcbiAgICB2YXIgY2hhbm5lbCA9IHRoaXMuX2NoYW5uZWxIYW5kbGVzW2NoYW5uZWxIYW5kbGVdO1xyXG4gICAgY2hhbm5lbC5mZXRjaChpbWFnZVBhcnRQYXJhbXMpO1xyXG59O1xyXG5cclxuRmV0Y2hNYW5hZ2VyLnByb3RvdHlwZS5jcmVhdGVSZXF1ZXN0ID0gZnVuY3Rpb24gY3JlYXRlUmVxdWVzdChcclxuICAgIHJlcXVlc3RJZCwgaW1hZ2VQYXJ0UGFyYW1zKSB7XHJcbiAgICBcclxuICAgIHZhciBjb250ZXh0VmFycyA9IHtcclxuICAgICAgICBwcm9ncmVzc2l2ZVN0YWdlc0RvbmU6IDAsXHJcbiAgICAgICAgaXNMYXN0Q2FsbGJhY2tDYWxsZWRXaXRob3V0TG93UXVhbGl0eUxpbWl0OiBmYWxzZSxcclxuICAgICAgICByZXF1ZXN0SWQ6IHJlcXVlc3RJZCxcclxuICAgICAgICBmZXRjaEpvYjogbnVsbCxcclxuICAgICAgICBzZWxmOiB0aGlzXHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICB2YXIgZmV0Y2hUeXBlID0gLyppc09ubHlXYWl0Rm9yRGF0YSA/XHJcbiAgICAgICAgRmV0Y2hKb2IuRkVUQ0hfVFlQRV9PTkxZX1dBSVRfRk9SX0RBVEEgOiAqL0ZldGNoSm9iLkZFVENIX1RZUEVfUkVRVUVTVDtcclxuICAgIFxyXG4gICAgdmFyIGZldGNoSm9iID0gbmV3IEZldGNoSm9iKFxyXG4gICAgICAgIHRoaXMuX2ZldGNoZXIsIHRoaXMuX3NjaGVkdWxlciwgdGhpcy5fc2NoZWR1bGVkSm9ic0xpc3QsIGZldGNoVHlwZSwgY29udGV4dFZhcnMpO1xyXG4gICAgXHJcbiAgICBjb250ZXh0VmFycy5mZXRjaEpvYiA9IGZldGNoSm9iO1xyXG4gICAgXHJcbiAgICBpZiAodGhpcy5fcmVxdWVzdEJ5SWRbcmVxdWVzdElkXSAhPT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgdGhyb3cgJ0R1cGxpY2F0aW9uIG9mIHJlcXVlc3RJZCAnICsgcmVxdWVzdElkO1xyXG4gICAgfSBlbHNlIGlmIChyZXF1ZXN0SWQgIT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIHRoaXMuX3JlcXVlc3RCeUlkW3JlcXVlc3RJZF0gPSBmZXRjaEpvYjtcclxuICAgIH1cclxuICAgIFxyXG4gICAgZmV0Y2hKb2Iub24oJ3Rlcm1pbmF0ZWQnLCBpbnRlcm5hbFRlcm1pbmF0ZWRDYWxsYmFjayk7XHJcbiAgICBcclxuICAgIGZldGNoSm9iLmZldGNoKGltYWdlUGFydFBhcmFtcyk7XHJcbiAgICBcclxuICAgIHRoaXMuX3lpZWxkRmV0Y2hKb2JzKCk7XHJcbn07XHJcblxyXG5GZXRjaE1hbmFnZXIucHJvdG90eXBlLm1hbnVhbEFib3J0UmVxdWVzdCA9IGZ1bmN0aW9uIG1hbnVhbEFib3J0UmVxdWVzdChcclxuICAgIHJlcXVlc3RJZCkge1xyXG4gICAgXHJcbiAgICB2YXIgZmV0Y2hKb2IgPSB0aGlzLl9yZXF1ZXN0QnlJZFtyZXF1ZXN0SWRdO1xyXG4gICAgXHJcbiAgICBpZiAoZmV0Y2hKb2IgPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIC8vIFRoaXMgc2l0dWF0aW9uIG1pZ2h0IG9jY3VyIGlmIHJlcXVlc3QgaGFzIGJlZW4gdGVybWluYXRlZCxcclxuICAgICAgICAvLyBidXQgdXNlcidzIHRlcm1pbmF0ZWRDYWxsYmFjayBoYXMgbm90IGJlZW4gY2FsbGVkIHlldC4gSXRcclxuICAgICAgICAvLyBoYXBwZW5zIG9uIFdvcmtlclByb3h5RmV0Y2hNYW5hZ2VyIGR1ZSB0byB3ZWIgd29ya2VyXHJcbiAgICAgICAgLy8gbWVzc2FnZSBkZWxheS5cclxuICAgICAgICBcclxuICAgICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGZldGNoSm9iLm1hbnVhbEFib3J0UmVxdWVzdCgpO1xyXG4gICAgZGVsZXRlIHRoaXMuX3JlcXVlc3RCeUlkW3JlcXVlc3RJZF07XHJcbn07XHJcblxyXG5GZXRjaE1hbmFnZXIucHJvdG90eXBlLnJlY29ubmVjdCA9IGZ1bmN0aW9uIHJlY29ubmVjdCgpIHtcclxuICAgIHRoaXMuX2ZldGNoZXIucmVjb25uZWN0KCk7XHJcbn07XHJcblxyXG5GZXRjaE1hbmFnZXIucHJvdG90eXBlLnNldFNlcnZlclJlcXVlc3RQcmlvcml0aXplckRhdGEgPVxyXG4gICAgZnVuY3Rpb24gc2V0U2VydmVyUmVxdWVzdFByaW9yaXRpemVyRGF0YShwcmlvcml0aXplckRhdGEpIHtcclxuXHJcbiAgICBpZiAodGhpcy5fc2VydmVyUmVxdWVzdFByaW9yaXRpemVyID09PSBudWxsKSB7XHJcbiAgICAgICAgdGhyb3cgJ05vIHNlcnZlclJlcXVlc3QgcHJpb3JpdGl6ZXIgaGFzIGJlZW4gc2V0JztcclxuICAgIH1cclxuICAgIFxyXG4gICAgaWYgKHRoaXMuX3Nob3dMb2cpIHtcclxuICAgICAgICBjb25zb2xlLmxvZygnc2V0U2VydmVyUmVxdWVzdFByaW9yaXRpemVyRGF0YSgnICsgcHJpb3JpdGl6ZXJEYXRhICsgJyknKTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgcHJpb3JpdGl6ZXJEYXRhLmltYWdlID0gdGhpcztcclxuICAgIHRoaXMuX3NlcnZlclJlcXVlc3RQcmlvcml0aXplci5zZXRQcmlvcml0aXplckRhdGEocHJpb3JpdGl6ZXJEYXRhKTtcclxuICAgIHRoaXMuX3lpZWxkRmV0Y2hKb2JzKCk7XHJcbn07XHJcblxyXG5GZXRjaE1hbmFnZXIucHJvdG90eXBlLl9nZXRJbWFnZVBhcmFtc0ludGVybmFsID0gZnVuY3Rpb24gZ2V0SW1hZ2VQYXJhbXNJbnRlcm5hbCgpIHtcclxuICAgIHJldHVybiB0aGlzLl9pbnRlcm5hbFNpemVzUGFyYW1zO1xyXG59O1xyXG5cclxuRmV0Y2hNYW5hZ2VyLnByb3RvdHlwZS5feWllbGRGZXRjaEpvYnMgPSBmdW5jdGlvbiB5aWVsZEZldGNoSm9icygpIHtcclxuICAgIHZhciBpdGVyYXRvciA9IHRoaXMuX3NjaGVkdWxlZEpvYnNMaXN0LmdldEZpcnN0SXRlcmF0b3IoKTtcclxuICAgIHdoaWxlIChpdGVyYXRvciAhPT0gbnVsbCkge1xyXG4gICAgICAgIHZhciBmZXRjaEpvYiA9IHRoaXMuX3NjaGVkdWxlZEpvYnNMaXN0LmdldFZhbHVlKGl0ZXJhdG9yKTtcclxuICAgICAgICBpdGVyYXRvciA9IHRoaXMuX3NjaGVkdWxlZEpvYnNMaXN0LmdldE5leHRJdGVyYXRvcihpdGVyYXRvcik7XHJcbiAgICAgICAgXHJcbiAgICAgICAgZmV0Y2hKb2IuY2hlY2tJZlNob3VsZFlpZWxkKCk7XHJcbiAgICB9XHJcbn07XHJcblxyXG5mdW5jdGlvbiBpbnRlcm5hbFRlcm1pbmF0ZWRDYWxsYmFjayhjb250ZXh0VmFycywgaXNBYm9ydGVkKSB7XHJcbiAgICBkZWxldGUgY29udGV4dFZhcnMuc2VsZi5fcmVxdWVzdEJ5SWRbY29udGV4dFZhcnMucmVxdWVzdElkXTtcclxufVxyXG5cclxuZnVuY3Rpb24gY3JlYXRlU2VydmVyUmVxdWVzdER1bW15UmVzb3VyY2UoKSB7XHJcbiAgICByZXR1cm4ge307XHJcbn0iLCIndXNlIHN0cmljdCc7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IEZydXN0dW1SZXF1ZXN0c1ByaW9yaXRpemVyO1xyXG52YXIgUFJJT1JJVFlfQUJPUlRfTk9UX0lOX0ZSVVNUVU0gPSAtMTtcclxudmFyIFBSSU9SSVRZX0NBTENVTEFUSU9OX0ZBSUxFRCA9IDA7XHJcbnZhciBQUklPUklUWV9UT09fR09PRF9SRVNPTFVUSU9OID0gMTtcclxudmFyIFBSSU9SSVRZX05PVF9JTl9GUlVTVFVNID0gMjtcclxudmFyIFBSSU9SSVRZX0xPV0VSX1JFU09MVVRJT04gPSAzO1xyXG5cclxudmFyIFBSSU9SSVRZX01JTk9SSVRZX0lOX0ZSVVNUVU0gPSA0O1xyXG52YXIgUFJJT1JJVFlfUEFSVElBTF9JTl9GUlVTVFVNID0gNTtcclxudmFyIFBSSU9SSVRZX01BSk9SSVRZX0lOX0ZSVVNUVU0gPSA2O1xyXG52YXIgUFJJT1JJVFlfRlVMTFlfSU5fRlJVU1RVTSA9IDc7XHJcblxyXG52YXIgQUREX1BSSU9SSVRZX1RPX0xPV19RVUFMSVRZID0gNTtcclxuXHJcbnZhciBQUklPUklUWV9ISUdIRVNUID0gMTM7XHJcblxyXG52YXIgbG9nMiA9IE1hdGgubG9nKDIpO1xyXG5cclxuZnVuY3Rpb24gRnJ1c3R1bVJlcXVlc3RzUHJpb3JpdGl6ZXIoXHJcbiAgICBpc0Fib3J0UmVxdWVzdHNOb3RJbkZydXN0dW0sIGlzUHJpb3JpdGl6ZUxvd1Byb2dyZXNzaXZlU3RhZ2UpIHtcclxuICAgIFxyXG4gICAgdGhpcy5fZnJ1c3R1bURhdGEgPSBudWxsO1xyXG4gICAgdGhpcy5faXNBYm9ydFJlcXVlc3RzTm90SW5GcnVzdHVtID0gaXNBYm9ydFJlcXVlc3RzTm90SW5GcnVzdHVtO1xyXG4gICAgdGhpcy5faXNQcmlvcml0aXplTG93UHJvZ3Jlc3NpdmVTdGFnZSA9IGlzUHJpb3JpdGl6ZUxvd1Byb2dyZXNzaXZlU3RhZ2U7XHJcbn1cclxuXHJcbk9iamVjdC5kZWZpbmVQcm9wZXJ0eShcclxuICAgIEZydXN0dW1SZXF1ZXN0c1ByaW9yaXRpemVyLnByb3RvdHlwZSwgJ21pbmltYWxMb3dRdWFsaXR5UHJpb3JpdHknLCB7XHJcbiAgICAgICAgZ2V0OiBmdW5jdGlvbiBtaW5pbWFsTG93UXVhbGl0eVByaW9yaXR5KCkge1xyXG4gICAgICAgICAgICByZXR1cm4gUFJJT1JJVFlfTUlOT1JJVFlfSU5fRlJVU1RVTSArIEFERF9QUklPUklUWV9UT19MT1dfUVVBTElUWTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbik7XHJcbiAgICBcclxuRnJ1c3R1bVJlcXVlc3RzUHJpb3JpdGl6ZXIucHJvdG90eXBlLnNldFByaW9yaXRpemVyRGF0YSA9IGZ1bmN0aW9uIHNldFByaW9yaXRpemVyRGF0YShwcmlvcml0aXplckRhdGEpIHtcclxuICAgIHRoaXMuX2ZydXN0dW1EYXRhID0gcHJpb3JpdGl6ZXJEYXRhO1xyXG59O1xyXG5cclxuRnJ1c3R1bVJlcXVlc3RzUHJpb3JpdGl6ZXIucHJvdG90eXBlLmdldFByaW9yaXR5ID0gZnVuY3Rpb24gZ2V0UHJpb3JpdHkoam9iQ29udGV4dCkge1xyXG4gICAgdmFyIGltYWdlUGFydFBhcmFtcyA9IGpvYkNvbnRleHQuaW1hZ2VQYXJ0UGFyYW1zO1xyXG4gICAgaWYgKGltYWdlUGFydFBhcmFtcy5yZXF1ZXN0UHJpb3JpdHlEYXRhLm92ZXJyaWRlSGlnaGVzdFByaW9yaXR5KSB7XHJcbiAgICAgICAgcmV0dXJuIFBSSU9SSVRZX0hJR0hFU1Q7XHJcbiAgICB9XHJcblxyXG4gICAgdmFyIHByaW9yaXR5ID0gdGhpcy5fZ2V0UHJpb3JpdHlJbnRlcm5hbChpbWFnZVBhcnRQYXJhbXMpO1xyXG4gICAgdmFyIGlzSW5GcnVzdHVtID0gcHJpb3JpdHkgPj0gUFJJT1JJVFlfTUlOT1JJVFlfSU5fRlJVU1RVTTtcclxuICAgIFxyXG4gICAgaWYgKHRoaXMuX2lzQWJvcnRSZXF1ZXN0c05vdEluRnJ1c3R1bSAmJiAhaXNJbkZydXN0dW0pIHtcclxuICAgICAgICByZXR1cm4gUFJJT1JJVFlfQUJPUlRfTk9UX0lOX0ZSVVNUVU07XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHZhciBwcmlvcml0aXplTG93UHJvZ3Jlc3NpdmVTdGFnZSA9IDA7XHJcbiAgICBcclxuICAgIGlmICh0aGlzLl9pc1ByaW9yaXRpemVMb3dQcm9ncmVzc2l2ZVN0YWdlICYmIGlzSW5GcnVzdHVtKSB7XHJcbiAgICAgICAgcHJpb3JpdGl6ZUxvd1Byb2dyZXNzaXZlU3RhZ2UgPVxyXG4gICAgICAgICAgICBqb2JDb250ZXh0LnByb2dyZXNzaXZlU3RhZ2VzRG9uZSA9PT0gMCA/IEFERF9QUklPUklUWV9UT19MT1dfUVVBTElUWSA6XHJcbiAgICAgICAgICAgIGpvYkNvbnRleHQucHJvZ3Jlc3NpdmVTdGFnZXNEb25lID09PSAxID8gMSA6XHJcbiAgICAgICAgICAgIDA7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHJldHVybiBwcmlvcml0eSArIHByaW9yaXRpemVMb3dQcm9ncmVzc2l2ZVN0YWdlO1xyXG59O1xyXG5cclxuRnJ1c3R1bVJlcXVlc3RzUHJpb3JpdGl6ZXIucHJvdG90eXBlLl9nZXRQcmlvcml0eUludGVybmFsID0gZnVuY3Rpb24gZ2V0UHJpb3JpdHlJbnRlcm5hbChpbWFnZVBhcnRQYXJhbXMpIHtcclxuICAgIGlmICh0aGlzLl9mcnVzdHVtRGF0YSA9PT0gbnVsbCkge1xyXG4gICAgICAgIHJldHVybiBQUklPUklUWV9DQUxDVUxBVElPTl9GQUlMRUQ7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGlmICh0aGlzLl9mcnVzdHVtRGF0YS5pbWFnZVJlY3RhbmdsZSA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgdGhyb3cgJ05vIGltYWdlUmVjdGFuZ2xlIGluZm9ybWF0aW9uIHBhc3NlZCBpbiBzZXRQcmlvcml0aXplckRhdGEnO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICB2YXIgZXhhY3RGcnVzdHVtTGV2ZWwgPSB0aGlzLl9mcnVzdHVtRGF0YS5leGFjdGxldmVsO1xyXG4gICAgXHJcbiAgICBpZiAodGhpcy5fZnJ1c3R1bURhdGEuZXhhY3RsZXZlbCA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgdGhyb3cgJ05vIGV4YWN0bGV2ZWwgaW5mb3JtYXRpb24gcGFzc2VkIGluICcgK1xyXG4gICAgICAgICAgICAnc2V0UHJpb3JpdGl6ZXJEYXRhLiBVc2UgbnVsbCBpZiB1bmtub3duJztcclxuICAgIH1cclxuICAgIFxyXG4gICAgdmFyIHRpbGVXZXN0ID0gdGhpcy5fcGl4ZWxUb0NhcnRvZ3JhcGhpY1goXHJcbiAgICAgICAgaW1hZ2VQYXJ0UGFyYW1zLm1pblgsIGltYWdlUGFydFBhcmFtcyk7XHJcbiAgICB2YXIgdGlsZUVhc3QgPSB0aGlzLl9waXhlbFRvQ2FydG9ncmFwaGljWChcclxuICAgICAgICBpbWFnZVBhcnRQYXJhbXMubWF4WEV4Y2x1c2l2ZSwgaW1hZ2VQYXJ0UGFyYW1zKTtcclxuICAgIHZhciB0aWxlTm9ydGggPSB0aGlzLl9waXhlbFRvQ2FydG9ncmFwaGljWShcclxuICAgICAgICBpbWFnZVBhcnRQYXJhbXMubWluWSwgaW1hZ2VQYXJ0UGFyYW1zKTtcclxuICAgIHZhciB0aWxlU291dGggPSB0aGlzLl9waXhlbFRvQ2FydG9ncmFwaGljWShcclxuICAgICAgICBpbWFnZVBhcnRQYXJhbXMubWF4WUV4Y2x1c2l2ZSwgaW1hZ2VQYXJ0UGFyYW1zKTtcclxuICAgIFxyXG4gICAgdmFyIHRpbGVQaXhlbHNXaWR0aCA9XHJcbiAgICAgICAgaW1hZ2VQYXJ0UGFyYW1zLm1heFhFeGNsdXNpdmUgLSBpbWFnZVBhcnRQYXJhbXMubWluWDtcclxuICAgIHZhciB0aWxlUGl4ZWxzSGVpZ2h0ID1cclxuICAgICAgICBpbWFnZVBhcnRQYXJhbXMubWF4WUV4Y2x1c2l2ZSAtIGltYWdlUGFydFBhcmFtcy5taW5ZO1xyXG4gICAgXHJcbiAgICB2YXIgcmVxdWVzdFRvRnJ1c3R1bVJlc29sdXRpb25SYXRpbztcclxuICAgIHZhciB0aWxlTGV2ZWwgPSBpbWFnZVBhcnRQYXJhbXMubGV2ZWwgfHwgMDtcclxuICAgIGlmIChleGFjdEZydXN0dW1MZXZlbCA9PT0gbnVsbCkge1xyXG4gICAgICAgIHZhciB0aWxlUmVzb2x1dGlvblggPSB0aWxlUGl4ZWxzV2lkdGggLyAodGlsZUVhc3QgLSB0aWxlV2VzdCk7XHJcbiAgICAgICAgdmFyIHRpbGVSZXNvbHV0aW9uWSA9IHRpbGVQaXhlbHNIZWlnaHQgLyAodGlsZU5vcnRoIC0gdGlsZVNvdXRoKTtcclxuICAgICAgICB2YXIgdGlsZVJlc29sdXRpb24gPSBNYXRoLm1heCh0aWxlUmVzb2x1dGlvblgsIHRpbGVSZXNvbHV0aW9uWSk7XHJcbiAgICAgICAgdmFyIGZydXN0dW1SZXNvbHV0aW9uID0gdGhpcy5fZnJ1c3R1bURhdGEucmVzb2x1dGlvbjtcclxuICAgICAgICByZXF1ZXN0VG9GcnVzdHVtUmVzb2x1dGlvblJhdGlvID0gdGlsZVJlc29sdXRpb24gLyBmcnVzdHVtUmVzb2x1dGlvbjtcclxuICAgIFxyXG4gICAgICAgIGlmIChyZXF1ZXN0VG9GcnVzdHVtUmVzb2x1dGlvblJhdGlvID4gMikge1xyXG4gICAgICAgICAgICByZXR1cm4gUFJJT1JJVFlfVE9PX0dPT0RfUkVTT0xVVElPTjtcclxuICAgICAgICB9XHJcbiAgICB9IGVsc2UgaWYgKHRpbGVMZXZlbCA8IGV4YWN0RnJ1c3R1bUxldmVsKSB7XHJcbiAgICAgICAgcmV0dXJuIFBSSU9SSVRZX1RPT19HT09EX1JFU09MVVRJT047XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHZhciBmcnVzdHVtUmVjdGFuZ2xlID0gdGhpcy5fZnJ1c3R1bURhdGEucmVjdGFuZ2xlO1xyXG4gICAgdmFyIGludGVyc2VjdGlvbldlc3QgPSBNYXRoLm1heChmcnVzdHVtUmVjdGFuZ2xlLndlc3QsIHRpbGVXZXN0KTtcclxuICAgIHZhciBpbnRlcnNlY3Rpb25FYXN0ID0gTWF0aC5taW4oZnJ1c3R1bVJlY3RhbmdsZS5lYXN0LCB0aWxlRWFzdCk7XHJcbiAgICB2YXIgaW50ZXJzZWN0aW9uU291dGggPSBNYXRoLm1heChmcnVzdHVtUmVjdGFuZ2xlLnNvdXRoLCB0aWxlU291dGgpO1xyXG4gICAgdmFyIGludGVyc2VjdGlvbk5vcnRoID0gTWF0aC5taW4oZnJ1c3R1bVJlY3RhbmdsZS5ub3J0aCwgdGlsZU5vcnRoKTtcclxuICAgIFxyXG4gICAgdmFyIGludGVyc2VjdGlvbldpZHRoID0gaW50ZXJzZWN0aW9uRWFzdCAtIGludGVyc2VjdGlvbldlc3Q7XHJcbiAgICB2YXIgaW50ZXJzZWN0aW9uSGVpZ2h0ID0gaW50ZXJzZWN0aW9uTm9ydGggLSBpbnRlcnNlY3Rpb25Tb3V0aDtcclxuICAgIFxyXG4gICAgaWYgKGludGVyc2VjdGlvbldpZHRoIDwgMCB8fCBpbnRlcnNlY3Rpb25IZWlnaHQgPCAwKSB7XHJcbiAgICAgICAgcmV0dXJuIFBSSU9SSVRZX05PVF9JTl9GUlVTVFVNO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBpZiAoZXhhY3RGcnVzdHVtTGV2ZWwgIT09IG51bGwpIHtcclxuICAgICAgICBpZiAodGlsZUxldmVsID4gZXhhY3RGcnVzdHVtTGV2ZWwpIHtcclxuICAgICAgICAgICAgcmV0dXJuIFBSSU9SSVRZX0xPV0VSX1JFU09MVVRJT047XHJcbiAgICAgICAgfVxyXG4gICAgfSBlbHNlIGlmICh0aWxlTGV2ZWwgPiAwICYmIHJlcXVlc3RUb0ZydXN0dW1SZXNvbHV0aW9uUmF0aW8gPCAwLjI1KSB7XHJcbiAgICAgICAgcmV0dXJuIFBSSU9SSVRZX0xPV0VSX1JFU09MVVRJT047XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHZhciBpbnRlcnNlY3Rpb25BcmVhID0gaW50ZXJzZWN0aW9uV2lkdGggKiBpbnRlcnNlY3Rpb25IZWlnaHQ7XHJcbiAgICB2YXIgdGlsZUFyZWEgPSAodGlsZUVhc3QgLSB0aWxlV2VzdCkgKiAodGlsZU5vcnRoIC0gdGlsZVNvdXRoKTtcclxuICAgIHZhciBwYXJ0SW5GcnVzdHVtID0gaW50ZXJzZWN0aW9uQXJlYSAvIHRpbGVBcmVhO1xyXG4gICAgXHJcbiAgICBpZiAocGFydEluRnJ1c3R1bSA+IDAuOTkpIHtcclxuICAgICAgICByZXR1cm4gUFJJT1JJVFlfRlVMTFlfSU5fRlJVU1RVTTtcclxuICAgIH0gZWxzZSBpZiAocGFydEluRnJ1c3R1bSA+IDAuNykge1xyXG4gICAgICAgIHJldHVybiBQUklPUklUWV9NQUpPUklUWV9JTl9GUlVTVFVNO1xyXG4gICAgfSBlbHNlIGlmIChwYXJ0SW5GcnVzdHVtID4gMC4zKSB7XHJcbiAgICAgICAgcmV0dXJuIFBSSU9SSVRZX1BBUlRJQUxfSU5fRlJVU1RVTTtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgICAgcmV0dXJuIFBSSU9SSVRZX01JTk9SSVRZX0lOX0ZSVVNUVU07XHJcbiAgICB9XHJcbn07XHJcblxyXG5GcnVzdHVtUmVxdWVzdHNQcmlvcml0aXplci5wcm90b3R5cGUuX3BpeGVsVG9DYXJ0b2dyYXBoaWNYID0gZnVuY3Rpb24gcGl4ZWxUb0NhcnRvZ3JhcGhpY1goXHJcbiAgICB4LCBpbWFnZVBhcnRQYXJhbXMpIHtcclxuICAgIFxyXG4gICAgdmFyIHJlbGF0aXZlWCA9IHggLyBpbWFnZVBhcnRQYXJhbXMubGV2ZWxXaWR0aDtcclxuICAgIFxyXG4gICAgdmFyIGltYWdlUmVjdGFuZ2xlID0gdGhpcy5fZnJ1c3R1bURhdGEuaW1hZ2VSZWN0YW5nbGU7XHJcbiAgICB2YXIgcmVjdGFuZ2xlV2lkdGggPSBpbWFnZVJlY3RhbmdsZS5lYXN0IC0gaW1hZ2VSZWN0YW5nbGUud2VzdDtcclxuICAgIFxyXG4gICAgdmFyIHhQcm9qZWN0ZWQgPSBpbWFnZVJlY3RhbmdsZS53ZXN0ICsgcmVsYXRpdmVYICogcmVjdGFuZ2xlV2lkdGg7XHJcbiAgICByZXR1cm4geFByb2plY3RlZDtcclxufTtcclxuXHJcbkZydXN0dW1SZXF1ZXN0c1ByaW9yaXRpemVyLnByb3RvdHlwZS5fcGl4ZWxUb0NhcnRvZ3JhcGhpY1kgPSBmdW5jdGlvbiB0aWxlVG9DYXJ0b2dyYXBoaWNZKFxyXG4gICAgeSwgaW1hZ2VQYXJ0UGFyYW1zLCBpbWFnZSkge1xyXG4gICAgXHJcbiAgICB2YXIgcmVsYXRpdmVZID0geSAvIGltYWdlUGFydFBhcmFtcy5sZXZlbEhlaWdodDtcclxuICAgIFxyXG4gICAgdmFyIGltYWdlUmVjdGFuZ2xlID0gdGhpcy5fZnJ1c3R1bURhdGEuaW1hZ2VSZWN0YW5nbGU7XHJcbiAgICB2YXIgcmVjdGFuZ2xlSGVpZ2h0ID0gaW1hZ2VSZWN0YW5nbGUubm9ydGggLSBpbWFnZVJlY3RhbmdsZS5zb3V0aDtcclxuICAgIFxyXG4gICAgdmFyIHlQcm9qZWN0ZWQgPSBpbWFnZVJlY3RhbmdsZS5ub3J0aCAtIHJlbGF0aXZlWSAqIHJlY3RhbmdsZUhlaWdodDtcclxuICAgIHJldHVybiB5UHJvamVjdGVkO1xyXG59OyIsIid1c2Ugc3RyaWN0JztcclxuXHJcbnZhciBGcnVzdHVtUmVxdWVzdHNQcmlvcml0aXplciA9IHJlcXVpcmUoJ2ZydXN0dW1yZXF1ZXN0c3ByaW9yaXRpemVyLmpzJyk7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IHtcclxuICAgIGNhbGN1bGF0ZUZydXN0dW0yREZyb21Cb3VuZHM6IGNhbGN1bGF0ZUZydXN0dW0yREZyb21Cb3VuZHMsXHJcbiAgICBjcmVhdGVTY2hlZHVsZXI6IGNyZWF0ZVNjaGVkdWxlcixcclxuICAgIGZpeEJvdW5kczogZml4Qm91bmRzLFxyXG4gICAgYWxpZ25QYXJhbXNUb1RpbGVzQW5kTGV2ZWw6IGFsaWduUGFyYW1zVG9UaWxlc0FuZExldmVsLFxyXG59O1xyXG5cclxuLy8gQXZvaWQganNoaW50IGVycm9yXHJcbi8qIGdsb2JhbCBzZWxmOiBmYWxzZSAqL1xyXG4vKiBnbG9iYWwgZ2xvYmFsczogZmFsc2UgKi9cclxuICAgIFxyXG4vL3ZhciBsb2cyID0gTWF0aC5sb2coMik7XHJcblxyXG5mdW5jdGlvbiBjYWxjdWxhdGVGcnVzdHVtMkRGcm9tQm91bmRzKFxyXG4gICAgYm91bmRzLCBzY3JlZW5TaXplKSB7XHJcbiAgICBcclxuICAgIHZhciBzY3JlZW5QaXhlbHMgPVxyXG4gICAgICAgIHNjcmVlblNpemUueCAqIHNjcmVlblNpemUueCArIHNjcmVlblNpemUueSAqIHNjcmVlblNpemUueTtcclxuICAgIFxyXG4gICAgdmFyIGJvdW5kc1dpZHRoID0gYm91bmRzLmVhc3QgLSBib3VuZHMud2VzdDtcclxuICAgIHZhciBib3VuZHNIZWlnaHQgPSBib3VuZHMubm9ydGggLSBib3VuZHMuc291dGg7XHJcbiAgICB2YXIgYm91bmRzRGlzdGFuY2UgPVxyXG4gICAgICAgIGJvdW5kc1dpZHRoICogYm91bmRzV2lkdGggKyBib3VuZHNIZWlnaHQgKiBib3VuZHNIZWlnaHQ7XHJcbiAgICBcclxuICAgIHZhciByZXNvbHV0aW9uID0gTWF0aC5zcXJ0KHNjcmVlblBpeGVscyAvIGJvdW5kc0Rpc3RhbmNlKTtcclxuICAgIFxyXG4gICAgdmFyIGZydXN0dW1EYXRhID0ge1xyXG4gICAgICAgIHJlc29sdXRpb246IHJlc29sdXRpb24sXHJcbiAgICAgICAgcmVjdGFuZ2xlOiBib3VuZHMsXHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gUmVkdW5kYW50LCBidXQgZW5hYmxlcyB0byBhdm9pZCBhbHJlYWR5LXBlcmZvcm1lZCBjYWxjdWxhdGlvblxyXG4gICAgICAgIHNjcmVlblNpemU6IHNjcmVlblNpemVcclxuICAgIH07XHJcbiAgICBcclxuICAgIHJldHVybiBmcnVzdHVtRGF0YTtcclxufVxyXG4gICAgXHJcbmZ1bmN0aW9uIGNyZWF0ZVNjaGVkdWxlcihcclxuICAgIHNob3dMb2csIHByaW9yaXRpemVyVHlwZSwgc2NoZWR1bGVyTmFtZSwgY3JlYXRlUmVzb3VyY2UsIHJlc291cmNlTGltaXQpIHtcclxuICAgIFxyXG4gICAgdmFyIHByaW9yaXRpemVyO1xyXG4gICAgdmFyIHNjaGVkdWxlcjtcclxuICAgIFxyXG4gICAgaWYgKHByaW9yaXRpemVyVHlwZSA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgcHJpb3JpdGl6ZXIgPSBudWxsO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHNjaGVkdWxlciA9IG5ldyBSZXNvdXJjZVNjaGVkdWxlci5MaWZvU2NoZWR1bGVyKFxyXG4gICAgICAgICAgICBjcmVhdGVSZXNvdXJjZSxcclxuICAgICAgICAgICAgcmVzb3VyY2VMaW1pdCk7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICAgIHZhciBsaW1pdFJlc291cmNlQnlMb3dRdWFsaXR5UHJpb3JpdHkgPSBmYWxzZTtcclxuICAgICAgICBcclxuICAgICAgICBpZiAocHJpb3JpdGl6ZXJUeXBlID09PSAnZnJ1c3R1bScpIHtcclxuICAgICAgICAgICAgbGltaXRSZXNvdXJjZUJ5TG93UXVhbGl0eVByaW9yaXR5ID0gdHJ1ZTtcclxuICAgICAgICAgICAgcHJpb3JpdGl6ZXIgPSBuZXcgRnJ1c3R1bVJlcXVlc3RzUHJpb3JpdGl6ZXIoKTtcclxuICAgICAgICB9IGVsc2UgaWYgKHByaW9yaXRpemVyVHlwZSA9PT0gJ2ZydXN0dW1Pbmx5Jykge1xyXG4gICAgICAgICAgICBsaW1pdFJlc291cmNlQnlMb3dRdWFsaXR5UHJpb3JpdHkgPSB0cnVlO1xyXG4gICAgICAgICAgICBwcmlvcml0aXplciA9IG5ldyBGcnVzdHVtUmVxdWVzdHNQcmlvcml0aXplcihcclxuICAgICAgICAgICAgICAgIC8qaXNBYm9ydFJlcXVlc3RzTm90SW5GcnVzdHVtPSovdHJ1ZSxcclxuICAgICAgICAgICAgICAgIC8qaXNQcmlvcml0aXplTG93UXVhbGl0eVN0YWdlPSovdHJ1ZSk7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgcHJpb3JpdGl6ZXIgPSBwcmlvcml0aXplclR5cGU7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHZhciBvcHRpb25zID0ge1xyXG4gICAgICAgICAgICBzY2hlZHVsZXJOYW1lOiBzY2hlZHVsZXJOYW1lLFxyXG4gICAgICAgICAgICBzaG93TG9nOiBzaG93TG9nXHJcbiAgICAgICAgfTtcclxuICAgICAgICBcclxuICAgICAgICBpZiAobGltaXRSZXNvdXJjZUJ5TG93UXVhbGl0eVByaW9yaXR5KSB7XHJcbiAgICAgICAgICAgIG9wdGlvbnMucmVzb3VyY2VHdWFyYW50ZWVkRm9ySGlnaFByaW9yaXR5ID0gcmVzb3VyY2VMaW1pdCAtIDI7XHJcbiAgICAgICAgICAgIG9wdGlvbnMuaGlnaFByaW9yaXR5VG9HdWFyYW50ZWVSZXNvdXJjZSA9XHJcbiAgICAgICAgICAgICAgICBwcmlvcml0aXplci5taW5pbWFsTG93UXVhbGl0eVByaW9yaXR5O1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBzY2hlZHVsZXIgPSBuZXcgUmVzb3VyY2VTY2hlZHVsZXIuUHJpb3JpdHlTY2hlZHVsZXIoXHJcbiAgICAgICAgICAgIGNyZWF0ZVJlc291cmNlLFxyXG4gICAgICAgICAgICByZXNvdXJjZUxpbWl0LFxyXG4gICAgICAgICAgICBwcmlvcml0aXplcixcclxuICAgICAgICAgICAgb3B0aW9ucyk7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHJldHVybiB7XHJcbiAgICAgICAgcHJpb3JpdGl6ZXI6IHByaW9yaXRpemVyLFxyXG4gICAgICAgIHNjaGVkdWxlcjogc2NoZWR1bGVyXHJcbiAgICB9O1xyXG59XHJcbiAgICBcclxuZnVuY3Rpb24gZml4Qm91bmRzKGJvdW5kcywgaW1hZ2UsIGFkYXB0UHJvcG9ydGlvbnMpIHtcclxuICAgIGlmICghYWRhcHRQcm9wb3J0aW9ucykge1xyXG4gICAgICAgIHJldHVybjtcclxuICAgIH1cclxuXHJcbiAgICB2YXIgcmVjdGFuZ2xlV2lkdGggPSBib3VuZHMuZWFzdCAtIGJvdW5kcy53ZXN0O1xyXG4gICAgdmFyIHJlY3RhbmdsZUhlaWdodCA9IGJvdW5kcy5ub3J0aCAtIGJvdW5kcy5zb3V0aDtcclxuXHJcbiAgICB2YXIgcGl4ZWxzQXNwZWN0UmF0aW8gPSBpbWFnZS5nZXRJbWFnZVdpZHRoKCkgLyBpbWFnZS5nZXRJbWFnZUhlaWdodCgpO1xyXG4gICAgdmFyIHJlY3RhbmdsZUFzcGVjdFJhdGlvID0gcmVjdGFuZ2xlV2lkdGggLyByZWN0YW5nbGVIZWlnaHQ7XHJcbiAgICBcclxuICAgIGlmIChwaXhlbHNBc3BlY3RSYXRpbyA8IHJlY3RhbmdsZUFzcGVjdFJhdGlvKSB7XHJcbiAgICAgICAgdmFyIG9sZFdpZHRoID0gcmVjdGFuZ2xlV2lkdGg7XHJcbiAgICAgICAgcmVjdGFuZ2xlV2lkdGggPSByZWN0YW5nbGVIZWlnaHQgKiBwaXhlbHNBc3BlY3RSYXRpbztcclxuICAgICAgICB2YXIgc3Vic3RyYWN0RnJvbVdpZHRoID0gb2xkV2lkdGggLSByZWN0YW5nbGVXaWR0aDtcclxuICAgICAgICBcclxuICAgICAgICBib3VuZHMuZWFzdCAtPSBzdWJzdHJhY3RGcm9tV2lkdGggLyAyO1xyXG4gICAgICAgIGJvdW5kcy53ZXN0ICs9IHN1YnN0cmFjdEZyb21XaWR0aCAvIDI7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICAgIHZhciBvbGRIZWlnaHQgPSByZWN0YW5nbGVIZWlnaHQ7XHJcbiAgICAgICAgcmVjdGFuZ2xlSGVpZ2h0ID0gcmVjdGFuZ2xlV2lkdGggLyBwaXhlbHNBc3BlY3RSYXRpbztcclxuICAgICAgICB2YXIgc3Vic3RyYWN0RnJvbUhlaWdodCA9IG9sZEhlaWdodCAtIHJlY3RhbmdsZUhlaWdodDtcclxuICAgICAgICBcclxuICAgICAgICBib3VuZHMubm9ydGggLT0gc3Vic3RyYWN0RnJvbUhlaWdodCAvIDI7XHJcbiAgICAgICAgYm91bmRzLnNvdXRoICs9IHN1YnN0cmFjdEZyb21IZWlnaHQgLyAyO1xyXG4gICAgfVxyXG59XHJcblxyXG5mdW5jdGlvbiBhbGlnblBhcmFtc1RvVGlsZXNBbmRMZXZlbChcclxuICAgIHJlZ2lvbiwgaW1hZ2VEZWNvZGVyLCBpbWFnZSkge1xyXG4gICAgXHJcbiAgICB2YXIgdGlsZVdpZHRoID0gaW1hZ2VEZWNvZGVyLmdldFRpbGVXaWR0aCgpO1xyXG4gICAgdmFyIHRpbGVIZWlnaHQgPSBpbWFnZURlY29kZXIuZ2V0VGlsZUhlaWdodCgpO1xyXG4gICAgXHJcbiAgICB2YXIgcmVnaW9uTWluWCA9IHJlZ2lvbi5taW5YO1xyXG4gICAgdmFyIHJlZ2lvbk1pblkgPSByZWdpb24ubWluWTtcclxuICAgIHZhciByZWdpb25NYXhYID0gcmVnaW9uLm1heFhFeGNsdXNpdmU7XHJcbiAgICB2YXIgcmVnaW9uTWF4WSA9IHJlZ2lvbi5tYXhZRXhjbHVzaXZlO1xyXG4gICAgdmFyIHNjcmVlbldpZHRoID0gcmVnaW9uLnNjcmVlbldpZHRoO1xyXG4gICAgdmFyIHNjcmVlbkhlaWdodCA9IHJlZ2lvbi5zY3JlZW5IZWlnaHQ7XHJcbiAgICBcclxuICAgIHZhciBpc1ZhbGlkT3JkZXIgPSByZWdpb25NaW5YIDwgcmVnaW9uTWF4WCAmJiByZWdpb25NaW5ZIDwgcmVnaW9uTWF4WTtcclxuICAgIGlmICghaXNWYWxpZE9yZGVyKSB7XHJcbiAgICAgICAgdGhyb3cgJ1BhcmFtZXRlcnMgb3JkZXIgaXMgaW52YWxpZCc7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHZhciBkZWZhdWx0TGV2ZWxXaWR0aCA9IGltYWdlRGVjb2Rlci5nZXRJbWFnZVdpZHRoKCk7XHJcbiAgICB2YXIgZGVmYXVsdExldmVsSGVpZ2h0ID0gaW1hZ2VEZWNvZGVyLmdldEltYWdlSGVpZ2h0KCk7XHJcbiAgICBpZiAocmVnaW9uTWF4WCA8IDAgfHwgcmVnaW9uTWluWCA+PSBkZWZhdWx0TGV2ZWxXaWR0aCB8fFxyXG4gICAgICAgIHJlZ2lvbk1heFkgPCAwIHx8IHJlZ2lvbk1pblkgPj0gZGVmYXVsdExldmVsSGVpZ2h0KSB7XHJcbiAgICAgICAgXHJcbiAgICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIC8vdmFyIG1heExldmVsID1cclxuICAgIC8vICAgIGltYWdlRGVjb2Rlci5nZXREZWZhdWx0TnVtUmVzb2x1dGlvbkxldmVscygpIC0gMTtcclxuXHJcbiAgICAvL3ZhciBsZXZlbFggPSBNYXRoLmxvZygocmVnaW9uTWF4WCAtIHJlZ2lvbk1pblgpIC8gc2NyZWVuV2lkdGggKSAvIGxvZzI7XHJcbiAgICAvL3ZhciBsZXZlbFkgPSBNYXRoLmxvZygocmVnaW9uTWF4WSAtIHJlZ2lvbk1pblkpIC8gc2NyZWVuSGVpZ2h0KSAvIGxvZzI7XHJcbiAgICAvL3ZhciBsZXZlbCA9IE1hdGguY2VpbChNYXRoLm1pbihsZXZlbFgsIGxldmVsWSkpO1xyXG4gICAgLy9sZXZlbCA9IE1hdGgubWF4KDAsIE1hdGgubWluKG1heExldmVsLCBsZXZlbCkpO1xyXG4gICAgdmFyIGxldmVsID0gaW1hZ2UuZ2V0TGV2ZWwocmVnaW9uKTtcclxuICAgIHZhciBsZXZlbFdpZHRoID0gaW1hZ2UuZ2V0TGV2ZWxXaWR0aChsZXZlbCk7XHJcbiAgICB2YXIgbGV2ZWxIZWlnaHQgPSBpbWFnZS5nZXRMZXZlbEhlaWdodChsZXZlbCk7XHJcbiAgICBcclxuICAgIHZhciBzY2FsZVggPSBkZWZhdWx0TGV2ZWxXaWR0aCAvIGxldmVsV2lkdGg7XHJcbiAgICB2YXIgc2NhbGVZID0gZGVmYXVsdExldmVsSGVpZ2h0IC8gbGV2ZWxIZWlnaHQ7XHJcbiAgICBcclxuICAgIHZhciBtaW5UaWxlWCA9IE1hdGguZmxvb3IocmVnaW9uTWluWCAvIChzY2FsZVggKiB0aWxlV2lkdGggKSk7XHJcbiAgICB2YXIgbWluVGlsZVkgPSBNYXRoLmZsb29yKHJlZ2lvbk1pblkgLyAoc2NhbGVZICogdGlsZUhlaWdodCkpO1xyXG4gICAgdmFyIG1heFRpbGVYID0gTWF0aC5jZWlsIChyZWdpb25NYXhYIC8gKHNjYWxlWCAqIHRpbGVXaWR0aCApKTtcclxuICAgIHZhciBtYXhUaWxlWSA9IE1hdGguY2VpbCAocmVnaW9uTWF4WSAvIChzY2FsZVkgKiB0aWxlSGVpZ2h0KSk7XHJcbiAgICBcclxuICAgIHZhciBtaW5YID0gbWluVGlsZVggKiB0aWxlV2lkdGg7XHJcbiAgICB2YXIgbWluWSA9IG1pblRpbGVZICogdGlsZUhlaWdodDtcclxuICAgIHZhciBtYXhYID0gbWF4VGlsZVggKiB0aWxlV2lkdGg7XHJcbiAgICB2YXIgbWF4WSA9IG1heFRpbGVZICogdGlsZUhlaWdodDtcclxuICAgIFxyXG4gICAgdmFyIGNyb3BwZWRNaW5YID0gTWF0aC5tYXgoMCwgTWF0aC5taW4obGV2ZWxXaWR0aCAsIG1pblgpKTtcclxuICAgIHZhciBjcm9wcGVkTWluWSA9IE1hdGgubWF4KDAsIE1hdGgubWluKGxldmVsSGVpZ2h0LCBtaW5ZKSk7XHJcbiAgICB2YXIgY3JvcHBlZE1heFggPSBNYXRoLm1heCgwLCBNYXRoLm1pbihsZXZlbFdpZHRoICwgbWF4WCkpO1xyXG4gICAgdmFyIGNyb3BwZWRNYXhZID0gTWF0aC5tYXgoMCwgTWF0aC5taW4obGV2ZWxIZWlnaHQsIG1heFkpKTtcclxuICAgIFxyXG4gICAgdmFyIGltYWdlUGFyYW1zVG9TY3JlZW5TY2FsZVggPSBzY3JlZW5XaWR0aCAgLyAobWF4WCAtIG1pblgpO1xyXG4gICAgdmFyIGltYWdlUGFyYW1zVG9TY3JlZW5TY2FsZVkgPSBzY3JlZW5IZWlnaHQgLyAobWF4WSAtIG1pblkpO1xyXG4gICAgXHJcbiAgICB2YXIgaW1hZ2VQYXJ0UGFyYW1zID0ge1xyXG4gICAgICAgIG1pblg6IGNyb3BwZWRNaW5YLFxyXG4gICAgICAgIG1pblk6IGNyb3BwZWRNaW5ZLFxyXG4gICAgICAgIG1heFhFeGNsdXNpdmU6IGNyb3BwZWRNYXhYLFxyXG4gICAgICAgIG1heFlFeGNsdXNpdmU6IGNyb3BwZWRNYXhZLFxyXG4gICAgICAgIGxldmVsV2lkdGg6IGxldmVsV2lkdGgsXHJcbiAgICAgICAgbGV2ZWxIZWlnaHQ6IGxldmVsSGVpZ2h0LFxyXG4gICAgICAgIGxldmVsOiBsZXZlbFxyXG4gICAgfTtcclxuICAgIFxyXG4gICAgdmFyIHBvc2l0aW9uSW5JbWFnZSA9IHtcclxuICAgICAgICBtaW5YOiBjcm9wcGVkTWluWCAqIHNjYWxlWCxcclxuICAgICAgICBtaW5ZOiBjcm9wcGVkTWluWSAqIHNjYWxlWSxcclxuICAgICAgICBtYXhYRXhjbHVzaXZlOiBjcm9wcGVkTWF4WCAqIHNjYWxlWCxcclxuICAgICAgICBtYXhZRXhjbHVzaXZlOiBjcm9wcGVkTWF4WSAqIHNjYWxlWVxyXG4gICAgfTtcclxuICAgIFxyXG4gICAgdmFyIGNyb3BwZWRTY3JlZW4gPSB7XHJcbiAgICAgICAgbWluWCA6IE1hdGguZmxvb3IoKGNyb3BwZWRNaW5YIC0gbWluWCkgKiBpbWFnZVBhcmFtc1RvU2NyZWVuU2NhbGVYKSxcclxuICAgICAgICBtaW5ZIDogTWF0aC5mbG9vcigoY3JvcHBlZE1pblkgLSBtaW5ZKSAqIGltYWdlUGFyYW1zVG9TY3JlZW5TY2FsZVkpLFxyXG4gICAgICAgIG1heFhFeGNsdXNpdmUgOiBNYXRoLmNlaWwoKGNyb3BwZWRNYXhYIC0gbWluWCkgKiBpbWFnZVBhcmFtc1RvU2NyZWVuU2NhbGVYKSxcclxuICAgICAgICBtYXhZRXhjbHVzaXZlIDogTWF0aC5jZWlsKChjcm9wcGVkTWF4WSAtIG1pblkpICogaW1hZ2VQYXJhbXNUb1NjcmVlblNjYWxlWSlcclxuICAgIH07XHJcbiAgICBcclxuICAgIHJldHVybiB7XHJcbiAgICAgICAgaW1hZ2VQYXJ0UGFyYW1zOiBpbWFnZVBhcnRQYXJhbXMsXHJcbiAgICAgICAgcG9zaXRpb25JbkltYWdlOiBwb3NpdGlvbkluSW1hZ2UsXHJcbiAgICAgICAgY3JvcHBlZFNjcmVlbjogY3JvcHBlZFNjcmVlblxyXG4gICAgfTtcclxufVxyXG5cclxuZnVuY3Rpb24gZ2V0Q2xhc3NJbkdsb2JhbE9iamVjdChnbG9iYWxPYmplY3QsIGNsYXNzTmFtZSkge1xyXG4gICAgaWYgKGdsb2JhbE9iamVjdFtjbGFzc05hbWVdKSB7XHJcbiAgICAgICAgcmV0dXJuIGdsb2JhbE9iamVjdFtjbGFzc05hbWVdO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICB2YXIgcmVzdWx0ID0gZ2xvYmFsT2JqZWN0O1xyXG4gICAgdmFyIHBhdGggPSBjbGFzc05hbWUuc3BsaXQoJy4nKTtcclxuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgcGF0aC5sZW5ndGg7ICsraSkge1xyXG4gICAgICAgIHJlc3VsdCA9IHJlc3VsdFtwYXRoW2ldXTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgcmV0dXJuIHJlc3VsdDtcclxufSIsIid1c2Ugc3RyaWN0JztcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gTGlua2VkTGlzdDtcclxuXHJcbmZ1bmN0aW9uIExpbmtlZExpc3QoKSB7XHJcbiAgICB0aGlzLl9maXJzdCA9IHsgX3ByZXY6IG51bGwsIF9wYXJlbnQ6IHRoaXMgfTtcclxuICAgIHRoaXMuX2xhc3QgPSB7IF9uZXh0OiBudWxsLCBfcGFyZW50OiB0aGlzIH07XHJcbiAgICB0aGlzLl9jb3VudCA9IDA7XHJcbiAgICBcclxuICAgIHRoaXMuX2xhc3QuX3ByZXYgPSB0aGlzLl9maXJzdDtcclxuICAgIHRoaXMuX2ZpcnN0Ll9uZXh0ID0gdGhpcy5fbGFzdDtcclxufVxyXG5cclxuTGlua2VkTGlzdC5wcm90b3R5cGUuYWRkID0gZnVuY3Rpb24gYWRkKHZhbHVlLCBhZGRCZWZvcmUpIHtcclxuICAgIGlmIChhZGRCZWZvcmUgPT09IG51bGwgfHwgYWRkQmVmb3JlID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICBhZGRCZWZvcmUgPSB0aGlzLl9sYXN0O1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICB0aGlzLl92YWxpZGF0ZUl0ZXJhdG9yT2ZUaGlzKGFkZEJlZm9yZSk7XHJcbiAgICBcclxuICAgICsrdGhpcy5fY291bnQ7XHJcbiAgICBcclxuICAgIHZhciBuZXdOb2RlID0ge1xyXG4gICAgICAgIF92YWx1ZTogdmFsdWUsXHJcbiAgICAgICAgX25leHQ6IGFkZEJlZm9yZSxcclxuICAgICAgICBfcHJldjogYWRkQmVmb3JlLl9wcmV2LFxyXG4gICAgICAgIF9wYXJlbnQ6IHRoaXNcclxuICAgIH07XHJcbiAgICBcclxuICAgIG5ld05vZGUuX3ByZXYuX25leHQgPSBuZXdOb2RlO1xyXG4gICAgYWRkQmVmb3JlLl9wcmV2ID0gbmV3Tm9kZTtcclxuICAgIFxyXG4gICAgcmV0dXJuIG5ld05vZGU7XHJcbn07XHJcblxyXG5MaW5rZWRMaXN0LnByb3RvdHlwZS5yZW1vdmUgPSBmdW5jdGlvbiByZW1vdmUoaXRlcmF0b3IpIHtcclxuICAgIHRoaXMuX3ZhbGlkYXRlSXRlcmF0b3JPZlRoaXMoaXRlcmF0b3IpO1xyXG4gICAgXHJcbiAgICAtLXRoaXMuX2NvdW50O1xyXG4gICAgXHJcbiAgICBpdGVyYXRvci5fcHJldi5fbmV4dCA9IGl0ZXJhdG9yLl9uZXh0O1xyXG4gICAgaXRlcmF0b3IuX25leHQuX3ByZXYgPSBpdGVyYXRvci5fcHJldjtcclxuICAgIGl0ZXJhdG9yLl9wYXJlbnQgPSBudWxsO1xyXG59O1xyXG5cclxuTGlua2VkTGlzdC5wcm90b3R5cGUuZ2V0VmFsdWUgPSBmdW5jdGlvbiBnZXRWYWx1ZShpdGVyYXRvcikge1xyXG4gICAgdGhpcy5fdmFsaWRhdGVJdGVyYXRvck9mVGhpcyhpdGVyYXRvcik7XHJcbiAgICBcclxuICAgIHJldHVybiBpdGVyYXRvci5fdmFsdWU7XHJcbn07XHJcblxyXG5MaW5rZWRMaXN0LnByb3RvdHlwZS5nZXRGaXJzdEl0ZXJhdG9yID0gZnVuY3Rpb24gZ2V0Rmlyc3RJdGVyYXRvcigpIHtcclxuICAgIHZhciBpdGVyYXRvciA9IHRoaXMuZ2V0TmV4dEl0ZXJhdG9yKHRoaXMuX2ZpcnN0KTtcclxuICAgIHJldHVybiBpdGVyYXRvcjtcclxufTtcclxuXHJcbkxpbmtlZExpc3QucHJvdG90eXBlLmdldExhc3RJdGVyYXRvciA9IGZ1bmN0aW9uIGdldEZpcnN0SXRlcmF0b3IoKSB7XHJcbiAgICB2YXIgaXRlcmF0b3IgPSB0aGlzLmdldFByZXZJdGVyYXRvcih0aGlzLl9sYXN0KTtcclxuICAgIHJldHVybiBpdGVyYXRvcjtcclxufTtcclxuXHJcbkxpbmtlZExpc3QucHJvdG90eXBlLmdldE5leHRJdGVyYXRvciA9IGZ1bmN0aW9uIGdldE5leHRJdGVyYXRvcihpdGVyYXRvcikge1xyXG4gICAgdGhpcy5fdmFsaWRhdGVJdGVyYXRvck9mVGhpcyhpdGVyYXRvcik7XHJcblxyXG4gICAgaWYgKGl0ZXJhdG9yLl9uZXh0ID09PSB0aGlzLl9sYXN0KSB7XHJcbiAgICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHJldHVybiBpdGVyYXRvci5fbmV4dDtcclxufTtcclxuXHJcbkxpbmtlZExpc3QucHJvdG90eXBlLmdldFByZXZJdGVyYXRvciA9IGZ1bmN0aW9uIGdldFByZXZJdGVyYXRvcihpdGVyYXRvcikge1xyXG4gICAgdGhpcy5fdmFsaWRhdGVJdGVyYXRvck9mVGhpcyhpdGVyYXRvcik7XHJcblxyXG4gICAgaWYgKGl0ZXJhdG9yLl9wcmV2ID09PSB0aGlzLl9maXJzdCkge1xyXG4gICAgICAgIHJldHVybiBudWxsO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICByZXR1cm4gaXRlcmF0b3IuX3ByZXY7XHJcbn07XHJcblxyXG5MaW5rZWRMaXN0LnByb3RvdHlwZS5nZXRDb3VudCA9IGZ1bmN0aW9uIGdldENvdW50KCkge1xyXG4gICAgcmV0dXJuIHRoaXMuX2NvdW50O1xyXG59O1xyXG5cclxuTGlua2VkTGlzdC5wcm90b3R5cGUuX3ZhbGlkYXRlSXRlcmF0b3JPZlRoaXMgPVxyXG4gICAgZnVuY3Rpb24gdmFsaWRhdGVJdGVyYXRvck9mVGhpcyhpdGVyYXRvcikge1xyXG4gICAgXHJcbiAgICBpZiAoaXRlcmF0b3IuX3BhcmVudCAhPT0gdGhpcykge1xyXG4gICAgICAgIHRocm93ICdpdGVyYXRvciBtdXN0IGJlIG9mIHRoZSBjdXJyZW50IExpbmtlZExpc3QnO1xyXG4gICAgfVxyXG59OyIsIid1c2Ugc3RyaWN0JztcclxuXHJcbi8vIFN1cHByZXNzIFwiVW5uZWNlc3NhcnkgZGlyZWN0aXZlICd1c2Ugc3RyaWN0J1wiIGZvciB0aGUgc2xhdmVTY3JpcHRDb250ZW50IGZ1bmN0aW9uXHJcbi8qanNoaW50IC1XMDM0ICovXHJcblxyXG52YXIgSW1hZ2VEZWNvZGVyID0gcmVxdWlyZSgnaW1hZ2VkZWNvZGVyLmpzJyk7XHJcblxyXG5tb2R1bGUuZXhwb3J0cy5nZXRTY3JpcHRVcmwgPSBmdW5jdGlvbiBnZXRTY3JpcHRVcmwoKSB7XHJcbiAgICByZXR1cm4gc2xhdmVTY3JpcHRVcmw7XHJcbn07XHJcblxyXG52YXIgc2xhdmVTY3JpcHRCbG9iID0gbmV3IEJsb2IoXHJcbiAgICBbJygnLCBzbGF2ZVNjcmlwdENvbnRlbnQudG9TdHJpbmcoKSwgJykoKSddLFxyXG4gICAgeyB0eXBlOiAnYXBwbGljYXRpb24vamF2YXNjcmlwdCcgfSk7XHJcbnZhciBzbGF2ZVNjcmlwdFVybCA9IFVSTC5jcmVhdGVPYmplY3RVUkwoc2xhdmVTY3JpcHRCbG9iKTtcclxuXHJcbmZ1bmN0aW9uIHNsYXZlU2NyaXB0Q29udGVudCgpIHtcclxuICAgICd1c2Ugc3RyaWN0JztcclxuICAgIEFzeW5jUHJveHkuQXN5bmNQcm94eVNsYXZlLnNldFNsYXZlU2lkZUNyZWF0b3IoZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgdmFyIGFyZ3VtZW50c0FzQXJyYXkgPSBuZXcgQXJyYXkoYXJndW1lbnRzLmxlbmd0aCArIDEpO1xyXG4gICAgICAgIGFyZ3VtZW50c0FzQXJyYXlbMF0gPSBudWxsO1xyXG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgYXJndW1lbnRzLmxlbmd0aDsgKytpKSB7XHJcbiAgICAgICAgICAgIGFyZ3VtZW50c0FzQXJyYXlbaSArIDFdID0gYXJndW1lbnRzW2ldO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICB2YXIgaW5zdGFuY2UgPSBuZXcgKEZ1bmN0aW9uLnByb3RvdHlwZS5iaW5kLmFwcGx5KGltYWdlRGVjb2RlckZyYW1ld29yay5JbWFnZURlY29kZXIsIGFyZ3VtZW50c0FzQXJyYXkpKTtcclxuICAgICAgICBcclxuICAgICAgICByZXR1cm4gaW5zdGFuY2U7XHJcbiAgICB9KTtcclxufSIsIid1c2Ugc3RyaWN0JztcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gSW1hZ2VQYXJhbXNSZXRyaWV2ZXJQcm94eTtcclxuXHJcbmZ1bmN0aW9uIEltYWdlUGFyYW1zUmV0cmlldmVyUHJveHkoKSB7XHJcbiAgICB0aGlzLl9zaXplc1BhcmFtcyA9IG51bGw7XHJcbn1cclxuXHJcbkltYWdlUGFyYW1zUmV0cmlldmVyUHJveHkucHJvdG90eXBlLmdldEltYWdlTGV2ZWwgPSBmdW5jdGlvbiBnZXRJbWFnZUxldmVsKCkge1xyXG4gICAgdmFyIHNpemVzUGFyYW1zID0gdGhpcy5nZXRJbWFnZVBhcmFtcygpO1xyXG5cclxuICAgIHJldHVybiBzaXplc1BhcmFtcy5pbWFnZUxldmVsO1xyXG59O1xyXG5cclxuSW1hZ2VQYXJhbXNSZXRyaWV2ZXJQcm94eS5wcm90b3R5cGUuZ2V0SW1hZ2VXaWR0aCA9IGZ1bmN0aW9uIGdldEltYWdlV2lkdGgoKSB7XHJcbiAgICB2YXIgc2l6ZXNQYXJhbXMgPSB0aGlzLmdldEltYWdlUGFyYW1zKCk7XHJcblxyXG4gICAgcmV0dXJuIHNpemVzUGFyYW1zLmltYWdlV2lkdGg7XHJcbn07XHJcblxyXG5JbWFnZVBhcmFtc1JldHJpZXZlclByb3h5LnByb3RvdHlwZS5nZXRJbWFnZUhlaWdodCA9IGZ1bmN0aW9uIGdldEltYWdlSGVpZ2h0KCkge1xyXG4gICAgdmFyIHNpemVzUGFyYW1zID0gdGhpcy5nZXRJbWFnZVBhcmFtcygpO1xyXG5cclxuICAgIHJldHVybiBzaXplc1BhcmFtcy5pbWFnZUhlaWdodDtcclxufTtcclxuXHJcbkltYWdlUGFyYW1zUmV0cmlldmVyUHJveHkucHJvdG90eXBlLmdldE51bVJlc29sdXRpb25MZXZlbHNGb3JMaW1pdHRlZFZpZXdlciA9IGZ1bmN0aW9uIGdldE51bVJlc29sdXRpb25MZXZlbHNGb3JMaW1pdHRlZFZpZXdlcigpIHtcclxuICAgIHZhciBzaXplc1BhcmFtcyA9IHRoaXMuZ2V0SW1hZ2VQYXJhbXMoKTtcclxuXHJcbiAgICByZXR1cm4gc2l6ZXNQYXJhbXMubnVtUmVzb2x1dGlvbkxldmVsc0ZvckxpbWl0dGVkVmlld2VyO1xyXG59O1xyXG5cclxuSW1hZ2VQYXJhbXNSZXRyaWV2ZXJQcm94eS5wcm90b3R5cGUuZ2V0TG93ZXN0UXVhbGl0eSA9IGZ1bmN0aW9uIGdldExvd2VzdFF1YWxpdHkoKSB7XHJcbiAgICB2YXIgc2l6ZXNQYXJhbXMgPSB0aGlzLmdldEltYWdlUGFyYW1zKCk7XHJcblxyXG4gICAgcmV0dXJuIHNpemVzUGFyYW1zLmxvd2VzdFF1YWxpdHk7XHJcbn07XHJcblxyXG5JbWFnZVBhcmFtc1JldHJpZXZlclByb3h5LnByb3RvdHlwZS5nZXRIaWdoZXN0UXVhbGl0eSA9IGZ1bmN0aW9uIGdldEhpZ2hlc3RRdWFsaXR5KCkge1xyXG4gICAgdmFyIHNpemVzUGFyYW1zID0gdGhpcy5nZXRJbWFnZVBhcmFtcygpO1xyXG5cclxuICAgIHJldHVybiBzaXplc1BhcmFtcy5oaWdoZXN0UXVhbGl0eTtcclxufTtcclxuXHJcbkltYWdlUGFyYW1zUmV0cmlldmVyUHJveHkucHJvdG90eXBlLmdldEltYWdlUGFyYW1zID0gZnVuY3Rpb24gZ2V0SW1hZ2VQYXJhbXMoKSB7XHJcbiAgICBpZiAoIXRoaXMuX3NpemVzUGFyYW1zKSB7XHJcbiAgICAgICAgdGhpcy5fc2l6ZXNQYXJhbXMgPSB0aGlzLl9nZXRJbWFnZVBhcmFtc0ludGVybmFsKCk7XHJcbiAgICAgICAgaWYgKCF0aGlzLl9zaXplc1BhcmFtcykge1xyXG4gICAgICAgICAgICB0aHJvdyAnZ2V0SW1hZ2VQYXJhbXNJbnRlcm5hbCgpIHJldHVybmVkIGZhbHN5IHZhbHVlOyBNYXliZSBpbWFnZSBub3QgcmVhZHkgeWV0Pyc7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIGlmICh0aGlzLl9zaXplc1BhcmFtcy5pbWFnZUxldmVsID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICAgICAgdGhyb3cgJ2dldEltYWdlUGFyYW1zSW50ZXJuYWwoKSByZXN1bHQgaGFzIG5vIGltYWdlTGV2ZWwgcHJvcGVydHknO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBpZiAodGhpcy5fc2l6ZXNQYXJhbXMuaW1hZ2VXaWR0aCA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgICAgIHRocm93ICdnZXRJbWFnZVBhcmFtc0ludGVybmFsKCkgcmVzdWx0IGhhcyBubyBpbWFnZVdpZHRoIHByb3BlcnR5JztcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKHRoaXMuX3NpemVzUGFyYW1zLmltYWdlSGVpZ2h0ID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICAgICAgdGhyb3cgJ2dldEltYWdlUGFyYW1zSW50ZXJuYWwoKSByZXN1bHQgaGFzIG5vIGltYWdlSGVpZ2h0IHByb3BlcnR5JztcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKHRoaXMuX3NpemVzUGFyYW1zLm51bVJlc29sdXRpb25MZXZlbHNGb3JMaW1pdHRlZFZpZXdlciA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgICAgIHRocm93ICdnZXRJbWFnZVBhcmFtc0ludGVybmFsKCkgcmVzdWx0IGhhcyBubyBudW1SZXNvbHV0aW9uTGV2ZWxzRm9yTGltaXR0ZWRWaWV3ZXIgcHJvcGVydHknO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBpZiAodGhpcy5fc2l6ZXNQYXJhbXMubG93ZXN0UXVhbGl0eSA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgICAgIHRocm93ICdnZXRJbWFnZVBhcmFtc0ludGVybmFsKCkgcmVzdWx0IGhhcyBubyBsb3dlc3RRdWFsaXR5IHByb3BlcnR5JztcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKHRoaXMuX3NpemVzUGFyYW1zLmhpZ2hlc3RRdWFsaXR5ID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICAgICAgdGhyb3cgJ2dldEltYWdlUGFyYW1zSW50ZXJuYWwoKSByZXN1bHQgaGFzIG5vIGhpZ2hlc3RRdWFsaXR5IHByb3BlcnR5JztcclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHJldHVybiB0aGlzLl9zaXplc1BhcmFtcztcclxufTtcclxuXHJcbkltYWdlUGFyYW1zUmV0cmlldmVyUHJveHkucHJvdG90eXBlLl9nZXRJbWFnZVBhcmFtc0ludGVybmFsID0gZnVuY3Rpb24gZ2V0SW1hZ2VQYXJhbXNJbnRlcm5hbCgpIHtcclxuICAgIHRocm93ICdJbWFnZVBhcmFtc1JldHJpZXZlclByb3h5IGluaGVyaXRvciBkaWQgbm90IGltcGxlbWVudCBfZ2V0SW1hZ2VQYXJhbXNJbnRlcm5hbCgpJztcclxufTsiLCIndXNlIHN0cmljdCc7XHJcblxyXG4vLyBTdXBwcmVzcyBcIlVubmVjZXNzYXJ5IGRpcmVjdGl2ZSAndXNlIHN0cmljdCdcIiBmb3IgdGhlIHNsYXZlU2NyaXB0Q29udGVudCBmdW5jdGlvblxyXG4vKmpzaGludCAtVzAzNCAqL1xyXG5cclxubW9kdWxlLmV4cG9ydHMuZ2V0U2NyaXB0VXJsID0gZnVuY3Rpb24gZ2V0U2NyaXB0VXJsKCkge1xyXG4gICAgcmV0dXJuIHNsYXZlU2NyaXB0VXJsO1xyXG59O1xyXG5cclxudmFyIHNsYXZlU2NyaXB0QmxvYiA9IG5ldyBCbG9iKFxyXG4gICAgWycoJywgc2xhdmVTY3JpcHRDb250ZW50LnRvU3RyaW5nKCksICcpKCknXSxcclxuICAgIHsgdHlwZTogJ2FwcGxpY2F0aW9uL2phdmFzY3JpcHQnIH0pO1xyXG52YXIgc2xhdmVTY3JpcHRVcmwgPSBVUkwuY3JlYXRlT2JqZWN0VVJMKHNsYXZlU2NyaXB0QmxvYik7XHJcblxyXG5mdW5jdGlvbiBzbGF2ZVNjcmlwdENvbnRlbnQoKSB7XHJcbiAgICAndXNlIHN0cmljdCc7XHJcbiAgICBcclxuICAgIHZhciBpc1JlYWR5ID0gZmFsc2U7XHJcblxyXG4gICAgQXN5bmNQcm94eS5Bc3luY1Byb3h5U2xhdmUuc2V0QmVmb3JlT3BlcmF0aW9uTGlzdGVuZXIoYmVmb3JlT3BlcmF0aW9uTGlzdGVuZXIpO1xyXG5cclxuICAgIGZ1bmN0aW9uIGJlZm9yZU9wZXJhdGlvbkxpc3RlbmVyKG9wZXJhdGlvblR5cGUsIG9wZXJhdGlvbk5hbWUsIGFyZ3MpIHtcclxuICAgICAgICAvKiBqc2hpbnQgdmFsaWR0aGlzOiB0cnVlICovXHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKG9wZXJhdGlvblR5cGUgIT09ICdjYWxsYmFjaycgfHwgb3BlcmF0aW9uTmFtZSAhPT0gJ3N0YXR1c0NhbGxiYWNrJykge1xyXG4gICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIGlmIChpc1JlYWR5IHx8ICFhcmdzWzBdLmlzUmVhZHkpIHtcclxuICAgICAgICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHZhciBkYXRhID0geyBzaXplc1BhcmFtczogdGhpcy5nZXRJbWFnZVBhcmFtcygpIH07XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gZ2V0VGlsZVdpZHRoIGFuZCBnZXRUaWxlSGVpZ2h0IGV4aXN0cyBvbmx5IGluIEltYWdlRGVjb2RlciBidXQgbm90IGluIEZldGNoTWFuYWdlclxyXG4gICAgICAgIGlmICh0aGlzLmdldFRpbGVXaWR0aCkge1xyXG4gICAgICAgICAgICBkYXRhLmFwcGxpY2F0aXZlVGlsZVdpZHRoID0gdGhpcy5nZXRUaWxlV2lkdGgoKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgaWYgKHRoaXMuZ2V0VGlsZUhlaWdodCkge1xyXG4gICAgICAgICAgICBkYXRhLmFwcGxpY2F0aXZlVGlsZUhlaWdodCA9IHRoaXMuZ2V0VGlsZUhlaWdodCgpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBBc3luY1Byb3h5LkFzeW5jUHJveHlTbGF2ZS5zZW5kVXNlckRhdGFUb01hc3RlcihkYXRhKTtcclxuICAgICAgICBpc1JlYWR5ID0gdHJ1ZTtcclxuICAgIH1cclxufSIsIid1c2Ugc3RyaWN0JztcclxuXHJcbi8vIFN1cHByZXNzIFwiVW5uZWNlc3NhcnkgZGlyZWN0aXZlICd1c2Ugc3RyaWN0J1wiIGZvciB0aGUgc2xhdmVTY3JpcHRDb250ZW50IGZ1bmN0aW9uXHJcbi8qanNoaW50IC1XMDM0ICovXHJcblxyXG4vKiBnbG9iYWwgc2VsZjogZmFsc2UgKi9cclxuLyogZ2xvYmFsIGltYWdlRGVjb2RlckZyYW1ld29yazogZmFsc2UgKi9cclxuXHJcbm1vZHVsZS5leHBvcnRzLmdldFNjcmlwdFVybCA9IGZ1bmN0aW9uIGdldFNjcmlwdFVybCgpIHtcclxuICAgIHJldHVybiBkZWNvZGVyU2xhdmVTY3JpcHRVcmw7XHJcbn07XHJcblxyXG52YXIgaW1hZ2VIZWxwZXJGdW5jdGlvbnMgPSByZXF1aXJlKCdpbWFnZWhlbHBlcmZ1bmN0aW9ucy5qcycpO1xyXG5cclxudmFyIGRlY29kZXJTbGF2ZVNjcmlwdEJsb2IgPSBuZXcgQmxvYihcclxuICAgIFsnKCcsIGRlY29kZXJTbGF2ZVNjcmlwdEJvZHkudG9TdHJpbmcoKSwgJykoKSddLFxyXG4gICAgeyB0eXBlOiAnYXBwbGljYXRpb24vamF2YXNjcmlwdCcgfSk7XHJcbnZhciBkZWNvZGVyU2xhdmVTY3JpcHRVcmwgPSBVUkwuY3JlYXRlT2JqZWN0VVJMKGRlY29kZXJTbGF2ZVNjcmlwdEJsb2IpO1xyXG5cclxuLy9mdW5jdGlvbiBXb3JrZXJQcm94eVBpeGVsc0RlY29kZXIob3B0aW9ucykge1xyXG4vLyAgICB0aGlzLl9vcHRpb25zID0gb3B0aW9ucyB8fCB7fTtcclxuLy8gICAgdGhpcy5faW1hZ2VJbXBsZW1lbnRhdGlvbiA9IGltYWdlSGVscGVyRnVuY3Rpb25zLmdldEltYWdlSW1wbGVtZW50YXRpb24oXHJcbi8vICAgICAgICBvcHRpb25zLmltYWdlSW1wbGVtZW50YXRpb25DbGFzc05hbWUpO1xyXG4vLyAgICBcclxuLy8gICAgdmFyIHNjcmlwdHNUb0ltcG9ydCA9ICh0aGlzLl9vcHRpb25zLnNjcmlwdHNUb0ltcG9ydCB8fCBbXSkuY29uY2F0KFtkZWNvZGVyU2xhdmVTY3JpcHRVcmxdKTtcclxuLy8gICAgdmFyIGFyZ3MgPSBbdGhpcy5fb3B0aW9uc107XHJcbi8vICAgIFxyXG4vLyAgICB0aGlzLl93b3JrZXJIZWxwZXIgPSBuZXcgQXN5bmNQcm94eS5Bc3luY1Byb3h5TWFzdGVyKFxyXG4vLyAgICAgICAgc2NyaXB0c1RvSW1wb3J0LFxyXG4vLyAgICAgICAgJ0FyYml0cmFyeUNsYXNzTmFtZScsXHJcbi8vICAgICAgICBhcmdzKTtcclxuLy99XHJcbi8vXHJcbi8vV29ya2VyUHJveHlQaXhlbHNEZWNvZGVyLnByb3RvdHlwZS5kZWNvZGUgPSBmdW5jdGlvbiBkZWNvZGUoZGF0YUZvckRlY29kZSkge1xyXG4vLyAgICAvL3ZhciB0cmFuc2ZlcmFibGVzID0gdGhpcy5faW1hZ2VJbXBsZW1lbnRhdGlvbi5nZXRUcmFuc2ZlcmFibGVPZkRlY29kZUFyZ3VtZW50cyhkYXRhRm9yRGVjb2RlKTtcclxuLy8gICAgdmFyIHJlc3VsdFRyYW5zZmVyYWJsZXMgPSBbWydkYXRhJywgJ2J1ZmZlciddXTtcclxuLy8gICAgXHJcbi8vICAgIHZhciBhcmdzID0gW2RhdGFGb3JEZWNvZGVdO1xyXG4vLyAgICB2YXIgb3B0aW9ucyA9IHtcclxuLy8gICAgICAgIC8vdHJhbnNmZXJhYmxlczogdHJhbnNmZXJhYmxlcyxcclxuLy8gICAgICAgIHBhdGhzVG9UcmFuc2ZlcmFibGVzSW5Qcm9taXNlUmVzdWx0OiByZXN1bHRUcmFuc2ZlcmFibGVzLFxyXG4vLyAgICAgICAgaXNSZXR1cm5Qcm9taXNlOiB0cnVlXHJcbi8vICAgIH07XHJcbi8vICAgIFxyXG4vLyAgICByZXR1cm4gdGhpcy5fd29ya2VySGVscGVyLmNhbGxGdW5jdGlvbignZGVjb2RlJywgYXJncywgb3B0aW9ucyk7XHJcbi8vfTtcclxuXHJcbi8vV29ya2VyUHJveHlQaXhlbHNEZWNvZGVyLnByb3RvdHlwZS50ZXJtaW5hdGUgPSBmdW5jdGlvbiB0ZXJtaW5hdGUoKSB7XHJcbi8vICAgIHRoaXMuX3dvcmtlckhlbHBlci50ZXJtaW5hdGUoKTtcclxuLy99O1xyXG5cclxuZnVuY3Rpb24gZGVjb2RlclNsYXZlU2NyaXB0Qm9keSgpIHtcclxuICAgICd1c2Ugc3RyaWN0JztcclxuXHJcbiAgICBBc3luY1Byb3h5LkFzeW5jUHJveHlTbGF2ZS5zZXRTbGF2ZVNpZGVDcmVhdG9yKGZ1bmN0aW9uIGNyZWF0ZURlY29kZXIob3B0aW9ucykge1xyXG4gICAgICAgIC8vdmFyIGltYWdlSW1wbGVtZW50YXRpb24gPSBzZWxmW29wdGlvbnMuaW1hZ2VJbXBsZW1lbnRhdGlvbkNsYXNzTmFtZV07XHJcbiAgICAgICAgdmFyIGltYWdlSW1wbGVtZW50YXRpb24gPSBpbWFnZURlY29kZXJGcmFtZXdvcmsuSW50ZXJuYWxzLmltYWdlSGVscGVyRnVuY3Rpb25zLmdldEltYWdlSW1wbGVtZW50YXRpb24ob3B0aW9ucy5pbWFnZUltcGxlbWVudGF0aW9uQ2xhc3NOYW1lKTtcclxuICAgICAgICByZXR1cm4gaW1hZ2VJbXBsZW1lbnRhdGlvbi5jcmVhdGVQaXhlbHNEZWNvZGVyKCk7XHJcbiAgICB9KTtcclxufSIsIid1c2Ugc3RyaWN0JztcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gV29ya2VyUHJveHlJbWFnZURlY29kZXI7XHJcblxyXG52YXIgaW1hZ2VIZWxwZXJGdW5jdGlvbnMgPSByZXF1aXJlKCdpbWFnZWhlbHBlcmZ1bmN0aW9ucy5qcycpO1xyXG52YXIgc2VuZEltYWdlUGFyYW1ldGVyc1RvTWFzdGVyID0gcmVxdWlyZSgnc2VuZGltYWdlcGFyYW1ldGVyc3RvbWFzdGVyLmpzJyk7XHJcbnZhciBjcmVhdGVJbWFnZURlY29kZXJTbGF2ZVNpZGUgPSByZXF1aXJlKCdjcmVhdGVpbWFnZWRlY29kZXJvbnNsYXZlc2lkZS5qcycpO1xyXG52YXIgSW1hZ2VQYXJhbXNSZXRyaWV2ZXJQcm94eSA9IHJlcXVpcmUoJ2ltYWdlcGFyYW1zcmV0cmlldmVycHJveHkuanMnKTtcclxuXHJcbmZ1bmN0aW9uIFdvcmtlclByb3h5SW1hZ2VEZWNvZGVyKGltYWdlSW1wbGVtZW50YXRpb25DbGFzc05hbWUsIG9wdGlvbnMpIHtcclxuICAgIEltYWdlUGFyYW1zUmV0cmlldmVyUHJveHkuY2FsbCh0aGlzKTtcclxuXHJcbiAgICB0aGlzLl9pbWFnZVdpZHRoID0gbnVsbDtcclxuICAgIHRoaXMuX2ltYWdlSGVpZ2h0ID0gbnVsbDtcclxuICAgIHRoaXMuX3RpbGVXaWR0aCA9IDA7XHJcbiAgICB0aGlzLl90aWxlSGVpZ2h0ID0gMDtcclxuICAgIFxyXG4gICAgdmFyIG9wdGlvbnNJbnRlcm5hbCA9IGltYWdlSGVscGVyRnVuY3Rpb25zLmNyZWF0ZUludGVybmFsT3B0aW9ucyhpbWFnZUltcGxlbWVudGF0aW9uQ2xhc3NOYW1lLCBvcHRpb25zKTtcclxuICAgIHZhciBjdG9yQXJncyA9IFtpbWFnZUltcGxlbWVudGF0aW9uQ2xhc3NOYW1lLCBvcHRpb25zSW50ZXJuYWxdO1xyXG4gICAgXHJcbiAgICB2YXIgc2NyaXB0c1RvSW1wb3J0ID0gaW1hZ2VIZWxwZXJGdW5jdGlvbnMuZ2V0U2NyaXB0c0ZvcldvcmtlckltcG9ydChcclxuICAgICAgICB0aGlzLl9pbWFnZUltcGxlbWVudGF0aW9uLCBvcHRpb25zKTtcclxuICAgIHNjcmlwdHNUb0ltcG9ydCA9IHNjcmlwdHNUb0ltcG9ydC5jb25jYXQoW1xyXG4gICAgICAgIHNlbmRJbWFnZVBhcmFtZXRlcnNUb01hc3Rlci5nZXRTY3JpcHRVcmwoKSxcclxuICAgICAgICBjcmVhdGVJbWFnZURlY29kZXJTbGF2ZVNpZGUuZ2V0U2NyaXB0VXJsKCldKTtcclxuXHJcbiAgICB0aGlzLl93b3JrZXJIZWxwZXIgPSBuZXcgQXN5bmNQcm94eS5Bc3luY1Byb3h5TWFzdGVyKFxyXG4gICAgICAgIHNjcmlwdHNUb0ltcG9ydCwgJ2ltYWdlRGVjb2RlckZyYW1ld29yay5JbWFnZURlY29kZXInLCBjdG9yQXJncyk7XHJcbiAgICBcclxuICAgIHZhciBib3VuZEltYWdlT3BlbmVkID0gdGhpcy5faW1hZ2VPcGVuZWQuYmluZCh0aGlzKTtcclxuICAgIHRoaXMuX3dvcmtlckhlbHBlci5zZXRVc2VyRGF0YUhhbmRsZXIoYm91bmRJbWFnZU9wZW5lZCk7XHJcbn1cclxuXHJcbldvcmtlclByb3h5SW1hZ2VEZWNvZGVyLnByb3RvdHlwZSA9IE9iamVjdC5jcmVhdGUoSW1hZ2VQYXJhbXNSZXRyaWV2ZXJQcm94eS5wcm90b3R5cGUpO1xyXG5cclxuV29ya2VyUHJveHlJbWFnZURlY29kZXIucHJvdG90eXBlLmdldFRpbGVXaWR0aCA9IGZ1bmN0aW9uIGdldFRpbGVXaWR0aCgpIHtcclxuICAgIHRoaXMuZ2V0SW1hZ2VQYXJhbXMoKTtcclxuICAgIHJldHVybiB0aGlzLl90aWxlV2lkdGg7XHJcbn07XHJcblxyXG5Xb3JrZXJQcm94eUltYWdlRGVjb2Rlci5wcm90b3R5cGUuZ2V0VGlsZUhlaWdodCA9IGZ1bmN0aW9uIGdldFRpbGVIZWlnaHQoKSB7XHJcbiAgICB0aGlzLmdldEltYWdlUGFyYW1zKCk7XHJcbiAgICByZXR1cm4gdGhpcy5fdGlsZUhlaWdodDtcclxufTtcclxuXHJcbldvcmtlclByb3h5SW1hZ2VEZWNvZGVyLnByb3RvdHlwZS5vcGVuID0gZnVuY3Rpb24gb3Blbih1cmwpIHtcclxuICAgIHZhciBzZWxmID0gdGhpcztcclxuICAgIHJldHVybiB0aGlzLl93b3JrZXJIZWxwZXIuY2FsbEZ1bmN0aW9uKCdvcGVuJywgW3VybF0sIHsgaXNSZXR1cm5Qcm9taXNlOiB0cnVlIH0pXHJcbiAgICAgICAgLnRoZW4oZnVuY3Rpb24oaW1hZ2VQYXJhbXMpIHtcclxuICAgICAgICAgICAgc2VsZi5faW1hZ2VPcGVuZWQoaW1hZ2VQYXJhbXMpO1xyXG4gICAgICAgICAgICByZXR1cm4gaW1hZ2VQYXJhbXM7XHJcbiAgICAgICAgfSk7XHJcbn07XHJcblxyXG5Xb3JrZXJQcm94eUltYWdlRGVjb2Rlci5wcm90b3R5cGUuY2xvc2UgPSBmdW5jdGlvbiBjbG9zZSgpIHtcclxuICAgIHJldHVybiB0aGlzLl93b3JrZXJIZWxwZXIuY2FsbEZ1bmN0aW9uKCdjbG9zZScsIFtdLCB7IGlzUmV0dXJuUHJvbWlzZTogdHJ1ZSB9KTtcclxufTtcclxuXHJcbldvcmtlclByb3h5SW1hZ2VEZWNvZGVyLnByb3RvdHlwZS5jcmVhdGVDaGFubmVsID0gZnVuY3Rpb24gY3JlYXRlQ2hhbm5lbCgpIHtcclxuICAgIHRoaXMuX3dvcmtlckhlbHBlci5jYWxsRnVuY3Rpb24oXHJcbiAgICAgICAgJ2NyZWF0ZUNoYW5uZWwnLCBbXSwgeyBpc1JldHVyblByb21pc2U6IHRydWUgfSk7XHJcbn07XHJcblxyXG5Xb3JrZXJQcm94eUltYWdlRGVjb2Rlci5wcm90b3R5cGUucmVxdWVzdFBpeGVscyA9IGZ1bmN0aW9uIHJlcXVlc3RQaXhlbHMoaW1hZ2VQYXJ0UGFyYW1zKSB7XHJcbiAgICB2YXIgcGF0aFRvUGl4ZWxzQXJyYXkgPSBbJ2RhdGEnLCAnYnVmZmVyJ107XHJcbiAgICB2YXIgdHJhbnNmZXJhYmxlcyA9IFtwYXRoVG9QaXhlbHNBcnJheV07XHJcbiAgICBcclxuICAgIHZhciBhcmdzID0gW2ltYWdlUGFydFBhcmFtc107XHJcbiAgICBcclxuICAgIHRoaXMuX3dvcmtlckhlbHBlci5jYWxsRnVuY3Rpb24oJ3JlcXVlc3RQaXhlbHMnLCBhcmdzLCB7XHJcbiAgICAgICAgaXNSZXR1cm5Qcm9taXNlOiB0cnVlLFxyXG4gICAgICAgIHBhdGhzVG9UcmFuc2ZlcmFibGVzSW5Qcm9taXNlUmVzdWx0OiB0cmFuc2ZlcmFibGVzXHJcbiAgICB9KTtcclxufTtcclxuXHJcbldvcmtlclByb3h5SW1hZ2VEZWNvZGVyLnByb3RvdHlwZS5yZXF1ZXN0UGl4ZWxzUHJvZ3Jlc3NpdmUgPSBmdW5jdGlvbiByZXF1ZXN0UGl4ZWxzUHJvZ3Jlc3NpdmUoXHJcbiAgICBpbWFnZVBhcnRQYXJhbXMsXHJcbiAgICBjYWxsYmFjayxcclxuICAgIHRlcm1pbmF0ZWRDYWxsYmFjayxcclxuICAgIGltYWdlUGFydFBhcmFtc05vdE5lZWRlZCxcclxuICAgIGNoYW5uZWxIYW5kbGUpIHtcclxuICAgIFxyXG4gICAgdmFyIHRyYW5zZmVyYWJsZXM7XHJcbiAgICBcclxuICAgIC8vIE5PVEU6IENhbm5vdCBwYXNzIGl0IGFzIHRyYW5zZmVyYWJsZXMgYmVjYXVzZSBpdCBpcyBwYXNzZWQgdG8gYWxsXHJcbiAgICAvLyBsaXN0ZW5lciBjYWxsYmFja3MsIHRodXMgYWZ0ZXIgdGhlIGZpcnN0IG9uZSB0aGUgYnVmZmVyIGlzIG5vdCB2YWxpZFxyXG4gICAgXHJcbiAgICAvL3ZhciBwYXRoVG9QaXhlbHNBcnJheSA9IFswLCAncGl4ZWxzJywgJ2J1ZmZlciddO1xyXG4gICAgLy90cmFuc2ZlcmFibGVzID0gW3BhdGhUb1BpeGVsc0FycmF5XTtcclxuICAgIFxyXG4gICAgdmFyIGludGVybmFsQ2FsbGJhY2tXcmFwcGVyID1cclxuICAgICAgICB0aGlzLl93b3JrZXJIZWxwZXIud3JhcENhbGxiYWNrKFxyXG4gICAgICAgICAgICBjYWxsYmFjaywgJ3JlcXVlc3RQaXhlbHNQcm9ncmVzc2l2ZUNhbGxiYWNrJywge1xyXG4gICAgICAgICAgICAgICAgaXNNdWx0aXBsZVRpbWVDYWxsYmFjazogdHJ1ZSxcclxuICAgICAgICAgICAgICAgIHBhdGhzVG9UcmFuc2ZlcmFibGVzOiB0cmFuc2ZlcmFibGVzXHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICApO1xyXG4gICAgXHJcbiAgICB2YXIgaW50ZXJuYWxUZXJtaW5hdGVkQ2FsbGJhY2tXcmFwcGVyID1cclxuICAgICAgICB0aGlzLl93b3JrZXJIZWxwZXIud3JhcENhbGxiYWNrKFxyXG4gICAgICAgICAgICBpbnRlcm5hbFRlcm1pbmF0ZWRDYWxsYmFjaywgJ3JlcXVlc3RQaXhlbHNQcm9ncmVzc2l2ZVRlcm1pbmF0ZWRDYWxsYmFjaycsIHtcclxuICAgICAgICAgICAgICAgIGlzTXVsdGlwbGVUaW1lQ2FsbGJhY2s6IGZhbHNlXHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICApO1xyXG4gICAgICAgICAgICBcclxuICAgIHZhciBhcmdzID0gW1xyXG4gICAgICAgIGltYWdlUGFydFBhcmFtcyxcclxuICAgICAgICBpbnRlcm5hbENhbGxiYWNrV3JhcHBlcixcclxuICAgICAgICBpbnRlcm5hbFRlcm1pbmF0ZWRDYWxsYmFja1dyYXBwZXIsXHJcbiAgICAgICAgaW1hZ2VQYXJ0UGFyYW1zTm90TmVlZGVkLFxyXG4gICAgICAgIGNoYW5uZWxIYW5kbGVdO1xyXG4gICAgXHJcbiAgICB0aGlzLl93b3JrZXJIZWxwZXIuY2FsbEZ1bmN0aW9uKCdyZXF1ZXN0UGl4ZWxzUHJvZ3Jlc3NpdmUnLCBhcmdzKTtcclxuICAgICAgICBcclxuICAgIHZhciBzZWxmID0gdGhpcztcclxuICAgIFxyXG4gICAgZnVuY3Rpb24gaW50ZXJuYWxUZXJtaW5hdGVkQ2FsbGJhY2soaXNBYm9ydGVkKSB7XHJcbiAgICAgICAgc2VsZi5fd29ya2VySGVscGVyLmZyZWVDYWxsYmFjayhpbnRlcm5hbENhbGxiYWNrV3JhcHBlcik7XHJcbiAgICAgICAgXHJcbiAgICAgICAgdGVybWluYXRlZENhbGxiYWNrKGlzQWJvcnRlZCk7XHJcbiAgICB9XHJcbn07XHJcblxyXG5Xb3JrZXJQcm94eUltYWdlRGVjb2Rlci5wcm90b3R5cGUuc2V0U2VydmVyUmVxdWVzdFByaW9yaXRpemVyRGF0YSA9XHJcbiAgICBmdW5jdGlvbiBzZXRTZXJ2ZXJSZXF1ZXN0UHJpb3JpdGl6ZXJEYXRhKHByaW9yaXRpemVyRGF0YSkge1xyXG4gICAgXHJcbiAgICB0aGlzLl93b3JrZXJIZWxwZXIuY2FsbEZ1bmN0aW9uKFxyXG4gICAgICAgICdzZXRTZXJ2ZXJSZXF1ZXN0UHJpb3JpdGl6ZXJEYXRhJyxcclxuICAgICAgICBbIHByaW9yaXRpemVyRGF0YSBdLFxyXG4gICAgICAgIHsgaXNTZW5kSW1tZWRpYXRlbHk6IHRydWUgfSk7XHJcbn07XHJcblxyXG5Xb3JrZXJQcm94eUltYWdlRGVjb2Rlci5wcm90b3R5cGUuc2V0RGVjb2RlUHJpb3JpdGl6ZXJEYXRhID1cclxuICAgIGZ1bmN0aW9uIHNldERlY29kZVByaW9yaXRpemVyRGF0YShwcmlvcml0aXplckRhdGEpIHtcclxuICAgIFxyXG4gICAgdGhpcy5fd29ya2VySGVscGVyLmNhbGxGdW5jdGlvbihcclxuICAgICAgICAnc2V0RGVjb2RlUHJpb3JpdGl6ZXJEYXRhJyxcclxuICAgICAgICBbIHByaW9yaXRpemVyRGF0YSBdLFxyXG4gICAgICAgIHsgaXNTZW5kSW1tZWRpYXRlbHk6IHRydWUgfSk7XHJcbn07XHJcblxyXG5Xb3JrZXJQcm94eUltYWdlRGVjb2Rlci5wcm90b3R5cGUucmVjb25uZWN0ID0gZnVuY3Rpb24gcmVjb25uZWN0KCkge1xyXG4gICAgdGhpcy5fd29ya2VySGVscGVyLmNhbGxGdW5jdGlvbigncmVjb25uZWN0Jyk7XHJcbn07XHJcblxyXG5Xb3JrZXJQcm94eUltYWdlRGVjb2Rlci5wcm90b3R5cGUuYWxpZ25QYXJhbXNUb1RpbGVzQW5kTGV2ZWwgPSBmdW5jdGlvbiBhbGlnblBhcmFtc1RvVGlsZXNBbmRMZXZlbChyZWdpb24pIHtcclxuXHRyZXR1cm4gaW1hZ2VIZWxwZXJGdW5jdGlvbnMuYWxpZ25QYXJhbXNUb1RpbGVzQW5kTGV2ZWwocmVnaW9uLCB0aGlzKTtcclxufTtcclxuXHJcbldvcmtlclByb3h5SW1hZ2VEZWNvZGVyLnByb3RvdHlwZS5faW1hZ2VPcGVuZWQgPSBmdW5jdGlvbiBpbWFnZU9wZW5lZChkYXRhKSB7XHJcbiAgICB0aGlzLl9pbnRlcm5hbFNpemVzUGFyYW1zID0gZGF0YS5zaXplc1BhcmFtcztcclxuICAgIHRoaXMuX3RpbGVXaWR0aCA9IGRhdGEuYXBwbGljYXRpdmVUaWxlV2lkdGg7XHJcbiAgICB0aGlzLl90aWxlSGVpZ2h0ID0gZGF0YS5hcHBsaWNhdGl2ZVRpbGVIZWlnaHQ7XHJcbiAgICB0aGlzLmdldEltYWdlUGFyYW1zKCk7XHJcbn07XHJcblxyXG5Xb3JrZXJQcm94eUltYWdlRGVjb2Rlci5wcm90b3R5cGUuX2dldEltYWdlUGFyYW1zSW50ZXJuYWwgPSBmdW5jdGlvbiBnZXRJbWFnZVBhcmFtc0ludGVybmFsKCkge1xyXG4gICAgcmV0dXJuIHRoaXMuX2ludGVybmFsU2l6ZXNQYXJhbXM7XHJcbn07IiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBWaWV3ZXJJbWFnZURlY29kZXI7XHJcblxyXG52YXIgSW1hZ2VEZWNvZGVyID0gcmVxdWlyZSgnaW1hZ2VkZWNvZGVyLmpzJyk7XHJcbnZhciBXb3JrZXJQcm94eUltYWdlRGVjb2RlciA9IHJlcXVpcmUoJ3dvcmtlcnByb3h5aW1hZ2VkZWNvZGVyLmpzJyk7XHJcbnZhciBpbWFnZUhlbHBlckZ1bmN0aW9ucyA9IHJlcXVpcmUoJ2ltYWdlaGVscGVyZnVuY3Rpb25zLmpzJyk7XHJcblxyXG52YXIgUEVORElOR19DQUxMX1RZUEVfUElYRUxTX1VQREFURUQgPSAxO1xyXG52YXIgUEVORElOR19DQUxMX1RZUEVfUkVQT1NJVElPTiA9IDI7XHJcblxyXG52YXIgUkVHSU9OX09WRVJWSUVXID0gMDtcclxudmFyIFJFR0lPTl9EWU5BTUlDID0gMTtcclxuXHJcbmZ1bmN0aW9uIFZpZXdlckltYWdlRGVjb2RlcihkZWNvZGVyLCBjYW52YXNVcGRhdGVkQ2FsbGJhY2ssIG9wdGlvbnMpIHtcclxuICAgIHRoaXMuX2NhbnZhc1VwZGF0ZWRDYWxsYmFjayA9IGNhbnZhc1VwZGF0ZWRDYWxsYmFjaztcclxuICAgIFxyXG4gICAgdGhpcy5fYWRhcHRQcm9wb3J0aW9ucyA9IG9wdGlvbnMuYWRhcHRQcm9wb3J0aW9ucztcclxuICAgIHRoaXMuX2NhcnRvZ3JhcGhpY0JvdW5kcyA9IG9wdGlvbnMuY2FydG9ncmFwaGljQm91bmRzO1xyXG4gICAgdGhpcy5faXNNYWluSW1hZ2VPblVpID0gb3B0aW9ucy5pc01haW5JbWFnZU9uVWk7XHJcbiAgICB0aGlzLl9zaG93TG9nID0gb3B0aW9ucy5zaG93TG9nO1xyXG4gICAgdGhpcy5fYWxsb3dNdWx0aXBsZUNoYW5uZWxzSW5TZXNzaW9uID1cclxuICAgICAgICBvcHRpb25zLmFsbG93TXVsdGlwbGVDaGFubmVsc0luU2Vzc2lvbjtcclxuICAgIHRoaXMuX21pbkZ1bmN0aW9uQ2FsbEludGVydmFsTWlsbGlzZWNvbmRzID1cclxuICAgICAgICBvcHRpb25zLm1pbkZ1bmN0aW9uQ2FsbEludGVydmFsTWlsbGlzZWNvbmRzO1xyXG4gICAgdGhpcy5fb3ZlcnZpZXdSZXNvbHV0aW9uWCA9IG9wdGlvbnMub3ZlcnZpZXdSZXNvbHV0aW9uWCB8fCAxMDA7XHJcbiAgICB0aGlzLl9vdmVydmlld1Jlc29sdXRpb25ZID0gb3B0aW9ucy5vdmVydmlld1Jlc29sdXRpb25ZIHx8IDEwMDtcclxuICAgICAgICBcclxuICAgIHRoaXMuX2xhc3RSZXF1ZXN0SW5kZXggPSAwO1xyXG4gICAgdGhpcy5fcGVuZGluZ1VwZGF0ZVZpZXdBcmVhID0gbnVsbDtcclxuICAgIHRoaXMuX3JlZ2lvbnMgPSBbXTtcclxuICAgIHRoaXMuX3RhcmdldENhbnZhcyA9IG51bGw7XHJcbiAgICBcclxuICAgIHRoaXMuX2NhbGxQZW5kaW5nQ2FsbGJhY2tzQm91bmQgPSB0aGlzLl9jYWxsUGVuZGluZ0NhbGxiYWNrcy5iaW5kKHRoaXMpO1xyXG4gICAgdGhpcy5fY3JlYXRlZENoYW5uZWxCb3VuZCA9IHRoaXMuX2NyZWF0ZWRDaGFubmVsLmJpbmQodGhpcyk7XHJcbiAgICBcclxuICAgIHRoaXMuX3BlbmRpbmdDYWxsYmFja3NJbnRlcnZhbEhhbmRsZSA9IDA7XHJcbiAgICB0aGlzLl9wZW5kaW5nQ2FsbGJhY2tDYWxscyA9IFtdO1xyXG4gICAgdGhpcy5fY2FuU2hvd0R5bmFtaWNSZWdpb24gPSBmYWxzZTtcclxuICAgIFxyXG4gICAgaWYgKHRoaXMuX2NhcnRvZ3JhcGhpY0JvdW5kcyA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgdGhpcy5fY2FydG9ncmFwaGljQm91bmRzID0ge1xyXG4gICAgICAgICAgICB3ZXN0OiAtMTc1LjAsXHJcbiAgICAgICAgICAgIGVhc3Q6IDE3NS4wLFxyXG4gICAgICAgICAgICBzb3V0aDogLTg1LjAsXHJcbiAgICAgICAgICAgIG5vcnRoOiA4NS4wXHJcbiAgICAgICAgfTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgaWYgKHRoaXMuX2FkYXB0UHJvcG9ydGlvbnMgPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIHRoaXMuX2FkYXB0UHJvcG9ydGlvbnMgPSB0cnVlO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICB0aGlzLl9kZWNvZGVyID0gZGVjb2RlcjtcclxuICAgIC8qXHJcbiAgICB2YXIgSW1hZ2VUeXBlID0gdGhpcy5faXNNYWluSW1hZ2VPblVpID9cclxuICAgICAgICBJbWFnZURlY29kZXI6IFdvcmtlclByb3h5SW1hZ2VEZWNvZGVyO1xyXG5cclxuICAgIHRoaXMuX2ltYWdlID0gbmV3IEltYWdlVHlwZShpbWFnZUltcGxlbWVudGF0aW9uQ2xhc3NOYW1lLCB7XHJcbiAgICAgICAgc2VydmVyUmVxdWVzdFByaW9yaXRpemVyOiAnZnJ1c3R1bU9ubHknLFxyXG4gICAgICAgIC8vIFRPRE8gZGVjb2RlUHJpb3JpdGl6ZXI6ICdmcnVzdHVtT25seScsXHJcbiAgICAgICAgc2hvd0xvZzogdGhpcy5fc2hvd0xvZ1xyXG4gICAgfSk7XHJcbiAgICAqL1xyXG4gICAgXHJcbiAgICB0aGlzLl9pbWFnZSA9IGRlY29kZXIuZ2V0SW1hZ2UoKTtcclxufVxyXG5cclxuVmlld2VySW1hZ2VEZWNvZGVyLnByb3RvdHlwZS5zZXRFeGNlcHRpb25DYWxsYmFjayA9IGZ1bmN0aW9uIHNldEV4Y2VwdGlvbkNhbGxiYWNrKGV4Y2VwdGlvbkNhbGxiYWNrKSB7XHJcbiAgICAvLyBUT0RPOiBTdXBwb3J0IGV4Y2VwdGlvbkNhbGxiYWNrIGluIGV2ZXJ5IHBsYWNlIG5lZWRlZFxyXG5cdHRoaXMuX2V4Y2VwdGlvbkNhbGxiYWNrID0gZXhjZXB0aW9uQ2FsbGJhY2s7XHJcbn07XHJcbiAgICBcclxuVmlld2VySW1hZ2VEZWNvZGVyLnByb3RvdHlwZS5vcGVuID0gZnVuY3Rpb24gb3Blbih1cmwpIHtcclxuICAgIHJldHVybiB0aGlzLl9kZWNvZGVyLm9wZW4odXJsKVxyXG4gICAgICAgIC50aGVuKHRoaXMuX29wZW5lZC5iaW5kKHRoaXMpKVxyXG4gICAgICAgIC5jYXRjaCh0aGlzLl9leGNlcHRpb25DYWxsYmFjayk7XHJcbn07XHJcblxyXG5WaWV3ZXJJbWFnZURlY29kZXIucHJvdG90eXBlLmNsb3NlID0gZnVuY3Rpb24gY2xvc2UoKSB7XHJcbiAgICB2YXIgcHJvbWlzZSA9IHRoaXMuX2RlY29kZXIuY2xvc2UoKTtcclxuICAgIHByb21pc2UuY2F0Y2godGhpcy5fZXhjZXB0aW9uQ2FsbGJhY2spO1xyXG4gICAgdGhpcy5faXNSZWFkeSA9IGZhbHNlO1xyXG4gICAgdGhpcy5fY2FuU2hvd0R5bmFtaWNSZWdpb24gPSBmYWxzZTtcclxuICAgIHRoaXMuX3RhcmdldENhbnZhcyA9IG51bGw7XHJcblx0cmV0dXJuIHByb21pc2U7XHJcbn07XHJcblxyXG5WaWV3ZXJJbWFnZURlY29kZXIucHJvdG90eXBlLnNldFRhcmdldENhbnZhcyA9IGZ1bmN0aW9uIHNldFRhcmdldENhbnZhcyhjYW52YXMpIHtcclxuICAgIHRoaXMuX3RhcmdldENhbnZhcyA9IGNhbnZhcztcclxufTtcclxuXHJcblZpZXdlckltYWdlRGVjb2Rlci5wcm90b3R5cGUudXBkYXRlVmlld0FyZWEgPSBmdW5jdGlvbiB1cGRhdGVWaWV3QXJlYShmcnVzdHVtRGF0YSkge1xyXG4gICAgaWYgKHRoaXMuX3RhcmdldENhbnZhcyA9PT0gbnVsbCkge1xyXG4gICAgICAgIHRocm93ICdDYW5ub3QgdXBkYXRlIGR5bmFtaWMgcmVnaW9uIGJlZm9yZSBzZXRUYXJnZXRDYW52YXMoKSc7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGlmICghdGhpcy5fY2FuU2hvd0R5bmFtaWNSZWdpb24pIHtcclxuICAgICAgICB0aGlzLl9wZW5kaW5nVXBkYXRlVmlld0FyZWEgPSBmcnVzdHVtRGF0YTtcclxuICAgICAgICBcclxuICAgICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHZhciBib3VuZHMgPSBmcnVzdHVtRGF0YS5yZWN0YW5nbGU7XHJcbiAgICB2YXIgc2NyZWVuU2l6ZSA9IGZydXN0dW1EYXRhLnNjcmVlblNpemU7XHJcbiAgICBcclxuICAgIHZhciByZWdpb25QYXJhbXMgPSB7XHJcbiAgICAgICAgbWluWDogYm91bmRzLndlc3QgKiB0aGlzLl9zY2FsZVggKyB0aGlzLl90cmFuc2xhdGVYLFxyXG4gICAgICAgIG1pblk6IGJvdW5kcy5ub3J0aCAqIHRoaXMuX3NjYWxlWSArIHRoaXMuX3RyYW5zbGF0ZVksXHJcbiAgICAgICAgbWF4WEV4Y2x1c2l2ZTogYm91bmRzLmVhc3QgKiB0aGlzLl9zY2FsZVggKyB0aGlzLl90cmFuc2xhdGVYLFxyXG4gICAgICAgIG1heFlFeGNsdXNpdmU6IGJvdW5kcy5zb3V0aCAqIHRoaXMuX3NjYWxlWSArIHRoaXMuX3RyYW5zbGF0ZVksXHJcbiAgICAgICAgc2NyZWVuV2lkdGg6IHNjcmVlblNpemUueCxcclxuICAgICAgICBzY3JlZW5IZWlnaHQ6IHNjcmVlblNpemUueVxyXG4gICAgfTtcclxuICAgIFxyXG4gICAgdmFyIGFsaWduZWRQYXJhbXMgPVxyXG4gICAgICAgIGltYWdlSGVscGVyRnVuY3Rpb25zLmFsaWduUGFyYW1zVG9UaWxlc0FuZExldmVsKFxyXG4gICAgICAgICAgICByZWdpb25QYXJhbXMsIHRoaXMuX2RlY29kZXIsIHRoaXMuX2ltYWdlKTtcclxuICAgIFxyXG4gICAgdmFyIGlzT3V0c2lkZVNjcmVlbiA9IGFsaWduZWRQYXJhbXMgPT09IG51bGw7XHJcbiAgICBpZiAoaXNPdXRzaWRlU2NyZWVuKSB7XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBhbGlnbmVkUGFyYW1zLmltYWdlUGFydFBhcmFtcy5xdWFsaXR5ID0gdGhpcy5fcXVhbGl0eTtcclxuXHJcbiAgICB2YXIgaXNTYW1lUmVnaW9uID1cclxuICAgICAgICB0aGlzLl9keW5hbWljRmV0Y2hQYXJhbXMgIT09IHVuZGVmaW5lZCAmJlxyXG4gICAgICAgIHRoaXMuX2lzSW1hZ2VQYXJ0c0VxdWFsKFxyXG4gICAgICAgICAgICBhbGlnbmVkUGFyYW1zLmltYWdlUGFydFBhcmFtcyxcclxuICAgICAgICAgICAgdGhpcy5fZHluYW1pY0ZldGNoUGFyYW1zLmltYWdlUGFydFBhcmFtcyk7XHJcbiAgICBcclxuICAgIGlmIChpc1NhbWVSZWdpb24pIHtcclxuICAgICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGZydXN0dW1EYXRhLmltYWdlUmVjdGFuZ2xlID0gdGhpcy5fY2FydG9ncmFwaGljQm91bmRzRml4ZWQ7XHJcbiAgICBmcnVzdHVtRGF0YS5leGFjdGxldmVsID1cclxuICAgICAgICBhbGlnbmVkUGFyYW1zLmltYWdlUGFydFBhcmFtcy5sZXZlbDtcclxuICAgIFxyXG4gICAgdGhpcy5fZGVjb2Rlci5zZXREZWNvZGVQcmlvcml0aXplckRhdGEoZnJ1c3R1bURhdGEpO1xyXG4gICAgdGhpcy5fZGVjb2Rlci5zZXRTZXJ2ZXJSZXF1ZXN0UHJpb3JpdGl6ZXJEYXRhKGZydXN0dW1EYXRhKTtcclxuXHJcbiAgICB0aGlzLl9keW5hbWljRmV0Y2hQYXJhbXMgPSBhbGlnbmVkUGFyYW1zO1xyXG4gICAgXHJcbiAgICB2YXIgc3RhcnREeW5hbWljUmVnaW9uT25UZXJtaW5hdGlvbiA9IGZhbHNlO1xyXG4gICAgdmFyIG1vdmVFeGlzdGluZ0NoYW5uZWwgPSAhdGhpcy5fYWxsb3dNdWx0aXBsZUNoYW5uZWxzSW5TZXNzaW9uO1xyXG4gICAgdGhpcy5fZmV0Y2goXHJcbiAgICAgICAgUkVHSU9OX0RZTkFNSUMsXHJcbiAgICAgICAgYWxpZ25lZFBhcmFtcyxcclxuICAgICAgICBzdGFydER5bmFtaWNSZWdpb25PblRlcm1pbmF0aW9uLFxyXG4gICAgICAgIG1vdmVFeGlzdGluZ0NoYW5uZWwpO1xyXG59O1xyXG5cclxuVmlld2VySW1hZ2VEZWNvZGVyLnByb3RvdHlwZS5nZXRCb3VuZHMgPSBmdW5jdGlvbiBnZXRDYXJ0b2dyYXBoaWNCb3VuZHMoKSB7XHJcbiAgICBpZiAoIXRoaXMuX2lzUmVhZHkpIHtcclxuICAgICAgICB0aHJvdyAnVmlld2VySW1hZ2VEZWNvZGVyIGVycm9yOiBJbWFnZSBpcyBub3QgcmVhZHkgeWV0JztcclxuICAgIH1cclxuICAgIHJldHVybiB0aGlzLl9jYXJ0b2dyYXBoaWNCb3VuZHNGaXhlZDtcclxufTtcclxuXHJcblZpZXdlckltYWdlRGVjb2Rlci5wcm90b3R5cGUuX2lzSW1hZ2VQYXJ0c0VxdWFsID0gZnVuY3Rpb24gaXNJbWFnZVBhcnRzRXF1YWwoZmlyc3QsIHNlY29uZCkge1xyXG4gICAgdmFyIGlzRXF1YWwgPVxyXG4gICAgICAgIHRoaXMuX2R5bmFtaWNGZXRjaFBhcmFtcyAhPT0gdW5kZWZpbmVkICYmXHJcbiAgICAgICAgZmlyc3QubWluWCA9PT0gc2Vjb25kLm1pblggJiZcclxuICAgICAgICBmaXJzdC5taW5ZID09PSBzZWNvbmQubWluWSAmJlxyXG4gICAgICAgIGZpcnN0Lm1heFhFeGNsdXNpdmUgPT09IHNlY29uZC5tYXhYRXhjbHVzaXZlICYmXHJcbiAgICAgICAgZmlyc3QubWF4WUV4Y2x1c2l2ZSA9PT0gc2Vjb25kLm1heFlFeGNsdXNpdmUgJiZcclxuICAgICAgICBmaXJzdC5sZXZlbCA9PT0gc2Vjb25kLmxldmVsO1xyXG4gICAgXHJcbiAgICByZXR1cm4gaXNFcXVhbDtcclxufTtcclxuXHJcblZpZXdlckltYWdlRGVjb2Rlci5wcm90b3R5cGUuX2ZldGNoID0gZnVuY3Rpb24gZmV0Y2goXHJcbiAgICByZWdpb25JZCxcclxuICAgIGZldGNoUGFyYW1zLFxyXG4gICAgc3RhcnREeW5hbWljUmVnaW9uT25UZXJtaW5hdGlvbixcclxuICAgIG1vdmVFeGlzdGluZ0NoYW5uZWwpIHtcclxuICAgIFxyXG4gICAgdmFyIHJlcXVlc3RJbmRleCA9ICsrdGhpcy5fbGFzdFJlcXVlc3RJbmRleDtcclxuICAgIFxyXG4gICAgdmFyIGltYWdlUGFydFBhcmFtcyA9IGZldGNoUGFyYW1zLmltYWdlUGFydFBhcmFtcztcclxuICAgIGltYWdlUGFydFBhcmFtcy5yZXF1ZXN0UHJpb3JpdHlEYXRhID1cclxuICAgICAgICBpbWFnZVBhcnRQYXJhbXMucmVxdWVzdFByaW9yaXR5RGF0YSB8fCB7fTtcclxuICAgIFxyXG4gICAgaW1hZ2VQYXJ0UGFyYW1zLnJlcXVlc3RQcmlvcml0eURhdGEucmVxdWVzdEluZGV4ID0gcmVxdWVzdEluZGV4O1xyXG5cclxuICAgIHZhciBtaW5YID0gZmV0Y2hQYXJhbXMucG9zaXRpb25JbkltYWdlLm1pblg7XHJcbiAgICB2YXIgbWluWSA9IGZldGNoUGFyYW1zLnBvc2l0aW9uSW5JbWFnZS5taW5ZO1xyXG4gICAgdmFyIG1heFggPSBmZXRjaFBhcmFtcy5wb3NpdGlvbkluSW1hZ2UubWF4WEV4Y2x1c2l2ZTtcclxuICAgIHZhciBtYXhZID0gZmV0Y2hQYXJhbXMucG9zaXRpb25JbkltYWdlLm1heFlFeGNsdXNpdmU7XHJcbiAgICBcclxuICAgIHZhciB3ZXN0ID0gKG1pblggLSB0aGlzLl90cmFuc2xhdGVYKSAvIHRoaXMuX3NjYWxlWDtcclxuICAgIHZhciBlYXN0ID0gKG1heFggLSB0aGlzLl90cmFuc2xhdGVYKSAvIHRoaXMuX3NjYWxlWDtcclxuICAgIHZhciBub3J0aCA9IChtaW5ZIC0gdGhpcy5fdHJhbnNsYXRlWSkgLyB0aGlzLl9zY2FsZVk7XHJcbiAgICB2YXIgc291dGggPSAobWF4WSAtIHRoaXMuX3RyYW5zbGF0ZVkpIC8gdGhpcy5fc2NhbGVZO1xyXG4gICAgXHJcbiAgICB2YXIgcG9zaXRpb24gPSB7XHJcbiAgICAgICAgd2VzdDogd2VzdCxcclxuICAgICAgICBlYXN0OiBlYXN0LFxyXG4gICAgICAgIG5vcnRoOiBub3J0aCxcclxuICAgICAgICBzb3V0aDogc291dGhcclxuICAgIH07XHJcbiAgICBcclxuICAgIHZhciBjYW5SZXVzZU9sZERhdGEgPSBmYWxzZTtcclxuICAgIHZhciBmZXRjaFBhcmFtc05vdE5lZWRlZDtcclxuICAgIFxyXG4gICAgdmFyIHJlZ2lvbiA9IHRoaXMuX3JlZ2lvbnNbcmVnaW9uSWRdO1xyXG4gICAgaWYgKHJlZ2lvbiAhPT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgdmFyIG5ld1Jlc29sdXRpb24gPSBpbWFnZVBhcnRQYXJhbXMubGV2ZWw7XHJcbiAgICAgICAgdmFyIG9sZFJlc29sdXRpb24gPSByZWdpb24uaW1hZ2VQYXJ0UGFyYW1zLmxldmVsO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGNhblJldXNlT2xkRGF0YSA9IG5ld1Jlc29sdXRpb24gPT09IG9sZFJlc29sdXRpb247XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKGNhblJldXNlT2xkRGF0YSAmJiByZWdpb24uZG9uZVBhcnRQYXJhbXMpIHtcclxuICAgICAgICAgICAgZmV0Y2hQYXJhbXNOb3ROZWVkZWQgPSBbIHJlZ2lvbi5kb25lUGFydFBhcmFtcyBdO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgaWYgKHJlZ2lvbklkICE9PSBSRUdJT05fT1ZFUlZJRVcpIHtcclxuICAgICAgICAgICAgdmFyIGFkZGVkUGVuZGluZ0NhbGwgPSB0aGlzLl9jaGVja0lmUmVwb3NpdGlvbk5lZWRlZChcclxuICAgICAgICAgICAgICAgIHJlZ2lvbiwgaW1hZ2VQYXJ0UGFyYW1zLCBwb3NpdGlvbik7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBpZiAoYWRkZWRQZW5kaW5nQ2FsbCkge1xyXG4gICAgICAgICAgICAgICAgdGhpcy5fbm90aWZ5TmV3UGVuZGluZ0NhbGxzKCk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHZhciBzZWxmID0gdGhpcztcclxuICAgIFxyXG4gICAgdmFyIGNoYW5uZWxIYW5kbGUgPSBtb3ZlRXhpc3RpbmdDaGFubmVsID8gdGhpcy5fY2hhbm5lbEhhbmRsZTogdW5kZWZpbmVkO1xyXG5cclxuICAgIHRoaXMuX2RlY29kZXIucmVxdWVzdFBpeGVsc1Byb2dyZXNzaXZlKFxyXG4gICAgICAgIGZldGNoUGFyYW1zLmltYWdlUGFydFBhcmFtcyxcclxuICAgICAgICBjYWxsYmFjayxcclxuICAgICAgICB0ZXJtaW5hdGVkQ2FsbGJhY2ssXHJcbiAgICAgICAgZmV0Y2hQYXJhbXNOb3ROZWVkZWQsXHJcbiAgICAgICAgY2hhbm5lbEhhbmRsZSk7XHJcbiAgICBcclxuICAgIGZ1bmN0aW9uIGNhbGxiYWNrKGRlY29kZWQpIHtcclxuICAgICAgICBzZWxmLl90aWxlc0RlY29kZWRDYWxsYmFjayhcclxuICAgICAgICAgICAgcmVnaW9uSWQsXHJcbiAgICAgICAgICAgIGZldGNoUGFyYW1zLFxyXG4gICAgICAgICAgICBwb3NpdGlvbixcclxuICAgICAgICAgICAgZGVjb2RlZCk7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGZ1bmN0aW9uIHRlcm1pbmF0ZWRDYWxsYmFjayhpc0Fib3J0ZWQpIHtcclxuICAgICAgICBpZiAoaXNBYm9ydGVkICYmXHJcbiAgICAgICAgICAgIGltYWdlUGFydFBhcmFtcy5yZXF1ZXN0UHJpb3JpdHlEYXRhLm92ZXJyaWRlSGlnaGVzdFByaW9yaXR5KSB7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBOT1RFOiBCdWcgaW4ga2R1X3NlcnZlciBjYXVzZXMgZmlyc3QgcmVxdWVzdCB0byBiZSBzZW50IHdyb25nbHkuXHJcbiAgICAgICAgICAgIC8vIFRoZW4gQ2hyb21lIHJhaXNlcyBFUlJfSU5WQUxJRF9DSFVOS0VEX0VOQ09ESU5HIGFuZCB0aGUgcmVxdWVzdFxyXG4gICAgICAgICAgICAvLyBuZXZlciByZXR1cm5zLiBUaHVzIHBlcmZvcm0gc2Vjb25kIHJlcXVlc3QuXHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBzZWxmLl9kZWNvZGVyLnJlcXVlc3RQaXhlbHNQcm9ncmVzc2l2ZShcclxuICAgICAgICAgICAgICAgIGZldGNoUGFyYW1zLmltYWdlUGFydFBhcmFtcyxcclxuICAgICAgICAgICAgICAgIGNhbGxiYWNrLFxyXG4gICAgICAgICAgICAgICAgdGVybWluYXRlZENhbGxiYWNrLFxyXG4gICAgICAgICAgICAgICAgZmV0Y2hQYXJhbXNOb3ROZWVkZWQpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBzZWxmLl9mZXRjaFRlcm1pbmF0ZWRDYWxsYmFjayhcclxuICAgICAgICAgICAgcmVnaW9uSWQsXHJcbiAgICAgICAgICAgIGZldGNoUGFyYW1zLmltYWdlUGFydFBhcmFtcy5yZXF1ZXN0UHJpb3JpdHlEYXRhLFxyXG4gICAgICAgICAgICBpc0Fib3J0ZWQsXHJcbiAgICAgICAgICAgIHN0YXJ0RHluYW1pY1JlZ2lvbk9uVGVybWluYXRpb24pO1xyXG4gICAgfVxyXG59O1xyXG5cclxuVmlld2VySW1hZ2VEZWNvZGVyLnByb3RvdHlwZS5fZmV0Y2hUZXJtaW5hdGVkQ2FsbGJhY2sgPSBmdW5jdGlvbiBmZXRjaFRlcm1pbmF0ZWRDYWxsYmFjayhcclxuICAgIHJlZ2lvbklkLCBwcmlvcml0eURhdGEsIGlzQWJvcnRlZCwgc3RhcnREeW5hbWljUmVnaW9uT25UZXJtaW5hdGlvbikge1xyXG4gICAgXHJcbiAgICB2YXIgcmVnaW9uID0gdGhpcy5fcmVnaW9uc1tyZWdpb25JZF07XHJcbiAgICBpZiAocmVnaW9uID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGlmICghcHJpb3JpdHlEYXRhLm92ZXJyaWRlSGlnaGVzdFByaW9yaXR5ICYmXHJcbiAgICAgICAgcHJpb3JpdHlEYXRhLnJlcXVlc3RJbmRleCAhPT0gdGhpcy5fbGFzdFJlcXVlc3RJbmRleCkge1xyXG4gICAgXHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICByZWdpb24uaXNEb25lID0gIWlzQWJvcnRlZCAmJiB0aGlzLl9pc1JlYWR5O1xyXG5cdGlmIChyZWdpb24uaXNEb25lKSB7XHJcblx0XHRyZWdpb24uZG9uZVBhcnRQYXJhbXMgPSByZWdpb24uaW1hZ2VQYXJ0UGFyYW1zO1xyXG5cdH1cclxuICAgIFxyXG4gICAgaWYgKHN0YXJ0RHluYW1pY1JlZ2lvbk9uVGVybWluYXRpb24pIHtcclxuICAgICAgICB0aGlzLl9kZWNvZGVyLmNyZWF0ZUNoYW5uZWwoKS50aGVuKHRoaXMuX2NyZWF0ZWRDaGFubmVsQm91bmQpO1xyXG4gICAgfVxyXG59O1xyXG5cclxuVmlld2VySW1hZ2VEZWNvZGVyLnByb3RvdHlwZS5fY3JlYXRlZENoYW5uZWwgPSBmdW5jdGlvbiBjcmVhdGVkQ2hhbm5lbChjaGFubmVsSGFuZGxlKSB7XHJcbiAgICB0aGlzLl9jaGFubmVsSGFuZGxlID0gY2hhbm5lbEhhbmRsZTtcclxuICAgIHRoaXMuX3N0YXJ0U2hvd2luZ0R5bmFtaWNSZWdpb24oKTtcclxufTtcclxuXHJcblZpZXdlckltYWdlRGVjb2Rlci5wcm90b3R5cGUuX3N0YXJ0U2hvd2luZ0R5bmFtaWNSZWdpb24gPSBmdW5jdGlvbiBzdGFydFNob3dpbmdEeW5hbWljUmVnaW9uKCkge1xyXG4gICAgdGhpcy5fY2FuU2hvd0R5bmFtaWNSZWdpb24gPSB0cnVlO1xyXG4gICAgXHJcbiAgICBpZiAodGhpcy5fcGVuZGluZ1VwZGF0ZVZpZXdBcmVhICE9PSBudWxsKSB7XHJcbiAgICAgICAgdGhpcy51cGRhdGVWaWV3QXJlYSh0aGlzLl9wZW5kaW5nVXBkYXRlVmlld0FyZWEpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHRoaXMuX3BlbmRpbmdVcGRhdGVWaWV3QXJlYSA9IG51bGw7XHJcbiAgICB9XHJcbn07XHJcblxyXG5WaWV3ZXJJbWFnZURlY29kZXIucHJvdG90eXBlLl90aWxlc0RlY29kZWRDYWxsYmFjayA9IGZ1bmN0aW9uIHRpbGVzRGVjb2RlZENhbGxiYWNrKFxyXG4gICAgcmVnaW9uSWQsIGZldGNoUGFyYW1zLCBwb3NpdGlvbiwgZGVjb2RlZCkge1xyXG4gICAgXHJcbiAgICBpZiAoIXRoaXMuX2lzUmVhZHkpIHtcclxuICAgICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHZhciByZWdpb24gPSB0aGlzLl9yZWdpb25zW3JlZ2lvbklkXTtcclxuICAgIGlmIChyZWdpb24gPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIHJlZ2lvbiA9IHt9O1xyXG4gICAgICAgIHRoaXMuX3JlZ2lvbnNbcmVnaW9uSWRdID0gcmVnaW9uO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHN3aXRjaCAocmVnaW9uSWQpIHtcclxuICAgICAgICAgICAgY2FzZSBSRUdJT05fRFlOQU1JQzpcclxuICAgICAgICAgICAgICAgIHJlZ2lvbi5jYW52YXMgPSB0aGlzLl90YXJnZXRDYW52YXM7XHJcbiAgICAgICAgICAgICAgICBicmVhaztcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBjYXNlIFJFR0lPTl9PVkVSVklFVzpcclxuICAgICAgICAgICAgICAgIHJlZ2lvbi5jYW52YXMgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdjYW52YXMnKTtcclxuICAgICAgICAgICAgICAgIGJyZWFrO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgZGVmYXVsdDpcclxuICAgICAgICAgICAgICAgIHRocm93ICdVbmV4cGVjdGVkIHJlZ2lvbklkICcgKyByZWdpb25JZDtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHZhciBwYXJ0UGFyYW1zID0gZmV0Y2hQYXJhbXMuaW1hZ2VQYXJ0UGFyYW1zO1xyXG4gICAgaWYgKCFwYXJ0UGFyYW1zLnJlcXVlc3RQcmlvcml0eURhdGEub3ZlcnJpZGVIaWdoZXN0UHJpb3JpdHkgJiZcclxuICAgICAgICBwYXJ0UGFyYW1zLnJlcXVlc3RQcmlvcml0eURhdGEucmVxdWVzdEluZGV4IDwgcmVnaW9uLmN1cnJlbnREaXNwbGF5UmVxdWVzdEluZGV4KSB7XHJcbiAgICAgICAgXHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICB0aGlzLl9jaGVja0lmUmVwb3NpdGlvbk5lZWRlZChyZWdpb24sIHBhcnRQYXJhbXMsIHBvc2l0aW9uKTtcclxuICAgICAgICBcclxuICAgIHRoaXMuX3BlbmRpbmdDYWxsYmFja0NhbGxzLnB1c2goe1xyXG4gICAgICAgIHR5cGU6IFBFTkRJTkdfQ0FMTF9UWVBFX1BJWEVMU19VUERBVEVELFxyXG4gICAgICAgIHJlZ2lvbjogcmVnaW9uLFxyXG4gICAgICAgIGRlY29kZWQ6IGRlY29kZWRcclxuICAgIH0pO1xyXG4gICAgXHJcbiAgICB0aGlzLl9ub3RpZnlOZXdQZW5kaW5nQ2FsbHMoKTtcclxufTtcclxuXHJcblZpZXdlckltYWdlRGVjb2Rlci5wcm90b3R5cGUuX2NoZWNrSWZSZXBvc2l0aW9uTmVlZGVkID0gZnVuY3Rpb24gY2hlY2tJZlJlcG9zaXRpb25OZWVkZWQoXHJcbiAgICByZWdpb24sIG5ld1BhcnRQYXJhbXMsIG5ld1Bvc2l0aW9uKSB7XHJcbiAgICBcclxuICAgIHZhciBvbGRQYXJ0UGFyYW1zID0gcmVnaW9uLmltYWdlUGFydFBhcmFtcztcclxuXHR2YXIgb2xkRG9uZVBhcnRQYXJhbXMgPSByZWdpb24uZG9uZVBhcnRQYXJhbXM7XHJcbiAgICB2YXIgbGV2ZWwgPSBuZXdQYXJ0UGFyYW1zLmxldmVsO1xyXG4gICAgXHJcbiAgICB2YXIgbmVlZFJlcG9zaXRpb24gPVxyXG4gICAgICAgIG9sZFBhcnRQYXJhbXMgPT09IHVuZGVmaW5lZCB8fFxyXG4gICAgICAgIG9sZFBhcnRQYXJhbXMubWluWCAhPT0gbmV3UGFydFBhcmFtcy5taW5YIHx8XHJcbiAgICAgICAgb2xkUGFydFBhcmFtcy5taW5ZICE9PSBuZXdQYXJ0UGFyYW1zLm1pblkgfHxcclxuICAgICAgICBvbGRQYXJ0UGFyYW1zLm1heFhFeGNsdXNpdmUgIT09IG5ld1BhcnRQYXJhbXMubWF4WEV4Y2x1c2l2ZSB8fFxyXG4gICAgICAgIG9sZFBhcnRQYXJhbXMubWF4WUV4Y2x1c2l2ZSAhPT0gbmV3UGFydFBhcmFtcy5tYXhZRXhjbHVzaXZlIHx8XHJcbiAgICAgICAgb2xkUGFydFBhcmFtcy5sZXZlbCAhPT0gbGV2ZWw7XHJcbiAgICBcclxuICAgIGlmICghbmVlZFJlcG9zaXRpb24pIHtcclxuICAgICAgICByZXR1cm4gZmFsc2U7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHZhciBjb3B5RGF0YTtcclxuICAgIHZhciBpbnRlcnNlY3Rpb247XHJcblx0dmFyIG5ld0RvbmVQYXJ0UGFyYW1zO1xyXG4gICAgdmFyIHJldXNlT2xkRGF0YSA9IGZhbHNlO1xyXG4gICAgdmFyIHNjYWxlWDtcclxuICAgIHZhciBzY2FsZVk7XHJcbiAgICBpZiAob2xkUGFydFBhcmFtcyAhPT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgc2NhbGVYID0gbmV3UGFydFBhcmFtcy5sZXZlbFdpZHRoICAvIG9sZFBhcnRQYXJhbXMubGV2ZWxXaWR0aDtcclxuICAgICAgICBzY2FsZVkgPSBuZXdQYXJ0UGFyYW1zLmxldmVsSGVpZ2h0IC8gb2xkUGFydFBhcmFtcy5sZXZlbEhlaWdodDtcclxuICAgICAgICBcclxuICAgICAgICBpbnRlcnNlY3Rpb24gPSB7XHJcbiAgICAgICAgICAgIG1pblg6IE1hdGgubWF4KG9sZFBhcnRQYXJhbXMubWluWCAqIHNjYWxlWCwgbmV3UGFydFBhcmFtcy5taW5YKSxcclxuICAgICAgICAgICAgbWluWTogTWF0aC5tYXgob2xkUGFydFBhcmFtcy5taW5ZICogc2NhbGVZLCBuZXdQYXJ0UGFyYW1zLm1pblkpLFxyXG4gICAgICAgICAgICBtYXhYOiBNYXRoLm1pbihvbGRQYXJ0UGFyYW1zLm1heFhFeGNsdXNpdmUgKiBzY2FsZVgsIG5ld1BhcnRQYXJhbXMubWF4WEV4Y2x1c2l2ZSksXHJcbiAgICAgICAgICAgIG1heFk6IE1hdGgubWluKG9sZFBhcnRQYXJhbXMubWF4WUV4Y2x1c2l2ZSAqIHNjYWxlWSwgbmV3UGFydFBhcmFtcy5tYXhZRXhjbHVzaXZlKVxyXG4gICAgICAgIH07XHJcbiAgICAgICAgcmV1c2VPbGREYXRhID1cclxuICAgICAgICAgICAgaW50ZXJzZWN0aW9uLm1heFggPiBpbnRlcnNlY3Rpb24ubWluWCAmJlxyXG4gICAgICAgICAgICBpbnRlcnNlY3Rpb24ubWF4WSA+IGludGVyc2VjdGlvbi5taW5ZO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBpZiAocmV1c2VPbGREYXRhKSB7XHJcbiAgICAgICAgY29weURhdGEgPSB7XHJcbiAgICAgICAgICAgIGZyb21YOiBpbnRlcnNlY3Rpb24ubWluWCAvIHNjYWxlWCAtIG9sZFBhcnRQYXJhbXMubWluWCxcclxuICAgICAgICAgICAgZnJvbVk6IGludGVyc2VjdGlvbi5taW5ZIC8gc2NhbGVZIC0gb2xkUGFydFBhcmFtcy5taW5ZLFxyXG4gICAgICAgICAgICBmcm9tV2lkdGggOiAoaW50ZXJzZWN0aW9uLm1heFggLSBpbnRlcnNlY3Rpb24ubWluWCkgLyBzY2FsZVgsXHJcbiAgICAgICAgICAgIGZyb21IZWlnaHQ6IChpbnRlcnNlY3Rpb24ubWF4WSAtIGludGVyc2VjdGlvbi5taW5ZKSAvIHNjYWxlWSxcclxuICAgICAgICAgICAgdG9YOiBpbnRlcnNlY3Rpb24ubWluWCAtIG5ld1BhcnRQYXJhbXMubWluWCxcclxuICAgICAgICAgICAgdG9ZOiBpbnRlcnNlY3Rpb24ubWluWSAtIG5ld1BhcnRQYXJhbXMubWluWSxcclxuICAgICAgICAgICAgdG9XaWR0aCA6IGludGVyc2VjdGlvbi5tYXhYIC0gaW50ZXJzZWN0aW9uLm1pblgsXHJcbiAgICAgICAgICAgIHRvSGVpZ2h0OiBpbnRlcnNlY3Rpb24ubWF4WSAtIGludGVyc2VjdGlvbi5taW5ZLFxyXG4gICAgICAgIH07XHJcblx0XHJcblx0XHRpZiAob2xkRG9uZVBhcnRQYXJhbXMgJiYgb2xkUGFydFBhcmFtcy5sZXZlbCA9PT0gbGV2ZWwpIHtcclxuXHRcdFx0bmV3RG9uZVBhcnRQYXJhbXMgPSB7XHJcblx0XHRcdFx0bWluWDogTWF0aC5tYXgob2xkRG9uZVBhcnRQYXJhbXMubWluWCwgbmV3UGFydFBhcmFtcy5taW5YKSxcclxuXHRcdFx0XHRtaW5ZOiBNYXRoLm1heChvbGREb25lUGFydFBhcmFtcy5taW5ZLCBuZXdQYXJ0UGFyYW1zLm1pblkpLFxyXG5cdFx0XHRcdG1heFhFeGNsdXNpdmU6IE1hdGgubWluKG9sZERvbmVQYXJ0UGFyYW1zLm1heFhFeGNsdXNpdmUsIG5ld1BhcnRQYXJhbXMubWF4WEV4Y2x1c2l2ZSksXHJcblx0XHRcdFx0bWF4WUV4Y2x1c2l2ZTogTWF0aC5taW4ob2xkRG9uZVBhcnRQYXJhbXMubWF4WUV4Y2x1c2l2ZSwgbmV3UGFydFBhcmFtcy5tYXhZRXhjbHVzaXZlKVxyXG5cdFx0XHR9O1xyXG5cdFx0fVxyXG5cdH1cclxuICAgIFxyXG4gICAgcmVnaW9uLmltYWdlUGFydFBhcmFtcyA9IG5ld1BhcnRQYXJhbXM7XHJcbiAgICByZWdpb24uaXNEb25lID0gZmFsc2U7XHJcbiAgICByZWdpb24uY3VycmVudERpc3BsYXlSZXF1ZXN0SW5kZXggPSBuZXdQYXJ0UGFyYW1zLnJlcXVlc3RQcmlvcml0eURhdGEucmVxdWVzdEluZGV4O1xyXG4gICAgXHJcbiAgICB2YXIgcmVwb3NpdGlvbkFyZ3MgPSB7XHJcbiAgICAgICAgdHlwZTogUEVORElOR19DQUxMX1RZUEVfUkVQT1NJVElPTixcclxuICAgICAgICByZWdpb246IHJlZ2lvbixcclxuICAgICAgICBwb3NpdGlvbjogbmV3UG9zaXRpb24sXHJcblx0XHRkb25lUGFydFBhcmFtczogbmV3RG9uZVBhcnRQYXJhbXMsXHJcbiAgICAgICAgY29weURhdGE6IGNvcHlEYXRhLFxyXG4gICAgICAgIHBpeGVsc1dpZHRoOiBuZXdQYXJ0UGFyYW1zLm1heFhFeGNsdXNpdmUgLSBuZXdQYXJ0UGFyYW1zLm1pblgsXHJcbiAgICAgICAgcGl4ZWxzSGVpZ2h0OiBuZXdQYXJ0UGFyYW1zLm1heFlFeGNsdXNpdmUgLSBuZXdQYXJ0UGFyYW1zLm1pbllcclxuICAgIH07XHJcbiAgICBcclxuICAgIHRoaXMuX3BlbmRpbmdDYWxsYmFja0NhbGxzLnB1c2gocmVwb3NpdGlvbkFyZ3MpO1xyXG4gICAgXHJcbiAgICByZXR1cm4gdHJ1ZTtcclxufTtcclxuXHJcblZpZXdlckltYWdlRGVjb2Rlci5wcm90b3R5cGUuX25vdGlmeU5ld1BlbmRpbmdDYWxscyA9IGZ1bmN0aW9uIG5vdGlmeU5ld1BlbmRpbmdDYWxscygpIHtcclxuICAgIGlmICghdGhpcy5faXNOZWFyQ2FsbGJhY2tDYWxsZWQpIHtcclxuICAgICAgICB0aGlzLl9jYWxsUGVuZGluZ0NhbGxiYWNrcygpO1xyXG4gICAgfVxyXG59O1xyXG5cclxuVmlld2VySW1hZ2VEZWNvZGVyLnByb3RvdHlwZS5fY2FsbFBlbmRpbmdDYWxsYmFja3MgPSBmdW5jdGlvbiBjYWxsUGVuZGluZ0NhbGxiYWNrcygpIHtcclxuICAgIGlmICh0aGlzLl9wZW5kaW5nQ2FsbGJhY2tDYWxscy5sZW5ndGggPT09IDAgfHwgIXRoaXMuX2lzUmVhZHkpIHtcclxuICAgICAgICB0aGlzLl9pc05lYXJDYWxsYmFja0NhbGxlZCA9IGZhbHNlO1xyXG4gICAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIFxyXG4gICAgaWYgKHRoaXMuX2lzTmVhckNhbGxiYWNrQ2FsbGVkKSB7XHJcbiAgICAgICAgY2xlYXJUaW1lb3V0KHRoaXMuX3BlbmRpbmdDYWxsYmFja3NJbnRlcnZhbEhhbmRsZSk7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGlmICh0aGlzLl9taW5GdW5jdGlvbkNhbGxJbnRlcnZhbE1pbGxpc2Vjb25kcyAhPT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgdGhpcy5fcGVuZGluZ0NhbGxiYWNrc0ludGVydmFsSGFuZGxlID1cclxuICAgICAgICAgICAgc2V0VGltZW91dCh0aGlzLl9jYWxsUGVuZGluZ0NhbGxiYWNrc0JvdW5kLFxyXG4gICAgICAgICAgICB0aGlzLl9taW5GdW5jdGlvbkNhbGxJbnRlcnZhbE1pbGxpc2Vjb25kcyk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgIHRoaXMuX2lzTmVhckNhbGxiYWNrQ2FsbGVkID0gdHJ1ZTtcclxuICAgIH1cclxuXHJcbiAgICB2YXIgbmV3UG9zaXRpb24gPSBudWxsO1xyXG4gICAgXHJcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IHRoaXMuX3BlbmRpbmdDYWxsYmFja0NhbGxzLmxlbmd0aDsgKytpKSB7XHJcbiAgICAgICAgdmFyIGNhbGxBcmdzID0gdGhpcy5fcGVuZGluZ0NhbGxiYWNrQ2FsbHNbaV07XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKGNhbGxBcmdzLnR5cGUgPT09IFBFTkRJTkdfQ0FMTF9UWVBFX1JFUE9TSVRJT04pIHtcclxuICAgICAgICAgICAgdGhpcy5fcmVwb3NpdGlvbkNhbnZhcyhjYWxsQXJncyk7XHJcbiAgICAgICAgICAgIG5ld1Bvc2l0aW9uID0gY2FsbEFyZ3MucG9zaXRpb247XHJcbiAgICAgICAgfSBlbHNlIGlmIChjYWxsQXJncy50eXBlID09PSBQRU5ESU5HX0NBTExfVFlQRV9QSVhFTFNfVVBEQVRFRCkge1xyXG4gICAgICAgICAgICB0aGlzLl9waXhlbHNVcGRhdGVkKGNhbGxBcmdzKTtcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICB0aHJvdyAnSW50ZXJuYWwgVmlld2VySW1hZ2VEZWNvZGVyIEVycm9yOiBVbmV4cGVjdGVkIGNhbGwgdHlwZSAnICtcclxuICAgICAgICAgICAgICAgIGNhbGxBcmdzLnR5cGU7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgXHJcbiAgICB0aGlzLl9wZW5kaW5nQ2FsbGJhY2tDYWxscy5sZW5ndGggPSAwO1xyXG4gICAgXHJcbiAgICB0aGlzLl9jYW52YXNVcGRhdGVkQ2FsbGJhY2sobmV3UG9zaXRpb24pO1xyXG59O1xyXG5cclxuVmlld2VySW1hZ2VEZWNvZGVyLnByb3RvdHlwZS5fcGl4ZWxzVXBkYXRlZCA9IGZ1bmN0aW9uIHBpeGVsc1VwZGF0ZWQocGl4ZWxzVXBkYXRlZEFyZ3MpIHtcclxuICAgIHZhciByZWdpb24gPSBwaXhlbHNVcGRhdGVkQXJncy5yZWdpb247XHJcbiAgICB2YXIgZGVjb2RlZCA9IHBpeGVsc1VwZGF0ZWRBcmdzLmRlY29kZWQ7XHJcbiAgICBpZiAoZGVjb2RlZC5pbWFnZURhdGEud2lkdGggPT09IDAgfHwgZGVjb2RlZC5pbWFnZURhdGEuaGVpZ2h0ID09PSAwKSB7XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICB2YXIgeCA9IGRlY29kZWQueEluT3JpZ2luYWxSZXF1ZXN0O1xyXG4gICAgdmFyIHkgPSBkZWNvZGVkLnlJbk9yaWdpbmFsUmVxdWVzdDtcclxuICAgIFxyXG4gICAgdmFyIGNvbnRleHQgPSByZWdpb24uY2FudmFzLmdldENvbnRleHQoJzJkJyk7XHJcbiAgICAvL3ZhciBpbWFnZURhdGEgPSBjb250ZXh0LmNyZWF0ZUltYWdlRGF0YShkZWNvZGVkLndpZHRoLCBkZWNvZGVkLmhlaWdodCk7XHJcbiAgICAvL2ltYWdlRGF0YS5kYXRhLnNldChkZWNvZGVkLnBpeGVscyk7XHJcbiAgICBcclxuICAgIGNvbnRleHQucHV0SW1hZ2VEYXRhKGRlY29kZWQuaW1hZ2VEYXRhLCB4LCB5KTtcclxufTtcclxuXHJcblZpZXdlckltYWdlRGVjb2Rlci5wcm90b3R5cGUuX3JlcG9zaXRpb25DYW52YXMgPSBmdW5jdGlvbiByZXBvc2l0aW9uQ2FudmFzKHJlcG9zaXRpb25BcmdzKSB7XHJcbiAgICB2YXIgcmVnaW9uID0gcmVwb3NpdGlvbkFyZ3MucmVnaW9uO1xyXG4gICAgdmFyIHBvc2l0aW9uID0gcmVwb3NpdGlvbkFyZ3MucG9zaXRpb247XHJcblx0dmFyIGRvbmVQYXJ0UGFyYW1zID0gcmVwb3NpdGlvbkFyZ3MuZG9uZVBhcnRQYXJhbXM7XHJcbiAgICB2YXIgY29weURhdGEgPSByZXBvc2l0aW9uQXJncy5jb3B5RGF0YTtcclxuICAgIHZhciBwaXhlbHNXaWR0aCA9IHJlcG9zaXRpb25BcmdzLnBpeGVsc1dpZHRoO1xyXG4gICAgdmFyIHBpeGVsc0hlaWdodCA9IHJlcG9zaXRpb25BcmdzLnBpeGVsc0hlaWdodDtcclxuICAgIFxyXG4gICAgdmFyIGltYWdlRGF0YVRvQ29weTtcclxuICAgIHZhciBjb250ZXh0ID0gcmVnaW9uLmNhbnZhcy5nZXRDb250ZXh0KCcyZCcpO1xyXG4gICAgXHJcbiAgICBpZiAoY29weURhdGEgIT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIGlmIChjb3B5RGF0YS5mcm9tV2lkdGggPT09IGNvcHlEYXRhLnRvV2lkdGggJiYgY29weURhdGEuZnJvbUhlaWdodCA9PT0gY29weURhdGEudG9IZWlnaHQpIHtcclxuICAgICAgICAgICAgaW1hZ2VEYXRhVG9Db3B5ID0gY29udGV4dC5nZXRJbWFnZURhdGEoXHJcbiAgICAgICAgICAgICAgICBjb3B5RGF0YS5mcm9tWCwgY29weURhdGEuZnJvbVksIGNvcHlEYXRhLmZyb21XaWR0aCwgY29weURhdGEuZnJvbUhlaWdodCk7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgaWYgKCF0aGlzLl90bXBDYW52YXMpIHtcclxuICAgICAgICAgICAgICAgIHRoaXMuX3RtcENhbnZhcyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2NhbnZhcycpO1xyXG4gICAgICAgICAgICAgICAgdGhpcy5fdG1wQ2FudmFzQ29udGV4dCA9IHRoaXMuX3RtcENhbnZhcy5nZXRDb250ZXh0KCcyZCcpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICB0aGlzLl90bXBDYW52YXMud2lkdGggID0gY29weURhdGEudG9XaWR0aDtcclxuICAgICAgICAgICAgdGhpcy5fdG1wQ2FudmFzLmhlaWdodCA9IGNvcHlEYXRhLnRvSGVpZ2h0O1xyXG4gICAgICAgICAgICB0aGlzLl90bXBDYW52YXNDb250ZXh0LmRyYXdJbWFnZShcclxuICAgICAgICAgICAgICAgIHJlZ2lvbi5jYW52YXMsXHJcbiAgICAgICAgICAgICAgICBjb3B5RGF0YS5mcm9tWCwgY29weURhdGEuZnJvbVksIGNvcHlEYXRhLmZyb21XaWR0aCwgY29weURhdGEuZnJvbUhlaWdodCxcclxuICAgICAgICAgICAgICAgIDAsIDAsIGNvcHlEYXRhLnRvV2lkdGgsIGNvcHlEYXRhLnRvSGVpZ2h0KTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGltYWdlRGF0YVRvQ29weSA9IHRoaXMuX3RtcENhbnZhc0NvbnRleHQuZ2V0SW1hZ2VEYXRhKFxyXG4gICAgICAgICAgICAgICAgMCwgMCwgY29weURhdGEudG9XaWR0aCwgY29weURhdGEudG9IZWlnaHQpO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuICAgIFxyXG4gICAgcmVnaW9uLmNhbnZhcy53aWR0aCA9IHBpeGVsc1dpZHRoO1xyXG4gICAgcmVnaW9uLmNhbnZhcy5oZWlnaHQgPSBwaXhlbHNIZWlnaHQ7XHJcbiAgICBcclxuICAgIGlmIChyZWdpb24gIT09IHRoaXMuX3JlZ2lvbnNbUkVHSU9OX09WRVJWSUVXXSkge1xyXG4gICAgICAgIHRoaXMuX2NvcHlPdmVydmlld1RvQ2FudmFzKFxyXG4gICAgICAgICAgICBjb250ZXh0LCBwb3NpdGlvbiwgcGl4ZWxzV2lkdGgsIHBpeGVsc0hlaWdodCk7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGlmIChjb3B5RGF0YSAhPT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgY29udGV4dC5wdXRJbWFnZURhdGEoaW1hZ2VEYXRhVG9Db3B5LCBjb3B5RGF0YS50b1gsIGNvcHlEYXRhLnRvWSk7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHJlZ2lvbi5wb3NpdGlvbiA9IHBvc2l0aW9uO1xyXG5cdHJlZ2lvbi5kb25lUGFydFBhcmFtcyA9IGRvbmVQYXJ0UGFyYW1zO1xyXG59O1xyXG5cclxuVmlld2VySW1hZ2VEZWNvZGVyLnByb3RvdHlwZS5fY29weU92ZXJ2aWV3VG9DYW52YXMgPSBmdW5jdGlvbiBjb3B5T3ZlcnZpZXdUb0NhbnZhcyhcclxuICAgIGNvbnRleHQsIGNhbnZhc1Bvc2l0aW9uLCBjYW52YXNQaXhlbHNXaWR0aCwgY2FudmFzUGl4ZWxzSGVpZ2h0KSB7XHJcbiAgICBcclxuICAgIHZhciBzb3VyY2VQb3NpdGlvbiA9IHRoaXMuX3JlZ2lvbnNbUkVHSU9OX09WRVJWSUVXXS5wb3NpdGlvbjtcclxuICAgIHZhciBzb3VyY2VQaXhlbHMgPVxyXG4gICAgICAgIHRoaXMuX3JlZ2lvbnNbUkVHSU9OX09WRVJWSUVXXS5pbWFnZVBhcnRQYXJhbXM7XHJcbiAgICBcclxuICAgIHZhciBzb3VyY2VQaXhlbHNXaWR0aCA9XHJcbiAgICAgICAgc291cmNlUGl4ZWxzLm1heFhFeGNsdXNpdmUgLSBzb3VyY2VQaXhlbHMubWluWDtcclxuICAgIHZhciBzb3VyY2VQaXhlbHNIZWlnaHQgPVxyXG4gICAgICAgIHNvdXJjZVBpeGVscy5tYXhZRXhjbHVzaXZlIC0gc291cmNlUGl4ZWxzLm1pblk7XHJcbiAgICBcclxuICAgIHZhciBzb3VyY2VQb3NpdGlvbldpZHRoID1cclxuICAgICAgICBzb3VyY2VQb3NpdGlvbi5lYXN0IC0gc291cmNlUG9zaXRpb24ud2VzdDtcclxuICAgIHZhciBzb3VyY2VQb3NpdGlvbkhlaWdodCA9XHJcbiAgICAgICAgc291cmNlUG9zaXRpb24ubm9ydGggLSBzb3VyY2VQb3NpdGlvbi5zb3V0aDtcclxuICAgICAgICBcclxuICAgIHZhciBzb3VyY2VSZXNvbHV0aW9uWCA9XHJcbiAgICAgICAgc291cmNlUGl4ZWxzV2lkdGggLyBzb3VyY2VQb3NpdGlvbldpZHRoO1xyXG4gICAgdmFyIHNvdXJjZVJlc29sdXRpb25ZID1cclxuICAgICAgICBzb3VyY2VQaXhlbHNIZWlnaHQgLyBzb3VyY2VQb3NpdGlvbkhlaWdodDtcclxuICAgIFxyXG4gICAgdmFyIHRhcmdldFBvc2l0aW9uV2lkdGggPVxyXG4gICAgICAgIGNhbnZhc1Bvc2l0aW9uLmVhc3QgLSBjYW52YXNQb3NpdGlvbi53ZXN0O1xyXG4gICAgdmFyIHRhcmdldFBvc2l0aW9uSGVpZ2h0ID1cclxuICAgICAgICBjYW52YXNQb3NpdGlvbi5ub3J0aCAtIGNhbnZhc1Bvc2l0aW9uLnNvdXRoO1xyXG4gICAgICAgIFxyXG4gICAgdmFyIGNyb3BXaWR0aCA9IHRhcmdldFBvc2l0aW9uV2lkdGggKiBzb3VyY2VSZXNvbHV0aW9uWDtcclxuICAgIHZhciBjcm9wSGVpZ2h0ID0gdGFyZ2V0UG9zaXRpb25IZWlnaHQgKiBzb3VyY2VSZXNvbHV0aW9uWTtcclxuICAgIFxyXG4gICAgdmFyIGNyb3BPZmZzZXRQb3NpdGlvblggPVxyXG4gICAgICAgIGNhbnZhc1Bvc2l0aW9uLndlc3QgLSBzb3VyY2VQb3NpdGlvbi53ZXN0O1xyXG4gICAgdmFyIGNyb3BPZmZzZXRQb3NpdGlvblkgPVxyXG4gICAgICAgIHNvdXJjZVBvc2l0aW9uLm5vcnRoIC0gY2FudmFzUG9zaXRpb24ubm9ydGg7XHJcbiAgICAgICAgXHJcbiAgICB2YXIgY3JvcFBpeGVsT2Zmc2V0WCA9IGNyb3BPZmZzZXRQb3NpdGlvblggKiBzb3VyY2VSZXNvbHV0aW9uWDtcclxuICAgIHZhciBjcm9wUGl4ZWxPZmZzZXRZID0gY3JvcE9mZnNldFBvc2l0aW9uWSAqIHNvdXJjZVJlc29sdXRpb25ZO1xyXG4gICAgXHJcbiAgICBjb250ZXh0LmRyYXdJbWFnZShcclxuICAgICAgICB0aGlzLl9yZWdpb25zW1JFR0lPTl9PVkVSVklFV10uY2FudmFzLFxyXG4gICAgICAgIGNyb3BQaXhlbE9mZnNldFgsIGNyb3BQaXhlbE9mZnNldFksIGNyb3BXaWR0aCwgY3JvcEhlaWdodCxcclxuICAgICAgICAwLCAwLCBjYW52YXNQaXhlbHNXaWR0aCwgY2FudmFzUGl4ZWxzSGVpZ2h0KTtcclxufTtcclxuXHJcblZpZXdlckltYWdlRGVjb2Rlci5wcm90b3R5cGUuX29wZW5lZCA9IGZ1bmN0aW9uIG9wZW5lZCgpIHtcclxuICAgIHRoaXMuX2lzUmVhZHkgPSB0cnVlO1xyXG4gICAgXHJcbiAgICB2YXIgZml4ZWRCb3VuZHMgPSB7XHJcbiAgICAgICAgd2VzdDogdGhpcy5fY2FydG9ncmFwaGljQm91bmRzLndlc3QsXHJcbiAgICAgICAgZWFzdDogdGhpcy5fY2FydG9ncmFwaGljQm91bmRzLmVhc3QsXHJcbiAgICAgICAgc291dGg6IHRoaXMuX2NhcnRvZ3JhcGhpY0JvdW5kcy5zb3V0aCxcclxuICAgICAgICBub3J0aDogdGhpcy5fY2FydG9ncmFwaGljQm91bmRzLm5vcnRoXHJcbiAgICB9O1xyXG4gICAgaW1hZ2VIZWxwZXJGdW5jdGlvbnMuZml4Qm91bmRzKFxyXG4gICAgICAgIGZpeGVkQm91bmRzLCB0aGlzLl9kZWNvZGVyLCB0aGlzLl9hZGFwdFByb3BvcnRpb25zKTtcclxuICAgIHRoaXMuX2NhcnRvZ3JhcGhpY0JvdW5kc0ZpeGVkID0gZml4ZWRCb3VuZHM7XHJcbiAgICBcclxuICAgIHZhciBpbWFnZVdpZHRoICA9IHRoaXMuX2RlY29kZXIuZ2V0SW1hZ2VXaWR0aCAoKTtcclxuICAgIHZhciBpbWFnZUhlaWdodCA9IHRoaXMuX2RlY29kZXIuZ2V0SW1hZ2VIZWlnaHQoKTtcclxuICAgIHRoaXMuX3F1YWxpdHkgPSB0aGlzLl9kZWNvZGVyLmdldEhpZ2hlc3RRdWFsaXR5KCk7XHJcblxyXG4gICAgdmFyIHJlY3RhbmdsZVdpZHRoID0gZml4ZWRCb3VuZHMuZWFzdCAtIGZpeGVkQm91bmRzLndlc3Q7XHJcbiAgICB2YXIgcmVjdGFuZ2xlSGVpZ2h0ID0gZml4ZWRCb3VuZHMubm9ydGggLSBmaXhlZEJvdW5kcy5zb3V0aDtcclxuICAgIHRoaXMuX3NjYWxlWCA9IGltYWdlV2lkdGggLyByZWN0YW5nbGVXaWR0aDtcclxuICAgIHRoaXMuX3NjYWxlWSA9IC1pbWFnZUhlaWdodCAvIHJlY3RhbmdsZUhlaWdodDtcclxuICAgIFxyXG4gICAgdGhpcy5fdHJhbnNsYXRlWCA9IC1maXhlZEJvdW5kcy53ZXN0ICogdGhpcy5fc2NhbGVYO1xyXG4gICAgdGhpcy5fdHJhbnNsYXRlWSA9IC1maXhlZEJvdW5kcy5ub3J0aCAqIHRoaXMuX3NjYWxlWTtcclxuICAgIFxyXG4gICAgdmFyIG92ZXJ2aWV3UGFyYW1zID0ge1xyXG4gICAgICAgIG1pblg6IDAsXHJcbiAgICAgICAgbWluWTogMCxcclxuICAgICAgICBtYXhYRXhjbHVzaXZlOiBpbWFnZVdpZHRoLFxyXG4gICAgICAgIG1heFlFeGNsdXNpdmU6IGltYWdlSGVpZ2h0LFxyXG4gICAgICAgIHNjcmVlbldpZHRoOiB0aGlzLl9vdmVydmlld1Jlc29sdXRpb25YLFxyXG4gICAgICAgIHNjcmVlbkhlaWdodDogdGhpcy5fb3ZlcnZpZXdSZXNvbHV0aW9uWVxyXG4gICAgfTtcclxuICAgIFxyXG4gICAgdmFyIG92ZXJ2aWV3QWxpZ25lZFBhcmFtcyA9XHJcbiAgICAgICAgaW1hZ2VIZWxwZXJGdW5jdGlvbnMuYWxpZ25QYXJhbXNUb1RpbGVzQW5kTGV2ZWwoXHJcbiAgICAgICAgICAgIG92ZXJ2aWV3UGFyYW1zLCB0aGlzLl9kZWNvZGVyLCB0aGlzLl9pbWFnZSk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgb3ZlcnZpZXdBbGlnbmVkUGFyYW1zLmltYWdlUGFydFBhcmFtcy5yZXF1ZXN0UHJpb3JpdHlEYXRhID1cclxuICAgICAgICBvdmVydmlld0FsaWduZWRQYXJhbXMuaW1hZ2VQYXJ0UGFyYW1zLnJlcXVlc3RQcmlvcml0eURhdGEgfHwge307XHJcbiAgICBcclxuICAgIG92ZXJ2aWV3QWxpZ25lZFBhcmFtcy5pbWFnZVBhcnRQYXJhbXMucmVxdWVzdFByaW9yaXR5RGF0YS5vdmVycmlkZUhpZ2hlc3RQcmlvcml0eSA9IHRydWU7XHJcbiAgICBvdmVydmlld0FsaWduZWRQYXJhbXMuaW1hZ2VQYXJ0UGFyYW1zLnF1YWxpdHkgPSB0aGlzLl9kZWNvZGVyLmdldExvd2VzdFF1YWxpdHkoKTtcclxuICAgIFxyXG4gICAgdmFyIHN0YXJ0RHluYW1pY1JlZ2lvbk9uVGVybWluYXRpb24gPVxyXG4gICAgICAgICF0aGlzLl9hbGxvd011bHRpcGxlQ2hhbm5lbHNJblNlc3Npb247XHJcbiAgICAgICAgXHJcbiAgICB0aGlzLl9mZXRjaChcclxuICAgICAgICBSRUdJT05fT1ZFUlZJRVcsXHJcbiAgICAgICAgb3ZlcnZpZXdBbGlnbmVkUGFyYW1zLFxyXG4gICAgICAgIHN0YXJ0RHluYW1pY1JlZ2lvbk9uVGVybWluYXRpb24pO1xyXG4gICAgXHJcbiAgICBpZiAodGhpcy5fYWxsb3dNdWx0aXBsZUNoYW5uZWxzSW5TZXNzaW9uKSB7XHJcbiAgICAgICAgdGhpcy5fc3RhcnRTaG93aW5nRHluYW1pY1JlZ2lvbigpO1xyXG4gICAgfVxyXG59OyIsIid1c2Ugc3RyaWN0JztcclxuXHJcbm1vZHVsZS5leHBvcnRzLlZpZXdlckltYWdlRGVjb2RlciA9IHJlcXVpcmUoJ3ZpZXdlcmltYWdlZGVjb2Rlci5qcycpO1xyXG5tb2R1bGUuZXhwb3J0cy5JbWFnZURlY29kZXIgPSByZXF1aXJlKCdpbWFnZWRlY29kZXIuanMnKTtcclxubW9kdWxlLmV4cG9ydHMuRmV0Y2hNYW5hZ2VyID0gcmVxdWlyZSgnZmV0Y2htYW5hZ2VyLmpzJyk7XHJcbm1vZHVsZS5leHBvcnRzLlByb21pc2VGZXRjaGVyQWRhcHRlciA9IHJlcXVpcmUoJ3Byb21pc2VmZXRjaGVyYWRhcHRlci5qcycpO1xyXG5tb2R1bGUuZXhwb3J0cy5HcmlkSW1hZ2VCYXNlID0gcmVxdWlyZSgnZ3JpZGltYWdlYmFzZS5qcycpO1xyXG5tb2R1bGUuZXhwb3J0cy5HcmlkRmV0Y2hlckJhc2UgPSByZXF1aXJlKCdncmlkZmV0Y2hlcmJhc2UuanMnKTtcclxubW9kdWxlLmV4cG9ydHMuR3JpZERlY29kZXJXb3JrZXJCYXNlID0gcmVxdWlyZSgnZ3JpZGRlY29kZXJ3b3JrZXJiYXNlLmpzJyk7XHJcbi8vbW9kdWxlLmV4cG9ydHMuU2ltcGxlRmV0Y2hlciA9IHJlcXVpcmUoJ3NpbXBsZWZldGNoZXIuanMnKTtcclxuLy9tb2R1bGUuZXhwb3J0cy5TaW1wbGVQaXhlbHNEZWNvZGVyQmFzZSA9IHJlcXVpcmUoJ3NpbXBsZXBpeGVsc2RlY29kZXJiYXNlLmpzJyk7XHJcbm1vZHVsZS5leHBvcnRzLkNlc2l1bUltYWdlRGVjb2RlckxheWVyTWFuYWdlciA9IHJlcXVpcmUoJ19jZXNpdW1pbWFnZWRlY29kZXJsYXllcm1hbmFnZXIuanMnKTtcclxubW9kdWxlLmV4cG9ydHMuSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyID0gcmVxdWlyZSgnaW1hZ2VkZWNvZGVyaW1hZ2VyeXByb3ZpZGVyLmpzJyk7XHJcbm1vZHVsZS5leHBvcnRzLkltYWdlRGVjb2RlclJlZ2lvbkxheWVyID0gcmVxdWlyZSgnaW1hZ2VkZWNvZGVycmVnaW9ubGF5ZXIuanMnKTtcclxuIiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxudmFyIFZpZXdlckltYWdlRGVjb2RlciA9IHJlcXVpcmUoJ3ZpZXdlcmltYWdlZGVjb2Rlci5qcycpO1xyXG52YXIgY2FsY3VsYXRlTGVhZmxldEZydXN0dW0gPSByZXF1aXJlKCdsZWFmbGV0ZnJ1c3R1bWNhbGN1bGF0b3IuanMnKTtcclxuXHJcbi8qIGdsb2JhbCBMOiBmYWxzZSAqL1xyXG4vKiBnbG9iYWwgc2VsZjogZmFsc2UgKi9cclxuXHJcbmlmIChzZWxmLkwpIHtcclxuICAgIG1vZHVsZS5leHBvcnRzID0gTC5DbGFzcy5leHRlbmQoY3JlYXRlSW1hZ2VEZWNvZGVyUmVnaW9uTGF5ZXJGdW5jdGlvbnMoKSk7XHJcbn0gZWxzZSB7XHJcbiAgICBtb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uKCkge1xyXG4gICAgICAgIHRocm93IG5ldyBFcnJvcignQ2Fubm90IGluc3RhbnRpYXRlIEltYWdlRGVjb2RlclJlZ2lvbkxheWVyOiBObyBMZWFmbGV0IG5hbWVzcGFjZSBpbiBzY29wZScpO1xyXG4gICAgfTtcclxufVxyXG5cclxuZnVuY3Rpb24gY3JlYXRlSW1hZ2VEZWNvZGVyUmVnaW9uTGF5ZXJGdW5jdGlvbnMoKSB7XHJcbiAgICByZXR1cm4ge1xyXG4gICAgICAgIGluaXRpYWxpemU6IGZ1bmN0aW9uIGluaXRpYWxpemUob3B0aW9ucykge1xyXG4gICAgICAgICAgICB0aGlzLl9vcHRpb25zID0gb3B0aW9ucyB8fCB7fTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGlmICh0aGlzLl9vcHRpb25zLmxhdExuZ0JvdW5kcyAhPT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgICAgICAgICB0aGlzLl9vcHRpb25zID0ge307XHJcbiAgICAgICAgICAgICAgICBmb3IgKHZhciBtZW1iZXIgaW4gb3B0aW9ucykge1xyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX29wdGlvbnNbbWVtYmVyXSA9IG9wdGlvbnNbbWVtYmVyXTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIHRoaXMuX29wdGlvbnMuY2FydG9ncmFwaGljQm91bmRzID0ge1xyXG4gICAgICAgICAgICAgICAgICAgIHdlc3Q6IG9wdGlvbnMubGF0TG5nQm91bmRzLmdldFdlc3QoKSxcclxuICAgICAgICAgICAgICAgICAgICBlYXN0OiBvcHRpb25zLmxhdExuZ0JvdW5kcy5nZXRFYXN0KCksXHJcbiAgICAgICAgICAgICAgICAgICAgc291dGg6IG9wdGlvbnMubGF0TG5nQm91bmRzLmdldFNvdXRoKCksXHJcbiAgICAgICAgICAgICAgICAgICAgbm9ydGg6IG9wdGlvbnMubGF0TG5nQm91bmRzLmdldE5vcnRoKClcclxuICAgICAgICAgICAgICAgIH07XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHRoaXMuX3RhcmdldENhbnZhcyA9IG51bGw7XHJcbiAgICAgICAgICAgIHRoaXMuX2NhbnZhc1Bvc2l0aW9uID0gbnVsbDtcclxuICAgICAgICAgICAgdGhpcy5fY2FudmFzVXBkYXRlZENhbGxiYWNrQm91bmQgPSB0aGlzLl9jYW52YXNVcGRhdGVkQ2FsbGJhY2suYmluZCh0aGlzKTtcclxuICAgICAgICAgICAgdGhpcy5fdmlld2VySW1hZ2VEZWNvZGVyID0gbnVsbDtcclxuICAgICAgICAgICAgdGhpcy5fZXhjZXB0aW9uQ2FsbGJhY2sgPSBudWxsO1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgXHJcbiAgICAgICAgc2V0RXhjZXB0aW9uQ2FsbGJhY2s6IGZ1bmN0aW9uIHNldEV4Y2VwdGlvbkNhbGxiYWNrKGV4Y2VwdGlvbkNhbGxiYWNrKSB7XHJcbiAgICAgICAgICAgIHRoaXMuX2V4Y2VwdGlvbkNhbGxiYWNrID0gZXhjZXB0aW9uQ2FsbGJhY2s7XHJcbiAgICAgICAgICAgIGlmICh0aGlzLl92aWV3ZXJJbWFnZURlY29kZXIgIT09IG51bGwpIHtcclxuICAgICAgICAgICAgICAgIHRoaXMuX3ZpZXdlckltYWdlRGVjb2Rlci5zZXRFeGNlcHRpb25DYWxsYmFjayhleGNlcHRpb25DYWxsYmFjayk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9LFxyXG4gICAgICAgIFxyXG4gICAgICAgIF9jcmVhdGVJbWFnZTogZnVuY3Rpb24gY3JlYXRlSW1hZ2UoKSB7XHJcbiAgICAgICAgICAgIGlmICh0aGlzLl92aWV3ZXJJbWFnZURlY29kZXIgPT09IG51bGwpIHtcclxuICAgICAgICAgICAgICAgIHRoaXMuX3ZpZXdlckltYWdlRGVjb2RlciA9IG5ldyBWaWV3ZXJJbWFnZURlY29kZXIoXHJcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5fb3B0aW9ucy5pbWFnZURlY29kZXIsXHJcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5fY2FudmFzVXBkYXRlZENhbGxiYWNrQm91bmQsXHJcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5fb3B0aW9ucyk7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIGlmICh0aGlzLl9leGNlcHRpb25DYWxsYmFjayAhPT0gbnVsbCkge1xyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX3ZpZXdlckltYWdlRGVjb2Rlci5zZXRFeGNlcHRpb25DYWxsYmFjayh0aGlzLl9leGNlcHRpb25DYWxsYmFjayk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIHRoaXMuX3ZpZXdlckltYWdlRGVjb2Rlci5vcGVuKHRoaXMuX29wdGlvbnMudXJsKS5jYXRjaCh0aGlzLl9leGNlcHRpb25DYWxsYmFjayk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9LFxyXG5cclxuICAgICAgICBvbkFkZDogZnVuY3Rpb24gb25BZGQobWFwKSB7XHJcbiAgICAgICAgICAgIGlmICh0aGlzLl9tYXAgIT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgICAgICAgICAgdGhyb3cgJ0Nhbm5vdCBhZGQgdGhpcyBsYXllciB0byB0d28gbWFwcyc7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHRoaXMuX21hcCA9IG1hcDtcclxuICAgICAgICAgICAgdGhpcy5fY3JlYXRlSW1hZ2UoKTtcclxuXHJcbiAgICAgICAgICAgIC8vIGNyZWF0ZSBhIERPTSBlbGVtZW50IGFuZCBwdXQgaXQgaW50byBvbmUgb2YgdGhlIG1hcCBwYW5lc1xyXG4gICAgICAgICAgICB0aGlzLl90YXJnZXRDYW52YXMgPSBMLkRvbVV0aWwuY3JlYXRlKFxyXG4gICAgICAgICAgICAgICAgJ2NhbnZhcycsICdpbWFnZS1kZWNvZGVyLWxheWVyLWNhbnZhcyBsZWFmbGV0LXpvb20tYW5pbWF0ZWQnKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHRoaXMuX3ZpZXdlckltYWdlRGVjb2Rlci5zZXRUYXJnZXRDYW52YXModGhpcy5fdGFyZ2V0Q2FudmFzKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHRoaXMuX2NhbnZhc1Bvc2l0aW9uID0gbnVsbDtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBtYXAuZ2V0UGFuZXMoKS5tYXBQYW5lLmFwcGVuZENoaWxkKHRoaXMuX3RhcmdldENhbnZhcyk7XHJcblxyXG4gICAgICAgICAgICAvLyBhZGQgYSB2aWV3cmVzZXQgZXZlbnQgbGlzdGVuZXIgZm9yIHVwZGF0aW5nIGxheWVyJ3MgcG9zaXRpb24sIGRvIHRoZSBsYXR0ZXJcclxuICAgICAgICAgICAgbWFwLm9uKCd2aWV3cmVzZXQnLCB0aGlzLl9tb3ZlZCwgdGhpcyk7XHJcbiAgICAgICAgICAgIG1hcC5vbignbW92ZScsIHRoaXMuX21vdmVkLCB0aGlzKTtcclxuXHJcbiAgICAgICAgICAgIGlmIChMLkJyb3dzZXIuYW55M2QpIHtcclxuICAgICAgICAgICAgICAgIG1hcC5vbignem9vbWFuaW0nLCB0aGlzLl9hbmltYXRlWm9vbSwgdGhpcyk7XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIHRoaXMuX21vdmVkKCk7XHJcbiAgICAgICAgfSxcclxuXHJcbiAgICAgICAgb25SZW1vdmU6IGZ1bmN0aW9uIG9uUmVtb3ZlKG1hcCkge1xyXG4gICAgICAgICAgICBpZiAobWFwICE9PSB0aGlzLl9tYXApIHtcclxuICAgICAgICAgICAgICAgIHRocm93ICdSZW1vdmVkIGZyb20gd3JvbmcgbWFwJztcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgbWFwLm9mZigndmlld3Jlc2V0JywgdGhpcy5fbW92ZWQsIHRoaXMpO1xyXG4gICAgICAgICAgICBtYXAub2ZmKCdtb3ZlJywgdGhpcy5fbW92ZWQsIHRoaXMpO1xyXG4gICAgICAgICAgICBtYXAub2ZmKCd6b29tYW5pbScsIHRoaXMuX2FuaW1hdGVab29tLCB0aGlzKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIHJlbW92ZSBsYXllcidzIERPTSBlbGVtZW50cyBhbmQgbGlzdGVuZXJzXHJcbiAgICAgICAgICAgIG1hcC5nZXRQYW5lcygpLm1hcFBhbmUucmVtb3ZlQ2hpbGQodGhpcy5fdGFyZ2V0Q2FudmFzKTtcclxuICAgICAgICAgICAgdGhpcy5fdGFyZ2V0Q2FudmFzID0gbnVsbDtcclxuICAgICAgICAgICAgdGhpcy5fY2FudmFzUG9zaXRpb24gPSBudWxsO1xyXG5cclxuICAgICAgICAgICAgdGhpcy5fbWFwID0gdW5kZWZpbmVkO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgdGhpcy5fdmlld2VySW1hZ2VEZWNvZGVyLmNsb3NlKCk7XHJcbiAgICAgICAgICAgIHRoaXMuX3ZpZXdlckltYWdlRGVjb2RlciA9IG51bGw7XHJcbiAgICAgICAgfSxcclxuICAgICAgICBcclxuICAgICAgICBfbW92ZWQ6IGZ1bmN0aW9uICgpIHtcclxuICAgICAgICAgICAgdGhpcy5fbW92ZUNhbnZhc2VzKCk7XHJcblxyXG4gICAgICAgICAgICB2YXIgZnJ1c3R1bURhdGEgPSBjYWxjdWxhdGVMZWFmbGV0RnJ1c3R1bSh0aGlzLl9tYXApO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgdGhpcy5fdmlld2VySW1hZ2VEZWNvZGVyLnVwZGF0ZVZpZXdBcmVhKGZydXN0dW1EYXRhKTtcclxuICAgICAgICB9LFxyXG4gICAgICAgIFxyXG4gICAgICAgIF9jYW52YXNVcGRhdGVkQ2FsbGJhY2s6IGZ1bmN0aW9uIGNhbnZhc1VwZGF0ZWRDYWxsYmFjayhuZXdQb3NpdGlvbikge1xyXG4gICAgICAgICAgICBpZiAobmV3UG9zaXRpb24gIT09IG51bGwpIHtcclxuICAgICAgICAgICAgICAgIHRoaXMuX2NhbnZhc1Bvc2l0aW9uID0gbmV3UG9zaXRpb247XHJcbiAgICAgICAgICAgICAgICB0aGlzLl9tb3ZlQ2FudmFzZXMoKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH0sXHJcbiAgICAgICAgXHJcbiAgICAgICAgX21vdmVDYW52YXNlczogZnVuY3Rpb24gbW92ZUNhbnZhc2VzKCkge1xyXG4gICAgICAgICAgICBpZiAodGhpcy5fY2FudmFzUG9zaXRpb24gPT09IG51bGwpIHtcclxuICAgICAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgICAgICAvLyB1cGRhdGUgbGF5ZXIncyBwb3NpdGlvblxyXG4gICAgICAgICAgICB2YXIgd2VzdCA9IHRoaXMuX2NhbnZhc1Bvc2l0aW9uLndlc3Q7XHJcbiAgICAgICAgICAgIHZhciBlYXN0ID0gdGhpcy5fY2FudmFzUG9zaXRpb24uZWFzdDtcclxuICAgICAgICAgICAgdmFyIHNvdXRoID0gdGhpcy5fY2FudmFzUG9zaXRpb24uc291dGg7XHJcbiAgICAgICAgICAgIHZhciBub3J0aCA9IHRoaXMuX2NhbnZhc1Bvc2l0aW9uLm5vcnRoO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgdmFyIHRvcExlZnQgPSB0aGlzLl9tYXAubGF0TG5nVG9MYXllclBvaW50KFtub3J0aCwgd2VzdF0pO1xyXG4gICAgICAgICAgICB2YXIgYm90dG9tUmlnaHQgPSB0aGlzLl9tYXAubGF0TG5nVG9MYXllclBvaW50KFtzb3V0aCwgZWFzdF0pO1xyXG4gICAgICAgICAgICB2YXIgc2l6ZSA9IGJvdHRvbVJpZ2h0LnN1YnRyYWN0KHRvcExlZnQpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgTC5Eb21VdGlsLnNldFBvc2l0aW9uKHRoaXMuX3RhcmdldENhbnZhcywgdG9wTGVmdCk7XHJcbiAgICAgICAgICAgIHRoaXMuX3RhcmdldENhbnZhcy5zdHlsZS53aWR0aCA9IHNpemUueCArICdweCc7XHJcbiAgICAgICAgICAgIHRoaXMuX3RhcmdldENhbnZhcy5zdHlsZS5oZWlnaHQgPSBzaXplLnkgKyAncHgnO1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgXHJcbiAgICAgICAgX2FuaW1hdGVab29tOiBmdW5jdGlvbiBhbmltYXRlWm9vbShvcHRpb25zKSB7XHJcbiAgICAgICAgICAgIGlmICh0aGlzLl9jYW52YXNQb3NpdGlvbiA9PT0gbnVsbCkge1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIE5PVEU6IEFsbCBtZXRob2QgKGluY2x1ZGluZyB1c2luZyBvZiBwcml2YXRlIG1ldGhvZFxyXG4gICAgICAgICAgICAvLyBfbGF0TG5nVG9OZXdMYXllclBvaW50KSB3YXMgY29waWVkIGZyb20gSW1hZ2VPdmVybGF5LFxyXG4gICAgICAgICAgICAvLyBhcyBMZWFmbGV0IGRvY3VtZW50YXRpb24gcmVjb21tZW5kcy5cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHZhciB3ZXN0ID0gIHRoaXMuX2NhbnZhc1Bvc2l0aW9uLndlc3Q7XHJcbiAgICAgICAgICAgIHZhciBlYXN0ID0gIHRoaXMuX2NhbnZhc1Bvc2l0aW9uLmVhc3Q7XHJcbiAgICAgICAgICAgIHZhciBzb3V0aCA9IHRoaXMuX2NhbnZhc1Bvc2l0aW9uLnNvdXRoO1xyXG4gICAgICAgICAgICB2YXIgbm9ydGggPSB0aGlzLl9jYW52YXNQb3NpdGlvbi5ub3J0aDtcclxuXHJcbiAgICAgICAgICAgIHZhciB0b3BMZWZ0ID0gdGhpcy5fbWFwLl9sYXRMbmdUb05ld0xheWVyUG9pbnQoXHJcbiAgICAgICAgICAgICAgICBbbm9ydGgsIHdlc3RdLCBvcHRpb25zLnpvb20sIG9wdGlvbnMuY2VudGVyKTtcclxuICAgICAgICAgICAgdmFyIGJvdHRvbVJpZ2h0ID0gdGhpcy5fbWFwLl9sYXRMbmdUb05ld0xheWVyUG9pbnQoXHJcbiAgICAgICAgICAgICAgICBbc291dGgsIGVhc3RdLCBvcHRpb25zLnpvb20sIG9wdGlvbnMuY2VudGVyKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHZhciBzY2FsZSA9IHRoaXMuX21hcC5nZXRab29tU2NhbGUob3B0aW9ucy56b29tKTtcclxuICAgICAgICAgICAgdmFyIHNpemUgPSBib3R0b21SaWdodC5zdWJ0cmFjdCh0b3BMZWZ0KTtcclxuICAgICAgICAgICAgdmFyIHNpemVTY2FsZWQgPSBzaXplLm11bHRpcGx5QnkoKDEgLyAyKSAqICgxIC0gMSAvIHNjYWxlKSk7XHJcbiAgICAgICAgICAgIHZhciBvcmlnaW4gPSB0b3BMZWZ0LmFkZChzaXplU2NhbGVkKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHRoaXMuX3RhcmdldENhbnZhcy5zdHlsZVtMLkRvbVV0aWwuVFJBTlNGT1JNXSA9XHJcbiAgICAgICAgICAgICAgICBMLkRvbVV0aWwuZ2V0VHJhbnNsYXRlU3RyaW5nKG9yaWdpbikgKyAnIHNjYWxlKCcgKyBzY2FsZSArICcpICc7XHJcbiAgICAgICAgfVxyXG4gICAgfTtcclxufSIsIid1c2Ugc3RyaWN0JztcclxuXHJcbnZhciBpbWFnZUhlbHBlckZ1bmN0aW9ucyA9IHJlcXVpcmUoJ2ltYWdlaGVscGVyZnVuY3Rpb25zLmpzJyk7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIGNhbGN1bGF0ZUxlYWZsZXRGcnVzdHVtKGxlYWZsZXRNYXApIHtcclxuICAgIHZhciBzY3JlZW5TaXplID0gbGVhZmxldE1hcC5nZXRTaXplKCk7XHJcbiAgICB2YXIgYm91bmRzID0gbGVhZmxldE1hcC5nZXRCb3VuZHMoKTtcclxuXHJcbiAgICB2YXIgY2FydG9ncmFwaGljQm91bmRzID0ge1xyXG4gICAgICAgIHdlc3Q6IGJvdW5kcy5nZXRXZXN0KCksXHJcbiAgICAgICAgZWFzdDogYm91bmRzLmdldEVhc3QoKSxcclxuICAgICAgICBzb3V0aDogYm91bmRzLmdldFNvdXRoKCksXHJcbiAgICAgICAgbm9ydGg6IGJvdW5kcy5nZXROb3J0aCgpXHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICB2YXIgZnJ1c3R1bURhdGEgPSBpbWFnZUhlbHBlckZ1bmN0aW9ucy5jYWxjdWxhdGVGcnVzdHVtMkRGcm9tQm91bmRzKFxyXG4gICAgICAgIGNhcnRvZ3JhcGhpY0JvdW5kcywgc2NyZWVuU2l6ZSk7XHJcblxyXG4gICAgcmV0dXJuIGZydXN0dW1EYXRhO1xyXG59OyIsIid1c2Ugc3RyaWN0JztcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gR3JpZERlY29kZXJXb3JrZXJCYXNlO1xyXG5cclxuLyogZ2xvYmFsIFByb21pc2UgOiBmYWxzZSAqL1xyXG4vKiBnbG9iYWwgSW1hZ2VEYXRhIDogZmFsc2UgKi9cclxuXHJcbmZ1bmN0aW9uIEdyaWREZWNvZGVyV29ya2VyQmFzZSgpIHtcclxuICAgIEdyaWREZWNvZGVyV29ya2VyQmFzZS5wcm90b3R5cGUuc3RhcnQgPSBmdW5jdGlvbiBkZWNvZGUoZGVjb2RlcklucHV0KSB7XHJcbiAgICAgICAgdmFyIGltYWdlUGFydFBhcmFtcyA9IGRlY29kZXJJbnB1dC5pbWFnZVBhcnRQYXJhbXM7XHJcbiAgICAgICAgdmFyIHdpZHRoICA9IGltYWdlUGFydFBhcmFtcy5tYXhYRXhjbHVzaXZlIC0gaW1hZ2VQYXJ0UGFyYW1zLm1pblg7XHJcbiAgICAgICAgdmFyIGhlaWdodCA9IGltYWdlUGFydFBhcmFtcy5tYXhZRXhjbHVzaXZlIC0gaW1hZ2VQYXJ0UGFyYW1zLm1pblk7XHJcbiAgICAgICAgdmFyIHJlc3VsdCA9IG5ldyBJbWFnZURhdGEod2lkdGgsIGhlaWdodCk7XHJcbiAgICAgICAgdmFyIHByb21pc2VzID0gW107XHJcblx0XHR2YXIgdGlsZVBvc2l0aW9uICA9IHttaW5YOiAwLCBtaW5ZOiAwLCBtYXhYRXhjbHVzaXZlOiAwLCBtYXhZRXhjbHVzaXZlOiAwfTtcclxuXHRcdHZhciByZWdpb25JbkltYWdlID0ge21pblg6IDAsIG1pblk6IDAsIG1heFhFeGNsdXNpdmU6IDAsIG1heFlFeGNsdXNpdmU6IDB9OyBcclxuXHRcdHZhciBvZmZzZXQgPSB7eDogMCwgeTogMH07XHJcblx0XHR2YXIgdGlsZSA9IHt0aWxlWDogMCwgdGlsZVk6IDAsIGxldmVsOiAwLCBwb3NpdGlvbjogdGlsZVBvc2l0aW9uLCBjb250ZW50OiBudWxsfTtcclxuXHRcdGZvciAodmFyIGkgPSAwOyBpIDwgZGVjb2RlcklucHV0LnRpbGVJbmRpY2VzLmxlbmd0aDsgKytpKSB7XHJcblx0XHRcdHRpbGVQb3NpdGlvbi5taW5YICAgICAgICAgID0gZGVjb2RlcklucHV0LnRpbGVJbmRpY2VzW2ldLnRpbGVYICogZGVjb2RlcklucHV0LnRpbGVXaWR0aCA7XHJcblx0XHRcdHRpbGVQb3NpdGlvbi5taW5ZICAgICAgICAgID0gZGVjb2RlcklucHV0LnRpbGVJbmRpY2VzW2ldLnRpbGVZICogZGVjb2RlcklucHV0LnRpbGVIZWlnaHQ7XHJcblx0XHRcdHRpbGVQb3NpdGlvbi5tYXhYRXhjbHVzaXZlID0gdGlsZVBvc2l0aW9uLm1pblggKyBkZWNvZGVySW5wdXQudGlsZVdpZHRoO1xyXG5cdFx0XHR0aWxlUG9zaXRpb24ubWF4WUV4Y2x1c2l2ZSA9IHRpbGVQb3NpdGlvbi5taW5ZICsgZGVjb2RlcklucHV0LnRpbGVIZWlnaHQ7XHJcblx0XHRcdFxyXG5cdFx0XHRyZWdpb25JbkltYWdlLm1pblggICAgICAgICAgPSBNYXRoLm1heCh0aWxlUG9zaXRpb24ubWluWCwgaW1hZ2VQYXJ0UGFyYW1zLm1pblgpO1xyXG5cdFx0XHRyZWdpb25JbkltYWdlLm1pblkgICAgICAgICAgPSBNYXRoLm1heCh0aWxlUG9zaXRpb24ubWluWSwgaW1hZ2VQYXJ0UGFyYW1zLm1pblkpO1xyXG5cdFx0XHRyZWdpb25JbkltYWdlLm1heFhFeGNsdXNpdmUgPSBNYXRoLm1pbih0aWxlUG9zaXRpb24ubWF4WEV4Y2x1c2l2ZSwgaW1hZ2VQYXJ0UGFyYW1zLm1heFhFeGNsdXNpdmUpO1xyXG5cdFx0XHRyZWdpb25JbkltYWdlLm1heFlFeGNsdXNpdmUgPSBNYXRoLm1pbih0aWxlUG9zaXRpb24ubWF4WUV4Y2x1c2l2ZSwgaW1hZ2VQYXJ0UGFyYW1zLm1heFlFeGNsdXNpdmUpO1xyXG5cdFx0XHRcclxuXHRcdFx0b2Zmc2V0LnggPSByZWdpb25JbkltYWdlLm1pblggLSBpbWFnZVBhcnRQYXJhbXMubWluWDtcclxuXHRcdFx0b2Zmc2V0LnkgPSByZWdpb25JbkltYWdlLm1pblkgLSBpbWFnZVBhcnRQYXJhbXMubWluWTtcclxuXHRcdFx0XHJcblx0XHRcdHRpbGUudGlsZVkgPSBkZWNvZGVySW5wdXQudGlsZUluZGljZXNbaV0udGlsZVk7XHJcblx0XHRcdHRpbGUudGlsZVggPSBkZWNvZGVySW5wdXQudGlsZUluZGljZXNbaV0udGlsZVg7XHJcblx0XHRcdHRpbGUubGV2ZWwgPSBkZWNvZGVySW5wdXQudGlsZUluZGljZXNbaV0ubGV2ZWw7XHJcblx0XHRcdHRpbGUuY29udGVudCA9IGRlY29kZXJJbnB1dC50aWxlQ29udGVudHNbaV07XHJcbiAgICAgICAgICAgIHByb21pc2VzLnB1c2godGhpcy5kZWNvZGVSZWdpb24ocmVzdWx0LCBvZmZzZXQsIHJlZ2lvbkluSW1hZ2UsIHRpbGUpKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgcmV0dXJuIFByb21pc2UuYWxsKHByb21pc2VzKS50aGVuKGZ1bmN0aW9uKCkge1xyXG4gICAgICAgICAgICByZXR1cm4gcmVzdWx0O1xyXG4gICAgICAgIH0pO1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgR3JpZERlY29kZXJXb3JrZXJCYXNlLnByb3RvdHlwZS5kZWNvZGVSZWdpb24gPSBmdW5jdGlvbiBkZWNvZGVSZWdpb24odGFyZ2V0SW1hZ2VEYXRhLCBpbWFnZVBhcnRQYXJhbXMsIGtleSwgZmV0Y2hlZERhdGEpIHtcclxuICAgICAgICB0aHJvdyAnU2ltcGxlUGl4ZWxzRGVjb2RlckJhc2UgZXJyb3I6IGRlY29kZVJlZ2lvbiBpcyBub3QgaW1wbGVtZW50ZWQnO1xyXG4gICAgfTtcclxufSIsIid1c2Ugc3RyaWN0JztcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gR3JpZEZldGNoZXJCYXNlO1xyXG5cclxudmFyIEdyaWRJbWFnZUJhc2UgPSByZXF1aXJlKCdncmlkaW1hZ2ViYXNlJyk7XHJcblxyXG4vKiBnbG9iYWwgY29uc29sZTogZmFsc2UgKi9cclxuLyogZ2xvYmFsIFByb21pc2U6IGZhbHNlICovXHJcblxyXG5mdW5jdGlvbiBHcmlkRmV0Y2hlckJhc2UoKSB7XHJcblx0dGhpcy5fZ3JpZEZldGNoZXJCYXNlQ2FjaGUgPSBbXTtcclxufVxyXG5cclxuR3JpZEZldGNoZXJCYXNlLnByb3RvdHlwZS5vcGVuID0gZnVuY3Rpb24odXJsKSB7XHJcblx0dGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogR3JpZEZldGNoZXJCYXNlLm9wZW4gaXMgbm90IGltcGxlbWVudGVkIGJ5IGluaGVyaXRvcic7XHJcbn07XHJcblxyXG5HcmlkRmV0Y2hlckJhc2UucHJvdG90eXBlLmZldGNoVGlsZSA9IGZ1bmN0aW9uKHVybCkge1xyXG5cdHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IEdyaWRGZXRjaGVyQmFzZS5mZXRjaFRpbGUgaXMgbm90IGltcGxlbWVudGVkIGJ5IGluaGVyaXRvcic7XHJcbn07XHJcblxyXG5HcmlkRmV0Y2hlckJhc2UucHJvdG90eXBlLmZldGNoID0gZnVuY3Rpb24gZmV0Y2goaW1hZ2VQYXJ0UGFyYW1zKSB7XHJcblx0dmFyIHRpbGVzUmFuZ2UgPSBHcmlkSW1hZ2VCYXNlLmdldFRpbGVzUmFuZ2UodGhpcy5faW1hZ2VQYXJhbXMsIGltYWdlUGFydFBhcmFtcyk7XHJcblx0XHJcblx0dmFyIHByb21pc2VzID0gW107XHJcblx0Zm9yICh2YXIgdGlsZVggPSB0aWxlc1JhbmdlLm1pblRpbGVYOyB0aWxlWCA8IHRpbGVzUmFuZ2UubWF4VGlsZVg7ICsrdGlsZVgpIHtcclxuXHRcdGZvciAodmFyIHRpbGVZID0gdGlsZXNSYW5nZS5taW5UaWxlWTsgdGlsZVkgPCB0aWxlc1JhbmdlLm1heFRpbGVZOyArK3RpbGVZKSB7XHJcblx0XHRcdHZhciBwcm9taXNlID0gdGhpcy5fbG9hZFRpbGUoaW1hZ2VQYXJ0UGFyYW1zLmxldmVsLCB0aWxlWCwgdGlsZVkpO1xyXG5cdFx0XHRwcm9taXNlcy5wdXNoKHByb21pc2UpO1xyXG5cdFx0fVxyXG5cdH1cclxuXHRcclxuXHRyZXR1cm4gUHJvbWlzZS5hbGwocHJvbWlzZXMpO1xyXG59O1xyXG5cclxuR3JpZEZldGNoZXJCYXNlLnByb3RvdHlwZS5fbG9hZFRpbGUgPSBmdW5jdGlvbiBsb2FkVGlsZShsZXZlbCwgdGlsZVgsIHRpbGVZKSB7XHJcblx0dmFyIGxldmVsQ2FjaGUgPSB0aGlzLl9ncmlkRmV0Y2hlckJhc2VDYWNoZVtsZXZlbF07XHJcblx0aWYgKCFsZXZlbENhY2hlKSB7XHJcblx0XHRsZXZlbENhY2hlID0gW107XHJcblx0XHR0aGlzLl9ncmlkRmV0Y2hlckJhc2VDYWNoZVtsZXZlbF0gPSBsZXZlbENhY2hlO1xyXG5cdH1cclxuXHRcclxuXHR2YXIgeENhY2hlID0gbGV2ZWxDYWNoZVt0aWxlWF07XHJcblx0aWYgKCF4Q2FjaGUpIHtcclxuXHRcdHhDYWNoZSA9IFtdO1xyXG5cdFx0bGV2ZWxDYWNoZVt0aWxlWF0gPSB4Q2FjaGU7XHJcblx0fVxyXG5cdFxyXG5cdHZhciBwcm9taXNlID0geENhY2hlW3RpbGVZXTtcclxuXHRpZiAoIXByb21pc2UpIHtcclxuXHRcdHByb21pc2UgPSB0aGlzLmZldGNoVGlsZShsZXZlbCwgdGlsZVgsIHRpbGVZKS50aGVuKGZ1bmN0aW9uKHJlc3VsdCkge1xyXG5cdFx0XHR4Q2FjaGVbdGlsZVldID0gbnVsbDtcclxuXHRcdFx0cmV0dXJuIHJlc3VsdDtcclxuXHRcdH0pO1xyXG5cdFx0eENhY2hlW3RpbGVZXSA9IHByb21pc2U7XHJcblx0fVxyXG5cdFxyXG5cdHJldHVybiBwcm9taXNlLnRoZW4oZnVuY3Rpb24ocmVzdWx0KSB7XHJcblx0XHRyZXR1cm4ge1xyXG5cdFx0XHR0aWxlS2V5OiB7XHJcblx0XHRcdFx0ZmV0Y2hXYWl0VGFzazogdHJ1ZSxcclxuXHRcdFx0XHR0aWxlWDogdGlsZVgsXHJcblx0XHRcdFx0dGlsZVk6IHRpbGVZLFxyXG5cdFx0XHRcdGxldmVsOiBsZXZlbFxyXG5cdFx0XHR9LFxyXG5cdFx0XHRjb250ZW50OiByZXN1bHRcclxuXHRcdH07XHJcblx0fSk7XHJcbn07XHJcbiIsIid1c2Ugc3RyaWN0JztcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gR3JpZEltYWdlQmFzZTtcclxuXHJcbi8qIGdsb2JhbCBjb25zb2xlOiBmYWxzZSAqL1xyXG4vKiBnbG9iYWwgUHJvbWlzZTogZmFsc2UgKi9cclxuXHJcbnZhciBGRVRDSF9XQUlUX1RBU0sgPSAwO1xyXG52YXIgREVDT0RFX1RBU0sgPSAxO1xyXG5cclxuZnVuY3Rpb24gR3JpZEltYWdlQmFzZShmZXRjaE1hbmFnZXIpIHtcclxuXHR0aGlzLl9mZXRjaE1hbmFnZXIgPSBmZXRjaE1hbmFnZXI7XHJcblx0dGhpcy5fZGVjb2RlcldvcmtlcnMgPSBudWxsO1xyXG5cdHRoaXMuX2ltYWdlUGFyYW1zID0gbnVsbDtcclxuXHR0aGlzLl93YWl0aW5nRmV0Y2hlcyA9IHt9O1xyXG59XHJcblxyXG5HcmlkSW1hZ2VCYXNlLnByb3RvdHlwZS5nZXREZWNvZGVUYXNrVHlwZU9wdGlvbnMgPSBmdW5jdGlvbiBnZXREZWNvZGVUYXNrVHlwZU9wdGlvbnMoKSB7XHJcblx0dGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogR3JpZEltYWdlQmFzZS5nZXREZWNvZGVUYXNrVHlwZU9wdGlvbnMgaXMgbm90IGltcGxlbWVudGVkIGJ5IGluaGVyaXRvcic7XHJcbn07XHJcblxyXG5HcmlkSW1hZ2VCYXNlLnByb3RvdHlwZS5nZXRGZXRjaE1hbmFnZXIgPSBmdW5jdGlvbiBnZXRGZXRjaE1hbmFnZXIoKSB7XHJcblx0cmV0dXJuIHRoaXMuX2ZldGNoTWFuYWdlcjtcclxufTtcclxuXHJcbkdyaWRJbWFnZUJhc2UucHJvdG90eXBlLmdldERlY29kZXJXb3JrZXJzID0gZnVuY3Rpb24gZ2V0RGVjb2RlcldvcmtlcnMoKSB7XHJcblx0aWYgKHRoaXMuX2RlY29kZXJXb3JrZXJzID09PSBudWxsKSB7XHJcblx0XHR0aGlzLl9pbWFnZVBhcmFtcyA9IHRoaXMuX2ZldGNoTWFuYWdlci5nZXRJbWFnZVBhcmFtcygpOyAvLyBpbWFnZVBhcmFtcyB0aGF0IHJldHVybmVkIGJ5IGZldGNoZXIub3BlbigpXHJcblx0XHR0aGlzLl9kZWNvZGVyV29ya2VycyA9IG5ldyBBc3luY1Byb3h5LlByb21pc2VEZXBlbmRlbmN5V29ya2Vycyh0aGlzKTtcclxuXHRcdHRoaXMuX2ZldGNoTWFuYWdlci5vbignZGF0YScsIHRoaXMuX29uRGF0YUZldGNoZWQuYmluZCh0aGlzKSk7XHJcblx0fVxyXG5cdHJldHVybiB0aGlzLl9kZWNvZGVyV29ya2VycztcclxufTtcclxuXHJcbi8vIGxldmVsIGNhbGN1bGF0aW9uc1xyXG5cclxuR3JpZEltYWdlQmFzZS5wcm90b3R5cGUuZ2V0TGV2ZWxXaWR0aCA9IGZ1bmN0aW9uIGdldExldmVsV2lkdGgobGV2ZWwpIHtcclxuXHR2YXIgaW1hZ2VQYXJhbXMgPSB0aGlzLl9mZXRjaE1hbmFnZXIuZ2V0SW1hZ2VQYXJhbXMoKTtcclxuXHRyZXR1cm4gaW1hZ2VQYXJhbXMudGlsZVdpZHRoICAqIGltYWdlUGFyYW1zLmxvd2VzdExldmVsVGlsZXNYICogTWF0aC5wb3coMiwgbGV2ZWwpO1xyXG59O1xyXG5cclxuR3JpZEltYWdlQmFzZS5wcm90b3R5cGUuZ2V0TGV2ZWxIZWlnaHQgPSBmdW5jdGlvbiBnZXRMZXZlbEhlaWdodChsZXZlbCkge1xyXG5cdHZhciBpbWFnZVBhcmFtcyA9IHRoaXMuX2ZldGNoTWFuYWdlci5nZXRJbWFnZVBhcmFtcygpO1xyXG5cdHJldHVybiBpbWFnZVBhcmFtcy50aWxlSGVpZ2h0ICogaW1hZ2VQYXJhbXMubG93ZXN0TGV2ZWxUaWxlc1kgKiBNYXRoLnBvdygyLCBsZXZlbCk7XHJcbn07XHJcblxyXG5HcmlkSW1hZ2VCYXNlLnByb3RvdHlwZS5nZXRMZXZlbCA9IGZ1bmN0aW9uIGdldERlZmF1bHROdW1SZXNvbHV0aW9uTGV2ZWxzKHJlZ2lvbkltYWdlTGV2ZWwpIHtcclxuXHR2YXIgaW1hZ2VQYXJhbXMgPSB0aGlzLl9mZXRjaE1hbmFnZXIuZ2V0SW1hZ2VQYXJhbXMoKTtcclxuXHR2YXIgaW1hZ2VMZXZlbCA9IGltYWdlUGFyYW1zLmxldmVscyAtIDE7XHJcblx0XHJcblx0dmFyIGxvZzIgPSBNYXRoLmxvZygyKTtcclxuXHR2YXIgbGV2ZWxYID0gTWF0aC5sb2cocmVnaW9uSW1hZ2VMZXZlbC5zY3JlZW5XaWR0aCAgLyAocmVnaW9uSW1hZ2VMZXZlbC5tYXhYRXhjbHVzaXZlIC0gcmVnaW9uSW1hZ2VMZXZlbC5taW5YKSkgLyBsb2cyO1xyXG5cdHZhciBsZXZlbFkgPSBNYXRoLmxvZyhyZWdpb25JbWFnZUxldmVsLnNjcmVlbkhlaWdodCAvIChyZWdpb25JbWFnZUxldmVsLm1heFlFeGNsdXNpdmUgLSByZWdpb25JbWFnZUxldmVsLm1pblkpKSAvIGxvZzI7XHJcblx0dmFyIGxldmVsID0gTWF0aC5jZWlsKE1hdGgubWluKGxldmVsWCwgbGV2ZWxZKSk7XHJcblx0bGV2ZWwgPSBNYXRoLm1heCgwLCBNYXRoLm1pbigwLCBsZXZlbCkgKyBpbWFnZUxldmVsKTtcclxuXHRcclxuXHRyZXR1cm4gbGV2ZWw7XHJcbn07XHJcblxyXG4vLyBQcm9taXNlRGVwZW5kZW5jeVdvcmtlcnNJbnB1dFJldHJlaXZlciBpbXBsZW1lbnRhdGlvblxyXG5cclxuR3JpZEltYWdlQmFzZS5wcm90b3R5cGUuZ2V0UHJvbWlzZVRhc2tQcm9wZXJ0aWVzID0gZnVuY3Rpb24odGFza0tleSkge1xyXG5cdGlmICh0YXNrS2V5LmZldGNoV2FpdFRhc2spIHtcclxuXHRcdHJldHVybiB7XHJcblx0XHRcdHRhc2tUeXBlOiBGRVRDSF9XQUlUX1RBU0ssXHJcblx0XHRcdGRlcGVuZHNPblRhc2tzOiBbXSxcclxuXHRcdFx0aXNEaXNhYmxlV29ya2VyOiB0cnVlXHJcblx0XHR9O1xyXG5cdH1cclxuXHRcclxuXHR2YXIgaW1hZ2VQYXJ0UGFyYW1zID0gdGFza0tleTtcclxuXHR2YXIgdGlsZXNSYW5nZSA9IEdyaWRJbWFnZUJhc2UuZ2V0VGlsZXNSYW5nZSh0aGlzLl9pbWFnZVBhcmFtcywgaW1hZ2VQYXJ0UGFyYW1zKTtcclxuXHRcclxuXHR2YXIgZGVwZW5kcyA9IG5ldyBBcnJheSgodGlsZXNSYW5nZS5tYXhUaWxlWCAtIHRpbGVzUmFuZ2UubWluVGlsZVgpICogKHRpbGVzUmFuZ2UubWF4VGlsZVkgLSB0aWxlc1JhbmdlLm1pblRpbGVZKSk7XHJcblx0dmFyIGkgPSAwO1xyXG5cdGZvciAodmFyIHRpbGVYID0gdGlsZXNSYW5nZS5taW5UaWxlWDsgdGlsZVggPCB0aWxlc1JhbmdlLm1heFRpbGVYOyArK3RpbGVYKSB7XHJcblx0XHRmb3IgKHZhciB0aWxlWSA9IHRpbGVzUmFuZ2UubWluVGlsZVk7IHRpbGVZIDwgdGlsZXNSYW5nZS5tYXhUaWxlWTsgKyt0aWxlWSkge1xyXG5cdFx0XHRkZXBlbmRzW2krK10gPSB7XHJcblx0XHRcdFx0ZmV0Y2hXYWl0VGFzazogdHJ1ZSxcclxuXHRcdFx0XHR0aWxlWDogdGlsZVgsXHJcblx0XHRcdFx0dGlsZVk6IHRpbGVZLFxyXG5cdFx0XHRcdGxldmVsOiBpbWFnZVBhcnRQYXJhbXMubGV2ZWxcclxuXHRcdFx0fTtcclxuXHRcdH1cclxuXHR9XHJcblx0XHJcblx0cmV0dXJuIHtcclxuXHRcdHRhc2tUeXBlOiBERUNPREVfVEFTSyxcclxuXHRcdGRlcGVuZHNPblRhc2tzOiBkZXBlbmRzLFxyXG5cdFx0aXNEaXNhYmxlV29ya2VyOiBmYWxzZVxyXG5cdH07XHJcbn07XHJcblxyXG5HcmlkSW1hZ2VCYXNlLnByb3RvdHlwZS5wcmVXb3JrZXJQcm9jZXNzID0gZnVuY3Rpb24oZGVwZW5kc1Rhc2tSZXN1bHRzLCBkZXBlbmRzVGFza0tleXMsIHRhc2tLZXkpIHtcclxuXHRpZiAodGFza0tleS5mZXRjaFdhaXRUYXNrKSB7XHJcblx0XHR2YXIgc2VsZiA9IHRoaXM7XHJcblx0XHRyZXR1cm4gbmV3IFByb21pc2UoZnVuY3Rpb24ocmVzb2x2ZSwgcmVqZWN0KSB7XHJcblx0XHRcdHZhciBzdHJLZXkgPSBzZWxmLmdldEtleUFzU3RyaW5nKHRhc2tLZXkpO1xyXG5cdFx0XHRzZWxmLl93YWl0aW5nRmV0Y2hlc1tzdHJLZXldID0gcmVzb2x2ZTtcclxuXHRcdH0pO1xyXG5cdH1cclxuXHRyZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHtcclxuXHRcdHRpbGVDb250ZW50czogZGVwZW5kc1Rhc2tSZXN1bHRzLFxyXG5cdFx0dGlsZUluZGljZXM6IGRlcGVuZHNUYXNrS2V5cyxcclxuXHRcdGltYWdlUGFydFBhcmFtczogdGFza0tleSxcclxuXHRcdHRpbGVXaWR0aDogdGhpcy5faW1hZ2VQYXJhbXMudGlsZVdpZHRoLFxyXG5cdFx0dGlsZUhlaWdodDogdGhpcy5faW1hZ2VQYXJhbXMudGlsZUhlaWdodFxyXG5cdH0pO1xyXG59O1xyXG5cclxuR3JpZEltYWdlQmFzZS5wcm90b3R5cGUuZ2V0VGFza1R5cGVPcHRpb25zID0gZnVuY3Rpb24odGFza1R5cGUpIHtcclxuXHRpZiAodGFza1R5cGUgPT09IEZFVENIX1dBSVRfVEFTSykge1xyXG5cdFx0cmV0dXJuIHt9O1xyXG5cdH0gZWxzZSBpZiAodGFza1R5cGUgPT09IERFQ09ERV9UQVNLKSB7XHJcblx0XHRyZXR1cm4gdGhpcy5nZXREZWNvZGVUYXNrVHlwZU9wdGlvbnMoKTtcclxuXHR9IGVsc2Uge1xyXG5cdFx0dGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBpbnRlcm5hbCBlcnJvcjogR3JpZEltYWdlQmFzZS5nZXRUYXNrVHlwZU9wdGlvbnMgZ290IHVuZXhwZWN0ZWQgdGFzayB0eXBlICcgKyB0YXNrVHlwZTtcclxuXHR9XHJcbn07XHJcblxyXG5HcmlkSW1hZ2VCYXNlLnByb3RvdHlwZS5nZXRLZXlBc1N0cmluZyA9IGZ1bmN0aW9uKGtleSkge1xyXG5cdGlmIChrZXkuZmV0Y2hXYWl0VGFzaykge1xyXG5cdFx0cmV0dXJuICdmZXRjaFdhaXQ6JyArIGtleS50aWxlWCArICcsJyArIGtleS50aWxlWSArICc6JyArIGtleS5sZXZlbDtcclxuXHR9XHJcblx0Ly8gT3RoZXJ3aXNlIGl0J3MgYSBpbWFnZVBhcnRQYXJhbXMga2V5IHBhc3NlZCBieSBpbWFnZURlY29kZXJGcmFtZXdvcmsgbGliLiBKdXN0IGNyZWF0ZSBhIHVuaXF1ZSBzdHJpbmdcclxuXHRyZXR1cm4gSlNPTi5zdHJpbmdpZnkoa2V5KTtcclxufTtcclxuXHJcbi8vIEF1eGlsaWFyeSBtZXRob2RzXHJcblxyXG5HcmlkSW1hZ2VCYXNlLnByb3RvdHlwZS5fb25EYXRhRmV0Y2hlZCA9IGZ1bmN0aW9uKGZldGNoZWRUaWxlcywgaW1hZ2VQYXJ0UGFyYW1zKSB7XHJcblx0Zm9yICh2YXIgaSA9IDA7IGkgPCBmZXRjaGVkVGlsZXMubGVuZ3RoOyArK2kpIHtcclxuXHRcdHZhciBzdHJLZXkgPSB0aGlzLmdldEtleUFzU3RyaW5nKGZldGNoZWRUaWxlc1tpXS50aWxlS2V5KTtcclxuXHRcdHZhciB3YWl0aW5nUHJvbWlzZSA9IHRoaXMuX3dhaXRpbmdGZXRjaGVzW3N0cktleV07XHJcblx0XHRpZiAod2FpdGluZ1Byb21pc2UpIHtcclxuXHRcdFx0ZGVsZXRlIHRoaXMuX3dhaXRpbmdGZXRjaGVzW3N0cktleV07XHJcblx0XHRcdHdhaXRpbmdQcm9taXNlKGZldGNoZWRUaWxlc1tpXS5jb250ZW50KTtcclxuXHRcdH1cclxuXHR9XHJcbn07XHJcblxyXG5HcmlkSW1hZ2VCYXNlLmdldFRpbGVzUmFuZ2UgPSBmdW5jdGlvbihpbWFnZVBhcmFtcywgaW1hZ2VQYXJ0UGFyYW1zKSB7XHJcblx0dmFyIGxldmVsVGlsZXNYID0gaW1hZ2VQYXJhbXMubG93ZXN0TGV2ZWxUaWxlc1ggPDwgaW1hZ2VQYXJ0UGFyYW1zLmxldmVsO1xyXG5cdHZhciBsZXZlbFRpbGVzWSA9IGltYWdlUGFyYW1zLmxvd2VzdExldmVsVGlsZXNZIDw8IGltYWdlUGFydFBhcmFtcy5sZXZlbDtcclxuXHRyZXR1cm4ge1xyXG5cdFx0bWluVGlsZVg6IE1hdGgubWF4KDAsIE1hdGguZmxvb3IoaW1hZ2VQYXJ0UGFyYW1zLm1pblggLyBpbWFnZVBhcmFtcy50aWxlV2lkdGggKSksXHJcblx0XHRtaW5UaWxlWTogTWF0aC5tYXgoMCwgTWF0aC5mbG9vcihpbWFnZVBhcnRQYXJhbXMubWluWSAvIGltYWdlUGFyYW1zLnRpbGVIZWlnaHQpKSxcclxuXHRcdG1heFRpbGVYOiBNYXRoLm1pbihsZXZlbFRpbGVzWCwgTWF0aC5jZWlsKGltYWdlUGFydFBhcmFtcy5tYXhYRXhjbHVzaXZlIC8gaW1hZ2VQYXJhbXMudGlsZVdpZHRoICkpLFxyXG5cdFx0bWF4VGlsZVk6IE1hdGgubWluKGxldmVsVGlsZXNZLCBNYXRoLmNlaWwoaW1hZ2VQYXJ0UGFyYW1zLm1heFlFeGNsdXNpdmUgLyBpbWFnZVBhcmFtcy50aWxlSGVpZ2h0KSlcclxuXHR9O1xyXG59O1xyXG4iLCIndXNlIHN0cmljdCc7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IFByb21pc2VGZXRjaGVyQWRhcHRlcjtcclxuXHJcbnZhciBQcm9taXNlRmV0Y2hBZGFwdGVyRmV0Y2hIYW5kbGUgPSByZXF1aXJlKCdwcm9taXNlZmV0Y2hlcmFkYXB0ZXJmZXRjaGhhbmRsZS5qcycpO1xyXG5cclxuLyogZ2xvYmFsIFByb21pc2U6IGZhbHNlICovXHJcblxyXG5mdW5jdGlvbiBQcm9taXNlRmV0Y2hlckFkYXB0ZXIocHJvbWlzZUZldGNoZXIsIG9wdGlvbnMpIHtcclxuICAgIHRoaXMuX3VybCA9IG51bGw7XHJcbiAgICB0aGlzLl9vcHRpb25zID0gb3B0aW9ucyB8fCB7fTtcclxuICAgIHRoaXMuX3Byb21pc2VGZXRjaGVyID0gcHJvbWlzZUZldGNoZXI7XHJcbiAgICB0aGlzLl9kYXRhTGlzdGVuZXJzID0gW107XHJcbiAgICB0aGlzLl9pc1JlYWR5ID0gZmFsc2U7XHJcbiAgICB0aGlzLl9hY3RpdmVGZXRjaGVzID0gMDtcclxuICAgIHRoaXMuX3Jlc29sdmVDbG9zZSA9IG51bGw7XHJcbiAgICB0aGlzLl9yZWplY3RDbG9zZSA9IG51bGw7XHJcbn1cclxuXHJcbi8vIEZldGNoZXIgaW1wbGVtZW50YXRpb25cclxuXHJcblByb21pc2VGZXRjaGVyQWRhcHRlci5wcm90b3R5cGUub3BlbiA9IGZ1bmN0aW9uIG9wZW4odXJsKSB7XHJcbiAgICB2YXIgc2VsZiA9IHRoaXM7XHJcbiAgICByZXR1cm4gdGhpcy5fcHJvbWlzZUZldGNoZXIub3Blbih1cmwpLnRoZW4oZnVuY3Rpb24ocmVzdWx0KSB7XHJcbiAgICAgICAgc2VsZi5faXNSZWFkeSA9IHRydWU7XHJcbiAgICAgICAgcmV0dXJuIHJlc3VsdDtcclxuICAgIH0pO1xyXG59O1xyXG5cclxuUHJvbWlzZUZldGNoZXJBZGFwdGVyLnByb3RvdHlwZS5jbG9zZSA9IGZ1bmN0aW9uIGNsb3NlKGNsb3NlZENhbGxiYWNrKSB7XHJcbiAgICB0aGlzLl9lbnN1cmVSZWFkeSgpO1xyXG4gICAgdGhpcy5faXNSZWFkeSA9IGZhbHNlO1xyXG4gICAgdmFyIHNlbGYgPSB0aGlzO1xyXG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKGZ1bmN0aW9uKHJlc29sdmUsIHJlamVjdCkge1xyXG4gICAgICAgIHNlbGYuX3Jlc29sdmVDbG9zZSA9IHJlc29sdmU7XHJcbiAgICAgICAgc2VsZi5fcmVqZWN0Q2xvc2UgPSByZWplY3Q7XHJcbiAgICAgICAgc2VsZi5fY2hlY2tJZkNsb3NlZCgpO1xyXG4gICAgfSk7XHJcbn07XHJcblxyXG5Qcm9taXNlRmV0Y2hlckFkYXB0ZXIucHJvdG90eXBlLnJlY29ubmVjdCA9IGZ1bmN0aW9uIHJlY29ubmVjdCgpIHtcclxuICAgIHRoaXMuX2Vuc3VyZVJlYWR5KCk7XHJcbn07XHJcblxyXG5Qcm9taXNlRmV0Y2hlckFkYXB0ZXIucHJvdG90eXBlLm9uID0gZnVuY3Rpb24gb24oZXZlbnQsIGxpc3RlbmVyKSB7XHJcbiAgICBpZiAoZXZlbnQgIT09ICdkYXRhJykge1xyXG4gICAgICAgIHRocm93ICdQcm9taXNlRmV0Y2hlckFkYXB0ZXI6IFVuZXhwZWN0ZWQgZXZlbnQgJyArIGV2ZW50ICsgJy4gRXhwZWN0ZWQgXCJkYXRhXCInO1xyXG4gICAgfVxyXG4gICAgdGhpcy5fZGF0YUxpc3RlbmVycy5wdXNoKGxpc3RlbmVyKTtcclxufTtcclxuXHJcblByb21pc2VGZXRjaGVyQWRhcHRlci5wcm90b3R5cGUuZmV0Y2ggPSBmdW5jdGlvbiBmZXRjaChpbWFnZVBhcnRQYXJhbXMpIHtcclxuICAgIHRoaXMuX2Vuc3VyZVJlYWR5KCk7XHJcbiAgICArK3RoaXMuX2FjdGl2ZUZldGNoZXM7XHJcblx0dmFyIGZldGNoSGFuZGxlID0gbmV3IFByb21pc2VGZXRjaEFkYXB0ZXJGZXRjaEhhbmRsZShpbWFnZVBhcnRQYXJhbXMpO1xyXG5cclxuICAgIHZhciBzZWxmID0gdGhpcztcclxuICAgIHRoaXMuX3Byb21pc2VGZXRjaGVyLmZldGNoKGltYWdlUGFydFBhcmFtcylcclxuICAgICAgICAudGhlbihmdW5jdGlvbihyZXN1bHQpIHtcclxuICAgICAgICAgICAgc2VsZi5fYWZ0ZXJGZXRjaChmZXRjaEhhbmRsZSwgcmVzdWx0KTtcclxuICAgICAgICB9KS5jYXRjaChmdW5jdGlvbihyZWFzb24pIHtcclxuICAgICAgICAgICAgc2VsZi5fYWZ0ZXJGYWlsZWRGZXRjaChyZWFzb24pO1xyXG4gICAgICAgIH0pO1xyXG5cdFxyXG5cdHJldHVybiBmZXRjaEhhbmRsZTtcclxufTtcclxuXHJcblByb21pc2VGZXRjaGVyQWRhcHRlci5wcm90b3R5cGUuc3RhcnRNb3ZhYmxlRmV0Y2ggPSBmdW5jdGlvbiBzdGFydE1vdmFibGVGZXRjaChpbWFnZVBhcnRQYXJhbXMsIG1vdmFibGVGZXRjaFN0YXRlKSB7XHJcbiAgICB0aGlzLl9lbnN1cmVSZWFkeSgpO1xyXG5cdFxyXG5cdHZhciBmZXRjaEhhbmRsZSA9IG5ldyBQcm9taXNlRmV0Y2hBZGFwdGVyRmV0Y2hIYW5kbGUoaW1hZ2VQYXJ0UGFyYW1zKTtcclxuICAgIFxyXG4gICAgdmFyIHNlbGYgPSB0aGlzO1xyXG4gICAgbW92YWJsZUZldGNoU3RhdGUuX2N1cnJlbnRGZXRjaEhhbmRsZSA9IG51bGw7XHJcbiAgICBtb3ZhYmxlRmV0Y2hTdGF0ZS5fcGVuZGluZ0ZldGNoSGFuZGxlID0gZmV0Y2hIYW5kbGU7XHJcbiAgICBtb3ZhYmxlRmV0Y2hTdGF0ZS5fc3RhcnROZXh0RmV0Y2ggPSAgc3RhcnROZXh0RmV0Y2g7XHJcbiAgICBcclxuICAgIGZ1bmN0aW9uIHN0YXJ0TmV4dEZldGNoKHByZXZGZXRjaFJlc3VsdCkge1xyXG4gICAgICAgIGlmIChtb3ZhYmxlRmV0Y2hTdGF0ZS5fY3VycmVudEZldGNoSGFuZGxlICE9PSBudWxsKSB7XHJcbiAgICAgICAgICAgIHZhciBlbmRlZEZldGNoSGFuZGxlID0gbW92YWJsZUZldGNoU3RhdGUuX2N1cnJlbnRGZXRjaEhhbmRsZTtcclxuICAgICAgICAgICAgbW92YWJsZUZldGNoU3RhdGUuX2N1cnJlbnRGZXRjaEhhbmRsZSA9IG51bGw7XHJcbiAgICAgICAgICAgIHNlbGYuX2FmdGVyRmV0Y2goZW5kZWRGZXRjaEhhbmRsZSwgcHJldkZldGNoUmVzdWx0KTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKG1vdmFibGVGZXRjaFN0YXRlLl9wZW5kaW5nRmV0Y2hIYW5kbGUgIT09IG51bGwgJiYgc2VsZi5faXNSZWFkeSkge1xyXG4gICAgICAgICAgICArK3NlbGYuX2FjdGl2ZUZldGNoZXM7XHJcbiAgICAgICAgICAgIG1vdmFibGVGZXRjaFN0YXRlLl9jdXJyZW50RmV0Y2hIYW5kbGUgPSBtb3ZhYmxlRmV0Y2hTdGF0ZS5fcGVuZGluZ0ZldGNoSGFuZGxlO1xyXG5cdFx0XHRtb3ZhYmxlRmV0Y2hTdGF0ZS5fcGVuZGluZ0ZldGNoSGFuZGxlID0gbnVsbDtcclxuICAgICAgICAgICAgc2VsZi5fcHJvbWlzZUZldGNoZXIuZmV0Y2goaW1hZ2VQYXJ0UGFyYW1zKVxyXG4gICAgICAgICAgICAgICAgLnRoZW4oc3RhcnROZXh0RmV0Y2gpXHJcbiAgICAgICAgICAgICAgICAuY2F0Y2goc3RhcnROZXh0RmV0Y2gpO1xyXG4gICAgICAgIH1cclxuICAgICAgICByZXR1cm4gcHJldkZldGNoUmVzdWx0O1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBzdGFydE5leHRGZXRjaCgpO1xyXG4gICAgXHJcbiAgICByZXR1cm4gZmV0Y2hIYW5kbGU7XHJcbn07XHJcblxyXG5Qcm9taXNlRmV0Y2hlckFkYXB0ZXIucHJvdG90eXBlLm1vdmVGZXRjaCA9IGZ1bmN0aW9uIG1vdmVGZXRjaChpbWFnZVBhcnRQYXJhbXMsIG1vdmFibGVGZXRjaFN0YXRlKSB7XHJcbiAgICB0aGlzLl9lbnN1cmVSZWFkeSgpO1xyXG5cdFxyXG5cdHZhciBmZXRjaEhhbmRsZSA9IG5ldyBQcm9taXNlRmV0Y2hBZGFwdGVyRmV0Y2hIYW5kbGUoaW1hZ2VQYXJ0UGFyYW1zKTtcclxuXHRcclxuXHRpZiAobW92YWJsZUZldGNoU3RhdGUuX3BlbmRpbmdGZXRjaEhhbmRsZSAhPT0gbnVsbCkge1xyXG5cdFx0bW92YWJsZUZldGNoU3RhdGUuX3BlbmRpbmdGZXRjaEhhbmRsZS50ZXJtaW5hdGUoLyppc0Fib3J0ZWQ9Ki90cnVlKTtcclxuXHR9XHJcbiAgICBtb3ZhYmxlRmV0Y2hTdGF0ZS5fcGVuZGluZ0ZldGNoSGFuZGxlID0gZmV0Y2hIYW5kbGU7XHJcbiAgICBpZiAobW92YWJsZUZldGNoU3RhdGUuX2N1cnJlbnRGZXRjaEhhbmRsZSA9PT0gbnVsbCkge1xyXG4gICAgICAgIG1vdmFibGVGZXRjaFN0YXRlLl9zdGFydE5leHRGZXRjaCgpO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICByZXR1cm4gZmV0Y2hIYW5kbGU7XHJcbn07XHJcblxyXG5Qcm9taXNlRmV0Y2hlckFkYXB0ZXIucHJvdG90eXBlLl9lbnN1cmVSZWFkeSA9IGZ1bmN0aW9uIGVuc3VyZVJlYWR5KCkge1xyXG4gICAgaWYgKCF0aGlzLl9pc1JlYWR5KSB7XHJcbiAgICAgICAgdGhyb3cgJ1Byb21pc2VGZXRjaGVyQWRhcHRlciBlcnJvcjogZmV0Y2ggY2xpZW50IGlzIG5vdCBvcGVuZWQnO1xyXG4gICAgfVxyXG59O1xyXG5cclxuUHJvbWlzZUZldGNoZXJBZGFwdGVyLnByb3RvdHlwZS5fY2hlY2tJZkNsb3NlZCA9IGZ1bmN0aW9uIGNoZWNrSWZDbG9zZWQoKSB7XHJcbiAgICBpZiAodGhpcy5fYWN0aXZlRmV0Y2hlcyA9PT0gMCAmJiAhdGhpcy5faXNSZWFkeSkge1xyXG4gICAgICAgIHRoaXMuX3Jlc29sdmVDbG9zZSgpO1xyXG4gICAgfVxyXG59O1xyXG5cclxuUHJvbWlzZUZldGNoZXJBZGFwdGVyLnByb3RvdHlwZS5fYWZ0ZXJGZXRjaCA9IGZ1bmN0aW9uKGZldGNoSGFuZGxlLCByZXN1bHQpIHtcclxuXHRmZXRjaEhhbmRsZS50ZXJtaW5hdGUoLyppc0Fib3J0ZWQ9Ki9mYWxzZSk7XHJcblx0dmFyIGltYWdlUGFydFBhcmFtcyA9IGZldGNoSGFuZGxlLmdldEltYWdlUGFydFBhcmFtcygpO1xyXG4gICAgLS10aGlzLl9hY3RpdmVGZXRjaGVzO1xyXG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCB0aGlzLl9kYXRhTGlzdGVuZXJzLmxlbmd0aDsgKytpKSB7XHJcbiAgICAgICAgdGhpcy5fZGF0YUxpc3RlbmVyc1tpXShyZXN1bHQsIGltYWdlUGFydFBhcmFtcyk7XHJcbiAgICB9XHJcbiAgICB0aGlzLl9jaGVja0lmQ2xvc2VkKCk7XHJcbiAgICByZXR1cm4gcmVzdWx0O1xyXG59O1xyXG5cclxuUHJvbWlzZUZldGNoZXJBZGFwdGVyLnByb3RvdHlwZS5fYWZ0ZXJGYWlsZWRGZXRjaCA9IGZ1bmN0aW9uKHJlYXNvbikge1xyXG4gICAgLS10aGlzLl9hY3RpdmVGZXRjaGVzO1xyXG4gICAgdGhpcy5fY2hlY2tJZkNsb3NlZCgpO1xyXG4gICAgcmV0dXJuIHJlYXNvbjtcclxufTsiLCIndXNlIHN0cmljdCc7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IFByb21pc2VGZXRjaGVyQWRhcHRlckZldGNoSGFuZGxlO1xyXG5cclxuLyogZ2xvYmFsIFByb21pc2U6IGZhbHNlICovXHJcblxyXG5mdW5jdGlvbiBQcm9taXNlRmV0Y2hlckFkYXB0ZXJGZXRjaEhhbmRsZShpbWFnZVBhcnRQYXJhbXMpIHtcclxuXHR0aGlzLl9pbWFnZVBhcnRQYXJhbXMgPSBpbWFnZVBhcnRQYXJhbXM7XHJcblx0dGhpcy5fc3RvcFByb21pc2UgPSBudWxsO1xyXG5cdHRoaXMuX3Rlcm1pbmF0ZWRMaXN0ZW5lcnMgPSBbXTtcclxuXHR0aGlzLl9pc1Rlcm1pbmF0ZWQgPSBmYWxzZTtcclxuXHR0aGlzLl9pc0Rpc3Bvc2VkID0gZmFsc2U7XHJcbn1cclxuXHJcblByb21pc2VGZXRjaGVyQWRhcHRlckZldGNoSGFuZGxlLnByb3RvdHlwZS5nZXRJbWFnZVBhcnRQYXJhbXMgPSBmdW5jdGlvbiBnZXRJbWFnZVBhcnRQYXJhbXMoKSB7XHJcblx0cmV0dXJuIHRoaXMuX2ltYWdlUGFydFBhcmFtcztcclxufTtcclxuXHJcblByb21pc2VGZXRjaGVyQWRhcHRlckZldGNoSGFuZGxlLnByb3RvdHlwZS50ZXJtaW5hdGUgPSBmdW5jdGlvbiB0ZXJtaW5hdGUoaXNBYm9ydGVkKSB7XHJcblx0aWYgKHRoaXMuX2lzVGVybWluYXRlZCkge1xyXG5cdFx0dGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogRmV0Y2hIYW5kbGUgZG91YmxlIHRlcm1pbmF0ZSc7XHJcblx0fVxyXG5cdHRoaXMuX2lzVGVybWluYXRlZCA9IHRydWU7XHJcblx0Zm9yICh2YXIgaSA9IDA7IGkgPCB0aGlzLl90ZXJtaW5hdGVkTGlzdGVuZXJzLmxlbmd0aDsgKytpKSB7XHJcblx0XHR0aGlzLl90ZXJtaW5hdGVkTGlzdGVuZXJzW2ldKGlzQWJvcnRlZCk7XHJcblx0fVxyXG59O1xyXG5cclxuLy8gRmV0Y2hlciBpbXBsZW1lbnRhdGlvblxyXG5cclxuUHJvbWlzZUZldGNoZXJBZGFwdGVyRmV0Y2hIYW5kbGUucHJvdG90eXBlLnN0b3BBc3luYyA9IGZ1bmN0aW9uIHN0b3BBc3luYygpIHtcclxuXHRpZiAodGhpcy5fc3RvcFByb21pc2UgIT09IG51bGwpIHtcclxuXHRcdHZhciBzZWxmID0gdGhpcztcclxuXHRcdHRoaXMuX3N0b3BQcm9taXNlID0gbmV3IFByb21pc2UoZnVuY3Rpb24ocmVzb2x2ZSwgcmVqZWN0KSB7XHJcblx0XHRcdHNlbGYub24oJ3Rlcm1pbmF0ZWQnLCByZXNvbHZlKTtcclxuXHRcdH0pO1xyXG5cdH1cclxuXHJcblx0cmV0dXJuIHRoaXMuX3N0b3BQcm9taXNlO1xyXG59O1xyXG5cclxuUHJvbWlzZUZldGNoZXJBZGFwdGVyRmV0Y2hIYW5kbGUucHJvdG90eXBlLnNldElzUHJvZ3Jlc3NpdmUgPSBmdW5jdGlvbiBtb3ZlRmV0Y2goaXNQcm9ncmVzc2l2ZSkge1xyXG5cdC8vIERvIG5vdGhpbmdcclxufTtcclxuXHJcblByb21pc2VGZXRjaGVyQWRhcHRlckZldGNoSGFuZGxlLnByb3RvdHlwZS5vbiA9IGZ1bmN0aW9uIG9uKGV2ZW50LCBsaXN0ZW5lcikge1xyXG5cdGlmIChldmVudCAhPT0gJ3Rlcm1pbmF0ZWQnKSB7XHJcblx0XHR0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBGZXRjaEhhbmRsZS5vbiB3aXRoIHVuc3VwcG9ydGVkIGV2ZW50ICcgKyBldmVudCArICcuIE9ubHkgdGVybWluYXRlZCBldmVudCBpcyBzdXBwb3J0ZWQnO1xyXG5cdH1cclxuXHR0aGlzLl90ZXJtaW5hdGVkTGlzdGVuZXJzLnB1c2gobGlzdGVuZXIpO1xyXG59O1xyXG5cclxuUHJvbWlzZUZldGNoZXJBZGFwdGVyRmV0Y2hIYW5kbGUucHJvdG90eXBlLnJlc3VtZSA9IGZ1bmN0aW9uIHJlc3VtZSgpIHtcclxuXHRpZiAodGhpcy5faXNUZXJtaW5hdGVkKSB7XHJcblx0XHR0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBjYW5ub3QgcmVzdW1lIHN0b3BwZWQgRmV0Y2hIYW5kbGUnO1xyXG5cdH1cclxufTtcclxuXHJcblByb21pc2VGZXRjaGVyQWRhcHRlckZldGNoSGFuZGxlLnByb3RvdHlwZS5kaXNwb3NlID0gZnVuY3Rpb24gZGlzcG9zZSgpIHtcclxuXHRpZiAoIXRoaXMuX2lzVGVybWluYXRlZCkge1xyXG5cdFx0dGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogY2Fubm90IGRpc3Bvc2Ugbm9uLXRlcm1pbmF0ZWQgRmV0Y2hIYW5kbGUnO1xyXG5cdH1cclxuXHRpZiAodGhpcy5faXNEaXNwb3NlZCkge1xyXG5cdFx0dGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogRmV0Y2hIYW5kbGUgZG91YmxlIGRpc3Bvc2UnO1xyXG5cdH1cclxuXHR0aGlzLl9pc0Rpc3Bvc2VkID0gdHJ1ZTtcclxufTtcclxuIl19
