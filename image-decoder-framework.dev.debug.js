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
//module.exports.SimpleFetcher = require('simplefetcher.js');
//module.exports.SimplePixelsDecoderBase = require('simplepixelsdecoderbase.js');
module.exports.CesiumImageDecoderLayerManager = require('_cesiumimagedecoderlayermanager.js');
module.exports.ImageDecoderImageryProvider = require('imagedecoderimageryprovider.js');
module.exports.ImageDecoderRegionLayer = require('imagedecoderregionlayer.js');

},{"_cesiumimagedecoderlayermanager.js":2,"fetchmanager.js":9,"imagedecoder.js":5,"imagedecoderimageryprovider.js":4,"imagedecoderregionlayer.js":21,"promisefetcheradapter.js":23,"viewerimagedecoder.js":19}],21:[function(require,module,exports){
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
},{"promisefetcheradapterfetchhandle.js":24}],24:[function(require,module,exports){
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
//# sourceMappingURL=data:application/json;charset:utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJzcmMvY2VzaXVtaW1hZ2VkZWNvZGVyL19jZXNpdW1mcnVzdHVtY2FsY3VsYXRvci5qcyIsInNyYy9jZXNpdW1pbWFnZWRlY29kZXIvX2Nlc2l1bWltYWdlZGVjb2RlcmxheWVybWFuYWdlci5qcyIsInNyYy9jZXNpdW1pbWFnZWRlY29kZXIvY2FudmFzaW1hZ2VyeXByb3ZpZGVyLmpzIiwic3JjL2Nlc2l1bWltYWdlZGVjb2Rlci9pbWFnZWRlY29kZXJpbWFnZXJ5cHJvdmlkZXIuanMiLCJzcmMvaW1hZ2VkZWNvZGVyL2ltYWdlZGVjb2Rlci5qcyIsInNyYy9pbWFnZWRlY29kZXIvaW1hZ2VkZWNvZGVyaGVscGVycy9kZWNvZGVqb2IuanMiLCJzcmMvaW1hZ2VkZWNvZGVyL2ltYWdlZGVjb2RlcmhlbHBlcnMvZGVjb2Rlam9ic3Bvb2wuanMiLCJzcmMvaW1hZ2VkZWNvZGVyL2ltYWdlZGVjb2RlcmhlbHBlcnMvZmV0Y2hqb2IuanMiLCJzcmMvaW1hZ2VkZWNvZGVyL2ltYWdlZGVjb2RlcmhlbHBlcnMvZmV0Y2htYW5hZ2VyLmpzIiwic3JjL2ltYWdlZGVjb2Rlci9pbWFnZWRlY29kZXJoZWxwZXJzL2ZydXN0dW1yZXF1ZXN0c3ByaW9yaXRpemVyLmpzIiwic3JjL2ltYWdlZGVjb2Rlci9pbWFnZWRlY29kZXJoZWxwZXJzL2ltYWdlSGVscGVyRnVuY3Rpb25zLmpzIiwic3JjL2ltYWdlZGVjb2Rlci9pbWFnZWRlY29kZXJoZWxwZXJzL2xpbmtlZGxpc3QuanMiLCJzcmMvaW1hZ2VkZWNvZGVyL2ltYWdlZGVjb2RlcndvcmtlcnMvY3JlYXRlaW1hZ2VkZWNvZGVyb25zbGF2ZXNpZGUuanMiLCJzcmMvaW1hZ2VkZWNvZGVyL2ltYWdlZGVjb2RlcndvcmtlcnMvaW1hZ2VwYXJhbXNyZXRyaWV2ZXJwcm94eS5qcyIsInNyYy9pbWFnZWRlY29kZXIvaW1hZ2VkZWNvZGVyd29ya2Vycy9zZW5kaW1hZ2VwYXJhbWV0ZXJzdG9tYXN0ZXIuanMiLCJzcmMvaW1hZ2VkZWNvZGVyL2ltYWdlZGVjb2RlcndvcmtlcnMvc2V0ZGVjb2RlcnNsYXZlc2lkZWNyZWF0b3IuanMiLCJzcmMvaW1hZ2VkZWNvZGVyL2ltYWdlZGVjb2RlcndvcmtlcnMvd29ya2VycHJveHlpbWFnZWRlY29kZXIuanMiLCJzcmMvaW1hZ2VkZWNvZGVyL3ZpZXdlcmltYWdlZGVjb2Rlci5qcyIsInNyYy9pbWFnZWRlY29kZXJleHBvcnRzLmpzIiwic3JjL2xlYWZsZXRpbWFnZWRlY29kZXIvaW1hZ2VkZWNvZGVycmVnaW9ubGF5ZXIuanMiLCJzcmMvbGVhZmxldGltYWdlZGVjb2Rlci9sZWFmbGV0ZnJ1c3R1bWNhbGN1bGF0b3IuanMiLCJzcmMvc2ltcGxlZmV0Y2hlci9wcm9taXNlZmV0Y2hlcmFkYXB0ZXIuanMiLCJzcmMvc2ltcGxlZmV0Y2hlci9wcm9taXNlZmV0Y2hlcmFkYXB0ZXJmZXRjaGhhbmRsZS5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTtBQ0FBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzFGQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2pKQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdFVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzlsQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzlTQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDeERBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDM0lBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2xUQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDcE5BO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDektBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7OztBQzdOQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzNGQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDN0JBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2pGQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM3Q0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzNEQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDOUpBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNwb0JBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNYQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQy9LQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ25CQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDL0lBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EiLCJmaWxlIjoiZ2VuZXJhdGVkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXNDb250ZW50IjpbIihmdW5jdGlvbiBlKHQsbixyKXtmdW5jdGlvbiBzKG8sdSl7aWYoIW5bb10pe2lmKCF0W29dKXt2YXIgYT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2lmKCF1JiZhKXJldHVybiBhKG8sITApO2lmKGkpcmV0dXJuIGkobywhMCk7dmFyIGY9bmV3IEVycm9yKFwiQ2Fubm90IGZpbmQgbW9kdWxlICdcIitvK1wiJ1wiKTt0aHJvdyBmLmNvZGU9XCJNT0RVTEVfTk9UX0ZPVU5EXCIsZn12YXIgbD1uW29dPXtleHBvcnRzOnt9fTt0W29dWzBdLmNhbGwobC5leHBvcnRzLGZ1bmN0aW9uKGUpe3ZhciBuPXRbb11bMV1bZV07cmV0dXJuIHMobj9uOmUpfSxsLGwuZXhwb3J0cyxlLHQsbixyKX1yZXR1cm4gbltvXS5leHBvcnRzfXZhciBpPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7Zm9yKHZhciBvPTA7bzxyLmxlbmd0aDtvKyspcyhyW29dKTtyZXR1cm4gc30pIiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBjYWxjdWxhdGVGcnVzdHVtO1xyXG5cclxuLyogZ2xvYmFsIENlc2l1bTogZmFsc2UgKi9cclxuXHJcbnZhciBpbWFnZUhlbHBlckZ1bmN0aW9ucyA9IHJlcXVpcmUoJ2ltYWdlaGVscGVyZnVuY3Rpb25zLmpzJyk7XHJcblxyXG52YXIgTUFYX1JFQ1VSU0lWRV9MRVZFTF9PTl9GQUlMRURfVFJBTlNGT1JNID0gNDtcclxuXHJcbmZ1bmN0aW9uIGNhbGN1bGF0ZUZydXN0dW0oY2VzaXVtV2lkZ2V0KSB7XHJcbiAgICB2YXIgc2NyZWVuU2l6ZSA9IHtcclxuICAgICAgICB4OiBjZXNpdW1XaWRnZXQuc2NlbmUuY2FudmFzLndpZHRoLFxyXG4gICAgICAgIHk6IGNlc2l1bVdpZGdldC5zY2VuZS5jYW52YXMuaGVpZ2h0XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICB2YXIgcG9pbnRzID0gW107XHJcbiAgICBzZWFyY2hCb3VuZGluZ1BvaW50cyhcclxuICAgICAgICAwLCAwLCBzY3JlZW5TaXplLngsIHNjcmVlblNpemUueSwgcG9pbnRzLCBjZXNpdW1XaWRnZXQsIC8qcmVjdXJzaXZlPSovMCk7XHJcblxyXG4gICAgdmFyIGZydXN0dW1SZWN0YW5nbGUgPSBDZXNpdW0uUmVjdGFuZ2xlLmZyb21DYXJ0b2dyYXBoaWNBcnJheShwb2ludHMpO1xyXG4gICAgaWYgKGZydXN0dW1SZWN0YW5nbGUuZWFzdCA8IGZydXN0dW1SZWN0YW5nbGUud2VzdCB8fCBmcnVzdHVtUmVjdGFuZ2xlLm5vcnRoIDwgZnJ1c3R1bVJlY3RhbmdsZS5zb3V0aCkge1xyXG4gICAgICAgIGZydXN0dW1SZWN0YW5nbGUgPSB7XHJcbiAgICAgICAgICAgIGVhc3Q6IE1hdGgubWF4KGZydXN0dW1SZWN0YW5nbGUuZWFzdCwgZnJ1c3R1bVJlY3RhbmdsZS53ZXN0KSxcclxuICAgICAgICAgICAgd2VzdDogTWF0aC5taW4oZnJ1c3R1bVJlY3RhbmdsZS5lYXN0LCBmcnVzdHVtUmVjdGFuZ2xlLndlc3QpLFxyXG4gICAgICAgICAgICBub3J0aDogTWF0aC5tYXgoZnJ1c3R1bVJlY3RhbmdsZS5ub3J0aCwgZnJ1c3R1bVJlY3RhbmdsZS5zb3V0aCksXHJcbiAgICAgICAgICAgIHNvdXRoOiBNYXRoLm1pbihmcnVzdHVtUmVjdGFuZ2xlLm5vcnRoLCBmcnVzdHVtUmVjdGFuZ2xlLnNvdXRoKVxyXG4gICAgICAgIH07XHJcbiAgICB9XHJcblxyXG4gICAgdmFyIGZydXN0dW1EYXRhID0gaW1hZ2VIZWxwZXJGdW5jdGlvbnMuY2FsY3VsYXRlRnJ1c3R1bTJERnJvbUJvdW5kcyhcclxuICAgICAgICBmcnVzdHVtUmVjdGFuZ2xlLCBzY3JlZW5TaXplKTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgcmV0dXJuIGZydXN0dW1EYXRhO1xyXG59XHJcbiAgICBcclxuZnVuY3Rpb24gc2VhcmNoQm91bmRpbmdQb2ludHMoXHJcbiAgICBtaW5YLCBtaW5ZLCBtYXhYLCBtYXhZLCBwb2ludHMsIGNlc2l1bVdpZGdldCwgcmVjdXJzaXZlTGV2ZWwpIHtcclxuICAgIFxyXG4gICAgdmFyIHRyYW5zZm9ybWVkUG9pbnRzID0gMDtcclxuICAgIHRyYW5zZm9ybWVkUG9pbnRzICs9IHRyYW5zZm9ybUFuZEFkZFBvaW50KFxyXG4gICAgICAgIG1pblgsIG1pblksIGNlc2l1bVdpZGdldCwgcG9pbnRzKTtcclxuICAgIHRyYW5zZm9ybWVkUG9pbnRzICs9IHRyYW5zZm9ybUFuZEFkZFBvaW50KFxyXG4gICAgICAgIG1heFgsIG1pblksIGNlc2l1bVdpZGdldCwgcG9pbnRzKTtcclxuICAgIHRyYW5zZm9ybWVkUG9pbnRzICs9IHRyYW5zZm9ybUFuZEFkZFBvaW50KFxyXG4gICAgICAgIG1pblgsIG1heFksIGNlc2l1bVdpZGdldCwgcG9pbnRzKTtcclxuICAgIHRyYW5zZm9ybWVkUG9pbnRzICs9IHRyYW5zZm9ybUFuZEFkZFBvaW50KFxyXG4gICAgICAgIG1heFgsIG1heFksIGNlc2l1bVdpZGdldCwgcG9pbnRzKTtcclxuXHJcbiAgICB2YXIgbWF4TGV2ZWwgPSBNQVhfUkVDVVJTSVZFX0xFVkVMX09OX0ZBSUxFRF9UUkFOU0ZPUk07XHJcbiAgICBcclxuICAgIGlmICh0cmFuc2Zvcm1lZFBvaW50cyA9PT0gNCB8fCByZWN1cnNpdmVMZXZlbCA+PSBtYXhMZXZlbCkge1xyXG4gICAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIFxyXG4gICAgKytyZWN1cnNpdmVMZXZlbDtcclxuICAgIFxyXG4gICAgdmFyIG1pZGRsZVggPSAobWluWCArIG1heFgpIC8gMjtcclxuICAgIHZhciBtaWRkbGVZID0gKG1pblkgKyBtYXhZKSAvIDI7XHJcbiAgICBcclxuICAgIHNlYXJjaEJvdW5kaW5nUG9pbnRzKFxyXG4gICAgICAgIG1pblgsIG1pblksIG1pZGRsZVgsIG1pZGRsZVksIHBvaW50cywgY2VzaXVtV2lkZ2V0LCByZWN1cnNpdmVMZXZlbCk7XHJcblxyXG4gICAgc2VhcmNoQm91bmRpbmdQb2ludHMoXHJcbiAgICAgICAgbWluWCwgbWlkZGxlWSwgbWlkZGxlWCwgbWF4WSwgcG9pbnRzLCBjZXNpdW1XaWRnZXQsIHJlY3Vyc2l2ZUxldmVsKTtcclxuXHJcbiAgICBzZWFyY2hCb3VuZGluZ1BvaW50cyhcclxuICAgICAgICBtaWRkbGVYLCBtaW5ZLCBtYXhYLCBtaWRkbGVZLCBwb2ludHMsIGNlc2l1bVdpZGdldCwgcmVjdXJzaXZlTGV2ZWwpO1xyXG5cclxuICAgIHNlYXJjaEJvdW5kaW5nUG9pbnRzKFxyXG4gICAgICAgIG1pZGRsZVgsIG1pZGRsZVksIG1heFgsIG1heFksIHBvaW50cywgY2VzaXVtV2lkZ2V0LCByZWN1cnNpdmVMZXZlbCk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIHRyYW5zZm9ybUFuZEFkZFBvaW50KHgsIHksIGNlc2l1bVdpZGdldCwgcG9pbnRzKSB7XHJcbiAgICBcclxuICAgIHZhciBzY3JlZW5Qb2ludCA9IG5ldyBDZXNpdW0uQ2FydGVzaWFuMih4LCB5KTtcclxuICAgIHZhciBlbGxpcHNvaWQgPSBjZXNpdW1XaWRnZXQuc2NlbmUubWFwUHJvamVjdGlvbi5lbGxpcHNvaWQ7XHJcbiAgICB2YXIgcG9pbnQzRCA9IGNlc2l1bVdpZGdldC5zY2VuZS5jYW1lcmEucGlja0VsbGlwc29pZChzY3JlZW5Qb2ludCwgZWxsaXBzb2lkKTtcclxuICAgIFxyXG4gICAgaWYgKHBvaW50M0QgPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIHJldHVybiAwO1xyXG4gICAgfVxyXG5cclxuICAgIHZhciBjYXJ0ZXNpYW4gPSBlbGxpcHNvaWQuY2FydGVzaWFuVG9DYXJ0b2dyYXBoaWMocG9pbnQzRCk7XHJcbiAgICBpZiAoY2FydGVzaWFuID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICByZXR1cm4gMDtcclxuICAgIH1cclxuICAgIFxyXG4gICAgcG9pbnRzLnB1c2goY2FydGVzaWFuKTtcclxuICAgIHJldHVybiAxO1xyXG59IiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBDZXNpdW1JbWFnZURlY29kZXJMYXllck1hbmFnZXI7XHJcblxyXG52YXIgQ2FudmFzSW1hZ2VyeVByb3ZpZGVyID0gcmVxdWlyZSgnY2FudmFzaW1hZ2VyeXByb3ZpZGVyLmpzJyk7XHJcbnZhciBWaWV3ZXJJbWFnZURlY29kZXIgPSByZXF1aXJlKCd2aWV3ZXJpbWFnZWRlY29kZXIuanMnKTtcclxudmFyIGNhbGN1bGF0ZUNlc2l1bUZydXN0dW0gPSByZXF1aXJlKCdfY2VzaXVtZnJ1c3R1bWNhbGN1bGF0b3IuanMnKTtcclxuXHJcbi8qIGdsb2JhbCBDZXNpdW06IGZhbHNlICovXHJcblxyXG5mdW5jdGlvbiBDZXNpdW1JbWFnZURlY29kZXJMYXllck1hbmFnZXIoaW1hZ2VJbXBsZW1lbnRhdGlvbkNsYXNzTmFtZSwgb3B0aW9ucykge1xyXG4gICAgdGhpcy5fb3B0aW9ucyA9IG9wdGlvbnMgfHwge307XHJcbiAgICBcclxuICAgIGlmICh0aGlzLl9vcHRpb25zLnJlY3RhbmdsZSAhPT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgdGhpcy5fb3B0aW9ucyA9IEpTT04ucGFyc2UoSlNPTi5zdHJpbmdpZnkob3B0aW9ucykpO1xyXG4gICAgICAgIHRoaXMuX29wdGlvbnMuY2FydG9ncmFwaGljQm91bmRzID0ge1xyXG4gICAgICAgICAgICB3ZXN0OiBvcHRpb25zLnJlY3RhbmdsZS53ZXN0LFxyXG4gICAgICAgICAgICBlYXN0OiBvcHRpb25zLnJlY3RhbmdsZS5lYXN0LFxyXG4gICAgICAgICAgICBzb3V0aDogb3B0aW9ucy5yZWN0YW5nbGUuc291dGgsXHJcbiAgICAgICAgICAgIG5vcnRoOiBvcHRpb25zLnJlY3RhbmdsZS5ub3J0aFxyXG4gICAgICAgIH07XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHRoaXMuX29wdGlvbnMubWluRnVuY3Rpb25DYWxsSW50ZXJ2YWxNaWxsaXNlY29uZHMgPVxyXG4gICAgICAgIG9wdGlvbnMubWluRnVuY3Rpb25DYWxsSW50ZXJ2YWxNaWxsaXNlY29uZHMgfHwgMTAwO1xyXG4gICAgdGhpcy5fdXJsID0gb3B0aW9ucy51cmw7XHJcblxyXG4gICAgdGhpcy5fdGFyZ2V0Q2FudmFzID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnY2FudmFzJyk7XHJcbiAgICB0aGlzLl9pbWFnZXJ5UHJvdmlkZXJzID0gW1xyXG4gICAgICAgIG5ldyBDYW52YXNJbWFnZXJ5UHJvdmlkZXIodGhpcy5fdGFyZ2V0Q2FudmFzKSxcclxuICAgICAgICBuZXcgQ2FudmFzSW1hZ2VyeVByb3ZpZGVyKHRoaXMuX3RhcmdldENhbnZhcylcclxuICAgIF07XHJcbiAgICB0aGlzLl9pbWFnZXJ5TGF5ZXJTaG93biA9IG5ldyBDZXNpdW0uSW1hZ2VyeUxheWVyKHRoaXMuX2ltYWdlcnlQcm92aWRlcnNbMF0pO1xyXG4gICAgdGhpcy5faW1hZ2VyeUxheWVyUGVuZGluZyA9IG5ldyBDZXNpdW0uSW1hZ2VyeUxheWVyKHRoaXMuX2ltYWdlcnlQcm92aWRlcnNbMV0pO1xyXG5cclxuICAgIHRoaXMuX2NhbnZhc1VwZGF0ZWRDYWxsYmFja0JvdW5kID0gdGhpcy5fY2FudmFzVXBkYXRlZENhbGxiYWNrLmJpbmQodGhpcyk7XHJcbiAgICBcclxuICAgIHRoaXMuX2lzUGVuZGluZ1VwZGF0ZUNhbGxiYWNrID0gZmFsc2U7XHJcbiAgICB0aGlzLl9pc1doaWxlUmVwbGFjZUxheWVyU2hvd24gPSBmYWxzZTtcclxuICAgIHRoaXMuX3BlbmRpbmdQb3NpdGlvblJlY3RhbmdsZSA9IG51bGw7XHJcbiAgICBcclxuICAgIHRoaXMuX2ltYWdlID0gbmV3IFZpZXdlckltYWdlRGVjb2RlcihcclxuICAgICAgICBpbWFnZUltcGxlbWVudGF0aW9uQ2xhc3NOYW1lLFxyXG4gICAgICAgIHRoaXMuX2NhbnZhc1VwZGF0ZWRDYWxsYmFja0JvdW5kLFxyXG4gICAgICAgIHRoaXMuX29wdGlvbnMpO1xyXG4gICAgXHJcbiAgICB0aGlzLl9pbWFnZS5zZXRUYXJnZXRDYW52YXModGhpcy5fdGFyZ2V0Q2FudmFzKTtcclxuICAgIFxyXG4gICAgdGhpcy5fdXBkYXRlRnJ1c3R1bUJvdW5kID0gdGhpcy5fdXBkYXRlRnJ1c3R1bS5iaW5kKHRoaXMpO1xyXG4gICAgdGhpcy5fcG9zdFJlbmRlckJvdW5kID0gdGhpcy5fcG9zdFJlbmRlci5iaW5kKHRoaXMpO1xyXG59XHJcblxyXG5DZXNpdW1JbWFnZURlY29kZXJMYXllck1hbmFnZXIucHJvdG90eXBlLnNldEV4Y2VwdGlvbkNhbGxiYWNrID0gZnVuY3Rpb24gc2V0RXhjZXB0aW9uQ2FsbGJhY2soZXhjZXB0aW9uQ2FsbGJhY2spIHtcclxuICAgIHRoaXMuX2ltYWdlLnNldEV4Y2VwdGlvbkNhbGxiYWNrKGV4Y2VwdGlvbkNhbGxiYWNrKTtcclxufTtcclxuXHJcbkNlc2l1bUltYWdlRGVjb2RlckxheWVyTWFuYWdlci5wcm90b3R5cGUub3BlbiA9IGZ1bmN0aW9uIG9wZW4od2lkZ2V0T3JWaWV3ZXIpIHtcclxuICAgIHRoaXMuX3dpZGdldCA9IHdpZGdldE9yVmlld2VyO1xyXG4gICAgdGhpcy5fbGF5ZXJzID0gd2lkZ2V0T3JWaWV3ZXIuc2NlbmUuaW1hZ2VyeUxheWVycztcclxuICAgIHdpZGdldE9yVmlld2VyLnNjZW5lLnBvc3RSZW5kZXIuYWRkRXZlbnRMaXN0ZW5lcih0aGlzLl9wb3N0UmVuZGVyQm91bmQpO1xyXG4gICAgXHJcbiAgICB0aGlzLl9pbWFnZS5vcGVuKHRoaXMuX3VybCk7XHJcbiAgICB0aGlzLl9sYXllcnMuYWRkKHRoaXMuX2ltYWdlcnlMYXllclNob3duKTtcclxuICAgIFxyXG4gICAgLy8gTk9URTogSXMgdGhlcmUgYW4gZXZlbnQgaGFuZGxlciB0byByZWdpc3RlciBpbnN0ZWFkP1xyXG4gICAgLy8gKENlc2l1bSdzIGV2ZW50IGNvbnRyb2xsZXJzIG9ubHkgZXhwb3NlIGtleWJvYXJkIGFuZCBtb3VzZVxyXG4gICAgLy8gZXZlbnRzLCBidXQgdGhlcmUgaXMgbm8gZXZlbnQgZm9yIGZydXN0dW0gY2hhbmdlZFxyXG4gICAgLy8gcHJvZ3JhbW1hdGljYWxseSkuXHJcbiAgICB0aGlzLl9pbnRlcnZhbEhhbmRsZSA9IHNldEludGVydmFsKFxyXG4gICAgICAgIHRoaXMuX3VwZGF0ZUZydXN0dW1Cb3VuZCxcclxuICAgICAgICA1MDApO1xyXG59O1xyXG5cclxuQ2VzaXVtSW1hZ2VEZWNvZGVyTGF5ZXJNYW5hZ2VyLnByb3RvdHlwZS5jbG9zZSA9IGZ1bmN0aW9uIGNsb3NlKCkge1xyXG4gICAgdGhpcy5faW1hZ2UuY2xvc2UoKTtcclxuICAgIGNsZWFySW50ZXJ2YWwodGhpcy5faW50ZXJ2YWxIYW5kbGUpO1xyXG5cclxuICAgIHRoaXMuX2xheWVycy5yZW1vdmUodGhpcy5faW1hZ2VyeUxheWVyU2hvd24pO1xyXG4gICAgdGhpcy5fd2lkZ2V0LnJlbW92ZUV2ZW50TGlzdGVuZXIodGhpcy5fcG9zdFJlbmRlckJvdW5kKTtcclxuICAgIGlmICh0aGlzLl9pc1doaWxlUmVwbGFjZUxheWVyU2hvd24pIHtcclxuICAgICAgICB0aGlzLl9pc1doaWxlUmVwbGFjZUxheWVyU2hvd24gPSBmYWxzZTtcclxuICAgICAgICB0aGlzLl9pc1BlbmRpbmdVcGRhdGVDYWxsYmFjayA9IGZhbHNlO1xyXG4gICAgICAgIHRoaXMuX2xheWVycy5yZW1vdmUodGhpcy5faW1hZ2VyeUxheWVyUGVuZGluZyk7XHJcbiAgICB9XHJcbn07XHJcblxyXG5DZXNpdW1JbWFnZURlY29kZXJMYXllck1hbmFnZXIucHJvdG90eXBlLmdldEltYWdlcnlMYXllcnMgPSBmdW5jdGlvbiBnZXRJbWFnZXJ5TGF5ZXJzKCkge1xyXG4gICAgcmV0dXJuIFt0aGlzLl9pbWFnZXJ5TGF5ZXJTaG93biwgdGhpcy5faW1hZ2VyeUxheWVyUGVuZGluZ107XHJcbn07XHJcblxyXG5DZXNpdW1JbWFnZURlY29kZXJMYXllck1hbmFnZXIucHJvdG90eXBlLl91cGRhdGVGcnVzdHVtID0gZnVuY3Rpb24gdXBkYXRlRnJ1c3R1bSgpIHtcclxuICAgIHZhciBmcnVzdHVtID0gY2FsY3VsYXRlQ2VzaXVtRnJ1c3R1bSh0aGlzLl93aWRnZXQpO1xyXG4gICAgaWYgKGZydXN0dW0gIT09IG51bGwpIHtcclxuICAgICAgICB0aGlzLl9pbWFnZS51cGRhdGVWaWV3QXJlYShmcnVzdHVtKTtcclxuICAgIH1cclxufTtcclxuXHJcbkNlc2l1bUltYWdlRGVjb2RlckxheWVyTWFuYWdlci5wcm90b3R5cGUuX2NhbnZhc1VwZGF0ZWRDYWxsYmFjayA9IGZ1bmN0aW9uIGNhbnZhc1VwZGF0ZWRDYWxsYmFjayhuZXdQb3NpdGlvbikge1xyXG4gICAgaWYgKHRoaXMuX2lzV2hpbGVSZXBsYWNlTGF5ZXJTaG93bikge1xyXG4gICAgICAgIHRoaXMuX2lzUGVuZGluZ1VwZGF0ZUNhbGxiYWNrID0gdHJ1ZTtcclxuICAgICAgICB0aGlzLl9wZW5kaW5nUG9zaXRpb25SZWN0YW5nbGUgPSBuZXdQb3NpdGlvbjtcclxuICAgIH1cclxuICAgIFxyXG4gICAgaWYgKG5ld1Bvc2l0aW9uICE9PSBudWxsKSB7XHJcbiAgICAgICAgdmFyIHJlY3RhbmdsZSA9IG5ldyBDZXNpdW0uUmVjdGFuZ2xlKFxyXG4gICAgICAgICAgICBuZXdQb3NpdGlvbi53ZXN0LFxyXG4gICAgICAgICAgICBuZXdQb3NpdGlvbi5zb3V0aCxcclxuICAgICAgICAgICAgbmV3UG9zaXRpb24uZWFzdCxcclxuICAgICAgICAgICAgbmV3UG9zaXRpb24ubm9ydGgpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHRoaXMuX2ltYWdlcnlQcm92aWRlcnNbMF0uc2V0UmVjdGFuZ2xlKHJlY3RhbmdsZSk7XHJcbiAgICAgICAgdGhpcy5faW1hZ2VyeVByb3ZpZGVyc1sxXS5zZXRSZWN0YW5nbGUocmVjdGFuZ2xlKTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgdGhpcy5fcmVtb3ZlQW5kUmVBZGRMYXllcigpO1xyXG59O1xyXG5cclxuQ2VzaXVtSW1hZ2VEZWNvZGVyTGF5ZXJNYW5hZ2VyLnByb3RvdHlwZS5fcmVtb3ZlQW5kUmVBZGRMYXllciA9IGZ1bmN0aW9uIHJlbW92ZUFuZFJlQWRkTGF5ZXIoKSB7XHJcbiAgICB2YXIgaW5kZXggPSB0aGlzLl9sYXllcnMuaW5kZXhPZih0aGlzLl9pbWFnZXJ5TGF5ZXJTaG93bik7XHJcbiAgICBcclxuICAgIGlmIChpbmRleCA8IDApIHtcclxuICAgICAgICB0aHJvdyAnTGF5ZXIgd2FzIHJlbW92ZWQgZnJvbSB2aWV3ZXJcXCdzIGxheWVycyAgd2l0aG91dCAnICtcclxuICAgICAgICAgICAgJ2Nsb3NpbmcgbGF5ZXIgbWFuYWdlci4gVXNlIENlc2l1bUltYWdlRGVjb2RlckxheWVyTWFuYWdlci4nICtcclxuICAgICAgICAgICAgJ2Nsb3NlKCkgaW5zdGVhZCc7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHRoaXMuX2lzV2hpbGVSZXBsYWNlTGF5ZXJTaG93biA9IHRydWU7XHJcbiAgICB0aGlzLl9sYXllcnMuYWRkKHRoaXMuX2ltYWdlcnlMYXllclBlbmRpbmcsIGluZGV4KTtcclxufTtcclxuXHJcbkNlc2l1bUltYWdlRGVjb2RlckxheWVyTWFuYWdlci5wcm90b3R5cGUuX3Bvc3RSZW5kZXIgPSBmdW5jdGlvbiBwb3N0UmVuZGVyKCkge1xyXG4gICAgaWYgKCF0aGlzLl9pc1doaWxlUmVwbGFjZUxheWVyU2hvd24pXHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgXHJcbiAgICB0aGlzLl9pc1doaWxlUmVwbGFjZUxheWVyU2hvd24gPSBmYWxzZTtcclxuICAgIHRoaXMuX2xheWVycy5yZW1vdmUodGhpcy5faW1hZ2VyeUxheWVyU2hvd24sIC8qZGVzdHJveT0qL2ZhbHNlKTtcclxuICAgIFxyXG4gICAgdmFyIHN3YXAgPSB0aGlzLl9pbWFnZXJ5TGF5ZXJTaG93bjtcclxuICAgIHRoaXMuX2ltYWdlcnlMYXllclNob3duID0gdGhpcy5faW1hZ2VyeUxheWVyUGVuZGluZztcclxuICAgIHRoaXMuX2ltYWdlcnlMYXllclBlbmRpbmcgPSBzd2FwO1xyXG4gICAgXHJcbiAgICBpZiAodGhpcy5faXNQZW5kaW5nVXBkYXRlQ2FsbGJhY2spIHtcclxuICAgICAgICB0aGlzLl9pc1BlbmRpbmdVcGRhdGVDYWxsYmFjayA9IGZhbHNlO1xyXG4gICAgICAgIHRoaXMuX2NhbnZhc1VwZGF0ZWRDYWxsYmFjayh0aGlzLl9wZW5kaW5nUG9zaXRpb25SZWN0YW5nbGUpO1xyXG4gICAgfVxyXG59OyIsIid1c2Ugc3RyaWN0JztcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gQ2FudmFzSW1hZ2VyeVByb3ZpZGVyO1xyXG5cclxuLyogZ2xvYmFsIENlc2l1bTogZmFsc2UgKi9cclxuLyogZ2xvYmFsIERldmVsb3BlckVycm9yOiBmYWxzZSAqL1xyXG4vKiBnbG9iYWwgQ3JlZGl0OiBmYWxzZSAqL1xyXG5cclxuLyoqXHJcbiAqIFByb3ZpZGVzIGEgU2luZ2xlIENhbnZhcyBpbWFnZXJ5IHRpbGUuICBUaGUgaW1hZ2UgaXMgYXNzdW1lZCB0byB1c2UgYVxyXG4gKiB7QGxpbmsgR2VvZ3JhcGhpY1RpbGluZ1NjaGVtZX0uXHJcbiAqXHJcbiAqIEBhbGlhcyBDYW52YXNJbWFnZXJ5UHJvdmlkZXJcclxuICogQGNvbnN0cnVjdG9yXHJcbiAqXHJcbiAqIEBwYXJhbSB7Y2FudmFzfSBDYW52YXMgZm9yIHRoZSB0aWxlLlxyXG4gKiBAcGFyYW0ge09iamVjdH0gb3B0aW9ucyBPYmplY3Qgd2l0aCB0aGUgZm9sbG93aW5nIHByb3BlcnRpZXM6XHJcbiAqIEBwYXJhbSB7Q3JlZGl0fFN0cmluZ30gW29wdGlvbnMuY3JlZGl0XSBBIGNyZWRpdCBmb3IgdGhlIGRhdGEgc291cmNlLCB3aGljaCBpcyBkaXNwbGF5ZWQgb24gdGhlIGNhbnZhcy5cclxuICpcclxuICogQHNlZSBBcmNHaXNNYXBTZXJ2ZXJJbWFnZXJ5UHJvdmlkZXJcclxuICogQHNlZSBCaW5nTWFwc0ltYWdlcnlQcm92aWRlclxyXG4gKiBAc2VlIEdvb2dsZUVhcnRoSW1hZ2VyeVByb3ZpZGVyXHJcbiAqIEBzZWUgT3BlblN0cmVldE1hcEltYWdlcnlQcm92aWRlclxyXG4gKiBAc2VlIFRpbGVNYXBTZXJ2aWNlSW1hZ2VyeVByb3ZpZGVyXHJcbiAqIEBzZWUgV2ViTWFwU2VydmljZUltYWdlcnlQcm92aWRlclxyXG4gKi9cclxuZnVuY3Rpb24gQ2FudmFzSW1hZ2VyeVByb3ZpZGVyKGNhbnZhcywgb3B0aW9ucykge1xyXG4gICAgaWYgKG9wdGlvbnMgPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIG9wdGlvbnMgPSB7fTtcclxuICAgIH1cclxuXHJcbiAgICAvLz4+aW5jbHVkZVN0YXJ0KCdkZWJ1ZycsIHByYWdtYXMuZGVidWcpO1xyXG4gICAgaWYgKGNhbnZhcyA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgdGhyb3cgbmV3IERldmVsb3BlckVycm9yKCdjYW52YXMgaXMgcmVxdWlyZWQuJyk7XHJcbiAgICB9XHJcbiAgICAvLz4+aW5jbHVkZUVuZCgnZGVidWcnKTtcclxuXHJcbiAgICB0aGlzLl9jYW52YXMgPSBjYW52YXM7XHJcblxyXG4gICAgdGhpcy5fZXJyb3JFdmVudCA9IG5ldyBFdmVudCgnQ2FudmFzSW1hZ2VyeVByb3ZpZGVyU3RhdHVzJyk7XHJcblxyXG4gICAgdGhpcy5fcmVhZHkgPSBmYWxzZTtcclxuXHJcbiAgICB2YXIgY3JlZGl0ID0gb3B0aW9ucy5jcmVkaXQ7XHJcbiAgICBpZiAodHlwZW9mIGNyZWRpdCA9PT0gJ3N0cmluZycpIHtcclxuICAgICAgICBjcmVkaXQgPSBuZXcgQ3JlZGl0KGNyZWRpdCk7XHJcbiAgICB9XHJcbiAgICB0aGlzLl9jcmVkaXQgPSBjcmVkaXQ7XHJcbn1cclxuXHJcbkNhbnZhc0ltYWdlcnlQcm92aWRlci5wcm90b3R5cGUgPSB7XHJcbiAgICAvKipcclxuICAgICAqIEdldHMgdGhlIHdpZHRoIG9mIGVhY2ggdGlsZSwgaW4gcGl4ZWxzLiBUaGlzIGZ1bmN0aW9uIHNob3VsZFxyXG4gICAgICogbm90IGJlIGNhbGxlZCBiZWZvcmUge0BsaW5rIENhbnZhc0ltYWdlcnlQcm92aWRlciNyZWFkeX0gcmV0dXJucyB0cnVlLlxyXG4gICAgICogQG1lbWJlcm9mIENhbnZhc0ltYWdlcnlQcm92aWRlci5wcm90b3R5cGVcclxuICAgICAqIEB0eXBlIHtOdW1iZXJ9XHJcbiAgICAgKiBAcmVhZG9ubHlcclxuICAgICAqL1xyXG4gICAgZ2V0IHRpbGVXaWR0aCgpIHtcclxuICAgICAgICAgICAgLy8+PmluY2x1ZGVTdGFydCgnZGVidWcnLCBwcmFnbWFzLmRlYnVnKTtcclxuICAgICAgICAgICAgaWYgKCF0aGlzLl9yZWFkeSkge1xyXG4gICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBEZXZlbG9wZXJFcnJvcigndGlsZVdpZHRoIG11c3Qgbm90IGJlIGNhbGxlZCBiZWZvcmUgdGhlIGltYWdlcnkgcHJvdmlkZXIgaXMgcmVhZHkuJyk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgLy8+PmluY2x1ZGVFbmQoJ2RlYnVnJyk7XHJcblxyXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5fY2FudmFzLndpZHRoO1xyXG4gICAgfSxcclxuXHJcbiAgICAvKipcclxuICAgICAqIEdldHMgdGhlIGhlaWdodCBvZiBlYWNoIHRpbGUsIGluIHBpeGVscy4gIFRoaXMgZnVuY3Rpb24gc2hvdWxkXHJcbiAgICAgKiBub3QgYmUgY2FsbGVkIGJlZm9yZSB7QGxpbmsgQ2FudmFzSW1hZ2VyeVByb3ZpZGVyI3JlYWR5fSByZXR1cm5zIHRydWUuXHJcbiAgICAgKiBAbWVtYmVyb2YgQ2FudmFzSW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZVxyXG4gICAgICogQHR5cGUge051bWJlcn1cclxuICAgICAqIEByZWFkb25seVxyXG4gICAgICovXHJcbiAgICBnZXQgdGlsZUhlaWdodCgpIHtcclxuICAgICAgICAgICAgLy8+PmluY2x1ZGVTdGFydCgnZGVidWcnLCBwcmFnbWFzLmRlYnVnKTtcclxuICAgICAgICAgICAgaWYgKCF0aGlzLl9yZWFkeSkge1xyXG4gICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBEZXZlbG9wZXJFcnJvcigndGlsZUhlaWdodCBtdXN0IG5vdCBiZSBjYWxsZWQgYmVmb3JlIHRoZSBpbWFnZXJ5IHByb3ZpZGVyIGlzIHJlYWR5LicpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIC8vPj5pbmNsdWRlRW5kKCdkZWJ1ZycpO1xyXG5cclxuICAgICAgICAgICAgcmV0dXJuIHRoaXMuX2NhbnZhcy5oZWlnaHQ7XHJcbiAgICB9LFxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2V0cyB0aGUgbWF4aW11bSBsZXZlbC1vZi1kZXRhaWwgdGhhdCBjYW4gYmUgcmVxdWVzdGVkLiAgVGhpcyBmdW5jdGlvbiBzaG91bGRcclxuICAgICAqIG5vdCBiZSBjYWxsZWQgYmVmb3JlIHtAbGluayBDYW52YXNJbWFnZXJ5UHJvdmlkZXIjcmVhZHl9IHJldHVybnMgdHJ1ZS5cclxuICAgICAqIEBtZW1iZXJvZiBDYW52YXNJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlXHJcbiAgICAgKiBAdHlwZSB7TnVtYmVyfVxyXG4gICAgICogQHJlYWRvbmx5XHJcbiAgICAgKi9cclxuICAgIGdldCBtYXhpbXVtTGV2ZWwoKSB7XHJcbiAgICAgICAgICAgIC8vPj5pbmNsdWRlU3RhcnQoJ2RlYnVnJywgcHJhZ21hcy5kZWJ1Zyk7XHJcbiAgICAgICAgICAgIGlmICghdGhpcy5fcmVhZHkpIHtcclxuICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRGV2ZWxvcGVyRXJyb3IoJ21heGltdW1MZXZlbCBtdXN0IG5vdCBiZSBjYWxsZWQgYmVmb3JlIHRoZSBpbWFnZXJ5IHByb3ZpZGVyIGlzIHJlYWR5LicpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIC8vPj5pbmNsdWRlRW5kKCdkZWJ1ZycpO1xyXG5cclxuICAgICAgICAgICAgcmV0dXJuIDA7XHJcbiAgICB9LFxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2V0cyB0aGUgbWluaW11bSBsZXZlbC1vZi1kZXRhaWwgdGhhdCBjYW4gYmUgcmVxdWVzdGVkLiAgVGhpcyBmdW5jdGlvbiBzaG91bGRcclxuICAgICAqIG5vdCBiZSBjYWxsZWQgYmVmb3JlIHtAbGluayBDYW52YXNJbWFnZXJ5UHJvdmlkZXIjcmVhZHl9IHJldHVybnMgdHJ1ZS5cclxuICAgICAqIEBtZW1iZXJvZiBDYW52YXNJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlXHJcbiAgICAgKiBAdHlwZSB7TnVtYmVyfVxyXG4gICAgICogQHJlYWRvbmx5XHJcbiAgICAgKi9cclxuICAgIGdldCBtaW5pbXVtTGV2ZWwoKSB7XHJcbiAgICAgICAgICAgIC8vPj5pbmNsdWRlU3RhcnQoJ2RlYnVnJywgcHJhZ21hcy5kZWJ1Zyk7XHJcbiAgICAgICAgICAgIGlmICghdGhpcy5fcmVhZHkpIHtcclxuICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRGV2ZWxvcGVyRXJyb3IoJ21pbmltdW1MZXZlbCBtdXN0IG5vdCBiZSBjYWxsZWQgYmVmb3JlIHRoZSBpbWFnZXJ5IHByb3ZpZGVyIGlzIHJlYWR5LicpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIC8vPj5pbmNsdWRlRW5kKCdkZWJ1ZycpO1xyXG5cclxuICAgICAgICAgICAgcmV0dXJuIDA7XHJcbiAgICB9LFxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2V0cyB0aGUgdGlsaW5nIHNjaGVtZSB1c2VkIGJ5IHRoaXMgcHJvdmlkZXIuICBUaGlzIGZ1bmN0aW9uIHNob3VsZFxyXG4gICAgICogbm90IGJlIGNhbGxlZCBiZWZvcmUge0BsaW5rIENhbnZhc0ltYWdlcnlQcm92aWRlciNyZWFkeX0gcmV0dXJucyB0cnVlLlxyXG4gICAgICogQG1lbWJlcm9mIENhbnZhc0ltYWdlcnlQcm92aWRlci5wcm90b3R5cGVcclxuICAgICAqIEB0eXBlIHtUaWxpbmdTY2hlbWV9XHJcbiAgICAgKiBAcmVhZG9ubHlcclxuICAgICAqL1xyXG4gICAgZ2V0IHRpbGluZ1NjaGVtZSgpIHtcclxuICAgICAgICAgICAgLy8+PmluY2x1ZGVTdGFydCgnZGVidWcnLCBwcmFnbWFzLmRlYnVnKTtcclxuICAgICAgICAgICAgaWYgKCF0aGlzLl9yZWFkeSkge1xyXG4gICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBEZXZlbG9wZXJFcnJvcigndGlsaW5nU2NoZW1lIG11c3Qgbm90IGJlIGNhbGxlZCBiZWZvcmUgdGhlIGltYWdlcnkgcHJvdmlkZXIgaXMgcmVhZHkuJyk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgLy8+PmluY2x1ZGVFbmQoJ2RlYnVnJyk7XHJcblxyXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5fdGlsaW5nU2NoZW1lO1xyXG4gICAgfSxcclxuXHJcbiAgICAvKipcclxuICAgICAqIEdldHMgdGhlIHJlY3RhbmdsZSwgaW4gcmFkaWFucywgb2YgdGhlIGltYWdlcnkgcHJvdmlkZWQgYnkgdGhpcyBpbnN0YW5jZS4gIFRoaXMgZnVuY3Rpb24gc2hvdWxkXHJcbiAgICAgKiBub3QgYmUgY2FsbGVkIGJlZm9yZSB7QGxpbmsgQ2FudmFzSW1hZ2VyeVByb3ZpZGVyI3JlYWR5fSByZXR1cm5zIHRydWUuXHJcbiAgICAgKiBAbWVtYmVyb2YgQ2FudmFzSW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZVxyXG4gICAgICogQHR5cGUge1JlY3RhbmdsZX1cclxuICAgICAqIEByZWFkb25seVxyXG4gICAgICovXHJcbiAgICBnZXQgcmVjdGFuZ2xlKCkge1xyXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5fdGlsaW5nU2NoZW1lLnJlY3RhbmdsZTtcclxuICAgIH0sXHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZXRzIHRoZSB0aWxlIGRpc2NhcmQgcG9saWN5LiAgSWYgbm90IHVuZGVmaW5lZCwgdGhlIGRpc2NhcmQgcG9saWN5IGlzIHJlc3BvbnNpYmxlXHJcbiAgICAgKiBmb3IgZmlsdGVyaW5nIG91dCBcIm1pc3NpbmdcIiB0aWxlcyB2aWEgaXRzIHNob3VsZERpc2NhcmRJbWFnZSBmdW5jdGlvbi4gIElmIHRoaXMgZnVuY3Rpb25cclxuICAgICAqIHJldHVybnMgdW5kZWZpbmVkLCBubyB0aWxlcyBhcmUgZmlsdGVyZWQuICBUaGlzIGZ1bmN0aW9uIHNob3VsZFxyXG4gICAgICogbm90IGJlIGNhbGxlZCBiZWZvcmUge0BsaW5rIENhbnZhc0ltYWdlcnlQcm92aWRlciNyZWFkeX0gcmV0dXJucyB0cnVlLlxyXG4gICAgICogQG1lbWJlcm9mIENhbnZhc0ltYWdlcnlQcm92aWRlci5wcm90b3R5cGVcclxuICAgICAqIEB0eXBlIHtUaWxlRGlzY2FyZFBvbGljeX1cclxuICAgICAqIEByZWFkb25seVxyXG4gICAgICovXHJcbiAgICBnZXQgdGlsZURpc2NhcmRQb2xpY3koKSB7XHJcbiAgICAgICAgICAgIC8vPj5pbmNsdWRlU3RhcnQoJ2RlYnVnJywgcHJhZ21hcy5kZWJ1Zyk7XHJcbiAgICAgICAgICAgIGlmICghdGhpcy5fcmVhZHkpIHtcclxuICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRGV2ZWxvcGVyRXJyb3IoJ3RpbGVEaXNjYXJkUG9saWN5IG11c3Qgbm90IGJlIGNhbGxlZCBiZWZvcmUgdGhlIGltYWdlcnkgcHJvdmlkZXIgaXMgcmVhZHkuJyk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgLy8+PmluY2x1ZGVFbmQoJ2RlYnVnJyk7XHJcblxyXG4gICAgICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xyXG4gICAgfSxcclxuXHJcbiAgICAvKipcclxuICAgICAqIEdldHMgYW4gZXZlbnQgdGhhdCBpcyByYWlzZWQgd2hlbiB0aGUgaW1hZ2VyeSBwcm92aWRlciBlbmNvdW50ZXJzIGFuIGFzeW5jaHJvbm91cyBlcnJvci4gIEJ5IHN1YnNjcmliaW5nXHJcbiAgICAgKiB0byB0aGUgZXZlbnQsIHlvdSB3aWxsIGJlIG5vdGlmaWVkIG9mIHRoZSBlcnJvciBhbmQgY2FuIHBvdGVudGlhbGx5IHJlY292ZXIgZnJvbSBpdC4gIEV2ZW50IGxpc3RlbmVyc1xyXG4gICAgICogYXJlIHBhc3NlZCBhbiBpbnN0YW5jZSBvZiB7QGxpbmsgVGlsZVByb3ZpZGVyRXJyb3J9LlxyXG4gICAgICogQG1lbWJlcm9mIENhbnZhc0ltYWdlcnlQcm92aWRlci5wcm90b3R5cGVcclxuICAgICAqIEB0eXBlIHtFdmVudH1cclxuICAgICAqIEByZWFkb25seVxyXG4gICAgICovXHJcbiAgICBnZXQgZXJyb3JFdmVudCgpIHtcclxuICAgICAgICAgICAgcmV0dXJuIHRoaXMuX2Vycm9yRXZlbnQ7XHJcbiAgICB9LFxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2V0cyBhIHZhbHVlIGluZGljYXRpbmcgd2hldGhlciBvciBub3QgdGhlIHByb3ZpZGVyIGlzIHJlYWR5IGZvciB1c2UuXHJcbiAgICAgKiBAbWVtYmVyb2YgQ2FudmFzSW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZVxyXG4gICAgICogQHR5cGUge0Jvb2xlYW59XHJcbiAgICAgKiBAcmVhZG9ubHlcclxuICAgICAqL1xyXG4gICAgZ2V0IHJlYWR5KCkge1xyXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5fcmVhZHk7XHJcbiAgICB9LFxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2V0cyB0aGUgY3JlZGl0IHRvIGRpc3BsYXkgd2hlbiB0aGlzIGltYWdlcnkgcHJvdmlkZXIgaXMgYWN0aXZlLiAgVHlwaWNhbGx5IHRoaXMgaXMgdXNlZCB0byBjcmVkaXRcclxuICAgICAqIHRoZSBzb3VyY2Ugb2YgdGhlIGltYWdlcnkuICBUaGlzIGZ1bmN0aW9uIHNob3VsZCBub3QgYmUgY2FsbGVkIGJlZm9yZSB7QGxpbmsgQ2FudmFzSW1hZ2VyeVByb3ZpZGVyI3JlYWR5fSByZXR1cm5zIHRydWUuXHJcbiAgICAgKiBAbWVtYmVyb2YgQ2FudmFzSW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZVxyXG4gICAgICogQHR5cGUge0NyZWRpdH1cclxuICAgICAqIEByZWFkb25seVxyXG4gICAgICovXHJcbiAgICBnZXQgY3JlZGl0KCkge1xyXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5fY3JlZGl0O1xyXG4gICAgfSxcclxuXHJcbiAgICAvKipcclxuICAgICAqIEdldHMgYSB2YWx1ZSBpbmRpY2F0aW5nIHdoZXRoZXIgb3Igbm90IHRoZSBpbWFnZXMgcHJvdmlkZWQgYnkgdGhpcyBpbWFnZXJ5IHByb3ZpZGVyXHJcbiAgICAgKiBpbmNsdWRlIGFuIGFscGhhIGNoYW5uZWwuICBJZiB0aGlzIHByb3BlcnR5IGlzIGZhbHNlLCBhbiBhbHBoYSBjaGFubmVsLCBpZiBwcmVzZW50LCB3aWxsXHJcbiAgICAgKiBiZSBpZ25vcmVkLiAgSWYgdGhpcyBwcm9wZXJ0eSBpcyB0cnVlLCBhbnkgaW1hZ2VzIHdpdGhvdXQgYW4gYWxwaGEgY2hhbm5lbCB3aWxsIGJlIHRyZWF0ZWRcclxuICAgICAqIGFzIGlmIHRoZWlyIGFscGhhIGlzIDEuMCBldmVyeXdoZXJlLiAgV2hlbiB0aGlzIHByb3BlcnR5IGlzIGZhbHNlLCBtZW1vcnkgdXNhZ2VcclxuICAgICAqIGFuZCB0ZXh0dXJlIHVwbG9hZCB0aW1lIGFyZSByZWR1Y2VkLlxyXG4gICAgICogQG1lbWJlcm9mIENhbnZhc0ltYWdlcnlQcm92aWRlci5wcm90b3R5cGVcclxuICAgICAqIEB0eXBlIHtCb29sZWFufVxyXG4gICAgICogQHJlYWRvbmx5XHJcbiAgICAgKi9cclxuICAgIGdldCBoYXNBbHBoYUNoYW5uZWwoKSB7XHJcbiAgICAgICAgICAgIHJldHVybiB0cnVlO1xyXG4gICAgfVxyXG59O1xyXG5cclxuQ2FudmFzSW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5zZXRSZWN0YW5nbGUgPSBmdW5jdGlvbiBzZXRSZWN0YW5nbGUocmVjdGFuZ2xlKSB7XHJcbiAgICBcclxuICAgIHRoaXMuX3RpbGluZ1NjaGVtZSA9IG5ldyBDZXNpdW0uR2VvZ3JhcGhpY1RpbGluZ1NjaGVtZSh7XHJcbiAgICAgICAgcmVjdGFuZ2xlOiByZWN0YW5nbGUsXHJcbiAgICAgICAgbnVtYmVyT2ZMZXZlbFplcm9UaWxlc1g6IDEsXHJcbiAgICAgICAgbnVtYmVyT2ZMZXZlbFplcm9UaWxlc1k6IDFcclxuICAgIH0pO1xyXG4gICAgXHJcbiAgICBpZiAoIXRoaXMuX3JlYWR5KSB7XHJcbiAgICAgICAgdGhpcy5fcmVhZHkgPSB0cnVlO1xyXG4gICAgICAgIENlc2l1bS5UaWxlUHJvdmlkZXJFcnJvci5oYW5kbGVTdWNjZXNzKHRoaXMuX2Vycm9yRXZlbnQpO1xyXG4gICAgfVxyXG59O1xyXG5cclxuQ2FudmFzSW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5nZXRUaWxlV2lkdGggPSBmdW5jdGlvbiBnZXRUaWxlV2lkdGgoKSB7XHJcbiAgICByZXR1cm4gdGhpcy50aWxlV2lkdGg7XHJcbn07XHJcblxyXG5DYW52YXNJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlLmdldFRpbGVIZWlnaHQgPSBmdW5jdGlvbiBnZXRUaWxlSGVpZ2h0KCkge1xyXG4gICAgcmV0dXJuIHRoaXMudGlsZUhlaWdodDtcclxufTtcclxuXHJcbkNhbnZhc0ltYWdlcnlQcm92aWRlci5wcm90b3R5cGUuZ2V0TWF4aW11bUxldmVsID0gZnVuY3Rpb24gZ2V0TWF4aW11bUxldmVsKCkge1xyXG4gICAgcmV0dXJuIHRoaXMubWF4aW11bUxldmVsO1xyXG59O1xyXG5cclxuQ2FudmFzSW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5nZXRNaW5pbXVtTGV2ZWwgPSBmdW5jdGlvbiBnZXRNaW5pbXVtTGV2ZWwoKSB7XHJcbiAgICByZXR1cm4gdGhpcy5taW5pbXVtTGV2ZWw7XHJcbn07XHJcblxyXG5DYW52YXNJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlLmlzUmVhZHkgPSBmdW5jdGlvbiBpc1JlYWR5KCkge1xyXG4gICAgcmV0dXJuIHRoaXMucmVhZHk7XHJcbn07XHJcblxyXG5DYW52YXNJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlLmdldENyZWRpdCA9IGZ1bmN0aW9uIGdldENyZWRpdCgpIHtcclxuICAgIHJldHVybiB0aGlzLmNyZWRpdDtcclxufTtcclxuXHJcbkNhbnZhc0ltYWdlcnlQcm92aWRlci5wcm90b3R5cGUuZ2V0UmVjdGFuZ2xlID0gZnVuY3Rpb24gZ2V0UmVjdGFuZ2xlKCkge1xyXG4gICAgcmV0dXJuIHRoaXMudGlsaW5nU2NoZW1lLnJlY3RhbmdsZTtcclxufTtcclxuXHJcbkNhbnZhc0ltYWdlcnlQcm92aWRlci5wcm90b3R5cGUuZ2V0VGlsaW5nU2NoZW1lID0gZnVuY3Rpb24gZ2V0VGlsaW5nU2NoZW1lKCkge1xyXG4gICAgcmV0dXJuIHRoaXMudGlsaW5nU2NoZW1lO1xyXG59O1xyXG5cclxuQ2FudmFzSW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5nZXRUaWxlRGlzY2FyZFBvbGljeSA9IGZ1bmN0aW9uIGdldFRpbGVEaXNjYXJkUG9saWN5KCkge1xyXG4gICAgcmV0dXJuIHRoaXMudGlsZURpc2NhcmRQb2xpY3k7XHJcbn07XHJcblxyXG5DYW52YXNJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlLmdldEVycm9yRXZlbnQgPSBmdW5jdGlvbiBnZXRFcnJvckV2ZW50KCkge1xyXG4gICAgcmV0dXJuIHRoaXMuZXJyb3JFdmVudDtcclxufTtcclxuXHJcbkNhbnZhc0ltYWdlcnlQcm92aWRlci5wcm90b3R5cGUuZ2V0SGFzQWxwaGFDaGFubmVsID0gZnVuY3Rpb24gZ2V0SGFzQWxwaGFDaGFubmVsKCkge1xyXG4gICAgcmV0dXJuIHRoaXMuaGFzQWxwaGFDaGFubmVsO1xyXG59O1xyXG5cclxuLyoqXHJcbiAqIEdldHMgdGhlIGNyZWRpdHMgdG8gYmUgZGlzcGxheWVkIHdoZW4gYSBnaXZlbiB0aWxlIGlzIGRpc3BsYXllZC5cclxuICpcclxuICogQHBhcmFtIHtOdW1iZXJ9IHggVGhlIHRpbGUgWCBjb29yZGluYXRlLlxyXG4gKiBAcGFyYW0ge051bWJlcn0geSBUaGUgdGlsZSBZIGNvb3JkaW5hdGUuXHJcbiAqIEBwYXJhbSB7TnVtYmVyfSBsZXZlbCBUaGUgdGlsZSBsZXZlbDtcclxuICogQHJldHVybnMge0NyZWRpdFtdfSBUaGUgY3JlZGl0cyB0byBiZSBkaXNwbGF5ZWQgd2hlbiB0aGUgdGlsZSBpcyBkaXNwbGF5ZWQuXHJcbiAqXHJcbiAqIEBleGNlcHRpb24ge0RldmVsb3BlckVycm9yfSA8Y29kZT5nZXRUaWxlQ3JlZGl0czwvY29kZT4gbXVzdCBub3QgYmUgY2FsbGVkIGJlZm9yZSB0aGUgaW1hZ2VyeSBwcm92aWRlciBpcyByZWFkeS5cclxuICovXHJcbkNhbnZhc0ltYWdlcnlQcm92aWRlci5wcm90b3R5cGUuZ2V0VGlsZUNyZWRpdHMgPSBmdW5jdGlvbih4LCB5LCBsZXZlbCkge1xyXG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcclxufTtcclxuXHJcbi8qKlxyXG4gKiBSZXF1ZXN0cyB0aGUgaW1hZ2UgZm9yIGEgZ2l2ZW4gdGlsZS4gIFRoaXMgZnVuY3Rpb24gc2hvdWxkXHJcbiAqIG5vdCBiZSBjYWxsZWQgYmVmb3JlIHtAbGluayBDYW52YXNJbWFnZXJ5UHJvdmlkZXIjcmVhZHl9IHJldHVybnMgdHJ1ZS5cclxuICpcclxuICogQHBhcmFtIHtOdW1iZXJ9IHggVGhlIHRpbGUgWCBjb29yZGluYXRlLlxyXG4gKiBAcGFyYW0ge051bWJlcn0geSBUaGUgdGlsZSBZIGNvb3JkaW5hdGUuXHJcbiAqIEBwYXJhbSB7TnVtYmVyfSBsZXZlbCBUaGUgdGlsZSBsZXZlbC5cclxuICogQHJldHVybnMge1Byb21pc2V9IEEgcHJvbWlzZSBmb3IgdGhlIGltYWdlIHRoYXQgd2lsbCByZXNvbHZlIHdoZW4gdGhlIGltYWdlIGlzIGF2YWlsYWJsZSwgb3JcclxuICogICAgICAgICAgdW5kZWZpbmVkIGlmIHRoZXJlIGFyZSB0b28gbWFueSBhY3RpdmUgcmVxdWVzdHMgdG8gdGhlIHNlcnZlciwgYW5kIHRoZSByZXF1ZXN0XHJcbiAqICAgICAgICAgIHNob3VsZCBiZSByZXRyaWVkIGxhdGVyLiAgVGhlIHJlc29sdmVkIGltYWdlIG1heSBiZSBlaXRoZXIgYW5cclxuICogICAgICAgICAgSW1hZ2Ugb3IgYSBDYW52YXMgRE9NIG9iamVjdC5cclxuICpcclxuICogQGV4Y2VwdGlvbiB7RGV2ZWxvcGVyRXJyb3J9IDxjb2RlPnJlcXVlc3RJbWFnZTwvY29kZT4gbXVzdCBub3QgYmUgY2FsbGVkIGJlZm9yZSB0aGUgaW1hZ2VyeSBwcm92aWRlciBpcyByZWFkeS5cclxuICovXHJcbkNhbnZhc0ltYWdlcnlQcm92aWRlci5wcm90b3R5cGUucmVxdWVzdEltYWdlID0gZnVuY3Rpb24oeCwgeSwgbGV2ZWwpIHtcclxuICAgIC8vPj5pbmNsdWRlU3RhcnQoJ2RlYnVnJywgcHJhZ21hcy5kZWJ1Zyk7XHJcbiAgICBpZiAoIXRoaXMuX3JlYWR5KSB7XHJcbiAgICAgICAgICAgIHRocm93IG5ldyBEZXZlbG9wZXJFcnJvcigncmVxdWVzdEltYWdlIG11c3Qgbm90IGJlIGNhbGxlZCBiZWZvcmUgdGhlIGltYWdlcnkgcHJvdmlkZXIgaXMgcmVhZHkuJyk7XHJcbiAgICB9XHJcbiAgICAvLz4+aW5jbHVkZUVuZCgnZGVidWcnKTtcclxuXHJcbiAgICByZXR1cm4gdGhpcy5fY2FudmFzO1xyXG59O1xyXG5cclxuLyoqXHJcbiAqIFBpY2tpbmcgZmVhdHVyZXMgaXMgbm90IGN1cnJlbnRseSBzdXBwb3J0ZWQgYnkgdGhpcyBpbWFnZXJ5IHByb3ZpZGVyLCBzbyB0aGlzIGZ1bmN0aW9uIHNpbXBseSByZXR1cm5zXHJcbiAqIHVuZGVmaW5lZC5cclxuICpcclxuICogQHBhcmFtIHtOdW1iZXJ9IHggVGhlIHRpbGUgWCBjb29yZGluYXRlLlxyXG4gKiBAcGFyYW0ge051bWJlcn0geSBUaGUgdGlsZSBZIGNvb3JkaW5hdGUuXHJcbiAqIEBwYXJhbSB7TnVtYmVyfSBsZXZlbCBUaGUgdGlsZSBsZXZlbC5cclxuICogQHBhcmFtIHtOdW1iZXJ9IGxvbmdpdHVkZSBUaGUgbG9uZ2l0dWRlIGF0IHdoaWNoIHRvIHBpY2sgZmVhdHVyZXMuXHJcbiAqIEBwYXJhbSB7TnVtYmVyfSBsYXRpdHVkZSAgVGhlIGxhdGl0dWRlIGF0IHdoaWNoIHRvIHBpY2sgZmVhdHVyZXMuXHJcbiAqIEByZXR1cm4ge1Byb21pc2V9IEEgcHJvbWlzZSBmb3IgdGhlIHBpY2tlZCBmZWF0dXJlcyB0aGF0IHdpbGwgcmVzb2x2ZSB3aGVuIHRoZSBhc3luY2hyb25vdXNcclxuICogICAgICAgICAgICAgICAgICAgcGlja2luZyBjb21wbGV0ZXMuICBUaGUgcmVzb2x2ZWQgdmFsdWUgaXMgYW4gYXJyYXkgb2Yge0BsaW5rIEltYWdlcnlMYXllckZlYXR1cmVJbmZvfVxyXG4gKiAgICAgICAgICAgICAgICAgICBpbnN0YW5jZXMuICBUaGUgYXJyYXkgbWF5IGJlIGVtcHR5IGlmIG5vIGZlYXR1cmVzIGFyZSBmb3VuZCBhdCB0aGUgZ2l2ZW4gbG9jYXRpb24uXHJcbiAqICAgICAgICAgICAgICAgICAgIEl0IG1heSBhbHNvIGJlIHVuZGVmaW5lZCBpZiBwaWNraW5nIGlzIG5vdCBzdXBwb3J0ZWQuXHJcbiAqL1xyXG5DYW52YXNJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlLnBpY2tGZWF0dXJlcyA9IGZ1bmN0aW9uKCkge1xyXG4gICAgICAgIHJldHVybiB1bmRlZmluZWQ7XHJcbn07IiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBJbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXI7XHJcblxyXG52YXIgV29ya2VyUHJveHlJbWFnZURlY29kZXIgPSByZXF1aXJlKCd3b3JrZXJwcm94eWltYWdlZGVjb2Rlci5qcycpO1xyXG52YXIgY2FsY3VsYXRlQ2VzaXVtRnJ1c3R1bSA9IHJlcXVpcmUoJ19jZXNpdW1mcnVzdHVtY2FsY3VsYXRvci5qcycpO1xyXG52YXIgaW1hZ2VIZWxwZXJGdW5jdGlvbnMgPSByZXF1aXJlKCdpbWFnZWhlbHBlcmZ1bmN0aW9ucy5qcycpO1xyXG5cclxuLyogZ2xvYmFsIENlc2l1bTogZmFsc2UgKi9cclxuLyogZ2xvYmFsIERldmVsb3BlckVycm9yOiBmYWxzZSAqL1xyXG4vKiBnbG9iYWwgQ3JlZGl0OiBmYWxzZSAqL1xyXG4vKiBnbG9iYWwgUHJvbWlzZTogZmFsc2UgKi9cclxuXHJcbi8qKlxyXG4gKiBQcm92aWRlcyBhIEltYWdlRGVjb2RlciBjbGllbnQgaW1hZ2VyeSB0aWxlLiAgVGhlIGltYWdlIGlzIGFzc3VtZWQgdG8gdXNlIGFcclxuICoge0BsaW5rIEdlb2dyYXBoaWNUaWxpbmdTY2hlbWV9LlxyXG4gKlxyXG4gKiBAYWxpYXMgSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyXHJcbiAqIEBjb25zdHJ1Y3RvclxyXG4gKlxyXG4gKiBAcGFyYW0ge09iamVjdH0gb3B0aW9ucyBPYmplY3Qgd2l0aCB0aGUgZm9sbG93aW5nIHByb3BlcnRpZXM6XHJcbiAqIEBwYXJhbSB7U3RyaW5nfSBvcHRpb25zLnVybCBUaGUgdXJsIGZvciB0aGUgdGlsZS5cclxuICogQHBhcmFtIHtSZWN0YW5nbGV9IFtvcHRpb25zLnJlY3RhbmdsZT1SZWN0YW5nbGUuTUFYX1ZBTFVFXSBUaGUgcmVjdGFuZ2xlLCBpbiByYWRpYW5zLCBjb3ZlcmVkIGJ5IHRoZSBpbWFnZS5cclxuICogQHBhcmFtIHtDcmVkaXR8U3RyaW5nfSBbb3B0aW9ucy5jcmVkaXRdIEEgY3JlZGl0IGZvciB0aGUgZGF0YSBzb3VyY2UsIHdoaWNoIGlzIGRpc3BsYXllZCBvbiB0aGUgY2FudmFzLlxyXG4gKiBAcGFyYW0ge09iamVjdH0gW29wdGlvbnMucHJveHldIEEgcHJveHkgdG8gdXNlIGZvciByZXF1ZXN0cy4gVGhpcyBvYmplY3QgaXMgZXhwZWN0ZWQgdG8gaGF2ZSBhIGdldFVSTCBmdW5jdGlvbiB3aGljaCByZXR1cm5zIHRoZSBwcm94aWVkIFVSTCwgaWYgbmVlZGVkLlxyXG4gKiBAcGFyYW0ge2Jvb2xlYW59IFtvcHRpb25zLmFkYXB0UHJvcG9ydGlvbnNdIGRldGVybWluZXMgaWYgdG8gYWRhcHQgdGhlIHByb3BvcnRpb25zIG9mIHRoZSByZWN0YW5nbGUgcHJvdmlkZWQgdG8gdGhlIGltYWdlIHBpeGVscyBwcm9wb3J0aW9ucy5cclxuICpcclxuICogQHNlZSBBcmNHaXNNYXBTZXJ2ZXJJbWFnZXJ5UHJvdmlkZXJcclxuICogQHNlZSBCaW5nTWFwc0ltYWdlcnlQcm92aWRlclxyXG4gKiBAc2VlIEdvb2dsZUVhcnRoSW1hZ2VyeVByb3ZpZGVyXHJcbiAqIEBzZWUgT3BlblN0cmVldE1hcEltYWdlcnlQcm92aWRlclxyXG4gKiBAc2VlIFRpbGVNYXBTZXJ2aWNlSW1hZ2VyeVByb3ZpZGVyXHJcbiAqIEBzZWUgV2ViTWFwU2VydmljZUltYWdlcnlQcm92aWRlclxyXG4gKi9cclxuZnVuY3Rpb24gSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyKGRlY29kZXIsIG9wdGlvbnMpIHtcclxuICAgIHZhciB1cmwgPSBvcHRpb25zLnVybDtcclxuICAgIHRoaXMuX2FkYXB0UHJvcG9ydGlvbnMgPSBvcHRpb25zLmFkYXB0UHJvcG9ydGlvbnM7XHJcbiAgICB0aGlzLl9yZWN0YW5nbGUgPSBvcHRpb25zLnJlY3RhbmdsZTtcclxuICAgIHRoaXMuX3Byb3h5ID0gb3B0aW9ucy5wcm94eTtcclxuICAgIHRoaXMuX3VwZGF0ZUZydXN0dW1JbnRlcnZhbCA9IDEwMDAgfHwgb3B0aW9ucy51cGRhdGVGcnVzdHVtSW50ZXJ2YWw7XHJcbiAgICB0aGlzLl9jcmVkaXQgPSBvcHRpb25zLmNyZWRpdDtcclxuICAgIFxyXG4gICAgaWYgKHR5cGVvZiB0aGlzLl9jcmVkaXQgPT09ICdzdHJpbmcnKSB7XHJcbiAgICAgICAgdGhpcy5fY3JlZGl0ID0gbmV3IENyZWRpdCh0aGlzLl9jcmVkaXQpO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBpZiAodGhpcy5fcmVjdGFuZ2xlID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICB0aGlzLl9yZWN0YW5nbGUgPSBDZXNpdW0uUmVjdGFuZ2xlLmZyb21EZWdyZWVzKC0xODAsIC05MCwgMTgwLCA5MCk7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGlmICh0aGlzLl9hZGFwdFByb3BvcnRpb25zID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICB0aGlzLl9hZGFwdFByb3BvcnRpb25zID0gdHJ1ZTtcclxuICAgIH1cclxuXHJcbiAgICBvcHRpb25zID0gSlNPTi5wYXJzZShKU09OLnN0cmluZ2lmeShvcHRpb25zIHx8IHt9KSk7XHJcbiAgICBvcHRpb25zLmNhcnRvZ3JhcGhpY0JvdW5kcyA9IHtcclxuICAgICAgICB3ZXN0OiB0aGlzLl9yZWN0YW5nbGUud2VzdCxcclxuICAgICAgICBlYXN0OiB0aGlzLl9yZWN0YW5nbGUuZWFzdCxcclxuICAgICAgICBzb3V0aDogdGhpcy5fcmVjdGFuZ2xlLnNvdXRoLFxyXG4gICAgICAgIG5vcnRoOiB0aGlzLl9yZWN0YW5nbGUubm9ydGhcclxuICAgIH07XHJcbiAgICBcclxuICAgIC8vPj5pbmNsdWRlU3RhcnQoJ2RlYnVnJywgcHJhZ21hcy5kZWJ1Zyk7XHJcbiAgICBpZiAodXJsID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICAgICAgdGhyb3cgbmV3IERldmVsb3BlckVycm9yKCd1cmwgaXMgcmVxdWlyZWQuJyk7XHJcbiAgICB9XHJcbiAgICAvLz4+aW5jbHVkZUVuZCgnZGVidWcnKTtcclxuXHJcbiAgICB0aGlzLl91cmwgPSB1cmw7XHJcblxyXG4gICAgdGhpcy5fdGlsaW5nU2NoZW1lID0gdW5kZWZpbmVkO1xyXG5cclxuICAgIHRoaXMuX3RpbGVXaWR0aCA9IDA7XHJcbiAgICB0aGlzLl90aWxlSGVpZ2h0ID0gMDtcclxuXHJcbiAgICB0aGlzLl9lcnJvckV2ZW50ID0gbmV3IEV2ZW50KCdJbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXJTdGF0dXMnKTtcclxuXHJcbiAgICB0aGlzLl9yZWFkeSA9IGZhbHNlO1xyXG4gICAgdGhpcy5fZXhjZXB0aW9uQ2FsbGJhY2sgPSBudWxsO1xyXG4gICAgdGhpcy5fY2VzaXVtV2lkZ2V0ID0gbnVsbDtcclxuICAgIHRoaXMuX3VwZGF0ZUZydXN0dW1JbnRlcnZhbEhhbmRsZSA9IG51bGw7XHJcbiAgICBcclxuXHJcbiAgICB2YXIgaW1hZ2VVcmwgPSB1cmw7XHJcbiAgICBpZiAodGhpcy5fcHJveHkgIT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIC8vIE5PVEU6IElzIHRoYXQgdGhlIGNvcnJlY3QgbG9naWM/XHJcbiAgICAgICAgaW1hZ2VVcmwgPSB0aGlzLl9wcm94eS5nZXRVUkwoaW1hZ2VVcmwpO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICB0aGlzLl9kZWNvZGVyID0gZGVjb2RlcjtcclxuXHR0aGlzLl9pbWFnZSA9IGRlY29kZXIuZ2V0SW1hZ2UoKTtcclxuXHJcbiAgICAvKlxyXG4gICAgdGhpcy5fZGVjb2RlciA9IG5ldyBXb3JrZXJQcm94eUltYWdlRGVjb2RlcihpbWFnZUltcGxlbWVudGF0aW9uQ2xhc3NOYW1lLCB7XHJcbiAgICAgICAgc2VydmVyUmVxdWVzdFByaW9yaXRpemVyOiAnZnJ1c3R1bScsXHJcbiAgICAgICAgZGVjb2RlUHJpb3JpdGl6ZXI6ICdmcnVzdHVtJ1xyXG4gICAgfSk7Ki9cclxuXHJcbiAgICB0aGlzLl91cmwgPSBpbWFnZVVybDtcclxufVxyXG5cclxuSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZSA9IHtcclxuICAgIC8qKlxyXG4gICAgICogR2V0cyB0aGUgVVJMIG9mIHRoZSBJbWFnZURlY29kZXIgc2VydmVyIChpbmNsdWRpbmcgdGFyZ2V0KS5cclxuICAgICAqIEBtZW1iZXJvZiBJbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlXHJcbiAgICAgKiBAdHlwZSB7U3RyaW5nfVxyXG4gICAgICogQHJlYWRvbmx5XHJcbiAgICAgKi9cclxuICAgIGdldCB1cmwoKSB7XHJcbiAgICAgICAgcmV0dXJuIHRoaXMuX3VybDtcclxuICAgIH0sXHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZXRzIHRoZSBwcm94eSB1c2VkIGJ5IHRoaXMgcHJvdmlkZXIuXHJcbiAgICAgKiBAbWVtYmVyb2YgSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZVxyXG4gICAgICogQHR5cGUge1Byb3h5fVxyXG4gICAgICogQHJlYWRvbmx5XHJcbiAgICAgKi9cclxuICAgIGdldCBwcm94eSgpIHtcclxuICAgICAgICByZXR1cm4gdGhpcy5fcHJveHk7XHJcbiAgICB9LFxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2V0cyB0aGUgd2lkdGggb2YgZWFjaCB0aWxlLCBpbiBwaXhlbHMuIFRoaXMgZnVuY3Rpb24gc2hvdWxkXHJcbiAgICAgKiBub3QgYmUgY2FsbGVkIGJlZm9yZSB7QGxpbmsgSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyI3JlYWR5fSByZXR1cm5zIHRydWUuXHJcbiAgICAgKiBAbWVtYmVyb2YgSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZVxyXG4gICAgICogQHR5cGUge051bWJlcn1cclxuICAgICAqIEByZWFkb25seVxyXG4gICAgICovXHJcbiAgICBnZXQgdGlsZVdpZHRoKCkge1xyXG4gICAgICAgIC8vPj5pbmNsdWRlU3RhcnQoJ2RlYnVnJywgcHJhZ21hcy5kZWJ1Zyk7XHJcbiAgICAgICAgaWYgKCF0aGlzLl9yZWFkeSkge1xyXG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IERldmVsb3BlckVycm9yKCd0aWxlV2lkdGggbXVzdCBub3QgYmUgY2FsbGVkIGJlZm9yZSB0aGUgaW1hZ2VyeSBwcm92aWRlciBpcyByZWFkeS4nKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgLy8+PmluY2x1ZGVFbmQoJ2RlYnVnJyk7XHJcblxyXG4gICAgICAgIHJldHVybiB0aGlzLl90aWxlV2lkdGg7XHJcbiAgICB9LFxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2V0cyB0aGUgaGVpZ2h0IG9mIGVhY2ggdGlsZSwgaW4gcGl4ZWxzLiAgVGhpcyBmdW5jdGlvbiBzaG91bGRcclxuICAgICAqIG5vdCBiZSBjYWxsZWQgYmVmb3JlIHtAbGluayBJbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIjcmVhZHl9IHJldHVybnMgdHJ1ZS5cclxuICAgICAqIEBtZW1iZXJvZiBJbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlXHJcbiAgICAgKiBAdHlwZSB7TnVtYmVyfVxyXG4gICAgICogQHJlYWRvbmx5XHJcbiAgICAgKi9cclxuICAgIGdldCB0aWxlSGVpZ2h0KCkge1xyXG4gICAgICAgIC8vPj5pbmNsdWRlU3RhcnQoJ2RlYnVnJywgcHJhZ21hcy5kZWJ1Zyk7XHJcbiAgICAgICAgaWYgKCF0aGlzLl9yZWFkeSkge1xyXG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IERldmVsb3BlckVycm9yKCd0aWxlSGVpZ2h0IG11c3Qgbm90IGJlIGNhbGxlZCBiZWZvcmUgdGhlIGltYWdlcnkgcHJvdmlkZXIgaXMgcmVhZHkuJyk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIC8vPj5pbmNsdWRlRW5kKCdkZWJ1ZycpO1xyXG5cclxuICAgICAgICByZXR1cm4gdGhpcy5fdGlsZUhlaWdodDtcclxuICAgIH0sXHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZXRzIHRoZSBtYXhpbXVtIGxldmVsLW9mLWRldGFpbCB0aGF0IGNhbiBiZSByZXF1ZXN0ZWQuICBUaGlzIGZ1bmN0aW9uIHNob3VsZFxyXG4gICAgICogbm90IGJlIGNhbGxlZCBiZWZvcmUge0BsaW5rIEltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlciNyZWFkeX0gcmV0dXJucyB0cnVlLlxyXG4gICAgICogQG1lbWJlcm9mIEltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlci5wcm90b3R5cGVcclxuICAgICAqIEB0eXBlIHtOdW1iZXJ9XHJcbiAgICAgKiBAcmVhZG9ubHlcclxuICAgICAqL1xyXG4gICAgZ2V0IG1heGltdW1MZXZlbCgpIHtcclxuICAgICAgICAvLz4+aW5jbHVkZVN0YXJ0KCdkZWJ1ZycsIHByYWdtYXMuZGVidWcpO1xyXG4gICAgICAgIGlmICghdGhpcy5fcmVhZHkpIHtcclxuICAgICAgICAgICAgICAgIHRocm93IG5ldyBEZXZlbG9wZXJFcnJvcignbWF4aW11bUxldmVsIG11c3Qgbm90IGJlIGNhbGxlZCBiZWZvcmUgdGhlIGltYWdlcnkgcHJvdmlkZXIgaXMgcmVhZHkuJyk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIC8vPj5pbmNsdWRlRW5kKCdkZWJ1ZycpO1xyXG5cclxuICAgICAgICByZXR1cm4gdGhpcy5fbnVtUmVzb2x1dGlvbkxldmVscyAtIDE7XHJcbiAgICB9LFxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2V0cyB0aGUgbWluaW11bSBsZXZlbC1vZi1kZXRhaWwgdGhhdCBjYW4gYmUgcmVxdWVzdGVkLiAgVGhpcyBmdW5jdGlvbiBzaG91bGRcclxuICAgICAqIG5vdCBiZSBjYWxsZWQgYmVmb3JlIHtAbGluayBJbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIjcmVhZHl9IHJldHVybnMgdHJ1ZS5cclxuICAgICAqIEBtZW1iZXJvZiBJbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlXHJcbiAgICAgKiBAdHlwZSB7TnVtYmVyfVxyXG4gICAgICogQHJlYWRvbmx5XHJcbiAgICAgKi9cclxuICAgIGdldCBtaW5pbXVtTGV2ZWwoKSB7XHJcbiAgICAgICAgLy8+PmluY2x1ZGVTdGFydCgnZGVidWcnLCBwcmFnbWFzLmRlYnVnKTtcclxuICAgICAgICBpZiAoIXRoaXMuX3JlYWR5KSB7XHJcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRGV2ZWxvcGVyRXJyb3IoJ21pbmltdW1MZXZlbCBtdXN0IG5vdCBiZSBjYWxsZWQgYmVmb3JlIHRoZSBpbWFnZXJ5IHByb3ZpZGVyIGlzIHJlYWR5LicpO1xyXG4gICAgICAgIH1cclxuICAgICAgICAvLz4+aW5jbHVkZUVuZCgnZGVidWcnKTtcclxuXHJcbiAgICAgICAgcmV0dXJuIDA7XHJcbiAgICB9LFxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2V0cyB0aGUgdGlsaW5nIHNjaGVtZSB1c2VkIGJ5IHRoaXMgcHJvdmlkZXIuICBUaGlzIGZ1bmN0aW9uIHNob3VsZFxyXG4gICAgICogbm90IGJlIGNhbGxlZCBiZWZvcmUge0BsaW5rIEltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlciNyZWFkeX0gcmV0dXJucyB0cnVlLlxyXG4gICAgICogQG1lbWJlcm9mIEltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlci5wcm90b3R5cGVcclxuICAgICAqIEB0eXBlIHtUaWxpbmdTY2hlbWV9XHJcbiAgICAgKiBAcmVhZG9ubHlcclxuICAgICAqL1xyXG4gICAgZ2V0IHRpbGluZ1NjaGVtZSgpIHtcclxuICAgICAgICAvLz4+aW5jbHVkZVN0YXJ0KCdkZWJ1ZycsIHByYWdtYXMuZGVidWcpO1xyXG4gICAgICAgIGlmICghdGhpcy5fcmVhZHkpIHtcclxuICAgICAgICAgICAgdGhyb3cgbmV3IERldmVsb3BlckVycm9yKCd0aWxpbmdTY2hlbWUgbXVzdCBub3QgYmUgY2FsbGVkIGJlZm9yZSB0aGUgaW1hZ2VyeSBwcm92aWRlciBpcyByZWFkeS4nKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgLy8+PmluY2x1ZGVFbmQoJ2RlYnVnJyk7XHJcblxyXG4gICAgICAgIHJldHVybiB0aGlzLl90aWxpbmdTY2hlbWU7XHJcbiAgICB9LFxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2V0cyB0aGUgcmVjdGFuZ2xlLCBpbiByYWRpYW5zLCBvZiB0aGUgaW1hZ2VyeSBwcm92aWRlZCBieSB0aGlzIGluc3RhbmNlLiAgVGhpcyBmdW5jdGlvbiBzaG91bGRcclxuICAgICAqIG5vdCBiZSBjYWxsZWQgYmVmb3JlIHtAbGluayBJbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIjcmVhZHl9IHJldHVybnMgdHJ1ZS5cclxuICAgICAqIEBtZW1iZXJvZiBJbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlXHJcbiAgICAgKiBAdHlwZSB7UmVjdGFuZ2xlfVxyXG4gICAgICogQHJlYWRvbmx5XHJcbiAgICAgKi9cclxuICAgIGdldCByZWN0YW5nbGUoKSB7XHJcbiAgICAgICAgcmV0dXJuIHRoaXMuX3RpbGluZ1NjaGVtZS5yZWN0YW5nbGU7XHJcbiAgICB9LFxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2V0cyB0aGUgdGlsZSBkaXNjYXJkIHBvbGljeS4gIElmIG5vdCB1bmRlZmluZWQsIHRoZSBkaXNjYXJkIHBvbGljeSBpcyByZXNwb25zaWJsZVxyXG4gICAgICogZm9yIGZpbHRlcmluZyBvdXQgXCJtaXNzaW5nXCIgdGlsZXMgdmlhIGl0cyBzaG91bGREaXNjYXJkSW1hZ2UgZnVuY3Rpb24uICBJZiB0aGlzIGZ1bmN0aW9uXHJcbiAgICAgKiByZXR1cm5zIHVuZGVmaW5lZCwgbm8gdGlsZXMgYXJlIGZpbHRlcmVkLiAgVGhpcyBmdW5jdGlvbiBzaG91bGRcclxuICAgICAqIG5vdCBiZSBjYWxsZWQgYmVmb3JlIHtAbGluayBJbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIjcmVhZHl9IHJldHVybnMgdHJ1ZS5cclxuICAgICAqIEBtZW1iZXJvZiBJbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlXHJcbiAgICAgKiBAdHlwZSB7VGlsZURpc2NhcmRQb2xpY3l9XHJcbiAgICAgKiBAcmVhZG9ubHlcclxuICAgICAqL1xyXG4gICAgZ2V0IHRpbGVEaXNjYXJkUG9saWN5KCkge1xyXG4gICAgICAgIC8vPj5pbmNsdWRlU3RhcnQoJ2RlYnVnJywgcHJhZ21hcy5kZWJ1Zyk7XHJcbiAgICAgICAgaWYgKCF0aGlzLl9yZWFkeSkge1xyXG4gICAgICAgICAgICB0aHJvdyBuZXcgRGV2ZWxvcGVyRXJyb3IoJ3RpbGVEaXNjYXJkUG9saWN5IG11c3Qgbm90IGJlIGNhbGxlZCBiZWZvcmUgdGhlIGltYWdlcnkgcHJvdmlkZXIgaXMgcmVhZHkuJyk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIC8vPj5pbmNsdWRlRW5kKCdkZWJ1ZycpO1xyXG5cclxuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xyXG4gICAgfSxcclxuXHJcbiAgICAvKipcclxuICAgICAqIEdldHMgYW4gZXZlbnQgdGhhdCBpcyByYWlzZWQgd2hlbiB0aGUgaW1hZ2VyeSBwcm92aWRlciBlbmNvdW50ZXJzIGFuIGFzeW5jaHJvbm91cyBlcnJvci4gIEJ5IHN1YnNjcmliaW5nXHJcbiAgICAgKiB0byB0aGUgZXZlbnQsIHlvdSB3aWxsIGJlIG5vdGlmaWVkIG9mIHRoZSBlcnJvciBhbmQgY2FuIHBvdGVudGlhbGx5IHJlY292ZXIgZnJvbSBpdC4gIEV2ZW50IGxpc3RlbmVyc1xyXG4gICAgICogYXJlIHBhc3NlZCBhbiBpbnN0YW5jZSBvZiB7QGxpbmsgVGlsZVByb3ZpZGVyRXJyb3J9LlxyXG4gICAgICogQG1lbWJlcm9mIEltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlci5wcm90b3R5cGVcclxuICAgICAqIEB0eXBlIHtFdmVudH1cclxuICAgICAqIEByZWFkb25seVxyXG4gICAgICovXHJcbiAgICBnZXQgZXJyb3JFdmVudCgpIHtcclxuICAgICAgICByZXR1cm4gdGhpcy5fZXJyb3JFdmVudDtcclxuICAgIH0sXHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZXRzIGEgdmFsdWUgaW5kaWNhdGluZyB3aGV0aGVyIG9yIG5vdCB0aGUgcHJvdmlkZXIgaXMgcmVhZHkgZm9yIHVzZS5cclxuICAgICAqIEBtZW1iZXJvZiBJbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlXHJcbiAgICAgKiBAdHlwZSB7Qm9vbGVhbn1cclxuICAgICAqIEByZWFkb25seVxyXG4gICAgICovXHJcbiAgICBnZXQgcmVhZHkoKSB7XHJcbiAgICAgICAgcmV0dXJuIHRoaXMuX3JlYWR5O1xyXG4gICAgfSxcclxuXHJcbiAgICAvKipcclxuICAgICAqIEdldHMgdGhlIGNyZWRpdCB0byBkaXNwbGF5IHdoZW4gdGhpcyBpbWFnZXJ5IHByb3ZpZGVyIGlzIGFjdGl2ZS4gIFR5cGljYWxseSB0aGlzIGlzIHVzZWQgdG8gY3JlZGl0XHJcbiAgICAgKiB0aGUgc291cmNlIG9mIHRoZSBpbWFnZXJ5LiAgVGhpcyBmdW5jdGlvbiBzaG91bGQgbm90IGJlIGNhbGxlZCBiZWZvcmUge0BsaW5rIEltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlciNyZWFkeX0gcmV0dXJucyB0cnVlLlxyXG4gICAgICogQG1lbWJlcm9mIEltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlci5wcm90b3R5cGVcclxuICAgICAqIEB0eXBlIHtDcmVkaXR9XHJcbiAgICAgKiBAcmVhZG9ubHlcclxuICAgICAqL1xyXG4gICAgZ2V0IGNyZWRpdCgpIHtcclxuICAgICAgICByZXR1cm4gdGhpcy5fY3JlZGl0O1xyXG4gICAgfSxcclxuXHJcbiAgICAvKipcclxuICAgICAqIEdldHMgYSB2YWx1ZSBpbmRpY2F0aW5nIHdoZXRoZXIgb3Igbm90IHRoZSBpbWFnZXMgcHJvdmlkZWQgYnkgdGhpcyBpbWFnZXJ5IHByb3ZpZGVyXHJcbiAgICAgKiBpbmNsdWRlIGFuIGFscGhhIGNoYW5uZWwuICBJZiB0aGlzIHByb3BlcnR5IGlzIGZhbHNlLCBhbiBhbHBoYSBjaGFubmVsLCBpZiBwcmVzZW50LCB3aWxsXHJcbiAgICAgKiBiZSBpZ25vcmVkLiAgSWYgdGhpcyBwcm9wZXJ0eSBpcyB0cnVlLCBhbnkgaW1hZ2VzIHdpdGhvdXQgYW4gYWxwaGEgY2hhbm5lbCB3aWxsIGJlIHRyZWF0ZWRcclxuICAgICAqIGFzIGlmIHRoZWlyIGFscGhhIGlzIDEuMCBldmVyeXdoZXJlLiAgV2hlbiB0aGlzIHByb3BlcnR5IGlzIGZhbHNlLCBtZW1vcnkgdXNhZ2VcclxuICAgICAqIGFuZCB0ZXh0dXJlIHVwbG9hZCB0aW1lIGFyZSByZWR1Y2VkLlxyXG4gICAgICogQG1lbWJlcm9mIEltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlci5wcm90b3R5cGVcclxuICAgICAqIEB0eXBlIHtCb29sZWFufVxyXG4gICAgICogQHJlYWRvbmx5XHJcbiAgICAgKi9cclxuICAgIGdldCBoYXNBbHBoYUNoYW5uZWwoKSB7XHJcbiAgICAgICAgcmV0dXJuIHRydWU7XHJcbiAgICB9XHJcbn07XHJcblxyXG5JbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlLnNldEV4Y2VwdGlvbkNhbGxiYWNrID1cclxuICAgIGZ1bmN0aW9uIHNldEV4Y2VwdGlvbkNhbGxiYWNrKGV4Y2VwdGlvbkNhbGxiYWNrKSB7XHJcbiAgICBcclxuICAgIHRoaXMuX2V4Y2VwdGlvbkNhbGxiYWNrID0gZXhjZXB0aW9uQ2FsbGJhY2s7XHJcbn07XHJcblxyXG5JbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlLm9wZW4gPSBmdW5jdGlvbiBvcGVuKHdpZGdldE9yVmlld2VyKSB7XHJcbiAgICBpZiAodGhpcy5fdXBkYXRlRnJ1c3R1bUludGVydmFsSGFuZGxlICE9PSBudWxsKSB7XHJcbiAgICAgICAgdGhyb3cgbmV3IERldmVsb3BlckVycm9yKCdDYW5ub3Qgc2V0IHR3byBwYXJlbnQgdmlld2Vycy4nKTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgaWYgKHdpZGdldE9yVmlld2VyID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICB0aHJvdyBuZXcgRGV2ZWxvcGVyRXJyb3IoJ3dpZGdldE9yVmlld2VyIHNob3VsZCBiZSBnaXZlbi4gSXQgaXMgJyArXHJcbiAgICAgICAgICAgICduZWVkZWQgZm9yIGZydXN0dW0gY2FsY3VsYXRpb24gZm9yIHRoZSBwcmlvcml0eSBtZWNoYW5pc20nKTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgdGhpcy5fZGVjb2Rlci5vcGVuKHRoaXMuX3VybClcclxuXHRcdC50aGVuKHRoaXMuX29wZW5lZC5iaW5kKHRoaXMpKVxyXG5cdFx0LmNhdGNoKHRoaXMuX29uRXhjZXB0aW9uLmJpbmQodGhpcykpO1xyXG4gICAgXHJcbiAgICB0aGlzLl9jZXNpdW1XaWRnZXQgPSB3aWRnZXRPclZpZXdlcjtcclxuICAgIFxyXG4gICAgdGhpcy5fdXBkYXRlRnJ1c3R1bUludGVydmFsSGFuZGxlID0gc2V0SW50ZXJ2YWwoXHJcbiAgICAgICAgdGhpcy5fc2V0UHJpb3JpdHlCeUZydXN0dW0uYmluZCh0aGlzKSxcclxuICAgICAgICB0aGlzLl91cGRhdGVGcnVzdHVtSW50ZXJ2YWwpO1xyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5jbG9zZSA9IGZ1bmN0aW9uIGNsb3NlKCkge1xyXG4gICAgY2xlYXJJbnRlcnZhbCh0aGlzLl91cGRhdGVGcnVzdHVtSW50ZXJ2YWxIYW5kbGUpO1xyXG4gICAgdGhpcy5fZGVjb2Rlci5jbG9zZSgpO1xyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5nZXRUaWxlV2lkdGggPSBmdW5jdGlvbiBnZXRUaWxlV2lkdGgoKSB7XHJcbiAgICByZXR1cm4gdGhpcy50aWxlV2lkdGg7XHJcbn07XHJcblxyXG5JbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlLmdldFRpbGVIZWlnaHQgPSBmdW5jdGlvbiBnZXRUaWxlSGVpZ2h0KCkge1xyXG4gICAgcmV0dXJuIHRoaXMudGlsZUhlaWdodDtcclxufTtcclxuXHJcbkltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlci5wcm90b3R5cGUuZ2V0TWF4aW11bUxldmVsID0gZnVuY3Rpb24gZ2V0TWF4aW11bUxldmVsKCkge1xyXG4gICAgcmV0dXJuIHRoaXMubWF4aW11bUxldmVsO1xyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5nZXRNaW5pbXVtTGV2ZWwgPSBmdW5jdGlvbiBnZXRNaW5pbXVtTGV2ZWwoKSB7XHJcbiAgICByZXR1cm4gdGhpcy5taW5pbXVtTGV2ZWw7XHJcbn07XHJcblxyXG5JbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlLmdldFVybCA9IGZ1bmN0aW9uIGdldFVybCgpIHtcclxuICAgIHJldHVybiB0aGlzLnVybDtcclxufTtcclxuXHJcbkltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlci5wcm90b3R5cGUuZ2V0UHJveHkgPSBmdW5jdGlvbiBnZXRQcm94eSgpIHtcclxuICAgIHJldHVybiB0aGlzLnByb3h5O1xyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5pc1JlYWR5ID0gZnVuY3Rpb24gaXNSZWFkeSgpIHtcclxuICAgIHJldHVybiB0aGlzLnJlYWR5O1xyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5nZXRDcmVkaXQgPSBmdW5jdGlvbiBnZXRDcmVkaXQoKSB7XHJcbiAgICByZXR1cm4gdGhpcy5jcmVkaXQ7XHJcbn07XHJcblxyXG5JbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlLmdldFJlY3RhbmdsZSA9IGZ1bmN0aW9uIGdldFJlY3RhbmdsZSgpIHtcclxuICAgIHJldHVybiB0aGlzLnRpbGluZ1NjaGVtZS5yZWN0YW5nbGU7XHJcbn07XHJcblxyXG5JbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlLmdldFRpbGluZ1NjaGVtZSA9IGZ1bmN0aW9uIGdldFRpbGluZ1NjaGVtZSgpIHtcclxuICAgIHJldHVybiB0aGlzLnRpbGluZ1NjaGVtZTtcclxufTtcclxuXHJcbkltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlci5wcm90b3R5cGUuZ2V0VGlsZURpc2NhcmRQb2xpY3kgPSBmdW5jdGlvbiBnZXRUaWxlRGlzY2FyZFBvbGljeSgpIHtcclxuICAgIHJldHVybiB0aGlzLnRpbGVEaXNjYXJkUG9saWN5O1xyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5nZXRFcnJvckV2ZW50ID0gZnVuY3Rpb24gZ2V0RXJyb3JFdmVudCgpIHtcclxuICAgIHJldHVybiB0aGlzLmVycm9yRXZlbnQ7XHJcbn07XHJcblxyXG5JbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlLmdldEhhc0FscGhhQ2hhbm5lbCA9IGZ1bmN0aW9uIGdldEhhc0FscGhhQ2hhbm5lbCgpIHtcclxuICAgIHJldHVybiB0aGlzLmhhc0FscGhhQ2hhbm5lbDtcclxufTtcclxuXHJcbi8qKlxyXG4gKiBHZXRzIHRoZSBjcmVkaXRzIHRvIGJlIGRpc3BsYXllZCB3aGVuIGEgZ2l2ZW4gdGlsZSBpcyBkaXNwbGF5ZWQuXHJcbiAqXHJcbiAqIEBwYXJhbSB7TnVtYmVyfSB4IFRoZSB0aWxlIFggY29vcmRpbmF0ZS5cclxuICogQHBhcmFtIHtOdW1iZXJ9IHkgVGhlIHRpbGUgWSBjb29yZGluYXRlLlxyXG4gKiBAcGFyYW0ge051bWJlcn0gbGV2ZWwgVGhlIHRpbGUgbGV2ZWw7XHJcbiAqIEByZXR1cm5zIHtDcmVkaXRbXX0gVGhlIGNyZWRpdHMgdG8gYmUgZGlzcGxheWVkIHdoZW4gdGhlIHRpbGUgaXMgZGlzcGxheWVkLlxyXG4gKlxyXG4gKiBAZXhjZXB0aW9uIHtEZXZlbG9wZXJFcnJvcn0gPGNvZGU+Z2V0VGlsZUNyZWRpdHM8L2NvZGU+IG11c3Qgbm90IGJlIGNhbGxlZCBiZWZvcmUgdGhlIGltYWdlcnkgcHJvdmlkZXIgaXMgcmVhZHkuXHJcbiAqL1xyXG5JbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlLmdldFRpbGVDcmVkaXRzID0gZnVuY3Rpb24oeCwgeSwgbGV2ZWwpIHtcclxuICAgIHJldHVybiB1bmRlZmluZWQ7XHJcbn07XHJcblxyXG4vKipcclxuICogUmVxdWVzdHMgdGhlIGltYWdlIGZvciBhIGdpdmVuIHRpbGUuICBUaGlzIGZ1bmN0aW9uIHNob3VsZFxyXG4gKiBub3QgYmUgY2FsbGVkIGJlZm9yZSB7QGxpbmsgSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyI3JlYWR5fSByZXR1cm5zIHRydWUuXHJcbiAqXHJcbiAqIEBwYXJhbSB7TnVtYmVyfSB4IFRoZSB0aWxlIFggY29vcmRpbmF0ZS5cclxuICogQHBhcmFtIHtOdW1iZXJ9IHkgVGhlIHRpbGUgWSBjb29yZGluYXRlLlxyXG4gKiBAcGFyYW0ge051bWJlcn0gbGV2ZWwgVGhlIHRpbGUgbGV2ZWwuXHJcbiAqIEByZXR1cm5zIHtQcm9taXNlfSBBIHByb21pc2UgZm9yIHRoZSBpbWFnZSB0aGF0IHdpbGwgcmVzb2x2ZSB3aGVuIHRoZSBpbWFnZSBpcyBhdmFpbGFibGUsIG9yXHJcbiAqICAgICAgICAgIHVuZGVmaW5lZCBpZiB0aGVyZSBhcmUgdG9vIG1hbnkgYWN0aXZlIHJlcXVlc3RzIHRvIHRoZSBzZXJ2ZXIsIGFuZCB0aGUgcmVxdWVzdFxyXG4gKiAgICAgICAgICBzaG91bGQgYmUgcmV0cmllZCBsYXRlci4gIFRoZSByZXNvbHZlZCBpbWFnZSBtYXkgYmUgZWl0aGVyIGFuXHJcbiAqICAgICAgICAgIEltYWdlIG9yIGEgQ2FudmFzIERPTSBvYmplY3QuXHJcbiAqXHJcbiAqIEBleGNlcHRpb24ge0RldmVsb3BlckVycm9yfSA8Y29kZT5yZXF1ZXN0SW1hZ2U8L2NvZGU+IG11c3Qgbm90IGJlIGNhbGxlZCBiZWZvcmUgdGhlIGltYWdlcnkgcHJvdmlkZXIgaXMgcmVhZHkuXHJcbiAqL1xyXG5JbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlLnJlcXVlc3RJbWFnZSA9IGZ1bmN0aW9uKHgsIHksIGNlc2l1bUxldmVsKSB7XHJcbiAgICAvLz4+aW5jbHVkZVN0YXJ0KCdkZWJ1ZycsIHByYWdtYXMuZGVidWcpO1xyXG4gICAgaWYgKCF0aGlzLl9yZWFkeSkge1xyXG4gICAgICAgIHRocm93IG5ldyBEZXZlbG9wZXJFcnJvcigncmVxdWVzdEltYWdlIG11c3Qgbm90IGJlIGNhbGxlZCBiZWZvcmUgdGhlIGltYWdlcnkgcHJvdmlkZXIgaXMgcmVhZHkuJyk7XHJcbiAgICB9XHJcbiAgICAvLz4+aW5jbHVkZUVuZCgnZGVidWcnKTtcclxuICAgIFxyXG4gICAgdmFyIHNlbGYgPSB0aGlzO1xyXG4gICAgXHJcbiAgICB2YXIgbGV2ZWxGYWN0b3IgPSBNYXRoLnBvdygyLCB0aGlzLl9udW1SZXNvbHV0aW9uTGV2ZWxzIC0gY2VzaXVtTGV2ZWwgLSAxKTtcclxuICAgIHZhciBtaW5YID0geCAqIHRoaXMuX3RpbGVXaWR0aCAgKiBsZXZlbEZhY3RvcjtcclxuICAgIHZhciBtaW5ZID0geSAqIHRoaXMuX3RpbGVIZWlnaHQgKiBsZXZlbEZhY3RvcjtcclxuICAgIHZhciBtYXhYRXhjbHVzaXZlID0gKHggKyAxKSAqIHRoaXMuX3RpbGVXaWR0aCAgKiBsZXZlbEZhY3RvcjtcclxuICAgIHZhciBtYXhZRXhjbHVzaXZlID0gKHkgKyAxKSAqIHRoaXMuX3RpbGVIZWlnaHQgKiBsZXZlbEZhY3RvcjtcclxuICAgIFxyXG4gICAgdmFyIGxldmVsID0gYWxpZ25lZFBhcmFtcy5pbWFnZVBhcnRQYXJhbXMubGV2ZWw7XHJcbiAgICB2YXIgbGV2ZWxXaWR0aCAgPSB0aGlzLl9pbWFnZS5nZXRMZXZlbFdpZHRoKGxldmVsKTtcclxuICAgIHZhciBsZXZlbEhlaWdodCA9IHRoaXMuX2ltYWdlLmdldExldmVsSGVpZ2h0KGxldmVsKTtcclxuICAgIFxyXG4gICAgdmFyIGFsaWduZWRQYXJhbXMgPSBpbWFnZUhlbHBlckZ1bmN0aW9ucy5hbGlnblBhcmFtc1RvVGlsZXNBbmRMZXZlbCh7XHJcbiAgICAgICAgbWluWDogbWluWCxcclxuICAgICAgICBtaW5ZOiBtaW5ZLFxyXG4gICAgICAgIG1heFhFeGNsdXNpdmU6IG1heFhFeGNsdXNpdmUsXHJcbiAgICAgICAgbWF4WUV4Y2x1c2l2ZTogbWF4WUV4Y2x1c2l2ZSxcclxuICAgICAgICBsZXZlbFdpZHRoOiBsZXZlbFdpZHRoLFxyXG4gICAgICAgIGxldmVsSGVpZ2h0OiBsZXZlbEhlaWdodCxcclxuICAgICAgICBzY3JlZW5XaWR0aDogdGhpcy5fdGlsZVdpZHRoLFxyXG4gICAgICAgIHNjcmVlbkhlaWdodDogdGhpcy5fdGlsZUhlaWdodFxyXG4gICAgfSwgdGhpcy5fZGVjb2RlciwgdGhpcy5faW1hZ2UpO1xyXG4gICAgXHJcbiAgICB2YXIgc2NhbGVkQ2FudmFzID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnY2FudmFzJyk7XHJcbiAgICBzY2FsZWRDYW52YXMud2lkdGggPSB0aGlzLl90aWxlV2lkdGg7XHJcbiAgICBzY2FsZWRDYW52YXMuaGVpZ2h0ID0gdGhpcy5fdGlsZUhlaWdodDtcclxuICAgIFxyXG4gICAgdmFyIHNjYWxlZENvbnRleHQgPSBzY2FsZWRDYW52YXMuZ2V0Q29udGV4dCgnMmQnKTtcclxuICAgIHNjYWxlZENvbnRleHQuY2xlYXJSZWN0KDAsIDAsIHRoaXMuX3RpbGVXaWR0aCwgdGhpcy5fdGlsZUhlaWdodCk7XHJcbiAgICBcclxuICAgIHZhciB0ZW1wUGl4ZWxXaWR0aCAgPSBhbGlnbmVkUGFyYW1zLmltYWdlUGFydFBhcmFtcy5tYXhYRXhjbHVzaXZlIC0gYWxpZ25lZFBhcmFtcy5pbWFnZVBhcnRQYXJhbXMubWluWDtcclxuICAgIHZhciB0ZW1wUGl4ZWxIZWlnaHQgPSBhbGlnbmVkUGFyYW1zLmltYWdlUGFydFBhcmFtcy5tYXhZRXhjbHVzaXZlIC0gYWxpZ25lZFBhcmFtcy5pbWFnZVBhcnRQYXJhbXMubWluWTtcclxuICAgIGlmICh0ZW1wUGl4ZWxXaWR0aCA8PSAwIHx8IHRlbXBQaXhlbEhlaWdodCA8PSAwKSB7XHJcbiAgICAgICAgcmV0dXJuIHNjYWxlZENhbnZhcztcclxuICAgIH1cclxuICAgIFxyXG4gICAgdmFyIHRlbXBDYW52YXMgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdjYW52YXMnKTtcclxuICAgIHRlbXBDYW52YXMud2lkdGggPSB0ZW1wUGl4ZWxXaWR0aDtcclxuICAgIHRlbXBDYW52YXMuaGVpZ2h0ID0gdGVtcFBpeGVsSGVpZ2h0O1xyXG4gICAgdmFyIHRlbXBDb250ZXh0ID0gdGVtcENhbnZhcy5nZXRDb250ZXh0KCcyZCcpO1xyXG4gICAgdGVtcENvbnRleHQuY2xlYXJSZWN0KDAsIDAsIHRlbXBQaXhlbFdpZHRoLCB0ZW1wUGl4ZWxIZWlnaHQpO1xyXG4gICAgXHJcbiAgICBhbGlnbmVkUGFyYW1zLmltYWdlUGFydFBhcmFtcy5xdWFsaXR5ID0gdGhpcy5fcXVhbGl0eTtcclxuICAgIGFsaWduZWRQYXJhbXMuaW1hZ2VQYXJ0UGFyYW1zLnJlcXVlc3RQcmlvcml0eURhdGEgPSB7XHJcbiAgICAgICAgaW1hZ2VSZWN0YW5nbGU6IHRoaXMuX3JlY3RhbmdsZVxyXG4gICAgfTtcclxuICAgIFxyXG4gICAgdmFyIHJlc29sdmUsIHJlamVjdDtcclxuICAgIHZhciByZXF1ZXN0UGl4ZWxzUHJvbWlzZSA9IG5ldyBQcm9taXNlKGZ1bmN0aW9uKHJlc29sdmVfLCByZWplY3RfKSB7XHJcbiAgICAgICAgcmVzb2x2ZSA9IHJlc29sdmVfO1xyXG4gICAgICAgIHJlamVjdCA9IHJlamVjdF87XHJcbiAgICAgICAgXHJcbiAgICAgICAgc2VsZi5fZGVjb2Rlci5yZXF1ZXN0UGl4ZWxzUHJvZ3Jlc3NpdmUoXHJcbiAgICAgICAgICAgIGFsaWduZWRQYXJhbXMuaW1hZ2VQYXJ0UGFyYW1zLFxyXG4gICAgICAgICAgICBwaXhlbHNEZWNvZGVkQ2FsbGJhY2ssXHJcbiAgICAgICAgICAgIHRlcm1pbmF0ZWRDYWxsYmFjayk7XHJcbiAgICB9KTtcclxuICAgIFxyXG4gICAgZnVuY3Rpb24gcGl4ZWxzRGVjb2RlZENhbGxiYWNrKGRlY29kZWQpIHtcclxuICAgICAgICB2YXIgcGFydGlhbFRpbGVXaWR0aCA9IGRlY29kZWQuaW1hZ2VEYXRhLndpZHRoO1xyXG4gICAgICAgIHZhciBwYXJ0aWFsVGlsZUhlaWdodCA9IGRlY29kZWQuaW1hZ2VEYXRhLmhlaWdodDtcclxuXHJcbiAgICAgICAgaWYgKHBhcnRpYWxUaWxlV2lkdGggPiAwICYmIHBhcnRpYWxUaWxlSGVpZ2h0ID4gMCkge1xyXG4gICAgICAgICAgICB0ZW1wQ29udGV4dC5wdXRJbWFnZURhdGEoXHJcbiAgICAgICAgICAgICAgICBkZWNvZGVkLmltYWdlRGF0YSxcclxuICAgICAgICAgICAgICAgIGRlY29kZWQueEluT3JpZ2luYWxSZXF1ZXN0LFxyXG4gICAgICAgICAgICAgICAgZGVjb2RlZC55SW5PcmlnaW5hbFJlcXVlc3QpO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICBmdW5jdGlvbiB0ZXJtaW5hdGVkQ2FsbGJhY2soaXNBYm9ydGVkKSB7XHJcbiAgICAgICAgaWYgKGlzQWJvcnRlZCkge1xyXG4gICAgICAgICAgICByZWplY3QoJ0ZldGNoIHJlcXVlc3Qgb3IgZGVjb2RlIGFib3J0ZWQnKTtcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICBzY2FsZWRDb250ZXh0LmRyYXdJbWFnZShcclxuICAgICAgICAgICAgICAgIHRlbXBDYW52YXMsXHJcbiAgICAgICAgICAgICAgICAwLCAwLCB0ZW1wUGl4ZWxXaWR0aCwgdGVtcFBpeGVsSGVpZ2h0LFxyXG4gICAgICAgICAgICAgICAgYWxpZ25lZFBhcmFtcy5jcm9wcGVkU2NyZWVuLm1pblgsIGFsaWduZWRQYXJhbXMuY3JvcHBlZFNjcmVlbi5taW5ZLFxyXG4gICAgICAgICAgICAgICAgYWxpZ25lZFBhcmFtcy5jcm9wcGVkU2NyZWVuLm1heFhFeGNsdXNpdmUsIGFsaWduZWRQYXJhbXMuY3JvcHBlZFNjcmVlbi5tYXhZRXhjbHVzaXZlKTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICByZXNvbHZlKHNjYWxlZENhbnZhcyk7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiByZXF1ZXN0UGl4ZWxzUHJvbWlzZTtcclxufTtcclxuXHJcbkltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlci5wcm90b3R5cGUuX3NldFByaW9yaXR5QnlGcnVzdHVtID1cclxuICAgIGZ1bmN0aW9uIHNldFByaW9yaXR5QnlGcnVzdHVtKCkge1xyXG4gICAgXHJcbiAgICBpZiAoIXRoaXMuX3JlYWR5KSB7XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICB2YXIgZnJ1c3R1bURhdGEgPSBjYWxjdWxhdGVDZXNpdW1GcnVzdHVtKFxyXG4gICAgICAgIHRoaXMuX2Nlc2l1bVdpZGdldCwgdGhpcyk7XHJcbiAgICBcclxuICAgIGlmIChmcnVzdHVtRGF0YSA9PT0gbnVsbCkge1xyXG4gICAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIFxyXG4gICAgZnJ1c3R1bURhdGEuaW1hZ2VSZWN0YW5nbGUgPSB0aGlzLmdldFJlY3RhbmdsZSgpO1xyXG4gICAgZnJ1c3R1bURhdGEuZXhhY3RsZXZlbCA9IG51bGw7XHJcblxyXG4gICAgdGhpcy5fZGVjb2Rlci5zZXRTZXJ2ZXJSZXF1ZXN0UHJpb3JpdGl6ZXJEYXRhKGZydXN0dW1EYXRhKTtcclxuICAgIHRoaXMuX2RlY29kZXIuc2V0RGVjb2RlUHJpb3JpdGl6ZXJEYXRhKGZydXN0dW1EYXRhKTtcclxufTtcclxuXHJcbi8qKlxyXG4gKiBQaWNraW5nIGZlYXR1cmVzIGlzIG5vdCBjdXJyZW50bHkgc3VwcG9ydGVkIGJ5IHRoaXMgaW1hZ2VyeSBwcm92aWRlciwgc28gdGhpcyBmdW5jdGlvbiBzaW1wbHkgcmV0dXJuc1xyXG4gKiB1bmRlZmluZWQuXHJcbiAqXHJcbiAqIEBwYXJhbSB7TnVtYmVyfSB4IFRoZSB0aWxlIFggY29vcmRpbmF0ZS5cclxuICogQHBhcmFtIHtOdW1iZXJ9IHkgVGhlIHRpbGUgWSBjb29yZGluYXRlLlxyXG4gKiBAcGFyYW0ge051bWJlcn0gbGV2ZWwgVGhlIHRpbGUgbGV2ZWwuXHJcbiAqIEBwYXJhbSB7TnVtYmVyfSBsb25naXR1ZGUgVGhlIGxvbmdpdHVkZSBhdCB3aGljaCB0byBwaWNrIGZlYXR1cmVzLlxyXG4gKiBAcGFyYW0ge051bWJlcn0gbGF0aXR1ZGUgIFRoZSBsYXRpdHVkZSBhdCB3aGljaCB0byBwaWNrIGZlYXR1cmVzLlxyXG4gKiBAcmV0dXJuIHtQcm9taXNlfSBBIHByb21pc2UgZm9yIHRoZSBwaWNrZWQgZmVhdHVyZXMgdGhhdCB3aWxsIHJlc29sdmUgd2hlbiB0aGUgYXN5bmNocm9ub3VzXHJcbiAqICAgICAgICAgICAgICAgICAgIHBpY2tpbmcgY29tcGxldGVzLiAgVGhlIHJlc29sdmVkIHZhbHVlIGlzIGFuIGFycmF5IG9mIHtAbGluayBJbWFnZXJ5TGF5ZXJGZWF0dXJlSW5mb31cclxuICogICAgICAgICAgICAgICAgICAgaW5zdGFuY2VzLiAgVGhlIGFycmF5IG1heSBiZSBlbXB0eSBpZiBubyBmZWF0dXJlcyBhcmUgZm91bmQgYXQgdGhlIGdpdmVuIGxvY2F0aW9uLlxyXG4gKiAgICAgICAgICAgICAgICAgICBJdCBtYXkgYWxzbyBiZSB1bmRlZmluZWQgaWYgcGlja2luZyBpcyBub3Qgc3VwcG9ydGVkLlxyXG4gKi9cclxuSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5waWNrRmVhdHVyZXMgPSBmdW5jdGlvbigpIHtcclxuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5fb25FeGNlcHRpb24gPSBmdW5jdGlvbiBvbkV4Y2VwdGlvbihyZWFzb24pIHtcclxuICAgIGlmICh0aGlzLl9leGNlcHRpb25DYWxsYmFjayAhPT0gbnVsbCkge1xyXG5cdFx0dGhpcy5fZXhjZXB0aW9uQ2FsbGJhY2socmVhc29uKTtcclxuICAgIH1cclxufTtcclxuXHJcbkltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlci5wcm90b3R5cGUuX29wZW5lZCA9IGZ1bmN0aW9uIG9wZW5lZCgpIHtcclxuICAgIGlmICh0aGlzLl9yZWFkeSkge1xyXG4gICAgICAgIHRocm93ICdJbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIgZXJyb3I6IG9wZW5lZCgpIHdhcyBjYWxsZWQgbW9yZSB0aGFuIG9uY2UhJztcclxuICAgIH1cclxuICAgIFxyXG4gICAgdGhpcy5fcmVhZHkgPSB0cnVlO1xyXG5cclxuICAgIC8vIFRoaXMgaXMgd3JvbmcgaWYgQ09EIG9yIENPQyBleGlzdHMgYmVzaWRlcyBtYWluIGhlYWRlciBDT0RcclxuICAgIHRoaXMuX251bVJlc29sdXRpb25MZXZlbHMgPSB0aGlzLl9kZWNvZGVyLmdldE51bVJlc29sdXRpb25MZXZlbHNGb3JMaW1pdHRlZFZpZXdlcigpO1xyXG4gICAgdGhpcy5fcXVhbGl0eSA9IHRoaXMuX2RlY29kZXIuZ2V0SGlnaGVzdFF1YWxpdHkoKTtcclxuICAgIHZhciBtYXhpbXVtQ2VzaXVtTGV2ZWwgPSB0aGlzLl9udW1SZXNvbHV0aW9uTGV2ZWxzIC0gMTtcclxuICAgICAgICBcclxuICAgIHRoaXMuX3RpbGVXaWR0aCA9IHRoaXMuX2RlY29kZXIuZ2V0VGlsZVdpZHRoKCk7XHJcbiAgICB0aGlzLl90aWxlSGVpZ2h0ID0gdGhpcy5fZGVjb2Rlci5nZXRUaWxlSGVpZ2h0KCk7XHJcbiAgICAgICAgXHJcbiAgICB2YXIgYmVzdExldmVsID0gdGhpcy5fZGVjb2Rlci5nZXRJbWFnZUxldmVsKCk7XHJcbiAgICB2YXIgYmVzdExldmVsV2lkdGggID0gdGhpcy5fZGVjb2Rlci5nZXRJbWFnZVdpZHRoICgpO1xyXG4gICAgdmFyIGJlc3RMZXZlbEhlaWdodCA9IHRoaXMuX2RlY29kZXIuZ2V0SW1hZ2VIZWlnaHQoKTtcclxuICAgIFxyXG4gICAgdmFyIGxvd2VzdExldmVsVGlsZXNYID0gTWF0aC5jZWlsKGJlc3RMZXZlbFdpZHRoICAvIHRoaXMuX3RpbGVXaWR0aCApID4+IG1heGltdW1DZXNpdW1MZXZlbDtcclxuICAgIHZhciBsb3dlc3RMZXZlbFRpbGVzWSA9IE1hdGguY2VpbChiZXN0TGV2ZWxIZWlnaHQgLyB0aGlzLl90aWxlSGVpZ2h0KSA+PiBtYXhpbXVtQ2VzaXVtTGV2ZWw7XHJcblxyXG4gICAgaW1hZ2VIZWxwZXJGdW5jdGlvbnMuZml4Qm91bmRzKFxyXG4gICAgICAgIHRoaXMuX3JlY3RhbmdsZSxcclxuICAgICAgICB0aGlzLl9kZWNvZGVyLFxyXG4gICAgICAgIHRoaXMuX2FkYXB0UHJvcG9ydGlvbnMpO1xyXG4gICAgdmFyIHJlY3RhbmdsZVdpZHRoICA9IHRoaXMuX3JlY3RhbmdsZS5lYXN0ICAtIHRoaXMuX3JlY3RhbmdsZS53ZXN0O1xyXG4gICAgdmFyIHJlY3RhbmdsZUhlaWdodCA9IHRoaXMuX3JlY3RhbmdsZS5ub3J0aCAtIHRoaXMuX3JlY3RhbmdsZS5zb3V0aDtcclxuICAgIFxyXG4gICAgdmFyIGJlc3RMZXZlbFNjYWxlID0gMSA8PCBtYXhpbXVtQ2VzaXVtTGV2ZWw7XHJcbiAgICB2YXIgcGl4ZWxzV2lkdGhGb3JDZXNpdW0gID0gdGhpcy5fdGlsZVdpZHRoICAqIGxvd2VzdExldmVsVGlsZXNYICogYmVzdExldmVsU2NhbGU7XHJcbiAgICB2YXIgcGl4ZWxzSGVpZ2h0Rm9yQ2VzaXVtID0gdGhpcy5fdGlsZUhlaWdodCAqIGxvd2VzdExldmVsVGlsZXNZICogYmVzdExldmVsU2NhbGU7XHJcbiAgICBcclxuICAgIC8vIENlc2l1bSB3b3JrcyB3aXRoIGZ1bGwgdGlsZXMgb25seSwgdGh1cyBmaXggdGhlIGdlb2dyYXBoaWMgYm91bmRzIHNvXHJcbiAgICAvLyB0aGUgcGl4ZWxzIGxpZXMgZXhhY3RseSBvbiB0aGUgb3JpZ2luYWwgYm91bmRzXHJcbiAgICBcclxuICAgIHZhciBnZW9ncmFwaGljV2lkdGhGb3JDZXNpdW0gPVxyXG4gICAgICAgIHJlY3RhbmdsZVdpZHRoICogcGl4ZWxzV2lkdGhGb3JDZXNpdW0gLyBiZXN0TGV2ZWxXaWR0aDtcclxuICAgIHZhciBnZW9ncmFwaGljSGVpZ2h0Rm9yQ2VzaXVtID1cclxuICAgICAgICByZWN0YW5nbGVIZWlnaHQgKiBwaXhlbHNIZWlnaHRGb3JDZXNpdW0gLyBiZXN0TGV2ZWxIZWlnaHQ7XHJcbiAgICBcclxuICAgIHZhciBmaXhlZEVhc3QgID0gdGhpcy5fcmVjdGFuZ2xlLndlc3QgICsgZ2VvZ3JhcGhpY1dpZHRoRm9yQ2VzaXVtO1xyXG4gICAgdmFyIGZpeGVkU291dGggPSB0aGlzLl9yZWN0YW5nbGUubm9ydGggLSBnZW9ncmFwaGljSGVpZ2h0Rm9yQ2VzaXVtO1xyXG4gICAgXHJcbiAgICB0aGlzLl90aWxpbmdTY2hlbWVQYXJhbXMgPSB7XHJcbiAgICAgICAgd2VzdDogdGhpcy5fcmVjdGFuZ2xlLndlc3QsXHJcbiAgICAgICAgZWFzdDogZml4ZWRFYXN0LFxyXG4gICAgICAgIHNvdXRoOiBmaXhlZFNvdXRoLFxyXG4gICAgICAgIG5vcnRoOiB0aGlzLl9yZWN0YW5nbGUubm9ydGgsXHJcbiAgICAgICAgbGV2ZWxaZXJvVGlsZXNYOiBsb3dlc3RMZXZlbFRpbGVzWCxcclxuICAgICAgICBsZXZlbFplcm9UaWxlc1k6IGxvd2VzdExldmVsVGlsZXNZLFxyXG4gICAgICAgIG1heGltdW1MZXZlbDogbWF4aW11bUNlc2l1bUxldmVsXHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICB0aGlzLl90aWxpbmdTY2hlbWUgPSBjcmVhdGVUaWxpbmdTY2hlbWUodGhpcy5fdGlsaW5nU2NoZW1lUGFyYW1zKTtcclxuICAgICAgICBcclxuICAgIENlc2l1bS5UaWxlUHJvdmlkZXJFcnJvci5oYW5kbGVTdWNjZXNzKHRoaXMuX2Vycm9yRXZlbnQpO1xyXG59O1xyXG5cclxuZnVuY3Rpb24gY3JlYXRlVGlsaW5nU2NoZW1lKHBhcmFtcykge1xyXG4gICAgdmFyIGdlb2dyYXBoaWNSZWN0YW5nbGVGb3JDZXNpdW0gPSBuZXcgQ2VzaXVtLlJlY3RhbmdsZShcclxuICAgICAgICBwYXJhbXMud2VzdCwgcGFyYW1zLnNvdXRoLCBwYXJhbXMuZWFzdCwgcGFyYW1zLm5vcnRoKTtcclxuICAgIFxyXG4gICAgdmFyIHRpbGluZ1NjaGVtZSA9IG5ldyBDZXNpdW0uR2VvZ3JhcGhpY1RpbGluZ1NjaGVtZSh7XHJcbiAgICAgICAgcmVjdGFuZ2xlOiBnZW9ncmFwaGljUmVjdGFuZ2xlRm9yQ2VzaXVtLFxyXG4gICAgICAgIG51bWJlck9mTGV2ZWxaZXJvVGlsZXNYOiBwYXJhbXMubGV2ZWxaZXJvVGlsZXNYLFxyXG4gICAgICAgIG51bWJlck9mTGV2ZWxaZXJvVGlsZXNZOiBwYXJhbXMubGV2ZWxaZXJvVGlsZXNZXHJcbiAgICB9KTtcclxuICAgIFxyXG4gICAgcmV0dXJuIHRpbGluZ1NjaGVtZTtcclxufSIsIid1c2Ugc3RyaWN0JztcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gSW1hZ2VEZWNvZGVyO1xyXG5cclxudmFyIGltYWdlSGVscGVyRnVuY3Rpb25zID0gcmVxdWlyZSgnaW1hZ2VIZWxwZXJGdW5jdGlvbnMuanMnKTtcclxudmFyIERlY29kZUpvYnNQb29sID0gcmVxdWlyZSgnZGVjb2Rlam9ic3Bvb2wuanMnKTtcclxudmFyIEltYWdlUGFyYW1zUmV0cmlldmVyUHJveHkgPSByZXF1aXJlKCdpbWFnZXBhcmFtc3JldHJpZXZlcnByb3h5LmpzJyk7XHJcbnZhciBzZXREZWNvZGVyU2xhdmVTaWRlQ3JlYXRvciA9IHJlcXVpcmUoJ3NldGRlY29kZXJzbGF2ZXNpZGVjcmVhdG9yLmpzJyk7XHJcblxyXG4vKiBnbG9iYWwgY29uc29sZTogZmFsc2UgKi9cclxuLyogZ2xvYmFsIFByb21pc2U6IGZhbHNlICovXHJcblxyXG5JbWFnZURlY29kZXIuYWxpZ25QYXJhbXNUb1RpbGVzQW5kTGV2ZWwgPSBpbWFnZUhlbHBlckZ1bmN0aW9ucy5hbGlnblBhcmFtc1RvVGlsZXNBbmRMZXZlbDtcclxuXHJcbmZ1bmN0aW9uIEltYWdlRGVjb2RlcihpbWFnZSwgb3B0aW9ucykge1xyXG4gICAgSW1hZ2VQYXJhbXNSZXRyaWV2ZXJQcm94eS5jYWxsKHRoaXMpO1xyXG4gICAgXHJcbiAgICB0aGlzLl9vcHRpb25zID0gb3B0aW9ucyB8fCB7fTtcclxuICAgIC8vdmFyIGRlY29kZVdvcmtlcnNMaW1pdCA9IHRoaXMuX29wdGlvbnMud29ya2Vyc0xpbWl0IHx8IDU7XHJcbiAgICBcclxuICAgIHRoaXMuX3RpbGVXaWR0aCA9IHRoaXMuX29wdGlvbnMudGlsZVdpZHRoIHx8IDI1NjtcclxuICAgIHRoaXMuX3RpbGVIZWlnaHQgPSB0aGlzLl9vcHRpb25zLnRpbGVIZWlnaHQgfHwgMjU2O1xyXG4gICAgdGhpcy5fc2hvd0xvZyA9ICEhdGhpcy5fb3B0aW9ucy5zaG93TG9nO1xyXG4gICAgdGhpcy5fZmV0Y2hNYW5hZ2VyID0gbnVsbDtcclxuICAgIHRoaXMuX2RlY29kZURlcGVuZGVuY3lXb3JrZXJzID0gbnVsbDtcclxuICAgIHRoaXMuX3JlcXVlc3RzRGVjb2RlSm9ic1Bvb2wgPSBudWxsO1xyXG4gICAgdGhpcy5fY2hhbm5lbHNEZWNvZGVKb2JzUG9vbCA9IG51bGw7XHJcblx0dGhpcy5fZmV0Y2hSZXF1ZXN0SWQgPSAwO1xyXG4gICAgXHJcbiAgICAvKmlmICh0aGlzLl9zaG93TG9nKSB7XHJcbiAgICAgICAgLy8gT2xkIElFXHJcbiAgICAgICAgdGhyb3cgJ3Nob3dMb2cgaXMgbm90IHN1cHBvcnRlZCBvbiB0aGlzIGJyb3dzZXInO1xyXG4gICAgfSovXHJcblxyXG4gICAgdGhpcy5fY2hhbm5lbFN0YXRlcyA9IFtdO1xyXG4gICAgdGhpcy5fZGVjb2RlcnMgPSBbXTtcclxuXHJcbiAgICAvKiBUT0RPXHJcbiAgICB2YXIgZGVjb2RlU2NoZWR1bGVyID0gaW1hZ2VIZWxwZXJGdW5jdGlvbnMuY3JlYXRlU2NoZWR1bGVyKFxyXG4gICAgICAgIHRoaXMuX3Nob3dMb2csXHJcbiAgICAgICAgdGhpcy5fb3B0aW9ucy5kZWNvZGVQcmlvcml0aXplcixcclxuICAgICAgICAnZGVjb2RlJyxcclxuICAgICAgICBmdW5jdGlvbiBjcmVhdGVSZXNvdXJjZSgpIHtcclxuICAgICAgICAgICAgcmV0dXJuIHt9O1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgZGVjb2RlV29ya2Vyc0xpbWl0KTtcclxuICAgICovXHJcbiAgICBcclxuICAgIC8vdGhpcy5fZGVjb2RlUHJpb3JpdGl6ZXIgPSBkZWNvZGVTY2hlZHVsZXIucHJpb3JpdGl6ZXI7XHJcbiAgICBcclxuICAgIHRoaXMuX2ltYWdlID0gaW1hZ2U7XHJcbiAgICBpZiAoIXRoaXMuX2ltYWdlLmdldEZldGNoTWFuYWdlcikge1xyXG4gICAgICAgIHRocm93ICdJbWFnZS5nZXRGZXRjaE1hbmFnZXIoKSBpcyBub3QgaW1wbGVtZW50ZWQgYnkgaW1hZ2UgY3RvciBhcmd1bWVudCEnO1xyXG4gICAgfVxyXG4gICAgaWYgKCF0aGlzLl9pbWFnZS5nZXREZWNvZGVyV29ya2Vycykge1xyXG4gICAgICAgIHRocm93ICdJbWFnZS5nZXREZWNvZGVyV29ya2VycygpIGlzIG5vdCBpbXBsZW1lbnRlZCBieSBpbWFnZSBjdG9yIGFyZ3VtZW50JztcclxuICAgIH1cclxufVxyXG5cclxuSW1hZ2VEZWNvZGVyLnByb3RvdHlwZSA9IE9iamVjdC5jcmVhdGUoSW1hZ2VQYXJhbXNSZXRyaWV2ZXJQcm94eS5wcm90b3R5cGUpO1xyXG5cclxuSW1hZ2VEZWNvZGVyLnByb3RvdHlwZS5nZXRUaWxlV2lkdGggPSBmdW5jdGlvbiBnZXRUaWxlV2lkdGgoKSB7XHJcbiAgICByZXR1cm4gdGhpcy5fdGlsZVdpZHRoO1xyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVyLnByb3RvdHlwZS5nZXRUaWxlSGVpZ2h0ID0gZnVuY3Rpb24gZ2V0VGlsZUhlaWdodCgpIHtcclxuICAgIHJldHVybiB0aGlzLl90aWxlSGVpZ2h0O1xyXG59O1xyXG4gICAgXHJcbkltYWdlRGVjb2Rlci5wcm90b3R5cGUuc2V0U2VydmVyUmVxdWVzdFByaW9yaXRpemVyRGF0YSA9XHJcbiAgICBmdW5jdGlvbiBzZXRTZXJ2ZXJSZXF1ZXN0UHJpb3JpdGl6ZXJEYXRhKHByaW9yaXRpemVyRGF0YSkge1xyXG5cclxuICAgIHRoaXMuX3ZhbGlkYXRlRmV0Y2hlcigpO1xyXG4gICAgXHJcbiAgICAvLyBUT0RPXHJcbiAgICAvL3RoaXMuX2ZldGNoTWFuYWdlci5zZXRTZXJ2ZXJSZXF1ZXN0UHJpb3JpdGl6ZXJEYXRhKFxyXG4gICAgLy8gICAgcHJpb3JpdGl6ZXJEYXRhKTtcclxufTtcclxuXHJcbkltYWdlRGVjb2Rlci5wcm90b3R5cGUuc2V0RGVjb2RlUHJpb3JpdGl6ZXJEYXRhID1cclxuICAgIGZ1bmN0aW9uIHNldERlY29kZVByaW9yaXRpemVyRGF0YShwcmlvcml0aXplckRhdGEpIHtcclxuXHJcbiAgICB0aGlzLl92YWxpZGF0ZURlY29kZXIoKTtcclxuICAgIFxyXG4gICAgLy8gVE9ET1xyXG4gICAgaWYgKCFJbWFnZURlY29kZXIudW5kZWZpbmVkVmFyKSB7IC8vIEF2b2lkIHVucmVhY2hhYmxlIHdhcm5pbmdcclxuICAgICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBpZiAodGhpcy5fZGVjb2RlUHJpb3JpdGl6ZXIgPT09IG51bGwpIHtcclxuICAgICAgICB0aHJvdyAnTm8gZGVjb2RlIHByaW9yaXRpemVyIGhhcyBiZWVuIHNldCc7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGlmICh0aGlzLl9zaG93TG9nKSB7XHJcbiAgICAgICAgY29uc29sZS5sb2coJ3NldERlY29kZVByaW9yaXRpemVyRGF0YSgnICsgcHJpb3JpdGl6ZXJEYXRhICsgJyknKTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgdmFyIHByaW9yaXRpemVyRGF0YU1vZGlmaWVkID0gT2JqZWN0LmNyZWF0ZShwcmlvcml0aXplckRhdGEpO1xyXG4gICAgcHJpb3JpdGl6ZXJEYXRhTW9kaWZpZWQuaW1hZ2UgPSB0aGlzO1xyXG4gICAgXHJcbiAgICB0aGlzLl9kZWNvZGVQcmlvcml0aXplci5zZXRQcmlvcml0aXplckRhdGEocHJpb3JpdGl6ZXJEYXRhTW9kaWZpZWQpO1xyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVyLnByb3RvdHlwZS5vcGVuID0gZnVuY3Rpb24gb3Blbih1cmwpIHtcclxuICAgIHRoaXMuX3ZhbGlkYXRlRmV0Y2hlcigpO1xyXG4gICAgXHJcbiAgICB2YXIgc2VsZiA9IHRoaXM7XHJcbiAgICB2YXIgcHJvbWlzZSA9IHRoaXMuX2ZldGNoTWFuYWdlci5vcGVuKHVybCk7XHJcbiAgICByZXR1cm4gcHJvbWlzZS50aGVuKGZ1bmN0aW9uIChzaXplc1BhcmFtcykge1xyXG4gICAgICAgIHNlbGYuX2ludGVybmFsU2l6ZXNQYXJhbXMgPSBzaXplc1BhcmFtcztcclxuICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgICBzaXplc1BhcmFtczogc2l6ZXNQYXJhbXMsXHJcbiAgICAgICAgICAgIGFwcGxpY2F0aXZlVGlsZVdpZHRoIDogc2VsZi5nZXRUaWxlV2lkdGgoKSxcclxuICAgICAgICAgICAgYXBwbGljYXRpdmVUaWxlSGVpZ2h0OiBzZWxmLmdldFRpbGVIZWlnaHQoKVxyXG4gICAgICAgIH07XHJcbiAgICB9KTtcclxufTtcclxuXHJcbkltYWdlRGVjb2Rlci5wcm90b3R5cGUuY2xvc2UgPSBmdW5jdGlvbiBjbG9zZSgpIHtcclxuICAgIHRoaXMuX3ZhbGlkYXRlRmV0Y2hlcigpO1xyXG4gICAgdGhpcy5fdmFsaWRhdGVEZWNvZGVyKCk7XHJcbiAgICBcclxuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgdGhpcy5fZGVjb2RlcnMubGVuZ3RoOyArK2kpIHtcclxuICAgICAgICB0aGlzLl9kZWNvZGVyc1tpXS50ZXJtaW5hdGUoKTtcclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4gdGhpcy5fZmV0Y2hNYW5hZ2VyLmNsb3NlKCk7XHJcbn07XHJcblxyXG5JbWFnZURlY29kZXIucHJvdG90eXBlLmNyZWF0ZUNoYW5uZWwgPSBmdW5jdGlvbiBjcmVhdGVDaGFubmVsKCkge1xyXG4gICAgdGhpcy5fdmFsaWRhdGVGZXRjaGVyKCk7XHJcbiAgICB0aGlzLmdldEltYWdlUGFyYW1zKCk7XHJcbiAgICBcclxuICAgIHZhciBzZWxmID0gdGhpcztcclxuICAgIFxyXG4gICAgcmV0dXJuIHRoaXMuX2ZldGNoTWFuYWdlci5jcmVhdGVDaGFubmVsKCkudGhlbihmdW5jdGlvbihjaGFubmVsSGFuZGxlKSB7XHJcbiAgICAgICAgc2VsZi5fY2hhbm5lbFN0YXRlc1tjaGFubmVsSGFuZGxlXSA9IHtcclxuICAgICAgICAgICAgZGVjb2RlSm9ic0xpc3RlbmVySGFuZGxlOiBudWxsXHJcbiAgICAgICAgfTtcclxuICAgICAgICBcclxuICAgICAgICByZXR1cm4gY2hhbm5lbEhhbmRsZTtcclxuICAgIH0pO1xyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVyLnByb3RvdHlwZS5yZXF1ZXN0UGl4ZWxzID0gZnVuY3Rpb24gcmVxdWVzdFBpeGVscyhpbWFnZVBhcnRQYXJhbXMpIHtcclxuICAgIHRoaXMuX3ZhbGlkYXRlRGVjb2RlcigpO1xyXG4gICAgdGhpcy5nZXRJbWFnZVBhcmFtcygpO1xyXG4gICAgXHJcbiAgICB2YXIgcmVzb2x2ZSwgcmVqZWN0O1xyXG4gICAgdmFyIGFjY3VtdWxhdGVkUmVzdWx0ID0ge307XHJcbiAgICBcclxuICAgIHZhciBzZWxmID0gdGhpcztcclxuICAgIHZhciBwcm9taXNlID0gbmV3IFByb21pc2Uoc3RhcnRQcm9taXNlKTtcclxuICAgIHJldHVybiBwcm9taXNlO1xyXG4gICAgXHJcbiAgICBmdW5jdGlvbiBzdGFydFByb21pc2UocmVzb2x2ZV8sIHJlamVjdF8pIHtcclxuICAgICAgICByZXNvbHZlID0gcmVzb2x2ZV87XHJcbiAgICAgICAgcmVqZWN0ID0gcmVqZWN0XztcclxuICAgICAgICBcclxuICAgICAgICBzZWxmLl9yZXF1ZXN0c0RlY29kZUpvYnNQb29sLmZvcmtEZWNvZGVKb2JzKFxyXG4gICAgICAgICAgICBpbWFnZVBhcnRQYXJhbXMsXHJcbiAgICAgICAgICAgIGludGVybmFsQ2FsbGJhY2ssXHJcbiAgICAgICAgICAgIGludGVybmFsVGVybWluYXRlZENhbGxiYWNrKTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgZnVuY3Rpb24gaW50ZXJuYWxDYWxsYmFjayhkZWNvZGVkRGF0YSkge1xyXG4gICAgICAgIHNlbGYuX2NvcHlQaXhlbHNUb0FjY3VtdWxhdGVkUmVzdWx0KGRlY29kZWREYXRhLCBhY2N1bXVsYXRlZFJlc3VsdCk7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGZ1bmN0aW9uIGludGVybmFsVGVybWluYXRlZENhbGxiYWNrKGlzQWJvcnRlZCkge1xyXG4gICAgICAgIGlmIChpc0Fib3J0ZWQpIHtcclxuICAgICAgICAgICAgcmVqZWN0KCdSZXF1ZXN0IHdhcyBhYm9ydGVkIGR1ZSB0byBmYWlsdXJlIG9yIHByaW9yaXR5Jyk7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgcmVzb2x2ZShhY2N1bXVsYXRlZFJlc3VsdCk7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVyLnByb3RvdHlwZS5yZXF1ZXN0UGl4ZWxzUHJvZ3Jlc3NpdmUgPSBmdW5jdGlvbiByZXF1ZXN0UGl4ZWxzUHJvZ3Jlc3NpdmUoXHJcbiAgICBpbWFnZVBhcnRQYXJhbXMsXHJcbiAgICBjYWxsYmFjayxcclxuICAgIHRlcm1pbmF0ZWRDYWxsYmFjayxcclxuICAgIGltYWdlUGFydFBhcmFtc05vdE5lZWRlZCxcclxuICAgIGNoYW5uZWxIYW5kbGUpIHtcclxuICAgIFxyXG4gICAgdGhpcy5fdmFsaWRhdGVEZWNvZGVyKCk7XHJcbiAgICB0aGlzLmdldEltYWdlUGFyYW1zKCk7XHJcbiAgICBcclxuICAgIHZhciBjaGFubmVsU3RhdGUgPSBudWxsO1xyXG4gICAgdmFyIGRlY29kZUpvYnNQb29sO1xyXG4gICAgaWYgKGNoYW5uZWxIYW5kbGUgPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIGRlY29kZUpvYnNQb29sID0gdGhpcy5fcmVxdWVzdHNEZWNvZGVKb2JzUG9vbDtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgICAgZGVjb2RlSm9ic1Bvb2wgPSB0aGlzLl9jaGFubmVsc0RlY29kZUpvYnNQb29sO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGNoYW5uZWxTdGF0ZSA9IHRoaXMuX2NoYW5uZWxTdGF0ZXNbY2hhbm5lbEhhbmRsZV07XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKGNoYW5uZWxTdGF0ZSA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgICAgIHRocm93ICdDaGFubmVsIGhhbmRsZSBkb2VzIG5vdCBleGlzdCc7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgXHJcbiAgICB2YXIgbGlzdGVuZXJIYW5kbGUgPSBkZWNvZGVKb2JzUG9vbC5mb3JrRGVjb2RlSm9icyhcclxuICAgICAgICBpbWFnZVBhcnRQYXJhbXMsXHJcbiAgICAgICAgY2FsbGJhY2ssXHJcbiAgICAgICAgdGVybWluYXRlZENhbGxiYWNrLFxyXG4gICAgICAgIGltYWdlUGFydFBhcmFtc05vdE5lZWRlZCk7XHJcbiAgICAgICAgXHJcbiAgICBpZiAoY2hhbm5lbEhhbmRsZSAhPT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgaWYgKGNoYW5uZWxTdGF0ZS5kZWNvZGVKb2JzTGlzdGVuZXJIYW5kbGUgIT09IG51bGwpIHtcclxuICAgICAgICAgICAgLy8gVW5yZWdpc3RlciBhZnRlciBmb3JrZWQgbmV3IGpvYnMsIHNvIG5vIHRlcm1pbmF0aW9uIG9jY3VycyBtZWFud2hpbGVcclxuICAgICAgICAgICAgZGVjb2RlSm9ic1Bvb2wudW5yZWdpc3RlckZvcmtlZEpvYnMoXHJcbiAgICAgICAgICAgICAgICBjaGFubmVsU3RhdGUuZGVjb2RlSm9ic0xpc3RlbmVySGFuZGxlKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgY2hhbm5lbFN0YXRlLmRlY29kZUpvYnNMaXN0ZW5lckhhbmRsZSA9IGxpc3RlbmVySGFuZGxlO1xyXG4gICAgICAgIHRoaXMuX2ZldGNoTWFuYWdlci5tb3ZlQ2hhbm5lbChjaGFubmVsSGFuZGxlLCBpbWFnZVBhcnRQYXJhbXMpO1xyXG4gICAgfSBlbHNlIHtcclxuXHRcdHRoaXMuX2ZldGNoTWFuYWdlci5jcmVhdGVSZXF1ZXN0KCsrdGhpcy5fZmV0Y2hSZXF1ZXN0SWQsIGltYWdlUGFydFBhcmFtcyk7XHJcblx0fVxyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVyLnByb3RvdHlwZS5yZWNvbm5lY3QgPSBmdW5jdGlvbiByZWNvbm5lY3QoKSB7XHJcbiAgICB0aGlzLl92YWxpZGF0ZUZldGNoZXIoKTtcclxuICAgIFxyXG4gICAgdGhpcy5fZmV0Y2hNYW5hZ2VyLnJlY29ubmVjdCgpO1xyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVyLnByb3RvdHlwZS5nZXRJbWFnZSA9IGZ1bmN0aW9uIGdldEltYWdlKCkge1xyXG4gICAgcmV0dXJuIHRoaXMuX2ltYWdlO1xyXG59O1xyXG5cclxuLy8gSW50ZXJuYWwgTWV0aG9kc1xyXG5cclxuSW1hZ2VEZWNvZGVyLnByb3RvdHlwZS5fdmFsaWRhdGVGZXRjaGVyID0gZnVuY3Rpb24gdmFsaWRhdGVGZXRjaGVyKCkge1xyXG4gICAgaWYgKHRoaXMuX2ZldGNoTWFuYWdlciA9PT0gbnVsbCkge1xyXG4gICAgICAgIHRoaXMuX2ZldGNoTWFuYWdlciA9IHRoaXMuX2ltYWdlLmdldEZldGNoTWFuYWdlcigpO1xyXG4gICAgfVxyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVyLnByb3RvdHlwZS5fdmFsaWRhdGVEZWNvZGVyID0gZnVuY3Rpb24gdmFsaWRhdGVDb21wb25lbnRzKCkge1xyXG4gICAgaWYgKHRoaXMuX2RlY29kZURlcGVuZGVuY3lXb3JrZXJzICE9PSBudWxsKSB7XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICB0aGlzLl9kZWNvZGVEZXBlbmRlbmN5V29ya2VycyA9IHRoaXMuX2ltYWdlLmdldERlY29kZXJXb3JrZXJzKCk7XHJcbiAgICBcclxuICAgIHRoaXMuX3JlcXVlc3RzRGVjb2RlSm9ic1Bvb2wgPSBuZXcgRGVjb2RlSm9ic1Bvb2woXHJcbiAgICAgICAgdGhpcy5fZGVjb2RlRGVwZW5kZW5jeVdvcmtlcnMsXHJcbiAgICAgICAgdGhpcy5fdGlsZVdpZHRoLFxyXG4gICAgICAgIHRoaXMuX3RpbGVIZWlnaHQpO1xyXG4gICAgICAgIFxyXG4gICAgdGhpcy5fY2hhbm5lbHNEZWNvZGVKb2JzUG9vbCA9IG5ldyBEZWNvZGVKb2JzUG9vbChcclxuICAgICAgICB0aGlzLl9kZWNvZGVEZXBlbmRlbmN5V29ya2VycyxcclxuICAgICAgICB0aGlzLl90aWxlV2lkdGgsXHJcbiAgICAgICAgdGhpcy5fdGlsZUhlaWdodCk7XHJcbn07XHJcblxyXG5JbWFnZURlY29kZXIucHJvdG90eXBlLl9nZXRJbWFnZVBhcmFtc0ludGVybmFsID0gZnVuY3Rpb24gZ2V0SW1hZ2VQYXJhbXNJbnRlcm5hbCgpIHtcclxuICAgIHJldHVybiB0aGlzLl9pbnRlcm5hbFNpemVzUGFyYW1zO1xyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVyLnByb3RvdHlwZS5fY29weVBpeGVsc1RvQWNjdW11bGF0ZWRSZXN1bHQgPVxyXG4gICAgZnVuY3Rpb24gY29weVBpeGVsc1RvQWNjdW11bGF0ZWRSZXN1bHQoZGVjb2RlZERhdGEsIGFjY3VtdWxhdGVkUmVzdWx0KSB7XHJcbiAgICAgICAgXHJcbiAgICB2YXIgYnl0ZXNQZXJQaXhlbCA9IDQ7XHJcbiAgICB2YXIgc291cmNlU3RyaWRlID0gZGVjb2RlZERhdGEud2lkdGggKiBieXRlc1BlclBpeGVsO1xyXG4gICAgdmFyIHRhcmdldFN0cmlkZSA9XHJcbiAgICAgICAgZGVjb2RlZERhdGEub3JpZ2luYWxSZXF1ZXN0V2lkdGggKiBieXRlc1BlclBpeGVsO1xyXG4gICAgXHJcbiAgICBpZiAoYWNjdW11bGF0ZWRSZXN1bHQucGl4ZWxzID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICB2YXIgc2l6ZSA9XHJcbiAgICAgICAgICAgIHRhcmdldFN0cmlkZSAqIGRlY29kZWREYXRhLm9yaWdpbmFsUmVxdWVzdEhlaWdodDtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgYWNjdW11bGF0ZWRSZXN1bHQucGl4ZWxzID0gbmV3IFVpbnQ4QXJyYXkoc2l6ZSk7XHJcbiAgICAgICAgYWNjdW11bGF0ZWRSZXN1bHQueEluT3JpZ2luYWxSZXF1ZXN0ID0gMDtcclxuICAgICAgICBhY2N1bXVsYXRlZFJlc3VsdC55SW5PcmlnaW5hbFJlcXVlc3QgPSAwO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHZhciB3aWR0aCA9IGRlY29kZWREYXRhLm9yaWdpbmFsUmVxdWVzdFdpZHRoO1xyXG4gICAgICAgIGFjY3VtdWxhdGVkUmVzdWx0Lm9yaWdpbmFsUmVxdWVzdFdpZHRoID0gd2lkdGg7XHJcbiAgICAgICAgYWNjdW11bGF0ZWRSZXN1bHQud2lkdGggPSB3aWR0aDtcclxuXHJcbiAgICAgICAgdmFyIGhlaWdodCA9IGRlY29kZWREYXRhLm9yaWdpbmFsUmVxdWVzdEhlaWdodDtcclxuICAgICAgICBhY2N1bXVsYXRlZFJlc3VsdC5vcmlnaW5hbFJlcXVlc3RIZWlnaHQgPSBoZWlnaHQ7XHJcbiAgICAgICAgYWNjdW11bGF0ZWRSZXN1bHQuaGVpZ2h0ID0gaGVpZ2h0O1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBhY2N1bXVsYXRlZFJlc3VsdC5hbGxSZWxldmFudEJ5dGVzTG9hZGVkID1cclxuICAgICAgICBkZWNvZGVkRGF0YS5hbGxSZWxldmFudEJ5dGVzTG9hZGVkO1xyXG5cclxuICAgIHZhciBzb3VyY2VPZmZzZXQgPSAwO1xyXG4gICAgdmFyIHRhcmdldE9mZnNldCA9XHJcbiAgICAgICAgZGVjb2RlZERhdGEueEluT3JpZ2luYWxSZXF1ZXN0ICogYnl0ZXNQZXJQaXhlbCArIFxyXG4gICAgICAgIGRlY29kZWREYXRhLnlJbk9yaWdpbmFsUmVxdWVzdCAqIHRhcmdldFN0cmlkZTtcclxuICAgIFxyXG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBkZWNvZGVkRGF0YS5oZWlnaHQ7ICsraSkge1xyXG4gICAgICAgIHZhciBzb3VyY2VTdWJBcnJheSA9IGRlY29kZWREYXRhLnBpeGVscy5zdWJhcnJheShcclxuICAgICAgICAgICAgc291cmNlT2Zmc2V0LCBzb3VyY2VPZmZzZXQgKyBzb3VyY2VTdHJpZGUpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGFjY3VtdWxhdGVkUmVzdWx0LnBpeGVscy5zZXQoc291cmNlU3ViQXJyYXksIHRhcmdldE9mZnNldCk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgc291cmNlT2Zmc2V0ICs9IHNvdXJjZVN0cmlkZTtcclxuICAgICAgICB0YXJnZXRPZmZzZXQgKz0gdGFyZ2V0U3RyaWRlO1xyXG4gICAgfVxyXG59OyIsIid1c2Ugc3RyaWN0JztcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gRGVjb2RlSm9iO1xyXG5cclxudmFyIExpbmtlZExpc3QgPSByZXF1aXJlKCdsaW5rZWRsaXN0LmpzJyk7XHJcblxyXG52YXIgcmVxdWVzdElkQ291bnRlciA9IDA7XHJcblxyXG5mdW5jdGlvbiBEZWNvZGVKb2IobGlzdGVuZXJIYW5kbGUsIGltYWdlUGFydFBhcmFtcykge1xyXG4gICAgdGhpcy5faXNGaXJzdFN0YWdlID0gdHJ1ZTtcclxuICAgIHRoaXMuX2xpc3RlbmVySGFuZGxlID0gbGlzdGVuZXJIYW5kbGU7XHJcbiAgICB0aGlzLl9pbWFnZVBhcnRQYXJhbXMgPSBpbWFnZVBhcnRQYXJhbXM7XHJcbiAgICB0aGlzLl9hbGxSZWxldmFudEJ5dGVzTG9hZGVkID0gMDtcclxuICAgIHZhciByZXF1ZXN0UGFyYW1zID0gbGlzdGVuZXJIYW5kbGUuaW1hZ2VQYXJ0UGFyYW1zO1xyXG4gICAgdGhpcy5fb2Zmc2V0WCA9IGltYWdlUGFydFBhcmFtcy5taW5YIC0gcmVxdWVzdFBhcmFtcy5taW5YO1xyXG4gICAgdGhpcy5fb2Zmc2V0WSA9IGltYWdlUGFydFBhcmFtcy5taW5ZIC0gcmVxdWVzdFBhcmFtcy5taW5ZO1xyXG4gICAgdGhpcy5fcmVxdWVzdFdpZHRoID0gcmVxdWVzdFBhcmFtcy5tYXhYRXhjbHVzaXZlIC0gcmVxdWVzdFBhcmFtcy5taW5YO1xyXG4gICAgdGhpcy5fcmVxdWVzdEhlaWdodCA9IHJlcXVlc3RQYXJhbXMubWF4WUV4Y2x1c2l2ZSAtIHJlcXVlc3RQYXJhbXMubWluWTtcclxufVxyXG5cclxuRGVjb2RlSm9iLnByb3RvdHlwZS5vbkRhdGEgPSBmdW5jdGlvbiBvbkRhdGEoZGVjb2RlUmVzdWx0KSB7XHJcbiAgICB0aGlzLl9pc0ZpcnN0U3RhZ2UgPSBmYWxzZTtcclxuXHJcbiAgICB2YXIgcmVsZXZhbnRCeXRlc0xvYWRlZERpZmYgPVxyXG4gICAgICAgIGRlY29kZVJlc3VsdC5hbGxSZWxldmFudEJ5dGVzTG9hZGVkIC0gdGhpcy5fYWxsUmVsZXZhbnRCeXRlc0xvYWRlZDtcclxuICAgIHRoaXMuX2FsbFJlbGV2YW50Qnl0ZXNMb2FkZWQgPSBkZWNvZGVSZXN1bHQuYWxsUmVsZXZhbnRCeXRlc0xvYWRlZDtcclxuICAgIHRoaXMuX2xpc3RlbmVySGFuZGxlLmFsbFJlbGV2YW50Qnl0ZXNMb2FkZWQgKz0gcmVsZXZhbnRCeXRlc0xvYWRlZERpZmY7XHJcbiAgICBcclxuICAgIHZhciBkZWNvZGVkT2Zmc2V0dGVkID0ge1xyXG4gICAgICAgIG9yaWdpbmFsUmVxdWVzdFdpZHRoOiB0aGlzLl9yZXF1ZXN0V2lkdGgsXHJcbiAgICAgICAgb3JpZ2luYWxSZXF1ZXN0SGVpZ2h0OiB0aGlzLl9yZXF1ZXN0SGVpZ2h0LFxyXG4gICAgICAgIHhJbk9yaWdpbmFsUmVxdWVzdDogdGhpcy5fb2Zmc2V0WCxcclxuICAgICAgICB5SW5PcmlnaW5hbFJlcXVlc3Q6IHRoaXMuX29mZnNldFksXHJcbiAgICAgICAgXHJcbiAgICAgICAgaW1hZ2VEYXRhOiBkZWNvZGVSZXN1bHQsXHJcbiAgICAgICAgXHJcbiAgICAgICAgYWxsUmVsZXZhbnRCeXRlc0xvYWRlZDogdGhpcy5fbGlzdGVuZXJIYW5kbGUuYWxsUmVsZXZhbnRCeXRlc0xvYWRlZFxyXG4gICAgfTtcclxuICAgIFxyXG4gICAgdGhpcy5fbGlzdGVuZXJIYW5kbGUuY2FsbGJhY2soZGVjb2RlZE9mZnNldHRlZCk7XHJcbn07XHJcblxyXG5EZWNvZGVKb2IucHJvdG90eXBlLm9uVGVybWluYXRlZCA9IGZ1bmN0aW9uIG9uVGVybWluYXRlZCgpIHtcclxuICAgIC8vdGhpcy5fbGlzdGVuZXJIYW5kbGUuaXNBbnlEZWNvZGVyQWJvcnRlZCB8PSB0aGlzLl9pc0Fib3J0ZWQ7XHJcbiAgICBcclxuICAgIHZhciByZW1haW5pbmcgPSAtLXRoaXMuX2xpc3RlbmVySGFuZGxlLnJlbWFpbmluZ0RlY29kZUpvYnM7XHJcbiAgICBpZiAocmVtYWluaW5nIDwgMCkge1xyXG4gICAgICAgIHRocm93ICdJbmNvbnNpc3RlbnQgbnVtYmVyIG9mIGRvbmUgcmVxdWVzdHMnO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICB2YXIgaXNMaXN0ZW5lckRvbmUgPSByZW1haW5pbmcgPT09IDA7XHJcbiAgICBpZiAoaXNMaXN0ZW5lckRvbmUpIHtcclxuICAgICAgICB0aGlzLl9saXN0ZW5lckhhbmRsZS5pc1Rlcm1pbmF0ZWRDYWxsYmFja0NhbGxlZCA9IHRydWU7XHJcbiAgICAgICAgdGhpcy5fbGlzdGVuZXJIYW5kbGUudGVybWluYXRlZENhbGxiYWNrKFxyXG4gICAgICAgICAgICB0aGlzLl9saXN0ZW5lckhhbmRsZS5pc0FueURlY29kZXJBYm9ydGVkKTtcclxuICAgIH1cclxufTsiLCIndXNlIHN0cmljdCc7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IERlY29kZUpvYnNQb29sO1xyXG5cclxudmFyIERlY29kZUpvYiA9IHJlcXVpcmUoJ2RlY29kZWpvYi5qcycpO1xyXG5cclxuZnVuY3Rpb24gRGVjb2RlSm9ic1Bvb2woXHJcbiAgICBkZWNvZGVEZXBlbmRlbmN5V29ya2VycyxcclxuICAgIHRpbGVXaWR0aCxcclxuICAgIHRpbGVIZWlnaHQpIHtcclxuICAgIFxyXG4gICAgdGhpcy5fdGlsZVdpZHRoID0gdGlsZVdpZHRoO1xyXG4gICAgdGhpcy5fdGlsZUhlaWdodCA9IHRpbGVIZWlnaHQ7XHJcbiAgICBcclxuICAgIHRoaXMuX2RlY29kZURlcGVuZGVuY3lXb3JrZXJzID0gZGVjb2RlRGVwZW5kZW5jeVdvcmtlcnM7XHJcbn1cclxuXHJcbkRlY29kZUpvYnNQb29sLnByb3RvdHlwZS5mb3JrRGVjb2RlSm9icyA9IGZ1bmN0aW9uIGZvcmtEZWNvZGVKb2JzKFxyXG4gICAgaW1hZ2VQYXJ0UGFyYW1zLFxyXG4gICAgY2FsbGJhY2ssXHJcbiAgICB0ZXJtaW5hdGVkQ2FsbGJhY2ssXHJcbiAgICBpbWFnZVBhcnRQYXJhbXNOb3ROZWVkZWQpIHtcclxuICAgIFxyXG4gICAgdmFyIG1pblggPSBpbWFnZVBhcnRQYXJhbXMubWluWDtcclxuICAgIHZhciBtaW5ZID0gaW1hZ2VQYXJ0UGFyYW1zLm1pblk7XHJcbiAgICB2YXIgbWF4WCA9IGltYWdlUGFydFBhcmFtcy5tYXhYRXhjbHVzaXZlO1xyXG4gICAgdmFyIG1heFkgPSBpbWFnZVBhcnRQYXJhbXMubWF4WUV4Y2x1c2l2ZTtcclxuICAgIHZhciBsZXZlbCA9IGltYWdlUGFydFBhcmFtcy5sZXZlbCB8fCAwO1xyXG4gICAgdmFyIHF1YWxpdHkgPSBpbWFnZVBhcnRQYXJhbXMucXVhbGl0eTtcclxuICAgIHZhciBwcmlvcml0eURhdGEgPSBpbWFnZVBhcnRQYXJhbXMucmVxdWVzdFByaW9yaXR5RGF0YTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgdmFyIGlzTWluQWxpZ25lZCA9XHJcbiAgICAgICAgbWluWCAlIHRoaXMuX3RpbGVXaWR0aCA9PT0gMCAmJiBtaW5ZICUgdGhpcy5fdGlsZUhlaWdodCA9PT0gMDtcclxuICAgIHZhciBpc01heFhBbGlnbmVkID0gbWF4WCAlIHRoaXMuX3RpbGVXaWR0aCAgPT09IDAgfHwgbWF4WCA9PT0gaW1hZ2VQYXJ0UGFyYW1zLmxldmVsV2lkdGg7XHJcbiAgICB2YXIgaXNNYXhZQWxpZ25lZCA9IG1heFkgJSB0aGlzLl90aWxlSGVpZ2h0ID09PSAwIHx8IG1heFkgPT09IGltYWdlUGFydFBhcmFtcy5sZXZlbEhlaWdodDtcclxuICAgIHZhciBpc09yZGVyVmFsaWQgPSBtaW5YIDwgbWF4WCAmJiBtaW5ZIDwgbWF4WTtcclxuICAgIFxyXG4gICAgaWYgKCFpc01pbkFsaWduZWQgfHwgIWlzTWF4WEFsaWduZWQgfHwgIWlzTWF4WUFsaWduZWQgfHwgIWlzT3JkZXJWYWxpZCkge1xyXG4gICAgICAgIHRocm93ICdpbWFnZVBhcnRQYXJhbXMgZm9yIGRlY29kZXJzIGlzIG5vdCBhbGlnbmVkIHRvICcgK1xyXG4gICAgICAgICAgICAndGlsZSBzaXplIG9yIG5vdCBpbiB2YWxpZCBvcmRlcic7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHZhciBudW1UaWxlc1ggPSBNYXRoLmNlaWwoKG1heFggLSBtaW5YKSAvIHRoaXMuX3RpbGVXaWR0aCk7XHJcbiAgICB2YXIgbnVtVGlsZXNZID0gTWF0aC5jZWlsKChtYXhZIC0gbWluWSkgLyB0aGlzLl90aWxlSGVpZ2h0KTtcclxuICAgIFxyXG4gICAgdmFyIGxpc3RlbmVySGFuZGxlID0ge1xyXG4gICAgICAgIGltYWdlUGFydFBhcmFtczogaW1hZ2VQYXJ0UGFyYW1zLFxyXG4gICAgICAgIGNhbGxiYWNrOiBjYWxsYmFjayxcclxuICAgICAgICB0ZXJtaW5hdGVkQ2FsbGJhY2s6IHRlcm1pbmF0ZWRDYWxsYmFjayxcclxuICAgICAgICByZW1haW5pbmdEZWNvZGVKb2JzOiBudW1UaWxlc1ggKiBudW1UaWxlc1ksXHJcbiAgICAgICAgaXNBbnlEZWNvZGVyQWJvcnRlZDogZmFsc2UsXHJcbiAgICAgICAgaXNUZXJtaW5hdGVkQ2FsbGJhY2tDYWxsZWQ6IGZhbHNlLFxyXG4gICAgICAgIGFsbFJlbGV2YW50Qnl0ZXNMb2FkZWQ6IDAsXHJcbiAgICAgICAgdW5yZWdpc3RlckhhbmRsZXM6IFtdXHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBmb3IgKHZhciB4ID0gbWluWDsgeCA8IG1heFg7IHggKz0gdGhpcy5fdGlsZVdpZHRoKSB7XHJcbiAgICAgICAgdmFyIHNpbmdsZVRpbGVNYXhYID0gTWF0aC5taW4oeCArIHRoaXMuX3RpbGVXaWR0aCwgaW1hZ2VQYXJ0UGFyYW1zLmxldmVsV2lkdGgpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGZvciAodmFyIHkgPSBtaW5ZOyB5IDwgbWF4WTsgeSArPSB0aGlzLl90aWxlSGVpZ2h0KSB7XHJcbiAgICAgICAgICAgIHZhciBzaW5nbGVUaWxlTWF4WSA9IE1hdGgubWluKHkgKyB0aGlzLl90aWxlSGVpZ2h0LCBpbWFnZVBhcnRQYXJhbXMubGV2ZWxIZWlnaHQpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgdmFyIGlzVGlsZU5vdE5lZWRlZCA9IGlzVW5uZWVkZWQoXHJcbiAgICAgICAgICAgICAgICB4LFxyXG4gICAgICAgICAgICAgICAgeSxcclxuICAgICAgICAgICAgICAgIHNpbmdsZVRpbGVNYXhYLFxyXG4gICAgICAgICAgICAgICAgc2luZ2xlVGlsZU1heFksXHJcbiAgICAgICAgICAgICAgICBpbWFnZVBhcnRQYXJhbXNOb3ROZWVkZWQpO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGlmIChpc1RpbGVOb3ROZWVkZWQpIHtcclxuICAgICAgICAgICAgICAgIC0tbGlzdGVuZXJIYW5kbGUucmVtYWluaW5nRGVjb2RlSm9icztcclxuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICB2YXIgc2luZ2xlVGlsZUltYWdlUGFydFBhcmFtcyA9IHtcclxuICAgICAgICAgICAgICAgIG1pblg6IHgsXHJcbiAgICAgICAgICAgICAgICBtaW5ZOiB5LFxyXG4gICAgICAgICAgICAgICAgbWF4WEV4Y2x1c2l2ZTogc2luZ2xlVGlsZU1heFgsXHJcbiAgICAgICAgICAgICAgICBtYXhZRXhjbHVzaXZlOiBzaW5nbGVUaWxlTWF4WSxcclxuICAgICAgICAgICAgICAgIGxldmVsV2lkdGg6IGltYWdlUGFydFBhcmFtcy5sZXZlbFdpZHRoLFxyXG4gICAgICAgICAgICAgICAgbGV2ZWxIZWlnaHQ6IGltYWdlUGFydFBhcmFtcy5sZXZlbEhlaWdodCxcclxuICAgICAgICAgICAgICAgIGxldmVsOiBsZXZlbCxcclxuICAgICAgICAgICAgICAgIHF1YWxpdHk6IHF1YWxpdHksXHJcbiAgICAgICAgICAgICAgICByZXF1ZXN0UHJpb3JpdHlEYXRhOiBwcmlvcml0eURhdGFcclxuICAgICAgICAgICAgfTtcclxuXHJcbiAgICAgICAgICAgIHZhciBkZWNvZGVKb2IgPSBuZXcgRGVjb2RlSm9iKFxyXG4gICAgICAgICAgICAgICAgbGlzdGVuZXJIYW5kbGUsXHJcbiAgICAgICAgICAgICAgICBzaW5nbGVUaWxlSW1hZ2VQYXJ0UGFyYW1zKTtcclxuXHJcbiAgICAgICAgICAgIHZhciB0YXNrSGFuZGxlID1cclxuICAgICAgICAgICAgICAgIHRoaXMuX2RlY29kZURlcGVuZGVuY3lXb3JrZXJzLnN0YXJ0VGFzayhcclxuICAgICAgICAgICAgICAgICAgICBzaW5nbGVUaWxlSW1hZ2VQYXJ0UGFyYW1zLCBkZWNvZGVKb2IpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgbGlzdGVuZXJIYW5kbGUudW5yZWdpc3RlckhhbmRsZXMucHVzaCh0YXNrSGFuZGxlKTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGlmICghbGlzdGVuZXJIYW5kbGUuaXNUZXJtaW5hdGVkQ2FsbGJhY2tDYWxsZWQgJiZcclxuICAgICAgICBsaXN0ZW5lckhhbmRsZS5yZW1haW5pbmdEZWNvZGVKb2JzID09PSAwKSB7XHJcbiAgICAgICAgXHJcbiAgICAgICAgbGlzdGVuZXJIYW5kbGUuaXNUZXJtaW5hdGVkQ2FsbGJhY2tDYWxsZWQgPSB0cnVlO1xyXG4gICAgICAgIGxpc3RlbmVySGFuZGxlLnRlcm1pbmF0ZWRDYWxsYmFjayhsaXN0ZW5lckhhbmRsZS5pc0FueURlY29kZXJBYm9ydGVkKTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgcmV0dXJuIGxpc3RlbmVySGFuZGxlO1xyXG59O1xyXG5cclxuRGVjb2RlSm9ic1Bvb2wucHJvdG90eXBlLnVucmVnaXN0ZXJGb3JrZWRKb2JzID0gZnVuY3Rpb24gdW5yZWdpc3RlckZvcmtlZEpvYnMoXHJcbiAgICBsaXN0ZW5lckhhbmRsZSkge1xyXG4gICAgICAgICAgICBcclxuICAgIGlmIChsaXN0ZW5lckhhbmRsZS5yZW1haW5pbmdEZWNvZGVKb2JzID09PSAwKSB7XHJcbiAgICAgICAgLy8gQWxsIGpvYnMgaGFzIGFscmVhZHkgYmVlbiB0ZXJtaW5hdGVkLCBubyBuZWVkIHRvIHVucmVnaXN0ZXJcclxuICAgICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgbGlzdGVuZXJIYW5kbGUudW5yZWdpc3RlckhhbmRsZXMubGVuZ3RoOyArK2kpIHtcclxuICAgICAgICBsaXN0ZW5lckhhbmRsZS51bnJlZ2lzdGVySGFuZGxlc1tpXS51bnJlZ2lzdGVyKCk7XHJcbiAgICB9XHJcbn07XHJcblxyXG5mdW5jdGlvbiBpc1VubmVlZGVkKFxyXG4gICAgbWluWCwgbWluWSwgbWF4WCwgbWF4WSwgaW1hZ2VQYXJ0UGFyYW1zTm90TmVlZGVkKSB7XHJcbiAgICBcclxuICAgIGlmIChpbWFnZVBhcnRQYXJhbXNOb3ROZWVkZWQgPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIHJldHVybiBmYWxzZTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBpbWFnZVBhcnRQYXJhbXNOb3ROZWVkZWQubGVuZ3RoOyArK2kpIHtcclxuICAgICAgICB2YXIgbm90TmVlZGVkID0gaW1hZ2VQYXJ0UGFyYW1zTm90TmVlZGVkW2ldO1xyXG4gICAgICAgIHZhciBpc0luWCA9IG1pblggPj0gbm90TmVlZGVkLm1pblggJiYgbWF4WCA8PSBub3ROZWVkZWQubWF4WEV4Y2x1c2l2ZTtcclxuICAgICAgICB2YXIgaXNJblkgPSBtaW5ZID49IG5vdE5lZWRlZC5taW5ZICYmIG1heFkgPD0gbm90TmVlZGVkLm1heFlFeGNsdXNpdmU7XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKGlzSW5YICYmIGlzSW5ZKSB7XHJcbiAgICAgICAgICAgIHJldHVybiB0cnVlO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuICAgIFxyXG4gICAgcmV0dXJuIGZhbHNlO1xyXG59IiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBGZXRjaEpvYjtcclxuXHJcbkZldGNoSm9iLkZFVENIX1RZUEVfUkVRVUVTVCA9IDE7XHJcbkZldGNoSm9iLkZFVENIX1RZUEVfQ0hBTk5FTCA9IDI7IC8vIG1vdmFibGVcclxuRmV0Y2hKb2IuRkVUQ0hfVFlQRV9PTkxZX1dBSVRfRk9SX0RBVEEgPSAzO1xyXG5cclxuRmV0Y2hKb2IuRkVUQ0hfU1RBVFVTX1dBSVRfRk9SX0ZFVENIX0NBTEwgPSAxO1xyXG5GZXRjaEpvYi5GRVRDSF9TVEFUVVNfUkVRVUVTVF9XQUlUX0ZPUl9TQ0hFRFVMRSA9IDI7XHJcbkZldGNoSm9iLkZFVENIX1NUQVRVU19BQ1RJVkUgPSAzO1xyXG5GZXRjaEpvYi5GRVRDSF9TVEFUVVNfUkVRVUVTVF9BQk9VVF9UT19ZSUVMRCA9IDQ7XHJcbkZldGNoSm9iLkZFVENIX1NUQVRVU19SRVFVRVNUX1lJRUxERUQgPSA2O1xyXG5GZXRjaEpvYi5GRVRDSF9TVEFUVVNfUkVRVUVTVF9BQk9VVF9UT19BQk9SVCA9IDg7XHJcbkZldGNoSm9iLkZFVENIX1NUQVRVU19SRVFVRVNUX1RFUk1JTkFURUQgPSA5O1xyXG5GZXRjaEpvYi5GRVRDSF9TVEFUVVNfVU5FWFBFQ1RFRF9GQUlMVVJFID0gMTA7XHJcblxyXG5mdW5jdGlvbiBGZXRjaEpvYihmZXRjaGVyLCBzY2hlZHVsZXIsIHNjaGVkdWxlZEpvYnNMaXN0LCBmZXRjaFR5cGUsIGNvbnRleHRWYXJzKSB7XHJcbiAgICB0aGlzLl9mZXRjaGVyID0gZmV0Y2hlcjtcclxuICAgIHRoaXMuX3NjaGVkdWxlciA9IHNjaGVkdWxlcjtcclxuICAgIHRoaXMuX3NjaGVkdWxlZEpvYnNMaXN0ID0gc2NoZWR1bGVkSm9ic0xpc3Q7XHJcbiAgICB0aGlzLl9zY2hlZHVsZWRKb2JzTGlzdEl0ZXJhdG9yID0gbnVsbDtcclxuICAgIFxyXG4gICAgdGhpcy5fdGVybWluYXRlZExpc3RlbmVycyA9IFtdO1xyXG4gICAgXHJcbiAgICB0aGlzLl9pbWFnZVBhcnRQYXJhbXMgPSBudWxsO1xyXG4gICAgXHJcbiAgICB0aGlzLl9zdGF0ZSA9IEZldGNoSm9iLkZFVENIX1NUQVRVU19XQUlUX0ZPUl9GRVRDSF9DQUxMO1xyXG4gICAgdGhpcy5faXNDaGFubmVsID0gZmV0Y2hUeXBlID09PSBGZXRjaEpvYi5GRVRDSF9UWVBFX0NIQU5ORUw7XHJcbiAgICB0aGlzLl9jb250ZXh0VmFycyA9IGNvbnRleHRWYXJzO1xyXG4gICAgdGhpcy5faXNPbmx5V2FpdEZvckRhdGEgPSBmZXRjaFR5cGUgPT09IEZldGNoSm9iLkZFVENIX1RZUEVfT05MWV9XQUlUX0ZPUl9EQVRBO1xyXG4gICAgdGhpcy5fdXNlU2NoZWR1bGVyID0gZmV0Y2hUeXBlID09PSBGZXRjaEpvYi5GRVRDSF9UWVBFX1JFUVVFU1Q7XHJcbiAgICB0aGlzLl9yZXNvdXJjZSA9IG51bGw7XHJcbiAgICB0aGlzLl9mZXRjaEhhbmRsZSA9IG51bGw7XHJcbiAgICB0aGlzLl9mZXRjaFRlcm1pbmF0ZWRCb3VuZCA9IHRoaXMuX2ZldGNoVGVybWluYXRlZC5iaW5kKHRoaXMpO1xyXG4gICAgLy90aGlzLl9hbHJlYWR5VGVybWluYXRlZFdoZW5BbGxEYXRhQXJyaXZlZCA9IGZhbHNlO1xyXG4gICAgXHJcbiAgICBpZiAoZmV0Y2hUeXBlID09PSBGZXRjaEpvYi5GRVRDSF9UWVBFX0NIQU5ORUwpIHtcclxuICAgICAgICB0aGlzLl9tb3ZhYmxlRmV0Y2hTdGF0ZSA9IHt9O1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgICB0aGlzLl9tb3ZhYmxlRmV0Y2hTdGF0ZSA9IG51bGw7XHJcbiAgICB9XHJcbn1cclxuXHJcbkZldGNoSm9iLnByb3RvdHlwZS5mZXRjaCA9IGZ1bmN0aW9uIGZldGNoKGltYWdlUGFydFBhcmFtcykge1xyXG4gICAgaWYgKHRoaXMuX2lzQ2hhbm5lbCkge1xyXG4gICAgICAgIHRoaXMuX2ltYWdlUGFydFBhcmFtcyA9IGltYWdlUGFydFBhcmFtcztcclxuICAgICAgICB0aGlzLl9zdGFydEZldGNoKCk7XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBpZiAodGhpcy5faW1hZ2VQYXJ0UGFyYW1zICE9PSBudWxsKSB7XHJcbiAgICAgICAgdGhyb3cgJ0Nhbm5vdCBmZXRjaCB0d2ljZSBvbiBmZXRjaCB0eXBlIG9mIFwicmVxdWVzdFwiJztcclxuICAgIH1cclxuICAgIFxyXG4gICAgaWYgKHRoaXMuX3N0YXRlICE9PSBGZXRjaEpvYi5GRVRDSF9TVEFUVVNfV0FJVF9GT1JfRkVUQ0hfQ0FMTCkge1xyXG4gICAgICAgIHRoaXMuX3N0YXRlID0gRmV0Y2hKb2IuRkVUQ0hfU1RBVFVTX1VORVhQRUNURURfRkFJTFVSRTtcclxuICAgICAgICB0aHJvdyAnVW5leHBlY3RlZCBzdGF0ZSBvbiBmZXRjaCgpOiAnICsgdGhpcy5fc3RhdGU7XHJcbiAgICB9XHJcblxyXG4gICAgdGhpcy5faW1hZ2VQYXJ0UGFyYW1zID0gaW1hZ2VQYXJ0UGFyYW1zO1xyXG4gICAgdGhpcy5fc3RhdGUgPSBGZXRjaEpvYi5GRVRDSF9TVEFUVVNfUkVRVUVTVF9XQUlUX0ZPUl9TQ0hFRFVMRTtcclxuICAgIFxyXG4gICAgaWYgKCF0aGlzLl91c2VTY2hlZHVsZXIpIHtcclxuICAgICAgICBzdGFydFJlcXVlc3QoLypyZXNvdXJjZT0qL251bGwsIHRoaXMpO1xyXG4gICAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIFxyXG4gICAgdGhpcy5fc2NoZWR1bGVyLmVucXVldWVKb2Ioc3RhcnRSZXF1ZXN0LCB0aGlzLCBmZXRjaEFib3J0ZWRCeVNjaGVkdWxlcik7XHJcbn07XHJcblxyXG5GZXRjaEpvYi5wcm90b3R5cGUubWFudWFsQWJvcnRSZXF1ZXN0ID0gZnVuY3Rpb24gbWFudWFsQWJvcnRSZXF1ZXN0KCkge1xyXG4gICAgc3dpdGNoICh0aGlzLl9zdGF0ZSkge1xyXG4gICAgICAgIGNhc2UgRmV0Y2hKb2IuRkVUQ0hfU1RBVFVTX1JFUVVFU1RfVEVSTUlOQVRFRDpcclxuICAgICAgICBjYXNlIEZldGNoSm9iLkZFVENIX1NUQVRVU19VTkVYUEVDVEVEX0ZBSUxVUkU6XHJcbiAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICBjYXNlIEZldGNoSm9iLkZFVENIX1NUQVRVU19SRVFVRVNUX0FCT1VUX1RPX0FCT1JUOlxyXG4gICAgICAgICAgICB0aHJvdyAnRG91YmxlIGNhbGwgdG8gbWFudWFsQWJvcnRSZXF1ZXN0KCknO1xyXG4gICAgICAgIGNhc2UgRmV0Y2hKb2IuRkVUQ0hfU1RBVFVTX0FDVElWRTpcclxuICAgICAgICAgICAgdmFyIHNlbGYgPSB0aGlzO1xyXG4gICAgICAgICAgICB0aGlzLl9zdGF0ZSA9IEZldGNoSm9iLkZFVENIX1NUQVRVU19SRVFVRVNUX0FCT1VUX1RPX0FCT1JUO1xyXG4gICAgICAgICAgICBpZiAoc2VsZi5faXNPbmx5V2FpdEZvckRhdGEpIHtcclxuICAgICAgICAgICAgICAgIHNlbGYuX2ZldGNoVGVybWluYXRlZCgvKmlzQWJvcnRlZD0qL3RydWUpO1xyXG4gICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgdGhpcy5fZmV0Y2hIYW5kbGUuc3RvcEFzeW5jKCkudGhlbihmdW5jdGlvbigpIHtcclxuICAgICAgICAgICAgICAgICAgICBzZWxmLl9mZXRjaFRlcm1pbmF0ZWQoLyppc0Fib3J0ZWQ9Ki90cnVlKTtcclxuICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGJyZWFrO1xyXG4gICAgICAgIGNhc2UgRmV0Y2hKb2IuRkVUQ0hfU1RBVFVTX1dBSVRfRk9SX0ZFVENIX0NBTEw6XHJcbiAgICAgICAgICAgIHRoaXMuX3N0YXRlID0gRmV0Y2hKb2IuRkVUQ0hfU1RBVFVTX1JFUVVFU1RfVEVSTUlOQVRFRDtcclxuICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgIGNhc2UgRmV0Y2hKb2IuRkVUQ0hfU1RBVFVTX1JFUVVFU1RfV0FJVF9GT1JfU0NIRURVTEU6XHJcbiAgICAgICAgY2FzZSBGZXRjaEpvYi5GRVRDSF9TVEFUVVNfUkVRVUVTVF9BQk9VVF9UT19ZSUVMRDpcclxuICAgICAgICBjYXNlIEZldGNoSm9iLkZFVENIX1NUQVRVU19SRVFVRVNUX1lJRUxERUQ6XHJcbiAgICAgICAgICAgIHRoaXMuX3N0YXRlID0gRmV0Y2hKb2IuRkVUQ0hfU1RBVFVTX1JFUVVFU1RfQUJPVVRfVE9fQUJPUlQ7XHJcbiAgICAgICAgICAgIGJyZWFrO1xyXG4gICAgICAgIGRlZmF1bHQ6XHJcbiAgICAgICAgICAgIHRocm93ICdVbmtub3duIHN0YXRlIGluIG1hbnVhbEFib3J0UmVxdWVzdCgpIGltcGxlbWVudGF0aW9uOiAnICsgdGhpcy5fc3RhdGU7XHJcbiAgICB9XHJcbn07XHJcblxyXG5GZXRjaEpvYi5wcm90b3R5cGUuZ2V0Q29udGV4dFZhcnMgPSBmdW5jdGlvbiBnZXRDb250ZXh0VmFycyhyZXF1ZXN0SWQpIHtcclxuICAgIHJldHVybiB0aGlzLl9jb250ZXh0VmFycztcclxufTtcclxuXHJcbkZldGNoSm9iLnByb3RvdHlwZS5vbiA9IGZ1bmN0aW9uIG9uKGV2ZW50LCBsaXN0ZW5lcikge1xyXG4gICAgc3dpdGNoIChldmVudCkge1xyXG4gICAgICAgIGNhc2UgJ3Rlcm1pbmF0ZWQnOlxyXG4gICAgICAgICAgICB0aGlzLl90ZXJtaW5hdGVkTGlzdGVuZXJzLnB1c2gobGlzdGVuZXIpO1xyXG4gICAgICAgICAgICBicmVhaztcclxuICAgICAgICBkZWZhdWx0OlxyXG4gICAgICAgICAgICB0aHJvdyAnVW5leHBlY3RlZCBldmVudCAnICsgZXZlbnQ7XHJcbiAgICB9XHJcbn07XHJcblxyXG5GZXRjaEpvYi5wcm90b3R5cGUuc2V0SXNQcm9ncmVzc2l2ZSA9IGZ1bmN0aW9uIHNldElzUHJvZ3Jlc3NpdmUoaXNQcm9ncmVzc2l2ZSkge1xyXG4gICAgdGhpcy5faXNQcm9ncmVzc2l2ZSA9IGlzUHJvZ3Jlc3NpdmU7XHJcbiAgICBpZiAodGhpcy5fZmV0Y2hIYW5kbGUgIT09IG51bGwpIHtcclxuICAgICAgICB0aGlzLl9mZXRjaEhhbmRsZS5zZXRJc1Byb2dyZXNzaXZlKGlzUHJvZ3Jlc3NpdmUpO1xyXG4gICAgfVxyXG59O1xyXG5cclxuRmV0Y2hKb2IucHJvdG90eXBlLmdldElzUHJvZ3Jlc3NpdmUgPSBmdW5jdGlvbiBnZXRJc1Byb2dyZXNzaXZlKCkge1xyXG4gICAgcmV0dXJuIHRoaXMuX2lzUHJvZ3Jlc3NpdmU7XHJcbn07XHJcblxyXG5GZXRjaEpvYi5wcm90b3R5cGUuX3N0YXJ0RmV0Y2ggPSBmdW5jdGlvbiBzdGFydEZldGNoKCkge1xyXG4gICAgdmFyIHByZXZTdGF0ZSA9IHRoaXMuX3N0YXRlO1xyXG4gICAgdGhpcy5fc3RhdGUgPSBGZXRjaEpvYi5GRVRDSF9TVEFUVVNfQUNUSVZFO1xyXG4gICAgXHJcbiAgICBpZiAodGhpcy5faXNPbmx5V2FpdEZvckRhdGEpIHtcclxuICAgICAgICB0aGlzLl9mZXRjaEhhbmRsZSA9IHRoaXMuX2V4dHJhY3RBbHJlYWR5RmV0Y2hlZERhdGEoKTtcclxuICAgIH0gZWxzZSBpZiAoIXRoaXMuX2lzQ2hhbm5lbCkge1xyXG4gICAgICAgIHRoaXMuX2ZldGNoSGFuZGxlID0gdGhpcy5fZmV0Y2hlci5mZXRjaCh0aGlzLl9pbWFnZVBhcnRQYXJhbXMpO1xyXG4gICAgfSBlbHNlIGlmIChwcmV2U3RhdGUgIT09IEZldGNoSm9iLkZFVENIX1NUQVRVU19XQUlUX0ZPUl9GRVRDSF9DQUxMKSB7XHJcbiAgICAgICAgdGhpcy5fZmV0Y2hIYW5kbGUgPSB0aGlzLl9mZXRjaGVyLm1vdmVGZXRjaChcclxuICAgICAgICAgICAgdGhpcy5faW1hZ2VQYXJ0UGFyYW1zLCB0aGlzLl9tb3ZhYmxlRmV0Y2hTdGF0ZSk7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICAgIHRoaXMuX2ZldGNoSGFuZGxlID0gdGhpcy5fZmV0Y2hlci5zdGFydE1vdmFibGVGZXRjaChcclxuICAgICAgICAgICAgdGhpcy5faW1hZ2VQYXJ0UGFyYW1zLCB0aGlzLl9tb3ZhYmxlRmV0Y2hTdGF0ZSk7XHJcbiAgICB9XHJcbiAgICB0aGlzLl9mZXRjaEhhbmRsZS5vbigndGVybWluYXRlZCcsIHRoaXMuX2ZldGNoVGVybWluYXRlZEJvdW5kKTtcclxuICAgIHRoaXMuX2ZldGNoSGFuZGxlLnNldElzUHJvZ3Jlc3NpdmUodGhpcy5faXNQcm9ncmVzc2l2ZSk7XHJcbn07XHJcblxyXG5GZXRjaEpvYi5wcm90b3R5cGUuX2ZldGNoVGVybWluYXRlZCA9IGZ1bmN0aW9uIGZldGNoVGVybWluYXRlZChpc0Fib3J0ZWQpIHtcclxuICAgIHN3aXRjaCAodGhpcy5fc3RhdGUpIHtcclxuICAgICAgICBjYXNlIEZldGNoSm9iLkZFVENIX1NUQVRVU19SRVFVRVNUX0FCT1VUX1RPX0FCT1JUOlxyXG4gICAgICAgICAgICBicmVhaztcclxuICAgICAgICBjYXNlIEZldGNoSm9iLkZFVENIX1NUQVRVU19BQ1RJVkU6XHJcbiAgICAgICAgY2FzZSBGZXRjaEpvYi5GRVRDSF9TVEFUVVNfUkVRVUVTVF9BQk9VVF9UT19ZSUVMRDpcclxuICAgICAgICAgICAgaWYgKGlzQWJvcnRlZCkge1xyXG4gICAgICAgICAgICAgICAgdGhpcy5fc3RhdGUgPSBGZXRjaEpvYi5GRVRDSF9TVEFUVVNfVU5FWFBFQ1RFRF9GQUlMVVJFO1xyXG4gICAgICAgICAgICAgICAgdGhyb3cgJ1VuZXhwZWN0ZWQgYWJvcnQgd2hlbiBmZXRjaCBpcyBhY3RpdmUnO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGJyZWFrO1xyXG4gICAgICAgIGRlZmF1bHQ6XHJcbiAgICAgICAgICAgIHRocm93ICdVbmV4cGVjdGVkIHN0YXRlIG9uIGZldGNoIHRlcm1pbmF0ZWQ6ICcgKyB0aGlzLl9zdGF0ZTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgaWYgKHRoaXMuX3Jlc291cmNlICE9PSBudWxsKSB7XHJcbiAgICAgICAgaWYgKGlzQWJvcnRlZCkge1xyXG4gICAgICAgICAgICB0aHJvdyAnVW5leHBlY3RlZCByZXF1ZXN0IHRlcm1pbmF0aW9uIHdpdGhvdXQgcmVzb3VyY2UgYWxsb2NhdGVkJztcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIHRoaXMuX3NjaGVkdWxlZEpvYnNMaXN0LnJlbW92ZSh0aGlzLl9zY2hlZHVsZWRKb2JzTGlzdEl0ZXJhdG9yKTtcclxuICAgICAgICB0aGlzLl9zY2hlZHVsZXJDYWxsYmFja3Muam9iRG9uZSgpO1xyXG5cclxuICAgICAgICB0aGlzLl9yZXNvdXJjZSA9IG51bGw7XHJcbiAgICB9IGVsc2UgaWYgKCFpc0Fib3J0ZWQgJiYgdGhpcy5fdXNlU2NoZWR1bGVyKSB7XHJcbiAgICAgICAgdGhyb3cgJ0pvYiBleHBlY3RlZCB0byBoYXZlIHJlc291cmNlIG9uIHN1Y2Nlc3NmdWwgdGVybWluYXRpb24nO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICAvLyBDaGFubmVsIGlzIG5vdCByZWFsbHkgdGVybWluYXRlZCwgYnV0IG9ubHkgZmV0Y2hlcyBhIG5ldyByZWdpb25cclxuICAgIC8vIChzZWUgbW92ZUNoYW5uZWwoKSkuXHJcbiAgICBpZiAodGhpcy5faXNDaGFubmVsKSB7XHJcblx0XHRyZXR1cm47XHJcblx0fVxyXG5cdFxyXG5cdHRoaXMuX3N0YXRlID0gRmV0Y2hKb2IuRkVUQ0hfU1RBVFVTX1JFUVVFU1RfVEVSTUlOQVRFRDtcclxuXHRcclxuXHRmb3IgKHZhciBpID0gMDsgaSA8IHRoaXMuX3Rlcm1pbmF0ZWRMaXN0ZW5lcnMubGVuZ3RoOyArK2kpIHtcclxuXHRcdHRoaXMuX3Rlcm1pbmF0ZWRMaXN0ZW5lcnNbaV0odGhpcy5fY29udGV4dFZhcnMsIGlzQWJvcnRlZCk7XHJcblx0fVxyXG4gICAgXHJcbiAgICBpZiAodGhpcy5fZmV0Y2hIYW5kbGUgIT09IG51bGwgJiZcclxuICAgICAgICB0aGlzLl9zdGF0ZSAhPT0gRmV0Y2hKb2IuRkVUQ0hfU1RBVFVTX1VORVhQRUNURURfRkFJTFVSRSkge1xyXG4gICAgICAgICAgICBcclxuICAgICAgICB0aGlzLl9mZXRjaEhhbmRsZS5kaXNwb3NlKCk7XHJcbiAgICAgICAgdGhpcy5fZmV0Y2hIYW5kbGUgPSBudWxsO1xyXG4gICAgfVxyXG59O1xyXG5cclxuRmV0Y2hKb2IucHJvdG90eXBlLmNoZWNrSWZTaG91bGRZaWVsZCA9IGZ1bmN0aW9uIGNoZWNrSWZTaG91bGRZaWVsZCgpIHtcclxuICAgIHRyeSB7XHJcbiAgICAgICAgaWYgKCF0aGlzLl91c2VTY2hlZHVsZXIgfHwgdGhpcy5fc3RhdGUgPT09IEZldGNoSm9iLkZFVENIX1NUQVRVU19SRVFVRVNUX1RFUk1JTkFURUQpIHtcclxuICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBpZiAodGhpcy5fcmVzb3VyY2UgPT09IG51bGwpIHtcclxuICAgICAgICAgICAgdGhyb3cgJ05vIHJlc291cmNlIGFsbG9jYXRlZCBidXQgZmV0Y2ggY2FsbGJhY2sgY2FsbGVkJztcclxuICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgIGlmICghdGhpcy5fc2NoZWR1bGVyQ2FsbGJhY2tzLnNob3VsZFlpZWxkT3JBYm9ydCgpKSB7XHJcbiAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgdGhpcy5fc3RhdGUgPSBGZXRjaEpvYi5GRVRDSF9TVEFUVVNfUkVRVUVTVF9BQk9VVF9UT19ZSUVMRDtcclxuICAgICAgICB2YXIgc2VsZiA9IHRoaXM7XHJcbiAgICAgICAgdGhpcy5fZmV0Y2hIYW5kbGUuc3RvcEFzeW5jKCkudGhlbihmdW5jdGlvbigpIHtcclxuICAgICAgICAgICAgaWYgKHNlbGYuX2ZldGNoU3RhdGUgPT09IEZldGNoSm9iLkZFVENIX1NUQVRVU19SRVFVRVNUX0FCT1VUX1RPX0FCT1JUKSB7XHJcbiAgICAgICAgICAgICAgICBzZWxmLl9mZXRjaFRlcm1pbmF0ZWQoLyppc0Fib3J0ZWQ9Ki90cnVlKTtcclxuICAgICAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgdmFyIGlzWWllbGRlZCA9IHNlbGYuX3NjaGVkdWxlckNhbGxiYWNrcy50cnlZaWVsZChcclxuICAgICAgICAgICAgICAgIGNvbnRpbnVlWWllbGRlZFJlcXVlc3QsXHJcbiAgICAgICAgICAgICAgICBmZXRjaEFib3J0ZWRCeVNjaGVkdWxlcixcclxuICAgICAgICAgICAgICAgIGZldGNoWWllbGRlZEJ5U2NoZWR1bGVyKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGlmICghaXNZaWVsZGVkKSB7XHJcbiAgICAgICAgICAgICAgICBpZiAoc2VsZi5fc3RhdGUgIT09IEZldGNoSm9iLkZFVENIX1NUQVRVU19SRVFVRVNUX0FCT1VUX1RPX1lJRUxEKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhyb3cgJ1VuZXhwZWN0ZWQgc3RhdGUgb24gdHJ5WWllbGQoKSBmYWxzZTogJyArIHNlbGYuX3N0YXRlO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgc2VsZi5fc3RhdGUgPSBGZXRjaEpvYi5GRVRDSF9TVEFUVVNfQUNUSVZFO1xyXG4gICAgICAgICAgICAgICAgc2VsZi5fZmV0Y2hIYW5kbGUucmVzdW1lKCk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9KS5jYXRjaChmdW5jdGlvbigpIHtcclxuICAgICAgICAgICAgc2VsZi5fc3RhdGUgPSBGZXRjaEpvYi5GRVRDSF9TVEFUVVNfVU5FWFBFQ1RFRF9GQUlMVVJFO1xyXG4gICAgICAgICAgICBmZXRjaEFib3J0ZWRCeVNjaGVkdWxlcihzZWxmKTtcclxuICAgICAgICB9KTtcclxuICAgIH0gY2F0Y2ggKGUpIHtcclxuICAgICAgICB0aGlzLl9zdGF0ZSA9IEZldGNoSm9iLkZFVENIX1NUQVRVU19VTkVYUEVDVEVEX0ZBSUxVUkU7XHJcbiAgICAgICAgZmV0Y2hBYm9ydGVkQnlTY2hlZHVsZXIodGhpcyk7XHJcbiAgICB9XHJcbn07XHJcblxyXG4vLyBQcm9wZXJ0aWVzIGZvciBGcnVzdHVtUmVxdWVzZXRQcmlvcml0aXplclxyXG5cclxuT2JqZWN0LmRlZmluZVByb3BlcnR5KEZldGNoSm9iLnByb3RvdHlwZSwgJ2ltYWdlUGFydFBhcmFtcycsIHtcclxuICAgIGdldDogZnVuY3Rpb24gZ2V0SW1hZ2VQYXJ0UGFyYW1zKCkge1xyXG4gICAgICAgIHJldHVybiB0aGlzLl9pbWFnZVBhcnRQYXJhbXM7XHJcbiAgICB9XHJcbn0pO1xyXG5cclxuZnVuY3Rpb24gc3RhcnRSZXF1ZXN0KHJlc291cmNlLCBzZWxmLCBjYWxsYmFja3MpIHtcclxuICAgIGlmIChzZWxmLl9mZXRjaEhhbmRsZSAhPT0gbnVsbCB8fCBzZWxmLl9yZXNvdXJjZSAhPT0gbnVsbCkge1xyXG4gICAgICAgIHRocm93ICdVbmV4cGVjdGVkIHJlc3RhcnQgb2YgYWxyZWFkeSBzdGFydGVkIHJlcXVlc3QnO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBpZiAoc2VsZi5fc3RhdGUgPT09IEZldGNoSm9iLkZFVENIX1NUQVRVU19SRVFVRVNUX0FCT1VUX1RPX0FCT1JUKSB7XHJcbiAgICAgICAgc2VsZi5fZmV0Y2hUZXJtaW5hdGVkKC8qaXNBYm9ydGVkPSovdHJ1ZSk7XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgfSBlbHNlIGlmIChzZWxmLl9zdGF0ZSAhPT0gRmV0Y2hKb2IuRkVUQ0hfU1RBVFVTX1JFUVVFU1RfV0FJVF9GT1JfU0NIRURVTEUpIHtcclxuICAgICAgICB0aHJvdyAnVW5leHBlY3RlZCBzdGF0ZSBvbiBzY2hlZHVsZTogJyArIHNlbGYuX3N0YXRlO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBzZWxmLl9yZXNvdXJjZSA9IHJlc291cmNlO1xyXG5cdHNlbGYuX3NjaGVkdWxlckNhbGxiYWNrcyA9IGNhbGxiYWNrcztcclxuXHJcbiAgICBpZiAocmVzb3VyY2UgIT09IG51bGwpIHtcclxuICAgICAgICBzZWxmLl9zY2hlZHVsZWRKb2JzTGlzdEl0ZXJhdG9yID0gc2VsZi5fc2NoZWR1bGVkSm9ic0xpc3QuYWRkKHNlbGYpO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBzZWxmLl9zdGFydEZldGNoKCk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGNvbnRpbnVlWWllbGRlZFJlcXVlc3QocmVzb3VyY2UsIHNlbGYpIHtcclxuICAgIGlmIChzZWxmLmlzQ2hhbm5lbCkge1xyXG4gICAgICAgIHRocm93ICdVbmV4cGVjdGVkIGNhbGwgdG8gY29udGludWVZaWVsZGVkUmVxdWVzdCBvbiBjaGFubmVsJztcclxuICAgIH1cclxuXHJcbiAgICBpZiAoc2VsZi5fc3RhdGUgPT09IEZldGNoSm9iLkZFVENIX1NUQVRVU19SRVFVRVNUX0FCT1VUX1RPX0FCT1JUIHx8XHJcbiAgICAgICAgc2VsZi5fc3RhdGUgPT09IEZldGNoSm9iLkZFVENIX1NUQVRVU19VTkVYUEVDVEVEX0ZBSUxVUkUpIHtcclxuICAgICAgICBcclxuICAgICAgICBzZWxmLl9zY2hlZHVsZXJDYWxsYmFja3Muam9iRG9uZSgpO1xyXG4gICAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIFxyXG4gICAgaWYgKHNlbGYuX3N0YXRlICE9PSBGZXRjaEpvYi5GRVRDSF9TVEFUVVNfUkVRVUVTVF9ZSUVMREVEKSB7XHJcbiAgICAgICAgdGhyb3cgJ1VuZXhwZWN0ZWQgcmVxdWVzdCBzdGF0ZSBvbiBjb250aW51ZTogJyArIHNlbGYuX3N0YXRlO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBzZWxmLl9zdGF0ZSA9IEZldGNoSm9iLkZFVENIX1NUQVRVU19BQ1RJVkU7XHJcbiAgICBzZWxmLl9yZXNvdXJjZSA9IHJlc291cmNlO1xyXG4gICAgXHJcbiAgICBzZWxmLl9zY2hlZHVsZWRKb2JzTGlzdEl0ZXJhdG9yID0gc2VsZi5fc2NoZWR1bGVkSm9ic0xpc3QuYWRkKHNlbGYpO1xyXG4gICAgc2VsZi5fZmV0Y2hIYW5kbGUucmVzdW1lKCk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGZldGNoWWllbGRlZEJ5U2NoZWR1bGVyKHNlbGYpIHtcclxuICAgIHZhciBuZXh0U3RhdGU7XHJcbiAgICBzZWxmLl9yZXNvdXJjZSA9IG51bGw7XHJcbiAgICBzZWxmLl9zY2hlZHVsZWRKb2JzTGlzdC5yZW1vdmUoc2VsZi5fc2NoZWR1bGVkSm9ic0xpc3RJdGVyYXRvcik7XHJcbiAgICBpZiAoc2VsZi5zdGF0ZSA9PT0gRmV0Y2hKb2IuRkVUQ0hfU1RBVFVTX1JFUVVFU1RfQUJPVVRfVE9fWUlFTEQpIHtcclxuICAgICAgICBzZWxmLl9zdGF0ZSA9IEZldGNoSm9iLkZFVENIX1NUQVRVU19SRVFVRVNUX1lJRUxERUQ7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICAgIHNlbGYuX3N0YXRlID0gRmV0Y2hKb2IuRkVUQ0hfU1RBVFVTX1VORVhQRUNURURfRkFJTFVSRTtcclxuICAgICAgICB0aHJvdyAnVW5leHBlY3RlZCByZXF1ZXN0IHN0YXRlIG9uIHlpZWxkIHByb2Nlc3M6ICcgKyBzZWxmLl9zdGF0ZTtcclxuICAgIH1cclxufVxyXG5cclxuZnVuY3Rpb24gZmV0Y2hBYm9ydGVkQnlTY2hlZHVsZXIoc2VsZikge1xyXG4gICAgc2VsZi5fcmVzb3VyY2UgPSBudWxsO1xyXG4gICAgc2VsZi5fZmV0Y2hUZXJtaW5hdGVkKC8qaXNBYm9ydGVkPSovdHJ1ZSk7XHJcbn0iLCIndXNlIHN0cmljdCc7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IEZldGNoTWFuYWdlcjtcclxuXHJcbnZhciBpbWFnZUhlbHBlckZ1bmN0aW9ucyA9IHJlcXVpcmUoJ2ltYWdlaGVscGVyZnVuY3Rpb25zLmpzJyk7XHJcbnZhciBGZXRjaEpvYiA9IHJlcXVpcmUoJ2ZldGNoam9iLmpzJyk7XHJcbnZhciBJbWFnZVBhcmFtc1JldHJpZXZlclByb3h5ID0gcmVxdWlyZSgnaW1hZ2VwYXJhbXNyZXRyaWV2ZXJwcm94eS5qcycpO1xyXG52YXIgTGlua2VkTGlzdCA9IHJlcXVpcmUoJ2xpbmtlZGxpc3QuanMnKTtcclxuXHJcbi8qIGdsb2JhbCBjb25zb2xlOiBmYWxzZSAqL1xyXG4vKiBnbG9iYWwgUHJvbWlzZTogZmFsc2UgKi9cclxuXHJcbmZ1bmN0aW9uIEZldGNoTWFuYWdlcihmZXRjaGVyLCBvcHRpb25zKSB7XHJcbiAgICBJbWFnZVBhcmFtc1JldHJpZXZlclByb3h5LmNhbGwodGhpcyk7XHJcblxyXG4gICAgb3B0aW9ucyA9IG9wdGlvbnMgfHwge307XHJcbiAgICB2YXIgc2VydmVyUmVxdWVzdHNMaW1pdCA9IG9wdGlvbnMuc2VydmVyUmVxdWVzdHNMaW1pdCB8fCA1O1xyXG4gICAgXHJcbiAgICB0aGlzLl9mZXRjaGVyID0gZmV0Y2hlcjtcclxuICAgIHRoaXMuX2ludGVybmFsU2l6ZXNQYXJhbXMgPSBudWxsO1xyXG4gICAgdGhpcy5fc2hvd0xvZyA9IG9wdGlvbnMuc2hvd0xvZztcclxuICAgIFxyXG4gICAgaWYgKHRoaXMuX3Nob3dMb2cpIHtcclxuICAgICAgICAvLyBPbGQgSUVcclxuICAgICAgICB0aHJvdyAnc2hvd0xvZyBpcyBub3Qgc3VwcG9ydGVkIG9uIHRoaXMgYnJvd3Nlcic7XHJcbiAgICB9XHJcblx0XHJcblx0aWYgKCFmZXRjaGVyLm9uKSB7XHJcblx0XHR0aHJvdyAnSW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBGZXRjaGVyIGhhcyBubyBtZXRob2Qgb24oKSc7XHJcblx0fVxyXG5cdGlmICghZmV0Y2hlci5vcGVuKSB7XHJcblx0XHR0aHJvdyAnSW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBGZXRjaGVyIGhhcyBubyBtZXRob2Qgb3BlbigpJztcclxuXHR9XHJcbiAgICBpZiAoIWZldGNoZXIuY2xvc2UpIHtcclxuXHRcdHRocm93ICdJbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IEZldGNoZXIgaGFzIG5vIG1ldGhvZCBjbG9zZSgpJztcclxuXHR9XHJcbiAgICBpZiAoIWZldGNoZXIucmVjb25uZWN0KSB7XHJcblx0XHR0aHJvdyAnSW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBGZXRjaGVyIGhhcyBubyBtZXRob2QgcmVjb25uZWN0KCknO1xyXG5cdH1cclxuICAgIGlmICghZmV0Y2hlci5mZXRjaCkge1xyXG5cdFx0dGhyb3cgJ0ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogRmV0Y2hlciBoYXMgbm8gbWV0aG9kIGZldGNoKCknO1xyXG5cdH1cclxuICAgIGlmICghZmV0Y2hlci5tb3ZlRmV0Y2gpIHtcclxuXHRcdHRocm93ICdJbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IEZldGNoZXIgaGFzIG5vIG1ldGhvZCBtb3ZlRmV0Y2goKSc7XHJcblx0fVxyXG4gICAgaWYgKCFmZXRjaGVyLnN0YXJ0TW92YWJsZUZldGNoKSB7XHJcblx0XHR0aHJvdyAnSW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBGZXRjaGVyIGhhcyBubyBtZXRob2Qgc3RhcnRNb3ZhYmxlRmV0Y2goKSc7XHJcblx0fVxyXG4gICAgXHJcbiAgICB2YXIgc2VydmVyUmVxdWVzdFNjaGVkdWxlciA9IGltYWdlSGVscGVyRnVuY3Rpb25zLmNyZWF0ZVNjaGVkdWxlcihcclxuICAgICAgICBvcHRpb25zLnNob3dMb2csXHJcbiAgICAgICAgb3B0aW9ucy5zZXJ2ZXJSZXF1ZXN0UHJpb3JpdGl6ZXIsXHJcbiAgICAgICAgJ3NlcnZlclJlcXVlc3QnLFxyXG4gICAgICAgIGNyZWF0ZVNlcnZlclJlcXVlc3REdW1teVJlc291cmNlLFxyXG4gICAgICAgIHNlcnZlclJlcXVlc3RzTGltaXQpO1xyXG4gICAgXHJcbiAgICB0aGlzLl9zZXJ2ZXJSZXF1ZXN0UHJpb3JpdGl6ZXIgPSBzZXJ2ZXJSZXF1ZXN0U2NoZWR1bGVyLnByaW9yaXRpemVyO1xyXG4gICAgXHJcbiAgICB0aGlzLl9zY2hlZHVsZXIgPSBzZXJ2ZXJSZXF1ZXN0U2NoZWR1bGVyLnNjaGVkdWxlcjtcclxuICAgIHRoaXMuX2NoYW5uZWxIYW5kbGVDb3VudGVyID0gMDtcclxuICAgIHRoaXMuX2NoYW5uZWxIYW5kbGVzID0gW107XHJcbiAgICB0aGlzLl9yZXF1ZXN0QnlJZCA9IFtdO1xyXG4gICAgdGhpcy5fc2NoZWR1bGVkSm9ic0xpc3QgPSBuZXcgTGlua2VkTGlzdCgpO1xyXG59XHJcblxyXG5GZXRjaE1hbmFnZXIucHJvdG90eXBlID0gT2JqZWN0LmNyZWF0ZShJbWFnZVBhcmFtc1JldHJpZXZlclByb3h5LnByb3RvdHlwZSk7XHJcblxyXG5GZXRjaE1hbmFnZXIucHJvdG90eXBlLm9wZW4gPSBmdW5jdGlvbiBvcGVuKHVybCkge1xyXG4gICAgdmFyIHByb21pc2UgPSB0aGlzLl9mZXRjaGVyLm9wZW4odXJsKTtcclxuICAgIHZhciBzZWxmID0gdGhpcztcclxuICAgIHJldHVybiBwcm9taXNlLnRoZW4oZnVuY3Rpb24ocmVzdWx0KSB7XHJcbiAgICAgICAgc2VsZi5faW50ZXJuYWxTaXplc1BhcmFtcyA9IHJlc3VsdDtcclxuICAgICAgICByZXR1cm4gcmVzdWx0O1xyXG4gICAgfSk7XHJcbn07XHJcblxyXG5GZXRjaE1hbmFnZXIucHJvdG90eXBlLm9uID0gZnVuY3Rpb24gb24oZXZlbnQsIGNhbGxiYWNrKSB7XHJcbiAgICB0aGlzLl9mZXRjaGVyLm9uKGV2ZW50LCBjYWxsYmFjayk7XHJcbn07XHJcblxyXG5GZXRjaE1hbmFnZXIucHJvdG90eXBlLmNsb3NlID0gZnVuY3Rpb24gY2xvc2UoKSB7XHJcbiAgICByZXR1cm4gdGhpcy5fZmV0Y2hlci5jbG9zZSgpO1xyXG59O1xyXG5cclxuRmV0Y2hNYW5hZ2VyLnByb3RvdHlwZS5zZXRJc1Byb2dyZXNzaXZlUmVxdWVzdCA9IGZ1bmN0aW9uIHNldElzUHJvZ3Jlc3NpdmVSZXF1ZXN0KFxyXG4gICAgcmVxdWVzdElkLCBpc1Byb2dyZXNzaXZlKSB7XHJcbiAgICBcclxuICAgIHZhciBmZXRjaEpvYiA9IHRoaXMuX3JlcXVlc3RCeUlkW3JlcXVlc3RJZF07XHJcbiAgICBpZiAoZmV0Y2hKb2IgPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIC8vIFRoaXMgc2l0dWF0aW9uIG1pZ2h0IG9jY3VyIGlmIHJlcXVlc3QgaGFzIGJlZW4gdGVybWluYXRlZCxcclxuICAgICAgICAvLyBidXQgdXNlcidzIHRlcm1pbmF0ZWRDYWxsYmFjayBoYXMgbm90IGJlZW4gY2FsbGVkIHlldC4gSXRcclxuICAgICAgICAvLyBoYXBwZW5zIG9uIFdvcmtlclByb3h5RmV0Y2hNYW5hZ2VyIGR1ZSB0byB0aHJlYWRcclxuICAgICAgICAvLyBtZXNzYWdlIGRlbGF5LlxyXG4gICAgICAgIFxyXG4gICAgICAgIHJldHVybiBudWxsO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBmZXRjaEpvYi5zZXRJc1Byb2dyZXNzaXZlKGlzUHJvZ3Jlc3NpdmUpO1xyXG59O1xyXG5cclxuRmV0Y2hNYW5hZ2VyLnByb3RvdHlwZS5jcmVhdGVDaGFubmVsID0gZnVuY3Rpb24gY3JlYXRlQ2hhbm5lbCgpIHtcclxuXHR2YXIgc2VsZiA9IHRoaXM7XHJcbiAgICByZXR1cm4gbmV3IFByb21pc2UoZnVuY3Rpb24ocmVzb2x2ZSwgcmVqZWN0KSB7XHJcbiAgICAgICAgdmFyIGNoYW5uZWxIYW5kbGUgPSArK3NlbGYuX2NoYW5uZWxIYW5kbGVDb3VudGVyO1xyXG4gICAgICAgIHNlbGYuX2NoYW5uZWxIYW5kbGVzW2NoYW5uZWxIYW5kbGVdID0gbmV3IEZldGNoSm9iKFxyXG4gICAgICAgICAgICBzZWxmLl9mZXRjaGVyLFxyXG4gICAgICAgICAgICBzZWxmLl9zY2hlZHVsZXIsXHJcbiAgICAgICAgICAgIHNlbGYuX3NjaGVkdWxlZEpvYnNMaXN0LFxyXG4gICAgICAgICAgICBGZXRjaEpvYi5GRVRDSF9UWVBFX0NIQU5ORUwsXHJcbiAgICAgICAgICAgIC8qY29udGV4dFZhcnM9Ki9udWxsKTtcclxuXHJcbiAgICAgICAgcmVzb2x2ZShjaGFubmVsSGFuZGxlKTtcclxuICAgIH0pO1xyXG59O1xyXG5cclxuRmV0Y2hNYW5hZ2VyLnByb3RvdHlwZS5tb3ZlQ2hhbm5lbCA9IGZ1bmN0aW9uIG1vdmVDaGFubmVsKFxyXG4gICAgY2hhbm5lbEhhbmRsZSwgaW1hZ2VQYXJ0UGFyYW1zKSB7XHJcbiAgICBcclxuICAgIHZhciBjaGFubmVsID0gdGhpcy5fY2hhbm5lbEhhbmRsZXNbY2hhbm5lbEhhbmRsZV07XHJcbiAgICBjaGFubmVsLmZldGNoKGltYWdlUGFydFBhcmFtcyk7XHJcbn07XHJcblxyXG5GZXRjaE1hbmFnZXIucHJvdG90eXBlLmNyZWF0ZVJlcXVlc3QgPSBmdW5jdGlvbiBjcmVhdGVSZXF1ZXN0KFxyXG4gICAgcmVxdWVzdElkLCBpbWFnZVBhcnRQYXJhbXMpIHtcclxuICAgIFxyXG4gICAgdmFyIGNvbnRleHRWYXJzID0ge1xyXG4gICAgICAgIHByb2dyZXNzaXZlU3RhZ2VzRG9uZTogMCxcclxuICAgICAgICBpc0xhc3RDYWxsYmFja0NhbGxlZFdpdGhvdXRMb3dRdWFsaXR5TGltaXQ6IGZhbHNlLFxyXG4gICAgICAgIHJlcXVlc3RJZDogcmVxdWVzdElkLFxyXG4gICAgICAgIGZldGNoSm9iOiBudWxsLFxyXG4gICAgICAgIHNlbGY6IHRoaXNcclxuICAgIH07XHJcbiAgICBcclxuICAgIHZhciBmZXRjaFR5cGUgPSAvKmlzT25seVdhaXRGb3JEYXRhID9cclxuICAgICAgICBGZXRjaEpvYi5GRVRDSF9UWVBFX09OTFlfV0FJVF9GT1JfREFUQSA6ICovRmV0Y2hKb2IuRkVUQ0hfVFlQRV9SRVFVRVNUO1xyXG4gICAgXHJcbiAgICB2YXIgZmV0Y2hKb2IgPSBuZXcgRmV0Y2hKb2IoXHJcbiAgICAgICAgdGhpcy5fZmV0Y2hlciwgdGhpcy5fc2NoZWR1bGVyLCB0aGlzLl9zY2hlZHVsZWRKb2JzTGlzdCwgZmV0Y2hUeXBlLCBjb250ZXh0VmFycyk7XHJcbiAgICBcclxuICAgIGNvbnRleHRWYXJzLmZldGNoSm9iID0gZmV0Y2hKb2I7XHJcbiAgICBcclxuICAgIGlmICh0aGlzLl9yZXF1ZXN0QnlJZFtyZXF1ZXN0SWRdICE9PSB1bmRlZmluZWQpIHtcclxuICAgICAgICB0aHJvdyAnRHVwbGljYXRpb24gb2YgcmVxdWVzdElkICcgKyByZXF1ZXN0SWQ7XHJcbiAgICB9IGVsc2UgaWYgKHJlcXVlc3RJZCAhPT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgdGhpcy5fcmVxdWVzdEJ5SWRbcmVxdWVzdElkXSA9IGZldGNoSm9iO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBmZXRjaEpvYi5vbigndGVybWluYXRlZCcsIGludGVybmFsVGVybWluYXRlZENhbGxiYWNrKTtcclxuICAgIFxyXG4gICAgZmV0Y2hKb2IuZmV0Y2goaW1hZ2VQYXJ0UGFyYW1zKTtcclxuICAgIFxyXG4gICAgdGhpcy5feWllbGRGZXRjaEpvYnMoKTtcclxufTtcclxuXHJcbkZldGNoTWFuYWdlci5wcm90b3R5cGUubWFudWFsQWJvcnRSZXF1ZXN0ID0gZnVuY3Rpb24gbWFudWFsQWJvcnRSZXF1ZXN0KFxyXG4gICAgcmVxdWVzdElkKSB7XHJcbiAgICBcclxuICAgIHZhciBmZXRjaEpvYiA9IHRoaXMuX3JlcXVlc3RCeUlkW3JlcXVlc3RJZF07XHJcbiAgICBcclxuICAgIGlmIChmZXRjaEpvYiA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgLy8gVGhpcyBzaXR1YXRpb24gbWlnaHQgb2NjdXIgaWYgcmVxdWVzdCBoYXMgYmVlbiB0ZXJtaW5hdGVkLFxyXG4gICAgICAgIC8vIGJ1dCB1c2VyJ3MgdGVybWluYXRlZENhbGxiYWNrIGhhcyBub3QgYmVlbiBjYWxsZWQgeWV0LiBJdFxyXG4gICAgICAgIC8vIGhhcHBlbnMgb24gV29ya2VyUHJveHlGZXRjaE1hbmFnZXIgZHVlIHRvIHdlYiB3b3JrZXJcclxuICAgICAgICAvLyBtZXNzYWdlIGRlbGF5LlxyXG4gICAgICAgIFxyXG4gICAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIFxyXG4gICAgZmV0Y2hKb2IubWFudWFsQWJvcnRSZXF1ZXN0KCk7XHJcbiAgICBkZWxldGUgdGhpcy5fcmVxdWVzdEJ5SWRbcmVxdWVzdElkXTtcclxufTtcclxuXHJcbkZldGNoTWFuYWdlci5wcm90b3R5cGUucmVjb25uZWN0ID0gZnVuY3Rpb24gcmVjb25uZWN0KCkge1xyXG4gICAgdGhpcy5fZmV0Y2hlci5yZWNvbm5lY3QoKTtcclxufTtcclxuXHJcbkZldGNoTWFuYWdlci5wcm90b3R5cGUuc2V0U2VydmVyUmVxdWVzdFByaW9yaXRpemVyRGF0YSA9XHJcbiAgICBmdW5jdGlvbiBzZXRTZXJ2ZXJSZXF1ZXN0UHJpb3JpdGl6ZXJEYXRhKHByaW9yaXRpemVyRGF0YSkge1xyXG5cclxuICAgIGlmICh0aGlzLl9zZXJ2ZXJSZXF1ZXN0UHJpb3JpdGl6ZXIgPT09IG51bGwpIHtcclxuICAgICAgICB0aHJvdyAnTm8gc2VydmVyUmVxdWVzdCBwcmlvcml0aXplciBoYXMgYmVlbiBzZXQnO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBpZiAodGhpcy5fc2hvd0xvZykge1xyXG4gICAgICAgIGNvbnNvbGUubG9nKCdzZXRTZXJ2ZXJSZXF1ZXN0UHJpb3JpdGl6ZXJEYXRhKCcgKyBwcmlvcml0aXplckRhdGEgKyAnKScpO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBwcmlvcml0aXplckRhdGEuaW1hZ2UgPSB0aGlzO1xyXG4gICAgdGhpcy5fc2VydmVyUmVxdWVzdFByaW9yaXRpemVyLnNldFByaW9yaXRpemVyRGF0YShwcmlvcml0aXplckRhdGEpO1xyXG4gICAgdGhpcy5feWllbGRGZXRjaEpvYnMoKTtcclxufTtcclxuXHJcbkZldGNoTWFuYWdlci5wcm90b3R5cGUuX2dldEltYWdlUGFyYW1zSW50ZXJuYWwgPSBmdW5jdGlvbiBnZXRJbWFnZVBhcmFtc0ludGVybmFsKCkge1xyXG4gICAgcmV0dXJuIHRoaXMuX2ludGVybmFsU2l6ZXNQYXJhbXM7XHJcbn07XHJcblxyXG5GZXRjaE1hbmFnZXIucHJvdG90eXBlLl95aWVsZEZldGNoSm9icyA9IGZ1bmN0aW9uIHlpZWxkRmV0Y2hKb2JzKCkge1xyXG4gICAgdmFyIGl0ZXJhdG9yID0gdGhpcy5fc2NoZWR1bGVkSm9ic0xpc3QuZ2V0Rmlyc3RJdGVyYXRvcigpO1xyXG4gICAgd2hpbGUgKGl0ZXJhdG9yICE9PSBudWxsKSB7XHJcbiAgICAgICAgdmFyIGZldGNoSm9iID0gdGhpcy5fc2NoZWR1bGVkSm9ic0xpc3QuZ2V0VmFsdWUoaXRlcmF0b3IpO1xyXG4gICAgICAgIGl0ZXJhdG9yID0gdGhpcy5fc2NoZWR1bGVkSm9ic0xpc3QuZ2V0TmV4dEl0ZXJhdG9yKGl0ZXJhdG9yKTtcclxuICAgICAgICBcclxuICAgICAgICBmZXRjaEpvYi5jaGVja0lmU2hvdWxkWWllbGQoKTtcclxuICAgIH1cclxufTtcclxuXHJcbmZ1bmN0aW9uIGludGVybmFsVGVybWluYXRlZENhbGxiYWNrKGNvbnRleHRWYXJzLCBpc0Fib3J0ZWQpIHtcclxuICAgIGRlbGV0ZSBjb250ZXh0VmFycy5zZWxmLl9yZXF1ZXN0QnlJZFtjb250ZXh0VmFycy5yZXF1ZXN0SWRdO1xyXG59XHJcblxyXG5mdW5jdGlvbiBjcmVhdGVTZXJ2ZXJSZXF1ZXN0RHVtbXlSZXNvdXJjZSgpIHtcclxuICAgIHJldHVybiB7fTtcclxufSIsIid1c2Ugc3RyaWN0JztcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gRnJ1c3R1bVJlcXVlc3RzUHJpb3JpdGl6ZXI7XHJcbnZhciBQUklPUklUWV9BQk9SVF9OT1RfSU5fRlJVU1RVTSA9IC0xO1xyXG52YXIgUFJJT1JJVFlfQ0FMQ1VMQVRJT05fRkFJTEVEID0gMDtcclxudmFyIFBSSU9SSVRZX1RPT19HT09EX1JFU09MVVRJT04gPSAxO1xyXG52YXIgUFJJT1JJVFlfTk9UX0lOX0ZSVVNUVU0gPSAyO1xyXG52YXIgUFJJT1JJVFlfTE9XRVJfUkVTT0xVVElPTiA9IDM7XHJcblxyXG52YXIgUFJJT1JJVFlfTUlOT1JJVFlfSU5fRlJVU1RVTSA9IDQ7XHJcbnZhciBQUklPUklUWV9QQVJUSUFMX0lOX0ZSVVNUVU0gPSA1O1xyXG52YXIgUFJJT1JJVFlfTUFKT1JJVFlfSU5fRlJVU1RVTSA9IDY7XHJcbnZhciBQUklPUklUWV9GVUxMWV9JTl9GUlVTVFVNID0gNztcclxuXHJcbnZhciBBRERfUFJJT1JJVFlfVE9fTE9XX1FVQUxJVFkgPSA1O1xyXG5cclxudmFyIFBSSU9SSVRZX0hJR0hFU1QgPSAxMztcclxuXHJcbnZhciBsb2cyID0gTWF0aC5sb2coMik7XHJcblxyXG5mdW5jdGlvbiBGcnVzdHVtUmVxdWVzdHNQcmlvcml0aXplcihcclxuICAgIGlzQWJvcnRSZXF1ZXN0c05vdEluRnJ1c3R1bSwgaXNQcmlvcml0aXplTG93UHJvZ3Jlc3NpdmVTdGFnZSkge1xyXG4gICAgXHJcbiAgICB0aGlzLl9mcnVzdHVtRGF0YSA9IG51bGw7XHJcbiAgICB0aGlzLl9pc0Fib3J0UmVxdWVzdHNOb3RJbkZydXN0dW0gPSBpc0Fib3J0UmVxdWVzdHNOb3RJbkZydXN0dW07XHJcbiAgICB0aGlzLl9pc1ByaW9yaXRpemVMb3dQcm9ncmVzc2l2ZVN0YWdlID0gaXNQcmlvcml0aXplTG93UHJvZ3Jlc3NpdmVTdGFnZTtcclxufVxyXG5cclxuT2JqZWN0LmRlZmluZVByb3BlcnR5KFxyXG4gICAgRnJ1c3R1bVJlcXVlc3RzUHJpb3JpdGl6ZXIucHJvdG90eXBlLCAnbWluaW1hbExvd1F1YWxpdHlQcmlvcml0eScsIHtcclxuICAgICAgICBnZXQ6IGZ1bmN0aW9uIG1pbmltYWxMb3dRdWFsaXR5UHJpb3JpdHkoKSB7XHJcbiAgICAgICAgICAgIHJldHVybiBQUklPUklUWV9NSU5PUklUWV9JTl9GUlVTVFVNICsgQUREX1BSSU9SSVRZX1RPX0xPV19RVUFMSVRZO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuKTtcclxuICAgIFxyXG5GcnVzdHVtUmVxdWVzdHNQcmlvcml0aXplci5wcm90b3R5cGUuc2V0UHJpb3JpdGl6ZXJEYXRhID0gZnVuY3Rpb24gc2V0UHJpb3JpdGl6ZXJEYXRhKHByaW9yaXRpemVyRGF0YSkge1xyXG4gICAgdGhpcy5fZnJ1c3R1bURhdGEgPSBwcmlvcml0aXplckRhdGE7XHJcbn07XHJcblxyXG5GcnVzdHVtUmVxdWVzdHNQcmlvcml0aXplci5wcm90b3R5cGUuZ2V0UHJpb3JpdHkgPSBmdW5jdGlvbiBnZXRQcmlvcml0eShqb2JDb250ZXh0KSB7XHJcbiAgICB2YXIgaW1hZ2VQYXJ0UGFyYW1zID0gam9iQ29udGV4dC5pbWFnZVBhcnRQYXJhbXM7XHJcbiAgICBpZiAoaW1hZ2VQYXJ0UGFyYW1zLnJlcXVlc3RQcmlvcml0eURhdGEub3ZlcnJpZGVIaWdoZXN0UHJpb3JpdHkpIHtcclxuICAgICAgICByZXR1cm4gUFJJT1JJVFlfSElHSEVTVDtcclxuICAgIH1cclxuXHJcbiAgICB2YXIgcHJpb3JpdHkgPSB0aGlzLl9nZXRQcmlvcml0eUludGVybmFsKGltYWdlUGFydFBhcmFtcyk7XHJcbiAgICB2YXIgaXNJbkZydXN0dW0gPSBwcmlvcml0eSA+PSBQUklPUklUWV9NSU5PUklUWV9JTl9GUlVTVFVNO1xyXG4gICAgXHJcbiAgICBpZiAodGhpcy5faXNBYm9ydFJlcXVlc3RzTm90SW5GcnVzdHVtICYmICFpc0luRnJ1c3R1bSkge1xyXG4gICAgICAgIHJldHVybiBQUklPUklUWV9BQk9SVF9OT1RfSU5fRlJVU1RVTTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgdmFyIHByaW9yaXRpemVMb3dQcm9ncmVzc2l2ZVN0YWdlID0gMDtcclxuICAgIFxyXG4gICAgaWYgKHRoaXMuX2lzUHJpb3JpdGl6ZUxvd1Byb2dyZXNzaXZlU3RhZ2UgJiYgaXNJbkZydXN0dW0pIHtcclxuICAgICAgICBwcmlvcml0aXplTG93UHJvZ3Jlc3NpdmVTdGFnZSA9XHJcbiAgICAgICAgICAgIGpvYkNvbnRleHQucHJvZ3Jlc3NpdmVTdGFnZXNEb25lID09PSAwID8gQUREX1BSSU9SSVRZX1RPX0xPV19RVUFMSVRZIDpcclxuICAgICAgICAgICAgam9iQ29udGV4dC5wcm9ncmVzc2l2ZVN0YWdlc0RvbmUgPT09IDEgPyAxIDpcclxuICAgICAgICAgICAgMDtcclxuICAgIH1cclxuICAgIFxyXG4gICAgcmV0dXJuIHByaW9yaXR5ICsgcHJpb3JpdGl6ZUxvd1Byb2dyZXNzaXZlU3RhZ2U7XHJcbn07XHJcblxyXG5GcnVzdHVtUmVxdWVzdHNQcmlvcml0aXplci5wcm90b3R5cGUuX2dldFByaW9yaXR5SW50ZXJuYWwgPSBmdW5jdGlvbiBnZXRQcmlvcml0eUludGVybmFsKGltYWdlUGFydFBhcmFtcykge1xyXG4gICAgaWYgKHRoaXMuX2ZydXN0dW1EYXRhID09PSBudWxsKSB7XHJcbiAgICAgICAgcmV0dXJuIFBSSU9SSVRZX0NBTENVTEFUSU9OX0ZBSUxFRDtcclxuICAgIH1cclxuICAgIFxyXG4gICAgaWYgKHRoaXMuX2ZydXN0dW1EYXRhLmltYWdlUmVjdGFuZ2xlID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICB0aHJvdyAnTm8gaW1hZ2VSZWN0YW5nbGUgaW5mb3JtYXRpb24gcGFzc2VkIGluIHNldFByaW9yaXRpemVyRGF0YSc7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHZhciBleGFjdEZydXN0dW1MZXZlbCA9IHRoaXMuX2ZydXN0dW1EYXRhLmV4YWN0bGV2ZWw7XHJcbiAgICBcclxuICAgIGlmICh0aGlzLl9mcnVzdHVtRGF0YS5leGFjdGxldmVsID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICB0aHJvdyAnTm8gZXhhY3RsZXZlbCBpbmZvcm1hdGlvbiBwYXNzZWQgaW4gJyArXHJcbiAgICAgICAgICAgICdzZXRQcmlvcml0aXplckRhdGEuIFVzZSBudWxsIGlmIHVua25vd24nO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICB2YXIgdGlsZVdlc3QgPSB0aGlzLl9waXhlbFRvQ2FydG9ncmFwaGljWChcclxuICAgICAgICBpbWFnZVBhcnRQYXJhbXMubWluWCwgaW1hZ2VQYXJ0UGFyYW1zKTtcclxuICAgIHZhciB0aWxlRWFzdCA9IHRoaXMuX3BpeGVsVG9DYXJ0b2dyYXBoaWNYKFxyXG4gICAgICAgIGltYWdlUGFydFBhcmFtcy5tYXhYRXhjbHVzaXZlLCBpbWFnZVBhcnRQYXJhbXMpO1xyXG4gICAgdmFyIHRpbGVOb3J0aCA9IHRoaXMuX3BpeGVsVG9DYXJ0b2dyYXBoaWNZKFxyXG4gICAgICAgIGltYWdlUGFydFBhcmFtcy5taW5ZLCBpbWFnZVBhcnRQYXJhbXMpO1xyXG4gICAgdmFyIHRpbGVTb3V0aCA9IHRoaXMuX3BpeGVsVG9DYXJ0b2dyYXBoaWNZKFxyXG4gICAgICAgIGltYWdlUGFydFBhcmFtcy5tYXhZRXhjbHVzaXZlLCBpbWFnZVBhcnRQYXJhbXMpO1xyXG4gICAgXHJcbiAgICB2YXIgdGlsZVBpeGVsc1dpZHRoID1cclxuICAgICAgICBpbWFnZVBhcnRQYXJhbXMubWF4WEV4Y2x1c2l2ZSAtIGltYWdlUGFydFBhcmFtcy5taW5YO1xyXG4gICAgdmFyIHRpbGVQaXhlbHNIZWlnaHQgPVxyXG4gICAgICAgIGltYWdlUGFydFBhcmFtcy5tYXhZRXhjbHVzaXZlIC0gaW1hZ2VQYXJ0UGFyYW1zLm1pblk7XHJcbiAgICBcclxuICAgIHZhciByZXF1ZXN0VG9GcnVzdHVtUmVzb2x1dGlvblJhdGlvO1xyXG4gICAgdmFyIHRpbGVMZXZlbCA9IGltYWdlUGFydFBhcmFtcy5sZXZlbCB8fCAwO1xyXG4gICAgaWYgKGV4YWN0RnJ1c3R1bUxldmVsID09PSBudWxsKSB7XHJcbiAgICAgICAgdmFyIHRpbGVSZXNvbHV0aW9uWCA9IHRpbGVQaXhlbHNXaWR0aCAvICh0aWxlRWFzdCAtIHRpbGVXZXN0KTtcclxuICAgICAgICB2YXIgdGlsZVJlc29sdXRpb25ZID0gdGlsZVBpeGVsc0hlaWdodCAvICh0aWxlTm9ydGggLSB0aWxlU291dGgpO1xyXG4gICAgICAgIHZhciB0aWxlUmVzb2x1dGlvbiA9IE1hdGgubWF4KHRpbGVSZXNvbHV0aW9uWCwgdGlsZVJlc29sdXRpb25ZKTtcclxuICAgICAgICB2YXIgZnJ1c3R1bVJlc29sdXRpb24gPSB0aGlzLl9mcnVzdHVtRGF0YS5yZXNvbHV0aW9uO1xyXG4gICAgICAgIHJlcXVlc3RUb0ZydXN0dW1SZXNvbHV0aW9uUmF0aW8gPSB0aWxlUmVzb2x1dGlvbiAvIGZydXN0dW1SZXNvbHV0aW9uO1xyXG4gICAgXHJcbiAgICAgICAgaWYgKHJlcXVlc3RUb0ZydXN0dW1SZXNvbHV0aW9uUmF0aW8gPiAyKSB7XHJcbiAgICAgICAgICAgIHJldHVybiBQUklPUklUWV9UT09fR09PRF9SRVNPTFVUSU9OO1xyXG4gICAgICAgIH1cclxuICAgIH0gZWxzZSBpZiAodGlsZUxldmVsIDwgZXhhY3RGcnVzdHVtTGV2ZWwpIHtcclxuICAgICAgICByZXR1cm4gUFJJT1JJVFlfVE9PX0dPT0RfUkVTT0xVVElPTjtcclxuICAgIH1cclxuICAgIFxyXG4gICAgdmFyIGZydXN0dW1SZWN0YW5nbGUgPSB0aGlzLl9mcnVzdHVtRGF0YS5yZWN0YW5nbGU7XHJcbiAgICB2YXIgaW50ZXJzZWN0aW9uV2VzdCA9IE1hdGgubWF4KGZydXN0dW1SZWN0YW5nbGUud2VzdCwgdGlsZVdlc3QpO1xyXG4gICAgdmFyIGludGVyc2VjdGlvbkVhc3QgPSBNYXRoLm1pbihmcnVzdHVtUmVjdGFuZ2xlLmVhc3QsIHRpbGVFYXN0KTtcclxuICAgIHZhciBpbnRlcnNlY3Rpb25Tb3V0aCA9IE1hdGgubWF4KGZydXN0dW1SZWN0YW5nbGUuc291dGgsIHRpbGVTb3V0aCk7XHJcbiAgICB2YXIgaW50ZXJzZWN0aW9uTm9ydGggPSBNYXRoLm1pbihmcnVzdHVtUmVjdGFuZ2xlLm5vcnRoLCB0aWxlTm9ydGgpO1xyXG4gICAgXHJcbiAgICB2YXIgaW50ZXJzZWN0aW9uV2lkdGggPSBpbnRlcnNlY3Rpb25FYXN0IC0gaW50ZXJzZWN0aW9uV2VzdDtcclxuICAgIHZhciBpbnRlcnNlY3Rpb25IZWlnaHQgPSBpbnRlcnNlY3Rpb25Ob3J0aCAtIGludGVyc2VjdGlvblNvdXRoO1xyXG4gICAgXHJcbiAgICBpZiAoaW50ZXJzZWN0aW9uV2lkdGggPCAwIHx8IGludGVyc2VjdGlvbkhlaWdodCA8IDApIHtcclxuICAgICAgICByZXR1cm4gUFJJT1JJVFlfTk9UX0lOX0ZSVVNUVU07XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGlmIChleGFjdEZydXN0dW1MZXZlbCAhPT0gbnVsbCkge1xyXG4gICAgICAgIGlmICh0aWxlTGV2ZWwgPiBleGFjdEZydXN0dW1MZXZlbCkge1xyXG4gICAgICAgICAgICByZXR1cm4gUFJJT1JJVFlfTE9XRVJfUkVTT0xVVElPTjtcclxuICAgICAgICB9XHJcbiAgICB9IGVsc2UgaWYgKHRpbGVMZXZlbCA+IDAgJiYgcmVxdWVzdFRvRnJ1c3R1bVJlc29sdXRpb25SYXRpbyA8IDAuMjUpIHtcclxuICAgICAgICByZXR1cm4gUFJJT1JJVFlfTE9XRVJfUkVTT0xVVElPTjtcclxuICAgIH1cclxuICAgIFxyXG4gICAgdmFyIGludGVyc2VjdGlvbkFyZWEgPSBpbnRlcnNlY3Rpb25XaWR0aCAqIGludGVyc2VjdGlvbkhlaWdodDtcclxuICAgIHZhciB0aWxlQXJlYSA9ICh0aWxlRWFzdCAtIHRpbGVXZXN0KSAqICh0aWxlTm9ydGggLSB0aWxlU291dGgpO1xyXG4gICAgdmFyIHBhcnRJbkZydXN0dW0gPSBpbnRlcnNlY3Rpb25BcmVhIC8gdGlsZUFyZWE7XHJcbiAgICBcclxuICAgIGlmIChwYXJ0SW5GcnVzdHVtID4gMC45OSkge1xyXG4gICAgICAgIHJldHVybiBQUklPUklUWV9GVUxMWV9JTl9GUlVTVFVNO1xyXG4gICAgfSBlbHNlIGlmIChwYXJ0SW5GcnVzdHVtID4gMC43KSB7XHJcbiAgICAgICAgcmV0dXJuIFBSSU9SSVRZX01BSk9SSVRZX0lOX0ZSVVNUVU07XHJcbiAgICB9IGVsc2UgaWYgKHBhcnRJbkZydXN0dW0gPiAwLjMpIHtcclxuICAgICAgICByZXR1cm4gUFJJT1JJVFlfUEFSVElBTF9JTl9GUlVTVFVNO1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgICByZXR1cm4gUFJJT1JJVFlfTUlOT1JJVFlfSU5fRlJVU1RVTTtcclxuICAgIH1cclxufTtcclxuXHJcbkZydXN0dW1SZXF1ZXN0c1ByaW9yaXRpemVyLnByb3RvdHlwZS5fcGl4ZWxUb0NhcnRvZ3JhcGhpY1ggPSBmdW5jdGlvbiBwaXhlbFRvQ2FydG9ncmFwaGljWChcclxuICAgIHgsIGltYWdlUGFydFBhcmFtcykge1xyXG4gICAgXHJcbiAgICB2YXIgcmVsYXRpdmVYID0geCAvIGltYWdlUGFydFBhcmFtcy5sZXZlbFdpZHRoO1xyXG4gICAgXHJcbiAgICB2YXIgaW1hZ2VSZWN0YW5nbGUgPSB0aGlzLl9mcnVzdHVtRGF0YS5pbWFnZVJlY3RhbmdsZTtcclxuICAgIHZhciByZWN0YW5nbGVXaWR0aCA9IGltYWdlUmVjdGFuZ2xlLmVhc3QgLSBpbWFnZVJlY3RhbmdsZS53ZXN0O1xyXG4gICAgXHJcbiAgICB2YXIgeFByb2plY3RlZCA9IGltYWdlUmVjdGFuZ2xlLndlc3QgKyByZWxhdGl2ZVggKiByZWN0YW5nbGVXaWR0aDtcclxuICAgIHJldHVybiB4UHJvamVjdGVkO1xyXG59O1xyXG5cclxuRnJ1c3R1bVJlcXVlc3RzUHJpb3JpdGl6ZXIucHJvdG90eXBlLl9waXhlbFRvQ2FydG9ncmFwaGljWSA9IGZ1bmN0aW9uIHRpbGVUb0NhcnRvZ3JhcGhpY1koXHJcbiAgICB5LCBpbWFnZVBhcnRQYXJhbXMsIGltYWdlKSB7XHJcbiAgICBcclxuICAgIHZhciByZWxhdGl2ZVkgPSB5IC8gaW1hZ2VQYXJ0UGFyYW1zLmxldmVsSGVpZ2h0O1xyXG4gICAgXHJcbiAgICB2YXIgaW1hZ2VSZWN0YW5nbGUgPSB0aGlzLl9mcnVzdHVtRGF0YS5pbWFnZVJlY3RhbmdsZTtcclxuICAgIHZhciByZWN0YW5nbGVIZWlnaHQgPSBpbWFnZVJlY3RhbmdsZS5ub3J0aCAtIGltYWdlUmVjdGFuZ2xlLnNvdXRoO1xyXG4gICAgXHJcbiAgICB2YXIgeVByb2plY3RlZCA9IGltYWdlUmVjdGFuZ2xlLm5vcnRoIC0gcmVsYXRpdmVZICogcmVjdGFuZ2xlSGVpZ2h0O1xyXG4gICAgcmV0dXJuIHlQcm9qZWN0ZWQ7XHJcbn07IiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxudmFyIEZydXN0dW1SZXF1ZXN0c1ByaW9yaXRpemVyID0gcmVxdWlyZSgnZnJ1c3R1bXJlcXVlc3RzcHJpb3JpdGl6ZXIuanMnKTtcclxuXHJcbm1vZHVsZS5leHBvcnRzID0ge1xyXG4gICAgY2FsY3VsYXRlRnJ1c3R1bTJERnJvbUJvdW5kczogY2FsY3VsYXRlRnJ1c3R1bTJERnJvbUJvdW5kcyxcclxuICAgIGNyZWF0ZVNjaGVkdWxlcjogY3JlYXRlU2NoZWR1bGVyLFxyXG4gICAgZml4Qm91bmRzOiBmaXhCb3VuZHMsXHJcbiAgICBhbGlnblBhcmFtc1RvVGlsZXNBbmRMZXZlbDogYWxpZ25QYXJhbXNUb1RpbGVzQW5kTGV2ZWwsXHJcbn07XHJcblxyXG4vLyBBdm9pZCBqc2hpbnQgZXJyb3JcclxuLyogZ2xvYmFsIHNlbGY6IGZhbHNlICovXHJcbi8qIGdsb2JhbCBnbG9iYWxzOiBmYWxzZSAqL1xyXG4gICAgXHJcbi8vdmFyIGxvZzIgPSBNYXRoLmxvZygyKTtcclxuXHJcbmZ1bmN0aW9uIGNhbGN1bGF0ZUZydXN0dW0yREZyb21Cb3VuZHMoXHJcbiAgICBib3VuZHMsIHNjcmVlblNpemUpIHtcclxuICAgIFxyXG4gICAgdmFyIHNjcmVlblBpeGVscyA9XHJcbiAgICAgICAgc2NyZWVuU2l6ZS54ICogc2NyZWVuU2l6ZS54ICsgc2NyZWVuU2l6ZS55ICogc2NyZWVuU2l6ZS55O1xyXG4gICAgXHJcbiAgICB2YXIgYm91bmRzV2lkdGggPSBib3VuZHMuZWFzdCAtIGJvdW5kcy53ZXN0O1xyXG4gICAgdmFyIGJvdW5kc0hlaWdodCA9IGJvdW5kcy5ub3J0aCAtIGJvdW5kcy5zb3V0aDtcclxuICAgIHZhciBib3VuZHNEaXN0YW5jZSA9XHJcbiAgICAgICAgYm91bmRzV2lkdGggKiBib3VuZHNXaWR0aCArIGJvdW5kc0hlaWdodCAqIGJvdW5kc0hlaWdodDtcclxuICAgIFxyXG4gICAgdmFyIHJlc29sdXRpb24gPSBNYXRoLnNxcnQoc2NyZWVuUGl4ZWxzIC8gYm91bmRzRGlzdGFuY2UpO1xyXG4gICAgXHJcbiAgICB2YXIgZnJ1c3R1bURhdGEgPSB7XHJcbiAgICAgICAgcmVzb2x1dGlvbjogcmVzb2x1dGlvbixcclxuICAgICAgICByZWN0YW5nbGU6IGJvdW5kcyxcclxuICAgICAgICBcclxuICAgICAgICAvLyBSZWR1bmRhbnQsIGJ1dCBlbmFibGVzIHRvIGF2b2lkIGFscmVhZHktcGVyZm9ybWVkIGNhbGN1bGF0aW9uXHJcbiAgICAgICAgc2NyZWVuU2l6ZTogc2NyZWVuU2l6ZVxyXG4gICAgfTtcclxuICAgIFxyXG4gICAgcmV0dXJuIGZydXN0dW1EYXRhO1xyXG59XHJcbiAgICBcclxuZnVuY3Rpb24gY3JlYXRlU2NoZWR1bGVyKFxyXG4gICAgc2hvd0xvZywgcHJpb3JpdGl6ZXJUeXBlLCBzY2hlZHVsZXJOYW1lLCBjcmVhdGVSZXNvdXJjZSwgcmVzb3VyY2VMaW1pdCkge1xyXG4gICAgXHJcbiAgICB2YXIgcHJpb3JpdGl6ZXI7XHJcbiAgICB2YXIgc2NoZWR1bGVyO1xyXG4gICAgXHJcbiAgICBpZiAocHJpb3JpdGl6ZXJUeXBlID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICBwcmlvcml0aXplciA9IG51bGw7XHJcbiAgICAgICAgXHJcbiAgICAgICAgc2NoZWR1bGVyID0gbmV3IFJlc291cmNlU2NoZWR1bGVyLkxpZm9TY2hlZHVsZXIoXHJcbiAgICAgICAgICAgIGNyZWF0ZVJlc291cmNlLFxyXG4gICAgICAgICAgICByZXNvdXJjZUxpbWl0KTtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgICAgdmFyIGxpbWl0UmVzb3VyY2VCeUxvd1F1YWxpdHlQcmlvcml0eSA9IGZhbHNlO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGlmIChwcmlvcml0aXplclR5cGUgPT09ICdmcnVzdHVtJykge1xyXG4gICAgICAgICAgICBsaW1pdFJlc291cmNlQnlMb3dRdWFsaXR5UHJpb3JpdHkgPSB0cnVlO1xyXG4gICAgICAgICAgICBwcmlvcml0aXplciA9IG5ldyBGcnVzdHVtUmVxdWVzdHNQcmlvcml0aXplcigpO1xyXG4gICAgICAgIH0gZWxzZSBpZiAocHJpb3JpdGl6ZXJUeXBlID09PSAnZnJ1c3R1bU9ubHknKSB7XHJcbiAgICAgICAgICAgIGxpbWl0UmVzb3VyY2VCeUxvd1F1YWxpdHlQcmlvcml0eSA9IHRydWU7XHJcbiAgICAgICAgICAgIHByaW9yaXRpemVyID0gbmV3IEZydXN0dW1SZXF1ZXN0c1ByaW9yaXRpemVyKFxyXG4gICAgICAgICAgICAgICAgLyppc0Fib3J0UmVxdWVzdHNOb3RJbkZydXN0dW09Ki90cnVlLFxyXG4gICAgICAgICAgICAgICAgLyppc1ByaW9yaXRpemVMb3dRdWFsaXR5U3RhZ2U9Ki90cnVlKTtcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICBwcmlvcml0aXplciA9IHByaW9yaXRpemVyVHlwZTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgdmFyIG9wdGlvbnMgPSB7XHJcbiAgICAgICAgICAgIHNjaGVkdWxlck5hbWU6IHNjaGVkdWxlck5hbWUsXHJcbiAgICAgICAgICAgIHNob3dMb2c6IHNob3dMb2dcclxuICAgICAgICB9O1xyXG4gICAgICAgIFxyXG4gICAgICAgIGlmIChsaW1pdFJlc291cmNlQnlMb3dRdWFsaXR5UHJpb3JpdHkpIHtcclxuICAgICAgICAgICAgb3B0aW9ucy5yZXNvdXJjZUd1YXJhbnRlZWRGb3JIaWdoUHJpb3JpdHkgPSByZXNvdXJjZUxpbWl0IC0gMjtcclxuICAgICAgICAgICAgb3B0aW9ucy5oaWdoUHJpb3JpdHlUb0d1YXJhbnRlZVJlc291cmNlID1cclxuICAgICAgICAgICAgICAgIHByaW9yaXRpemVyLm1pbmltYWxMb3dRdWFsaXR5UHJpb3JpdHk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHNjaGVkdWxlciA9IG5ldyBSZXNvdXJjZVNjaGVkdWxlci5Qcmlvcml0eVNjaGVkdWxlcihcclxuICAgICAgICAgICAgY3JlYXRlUmVzb3VyY2UsXHJcbiAgICAgICAgICAgIHJlc291cmNlTGltaXQsXHJcbiAgICAgICAgICAgIHByaW9yaXRpemVyLFxyXG4gICAgICAgICAgICBvcHRpb25zKTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgcmV0dXJuIHtcclxuICAgICAgICBwcmlvcml0aXplcjogcHJpb3JpdGl6ZXIsXHJcbiAgICAgICAgc2NoZWR1bGVyOiBzY2hlZHVsZXJcclxuICAgIH07XHJcbn1cclxuICAgIFxyXG5mdW5jdGlvbiBmaXhCb3VuZHMoYm91bmRzLCBpbWFnZSwgYWRhcHRQcm9wb3J0aW9ucykge1xyXG4gICAgaWYgKCFhZGFwdFByb3BvcnRpb25zKSB7XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG5cclxuICAgIHZhciByZWN0YW5nbGVXaWR0aCA9IGJvdW5kcy5lYXN0IC0gYm91bmRzLndlc3Q7XHJcbiAgICB2YXIgcmVjdGFuZ2xlSGVpZ2h0ID0gYm91bmRzLm5vcnRoIC0gYm91bmRzLnNvdXRoO1xyXG5cclxuICAgIHZhciBwaXhlbHNBc3BlY3RSYXRpbyA9IGltYWdlLmdldEltYWdlV2lkdGgoKSAvIGltYWdlLmdldEltYWdlSGVpZ2h0KCk7XHJcbiAgICB2YXIgcmVjdGFuZ2xlQXNwZWN0UmF0aW8gPSByZWN0YW5nbGVXaWR0aCAvIHJlY3RhbmdsZUhlaWdodDtcclxuICAgIFxyXG4gICAgaWYgKHBpeGVsc0FzcGVjdFJhdGlvIDwgcmVjdGFuZ2xlQXNwZWN0UmF0aW8pIHtcclxuICAgICAgICB2YXIgb2xkV2lkdGggPSByZWN0YW5nbGVXaWR0aDtcclxuICAgICAgICByZWN0YW5nbGVXaWR0aCA9IHJlY3RhbmdsZUhlaWdodCAqIHBpeGVsc0FzcGVjdFJhdGlvO1xyXG4gICAgICAgIHZhciBzdWJzdHJhY3RGcm9tV2lkdGggPSBvbGRXaWR0aCAtIHJlY3RhbmdsZVdpZHRoO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGJvdW5kcy5lYXN0IC09IHN1YnN0cmFjdEZyb21XaWR0aCAvIDI7XHJcbiAgICAgICAgYm91bmRzLndlc3QgKz0gc3Vic3RyYWN0RnJvbVdpZHRoIC8gMjtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgICAgdmFyIG9sZEhlaWdodCA9IHJlY3RhbmdsZUhlaWdodDtcclxuICAgICAgICByZWN0YW5nbGVIZWlnaHQgPSByZWN0YW5nbGVXaWR0aCAvIHBpeGVsc0FzcGVjdFJhdGlvO1xyXG4gICAgICAgIHZhciBzdWJzdHJhY3RGcm9tSGVpZ2h0ID0gb2xkSGVpZ2h0IC0gcmVjdGFuZ2xlSGVpZ2h0O1xyXG4gICAgICAgIFxyXG4gICAgICAgIGJvdW5kcy5ub3J0aCAtPSBzdWJzdHJhY3RGcm9tSGVpZ2h0IC8gMjtcclxuICAgICAgICBib3VuZHMuc291dGggKz0gc3Vic3RyYWN0RnJvbUhlaWdodCAvIDI7XHJcbiAgICB9XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGFsaWduUGFyYW1zVG9UaWxlc0FuZExldmVsKFxyXG4gICAgcmVnaW9uLCBpbWFnZURlY29kZXIsIGltYWdlKSB7XHJcbiAgICBcclxuICAgIHZhciB0aWxlV2lkdGggPSBpbWFnZURlY29kZXIuZ2V0VGlsZVdpZHRoKCk7XHJcbiAgICB2YXIgdGlsZUhlaWdodCA9IGltYWdlRGVjb2Rlci5nZXRUaWxlSGVpZ2h0KCk7XHJcbiAgICBcclxuICAgIHZhciByZWdpb25NaW5YID0gcmVnaW9uLm1pblg7XHJcbiAgICB2YXIgcmVnaW9uTWluWSA9IHJlZ2lvbi5taW5ZO1xyXG4gICAgdmFyIHJlZ2lvbk1heFggPSByZWdpb24ubWF4WEV4Y2x1c2l2ZTtcclxuICAgIHZhciByZWdpb25NYXhZID0gcmVnaW9uLm1heFlFeGNsdXNpdmU7XHJcbiAgICB2YXIgc2NyZWVuV2lkdGggPSByZWdpb24uc2NyZWVuV2lkdGg7XHJcbiAgICB2YXIgc2NyZWVuSGVpZ2h0ID0gcmVnaW9uLnNjcmVlbkhlaWdodDtcclxuICAgIFxyXG4gICAgdmFyIGlzVmFsaWRPcmRlciA9IHJlZ2lvbk1pblggPCByZWdpb25NYXhYICYmIHJlZ2lvbk1pblkgPCByZWdpb25NYXhZO1xyXG4gICAgaWYgKCFpc1ZhbGlkT3JkZXIpIHtcclxuICAgICAgICB0aHJvdyAnUGFyYW1ldGVycyBvcmRlciBpcyBpbnZhbGlkJztcclxuICAgIH1cclxuICAgIFxyXG4gICAgdmFyIGRlZmF1bHRMZXZlbFdpZHRoID0gaW1hZ2VEZWNvZGVyLmdldEltYWdlV2lkdGgoKTtcclxuICAgIHZhciBkZWZhdWx0TGV2ZWxIZWlnaHQgPSBpbWFnZURlY29kZXIuZ2V0SW1hZ2VIZWlnaHQoKTtcclxuICAgIGlmIChyZWdpb25NYXhYIDwgMCB8fCByZWdpb25NaW5YID49IGRlZmF1bHRMZXZlbFdpZHRoIHx8XHJcbiAgICAgICAgcmVnaW9uTWF4WSA8IDAgfHwgcmVnaW9uTWluWSA+PSBkZWZhdWx0TGV2ZWxIZWlnaHQpIHtcclxuICAgICAgICBcclxuICAgICAgICByZXR1cm4gbnVsbDtcclxuICAgIH1cclxuICAgIFxyXG4gICAgLy92YXIgbWF4TGV2ZWwgPVxyXG4gICAgLy8gICAgaW1hZ2VEZWNvZGVyLmdldERlZmF1bHROdW1SZXNvbHV0aW9uTGV2ZWxzKCkgLSAxO1xyXG5cclxuICAgIC8vdmFyIGxldmVsWCA9IE1hdGgubG9nKChyZWdpb25NYXhYIC0gcmVnaW9uTWluWCkgLyBzY3JlZW5XaWR0aCApIC8gbG9nMjtcclxuICAgIC8vdmFyIGxldmVsWSA9IE1hdGgubG9nKChyZWdpb25NYXhZIC0gcmVnaW9uTWluWSkgLyBzY3JlZW5IZWlnaHQpIC8gbG9nMjtcclxuICAgIC8vdmFyIGxldmVsID0gTWF0aC5jZWlsKE1hdGgubWluKGxldmVsWCwgbGV2ZWxZKSk7XHJcbiAgICAvL2xldmVsID0gTWF0aC5tYXgoMCwgTWF0aC5taW4obWF4TGV2ZWwsIGxldmVsKSk7XHJcbiAgICB2YXIgbGV2ZWwgPSBpbWFnZS5nZXRMZXZlbChyZWdpb24pO1xyXG4gICAgdmFyIGxldmVsV2lkdGggPSBpbWFnZS5nZXRMZXZlbFdpZHRoKGxldmVsKTtcclxuICAgIHZhciBsZXZlbEhlaWdodCA9IGltYWdlLmdldExldmVsSGVpZ2h0KGxldmVsKTtcclxuICAgIFxyXG4gICAgdmFyIHNjYWxlWCA9IGRlZmF1bHRMZXZlbFdpZHRoIC8gbGV2ZWxXaWR0aDtcclxuICAgIHZhciBzY2FsZVkgPSBkZWZhdWx0TGV2ZWxIZWlnaHQgLyBsZXZlbEhlaWdodDtcclxuICAgIFxyXG4gICAgdmFyIG1pblRpbGVYID0gTWF0aC5mbG9vcihyZWdpb25NaW5YIC8gKHNjYWxlWCAqIHRpbGVXaWR0aCApKTtcclxuICAgIHZhciBtaW5UaWxlWSA9IE1hdGguZmxvb3IocmVnaW9uTWluWSAvIChzY2FsZVkgKiB0aWxlSGVpZ2h0KSk7XHJcbiAgICB2YXIgbWF4VGlsZVggPSBNYXRoLmNlaWwgKHJlZ2lvbk1heFggLyAoc2NhbGVYICogdGlsZVdpZHRoICkpO1xyXG4gICAgdmFyIG1heFRpbGVZID0gTWF0aC5jZWlsIChyZWdpb25NYXhZIC8gKHNjYWxlWSAqIHRpbGVIZWlnaHQpKTtcclxuICAgIFxyXG4gICAgdmFyIG1pblggPSBtaW5UaWxlWCAqIHRpbGVXaWR0aDtcclxuICAgIHZhciBtaW5ZID0gbWluVGlsZVkgKiB0aWxlSGVpZ2h0O1xyXG4gICAgdmFyIG1heFggPSBtYXhUaWxlWCAqIHRpbGVXaWR0aDtcclxuICAgIHZhciBtYXhZID0gbWF4VGlsZVkgKiB0aWxlSGVpZ2h0O1xyXG4gICAgXHJcbiAgICB2YXIgY3JvcHBlZE1pblggPSBNYXRoLm1heCgwLCBNYXRoLm1pbihsZXZlbFdpZHRoICwgbWluWCkpO1xyXG4gICAgdmFyIGNyb3BwZWRNaW5ZID0gTWF0aC5tYXgoMCwgTWF0aC5taW4obGV2ZWxIZWlnaHQsIG1pblkpKTtcclxuICAgIHZhciBjcm9wcGVkTWF4WCA9IE1hdGgubWF4KDAsIE1hdGgubWluKGxldmVsV2lkdGggLCBtYXhYKSk7XHJcbiAgICB2YXIgY3JvcHBlZE1heFkgPSBNYXRoLm1heCgwLCBNYXRoLm1pbihsZXZlbEhlaWdodCwgbWF4WSkpO1xyXG4gICAgXHJcbiAgICB2YXIgaW1hZ2VQYXJhbXNUb1NjcmVlblNjYWxlWCA9IHNjcmVlbldpZHRoICAvIChtYXhYIC0gbWluWCk7XHJcbiAgICB2YXIgaW1hZ2VQYXJhbXNUb1NjcmVlblNjYWxlWSA9IHNjcmVlbkhlaWdodCAvIChtYXhZIC0gbWluWSk7XHJcbiAgICBcclxuICAgIHZhciBpbWFnZVBhcnRQYXJhbXMgPSB7XHJcbiAgICAgICAgbWluWDogY3JvcHBlZE1pblgsXHJcbiAgICAgICAgbWluWTogY3JvcHBlZE1pblksXHJcbiAgICAgICAgbWF4WEV4Y2x1c2l2ZTogY3JvcHBlZE1heFgsXHJcbiAgICAgICAgbWF4WUV4Y2x1c2l2ZTogY3JvcHBlZE1heFksXHJcbiAgICAgICAgbGV2ZWxXaWR0aDogbGV2ZWxXaWR0aCxcclxuICAgICAgICBsZXZlbEhlaWdodDogbGV2ZWxIZWlnaHQsXHJcbiAgICAgICAgbGV2ZWw6IGxldmVsXHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICB2YXIgcG9zaXRpb25JbkltYWdlID0ge1xyXG4gICAgICAgIG1pblg6IGNyb3BwZWRNaW5YICogc2NhbGVYLFxyXG4gICAgICAgIG1pblk6IGNyb3BwZWRNaW5ZICogc2NhbGVZLFxyXG4gICAgICAgIG1heFhFeGNsdXNpdmU6IGNyb3BwZWRNYXhYICogc2NhbGVYLFxyXG4gICAgICAgIG1heFlFeGNsdXNpdmU6IGNyb3BwZWRNYXhZICogc2NhbGVZXHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICB2YXIgY3JvcHBlZFNjcmVlbiA9IHtcclxuICAgICAgICBtaW5YIDogTWF0aC5mbG9vcigoY3JvcHBlZE1pblggLSBtaW5YKSAqIGltYWdlUGFyYW1zVG9TY3JlZW5TY2FsZVgpLFxyXG4gICAgICAgIG1pblkgOiBNYXRoLmZsb29yKChjcm9wcGVkTWluWSAtIG1pblkpICogaW1hZ2VQYXJhbXNUb1NjcmVlblNjYWxlWSksXHJcbiAgICAgICAgbWF4WEV4Y2x1c2l2ZSA6IE1hdGguY2VpbCgoY3JvcHBlZE1heFggLSBtaW5YKSAqIGltYWdlUGFyYW1zVG9TY3JlZW5TY2FsZVgpLFxyXG4gICAgICAgIG1heFlFeGNsdXNpdmUgOiBNYXRoLmNlaWwoKGNyb3BwZWRNYXhZIC0gbWluWSkgKiBpbWFnZVBhcmFtc1RvU2NyZWVuU2NhbGVZKVxyXG4gICAgfTtcclxuICAgIFxyXG4gICAgcmV0dXJuIHtcclxuICAgICAgICBpbWFnZVBhcnRQYXJhbXM6IGltYWdlUGFydFBhcmFtcyxcclxuICAgICAgICBwb3NpdGlvbkluSW1hZ2U6IHBvc2l0aW9uSW5JbWFnZSxcclxuICAgICAgICBjcm9wcGVkU2NyZWVuOiBjcm9wcGVkU2NyZWVuXHJcbiAgICB9O1xyXG59XHJcblxyXG5mdW5jdGlvbiBnZXRDbGFzc0luR2xvYmFsT2JqZWN0KGdsb2JhbE9iamVjdCwgY2xhc3NOYW1lKSB7XHJcbiAgICBpZiAoZ2xvYmFsT2JqZWN0W2NsYXNzTmFtZV0pIHtcclxuICAgICAgICByZXR1cm4gZ2xvYmFsT2JqZWN0W2NsYXNzTmFtZV07XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHZhciByZXN1bHQgPSBnbG9iYWxPYmplY3Q7XHJcbiAgICB2YXIgcGF0aCA9IGNsYXNzTmFtZS5zcGxpdCgnLicpO1xyXG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBwYXRoLmxlbmd0aDsgKytpKSB7XHJcbiAgICAgICAgcmVzdWx0ID0gcmVzdWx0W3BhdGhbaV1dO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICByZXR1cm4gcmVzdWx0O1xyXG59IiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBMaW5rZWRMaXN0O1xyXG5cclxuZnVuY3Rpb24gTGlua2VkTGlzdCgpIHtcclxuICAgIHRoaXMuX2ZpcnN0ID0geyBfcHJldjogbnVsbCwgX3BhcmVudDogdGhpcyB9O1xyXG4gICAgdGhpcy5fbGFzdCA9IHsgX25leHQ6IG51bGwsIF9wYXJlbnQ6IHRoaXMgfTtcclxuICAgIHRoaXMuX2NvdW50ID0gMDtcclxuICAgIFxyXG4gICAgdGhpcy5fbGFzdC5fcHJldiA9IHRoaXMuX2ZpcnN0O1xyXG4gICAgdGhpcy5fZmlyc3QuX25leHQgPSB0aGlzLl9sYXN0O1xyXG59XHJcblxyXG5MaW5rZWRMaXN0LnByb3RvdHlwZS5hZGQgPSBmdW5jdGlvbiBhZGQodmFsdWUsIGFkZEJlZm9yZSkge1xyXG4gICAgaWYgKGFkZEJlZm9yZSA9PT0gbnVsbCB8fCBhZGRCZWZvcmUgPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIGFkZEJlZm9yZSA9IHRoaXMuX2xhc3Q7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHRoaXMuX3ZhbGlkYXRlSXRlcmF0b3JPZlRoaXMoYWRkQmVmb3JlKTtcclxuICAgIFxyXG4gICAgKyt0aGlzLl9jb3VudDtcclxuICAgIFxyXG4gICAgdmFyIG5ld05vZGUgPSB7XHJcbiAgICAgICAgX3ZhbHVlOiB2YWx1ZSxcclxuICAgICAgICBfbmV4dDogYWRkQmVmb3JlLFxyXG4gICAgICAgIF9wcmV2OiBhZGRCZWZvcmUuX3ByZXYsXHJcbiAgICAgICAgX3BhcmVudDogdGhpc1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgbmV3Tm9kZS5fcHJldi5fbmV4dCA9IG5ld05vZGU7XHJcbiAgICBhZGRCZWZvcmUuX3ByZXYgPSBuZXdOb2RlO1xyXG4gICAgXHJcbiAgICByZXR1cm4gbmV3Tm9kZTtcclxufTtcclxuXHJcbkxpbmtlZExpc3QucHJvdG90eXBlLnJlbW92ZSA9IGZ1bmN0aW9uIHJlbW92ZShpdGVyYXRvcikge1xyXG4gICAgdGhpcy5fdmFsaWRhdGVJdGVyYXRvck9mVGhpcyhpdGVyYXRvcik7XHJcbiAgICBcclxuICAgIC0tdGhpcy5fY291bnQ7XHJcbiAgICBcclxuICAgIGl0ZXJhdG9yLl9wcmV2Ll9uZXh0ID0gaXRlcmF0b3IuX25leHQ7XHJcbiAgICBpdGVyYXRvci5fbmV4dC5fcHJldiA9IGl0ZXJhdG9yLl9wcmV2O1xyXG4gICAgaXRlcmF0b3IuX3BhcmVudCA9IG51bGw7XHJcbn07XHJcblxyXG5MaW5rZWRMaXN0LnByb3RvdHlwZS5nZXRWYWx1ZSA9IGZ1bmN0aW9uIGdldFZhbHVlKGl0ZXJhdG9yKSB7XHJcbiAgICB0aGlzLl92YWxpZGF0ZUl0ZXJhdG9yT2ZUaGlzKGl0ZXJhdG9yKTtcclxuICAgIFxyXG4gICAgcmV0dXJuIGl0ZXJhdG9yLl92YWx1ZTtcclxufTtcclxuXHJcbkxpbmtlZExpc3QucHJvdG90eXBlLmdldEZpcnN0SXRlcmF0b3IgPSBmdW5jdGlvbiBnZXRGaXJzdEl0ZXJhdG9yKCkge1xyXG4gICAgdmFyIGl0ZXJhdG9yID0gdGhpcy5nZXROZXh0SXRlcmF0b3IodGhpcy5fZmlyc3QpO1xyXG4gICAgcmV0dXJuIGl0ZXJhdG9yO1xyXG59O1xyXG5cclxuTGlua2VkTGlzdC5wcm90b3R5cGUuZ2V0TGFzdEl0ZXJhdG9yID0gZnVuY3Rpb24gZ2V0Rmlyc3RJdGVyYXRvcigpIHtcclxuICAgIHZhciBpdGVyYXRvciA9IHRoaXMuZ2V0UHJldkl0ZXJhdG9yKHRoaXMuX2xhc3QpO1xyXG4gICAgcmV0dXJuIGl0ZXJhdG9yO1xyXG59O1xyXG5cclxuTGlua2VkTGlzdC5wcm90b3R5cGUuZ2V0TmV4dEl0ZXJhdG9yID0gZnVuY3Rpb24gZ2V0TmV4dEl0ZXJhdG9yKGl0ZXJhdG9yKSB7XHJcbiAgICB0aGlzLl92YWxpZGF0ZUl0ZXJhdG9yT2ZUaGlzKGl0ZXJhdG9yKTtcclxuXHJcbiAgICBpZiAoaXRlcmF0b3IuX25leHQgPT09IHRoaXMuX2xhc3QpIHtcclxuICAgICAgICByZXR1cm4gbnVsbDtcclxuICAgIH1cclxuICAgIFxyXG4gICAgcmV0dXJuIGl0ZXJhdG9yLl9uZXh0O1xyXG59O1xyXG5cclxuTGlua2VkTGlzdC5wcm90b3R5cGUuZ2V0UHJldkl0ZXJhdG9yID0gZnVuY3Rpb24gZ2V0UHJldkl0ZXJhdG9yKGl0ZXJhdG9yKSB7XHJcbiAgICB0aGlzLl92YWxpZGF0ZUl0ZXJhdG9yT2ZUaGlzKGl0ZXJhdG9yKTtcclxuXHJcbiAgICBpZiAoaXRlcmF0b3IuX3ByZXYgPT09IHRoaXMuX2ZpcnN0KSB7XHJcbiAgICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHJldHVybiBpdGVyYXRvci5fcHJldjtcclxufTtcclxuXHJcbkxpbmtlZExpc3QucHJvdG90eXBlLmdldENvdW50ID0gZnVuY3Rpb24gZ2V0Q291bnQoKSB7XHJcbiAgICByZXR1cm4gdGhpcy5fY291bnQ7XHJcbn07XHJcblxyXG5MaW5rZWRMaXN0LnByb3RvdHlwZS5fdmFsaWRhdGVJdGVyYXRvck9mVGhpcyA9XHJcbiAgICBmdW5jdGlvbiB2YWxpZGF0ZUl0ZXJhdG9yT2ZUaGlzKGl0ZXJhdG9yKSB7XHJcbiAgICBcclxuICAgIGlmIChpdGVyYXRvci5fcGFyZW50ICE9PSB0aGlzKSB7XHJcbiAgICAgICAgdGhyb3cgJ2l0ZXJhdG9yIG11c3QgYmUgb2YgdGhlIGN1cnJlbnQgTGlua2VkTGlzdCc7XHJcbiAgICB9XHJcbn07IiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxuLy8gU3VwcHJlc3MgXCJVbm5lY2Vzc2FyeSBkaXJlY3RpdmUgJ3VzZSBzdHJpY3QnXCIgZm9yIHRoZSBzbGF2ZVNjcmlwdENvbnRlbnQgZnVuY3Rpb25cclxuLypqc2hpbnQgLVcwMzQgKi9cclxuXHJcbnZhciBJbWFnZURlY29kZXIgPSByZXF1aXJlKCdpbWFnZWRlY29kZXIuanMnKTtcclxuXHJcbm1vZHVsZS5leHBvcnRzLmdldFNjcmlwdFVybCA9IGZ1bmN0aW9uIGdldFNjcmlwdFVybCgpIHtcclxuICAgIHJldHVybiBzbGF2ZVNjcmlwdFVybDtcclxufTtcclxuXHJcbnZhciBzbGF2ZVNjcmlwdEJsb2IgPSBuZXcgQmxvYihcclxuICAgIFsnKCcsIHNsYXZlU2NyaXB0Q29udGVudC50b1N0cmluZygpLCAnKSgpJ10sXHJcbiAgICB7IHR5cGU6ICdhcHBsaWNhdGlvbi9qYXZhc2NyaXB0JyB9KTtcclxudmFyIHNsYXZlU2NyaXB0VXJsID0gVVJMLmNyZWF0ZU9iamVjdFVSTChzbGF2ZVNjcmlwdEJsb2IpO1xyXG5cclxuZnVuY3Rpb24gc2xhdmVTY3JpcHRDb250ZW50KCkge1xyXG4gICAgJ3VzZSBzdHJpY3QnO1xyXG4gICAgQXN5bmNQcm94eS5Bc3luY1Byb3h5U2xhdmUuc2V0U2xhdmVTaWRlQ3JlYXRvcihmdW5jdGlvbigpIHtcclxuICAgICAgICB2YXIgYXJndW1lbnRzQXNBcnJheSA9IG5ldyBBcnJheShhcmd1bWVudHMubGVuZ3RoICsgMSk7XHJcbiAgICAgICAgYXJndW1lbnRzQXNBcnJheVswXSA9IG51bGw7XHJcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBhcmd1bWVudHMubGVuZ3RoOyArK2kpIHtcclxuICAgICAgICAgICAgYXJndW1lbnRzQXNBcnJheVtpICsgMV0gPSBhcmd1bWVudHNbaV07XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHZhciBpbnN0YW5jZSA9IG5ldyAoRnVuY3Rpb24ucHJvdG90eXBlLmJpbmQuYXBwbHkoaW1hZ2VEZWNvZGVyRnJhbWV3b3JrLkltYWdlRGVjb2RlciwgYXJndW1lbnRzQXNBcnJheSkpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHJldHVybiBpbnN0YW5jZTtcclxuICAgIH0pO1xyXG59IiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBJbWFnZVBhcmFtc1JldHJpZXZlclByb3h5O1xyXG5cclxuZnVuY3Rpb24gSW1hZ2VQYXJhbXNSZXRyaWV2ZXJQcm94eSgpIHtcclxuICAgIHRoaXMuX3NpemVzUGFyYW1zID0gbnVsbDtcclxufVxyXG5cclxuSW1hZ2VQYXJhbXNSZXRyaWV2ZXJQcm94eS5wcm90b3R5cGUuZ2V0SW1hZ2VMZXZlbCA9IGZ1bmN0aW9uIGdldEltYWdlTGV2ZWwoKSB7XHJcbiAgICB2YXIgc2l6ZXNQYXJhbXMgPSB0aGlzLmdldEltYWdlUGFyYW1zKCk7XHJcblxyXG4gICAgcmV0dXJuIHNpemVzUGFyYW1zLmltYWdlTGV2ZWw7XHJcbn07XHJcblxyXG5JbWFnZVBhcmFtc1JldHJpZXZlclByb3h5LnByb3RvdHlwZS5nZXRJbWFnZVdpZHRoID0gZnVuY3Rpb24gZ2V0SW1hZ2VXaWR0aCgpIHtcclxuICAgIHZhciBzaXplc1BhcmFtcyA9IHRoaXMuZ2V0SW1hZ2VQYXJhbXMoKTtcclxuXHJcbiAgICByZXR1cm4gc2l6ZXNQYXJhbXMuaW1hZ2VXaWR0aDtcclxufTtcclxuXHJcbkltYWdlUGFyYW1zUmV0cmlldmVyUHJveHkucHJvdG90eXBlLmdldEltYWdlSGVpZ2h0ID0gZnVuY3Rpb24gZ2V0SW1hZ2VIZWlnaHQoKSB7XHJcbiAgICB2YXIgc2l6ZXNQYXJhbXMgPSB0aGlzLmdldEltYWdlUGFyYW1zKCk7XHJcblxyXG4gICAgcmV0dXJuIHNpemVzUGFyYW1zLmltYWdlSGVpZ2h0O1xyXG59O1xyXG5cclxuSW1hZ2VQYXJhbXNSZXRyaWV2ZXJQcm94eS5wcm90b3R5cGUuZ2V0TnVtUmVzb2x1dGlvbkxldmVsc0ZvckxpbWl0dGVkVmlld2VyID0gZnVuY3Rpb24gZ2V0TnVtUmVzb2x1dGlvbkxldmVsc0ZvckxpbWl0dGVkVmlld2VyKCkge1xyXG4gICAgdmFyIHNpemVzUGFyYW1zID0gdGhpcy5nZXRJbWFnZVBhcmFtcygpO1xyXG5cclxuICAgIHJldHVybiBzaXplc1BhcmFtcy5udW1SZXNvbHV0aW9uTGV2ZWxzRm9yTGltaXR0ZWRWaWV3ZXI7XHJcbn07XHJcblxyXG5JbWFnZVBhcmFtc1JldHJpZXZlclByb3h5LnByb3RvdHlwZS5nZXRMb3dlc3RRdWFsaXR5ID0gZnVuY3Rpb24gZ2V0TG93ZXN0UXVhbGl0eSgpIHtcclxuICAgIHZhciBzaXplc1BhcmFtcyA9IHRoaXMuZ2V0SW1hZ2VQYXJhbXMoKTtcclxuXHJcbiAgICByZXR1cm4gc2l6ZXNQYXJhbXMubG93ZXN0UXVhbGl0eTtcclxufTtcclxuXHJcbkltYWdlUGFyYW1zUmV0cmlldmVyUHJveHkucHJvdG90eXBlLmdldEhpZ2hlc3RRdWFsaXR5ID0gZnVuY3Rpb24gZ2V0SGlnaGVzdFF1YWxpdHkoKSB7XHJcbiAgICB2YXIgc2l6ZXNQYXJhbXMgPSB0aGlzLmdldEltYWdlUGFyYW1zKCk7XHJcblxyXG4gICAgcmV0dXJuIHNpemVzUGFyYW1zLmhpZ2hlc3RRdWFsaXR5O1xyXG59O1xyXG5cclxuSW1hZ2VQYXJhbXNSZXRyaWV2ZXJQcm94eS5wcm90b3R5cGUuZ2V0SW1hZ2VQYXJhbXMgPSBmdW5jdGlvbiBnZXRJbWFnZVBhcmFtcygpIHtcclxuICAgIGlmICghdGhpcy5fc2l6ZXNQYXJhbXMpIHtcclxuICAgICAgICB0aGlzLl9zaXplc1BhcmFtcyA9IHRoaXMuX2dldEltYWdlUGFyYW1zSW50ZXJuYWwoKTtcclxuICAgICAgICBpZiAoIXRoaXMuX3NpemVzUGFyYW1zKSB7XHJcbiAgICAgICAgICAgIHRocm93ICdnZXRJbWFnZVBhcmFtc0ludGVybmFsKCkgcmV0dXJuZWQgZmFsc3kgdmFsdWU7IE1heWJlIGltYWdlIG5vdCByZWFkeSB5ZXQ/JztcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKHRoaXMuX3NpemVzUGFyYW1zLmltYWdlTGV2ZWwgPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgICAgICB0aHJvdyAnZ2V0SW1hZ2VQYXJhbXNJbnRlcm5hbCgpIHJlc3VsdCBoYXMgbm8gaW1hZ2VMZXZlbCBwcm9wZXJ0eSc7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIGlmICh0aGlzLl9zaXplc1BhcmFtcy5pbWFnZVdpZHRoID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICAgICAgdGhyb3cgJ2dldEltYWdlUGFyYW1zSW50ZXJuYWwoKSByZXN1bHQgaGFzIG5vIGltYWdlV2lkdGggcHJvcGVydHknO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBpZiAodGhpcy5fc2l6ZXNQYXJhbXMuaW1hZ2VIZWlnaHQgPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgICAgICB0aHJvdyAnZ2V0SW1hZ2VQYXJhbXNJbnRlcm5hbCgpIHJlc3VsdCBoYXMgbm8gaW1hZ2VIZWlnaHQgcHJvcGVydHknO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBpZiAodGhpcy5fc2l6ZXNQYXJhbXMubnVtUmVzb2x1dGlvbkxldmVsc0ZvckxpbWl0dGVkVmlld2VyID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICAgICAgdGhyb3cgJ2dldEltYWdlUGFyYW1zSW50ZXJuYWwoKSByZXN1bHQgaGFzIG5vIG51bVJlc29sdXRpb25MZXZlbHNGb3JMaW1pdHRlZFZpZXdlciBwcm9wZXJ0eSc7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIGlmICh0aGlzLl9zaXplc1BhcmFtcy5sb3dlc3RRdWFsaXR5ID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICAgICAgdGhyb3cgJ2dldEltYWdlUGFyYW1zSW50ZXJuYWwoKSByZXN1bHQgaGFzIG5vIGxvd2VzdFF1YWxpdHkgcHJvcGVydHknO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBpZiAodGhpcy5fc2l6ZXNQYXJhbXMuaGlnaGVzdFF1YWxpdHkgPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgICAgICB0aHJvdyAnZ2V0SW1hZ2VQYXJhbXNJbnRlcm5hbCgpIHJlc3VsdCBoYXMgbm8gaGlnaGVzdFF1YWxpdHkgcHJvcGVydHknO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuICAgIFxyXG4gICAgcmV0dXJuIHRoaXMuX3NpemVzUGFyYW1zO1xyXG59O1xyXG5cclxuSW1hZ2VQYXJhbXNSZXRyaWV2ZXJQcm94eS5wcm90b3R5cGUuX2dldEltYWdlUGFyYW1zSW50ZXJuYWwgPSBmdW5jdGlvbiBnZXRJbWFnZVBhcmFtc0ludGVybmFsKCkge1xyXG4gICAgdGhyb3cgJ0ltYWdlUGFyYW1zUmV0cmlldmVyUHJveHkgaW5oZXJpdG9yIGRpZCBub3QgaW1wbGVtZW50IF9nZXRJbWFnZVBhcmFtc0ludGVybmFsKCknO1xyXG59OyIsIid1c2Ugc3RyaWN0JztcclxuXHJcbi8vIFN1cHByZXNzIFwiVW5uZWNlc3NhcnkgZGlyZWN0aXZlICd1c2Ugc3RyaWN0J1wiIGZvciB0aGUgc2xhdmVTY3JpcHRDb250ZW50IGZ1bmN0aW9uXHJcbi8qanNoaW50IC1XMDM0ICovXHJcblxyXG5tb2R1bGUuZXhwb3J0cy5nZXRTY3JpcHRVcmwgPSBmdW5jdGlvbiBnZXRTY3JpcHRVcmwoKSB7XHJcbiAgICByZXR1cm4gc2xhdmVTY3JpcHRVcmw7XHJcbn07XHJcblxyXG52YXIgc2xhdmVTY3JpcHRCbG9iID0gbmV3IEJsb2IoXHJcbiAgICBbJygnLCBzbGF2ZVNjcmlwdENvbnRlbnQudG9TdHJpbmcoKSwgJykoKSddLFxyXG4gICAgeyB0eXBlOiAnYXBwbGljYXRpb24vamF2YXNjcmlwdCcgfSk7XHJcbnZhciBzbGF2ZVNjcmlwdFVybCA9IFVSTC5jcmVhdGVPYmplY3RVUkwoc2xhdmVTY3JpcHRCbG9iKTtcclxuXHJcbmZ1bmN0aW9uIHNsYXZlU2NyaXB0Q29udGVudCgpIHtcclxuICAgICd1c2Ugc3RyaWN0JztcclxuICAgIFxyXG4gICAgdmFyIGlzUmVhZHkgPSBmYWxzZTtcclxuXHJcbiAgICBBc3luY1Byb3h5LkFzeW5jUHJveHlTbGF2ZS5zZXRCZWZvcmVPcGVyYXRpb25MaXN0ZW5lcihiZWZvcmVPcGVyYXRpb25MaXN0ZW5lcik7XHJcblxyXG4gICAgZnVuY3Rpb24gYmVmb3JlT3BlcmF0aW9uTGlzdGVuZXIob3BlcmF0aW9uVHlwZSwgb3BlcmF0aW9uTmFtZSwgYXJncykge1xyXG4gICAgICAgIC8qIGpzaGludCB2YWxpZHRoaXM6IHRydWUgKi9cclxuICAgICAgICBcclxuICAgICAgICBpZiAob3BlcmF0aW9uVHlwZSAhPT0gJ2NhbGxiYWNrJyB8fCBvcGVyYXRpb25OYW1lICE9PSAnc3RhdHVzQ2FsbGJhY2snKSB7XHJcbiAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKGlzUmVhZHkgfHwgIWFyZ3NbMF0uaXNSZWFkeSkge1xyXG4gICAgICAgICAgICByZXR1cm4gbnVsbDtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgdmFyIGRhdGEgPSB7IHNpemVzUGFyYW1zOiB0aGlzLmdldEltYWdlUGFyYW1zKCkgfTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBnZXRUaWxlV2lkdGggYW5kIGdldFRpbGVIZWlnaHQgZXhpc3RzIG9ubHkgaW4gSW1hZ2VEZWNvZGVyIGJ1dCBub3QgaW4gRmV0Y2hNYW5hZ2VyXHJcbiAgICAgICAgaWYgKHRoaXMuZ2V0VGlsZVdpZHRoKSB7XHJcbiAgICAgICAgICAgIGRhdGEuYXBwbGljYXRpdmVUaWxlV2lkdGggPSB0aGlzLmdldFRpbGVXaWR0aCgpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBpZiAodGhpcy5nZXRUaWxlSGVpZ2h0KSB7XHJcbiAgICAgICAgICAgIGRhdGEuYXBwbGljYXRpdmVUaWxlSGVpZ2h0ID0gdGhpcy5nZXRUaWxlSGVpZ2h0KCk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIEFzeW5jUHJveHkuQXN5bmNQcm94eVNsYXZlLnNlbmRVc2VyRGF0YVRvTWFzdGVyKGRhdGEpO1xyXG4gICAgICAgIGlzUmVhZHkgPSB0cnVlO1xyXG4gICAgfVxyXG59IiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxuLy8gU3VwcHJlc3MgXCJVbm5lY2Vzc2FyeSBkaXJlY3RpdmUgJ3VzZSBzdHJpY3QnXCIgZm9yIHRoZSBzbGF2ZVNjcmlwdENvbnRlbnQgZnVuY3Rpb25cclxuLypqc2hpbnQgLVcwMzQgKi9cclxuXHJcbi8qIGdsb2JhbCBzZWxmOiBmYWxzZSAqL1xyXG4vKiBnbG9iYWwgaW1hZ2VEZWNvZGVyRnJhbWV3b3JrOiBmYWxzZSAqL1xyXG5cclxubW9kdWxlLmV4cG9ydHMuZ2V0U2NyaXB0VXJsID0gZnVuY3Rpb24gZ2V0U2NyaXB0VXJsKCkge1xyXG4gICAgcmV0dXJuIGRlY29kZXJTbGF2ZVNjcmlwdFVybDtcclxufTtcclxuXHJcbnZhciBpbWFnZUhlbHBlckZ1bmN0aW9ucyA9IHJlcXVpcmUoJ2ltYWdlaGVscGVyZnVuY3Rpb25zLmpzJyk7XHJcblxyXG52YXIgZGVjb2RlclNsYXZlU2NyaXB0QmxvYiA9IG5ldyBCbG9iKFxyXG4gICAgWycoJywgZGVjb2RlclNsYXZlU2NyaXB0Qm9keS50b1N0cmluZygpLCAnKSgpJ10sXHJcbiAgICB7IHR5cGU6ICdhcHBsaWNhdGlvbi9qYXZhc2NyaXB0JyB9KTtcclxudmFyIGRlY29kZXJTbGF2ZVNjcmlwdFVybCA9IFVSTC5jcmVhdGVPYmplY3RVUkwoZGVjb2RlclNsYXZlU2NyaXB0QmxvYik7XHJcblxyXG4vL2Z1bmN0aW9uIFdvcmtlclByb3h5UGl4ZWxzRGVjb2RlcihvcHRpb25zKSB7XHJcbi8vICAgIHRoaXMuX29wdGlvbnMgPSBvcHRpb25zIHx8IHt9O1xyXG4vLyAgICB0aGlzLl9pbWFnZUltcGxlbWVudGF0aW9uID0gaW1hZ2VIZWxwZXJGdW5jdGlvbnMuZ2V0SW1hZ2VJbXBsZW1lbnRhdGlvbihcclxuLy8gICAgICAgIG9wdGlvbnMuaW1hZ2VJbXBsZW1lbnRhdGlvbkNsYXNzTmFtZSk7XHJcbi8vICAgIFxyXG4vLyAgICB2YXIgc2NyaXB0c1RvSW1wb3J0ID0gKHRoaXMuX29wdGlvbnMuc2NyaXB0c1RvSW1wb3J0IHx8IFtdKS5jb25jYXQoW2RlY29kZXJTbGF2ZVNjcmlwdFVybF0pO1xyXG4vLyAgICB2YXIgYXJncyA9IFt0aGlzLl9vcHRpb25zXTtcclxuLy8gICAgXHJcbi8vICAgIHRoaXMuX3dvcmtlckhlbHBlciA9IG5ldyBBc3luY1Byb3h5LkFzeW5jUHJveHlNYXN0ZXIoXHJcbi8vICAgICAgICBzY3JpcHRzVG9JbXBvcnQsXHJcbi8vICAgICAgICAnQXJiaXRyYXJ5Q2xhc3NOYW1lJyxcclxuLy8gICAgICAgIGFyZ3MpO1xyXG4vL31cclxuLy9cclxuLy9Xb3JrZXJQcm94eVBpeGVsc0RlY29kZXIucHJvdG90eXBlLmRlY29kZSA9IGZ1bmN0aW9uIGRlY29kZShkYXRhRm9yRGVjb2RlKSB7XHJcbi8vICAgIC8vdmFyIHRyYW5zZmVyYWJsZXMgPSB0aGlzLl9pbWFnZUltcGxlbWVudGF0aW9uLmdldFRyYW5zZmVyYWJsZU9mRGVjb2RlQXJndW1lbnRzKGRhdGFGb3JEZWNvZGUpO1xyXG4vLyAgICB2YXIgcmVzdWx0VHJhbnNmZXJhYmxlcyA9IFtbJ2RhdGEnLCAnYnVmZmVyJ11dO1xyXG4vLyAgICBcclxuLy8gICAgdmFyIGFyZ3MgPSBbZGF0YUZvckRlY29kZV07XHJcbi8vICAgIHZhciBvcHRpb25zID0ge1xyXG4vLyAgICAgICAgLy90cmFuc2ZlcmFibGVzOiB0cmFuc2ZlcmFibGVzLFxyXG4vLyAgICAgICAgcGF0aHNUb1RyYW5zZmVyYWJsZXNJblByb21pc2VSZXN1bHQ6IHJlc3VsdFRyYW5zZmVyYWJsZXMsXHJcbi8vICAgICAgICBpc1JldHVyblByb21pc2U6IHRydWVcclxuLy8gICAgfTtcclxuLy8gICAgXHJcbi8vICAgIHJldHVybiB0aGlzLl93b3JrZXJIZWxwZXIuY2FsbEZ1bmN0aW9uKCdkZWNvZGUnLCBhcmdzLCBvcHRpb25zKTtcclxuLy99O1xyXG5cclxuLy9Xb3JrZXJQcm94eVBpeGVsc0RlY29kZXIucHJvdG90eXBlLnRlcm1pbmF0ZSA9IGZ1bmN0aW9uIHRlcm1pbmF0ZSgpIHtcclxuLy8gICAgdGhpcy5fd29ya2VySGVscGVyLnRlcm1pbmF0ZSgpO1xyXG4vL307XHJcblxyXG5mdW5jdGlvbiBkZWNvZGVyU2xhdmVTY3JpcHRCb2R5KCkge1xyXG4gICAgJ3VzZSBzdHJpY3QnO1xyXG5cclxuICAgIEFzeW5jUHJveHkuQXN5bmNQcm94eVNsYXZlLnNldFNsYXZlU2lkZUNyZWF0b3IoZnVuY3Rpb24gY3JlYXRlRGVjb2RlcihvcHRpb25zKSB7XHJcbiAgICAgICAgLy92YXIgaW1hZ2VJbXBsZW1lbnRhdGlvbiA9IHNlbGZbb3B0aW9ucy5pbWFnZUltcGxlbWVudGF0aW9uQ2xhc3NOYW1lXTtcclxuICAgICAgICB2YXIgaW1hZ2VJbXBsZW1lbnRhdGlvbiA9IGltYWdlRGVjb2RlckZyYW1ld29yay5JbnRlcm5hbHMuaW1hZ2VIZWxwZXJGdW5jdGlvbnMuZ2V0SW1hZ2VJbXBsZW1lbnRhdGlvbihvcHRpb25zLmltYWdlSW1wbGVtZW50YXRpb25DbGFzc05hbWUpO1xyXG4gICAgICAgIHJldHVybiBpbWFnZUltcGxlbWVudGF0aW9uLmNyZWF0ZVBpeGVsc0RlY29kZXIoKTtcclxuICAgIH0pO1xyXG59IiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBXb3JrZXJQcm94eUltYWdlRGVjb2RlcjtcclxuXHJcbnZhciBpbWFnZUhlbHBlckZ1bmN0aW9ucyA9IHJlcXVpcmUoJ2ltYWdlaGVscGVyZnVuY3Rpb25zLmpzJyk7XHJcbnZhciBzZW5kSW1hZ2VQYXJhbWV0ZXJzVG9NYXN0ZXIgPSByZXF1aXJlKCdzZW5kaW1hZ2VwYXJhbWV0ZXJzdG9tYXN0ZXIuanMnKTtcclxudmFyIGNyZWF0ZUltYWdlRGVjb2RlclNsYXZlU2lkZSA9IHJlcXVpcmUoJ2NyZWF0ZWltYWdlZGVjb2Rlcm9uc2xhdmVzaWRlLmpzJyk7XHJcbnZhciBJbWFnZVBhcmFtc1JldHJpZXZlclByb3h5ID0gcmVxdWlyZSgnaW1hZ2VwYXJhbXNyZXRyaWV2ZXJwcm94eS5qcycpO1xyXG5cclxuZnVuY3Rpb24gV29ya2VyUHJveHlJbWFnZURlY29kZXIoaW1hZ2VJbXBsZW1lbnRhdGlvbkNsYXNzTmFtZSwgb3B0aW9ucykge1xyXG4gICAgSW1hZ2VQYXJhbXNSZXRyaWV2ZXJQcm94eS5jYWxsKHRoaXMpO1xyXG5cclxuICAgIHRoaXMuX2ltYWdlV2lkdGggPSBudWxsO1xyXG4gICAgdGhpcy5faW1hZ2VIZWlnaHQgPSBudWxsO1xyXG4gICAgdGhpcy5fdGlsZVdpZHRoID0gMDtcclxuICAgIHRoaXMuX3RpbGVIZWlnaHQgPSAwO1xyXG4gICAgXHJcbiAgICB2YXIgb3B0aW9uc0ludGVybmFsID0gaW1hZ2VIZWxwZXJGdW5jdGlvbnMuY3JlYXRlSW50ZXJuYWxPcHRpb25zKGltYWdlSW1wbGVtZW50YXRpb25DbGFzc05hbWUsIG9wdGlvbnMpO1xyXG4gICAgdmFyIGN0b3JBcmdzID0gW2ltYWdlSW1wbGVtZW50YXRpb25DbGFzc05hbWUsIG9wdGlvbnNJbnRlcm5hbF07XHJcbiAgICBcclxuICAgIHZhciBzY3JpcHRzVG9JbXBvcnQgPSBpbWFnZUhlbHBlckZ1bmN0aW9ucy5nZXRTY3JpcHRzRm9yV29ya2VySW1wb3J0KFxyXG4gICAgICAgIHRoaXMuX2ltYWdlSW1wbGVtZW50YXRpb24sIG9wdGlvbnMpO1xyXG4gICAgc2NyaXB0c1RvSW1wb3J0ID0gc2NyaXB0c1RvSW1wb3J0LmNvbmNhdChbXHJcbiAgICAgICAgc2VuZEltYWdlUGFyYW1ldGVyc1RvTWFzdGVyLmdldFNjcmlwdFVybCgpLFxyXG4gICAgICAgIGNyZWF0ZUltYWdlRGVjb2RlclNsYXZlU2lkZS5nZXRTY3JpcHRVcmwoKV0pO1xyXG5cclxuICAgIHRoaXMuX3dvcmtlckhlbHBlciA9IG5ldyBBc3luY1Byb3h5LkFzeW5jUHJveHlNYXN0ZXIoXHJcbiAgICAgICAgc2NyaXB0c1RvSW1wb3J0LCAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrLkltYWdlRGVjb2RlcicsIGN0b3JBcmdzKTtcclxuICAgIFxyXG4gICAgdmFyIGJvdW5kSW1hZ2VPcGVuZWQgPSB0aGlzLl9pbWFnZU9wZW5lZC5iaW5kKHRoaXMpO1xyXG4gICAgdGhpcy5fd29ya2VySGVscGVyLnNldFVzZXJEYXRhSGFuZGxlcihib3VuZEltYWdlT3BlbmVkKTtcclxufVxyXG5cclxuV29ya2VyUHJveHlJbWFnZURlY29kZXIucHJvdG90eXBlID0gT2JqZWN0LmNyZWF0ZShJbWFnZVBhcmFtc1JldHJpZXZlclByb3h5LnByb3RvdHlwZSk7XHJcblxyXG5Xb3JrZXJQcm94eUltYWdlRGVjb2Rlci5wcm90b3R5cGUuZ2V0VGlsZVdpZHRoID0gZnVuY3Rpb24gZ2V0VGlsZVdpZHRoKCkge1xyXG4gICAgdGhpcy5nZXRJbWFnZVBhcmFtcygpO1xyXG4gICAgcmV0dXJuIHRoaXMuX3RpbGVXaWR0aDtcclxufTtcclxuXHJcbldvcmtlclByb3h5SW1hZ2VEZWNvZGVyLnByb3RvdHlwZS5nZXRUaWxlSGVpZ2h0ID0gZnVuY3Rpb24gZ2V0VGlsZUhlaWdodCgpIHtcclxuICAgIHRoaXMuZ2V0SW1hZ2VQYXJhbXMoKTtcclxuICAgIHJldHVybiB0aGlzLl90aWxlSGVpZ2h0O1xyXG59O1xyXG5cclxuV29ya2VyUHJveHlJbWFnZURlY29kZXIucHJvdG90eXBlLm9wZW4gPSBmdW5jdGlvbiBvcGVuKHVybCkge1xyXG4gICAgdmFyIHNlbGYgPSB0aGlzO1xyXG4gICAgcmV0dXJuIHRoaXMuX3dvcmtlckhlbHBlci5jYWxsRnVuY3Rpb24oJ29wZW4nLCBbdXJsXSwgeyBpc1JldHVyblByb21pc2U6IHRydWUgfSlcclxuICAgICAgICAudGhlbihmdW5jdGlvbihpbWFnZVBhcmFtcykge1xyXG4gICAgICAgICAgICBzZWxmLl9pbWFnZU9wZW5lZChpbWFnZVBhcmFtcyk7XHJcbiAgICAgICAgICAgIHJldHVybiBpbWFnZVBhcmFtcztcclxuICAgICAgICB9KTtcclxufTtcclxuXHJcbldvcmtlclByb3h5SW1hZ2VEZWNvZGVyLnByb3RvdHlwZS5jbG9zZSA9IGZ1bmN0aW9uIGNsb3NlKCkge1xyXG4gICAgcmV0dXJuIHRoaXMuX3dvcmtlckhlbHBlci5jYWxsRnVuY3Rpb24oJ2Nsb3NlJywgW10sIHsgaXNSZXR1cm5Qcm9taXNlOiB0cnVlIH0pO1xyXG59O1xyXG5cclxuV29ya2VyUHJveHlJbWFnZURlY29kZXIucHJvdG90eXBlLmNyZWF0ZUNoYW5uZWwgPSBmdW5jdGlvbiBjcmVhdGVDaGFubmVsKCkge1xyXG4gICAgdGhpcy5fd29ya2VySGVscGVyLmNhbGxGdW5jdGlvbihcclxuICAgICAgICAnY3JlYXRlQ2hhbm5lbCcsIFtdLCB7IGlzUmV0dXJuUHJvbWlzZTogdHJ1ZSB9KTtcclxufTtcclxuXHJcbldvcmtlclByb3h5SW1hZ2VEZWNvZGVyLnByb3RvdHlwZS5yZXF1ZXN0UGl4ZWxzID0gZnVuY3Rpb24gcmVxdWVzdFBpeGVscyhpbWFnZVBhcnRQYXJhbXMpIHtcclxuICAgIHZhciBwYXRoVG9QaXhlbHNBcnJheSA9IFsnZGF0YScsICdidWZmZXInXTtcclxuICAgIHZhciB0cmFuc2ZlcmFibGVzID0gW3BhdGhUb1BpeGVsc0FycmF5XTtcclxuICAgIFxyXG4gICAgdmFyIGFyZ3MgPSBbaW1hZ2VQYXJ0UGFyYW1zXTtcclxuICAgIFxyXG4gICAgdGhpcy5fd29ya2VySGVscGVyLmNhbGxGdW5jdGlvbigncmVxdWVzdFBpeGVscycsIGFyZ3MsIHtcclxuICAgICAgICBpc1JldHVyblByb21pc2U6IHRydWUsXHJcbiAgICAgICAgcGF0aHNUb1RyYW5zZmVyYWJsZXNJblByb21pc2VSZXN1bHQ6IHRyYW5zZmVyYWJsZXNcclxuICAgIH0pO1xyXG59O1xyXG5cclxuV29ya2VyUHJveHlJbWFnZURlY29kZXIucHJvdG90eXBlLnJlcXVlc3RQaXhlbHNQcm9ncmVzc2l2ZSA9IGZ1bmN0aW9uIHJlcXVlc3RQaXhlbHNQcm9ncmVzc2l2ZShcclxuICAgIGltYWdlUGFydFBhcmFtcyxcclxuICAgIGNhbGxiYWNrLFxyXG4gICAgdGVybWluYXRlZENhbGxiYWNrLFxyXG4gICAgaW1hZ2VQYXJ0UGFyYW1zTm90TmVlZGVkLFxyXG4gICAgY2hhbm5lbEhhbmRsZSkge1xyXG4gICAgXHJcbiAgICB2YXIgdHJhbnNmZXJhYmxlcztcclxuICAgIFxyXG4gICAgLy8gTk9URTogQ2Fubm90IHBhc3MgaXQgYXMgdHJhbnNmZXJhYmxlcyBiZWNhdXNlIGl0IGlzIHBhc3NlZCB0byBhbGxcclxuICAgIC8vIGxpc3RlbmVyIGNhbGxiYWNrcywgdGh1cyBhZnRlciB0aGUgZmlyc3Qgb25lIHRoZSBidWZmZXIgaXMgbm90IHZhbGlkXHJcbiAgICBcclxuICAgIC8vdmFyIHBhdGhUb1BpeGVsc0FycmF5ID0gWzAsICdwaXhlbHMnLCAnYnVmZmVyJ107XHJcbiAgICAvL3RyYW5zZmVyYWJsZXMgPSBbcGF0aFRvUGl4ZWxzQXJyYXldO1xyXG4gICAgXHJcbiAgICB2YXIgaW50ZXJuYWxDYWxsYmFja1dyYXBwZXIgPVxyXG4gICAgICAgIHRoaXMuX3dvcmtlckhlbHBlci53cmFwQ2FsbGJhY2soXHJcbiAgICAgICAgICAgIGNhbGxiYWNrLCAncmVxdWVzdFBpeGVsc1Byb2dyZXNzaXZlQ2FsbGJhY2snLCB7XHJcbiAgICAgICAgICAgICAgICBpc011bHRpcGxlVGltZUNhbGxiYWNrOiB0cnVlLFxyXG4gICAgICAgICAgICAgICAgcGF0aHNUb1RyYW5zZmVyYWJsZXM6IHRyYW5zZmVyYWJsZXNcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICk7XHJcbiAgICBcclxuICAgIHZhciBpbnRlcm5hbFRlcm1pbmF0ZWRDYWxsYmFja1dyYXBwZXIgPVxyXG4gICAgICAgIHRoaXMuX3dvcmtlckhlbHBlci53cmFwQ2FsbGJhY2soXHJcbiAgICAgICAgICAgIGludGVybmFsVGVybWluYXRlZENhbGxiYWNrLCAncmVxdWVzdFBpeGVsc1Byb2dyZXNzaXZlVGVybWluYXRlZENhbGxiYWNrJywge1xyXG4gICAgICAgICAgICAgICAgaXNNdWx0aXBsZVRpbWVDYWxsYmFjazogZmFsc2VcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgdmFyIGFyZ3MgPSBbXHJcbiAgICAgICAgaW1hZ2VQYXJ0UGFyYW1zLFxyXG4gICAgICAgIGludGVybmFsQ2FsbGJhY2tXcmFwcGVyLFxyXG4gICAgICAgIGludGVybmFsVGVybWluYXRlZENhbGxiYWNrV3JhcHBlcixcclxuICAgICAgICBpbWFnZVBhcnRQYXJhbXNOb3ROZWVkZWQsXHJcbiAgICAgICAgY2hhbm5lbEhhbmRsZV07XHJcbiAgICBcclxuICAgIHRoaXMuX3dvcmtlckhlbHBlci5jYWxsRnVuY3Rpb24oJ3JlcXVlc3RQaXhlbHNQcm9ncmVzc2l2ZScsIGFyZ3MpO1xyXG4gICAgICAgIFxyXG4gICAgdmFyIHNlbGYgPSB0aGlzO1xyXG4gICAgXHJcbiAgICBmdW5jdGlvbiBpbnRlcm5hbFRlcm1pbmF0ZWRDYWxsYmFjayhpc0Fib3J0ZWQpIHtcclxuICAgICAgICBzZWxmLl93b3JrZXJIZWxwZXIuZnJlZUNhbGxiYWNrKGludGVybmFsQ2FsbGJhY2tXcmFwcGVyKTtcclxuICAgICAgICBcclxuICAgICAgICB0ZXJtaW5hdGVkQ2FsbGJhY2soaXNBYm9ydGVkKTtcclxuICAgIH1cclxufTtcclxuXHJcbldvcmtlclByb3h5SW1hZ2VEZWNvZGVyLnByb3RvdHlwZS5zZXRTZXJ2ZXJSZXF1ZXN0UHJpb3JpdGl6ZXJEYXRhID1cclxuICAgIGZ1bmN0aW9uIHNldFNlcnZlclJlcXVlc3RQcmlvcml0aXplckRhdGEocHJpb3JpdGl6ZXJEYXRhKSB7XHJcbiAgICBcclxuICAgIHRoaXMuX3dvcmtlckhlbHBlci5jYWxsRnVuY3Rpb24oXHJcbiAgICAgICAgJ3NldFNlcnZlclJlcXVlc3RQcmlvcml0aXplckRhdGEnLFxyXG4gICAgICAgIFsgcHJpb3JpdGl6ZXJEYXRhIF0sXHJcbiAgICAgICAgeyBpc1NlbmRJbW1lZGlhdGVseTogdHJ1ZSB9KTtcclxufTtcclxuXHJcbldvcmtlclByb3h5SW1hZ2VEZWNvZGVyLnByb3RvdHlwZS5zZXREZWNvZGVQcmlvcml0aXplckRhdGEgPVxyXG4gICAgZnVuY3Rpb24gc2V0RGVjb2RlUHJpb3JpdGl6ZXJEYXRhKHByaW9yaXRpemVyRGF0YSkge1xyXG4gICAgXHJcbiAgICB0aGlzLl93b3JrZXJIZWxwZXIuY2FsbEZ1bmN0aW9uKFxyXG4gICAgICAgICdzZXREZWNvZGVQcmlvcml0aXplckRhdGEnLFxyXG4gICAgICAgIFsgcHJpb3JpdGl6ZXJEYXRhIF0sXHJcbiAgICAgICAgeyBpc1NlbmRJbW1lZGlhdGVseTogdHJ1ZSB9KTtcclxufTtcclxuXHJcbldvcmtlclByb3h5SW1hZ2VEZWNvZGVyLnByb3RvdHlwZS5yZWNvbm5lY3QgPSBmdW5jdGlvbiByZWNvbm5lY3QoKSB7XHJcbiAgICB0aGlzLl93b3JrZXJIZWxwZXIuY2FsbEZ1bmN0aW9uKCdyZWNvbm5lY3QnKTtcclxufTtcclxuXHJcbldvcmtlclByb3h5SW1hZ2VEZWNvZGVyLnByb3RvdHlwZS5hbGlnblBhcmFtc1RvVGlsZXNBbmRMZXZlbCA9IGZ1bmN0aW9uIGFsaWduUGFyYW1zVG9UaWxlc0FuZExldmVsKHJlZ2lvbikge1xyXG5cdHJldHVybiBpbWFnZUhlbHBlckZ1bmN0aW9ucy5hbGlnblBhcmFtc1RvVGlsZXNBbmRMZXZlbChyZWdpb24sIHRoaXMpO1xyXG59O1xyXG5cclxuV29ya2VyUHJveHlJbWFnZURlY29kZXIucHJvdG90eXBlLl9pbWFnZU9wZW5lZCA9IGZ1bmN0aW9uIGltYWdlT3BlbmVkKGRhdGEpIHtcclxuICAgIHRoaXMuX2ludGVybmFsU2l6ZXNQYXJhbXMgPSBkYXRhLnNpemVzUGFyYW1zO1xyXG4gICAgdGhpcy5fdGlsZVdpZHRoID0gZGF0YS5hcHBsaWNhdGl2ZVRpbGVXaWR0aDtcclxuICAgIHRoaXMuX3RpbGVIZWlnaHQgPSBkYXRhLmFwcGxpY2F0aXZlVGlsZUhlaWdodDtcclxuICAgIHRoaXMuZ2V0SW1hZ2VQYXJhbXMoKTtcclxufTtcclxuXHJcbldvcmtlclByb3h5SW1hZ2VEZWNvZGVyLnByb3RvdHlwZS5fZ2V0SW1hZ2VQYXJhbXNJbnRlcm5hbCA9IGZ1bmN0aW9uIGdldEltYWdlUGFyYW1zSW50ZXJuYWwoKSB7XHJcbiAgICByZXR1cm4gdGhpcy5faW50ZXJuYWxTaXplc1BhcmFtcztcclxufTsiLCIndXNlIHN0cmljdCc7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IFZpZXdlckltYWdlRGVjb2RlcjtcclxuXHJcbnZhciBJbWFnZURlY29kZXIgPSByZXF1aXJlKCdpbWFnZWRlY29kZXIuanMnKTtcclxudmFyIFdvcmtlclByb3h5SW1hZ2VEZWNvZGVyID0gcmVxdWlyZSgnd29ya2VycHJveHlpbWFnZWRlY29kZXIuanMnKTtcclxudmFyIGltYWdlSGVscGVyRnVuY3Rpb25zID0gcmVxdWlyZSgnaW1hZ2VoZWxwZXJmdW5jdGlvbnMuanMnKTtcclxuXHJcbnZhciBQRU5ESU5HX0NBTExfVFlQRV9QSVhFTFNfVVBEQVRFRCA9IDE7XHJcbnZhciBQRU5ESU5HX0NBTExfVFlQRV9SRVBPU0lUSU9OID0gMjtcclxuXHJcbnZhciBSRUdJT05fT1ZFUlZJRVcgPSAwO1xyXG52YXIgUkVHSU9OX0RZTkFNSUMgPSAxO1xyXG5cclxuZnVuY3Rpb24gVmlld2VySW1hZ2VEZWNvZGVyKGRlY29kZXIsIGNhbnZhc1VwZGF0ZWRDYWxsYmFjaywgb3B0aW9ucykge1xyXG4gICAgdGhpcy5fY2FudmFzVXBkYXRlZENhbGxiYWNrID0gY2FudmFzVXBkYXRlZENhbGxiYWNrO1xyXG4gICAgXHJcbiAgICB0aGlzLl9hZGFwdFByb3BvcnRpb25zID0gb3B0aW9ucy5hZGFwdFByb3BvcnRpb25zO1xyXG4gICAgdGhpcy5fY2FydG9ncmFwaGljQm91bmRzID0gb3B0aW9ucy5jYXJ0b2dyYXBoaWNCb3VuZHM7XHJcbiAgICB0aGlzLl9pc01haW5JbWFnZU9uVWkgPSBvcHRpb25zLmlzTWFpbkltYWdlT25VaTtcclxuICAgIHRoaXMuX3Nob3dMb2cgPSBvcHRpb25zLnNob3dMb2c7XHJcbiAgICB0aGlzLl9hbGxvd011bHRpcGxlQ2hhbm5lbHNJblNlc3Npb24gPVxyXG4gICAgICAgIG9wdGlvbnMuYWxsb3dNdWx0aXBsZUNoYW5uZWxzSW5TZXNzaW9uO1xyXG4gICAgdGhpcy5fbWluRnVuY3Rpb25DYWxsSW50ZXJ2YWxNaWxsaXNlY29uZHMgPVxyXG4gICAgICAgIG9wdGlvbnMubWluRnVuY3Rpb25DYWxsSW50ZXJ2YWxNaWxsaXNlY29uZHM7XHJcbiAgICB0aGlzLl9vdmVydmlld1Jlc29sdXRpb25YID0gb3B0aW9ucy5vdmVydmlld1Jlc29sdXRpb25YIHx8IDEwMDtcclxuICAgIHRoaXMuX292ZXJ2aWV3UmVzb2x1dGlvblkgPSBvcHRpb25zLm92ZXJ2aWV3UmVzb2x1dGlvblkgfHwgMTAwO1xyXG4gICAgICAgIFxyXG4gICAgdGhpcy5fbGFzdFJlcXVlc3RJbmRleCA9IDA7XHJcbiAgICB0aGlzLl9wZW5kaW5nVXBkYXRlVmlld0FyZWEgPSBudWxsO1xyXG4gICAgdGhpcy5fcmVnaW9ucyA9IFtdO1xyXG4gICAgdGhpcy5fdGFyZ2V0Q2FudmFzID0gbnVsbDtcclxuICAgIFxyXG4gICAgdGhpcy5fY2FsbFBlbmRpbmdDYWxsYmFja3NCb3VuZCA9IHRoaXMuX2NhbGxQZW5kaW5nQ2FsbGJhY2tzLmJpbmQodGhpcyk7XHJcbiAgICB0aGlzLl9jcmVhdGVkQ2hhbm5lbEJvdW5kID0gdGhpcy5fY3JlYXRlZENoYW5uZWwuYmluZCh0aGlzKTtcclxuICAgIFxyXG4gICAgdGhpcy5fcGVuZGluZ0NhbGxiYWNrc0ludGVydmFsSGFuZGxlID0gMDtcclxuICAgIHRoaXMuX3BlbmRpbmdDYWxsYmFja0NhbGxzID0gW107XHJcbiAgICB0aGlzLl9jYW5TaG93RHluYW1pY1JlZ2lvbiA9IGZhbHNlO1xyXG4gICAgXHJcbiAgICBpZiAodGhpcy5fY2FydG9ncmFwaGljQm91bmRzID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICB0aGlzLl9jYXJ0b2dyYXBoaWNCb3VuZHMgPSB7XHJcbiAgICAgICAgICAgIHdlc3Q6IC0xNzUuMCxcclxuICAgICAgICAgICAgZWFzdDogMTc1LjAsXHJcbiAgICAgICAgICAgIHNvdXRoOiAtODUuMCxcclxuICAgICAgICAgICAgbm9ydGg6IDg1LjBcclxuICAgICAgICB9O1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBpZiAodGhpcy5fYWRhcHRQcm9wb3J0aW9ucyA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgdGhpcy5fYWRhcHRQcm9wb3J0aW9ucyA9IHRydWU7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHRoaXMuX2RlY29kZXIgPSBkZWNvZGVyO1xyXG4gICAgLypcclxuICAgIHZhciBJbWFnZVR5cGUgPSB0aGlzLl9pc01haW5JbWFnZU9uVWkgP1xyXG4gICAgICAgIEltYWdlRGVjb2RlcjogV29ya2VyUHJveHlJbWFnZURlY29kZXI7XHJcblxyXG4gICAgdGhpcy5faW1hZ2UgPSBuZXcgSW1hZ2VUeXBlKGltYWdlSW1wbGVtZW50YXRpb25DbGFzc05hbWUsIHtcclxuICAgICAgICBzZXJ2ZXJSZXF1ZXN0UHJpb3JpdGl6ZXI6ICdmcnVzdHVtT25seScsXHJcbiAgICAgICAgLy8gVE9ETyBkZWNvZGVQcmlvcml0aXplcjogJ2ZydXN0dW1Pbmx5JyxcclxuICAgICAgICBzaG93TG9nOiB0aGlzLl9zaG93TG9nXHJcbiAgICB9KTtcclxuICAgICovXHJcbiAgICBcclxuICAgIHRoaXMuX2ltYWdlID0gZGVjb2Rlci5nZXRJbWFnZSgpO1xyXG59XHJcblxyXG5WaWV3ZXJJbWFnZURlY29kZXIucHJvdG90eXBlLnNldEV4Y2VwdGlvbkNhbGxiYWNrID0gZnVuY3Rpb24gc2V0RXhjZXB0aW9uQ2FsbGJhY2soZXhjZXB0aW9uQ2FsbGJhY2spIHtcclxuICAgIC8vIFRPRE86IFN1cHBvcnQgZXhjZXB0aW9uQ2FsbGJhY2sgaW4gZXZlcnkgcGxhY2UgbmVlZGVkXHJcblx0dGhpcy5fZXhjZXB0aW9uQ2FsbGJhY2sgPSBleGNlcHRpb25DYWxsYmFjaztcclxufTtcclxuICAgIFxyXG5WaWV3ZXJJbWFnZURlY29kZXIucHJvdG90eXBlLm9wZW4gPSBmdW5jdGlvbiBvcGVuKHVybCkge1xyXG4gICAgcmV0dXJuIHRoaXMuX2RlY29kZXIub3Blbih1cmwpXHJcbiAgICAgICAgLnRoZW4odGhpcy5fb3BlbmVkLmJpbmQodGhpcykpXHJcbiAgICAgICAgLmNhdGNoKHRoaXMuX2V4Y2VwdGlvbkNhbGxiYWNrKTtcclxufTtcclxuXHJcblZpZXdlckltYWdlRGVjb2Rlci5wcm90b3R5cGUuY2xvc2UgPSBmdW5jdGlvbiBjbG9zZSgpIHtcclxuICAgIHZhciBwcm9taXNlID0gdGhpcy5fZGVjb2Rlci5jbG9zZSgpO1xyXG4gICAgcHJvbWlzZS5jYXRjaCh0aGlzLl9leGNlcHRpb25DYWxsYmFjayk7XHJcbiAgICB0aGlzLl9pc1JlYWR5ID0gZmFsc2U7XHJcbiAgICB0aGlzLl9jYW5TaG93RHluYW1pY1JlZ2lvbiA9IGZhbHNlO1xyXG4gICAgdGhpcy5fdGFyZ2V0Q2FudmFzID0gbnVsbDtcclxuXHRyZXR1cm4gcHJvbWlzZTtcclxufTtcclxuXHJcblZpZXdlckltYWdlRGVjb2Rlci5wcm90b3R5cGUuc2V0VGFyZ2V0Q2FudmFzID0gZnVuY3Rpb24gc2V0VGFyZ2V0Q2FudmFzKGNhbnZhcykge1xyXG4gICAgdGhpcy5fdGFyZ2V0Q2FudmFzID0gY2FudmFzO1xyXG59O1xyXG5cclxuVmlld2VySW1hZ2VEZWNvZGVyLnByb3RvdHlwZS51cGRhdGVWaWV3QXJlYSA9IGZ1bmN0aW9uIHVwZGF0ZVZpZXdBcmVhKGZydXN0dW1EYXRhKSB7XHJcbiAgICBpZiAodGhpcy5fdGFyZ2V0Q2FudmFzID09PSBudWxsKSB7XHJcbiAgICAgICAgdGhyb3cgJ0Nhbm5vdCB1cGRhdGUgZHluYW1pYyByZWdpb24gYmVmb3JlIHNldFRhcmdldENhbnZhcygpJztcclxuICAgIH1cclxuICAgIFxyXG4gICAgaWYgKCF0aGlzLl9jYW5TaG93RHluYW1pY1JlZ2lvbikge1xyXG4gICAgICAgIHRoaXMuX3BlbmRpbmdVcGRhdGVWaWV3QXJlYSA9IGZydXN0dW1EYXRhO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIFxyXG4gICAgdmFyIGJvdW5kcyA9IGZydXN0dW1EYXRhLnJlY3RhbmdsZTtcclxuICAgIHZhciBzY3JlZW5TaXplID0gZnJ1c3R1bURhdGEuc2NyZWVuU2l6ZTtcclxuICAgIFxyXG4gICAgdmFyIHJlZ2lvblBhcmFtcyA9IHtcclxuICAgICAgICBtaW5YOiBib3VuZHMud2VzdCAqIHRoaXMuX3NjYWxlWCArIHRoaXMuX3RyYW5zbGF0ZVgsXHJcbiAgICAgICAgbWluWTogYm91bmRzLm5vcnRoICogdGhpcy5fc2NhbGVZICsgdGhpcy5fdHJhbnNsYXRlWSxcclxuICAgICAgICBtYXhYRXhjbHVzaXZlOiBib3VuZHMuZWFzdCAqIHRoaXMuX3NjYWxlWCArIHRoaXMuX3RyYW5zbGF0ZVgsXHJcbiAgICAgICAgbWF4WUV4Y2x1c2l2ZTogYm91bmRzLnNvdXRoICogdGhpcy5fc2NhbGVZICsgdGhpcy5fdHJhbnNsYXRlWSxcclxuICAgICAgICBzY3JlZW5XaWR0aDogc2NyZWVuU2l6ZS54LFxyXG4gICAgICAgIHNjcmVlbkhlaWdodDogc2NyZWVuU2l6ZS55XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICB2YXIgYWxpZ25lZFBhcmFtcyA9XHJcbiAgICAgICAgaW1hZ2VIZWxwZXJGdW5jdGlvbnMuYWxpZ25QYXJhbXNUb1RpbGVzQW5kTGV2ZWwoXHJcbiAgICAgICAgICAgIHJlZ2lvblBhcmFtcywgdGhpcy5fZGVjb2RlciwgdGhpcy5faW1hZ2UpO1xyXG4gICAgXHJcbiAgICB2YXIgaXNPdXRzaWRlU2NyZWVuID0gYWxpZ25lZFBhcmFtcyA9PT0gbnVsbDtcclxuICAgIGlmIChpc091dHNpZGVTY3JlZW4pIHtcclxuICAgICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGFsaWduZWRQYXJhbXMuaW1hZ2VQYXJ0UGFyYW1zLnF1YWxpdHkgPSB0aGlzLl9xdWFsaXR5O1xyXG5cclxuICAgIHZhciBpc1NhbWVSZWdpb24gPVxyXG4gICAgICAgIHRoaXMuX2R5bmFtaWNGZXRjaFBhcmFtcyAhPT0gdW5kZWZpbmVkICYmXHJcbiAgICAgICAgdGhpcy5faXNJbWFnZVBhcnRzRXF1YWwoXHJcbiAgICAgICAgICAgIGFsaWduZWRQYXJhbXMuaW1hZ2VQYXJ0UGFyYW1zLFxyXG4gICAgICAgICAgICB0aGlzLl9keW5hbWljRmV0Y2hQYXJhbXMuaW1hZ2VQYXJ0UGFyYW1zKTtcclxuICAgIFxyXG4gICAgaWYgKGlzU2FtZVJlZ2lvbikge1xyXG4gICAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIFxyXG4gICAgZnJ1c3R1bURhdGEuaW1hZ2VSZWN0YW5nbGUgPSB0aGlzLl9jYXJ0b2dyYXBoaWNCb3VuZHNGaXhlZDtcclxuICAgIGZydXN0dW1EYXRhLmV4YWN0bGV2ZWwgPVxyXG4gICAgICAgIGFsaWduZWRQYXJhbXMuaW1hZ2VQYXJ0UGFyYW1zLmxldmVsO1xyXG4gICAgXHJcbiAgICB0aGlzLl9kZWNvZGVyLnNldERlY29kZVByaW9yaXRpemVyRGF0YShmcnVzdHVtRGF0YSk7XHJcbiAgICB0aGlzLl9kZWNvZGVyLnNldFNlcnZlclJlcXVlc3RQcmlvcml0aXplckRhdGEoZnJ1c3R1bURhdGEpO1xyXG5cclxuICAgIHRoaXMuX2R5bmFtaWNGZXRjaFBhcmFtcyA9IGFsaWduZWRQYXJhbXM7XHJcbiAgICBcclxuICAgIHZhciBzdGFydER5bmFtaWNSZWdpb25PblRlcm1pbmF0aW9uID0gZmFsc2U7XHJcbiAgICB2YXIgbW92ZUV4aXN0aW5nQ2hhbm5lbCA9ICF0aGlzLl9hbGxvd011bHRpcGxlQ2hhbm5lbHNJblNlc3Npb247XHJcbiAgICB0aGlzLl9mZXRjaChcclxuICAgICAgICBSRUdJT05fRFlOQU1JQyxcclxuICAgICAgICBhbGlnbmVkUGFyYW1zLFxyXG4gICAgICAgIHN0YXJ0RHluYW1pY1JlZ2lvbk9uVGVybWluYXRpb24sXHJcbiAgICAgICAgbW92ZUV4aXN0aW5nQ2hhbm5lbCk7XHJcbn07XHJcblxyXG5WaWV3ZXJJbWFnZURlY29kZXIucHJvdG90eXBlLmdldEJvdW5kcyA9IGZ1bmN0aW9uIGdldENhcnRvZ3JhcGhpY0JvdW5kcygpIHtcclxuICAgIGlmICghdGhpcy5faXNSZWFkeSkge1xyXG4gICAgICAgIHRocm93ICdWaWV3ZXJJbWFnZURlY29kZXIgZXJyb3I6IEltYWdlIGlzIG5vdCByZWFkeSB5ZXQnO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIHRoaXMuX2NhcnRvZ3JhcGhpY0JvdW5kc0ZpeGVkO1xyXG59O1xyXG5cclxuVmlld2VySW1hZ2VEZWNvZGVyLnByb3RvdHlwZS5faXNJbWFnZVBhcnRzRXF1YWwgPSBmdW5jdGlvbiBpc0ltYWdlUGFydHNFcXVhbChmaXJzdCwgc2Vjb25kKSB7XHJcbiAgICB2YXIgaXNFcXVhbCA9XHJcbiAgICAgICAgdGhpcy5fZHluYW1pY0ZldGNoUGFyYW1zICE9PSB1bmRlZmluZWQgJiZcclxuICAgICAgICBmaXJzdC5taW5YID09PSBzZWNvbmQubWluWCAmJlxyXG4gICAgICAgIGZpcnN0Lm1pblkgPT09IHNlY29uZC5taW5ZICYmXHJcbiAgICAgICAgZmlyc3QubWF4WEV4Y2x1c2l2ZSA9PT0gc2Vjb25kLm1heFhFeGNsdXNpdmUgJiZcclxuICAgICAgICBmaXJzdC5tYXhZRXhjbHVzaXZlID09PSBzZWNvbmQubWF4WUV4Y2x1c2l2ZSAmJlxyXG4gICAgICAgIGZpcnN0LmxldmVsID09PSBzZWNvbmQubGV2ZWw7XHJcbiAgICBcclxuICAgIHJldHVybiBpc0VxdWFsO1xyXG59O1xyXG5cclxuVmlld2VySW1hZ2VEZWNvZGVyLnByb3RvdHlwZS5fZmV0Y2ggPSBmdW5jdGlvbiBmZXRjaChcclxuICAgIHJlZ2lvbklkLFxyXG4gICAgZmV0Y2hQYXJhbXMsXHJcbiAgICBzdGFydER5bmFtaWNSZWdpb25PblRlcm1pbmF0aW9uLFxyXG4gICAgbW92ZUV4aXN0aW5nQ2hhbm5lbCkge1xyXG4gICAgXHJcbiAgICB2YXIgcmVxdWVzdEluZGV4ID0gKyt0aGlzLl9sYXN0UmVxdWVzdEluZGV4O1xyXG4gICAgXHJcbiAgICB2YXIgaW1hZ2VQYXJ0UGFyYW1zID0gZmV0Y2hQYXJhbXMuaW1hZ2VQYXJ0UGFyYW1zO1xyXG4gICAgaW1hZ2VQYXJ0UGFyYW1zLnJlcXVlc3RQcmlvcml0eURhdGEgPVxyXG4gICAgICAgIGltYWdlUGFydFBhcmFtcy5yZXF1ZXN0UHJpb3JpdHlEYXRhIHx8IHt9O1xyXG4gICAgXHJcbiAgICBpbWFnZVBhcnRQYXJhbXMucmVxdWVzdFByaW9yaXR5RGF0YS5yZXF1ZXN0SW5kZXggPSByZXF1ZXN0SW5kZXg7XHJcblxyXG4gICAgdmFyIG1pblggPSBmZXRjaFBhcmFtcy5wb3NpdGlvbkluSW1hZ2UubWluWDtcclxuICAgIHZhciBtaW5ZID0gZmV0Y2hQYXJhbXMucG9zaXRpb25JbkltYWdlLm1pblk7XHJcbiAgICB2YXIgbWF4WCA9IGZldGNoUGFyYW1zLnBvc2l0aW9uSW5JbWFnZS5tYXhYRXhjbHVzaXZlO1xyXG4gICAgdmFyIG1heFkgPSBmZXRjaFBhcmFtcy5wb3NpdGlvbkluSW1hZ2UubWF4WUV4Y2x1c2l2ZTtcclxuICAgIFxyXG4gICAgdmFyIHdlc3QgPSAobWluWCAtIHRoaXMuX3RyYW5zbGF0ZVgpIC8gdGhpcy5fc2NhbGVYO1xyXG4gICAgdmFyIGVhc3QgPSAobWF4WCAtIHRoaXMuX3RyYW5zbGF0ZVgpIC8gdGhpcy5fc2NhbGVYO1xyXG4gICAgdmFyIG5vcnRoID0gKG1pblkgLSB0aGlzLl90cmFuc2xhdGVZKSAvIHRoaXMuX3NjYWxlWTtcclxuICAgIHZhciBzb3V0aCA9IChtYXhZIC0gdGhpcy5fdHJhbnNsYXRlWSkgLyB0aGlzLl9zY2FsZVk7XHJcbiAgICBcclxuICAgIHZhciBwb3NpdGlvbiA9IHtcclxuICAgICAgICB3ZXN0OiB3ZXN0LFxyXG4gICAgICAgIGVhc3Q6IGVhc3QsXHJcbiAgICAgICAgbm9ydGg6IG5vcnRoLFxyXG4gICAgICAgIHNvdXRoOiBzb3V0aFxyXG4gICAgfTtcclxuICAgIFxyXG4gICAgdmFyIGNhblJldXNlT2xkRGF0YSA9IGZhbHNlO1xyXG4gICAgdmFyIGZldGNoUGFyYW1zTm90TmVlZGVkO1xyXG4gICAgXHJcbiAgICB2YXIgcmVnaW9uID0gdGhpcy5fcmVnaW9uc1tyZWdpb25JZF07XHJcbiAgICBpZiAocmVnaW9uICE9PSB1bmRlZmluZWQpIHtcclxuICAgICAgICB2YXIgbmV3UmVzb2x1dGlvbiA9IGltYWdlUGFydFBhcmFtcy5sZXZlbDtcclxuICAgICAgICB2YXIgb2xkUmVzb2x1dGlvbiA9IHJlZ2lvbi5pbWFnZVBhcnRQYXJhbXMubGV2ZWw7XHJcbiAgICAgICAgXHJcbiAgICAgICAgY2FuUmV1c2VPbGREYXRhID0gbmV3UmVzb2x1dGlvbiA9PT0gb2xkUmVzb2x1dGlvbjtcclxuICAgICAgICBcclxuICAgICAgICBpZiAoY2FuUmV1c2VPbGREYXRhICYmIHJlZ2lvbi5kb25lUGFydFBhcmFtcykge1xyXG4gICAgICAgICAgICBmZXRjaFBhcmFtc05vdE5lZWRlZCA9IFsgcmVnaW9uLmRvbmVQYXJ0UGFyYW1zIF07XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBpZiAocmVnaW9uSWQgIT09IFJFR0lPTl9PVkVSVklFVykge1xyXG4gICAgICAgICAgICB2YXIgYWRkZWRQZW5kaW5nQ2FsbCA9IHRoaXMuX2NoZWNrSWZSZXBvc2l0aW9uTmVlZGVkKFxyXG4gICAgICAgICAgICAgICAgcmVnaW9uLCBpbWFnZVBhcnRQYXJhbXMsIHBvc2l0aW9uKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGlmIChhZGRlZFBlbmRpbmdDYWxsKSB7XHJcbiAgICAgICAgICAgICAgICB0aGlzLl9ub3RpZnlOZXdQZW5kaW5nQ2FsbHMoKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgIH1cclxuICAgIFxyXG4gICAgdmFyIHNlbGYgPSB0aGlzO1xyXG4gICAgXHJcbiAgICB2YXIgY2hhbm5lbEhhbmRsZSA9IG1vdmVFeGlzdGluZ0NoYW5uZWwgPyB0aGlzLl9jaGFubmVsSGFuZGxlOiB1bmRlZmluZWQ7XHJcblxyXG4gICAgdGhpcy5fZGVjb2Rlci5yZXF1ZXN0UGl4ZWxzUHJvZ3Jlc3NpdmUoXHJcbiAgICAgICAgZmV0Y2hQYXJhbXMuaW1hZ2VQYXJ0UGFyYW1zLFxyXG4gICAgICAgIGNhbGxiYWNrLFxyXG4gICAgICAgIHRlcm1pbmF0ZWRDYWxsYmFjayxcclxuICAgICAgICBmZXRjaFBhcmFtc05vdE5lZWRlZCxcclxuICAgICAgICBjaGFubmVsSGFuZGxlKTtcclxuICAgIFxyXG4gICAgZnVuY3Rpb24gY2FsbGJhY2soZGVjb2RlZCkge1xyXG4gICAgICAgIHNlbGYuX3RpbGVzRGVjb2RlZENhbGxiYWNrKFxyXG4gICAgICAgICAgICByZWdpb25JZCxcclxuICAgICAgICAgICAgZmV0Y2hQYXJhbXMsXHJcbiAgICAgICAgICAgIHBvc2l0aW9uLFxyXG4gICAgICAgICAgICBkZWNvZGVkKTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgZnVuY3Rpb24gdGVybWluYXRlZENhbGxiYWNrKGlzQWJvcnRlZCkge1xyXG4gICAgICAgIGlmIChpc0Fib3J0ZWQgJiZcclxuICAgICAgICAgICAgaW1hZ2VQYXJ0UGFyYW1zLnJlcXVlc3RQcmlvcml0eURhdGEub3ZlcnJpZGVIaWdoZXN0UHJpb3JpdHkpIHtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIE5PVEU6IEJ1ZyBpbiBrZHVfc2VydmVyIGNhdXNlcyBmaXJzdCByZXF1ZXN0IHRvIGJlIHNlbnQgd3JvbmdseS5cclxuICAgICAgICAgICAgLy8gVGhlbiBDaHJvbWUgcmFpc2VzIEVSUl9JTlZBTElEX0NIVU5LRURfRU5DT0RJTkcgYW5kIHRoZSByZXF1ZXN0XHJcbiAgICAgICAgICAgIC8vIG5ldmVyIHJldHVybnMuIFRodXMgcGVyZm9ybSBzZWNvbmQgcmVxdWVzdC5cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHNlbGYuX2RlY29kZXIucmVxdWVzdFBpeGVsc1Byb2dyZXNzaXZlKFxyXG4gICAgICAgICAgICAgICAgZmV0Y2hQYXJhbXMuaW1hZ2VQYXJ0UGFyYW1zLFxyXG4gICAgICAgICAgICAgICAgY2FsbGJhY2ssXHJcbiAgICAgICAgICAgICAgICB0ZXJtaW5hdGVkQ2FsbGJhY2ssXHJcbiAgICAgICAgICAgICAgICBmZXRjaFBhcmFtc05vdE5lZWRlZCk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHNlbGYuX2ZldGNoVGVybWluYXRlZENhbGxiYWNrKFxyXG4gICAgICAgICAgICByZWdpb25JZCxcclxuICAgICAgICAgICAgZmV0Y2hQYXJhbXMuaW1hZ2VQYXJ0UGFyYW1zLnJlcXVlc3RQcmlvcml0eURhdGEsXHJcbiAgICAgICAgICAgIGlzQWJvcnRlZCxcclxuICAgICAgICAgICAgc3RhcnREeW5hbWljUmVnaW9uT25UZXJtaW5hdGlvbik7XHJcbiAgICB9XHJcbn07XHJcblxyXG5WaWV3ZXJJbWFnZURlY29kZXIucHJvdG90eXBlLl9mZXRjaFRlcm1pbmF0ZWRDYWxsYmFjayA9IGZ1bmN0aW9uIGZldGNoVGVybWluYXRlZENhbGxiYWNrKFxyXG4gICAgcmVnaW9uSWQsIHByaW9yaXR5RGF0YSwgaXNBYm9ydGVkLCBzdGFydER5bmFtaWNSZWdpb25PblRlcm1pbmF0aW9uKSB7XHJcbiAgICBcclxuICAgIHZhciByZWdpb24gPSB0aGlzLl9yZWdpb25zW3JlZ2lvbklkXTtcclxuICAgIGlmIChyZWdpb24gPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIFxyXG4gICAgaWYgKCFwcmlvcml0eURhdGEub3ZlcnJpZGVIaWdoZXN0UHJpb3JpdHkgJiZcclxuICAgICAgICBwcmlvcml0eURhdGEucmVxdWVzdEluZGV4ICE9PSB0aGlzLl9sYXN0UmVxdWVzdEluZGV4KSB7XHJcbiAgICBcclxuICAgICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHJlZ2lvbi5pc0RvbmUgPSAhaXNBYm9ydGVkICYmIHRoaXMuX2lzUmVhZHk7XHJcblx0aWYgKHJlZ2lvbi5pc0RvbmUpIHtcclxuXHRcdHJlZ2lvbi5kb25lUGFydFBhcmFtcyA9IHJlZ2lvbi5pbWFnZVBhcnRQYXJhbXM7XHJcblx0fVxyXG4gICAgXHJcbiAgICBpZiAoc3RhcnREeW5hbWljUmVnaW9uT25UZXJtaW5hdGlvbikge1xyXG4gICAgICAgIHRoaXMuX2RlY29kZXIuY3JlYXRlQ2hhbm5lbCgpLnRoZW4odGhpcy5fY3JlYXRlZENoYW5uZWxCb3VuZCk7XHJcbiAgICB9XHJcbn07XHJcblxyXG5WaWV3ZXJJbWFnZURlY29kZXIucHJvdG90eXBlLl9jcmVhdGVkQ2hhbm5lbCA9IGZ1bmN0aW9uIGNyZWF0ZWRDaGFubmVsKGNoYW5uZWxIYW5kbGUpIHtcclxuICAgIHRoaXMuX2NoYW5uZWxIYW5kbGUgPSBjaGFubmVsSGFuZGxlO1xyXG4gICAgdGhpcy5fc3RhcnRTaG93aW5nRHluYW1pY1JlZ2lvbigpO1xyXG59O1xyXG5cclxuVmlld2VySW1hZ2VEZWNvZGVyLnByb3RvdHlwZS5fc3RhcnRTaG93aW5nRHluYW1pY1JlZ2lvbiA9IGZ1bmN0aW9uIHN0YXJ0U2hvd2luZ0R5bmFtaWNSZWdpb24oKSB7XHJcbiAgICB0aGlzLl9jYW5TaG93RHluYW1pY1JlZ2lvbiA9IHRydWU7XHJcbiAgICBcclxuICAgIGlmICh0aGlzLl9wZW5kaW5nVXBkYXRlVmlld0FyZWEgIT09IG51bGwpIHtcclxuICAgICAgICB0aGlzLnVwZGF0ZVZpZXdBcmVhKHRoaXMuX3BlbmRpbmdVcGRhdGVWaWV3QXJlYSk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgdGhpcy5fcGVuZGluZ1VwZGF0ZVZpZXdBcmVhID0gbnVsbDtcclxuICAgIH1cclxufTtcclxuXHJcblZpZXdlckltYWdlRGVjb2Rlci5wcm90b3R5cGUuX3RpbGVzRGVjb2RlZENhbGxiYWNrID0gZnVuY3Rpb24gdGlsZXNEZWNvZGVkQ2FsbGJhY2soXHJcbiAgICByZWdpb25JZCwgZmV0Y2hQYXJhbXMsIHBvc2l0aW9uLCBkZWNvZGVkKSB7XHJcbiAgICBcclxuICAgIGlmICghdGhpcy5faXNSZWFkeSkge1xyXG4gICAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIFxyXG4gICAgdmFyIHJlZ2lvbiA9IHRoaXMuX3JlZ2lvbnNbcmVnaW9uSWRdO1xyXG4gICAgaWYgKHJlZ2lvbiA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgcmVnaW9uID0ge307XHJcbiAgICAgICAgdGhpcy5fcmVnaW9uc1tyZWdpb25JZF0gPSByZWdpb247XHJcbiAgICAgICAgXHJcbiAgICAgICAgc3dpdGNoIChyZWdpb25JZCkge1xyXG4gICAgICAgICAgICBjYXNlIFJFR0lPTl9EWU5BTUlDOlxyXG4gICAgICAgICAgICAgICAgcmVnaW9uLmNhbnZhcyA9IHRoaXMuX3RhcmdldENhbnZhcztcclxuICAgICAgICAgICAgICAgIGJyZWFrO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGNhc2UgUkVHSU9OX09WRVJWSUVXOlxyXG4gICAgICAgICAgICAgICAgcmVnaW9uLmNhbnZhcyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2NhbnZhcycpO1xyXG4gICAgICAgICAgICAgICAgYnJlYWs7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBkZWZhdWx0OlxyXG4gICAgICAgICAgICAgICAgdGhyb3cgJ1VuZXhwZWN0ZWQgcmVnaW9uSWQgJyArIHJlZ2lvbklkO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuICAgIFxyXG4gICAgdmFyIHBhcnRQYXJhbXMgPSBmZXRjaFBhcmFtcy5pbWFnZVBhcnRQYXJhbXM7XHJcbiAgICBpZiAoIXBhcnRQYXJhbXMucmVxdWVzdFByaW9yaXR5RGF0YS5vdmVycmlkZUhpZ2hlc3RQcmlvcml0eSAmJlxyXG4gICAgICAgIHBhcnRQYXJhbXMucmVxdWVzdFByaW9yaXR5RGF0YS5yZXF1ZXN0SW5kZXggPCByZWdpb24uY3VycmVudERpc3BsYXlSZXF1ZXN0SW5kZXgpIHtcclxuICAgICAgICBcclxuICAgICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHRoaXMuX2NoZWNrSWZSZXBvc2l0aW9uTmVlZGVkKHJlZ2lvbiwgcGFydFBhcmFtcywgcG9zaXRpb24pO1xyXG4gICAgICAgIFxyXG4gICAgdGhpcy5fcGVuZGluZ0NhbGxiYWNrQ2FsbHMucHVzaCh7XHJcbiAgICAgICAgdHlwZTogUEVORElOR19DQUxMX1RZUEVfUElYRUxTX1VQREFURUQsXHJcbiAgICAgICAgcmVnaW9uOiByZWdpb24sXHJcbiAgICAgICAgZGVjb2RlZDogZGVjb2RlZFxyXG4gICAgfSk7XHJcbiAgICBcclxuICAgIHRoaXMuX25vdGlmeU5ld1BlbmRpbmdDYWxscygpO1xyXG59O1xyXG5cclxuVmlld2VySW1hZ2VEZWNvZGVyLnByb3RvdHlwZS5fY2hlY2tJZlJlcG9zaXRpb25OZWVkZWQgPSBmdW5jdGlvbiBjaGVja0lmUmVwb3NpdGlvbk5lZWRlZChcclxuICAgIHJlZ2lvbiwgbmV3UGFydFBhcmFtcywgbmV3UG9zaXRpb24pIHtcclxuICAgIFxyXG4gICAgdmFyIG9sZFBhcnRQYXJhbXMgPSByZWdpb24uaW1hZ2VQYXJ0UGFyYW1zO1xyXG5cdHZhciBvbGREb25lUGFydFBhcmFtcyA9IHJlZ2lvbi5kb25lUGFydFBhcmFtcztcclxuICAgIHZhciBsZXZlbCA9IG5ld1BhcnRQYXJhbXMubGV2ZWw7XHJcbiAgICBcclxuICAgIHZhciBuZWVkUmVwb3NpdGlvbiA9XHJcbiAgICAgICAgb2xkUGFydFBhcmFtcyA9PT0gdW5kZWZpbmVkIHx8XHJcbiAgICAgICAgb2xkUGFydFBhcmFtcy5taW5YICE9PSBuZXdQYXJ0UGFyYW1zLm1pblggfHxcclxuICAgICAgICBvbGRQYXJ0UGFyYW1zLm1pblkgIT09IG5ld1BhcnRQYXJhbXMubWluWSB8fFxyXG4gICAgICAgIG9sZFBhcnRQYXJhbXMubWF4WEV4Y2x1c2l2ZSAhPT0gbmV3UGFydFBhcmFtcy5tYXhYRXhjbHVzaXZlIHx8XHJcbiAgICAgICAgb2xkUGFydFBhcmFtcy5tYXhZRXhjbHVzaXZlICE9PSBuZXdQYXJ0UGFyYW1zLm1heFlFeGNsdXNpdmUgfHxcclxuICAgICAgICBvbGRQYXJ0UGFyYW1zLmxldmVsICE9PSBsZXZlbDtcclxuICAgIFxyXG4gICAgaWYgKCFuZWVkUmVwb3NpdGlvbikge1xyXG4gICAgICAgIHJldHVybiBmYWxzZTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgdmFyIGNvcHlEYXRhO1xyXG4gICAgdmFyIGludGVyc2VjdGlvbjtcclxuXHR2YXIgbmV3RG9uZVBhcnRQYXJhbXM7XHJcbiAgICB2YXIgcmV1c2VPbGREYXRhID0gZmFsc2U7XHJcbiAgICB2YXIgc2NhbGVYO1xyXG4gICAgdmFyIHNjYWxlWTtcclxuICAgIGlmIChvbGRQYXJ0UGFyYW1zICE9PSB1bmRlZmluZWQpIHtcclxuICAgICAgICBzY2FsZVggPSBuZXdQYXJ0UGFyYW1zLmxldmVsV2lkdGggIC8gb2xkUGFydFBhcmFtcy5sZXZlbFdpZHRoO1xyXG4gICAgICAgIHNjYWxlWSA9IG5ld1BhcnRQYXJhbXMubGV2ZWxIZWlnaHQgLyBvbGRQYXJ0UGFyYW1zLmxldmVsSGVpZ2h0O1xyXG4gICAgICAgIFxyXG4gICAgICAgIGludGVyc2VjdGlvbiA9IHtcclxuICAgICAgICAgICAgbWluWDogTWF0aC5tYXgob2xkUGFydFBhcmFtcy5taW5YICogc2NhbGVYLCBuZXdQYXJ0UGFyYW1zLm1pblgpLFxyXG4gICAgICAgICAgICBtaW5ZOiBNYXRoLm1heChvbGRQYXJ0UGFyYW1zLm1pblkgKiBzY2FsZVksIG5ld1BhcnRQYXJhbXMubWluWSksXHJcbiAgICAgICAgICAgIG1heFg6IE1hdGgubWluKG9sZFBhcnRQYXJhbXMubWF4WEV4Y2x1c2l2ZSAqIHNjYWxlWCwgbmV3UGFydFBhcmFtcy5tYXhYRXhjbHVzaXZlKSxcclxuICAgICAgICAgICAgbWF4WTogTWF0aC5taW4ob2xkUGFydFBhcmFtcy5tYXhZRXhjbHVzaXZlICogc2NhbGVZLCBuZXdQYXJ0UGFyYW1zLm1heFlFeGNsdXNpdmUpXHJcbiAgICAgICAgfTtcclxuICAgICAgICByZXVzZU9sZERhdGEgPVxyXG4gICAgICAgICAgICBpbnRlcnNlY3Rpb24ubWF4WCA+IGludGVyc2VjdGlvbi5taW5YICYmXHJcbiAgICAgICAgICAgIGludGVyc2VjdGlvbi5tYXhZID4gaW50ZXJzZWN0aW9uLm1pblk7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGlmIChyZXVzZU9sZERhdGEpIHtcclxuICAgICAgICBjb3B5RGF0YSA9IHtcclxuICAgICAgICAgICAgZnJvbVg6IGludGVyc2VjdGlvbi5taW5YIC8gc2NhbGVYIC0gb2xkUGFydFBhcmFtcy5taW5YLFxyXG4gICAgICAgICAgICBmcm9tWTogaW50ZXJzZWN0aW9uLm1pblkgLyBzY2FsZVkgLSBvbGRQYXJ0UGFyYW1zLm1pblksXHJcbiAgICAgICAgICAgIGZyb21XaWR0aCA6IChpbnRlcnNlY3Rpb24ubWF4WCAtIGludGVyc2VjdGlvbi5taW5YKSAvIHNjYWxlWCxcclxuICAgICAgICAgICAgZnJvbUhlaWdodDogKGludGVyc2VjdGlvbi5tYXhZIC0gaW50ZXJzZWN0aW9uLm1pblkpIC8gc2NhbGVZLFxyXG4gICAgICAgICAgICB0b1g6IGludGVyc2VjdGlvbi5taW5YIC0gbmV3UGFydFBhcmFtcy5taW5YLFxyXG4gICAgICAgICAgICB0b1k6IGludGVyc2VjdGlvbi5taW5ZIC0gbmV3UGFydFBhcmFtcy5taW5ZLFxyXG4gICAgICAgICAgICB0b1dpZHRoIDogaW50ZXJzZWN0aW9uLm1heFggLSBpbnRlcnNlY3Rpb24ubWluWCxcclxuICAgICAgICAgICAgdG9IZWlnaHQ6IGludGVyc2VjdGlvbi5tYXhZIC0gaW50ZXJzZWN0aW9uLm1pblksXHJcbiAgICAgICAgfTtcclxuXHRcclxuXHRcdGlmIChvbGREb25lUGFydFBhcmFtcyAmJiBvbGRQYXJ0UGFyYW1zLmxldmVsID09PSBsZXZlbCkge1xyXG5cdFx0XHRuZXdEb25lUGFydFBhcmFtcyA9IHtcclxuXHRcdFx0XHRtaW5YOiBNYXRoLm1heChvbGREb25lUGFydFBhcmFtcy5taW5YLCBuZXdQYXJ0UGFyYW1zLm1pblgpLFxyXG5cdFx0XHRcdG1pblk6IE1hdGgubWF4KG9sZERvbmVQYXJ0UGFyYW1zLm1pblksIG5ld1BhcnRQYXJhbXMubWluWSksXHJcblx0XHRcdFx0bWF4WEV4Y2x1c2l2ZTogTWF0aC5taW4ob2xkRG9uZVBhcnRQYXJhbXMubWF4WEV4Y2x1c2l2ZSwgbmV3UGFydFBhcmFtcy5tYXhYRXhjbHVzaXZlKSxcclxuXHRcdFx0XHRtYXhZRXhjbHVzaXZlOiBNYXRoLm1pbihvbGREb25lUGFydFBhcmFtcy5tYXhZRXhjbHVzaXZlLCBuZXdQYXJ0UGFyYW1zLm1heFlFeGNsdXNpdmUpXHJcblx0XHRcdH07XHJcblx0XHR9XHJcblx0fVxyXG4gICAgXHJcbiAgICByZWdpb24uaW1hZ2VQYXJ0UGFyYW1zID0gbmV3UGFydFBhcmFtcztcclxuICAgIHJlZ2lvbi5pc0RvbmUgPSBmYWxzZTtcclxuICAgIHJlZ2lvbi5jdXJyZW50RGlzcGxheVJlcXVlc3RJbmRleCA9IG5ld1BhcnRQYXJhbXMucmVxdWVzdFByaW9yaXR5RGF0YS5yZXF1ZXN0SW5kZXg7XHJcbiAgICBcclxuICAgIHZhciByZXBvc2l0aW9uQXJncyA9IHtcclxuICAgICAgICB0eXBlOiBQRU5ESU5HX0NBTExfVFlQRV9SRVBPU0lUSU9OLFxyXG4gICAgICAgIHJlZ2lvbjogcmVnaW9uLFxyXG4gICAgICAgIHBvc2l0aW9uOiBuZXdQb3NpdGlvbixcclxuXHRcdGRvbmVQYXJ0UGFyYW1zOiBuZXdEb25lUGFydFBhcmFtcyxcclxuICAgICAgICBjb3B5RGF0YTogY29weURhdGEsXHJcbiAgICAgICAgcGl4ZWxzV2lkdGg6IG5ld1BhcnRQYXJhbXMubWF4WEV4Y2x1c2l2ZSAtIG5ld1BhcnRQYXJhbXMubWluWCxcclxuICAgICAgICBwaXhlbHNIZWlnaHQ6IG5ld1BhcnRQYXJhbXMubWF4WUV4Y2x1c2l2ZSAtIG5ld1BhcnRQYXJhbXMubWluWVxyXG4gICAgfTtcclxuICAgIFxyXG4gICAgdGhpcy5fcGVuZGluZ0NhbGxiYWNrQ2FsbHMucHVzaChyZXBvc2l0aW9uQXJncyk7XHJcbiAgICBcclxuICAgIHJldHVybiB0cnVlO1xyXG59O1xyXG5cclxuVmlld2VySW1hZ2VEZWNvZGVyLnByb3RvdHlwZS5fbm90aWZ5TmV3UGVuZGluZ0NhbGxzID0gZnVuY3Rpb24gbm90aWZ5TmV3UGVuZGluZ0NhbGxzKCkge1xyXG4gICAgaWYgKCF0aGlzLl9pc05lYXJDYWxsYmFja0NhbGxlZCkge1xyXG4gICAgICAgIHRoaXMuX2NhbGxQZW5kaW5nQ2FsbGJhY2tzKCk7XHJcbiAgICB9XHJcbn07XHJcblxyXG5WaWV3ZXJJbWFnZURlY29kZXIucHJvdG90eXBlLl9jYWxsUGVuZGluZ0NhbGxiYWNrcyA9IGZ1bmN0aW9uIGNhbGxQZW5kaW5nQ2FsbGJhY2tzKCkge1xyXG4gICAgaWYgKHRoaXMuX3BlbmRpbmdDYWxsYmFja0NhbGxzLmxlbmd0aCA9PT0gMCB8fCAhdGhpcy5faXNSZWFkeSkge1xyXG4gICAgICAgIHRoaXMuX2lzTmVhckNhbGxiYWNrQ2FsbGVkID0gZmFsc2U7XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBpZiAodGhpcy5faXNOZWFyQ2FsbGJhY2tDYWxsZWQpIHtcclxuICAgICAgICBjbGVhclRpbWVvdXQodGhpcy5fcGVuZGluZ0NhbGxiYWNrc0ludGVydmFsSGFuZGxlKTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgaWYgKHRoaXMuX21pbkZ1bmN0aW9uQ2FsbEludGVydmFsTWlsbGlzZWNvbmRzICE9PSB1bmRlZmluZWQpIHtcclxuICAgICAgICB0aGlzLl9wZW5kaW5nQ2FsbGJhY2tzSW50ZXJ2YWxIYW5kbGUgPVxyXG4gICAgICAgICAgICBzZXRUaW1lb3V0KHRoaXMuX2NhbGxQZW5kaW5nQ2FsbGJhY2tzQm91bmQsXHJcbiAgICAgICAgICAgIHRoaXMuX21pbkZ1bmN0aW9uQ2FsbEludGVydmFsTWlsbGlzZWNvbmRzKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgdGhpcy5faXNOZWFyQ2FsbGJhY2tDYWxsZWQgPSB0cnVlO1xyXG4gICAgfVxyXG5cclxuICAgIHZhciBuZXdQb3NpdGlvbiA9IG51bGw7XHJcbiAgICBcclxuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgdGhpcy5fcGVuZGluZ0NhbGxiYWNrQ2FsbHMubGVuZ3RoOyArK2kpIHtcclxuICAgICAgICB2YXIgY2FsbEFyZ3MgPSB0aGlzLl9wZW5kaW5nQ2FsbGJhY2tDYWxsc1tpXTtcclxuICAgICAgICBcclxuICAgICAgICBpZiAoY2FsbEFyZ3MudHlwZSA9PT0gUEVORElOR19DQUxMX1RZUEVfUkVQT1NJVElPTikge1xyXG4gICAgICAgICAgICB0aGlzLl9yZXBvc2l0aW9uQ2FudmFzKGNhbGxBcmdzKTtcclxuICAgICAgICAgICAgbmV3UG9zaXRpb24gPSBjYWxsQXJncy5wb3NpdGlvbjtcclxuICAgICAgICB9IGVsc2UgaWYgKGNhbGxBcmdzLnR5cGUgPT09IFBFTkRJTkdfQ0FMTF9UWVBFX1BJWEVMU19VUERBVEVEKSB7XHJcbiAgICAgICAgICAgIHRoaXMuX3BpeGVsc1VwZGF0ZWQoY2FsbEFyZ3MpO1xyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgIHRocm93ICdJbnRlcm5hbCBWaWV3ZXJJbWFnZURlY29kZXIgRXJyb3I6IFVuZXhwZWN0ZWQgY2FsbCB0eXBlICcgK1xyXG4gICAgICAgICAgICAgICAgY2FsbEFyZ3MudHlwZTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHRoaXMuX3BlbmRpbmdDYWxsYmFja0NhbGxzLmxlbmd0aCA9IDA7XHJcbiAgICBcclxuICAgIHRoaXMuX2NhbnZhc1VwZGF0ZWRDYWxsYmFjayhuZXdQb3NpdGlvbik7XHJcbn07XHJcblxyXG5WaWV3ZXJJbWFnZURlY29kZXIucHJvdG90eXBlLl9waXhlbHNVcGRhdGVkID0gZnVuY3Rpb24gcGl4ZWxzVXBkYXRlZChwaXhlbHNVcGRhdGVkQXJncykge1xyXG4gICAgdmFyIHJlZ2lvbiA9IHBpeGVsc1VwZGF0ZWRBcmdzLnJlZ2lvbjtcclxuICAgIHZhciBkZWNvZGVkID0gcGl4ZWxzVXBkYXRlZEFyZ3MuZGVjb2RlZDtcclxuICAgIGlmIChkZWNvZGVkLmltYWdlRGF0YS53aWR0aCA9PT0gMCB8fCBkZWNvZGVkLmltYWdlRGF0YS5oZWlnaHQgPT09IDApIHtcclxuICAgICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHZhciB4ID0gZGVjb2RlZC54SW5PcmlnaW5hbFJlcXVlc3Q7XHJcbiAgICB2YXIgeSA9IGRlY29kZWQueUluT3JpZ2luYWxSZXF1ZXN0O1xyXG4gICAgXHJcbiAgICB2YXIgY29udGV4dCA9IHJlZ2lvbi5jYW52YXMuZ2V0Q29udGV4dCgnMmQnKTtcclxuICAgIC8vdmFyIGltYWdlRGF0YSA9IGNvbnRleHQuY3JlYXRlSW1hZ2VEYXRhKGRlY29kZWQud2lkdGgsIGRlY29kZWQuaGVpZ2h0KTtcclxuICAgIC8vaW1hZ2VEYXRhLmRhdGEuc2V0KGRlY29kZWQucGl4ZWxzKTtcclxuICAgIFxyXG4gICAgY29udGV4dC5wdXRJbWFnZURhdGEoZGVjb2RlZC5pbWFnZURhdGEsIHgsIHkpO1xyXG59O1xyXG5cclxuVmlld2VySW1hZ2VEZWNvZGVyLnByb3RvdHlwZS5fcmVwb3NpdGlvbkNhbnZhcyA9IGZ1bmN0aW9uIHJlcG9zaXRpb25DYW52YXMocmVwb3NpdGlvbkFyZ3MpIHtcclxuICAgIHZhciByZWdpb24gPSByZXBvc2l0aW9uQXJncy5yZWdpb247XHJcbiAgICB2YXIgcG9zaXRpb24gPSByZXBvc2l0aW9uQXJncy5wb3NpdGlvbjtcclxuXHR2YXIgZG9uZVBhcnRQYXJhbXMgPSByZXBvc2l0aW9uQXJncy5kb25lUGFydFBhcmFtcztcclxuICAgIHZhciBjb3B5RGF0YSA9IHJlcG9zaXRpb25BcmdzLmNvcHlEYXRhO1xyXG4gICAgdmFyIHBpeGVsc1dpZHRoID0gcmVwb3NpdGlvbkFyZ3MucGl4ZWxzV2lkdGg7XHJcbiAgICB2YXIgcGl4ZWxzSGVpZ2h0ID0gcmVwb3NpdGlvbkFyZ3MucGl4ZWxzSGVpZ2h0O1xyXG4gICAgXHJcbiAgICB2YXIgaW1hZ2VEYXRhVG9Db3B5O1xyXG4gICAgdmFyIGNvbnRleHQgPSByZWdpb24uY2FudmFzLmdldENvbnRleHQoJzJkJyk7XHJcbiAgICBcclxuICAgIGlmIChjb3B5RGF0YSAhPT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgaWYgKGNvcHlEYXRhLmZyb21XaWR0aCA9PT0gY29weURhdGEudG9XaWR0aCAmJiBjb3B5RGF0YS5mcm9tSGVpZ2h0ID09PSBjb3B5RGF0YS50b0hlaWdodCkge1xyXG4gICAgICAgICAgICBpbWFnZURhdGFUb0NvcHkgPSBjb250ZXh0LmdldEltYWdlRGF0YShcclxuICAgICAgICAgICAgICAgIGNvcHlEYXRhLmZyb21YLCBjb3B5RGF0YS5mcm9tWSwgY29weURhdGEuZnJvbVdpZHRoLCBjb3B5RGF0YS5mcm9tSGVpZ2h0KTtcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICBpZiAoIXRoaXMuX3RtcENhbnZhcykge1xyXG4gICAgICAgICAgICAgICAgdGhpcy5fdG1wQ2FudmFzID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnY2FudmFzJyk7XHJcbiAgICAgICAgICAgICAgICB0aGlzLl90bXBDYW52YXNDb250ZXh0ID0gdGhpcy5fdG1wQ2FudmFzLmdldENvbnRleHQoJzJkJyk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHRoaXMuX3RtcENhbnZhcy53aWR0aCAgPSBjb3B5RGF0YS50b1dpZHRoO1xyXG4gICAgICAgICAgICB0aGlzLl90bXBDYW52YXMuaGVpZ2h0ID0gY29weURhdGEudG9IZWlnaHQ7XHJcbiAgICAgICAgICAgIHRoaXMuX3RtcENhbnZhc0NvbnRleHQuZHJhd0ltYWdlKFxyXG4gICAgICAgICAgICAgICAgcmVnaW9uLmNhbnZhcyxcclxuICAgICAgICAgICAgICAgIGNvcHlEYXRhLmZyb21YLCBjb3B5RGF0YS5mcm9tWSwgY29weURhdGEuZnJvbVdpZHRoLCBjb3B5RGF0YS5mcm9tSGVpZ2h0LFxyXG4gICAgICAgICAgICAgICAgMCwgMCwgY29weURhdGEudG9XaWR0aCwgY29weURhdGEudG9IZWlnaHQpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgaW1hZ2VEYXRhVG9Db3B5ID0gdGhpcy5fdG1wQ2FudmFzQ29udGV4dC5nZXRJbWFnZURhdGEoXHJcbiAgICAgICAgICAgICAgICAwLCAwLCBjb3B5RGF0YS50b1dpZHRoLCBjb3B5RGF0YS50b0hlaWdodCk7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgXHJcbiAgICByZWdpb24uY2FudmFzLndpZHRoID0gcGl4ZWxzV2lkdGg7XHJcbiAgICByZWdpb24uY2FudmFzLmhlaWdodCA9IHBpeGVsc0hlaWdodDtcclxuICAgIFxyXG4gICAgaWYgKHJlZ2lvbiAhPT0gdGhpcy5fcmVnaW9uc1tSRUdJT05fT1ZFUlZJRVddKSB7XHJcbiAgICAgICAgdGhpcy5fY29weU92ZXJ2aWV3VG9DYW52YXMoXHJcbiAgICAgICAgICAgIGNvbnRleHQsIHBvc2l0aW9uLCBwaXhlbHNXaWR0aCwgcGl4ZWxzSGVpZ2h0KTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgaWYgKGNvcHlEYXRhICE9PSB1bmRlZmluZWQpIHtcclxuICAgICAgICBjb250ZXh0LnB1dEltYWdlRGF0YShpbWFnZURhdGFUb0NvcHksIGNvcHlEYXRhLnRvWCwgY29weURhdGEudG9ZKTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgcmVnaW9uLnBvc2l0aW9uID0gcG9zaXRpb247XHJcblx0cmVnaW9uLmRvbmVQYXJ0UGFyYW1zID0gZG9uZVBhcnRQYXJhbXM7XHJcbn07XHJcblxyXG5WaWV3ZXJJbWFnZURlY29kZXIucHJvdG90eXBlLl9jb3B5T3ZlcnZpZXdUb0NhbnZhcyA9IGZ1bmN0aW9uIGNvcHlPdmVydmlld1RvQ2FudmFzKFxyXG4gICAgY29udGV4dCwgY2FudmFzUG9zaXRpb24sIGNhbnZhc1BpeGVsc1dpZHRoLCBjYW52YXNQaXhlbHNIZWlnaHQpIHtcclxuICAgIFxyXG4gICAgdmFyIHNvdXJjZVBvc2l0aW9uID0gdGhpcy5fcmVnaW9uc1tSRUdJT05fT1ZFUlZJRVddLnBvc2l0aW9uO1xyXG4gICAgdmFyIHNvdXJjZVBpeGVscyA9XHJcbiAgICAgICAgdGhpcy5fcmVnaW9uc1tSRUdJT05fT1ZFUlZJRVddLmltYWdlUGFydFBhcmFtcztcclxuICAgIFxyXG4gICAgdmFyIHNvdXJjZVBpeGVsc1dpZHRoID1cclxuICAgICAgICBzb3VyY2VQaXhlbHMubWF4WEV4Y2x1c2l2ZSAtIHNvdXJjZVBpeGVscy5taW5YO1xyXG4gICAgdmFyIHNvdXJjZVBpeGVsc0hlaWdodCA9XHJcbiAgICAgICAgc291cmNlUGl4ZWxzLm1heFlFeGNsdXNpdmUgLSBzb3VyY2VQaXhlbHMubWluWTtcclxuICAgIFxyXG4gICAgdmFyIHNvdXJjZVBvc2l0aW9uV2lkdGggPVxyXG4gICAgICAgIHNvdXJjZVBvc2l0aW9uLmVhc3QgLSBzb3VyY2VQb3NpdGlvbi53ZXN0O1xyXG4gICAgdmFyIHNvdXJjZVBvc2l0aW9uSGVpZ2h0ID1cclxuICAgICAgICBzb3VyY2VQb3NpdGlvbi5ub3J0aCAtIHNvdXJjZVBvc2l0aW9uLnNvdXRoO1xyXG4gICAgICAgIFxyXG4gICAgdmFyIHNvdXJjZVJlc29sdXRpb25YID1cclxuICAgICAgICBzb3VyY2VQaXhlbHNXaWR0aCAvIHNvdXJjZVBvc2l0aW9uV2lkdGg7XHJcbiAgICB2YXIgc291cmNlUmVzb2x1dGlvblkgPVxyXG4gICAgICAgIHNvdXJjZVBpeGVsc0hlaWdodCAvIHNvdXJjZVBvc2l0aW9uSGVpZ2h0O1xyXG4gICAgXHJcbiAgICB2YXIgdGFyZ2V0UG9zaXRpb25XaWR0aCA9XHJcbiAgICAgICAgY2FudmFzUG9zaXRpb24uZWFzdCAtIGNhbnZhc1Bvc2l0aW9uLndlc3Q7XHJcbiAgICB2YXIgdGFyZ2V0UG9zaXRpb25IZWlnaHQgPVxyXG4gICAgICAgIGNhbnZhc1Bvc2l0aW9uLm5vcnRoIC0gY2FudmFzUG9zaXRpb24uc291dGg7XHJcbiAgICAgICAgXHJcbiAgICB2YXIgY3JvcFdpZHRoID0gdGFyZ2V0UG9zaXRpb25XaWR0aCAqIHNvdXJjZVJlc29sdXRpb25YO1xyXG4gICAgdmFyIGNyb3BIZWlnaHQgPSB0YXJnZXRQb3NpdGlvbkhlaWdodCAqIHNvdXJjZVJlc29sdXRpb25ZO1xyXG4gICAgXHJcbiAgICB2YXIgY3JvcE9mZnNldFBvc2l0aW9uWCA9XHJcbiAgICAgICAgY2FudmFzUG9zaXRpb24ud2VzdCAtIHNvdXJjZVBvc2l0aW9uLndlc3Q7XHJcbiAgICB2YXIgY3JvcE9mZnNldFBvc2l0aW9uWSA9XHJcbiAgICAgICAgc291cmNlUG9zaXRpb24ubm9ydGggLSBjYW52YXNQb3NpdGlvbi5ub3J0aDtcclxuICAgICAgICBcclxuICAgIHZhciBjcm9wUGl4ZWxPZmZzZXRYID0gY3JvcE9mZnNldFBvc2l0aW9uWCAqIHNvdXJjZVJlc29sdXRpb25YO1xyXG4gICAgdmFyIGNyb3BQaXhlbE9mZnNldFkgPSBjcm9wT2Zmc2V0UG9zaXRpb25ZICogc291cmNlUmVzb2x1dGlvblk7XHJcbiAgICBcclxuICAgIGNvbnRleHQuZHJhd0ltYWdlKFxyXG4gICAgICAgIHRoaXMuX3JlZ2lvbnNbUkVHSU9OX09WRVJWSUVXXS5jYW52YXMsXHJcbiAgICAgICAgY3JvcFBpeGVsT2Zmc2V0WCwgY3JvcFBpeGVsT2Zmc2V0WSwgY3JvcFdpZHRoLCBjcm9wSGVpZ2h0LFxyXG4gICAgICAgIDAsIDAsIGNhbnZhc1BpeGVsc1dpZHRoLCBjYW52YXNQaXhlbHNIZWlnaHQpO1xyXG59O1xyXG5cclxuVmlld2VySW1hZ2VEZWNvZGVyLnByb3RvdHlwZS5fb3BlbmVkID0gZnVuY3Rpb24gb3BlbmVkKCkge1xyXG4gICAgdGhpcy5faXNSZWFkeSA9IHRydWU7XHJcbiAgICBcclxuICAgIHZhciBmaXhlZEJvdW5kcyA9IHtcclxuICAgICAgICB3ZXN0OiB0aGlzLl9jYXJ0b2dyYXBoaWNCb3VuZHMud2VzdCxcclxuICAgICAgICBlYXN0OiB0aGlzLl9jYXJ0b2dyYXBoaWNCb3VuZHMuZWFzdCxcclxuICAgICAgICBzb3V0aDogdGhpcy5fY2FydG9ncmFwaGljQm91bmRzLnNvdXRoLFxyXG4gICAgICAgIG5vcnRoOiB0aGlzLl9jYXJ0b2dyYXBoaWNCb3VuZHMubm9ydGhcclxuICAgIH07XHJcbiAgICBpbWFnZUhlbHBlckZ1bmN0aW9ucy5maXhCb3VuZHMoXHJcbiAgICAgICAgZml4ZWRCb3VuZHMsIHRoaXMuX2RlY29kZXIsIHRoaXMuX2FkYXB0UHJvcG9ydGlvbnMpO1xyXG4gICAgdGhpcy5fY2FydG9ncmFwaGljQm91bmRzRml4ZWQgPSBmaXhlZEJvdW5kcztcclxuICAgIFxyXG4gICAgdmFyIGltYWdlV2lkdGggID0gdGhpcy5fZGVjb2Rlci5nZXRJbWFnZVdpZHRoICgpO1xyXG4gICAgdmFyIGltYWdlSGVpZ2h0ID0gdGhpcy5fZGVjb2Rlci5nZXRJbWFnZUhlaWdodCgpO1xyXG4gICAgdGhpcy5fcXVhbGl0eSA9IHRoaXMuX2RlY29kZXIuZ2V0SGlnaGVzdFF1YWxpdHkoKTtcclxuXHJcbiAgICB2YXIgcmVjdGFuZ2xlV2lkdGggPSBmaXhlZEJvdW5kcy5lYXN0IC0gZml4ZWRCb3VuZHMud2VzdDtcclxuICAgIHZhciByZWN0YW5nbGVIZWlnaHQgPSBmaXhlZEJvdW5kcy5ub3J0aCAtIGZpeGVkQm91bmRzLnNvdXRoO1xyXG4gICAgdGhpcy5fc2NhbGVYID0gaW1hZ2VXaWR0aCAvIHJlY3RhbmdsZVdpZHRoO1xyXG4gICAgdGhpcy5fc2NhbGVZID0gLWltYWdlSGVpZ2h0IC8gcmVjdGFuZ2xlSGVpZ2h0O1xyXG4gICAgXHJcbiAgICB0aGlzLl90cmFuc2xhdGVYID0gLWZpeGVkQm91bmRzLndlc3QgKiB0aGlzLl9zY2FsZVg7XHJcbiAgICB0aGlzLl90cmFuc2xhdGVZID0gLWZpeGVkQm91bmRzLm5vcnRoICogdGhpcy5fc2NhbGVZO1xyXG4gICAgXHJcbiAgICB2YXIgb3ZlcnZpZXdQYXJhbXMgPSB7XHJcbiAgICAgICAgbWluWDogMCxcclxuICAgICAgICBtaW5ZOiAwLFxyXG4gICAgICAgIG1heFhFeGNsdXNpdmU6IGltYWdlV2lkdGgsXHJcbiAgICAgICAgbWF4WUV4Y2x1c2l2ZTogaW1hZ2VIZWlnaHQsXHJcbiAgICAgICAgc2NyZWVuV2lkdGg6IHRoaXMuX292ZXJ2aWV3UmVzb2x1dGlvblgsXHJcbiAgICAgICAgc2NyZWVuSGVpZ2h0OiB0aGlzLl9vdmVydmlld1Jlc29sdXRpb25ZXHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICB2YXIgb3ZlcnZpZXdBbGlnbmVkUGFyYW1zID1cclxuICAgICAgICBpbWFnZUhlbHBlckZ1bmN0aW9ucy5hbGlnblBhcmFtc1RvVGlsZXNBbmRMZXZlbChcclxuICAgICAgICAgICAgb3ZlcnZpZXdQYXJhbXMsIHRoaXMuX2RlY29kZXIsIHRoaXMuX2ltYWdlKTtcclxuICAgICAgICAgICAgXHJcbiAgICBvdmVydmlld0FsaWduZWRQYXJhbXMuaW1hZ2VQYXJ0UGFyYW1zLnJlcXVlc3RQcmlvcml0eURhdGEgPVxyXG4gICAgICAgIG92ZXJ2aWV3QWxpZ25lZFBhcmFtcy5pbWFnZVBhcnRQYXJhbXMucmVxdWVzdFByaW9yaXR5RGF0YSB8fCB7fTtcclxuICAgIFxyXG4gICAgb3ZlcnZpZXdBbGlnbmVkUGFyYW1zLmltYWdlUGFydFBhcmFtcy5yZXF1ZXN0UHJpb3JpdHlEYXRhLm92ZXJyaWRlSGlnaGVzdFByaW9yaXR5ID0gdHJ1ZTtcclxuICAgIG92ZXJ2aWV3QWxpZ25lZFBhcmFtcy5pbWFnZVBhcnRQYXJhbXMucXVhbGl0eSA9IHRoaXMuX2RlY29kZXIuZ2V0TG93ZXN0UXVhbGl0eSgpO1xyXG4gICAgXHJcbiAgICB2YXIgc3RhcnREeW5hbWljUmVnaW9uT25UZXJtaW5hdGlvbiA9XHJcbiAgICAgICAgIXRoaXMuX2FsbG93TXVsdGlwbGVDaGFubmVsc0luU2Vzc2lvbjtcclxuICAgICAgICBcclxuICAgIHRoaXMuX2ZldGNoKFxyXG4gICAgICAgIFJFR0lPTl9PVkVSVklFVyxcclxuICAgICAgICBvdmVydmlld0FsaWduZWRQYXJhbXMsXHJcbiAgICAgICAgc3RhcnREeW5hbWljUmVnaW9uT25UZXJtaW5hdGlvbik7XHJcbiAgICBcclxuICAgIGlmICh0aGlzLl9hbGxvd011bHRpcGxlQ2hhbm5lbHNJblNlc3Npb24pIHtcclxuICAgICAgICB0aGlzLl9zdGFydFNob3dpbmdEeW5hbWljUmVnaW9uKCk7XHJcbiAgICB9XHJcbn07IiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxubW9kdWxlLmV4cG9ydHMuVmlld2VySW1hZ2VEZWNvZGVyID0gcmVxdWlyZSgndmlld2VyaW1hZ2VkZWNvZGVyLmpzJyk7XHJcbm1vZHVsZS5leHBvcnRzLkltYWdlRGVjb2RlciA9IHJlcXVpcmUoJ2ltYWdlZGVjb2Rlci5qcycpO1xyXG5tb2R1bGUuZXhwb3J0cy5GZXRjaE1hbmFnZXIgPSByZXF1aXJlKCdmZXRjaG1hbmFnZXIuanMnKTtcclxubW9kdWxlLmV4cG9ydHMuUHJvbWlzZUZldGNoZXJBZGFwdGVyID0gcmVxdWlyZSgncHJvbWlzZWZldGNoZXJhZGFwdGVyLmpzJyk7XHJcbi8vbW9kdWxlLmV4cG9ydHMuU2ltcGxlRmV0Y2hlciA9IHJlcXVpcmUoJ3NpbXBsZWZldGNoZXIuanMnKTtcclxuLy9tb2R1bGUuZXhwb3J0cy5TaW1wbGVQaXhlbHNEZWNvZGVyQmFzZSA9IHJlcXVpcmUoJ3NpbXBsZXBpeGVsc2RlY29kZXJiYXNlLmpzJyk7XHJcbm1vZHVsZS5leHBvcnRzLkNlc2l1bUltYWdlRGVjb2RlckxheWVyTWFuYWdlciA9IHJlcXVpcmUoJ19jZXNpdW1pbWFnZWRlY29kZXJsYXllcm1hbmFnZXIuanMnKTtcclxubW9kdWxlLmV4cG9ydHMuSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyID0gcmVxdWlyZSgnaW1hZ2VkZWNvZGVyaW1hZ2VyeXByb3ZpZGVyLmpzJyk7XHJcbm1vZHVsZS5leHBvcnRzLkltYWdlRGVjb2RlclJlZ2lvbkxheWVyID0gcmVxdWlyZSgnaW1hZ2VkZWNvZGVycmVnaW9ubGF5ZXIuanMnKTtcclxuIiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxudmFyIFZpZXdlckltYWdlRGVjb2RlciA9IHJlcXVpcmUoJ3ZpZXdlcmltYWdlZGVjb2Rlci5qcycpO1xyXG52YXIgY2FsY3VsYXRlTGVhZmxldEZydXN0dW0gPSByZXF1aXJlKCdsZWFmbGV0ZnJ1c3R1bWNhbGN1bGF0b3IuanMnKTtcclxuXHJcbi8qIGdsb2JhbCBMOiBmYWxzZSAqL1xyXG4vKiBnbG9iYWwgc2VsZjogZmFsc2UgKi9cclxuXHJcbmlmIChzZWxmLkwpIHtcclxuICAgIG1vZHVsZS5leHBvcnRzID0gTC5DbGFzcy5leHRlbmQoY3JlYXRlSW1hZ2VEZWNvZGVyUmVnaW9uTGF5ZXJGdW5jdGlvbnMoKSk7XHJcbn0gZWxzZSB7XHJcbiAgICBtb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uKCkge1xyXG4gICAgICAgIHRocm93IG5ldyBFcnJvcignQ2Fubm90IGluc3RhbnRpYXRlIEltYWdlRGVjb2RlclJlZ2lvbkxheWVyOiBObyBMZWFmbGV0IG5hbWVzcGFjZSBpbiBzY29wZScpO1xyXG4gICAgfTtcclxufVxyXG5cclxuZnVuY3Rpb24gY3JlYXRlSW1hZ2VEZWNvZGVyUmVnaW9uTGF5ZXJGdW5jdGlvbnMoKSB7XHJcbiAgICByZXR1cm4ge1xyXG4gICAgICAgIGluaXRpYWxpemU6IGZ1bmN0aW9uIGluaXRpYWxpemUob3B0aW9ucykge1xyXG4gICAgICAgICAgICB0aGlzLl9vcHRpb25zID0gb3B0aW9ucyB8fCB7fTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGlmICh0aGlzLl9vcHRpb25zLmxhdExuZ0JvdW5kcyAhPT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgICAgICAgICB0aGlzLl9vcHRpb25zID0ge307XHJcbiAgICAgICAgICAgICAgICBmb3IgKHZhciBtZW1iZXIgaW4gb3B0aW9ucykge1xyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX29wdGlvbnNbbWVtYmVyXSA9IG9wdGlvbnNbbWVtYmVyXTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIHRoaXMuX29wdGlvbnMuY2FydG9ncmFwaGljQm91bmRzID0ge1xyXG4gICAgICAgICAgICAgICAgICAgIHdlc3Q6IG9wdGlvbnMubGF0TG5nQm91bmRzLmdldFdlc3QoKSxcclxuICAgICAgICAgICAgICAgICAgICBlYXN0OiBvcHRpb25zLmxhdExuZ0JvdW5kcy5nZXRFYXN0KCksXHJcbiAgICAgICAgICAgICAgICAgICAgc291dGg6IG9wdGlvbnMubGF0TG5nQm91bmRzLmdldFNvdXRoKCksXHJcbiAgICAgICAgICAgICAgICAgICAgbm9ydGg6IG9wdGlvbnMubGF0TG5nQm91bmRzLmdldE5vcnRoKClcclxuICAgICAgICAgICAgICAgIH07XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHRoaXMuX3RhcmdldENhbnZhcyA9IG51bGw7XHJcbiAgICAgICAgICAgIHRoaXMuX2NhbnZhc1Bvc2l0aW9uID0gbnVsbDtcclxuICAgICAgICAgICAgdGhpcy5fY2FudmFzVXBkYXRlZENhbGxiYWNrQm91bmQgPSB0aGlzLl9jYW52YXNVcGRhdGVkQ2FsbGJhY2suYmluZCh0aGlzKTtcclxuICAgICAgICAgICAgdGhpcy5fdmlld2VySW1hZ2VEZWNvZGVyID0gbnVsbDtcclxuICAgICAgICAgICAgdGhpcy5fZXhjZXB0aW9uQ2FsbGJhY2sgPSBudWxsO1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgXHJcbiAgICAgICAgc2V0RXhjZXB0aW9uQ2FsbGJhY2s6IGZ1bmN0aW9uIHNldEV4Y2VwdGlvbkNhbGxiYWNrKGV4Y2VwdGlvbkNhbGxiYWNrKSB7XHJcbiAgICAgICAgICAgIHRoaXMuX2V4Y2VwdGlvbkNhbGxiYWNrID0gZXhjZXB0aW9uQ2FsbGJhY2s7XHJcbiAgICAgICAgICAgIGlmICh0aGlzLl92aWV3ZXJJbWFnZURlY29kZXIgIT09IG51bGwpIHtcclxuICAgICAgICAgICAgICAgIHRoaXMuX3ZpZXdlckltYWdlRGVjb2Rlci5zZXRFeGNlcHRpb25DYWxsYmFjayhleGNlcHRpb25DYWxsYmFjayk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9LFxyXG4gICAgICAgIFxyXG4gICAgICAgIF9jcmVhdGVJbWFnZTogZnVuY3Rpb24gY3JlYXRlSW1hZ2UoKSB7XHJcbiAgICAgICAgICAgIGlmICh0aGlzLl92aWV3ZXJJbWFnZURlY29kZXIgPT09IG51bGwpIHtcclxuICAgICAgICAgICAgICAgIHRoaXMuX3ZpZXdlckltYWdlRGVjb2RlciA9IG5ldyBWaWV3ZXJJbWFnZURlY29kZXIoXHJcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5fb3B0aW9ucy5pbWFnZURlY29kZXIsXHJcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5fY2FudmFzVXBkYXRlZENhbGxiYWNrQm91bmQsXHJcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5fb3B0aW9ucyk7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIGlmICh0aGlzLl9leGNlcHRpb25DYWxsYmFjayAhPT0gbnVsbCkge1xyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX3ZpZXdlckltYWdlRGVjb2Rlci5zZXRFeGNlcHRpb25DYWxsYmFjayh0aGlzLl9leGNlcHRpb25DYWxsYmFjayk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIHRoaXMuX3ZpZXdlckltYWdlRGVjb2Rlci5vcGVuKHRoaXMuX29wdGlvbnMudXJsKS5jYXRjaCh0aGlzLl9leGNlcHRpb25DYWxsYmFjayk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9LFxyXG5cclxuICAgICAgICBvbkFkZDogZnVuY3Rpb24gb25BZGQobWFwKSB7XHJcbiAgICAgICAgICAgIGlmICh0aGlzLl9tYXAgIT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgICAgICAgICAgdGhyb3cgJ0Nhbm5vdCBhZGQgdGhpcyBsYXllciB0byB0d28gbWFwcyc7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHRoaXMuX21hcCA9IG1hcDtcclxuICAgICAgICAgICAgdGhpcy5fY3JlYXRlSW1hZ2UoKTtcclxuXHJcbiAgICAgICAgICAgIC8vIGNyZWF0ZSBhIERPTSBlbGVtZW50IGFuZCBwdXQgaXQgaW50byBvbmUgb2YgdGhlIG1hcCBwYW5lc1xyXG4gICAgICAgICAgICB0aGlzLl90YXJnZXRDYW52YXMgPSBMLkRvbVV0aWwuY3JlYXRlKFxyXG4gICAgICAgICAgICAgICAgJ2NhbnZhcycsICdpbWFnZS1kZWNvZGVyLWxheWVyLWNhbnZhcyBsZWFmbGV0LXpvb20tYW5pbWF0ZWQnKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHRoaXMuX3ZpZXdlckltYWdlRGVjb2Rlci5zZXRUYXJnZXRDYW52YXModGhpcy5fdGFyZ2V0Q2FudmFzKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHRoaXMuX2NhbnZhc1Bvc2l0aW9uID0gbnVsbDtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBtYXAuZ2V0UGFuZXMoKS5tYXBQYW5lLmFwcGVuZENoaWxkKHRoaXMuX3RhcmdldENhbnZhcyk7XHJcblxyXG4gICAgICAgICAgICAvLyBhZGQgYSB2aWV3cmVzZXQgZXZlbnQgbGlzdGVuZXIgZm9yIHVwZGF0aW5nIGxheWVyJ3MgcG9zaXRpb24sIGRvIHRoZSBsYXR0ZXJcclxuICAgICAgICAgICAgbWFwLm9uKCd2aWV3cmVzZXQnLCB0aGlzLl9tb3ZlZCwgdGhpcyk7XHJcbiAgICAgICAgICAgIG1hcC5vbignbW92ZScsIHRoaXMuX21vdmVkLCB0aGlzKTtcclxuXHJcbiAgICAgICAgICAgIGlmIChMLkJyb3dzZXIuYW55M2QpIHtcclxuICAgICAgICAgICAgICAgIG1hcC5vbignem9vbWFuaW0nLCB0aGlzLl9hbmltYXRlWm9vbSwgdGhpcyk7XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIHRoaXMuX21vdmVkKCk7XHJcbiAgICAgICAgfSxcclxuXHJcbiAgICAgICAgb25SZW1vdmU6IGZ1bmN0aW9uIG9uUmVtb3ZlKG1hcCkge1xyXG4gICAgICAgICAgICBpZiAobWFwICE9PSB0aGlzLl9tYXApIHtcclxuICAgICAgICAgICAgICAgIHRocm93ICdSZW1vdmVkIGZyb20gd3JvbmcgbWFwJztcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgbWFwLm9mZigndmlld3Jlc2V0JywgdGhpcy5fbW92ZWQsIHRoaXMpO1xyXG4gICAgICAgICAgICBtYXAub2ZmKCdtb3ZlJywgdGhpcy5fbW92ZWQsIHRoaXMpO1xyXG4gICAgICAgICAgICBtYXAub2ZmKCd6b29tYW5pbScsIHRoaXMuX2FuaW1hdGVab29tLCB0aGlzKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIHJlbW92ZSBsYXllcidzIERPTSBlbGVtZW50cyBhbmQgbGlzdGVuZXJzXHJcbiAgICAgICAgICAgIG1hcC5nZXRQYW5lcygpLm1hcFBhbmUucmVtb3ZlQ2hpbGQodGhpcy5fdGFyZ2V0Q2FudmFzKTtcclxuICAgICAgICAgICAgdGhpcy5fdGFyZ2V0Q2FudmFzID0gbnVsbDtcclxuICAgICAgICAgICAgdGhpcy5fY2FudmFzUG9zaXRpb24gPSBudWxsO1xyXG5cclxuICAgICAgICAgICAgdGhpcy5fbWFwID0gdW5kZWZpbmVkO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgdGhpcy5fdmlld2VySW1hZ2VEZWNvZGVyLmNsb3NlKCk7XHJcbiAgICAgICAgICAgIHRoaXMuX3ZpZXdlckltYWdlRGVjb2RlciA9IG51bGw7XHJcbiAgICAgICAgfSxcclxuICAgICAgICBcclxuICAgICAgICBfbW92ZWQ6IGZ1bmN0aW9uICgpIHtcclxuICAgICAgICAgICAgdGhpcy5fbW92ZUNhbnZhc2VzKCk7XHJcblxyXG4gICAgICAgICAgICB2YXIgZnJ1c3R1bURhdGEgPSBjYWxjdWxhdGVMZWFmbGV0RnJ1c3R1bSh0aGlzLl9tYXApO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgdGhpcy5fdmlld2VySW1hZ2VEZWNvZGVyLnVwZGF0ZVZpZXdBcmVhKGZydXN0dW1EYXRhKTtcclxuICAgICAgICB9LFxyXG4gICAgICAgIFxyXG4gICAgICAgIF9jYW52YXNVcGRhdGVkQ2FsbGJhY2s6IGZ1bmN0aW9uIGNhbnZhc1VwZGF0ZWRDYWxsYmFjayhuZXdQb3NpdGlvbikge1xyXG4gICAgICAgICAgICBpZiAobmV3UG9zaXRpb24gIT09IG51bGwpIHtcclxuICAgICAgICAgICAgICAgIHRoaXMuX2NhbnZhc1Bvc2l0aW9uID0gbmV3UG9zaXRpb247XHJcbiAgICAgICAgICAgICAgICB0aGlzLl9tb3ZlQ2FudmFzZXMoKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH0sXHJcbiAgICAgICAgXHJcbiAgICAgICAgX21vdmVDYW52YXNlczogZnVuY3Rpb24gbW92ZUNhbnZhc2VzKCkge1xyXG4gICAgICAgICAgICBpZiAodGhpcy5fY2FudmFzUG9zaXRpb24gPT09IG51bGwpIHtcclxuICAgICAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgICAgICAvLyB1cGRhdGUgbGF5ZXIncyBwb3NpdGlvblxyXG4gICAgICAgICAgICB2YXIgd2VzdCA9IHRoaXMuX2NhbnZhc1Bvc2l0aW9uLndlc3Q7XHJcbiAgICAgICAgICAgIHZhciBlYXN0ID0gdGhpcy5fY2FudmFzUG9zaXRpb24uZWFzdDtcclxuICAgICAgICAgICAgdmFyIHNvdXRoID0gdGhpcy5fY2FudmFzUG9zaXRpb24uc291dGg7XHJcbiAgICAgICAgICAgIHZhciBub3J0aCA9IHRoaXMuX2NhbnZhc1Bvc2l0aW9uLm5vcnRoO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgdmFyIHRvcExlZnQgPSB0aGlzLl9tYXAubGF0TG5nVG9MYXllclBvaW50KFtub3J0aCwgd2VzdF0pO1xyXG4gICAgICAgICAgICB2YXIgYm90dG9tUmlnaHQgPSB0aGlzLl9tYXAubGF0TG5nVG9MYXllclBvaW50KFtzb3V0aCwgZWFzdF0pO1xyXG4gICAgICAgICAgICB2YXIgc2l6ZSA9IGJvdHRvbVJpZ2h0LnN1YnRyYWN0KHRvcExlZnQpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgTC5Eb21VdGlsLnNldFBvc2l0aW9uKHRoaXMuX3RhcmdldENhbnZhcywgdG9wTGVmdCk7XHJcbiAgICAgICAgICAgIHRoaXMuX3RhcmdldENhbnZhcy5zdHlsZS53aWR0aCA9IHNpemUueCArICdweCc7XHJcbiAgICAgICAgICAgIHRoaXMuX3RhcmdldENhbnZhcy5zdHlsZS5oZWlnaHQgPSBzaXplLnkgKyAncHgnO1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgXHJcbiAgICAgICAgX2FuaW1hdGVab29tOiBmdW5jdGlvbiBhbmltYXRlWm9vbShvcHRpb25zKSB7XHJcbiAgICAgICAgICAgIGlmICh0aGlzLl9jYW52YXNQb3NpdGlvbiA9PT0gbnVsbCkge1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIE5PVEU6IEFsbCBtZXRob2QgKGluY2x1ZGluZyB1c2luZyBvZiBwcml2YXRlIG1ldGhvZFxyXG4gICAgICAgICAgICAvLyBfbGF0TG5nVG9OZXdMYXllclBvaW50KSB3YXMgY29waWVkIGZyb20gSW1hZ2VPdmVybGF5LFxyXG4gICAgICAgICAgICAvLyBhcyBMZWFmbGV0IGRvY3VtZW50YXRpb24gcmVjb21tZW5kcy5cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHZhciB3ZXN0ID0gIHRoaXMuX2NhbnZhc1Bvc2l0aW9uLndlc3Q7XHJcbiAgICAgICAgICAgIHZhciBlYXN0ID0gIHRoaXMuX2NhbnZhc1Bvc2l0aW9uLmVhc3Q7XHJcbiAgICAgICAgICAgIHZhciBzb3V0aCA9IHRoaXMuX2NhbnZhc1Bvc2l0aW9uLnNvdXRoO1xyXG4gICAgICAgICAgICB2YXIgbm9ydGggPSB0aGlzLl9jYW52YXNQb3NpdGlvbi5ub3J0aDtcclxuXHJcbiAgICAgICAgICAgIHZhciB0b3BMZWZ0ID0gdGhpcy5fbWFwLl9sYXRMbmdUb05ld0xheWVyUG9pbnQoXHJcbiAgICAgICAgICAgICAgICBbbm9ydGgsIHdlc3RdLCBvcHRpb25zLnpvb20sIG9wdGlvbnMuY2VudGVyKTtcclxuICAgICAgICAgICAgdmFyIGJvdHRvbVJpZ2h0ID0gdGhpcy5fbWFwLl9sYXRMbmdUb05ld0xheWVyUG9pbnQoXHJcbiAgICAgICAgICAgICAgICBbc291dGgsIGVhc3RdLCBvcHRpb25zLnpvb20sIG9wdGlvbnMuY2VudGVyKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHZhciBzY2FsZSA9IHRoaXMuX21hcC5nZXRab29tU2NhbGUob3B0aW9ucy56b29tKTtcclxuICAgICAgICAgICAgdmFyIHNpemUgPSBib3R0b21SaWdodC5zdWJ0cmFjdCh0b3BMZWZ0KTtcclxuICAgICAgICAgICAgdmFyIHNpemVTY2FsZWQgPSBzaXplLm11bHRpcGx5QnkoKDEgLyAyKSAqICgxIC0gMSAvIHNjYWxlKSk7XHJcbiAgICAgICAgICAgIHZhciBvcmlnaW4gPSB0b3BMZWZ0LmFkZChzaXplU2NhbGVkKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHRoaXMuX3RhcmdldENhbnZhcy5zdHlsZVtMLkRvbVV0aWwuVFJBTlNGT1JNXSA9XHJcbiAgICAgICAgICAgICAgICBMLkRvbVV0aWwuZ2V0VHJhbnNsYXRlU3RyaW5nKG9yaWdpbikgKyAnIHNjYWxlKCcgKyBzY2FsZSArICcpICc7XHJcbiAgICAgICAgfVxyXG4gICAgfTtcclxufSIsIid1c2Ugc3RyaWN0JztcclxuXHJcbnZhciBpbWFnZUhlbHBlckZ1bmN0aW9ucyA9IHJlcXVpcmUoJ2ltYWdlaGVscGVyZnVuY3Rpb25zLmpzJyk7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIGNhbGN1bGF0ZUxlYWZsZXRGcnVzdHVtKGxlYWZsZXRNYXApIHtcclxuICAgIHZhciBzY3JlZW5TaXplID0gbGVhZmxldE1hcC5nZXRTaXplKCk7XHJcbiAgICB2YXIgYm91bmRzID0gbGVhZmxldE1hcC5nZXRCb3VuZHMoKTtcclxuXHJcbiAgICB2YXIgY2FydG9ncmFwaGljQm91bmRzID0ge1xyXG4gICAgICAgIHdlc3Q6IGJvdW5kcy5nZXRXZXN0KCksXHJcbiAgICAgICAgZWFzdDogYm91bmRzLmdldEVhc3QoKSxcclxuICAgICAgICBzb3V0aDogYm91bmRzLmdldFNvdXRoKCksXHJcbiAgICAgICAgbm9ydGg6IGJvdW5kcy5nZXROb3J0aCgpXHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICB2YXIgZnJ1c3R1bURhdGEgPSBpbWFnZUhlbHBlckZ1bmN0aW9ucy5jYWxjdWxhdGVGcnVzdHVtMkRGcm9tQm91bmRzKFxyXG4gICAgICAgIGNhcnRvZ3JhcGhpY0JvdW5kcywgc2NyZWVuU2l6ZSk7XHJcblxyXG4gICAgcmV0dXJuIGZydXN0dW1EYXRhO1xyXG59OyIsIid1c2Ugc3RyaWN0JztcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gUHJvbWlzZUZldGNoZXJBZGFwdGVyO1xyXG5cclxudmFyIFByb21pc2VGZXRjaEFkYXB0ZXJGZXRjaEhhbmRsZSA9IHJlcXVpcmUoJ3Byb21pc2VmZXRjaGVyYWRhcHRlcmZldGNoaGFuZGxlLmpzJyk7XHJcblxyXG4vKiBnbG9iYWwgUHJvbWlzZTogZmFsc2UgKi9cclxuXHJcbmZ1bmN0aW9uIFByb21pc2VGZXRjaGVyQWRhcHRlcihwcm9taXNlRmV0Y2hlciwgb3B0aW9ucykge1xyXG4gICAgdGhpcy5fdXJsID0gbnVsbDtcclxuICAgIHRoaXMuX29wdGlvbnMgPSBvcHRpb25zIHx8IHt9O1xyXG4gICAgdGhpcy5fcHJvbWlzZUZldGNoZXIgPSBwcm9taXNlRmV0Y2hlcjtcclxuICAgIHRoaXMuX2RhdGFMaXN0ZW5lcnMgPSBbXTtcclxuICAgIHRoaXMuX2lzUmVhZHkgPSBmYWxzZTtcclxuICAgIHRoaXMuX2FjdGl2ZUZldGNoZXMgPSAwO1xyXG4gICAgdGhpcy5fcmVzb2x2ZUNsb3NlID0gbnVsbDtcclxuICAgIHRoaXMuX3JlamVjdENsb3NlID0gbnVsbDtcclxufVxyXG5cclxuLy8gRmV0Y2hlciBpbXBsZW1lbnRhdGlvblxyXG5cclxuUHJvbWlzZUZldGNoZXJBZGFwdGVyLnByb3RvdHlwZS5vcGVuID0gZnVuY3Rpb24gb3Blbih1cmwpIHtcclxuICAgIHZhciBzZWxmID0gdGhpcztcclxuICAgIHJldHVybiB0aGlzLl9wcm9taXNlRmV0Y2hlci5vcGVuKHVybCkudGhlbihmdW5jdGlvbihyZXN1bHQpIHtcclxuICAgICAgICBzZWxmLl9pc1JlYWR5ID0gdHJ1ZTtcclxuICAgICAgICByZXR1cm4gcmVzdWx0O1xyXG4gICAgfSk7XHJcbn07XHJcblxyXG5Qcm9taXNlRmV0Y2hlckFkYXB0ZXIucHJvdG90eXBlLmNsb3NlID0gZnVuY3Rpb24gY2xvc2UoY2xvc2VkQ2FsbGJhY2spIHtcclxuICAgIHRoaXMuX2Vuc3VyZVJlYWR5KCk7XHJcbiAgICB0aGlzLl9pc1JlYWR5ID0gZmFsc2U7XHJcbiAgICB2YXIgc2VsZiA9IHRoaXM7XHJcbiAgICByZXR1cm4gbmV3IFByb21pc2UoZnVuY3Rpb24ocmVzb2x2ZSwgcmVqZWN0KSB7XHJcbiAgICAgICAgc2VsZi5fcmVzb2x2ZUNsb3NlID0gcmVzb2x2ZTtcclxuICAgICAgICBzZWxmLl9yZWplY3RDbG9zZSA9IHJlamVjdDtcclxuICAgICAgICBzZWxmLl9jaGVja0lmQ2xvc2VkKCk7XHJcbiAgICB9KTtcclxufTtcclxuXHJcblByb21pc2VGZXRjaGVyQWRhcHRlci5wcm90b3R5cGUucmVjb25uZWN0ID0gZnVuY3Rpb24gcmVjb25uZWN0KCkge1xyXG4gICAgdGhpcy5fZW5zdXJlUmVhZHkoKTtcclxufTtcclxuXHJcblByb21pc2VGZXRjaGVyQWRhcHRlci5wcm90b3R5cGUub24gPSBmdW5jdGlvbiBvbihldmVudCwgbGlzdGVuZXIpIHtcclxuICAgIGlmIChldmVudCAhPT0gJ2RhdGEnKSB7XHJcbiAgICAgICAgdGhyb3cgJ1Byb21pc2VGZXRjaGVyQWRhcHRlcjogVW5leHBlY3RlZCBldmVudCAnICsgZXZlbnQgKyAnLiBFeHBlY3RlZCBcImRhdGFcIic7XHJcbiAgICB9XHJcbiAgICB0aGlzLl9kYXRhTGlzdGVuZXJzLnB1c2gobGlzdGVuZXIpO1xyXG59O1xyXG5cclxuUHJvbWlzZUZldGNoZXJBZGFwdGVyLnByb3RvdHlwZS5mZXRjaCA9IGZ1bmN0aW9uIGZldGNoKGltYWdlUGFydFBhcmFtcykge1xyXG4gICAgdGhpcy5fZW5zdXJlUmVhZHkoKTtcclxuICAgICsrdGhpcy5fYWN0aXZlRmV0Y2hlcztcclxuXHR2YXIgZmV0Y2hIYW5kbGUgPSBuZXcgUHJvbWlzZUZldGNoQWRhcHRlckZldGNoSGFuZGxlKGltYWdlUGFydFBhcmFtcyk7XHJcblxyXG4gICAgdmFyIHNlbGYgPSB0aGlzO1xyXG4gICAgdGhpcy5fcHJvbWlzZUZldGNoZXIuZmV0Y2goaW1hZ2VQYXJ0UGFyYW1zKVxyXG4gICAgICAgIC50aGVuKGZ1bmN0aW9uKHJlc3VsdCkge1xyXG4gICAgICAgICAgICBzZWxmLl9hZnRlckZldGNoKGZldGNoSGFuZGxlLCByZXN1bHQpO1xyXG4gICAgICAgIH0pLmNhdGNoKGZ1bmN0aW9uKHJlYXNvbikge1xyXG4gICAgICAgICAgICBzZWxmLl9hZnRlckZhaWxlZEZldGNoKHJlYXNvbik7XHJcbiAgICAgICAgfSk7XHJcblx0XHJcblx0cmV0dXJuIGZldGNoSGFuZGxlO1xyXG59O1xyXG5cclxuUHJvbWlzZUZldGNoZXJBZGFwdGVyLnByb3RvdHlwZS5zdGFydE1vdmFibGVGZXRjaCA9IGZ1bmN0aW9uIHN0YXJ0TW92YWJsZUZldGNoKGltYWdlUGFydFBhcmFtcywgbW92YWJsZUZldGNoU3RhdGUpIHtcclxuICAgIHRoaXMuX2Vuc3VyZVJlYWR5KCk7XHJcblx0XHJcblx0dmFyIGZldGNoSGFuZGxlID0gbmV3IFByb21pc2VGZXRjaEFkYXB0ZXJGZXRjaEhhbmRsZShpbWFnZVBhcnRQYXJhbXMpO1xyXG4gICAgXHJcbiAgICB2YXIgc2VsZiA9IHRoaXM7XHJcbiAgICBtb3ZhYmxlRmV0Y2hTdGF0ZS5fY3VycmVudEZldGNoSGFuZGxlID0gbnVsbDtcclxuICAgIG1vdmFibGVGZXRjaFN0YXRlLl9wZW5kaW5nRmV0Y2hIYW5kbGUgPSBmZXRjaEhhbmRsZTtcclxuICAgIG1vdmFibGVGZXRjaFN0YXRlLl9zdGFydE5leHRGZXRjaCA9ICBzdGFydE5leHRGZXRjaDtcclxuICAgIFxyXG4gICAgZnVuY3Rpb24gc3RhcnROZXh0RmV0Y2gocHJldkZldGNoUmVzdWx0KSB7XHJcbiAgICAgICAgaWYgKG1vdmFibGVGZXRjaFN0YXRlLl9jdXJyZW50RmV0Y2hIYW5kbGUgIT09IG51bGwpIHtcclxuICAgICAgICAgICAgdmFyIGVuZGVkRmV0Y2hIYW5kbGUgPSBtb3ZhYmxlRmV0Y2hTdGF0ZS5fY3VycmVudEZldGNoSGFuZGxlO1xyXG4gICAgICAgICAgICBtb3ZhYmxlRmV0Y2hTdGF0ZS5fY3VycmVudEZldGNoSGFuZGxlID0gbnVsbDtcclxuICAgICAgICAgICAgc2VsZi5fYWZ0ZXJGZXRjaChlbmRlZEZldGNoSGFuZGxlLCBwcmV2RmV0Y2hSZXN1bHQpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBpZiAobW92YWJsZUZldGNoU3RhdGUuX3BlbmRpbmdGZXRjaEhhbmRsZSAhPT0gbnVsbCAmJiBzZWxmLl9pc1JlYWR5KSB7XHJcbiAgICAgICAgICAgICsrc2VsZi5fYWN0aXZlRmV0Y2hlcztcclxuICAgICAgICAgICAgbW92YWJsZUZldGNoU3RhdGUuX2N1cnJlbnRGZXRjaEhhbmRsZSA9IG1vdmFibGVGZXRjaFN0YXRlLl9wZW5kaW5nRmV0Y2hIYW5kbGU7XHJcblx0XHRcdG1vdmFibGVGZXRjaFN0YXRlLl9wZW5kaW5nRmV0Y2hIYW5kbGUgPSBudWxsO1xyXG4gICAgICAgICAgICBzZWxmLl9wcm9taXNlRmV0Y2hlci5mZXRjaChpbWFnZVBhcnRQYXJhbXMpXHJcbiAgICAgICAgICAgICAgICAudGhlbihzdGFydE5leHRGZXRjaClcclxuICAgICAgICAgICAgICAgIC5jYXRjaChzdGFydE5leHRGZXRjaCk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHJldHVybiBwcmV2RmV0Y2hSZXN1bHQ7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHN0YXJ0TmV4dEZldGNoKCk7XHJcbiAgICBcclxuICAgIHJldHVybiBmZXRjaEhhbmRsZTtcclxufTtcclxuXHJcblByb21pc2VGZXRjaGVyQWRhcHRlci5wcm90b3R5cGUubW92ZUZldGNoID0gZnVuY3Rpb24gbW92ZUZldGNoKGltYWdlUGFydFBhcmFtcywgbW92YWJsZUZldGNoU3RhdGUpIHtcclxuICAgIHRoaXMuX2Vuc3VyZVJlYWR5KCk7XHJcblx0XHJcblx0dmFyIGZldGNoSGFuZGxlID0gbmV3IFByb21pc2VGZXRjaEFkYXB0ZXJGZXRjaEhhbmRsZShpbWFnZVBhcnRQYXJhbXMpO1xyXG5cdFxyXG5cdGlmIChtb3ZhYmxlRmV0Y2hTdGF0ZS5fcGVuZGluZ0ZldGNoSGFuZGxlICE9PSBudWxsKSB7XHJcblx0XHRtb3ZhYmxlRmV0Y2hTdGF0ZS5fcGVuZGluZ0ZldGNoSGFuZGxlLnRlcm1pbmF0ZSgvKmlzQWJvcnRlZD0qL3RydWUpO1xyXG5cdH1cclxuICAgIG1vdmFibGVGZXRjaFN0YXRlLl9wZW5kaW5nRmV0Y2hIYW5kbGUgPSBmZXRjaEhhbmRsZTtcclxuICAgIGlmIChtb3ZhYmxlRmV0Y2hTdGF0ZS5fY3VycmVudEZldGNoSGFuZGxlID09PSBudWxsKSB7XHJcbiAgICAgICAgbW92YWJsZUZldGNoU3RhdGUuX3N0YXJ0TmV4dEZldGNoKCk7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHJldHVybiBmZXRjaEhhbmRsZTtcclxufTtcclxuXHJcblByb21pc2VGZXRjaGVyQWRhcHRlci5wcm90b3R5cGUuX2Vuc3VyZVJlYWR5ID0gZnVuY3Rpb24gZW5zdXJlUmVhZHkoKSB7XHJcbiAgICBpZiAoIXRoaXMuX2lzUmVhZHkpIHtcclxuICAgICAgICB0aHJvdyAnUHJvbWlzZUZldGNoZXJBZGFwdGVyIGVycm9yOiBmZXRjaCBjbGllbnQgaXMgbm90IG9wZW5lZCc7XHJcbiAgICB9XHJcbn07XHJcblxyXG5Qcm9taXNlRmV0Y2hlckFkYXB0ZXIucHJvdG90eXBlLl9jaGVja0lmQ2xvc2VkID0gZnVuY3Rpb24gY2hlY2tJZkNsb3NlZCgpIHtcclxuICAgIGlmICh0aGlzLl9hY3RpdmVGZXRjaGVzID09PSAwICYmICF0aGlzLl9pc1JlYWR5KSB7XHJcbiAgICAgICAgdGhpcy5fcmVzb2x2ZUNsb3NlKCk7XHJcbiAgICB9XHJcbn07XHJcblxyXG5Qcm9taXNlRmV0Y2hlckFkYXB0ZXIucHJvdG90eXBlLl9hZnRlckZldGNoID0gZnVuY3Rpb24oZmV0Y2hIYW5kbGUsIHJlc3VsdCkge1xyXG5cdGZldGNoSGFuZGxlLnRlcm1pbmF0ZSgvKmlzQWJvcnRlZD0qL2ZhbHNlKTtcclxuXHR2YXIgaW1hZ2VQYXJ0UGFyYW1zID0gZmV0Y2hIYW5kbGUuZ2V0SW1hZ2VQYXJ0UGFyYW1zKCk7XHJcbiAgICAtLXRoaXMuX2FjdGl2ZUZldGNoZXM7XHJcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IHRoaXMuX2RhdGFMaXN0ZW5lcnMubGVuZ3RoOyArK2kpIHtcclxuICAgICAgICB0aGlzLl9kYXRhTGlzdGVuZXJzW2ldKHJlc3VsdCwgaW1hZ2VQYXJ0UGFyYW1zKTtcclxuICAgIH1cclxuICAgIHRoaXMuX2NoZWNrSWZDbG9zZWQoKTtcclxuICAgIHJldHVybiByZXN1bHQ7XHJcbn07XHJcblxyXG5Qcm9taXNlRmV0Y2hlckFkYXB0ZXIucHJvdG90eXBlLl9hZnRlckZhaWxlZEZldGNoID0gZnVuY3Rpb24ocmVhc29uKSB7XHJcbiAgICAtLXRoaXMuX2FjdGl2ZUZldGNoZXM7XHJcbiAgICB0aGlzLl9jaGVja0lmQ2xvc2VkKCk7XHJcbiAgICByZXR1cm4gcmVhc29uO1xyXG59OyIsIid1c2Ugc3RyaWN0JztcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gUHJvbWlzZUZldGNoZXJBZGFwdGVyRmV0Y2hIYW5kbGU7XHJcblxyXG4vKiBnbG9iYWwgUHJvbWlzZTogZmFsc2UgKi9cclxuXHJcbmZ1bmN0aW9uIFByb21pc2VGZXRjaGVyQWRhcHRlckZldGNoSGFuZGxlKGltYWdlUGFydFBhcmFtcykge1xyXG5cdHRoaXMuX2ltYWdlUGFydFBhcmFtcyA9IGltYWdlUGFydFBhcmFtcztcclxuXHR0aGlzLl9zdG9wUHJvbWlzZSA9IG51bGw7XHJcblx0dGhpcy5fdGVybWluYXRlZExpc3RlbmVycyA9IFtdO1xyXG5cdHRoaXMuX2lzVGVybWluYXRlZCA9IGZhbHNlO1xyXG5cdHRoaXMuX2lzRGlzcG9zZWQgPSBmYWxzZTtcclxufVxyXG5cclxuUHJvbWlzZUZldGNoZXJBZGFwdGVyRmV0Y2hIYW5kbGUucHJvdG90eXBlLmdldEltYWdlUGFydFBhcmFtcyA9IGZ1bmN0aW9uIGdldEltYWdlUGFydFBhcmFtcygpIHtcclxuXHRyZXR1cm4gdGhpcy5faW1hZ2VQYXJ0UGFyYW1zO1xyXG59O1xyXG5cclxuUHJvbWlzZUZldGNoZXJBZGFwdGVyRmV0Y2hIYW5kbGUucHJvdG90eXBlLnRlcm1pbmF0ZSA9IGZ1bmN0aW9uIHRlcm1pbmF0ZShpc0Fib3J0ZWQpIHtcclxuXHRpZiAodGhpcy5faXNUZXJtaW5hdGVkKSB7XHJcblx0XHR0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBGZXRjaEhhbmRsZSBkb3VibGUgdGVybWluYXRlJztcclxuXHR9XHJcblx0dGhpcy5faXNUZXJtaW5hdGVkID0gdHJ1ZTtcclxuXHRmb3IgKHZhciBpID0gMDsgaSA8IHRoaXMuX3Rlcm1pbmF0ZWRMaXN0ZW5lcnMubGVuZ3RoOyArK2kpIHtcclxuXHRcdHRoaXMuX3Rlcm1pbmF0ZWRMaXN0ZW5lcnNbaV0oaXNBYm9ydGVkKTtcclxuXHR9XHJcbn07XHJcblxyXG4vLyBGZXRjaGVyIGltcGxlbWVudGF0aW9uXHJcblxyXG5Qcm9taXNlRmV0Y2hlckFkYXB0ZXJGZXRjaEhhbmRsZS5wcm90b3R5cGUuc3RvcEFzeW5jID0gZnVuY3Rpb24gc3RvcEFzeW5jKCkge1xyXG5cdGlmICh0aGlzLl9zdG9wUHJvbWlzZSAhPT0gbnVsbCkge1xyXG5cdFx0dmFyIHNlbGYgPSB0aGlzO1xyXG5cdFx0dGhpcy5fc3RvcFByb21pc2UgPSBuZXcgUHJvbWlzZShmdW5jdGlvbihyZXNvbHZlLCByZWplY3QpIHtcclxuXHRcdFx0c2VsZi5vbigndGVybWluYXRlZCcsIHJlc29sdmUpO1xyXG5cdFx0fSk7XHJcblx0fVxyXG5cclxuXHRyZXR1cm4gdGhpcy5fc3RvcFByb21pc2U7XHJcbn07XHJcblxyXG5Qcm9taXNlRmV0Y2hlckFkYXB0ZXJGZXRjaEhhbmRsZS5wcm90b3R5cGUuc2V0SXNQcm9ncmVzc2l2ZSA9IGZ1bmN0aW9uIG1vdmVGZXRjaChpc1Byb2dyZXNzaXZlKSB7XHJcblx0Ly8gRG8gbm90aGluZ1xyXG59O1xyXG5cclxuUHJvbWlzZUZldGNoZXJBZGFwdGVyRmV0Y2hIYW5kbGUucHJvdG90eXBlLm9uID0gZnVuY3Rpb24gb24oZXZlbnQsIGxpc3RlbmVyKSB7XHJcblx0aWYgKGV2ZW50ICE9PSAndGVybWluYXRlZCcpIHtcclxuXHRcdHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IEZldGNoSGFuZGxlLm9uIHdpdGggdW5zdXBwb3J0ZWQgZXZlbnQgJyArIGV2ZW50ICsgJy4gT25seSB0ZXJtaW5hdGVkIGV2ZW50IGlzIHN1cHBvcnRlZCc7XHJcblx0fVxyXG5cdHRoaXMuX3Rlcm1pbmF0ZWRMaXN0ZW5lcnMucHVzaChsaXN0ZW5lcik7XHJcbn07XHJcblxyXG5Qcm9taXNlRmV0Y2hlckFkYXB0ZXJGZXRjaEhhbmRsZS5wcm90b3R5cGUucmVzdW1lID0gZnVuY3Rpb24gcmVzdW1lKCkge1xyXG5cdGlmICh0aGlzLl9pc1Rlcm1pbmF0ZWQpIHtcclxuXHRcdHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IGNhbm5vdCByZXN1bWUgc3RvcHBlZCBGZXRjaEhhbmRsZSc7XHJcblx0fVxyXG59O1xyXG5cclxuUHJvbWlzZUZldGNoZXJBZGFwdGVyRmV0Y2hIYW5kbGUucHJvdG90eXBlLmRpc3Bvc2UgPSBmdW5jdGlvbiBkaXNwb3NlKCkge1xyXG5cdGlmICghdGhpcy5faXNUZXJtaW5hdGVkKSB7XHJcblx0XHR0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBjYW5ub3QgZGlzcG9zZSBub24tdGVybWluYXRlZCBGZXRjaEhhbmRsZSc7XHJcblx0fVxyXG5cdGlmICh0aGlzLl9pc0Rpc3Bvc2VkKSB7XHJcblx0XHR0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBGZXRjaEhhbmRsZSBkb3VibGUgZGlzcG9zZSc7XHJcblx0fVxyXG5cdHRoaXMuX2lzRGlzcG9zZWQgPSB0cnVlO1xyXG59O1xyXG4iXX0=
