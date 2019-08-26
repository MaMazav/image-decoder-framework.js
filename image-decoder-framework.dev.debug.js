(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.resourceScheduler = f()}})(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
'use strict';

var LifoScheduler = (function LifoSchedulerClosure() {
    function LifoScheduler(createResource, jobsLimit) {
        this._resourceCreator = createResource;
        this._jobsLimit = jobsLimit;
        this._freeResourcesCount = this._jobsLimit;
        this._freeResources = new Array(this._jobsLimit);
        this._pendingJobs = [];
    }
    
    LifoScheduler.prototype.enqueueJob = function enqueueJob(jobFunc, jobContext) {
        if (this._freeResourcesCount > 0) {
            --this._freeResourcesCount;
            
            var resource = this._freeResources.pop();
            if (resource === undefined) {
                resource = this._resourceCreator();
            }
            
            this._schedule(jobFunc, resource, jobContext);
        } else {
            this._pendingJobs.push({
                jobFunc: jobFunc,
                jobContext: jobContext
                });
        }
    };
    
    LifoScheduler.prototype.shouldAbort = function shouldAbort(jobContext) {
        return false;
    };
    
    LifoScheduler.prototype._schedule = function schedule(jobFunc, resource, jobContext) {
        var callbacks = new LifoSchedulerCallbacks(this, resource);
        jobFunc(resource, jobContext, callbacks);
    };
    
    function LifoSchedulerCallbacks(scheduler, resource) {
        this._scheduler = scheduler;
        this._resource = resource;
    }
    
    LifoSchedulerCallbacks.prototype.jobDone = function jobDone() {
        if (this._scheduler._pendingJobs.length > 0) {
            var nextJob = this._scheduler._pendingJobs.pop();
            this._scheduler._schedule(nextJob.jobFunc, this._resource, nextJob.jobContext);
        } else {
            this._scheduler._freeResources.push(this._resource);
            ++this._scheduler._freeResourcesCount;
        }
    };
    
    LifoSchedulerCallbacks.prototype.shouldYieldOrAbort = function shouldYieldOrAbort() {
        return false;
    };
    
    LifoSchedulerCallbacks.prototype.tryYield = function tryYield() {
        return false;
    };
    
    return LifoScheduler;
})();

module.exports = LifoScheduler;
},{}],2:[function(require,module,exports){
'use strict';

var LinkedList = (function LinkedListClosure() {
    function LinkedList() {
        this.clear();
    }
    
    LinkedList.prototype.clear = function clear() {
        this._first = { _prev: null, _parent: this };
        this._last = { _next: null, _parent: this };
        this._count = 0;
        
        this._last._prev = this._first;
        this._first._next = this._last;
    };
    
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
    
    LinkedList.prototype.getFromIterator = function getFromIterator(iterator) {
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

module.exports = LinkedList;
},{}],3:[function(require,module,exports){
'use strict';

var LinkedList = require('linked-list');

var PriorityScheduler = (function PrioritySchedulerClosure() {
    function PriorityScheduler(
        createResource, jobsLimit, prioritizer, options) {
        
        options = options || {};
        this._resourceCreator = createResource;
        this._jobsLimit = jobsLimit;
        this._prioritizer = prioritizer;
        
        this._showLog = options.showLog;
        this._schedulerName = options.schedulerName;
        this._numNewJobs = options.numNewJobs || 20;
        this._numJobsBeforeRerankOldPriorities =
            options.numJobsBeforeRerankOldPriorities || 20;
            
        this._freeResourcesCount = this._jobsLimit;
        this._freeResources = new Array(this._jobsLimit);
        
        this._resourcesGuaranteedForHighPriority =
            options.resourcesGuaranteedForHighPriority || 0;
        this._highPriorityToGuaranteeResource =
            options.highPriorityToGuaranteeResource || 0;
        
        this._logCallIndentPrefix = '>';
        this._pendingJobsCount = 0;
        this._oldPendingJobsByPriority = [];
        this._newPendingJobsLinkedList = new LinkedList();
        
        this._schedulesCounter = 0;
    }
    
    PriorityScheduler.prototype.enqueueJob = function enqueueJob(jobFunc, jobContext, jobAbortedFunc) {
        log(this, 'enqueueJob() start', +1);
        var priority = this._prioritizer.getPriority(jobContext);
        
        if (priority < 0) {
            jobAbortedFunc(jobContext);
            log(this, 'enqueueJob() end: job aborted', -1);
            return;
        }
        
        var job = {
            jobFunc: jobFunc,
            jobAbortedFunc: jobAbortedFunc,
            jobContext: jobContext
        };
        
        var minPriority = getMinimalPriorityToSchedule(this);
        
        var resource = null;
        if (priority >= minPriority) {
            resource = tryGetFreeResource(this);
        }
        
        if (resource !== null) {
            schedule(this, job, resource);
            log(this, 'enqueueJob() end: job scheduled', -1);
            return;
        }
        
        enqueueNewJob(this, job, priority);
        ensurePendingJobsCount(this);
        log(this, 'enqueueJob() end: job pending', -1);
    };
    
    PriorityScheduler.prototype.shouldAbort = function shouldAbort(jobContext) {
        log(this, 'enqueueJob() start', +1);
        var priority = this._prioritizer.getPriority(jobContext);
        log(this, 'enqueueJob() end', -1);
        return priority < 0;
    };

    function jobDoneInternal(self, resource, jobContext) {
        if (self._showLog) {
            var priority = self._prioritizer.getPriority(jobContext);
            log(self, 'jobDone() start: job done of priority ' + priority, +1);
        }
        
        resourceFreed(self, resource);
        ensurePendingJobsCount(self);
        log(self, 'jobDone() end', -1);
    }
    
    function shouldYieldOrAbortInternal(self, jobContext) {
        log(self, 'shouldYieldOrAbort() start', +1);
        var priority = self._prioritizer.getPriority(jobContext);
        var result = (priority < 0) || hasNewJobWithHigherPriority(self, priority);
        log(self, 'shouldYieldOrAbort() end', -1);
        return result;
    }
    
    function tryYieldInternal(
        self, jobContinueFunc, jobContext, jobAbortedFunc, jobYieldedFunc, resource) {
        
        log(self, 'tryYield() start', +1);
        var priority = self._prioritizer.getPriority(jobContext);
        if (priority < 0) {
            jobAbortedFunc(jobContext);
            resourceFreed(self, resource);
            log(self, 'tryYield() end: job aborted', -1);
            return true;
        }
            
        var higherPriorityJob = tryDequeueNewJobWithHigherPriority(
            self, priority);
        ensurePendingJobsCount(self);
        
        if (higherPriorityJob === null) {
            log(self, 'tryYield() end: job continues', -1);
            return false;
        }
        
        jobYieldedFunc(jobContext);

        var job = {
            jobFunc: jobContinueFunc,
            jobAbortedFunc: jobAbortedFunc,
            jobContext: jobContext
            };
            
        enqueueNewJob(self, job, priority);
        ensurePendingJobsCount(self);

        schedule(self, higherPriorityJob, resource);
        ensurePendingJobsCount(self);
        
        log(self, 'tryYield() end: job yielded', -1);
        return true;
    }
    
    function hasNewJobWithHigherPriority(self, lowPriority) {
        var currentNode = self._newPendingJobsLinkedList.getFirstIterator();
        
        log(self, 'hasNewJobWithHigherPriority() start', +1);
        
        while (currentNode !== null) {
            var nextNode = self._newPendingJobsLinkedList.getNextIterator(
                currentNode);
                
            var job = self._newPendingJobsLinkedList.getFromIterator(currentNode);
            var priority = self._prioritizer.getPriority(job.jobContext);
            
            if (priority < 0) {
                extractJobFromLinkedList(self, currentNode);
                --self._pendingJobsCount;
                
                job.jobAbortedFunc(job.jobContext);
                currentNode = nextNode;
                continue;
            }
            
            if (priority > lowPriority) {
                log(self, 'hasNewJobWithHigherPriority() end: returns true', -1);
                return true;
            }
            
            currentNode = nextNode;
        }
        
        log(self, 'hasNewJobWithHigherPriority() end: returns false', -1);
        return false;
    }
    
    function tryDequeueNewJobWithHigherPriority(self, lowPriority) {
        log(self, 'tryDequeueNewJobWithHigherPriority() start', +1);
        var jobToScheduleNode = null;
        var highestPriorityFound = lowPriority;
        var countedPriorities = [];

        var currentNode = self._newPendingJobsLinkedList.getFirstIterator();
        
        while (currentNode !== null) {
            var nextNode = self._newPendingJobsLinkedList.getNextIterator(
                currentNode);
                
            var job = self._newPendingJobsLinkedList.getFromIterator(currentNode);
            var priority = self._prioritizer.getPriority(job.jobContext);
            
            if (priority < 0) {
                extractJobFromLinkedList(self, currentNode);
                --self._pendingJobsCount;
                
                job.jobAbortedFunc(job.jobContext);
                currentNode = nextNode;
                continue;
            }
            
            if (highestPriorityFound === undefined ||
                priority > highestPriorityFound) {
                
                highestPriorityFound = priority;
                jobToScheduleNode = currentNode;
            }
            
            if (!self._showLog) {
                currentNode = nextNode;
                continue;
            }
            
            if (countedPriorities[priority] === undefined) {
                countedPriorities[priority] = 1;
            } else {
                ++countedPriorities[priority];
            }
            
            currentNode = nextNode;
        }
        
        var jobToSchedule = null;
        if (jobToScheduleNode !== null) {
            jobToSchedule = extractJobFromLinkedList(self, jobToScheduleNode);
            --self._pendingJobsCount;
        }
        
        if (self._showLog) {
            var jobsListMessage = 'tryDequeueNewJobWithHigherPriority(): Jobs list:';

            for (var i = 0; i < countedPriorities.length; ++i) {
                if (countedPriorities[i] !== undefined) {
                    jobsListMessage += countedPriorities[i] + ' jobs of priority ' + i + ';';
                }
            }
            
            log(self, jobsListMessage);

            if (jobToSchedule !== null) {
                log(self, 'tryDequeueNewJobWithHigherPriority(): dequeued new job of priority ' + highestPriorityFound);
            }
        }
        
        ensurePendingJobsCount(self);
        
        log(self, 'tryDequeueNewJobWithHigherPriority() end', -1);
        return jobToSchedule;
    }
    
    function tryGetFreeResource(self) {
        log(self, 'tryGetFreeResource() start', +1);
        if (self._freeResourcesCount === 0) {
            return null;
        }
        --self._freeResourcesCount;
        var resource = self._freeResources.pop();
        
        if (resource === undefined) {
            resource = self._resourceCreator();
        }
        
        ensurePendingJobsCount(self);
        
        log(self, 'tryGetFreeResource() end', -1);
        return resource;
    }
    
    function enqueueNewJob(self, job, priority) {
        log(self, 'enqueueNewJob() start', +1);
        ++self._pendingJobsCount;
        
        var firstIterator = self._newPendingJobsLinkedList.getFirstIterator();
        addJobToLinkedList(self, job, firstIterator);
        
        if (self._showLog) {
            log(self, 'enqueueNewJob(): enqueued job of priority ' + priority);
        }
        
        if (self._newPendingJobsLinkedList.getCount() <= self._numNewJobs) {
            ensurePendingJobsCount(self);
            log(self, 'enqueueNewJob() end: _newPendingJobsLinkedList is small enough', -1);
            return;
        }
        
        var lastIterator = self._newPendingJobsLinkedList.getLastIterator();
        var oldJob = extractJobFromLinkedList(self, lastIterator);
        enqueueOldJob(self, oldJob);
        ensurePendingJobsCount(self);
        log(self, 'enqueueNewJob() end: One job moved from new job list to old job list', -1);
    }
    
    function enqueueOldJob(self, job) {
        log(self, 'enqueueOldJob() start', +1);
        var priority = self._prioritizer.getPriority(job.jobContext);
        
        if (priority < 0) {
            --self._pendingJobsCount;
            job.jobAbortedFunc(job.jobContext);
            log(self, 'enqueueOldJob() end: job aborted', -1);
            return;
        }
        
        if (self._oldPendingJobsByPriority[priority] === undefined) {
            self._oldPendingJobsByPriority[priority] = [];
        }
        
        self._oldPendingJobsByPriority[priority].push(job);
        log(self, 'enqueueOldJob() end: job enqueued to old job list', -1);
    }
    
    function rerankPriorities(self) {
        log(self, 'rerankPriorities() start', +1);
        var originalOldsArray = self._oldPendingJobsByPriority;
        var originalNewsList = self._newPendingJobsLinkedList;
        
        if (originalOldsArray.length === 0) {
            log(self, 'rerankPriorities() end: no need to rerank', -1);
            return;
        }
        
        self._oldPendingJobsByPriority = [];
        self._newPendingJobsLinkedList = new LinkedList();
        
        for (var i = 0; i < originalOldsArray.length; ++i) {
            if (originalOldsArray[i] === undefined) {
                continue;
            }
            
            for (var j = 0; j < originalOldsArray[i].length; ++j) {
                enqueueOldJob(self, originalOldsArray[i][j]);
            }
        }
        
        var iterator = originalNewsList.getFirstIterator();
        while (iterator !== null) {
            var value = originalNewsList.getFromIterator(iterator);
            enqueueOldJob(self, value);
            
            iterator = originalNewsList.getNextIterator(iterator);
        }
        
        var message = 'rerankPriorities(): ';
        
        for (var k = self._oldPendingJobsByPriority.length - 1; k >= 0; --k) {
            var highPriorityJobs = self._oldPendingJobsByPriority[k];
            if (highPriorityJobs === undefined) {
                continue;
            }
            
            if (self._showLog) {
                message += highPriorityJobs.length + ' jobs in priority ' + k + ';';
            }
            
            while (highPriorityJobs.length > 0 &&
                    self._newPendingJobsLinkedList.getCount() < self._numNewJobs) {
                    
                var job = highPriorityJobs.pop();
                addJobToLinkedList(self, job);
            }
            
            if (self._newPendingJobsLinkedList.getCount() >= self._numNewJobs &&
                !self._showLog) {
                break;
            }
        }
        
        if (self._showLog) {
            log(self, message);
        }
        
        ensurePendingJobsCount(self);
        log(self, 'rerankPriorities() end: rerank done', -1);
    }
    
    function resourceFreed(self, resource) {
        log(self, 'resourceFreed() start', +1);
        ++self._freeResourcesCount;
        var minPriority = getMinimalPriorityToSchedule(self);
        --self._freeResourcesCount;
        
        var job = tryDequeueNewJobWithHigherPriority(self, minPriority - 1);

        if (job !== null) {
            ensurePendingJobsCount(self);
            schedule(self, job, resource);
            ensurePendingJobsCount(self);
            
            log(self, 'resourceFreed() end: new job scheduled', -1);
            return;
        }
        
        var hasOldJobs =
            self._pendingJobsCount > self._newPendingJobsLinkedList.getCount();
            
        if (!hasOldJobs) {
            self._freeResources.push(resource);
            ++self._freeResourcesCount;
            
            ensurePendingJobsCount(self);
            log(self, 'resourceFreed() end: no job to schedule', -1);
            return;
        }
        
        var numPriorities = self._oldPendingJobsByPriority.length;
        var jobPriority;
        
        for (var priority = numPriorities - 1; priority >= 0; --priority) {
            var jobs = self._oldPendingJobsByPriority[priority];
            if (jobs === undefined || jobs.length === 0) {
                continue;
            }
            
            for (var i = jobs.length - 1; i >= 0; --i) {
                job = jobs[i];
                jobPriority = self._prioritizer.getPriority(job.jobContext);
                if (jobPriority >= priority) {
                    jobs.length = i;
                    break;
                } else if (jobPriority < 0) {
                    --self._pendingJobsCount;
                    job.jobAbortedFunc(job.jobContext);
                } else {
                    if (self._oldPendingJobsByPriority[jobPriority] === undefined) {
                        self._oldPendingJobsByPriority[jobPriority] = [];
                    }
                    
                    self._oldPendingJobsByPriority[jobPriority].push(job);
                }
                
                job = null;
            }
            
            if (job !== null) {
                break;
            }
            
            jobs.length = 0;
        }
        
        if (job === null) {
            self._freeResources.push(resource);
            ++self._freeResourcesCount;
            
            ensurePendingJobsCount(self);
            
            log(self, 'resourceFreed() end: no non-aborted job to schedule', -1);
            return;
        }
        
        if (self._showLog) {
            log(self, 'resourceFreed(): dequeued old job of priority ' + jobPriority);
        }
        
        --self._pendingJobsCount;
        
        ensurePendingJobsCount(self);
        schedule(self, job, resource);
        ensurePendingJobsCount(self);
        log(self, 'resourceFreed() end: job scheduled', -1);
    }
    
    function schedule(self, job, resource) {
        log(self, 'schedule() start', +1);
        ++self._schedulesCounter;
        
        if (self._schedulesCounter >= self._numJobsBeforeRerankOldPriorities) {
            self._schedulesCounter = 0;
            rerankPriorities(self);
        }
        
        if (self._showLog) {
            var priority = self._prioritizer.getPriority(job.jobContext);
            log(self, 'schedule(): scheduled job of priority ' + priority);
        }
        
        var callbacks = new PrioritySchedulerCallbacks(self, resource, job.jobContext);
        
        job.jobFunc(resource, job.jobContext, callbacks);
        log(self, 'schedule() end', -1);
    }
    
    function addJobToLinkedList(self, job, addBefore) {
        log(self, 'addJobToLinkedList() start', +1);
        self._newPendingJobsLinkedList.add(job, addBefore);
        ensureNumberOfNodes(self);
        log(self, 'addJobToLinkedList() end', -1);
    }
    
    function extractJobFromLinkedList(self, iterator) {
        log(self, 'extractJobFromLinkedList() start', +1);
        var value = self._newPendingJobsLinkedList.getFromIterator(iterator);
        self._newPendingJobsLinkedList.remove(iterator);
        ensureNumberOfNodes(self);
        
        log(self, 'extractJobFromLinkedList() end', -1);
        return value;
    }
    
    function ensureNumberOfNodes(self) {
        if (!self._showLog) {
            return;
        }
        
        log(self, 'ensureNumberOfNodes() start', +1);
        var iterator = self._newPendingJobsLinkedList.getFirstIterator();
        var expectedCount = 0;
        while (iterator !== null) {
            ++expectedCount;
            iterator = self._newPendingJobsLinkedList.getNextIterator(iterator);
        }
        
        if (expectedCount !== self._newPendingJobsLinkedList.getCount()) {
            throw 'Unexpected count of new jobs';
        }
        log(self, 'ensureNumberOfNodes() end', -1);
    }
    
    function ensurePendingJobsCount(self) {
        if (!self._showLog) {
            return;
        }
        
        log(self, 'ensurePendingJobsCount() start', +1);
        var oldJobsCount = 0;
        for (var i = 0; i < self._oldPendingJobsByPriority.length; ++i) {
            var jobs = self._oldPendingJobsByPriority[i];
            if (jobs !== undefined) {
                oldJobsCount += jobs.length;
            }
        }
        
        var expectedCount =
            oldJobsCount + self._newPendingJobsLinkedList.getCount();
            
        if (expectedCount !== self._pendingJobsCount) {
            throw 'Unexpected count of jobs';
        }
        log(self, 'ensurePendingJobsCount() end', -1);
    }
    
    function getMinimalPriorityToSchedule(self) {
        log(self, 'getMinimalPriorityToSchedule() start', +1);
        if (self._freeResourcesCount <= self._resourcesGuaranteedForHighPriority) {
            log(self, 'getMinimalPriorityToSchedule() end: guarantee resource for high priority is needed', -1);
            return self._highPriorityToGuaranteeResources;
        }
        
        log(self, 'getMinimalPriorityToSchedule() end: enough resources, no need to guarantee resource for high priority', -1);
        return 0;
    }
    
    function log(self, msg, addIndent) {
        if (!self._showLog) {
            return;
        }
        
        if (addIndent === -1) {
            self._logCallIndentPrefix = self._logCallIndentPrefix.substr(1);
        }
        
        if (self._schedulerName !== undefined) {
            /* global console: false */
            console.log(self._logCallIndentPrefix + 'PriorityScheduler ' + self._schedulerName + ': ' + msg);
        } else {
            /* global console: false */
            console.log(self._logCallIndentPrefix + 'PriorityScheduler: ' + msg);
        }
    
        if (addIndent === 1) {
            self._logCallIndentPrefix += '>';
        }
    }
    
    function PrioritySchedulerCallbacks(scheduler, resource, context) {
        this._isValid = true;
        this._scheduler = scheduler;
        this._resource = resource;
        this._context = context;
    }
    
    PrioritySchedulerCallbacks.prototype._checkValidity = function checkValidity() {
        if (!this._isValid) {
            throw 'ResourceScheduler error: Already terminated job';
        }
    };
    
    PrioritySchedulerCallbacks.prototype._clearValidity = function() {
        this._isValid = false;
        this._resource = null;
        this._context = null;
        this._scheduler = null;
    };
    
    PrioritySchedulerCallbacks.prototype.jobDone = function jobDone() {
        this._checkValidity();
        jobDoneInternal(this._scheduler, this._resource, this._context);
        this._clearValidity();
    };
    
    PrioritySchedulerCallbacks.prototype.shouldYieldOrAbort = function() {
        this._checkValidity();
        return shouldYieldOrAbortInternal(this._scheduler, this._context);
    };
    
    PrioritySchedulerCallbacks.prototype.tryYield = function tryYield(jobContinueFunc, jobAbortedFunc, jobYieldedFunc) {
        this._checkValidity();
        var isYielded = tryYieldInternal(
            this._scheduler, jobContinueFunc, this._context, jobAbortedFunc, jobYieldedFunc, this._resource);
        if (isYielded) {
            this._clearValidity();
        }
        return isYielded;
    };

    return PriorityScheduler;
})();

module.exports = PriorityScheduler;
},{"linked-list":2}],4:[function(require,module,exports){
'use strict';

module.exports.PriorityScheduler = require('priority-scheduler');
module.exports.LifoScheduler = require('lifo-scheduler');

},{"lifo-scheduler":1,"priority-scheduler":3}]},{},[4])(4)
});
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJzcmMvbGlmby1zY2hlZHVsZXIuanMiLCJzcmMvbGlua2VkLWxpc3QuanMiLCJzcmMvcHJpb3JpdHktc2NoZWR1bGVyLmpzIiwic3JjL3Jlc291cmNlLXNjaGVkdWxlci1leHBvcnRzLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBO0FDQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNoRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbkdBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNobUJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EiLCJmaWxlIjoiZ2VuZXJhdGVkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXNDb250ZW50IjpbIihmdW5jdGlvbiBlKHQsbixyKXtmdW5jdGlvbiBzKG8sdSl7aWYoIW5bb10pe2lmKCF0W29dKXt2YXIgYT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2lmKCF1JiZhKXJldHVybiBhKG8sITApO2lmKGkpcmV0dXJuIGkobywhMCk7dmFyIGY9bmV3IEVycm9yKFwiQ2Fubm90IGZpbmQgbW9kdWxlICdcIitvK1wiJ1wiKTt0aHJvdyBmLmNvZGU9XCJNT0RVTEVfTk9UX0ZPVU5EXCIsZn12YXIgbD1uW29dPXtleHBvcnRzOnt9fTt0W29dWzBdLmNhbGwobC5leHBvcnRzLGZ1bmN0aW9uKGUpe3ZhciBuPXRbb11bMV1bZV07cmV0dXJuIHMobj9uOmUpfSxsLGwuZXhwb3J0cyxlLHQsbixyKX1yZXR1cm4gbltvXS5leHBvcnRzfXZhciBpPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7Zm9yKHZhciBvPTA7bzxyLmxlbmd0aDtvKyspcyhyW29dKTtyZXR1cm4gc30pIiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxudmFyIExpZm9TY2hlZHVsZXIgPSAoZnVuY3Rpb24gTGlmb1NjaGVkdWxlckNsb3N1cmUoKSB7XHJcbiAgICBmdW5jdGlvbiBMaWZvU2NoZWR1bGVyKGNyZWF0ZVJlc291cmNlLCBqb2JzTGltaXQpIHtcclxuICAgICAgICB0aGlzLl9yZXNvdXJjZUNyZWF0b3IgPSBjcmVhdGVSZXNvdXJjZTtcclxuICAgICAgICB0aGlzLl9qb2JzTGltaXQgPSBqb2JzTGltaXQ7XHJcbiAgICAgICAgdGhpcy5fZnJlZVJlc291cmNlc0NvdW50ID0gdGhpcy5fam9ic0xpbWl0O1xyXG4gICAgICAgIHRoaXMuX2ZyZWVSZXNvdXJjZXMgPSBuZXcgQXJyYXkodGhpcy5fam9ic0xpbWl0KTtcclxuICAgICAgICB0aGlzLl9wZW5kaW5nSm9icyA9IFtdO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBMaWZvU2NoZWR1bGVyLnByb3RvdHlwZS5lbnF1ZXVlSm9iID0gZnVuY3Rpb24gZW5xdWV1ZUpvYihqb2JGdW5jLCBqb2JDb250ZXh0KSB7XHJcbiAgICAgICAgaWYgKHRoaXMuX2ZyZWVSZXNvdXJjZXNDb3VudCA+IDApIHtcclxuICAgICAgICAgICAgLS10aGlzLl9mcmVlUmVzb3VyY2VzQ291bnQ7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICB2YXIgcmVzb3VyY2UgPSB0aGlzLl9mcmVlUmVzb3VyY2VzLnBvcCgpO1xyXG4gICAgICAgICAgICBpZiAocmVzb3VyY2UgPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgICAgICAgICAgcmVzb3VyY2UgPSB0aGlzLl9yZXNvdXJjZUNyZWF0b3IoKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgdGhpcy5fc2NoZWR1bGUoam9iRnVuYywgcmVzb3VyY2UsIGpvYkNvbnRleHQpO1xyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgIHRoaXMuX3BlbmRpbmdKb2JzLnB1c2goe1xyXG4gICAgICAgICAgICAgICAgam9iRnVuYzogam9iRnVuYyxcclxuICAgICAgICAgICAgICAgIGpvYkNvbnRleHQ6IGpvYkNvbnRleHRcclxuICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgIH1cclxuICAgIH07XHJcbiAgICBcclxuICAgIExpZm9TY2hlZHVsZXIucHJvdG90eXBlLnNob3VsZEFib3J0ID0gZnVuY3Rpb24gc2hvdWxkQWJvcnQoam9iQ29udGV4dCkge1xyXG4gICAgICAgIHJldHVybiBmYWxzZTtcclxuICAgIH07XHJcbiAgICBcclxuICAgIExpZm9TY2hlZHVsZXIucHJvdG90eXBlLl9zY2hlZHVsZSA9IGZ1bmN0aW9uIHNjaGVkdWxlKGpvYkZ1bmMsIHJlc291cmNlLCBqb2JDb250ZXh0KSB7XHJcbiAgICAgICAgdmFyIGNhbGxiYWNrcyA9IG5ldyBMaWZvU2NoZWR1bGVyQ2FsbGJhY2tzKHRoaXMsIHJlc291cmNlKTtcclxuICAgICAgICBqb2JGdW5jKHJlc291cmNlLCBqb2JDb250ZXh0LCBjYWxsYmFja3MpO1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgZnVuY3Rpb24gTGlmb1NjaGVkdWxlckNhbGxiYWNrcyhzY2hlZHVsZXIsIHJlc291cmNlKSB7XHJcbiAgICAgICAgdGhpcy5fc2NoZWR1bGVyID0gc2NoZWR1bGVyO1xyXG4gICAgICAgIHRoaXMuX3Jlc291cmNlID0gcmVzb3VyY2U7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIExpZm9TY2hlZHVsZXJDYWxsYmFja3MucHJvdG90eXBlLmpvYkRvbmUgPSBmdW5jdGlvbiBqb2JEb25lKCkge1xyXG4gICAgICAgIGlmICh0aGlzLl9zY2hlZHVsZXIuX3BlbmRpbmdKb2JzLmxlbmd0aCA+IDApIHtcclxuICAgICAgICAgICAgdmFyIG5leHRKb2IgPSB0aGlzLl9zY2hlZHVsZXIuX3BlbmRpbmdKb2JzLnBvcCgpO1xyXG4gICAgICAgICAgICB0aGlzLl9zY2hlZHVsZXIuX3NjaGVkdWxlKG5leHRKb2Iuam9iRnVuYywgdGhpcy5fcmVzb3VyY2UsIG5leHRKb2Iuam9iQ29udGV4dCk7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgdGhpcy5fc2NoZWR1bGVyLl9mcmVlUmVzb3VyY2VzLnB1c2godGhpcy5fcmVzb3VyY2UpO1xyXG4gICAgICAgICAgICArK3RoaXMuX3NjaGVkdWxlci5fZnJlZVJlc291cmNlc0NvdW50O1xyXG4gICAgICAgIH1cclxuICAgIH07XHJcbiAgICBcclxuICAgIExpZm9TY2hlZHVsZXJDYWxsYmFja3MucHJvdG90eXBlLnNob3VsZFlpZWxkT3JBYm9ydCA9IGZ1bmN0aW9uIHNob3VsZFlpZWxkT3JBYm9ydCgpIHtcclxuICAgICAgICByZXR1cm4gZmFsc2U7XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBMaWZvU2NoZWR1bGVyQ2FsbGJhY2tzLnByb3RvdHlwZS50cnlZaWVsZCA9IGZ1bmN0aW9uIHRyeVlpZWxkKCkge1xyXG4gICAgICAgIHJldHVybiBmYWxzZTtcclxuICAgIH07XHJcbiAgICBcclxuICAgIHJldHVybiBMaWZvU2NoZWR1bGVyO1xyXG59KSgpO1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBMaWZvU2NoZWR1bGVyOyIsIid1c2Ugc3RyaWN0JztcclxuXHJcbnZhciBMaW5rZWRMaXN0ID0gKGZ1bmN0aW9uIExpbmtlZExpc3RDbG9zdXJlKCkge1xyXG4gICAgZnVuY3Rpb24gTGlua2VkTGlzdCgpIHtcclxuICAgICAgICB0aGlzLmNsZWFyKCk7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIExpbmtlZExpc3QucHJvdG90eXBlLmNsZWFyID0gZnVuY3Rpb24gY2xlYXIoKSB7XHJcbiAgICAgICAgdGhpcy5fZmlyc3QgPSB7IF9wcmV2OiBudWxsLCBfcGFyZW50OiB0aGlzIH07XHJcbiAgICAgICAgdGhpcy5fbGFzdCA9IHsgX25leHQ6IG51bGwsIF9wYXJlbnQ6IHRoaXMgfTtcclxuICAgICAgICB0aGlzLl9jb3VudCA9IDA7XHJcbiAgICAgICAgXHJcbiAgICAgICAgdGhpcy5fbGFzdC5fcHJldiA9IHRoaXMuX2ZpcnN0O1xyXG4gICAgICAgIHRoaXMuX2ZpcnN0Ll9uZXh0ID0gdGhpcy5fbGFzdDtcclxuICAgIH07XHJcbiAgICBcclxuICAgIExpbmtlZExpc3QucHJvdG90eXBlLmFkZCA9IGZ1bmN0aW9uIGFkZCh2YWx1ZSwgYWRkQmVmb3JlKSB7XHJcbiAgICAgICAgaWYgKGFkZEJlZm9yZSA9PT0gbnVsbCB8fCBhZGRCZWZvcmUgPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgICAgICBhZGRCZWZvcmUgPSB0aGlzLl9sYXN0O1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICB0aGlzLl92YWxpZGF0ZUl0ZXJhdG9yT2ZUaGlzKGFkZEJlZm9yZSk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgKyt0aGlzLl9jb3VudDtcclxuICAgICAgICBcclxuICAgICAgICB2YXIgbmV3Tm9kZSA9IHtcclxuICAgICAgICAgICAgX3ZhbHVlOiB2YWx1ZSxcclxuICAgICAgICAgICAgX25leHQ6IGFkZEJlZm9yZSxcclxuICAgICAgICAgICAgX3ByZXY6IGFkZEJlZm9yZS5fcHJldixcclxuICAgICAgICAgICAgX3BhcmVudDogdGhpc1xyXG4gICAgICAgIH07XHJcbiAgICAgICAgXHJcbiAgICAgICAgbmV3Tm9kZS5fcHJldi5fbmV4dCA9IG5ld05vZGU7XHJcbiAgICAgICAgYWRkQmVmb3JlLl9wcmV2ID0gbmV3Tm9kZTtcclxuICAgICAgICBcclxuICAgICAgICByZXR1cm4gbmV3Tm9kZTtcclxuICAgIH07XHJcbiAgICBcclxuICAgIExpbmtlZExpc3QucHJvdG90eXBlLnJlbW92ZSA9IGZ1bmN0aW9uIHJlbW92ZShpdGVyYXRvcikge1xyXG4gICAgICAgIHRoaXMuX3ZhbGlkYXRlSXRlcmF0b3JPZlRoaXMoaXRlcmF0b3IpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC0tdGhpcy5fY291bnQ7XHJcbiAgICAgICAgXHJcbiAgICAgICAgaXRlcmF0b3IuX3ByZXYuX25leHQgPSBpdGVyYXRvci5fbmV4dDtcclxuICAgICAgICBpdGVyYXRvci5fbmV4dC5fcHJldiA9IGl0ZXJhdG9yLl9wcmV2O1xyXG4gICAgICAgIGl0ZXJhdG9yLl9wYXJlbnQgPSBudWxsO1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgTGlua2VkTGlzdC5wcm90b3R5cGUuZ2V0RnJvbUl0ZXJhdG9yID0gZnVuY3Rpb24gZ2V0RnJvbUl0ZXJhdG9yKGl0ZXJhdG9yKSB7XHJcbiAgICAgICAgdGhpcy5fdmFsaWRhdGVJdGVyYXRvck9mVGhpcyhpdGVyYXRvcik7XHJcbiAgICAgICAgXHJcbiAgICAgICAgcmV0dXJuIGl0ZXJhdG9yLl92YWx1ZTtcclxuICAgIH07XHJcbiAgICBcclxuICAgIExpbmtlZExpc3QucHJvdG90eXBlLmdldEZpcnN0SXRlcmF0b3IgPSBmdW5jdGlvbiBnZXRGaXJzdEl0ZXJhdG9yKCkge1xyXG4gICAgICAgIHZhciBpdGVyYXRvciA9IHRoaXMuZ2V0TmV4dEl0ZXJhdG9yKHRoaXMuX2ZpcnN0KTtcclxuICAgICAgICByZXR1cm4gaXRlcmF0b3I7XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBMaW5rZWRMaXN0LnByb3RvdHlwZS5nZXRMYXN0SXRlcmF0b3IgPSBmdW5jdGlvbiBnZXRGaXJzdEl0ZXJhdG9yKCkge1xyXG4gICAgICAgIHZhciBpdGVyYXRvciA9IHRoaXMuZ2V0UHJldkl0ZXJhdG9yKHRoaXMuX2xhc3QpO1xyXG4gICAgICAgIHJldHVybiBpdGVyYXRvcjtcclxuICAgIH07XHJcbiAgICBcclxuICAgIExpbmtlZExpc3QucHJvdG90eXBlLmdldE5leHRJdGVyYXRvciA9IGZ1bmN0aW9uIGdldE5leHRJdGVyYXRvcihpdGVyYXRvcikge1xyXG4gICAgICAgIHRoaXMuX3ZhbGlkYXRlSXRlcmF0b3JPZlRoaXMoaXRlcmF0b3IpO1xyXG5cclxuICAgICAgICBpZiAoaXRlcmF0b3IuX25leHQgPT09IHRoaXMuX2xhc3QpIHtcclxuICAgICAgICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHJldHVybiBpdGVyYXRvci5fbmV4dDtcclxuICAgIH07XHJcbiAgICBcclxuICAgIExpbmtlZExpc3QucHJvdG90eXBlLmdldFByZXZJdGVyYXRvciA9IGZ1bmN0aW9uIGdldFByZXZJdGVyYXRvcihpdGVyYXRvcikge1xyXG4gICAgICAgIHRoaXMuX3ZhbGlkYXRlSXRlcmF0b3JPZlRoaXMoaXRlcmF0b3IpO1xyXG5cclxuICAgICAgICBpZiAoaXRlcmF0b3IuX3ByZXYgPT09IHRoaXMuX2ZpcnN0KSB7XHJcbiAgICAgICAgICAgIHJldHVybiBudWxsO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICByZXR1cm4gaXRlcmF0b3IuX3ByZXY7XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBMaW5rZWRMaXN0LnByb3RvdHlwZS5nZXRDb3VudCA9IGZ1bmN0aW9uIGdldENvdW50KCkge1xyXG4gICAgICAgIHJldHVybiB0aGlzLl9jb3VudDtcclxuICAgIH07XHJcbiAgICBcclxuICAgIExpbmtlZExpc3QucHJvdG90eXBlLl92YWxpZGF0ZUl0ZXJhdG9yT2ZUaGlzID1cclxuICAgICAgICBmdW5jdGlvbiB2YWxpZGF0ZUl0ZXJhdG9yT2ZUaGlzKGl0ZXJhdG9yKSB7XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKGl0ZXJhdG9yLl9wYXJlbnQgIT09IHRoaXMpIHtcclxuICAgICAgICAgICAgdGhyb3cgJ2l0ZXJhdG9yIG11c3QgYmUgb2YgdGhlIGN1cnJlbnQgTGlua2VkTGlzdCc7XHJcbiAgICAgICAgfVxyXG4gICAgfTtcclxuICAgIFxyXG4gICAgcmV0dXJuIExpbmtlZExpc3Q7XHJcbn0pKCk7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IExpbmtlZExpc3Q7IiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxudmFyIExpbmtlZExpc3QgPSByZXF1aXJlKCdsaW5rZWQtbGlzdCcpO1xyXG5cclxudmFyIFByaW9yaXR5U2NoZWR1bGVyID0gKGZ1bmN0aW9uIFByaW9yaXR5U2NoZWR1bGVyQ2xvc3VyZSgpIHtcclxuICAgIGZ1bmN0aW9uIFByaW9yaXR5U2NoZWR1bGVyKFxyXG4gICAgICAgIGNyZWF0ZVJlc291cmNlLCBqb2JzTGltaXQsIHByaW9yaXRpemVyLCBvcHRpb25zKSB7XHJcbiAgICAgICAgXHJcbiAgICAgICAgb3B0aW9ucyA9IG9wdGlvbnMgfHwge307XHJcbiAgICAgICAgdGhpcy5fcmVzb3VyY2VDcmVhdG9yID0gY3JlYXRlUmVzb3VyY2U7XHJcbiAgICAgICAgdGhpcy5fam9ic0xpbWl0ID0gam9ic0xpbWl0O1xyXG4gICAgICAgIHRoaXMuX3ByaW9yaXRpemVyID0gcHJpb3JpdGl6ZXI7XHJcbiAgICAgICAgXHJcbiAgICAgICAgdGhpcy5fc2hvd0xvZyA9IG9wdGlvbnMuc2hvd0xvZztcclxuICAgICAgICB0aGlzLl9zY2hlZHVsZXJOYW1lID0gb3B0aW9ucy5zY2hlZHVsZXJOYW1lO1xyXG4gICAgICAgIHRoaXMuX251bU5ld0pvYnMgPSBvcHRpb25zLm51bU5ld0pvYnMgfHwgMjA7XHJcbiAgICAgICAgdGhpcy5fbnVtSm9ic0JlZm9yZVJlcmFua09sZFByaW9yaXRpZXMgPVxyXG4gICAgICAgICAgICBvcHRpb25zLm51bUpvYnNCZWZvcmVSZXJhbmtPbGRQcmlvcml0aWVzIHx8IDIwO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICB0aGlzLl9mcmVlUmVzb3VyY2VzQ291bnQgPSB0aGlzLl9qb2JzTGltaXQ7XHJcbiAgICAgICAgdGhpcy5fZnJlZVJlc291cmNlcyA9IG5ldyBBcnJheSh0aGlzLl9qb2JzTGltaXQpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHRoaXMuX3Jlc291cmNlc0d1YXJhbnRlZWRGb3JIaWdoUHJpb3JpdHkgPVxyXG4gICAgICAgICAgICBvcHRpb25zLnJlc291cmNlc0d1YXJhbnRlZWRGb3JIaWdoUHJpb3JpdHkgfHwgMDtcclxuICAgICAgICB0aGlzLl9oaWdoUHJpb3JpdHlUb0d1YXJhbnRlZVJlc291cmNlID1cclxuICAgICAgICAgICAgb3B0aW9ucy5oaWdoUHJpb3JpdHlUb0d1YXJhbnRlZVJlc291cmNlIHx8IDA7XHJcbiAgICAgICAgXHJcbiAgICAgICAgdGhpcy5fbG9nQ2FsbEluZGVudFByZWZpeCA9ICc+JztcclxuICAgICAgICB0aGlzLl9wZW5kaW5nSm9ic0NvdW50ID0gMDtcclxuICAgICAgICB0aGlzLl9vbGRQZW5kaW5nSm9ic0J5UHJpb3JpdHkgPSBbXTtcclxuICAgICAgICB0aGlzLl9uZXdQZW5kaW5nSm9ic0xpbmtlZExpc3QgPSBuZXcgTGlua2VkTGlzdCgpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHRoaXMuX3NjaGVkdWxlc0NvdW50ZXIgPSAwO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBQcmlvcml0eVNjaGVkdWxlci5wcm90b3R5cGUuZW5xdWV1ZUpvYiA9IGZ1bmN0aW9uIGVucXVldWVKb2Ioam9iRnVuYywgam9iQ29udGV4dCwgam9iQWJvcnRlZEZ1bmMpIHtcclxuICAgICAgICBsb2codGhpcywgJ2VucXVldWVKb2IoKSBzdGFydCcsICsxKTtcclxuICAgICAgICB2YXIgcHJpb3JpdHkgPSB0aGlzLl9wcmlvcml0aXplci5nZXRQcmlvcml0eShqb2JDb250ZXh0KTtcclxuICAgICAgICBcclxuICAgICAgICBpZiAocHJpb3JpdHkgPCAwKSB7XHJcbiAgICAgICAgICAgIGpvYkFib3J0ZWRGdW5jKGpvYkNvbnRleHQpO1xyXG4gICAgICAgICAgICBsb2codGhpcywgJ2VucXVldWVKb2IoKSBlbmQ6IGpvYiBhYm9ydGVkJywgLTEpO1xyXG4gICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHZhciBqb2IgPSB7XHJcbiAgICAgICAgICAgIGpvYkZ1bmM6IGpvYkZ1bmMsXHJcbiAgICAgICAgICAgIGpvYkFib3J0ZWRGdW5jOiBqb2JBYm9ydGVkRnVuYyxcclxuICAgICAgICAgICAgam9iQ29udGV4dDogam9iQ29udGV4dFxyXG4gICAgICAgIH07XHJcbiAgICAgICAgXHJcbiAgICAgICAgdmFyIG1pblByaW9yaXR5ID0gZ2V0TWluaW1hbFByaW9yaXR5VG9TY2hlZHVsZSh0aGlzKTtcclxuICAgICAgICBcclxuICAgICAgICB2YXIgcmVzb3VyY2UgPSBudWxsO1xyXG4gICAgICAgIGlmIChwcmlvcml0eSA+PSBtaW5Qcmlvcml0eSkge1xyXG4gICAgICAgICAgICByZXNvdXJjZSA9IHRyeUdldEZyZWVSZXNvdXJjZSh0aGlzKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKHJlc291cmNlICE9PSBudWxsKSB7XHJcbiAgICAgICAgICAgIHNjaGVkdWxlKHRoaXMsIGpvYiwgcmVzb3VyY2UpO1xyXG4gICAgICAgICAgICBsb2codGhpcywgJ2VucXVldWVKb2IoKSBlbmQ6IGpvYiBzY2hlZHVsZWQnLCAtMSk7XHJcbiAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgZW5xdWV1ZU5ld0pvYih0aGlzLCBqb2IsIHByaW9yaXR5KTtcclxuICAgICAgICBlbnN1cmVQZW5kaW5nSm9ic0NvdW50KHRoaXMpO1xyXG4gICAgICAgIGxvZyh0aGlzLCAnZW5xdWV1ZUpvYigpIGVuZDogam9iIHBlbmRpbmcnLCAtMSk7XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBQcmlvcml0eVNjaGVkdWxlci5wcm90b3R5cGUuc2hvdWxkQWJvcnQgPSBmdW5jdGlvbiBzaG91bGRBYm9ydChqb2JDb250ZXh0KSB7XHJcbiAgICAgICAgbG9nKHRoaXMsICdlbnF1ZXVlSm9iKCkgc3RhcnQnLCArMSk7XHJcbiAgICAgICAgdmFyIHByaW9yaXR5ID0gdGhpcy5fcHJpb3JpdGl6ZXIuZ2V0UHJpb3JpdHkoam9iQ29udGV4dCk7XHJcbiAgICAgICAgbG9nKHRoaXMsICdlbnF1ZXVlSm9iKCkgZW5kJywgLTEpO1xyXG4gICAgICAgIHJldHVybiBwcmlvcml0eSA8IDA7XHJcbiAgICB9O1xyXG5cclxuICAgIGZ1bmN0aW9uIGpvYkRvbmVJbnRlcm5hbChzZWxmLCByZXNvdXJjZSwgam9iQ29udGV4dCkge1xyXG4gICAgICAgIGlmIChzZWxmLl9zaG93TG9nKSB7XHJcbiAgICAgICAgICAgIHZhciBwcmlvcml0eSA9IHNlbGYuX3ByaW9yaXRpemVyLmdldFByaW9yaXR5KGpvYkNvbnRleHQpO1xyXG4gICAgICAgICAgICBsb2coc2VsZiwgJ2pvYkRvbmUoKSBzdGFydDogam9iIGRvbmUgb2YgcHJpb3JpdHkgJyArIHByaW9yaXR5LCArMSk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHJlc291cmNlRnJlZWQoc2VsZiwgcmVzb3VyY2UpO1xyXG4gICAgICAgIGVuc3VyZVBlbmRpbmdKb2JzQ291bnQoc2VsZik7XHJcbiAgICAgICAgbG9nKHNlbGYsICdqb2JEb25lKCkgZW5kJywgLTEpO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBmdW5jdGlvbiBzaG91bGRZaWVsZE9yQWJvcnRJbnRlcm5hbChzZWxmLCBqb2JDb250ZXh0KSB7XHJcbiAgICAgICAgbG9nKHNlbGYsICdzaG91bGRZaWVsZE9yQWJvcnQoKSBzdGFydCcsICsxKTtcclxuICAgICAgICB2YXIgcHJpb3JpdHkgPSBzZWxmLl9wcmlvcml0aXplci5nZXRQcmlvcml0eShqb2JDb250ZXh0KTtcclxuICAgICAgICB2YXIgcmVzdWx0ID0gKHByaW9yaXR5IDwgMCkgfHwgaGFzTmV3Sm9iV2l0aEhpZ2hlclByaW9yaXR5KHNlbGYsIHByaW9yaXR5KTtcclxuICAgICAgICBsb2coc2VsZiwgJ3Nob3VsZFlpZWxkT3JBYm9ydCgpIGVuZCcsIC0xKTtcclxuICAgICAgICByZXR1cm4gcmVzdWx0O1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBmdW5jdGlvbiB0cnlZaWVsZEludGVybmFsKFxyXG4gICAgICAgIHNlbGYsIGpvYkNvbnRpbnVlRnVuYywgam9iQ29udGV4dCwgam9iQWJvcnRlZEZ1bmMsIGpvYllpZWxkZWRGdW5jLCByZXNvdXJjZSkge1xyXG4gICAgICAgIFxyXG4gICAgICAgIGxvZyhzZWxmLCAndHJ5WWllbGQoKSBzdGFydCcsICsxKTtcclxuICAgICAgICB2YXIgcHJpb3JpdHkgPSBzZWxmLl9wcmlvcml0aXplci5nZXRQcmlvcml0eShqb2JDb250ZXh0KTtcclxuICAgICAgICBpZiAocHJpb3JpdHkgPCAwKSB7XHJcbiAgICAgICAgICAgIGpvYkFib3J0ZWRGdW5jKGpvYkNvbnRleHQpO1xyXG4gICAgICAgICAgICByZXNvdXJjZUZyZWVkKHNlbGYsIHJlc291cmNlKTtcclxuICAgICAgICAgICAgbG9nKHNlbGYsICd0cnlZaWVsZCgpIGVuZDogam9iIGFib3J0ZWQnLCAtMSk7XHJcbiAgICAgICAgICAgIHJldHVybiB0cnVlO1xyXG4gICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgdmFyIGhpZ2hlclByaW9yaXR5Sm9iID0gdHJ5RGVxdWV1ZU5ld0pvYldpdGhIaWdoZXJQcmlvcml0eShcclxuICAgICAgICAgICAgc2VsZiwgcHJpb3JpdHkpO1xyXG4gICAgICAgIGVuc3VyZVBlbmRpbmdKb2JzQ291bnQoc2VsZik7XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKGhpZ2hlclByaW9yaXR5Sm9iID09PSBudWxsKSB7XHJcbiAgICAgICAgICAgIGxvZyhzZWxmLCAndHJ5WWllbGQoKSBlbmQ6IGpvYiBjb250aW51ZXMnLCAtMSk7XHJcbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgam9iWWllbGRlZEZ1bmMoam9iQ29udGV4dCk7XHJcblxyXG4gICAgICAgIHZhciBqb2IgPSB7XHJcbiAgICAgICAgICAgIGpvYkZ1bmM6IGpvYkNvbnRpbnVlRnVuYyxcclxuICAgICAgICAgICAgam9iQWJvcnRlZEZ1bmM6IGpvYkFib3J0ZWRGdW5jLFxyXG4gICAgICAgICAgICBqb2JDb250ZXh0OiBqb2JDb250ZXh0XHJcbiAgICAgICAgICAgIH07XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgIGVucXVldWVOZXdKb2Ioc2VsZiwgam9iLCBwcmlvcml0eSk7XHJcbiAgICAgICAgZW5zdXJlUGVuZGluZ0pvYnNDb3VudChzZWxmKTtcclxuXHJcbiAgICAgICAgc2NoZWR1bGUoc2VsZiwgaGlnaGVyUHJpb3JpdHlKb2IsIHJlc291cmNlKTtcclxuICAgICAgICBlbnN1cmVQZW5kaW5nSm9ic0NvdW50KHNlbGYpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGxvZyhzZWxmLCAndHJ5WWllbGQoKSBlbmQ6IGpvYiB5aWVsZGVkJywgLTEpO1xyXG4gICAgICAgIHJldHVybiB0cnVlO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBmdW5jdGlvbiBoYXNOZXdKb2JXaXRoSGlnaGVyUHJpb3JpdHkoc2VsZiwgbG93UHJpb3JpdHkpIHtcclxuICAgICAgICB2YXIgY3VycmVudE5vZGUgPSBzZWxmLl9uZXdQZW5kaW5nSm9ic0xpbmtlZExpc3QuZ2V0Rmlyc3RJdGVyYXRvcigpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGxvZyhzZWxmLCAnaGFzTmV3Sm9iV2l0aEhpZ2hlclByaW9yaXR5KCkgc3RhcnQnLCArMSk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgd2hpbGUgKGN1cnJlbnROb2RlICE9PSBudWxsKSB7XHJcbiAgICAgICAgICAgIHZhciBuZXh0Tm9kZSA9IHNlbGYuX25ld1BlbmRpbmdKb2JzTGlua2VkTGlzdC5nZXROZXh0SXRlcmF0b3IoXHJcbiAgICAgICAgICAgICAgICBjdXJyZW50Tm9kZSk7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgdmFyIGpvYiA9IHNlbGYuX25ld1BlbmRpbmdKb2JzTGlua2VkTGlzdC5nZXRGcm9tSXRlcmF0b3IoY3VycmVudE5vZGUpO1xyXG4gICAgICAgICAgICB2YXIgcHJpb3JpdHkgPSBzZWxmLl9wcmlvcml0aXplci5nZXRQcmlvcml0eShqb2Iuam9iQ29udGV4dCk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBpZiAocHJpb3JpdHkgPCAwKSB7XHJcbiAgICAgICAgICAgICAgICBleHRyYWN0Sm9iRnJvbUxpbmtlZExpc3Qoc2VsZiwgY3VycmVudE5vZGUpO1xyXG4gICAgICAgICAgICAgICAgLS1zZWxmLl9wZW5kaW5nSm9ic0NvdW50O1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICBqb2Iuam9iQWJvcnRlZEZ1bmMoam9iLmpvYkNvbnRleHQpO1xyXG4gICAgICAgICAgICAgICAgY3VycmVudE5vZGUgPSBuZXh0Tm9kZTtcclxuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBpZiAocHJpb3JpdHkgPiBsb3dQcmlvcml0eSkge1xyXG4gICAgICAgICAgICAgICAgbG9nKHNlbGYsICdoYXNOZXdKb2JXaXRoSGlnaGVyUHJpb3JpdHkoKSBlbmQ6IHJldHVybnMgdHJ1ZScsIC0xKTtcclxuICAgICAgICAgICAgICAgIHJldHVybiB0cnVlO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBjdXJyZW50Tm9kZSA9IG5leHROb2RlO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBsb2coc2VsZiwgJ2hhc05ld0pvYldpdGhIaWdoZXJQcmlvcml0eSgpIGVuZDogcmV0dXJucyBmYWxzZScsIC0xKTtcclxuICAgICAgICByZXR1cm4gZmFsc2U7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGZ1bmN0aW9uIHRyeURlcXVldWVOZXdKb2JXaXRoSGlnaGVyUHJpb3JpdHkoc2VsZiwgbG93UHJpb3JpdHkpIHtcclxuICAgICAgICBsb2coc2VsZiwgJ3RyeURlcXVldWVOZXdKb2JXaXRoSGlnaGVyUHJpb3JpdHkoKSBzdGFydCcsICsxKTtcclxuICAgICAgICB2YXIgam9iVG9TY2hlZHVsZU5vZGUgPSBudWxsO1xyXG4gICAgICAgIHZhciBoaWdoZXN0UHJpb3JpdHlGb3VuZCA9IGxvd1ByaW9yaXR5O1xyXG4gICAgICAgIHZhciBjb3VudGVkUHJpb3JpdGllcyA9IFtdO1xyXG5cclxuICAgICAgICB2YXIgY3VycmVudE5vZGUgPSBzZWxmLl9uZXdQZW5kaW5nSm9ic0xpbmtlZExpc3QuZ2V0Rmlyc3RJdGVyYXRvcigpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHdoaWxlIChjdXJyZW50Tm9kZSAhPT0gbnVsbCkge1xyXG4gICAgICAgICAgICB2YXIgbmV4dE5vZGUgPSBzZWxmLl9uZXdQZW5kaW5nSm9ic0xpbmtlZExpc3QuZ2V0TmV4dEl0ZXJhdG9yKFxyXG4gICAgICAgICAgICAgICAgY3VycmVudE5vZGUpO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHZhciBqb2IgPSBzZWxmLl9uZXdQZW5kaW5nSm9ic0xpbmtlZExpc3QuZ2V0RnJvbUl0ZXJhdG9yKGN1cnJlbnROb2RlKTtcclxuICAgICAgICAgICAgdmFyIHByaW9yaXR5ID0gc2VsZi5fcHJpb3JpdGl6ZXIuZ2V0UHJpb3JpdHkoam9iLmpvYkNvbnRleHQpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgaWYgKHByaW9yaXR5IDwgMCkge1xyXG4gICAgICAgICAgICAgICAgZXh0cmFjdEpvYkZyb21MaW5rZWRMaXN0KHNlbGYsIGN1cnJlbnROb2RlKTtcclxuICAgICAgICAgICAgICAgIC0tc2VsZi5fcGVuZGluZ0pvYnNDb3VudDtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgam9iLmpvYkFib3J0ZWRGdW5jKGpvYi5qb2JDb250ZXh0KTtcclxuICAgICAgICAgICAgICAgIGN1cnJlbnROb2RlID0gbmV4dE5vZGU7XHJcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgaWYgKGhpZ2hlc3RQcmlvcml0eUZvdW5kID09PSB1bmRlZmluZWQgfHxcclxuICAgICAgICAgICAgICAgIHByaW9yaXR5ID4gaGlnaGVzdFByaW9yaXR5Rm91bmQpIHtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgaGlnaGVzdFByaW9yaXR5Rm91bmQgPSBwcmlvcml0eTtcclxuICAgICAgICAgICAgICAgIGpvYlRvU2NoZWR1bGVOb2RlID0gY3VycmVudE5vZGU7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGlmICghc2VsZi5fc2hvd0xvZykge1xyXG4gICAgICAgICAgICAgICAgY3VycmVudE5vZGUgPSBuZXh0Tm9kZTtcclxuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBpZiAoY291bnRlZFByaW9yaXRpZXNbcHJpb3JpdHldID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICAgICAgICAgIGNvdW50ZWRQcmlvcml0aWVzW3ByaW9yaXR5XSA9IDE7XHJcbiAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICArK2NvdW50ZWRQcmlvcml0aWVzW3ByaW9yaXR5XTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgY3VycmVudE5vZGUgPSBuZXh0Tm9kZTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgdmFyIGpvYlRvU2NoZWR1bGUgPSBudWxsO1xyXG4gICAgICAgIGlmIChqb2JUb1NjaGVkdWxlTm9kZSAhPT0gbnVsbCkge1xyXG4gICAgICAgICAgICBqb2JUb1NjaGVkdWxlID0gZXh0cmFjdEpvYkZyb21MaW5rZWRMaXN0KHNlbGYsIGpvYlRvU2NoZWR1bGVOb2RlKTtcclxuICAgICAgICAgICAgLS1zZWxmLl9wZW5kaW5nSm9ic0NvdW50O1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBpZiAoc2VsZi5fc2hvd0xvZykge1xyXG4gICAgICAgICAgICB2YXIgam9ic0xpc3RNZXNzYWdlID0gJ3RyeURlcXVldWVOZXdKb2JXaXRoSGlnaGVyUHJpb3JpdHkoKTogSm9icyBsaXN0Oic7XHJcblxyXG4gICAgICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IGNvdW50ZWRQcmlvcml0aWVzLmxlbmd0aDsgKytpKSB7XHJcbiAgICAgICAgICAgICAgICBpZiAoY291bnRlZFByaW9yaXRpZXNbaV0gIT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgICAgICAgICAgICAgIGpvYnNMaXN0TWVzc2FnZSArPSBjb3VudGVkUHJpb3JpdGllc1tpXSArICcgam9icyBvZiBwcmlvcml0eSAnICsgaSArICc7JztcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgbG9nKHNlbGYsIGpvYnNMaXN0TWVzc2FnZSk7XHJcblxyXG4gICAgICAgICAgICBpZiAoam9iVG9TY2hlZHVsZSAhPT0gbnVsbCkge1xyXG4gICAgICAgICAgICAgICAgbG9nKHNlbGYsICd0cnlEZXF1ZXVlTmV3Sm9iV2l0aEhpZ2hlclByaW9yaXR5KCk6IGRlcXVldWVkIG5ldyBqb2Igb2YgcHJpb3JpdHkgJyArIGhpZ2hlc3RQcmlvcml0eUZvdW5kKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBlbnN1cmVQZW5kaW5nSm9ic0NvdW50KHNlbGYpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGxvZyhzZWxmLCAndHJ5RGVxdWV1ZU5ld0pvYldpdGhIaWdoZXJQcmlvcml0eSgpIGVuZCcsIC0xKTtcclxuICAgICAgICByZXR1cm4gam9iVG9TY2hlZHVsZTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgZnVuY3Rpb24gdHJ5R2V0RnJlZVJlc291cmNlKHNlbGYpIHtcclxuICAgICAgICBsb2coc2VsZiwgJ3RyeUdldEZyZWVSZXNvdXJjZSgpIHN0YXJ0JywgKzEpO1xyXG4gICAgICAgIGlmIChzZWxmLl9mcmVlUmVzb3VyY2VzQ291bnQgPT09IDApIHtcclxuICAgICAgICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIC0tc2VsZi5fZnJlZVJlc291cmNlc0NvdW50O1xyXG4gICAgICAgIHZhciByZXNvdXJjZSA9IHNlbGYuX2ZyZWVSZXNvdXJjZXMucG9wKCk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKHJlc291cmNlID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICAgICAgcmVzb3VyY2UgPSBzZWxmLl9yZXNvdXJjZUNyZWF0b3IoKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgZW5zdXJlUGVuZGluZ0pvYnNDb3VudChzZWxmKTtcclxuICAgICAgICBcclxuICAgICAgICBsb2coc2VsZiwgJ3RyeUdldEZyZWVSZXNvdXJjZSgpIGVuZCcsIC0xKTtcclxuICAgICAgICByZXR1cm4gcmVzb3VyY2U7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGZ1bmN0aW9uIGVucXVldWVOZXdKb2Ioc2VsZiwgam9iLCBwcmlvcml0eSkge1xyXG4gICAgICAgIGxvZyhzZWxmLCAnZW5xdWV1ZU5ld0pvYigpIHN0YXJ0JywgKzEpO1xyXG4gICAgICAgICsrc2VsZi5fcGVuZGluZ0pvYnNDb3VudDtcclxuICAgICAgICBcclxuICAgICAgICB2YXIgZmlyc3RJdGVyYXRvciA9IHNlbGYuX25ld1BlbmRpbmdKb2JzTGlua2VkTGlzdC5nZXRGaXJzdEl0ZXJhdG9yKCk7XHJcbiAgICAgICAgYWRkSm9iVG9MaW5rZWRMaXN0KHNlbGYsIGpvYiwgZmlyc3RJdGVyYXRvcik7XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKHNlbGYuX3Nob3dMb2cpIHtcclxuICAgICAgICAgICAgbG9nKHNlbGYsICdlbnF1ZXVlTmV3Sm9iKCk6IGVucXVldWVkIGpvYiBvZiBwcmlvcml0eSAnICsgcHJpb3JpdHkpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBpZiAoc2VsZi5fbmV3UGVuZGluZ0pvYnNMaW5rZWRMaXN0LmdldENvdW50KCkgPD0gc2VsZi5fbnVtTmV3Sm9icykge1xyXG4gICAgICAgICAgICBlbnN1cmVQZW5kaW5nSm9ic0NvdW50KHNlbGYpO1xyXG4gICAgICAgICAgICBsb2coc2VsZiwgJ2VucXVldWVOZXdKb2IoKSBlbmQ6IF9uZXdQZW5kaW5nSm9ic0xpbmtlZExpc3QgaXMgc21hbGwgZW5vdWdoJywgLTEpO1xyXG4gICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHZhciBsYXN0SXRlcmF0b3IgPSBzZWxmLl9uZXdQZW5kaW5nSm9ic0xpbmtlZExpc3QuZ2V0TGFzdEl0ZXJhdG9yKCk7XHJcbiAgICAgICAgdmFyIG9sZEpvYiA9IGV4dHJhY3RKb2JGcm9tTGlua2VkTGlzdChzZWxmLCBsYXN0SXRlcmF0b3IpO1xyXG4gICAgICAgIGVucXVldWVPbGRKb2Ioc2VsZiwgb2xkSm9iKTtcclxuICAgICAgICBlbnN1cmVQZW5kaW5nSm9ic0NvdW50KHNlbGYpO1xyXG4gICAgICAgIGxvZyhzZWxmLCAnZW5xdWV1ZU5ld0pvYigpIGVuZDogT25lIGpvYiBtb3ZlZCBmcm9tIG5ldyBqb2IgbGlzdCB0byBvbGQgam9iIGxpc3QnLCAtMSk7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGZ1bmN0aW9uIGVucXVldWVPbGRKb2Ioc2VsZiwgam9iKSB7XHJcbiAgICAgICAgbG9nKHNlbGYsICdlbnF1ZXVlT2xkSm9iKCkgc3RhcnQnLCArMSk7XHJcbiAgICAgICAgdmFyIHByaW9yaXR5ID0gc2VsZi5fcHJpb3JpdGl6ZXIuZ2V0UHJpb3JpdHkoam9iLmpvYkNvbnRleHQpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGlmIChwcmlvcml0eSA8IDApIHtcclxuICAgICAgICAgICAgLS1zZWxmLl9wZW5kaW5nSm9ic0NvdW50O1xyXG4gICAgICAgICAgICBqb2Iuam9iQWJvcnRlZEZ1bmMoam9iLmpvYkNvbnRleHQpO1xyXG4gICAgICAgICAgICBsb2coc2VsZiwgJ2VucXVldWVPbGRKb2IoKSBlbmQ6IGpvYiBhYm9ydGVkJywgLTEpO1xyXG4gICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIGlmIChzZWxmLl9vbGRQZW5kaW5nSm9ic0J5UHJpb3JpdHlbcHJpb3JpdHldID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICAgICAgc2VsZi5fb2xkUGVuZGluZ0pvYnNCeVByaW9yaXR5W3ByaW9yaXR5XSA9IFtdO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBzZWxmLl9vbGRQZW5kaW5nSm9ic0J5UHJpb3JpdHlbcHJpb3JpdHldLnB1c2goam9iKTtcclxuICAgICAgICBsb2coc2VsZiwgJ2VucXVldWVPbGRKb2IoKSBlbmQ6IGpvYiBlbnF1ZXVlZCB0byBvbGQgam9iIGxpc3QnLCAtMSk7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGZ1bmN0aW9uIHJlcmFua1ByaW9yaXRpZXMoc2VsZikge1xyXG4gICAgICAgIGxvZyhzZWxmLCAncmVyYW5rUHJpb3JpdGllcygpIHN0YXJ0JywgKzEpO1xyXG4gICAgICAgIHZhciBvcmlnaW5hbE9sZHNBcnJheSA9IHNlbGYuX29sZFBlbmRpbmdKb2JzQnlQcmlvcml0eTtcclxuICAgICAgICB2YXIgb3JpZ2luYWxOZXdzTGlzdCA9IHNlbGYuX25ld1BlbmRpbmdKb2JzTGlua2VkTGlzdDtcclxuICAgICAgICBcclxuICAgICAgICBpZiAob3JpZ2luYWxPbGRzQXJyYXkubGVuZ3RoID09PSAwKSB7XHJcbiAgICAgICAgICAgIGxvZyhzZWxmLCAncmVyYW5rUHJpb3JpdGllcygpIGVuZDogbm8gbmVlZCB0byByZXJhbmsnLCAtMSk7XHJcbiAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgc2VsZi5fb2xkUGVuZGluZ0pvYnNCeVByaW9yaXR5ID0gW107XHJcbiAgICAgICAgc2VsZi5fbmV3UGVuZGluZ0pvYnNMaW5rZWRMaXN0ID0gbmV3IExpbmtlZExpc3QoKTtcclxuICAgICAgICBcclxuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IG9yaWdpbmFsT2xkc0FycmF5Lmxlbmd0aDsgKytpKSB7XHJcbiAgICAgICAgICAgIGlmIChvcmlnaW5hbE9sZHNBcnJheVtpXSA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgZm9yICh2YXIgaiA9IDA7IGogPCBvcmlnaW5hbE9sZHNBcnJheVtpXS5sZW5ndGg7ICsraikge1xyXG4gICAgICAgICAgICAgICAgZW5xdWV1ZU9sZEpvYihzZWxmLCBvcmlnaW5hbE9sZHNBcnJheVtpXVtqXSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgdmFyIGl0ZXJhdG9yID0gb3JpZ2luYWxOZXdzTGlzdC5nZXRGaXJzdEl0ZXJhdG9yKCk7XHJcbiAgICAgICAgd2hpbGUgKGl0ZXJhdG9yICE9PSBudWxsKSB7XHJcbiAgICAgICAgICAgIHZhciB2YWx1ZSA9IG9yaWdpbmFsTmV3c0xpc3QuZ2V0RnJvbUl0ZXJhdG9yKGl0ZXJhdG9yKTtcclxuICAgICAgICAgICAgZW5xdWV1ZU9sZEpvYihzZWxmLCB2YWx1ZSk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBpdGVyYXRvciA9IG9yaWdpbmFsTmV3c0xpc3QuZ2V0TmV4dEl0ZXJhdG9yKGl0ZXJhdG9yKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgdmFyIG1lc3NhZ2UgPSAncmVyYW5rUHJpb3JpdGllcygpOiAnO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGZvciAodmFyIGsgPSBzZWxmLl9vbGRQZW5kaW5nSm9ic0J5UHJpb3JpdHkubGVuZ3RoIC0gMTsgayA+PSAwOyAtLWspIHtcclxuICAgICAgICAgICAgdmFyIGhpZ2hQcmlvcml0eUpvYnMgPSBzZWxmLl9vbGRQZW5kaW5nSm9ic0J5UHJpb3JpdHlba107XHJcbiAgICAgICAgICAgIGlmIChoaWdoUHJpb3JpdHlKb2JzID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBpZiAoc2VsZi5fc2hvd0xvZykge1xyXG4gICAgICAgICAgICAgICAgbWVzc2FnZSArPSBoaWdoUHJpb3JpdHlKb2JzLmxlbmd0aCArICcgam9icyBpbiBwcmlvcml0eSAnICsgayArICc7JztcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgd2hpbGUgKGhpZ2hQcmlvcml0eUpvYnMubGVuZ3RoID4gMCAmJlxyXG4gICAgICAgICAgICAgICAgICAgIHNlbGYuX25ld1BlbmRpbmdKb2JzTGlua2VkTGlzdC5nZXRDb3VudCgpIDwgc2VsZi5fbnVtTmV3Sm9icykge1xyXG4gICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgdmFyIGpvYiA9IGhpZ2hQcmlvcml0eUpvYnMucG9wKCk7XHJcbiAgICAgICAgICAgICAgICBhZGRKb2JUb0xpbmtlZExpc3Qoc2VsZiwgam9iKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgaWYgKHNlbGYuX25ld1BlbmRpbmdKb2JzTGlua2VkTGlzdC5nZXRDb3VudCgpID49IHNlbGYuX251bU5ld0pvYnMgJiZcclxuICAgICAgICAgICAgICAgICFzZWxmLl9zaG93TG9nKSB7XHJcbiAgICAgICAgICAgICAgICBicmVhaztcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBpZiAoc2VsZi5fc2hvd0xvZykge1xyXG4gICAgICAgICAgICBsb2coc2VsZiwgbWVzc2FnZSk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIGVuc3VyZVBlbmRpbmdKb2JzQ291bnQoc2VsZik7XHJcbiAgICAgICAgbG9nKHNlbGYsICdyZXJhbmtQcmlvcml0aWVzKCkgZW5kOiByZXJhbmsgZG9uZScsIC0xKTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgZnVuY3Rpb24gcmVzb3VyY2VGcmVlZChzZWxmLCByZXNvdXJjZSkge1xyXG4gICAgICAgIGxvZyhzZWxmLCAncmVzb3VyY2VGcmVlZCgpIHN0YXJ0JywgKzEpO1xyXG4gICAgICAgICsrc2VsZi5fZnJlZVJlc291cmNlc0NvdW50O1xyXG4gICAgICAgIHZhciBtaW5Qcmlvcml0eSA9IGdldE1pbmltYWxQcmlvcml0eVRvU2NoZWR1bGUoc2VsZik7XHJcbiAgICAgICAgLS1zZWxmLl9mcmVlUmVzb3VyY2VzQ291bnQ7XHJcbiAgICAgICAgXHJcbiAgICAgICAgdmFyIGpvYiA9IHRyeURlcXVldWVOZXdKb2JXaXRoSGlnaGVyUHJpb3JpdHkoc2VsZiwgbWluUHJpb3JpdHkgLSAxKTtcclxuXHJcbiAgICAgICAgaWYgKGpvYiAhPT0gbnVsbCkge1xyXG4gICAgICAgICAgICBlbnN1cmVQZW5kaW5nSm9ic0NvdW50KHNlbGYpO1xyXG4gICAgICAgICAgICBzY2hlZHVsZShzZWxmLCBqb2IsIHJlc291cmNlKTtcclxuICAgICAgICAgICAgZW5zdXJlUGVuZGluZ0pvYnNDb3VudChzZWxmKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGxvZyhzZWxmLCAncmVzb3VyY2VGcmVlZCgpIGVuZDogbmV3IGpvYiBzY2hlZHVsZWQnLCAtMSk7XHJcbiAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgdmFyIGhhc09sZEpvYnMgPVxyXG4gICAgICAgICAgICBzZWxmLl9wZW5kaW5nSm9ic0NvdW50ID4gc2VsZi5fbmV3UGVuZGluZ0pvYnNMaW5rZWRMaXN0LmdldENvdW50KCk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgIGlmICghaGFzT2xkSm9icykge1xyXG4gICAgICAgICAgICBzZWxmLl9mcmVlUmVzb3VyY2VzLnB1c2gocmVzb3VyY2UpO1xyXG4gICAgICAgICAgICArK3NlbGYuX2ZyZWVSZXNvdXJjZXNDb3VudDtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGVuc3VyZVBlbmRpbmdKb2JzQ291bnQoc2VsZik7XHJcbiAgICAgICAgICAgIGxvZyhzZWxmLCAncmVzb3VyY2VGcmVlZCgpIGVuZDogbm8gam9iIHRvIHNjaGVkdWxlJywgLTEpO1xyXG4gICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHZhciBudW1Qcmlvcml0aWVzID0gc2VsZi5fb2xkUGVuZGluZ0pvYnNCeVByaW9yaXR5Lmxlbmd0aDtcclxuICAgICAgICB2YXIgam9iUHJpb3JpdHk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgZm9yICh2YXIgcHJpb3JpdHkgPSBudW1Qcmlvcml0aWVzIC0gMTsgcHJpb3JpdHkgPj0gMDsgLS1wcmlvcml0eSkge1xyXG4gICAgICAgICAgICB2YXIgam9icyA9IHNlbGYuX29sZFBlbmRpbmdKb2JzQnlQcmlvcml0eVtwcmlvcml0eV07XHJcbiAgICAgICAgICAgIGlmIChqb2JzID09PSB1bmRlZmluZWQgfHwgam9icy5sZW5ndGggPT09IDApIHtcclxuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBmb3IgKHZhciBpID0gam9icy5sZW5ndGggLSAxOyBpID49IDA7IC0taSkge1xyXG4gICAgICAgICAgICAgICAgam9iID0gam9ic1tpXTtcclxuICAgICAgICAgICAgICAgIGpvYlByaW9yaXR5ID0gc2VsZi5fcHJpb3JpdGl6ZXIuZ2V0UHJpb3JpdHkoam9iLmpvYkNvbnRleHQpO1xyXG4gICAgICAgICAgICAgICAgaWYgKGpvYlByaW9yaXR5ID49IHByaW9yaXR5KSB7XHJcbiAgICAgICAgICAgICAgICAgICAgam9icy5sZW5ndGggPSBpO1xyXG4gICAgICAgICAgICAgICAgICAgIGJyZWFrO1xyXG4gICAgICAgICAgICAgICAgfSBlbHNlIGlmIChqb2JQcmlvcml0eSA8IDApIHtcclxuICAgICAgICAgICAgICAgICAgICAtLXNlbGYuX3BlbmRpbmdKb2JzQ291bnQ7XHJcbiAgICAgICAgICAgICAgICAgICAgam9iLmpvYkFib3J0ZWRGdW5jKGpvYi5qb2JDb250ZXh0KTtcclxuICAgICAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKHNlbGYuX29sZFBlbmRpbmdKb2JzQnlQcmlvcml0eVtqb2JQcmlvcml0eV0gPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBzZWxmLl9vbGRQZW5kaW5nSm9ic0J5UHJpb3JpdHlbam9iUHJpb3JpdHldID0gW107XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgIHNlbGYuX29sZFBlbmRpbmdKb2JzQnlQcmlvcml0eVtqb2JQcmlvcml0eV0ucHVzaChqb2IpO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICBqb2IgPSBudWxsO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBpZiAoam9iICE9PSBudWxsKSB7XHJcbiAgICAgICAgICAgICAgICBicmVhaztcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgam9icy5sZW5ndGggPSAwO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBpZiAoam9iID09PSBudWxsKSB7XHJcbiAgICAgICAgICAgIHNlbGYuX2ZyZWVSZXNvdXJjZXMucHVzaChyZXNvdXJjZSk7XHJcbiAgICAgICAgICAgICsrc2VsZi5fZnJlZVJlc291cmNlc0NvdW50O1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgZW5zdXJlUGVuZGluZ0pvYnNDb3VudChzZWxmKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGxvZyhzZWxmLCAncmVzb3VyY2VGcmVlZCgpIGVuZDogbm8gbm9uLWFib3J0ZWQgam9iIHRvIHNjaGVkdWxlJywgLTEpO1xyXG4gICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIGlmIChzZWxmLl9zaG93TG9nKSB7XHJcbiAgICAgICAgICAgIGxvZyhzZWxmLCAncmVzb3VyY2VGcmVlZCgpOiBkZXF1ZXVlZCBvbGQgam9iIG9mIHByaW9yaXR5ICcgKyBqb2JQcmlvcml0eSk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIC0tc2VsZi5fcGVuZGluZ0pvYnNDb3VudDtcclxuICAgICAgICBcclxuICAgICAgICBlbnN1cmVQZW5kaW5nSm9ic0NvdW50KHNlbGYpO1xyXG4gICAgICAgIHNjaGVkdWxlKHNlbGYsIGpvYiwgcmVzb3VyY2UpO1xyXG4gICAgICAgIGVuc3VyZVBlbmRpbmdKb2JzQ291bnQoc2VsZik7XHJcbiAgICAgICAgbG9nKHNlbGYsICdyZXNvdXJjZUZyZWVkKCkgZW5kOiBqb2Igc2NoZWR1bGVkJywgLTEpO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBmdW5jdGlvbiBzY2hlZHVsZShzZWxmLCBqb2IsIHJlc291cmNlKSB7XHJcbiAgICAgICAgbG9nKHNlbGYsICdzY2hlZHVsZSgpIHN0YXJ0JywgKzEpO1xyXG4gICAgICAgICsrc2VsZi5fc2NoZWR1bGVzQ291bnRlcjtcclxuICAgICAgICBcclxuICAgICAgICBpZiAoc2VsZi5fc2NoZWR1bGVzQ291bnRlciA+PSBzZWxmLl9udW1Kb2JzQmVmb3JlUmVyYW5rT2xkUHJpb3JpdGllcykge1xyXG4gICAgICAgICAgICBzZWxmLl9zY2hlZHVsZXNDb3VudGVyID0gMDtcclxuICAgICAgICAgICAgcmVyYW5rUHJpb3JpdGllcyhzZWxmKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKHNlbGYuX3Nob3dMb2cpIHtcclxuICAgICAgICAgICAgdmFyIHByaW9yaXR5ID0gc2VsZi5fcHJpb3JpdGl6ZXIuZ2V0UHJpb3JpdHkoam9iLmpvYkNvbnRleHQpO1xyXG4gICAgICAgICAgICBsb2coc2VsZiwgJ3NjaGVkdWxlKCk6IHNjaGVkdWxlZCBqb2Igb2YgcHJpb3JpdHkgJyArIHByaW9yaXR5KTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgdmFyIGNhbGxiYWNrcyA9IG5ldyBQcmlvcml0eVNjaGVkdWxlckNhbGxiYWNrcyhzZWxmLCByZXNvdXJjZSwgam9iLmpvYkNvbnRleHQpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGpvYi5qb2JGdW5jKHJlc291cmNlLCBqb2Iuam9iQ29udGV4dCwgY2FsbGJhY2tzKTtcclxuICAgICAgICBsb2coc2VsZiwgJ3NjaGVkdWxlKCkgZW5kJywgLTEpO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBmdW5jdGlvbiBhZGRKb2JUb0xpbmtlZExpc3Qoc2VsZiwgam9iLCBhZGRCZWZvcmUpIHtcclxuICAgICAgICBsb2coc2VsZiwgJ2FkZEpvYlRvTGlua2VkTGlzdCgpIHN0YXJ0JywgKzEpO1xyXG4gICAgICAgIHNlbGYuX25ld1BlbmRpbmdKb2JzTGlua2VkTGlzdC5hZGQoam9iLCBhZGRCZWZvcmUpO1xyXG4gICAgICAgIGVuc3VyZU51bWJlck9mTm9kZXMoc2VsZik7XHJcbiAgICAgICAgbG9nKHNlbGYsICdhZGRKb2JUb0xpbmtlZExpc3QoKSBlbmQnLCAtMSk7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGZ1bmN0aW9uIGV4dHJhY3RKb2JGcm9tTGlua2VkTGlzdChzZWxmLCBpdGVyYXRvcikge1xyXG4gICAgICAgIGxvZyhzZWxmLCAnZXh0cmFjdEpvYkZyb21MaW5rZWRMaXN0KCkgc3RhcnQnLCArMSk7XHJcbiAgICAgICAgdmFyIHZhbHVlID0gc2VsZi5fbmV3UGVuZGluZ0pvYnNMaW5rZWRMaXN0LmdldEZyb21JdGVyYXRvcihpdGVyYXRvcik7XHJcbiAgICAgICAgc2VsZi5fbmV3UGVuZGluZ0pvYnNMaW5rZWRMaXN0LnJlbW92ZShpdGVyYXRvcik7XHJcbiAgICAgICAgZW5zdXJlTnVtYmVyT2ZOb2RlcyhzZWxmKTtcclxuICAgICAgICBcclxuICAgICAgICBsb2coc2VsZiwgJ2V4dHJhY3RKb2JGcm9tTGlua2VkTGlzdCgpIGVuZCcsIC0xKTtcclxuICAgICAgICByZXR1cm4gdmFsdWU7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGZ1bmN0aW9uIGVuc3VyZU51bWJlck9mTm9kZXMoc2VsZikge1xyXG4gICAgICAgIGlmICghc2VsZi5fc2hvd0xvZykge1xyXG4gICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIGxvZyhzZWxmLCAnZW5zdXJlTnVtYmVyT2ZOb2RlcygpIHN0YXJ0JywgKzEpO1xyXG4gICAgICAgIHZhciBpdGVyYXRvciA9IHNlbGYuX25ld1BlbmRpbmdKb2JzTGlua2VkTGlzdC5nZXRGaXJzdEl0ZXJhdG9yKCk7XHJcbiAgICAgICAgdmFyIGV4cGVjdGVkQ291bnQgPSAwO1xyXG4gICAgICAgIHdoaWxlIChpdGVyYXRvciAhPT0gbnVsbCkge1xyXG4gICAgICAgICAgICArK2V4cGVjdGVkQ291bnQ7XHJcbiAgICAgICAgICAgIGl0ZXJhdG9yID0gc2VsZi5fbmV3UGVuZGluZ0pvYnNMaW5rZWRMaXN0LmdldE5leHRJdGVyYXRvcihpdGVyYXRvcik7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIGlmIChleHBlY3RlZENvdW50ICE9PSBzZWxmLl9uZXdQZW5kaW5nSm9ic0xpbmtlZExpc3QuZ2V0Q291bnQoKSkge1xyXG4gICAgICAgICAgICB0aHJvdyAnVW5leHBlY3RlZCBjb3VudCBvZiBuZXcgam9icyc7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGxvZyhzZWxmLCAnZW5zdXJlTnVtYmVyT2ZOb2RlcygpIGVuZCcsIC0xKTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgZnVuY3Rpb24gZW5zdXJlUGVuZGluZ0pvYnNDb3VudChzZWxmKSB7XHJcbiAgICAgICAgaWYgKCFzZWxmLl9zaG93TG9nKSB7XHJcbiAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgbG9nKHNlbGYsICdlbnN1cmVQZW5kaW5nSm9ic0NvdW50KCkgc3RhcnQnLCArMSk7XHJcbiAgICAgICAgdmFyIG9sZEpvYnNDb3VudCA9IDA7XHJcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBzZWxmLl9vbGRQZW5kaW5nSm9ic0J5UHJpb3JpdHkubGVuZ3RoOyArK2kpIHtcclxuICAgICAgICAgICAgdmFyIGpvYnMgPSBzZWxmLl9vbGRQZW5kaW5nSm9ic0J5UHJpb3JpdHlbaV07XHJcbiAgICAgICAgICAgIGlmIChqb2JzICE9PSB1bmRlZmluZWQpIHtcclxuICAgICAgICAgICAgICAgIG9sZEpvYnNDb3VudCArPSBqb2JzLmxlbmd0aDtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICB2YXIgZXhwZWN0ZWRDb3VudCA9XHJcbiAgICAgICAgICAgIG9sZEpvYnNDb3VudCArIHNlbGYuX25ld1BlbmRpbmdKb2JzTGlua2VkTGlzdC5nZXRDb3VudCgpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICBpZiAoZXhwZWN0ZWRDb3VudCAhPT0gc2VsZi5fcGVuZGluZ0pvYnNDb3VudCkge1xyXG4gICAgICAgICAgICB0aHJvdyAnVW5leHBlY3RlZCBjb3VudCBvZiBqb2JzJztcclxuICAgICAgICB9XHJcbiAgICAgICAgbG9nKHNlbGYsICdlbnN1cmVQZW5kaW5nSm9ic0NvdW50KCkgZW5kJywgLTEpO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBmdW5jdGlvbiBnZXRNaW5pbWFsUHJpb3JpdHlUb1NjaGVkdWxlKHNlbGYpIHtcclxuICAgICAgICBsb2coc2VsZiwgJ2dldE1pbmltYWxQcmlvcml0eVRvU2NoZWR1bGUoKSBzdGFydCcsICsxKTtcclxuICAgICAgICBpZiAoc2VsZi5fZnJlZVJlc291cmNlc0NvdW50IDw9IHNlbGYuX3Jlc291cmNlc0d1YXJhbnRlZWRGb3JIaWdoUHJpb3JpdHkpIHtcclxuICAgICAgICAgICAgbG9nKHNlbGYsICdnZXRNaW5pbWFsUHJpb3JpdHlUb1NjaGVkdWxlKCkgZW5kOiBndWFyYW50ZWUgcmVzb3VyY2UgZm9yIGhpZ2ggcHJpb3JpdHkgaXMgbmVlZGVkJywgLTEpO1xyXG4gICAgICAgICAgICByZXR1cm4gc2VsZi5faGlnaFByaW9yaXR5VG9HdWFyYW50ZWVSZXNvdXJjZXM7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIGxvZyhzZWxmLCAnZ2V0TWluaW1hbFByaW9yaXR5VG9TY2hlZHVsZSgpIGVuZDogZW5vdWdoIHJlc291cmNlcywgbm8gbmVlZCB0byBndWFyYW50ZWUgcmVzb3VyY2UgZm9yIGhpZ2ggcHJpb3JpdHknLCAtMSk7XHJcbiAgICAgICAgcmV0dXJuIDA7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGZ1bmN0aW9uIGxvZyhzZWxmLCBtc2csIGFkZEluZGVudCkge1xyXG4gICAgICAgIGlmICghc2VsZi5fc2hvd0xvZykge1xyXG4gICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIGlmIChhZGRJbmRlbnQgPT09IC0xKSB7XHJcbiAgICAgICAgICAgIHNlbGYuX2xvZ0NhbGxJbmRlbnRQcmVmaXggPSBzZWxmLl9sb2dDYWxsSW5kZW50UHJlZml4LnN1YnN0cigxKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKHNlbGYuX3NjaGVkdWxlck5hbWUgIT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgICAgICAvKiBnbG9iYWwgY29uc29sZTogZmFsc2UgKi9cclxuICAgICAgICAgICAgY29uc29sZS5sb2coc2VsZi5fbG9nQ2FsbEluZGVudFByZWZpeCArICdQcmlvcml0eVNjaGVkdWxlciAnICsgc2VsZi5fc2NoZWR1bGVyTmFtZSArICc6ICcgKyBtc2cpO1xyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgIC8qIGdsb2JhbCBjb25zb2xlOiBmYWxzZSAqL1xyXG4gICAgICAgICAgICBjb25zb2xlLmxvZyhzZWxmLl9sb2dDYWxsSW5kZW50UHJlZml4ICsgJ1ByaW9yaXR5U2NoZWR1bGVyOiAnICsgbXNnKTtcclxuICAgICAgICB9XHJcbiAgICBcclxuICAgICAgICBpZiAoYWRkSW5kZW50ID09PSAxKSB7XHJcbiAgICAgICAgICAgIHNlbGYuX2xvZ0NhbGxJbmRlbnRQcmVmaXggKz0gJz4nO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuICAgIFxyXG4gICAgZnVuY3Rpb24gUHJpb3JpdHlTY2hlZHVsZXJDYWxsYmFja3Moc2NoZWR1bGVyLCByZXNvdXJjZSwgY29udGV4dCkge1xyXG4gICAgICAgIHRoaXMuX2lzVmFsaWQgPSB0cnVlO1xyXG4gICAgICAgIHRoaXMuX3NjaGVkdWxlciA9IHNjaGVkdWxlcjtcclxuICAgICAgICB0aGlzLl9yZXNvdXJjZSA9IHJlc291cmNlO1xyXG4gICAgICAgIHRoaXMuX2NvbnRleHQgPSBjb250ZXh0O1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBQcmlvcml0eVNjaGVkdWxlckNhbGxiYWNrcy5wcm90b3R5cGUuX2NoZWNrVmFsaWRpdHkgPSBmdW5jdGlvbiBjaGVja1ZhbGlkaXR5KCkge1xyXG4gICAgICAgIGlmICghdGhpcy5faXNWYWxpZCkge1xyXG4gICAgICAgICAgICB0aHJvdyAnUmVzb3VyY2VTY2hlZHVsZXIgZXJyb3I6IEFscmVhZHkgdGVybWluYXRlZCBqb2InO1xyXG4gICAgICAgIH1cclxuICAgIH07XHJcbiAgICBcclxuICAgIFByaW9yaXR5U2NoZWR1bGVyQ2FsbGJhY2tzLnByb3RvdHlwZS5fY2xlYXJWYWxpZGl0eSA9IGZ1bmN0aW9uKCkge1xyXG4gICAgICAgIHRoaXMuX2lzVmFsaWQgPSBmYWxzZTtcclxuICAgICAgICB0aGlzLl9yZXNvdXJjZSA9IG51bGw7XHJcbiAgICAgICAgdGhpcy5fY29udGV4dCA9IG51bGw7XHJcbiAgICAgICAgdGhpcy5fc2NoZWR1bGVyID0gbnVsbDtcclxuICAgIH07XHJcbiAgICBcclxuICAgIFByaW9yaXR5U2NoZWR1bGVyQ2FsbGJhY2tzLnByb3RvdHlwZS5qb2JEb25lID0gZnVuY3Rpb24gam9iRG9uZSgpIHtcclxuICAgICAgICB0aGlzLl9jaGVja1ZhbGlkaXR5KCk7XHJcbiAgICAgICAgam9iRG9uZUludGVybmFsKHRoaXMuX3NjaGVkdWxlciwgdGhpcy5fcmVzb3VyY2UsIHRoaXMuX2NvbnRleHQpO1xyXG4gICAgICAgIHRoaXMuX2NsZWFyVmFsaWRpdHkoKTtcclxuICAgIH07XHJcbiAgICBcclxuICAgIFByaW9yaXR5U2NoZWR1bGVyQ2FsbGJhY2tzLnByb3RvdHlwZS5zaG91bGRZaWVsZE9yQWJvcnQgPSBmdW5jdGlvbigpIHtcclxuICAgICAgICB0aGlzLl9jaGVja1ZhbGlkaXR5KCk7XHJcbiAgICAgICAgcmV0dXJuIHNob3VsZFlpZWxkT3JBYm9ydEludGVybmFsKHRoaXMuX3NjaGVkdWxlciwgdGhpcy5fY29udGV4dCk7XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBQcmlvcml0eVNjaGVkdWxlckNhbGxiYWNrcy5wcm90b3R5cGUudHJ5WWllbGQgPSBmdW5jdGlvbiB0cnlZaWVsZChqb2JDb250aW51ZUZ1bmMsIGpvYkFib3J0ZWRGdW5jLCBqb2JZaWVsZGVkRnVuYykge1xyXG4gICAgICAgIHRoaXMuX2NoZWNrVmFsaWRpdHkoKTtcclxuICAgICAgICB2YXIgaXNZaWVsZGVkID0gdHJ5WWllbGRJbnRlcm5hbChcclxuICAgICAgICAgICAgdGhpcy5fc2NoZWR1bGVyLCBqb2JDb250aW51ZUZ1bmMsIHRoaXMuX2NvbnRleHQsIGpvYkFib3J0ZWRGdW5jLCBqb2JZaWVsZGVkRnVuYywgdGhpcy5fcmVzb3VyY2UpO1xyXG4gICAgICAgIGlmIChpc1lpZWxkZWQpIHtcclxuICAgICAgICAgICAgdGhpcy5fY2xlYXJWYWxpZGl0eSgpO1xyXG4gICAgICAgIH1cclxuICAgICAgICByZXR1cm4gaXNZaWVsZGVkO1xyXG4gICAgfTtcclxuXHJcbiAgICByZXR1cm4gUHJpb3JpdHlTY2hlZHVsZXI7XHJcbn0pKCk7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IFByaW9yaXR5U2NoZWR1bGVyOyIsIid1c2Ugc3RyaWN0JztcclxuXHJcbm1vZHVsZS5leHBvcnRzLlByaW9yaXR5U2NoZWR1bGVyID0gcmVxdWlyZSgncHJpb3JpdHktc2NoZWR1bGVyJyk7XHJcbm1vZHVsZS5leHBvcnRzLkxpZm9TY2hlZHVsZXIgPSByZXF1aXJlKCdsaWZvLXNjaGVkdWxlcicpO1xyXG4iXX0=

(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.asyncProxy = f()}})(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
'use strict';

module.exports.SubWorkerEmulationForChrome = require('sub-worker-emulation-for-chrome');
module.exports.AsyncProxyFactory = require('async-proxy-factory');
module.exports.AsyncProxySlave = require('async-proxy-slave');
module.exports.AsyncProxyMaster = require('async-proxy-master');
module.exports.ScriptsToImportPool = require('scripts-to-Import-Pool');

},{"async-proxy-factory":2,"async-proxy-master":3,"async-proxy-slave":4,"scripts-to-Import-Pool":5,"sub-worker-emulation-for-chrome":7}],2:[function(require,module,exports){
'use strict';

var AsyncProxyMaster = require('async-proxy-master');

var AsyncProxyFactory = (function AsyncProxyFactoryClosure() {
    var factorySingleton = {};
    
    factorySingleton.create = function create(scriptsToImport, ctorName, methods, proxyCtor) {
        if ((!scriptsToImport) || !(scriptsToImport.length)) {
            throw 'AsyncProxyFactory error: missing scriptsToImport (2nd argument)';
        }
        
        var ProxyClass = proxyCtor || function() {
            var ctorArgs = factorySingleton.convertArgs(arguments);
            factorySingleton.initialize(this, scriptsToImport, ctorName, ctorArgs);
        };
        
        if (methods) {
            factorySingleton.addMethods(ProxyClass, methods);
        }
        
        return ProxyClass;
    };
    
    factorySingleton.addMethods = function addMethods(ProxyClass, methods) {
        for (var methodName in methods) {
            generateMethod(ProxyClass, methodName, methods[methodName] || []);
        }
        
        return ProxyClass;
    };
    
    function generateMethod(ProxyClass, methodName, methodArgsDescription) {
        var methodOptions = methodArgsDescription[0] || {};
        ProxyClass.prototype[methodName] = function generatedFunction() {
            var workerHelper = factorySingleton.getWorkerHelper(this);
            var argsToSend = [];
            for (var i = 0; i < arguments.length; ++i) {
                var argDescription = methodArgsDescription[i + 1];
                var argValue = arguments[i];
                
                if (argDescription === 'callback') {
                    argsToSend[i] = workerHelper.wrapCallback(argValue);
                } else if (!argDescription) {
                    argsToSend[i] = argValue;
                } else {
                    throw 'AsyncProxyFactory error: Unrecognized argument ' +
                        'description ' + argDescription + ' in argument ' +
                        (i + 1) + ' of method ' + methodName;
                }
            }
            return workerHelper.callFunction(
                methodName, argsToSend, methodArgsDescription[0]);
        };
    }
    
    factorySingleton.initialize = function initialize(proxyInstance, scriptsToImport, ctorName, ctorArgs) {
        if (proxyInstance.__workerHelperInitArgs) {
            throw 'asyncProxy error: Double initialization of AsyncProxy master';
        }
        proxyInstance.__workerHelperInitArgs = {
            scriptsToImport: scriptsToImport,
            ctorName: ctorName,
            ctorArgs: ctorArgs
        };
    };
    
    factorySingleton.convertArgs = function convertArgs(argsObject) {
        var args = new Array(argsObject.length);
        for (var i = 0; i < argsObject.length; ++i) {
            args[i] = argsObject[i];
        }
        
        return args;
    };
    
    factorySingleton.getWorkerHelper = function getWorkerHelper(proxyInstance) {
        if (!proxyInstance.__workerHelper) {
            if (!proxyInstance.__workerHelperInitArgs) {
                throw 'asyncProxy error: asyncProxyFactory.initialize() not called yet';
            }
            
            proxyInstance.__workerHelper = new AsyncProxyMaster(
                proxyInstance.__workerHelperInitArgs.scriptsToImport,
                proxyInstance.__workerHelperInitArgs.ctorName,
                proxyInstance.__workerHelperInitArgs.ctorArgs || []);
        }
        
        return proxyInstance.__workerHelper;
    };

    return factorySingleton;
})();

module.exports = AsyncProxyFactory;
},{"async-proxy-master":3}],3:[function(require,module,exports){
'use strict';

/* global Promise: false */

var ScriptsToImportPool = require('scripts-to-import-pool');

var AsyncProxyMaster = (function AsyncProxyMasterClosure() {
    var callId = 0;
    var isGetMasterEntryUrlCalled = false;
    var masterEntryUrl = getBaseUrlFromEntryScript();
    
    function AsyncProxyMaster(scriptsToImport, ctorName, ctorArgs, options) {
        var that = this;
        options = options || {};
        
        that._callbacks = [];
        that._pendingPromiseCalls = [];
        that._subWorkerById = [];
        that._subWorkers = [];
        that._userDataHandler = null;
        that._notReturnedFunctions = 0;
        that._functionsBufferSize = options.functionsBufferSize || 5;
        that._pendingMessages = [];
        
        var scriptName = getScriptName();
        var slaveScriptContentString = mainSlaveScriptContent.toString();
        slaveScriptContentString = slaveScriptContentString.replace(
            'SCRIPT_PLACEHOLDER', scriptName);
        var slaveScriptContentBlob = new Blob(
            ['(', slaveScriptContentString, ')()'],
            { type: 'application/javascript' });
        var slaveScriptUrl = URL.createObjectURL(slaveScriptContentBlob);

        that._worker = new Worker(slaveScriptUrl);
        that._worker.onmessage = onWorkerMessageInternal;

        that._worker.postMessage({
            functionToCall: 'ctor',
            scriptsToImport: scriptsToImport,
            ctorName: ctorName,
            args: ctorArgs,
            callId: ++callId,
            isPromise: false,
            masterEntryUrl: AsyncProxyMaster.getEntryUrl()
        });
        
        function onWorkerMessageInternal(workerEvent) {
            onWorkerMessage(that, workerEvent);
        }
    }
    
    AsyncProxyMaster.prototype.setUserDataHandler = function setUserDataHandler(userDataHandler) {
        this._userDataHandler = userDataHandler;
    };
    
    AsyncProxyMaster.prototype.terminate = function terminate() {
        this._worker.terminate();
        for (var i = 0; i < this._subWorkers.length; ++i) {
            this._subWorkers[i].terminate();
        }
    };
    
    AsyncProxyMaster.prototype.callFunction = function callFunction(functionToCall, args, options) {
        options = options || {};
        var isReturnPromise = !!options.isReturnPromise;
        var transferablesArg = options.transferables || [];
        var pathsToTransferables =
            options.pathsToTransferablesInPromiseResult;
        
        var localCallId = ++callId;
        var promiseOnMasterSide = null;
        var that = this;
        
        if (isReturnPromise) {
            promiseOnMasterSide = new Promise(function promiseFunc(resolve, reject) {
                that._pendingPromiseCalls[localCallId] = {
                    resolve: resolve,
                    reject: reject
                };
            });
        }
        
        var sendMessageFunction = options.isSendImmediately ?
            sendMessageToSlave: enqueueMessageToSlave;
        
        var transferables;
        if (typeof transferablesArg === 'function') {
            transferables = transferablesArg();
        } else {
            transferables = AsyncProxyMaster._extractTransferables(
                transferablesArg, args);
        }
        
        sendMessageFunction(this, transferables, /*isFunctionCall=*/true, {
            functionToCall: functionToCall,
            args: args || [],
            callId: localCallId,
            isPromise: isReturnPromise,
            pathsToTransferablesInPromiseResult : pathsToTransferables
        });
        
        if (isReturnPromise) {
            return promiseOnMasterSide;
        }
    };
    
    AsyncProxyMaster.prototype.wrapCallback = function wrapCallback(
        callback, callbackName, options) {
        
        options = options || {};
        var localCallId = ++callId;
        
        var callbackHandle = {
            isWorkerHelperCallback: true,
            isMultipleTimeCallback: !!options.isMultipleTimeCallback,
            callId: localCallId,
            callbackName: callbackName,
            pathsToTransferables: options.pathsToTransferables
        };
        
        var internalCallbackHandle = {
            isMultipleTimeCallback: !!options.isMultipleTimeCallback,
            callId: localCallId,
            callback: callback,
            pathsToTransferables: options.pathsToTransferables
        };
        
        this._callbacks[localCallId] = internalCallbackHandle;
        
        return callbackHandle;
    };
    
    AsyncProxyMaster.prototype.freeCallback = function freeCallback(callbackHandle) {
        delete this._callbacks[callbackHandle.callId];
    };
    
    // Static functions
    
    AsyncProxyMaster.getEntryUrl = function getEntryUrl() {
        isGetMasterEntryUrlCalled = true;
        return masterEntryUrl;
    };
    
    AsyncProxyMaster._setEntryUrl = function setEntryUrl(newUrl) {
        if (masterEntryUrl !== newUrl && isGetMasterEntryUrlCalled) {
            throw 'Previous values returned from getMasterEntryUrl ' +
                'is wrong. Avoid calling it within the slave c`tor';
        }

        masterEntryUrl = newUrl;
    };
    
    AsyncProxyMaster._extractTransferables = function extractTransferables(
            pathsToTransferables, pathsBase) {
        
        if (pathsToTransferables === undefined) {
            return undefined;
        }
        
        var transferables = new Array(pathsToTransferables.length);
        
        for (var i = 0; i < pathsToTransferables.length; ++i) {
            var path = pathsToTransferables[i];
            var transferable = pathsBase;
            
            for (var j = 0; j < path.length; ++j) {
                var member = path[j];
                transferable = transferable[member];
            }
            
            transferables[i] = transferable;
        }
        
        return transferables;
    };
    
    // Private functions
    
    function getScriptName() {
        var error = new Error();
        return ScriptsToImportPool._getScriptName(error);
    }
    
    function mainSlaveScriptContent() {
        // This function is not run directly: It copied as a string into a blob
        // and run in the Web Worker global scope
        
        /* global importScripts: false */
        importScripts('SCRIPT_PLACEHOLDER');
        /* global asyncProxy: false */
        asyncProxy.AsyncProxySlave._initializeSlave();
    }
    
    function onWorkerMessage(that, workerEvent) {
        var callId = workerEvent.data.callId;
        
        switch (workerEvent.data.type) {
            case 'functionCalled':
                --that._notReturnedFunctions;
                trySendPendingMessages(that);
                break;
            
            case 'promiseResult':
                var promiseToResolve = that._pendingPromiseCalls[callId];
                delete that._pendingPromiseCalls[callId];
                
                var result = workerEvent.data.result;
                promiseToResolve.resolve(result);
                
                break;
            
            case 'promiseFailure':
                var promiseToReject = that._pendingPromiseCalls[callId];
                delete that._pendingPromiseCalls[callId];
                
                var reason = workerEvent.data.reason;
                promiseToReject.reject(reason);
                
                break;
            
            case 'userData':
                if (that._userDataHandler !== null) {
                    that._userDataHandler(workerEvent.data.userData);
                }
                
                break;
            
            case 'callback':
                var callbackHandle = that._callbacks[workerEvent.data.callId];
                if (callbackHandle === undefined) {
                    throw 'Unexpected message from SlaveWorker of callback ID: ' +
                        workerEvent.data.callId + '. Maybe should indicate ' +
                        'isMultipleTimesCallback = true on creation?';
                }
                
                if (!callbackHandle.isMultipleTimeCallback) {
                    that.freeCallback(that._callbacks[workerEvent.data.callId]);
                }
                
                if (callbackHandle.callback !== null) {
                    callbackHandle.callback.apply(null, workerEvent.data.args);
                }
                
                break;
            
            case 'subWorkerCtor':
                var subWorkerCreated = new Worker(workerEvent.data.scriptUrl);
                var id = workerEvent.data.subWorkerId;
                
                that._subWorkerById[id] = subWorkerCreated;
                that._subWorkers.push(subWorkerCreated);
                
                subWorkerCreated.onmessage = function onSubWorkerMessage(subWorkerEvent) {
                    enqueueMessageToSlave(
                        that, subWorkerEvent.ports, /*isFunctionCall=*/false, {
                            functionToCall: 'subWorkerOnMessage',
                            subWorkerId: id,
                            data: subWorkerEvent.data
                        });
                };
                
                break;
            
            case 'subWorkerPostMessage':
                var subWorkerToPostMessage = that._subWorkerById[workerEvent.data.subWorkerId];
                subWorkerToPostMessage.postMessage(workerEvent.data.data);
                break;
            
            case 'subWorkerTerminate':
                var subWorkerToTerminate = that._subWorkerById[workerEvent.data.subWorkerId];
                subWorkerToTerminate.terminate();
                break;
            
            default:
                throw 'Unknown message from AsyncProxySlave of type: ' +
                    workerEvent.data.type;
        }
    }
    
    function enqueueMessageToSlave(
        that, transferables, isFunctionCall, message) {
        
        if (that._notReturnedFunctions >= that._functionsBufferSize) {
            that._pendingMessages.push({
                transferables: transferables,
                isFunctionCall: isFunctionCall,
                message: message
            });
            return;
        }
        
        sendMessageToSlave(that, transferables, isFunctionCall, message);
    }
        
    function sendMessageToSlave(
        that, transferables, isFunctionCall, message) {
        
        if (isFunctionCall) {
            ++that._notReturnedFunctions;
        }
        
        that._worker.postMessage(message, transferables);
    }
    
    function trySendPendingMessages(that) {
        while (that._notReturnedFunctions < that._functionsBufferSize &&
               that._pendingMessages.length > 0) {
            
            var message = that._pendingMessages.shift();
            sendMessageToSlave(
                that,
                message.transferables,
                message.isFunctionCall,
                message.message);
        }
    }
    
    function getBaseUrlFromEntryScript() {
        var baseUrl = location.href;
        var endOfPath = baseUrl.lastIndexOf('/');
        if (endOfPath >= 0) {
            baseUrl = baseUrl.substring(0, endOfPath);
        }
        
        return baseUrl;
    }
    
    return AsyncProxyMaster;
})();

module.exports = AsyncProxyMaster;
},{"scripts-to-import-pool":6}],4:[function(require,module,exports){
'use strict';

/* global console: false */
/* global self: false */

var AsyncProxyMaster = require('async-proxy-master');
var SubWorkerEmulationForChrome = require('sub-worker-emulation-for-chrome');

var AsyncProxySlave = (function AsyncProxySlaveClosure() {
    var slaveHelperSingleton = {};
    
    var beforeOperationListener = null;
    var slaveSideMainInstance;
    var slaveSideInstanceCreator = defaultInstanceCreator;
    var subWorkerIdToSubWorker = {};
    var ctorName;
    
    slaveHelperSingleton._initializeSlave = function initializeSlave() {
        self.onmessage = onMessage;
    };
    
    slaveHelperSingleton.setSlaveSideCreator = function setSlaveSideCreator(creator) {
        slaveSideInstanceCreator = creator;
    };
    
    slaveHelperSingleton.setBeforeOperationListener =
        function setBeforeOperationListener(listener) {
            beforeOperationListener = listener;
        };
        
    slaveHelperSingleton.sendUserDataToMaster = function sendUserDataToMaster(
        userData) {
        
        self.postMessage({
            type: 'userData',
            userData: userData
        });
    };
    
    slaveHelperSingleton.wrapPromiseFromSlaveSide =
        function wrapPromiseFromSlaveSide(
            callId, promise, pathsToTransferables) {
        
        var promiseThen = promise.then(function sendPromiseToMaster(result) {
            var transferables =
                AsyncProxyMaster._extractTransferables(
                    pathsToTransferables, result);
            
            self.postMessage(
                {
                    type: 'promiseResult',
                    callId: callId,
                    result: result
                },
                transferables);
        });
        
        promiseThen['catch'](function sendFailureToMaster(reason) {
            self.postMessage({
                type: 'promiseFailure',
                callId: callId,
                reason: reason
            });
        });
    };
    
    slaveHelperSingleton.wrapCallbackFromSlaveSide =
        function wrapCallbackFromSlaveSide(callbackHandle) {
            
        var isAlreadyCalled = false;
        
        function callbackWrapperFromSlaveSide() {
            if (isAlreadyCalled) {
                throw 'Callback is called twice but isMultipleTimeCallback ' +
                    '= false';
            }
            
            var argumentsAsArray = getArgumentsAsArray(arguments);
            
            if (beforeOperationListener !== null) {
                try {
                    beforeOperationListener.call(
                        slaveSideMainInstance,
                        'callback',
                        callbackHandle.callbackName,
                        argumentsAsArray);
                } catch (e) {
                    console.log('AsyncProxySlave.beforeOperationListener has thrown an exception: ' + e);
                }
            }
            
            var transferables =
                AsyncProxyMaster._extractTransferables(
                    callbackHandle.pathsToTransferables, argumentsAsArray);
            
            self.postMessage({
                    type: 'callback',
                    callId: callbackHandle.callId,
                    args: argumentsAsArray
                },
                transferables);
            
            if (!callbackHandle.isMultipleTimeCallback) {
                isAlreadyCalled = true;
            }
        }
        
        return callbackWrapperFromSlaveSide;
    };
    
    function onMessage(event) {
        var functionNameToCall = event.data.functionToCall;
        var args = event.data.args;
        var callId = event.data.callId;
        var isPromise = event.data.isPromise;
        var pathsToTransferablesInPromiseResult =
            event.data.pathsToTransferablesInPromiseResult;
        
        var result = null;
        
        switch (functionNameToCall) {
            case 'ctor':
                AsyncProxyMaster._setEntryUrl(event.data.masterEntryUrl);
                
                var scriptsToImport = event.data.scriptsToImport;
                ctorName = event.data.ctorName;
                
                for (var i = 0; i < scriptsToImport.length; ++i) {
                    /* global importScripts: false */
                    importScripts(scriptsToImport[i]);
                }
                
                slaveSideMainInstance = slaveSideInstanceCreator.apply(null, args);

                return;
            
            case 'subWorkerOnMessage':
                var subWorker = subWorkerIdToSubWorker[event.data.subWorkerId];
                var workerEvent = { data: event.data.data };
                
                subWorker.onmessage(workerEvent);
                
                return;
        }
        
        args = new Array(event.data.args.length);
        for (var j = 0; j < event.data.args.length; ++j) {
            var arg = event.data.args[j];
            if (arg !== undefined &&
                arg !== null &&
                arg.isWorkerHelperCallback) {
                
                arg = slaveHelperSingleton.wrapCallbackFromSlaveSide(arg);
            }
            
            args[j] = arg;
        }
        
        var functionContainer = slaveSideMainInstance;
        var functionToCall;
        while (functionContainer) {
            functionToCall = slaveSideMainInstance[functionNameToCall];
            if (functionToCall) {
                break;
            }
            /* jshint proto: true */
            functionContainer = functionContainer.__proto__;
        }
        
        if (!functionToCall) {
            throw 'AsyncProxy error: could not find function ' + functionNameToCall;
        }
        
        var promise = functionToCall.apply(slaveSideMainInstance, args);
        
        if (isPromise) {
            slaveHelperSingleton.wrapPromiseFromSlaveSide(
                callId, promise, pathsToTransferablesInPromiseResult);
        }

        self.postMessage({
            type: 'functionCalled',
            callId: event.data.callId,
            result: result
        });
    }
    
    function defaultInstanceCreator() {
        var instance;
        try {
            var namespacesAndCtorName = ctorName.split('.');
            var member = self;
            for (var i = 0; i < namespacesAndCtorName.length; ++i)
                member = member[namespacesAndCtorName[i]];
            var TypeCtor = member;
            
            var bindArgs = [null].concat(getArgumentsAsArray(arguments));
            instance = new (Function.prototype.bind.apply(TypeCtor, bindArgs))();
        } catch (e) {
            throw new Error('Failed locating class name ' + ctorName + ': ' + e);
        }
        
        return instance;
    }
    
    function getArgumentsAsArray(args) {
        var argumentsAsArray = new Array(args.length);
        for (var i = 0; i < args.length; ++i) {
            argumentsAsArray[i] = args[i];
        }
        
        return argumentsAsArray;
    }
    
    if (self.Worker === undefined) {
        SubWorkerEmulationForChrome.initialize(subWorkerIdToSubWorker);
        self.Worker = SubWorkerEmulationForChrome;
    }
    
    return slaveHelperSingleton;
})();

module.exports = AsyncProxySlave;
},{"async-proxy-master":3,"sub-worker-emulation-for-chrome":7}],5:[function(require,module,exports){
'use strict';

var ScriptsToImportPool = (function ScriptsToImportPoolClosure() {
    var currentStackFrameRegex = /at (|[^ ]+ \()([^ ]+):\d+:\d+/;
    var lastStackFrameRegexWithStrudel = new RegExp(/.+@(.*?):\d+:\d+/);
    var lastStackFrameRegex = new RegExp(/.+\/(.*?):\d+(:\d+)*$/);

    function ScriptsToImportPool() {
        var that = this;
        that._scriptsByName = {};
        that._scriptsArray = null;
    }
    
    ScriptsToImportPool.prototype.addScriptFromErrorWithStackTrace =
        function addScriptForWorkerImport(errorWithStackTrace) {
        
        var fileName = ScriptsToImportPool._getScriptName(errorWithStackTrace);
        
        if (!this._scriptsByName[fileName]) {
            this._scriptsByName[fileName] = true;
            this._scriptsArray = null;
        }
    };
    
    ScriptsToImportPool.prototype.getScriptsForWorkerImport =
        function getScriptsForWorkerImport() {
        
        if (this._scriptsArray === null) {
            this._scriptsArray = [];
            for (var fileName in this._scriptsByName) {
                this._scriptsArray.push(fileName);
            }
        }
        
        return this._scriptsArray;
    };
    
    ScriptsToImportPool._getScriptName = function getScriptName(errorWithStackTrace) {
        var stack = errorWithStackTrace.stack.trim();
        
        var source = currentStackFrameRegex.exec(stack);
        if (source && source[2] !== "") {
            return source[2];
        }

        source = lastStackFrameRegexWithStrudel.exec(stack);
        if (source && (source[1] !== "")) {
            return source[1];
        }
        
        source = lastStackFrameRegex.exec(stack);
        if (source && source[1] !== "") {
            return source[1];
        }
        
        if (errorWithStackTrace.fileName !== undefined) {
            return errorWithStackTrace.fileName;
        }
        
        throw 'async-proxy.js: Could not get current script URL';
    };
    
    return ScriptsToImportPool;
})();

module.exports = ScriptsToImportPool;
},{}],6:[function(require,module,exports){
arguments[4][5][0].apply(exports,arguments)
},{"dup":5}],7:[function(require,module,exports){
'use strict';

/* global self: false */

var SubWorkerEmulationForChrome = (function SubWorkerEmulationForChromeClosure() {
    var subWorkerId = 0;
    var subWorkerIdToSubWorker = null;
    
    function SubWorkerEmulationForChrome(scriptUrl) {
        if (subWorkerIdToSubWorker === null) {
            throw 'AsyncProxy internal error: SubWorkerEmulationForChrome ' +
                'not initialized';
        }
        
        var that = this;
        that._subWorkerId = ++subWorkerId;
        subWorkerIdToSubWorker[that._subWorkerId] = that;
        
        self.postMessage({
            type: 'subWorkerCtor',
            subWorkerId: that._subWorkerId,
            scriptUrl: scriptUrl
        });
    }
    
    SubWorkerEmulationForChrome.initialize = function initialize(
        subWorkerIdToSubWorker_) {
        
        subWorkerIdToSubWorker = subWorkerIdToSubWorker_;
    };
    
    SubWorkerEmulationForChrome.prototype.postMessage = function postMessage(
        data, transferables) {
        
        self.postMessage({
            type: 'subWorkerPostMessage',
            subWorkerId: this._subWorkerId,
            data: data
        },
        transferables);
    };
    
    SubWorkerEmulationForChrome.prototype.terminate = function terminate(
        data, transferables) {
        
        self.postMessage({
            type: 'subWorkerTerminate',
            subWorkerId: this._subWorkerId
        },
        transferables);
    };
    
    return SubWorkerEmulationForChrome;
})();

module.exports = SubWorkerEmulationForChrome;
},{}]},{},[1])(1)
});
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJzcmMvYXN5bmMtcHJveHktZXhwb3J0cy5qcyIsInNyYy9hc3luYy1wcm94eS1mYWN0b3J5LmpzIiwic3JjL2FzeW5jLXByb3h5LW1hc3Rlci5qcyIsInNyYy9hc3luYy1wcm94eS1zbGF2ZS5qcyIsInNyYy9zY3JpcHRzLXRvLUltcG9ydC1Qb29sLmpzIiwic3JjL3N1Yi13b3JrZXItZW11bGF0aW9uLWZvci1jaHJvbWUuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7QUNBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1BBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDOUZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzFVQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM5TkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7O0FDakVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EiLCJmaWxlIjoiZ2VuZXJhdGVkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXNDb250ZW50IjpbIihmdW5jdGlvbiBlKHQsbixyKXtmdW5jdGlvbiBzKG8sdSl7aWYoIW5bb10pe2lmKCF0W29dKXt2YXIgYT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2lmKCF1JiZhKXJldHVybiBhKG8sITApO2lmKGkpcmV0dXJuIGkobywhMCk7dmFyIGY9bmV3IEVycm9yKFwiQ2Fubm90IGZpbmQgbW9kdWxlICdcIitvK1wiJ1wiKTt0aHJvdyBmLmNvZGU9XCJNT0RVTEVfTk9UX0ZPVU5EXCIsZn12YXIgbD1uW29dPXtleHBvcnRzOnt9fTt0W29dWzBdLmNhbGwobC5leHBvcnRzLGZ1bmN0aW9uKGUpe3ZhciBuPXRbb11bMV1bZV07cmV0dXJuIHMobj9uOmUpfSxsLGwuZXhwb3J0cyxlLHQsbixyKX1yZXR1cm4gbltvXS5leHBvcnRzfXZhciBpPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7Zm9yKHZhciBvPTA7bzxyLmxlbmd0aDtvKyspcyhyW29dKTtyZXR1cm4gc30pIiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxubW9kdWxlLmV4cG9ydHMuU3ViV29ya2VyRW11bGF0aW9uRm9yQ2hyb21lID0gcmVxdWlyZSgnc3ViLXdvcmtlci1lbXVsYXRpb24tZm9yLWNocm9tZScpO1xyXG5tb2R1bGUuZXhwb3J0cy5Bc3luY1Byb3h5RmFjdG9yeSA9IHJlcXVpcmUoJ2FzeW5jLXByb3h5LWZhY3RvcnknKTtcclxubW9kdWxlLmV4cG9ydHMuQXN5bmNQcm94eVNsYXZlID0gcmVxdWlyZSgnYXN5bmMtcHJveHktc2xhdmUnKTtcclxubW9kdWxlLmV4cG9ydHMuQXN5bmNQcm94eU1hc3RlciA9IHJlcXVpcmUoJ2FzeW5jLXByb3h5LW1hc3RlcicpO1xyXG5tb2R1bGUuZXhwb3J0cy5TY3JpcHRzVG9JbXBvcnRQb29sID0gcmVxdWlyZSgnc2NyaXB0cy10by1JbXBvcnQtUG9vbCcpO1xyXG4iLCIndXNlIHN0cmljdCc7XHJcblxyXG52YXIgQXN5bmNQcm94eU1hc3RlciA9IHJlcXVpcmUoJ2FzeW5jLXByb3h5LW1hc3RlcicpO1xyXG5cclxudmFyIEFzeW5jUHJveHlGYWN0b3J5ID0gKGZ1bmN0aW9uIEFzeW5jUHJveHlGYWN0b3J5Q2xvc3VyZSgpIHtcclxuICAgIHZhciBmYWN0b3J5U2luZ2xldG9uID0ge307XHJcbiAgICBcclxuICAgIGZhY3RvcnlTaW5nbGV0b24uY3JlYXRlID0gZnVuY3Rpb24gY3JlYXRlKHNjcmlwdHNUb0ltcG9ydCwgY3Rvck5hbWUsIG1ldGhvZHMsIHByb3h5Q3Rvcikge1xyXG4gICAgICAgIGlmICgoIXNjcmlwdHNUb0ltcG9ydCkgfHwgIShzY3JpcHRzVG9JbXBvcnQubGVuZ3RoKSkge1xyXG4gICAgICAgICAgICB0aHJvdyAnQXN5bmNQcm94eUZhY3RvcnkgZXJyb3I6IG1pc3Npbmcgc2NyaXB0c1RvSW1wb3J0ICgybmQgYXJndW1lbnQpJztcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgdmFyIFByb3h5Q2xhc3MgPSBwcm94eUN0b3IgfHwgZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgICAgIHZhciBjdG9yQXJncyA9IGZhY3RvcnlTaW5nbGV0b24uY29udmVydEFyZ3MoYXJndW1lbnRzKTtcclxuICAgICAgICAgICAgZmFjdG9yeVNpbmdsZXRvbi5pbml0aWFsaXplKHRoaXMsIHNjcmlwdHNUb0ltcG9ydCwgY3Rvck5hbWUsIGN0b3JBcmdzKTtcclxuICAgICAgICB9O1xyXG4gICAgICAgIFxyXG4gICAgICAgIGlmIChtZXRob2RzKSB7XHJcbiAgICAgICAgICAgIGZhY3RvcnlTaW5nbGV0b24uYWRkTWV0aG9kcyhQcm94eUNsYXNzLCBtZXRob2RzKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgcmV0dXJuIFByb3h5Q2xhc3M7XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBmYWN0b3J5U2luZ2xldG9uLmFkZE1ldGhvZHMgPSBmdW5jdGlvbiBhZGRNZXRob2RzKFByb3h5Q2xhc3MsIG1ldGhvZHMpIHtcclxuICAgICAgICBmb3IgKHZhciBtZXRob2ROYW1lIGluIG1ldGhvZHMpIHtcclxuICAgICAgICAgICAgZ2VuZXJhdGVNZXRob2QoUHJveHlDbGFzcywgbWV0aG9kTmFtZSwgbWV0aG9kc1ttZXRob2ROYW1lXSB8fCBbXSk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHJldHVybiBQcm94eUNsYXNzO1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgZnVuY3Rpb24gZ2VuZXJhdGVNZXRob2QoUHJveHlDbGFzcywgbWV0aG9kTmFtZSwgbWV0aG9kQXJnc0Rlc2NyaXB0aW9uKSB7XHJcbiAgICAgICAgdmFyIG1ldGhvZE9wdGlvbnMgPSBtZXRob2RBcmdzRGVzY3JpcHRpb25bMF0gfHwge307XHJcbiAgICAgICAgUHJveHlDbGFzcy5wcm90b3R5cGVbbWV0aG9kTmFtZV0gPSBmdW5jdGlvbiBnZW5lcmF0ZWRGdW5jdGlvbigpIHtcclxuICAgICAgICAgICAgdmFyIHdvcmtlckhlbHBlciA9IGZhY3RvcnlTaW5nbGV0b24uZ2V0V29ya2VySGVscGVyKHRoaXMpO1xyXG4gICAgICAgICAgICB2YXIgYXJnc1RvU2VuZCA9IFtdO1xyXG4gICAgICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IGFyZ3VtZW50cy5sZW5ndGg7ICsraSkge1xyXG4gICAgICAgICAgICAgICAgdmFyIGFyZ0Rlc2NyaXB0aW9uID0gbWV0aG9kQXJnc0Rlc2NyaXB0aW9uW2kgKyAxXTtcclxuICAgICAgICAgICAgICAgIHZhciBhcmdWYWx1ZSA9IGFyZ3VtZW50c1tpXTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgaWYgKGFyZ0Rlc2NyaXB0aW9uID09PSAnY2FsbGJhY2snKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgYXJnc1RvU2VuZFtpXSA9IHdvcmtlckhlbHBlci53cmFwQ2FsbGJhY2soYXJnVmFsdWUpO1xyXG4gICAgICAgICAgICAgICAgfSBlbHNlIGlmICghYXJnRGVzY3JpcHRpb24pIHtcclxuICAgICAgICAgICAgICAgICAgICBhcmdzVG9TZW5kW2ldID0gYXJnVmFsdWU7XHJcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgICAgIHRocm93ICdBc3luY1Byb3h5RmFjdG9yeSBlcnJvcjogVW5yZWNvZ25pemVkIGFyZ3VtZW50ICcgK1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAnZGVzY3JpcHRpb24gJyArIGFyZ0Rlc2NyaXB0aW9uICsgJyBpbiBhcmd1bWVudCAnICtcclxuICAgICAgICAgICAgICAgICAgICAgICAgKGkgKyAxKSArICcgb2YgbWV0aG9kICcgKyBtZXRob2ROYW1lO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIHJldHVybiB3b3JrZXJIZWxwZXIuY2FsbEZ1bmN0aW9uKFxyXG4gICAgICAgICAgICAgICAgbWV0aG9kTmFtZSwgYXJnc1RvU2VuZCwgbWV0aG9kQXJnc0Rlc2NyaXB0aW9uWzBdKTtcclxuICAgICAgICB9O1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBmYWN0b3J5U2luZ2xldG9uLmluaXRpYWxpemUgPSBmdW5jdGlvbiBpbml0aWFsaXplKHByb3h5SW5zdGFuY2UsIHNjcmlwdHNUb0ltcG9ydCwgY3Rvck5hbWUsIGN0b3JBcmdzKSB7XHJcbiAgICAgICAgaWYgKHByb3h5SW5zdGFuY2UuX193b3JrZXJIZWxwZXJJbml0QXJncykge1xyXG4gICAgICAgICAgICB0aHJvdyAnYXN5bmNQcm94eSBlcnJvcjogRG91YmxlIGluaXRpYWxpemF0aW9uIG9mIEFzeW5jUHJveHkgbWFzdGVyJztcclxuICAgICAgICB9XHJcbiAgICAgICAgcHJveHlJbnN0YW5jZS5fX3dvcmtlckhlbHBlckluaXRBcmdzID0ge1xyXG4gICAgICAgICAgICBzY3JpcHRzVG9JbXBvcnQ6IHNjcmlwdHNUb0ltcG9ydCxcclxuICAgICAgICAgICAgY3Rvck5hbWU6IGN0b3JOYW1lLFxyXG4gICAgICAgICAgICBjdG9yQXJnczogY3RvckFyZ3NcclxuICAgICAgICB9O1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgZmFjdG9yeVNpbmdsZXRvbi5jb252ZXJ0QXJncyA9IGZ1bmN0aW9uIGNvbnZlcnRBcmdzKGFyZ3NPYmplY3QpIHtcclxuICAgICAgICB2YXIgYXJncyA9IG5ldyBBcnJheShhcmdzT2JqZWN0Lmxlbmd0aCk7XHJcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBhcmdzT2JqZWN0Lmxlbmd0aDsgKytpKSB7XHJcbiAgICAgICAgICAgIGFyZ3NbaV0gPSBhcmdzT2JqZWN0W2ldO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICByZXR1cm4gYXJncztcclxuICAgIH07XHJcbiAgICBcclxuICAgIGZhY3RvcnlTaW5nbGV0b24uZ2V0V29ya2VySGVscGVyID0gZnVuY3Rpb24gZ2V0V29ya2VySGVscGVyKHByb3h5SW5zdGFuY2UpIHtcclxuICAgICAgICBpZiAoIXByb3h5SW5zdGFuY2UuX193b3JrZXJIZWxwZXIpIHtcclxuICAgICAgICAgICAgaWYgKCFwcm94eUluc3RhbmNlLl9fd29ya2VySGVscGVySW5pdEFyZ3MpIHtcclxuICAgICAgICAgICAgICAgIHRocm93ICdhc3luY1Byb3h5IGVycm9yOiBhc3luY1Byb3h5RmFjdG9yeS5pbml0aWFsaXplKCkgbm90IGNhbGxlZCB5ZXQnO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBwcm94eUluc3RhbmNlLl9fd29ya2VySGVscGVyID0gbmV3IEFzeW5jUHJveHlNYXN0ZXIoXHJcbiAgICAgICAgICAgICAgICBwcm94eUluc3RhbmNlLl9fd29ya2VySGVscGVySW5pdEFyZ3Muc2NyaXB0c1RvSW1wb3J0LFxyXG4gICAgICAgICAgICAgICAgcHJveHlJbnN0YW5jZS5fX3dvcmtlckhlbHBlckluaXRBcmdzLmN0b3JOYW1lLFxyXG4gICAgICAgICAgICAgICAgcHJveHlJbnN0YW5jZS5fX3dvcmtlckhlbHBlckluaXRBcmdzLmN0b3JBcmdzIHx8IFtdKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgcmV0dXJuIHByb3h5SW5zdGFuY2UuX193b3JrZXJIZWxwZXI7XHJcbiAgICB9O1xyXG5cclxuICAgIHJldHVybiBmYWN0b3J5U2luZ2xldG9uO1xyXG59KSgpO1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBBc3luY1Byb3h5RmFjdG9yeTsiLCIndXNlIHN0cmljdCc7XHJcblxyXG4vKiBnbG9iYWwgUHJvbWlzZTogZmFsc2UgKi9cclxuXHJcbnZhciBTY3JpcHRzVG9JbXBvcnRQb29sID0gcmVxdWlyZSgnc2NyaXB0cy10by1pbXBvcnQtcG9vbCcpO1xyXG5cclxudmFyIEFzeW5jUHJveHlNYXN0ZXIgPSAoZnVuY3Rpb24gQXN5bmNQcm94eU1hc3RlckNsb3N1cmUoKSB7XHJcbiAgICB2YXIgY2FsbElkID0gMDtcclxuICAgIHZhciBpc0dldE1hc3RlckVudHJ5VXJsQ2FsbGVkID0gZmFsc2U7XHJcbiAgICB2YXIgbWFzdGVyRW50cnlVcmwgPSBnZXRCYXNlVXJsRnJvbUVudHJ5U2NyaXB0KCk7XHJcbiAgICBcclxuICAgIGZ1bmN0aW9uIEFzeW5jUHJveHlNYXN0ZXIoc2NyaXB0c1RvSW1wb3J0LCBjdG9yTmFtZSwgY3RvckFyZ3MsIG9wdGlvbnMpIHtcclxuICAgICAgICB2YXIgdGhhdCA9IHRoaXM7XHJcbiAgICAgICAgb3B0aW9ucyA9IG9wdGlvbnMgfHwge307XHJcbiAgICAgICAgXHJcbiAgICAgICAgdGhhdC5fY2FsbGJhY2tzID0gW107XHJcbiAgICAgICAgdGhhdC5fcGVuZGluZ1Byb21pc2VDYWxscyA9IFtdO1xyXG4gICAgICAgIHRoYXQuX3N1YldvcmtlckJ5SWQgPSBbXTtcclxuICAgICAgICB0aGF0Ll9zdWJXb3JrZXJzID0gW107XHJcbiAgICAgICAgdGhhdC5fdXNlckRhdGFIYW5kbGVyID0gbnVsbDtcclxuICAgICAgICB0aGF0Ll9ub3RSZXR1cm5lZEZ1bmN0aW9ucyA9IDA7XHJcbiAgICAgICAgdGhhdC5fZnVuY3Rpb25zQnVmZmVyU2l6ZSA9IG9wdGlvbnMuZnVuY3Rpb25zQnVmZmVyU2l6ZSB8fCA1O1xyXG4gICAgICAgIHRoYXQuX3BlbmRpbmdNZXNzYWdlcyA9IFtdO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHZhciBzY3JpcHROYW1lID0gZ2V0U2NyaXB0TmFtZSgpO1xyXG4gICAgICAgIHZhciBzbGF2ZVNjcmlwdENvbnRlbnRTdHJpbmcgPSBtYWluU2xhdmVTY3JpcHRDb250ZW50LnRvU3RyaW5nKCk7XHJcbiAgICAgICAgc2xhdmVTY3JpcHRDb250ZW50U3RyaW5nID0gc2xhdmVTY3JpcHRDb250ZW50U3RyaW5nLnJlcGxhY2UoXHJcbiAgICAgICAgICAgICdTQ1JJUFRfUExBQ0VIT0xERVInLCBzY3JpcHROYW1lKTtcclxuICAgICAgICB2YXIgc2xhdmVTY3JpcHRDb250ZW50QmxvYiA9IG5ldyBCbG9iKFxyXG4gICAgICAgICAgICBbJygnLCBzbGF2ZVNjcmlwdENvbnRlbnRTdHJpbmcsICcpKCknXSxcclxuICAgICAgICAgICAgeyB0eXBlOiAnYXBwbGljYXRpb24vamF2YXNjcmlwdCcgfSk7XHJcbiAgICAgICAgdmFyIHNsYXZlU2NyaXB0VXJsID0gVVJMLmNyZWF0ZU9iamVjdFVSTChzbGF2ZVNjcmlwdENvbnRlbnRCbG9iKTtcclxuXHJcbiAgICAgICAgdGhhdC5fd29ya2VyID0gbmV3IFdvcmtlcihzbGF2ZVNjcmlwdFVybCk7XHJcbiAgICAgICAgdGhhdC5fd29ya2VyLm9ubWVzc2FnZSA9IG9uV29ya2VyTWVzc2FnZUludGVybmFsO1xyXG5cclxuICAgICAgICB0aGF0Ll93b3JrZXIucG9zdE1lc3NhZ2Uoe1xyXG4gICAgICAgICAgICBmdW5jdGlvblRvQ2FsbDogJ2N0b3InLFxyXG4gICAgICAgICAgICBzY3JpcHRzVG9JbXBvcnQ6IHNjcmlwdHNUb0ltcG9ydCxcclxuICAgICAgICAgICAgY3Rvck5hbWU6IGN0b3JOYW1lLFxyXG4gICAgICAgICAgICBhcmdzOiBjdG9yQXJncyxcclxuICAgICAgICAgICAgY2FsbElkOiArK2NhbGxJZCxcclxuICAgICAgICAgICAgaXNQcm9taXNlOiBmYWxzZSxcclxuICAgICAgICAgICAgbWFzdGVyRW50cnlVcmw6IEFzeW5jUHJveHlNYXN0ZXIuZ2V0RW50cnlVcmwoKVxyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGZ1bmN0aW9uIG9uV29ya2VyTWVzc2FnZUludGVybmFsKHdvcmtlckV2ZW50KSB7XHJcbiAgICAgICAgICAgIG9uV29ya2VyTWVzc2FnZSh0aGF0LCB3b3JrZXJFdmVudCk7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgXHJcbiAgICBBc3luY1Byb3h5TWFzdGVyLnByb3RvdHlwZS5zZXRVc2VyRGF0YUhhbmRsZXIgPSBmdW5jdGlvbiBzZXRVc2VyRGF0YUhhbmRsZXIodXNlckRhdGFIYW5kbGVyKSB7XHJcbiAgICAgICAgdGhpcy5fdXNlckRhdGFIYW5kbGVyID0gdXNlckRhdGFIYW5kbGVyO1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgQXN5bmNQcm94eU1hc3Rlci5wcm90b3R5cGUudGVybWluYXRlID0gZnVuY3Rpb24gdGVybWluYXRlKCkge1xyXG4gICAgICAgIHRoaXMuX3dvcmtlci50ZXJtaW5hdGUoKTtcclxuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IHRoaXMuX3N1YldvcmtlcnMubGVuZ3RoOyArK2kpIHtcclxuICAgICAgICAgICAgdGhpcy5fc3ViV29ya2Vyc1tpXS50ZXJtaW5hdGUoKTtcclxuICAgICAgICB9XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBBc3luY1Byb3h5TWFzdGVyLnByb3RvdHlwZS5jYWxsRnVuY3Rpb24gPSBmdW5jdGlvbiBjYWxsRnVuY3Rpb24oZnVuY3Rpb25Ub0NhbGwsIGFyZ3MsIG9wdGlvbnMpIHtcclxuICAgICAgICBvcHRpb25zID0gb3B0aW9ucyB8fCB7fTtcclxuICAgICAgICB2YXIgaXNSZXR1cm5Qcm9taXNlID0gISFvcHRpb25zLmlzUmV0dXJuUHJvbWlzZTtcclxuICAgICAgICB2YXIgdHJhbnNmZXJhYmxlc0FyZyA9IG9wdGlvbnMudHJhbnNmZXJhYmxlcyB8fCBbXTtcclxuICAgICAgICB2YXIgcGF0aHNUb1RyYW5zZmVyYWJsZXMgPVxyXG4gICAgICAgICAgICBvcHRpb25zLnBhdGhzVG9UcmFuc2ZlcmFibGVzSW5Qcm9taXNlUmVzdWx0O1xyXG4gICAgICAgIFxyXG4gICAgICAgIHZhciBsb2NhbENhbGxJZCA9ICsrY2FsbElkO1xyXG4gICAgICAgIHZhciBwcm9taXNlT25NYXN0ZXJTaWRlID0gbnVsbDtcclxuICAgICAgICB2YXIgdGhhdCA9IHRoaXM7XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKGlzUmV0dXJuUHJvbWlzZSkge1xyXG4gICAgICAgICAgICBwcm9taXNlT25NYXN0ZXJTaWRlID0gbmV3IFByb21pc2UoZnVuY3Rpb24gcHJvbWlzZUZ1bmMocmVzb2x2ZSwgcmVqZWN0KSB7XHJcbiAgICAgICAgICAgICAgICB0aGF0Ll9wZW5kaW5nUHJvbWlzZUNhbGxzW2xvY2FsQ2FsbElkXSA9IHtcclxuICAgICAgICAgICAgICAgICAgICByZXNvbHZlOiByZXNvbHZlLFxyXG4gICAgICAgICAgICAgICAgICAgIHJlamVjdDogcmVqZWN0XHJcbiAgICAgICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgdmFyIHNlbmRNZXNzYWdlRnVuY3Rpb24gPSBvcHRpb25zLmlzU2VuZEltbWVkaWF0ZWx5ID9cclxuICAgICAgICAgICAgc2VuZE1lc3NhZ2VUb1NsYXZlOiBlbnF1ZXVlTWVzc2FnZVRvU2xhdmU7XHJcbiAgICAgICAgXHJcbiAgICAgICAgdmFyIHRyYW5zZmVyYWJsZXM7XHJcbiAgICAgICAgaWYgKHR5cGVvZiB0cmFuc2ZlcmFibGVzQXJnID09PSAnZnVuY3Rpb24nKSB7XHJcbiAgICAgICAgICAgIHRyYW5zZmVyYWJsZXMgPSB0cmFuc2ZlcmFibGVzQXJnKCk7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgdHJhbnNmZXJhYmxlcyA9IEFzeW5jUHJveHlNYXN0ZXIuX2V4dHJhY3RUcmFuc2ZlcmFibGVzKFxyXG4gICAgICAgICAgICAgICAgdHJhbnNmZXJhYmxlc0FyZywgYXJncyk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHNlbmRNZXNzYWdlRnVuY3Rpb24odGhpcywgdHJhbnNmZXJhYmxlcywgLyppc0Z1bmN0aW9uQ2FsbD0qL3RydWUsIHtcclxuICAgICAgICAgICAgZnVuY3Rpb25Ub0NhbGw6IGZ1bmN0aW9uVG9DYWxsLFxyXG4gICAgICAgICAgICBhcmdzOiBhcmdzIHx8IFtdLFxyXG4gICAgICAgICAgICBjYWxsSWQ6IGxvY2FsQ2FsbElkLFxyXG4gICAgICAgICAgICBpc1Byb21pc2U6IGlzUmV0dXJuUHJvbWlzZSxcclxuICAgICAgICAgICAgcGF0aHNUb1RyYW5zZmVyYWJsZXNJblByb21pc2VSZXN1bHQgOiBwYXRoc1RvVHJhbnNmZXJhYmxlc1xyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGlmIChpc1JldHVyblByb21pc2UpIHtcclxuICAgICAgICAgICAgcmV0dXJuIHByb21pc2VPbk1hc3RlclNpZGU7XHJcbiAgICAgICAgfVxyXG4gICAgfTtcclxuICAgIFxyXG4gICAgQXN5bmNQcm94eU1hc3Rlci5wcm90b3R5cGUud3JhcENhbGxiYWNrID0gZnVuY3Rpb24gd3JhcENhbGxiYWNrKFxyXG4gICAgICAgIGNhbGxiYWNrLCBjYWxsYmFja05hbWUsIG9wdGlvbnMpIHtcclxuICAgICAgICBcclxuICAgICAgICBvcHRpb25zID0gb3B0aW9ucyB8fCB7fTtcclxuICAgICAgICB2YXIgbG9jYWxDYWxsSWQgPSArK2NhbGxJZDtcclxuICAgICAgICBcclxuICAgICAgICB2YXIgY2FsbGJhY2tIYW5kbGUgPSB7XHJcbiAgICAgICAgICAgIGlzV29ya2VySGVscGVyQ2FsbGJhY2s6IHRydWUsXHJcbiAgICAgICAgICAgIGlzTXVsdGlwbGVUaW1lQ2FsbGJhY2s6ICEhb3B0aW9ucy5pc011bHRpcGxlVGltZUNhbGxiYWNrLFxyXG4gICAgICAgICAgICBjYWxsSWQ6IGxvY2FsQ2FsbElkLFxyXG4gICAgICAgICAgICBjYWxsYmFja05hbWU6IGNhbGxiYWNrTmFtZSxcclxuICAgICAgICAgICAgcGF0aHNUb1RyYW5zZmVyYWJsZXM6IG9wdGlvbnMucGF0aHNUb1RyYW5zZmVyYWJsZXNcclxuICAgICAgICB9O1xyXG4gICAgICAgIFxyXG4gICAgICAgIHZhciBpbnRlcm5hbENhbGxiYWNrSGFuZGxlID0ge1xyXG4gICAgICAgICAgICBpc011bHRpcGxlVGltZUNhbGxiYWNrOiAhIW9wdGlvbnMuaXNNdWx0aXBsZVRpbWVDYWxsYmFjayxcclxuICAgICAgICAgICAgY2FsbElkOiBsb2NhbENhbGxJZCxcclxuICAgICAgICAgICAgY2FsbGJhY2s6IGNhbGxiYWNrLFxyXG4gICAgICAgICAgICBwYXRoc1RvVHJhbnNmZXJhYmxlczogb3B0aW9ucy5wYXRoc1RvVHJhbnNmZXJhYmxlc1xyXG4gICAgICAgIH07XHJcbiAgICAgICAgXHJcbiAgICAgICAgdGhpcy5fY2FsbGJhY2tzW2xvY2FsQ2FsbElkXSA9IGludGVybmFsQ2FsbGJhY2tIYW5kbGU7XHJcbiAgICAgICAgXHJcbiAgICAgICAgcmV0dXJuIGNhbGxiYWNrSGFuZGxlO1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgQXN5bmNQcm94eU1hc3Rlci5wcm90b3R5cGUuZnJlZUNhbGxiYWNrID0gZnVuY3Rpb24gZnJlZUNhbGxiYWNrKGNhbGxiYWNrSGFuZGxlKSB7XHJcbiAgICAgICAgZGVsZXRlIHRoaXMuX2NhbGxiYWNrc1tjYWxsYmFja0hhbmRsZS5jYWxsSWRdO1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgLy8gU3RhdGljIGZ1bmN0aW9uc1xyXG4gICAgXHJcbiAgICBBc3luY1Byb3h5TWFzdGVyLmdldEVudHJ5VXJsID0gZnVuY3Rpb24gZ2V0RW50cnlVcmwoKSB7XHJcbiAgICAgICAgaXNHZXRNYXN0ZXJFbnRyeVVybENhbGxlZCA9IHRydWU7XHJcbiAgICAgICAgcmV0dXJuIG1hc3RlckVudHJ5VXJsO1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgQXN5bmNQcm94eU1hc3Rlci5fc2V0RW50cnlVcmwgPSBmdW5jdGlvbiBzZXRFbnRyeVVybChuZXdVcmwpIHtcclxuICAgICAgICBpZiAobWFzdGVyRW50cnlVcmwgIT09IG5ld1VybCAmJiBpc0dldE1hc3RlckVudHJ5VXJsQ2FsbGVkKSB7XHJcbiAgICAgICAgICAgIHRocm93ICdQcmV2aW91cyB2YWx1ZXMgcmV0dXJuZWQgZnJvbSBnZXRNYXN0ZXJFbnRyeVVybCAnICtcclxuICAgICAgICAgICAgICAgICdpcyB3cm9uZy4gQXZvaWQgY2FsbGluZyBpdCB3aXRoaW4gdGhlIHNsYXZlIGNgdG9yJztcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIG1hc3RlckVudHJ5VXJsID0gbmV3VXJsO1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgQXN5bmNQcm94eU1hc3Rlci5fZXh0cmFjdFRyYW5zZmVyYWJsZXMgPSBmdW5jdGlvbiBleHRyYWN0VHJhbnNmZXJhYmxlcyhcclxuICAgICAgICAgICAgcGF0aHNUb1RyYW5zZmVyYWJsZXMsIHBhdGhzQmFzZSkge1xyXG4gICAgICAgIFxyXG4gICAgICAgIGlmIChwYXRoc1RvVHJhbnNmZXJhYmxlcyA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgICAgIHJldHVybiB1bmRlZmluZWQ7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHZhciB0cmFuc2ZlcmFibGVzID0gbmV3IEFycmF5KHBhdGhzVG9UcmFuc2ZlcmFibGVzLmxlbmd0aCk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBwYXRoc1RvVHJhbnNmZXJhYmxlcy5sZW5ndGg7ICsraSkge1xyXG4gICAgICAgICAgICB2YXIgcGF0aCA9IHBhdGhzVG9UcmFuc2ZlcmFibGVzW2ldO1xyXG4gICAgICAgICAgICB2YXIgdHJhbnNmZXJhYmxlID0gcGF0aHNCYXNlO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgZm9yICh2YXIgaiA9IDA7IGogPCBwYXRoLmxlbmd0aDsgKytqKSB7XHJcbiAgICAgICAgICAgICAgICB2YXIgbWVtYmVyID0gcGF0aFtqXTtcclxuICAgICAgICAgICAgICAgIHRyYW5zZmVyYWJsZSA9IHRyYW5zZmVyYWJsZVttZW1iZXJdO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICB0cmFuc2ZlcmFibGVzW2ldID0gdHJhbnNmZXJhYmxlO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICByZXR1cm4gdHJhbnNmZXJhYmxlcztcclxuICAgIH07XHJcbiAgICBcclxuICAgIC8vIFByaXZhdGUgZnVuY3Rpb25zXHJcbiAgICBcclxuICAgIGZ1bmN0aW9uIGdldFNjcmlwdE5hbWUoKSB7XHJcbiAgICAgICAgdmFyIGVycm9yID0gbmV3IEVycm9yKCk7XHJcbiAgICAgICAgcmV0dXJuIFNjcmlwdHNUb0ltcG9ydFBvb2wuX2dldFNjcmlwdE5hbWUoZXJyb3IpO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBmdW5jdGlvbiBtYWluU2xhdmVTY3JpcHRDb250ZW50KCkge1xyXG4gICAgICAgIC8vIFRoaXMgZnVuY3Rpb24gaXMgbm90IHJ1biBkaXJlY3RseTogSXQgY29waWVkIGFzIGEgc3RyaW5nIGludG8gYSBibG9iXHJcbiAgICAgICAgLy8gYW5kIHJ1biBpbiB0aGUgV2ViIFdvcmtlciBnbG9iYWwgc2NvcGVcclxuICAgICAgICBcclxuICAgICAgICAvKiBnbG9iYWwgaW1wb3J0U2NyaXB0czogZmFsc2UgKi9cclxuICAgICAgICBpbXBvcnRTY3JpcHRzKCdTQ1JJUFRfUExBQ0VIT0xERVInKTtcclxuICAgICAgICAvKiBnbG9iYWwgYXN5bmNQcm94eTogZmFsc2UgKi9cclxuICAgICAgICBhc3luY1Byb3h5LkFzeW5jUHJveHlTbGF2ZS5faW5pdGlhbGl6ZVNsYXZlKCk7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGZ1bmN0aW9uIG9uV29ya2VyTWVzc2FnZSh0aGF0LCB3b3JrZXJFdmVudCkge1xyXG4gICAgICAgIHZhciBjYWxsSWQgPSB3b3JrZXJFdmVudC5kYXRhLmNhbGxJZDtcclxuICAgICAgICBcclxuICAgICAgICBzd2l0Y2ggKHdvcmtlckV2ZW50LmRhdGEudHlwZSkge1xyXG4gICAgICAgICAgICBjYXNlICdmdW5jdGlvbkNhbGxlZCc6XHJcbiAgICAgICAgICAgICAgICAtLXRoYXQuX25vdFJldHVybmVkRnVuY3Rpb25zO1xyXG4gICAgICAgICAgICAgICAgdHJ5U2VuZFBlbmRpbmdNZXNzYWdlcyh0aGF0KTtcclxuICAgICAgICAgICAgICAgIGJyZWFrO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgY2FzZSAncHJvbWlzZVJlc3VsdCc6XHJcbiAgICAgICAgICAgICAgICB2YXIgcHJvbWlzZVRvUmVzb2x2ZSA9IHRoYXQuX3BlbmRpbmdQcm9taXNlQ2FsbHNbY2FsbElkXTtcclxuICAgICAgICAgICAgICAgIGRlbGV0ZSB0aGF0Ll9wZW5kaW5nUHJvbWlzZUNhbGxzW2NhbGxJZF07XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIHZhciByZXN1bHQgPSB3b3JrZXJFdmVudC5kYXRhLnJlc3VsdDtcclxuICAgICAgICAgICAgICAgIHByb21pc2VUb1Jlc29sdmUucmVzb2x2ZShyZXN1bHQpO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICBicmVhaztcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGNhc2UgJ3Byb21pc2VGYWlsdXJlJzpcclxuICAgICAgICAgICAgICAgIHZhciBwcm9taXNlVG9SZWplY3QgPSB0aGF0Ll9wZW5kaW5nUHJvbWlzZUNhbGxzW2NhbGxJZF07XHJcbiAgICAgICAgICAgICAgICBkZWxldGUgdGhhdC5fcGVuZGluZ1Byb21pc2VDYWxsc1tjYWxsSWRdO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICB2YXIgcmVhc29uID0gd29ya2VyRXZlbnQuZGF0YS5yZWFzb247XHJcbiAgICAgICAgICAgICAgICBwcm9taXNlVG9SZWplY3QucmVqZWN0KHJlYXNvbik7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIGJyZWFrO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgY2FzZSAndXNlckRhdGEnOlxyXG4gICAgICAgICAgICAgICAgaWYgKHRoYXQuX3VzZXJEYXRhSGFuZGxlciAhPT0gbnVsbCkge1xyXG4gICAgICAgICAgICAgICAgICAgIHRoYXQuX3VzZXJEYXRhSGFuZGxlcih3b3JrZXJFdmVudC5kYXRhLnVzZXJEYXRhKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgYnJlYWs7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBjYXNlICdjYWxsYmFjayc6XHJcbiAgICAgICAgICAgICAgICB2YXIgY2FsbGJhY2tIYW5kbGUgPSB0aGF0Ll9jYWxsYmFja3Nbd29ya2VyRXZlbnQuZGF0YS5jYWxsSWRdO1xyXG4gICAgICAgICAgICAgICAgaWYgKGNhbGxiYWNrSGFuZGxlID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICAgICAgICAgICAgICB0aHJvdyAnVW5leHBlY3RlZCBtZXNzYWdlIGZyb20gU2xhdmVXb3JrZXIgb2YgY2FsbGJhY2sgSUQ6ICcgK1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB3b3JrZXJFdmVudC5kYXRhLmNhbGxJZCArICcuIE1heWJlIHNob3VsZCBpbmRpY2F0ZSAnICtcclxuICAgICAgICAgICAgICAgICAgICAgICAgJ2lzTXVsdGlwbGVUaW1lc0NhbGxiYWNrID0gdHJ1ZSBvbiBjcmVhdGlvbj8nO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICBpZiAoIWNhbGxiYWNrSGFuZGxlLmlzTXVsdGlwbGVUaW1lQ2FsbGJhY2spIHtcclxuICAgICAgICAgICAgICAgICAgICB0aGF0LmZyZWVDYWxsYmFjayh0aGF0Ll9jYWxsYmFja3Nbd29ya2VyRXZlbnQuZGF0YS5jYWxsSWRdKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgaWYgKGNhbGxiYWNrSGFuZGxlLmNhbGxiYWNrICE9PSBudWxsKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY2FsbGJhY2tIYW5kbGUuY2FsbGJhY2suYXBwbHkobnVsbCwgd29ya2VyRXZlbnQuZGF0YS5hcmdzKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgYnJlYWs7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBjYXNlICdzdWJXb3JrZXJDdG9yJzpcclxuICAgICAgICAgICAgICAgIHZhciBzdWJXb3JrZXJDcmVhdGVkID0gbmV3IFdvcmtlcih3b3JrZXJFdmVudC5kYXRhLnNjcmlwdFVybCk7XHJcbiAgICAgICAgICAgICAgICB2YXIgaWQgPSB3b3JrZXJFdmVudC5kYXRhLnN1YldvcmtlcklkO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICB0aGF0Ll9zdWJXb3JrZXJCeUlkW2lkXSA9IHN1YldvcmtlckNyZWF0ZWQ7XHJcbiAgICAgICAgICAgICAgICB0aGF0Ll9zdWJXb3JrZXJzLnB1c2goc3ViV29ya2VyQ3JlYXRlZCk7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIHN1YldvcmtlckNyZWF0ZWQub25tZXNzYWdlID0gZnVuY3Rpb24gb25TdWJXb3JrZXJNZXNzYWdlKHN1YldvcmtlckV2ZW50KSB7XHJcbiAgICAgICAgICAgICAgICAgICAgZW5xdWV1ZU1lc3NhZ2VUb1NsYXZlKFxyXG4gICAgICAgICAgICAgICAgICAgICAgICB0aGF0LCBzdWJXb3JrZXJFdmVudC5wb3J0cywgLyppc0Z1bmN0aW9uQ2FsbD0qL2ZhbHNlLCB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBmdW5jdGlvblRvQ2FsbDogJ3N1Yldvcmtlck9uTWVzc2FnZScsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBzdWJXb3JrZXJJZDogaWQsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBkYXRhOiBzdWJXb3JrZXJFdmVudC5kYXRhXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgfTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgYnJlYWs7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBjYXNlICdzdWJXb3JrZXJQb3N0TWVzc2FnZSc6XHJcbiAgICAgICAgICAgICAgICB2YXIgc3ViV29ya2VyVG9Qb3N0TWVzc2FnZSA9IHRoYXQuX3N1YldvcmtlckJ5SWRbd29ya2VyRXZlbnQuZGF0YS5zdWJXb3JrZXJJZF07XHJcbiAgICAgICAgICAgICAgICBzdWJXb3JrZXJUb1Bvc3RNZXNzYWdlLnBvc3RNZXNzYWdlKHdvcmtlckV2ZW50LmRhdGEuZGF0YSk7XHJcbiAgICAgICAgICAgICAgICBicmVhaztcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGNhc2UgJ3N1YldvcmtlclRlcm1pbmF0ZSc6XHJcbiAgICAgICAgICAgICAgICB2YXIgc3ViV29ya2VyVG9UZXJtaW5hdGUgPSB0aGF0Ll9zdWJXb3JrZXJCeUlkW3dvcmtlckV2ZW50LmRhdGEuc3ViV29ya2VySWRdO1xyXG4gICAgICAgICAgICAgICAgc3ViV29ya2VyVG9UZXJtaW5hdGUudGVybWluYXRlKCk7XHJcbiAgICAgICAgICAgICAgICBicmVhaztcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGRlZmF1bHQ6XHJcbiAgICAgICAgICAgICAgICB0aHJvdyAnVW5rbm93biBtZXNzYWdlIGZyb20gQXN5bmNQcm94eVNsYXZlIG9mIHR5cGU6ICcgK1xyXG4gICAgICAgICAgICAgICAgICAgIHdvcmtlckV2ZW50LmRhdGEudHlwZTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGZ1bmN0aW9uIGVucXVldWVNZXNzYWdlVG9TbGF2ZShcclxuICAgICAgICB0aGF0LCB0cmFuc2ZlcmFibGVzLCBpc0Z1bmN0aW9uQ2FsbCwgbWVzc2FnZSkge1xyXG4gICAgICAgIFxyXG4gICAgICAgIGlmICh0aGF0Ll9ub3RSZXR1cm5lZEZ1bmN0aW9ucyA+PSB0aGF0Ll9mdW5jdGlvbnNCdWZmZXJTaXplKSB7XHJcbiAgICAgICAgICAgIHRoYXQuX3BlbmRpbmdNZXNzYWdlcy5wdXNoKHtcclxuICAgICAgICAgICAgICAgIHRyYW5zZmVyYWJsZXM6IHRyYW5zZmVyYWJsZXMsXHJcbiAgICAgICAgICAgICAgICBpc0Z1bmN0aW9uQ2FsbDogaXNGdW5jdGlvbkNhbGwsXHJcbiAgICAgICAgICAgICAgICBtZXNzYWdlOiBtZXNzYWdlXHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHNlbmRNZXNzYWdlVG9TbGF2ZSh0aGF0LCB0cmFuc2ZlcmFibGVzLCBpc0Z1bmN0aW9uQ2FsbCwgbWVzc2FnZSk7XHJcbiAgICB9XHJcbiAgICAgICAgXHJcbiAgICBmdW5jdGlvbiBzZW5kTWVzc2FnZVRvU2xhdmUoXHJcbiAgICAgICAgdGhhdCwgdHJhbnNmZXJhYmxlcywgaXNGdW5jdGlvbkNhbGwsIG1lc3NhZ2UpIHtcclxuICAgICAgICBcclxuICAgICAgICBpZiAoaXNGdW5jdGlvbkNhbGwpIHtcclxuICAgICAgICAgICAgKyt0aGF0Ll9ub3RSZXR1cm5lZEZ1bmN0aW9ucztcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgdGhhdC5fd29ya2VyLnBvc3RNZXNzYWdlKG1lc3NhZ2UsIHRyYW5zZmVyYWJsZXMpO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBmdW5jdGlvbiB0cnlTZW5kUGVuZGluZ01lc3NhZ2VzKHRoYXQpIHtcclxuICAgICAgICB3aGlsZSAodGhhdC5fbm90UmV0dXJuZWRGdW5jdGlvbnMgPCB0aGF0Ll9mdW5jdGlvbnNCdWZmZXJTaXplICYmXHJcbiAgICAgICAgICAgICAgIHRoYXQuX3BlbmRpbmdNZXNzYWdlcy5sZW5ndGggPiAwKSB7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICB2YXIgbWVzc2FnZSA9IHRoYXQuX3BlbmRpbmdNZXNzYWdlcy5zaGlmdCgpO1xyXG4gICAgICAgICAgICBzZW5kTWVzc2FnZVRvU2xhdmUoXHJcbiAgICAgICAgICAgICAgICB0aGF0LFxyXG4gICAgICAgICAgICAgICAgbWVzc2FnZS50cmFuc2ZlcmFibGVzLFxyXG4gICAgICAgICAgICAgICAgbWVzc2FnZS5pc0Z1bmN0aW9uQ2FsbCxcclxuICAgICAgICAgICAgICAgIG1lc3NhZ2UubWVzc2FnZSk7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgXHJcbiAgICBmdW5jdGlvbiBnZXRCYXNlVXJsRnJvbUVudHJ5U2NyaXB0KCkge1xyXG4gICAgICAgIHZhciBiYXNlVXJsID0gbG9jYXRpb24uaHJlZjtcclxuICAgICAgICB2YXIgZW5kT2ZQYXRoID0gYmFzZVVybC5sYXN0SW5kZXhPZignLycpO1xyXG4gICAgICAgIGlmIChlbmRPZlBhdGggPj0gMCkge1xyXG4gICAgICAgICAgICBiYXNlVXJsID0gYmFzZVVybC5zdWJzdHJpbmcoMCwgZW5kT2ZQYXRoKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgcmV0dXJuIGJhc2VVcmw7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHJldHVybiBBc3luY1Byb3h5TWFzdGVyO1xyXG59KSgpO1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBBc3luY1Byb3h5TWFzdGVyOyIsIid1c2Ugc3RyaWN0JztcclxuXHJcbi8qIGdsb2JhbCBjb25zb2xlOiBmYWxzZSAqL1xyXG4vKiBnbG9iYWwgc2VsZjogZmFsc2UgKi9cclxuXHJcbnZhciBBc3luY1Byb3h5TWFzdGVyID0gcmVxdWlyZSgnYXN5bmMtcHJveHktbWFzdGVyJyk7XHJcbnZhciBTdWJXb3JrZXJFbXVsYXRpb25Gb3JDaHJvbWUgPSByZXF1aXJlKCdzdWItd29ya2VyLWVtdWxhdGlvbi1mb3ItY2hyb21lJyk7XHJcblxyXG52YXIgQXN5bmNQcm94eVNsYXZlID0gKGZ1bmN0aW9uIEFzeW5jUHJveHlTbGF2ZUNsb3N1cmUoKSB7XHJcbiAgICB2YXIgc2xhdmVIZWxwZXJTaW5nbGV0b24gPSB7fTtcclxuICAgIFxyXG4gICAgdmFyIGJlZm9yZU9wZXJhdGlvbkxpc3RlbmVyID0gbnVsbDtcclxuICAgIHZhciBzbGF2ZVNpZGVNYWluSW5zdGFuY2U7XHJcbiAgICB2YXIgc2xhdmVTaWRlSW5zdGFuY2VDcmVhdG9yID0gZGVmYXVsdEluc3RhbmNlQ3JlYXRvcjtcclxuICAgIHZhciBzdWJXb3JrZXJJZFRvU3ViV29ya2VyID0ge307XHJcbiAgICB2YXIgY3Rvck5hbWU7XHJcbiAgICBcclxuICAgIHNsYXZlSGVscGVyU2luZ2xldG9uLl9pbml0aWFsaXplU2xhdmUgPSBmdW5jdGlvbiBpbml0aWFsaXplU2xhdmUoKSB7XHJcbiAgICAgICAgc2VsZi5vbm1lc3NhZ2UgPSBvbk1lc3NhZ2U7XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBzbGF2ZUhlbHBlclNpbmdsZXRvbi5zZXRTbGF2ZVNpZGVDcmVhdG9yID0gZnVuY3Rpb24gc2V0U2xhdmVTaWRlQ3JlYXRvcihjcmVhdG9yKSB7XHJcbiAgICAgICAgc2xhdmVTaWRlSW5zdGFuY2VDcmVhdG9yID0gY3JlYXRvcjtcclxuICAgIH07XHJcbiAgICBcclxuICAgIHNsYXZlSGVscGVyU2luZ2xldG9uLnNldEJlZm9yZU9wZXJhdGlvbkxpc3RlbmVyID1cclxuICAgICAgICBmdW5jdGlvbiBzZXRCZWZvcmVPcGVyYXRpb25MaXN0ZW5lcihsaXN0ZW5lcikge1xyXG4gICAgICAgICAgICBiZWZvcmVPcGVyYXRpb25MaXN0ZW5lciA9IGxpc3RlbmVyO1xyXG4gICAgICAgIH07XHJcbiAgICAgICAgXHJcbiAgICBzbGF2ZUhlbHBlclNpbmdsZXRvbi5zZW5kVXNlckRhdGFUb01hc3RlciA9IGZ1bmN0aW9uIHNlbmRVc2VyRGF0YVRvTWFzdGVyKFxyXG4gICAgICAgIHVzZXJEYXRhKSB7XHJcbiAgICAgICAgXHJcbiAgICAgICAgc2VsZi5wb3N0TWVzc2FnZSh7XHJcbiAgICAgICAgICAgIHR5cGU6ICd1c2VyRGF0YScsXHJcbiAgICAgICAgICAgIHVzZXJEYXRhOiB1c2VyRGF0YVxyXG4gICAgICAgIH0pO1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgc2xhdmVIZWxwZXJTaW5nbGV0b24ud3JhcFByb21pc2VGcm9tU2xhdmVTaWRlID1cclxuICAgICAgICBmdW5jdGlvbiB3cmFwUHJvbWlzZUZyb21TbGF2ZVNpZGUoXHJcbiAgICAgICAgICAgIGNhbGxJZCwgcHJvbWlzZSwgcGF0aHNUb1RyYW5zZmVyYWJsZXMpIHtcclxuICAgICAgICBcclxuICAgICAgICB2YXIgcHJvbWlzZVRoZW4gPSBwcm9taXNlLnRoZW4oZnVuY3Rpb24gc2VuZFByb21pc2VUb01hc3RlcihyZXN1bHQpIHtcclxuICAgICAgICAgICAgdmFyIHRyYW5zZmVyYWJsZXMgPVxyXG4gICAgICAgICAgICAgICAgQXN5bmNQcm94eU1hc3Rlci5fZXh0cmFjdFRyYW5zZmVyYWJsZXMoXHJcbiAgICAgICAgICAgICAgICAgICAgcGF0aHNUb1RyYW5zZmVyYWJsZXMsIHJlc3VsdCk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBzZWxmLnBvc3RNZXNzYWdlKFxyXG4gICAgICAgICAgICAgICAge1xyXG4gICAgICAgICAgICAgICAgICAgIHR5cGU6ICdwcm9taXNlUmVzdWx0JyxcclxuICAgICAgICAgICAgICAgICAgICBjYWxsSWQ6IGNhbGxJZCxcclxuICAgICAgICAgICAgICAgICAgICByZXN1bHQ6IHJlc3VsdFxyXG4gICAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgICAgIHRyYW5zZmVyYWJsZXMpO1xyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHByb21pc2VUaGVuWydjYXRjaCddKGZ1bmN0aW9uIHNlbmRGYWlsdXJlVG9NYXN0ZXIocmVhc29uKSB7XHJcbiAgICAgICAgICAgIHNlbGYucG9zdE1lc3NhZ2Uoe1xyXG4gICAgICAgICAgICAgICAgdHlwZTogJ3Byb21pc2VGYWlsdXJlJyxcclxuICAgICAgICAgICAgICAgIGNhbGxJZDogY2FsbElkLFxyXG4gICAgICAgICAgICAgICAgcmVhc29uOiByZWFzb25cclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgfSk7XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBzbGF2ZUhlbHBlclNpbmdsZXRvbi53cmFwQ2FsbGJhY2tGcm9tU2xhdmVTaWRlID1cclxuICAgICAgICBmdW5jdGlvbiB3cmFwQ2FsbGJhY2tGcm9tU2xhdmVTaWRlKGNhbGxiYWNrSGFuZGxlKSB7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgIHZhciBpc0FscmVhZHlDYWxsZWQgPSBmYWxzZTtcclxuICAgICAgICBcclxuICAgICAgICBmdW5jdGlvbiBjYWxsYmFja1dyYXBwZXJGcm9tU2xhdmVTaWRlKCkge1xyXG4gICAgICAgICAgICBpZiAoaXNBbHJlYWR5Q2FsbGVkKSB7XHJcbiAgICAgICAgICAgICAgICB0aHJvdyAnQ2FsbGJhY2sgaXMgY2FsbGVkIHR3aWNlIGJ1dCBpc011bHRpcGxlVGltZUNhbGxiYWNrICcgK1xyXG4gICAgICAgICAgICAgICAgICAgICc9IGZhbHNlJztcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgdmFyIGFyZ3VtZW50c0FzQXJyYXkgPSBnZXRBcmd1bWVudHNBc0FycmF5KGFyZ3VtZW50cyk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBpZiAoYmVmb3JlT3BlcmF0aW9uTGlzdGVuZXIgIT09IG51bGwpIHtcclxuICAgICAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICAgICAgYmVmb3JlT3BlcmF0aW9uTGlzdGVuZXIuY2FsbChcclxuICAgICAgICAgICAgICAgICAgICAgICAgc2xhdmVTaWRlTWFpbkluc3RhbmNlLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAnY2FsbGJhY2snLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBjYWxsYmFja0hhbmRsZS5jYWxsYmFja05hbWUsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGFyZ3VtZW50c0FzQXJyYXkpO1xyXG4gICAgICAgICAgICAgICAgfSBjYXRjaCAoZSkge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKCdBc3luY1Byb3h5U2xhdmUuYmVmb3JlT3BlcmF0aW9uTGlzdGVuZXIgaGFzIHRocm93biBhbiBleGNlcHRpb246ICcgKyBlKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgdmFyIHRyYW5zZmVyYWJsZXMgPVxyXG4gICAgICAgICAgICAgICAgQXN5bmNQcm94eU1hc3Rlci5fZXh0cmFjdFRyYW5zZmVyYWJsZXMoXHJcbiAgICAgICAgICAgICAgICAgICAgY2FsbGJhY2tIYW5kbGUucGF0aHNUb1RyYW5zZmVyYWJsZXMsIGFyZ3VtZW50c0FzQXJyYXkpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgc2VsZi5wb3N0TWVzc2FnZSh7XHJcbiAgICAgICAgICAgICAgICAgICAgdHlwZTogJ2NhbGxiYWNrJyxcclxuICAgICAgICAgICAgICAgICAgICBjYWxsSWQ6IGNhbGxiYWNrSGFuZGxlLmNhbGxJZCxcclxuICAgICAgICAgICAgICAgICAgICBhcmdzOiBhcmd1bWVudHNBc0FycmF5XHJcbiAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgICAgdHJhbnNmZXJhYmxlcyk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBpZiAoIWNhbGxiYWNrSGFuZGxlLmlzTXVsdGlwbGVUaW1lQ2FsbGJhY2spIHtcclxuICAgICAgICAgICAgICAgIGlzQWxyZWFkeUNhbGxlZCA9IHRydWU7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgcmV0dXJuIGNhbGxiYWNrV3JhcHBlckZyb21TbGF2ZVNpZGU7XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBmdW5jdGlvbiBvbk1lc3NhZ2UoZXZlbnQpIHtcclxuICAgICAgICB2YXIgZnVuY3Rpb25OYW1lVG9DYWxsID0gZXZlbnQuZGF0YS5mdW5jdGlvblRvQ2FsbDtcclxuICAgICAgICB2YXIgYXJncyA9IGV2ZW50LmRhdGEuYXJncztcclxuICAgICAgICB2YXIgY2FsbElkID0gZXZlbnQuZGF0YS5jYWxsSWQ7XHJcbiAgICAgICAgdmFyIGlzUHJvbWlzZSA9IGV2ZW50LmRhdGEuaXNQcm9taXNlO1xyXG4gICAgICAgIHZhciBwYXRoc1RvVHJhbnNmZXJhYmxlc0luUHJvbWlzZVJlc3VsdCA9XHJcbiAgICAgICAgICAgIGV2ZW50LmRhdGEucGF0aHNUb1RyYW5zZmVyYWJsZXNJblByb21pc2VSZXN1bHQ7XHJcbiAgICAgICAgXHJcbiAgICAgICAgdmFyIHJlc3VsdCA9IG51bGw7XHJcbiAgICAgICAgXHJcbiAgICAgICAgc3dpdGNoIChmdW5jdGlvbk5hbWVUb0NhbGwpIHtcclxuICAgICAgICAgICAgY2FzZSAnY3Rvcic6XHJcbiAgICAgICAgICAgICAgICBBc3luY1Byb3h5TWFzdGVyLl9zZXRFbnRyeVVybChldmVudC5kYXRhLm1hc3RlckVudHJ5VXJsKTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgdmFyIHNjcmlwdHNUb0ltcG9ydCA9IGV2ZW50LmRhdGEuc2NyaXB0c1RvSW1wb3J0O1xyXG4gICAgICAgICAgICAgICAgY3Rvck5hbWUgPSBldmVudC5kYXRhLmN0b3JOYW1lO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IHNjcmlwdHNUb0ltcG9ydC5sZW5ndGg7ICsraSkge1xyXG4gICAgICAgICAgICAgICAgICAgIC8qIGdsb2JhbCBpbXBvcnRTY3JpcHRzOiBmYWxzZSAqL1xyXG4gICAgICAgICAgICAgICAgICAgIGltcG9ydFNjcmlwdHMoc2NyaXB0c1RvSW1wb3J0W2ldKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgc2xhdmVTaWRlTWFpbkluc3RhbmNlID0gc2xhdmVTaWRlSW5zdGFuY2VDcmVhdG9yLmFwcGx5KG51bGwsIGFyZ3MpO1xyXG5cclxuICAgICAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGNhc2UgJ3N1Yldvcmtlck9uTWVzc2FnZSc6XHJcbiAgICAgICAgICAgICAgICB2YXIgc3ViV29ya2VyID0gc3ViV29ya2VySWRUb1N1YldvcmtlcltldmVudC5kYXRhLnN1YldvcmtlcklkXTtcclxuICAgICAgICAgICAgICAgIHZhciB3b3JrZXJFdmVudCA9IHsgZGF0YTogZXZlbnQuZGF0YS5kYXRhIH07XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIHN1Yldvcmtlci5vbm1lc3NhZ2Uod29ya2VyRXZlbnQpO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIGFyZ3MgPSBuZXcgQXJyYXkoZXZlbnQuZGF0YS5hcmdzLmxlbmd0aCk7XHJcbiAgICAgICAgZm9yICh2YXIgaiA9IDA7IGogPCBldmVudC5kYXRhLmFyZ3MubGVuZ3RoOyArK2opIHtcclxuICAgICAgICAgICAgdmFyIGFyZyA9IGV2ZW50LmRhdGEuYXJnc1tqXTtcclxuICAgICAgICAgICAgaWYgKGFyZyAhPT0gdW5kZWZpbmVkICYmXHJcbiAgICAgICAgICAgICAgICBhcmcgIT09IG51bGwgJiZcclxuICAgICAgICAgICAgICAgIGFyZy5pc1dvcmtlckhlbHBlckNhbGxiYWNrKSB7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIGFyZyA9IHNsYXZlSGVscGVyU2luZ2xldG9uLndyYXBDYWxsYmFja0Zyb21TbGF2ZVNpZGUoYXJnKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgYXJnc1tqXSA9IGFyZztcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgdmFyIGZ1bmN0aW9uQ29udGFpbmVyID0gc2xhdmVTaWRlTWFpbkluc3RhbmNlO1xyXG4gICAgICAgIHZhciBmdW5jdGlvblRvQ2FsbDtcclxuICAgICAgICB3aGlsZSAoZnVuY3Rpb25Db250YWluZXIpIHtcclxuICAgICAgICAgICAgZnVuY3Rpb25Ub0NhbGwgPSBzbGF2ZVNpZGVNYWluSW5zdGFuY2VbZnVuY3Rpb25OYW1lVG9DYWxsXTtcclxuICAgICAgICAgICAgaWYgKGZ1bmN0aW9uVG9DYWxsKSB7XHJcbiAgICAgICAgICAgICAgICBicmVhaztcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAvKiBqc2hpbnQgcHJvdG86IHRydWUgKi9cclxuICAgICAgICAgICAgZnVuY3Rpb25Db250YWluZXIgPSBmdW5jdGlvbkNvbnRhaW5lci5fX3Byb3RvX187XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIGlmICghZnVuY3Rpb25Ub0NhbGwpIHtcclxuICAgICAgICAgICAgdGhyb3cgJ0FzeW5jUHJveHkgZXJyb3I6IGNvdWxkIG5vdCBmaW5kIGZ1bmN0aW9uICcgKyBmdW5jdGlvbk5hbWVUb0NhbGw7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHZhciBwcm9taXNlID0gZnVuY3Rpb25Ub0NhbGwuYXBwbHkoc2xhdmVTaWRlTWFpbkluc3RhbmNlLCBhcmdzKTtcclxuICAgICAgICBcclxuICAgICAgICBpZiAoaXNQcm9taXNlKSB7XHJcbiAgICAgICAgICAgIHNsYXZlSGVscGVyU2luZ2xldG9uLndyYXBQcm9taXNlRnJvbVNsYXZlU2lkZShcclxuICAgICAgICAgICAgICAgIGNhbGxJZCwgcHJvbWlzZSwgcGF0aHNUb1RyYW5zZmVyYWJsZXNJblByb21pc2VSZXN1bHQpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgc2VsZi5wb3N0TWVzc2FnZSh7XHJcbiAgICAgICAgICAgIHR5cGU6ICdmdW5jdGlvbkNhbGxlZCcsXHJcbiAgICAgICAgICAgIGNhbGxJZDogZXZlbnQuZGF0YS5jYWxsSWQsXHJcbiAgICAgICAgICAgIHJlc3VsdDogcmVzdWx0XHJcbiAgICAgICAgfSk7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGZ1bmN0aW9uIGRlZmF1bHRJbnN0YW5jZUNyZWF0b3IoKSB7XHJcbiAgICAgICAgdmFyIGluc3RhbmNlO1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIHZhciBuYW1lc3BhY2VzQW5kQ3Rvck5hbWUgPSBjdG9yTmFtZS5zcGxpdCgnLicpO1xyXG4gICAgICAgICAgICB2YXIgbWVtYmVyID0gc2VsZjtcclxuICAgICAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBuYW1lc3BhY2VzQW5kQ3Rvck5hbWUubGVuZ3RoOyArK2kpXHJcbiAgICAgICAgICAgICAgICBtZW1iZXIgPSBtZW1iZXJbbmFtZXNwYWNlc0FuZEN0b3JOYW1lW2ldXTtcclxuICAgICAgICAgICAgdmFyIFR5cGVDdG9yID0gbWVtYmVyO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgdmFyIGJpbmRBcmdzID0gW251bGxdLmNvbmNhdChnZXRBcmd1bWVudHNBc0FycmF5KGFyZ3VtZW50cykpO1xyXG4gICAgICAgICAgICBpbnN0YW5jZSA9IG5ldyAoRnVuY3Rpb24ucHJvdG90eXBlLmJpbmQuYXBwbHkoVHlwZUN0b3IsIGJpbmRBcmdzKSkoKTtcclxuICAgICAgICB9IGNhdGNoIChlKSB7XHJcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignRmFpbGVkIGxvY2F0aW5nIGNsYXNzIG5hbWUgJyArIGN0b3JOYW1lICsgJzogJyArIGUpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICByZXR1cm4gaW5zdGFuY2U7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGZ1bmN0aW9uIGdldEFyZ3VtZW50c0FzQXJyYXkoYXJncykge1xyXG4gICAgICAgIHZhciBhcmd1bWVudHNBc0FycmF5ID0gbmV3IEFycmF5KGFyZ3MubGVuZ3RoKTtcclxuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IGFyZ3MubGVuZ3RoOyArK2kpIHtcclxuICAgICAgICAgICAgYXJndW1lbnRzQXNBcnJheVtpXSA9IGFyZ3NbaV07XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHJldHVybiBhcmd1bWVudHNBc0FycmF5O1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBpZiAoc2VsZi5Xb3JrZXIgPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIFN1YldvcmtlckVtdWxhdGlvbkZvckNocm9tZS5pbml0aWFsaXplKHN1YldvcmtlcklkVG9TdWJXb3JrZXIpO1xyXG4gICAgICAgIHNlbGYuV29ya2VyID0gU3ViV29ya2VyRW11bGF0aW9uRm9yQ2hyb21lO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICByZXR1cm4gc2xhdmVIZWxwZXJTaW5nbGV0b247XHJcbn0pKCk7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IEFzeW5jUHJveHlTbGF2ZTsiLCIndXNlIHN0cmljdCc7XHJcblxyXG52YXIgU2NyaXB0c1RvSW1wb3J0UG9vbCA9IChmdW5jdGlvbiBTY3JpcHRzVG9JbXBvcnRQb29sQ2xvc3VyZSgpIHtcclxuICAgIHZhciBjdXJyZW50U3RhY2tGcmFtZVJlZ2V4ID0gL2F0ICh8W14gXSsgXFwoKShbXiBdKyk6XFxkKzpcXGQrLztcclxuICAgIHZhciBsYXN0U3RhY2tGcmFtZVJlZ2V4V2l0aFN0cnVkZWwgPSBuZXcgUmVnRXhwKC8uK0AoLio/KTpcXGQrOlxcZCsvKTtcclxuICAgIHZhciBsYXN0U3RhY2tGcmFtZVJlZ2V4ID0gbmV3IFJlZ0V4cCgvLitcXC8oLio/KTpcXGQrKDpcXGQrKSokLyk7XHJcblxyXG4gICAgZnVuY3Rpb24gU2NyaXB0c1RvSW1wb3J0UG9vbCgpIHtcclxuICAgICAgICB2YXIgdGhhdCA9IHRoaXM7XHJcbiAgICAgICAgdGhhdC5fc2NyaXB0c0J5TmFtZSA9IHt9O1xyXG4gICAgICAgIHRoYXQuX3NjcmlwdHNBcnJheSA9IG51bGw7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIFNjcmlwdHNUb0ltcG9ydFBvb2wucHJvdG90eXBlLmFkZFNjcmlwdEZyb21FcnJvcldpdGhTdGFja1RyYWNlID1cclxuICAgICAgICBmdW5jdGlvbiBhZGRTY3JpcHRGb3JXb3JrZXJJbXBvcnQoZXJyb3JXaXRoU3RhY2tUcmFjZSkge1xyXG4gICAgICAgIFxyXG4gICAgICAgIHZhciBmaWxlTmFtZSA9IFNjcmlwdHNUb0ltcG9ydFBvb2wuX2dldFNjcmlwdE5hbWUoZXJyb3JXaXRoU3RhY2tUcmFjZSk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKCF0aGlzLl9zY3JpcHRzQnlOYW1lW2ZpbGVOYW1lXSkge1xyXG4gICAgICAgICAgICB0aGlzLl9zY3JpcHRzQnlOYW1lW2ZpbGVOYW1lXSA9IHRydWU7XHJcbiAgICAgICAgICAgIHRoaXMuX3NjcmlwdHNBcnJheSA9IG51bGw7XHJcbiAgICAgICAgfVxyXG4gICAgfTtcclxuICAgIFxyXG4gICAgU2NyaXB0c1RvSW1wb3J0UG9vbC5wcm90b3R5cGUuZ2V0U2NyaXB0c0ZvcldvcmtlckltcG9ydCA9XHJcbiAgICAgICAgZnVuY3Rpb24gZ2V0U2NyaXB0c0ZvcldvcmtlckltcG9ydCgpIHtcclxuICAgICAgICBcclxuICAgICAgICBpZiAodGhpcy5fc2NyaXB0c0FycmF5ID09PSBudWxsKSB7XHJcbiAgICAgICAgICAgIHRoaXMuX3NjcmlwdHNBcnJheSA9IFtdO1xyXG4gICAgICAgICAgICBmb3IgKHZhciBmaWxlTmFtZSBpbiB0aGlzLl9zY3JpcHRzQnlOYW1lKSB7XHJcbiAgICAgICAgICAgICAgICB0aGlzLl9zY3JpcHRzQXJyYXkucHVzaChmaWxlTmFtZSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgcmV0dXJuIHRoaXMuX3NjcmlwdHNBcnJheTtcclxuICAgIH07XHJcbiAgICBcclxuICAgIFNjcmlwdHNUb0ltcG9ydFBvb2wuX2dldFNjcmlwdE5hbWUgPSBmdW5jdGlvbiBnZXRTY3JpcHROYW1lKGVycm9yV2l0aFN0YWNrVHJhY2UpIHtcclxuICAgICAgICB2YXIgc3RhY2sgPSBlcnJvcldpdGhTdGFja1RyYWNlLnN0YWNrLnRyaW0oKTtcclxuICAgICAgICBcclxuICAgICAgICB2YXIgc291cmNlID0gY3VycmVudFN0YWNrRnJhbWVSZWdleC5leGVjKHN0YWNrKTtcclxuICAgICAgICBpZiAoc291cmNlICYmIHNvdXJjZVsyXSAhPT0gXCJcIikge1xyXG4gICAgICAgICAgICByZXR1cm4gc291cmNlWzJdO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgc291cmNlID0gbGFzdFN0YWNrRnJhbWVSZWdleFdpdGhTdHJ1ZGVsLmV4ZWMoc3RhY2spO1xyXG4gICAgICAgIGlmIChzb3VyY2UgJiYgKHNvdXJjZVsxXSAhPT0gXCJcIikpIHtcclxuICAgICAgICAgICAgcmV0dXJuIHNvdXJjZVsxXTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgc291cmNlID0gbGFzdFN0YWNrRnJhbWVSZWdleC5leGVjKHN0YWNrKTtcclxuICAgICAgICBpZiAoc291cmNlICYmIHNvdXJjZVsxXSAhPT0gXCJcIikge1xyXG4gICAgICAgICAgICByZXR1cm4gc291cmNlWzFdO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBpZiAoZXJyb3JXaXRoU3RhY2tUcmFjZS5maWxlTmFtZSAhPT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgICAgIHJldHVybiBlcnJvcldpdGhTdGFja1RyYWNlLmZpbGVOYW1lO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICB0aHJvdyAnYXN5bmMtcHJveHkuanM6IENvdWxkIG5vdCBnZXQgY3VycmVudCBzY3JpcHQgVVJMJztcclxuICAgIH07XHJcbiAgICBcclxuICAgIHJldHVybiBTY3JpcHRzVG9JbXBvcnRQb29sO1xyXG59KSgpO1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBTY3JpcHRzVG9JbXBvcnRQb29sOyIsIid1c2Ugc3RyaWN0JztcclxuXHJcbi8qIGdsb2JhbCBzZWxmOiBmYWxzZSAqL1xyXG5cclxudmFyIFN1YldvcmtlckVtdWxhdGlvbkZvckNocm9tZSA9IChmdW5jdGlvbiBTdWJXb3JrZXJFbXVsYXRpb25Gb3JDaHJvbWVDbG9zdXJlKCkge1xyXG4gICAgdmFyIHN1YldvcmtlcklkID0gMDtcclxuICAgIHZhciBzdWJXb3JrZXJJZFRvU3ViV29ya2VyID0gbnVsbDtcclxuICAgIFxyXG4gICAgZnVuY3Rpb24gU3ViV29ya2VyRW11bGF0aW9uRm9yQ2hyb21lKHNjcmlwdFVybCkge1xyXG4gICAgICAgIGlmIChzdWJXb3JrZXJJZFRvU3ViV29ya2VyID09PSBudWxsKSB7XHJcbiAgICAgICAgICAgIHRocm93ICdBc3luY1Byb3h5IGludGVybmFsIGVycm9yOiBTdWJXb3JrZXJFbXVsYXRpb25Gb3JDaHJvbWUgJyArXHJcbiAgICAgICAgICAgICAgICAnbm90IGluaXRpYWxpemVkJztcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgdmFyIHRoYXQgPSB0aGlzO1xyXG4gICAgICAgIHRoYXQuX3N1YldvcmtlcklkID0gKytzdWJXb3JrZXJJZDtcclxuICAgICAgICBzdWJXb3JrZXJJZFRvU3ViV29ya2VyW3RoYXQuX3N1YldvcmtlcklkXSA9IHRoYXQ7XHJcbiAgICAgICAgXHJcbiAgICAgICAgc2VsZi5wb3N0TWVzc2FnZSh7XHJcbiAgICAgICAgICAgIHR5cGU6ICdzdWJXb3JrZXJDdG9yJyxcclxuICAgICAgICAgICAgc3ViV29ya2VySWQ6IHRoYXQuX3N1YldvcmtlcklkLFxyXG4gICAgICAgICAgICBzY3JpcHRVcmw6IHNjcmlwdFVybFxyXG4gICAgICAgIH0pO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBTdWJXb3JrZXJFbXVsYXRpb25Gb3JDaHJvbWUuaW5pdGlhbGl6ZSA9IGZ1bmN0aW9uIGluaXRpYWxpemUoXHJcbiAgICAgICAgc3ViV29ya2VySWRUb1N1Yldvcmtlcl8pIHtcclxuICAgICAgICBcclxuICAgICAgICBzdWJXb3JrZXJJZFRvU3ViV29ya2VyID0gc3ViV29ya2VySWRUb1N1Yldvcmtlcl87XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBTdWJXb3JrZXJFbXVsYXRpb25Gb3JDaHJvbWUucHJvdG90eXBlLnBvc3RNZXNzYWdlID0gZnVuY3Rpb24gcG9zdE1lc3NhZ2UoXHJcbiAgICAgICAgZGF0YSwgdHJhbnNmZXJhYmxlcykge1xyXG4gICAgICAgIFxyXG4gICAgICAgIHNlbGYucG9zdE1lc3NhZ2Uoe1xyXG4gICAgICAgICAgICB0eXBlOiAnc3ViV29ya2VyUG9zdE1lc3NhZ2UnLFxyXG4gICAgICAgICAgICBzdWJXb3JrZXJJZDogdGhpcy5fc3ViV29ya2VySWQsXHJcbiAgICAgICAgICAgIGRhdGE6IGRhdGFcclxuICAgICAgICB9LFxyXG4gICAgICAgIHRyYW5zZmVyYWJsZXMpO1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgU3ViV29ya2VyRW11bGF0aW9uRm9yQ2hyb21lLnByb3RvdHlwZS50ZXJtaW5hdGUgPSBmdW5jdGlvbiB0ZXJtaW5hdGUoXHJcbiAgICAgICAgZGF0YSwgdHJhbnNmZXJhYmxlcykge1xyXG4gICAgICAgIFxyXG4gICAgICAgIHNlbGYucG9zdE1lc3NhZ2Uoe1xyXG4gICAgICAgICAgICB0eXBlOiAnc3ViV29ya2VyVGVybWluYXRlJyxcclxuICAgICAgICAgICAgc3ViV29ya2VySWQ6IHRoaXMuX3N1YldvcmtlcklkXHJcbiAgICAgICAgfSxcclxuICAgICAgICB0cmFuc2ZlcmFibGVzKTtcclxuICAgIH07XHJcbiAgICBcclxuICAgIHJldHVybiBTdWJXb3JrZXJFbXVsYXRpb25Gb3JDaHJvbWU7XHJcbn0pKCk7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IFN1YldvcmtlckVtdWxhdGlvbkZvckNocm9tZTsiXX0=

(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.dependencyWorkers = f()}})(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
'use strict';

module.exports.DependencyWorkers = require('dependency-workers');
module.exports.DependencyWorkersTaskContext = require('dependency-workers-task-context');
module.exports.DependencyWorkersTask = require('dependency-workers-task');
module.exports.WrapperInputRetreiverBase = require('wrapper-input-retreiver-base');
module.exports.SchedulerDependencyWorkers = require('scheduler-dependency-workers');
module.exports.DependencyWorkersTaskScheduler = require('dependency-workers-task-scheduler');
},{"dependency-workers":6,"dependency-workers-task":5,"dependency-workers-task-context":2,"dependency-workers-task-scheduler":4,"scheduler-dependency-workers":10,"wrapper-input-retreiver-base":11}],2:[function(require,module,exports){
'use strict';

var DependencyWorkersTaskContext = (function DependencyWorkersTaskContextClosure() {
    function DependencyWorkersTaskContext(taskInternals, callbacks) {
        this._taskInternals = taskInternals;
        this._callbacks = callbacks;
        this._taskContextsIterator = taskInternals.taskContexts.add(this);
        this._priorityCalculatorIterator = null;
    }
    
    Object.defineProperty(DependencyWorkersTaskContext.prototype, 'isActive', { get: function() {
        return this._taskInternals.isActualTerminationPending || !this._taskInternals.isTerminated;
    } });
    
    Object.defineProperty(DependencyWorkersTaskContext.prototype, 'isTerminated', { get: function() {
        return this._taskInternals.isTerminated;
    } });
    
    DependencyWorkersTaskContext.prototype.getProcessedData = function getProcessedData() {
        return this._taskInternals.processedData;
    };
    
    DependencyWorkersTaskContext.prototype.setPriorityCalculator = function setPriorityCalculator(calculator) {
        if (this._priorityCalculatorIterator !== null) {
            this._taskInternals.priorityCalculators.remove(this._priorityCalculatorIterator);
            this._priorityCalculatorIterator = null;
            // The following optimization, to register only if me having calculator, seems to be buggy; It might cause
            // a SchedulerTask to abort although having non aborted dependant tasks.
            // Instead we register for all the lifetime of the taskInternals
            //if (!calculator && this._taskInternals.priorityCalculators.getCount() === 0) {
            //    this._taskInternals.unregisterDependPriorityCalculator();
            //}
        //} else if (calculator && this._taskInternals.priorityCalculators.getCount() === 0) {
        //    this._taskInternals.registerDependPriorityCalculator();
        }
        
        if (calculator) {
            this._priorityCalculatorIterator = this._taskInternals.priorityCalculators.add(calculator);
        }
    };
    
    DependencyWorkersTaskContext.prototype.unregister = function() {
        if (!this._taskContextsIterator) {
            throw 'dependencyWorkers: Already unregistered';
        }
        
        this.setPriorityCalculator(null);
        
        this._taskInternals.taskContexts.remove(this._taskContextsIterator);
        this._taskContextsIterator = null;
        if (!this._taskInternals.isTerminated) {
            if (this._taskInternals.taskContexts.getCount() === 0) {
                this._taskInternals.abort(/*abortByScheduler=*/false);
            } else {
                this._taskInternals.statusUpdate();
            }
        }
    };

    return DependencyWorkersTaskContext;
})();

module.exports = DependencyWorkersTaskContext;
},{}],3:[function(require,module,exports){
'use strict';

var LinkedList = require('linked-list');
var JsBuiltinHashMap = require('js-builtin-hash-map');
var DependencyWorkersTask = require('dependency-workers-task');

var DependencyWorkersTaskInternals = (function DependencyWorkersTaskInternalsClosure() {
    function DependencyWorkersTaskInternals() {
        // This class is not exposed outside dependencyWorkers but as an internal struct, thus 
        // may contain public members
        
        this.isTerminated = false;
        this.isActualTerminationPending = false;
        this.processedData = [];
        this.taskApi = null;
        
        this.pendingDataForWorker = [];
        this.canSkipLastPendingDataForWorker = false;
        
        this.taskContexts = new LinkedList();
        this.priorityCalculators = new LinkedList();
        
        this.taskKey = null;
        this._dependsTasksTerminatedCount = 0;
        this._parentDependencyWorkers = null;
        this._workerInputRetreiver = null;
        this._parentList = null;
        this._parentIterator = null;
        this._dependsTaskContexts = null;
        this._priorityCalculator = null;
        this._isRegisteredDependPriorityCalculator = false;
        this._isDetached = false;
        this._canSkipLastProcessedData = false;
        this._jobCallbacks = null;
        this._isAborted = false;
        this._isAbortedNotByScheduler = false;
        this._isUserCalledTerminate = false;
        this._isWaitingForWorkerResult = false;
        
        this._dependTaskKeys = [];
        this._dependTaskResults = [];
        this._hasDependTaskData = [];
        
        this._pendingDelayedAction = false;
        this._pendingDelayedDependencyData = [];
        this._pendingDelayedEnded = false;
        this._pendingDelayedNewData = [];
        this._pendingDelayedCanSkipLastNewData = false;
        this._pendingWorkerDone = false;
        
        var that = this;
        this._scheduleNotifier = {
            'calculatePriority': function() {
                return that.calculatePriority();
            },
            'schedule': function(jobCallbacks) {
                if (that._jobCallbacks !== null) {
                    throw 'dependencyWorkers: scheduleNotifier.schedule was called twice';
                }
                
                if ((!jobCallbacks) || !jobCallbacks['jobDone']) {
                    throw 'dependencyWorkers: Passed invalid jobCallbacks argument to scheduleNotifier.schedule(). Ensure jobCallbacks has jobDone method';
                }
                
                if (that._isAbortedNotByScheduler) {
                    jobCallbacks.jobDone();
                    return;
                }
                
                if (this.isTerminated && !this.isActualTerminationPending) {
                    throw 'dependencyWorkers: scheduled after termination';
                }
                
                var dataToProcess = that.pendingDataForWorker.shift();
                var canSkip = false;
                if (that.pendingDataForWorker.length === 0) {
                    canSkip = that.canSkipLastPendingDataForWorker;
                    that.canSkipLastPendingDataForWorker = false;
                }
                
                that._jobCallbacks = jobCallbacks;
                that._parentDependencyWorkers._dataReady(
                    that,
                    dataToProcess.data,
                    dataToProcess.workerType,
                    canSkip);
            },
            'abort': function(abortedByScheduler) {
                that.abort(abortedByScheduler);
            }
        };
    }
    
    DependencyWorkersTaskInternals.prototype.initialize = function(
            taskKey, dependencyWorkers, inputRetreiver, list, iterator /*, hasher*/) {
                
        this.taskKey = taskKey;
        this._parentDependencyWorkers = dependencyWorkers;
        this._workerInputRetreiver = inputRetreiver;
        this._parentList = list;
        this._parentIterator = iterator;
        this._dependsTaskContexts = new JsBuiltinHashMap();
        this.taskApi = new DependencyWorkersTask(this, taskKey);
        this._registerDependPriorityCalculator();
        dependencyWorkers.initializingTask(this.taskApi, this._scheduleNotifier);
    };
    
    DependencyWorkersTaskInternals.prototype.ended = function() {
        this._pendingDelayedEnded = true;
        this._schedulePendingDelayedActions();
    };
    
    DependencyWorkersTaskInternals.prototype.statusUpdate = function() {
        var status = {
            'hasListeners': this.taskContexts.getCount() > 0,
            'isWaitingForWorkerResult': this._isWaitingForWorkerResult,
            'terminatedDependsTasks': this._dependsTasksTerminatedCount,
            'dependsTasks': this._dependsTaskContexts.getCount()
        };
        this.taskApi._onEvent('statusUpdated', status);

        if (this.isActualTerminationPending && !this._isWaitingForWorkerResult) {
            this.isActualTerminationPending = false;
            this.ended();
        }
    };
    
    DependencyWorkersTaskInternals.prototype.calculatePriority = function() {
        var iterator = this.priorityCalculators.getFirstIterator();
        var isFirst = true;
        var priority = 0;
        while (iterator !== null) {
            var priorityCalculator = this.priorityCalculators.getFromIterator(iterator);
            var currentPriority = priorityCalculator();
            if (isFirst || currentPriority > priority) {
                priority = currentPriority;
                isFirst = false;
            }
            iterator = this.priorityCalculators.getNextIterator(iterator);
        }

        return priority;
    };
    
    DependencyWorkersTaskInternals.prototype.newData = function(data, canSkip) {
        if (this._pendingDelayedCanSkipLastNewData) {
            this._pendingDelayedNewData[this._pendingDelayedNewData.length - 1] = data;
        } else {
            this._pendingDelayedNewData.push(data);
        }
        
        this._pendingDelayedCanSkipLastNewData = !!canSkip;
        this._schedulePendingDelayedActions();
    };
    
    DependencyWorkersTaskInternals.prototype.workerDone = function() {
        if (this._jobCallbacks === null) {
            throw 'dependencyWorkers: Job done without previously started';
        }
        
        var jobCallbacks = this._jobCallbacks;
        this._jobCallbacks = null;
        
        if (this.pendingDataForWorker.length === 0) {
            this._pendingWorkerDone = true;
            this._schedulePendingDelayedActions();
        }
        
        jobCallbacks['jobDone']();

        if (this.pendingDataForWorker.length > 0) {
            this.waitForSchedule();
        }
    };
    
    DependencyWorkersTaskInternals.prototype.dataReady = function dataReady(
        newDataToProcess, workerType, canSkip) {
        
        if (this.isTerminated) {
            if (this._isUserCalledTerminate) {
                throw 'dependencyWorkers: already terminated';
            }
            
            return;
        }
        
        // Used in DependencyWorkers._startWorker() when previous worker has finished
        var pendingData = {
            data: newDataToProcess,
            workerType: workerType
        };
        
        if (this.canSkipLastPendingDataForWorker) {
            this.pendingDataForWorker[this.pendingDataForWorker.length - 1] = pendingData;
        } else {
            this.pendingDataForWorker.push(pendingData);
        }
        this.canSkipLastPendingDataForWorker = !!canSkip;
        
        if (!this._isWaitingForWorkerResult || this._pendingWorkerDone) {
            this._isWaitingForWorkerResult = true;
            this._pendingWorkerDone = false;
            this.waitForSchedule();
            this.statusUpdate();
        }
    };
    
    DependencyWorkersTaskInternals.prototype.waitForSchedule = function waitForSchedule() {
        var workerType = this.pendingDataForWorker[0].workerType;
        this._parentDependencyWorkers.waitForSchedule(this._scheduleNotifier, workerType);
    };
    
    DependencyWorkersTaskInternals.prototype.detachBeforeTermination = function detach() {
        if (this._isDetached) {
            return;
        }
        
        this._isDetached = true;
        this._parentList.remove(this._parentIterator);
        this._parentIterator = null;

        var iterator = this._dependsTaskContexts.getFirstIterator();
        while (iterator !== null) {
            var context = this._dependsTaskContexts.getFromIterator(iterator).taskContext;
            iterator = this._dependsTaskContexts.getNextIterator(iterator);
            
            context.unregister();
        }
        this._dependsTaskContexts.clear();
        
        this._unregisterDependPriorityCalculator();
    };
    
    DependencyWorkersTaskInternals.prototype.customEvent = function customEvent(arg0, arg1) {
        if (this.isTerminated && !this.isActualTerminationPending) {
            throw 'dependencyWorkers: already terminated';
        }
        
        this._iterateCallbacks(function(callbacks) {
            if (callbacks.onCustom) {
                callbacks.onCustom(arg0, arg1);
            }
        });
        
        this.taskApi._onEvent('custom', arg0, arg1);
    };

    DependencyWorkersTaskInternals.prototype.terminate = function terminate() {
        if (this._isUserCalledTerminate) {
            throw 'dependencyWorkers: already terminated';
        }
        
        this._isUserCalledTerminate = true;
        this._terminateInternal();
    };
    
    DependencyWorkersTaskInternals.prototype.abort = function abort(abortedByScheduler) {
        if (this._isAborted) {
            return;
        }
        
        this._isAborted = true;
        if (this.isTerminated) {
            if (!this.isActualTerminationPending && !this._isAbortedNotByScheduler) {
                throw 'dependencyWorkers: aborted after termination';
            }
        } else if (!abortedByScheduler) {
            this._isAbortedNotByScheduler = true;
        } else if (this.pendingDataForWorker.length === 0) {
            throw 'dependencyWorkers: Abort without task waiting for schedule';
        } else {
            this._isWaitingForWorkerResult = false; // only if aborted by scheduler
        }
        
        this.pendingDataForWorker = [];
        this.canSkipLastPendingDataForWorker = false;
        
        if (!this.isTerminated) {
            this.customEvent('aborting', this.taskKey);
        }
        
        this._terminateInternal();
    };
    
    Object.defineProperty(DependencyWorkersTaskInternals.prototype, 'dependTaskKeys', {
        get: function getDependTaskKeys() {
            return this._dependTaskKeys;
        }
    });
    
    Object.defineProperty(DependencyWorkersTaskInternals.prototype, 'dependTaskResults', {
        get: function getDependTaskResults() {
            return this._dependTaskResults;
        }
    });
    
    DependencyWorkersTaskInternals.prototype.registerTaskDependency = function(
            taskKey) {
        
        var strKey = this._workerInputRetreiver.getKeyAsString(taskKey);
        var addResult = this._dependsTaskContexts.tryAdd(strKey, function() {
            return { taskContext: null };
        });
        
        if (!addResult.isNew) {
            throw 'dependencyWorkers: Cannot add task dependency twice';
        }
        
        var that = this;
        var gotData = false;
        var isDependsTaskTerminated = false;
        var index = this._dependTaskKeys.length;
        
        this._dependTaskKeys[index] = taskKey;
        
        addResult.value.taskContext = this._parentDependencyWorkers.startTask(
            taskKey, {
                'onData': onDependencyTaskData,
                'onTerminated': onDependencyTaskTerminated,
                'onCustom': onDependencyTaskCustom,
                calleeForDebug: this
            }
        );
        
        if (!addResult.value.taskContext.isActive) {
            throw 'dependency-workers error: dependant task already terminated';
        }
        
        // Might be removed: Code for debug which relies on internal member taskContext._taskInternals
        if (addResult.value.taskContext._taskInternals._isAborted) {
            throw 'dependencyWorkers error: dependant task already aborted';
        }
        
        if (this._isRegisteredDependPriorityCalculator) {
            addResult.value.taskContext.setPriorityCalculator(this._priorityCalculator);
        }
        
        if (gotData) {
            throw 'dependency-workers error: Internal error: callback called before dependency registration completed';
        }
        
        var processedData = addResult.value.taskContext.getProcessedData();
        for (var i = 0; i < processedData.length; ++i) {
            this._pendingDelayedDependencyData.push({
                data: processedData[i],
                onDependencyTaskData: onDependencyTaskData
            });
        }
        
        if (processedData.length > 0) {
            this._schedulePendingDelayedActions();
        }
        
        return addResult.value.taskContext;
        
        function onDependencyTaskData(data) {
            if (that._pendingDelayedDependencyData.length > 0) {
                // Avoid bypass of delayed data by new data
                that._pendingDelayedDependencyData.push({
                    data: data,
                    onDependencyTaskData: onDependencyTaskData
                });
                
                that._schedulePendingDelayedActions();
                
                return;
            }
            
            that._dependTaskResults[index] = data;
            that._hasDependTaskData[index] = true;
            that.taskApi._onEvent('dependencyTaskData', data, taskKey);
            gotData = true;
        }
        
        function onDependencyTaskCustom(arg0, arg1) {
            that.taskApi._onEvent('dependencyTaskCustom', arg0, arg1);
        }
        
        function onDependencyTaskTerminated() {
            if (isDependsTaskTerminated) {
                throw 'dependencyWorkers: Double termination';
            }
            isDependsTaskTerminated = true;
            that._dependsTaskTerminated();
        }
    };
    
    DependencyWorkersTaskInternals.prototype._terminateInternal = function terminateInternal() {
        if (this.isTerminated) {
            return;
        }
        
        this.detachBeforeTermination();
        this.isTerminated = true;

        if (this._isWaitingForWorkerResult) {
            this.isActualTerminationPending = true;
        } else {
            this.ended();
        }
    };
    
    DependencyWorkersTaskInternals.prototype._registerDependPriorityCalculator = function registerDependPriorityCalculator() {
        if (this._isRegisteredDependPriorityCalculator) {
            throw 'dependencyWorkers: already registered depend priority calculator';
        }
        if (this._priorityCalculator === null) {
            var that = this;
            this._priorityCalculator = function() {
                return that.calculatePriority();
            };
        }
        this._isRegisteredDependPriorityCalculator = true;
        
        var iterator = this._dependsTaskContexts.getFirstIterator();
        while (iterator !== null) {
            var context = this._dependsTaskContexts.getFromIterator(iterator).taskContext;
            iterator = this._dependsTaskContexts.getNextIterator(iterator);
            
            context.setPriorityCalculator(this._priorityCalculator);
        }
    };
    
    DependencyWorkersTaskInternals.prototype._unregisterDependPriorityCalculator = function unregisterDependPriorityCalculator() {
        if (!this._isRegisteredDependPriorityCalculator) {
            throw 'dependencyWorkers: not registered depend priority calculator';
        }
        this._isRegisteredDependPriorityCalculator = false;
        
        var iterator = this._dependsTaskContexts.getFirstIterator();
        while (iterator !== null) {
            var context = this._dependsTaskContexts.getFromIterator(iterator).taskContext;
            iterator = this._dependsTaskContexts.getNextIterator(iterator);
            
            context.setPriorityCalculator(null);
        }
    };

    DependencyWorkersTaskInternals.prototype._dependsTaskTerminated = function dependsTaskTerminated() {
        ++this._dependsTasksTerminatedCount;
        if (this._dependsTasksTerminatedCount === this._dependsTaskContexts.getCount()) {
            this.taskApi._onEvent('allDependTasksTerminated');
        }
        this.statusUpdate();
    };
    
    DependencyWorkersTaskInternals.prototype._schedulePendingDelayedActions = function() {
        if (this._pendingDelayedAction) {
            return;
        }
        
        this._pendingDelayedAction = true;
        var that = this;
        setTimeout(function() {
            var iterator;
            var context;
            that._pendingDelayedAction = false;
            
            if (that._pendingDelayedDependencyData.length > 0) {
                var localListeners = that._pendingDelayedDependencyData;
                that._pendingDelayedDependencyData = [];
                
                for (var i = 0; i < localListeners.length; ++i) {
                    localListeners[i].onDependencyTaskData(localListeners[i].data);
                }
            }
            
            if (that._pendingDelayedNewData.length > 0) {
                var newData = that._pendingDelayedNewData;
                var canSkipLast = that._pendingDelayedCanSkipLastNewData;
                that._pendingDelayedNewData = [];
                that._pendingDelayedCanSkipLastNewData = false;
                
                if (that._canSkipLastProcessedData) {
                    that.processedData.pop();
                }
                
                for (var i = 0; i < newData.length; ++i) {
                    that.processedData.push(newData[i]);
                    that._canSkipLastProcessedData = canSkipLast && i === newData.length - 1;
                    that._iterateCallbacks(function(callbacks) {
                        callbacks.onData(newData[i], that.taskKey);
                    });
                }
            }
            
            if (that._pendingWorkerDone) {
                that._isWaitingForWorkerResult = false;
                that.statusUpdate();
            }
            
            if (that._pendingDelayedEnded) {
                that._pendingDelayedEnded = false;
                that._iterateCallbacks(function(callbacks) {
                    if (callbacks.onTerminated) {
                        callbacks.onTerminated(that._isAborted);
                    }
                });
                
                that.taskContexts.clear();
            }
        });
    };
    
    DependencyWorkersTaskInternals.prototype._iterateCallbacks = function(perform) {
        var iterator = this.taskContexts.getFirstIterator();
        while (iterator !== null) {
            var context = this.taskContexts.getFromIterator(iterator);
            iterator = this.taskContexts.getNextIterator(iterator);

            perform(context._callbacks);
        }

    };
    
    return DependencyWorkersTaskInternals;
})();

module.exports = DependencyWorkersTaskInternals;
},{"dependency-workers-task":5,"js-builtin-hash-map":8,"linked-list":9}],4:[function(require,module,exports){
'use strict';

var prioritizer = {
    getPriority: function(task) {
        return task.calculatePriority();
    }
};

function createDummyResource() {
    return {};
}

function DependencyWorkersTaskScheduler(jobsLimit, options) {
    resourceScheduler.PriorityScheduler.call(this, createDummyResource, jobsLimit, prioritizer, options);
}

DependencyWorkersTaskScheduler.prototype = Object.create(resourceScheduler.PriorityScheduler.prototype);

module.exports = DependencyWorkersTaskScheduler;
},{}],5:[function(require,module,exports){
'use strict';

var DependencyWorkersTask = (function DependencyWorkersTaskClosure() {
    function DependencyWorkersTask(wrapped, key, registerWrappedEvents) {
        this._wrapped = wrapped;
        wrapped.__wrappingTaskForDebug = this;
        this._key = key;
        this._eventListeners = {
            'dependencyTaskData': [],
            'statusUpdated': [],
            'allDependTasksTerminated': [],
            'custom': [],
            'dependencyTaskCustom': []
        };
        
        if (registerWrappedEvents) {
            for (var event in this._eventListeners) {
                this._registerWrappedEvent(event);
            }
        }
    }
    
    Object.defineProperty(DependencyWorkersTask.prototype, 'isTerminated', { get: function() {
        return this._wrapped.isTerminated;
    } });
    
    DependencyWorkersTask.prototype.dataReady = function dataReady(newDataToProcess, workerType, canSkip) {
        this._wrapped.dataReady(newDataToProcess, workerType, canSkip);
    };
    
    DependencyWorkersTask.prototype.detachBeforeTermination = function detach() {
        this._wrapped.detachBeforeTermination();
    };
    
    DependencyWorkersTask.prototype.terminate = function terminate() {
        this._wrapped.terminate();
    };
    
    DependencyWorkersTask.prototype.registerTaskDependency = function registerTaskDependency(taskKey) {
        return this._wrapped.registerTaskDependency(taskKey);
    };
    
    DependencyWorkersTask.prototype.calculatePriority = function calculatePriority() {
        return this._wrapped.calculatePriority();
    };
    
    DependencyWorkersTask.prototype.customEvent = function customEvent(arg0, arg1) {
        return this._wrapped.customEvent(arg0, arg1);
    };
    
    DependencyWorkersTask.prototype.on = function on(event, listener) {
        if (!this._eventListeners[event]) {
            throw 'dependencyWorkers: Task has no event ' + event;
        }
        this._eventListeners[event].push(listener);
    };
    
    Object.defineProperty(DependencyWorkersTask.prototype, 'key', {
        get: function getKey() {
            return this._key;
        }
    });
    
    Object.defineProperty(DependencyWorkersTask.prototype, 'dependTaskKeys', {
        get: function getDependTaskKeys() {
            return this._wrapped.dependTaskKeys;
        }
    });
    
    Object.defineProperty(DependencyWorkersTask.prototype, 'dependTaskResults', {
        get: function getDependTaskResults() {
            return this._wrapped.dependTaskResults;
        }
    });
    
    DependencyWorkersTask.prototype._onEvent = function onEvent(event, arg1, arg2) {
        if (event == 'statusUpdated') {
            arg1 = this._modifyStatus(arg1);
        }
        var listeners = this._eventListeners[event];
        for (var i = 0; i < listeners.length; ++i) {
            listeners[i].call(this, arg1, arg2);
        }
    };
    
    DependencyWorkersTask.prototype._modifyStatus = function modifyStatus(status) {
        return status;
    };
    
    DependencyWorkersTask.prototype._registerWrappedEvent = function registerWrappedEvent(event) {
        var that = this;
        this._wrapped.on(event, function(arg1, arg2) {
            that._onEvent(event, arg1, arg2);
        });
    };

    return DependencyWorkersTask;
})();

module.exports = DependencyWorkersTask;
},{}],6:[function(require,module,exports){
'use strict';

/* global console: false */
/* global Promise: false */

var JsBuiltinHashMap = require('js-builtin-hash-map');
var DependencyWorkersTaskInternals = require('dependency-workers-task-internals');
var DependencyWorkersTaskContext = require('dependency-workers-task-context');

var DependencyWorkers = (function DependencyWorkersClosure() {
    function DependencyWorkers(workerInputRetreiver) {
        var that = this;
        that._workerInputRetreiver = workerInputRetreiver;
        that._taskInternalss = new JsBuiltinHashMap();
        that._workerPoolByTaskType = [];
        that._taskOptionsByTaskType = [];
        
        if (!workerInputRetreiver.getWorkerTypeOptions) {
            throw 'dependencyWorkers: No ' +
                'workerInputRetreiver.getWorkerTypeOptions() method';
        }
        if (!workerInputRetreiver.getKeyAsString) {
            throw 'dependencyWorkers: No ' +
                'workerInputRetreiver.getKeyAsString() method';
        }
    }
    
    DependencyWorkers.prototype.startTask = function startTask(
        taskKey, callbacks) {
        
        var dependencyWorkers = this;
        
        var strKey = this._workerInputRetreiver.getKeyAsString(taskKey);
        var addResult = this._taskInternalss.tryAdd(strKey, function() {
            return new DependencyWorkersTaskInternals();
        });
        
        var taskInternals = addResult.value;
        var taskContext = new DependencyWorkersTaskContext(
            taskInternals, callbacks);
        
        if (addResult.isNew) {
            taskInternals.initialize(
                taskKey,
                this,
                this._workerInputRetreiver,
                this._taskInternalss,
                addResult.iterator,
                this._workerInputRetreiver);
                
            this._workerInputRetreiver.taskStarted(taskInternals.taskApi);
        }

        return taskContext;
    };
    
    DependencyWorkers.prototype.startTaskPromise =
            function startTaskPromise(taskKey) {
        
        var that = this;
        return new Promise(function(resolve, reject) {
            var taskContext = that.startTask(
                taskKey, { 'onData': onData, 'onTerminated': onTerminated });
                
            var processedData = taskContext.getProcessedData();
            var hasData = processedData.length > 0;
            var result;
            if (hasData) {
                result = processedData[processedData.length - 1];
            }
            
            function onData(data) {
                hasData = true;
                result = data;
            }
            
            function onTerminated(isAborted) {
                if (isAborted) {
                    reject('Task is aborted');
                } else if (hasData) {
                    resolve(result);
                } else {
                    reject('Task terminated but no data returned');
                }
            }
        });
    };
    
    DependencyWorkers.prototype.terminateInactiveWorkers = function() {
        for (var taskType in this._workerPoolByTaskType) {
            var workerPool = this._workerPoolByTaskType[taskType];
            for (var i = 0; i < workerPool.length; ++i) {
                workerPool[i].proxy.terminate();
            }
            workerPool.length = 0;
        }
    };
    
    DependencyWorkers.prototype._dataReady = function dataReady(
            taskInternals, dataToProcess, workerType, canSkip) {
        
        var that = this;
        var worker;
        var workerPool = that._workerPoolByTaskType[workerType];
        if (!workerPool) {
            workerPool = [];
            that._workerPoolByTaskType[workerType] = workerPool;
        }
        if (workerPool.length > 0) {
            worker = workerPool.pop();
        } else {
            var workerArgs = that._workerInputRetreiver.getWorkerTypeOptions(
                workerType);

            if (!workerArgs) {
                taskInternals.newData(dataToProcess);
                taskInternals.workerDone();
                return;
            }
            
            worker = {
                proxy: new asyncProxy.AsyncProxyMaster(
                    workerArgs.scriptsToImport,
                    workerArgs.ctorName,
                    workerArgs.ctorArgs),
                transferables: workerArgs.transferables,
                pathToTransferablesInPromiseResult: workerArgs.pathToTransferablesInPromiseResult
            };
        }
        
        var args = [dataToProcess, taskInternals.taskKey];
        var options = {
            'isReturnPromise': true,
            'transferables': worker.transferables,
            'pathToTransferablesInPromiseResult': worker.pathToTransferablesInPromiseResult
        };

        var promise = worker.proxy.callFunction('start', args, options);
        promise
            .then(function(processedData) {
                taskInternals.newData(processedData, canSkip);
                return processedData;
            }).catch(function(e) {
                console.log('Error in DependencyWorkers\' worker: ' + e);
                return e;
            }).then(function(result) {
                workerPool.push(worker);
                taskInternals.workerDone();
            });
    };
    
    DependencyWorkers.prototype.waitForSchedule = function waitForSchedule(scheduleNotifier) {
        scheduleNotifier.schedule({ 'jobDone': function() { } });
    };
    
    DependencyWorkers.prototype.initializingTask = function initializingTask(taskApi) {
        // Do nothing, overriden by inheritors
    };
    
    return DependencyWorkers;
})();

module.exports = DependencyWorkers;
},{"dependency-workers-task-context":2,"dependency-workers-task-internals":3,"js-builtin-hash-map":8}],7:[function(require,module,exports){
'use strict';

var LinkedList = require('linked-list');

var HashMap = (function HashMapClosure() {

function HashMap(hasher) {
    var that = this;
    that._hasher = hasher;
    that.clear();
}

HashMap.prototype.clear = function clear() {
    this._listByKey = [];
    this._listOfLists = new LinkedList();
    this._count = 0;
};

HashMap.prototype.getFromKey = function getFromKey(key) {
    var hashCode = this._hasher['getHashCode'](key);
    var hashElements = this._listByKey[hashCode];
    if (!hashElements) {
        return null;
    }
    var list = hashElements.list;
    
    var iterator = list.getFirstIterator();
    while (iterator !== null) {
        var item = list.getFromIterator(iterator);
        if (this._hasher['isEqual'](item.key, key)) {
            return item.value;
        }
        
        iterator = list.getNextIterator(iterator);
    }

    return null;
};

HashMap.prototype.getFromIterator = function getFromIterator(iterator) {
    return iterator._hashElements.list.getFromIterator(iterator._internalIterator).value;
};

HashMap.prototype.tryAdd = function tryAdd(key, createValue) {
    var hashCode = this._hasher['getHashCode'](key);
    var hashElements = this._listByKey[hashCode];
    if (!hashElements) {
        hashElements = {
            hashCode: hashCode,
            list: new LinkedList(),
            listOfListsIterator: null
        };
        hashElements.listOfListsIterator = this._listOfLists.add(hashElements);
        this._listByKey[hashCode] = hashElements;
    }
    
    var iterator = {
        _hashElements: hashElements,
        _internalIterator: null
    };
    
    iterator._internalIterator = hashElements.list.getFirstIterator();
    while (iterator._internalIterator !== null) {
        var item = hashElements.list.getFromIterator(iterator._internalIterator);
        if (this._hasher['isEqual'](item.key, key)) {
            return {
                iterator: iterator,
                isNew: false,
                value: item.value
            };
        }
        
        iterator._internalIterator = hashElements.list.getNextIterator(iterator._internalIterator);
    }
    
    var value = createValue();
    iterator._internalIterator = hashElements.list.add({
        key: key,
        value: value
    });
    ++this._count;
    
    return {
        iterator: iterator,
        isNew: true,
        value: value
    };
};

HashMap.prototype.remove = function remove(iterator) {
    var oldListCount = iterator._hashElements.list.getCount();
    iterator._hashElements.list.remove(iterator._internalIterator);
    var newListCount = iterator._hashElements.list.getCount();
    
    this._count += (newListCount - oldListCount);
    if (newListCount === 0) {
        this._listOfLists.remove(iterator._hashElements.listOfListsIterator);
        delete this._listByKey[iterator._hashElements.hashCode];
    }
};

HashMap.prototype.getCount = function getCount() {
    return this._count;
};

HashMap.prototype.getFirstIterator = function getFirstIterator() {
    var firstListIterator = this._listOfLists.getFirstIterator();
    var firstHashElements = null;
    var firstInternalIterator = null;
    if (firstListIterator !== null) {
        firstHashElements = this._listOfLists.getFromIterator(firstListIterator);
        firstInternalIterator = firstHashElements.list.getFirstIterator();
    }
    if (firstInternalIterator === null) {
        return null;
    }
    
    return {
        _hashElements: firstHashElements,
        _internalIterator: firstInternalIterator
    };
};

HashMap.prototype.getNextIterator = function getNextIterator(iterator) {
    var nextIterator = {
        _hashElements: iterator._hashElements,
        _internalIterator: iterator._hashElements.list.getNextIterator(
            iterator._internalIterator)
    };
    
    while (nextIterator._internalIterator === null) {
        var nextListOfListsIterator = this._listOfLists.getNextIterator(
            iterator._hashElements.listOfListsIterator);
        if (nextListOfListsIterator === null) {
            return null;
        }
        
        nextIterator._hashElements = this._listOfLists.getFromIterator(
            nextListOfListsIterator);
        nextIterator._internalIterator =
            nextIterator._hashElements.list.getFirstIterator();
    }
    return nextIterator;
};

return HashMap;
})();

module.exports = HashMap;
},{"linked-list":9}],8:[function(require,module,exports){
'use strict';

var HashMap = require('hash-map');

var JsBuiltinHashMap = (function HashMapClosure() {
    
// This class expose same API as HashMap but not requiring getHashCode() and isEqual() functions.
// That way it's easy to switch between implementations.

var simpleHasher = {
    'getHashCode': function getHashCode(key) {
        return key;
    },
    
    'isEqual': function isEqual(key1, key2) {
        return key1 === key2;
    }
};

function JsBuiltinHashMap() {
    HashMap.call(this, /*hasher=*/simpleHasher);
}

JsBuiltinHashMap.prototype = Object.create(HashMap.prototype);

return JsBuiltinHashMap;
})();

module.exports = JsBuiltinHashMap;
},{"hash-map":7}],9:[function(require,module,exports){
'use strict';

var LinkedList = (function LinkedListClosure() {

function LinkedList() {
    this.clear();
}

LinkedList.prototype.clear = function clear() {
    this._first = { _prev: null, _parent: this };
    this._last = { _next: null, _parent: this };
    this._count = 0;
    
    this._last._prev = this._first;
    this._first._next = this._last;
};

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

LinkedList.prototype.getFromIterator = function getFromIterator(iterator) {
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

module.exports = LinkedList;
},{}],10:[function(require,module,exports){
'use strict';

var DependencyWorkers = require('dependency-workers');

var SchedulerDependencyWorkers = (function SchedulerDependencyWorkersClosure() {
    function SchedulerDependencyWorkers(scheduler, inputRetreiver) {
        var that = this;
        DependencyWorkers.call(this, inputRetreiver);
        that._scheduler = scheduler;
        that._isDisableWorkerCache = [];
        that._inputRetreiver = inputRetreiver;
    }
    
    SchedulerDependencyWorkers.prototype = Object.create(DependencyWorkers.prototype);
    
    SchedulerDependencyWorkers.prototype.initializingTask = function initializingTask(taskApi, scheduleNotifier) {
        var that = this;
        taskApi.on('dependencyTaskCustom', function(customEventName, dependencyTaskKey) {
            if (customEventName !== 'aborting') {
                return;
            }
            
            if (!that._scheduler.shouldAbort(scheduleNotifier)) {
                throw 'Task ' + dependencyTaskKey + ' aborted but a task depends ' +
                    'on it didn\'t. Check scheduler consistency';
            }
            
            scheduleNotifier.abort(/*abortByScheduler=*/false);
        });
    };

    SchedulerDependencyWorkers.prototype.waitForSchedule = function waitForSchedule(scheduleNotifier, workerType) {
        if (this._isDisableWorkerCache[workerType] === undefined) {
            this._isDisableWorkerCache[workerType] = this._inputRetreiver.getWorkerTypeOptions(workerType) === null;
        }
        
        if (this._isDisableWorkerCache[workerType]) {
            DependencyWorkers.prototype.waitForSchedule.call(this, scheduleNotifier);
            return;
        }

        var isFinished = false;
        var jobCallbacks = null;
        var that = this;

        this._scheduler.enqueueJob(
            function onScheduled(resource, jobContext, jobCallbacks_) {
                if (jobContext !== scheduleNotifier) {
                    throw 'dependencyWorkers: Wrong jobContext - seems internal error in resource-scheduler.js';
                }
                
                if (isFinished) {
                    throw 'dependencyWorkers: scheduled after finish';
                }

                if (jobCallbacks !== null) {
                    throw 'dependencyWorkers: Scheduled twice';
                }
                
                jobCallbacks = jobCallbacks_;
                scheduleNotifier.schedule(jobCallbacks);
            },
            /*jobContext=*/scheduleNotifier,
            function onAborted() {
                if (isFinished) {
                    throw 'dependencyWorkers: abort after finish';
                }
                
                if (jobCallbacks !== null) {
                    throw 'dependencyWorkers: abort after scheduled';
                }
                
                jobCallbacks = null;
                isFinished = true;
                scheduleNotifier.abort(/*abortByScheduler=*/true);
            });
    };
    
    return SchedulerDependencyWorkers;
})();

module.exports = SchedulerDependencyWorkers;
},{"dependency-workers":6}],11:[function(require,module,exports){
'use strict';

var WrapperInputRetreiverBase = (function WrapperInputRetreiverBaseClosure() {
    function WrapperInputRetreiverBase(inputRetreiver) {
        if (!inputRetreiver.getKeyAsString) {
            throw 'dependencyWorkers: No ' +
                'inputRetreiver.getKeyAsString() method';
        }
        if (!inputRetreiver.getWorkerTypeOptions) {
            throw 'dependencyWorkers: No ' +
                'inputRetreiver.getTaskTypeOptions() method';
        }

        var that = this;
        that._inputRetreiver = inputRetreiver;
    }
    
    WrapperInputRetreiverBase.prototype.taskStarted =
            function taskStarted(task) {
        
        throw 'dependencyWorkers: Not implemented taskStarted()';
    };
    
    WrapperInputRetreiverBase.prototype.getKeyAsString = function(key) {
        return this._inputRetreiver.getKeyAsString(key);
    };
    
    
    WrapperInputRetreiverBase.prototype.getWorkerTypeOptions = function(taskType) {
        return this._inputRetreiver.getWorkerTypeOptions(taskType);
    };
    
    return WrapperInputRetreiverBase;
})();

module.exports = WrapperInputRetreiverBase;
},{}]},{},[1])(1)
});
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJzcmMvZGVwZW5kZW5jeS13b3JrZXJzLWV4cG9ydHMuanMiLCJzcmMvZGVwZW5kZW5jeS13b3JrZXJzLXRhc2stY29udGV4dC5qcyIsInNyYy9kZXBlbmRlbmN5LXdvcmtlcnMtdGFzay1pbnRlcm5hbHMuanMiLCJzcmMvZGVwZW5kZW5jeS13b3JrZXJzLXRhc2stc2NoZWR1bGVyLmpzIiwic3JjL2RlcGVuZGVuY3ktd29ya2Vycy10YXNrLmpzIiwic3JjL2RlcGVuZGVuY3ktd29ya2Vycy5qcyIsInNyYy9oYXNoLW1hcC5qcyIsInNyYy9qcy1idWlsdGluLWhhc2gtbWFwLmpzIiwic3JjL2xpbmtlZC1saXN0LmpzIiwic3JjL3NjaGVkdWxlci1kZXBlbmRlbmN5LXdvcmtlcnMuanMiLCJzcmMvd3JhcHBlci1pbnB1dC1yZXRyZWl2ZXItYmFzZS5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTtBQ0FBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDUEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzlEQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdGdCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNsQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbkdBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2xLQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BKQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzVCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BHQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNqRkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBIiwiZmlsZSI6ImdlbmVyYXRlZC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzQ29udGVudCI6WyIoZnVuY3Rpb24gZSh0LG4scil7ZnVuY3Rpb24gcyhvLHUpe2lmKCFuW29dKXtpZighdFtvXSl7dmFyIGE9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtpZighdSYmYSlyZXR1cm4gYShvLCEwKTtpZihpKXJldHVybiBpKG8sITApO3ZhciBmPW5ldyBFcnJvcihcIkNhbm5vdCBmaW5kIG1vZHVsZSAnXCIrbytcIidcIik7dGhyb3cgZi5jb2RlPVwiTU9EVUxFX05PVF9GT1VORFwiLGZ9dmFyIGw9bltvXT17ZXhwb3J0czp7fX07dFtvXVswXS5jYWxsKGwuZXhwb3J0cyxmdW5jdGlvbihlKXt2YXIgbj10W29dWzFdW2VdO3JldHVybiBzKG4/bjplKX0sbCxsLmV4cG9ydHMsZSx0LG4scil9cmV0dXJuIG5bb10uZXhwb3J0c312YXIgaT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2Zvcih2YXIgbz0wO288ci5sZW5ndGg7bysrKXMocltvXSk7cmV0dXJuIHN9KSIsIid1c2Ugc3RyaWN0JztcclxuXHJcbm1vZHVsZS5leHBvcnRzLkRlcGVuZGVuY3lXb3JrZXJzID0gcmVxdWlyZSgnZGVwZW5kZW5jeS13b3JrZXJzJyk7XHJcbm1vZHVsZS5leHBvcnRzLkRlcGVuZGVuY3lXb3JrZXJzVGFza0NvbnRleHQgPSByZXF1aXJlKCdkZXBlbmRlbmN5LXdvcmtlcnMtdGFzay1jb250ZXh0Jyk7XHJcbm1vZHVsZS5leHBvcnRzLkRlcGVuZGVuY3lXb3JrZXJzVGFzayA9IHJlcXVpcmUoJ2RlcGVuZGVuY3ktd29ya2Vycy10YXNrJyk7XHJcbm1vZHVsZS5leHBvcnRzLldyYXBwZXJJbnB1dFJldHJlaXZlckJhc2UgPSByZXF1aXJlKCd3cmFwcGVyLWlucHV0LXJldHJlaXZlci1iYXNlJyk7XHJcbm1vZHVsZS5leHBvcnRzLlNjaGVkdWxlckRlcGVuZGVuY3lXb3JrZXJzID0gcmVxdWlyZSgnc2NoZWR1bGVyLWRlcGVuZGVuY3ktd29ya2VycycpO1xyXG5tb2R1bGUuZXhwb3J0cy5EZXBlbmRlbmN5V29ya2Vyc1Rhc2tTY2hlZHVsZXIgPSByZXF1aXJlKCdkZXBlbmRlbmN5LXdvcmtlcnMtdGFzay1zY2hlZHVsZXInKTsiLCIndXNlIHN0cmljdCc7XHJcblxyXG52YXIgRGVwZW5kZW5jeVdvcmtlcnNUYXNrQ29udGV4dCA9IChmdW5jdGlvbiBEZXBlbmRlbmN5V29ya2Vyc1Rhc2tDb250ZXh0Q2xvc3VyZSgpIHtcclxuICAgIGZ1bmN0aW9uIERlcGVuZGVuY3lXb3JrZXJzVGFza0NvbnRleHQodGFza0ludGVybmFscywgY2FsbGJhY2tzKSB7XHJcbiAgICAgICAgdGhpcy5fdGFza0ludGVybmFscyA9IHRhc2tJbnRlcm5hbHM7XHJcbiAgICAgICAgdGhpcy5fY2FsbGJhY2tzID0gY2FsbGJhY2tzO1xyXG4gICAgICAgIHRoaXMuX3Rhc2tDb250ZXh0c0l0ZXJhdG9yID0gdGFza0ludGVybmFscy50YXNrQ29udGV4dHMuYWRkKHRoaXMpO1xyXG4gICAgICAgIHRoaXMuX3ByaW9yaXR5Q2FsY3VsYXRvckl0ZXJhdG9yID0gbnVsbDtcclxuICAgIH1cclxuICAgIFxyXG4gICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KERlcGVuZGVuY3lXb3JrZXJzVGFza0NvbnRleHQucHJvdG90eXBlLCAnaXNBY3RpdmUnLCB7IGdldDogZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgcmV0dXJuIHRoaXMuX3Rhc2tJbnRlcm5hbHMuaXNBY3R1YWxUZXJtaW5hdGlvblBlbmRpbmcgfHwgIXRoaXMuX3Rhc2tJbnRlcm5hbHMuaXNUZXJtaW5hdGVkO1xyXG4gICAgfSB9KTtcclxuICAgIFxyXG4gICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KERlcGVuZGVuY3lXb3JrZXJzVGFza0NvbnRleHQucHJvdG90eXBlLCAnaXNUZXJtaW5hdGVkJywgeyBnZXQ6IGZ1bmN0aW9uKCkge1xyXG4gICAgICAgIHJldHVybiB0aGlzLl90YXNrSW50ZXJuYWxzLmlzVGVybWluYXRlZDtcclxuICAgIH0gfSk7XHJcbiAgICBcclxuICAgIERlcGVuZGVuY3lXb3JrZXJzVGFza0NvbnRleHQucHJvdG90eXBlLmdldFByb2Nlc3NlZERhdGEgPSBmdW5jdGlvbiBnZXRQcm9jZXNzZWREYXRhKCkge1xyXG4gICAgICAgIHJldHVybiB0aGlzLl90YXNrSW50ZXJuYWxzLnByb2Nlc3NlZERhdGE7XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBEZXBlbmRlbmN5V29ya2Vyc1Rhc2tDb250ZXh0LnByb3RvdHlwZS5zZXRQcmlvcml0eUNhbGN1bGF0b3IgPSBmdW5jdGlvbiBzZXRQcmlvcml0eUNhbGN1bGF0b3IoY2FsY3VsYXRvcikge1xyXG4gICAgICAgIGlmICh0aGlzLl9wcmlvcml0eUNhbGN1bGF0b3JJdGVyYXRvciAhPT0gbnVsbCkge1xyXG4gICAgICAgICAgICB0aGlzLl90YXNrSW50ZXJuYWxzLnByaW9yaXR5Q2FsY3VsYXRvcnMucmVtb3ZlKHRoaXMuX3ByaW9yaXR5Q2FsY3VsYXRvckl0ZXJhdG9yKTtcclxuICAgICAgICAgICAgdGhpcy5fcHJpb3JpdHlDYWxjdWxhdG9ySXRlcmF0b3IgPSBudWxsO1xyXG4gICAgICAgICAgICAvLyBUaGUgZm9sbG93aW5nIG9wdGltaXphdGlvbiwgdG8gcmVnaXN0ZXIgb25seSBpZiBtZSBoYXZpbmcgY2FsY3VsYXRvciwgc2VlbXMgdG8gYmUgYnVnZ3k7IEl0IG1pZ2h0IGNhdXNlXHJcbiAgICAgICAgICAgIC8vIGEgU2NoZWR1bGVyVGFzayB0byBhYm9ydCBhbHRob3VnaCBoYXZpbmcgbm9uIGFib3J0ZWQgZGVwZW5kYW50IHRhc2tzLlxyXG4gICAgICAgICAgICAvLyBJbnN0ZWFkIHdlIHJlZ2lzdGVyIGZvciBhbGwgdGhlIGxpZmV0aW1lIG9mIHRoZSB0YXNrSW50ZXJuYWxzXHJcbiAgICAgICAgICAgIC8vaWYgKCFjYWxjdWxhdG9yICYmIHRoaXMuX3Rhc2tJbnRlcm5hbHMucHJpb3JpdHlDYWxjdWxhdG9ycy5nZXRDb3VudCgpID09PSAwKSB7XHJcbiAgICAgICAgICAgIC8vICAgIHRoaXMuX3Rhc2tJbnRlcm5hbHMudW5yZWdpc3RlckRlcGVuZFByaW9yaXR5Q2FsY3VsYXRvcigpO1xyXG4gICAgICAgICAgICAvL31cclxuICAgICAgICAvL30gZWxzZSBpZiAoY2FsY3VsYXRvciAmJiB0aGlzLl90YXNrSW50ZXJuYWxzLnByaW9yaXR5Q2FsY3VsYXRvcnMuZ2V0Q291bnQoKSA9PT0gMCkge1xyXG4gICAgICAgIC8vICAgIHRoaXMuX3Rhc2tJbnRlcm5hbHMucmVnaXN0ZXJEZXBlbmRQcmlvcml0eUNhbGN1bGF0b3IoKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKGNhbGN1bGF0b3IpIHtcclxuICAgICAgICAgICAgdGhpcy5fcHJpb3JpdHlDYWxjdWxhdG9ySXRlcmF0b3IgPSB0aGlzLl90YXNrSW50ZXJuYWxzLnByaW9yaXR5Q2FsY3VsYXRvcnMuYWRkKGNhbGN1bGF0b3IpO1xyXG4gICAgICAgIH1cclxuICAgIH07XHJcbiAgICBcclxuICAgIERlcGVuZGVuY3lXb3JrZXJzVGFza0NvbnRleHQucHJvdG90eXBlLnVucmVnaXN0ZXIgPSBmdW5jdGlvbigpIHtcclxuICAgICAgICBpZiAoIXRoaXMuX3Rhc2tDb250ZXh0c0l0ZXJhdG9yKSB7XHJcbiAgICAgICAgICAgIHRocm93ICdkZXBlbmRlbmN5V29ya2VyczogQWxyZWFkeSB1bnJlZ2lzdGVyZWQnO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICB0aGlzLnNldFByaW9yaXR5Q2FsY3VsYXRvcihudWxsKTtcclxuICAgICAgICBcclxuICAgICAgICB0aGlzLl90YXNrSW50ZXJuYWxzLnRhc2tDb250ZXh0cy5yZW1vdmUodGhpcy5fdGFza0NvbnRleHRzSXRlcmF0b3IpO1xyXG4gICAgICAgIHRoaXMuX3Rhc2tDb250ZXh0c0l0ZXJhdG9yID0gbnVsbDtcclxuICAgICAgICBpZiAoIXRoaXMuX3Rhc2tJbnRlcm5hbHMuaXNUZXJtaW5hdGVkKSB7XHJcbiAgICAgICAgICAgIGlmICh0aGlzLl90YXNrSW50ZXJuYWxzLnRhc2tDb250ZXh0cy5nZXRDb3VudCgpID09PSAwKSB7XHJcbiAgICAgICAgICAgICAgICB0aGlzLl90YXNrSW50ZXJuYWxzLmFib3J0KC8qYWJvcnRCeVNjaGVkdWxlcj0qL2ZhbHNlKTtcclxuICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgIHRoaXMuX3Rhc2tJbnRlcm5hbHMuc3RhdHVzVXBkYXRlKCk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICB9O1xyXG5cclxuICAgIHJldHVybiBEZXBlbmRlbmN5V29ya2Vyc1Rhc2tDb250ZXh0O1xyXG59KSgpO1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBEZXBlbmRlbmN5V29ya2Vyc1Rhc2tDb250ZXh0OyIsIid1c2Ugc3RyaWN0JztcclxuXHJcbnZhciBMaW5rZWRMaXN0ID0gcmVxdWlyZSgnbGlua2VkLWxpc3QnKTtcclxudmFyIEpzQnVpbHRpbkhhc2hNYXAgPSByZXF1aXJlKCdqcy1idWlsdGluLWhhc2gtbWFwJyk7XHJcbnZhciBEZXBlbmRlbmN5V29ya2Vyc1Rhc2sgPSByZXF1aXJlKCdkZXBlbmRlbmN5LXdvcmtlcnMtdGFzaycpO1xyXG5cclxudmFyIERlcGVuZGVuY3lXb3JrZXJzVGFza0ludGVybmFscyA9IChmdW5jdGlvbiBEZXBlbmRlbmN5V29ya2Vyc1Rhc2tJbnRlcm5hbHNDbG9zdXJlKCkge1xyXG4gICAgZnVuY3Rpb24gRGVwZW5kZW5jeVdvcmtlcnNUYXNrSW50ZXJuYWxzKCkge1xyXG4gICAgICAgIC8vIFRoaXMgY2xhc3MgaXMgbm90IGV4cG9zZWQgb3V0c2lkZSBkZXBlbmRlbmN5V29ya2VycyBidXQgYXMgYW4gaW50ZXJuYWwgc3RydWN0LCB0aHVzIFxyXG4gICAgICAgIC8vIG1heSBjb250YWluIHB1YmxpYyBtZW1iZXJzXHJcbiAgICAgICAgXHJcbiAgICAgICAgdGhpcy5pc1Rlcm1pbmF0ZWQgPSBmYWxzZTtcclxuICAgICAgICB0aGlzLmlzQWN0dWFsVGVybWluYXRpb25QZW5kaW5nID0gZmFsc2U7XHJcbiAgICAgICAgdGhpcy5wcm9jZXNzZWREYXRhID0gW107XHJcbiAgICAgICAgdGhpcy50YXNrQXBpID0gbnVsbDtcclxuICAgICAgICBcclxuICAgICAgICB0aGlzLnBlbmRpbmdEYXRhRm9yV29ya2VyID0gW107XHJcbiAgICAgICAgdGhpcy5jYW5Ta2lwTGFzdFBlbmRpbmdEYXRhRm9yV29ya2VyID0gZmFsc2U7XHJcbiAgICAgICAgXHJcbiAgICAgICAgdGhpcy50YXNrQ29udGV4dHMgPSBuZXcgTGlua2VkTGlzdCgpO1xyXG4gICAgICAgIHRoaXMucHJpb3JpdHlDYWxjdWxhdG9ycyA9IG5ldyBMaW5rZWRMaXN0KCk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgdGhpcy50YXNrS2V5ID0gbnVsbDtcclxuICAgICAgICB0aGlzLl9kZXBlbmRzVGFza3NUZXJtaW5hdGVkQ291bnQgPSAwO1xyXG4gICAgICAgIHRoaXMuX3BhcmVudERlcGVuZGVuY3lXb3JrZXJzID0gbnVsbDtcclxuICAgICAgICB0aGlzLl93b3JrZXJJbnB1dFJldHJlaXZlciA9IG51bGw7XHJcbiAgICAgICAgdGhpcy5fcGFyZW50TGlzdCA9IG51bGw7XHJcbiAgICAgICAgdGhpcy5fcGFyZW50SXRlcmF0b3IgPSBudWxsO1xyXG4gICAgICAgIHRoaXMuX2RlcGVuZHNUYXNrQ29udGV4dHMgPSBudWxsO1xyXG4gICAgICAgIHRoaXMuX3ByaW9yaXR5Q2FsY3VsYXRvciA9IG51bGw7XHJcbiAgICAgICAgdGhpcy5faXNSZWdpc3RlcmVkRGVwZW5kUHJpb3JpdHlDYWxjdWxhdG9yID0gZmFsc2U7XHJcbiAgICAgICAgdGhpcy5faXNEZXRhY2hlZCA9IGZhbHNlO1xyXG4gICAgICAgIHRoaXMuX2NhblNraXBMYXN0UHJvY2Vzc2VkRGF0YSA9IGZhbHNlO1xyXG4gICAgICAgIHRoaXMuX2pvYkNhbGxiYWNrcyA9IG51bGw7XHJcbiAgICAgICAgdGhpcy5faXNBYm9ydGVkID0gZmFsc2U7XHJcbiAgICAgICAgdGhpcy5faXNBYm9ydGVkTm90QnlTY2hlZHVsZXIgPSBmYWxzZTtcclxuICAgICAgICB0aGlzLl9pc1VzZXJDYWxsZWRUZXJtaW5hdGUgPSBmYWxzZTtcclxuICAgICAgICB0aGlzLl9pc1dhaXRpbmdGb3JXb3JrZXJSZXN1bHQgPSBmYWxzZTtcclxuICAgICAgICBcclxuICAgICAgICB0aGlzLl9kZXBlbmRUYXNrS2V5cyA9IFtdO1xyXG4gICAgICAgIHRoaXMuX2RlcGVuZFRhc2tSZXN1bHRzID0gW107XHJcbiAgICAgICAgdGhpcy5faGFzRGVwZW5kVGFza0RhdGEgPSBbXTtcclxuICAgICAgICBcclxuICAgICAgICB0aGlzLl9wZW5kaW5nRGVsYXllZEFjdGlvbiA9IGZhbHNlO1xyXG4gICAgICAgIHRoaXMuX3BlbmRpbmdEZWxheWVkRGVwZW5kZW5jeURhdGEgPSBbXTtcclxuICAgICAgICB0aGlzLl9wZW5kaW5nRGVsYXllZEVuZGVkID0gZmFsc2U7XHJcbiAgICAgICAgdGhpcy5fcGVuZGluZ0RlbGF5ZWROZXdEYXRhID0gW107XHJcbiAgICAgICAgdGhpcy5fcGVuZGluZ0RlbGF5ZWRDYW5Ta2lwTGFzdE5ld0RhdGEgPSBmYWxzZTtcclxuICAgICAgICB0aGlzLl9wZW5kaW5nV29ya2VyRG9uZSA9IGZhbHNlO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHZhciB0aGF0ID0gdGhpcztcclxuICAgICAgICB0aGlzLl9zY2hlZHVsZU5vdGlmaWVyID0ge1xyXG4gICAgICAgICAgICAnY2FsY3VsYXRlUHJpb3JpdHknOiBmdW5jdGlvbigpIHtcclxuICAgICAgICAgICAgICAgIHJldHVybiB0aGF0LmNhbGN1bGF0ZVByaW9yaXR5KCk7XHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgICdzY2hlZHVsZSc6IGZ1bmN0aW9uKGpvYkNhbGxiYWNrcykge1xyXG4gICAgICAgICAgICAgICAgaWYgKHRoYXQuX2pvYkNhbGxiYWNrcyAhPT0gbnVsbCkge1xyXG4gICAgICAgICAgICAgICAgICAgIHRocm93ICdkZXBlbmRlbmN5V29ya2Vyczogc2NoZWR1bGVOb3RpZmllci5zY2hlZHVsZSB3YXMgY2FsbGVkIHR3aWNlJztcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgaWYgKCgham9iQ2FsbGJhY2tzKSB8fCAham9iQ2FsbGJhY2tzWydqb2JEb25lJ10pIHtcclxuICAgICAgICAgICAgICAgICAgICB0aHJvdyAnZGVwZW5kZW5jeVdvcmtlcnM6IFBhc3NlZCBpbnZhbGlkIGpvYkNhbGxiYWNrcyBhcmd1bWVudCB0byBzY2hlZHVsZU5vdGlmaWVyLnNjaGVkdWxlKCkuIEVuc3VyZSBqb2JDYWxsYmFja3MgaGFzIGpvYkRvbmUgbWV0aG9kJztcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgaWYgKHRoYXQuX2lzQWJvcnRlZE5vdEJ5U2NoZWR1bGVyKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgam9iQ2FsbGJhY2tzLmpvYkRvbmUoKTtcclxuICAgICAgICAgICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIGlmICh0aGlzLmlzVGVybWluYXRlZCAmJiAhdGhpcy5pc0FjdHVhbFRlcm1pbmF0aW9uUGVuZGluZykge1xyXG4gICAgICAgICAgICAgICAgICAgIHRocm93ICdkZXBlbmRlbmN5V29ya2Vyczogc2NoZWR1bGVkIGFmdGVyIHRlcm1pbmF0aW9uJztcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgdmFyIGRhdGFUb1Byb2Nlc3MgPSB0aGF0LnBlbmRpbmdEYXRhRm9yV29ya2VyLnNoaWZ0KCk7XHJcbiAgICAgICAgICAgICAgICB2YXIgY2FuU2tpcCA9IGZhbHNlO1xyXG4gICAgICAgICAgICAgICAgaWYgKHRoYXQucGVuZGluZ0RhdGFGb3JXb3JrZXIubGVuZ3RoID09PSAwKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY2FuU2tpcCA9IHRoYXQuY2FuU2tpcExhc3RQZW5kaW5nRGF0YUZvcldvcmtlcjtcclxuICAgICAgICAgICAgICAgICAgICB0aGF0LmNhblNraXBMYXN0UGVuZGluZ0RhdGFGb3JXb3JrZXIgPSBmYWxzZTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgdGhhdC5fam9iQ2FsbGJhY2tzID0gam9iQ2FsbGJhY2tzO1xyXG4gICAgICAgICAgICAgICAgdGhhdC5fcGFyZW50RGVwZW5kZW5jeVdvcmtlcnMuX2RhdGFSZWFkeShcclxuICAgICAgICAgICAgICAgICAgICB0aGF0LFxyXG4gICAgICAgICAgICAgICAgICAgIGRhdGFUb1Byb2Nlc3MuZGF0YSxcclxuICAgICAgICAgICAgICAgICAgICBkYXRhVG9Qcm9jZXNzLndvcmtlclR5cGUsXHJcbiAgICAgICAgICAgICAgICAgICAgY2FuU2tpcCk7XHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgICdhYm9ydCc6IGZ1bmN0aW9uKGFib3J0ZWRCeVNjaGVkdWxlcikge1xyXG4gICAgICAgICAgICAgICAgdGhhdC5hYm9ydChhYm9ydGVkQnlTY2hlZHVsZXIpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgRGVwZW5kZW5jeVdvcmtlcnNUYXNrSW50ZXJuYWxzLnByb3RvdHlwZS5pbml0aWFsaXplID0gZnVuY3Rpb24oXHJcbiAgICAgICAgICAgIHRhc2tLZXksIGRlcGVuZGVuY3lXb3JrZXJzLCBpbnB1dFJldHJlaXZlciwgbGlzdCwgaXRlcmF0b3IgLyosIGhhc2hlciovKSB7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICB0aGlzLnRhc2tLZXkgPSB0YXNrS2V5O1xyXG4gICAgICAgIHRoaXMuX3BhcmVudERlcGVuZGVuY3lXb3JrZXJzID0gZGVwZW5kZW5jeVdvcmtlcnM7XHJcbiAgICAgICAgdGhpcy5fd29ya2VySW5wdXRSZXRyZWl2ZXIgPSBpbnB1dFJldHJlaXZlcjtcclxuICAgICAgICB0aGlzLl9wYXJlbnRMaXN0ID0gbGlzdDtcclxuICAgICAgICB0aGlzLl9wYXJlbnRJdGVyYXRvciA9IGl0ZXJhdG9yO1xyXG4gICAgICAgIHRoaXMuX2RlcGVuZHNUYXNrQ29udGV4dHMgPSBuZXcgSnNCdWlsdGluSGFzaE1hcCgpO1xyXG4gICAgICAgIHRoaXMudGFza0FwaSA9IG5ldyBEZXBlbmRlbmN5V29ya2Vyc1Rhc2sodGhpcywgdGFza0tleSk7XHJcbiAgICAgICAgdGhpcy5fcmVnaXN0ZXJEZXBlbmRQcmlvcml0eUNhbGN1bGF0b3IoKTtcclxuICAgICAgICBkZXBlbmRlbmN5V29ya2Vycy5pbml0aWFsaXppbmdUYXNrKHRoaXMudGFza0FwaSwgdGhpcy5fc2NoZWR1bGVOb3RpZmllcik7XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBEZXBlbmRlbmN5V29ya2Vyc1Rhc2tJbnRlcm5hbHMucHJvdG90eXBlLmVuZGVkID0gZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgdGhpcy5fcGVuZGluZ0RlbGF5ZWRFbmRlZCA9IHRydWU7XHJcbiAgICAgICAgdGhpcy5fc2NoZWR1bGVQZW5kaW5nRGVsYXllZEFjdGlvbnMoKTtcclxuICAgIH07XHJcbiAgICBcclxuICAgIERlcGVuZGVuY3lXb3JrZXJzVGFza0ludGVybmFscy5wcm90b3R5cGUuc3RhdHVzVXBkYXRlID0gZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgdmFyIHN0YXR1cyA9IHtcclxuICAgICAgICAgICAgJ2hhc0xpc3RlbmVycyc6IHRoaXMudGFza0NvbnRleHRzLmdldENvdW50KCkgPiAwLFxyXG4gICAgICAgICAgICAnaXNXYWl0aW5nRm9yV29ya2VyUmVzdWx0JzogdGhpcy5faXNXYWl0aW5nRm9yV29ya2VyUmVzdWx0LFxyXG4gICAgICAgICAgICAndGVybWluYXRlZERlcGVuZHNUYXNrcyc6IHRoaXMuX2RlcGVuZHNUYXNrc1Rlcm1pbmF0ZWRDb3VudCxcclxuICAgICAgICAgICAgJ2RlcGVuZHNUYXNrcyc6IHRoaXMuX2RlcGVuZHNUYXNrQ29udGV4dHMuZ2V0Q291bnQoKVxyXG4gICAgICAgIH07XHJcbiAgICAgICAgdGhpcy50YXNrQXBpLl9vbkV2ZW50KCdzdGF0dXNVcGRhdGVkJywgc3RhdHVzKTtcclxuXHJcbiAgICAgICAgaWYgKHRoaXMuaXNBY3R1YWxUZXJtaW5hdGlvblBlbmRpbmcgJiYgIXRoaXMuX2lzV2FpdGluZ0ZvcldvcmtlclJlc3VsdCkge1xyXG4gICAgICAgICAgICB0aGlzLmlzQWN0dWFsVGVybWluYXRpb25QZW5kaW5nID0gZmFsc2U7XHJcbiAgICAgICAgICAgIHRoaXMuZW5kZWQoKTtcclxuICAgICAgICB9XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBEZXBlbmRlbmN5V29ya2Vyc1Rhc2tJbnRlcm5hbHMucHJvdG90eXBlLmNhbGN1bGF0ZVByaW9yaXR5ID0gZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgdmFyIGl0ZXJhdG9yID0gdGhpcy5wcmlvcml0eUNhbGN1bGF0b3JzLmdldEZpcnN0SXRlcmF0b3IoKTtcclxuICAgICAgICB2YXIgaXNGaXJzdCA9IHRydWU7XHJcbiAgICAgICAgdmFyIHByaW9yaXR5ID0gMDtcclxuICAgICAgICB3aGlsZSAoaXRlcmF0b3IgIT09IG51bGwpIHtcclxuICAgICAgICAgICAgdmFyIHByaW9yaXR5Q2FsY3VsYXRvciA9IHRoaXMucHJpb3JpdHlDYWxjdWxhdG9ycy5nZXRGcm9tSXRlcmF0b3IoaXRlcmF0b3IpO1xyXG4gICAgICAgICAgICB2YXIgY3VycmVudFByaW9yaXR5ID0gcHJpb3JpdHlDYWxjdWxhdG9yKCk7XHJcbiAgICAgICAgICAgIGlmIChpc0ZpcnN0IHx8IGN1cnJlbnRQcmlvcml0eSA+IHByaW9yaXR5KSB7XHJcbiAgICAgICAgICAgICAgICBwcmlvcml0eSA9IGN1cnJlbnRQcmlvcml0eTtcclxuICAgICAgICAgICAgICAgIGlzRmlyc3QgPSBmYWxzZTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBpdGVyYXRvciA9IHRoaXMucHJpb3JpdHlDYWxjdWxhdG9ycy5nZXROZXh0SXRlcmF0b3IoaXRlcmF0b3IpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgcmV0dXJuIHByaW9yaXR5O1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgRGVwZW5kZW5jeVdvcmtlcnNUYXNrSW50ZXJuYWxzLnByb3RvdHlwZS5uZXdEYXRhID0gZnVuY3Rpb24oZGF0YSwgY2FuU2tpcCkge1xyXG4gICAgICAgIGlmICh0aGlzLl9wZW5kaW5nRGVsYXllZENhblNraXBMYXN0TmV3RGF0YSkge1xyXG4gICAgICAgICAgICB0aGlzLl9wZW5kaW5nRGVsYXllZE5ld0RhdGFbdGhpcy5fcGVuZGluZ0RlbGF5ZWROZXdEYXRhLmxlbmd0aCAtIDFdID0gZGF0YTtcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICB0aGlzLl9wZW5kaW5nRGVsYXllZE5ld0RhdGEucHVzaChkYXRhKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgdGhpcy5fcGVuZGluZ0RlbGF5ZWRDYW5Ta2lwTGFzdE5ld0RhdGEgPSAhIWNhblNraXA7XHJcbiAgICAgICAgdGhpcy5fc2NoZWR1bGVQZW5kaW5nRGVsYXllZEFjdGlvbnMoKTtcclxuICAgIH07XHJcbiAgICBcclxuICAgIERlcGVuZGVuY3lXb3JrZXJzVGFza0ludGVybmFscy5wcm90b3R5cGUud29ya2VyRG9uZSA9IGZ1bmN0aW9uKCkge1xyXG4gICAgICAgIGlmICh0aGlzLl9qb2JDYWxsYmFja3MgPT09IG51bGwpIHtcclxuICAgICAgICAgICAgdGhyb3cgJ2RlcGVuZGVuY3lXb3JrZXJzOiBKb2IgZG9uZSB3aXRob3V0IHByZXZpb3VzbHkgc3RhcnRlZCc7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHZhciBqb2JDYWxsYmFja3MgPSB0aGlzLl9qb2JDYWxsYmFja3M7XHJcbiAgICAgICAgdGhpcy5fam9iQ2FsbGJhY2tzID0gbnVsbDtcclxuICAgICAgICBcclxuICAgICAgICBpZiAodGhpcy5wZW5kaW5nRGF0YUZvcldvcmtlci5sZW5ndGggPT09IDApIHtcclxuICAgICAgICAgICAgdGhpcy5fcGVuZGluZ1dvcmtlckRvbmUgPSB0cnVlO1xyXG4gICAgICAgICAgICB0aGlzLl9zY2hlZHVsZVBlbmRpbmdEZWxheWVkQWN0aW9ucygpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBqb2JDYWxsYmFja3NbJ2pvYkRvbmUnXSgpO1xyXG5cclxuICAgICAgICBpZiAodGhpcy5wZW5kaW5nRGF0YUZvcldvcmtlci5sZW5ndGggPiAwKSB7XHJcbiAgICAgICAgICAgIHRoaXMud2FpdEZvclNjaGVkdWxlKCk7XHJcbiAgICAgICAgfVxyXG4gICAgfTtcclxuICAgIFxyXG4gICAgRGVwZW5kZW5jeVdvcmtlcnNUYXNrSW50ZXJuYWxzLnByb3RvdHlwZS5kYXRhUmVhZHkgPSBmdW5jdGlvbiBkYXRhUmVhZHkoXHJcbiAgICAgICAgbmV3RGF0YVRvUHJvY2Vzcywgd29ya2VyVHlwZSwgY2FuU2tpcCkge1xyXG4gICAgICAgIFxyXG4gICAgICAgIGlmICh0aGlzLmlzVGVybWluYXRlZCkge1xyXG4gICAgICAgICAgICBpZiAodGhpcy5faXNVc2VyQ2FsbGVkVGVybWluYXRlKSB7XHJcbiAgICAgICAgICAgICAgICB0aHJvdyAnZGVwZW5kZW5jeVdvcmtlcnM6IGFscmVhZHkgdGVybWluYXRlZCc7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gVXNlZCBpbiBEZXBlbmRlbmN5V29ya2Vycy5fc3RhcnRXb3JrZXIoKSB3aGVuIHByZXZpb3VzIHdvcmtlciBoYXMgZmluaXNoZWRcclxuICAgICAgICB2YXIgcGVuZGluZ0RhdGEgPSB7XHJcbiAgICAgICAgICAgIGRhdGE6IG5ld0RhdGFUb1Byb2Nlc3MsXHJcbiAgICAgICAgICAgIHdvcmtlclR5cGU6IHdvcmtlclR5cGVcclxuICAgICAgICB9O1xyXG4gICAgICAgIFxyXG4gICAgICAgIGlmICh0aGlzLmNhblNraXBMYXN0UGVuZGluZ0RhdGFGb3JXb3JrZXIpIHtcclxuICAgICAgICAgICAgdGhpcy5wZW5kaW5nRGF0YUZvcldvcmtlclt0aGlzLnBlbmRpbmdEYXRhRm9yV29ya2VyLmxlbmd0aCAtIDFdID0gcGVuZGluZ0RhdGE7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgdGhpcy5wZW5kaW5nRGF0YUZvcldvcmtlci5wdXNoKHBlbmRpbmdEYXRhKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgdGhpcy5jYW5Ta2lwTGFzdFBlbmRpbmdEYXRhRm9yV29ya2VyID0gISFjYW5Ta2lwO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGlmICghdGhpcy5faXNXYWl0aW5nRm9yV29ya2VyUmVzdWx0IHx8IHRoaXMuX3BlbmRpbmdXb3JrZXJEb25lKSB7XHJcbiAgICAgICAgICAgIHRoaXMuX2lzV2FpdGluZ0ZvcldvcmtlclJlc3VsdCA9IHRydWU7XHJcbiAgICAgICAgICAgIHRoaXMuX3BlbmRpbmdXb3JrZXJEb25lID0gZmFsc2U7XHJcbiAgICAgICAgICAgIHRoaXMud2FpdEZvclNjaGVkdWxlKCk7XHJcbiAgICAgICAgICAgIHRoaXMuc3RhdHVzVXBkYXRlKCk7XHJcbiAgICAgICAgfVxyXG4gICAgfTtcclxuICAgIFxyXG4gICAgRGVwZW5kZW5jeVdvcmtlcnNUYXNrSW50ZXJuYWxzLnByb3RvdHlwZS53YWl0Rm9yU2NoZWR1bGUgPSBmdW5jdGlvbiB3YWl0Rm9yU2NoZWR1bGUoKSB7XHJcbiAgICAgICAgdmFyIHdvcmtlclR5cGUgPSB0aGlzLnBlbmRpbmdEYXRhRm9yV29ya2VyWzBdLndvcmtlclR5cGU7XHJcbiAgICAgICAgdGhpcy5fcGFyZW50RGVwZW5kZW5jeVdvcmtlcnMud2FpdEZvclNjaGVkdWxlKHRoaXMuX3NjaGVkdWxlTm90aWZpZXIsIHdvcmtlclR5cGUpO1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgRGVwZW5kZW5jeVdvcmtlcnNUYXNrSW50ZXJuYWxzLnByb3RvdHlwZS5kZXRhY2hCZWZvcmVUZXJtaW5hdGlvbiA9IGZ1bmN0aW9uIGRldGFjaCgpIHtcclxuICAgICAgICBpZiAodGhpcy5faXNEZXRhY2hlZCkge1xyXG4gICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHRoaXMuX2lzRGV0YWNoZWQgPSB0cnVlO1xyXG4gICAgICAgIHRoaXMuX3BhcmVudExpc3QucmVtb3ZlKHRoaXMuX3BhcmVudEl0ZXJhdG9yKTtcclxuICAgICAgICB0aGlzLl9wYXJlbnRJdGVyYXRvciA9IG51bGw7XHJcblxyXG4gICAgICAgIHZhciBpdGVyYXRvciA9IHRoaXMuX2RlcGVuZHNUYXNrQ29udGV4dHMuZ2V0Rmlyc3RJdGVyYXRvcigpO1xyXG4gICAgICAgIHdoaWxlIChpdGVyYXRvciAhPT0gbnVsbCkge1xyXG4gICAgICAgICAgICB2YXIgY29udGV4dCA9IHRoaXMuX2RlcGVuZHNUYXNrQ29udGV4dHMuZ2V0RnJvbUl0ZXJhdG9yKGl0ZXJhdG9yKS50YXNrQ29udGV4dDtcclxuICAgICAgICAgICAgaXRlcmF0b3IgPSB0aGlzLl9kZXBlbmRzVGFza0NvbnRleHRzLmdldE5leHRJdGVyYXRvcihpdGVyYXRvcik7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBjb250ZXh0LnVucmVnaXN0ZXIoKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgdGhpcy5fZGVwZW5kc1Rhc2tDb250ZXh0cy5jbGVhcigpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHRoaXMuX3VucmVnaXN0ZXJEZXBlbmRQcmlvcml0eUNhbGN1bGF0b3IoKTtcclxuICAgIH07XHJcbiAgICBcclxuICAgIERlcGVuZGVuY3lXb3JrZXJzVGFza0ludGVybmFscy5wcm90b3R5cGUuY3VzdG9tRXZlbnQgPSBmdW5jdGlvbiBjdXN0b21FdmVudChhcmcwLCBhcmcxKSB7XHJcbiAgICAgICAgaWYgKHRoaXMuaXNUZXJtaW5hdGVkICYmICF0aGlzLmlzQWN0dWFsVGVybWluYXRpb25QZW5kaW5nKSB7XHJcbiAgICAgICAgICAgIHRocm93ICdkZXBlbmRlbmN5V29ya2VyczogYWxyZWFkeSB0ZXJtaW5hdGVkJztcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgdGhpcy5faXRlcmF0ZUNhbGxiYWNrcyhmdW5jdGlvbihjYWxsYmFja3MpIHtcclxuICAgICAgICAgICAgaWYgKGNhbGxiYWNrcy5vbkN1c3RvbSkge1xyXG4gICAgICAgICAgICAgICAgY2FsbGJhY2tzLm9uQ3VzdG9tKGFyZzAsIGFyZzEpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgdGhpcy50YXNrQXBpLl9vbkV2ZW50KCdjdXN0b20nLCBhcmcwLCBhcmcxKTtcclxuICAgIH07XHJcblxyXG4gICAgRGVwZW5kZW5jeVdvcmtlcnNUYXNrSW50ZXJuYWxzLnByb3RvdHlwZS50ZXJtaW5hdGUgPSBmdW5jdGlvbiB0ZXJtaW5hdGUoKSB7XHJcbiAgICAgICAgaWYgKHRoaXMuX2lzVXNlckNhbGxlZFRlcm1pbmF0ZSkge1xyXG4gICAgICAgICAgICB0aHJvdyAnZGVwZW5kZW5jeVdvcmtlcnM6IGFscmVhZHkgdGVybWluYXRlZCc7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHRoaXMuX2lzVXNlckNhbGxlZFRlcm1pbmF0ZSA9IHRydWU7XHJcbiAgICAgICAgdGhpcy5fdGVybWluYXRlSW50ZXJuYWwoKTtcclxuICAgIH07XHJcbiAgICBcclxuICAgIERlcGVuZGVuY3lXb3JrZXJzVGFza0ludGVybmFscy5wcm90b3R5cGUuYWJvcnQgPSBmdW5jdGlvbiBhYm9ydChhYm9ydGVkQnlTY2hlZHVsZXIpIHtcclxuICAgICAgICBpZiAodGhpcy5faXNBYm9ydGVkKSB7XHJcbiAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgdGhpcy5faXNBYm9ydGVkID0gdHJ1ZTtcclxuICAgICAgICBpZiAodGhpcy5pc1Rlcm1pbmF0ZWQpIHtcclxuICAgICAgICAgICAgaWYgKCF0aGlzLmlzQWN0dWFsVGVybWluYXRpb25QZW5kaW5nICYmICF0aGlzLl9pc0Fib3J0ZWROb3RCeVNjaGVkdWxlcikge1xyXG4gICAgICAgICAgICAgICAgdGhyb3cgJ2RlcGVuZGVuY3lXb3JrZXJzOiBhYm9ydGVkIGFmdGVyIHRlcm1pbmF0aW9uJztcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH0gZWxzZSBpZiAoIWFib3J0ZWRCeVNjaGVkdWxlcikge1xyXG4gICAgICAgICAgICB0aGlzLl9pc0Fib3J0ZWROb3RCeVNjaGVkdWxlciA9IHRydWU7XHJcbiAgICAgICAgfSBlbHNlIGlmICh0aGlzLnBlbmRpbmdEYXRhRm9yV29ya2VyLmxlbmd0aCA9PT0gMCkge1xyXG4gICAgICAgICAgICB0aHJvdyAnZGVwZW5kZW5jeVdvcmtlcnM6IEFib3J0IHdpdGhvdXQgdGFzayB3YWl0aW5nIGZvciBzY2hlZHVsZSc7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgdGhpcy5faXNXYWl0aW5nRm9yV29ya2VyUmVzdWx0ID0gZmFsc2U7IC8vIG9ubHkgaWYgYWJvcnRlZCBieSBzY2hlZHVsZXJcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgdGhpcy5wZW5kaW5nRGF0YUZvcldvcmtlciA9IFtdO1xyXG4gICAgICAgIHRoaXMuY2FuU2tpcExhc3RQZW5kaW5nRGF0YUZvcldvcmtlciA9IGZhbHNlO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGlmICghdGhpcy5pc1Rlcm1pbmF0ZWQpIHtcclxuICAgICAgICAgICAgdGhpcy5jdXN0b21FdmVudCgnYWJvcnRpbmcnLCB0aGlzLnRhc2tLZXkpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICB0aGlzLl90ZXJtaW5hdGVJbnRlcm5hbCgpO1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KERlcGVuZGVuY3lXb3JrZXJzVGFza0ludGVybmFscy5wcm90b3R5cGUsICdkZXBlbmRUYXNrS2V5cycsIHtcclxuICAgICAgICBnZXQ6IGZ1bmN0aW9uIGdldERlcGVuZFRhc2tLZXlzKCkge1xyXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5fZGVwZW5kVGFza0tleXM7XHJcbiAgICAgICAgfVxyXG4gICAgfSk7XHJcbiAgICBcclxuICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShEZXBlbmRlbmN5V29ya2Vyc1Rhc2tJbnRlcm5hbHMucHJvdG90eXBlLCAnZGVwZW5kVGFza1Jlc3VsdHMnLCB7XHJcbiAgICAgICAgZ2V0OiBmdW5jdGlvbiBnZXREZXBlbmRUYXNrUmVzdWx0cygpIHtcclxuICAgICAgICAgICAgcmV0dXJuIHRoaXMuX2RlcGVuZFRhc2tSZXN1bHRzO1xyXG4gICAgICAgIH1cclxuICAgIH0pO1xyXG4gICAgXHJcbiAgICBEZXBlbmRlbmN5V29ya2Vyc1Rhc2tJbnRlcm5hbHMucHJvdG90eXBlLnJlZ2lzdGVyVGFza0RlcGVuZGVuY3kgPSBmdW5jdGlvbihcclxuICAgICAgICAgICAgdGFza0tleSkge1xyXG4gICAgICAgIFxyXG4gICAgICAgIHZhciBzdHJLZXkgPSB0aGlzLl93b3JrZXJJbnB1dFJldHJlaXZlci5nZXRLZXlBc1N0cmluZyh0YXNrS2V5KTtcclxuICAgICAgICB2YXIgYWRkUmVzdWx0ID0gdGhpcy5fZGVwZW5kc1Rhc2tDb250ZXh0cy50cnlBZGQoc3RyS2V5LCBmdW5jdGlvbigpIHtcclxuICAgICAgICAgICAgcmV0dXJuIHsgdGFza0NvbnRleHQ6IG51bGwgfTtcclxuICAgICAgICB9KTtcclxuICAgICAgICBcclxuICAgICAgICBpZiAoIWFkZFJlc3VsdC5pc05ldykge1xyXG4gICAgICAgICAgICB0aHJvdyAnZGVwZW5kZW5jeVdvcmtlcnM6IENhbm5vdCBhZGQgdGFzayBkZXBlbmRlbmN5IHR3aWNlJztcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgdmFyIHRoYXQgPSB0aGlzO1xyXG4gICAgICAgIHZhciBnb3REYXRhID0gZmFsc2U7XHJcbiAgICAgICAgdmFyIGlzRGVwZW5kc1Rhc2tUZXJtaW5hdGVkID0gZmFsc2U7XHJcbiAgICAgICAgdmFyIGluZGV4ID0gdGhpcy5fZGVwZW5kVGFza0tleXMubGVuZ3RoO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHRoaXMuX2RlcGVuZFRhc2tLZXlzW2luZGV4XSA9IHRhc2tLZXk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgYWRkUmVzdWx0LnZhbHVlLnRhc2tDb250ZXh0ID0gdGhpcy5fcGFyZW50RGVwZW5kZW5jeVdvcmtlcnMuc3RhcnRUYXNrKFxyXG4gICAgICAgICAgICB0YXNrS2V5LCB7XHJcbiAgICAgICAgICAgICAgICAnb25EYXRhJzogb25EZXBlbmRlbmN5VGFza0RhdGEsXHJcbiAgICAgICAgICAgICAgICAnb25UZXJtaW5hdGVkJzogb25EZXBlbmRlbmN5VGFza1Rlcm1pbmF0ZWQsXHJcbiAgICAgICAgICAgICAgICAnb25DdXN0b20nOiBvbkRlcGVuZGVuY3lUYXNrQ3VzdG9tLFxyXG4gICAgICAgICAgICAgICAgY2FsbGVlRm9yRGVidWc6IHRoaXNcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKCFhZGRSZXN1bHQudmFsdWUudGFza0NvbnRleHQuaXNBY3RpdmUpIHtcclxuICAgICAgICAgICAgdGhyb3cgJ2RlcGVuZGVuY3ktd29ya2VycyBlcnJvcjogZGVwZW5kYW50IHRhc2sgYWxyZWFkeSB0ZXJtaW5hdGVkJztcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gTWlnaHQgYmUgcmVtb3ZlZDogQ29kZSBmb3IgZGVidWcgd2hpY2ggcmVsaWVzIG9uIGludGVybmFsIG1lbWJlciB0YXNrQ29udGV4dC5fdGFza0ludGVybmFsc1xyXG4gICAgICAgIGlmIChhZGRSZXN1bHQudmFsdWUudGFza0NvbnRleHQuX3Rhc2tJbnRlcm5hbHMuX2lzQWJvcnRlZCkge1xyXG4gICAgICAgICAgICB0aHJvdyAnZGVwZW5kZW5jeVdvcmtlcnMgZXJyb3I6IGRlcGVuZGFudCB0YXNrIGFscmVhZHkgYWJvcnRlZCc7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIGlmICh0aGlzLl9pc1JlZ2lzdGVyZWREZXBlbmRQcmlvcml0eUNhbGN1bGF0b3IpIHtcclxuICAgICAgICAgICAgYWRkUmVzdWx0LnZhbHVlLnRhc2tDb250ZXh0LnNldFByaW9yaXR5Q2FsY3VsYXRvcih0aGlzLl9wcmlvcml0eUNhbGN1bGF0b3IpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBpZiAoZ290RGF0YSkge1xyXG4gICAgICAgICAgICB0aHJvdyAnZGVwZW5kZW5jeS13b3JrZXJzIGVycm9yOiBJbnRlcm5hbCBlcnJvcjogY2FsbGJhY2sgY2FsbGVkIGJlZm9yZSBkZXBlbmRlbmN5IHJlZ2lzdHJhdGlvbiBjb21wbGV0ZWQnO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICB2YXIgcHJvY2Vzc2VkRGF0YSA9IGFkZFJlc3VsdC52YWx1ZS50YXNrQ29udGV4dC5nZXRQcm9jZXNzZWREYXRhKCk7XHJcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBwcm9jZXNzZWREYXRhLmxlbmd0aDsgKytpKSB7XHJcbiAgICAgICAgICAgIHRoaXMuX3BlbmRpbmdEZWxheWVkRGVwZW5kZW5jeURhdGEucHVzaCh7XHJcbiAgICAgICAgICAgICAgICBkYXRhOiBwcm9jZXNzZWREYXRhW2ldLFxyXG4gICAgICAgICAgICAgICAgb25EZXBlbmRlbmN5VGFza0RhdGE6IG9uRGVwZW5kZW5jeVRhc2tEYXRhXHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBpZiAocHJvY2Vzc2VkRGF0YS5sZW5ndGggPiAwKSB7XHJcbiAgICAgICAgICAgIHRoaXMuX3NjaGVkdWxlUGVuZGluZ0RlbGF5ZWRBY3Rpb25zKCk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHJldHVybiBhZGRSZXN1bHQudmFsdWUudGFza0NvbnRleHQ7XHJcbiAgICAgICAgXHJcbiAgICAgICAgZnVuY3Rpb24gb25EZXBlbmRlbmN5VGFza0RhdGEoZGF0YSkge1xyXG4gICAgICAgICAgICBpZiAodGhhdC5fcGVuZGluZ0RlbGF5ZWREZXBlbmRlbmN5RGF0YS5sZW5ndGggPiAwKSB7XHJcbiAgICAgICAgICAgICAgICAvLyBBdm9pZCBieXBhc3Mgb2YgZGVsYXllZCBkYXRhIGJ5IG5ldyBkYXRhXHJcbiAgICAgICAgICAgICAgICB0aGF0Ll9wZW5kaW5nRGVsYXllZERlcGVuZGVuY3lEYXRhLnB1c2goe1xyXG4gICAgICAgICAgICAgICAgICAgIGRhdGE6IGRhdGEsXHJcbiAgICAgICAgICAgICAgICAgICAgb25EZXBlbmRlbmN5VGFza0RhdGE6IG9uRGVwZW5kZW5jeVRhc2tEYXRhXHJcbiAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgdGhhdC5fc2NoZWR1bGVQZW5kaW5nRGVsYXllZEFjdGlvbnMoKTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICB0aGF0Ll9kZXBlbmRUYXNrUmVzdWx0c1tpbmRleF0gPSBkYXRhO1xyXG4gICAgICAgICAgICB0aGF0Ll9oYXNEZXBlbmRUYXNrRGF0YVtpbmRleF0gPSB0cnVlO1xyXG4gICAgICAgICAgICB0aGF0LnRhc2tBcGkuX29uRXZlbnQoJ2RlcGVuZGVuY3lUYXNrRGF0YScsIGRhdGEsIHRhc2tLZXkpO1xyXG4gICAgICAgICAgICBnb3REYXRhID0gdHJ1ZTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgZnVuY3Rpb24gb25EZXBlbmRlbmN5VGFza0N1c3RvbShhcmcwLCBhcmcxKSB7XHJcbiAgICAgICAgICAgIHRoYXQudGFza0FwaS5fb25FdmVudCgnZGVwZW5kZW5jeVRhc2tDdXN0b20nLCBhcmcwLCBhcmcxKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgZnVuY3Rpb24gb25EZXBlbmRlbmN5VGFza1Rlcm1pbmF0ZWQoKSB7XHJcbiAgICAgICAgICAgIGlmIChpc0RlcGVuZHNUYXNrVGVybWluYXRlZCkge1xyXG4gICAgICAgICAgICAgICAgdGhyb3cgJ2RlcGVuZGVuY3lXb3JrZXJzOiBEb3VibGUgdGVybWluYXRpb24nO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGlzRGVwZW5kc1Rhc2tUZXJtaW5hdGVkID0gdHJ1ZTtcclxuICAgICAgICAgICAgdGhhdC5fZGVwZW5kc1Rhc2tUZXJtaW5hdGVkKCk7XHJcbiAgICAgICAgfVxyXG4gICAgfTtcclxuICAgIFxyXG4gICAgRGVwZW5kZW5jeVdvcmtlcnNUYXNrSW50ZXJuYWxzLnByb3RvdHlwZS5fdGVybWluYXRlSW50ZXJuYWwgPSBmdW5jdGlvbiB0ZXJtaW5hdGVJbnRlcm5hbCgpIHtcclxuICAgICAgICBpZiAodGhpcy5pc1Rlcm1pbmF0ZWQpIHtcclxuICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICB0aGlzLmRldGFjaEJlZm9yZVRlcm1pbmF0aW9uKCk7XHJcbiAgICAgICAgdGhpcy5pc1Rlcm1pbmF0ZWQgPSB0cnVlO1xyXG5cclxuICAgICAgICBpZiAodGhpcy5faXNXYWl0aW5nRm9yV29ya2VyUmVzdWx0KSB7XHJcbiAgICAgICAgICAgIHRoaXMuaXNBY3R1YWxUZXJtaW5hdGlvblBlbmRpbmcgPSB0cnVlO1xyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgIHRoaXMuZW5kZWQoKTtcclxuICAgICAgICB9XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBEZXBlbmRlbmN5V29ya2Vyc1Rhc2tJbnRlcm5hbHMucHJvdG90eXBlLl9yZWdpc3RlckRlcGVuZFByaW9yaXR5Q2FsY3VsYXRvciA9IGZ1bmN0aW9uIHJlZ2lzdGVyRGVwZW5kUHJpb3JpdHlDYWxjdWxhdG9yKCkge1xyXG4gICAgICAgIGlmICh0aGlzLl9pc1JlZ2lzdGVyZWREZXBlbmRQcmlvcml0eUNhbGN1bGF0b3IpIHtcclxuICAgICAgICAgICAgdGhyb3cgJ2RlcGVuZGVuY3lXb3JrZXJzOiBhbHJlYWR5IHJlZ2lzdGVyZWQgZGVwZW5kIHByaW9yaXR5IGNhbGN1bGF0b3InO1xyXG4gICAgICAgIH1cclxuICAgICAgICBpZiAodGhpcy5fcHJpb3JpdHlDYWxjdWxhdG9yID09PSBudWxsKSB7XHJcbiAgICAgICAgICAgIHZhciB0aGF0ID0gdGhpcztcclxuICAgICAgICAgICAgdGhpcy5fcHJpb3JpdHlDYWxjdWxhdG9yID0gZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gdGhhdC5jYWxjdWxhdGVQcmlvcml0eSgpO1xyXG4gICAgICAgICAgICB9O1xyXG4gICAgICAgIH1cclxuICAgICAgICB0aGlzLl9pc1JlZ2lzdGVyZWREZXBlbmRQcmlvcml0eUNhbGN1bGF0b3IgPSB0cnVlO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHZhciBpdGVyYXRvciA9IHRoaXMuX2RlcGVuZHNUYXNrQ29udGV4dHMuZ2V0Rmlyc3RJdGVyYXRvcigpO1xyXG4gICAgICAgIHdoaWxlIChpdGVyYXRvciAhPT0gbnVsbCkge1xyXG4gICAgICAgICAgICB2YXIgY29udGV4dCA9IHRoaXMuX2RlcGVuZHNUYXNrQ29udGV4dHMuZ2V0RnJvbUl0ZXJhdG9yKGl0ZXJhdG9yKS50YXNrQ29udGV4dDtcclxuICAgICAgICAgICAgaXRlcmF0b3IgPSB0aGlzLl9kZXBlbmRzVGFza0NvbnRleHRzLmdldE5leHRJdGVyYXRvcihpdGVyYXRvcik7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBjb250ZXh0LnNldFByaW9yaXR5Q2FsY3VsYXRvcih0aGlzLl9wcmlvcml0eUNhbGN1bGF0b3IpO1xyXG4gICAgICAgIH1cclxuICAgIH07XHJcbiAgICBcclxuICAgIERlcGVuZGVuY3lXb3JrZXJzVGFza0ludGVybmFscy5wcm90b3R5cGUuX3VucmVnaXN0ZXJEZXBlbmRQcmlvcml0eUNhbGN1bGF0b3IgPSBmdW5jdGlvbiB1bnJlZ2lzdGVyRGVwZW5kUHJpb3JpdHlDYWxjdWxhdG9yKCkge1xyXG4gICAgICAgIGlmICghdGhpcy5faXNSZWdpc3RlcmVkRGVwZW5kUHJpb3JpdHlDYWxjdWxhdG9yKSB7XHJcbiAgICAgICAgICAgIHRocm93ICdkZXBlbmRlbmN5V29ya2Vyczogbm90IHJlZ2lzdGVyZWQgZGVwZW5kIHByaW9yaXR5IGNhbGN1bGF0b3InO1xyXG4gICAgICAgIH1cclxuICAgICAgICB0aGlzLl9pc1JlZ2lzdGVyZWREZXBlbmRQcmlvcml0eUNhbGN1bGF0b3IgPSBmYWxzZTtcclxuICAgICAgICBcclxuICAgICAgICB2YXIgaXRlcmF0b3IgPSB0aGlzLl9kZXBlbmRzVGFza0NvbnRleHRzLmdldEZpcnN0SXRlcmF0b3IoKTtcclxuICAgICAgICB3aGlsZSAoaXRlcmF0b3IgIT09IG51bGwpIHtcclxuICAgICAgICAgICAgdmFyIGNvbnRleHQgPSB0aGlzLl9kZXBlbmRzVGFza0NvbnRleHRzLmdldEZyb21JdGVyYXRvcihpdGVyYXRvcikudGFza0NvbnRleHQ7XHJcbiAgICAgICAgICAgIGl0ZXJhdG9yID0gdGhpcy5fZGVwZW5kc1Rhc2tDb250ZXh0cy5nZXROZXh0SXRlcmF0b3IoaXRlcmF0b3IpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgY29udGV4dC5zZXRQcmlvcml0eUNhbGN1bGF0b3IobnVsbCk7XHJcbiAgICAgICAgfVxyXG4gICAgfTtcclxuXHJcbiAgICBEZXBlbmRlbmN5V29ya2Vyc1Rhc2tJbnRlcm5hbHMucHJvdG90eXBlLl9kZXBlbmRzVGFza1Rlcm1pbmF0ZWQgPSBmdW5jdGlvbiBkZXBlbmRzVGFza1Rlcm1pbmF0ZWQoKSB7XHJcbiAgICAgICAgKyt0aGlzLl9kZXBlbmRzVGFza3NUZXJtaW5hdGVkQ291bnQ7XHJcbiAgICAgICAgaWYgKHRoaXMuX2RlcGVuZHNUYXNrc1Rlcm1pbmF0ZWRDb3VudCA9PT0gdGhpcy5fZGVwZW5kc1Rhc2tDb250ZXh0cy5nZXRDb3VudCgpKSB7XHJcbiAgICAgICAgICAgIHRoaXMudGFza0FwaS5fb25FdmVudCgnYWxsRGVwZW5kVGFza3NUZXJtaW5hdGVkJyk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHRoaXMuc3RhdHVzVXBkYXRlKCk7XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBEZXBlbmRlbmN5V29ya2Vyc1Rhc2tJbnRlcm5hbHMucHJvdG90eXBlLl9zY2hlZHVsZVBlbmRpbmdEZWxheWVkQWN0aW9ucyA9IGZ1bmN0aW9uKCkge1xyXG4gICAgICAgIGlmICh0aGlzLl9wZW5kaW5nRGVsYXllZEFjdGlvbikge1xyXG4gICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHRoaXMuX3BlbmRpbmdEZWxheWVkQWN0aW9uID0gdHJ1ZTtcclxuICAgICAgICB2YXIgdGhhdCA9IHRoaXM7XHJcbiAgICAgICAgc2V0VGltZW91dChmdW5jdGlvbigpIHtcclxuICAgICAgICAgICAgdmFyIGl0ZXJhdG9yO1xyXG4gICAgICAgICAgICB2YXIgY29udGV4dDtcclxuICAgICAgICAgICAgdGhhdC5fcGVuZGluZ0RlbGF5ZWRBY3Rpb24gPSBmYWxzZTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGlmICh0aGF0Ll9wZW5kaW5nRGVsYXllZERlcGVuZGVuY3lEYXRhLmxlbmd0aCA+IDApIHtcclxuICAgICAgICAgICAgICAgIHZhciBsb2NhbExpc3RlbmVycyA9IHRoYXQuX3BlbmRpbmdEZWxheWVkRGVwZW5kZW5jeURhdGE7XHJcbiAgICAgICAgICAgICAgICB0aGF0Ll9wZW5kaW5nRGVsYXllZERlcGVuZGVuY3lEYXRhID0gW107XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgbG9jYWxMaXN0ZW5lcnMubGVuZ3RoOyArK2kpIHtcclxuICAgICAgICAgICAgICAgICAgICBsb2NhbExpc3RlbmVyc1tpXS5vbkRlcGVuZGVuY3lUYXNrRGF0YShsb2NhbExpc3RlbmVyc1tpXS5kYXRhKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgaWYgKHRoYXQuX3BlbmRpbmdEZWxheWVkTmV3RGF0YS5sZW5ndGggPiAwKSB7XHJcbiAgICAgICAgICAgICAgICB2YXIgbmV3RGF0YSA9IHRoYXQuX3BlbmRpbmdEZWxheWVkTmV3RGF0YTtcclxuICAgICAgICAgICAgICAgIHZhciBjYW5Ta2lwTGFzdCA9IHRoYXQuX3BlbmRpbmdEZWxheWVkQ2FuU2tpcExhc3ROZXdEYXRhO1xyXG4gICAgICAgICAgICAgICAgdGhhdC5fcGVuZGluZ0RlbGF5ZWROZXdEYXRhID0gW107XHJcbiAgICAgICAgICAgICAgICB0aGF0Ll9wZW5kaW5nRGVsYXllZENhblNraXBMYXN0TmV3RGF0YSA9IGZhbHNlO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICBpZiAodGhhdC5fY2FuU2tpcExhc3RQcm9jZXNzZWREYXRhKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhhdC5wcm9jZXNzZWREYXRhLnBvcCgpO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IG5ld0RhdGEubGVuZ3RoOyArK2kpIHtcclxuICAgICAgICAgICAgICAgICAgICB0aGF0LnByb2Nlc3NlZERhdGEucHVzaChuZXdEYXRhW2ldKTtcclxuICAgICAgICAgICAgICAgICAgICB0aGF0Ll9jYW5Ta2lwTGFzdFByb2Nlc3NlZERhdGEgPSBjYW5Ta2lwTGFzdCAmJiBpID09PSBuZXdEYXRhLmxlbmd0aCAtIDE7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhhdC5faXRlcmF0ZUNhbGxiYWNrcyhmdW5jdGlvbihjYWxsYmFja3MpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY2FsbGJhY2tzLm9uRGF0YShuZXdEYXRhW2ldLCB0aGF0LnRhc2tLZXkpO1xyXG4gICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBpZiAodGhhdC5fcGVuZGluZ1dvcmtlckRvbmUpIHtcclxuICAgICAgICAgICAgICAgIHRoYXQuX2lzV2FpdGluZ0ZvcldvcmtlclJlc3VsdCA9IGZhbHNlO1xyXG4gICAgICAgICAgICAgICAgdGhhdC5zdGF0dXNVcGRhdGUoKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgaWYgKHRoYXQuX3BlbmRpbmdEZWxheWVkRW5kZWQpIHtcclxuICAgICAgICAgICAgICAgIHRoYXQuX3BlbmRpbmdEZWxheWVkRW5kZWQgPSBmYWxzZTtcclxuICAgICAgICAgICAgICAgIHRoYXQuX2l0ZXJhdGVDYWxsYmFja3MoZnVuY3Rpb24oY2FsbGJhY2tzKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKGNhbGxiYWNrcy5vblRlcm1pbmF0ZWQpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY2FsbGJhY2tzLm9uVGVybWluYXRlZCh0aGF0Ll9pc0Fib3J0ZWQpO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICB0aGF0LnRhc2tDb250ZXh0cy5jbGVhcigpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfSk7XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBEZXBlbmRlbmN5V29ya2Vyc1Rhc2tJbnRlcm5hbHMucHJvdG90eXBlLl9pdGVyYXRlQ2FsbGJhY2tzID0gZnVuY3Rpb24ocGVyZm9ybSkge1xyXG4gICAgICAgIHZhciBpdGVyYXRvciA9IHRoaXMudGFza0NvbnRleHRzLmdldEZpcnN0SXRlcmF0b3IoKTtcclxuICAgICAgICB3aGlsZSAoaXRlcmF0b3IgIT09IG51bGwpIHtcclxuICAgICAgICAgICAgdmFyIGNvbnRleHQgPSB0aGlzLnRhc2tDb250ZXh0cy5nZXRGcm9tSXRlcmF0b3IoaXRlcmF0b3IpO1xyXG4gICAgICAgICAgICBpdGVyYXRvciA9IHRoaXMudGFza0NvbnRleHRzLmdldE5leHRJdGVyYXRvcihpdGVyYXRvcik7XHJcblxyXG4gICAgICAgICAgICBwZXJmb3JtKGNvbnRleHQuX2NhbGxiYWNrcyk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgIH07XHJcbiAgICBcclxuICAgIHJldHVybiBEZXBlbmRlbmN5V29ya2Vyc1Rhc2tJbnRlcm5hbHM7XHJcbn0pKCk7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IERlcGVuZGVuY3lXb3JrZXJzVGFza0ludGVybmFsczsiLCIndXNlIHN0cmljdCc7XHJcblxyXG52YXIgcHJpb3JpdGl6ZXIgPSB7XHJcbiAgICBnZXRQcmlvcml0eTogZnVuY3Rpb24odGFzaykge1xyXG4gICAgICAgIHJldHVybiB0YXNrLmNhbGN1bGF0ZVByaW9yaXR5KCk7XHJcbiAgICB9XHJcbn07XHJcblxyXG5mdW5jdGlvbiBjcmVhdGVEdW1teVJlc291cmNlKCkge1xyXG4gICAgcmV0dXJuIHt9O1xyXG59XHJcblxyXG5mdW5jdGlvbiBEZXBlbmRlbmN5V29ya2Vyc1Rhc2tTY2hlZHVsZXIoam9ic0xpbWl0LCBvcHRpb25zKSB7XHJcbiAgICByZXNvdXJjZVNjaGVkdWxlci5Qcmlvcml0eVNjaGVkdWxlci5jYWxsKHRoaXMsIGNyZWF0ZUR1bW15UmVzb3VyY2UsIGpvYnNMaW1pdCwgcHJpb3JpdGl6ZXIsIG9wdGlvbnMpO1xyXG59XHJcblxyXG5EZXBlbmRlbmN5V29ya2Vyc1Rhc2tTY2hlZHVsZXIucHJvdG90eXBlID0gT2JqZWN0LmNyZWF0ZShyZXNvdXJjZVNjaGVkdWxlci5Qcmlvcml0eVNjaGVkdWxlci5wcm90b3R5cGUpO1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBEZXBlbmRlbmN5V29ya2Vyc1Rhc2tTY2hlZHVsZXI7IiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxudmFyIERlcGVuZGVuY3lXb3JrZXJzVGFzayA9IChmdW5jdGlvbiBEZXBlbmRlbmN5V29ya2Vyc1Rhc2tDbG9zdXJlKCkge1xyXG4gICAgZnVuY3Rpb24gRGVwZW5kZW5jeVdvcmtlcnNUYXNrKHdyYXBwZWQsIGtleSwgcmVnaXN0ZXJXcmFwcGVkRXZlbnRzKSB7XHJcbiAgICAgICAgdGhpcy5fd3JhcHBlZCA9IHdyYXBwZWQ7XHJcbiAgICAgICAgd3JhcHBlZC5fX3dyYXBwaW5nVGFza0ZvckRlYnVnID0gdGhpcztcclxuICAgICAgICB0aGlzLl9rZXkgPSBrZXk7XHJcbiAgICAgICAgdGhpcy5fZXZlbnRMaXN0ZW5lcnMgPSB7XHJcbiAgICAgICAgICAgICdkZXBlbmRlbmN5VGFza0RhdGEnOiBbXSxcclxuICAgICAgICAgICAgJ3N0YXR1c1VwZGF0ZWQnOiBbXSxcclxuICAgICAgICAgICAgJ2FsbERlcGVuZFRhc2tzVGVybWluYXRlZCc6IFtdLFxyXG4gICAgICAgICAgICAnY3VzdG9tJzogW10sXHJcbiAgICAgICAgICAgICdkZXBlbmRlbmN5VGFza0N1c3RvbSc6IFtdXHJcbiAgICAgICAgfTtcclxuICAgICAgICBcclxuICAgICAgICBpZiAocmVnaXN0ZXJXcmFwcGVkRXZlbnRzKSB7XHJcbiAgICAgICAgICAgIGZvciAodmFyIGV2ZW50IGluIHRoaXMuX2V2ZW50TGlzdGVuZXJzKSB7XHJcbiAgICAgICAgICAgICAgICB0aGlzLl9yZWdpc3RlcldyYXBwZWRFdmVudChldmVudCk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICBcclxuICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShEZXBlbmRlbmN5V29ya2Vyc1Rhc2sucHJvdG90eXBlLCAnaXNUZXJtaW5hdGVkJywgeyBnZXQ6IGZ1bmN0aW9uKCkge1xyXG4gICAgICAgIHJldHVybiB0aGlzLl93cmFwcGVkLmlzVGVybWluYXRlZDtcclxuICAgIH0gfSk7XHJcbiAgICBcclxuICAgIERlcGVuZGVuY3lXb3JrZXJzVGFzay5wcm90b3R5cGUuZGF0YVJlYWR5ID0gZnVuY3Rpb24gZGF0YVJlYWR5KG5ld0RhdGFUb1Byb2Nlc3MsIHdvcmtlclR5cGUsIGNhblNraXApIHtcclxuICAgICAgICB0aGlzLl93cmFwcGVkLmRhdGFSZWFkeShuZXdEYXRhVG9Qcm9jZXNzLCB3b3JrZXJUeXBlLCBjYW5Ta2lwKTtcclxuICAgIH07XHJcbiAgICBcclxuICAgIERlcGVuZGVuY3lXb3JrZXJzVGFzay5wcm90b3R5cGUuZGV0YWNoQmVmb3JlVGVybWluYXRpb24gPSBmdW5jdGlvbiBkZXRhY2goKSB7XHJcbiAgICAgICAgdGhpcy5fd3JhcHBlZC5kZXRhY2hCZWZvcmVUZXJtaW5hdGlvbigpO1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgRGVwZW5kZW5jeVdvcmtlcnNUYXNrLnByb3RvdHlwZS50ZXJtaW5hdGUgPSBmdW5jdGlvbiB0ZXJtaW5hdGUoKSB7XHJcbiAgICAgICAgdGhpcy5fd3JhcHBlZC50ZXJtaW5hdGUoKTtcclxuICAgIH07XHJcbiAgICBcclxuICAgIERlcGVuZGVuY3lXb3JrZXJzVGFzay5wcm90b3R5cGUucmVnaXN0ZXJUYXNrRGVwZW5kZW5jeSA9IGZ1bmN0aW9uIHJlZ2lzdGVyVGFza0RlcGVuZGVuY3kodGFza0tleSkge1xyXG4gICAgICAgIHJldHVybiB0aGlzLl93cmFwcGVkLnJlZ2lzdGVyVGFza0RlcGVuZGVuY3kodGFza0tleSk7XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBEZXBlbmRlbmN5V29ya2Vyc1Rhc2sucHJvdG90eXBlLmNhbGN1bGF0ZVByaW9yaXR5ID0gZnVuY3Rpb24gY2FsY3VsYXRlUHJpb3JpdHkoKSB7XHJcbiAgICAgICAgcmV0dXJuIHRoaXMuX3dyYXBwZWQuY2FsY3VsYXRlUHJpb3JpdHkoKTtcclxuICAgIH07XHJcbiAgICBcclxuICAgIERlcGVuZGVuY3lXb3JrZXJzVGFzay5wcm90b3R5cGUuY3VzdG9tRXZlbnQgPSBmdW5jdGlvbiBjdXN0b21FdmVudChhcmcwLCBhcmcxKSB7XHJcbiAgICAgICAgcmV0dXJuIHRoaXMuX3dyYXBwZWQuY3VzdG9tRXZlbnQoYXJnMCwgYXJnMSk7XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBEZXBlbmRlbmN5V29ya2Vyc1Rhc2sucHJvdG90eXBlLm9uID0gZnVuY3Rpb24gb24oZXZlbnQsIGxpc3RlbmVyKSB7XHJcbiAgICAgICAgaWYgKCF0aGlzLl9ldmVudExpc3RlbmVyc1tldmVudF0pIHtcclxuICAgICAgICAgICAgdGhyb3cgJ2RlcGVuZGVuY3lXb3JrZXJzOiBUYXNrIGhhcyBubyBldmVudCAnICsgZXZlbnQ7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHRoaXMuX2V2ZW50TGlzdGVuZXJzW2V2ZW50XS5wdXNoKGxpc3RlbmVyKTtcclxuICAgIH07XHJcbiAgICBcclxuICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShEZXBlbmRlbmN5V29ya2Vyc1Rhc2sucHJvdG90eXBlLCAna2V5Jywge1xyXG4gICAgICAgIGdldDogZnVuY3Rpb24gZ2V0S2V5KCkge1xyXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5fa2V5O1xyXG4gICAgICAgIH1cclxuICAgIH0pO1xyXG4gICAgXHJcbiAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkoRGVwZW5kZW5jeVdvcmtlcnNUYXNrLnByb3RvdHlwZSwgJ2RlcGVuZFRhc2tLZXlzJywge1xyXG4gICAgICAgIGdldDogZnVuY3Rpb24gZ2V0RGVwZW5kVGFza0tleXMoKSB7XHJcbiAgICAgICAgICAgIHJldHVybiB0aGlzLl93cmFwcGVkLmRlcGVuZFRhc2tLZXlzO1xyXG4gICAgICAgIH1cclxuICAgIH0pO1xyXG4gICAgXHJcbiAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkoRGVwZW5kZW5jeVdvcmtlcnNUYXNrLnByb3RvdHlwZSwgJ2RlcGVuZFRhc2tSZXN1bHRzJywge1xyXG4gICAgICAgIGdldDogZnVuY3Rpb24gZ2V0RGVwZW5kVGFza1Jlc3VsdHMoKSB7XHJcbiAgICAgICAgICAgIHJldHVybiB0aGlzLl93cmFwcGVkLmRlcGVuZFRhc2tSZXN1bHRzO1xyXG4gICAgICAgIH1cclxuICAgIH0pO1xyXG4gICAgXHJcbiAgICBEZXBlbmRlbmN5V29ya2Vyc1Rhc2sucHJvdG90eXBlLl9vbkV2ZW50ID0gZnVuY3Rpb24gb25FdmVudChldmVudCwgYXJnMSwgYXJnMikge1xyXG4gICAgICAgIGlmIChldmVudCA9PSAnc3RhdHVzVXBkYXRlZCcpIHtcclxuICAgICAgICAgICAgYXJnMSA9IHRoaXMuX21vZGlmeVN0YXR1cyhhcmcxKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgdmFyIGxpc3RlbmVycyA9IHRoaXMuX2V2ZW50TGlzdGVuZXJzW2V2ZW50XTtcclxuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IGxpc3RlbmVycy5sZW5ndGg7ICsraSkge1xyXG4gICAgICAgICAgICBsaXN0ZW5lcnNbaV0uY2FsbCh0aGlzLCBhcmcxLCBhcmcyKTtcclxuICAgICAgICB9XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBEZXBlbmRlbmN5V29ya2Vyc1Rhc2sucHJvdG90eXBlLl9tb2RpZnlTdGF0dXMgPSBmdW5jdGlvbiBtb2RpZnlTdGF0dXMoc3RhdHVzKSB7XHJcbiAgICAgICAgcmV0dXJuIHN0YXR1cztcclxuICAgIH07XHJcbiAgICBcclxuICAgIERlcGVuZGVuY3lXb3JrZXJzVGFzay5wcm90b3R5cGUuX3JlZ2lzdGVyV3JhcHBlZEV2ZW50ID0gZnVuY3Rpb24gcmVnaXN0ZXJXcmFwcGVkRXZlbnQoZXZlbnQpIHtcclxuICAgICAgICB2YXIgdGhhdCA9IHRoaXM7XHJcbiAgICAgICAgdGhpcy5fd3JhcHBlZC5vbihldmVudCwgZnVuY3Rpb24oYXJnMSwgYXJnMikge1xyXG4gICAgICAgICAgICB0aGF0Ll9vbkV2ZW50KGV2ZW50LCBhcmcxLCBhcmcyKTtcclxuICAgICAgICB9KTtcclxuICAgIH07XHJcblxyXG4gICAgcmV0dXJuIERlcGVuZGVuY3lXb3JrZXJzVGFzaztcclxufSkoKTtcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gRGVwZW5kZW5jeVdvcmtlcnNUYXNrOyIsIid1c2Ugc3RyaWN0JztcclxuXHJcbi8qIGdsb2JhbCBjb25zb2xlOiBmYWxzZSAqL1xyXG4vKiBnbG9iYWwgUHJvbWlzZTogZmFsc2UgKi9cclxuXHJcbnZhciBKc0J1aWx0aW5IYXNoTWFwID0gcmVxdWlyZSgnanMtYnVpbHRpbi1oYXNoLW1hcCcpO1xyXG52YXIgRGVwZW5kZW5jeVdvcmtlcnNUYXNrSW50ZXJuYWxzID0gcmVxdWlyZSgnZGVwZW5kZW5jeS13b3JrZXJzLXRhc2staW50ZXJuYWxzJyk7XHJcbnZhciBEZXBlbmRlbmN5V29ya2Vyc1Rhc2tDb250ZXh0ID0gcmVxdWlyZSgnZGVwZW5kZW5jeS13b3JrZXJzLXRhc2stY29udGV4dCcpO1xyXG5cclxudmFyIERlcGVuZGVuY3lXb3JrZXJzID0gKGZ1bmN0aW9uIERlcGVuZGVuY3lXb3JrZXJzQ2xvc3VyZSgpIHtcclxuICAgIGZ1bmN0aW9uIERlcGVuZGVuY3lXb3JrZXJzKHdvcmtlcklucHV0UmV0cmVpdmVyKSB7XHJcbiAgICAgICAgdmFyIHRoYXQgPSB0aGlzO1xyXG4gICAgICAgIHRoYXQuX3dvcmtlcklucHV0UmV0cmVpdmVyID0gd29ya2VySW5wdXRSZXRyZWl2ZXI7XHJcbiAgICAgICAgdGhhdC5fdGFza0ludGVybmFsc3MgPSBuZXcgSnNCdWlsdGluSGFzaE1hcCgpO1xyXG4gICAgICAgIHRoYXQuX3dvcmtlclBvb2xCeVRhc2tUeXBlID0gW107XHJcbiAgICAgICAgdGhhdC5fdGFza09wdGlvbnNCeVRhc2tUeXBlID0gW107XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKCF3b3JrZXJJbnB1dFJldHJlaXZlci5nZXRXb3JrZXJUeXBlT3B0aW9ucykge1xyXG4gICAgICAgICAgICB0aHJvdyAnZGVwZW5kZW5jeVdvcmtlcnM6IE5vICcgK1xyXG4gICAgICAgICAgICAgICAgJ3dvcmtlcklucHV0UmV0cmVpdmVyLmdldFdvcmtlclR5cGVPcHRpb25zKCkgbWV0aG9kJztcclxuICAgICAgICB9XHJcbiAgICAgICAgaWYgKCF3b3JrZXJJbnB1dFJldHJlaXZlci5nZXRLZXlBc1N0cmluZykge1xyXG4gICAgICAgICAgICB0aHJvdyAnZGVwZW5kZW5jeVdvcmtlcnM6IE5vICcgK1xyXG4gICAgICAgICAgICAgICAgJ3dvcmtlcklucHV0UmV0cmVpdmVyLmdldEtleUFzU3RyaW5nKCkgbWV0aG9kJztcclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICBcclxuICAgIERlcGVuZGVuY3lXb3JrZXJzLnByb3RvdHlwZS5zdGFydFRhc2sgPSBmdW5jdGlvbiBzdGFydFRhc2soXHJcbiAgICAgICAgdGFza0tleSwgY2FsbGJhY2tzKSB7XHJcbiAgICAgICAgXHJcbiAgICAgICAgdmFyIGRlcGVuZGVuY3lXb3JrZXJzID0gdGhpcztcclxuICAgICAgICBcclxuICAgICAgICB2YXIgc3RyS2V5ID0gdGhpcy5fd29ya2VySW5wdXRSZXRyZWl2ZXIuZ2V0S2V5QXNTdHJpbmcodGFza0tleSk7XHJcbiAgICAgICAgdmFyIGFkZFJlc3VsdCA9IHRoaXMuX3Rhc2tJbnRlcm5hbHNzLnRyeUFkZChzdHJLZXksIGZ1bmN0aW9uKCkge1xyXG4gICAgICAgICAgICByZXR1cm4gbmV3IERlcGVuZGVuY3lXb3JrZXJzVGFza0ludGVybmFscygpO1xyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHZhciB0YXNrSW50ZXJuYWxzID0gYWRkUmVzdWx0LnZhbHVlO1xyXG4gICAgICAgIHZhciB0YXNrQ29udGV4dCA9IG5ldyBEZXBlbmRlbmN5V29ya2Vyc1Rhc2tDb250ZXh0KFxyXG4gICAgICAgICAgICB0YXNrSW50ZXJuYWxzLCBjYWxsYmFja3MpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGlmIChhZGRSZXN1bHQuaXNOZXcpIHtcclxuICAgICAgICAgICAgdGFza0ludGVybmFscy5pbml0aWFsaXplKFxyXG4gICAgICAgICAgICAgICAgdGFza0tleSxcclxuICAgICAgICAgICAgICAgIHRoaXMsXHJcbiAgICAgICAgICAgICAgICB0aGlzLl93b3JrZXJJbnB1dFJldHJlaXZlcixcclxuICAgICAgICAgICAgICAgIHRoaXMuX3Rhc2tJbnRlcm5hbHNzLFxyXG4gICAgICAgICAgICAgICAgYWRkUmVzdWx0Lml0ZXJhdG9yLFxyXG4gICAgICAgICAgICAgICAgdGhpcy5fd29ya2VySW5wdXRSZXRyZWl2ZXIpO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHRoaXMuX3dvcmtlcklucHV0UmV0cmVpdmVyLnRhc2tTdGFydGVkKHRhc2tJbnRlcm5hbHMudGFza0FwaSk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICByZXR1cm4gdGFza0NvbnRleHQ7XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBEZXBlbmRlbmN5V29ya2Vycy5wcm90b3R5cGUuc3RhcnRUYXNrUHJvbWlzZSA9XHJcbiAgICAgICAgICAgIGZ1bmN0aW9uIHN0YXJ0VGFza1Byb21pc2UodGFza0tleSkge1xyXG4gICAgICAgIFxyXG4gICAgICAgIHZhciB0aGF0ID0gdGhpcztcclxuICAgICAgICByZXR1cm4gbmV3IFByb21pc2UoZnVuY3Rpb24ocmVzb2x2ZSwgcmVqZWN0KSB7XHJcbiAgICAgICAgICAgIHZhciB0YXNrQ29udGV4dCA9IHRoYXQuc3RhcnRUYXNrKFxyXG4gICAgICAgICAgICAgICAgdGFza0tleSwgeyAnb25EYXRhJzogb25EYXRhLCAnb25UZXJtaW5hdGVkJzogb25UZXJtaW5hdGVkIH0pO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHZhciBwcm9jZXNzZWREYXRhID0gdGFza0NvbnRleHQuZ2V0UHJvY2Vzc2VkRGF0YSgpO1xyXG4gICAgICAgICAgICB2YXIgaGFzRGF0YSA9IHByb2Nlc3NlZERhdGEubGVuZ3RoID4gMDtcclxuICAgICAgICAgICAgdmFyIHJlc3VsdDtcclxuICAgICAgICAgICAgaWYgKGhhc0RhdGEpIHtcclxuICAgICAgICAgICAgICAgIHJlc3VsdCA9IHByb2Nlc3NlZERhdGFbcHJvY2Vzc2VkRGF0YS5sZW5ndGggLSAxXTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgZnVuY3Rpb24gb25EYXRhKGRhdGEpIHtcclxuICAgICAgICAgICAgICAgIGhhc0RhdGEgPSB0cnVlO1xyXG4gICAgICAgICAgICAgICAgcmVzdWx0ID0gZGF0YTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgZnVuY3Rpb24gb25UZXJtaW5hdGVkKGlzQWJvcnRlZCkge1xyXG4gICAgICAgICAgICAgICAgaWYgKGlzQWJvcnRlZCkge1xyXG4gICAgICAgICAgICAgICAgICAgIHJlamVjdCgnVGFzayBpcyBhYm9ydGVkJyk7XHJcbiAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKGhhc0RhdGEpIHtcclxuICAgICAgICAgICAgICAgICAgICByZXNvbHZlKHJlc3VsdCk7XHJcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgICAgIHJlamVjdCgnVGFzayB0ZXJtaW5hdGVkIGJ1dCBubyBkYXRhIHJldHVybmVkJyk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9KTtcclxuICAgIH07XHJcbiAgICBcclxuICAgIERlcGVuZGVuY3lXb3JrZXJzLnByb3RvdHlwZS50ZXJtaW5hdGVJbmFjdGl2ZVdvcmtlcnMgPSBmdW5jdGlvbigpIHtcclxuICAgICAgICBmb3IgKHZhciB0YXNrVHlwZSBpbiB0aGlzLl93b3JrZXJQb29sQnlUYXNrVHlwZSkge1xyXG4gICAgICAgICAgICB2YXIgd29ya2VyUG9vbCA9IHRoaXMuX3dvcmtlclBvb2xCeVRhc2tUeXBlW3Rhc2tUeXBlXTtcclxuICAgICAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCB3b3JrZXJQb29sLmxlbmd0aDsgKytpKSB7XHJcbiAgICAgICAgICAgICAgICB3b3JrZXJQb29sW2ldLnByb3h5LnRlcm1pbmF0ZSgpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIHdvcmtlclBvb2wubGVuZ3RoID0gMDtcclxuICAgICAgICB9XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBEZXBlbmRlbmN5V29ya2Vycy5wcm90b3R5cGUuX2RhdGFSZWFkeSA9IGZ1bmN0aW9uIGRhdGFSZWFkeShcclxuICAgICAgICAgICAgdGFza0ludGVybmFscywgZGF0YVRvUHJvY2Vzcywgd29ya2VyVHlwZSwgY2FuU2tpcCkge1xyXG4gICAgICAgIFxyXG4gICAgICAgIHZhciB0aGF0ID0gdGhpcztcclxuICAgICAgICB2YXIgd29ya2VyO1xyXG4gICAgICAgIHZhciB3b3JrZXJQb29sID0gdGhhdC5fd29ya2VyUG9vbEJ5VGFza1R5cGVbd29ya2VyVHlwZV07XHJcbiAgICAgICAgaWYgKCF3b3JrZXJQb29sKSB7XHJcbiAgICAgICAgICAgIHdvcmtlclBvb2wgPSBbXTtcclxuICAgICAgICAgICAgdGhhdC5fd29ya2VyUG9vbEJ5VGFza1R5cGVbd29ya2VyVHlwZV0gPSB3b3JrZXJQb29sO1xyXG4gICAgICAgIH1cclxuICAgICAgICBpZiAod29ya2VyUG9vbC5sZW5ndGggPiAwKSB7XHJcbiAgICAgICAgICAgIHdvcmtlciA9IHdvcmtlclBvb2wucG9wKCk7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgdmFyIHdvcmtlckFyZ3MgPSB0aGF0Ll93b3JrZXJJbnB1dFJldHJlaXZlci5nZXRXb3JrZXJUeXBlT3B0aW9ucyhcclxuICAgICAgICAgICAgICAgIHdvcmtlclR5cGUpO1xyXG5cclxuICAgICAgICAgICAgaWYgKCF3b3JrZXJBcmdzKSB7XHJcbiAgICAgICAgICAgICAgICB0YXNrSW50ZXJuYWxzLm5ld0RhdGEoZGF0YVRvUHJvY2Vzcyk7XHJcbiAgICAgICAgICAgICAgICB0YXNrSW50ZXJuYWxzLndvcmtlckRvbmUoKTtcclxuICAgICAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgd29ya2VyID0ge1xyXG4gICAgICAgICAgICAgICAgcHJveHk6IG5ldyBhc3luY1Byb3h5LkFzeW5jUHJveHlNYXN0ZXIoXHJcbiAgICAgICAgICAgICAgICAgICAgd29ya2VyQXJncy5zY3JpcHRzVG9JbXBvcnQsXHJcbiAgICAgICAgICAgICAgICAgICAgd29ya2VyQXJncy5jdG9yTmFtZSxcclxuICAgICAgICAgICAgICAgICAgICB3b3JrZXJBcmdzLmN0b3JBcmdzKSxcclxuICAgICAgICAgICAgICAgIHRyYW5zZmVyYWJsZXM6IHdvcmtlckFyZ3MudHJhbnNmZXJhYmxlcyxcclxuICAgICAgICAgICAgICAgIHBhdGhUb1RyYW5zZmVyYWJsZXNJblByb21pc2VSZXN1bHQ6IHdvcmtlckFyZ3MucGF0aFRvVHJhbnNmZXJhYmxlc0luUHJvbWlzZVJlc3VsdFxyXG4gICAgICAgICAgICB9O1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICB2YXIgYXJncyA9IFtkYXRhVG9Qcm9jZXNzLCB0YXNrSW50ZXJuYWxzLnRhc2tLZXldO1xyXG4gICAgICAgIHZhciBvcHRpb25zID0ge1xyXG4gICAgICAgICAgICAnaXNSZXR1cm5Qcm9taXNlJzogdHJ1ZSxcclxuICAgICAgICAgICAgJ3RyYW5zZmVyYWJsZXMnOiB3b3JrZXIudHJhbnNmZXJhYmxlcyxcclxuICAgICAgICAgICAgJ3BhdGhUb1RyYW5zZmVyYWJsZXNJblByb21pc2VSZXN1bHQnOiB3b3JrZXIucGF0aFRvVHJhbnNmZXJhYmxlc0luUHJvbWlzZVJlc3VsdFxyXG4gICAgICAgIH07XHJcblxyXG4gICAgICAgIHZhciBwcm9taXNlID0gd29ya2VyLnByb3h5LmNhbGxGdW5jdGlvbignc3RhcnQnLCBhcmdzLCBvcHRpb25zKTtcclxuICAgICAgICBwcm9taXNlXHJcbiAgICAgICAgICAgIC50aGVuKGZ1bmN0aW9uKHByb2Nlc3NlZERhdGEpIHtcclxuICAgICAgICAgICAgICAgIHRhc2tJbnRlcm5hbHMubmV3RGF0YShwcm9jZXNzZWREYXRhLCBjYW5Ta2lwKTtcclxuICAgICAgICAgICAgICAgIHJldHVybiBwcm9jZXNzZWREYXRhO1xyXG4gICAgICAgICAgICB9KS5jYXRjaChmdW5jdGlvbihlKSB7XHJcbiAgICAgICAgICAgICAgICBjb25zb2xlLmxvZygnRXJyb3IgaW4gRGVwZW5kZW5jeVdvcmtlcnNcXCcgd29ya2VyOiAnICsgZSk7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gZTtcclxuICAgICAgICAgICAgfSkudGhlbihmdW5jdGlvbihyZXN1bHQpIHtcclxuICAgICAgICAgICAgICAgIHdvcmtlclBvb2wucHVzaCh3b3JrZXIpO1xyXG4gICAgICAgICAgICAgICAgdGFza0ludGVybmFscy53b3JrZXJEb25lKCk7XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgRGVwZW5kZW5jeVdvcmtlcnMucHJvdG90eXBlLndhaXRGb3JTY2hlZHVsZSA9IGZ1bmN0aW9uIHdhaXRGb3JTY2hlZHVsZShzY2hlZHVsZU5vdGlmaWVyKSB7XHJcbiAgICAgICAgc2NoZWR1bGVOb3RpZmllci5zY2hlZHVsZSh7ICdqb2JEb25lJzogZnVuY3Rpb24oKSB7IH0gfSk7XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBEZXBlbmRlbmN5V29ya2Vycy5wcm90b3R5cGUuaW5pdGlhbGl6aW5nVGFzayA9IGZ1bmN0aW9uIGluaXRpYWxpemluZ1Rhc2sodGFza0FwaSkge1xyXG4gICAgICAgIC8vIERvIG5vdGhpbmcsIG92ZXJyaWRlbiBieSBpbmhlcml0b3JzXHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICByZXR1cm4gRGVwZW5kZW5jeVdvcmtlcnM7XHJcbn0pKCk7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IERlcGVuZGVuY3lXb3JrZXJzOyIsIid1c2Ugc3RyaWN0JztcclxuXHJcbnZhciBMaW5rZWRMaXN0ID0gcmVxdWlyZSgnbGlua2VkLWxpc3QnKTtcclxuXHJcbnZhciBIYXNoTWFwID0gKGZ1bmN0aW9uIEhhc2hNYXBDbG9zdXJlKCkge1xyXG5cclxuZnVuY3Rpb24gSGFzaE1hcChoYXNoZXIpIHtcclxuICAgIHZhciB0aGF0ID0gdGhpcztcclxuICAgIHRoYXQuX2hhc2hlciA9IGhhc2hlcjtcclxuICAgIHRoYXQuY2xlYXIoKTtcclxufVxyXG5cclxuSGFzaE1hcC5wcm90b3R5cGUuY2xlYXIgPSBmdW5jdGlvbiBjbGVhcigpIHtcclxuICAgIHRoaXMuX2xpc3RCeUtleSA9IFtdO1xyXG4gICAgdGhpcy5fbGlzdE9mTGlzdHMgPSBuZXcgTGlua2VkTGlzdCgpO1xyXG4gICAgdGhpcy5fY291bnQgPSAwO1xyXG59O1xyXG5cclxuSGFzaE1hcC5wcm90b3R5cGUuZ2V0RnJvbUtleSA9IGZ1bmN0aW9uIGdldEZyb21LZXkoa2V5KSB7XHJcbiAgICB2YXIgaGFzaENvZGUgPSB0aGlzLl9oYXNoZXJbJ2dldEhhc2hDb2RlJ10oa2V5KTtcclxuICAgIHZhciBoYXNoRWxlbWVudHMgPSB0aGlzLl9saXN0QnlLZXlbaGFzaENvZGVdO1xyXG4gICAgaWYgKCFoYXNoRWxlbWVudHMpIHtcclxuICAgICAgICByZXR1cm4gbnVsbDtcclxuICAgIH1cclxuICAgIHZhciBsaXN0ID0gaGFzaEVsZW1lbnRzLmxpc3Q7XHJcbiAgICBcclxuICAgIHZhciBpdGVyYXRvciA9IGxpc3QuZ2V0Rmlyc3RJdGVyYXRvcigpO1xyXG4gICAgd2hpbGUgKGl0ZXJhdG9yICE9PSBudWxsKSB7XHJcbiAgICAgICAgdmFyIGl0ZW0gPSBsaXN0LmdldEZyb21JdGVyYXRvcihpdGVyYXRvcik7XHJcbiAgICAgICAgaWYgKHRoaXMuX2hhc2hlclsnaXNFcXVhbCddKGl0ZW0ua2V5LCBrZXkpKSB7XHJcbiAgICAgICAgICAgIHJldHVybiBpdGVtLnZhbHVlO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBpdGVyYXRvciA9IGxpc3QuZ2V0TmV4dEl0ZXJhdG9yKGl0ZXJhdG9yKTtcclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4gbnVsbDtcclxufTtcclxuXHJcbkhhc2hNYXAucHJvdG90eXBlLmdldEZyb21JdGVyYXRvciA9IGZ1bmN0aW9uIGdldEZyb21JdGVyYXRvcihpdGVyYXRvcikge1xyXG4gICAgcmV0dXJuIGl0ZXJhdG9yLl9oYXNoRWxlbWVudHMubGlzdC5nZXRGcm9tSXRlcmF0b3IoaXRlcmF0b3IuX2ludGVybmFsSXRlcmF0b3IpLnZhbHVlO1xyXG59O1xyXG5cclxuSGFzaE1hcC5wcm90b3R5cGUudHJ5QWRkID0gZnVuY3Rpb24gdHJ5QWRkKGtleSwgY3JlYXRlVmFsdWUpIHtcclxuICAgIHZhciBoYXNoQ29kZSA9IHRoaXMuX2hhc2hlclsnZ2V0SGFzaENvZGUnXShrZXkpO1xyXG4gICAgdmFyIGhhc2hFbGVtZW50cyA9IHRoaXMuX2xpc3RCeUtleVtoYXNoQ29kZV07XHJcbiAgICBpZiAoIWhhc2hFbGVtZW50cykge1xyXG4gICAgICAgIGhhc2hFbGVtZW50cyA9IHtcclxuICAgICAgICAgICAgaGFzaENvZGU6IGhhc2hDb2RlLFxyXG4gICAgICAgICAgICBsaXN0OiBuZXcgTGlua2VkTGlzdCgpLFxyXG4gICAgICAgICAgICBsaXN0T2ZMaXN0c0l0ZXJhdG9yOiBudWxsXHJcbiAgICAgICAgfTtcclxuICAgICAgICBoYXNoRWxlbWVudHMubGlzdE9mTGlzdHNJdGVyYXRvciA9IHRoaXMuX2xpc3RPZkxpc3RzLmFkZChoYXNoRWxlbWVudHMpO1xyXG4gICAgICAgIHRoaXMuX2xpc3RCeUtleVtoYXNoQ29kZV0gPSBoYXNoRWxlbWVudHM7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHZhciBpdGVyYXRvciA9IHtcclxuICAgICAgICBfaGFzaEVsZW1lbnRzOiBoYXNoRWxlbWVudHMsXHJcbiAgICAgICAgX2ludGVybmFsSXRlcmF0b3I6IG51bGxcclxuICAgIH07XHJcbiAgICBcclxuICAgIGl0ZXJhdG9yLl9pbnRlcm5hbEl0ZXJhdG9yID0gaGFzaEVsZW1lbnRzLmxpc3QuZ2V0Rmlyc3RJdGVyYXRvcigpO1xyXG4gICAgd2hpbGUgKGl0ZXJhdG9yLl9pbnRlcm5hbEl0ZXJhdG9yICE9PSBudWxsKSB7XHJcbiAgICAgICAgdmFyIGl0ZW0gPSBoYXNoRWxlbWVudHMubGlzdC5nZXRGcm9tSXRlcmF0b3IoaXRlcmF0b3IuX2ludGVybmFsSXRlcmF0b3IpO1xyXG4gICAgICAgIGlmICh0aGlzLl9oYXNoZXJbJ2lzRXF1YWwnXShpdGVtLmtleSwga2V5KSkge1xyXG4gICAgICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgICAgICAgaXRlcmF0b3I6IGl0ZXJhdG9yLFxyXG4gICAgICAgICAgICAgICAgaXNOZXc6IGZhbHNlLFxyXG4gICAgICAgICAgICAgICAgdmFsdWU6IGl0ZW0udmFsdWVcclxuICAgICAgICAgICAgfTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgaXRlcmF0b3IuX2ludGVybmFsSXRlcmF0b3IgPSBoYXNoRWxlbWVudHMubGlzdC5nZXROZXh0SXRlcmF0b3IoaXRlcmF0b3IuX2ludGVybmFsSXRlcmF0b3IpO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICB2YXIgdmFsdWUgPSBjcmVhdGVWYWx1ZSgpO1xyXG4gICAgaXRlcmF0b3IuX2ludGVybmFsSXRlcmF0b3IgPSBoYXNoRWxlbWVudHMubGlzdC5hZGQoe1xyXG4gICAgICAgIGtleToga2V5LFxyXG4gICAgICAgIHZhbHVlOiB2YWx1ZVxyXG4gICAgfSk7XHJcbiAgICArK3RoaXMuX2NvdW50O1xyXG4gICAgXHJcbiAgICByZXR1cm4ge1xyXG4gICAgICAgIGl0ZXJhdG9yOiBpdGVyYXRvcixcclxuICAgICAgICBpc05ldzogdHJ1ZSxcclxuICAgICAgICB2YWx1ZTogdmFsdWVcclxuICAgIH07XHJcbn07XHJcblxyXG5IYXNoTWFwLnByb3RvdHlwZS5yZW1vdmUgPSBmdW5jdGlvbiByZW1vdmUoaXRlcmF0b3IpIHtcclxuICAgIHZhciBvbGRMaXN0Q291bnQgPSBpdGVyYXRvci5faGFzaEVsZW1lbnRzLmxpc3QuZ2V0Q291bnQoKTtcclxuICAgIGl0ZXJhdG9yLl9oYXNoRWxlbWVudHMubGlzdC5yZW1vdmUoaXRlcmF0b3IuX2ludGVybmFsSXRlcmF0b3IpO1xyXG4gICAgdmFyIG5ld0xpc3RDb3VudCA9IGl0ZXJhdG9yLl9oYXNoRWxlbWVudHMubGlzdC5nZXRDb3VudCgpO1xyXG4gICAgXHJcbiAgICB0aGlzLl9jb3VudCArPSAobmV3TGlzdENvdW50IC0gb2xkTGlzdENvdW50KTtcclxuICAgIGlmIChuZXdMaXN0Q291bnQgPT09IDApIHtcclxuICAgICAgICB0aGlzLl9saXN0T2ZMaXN0cy5yZW1vdmUoaXRlcmF0b3IuX2hhc2hFbGVtZW50cy5saXN0T2ZMaXN0c0l0ZXJhdG9yKTtcclxuICAgICAgICBkZWxldGUgdGhpcy5fbGlzdEJ5S2V5W2l0ZXJhdG9yLl9oYXNoRWxlbWVudHMuaGFzaENvZGVdO1xyXG4gICAgfVxyXG59O1xyXG5cclxuSGFzaE1hcC5wcm90b3R5cGUuZ2V0Q291bnQgPSBmdW5jdGlvbiBnZXRDb3VudCgpIHtcclxuICAgIHJldHVybiB0aGlzLl9jb3VudDtcclxufTtcclxuXHJcbkhhc2hNYXAucHJvdG90eXBlLmdldEZpcnN0SXRlcmF0b3IgPSBmdW5jdGlvbiBnZXRGaXJzdEl0ZXJhdG9yKCkge1xyXG4gICAgdmFyIGZpcnN0TGlzdEl0ZXJhdG9yID0gdGhpcy5fbGlzdE9mTGlzdHMuZ2V0Rmlyc3RJdGVyYXRvcigpO1xyXG4gICAgdmFyIGZpcnN0SGFzaEVsZW1lbnRzID0gbnVsbDtcclxuICAgIHZhciBmaXJzdEludGVybmFsSXRlcmF0b3IgPSBudWxsO1xyXG4gICAgaWYgKGZpcnN0TGlzdEl0ZXJhdG9yICE9PSBudWxsKSB7XHJcbiAgICAgICAgZmlyc3RIYXNoRWxlbWVudHMgPSB0aGlzLl9saXN0T2ZMaXN0cy5nZXRGcm9tSXRlcmF0b3IoZmlyc3RMaXN0SXRlcmF0b3IpO1xyXG4gICAgICAgIGZpcnN0SW50ZXJuYWxJdGVyYXRvciA9IGZpcnN0SGFzaEVsZW1lbnRzLmxpc3QuZ2V0Rmlyc3RJdGVyYXRvcigpO1xyXG4gICAgfVxyXG4gICAgaWYgKGZpcnN0SW50ZXJuYWxJdGVyYXRvciA9PT0gbnVsbCkge1xyXG4gICAgICAgIHJldHVybiBudWxsO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICByZXR1cm4ge1xyXG4gICAgICAgIF9oYXNoRWxlbWVudHM6IGZpcnN0SGFzaEVsZW1lbnRzLFxyXG4gICAgICAgIF9pbnRlcm5hbEl0ZXJhdG9yOiBmaXJzdEludGVybmFsSXRlcmF0b3JcclxuICAgIH07XHJcbn07XHJcblxyXG5IYXNoTWFwLnByb3RvdHlwZS5nZXROZXh0SXRlcmF0b3IgPSBmdW5jdGlvbiBnZXROZXh0SXRlcmF0b3IoaXRlcmF0b3IpIHtcclxuICAgIHZhciBuZXh0SXRlcmF0b3IgPSB7XHJcbiAgICAgICAgX2hhc2hFbGVtZW50czogaXRlcmF0b3IuX2hhc2hFbGVtZW50cyxcclxuICAgICAgICBfaW50ZXJuYWxJdGVyYXRvcjogaXRlcmF0b3IuX2hhc2hFbGVtZW50cy5saXN0LmdldE5leHRJdGVyYXRvcihcclxuICAgICAgICAgICAgaXRlcmF0b3IuX2ludGVybmFsSXRlcmF0b3IpXHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICB3aGlsZSAobmV4dEl0ZXJhdG9yLl9pbnRlcm5hbEl0ZXJhdG9yID09PSBudWxsKSB7XHJcbiAgICAgICAgdmFyIG5leHRMaXN0T2ZMaXN0c0l0ZXJhdG9yID0gdGhpcy5fbGlzdE9mTGlzdHMuZ2V0TmV4dEl0ZXJhdG9yKFxyXG4gICAgICAgICAgICBpdGVyYXRvci5faGFzaEVsZW1lbnRzLmxpc3RPZkxpc3RzSXRlcmF0b3IpO1xyXG4gICAgICAgIGlmIChuZXh0TGlzdE9mTGlzdHNJdGVyYXRvciA9PT0gbnVsbCkge1xyXG4gICAgICAgICAgICByZXR1cm4gbnVsbDtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgbmV4dEl0ZXJhdG9yLl9oYXNoRWxlbWVudHMgPSB0aGlzLl9saXN0T2ZMaXN0cy5nZXRGcm9tSXRlcmF0b3IoXHJcbiAgICAgICAgICAgIG5leHRMaXN0T2ZMaXN0c0l0ZXJhdG9yKTtcclxuICAgICAgICBuZXh0SXRlcmF0b3IuX2ludGVybmFsSXRlcmF0b3IgPVxyXG4gICAgICAgICAgICBuZXh0SXRlcmF0b3IuX2hhc2hFbGVtZW50cy5saXN0LmdldEZpcnN0SXRlcmF0b3IoKTtcclxuICAgIH1cclxuICAgIHJldHVybiBuZXh0SXRlcmF0b3I7XHJcbn07XHJcblxyXG5yZXR1cm4gSGFzaE1hcDtcclxufSkoKTtcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gSGFzaE1hcDsiLCIndXNlIHN0cmljdCc7XHJcblxyXG52YXIgSGFzaE1hcCA9IHJlcXVpcmUoJ2hhc2gtbWFwJyk7XHJcblxyXG52YXIgSnNCdWlsdGluSGFzaE1hcCA9IChmdW5jdGlvbiBIYXNoTWFwQ2xvc3VyZSgpIHtcclxuICAgIFxyXG4vLyBUaGlzIGNsYXNzIGV4cG9zZSBzYW1lIEFQSSBhcyBIYXNoTWFwIGJ1dCBub3QgcmVxdWlyaW5nIGdldEhhc2hDb2RlKCkgYW5kIGlzRXF1YWwoKSBmdW5jdGlvbnMuXHJcbi8vIFRoYXQgd2F5IGl0J3MgZWFzeSB0byBzd2l0Y2ggYmV0d2VlbiBpbXBsZW1lbnRhdGlvbnMuXHJcblxyXG52YXIgc2ltcGxlSGFzaGVyID0ge1xyXG4gICAgJ2dldEhhc2hDb2RlJzogZnVuY3Rpb24gZ2V0SGFzaENvZGUoa2V5KSB7XHJcbiAgICAgICAgcmV0dXJuIGtleTtcclxuICAgIH0sXHJcbiAgICBcclxuICAgICdpc0VxdWFsJzogZnVuY3Rpb24gaXNFcXVhbChrZXkxLCBrZXkyKSB7XHJcbiAgICAgICAgcmV0dXJuIGtleTEgPT09IGtleTI7XHJcbiAgICB9XHJcbn07XHJcblxyXG5mdW5jdGlvbiBKc0J1aWx0aW5IYXNoTWFwKCkge1xyXG4gICAgSGFzaE1hcC5jYWxsKHRoaXMsIC8qaGFzaGVyPSovc2ltcGxlSGFzaGVyKTtcclxufVxyXG5cclxuSnNCdWlsdGluSGFzaE1hcC5wcm90b3R5cGUgPSBPYmplY3QuY3JlYXRlKEhhc2hNYXAucHJvdG90eXBlKTtcclxuXHJcbnJldHVybiBKc0J1aWx0aW5IYXNoTWFwO1xyXG59KSgpO1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBKc0J1aWx0aW5IYXNoTWFwOyIsIid1c2Ugc3RyaWN0JztcclxuXHJcbnZhciBMaW5rZWRMaXN0ID0gKGZ1bmN0aW9uIExpbmtlZExpc3RDbG9zdXJlKCkge1xyXG5cclxuZnVuY3Rpb24gTGlua2VkTGlzdCgpIHtcclxuICAgIHRoaXMuY2xlYXIoKTtcclxufVxyXG5cclxuTGlua2VkTGlzdC5wcm90b3R5cGUuY2xlYXIgPSBmdW5jdGlvbiBjbGVhcigpIHtcclxuICAgIHRoaXMuX2ZpcnN0ID0geyBfcHJldjogbnVsbCwgX3BhcmVudDogdGhpcyB9O1xyXG4gICAgdGhpcy5fbGFzdCA9IHsgX25leHQ6IG51bGwsIF9wYXJlbnQ6IHRoaXMgfTtcclxuICAgIHRoaXMuX2NvdW50ID0gMDtcclxuICAgIFxyXG4gICAgdGhpcy5fbGFzdC5fcHJldiA9IHRoaXMuX2ZpcnN0O1xyXG4gICAgdGhpcy5fZmlyc3QuX25leHQgPSB0aGlzLl9sYXN0O1xyXG59O1xyXG5cclxuTGlua2VkTGlzdC5wcm90b3R5cGUuYWRkID0gZnVuY3Rpb24gYWRkKHZhbHVlLCBhZGRCZWZvcmUpIHtcclxuICAgIGlmIChhZGRCZWZvcmUgPT09IG51bGwgfHwgYWRkQmVmb3JlID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICBhZGRCZWZvcmUgPSB0aGlzLl9sYXN0O1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICB0aGlzLl92YWxpZGF0ZUl0ZXJhdG9yT2ZUaGlzKGFkZEJlZm9yZSk7XHJcbiAgICBcclxuICAgICsrdGhpcy5fY291bnQ7XHJcbiAgICBcclxuICAgIHZhciBuZXdOb2RlID0ge1xyXG4gICAgICAgIF92YWx1ZTogdmFsdWUsXHJcbiAgICAgICAgX25leHQ6IGFkZEJlZm9yZSxcclxuICAgICAgICBfcHJldjogYWRkQmVmb3JlLl9wcmV2LFxyXG4gICAgICAgIF9wYXJlbnQ6IHRoaXNcclxuICAgIH07XHJcbiAgICBcclxuICAgIG5ld05vZGUuX3ByZXYuX25leHQgPSBuZXdOb2RlO1xyXG4gICAgYWRkQmVmb3JlLl9wcmV2ID0gbmV3Tm9kZTtcclxuICAgIFxyXG4gICAgcmV0dXJuIG5ld05vZGU7XHJcbn07XHJcblxyXG5MaW5rZWRMaXN0LnByb3RvdHlwZS5yZW1vdmUgPSBmdW5jdGlvbiByZW1vdmUoaXRlcmF0b3IpIHtcclxuICAgIHRoaXMuX3ZhbGlkYXRlSXRlcmF0b3JPZlRoaXMoaXRlcmF0b3IpO1xyXG4gICAgXHJcbiAgICAtLXRoaXMuX2NvdW50O1xyXG4gICAgXHJcbiAgICBpdGVyYXRvci5fcHJldi5fbmV4dCA9IGl0ZXJhdG9yLl9uZXh0O1xyXG4gICAgaXRlcmF0b3IuX25leHQuX3ByZXYgPSBpdGVyYXRvci5fcHJldjtcclxuICAgIGl0ZXJhdG9yLl9wYXJlbnQgPSBudWxsO1xyXG59O1xyXG5cclxuTGlua2VkTGlzdC5wcm90b3R5cGUuZ2V0RnJvbUl0ZXJhdG9yID0gZnVuY3Rpb24gZ2V0RnJvbUl0ZXJhdG9yKGl0ZXJhdG9yKSB7XHJcbiAgICB0aGlzLl92YWxpZGF0ZUl0ZXJhdG9yT2ZUaGlzKGl0ZXJhdG9yKTtcclxuICAgIFxyXG4gICAgcmV0dXJuIGl0ZXJhdG9yLl92YWx1ZTtcclxufTtcclxuXHJcbkxpbmtlZExpc3QucHJvdG90eXBlLmdldEZpcnN0SXRlcmF0b3IgPSBmdW5jdGlvbiBnZXRGaXJzdEl0ZXJhdG9yKCkge1xyXG4gICAgdmFyIGl0ZXJhdG9yID0gdGhpcy5nZXROZXh0SXRlcmF0b3IodGhpcy5fZmlyc3QpO1xyXG4gICAgcmV0dXJuIGl0ZXJhdG9yO1xyXG59O1xyXG5cclxuTGlua2VkTGlzdC5wcm90b3R5cGUuZ2V0TGFzdEl0ZXJhdG9yID0gZnVuY3Rpb24gZ2V0Rmlyc3RJdGVyYXRvcigpIHtcclxuICAgIHZhciBpdGVyYXRvciA9IHRoaXMuZ2V0UHJldkl0ZXJhdG9yKHRoaXMuX2xhc3QpO1xyXG4gICAgcmV0dXJuIGl0ZXJhdG9yO1xyXG59O1xyXG5cclxuTGlua2VkTGlzdC5wcm90b3R5cGUuZ2V0TmV4dEl0ZXJhdG9yID0gZnVuY3Rpb24gZ2V0TmV4dEl0ZXJhdG9yKGl0ZXJhdG9yKSB7XHJcbiAgICB0aGlzLl92YWxpZGF0ZUl0ZXJhdG9yT2ZUaGlzKGl0ZXJhdG9yKTtcclxuXHJcbiAgICBpZiAoaXRlcmF0b3IuX25leHQgPT09IHRoaXMuX2xhc3QpIHtcclxuICAgICAgICByZXR1cm4gbnVsbDtcclxuICAgIH1cclxuICAgIFxyXG4gICAgcmV0dXJuIGl0ZXJhdG9yLl9uZXh0O1xyXG59O1xyXG5cclxuTGlua2VkTGlzdC5wcm90b3R5cGUuZ2V0UHJldkl0ZXJhdG9yID0gZnVuY3Rpb24gZ2V0UHJldkl0ZXJhdG9yKGl0ZXJhdG9yKSB7XHJcbiAgICB0aGlzLl92YWxpZGF0ZUl0ZXJhdG9yT2ZUaGlzKGl0ZXJhdG9yKTtcclxuXHJcbiAgICBpZiAoaXRlcmF0b3IuX3ByZXYgPT09IHRoaXMuX2ZpcnN0KSB7XHJcbiAgICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHJldHVybiBpdGVyYXRvci5fcHJldjtcclxufTtcclxuXHJcbkxpbmtlZExpc3QucHJvdG90eXBlLmdldENvdW50ID0gZnVuY3Rpb24gZ2V0Q291bnQoKSB7XHJcbiAgICByZXR1cm4gdGhpcy5fY291bnQ7XHJcbn07XHJcblxyXG5MaW5rZWRMaXN0LnByb3RvdHlwZS5fdmFsaWRhdGVJdGVyYXRvck9mVGhpcyA9XHJcbiAgICBmdW5jdGlvbiB2YWxpZGF0ZUl0ZXJhdG9yT2ZUaGlzKGl0ZXJhdG9yKSB7XHJcbiAgICBcclxuICAgIGlmIChpdGVyYXRvci5fcGFyZW50ICE9PSB0aGlzKSB7XHJcbiAgICAgICAgdGhyb3cgJ2l0ZXJhdG9yIG11c3QgYmUgb2YgdGhlIGN1cnJlbnQgTGlua2VkTGlzdCc7XHJcbiAgICB9XHJcbn07XHJcblxyXG5yZXR1cm4gTGlua2VkTGlzdDtcclxufSkoKTtcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gTGlua2VkTGlzdDsiLCIndXNlIHN0cmljdCc7XHJcblxyXG52YXIgRGVwZW5kZW5jeVdvcmtlcnMgPSByZXF1aXJlKCdkZXBlbmRlbmN5LXdvcmtlcnMnKTtcclxuXHJcbnZhciBTY2hlZHVsZXJEZXBlbmRlbmN5V29ya2VycyA9IChmdW5jdGlvbiBTY2hlZHVsZXJEZXBlbmRlbmN5V29ya2Vyc0Nsb3N1cmUoKSB7XHJcbiAgICBmdW5jdGlvbiBTY2hlZHVsZXJEZXBlbmRlbmN5V29ya2VycyhzY2hlZHVsZXIsIGlucHV0UmV0cmVpdmVyKSB7XHJcbiAgICAgICAgdmFyIHRoYXQgPSB0aGlzO1xyXG4gICAgICAgIERlcGVuZGVuY3lXb3JrZXJzLmNhbGwodGhpcywgaW5wdXRSZXRyZWl2ZXIpO1xyXG4gICAgICAgIHRoYXQuX3NjaGVkdWxlciA9IHNjaGVkdWxlcjtcclxuICAgICAgICB0aGF0Ll9pc0Rpc2FibGVXb3JrZXJDYWNoZSA9IFtdO1xyXG4gICAgICAgIHRoYXQuX2lucHV0UmV0cmVpdmVyID0gaW5wdXRSZXRyZWl2ZXI7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIFNjaGVkdWxlckRlcGVuZGVuY3lXb3JrZXJzLnByb3RvdHlwZSA9IE9iamVjdC5jcmVhdGUoRGVwZW5kZW5jeVdvcmtlcnMucHJvdG90eXBlKTtcclxuICAgIFxyXG4gICAgU2NoZWR1bGVyRGVwZW5kZW5jeVdvcmtlcnMucHJvdG90eXBlLmluaXRpYWxpemluZ1Rhc2sgPSBmdW5jdGlvbiBpbml0aWFsaXppbmdUYXNrKHRhc2tBcGksIHNjaGVkdWxlTm90aWZpZXIpIHtcclxuICAgICAgICB2YXIgdGhhdCA9IHRoaXM7XHJcbiAgICAgICAgdGFza0FwaS5vbignZGVwZW5kZW5jeVRhc2tDdXN0b20nLCBmdW5jdGlvbihjdXN0b21FdmVudE5hbWUsIGRlcGVuZGVuY3lUYXNrS2V5KSB7XHJcbiAgICAgICAgICAgIGlmIChjdXN0b21FdmVudE5hbWUgIT09ICdhYm9ydGluZycpIHtcclxuICAgICAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgaWYgKCF0aGF0Ll9zY2hlZHVsZXIuc2hvdWxkQWJvcnQoc2NoZWR1bGVOb3RpZmllcikpIHtcclxuICAgICAgICAgICAgICAgIHRocm93ICdUYXNrICcgKyBkZXBlbmRlbmN5VGFza0tleSArICcgYWJvcnRlZCBidXQgYSB0YXNrIGRlcGVuZHMgJyArXHJcbiAgICAgICAgICAgICAgICAgICAgJ29uIGl0IGRpZG5cXCd0LiBDaGVjayBzY2hlZHVsZXIgY29uc2lzdGVuY3knO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBzY2hlZHVsZU5vdGlmaWVyLmFib3J0KC8qYWJvcnRCeVNjaGVkdWxlcj0qL2ZhbHNlKTtcclxuICAgICAgICB9KTtcclxuICAgIH07XHJcblxyXG4gICAgU2NoZWR1bGVyRGVwZW5kZW5jeVdvcmtlcnMucHJvdG90eXBlLndhaXRGb3JTY2hlZHVsZSA9IGZ1bmN0aW9uIHdhaXRGb3JTY2hlZHVsZShzY2hlZHVsZU5vdGlmaWVyLCB3b3JrZXJUeXBlKSB7XHJcbiAgICAgICAgaWYgKHRoaXMuX2lzRGlzYWJsZVdvcmtlckNhY2hlW3dvcmtlclR5cGVdID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICAgICAgdGhpcy5faXNEaXNhYmxlV29ya2VyQ2FjaGVbd29ya2VyVHlwZV0gPSB0aGlzLl9pbnB1dFJldHJlaXZlci5nZXRXb3JrZXJUeXBlT3B0aW9ucyh3b3JrZXJUeXBlKSA9PT0gbnVsbDtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKHRoaXMuX2lzRGlzYWJsZVdvcmtlckNhY2hlW3dvcmtlclR5cGVdKSB7XHJcbiAgICAgICAgICAgIERlcGVuZGVuY3lXb3JrZXJzLnByb3RvdHlwZS53YWl0Rm9yU2NoZWR1bGUuY2FsbCh0aGlzLCBzY2hlZHVsZU5vdGlmaWVyKTtcclxuICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgdmFyIGlzRmluaXNoZWQgPSBmYWxzZTtcclxuICAgICAgICB2YXIgam9iQ2FsbGJhY2tzID0gbnVsbDtcclxuICAgICAgICB2YXIgdGhhdCA9IHRoaXM7XHJcblxyXG4gICAgICAgIHRoaXMuX3NjaGVkdWxlci5lbnF1ZXVlSm9iKFxyXG4gICAgICAgICAgICBmdW5jdGlvbiBvblNjaGVkdWxlZChyZXNvdXJjZSwgam9iQ29udGV4dCwgam9iQ2FsbGJhY2tzXykge1xyXG4gICAgICAgICAgICAgICAgaWYgKGpvYkNvbnRleHQgIT09IHNjaGVkdWxlTm90aWZpZXIpIHtcclxuICAgICAgICAgICAgICAgICAgICB0aHJvdyAnZGVwZW5kZW5jeVdvcmtlcnM6IFdyb25nIGpvYkNvbnRleHQgLSBzZWVtcyBpbnRlcm5hbCBlcnJvciBpbiByZXNvdXJjZS1zY2hlZHVsZXIuanMnO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICBpZiAoaXNGaW5pc2hlZCkge1xyXG4gICAgICAgICAgICAgICAgICAgIHRocm93ICdkZXBlbmRlbmN5V29ya2Vyczogc2NoZWR1bGVkIGFmdGVyIGZpbmlzaCc7XHJcbiAgICAgICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICAgICAgaWYgKGpvYkNhbGxiYWNrcyAhPT0gbnVsbCkge1xyXG4gICAgICAgICAgICAgICAgICAgIHRocm93ICdkZXBlbmRlbmN5V29ya2VyczogU2NoZWR1bGVkIHR3aWNlJztcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgam9iQ2FsbGJhY2tzID0gam9iQ2FsbGJhY2tzXztcclxuICAgICAgICAgICAgICAgIHNjaGVkdWxlTm90aWZpZXIuc2NoZWR1bGUoam9iQ2FsbGJhY2tzKTtcclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgLypqb2JDb250ZXh0PSovc2NoZWR1bGVOb3RpZmllcixcclxuICAgICAgICAgICAgZnVuY3Rpb24gb25BYm9ydGVkKCkge1xyXG4gICAgICAgICAgICAgICAgaWYgKGlzRmluaXNoZWQpIHtcclxuICAgICAgICAgICAgICAgICAgICB0aHJvdyAnZGVwZW5kZW5jeVdvcmtlcnM6IGFib3J0IGFmdGVyIGZpbmlzaCc7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIGlmIChqb2JDYWxsYmFja3MgIT09IG51bGwpIHtcclxuICAgICAgICAgICAgICAgICAgICB0aHJvdyAnZGVwZW5kZW5jeVdvcmtlcnM6IGFib3J0IGFmdGVyIHNjaGVkdWxlZCc7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIGpvYkNhbGxiYWNrcyA9IG51bGw7XHJcbiAgICAgICAgICAgICAgICBpc0ZpbmlzaGVkID0gdHJ1ZTtcclxuICAgICAgICAgICAgICAgIHNjaGVkdWxlTm90aWZpZXIuYWJvcnQoLyphYm9ydEJ5U2NoZWR1bGVyPSovdHJ1ZSk7XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgcmV0dXJuIFNjaGVkdWxlckRlcGVuZGVuY3lXb3JrZXJzO1xyXG59KSgpO1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBTY2hlZHVsZXJEZXBlbmRlbmN5V29ya2VyczsiLCIndXNlIHN0cmljdCc7XHJcblxyXG52YXIgV3JhcHBlcklucHV0UmV0cmVpdmVyQmFzZSA9IChmdW5jdGlvbiBXcmFwcGVySW5wdXRSZXRyZWl2ZXJCYXNlQ2xvc3VyZSgpIHtcclxuICAgIGZ1bmN0aW9uIFdyYXBwZXJJbnB1dFJldHJlaXZlckJhc2UoaW5wdXRSZXRyZWl2ZXIpIHtcclxuICAgICAgICBpZiAoIWlucHV0UmV0cmVpdmVyLmdldEtleUFzU3RyaW5nKSB7XHJcbiAgICAgICAgICAgIHRocm93ICdkZXBlbmRlbmN5V29ya2VyczogTm8gJyArXHJcbiAgICAgICAgICAgICAgICAnaW5wdXRSZXRyZWl2ZXIuZ2V0S2V5QXNTdHJpbmcoKSBtZXRob2QnO1xyXG4gICAgICAgIH1cclxuICAgICAgICBpZiAoIWlucHV0UmV0cmVpdmVyLmdldFdvcmtlclR5cGVPcHRpb25zKSB7XHJcbiAgICAgICAgICAgIHRocm93ICdkZXBlbmRlbmN5V29ya2VyczogTm8gJyArXHJcbiAgICAgICAgICAgICAgICAnaW5wdXRSZXRyZWl2ZXIuZ2V0VGFza1R5cGVPcHRpb25zKCkgbWV0aG9kJztcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIHZhciB0aGF0ID0gdGhpcztcclxuICAgICAgICB0aGF0Ll9pbnB1dFJldHJlaXZlciA9IGlucHV0UmV0cmVpdmVyO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBXcmFwcGVySW5wdXRSZXRyZWl2ZXJCYXNlLnByb3RvdHlwZS50YXNrU3RhcnRlZCA9XHJcbiAgICAgICAgICAgIGZ1bmN0aW9uIHRhc2tTdGFydGVkKHRhc2spIHtcclxuICAgICAgICBcclxuICAgICAgICB0aHJvdyAnZGVwZW5kZW5jeVdvcmtlcnM6IE5vdCBpbXBsZW1lbnRlZCB0YXNrU3RhcnRlZCgpJztcclxuICAgIH07XHJcbiAgICBcclxuICAgIFdyYXBwZXJJbnB1dFJldHJlaXZlckJhc2UucHJvdG90eXBlLmdldEtleUFzU3RyaW5nID0gZnVuY3Rpb24oa2V5KSB7XHJcbiAgICAgICAgcmV0dXJuIHRoaXMuX2lucHV0UmV0cmVpdmVyLmdldEtleUFzU3RyaW5nKGtleSk7XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBcclxuICAgIFdyYXBwZXJJbnB1dFJldHJlaXZlckJhc2UucHJvdG90eXBlLmdldFdvcmtlclR5cGVPcHRpb25zID0gZnVuY3Rpb24odGFza1R5cGUpIHtcclxuICAgICAgICByZXR1cm4gdGhpcy5faW5wdXRSZXRyZWl2ZXIuZ2V0V29ya2VyVHlwZU9wdGlvbnModGFza1R5cGUpO1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgcmV0dXJuIFdyYXBwZXJJbnB1dFJldHJlaXZlckJhc2U7XHJcbn0pKCk7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IFdyYXBwZXJJbnB1dFJldHJlaXZlckJhc2U7Il19

(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.imageDecoderFramework = f()}})(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
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
},{}],2:[function(require,module,exports){
'use strict';

module.exports = calculateFrustum;

/* global Cesium: false */

var imageHelperFunctions = require('image-helper-functions.js');

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
},{"image-helper-functions.js":13}],3:[function(require,module,exports){
'use strict';

module.exports = CesiumImageDecoderLayerManager;

var CanvasImageryProvider = require('canvas-imagery-provider.js');
var ImageViewer = require('image-decoder-viewer.js');
var calculateCesiumFrustum = require('cesium-frustum-calculator.js');

/* global Cesium: false */

function CesiumImageDecoderLayerManager(imageDecoder, options) {
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
    
    this._imageViewer = new ImageViewer(
        imageDecoder,
        this._canvasUpdatedCallbackBound,
        this._options);
    
    this._imageViewer.setTargetCanvas(this._targetCanvas);
    
    this._updateFrustumBound = this._updateFrustum.bind(this);
    this._postRenderBound = this._postRender.bind(this);
}

CesiumImageDecoderLayerManager.prototype.setExceptionCallback = function setExceptionCallback(exceptionCallback) {
    this._imageViewer.setExceptionCallback(exceptionCallback);
};

CesiumImageDecoderLayerManager.prototype.open = function open(widgetOrViewer) {
    this._widget = widgetOrViewer;
    this._layers = widgetOrViewer.scene.imageryLayers;
    widgetOrViewer.scene.postRender.addEventListener(this._postRenderBound);
    
    this._imageViewer.open(this._url);
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
    this._imageViewer.close();
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
        this._imageViewer.updateViewArea(frustum);
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
},{"canvas-imagery-provider.js":1,"cesium-frustum-calculator.js":2,"image-decoder-viewer.js":15}],4:[function(require,module,exports){
'use strict';

module.exports = ImageDecoderImageryProvider;

var calculateCesiumFrustum = require('cesium-frustum-calculator.js');
var imageHelperFunctions = require('image-helper-functions.js');

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
function ImageDecoderImageryProvider(imageDecoder, options) {
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
    
    this._imageDecoder = imageDecoder;
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
    
    this._imageDecoder.open(this._url)
        .then(this._opened.bind(this))
        .catch(this._onException.bind(this));
    
    this._cesiumWidget = widgetOrViewer;
    
    this._updateFrustumIntervalHandle = setInterval(
        this._setPriorityByFrustum.bind(this),
        this._updateFrustumInterval);
};

ImageDecoderImageryProvider.prototype.close = function close() {
    clearInterval(this._updateFrustumIntervalHandle);
    this._imageDecoder.close();
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
    
    var alignedParams = imageHelperFunctions.alignParamsToTilesAndLevel({
        minX: minX,
        minY: minY,
        maxXExclusive: maxXExclusive,
        maxYExclusive: maxYExclusive,
        screenWidth: this._tileWidth,
        screenHeight: this._tileHeight
    }, this._imageDecoder);
    
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
        
        self._imageDecoder.requestPixelsProgressive(
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

    this._imageDecoder.setFetchPrioritizerData(frustumData);
    this._imageDecoder.setDecodePrioritizerData(frustumData);
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
        throw 'imageDecoderImageryProvider error: opened() was called more than once!';
    }
    
    this._ready = true;

    // This is wrong if COD or COC exists besides main header COD
    this._numResolutionLevels = this._imageDecoder.getNumResolutionLevelsForLimittedViewer();
    this._quality = this._imageDecoder.getHighestQuality();
    var maximumCesiumLevel = this._numResolutionLevels - 1;
        
    this._tileWidth = this._imageDecoder.getTileWidth();
    this._tileHeight = this._imageDecoder.getTileHeight();
        
    var bestLevelWidth  = this._imageDecoder.getImageWidth ();
    var bestLevelHeight = this._imageDecoder.getImageHeight();
    
    var lowestLevelTilesX = Math.ceil(bestLevelWidth  / this._tileWidth ) >> maximumCesiumLevel;
    var lowestLevelTilesY = Math.ceil(bestLevelHeight / this._tileHeight) >> maximumCesiumLevel;

    imageHelperFunctions.fixBounds(
        this._rectangle,
        this._imageDecoder,
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
},{"cesium-frustum-calculator.js":2,"image-helper-functions.js":13}],5:[function(require,module,exports){
'use strict';

var ImageDecoder = require('image-decoder.js');
var WorkerProxyImageDecoder = require('worker-proxy-image-decoder.js');
var imageHelperFunctions = require('image-helper-functions.js');

module.exports.ImageDecoder = ImageDecoder;
module.exports.WorkerProxyImageDecoder = WorkerProxyImageDecoder
module.exports.ImageDecoderViewer = require('image-decoder-viewer.js');

module.exports.SimpleFetcherBase = require('simple-fetcher-base.js');
module.exports.GridImageBase = require('grid-image-base.js');
module.exports.GridFetcherBase = require('grid-fetcher-base.js');
module.exports.GridDecoderWorkerBase = require('grid-decoder-worker-base.js');
module.exports.GridLevelCalculator = require('grid-level-calculator.js');

module.exports.CesiumImageDecoderLayerManager = require('cesium-image-decoder-layer-manager.js');
module.exports.ImageDecoderImageryProvider = require('image-decoder-imagery-provider.js');
module.exports.ImageDecoderRegionLayer = require('image-decoder-region-layer.js');
},{"cesium-image-decoder-layer-manager.js":3,"grid-decoder-worker-base.js":22,"grid-fetcher-base.js":23,"grid-image-base.js":24,"grid-level-calculator.js":25,"image-decoder-imagery-provider.js":4,"image-decoder-region-layer.js":20,"image-decoder-viewer.js":15,"image-decoder.js":19,"image-helper-functions.js":13,"simple-fetcher-base.js":26,"worker-proxy-image-decoder.js":18}],6:[function(require,module,exports){
'use strict';

module.exports = DecodeJob;

var LinkedList = require('linked-list.js');

var requestIdCounter = 0;

function DecodeJob(listenerHandle, imagePartParams) {
    this._progressiveStagesDone = 0;
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
    ++this._progressiveStagesDone;

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
        throw 'imageDecoderFramework error: Inconsistent number of done requests';
    }
    
    var isListenerDone = remaining === 0;
    if (isListenerDone) {
        this._listenerHandle.isTerminatedCallbackCalled = true;
        this._listenerHandle.terminatedCallback(
            this._listenerHandle.isAnyDecoderAborted);
    }
};

Object.defineProperty(DecodeJob.prototype, 'imagePartParams', {
    get: function getImagePartParams() {
        return this._imagePartParams;
    }
});

Object.defineProperty(DecodeJob.prototype, 'progressiveStagesDone', {
    get: function getProgressiveStagesDone() {
        return this._progressiveStagesDone;
    }
});
},{"linked-list.js":14}],7:[function(require,module,exports){
'use strict';

module.exports = DecodeJobsPool;

var DecodeJob = require('decode-job.js');

function DecodeJobsPool(
    decodeDependencyWorkers,
    prioritizer,
    tileWidth,
    tileHeight) {
    
    this._prioritizer = prioritizer;
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
        throw 'imageDecoderFramework error: imagePartParams for decoders is not aligned to ' +
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
        taskContexts: []
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

            this._startNewTask(listenerHandle, singleTileImagePartParams);
            
        }
    }
    
    if (!listenerHandle.isTerminatedCallbackCalled &&
        listenerHandle.remainingDecodeJobs === 0) {
        
        listenerHandle.isTerminatedCallbackCalled = true;
        listenerHandle.terminatedCallback(listenerHandle.isAnyDecoderAborted);
    }
    
    return listenerHandle;
};

DecodeJobsPool.prototype._startNewTask = function startNewTask(listenerHandle, imagePartParams) {
    var decodeJob = new DecodeJob(listenerHandle, imagePartParams);
    var taskContext = this._decodeDependencyWorkers.startTask(imagePartParams, decodeJob);
    listenerHandle.taskContexts.push(taskContext);
    
    if (this._prioritizer === null) {
        return;
    }
    
    var self = this;
    
    taskContext.setPriorityCalculator(function() {
        return self._prioritizer.getPriority(decodeJob);
    });
};

DecodeJobsPool.prototype.unregisterForkedJobs = function unregisterForkedJobs(
    listenerHandle) {
            
    if (listenerHandle.remainingDecodeJobs === 0) {
        // All jobs has already been terminated, no need to unregister
        return;
    }
    
    for (var i = 0; i < listenerHandle.taskContexts.length; ++i) {
        listenerHandle.taskContexts[i].unregister();
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
},{"decode-job.js":6}],8:[function(require,module,exports){
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
},{}],9:[function(require,module,exports){
'use strict';

var FetchContextApi = require('fetch-context-api.js');

module.exports = FetchContext;

FetchContext.FETCH_TYPE_REQUEST = 1;
FetchContext.FETCH_TYPE_MOVABLE = 2; // movable
FetchContext.FETCH_TYPE_ONLY_WAIT_FOR_DATA = 3;

FetchContext.FETCH_STATUS_WAIT_FOR_FETCH_CALL = 1;
FetchContext.FETCH_STATUS_MOVABLE_WAIT_FOR_MOVE_CALL = 2;
FetchContext.FETCH_STATUS_REQUEST_WAIT_FOR_SCHEDULE = 3;
FetchContext.FETCH_STATUS_ACTIVE = 4;
FetchContext.FETCH_STATUS_REQUEST_ABOUT_TO_YIELD = 5;
FetchContext.FETCH_STATUS_REQUEST_YIELDED = 6;
FetchContext.FETCH_STATUS_REQUEST_ABOUT_TO_ABORT = 7;
FetchContext.FETCH_STATUS_REQUEST_TERMINATED = 8;
FetchContext.FETCH_STATUS_UNEXPECTED_FAILURE = 9;

function FetchContext(fetcher, fetcherCloser, scheduler, scheduledJobsList, fetchType, contextVars) {
    this._fetcher = fetcher;
    this._fetcherCloser = fetcherCloser;
    this._scheduler = scheduler;
    this._scheduledJobsList = scheduledJobsList;
    this._scheduledJobsListIterator = null;
    
    this._terminatedListeners = [];
    
    this._imagePartParams = null;
    
    this._state = FetchContext.FETCH_STATUS_WAIT_FOR_FETCH_CALL;
    this._isMovable = fetchType === FetchContext.FETCH_TYPE_MOVABLE;
    this._contextVars = contextVars;
    this._isOnlyWaitForData = fetchType === FetchContext.FETCH_TYPE_ONLY_WAIT_FOR_DATA;
    this._useScheduler = fetchType === FetchContext.FETCH_TYPE_REQUEST;
    this._resource = null;
    this._fetchContextApi = null;
    //this._alreadyTerminatedWhenAllDataArrived = false;
}

FetchContext.prototype.fetch = function fetch(imagePartParams) {
    if (this._isMovable) {
        this._imagePartParams = imagePartParams;
        this._startFetch();
        return;
    }
    
    if (this._imagePartParams !== null) {
        throw 'imageDecoderFramework error: Cannot fetch twice on fetch type of "request"';
    }
    
    if (this._state !== FetchContext.FETCH_STATUS_WAIT_FOR_FETCH_CALL) {
        this._state = FetchContext.FETCH_STATUS_UNEXPECTED_FAILURE;
        throw 'imageDecoderFramework error: Unexpected state on fetch(): ' + this._state;
    }

    this._imagePartParams = imagePartParams;
    this._state = FetchContext.FETCH_STATUS_REQUEST_WAIT_FOR_SCHEDULE;
    
    if (!this._useScheduler) {
        startRequest(/*resource=*/null, this);
        return;
    }
    
    this._scheduler.enqueueJob(startRequest, this, fetchAbortedByScheduler);
};

FetchContext.prototype.manualAbortRequest = function manualAbortRequest() {
    switch (this._state) {
        case FetchContext.FETCH_STATUS_REQUEST_TERMINATED:
        case FetchContext.FETCH_STATUS_UNEXPECTED_FAILURE:
            return;
        case FetchContext.FETCH_STATUS_REQUEST_ABOUT_TO_ABORT:
            throw 'imageDecoderFramework error: Double call to manualAbortRequest()';
        case FetchContext.FETCH_STATUS_ACTIVE:
            this._state = FetchContext.FETCH_STATUS_REQUEST_ABOUT_TO_ABORT;
            if (this._isOnlyWaitForData) {
                this._fetchStopped(/*isAborted=*/true);
            } else {
                this._fetchContextApi._onEvent('stop', /*isAborted=*/true);
            }
            break;
        case FetchContext.FETCH_STATUS_WAIT_FOR_FETCH_CALL:
            this._state = FetchContext.FETCH_STATUS_REQUEST_TERMINATED;
            return;
        case FetchContext.FETCH_STATUS_REQUEST_WAIT_FOR_SCHEDULE:
        case FetchContext.FETCH_STATUS_REQUEST_ABOUT_TO_YIELD:
        case FetchContext.FETCH_STATUS_REQUEST_YIELDED:
            this._state = FetchContext.FETCH_STATUS_REQUEST_ABOUT_TO_ABORT;
            break;
        default:
            throw 'imageDecoderFramework error: Unknown state in manualAbortRequest() implementation: ' + this._state;
    }
};

FetchContext.prototype.getContextVars = function getContextVars() {
    return this._contextVars;
};

FetchContext.prototype.on = function on(event, listener) {
    switch (event) {
        case 'terminated':
            this._terminatedListeners.push(listener);
            break;
        default:
            throw 'imageDecoderFramework error: Unexpected event ' + event;
    }
};

FetchContext.prototype.setIsProgressive = function setIsProgressive(isProgressive) {
    this._isProgressive = isProgressive;
    if (this._fetchContextApi !== null) {
        this._fetchContextApi._onEvent('isProgressiveChanged', isProgressive);
    }
};

FetchContext.prototype.getIsProgressive = function getIsProgressive() {
    return this._isProgressive;
};

FetchContext.prototype._startFetch = function startFetch() {
    var prevState = this._state;
    this._state = FetchContext.FETCH_STATUS_ACTIVE;
    
    if (prevState === FetchContext.FETCH_STATUS_WAIT_FOR_FETCH_CALL ||
        prevState === FetchContext.FETCH_STATUS_MOVABLE_WAIT_FOR_MOVE_CALL) {
        
        this._fetcherCloser.changeActiveFetchesCount(+1);
    }
    
    if (this._isOnlyWaitForData) {
        this._fetchContextApi = this._extractAlreadyFetchedData();
    } else if (!this._isMovable || prevState === FetchContext.FETCH_STATUS_WAIT_FOR_FETCH_CALL) {
        if (this._fetchContextApi !== null) {
            throw 'imageDecoderFramework error: Cannot start fetch of already started fetch';
        }

        this._fetchContextApi = new FetchContextApi(this);
        this._fetchContextApi.on('internalStopped', this._fetchStopped, this);
        this._fetchContextApi.on('internalDone', this._fetchDone, this);
        
        if (this._isMovable) {
            this._fetcher.startMovableFetch(this._fetchContextApi, this._imagePartParams);
        } else {
            this._fetcher.startFetch(this._fetchContextApi, this._imagePartParams);
        }
    } else {
        this._fetchContextApi._onEvent('move', this._imagePartParams);
    }
    
    if (this._fetchContextApi !== null) { // Might be set to null in immediate call of fetchTerminated on previous line
        this._fetchContextApi._onEvent('isProgressiveChanged', this._isProgressive);
    }
};

FetchContext.prototype.checkIfShouldYield = function checkIfShouldYield() {
    try {
        if (!this._useScheduler || this._state === FetchContext.FETCH_STATUS_REQUEST_TERMINATED) {
            return;
        }
        
        if (this._resource === null) {
            throw 'imageDecoderFramework error: No resource allocated but fetch callback called';
        }
            
        if (!this._schedulerCallbacks.shouldYieldOrAbort()) {
            return;
        }
        
        this._state = FetchContext.FETCH_STATUS_REQUEST_ABOUT_TO_YIELD;
        this._fetchContextApi._onEvent('stop', /*isAborted=*/false);
    } catch (e) {
        this._state = FetchContext.FETCH_STATUS_UNEXPECTED_FAILURE;
        fetchAbortedByScheduler(this);
    }
};

FetchContext.prototype._fetchDone = function fetchDone() {
    switch (this._state) {
        case FetchContext.FETCH_STATUS_REQUEST_ABOUT_TO_ABORT:
        case FetchContext.FETCH_STATUS_ACTIVE:
        case FetchContext.FETCH_STATUS_REQUEST_ABOUT_TO_YIELD:
            break;
        default:
            throw 'imageDecoderFramework error: Unexpected state on fetch done: ' + this._state;
    }

    if (this._isMovable) {
        this._state = FetchContext.FETCH_STATUS_MOVABLE_WAIT_FOR_MOVE_CALL;
    }
    this._fetcherCloser.changeActiveFetchesCount(-1);

    if (this._resource !== null) {
        this._scheduledJobsList.remove(this._scheduledJobsListIterator);
        this._schedulerCallbacks.jobDone();

        this._resource = null;
    } else if (this._useScheduler) {
        throw 'imageDecoderFramework error: Job expected to have resource on successful termination';
    }
    
    this._terminateNonMovableFetch();
};

FetchContext.prototype._fetchStopped = function fetchStopped(isAborted) {
    switch (this._state) {
        case FetchContext.FETCH_STATUS_REQUEST_ABOUT_TO_ABORT:
            isAborted = true; // force aborted
            break;
        case FetchContext.FETCH_STATUS_REQUEST_ABOUT_TO_YIELD:
            var isYielded = this._schedulerCallbacks.tryYield(
                continueYieldedRequest,
                fetchAbortedByScheduler,
                fetchYieldedByScheduler);
            
            if (!isYielded) {
                if (this._state !== FetchContext.FETCH_STATUS_REQUEST_ABOUT_TO_YIELD) {
                    throw 'imageDecoderFramework error: Unexpected state on tryYield() false: ' + this._state;
                }
                this._state = FetchContext.FETCH_STATUS_ACTIVE;
                this._fetchContextApi._onEvent('resume');
                return;
            }
            break;
        default:
            throw 'imageDecoderFramework error: Unexpected state on fetch stopped: ' + this._state;
    }

    
    if (this._resource !== null) {
        throw 'imageDecoderFramework error: Unexpected request termination without resource allocated';
    }
    
    this._fetcherCloser.changeActiveFetchesCount(-1);
    if (this._isMovable) {
        this._state = FetchContext.FETCH_STATUS_MOVABLE_WAIT_FOR_MOVE_CALL;
    } else if (!isAborted) {
        this._terminateNonMovableFetch();
    }
};
  
FetchContext.prototype._terminateNonMovableFetch = function terminateNonMovableFetch() {  
    if (this._isMovable) {
        return;
    }
    
    this._state = FetchContext.FETCH_STATUS_REQUEST_TERMINATED;
    
    for (var i = 0; i < this._terminatedListeners.length; ++i) {
        this._terminatedListeners[i](this._contextVars);
    }
    
    if (this._fetchContextApi !== null &&
        this._state !== FetchContext.FETCH_STATUS_UNEXPECTED_FAILURE) {
            
        this._fetchContextApi._onEvent('terminate');
        this._fetchContextApi = null;
    }
};

// Properties for FrustumRequesetPrioritizer

Object.defineProperty(FetchContext.prototype, 'imagePartParams', {
    get: function getImagePartParams() {
        return this._imagePartParams;
    }
});

function startRequest(resource, self, callbacks) {
    if (self._resource !== null) {
        throw 'imageDecoderFramework error: Unexpected restart of already started request';
    }
    
    if (self._state === FetchContext.FETCH_STATUS_REQUEST_ABOUT_TO_ABORT) {
        self._fetchStopped(/*isAborted=*/true);
        return;
    } else if (self._state !== FetchContext.FETCH_STATUS_REQUEST_WAIT_FOR_SCHEDULE) {
        throw 'imageDecoderFramework error: Unexpected state on schedule: ' + self._state;
    }
    
    self._resource = resource;
    self._schedulerCallbacks = callbacks;

    if (resource !== null) {
        self._scheduledJobsListIterator = self._scheduledJobsList.add(self);
    }
    
    self._startFetch();
}

function continueYieldedRequest(resource, self) {
    if (self._isMovable) {
        throw 'imageDecoderFramework error: Unexpected call to continueYieldedRequest on movable fetch';
    }

    if (self._state === FetchContext.FETCH_STATUS_REQUEST_ABOUT_TO_ABORT ||
        self._state === FetchContext.FETCH_STATUS_UNEXPECTED_FAILURE) {
        
        self._schedulerCallbacks.jobDone();
        return;
    }
    
    if (self._state !== FetchContext.FETCH_STATUS_REQUEST_YIELDED) {
        throw 'imageDecoderFramework error: Unexpected request state on continue: ' + self._state;
    }
    
    self._state = FetchContext.FETCH_STATUS_ACTIVE;
    self._resource = resource;
    
    self._scheduledJobsListIterator = self._scheduledJobsList.add(self);
    self._onEvent('resume');
}

function fetchYieldedByScheduler(self) {
    var nextState;
    self._resource = null;
    self._scheduledJobsList.remove(self._scheduledJobsListIterator);
    if (self.state === FetchContext.FETCH_STATUS_REQUEST_ABOUT_TO_YIELD) {
        self._state = FetchContext.FETCH_STATUS_REQUEST_YIELDED;
    } else {
        self._state = FetchContext.FETCH_STATUS_UNEXPECTED_FAILURE;
        throw 'imageDecoderFramework error: Unexpected request state on yield process: ' + self._state;
    }
}

function fetchAbortedByScheduler(self) {
    self._resource = null;
    self._fetchStopped(/*isAborted=*/true);
}
},{"fetch-context-api.js":8}],10:[function(require,module,exports){
'use strict';

module.exports = FetchManager;

var imageHelperFunctions = require('image-helper-functions.js');
var FetchContext = require('fetch-context.js');
var LinkedList = require('linked-list.js');
var FetcherCloser = require('fetcher-closer.js');

/* global console: false */
/* global Promise: false */

FetchManager.fetcherExpectedMethods = ['open', 'on', 'close', 'startFetch', 'startMovableFetch'];

function FetchManager(fetcher, options) {
    options = options || {};
    
    this._fetchesLimit = options.fetchesLimit || 5;
    this._showLog = options.showLog;
    
    /*if (this._showLog) {
        // Old IE
        throw 'imageDecoderFramework error: showLog is not supported on this browser';
    }*/
    
    this._scheduler = null;
    this._fetchPrioritizer = null;
    this._prioritizerType = null;
        
    this._movableHandleCounter = 0;
    this._movableHandles = [];
    this._requestById = [];
    this._imageParams = null;
    this._scheduledJobsList = new LinkedList();
    this._fetcherCloser = new FetcherCloser();
    
    this._fetcher = imageHelperFunctions.getOrCreateInstance(
        fetcher, 'fetcher', FetchManager.fetcherExpectedMethods);
}

FetchManager.prototype.open = function open(url) {
    var fetchScheduler = imageHelperFunctions.createPrioritizer(
        this._fetchesLimit,
        this._prioritizerType,
        'fetch',
        this._showLog);
    
    this._fetchPrioritizer = fetchScheduler.prioritizer;
    if (fetchScheduler.prioritizer !== null) {
        this._scheduler = new resourceScheduler.PriorityScheduler(
            createDummyResource,
            this._fetchesLimit,
            fetchScheduler.prioritizer,
            fetchScheduler.schedulerOptions);
    } else {
        this._scheduler = new resourceScheduler.LifoScheduler(
            createDummyResource,
            this._fetchesLimit,
            fetchScheduler.schedulerOptions);
    }

    var self = this;
    return this._fetcher.open(url).then(function(result) {
        self._imageParams = result;
        return result;
    });
};

FetchManager.prototype.on = function on(event, callback, arg) {
    return this._fetcher.on(event, callback, arg);
};

FetchManager.prototype.close = function close() {
    var self = this;
    var resolve_ = null;
    var reject_ = null;

    function waitForActiveFetches(result) {
        self._fetcherCloser.close()
            .then(function() {
                resolve_(result);
            }).catch(reject_);
    }
    
    return new Promise(function(resolve, reject) {
        resolve_ = resolve;
        reject_ = reject;
        self._fetcher.close()
            .then(waitForActiveFetches)
            .catch(reject);
    });
};

FetchManager.prototype.setPrioritizerType = function setPrioritizerType(prioritizerType) {
    if (this._scheduler !== null) {
        throw 'imageDecoderFramework error: cannot set prioritizer type after FetchManager.open() called';
    }
    this._prioritizerType = prioritizerType;
};

FetchManager.prototype.getImageParams = function getImageParams() {
    return this._imageParams;
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

FetchManager.prototype.createMovableFetch = function createMovableFetch() {
    var self = this;
    return new Promise(function(resolve, reject) {
        var movableHandle = ++self._movableHandleCounter;
        self._movableHandles[movableHandle] = new FetchContext(
            self._fetcher,
            self._fetcherCloser,
            self._scheduler,
            self._scheduledJobsList,
            FetchContext.FETCH_TYPE_MOVABLE,
            /*contextVars=*/null);

        resolve(movableHandle);
    });
};

FetchManager.prototype.moveFetch = function moveFetch(
    movableHandle, imagePartParams) {
    
    var movable = this._movableHandles[movableHandle];
    movable.fetch(imagePartParams);
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
        FetchContext.FETCH_TYPE_ONLY_WAIT_FOR_DATA : */FetchContext.FETCH_TYPE_REQUEST;
    
    var fetchJob = new FetchContext(
        this._fetcher,
        this._fetcherCloser,
        this._scheduler,
        this._scheduledJobsList,
        fetchType,
        contextVars);
    
    contextVars.fetchJob = fetchJob;
    
    if (this._requestById[requestId] !== undefined) {
        throw 'imageDecoderFramework error: Duplication of requestId ' + requestId;
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

FetchManager.prototype.setFetchPrioritizerData =
    function setFetchPrioritizerData(prioritizerData) {

    if (this._fetchPrioritizer === null) {
        throw 'imageDecoderFramework error: No fetch prioritizer has been set';
    }
    
    if (this._showLog) {
        console.log('setFetchPrioritizerData(' + prioritizerData + ')');
    }
    
    prioritizerData.image = this;
    this._fetchPrioritizer.setPrioritizerData(prioritizerData);
    this._yieldFetchJobs();
};

FetchManager.prototype._yieldFetchJobs = function yieldFetchJobs() {
    var iterator = this._scheduledJobsList.getFirstIterator();
    while (iterator !== null) {
        var fetchJob = this._scheduledJobsList.getValue(iterator);
        iterator = this._scheduledJobsList.getNextIterator(iterator);
        
        fetchJob.checkIfShouldYield();
    }
};

function internalTerminatedCallback(contextVars) {
    delete contextVars.self._requestById[contextVars.requestId];
}

function createDummyResource() {
    return {};
}
},{"fetch-context.js":9,"fetcher-closer.js":11,"image-helper-functions.js":13,"linked-list.js":14}],11:[function(require,module,exports){
'use strict';

module.exports = FetcherCloser;

/* global Promise: false */

function FetcherCloser() {
    this._resolveClose = null;
    this._activeFetches = 0;
    this._isClosed = false;
}

FetcherCloser.prototype.changeActiveFetchesCount = function changeActiveFetchesCount(addValue) {
    if (this._isClosed) {
        throw 'imageDecoderFramework error: Unexpected change of active fetches count after closed';
    }
    this._activeFetches += addValue;
    
    if (this._activeFetches === 0 && this._resolveClose) {
        this._isClosed = true;
        this._resolveClose();
    }
};

FetcherCloser.prototype.isCloseRequested = function isCloseRequested() {
    return this._isClosed || (this._resolveClose !== null);
};

FetcherCloser.prototype.close = function close() {
    if (this.isCloseRequested()) {
        throw 'imageDecoderFramework error: close() called twice';
    }
    var self = this;
    return new Promise(function(resolve, reject) {
        self._resolveClose = resolve;
        if (self._activeFetches === 0) {
            self._resolveClose();
        }
    });
};
},{}],12:[function(require,module,exports){
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
    
FrustumRequestsPrioritizer.prototype.setPrioritizerData = function setPrioritizerData(data) {
    this._frustumData = data;
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
        throw 'imageDecoderFramework error: No imageRectangle information passed in setPrioritizerData';
    }
    
    var exactFrustumLevel = this._frustumData.exactlevel;
    
    if (this._frustumData.exactlevel === undefined) {
        throw 'imageDecoderFramework error: No exactlevel information passed in ' +
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
},{}],13:[function(require,module,exports){
'use strict';

var FrustumRequestsPrioritizer = require('frustum-requests-prioritizer.js');

module.exports = {
    calculateFrustum2DFromBounds: calculateFrustum2DFromBounds,
    createPrioritizer: createPrioritizer,
    fixBounds: fixBounds,
    ensureLevelCalculator: ensureLevelCalculator,
    alignParamsToTilesAndLevel: alignParamsToTilesAndLevel,
    getOrCreateInstance: getOrCreateInstance,
    isIndirectCreationNeeded: isIndirectCreationNeeded
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
    
function createPrioritizer(
    resourceLimit, prioritizerType, schedulerName, showLog) {
    
    var prioritizer;
    var limitResourceByLowQualityPriority = false;
    
    if (prioritizerType === 'frustum') {
        limitResourceByLowQualityPriority = true;
        prioritizer = new FrustumRequestsPrioritizer();
    } else if (prioritizerType === 'frustumOnly') {
        limitResourceByLowQualityPriority = true;
        prioritizer = new FrustumRequestsPrioritizer(
            /*isAbortRequestsNotInFrustum=*/true,
            /*isPrioritizeLowQualityStage=*/true);
    } else if (!prioritizerType) {
        prioritizer = null;
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
        
    return {
        prioritizer: prioritizer,
        schedulerOptions: options
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

function ensureLevelCalculator(levelCalculator) {
    if ('function' !== typeof levelCalculator.getLevel) {
        throw 'imageDecoderFramework error: Missing method levelCalculator.getLevel()';
    }
    if ('function' !== typeof levelCalculator.getLevelWidth) {
        throw 'imageDecoderFramework error: Missing method levelCalculator.getLevelWidth()';
    }
    if ('function' !== typeof levelCalculator.getLevelHeight) {
        throw 'imageDecoderFramework error: Missing method levelCalculator.getLevelHeight()';
    }
}

function alignParamsToTilesAndLevel(region, imageDecoder) {
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
        throw 'imageDecoderFramework error: Parameters order is invalid';
    }
    
    var defaultLevelWidth = imageDecoder.getImageWidth();
    var defaultLevelHeight = imageDecoder.getImageHeight();
    if (regionMaxX < 0 || regionMinX >= defaultLevelWidth ||
        regionMaxY < 0 || regionMinY >= defaultLevelHeight) {
        
        return null;
    }
    
    var levelCalculator = imageDecoder.getLevelCalculator();
    var level = levelCalculator.getLevel(region);
    var levelWidth = levelCalculator.getLevelWidth(level);
    var levelHeight = levelCalculator.getLevelHeight(level);
    
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

function getOrCreateInstance(obj, objName, expectedMethods) {
    if (!isIndirectCreationNeeded(obj, objName, expectedMethods)) {
        return obj;
    }
    
    var classToCreate = null;
    try {
        classToCreate = getClassInGlobalObject(window, obj.ctorName);
    } catch(e) { }

    if (!classToCreate) {
        try {
            classToCreate = getClassInGlobalObject(globals, obj.ctorName);
        } catch(e) { }
    }
    
    if (!classToCreate) {
        try {
            classToCreate = getClassInGlobalObject(self, obj.ctorName);
        } catch(e) { }
    }
    
    if (!classToCreate) {
        throw 'imageDecoderFramework error: Could not find class ' + obj.ctorName + ' in global ' +
            ' scope to create an instance of ' + objName;
    }
    
    var result = new classToCreate();
    
    // Throw exception if methods not exist
    isIndirectCreationNeeded(result, objName, expectedMethods, /*disableCtorNameSearch=*/true);
    
    return result;
}

function isIndirectCreationNeeded(obj, objName, expectedMethods, disableCtorNameSearch) {
    if (!obj) {
        throw 'imageDecoderFramework error: missing argument ' + objName;
    }
    
    var nonexistingMethod;
    for (var i = 0; i < expectedMethods.length; ++i) {
        if ('function' !== typeof obj[expectedMethods[i]]) {
            nonexistingMethod = expectedMethods[i];
            break;
        }
    }
    
    if (i === expectedMethods.length) {
        return false;
    }

    if (disableCtorNameSearch) {
        throw 'imageDecoderFramework error: Could not find method ' +
            nonexistingMethod + ' in object ' + objName;
    }
    
    if ('string' !== typeof obj.ctorName) {
        throw 'imageDecoderFramework error: Could not find method ' + nonexistingMethod +
            ' in object ' + objName + '. Either method should be exist or the object\'s ' +
            'ctorName property should point to a class to create instance from';
    }
    if (!obj.scriptsToImport) {
        throw 'imageDecoderFramework error: Could not find method ' + nonexistingMethod +
            ' in object ' + objName + '. Either method should be exist or the object\'s ' +
            'scriptsToImport property should be exist';
    }

    return true;
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
},{"frustum-requests-prioritizer.js":12}],14:[function(require,module,exports){
'use strict';

module.exports = LinkedList;

function LinkedList(useAutomaticHazardHeuristics) {
    this._first = { _prev: null, _parent: this };
    this._last = { _next: null, _parent: this };
    this._count = 0;
    this._useAutomaticHazardHeuristics = useAutomaticHazardHeuristics;
    
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
        _isIterated: false,
        _parent: this
    };
    
    newNode._prev._next = newNode;
    addBefore._prev = newNode;
    
    return newNode;
};

LinkedList.prototype.remove = function remove(iterator) {
    this._validateIteratorOfThis(iterator);
    if (this._useAutomaticHazardHeuristics && iterator._isIterated) {
        throw 'dependency-workers error: Suspect removal while iteration';
    }
    
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
    iterator._isIterated = true;
    return iterator;
};

LinkedList.prototype.getNextIterator = function getNextIterator(iterator) {
    this._validateIteratorOfThis(iterator);

    iterator._isIterated = false;
    if (iterator._next === this._last) {
        return null;
    }
    
    iterator._next._isIterated = true;
    return iterator._next;
};

LinkedList.prototype.getPrevIterator = function getPrevIterator(iterator) {
    this._validateIteratorOfThis(iterator);

    iterator._isIterated = false;
    if (iterator._prev === this._first) {
        return null;
    }
    
    iterator._prev._isIterated = true;
    return iterator._prev;
};

LinkedList.prototype.getCount = function getCount() {
    return this._count;
};

LinkedList.prototype._validateIteratorOfThis =
    function validateIteratorOfThis(iterator) {
    
    if (iterator._parent !== this) {
        throw 'dependency-workers error: iterator must be of the current LinkedList';
    }
};
},{}],15:[function(require,module,exports){
'use strict';

module.exports = ImageDecoderViewer;

var imageHelperFunctions = require('image-helper-functions.js');

var PENDING_CALL_TYPE_PIXELS_UPDATED = 1;
var PENDING_CALL_TYPE_REPOSITION = 2;

var REGION_OVERVIEW = 0;
var REGION_DYNAMIC = 1;

function ImageDecoderViewer(imageDecoder, canvasUpdatedCallback, options) {
    this._canvasUpdatedCallback = canvasUpdatedCallback;
    
    this._adaptProportions = options.adaptProportions;
    this._cartographicBounds = options.cartographicBounds;
    this._allowMultipleMovableFetchesInSession =
        options.allowMultipleMovableFetchesInSession;
    this._minFunctionCallIntervalMilliseconds =
        options.minFunctionCallIntervalMilliseconds;
    this._overviewResolutionX = options.overviewResolutionX || 100;
    this._overviewResolutionY = options.overviewResolutionY || 100;
        
    this._lastRequestIndex = 0;
    this._pendingUpdateViewArea = null;
    this._regions = [];
    this._targetCanvas = null;
    
    this._callPendingCallbacksBound = this._callPendingCallbacks.bind(this);
    this._createdMovableFetchBound = this._createdMovableFetch.bind(this);
    
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
    
    this._imageDecoder = imageDecoder;
    imageDecoder.setDecodePrioritizerType('frustumOnly');
    imageDecoder.setFetchPrioritizerType('frustumOnly');
}

ImageDecoderViewer.prototype.setExceptionCallback = function setExceptionCallback(exceptionCallback) {
    // TODO: Support exceptionCallback in every place needed
    this._exceptionCallback = exceptionCallback;
};
    
ImageDecoderViewer.prototype.open = function open(url) {
    return this._imageDecoder.open(url)
        .then(this._opened.bind(this))
        .catch(this._exceptionCallback);
};

ImageDecoderViewer.prototype.close = function close() {
    var promise = this._imageDecoder.close();
    promise.catch(this._exceptionCallback);
    this._isReady = false;
    this._canShowDynamicRegion = false;
    this._targetCanvas = null;
    return promise;
};

ImageDecoderViewer.prototype.setTargetCanvas = function setTargetCanvas(canvas) {
    this._targetCanvas = canvas;
};

ImageDecoderViewer.prototype.updateViewArea = function updateViewArea(frustumData) {
    if (this._targetCanvas === null) {
        throw 'imageDecoderFramework error: Cannot update dynamic region before setTargetCanvas()';
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
            regionParams, this._imageDecoder);
    
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
    
    this._imageDecoder.setDecodePrioritizerData(frustumData);
    this._imageDecoder.setFetchPrioritizerData(frustumData);

    this._dynamicFetchParams = alignedParams;
    
    var startDynamicRegionOnTermination = false;
    var moveExistingFetch = !this._allowMultipleMovableFetchesInSession;
    this._fetch(
        REGION_DYNAMIC,
        alignedParams,
        startDynamicRegionOnTermination,
        moveExistingFetch);
};

ImageDecoderViewer.prototype.getBounds = function getCartographicBounds() {
    if (!this._isReady) {
        throw 'imageDecoderFramework error: ImageDecoderViewer error: Image is not ready yet';
    }
    return this._cartographicBoundsFixed;
};

ImageDecoderViewer.prototype._isImagePartsEqual = function isImagePartsEqual(first, second) {
    var isEqual =
        this._dynamicFetchParams !== undefined &&
        first.minX === second.minX &&
        first.minY === second.minY &&
        first.maxXExclusive === second.maxXExclusive &&
        first.maxYExclusive === second.maxYExclusive &&
        first.level === second.level;
    
    return isEqual;
};

ImageDecoderViewer.prototype._fetch = function fetch(
    regionId,
    fetchParams,
    startDynamicRegionOnTermination,
    moveExistingFetch) {
    
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
    
    var movableHandle = moveExistingFetch ? this._movableHandle: undefined;

    this._imageDecoder.requestPixelsProgressive(
        fetchParams.imagePartParams,
        callback,
        terminatedCallback,
        fetchParamsNotNeeded,
        movableHandle);
    
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
            
            self._imageDecoder.requestPixelsProgressive(
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

ImageDecoderViewer.prototype._fetchTerminatedCallback = function fetchTerminatedCallback(
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
        this._imageDecoder.createMovableFetch().then(this._createdMovableFetchBound);
    }
};

ImageDecoderViewer.prototype._createdMovableFetch = function createdMovableFetch(movableHandle) {
    this._movableHandle = movableHandle;
    this._startShowingDynamicRegion();
};

ImageDecoderViewer.prototype._startShowingDynamicRegion = function startShowingDynamicRegion() {
    this._canShowDynamicRegion = true;
    
    if (this._pendingUpdateViewArea !== null) {
        this.updateViewArea(this._pendingUpdateViewArea);
        
        this._pendingUpdateViewArea = null;
    }
};

ImageDecoderViewer.prototype._tilesDecodedCallback = function tilesDecodedCallback(
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
                throw 'imageDecoderFramework error: Unexpected regionId ' + regionId;
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

ImageDecoderViewer.prototype._checkIfRepositionNeeded = function checkIfRepositionNeeded(
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

ImageDecoderViewer.prototype._notifyNewPendingCalls = function notifyNewPendingCalls() {
    if (!this._isNearCallbackCalled) {
        this._callPendingCallbacks();
    }
};

ImageDecoderViewer.prototype._callPendingCallbacks = function callPendingCallbacks() {
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
            throw 'imageDecoderFramework error: Internal ImageDecoderViewer Error: Unexpected call type ' +
                callArgs.type;
        }
    }
    
    this._pendingCallbackCalls.length = 0;
    
    this._canvasUpdatedCallback(newPosition);
};

ImageDecoderViewer.prototype._pixelsUpdated = function pixelsUpdated(pixelsUpdatedArgs) {
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

ImageDecoderViewer.prototype._repositionCanvas = function repositionCanvas(repositionArgs) {
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

ImageDecoderViewer.prototype._copyOverviewToCanvas = function copyOverviewToCanvas(
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

ImageDecoderViewer.prototype._opened = function opened() {
    this._isReady = true;
    
    var fixedBounds = {
        west: this._cartographicBounds.west,
        east: this._cartographicBounds.east,
        south: this._cartographicBounds.south,
        north: this._cartographicBounds.north
    };
    imageHelperFunctions.fixBounds(
        fixedBounds, this._imageDecoder, this._adaptProportions);
    this._cartographicBoundsFixed = fixedBounds;
    
    var imageWidth  = this._imageDecoder.getImageWidth ();
    var imageHeight = this._imageDecoder.getImageHeight();
    this._quality = this._imageDecoder.getHighestQuality();

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
            overviewParams, this._imageDecoder);
            
    overviewAlignedParams.imagePartParams.requestPriorityData =
        overviewAlignedParams.imagePartParams.requestPriorityData || {};
    
    overviewAlignedParams.imagePartParams.requestPriorityData.overrideHighestPriority = true;
    overviewAlignedParams.imagePartParams.quality = this._imageDecoder.getLowestQuality();
    
    var startDynamicRegionOnTermination =
        !this._allowMultipleMovableFetchesInSession;
        
    this._fetch(
        REGION_OVERVIEW,
        overviewAlignedParams,
        startDynamicRegionOnTermination);
    
    if (this._allowMultipleMovableFetchesInSession) {
        this._startShowingDynamicRegion();
    }
};
},{"image-helper-functions.js":13}],16:[function(require,module,exports){
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
            throw 'imageDecoderFramework error: getImageParamsInternal() returned falsy value; Maybe image not ready yet?';
        }
        
        if (this._sizesParams.imageLevel === undefined) {
            throw 'imageDecoderFramework error: getImageParamsInternal() result has no imageLevel property';
        }
        
        if (this._sizesParams.imageWidth === undefined) {
            throw 'imageDecoderFramework error: getImageParamsInternal() result has no imageWidth property';
        }
        
        if (this._sizesParams.imageHeight === undefined) {
            throw 'imageDecoderFramework error: getImageParamsInternal() result has no imageHeight property';
        }
        
        if (this._sizesParams.numResolutionLevelsForLimittedViewer === undefined) {
            throw 'imageDecoderFramework error: getImageParamsInternal() result has no numResolutionLevelsForLimittedViewer property';
        }
        
        if (this._sizesParams.lowestQuality === undefined) {
            throw 'imageDecoderFramework error: getImageParamsInternal() result has no lowestQuality property';
        }
        
        if (this._sizesParams.highestQuality === undefined) {
            throw 'imageDecoderFramework error: getImageParamsInternal() result has no highestQuality property';
        }
    }
    
    return this._sizesParams;
};

ImageParamsRetrieverProxy.prototype._getImageParamsInternal = function getImageParamsInternal() {
    throw 'imageDecoderFramework error: ImageParamsRetrieverProxy inheritor did not implement _getImageParamsInternal()';
};
},{}],17:[function(require,module,exports){
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

WorkerProxyFetchManager.prototype.open = function open(url) {
    var self = this;
    var workerHelper = asyncProxy.AsyncProxyFactory.getWorkerHelper(this);

    return workerHelper.callFunction('open', [url], { isReturnPromise: true })
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
},{}],18:[function(require,module,exports){
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
},{"image-helper-functions.js":13,"image-params-retriever-proxy.js":16}],19:[function(require,module,exports){
'use strict';

module.exports = ImageDecoder;

var imageHelperFunctions = require('image-helper-functions.js');
var DecodeJobsPool = require('decode-jobs-pool.js');
var ImageParamsRetrieverProxy = require('image-params-retriever-proxy.js');
var FetchManager = require('fetch-manager.js');
var WorkerProxyFetchManager = require('worker-proxy-fetch-manager.js');
var WorkerProxyImageDecoder = require('worker-proxy-image-decoder.js');

/* global console: false */
/* global Promise: false */

ImageDecoder.alignParamsToTilesAndLevel = imageHelperFunctions.alignParamsToTilesAndLevel;

ImageDecoder.fromImage = function fromImage(image, options) {
    var isIndirectCreationNeeded = imageHelperFunctions.isIndirectCreationNeeded(
        image, 'image', ImageDecoder._imageExpectedMethods);
    
    if (!isIndirectCreationNeeded || !image.useWorker) {
        return new ImageDecoder(image, options);
    } else {
        return new WorkerProxyImageDecoder(image, options);
    }
};

ImageDecoder._imageExpectedMethods = ['opened', 'getLevelCalculator', 'getFetcher', 'getDecoderWorkersInputRetreiver'];

function ImageDecoder(image, options) {
    ImageParamsRetrieverProxy.call(this);
    
    this._options = options || {};
    this._decodeWorkersLimit = this._options.decodeWorkersLimit || 5;
    
    this._tileWidth = this._options.tileWidth || 256;
    this._tileHeight = this._options.tileHeight || 256;
    this._showLog = !!this._options.showLog;
    this._fetchManager = null;
    this._decodeDependencyWorkers = null;
    this._requestsDecodeJobsPool = null;
    this._movablesDecodeJobsPool = null;
    this._levelCalculator = null;
    this._fetchRequestId = 0;
    
    /*if (this._showLog) {
        // Old IE
        throw 'imageDecoderFramework error: showLog is not supported on this browser';
    }*/

    this._movableStates = [];
    this._decoders = [];
    
    this._decodeScheduler = null;
    this._decodePrioritizer = null;
    this._prioritizerType = null;

    this._image = imageHelperFunctions.getOrCreateInstance(
        image, 'image', ImageDecoder._imageExpectedMethods);
}

ImageDecoder.prototype = Object.create(ImageParamsRetrieverProxy.prototype);

ImageDecoder.prototype.getTileWidth = function getTileWidth() {
    return this._tileWidth;
};

ImageDecoder.prototype.getTileHeight = function getTileHeight() {
    return this._tileHeight;
};
    
ImageDecoder.prototype.setFetchPrioritizerData =
    function setFetchPrioritizerData(prioritizerData) {

    this._validateFetcher();
    
    this._fetchManager.setFetchPrioritizerData(
        prioritizerData);
};

ImageDecoder.prototype.setDecodePrioritizerData =
    function setDecodePrioritizerData(prioritizerData) {

    this._validateDecoder();
    
    if (this._decodePrioritizer === null) {
        throw 'imageDecoderFramework error: No decode prioritizer has been set';
    }
    
    if (this._showLog) {
        console.log('setDecodePrioritizerData(' + prioritizerData + ')');
    }
    
    var prioritizerDataModified = Object.create(prioritizerData);
    prioritizerDataModified.image = this;
    
    this._decodePrioritizer.setPrioritizerData(prioritizerDataModified);
};

ImageDecoder.prototype.setDecodePrioritizerType = function setPrioritizerType(prioritizerType) {
    if (this._decodeScheduler !== null) {
        throw 'imageDecoderFramework error: Cannot set prioritizer type at this time';
    }
    
    this._prioritizerType = prioritizerType;
};

ImageDecoder.prototype.setFetchPrioritizerType = function setPrioritizerType(prioritizerType) {
    this._validateFetcher();
    this._fetchManager.setPrioritizerType(prioritizerType);
};

ImageDecoder.prototype.open = function open(url) {
    this._validateFetcher();

    var self = this;
    var promise = this._fetchManager.open(url);
    return promise.then(function (sizesParams) {
        self._internalSizesParams = sizesParams;
        self._image.opened(self);
        self._levelCalculator = self._image.getLevelCalculator();
        imageHelperFunctions.ensureLevelCalculator(self._levelCalculator);
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

    var self = this;
    return this._fetchManager.close().then(function() {
        self._decodeDependencyWorkers.terminateInactiveWorkers();
    });
};

ImageDecoder.prototype.onFetcherEvent = function onFetcherEvent(event, callback) {
    this._validateFetcher();
    this._fetchManager.on(event, callback);
};

ImageDecoder.prototype.createMovableFetch = function createMovableFetch() {
    this._validateFetcher();
    this.getImageParams();
    
    var self = this;
    
    return this._fetchManager.createMovableFetch().then(function(movableHandle) {
        self._movableStates[movableHandle] = {
            decodeJobsListenerHandle: null
        };
        
        return movableHandle;
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
    movableHandle) {
    
    this._validateDecoder();
    this.getImageParams();
    
    var movableState = null;
    var decodeJobsPool;
    if (movableHandle === undefined) {
        decodeJobsPool = this._requestsDecodeJobsPool;
    } else {
        decodeJobsPool = this._movablesDecodeJobsPool;
        
        movableState = this._movableStates[movableHandle];
        
        if (movableState === undefined) {
            throw 'imageDecoderFramework error: Movable handle does not exist';
        }
    }
    
    var listenerHandle = decodeJobsPool.forkDecodeJobs(
        imagePartParams,
        callback,
        terminatedCallback || function() { },
        imagePartParamsNotNeeded);
        
    if (movableHandle !== undefined) {
        if (movableState.decodeJobsListenerHandle !== null) {
            // Unregister after forked new jobs, so no termination occurs meanwhile
            decodeJobsPool.unregisterForkedJobs(
                movableState.decodeJobsListenerHandle);
        }
        movableState.decodeJobsListenerHandle = listenerHandle;
        this._fetchManager.moveFetch(movableHandle, imagePartParams);
    } else {
        this._fetchManager.createRequest(++this._fetchRequestId, imagePartParams);
    }
};

ImageDecoder.prototype.getLevelCalculator = function getLevelCalculator() {
    return this._levelCalculator;
};

// Internal Methods

ImageDecoder.prototype._validateFetcher = function validateFetcher() {
    if (this._fetchManager !== null) {
        return;
    }

    var fetcher = this._image.getFetcher();
    var isIndirectCreationNeeded = imageHelperFunctions.isIndirectCreationNeeded(
        fetcher, 'fetcher', FetchManager.fetcherExpectedMethods);
    
    if (!isIndirectCreationNeeded || !fetcher.useWorker) {
        this._fetchManager = new FetchManager(fetcher, this._options);
    } else {
        this._fetchManager = new WorkerProxyFetchManager(
            fetcher, this._options);
    }
};

ImageDecoder.prototype._validateDecoder = function validateComponents() {
    if (this._decodeDependencyWorkers !== null) {
        return;
    }
    
    var decodeScheduling = imageHelperFunctions.createPrioritizer(
        this._decodeWorkersLimit,
        this._prioritizerType,
        'decode',
        this._showLog);
    
    if (decodeScheduling.prioritizer !== null) {
        this._decodeScheduler = new dependencyWorkers.DependencyWorkersTaskScheduler(
            this._decodeWorkersLimit, decodeScheduling.schedulerOptions);
        this._decodePrioritizer = decodeScheduling.prioritizer;
    } else {
        this._decodeScheduler = new resourceScheduler.LifoScheduler(
            createDummyResource,
            this._decodeWorkersLimit,
            decodeScheduling.schedulerOptions);
        this._decodePrioritizer = null;
    }

    var inputRetreiver = this._image.getDecoderWorkersInputRetreiver();
    this._decodeDependencyWorkers = new dependencyWorkers.SchedulerDependencyWorkers(
        this._decodeScheduler, inputRetreiver);
    
    this._requestsDecodeJobsPool = new DecodeJobsPool(
        this._decodeDependencyWorkers,
        this._decodePrioritizer,
        this._tileWidth,
        this._tileHeight);
        
    this._movablesDecodeJobsPool = new DecodeJobsPool(
        this._decodeDependencyWorkers,
        this._decodePrioritizer,
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

function createDummyResource()
{
}
},{"decode-jobs-pool.js":7,"fetch-manager.js":10,"image-helper-functions.js":13,"image-params-retriever-proxy.js":16,"worker-proxy-fetch-manager.js":17,"worker-proxy-image-decoder.js":18}],20:[function(require,module,exports){
'use strict';

var ImageViewer = require('image-decoder-viewer.js');
var calculateLeafletFrustum = require('leaflet-frustum-calculator.js');

/* global L: false */
/* global self: false */

if (self.L) {
    module.exports = L.Class.extend(createImageDecoderRegionLayerFunctions());
} else {
    module.exports = function() {
        throw new Error('imageDecoderFramework error: Cannot instantiate ImageDecoderRegionLayer: No Leaflet namespace in scope');
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
            this._imageViewer = null;
            this._exceptionCallback = null;
        },
        
        setExceptionCallback: function setExceptionCallback(exceptionCallback) {
            this._exceptionCallback = exceptionCallback;
            if (this._imageViewer !== null) {
                this._imageViewer.setExceptionCallback(exceptionCallback);
            }
        },
        
        _createImage: function createImage() {
            if (this._imageViewer === null) {
                this._imageViewer = new ImageViewer(
                    this._options.imageDecoder,
                    this._canvasUpdatedCallbackBound,
                    this._options);
                
                if (this._exceptionCallback !== null) {
                    this._imageViewer.setExceptionCallback(this._exceptionCallback);
                }
                
                this._imageViewer.open(this._options.url).catch(this._exceptionCallback);
            }
        },

        onAdd: function onAdd(map) {
            if (this._map !== undefined) {
                throw 'imageDecoderFramework error: Cannot add this layer to two maps';
            }
            
            this._map = map;
            this._createImage();

            // create a DOM element and put it into one of the map panes
            this._targetCanvas = L.DomUtil.create(
                'canvas', 'image-decoder-layer-canvas leaflet-zoom-animated');
            
            this._imageViewer.setTargetCanvas(this._targetCanvas);
            
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
                throw 'imageDecoderFramework error: Removed from wrong map';
            }
            
            map.off('viewreset', this._moved, this);
            map.off('move', this._moved, this);
            map.off('zoomanim', this._animateZoom, this);
            
            // remove layer's DOM elements and listeners
            map.getPanes().mapPane.removeChild(this._targetCanvas);
            this._targetCanvas = null;
            this._canvasPosition = null;

            this._map = undefined;
            
            this._imageViewer.close();
            this._imageViewer = null;
        },
        
        _moved: function () {
            this._moveCanvases();

            var frustumData = calculateLeafletFrustum(this._map);
            
            this._imageViewer.updateViewArea(frustumData);
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
},{"image-decoder-viewer.js":15,"leaflet-frustum-calculator.js":21}],21:[function(require,module,exports){
'use strict';

var imageHelperFunctions = require('image-helper-functions.js');

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
},{"image-helper-functions.js":13}],22:[function(require,module,exports){
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
        var tilePosition  = {minX: 0, minY: 0, maxXExclusive: 0, maxYExclusive: 0, width: decoderInput.tileWidth, height: decoderInput.tileHeight};
        var regionInImage = {minX: 0, minY: 0, maxXExclusive: 0, maxYExclusive: 0, width: 0, height: 0}; 
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
            regionInImage.width         = regionInImage.maxXExclusive - regionInImage.minX;
            regionInImage.height        = regionInImage.maxYExclusive - regionInImage.minY;
            
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
        throw 'imageDecoderFramework error: decodeRegion is not implemented';
    };
}
},{}],23:[function(require,module,exports){
'use strict';

module.exports = GridFetcherBase;

var SimpleFetcherBase = require('simple-fetcher-base.js');
var GridImageBase = require('grid-image-base.js');
var LinkedList = require('linked-list.js');

/* global Promise: false */

var TILE_STATE_ACTIVE = 0;
var TILE_STATE_PENDING_STOP = 1;
var TILE_STATE_STOPPED = 2;
var TILE_STATE_TERMINATED = 3;

function GridFetcherBase(options) {
    SimpleFetcherBase.call(this, options);
    this._gridFetcherBaseCache = [];
    this._events = {
        'data': [],
        'tile-terminated': []
    };
}

GridFetcherBase.prototype = Object.create(SimpleFetcherBase.prototype);

GridFetcherBase.prototype.fetchTile = function(level, tileX, tileY, fetchTask) {
    throw 'imageDecoderFramework error: GridFetcherBase.fetchTile is not implemented by inheritor';
};

GridFetcherBase.prototype.on = function(event, listener) {
    var listeners = this._events[event];
    if (!listeners) {
        throw 'imageDecoderFramework error: Unexpected event ' + event + ' in GridFetcherBase';
    }
    listeners.push(listener);
};

GridFetcherBase.prototype.startFetch = function startFetch(fetchContext, imagePartParams) {
    var fetchData = {
        activeTilesCount: 0,
        activeTilesCountWithSingleListener: 0,
        tileListeners: [],
        fetchContext: fetchContext,
        isPendingStop: false,
        isActive: false,
        imagePartParams: imagePartParams,
        self: this
    };
    
    fetchContext.on('stop', onFetchStop, fetchData);
    fetchContext.on('resume', onFetchResume, fetchData);
    fetchContext.on('terminate', onFetchTerminate, fetchData);

    var tilesToStartX = [];
    var tilesToStartY = [];
    var tilesToStartTileContexts = [];
    
    var tilesRange = GridImageBase.getTilesRange(this.getImageParams(), imagePartParams);
    fetchData.activeTilesCount = (tilesRange.maxTileX - tilesRange.minTileX) * (tilesRange.maxTileY - tilesRange.minTileY);
    for (var tileX = tilesRange.minTileX; tileX < tilesRange.maxTileX; ++tileX) {
        for (var tileY = tilesRange.minTileY; tileY < tilesRange.maxTileY; ++tileY) {
            var tileContext = this._addToCache(tileX, tileY, fetchData);
            if (tileContext === null) {
                continue;
            }

            tilesToStartX.push(tileX);
            tilesToStartY.push(tileY);
            tilesToStartTileContexts.push(tileContext);
        }
    }
    
    onFetchResume.call(fetchData);
    
    for (var i = 0; i < tilesToStartX.length; ++i) {
        this._loadTile(fetchData.imagePartParams.level, tilesToStartX[i], tilesToStartY[i], tilesToStartTileContexts[i]);
    }
};

GridFetcherBase.prototype._checkIfShouldStop = function tryStopFetch(fetchData) {
    if (!fetchData.isPendingStop || fetchData.activeTilesCountWithSingleListener > 0) {
        return;
    }
    
    fetchData.isPendingStop = false;
    fetchData.isActive = false;
    this._changeSingleListenerCountOfOverlappingFetches(fetchData, +1);
    fetchData.fetchContext.stopped();
};
    
GridFetcherBase.prototype._changeSingleListenerCountOfOverlappingFetches =
        function changeSingleListenerCountOfOverlappingFetches(fetchData, addValue) {
            
    for (var i = 0; i < fetchData.tileListeners.length; ++i) {
        var tileContext = fetchData.tileListeners[i].tileContext;
        this._changeSingleListenerCount(tileContext.dependFetches, /*singleListenerAddValue=*/addValue);
    }
};

GridFetcherBase.prototype._decrementActiveTiles = function(tileDependFetches) {
    var singleActiveFetch = null;
    var hasActiveFetches = false;
    var iterator = tileDependFetches.getFirstIterator();
    while (iterator !== null) {
        var fetchData = tileDependFetches.getValue(iterator);
        iterator = tileDependFetches.getNextIterator(iterator);

        --fetchData.activeTilesCount;
        if (fetchData.activeTilesCount === 0) {
            fetchData.isActive = false;
            fetchData.fetchContext.done();
        }
    }
};

GridFetcherBase.prototype._changeSingleListenerCount = function(tileDependFetches, singleListenerAddValue) {
    var singleActiveFetch = null;
    var hasActiveFetches = false;
    var iterator = tileDependFetches.getFirstIterator();
    while (iterator !== null) {
        var fetchData = tileDependFetches.getValue(iterator);
        iterator = tileDependFetches.getNextIterator(iterator);

        if (!fetchData.isActive) {
            continue;
        } else if (singleActiveFetch === null) {
            singleActiveFetch = fetchData;
            hasActiveFetches = true;
        } else if (hasActiveFetches) {
            // Not single anymore
            return;
        }
    }
    
    if (singleActiveFetch !== null) {
        singleActiveFetch.activeTilesCountWithSingleListener += singleListenerAddValue;
        this._checkIfShouldStop(singleActiveFetch);
    }
};

function onFetchStop() {
    /* jshint validthis: true */
    var fetchData = this;

    fetchData.isPendingStop = true;
    fetchData.self._checkIfShouldStop(fetchData);
}

function onFetchResume() {
    /* jshint validthis: true */
    var fetchData = this;
    fetchData.isPendingStop = false;
    
    fetchData.self._changeSingleListenerCountOfOverlappingFetches(fetchData, -1);
    fetchData.isActive = true;
}

function onFetchTerminate() {
    /* jshint validthis: true */
    var fetchData = this;
    
    if (fetchData.isActive) {
        throw 'imageDecoderFramework error: Unexpected grid fetch terminated of a still active fetch';
    }
    
    for (var i = 0; i < fetchData.tileListeners.length; ++i) {
        fetchData.tileListeners[i].tileContext.dependFetches.remove(fetchData.tileListeners[i].iterator);
    }
}

GridFetcherBase.prototype._loadTile = function loadTile(level, tileX, tileY, tileContext) {
    var tileKey = {
        fetchWaitTask: true,
        tileX: tileX,
        tileY: tileY,
        level: level
    };
    
    var self = this;
    var tileFetchApi = {
        dataReady: function(result) {
            if (tileContext.tileState !== TILE_STATE_ACTIVE && tileContext.tileState !== TILE_STATE_PENDING_STOP) {
                throw 'imageDecoderFramework error: either stopped or already terminated in GridFetcherBase.fetchTile()';
            }
            if (self._gridFetcherBaseCache[level][tileX][tileY] !== tileContext) {
                throw 'imageDecoderFramework error: Unexpected fetch in GridFetcherBase.gridFetcherBaseCache';
            }
            var data = {
                tileKey: tileKey,
                tileContent: result
            };
            for (var i = 0; i < self._events.data.length; ++i) {
                self._events.data[i](data);
            }
        },
        
        terminate: function() {
            if (tileContext.tileState !== TILE_STATE_ACTIVE && tileContext.tileState !== TILE_STATE_PENDING_STOP) {
                throw 'imageDecoderFramework error: either stopped or already terminated in GridFetcherBase.fetchTile()';
            }
            if (self._gridFetcherBaseCache[level][tileX][tileY] !== tileContext) {
                throw 'imageDecoderFramework error: Unexpected fetch in GridFetcherBase.gridFetcherBaseCache';
            }
            tileContext.tileState = TILE_STATE_TERMINATED;
            self._gridFetcherBaseCache[level][tileX][tileY] = null;
            
            for (var i = 0; i < self._events['tile-terminated'].length; ++i) {
                self._events['tile-terminated'][i](tileKey);
            }
            
            self._decrementActiveTiles(tileContext.dependFetches);
            self._changeSingleListenerCount(tileContext.dependFetches, /*singleListenerAddValue=*/-1);
        },
        /* TODO: enable stop & resume
        on: function(event, handler) {
            if (event !== 'stop' && event !== 'resume') {
                throw 'imageDecoderFramework error: GridFetcherBase tile.on unexpected event ' + event + ': expected stop or resume';
            }
            
            tileContext[event + 'Listeners'].push(handler);
        }
        
        stopped: function() {
            if (tileContext.tileState !== TILE_STATE_PENDING_STOP) {
                throw 'imageDecoderFramework error: Unexpected stopped call. Either: 1. No stop requested or, 2. resume was called ' +
                    'till then or, 3. Already called stopped or, 4. Already called terminate';
            }
        }
        */
    };
    
    this.fetchTile(level, tileX, tileY, tileFetchApi);
};

GridFetcherBase.prototype._addToCache = function addToCache(tileX, tileY, fetchData) {
    var levelCache = this._gridFetcherBaseCache[fetchData.imagePartParams.level];
    if (!levelCache) {
        levelCache = [];
        this._gridFetcherBaseCache[fetchData.imagePartParams.level] = levelCache;
    }
    
    var xCache = levelCache[tileX];
    if (!xCache) {
        xCache = [];
        levelCache[tileX] = xCache;
    }
    
    var tileContext = xCache[tileY];
    var isNew = false;
    if (!tileContext) {
        tileContext = {
            dependFetches: new LinkedList(),
            stopListeners: [],
            resumeListeners: [],
            tileState: TILE_STATE_ACTIVE
        };
        xCache[tileY] = tileContext;
        ++fetchData.activeTilesCountWithSingleListener;
        isNew = true;
    }
    
    fetchData.tileListeners.push({
        tileContext: tileContext,
        iterator: tileContext.dependFetches.add(fetchData)
    });
    return isNew ? tileContext : null;
};
},{"grid-image-base.js":24,"linked-list.js":14,"simple-fetcher-base.js":26}],24:[function(require,module,exports){
'use strict';

var GridLevelCalculator = require('grid-level-calculator.js');

module.exports = GridImageBase;

/* global Promise: false */

var FETCH_WAIT_TASK = 0;
var DECODE_TASK = 1;

function GridImageBase(fetcher) {
    this._fetcher = fetcher;
    this._imageParams = null;
    this._waitingFetches = {};
    this._levelCalculator = null;
}

GridImageBase.prototype.opened = function opened(imageDecoder) {
    this._imageParams = imageDecoder.getImageParams();
    imageDecoder.onFetcherEvent('data', this._onDataFetched.bind(this));
    imageDecoder.onFetcherEvent('tile-terminated', this._onTileTerminated.bind(this));
};

GridImageBase.prototype.getLevelCalculator = function getLevelCalculator() {
    if (this._levelCalculator === null) {
        this._levelCalculator = new GridLevelCalculator(this._imageParams);
    }
    return this._levelCalculator;
};

GridImageBase.prototype.getDecodeWorkerTypeOptions = function getDecodeWorkerTypeOptions() {
    throw 'imageDecoderFramework error: GridImageBase.getDecodeWorkerTypeOptions is not implemented by inheritor';
};

GridImageBase.prototype.getDecoderWorkersInputRetreiver = function getDecoderWorkersInputRetreiver() {
    return this;
};

GridImageBase.prototype.decodeTaskStarted = function decodeTaskStarted(task) {
    var self = this;
    task.on('allDependTasksTerminated', function() {
        self.dataReadyForDecode(task);
        task.terminate();
    });
};

GridImageBase.prototype.dataReadyForDecode = function dataReadyForDecode(task) {
    task.dataReady({
        tileContents: task.dependTaskResults,
        tileIndices: task.dependTaskKeys,
        imagePartParams: task.key,
        tileWidth: this._imageParams.tileWidth,
        tileHeight: this._imageParams.tileHeight
    }, DECODE_TASK, /*canSkip=*/true);
};

GridImageBase.prototype.getFetcher = function getFetcher() {
    return this._fetcher;
};

// DependencyWorkersInputRetreiver implementation

GridImageBase.prototype.getWorkerTypeOptions = function(taskType) {
    if (taskType === FETCH_WAIT_TASK) {
        return null;
    } else if (taskType === DECODE_TASK) {
        return this.getDecodeWorkerTypeOptions();
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

GridImageBase.prototype.taskStarted = function(task) {    
    var self = this;
    
    if (task.key.fetchWaitTask) {
        var strKey = this.getKeyAsString(task.key);
        this._waitingFetches[strKey] = task;
        return;
    }

    if (this._imageParams === null) {
        this._imageParams = this.getImageParams(); // imageParams that returned by fetcher.open()
    }

    var imagePartParams = task.key;
    var tilesRange = GridImageBase.getTilesRange(this._imageParams, imagePartParams);
    
    var i = 0;
    for (var tileX = tilesRange.minTileX; tileX < tilesRange.maxTileX; ++tileX) {
        for (var tileY = tilesRange.minTileY; tileY < tilesRange.maxTileY; ++tileY) {
            task.registerTaskDependency({
                fetchWaitTask: true,
                tileX: tileX,
                tileY: tileY,
                level: imagePartParams.level
            });
        }
    }
    
    this.decodeTaskStarted(task);
};

// Auxiliary methods

GridImageBase.prototype._onDataFetched = function(fetchedTile) {
    var strKey = this.getKeyAsString(fetchedTile.tileKey);
    var waitingTask = this._waitingFetches[strKey];
    if (waitingTask) {
        waitingTask.dataReady(fetchedTile.tileContent, FETCH_WAIT_TASK);
    }
};

GridImageBase.prototype._onTileTerminated = function(tileKey) {
    var strKey = this.getKeyAsString(tileKey);
    var waitingTask = this._waitingFetches[strKey];
    if (waitingTask) {
        waitingTask.terminate();
        this._waitingFetches[strKey] = null;
    }
};

GridImageBase.getTilesRange = function(imageParams, imagePartParams) {
    var levelWidth  = imageParams.imageWidth  * Math.pow(2, imagePartParams.level - imageParams.imageLevel);
    var levelHeight = imageParams.imageHeight * Math.pow(2, imagePartParams.level - imageParams.imageLevel);
    var levelTilesX = Math.ceil(levelWidth  / imageParams.tileWidth );
    var levelTilesY = Math.ceil(levelHeight / imageParams.tileHeight);
    return {
        minTileX: Math.max(0, Math.floor(imagePartParams.minX / imageParams.tileWidth )),
        minTileY: Math.max(0, Math.floor(imagePartParams.minY / imageParams.tileHeight)),
        maxTileX: Math.min(levelTilesX, Math.ceil(imagePartParams.maxXExclusive / imageParams.tileWidth )),
        maxTileY: Math.min(levelTilesY, Math.ceil(imagePartParams.maxYExclusive / imageParams.tileHeight))
    };
};

},{"grid-level-calculator.js":25}],25:[function(require,module,exports){
'use strict';

module.exports = GridLevelCalculator;

function GridLevelCalculator(imageParams) {
    this._imageParams = imageParams;
}

GridLevelCalculator.prototype.getLevelWidth = function getLevelWidth(level) {
    var width = this._imageParams.imageWidth * Math.pow(2, level - this._imageParams.imageLevel);
    return width;
};

GridLevelCalculator.prototype.getLevelHeight = function getLevelHeight(level) {
    var height =  this._imageParams.imageHeight * Math.pow(2, level - this._imageParams.imageLevel);
    return height;
};

GridLevelCalculator.prototype.getLevel = function getLevel(regionImageLevel) {
    var log2 = Math.log(2);
    var levelX = Math.log(regionImageLevel.screenWidth  / (regionImageLevel.maxXExclusive - regionImageLevel.minX)) / log2;
    var levelY = Math.log(regionImageLevel.screenHeight / (regionImageLevel.maxYExclusive - regionImageLevel.minY)) / log2;
    var level = Math.ceil(Math.min(levelX, levelY));
    level += this._imageParams.imageLevel;
    
    return level;
};

},{}],26:[function(require,module,exports){
'use strict';

var SimpleMovableFetch = require('simple-movable-fetch.js');

module.exports = SimpleFetcherBase;

/* global Promise: false */

function SimpleFetcherBase(options) {
    this._maxActiveFetchesInMovableFetch = (options || {}).maxActiveFetchesInMovableFetch || 2;
    this._indirectCloseIndication = { isCloseRequested: false };
}

SimpleFetcherBase.prototype.startMovableFetch = function startMovableFetch(fetchContext, imagePartParams) {
    var movableFetch = new SimpleMovableFetch(
        this, this._indirectCloseIndication, fetchContext, this._maxActiveFetchesInMovableFetch);
    
    movableFetch.start(imagePartParams);
};

SimpleFetcherBase.prototype.close = function close() {
    if (this.startMovableFetch !== SimpleFetcherBase.prototype.startMovableFetch) {
        throw 'imageDecoderFramework error: Must override Fetcher.close() when Fetcher.startMovableFetch() was overriden';
    }
    this._indirectCloseIndication.isCloseRequested = true;
    return Promise.resolve();
};
},{"simple-movable-fetch.js":27}],27:[function(require,module,exports){
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
},{"fetch-context-api.js":8}]},{},[5])(5)
});
//# sourceMappingURL=data:application/json;charset:utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJzcmMvY2VzaXVtLWltYWdlLWRlY29kZXIvY2FudmFzLWltYWdlcnktcHJvdmlkZXIuanMiLCJzcmMvY2VzaXVtLWltYWdlLWRlY29kZXIvY2VzaXVtLWZydXN0dW0tY2FsY3VsYXRvci5qcyIsInNyYy9jZXNpdW0taW1hZ2UtZGVjb2Rlci9jZXNpdW0taW1hZ2UtZGVjb2Rlci1sYXllci1tYW5hZ2VyLmpzIiwic3JjL2Nlc2l1bS1pbWFnZS1kZWNvZGVyL2ltYWdlLWRlY29kZXItaW1hZ2VyeS1wcm92aWRlci5qcyIsInNyYy9pbWFnZS1kZWNvZGVyLWV4cG9ydHMuanMiLCJzcmMvaW1hZ2UtZGVjb2Rlci9pbWFnZS1kZWNvZGVyLWhlbHBlcnMvZGVjb2RlLWpvYi5qcyIsInNyYy9pbWFnZS1kZWNvZGVyL2ltYWdlLWRlY29kZXItaGVscGVycy9kZWNvZGUtam9icy1wb29sLmpzIiwic3JjL2ltYWdlLWRlY29kZXIvaW1hZ2UtZGVjb2Rlci1oZWxwZXJzL2ZldGNoLWNvbnRleHQtYXBpLmpzIiwic3JjL2ltYWdlLWRlY29kZXIvaW1hZ2UtZGVjb2Rlci1oZWxwZXJzL2ZldGNoLWNvbnRleHQuanMiLCJzcmMvaW1hZ2UtZGVjb2Rlci9pbWFnZS1kZWNvZGVyLWhlbHBlcnMvZmV0Y2gtbWFuYWdlci5qcyIsInNyYy9pbWFnZS1kZWNvZGVyL2ltYWdlLWRlY29kZXItaGVscGVycy9mZXRjaGVyLWNsb3Nlci5qcyIsInNyYy9pbWFnZS1kZWNvZGVyL2ltYWdlLWRlY29kZXItaGVscGVycy9mcnVzdHVtLXJlcXVlc3RzLXByaW9yaXRpemVyLmpzIiwic3JjL2ltYWdlLWRlY29kZXIvaW1hZ2UtZGVjb2Rlci1oZWxwZXJzL2ltYWdlLWhlbHBlci1mdW5jdGlvbnMuanMiLCJzcmMvaW1hZ2UtZGVjb2Rlci9pbWFnZS1kZWNvZGVyLWhlbHBlcnMvbGlua2VkLWxpc3QuanMiLCJzcmMvaW1hZ2UtZGVjb2Rlci9pbWFnZS1kZWNvZGVyLXZpZXdlci5qcyIsInNyYy9pbWFnZS1kZWNvZGVyL2ltYWdlLWRlY29kZXItd29ya2Vycy9pbWFnZS1wYXJhbXMtcmV0cmlldmVyLXByb3h5LmpzIiwic3JjL2ltYWdlLWRlY29kZXIvaW1hZ2UtZGVjb2Rlci13b3JrZXJzL3dvcmtlci1wcm94eS1mZXRjaC1tYW5hZ2VyLmpzIiwic3JjL2ltYWdlLWRlY29kZXIvaW1hZ2UtZGVjb2Rlci13b3JrZXJzL3dvcmtlci1wcm94eS1pbWFnZS1kZWNvZGVyLmpzIiwic3JjL2ltYWdlLWRlY29kZXIvaW1hZ2UtZGVjb2Rlci5qcyIsInNyYy9sZWFmbGV0LWltYWdlLWRlY29kZXIvaW1hZ2UtZGVjb2Rlci1yZWdpb24tbGF5ZXIuanMiLCJzcmMvbGVhZmxldC1pbWFnZS1kZWNvZGVyL2xlYWZsZXQtZnJ1c3R1bS1jYWxjdWxhdG9yLmpzIiwic3JjL3NpbXBsZS1mZXRjaGVyL2dyaWQtZGVjb2Rlci13b3JrZXItYmFzZS5qcyIsInNyYy9zaW1wbGUtZmV0Y2hlci9ncmlkLWZldGNoZXItYmFzZS5qcyIsInNyYy9zaW1wbGUtZmV0Y2hlci9ncmlkLWltYWdlLWJhc2UuanMiLCJzcmMvc2ltcGxlLWZldGNoZXIvZ3JpZC1sZXZlbC1jYWxjdWxhdG9yLmpzIiwic3JjL3NpbXBsZS1mZXRjaGVyL3NpbXBsZS1mZXRjaGVyLWJhc2UuanMiLCJzcmMvc2ltcGxlLWZldGNoZXIvc2ltcGxlLW1vdmFibGUtZmV0Y2guanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7QUNBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdFVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzFGQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2pKQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDOWtCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNsQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN0SkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzVDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDelVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN0T0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdkNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDektBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzdSQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDckdBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3RuQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDakZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN4REE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3pJQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNsV0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMvS0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNuQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNqREE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDM1FBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMvSUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDM0JBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMxQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSIsImZpbGUiOiJnZW5lcmF0ZWQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlc0NvbnRlbnQiOlsiKGZ1bmN0aW9uIGUodCxuLHIpe2Z1bmN0aW9uIHMobyx1KXtpZighbltvXSl7aWYoIXRbb10pe3ZhciBhPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7aWYoIXUmJmEpcmV0dXJuIGEobywhMCk7aWYoaSlyZXR1cm4gaShvLCEwKTt2YXIgZj1uZXcgRXJyb3IoXCJDYW5ub3QgZmluZCBtb2R1bGUgJ1wiK28rXCInXCIpO3Rocm93IGYuY29kZT1cIk1PRFVMRV9OT1RfRk9VTkRcIixmfXZhciBsPW5bb109e2V4cG9ydHM6e319O3Rbb11bMF0uY2FsbChsLmV4cG9ydHMsZnVuY3Rpb24oZSl7dmFyIG49dFtvXVsxXVtlXTtyZXR1cm4gcyhuP246ZSl9LGwsbC5leHBvcnRzLGUsdCxuLHIpfXJldHVybiBuW29dLmV4cG9ydHN9dmFyIGk9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtmb3IodmFyIG89MDtvPHIubGVuZ3RoO28rKylzKHJbb10pO3JldHVybiBzfSkiLCIndXNlIHN0cmljdCc7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IENhbnZhc0ltYWdlcnlQcm92aWRlcjtcclxuXHJcbi8qIGdsb2JhbCBDZXNpdW06IGZhbHNlICovXHJcbi8qIGdsb2JhbCBEZXZlbG9wZXJFcnJvcjogZmFsc2UgKi9cclxuLyogZ2xvYmFsIENyZWRpdDogZmFsc2UgKi9cclxuXHJcbi8qKlxyXG4gKiBQcm92aWRlcyBhIFNpbmdsZSBDYW52YXMgaW1hZ2VyeSB0aWxlLiAgVGhlIGltYWdlIGlzIGFzc3VtZWQgdG8gdXNlIGFcclxuICoge0BsaW5rIEdlb2dyYXBoaWNUaWxpbmdTY2hlbWV9LlxyXG4gKlxyXG4gKiBAYWxpYXMgQ2FudmFzSW1hZ2VyeVByb3ZpZGVyXHJcbiAqIEBjb25zdHJ1Y3RvclxyXG4gKlxyXG4gKiBAcGFyYW0ge2NhbnZhc30gQ2FudmFzIGZvciB0aGUgdGlsZS5cclxuICogQHBhcmFtIHtPYmplY3R9IG9wdGlvbnMgT2JqZWN0IHdpdGggdGhlIGZvbGxvd2luZyBwcm9wZXJ0aWVzOlxyXG4gKiBAcGFyYW0ge0NyZWRpdHxTdHJpbmd9IFtvcHRpb25zLmNyZWRpdF0gQSBjcmVkaXQgZm9yIHRoZSBkYXRhIHNvdXJjZSwgd2hpY2ggaXMgZGlzcGxheWVkIG9uIHRoZSBjYW52YXMuXHJcbiAqXHJcbiAqIEBzZWUgQXJjR2lzTWFwU2VydmVySW1hZ2VyeVByb3ZpZGVyXHJcbiAqIEBzZWUgQmluZ01hcHNJbWFnZXJ5UHJvdmlkZXJcclxuICogQHNlZSBHb29nbGVFYXJ0aEltYWdlcnlQcm92aWRlclxyXG4gKiBAc2VlIE9wZW5TdHJlZXRNYXBJbWFnZXJ5UHJvdmlkZXJcclxuICogQHNlZSBUaWxlTWFwU2VydmljZUltYWdlcnlQcm92aWRlclxyXG4gKiBAc2VlIFdlYk1hcFNlcnZpY2VJbWFnZXJ5UHJvdmlkZXJcclxuICovXHJcbmZ1bmN0aW9uIENhbnZhc0ltYWdlcnlQcm92aWRlcihjYW52YXMsIG9wdGlvbnMpIHtcclxuICAgIGlmIChvcHRpb25zID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICBvcHRpb25zID0ge307XHJcbiAgICB9XHJcblxyXG4gICAgLy8+PmluY2x1ZGVTdGFydCgnZGVidWcnLCBwcmFnbWFzLmRlYnVnKTtcclxuICAgIGlmIChjYW52YXMgPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIHRocm93IG5ldyBEZXZlbG9wZXJFcnJvcignY2FudmFzIGlzIHJlcXVpcmVkLicpO1xyXG4gICAgfVxyXG4gICAgLy8+PmluY2x1ZGVFbmQoJ2RlYnVnJyk7XHJcblxyXG4gICAgdGhpcy5fY2FudmFzID0gY2FudmFzO1xyXG5cclxuICAgIHRoaXMuX2Vycm9yRXZlbnQgPSBuZXcgRXZlbnQoJ0NhbnZhc0ltYWdlcnlQcm92aWRlclN0YXR1cycpO1xyXG5cclxuICAgIHRoaXMuX3JlYWR5ID0gZmFsc2U7XHJcblxyXG4gICAgdmFyIGNyZWRpdCA9IG9wdGlvbnMuY3JlZGl0O1xyXG4gICAgaWYgKHR5cGVvZiBjcmVkaXQgPT09ICdzdHJpbmcnKSB7XHJcbiAgICAgICAgY3JlZGl0ID0gbmV3IENyZWRpdChjcmVkaXQpO1xyXG4gICAgfVxyXG4gICAgdGhpcy5fY3JlZGl0ID0gY3JlZGl0O1xyXG59XHJcblxyXG5DYW52YXNJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlID0ge1xyXG4gICAgLyoqXHJcbiAgICAgKiBHZXRzIHRoZSB3aWR0aCBvZiBlYWNoIHRpbGUsIGluIHBpeGVscy4gVGhpcyBmdW5jdGlvbiBzaG91bGRcclxuICAgICAqIG5vdCBiZSBjYWxsZWQgYmVmb3JlIHtAbGluayBDYW52YXNJbWFnZXJ5UHJvdmlkZXIjcmVhZHl9IHJldHVybnMgdHJ1ZS5cclxuICAgICAqIEBtZW1iZXJvZiBDYW52YXNJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlXHJcbiAgICAgKiBAdHlwZSB7TnVtYmVyfVxyXG4gICAgICogQHJlYWRvbmx5XHJcbiAgICAgKi9cclxuICAgIGdldCB0aWxlV2lkdGgoKSB7XHJcbiAgICAgICAgICAgIC8vPj5pbmNsdWRlU3RhcnQoJ2RlYnVnJywgcHJhZ21hcy5kZWJ1Zyk7XHJcbiAgICAgICAgICAgIGlmICghdGhpcy5fcmVhZHkpIHtcclxuICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRGV2ZWxvcGVyRXJyb3IoJ3RpbGVXaWR0aCBtdXN0IG5vdCBiZSBjYWxsZWQgYmVmb3JlIHRoZSBpbWFnZXJ5IHByb3ZpZGVyIGlzIHJlYWR5LicpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIC8vPj5pbmNsdWRlRW5kKCdkZWJ1ZycpO1xyXG5cclxuICAgICAgICAgICAgcmV0dXJuIHRoaXMuX2NhbnZhcy53aWR0aDtcclxuICAgIH0sXHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZXRzIHRoZSBoZWlnaHQgb2YgZWFjaCB0aWxlLCBpbiBwaXhlbHMuICBUaGlzIGZ1bmN0aW9uIHNob3VsZFxyXG4gICAgICogbm90IGJlIGNhbGxlZCBiZWZvcmUge0BsaW5rIENhbnZhc0ltYWdlcnlQcm92aWRlciNyZWFkeX0gcmV0dXJucyB0cnVlLlxyXG4gICAgICogQG1lbWJlcm9mIENhbnZhc0ltYWdlcnlQcm92aWRlci5wcm90b3R5cGVcclxuICAgICAqIEB0eXBlIHtOdW1iZXJ9XHJcbiAgICAgKiBAcmVhZG9ubHlcclxuICAgICAqL1xyXG4gICAgZ2V0IHRpbGVIZWlnaHQoKSB7XHJcbiAgICAgICAgICAgIC8vPj5pbmNsdWRlU3RhcnQoJ2RlYnVnJywgcHJhZ21hcy5kZWJ1Zyk7XHJcbiAgICAgICAgICAgIGlmICghdGhpcy5fcmVhZHkpIHtcclxuICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRGV2ZWxvcGVyRXJyb3IoJ3RpbGVIZWlnaHQgbXVzdCBub3QgYmUgY2FsbGVkIGJlZm9yZSB0aGUgaW1hZ2VyeSBwcm92aWRlciBpcyByZWFkeS4nKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAvLz4+aW5jbHVkZUVuZCgnZGVidWcnKTtcclxuXHJcbiAgICAgICAgICAgIHJldHVybiB0aGlzLl9jYW52YXMuaGVpZ2h0O1xyXG4gICAgfSxcclxuXHJcbiAgICAvKipcclxuICAgICAqIEdldHMgdGhlIG1heGltdW0gbGV2ZWwtb2YtZGV0YWlsIHRoYXQgY2FuIGJlIHJlcXVlc3RlZC4gIFRoaXMgZnVuY3Rpb24gc2hvdWxkXHJcbiAgICAgKiBub3QgYmUgY2FsbGVkIGJlZm9yZSB7QGxpbmsgQ2FudmFzSW1hZ2VyeVByb3ZpZGVyI3JlYWR5fSByZXR1cm5zIHRydWUuXHJcbiAgICAgKiBAbWVtYmVyb2YgQ2FudmFzSW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZVxyXG4gICAgICogQHR5cGUge051bWJlcn1cclxuICAgICAqIEByZWFkb25seVxyXG4gICAgICovXHJcbiAgICBnZXQgbWF4aW11bUxldmVsKCkge1xyXG4gICAgICAgICAgICAvLz4+aW5jbHVkZVN0YXJ0KCdkZWJ1ZycsIHByYWdtYXMuZGVidWcpO1xyXG4gICAgICAgICAgICBpZiAoIXRoaXMuX3JlYWR5KSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IERldmVsb3BlckVycm9yKCdtYXhpbXVtTGV2ZWwgbXVzdCBub3QgYmUgY2FsbGVkIGJlZm9yZSB0aGUgaW1hZ2VyeSBwcm92aWRlciBpcyByZWFkeS4nKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAvLz4+aW5jbHVkZUVuZCgnZGVidWcnKTtcclxuXHJcbiAgICAgICAgICAgIHJldHVybiAwO1xyXG4gICAgfSxcclxuXHJcbiAgICAvKipcclxuICAgICAqIEdldHMgdGhlIG1pbmltdW0gbGV2ZWwtb2YtZGV0YWlsIHRoYXQgY2FuIGJlIHJlcXVlc3RlZC4gIFRoaXMgZnVuY3Rpb24gc2hvdWxkXHJcbiAgICAgKiBub3QgYmUgY2FsbGVkIGJlZm9yZSB7QGxpbmsgQ2FudmFzSW1hZ2VyeVByb3ZpZGVyI3JlYWR5fSByZXR1cm5zIHRydWUuXHJcbiAgICAgKiBAbWVtYmVyb2YgQ2FudmFzSW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZVxyXG4gICAgICogQHR5cGUge051bWJlcn1cclxuICAgICAqIEByZWFkb25seVxyXG4gICAgICovXHJcbiAgICBnZXQgbWluaW11bUxldmVsKCkge1xyXG4gICAgICAgICAgICAvLz4+aW5jbHVkZVN0YXJ0KCdkZWJ1ZycsIHByYWdtYXMuZGVidWcpO1xyXG4gICAgICAgICAgICBpZiAoIXRoaXMuX3JlYWR5KSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IERldmVsb3BlckVycm9yKCdtaW5pbXVtTGV2ZWwgbXVzdCBub3QgYmUgY2FsbGVkIGJlZm9yZSB0aGUgaW1hZ2VyeSBwcm92aWRlciBpcyByZWFkeS4nKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAvLz4+aW5jbHVkZUVuZCgnZGVidWcnKTtcclxuXHJcbiAgICAgICAgICAgIHJldHVybiAwO1xyXG4gICAgfSxcclxuXHJcbiAgICAvKipcclxuICAgICAqIEdldHMgdGhlIHRpbGluZyBzY2hlbWUgdXNlZCBieSB0aGlzIHByb3ZpZGVyLiAgVGhpcyBmdW5jdGlvbiBzaG91bGRcclxuICAgICAqIG5vdCBiZSBjYWxsZWQgYmVmb3JlIHtAbGluayBDYW52YXNJbWFnZXJ5UHJvdmlkZXIjcmVhZHl9IHJldHVybnMgdHJ1ZS5cclxuICAgICAqIEBtZW1iZXJvZiBDYW52YXNJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlXHJcbiAgICAgKiBAdHlwZSB7VGlsaW5nU2NoZW1lfVxyXG4gICAgICogQHJlYWRvbmx5XHJcbiAgICAgKi9cclxuICAgIGdldCB0aWxpbmdTY2hlbWUoKSB7XHJcbiAgICAgICAgICAgIC8vPj5pbmNsdWRlU3RhcnQoJ2RlYnVnJywgcHJhZ21hcy5kZWJ1Zyk7XHJcbiAgICAgICAgICAgIGlmICghdGhpcy5fcmVhZHkpIHtcclxuICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRGV2ZWxvcGVyRXJyb3IoJ3RpbGluZ1NjaGVtZSBtdXN0IG5vdCBiZSBjYWxsZWQgYmVmb3JlIHRoZSBpbWFnZXJ5IHByb3ZpZGVyIGlzIHJlYWR5LicpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIC8vPj5pbmNsdWRlRW5kKCdkZWJ1ZycpO1xyXG5cclxuICAgICAgICAgICAgcmV0dXJuIHRoaXMuX3RpbGluZ1NjaGVtZTtcclxuICAgIH0sXHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZXRzIHRoZSByZWN0YW5nbGUsIGluIHJhZGlhbnMsIG9mIHRoZSBpbWFnZXJ5IHByb3ZpZGVkIGJ5IHRoaXMgaW5zdGFuY2UuICBUaGlzIGZ1bmN0aW9uIHNob3VsZFxyXG4gICAgICogbm90IGJlIGNhbGxlZCBiZWZvcmUge0BsaW5rIENhbnZhc0ltYWdlcnlQcm92aWRlciNyZWFkeX0gcmV0dXJucyB0cnVlLlxyXG4gICAgICogQG1lbWJlcm9mIENhbnZhc0ltYWdlcnlQcm92aWRlci5wcm90b3R5cGVcclxuICAgICAqIEB0eXBlIHtSZWN0YW5nbGV9XHJcbiAgICAgKiBAcmVhZG9ubHlcclxuICAgICAqL1xyXG4gICAgZ2V0IHJlY3RhbmdsZSgpIHtcclxuICAgICAgICAgICAgcmV0dXJuIHRoaXMuX3RpbGluZ1NjaGVtZS5yZWN0YW5nbGU7XHJcbiAgICB9LFxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2V0cyB0aGUgdGlsZSBkaXNjYXJkIHBvbGljeS4gIElmIG5vdCB1bmRlZmluZWQsIHRoZSBkaXNjYXJkIHBvbGljeSBpcyByZXNwb25zaWJsZVxyXG4gICAgICogZm9yIGZpbHRlcmluZyBvdXQgXCJtaXNzaW5nXCIgdGlsZXMgdmlhIGl0cyBzaG91bGREaXNjYXJkSW1hZ2UgZnVuY3Rpb24uICBJZiB0aGlzIGZ1bmN0aW9uXHJcbiAgICAgKiByZXR1cm5zIHVuZGVmaW5lZCwgbm8gdGlsZXMgYXJlIGZpbHRlcmVkLiAgVGhpcyBmdW5jdGlvbiBzaG91bGRcclxuICAgICAqIG5vdCBiZSBjYWxsZWQgYmVmb3JlIHtAbGluayBDYW52YXNJbWFnZXJ5UHJvdmlkZXIjcmVhZHl9IHJldHVybnMgdHJ1ZS5cclxuICAgICAqIEBtZW1iZXJvZiBDYW52YXNJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlXHJcbiAgICAgKiBAdHlwZSB7VGlsZURpc2NhcmRQb2xpY3l9XHJcbiAgICAgKiBAcmVhZG9ubHlcclxuICAgICAqL1xyXG4gICAgZ2V0IHRpbGVEaXNjYXJkUG9saWN5KCkge1xyXG4gICAgICAgICAgICAvLz4+aW5jbHVkZVN0YXJ0KCdkZWJ1ZycsIHByYWdtYXMuZGVidWcpO1xyXG4gICAgICAgICAgICBpZiAoIXRoaXMuX3JlYWR5KSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IERldmVsb3BlckVycm9yKCd0aWxlRGlzY2FyZFBvbGljeSBtdXN0IG5vdCBiZSBjYWxsZWQgYmVmb3JlIHRoZSBpbWFnZXJ5IHByb3ZpZGVyIGlzIHJlYWR5LicpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIC8vPj5pbmNsdWRlRW5kKCdkZWJ1ZycpO1xyXG5cclxuICAgICAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcclxuICAgIH0sXHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZXRzIGFuIGV2ZW50IHRoYXQgaXMgcmFpc2VkIHdoZW4gdGhlIGltYWdlcnkgcHJvdmlkZXIgZW5jb3VudGVycyBhbiBhc3luY2hyb25vdXMgZXJyb3IuICBCeSBzdWJzY3JpYmluZ1xyXG4gICAgICogdG8gdGhlIGV2ZW50LCB5b3Ugd2lsbCBiZSBub3RpZmllZCBvZiB0aGUgZXJyb3IgYW5kIGNhbiBwb3RlbnRpYWxseSByZWNvdmVyIGZyb20gaXQuICBFdmVudCBsaXN0ZW5lcnNcclxuICAgICAqIGFyZSBwYXNzZWQgYW4gaW5zdGFuY2Ugb2Yge0BsaW5rIFRpbGVQcm92aWRlckVycm9yfS5cclxuICAgICAqIEBtZW1iZXJvZiBDYW52YXNJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlXHJcbiAgICAgKiBAdHlwZSB7RXZlbnR9XHJcbiAgICAgKiBAcmVhZG9ubHlcclxuICAgICAqL1xyXG4gICAgZ2V0IGVycm9yRXZlbnQoKSB7XHJcbiAgICAgICAgICAgIHJldHVybiB0aGlzLl9lcnJvckV2ZW50O1xyXG4gICAgfSxcclxuXHJcbiAgICAvKipcclxuICAgICAqIEdldHMgYSB2YWx1ZSBpbmRpY2F0aW5nIHdoZXRoZXIgb3Igbm90IHRoZSBwcm92aWRlciBpcyByZWFkeSBmb3IgdXNlLlxyXG4gICAgICogQG1lbWJlcm9mIENhbnZhc0ltYWdlcnlQcm92aWRlci5wcm90b3R5cGVcclxuICAgICAqIEB0eXBlIHtCb29sZWFufVxyXG4gICAgICogQHJlYWRvbmx5XHJcbiAgICAgKi9cclxuICAgIGdldCByZWFkeSgpIHtcclxuICAgICAgICAgICAgcmV0dXJuIHRoaXMuX3JlYWR5O1xyXG4gICAgfSxcclxuXHJcbiAgICAvKipcclxuICAgICAqIEdldHMgdGhlIGNyZWRpdCB0byBkaXNwbGF5IHdoZW4gdGhpcyBpbWFnZXJ5IHByb3ZpZGVyIGlzIGFjdGl2ZS4gIFR5cGljYWxseSB0aGlzIGlzIHVzZWQgdG8gY3JlZGl0XHJcbiAgICAgKiB0aGUgc291cmNlIG9mIHRoZSBpbWFnZXJ5LiAgVGhpcyBmdW5jdGlvbiBzaG91bGQgbm90IGJlIGNhbGxlZCBiZWZvcmUge0BsaW5rIENhbnZhc0ltYWdlcnlQcm92aWRlciNyZWFkeX0gcmV0dXJucyB0cnVlLlxyXG4gICAgICogQG1lbWJlcm9mIENhbnZhc0ltYWdlcnlQcm92aWRlci5wcm90b3R5cGVcclxuICAgICAqIEB0eXBlIHtDcmVkaXR9XHJcbiAgICAgKiBAcmVhZG9ubHlcclxuICAgICAqL1xyXG4gICAgZ2V0IGNyZWRpdCgpIHtcclxuICAgICAgICAgICAgcmV0dXJuIHRoaXMuX2NyZWRpdDtcclxuICAgIH0sXHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZXRzIGEgdmFsdWUgaW5kaWNhdGluZyB3aGV0aGVyIG9yIG5vdCB0aGUgaW1hZ2VzIHByb3ZpZGVkIGJ5IHRoaXMgaW1hZ2VyeSBwcm92aWRlclxyXG4gICAgICogaW5jbHVkZSBhbiBhbHBoYSBjaGFubmVsLiAgSWYgdGhpcyBwcm9wZXJ0eSBpcyBmYWxzZSwgYW4gYWxwaGEgY2hhbm5lbCwgaWYgcHJlc2VudCwgd2lsbFxyXG4gICAgICogYmUgaWdub3JlZC4gIElmIHRoaXMgcHJvcGVydHkgaXMgdHJ1ZSwgYW55IGltYWdlcyB3aXRob3V0IGFuIGFscGhhIGNoYW5uZWwgd2lsbCBiZSB0cmVhdGVkXHJcbiAgICAgKiBhcyBpZiB0aGVpciBhbHBoYSBpcyAxLjAgZXZlcnl3aGVyZS4gIFdoZW4gdGhpcyBwcm9wZXJ0eSBpcyBmYWxzZSwgbWVtb3J5IHVzYWdlXHJcbiAgICAgKiBhbmQgdGV4dHVyZSB1cGxvYWQgdGltZSBhcmUgcmVkdWNlZC5cclxuICAgICAqIEBtZW1iZXJvZiBDYW52YXNJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlXHJcbiAgICAgKiBAdHlwZSB7Qm9vbGVhbn1cclxuICAgICAqIEByZWFkb25seVxyXG4gICAgICovXHJcbiAgICBnZXQgaGFzQWxwaGFDaGFubmVsKCkge1xyXG4gICAgICAgICAgICByZXR1cm4gdHJ1ZTtcclxuICAgIH1cclxufTtcclxuXHJcbkNhbnZhc0ltYWdlcnlQcm92aWRlci5wcm90b3R5cGUuc2V0UmVjdGFuZ2xlID0gZnVuY3Rpb24gc2V0UmVjdGFuZ2xlKHJlY3RhbmdsZSkge1xyXG4gICAgXHJcbiAgICB0aGlzLl90aWxpbmdTY2hlbWUgPSBuZXcgQ2VzaXVtLkdlb2dyYXBoaWNUaWxpbmdTY2hlbWUoe1xyXG4gICAgICAgIHJlY3RhbmdsZTogcmVjdGFuZ2xlLFxyXG4gICAgICAgIG51bWJlck9mTGV2ZWxaZXJvVGlsZXNYOiAxLFxyXG4gICAgICAgIG51bWJlck9mTGV2ZWxaZXJvVGlsZXNZOiAxXHJcbiAgICB9KTtcclxuICAgIFxyXG4gICAgaWYgKCF0aGlzLl9yZWFkeSkge1xyXG4gICAgICAgIHRoaXMuX3JlYWR5ID0gdHJ1ZTtcclxuICAgICAgICBDZXNpdW0uVGlsZVByb3ZpZGVyRXJyb3IuaGFuZGxlU3VjY2Vzcyh0aGlzLl9lcnJvckV2ZW50KTtcclxuICAgIH1cclxufTtcclxuXHJcbkNhbnZhc0ltYWdlcnlQcm92aWRlci5wcm90b3R5cGUuZ2V0VGlsZVdpZHRoID0gZnVuY3Rpb24gZ2V0VGlsZVdpZHRoKCkge1xyXG4gICAgcmV0dXJuIHRoaXMudGlsZVdpZHRoO1xyXG59O1xyXG5cclxuQ2FudmFzSW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5nZXRUaWxlSGVpZ2h0ID0gZnVuY3Rpb24gZ2V0VGlsZUhlaWdodCgpIHtcclxuICAgIHJldHVybiB0aGlzLnRpbGVIZWlnaHQ7XHJcbn07XHJcblxyXG5DYW52YXNJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlLmdldE1heGltdW1MZXZlbCA9IGZ1bmN0aW9uIGdldE1heGltdW1MZXZlbCgpIHtcclxuICAgIHJldHVybiB0aGlzLm1heGltdW1MZXZlbDtcclxufTtcclxuXHJcbkNhbnZhc0ltYWdlcnlQcm92aWRlci5wcm90b3R5cGUuZ2V0TWluaW11bUxldmVsID0gZnVuY3Rpb24gZ2V0TWluaW11bUxldmVsKCkge1xyXG4gICAgcmV0dXJuIHRoaXMubWluaW11bUxldmVsO1xyXG59O1xyXG5cclxuQ2FudmFzSW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5pc1JlYWR5ID0gZnVuY3Rpb24gaXNSZWFkeSgpIHtcclxuICAgIHJldHVybiB0aGlzLnJlYWR5O1xyXG59O1xyXG5cclxuQ2FudmFzSW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5nZXRDcmVkaXQgPSBmdW5jdGlvbiBnZXRDcmVkaXQoKSB7XHJcbiAgICByZXR1cm4gdGhpcy5jcmVkaXQ7XHJcbn07XHJcblxyXG5DYW52YXNJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlLmdldFJlY3RhbmdsZSA9IGZ1bmN0aW9uIGdldFJlY3RhbmdsZSgpIHtcclxuICAgIHJldHVybiB0aGlzLnRpbGluZ1NjaGVtZS5yZWN0YW5nbGU7XHJcbn07XHJcblxyXG5DYW52YXNJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlLmdldFRpbGluZ1NjaGVtZSA9IGZ1bmN0aW9uIGdldFRpbGluZ1NjaGVtZSgpIHtcclxuICAgIHJldHVybiB0aGlzLnRpbGluZ1NjaGVtZTtcclxufTtcclxuXHJcbkNhbnZhc0ltYWdlcnlQcm92aWRlci5wcm90b3R5cGUuZ2V0VGlsZURpc2NhcmRQb2xpY3kgPSBmdW5jdGlvbiBnZXRUaWxlRGlzY2FyZFBvbGljeSgpIHtcclxuICAgIHJldHVybiB0aGlzLnRpbGVEaXNjYXJkUG9saWN5O1xyXG59O1xyXG5cclxuQ2FudmFzSW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5nZXRFcnJvckV2ZW50ID0gZnVuY3Rpb24gZ2V0RXJyb3JFdmVudCgpIHtcclxuICAgIHJldHVybiB0aGlzLmVycm9yRXZlbnQ7XHJcbn07XHJcblxyXG5DYW52YXNJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlLmdldEhhc0FscGhhQ2hhbm5lbCA9IGZ1bmN0aW9uIGdldEhhc0FscGhhQ2hhbm5lbCgpIHtcclxuICAgIHJldHVybiB0aGlzLmhhc0FscGhhQ2hhbm5lbDtcclxufTtcclxuXHJcbi8qKlxyXG4gKiBHZXRzIHRoZSBjcmVkaXRzIHRvIGJlIGRpc3BsYXllZCB3aGVuIGEgZ2l2ZW4gdGlsZSBpcyBkaXNwbGF5ZWQuXHJcbiAqXHJcbiAqIEBwYXJhbSB7TnVtYmVyfSB4IFRoZSB0aWxlIFggY29vcmRpbmF0ZS5cclxuICogQHBhcmFtIHtOdW1iZXJ9IHkgVGhlIHRpbGUgWSBjb29yZGluYXRlLlxyXG4gKiBAcGFyYW0ge051bWJlcn0gbGV2ZWwgVGhlIHRpbGUgbGV2ZWw7XHJcbiAqIEByZXR1cm5zIHtDcmVkaXRbXX0gVGhlIGNyZWRpdHMgdG8gYmUgZGlzcGxheWVkIHdoZW4gdGhlIHRpbGUgaXMgZGlzcGxheWVkLlxyXG4gKlxyXG4gKiBAZXhjZXB0aW9uIHtEZXZlbG9wZXJFcnJvcn0gPGNvZGU+Z2V0VGlsZUNyZWRpdHM8L2NvZGU+IG11c3Qgbm90IGJlIGNhbGxlZCBiZWZvcmUgdGhlIGltYWdlcnkgcHJvdmlkZXIgaXMgcmVhZHkuXHJcbiAqL1xyXG5DYW52YXNJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlLmdldFRpbGVDcmVkaXRzID0gZnVuY3Rpb24oeCwgeSwgbGV2ZWwpIHtcclxuICAgIHJldHVybiB1bmRlZmluZWQ7XHJcbn07XHJcblxyXG4vKipcclxuICogUmVxdWVzdHMgdGhlIGltYWdlIGZvciBhIGdpdmVuIHRpbGUuICBUaGlzIGZ1bmN0aW9uIHNob3VsZFxyXG4gKiBub3QgYmUgY2FsbGVkIGJlZm9yZSB7QGxpbmsgQ2FudmFzSW1hZ2VyeVByb3ZpZGVyI3JlYWR5fSByZXR1cm5zIHRydWUuXHJcbiAqXHJcbiAqIEBwYXJhbSB7TnVtYmVyfSB4IFRoZSB0aWxlIFggY29vcmRpbmF0ZS5cclxuICogQHBhcmFtIHtOdW1iZXJ9IHkgVGhlIHRpbGUgWSBjb29yZGluYXRlLlxyXG4gKiBAcGFyYW0ge051bWJlcn0gbGV2ZWwgVGhlIHRpbGUgbGV2ZWwuXHJcbiAqIEByZXR1cm5zIHtQcm9taXNlfSBBIHByb21pc2UgZm9yIHRoZSBpbWFnZSB0aGF0IHdpbGwgcmVzb2x2ZSB3aGVuIHRoZSBpbWFnZSBpcyBhdmFpbGFibGUsIG9yXHJcbiAqICAgICAgICAgIHVuZGVmaW5lZCBpZiB0aGVyZSBhcmUgdG9vIG1hbnkgYWN0aXZlIHJlcXVlc3RzIHRvIHRoZSBzZXJ2ZXIsIGFuZCB0aGUgcmVxdWVzdFxyXG4gKiAgICAgICAgICBzaG91bGQgYmUgcmV0cmllZCBsYXRlci4gIFRoZSByZXNvbHZlZCBpbWFnZSBtYXkgYmUgZWl0aGVyIGFuXHJcbiAqICAgICAgICAgIEltYWdlIG9yIGEgQ2FudmFzIERPTSBvYmplY3QuXHJcbiAqXHJcbiAqIEBleGNlcHRpb24ge0RldmVsb3BlckVycm9yfSA8Y29kZT5yZXF1ZXN0SW1hZ2U8L2NvZGU+IG11c3Qgbm90IGJlIGNhbGxlZCBiZWZvcmUgdGhlIGltYWdlcnkgcHJvdmlkZXIgaXMgcmVhZHkuXHJcbiAqL1xyXG5DYW52YXNJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlLnJlcXVlc3RJbWFnZSA9IGZ1bmN0aW9uKHgsIHksIGxldmVsKSB7XHJcbiAgICAvLz4+aW5jbHVkZVN0YXJ0KCdkZWJ1ZycsIHByYWdtYXMuZGVidWcpO1xyXG4gICAgaWYgKCF0aGlzLl9yZWFkeSkge1xyXG4gICAgICAgICAgICB0aHJvdyBuZXcgRGV2ZWxvcGVyRXJyb3IoJ3JlcXVlc3RJbWFnZSBtdXN0IG5vdCBiZSBjYWxsZWQgYmVmb3JlIHRoZSBpbWFnZXJ5IHByb3ZpZGVyIGlzIHJlYWR5LicpO1xyXG4gICAgfVxyXG4gICAgLy8+PmluY2x1ZGVFbmQoJ2RlYnVnJyk7XHJcblxyXG4gICAgcmV0dXJuIHRoaXMuX2NhbnZhcztcclxufTtcclxuXHJcbi8qKlxyXG4gKiBQaWNraW5nIGZlYXR1cmVzIGlzIG5vdCBjdXJyZW50bHkgc3VwcG9ydGVkIGJ5IHRoaXMgaW1hZ2VyeSBwcm92aWRlciwgc28gdGhpcyBmdW5jdGlvbiBzaW1wbHkgcmV0dXJuc1xyXG4gKiB1bmRlZmluZWQuXHJcbiAqXHJcbiAqIEBwYXJhbSB7TnVtYmVyfSB4IFRoZSB0aWxlIFggY29vcmRpbmF0ZS5cclxuICogQHBhcmFtIHtOdW1iZXJ9IHkgVGhlIHRpbGUgWSBjb29yZGluYXRlLlxyXG4gKiBAcGFyYW0ge051bWJlcn0gbGV2ZWwgVGhlIHRpbGUgbGV2ZWwuXHJcbiAqIEBwYXJhbSB7TnVtYmVyfSBsb25naXR1ZGUgVGhlIGxvbmdpdHVkZSBhdCB3aGljaCB0byBwaWNrIGZlYXR1cmVzLlxyXG4gKiBAcGFyYW0ge051bWJlcn0gbGF0aXR1ZGUgIFRoZSBsYXRpdHVkZSBhdCB3aGljaCB0byBwaWNrIGZlYXR1cmVzLlxyXG4gKiBAcmV0dXJuIHtQcm9taXNlfSBBIHByb21pc2UgZm9yIHRoZSBwaWNrZWQgZmVhdHVyZXMgdGhhdCB3aWxsIHJlc29sdmUgd2hlbiB0aGUgYXN5bmNocm9ub3VzXHJcbiAqICAgICAgICAgICAgICAgICAgIHBpY2tpbmcgY29tcGxldGVzLiAgVGhlIHJlc29sdmVkIHZhbHVlIGlzIGFuIGFycmF5IG9mIHtAbGluayBJbWFnZXJ5TGF5ZXJGZWF0dXJlSW5mb31cclxuICogICAgICAgICAgICAgICAgICAgaW5zdGFuY2VzLiAgVGhlIGFycmF5IG1heSBiZSBlbXB0eSBpZiBubyBmZWF0dXJlcyBhcmUgZm91bmQgYXQgdGhlIGdpdmVuIGxvY2F0aW9uLlxyXG4gKiAgICAgICAgICAgICAgICAgICBJdCBtYXkgYWxzbyBiZSB1bmRlZmluZWQgaWYgcGlja2luZyBpcyBub3Qgc3VwcG9ydGVkLlxyXG4gKi9cclxuQ2FudmFzSW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5waWNrRmVhdHVyZXMgPSBmdW5jdGlvbigpIHtcclxuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xyXG59OyIsIid1c2Ugc3RyaWN0JztcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gY2FsY3VsYXRlRnJ1c3R1bTtcclxuXHJcbi8qIGdsb2JhbCBDZXNpdW06IGZhbHNlICovXHJcblxyXG52YXIgaW1hZ2VIZWxwZXJGdW5jdGlvbnMgPSByZXF1aXJlKCdpbWFnZS1oZWxwZXItZnVuY3Rpb25zLmpzJyk7XHJcblxyXG52YXIgTUFYX1JFQ1VSU0lWRV9MRVZFTF9PTl9GQUlMRURfVFJBTlNGT1JNID0gNDtcclxuXHJcbmZ1bmN0aW9uIGNhbGN1bGF0ZUZydXN0dW0oY2VzaXVtV2lkZ2V0KSB7XHJcbiAgICB2YXIgc2NyZWVuU2l6ZSA9IHtcclxuICAgICAgICB4OiBjZXNpdW1XaWRnZXQuc2NlbmUuY2FudmFzLndpZHRoLFxyXG4gICAgICAgIHk6IGNlc2l1bVdpZGdldC5zY2VuZS5jYW52YXMuaGVpZ2h0XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICB2YXIgcG9pbnRzID0gW107XHJcbiAgICBzZWFyY2hCb3VuZGluZ1BvaW50cyhcclxuICAgICAgICAwLCAwLCBzY3JlZW5TaXplLngsIHNjcmVlblNpemUueSwgcG9pbnRzLCBjZXNpdW1XaWRnZXQsIC8qcmVjdXJzaXZlPSovMCk7XHJcblxyXG4gICAgdmFyIGZydXN0dW1SZWN0YW5nbGUgPSBDZXNpdW0uUmVjdGFuZ2xlLmZyb21DYXJ0b2dyYXBoaWNBcnJheShwb2ludHMpO1xyXG4gICAgaWYgKGZydXN0dW1SZWN0YW5nbGUuZWFzdCA8IGZydXN0dW1SZWN0YW5nbGUud2VzdCB8fCBmcnVzdHVtUmVjdGFuZ2xlLm5vcnRoIDwgZnJ1c3R1bVJlY3RhbmdsZS5zb3V0aCkge1xyXG4gICAgICAgIGZydXN0dW1SZWN0YW5nbGUgPSB7XHJcbiAgICAgICAgICAgIGVhc3Q6IE1hdGgubWF4KGZydXN0dW1SZWN0YW5nbGUuZWFzdCwgZnJ1c3R1bVJlY3RhbmdsZS53ZXN0KSxcclxuICAgICAgICAgICAgd2VzdDogTWF0aC5taW4oZnJ1c3R1bVJlY3RhbmdsZS5lYXN0LCBmcnVzdHVtUmVjdGFuZ2xlLndlc3QpLFxyXG4gICAgICAgICAgICBub3J0aDogTWF0aC5tYXgoZnJ1c3R1bVJlY3RhbmdsZS5ub3J0aCwgZnJ1c3R1bVJlY3RhbmdsZS5zb3V0aCksXHJcbiAgICAgICAgICAgIHNvdXRoOiBNYXRoLm1pbihmcnVzdHVtUmVjdGFuZ2xlLm5vcnRoLCBmcnVzdHVtUmVjdGFuZ2xlLnNvdXRoKVxyXG4gICAgICAgIH07XHJcbiAgICB9XHJcblxyXG4gICAgdmFyIGZydXN0dW1EYXRhID0gaW1hZ2VIZWxwZXJGdW5jdGlvbnMuY2FsY3VsYXRlRnJ1c3R1bTJERnJvbUJvdW5kcyhcclxuICAgICAgICBmcnVzdHVtUmVjdGFuZ2xlLCBzY3JlZW5TaXplKTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgcmV0dXJuIGZydXN0dW1EYXRhO1xyXG59XHJcbiAgICBcclxuZnVuY3Rpb24gc2VhcmNoQm91bmRpbmdQb2ludHMoXHJcbiAgICBtaW5YLCBtaW5ZLCBtYXhYLCBtYXhZLCBwb2ludHMsIGNlc2l1bVdpZGdldCwgcmVjdXJzaXZlTGV2ZWwpIHtcclxuICAgIFxyXG4gICAgdmFyIHRyYW5zZm9ybWVkUG9pbnRzID0gMDtcclxuICAgIHRyYW5zZm9ybWVkUG9pbnRzICs9IHRyYW5zZm9ybUFuZEFkZFBvaW50KFxyXG4gICAgICAgIG1pblgsIG1pblksIGNlc2l1bVdpZGdldCwgcG9pbnRzKTtcclxuICAgIHRyYW5zZm9ybWVkUG9pbnRzICs9IHRyYW5zZm9ybUFuZEFkZFBvaW50KFxyXG4gICAgICAgIG1heFgsIG1pblksIGNlc2l1bVdpZGdldCwgcG9pbnRzKTtcclxuICAgIHRyYW5zZm9ybWVkUG9pbnRzICs9IHRyYW5zZm9ybUFuZEFkZFBvaW50KFxyXG4gICAgICAgIG1pblgsIG1heFksIGNlc2l1bVdpZGdldCwgcG9pbnRzKTtcclxuICAgIHRyYW5zZm9ybWVkUG9pbnRzICs9IHRyYW5zZm9ybUFuZEFkZFBvaW50KFxyXG4gICAgICAgIG1heFgsIG1heFksIGNlc2l1bVdpZGdldCwgcG9pbnRzKTtcclxuXHJcbiAgICB2YXIgbWF4TGV2ZWwgPSBNQVhfUkVDVVJTSVZFX0xFVkVMX09OX0ZBSUxFRF9UUkFOU0ZPUk07XHJcbiAgICBcclxuICAgIGlmICh0cmFuc2Zvcm1lZFBvaW50cyA9PT0gNCB8fCByZWN1cnNpdmVMZXZlbCA+PSBtYXhMZXZlbCkge1xyXG4gICAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIFxyXG4gICAgKytyZWN1cnNpdmVMZXZlbDtcclxuICAgIFxyXG4gICAgdmFyIG1pZGRsZVggPSAobWluWCArIG1heFgpIC8gMjtcclxuICAgIHZhciBtaWRkbGVZID0gKG1pblkgKyBtYXhZKSAvIDI7XHJcbiAgICBcclxuICAgIHNlYXJjaEJvdW5kaW5nUG9pbnRzKFxyXG4gICAgICAgIG1pblgsIG1pblksIG1pZGRsZVgsIG1pZGRsZVksIHBvaW50cywgY2VzaXVtV2lkZ2V0LCByZWN1cnNpdmVMZXZlbCk7XHJcblxyXG4gICAgc2VhcmNoQm91bmRpbmdQb2ludHMoXHJcbiAgICAgICAgbWluWCwgbWlkZGxlWSwgbWlkZGxlWCwgbWF4WSwgcG9pbnRzLCBjZXNpdW1XaWRnZXQsIHJlY3Vyc2l2ZUxldmVsKTtcclxuXHJcbiAgICBzZWFyY2hCb3VuZGluZ1BvaW50cyhcclxuICAgICAgICBtaWRkbGVYLCBtaW5ZLCBtYXhYLCBtaWRkbGVZLCBwb2ludHMsIGNlc2l1bVdpZGdldCwgcmVjdXJzaXZlTGV2ZWwpO1xyXG5cclxuICAgIHNlYXJjaEJvdW5kaW5nUG9pbnRzKFxyXG4gICAgICAgIG1pZGRsZVgsIG1pZGRsZVksIG1heFgsIG1heFksIHBvaW50cywgY2VzaXVtV2lkZ2V0LCByZWN1cnNpdmVMZXZlbCk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIHRyYW5zZm9ybUFuZEFkZFBvaW50KHgsIHksIGNlc2l1bVdpZGdldCwgcG9pbnRzKSB7XHJcbiAgICBcclxuICAgIHZhciBzY3JlZW5Qb2ludCA9IG5ldyBDZXNpdW0uQ2FydGVzaWFuMih4LCB5KTtcclxuICAgIHZhciBlbGxpcHNvaWQgPSBjZXNpdW1XaWRnZXQuc2NlbmUubWFwUHJvamVjdGlvbi5lbGxpcHNvaWQ7XHJcbiAgICB2YXIgcG9pbnQzRCA9IGNlc2l1bVdpZGdldC5zY2VuZS5jYW1lcmEucGlja0VsbGlwc29pZChzY3JlZW5Qb2ludCwgZWxsaXBzb2lkKTtcclxuICAgIFxyXG4gICAgaWYgKHBvaW50M0QgPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIHJldHVybiAwO1xyXG4gICAgfVxyXG5cclxuICAgIHZhciBjYXJ0ZXNpYW4gPSBlbGxpcHNvaWQuY2FydGVzaWFuVG9DYXJ0b2dyYXBoaWMocG9pbnQzRCk7XHJcbiAgICBpZiAoY2FydGVzaWFuID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICByZXR1cm4gMDtcclxuICAgIH1cclxuICAgIFxyXG4gICAgcG9pbnRzLnB1c2goY2FydGVzaWFuKTtcclxuICAgIHJldHVybiAxO1xyXG59IiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBDZXNpdW1JbWFnZURlY29kZXJMYXllck1hbmFnZXI7XHJcblxyXG52YXIgQ2FudmFzSW1hZ2VyeVByb3ZpZGVyID0gcmVxdWlyZSgnY2FudmFzLWltYWdlcnktcHJvdmlkZXIuanMnKTtcclxudmFyIEltYWdlVmlld2VyID0gcmVxdWlyZSgnaW1hZ2UtZGVjb2Rlci12aWV3ZXIuanMnKTtcclxudmFyIGNhbGN1bGF0ZUNlc2l1bUZydXN0dW0gPSByZXF1aXJlKCdjZXNpdW0tZnJ1c3R1bS1jYWxjdWxhdG9yLmpzJyk7XHJcblxyXG4vKiBnbG9iYWwgQ2VzaXVtOiBmYWxzZSAqL1xyXG5cclxuZnVuY3Rpb24gQ2VzaXVtSW1hZ2VEZWNvZGVyTGF5ZXJNYW5hZ2VyKGltYWdlRGVjb2Rlciwgb3B0aW9ucykge1xyXG4gICAgdGhpcy5fb3B0aW9ucyA9IG9wdGlvbnMgfHwge307XHJcbiAgICBcclxuICAgIGlmICh0aGlzLl9vcHRpb25zLnJlY3RhbmdsZSAhPT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgdGhpcy5fb3B0aW9ucyA9IEpTT04ucGFyc2UoSlNPTi5zdHJpbmdpZnkob3B0aW9ucykpO1xyXG4gICAgICAgIHRoaXMuX29wdGlvbnMuY2FydG9ncmFwaGljQm91bmRzID0ge1xyXG4gICAgICAgICAgICB3ZXN0OiBvcHRpb25zLnJlY3RhbmdsZS53ZXN0LFxyXG4gICAgICAgICAgICBlYXN0OiBvcHRpb25zLnJlY3RhbmdsZS5lYXN0LFxyXG4gICAgICAgICAgICBzb3V0aDogb3B0aW9ucy5yZWN0YW5nbGUuc291dGgsXHJcbiAgICAgICAgICAgIG5vcnRoOiBvcHRpb25zLnJlY3RhbmdsZS5ub3J0aFxyXG4gICAgICAgIH07XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHRoaXMuX29wdGlvbnMubWluRnVuY3Rpb25DYWxsSW50ZXJ2YWxNaWxsaXNlY29uZHMgPVxyXG4gICAgICAgIG9wdGlvbnMubWluRnVuY3Rpb25DYWxsSW50ZXJ2YWxNaWxsaXNlY29uZHMgfHwgMTAwO1xyXG4gICAgdGhpcy5fdXJsID0gb3B0aW9ucy51cmw7XHJcblxyXG4gICAgdGhpcy5fdGFyZ2V0Q2FudmFzID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnY2FudmFzJyk7XHJcbiAgICB0aGlzLl9pbWFnZXJ5UHJvdmlkZXJzID0gW1xyXG4gICAgICAgIG5ldyBDYW52YXNJbWFnZXJ5UHJvdmlkZXIodGhpcy5fdGFyZ2V0Q2FudmFzKSxcclxuICAgICAgICBuZXcgQ2FudmFzSW1hZ2VyeVByb3ZpZGVyKHRoaXMuX3RhcmdldENhbnZhcylcclxuICAgIF07XHJcbiAgICB0aGlzLl9pbWFnZXJ5TGF5ZXJTaG93biA9IG5ldyBDZXNpdW0uSW1hZ2VyeUxheWVyKHRoaXMuX2ltYWdlcnlQcm92aWRlcnNbMF0pO1xyXG4gICAgdGhpcy5faW1hZ2VyeUxheWVyUGVuZGluZyA9IG5ldyBDZXNpdW0uSW1hZ2VyeUxheWVyKHRoaXMuX2ltYWdlcnlQcm92aWRlcnNbMV0pO1xyXG5cclxuICAgIHRoaXMuX2NhbnZhc1VwZGF0ZWRDYWxsYmFja0JvdW5kID0gdGhpcy5fY2FudmFzVXBkYXRlZENhbGxiYWNrLmJpbmQodGhpcyk7XHJcbiAgICBcclxuICAgIHRoaXMuX2lzUGVuZGluZ1VwZGF0ZUNhbGxiYWNrID0gZmFsc2U7XHJcbiAgICB0aGlzLl9pc1doaWxlUmVwbGFjZUxheWVyU2hvd24gPSBmYWxzZTtcclxuICAgIHRoaXMuX3BlbmRpbmdQb3NpdGlvblJlY3RhbmdsZSA9IG51bGw7XHJcbiAgICBcclxuICAgIHRoaXMuX2ltYWdlVmlld2VyID0gbmV3IEltYWdlVmlld2VyKFxyXG4gICAgICAgIGltYWdlRGVjb2RlcixcclxuICAgICAgICB0aGlzLl9jYW52YXNVcGRhdGVkQ2FsbGJhY2tCb3VuZCxcclxuICAgICAgICB0aGlzLl9vcHRpb25zKTtcclxuICAgIFxyXG4gICAgdGhpcy5faW1hZ2VWaWV3ZXIuc2V0VGFyZ2V0Q2FudmFzKHRoaXMuX3RhcmdldENhbnZhcyk7XHJcbiAgICBcclxuICAgIHRoaXMuX3VwZGF0ZUZydXN0dW1Cb3VuZCA9IHRoaXMuX3VwZGF0ZUZydXN0dW0uYmluZCh0aGlzKTtcclxuICAgIHRoaXMuX3Bvc3RSZW5kZXJCb3VuZCA9IHRoaXMuX3Bvc3RSZW5kZXIuYmluZCh0aGlzKTtcclxufVxyXG5cclxuQ2VzaXVtSW1hZ2VEZWNvZGVyTGF5ZXJNYW5hZ2VyLnByb3RvdHlwZS5zZXRFeGNlcHRpb25DYWxsYmFjayA9IGZ1bmN0aW9uIHNldEV4Y2VwdGlvbkNhbGxiYWNrKGV4Y2VwdGlvbkNhbGxiYWNrKSB7XHJcbiAgICB0aGlzLl9pbWFnZVZpZXdlci5zZXRFeGNlcHRpb25DYWxsYmFjayhleGNlcHRpb25DYWxsYmFjayk7XHJcbn07XHJcblxyXG5DZXNpdW1JbWFnZURlY29kZXJMYXllck1hbmFnZXIucHJvdG90eXBlLm9wZW4gPSBmdW5jdGlvbiBvcGVuKHdpZGdldE9yVmlld2VyKSB7XHJcbiAgICB0aGlzLl93aWRnZXQgPSB3aWRnZXRPclZpZXdlcjtcclxuICAgIHRoaXMuX2xheWVycyA9IHdpZGdldE9yVmlld2VyLnNjZW5lLmltYWdlcnlMYXllcnM7XHJcbiAgICB3aWRnZXRPclZpZXdlci5zY2VuZS5wb3N0UmVuZGVyLmFkZEV2ZW50TGlzdGVuZXIodGhpcy5fcG9zdFJlbmRlckJvdW5kKTtcclxuICAgIFxyXG4gICAgdGhpcy5faW1hZ2VWaWV3ZXIub3Blbih0aGlzLl91cmwpO1xyXG4gICAgdGhpcy5fbGF5ZXJzLmFkZCh0aGlzLl9pbWFnZXJ5TGF5ZXJTaG93bik7XHJcbiAgICBcclxuICAgIC8vIE5PVEU6IElzIHRoZXJlIGFuIGV2ZW50IGhhbmRsZXIgdG8gcmVnaXN0ZXIgaW5zdGVhZD9cclxuICAgIC8vIChDZXNpdW0ncyBldmVudCBjb250cm9sbGVycyBvbmx5IGV4cG9zZSBrZXlib2FyZCBhbmQgbW91c2VcclxuICAgIC8vIGV2ZW50cywgYnV0IHRoZXJlIGlzIG5vIGV2ZW50IGZvciBmcnVzdHVtIGNoYW5nZWRcclxuICAgIC8vIHByb2dyYW1tYXRpY2FsbHkpLlxyXG4gICAgdGhpcy5faW50ZXJ2YWxIYW5kbGUgPSBzZXRJbnRlcnZhbChcclxuICAgICAgICB0aGlzLl91cGRhdGVGcnVzdHVtQm91bmQsXHJcbiAgICAgICAgNTAwKTtcclxufTtcclxuXHJcbkNlc2l1bUltYWdlRGVjb2RlckxheWVyTWFuYWdlci5wcm90b3R5cGUuY2xvc2UgPSBmdW5jdGlvbiBjbG9zZSgpIHtcclxuICAgIHRoaXMuX2ltYWdlVmlld2VyLmNsb3NlKCk7XHJcbiAgICBjbGVhckludGVydmFsKHRoaXMuX2ludGVydmFsSGFuZGxlKTtcclxuXHJcbiAgICB0aGlzLl9sYXllcnMucmVtb3ZlKHRoaXMuX2ltYWdlcnlMYXllclNob3duKTtcclxuICAgIHRoaXMuX3dpZGdldC5yZW1vdmVFdmVudExpc3RlbmVyKHRoaXMuX3Bvc3RSZW5kZXJCb3VuZCk7XHJcbiAgICBpZiAodGhpcy5faXNXaGlsZVJlcGxhY2VMYXllclNob3duKSB7XHJcbiAgICAgICAgdGhpcy5faXNXaGlsZVJlcGxhY2VMYXllclNob3duID0gZmFsc2U7XHJcbiAgICAgICAgdGhpcy5faXNQZW5kaW5nVXBkYXRlQ2FsbGJhY2sgPSBmYWxzZTtcclxuICAgICAgICB0aGlzLl9sYXllcnMucmVtb3ZlKHRoaXMuX2ltYWdlcnlMYXllclBlbmRpbmcpO1xyXG4gICAgfVxyXG59O1xyXG5cclxuQ2VzaXVtSW1hZ2VEZWNvZGVyTGF5ZXJNYW5hZ2VyLnByb3RvdHlwZS5nZXRJbWFnZXJ5TGF5ZXJzID0gZnVuY3Rpb24gZ2V0SW1hZ2VyeUxheWVycygpIHtcclxuICAgIHJldHVybiBbdGhpcy5faW1hZ2VyeUxheWVyU2hvd24sIHRoaXMuX2ltYWdlcnlMYXllclBlbmRpbmddO1xyXG59O1xyXG5cclxuQ2VzaXVtSW1hZ2VEZWNvZGVyTGF5ZXJNYW5hZ2VyLnByb3RvdHlwZS5fdXBkYXRlRnJ1c3R1bSA9IGZ1bmN0aW9uIHVwZGF0ZUZydXN0dW0oKSB7XHJcbiAgICB2YXIgZnJ1c3R1bSA9IGNhbGN1bGF0ZUNlc2l1bUZydXN0dW0odGhpcy5fd2lkZ2V0KTtcclxuICAgIGlmIChmcnVzdHVtICE9PSBudWxsKSB7XHJcbiAgICAgICAgdGhpcy5faW1hZ2VWaWV3ZXIudXBkYXRlVmlld0FyZWEoZnJ1c3R1bSk7XHJcbiAgICB9XHJcbn07XHJcblxyXG5DZXNpdW1JbWFnZURlY29kZXJMYXllck1hbmFnZXIucHJvdG90eXBlLl9jYW52YXNVcGRhdGVkQ2FsbGJhY2sgPSBmdW5jdGlvbiBjYW52YXNVcGRhdGVkQ2FsbGJhY2sobmV3UG9zaXRpb24pIHtcclxuICAgIGlmICh0aGlzLl9pc1doaWxlUmVwbGFjZUxheWVyU2hvd24pIHtcclxuICAgICAgICB0aGlzLl9pc1BlbmRpbmdVcGRhdGVDYWxsYmFjayA9IHRydWU7XHJcbiAgICAgICAgdGhpcy5fcGVuZGluZ1Bvc2l0aW9uUmVjdGFuZ2xlID0gbmV3UG9zaXRpb247XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGlmIChuZXdQb3NpdGlvbiAhPT0gbnVsbCkge1xyXG4gICAgICAgIHZhciByZWN0YW5nbGUgPSBuZXcgQ2VzaXVtLlJlY3RhbmdsZShcclxuICAgICAgICAgICAgbmV3UG9zaXRpb24ud2VzdCxcclxuICAgICAgICAgICAgbmV3UG9zaXRpb24uc291dGgsXHJcbiAgICAgICAgICAgIG5ld1Bvc2l0aW9uLmVhc3QsXHJcbiAgICAgICAgICAgIG5ld1Bvc2l0aW9uLm5vcnRoKTtcclxuICAgICAgICBcclxuICAgICAgICB0aGlzLl9pbWFnZXJ5UHJvdmlkZXJzWzBdLnNldFJlY3RhbmdsZShyZWN0YW5nbGUpO1xyXG4gICAgICAgIHRoaXMuX2ltYWdlcnlQcm92aWRlcnNbMV0uc2V0UmVjdGFuZ2xlKHJlY3RhbmdsZSk7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHRoaXMuX3JlbW92ZUFuZFJlQWRkTGF5ZXIoKTtcclxufTtcclxuXHJcbkNlc2l1bUltYWdlRGVjb2RlckxheWVyTWFuYWdlci5wcm90b3R5cGUuX3JlbW92ZUFuZFJlQWRkTGF5ZXIgPSBmdW5jdGlvbiByZW1vdmVBbmRSZUFkZExheWVyKCkge1xyXG4gICAgdmFyIGluZGV4ID0gdGhpcy5fbGF5ZXJzLmluZGV4T2YodGhpcy5faW1hZ2VyeUxheWVyU2hvd24pO1xyXG4gICAgXHJcbiAgICBpZiAoaW5kZXggPCAwKSB7XHJcbiAgICAgICAgdGhyb3cgJ0xheWVyIHdhcyByZW1vdmVkIGZyb20gdmlld2VyXFwncyBsYXllcnMgIHdpdGhvdXQgJyArXHJcbiAgICAgICAgICAgICdjbG9zaW5nIGxheWVyIG1hbmFnZXIuIFVzZSBDZXNpdW1JbWFnZURlY29kZXJMYXllck1hbmFnZXIuJyArXHJcbiAgICAgICAgICAgICdjbG9zZSgpIGluc3RlYWQnO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICB0aGlzLl9pc1doaWxlUmVwbGFjZUxheWVyU2hvd24gPSB0cnVlO1xyXG4gICAgdGhpcy5fbGF5ZXJzLmFkZCh0aGlzLl9pbWFnZXJ5TGF5ZXJQZW5kaW5nLCBpbmRleCk7XHJcbn07XHJcblxyXG5DZXNpdW1JbWFnZURlY29kZXJMYXllck1hbmFnZXIucHJvdG90eXBlLl9wb3N0UmVuZGVyID0gZnVuY3Rpb24gcG9zdFJlbmRlcigpIHtcclxuICAgIGlmICghdGhpcy5faXNXaGlsZVJlcGxhY2VMYXllclNob3duKVxyXG4gICAgICAgIHJldHVybjtcclxuICAgIFxyXG4gICAgdGhpcy5faXNXaGlsZVJlcGxhY2VMYXllclNob3duID0gZmFsc2U7XHJcbiAgICB0aGlzLl9sYXllcnMucmVtb3ZlKHRoaXMuX2ltYWdlcnlMYXllclNob3duLCAvKmRlc3Ryb3k9Ki9mYWxzZSk7XHJcbiAgICBcclxuICAgIHZhciBzd2FwID0gdGhpcy5faW1hZ2VyeUxheWVyU2hvd247XHJcbiAgICB0aGlzLl9pbWFnZXJ5TGF5ZXJTaG93biA9IHRoaXMuX2ltYWdlcnlMYXllclBlbmRpbmc7XHJcbiAgICB0aGlzLl9pbWFnZXJ5TGF5ZXJQZW5kaW5nID0gc3dhcDtcclxuICAgIFxyXG4gICAgaWYgKHRoaXMuX2lzUGVuZGluZ1VwZGF0ZUNhbGxiYWNrKSB7XHJcbiAgICAgICAgdGhpcy5faXNQZW5kaW5nVXBkYXRlQ2FsbGJhY2sgPSBmYWxzZTtcclxuICAgICAgICB0aGlzLl9jYW52YXNVcGRhdGVkQ2FsbGJhY2sodGhpcy5fcGVuZGluZ1Bvc2l0aW9uUmVjdGFuZ2xlKTtcclxuICAgIH1cclxufTsiLCIndXNlIHN0cmljdCc7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IEltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlcjtcclxuXHJcbnZhciBjYWxjdWxhdGVDZXNpdW1GcnVzdHVtID0gcmVxdWlyZSgnY2VzaXVtLWZydXN0dW0tY2FsY3VsYXRvci5qcycpO1xyXG52YXIgaW1hZ2VIZWxwZXJGdW5jdGlvbnMgPSByZXF1aXJlKCdpbWFnZS1oZWxwZXItZnVuY3Rpb25zLmpzJyk7XHJcblxyXG4vKiBnbG9iYWwgQ2VzaXVtOiBmYWxzZSAqL1xyXG4vKiBnbG9iYWwgRGV2ZWxvcGVyRXJyb3I6IGZhbHNlICovXHJcbi8qIGdsb2JhbCBDcmVkaXQ6IGZhbHNlICovXHJcbi8qIGdsb2JhbCBQcm9taXNlOiBmYWxzZSAqL1xyXG5cclxuLyoqXHJcbiAqIFByb3ZpZGVzIGEgSW1hZ2VEZWNvZGVyIGNsaWVudCBpbWFnZXJ5IHRpbGUuICBUaGUgaW1hZ2UgaXMgYXNzdW1lZCB0byB1c2UgYVxyXG4gKiB7QGxpbmsgR2VvZ3JhcGhpY1RpbGluZ1NjaGVtZX0uXHJcbiAqXHJcbiAqIEBhbGlhcyBJbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXJcclxuICogQGNvbnN0cnVjdG9yXHJcbiAqXHJcbiAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zIE9iamVjdCB3aXRoIHRoZSBmb2xsb3dpbmcgcHJvcGVydGllczpcclxuICogQHBhcmFtIHtTdHJpbmd9IG9wdGlvbnMudXJsIFRoZSB1cmwgZm9yIHRoZSB0aWxlLlxyXG4gKiBAcGFyYW0ge1JlY3RhbmdsZX0gW29wdGlvbnMucmVjdGFuZ2xlPVJlY3RhbmdsZS5NQVhfVkFMVUVdIFRoZSByZWN0YW5nbGUsIGluIHJhZGlhbnMsIGNvdmVyZWQgYnkgdGhlIGltYWdlLlxyXG4gKiBAcGFyYW0ge0NyZWRpdHxTdHJpbmd9IFtvcHRpb25zLmNyZWRpdF0gQSBjcmVkaXQgZm9yIHRoZSBkYXRhIHNvdXJjZSwgd2hpY2ggaXMgZGlzcGxheWVkIG9uIHRoZSBjYW52YXMuXHJcbiAqIEBwYXJhbSB7T2JqZWN0fSBbb3B0aW9ucy5wcm94eV0gQSBwcm94eSB0byB1c2UgZm9yIHJlcXVlc3RzLiBUaGlzIG9iamVjdCBpcyBleHBlY3RlZCB0byBoYXZlIGEgZ2V0VVJMIGZ1bmN0aW9uIHdoaWNoIHJldHVybnMgdGhlIHByb3hpZWQgVVJMLCBpZiBuZWVkZWQuXHJcbiAqIEBwYXJhbSB7Ym9vbGVhbn0gW29wdGlvbnMuYWRhcHRQcm9wb3J0aW9uc10gZGV0ZXJtaW5lcyBpZiB0byBhZGFwdCB0aGUgcHJvcG9ydGlvbnMgb2YgdGhlIHJlY3RhbmdsZSBwcm92aWRlZCB0byB0aGUgaW1hZ2UgcGl4ZWxzIHByb3BvcnRpb25zLlxyXG4gKlxyXG4gKiBAc2VlIEFyY0dpc01hcFNlcnZlckltYWdlcnlQcm92aWRlclxyXG4gKiBAc2VlIEJpbmdNYXBzSW1hZ2VyeVByb3ZpZGVyXHJcbiAqIEBzZWUgR29vZ2xlRWFydGhJbWFnZXJ5UHJvdmlkZXJcclxuICogQHNlZSBPcGVuU3RyZWV0TWFwSW1hZ2VyeVByb3ZpZGVyXHJcbiAqIEBzZWUgVGlsZU1hcFNlcnZpY2VJbWFnZXJ5UHJvdmlkZXJcclxuICogQHNlZSBXZWJNYXBTZXJ2aWNlSW1hZ2VyeVByb3ZpZGVyXHJcbiAqL1xyXG5mdW5jdGlvbiBJbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIoaW1hZ2VEZWNvZGVyLCBvcHRpb25zKSB7XHJcbiAgICB2YXIgdXJsID0gb3B0aW9ucy51cmw7XHJcbiAgICB0aGlzLl9hZGFwdFByb3BvcnRpb25zID0gb3B0aW9ucy5hZGFwdFByb3BvcnRpb25zO1xyXG4gICAgdGhpcy5fcmVjdGFuZ2xlID0gb3B0aW9ucy5yZWN0YW5nbGU7XHJcbiAgICB0aGlzLl9wcm94eSA9IG9wdGlvbnMucHJveHk7XHJcbiAgICB0aGlzLl91cGRhdGVGcnVzdHVtSW50ZXJ2YWwgPSAxMDAwIHx8IG9wdGlvbnMudXBkYXRlRnJ1c3R1bUludGVydmFsO1xyXG4gICAgdGhpcy5fY3JlZGl0ID0gb3B0aW9ucy5jcmVkaXQ7XHJcbiAgICBcclxuICAgIGlmICh0eXBlb2YgdGhpcy5fY3JlZGl0ID09PSAnc3RyaW5nJykge1xyXG4gICAgICAgIHRoaXMuX2NyZWRpdCA9IG5ldyBDcmVkaXQodGhpcy5fY3JlZGl0KTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgaWYgKHRoaXMuX3JlY3RhbmdsZSA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgdGhpcy5fcmVjdGFuZ2xlID0gQ2VzaXVtLlJlY3RhbmdsZS5mcm9tRGVncmVlcygtMTgwLCAtOTAsIDE4MCwgOTApO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBpZiAodGhpcy5fYWRhcHRQcm9wb3J0aW9ucyA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgdGhpcy5fYWRhcHRQcm9wb3J0aW9ucyA9IHRydWU7XHJcbiAgICB9XHJcblxyXG4gICAgb3B0aW9ucyA9IEpTT04ucGFyc2UoSlNPTi5zdHJpbmdpZnkob3B0aW9ucyB8fCB7fSkpO1xyXG4gICAgb3B0aW9ucy5jYXJ0b2dyYXBoaWNCb3VuZHMgPSB7XHJcbiAgICAgICAgd2VzdDogdGhpcy5fcmVjdGFuZ2xlLndlc3QsXHJcbiAgICAgICAgZWFzdDogdGhpcy5fcmVjdGFuZ2xlLmVhc3QsXHJcbiAgICAgICAgc291dGg6IHRoaXMuX3JlY3RhbmdsZS5zb3V0aCxcclxuICAgICAgICBub3J0aDogdGhpcy5fcmVjdGFuZ2xlLm5vcnRoXHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICAvLz4+aW5jbHVkZVN0YXJ0KCdkZWJ1ZycsIHByYWdtYXMuZGVidWcpO1xyXG4gICAgaWYgKHVybCA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgICAgIHRocm93IG5ldyBEZXZlbG9wZXJFcnJvcigndXJsIGlzIHJlcXVpcmVkLicpO1xyXG4gICAgfVxyXG4gICAgLy8+PmluY2x1ZGVFbmQoJ2RlYnVnJyk7XHJcblxyXG4gICAgdGhpcy5fdXJsID0gdXJsO1xyXG5cclxuICAgIHRoaXMuX3RpbGluZ1NjaGVtZSA9IHVuZGVmaW5lZDtcclxuXHJcbiAgICB0aGlzLl90aWxlV2lkdGggPSAwO1xyXG4gICAgdGhpcy5fdGlsZUhlaWdodCA9IDA7XHJcblxyXG4gICAgdGhpcy5fZXJyb3JFdmVudCA9IG5ldyBFdmVudCgnSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyU3RhdHVzJyk7XHJcblxyXG4gICAgdGhpcy5fcmVhZHkgPSBmYWxzZTtcclxuICAgIHRoaXMuX2V4Y2VwdGlvbkNhbGxiYWNrID0gbnVsbDtcclxuICAgIHRoaXMuX2Nlc2l1bVdpZGdldCA9IG51bGw7XHJcbiAgICB0aGlzLl91cGRhdGVGcnVzdHVtSW50ZXJ2YWxIYW5kbGUgPSBudWxsO1xyXG4gICAgXHJcblxyXG4gICAgdmFyIGltYWdlVXJsID0gdXJsO1xyXG4gICAgaWYgKHRoaXMuX3Byb3h5ICE9PSB1bmRlZmluZWQpIHtcclxuICAgICAgICAvLyBOT1RFOiBJcyB0aGF0IHRoZSBjb3JyZWN0IGxvZ2ljP1xyXG4gICAgICAgIGltYWdlVXJsID0gdGhpcy5fcHJveHkuZ2V0VVJMKGltYWdlVXJsKTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgdGhpcy5faW1hZ2VEZWNvZGVyID0gaW1hZ2VEZWNvZGVyO1xyXG4gICAgdGhpcy5fdXJsID0gaW1hZ2VVcmw7XHJcbn1cclxuXHJcbkltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlci5wcm90b3R5cGUgPSB7XHJcbiAgICAvKipcclxuICAgICAqIEdldHMgdGhlIFVSTCBvZiB0aGUgSW1hZ2VEZWNvZGVyIHNlcnZlciAoaW5jbHVkaW5nIHRhcmdldCkuXHJcbiAgICAgKiBAbWVtYmVyb2YgSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZVxyXG4gICAgICogQHR5cGUge1N0cmluZ31cclxuICAgICAqIEByZWFkb25seVxyXG4gICAgICovXHJcbiAgICBnZXQgdXJsKCkge1xyXG4gICAgICAgIHJldHVybiB0aGlzLl91cmw7XHJcbiAgICB9LFxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2V0cyB0aGUgcHJveHkgdXNlZCBieSB0aGlzIHByb3ZpZGVyLlxyXG4gICAgICogQG1lbWJlcm9mIEltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlci5wcm90b3R5cGVcclxuICAgICAqIEB0eXBlIHtQcm94eX1cclxuICAgICAqIEByZWFkb25seVxyXG4gICAgICovXHJcbiAgICBnZXQgcHJveHkoKSB7XHJcbiAgICAgICAgcmV0dXJuIHRoaXMuX3Byb3h5O1xyXG4gICAgfSxcclxuXHJcbiAgICAvKipcclxuICAgICAqIEdldHMgdGhlIHdpZHRoIG9mIGVhY2ggdGlsZSwgaW4gcGl4ZWxzLiBUaGlzIGZ1bmN0aW9uIHNob3VsZFxyXG4gICAgICogbm90IGJlIGNhbGxlZCBiZWZvcmUge0BsaW5rIEltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlciNyZWFkeX0gcmV0dXJucyB0cnVlLlxyXG4gICAgICogQG1lbWJlcm9mIEltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlci5wcm90b3R5cGVcclxuICAgICAqIEB0eXBlIHtOdW1iZXJ9XHJcbiAgICAgKiBAcmVhZG9ubHlcclxuICAgICAqL1xyXG4gICAgZ2V0IHRpbGVXaWR0aCgpIHtcclxuICAgICAgICAvLz4+aW5jbHVkZVN0YXJ0KCdkZWJ1ZycsIHByYWdtYXMuZGVidWcpO1xyXG4gICAgICAgIGlmICghdGhpcy5fcmVhZHkpIHtcclxuICAgICAgICAgICAgICAgIHRocm93IG5ldyBEZXZlbG9wZXJFcnJvcigndGlsZVdpZHRoIG11c3Qgbm90IGJlIGNhbGxlZCBiZWZvcmUgdGhlIGltYWdlcnkgcHJvdmlkZXIgaXMgcmVhZHkuJyk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIC8vPj5pbmNsdWRlRW5kKCdkZWJ1ZycpO1xyXG5cclxuICAgICAgICByZXR1cm4gdGhpcy5fdGlsZVdpZHRoO1xyXG4gICAgfSxcclxuXHJcbiAgICAvKipcclxuICAgICAqIEdldHMgdGhlIGhlaWdodCBvZiBlYWNoIHRpbGUsIGluIHBpeGVscy4gIFRoaXMgZnVuY3Rpb24gc2hvdWxkXHJcbiAgICAgKiBub3QgYmUgY2FsbGVkIGJlZm9yZSB7QGxpbmsgSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyI3JlYWR5fSByZXR1cm5zIHRydWUuXHJcbiAgICAgKiBAbWVtYmVyb2YgSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZVxyXG4gICAgICogQHR5cGUge051bWJlcn1cclxuICAgICAqIEByZWFkb25seVxyXG4gICAgICovXHJcbiAgICBnZXQgdGlsZUhlaWdodCgpIHtcclxuICAgICAgICAvLz4+aW5jbHVkZVN0YXJ0KCdkZWJ1ZycsIHByYWdtYXMuZGVidWcpO1xyXG4gICAgICAgIGlmICghdGhpcy5fcmVhZHkpIHtcclxuICAgICAgICAgICAgICAgIHRocm93IG5ldyBEZXZlbG9wZXJFcnJvcigndGlsZUhlaWdodCBtdXN0IG5vdCBiZSBjYWxsZWQgYmVmb3JlIHRoZSBpbWFnZXJ5IHByb3ZpZGVyIGlzIHJlYWR5LicpO1xyXG4gICAgICAgIH1cclxuICAgICAgICAvLz4+aW5jbHVkZUVuZCgnZGVidWcnKTtcclxuXHJcbiAgICAgICAgcmV0dXJuIHRoaXMuX3RpbGVIZWlnaHQ7XHJcbiAgICB9LFxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2V0cyB0aGUgbWF4aW11bSBsZXZlbC1vZi1kZXRhaWwgdGhhdCBjYW4gYmUgcmVxdWVzdGVkLiAgVGhpcyBmdW5jdGlvbiBzaG91bGRcclxuICAgICAqIG5vdCBiZSBjYWxsZWQgYmVmb3JlIHtAbGluayBJbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIjcmVhZHl9IHJldHVybnMgdHJ1ZS5cclxuICAgICAqIEBtZW1iZXJvZiBJbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlXHJcbiAgICAgKiBAdHlwZSB7TnVtYmVyfVxyXG4gICAgICogQHJlYWRvbmx5XHJcbiAgICAgKi9cclxuICAgIGdldCBtYXhpbXVtTGV2ZWwoKSB7XHJcbiAgICAgICAgLy8+PmluY2x1ZGVTdGFydCgnZGVidWcnLCBwcmFnbWFzLmRlYnVnKTtcclxuICAgICAgICBpZiAoIXRoaXMuX3JlYWR5KSB7XHJcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRGV2ZWxvcGVyRXJyb3IoJ21heGltdW1MZXZlbCBtdXN0IG5vdCBiZSBjYWxsZWQgYmVmb3JlIHRoZSBpbWFnZXJ5IHByb3ZpZGVyIGlzIHJlYWR5LicpO1xyXG4gICAgICAgIH1cclxuICAgICAgICAvLz4+aW5jbHVkZUVuZCgnZGVidWcnKTtcclxuXHJcbiAgICAgICAgcmV0dXJuIHRoaXMuX251bVJlc29sdXRpb25MZXZlbHMgLSAxO1xyXG4gICAgfSxcclxuXHJcbiAgICAvKipcclxuICAgICAqIEdldHMgdGhlIG1pbmltdW0gbGV2ZWwtb2YtZGV0YWlsIHRoYXQgY2FuIGJlIHJlcXVlc3RlZC4gIFRoaXMgZnVuY3Rpb24gc2hvdWxkXHJcbiAgICAgKiBub3QgYmUgY2FsbGVkIGJlZm9yZSB7QGxpbmsgSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyI3JlYWR5fSByZXR1cm5zIHRydWUuXHJcbiAgICAgKiBAbWVtYmVyb2YgSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZVxyXG4gICAgICogQHR5cGUge051bWJlcn1cclxuICAgICAqIEByZWFkb25seVxyXG4gICAgICovXHJcbiAgICBnZXQgbWluaW11bUxldmVsKCkge1xyXG4gICAgICAgIC8vPj5pbmNsdWRlU3RhcnQoJ2RlYnVnJywgcHJhZ21hcy5kZWJ1Zyk7XHJcbiAgICAgICAgaWYgKCF0aGlzLl9yZWFkeSkge1xyXG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IERldmVsb3BlckVycm9yKCdtaW5pbXVtTGV2ZWwgbXVzdCBub3QgYmUgY2FsbGVkIGJlZm9yZSB0aGUgaW1hZ2VyeSBwcm92aWRlciBpcyByZWFkeS4nKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgLy8+PmluY2x1ZGVFbmQoJ2RlYnVnJyk7XHJcblxyXG4gICAgICAgIHJldHVybiAwO1xyXG4gICAgfSxcclxuXHJcbiAgICAvKipcclxuICAgICAqIEdldHMgdGhlIHRpbGluZyBzY2hlbWUgdXNlZCBieSB0aGlzIHByb3ZpZGVyLiAgVGhpcyBmdW5jdGlvbiBzaG91bGRcclxuICAgICAqIG5vdCBiZSBjYWxsZWQgYmVmb3JlIHtAbGluayBJbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIjcmVhZHl9IHJldHVybnMgdHJ1ZS5cclxuICAgICAqIEBtZW1iZXJvZiBJbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlXHJcbiAgICAgKiBAdHlwZSB7VGlsaW5nU2NoZW1lfVxyXG4gICAgICogQHJlYWRvbmx5XHJcbiAgICAgKi9cclxuICAgIGdldCB0aWxpbmdTY2hlbWUoKSB7XHJcbiAgICAgICAgLy8+PmluY2x1ZGVTdGFydCgnZGVidWcnLCBwcmFnbWFzLmRlYnVnKTtcclxuICAgICAgICBpZiAoIXRoaXMuX3JlYWR5KSB7XHJcbiAgICAgICAgICAgIHRocm93IG5ldyBEZXZlbG9wZXJFcnJvcigndGlsaW5nU2NoZW1lIG11c3Qgbm90IGJlIGNhbGxlZCBiZWZvcmUgdGhlIGltYWdlcnkgcHJvdmlkZXIgaXMgcmVhZHkuJyk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIC8vPj5pbmNsdWRlRW5kKCdkZWJ1ZycpO1xyXG5cclxuICAgICAgICByZXR1cm4gdGhpcy5fdGlsaW5nU2NoZW1lO1xyXG4gICAgfSxcclxuXHJcbiAgICAvKipcclxuICAgICAqIEdldHMgdGhlIHJlY3RhbmdsZSwgaW4gcmFkaWFucywgb2YgdGhlIGltYWdlcnkgcHJvdmlkZWQgYnkgdGhpcyBpbnN0YW5jZS4gIFRoaXMgZnVuY3Rpb24gc2hvdWxkXHJcbiAgICAgKiBub3QgYmUgY2FsbGVkIGJlZm9yZSB7QGxpbmsgSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyI3JlYWR5fSByZXR1cm5zIHRydWUuXHJcbiAgICAgKiBAbWVtYmVyb2YgSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZVxyXG4gICAgICogQHR5cGUge1JlY3RhbmdsZX1cclxuICAgICAqIEByZWFkb25seVxyXG4gICAgICovXHJcbiAgICBnZXQgcmVjdGFuZ2xlKCkge1xyXG4gICAgICAgIHJldHVybiB0aGlzLl90aWxpbmdTY2hlbWUucmVjdGFuZ2xlO1xyXG4gICAgfSxcclxuXHJcbiAgICAvKipcclxuICAgICAqIEdldHMgdGhlIHRpbGUgZGlzY2FyZCBwb2xpY3kuICBJZiBub3QgdW5kZWZpbmVkLCB0aGUgZGlzY2FyZCBwb2xpY3kgaXMgcmVzcG9uc2libGVcclxuICAgICAqIGZvciBmaWx0ZXJpbmcgb3V0IFwibWlzc2luZ1wiIHRpbGVzIHZpYSBpdHMgc2hvdWxkRGlzY2FyZEltYWdlIGZ1bmN0aW9uLiAgSWYgdGhpcyBmdW5jdGlvblxyXG4gICAgICogcmV0dXJucyB1bmRlZmluZWQsIG5vIHRpbGVzIGFyZSBmaWx0ZXJlZC4gIFRoaXMgZnVuY3Rpb24gc2hvdWxkXHJcbiAgICAgKiBub3QgYmUgY2FsbGVkIGJlZm9yZSB7QGxpbmsgSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyI3JlYWR5fSByZXR1cm5zIHRydWUuXHJcbiAgICAgKiBAbWVtYmVyb2YgSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZVxyXG4gICAgICogQHR5cGUge1RpbGVEaXNjYXJkUG9saWN5fVxyXG4gICAgICogQHJlYWRvbmx5XHJcbiAgICAgKi9cclxuICAgIGdldCB0aWxlRGlzY2FyZFBvbGljeSgpIHtcclxuICAgICAgICAvLz4+aW5jbHVkZVN0YXJ0KCdkZWJ1ZycsIHByYWdtYXMuZGVidWcpO1xyXG4gICAgICAgIGlmICghdGhpcy5fcmVhZHkpIHtcclxuICAgICAgICAgICAgdGhyb3cgbmV3IERldmVsb3BlckVycm9yKCd0aWxlRGlzY2FyZFBvbGljeSBtdXN0IG5vdCBiZSBjYWxsZWQgYmVmb3JlIHRoZSBpbWFnZXJ5IHByb3ZpZGVyIGlzIHJlYWR5LicpO1xyXG4gICAgICAgIH1cclxuICAgICAgICAvLz4+aW5jbHVkZUVuZCgnZGVidWcnKTtcclxuXHJcbiAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcclxuICAgIH0sXHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZXRzIGFuIGV2ZW50IHRoYXQgaXMgcmFpc2VkIHdoZW4gdGhlIGltYWdlcnkgcHJvdmlkZXIgZW5jb3VudGVycyBhbiBhc3luY2hyb25vdXMgZXJyb3IuICBCeSBzdWJzY3JpYmluZ1xyXG4gICAgICogdG8gdGhlIGV2ZW50LCB5b3Ugd2lsbCBiZSBub3RpZmllZCBvZiB0aGUgZXJyb3IgYW5kIGNhbiBwb3RlbnRpYWxseSByZWNvdmVyIGZyb20gaXQuICBFdmVudCBsaXN0ZW5lcnNcclxuICAgICAqIGFyZSBwYXNzZWQgYW4gaW5zdGFuY2Ugb2Yge0BsaW5rIFRpbGVQcm92aWRlckVycm9yfS5cclxuICAgICAqIEBtZW1iZXJvZiBJbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlXHJcbiAgICAgKiBAdHlwZSB7RXZlbnR9XHJcbiAgICAgKiBAcmVhZG9ubHlcclxuICAgICAqL1xyXG4gICAgZ2V0IGVycm9yRXZlbnQoKSB7XHJcbiAgICAgICAgcmV0dXJuIHRoaXMuX2Vycm9yRXZlbnQ7XHJcbiAgICB9LFxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2V0cyBhIHZhbHVlIGluZGljYXRpbmcgd2hldGhlciBvciBub3QgdGhlIHByb3ZpZGVyIGlzIHJlYWR5IGZvciB1c2UuXHJcbiAgICAgKiBAbWVtYmVyb2YgSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZVxyXG4gICAgICogQHR5cGUge0Jvb2xlYW59XHJcbiAgICAgKiBAcmVhZG9ubHlcclxuICAgICAqL1xyXG4gICAgZ2V0IHJlYWR5KCkge1xyXG4gICAgICAgIHJldHVybiB0aGlzLl9yZWFkeTtcclxuICAgIH0sXHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZXRzIHRoZSBjcmVkaXQgdG8gZGlzcGxheSB3aGVuIHRoaXMgaW1hZ2VyeSBwcm92aWRlciBpcyBhY3RpdmUuICBUeXBpY2FsbHkgdGhpcyBpcyB1c2VkIHRvIGNyZWRpdFxyXG4gICAgICogdGhlIHNvdXJjZSBvZiB0aGUgaW1hZ2VyeS4gIFRoaXMgZnVuY3Rpb24gc2hvdWxkIG5vdCBiZSBjYWxsZWQgYmVmb3JlIHtAbGluayBJbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIjcmVhZHl9IHJldHVybnMgdHJ1ZS5cclxuICAgICAqIEBtZW1iZXJvZiBJbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlXHJcbiAgICAgKiBAdHlwZSB7Q3JlZGl0fVxyXG4gICAgICogQHJlYWRvbmx5XHJcbiAgICAgKi9cclxuICAgIGdldCBjcmVkaXQoKSB7XHJcbiAgICAgICAgcmV0dXJuIHRoaXMuX2NyZWRpdDtcclxuICAgIH0sXHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZXRzIGEgdmFsdWUgaW5kaWNhdGluZyB3aGV0aGVyIG9yIG5vdCB0aGUgaW1hZ2VzIHByb3ZpZGVkIGJ5IHRoaXMgaW1hZ2VyeSBwcm92aWRlclxyXG4gICAgICogaW5jbHVkZSBhbiBhbHBoYSBjaGFubmVsLiAgSWYgdGhpcyBwcm9wZXJ0eSBpcyBmYWxzZSwgYW4gYWxwaGEgY2hhbm5lbCwgaWYgcHJlc2VudCwgd2lsbFxyXG4gICAgICogYmUgaWdub3JlZC4gIElmIHRoaXMgcHJvcGVydHkgaXMgdHJ1ZSwgYW55IGltYWdlcyB3aXRob3V0IGFuIGFscGhhIGNoYW5uZWwgd2lsbCBiZSB0cmVhdGVkXHJcbiAgICAgKiBhcyBpZiB0aGVpciBhbHBoYSBpcyAxLjAgZXZlcnl3aGVyZS4gIFdoZW4gdGhpcyBwcm9wZXJ0eSBpcyBmYWxzZSwgbWVtb3J5IHVzYWdlXHJcbiAgICAgKiBhbmQgdGV4dHVyZSB1cGxvYWQgdGltZSBhcmUgcmVkdWNlZC5cclxuICAgICAqIEBtZW1iZXJvZiBJbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlXHJcbiAgICAgKiBAdHlwZSB7Qm9vbGVhbn1cclxuICAgICAqIEByZWFkb25seVxyXG4gICAgICovXHJcbiAgICBnZXQgaGFzQWxwaGFDaGFubmVsKCkge1xyXG4gICAgICAgIHJldHVybiB0cnVlO1xyXG4gICAgfVxyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5zZXRFeGNlcHRpb25DYWxsYmFjayA9XHJcbiAgICBmdW5jdGlvbiBzZXRFeGNlcHRpb25DYWxsYmFjayhleGNlcHRpb25DYWxsYmFjaykge1xyXG4gICAgXHJcbiAgICB0aGlzLl9leGNlcHRpb25DYWxsYmFjayA9IGV4Y2VwdGlvbkNhbGxiYWNrO1xyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5vcGVuID0gZnVuY3Rpb24gb3Blbih3aWRnZXRPclZpZXdlcikge1xyXG4gICAgaWYgKHRoaXMuX3VwZGF0ZUZydXN0dW1JbnRlcnZhbEhhbmRsZSAhPT0gbnVsbCkge1xyXG4gICAgICAgIHRocm93IG5ldyBEZXZlbG9wZXJFcnJvcignQ2Fubm90IHNldCB0d28gcGFyZW50IHZpZXdlcnMuJyk7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGlmICh3aWRnZXRPclZpZXdlciA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgdGhyb3cgbmV3IERldmVsb3BlckVycm9yKCd3aWRnZXRPclZpZXdlciBzaG91bGQgYmUgZ2l2ZW4uIEl0IGlzICcgK1xyXG4gICAgICAgICAgICAnbmVlZGVkIGZvciBmcnVzdHVtIGNhbGN1bGF0aW9uIGZvciB0aGUgcHJpb3JpdHkgbWVjaGFuaXNtJyk7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHRoaXMuX2ltYWdlRGVjb2Rlci5vcGVuKHRoaXMuX3VybClcclxuICAgICAgICAudGhlbih0aGlzLl9vcGVuZWQuYmluZCh0aGlzKSlcclxuICAgICAgICAuY2F0Y2godGhpcy5fb25FeGNlcHRpb24uYmluZCh0aGlzKSk7XHJcbiAgICBcclxuICAgIHRoaXMuX2Nlc2l1bVdpZGdldCA9IHdpZGdldE9yVmlld2VyO1xyXG4gICAgXHJcbiAgICB0aGlzLl91cGRhdGVGcnVzdHVtSW50ZXJ2YWxIYW5kbGUgPSBzZXRJbnRlcnZhbChcclxuICAgICAgICB0aGlzLl9zZXRQcmlvcml0eUJ5RnJ1c3R1bS5iaW5kKHRoaXMpLFxyXG4gICAgICAgIHRoaXMuX3VwZGF0ZUZydXN0dW1JbnRlcnZhbCk7XHJcbn07XHJcblxyXG5JbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlLmNsb3NlID0gZnVuY3Rpb24gY2xvc2UoKSB7XHJcbiAgICBjbGVhckludGVydmFsKHRoaXMuX3VwZGF0ZUZydXN0dW1JbnRlcnZhbEhhbmRsZSk7XHJcbiAgICB0aGlzLl9pbWFnZURlY29kZXIuY2xvc2UoKTtcclxufTtcclxuXHJcbkltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlci5wcm90b3R5cGUuZ2V0VGlsZVdpZHRoID0gZnVuY3Rpb24gZ2V0VGlsZVdpZHRoKCkge1xyXG4gICAgcmV0dXJuIHRoaXMudGlsZVdpZHRoO1xyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5nZXRUaWxlSGVpZ2h0ID0gZnVuY3Rpb24gZ2V0VGlsZUhlaWdodCgpIHtcclxuICAgIHJldHVybiB0aGlzLnRpbGVIZWlnaHQ7XHJcbn07XHJcblxyXG5JbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlLmdldE1heGltdW1MZXZlbCA9IGZ1bmN0aW9uIGdldE1heGltdW1MZXZlbCgpIHtcclxuICAgIHJldHVybiB0aGlzLm1heGltdW1MZXZlbDtcclxufTtcclxuXHJcbkltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlci5wcm90b3R5cGUuZ2V0TWluaW11bUxldmVsID0gZnVuY3Rpb24gZ2V0TWluaW11bUxldmVsKCkge1xyXG4gICAgcmV0dXJuIHRoaXMubWluaW11bUxldmVsO1xyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5nZXRVcmwgPSBmdW5jdGlvbiBnZXRVcmwoKSB7XHJcbiAgICByZXR1cm4gdGhpcy51cmw7XHJcbn07XHJcblxyXG5JbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlLmdldFByb3h5ID0gZnVuY3Rpb24gZ2V0UHJveHkoKSB7XHJcbiAgICByZXR1cm4gdGhpcy5wcm94eTtcclxufTtcclxuXHJcbkltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlci5wcm90b3R5cGUuaXNSZWFkeSA9IGZ1bmN0aW9uIGlzUmVhZHkoKSB7XHJcbiAgICByZXR1cm4gdGhpcy5yZWFkeTtcclxufTtcclxuXHJcbkltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlci5wcm90b3R5cGUuZ2V0Q3JlZGl0ID0gZnVuY3Rpb24gZ2V0Q3JlZGl0KCkge1xyXG4gICAgcmV0dXJuIHRoaXMuY3JlZGl0O1xyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5nZXRSZWN0YW5nbGUgPSBmdW5jdGlvbiBnZXRSZWN0YW5nbGUoKSB7XHJcbiAgICByZXR1cm4gdGhpcy50aWxpbmdTY2hlbWUucmVjdGFuZ2xlO1xyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5nZXRUaWxpbmdTY2hlbWUgPSBmdW5jdGlvbiBnZXRUaWxpbmdTY2hlbWUoKSB7XHJcbiAgICByZXR1cm4gdGhpcy50aWxpbmdTY2hlbWU7XHJcbn07XHJcblxyXG5JbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlLmdldFRpbGVEaXNjYXJkUG9saWN5ID0gZnVuY3Rpb24gZ2V0VGlsZURpc2NhcmRQb2xpY3koKSB7XHJcbiAgICByZXR1cm4gdGhpcy50aWxlRGlzY2FyZFBvbGljeTtcclxufTtcclxuXHJcbkltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlci5wcm90b3R5cGUuZ2V0RXJyb3JFdmVudCA9IGZ1bmN0aW9uIGdldEVycm9yRXZlbnQoKSB7XHJcbiAgICByZXR1cm4gdGhpcy5lcnJvckV2ZW50O1xyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5nZXRIYXNBbHBoYUNoYW5uZWwgPSBmdW5jdGlvbiBnZXRIYXNBbHBoYUNoYW5uZWwoKSB7XHJcbiAgICByZXR1cm4gdGhpcy5oYXNBbHBoYUNoYW5uZWw7XHJcbn07XHJcblxyXG4vKipcclxuICogR2V0cyB0aGUgY3JlZGl0cyB0byBiZSBkaXNwbGF5ZWQgd2hlbiBhIGdpdmVuIHRpbGUgaXMgZGlzcGxheWVkLlxyXG4gKlxyXG4gKiBAcGFyYW0ge051bWJlcn0geCBUaGUgdGlsZSBYIGNvb3JkaW5hdGUuXHJcbiAqIEBwYXJhbSB7TnVtYmVyfSB5IFRoZSB0aWxlIFkgY29vcmRpbmF0ZS5cclxuICogQHBhcmFtIHtOdW1iZXJ9IGxldmVsIFRoZSB0aWxlIGxldmVsO1xyXG4gKiBAcmV0dXJucyB7Q3JlZGl0W119IFRoZSBjcmVkaXRzIHRvIGJlIGRpc3BsYXllZCB3aGVuIHRoZSB0aWxlIGlzIGRpc3BsYXllZC5cclxuICpcclxuICogQGV4Y2VwdGlvbiB7RGV2ZWxvcGVyRXJyb3J9IDxjb2RlPmdldFRpbGVDcmVkaXRzPC9jb2RlPiBtdXN0IG5vdCBiZSBjYWxsZWQgYmVmb3JlIHRoZSBpbWFnZXJ5IHByb3ZpZGVyIGlzIHJlYWR5LlxyXG4gKi9cclxuSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5nZXRUaWxlQ3JlZGl0cyA9IGZ1bmN0aW9uKHgsIHksIGxldmVsKSB7XHJcbiAgICByZXR1cm4gdW5kZWZpbmVkO1xyXG59O1xyXG5cclxuLyoqXHJcbiAqIFJlcXVlc3RzIHRoZSBpbWFnZSBmb3IgYSBnaXZlbiB0aWxlLiAgVGhpcyBmdW5jdGlvbiBzaG91bGRcclxuICogbm90IGJlIGNhbGxlZCBiZWZvcmUge0BsaW5rIEltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlciNyZWFkeX0gcmV0dXJucyB0cnVlLlxyXG4gKlxyXG4gKiBAcGFyYW0ge051bWJlcn0geCBUaGUgdGlsZSBYIGNvb3JkaW5hdGUuXHJcbiAqIEBwYXJhbSB7TnVtYmVyfSB5IFRoZSB0aWxlIFkgY29vcmRpbmF0ZS5cclxuICogQHBhcmFtIHtOdW1iZXJ9IGxldmVsIFRoZSB0aWxlIGxldmVsLlxyXG4gKiBAcmV0dXJucyB7UHJvbWlzZX0gQSBwcm9taXNlIGZvciB0aGUgaW1hZ2UgdGhhdCB3aWxsIHJlc29sdmUgd2hlbiB0aGUgaW1hZ2UgaXMgYXZhaWxhYmxlLCBvclxyXG4gKiAgICAgICAgICB1bmRlZmluZWQgaWYgdGhlcmUgYXJlIHRvbyBtYW55IGFjdGl2ZSByZXF1ZXN0cyB0byB0aGUgc2VydmVyLCBhbmQgdGhlIHJlcXVlc3RcclxuICogICAgICAgICAgc2hvdWxkIGJlIHJldHJpZWQgbGF0ZXIuICBUaGUgcmVzb2x2ZWQgaW1hZ2UgbWF5IGJlIGVpdGhlciBhblxyXG4gKiAgICAgICAgICBJbWFnZSBvciBhIENhbnZhcyBET00gb2JqZWN0LlxyXG4gKlxyXG4gKiBAZXhjZXB0aW9uIHtEZXZlbG9wZXJFcnJvcn0gPGNvZGU+cmVxdWVzdEltYWdlPC9jb2RlPiBtdXN0IG5vdCBiZSBjYWxsZWQgYmVmb3JlIHRoZSBpbWFnZXJ5IHByb3ZpZGVyIGlzIHJlYWR5LlxyXG4gKi9cclxuSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5yZXF1ZXN0SW1hZ2UgPSBmdW5jdGlvbih4LCB5LCBjZXNpdW1MZXZlbCkge1xyXG4gICAgLy8+PmluY2x1ZGVTdGFydCgnZGVidWcnLCBwcmFnbWFzLmRlYnVnKTtcclxuICAgIGlmICghdGhpcy5fcmVhZHkpIHtcclxuICAgICAgICB0aHJvdyBuZXcgRGV2ZWxvcGVyRXJyb3IoJ3JlcXVlc3RJbWFnZSBtdXN0IG5vdCBiZSBjYWxsZWQgYmVmb3JlIHRoZSBpbWFnZXJ5IHByb3ZpZGVyIGlzIHJlYWR5LicpO1xyXG4gICAgfVxyXG4gICAgLy8+PmluY2x1ZGVFbmQoJ2RlYnVnJyk7XHJcbiAgICBcclxuICAgIHZhciBzZWxmID0gdGhpcztcclxuICAgIFxyXG4gICAgdmFyIGxldmVsRmFjdG9yID0gTWF0aC5wb3coMiwgdGhpcy5fbnVtUmVzb2x1dGlvbkxldmVscyAtIGNlc2l1bUxldmVsIC0gMSk7XHJcbiAgICB2YXIgbWluWCA9IHggKiB0aGlzLl90aWxlV2lkdGggICogbGV2ZWxGYWN0b3I7XHJcbiAgICB2YXIgbWluWSA9IHkgKiB0aGlzLl90aWxlSGVpZ2h0ICogbGV2ZWxGYWN0b3I7XHJcbiAgICB2YXIgbWF4WEV4Y2x1c2l2ZSA9ICh4ICsgMSkgKiB0aGlzLl90aWxlV2lkdGggICogbGV2ZWxGYWN0b3I7XHJcbiAgICB2YXIgbWF4WUV4Y2x1c2l2ZSA9ICh5ICsgMSkgKiB0aGlzLl90aWxlSGVpZ2h0ICogbGV2ZWxGYWN0b3I7XHJcbiAgICBcclxuICAgIHZhciBhbGlnbmVkUGFyYW1zID0gaW1hZ2VIZWxwZXJGdW5jdGlvbnMuYWxpZ25QYXJhbXNUb1RpbGVzQW5kTGV2ZWwoe1xyXG4gICAgICAgIG1pblg6IG1pblgsXHJcbiAgICAgICAgbWluWTogbWluWSxcclxuICAgICAgICBtYXhYRXhjbHVzaXZlOiBtYXhYRXhjbHVzaXZlLFxyXG4gICAgICAgIG1heFlFeGNsdXNpdmU6IG1heFlFeGNsdXNpdmUsXHJcbiAgICAgICAgc2NyZWVuV2lkdGg6IHRoaXMuX3RpbGVXaWR0aCxcclxuICAgICAgICBzY3JlZW5IZWlnaHQ6IHRoaXMuX3RpbGVIZWlnaHRcclxuICAgIH0sIHRoaXMuX2ltYWdlRGVjb2Rlcik7XHJcbiAgICBcclxuICAgIHZhciBzY2FsZWRDYW52YXMgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdjYW52YXMnKTtcclxuICAgIHNjYWxlZENhbnZhcy53aWR0aCA9IHRoaXMuX3RpbGVXaWR0aDtcclxuICAgIHNjYWxlZENhbnZhcy5oZWlnaHQgPSB0aGlzLl90aWxlSGVpZ2h0O1xyXG4gICAgXHJcbiAgICB2YXIgc2NhbGVkQ29udGV4dCA9IHNjYWxlZENhbnZhcy5nZXRDb250ZXh0KCcyZCcpO1xyXG4gICAgc2NhbGVkQ29udGV4dC5jbGVhclJlY3QoMCwgMCwgdGhpcy5fdGlsZVdpZHRoLCB0aGlzLl90aWxlSGVpZ2h0KTtcclxuICAgIFxyXG4gICAgdmFyIHRlbXBQaXhlbFdpZHRoICA9IGFsaWduZWRQYXJhbXMuaW1hZ2VQYXJ0UGFyYW1zLm1heFhFeGNsdXNpdmUgLSBhbGlnbmVkUGFyYW1zLmltYWdlUGFydFBhcmFtcy5taW5YO1xyXG4gICAgdmFyIHRlbXBQaXhlbEhlaWdodCA9IGFsaWduZWRQYXJhbXMuaW1hZ2VQYXJ0UGFyYW1zLm1heFlFeGNsdXNpdmUgLSBhbGlnbmVkUGFyYW1zLmltYWdlUGFydFBhcmFtcy5taW5ZO1xyXG4gICAgaWYgKHRlbXBQaXhlbFdpZHRoIDw9IDAgfHwgdGVtcFBpeGVsSGVpZ2h0IDw9IDApIHtcclxuICAgICAgICByZXR1cm4gc2NhbGVkQ2FudmFzO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICB2YXIgdGVtcENhbnZhcyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2NhbnZhcycpO1xyXG4gICAgdGVtcENhbnZhcy53aWR0aCA9IHRlbXBQaXhlbFdpZHRoO1xyXG4gICAgdGVtcENhbnZhcy5oZWlnaHQgPSB0ZW1wUGl4ZWxIZWlnaHQ7XHJcbiAgICB2YXIgdGVtcENvbnRleHQgPSB0ZW1wQ2FudmFzLmdldENvbnRleHQoJzJkJyk7XHJcbiAgICB0ZW1wQ29udGV4dC5jbGVhclJlY3QoMCwgMCwgdGVtcFBpeGVsV2lkdGgsIHRlbXBQaXhlbEhlaWdodCk7XHJcbiAgICBcclxuICAgIGFsaWduZWRQYXJhbXMuaW1hZ2VQYXJ0UGFyYW1zLnF1YWxpdHkgPSB0aGlzLl9xdWFsaXR5O1xyXG4gICAgYWxpZ25lZFBhcmFtcy5pbWFnZVBhcnRQYXJhbXMucmVxdWVzdFByaW9yaXR5RGF0YSA9IHtcclxuICAgICAgICBpbWFnZVJlY3RhbmdsZTogdGhpcy5fcmVjdGFuZ2xlXHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICB2YXIgcmVzb2x2ZSwgcmVqZWN0O1xyXG4gICAgdmFyIHJlcXVlc3RQaXhlbHNQcm9taXNlID0gbmV3IFByb21pc2UoZnVuY3Rpb24ocmVzb2x2ZV8sIHJlamVjdF8pIHtcclxuICAgICAgICByZXNvbHZlID0gcmVzb2x2ZV87XHJcbiAgICAgICAgcmVqZWN0ID0gcmVqZWN0XztcclxuICAgICAgICBcclxuICAgICAgICBzZWxmLl9pbWFnZURlY29kZXIucmVxdWVzdFBpeGVsc1Byb2dyZXNzaXZlKFxyXG4gICAgICAgICAgICBhbGlnbmVkUGFyYW1zLmltYWdlUGFydFBhcmFtcyxcclxuICAgICAgICAgICAgcGl4ZWxzRGVjb2RlZENhbGxiYWNrLFxyXG4gICAgICAgICAgICB0ZXJtaW5hdGVkQ2FsbGJhY2spO1xyXG4gICAgfSk7XHJcbiAgICBcclxuICAgIGZ1bmN0aW9uIHBpeGVsc0RlY29kZWRDYWxsYmFjayhkZWNvZGVkKSB7XHJcbiAgICAgICAgdmFyIHBhcnRpYWxUaWxlV2lkdGggPSBkZWNvZGVkLmltYWdlRGF0YS53aWR0aDtcclxuICAgICAgICB2YXIgcGFydGlhbFRpbGVIZWlnaHQgPSBkZWNvZGVkLmltYWdlRGF0YS5oZWlnaHQ7XHJcblxyXG4gICAgICAgIGlmIChwYXJ0aWFsVGlsZVdpZHRoID4gMCAmJiBwYXJ0aWFsVGlsZUhlaWdodCA+IDApIHtcclxuICAgICAgICAgICAgdGVtcENvbnRleHQucHV0SW1hZ2VEYXRhKFxyXG4gICAgICAgICAgICAgICAgZGVjb2RlZC5pbWFnZURhdGEsXHJcbiAgICAgICAgICAgICAgICBkZWNvZGVkLnhJbk9yaWdpbmFsUmVxdWVzdCxcclxuICAgICAgICAgICAgICAgIGRlY29kZWQueUluT3JpZ2luYWxSZXF1ZXN0KTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgZnVuY3Rpb24gdGVybWluYXRlZENhbGxiYWNrKGlzQWJvcnRlZCkge1xyXG4gICAgICAgIGlmIChpc0Fib3J0ZWQpIHtcclxuICAgICAgICAgICAgcmVqZWN0KCdGZXRjaCByZXF1ZXN0IG9yIGRlY29kZSBhYm9ydGVkJyk7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgc2NhbGVkQ29udGV4dC5kcmF3SW1hZ2UoXHJcbiAgICAgICAgICAgICAgICB0ZW1wQ2FudmFzLFxyXG4gICAgICAgICAgICAgICAgMCwgMCwgdGVtcFBpeGVsV2lkdGgsIHRlbXBQaXhlbEhlaWdodCxcclxuICAgICAgICAgICAgICAgIGFsaWduZWRQYXJhbXMuY3JvcHBlZFNjcmVlbi5taW5YLCBhbGlnbmVkUGFyYW1zLmNyb3BwZWRTY3JlZW4ubWluWSxcclxuICAgICAgICAgICAgICAgIGFsaWduZWRQYXJhbXMuY3JvcHBlZFNjcmVlbi5tYXhYRXhjbHVzaXZlLCBhbGlnbmVkUGFyYW1zLmNyb3BwZWRTY3JlZW4ubWF4WUV4Y2x1c2l2ZSk7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgcmVzb2x2ZShzY2FsZWRDYW52YXMpO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4gcmVxdWVzdFBpeGVsc1Byb21pc2U7XHJcbn07XHJcblxyXG5JbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlLl9zZXRQcmlvcml0eUJ5RnJ1c3R1bSA9XHJcbiAgICBmdW5jdGlvbiBzZXRQcmlvcml0eUJ5RnJ1c3R1bSgpIHtcclxuICAgIFxyXG4gICAgaWYgKCF0aGlzLl9yZWFkeSkge1xyXG4gICAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIFxyXG4gICAgdmFyIGZydXN0dW1EYXRhID0gY2FsY3VsYXRlQ2VzaXVtRnJ1c3R1bShcclxuICAgICAgICB0aGlzLl9jZXNpdW1XaWRnZXQsIHRoaXMpO1xyXG4gICAgXHJcbiAgICBpZiAoZnJ1c3R1bURhdGEgPT09IG51bGwpIHtcclxuICAgICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGZydXN0dW1EYXRhLmltYWdlUmVjdGFuZ2xlID0gdGhpcy5nZXRSZWN0YW5nbGUoKTtcclxuICAgIGZydXN0dW1EYXRhLmV4YWN0bGV2ZWwgPSBudWxsO1xyXG5cclxuICAgIHRoaXMuX2ltYWdlRGVjb2Rlci5zZXRGZXRjaFByaW9yaXRpemVyRGF0YShmcnVzdHVtRGF0YSk7XHJcbiAgICB0aGlzLl9pbWFnZURlY29kZXIuc2V0RGVjb2RlUHJpb3JpdGl6ZXJEYXRhKGZydXN0dW1EYXRhKTtcclxufTtcclxuXHJcbi8qKlxyXG4gKiBQaWNraW5nIGZlYXR1cmVzIGlzIG5vdCBjdXJyZW50bHkgc3VwcG9ydGVkIGJ5IHRoaXMgaW1hZ2VyeSBwcm92aWRlciwgc28gdGhpcyBmdW5jdGlvbiBzaW1wbHkgcmV0dXJuc1xyXG4gKiB1bmRlZmluZWQuXHJcbiAqXHJcbiAqIEBwYXJhbSB7TnVtYmVyfSB4IFRoZSB0aWxlIFggY29vcmRpbmF0ZS5cclxuICogQHBhcmFtIHtOdW1iZXJ9IHkgVGhlIHRpbGUgWSBjb29yZGluYXRlLlxyXG4gKiBAcGFyYW0ge051bWJlcn0gbGV2ZWwgVGhlIHRpbGUgbGV2ZWwuXHJcbiAqIEBwYXJhbSB7TnVtYmVyfSBsb25naXR1ZGUgVGhlIGxvbmdpdHVkZSBhdCB3aGljaCB0byBwaWNrIGZlYXR1cmVzLlxyXG4gKiBAcGFyYW0ge051bWJlcn0gbGF0aXR1ZGUgIFRoZSBsYXRpdHVkZSBhdCB3aGljaCB0byBwaWNrIGZlYXR1cmVzLlxyXG4gKiBAcmV0dXJuIHtQcm9taXNlfSBBIHByb21pc2UgZm9yIHRoZSBwaWNrZWQgZmVhdHVyZXMgdGhhdCB3aWxsIHJlc29sdmUgd2hlbiB0aGUgYXN5bmNocm9ub3VzXHJcbiAqICAgICAgICAgICAgICAgICAgIHBpY2tpbmcgY29tcGxldGVzLiAgVGhlIHJlc29sdmVkIHZhbHVlIGlzIGFuIGFycmF5IG9mIHtAbGluayBJbWFnZXJ5TGF5ZXJGZWF0dXJlSW5mb31cclxuICogICAgICAgICAgICAgICAgICAgaW5zdGFuY2VzLiAgVGhlIGFycmF5IG1heSBiZSBlbXB0eSBpZiBubyBmZWF0dXJlcyBhcmUgZm91bmQgYXQgdGhlIGdpdmVuIGxvY2F0aW9uLlxyXG4gKiAgICAgICAgICAgICAgICAgICBJdCBtYXkgYWxzbyBiZSB1bmRlZmluZWQgaWYgcGlja2luZyBpcyBub3Qgc3VwcG9ydGVkLlxyXG4gKi9cclxuSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5waWNrRmVhdHVyZXMgPSBmdW5jdGlvbigpIHtcclxuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5fb25FeGNlcHRpb24gPSBmdW5jdGlvbiBvbkV4Y2VwdGlvbihyZWFzb24pIHtcclxuICAgIGlmICh0aGlzLl9leGNlcHRpb25DYWxsYmFjayAhPT0gbnVsbCkge1xyXG4gICAgICAgIHRoaXMuX2V4Y2VwdGlvbkNhbGxiYWNrKHJlYXNvbik7XHJcbiAgICB9XHJcbn07XHJcblxyXG5JbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlLl9vcGVuZWQgPSBmdW5jdGlvbiBvcGVuZWQoKSB7XHJcbiAgICBpZiAodGhpcy5fcmVhZHkpIHtcclxuICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyIGVycm9yOiBvcGVuZWQoKSB3YXMgY2FsbGVkIG1vcmUgdGhhbiBvbmNlISc7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHRoaXMuX3JlYWR5ID0gdHJ1ZTtcclxuXHJcbiAgICAvLyBUaGlzIGlzIHdyb25nIGlmIENPRCBvciBDT0MgZXhpc3RzIGJlc2lkZXMgbWFpbiBoZWFkZXIgQ09EXHJcbiAgICB0aGlzLl9udW1SZXNvbHV0aW9uTGV2ZWxzID0gdGhpcy5faW1hZ2VEZWNvZGVyLmdldE51bVJlc29sdXRpb25MZXZlbHNGb3JMaW1pdHRlZFZpZXdlcigpO1xyXG4gICAgdGhpcy5fcXVhbGl0eSA9IHRoaXMuX2ltYWdlRGVjb2Rlci5nZXRIaWdoZXN0UXVhbGl0eSgpO1xyXG4gICAgdmFyIG1heGltdW1DZXNpdW1MZXZlbCA9IHRoaXMuX251bVJlc29sdXRpb25MZXZlbHMgLSAxO1xyXG4gICAgICAgIFxyXG4gICAgdGhpcy5fdGlsZVdpZHRoID0gdGhpcy5faW1hZ2VEZWNvZGVyLmdldFRpbGVXaWR0aCgpO1xyXG4gICAgdGhpcy5fdGlsZUhlaWdodCA9IHRoaXMuX2ltYWdlRGVjb2Rlci5nZXRUaWxlSGVpZ2h0KCk7XHJcbiAgICAgICAgXHJcbiAgICB2YXIgYmVzdExldmVsV2lkdGggID0gdGhpcy5faW1hZ2VEZWNvZGVyLmdldEltYWdlV2lkdGggKCk7XHJcbiAgICB2YXIgYmVzdExldmVsSGVpZ2h0ID0gdGhpcy5faW1hZ2VEZWNvZGVyLmdldEltYWdlSGVpZ2h0KCk7XHJcbiAgICBcclxuICAgIHZhciBsb3dlc3RMZXZlbFRpbGVzWCA9IE1hdGguY2VpbChiZXN0TGV2ZWxXaWR0aCAgLyB0aGlzLl90aWxlV2lkdGggKSA+PiBtYXhpbXVtQ2VzaXVtTGV2ZWw7XHJcbiAgICB2YXIgbG93ZXN0TGV2ZWxUaWxlc1kgPSBNYXRoLmNlaWwoYmVzdExldmVsSGVpZ2h0IC8gdGhpcy5fdGlsZUhlaWdodCkgPj4gbWF4aW11bUNlc2l1bUxldmVsO1xyXG5cclxuICAgIGltYWdlSGVscGVyRnVuY3Rpb25zLmZpeEJvdW5kcyhcclxuICAgICAgICB0aGlzLl9yZWN0YW5nbGUsXHJcbiAgICAgICAgdGhpcy5faW1hZ2VEZWNvZGVyLFxyXG4gICAgICAgIHRoaXMuX2FkYXB0UHJvcG9ydGlvbnMpO1xyXG4gICAgdmFyIHJlY3RhbmdsZVdpZHRoICA9IHRoaXMuX3JlY3RhbmdsZS5lYXN0ICAtIHRoaXMuX3JlY3RhbmdsZS53ZXN0O1xyXG4gICAgdmFyIHJlY3RhbmdsZUhlaWdodCA9IHRoaXMuX3JlY3RhbmdsZS5ub3J0aCAtIHRoaXMuX3JlY3RhbmdsZS5zb3V0aDtcclxuICAgIFxyXG4gICAgdmFyIGJlc3RMZXZlbFNjYWxlID0gMSA8PCBtYXhpbXVtQ2VzaXVtTGV2ZWw7XHJcbiAgICB2YXIgcGl4ZWxzV2lkdGhGb3JDZXNpdW0gID0gdGhpcy5fdGlsZVdpZHRoICAqIGxvd2VzdExldmVsVGlsZXNYICogYmVzdExldmVsU2NhbGU7XHJcbiAgICB2YXIgcGl4ZWxzSGVpZ2h0Rm9yQ2VzaXVtID0gdGhpcy5fdGlsZUhlaWdodCAqIGxvd2VzdExldmVsVGlsZXNZICogYmVzdExldmVsU2NhbGU7XHJcbiAgICBcclxuICAgIC8vIENlc2l1bSB3b3JrcyB3aXRoIGZ1bGwgdGlsZXMgb25seSwgdGh1cyBmaXggdGhlIGdlb2dyYXBoaWMgYm91bmRzIHNvXHJcbiAgICAvLyB0aGUgcGl4ZWxzIGxpZXMgZXhhY3RseSBvbiB0aGUgb3JpZ2luYWwgYm91bmRzXHJcbiAgICBcclxuICAgIHZhciBnZW9ncmFwaGljV2lkdGhGb3JDZXNpdW0gPVxyXG4gICAgICAgIHJlY3RhbmdsZVdpZHRoICogcGl4ZWxzV2lkdGhGb3JDZXNpdW0gLyBiZXN0TGV2ZWxXaWR0aDtcclxuICAgIHZhciBnZW9ncmFwaGljSGVpZ2h0Rm9yQ2VzaXVtID1cclxuICAgICAgICByZWN0YW5nbGVIZWlnaHQgKiBwaXhlbHNIZWlnaHRGb3JDZXNpdW0gLyBiZXN0TGV2ZWxIZWlnaHQ7XHJcbiAgICBcclxuICAgIHZhciBmaXhlZEVhc3QgID0gdGhpcy5fcmVjdGFuZ2xlLndlc3QgICsgZ2VvZ3JhcGhpY1dpZHRoRm9yQ2VzaXVtO1xyXG4gICAgdmFyIGZpeGVkU291dGggPSB0aGlzLl9yZWN0YW5nbGUubm9ydGggLSBnZW9ncmFwaGljSGVpZ2h0Rm9yQ2VzaXVtO1xyXG4gICAgXHJcbiAgICB0aGlzLl90aWxpbmdTY2hlbWVQYXJhbXMgPSB7XHJcbiAgICAgICAgd2VzdDogdGhpcy5fcmVjdGFuZ2xlLndlc3QsXHJcbiAgICAgICAgZWFzdDogZml4ZWRFYXN0LFxyXG4gICAgICAgIHNvdXRoOiBmaXhlZFNvdXRoLFxyXG4gICAgICAgIG5vcnRoOiB0aGlzLl9yZWN0YW5nbGUubm9ydGgsXHJcbiAgICAgICAgbGV2ZWxaZXJvVGlsZXNYOiBsb3dlc3RMZXZlbFRpbGVzWCxcclxuICAgICAgICBsZXZlbFplcm9UaWxlc1k6IGxvd2VzdExldmVsVGlsZXNZLFxyXG4gICAgICAgIG1heGltdW1MZXZlbDogbWF4aW11bUNlc2l1bUxldmVsXHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICB0aGlzLl90aWxpbmdTY2hlbWUgPSBjcmVhdGVUaWxpbmdTY2hlbWUodGhpcy5fdGlsaW5nU2NoZW1lUGFyYW1zKTtcclxuICAgICAgICBcclxuICAgIENlc2l1bS5UaWxlUHJvdmlkZXJFcnJvci5oYW5kbGVTdWNjZXNzKHRoaXMuX2Vycm9yRXZlbnQpO1xyXG59O1xyXG5cclxuZnVuY3Rpb24gY3JlYXRlVGlsaW5nU2NoZW1lKHBhcmFtcykge1xyXG4gICAgdmFyIGdlb2dyYXBoaWNSZWN0YW5nbGVGb3JDZXNpdW0gPSBuZXcgQ2VzaXVtLlJlY3RhbmdsZShcclxuICAgICAgICBwYXJhbXMud2VzdCwgcGFyYW1zLnNvdXRoLCBwYXJhbXMuZWFzdCwgcGFyYW1zLm5vcnRoKTtcclxuICAgIFxyXG4gICAgdmFyIHRpbGluZ1NjaGVtZSA9IG5ldyBDZXNpdW0uR2VvZ3JhcGhpY1RpbGluZ1NjaGVtZSh7XHJcbiAgICAgICAgcmVjdGFuZ2xlOiBnZW9ncmFwaGljUmVjdGFuZ2xlRm9yQ2VzaXVtLFxyXG4gICAgICAgIG51bWJlck9mTGV2ZWxaZXJvVGlsZXNYOiBwYXJhbXMubGV2ZWxaZXJvVGlsZXNYLFxyXG4gICAgICAgIG51bWJlck9mTGV2ZWxaZXJvVGlsZXNZOiBwYXJhbXMubGV2ZWxaZXJvVGlsZXNZXHJcbiAgICB9KTtcclxuICAgIFxyXG4gICAgcmV0dXJuIHRpbGluZ1NjaGVtZTtcclxufSIsIid1c2Ugc3RyaWN0JztcclxuXHJcbnZhciBJbWFnZURlY29kZXIgPSByZXF1aXJlKCdpbWFnZS1kZWNvZGVyLmpzJyk7XHJcbnZhciBXb3JrZXJQcm94eUltYWdlRGVjb2RlciA9IHJlcXVpcmUoJ3dvcmtlci1wcm94eS1pbWFnZS1kZWNvZGVyLmpzJyk7XHJcbnZhciBpbWFnZUhlbHBlckZ1bmN0aW9ucyA9IHJlcXVpcmUoJ2ltYWdlLWhlbHBlci1mdW5jdGlvbnMuanMnKTtcclxuXHJcbm1vZHVsZS5leHBvcnRzLkltYWdlRGVjb2RlciA9IEltYWdlRGVjb2RlcjtcclxubW9kdWxlLmV4cG9ydHMuV29ya2VyUHJveHlJbWFnZURlY29kZXIgPSBXb3JrZXJQcm94eUltYWdlRGVjb2RlclxyXG5tb2R1bGUuZXhwb3J0cy5JbWFnZURlY29kZXJWaWV3ZXIgPSByZXF1aXJlKCdpbWFnZS1kZWNvZGVyLXZpZXdlci5qcycpO1xyXG5cclxubW9kdWxlLmV4cG9ydHMuU2ltcGxlRmV0Y2hlckJhc2UgPSByZXF1aXJlKCdzaW1wbGUtZmV0Y2hlci1iYXNlLmpzJyk7XHJcbm1vZHVsZS5leHBvcnRzLkdyaWRJbWFnZUJhc2UgPSByZXF1aXJlKCdncmlkLWltYWdlLWJhc2UuanMnKTtcclxubW9kdWxlLmV4cG9ydHMuR3JpZEZldGNoZXJCYXNlID0gcmVxdWlyZSgnZ3JpZC1mZXRjaGVyLWJhc2UuanMnKTtcclxubW9kdWxlLmV4cG9ydHMuR3JpZERlY29kZXJXb3JrZXJCYXNlID0gcmVxdWlyZSgnZ3JpZC1kZWNvZGVyLXdvcmtlci1iYXNlLmpzJyk7XHJcbm1vZHVsZS5leHBvcnRzLkdyaWRMZXZlbENhbGN1bGF0b3IgPSByZXF1aXJlKCdncmlkLWxldmVsLWNhbGN1bGF0b3IuanMnKTtcclxuXHJcbm1vZHVsZS5leHBvcnRzLkNlc2l1bUltYWdlRGVjb2RlckxheWVyTWFuYWdlciA9IHJlcXVpcmUoJ2Nlc2l1bS1pbWFnZS1kZWNvZGVyLWxheWVyLW1hbmFnZXIuanMnKTtcclxubW9kdWxlLmV4cG9ydHMuSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyID0gcmVxdWlyZSgnaW1hZ2UtZGVjb2Rlci1pbWFnZXJ5LXByb3ZpZGVyLmpzJyk7XHJcbm1vZHVsZS5leHBvcnRzLkltYWdlRGVjb2RlclJlZ2lvbkxheWVyID0gcmVxdWlyZSgnaW1hZ2UtZGVjb2Rlci1yZWdpb24tbGF5ZXIuanMnKTsiLCIndXNlIHN0cmljdCc7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IERlY29kZUpvYjtcclxuXHJcbnZhciBMaW5rZWRMaXN0ID0gcmVxdWlyZSgnbGlua2VkLWxpc3QuanMnKTtcclxuXHJcbnZhciByZXF1ZXN0SWRDb3VudGVyID0gMDtcclxuXHJcbmZ1bmN0aW9uIERlY29kZUpvYihsaXN0ZW5lckhhbmRsZSwgaW1hZ2VQYXJ0UGFyYW1zKSB7XHJcbiAgICB0aGlzLl9wcm9ncmVzc2l2ZVN0YWdlc0RvbmUgPSAwO1xyXG4gICAgdGhpcy5fbGlzdGVuZXJIYW5kbGUgPSBsaXN0ZW5lckhhbmRsZTtcclxuICAgIHRoaXMuX2ltYWdlUGFydFBhcmFtcyA9IGltYWdlUGFydFBhcmFtcztcclxuICAgIHRoaXMuX2FsbFJlbGV2YW50Qnl0ZXNMb2FkZWQgPSAwO1xyXG4gICAgdmFyIHJlcXVlc3RQYXJhbXMgPSBsaXN0ZW5lckhhbmRsZS5pbWFnZVBhcnRQYXJhbXM7XHJcbiAgICB0aGlzLl9vZmZzZXRYID0gaW1hZ2VQYXJ0UGFyYW1zLm1pblggLSByZXF1ZXN0UGFyYW1zLm1pblg7XHJcbiAgICB0aGlzLl9vZmZzZXRZID0gaW1hZ2VQYXJ0UGFyYW1zLm1pblkgLSByZXF1ZXN0UGFyYW1zLm1pblk7XHJcbiAgICB0aGlzLl9yZXF1ZXN0V2lkdGggPSByZXF1ZXN0UGFyYW1zLm1heFhFeGNsdXNpdmUgLSByZXF1ZXN0UGFyYW1zLm1pblg7XHJcbiAgICB0aGlzLl9yZXF1ZXN0SGVpZ2h0ID0gcmVxdWVzdFBhcmFtcy5tYXhZRXhjbHVzaXZlIC0gcmVxdWVzdFBhcmFtcy5taW5ZO1xyXG59XHJcblxyXG5EZWNvZGVKb2IucHJvdG90eXBlLm9uRGF0YSA9IGZ1bmN0aW9uIG9uRGF0YShkZWNvZGVSZXN1bHQpIHtcclxuICAgICsrdGhpcy5fcHJvZ3Jlc3NpdmVTdGFnZXNEb25lO1xyXG5cclxuICAgIHZhciByZWxldmFudEJ5dGVzTG9hZGVkRGlmZiA9XHJcbiAgICAgICAgZGVjb2RlUmVzdWx0LmFsbFJlbGV2YW50Qnl0ZXNMb2FkZWQgLSB0aGlzLl9hbGxSZWxldmFudEJ5dGVzTG9hZGVkO1xyXG4gICAgdGhpcy5fYWxsUmVsZXZhbnRCeXRlc0xvYWRlZCA9IGRlY29kZVJlc3VsdC5hbGxSZWxldmFudEJ5dGVzTG9hZGVkO1xyXG4gICAgdGhpcy5fbGlzdGVuZXJIYW5kbGUuYWxsUmVsZXZhbnRCeXRlc0xvYWRlZCArPSByZWxldmFudEJ5dGVzTG9hZGVkRGlmZjtcclxuICAgIFxyXG4gICAgdmFyIGRlY29kZWRPZmZzZXR0ZWQgPSB7XHJcbiAgICAgICAgb3JpZ2luYWxSZXF1ZXN0V2lkdGg6IHRoaXMuX3JlcXVlc3RXaWR0aCxcclxuICAgICAgICBvcmlnaW5hbFJlcXVlc3RIZWlnaHQ6IHRoaXMuX3JlcXVlc3RIZWlnaHQsXHJcbiAgICAgICAgeEluT3JpZ2luYWxSZXF1ZXN0OiB0aGlzLl9vZmZzZXRYLFxyXG4gICAgICAgIHlJbk9yaWdpbmFsUmVxdWVzdDogdGhpcy5fb2Zmc2V0WSxcclxuICAgICAgICBcclxuICAgICAgICBpbWFnZURhdGE6IGRlY29kZVJlc3VsdCxcclxuICAgICAgICBcclxuICAgICAgICBhbGxSZWxldmFudEJ5dGVzTG9hZGVkOiB0aGlzLl9saXN0ZW5lckhhbmRsZS5hbGxSZWxldmFudEJ5dGVzTG9hZGVkXHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICB0aGlzLl9saXN0ZW5lckhhbmRsZS5jYWxsYmFjayhkZWNvZGVkT2Zmc2V0dGVkKTtcclxufTtcclxuXHJcbkRlY29kZUpvYi5wcm90b3R5cGUub25UZXJtaW5hdGVkID0gZnVuY3Rpb24gb25UZXJtaW5hdGVkKCkge1xyXG4gICAgLy90aGlzLl9saXN0ZW5lckhhbmRsZS5pc0FueURlY29kZXJBYm9ydGVkIHw9IHRoaXMuX2lzQWJvcnRlZDtcclxuICAgIFxyXG4gICAgdmFyIHJlbWFpbmluZyA9IC0tdGhpcy5fbGlzdGVuZXJIYW5kbGUucmVtYWluaW5nRGVjb2RlSm9icztcclxuICAgIGlmIChyZW1haW5pbmcgPCAwKSB7XHJcbiAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogSW5jb25zaXN0ZW50IG51bWJlciBvZiBkb25lIHJlcXVlc3RzJztcclxuICAgIH1cclxuICAgIFxyXG4gICAgdmFyIGlzTGlzdGVuZXJEb25lID0gcmVtYWluaW5nID09PSAwO1xyXG4gICAgaWYgKGlzTGlzdGVuZXJEb25lKSB7XHJcbiAgICAgICAgdGhpcy5fbGlzdGVuZXJIYW5kbGUuaXNUZXJtaW5hdGVkQ2FsbGJhY2tDYWxsZWQgPSB0cnVlO1xyXG4gICAgICAgIHRoaXMuX2xpc3RlbmVySGFuZGxlLnRlcm1pbmF0ZWRDYWxsYmFjayhcclxuICAgICAgICAgICAgdGhpcy5fbGlzdGVuZXJIYW5kbGUuaXNBbnlEZWNvZGVyQWJvcnRlZCk7XHJcbiAgICB9XHJcbn07XHJcblxyXG5PYmplY3QuZGVmaW5lUHJvcGVydHkoRGVjb2RlSm9iLnByb3RvdHlwZSwgJ2ltYWdlUGFydFBhcmFtcycsIHtcclxuICAgIGdldDogZnVuY3Rpb24gZ2V0SW1hZ2VQYXJ0UGFyYW1zKCkge1xyXG4gICAgICAgIHJldHVybiB0aGlzLl9pbWFnZVBhcnRQYXJhbXM7XHJcbiAgICB9XHJcbn0pO1xyXG5cclxuT2JqZWN0LmRlZmluZVByb3BlcnR5KERlY29kZUpvYi5wcm90b3R5cGUsICdwcm9ncmVzc2l2ZVN0YWdlc0RvbmUnLCB7XHJcbiAgICBnZXQ6IGZ1bmN0aW9uIGdldFByb2dyZXNzaXZlU3RhZ2VzRG9uZSgpIHtcclxuICAgICAgICByZXR1cm4gdGhpcy5fcHJvZ3Jlc3NpdmVTdGFnZXNEb25lO1xyXG4gICAgfVxyXG59KTsiLCIndXNlIHN0cmljdCc7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IERlY29kZUpvYnNQb29sO1xyXG5cclxudmFyIERlY29kZUpvYiA9IHJlcXVpcmUoJ2RlY29kZS1qb2IuanMnKTtcclxuXHJcbmZ1bmN0aW9uIERlY29kZUpvYnNQb29sKFxyXG4gICAgZGVjb2RlRGVwZW5kZW5jeVdvcmtlcnMsXHJcbiAgICBwcmlvcml0aXplcixcclxuICAgIHRpbGVXaWR0aCxcclxuICAgIHRpbGVIZWlnaHQpIHtcclxuICAgIFxyXG4gICAgdGhpcy5fcHJpb3JpdGl6ZXIgPSBwcmlvcml0aXplcjtcclxuICAgIHRoaXMuX3RpbGVXaWR0aCA9IHRpbGVXaWR0aDtcclxuICAgIHRoaXMuX3RpbGVIZWlnaHQgPSB0aWxlSGVpZ2h0O1xyXG4gICAgXHJcbiAgICB0aGlzLl9kZWNvZGVEZXBlbmRlbmN5V29ya2VycyA9IGRlY29kZURlcGVuZGVuY3lXb3JrZXJzO1xyXG59XHJcblxyXG5EZWNvZGVKb2JzUG9vbC5wcm90b3R5cGUuZm9ya0RlY29kZUpvYnMgPSBmdW5jdGlvbiBmb3JrRGVjb2RlSm9icyhcclxuICAgIGltYWdlUGFydFBhcmFtcyxcclxuICAgIGNhbGxiYWNrLFxyXG4gICAgdGVybWluYXRlZENhbGxiYWNrLFxyXG4gICAgaW1hZ2VQYXJ0UGFyYW1zTm90TmVlZGVkKSB7XHJcbiAgICBcclxuICAgIHZhciBtaW5YID0gaW1hZ2VQYXJ0UGFyYW1zLm1pblg7XHJcbiAgICB2YXIgbWluWSA9IGltYWdlUGFydFBhcmFtcy5taW5ZO1xyXG4gICAgdmFyIG1heFggPSBpbWFnZVBhcnRQYXJhbXMubWF4WEV4Y2x1c2l2ZTtcclxuICAgIHZhciBtYXhZID0gaW1hZ2VQYXJ0UGFyYW1zLm1heFlFeGNsdXNpdmU7XHJcbiAgICB2YXIgbGV2ZWwgPSBpbWFnZVBhcnRQYXJhbXMubGV2ZWwgfHwgMDtcclxuICAgIHZhciBxdWFsaXR5ID0gaW1hZ2VQYXJ0UGFyYW1zLnF1YWxpdHk7XHJcbiAgICB2YXIgcHJpb3JpdHlEYXRhID0gaW1hZ2VQYXJ0UGFyYW1zLnJlcXVlc3RQcmlvcml0eURhdGE7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgIHZhciBpc01pbkFsaWduZWQgPVxyXG4gICAgICAgIG1pblggJSB0aGlzLl90aWxlV2lkdGggPT09IDAgJiYgbWluWSAlIHRoaXMuX3RpbGVIZWlnaHQgPT09IDA7XHJcbiAgICB2YXIgaXNNYXhYQWxpZ25lZCA9IG1heFggJSB0aGlzLl90aWxlV2lkdGggID09PSAwIHx8IG1heFggPT09IGltYWdlUGFydFBhcmFtcy5sZXZlbFdpZHRoO1xyXG4gICAgdmFyIGlzTWF4WUFsaWduZWQgPSBtYXhZICUgdGhpcy5fdGlsZUhlaWdodCA9PT0gMCB8fCBtYXhZID09PSBpbWFnZVBhcnRQYXJhbXMubGV2ZWxIZWlnaHQ7XHJcbiAgICB2YXIgaXNPcmRlclZhbGlkID0gbWluWCA8IG1heFggJiYgbWluWSA8IG1heFk7XHJcbiAgICBcclxuICAgIGlmICghaXNNaW5BbGlnbmVkIHx8ICFpc01heFhBbGlnbmVkIHx8ICFpc01heFlBbGlnbmVkIHx8ICFpc09yZGVyVmFsaWQpIHtcclxuICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBpbWFnZVBhcnRQYXJhbXMgZm9yIGRlY29kZXJzIGlzIG5vdCBhbGlnbmVkIHRvICcgK1xyXG4gICAgICAgICAgICAndGlsZSBzaXplIG9yIG5vdCBpbiB2YWxpZCBvcmRlcic7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHZhciBudW1UaWxlc1ggPSBNYXRoLmNlaWwoKG1heFggLSBtaW5YKSAvIHRoaXMuX3RpbGVXaWR0aCk7XHJcbiAgICB2YXIgbnVtVGlsZXNZID0gTWF0aC5jZWlsKChtYXhZIC0gbWluWSkgLyB0aGlzLl90aWxlSGVpZ2h0KTtcclxuICAgIFxyXG4gICAgdmFyIGxpc3RlbmVySGFuZGxlID0ge1xyXG4gICAgICAgIGltYWdlUGFydFBhcmFtczogaW1hZ2VQYXJ0UGFyYW1zLFxyXG4gICAgICAgIGNhbGxiYWNrOiBjYWxsYmFjayxcclxuICAgICAgICB0ZXJtaW5hdGVkQ2FsbGJhY2s6IHRlcm1pbmF0ZWRDYWxsYmFjayxcclxuICAgICAgICByZW1haW5pbmdEZWNvZGVKb2JzOiBudW1UaWxlc1ggKiBudW1UaWxlc1ksXHJcbiAgICAgICAgaXNBbnlEZWNvZGVyQWJvcnRlZDogZmFsc2UsXHJcbiAgICAgICAgaXNUZXJtaW5hdGVkQ2FsbGJhY2tDYWxsZWQ6IGZhbHNlLFxyXG4gICAgICAgIGFsbFJlbGV2YW50Qnl0ZXNMb2FkZWQ6IDAsXHJcbiAgICAgICAgdGFza0NvbnRleHRzOiBbXVxyXG4gICAgfTtcclxuICAgIFxyXG4gICAgZm9yICh2YXIgeCA9IG1pblg7IHggPCBtYXhYOyB4ICs9IHRoaXMuX3RpbGVXaWR0aCkge1xyXG4gICAgICAgIHZhciBzaW5nbGVUaWxlTWF4WCA9IE1hdGgubWluKHggKyB0aGlzLl90aWxlV2lkdGgsIGltYWdlUGFydFBhcmFtcy5sZXZlbFdpZHRoKTtcclxuICAgICAgICBcclxuICAgICAgICBmb3IgKHZhciB5ID0gbWluWTsgeSA8IG1heFk7IHkgKz0gdGhpcy5fdGlsZUhlaWdodCkge1xyXG4gICAgICAgICAgICB2YXIgc2luZ2xlVGlsZU1heFkgPSBNYXRoLm1pbih5ICsgdGhpcy5fdGlsZUhlaWdodCwgaW1hZ2VQYXJ0UGFyYW1zLmxldmVsSGVpZ2h0KTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHZhciBpc1RpbGVOb3ROZWVkZWQgPSBpc1VubmVlZGVkKFxyXG4gICAgICAgICAgICAgICAgeCxcclxuICAgICAgICAgICAgICAgIHksXHJcbiAgICAgICAgICAgICAgICBzaW5nbGVUaWxlTWF4WCxcclxuICAgICAgICAgICAgICAgIHNpbmdsZVRpbGVNYXhZLFxyXG4gICAgICAgICAgICAgICAgaW1hZ2VQYXJ0UGFyYW1zTm90TmVlZGVkKTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBpZiAoaXNUaWxlTm90TmVlZGVkKSB7XHJcbiAgICAgICAgICAgICAgICAtLWxpc3RlbmVySGFuZGxlLnJlbWFpbmluZ0RlY29kZUpvYnM7XHJcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgdmFyIHNpbmdsZVRpbGVJbWFnZVBhcnRQYXJhbXMgPSB7XHJcbiAgICAgICAgICAgICAgICBtaW5YOiB4LFxyXG4gICAgICAgICAgICAgICAgbWluWTogeSxcclxuICAgICAgICAgICAgICAgIG1heFhFeGNsdXNpdmU6IHNpbmdsZVRpbGVNYXhYLFxyXG4gICAgICAgICAgICAgICAgbWF4WUV4Y2x1c2l2ZTogc2luZ2xlVGlsZU1heFksXHJcbiAgICAgICAgICAgICAgICBsZXZlbFdpZHRoOiBpbWFnZVBhcnRQYXJhbXMubGV2ZWxXaWR0aCxcclxuICAgICAgICAgICAgICAgIGxldmVsSGVpZ2h0OiBpbWFnZVBhcnRQYXJhbXMubGV2ZWxIZWlnaHQsXHJcbiAgICAgICAgICAgICAgICBsZXZlbDogbGV2ZWwsXHJcbiAgICAgICAgICAgICAgICBxdWFsaXR5OiBxdWFsaXR5LFxyXG4gICAgICAgICAgICAgICAgcmVxdWVzdFByaW9yaXR5RGF0YTogcHJpb3JpdHlEYXRhXHJcbiAgICAgICAgICAgIH07XHJcblxyXG4gICAgICAgICAgICB0aGlzLl9zdGFydE5ld1Rhc2sobGlzdGVuZXJIYW5kbGUsIHNpbmdsZVRpbGVJbWFnZVBhcnRQYXJhbXMpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGlmICghbGlzdGVuZXJIYW5kbGUuaXNUZXJtaW5hdGVkQ2FsbGJhY2tDYWxsZWQgJiZcclxuICAgICAgICBsaXN0ZW5lckhhbmRsZS5yZW1haW5pbmdEZWNvZGVKb2JzID09PSAwKSB7XHJcbiAgICAgICAgXHJcbiAgICAgICAgbGlzdGVuZXJIYW5kbGUuaXNUZXJtaW5hdGVkQ2FsbGJhY2tDYWxsZWQgPSB0cnVlO1xyXG4gICAgICAgIGxpc3RlbmVySGFuZGxlLnRlcm1pbmF0ZWRDYWxsYmFjayhsaXN0ZW5lckhhbmRsZS5pc0FueURlY29kZXJBYm9ydGVkKTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgcmV0dXJuIGxpc3RlbmVySGFuZGxlO1xyXG59O1xyXG5cclxuRGVjb2RlSm9ic1Bvb2wucHJvdG90eXBlLl9zdGFydE5ld1Rhc2sgPSBmdW5jdGlvbiBzdGFydE5ld1Rhc2sobGlzdGVuZXJIYW5kbGUsIGltYWdlUGFydFBhcmFtcykge1xyXG4gICAgdmFyIGRlY29kZUpvYiA9IG5ldyBEZWNvZGVKb2IobGlzdGVuZXJIYW5kbGUsIGltYWdlUGFydFBhcmFtcyk7XHJcbiAgICB2YXIgdGFza0NvbnRleHQgPSB0aGlzLl9kZWNvZGVEZXBlbmRlbmN5V29ya2Vycy5zdGFydFRhc2soaW1hZ2VQYXJ0UGFyYW1zLCBkZWNvZGVKb2IpO1xyXG4gICAgbGlzdGVuZXJIYW5kbGUudGFza0NvbnRleHRzLnB1c2godGFza0NvbnRleHQpO1xyXG4gICAgXHJcbiAgICBpZiAodGhpcy5fcHJpb3JpdGl6ZXIgPT09IG51bGwpIHtcclxuICAgICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHZhciBzZWxmID0gdGhpcztcclxuICAgIFxyXG4gICAgdGFza0NvbnRleHQuc2V0UHJpb3JpdHlDYWxjdWxhdG9yKGZ1bmN0aW9uKCkge1xyXG4gICAgICAgIHJldHVybiBzZWxmLl9wcmlvcml0aXplci5nZXRQcmlvcml0eShkZWNvZGVKb2IpO1xyXG4gICAgfSk7XHJcbn07XHJcblxyXG5EZWNvZGVKb2JzUG9vbC5wcm90b3R5cGUudW5yZWdpc3RlckZvcmtlZEpvYnMgPSBmdW5jdGlvbiB1bnJlZ2lzdGVyRm9ya2VkSm9icyhcclxuICAgIGxpc3RlbmVySGFuZGxlKSB7XHJcbiAgICAgICAgICAgIFxyXG4gICAgaWYgKGxpc3RlbmVySGFuZGxlLnJlbWFpbmluZ0RlY29kZUpvYnMgPT09IDApIHtcclxuICAgICAgICAvLyBBbGwgam9icyBoYXMgYWxyZWFkeSBiZWVuIHRlcm1pbmF0ZWQsIG5vIG5lZWQgdG8gdW5yZWdpc3RlclxyXG4gICAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIFxyXG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBsaXN0ZW5lckhhbmRsZS50YXNrQ29udGV4dHMubGVuZ3RoOyArK2kpIHtcclxuICAgICAgICBsaXN0ZW5lckhhbmRsZS50YXNrQ29udGV4dHNbaV0udW5yZWdpc3RlcigpO1xyXG4gICAgfVxyXG59O1xyXG5cclxuZnVuY3Rpb24gaXNVbm5lZWRlZChcclxuICAgIG1pblgsIG1pblksIG1heFgsIG1heFksIGltYWdlUGFydFBhcmFtc05vdE5lZWRlZCkge1xyXG4gICAgXHJcbiAgICBpZiAoaW1hZ2VQYXJ0UGFyYW1zTm90TmVlZGVkID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICByZXR1cm4gZmFsc2U7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgaW1hZ2VQYXJ0UGFyYW1zTm90TmVlZGVkLmxlbmd0aDsgKytpKSB7XHJcbiAgICAgICAgdmFyIG5vdE5lZWRlZCA9IGltYWdlUGFydFBhcmFtc05vdE5lZWRlZFtpXTtcclxuICAgICAgICB2YXIgaXNJblggPSBtaW5YID49IG5vdE5lZWRlZC5taW5YICYmIG1heFggPD0gbm90TmVlZGVkLm1heFhFeGNsdXNpdmU7XHJcbiAgICAgICAgdmFyIGlzSW5ZID0gbWluWSA+PSBub3ROZWVkZWQubWluWSAmJiBtYXhZIDw9IG5vdE5lZWRlZC5tYXhZRXhjbHVzaXZlO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGlmIChpc0luWCAmJiBpc0luWSkge1xyXG4gICAgICAgICAgICByZXR1cm4gdHJ1ZTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHJldHVybiBmYWxzZTtcclxufSIsIid1c2Ugc3RyaWN0JztcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gRmV0Y2hDb250ZXh0QXBpO1xyXG5cclxuZnVuY3Rpb24gRmV0Y2hDb250ZXh0QXBpKCkge1xyXG4gICAgdGhpcy5fZXZlbnRzID0ge1xyXG4gICAgICAgIGlzUHJvZ3Jlc3NpdmVDaGFuZ2VkOiBbXSxcclxuICAgICAgICBtb3ZlOiBbXSxcclxuICAgICAgICB0ZXJtaW5hdGU6IFtdLFxyXG4gICAgICAgIFxyXG4gICAgICAgIHN0b3A6IFtdLFxyXG4gICAgICAgIHJlc3VtZTogW10sXHJcbiAgICAgICAgXHJcbiAgICAgICAgaW50ZXJuYWxTdG9wcGVkOiBbXSxcclxuICAgICAgICBpbnRlcm5hbERvbmU6IFtdXHJcbiAgICB9O1xyXG59XHJcblxyXG5GZXRjaENvbnRleHRBcGkucHJvdG90eXBlLnN0b3BwZWQgPSBmdW5jdGlvbiBzdG9wcGVkKCkge1xyXG4gICAgdGhpcy5fb25FdmVudCgnaW50ZXJuYWxTdG9wcGVkJywgLyppc0Fib3J0ZWQ9Ki9mYWxzZSk7XHJcbn07XHJcblxyXG5GZXRjaENvbnRleHRBcGkucHJvdG90eXBlLmRvbmUgPSBmdW5jdGlvbiBkb25lKCkge1xyXG4gICAgdGhpcy5fb25FdmVudCgnaW50ZXJuYWxEb25lJyk7XHJcbn07XHJcblxyXG5GZXRjaENvbnRleHRBcGkucHJvdG90eXBlLm9uID0gZnVuY3Rpb24gb24oZXZlbnQsIGxpc3RlbmVyLCBsaXN0ZW5lclRoaXMpIHtcclxuICAgIHZhciBsaXN0ZW5lcnMgPSB0aGlzLl9ldmVudHNbZXZlbnRdO1xyXG4gICAgaWYgKCFsaXN0ZW5lcnMpIHtcclxuICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBldmVudCAnICsgZXZlbnQgKyAnIGRvZXMgbm90IGV4aXN0IGluIEZldGNoQ29udGV4dCc7XHJcbiAgICB9XHJcbiAgICBsaXN0ZW5lcnMucHVzaCh7XHJcbiAgICAgICAgbGlzdGVuZXI6IGxpc3RlbmVyLFxyXG4gICAgICAgIGxpc3RlbmVyVGhpczogbGlzdGVuZXJUaGlzIHx8IHRoaXNcclxuICAgIH0pO1xyXG4gICAgXHJcbiAgICByZXR1cm4gdGhpcztcclxufTtcclxuXHJcbkZldGNoQ29udGV4dEFwaS5wcm90b3R5cGUuX29uRXZlbnQgPSBmdW5jdGlvbiBvbkV2ZW50KGV2ZW50LCBhcmcxLCBhcmcyKSB7XHJcbiAgICB2YXIgbGlzdGVuZXJzID0gdGhpcy5fZXZlbnRzW2V2ZW50XTtcclxuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgbGlzdGVuZXJzLmxlbmd0aDsgKytpKSB7XHJcbiAgICAgICAgbGlzdGVuZXJzW2ldLmxpc3RlbmVyLmNhbGwobGlzdGVuZXJzW2ldLmxpc3RlbmVyVGhpcywgYXJnMSwgYXJnMik7XHJcbiAgICB9XHJcbn07IiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxudmFyIEZldGNoQ29udGV4dEFwaSA9IHJlcXVpcmUoJ2ZldGNoLWNvbnRleHQtYXBpLmpzJyk7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IEZldGNoQ29udGV4dDtcclxuXHJcbkZldGNoQ29udGV4dC5GRVRDSF9UWVBFX1JFUVVFU1QgPSAxO1xyXG5GZXRjaENvbnRleHQuRkVUQ0hfVFlQRV9NT1ZBQkxFID0gMjsgLy8gbW92YWJsZVxyXG5GZXRjaENvbnRleHQuRkVUQ0hfVFlQRV9PTkxZX1dBSVRfRk9SX0RBVEEgPSAzO1xyXG5cclxuRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19XQUlUX0ZPUl9GRVRDSF9DQUxMID0gMTtcclxuRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19NT1ZBQkxFX1dBSVRfRk9SX01PVkVfQ0FMTCA9IDI7XHJcbkZldGNoQ29udGV4dC5GRVRDSF9TVEFUVVNfUkVRVUVTVF9XQUlUX0ZPUl9TQ0hFRFVMRSA9IDM7XHJcbkZldGNoQ29udGV4dC5GRVRDSF9TVEFUVVNfQUNUSVZFID0gNDtcclxuRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19SRVFVRVNUX0FCT1VUX1RPX1lJRUxEID0gNTtcclxuRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19SRVFVRVNUX1lJRUxERUQgPSA2O1xyXG5GZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX1JFUVVFU1RfQUJPVVRfVE9fQUJPUlQgPSA3O1xyXG5GZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX1JFUVVFU1RfVEVSTUlOQVRFRCA9IDg7XHJcbkZldGNoQ29udGV4dC5GRVRDSF9TVEFUVVNfVU5FWFBFQ1RFRF9GQUlMVVJFID0gOTtcclxuXHJcbmZ1bmN0aW9uIEZldGNoQ29udGV4dChmZXRjaGVyLCBmZXRjaGVyQ2xvc2VyLCBzY2hlZHVsZXIsIHNjaGVkdWxlZEpvYnNMaXN0LCBmZXRjaFR5cGUsIGNvbnRleHRWYXJzKSB7XHJcbiAgICB0aGlzLl9mZXRjaGVyID0gZmV0Y2hlcjtcclxuICAgIHRoaXMuX2ZldGNoZXJDbG9zZXIgPSBmZXRjaGVyQ2xvc2VyO1xyXG4gICAgdGhpcy5fc2NoZWR1bGVyID0gc2NoZWR1bGVyO1xyXG4gICAgdGhpcy5fc2NoZWR1bGVkSm9ic0xpc3QgPSBzY2hlZHVsZWRKb2JzTGlzdDtcclxuICAgIHRoaXMuX3NjaGVkdWxlZEpvYnNMaXN0SXRlcmF0b3IgPSBudWxsO1xyXG4gICAgXHJcbiAgICB0aGlzLl90ZXJtaW5hdGVkTGlzdGVuZXJzID0gW107XHJcbiAgICBcclxuICAgIHRoaXMuX2ltYWdlUGFydFBhcmFtcyA9IG51bGw7XHJcbiAgICBcclxuICAgIHRoaXMuX3N0YXRlID0gRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19XQUlUX0ZPUl9GRVRDSF9DQUxMO1xyXG4gICAgdGhpcy5faXNNb3ZhYmxlID0gZmV0Y2hUeXBlID09PSBGZXRjaENvbnRleHQuRkVUQ0hfVFlQRV9NT1ZBQkxFO1xyXG4gICAgdGhpcy5fY29udGV4dFZhcnMgPSBjb250ZXh0VmFycztcclxuICAgIHRoaXMuX2lzT25seVdhaXRGb3JEYXRhID0gZmV0Y2hUeXBlID09PSBGZXRjaENvbnRleHQuRkVUQ0hfVFlQRV9PTkxZX1dBSVRfRk9SX0RBVEE7XHJcbiAgICB0aGlzLl91c2VTY2hlZHVsZXIgPSBmZXRjaFR5cGUgPT09IEZldGNoQ29udGV4dC5GRVRDSF9UWVBFX1JFUVVFU1Q7XHJcbiAgICB0aGlzLl9yZXNvdXJjZSA9IG51bGw7XHJcbiAgICB0aGlzLl9mZXRjaENvbnRleHRBcGkgPSBudWxsO1xyXG4gICAgLy90aGlzLl9hbHJlYWR5VGVybWluYXRlZFdoZW5BbGxEYXRhQXJyaXZlZCA9IGZhbHNlO1xyXG59XHJcblxyXG5GZXRjaENvbnRleHQucHJvdG90eXBlLmZldGNoID0gZnVuY3Rpb24gZmV0Y2goaW1hZ2VQYXJ0UGFyYW1zKSB7XHJcbiAgICBpZiAodGhpcy5faXNNb3ZhYmxlKSB7XHJcbiAgICAgICAgdGhpcy5faW1hZ2VQYXJ0UGFyYW1zID0gaW1hZ2VQYXJ0UGFyYW1zO1xyXG4gICAgICAgIHRoaXMuX3N0YXJ0RmV0Y2goKTtcclxuICAgICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGlmICh0aGlzLl9pbWFnZVBhcnRQYXJhbXMgIT09IG51bGwpIHtcclxuICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBDYW5ub3QgZmV0Y2ggdHdpY2Ugb24gZmV0Y2ggdHlwZSBvZiBcInJlcXVlc3RcIic7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGlmICh0aGlzLl9zdGF0ZSAhPT0gRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19XQUlUX0ZPUl9GRVRDSF9DQUxMKSB7XHJcbiAgICAgICAgdGhpcy5fc3RhdGUgPSBGZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX1VORVhQRUNURURfRkFJTFVSRTtcclxuICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBVbmV4cGVjdGVkIHN0YXRlIG9uIGZldGNoKCk6ICcgKyB0aGlzLl9zdGF0ZTtcclxuICAgIH1cclxuXHJcbiAgICB0aGlzLl9pbWFnZVBhcnRQYXJhbXMgPSBpbWFnZVBhcnRQYXJhbXM7XHJcbiAgICB0aGlzLl9zdGF0ZSA9IEZldGNoQ29udGV4dC5GRVRDSF9TVEFUVVNfUkVRVUVTVF9XQUlUX0ZPUl9TQ0hFRFVMRTtcclxuICAgIFxyXG4gICAgaWYgKCF0aGlzLl91c2VTY2hlZHVsZXIpIHtcclxuICAgICAgICBzdGFydFJlcXVlc3QoLypyZXNvdXJjZT0qL251bGwsIHRoaXMpO1xyXG4gICAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIFxyXG4gICAgdGhpcy5fc2NoZWR1bGVyLmVucXVldWVKb2Ioc3RhcnRSZXF1ZXN0LCB0aGlzLCBmZXRjaEFib3J0ZWRCeVNjaGVkdWxlcik7XHJcbn07XHJcblxyXG5GZXRjaENvbnRleHQucHJvdG90eXBlLm1hbnVhbEFib3J0UmVxdWVzdCA9IGZ1bmN0aW9uIG1hbnVhbEFib3J0UmVxdWVzdCgpIHtcclxuICAgIHN3aXRjaCAodGhpcy5fc3RhdGUpIHtcclxuICAgICAgICBjYXNlIEZldGNoQ29udGV4dC5GRVRDSF9TVEFUVVNfUkVRVUVTVF9URVJNSU5BVEVEOlxyXG4gICAgICAgIGNhc2UgRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19VTkVYUEVDVEVEX0ZBSUxVUkU6XHJcbiAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICBjYXNlIEZldGNoQ29udGV4dC5GRVRDSF9TVEFUVVNfUkVRVUVTVF9BQk9VVF9UT19BQk9SVDpcclxuICAgICAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogRG91YmxlIGNhbGwgdG8gbWFudWFsQWJvcnRSZXF1ZXN0KCknO1xyXG4gICAgICAgIGNhc2UgRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19BQ1RJVkU6XHJcbiAgICAgICAgICAgIHRoaXMuX3N0YXRlID0gRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19SRVFVRVNUX0FCT1VUX1RPX0FCT1JUO1xyXG4gICAgICAgICAgICBpZiAodGhpcy5faXNPbmx5V2FpdEZvckRhdGEpIHtcclxuICAgICAgICAgICAgICAgIHRoaXMuX2ZldGNoU3RvcHBlZCgvKmlzQWJvcnRlZD0qL3RydWUpO1xyXG4gICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgdGhpcy5fZmV0Y2hDb250ZXh0QXBpLl9vbkV2ZW50KCdzdG9wJywgLyppc0Fib3J0ZWQ9Ki90cnVlKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBicmVhaztcclxuICAgICAgICBjYXNlIEZldGNoQ29udGV4dC5GRVRDSF9TVEFUVVNfV0FJVF9GT1JfRkVUQ0hfQ0FMTDpcclxuICAgICAgICAgICAgdGhpcy5fc3RhdGUgPSBGZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX1JFUVVFU1RfVEVSTUlOQVRFRDtcclxuICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgIGNhc2UgRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19SRVFVRVNUX1dBSVRfRk9SX1NDSEVEVUxFOlxyXG4gICAgICAgIGNhc2UgRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19SRVFVRVNUX0FCT1VUX1RPX1lJRUxEOlxyXG4gICAgICAgIGNhc2UgRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19SRVFVRVNUX1lJRUxERUQ6XHJcbiAgICAgICAgICAgIHRoaXMuX3N0YXRlID0gRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19SRVFVRVNUX0FCT1VUX1RPX0FCT1JUO1xyXG4gICAgICAgICAgICBicmVhaztcclxuICAgICAgICBkZWZhdWx0OlxyXG4gICAgICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBVbmtub3duIHN0YXRlIGluIG1hbnVhbEFib3J0UmVxdWVzdCgpIGltcGxlbWVudGF0aW9uOiAnICsgdGhpcy5fc3RhdGU7XHJcbiAgICB9XHJcbn07XHJcblxyXG5GZXRjaENvbnRleHQucHJvdG90eXBlLmdldENvbnRleHRWYXJzID0gZnVuY3Rpb24gZ2V0Q29udGV4dFZhcnMoKSB7XHJcbiAgICByZXR1cm4gdGhpcy5fY29udGV4dFZhcnM7XHJcbn07XHJcblxyXG5GZXRjaENvbnRleHQucHJvdG90eXBlLm9uID0gZnVuY3Rpb24gb24oZXZlbnQsIGxpc3RlbmVyKSB7XHJcbiAgICBzd2l0Y2ggKGV2ZW50KSB7XHJcbiAgICAgICAgY2FzZSAndGVybWluYXRlZCc6XHJcbiAgICAgICAgICAgIHRoaXMuX3Rlcm1pbmF0ZWRMaXN0ZW5lcnMucHVzaChsaXN0ZW5lcik7XHJcbiAgICAgICAgICAgIGJyZWFrO1xyXG4gICAgICAgIGRlZmF1bHQ6XHJcbiAgICAgICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IFVuZXhwZWN0ZWQgZXZlbnQgJyArIGV2ZW50O1xyXG4gICAgfVxyXG59O1xyXG5cclxuRmV0Y2hDb250ZXh0LnByb3RvdHlwZS5zZXRJc1Byb2dyZXNzaXZlID0gZnVuY3Rpb24gc2V0SXNQcm9ncmVzc2l2ZShpc1Byb2dyZXNzaXZlKSB7XHJcbiAgICB0aGlzLl9pc1Byb2dyZXNzaXZlID0gaXNQcm9ncmVzc2l2ZTtcclxuICAgIGlmICh0aGlzLl9mZXRjaENvbnRleHRBcGkgIT09IG51bGwpIHtcclxuICAgICAgICB0aGlzLl9mZXRjaENvbnRleHRBcGkuX29uRXZlbnQoJ2lzUHJvZ3Jlc3NpdmVDaGFuZ2VkJywgaXNQcm9ncmVzc2l2ZSk7XHJcbiAgICB9XHJcbn07XHJcblxyXG5GZXRjaENvbnRleHQucHJvdG90eXBlLmdldElzUHJvZ3Jlc3NpdmUgPSBmdW5jdGlvbiBnZXRJc1Byb2dyZXNzaXZlKCkge1xyXG4gICAgcmV0dXJuIHRoaXMuX2lzUHJvZ3Jlc3NpdmU7XHJcbn07XHJcblxyXG5GZXRjaENvbnRleHQucHJvdG90eXBlLl9zdGFydEZldGNoID0gZnVuY3Rpb24gc3RhcnRGZXRjaCgpIHtcclxuICAgIHZhciBwcmV2U3RhdGUgPSB0aGlzLl9zdGF0ZTtcclxuICAgIHRoaXMuX3N0YXRlID0gRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19BQ1RJVkU7XHJcbiAgICBcclxuICAgIGlmIChwcmV2U3RhdGUgPT09IEZldGNoQ29udGV4dC5GRVRDSF9TVEFUVVNfV0FJVF9GT1JfRkVUQ0hfQ0FMTCB8fFxyXG4gICAgICAgIHByZXZTdGF0ZSA9PT0gRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19NT1ZBQkxFX1dBSVRfRk9SX01PVkVfQ0FMTCkge1xyXG4gICAgICAgIFxyXG4gICAgICAgIHRoaXMuX2ZldGNoZXJDbG9zZXIuY2hhbmdlQWN0aXZlRmV0Y2hlc0NvdW50KCsxKTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgaWYgKHRoaXMuX2lzT25seVdhaXRGb3JEYXRhKSB7XHJcbiAgICAgICAgdGhpcy5fZmV0Y2hDb250ZXh0QXBpID0gdGhpcy5fZXh0cmFjdEFscmVhZHlGZXRjaGVkRGF0YSgpO1xyXG4gICAgfSBlbHNlIGlmICghdGhpcy5faXNNb3ZhYmxlIHx8IHByZXZTdGF0ZSA9PT0gRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19XQUlUX0ZPUl9GRVRDSF9DQUxMKSB7XHJcbiAgICAgICAgaWYgKHRoaXMuX2ZldGNoQ29udGV4dEFwaSAhPT0gbnVsbCkge1xyXG4gICAgICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBDYW5ub3Qgc3RhcnQgZmV0Y2ggb2YgYWxyZWFkeSBzdGFydGVkIGZldGNoJztcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIHRoaXMuX2ZldGNoQ29udGV4dEFwaSA9IG5ldyBGZXRjaENvbnRleHRBcGkodGhpcyk7XHJcbiAgICAgICAgdGhpcy5fZmV0Y2hDb250ZXh0QXBpLm9uKCdpbnRlcm5hbFN0b3BwZWQnLCB0aGlzLl9mZXRjaFN0b3BwZWQsIHRoaXMpO1xyXG4gICAgICAgIHRoaXMuX2ZldGNoQ29udGV4dEFwaS5vbignaW50ZXJuYWxEb25lJywgdGhpcy5fZmV0Y2hEb25lLCB0aGlzKTtcclxuICAgICAgICBcclxuICAgICAgICBpZiAodGhpcy5faXNNb3ZhYmxlKSB7XHJcbiAgICAgICAgICAgIHRoaXMuX2ZldGNoZXIuc3RhcnRNb3ZhYmxlRmV0Y2godGhpcy5fZmV0Y2hDb250ZXh0QXBpLCB0aGlzLl9pbWFnZVBhcnRQYXJhbXMpO1xyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgIHRoaXMuX2ZldGNoZXIuc3RhcnRGZXRjaCh0aGlzLl9mZXRjaENvbnRleHRBcGksIHRoaXMuX2ltYWdlUGFydFBhcmFtcyk7XHJcbiAgICAgICAgfVxyXG4gICAgfSBlbHNlIHtcclxuICAgICAgICB0aGlzLl9mZXRjaENvbnRleHRBcGkuX29uRXZlbnQoJ21vdmUnLCB0aGlzLl9pbWFnZVBhcnRQYXJhbXMpO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBpZiAodGhpcy5fZmV0Y2hDb250ZXh0QXBpICE9PSBudWxsKSB7IC8vIE1pZ2h0IGJlIHNldCB0byBudWxsIGluIGltbWVkaWF0ZSBjYWxsIG9mIGZldGNoVGVybWluYXRlZCBvbiBwcmV2aW91cyBsaW5lXHJcbiAgICAgICAgdGhpcy5fZmV0Y2hDb250ZXh0QXBpLl9vbkV2ZW50KCdpc1Byb2dyZXNzaXZlQ2hhbmdlZCcsIHRoaXMuX2lzUHJvZ3Jlc3NpdmUpO1xyXG4gICAgfVxyXG59O1xyXG5cclxuRmV0Y2hDb250ZXh0LnByb3RvdHlwZS5jaGVja0lmU2hvdWxkWWllbGQgPSBmdW5jdGlvbiBjaGVja0lmU2hvdWxkWWllbGQoKSB7XHJcbiAgICB0cnkge1xyXG4gICAgICAgIGlmICghdGhpcy5fdXNlU2NoZWR1bGVyIHx8IHRoaXMuX3N0YXRlID09PSBGZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX1JFUVVFU1RfVEVSTUlOQVRFRCkge1xyXG4gICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIGlmICh0aGlzLl9yZXNvdXJjZSA9PT0gbnVsbCkge1xyXG4gICAgICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBObyByZXNvdXJjZSBhbGxvY2F0ZWQgYnV0IGZldGNoIGNhbGxiYWNrIGNhbGxlZCc7XHJcbiAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICBpZiAoIXRoaXMuX3NjaGVkdWxlckNhbGxiYWNrcy5zaG91bGRZaWVsZE9yQWJvcnQoKSkge1xyXG4gICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHRoaXMuX3N0YXRlID0gRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19SRVFVRVNUX0FCT1VUX1RPX1lJRUxEO1xyXG4gICAgICAgIHRoaXMuX2ZldGNoQ29udGV4dEFwaS5fb25FdmVudCgnc3RvcCcsIC8qaXNBYm9ydGVkPSovZmFsc2UpO1xyXG4gICAgfSBjYXRjaCAoZSkge1xyXG4gICAgICAgIHRoaXMuX3N0YXRlID0gRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19VTkVYUEVDVEVEX0ZBSUxVUkU7XHJcbiAgICAgICAgZmV0Y2hBYm9ydGVkQnlTY2hlZHVsZXIodGhpcyk7XHJcbiAgICB9XHJcbn07XHJcblxyXG5GZXRjaENvbnRleHQucHJvdG90eXBlLl9mZXRjaERvbmUgPSBmdW5jdGlvbiBmZXRjaERvbmUoKSB7XHJcbiAgICBzd2l0Y2ggKHRoaXMuX3N0YXRlKSB7XHJcbiAgICAgICAgY2FzZSBGZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX1JFUVVFU1RfQUJPVVRfVE9fQUJPUlQ6XHJcbiAgICAgICAgY2FzZSBGZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX0FDVElWRTpcclxuICAgICAgICBjYXNlIEZldGNoQ29udGV4dC5GRVRDSF9TVEFUVVNfUkVRVUVTVF9BQk9VVF9UT19ZSUVMRDpcclxuICAgICAgICAgICAgYnJlYWs7XHJcbiAgICAgICAgZGVmYXVsdDpcclxuICAgICAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogVW5leHBlY3RlZCBzdGF0ZSBvbiBmZXRjaCBkb25lOiAnICsgdGhpcy5fc3RhdGU7XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKHRoaXMuX2lzTW92YWJsZSkge1xyXG4gICAgICAgIHRoaXMuX3N0YXRlID0gRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19NT1ZBQkxFX1dBSVRfRk9SX01PVkVfQ0FMTDtcclxuICAgIH1cclxuICAgIHRoaXMuX2ZldGNoZXJDbG9zZXIuY2hhbmdlQWN0aXZlRmV0Y2hlc0NvdW50KC0xKTtcclxuXHJcbiAgICBpZiAodGhpcy5fcmVzb3VyY2UgIT09IG51bGwpIHtcclxuICAgICAgICB0aGlzLl9zY2hlZHVsZWRKb2JzTGlzdC5yZW1vdmUodGhpcy5fc2NoZWR1bGVkSm9ic0xpc3RJdGVyYXRvcik7XHJcbiAgICAgICAgdGhpcy5fc2NoZWR1bGVyQ2FsbGJhY2tzLmpvYkRvbmUoKTtcclxuXHJcbiAgICAgICAgdGhpcy5fcmVzb3VyY2UgPSBudWxsO1xyXG4gICAgfSBlbHNlIGlmICh0aGlzLl91c2VTY2hlZHVsZXIpIHtcclxuICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBKb2IgZXhwZWN0ZWQgdG8gaGF2ZSByZXNvdXJjZSBvbiBzdWNjZXNzZnVsIHRlcm1pbmF0aW9uJztcclxuICAgIH1cclxuICAgIFxyXG4gICAgdGhpcy5fdGVybWluYXRlTm9uTW92YWJsZUZldGNoKCk7XHJcbn07XHJcblxyXG5GZXRjaENvbnRleHQucHJvdG90eXBlLl9mZXRjaFN0b3BwZWQgPSBmdW5jdGlvbiBmZXRjaFN0b3BwZWQoaXNBYm9ydGVkKSB7XHJcbiAgICBzd2l0Y2ggKHRoaXMuX3N0YXRlKSB7XHJcbiAgICAgICAgY2FzZSBGZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX1JFUVVFU1RfQUJPVVRfVE9fQUJPUlQ6XHJcbiAgICAgICAgICAgIGlzQWJvcnRlZCA9IHRydWU7IC8vIGZvcmNlIGFib3J0ZWRcclxuICAgICAgICAgICAgYnJlYWs7XHJcbiAgICAgICAgY2FzZSBGZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX1JFUVVFU1RfQUJPVVRfVE9fWUlFTEQ6XHJcbiAgICAgICAgICAgIHZhciBpc1lpZWxkZWQgPSB0aGlzLl9zY2hlZHVsZXJDYWxsYmFja3MudHJ5WWllbGQoXHJcbiAgICAgICAgICAgICAgICBjb250aW51ZVlpZWxkZWRSZXF1ZXN0LFxyXG4gICAgICAgICAgICAgICAgZmV0Y2hBYm9ydGVkQnlTY2hlZHVsZXIsXHJcbiAgICAgICAgICAgICAgICBmZXRjaFlpZWxkZWRCeVNjaGVkdWxlcik7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBpZiAoIWlzWWllbGRlZCkge1xyXG4gICAgICAgICAgICAgICAgaWYgKHRoaXMuX3N0YXRlICE9PSBGZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX1JFUVVFU1RfQUJPVVRfVE9fWUlFTEQpIHtcclxuICAgICAgICAgICAgICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBVbmV4cGVjdGVkIHN0YXRlIG9uIHRyeVlpZWxkKCkgZmFsc2U6ICcgKyB0aGlzLl9zdGF0ZTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIHRoaXMuX3N0YXRlID0gRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19BQ1RJVkU7XHJcbiAgICAgICAgICAgICAgICB0aGlzLl9mZXRjaENvbnRleHRBcGkuX29uRXZlbnQoJ3Jlc3VtZScpO1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGJyZWFrO1xyXG4gICAgICAgIGRlZmF1bHQ6XHJcbiAgICAgICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IFVuZXhwZWN0ZWQgc3RhdGUgb24gZmV0Y2ggc3RvcHBlZDogJyArIHRoaXMuX3N0YXRlO1xyXG4gICAgfVxyXG5cclxuICAgIFxyXG4gICAgaWYgKHRoaXMuX3Jlc291cmNlICE9PSBudWxsKSB7XHJcbiAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogVW5leHBlY3RlZCByZXF1ZXN0IHRlcm1pbmF0aW9uIHdpdGhvdXQgcmVzb3VyY2UgYWxsb2NhdGVkJztcclxuICAgIH1cclxuICAgIFxyXG4gICAgdGhpcy5fZmV0Y2hlckNsb3Nlci5jaGFuZ2VBY3RpdmVGZXRjaGVzQ291bnQoLTEpO1xyXG4gICAgaWYgKHRoaXMuX2lzTW92YWJsZSkge1xyXG4gICAgICAgIHRoaXMuX3N0YXRlID0gRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19NT1ZBQkxFX1dBSVRfRk9SX01PVkVfQ0FMTDtcclxuICAgIH0gZWxzZSBpZiAoIWlzQWJvcnRlZCkge1xyXG4gICAgICAgIHRoaXMuX3Rlcm1pbmF0ZU5vbk1vdmFibGVGZXRjaCgpO1xyXG4gICAgfVxyXG59O1xyXG4gIFxyXG5GZXRjaENvbnRleHQucHJvdG90eXBlLl90ZXJtaW5hdGVOb25Nb3ZhYmxlRmV0Y2ggPSBmdW5jdGlvbiB0ZXJtaW5hdGVOb25Nb3ZhYmxlRmV0Y2goKSB7ICBcclxuICAgIGlmICh0aGlzLl9pc01vdmFibGUpIHtcclxuICAgICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHRoaXMuX3N0YXRlID0gRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19SRVFVRVNUX1RFUk1JTkFURUQ7XHJcbiAgICBcclxuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgdGhpcy5fdGVybWluYXRlZExpc3RlbmVycy5sZW5ndGg7ICsraSkge1xyXG4gICAgICAgIHRoaXMuX3Rlcm1pbmF0ZWRMaXN0ZW5lcnNbaV0odGhpcy5fY29udGV4dFZhcnMpO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBpZiAodGhpcy5fZmV0Y2hDb250ZXh0QXBpICE9PSBudWxsICYmXHJcbiAgICAgICAgdGhpcy5fc3RhdGUgIT09IEZldGNoQ29udGV4dC5GRVRDSF9TVEFUVVNfVU5FWFBFQ1RFRF9GQUlMVVJFKSB7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgIHRoaXMuX2ZldGNoQ29udGV4dEFwaS5fb25FdmVudCgndGVybWluYXRlJyk7XHJcbiAgICAgICAgdGhpcy5fZmV0Y2hDb250ZXh0QXBpID0gbnVsbDtcclxuICAgIH1cclxufTtcclxuXHJcbi8vIFByb3BlcnRpZXMgZm9yIEZydXN0dW1SZXF1ZXNldFByaW9yaXRpemVyXHJcblxyXG5PYmplY3QuZGVmaW5lUHJvcGVydHkoRmV0Y2hDb250ZXh0LnByb3RvdHlwZSwgJ2ltYWdlUGFydFBhcmFtcycsIHtcclxuICAgIGdldDogZnVuY3Rpb24gZ2V0SW1hZ2VQYXJ0UGFyYW1zKCkge1xyXG4gICAgICAgIHJldHVybiB0aGlzLl9pbWFnZVBhcnRQYXJhbXM7XHJcbiAgICB9XHJcbn0pO1xyXG5cclxuZnVuY3Rpb24gc3RhcnRSZXF1ZXN0KHJlc291cmNlLCBzZWxmLCBjYWxsYmFja3MpIHtcclxuICAgIGlmIChzZWxmLl9yZXNvdXJjZSAhPT0gbnVsbCkge1xyXG4gICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IFVuZXhwZWN0ZWQgcmVzdGFydCBvZiBhbHJlYWR5IHN0YXJ0ZWQgcmVxdWVzdCc7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGlmIChzZWxmLl9zdGF0ZSA9PT0gRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19SRVFVRVNUX0FCT1VUX1RPX0FCT1JUKSB7XHJcbiAgICAgICAgc2VsZi5fZmV0Y2hTdG9wcGVkKC8qaXNBYm9ydGVkPSovdHJ1ZSk7XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgfSBlbHNlIGlmIChzZWxmLl9zdGF0ZSAhPT0gRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19SRVFVRVNUX1dBSVRfRk9SX1NDSEVEVUxFKSB7XHJcbiAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogVW5leHBlY3RlZCBzdGF0ZSBvbiBzY2hlZHVsZTogJyArIHNlbGYuX3N0YXRlO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBzZWxmLl9yZXNvdXJjZSA9IHJlc291cmNlO1xyXG4gICAgc2VsZi5fc2NoZWR1bGVyQ2FsbGJhY2tzID0gY2FsbGJhY2tzO1xyXG5cclxuICAgIGlmIChyZXNvdXJjZSAhPT0gbnVsbCkge1xyXG4gICAgICAgIHNlbGYuX3NjaGVkdWxlZEpvYnNMaXN0SXRlcmF0b3IgPSBzZWxmLl9zY2hlZHVsZWRKb2JzTGlzdC5hZGQoc2VsZik7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHNlbGYuX3N0YXJ0RmV0Y2goKTtcclxufVxyXG5cclxuZnVuY3Rpb24gY29udGludWVZaWVsZGVkUmVxdWVzdChyZXNvdXJjZSwgc2VsZikge1xyXG4gICAgaWYgKHNlbGYuX2lzTW92YWJsZSkge1xyXG4gICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IFVuZXhwZWN0ZWQgY2FsbCB0byBjb250aW51ZVlpZWxkZWRSZXF1ZXN0IG9uIG1vdmFibGUgZmV0Y2gnO1xyXG4gICAgfVxyXG5cclxuICAgIGlmIChzZWxmLl9zdGF0ZSA9PT0gRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19SRVFVRVNUX0FCT1VUX1RPX0FCT1JUIHx8XHJcbiAgICAgICAgc2VsZi5fc3RhdGUgPT09IEZldGNoQ29udGV4dC5GRVRDSF9TVEFUVVNfVU5FWFBFQ1RFRF9GQUlMVVJFKSB7XHJcbiAgICAgICAgXHJcbiAgICAgICAgc2VsZi5fc2NoZWR1bGVyQ2FsbGJhY2tzLmpvYkRvbmUoKTtcclxuICAgICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGlmIChzZWxmLl9zdGF0ZSAhPT0gRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19SRVFVRVNUX1lJRUxERUQpIHtcclxuICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBVbmV4cGVjdGVkIHJlcXVlc3Qgc3RhdGUgb24gY29udGludWU6ICcgKyBzZWxmLl9zdGF0ZTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgc2VsZi5fc3RhdGUgPSBGZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX0FDVElWRTtcclxuICAgIHNlbGYuX3Jlc291cmNlID0gcmVzb3VyY2U7XHJcbiAgICBcclxuICAgIHNlbGYuX3NjaGVkdWxlZEpvYnNMaXN0SXRlcmF0b3IgPSBzZWxmLl9zY2hlZHVsZWRKb2JzTGlzdC5hZGQoc2VsZik7XHJcbiAgICBzZWxmLl9vbkV2ZW50KCdyZXN1bWUnKTtcclxufVxyXG5cclxuZnVuY3Rpb24gZmV0Y2hZaWVsZGVkQnlTY2hlZHVsZXIoc2VsZikge1xyXG4gICAgdmFyIG5leHRTdGF0ZTtcclxuICAgIHNlbGYuX3Jlc291cmNlID0gbnVsbDtcclxuICAgIHNlbGYuX3NjaGVkdWxlZEpvYnNMaXN0LnJlbW92ZShzZWxmLl9zY2hlZHVsZWRKb2JzTGlzdEl0ZXJhdG9yKTtcclxuICAgIGlmIChzZWxmLnN0YXRlID09PSBGZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX1JFUVVFU1RfQUJPVVRfVE9fWUlFTEQpIHtcclxuICAgICAgICBzZWxmLl9zdGF0ZSA9IEZldGNoQ29udGV4dC5GRVRDSF9TVEFUVVNfUkVRVUVTVF9ZSUVMREVEO1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgICBzZWxmLl9zdGF0ZSA9IEZldGNoQ29udGV4dC5GRVRDSF9TVEFUVVNfVU5FWFBFQ1RFRF9GQUlMVVJFO1xyXG4gICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IFVuZXhwZWN0ZWQgcmVxdWVzdCBzdGF0ZSBvbiB5aWVsZCBwcm9jZXNzOiAnICsgc2VsZi5fc3RhdGU7XHJcbiAgICB9XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGZldGNoQWJvcnRlZEJ5U2NoZWR1bGVyKHNlbGYpIHtcclxuICAgIHNlbGYuX3Jlc291cmNlID0gbnVsbDtcclxuICAgIHNlbGYuX2ZldGNoU3RvcHBlZCgvKmlzQWJvcnRlZD0qL3RydWUpO1xyXG59IiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBGZXRjaE1hbmFnZXI7XHJcblxyXG52YXIgaW1hZ2VIZWxwZXJGdW5jdGlvbnMgPSByZXF1aXJlKCdpbWFnZS1oZWxwZXItZnVuY3Rpb25zLmpzJyk7XHJcbnZhciBGZXRjaENvbnRleHQgPSByZXF1aXJlKCdmZXRjaC1jb250ZXh0LmpzJyk7XHJcbnZhciBMaW5rZWRMaXN0ID0gcmVxdWlyZSgnbGlua2VkLWxpc3QuanMnKTtcclxudmFyIEZldGNoZXJDbG9zZXIgPSByZXF1aXJlKCdmZXRjaGVyLWNsb3Nlci5qcycpO1xyXG5cclxuLyogZ2xvYmFsIGNvbnNvbGU6IGZhbHNlICovXHJcbi8qIGdsb2JhbCBQcm9taXNlOiBmYWxzZSAqL1xyXG5cclxuRmV0Y2hNYW5hZ2VyLmZldGNoZXJFeHBlY3RlZE1ldGhvZHMgPSBbJ29wZW4nLCAnb24nLCAnY2xvc2UnLCAnc3RhcnRGZXRjaCcsICdzdGFydE1vdmFibGVGZXRjaCddO1xyXG5cclxuZnVuY3Rpb24gRmV0Y2hNYW5hZ2VyKGZldGNoZXIsIG9wdGlvbnMpIHtcclxuICAgIG9wdGlvbnMgPSBvcHRpb25zIHx8IHt9O1xyXG4gICAgXHJcbiAgICB0aGlzLl9mZXRjaGVzTGltaXQgPSBvcHRpb25zLmZldGNoZXNMaW1pdCB8fCA1O1xyXG4gICAgdGhpcy5fc2hvd0xvZyA9IG9wdGlvbnMuc2hvd0xvZztcclxuICAgIFxyXG4gICAgLyppZiAodGhpcy5fc2hvd0xvZykge1xyXG4gICAgICAgIC8vIE9sZCBJRVxyXG4gICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IHNob3dMb2cgaXMgbm90IHN1cHBvcnRlZCBvbiB0aGlzIGJyb3dzZXInO1xyXG4gICAgfSovXHJcbiAgICBcclxuICAgIHRoaXMuX3NjaGVkdWxlciA9IG51bGw7XHJcbiAgICB0aGlzLl9mZXRjaFByaW9yaXRpemVyID0gbnVsbDtcclxuICAgIHRoaXMuX3ByaW9yaXRpemVyVHlwZSA9IG51bGw7XHJcbiAgICAgICAgXHJcbiAgICB0aGlzLl9tb3ZhYmxlSGFuZGxlQ291bnRlciA9IDA7XHJcbiAgICB0aGlzLl9tb3ZhYmxlSGFuZGxlcyA9IFtdO1xyXG4gICAgdGhpcy5fcmVxdWVzdEJ5SWQgPSBbXTtcclxuICAgIHRoaXMuX2ltYWdlUGFyYW1zID0gbnVsbDtcclxuICAgIHRoaXMuX3NjaGVkdWxlZEpvYnNMaXN0ID0gbmV3IExpbmtlZExpc3QoKTtcclxuICAgIHRoaXMuX2ZldGNoZXJDbG9zZXIgPSBuZXcgRmV0Y2hlckNsb3NlcigpO1xyXG4gICAgXHJcbiAgICB0aGlzLl9mZXRjaGVyID0gaW1hZ2VIZWxwZXJGdW5jdGlvbnMuZ2V0T3JDcmVhdGVJbnN0YW5jZShcclxuICAgICAgICBmZXRjaGVyLCAnZmV0Y2hlcicsIEZldGNoTWFuYWdlci5mZXRjaGVyRXhwZWN0ZWRNZXRob2RzKTtcclxufVxyXG5cclxuRmV0Y2hNYW5hZ2VyLnByb3RvdHlwZS5vcGVuID0gZnVuY3Rpb24gb3Blbih1cmwpIHtcclxuICAgIHZhciBmZXRjaFNjaGVkdWxlciA9IGltYWdlSGVscGVyRnVuY3Rpb25zLmNyZWF0ZVByaW9yaXRpemVyKFxyXG4gICAgICAgIHRoaXMuX2ZldGNoZXNMaW1pdCxcclxuICAgICAgICB0aGlzLl9wcmlvcml0aXplclR5cGUsXHJcbiAgICAgICAgJ2ZldGNoJyxcclxuICAgICAgICB0aGlzLl9zaG93TG9nKTtcclxuICAgIFxyXG4gICAgdGhpcy5fZmV0Y2hQcmlvcml0aXplciA9IGZldGNoU2NoZWR1bGVyLnByaW9yaXRpemVyO1xyXG4gICAgaWYgKGZldGNoU2NoZWR1bGVyLnByaW9yaXRpemVyICE9PSBudWxsKSB7XHJcbiAgICAgICAgdGhpcy5fc2NoZWR1bGVyID0gbmV3IHJlc291cmNlU2NoZWR1bGVyLlByaW9yaXR5U2NoZWR1bGVyKFxyXG4gICAgICAgICAgICBjcmVhdGVEdW1teVJlc291cmNlLFxyXG4gICAgICAgICAgICB0aGlzLl9mZXRjaGVzTGltaXQsXHJcbiAgICAgICAgICAgIGZldGNoU2NoZWR1bGVyLnByaW9yaXRpemVyLFxyXG4gICAgICAgICAgICBmZXRjaFNjaGVkdWxlci5zY2hlZHVsZXJPcHRpb25zKTtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgICAgdGhpcy5fc2NoZWR1bGVyID0gbmV3IHJlc291cmNlU2NoZWR1bGVyLkxpZm9TY2hlZHVsZXIoXHJcbiAgICAgICAgICAgIGNyZWF0ZUR1bW15UmVzb3VyY2UsXHJcbiAgICAgICAgICAgIHRoaXMuX2ZldGNoZXNMaW1pdCxcclxuICAgICAgICAgICAgZmV0Y2hTY2hlZHVsZXIuc2NoZWR1bGVyT3B0aW9ucyk7XHJcbiAgICB9XHJcblxyXG4gICAgdmFyIHNlbGYgPSB0aGlzO1xyXG4gICAgcmV0dXJuIHRoaXMuX2ZldGNoZXIub3Blbih1cmwpLnRoZW4oZnVuY3Rpb24ocmVzdWx0KSB7XHJcbiAgICAgICAgc2VsZi5faW1hZ2VQYXJhbXMgPSByZXN1bHQ7XHJcbiAgICAgICAgcmV0dXJuIHJlc3VsdDtcclxuICAgIH0pO1xyXG59O1xyXG5cclxuRmV0Y2hNYW5hZ2VyLnByb3RvdHlwZS5vbiA9IGZ1bmN0aW9uIG9uKGV2ZW50LCBjYWxsYmFjaywgYXJnKSB7XHJcbiAgICByZXR1cm4gdGhpcy5fZmV0Y2hlci5vbihldmVudCwgY2FsbGJhY2ssIGFyZyk7XHJcbn07XHJcblxyXG5GZXRjaE1hbmFnZXIucHJvdG90eXBlLmNsb3NlID0gZnVuY3Rpb24gY2xvc2UoKSB7XHJcbiAgICB2YXIgc2VsZiA9IHRoaXM7XHJcbiAgICB2YXIgcmVzb2x2ZV8gPSBudWxsO1xyXG4gICAgdmFyIHJlamVjdF8gPSBudWxsO1xyXG5cclxuICAgIGZ1bmN0aW9uIHdhaXRGb3JBY3RpdmVGZXRjaGVzKHJlc3VsdCkge1xyXG4gICAgICAgIHNlbGYuX2ZldGNoZXJDbG9zZXIuY2xvc2UoKVxyXG4gICAgICAgICAgICAudGhlbihmdW5jdGlvbigpIHtcclxuICAgICAgICAgICAgICAgIHJlc29sdmVfKHJlc3VsdCk7XHJcbiAgICAgICAgICAgIH0pLmNhdGNoKHJlamVjdF8pO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICByZXR1cm4gbmV3IFByb21pc2UoZnVuY3Rpb24ocmVzb2x2ZSwgcmVqZWN0KSB7XHJcbiAgICAgICAgcmVzb2x2ZV8gPSByZXNvbHZlO1xyXG4gICAgICAgIHJlamVjdF8gPSByZWplY3Q7XHJcbiAgICAgICAgc2VsZi5fZmV0Y2hlci5jbG9zZSgpXHJcbiAgICAgICAgICAgIC50aGVuKHdhaXRGb3JBY3RpdmVGZXRjaGVzKVxyXG4gICAgICAgICAgICAuY2F0Y2gocmVqZWN0KTtcclxuICAgIH0pO1xyXG59O1xyXG5cclxuRmV0Y2hNYW5hZ2VyLnByb3RvdHlwZS5zZXRQcmlvcml0aXplclR5cGUgPSBmdW5jdGlvbiBzZXRQcmlvcml0aXplclR5cGUocHJpb3JpdGl6ZXJUeXBlKSB7XHJcbiAgICBpZiAodGhpcy5fc2NoZWR1bGVyICE9PSBudWxsKSB7XHJcbiAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogY2Fubm90IHNldCBwcmlvcml0aXplciB0eXBlIGFmdGVyIEZldGNoTWFuYWdlci5vcGVuKCkgY2FsbGVkJztcclxuICAgIH1cclxuICAgIHRoaXMuX3ByaW9yaXRpemVyVHlwZSA9IHByaW9yaXRpemVyVHlwZTtcclxufTtcclxuXHJcbkZldGNoTWFuYWdlci5wcm90b3R5cGUuZ2V0SW1hZ2VQYXJhbXMgPSBmdW5jdGlvbiBnZXRJbWFnZVBhcmFtcygpIHtcclxuICAgIHJldHVybiB0aGlzLl9pbWFnZVBhcmFtcztcclxufTtcclxuXHJcbkZldGNoTWFuYWdlci5wcm90b3R5cGUuc2V0SXNQcm9ncmVzc2l2ZVJlcXVlc3QgPSBmdW5jdGlvbiBzZXRJc1Byb2dyZXNzaXZlUmVxdWVzdChcclxuICAgIHJlcXVlc3RJZCwgaXNQcm9ncmVzc2l2ZSkge1xyXG4gICAgXHJcbiAgICB2YXIgZmV0Y2hKb2IgPSB0aGlzLl9yZXF1ZXN0QnlJZFtyZXF1ZXN0SWRdO1xyXG4gICAgaWYgKGZldGNoSm9iID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICAvLyBUaGlzIHNpdHVhdGlvbiBtaWdodCBvY2N1ciBpZiByZXF1ZXN0IGhhcyBiZWVuIHRlcm1pbmF0ZWQsXHJcbiAgICAgICAgLy8gYnV0IHVzZXIncyB0ZXJtaW5hdGVkQ2FsbGJhY2sgaGFzIG5vdCBiZWVuIGNhbGxlZCB5ZXQuIEl0XHJcbiAgICAgICAgLy8gaGFwcGVucyBvbiBXb3JrZXJQcm94eUZldGNoTWFuYWdlciBkdWUgdG8gdGhyZWFkXHJcbiAgICAgICAgLy8gbWVzc2FnZSBkZWxheS5cclxuICAgICAgICBcclxuICAgICAgICByZXR1cm4gbnVsbDtcclxuICAgIH1cclxuICAgIFxyXG4gICAgZmV0Y2hKb2Iuc2V0SXNQcm9ncmVzc2l2ZShpc1Byb2dyZXNzaXZlKTtcclxufTtcclxuXHJcbkZldGNoTWFuYWdlci5wcm90b3R5cGUuY3JlYXRlTW92YWJsZUZldGNoID0gZnVuY3Rpb24gY3JlYXRlTW92YWJsZUZldGNoKCkge1xyXG4gICAgdmFyIHNlbGYgPSB0aGlzO1xyXG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKGZ1bmN0aW9uKHJlc29sdmUsIHJlamVjdCkge1xyXG4gICAgICAgIHZhciBtb3ZhYmxlSGFuZGxlID0gKytzZWxmLl9tb3ZhYmxlSGFuZGxlQ291bnRlcjtcclxuICAgICAgICBzZWxmLl9tb3ZhYmxlSGFuZGxlc1ttb3ZhYmxlSGFuZGxlXSA9IG5ldyBGZXRjaENvbnRleHQoXHJcbiAgICAgICAgICAgIHNlbGYuX2ZldGNoZXIsXHJcbiAgICAgICAgICAgIHNlbGYuX2ZldGNoZXJDbG9zZXIsXHJcbiAgICAgICAgICAgIHNlbGYuX3NjaGVkdWxlcixcclxuICAgICAgICAgICAgc2VsZi5fc2NoZWR1bGVkSm9ic0xpc3QsXHJcbiAgICAgICAgICAgIEZldGNoQ29udGV4dC5GRVRDSF9UWVBFX01PVkFCTEUsXHJcbiAgICAgICAgICAgIC8qY29udGV4dFZhcnM9Ki9udWxsKTtcclxuXHJcbiAgICAgICAgcmVzb2x2ZShtb3ZhYmxlSGFuZGxlKTtcclxuICAgIH0pO1xyXG59O1xyXG5cclxuRmV0Y2hNYW5hZ2VyLnByb3RvdHlwZS5tb3ZlRmV0Y2ggPSBmdW5jdGlvbiBtb3ZlRmV0Y2goXHJcbiAgICBtb3ZhYmxlSGFuZGxlLCBpbWFnZVBhcnRQYXJhbXMpIHtcclxuICAgIFxyXG4gICAgdmFyIG1vdmFibGUgPSB0aGlzLl9tb3ZhYmxlSGFuZGxlc1ttb3ZhYmxlSGFuZGxlXTtcclxuICAgIG1vdmFibGUuZmV0Y2goaW1hZ2VQYXJ0UGFyYW1zKTtcclxufTtcclxuXHJcbkZldGNoTWFuYWdlci5wcm90b3R5cGUuY3JlYXRlUmVxdWVzdCA9IGZ1bmN0aW9uIGNyZWF0ZVJlcXVlc3QoXHJcbiAgICByZXF1ZXN0SWQsIGltYWdlUGFydFBhcmFtcykge1xyXG4gICAgXHJcbiAgICB2YXIgY29udGV4dFZhcnMgPSB7XHJcbiAgICAgICAgcHJvZ3Jlc3NpdmVTdGFnZXNEb25lOiAwLFxyXG4gICAgICAgIGlzTGFzdENhbGxiYWNrQ2FsbGVkV2l0aG91dExvd1F1YWxpdHlMaW1pdDogZmFsc2UsXHJcbiAgICAgICAgcmVxdWVzdElkOiByZXF1ZXN0SWQsXHJcbiAgICAgICAgZmV0Y2hKb2I6IG51bGwsXHJcbiAgICAgICAgc2VsZjogdGhpc1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgdmFyIGZldGNoVHlwZSA9IC8qaXNPbmx5V2FpdEZvckRhdGEgP1xyXG4gICAgICAgIEZldGNoQ29udGV4dC5GRVRDSF9UWVBFX09OTFlfV0FJVF9GT1JfREFUQSA6ICovRmV0Y2hDb250ZXh0LkZFVENIX1RZUEVfUkVRVUVTVDtcclxuICAgIFxyXG4gICAgdmFyIGZldGNoSm9iID0gbmV3IEZldGNoQ29udGV4dChcclxuICAgICAgICB0aGlzLl9mZXRjaGVyLFxyXG4gICAgICAgIHRoaXMuX2ZldGNoZXJDbG9zZXIsXHJcbiAgICAgICAgdGhpcy5fc2NoZWR1bGVyLFxyXG4gICAgICAgIHRoaXMuX3NjaGVkdWxlZEpvYnNMaXN0LFxyXG4gICAgICAgIGZldGNoVHlwZSxcclxuICAgICAgICBjb250ZXh0VmFycyk7XHJcbiAgICBcclxuICAgIGNvbnRleHRWYXJzLmZldGNoSm9iID0gZmV0Y2hKb2I7XHJcbiAgICBcclxuICAgIGlmICh0aGlzLl9yZXF1ZXN0QnlJZFtyZXF1ZXN0SWRdICE9PSB1bmRlZmluZWQpIHtcclxuICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBEdXBsaWNhdGlvbiBvZiByZXF1ZXN0SWQgJyArIHJlcXVlc3RJZDtcclxuICAgIH0gZWxzZSBpZiAocmVxdWVzdElkICE9PSB1bmRlZmluZWQpIHtcclxuICAgICAgICB0aGlzLl9yZXF1ZXN0QnlJZFtyZXF1ZXN0SWRdID0gZmV0Y2hKb2I7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGZldGNoSm9iLm9uKCd0ZXJtaW5hdGVkJywgaW50ZXJuYWxUZXJtaW5hdGVkQ2FsbGJhY2spO1xyXG4gICAgXHJcbiAgICBmZXRjaEpvYi5mZXRjaChpbWFnZVBhcnRQYXJhbXMpO1xyXG4gICAgXHJcbiAgICB0aGlzLl95aWVsZEZldGNoSm9icygpO1xyXG59O1xyXG5cclxuRmV0Y2hNYW5hZ2VyLnByb3RvdHlwZS5tYW51YWxBYm9ydFJlcXVlc3QgPSBmdW5jdGlvbiBtYW51YWxBYm9ydFJlcXVlc3QoXHJcbiAgICByZXF1ZXN0SWQpIHtcclxuICAgIFxyXG4gICAgdmFyIGZldGNoSm9iID0gdGhpcy5fcmVxdWVzdEJ5SWRbcmVxdWVzdElkXTtcclxuICAgIFxyXG4gICAgaWYgKGZldGNoSm9iID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICAvLyBUaGlzIHNpdHVhdGlvbiBtaWdodCBvY2N1ciBpZiByZXF1ZXN0IGhhcyBiZWVuIHRlcm1pbmF0ZWQsXHJcbiAgICAgICAgLy8gYnV0IHVzZXIncyB0ZXJtaW5hdGVkQ2FsbGJhY2sgaGFzIG5vdCBiZWVuIGNhbGxlZCB5ZXQuIEl0XHJcbiAgICAgICAgLy8gaGFwcGVucyBvbiBXb3JrZXJQcm94eUZldGNoTWFuYWdlciBkdWUgdG8gd2ViIHdvcmtlclxyXG4gICAgICAgIC8vIG1lc3NhZ2UgZGVsYXkuXHJcbiAgICAgICAgXHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBmZXRjaEpvYi5tYW51YWxBYm9ydFJlcXVlc3QoKTtcclxuICAgIGRlbGV0ZSB0aGlzLl9yZXF1ZXN0QnlJZFtyZXF1ZXN0SWRdO1xyXG59O1xyXG5cclxuRmV0Y2hNYW5hZ2VyLnByb3RvdHlwZS5zZXRGZXRjaFByaW9yaXRpemVyRGF0YSA9XHJcbiAgICBmdW5jdGlvbiBzZXRGZXRjaFByaW9yaXRpemVyRGF0YShwcmlvcml0aXplckRhdGEpIHtcclxuXHJcbiAgICBpZiAodGhpcy5fZmV0Y2hQcmlvcml0aXplciA9PT0gbnVsbCkge1xyXG4gICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IE5vIGZldGNoIHByaW9yaXRpemVyIGhhcyBiZWVuIHNldCc7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGlmICh0aGlzLl9zaG93TG9nKSB7XHJcbiAgICAgICAgY29uc29sZS5sb2coJ3NldEZldGNoUHJpb3JpdGl6ZXJEYXRhKCcgKyBwcmlvcml0aXplckRhdGEgKyAnKScpO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBwcmlvcml0aXplckRhdGEuaW1hZ2UgPSB0aGlzO1xyXG4gICAgdGhpcy5fZmV0Y2hQcmlvcml0aXplci5zZXRQcmlvcml0aXplckRhdGEocHJpb3JpdGl6ZXJEYXRhKTtcclxuICAgIHRoaXMuX3lpZWxkRmV0Y2hKb2JzKCk7XHJcbn07XHJcblxyXG5GZXRjaE1hbmFnZXIucHJvdG90eXBlLl95aWVsZEZldGNoSm9icyA9IGZ1bmN0aW9uIHlpZWxkRmV0Y2hKb2JzKCkge1xyXG4gICAgdmFyIGl0ZXJhdG9yID0gdGhpcy5fc2NoZWR1bGVkSm9ic0xpc3QuZ2V0Rmlyc3RJdGVyYXRvcigpO1xyXG4gICAgd2hpbGUgKGl0ZXJhdG9yICE9PSBudWxsKSB7XHJcbiAgICAgICAgdmFyIGZldGNoSm9iID0gdGhpcy5fc2NoZWR1bGVkSm9ic0xpc3QuZ2V0VmFsdWUoaXRlcmF0b3IpO1xyXG4gICAgICAgIGl0ZXJhdG9yID0gdGhpcy5fc2NoZWR1bGVkSm9ic0xpc3QuZ2V0TmV4dEl0ZXJhdG9yKGl0ZXJhdG9yKTtcclxuICAgICAgICBcclxuICAgICAgICBmZXRjaEpvYi5jaGVja0lmU2hvdWxkWWllbGQoKTtcclxuICAgIH1cclxufTtcclxuXHJcbmZ1bmN0aW9uIGludGVybmFsVGVybWluYXRlZENhbGxiYWNrKGNvbnRleHRWYXJzKSB7XHJcbiAgICBkZWxldGUgY29udGV4dFZhcnMuc2VsZi5fcmVxdWVzdEJ5SWRbY29udGV4dFZhcnMucmVxdWVzdElkXTtcclxufVxyXG5cclxuZnVuY3Rpb24gY3JlYXRlRHVtbXlSZXNvdXJjZSgpIHtcclxuICAgIHJldHVybiB7fTtcclxufSIsIid1c2Ugc3RyaWN0JztcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gRmV0Y2hlckNsb3NlcjtcclxuXHJcbi8qIGdsb2JhbCBQcm9taXNlOiBmYWxzZSAqL1xyXG5cclxuZnVuY3Rpb24gRmV0Y2hlckNsb3NlcigpIHtcclxuICAgIHRoaXMuX3Jlc29sdmVDbG9zZSA9IG51bGw7XHJcbiAgICB0aGlzLl9hY3RpdmVGZXRjaGVzID0gMDtcclxuICAgIHRoaXMuX2lzQ2xvc2VkID0gZmFsc2U7XHJcbn1cclxuXHJcbkZldGNoZXJDbG9zZXIucHJvdG90eXBlLmNoYW5nZUFjdGl2ZUZldGNoZXNDb3VudCA9IGZ1bmN0aW9uIGNoYW5nZUFjdGl2ZUZldGNoZXNDb3VudChhZGRWYWx1ZSkge1xyXG4gICAgaWYgKHRoaXMuX2lzQ2xvc2VkKSB7XHJcbiAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogVW5leHBlY3RlZCBjaGFuZ2Ugb2YgYWN0aXZlIGZldGNoZXMgY291bnQgYWZ0ZXIgY2xvc2VkJztcclxuICAgIH1cclxuICAgIHRoaXMuX2FjdGl2ZUZldGNoZXMgKz0gYWRkVmFsdWU7XHJcbiAgICBcclxuICAgIGlmICh0aGlzLl9hY3RpdmVGZXRjaGVzID09PSAwICYmIHRoaXMuX3Jlc29sdmVDbG9zZSkge1xyXG4gICAgICAgIHRoaXMuX2lzQ2xvc2VkID0gdHJ1ZTtcclxuICAgICAgICB0aGlzLl9yZXNvbHZlQ2xvc2UoKTtcclxuICAgIH1cclxufTtcclxuXHJcbkZldGNoZXJDbG9zZXIucHJvdG90eXBlLmlzQ2xvc2VSZXF1ZXN0ZWQgPSBmdW5jdGlvbiBpc0Nsb3NlUmVxdWVzdGVkKCkge1xyXG4gICAgcmV0dXJuIHRoaXMuX2lzQ2xvc2VkIHx8ICh0aGlzLl9yZXNvbHZlQ2xvc2UgIT09IG51bGwpO1xyXG59O1xyXG5cclxuRmV0Y2hlckNsb3Nlci5wcm90b3R5cGUuY2xvc2UgPSBmdW5jdGlvbiBjbG9zZSgpIHtcclxuICAgIGlmICh0aGlzLmlzQ2xvc2VSZXF1ZXN0ZWQoKSkge1xyXG4gICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IGNsb3NlKCkgY2FsbGVkIHR3aWNlJztcclxuICAgIH1cclxuICAgIHZhciBzZWxmID0gdGhpcztcclxuICAgIHJldHVybiBuZXcgUHJvbWlzZShmdW5jdGlvbihyZXNvbHZlLCByZWplY3QpIHtcclxuICAgICAgICBzZWxmLl9yZXNvbHZlQ2xvc2UgPSByZXNvbHZlO1xyXG4gICAgICAgIGlmIChzZWxmLl9hY3RpdmVGZXRjaGVzID09PSAwKSB7XHJcbiAgICAgICAgICAgIHNlbGYuX3Jlc29sdmVDbG9zZSgpO1xyXG4gICAgICAgIH1cclxuICAgIH0pO1xyXG59OyIsIid1c2Ugc3RyaWN0JztcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gRnJ1c3R1bVJlcXVlc3RzUHJpb3JpdGl6ZXI7XHJcbnZhciBQUklPUklUWV9BQk9SVF9OT1RfSU5fRlJVU1RVTSA9IC0xO1xyXG52YXIgUFJJT1JJVFlfQ0FMQ1VMQVRJT05fRkFJTEVEID0gMDtcclxudmFyIFBSSU9SSVRZX1RPT19HT09EX1JFU09MVVRJT04gPSAxO1xyXG52YXIgUFJJT1JJVFlfTk9UX0lOX0ZSVVNUVU0gPSAyO1xyXG52YXIgUFJJT1JJVFlfTE9XRVJfUkVTT0xVVElPTiA9IDM7XHJcblxyXG52YXIgUFJJT1JJVFlfTUlOT1JJVFlfSU5fRlJVU1RVTSA9IDQ7XHJcbnZhciBQUklPUklUWV9QQVJUSUFMX0lOX0ZSVVNUVU0gPSA1O1xyXG52YXIgUFJJT1JJVFlfTUFKT1JJVFlfSU5fRlJVU1RVTSA9IDY7XHJcbnZhciBQUklPUklUWV9GVUxMWV9JTl9GUlVTVFVNID0gNztcclxuXHJcbnZhciBBRERfUFJJT1JJVFlfVE9fTE9XX1FVQUxJVFkgPSA1O1xyXG5cclxudmFyIFBSSU9SSVRZX0hJR0hFU1QgPSAxMztcclxuXHJcbnZhciBsb2cyID0gTWF0aC5sb2coMik7XHJcblxyXG5mdW5jdGlvbiBGcnVzdHVtUmVxdWVzdHNQcmlvcml0aXplcihcclxuICAgIGlzQWJvcnRSZXF1ZXN0c05vdEluRnJ1c3R1bSwgaXNQcmlvcml0aXplTG93UHJvZ3Jlc3NpdmVTdGFnZSkge1xyXG4gICAgXHJcbiAgICB0aGlzLl9mcnVzdHVtRGF0YSA9IG51bGw7XHJcbiAgICB0aGlzLl9pc0Fib3J0UmVxdWVzdHNOb3RJbkZydXN0dW0gPSBpc0Fib3J0UmVxdWVzdHNOb3RJbkZydXN0dW07XHJcbiAgICB0aGlzLl9pc1ByaW9yaXRpemVMb3dQcm9ncmVzc2l2ZVN0YWdlID0gaXNQcmlvcml0aXplTG93UHJvZ3Jlc3NpdmVTdGFnZTtcclxufVxyXG5cclxuT2JqZWN0LmRlZmluZVByb3BlcnR5KFxyXG4gICAgRnJ1c3R1bVJlcXVlc3RzUHJpb3JpdGl6ZXIucHJvdG90eXBlLCAnbWluaW1hbExvd1F1YWxpdHlQcmlvcml0eScsIHtcclxuICAgICAgICBnZXQ6IGZ1bmN0aW9uIG1pbmltYWxMb3dRdWFsaXR5UHJpb3JpdHkoKSB7XHJcbiAgICAgICAgICAgIHJldHVybiBQUklPUklUWV9NSU5PUklUWV9JTl9GUlVTVFVNICsgQUREX1BSSU9SSVRZX1RPX0xPV19RVUFMSVRZO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuKTtcclxuICAgIFxyXG5GcnVzdHVtUmVxdWVzdHNQcmlvcml0aXplci5wcm90b3R5cGUuc2V0UHJpb3JpdGl6ZXJEYXRhID0gZnVuY3Rpb24gc2V0UHJpb3JpdGl6ZXJEYXRhKGRhdGEpIHtcclxuICAgIHRoaXMuX2ZydXN0dW1EYXRhID0gZGF0YTtcclxufTtcclxuXHJcbkZydXN0dW1SZXF1ZXN0c1ByaW9yaXRpemVyLnByb3RvdHlwZS5nZXRQcmlvcml0eSA9IGZ1bmN0aW9uIGdldFByaW9yaXR5KGpvYkNvbnRleHQpIHtcclxuICAgIHZhciBpbWFnZVBhcnRQYXJhbXMgPSBqb2JDb250ZXh0LmltYWdlUGFydFBhcmFtcztcclxuICAgIGlmIChpbWFnZVBhcnRQYXJhbXMucmVxdWVzdFByaW9yaXR5RGF0YS5vdmVycmlkZUhpZ2hlc3RQcmlvcml0eSkge1xyXG4gICAgICAgIHJldHVybiBQUklPUklUWV9ISUdIRVNUO1xyXG4gICAgfVxyXG5cclxuICAgIHZhciBwcmlvcml0eSA9IHRoaXMuX2dldFByaW9yaXR5SW50ZXJuYWwoaW1hZ2VQYXJ0UGFyYW1zKTtcclxuICAgIHZhciBpc0luRnJ1c3R1bSA9IHByaW9yaXR5ID49IFBSSU9SSVRZX01JTk9SSVRZX0lOX0ZSVVNUVU07XHJcbiAgICBcclxuICAgIGlmICh0aGlzLl9pc0Fib3J0UmVxdWVzdHNOb3RJbkZydXN0dW0gJiYgIWlzSW5GcnVzdHVtKSB7XHJcbiAgICAgICAgcmV0dXJuIFBSSU9SSVRZX0FCT1JUX05PVF9JTl9GUlVTVFVNO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICB2YXIgcHJpb3JpdGl6ZUxvd1Byb2dyZXNzaXZlU3RhZ2UgPSAwO1xyXG4gICAgXHJcbiAgICBpZiAodGhpcy5faXNQcmlvcml0aXplTG93UHJvZ3Jlc3NpdmVTdGFnZSAmJiBpc0luRnJ1c3R1bSkge1xyXG4gICAgICAgIHByaW9yaXRpemVMb3dQcm9ncmVzc2l2ZVN0YWdlID1cclxuICAgICAgICAgICAgam9iQ29udGV4dC5wcm9ncmVzc2l2ZVN0YWdlc0RvbmUgPT09IDAgPyBBRERfUFJJT1JJVFlfVE9fTE9XX1FVQUxJVFkgOlxyXG4gICAgICAgICAgICBqb2JDb250ZXh0LnByb2dyZXNzaXZlU3RhZ2VzRG9uZSA9PT0gMSA/IDEgOlxyXG4gICAgICAgICAgICAwO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICByZXR1cm4gcHJpb3JpdHkgKyBwcmlvcml0aXplTG93UHJvZ3Jlc3NpdmVTdGFnZTtcclxufTtcclxuXHJcbkZydXN0dW1SZXF1ZXN0c1ByaW9yaXRpemVyLnByb3RvdHlwZS5fZ2V0UHJpb3JpdHlJbnRlcm5hbCA9IGZ1bmN0aW9uIGdldFByaW9yaXR5SW50ZXJuYWwoaW1hZ2VQYXJ0UGFyYW1zKSB7XHJcbiAgICBpZiAodGhpcy5fZnJ1c3R1bURhdGEgPT09IG51bGwpIHtcclxuICAgICAgICByZXR1cm4gUFJJT1JJVFlfQ0FMQ1VMQVRJT05fRkFJTEVEO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBpZiAodGhpcy5fZnJ1c3R1bURhdGEuaW1hZ2VSZWN0YW5nbGUgPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IE5vIGltYWdlUmVjdGFuZ2xlIGluZm9ybWF0aW9uIHBhc3NlZCBpbiBzZXRQcmlvcml0aXplckRhdGEnO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICB2YXIgZXhhY3RGcnVzdHVtTGV2ZWwgPSB0aGlzLl9mcnVzdHVtRGF0YS5leGFjdGxldmVsO1xyXG4gICAgXHJcbiAgICBpZiAodGhpcy5fZnJ1c3R1bURhdGEuZXhhY3RsZXZlbCA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogTm8gZXhhY3RsZXZlbCBpbmZvcm1hdGlvbiBwYXNzZWQgaW4gJyArXHJcbiAgICAgICAgICAgICdzZXRQcmlvcml0aXplckRhdGEuIFVzZSBudWxsIGlmIHVua25vd24nO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICB2YXIgdGlsZVdlc3QgPSB0aGlzLl9waXhlbFRvQ2FydG9ncmFwaGljWChcclxuICAgICAgICBpbWFnZVBhcnRQYXJhbXMubWluWCwgaW1hZ2VQYXJ0UGFyYW1zKTtcclxuICAgIHZhciB0aWxlRWFzdCA9IHRoaXMuX3BpeGVsVG9DYXJ0b2dyYXBoaWNYKFxyXG4gICAgICAgIGltYWdlUGFydFBhcmFtcy5tYXhYRXhjbHVzaXZlLCBpbWFnZVBhcnRQYXJhbXMpO1xyXG4gICAgdmFyIHRpbGVOb3J0aCA9IHRoaXMuX3BpeGVsVG9DYXJ0b2dyYXBoaWNZKFxyXG4gICAgICAgIGltYWdlUGFydFBhcmFtcy5taW5ZLCBpbWFnZVBhcnRQYXJhbXMpO1xyXG4gICAgdmFyIHRpbGVTb3V0aCA9IHRoaXMuX3BpeGVsVG9DYXJ0b2dyYXBoaWNZKFxyXG4gICAgICAgIGltYWdlUGFydFBhcmFtcy5tYXhZRXhjbHVzaXZlLCBpbWFnZVBhcnRQYXJhbXMpO1xyXG4gICAgXHJcbiAgICB2YXIgdGlsZVBpeGVsc1dpZHRoID1cclxuICAgICAgICBpbWFnZVBhcnRQYXJhbXMubWF4WEV4Y2x1c2l2ZSAtIGltYWdlUGFydFBhcmFtcy5taW5YO1xyXG4gICAgdmFyIHRpbGVQaXhlbHNIZWlnaHQgPVxyXG4gICAgICAgIGltYWdlUGFydFBhcmFtcy5tYXhZRXhjbHVzaXZlIC0gaW1hZ2VQYXJ0UGFyYW1zLm1pblk7XHJcbiAgICBcclxuICAgIHZhciByZXF1ZXN0VG9GcnVzdHVtUmVzb2x1dGlvblJhdGlvO1xyXG4gICAgdmFyIHRpbGVMZXZlbCA9IGltYWdlUGFydFBhcmFtcy5sZXZlbCB8fCAwO1xyXG4gICAgaWYgKGV4YWN0RnJ1c3R1bUxldmVsID09PSBudWxsKSB7XHJcbiAgICAgICAgdmFyIHRpbGVSZXNvbHV0aW9uWCA9IHRpbGVQaXhlbHNXaWR0aCAvICh0aWxlRWFzdCAtIHRpbGVXZXN0KTtcclxuICAgICAgICB2YXIgdGlsZVJlc29sdXRpb25ZID0gdGlsZVBpeGVsc0hlaWdodCAvICh0aWxlTm9ydGggLSB0aWxlU291dGgpO1xyXG4gICAgICAgIHZhciB0aWxlUmVzb2x1dGlvbiA9IE1hdGgubWF4KHRpbGVSZXNvbHV0aW9uWCwgdGlsZVJlc29sdXRpb25ZKTtcclxuICAgICAgICB2YXIgZnJ1c3R1bVJlc29sdXRpb24gPSB0aGlzLl9mcnVzdHVtRGF0YS5yZXNvbHV0aW9uO1xyXG4gICAgICAgIHJlcXVlc3RUb0ZydXN0dW1SZXNvbHV0aW9uUmF0aW8gPSB0aWxlUmVzb2x1dGlvbiAvIGZydXN0dW1SZXNvbHV0aW9uO1xyXG4gICAgXHJcbiAgICAgICAgaWYgKHJlcXVlc3RUb0ZydXN0dW1SZXNvbHV0aW9uUmF0aW8gPiAyKSB7XHJcbiAgICAgICAgICAgIHJldHVybiBQUklPUklUWV9UT09fR09PRF9SRVNPTFVUSU9OO1xyXG4gICAgICAgIH1cclxuICAgIH0gZWxzZSBpZiAodGlsZUxldmVsIDwgZXhhY3RGcnVzdHVtTGV2ZWwpIHtcclxuICAgICAgICByZXR1cm4gUFJJT1JJVFlfVE9PX0dPT0RfUkVTT0xVVElPTjtcclxuICAgIH1cclxuICAgIFxyXG4gICAgdmFyIGZydXN0dW1SZWN0YW5nbGUgPSB0aGlzLl9mcnVzdHVtRGF0YS5yZWN0YW5nbGU7XHJcbiAgICB2YXIgaW50ZXJzZWN0aW9uV2VzdCA9IE1hdGgubWF4KGZydXN0dW1SZWN0YW5nbGUud2VzdCwgdGlsZVdlc3QpO1xyXG4gICAgdmFyIGludGVyc2VjdGlvbkVhc3QgPSBNYXRoLm1pbihmcnVzdHVtUmVjdGFuZ2xlLmVhc3QsIHRpbGVFYXN0KTtcclxuICAgIHZhciBpbnRlcnNlY3Rpb25Tb3V0aCA9IE1hdGgubWF4KGZydXN0dW1SZWN0YW5nbGUuc291dGgsIHRpbGVTb3V0aCk7XHJcbiAgICB2YXIgaW50ZXJzZWN0aW9uTm9ydGggPSBNYXRoLm1pbihmcnVzdHVtUmVjdGFuZ2xlLm5vcnRoLCB0aWxlTm9ydGgpO1xyXG4gICAgXHJcbiAgICB2YXIgaW50ZXJzZWN0aW9uV2lkdGggPSBpbnRlcnNlY3Rpb25FYXN0IC0gaW50ZXJzZWN0aW9uV2VzdDtcclxuICAgIHZhciBpbnRlcnNlY3Rpb25IZWlnaHQgPSBpbnRlcnNlY3Rpb25Ob3J0aCAtIGludGVyc2VjdGlvblNvdXRoO1xyXG4gICAgXHJcbiAgICBpZiAoaW50ZXJzZWN0aW9uV2lkdGggPCAwIHx8IGludGVyc2VjdGlvbkhlaWdodCA8IDApIHtcclxuICAgICAgICByZXR1cm4gUFJJT1JJVFlfTk9UX0lOX0ZSVVNUVU07XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGlmIChleGFjdEZydXN0dW1MZXZlbCAhPT0gbnVsbCkge1xyXG4gICAgICAgIGlmICh0aWxlTGV2ZWwgPiBleGFjdEZydXN0dW1MZXZlbCkge1xyXG4gICAgICAgICAgICByZXR1cm4gUFJJT1JJVFlfTE9XRVJfUkVTT0xVVElPTjtcclxuICAgICAgICB9XHJcbiAgICB9IGVsc2UgaWYgKHRpbGVMZXZlbCA+IDAgJiYgcmVxdWVzdFRvRnJ1c3R1bVJlc29sdXRpb25SYXRpbyA8IDAuMjUpIHtcclxuICAgICAgICByZXR1cm4gUFJJT1JJVFlfTE9XRVJfUkVTT0xVVElPTjtcclxuICAgIH1cclxuICAgIFxyXG4gICAgdmFyIGludGVyc2VjdGlvbkFyZWEgPSBpbnRlcnNlY3Rpb25XaWR0aCAqIGludGVyc2VjdGlvbkhlaWdodDtcclxuICAgIHZhciB0aWxlQXJlYSA9ICh0aWxlRWFzdCAtIHRpbGVXZXN0KSAqICh0aWxlTm9ydGggLSB0aWxlU291dGgpO1xyXG4gICAgdmFyIHBhcnRJbkZydXN0dW0gPSBpbnRlcnNlY3Rpb25BcmVhIC8gdGlsZUFyZWE7XHJcbiAgICBcclxuICAgIGlmIChwYXJ0SW5GcnVzdHVtID4gMC45OSkge1xyXG4gICAgICAgIHJldHVybiBQUklPUklUWV9GVUxMWV9JTl9GUlVTVFVNO1xyXG4gICAgfSBlbHNlIGlmIChwYXJ0SW5GcnVzdHVtID4gMC43KSB7XHJcbiAgICAgICAgcmV0dXJuIFBSSU9SSVRZX01BSk9SSVRZX0lOX0ZSVVNUVU07XHJcbiAgICB9IGVsc2UgaWYgKHBhcnRJbkZydXN0dW0gPiAwLjMpIHtcclxuICAgICAgICByZXR1cm4gUFJJT1JJVFlfUEFSVElBTF9JTl9GUlVTVFVNO1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgICByZXR1cm4gUFJJT1JJVFlfTUlOT1JJVFlfSU5fRlJVU1RVTTtcclxuICAgIH1cclxufTtcclxuXHJcbkZydXN0dW1SZXF1ZXN0c1ByaW9yaXRpemVyLnByb3RvdHlwZS5fcGl4ZWxUb0NhcnRvZ3JhcGhpY1ggPSBmdW5jdGlvbiBwaXhlbFRvQ2FydG9ncmFwaGljWChcclxuICAgIHgsIGltYWdlUGFydFBhcmFtcykge1xyXG4gICAgXHJcbiAgICB2YXIgcmVsYXRpdmVYID0geCAvIGltYWdlUGFydFBhcmFtcy5sZXZlbFdpZHRoO1xyXG4gICAgXHJcbiAgICB2YXIgaW1hZ2VSZWN0YW5nbGUgPSB0aGlzLl9mcnVzdHVtRGF0YS5pbWFnZVJlY3RhbmdsZTtcclxuICAgIHZhciByZWN0YW5nbGVXaWR0aCA9IGltYWdlUmVjdGFuZ2xlLmVhc3QgLSBpbWFnZVJlY3RhbmdsZS53ZXN0O1xyXG4gICAgXHJcbiAgICB2YXIgeFByb2plY3RlZCA9IGltYWdlUmVjdGFuZ2xlLndlc3QgKyByZWxhdGl2ZVggKiByZWN0YW5nbGVXaWR0aDtcclxuICAgIHJldHVybiB4UHJvamVjdGVkO1xyXG59O1xyXG5cclxuRnJ1c3R1bVJlcXVlc3RzUHJpb3JpdGl6ZXIucHJvdG90eXBlLl9waXhlbFRvQ2FydG9ncmFwaGljWSA9IGZ1bmN0aW9uIHRpbGVUb0NhcnRvZ3JhcGhpY1koXHJcbiAgICB5LCBpbWFnZVBhcnRQYXJhbXMsIGltYWdlKSB7XHJcbiAgICBcclxuICAgIHZhciByZWxhdGl2ZVkgPSB5IC8gaW1hZ2VQYXJ0UGFyYW1zLmxldmVsSGVpZ2h0O1xyXG4gICAgXHJcbiAgICB2YXIgaW1hZ2VSZWN0YW5nbGUgPSB0aGlzLl9mcnVzdHVtRGF0YS5pbWFnZVJlY3RhbmdsZTtcclxuICAgIHZhciByZWN0YW5nbGVIZWlnaHQgPSBpbWFnZVJlY3RhbmdsZS5ub3J0aCAtIGltYWdlUmVjdGFuZ2xlLnNvdXRoO1xyXG4gICAgXHJcbiAgICB2YXIgeVByb2plY3RlZCA9IGltYWdlUmVjdGFuZ2xlLm5vcnRoIC0gcmVsYXRpdmVZICogcmVjdGFuZ2xlSGVpZ2h0O1xyXG4gICAgcmV0dXJuIHlQcm9qZWN0ZWQ7XHJcbn07IiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxudmFyIEZydXN0dW1SZXF1ZXN0c1ByaW9yaXRpemVyID0gcmVxdWlyZSgnZnJ1c3R1bS1yZXF1ZXN0cy1wcmlvcml0aXplci5qcycpO1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSB7XHJcbiAgICBjYWxjdWxhdGVGcnVzdHVtMkRGcm9tQm91bmRzOiBjYWxjdWxhdGVGcnVzdHVtMkRGcm9tQm91bmRzLFxyXG4gICAgY3JlYXRlUHJpb3JpdGl6ZXI6IGNyZWF0ZVByaW9yaXRpemVyLFxyXG4gICAgZml4Qm91bmRzOiBmaXhCb3VuZHMsXHJcbiAgICBlbnN1cmVMZXZlbENhbGN1bGF0b3I6IGVuc3VyZUxldmVsQ2FsY3VsYXRvcixcclxuICAgIGFsaWduUGFyYW1zVG9UaWxlc0FuZExldmVsOiBhbGlnblBhcmFtc1RvVGlsZXNBbmRMZXZlbCxcclxuICAgIGdldE9yQ3JlYXRlSW5zdGFuY2U6IGdldE9yQ3JlYXRlSW5zdGFuY2UsXHJcbiAgICBpc0luZGlyZWN0Q3JlYXRpb25OZWVkZWQ6IGlzSW5kaXJlY3RDcmVhdGlvbk5lZWRlZFxyXG59O1xyXG5cclxuLy8gQXZvaWQganNoaW50IGVycm9yXHJcbi8qIGdsb2JhbCBzZWxmOiBmYWxzZSAqL1xyXG4vKiBnbG9iYWwgZ2xvYmFsczogZmFsc2UgKi9cclxuICAgIFxyXG4vL3ZhciBsb2cyID0gTWF0aC5sb2coMik7XHJcblxyXG5mdW5jdGlvbiBjYWxjdWxhdGVGcnVzdHVtMkRGcm9tQm91bmRzKFxyXG4gICAgYm91bmRzLCBzY3JlZW5TaXplKSB7XHJcbiAgICBcclxuICAgIHZhciBzY3JlZW5QaXhlbHMgPVxyXG4gICAgICAgIHNjcmVlblNpemUueCAqIHNjcmVlblNpemUueCArIHNjcmVlblNpemUueSAqIHNjcmVlblNpemUueTtcclxuICAgIFxyXG4gICAgdmFyIGJvdW5kc1dpZHRoID0gYm91bmRzLmVhc3QgLSBib3VuZHMud2VzdDtcclxuICAgIHZhciBib3VuZHNIZWlnaHQgPSBib3VuZHMubm9ydGggLSBib3VuZHMuc291dGg7XHJcbiAgICB2YXIgYm91bmRzRGlzdGFuY2UgPVxyXG4gICAgICAgIGJvdW5kc1dpZHRoICogYm91bmRzV2lkdGggKyBib3VuZHNIZWlnaHQgKiBib3VuZHNIZWlnaHQ7XHJcbiAgICBcclxuICAgIHZhciByZXNvbHV0aW9uID0gTWF0aC5zcXJ0KHNjcmVlblBpeGVscyAvIGJvdW5kc0Rpc3RhbmNlKTtcclxuICAgIFxyXG4gICAgdmFyIGZydXN0dW1EYXRhID0ge1xyXG4gICAgICAgIHJlc29sdXRpb246IHJlc29sdXRpb24sXHJcbiAgICAgICAgcmVjdGFuZ2xlOiBib3VuZHMsXHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gUmVkdW5kYW50LCBidXQgZW5hYmxlcyB0byBhdm9pZCBhbHJlYWR5LXBlcmZvcm1lZCBjYWxjdWxhdGlvblxyXG4gICAgICAgIHNjcmVlblNpemU6IHNjcmVlblNpemVcclxuICAgIH07XHJcbiAgICBcclxuICAgIHJldHVybiBmcnVzdHVtRGF0YTtcclxufVxyXG4gICAgXHJcbmZ1bmN0aW9uIGNyZWF0ZVByaW9yaXRpemVyKFxyXG4gICAgcmVzb3VyY2VMaW1pdCwgcHJpb3JpdGl6ZXJUeXBlLCBzY2hlZHVsZXJOYW1lLCBzaG93TG9nKSB7XHJcbiAgICBcclxuICAgIHZhciBwcmlvcml0aXplcjtcclxuICAgIHZhciBsaW1pdFJlc291cmNlQnlMb3dRdWFsaXR5UHJpb3JpdHkgPSBmYWxzZTtcclxuICAgIFxyXG4gICAgaWYgKHByaW9yaXRpemVyVHlwZSA9PT0gJ2ZydXN0dW0nKSB7XHJcbiAgICAgICAgbGltaXRSZXNvdXJjZUJ5TG93UXVhbGl0eVByaW9yaXR5ID0gdHJ1ZTtcclxuICAgICAgICBwcmlvcml0aXplciA9IG5ldyBGcnVzdHVtUmVxdWVzdHNQcmlvcml0aXplcigpO1xyXG4gICAgfSBlbHNlIGlmIChwcmlvcml0aXplclR5cGUgPT09ICdmcnVzdHVtT25seScpIHtcclxuICAgICAgICBsaW1pdFJlc291cmNlQnlMb3dRdWFsaXR5UHJpb3JpdHkgPSB0cnVlO1xyXG4gICAgICAgIHByaW9yaXRpemVyID0gbmV3IEZydXN0dW1SZXF1ZXN0c1ByaW9yaXRpemVyKFxyXG4gICAgICAgICAgICAvKmlzQWJvcnRSZXF1ZXN0c05vdEluRnJ1c3R1bT0qL3RydWUsXHJcbiAgICAgICAgICAgIC8qaXNQcmlvcml0aXplTG93UXVhbGl0eVN0YWdlPSovdHJ1ZSk7XHJcbiAgICB9IGVsc2UgaWYgKCFwcmlvcml0aXplclR5cGUpIHtcclxuICAgICAgICBwcmlvcml0aXplciA9IG51bGw7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICAgIHByaW9yaXRpemVyID0gcHJpb3JpdGl6ZXJUeXBlO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICB2YXIgb3B0aW9ucyA9IHtcclxuICAgICAgICBzY2hlZHVsZXJOYW1lOiBzY2hlZHVsZXJOYW1lLFxyXG4gICAgICAgIHNob3dMb2c6IHNob3dMb2dcclxuICAgIH07XHJcbiAgICBcclxuICAgIGlmIChsaW1pdFJlc291cmNlQnlMb3dRdWFsaXR5UHJpb3JpdHkpIHtcclxuICAgICAgICBvcHRpb25zLnJlc291cmNlR3VhcmFudGVlZEZvckhpZ2hQcmlvcml0eSA9IHJlc291cmNlTGltaXQgLSAyO1xyXG4gICAgICAgIG9wdGlvbnMuaGlnaFByaW9yaXR5VG9HdWFyYW50ZWVSZXNvdXJjZSA9XHJcbiAgICAgICAgICAgIHByaW9yaXRpemVyLm1pbmltYWxMb3dRdWFsaXR5UHJpb3JpdHk7XHJcbiAgICB9XHJcbiAgICAgICAgXHJcbiAgICByZXR1cm4ge1xyXG4gICAgICAgIHByaW9yaXRpemVyOiBwcmlvcml0aXplcixcclxuICAgICAgICBzY2hlZHVsZXJPcHRpb25zOiBvcHRpb25zXHJcbiAgICB9O1xyXG59XHJcbiAgICBcclxuZnVuY3Rpb24gZml4Qm91bmRzKGJvdW5kcywgaW1hZ2UsIGFkYXB0UHJvcG9ydGlvbnMpIHtcclxuICAgIGlmICghYWRhcHRQcm9wb3J0aW9ucykge1xyXG4gICAgICAgIHJldHVybjtcclxuICAgIH1cclxuXHJcbiAgICB2YXIgcmVjdGFuZ2xlV2lkdGggPSBib3VuZHMuZWFzdCAtIGJvdW5kcy53ZXN0O1xyXG4gICAgdmFyIHJlY3RhbmdsZUhlaWdodCA9IGJvdW5kcy5ub3J0aCAtIGJvdW5kcy5zb3V0aDtcclxuXHJcbiAgICB2YXIgcGl4ZWxzQXNwZWN0UmF0aW8gPSBpbWFnZS5nZXRJbWFnZVdpZHRoKCkgLyBpbWFnZS5nZXRJbWFnZUhlaWdodCgpO1xyXG4gICAgdmFyIHJlY3RhbmdsZUFzcGVjdFJhdGlvID0gcmVjdGFuZ2xlV2lkdGggLyByZWN0YW5nbGVIZWlnaHQ7XHJcbiAgICBcclxuICAgIGlmIChwaXhlbHNBc3BlY3RSYXRpbyA8IHJlY3RhbmdsZUFzcGVjdFJhdGlvKSB7XHJcbiAgICAgICAgdmFyIG9sZFdpZHRoID0gcmVjdGFuZ2xlV2lkdGg7XHJcbiAgICAgICAgcmVjdGFuZ2xlV2lkdGggPSByZWN0YW5nbGVIZWlnaHQgKiBwaXhlbHNBc3BlY3RSYXRpbztcclxuICAgICAgICB2YXIgc3Vic3RyYWN0RnJvbVdpZHRoID0gb2xkV2lkdGggLSByZWN0YW5nbGVXaWR0aDtcclxuICAgICAgICBcclxuICAgICAgICBib3VuZHMuZWFzdCAtPSBzdWJzdHJhY3RGcm9tV2lkdGggLyAyO1xyXG4gICAgICAgIGJvdW5kcy53ZXN0ICs9IHN1YnN0cmFjdEZyb21XaWR0aCAvIDI7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICAgIHZhciBvbGRIZWlnaHQgPSByZWN0YW5nbGVIZWlnaHQ7XHJcbiAgICAgICAgcmVjdGFuZ2xlSGVpZ2h0ID0gcmVjdGFuZ2xlV2lkdGggLyBwaXhlbHNBc3BlY3RSYXRpbztcclxuICAgICAgICB2YXIgc3Vic3RyYWN0RnJvbUhlaWdodCA9IG9sZEhlaWdodCAtIHJlY3RhbmdsZUhlaWdodDtcclxuICAgICAgICBcclxuICAgICAgICBib3VuZHMubm9ydGggLT0gc3Vic3RyYWN0RnJvbUhlaWdodCAvIDI7XHJcbiAgICAgICAgYm91bmRzLnNvdXRoICs9IHN1YnN0cmFjdEZyb21IZWlnaHQgLyAyO1xyXG4gICAgfVxyXG59XHJcblxyXG5mdW5jdGlvbiBlbnN1cmVMZXZlbENhbGN1bGF0b3IobGV2ZWxDYWxjdWxhdG9yKSB7XHJcbiAgICBpZiAoJ2Z1bmN0aW9uJyAhPT0gdHlwZW9mIGxldmVsQ2FsY3VsYXRvci5nZXRMZXZlbCkge1xyXG4gICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IE1pc3NpbmcgbWV0aG9kIGxldmVsQ2FsY3VsYXRvci5nZXRMZXZlbCgpJztcclxuICAgIH1cclxuICAgIGlmICgnZnVuY3Rpb24nICE9PSB0eXBlb2YgbGV2ZWxDYWxjdWxhdG9yLmdldExldmVsV2lkdGgpIHtcclxuICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBNaXNzaW5nIG1ldGhvZCBsZXZlbENhbGN1bGF0b3IuZ2V0TGV2ZWxXaWR0aCgpJztcclxuICAgIH1cclxuICAgIGlmICgnZnVuY3Rpb24nICE9PSB0eXBlb2YgbGV2ZWxDYWxjdWxhdG9yLmdldExldmVsSGVpZ2h0KSB7XHJcbiAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogTWlzc2luZyBtZXRob2QgbGV2ZWxDYWxjdWxhdG9yLmdldExldmVsSGVpZ2h0KCknO1xyXG4gICAgfVxyXG59XHJcblxyXG5mdW5jdGlvbiBhbGlnblBhcmFtc1RvVGlsZXNBbmRMZXZlbChyZWdpb24sIGltYWdlRGVjb2Rlcikge1xyXG4gICAgdmFyIHRpbGVXaWR0aCA9IGltYWdlRGVjb2Rlci5nZXRUaWxlV2lkdGgoKTtcclxuICAgIHZhciB0aWxlSGVpZ2h0ID0gaW1hZ2VEZWNvZGVyLmdldFRpbGVIZWlnaHQoKTtcclxuICAgIFxyXG4gICAgdmFyIHJlZ2lvbk1pblggPSByZWdpb24ubWluWDtcclxuICAgIHZhciByZWdpb25NaW5ZID0gcmVnaW9uLm1pblk7XHJcbiAgICB2YXIgcmVnaW9uTWF4WCA9IHJlZ2lvbi5tYXhYRXhjbHVzaXZlO1xyXG4gICAgdmFyIHJlZ2lvbk1heFkgPSByZWdpb24ubWF4WUV4Y2x1c2l2ZTtcclxuICAgIHZhciBzY3JlZW5XaWR0aCA9IHJlZ2lvbi5zY3JlZW5XaWR0aDtcclxuICAgIHZhciBzY3JlZW5IZWlnaHQgPSByZWdpb24uc2NyZWVuSGVpZ2h0O1xyXG4gICAgXHJcbiAgICB2YXIgaXNWYWxpZE9yZGVyID0gcmVnaW9uTWluWCA8IHJlZ2lvbk1heFggJiYgcmVnaW9uTWluWSA8IHJlZ2lvbk1heFk7XHJcbiAgICBpZiAoIWlzVmFsaWRPcmRlcikge1xyXG4gICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IFBhcmFtZXRlcnMgb3JkZXIgaXMgaW52YWxpZCc7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHZhciBkZWZhdWx0TGV2ZWxXaWR0aCA9IGltYWdlRGVjb2Rlci5nZXRJbWFnZVdpZHRoKCk7XHJcbiAgICB2YXIgZGVmYXVsdExldmVsSGVpZ2h0ID0gaW1hZ2VEZWNvZGVyLmdldEltYWdlSGVpZ2h0KCk7XHJcbiAgICBpZiAocmVnaW9uTWF4WCA8IDAgfHwgcmVnaW9uTWluWCA+PSBkZWZhdWx0TGV2ZWxXaWR0aCB8fFxyXG4gICAgICAgIHJlZ2lvbk1heFkgPCAwIHx8IHJlZ2lvbk1pblkgPj0gZGVmYXVsdExldmVsSGVpZ2h0KSB7XHJcbiAgICAgICAgXHJcbiAgICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHZhciBsZXZlbENhbGN1bGF0b3IgPSBpbWFnZURlY29kZXIuZ2V0TGV2ZWxDYWxjdWxhdG9yKCk7XHJcbiAgICB2YXIgbGV2ZWwgPSBsZXZlbENhbGN1bGF0b3IuZ2V0TGV2ZWwocmVnaW9uKTtcclxuICAgIHZhciBsZXZlbFdpZHRoID0gbGV2ZWxDYWxjdWxhdG9yLmdldExldmVsV2lkdGgobGV2ZWwpO1xyXG4gICAgdmFyIGxldmVsSGVpZ2h0ID0gbGV2ZWxDYWxjdWxhdG9yLmdldExldmVsSGVpZ2h0KGxldmVsKTtcclxuICAgIFxyXG4gICAgdmFyIHNjYWxlWCA9IGRlZmF1bHRMZXZlbFdpZHRoIC8gbGV2ZWxXaWR0aDtcclxuICAgIHZhciBzY2FsZVkgPSBkZWZhdWx0TGV2ZWxIZWlnaHQgLyBsZXZlbEhlaWdodDtcclxuICAgIFxyXG4gICAgdmFyIG1pblRpbGVYID0gTWF0aC5mbG9vcihyZWdpb25NaW5YIC8gKHNjYWxlWCAqIHRpbGVXaWR0aCApKTtcclxuICAgIHZhciBtaW5UaWxlWSA9IE1hdGguZmxvb3IocmVnaW9uTWluWSAvIChzY2FsZVkgKiB0aWxlSGVpZ2h0KSk7XHJcbiAgICB2YXIgbWF4VGlsZVggPSBNYXRoLmNlaWwgKHJlZ2lvbk1heFggLyAoc2NhbGVYICogdGlsZVdpZHRoICkpO1xyXG4gICAgdmFyIG1heFRpbGVZID0gTWF0aC5jZWlsIChyZWdpb25NYXhZIC8gKHNjYWxlWSAqIHRpbGVIZWlnaHQpKTtcclxuICAgIFxyXG4gICAgdmFyIG1pblggPSBtaW5UaWxlWCAqIHRpbGVXaWR0aDtcclxuICAgIHZhciBtaW5ZID0gbWluVGlsZVkgKiB0aWxlSGVpZ2h0O1xyXG4gICAgdmFyIG1heFggPSBtYXhUaWxlWCAqIHRpbGVXaWR0aDtcclxuICAgIHZhciBtYXhZID0gbWF4VGlsZVkgKiB0aWxlSGVpZ2h0O1xyXG4gICAgXHJcbiAgICB2YXIgY3JvcHBlZE1pblggPSBNYXRoLm1heCgwLCBNYXRoLm1pbihsZXZlbFdpZHRoICwgbWluWCkpO1xyXG4gICAgdmFyIGNyb3BwZWRNaW5ZID0gTWF0aC5tYXgoMCwgTWF0aC5taW4obGV2ZWxIZWlnaHQsIG1pblkpKTtcclxuICAgIHZhciBjcm9wcGVkTWF4WCA9IE1hdGgubWF4KDAsIE1hdGgubWluKGxldmVsV2lkdGggLCBtYXhYKSk7XHJcbiAgICB2YXIgY3JvcHBlZE1heFkgPSBNYXRoLm1heCgwLCBNYXRoLm1pbihsZXZlbEhlaWdodCwgbWF4WSkpO1xyXG4gICAgXHJcbiAgICB2YXIgaW1hZ2VQYXJhbXNUb1NjcmVlblNjYWxlWCA9IHNjcmVlbldpZHRoICAvIChtYXhYIC0gbWluWCk7XHJcbiAgICB2YXIgaW1hZ2VQYXJhbXNUb1NjcmVlblNjYWxlWSA9IHNjcmVlbkhlaWdodCAvIChtYXhZIC0gbWluWSk7XHJcbiAgICBcclxuICAgIHZhciBpbWFnZVBhcnRQYXJhbXMgPSB7XHJcbiAgICAgICAgbWluWDogY3JvcHBlZE1pblgsXHJcbiAgICAgICAgbWluWTogY3JvcHBlZE1pblksXHJcbiAgICAgICAgbWF4WEV4Y2x1c2l2ZTogY3JvcHBlZE1heFgsXHJcbiAgICAgICAgbWF4WUV4Y2x1c2l2ZTogY3JvcHBlZE1heFksXHJcbiAgICAgICAgbGV2ZWxXaWR0aDogbGV2ZWxXaWR0aCxcclxuICAgICAgICBsZXZlbEhlaWdodDogbGV2ZWxIZWlnaHQsXHJcbiAgICAgICAgbGV2ZWw6IGxldmVsXHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICB2YXIgcG9zaXRpb25JbkltYWdlID0ge1xyXG4gICAgICAgIG1pblg6IGNyb3BwZWRNaW5YICogc2NhbGVYLFxyXG4gICAgICAgIG1pblk6IGNyb3BwZWRNaW5ZICogc2NhbGVZLFxyXG4gICAgICAgIG1heFhFeGNsdXNpdmU6IGNyb3BwZWRNYXhYICogc2NhbGVYLFxyXG4gICAgICAgIG1heFlFeGNsdXNpdmU6IGNyb3BwZWRNYXhZICogc2NhbGVZXHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICB2YXIgY3JvcHBlZFNjcmVlbiA9IHtcclxuICAgICAgICBtaW5YIDogTWF0aC5mbG9vcigoY3JvcHBlZE1pblggLSBtaW5YKSAqIGltYWdlUGFyYW1zVG9TY3JlZW5TY2FsZVgpLFxyXG4gICAgICAgIG1pblkgOiBNYXRoLmZsb29yKChjcm9wcGVkTWluWSAtIG1pblkpICogaW1hZ2VQYXJhbXNUb1NjcmVlblNjYWxlWSksXHJcbiAgICAgICAgbWF4WEV4Y2x1c2l2ZSA6IE1hdGguY2VpbCgoY3JvcHBlZE1heFggLSBtaW5YKSAqIGltYWdlUGFyYW1zVG9TY3JlZW5TY2FsZVgpLFxyXG4gICAgICAgIG1heFlFeGNsdXNpdmUgOiBNYXRoLmNlaWwoKGNyb3BwZWRNYXhZIC0gbWluWSkgKiBpbWFnZVBhcmFtc1RvU2NyZWVuU2NhbGVZKVxyXG4gICAgfTtcclxuICAgIFxyXG4gICAgcmV0dXJuIHtcclxuICAgICAgICBpbWFnZVBhcnRQYXJhbXM6IGltYWdlUGFydFBhcmFtcyxcclxuICAgICAgICBwb3NpdGlvbkluSW1hZ2U6IHBvc2l0aW9uSW5JbWFnZSxcclxuICAgICAgICBjcm9wcGVkU2NyZWVuOiBjcm9wcGVkU2NyZWVuXHJcbiAgICB9O1xyXG59XHJcblxyXG5mdW5jdGlvbiBnZXRPckNyZWF0ZUluc3RhbmNlKG9iaiwgb2JqTmFtZSwgZXhwZWN0ZWRNZXRob2RzKSB7XHJcbiAgICBpZiAoIWlzSW5kaXJlY3RDcmVhdGlvbk5lZWRlZChvYmosIG9iak5hbWUsIGV4cGVjdGVkTWV0aG9kcykpIHtcclxuICAgICAgICByZXR1cm4gb2JqO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICB2YXIgY2xhc3NUb0NyZWF0ZSA9IG51bGw7XHJcbiAgICB0cnkge1xyXG4gICAgICAgIGNsYXNzVG9DcmVhdGUgPSBnZXRDbGFzc0luR2xvYmFsT2JqZWN0KHdpbmRvdywgb2JqLmN0b3JOYW1lKTtcclxuICAgIH0gY2F0Y2goZSkgeyB9XHJcblxyXG4gICAgaWYgKCFjbGFzc1RvQ3JlYXRlKSB7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgY2xhc3NUb0NyZWF0ZSA9IGdldENsYXNzSW5HbG9iYWxPYmplY3QoZ2xvYmFscywgb2JqLmN0b3JOYW1lKTtcclxuICAgICAgICB9IGNhdGNoKGUpIHsgfVxyXG4gICAgfVxyXG4gICAgXHJcbiAgICBpZiAoIWNsYXNzVG9DcmVhdGUpIHtcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICBjbGFzc1RvQ3JlYXRlID0gZ2V0Q2xhc3NJbkdsb2JhbE9iamVjdChzZWxmLCBvYmouY3Rvck5hbWUpO1xyXG4gICAgICAgIH0gY2F0Y2goZSkgeyB9XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGlmICghY2xhc3NUb0NyZWF0ZSkge1xyXG4gICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IENvdWxkIG5vdCBmaW5kIGNsYXNzICcgKyBvYmouY3Rvck5hbWUgKyAnIGluIGdsb2JhbCAnICtcclxuICAgICAgICAgICAgJyBzY29wZSB0byBjcmVhdGUgYW4gaW5zdGFuY2Ugb2YgJyArIG9iak5hbWU7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHZhciByZXN1bHQgPSBuZXcgY2xhc3NUb0NyZWF0ZSgpO1xyXG4gICAgXHJcbiAgICAvLyBUaHJvdyBleGNlcHRpb24gaWYgbWV0aG9kcyBub3QgZXhpc3RcclxuICAgIGlzSW5kaXJlY3RDcmVhdGlvbk5lZWRlZChyZXN1bHQsIG9iak5hbWUsIGV4cGVjdGVkTWV0aG9kcywgLypkaXNhYmxlQ3Rvck5hbWVTZWFyY2g9Ki90cnVlKTtcclxuICAgIFxyXG4gICAgcmV0dXJuIHJlc3VsdDtcclxufVxyXG5cclxuZnVuY3Rpb24gaXNJbmRpcmVjdENyZWF0aW9uTmVlZGVkKG9iaiwgb2JqTmFtZSwgZXhwZWN0ZWRNZXRob2RzLCBkaXNhYmxlQ3Rvck5hbWVTZWFyY2gpIHtcclxuICAgIGlmICghb2JqKSB7XHJcbiAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogbWlzc2luZyBhcmd1bWVudCAnICsgb2JqTmFtZTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgdmFyIG5vbmV4aXN0aW5nTWV0aG9kO1xyXG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBleHBlY3RlZE1ldGhvZHMubGVuZ3RoOyArK2kpIHtcclxuICAgICAgICBpZiAoJ2Z1bmN0aW9uJyAhPT0gdHlwZW9mIG9ialtleHBlY3RlZE1ldGhvZHNbaV1dKSB7XHJcbiAgICAgICAgICAgIG5vbmV4aXN0aW5nTWV0aG9kID0gZXhwZWN0ZWRNZXRob2RzW2ldO1xyXG4gICAgICAgICAgICBicmVhaztcclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGlmIChpID09PSBleHBlY3RlZE1ldGhvZHMubGVuZ3RoKSB7XHJcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xyXG4gICAgfVxyXG5cclxuICAgIGlmIChkaXNhYmxlQ3Rvck5hbWVTZWFyY2gpIHtcclxuICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBDb3VsZCBub3QgZmluZCBtZXRob2QgJyArXHJcbiAgICAgICAgICAgIG5vbmV4aXN0aW5nTWV0aG9kICsgJyBpbiBvYmplY3QgJyArIG9iak5hbWU7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGlmICgnc3RyaW5nJyAhPT0gdHlwZW9mIG9iai5jdG9yTmFtZSkge1xyXG4gICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IENvdWxkIG5vdCBmaW5kIG1ldGhvZCAnICsgbm9uZXhpc3RpbmdNZXRob2QgK1xyXG4gICAgICAgICAgICAnIGluIG9iamVjdCAnICsgb2JqTmFtZSArICcuIEVpdGhlciBtZXRob2Qgc2hvdWxkIGJlIGV4aXN0IG9yIHRoZSBvYmplY3RcXCdzICcgK1xyXG4gICAgICAgICAgICAnY3Rvck5hbWUgcHJvcGVydHkgc2hvdWxkIHBvaW50IHRvIGEgY2xhc3MgdG8gY3JlYXRlIGluc3RhbmNlIGZyb20nO1xyXG4gICAgfVxyXG4gICAgaWYgKCFvYmouc2NyaXB0c1RvSW1wb3J0KSB7XHJcbiAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogQ291bGQgbm90IGZpbmQgbWV0aG9kICcgKyBub25leGlzdGluZ01ldGhvZCArXHJcbiAgICAgICAgICAgICcgaW4gb2JqZWN0ICcgKyBvYmpOYW1lICsgJy4gRWl0aGVyIG1ldGhvZCBzaG91bGQgYmUgZXhpc3Qgb3IgdGhlIG9iamVjdFxcJ3MgJyArXHJcbiAgICAgICAgICAgICdzY3JpcHRzVG9JbXBvcnQgcHJvcGVydHkgc2hvdWxkIGJlIGV4aXN0JztcclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4gdHJ1ZTtcclxufVxyXG5cclxuZnVuY3Rpb24gZ2V0Q2xhc3NJbkdsb2JhbE9iamVjdChnbG9iYWxPYmplY3QsIGNsYXNzTmFtZSkge1xyXG4gICAgaWYgKGdsb2JhbE9iamVjdFtjbGFzc05hbWVdKSB7XHJcbiAgICAgICAgcmV0dXJuIGdsb2JhbE9iamVjdFtjbGFzc05hbWVdO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICB2YXIgcmVzdWx0ID0gZ2xvYmFsT2JqZWN0O1xyXG4gICAgdmFyIHBhdGggPSBjbGFzc05hbWUuc3BsaXQoJy4nKTtcclxuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgcGF0aC5sZW5ndGg7ICsraSkge1xyXG4gICAgICAgIHJlc3VsdCA9IHJlc3VsdFtwYXRoW2ldXTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgcmV0dXJuIHJlc3VsdDtcclxufSIsIid1c2Ugc3RyaWN0JztcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gTGlua2VkTGlzdDtcclxuXHJcbmZ1bmN0aW9uIExpbmtlZExpc3QodXNlQXV0b21hdGljSGF6YXJkSGV1cmlzdGljcykge1xyXG4gICAgdGhpcy5fZmlyc3QgPSB7IF9wcmV2OiBudWxsLCBfcGFyZW50OiB0aGlzIH07XHJcbiAgICB0aGlzLl9sYXN0ID0geyBfbmV4dDogbnVsbCwgX3BhcmVudDogdGhpcyB9O1xyXG4gICAgdGhpcy5fY291bnQgPSAwO1xyXG4gICAgdGhpcy5fdXNlQXV0b21hdGljSGF6YXJkSGV1cmlzdGljcyA9IHVzZUF1dG9tYXRpY0hhemFyZEhldXJpc3RpY3M7XHJcbiAgICBcclxuICAgIHRoaXMuX2xhc3QuX3ByZXYgPSB0aGlzLl9maXJzdDtcclxuICAgIHRoaXMuX2ZpcnN0Ll9uZXh0ID0gdGhpcy5fbGFzdDtcclxufVxyXG5cclxuTGlua2VkTGlzdC5wcm90b3R5cGUuYWRkID0gZnVuY3Rpb24gYWRkKHZhbHVlLCBhZGRCZWZvcmUpIHtcclxuICAgIGlmIChhZGRCZWZvcmUgPT09IG51bGwgfHwgYWRkQmVmb3JlID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICBhZGRCZWZvcmUgPSB0aGlzLl9sYXN0O1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICB0aGlzLl92YWxpZGF0ZUl0ZXJhdG9yT2ZUaGlzKGFkZEJlZm9yZSk7XHJcbiAgICBcclxuICAgICsrdGhpcy5fY291bnQ7XHJcbiAgICBcclxuICAgIHZhciBuZXdOb2RlID0ge1xyXG4gICAgICAgIF92YWx1ZTogdmFsdWUsXHJcbiAgICAgICAgX25leHQ6IGFkZEJlZm9yZSxcclxuICAgICAgICBfcHJldjogYWRkQmVmb3JlLl9wcmV2LFxyXG4gICAgICAgIF9pc0l0ZXJhdGVkOiBmYWxzZSxcclxuICAgICAgICBfcGFyZW50OiB0aGlzXHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBuZXdOb2RlLl9wcmV2Ll9uZXh0ID0gbmV3Tm9kZTtcclxuICAgIGFkZEJlZm9yZS5fcHJldiA9IG5ld05vZGU7XHJcbiAgICBcclxuICAgIHJldHVybiBuZXdOb2RlO1xyXG59O1xyXG5cclxuTGlua2VkTGlzdC5wcm90b3R5cGUucmVtb3ZlID0gZnVuY3Rpb24gcmVtb3ZlKGl0ZXJhdG9yKSB7XHJcbiAgICB0aGlzLl92YWxpZGF0ZUl0ZXJhdG9yT2ZUaGlzKGl0ZXJhdG9yKTtcclxuICAgIGlmICh0aGlzLl91c2VBdXRvbWF0aWNIYXphcmRIZXVyaXN0aWNzICYmIGl0ZXJhdG9yLl9pc0l0ZXJhdGVkKSB7XHJcbiAgICAgICAgdGhyb3cgJ2RlcGVuZGVuY3ktd29ya2VycyBlcnJvcjogU3VzcGVjdCByZW1vdmFsIHdoaWxlIGl0ZXJhdGlvbic7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIC0tdGhpcy5fY291bnQ7XHJcbiAgICBcclxuICAgIGl0ZXJhdG9yLl9wcmV2Ll9uZXh0ID0gaXRlcmF0b3IuX25leHQ7XHJcbiAgICBpdGVyYXRvci5fbmV4dC5fcHJldiA9IGl0ZXJhdG9yLl9wcmV2O1xyXG4gICAgaXRlcmF0b3IuX3BhcmVudCA9IG51bGw7XHJcbn07XHJcblxyXG5MaW5rZWRMaXN0LnByb3RvdHlwZS5nZXRWYWx1ZSA9IGZ1bmN0aW9uIGdldFZhbHVlKGl0ZXJhdG9yKSB7XHJcbiAgICB0aGlzLl92YWxpZGF0ZUl0ZXJhdG9yT2ZUaGlzKGl0ZXJhdG9yKTtcclxuICAgIFxyXG4gICAgcmV0dXJuIGl0ZXJhdG9yLl92YWx1ZTtcclxufTtcclxuXHJcbkxpbmtlZExpc3QucHJvdG90eXBlLmdldEZpcnN0SXRlcmF0b3IgPSBmdW5jdGlvbiBnZXRGaXJzdEl0ZXJhdG9yKCkge1xyXG4gICAgdmFyIGl0ZXJhdG9yID0gdGhpcy5nZXROZXh0SXRlcmF0b3IodGhpcy5fZmlyc3QpO1xyXG4gICAgcmV0dXJuIGl0ZXJhdG9yO1xyXG59O1xyXG5cclxuTGlua2VkTGlzdC5wcm90b3R5cGUuZ2V0TGFzdEl0ZXJhdG9yID0gZnVuY3Rpb24gZ2V0Rmlyc3RJdGVyYXRvcigpIHtcclxuICAgIHZhciBpdGVyYXRvciA9IHRoaXMuZ2V0UHJldkl0ZXJhdG9yKHRoaXMuX2xhc3QpO1xyXG4gICAgaXRlcmF0b3IuX2lzSXRlcmF0ZWQgPSB0cnVlO1xyXG4gICAgcmV0dXJuIGl0ZXJhdG9yO1xyXG59O1xyXG5cclxuTGlua2VkTGlzdC5wcm90b3R5cGUuZ2V0TmV4dEl0ZXJhdG9yID0gZnVuY3Rpb24gZ2V0TmV4dEl0ZXJhdG9yKGl0ZXJhdG9yKSB7XHJcbiAgICB0aGlzLl92YWxpZGF0ZUl0ZXJhdG9yT2ZUaGlzKGl0ZXJhdG9yKTtcclxuXHJcbiAgICBpdGVyYXRvci5faXNJdGVyYXRlZCA9IGZhbHNlO1xyXG4gICAgaWYgKGl0ZXJhdG9yLl9uZXh0ID09PSB0aGlzLl9sYXN0KSB7XHJcbiAgICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGl0ZXJhdG9yLl9uZXh0Ll9pc0l0ZXJhdGVkID0gdHJ1ZTtcclxuICAgIHJldHVybiBpdGVyYXRvci5fbmV4dDtcclxufTtcclxuXHJcbkxpbmtlZExpc3QucHJvdG90eXBlLmdldFByZXZJdGVyYXRvciA9IGZ1bmN0aW9uIGdldFByZXZJdGVyYXRvcihpdGVyYXRvcikge1xyXG4gICAgdGhpcy5fdmFsaWRhdGVJdGVyYXRvck9mVGhpcyhpdGVyYXRvcik7XHJcblxyXG4gICAgaXRlcmF0b3IuX2lzSXRlcmF0ZWQgPSBmYWxzZTtcclxuICAgIGlmIChpdGVyYXRvci5fcHJldiA9PT0gdGhpcy5fZmlyc3QpIHtcclxuICAgICAgICByZXR1cm4gbnVsbDtcclxuICAgIH1cclxuICAgIFxyXG4gICAgaXRlcmF0b3IuX3ByZXYuX2lzSXRlcmF0ZWQgPSB0cnVlO1xyXG4gICAgcmV0dXJuIGl0ZXJhdG9yLl9wcmV2O1xyXG59O1xyXG5cclxuTGlua2VkTGlzdC5wcm90b3R5cGUuZ2V0Q291bnQgPSBmdW5jdGlvbiBnZXRDb3VudCgpIHtcclxuICAgIHJldHVybiB0aGlzLl9jb3VudDtcclxufTtcclxuXHJcbkxpbmtlZExpc3QucHJvdG90eXBlLl92YWxpZGF0ZUl0ZXJhdG9yT2ZUaGlzID1cclxuICAgIGZ1bmN0aW9uIHZhbGlkYXRlSXRlcmF0b3JPZlRoaXMoaXRlcmF0b3IpIHtcclxuICAgIFxyXG4gICAgaWYgKGl0ZXJhdG9yLl9wYXJlbnQgIT09IHRoaXMpIHtcclxuICAgICAgICB0aHJvdyAnZGVwZW5kZW5jeS13b3JrZXJzIGVycm9yOiBpdGVyYXRvciBtdXN0IGJlIG9mIHRoZSBjdXJyZW50IExpbmtlZExpc3QnO1xyXG4gICAgfVxyXG59OyIsIid1c2Ugc3RyaWN0JztcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gSW1hZ2VEZWNvZGVyVmlld2VyO1xyXG5cclxudmFyIGltYWdlSGVscGVyRnVuY3Rpb25zID0gcmVxdWlyZSgnaW1hZ2UtaGVscGVyLWZ1bmN0aW9ucy5qcycpO1xyXG5cclxudmFyIFBFTkRJTkdfQ0FMTF9UWVBFX1BJWEVMU19VUERBVEVEID0gMTtcclxudmFyIFBFTkRJTkdfQ0FMTF9UWVBFX1JFUE9TSVRJT04gPSAyO1xyXG5cclxudmFyIFJFR0lPTl9PVkVSVklFVyA9IDA7XHJcbnZhciBSRUdJT05fRFlOQU1JQyA9IDE7XHJcblxyXG5mdW5jdGlvbiBJbWFnZURlY29kZXJWaWV3ZXIoaW1hZ2VEZWNvZGVyLCBjYW52YXNVcGRhdGVkQ2FsbGJhY2ssIG9wdGlvbnMpIHtcclxuICAgIHRoaXMuX2NhbnZhc1VwZGF0ZWRDYWxsYmFjayA9IGNhbnZhc1VwZGF0ZWRDYWxsYmFjaztcclxuICAgIFxyXG4gICAgdGhpcy5fYWRhcHRQcm9wb3J0aW9ucyA9IG9wdGlvbnMuYWRhcHRQcm9wb3J0aW9ucztcclxuICAgIHRoaXMuX2NhcnRvZ3JhcGhpY0JvdW5kcyA9IG9wdGlvbnMuY2FydG9ncmFwaGljQm91bmRzO1xyXG4gICAgdGhpcy5fYWxsb3dNdWx0aXBsZU1vdmFibGVGZXRjaGVzSW5TZXNzaW9uID1cclxuICAgICAgICBvcHRpb25zLmFsbG93TXVsdGlwbGVNb3ZhYmxlRmV0Y2hlc0luU2Vzc2lvbjtcclxuICAgIHRoaXMuX21pbkZ1bmN0aW9uQ2FsbEludGVydmFsTWlsbGlzZWNvbmRzID1cclxuICAgICAgICBvcHRpb25zLm1pbkZ1bmN0aW9uQ2FsbEludGVydmFsTWlsbGlzZWNvbmRzO1xyXG4gICAgdGhpcy5fb3ZlcnZpZXdSZXNvbHV0aW9uWCA9IG9wdGlvbnMub3ZlcnZpZXdSZXNvbHV0aW9uWCB8fCAxMDA7XHJcbiAgICB0aGlzLl9vdmVydmlld1Jlc29sdXRpb25ZID0gb3B0aW9ucy5vdmVydmlld1Jlc29sdXRpb25ZIHx8IDEwMDtcclxuICAgICAgICBcclxuICAgIHRoaXMuX2xhc3RSZXF1ZXN0SW5kZXggPSAwO1xyXG4gICAgdGhpcy5fcGVuZGluZ1VwZGF0ZVZpZXdBcmVhID0gbnVsbDtcclxuICAgIHRoaXMuX3JlZ2lvbnMgPSBbXTtcclxuICAgIHRoaXMuX3RhcmdldENhbnZhcyA9IG51bGw7XHJcbiAgICBcclxuICAgIHRoaXMuX2NhbGxQZW5kaW5nQ2FsbGJhY2tzQm91bmQgPSB0aGlzLl9jYWxsUGVuZGluZ0NhbGxiYWNrcy5iaW5kKHRoaXMpO1xyXG4gICAgdGhpcy5fY3JlYXRlZE1vdmFibGVGZXRjaEJvdW5kID0gdGhpcy5fY3JlYXRlZE1vdmFibGVGZXRjaC5iaW5kKHRoaXMpO1xyXG4gICAgXHJcbiAgICB0aGlzLl9wZW5kaW5nQ2FsbGJhY2tzSW50ZXJ2YWxIYW5kbGUgPSAwO1xyXG4gICAgdGhpcy5fcGVuZGluZ0NhbGxiYWNrQ2FsbHMgPSBbXTtcclxuICAgIHRoaXMuX2NhblNob3dEeW5hbWljUmVnaW9uID0gZmFsc2U7XHJcbiAgICBcclxuICAgIGlmICh0aGlzLl9jYXJ0b2dyYXBoaWNCb3VuZHMgPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIHRoaXMuX2NhcnRvZ3JhcGhpY0JvdW5kcyA9IHtcclxuICAgICAgICAgICAgd2VzdDogLTE3NS4wLFxyXG4gICAgICAgICAgICBlYXN0OiAxNzUuMCxcclxuICAgICAgICAgICAgc291dGg6IC04NS4wLFxyXG4gICAgICAgICAgICBub3J0aDogODUuMFxyXG4gICAgICAgIH07XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGlmICh0aGlzLl9hZGFwdFByb3BvcnRpb25zID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICB0aGlzLl9hZGFwdFByb3BvcnRpb25zID0gdHJ1ZTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgdGhpcy5faW1hZ2VEZWNvZGVyID0gaW1hZ2VEZWNvZGVyO1xyXG4gICAgaW1hZ2VEZWNvZGVyLnNldERlY29kZVByaW9yaXRpemVyVHlwZSgnZnJ1c3R1bU9ubHknKTtcclxuICAgIGltYWdlRGVjb2Rlci5zZXRGZXRjaFByaW9yaXRpemVyVHlwZSgnZnJ1c3R1bU9ubHknKTtcclxufVxyXG5cclxuSW1hZ2VEZWNvZGVyVmlld2VyLnByb3RvdHlwZS5zZXRFeGNlcHRpb25DYWxsYmFjayA9IGZ1bmN0aW9uIHNldEV4Y2VwdGlvbkNhbGxiYWNrKGV4Y2VwdGlvbkNhbGxiYWNrKSB7XHJcbiAgICAvLyBUT0RPOiBTdXBwb3J0IGV4Y2VwdGlvbkNhbGxiYWNrIGluIGV2ZXJ5IHBsYWNlIG5lZWRlZFxyXG4gICAgdGhpcy5fZXhjZXB0aW9uQ2FsbGJhY2sgPSBleGNlcHRpb25DYWxsYmFjaztcclxufTtcclxuICAgIFxyXG5JbWFnZURlY29kZXJWaWV3ZXIucHJvdG90eXBlLm9wZW4gPSBmdW5jdGlvbiBvcGVuKHVybCkge1xyXG4gICAgcmV0dXJuIHRoaXMuX2ltYWdlRGVjb2Rlci5vcGVuKHVybClcclxuICAgICAgICAudGhlbih0aGlzLl9vcGVuZWQuYmluZCh0aGlzKSlcclxuICAgICAgICAuY2F0Y2godGhpcy5fZXhjZXB0aW9uQ2FsbGJhY2spO1xyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVyVmlld2VyLnByb3RvdHlwZS5jbG9zZSA9IGZ1bmN0aW9uIGNsb3NlKCkge1xyXG4gICAgdmFyIHByb21pc2UgPSB0aGlzLl9pbWFnZURlY29kZXIuY2xvc2UoKTtcclxuICAgIHByb21pc2UuY2F0Y2godGhpcy5fZXhjZXB0aW9uQ2FsbGJhY2spO1xyXG4gICAgdGhpcy5faXNSZWFkeSA9IGZhbHNlO1xyXG4gICAgdGhpcy5fY2FuU2hvd0R5bmFtaWNSZWdpb24gPSBmYWxzZTtcclxuICAgIHRoaXMuX3RhcmdldENhbnZhcyA9IG51bGw7XHJcbiAgICByZXR1cm4gcHJvbWlzZTtcclxufTtcclxuXHJcbkltYWdlRGVjb2RlclZpZXdlci5wcm90b3R5cGUuc2V0VGFyZ2V0Q2FudmFzID0gZnVuY3Rpb24gc2V0VGFyZ2V0Q2FudmFzKGNhbnZhcykge1xyXG4gICAgdGhpcy5fdGFyZ2V0Q2FudmFzID0gY2FudmFzO1xyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVyVmlld2VyLnByb3RvdHlwZS51cGRhdGVWaWV3QXJlYSA9IGZ1bmN0aW9uIHVwZGF0ZVZpZXdBcmVhKGZydXN0dW1EYXRhKSB7XHJcbiAgICBpZiAodGhpcy5fdGFyZ2V0Q2FudmFzID09PSBudWxsKSB7XHJcbiAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogQ2Fubm90IHVwZGF0ZSBkeW5hbWljIHJlZ2lvbiBiZWZvcmUgc2V0VGFyZ2V0Q2FudmFzKCknO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBpZiAoIXRoaXMuX2NhblNob3dEeW5hbWljUmVnaW9uKSB7XHJcbiAgICAgICAgdGhpcy5fcGVuZGluZ1VwZGF0ZVZpZXdBcmVhID0gZnJ1c3R1bURhdGE7XHJcbiAgICAgICAgXHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICB2YXIgYm91bmRzID0gZnJ1c3R1bURhdGEucmVjdGFuZ2xlO1xyXG4gICAgdmFyIHNjcmVlblNpemUgPSBmcnVzdHVtRGF0YS5zY3JlZW5TaXplO1xyXG4gICAgXHJcbiAgICB2YXIgcmVnaW9uUGFyYW1zID0ge1xyXG4gICAgICAgIG1pblg6IGJvdW5kcy53ZXN0ICogdGhpcy5fc2NhbGVYICsgdGhpcy5fdHJhbnNsYXRlWCxcclxuICAgICAgICBtaW5ZOiBib3VuZHMubm9ydGggKiB0aGlzLl9zY2FsZVkgKyB0aGlzLl90cmFuc2xhdGVZLFxyXG4gICAgICAgIG1heFhFeGNsdXNpdmU6IGJvdW5kcy5lYXN0ICogdGhpcy5fc2NhbGVYICsgdGhpcy5fdHJhbnNsYXRlWCxcclxuICAgICAgICBtYXhZRXhjbHVzaXZlOiBib3VuZHMuc291dGggKiB0aGlzLl9zY2FsZVkgKyB0aGlzLl90cmFuc2xhdGVZLFxyXG4gICAgICAgIHNjcmVlbldpZHRoOiBzY3JlZW5TaXplLngsXHJcbiAgICAgICAgc2NyZWVuSGVpZ2h0OiBzY3JlZW5TaXplLnlcclxuICAgIH07XHJcbiAgICBcclxuICAgIHZhciBhbGlnbmVkUGFyYW1zID1cclxuICAgICAgICBpbWFnZUhlbHBlckZ1bmN0aW9ucy5hbGlnblBhcmFtc1RvVGlsZXNBbmRMZXZlbChcclxuICAgICAgICAgICAgcmVnaW9uUGFyYW1zLCB0aGlzLl9pbWFnZURlY29kZXIpO1xyXG4gICAgXHJcbiAgICB2YXIgaXNPdXRzaWRlU2NyZWVuID0gYWxpZ25lZFBhcmFtcyA9PT0gbnVsbDtcclxuICAgIGlmIChpc091dHNpZGVTY3JlZW4pIHtcclxuICAgICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGFsaWduZWRQYXJhbXMuaW1hZ2VQYXJ0UGFyYW1zLnF1YWxpdHkgPSB0aGlzLl9xdWFsaXR5O1xyXG5cclxuICAgIHZhciBpc1NhbWVSZWdpb24gPVxyXG4gICAgICAgIHRoaXMuX2R5bmFtaWNGZXRjaFBhcmFtcyAhPT0gdW5kZWZpbmVkICYmXHJcbiAgICAgICAgdGhpcy5faXNJbWFnZVBhcnRzRXF1YWwoXHJcbiAgICAgICAgICAgIGFsaWduZWRQYXJhbXMuaW1hZ2VQYXJ0UGFyYW1zLFxyXG4gICAgICAgICAgICB0aGlzLl9keW5hbWljRmV0Y2hQYXJhbXMuaW1hZ2VQYXJ0UGFyYW1zKTtcclxuICAgIFxyXG4gICAgaWYgKGlzU2FtZVJlZ2lvbikge1xyXG4gICAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIFxyXG4gICAgZnJ1c3R1bURhdGEuaW1hZ2VSZWN0YW5nbGUgPSB0aGlzLl9jYXJ0b2dyYXBoaWNCb3VuZHNGaXhlZDtcclxuICAgIGZydXN0dW1EYXRhLmV4YWN0bGV2ZWwgPVxyXG4gICAgICAgIGFsaWduZWRQYXJhbXMuaW1hZ2VQYXJ0UGFyYW1zLmxldmVsO1xyXG4gICAgXHJcbiAgICB0aGlzLl9pbWFnZURlY29kZXIuc2V0RGVjb2RlUHJpb3JpdGl6ZXJEYXRhKGZydXN0dW1EYXRhKTtcclxuICAgIHRoaXMuX2ltYWdlRGVjb2Rlci5zZXRGZXRjaFByaW9yaXRpemVyRGF0YShmcnVzdHVtRGF0YSk7XHJcblxyXG4gICAgdGhpcy5fZHluYW1pY0ZldGNoUGFyYW1zID0gYWxpZ25lZFBhcmFtcztcclxuICAgIFxyXG4gICAgdmFyIHN0YXJ0RHluYW1pY1JlZ2lvbk9uVGVybWluYXRpb24gPSBmYWxzZTtcclxuICAgIHZhciBtb3ZlRXhpc3RpbmdGZXRjaCA9ICF0aGlzLl9hbGxvd011bHRpcGxlTW92YWJsZUZldGNoZXNJblNlc3Npb247XHJcbiAgICB0aGlzLl9mZXRjaChcclxuICAgICAgICBSRUdJT05fRFlOQU1JQyxcclxuICAgICAgICBhbGlnbmVkUGFyYW1zLFxyXG4gICAgICAgIHN0YXJ0RHluYW1pY1JlZ2lvbk9uVGVybWluYXRpb24sXHJcbiAgICAgICAgbW92ZUV4aXN0aW5nRmV0Y2gpO1xyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVyVmlld2VyLnByb3RvdHlwZS5nZXRCb3VuZHMgPSBmdW5jdGlvbiBnZXRDYXJ0b2dyYXBoaWNCb3VuZHMoKSB7XHJcbiAgICBpZiAoIXRoaXMuX2lzUmVhZHkpIHtcclxuICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBJbWFnZURlY29kZXJWaWV3ZXIgZXJyb3I6IEltYWdlIGlzIG5vdCByZWFkeSB5ZXQnO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIHRoaXMuX2NhcnRvZ3JhcGhpY0JvdW5kc0ZpeGVkO1xyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVyVmlld2VyLnByb3RvdHlwZS5faXNJbWFnZVBhcnRzRXF1YWwgPSBmdW5jdGlvbiBpc0ltYWdlUGFydHNFcXVhbChmaXJzdCwgc2Vjb25kKSB7XHJcbiAgICB2YXIgaXNFcXVhbCA9XHJcbiAgICAgICAgdGhpcy5fZHluYW1pY0ZldGNoUGFyYW1zICE9PSB1bmRlZmluZWQgJiZcclxuICAgICAgICBmaXJzdC5taW5YID09PSBzZWNvbmQubWluWCAmJlxyXG4gICAgICAgIGZpcnN0Lm1pblkgPT09IHNlY29uZC5taW5ZICYmXHJcbiAgICAgICAgZmlyc3QubWF4WEV4Y2x1c2l2ZSA9PT0gc2Vjb25kLm1heFhFeGNsdXNpdmUgJiZcclxuICAgICAgICBmaXJzdC5tYXhZRXhjbHVzaXZlID09PSBzZWNvbmQubWF4WUV4Y2x1c2l2ZSAmJlxyXG4gICAgICAgIGZpcnN0LmxldmVsID09PSBzZWNvbmQubGV2ZWw7XHJcbiAgICBcclxuICAgIHJldHVybiBpc0VxdWFsO1xyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVyVmlld2VyLnByb3RvdHlwZS5fZmV0Y2ggPSBmdW5jdGlvbiBmZXRjaChcclxuICAgIHJlZ2lvbklkLFxyXG4gICAgZmV0Y2hQYXJhbXMsXHJcbiAgICBzdGFydER5bmFtaWNSZWdpb25PblRlcm1pbmF0aW9uLFxyXG4gICAgbW92ZUV4aXN0aW5nRmV0Y2gpIHtcclxuICAgIFxyXG4gICAgdmFyIHJlcXVlc3RJbmRleCA9ICsrdGhpcy5fbGFzdFJlcXVlc3RJbmRleDtcclxuICAgIFxyXG4gICAgdmFyIGltYWdlUGFydFBhcmFtcyA9IGZldGNoUGFyYW1zLmltYWdlUGFydFBhcmFtcztcclxuICAgIGltYWdlUGFydFBhcmFtcy5yZXF1ZXN0UHJpb3JpdHlEYXRhID1cclxuICAgICAgICBpbWFnZVBhcnRQYXJhbXMucmVxdWVzdFByaW9yaXR5RGF0YSB8fCB7fTtcclxuICAgIFxyXG4gICAgaW1hZ2VQYXJ0UGFyYW1zLnJlcXVlc3RQcmlvcml0eURhdGEucmVxdWVzdEluZGV4ID0gcmVxdWVzdEluZGV4O1xyXG5cclxuICAgIHZhciBtaW5YID0gZmV0Y2hQYXJhbXMucG9zaXRpb25JbkltYWdlLm1pblg7XHJcbiAgICB2YXIgbWluWSA9IGZldGNoUGFyYW1zLnBvc2l0aW9uSW5JbWFnZS5taW5ZO1xyXG4gICAgdmFyIG1heFggPSBmZXRjaFBhcmFtcy5wb3NpdGlvbkluSW1hZ2UubWF4WEV4Y2x1c2l2ZTtcclxuICAgIHZhciBtYXhZID0gZmV0Y2hQYXJhbXMucG9zaXRpb25JbkltYWdlLm1heFlFeGNsdXNpdmU7XHJcbiAgICBcclxuICAgIHZhciB3ZXN0ID0gKG1pblggLSB0aGlzLl90cmFuc2xhdGVYKSAvIHRoaXMuX3NjYWxlWDtcclxuICAgIHZhciBlYXN0ID0gKG1heFggLSB0aGlzLl90cmFuc2xhdGVYKSAvIHRoaXMuX3NjYWxlWDtcclxuICAgIHZhciBub3J0aCA9IChtaW5ZIC0gdGhpcy5fdHJhbnNsYXRlWSkgLyB0aGlzLl9zY2FsZVk7XHJcbiAgICB2YXIgc291dGggPSAobWF4WSAtIHRoaXMuX3RyYW5zbGF0ZVkpIC8gdGhpcy5fc2NhbGVZO1xyXG4gICAgXHJcbiAgICB2YXIgcG9zaXRpb24gPSB7XHJcbiAgICAgICAgd2VzdDogd2VzdCxcclxuICAgICAgICBlYXN0OiBlYXN0LFxyXG4gICAgICAgIG5vcnRoOiBub3J0aCxcclxuICAgICAgICBzb3V0aDogc291dGhcclxuICAgIH07XHJcbiAgICBcclxuICAgIHZhciBjYW5SZXVzZU9sZERhdGEgPSBmYWxzZTtcclxuICAgIHZhciBmZXRjaFBhcmFtc05vdE5lZWRlZDtcclxuICAgIFxyXG4gICAgdmFyIHJlZ2lvbiA9IHRoaXMuX3JlZ2lvbnNbcmVnaW9uSWRdO1xyXG4gICAgaWYgKHJlZ2lvbiAhPT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgdmFyIG5ld1Jlc29sdXRpb24gPSBpbWFnZVBhcnRQYXJhbXMubGV2ZWw7XHJcbiAgICAgICAgdmFyIG9sZFJlc29sdXRpb24gPSByZWdpb24uaW1hZ2VQYXJ0UGFyYW1zLmxldmVsO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGNhblJldXNlT2xkRGF0YSA9IG5ld1Jlc29sdXRpb24gPT09IG9sZFJlc29sdXRpb247XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKGNhblJldXNlT2xkRGF0YSAmJiByZWdpb24uZG9uZVBhcnRQYXJhbXMpIHtcclxuICAgICAgICAgICAgZmV0Y2hQYXJhbXNOb3ROZWVkZWQgPSBbIHJlZ2lvbi5kb25lUGFydFBhcmFtcyBdO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgaWYgKHJlZ2lvbklkICE9PSBSRUdJT05fT1ZFUlZJRVcpIHtcclxuICAgICAgICAgICAgdmFyIGFkZGVkUGVuZGluZ0NhbGwgPSB0aGlzLl9jaGVja0lmUmVwb3NpdGlvbk5lZWRlZChcclxuICAgICAgICAgICAgICAgIHJlZ2lvbiwgaW1hZ2VQYXJ0UGFyYW1zLCBwb3NpdGlvbik7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBpZiAoYWRkZWRQZW5kaW5nQ2FsbCkge1xyXG4gICAgICAgICAgICAgICAgdGhpcy5fbm90aWZ5TmV3UGVuZGluZ0NhbGxzKCk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHZhciBzZWxmID0gdGhpcztcclxuICAgIFxyXG4gICAgdmFyIG1vdmFibGVIYW5kbGUgPSBtb3ZlRXhpc3RpbmdGZXRjaCA/IHRoaXMuX21vdmFibGVIYW5kbGU6IHVuZGVmaW5lZDtcclxuXHJcbiAgICB0aGlzLl9pbWFnZURlY29kZXIucmVxdWVzdFBpeGVsc1Byb2dyZXNzaXZlKFxyXG4gICAgICAgIGZldGNoUGFyYW1zLmltYWdlUGFydFBhcmFtcyxcclxuICAgICAgICBjYWxsYmFjayxcclxuICAgICAgICB0ZXJtaW5hdGVkQ2FsbGJhY2ssXHJcbiAgICAgICAgZmV0Y2hQYXJhbXNOb3ROZWVkZWQsXHJcbiAgICAgICAgbW92YWJsZUhhbmRsZSk7XHJcbiAgICBcclxuICAgIGZ1bmN0aW9uIGNhbGxiYWNrKGRlY29kZWQpIHtcclxuICAgICAgICBzZWxmLl90aWxlc0RlY29kZWRDYWxsYmFjayhcclxuICAgICAgICAgICAgcmVnaW9uSWQsXHJcbiAgICAgICAgICAgIGZldGNoUGFyYW1zLFxyXG4gICAgICAgICAgICBwb3NpdGlvbixcclxuICAgICAgICAgICAgZGVjb2RlZCk7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGZ1bmN0aW9uIHRlcm1pbmF0ZWRDYWxsYmFjayhpc0Fib3J0ZWQpIHtcclxuICAgICAgICBpZiAoaXNBYm9ydGVkICYmXHJcbiAgICAgICAgICAgIGltYWdlUGFydFBhcmFtcy5yZXF1ZXN0UHJpb3JpdHlEYXRhLm92ZXJyaWRlSGlnaGVzdFByaW9yaXR5KSB7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBOT1RFOiBCdWcgaW4ga2R1X3NlcnZlciBjYXVzZXMgZmlyc3QgcmVxdWVzdCB0byBiZSBzZW50IHdyb25nbHkuXHJcbiAgICAgICAgICAgIC8vIFRoZW4gQ2hyb21lIHJhaXNlcyBFUlJfSU5WQUxJRF9DSFVOS0VEX0VOQ09ESU5HIGFuZCB0aGUgcmVxdWVzdFxyXG4gICAgICAgICAgICAvLyBuZXZlciByZXR1cm5zLiBUaHVzIHBlcmZvcm0gc2Vjb25kIHJlcXVlc3QuXHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBzZWxmLl9pbWFnZURlY29kZXIucmVxdWVzdFBpeGVsc1Byb2dyZXNzaXZlKFxyXG4gICAgICAgICAgICAgICAgZmV0Y2hQYXJhbXMuaW1hZ2VQYXJ0UGFyYW1zLFxyXG4gICAgICAgICAgICAgICAgY2FsbGJhY2ssXHJcbiAgICAgICAgICAgICAgICB0ZXJtaW5hdGVkQ2FsbGJhY2ssXHJcbiAgICAgICAgICAgICAgICBmZXRjaFBhcmFtc05vdE5lZWRlZCk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHNlbGYuX2ZldGNoVGVybWluYXRlZENhbGxiYWNrKFxyXG4gICAgICAgICAgICByZWdpb25JZCxcclxuICAgICAgICAgICAgZmV0Y2hQYXJhbXMuaW1hZ2VQYXJ0UGFyYW1zLnJlcXVlc3RQcmlvcml0eURhdGEsXHJcbiAgICAgICAgICAgIGlzQWJvcnRlZCxcclxuICAgICAgICAgICAgc3RhcnREeW5hbWljUmVnaW9uT25UZXJtaW5hdGlvbik7XHJcbiAgICB9XHJcbn07XHJcblxyXG5JbWFnZURlY29kZXJWaWV3ZXIucHJvdG90eXBlLl9mZXRjaFRlcm1pbmF0ZWRDYWxsYmFjayA9IGZ1bmN0aW9uIGZldGNoVGVybWluYXRlZENhbGxiYWNrKFxyXG4gICAgcmVnaW9uSWQsIHByaW9yaXR5RGF0YSwgaXNBYm9ydGVkLCBzdGFydER5bmFtaWNSZWdpb25PblRlcm1pbmF0aW9uKSB7XHJcbiAgICBcclxuICAgIHZhciByZWdpb24gPSB0aGlzLl9yZWdpb25zW3JlZ2lvbklkXTtcclxuICAgIGlmIChyZWdpb24gPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIFxyXG4gICAgaWYgKCFwcmlvcml0eURhdGEub3ZlcnJpZGVIaWdoZXN0UHJpb3JpdHkgJiZcclxuICAgICAgICBwcmlvcml0eURhdGEucmVxdWVzdEluZGV4ICE9PSB0aGlzLl9sYXN0UmVxdWVzdEluZGV4KSB7XHJcbiAgICBcclxuICAgICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHJlZ2lvbi5pc0RvbmUgPSAhaXNBYm9ydGVkICYmIHRoaXMuX2lzUmVhZHk7XHJcbiAgICBpZiAocmVnaW9uLmlzRG9uZSkge1xyXG4gICAgICAgIHJlZ2lvbi5kb25lUGFydFBhcmFtcyA9IHJlZ2lvbi5pbWFnZVBhcnRQYXJhbXM7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGlmIChzdGFydER5bmFtaWNSZWdpb25PblRlcm1pbmF0aW9uKSB7XHJcbiAgICAgICAgdGhpcy5faW1hZ2VEZWNvZGVyLmNyZWF0ZU1vdmFibGVGZXRjaCgpLnRoZW4odGhpcy5fY3JlYXRlZE1vdmFibGVGZXRjaEJvdW5kKTtcclxuICAgIH1cclxufTtcclxuXHJcbkltYWdlRGVjb2RlclZpZXdlci5wcm90b3R5cGUuX2NyZWF0ZWRNb3ZhYmxlRmV0Y2ggPSBmdW5jdGlvbiBjcmVhdGVkTW92YWJsZUZldGNoKG1vdmFibGVIYW5kbGUpIHtcclxuICAgIHRoaXMuX21vdmFibGVIYW5kbGUgPSBtb3ZhYmxlSGFuZGxlO1xyXG4gICAgdGhpcy5fc3RhcnRTaG93aW5nRHluYW1pY1JlZ2lvbigpO1xyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVyVmlld2VyLnByb3RvdHlwZS5fc3RhcnRTaG93aW5nRHluYW1pY1JlZ2lvbiA9IGZ1bmN0aW9uIHN0YXJ0U2hvd2luZ0R5bmFtaWNSZWdpb24oKSB7XHJcbiAgICB0aGlzLl9jYW5TaG93RHluYW1pY1JlZ2lvbiA9IHRydWU7XHJcbiAgICBcclxuICAgIGlmICh0aGlzLl9wZW5kaW5nVXBkYXRlVmlld0FyZWEgIT09IG51bGwpIHtcclxuICAgICAgICB0aGlzLnVwZGF0ZVZpZXdBcmVhKHRoaXMuX3BlbmRpbmdVcGRhdGVWaWV3QXJlYSk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgdGhpcy5fcGVuZGluZ1VwZGF0ZVZpZXdBcmVhID0gbnVsbDtcclxuICAgIH1cclxufTtcclxuXHJcbkltYWdlRGVjb2RlclZpZXdlci5wcm90b3R5cGUuX3RpbGVzRGVjb2RlZENhbGxiYWNrID0gZnVuY3Rpb24gdGlsZXNEZWNvZGVkQ2FsbGJhY2soXHJcbiAgICByZWdpb25JZCwgZmV0Y2hQYXJhbXMsIHBvc2l0aW9uLCBkZWNvZGVkKSB7XHJcbiAgICBcclxuICAgIGlmICghdGhpcy5faXNSZWFkeSkge1xyXG4gICAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIFxyXG4gICAgdmFyIHJlZ2lvbiA9IHRoaXMuX3JlZ2lvbnNbcmVnaW9uSWRdO1xyXG4gICAgaWYgKHJlZ2lvbiA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgcmVnaW9uID0ge307XHJcbiAgICAgICAgdGhpcy5fcmVnaW9uc1tyZWdpb25JZF0gPSByZWdpb247XHJcbiAgICAgICAgXHJcbiAgICAgICAgc3dpdGNoIChyZWdpb25JZCkge1xyXG4gICAgICAgICAgICBjYXNlIFJFR0lPTl9EWU5BTUlDOlxyXG4gICAgICAgICAgICAgICAgcmVnaW9uLmNhbnZhcyA9IHRoaXMuX3RhcmdldENhbnZhcztcclxuICAgICAgICAgICAgICAgIGJyZWFrO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGNhc2UgUkVHSU9OX09WRVJWSUVXOlxyXG4gICAgICAgICAgICAgICAgcmVnaW9uLmNhbnZhcyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2NhbnZhcycpO1xyXG4gICAgICAgICAgICAgICAgYnJlYWs7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBkZWZhdWx0OlxyXG4gICAgICAgICAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogVW5leHBlY3RlZCByZWdpb25JZCAnICsgcmVnaW9uSWQ7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgXHJcbiAgICB2YXIgcGFydFBhcmFtcyA9IGZldGNoUGFyYW1zLmltYWdlUGFydFBhcmFtcztcclxuICAgIGlmICghcGFydFBhcmFtcy5yZXF1ZXN0UHJpb3JpdHlEYXRhLm92ZXJyaWRlSGlnaGVzdFByaW9yaXR5ICYmXHJcbiAgICAgICAgcGFydFBhcmFtcy5yZXF1ZXN0UHJpb3JpdHlEYXRhLnJlcXVlc3RJbmRleCA8IHJlZ2lvbi5jdXJyZW50RGlzcGxheVJlcXVlc3RJbmRleCkge1xyXG4gICAgICAgIFxyXG4gICAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIFxyXG4gICAgdGhpcy5fY2hlY2tJZlJlcG9zaXRpb25OZWVkZWQocmVnaW9uLCBwYXJ0UGFyYW1zLCBwb3NpdGlvbik7XHJcbiAgICAgICAgXHJcbiAgICB0aGlzLl9wZW5kaW5nQ2FsbGJhY2tDYWxscy5wdXNoKHtcclxuICAgICAgICB0eXBlOiBQRU5ESU5HX0NBTExfVFlQRV9QSVhFTFNfVVBEQVRFRCxcclxuICAgICAgICByZWdpb246IHJlZ2lvbixcclxuICAgICAgICBkZWNvZGVkOiBkZWNvZGVkXHJcbiAgICB9KTtcclxuICAgIFxyXG4gICAgdGhpcy5fbm90aWZ5TmV3UGVuZGluZ0NhbGxzKCk7XHJcbn07XHJcblxyXG5JbWFnZURlY29kZXJWaWV3ZXIucHJvdG90eXBlLl9jaGVja0lmUmVwb3NpdGlvbk5lZWRlZCA9IGZ1bmN0aW9uIGNoZWNrSWZSZXBvc2l0aW9uTmVlZGVkKFxyXG4gICAgcmVnaW9uLCBuZXdQYXJ0UGFyYW1zLCBuZXdQb3NpdGlvbikge1xyXG4gICAgXHJcbiAgICB2YXIgb2xkUGFydFBhcmFtcyA9IHJlZ2lvbi5pbWFnZVBhcnRQYXJhbXM7XHJcbiAgICB2YXIgb2xkRG9uZVBhcnRQYXJhbXMgPSByZWdpb24uZG9uZVBhcnRQYXJhbXM7XHJcbiAgICB2YXIgbGV2ZWwgPSBuZXdQYXJ0UGFyYW1zLmxldmVsO1xyXG4gICAgXHJcbiAgICB2YXIgbmVlZFJlcG9zaXRpb24gPVxyXG4gICAgICAgIG9sZFBhcnRQYXJhbXMgPT09IHVuZGVmaW5lZCB8fFxyXG4gICAgICAgIG9sZFBhcnRQYXJhbXMubWluWCAhPT0gbmV3UGFydFBhcmFtcy5taW5YIHx8XHJcbiAgICAgICAgb2xkUGFydFBhcmFtcy5taW5ZICE9PSBuZXdQYXJ0UGFyYW1zLm1pblkgfHxcclxuICAgICAgICBvbGRQYXJ0UGFyYW1zLm1heFhFeGNsdXNpdmUgIT09IG5ld1BhcnRQYXJhbXMubWF4WEV4Y2x1c2l2ZSB8fFxyXG4gICAgICAgIG9sZFBhcnRQYXJhbXMubWF4WUV4Y2x1c2l2ZSAhPT0gbmV3UGFydFBhcmFtcy5tYXhZRXhjbHVzaXZlIHx8XHJcbiAgICAgICAgb2xkUGFydFBhcmFtcy5sZXZlbCAhPT0gbGV2ZWw7XHJcbiAgICBcclxuICAgIGlmICghbmVlZFJlcG9zaXRpb24pIHtcclxuICAgICAgICByZXR1cm4gZmFsc2U7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHZhciBjb3B5RGF0YTtcclxuICAgIHZhciBpbnRlcnNlY3Rpb247XHJcbiAgICB2YXIgbmV3RG9uZVBhcnRQYXJhbXM7XHJcbiAgICB2YXIgcmV1c2VPbGREYXRhID0gZmFsc2U7XHJcbiAgICB2YXIgc2NhbGVYO1xyXG4gICAgdmFyIHNjYWxlWTtcclxuICAgIGlmIChvbGRQYXJ0UGFyYW1zICE9PSB1bmRlZmluZWQpIHtcclxuICAgICAgICBzY2FsZVggPSBuZXdQYXJ0UGFyYW1zLmxldmVsV2lkdGggIC8gb2xkUGFydFBhcmFtcy5sZXZlbFdpZHRoO1xyXG4gICAgICAgIHNjYWxlWSA9IG5ld1BhcnRQYXJhbXMubGV2ZWxIZWlnaHQgLyBvbGRQYXJ0UGFyYW1zLmxldmVsSGVpZ2h0O1xyXG4gICAgICAgIFxyXG4gICAgICAgIGludGVyc2VjdGlvbiA9IHtcclxuICAgICAgICAgICAgbWluWDogTWF0aC5tYXgob2xkUGFydFBhcmFtcy5taW5YICogc2NhbGVYLCBuZXdQYXJ0UGFyYW1zLm1pblgpLFxyXG4gICAgICAgICAgICBtaW5ZOiBNYXRoLm1heChvbGRQYXJ0UGFyYW1zLm1pblkgKiBzY2FsZVksIG5ld1BhcnRQYXJhbXMubWluWSksXHJcbiAgICAgICAgICAgIG1heFg6IE1hdGgubWluKG9sZFBhcnRQYXJhbXMubWF4WEV4Y2x1c2l2ZSAqIHNjYWxlWCwgbmV3UGFydFBhcmFtcy5tYXhYRXhjbHVzaXZlKSxcclxuICAgICAgICAgICAgbWF4WTogTWF0aC5taW4ob2xkUGFydFBhcmFtcy5tYXhZRXhjbHVzaXZlICogc2NhbGVZLCBuZXdQYXJ0UGFyYW1zLm1heFlFeGNsdXNpdmUpXHJcbiAgICAgICAgfTtcclxuICAgICAgICByZXVzZU9sZERhdGEgPVxyXG4gICAgICAgICAgICBpbnRlcnNlY3Rpb24ubWF4WCA+IGludGVyc2VjdGlvbi5taW5YICYmXHJcbiAgICAgICAgICAgIGludGVyc2VjdGlvbi5tYXhZID4gaW50ZXJzZWN0aW9uLm1pblk7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGlmIChyZXVzZU9sZERhdGEpIHtcclxuICAgICAgICBjb3B5RGF0YSA9IHtcclxuICAgICAgICAgICAgZnJvbVg6IGludGVyc2VjdGlvbi5taW5YIC8gc2NhbGVYIC0gb2xkUGFydFBhcmFtcy5taW5YLFxyXG4gICAgICAgICAgICBmcm9tWTogaW50ZXJzZWN0aW9uLm1pblkgLyBzY2FsZVkgLSBvbGRQYXJ0UGFyYW1zLm1pblksXHJcbiAgICAgICAgICAgIGZyb21XaWR0aCA6IChpbnRlcnNlY3Rpb24ubWF4WCAtIGludGVyc2VjdGlvbi5taW5YKSAvIHNjYWxlWCxcclxuICAgICAgICAgICAgZnJvbUhlaWdodDogKGludGVyc2VjdGlvbi5tYXhZIC0gaW50ZXJzZWN0aW9uLm1pblkpIC8gc2NhbGVZLFxyXG4gICAgICAgICAgICB0b1g6IGludGVyc2VjdGlvbi5taW5YIC0gbmV3UGFydFBhcmFtcy5taW5YLFxyXG4gICAgICAgICAgICB0b1k6IGludGVyc2VjdGlvbi5taW5ZIC0gbmV3UGFydFBhcmFtcy5taW5ZLFxyXG4gICAgICAgICAgICB0b1dpZHRoIDogaW50ZXJzZWN0aW9uLm1heFggLSBpbnRlcnNlY3Rpb24ubWluWCxcclxuICAgICAgICAgICAgdG9IZWlnaHQ6IGludGVyc2VjdGlvbi5tYXhZIC0gaW50ZXJzZWN0aW9uLm1pblksXHJcbiAgICAgICAgfTtcclxuICAgIFxyXG4gICAgICAgIGlmIChvbGREb25lUGFydFBhcmFtcyAmJiBvbGRQYXJ0UGFyYW1zLmxldmVsID09PSBsZXZlbCkge1xyXG4gICAgICAgICAgICBuZXdEb25lUGFydFBhcmFtcyA9IHtcclxuICAgICAgICAgICAgICAgIG1pblg6IE1hdGgubWF4KG9sZERvbmVQYXJ0UGFyYW1zLm1pblgsIG5ld1BhcnRQYXJhbXMubWluWCksXHJcbiAgICAgICAgICAgICAgICBtaW5ZOiBNYXRoLm1heChvbGREb25lUGFydFBhcmFtcy5taW5ZLCBuZXdQYXJ0UGFyYW1zLm1pblkpLFxyXG4gICAgICAgICAgICAgICAgbWF4WEV4Y2x1c2l2ZTogTWF0aC5taW4ob2xkRG9uZVBhcnRQYXJhbXMubWF4WEV4Y2x1c2l2ZSwgbmV3UGFydFBhcmFtcy5tYXhYRXhjbHVzaXZlKSxcclxuICAgICAgICAgICAgICAgIG1heFlFeGNsdXNpdmU6IE1hdGgubWluKG9sZERvbmVQYXJ0UGFyYW1zLm1heFlFeGNsdXNpdmUsIG5ld1BhcnRQYXJhbXMubWF4WUV4Y2x1c2l2ZSlcclxuICAgICAgICAgICAgfTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHJlZ2lvbi5pbWFnZVBhcnRQYXJhbXMgPSBuZXdQYXJ0UGFyYW1zO1xyXG4gICAgcmVnaW9uLmlzRG9uZSA9IGZhbHNlO1xyXG4gICAgcmVnaW9uLmN1cnJlbnREaXNwbGF5UmVxdWVzdEluZGV4ID0gbmV3UGFydFBhcmFtcy5yZXF1ZXN0UHJpb3JpdHlEYXRhLnJlcXVlc3RJbmRleDtcclxuICAgIFxyXG4gICAgdmFyIHJlcG9zaXRpb25BcmdzID0ge1xyXG4gICAgICAgIHR5cGU6IFBFTkRJTkdfQ0FMTF9UWVBFX1JFUE9TSVRJT04sXHJcbiAgICAgICAgcmVnaW9uOiByZWdpb24sXHJcbiAgICAgICAgcG9zaXRpb246IG5ld1Bvc2l0aW9uLFxyXG4gICAgICAgIGRvbmVQYXJ0UGFyYW1zOiBuZXdEb25lUGFydFBhcmFtcyxcclxuICAgICAgICBjb3B5RGF0YTogY29weURhdGEsXHJcbiAgICAgICAgcGl4ZWxzV2lkdGg6IG5ld1BhcnRQYXJhbXMubWF4WEV4Y2x1c2l2ZSAtIG5ld1BhcnRQYXJhbXMubWluWCxcclxuICAgICAgICBwaXhlbHNIZWlnaHQ6IG5ld1BhcnRQYXJhbXMubWF4WUV4Y2x1c2l2ZSAtIG5ld1BhcnRQYXJhbXMubWluWVxyXG4gICAgfTtcclxuICAgIFxyXG4gICAgdGhpcy5fcGVuZGluZ0NhbGxiYWNrQ2FsbHMucHVzaChyZXBvc2l0aW9uQXJncyk7XHJcbiAgICBcclxuICAgIHJldHVybiB0cnVlO1xyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVyVmlld2VyLnByb3RvdHlwZS5fbm90aWZ5TmV3UGVuZGluZ0NhbGxzID0gZnVuY3Rpb24gbm90aWZ5TmV3UGVuZGluZ0NhbGxzKCkge1xyXG4gICAgaWYgKCF0aGlzLl9pc05lYXJDYWxsYmFja0NhbGxlZCkge1xyXG4gICAgICAgIHRoaXMuX2NhbGxQZW5kaW5nQ2FsbGJhY2tzKCk7XHJcbiAgICB9XHJcbn07XHJcblxyXG5JbWFnZURlY29kZXJWaWV3ZXIucHJvdG90eXBlLl9jYWxsUGVuZGluZ0NhbGxiYWNrcyA9IGZ1bmN0aW9uIGNhbGxQZW5kaW5nQ2FsbGJhY2tzKCkge1xyXG4gICAgaWYgKHRoaXMuX3BlbmRpbmdDYWxsYmFja0NhbGxzLmxlbmd0aCA9PT0gMCB8fCAhdGhpcy5faXNSZWFkeSkge1xyXG4gICAgICAgIHRoaXMuX2lzTmVhckNhbGxiYWNrQ2FsbGVkID0gZmFsc2U7XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBpZiAodGhpcy5faXNOZWFyQ2FsbGJhY2tDYWxsZWQpIHtcclxuICAgICAgICBjbGVhclRpbWVvdXQodGhpcy5fcGVuZGluZ0NhbGxiYWNrc0ludGVydmFsSGFuZGxlKTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgaWYgKHRoaXMuX21pbkZ1bmN0aW9uQ2FsbEludGVydmFsTWlsbGlzZWNvbmRzICE9PSB1bmRlZmluZWQpIHtcclxuICAgICAgICB0aGlzLl9wZW5kaW5nQ2FsbGJhY2tzSW50ZXJ2YWxIYW5kbGUgPVxyXG4gICAgICAgICAgICBzZXRUaW1lb3V0KHRoaXMuX2NhbGxQZW5kaW5nQ2FsbGJhY2tzQm91bmQsXHJcbiAgICAgICAgICAgIHRoaXMuX21pbkZ1bmN0aW9uQ2FsbEludGVydmFsTWlsbGlzZWNvbmRzKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgdGhpcy5faXNOZWFyQ2FsbGJhY2tDYWxsZWQgPSB0cnVlO1xyXG4gICAgfVxyXG5cclxuICAgIHZhciBuZXdQb3NpdGlvbiA9IG51bGw7XHJcbiAgICBcclxuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgdGhpcy5fcGVuZGluZ0NhbGxiYWNrQ2FsbHMubGVuZ3RoOyArK2kpIHtcclxuICAgICAgICB2YXIgY2FsbEFyZ3MgPSB0aGlzLl9wZW5kaW5nQ2FsbGJhY2tDYWxsc1tpXTtcclxuICAgICAgICBcclxuICAgICAgICBpZiAoY2FsbEFyZ3MudHlwZSA9PT0gUEVORElOR19DQUxMX1RZUEVfUkVQT1NJVElPTikge1xyXG4gICAgICAgICAgICB0aGlzLl9yZXBvc2l0aW9uQ2FudmFzKGNhbGxBcmdzKTtcclxuICAgICAgICAgICAgbmV3UG9zaXRpb24gPSBjYWxsQXJncy5wb3NpdGlvbjtcclxuICAgICAgICB9IGVsc2UgaWYgKGNhbGxBcmdzLnR5cGUgPT09IFBFTkRJTkdfQ0FMTF9UWVBFX1BJWEVMU19VUERBVEVEKSB7XHJcbiAgICAgICAgICAgIHRoaXMuX3BpeGVsc1VwZGF0ZWQoY2FsbEFyZ3MpO1xyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IEludGVybmFsIEltYWdlRGVjb2RlclZpZXdlciBFcnJvcjogVW5leHBlY3RlZCBjYWxsIHR5cGUgJyArXHJcbiAgICAgICAgICAgICAgICBjYWxsQXJncy50eXBlO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuICAgIFxyXG4gICAgdGhpcy5fcGVuZGluZ0NhbGxiYWNrQ2FsbHMubGVuZ3RoID0gMDtcclxuICAgIFxyXG4gICAgdGhpcy5fY2FudmFzVXBkYXRlZENhbGxiYWNrKG5ld1Bvc2l0aW9uKTtcclxufTtcclxuXHJcbkltYWdlRGVjb2RlclZpZXdlci5wcm90b3R5cGUuX3BpeGVsc1VwZGF0ZWQgPSBmdW5jdGlvbiBwaXhlbHNVcGRhdGVkKHBpeGVsc1VwZGF0ZWRBcmdzKSB7XHJcbiAgICB2YXIgcmVnaW9uID0gcGl4ZWxzVXBkYXRlZEFyZ3MucmVnaW9uO1xyXG4gICAgdmFyIGRlY29kZWQgPSBwaXhlbHNVcGRhdGVkQXJncy5kZWNvZGVkO1xyXG4gICAgaWYgKGRlY29kZWQuaW1hZ2VEYXRhLndpZHRoID09PSAwIHx8IGRlY29kZWQuaW1hZ2VEYXRhLmhlaWdodCA9PT0gMCkge1xyXG4gICAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIFxyXG4gICAgdmFyIHggPSBkZWNvZGVkLnhJbk9yaWdpbmFsUmVxdWVzdDtcclxuICAgIHZhciB5ID0gZGVjb2RlZC55SW5PcmlnaW5hbFJlcXVlc3Q7XHJcbiAgICBcclxuICAgIHZhciBjb250ZXh0ID0gcmVnaW9uLmNhbnZhcy5nZXRDb250ZXh0KCcyZCcpO1xyXG4gICAgLy92YXIgaW1hZ2VEYXRhID0gY29udGV4dC5jcmVhdGVJbWFnZURhdGEoZGVjb2RlZC53aWR0aCwgZGVjb2RlZC5oZWlnaHQpO1xyXG4gICAgLy9pbWFnZURhdGEuZGF0YS5zZXQoZGVjb2RlZC5waXhlbHMpO1xyXG4gICAgXHJcbiAgICBjb250ZXh0LnB1dEltYWdlRGF0YShkZWNvZGVkLmltYWdlRGF0YSwgeCwgeSk7XHJcbn07XHJcblxyXG5JbWFnZURlY29kZXJWaWV3ZXIucHJvdG90eXBlLl9yZXBvc2l0aW9uQ2FudmFzID0gZnVuY3Rpb24gcmVwb3NpdGlvbkNhbnZhcyhyZXBvc2l0aW9uQXJncykge1xyXG4gICAgdmFyIHJlZ2lvbiA9IHJlcG9zaXRpb25BcmdzLnJlZ2lvbjtcclxuICAgIHZhciBwb3NpdGlvbiA9IHJlcG9zaXRpb25BcmdzLnBvc2l0aW9uO1xyXG4gICAgdmFyIGRvbmVQYXJ0UGFyYW1zID0gcmVwb3NpdGlvbkFyZ3MuZG9uZVBhcnRQYXJhbXM7XHJcbiAgICB2YXIgY29weURhdGEgPSByZXBvc2l0aW9uQXJncy5jb3B5RGF0YTtcclxuICAgIHZhciBwaXhlbHNXaWR0aCA9IHJlcG9zaXRpb25BcmdzLnBpeGVsc1dpZHRoO1xyXG4gICAgdmFyIHBpeGVsc0hlaWdodCA9IHJlcG9zaXRpb25BcmdzLnBpeGVsc0hlaWdodDtcclxuICAgIFxyXG4gICAgdmFyIGltYWdlRGF0YVRvQ29weTtcclxuICAgIHZhciBjb250ZXh0ID0gcmVnaW9uLmNhbnZhcy5nZXRDb250ZXh0KCcyZCcpO1xyXG4gICAgXHJcbiAgICBpZiAoY29weURhdGEgIT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIGlmIChjb3B5RGF0YS5mcm9tV2lkdGggPT09IGNvcHlEYXRhLnRvV2lkdGggJiYgY29weURhdGEuZnJvbUhlaWdodCA9PT0gY29weURhdGEudG9IZWlnaHQpIHtcclxuICAgICAgICAgICAgaW1hZ2VEYXRhVG9Db3B5ID0gY29udGV4dC5nZXRJbWFnZURhdGEoXHJcbiAgICAgICAgICAgICAgICBjb3B5RGF0YS5mcm9tWCwgY29weURhdGEuZnJvbVksIGNvcHlEYXRhLmZyb21XaWR0aCwgY29weURhdGEuZnJvbUhlaWdodCk7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgaWYgKCF0aGlzLl90bXBDYW52YXMpIHtcclxuICAgICAgICAgICAgICAgIHRoaXMuX3RtcENhbnZhcyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2NhbnZhcycpO1xyXG4gICAgICAgICAgICAgICAgdGhpcy5fdG1wQ2FudmFzQ29udGV4dCA9IHRoaXMuX3RtcENhbnZhcy5nZXRDb250ZXh0KCcyZCcpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICB0aGlzLl90bXBDYW52YXMud2lkdGggID0gY29weURhdGEudG9XaWR0aDtcclxuICAgICAgICAgICAgdGhpcy5fdG1wQ2FudmFzLmhlaWdodCA9IGNvcHlEYXRhLnRvSGVpZ2h0O1xyXG4gICAgICAgICAgICB0aGlzLl90bXBDYW52YXNDb250ZXh0LmRyYXdJbWFnZShcclxuICAgICAgICAgICAgICAgIHJlZ2lvbi5jYW52YXMsXHJcbiAgICAgICAgICAgICAgICBjb3B5RGF0YS5mcm9tWCwgY29weURhdGEuZnJvbVksIGNvcHlEYXRhLmZyb21XaWR0aCwgY29weURhdGEuZnJvbUhlaWdodCxcclxuICAgICAgICAgICAgICAgIDAsIDAsIGNvcHlEYXRhLnRvV2lkdGgsIGNvcHlEYXRhLnRvSGVpZ2h0KTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGltYWdlRGF0YVRvQ29weSA9IHRoaXMuX3RtcENhbnZhc0NvbnRleHQuZ2V0SW1hZ2VEYXRhKFxyXG4gICAgICAgICAgICAgICAgMCwgMCwgY29weURhdGEudG9XaWR0aCwgY29weURhdGEudG9IZWlnaHQpO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuICAgIFxyXG4gICAgcmVnaW9uLmNhbnZhcy53aWR0aCA9IHBpeGVsc1dpZHRoO1xyXG4gICAgcmVnaW9uLmNhbnZhcy5oZWlnaHQgPSBwaXhlbHNIZWlnaHQ7XHJcbiAgICBcclxuICAgIGlmIChyZWdpb24gIT09IHRoaXMuX3JlZ2lvbnNbUkVHSU9OX09WRVJWSUVXXSkge1xyXG4gICAgICAgIHRoaXMuX2NvcHlPdmVydmlld1RvQ2FudmFzKFxyXG4gICAgICAgICAgICBjb250ZXh0LCBwb3NpdGlvbiwgcGl4ZWxzV2lkdGgsIHBpeGVsc0hlaWdodCk7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGlmIChjb3B5RGF0YSAhPT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgY29udGV4dC5wdXRJbWFnZURhdGEoaW1hZ2VEYXRhVG9Db3B5LCBjb3B5RGF0YS50b1gsIGNvcHlEYXRhLnRvWSk7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHJlZ2lvbi5wb3NpdGlvbiA9IHBvc2l0aW9uO1xyXG4gICAgcmVnaW9uLmRvbmVQYXJ0UGFyYW1zID0gZG9uZVBhcnRQYXJhbXM7XHJcbn07XHJcblxyXG5JbWFnZURlY29kZXJWaWV3ZXIucHJvdG90eXBlLl9jb3B5T3ZlcnZpZXdUb0NhbnZhcyA9IGZ1bmN0aW9uIGNvcHlPdmVydmlld1RvQ2FudmFzKFxyXG4gICAgY29udGV4dCwgY2FudmFzUG9zaXRpb24sIGNhbnZhc1BpeGVsc1dpZHRoLCBjYW52YXNQaXhlbHNIZWlnaHQpIHtcclxuICAgIFxyXG4gICAgdmFyIHNvdXJjZVBvc2l0aW9uID0gdGhpcy5fcmVnaW9uc1tSRUdJT05fT1ZFUlZJRVddLnBvc2l0aW9uO1xyXG4gICAgdmFyIHNvdXJjZVBpeGVscyA9XHJcbiAgICAgICAgdGhpcy5fcmVnaW9uc1tSRUdJT05fT1ZFUlZJRVddLmltYWdlUGFydFBhcmFtcztcclxuICAgIFxyXG4gICAgdmFyIHNvdXJjZVBpeGVsc1dpZHRoID1cclxuICAgICAgICBzb3VyY2VQaXhlbHMubWF4WEV4Y2x1c2l2ZSAtIHNvdXJjZVBpeGVscy5taW5YO1xyXG4gICAgdmFyIHNvdXJjZVBpeGVsc0hlaWdodCA9XHJcbiAgICAgICAgc291cmNlUGl4ZWxzLm1heFlFeGNsdXNpdmUgLSBzb3VyY2VQaXhlbHMubWluWTtcclxuICAgIFxyXG4gICAgdmFyIHNvdXJjZVBvc2l0aW9uV2lkdGggPVxyXG4gICAgICAgIHNvdXJjZVBvc2l0aW9uLmVhc3QgLSBzb3VyY2VQb3NpdGlvbi53ZXN0O1xyXG4gICAgdmFyIHNvdXJjZVBvc2l0aW9uSGVpZ2h0ID1cclxuICAgICAgICBzb3VyY2VQb3NpdGlvbi5ub3J0aCAtIHNvdXJjZVBvc2l0aW9uLnNvdXRoO1xyXG4gICAgICAgIFxyXG4gICAgdmFyIHNvdXJjZVJlc29sdXRpb25YID1cclxuICAgICAgICBzb3VyY2VQaXhlbHNXaWR0aCAvIHNvdXJjZVBvc2l0aW9uV2lkdGg7XHJcbiAgICB2YXIgc291cmNlUmVzb2x1dGlvblkgPVxyXG4gICAgICAgIHNvdXJjZVBpeGVsc0hlaWdodCAvIHNvdXJjZVBvc2l0aW9uSGVpZ2h0O1xyXG4gICAgXHJcbiAgICB2YXIgdGFyZ2V0UG9zaXRpb25XaWR0aCA9XHJcbiAgICAgICAgY2FudmFzUG9zaXRpb24uZWFzdCAtIGNhbnZhc1Bvc2l0aW9uLndlc3Q7XHJcbiAgICB2YXIgdGFyZ2V0UG9zaXRpb25IZWlnaHQgPVxyXG4gICAgICAgIGNhbnZhc1Bvc2l0aW9uLm5vcnRoIC0gY2FudmFzUG9zaXRpb24uc291dGg7XHJcbiAgICAgICAgXHJcbiAgICB2YXIgY3JvcFdpZHRoID0gdGFyZ2V0UG9zaXRpb25XaWR0aCAqIHNvdXJjZVJlc29sdXRpb25YO1xyXG4gICAgdmFyIGNyb3BIZWlnaHQgPSB0YXJnZXRQb3NpdGlvbkhlaWdodCAqIHNvdXJjZVJlc29sdXRpb25ZO1xyXG4gICAgXHJcbiAgICB2YXIgY3JvcE9mZnNldFBvc2l0aW9uWCA9XHJcbiAgICAgICAgY2FudmFzUG9zaXRpb24ud2VzdCAtIHNvdXJjZVBvc2l0aW9uLndlc3Q7XHJcbiAgICB2YXIgY3JvcE9mZnNldFBvc2l0aW9uWSA9XHJcbiAgICAgICAgc291cmNlUG9zaXRpb24ubm9ydGggLSBjYW52YXNQb3NpdGlvbi5ub3J0aDtcclxuICAgICAgICBcclxuICAgIHZhciBjcm9wUGl4ZWxPZmZzZXRYID0gY3JvcE9mZnNldFBvc2l0aW9uWCAqIHNvdXJjZVJlc29sdXRpb25YO1xyXG4gICAgdmFyIGNyb3BQaXhlbE9mZnNldFkgPSBjcm9wT2Zmc2V0UG9zaXRpb25ZICogc291cmNlUmVzb2x1dGlvblk7XHJcbiAgICBcclxuICAgIGNvbnRleHQuZHJhd0ltYWdlKFxyXG4gICAgICAgIHRoaXMuX3JlZ2lvbnNbUkVHSU9OX09WRVJWSUVXXS5jYW52YXMsXHJcbiAgICAgICAgY3JvcFBpeGVsT2Zmc2V0WCwgY3JvcFBpeGVsT2Zmc2V0WSwgY3JvcFdpZHRoLCBjcm9wSGVpZ2h0LFxyXG4gICAgICAgIDAsIDAsIGNhbnZhc1BpeGVsc1dpZHRoLCBjYW52YXNQaXhlbHNIZWlnaHQpO1xyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVyVmlld2VyLnByb3RvdHlwZS5fb3BlbmVkID0gZnVuY3Rpb24gb3BlbmVkKCkge1xyXG4gICAgdGhpcy5faXNSZWFkeSA9IHRydWU7XHJcbiAgICBcclxuICAgIHZhciBmaXhlZEJvdW5kcyA9IHtcclxuICAgICAgICB3ZXN0OiB0aGlzLl9jYXJ0b2dyYXBoaWNCb3VuZHMud2VzdCxcclxuICAgICAgICBlYXN0OiB0aGlzLl9jYXJ0b2dyYXBoaWNCb3VuZHMuZWFzdCxcclxuICAgICAgICBzb3V0aDogdGhpcy5fY2FydG9ncmFwaGljQm91bmRzLnNvdXRoLFxyXG4gICAgICAgIG5vcnRoOiB0aGlzLl9jYXJ0b2dyYXBoaWNCb3VuZHMubm9ydGhcclxuICAgIH07XHJcbiAgICBpbWFnZUhlbHBlckZ1bmN0aW9ucy5maXhCb3VuZHMoXHJcbiAgICAgICAgZml4ZWRCb3VuZHMsIHRoaXMuX2ltYWdlRGVjb2RlciwgdGhpcy5fYWRhcHRQcm9wb3J0aW9ucyk7XHJcbiAgICB0aGlzLl9jYXJ0b2dyYXBoaWNCb3VuZHNGaXhlZCA9IGZpeGVkQm91bmRzO1xyXG4gICAgXHJcbiAgICB2YXIgaW1hZ2VXaWR0aCAgPSB0aGlzLl9pbWFnZURlY29kZXIuZ2V0SW1hZ2VXaWR0aCAoKTtcclxuICAgIHZhciBpbWFnZUhlaWdodCA9IHRoaXMuX2ltYWdlRGVjb2Rlci5nZXRJbWFnZUhlaWdodCgpO1xyXG4gICAgdGhpcy5fcXVhbGl0eSA9IHRoaXMuX2ltYWdlRGVjb2Rlci5nZXRIaWdoZXN0UXVhbGl0eSgpO1xyXG5cclxuICAgIHZhciByZWN0YW5nbGVXaWR0aCA9IGZpeGVkQm91bmRzLmVhc3QgLSBmaXhlZEJvdW5kcy53ZXN0O1xyXG4gICAgdmFyIHJlY3RhbmdsZUhlaWdodCA9IGZpeGVkQm91bmRzLm5vcnRoIC0gZml4ZWRCb3VuZHMuc291dGg7XHJcbiAgICB0aGlzLl9zY2FsZVggPSBpbWFnZVdpZHRoIC8gcmVjdGFuZ2xlV2lkdGg7XHJcbiAgICB0aGlzLl9zY2FsZVkgPSAtaW1hZ2VIZWlnaHQgLyByZWN0YW5nbGVIZWlnaHQ7XHJcbiAgICBcclxuICAgIHRoaXMuX3RyYW5zbGF0ZVggPSAtZml4ZWRCb3VuZHMud2VzdCAqIHRoaXMuX3NjYWxlWDtcclxuICAgIHRoaXMuX3RyYW5zbGF0ZVkgPSAtZml4ZWRCb3VuZHMubm9ydGggKiB0aGlzLl9zY2FsZVk7XHJcbiAgICBcclxuICAgIHZhciBvdmVydmlld1BhcmFtcyA9IHtcclxuICAgICAgICBtaW5YOiAwLFxyXG4gICAgICAgIG1pblk6IDAsXHJcbiAgICAgICAgbWF4WEV4Y2x1c2l2ZTogaW1hZ2VXaWR0aCxcclxuICAgICAgICBtYXhZRXhjbHVzaXZlOiBpbWFnZUhlaWdodCxcclxuICAgICAgICBzY3JlZW5XaWR0aDogdGhpcy5fb3ZlcnZpZXdSZXNvbHV0aW9uWCxcclxuICAgICAgICBzY3JlZW5IZWlnaHQ6IHRoaXMuX292ZXJ2aWV3UmVzb2x1dGlvbllcclxuICAgIH07XHJcbiAgICBcclxuICAgIHZhciBvdmVydmlld0FsaWduZWRQYXJhbXMgPVxyXG4gICAgICAgIGltYWdlSGVscGVyRnVuY3Rpb25zLmFsaWduUGFyYW1zVG9UaWxlc0FuZExldmVsKFxyXG4gICAgICAgICAgICBvdmVydmlld1BhcmFtcywgdGhpcy5faW1hZ2VEZWNvZGVyKTtcclxuICAgICAgICAgICAgXHJcbiAgICBvdmVydmlld0FsaWduZWRQYXJhbXMuaW1hZ2VQYXJ0UGFyYW1zLnJlcXVlc3RQcmlvcml0eURhdGEgPVxyXG4gICAgICAgIG92ZXJ2aWV3QWxpZ25lZFBhcmFtcy5pbWFnZVBhcnRQYXJhbXMucmVxdWVzdFByaW9yaXR5RGF0YSB8fCB7fTtcclxuICAgIFxyXG4gICAgb3ZlcnZpZXdBbGlnbmVkUGFyYW1zLmltYWdlUGFydFBhcmFtcy5yZXF1ZXN0UHJpb3JpdHlEYXRhLm92ZXJyaWRlSGlnaGVzdFByaW9yaXR5ID0gdHJ1ZTtcclxuICAgIG92ZXJ2aWV3QWxpZ25lZFBhcmFtcy5pbWFnZVBhcnRQYXJhbXMucXVhbGl0eSA9IHRoaXMuX2ltYWdlRGVjb2Rlci5nZXRMb3dlc3RRdWFsaXR5KCk7XHJcbiAgICBcclxuICAgIHZhciBzdGFydER5bmFtaWNSZWdpb25PblRlcm1pbmF0aW9uID1cclxuICAgICAgICAhdGhpcy5fYWxsb3dNdWx0aXBsZU1vdmFibGVGZXRjaGVzSW5TZXNzaW9uO1xyXG4gICAgICAgIFxyXG4gICAgdGhpcy5fZmV0Y2goXHJcbiAgICAgICAgUkVHSU9OX09WRVJWSUVXLFxyXG4gICAgICAgIG92ZXJ2aWV3QWxpZ25lZFBhcmFtcyxcclxuICAgICAgICBzdGFydER5bmFtaWNSZWdpb25PblRlcm1pbmF0aW9uKTtcclxuICAgIFxyXG4gICAgaWYgKHRoaXMuX2FsbG93TXVsdGlwbGVNb3ZhYmxlRmV0Y2hlc0luU2Vzc2lvbikge1xyXG4gICAgICAgIHRoaXMuX3N0YXJ0U2hvd2luZ0R5bmFtaWNSZWdpb24oKTtcclxuICAgIH1cclxufTsiLCIndXNlIHN0cmljdCc7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IEltYWdlUGFyYW1zUmV0cmlldmVyUHJveHk7XHJcblxyXG5mdW5jdGlvbiBJbWFnZVBhcmFtc1JldHJpZXZlclByb3h5KCkge1xyXG4gICAgdGhpcy5fc2l6ZXNQYXJhbXMgPSBudWxsO1xyXG59XHJcblxyXG5JbWFnZVBhcmFtc1JldHJpZXZlclByb3h5LnByb3RvdHlwZS5nZXRJbWFnZUxldmVsID0gZnVuY3Rpb24gZ2V0SW1hZ2VMZXZlbCgpIHtcclxuICAgIHZhciBzaXplc1BhcmFtcyA9IHRoaXMuZ2V0SW1hZ2VQYXJhbXMoKTtcclxuXHJcbiAgICByZXR1cm4gc2l6ZXNQYXJhbXMuaW1hZ2VMZXZlbDtcclxufTtcclxuXHJcbkltYWdlUGFyYW1zUmV0cmlldmVyUHJveHkucHJvdG90eXBlLmdldEltYWdlV2lkdGggPSBmdW5jdGlvbiBnZXRJbWFnZVdpZHRoKCkge1xyXG4gICAgdmFyIHNpemVzUGFyYW1zID0gdGhpcy5nZXRJbWFnZVBhcmFtcygpO1xyXG5cclxuICAgIHJldHVybiBzaXplc1BhcmFtcy5pbWFnZVdpZHRoO1xyXG59O1xyXG5cclxuSW1hZ2VQYXJhbXNSZXRyaWV2ZXJQcm94eS5wcm90b3R5cGUuZ2V0SW1hZ2VIZWlnaHQgPSBmdW5jdGlvbiBnZXRJbWFnZUhlaWdodCgpIHtcclxuICAgIHZhciBzaXplc1BhcmFtcyA9IHRoaXMuZ2V0SW1hZ2VQYXJhbXMoKTtcclxuXHJcbiAgICByZXR1cm4gc2l6ZXNQYXJhbXMuaW1hZ2VIZWlnaHQ7XHJcbn07XHJcblxyXG5JbWFnZVBhcmFtc1JldHJpZXZlclByb3h5LnByb3RvdHlwZS5nZXROdW1SZXNvbHV0aW9uTGV2ZWxzRm9yTGltaXR0ZWRWaWV3ZXIgPSBmdW5jdGlvbiBnZXROdW1SZXNvbHV0aW9uTGV2ZWxzRm9yTGltaXR0ZWRWaWV3ZXIoKSB7XHJcbiAgICB2YXIgc2l6ZXNQYXJhbXMgPSB0aGlzLmdldEltYWdlUGFyYW1zKCk7XHJcblxyXG4gICAgcmV0dXJuIHNpemVzUGFyYW1zLm51bVJlc29sdXRpb25MZXZlbHNGb3JMaW1pdHRlZFZpZXdlcjtcclxufTtcclxuXHJcbkltYWdlUGFyYW1zUmV0cmlldmVyUHJveHkucHJvdG90eXBlLmdldExvd2VzdFF1YWxpdHkgPSBmdW5jdGlvbiBnZXRMb3dlc3RRdWFsaXR5KCkge1xyXG4gICAgdmFyIHNpemVzUGFyYW1zID0gdGhpcy5nZXRJbWFnZVBhcmFtcygpO1xyXG5cclxuICAgIHJldHVybiBzaXplc1BhcmFtcy5sb3dlc3RRdWFsaXR5O1xyXG59O1xyXG5cclxuSW1hZ2VQYXJhbXNSZXRyaWV2ZXJQcm94eS5wcm90b3R5cGUuZ2V0SGlnaGVzdFF1YWxpdHkgPSBmdW5jdGlvbiBnZXRIaWdoZXN0UXVhbGl0eSgpIHtcclxuICAgIHZhciBzaXplc1BhcmFtcyA9IHRoaXMuZ2V0SW1hZ2VQYXJhbXMoKTtcclxuXHJcbiAgICByZXR1cm4gc2l6ZXNQYXJhbXMuaGlnaGVzdFF1YWxpdHk7XHJcbn07XHJcblxyXG5JbWFnZVBhcmFtc1JldHJpZXZlclByb3h5LnByb3RvdHlwZS5nZXRJbWFnZVBhcmFtcyA9IGZ1bmN0aW9uIGdldEltYWdlUGFyYW1zKCkge1xyXG4gICAgaWYgKCF0aGlzLl9zaXplc1BhcmFtcykge1xyXG4gICAgICAgIHRoaXMuX3NpemVzUGFyYW1zID0gdGhpcy5fZ2V0SW1hZ2VQYXJhbXNJbnRlcm5hbCgpO1xyXG4gICAgICAgIGlmICghdGhpcy5fc2l6ZXNQYXJhbXMpIHtcclxuICAgICAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogZ2V0SW1hZ2VQYXJhbXNJbnRlcm5hbCgpIHJldHVybmVkIGZhbHN5IHZhbHVlOyBNYXliZSBpbWFnZSBub3QgcmVhZHkgeWV0Pyc7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIGlmICh0aGlzLl9zaXplc1BhcmFtcy5pbWFnZUxldmVsID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogZ2V0SW1hZ2VQYXJhbXNJbnRlcm5hbCgpIHJlc3VsdCBoYXMgbm8gaW1hZ2VMZXZlbCBwcm9wZXJ0eSc7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIGlmICh0aGlzLl9zaXplc1BhcmFtcy5pbWFnZVdpZHRoID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogZ2V0SW1hZ2VQYXJhbXNJbnRlcm5hbCgpIHJlc3VsdCBoYXMgbm8gaW1hZ2VXaWR0aCBwcm9wZXJ0eSc7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIGlmICh0aGlzLl9zaXplc1BhcmFtcy5pbWFnZUhlaWdodCA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IGdldEltYWdlUGFyYW1zSW50ZXJuYWwoKSByZXN1bHQgaGFzIG5vIGltYWdlSGVpZ2h0IHByb3BlcnR5JztcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKHRoaXMuX3NpemVzUGFyYW1zLm51bVJlc29sdXRpb25MZXZlbHNGb3JMaW1pdHRlZFZpZXdlciA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IGdldEltYWdlUGFyYW1zSW50ZXJuYWwoKSByZXN1bHQgaGFzIG5vIG51bVJlc29sdXRpb25MZXZlbHNGb3JMaW1pdHRlZFZpZXdlciBwcm9wZXJ0eSc7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIGlmICh0aGlzLl9zaXplc1BhcmFtcy5sb3dlc3RRdWFsaXR5ID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogZ2V0SW1hZ2VQYXJhbXNJbnRlcm5hbCgpIHJlc3VsdCBoYXMgbm8gbG93ZXN0UXVhbGl0eSBwcm9wZXJ0eSc7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIGlmICh0aGlzLl9zaXplc1BhcmFtcy5oaWdoZXN0UXVhbGl0eSA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IGdldEltYWdlUGFyYW1zSW50ZXJuYWwoKSByZXN1bHQgaGFzIG5vIGhpZ2hlc3RRdWFsaXR5IHByb3BlcnR5JztcclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHJldHVybiB0aGlzLl9zaXplc1BhcmFtcztcclxufTtcclxuXHJcbkltYWdlUGFyYW1zUmV0cmlldmVyUHJveHkucHJvdG90eXBlLl9nZXRJbWFnZVBhcmFtc0ludGVybmFsID0gZnVuY3Rpb24gZ2V0SW1hZ2VQYXJhbXNJbnRlcm5hbCgpIHtcclxuICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IEltYWdlUGFyYW1zUmV0cmlldmVyUHJveHkgaW5oZXJpdG9yIGRpZCBub3QgaW1wbGVtZW50IF9nZXRJbWFnZVBhcmFtc0ludGVybmFsKCknO1xyXG59OyIsIid1c2Ugc3RyaWN0JztcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gV29ya2VyUHJveHlGZXRjaE1hbmFnZXI7XHJcblxyXG5mdW5jdGlvbiBXb3JrZXJQcm94eUZldGNoTWFuYWdlcihmZXRjaGVyLCBvcHRpb25zKSB7XHJcbiAgICB0aGlzLl9vcHRpb25zID0gb3B0aW9ucyB8fCB7fTtcclxuICAgIHRoaXMuX2ludGVybmFsU2l6ZXNQYXJhbXMgPSBudWxsO1xyXG4gICAgdGhpcy5fdGlsZVdpZHRoID0gMDtcclxuICAgIHRoaXMuX3RpbGVIZWlnaHQgPSAwO1xyXG5cclxuICAgIGFzeW5jUHJveHkuQXN5bmNQcm94eUZhY3RvcnkuaW5pdGlhbGl6ZShcclxuICAgICAgICB0aGlzLCBmZXRjaGVyLnNjcmlwdHNUb0ltcG9ydCwgJ2ltYWdlRGVjb2RlckZyYW1ld29yay5GZXRjaE1hbmFnZXInLCBbZmV0Y2hlciwgb3B0aW9uc10pO1xyXG59XHJcblxyXG5hc3luY1Byb3h5LkFzeW5jUHJveHlGYWN0b3J5LmFkZE1ldGhvZHMoV29ya2VyUHJveHlGZXRjaE1hbmFnZXIsIHtcclxuICAgIGNsb3NlOiBbe2lzUmV0dXJuUHJvbWlzZTogdHJ1ZX1dLFxyXG4gICAgc2V0UHJpb3JpdGl6ZXJUeXBlOiBbXSxcclxuICAgIHNldEZldGNoUHJpb3JpdGl6ZXJEYXRhOiBbXSxcclxuICAgIHNldElzUHJvZ3Jlc3NpdmVSZXF1ZXN0OiBbXSxcclxuICAgIGNyZWF0ZU1vdmFibGVGZXRjaDogW3tpc1JldHVyblByb21pc2U6IHRydWV9XSxcclxuICAgIG1vdmVGZXRjaDogW10sXHJcbiAgICBjcmVhdGVSZXF1ZXN0OiBbXSxcclxuICAgIG1hbnVhbEFib3J0UmVxdWVzdDogW11cclxufSk7XHJcblxyXG5Xb3JrZXJQcm94eUZldGNoTWFuYWdlci5wcm90b3R5cGUub3BlbiA9IGZ1bmN0aW9uIG9wZW4odXJsKSB7XHJcbiAgICB2YXIgc2VsZiA9IHRoaXM7XHJcbiAgICB2YXIgd29ya2VySGVscGVyID0gYXN5bmNQcm94eS5Bc3luY1Byb3h5RmFjdG9yeS5nZXRXb3JrZXJIZWxwZXIodGhpcyk7XHJcblxyXG4gICAgcmV0dXJuIHdvcmtlckhlbHBlci5jYWxsRnVuY3Rpb24oJ29wZW4nLCBbdXJsXSwgeyBpc1JldHVyblByb21pc2U6IHRydWUgfSlcclxuICAgICAgICAudGhlbihmdW5jdGlvbihkYXRhKSB7XHJcbiAgICAgICAgICAgIHNlbGYuX2ludGVybmFsU2l6ZXNQYXJhbXMgPSBkYXRhO1xyXG4gICAgICAgICAgICBzZWxmLmdldEltYWdlUGFyYW1zKCk7XHJcbiAgICAgICAgICAgIHJldHVybiBkYXRhO1xyXG4gICAgICAgIH0pO1xyXG59O1xyXG5cclxuV29ya2VyUHJveHlGZXRjaE1hbmFnZXIucHJvdG90eXBlLmdldEltYWdlUGFyYW1zID0gZnVuY3Rpb24gZ2V0SW1hZ2VQYXJhbXMoKSB7XHJcbiAgICBpZiAoIXRoaXMuX2ludGVybmFsU2l6ZXNQYXJhbXMpIHtcclxuICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBub3Qgb3BlbmVkIHlldCc7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gdGhpcy5faW50ZXJuYWxTaXplc1BhcmFtcztcclxufTtcclxuXHJcbldvcmtlclByb3h5RmV0Y2hNYW5hZ2VyLnByb3RvdHlwZS5vbiA9IGZ1bmN0aW9uIG9uKGV2ZW50LCBjYWxsYmFjaykge1xyXG4gICAgdmFyIHRyYW5zZmVyYWJsZVBhdGhzID0gdGhpcy5fb3B0aW9ucy50cmFuc2ZlcmFibGVQYXRoc09mRGF0YUNhbGxiYWNrO1xyXG4gICAgdmFyIHdvcmtlckhlbHBlciA9IGFzeW5jUHJveHkuQXN5bmNQcm94eUZhY3RvcnkuZ2V0V29ya2VySGVscGVyKHRoaXMpO1xyXG4gICAgXHJcbiAgICB2YXIgY2FsbGJhY2tXcmFwcGVyID0gd29ya2VySGVscGVyLndyYXBDYWxsYmFjayhcclxuICAgICAgICBjYWxsYmFjaywgZXZlbnQgKyAnLWNhbGxiYWNrJywge1xyXG4gICAgICAgICAgICBpc011bHRpcGxlVGltZUNhbGxiYWNrOiB0cnVlLFxyXG4gICAgICAgICAgICBwYXRoc1RvVHJhbnNmZXJhYmxlczogdHJhbnNmZXJhYmxlUGF0aHNcclxuICAgICAgICB9XHJcbiAgICApO1xyXG4gICAgXHJcbiAgICByZXR1cm4gd29ya2VySGVscGVyLmNhbGxGdW5jdGlvbignb24nLCBbZXZlbnQsIGNhbGxiYWNrV3JhcHBlcl0pO1xyXG59OyIsIid1c2Ugc3RyaWN0JztcclxuXHJcbnZhciBJbWFnZVBhcmFtc1JldHJpZXZlclByb3h5ID0gcmVxdWlyZSgnaW1hZ2UtcGFyYW1zLXJldHJpZXZlci1wcm94eS5qcycpO1xyXG52YXIgaW1hZ2VIZWxwZXJGdW5jdGlvbnMgPSByZXF1aXJlKCdpbWFnZS1oZWxwZXItZnVuY3Rpb25zLmpzJyk7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IFdvcmtlclByb3h5SW1hZ2VEZWNvZGVyO1xyXG5cclxuZnVuY3Rpb24gV29ya2VyUHJveHlJbWFnZURlY29kZXIoaW1hZ2UsIG9wdGlvbnMpIHtcclxuICAgIEltYWdlUGFyYW1zUmV0cmlldmVyUHJveHkuY2FsbCh0aGlzKTtcclxuICAgIFxyXG4gICAgaWYgKCdmdW5jdGlvbicgIT09IHR5cGVvZiBpbWFnZS5jcmVhdGVMZXZlbENhbGN1bGF0b3IpIHtcclxuICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBNaXNzaW5nIG1ldGhvZCBpbWFnZS5jcmVhdGVMZXZlbENhbGN1bGF0b3IoKSc7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGFzeW5jUHJveHkuQXN5bmNQcm94eUZhY3RvcnkuaW5pdGlhbGl6ZShcclxuICAgICAgICB0aGlzLFxyXG4gICAgICAgIGltYWdlLnNjcmlwdHNUb0ltcG9ydCxcclxuICAgICAgICAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrLkltYWdlRGVjb2RlcicsXHJcbiAgICAgICAgW3tjdG9yTmFtZTogaW1hZ2UuY3Rvck5hbWV9LCBvcHRpb25zXSk7XHJcbiAgICBcclxuICAgIHRoaXMuX2ltYWdlID0gaW1hZ2U7XHJcbiAgICB0aGlzLl9sZXZlbENhbGN1bGF0b3IgPSBudWxsO1xyXG4gICAgdGhpcy5faW50ZXJuYWxTaXplc1BhcmFtcyA9IG51bGw7XHJcbiAgICB0aGlzLl90aWxlV2lkdGggPSAwO1xyXG4gICAgdGhpcy5fdGlsZUhlaWdodCA9IDA7XHJcbn1cclxuXHJcbldvcmtlclByb3h5SW1hZ2VEZWNvZGVyLnByb3RvdHlwZSA9IE9iamVjdC5jcmVhdGUoSW1hZ2VQYXJhbXNSZXRyaWV2ZXJQcm94eS5wcm90b3R5cGUpO1xyXG5cclxuYXN5bmNQcm94eS5Bc3luY1Byb3h5RmFjdG9yeS5hZGRNZXRob2RzKFdvcmtlclByb3h5SW1hZ2VEZWNvZGVyLCB7XHJcbiAgICBzZXRGZXRjaFByaW9yaXRpemVyRGF0YTogW10sXHJcbiAgICBzZXREZWNvZGVQcmlvcml0aXplckRhdGE6IFtdLFxyXG4gICAgc2V0RmV0Y2hQcmlvcml0aXplclR5cGU6IFtdLFxyXG4gICAgc2V0RGVjb2RlUHJpb3JpdGl6ZXJUeXBlOiBbXSxcclxuICAgIGNsb3NlOiBbe2lzUmV0dXJuUHJvbWlzZTogdHJ1ZX1dLFxyXG4gICAgY3JlYXRlTW92YWJsZUZldGNoOiBbe2lzUmV0dXJuUHJvbWlzZTogdHJ1ZX1dLFxyXG4gICAgcmVxdWVzdFBpeGVsczogW3tpc1JldHVyblByb21pc2U6IHRydWV9XVxyXG59KTtcclxuXHJcbldvcmtlclByb3h5SW1hZ2VEZWNvZGVyLnByb3RvdHlwZS5vcGVuID0gZnVuY3Rpb24gb3Blbih1cmwpIHtcclxuICAgIHZhciBzZWxmID0gdGhpcztcclxuICAgIHZhciB3b3JrZXJIZWxwZXIgPSBhc3luY1Byb3h5LkFzeW5jUHJveHlGYWN0b3J5LmdldFdvcmtlckhlbHBlcih0aGlzKTtcclxuICAgIHJldHVybiB3b3JrZXJIZWxwZXIuY2FsbEZ1bmN0aW9uKCdvcGVuJywgW3VybF0sIHsgaXNSZXR1cm5Qcm9taXNlOiB0cnVlIH0pXHJcbiAgICAgICAgLnRoZW4oZnVuY3Rpb24oZGF0YSkge1xyXG4gICAgICAgICAgICBzZWxmLl9pbnRlcm5hbFNpemVzUGFyYW1zID0gZGF0YS5zaXplc1BhcmFtcztcclxuICAgICAgICAgICAgc2VsZi5fdGlsZVdpZHRoID0gZGF0YS5hcHBsaWNhdGl2ZVRpbGVXaWR0aDtcclxuICAgICAgICAgICAgc2VsZi5fdGlsZUhlaWdodCA9IGRhdGEuYXBwbGljYXRpdmVUaWxlSGVpZ2h0O1xyXG4gICAgICAgICAgICBzZWxmLmdldEltYWdlUGFyYW1zKCk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBzZWxmLl9sZXZlbENhbGN1bGF0b3IgPSBzZWxmLl9pbWFnZS5jcmVhdGVMZXZlbENhbGN1bGF0b3Ioc2VsZik7XHJcbiAgICAgICAgICAgIGltYWdlSGVscGVyRnVuY3Rpb25zLmVuc3VyZUxldmVsQ2FsY3VsYXRvcihzZWxmLl9sZXZlbENhbGN1bGF0b3IpO1xyXG4gICAgICAgICAgICByZXR1cm4gZGF0YTtcclxuICAgICAgICB9KTtcclxufTtcclxuXHJcbldvcmtlclByb3h5SW1hZ2VEZWNvZGVyLnByb3RvdHlwZS5fZ2V0SW1hZ2VQYXJhbXNJbnRlcm5hbCA9IGZ1bmN0aW9uIGdldEltYWdlUGFyYW1zSW50ZXJuYWwoKSB7XHJcbiAgICBpZiAoIXRoaXMuX2ludGVybmFsU2l6ZXNQYXJhbXMpIHtcclxuICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBub3Qgb3BlbmVkIHlldCc7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gdGhpcy5faW50ZXJuYWxTaXplc1BhcmFtcztcclxufTtcclxuXHJcbldvcmtlclByb3h5SW1hZ2VEZWNvZGVyLnByb3RvdHlwZS5nZXRUaWxlV2lkdGggPSBmdW5jdGlvbiBnZXRUaWxlV2lkdGgoKSB7XHJcbiAgICB0aGlzLl9nZXRJbWFnZVBhcmFtc0ludGVybmFsKCk7IC8vIGVuc3VyZSBhbHJlYWR5IG9wZW5lZFxyXG4gICAgcmV0dXJuIHRoaXMuX3RpbGVXaWR0aDtcclxufTtcclxuXHJcbldvcmtlclByb3h5SW1hZ2VEZWNvZGVyLnByb3RvdHlwZS5nZXRUaWxlSGVpZ2h0ID0gZnVuY3Rpb24gZ2V0VGlsZUhlaWdodCgpIHtcclxuICAgIHRoaXMuX2dldEltYWdlUGFyYW1zSW50ZXJuYWwoKTsgLy8gZW5zdXJlIGFscmVhZHkgb3BlbmVkXHJcbiAgICByZXR1cm4gdGhpcy5fdGlsZUhlaWdodDtcclxufTtcclxuXHJcbldvcmtlclByb3h5SW1hZ2VEZWNvZGVyLnByb3RvdHlwZS5vbkZldGNoZXJFdmVudCA9IGZ1bmN0aW9uIG9uRmV0Y2hlckV2ZW50KGV2ZW50LCBjYWxsYmFjaykge1xyXG4gICAgdmFyIHRyYW5zZmVyYWJsZXM7XHJcblxyXG4gICAgdmFyIHdvcmtlckhlbHBlciA9IGFzeW5jUHJveHkuQXN5bmNQcm94eUZhY3RvcnkuZ2V0V29ya2VySGVscGVyKHRoaXMpO1xyXG4gICAgXHJcbiAgICB2YXIgaW50ZXJuYWxDYWxsYmFja1dyYXBwZXIgPVxyXG4gICAgICAgIHdvcmtlckhlbHBlci53cmFwQ2FsbGJhY2soXHJcbiAgICAgICAgICAgIGNhbGxiYWNrLCAnb25GZXRjaGVyRXZlbnRDYWxsYmFjaycsIHtcclxuICAgICAgICAgICAgICAgIGlzTXVsdGlwbGVUaW1lQ2FsbGJhY2s6IHRydWUsXHJcbiAgICAgICAgICAgICAgICBwYXRoc1RvVHJhbnNmZXJhYmxlczogdHJhbnNmZXJhYmxlc1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgKTtcclxuICAgIFxyXG4gICAgdmFyIGFyZ3MgPSBbZXZlbnQsIGNhbGxiYWNrXTtcclxuICAgIFxyXG4gICAgd29ya2VySGVscGVyLmNhbGxGdW5jdGlvbignb24nLCBhcmdzKTtcclxufTtcclxuXHJcbldvcmtlclByb3h5SW1hZ2VEZWNvZGVyLnByb3RvdHlwZS5yZXF1ZXN0UGl4ZWxzUHJvZ3Jlc3NpdmUgPSBmdW5jdGlvbiByZXF1ZXN0UGl4ZWxzUHJvZ3Jlc3NpdmUoXHJcbiAgICAgICAgaW1hZ2VQYXJ0UGFyYW1zLFxyXG4gICAgICAgIGNhbGxiYWNrLFxyXG4gICAgICAgIHRlcm1pbmF0ZWRDYWxsYmFjayxcclxuICAgICAgICBpbWFnZVBhcnRQYXJhbXNOb3ROZWVkZWQsXHJcbiAgICAgICAgbW92YWJsZUhhbmRsZSkge1xyXG4gICAgXHJcbiAgICB2YXIgdHJhbnNmZXJhYmxlcztcclxuICAgIHZhciB3b3JrZXJIZWxwZXIgPSBhc3luY1Byb3h5LkFzeW5jUHJveHlGYWN0b3J5LmdldFdvcmtlckhlbHBlcih0aGlzKTtcclxuXHJcbiAgICAvLyBOT1RFOiBDYW5ub3QgcGFzcyBpdCBhcyB0cmFuc2ZlcmFibGVzIGJlY2F1c2UgaXQgaXMgcGFzc2VkIHRvIGFsbFxyXG4gICAgLy8gbGlzdGVuZXIgY2FsbGJhY2tzLCB0aHVzIGFmdGVyIHRoZSBmaXJzdCBvbmUgdGhlIGJ1ZmZlciBpcyBub3QgdmFsaWRcclxuICAgIFxyXG4gICAgLy92YXIgcGF0aFRvUGl4ZWxzQXJyYXkgPSBbMCwgJ3BpeGVscycsICdidWZmZXInXTtcclxuICAgIC8vdHJhbnNmZXJhYmxlcyA9IFtwYXRoVG9QaXhlbHNBcnJheV07XHJcbiAgICBcclxuICAgIHZhciBpbnRlcm5hbENhbGxiYWNrV3JhcHBlciA9XHJcbiAgICAgICAgd29ya2VySGVscGVyLndyYXBDYWxsYmFjayhcclxuICAgICAgICAgICAgY2FsbGJhY2ssICdyZXF1ZXN0UGl4ZWxzUHJvZ3Jlc3NpdmVDYWxsYmFjaycsIHtcclxuICAgICAgICAgICAgICAgIGlzTXVsdGlwbGVUaW1lQ2FsbGJhY2s6IHRydWUsXHJcbiAgICAgICAgICAgICAgICBwYXRoc1RvVHJhbnNmZXJhYmxlczogdHJhbnNmZXJhYmxlc1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgKTtcclxuICAgIFxyXG4gICAgdmFyIGludGVybmFsVGVybWluYXRlZENhbGxiYWNrV3JhcHBlciA9XHJcbiAgICAgICAgd29ya2VySGVscGVyLndyYXBDYWxsYmFjayhcclxuICAgICAgICAgICAgaW50ZXJuYWxUZXJtaW5hdGVkQ2FsbGJhY2ssICdyZXF1ZXN0UGl4ZWxzUHJvZ3Jlc3NpdmVUZXJtaW5hdGVkQ2FsbGJhY2snLCB7XHJcbiAgICAgICAgICAgICAgICBpc011bHRpcGxlVGltZUNhbGxiYWNrOiBmYWxzZVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgKTtcclxuICAgICAgICAgICAgXHJcbiAgICB2YXIgYXJncyA9IFtcclxuICAgICAgICBpbWFnZVBhcnRQYXJhbXMsXHJcbiAgICAgICAgaW50ZXJuYWxDYWxsYmFja1dyYXBwZXIsXHJcbiAgICAgICAgaW50ZXJuYWxUZXJtaW5hdGVkQ2FsbGJhY2tXcmFwcGVyLFxyXG4gICAgICAgIGltYWdlUGFydFBhcmFtc05vdE5lZWRlZCxcclxuICAgICAgICBtb3ZhYmxlSGFuZGxlXTtcclxuICAgIFxyXG4gICAgd29ya2VySGVscGVyLmNhbGxGdW5jdGlvbigncmVxdWVzdFBpeGVsc1Byb2dyZXNzaXZlJywgYXJncyk7XHJcbiAgICAgICAgXHJcbiAgICB2YXIgc2VsZiA9IHRoaXM7XHJcbiAgICBcclxuICAgIGZ1bmN0aW9uIGludGVybmFsVGVybWluYXRlZENhbGxiYWNrKGlzQWJvcnRlZCkge1xyXG4gICAgICAgIHdvcmtlckhlbHBlci5mcmVlQ2FsbGJhY2soaW50ZXJuYWxDYWxsYmFja1dyYXBwZXIpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHRlcm1pbmF0ZWRDYWxsYmFjayhpc0Fib3J0ZWQpO1xyXG4gICAgfSAgICAgICAgXHJcbn07IiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBJbWFnZURlY29kZXI7XHJcblxyXG52YXIgaW1hZ2VIZWxwZXJGdW5jdGlvbnMgPSByZXF1aXJlKCdpbWFnZS1oZWxwZXItZnVuY3Rpb25zLmpzJyk7XHJcbnZhciBEZWNvZGVKb2JzUG9vbCA9IHJlcXVpcmUoJ2RlY29kZS1qb2JzLXBvb2wuanMnKTtcclxudmFyIEltYWdlUGFyYW1zUmV0cmlldmVyUHJveHkgPSByZXF1aXJlKCdpbWFnZS1wYXJhbXMtcmV0cmlldmVyLXByb3h5LmpzJyk7XHJcbnZhciBGZXRjaE1hbmFnZXIgPSByZXF1aXJlKCdmZXRjaC1tYW5hZ2VyLmpzJyk7XHJcbnZhciBXb3JrZXJQcm94eUZldGNoTWFuYWdlciA9IHJlcXVpcmUoJ3dvcmtlci1wcm94eS1mZXRjaC1tYW5hZ2VyLmpzJyk7XHJcbnZhciBXb3JrZXJQcm94eUltYWdlRGVjb2RlciA9IHJlcXVpcmUoJ3dvcmtlci1wcm94eS1pbWFnZS1kZWNvZGVyLmpzJyk7XHJcblxyXG4vKiBnbG9iYWwgY29uc29sZTogZmFsc2UgKi9cclxuLyogZ2xvYmFsIFByb21pc2U6IGZhbHNlICovXHJcblxyXG5JbWFnZURlY29kZXIuYWxpZ25QYXJhbXNUb1RpbGVzQW5kTGV2ZWwgPSBpbWFnZUhlbHBlckZ1bmN0aW9ucy5hbGlnblBhcmFtc1RvVGlsZXNBbmRMZXZlbDtcclxuXHJcbkltYWdlRGVjb2Rlci5mcm9tSW1hZ2UgPSBmdW5jdGlvbiBmcm9tSW1hZ2UoaW1hZ2UsIG9wdGlvbnMpIHtcclxuICAgIHZhciBpc0luZGlyZWN0Q3JlYXRpb25OZWVkZWQgPSBpbWFnZUhlbHBlckZ1bmN0aW9ucy5pc0luZGlyZWN0Q3JlYXRpb25OZWVkZWQoXHJcbiAgICAgICAgaW1hZ2UsICdpbWFnZScsIEltYWdlRGVjb2Rlci5faW1hZ2VFeHBlY3RlZE1ldGhvZHMpO1xyXG4gICAgXHJcbiAgICBpZiAoIWlzSW5kaXJlY3RDcmVhdGlvbk5lZWRlZCB8fCAhaW1hZ2UudXNlV29ya2VyKSB7XHJcbiAgICAgICAgcmV0dXJuIG5ldyBJbWFnZURlY29kZXIoaW1hZ2UsIG9wdGlvbnMpO1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgICByZXR1cm4gbmV3IFdvcmtlclByb3h5SW1hZ2VEZWNvZGVyKGltYWdlLCBvcHRpb25zKTtcclxuICAgIH1cclxufTtcclxuXHJcbkltYWdlRGVjb2Rlci5faW1hZ2VFeHBlY3RlZE1ldGhvZHMgPSBbJ29wZW5lZCcsICdnZXRMZXZlbENhbGN1bGF0b3InLCAnZ2V0RmV0Y2hlcicsICdnZXREZWNvZGVyV29ya2Vyc0lucHV0UmV0cmVpdmVyJ107XHJcblxyXG5mdW5jdGlvbiBJbWFnZURlY29kZXIoaW1hZ2UsIG9wdGlvbnMpIHtcclxuICAgIEltYWdlUGFyYW1zUmV0cmlldmVyUHJveHkuY2FsbCh0aGlzKTtcclxuICAgIFxyXG4gICAgdGhpcy5fb3B0aW9ucyA9IG9wdGlvbnMgfHwge307XHJcbiAgICB0aGlzLl9kZWNvZGVXb3JrZXJzTGltaXQgPSB0aGlzLl9vcHRpb25zLmRlY29kZVdvcmtlcnNMaW1pdCB8fCA1O1xyXG4gICAgXHJcbiAgICB0aGlzLl90aWxlV2lkdGggPSB0aGlzLl9vcHRpb25zLnRpbGVXaWR0aCB8fCAyNTY7XHJcbiAgICB0aGlzLl90aWxlSGVpZ2h0ID0gdGhpcy5fb3B0aW9ucy50aWxlSGVpZ2h0IHx8IDI1NjtcclxuICAgIHRoaXMuX3Nob3dMb2cgPSAhIXRoaXMuX29wdGlvbnMuc2hvd0xvZztcclxuICAgIHRoaXMuX2ZldGNoTWFuYWdlciA9IG51bGw7XHJcbiAgICB0aGlzLl9kZWNvZGVEZXBlbmRlbmN5V29ya2VycyA9IG51bGw7XHJcbiAgICB0aGlzLl9yZXF1ZXN0c0RlY29kZUpvYnNQb29sID0gbnVsbDtcclxuICAgIHRoaXMuX21vdmFibGVzRGVjb2RlSm9ic1Bvb2wgPSBudWxsO1xyXG4gICAgdGhpcy5fbGV2ZWxDYWxjdWxhdG9yID0gbnVsbDtcclxuICAgIHRoaXMuX2ZldGNoUmVxdWVzdElkID0gMDtcclxuICAgIFxyXG4gICAgLyppZiAodGhpcy5fc2hvd0xvZykge1xyXG4gICAgICAgIC8vIE9sZCBJRVxyXG4gICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IHNob3dMb2cgaXMgbm90IHN1cHBvcnRlZCBvbiB0aGlzIGJyb3dzZXInO1xyXG4gICAgfSovXHJcblxyXG4gICAgdGhpcy5fbW92YWJsZVN0YXRlcyA9IFtdO1xyXG4gICAgdGhpcy5fZGVjb2RlcnMgPSBbXTtcclxuICAgIFxyXG4gICAgdGhpcy5fZGVjb2RlU2NoZWR1bGVyID0gbnVsbDtcclxuICAgIHRoaXMuX2RlY29kZVByaW9yaXRpemVyID0gbnVsbDtcclxuICAgIHRoaXMuX3ByaW9yaXRpemVyVHlwZSA9IG51bGw7XHJcblxyXG4gICAgdGhpcy5faW1hZ2UgPSBpbWFnZUhlbHBlckZ1bmN0aW9ucy5nZXRPckNyZWF0ZUluc3RhbmNlKFxyXG4gICAgICAgIGltYWdlLCAnaW1hZ2UnLCBJbWFnZURlY29kZXIuX2ltYWdlRXhwZWN0ZWRNZXRob2RzKTtcclxufVxyXG5cclxuSW1hZ2VEZWNvZGVyLnByb3RvdHlwZSA9IE9iamVjdC5jcmVhdGUoSW1hZ2VQYXJhbXNSZXRyaWV2ZXJQcm94eS5wcm90b3R5cGUpO1xyXG5cclxuSW1hZ2VEZWNvZGVyLnByb3RvdHlwZS5nZXRUaWxlV2lkdGggPSBmdW5jdGlvbiBnZXRUaWxlV2lkdGgoKSB7XHJcbiAgICByZXR1cm4gdGhpcy5fdGlsZVdpZHRoO1xyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVyLnByb3RvdHlwZS5nZXRUaWxlSGVpZ2h0ID0gZnVuY3Rpb24gZ2V0VGlsZUhlaWdodCgpIHtcclxuICAgIHJldHVybiB0aGlzLl90aWxlSGVpZ2h0O1xyXG59O1xyXG4gICAgXHJcbkltYWdlRGVjb2Rlci5wcm90b3R5cGUuc2V0RmV0Y2hQcmlvcml0aXplckRhdGEgPVxyXG4gICAgZnVuY3Rpb24gc2V0RmV0Y2hQcmlvcml0aXplckRhdGEocHJpb3JpdGl6ZXJEYXRhKSB7XHJcblxyXG4gICAgdGhpcy5fdmFsaWRhdGVGZXRjaGVyKCk7XHJcbiAgICBcclxuICAgIHRoaXMuX2ZldGNoTWFuYWdlci5zZXRGZXRjaFByaW9yaXRpemVyRGF0YShcclxuICAgICAgICBwcmlvcml0aXplckRhdGEpO1xyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVyLnByb3RvdHlwZS5zZXREZWNvZGVQcmlvcml0aXplckRhdGEgPVxyXG4gICAgZnVuY3Rpb24gc2V0RGVjb2RlUHJpb3JpdGl6ZXJEYXRhKHByaW9yaXRpemVyRGF0YSkge1xyXG5cclxuICAgIHRoaXMuX3ZhbGlkYXRlRGVjb2RlcigpO1xyXG4gICAgXHJcbiAgICBpZiAodGhpcy5fZGVjb2RlUHJpb3JpdGl6ZXIgPT09IG51bGwpIHtcclxuICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBObyBkZWNvZGUgcHJpb3JpdGl6ZXIgaGFzIGJlZW4gc2V0JztcclxuICAgIH1cclxuICAgIFxyXG4gICAgaWYgKHRoaXMuX3Nob3dMb2cpIHtcclxuICAgICAgICBjb25zb2xlLmxvZygnc2V0RGVjb2RlUHJpb3JpdGl6ZXJEYXRhKCcgKyBwcmlvcml0aXplckRhdGEgKyAnKScpO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICB2YXIgcHJpb3JpdGl6ZXJEYXRhTW9kaWZpZWQgPSBPYmplY3QuY3JlYXRlKHByaW9yaXRpemVyRGF0YSk7XHJcbiAgICBwcmlvcml0aXplckRhdGFNb2RpZmllZC5pbWFnZSA9IHRoaXM7XHJcbiAgICBcclxuICAgIHRoaXMuX2RlY29kZVByaW9yaXRpemVyLnNldFByaW9yaXRpemVyRGF0YShwcmlvcml0aXplckRhdGFNb2RpZmllZCk7XHJcbn07XHJcblxyXG5JbWFnZURlY29kZXIucHJvdG90eXBlLnNldERlY29kZVByaW9yaXRpemVyVHlwZSA9IGZ1bmN0aW9uIHNldFByaW9yaXRpemVyVHlwZShwcmlvcml0aXplclR5cGUpIHtcclxuICAgIGlmICh0aGlzLl9kZWNvZGVTY2hlZHVsZXIgIT09IG51bGwpIHtcclxuICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBDYW5ub3Qgc2V0IHByaW9yaXRpemVyIHR5cGUgYXQgdGhpcyB0aW1lJztcclxuICAgIH1cclxuICAgIFxyXG4gICAgdGhpcy5fcHJpb3JpdGl6ZXJUeXBlID0gcHJpb3JpdGl6ZXJUeXBlO1xyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVyLnByb3RvdHlwZS5zZXRGZXRjaFByaW9yaXRpemVyVHlwZSA9IGZ1bmN0aW9uIHNldFByaW9yaXRpemVyVHlwZShwcmlvcml0aXplclR5cGUpIHtcclxuICAgIHRoaXMuX3ZhbGlkYXRlRmV0Y2hlcigpO1xyXG4gICAgdGhpcy5fZmV0Y2hNYW5hZ2VyLnNldFByaW9yaXRpemVyVHlwZShwcmlvcml0aXplclR5cGUpO1xyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVyLnByb3RvdHlwZS5vcGVuID0gZnVuY3Rpb24gb3Blbih1cmwpIHtcclxuICAgIHRoaXMuX3ZhbGlkYXRlRmV0Y2hlcigpO1xyXG5cclxuICAgIHZhciBzZWxmID0gdGhpcztcclxuICAgIHZhciBwcm9taXNlID0gdGhpcy5fZmV0Y2hNYW5hZ2VyLm9wZW4odXJsKTtcclxuICAgIHJldHVybiBwcm9taXNlLnRoZW4oZnVuY3Rpb24gKHNpemVzUGFyYW1zKSB7XHJcbiAgICAgICAgc2VsZi5faW50ZXJuYWxTaXplc1BhcmFtcyA9IHNpemVzUGFyYW1zO1xyXG4gICAgICAgIHNlbGYuX2ltYWdlLm9wZW5lZChzZWxmKTtcclxuICAgICAgICBzZWxmLl9sZXZlbENhbGN1bGF0b3IgPSBzZWxmLl9pbWFnZS5nZXRMZXZlbENhbGN1bGF0b3IoKTtcclxuICAgICAgICBpbWFnZUhlbHBlckZ1bmN0aW9ucy5lbnN1cmVMZXZlbENhbGN1bGF0b3Ioc2VsZi5fbGV2ZWxDYWxjdWxhdG9yKTtcclxuICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgICBzaXplc1BhcmFtczogc2l6ZXNQYXJhbXMsXHJcbiAgICAgICAgICAgIGFwcGxpY2F0aXZlVGlsZVdpZHRoIDogc2VsZi5nZXRUaWxlV2lkdGgoKSxcclxuICAgICAgICAgICAgYXBwbGljYXRpdmVUaWxlSGVpZ2h0OiBzZWxmLmdldFRpbGVIZWlnaHQoKVxyXG4gICAgICAgIH07XHJcbiAgICB9KTtcclxufTtcclxuXHJcbkltYWdlRGVjb2Rlci5wcm90b3R5cGUuY2xvc2UgPSBmdW5jdGlvbiBjbG9zZSgpIHtcclxuICAgIHRoaXMuX3ZhbGlkYXRlRmV0Y2hlcigpO1xyXG4gICAgdGhpcy5fdmFsaWRhdGVEZWNvZGVyKCk7XHJcbiAgICBcclxuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgdGhpcy5fZGVjb2RlcnMubGVuZ3RoOyArK2kpIHtcclxuICAgICAgICB0aGlzLl9kZWNvZGVyc1tpXS50ZXJtaW5hdGUoKTtcclxuICAgIH1cclxuXHJcbiAgICB2YXIgc2VsZiA9IHRoaXM7XHJcbiAgICByZXR1cm4gdGhpcy5fZmV0Y2hNYW5hZ2VyLmNsb3NlKCkudGhlbihmdW5jdGlvbigpIHtcclxuICAgICAgICBzZWxmLl9kZWNvZGVEZXBlbmRlbmN5V29ya2Vycy50ZXJtaW5hdGVJbmFjdGl2ZVdvcmtlcnMoKTtcclxuICAgIH0pO1xyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVyLnByb3RvdHlwZS5vbkZldGNoZXJFdmVudCA9IGZ1bmN0aW9uIG9uRmV0Y2hlckV2ZW50KGV2ZW50LCBjYWxsYmFjaykge1xyXG4gICAgdGhpcy5fdmFsaWRhdGVGZXRjaGVyKCk7XHJcbiAgICB0aGlzLl9mZXRjaE1hbmFnZXIub24oZXZlbnQsIGNhbGxiYWNrKTtcclxufTtcclxuXHJcbkltYWdlRGVjb2Rlci5wcm90b3R5cGUuY3JlYXRlTW92YWJsZUZldGNoID0gZnVuY3Rpb24gY3JlYXRlTW92YWJsZUZldGNoKCkge1xyXG4gICAgdGhpcy5fdmFsaWRhdGVGZXRjaGVyKCk7XHJcbiAgICB0aGlzLmdldEltYWdlUGFyYW1zKCk7XHJcbiAgICBcclxuICAgIHZhciBzZWxmID0gdGhpcztcclxuICAgIFxyXG4gICAgcmV0dXJuIHRoaXMuX2ZldGNoTWFuYWdlci5jcmVhdGVNb3ZhYmxlRmV0Y2goKS50aGVuKGZ1bmN0aW9uKG1vdmFibGVIYW5kbGUpIHtcclxuICAgICAgICBzZWxmLl9tb3ZhYmxlU3RhdGVzW21vdmFibGVIYW5kbGVdID0ge1xyXG4gICAgICAgICAgICBkZWNvZGVKb2JzTGlzdGVuZXJIYW5kbGU6IG51bGxcclxuICAgICAgICB9O1xyXG4gICAgICAgIFxyXG4gICAgICAgIHJldHVybiBtb3ZhYmxlSGFuZGxlO1xyXG4gICAgfSk7XHJcbn07XHJcblxyXG5JbWFnZURlY29kZXIucHJvdG90eXBlLnJlcXVlc3RQaXhlbHMgPSBmdW5jdGlvbiByZXF1ZXN0UGl4ZWxzKGltYWdlUGFydFBhcmFtcykge1xyXG4gICAgdGhpcy5fdmFsaWRhdGVEZWNvZGVyKCk7XHJcbiAgICB0aGlzLmdldEltYWdlUGFyYW1zKCk7XHJcbiAgICBcclxuICAgIHZhciByZXNvbHZlLCByZWplY3Q7XHJcbiAgICB2YXIgYWNjdW11bGF0ZWRSZXN1bHQgPSB7fTtcclxuICAgIFxyXG4gICAgdmFyIHNlbGYgPSB0aGlzO1xyXG4gICAgdmFyIHByb21pc2UgPSBuZXcgUHJvbWlzZShzdGFydFByb21pc2UpO1xyXG4gICAgcmV0dXJuIHByb21pc2U7XHJcbiAgICBcclxuICAgIGZ1bmN0aW9uIHN0YXJ0UHJvbWlzZShyZXNvbHZlXywgcmVqZWN0Xykge1xyXG4gICAgICAgIHJlc29sdmUgPSByZXNvbHZlXztcclxuICAgICAgICByZWplY3QgPSByZWplY3RfO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHNlbGYuX3JlcXVlc3RzRGVjb2RlSm9ic1Bvb2wuZm9ya0RlY29kZUpvYnMoXHJcbiAgICAgICAgICAgIGltYWdlUGFydFBhcmFtcyxcclxuICAgICAgICAgICAgaW50ZXJuYWxDYWxsYmFjayxcclxuICAgICAgICAgICAgaW50ZXJuYWxUZXJtaW5hdGVkQ2FsbGJhY2spO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBmdW5jdGlvbiBpbnRlcm5hbENhbGxiYWNrKGRlY29kZWREYXRhKSB7XHJcbiAgICAgICAgc2VsZi5fY29weVBpeGVsc1RvQWNjdW11bGF0ZWRSZXN1bHQoZGVjb2RlZERhdGEsIGFjY3VtdWxhdGVkUmVzdWx0KTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgZnVuY3Rpb24gaW50ZXJuYWxUZXJtaW5hdGVkQ2FsbGJhY2soaXNBYm9ydGVkKSB7XHJcbiAgICAgICAgaWYgKGlzQWJvcnRlZCkge1xyXG4gICAgICAgICAgICByZWplY3QoJ1JlcXVlc3Qgd2FzIGFib3J0ZWQgZHVlIHRvIGZhaWx1cmUgb3IgcHJpb3JpdHknKTtcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICByZXNvbHZlKGFjY3VtdWxhdGVkUmVzdWx0KTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbn07XHJcblxyXG5JbWFnZURlY29kZXIucHJvdG90eXBlLnJlcXVlc3RQaXhlbHNQcm9ncmVzc2l2ZSA9IGZ1bmN0aW9uIHJlcXVlc3RQaXhlbHNQcm9ncmVzc2l2ZShcclxuICAgIGltYWdlUGFydFBhcmFtcyxcclxuICAgIGNhbGxiYWNrLFxyXG4gICAgdGVybWluYXRlZENhbGxiYWNrLFxyXG4gICAgaW1hZ2VQYXJ0UGFyYW1zTm90TmVlZGVkLFxyXG4gICAgbW92YWJsZUhhbmRsZSkge1xyXG4gICAgXHJcbiAgICB0aGlzLl92YWxpZGF0ZURlY29kZXIoKTtcclxuICAgIHRoaXMuZ2V0SW1hZ2VQYXJhbXMoKTtcclxuICAgIFxyXG4gICAgdmFyIG1vdmFibGVTdGF0ZSA9IG51bGw7XHJcbiAgICB2YXIgZGVjb2RlSm9ic1Bvb2w7XHJcbiAgICBpZiAobW92YWJsZUhhbmRsZSA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgZGVjb2RlSm9ic1Bvb2wgPSB0aGlzLl9yZXF1ZXN0c0RlY29kZUpvYnNQb29sO1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgICBkZWNvZGVKb2JzUG9vbCA9IHRoaXMuX21vdmFibGVzRGVjb2RlSm9ic1Bvb2w7XHJcbiAgICAgICAgXHJcbiAgICAgICAgbW92YWJsZVN0YXRlID0gdGhpcy5fbW92YWJsZVN0YXRlc1ttb3ZhYmxlSGFuZGxlXTtcclxuICAgICAgICBcclxuICAgICAgICBpZiAobW92YWJsZVN0YXRlID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogTW92YWJsZSBoYW5kbGUgZG9lcyBub3QgZXhpc3QnO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuICAgIFxyXG4gICAgdmFyIGxpc3RlbmVySGFuZGxlID0gZGVjb2RlSm9ic1Bvb2wuZm9ya0RlY29kZUpvYnMoXHJcbiAgICAgICAgaW1hZ2VQYXJ0UGFyYW1zLFxyXG4gICAgICAgIGNhbGxiYWNrLFxyXG4gICAgICAgIHRlcm1pbmF0ZWRDYWxsYmFjayB8fCBmdW5jdGlvbigpIHsgfSxcclxuICAgICAgICBpbWFnZVBhcnRQYXJhbXNOb3ROZWVkZWQpO1xyXG4gICAgICAgIFxyXG4gICAgaWYgKG1vdmFibGVIYW5kbGUgIT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIGlmIChtb3ZhYmxlU3RhdGUuZGVjb2RlSm9ic0xpc3RlbmVySGFuZGxlICE9PSBudWxsKSB7XHJcbiAgICAgICAgICAgIC8vIFVucmVnaXN0ZXIgYWZ0ZXIgZm9ya2VkIG5ldyBqb2JzLCBzbyBubyB0ZXJtaW5hdGlvbiBvY2N1cnMgbWVhbndoaWxlXHJcbiAgICAgICAgICAgIGRlY29kZUpvYnNQb29sLnVucmVnaXN0ZXJGb3JrZWRKb2JzKFxyXG4gICAgICAgICAgICAgICAgbW92YWJsZVN0YXRlLmRlY29kZUpvYnNMaXN0ZW5lckhhbmRsZSk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIG1vdmFibGVTdGF0ZS5kZWNvZGVKb2JzTGlzdGVuZXJIYW5kbGUgPSBsaXN0ZW5lckhhbmRsZTtcclxuICAgICAgICB0aGlzLl9mZXRjaE1hbmFnZXIubW92ZUZldGNoKG1vdmFibGVIYW5kbGUsIGltYWdlUGFydFBhcmFtcyk7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICAgIHRoaXMuX2ZldGNoTWFuYWdlci5jcmVhdGVSZXF1ZXN0KCsrdGhpcy5fZmV0Y2hSZXF1ZXN0SWQsIGltYWdlUGFydFBhcmFtcyk7XHJcbiAgICB9XHJcbn07XHJcblxyXG5JbWFnZURlY29kZXIucHJvdG90eXBlLmdldExldmVsQ2FsY3VsYXRvciA9IGZ1bmN0aW9uIGdldExldmVsQ2FsY3VsYXRvcigpIHtcclxuICAgIHJldHVybiB0aGlzLl9sZXZlbENhbGN1bGF0b3I7XHJcbn07XHJcblxyXG4vLyBJbnRlcm5hbCBNZXRob2RzXHJcblxyXG5JbWFnZURlY29kZXIucHJvdG90eXBlLl92YWxpZGF0ZUZldGNoZXIgPSBmdW5jdGlvbiB2YWxpZGF0ZUZldGNoZXIoKSB7XHJcbiAgICBpZiAodGhpcy5fZmV0Y2hNYW5hZ2VyICE9PSBudWxsKSB7XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG5cclxuICAgIHZhciBmZXRjaGVyID0gdGhpcy5faW1hZ2UuZ2V0RmV0Y2hlcigpO1xyXG4gICAgdmFyIGlzSW5kaXJlY3RDcmVhdGlvbk5lZWRlZCA9IGltYWdlSGVscGVyRnVuY3Rpb25zLmlzSW5kaXJlY3RDcmVhdGlvbk5lZWRlZChcclxuICAgICAgICBmZXRjaGVyLCAnZmV0Y2hlcicsIEZldGNoTWFuYWdlci5mZXRjaGVyRXhwZWN0ZWRNZXRob2RzKTtcclxuICAgIFxyXG4gICAgaWYgKCFpc0luZGlyZWN0Q3JlYXRpb25OZWVkZWQgfHwgIWZldGNoZXIudXNlV29ya2VyKSB7XHJcbiAgICAgICAgdGhpcy5fZmV0Y2hNYW5hZ2VyID0gbmV3IEZldGNoTWFuYWdlcihmZXRjaGVyLCB0aGlzLl9vcHRpb25zKTtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgICAgdGhpcy5fZmV0Y2hNYW5hZ2VyID0gbmV3IFdvcmtlclByb3h5RmV0Y2hNYW5hZ2VyKFxyXG4gICAgICAgICAgICBmZXRjaGVyLCB0aGlzLl9vcHRpb25zKTtcclxuICAgIH1cclxufTtcclxuXHJcbkltYWdlRGVjb2Rlci5wcm90b3R5cGUuX3ZhbGlkYXRlRGVjb2RlciA9IGZ1bmN0aW9uIHZhbGlkYXRlQ29tcG9uZW50cygpIHtcclxuICAgIGlmICh0aGlzLl9kZWNvZGVEZXBlbmRlbmN5V29ya2VycyAhPT0gbnVsbCkge1xyXG4gICAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIFxyXG4gICAgdmFyIGRlY29kZVNjaGVkdWxpbmcgPSBpbWFnZUhlbHBlckZ1bmN0aW9ucy5jcmVhdGVQcmlvcml0aXplcihcclxuICAgICAgICB0aGlzLl9kZWNvZGVXb3JrZXJzTGltaXQsXHJcbiAgICAgICAgdGhpcy5fcHJpb3JpdGl6ZXJUeXBlLFxyXG4gICAgICAgICdkZWNvZGUnLFxyXG4gICAgICAgIHRoaXMuX3Nob3dMb2cpO1xyXG4gICAgXHJcbiAgICBpZiAoZGVjb2RlU2NoZWR1bGluZy5wcmlvcml0aXplciAhPT0gbnVsbCkge1xyXG4gICAgICAgIHRoaXMuX2RlY29kZVNjaGVkdWxlciA9IG5ldyBkZXBlbmRlbmN5V29ya2Vycy5EZXBlbmRlbmN5V29ya2Vyc1Rhc2tTY2hlZHVsZXIoXHJcbiAgICAgICAgICAgIHRoaXMuX2RlY29kZVdvcmtlcnNMaW1pdCwgZGVjb2RlU2NoZWR1bGluZy5zY2hlZHVsZXJPcHRpb25zKTtcclxuICAgICAgICB0aGlzLl9kZWNvZGVQcmlvcml0aXplciA9IGRlY29kZVNjaGVkdWxpbmcucHJpb3JpdGl6ZXI7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICAgIHRoaXMuX2RlY29kZVNjaGVkdWxlciA9IG5ldyByZXNvdXJjZVNjaGVkdWxlci5MaWZvU2NoZWR1bGVyKFxyXG4gICAgICAgICAgICBjcmVhdGVEdW1teVJlc291cmNlLFxyXG4gICAgICAgICAgICB0aGlzLl9kZWNvZGVXb3JrZXJzTGltaXQsXHJcbiAgICAgICAgICAgIGRlY29kZVNjaGVkdWxpbmcuc2NoZWR1bGVyT3B0aW9ucyk7XHJcbiAgICAgICAgdGhpcy5fZGVjb2RlUHJpb3JpdGl6ZXIgPSBudWxsO1xyXG4gICAgfVxyXG5cclxuICAgIHZhciBpbnB1dFJldHJlaXZlciA9IHRoaXMuX2ltYWdlLmdldERlY29kZXJXb3JrZXJzSW5wdXRSZXRyZWl2ZXIoKTtcclxuICAgIHRoaXMuX2RlY29kZURlcGVuZGVuY3lXb3JrZXJzID0gbmV3IGRlcGVuZGVuY3lXb3JrZXJzLlNjaGVkdWxlckRlcGVuZGVuY3lXb3JrZXJzKFxyXG4gICAgICAgIHRoaXMuX2RlY29kZVNjaGVkdWxlciwgaW5wdXRSZXRyZWl2ZXIpO1xyXG4gICAgXHJcbiAgICB0aGlzLl9yZXF1ZXN0c0RlY29kZUpvYnNQb29sID0gbmV3IERlY29kZUpvYnNQb29sKFxyXG4gICAgICAgIHRoaXMuX2RlY29kZURlcGVuZGVuY3lXb3JrZXJzLFxyXG4gICAgICAgIHRoaXMuX2RlY29kZVByaW9yaXRpemVyLFxyXG4gICAgICAgIHRoaXMuX3RpbGVXaWR0aCxcclxuICAgICAgICB0aGlzLl90aWxlSGVpZ2h0KTtcclxuICAgICAgICBcclxuICAgIHRoaXMuX21vdmFibGVzRGVjb2RlSm9ic1Bvb2wgPSBuZXcgRGVjb2RlSm9ic1Bvb2woXHJcbiAgICAgICAgdGhpcy5fZGVjb2RlRGVwZW5kZW5jeVdvcmtlcnMsXHJcbiAgICAgICAgdGhpcy5fZGVjb2RlUHJpb3JpdGl6ZXIsXHJcbiAgICAgICAgdGhpcy5fdGlsZVdpZHRoLFxyXG4gICAgICAgIHRoaXMuX3RpbGVIZWlnaHQpO1xyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVyLnByb3RvdHlwZS5fZ2V0SW1hZ2VQYXJhbXNJbnRlcm5hbCA9IGZ1bmN0aW9uIGdldEltYWdlUGFyYW1zSW50ZXJuYWwoKSB7XHJcbiAgICByZXR1cm4gdGhpcy5faW50ZXJuYWxTaXplc1BhcmFtcztcclxufTtcclxuXHJcbkltYWdlRGVjb2Rlci5wcm90b3R5cGUuX2NvcHlQaXhlbHNUb0FjY3VtdWxhdGVkUmVzdWx0ID1cclxuICAgIGZ1bmN0aW9uIGNvcHlQaXhlbHNUb0FjY3VtdWxhdGVkUmVzdWx0KGRlY29kZWREYXRhLCBhY2N1bXVsYXRlZFJlc3VsdCkge1xyXG4gICAgICAgIFxyXG4gICAgdmFyIGJ5dGVzUGVyUGl4ZWwgPSA0O1xyXG4gICAgdmFyIHNvdXJjZVN0cmlkZSA9IGRlY29kZWREYXRhLndpZHRoICogYnl0ZXNQZXJQaXhlbDtcclxuICAgIHZhciB0YXJnZXRTdHJpZGUgPVxyXG4gICAgICAgIGRlY29kZWREYXRhLm9yaWdpbmFsUmVxdWVzdFdpZHRoICogYnl0ZXNQZXJQaXhlbDtcclxuICAgIFxyXG4gICAgaWYgKGFjY3VtdWxhdGVkUmVzdWx0LnBpeGVscyA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgdmFyIHNpemUgPVxyXG4gICAgICAgICAgICB0YXJnZXRTdHJpZGUgKiBkZWNvZGVkRGF0YS5vcmlnaW5hbFJlcXVlc3RIZWlnaHQ7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgIGFjY3VtdWxhdGVkUmVzdWx0LnBpeGVscyA9IG5ldyBVaW50OEFycmF5KHNpemUpO1xyXG4gICAgICAgIGFjY3VtdWxhdGVkUmVzdWx0LnhJbk9yaWdpbmFsUmVxdWVzdCA9IDA7XHJcbiAgICAgICAgYWNjdW11bGF0ZWRSZXN1bHQueUluT3JpZ2luYWxSZXF1ZXN0ID0gMDtcclxuICAgICAgICBcclxuICAgICAgICB2YXIgd2lkdGggPSBkZWNvZGVkRGF0YS5vcmlnaW5hbFJlcXVlc3RXaWR0aDtcclxuICAgICAgICBhY2N1bXVsYXRlZFJlc3VsdC5vcmlnaW5hbFJlcXVlc3RXaWR0aCA9IHdpZHRoO1xyXG4gICAgICAgIGFjY3VtdWxhdGVkUmVzdWx0LndpZHRoID0gd2lkdGg7XHJcblxyXG4gICAgICAgIHZhciBoZWlnaHQgPSBkZWNvZGVkRGF0YS5vcmlnaW5hbFJlcXVlc3RIZWlnaHQ7XHJcbiAgICAgICAgYWNjdW11bGF0ZWRSZXN1bHQub3JpZ2luYWxSZXF1ZXN0SGVpZ2h0ID0gaGVpZ2h0O1xyXG4gICAgICAgIGFjY3VtdWxhdGVkUmVzdWx0LmhlaWdodCA9IGhlaWdodDtcclxuICAgIH1cclxuICAgIFxyXG4gICAgYWNjdW11bGF0ZWRSZXN1bHQuYWxsUmVsZXZhbnRCeXRlc0xvYWRlZCA9XHJcbiAgICAgICAgZGVjb2RlZERhdGEuYWxsUmVsZXZhbnRCeXRlc0xvYWRlZDtcclxuXHJcbiAgICB2YXIgc291cmNlT2Zmc2V0ID0gMDtcclxuICAgIHZhciB0YXJnZXRPZmZzZXQgPVxyXG4gICAgICAgIGRlY29kZWREYXRhLnhJbk9yaWdpbmFsUmVxdWVzdCAqIGJ5dGVzUGVyUGl4ZWwgKyBcclxuICAgICAgICBkZWNvZGVkRGF0YS55SW5PcmlnaW5hbFJlcXVlc3QgKiB0YXJnZXRTdHJpZGU7XHJcbiAgICBcclxuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgZGVjb2RlZERhdGEuaGVpZ2h0OyArK2kpIHtcclxuICAgICAgICB2YXIgc291cmNlU3ViQXJyYXkgPSBkZWNvZGVkRGF0YS5waXhlbHMuc3ViYXJyYXkoXHJcbiAgICAgICAgICAgIHNvdXJjZU9mZnNldCwgc291cmNlT2Zmc2V0ICsgc291cmNlU3RyaWRlKTtcclxuICAgICAgICBcclxuICAgICAgICBhY2N1bXVsYXRlZFJlc3VsdC5waXhlbHMuc2V0KHNvdXJjZVN1YkFycmF5LCB0YXJnZXRPZmZzZXQpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHNvdXJjZU9mZnNldCArPSBzb3VyY2VTdHJpZGU7XHJcbiAgICAgICAgdGFyZ2V0T2Zmc2V0ICs9IHRhcmdldFN0cmlkZTtcclxuICAgIH1cclxufTtcclxuXHJcbmZ1bmN0aW9uIGNyZWF0ZUR1bW15UmVzb3VyY2UoKVxyXG57XHJcbn0iLCIndXNlIHN0cmljdCc7XHJcblxyXG52YXIgSW1hZ2VWaWV3ZXIgPSByZXF1aXJlKCdpbWFnZS1kZWNvZGVyLXZpZXdlci5qcycpO1xyXG52YXIgY2FsY3VsYXRlTGVhZmxldEZydXN0dW0gPSByZXF1aXJlKCdsZWFmbGV0LWZydXN0dW0tY2FsY3VsYXRvci5qcycpO1xyXG5cclxuLyogZ2xvYmFsIEw6IGZhbHNlICovXHJcbi8qIGdsb2JhbCBzZWxmOiBmYWxzZSAqL1xyXG5cclxuaWYgKHNlbGYuTCkge1xyXG4gICAgbW9kdWxlLmV4cG9ydHMgPSBMLkNsYXNzLmV4dGVuZChjcmVhdGVJbWFnZURlY29kZXJSZWdpb25MYXllckZ1bmN0aW9ucygpKTtcclxufSBlbHNlIHtcclxuICAgIG1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IENhbm5vdCBpbnN0YW50aWF0ZSBJbWFnZURlY29kZXJSZWdpb25MYXllcjogTm8gTGVhZmxldCBuYW1lc3BhY2UgaW4gc2NvcGUnKTtcclxuICAgIH07XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGNyZWF0ZUltYWdlRGVjb2RlclJlZ2lvbkxheWVyRnVuY3Rpb25zKCkge1xyXG4gICAgcmV0dXJuIHtcclxuICAgICAgICBpbml0aWFsaXplOiBmdW5jdGlvbiBpbml0aWFsaXplKG9wdGlvbnMpIHtcclxuICAgICAgICAgICAgdGhpcy5fb3B0aW9ucyA9IG9wdGlvbnMgfHwge307XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBpZiAodGhpcy5fb3B0aW9ucy5sYXRMbmdCb3VuZHMgIT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgICAgICAgICAgdGhpcy5fb3B0aW9ucyA9IHt9O1xyXG4gICAgICAgICAgICAgICAgZm9yICh2YXIgbWVtYmVyIGluIG9wdGlvbnMpIHtcclxuICAgICAgICAgICAgICAgICAgICB0aGlzLl9vcHRpb25zW21lbWJlcl0gPSBvcHRpb25zW21lbWJlcl07XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB0aGlzLl9vcHRpb25zLmNhcnRvZ3JhcGhpY0JvdW5kcyA9IHtcclxuICAgICAgICAgICAgICAgICAgICB3ZXN0OiBvcHRpb25zLmxhdExuZ0JvdW5kcy5nZXRXZXN0KCksXHJcbiAgICAgICAgICAgICAgICAgICAgZWFzdDogb3B0aW9ucy5sYXRMbmdCb3VuZHMuZ2V0RWFzdCgpLFxyXG4gICAgICAgICAgICAgICAgICAgIHNvdXRoOiBvcHRpb25zLmxhdExuZ0JvdW5kcy5nZXRTb3V0aCgpLFxyXG4gICAgICAgICAgICAgICAgICAgIG5vcnRoOiBvcHRpb25zLmxhdExuZ0JvdW5kcy5nZXROb3J0aCgpXHJcbiAgICAgICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICB0aGlzLl90YXJnZXRDYW52YXMgPSBudWxsO1xyXG4gICAgICAgICAgICB0aGlzLl9jYW52YXNQb3NpdGlvbiA9IG51bGw7XHJcbiAgICAgICAgICAgIHRoaXMuX2NhbnZhc1VwZGF0ZWRDYWxsYmFja0JvdW5kID0gdGhpcy5fY2FudmFzVXBkYXRlZENhbGxiYWNrLmJpbmQodGhpcyk7XHJcbiAgICAgICAgICAgIHRoaXMuX2ltYWdlVmlld2VyID0gbnVsbDtcclxuICAgICAgICAgICAgdGhpcy5fZXhjZXB0aW9uQ2FsbGJhY2sgPSBudWxsO1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgXHJcbiAgICAgICAgc2V0RXhjZXB0aW9uQ2FsbGJhY2s6IGZ1bmN0aW9uIHNldEV4Y2VwdGlvbkNhbGxiYWNrKGV4Y2VwdGlvbkNhbGxiYWNrKSB7XHJcbiAgICAgICAgICAgIHRoaXMuX2V4Y2VwdGlvbkNhbGxiYWNrID0gZXhjZXB0aW9uQ2FsbGJhY2s7XHJcbiAgICAgICAgICAgIGlmICh0aGlzLl9pbWFnZVZpZXdlciAhPT0gbnVsbCkge1xyXG4gICAgICAgICAgICAgICAgdGhpcy5faW1hZ2VWaWV3ZXIuc2V0RXhjZXB0aW9uQ2FsbGJhY2soZXhjZXB0aW9uQ2FsbGJhY2spO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfSxcclxuICAgICAgICBcclxuICAgICAgICBfY3JlYXRlSW1hZ2U6IGZ1bmN0aW9uIGNyZWF0ZUltYWdlKCkge1xyXG4gICAgICAgICAgICBpZiAodGhpcy5faW1hZ2VWaWV3ZXIgPT09IG51bGwpIHtcclxuICAgICAgICAgICAgICAgIHRoaXMuX2ltYWdlVmlld2VyID0gbmV3IEltYWdlVmlld2VyKFxyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX29wdGlvbnMuaW1hZ2VEZWNvZGVyLFxyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX2NhbnZhc1VwZGF0ZWRDYWxsYmFja0JvdW5kLFxyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX29wdGlvbnMpO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICBpZiAodGhpcy5fZXhjZXB0aW9uQ2FsbGJhY2sgIT09IG51bGwpIHtcclxuICAgICAgICAgICAgICAgICAgICB0aGlzLl9pbWFnZVZpZXdlci5zZXRFeGNlcHRpb25DYWxsYmFjayh0aGlzLl9leGNlcHRpb25DYWxsYmFjayk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIHRoaXMuX2ltYWdlVmlld2VyLm9wZW4odGhpcy5fb3B0aW9ucy51cmwpLmNhdGNoKHRoaXMuX2V4Y2VwdGlvbkNhbGxiYWNrKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH0sXHJcblxyXG4gICAgICAgIG9uQWRkOiBmdW5jdGlvbiBvbkFkZChtYXApIHtcclxuICAgICAgICAgICAgaWYgKHRoaXMuX21hcCAhPT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBDYW5ub3QgYWRkIHRoaXMgbGF5ZXIgdG8gdHdvIG1hcHMnO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICB0aGlzLl9tYXAgPSBtYXA7XHJcbiAgICAgICAgICAgIHRoaXMuX2NyZWF0ZUltYWdlKCk7XHJcblxyXG4gICAgICAgICAgICAvLyBjcmVhdGUgYSBET00gZWxlbWVudCBhbmQgcHV0IGl0IGludG8gb25lIG9mIHRoZSBtYXAgcGFuZXNcclxuICAgICAgICAgICAgdGhpcy5fdGFyZ2V0Q2FudmFzID0gTC5Eb21VdGlsLmNyZWF0ZShcclxuICAgICAgICAgICAgICAgICdjYW52YXMnLCAnaW1hZ2UtZGVjb2Rlci1sYXllci1jYW52YXMgbGVhZmxldC16b29tLWFuaW1hdGVkJyk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICB0aGlzLl9pbWFnZVZpZXdlci5zZXRUYXJnZXRDYW52YXModGhpcy5fdGFyZ2V0Q2FudmFzKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHRoaXMuX2NhbnZhc1Bvc2l0aW9uID0gbnVsbDtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBtYXAuZ2V0UGFuZXMoKS5tYXBQYW5lLmFwcGVuZENoaWxkKHRoaXMuX3RhcmdldENhbnZhcyk7XHJcblxyXG4gICAgICAgICAgICAvLyBhZGQgYSB2aWV3cmVzZXQgZXZlbnQgbGlzdGVuZXIgZm9yIHVwZGF0aW5nIGxheWVyJ3MgcG9zaXRpb24sIGRvIHRoZSBsYXR0ZXJcclxuICAgICAgICAgICAgbWFwLm9uKCd2aWV3cmVzZXQnLCB0aGlzLl9tb3ZlZCwgdGhpcyk7XHJcbiAgICAgICAgICAgIG1hcC5vbignbW92ZScsIHRoaXMuX21vdmVkLCB0aGlzKTtcclxuXHJcbiAgICAgICAgICAgIGlmIChMLkJyb3dzZXIuYW55M2QpIHtcclxuICAgICAgICAgICAgICAgIG1hcC5vbignem9vbWFuaW0nLCB0aGlzLl9hbmltYXRlWm9vbSwgdGhpcyk7XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIHRoaXMuX21vdmVkKCk7XHJcbiAgICAgICAgfSxcclxuXHJcbiAgICAgICAgb25SZW1vdmU6IGZ1bmN0aW9uIG9uUmVtb3ZlKG1hcCkge1xyXG4gICAgICAgICAgICBpZiAobWFwICE9PSB0aGlzLl9tYXApIHtcclxuICAgICAgICAgICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IFJlbW92ZWQgZnJvbSB3cm9uZyBtYXAnO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBtYXAub2ZmKCd2aWV3cmVzZXQnLCB0aGlzLl9tb3ZlZCwgdGhpcyk7XHJcbiAgICAgICAgICAgIG1hcC5vZmYoJ21vdmUnLCB0aGlzLl9tb3ZlZCwgdGhpcyk7XHJcbiAgICAgICAgICAgIG1hcC5vZmYoJ3pvb21hbmltJywgdGhpcy5fYW5pbWF0ZVpvb20sIHRoaXMpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gcmVtb3ZlIGxheWVyJ3MgRE9NIGVsZW1lbnRzIGFuZCBsaXN0ZW5lcnNcclxuICAgICAgICAgICAgbWFwLmdldFBhbmVzKCkubWFwUGFuZS5yZW1vdmVDaGlsZCh0aGlzLl90YXJnZXRDYW52YXMpO1xyXG4gICAgICAgICAgICB0aGlzLl90YXJnZXRDYW52YXMgPSBudWxsO1xyXG4gICAgICAgICAgICB0aGlzLl9jYW52YXNQb3NpdGlvbiA9IG51bGw7XHJcblxyXG4gICAgICAgICAgICB0aGlzLl9tYXAgPSB1bmRlZmluZWQ7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICB0aGlzLl9pbWFnZVZpZXdlci5jbG9zZSgpO1xyXG4gICAgICAgICAgICB0aGlzLl9pbWFnZVZpZXdlciA9IG51bGw7XHJcbiAgICAgICAgfSxcclxuICAgICAgICBcclxuICAgICAgICBfbW92ZWQ6IGZ1bmN0aW9uICgpIHtcclxuICAgICAgICAgICAgdGhpcy5fbW92ZUNhbnZhc2VzKCk7XHJcblxyXG4gICAgICAgICAgICB2YXIgZnJ1c3R1bURhdGEgPSBjYWxjdWxhdGVMZWFmbGV0RnJ1c3R1bSh0aGlzLl9tYXApO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgdGhpcy5faW1hZ2VWaWV3ZXIudXBkYXRlVmlld0FyZWEoZnJ1c3R1bURhdGEpO1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgXHJcbiAgICAgICAgX2NhbnZhc1VwZGF0ZWRDYWxsYmFjazogZnVuY3Rpb24gY2FudmFzVXBkYXRlZENhbGxiYWNrKG5ld1Bvc2l0aW9uKSB7XHJcbiAgICAgICAgICAgIGlmIChuZXdQb3NpdGlvbiAhPT0gbnVsbCkge1xyXG4gICAgICAgICAgICAgICAgdGhpcy5fY2FudmFzUG9zaXRpb24gPSBuZXdQb3NpdGlvbjtcclxuICAgICAgICAgICAgICAgIHRoaXMuX21vdmVDYW52YXNlcygpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfSxcclxuICAgICAgICBcclxuICAgICAgICBfbW92ZUNhbnZhc2VzOiBmdW5jdGlvbiBtb3ZlQ2FudmFzZXMoKSB7XHJcbiAgICAgICAgICAgIGlmICh0aGlzLl9jYW52YXNQb3NpdGlvbiA9PT0gbnVsbCkge1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIHVwZGF0ZSBsYXllcidzIHBvc2l0aW9uXHJcbiAgICAgICAgICAgIHZhciB3ZXN0ID0gdGhpcy5fY2FudmFzUG9zaXRpb24ud2VzdDtcclxuICAgICAgICAgICAgdmFyIGVhc3QgPSB0aGlzLl9jYW52YXNQb3NpdGlvbi5lYXN0O1xyXG4gICAgICAgICAgICB2YXIgc291dGggPSB0aGlzLl9jYW52YXNQb3NpdGlvbi5zb3V0aDtcclxuICAgICAgICAgICAgdmFyIG5vcnRoID0gdGhpcy5fY2FudmFzUG9zaXRpb24ubm9ydGg7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICB2YXIgdG9wTGVmdCA9IHRoaXMuX21hcC5sYXRMbmdUb0xheWVyUG9pbnQoW25vcnRoLCB3ZXN0XSk7XHJcbiAgICAgICAgICAgIHZhciBib3R0b21SaWdodCA9IHRoaXMuX21hcC5sYXRMbmdUb0xheWVyUG9pbnQoW3NvdXRoLCBlYXN0XSk7XHJcbiAgICAgICAgICAgIHZhciBzaXplID0gYm90dG9tUmlnaHQuc3VidHJhY3QodG9wTGVmdCk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBMLkRvbVV0aWwuc2V0UG9zaXRpb24odGhpcy5fdGFyZ2V0Q2FudmFzLCB0b3BMZWZ0KTtcclxuICAgICAgICAgICAgdGhpcy5fdGFyZ2V0Q2FudmFzLnN0eWxlLndpZHRoID0gc2l6ZS54ICsgJ3B4JztcclxuICAgICAgICAgICAgdGhpcy5fdGFyZ2V0Q2FudmFzLnN0eWxlLmhlaWdodCA9IHNpemUueSArICdweCc7XHJcbiAgICAgICAgfSxcclxuICAgICAgICBcclxuICAgICAgICBfYW5pbWF0ZVpvb206IGZ1bmN0aW9uIGFuaW1hdGVab29tKG9wdGlvbnMpIHtcclxuICAgICAgICAgICAgaWYgKHRoaXMuX2NhbnZhc1Bvc2l0aW9uID09PSBudWxsKSB7XHJcbiAgICAgICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICAgICAgLy8gTk9URTogQWxsIG1ldGhvZCAoaW5jbHVkaW5nIHVzaW5nIG9mIHByaXZhdGUgbWV0aG9kXHJcbiAgICAgICAgICAgIC8vIF9sYXRMbmdUb05ld0xheWVyUG9pbnQpIHdhcyBjb3BpZWQgZnJvbSBJbWFnZU92ZXJsYXksXHJcbiAgICAgICAgICAgIC8vIGFzIExlYWZsZXQgZG9jdW1lbnRhdGlvbiByZWNvbW1lbmRzLlxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgdmFyIHdlc3QgPSAgdGhpcy5fY2FudmFzUG9zaXRpb24ud2VzdDtcclxuICAgICAgICAgICAgdmFyIGVhc3QgPSAgdGhpcy5fY2FudmFzUG9zaXRpb24uZWFzdDtcclxuICAgICAgICAgICAgdmFyIHNvdXRoID0gdGhpcy5fY2FudmFzUG9zaXRpb24uc291dGg7XHJcbiAgICAgICAgICAgIHZhciBub3J0aCA9IHRoaXMuX2NhbnZhc1Bvc2l0aW9uLm5vcnRoO1xyXG5cclxuICAgICAgICAgICAgdmFyIHRvcExlZnQgPSB0aGlzLl9tYXAuX2xhdExuZ1RvTmV3TGF5ZXJQb2ludChcclxuICAgICAgICAgICAgICAgIFtub3J0aCwgd2VzdF0sIG9wdGlvbnMuem9vbSwgb3B0aW9ucy5jZW50ZXIpO1xyXG4gICAgICAgICAgICB2YXIgYm90dG9tUmlnaHQgPSB0aGlzLl9tYXAuX2xhdExuZ1RvTmV3TGF5ZXJQb2ludChcclxuICAgICAgICAgICAgICAgIFtzb3V0aCwgZWFzdF0sIG9wdGlvbnMuem9vbSwgb3B0aW9ucy5jZW50ZXIpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgdmFyIHNjYWxlID0gdGhpcy5fbWFwLmdldFpvb21TY2FsZShvcHRpb25zLnpvb20pO1xyXG4gICAgICAgICAgICB2YXIgc2l6ZSA9IGJvdHRvbVJpZ2h0LnN1YnRyYWN0KHRvcExlZnQpO1xyXG4gICAgICAgICAgICB2YXIgc2l6ZVNjYWxlZCA9IHNpemUubXVsdGlwbHlCeSgoMSAvIDIpICogKDEgLSAxIC8gc2NhbGUpKTtcclxuICAgICAgICAgICAgdmFyIG9yaWdpbiA9IHRvcExlZnQuYWRkKHNpemVTY2FsZWQpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgdGhpcy5fdGFyZ2V0Q2FudmFzLnN0eWxlW0wuRG9tVXRpbC5UUkFOU0ZPUk1dID1cclxuICAgICAgICAgICAgICAgIEwuRG9tVXRpbC5nZXRUcmFuc2xhdGVTdHJpbmcob3JpZ2luKSArICcgc2NhbGUoJyArIHNjYWxlICsgJykgJztcclxuICAgICAgICB9XHJcbiAgICB9O1xyXG59IiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxudmFyIGltYWdlSGVscGVyRnVuY3Rpb25zID0gcmVxdWlyZSgnaW1hZ2UtaGVscGVyLWZ1bmN0aW9ucy5qcycpO1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiBjYWxjdWxhdGVMZWFmbGV0RnJ1c3R1bShsZWFmbGV0TWFwKSB7XHJcbiAgICB2YXIgc2NyZWVuU2l6ZSA9IGxlYWZsZXRNYXAuZ2V0U2l6ZSgpO1xyXG4gICAgdmFyIGJvdW5kcyA9IGxlYWZsZXRNYXAuZ2V0Qm91bmRzKCk7XHJcblxyXG4gICAgdmFyIGNhcnRvZ3JhcGhpY0JvdW5kcyA9IHtcclxuICAgICAgICB3ZXN0OiBib3VuZHMuZ2V0V2VzdCgpLFxyXG4gICAgICAgIGVhc3Q6IGJvdW5kcy5nZXRFYXN0KCksXHJcbiAgICAgICAgc291dGg6IGJvdW5kcy5nZXRTb3V0aCgpLFxyXG4gICAgICAgIG5vcnRoOiBib3VuZHMuZ2V0Tm9ydGgoKVxyXG4gICAgfTtcclxuICAgIFxyXG4gICAgdmFyIGZydXN0dW1EYXRhID0gaW1hZ2VIZWxwZXJGdW5jdGlvbnMuY2FsY3VsYXRlRnJ1c3R1bTJERnJvbUJvdW5kcyhcclxuICAgICAgICBjYXJ0b2dyYXBoaWNCb3VuZHMsIHNjcmVlblNpemUpO1xyXG5cclxuICAgIHJldHVybiBmcnVzdHVtRGF0YTtcclxufTsiLCIndXNlIHN0cmljdCc7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IEdyaWREZWNvZGVyV29ya2VyQmFzZTtcclxuXHJcbi8qIGdsb2JhbCBQcm9taXNlIDogZmFsc2UgKi9cclxuLyogZ2xvYmFsIEltYWdlRGF0YSA6IGZhbHNlICovXHJcblxyXG5mdW5jdGlvbiBHcmlkRGVjb2RlcldvcmtlckJhc2UoKSB7XHJcbiAgICBHcmlkRGVjb2RlcldvcmtlckJhc2UucHJvdG90eXBlLnN0YXJ0ID0gZnVuY3Rpb24gZGVjb2RlKGRlY29kZXJJbnB1dCkge1xyXG4gICAgICAgIHZhciBpbWFnZVBhcnRQYXJhbXMgPSBkZWNvZGVySW5wdXQuaW1hZ2VQYXJ0UGFyYW1zO1xyXG4gICAgICAgIHZhciB3aWR0aCAgPSBpbWFnZVBhcnRQYXJhbXMubWF4WEV4Y2x1c2l2ZSAtIGltYWdlUGFydFBhcmFtcy5taW5YO1xyXG4gICAgICAgIHZhciBoZWlnaHQgPSBpbWFnZVBhcnRQYXJhbXMubWF4WUV4Y2x1c2l2ZSAtIGltYWdlUGFydFBhcmFtcy5taW5ZO1xyXG4gICAgICAgIHZhciByZXN1bHQgPSBuZXcgSW1hZ2VEYXRhKHdpZHRoLCBoZWlnaHQpO1xyXG4gICAgICAgIHZhciBwcm9taXNlcyA9IFtdO1xyXG4gICAgICAgIHZhciB0aWxlUG9zaXRpb24gID0ge21pblg6IDAsIG1pblk6IDAsIG1heFhFeGNsdXNpdmU6IDAsIG1heFlFeGNsdXNpdmU6IDAsIHdpZHRoOiBkZWNvZGVySW5wdXQudGlsZVdpZHRoLCBoZWlnaHQ6IGRlY29kZXJJbnB1dC50aWxlSGVpZ2h0fTtcclxuICAgICAgICB2YXIgcmVnaW9uSW5JbWFnZSA9IHttaW5YOiAwLCBtaW5ZOiAwLCBtYXhYRXhjbHVzaXZlOiAwLCBtYXhZRXhjbHVzaXZlOiAwLCB3aWR0aDogMCwgaGVpZ2h0OiAwfTsgXHJcbiAgICAgICAgdmFyIG9mZnNldCA9IHt4OiAwLCB5OiAwfTtcclxuICAgICAgICB2YXIgdGlsZSA9IHt0aWxlWDogMCwgdGlsZVk6IDAsIGxldmVsOiAwLCBwb3NpdGlvbjogdGlsZVBvc2l0aW9uLCBjb250ZW50OiBudWxsfTtcclxuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IGRlY29kZXJJbnB1dC50aWxlSW5kaWNlcy5sZW5ndGg7ICsraSkge1xyXG4gICAgICAgICAgICB0aWxlUG9zaXRpb24ubWluWCAgICAgICAgICA9IGRlY29kZXJJbnB1dC50aWxlSW5kaWNlc1tpXS50aWxlWCAqIGRlY29kZXJJbnB1dC50aWxlV2lkdGggO1xyXG4gICAgICAgICAgICB0aWxlUG9zaXRpb24ubWluWSAgICAgICAgICA9IGRlY29kZXJJbnB1dC50aWxlSW5kaWNlc1tpXS50aWxlWSAqIGRlY29kZXJJbnB1dC50aWxlSGVpZ2h0O1xyXG4gICAgICAgICAgICB0aWxlUG9zaXRpb24ubWF4WEV4Y2x1c2l2ZSA9IHRpbGVQb3NpdGlvbi5taW5YICsgZGVjb2RlcklucHV0LnRpbGVXaWR0aDtcclxuICAgICAgICAgICAgdGlsZVBvc2l0aW9uLm1heFlFeGNsdXNpdmUgPSB0aWxlUG9zaXRpb24ubWluWSArIGRlY29kZXJJbnB1dC50aWxlSGVpZ2h0O1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgcmVnaW9uSW5JbWFnZS5taW5YICAgICAgICAgID0gTWF0aC5tYXgodGlsZVBvc2l0aW9uLm1pblgsIGltYWdlUGFydFBhcmFtcy5taW5YKTtcclxuICAgICAgICAgICAgcmVnaW9uSW5JbWFnZS5taW5ZICAgICAgICAgID0gTWF0aC5tYXgodGlsZVBvc2l0aW9uLm1pblksIGltYWdlUGFydFBhcmFtcy5taW5ZKTtcclxuICAgICAgICAgICAgcmVnaW9uSW5JbWFnZS5tYXhYRXhjbHVzaXZlID0gTWF0aC5taW4odGlsZVBvc2l0aW9uLm1heFhFeGNsdXNpdmUsIGltYWdlUGFydFBhcmFtcy5tYXhYRXhjbHVzaXZlKTtcclxuICAgICAgICAgICAgcmVnaW9uSW5JbWFnZS5tYXhZRXhjbHVzaXZlID0gTWF0aC5taW4odGlsZVBvc2l0aW9uLm1heFlFeGNsdXNpdmUsIGltYWdlUGFydFBhcmFtcy5tYXhZRXhjbHVzaXZlKTtcclxuICAgICAgICAgICAgcmVnaW9uSW5JbWFnZS53aWR0aCAgICAgICAgID0gcmVnaW9uSW5JbWFnZS5tYXhYRXhjbHVzaXZlIC0gcmVnaW9uSW5JbWFnZS5taW5YO1xyXG4gICAgICAgICAgICByZWdpb25JbkltYWdlLmhlaWdodCAgICAgICAgPSByZWdpb25JbkltYWdlLm1heFlFeGNsdXNpdmUgLSByZWdpb25JbkltYWdlLm1pblk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBvZmZzZXQueCA9IHJlZ2lvbkluSW1hZ2UubWluWCAtIGltYWdlUGFydFBhcmFtcy5taW5YO1xyXG4gICAgICAgICAgICBvZmZzZXQueSA9IHJlZ2lvbkluSW1hZ2UubWluWSAtIGltYWdlUGFydFBhcmFtcy5taW5ZO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgdGlsZS50aWxlWSA9IGRlY29kZXJJbnB1dC50aWxlSW5kaWNlc1tpXS50aWxlWTtcclxuICAgICAgICAgICAgdGlsZS50aWxlWCA9IGRlY29kZXJJbnB1dC50aWxlSW5kaWNlc1tpXS50aWxlWDtcclxuICAgICAgICAgICAgdGlsZS5sZXZlbCA9IGRlY29kZXJJbnB1dC50aWxlSW5kaWNlc1tpXS5sZXZlbDtcclxuICAgICAgICAgICAgdGlsZS5jb250ZW50ID0gZGVjb2RlcklucHV0LnRpbGVDb250ZW50c1tpXTtcclxuICAgICAgICAgICAgcHJvbWlzZXMucHVzaCh0aGlzLmRlY29kZVJlZ2lvbihyZXN1bHQsIG9mZnNldCwgcmVnaW9uSW5JbWFnZSwgdGlsZSkpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICByZXR1cm4gUHJvbWlzZS5hbGwocHJvbWlzZXMpLnRoZW4oZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgICAgIHJldHVybiByZXN1bHQ7XHJcbiAgICAgICAgfSk7XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBHcmlkRGVjb2RlcldvcmtlckJhc2UucHJvdG90eXBlLmRlY29kZVJlZ2lvbiA9IGZ1bmN0aW9uIGRlY29kZVJlZ2lvbih0YXJnZXRJbWFnZURhdGEsIGltYWdlUGFydFBhcmFtcywga2V5LCBmZXRjaGVkRGF0YSkge1xyXG4gICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IGRlY29kZVJlZ2lvbiBpcyBub3QgaW1wbGVtZW50ZWQnO1xyXG4gICAgfTtcclxufSIsIid1c2Ugc3RyaWN0JztcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gR3JpZEZldGNoZXJCYXNlO1xyXG5cclxudmFyIFNpbXBsZUZldGNoZXJCYXNlID0gcmVxdWlyZSgnc2ltcGxlLWZldGNoZXItYmFzZS5qcycpO1xyXG52YXIgR3JpZEltYWdlQmFzZSA9IHJlcXVpcmUoJ2dyaWQtaW1hZ2UtYmFzZS5qcycpO1xyXG52YXIgTGlua2VkTGlzdCA9IHJlcXVpcmUoJ2xpbmtlZC1saXN0LmpzJyk7XHJcblxyXG4vKiBnbG9iYWwgUHJvbWlzZTogZmFsc2UgKi9cclxuXHJcbnZhciBUSUxFX1NUQVRFX0FDVElWRSA9IDA7XHJcbnZhciBUSUxFX1NUQVRFX1BFTkRJTkdfU1RPUCA9IDE7XHJcbnZhciBUSUxFX1NUQVRFX1NUT1BQRUQgPSAyO1xyXG52YXIgVElMRV9TVEFURV9URVJNSU5BVEVEID0gMztcclxuXHJcbmZ1bmN0aW9uIEdyaWRGZXRjaGVyQmFzZShvcHRpb25zKSB7XHJcbiAgICBTaW1wbGVGZXRjaGVyQmFzZS5jYWxsKHRoaXMsIG9wdGlvbnMpO1xyXG4gICAgdGhpcy5fZ3JpZEZldGNoZXJCYXNlQ2FjaGUgPSBbXTtcclxuICAgIHRoaXMuX2V2ZW50cyA9IHtcclxuICAgICAgICAnZGF0YSc6IFtdLFxyXG4gICAgICAgICd0aWxlLXRlcm1pbmF0ZWQnOiBbXVxyXG4gICAgfTtcclxufVxyXG5cclxuR3JpZEZldGNoZXJCYXNlLnByb3RvdHlwZSA9IE9iamVjdC5jcmVhdGUoU2ltcGxlRmV0Y2hlckJhc2UucHJvdG90eXBlKTtcclxuXHJcbkdyaWRGZXRjaGVyQmFzZS5wcm90b3R5cGUuZmV0Y2hUaWxlID0gZnVuY3Rpb24obGV2ZWwsIHRpbGVYLCB0aWxlWSwgZmV0Y2hUYXNrKSB7XHJcbiAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBHcmlkRmV0Y2hlckJhc2UuZmV0Y2hUaWxlIGlzIG5vdCBpbXBsZW1lbnRlZCBieSBpbmhlcml0b3InO1xyXG59O1xyXG5cclxuR3JpZEZldGNoZXJCYXNlLnByb3RvdHlwZS5vbiA9IGZ1bmN0aW9uKGV2ZW50LCBsaXN0ZW5lcikge1xyXG4gICAgdmFyIGxpc3RlbmVycyA9IHRoaXMuX2V2ZW50c1tldmVudF07XHJcbiAgICBpZiAoIWxpc3RlbmVycykge1xyXG4gICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IFVuZXhwZWN0ZWQgZXZlbnQgJyArIGV2ZW50ICsgJyBpbiBHcmlkRmV0Y2hlckJhc2UnO1xyXG4gICAgfVxyXG4gICAgbGlzdGVuZXJzLnB1c2gobGlzdGVuZXIpO1xyXG59O1xyXG5cclxuR3JpZEZldGNoZXJCYXNlLnByb3RvdHlwZS5zdGFydEZldGNoID0gZnVuY3Rpb24gc3RhcnRGZXRjaChmZXRjaENvbnRleHQsIGltYWdlUGFydFBhcmFtcykge1xyXG4gICAgdmFyIGZldGNoRGF0YSA9IHtcclxuICAgICAgICBhY3RpdmVUaWxlc0NvdW50OiAwLFxyXG4gICAgICAgIGFjdGl2ZVRpbGVzQ291bnRXaXRoU2luZ2xlTGlzdGVuZXI6IDAsXHJcbiAgICAgICAgdGlsZUxpc3RlbmVyczogW10sXHJcbiAgICAgICAgZmV0Y2hDb250ZXh0OiBmZXRjaENvbnRleHQsXHJcbiAgICAgICAgaXNQZW5kaW5nU3RvcDogZmFsc2UsXHJcbiAgICAgICAgaXNBY3RpdmU6IGZhbHNlLFxyXG4gICAgICAgIGltYWdlUGFydFBhcmFtczogaW1hZ2VQYXJ0UGFyYW1zLFxyXG4gICAgICAgIHNlbGY6IHRoaXNcclxuICAgIH07XHJcbiAgICBcclxuICAgIGZldGNoQ29udGV4dC5vbignc3RvcCcsIG9uRmV0Y2hTdG9wLCBmZXRjaERhdGEpO1xyXG4gICAgZmV0Y2hDb250ZXh0Lm9uKCdyZXN1bWUnLCBvbkZldGNoUmVzdW1lLCBmZXRjaERhdGEpO1xyXG4gICAgZmV0Y2hDb250ZXh0Lm9uKCd0ZXJtaW5hdGUnLCBvbkZldGNoVGVybWluYXRlLCBmZXRjaERhdGEpO1xyXG5cclxuICAgIHZhciB0aWxlc1RvU3RhcnRYID0gW107XHJcbiAgICB2YXIgdGlsZXNUb1N0YXJ0WSA9IFtdO1xyXG4gICAgdmFyIHRpbGVzVG9TdGFydFRpbGVDb250ZXh0cyA9IFtdO1xyXG4gICAgXHJcbiAgICB2YXIgdGlsZXNSYW5nZSA9IEdyaWRJbWFnZUJhc2UuZ2V0VGlsZXNSYW5nZSh0aGlzLmdldEltYWdlUGFyYW1zKCksIGltYWdlUGFydFBhcmFtcyk7XHJcbiAgICBmZXRjaERhdGEuYWN0aXZlVGlsZXNDb3VudCA9ICh0aWxlc1JhbmdlLm1heFRpbGVYIC0gdGlsZXNSYW5nZS5taW5UaWxlWCkgKiAodGlsZXNSYW5nZS5tYXhUaWxlWSAtIHRpbGVzUmFuZ2UubWluVGlsZVkpO1xyXG4gICAgZm9yICh2YXIgdGlsZVggPSB0aWxlc1JhbmdlLm1pblRpbGVYOyB0aWxlWCA8IHRpbGVzUmFuZ2UubWF4VGlsZVg7ICsrdGlsZVgpIHtcclxuICAgICAgICBmb3IgKHZhciB0aWxlWSA9IHRpbGVzUmFuZ2UubWluVGlsZVk7IHRpbGVZIDwgdGlsZXNSYW5nZS5tYXhUaWxlWTsgKyt0aWxlWSkge1xyXG4gICAgICAgICAgICB2YXIgdGlsZUNvbnRleHQgPSB0aGlzLl9hZGRUb0NhY2hlKHRpbGVYLCB0aWxlWSwgZmV0Y2hEYXRhKTtcclxuICAgICAgICAgICAgaWYgKHRpbGVDb250ZXh0ID09PSBudWxsKSB7XHJcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcclxuICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgdGlsZXNUb1N0YXJ0WC5wdXNoKHRpbGVYKTtcclxuICAgICAgICAgICAgdGlsZXNUb1N0YXJ0WS5wdXNoKHRpbGVZKTtcclxuICAgICAgICAgICAgdGlsZXNUb1N0YXJ0VGlsZUNvbnRleHRzLnB1c2godGlsZUNvbnRleHQpO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuICAgIFxyXG4gICAgb25GZXRjaFJlc3VtZS5jYWxsKGZldGNoRGF0YSk7XHJcbiAgICBcclxuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgdGlsZXNUb1N0YXJ0WC5sZW5ndGg7ICsraSkge1xyXG4gICAgICAgIHRoaXMuX2xvYWRUaWxlKGZldGNoRGF0YS5pbWFnZVBhcnRQYXJhbXMubGV2ZWwsIHRpbGVzVG9TdGFydFhbaV0sIHRpbGVzVG9TdGFydFlbaV0sIHRpbGVzVG9TdGFydFRpbGVDb250ZXh0c1tpXSk7XHJcbiAgICB9XHJcbn07XHJcblxyXG5HcmlkRmV0Y2hlckJhc2UucHJvdG90eXBlLl9jaGVja0lmU2hvdWxkU3RvcCA9IGZ1bmN0aW9uIHRyeVN0b3BGZXRjaChmZXRjaERhdGEpIHtcclxuICAgIGlmICghZmV0Y2hEYXRhLmlzUGVuZGluZ1N0b3AgfHwgZmV0Y2hEYXRhLmFjdGl2ZVRpbGVzQ291bnRXaXRoU2luZ2xlTGlzdGVuZXIgPiAwKSB7XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBmZXRjaERhdGEuaXNQZW5kaW5nU3RvcCA9IGZhbHNlO1xyXG4gICAgZmV0Y2hEYXRhLmlzQWN0aXZlID0gZmFsc2U7XHJcbiAgICB0aGlzLl9jaGFuZ2VTaW5nbGVMaXN0ZW5lckNvdW50T2ZPdmVybGFwcGluZ0ZldGNoZXMoZmV0Y2hEYXRhLCArMSk7XHJcbiAgICBmZXRjaERhdGEuZmV0Y2hDb250ZXh0LnN0b3BwZWQoKTtcclxufTtcclxuICAgIFxyXG5HcmlkRmV0Y2hlckJhc2UucHJvdG90eXBlLl9jaGFuZ2VTaW5nbGVMaXN0ZW5lckNvdW50T2ZPdmVybGFwcGluZ0ZldGNoZXMgPVxyXG4gICAgICAgIGZ1bmN0aW9uIGNoYW5nZVNpbmdsZUxpc3RlbmVyQ291bnRPZk92ZXJsYXBwaW5nRmV0Y2hlcyhmZXRjaERhdGEsIGFkZFZhbHVlKSB7XHJcbiAgICAgICAgICAgIFxyXG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBmZXRjaERhdGEudGlsZUxpc3RlbmVycy5sZW5ndGg7ICsraSkge1xyXG4gICAgICAgIHZhciB0aWxlQ29udGV4dCA9IGZldGNoRGF0YS50aWxlTGlzdGVuZXJzW2ldLnRpbGVDb250ZXh0O1xyXG4gICAgICAgIHRoaXMuX2NoYW5nZVNpbmdsZUxpc3RlbmVyQ291bnQodGlsZUNvbnRleHQuZGVwZW5kRmV0Y2hlcywgLypzaW5nbGVMaXN0ZW5lckFkZFZhbHVlPSovYWRkVmFsdWUpO1xyXG4gICAgfVxyXG59O1xyXG5cclxuR3JpZEZldGNoZXJCYXNlLnByb3RvdHlwZS5fZGVjcmVtZW50QWN0aXZlVGlsZXMgPSBmdW5jdGlvbih0aWxlRGVwZW5kRmV0Y2hlcykge1xyXG4gICAgdmFyIHNpbmdsZUFjdGl2ZUZldGNoID0gbnVsbDtcclxuICAgIHZhciBoYXNBY3RpdmVGZXRjaGVzID0gZmFsc2U7XHJcbiAgICB2YXIgaXRlcmF0b3IgPSB0aWxlRGVwZW5kRmV0Y2hlcy5nZXRGaXJzdEl0ZXJhdG9yKCk7XHJcbiAgICB3aGlsZSAoaXRlcmF0b3IgIT09IG51bGwpIHtcclxuICAgICAgICB2YXIgZmV0Y2hEYXRhID0gdGlsZURlcGVuZEZldGNoZXMuZ2V0VmFsdWUoaXRlcmF0b3IpO1xyXG4gICAgICAgIGl0ZXJhdG9yID0gdGlsZURlcGVuZEZldGNoZXMuZ2V0TmV4dEl0ZXJhdG9yKGl0ZXJhdG9yKTtcclxuXHJcbiAgICAgICAgLS1mZXRjaERhdGEuYWN0aXZlVGlsZXNDb3VudDtcclxuICAgICAgICBpZiAoZmV0Y2hEYXRhLmFjdGl2ZVRpbGVzQ291bnQgPT09IDApIHtcclxuICAgICAgICAgICAgZmV0Y2hEYXRhLmlzQWN0aXZlID0gZmFsc2U7XHJcbiAgICAgICAgICAgIGZldGNoRGF0YS5mZXRjaENvbnRleHQuZG9uZSgpO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxufTtcclxuXHJcbkdyaWRGZXRjaGVyQmFzZS5wcm90b3R5cGUuX2NoYW5nZVNpbmdsZUxpc3RlbmVyQ291bnQgPSBmdW5jdGlvbih0aWxlRGVwZW5kRmV0Y2hlcywgc2luZ2xlTGlzdGVuZXJBZGRWYWx1ZSkge1xyXG4gICAgdmFyIHNpbmdsZUFjdGl2ZUZldGNoID0gbnVsbDtcclxuICAgIHZhciBoYXNBY3RpdmVGZXRjaGVzID0gZmFsc2U7XHJcbiAgICB2YXIgaXRlcmF0b3IgPSB0aWxlRGVwZW5kRmV0Y2hlcy5nZXRGaXJzdEl0ZXJhdG9yKCk7XHJcbiAgICB3aGlsZSAoaXRlcmF0b3IgIT09IG51bGwpIHtcclxuICAgICAgICB2YXIgZmV0Y2hEYXRhID0gdGlsZURlcGVuZEZldGNoZXMuZ2V0VmFsdWUoaXRlcmF0b3IpO1xyXG4gICAgICAgIGl0ZXJhdG9yID0gdGlsZURlcGVuZEZldGNoZXMuZ2V0TmV4dEl0ZXJhdG9yKGl0ZXJhdG9yKTtcclxuXHJcbiAgICAgICAgaWYgKCFmZXRjaERhdGEuaXNBY3RpdmUpIHtcclxuICAgICAgICAgICAgY29udGludWU7XHJcbiAgICAgICAgfSBlbHNlIGlmIChzaW5nbGVBY3RpdmVGZXRjaCA9PT0gbnVsbCkge1xyXG4gICAgICAgICAgICBzaW5nbGVBY3RpdmVGZXRjaCA9IGZldGNoRGF0YTtcclxuICAgICAgICAgICAgaGFzQWN0aXZlRmV0Y2hlcyA9IHRydWU7XHJcbiAgICAgICAgfSBlbHNlIGlmIChoYXNBY3RpdmVGZXRjaGVzKSB7XHJcbiAgICAgICAgICAgIC8vIE5vdCBzaW5nbGUgYW55bW9yZVxyXG4gICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgXHJcbiAgICBpZiAoc2luZ2xlQWN0aXZlRmV0Y2ggIT09IG51bGwpIHtcclxuICAgICAgICBzaW5nbGVBY3RpdmVGZXRjaC5hY3RpdmVUaWxlc0NvdW50V2l0aFNpbmdsZUxpc3RlbmVyICs9IHNpbmdsZUxpc3RlbmVyQWRkVmFsdWU7XHJcbiAgICAgICAgdGhpcy5fY2hlY2tJZlNob3VsZFN0b3Aoc2luZ2xlQWN0aXZlRmV0Y2gpO1xyXG4gICAgfVxyXG59O1xyXG5cclxuZnVuY3Rpb24gb25GZXRjaFN0b3AoKSB7XHJcbiAgICAvKiBqc2hpbnQgdmFsaWR0aGlzOiB0cnVlICovXHJcbiAgICB2YXIgZmV0Y2hEYXRhID0gdGhpcztcclxuXHJcbiAgICBmZXRjaERhdGEuaXNQZW5kaW5nU3RvcCA9IHRydWU7XHJcbiAgICBmZXRjaERhdGEuc2VsZi5fY2hlY2tJZlNob3VsZFN0b3AoZmV0Y2hEYXRhKTtcclxufVxyXG5cclxuZnVuY3Rpb24gb25GZXRjaFJlc3VtZSgpIHtcclxuICAgIC8qIGpzaGludCB2YWxpZHRoaXM6IHRydWUgKi9cclxuICAgIHZhciBmZXRjaERhdGEgPSB0aGlzO1xyXG4gICAgZmV0Y2hEYXRhLmlzUGVuZGluZ1N0b3AgPSBmYWxzZTtcclxuICAgIFxyXG4gICAgZmV0Y2hEYXRhLnNlbGYuX2NoYW5nZVNpbmdsZUxpc3RlbmVyQ291bnRPZk92ZXJsYXBwaW5nRmV0Y2hlcyhmZXRjaERhdGEsIC0xKTtcclxuICAgIGZldGNoRGF0YS5pc0FjdGl2ZSA9IHRydWU7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIG9uRmV0Y2hUZXJtaW5hdGUoKSB7XHJcbiAgICAvKiBqc2hpbnQgdmFsaWR0aGlzOiB0cnVlICovXHJcbiAgICB2YXIgZmV0Y2hEYXRhID0gdGhpcztcclxuICAgIFxyXG4gICAgaWYgKGZldGNoRGF0YS5pc0FjdGl2ZSkge1xyXG4gICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IFVuZXhwZWN0ZWQgZ3JpZCBmZXRjaCB0ZXJtaW5hdGVkIG9mIGEgc3RpbGwgYWN0aXZlIGZldGNoJztcclxuICAgIH1cclxuICAgIFxyXG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBmZXRjaERhdGEudGlsZUxpc3RlbmVycy5sZW5ndGg7ICsraSkge1xyXG4gICAgICAgIGZldGNoRGF0YS50aWxlTGlzdGVuZXJzW2ldLnRpbGVDb250ZXh0LmRlcGVuZEZldGNoZXMucmVtb3ZlKGZldGNoRGF0YS50aWxlTGlzdGVuZXJzW2ldLml0ZXJhdG9yKTtcclxuICAgIH1cclxufVxyXG5cclxuR3JpZEZldGNoZXJCYXNlLnByb3RvdHlwZS5fbG9hZFRpbGUgPSBmdW5jdGlvbiBsb2FkVGlsZShsZXZlbCwgdGlsZVgsIHRpbGVZLCB0aWxlQ29udGV4dCkge1xyXG4gICAgdmFyIHRpbGVLZXkgPSB7XHJcbiAgICAgICAgZmV0Y2hXYWl0VGFzazogdHJ1ZSxcclxuICAgICAgICB0aWxlWDogdGlsZVgsXHJcbiAgICAgICAgdGlsZVk6IHRpbGVZLFxyXG4gICAgICAgIGxldmVsOiBsZXZlbFxyXG4gICAgfTtcclxuICAgIFxyXG4gICAgdmFyIHNlbGYgPSB0aGlzO1xyXG4gICAgdmFyIHRpbGVGZXRjaEFwaSA9IHtcclxuICAgICAgICBkYXRhUmVhZHk6IGZ1bmN0aW9uKHJlc3VsdCkge1xyXG4gICAgICAgICAgICBpZiAodGlsZUNvbnRleHQudGlsZVN0YXRlICE9PSBUSUxFX1NUQVRFX0FDVElWRSAmJiB0aWxlQ29udGV4dC50aWxlU3RhdGUgIT09IFRJTEVfU1RBVEVfUEVORElOR19TVE9QKSB7XHJcbiAgICAgICAgICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBlaXRoZXIgc3RvcHBlZCBvciBhbHJlYWR5IHRlcm1pbmF0ZWQgaW4gR3JpZEZldGNoZXJCYXNlLmZldGNoVGlsZSgpJztcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBpZiAoc2VsZi5fZ3JpZEZldGNoZXJCYXNlQ2FjaGVbbGV2ZWxdW3RpbGVYXVt0aWxlWV0gIT09IHRpbGVDb250ZXh0KSB7XHJcbiAgICAgICAgICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBVbmV4cGVjdGVkIGZldGNoIGluIEdyaWRGZXRjaGVyQmFzZS5ncmlkRmV0Y2hlckJhc2VDYWNoZSc7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgdmFyIGRhdGEgPSB7XHJcbiAgICAgICAgICAgICAgICB0aWxlS2V5OiB0aWxlS2V5LFxyXG4gICAgICAgICAgICAgICAgdGlsZUNvbnRlbnQ6IHJlc3VsdFxyXG4gICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IHNlbGYuX2V2ZW50cy5kYXRhLmxlbmd0aDsgKytpKSB7XHJcbiAgICAgICAgICAgICAgICBzZWxmLl9ldmVudHMuZGF0YVtpXShkYXRhKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH0sXHJcbiAgICAgICAgXHJcbiAgICAgICAgdGVybWluYXRlOiBmdW5jdGlvbigpIHtcclxuICAgICAgICAgICAgaWYgKHRpbGVDb250ZXh0LnRpbGVTdGF0ZSAhPT0gVElMRV9TVEFURV9BQ1RJVkUgJiYgdGlsZUNvbnRleHQudGlsZVN0YXRlICE9PSBUSUxFX1NUQVRFX1BFTkRJTkdfU1RPUCkge1xyXG4gICAgICAgICAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogZWl0aGVyIHN0b3BwZWQgb3IgYWxyZWFkeSB0ZXJtaW5hdGVkIGluIEdyaWRGZXRjaGVyQmFzZS5mZXRjaFRpbGUoKSc7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgaWYgKHNlbGYuX2dyaWRGZXRjaGVyQmFzZUNhY2hlW2xldmVsXVt0aWxlWF1bdGlsZVldICE9PSB0aWxlQ29udGV4dCkge1xyXG4gICAgICAgICAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogVW5leHBlY3RlZCBmZXRjaCBpbiBHcmlkRmV0Y2hlckJhc2UuZ3JpZEZldGNoZXJCYXNlQ2FjaGUnO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIHRpbGVDb250ZXh0LnRpbGVTdGF0ZSA9IFRJTEVfU1RBVEVfVEVSTUlOQVRFRDtcclxuICAgICAgICAgICAgc2VsZi5fZ3JpZEZldGNoZXJCYXNlQ2FjaGVbbGV2ZWxdW3RpbGVYXVt0aWxlWV0gPSBudWxsO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBzZWxmLl9ldmVudHNbJ3RpbGUtdGVybWluYXRlZCddLmxlbmd0aDsgKytpKSB7XHJcbiAgICAgICAgICAgICAgICBzZWxmLl9ldmVudHNbJ3RpbGUtdGVybWluYXRlZCddW2ldKHRpbGVLZXkpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBzZWxmLl9kZWNyZW1lbnRBY3RpdmVUaWxlcyh0aWxlQ29udGV4dC5kZXBlbmRGZXRjaGVzKTtcclxuICAgICAgICAgICAgc2VsZi5fY2hhbmdlU2luZ2xlTGlzdGVuZXJDb3VudCh0aWxlQ29udGV4dC5kZXBlbmRGZXRjaGVzLCAvKnNpbmdsZUxpc3RlbmVyQWRkVmFsdWU9Ki8tMSk7XHJcbiAgICAgICAgfSxcclxuICAgICAgICAvKiBUT0RPOiBlbmFibGUgc3RvcCAmIHJlc3VtZVxyXG4gICAgICAgIG9uOiBmdW5jdGlvbihldmVudCwgaGFuZGxlcikge1xyXG4gICAgICAgICAgICBpZiAoZXZlbnQgIT09ICdzdG9wJyAmJiBldmVudCAhPT0gJ3Jlc3VtZScpIHtcclxuICAgICAgICAgICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IEdyaWRGZXRjaGVyQmFzZSB0aWxlLm9uIHVuZXhwZWN0ZWQgZXZlbnQgJyArIGV2ZW50ICsgJzogZXhwZWN0ZWQgc3RvcCBvciByZXN1bWUnO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICB0aWxlQ29udGV4dFtldmVudCArICdMaXN0ZW5lcnMnXS5wdXNoKGhhbmRsZXIpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBzdG9wcGVkOiBmdW5jdGlvbigpIHtcclxuICAgICAgICAgICAgaWYgKHRpbGVDb250ZXh0LnRpbGVTdGF0ZSAhPT0gVElMRV9TVEFURV9QRU5ESU5HX1NUT1ApIHtcclxuICAgICAgICAgICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IFVuZXhwZWN0ZWQgc3RvcHBlZCBjYWxsLiBFaXRoZXI6IDEuIE5vIHN0b3AgcmVxdWVzdGVkIG9yLCAyLiByZXN1bWUgd2FzIGNhbGxlZCAnICtcclxuICAgICAgICAgICAgICAgICAgICAndGlsbCB0aGVuIG9yLCAzLiBBbHJlYWR5IGNhbGxlZCBzdG9wcGVkIG9yLCA0LiBBbHJlYWR5IGNhbGxlZCB0ZXJtaW5hdGUnO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICAgICovXHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICB0aGlzLmZldGNoVGlsZShsZXZlbCwgdGlsZVgsIHRpbGVZLCB0aWxlRmV0Y2hBcGkpO1xyXG59O1xyXG5cclxuR3JpZEZldGNoZXJCYXNlLnByb3RvdHlwZS5fYWRkVG9DYWNoZSA9IGZ1bmN0aW9uIGFkZFRvQ2FjaGUodGlsZVgsIHRpbGVZLCBmZXRjaERhdGEpIHtcclxuICAgIHZhciBsZXZlbENhY2hlID0gdGhpcy5fZ3JpZEZldGNoZXJCYXNlQ2FjaGVbZmV0Y2hEYXRhLmltYWdlUGFydFBhcmFtcy5sZXZlbF07XHJcbiAgICBpZiAoIWxldmVsQ2FjaGUpIHtcclxuICAgICAgICBsZXZlbENhY2hlID0gW107XHJcbiAgICAgICAgdGhpcy5fZ3JpZEZldGNoZXJCYXNlQ2FjaGVbZmV0Y2hEYXRhLmltYWdlUGFydFBhcmFtcy5sZXZlbF0gPSBsZXZlbENhY2hlO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICB2YXIgeENhY2hlID0gbGV2ZWxDYWNoZVt0aWxlWF07XHJcbiAgICBpZiAoIXhDYWNoZSkge1xyXG4gICAgICAgIHhDYWNoZSA9IFtdO1xyXG4gICAgICAgIGxldmVsQ2FjaGVbdGlsZVhdID0geENhY2hlO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICB2YXIgdGlsZUNvbnRleHQgPSB4Q2FjaGVbdGlsZVldO1xyXG4gICAgdmFyIGlzTmV3ID0gZmFsc2U7XHJcbiAgICBpZiAoIXRpbGVDb250ZXh0KSB7XHJcbiAgICAgICAgdGlsZUNvbnRleHQgPSB7XHJcbiAgICAgICAgICAgIGRlcGVuZEZldGNoZXM6IG5ldyBMaW5rZWRMaXN0KCksXHJcbiAgICAgICAgICAgIHN0b3BMaXN0ZW5lcnM6IFtdLFxyXG4gICAgICAgICAgICByZXN1bWVMaXN0ZW5lcnM6IFtdLFxyXG4gICAgICAgICAgICB0aWxlU3RhdGU6IFRJTEVfU1RBVEVfQUNUSVZFXHJcbiAgICAgICAgfTtcclxuICAgICAgICB4Q2FjaGVbdGlsZVldID0gdGlsZUNvbnRleHQ7XHJcbiAgICAgICAgKytmZXRjaERhdGEuYWN0aXZlVGlsZXNDb3VudFdpdGhTaW5nbGVMaXN0ZW5lcjtcclxuICAgICAgICBpc05ldyA9IHRydWU7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGZldGNoRGF0YS50aWxlTGlzdGVuZXJzLnB1c2goe1xyXG4gICAgICAgIHRpbGVDb250ZXh0OiB0aWxlQ29udGV4dCxcclxuICAgICAgICBpdGVyYXRvcjogdGlsZUNvbnRleHQuZGVwZW5kRmV0Y2hlcy5hZGQoZmV0Y2hEYXRhKVxyXG4gICAgfSk7XHJcbiAgICByZXR1cm4gaXNOZXcgPyB0aWxlQ29udGV4dCA6IG51bGw7XHJcbn07IiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxudmFyIEdyaWRMZXZlbENhbGN1bGF0b3IgPSByZXF1aXJlKCdncmlkLWxldmVsLWNhbGN1bGF0b3IuanMnKTtcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gR3JpZEltYWdlQmFzZTtcclxuXHJcbi8qIGdsb2JhbCBQcm9taXNlOiBmYWxzZSAqL1xyXG5cclxudmFyIEZFVENIX1dBSVRfVEFTSyA9IDA7XHJcbnZhciBERUNPREVfVEFTSyA9IDE7XHJcblxyXG5mdW5jdGlvbiBHcmlkSW1hZ2VCYXNlKGZldGNoZXIpIHtcclxuICAgIHRoaXMuX2ZldGNoZXIgPSBmZXRjaGVyO1xyXG4gICAgdGhpcy5faW1hZ2VQYXJhbXMgPSBudWxsO1xyXG4gICAgdGhpcy5fd2FpdGluZ0ZldGNoZXMgPSB7fTtcclxuICAgIHRoaXMuX2xldmVsQ2FsY3VsYXRvciA9IG51bGw7XHJcbn1cclxuXHJcbkdyaWRJbWFnZUJhc2UucHJvdG90eXBlLm9wZW5lZCA9IGZ1bmN0aW9uIG9wZW5lZChpbWFnZURlY29kZXIpIHtcclxuICAgIHRoaXMuX2ltYWdlUGFyYW1zID0gaW1hZ2VEZWNvZGVyLmdldEltYWdlUGFyYW1zKCk7XHJcbiAgICBpbWFnZURlY29kZXIub25GZXRjaGVyRXZlbnQoJ2RhdGEnLCB0aGlzLl9vbkRhdGFGZXRjaGVkLmJpbmQodGhpcykpO1xyXG4gICAgaW1hZ2VEZWNvZGVyLm9uRmV0Y2hlckV2ZW50KCd0aWxlLXRlcm1pbmF0ZWQnLCB0aGlzLl9vblRpbGVUZXJtaW5hdGVkLmJpbmQodGhpcykpO1xyXG59O1xyXG5cclxuR3JpZEltYWdlQmFzZS5wcm90b3R5cGUuZ2V0TGV2ZWxDYWxjdWxhdG9yID0gZnVuY3Rpb24gZ2V0TGV2ZWxDYWxjdWxhdG9yKCkge1xyXG4gICAgaWYgKHRoaXMuX2xldmVsQ2FsY3VsYXRvciA9PT0gbnVsbCkge1xyXG4gICAgICAgIHRoaXMuX2xldmVsQ2FsY3VsYXRvciA9IG5ldyBHcmlkTGV2ZWxDYWxjdWxhdG9yKHRoaXMuX2ltYWdlUGFyYW1zKTtcclxuICAgIH1cclxuICAgIHJldHVybiB0aGlzLl9sZXZlbENhbGN1bGF0b3I7XHJcbn07XHJcblxyXG5HcmlkSW1hZ2VCYXNlLnByb3RvdHlwZS5nZXREZWNvZGVXb3JrZXJUeXBlT3B0aW9ucyA9IGZ1bmN0aW9uIGdldERlY29kZVdvcmtlclR5cGVPcHRpb25zKCkge1xyXG4gICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogR3JpZEltYWdlQmFzZS5nZXREZWNvZGVXb3JrZXJUeXBlT3B0aW9ucyBpcyBub3QgaW1wbGVtZW50ZWQgYnkgaW5oZXJpdG9yJztcclxufTtcclxuXHJcbkdyaWRJbWFnZUJhc2UucHJvdG90eXBlLmdldERlY29kZXJXb3JrZXJzSW5wdXRSZXRyZWl2ZXIgPSBmdW5jdGlvbiBnZXREZWNvZGVyV29ya2Vyc0lucHV0UmV0cmVpdmVyKCkge1xyXG4gICAgcmV0dXJuIHRoaXM7XHJcbn07XHJcblxyXG5HcmlkSW1hZ2VCYXNlLnByb3RvdHlwZS5kZWNvZGVUYXNrU3RhcnRlZCA9IGZ1bmN0aW9uIGRlY29kZVRhc2tTdGFydGVkKHRhc2spIHtcclxuICAgIHZhciBzZWxmID0gdGhpcztcclxuICAgIHRhc2sub24oJ2FsbERlcGVuZFRhc2tzVGVybWluYXRlZCcsIGZ1bmN0aW9uKCkge1xyXG4gICAgICAgIHNlbGYuZGF0YVJlYWR5Rm9yRGVjb2RlKHRhc2spO1xyXG4gICAgICAgIHRhc2sudGVybWluYXRlKCk7XHJcbiAgICB9KTtcclxufTtcclxuXHJcbkdyaWRJbWFnZUJhc2UucHJvdG90eXBlLmRhdGFSZWFkeUZvckRlY29kZSA9IGZ1bmN0aW9uIGRhdGFSZWFkeUZvckRlY29kZSh0YXNrKSB7XHJcbiAgICB0YXNrLmRhdGFSZWFkeSh7XHJcbiAgICAgICAgdGlsZUNvbnRlbnRzOiB0YXNrLmRlcGVuZFRhc2tSZXN1bHRzLFxyXG4gICAgICAgIHRpbGVJbmRpY2VzOiB0YXNrLmRlcGVuZFRhc2tLZXlzLFxyXG4gICAgICAgIGltYWdlUGFydFBhcmFtczogdGFzay5rZXksXHJcbiAgICAgICAgdGlsZVdpZHRoOiB0aGlzLl9pbWFnZVBhcmFtcy50aWxlV2lkdGgsXHJcbiAgICAgICAgdGlsZUhlaWdodDogdGhpcy5faW1hZ2VQYXJhbXMudGlsZUhlaWdodFxyXG4gICAgfSwgREVDT0RFX1RBU0ssIC8qY2FuU2tpcD0qL3RydWUpO1xyXG59O1xyXG5cclxuR3JpZEltYWdlQmFzZS5wcm90b3R5cGUuZ2V0RmV0Y2hlciA9IGZ1bmN0aW9uIGdldEZldGNoZXIoKSB7XHJcbiAgICByZXR1cm4gdGhpcy5fZmV0Y2hlcjtcclxufTtcclxuXHJcbi8vIERlcGVuZGVuY3lXb3JrZXJzSW5wdXRSZXRyZWl2ZXIgaW1wbGVtZW50YXRpb25cclxuXHJcbkdyaWRJbWFnZUJhc2UucHJvdG90eXBlLmdldFdvcmtlclR5cGVPcHRpb25zID0gZnVuY3Rpb24odGFza1R5cGUpIHtcclxuICAgIGlmICh0YXNrVHlwZSA9PT0gRkVUQ0hfV0FJVF9UQVNLKSB7XHJcbiAgICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICB9IGVsc2UgaWYgKHRhc2tUeXBlID09PSBERUNPREVfVEFTSykge1xyXG4gICAgICAgIHJldHVybiB0aGlzLmdldERlY29kZVdvcmtlclR5cGVPcHRpb25zKCk7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgaW50ZXJuYWwgZXJyb3I6IEdyaWRJbWFnZUJhc2UuZ2V0VGFza1R5cGVPcHRpb25zIGdvdCB1bmV4cGVjdGVkIHRhc2sgdHlwZSAnICsgdGFza1R5cGU7XHJcbiAgICB9XHJcbn07XHJcblxyXG5HcmlkSW1hZ2VCYXNlLnByb3RvdHlwZS5nZXRLZXlBc1N0cmluZyA9IGZ1bmN0aW9uKGtleSkge1xyXG4gICAgaWYgKGtleS5mZXRjaFdhaXRUYXNrKSB7XHJcbiAgICAgICAgcmV0dXJuICdmZXRjaFdhaXQ6JyArIGtleS50aWxlWCArICcsJyArIGtleS50aWxlWSArICc6JyArIGtleS5sZXZlbDtcclxuICAgIH1cclxuICAgIC8vIE90aGVyd2lzZSBpdCdzIGEgaW1hZ2VQYXJ0UGFyYW1zIGtleSBwYXNzZWQgYnkgaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGxpYi4gSnVzdCBjcmVhdGUgYSB1bmlxdWUgc3RyaW5nXHJcbiAgICByZXR1cm4gSlNPTi5zdHJpbmdpZnkoa2V5KTtcclxufTtcclxuXHJcbkdyaWRJbWFnZUJhc2UucHJvdG90eXBlLnRhc2tTdGFydGVkID0gZnVuY3Rpb24odGFzaykgeyAgICBcclxuICAgIHZhciBzZWxmID0gdGhpcztcclxuICAgIFxyXG4gICAgaWYgKHRhc2sua2V5LmZldGNoV2FpdFRhc2spIHtcclxuICAgICAgICB2YXIgc3RyS2V5ID0gdGhpcy5nZXRLZXlBc1N0cmluZyh0YXNrLmtleSk7XHJcbiAgICAgICAgdGhpcy5fd2FpdGluZ0ZldGNoZXNbc3RyS2V5XSA9IHRhc2s7XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG5cclxuICAgIGlmICh0aGlzLl9pbWFnZVBhcmFtcyA9PT0gbnVsbCkge1xyXG4gICAgICAgIHRoaXMuX2ltYWdlUGFyYW1zID0gdGhpcy5nZXRJbWFnZVBhcmFtcygpOyAvLyBpbWFnZVBhcmFtcyB0aGF0IHJldHVybmVkIGJ5IGZldGNoZXIub3BlbigpXHJcbiAgICB9XHJcblxyXG4gICAgdmFyIGltYWdlUGFydFBhcmFtcyA9IHRhc2sua2V5O1xyXG4gICAgdmFyIHRpbGVzUmFuZ2UgPSBHcmlkSW1hZ2VCYXNlLmdldFRpbGVzUmFuZ2UodGhpcy5faW1hZ2VQYXJhbXMsIGltYWdlUGFydFBhcmFtcyk7XHJcbiAgICBcclxuICAgIHZhciBpID0gMDtcclxuICAgIGZvciAodmFyIHRpbGVYID0gdGlsZXNSYW5nZS5taW5UaWxlWDsgdGlsZVggPCB0aWxlc1JhbmdlLm1heFRpbGVYOyArK3RpbGVYKSB7XHJcbiAgICAgICAgZm9yICh2YXIgdGlsZVkgPSB0aWxlc1JhbmdlLm1pblRpbGVZOyB0aWxlWSA8IHRpbGVzUmFuZ2UubWF4VGlsZVk7ICsrdGlsZVkpIHtcclxuICAgICAgICAgICAgdGFzay5yZWdpc3RlclRhc2tEZXBlbmRlbmN5KHtcclxuICAgICAgICAgICAgICAgIGZldGNoV2FpdFRhc2s6IHRydWUsXHJcbiAgICAgICAgICAgICAgICB0aWxlWDogdGlsZVgsXHJcbiAgICAgICAgICAgICAgICB0aWxlWTogdGlsZVksXHJcbiAgICAgICAgICAgICAgICBsZXZlbDogaW1hZ2VQYXJ0UGFyYW1zLmxldmVsXHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuICAgIFxyXG4gICAgdGhpcy5kZWNvZGVUYXNrU3RhcnRlZCh0YXNrKTtcclxufTtcclxuXHJcbi8vIEF1eGlsaWFyeSBtZXRob2RzXHJcblxyXG5HcmlkSW1hZ2VCYXNlLnByb3RvdHlwZS5fb25EYXRhRmV0Y2hlZCA9IGZ1bmN0aW9uKGZldGNoZWRUaWxlKSB7XHJcbiAgICB2YXIgc3RyS2V5ID0gdGhpcy5nZXRLZXlBc1N0cmluZyhmZXRjaGVkVGlsZS50aWxlS2V5KTtcclxuICAgIHZhciB3YWl0aW5nVGFzayA9IHRoaXMuX3dhaXRpbmdGZXRjaGVzW3N0cktleV07XHJcbiAgICBpZiAod2FpdGluZ1Rhc2spIHtcclxuICAgICAgICB3YWl0aW5nVGFzay5kYXRhUmVhZHkoZmV0Y2hlZFRpbGUudGlsZUNvbnRlbnQsIEZFVENIX1dBSVRfVEFTSyk7XHJcbiAgICB9XHJcbn07XHJcblxyXG5HcmlkSW1hZ2VCYXNlLnByb3RvdHlwZS5fb25UaWxlVGVybWluYXRlZCA9IGZ1bmN0aW9uKHRpbGVLZXkpIHtcclxuICAgIHZhciBzdHJLZXkgPSB0aGlzLmdldEtleUFzU3RyaW5nKHRpbGVLZXkpO1xyXG4gICAgdmFyIHdhaXRpbmdUYXNrID0gdGhpcy5fd2FpdGluZ0ZldGNoZXNbc3RyS2V5XTtcclxuICAgIGlmICh3YWl0aW5nVGFzaykge1xyXG4gICAgICAgIHdhaXRpbmdUYXNrLnRlcm1pbmF0ZSgpO1xyXG4gICAgICAgIHRoaXMuX3dhaXRpbmdGZXRjaGVzW3N0cktleV0gPSBudWxsO1xyXG4gICAgfVxyXG59O1xyXG5cclxuR3JpZEltYWdlQmFzZS5nZXRUaWxlc1JhbmdlID0gZnVuY3Rpb24oaW1hZ2VQYXJhbXMsIGltYWdlUGFydFBhcmFtcykge1xyXG4gICAgdmFyIGxldmVsV2lkdGggID0gaW1hZ2VQYXJhbXMuaW1hZ2VXaWR0aCAgKiBNYXRoLnBvdygyLCBpbWFnZVBhcnRQYXJhbXMubGV2ZWwgLSBpbWFnZVBhcmFtcy5pbWFnZUxldmVsKTtcclxuICAgIHZhciBsZXZlbEhlaWdodCA9IGltYWdlUGFyYW1zLmltYWdlSGVpZ2h0ICogTWF0aC5wb3coMiwgaW1hZ2VQYXJ0UGFyYW1zLmxldmVsIC0gaW1hZ2VQYXJhbXMuaW1hZ2VMZXZlbCk7XHJcbiAgICB2YXIgbGV2ZWxUaWxlc1ggPSBNYXRoLmNlaWwobGV2ZWxXaWR0aCAgLyBpbWFnZVBhcmFtcy50aWxlV2lkdGggKTtcclxuICAgIHZhciBsZXZlbFRpbGVzWSA9IE1hdGguY2VpbChsZXZlbEhlaWdodCAvIGltYWdlUGFyYW1zLnRpbGVIZWlnaHQpO1xyXG4gICAgcmV0dXJuIHtcclxuICAgICAgICBtaW5UaWxlWDogTWF0aC5tYXgoMCwgTWF0aC5mbG9vcihpbWFnZVBhcnRQYXJhbXMubWluWCAvIGltYWdlUGFyYW1zLnRpbGVXaWR0aCApKSxcclxuICAgICAgICBtaW5UaWxlWTogTWF0aC5tYXgoMCwgTWF0aC5mbG9vcihpbWFnZVBhcnRQYXJhbXMubWluWSAvIGltYWdlUGFyYW1zLnRpbGVIZWlnaHQpKSxcclxuICAgICAgICBtYXhUaWxlWDogTWF0aC5taW4obGV2ZWxUaWxlc1gsIE1hdGguY2VpbChpbWFnZVBhcnRQYXJhbXMubWF4WEV4Y2x1c2l2ZSAvIGltYWdlUGFyYW1zLnRpbGVXaWR0aCApKSxcclxuICAgICAgICBtYXhUaWxlWTogTWF0aC5taW4obGV2ZWxUaWxlc1ksIE1hdGguY2VpbChpbWFnZVBhcnRQYXJhbXMubWF4WUV4Y2x1c2l2ZSAvIGltYWdlUGFyYW1zLnRpbGVIZWlnaHQpKVxyXG4gICAgfTtcclxufTtcclxuIiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBHcmlkTGV2ZWxDYWxjdWxhdG9yO1xyXG5cclxuZnVuY3Rpb24gR3JpZExldmVsQ2FsY3VsYXRvcihpbWFnZVBhcmFtcykge1xyXG4gICAgdGhpcy5faW1hZ2VQYXJhbXMgPSBpbWFnZVBhcmFtcztcclxufVxyXG5cclxuR3JpZExldmVsQ2FsY3VsYXRvci5wcm90b3R5cGUuZ2V0TGV2ZWxXaWR0aCA9IGZ1bmN0aW9uIGdldExldmVsV2lkdGgobGV2ZWwpIHtcclxuICAgIHZhciB3aWR0aCA9IHRoaXMuX2ltYWdlUGFyYW1zLmltYWdlV2lkdGggKiBNYXRoLnBvdygyLCBsZXZlbCAtIHRoaXMuX2ltYWdlUGFyYW1zLmltYWdlTGV2ZWwpO1xyXG4gICAgcmV0dXJuIHdpZHRoO1xyXG59O1xyXG5cclxuR3JpZExldmVsQ2FsY3VsYXRvci5wcm90b3R5cGUuZ2V0TGV2ZWxIZWlnaHQgPSBmdW5jdGlvbiBnZXRMZXZlbEhlaWdodChsZXZlbCkge1xyXG4gICAgdmFyIGhlaWdodCA9ICB0aGlzLl9pbWFnZVBhcmFtcy5pbWFnZUhlaWdodCAqIE1hdGgucG93KDIsIGxldmVsIC0gdGhpcy5faW1hZ2VQYXJhbXMuaW1hZ2VMZXZlbCk7XHJcbiAgICByZXR1cm4gaGVpZ2h0O1xyXG59O1xyXG5cclxuR3JpZExldmVsQ2FsY3VsYXRvci5wcm90b3R5cGUuZ2V0TGV2ZWwgPSBmdW5jdGlvbiBnZXRMZXZlbChyZWdpb25JbWFnZUxldmVsKSB7XHJcbiAgICB2YXIgbG9nMiA9IE1hdGgubG9nKDIpO1xyXG4gICAgdmFyIGxldmVsWCA9IE1hdGgubG9nKHJlZ2lvbkltYWdlTGV2ZWwuc2NyZWVuV2lkdGggIC8gKHJlZ2lvbkltYWdlTGV2ZWwubWF4WEV4Y2x1c2l2ZSAtIHJlZ2lvbkltYWdlTGV2ZWwubWluWCkpIC8gbG9nMjtcclxuICAgIHZhciBsZXZlbFkgPSBNYXRoLmxvZyhyZWdpb25JbWFnZUxldmVsLnNjcmVlbkhlaWdodCAvIChyZWdpb25JbWFnZUxldmVsLm1heFlFeGNsdXNpdmUgLSByZWdpb25JbWFnZUxldmVsLm1pblkpKSAvIGxvZzI7XHJcbiAgICB2YXIgbGV2ZWwgPSBNYXRoLmNlaWwoTWF0aC5taW4obGV2ZWxYLCBsZXZlbFkpKTtcclxuICAgIGxldmVsICs9IHRoaXMuX2ltYWdlUGFyYW1zLmltYWdlTGV2ZWw7XHJcbiAgICBcclxuICAgIHJldHVybiBsZXZlbDtcclxufTtcclxuIiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxudmFyIFNpbXBsZU1vdmFibGVGZXRjaCA9IHJlcXVpcmUoJ3NpbXBsZS1tb3ZhYmxlLWZldGNoLmpzJyk7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IFNpbXBsZUZldGNoZXJCYXNlO1xyXG5cclxuLyogZ2xvYmFsIFByb21pc2U6IGZhbHNlICovXHJcblxyXG5mdW5jdGlvbiBTaW1wbGVGZXRjaGVyQmFzZShvcHRpb25zKSB7XHJcbiAgICB0aGlzLl9tYXhBY3RpdmVGZXRjaGVzSW5Nb3ZhYmxlRmV0Y2ggPSAob3B0aW9ucyB8fCB7fSkubWF4QWN0aXZlRmV0Y2hlc0luTW92YWJsZUZldGNoIHx8IDI7XHJcbiAgICB0aGlzLl9pbmRpcmVjdENsb3NlSW5kaWNhdGlvbiA9IHsgaXNDbG9zZVJlcXVlc3RlZDogZmFsc2UgfTtcclxufVxyXG5cclxuU2ltcGxlRmV0Y2hlckJhc2UucHJvdG90eXBlLnN0YXJ0TW92YWJsZUZldGNoID0gZnVuY3Rpb24gc3RhcnRNb3ZhYmxlRmV0Y2goZmV0Y2hDb250ZXh0LCBpbWFnZVBhcnRQYXJhbXMpIHtcclxuICAgIHZhciBtb3ZhYmxlRmV0Y2ggPSBuZXcgU2ltcGxlTW92YWJsZUZldGNoKFxyXG4gICAgICAgIHRoaXMsIHRoaXMuX2luZGlyZWN0Q2xvc2VJbmRpY2F0aW9uLCBmZXRjaENvbnRleHQsIHRoaXMuX21heEFjdGl2ZUZldGNoZXNJbk1vdmFibGVGZXRjaCk7XHJcbiAgICBcclxuICAgIG1vdmFibGVGZXRjaC5zdGFydChpbWFnZVBhcnRQYXJhbXMpO1xyXG59O1xyXG5cclxuU2ltcGxlRmV0Y2hlckJhc2UucHJvdG90eXBlLmNsb3NlID0gZnVuY3Rpb24gY2xvc2UoKSB7XHJcbiAgICBpZiAodGhpcy5zdGFydE1vdmFibGVGZXRjaCAhPT0gU2ltcGxlRmV0Y2hlckJhc2UucHJvdG90eXBlLnN0YXJ0TW92YWJsZUZldGNoKSB7XHJcbiAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogTXVzdCBvdmVycmlkZSBGZXRjaGVyLmNsb3NlKCkgd2hlbiBGZXRjaGVyLnN0YXJ0TW92YWJsZUZldGNoKCkgd2FzIG92ZXJyaWRlbic7XHJcbiAgICB9XHJcbiAgICB0aGlzLl9pbmRpcmVjdENsb3NlSW5kaWNhdGlvbi5pc0Nsb3NlUmVxdWVzdGVkID0gdHJ1ZTtcclxuICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcclxufTsiLCIndXNlIHN0cmljdCc7XHJcblxyXG52YXIgRmV0Y2hDb250ZXh0QXBpID0gcmVxdWlyZSgnZmV0Y2gtY29udGV4dC1hcGkuanMnKTtcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gU2ltcGxlTW92YWJsZUZldGNoO1xyXG5cclxudmFyIEZFVENIX1NUQVRFX1dBSVRfRk9SX01PVkUgPSAxO1xyXG52YXIgRkVUQ0hfU1RBVEVfQUNUSVZFID0gMjtcclxudmFyIEZFVENIX1NUQVRFX1NUT1BQSU5HID0gMztcclxudmFyIEZFVENIX1NUQVRFX1NUT1BQRUQgPSA0O1xyXG52YXIgRkVUQ0hfU1RBVEVfVEVSTUlOQVRFRCA9IDU7XHJcblxyXG5mdW5jdGlvbiBTaW1wbGVNb3ZhYmxlRmV0Y2goZmV0Y2hlciwgaW5kaXJlY3RDbG9zZUluZGljYXRpb24sIGZldGNoQ29udGV4dCwgbWF4QWN0aXZlRmV0Y2hlc0luTW92YWJsZUZldGNoKSB7XHJcbiAgICB0aGlzLl9mZXRjaGVyID0gZmV0Y2hlcjtcclxuICAgIHRoaXMuX2luZGlyZWN0Q2xvc2VJbmRpY2F0aW9uID0gaW5kaXJlY3RDbG9zZUluZGljYXRpb247XHJcbiAgICB0aGlzLl9tb3ZhYmxlRmV0Y2hDb250ZXh0ID0gZmV0Y2hDb250ZXh0O1xyXG4gICAgdGhpcy5fbWF4QWN0aXZlRmV0Y2hlc0luTW92YWJsZUZldGNoID0gbWF4QWN0aXZlRmV0Y2hlc0luTW92YWJsZUZldGNoO1xyXG4gICAgXHJcbiAgICB0aGlzLl9sYXN0RmV0Y2ggPSBudWxsO1xyXG4gICAgdGhpcy5fYWN0aXZlRmV0Y2hlc0luTW92YWJsZUZldGNoID0gMDtcclxuICAgIHRoaXMuX3BlbmRpbmdJbWFnZVBhcnRQYXJhbXMgPSBudWxsO1xyXG4gICAgdGhpcy5fbW92YWJsZVN0YXRlID0gRkVUQ0hfU1RBVEVfV0FJVF9GT1JfTU9WRTtcclxuICAgIFxyXG4gICAgdGhpcy5faXNQcm9ncmVzc2l2ZSA9IGZhbHNlO1xyXG4gICAgdGhpcy5faXNQcm9ncmVzc2l2ZUNoYW5nZWRDYWxsZWQgPSBmYWxzZTtcclxuICAgIFxyXG4gICAgZmV0Y2hDb250ZXh0Lm9uKCdtb3ZlJywgdGhpcy5fb25Nb3ZlLCB0aGlzKTtcclxuICAgIGZldGNoQ29udGV4dC5vbigndGVybWluYXRlJywgdGhpcy5fb25UZXJtaW5hdGVkLCB0aGlzKTtcclxuICAgIGZldGNoQ29udGV4dC5vbignaXNQcm9ncmVzc2l2ZUNoYW5nZWQnLCB0aGlzLl9vbklzUHJvZ3Jlc3NpdmVDaGFuZ2VkLCB0aGlzKTtcclxuICAgIGZldGNoQ29udGV4dC5vbignc3RvcCcsIHRoaXMuX29uU3RvcCwgdGhpcyk7XHJcbiAgICBmZXRjaENvbnRleHQub24oJ3Jlc3VtZScsIHRoaXMuX29uUmVzdW1lLCB0aGlzKTtcclxufVxyXG5cclxuU2ltcGxlTW92YWJsZUZldGNoLnByb3RvdHlwZS5zdGFydCA9IGZ1bmN0aW9uIHN0YXJ0KGltYWdlUGFydFBhcmFtcykge1xyXG4gICAgdGhpcy5fb25Nb3ZlKGltYWdlUGFydFBhcmFtcyk7XHJcbn07XHJcblxyXG5TaW1wbGVNb3ZhYmxlRmV0Y2gucHJvdG90eXBlLl9vbklzUHJvZ3Jlc3NpdmVDaGFuZ2VkID0gZnVuY3Rpb24gaXNQcm9ncmVzc2l2ZUNoYW5nZWQoaXNQcm9ncmVzc2l2ZSkge1xyXG4gICAgdGhpcy5faXNQcm9ncmVzc2l2ZSA9IGlzUHJvZ3Jlc3NpdmU7XHJcbiAgICB2YXIgbGFzdEFjdGl2ZUZldGNoID0gdGhpcy5fZ2V0TGFzdEZldGNoQWN0aXZlKCk7XHJcbiAgICBpZiAobGFzdEFjdGl2ZUZldGNoICE9PSBudWxsKSB7XHJcbiAgICAgICAgbGFzdEFjdGl2ZUZldGNoLl9vbkV2ZW50KCdpc1Byb2dyZXNzaXZlQ2hhbmdlZCcsIGlzUHJvZ3Jlc3NpdmUpO1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgICB0aGlzLl9pc1Byb2dyZXNzaXZlQ2hhbmdlZENhbGxlZCA9IHRydWU7XHJcbiAgICB9XHJcbn07XHJcblxyXG5TaW1wbGVNb3ZhYmxlRmV0Y2gucHJvdG90eXBlLl9vblN0b3AgPSBmdW5jdGlvbiBzdG9wKGlzQWJvcnRlZCkge1xyXG4gICAgdGhpcy5fc3dpdGNoU3RhdGUoRkVUQ0hfU1RBVEVfU1RPUFBJTkcsIEZFVENIX1NUQVRFX0FDVElWRSk7XHJcbiAgICB2YXIgbGFzdEFjdGl2ZUZldGNoID0gdGhpcy5fZ2V0TGFzdEZldGNoQWN0aXZlKCk7XHJcbiAgICBpZiAobGFzdEFjdGl2ZUZldGNoICE9PSBudWxsKSB7XHJcbiAgICAgICAgbGFzdEFjdGl2ZUZldGNoLl9vbkV2ZW50KCdzdG9wJywgaXNBYm9ydGVkKTtcclxuICAgIH1cclxufTtcclxuXHJcblNpbXBsZU1vdmFibGVGZXRjaC5wcm90b3R5cGUuX29uUmVzdW1lID0gZnVuY3Rpb24gcmVzdW1lKCkge1xyXG4gICAgdGhpcy5fc3dpdGNoU3RhdGUoRkVUQ0hfU1RBVEVfQUNUSVZFLCBGRVRDSF9TVEFURV9TVE9QUEVELCBGRVRDSF9TVEFURV9TVE9QUElORyk7XHJcblxyXG4gICAgaWYgKHRoaXMuX2xhc3RGZXRjaCA9PT0gbnVsbCkge1xyXG4gICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IHJlc3VtaW5nIG5vbiBzdG9wcGVkIGZldGNoJztcclxuICAgIH1cclxuICAgIFxyXG4gICAgaWYgKHRoaXMuX2lzUHJvZ3Jlc3NpdmVDaGFuZ2VkQ2FsbGVkKSB7XHJcbiAgICAgICAgdGhpcy5faXNQcm9ncmVzc2l2ZUNoYW5nZWRDYWxsZWQgPSBmYWxzZTtcclxuICAgICAgICB0aGlzLl9sYXN0RmV0Y2guX29uRXZlbnQoJ2lzUHJvZ3Jlc3NpdmVDaGFuZ2VkJywgdGhpcy5faXNQcm9ncmVzc2l2ZSk7XHJcbiAgICB9XHJcbiAgICB0aGlzLl9sYXN0RmV0Y2guX29uRXZlbnQoJ3Jlc3VtZScpO1xyXG59O1xyXG5cclxuU2ltcGxlTW92YWJsZUZldGNoLnByb3RvdHlwZS5fb25UZXJtaW5hdGVkID0gZnVuY3Rpb24gb25UZXJtaW5hdGVkKGlzQWJvcnRlZCkge1xyXG4gICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogVW5leHBlY3RlZCB0ZXJtaW5hdGlvbiBvZiBtb3ZhYmxlIGZldGNoJztcclxufTtcclxuXHJcblNpbXBsZU1vdmFibGVGZXRjaC5wcm90b3R5cGUuX29uTW92ZSA9IGZ1bmN0aW9uIG1vdmUoaW1hZ2VQYXJ0UGFyYW1zKSB7XHJcbiAgICB0aGlzLl9wZW5kaW5nSW1hZ2VQYXJ0UGFyYW1zID0gaW1hZ2VQYXJ0UGFyYW1zO1xyXG4gICAgdGhpcy5fbW92YWJsZVN0YXRlID0gRkVUQ0hfU1RBVEVfQUNUSVZFO1xyXG4gICAgdGhpcy5fdHJ5U3RhcnRQZW5kaW5nRmV0Y2goKTtcclxufTtcclxuXHJcblNpbXBsZU1vdmFibGVGZXRjaC5wcm90b3R5cGUuX3RyeVN0YXJ0UGVuZGluZ0ZldGNoID0gZnVuY3Rpb24gdHJ5U3RhcnRQZW5kaW5nRmV0Y2goKSB7XHJcbiAgICBpZiAodGhpcy5faW5kaXJlY3RDbG9zZUluZGljYXRpb24uaXNDbG9zZVJlcXVlc3RlZCB8fFxyXG4gICAgICAgIHRoaXMuX2FjdGl2ZUZldGNoZXNJbk1vdmFibGVGZXRjaCA+PSB0aGlzLl9tYXhBY3RpdmVGZXRjaGVzSW5Nb3ZhYmxlRmV0Y2ggfHxcclxuICAgICAgICB0aGlzLl9wZW5kaW5nSW1hZ2VQYXJ0UGFyYW1zID09PSBudWxsIHx8XHJcbiAgICAgICAgdGhpcy5fbW92YWJsZVN0YXRlICE9PSBGRVRDSF9TVEFURV9BQ1RJVkUpIHtcclxuXHJcbiAgICAgICAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIFxyXG4gICAgdmFyIG5ld0ZldGNoID0ge1xyXG4gICAgICAgIGltYWdlUGFydFBhcmFtczogdGhpcy5fcGVuZGluZ0ltYWdlUGFydFBhcmFtcyxcclxuICAgICAgICBzdGF0ZTogRkVUQ0hfU1RBVEVfQUNUSVZFLFxyXG5cclxuICAgICAgICBmZXRjaENvbnRleHQ6IG51bGwsXHJcbiAgICAgICAgc2VsZjogdGhpc1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgdGhpcy5fcGVuZGluZ0ltYWdlUGFydFBhcmFtcyA9IG51bGw7XHJcbiAgICArK3RoaXMuX2FjdGl2ZUZldGNoZXNJbk1vdmFibGVGZXRjaDtcclxuICAgIFxyXG4gICAgbmV3RmV0Y2guZmV0Y2hDb250ZXh0ID0gbmV3IEZldGNoQ29udGV4dEFwaSgpO1xyXG4gICAgbmV3RmV0Y2guZmV0Y2hDb250ZXh0Lm9uKCdpbnRlcm5hbFN0b3BwZWQnLCBvblNpbmdsZUZldGNoU3RvcHBlZCwgbmV3RmV0Y2gpO1xyXG4gICAgbmV3RmV0Y2guZmV0Y2hDb250ZXh0Lm9uKCdpbnRlcm5hbERvbmUnLCBvblNpbmdsZUZldGNoRG9uZSwgbmV3RmV0Y2gpO1xyXG4gICAgXHJcbiAgICB0aGlzLl9mZXRjaGVyLnN0YXJ0RmV0Y2gobmV3RmV0Y2guZmV0Y2hDb250ZXh0LCBuZXdGZXRjaC5pbWFnZVBhcnRQYXJhbXMpO1xyXG59O1xyXG5cclxuU2ltcGxlTW92YWJsZUZldGNoLnByb3RvdHlwZS5fc2luZ2xlRmV0Y2hTdG9wcGVkID0gZnVuY3Rpb24gc2luZ2xlRmV0Y2hTdG9wcGVkKGZldGNoLCBpc0RvbmUpIHtcclxuICAgIC0tdGhpcy5fYWN0aXZlRmV0Y2hlc0luTW92YWJsZUZldGNoO1xyXG4gICAgdGhpcy5fbGFzdEZldGNoID0gbnVsbDtcclxuICAgIGZldGNoLnN0YXRlID0gRkVUQ0hfU1RBVEVfVEVSTUlOQVRFRDtcclxuXHJcbiAgICB0aGlzLl90cnlTdGFydFBlbmRpbmdGZXRjaCgpO1xyXG59O1xyXG5cclxuU2ltcGxlTW92YWJsZUZldGNoLnByb3RvdHlwZS5fZ2V0TGFzdEZldGNoQWN0aXZlID0gZnVuY3Rpb24gZ2V0TGFzdEZldGNoQWN0aXZlKCkge1xyXG4gICAgaWYgKHRoaXMuX21vdmFibGVTdGF0ZSA9PT0gRkVUQ0hfU1RBVEVfU1RPUFBFRCB8fCB0aGlzLl9sYXN0RmV0Y2ggPT09IG51bGwpIHtcclxuICAgICAgICByZXR1cm4gbnVsbDtcclxuICAgIH1cclxuICAgIFxyXG4gICAgaWYgKHRoaXMuX2xhc3RGZXRjaC5zdGF0ZSA9PT0gRkVUQ0hfU1RBVEVfQUNUSVZFKSB7XHJcbiAgICAgICAgcmV0dXJuIHRoaXMuX2xhc3RGZXRjaC5mZXRjaENvbnRleHQ7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gbnVsbDtcclxufTtcclxuXHJcblNpbXBsZU1vdmFibGVGZXRjaC5wcm90b3R5cGUuX3N3aXRjaFN0YXRlID0gZnVuY3Rpb24gc3dpdGNoU3RhdGUodGFyZ2V0U3RhdGUsIGV4cGVjdGVkU3RhdGUsIGV4cGVjdGVkU3RhdGUyLCBleHBlY3RlZFN0YXRlMykge1xyXG4gICAgaWYgKHRoaXMuX21vdmFibGVTdGF0ZSAhPT0gZXhwZWN0ZWRTdGF0ZSAmJiB0aGlzLl9tb3ZhYmxlU3RhdGUgIT09IGV4cGVjdGVkU3RhdGUyICYmIHRoaXMuX21vdmFibGVTdGF0ZSAhPT0gZXhwZWN0ZWRTdGF0ZTMpIHtcclxuICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBVbmV4cGVjdGVkIHN0YXRlICcgKyB0aGlzLl9tb3ZhYmxlU3RhdGUgKyAnLCBleHBlY3RlZCAnICsgZXhwZWN0ZWRTdGF0ZSArICcgb3IgJyArIGV4cGVjdGVkU3RhdGUyICsgJyBvciAnICsgZXhwZWN0ZWRTdGF0ZTM7XHJcbiAgICB9XHJcbiAgICB0aGlzLl9tb3ZhYmxlU3RhdGUgPSB0YXJnZXRTdGF0ZTtcclxufTtcclxuXHJcblNpbXBsZU1vdmFibGVGZXRjaC5wcm90b3R5cGUuX2lzTGFzdEZldGNoID0gZnVuY3Rpb24gaXNMYXN0RmV0Y2goZmV0Y2gpIHtcclxuICAgIHJldHVybiB0aGlzLl9sYXN0RmV0Y2ggPT09IGZldGNoICYmIHRoaXMuX3BlbmRpbmdJbWFnZVBhcnRQYXJhbXMgPT09IG51bGw7XHJcbn07XHJcblxyXG5mdW5jdGlvbiBvblNpbmdsZUZldGNoU3RvcHBlZCgpIHtcclxuICAgIC8qIGpzaGludCB2YWxpZHRoaXM6IHRydWUgKi9cclxuICAgIHZhciBmZXRjaCA9IHRoaXM7XHJcbiAgICB2YXIgbW92YWJsZUZldGNoID0gZmV0Y2guc2VsZjtcclxuICAgIFxyXG4gICAgaWYgKGZldGNoLnN0YXRlICE9PSBGRVRDSF9TVEFURV9TVE9QUElORykge1xyXG4gICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IFVuZXhwZWN0ZWQgc3RhdGUgb2YgZmV0Y2ggJyArIGZldGNoLnN0YXRlICsgJyBvbiBzdG9wcGVkJztcclxuICAgIH1cclxuICAgIFxyXG4gICAgaWYgKG1vdmFibGVGZXRjaC5faXNMYXN0RmV0Y2goZmV0Y2gpKSB7XHJcbiAgICAgICAgZmV0Y2guc3RhdGUgPSBGRVRDSF9TVEFURV9TVE9QUEVEO1xyXG4gICAgICAgIG1vdmFibGVGZXRjaC5fc3dpdGNoU3RhdGUoRkVUQ0hfU1RBVEVfU1RPUFBFRCwgRkVUQ0hfU1RBVEVfU1RPUFBJTkcpO1xyXG4gICAgICAgIG1vdmFibGVGZXRjaC5fbW92YWJsZUZldGNoQ29udGV4dC5zdG9wcGVkKCk7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICAgIG1vdmFibGVGZXRjaC5fc2luZ2xlRmV0Y2hTdG9wcGVkKGZldGNoKTtcclxuICAgIH1cclxufVxyXG5cclxuZnVuY3Rpb24gb25TaW5nbGVGZXRjaERvbmUoKSB7XHJcbiAgICAvKiBqc2hpbnQgdmFsaWR0aGlzOiB0cnVlICovXHJcbiAgICB2YXIgZmV0Y2ggPSB0aGlzO1xyXG4gICAgdmFyIG1vdmFibGVGZXRjaCA9IGZldGNoLnNlbGY7XHJcblxyXG4gICAgaWYgKGZldGNoLnN0YXRlICE9PSBGRVRDSF9TVEFURV9BQ1RJVkUgJiYgZmV0Y2guc3RhdGUgIT09IEZFVENIX1NUQVRFX1NUT1BQSU5HKSB7XHJcbiAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogVW5leHBlY3RlZCBzdGF0ZSBvZiBmZXRjaCAnICsgZmV0Y2guc3RhdGUgKyAnIG9uIGRvbmUnO1xyXG4gICAgfVxyXG5cclxuICAgIGZldGNoLnN0YXRlID0gRkVUQ0hfU1RBVEVfVEVSTUlOQVRFRDtcclxuICAgIGlmIChtb3ZhYmxlRmV0Y2guX2lzTGFzdEZldGNoKGZldGNoKSkge1xyXG4gICAgICAgIG1vdmFibGVGZXRjaC5fc3dpdGNoU3RhdGUoRkVUQ0hfU1RBVEVfV0FJVF9GT1JfTU9WRSwgRkVUQ0hfU1RBVEVfQUNUSVZFLCBGRVRDSF9TVEFURV9TVE9QUElORyk7XHJcbiAgICAgICAgbW92YWJsZUZldGNoLl9tb3ZhYmxlRmV0Y2hDb250ZXh0LmRvbmUoKTtcclxuICAgIH1cclxuICAgIG1vdmFibGVGZXRjaC5fc2luZ2xlRmV0Y2hTdG9wcGVkKGZldGNoKTtcclxufSJdfQ==
