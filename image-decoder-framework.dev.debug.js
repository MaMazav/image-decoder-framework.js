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
        if (callbacks.priorityCalculator) {
            this._priorityCalculatorIterator = this._taskInternals.priorityCalculators.add(callbacks);
        } else {
            this._priorityCalculatorIterator = null;
        }
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
    
    DependencyWorkersTaskContext.prototype.unregister = function() {
        if (!this._taskContextsIterator) {
            throw 'dependencyWorkers: Already unregistered';
        }
        
        if (this._priorityCalculatorIterator !== null) {
            this._taskInternals.priorityCalculators.remove(this._priorityCalculatorIterator);
            this._priorityCalculatorIterator = null;
        }
        
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
        
        this._shouldDelayActions = true;
        this._pendingDelayedAction = false;
        this._pendingDelayedDependencyData = [];
        this._pendingDelayedEnded = false;
        this._pendingDelayedNewData = [];
        this._pendingDelayedCanSkipLastNewData = false;
        this._pendingWorkerDone = false;
        this._pendingDelayedDependsTaskTerminated = 0;
        
        var that = this;
        this._priorityCalculator = function() {
            return that.calculatePriority();
        };
        this._scheduleNotifier = {
            'calculatePriority': this._priorityCalculator,
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
        dependencyWorkers.initializingTask(this.taskApi, this._scheduleNotifier);
    };
    
    DependencyWorkersTaskInternals.prototype.afterTaskStarted = function() {
        this._shouldDelayActions = false;
        this._performPendingDelayedActions();
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
            var callbacks = this.priorityCalculators.getFromIterator(iterator);
            var currentPriority = callbacks.priorityCalculator();
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
                'priorityCalculator': this._priorityCalculator,
                calleeForDebug: this
            }
        );
        
        if (!addResult.value.taskContext.isActive && !gotData) {
            throw 'dependency-workers error: dependant task already terminated without data';
        }
        
        // Might be removed: Code for debug which relies on internal member taskContext._taskInternals
        if (addResult.value.taskContext._taskInternals._isAborted) {
            throw 'dependencyWorkers error: dependant task already aborted';
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
            gotData = true;
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
        }
        
        function onDependencyTaskCustom(arg0, arg1) {
            that.taskApi._onEvent('dependencyTaskCustom', arg0, arg1);
        }
        
        function onDependencyTaskTerminated() {
            if (isDependsTaskTerminated) {
                throw 'dependencyWorkers: Double termination';
            }
            isDependsTaskTerminated = true;
            ++that._pendingDelayedDependsTaskTerminated;
            that._schedulePendingDelayedActions();
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
    
    DependencyWorkersTaskInternals.prototype._schedulePendingDelayedActions = function() {
        this._pendingDelayedAction = true;
        if (!this._shouldDelayActions) {
            this._performPendingDelayedActions();
        }
    };
    
    DependencyWorkersTaskInternals.prototype._performPendingDelayedActions = function performPendingDelayedActions() {
        if (!this._pendingDelayedAction) {
            return;
        }
        
        var that = this;
        this._pendingDelayedAction = false;
        
        if (this._pendingDelayedDependencyData.length > 0) {
            var localListeners = this._pendingDelayedDependencyData;
            this._pendingDelayedDependencyData = [];
            
            for (var i = 0; i < localListeners.length; ++i) {
                localListeners[i].onDependencyTaskData(localListeners[i].data);
            }
        }

        if (this._pendingDelayedDependsTaskTerminated > 0) {
            this._dependsTasksTerminatedCount += this._pendingDelayedDependsTaskTerminated;
            this._pendingDelayedDependsTaskTerminated = 0;
            if (this._dependsTasksTerminatedCount === this._dependsTaskContexts.getCount()) {
                this.taskApi._onEvent('allDependTasksTerminated');
            }
            
            this.statusUpdate();
        }

        if (this._pendingDelayedNewData.length > 0) {
            var newData = this._pendingDelayedNewData;
            var canSkipLast = this._pendingDelayedCanSkipLastNewData;
            this._pendingDelayedNewData = [];
            this._pendingDelayedCanSkipLastNewData = false;
            
            if (this._canSkipLastProcessedData) {
                this.processedData.pop();
            }
            
            for (var i = 0; i < newData.length; ++i) {
                this.processedData.push(newData[i]);
                this._canSkipLastProcessedData = canSkipLast && i === newData.length - 1;
                this._iterateCallbacks(function(callbacks) {
                    callbacks.onData(newData[i], that.taskKey);
                });
            }
        }
        
        if (this._pendingWorkerDone) {
            this._isWaitingForWorkerResult = false;
            this.statusUpdate();
        }
        
        if (this._pendingDelayedEnded) {
            this._pendingDelayedEnded = false;
            this._iterateCallbacks(function(callbacks) {
                if (callbacks.onTerminated) {
                    callbacks.onTerminated(that._isAborted);
                }
            });
            
            this.taskContexts.clear();
        }
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
            
            taskInternals.afterTaskStarted();
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJzcmMvZGVwZW5kZW5jeS13b3JrZXJzLWV4cG9ydHMuanMiLCJzcmMvZGVwZW5kZW5jeS13b3JrZXJzLXRhc2stY29udGV4dC5qcyIsInNyYy9kZXBlbmRlbmN5LXdvcmtlcnMtdGFzay1pbnRlcm5hbHMuanMiLCJzcmMvZGVwZW5kZW5jeS13b3JrZXJzLXRhc2stc2NoZWR1bGVyLmpzIiwic3JjL2RlcGVuZGVuY3ktd29ya2Vycy10YXNrLmpzIiwic3JjL2RlcGVuZGVuY3ktd29ya2Vycy5qcyIsInNyYy9oYXNoLW1hcC5qcyIsInNyYy9qcy1idWlsdGluLWhhc2gtbWFwLmpzIiwic3JjL2xpbmtlZC1saXN0LmpzIiwic3JjL3NjaGVkdWxlci1kZXBlbmRlbmN5LXdvcmtlcnMuanMiLCJzcmMvd3JhcHBlci1pbnB1dC1yZXRyZWl2ZXItYmFzZS5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTtBQ0FBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDUEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2xEQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BlQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNsQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbkdBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNwS0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNwSkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM1QkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNwR0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDakZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSIsImZpbGUiOiJnZW5lcmF0ZWQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlc0NvbnRlbnQiOlsiKGZ1bmN0aW9uIGUodCxuLHIpe2Z1bmN0aW9uIHMobyx1KXtpZighbltvXSl7aWYoIXRbb10pe3ZhciBhPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7aWYoIXUmJmEpcmV0dXJuIGEobywhMCk7aWYoaSlyZXR1cm4gaShvLCEwKTt2YXIgZj1uZXcgRXJyb3IoXCJDYW5ub3QgZmluZCBtb2R1bGUgJ1wiK28rXCInXCIpO3Rocm93IGYuY29kZT1cIk1PRFVMRV9OT1RfRk9VTkRcIixmfXZhciBsPW5bb109e2V4cG9ydHM6e319O3Rbb11bMF0uY2FsbChsLmV4cG9ydHMsZnVuY3Rpb24oZSl7dmFyIG49dFtvXVsxXVtlXTtyZXR1cm4gcyhuP246ZSl9LGwsbC5leHBvcnRzLGUsdCxuLHIpfXJldHVybiBuW29dLmV4cG9ydHN9dmFyIGk9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtmb3IodmFyIG89MDtvPHIubGVuZ3RoO28rKylzKHJbb10pO3JldHVybiBzfSkiLCIndXNlIHN0cmljdCc7XHJcblxyXG5tb2R1bGUuZXhwb3J0cy5EZXBlbmRlbmN5V29ya2VycyA9IHJlcXVpcmUoJ2RlcGVuZGVuY3ktd29ya2VycycpO1xyXG5tb2R1bGUuZXhwb3J0cy5EZXBlbmRlbmN5V29ya2Vyc1Rhc2tDb250ZXh0ID0gcmVxdWlyZSgnZGVwZW5kZW5jeS13b3JrZXJzLXRhc2stY29udGV4dCcpO1xyXG5tb2R1bGUuZXhwb3J0cy5EZXBlbmRlbmN5V29ya2Vyc1Rhc2sgPSByZXF1aXJlKCdkZXBlbmRlbmN5LXdvcmtlcnMtdGFzaycpO1xyXG5tb2R1bGUuZXhwb3J0cy5XcmFwcGVySW5wdXRSZXRyZWl2ZXJCYXNlID0gcmVxdWlyZSgnd3JhcHBlci1pbnB1dC1yZXRyZWl2ZXItYmFzZScpO1xyXG5tb2R1bGUuZXhwb3J0cy5TY2hlZHVsZXJEZXBlbmRlbmN5V29ya2VycyA9IHJlcXVpcmUoJ3NjaGVkdWxlci1kZXBlbmRlbmN5LXdvcmtlcnMnKTtcclxubW9kdWxlLmV4cG9ydHMuRGVwZW5kZW5jeVdvcmtlcnNUYXNrU2NoZWR1bGVyID0gcmVxdWlyZSgnZGVwZW5kZW5jeS13b3JrZXJzLXRhc2stc2NoZWR1bGVyJyk7IiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxudmFyIERlcGVuZGVuY3lXb3JrZXJzVGFza0NvbnRleHQgPSAoZnVuY3Rpb24gRGVwZW5kZW5jeVdvcmtlcnNUYXNrQ29udGV4dENsb3N1cmUoKSB7XHJcbiAgICBmdW5jdGlvbiBEZXBlbmRlbmN5V29ya2Vyc1Rhc2tDb250ZXh0KHRhc2tJbnRlcm5hbHMsIGNhbGxiYWNrcykge1xyXG4gICAgICAgIHRoaXMuX3Rhc2tJbnRlcm5hbHMgPSB0YXNrSW50ZXJuYWxzO1xyXG4gICAgICAgIHRoaXMuX2NhbGxiYWNrcyA9IGNhbGxiYWNrcztcclxuICAgICAgICB0aGlzLl90YXNrQ29udGV4dHNJdGVyYXRvciA9IHRhc2tJbnRlcm5hbHMudGFza0NvbnRleHRzLmFkZCh0aGlzKTtcclxuICAgICAgICBpZiAoY2FsbGJhY2tzLnByaW9yaXR5Q2FsY3VsYXRvcikge1xyXG4gICAgICAgICAgICB0aGlzLl9wcmlvcml0eUNhbGN1bGF0b3JJdGVyYXRvciA9IHRoaXMuX3Rhc2tJbnRlcm5hbHMucHJpb3JpdHlDYWxjdWxhdG9ycy5hZGQoY2FsbGJhY2tzKTtcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICB0aGlzLl9wcmlvcml0eUNhbGN1bGF0b3JJdGVyYXRvciA9IG51bGw7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgXHJcbiAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkoRGVwZW5kZW5jeVdvcmtlcnNUYXNrQ29udGV4dC5wcm90b3R5cGUsICdpc0FjdGl2ZScsIHsgZ2V0OiBmdW5jdGlvbigpIHtcclxuICAgICAgICByZXR1cm4gdGhpcy5fdGFza0ludGVybmFscy5pc0FjdHVhbFRlcm1pbmF0aW9uUGVuZGluZyB8fCAhdGhpcy5fdGFza0ludGVybmFscy5pc1Rlcm1pbmF0ZWQ7XHJcbiAgICB9IH0pO1xyXG4gICAgXHJcbiAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkoRGVwZW5kZW5jeVdvcmtlcnNUYXNrQ29udGV4dC5wcm90b3R5cGUsICdpc1Rlcm1pbmF0ZWQnLCB7IGdldDogZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgcmV0dXJuIHRoaXMuX3Rhc2tJbnRlcm5hbHMuaXNUZXJtaW5hdGVkO1xyXG4gICAgfSB9KTtcclxuICAgIFxyXG4gICAgRGVwZW5kZW5jeVdvcmtlcnNUYXNrQ29udGV4dC5wcm90b3R5cGUuZ2V0UHJvY2Vzc2VkRGF0YSA9IGZ1bmN0aW9uIGdldFByb2Nlc3NlZERhdGEoKSB7XHJcbiAgICAgICAgcmV0dXJuIHRoaXMuX3Rhc2tJbnRlcm5hbHMucHJvY2Vzc2VkRGF0YTtcclxuICAgIH07XHJcbiAgICBcclxuICAgIERlcGVuZGVuY3lXb3JrZXJzVGFza0NvbnRleHQucHJvdG90eXBlLnVucmVnaXN0ZXIgPSBmdW5jdGlvbigpIHtcclxuICAgICAgICBpZiAoIXRoaXMuX3Rhc2tDb250ZXh0c0l0ZXJhdG9yKSB7XHJcbiAgICAgICAgICAgIHRocm93ICdkZXBlbmRlbmN5V29ya2VyczogQWxyZWFkeSB1bnJlZ2lzdGVyZWQnO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBpZiAodGhpcy5fcHJpb3JpdHlDYWxjdWxhdG9ySXRlcmF0b3IgIT09IG51bGwpIHtcclxuICAgICAgICAgICAgdGhpcy5fdGFza0ludGVybmFscy5wcmlvcml0eUNhbGN1bGF0b3JzLnJlbW92ZSh0aGlzLl9wcmlvcml0eUNhbGN1bGF0b3JJdGVyYXRvcik7XHJcbiAgICAgICAgICAgIHRoaXMuX3ByaW9yaXR5Q2FsY3VsYXRvckl0ZXJhdG9yID0gbnVsbDtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgdGhpcy5fdGFza0ludGVybmFscy50YXNrQ29udGV4dHMucmVtb3ZlKHRoaXMuX3Rhc2tDb250ZXh0c0l0ZXJhdG9yKTtcclxuICAgICAgICB0aGlzLl90YXNrQ29udGV4dHNJdGVyYXRvciA9IG51bGw7XHJcbiAgICAgICAgaWYgKCF0aGlzLl90YXNrSW50ZXJuYWxzLmlzVGVybWluYXRlZCkge1xyXG4gICAgICAgICAgICBpZiAodGhpcy5fdGFza0ludGVybmFscy50YXNrQ29udGV4dHMuZ2V0Q291bnQoKSA9PT0gMCkge1xyXG4gICAgICAgICAgICAgICAgdGhpcy5fdGFza0ludGVybmFscy5hYm9ydCgvKmFib3J0QnlTY2hlZHVsZXI9Ki9mYWxzZSk7XHJcbiAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICB0aGlzLl90YXNrSW50ZXJuYWxzLnN0YXR1c1VwZGF0ZSgpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgfTtcclxuXHJcbiAgICByZXR1cm4gRGVwZW5kZW5jeVdvcmtlcnNUYXNrQ29udGV4dDtcclxufSkoKTtcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gRGVwZW5kZW5jeVdvcmtlcnNUYXNrQ29udGV4dDsiLCIndXNlIHN0cmljdCc7XHJcblxyXG52YXIgTGlua2VkTGlzdCA9IHJlcXVpcmUoJ2xpbmtlZC1saXN0Jyk7XHJcbnZhciBKc0J1aWx0aW5IYXNoTWFwID0gcmVxdWlyZSgnanMtYnVpbHRpbi1oYXNoLW1hcCcpO1xyXG52YXIgRGVwZW5kZW5jeVdvcmtlcnNUYXNrID0gcmVxdWlyZSgnZGVwZW5kZW5jeS13b3JrZXJzLXRhc2snKTtcclxuXHJcbnZhciBEZXBlbmRlbmN5V29ya2Vyc1Rhc2tJbnRlcm5hbHMgPSAoZnVuY3Rpb24gRGVwZW5kZW5jeVdvcmtlcnNUYXNrSW50ZXJuYWxzQ2xvc3VyZSgpIHtcclxuICAgIGZ1bmN0aW9uIERlcGVuZGVuY3lXb3JrZXJzVGFza0ludGVybmFscygpIHtcclxuICAgICAgICAvLyBUaGlzIGNsYXNzIGlzIG5vdCBleHBvc2VkIG91dHNpZGUgZGVwZW5kZW5jeVdvcmtlcnMgYnV0IGFzIGFuIGludGVybmFsIHN0cnVjdCwgdGh1cyBcclxuICAgICAgICAvLyBtYXkgY29udGFpbiBwdWJsaWMgbWVtYmVyc1xyXG4gICAgICAgIFxyXG4gICAgICAgIHRoaXMuaXNUZXJtaW5hdGVkID0gZmFsc2U7XHJcbiAgICAgICAgdGhpcy5pc0FjdHVhbFRlcm1pbmF0aW9uUGVuZGluZyA9IGZhbHNlO1xyXG4gICAgICAgIHRoaXMucHJvY2Vzc2VkRGF0YSA9IFtdO1xyXG4gICAgICAgIHRoaXMudGFza0FwaSA9IG51bGw7XHJcbiAgICAgICAgXHJcbiAgICAgICAgdGhpcy5wZW5kaW5nRGF0YUZvcldvcmtlciA9IFtdO1xyXG4gICAgICAgIHRoaXMuY2FuU2tpcExhc3RQZW5kaW5nRGF0YUZvcldvcmtlciA9IGZhbHNlO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHRoaXMudGFza0NvbnRleHRzID0gbmV3IExpbmtlZExpc3QoKTtcclxuICAgICAgICB0aGlzLnByaW9yaXR5Q2FsY3VsYXRvcnMgPSBuZXcgTGlua2VkTGlzdCgpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHRoaXMudGFza0tleSA9IG51bGw7XHJcbiAgICAgICAgdGhpcy5fZGVwZW5kc1Rhc2tzVGVybWluYXRlZENvdW50ID0gMDtcclxuICAgICAgICB0aGlzLl9wYXJlbnREZXBlbmRlbmN5V29ya2VycyA9IG51bGw7XHJcbiAgICAgICAgdGhpcy5fd29ya2VySW5wdXRSZXRyZWl2ZXIgPSBudWxsO1xyXG4gICAgICAgIHRoaXMuX3BhcmVudExpc3QgPSBudWxsO1xyXG4gICAgICAgIHRoaXMuX3BhcmVudEl0ZXJhdG9yID0gbnVsbDtcclxuICAgICAgICB0aGlzLl9kZXBlbmRzVGFza0NvbnRleHRzID0gbnVsbDtcclxuICAgICAgICB0aGlzLl9wcmlvcml0eUNhbGN1bGF0b3IgPSBudWxsO1xyXG4gICAgICAgIHRoaXMuX2lzRGV0YWNoZWQgPSBmYWxzZTtcclxuICAgICAgICB0aGlzLl9jYW5Ta2lwTGFzdFByb2Nlc3NlZERhdGEgPSBmYWxzZTtcclxuICAgICAgICB0aGlzLl9qb2JDYWxsYmFja3MgPSBudWxsO1xyXG4gICAgICAgIHRoaXMuX2lzQWJvcnRlZCA9IGZhbHNlO1xyXG4gICAgICAgIHRoaXMuX2lzQWJvcnRlZE5vdEJ5U2NoZWR1bGVyID0gZmFsc2U7XHJcbiAgICAgICAgdGhpcy5faXNVc2VyQ2FsbGVkVGVybWluYXRlID0gZmFsc2U7XHJcbiAgICAgICAgdGhpcy5faXNXYWl0aW5nRm9yV29ya2VyUmVzdWx0ID0gZmFsc2U7XHJcbiAgICAgICAgXHJcbiAgICAgICAgdGhpcy5fZGVwZW5kVGFza0tleXMgPSBbXTtcclxuICAgICAgICB0aGlzLl9kZXBlbmRUYXNrUmVzdWx0cyA9IFtdO1xyXG4gICAgICAgIHRoaXMuX2hhc0RlcGVuZFRhc2tEYXRhID0gW107XHJcbiAgICAgICAgXHJcbiAgICAgICAgdGhpcy5fc2hvdWxkRGVsYXlBY3Rpb25zID0gdHJ1ZTtcclxuICAgICAgICB0aGlzLl9wZW5kaW5nRGVsYXllZEFjdGlvbiA9IGZhbHNlO1xyXG4gICAgICAgIHRoaXMuX3BlbmRpbmdEZWxheWVkRGVwZW5kZW5jeURhdGEgPSBbXTtcclxuICAgICAgICB0aGlzLl9wZW5kaW5nRGVsYXllZEVuZGVkID0gZmFsc2U7XHJcbiAgICAgICAgdGhpcy5fcGVuZGluZ0RlbGF5ZWROZXdEYXRhID0gW107XHJcbiAgICAgICAgdGhpcy5fcGVuZGluZ0RlbGF5ZWRDYW5Ta2lwTGFzdE5ld0RhdGEgPSBmYWxzZTtcclxuICAgICAgICB0aGlzLl9wZW5kaW5nV29ya2VyRG9uZSA9IGZhbHNlO1xyXG4gICAgICAgIHRoaXMuX3BlbmRpbmdEZWxheWVkRGVwZW5kc1Rhc2tUZXJtaW5hdGVkID0gMDtcclxuICAgICAgICBcclxuICAgICAgICB2YXIgdGhhdCA9IHRoaXM7XHJcbiAgICAgICAgdGhpcy5fcHJpb3JpdHlDYWxjdWxhdG9yID0gZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgICAgIHJldHVybiB0aGF0LmNhbGN1bGF0ZVByaW9yaXR5KCk7XHJcbiAgICAgICAgfTtcclxuICAgICAgICB0aGlzLl9zY2hlZHVsZU5vdGlmaWVyID0ge1xyXG4gICAgICAgICAgICAnY2FsY3VsYXRlUHJpb3JpdHknOiB0aGlzLl9wcmlvcml0eUNhbGN1bGF0b3IsXHJcbiAgICAgICAgICAgICdzY2hlZHVsZSc6IGZ1bmN0aW9uKGpvYkNhbGxiYWNrcykge1xyXG4gICAgICAgICAgICAgICAgaWYgKHRoYXQuX2pvYkNhbGxiYWNrcyAhPT0gbnVsbCkge1xyXG4gICAgICAgICAgICAgICAgICAgIHRocm93ICdkZXBlbmRlbmN5V29ya2Vyczogc2NoZWR1bGVOb3RpZmllci5zY2hlZHVsZSB3YXMgY2FsbGVkIHR3aWNlJztcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgaWYgKCgham9iQ2FsbGJhY2tzKSB8fCAham9iQ2FsbGJhY2tzWydqb2JEb25lJ10pIHtcclxuICAgICAgICAgICAgICAgICAgICB0aHJvdyAnZGVwZW5kZW5jeVdvcmtlcnM6IFBhc3NlZCBpbnZhbGlkIGpvYkNhbGxiYWNrcyBhcmd1bWVudCB0byBzY2hlZHVsZU5vdGlmaWVyLnNjaGVkdWxlKCkuIEVuc3VyZSBqb2JDYWxsYmFja3MgaGFzIGpvYkRvbmUgbWV0aG9kJztcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgaWYgKHRoYXQuX2lzQWJvcnRlZE5vdEJ5U2NoZWR1bGVyKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgam9iQ2FsbGJhY2tzLmpvYkRvbmUoKTtcclxuICAgICAgICAgICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIGlmICh0aGlzLmlzVGVybWluYXRlZCAmJiAhdGhpcy5pc0FjdHVhbFRlcm1pbmF0aW9uUGVuZGluZykge1xyXG4gICAgICAgICAgICAgICAgICAgIHRocm93ICdkZXBlbmRlbmN5V29ya2Vyczogc2NoZWR1bGVkIGFmdGVyIHRlcm1pbmF0aW9uJztcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgdmFyIGRhdGFUb1Byb2Nlc3MgPSB0aGF0LnBlbmRpbmdEYXRhRm9yV29ya2VyLnNoaWZ0KCk7XHJcbiAgICAgICAgICAgICAgICB2YXIgY2FuU2tpcCA9IGZhbHNlO1xyXG4gICAgICAgICAgICAgICAgaWYgKHRoYXQucGVuZGluZ0RhdGFGb3JXb3JrZXIubGVuZ3RoID09PSAwKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY2FuU2tpcCA9IHRoYXQuY2FuU2tpcExhc3RQZW5kaW5nRGF0YUZvcldvcmtlcjtcclxuICAgICAgICAgICAgICAgICAgICB0aGF0LmNhblNraXBMYXN0UGVuZGluZ0RhdGFGb3JXb3JrZXIgPSBmYWxzZTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgdGhhdC5fam9iQ2FsbGJhY2tzID0gam9iQ2FsbGJhY2tzO1xyXG4gICAgICAgICAgICAgICAgdGhhdC5fcGFyZW50RGVwZW5kZW5jeVdvcmtlcnMuX2RhdGFSZWFkeShcclxuICAgICAgICAgICAgICAgICAgICB0aGF0LFxyXG4gICAgICAgICAgICAgICAgICAgIGRhdGFUb1Byb2Nlc3MuZGF0YSxcclxuICAgICAgICAgICAgICAgICAgICBkYXRhVG9Qcm9jZXNzLndvcmtlclR5cGUsXHJcbiAgICAgICAgICAgICAgICAgICAgY2FuU2tpcCk7XHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgICdhYm9ydCc6IGZ1bmN0aW9uKGFib3J0ZWRCeVNjaGVkdWxlcikge1xyXG4gICAgICAgICAgICAgICAgdGhhdC5hYm9ydChhYm9ydGVkQnlTY2hlZHVsZXIpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgRGVwZW5kZW5jeVdvcmtlcnNUYXNrSW50ZXJuYWxzLnByb3RvdHlwZS5pbml0aWFsaXplID0gZnVuY3Rpb24oXHJcbiAgICAgICAgICAgIHRhc2tLZXksIGRlcGVuZGVuY3lXb3JrZXJzLCBpbnB1dFJldHJlaXZlciwgbGlzdCwgaXRlcmF0b3IgLyosIGhhc2hlciovKSB7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICB0aGlzLnRhc2tLZXkgPSB0YXNrS2V5O1xyXG4gICAgICAgIHRoaXMuX3BhcmVudERlcGVuZGVuY3lXb3JrZXJzID0gZGVwZW5kZW5jeVdvcmtlcnM7XHJcbiAgICAgICAgdGhpcy5fd29ya2VySW5wdXRSZXRyZWl2ZXIgPSBpbnB1dFJldHJlaXZlcjtcclxuICAgICAgICB0aGlzLl9wYXJlbnRMaXN0ID0gbGlzdDtcclxuICAgICAgICB0aGlzLl9wYXJlbnRJdGVyYXRvciA9IGl0ZXJhdG9yO1xyXG4gICAgICAgIHRoaXMuX2RlcGVuZHNUYXNrQ29udGV4dHMgPSBuZXcgSnNCdWlsdGluSGFzaE1hcCgpO1xyXG4gICAgICAgIHRoaXMudGFza0FwaSA9IG5ldyBEZXBlbmRlbmN5V29ya2Vyc1Rhc2sodGhpcywgdGFza0tleSk7XHJcbiAgICAgICAgZGVwZW5kZW5jeVdvcmtlcnMuaW5pdGlhbGl6aW5nVGFzayh0aGlzLnRhc2tBcGksIHRoaXMuX3NjaGVkdWxlTm90aWZpZXIpO1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgRGVwZW5kZW5jeVdvcmtlcnNUYXNrSW50ZXJuYWxzLnByb3RvdHlwZS5hZnRlclRhc2tTdGFydGVkID0gZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgdGhpcy5fc2hvdWxkRGVsYXlBY3Rpb25zID0gZmFsc2U7XHJcbiAgICAgICAgdGhpcy5fcGVyZm9ybVBlbmRpbmdEZWxheWVkQWN0aW9ucygpO1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgRGVwZW5kZW5jeVdvcmtlcnNUYXNrSW50ZXJuYWxzLnByb3RvdHlwZS5lbmRlZCA9IGZ1bmN0aW9uKCkge1xyXG4gICAgICAgIHRoaXMuX3BlbmRpbmdEZWxheWVkRW5kZWQgPSB0cnVlO1xyXG4gICAgICAgIHRoaXMuX3NjaGVkdWxlUGVuZGluZ0RlbGF5ZWRBY3Rpb25zKCk7XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBEZXBlbmRlbmN5V29ya2Vyc1Rhc2tJbnRlcm5hbHMucHJvdG90eXBlLnN0YXR1c1VwZGF0ZSA9IGZ1bmN0aW9uKCkge1xyXG4gICAgICAgIHZhciBzdGF0dXMgPSB7XHJcbiAgICAgICAgICAgICdoYXNMaXN0ZW5lcnMnOiB0aGlzLnRhc2tDb250ZXh0cy5nZXRDb3VudCgpID4gMCxcclxuICAgICAgICAgICAgJ2lzV2FpdGluZ0ZvcldvcmtlclJlc3VsdCc6IHRoaXMuX2lzV2FpdGluZ0ZvcldvcmtlclJlc3VsdCxcclxuICAgICAgICAgICAgJ3Rlcm1pbmF0ZWREZXBlbmRzVGFza3MnOiB0aGlzLl9kZXBlbmRzVGFza3NUZXJtaW5hdGVkQ291bnQsXHJcbiAgICAgICAgICAgICdkZXBlbmRzVGFza3MnOiB0aGlzLl9kZXBlbmRzVGFza0NvbnRleHRzLmdldENvdW50KClcclxuICAgICAgICB9O1xyXG4gICAgICAgIHRoaXMudGFza0FwaS5fb25FdmVudCgnc3RhdHVzVXBkYXRlZCcsIHN0YXR1cyk7XHJcblxyXG4gICAgICAgIGlmICh0aGlzLmlzQWN0dWFsVGVybWluYXRpb25QZW5kaW5nICYmICF0aGlzLl9pc1dhaXRpbmdGb3JXb3JrZXJSZXN1bHQpIHtcclxuICAgICAgICAgICAgdGhpcy5pc0FjdHVhbFRlcm1pbmF0aW9uUGVuZGluZyA9IGZhbHNlO1xyXG4gICAgICAgICAgICB0aGlzLmVuZGVkKCk7XHJcbiAgICAgICAgfVxyXG4gICAgfTtcclxuICAgIFxyXG4gICAgRGVwZW5kZW5jeVdvcmtlcnNUYXNrSW50ZXJuYWxzLnByb3RvdHlwZS5jYWxjdWxhdGVQcmlvcml0eSA9IGZ1bmN0aW9uKCkge1xyXG4gICAgICAgIHZhciBpdGVyYXRvciA9IHRoaXMucHJpb3JpdHlDYWxjdWxhdG9ycy5nZXRGaXJzdEl0ZXJhdG9yKCk7XHJcbiAgICAgICAgdmFyIGlzRmlyc3QgPSB0cnVlO1xyXG4gICAgICAgIHZhciBwcmlvcml0eSA9IDA7XHJcbiAgICAgICAgd2hpbGUgKGl0ZXJhdG9yICE9PSBudWxsKSB7XHJcbiAgICAgICAgICAgIHZhciBjYWxsYmFja3MgPSB0aGlzLnByaW9yaXR5Q2FsY3VsYXRvcnMuZ2V0RnJvbUl0ZXJhdG9yKGl0ZXJhdG9yKTtcclxuICAgICAgICAgICAgdmFyIGN1cnJlbnRQcmlvcml0eSA9IGNhbGxiYWNrcy5wcmlvcml0eUNhbGN1bGF0b3IoKTtcclxuICAgICAgICAgICAgaWYgKGlzRmlyc3QgfHwgY3VycmVudFByaW9yaXR5ID4gcHJpb3JpdHkpIHtcclxuICAgICAgICAgICAgICAgIHByaW9yaXR5ID0gY3VycmVudFByaW9yaXR5O1xyXG4gICAgICAgICAgICAgICAgaXNGaXJzdCA9IGZhbHNlO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGl0ZXJhdG9yID0gdGhpcy5wcmlvcml0eUNhbGN1bGF0b3JzLmdldE5leHRJdGVyYXRvcihpdGVyYXRvcik7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICByZXR1cm4gcHJpb3JpdHk7XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBEZXBlbmRlbmN5V29ya2Vyc1Rhc2tJbnRlcm5hbHMucHJvdG90eXBlLm5ld0RhdGEgPSBmdW5jdGlvbihkYXRhLCBjYW5Ta2lwKSB7XHJcbiAgICAgICAgaWYgKHRoaXMuX3BlbmRpbmdEZWxheWVkQ2FuU2tpcExhc3ROZXdEYXRhKSB7XHJcbiAgICAgICAgICAgIHRoaXMuX3BlbmRpbmdEZWxheWVkTmV3RGF0YVt0aGlzLl9wZW5kaW5nRGVsYXllZE5ld0RhdGEubGVuZ3RoIC0gMV0gPSBkYXRhO1xyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgIHRoaXMuX3BlbmRpbmdEZWxheWVkTmV3RGF0YS5wdXNoKGRhdGEpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICB0aGlzLl9wZW5kaW5nRGVsYXllZENhblNraXBMYXN0TmV3RGF0YSA9ICEhY2FuU2tpcDtcclxuICAgICAgICB0aGlzLl9zY2hlZHVsZVBlbmRpbmdEZWxheWVkQWN0aW9ucygpO1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgRGVwZW5kZW5jeVdvcmtlcnNUYXNrSW50ZXJuYWxzLnByb3RvdHlwZS53b3JrZXJEb25lID0gZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgaWYgKHRoaXMuX2pvYkNhbGxiYWNrcyA9PT0gbnVsbCkge1xyXG4gICAgICAgICAgICB0aHJvdyAnZGVwZW5kZW5jeVdvcmtlcnM6IEpvYiBkb25lIHdpdGhvdXQgcHJldmlvdXNseSBzdGFydGVkJztcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgdmFyIGpvYkNhbGxiYWNrcyA9IHRoaXMuX2pvYkNhbGxiYWNrcztcclxuICAgICAgICB0aGlzLl9qb2JDYWxsYmFja3MgPSBudWxsO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGlmICh0aGlzLnBlbmRpbmdEYXRhRm9yV29ya2VyLmxlbmd0aCA9PT0gMCkge1xyXG4gICAgICAgICAgICB0aGlzLl9wZW5kaW5nV29ya2VyRG9uZSA9IHRydWU7XHJcbiAgICAgICAgICAgIHRoaXMuX3NjaGVkdWxlUGVuZGluZ0RlbGF5ZWRBY3Rpb25zKCk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIGpvYkNhbGxiYWNrc1snam9iRG9uZSddKCk7XHJcblxyXG4gICAgICAgIGlmICh0aGlzLnBlbmRpbmdEYXRhRm9yV29ya2VyLmxlbmd0aCA+IDApIHtcclxuICAgICAgICAgICAgdGhpcy53YWl0Rm9yU2NoZWR1bGUoKTtcclxuICAgICAgICB9XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBEZXBlbmRlbmN5V29ya2Vyc1Rhc2tJbnRlcm5hbHMucHJvdG90eXBlLmRhdGFSZWFkeSA9IGZ1bmN0aW9uIGRhdGFSZWFkeShcclxuICAgICAgICBuZXdEYXRhVG9Qcm9jZXNzLCB3b3JrZXJUeXBlLCBjYW5Ta2lwKSB7XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKHRoaXMuaXNUZXJtaW5hdGVkKSB7XHJcbiAgICAgICAgICAgIGlmICh0aGlzLl9pc1VzZXJDYWxsZWRUZXJtaW5hdGUpIHtcclxuICAgICAgICAgICAgICAgIHRocm93ICdkZXBlbmRlbmN5V29ya2VyczogYWxyZWFkeSB0ZXJtaW5hdGVkJztcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICAvLyBVc2VkIGluIERlcGVuZGVuY3lXb3JrZXJzLl9zdGFydFdvcmtlcigpIHdoZW4gcHJldmlvdXMgd29ya2VyIGhhcyBmaW5pc2hlZFxyXG4gICAgICAgIHZhciBwZW5kaW5nRGF0YSA9IHtcclxuICAgICAgICAgICAgZGF0YTogbmV3RGF0YVRvUHJvY2VzcyxcclxuICAgICAgICAgICAgd29ya2VyVHlwZTogd29ya2VyVHlwZVxyXG4gICAgICAgIH07XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKHRoaXMuY2FuU2tpcExhc3RQZW5kaW5nRGF0YUZvcldvcmtlcikge1xyXG4gICAgICAgICAgICB0aGlzLnBlbmRpbmdEYXRhRm9yV29ya2VyW3RoaXMucGVuZGluZ0RhdGFGb3JXb3JrZXIubGVuZ3RoIC0gMV0gPSBwZW5kaW5nRGF0YTtcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICB0aGlzLnBlbmRpbmdEYXRhRm9yV29ya2VyLnB1c2gocGVuZGluZ0RhdGEpO1xyXG4gICAgICAgIH1cclxuICAgICAgICB0aGlzLmNhblNraXBMYXN0UGVuZGluZ0RhdGFGb3JXb3JrZXIgPSAhIWNhblNraXA7XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKCF0aGlzLl9pc1dhaXRpbmdGb3JXb3JrZXJSZXN1bHQgfHwgdGhpcy5fcGVuZGluZ1dvcmtlckRvbmUpIHtcclxuICAgICAgICAgICAgdGhpcy5faXNXYWl0aW5nRm9yV29ya2VyUmVzdWx0ID0gdHJ1ZTtcclxuICAgICAgICAgICAgdGhpcy5fcGVuZGluZ1dvcmtlckRvbmUgPSBmYWxzZTtcclxuICAgICAgICAgICAgdGhpcy53YWl0Rm9yU2NoZWR1bGUoKTtcclxuICAgICAgICAgICAgdGhpcy5zdGF0dXNVcGRhdGUoKTtcclxuICAgICAgICB9XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBEZXBlbmRlbmN5V29ya2Vyc1Rhc2tJbnRlcm5hbHMucHJvdG90eXBlLndhaXRGb3JTY2hlZHVsZSA9IGZ1bmN0aW9uIHdhaXRGb3JTY2hlZHVsZSgpIHtcclxuICAgICAgICB2YXIgd29ya2VyVHlwZSA9IHRoaXMucGVuZGluZ0RhdGFGb3JXb3JrZXJbMF0ud29ya2VyVHlwZTtcclxuICAgICAgICB0aGlzLl9wYXJlbnREZXBlbmRlbmN5V29ya2Vycy53YWl0Rm9yU2NoZWR1bGUodGhpcy5fc2NoZWR1bGVOb3RpZmllciwgd29ya2VyVHlwZSk7XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBEZXBlbmRlbmN5V29ya2Vyc1Rhc2tJbnRlcm5hbHMucHJvdG90eXBlLmRldGFjaEJlZm9yZVRlcm1pbmF0aW9uID0gZnVuY3Rpb24gZGV0YWNoKCkge1xyXG4gICAgICAgIGlmICh0aGlzLl9pc0RldGFjaGVkKSB7XHJcbiAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgdGhpcy5faXNEZXRhY2hlZCA9IHRydWU7XHJcbiAgICAgICAgdGhpcy5fcGFyZW50TGlzdC5yZW1vdmUodGhpcy5fcGFyZW50SXRlcmF0b3IpO1xyXG4gICAgICAgIHRoaXMuX3BhcmVudEl0ZXJhdG9yID0gbnVsbDtcclxuXHJcbiAgICAgICAgdmFyIGl0ZXJhdG9yID0gdGhpcy5fZGVwZW5kc1Rhc2tDb250ZXh0cy5nZXRGaXJzdEl0ZXJhdG9yKCk7XHJcbiAgICAgICAgd2hpbGUgKGl0ZXJhdG9yICE9PSBudWxsKSB7XHJcbiAgICAgICAgICAgIHZhciBjb250ZXh0ID0gdGhpcy5fZGVwZW5kc1Rhc2tDb250ZXh0cy5nZXRGcm9tSXRlcmF0b3IoaXRlcmF0b3IpLnRhc2tDb250ZXh0O1xyXG4gICAgICAgICAgICBpdGVyYXRvciA9IHRoaXMuX2RlcGVuZHNUYXNrQ29udGV4dHMuZ2V0TmV4dEl0ZXJhdG9yKGl0ZXJhdG9yKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGNvbnRleHQudW5yZWdpc3RlcigpO1xyXG4gICAgICAgIH1cclxuICAgICAgICB0aGlzLl9kZXBlbmRzVGFza0NvbnRleHRzLmNsZWFyKCk7XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBEZXBlbmRlbmN5V29ya2Vyc1Rhc2tJbnRlcm5hbHMucHJvdG90eXBlLmN1c3RvbUV2ZW50ID0gZnVuY3Rpb24gY3VzdG9tRXZlbnQoYXJnMCwgYXJnMSkge1xyXG4gICAgICAgIGlmICh0aGlzLmlzVGVybWluYXRlZCAmJiAhdGhpcy5pc0FjdHVhbFRlcm1pbmF0aW9uUGVuZGluZykge1xyXG4gICAgICAgICAgICB0aHJvdyAnZGVwZW5kZW5jeVdvcmtlcnM6IGFscmVhZHkgdGVybWluYXRlZCc7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHRoaXMuX2l0ZXJhdGVDYWxsYmFja3MoZnVuY3Rpb24oY2FsbGJhY2tzKSB7XHJcbiAgICAgICAgICAgIGlmIChjYWxsYmFja3Mub25DdXN0b20pIHtcclxuICAgICAgICAgICAgICAgIGNhbGxiYWNrcy5vbkN1c3RvbShhcmcwLCBhcmcxKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHRoaXMudGFza0FwaS5fb25FdmVudCgnY3VzdG9tJywgYXJnMCwgYXJnMSk7XHJcbiAgICB9O1xyXG5cclxuICAgIERlcGVuZGVuY3lXb3JrZXJzVGFza0ludGVybmFscy5wcm90b3R5cGUudGVybWluYXRlID0gZnVuY3Rpb24gdGVybWluYXRlKCkge1xyXG4gICAgICAgIGlmICh0aGlzLl9pc1VzZXJDYWxsZWRUZXJtaW5hdGUpIHtcclxuICAgICAgICAgICAgdGhyb3cgJ2RlcGVuZGVuY3lXb3JrZXJzOiBhbHJlYWR5IHRlcm1pbmF0ZWQnO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICB0aGlzLl9pc1VzZXJDYWxsZWRUZXJtaW5hdGUgPSB0cnVlO1xyXG4gICAgICAgIHRoaXMuX3Rlcm1pbmF0ZUludGVybmFsKCk7XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBEZXBlbmRlbmN5V29ya2Vyc1Rhc2tJbnRlcm5hbHMucHJvdG90eXBlLmFib3J0ID0gZnVuY3Rpb24gYWJvcnQoYWJvcnRlZEJ5U2NoZWR1bGVyKSB7XHJcbiAgICAgICAgaWYgKHRoaXMuX2lzQWJvcnRlZCkge1xyXG4gICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHRoaXMuX2lzQWJvcnRlZCA9IHRydWU7XHJcbiAgICAgICAgaWYgKHRoaXMuaXNUZXJtaW5hdGVkKSB7XHJcbiAgICAgICAgICAgIGlmICghdGhpcy5pc0FjdHVhbFRlcm1pbmF0aW9uUGVuZGluZyAmJiAhdGhpcy5faXNBYm9ydGVkTm90QnlTY2hlZHVsZXIpIHtcclxuICAgICAgICAgICAgICAgIHRocm93ICdkZXBlbmRlbmN5V29ya2VyczogYWJvcnRlZCBhZnRlciB0ZXJtaW5hdGlvbic7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9IGVsc2UgaWYgKCFhYm9ydGVkQnlTY2hlZHVsZXIpIHtcclxuICAgICAgICAgICAgdGhpcy5faXNBYm9ydGVkTm90QnlTY2hlZHVsZXIgPSB0cnVlO1xyXG4gICAgICAgIH0gZWxzZSBpZiAodGhpcy5wZW5kaW5nRGF0YUZvcldvcmtlci5sZW5ndGggPT09IDApIHtcclxuICAgICAgICAgICAgdGhyb3cgJ2RlcGVuZGVuY3lXb3JrZXJzOiBBYm9ydCB3aXRob3V0IHRhc2sgd2FpdGluZyBmb3Igc2NoZWR1bGUnO1xyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgIHRoaXMuX2lzV2FpdGluZ0ZvcldvcmtlclJlc3VsdCA9IGZhbHNlOyAvLyBvbmx5IGlmIGFib3J0ZWQgYnkgc2NoZWR1bGVyXHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHRoaXMucGVuZGluZ0RhdGFGb3JXb3JrZXIgPSBbXTtcclxuICAgICAgICB0aGlzLmNhblNraXBMYXN0UGVuZGluZ0RhdGFGb3JXb3JrZXIgPSBmYWxzZTtcclxuICAgICAgICBcclxuICAgICAgICBpZiAoIXRoaXMuaXNUZXJtaW5hdGVkKSB7XHJcbiAgICAgICAgICAgIHRoaXMuY3VzdG9tRXZlbnQoJ2Fib3J0aW5nJywgdGhpcy50YXNrS2V5KTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgdGhpcy5fdGVybWluYXRlSW50ZXJuYWwoKTtcclxuICAgIH07XHJcbiAgICBcclxuICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShEZXBlbmRlbmN5V29ya2Vyc1Rhc2tJbnRlcm5hbHMucHJvdG90eXBlLCAnZGVwZW5kVGFza0tleXMnLCB7XHJcbiAgICAgICAgZ2V0OiBmdW5jdGlvbiBnZXREZXBlbmRUYXNrS2V5cygpIHtcclxuICAgICAgICAgICAgcmV0dXJuIHRoaXMuX2RlcGVuZFRhc2tLZXlzO1xyXG4gICAgICAgIH1cclxuICAgIH0pO1xyXG4gICAgXHJcbiAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkoRGVwZW5kZW5jeVdvcmtlcnNUYXNrSW50ZXJuYWxzLnByb3RvdHlwZSwgJ2RlcGVuZFRhc2tSZXN1bHRzJywge1xyXG4gICAgICAgIGdldDogZnVuY3Rpb24gZ2V0RGVwZW5kVGFza1Jlc3VsdHMoKSB7XHJcbiAgICAgICAgICAgIHJldHVybiB0aGlzLl9kZXBlbmRUYXNrUmVzdWx0cztcclxuICAgICAgICB9XHJcbiAgICB9KTtcclxuICAgIFxyXG4gICAgRGVwZW5kZW5jeVdvcmtlcnNUYXNrSW50ZXJuYWxzLnByb3RvdHlwZS5yZWdpc3RlclRhc2tEZXBlbmRlbmN5ID0gZnVuY3Rpb24oXHJcbiAgICAgICAgICAgIHRhc2tLZXkpIHtcclxuICAgICAgICBcclxuICAgICAgICB2YXIgc3RyS2V5ID0gdGhpcy5fd29ya2VySW5wdXRSZXRyZWl2ZXIuZ2V0S2V5QXNTdHJpbmcodGFza0tleSk7XHJcbiAgICAgICAgdmFyIGFkZFJlc3VsdCA9IHRoaXMuX2RlcGVuZHNUYXNrQ29udGV4dHMudHJ5QWRkKHN0cktleSwgZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgICAgIHJldHVybiB7IHRhc2tDb250ZXh0OiBudWxsIH07XHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKCFhZGRSZXN1bHQuaXNOZXcpIHtcclxuICAgICAgICAgICAgdGhyb3cgJ2RlcGVuZGVuY3lXb3JrZXJzOiBDYW5ub3QgYWRkIHRhc2sgZGVwZW5kZW5jeSB0d2ljZSc7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHZhciB0aGF0ID0gdGhpcztcclxuICAgICAgICB2YXIgZ290RGF0YSA9IGZhbHNlO1xyXG4gICAgICAgIHZhciBpc0RlcGVuZHNUYXNrVGVybWluYXRlZCA9IGZhbHNlO1xyXG4gICAgICAgIHZhciBpbmRleCA9IHRoaXMuX2RlcGVuZFRhc2tLZXlzLmxlbmd0aDtcclxuICAgICAgICBcclxuICAgICAgICB0aGlzLl9kZXBlbmRUYXNrS2V5c1tpbmRleF0gPSB0YXNrS2V5O1xyXG4gICAgICAgIFxyXG4gICAgICAgIGFkZFJlc3VsdC52YWx1ZS50YXNrQ29udGV4dCA9IHRoaXMuX3BhcmVudERlcGVuZGVuY3lXb3JrZXJzLnN0YXJ0VGFzayhcclxuICAgICAgICAgICAgdGFza0tleSwge1xyXG4gICAgICAgICAgICAgICAgJ29uRGF0YSc6IG9uRGVwZW5kZW5jeVRhc2tEYXRhLFxyXG4gICAgICAgICAgICAgICAgJ29uVGVybWluYXRlZCc6IG9uRGVwZW5kZW5jeVRhc2tUZXJtaW5hdGVkLFxyXG4gICAgICAgICAgICAgICAgJ29uQ3VzdG9tJzogb25EZXBlbmRlbmN5VGFza0N1c3RvbSxcclxuICAgICAgICAgICAgICAgICdwcmlvcml0eUNhbGN1bGF0b3InOiB0aGlzLl9wcmlvcml0eUNhbGN1bGF0b3IsXHJcbiAgICAgICAgICAgICAgICBjYWxsZWVGb3JEZWJ1ZzogdGhpc1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgKTtcclxuICAgICAgICBcclxuICAgICAgICBpZiAoIWFkZFJlc3VsdC52YWx1ZS50YXNrQ29udGV4dC5pc0FjdGl2ZSAmJiAhZ290RGF0YSkge1xyXG4gICAgICAgICAgICB0aHJvdyAnZGVwZW5kZW5jeS13b3JrZXJzIGVycm9yOiBkZXBlbmRhbnQgdGFzayBhbHJlYWR5IHRlcm1pbmF0ZWQgd2l0aG91dCBkYXRhJztcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gTWlnaHQgYmUgcmVtb3ZlZDogQ29kZSBmb3IgZGVidWcgd2hpY2ggcmVsaWVzIG9uIGludGVybmFsIG1lbWJlciB0YXNrQ29udGV4dC5fdGFza0ludGVybmFsc1xyXG4gICAgICAgIGlmIChhZGRSZXN1bHQudmFsdWUudGFza0NvbnRleHQuX3Rhc2tJbnRlcm5hbHMuX2lzQWJvcnRlZCkge1xyXG4gICAgICAgICAgICB0aHJvdyAnZGVwZW5kZW5jeVdvcmtlcnMgZXJyb3I6IGRlcGVuZGFudCB0YXNrIGFscmVhZHkgYWJvcnRlZCc7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHZhciBwcm9jZXNzZWREYXRhID0gYWRkUmVzdWx0LnZhbHVlLnRhc2tDb250ZXh0LmdldFByb2Nlc3NlZERhdGEoKTtcclxuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IHByb2Nlc3NlZERhdGEubGVuZ3RoOyArK2kpIHtcclxuICAgICAgICAgICAgdGhpcy5fcGVuZGluZ0RlbGF5ZWREZXBlbmRlbmN5RGF0YS5wdXNoKHtcclxuICAgICAgICAgICAgICAgIGRhdGE6IHByb2Nlc3NlZERhdGFbaV0sXHJcbiAgICAgICAgICAgICAgICBvbkRlcGVuZGVuY3lUYXNrRGF0YTogb25EZXBlbmRlbmN5VGFza0RhdGFcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIGlmIChwcm9jZXNzZWREYXRhLmxlbmd0aCA+IDApIHtcclxuICAgICAgICAgICAgdGhpcy5fc2NoZWR1bGVQZW5kaW5nRGVsYXllZEFjdGlvbnMoKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgcmV0dXJuIGFkZFJlc3VsdC52YWx1ZS50YXNrQ29udGV4dDtcclxuICAgICAgICBcclxuICAgICAgICBmdW5jdGlvbiBvbkRlcGVuZGVuY3lUYXNrRGF0YShkYXRhKSB7XHJcbiAgICAgICAgICAgIGdvdERhdGEgPSB0cnVlO1xyXG4gICAgICAgICAgICBpZiAodGhhdC5fcGVuZGluZ0RlbGF5ZWREZXBlbmRlbmN5RGF0YS5sZW5ndGggPiAwKSB7XHJcbiAgICAgICAgICAgICAgICAvLyBBdm9pZCBieXBhc3Mgb2YgZGVsYXllZCBkYXRhIGJ5IG5ldyBkYXRhXHJcbiAgICAgICAgICAgICAgICB0aGF0Ll9wZW5kaW5nRGVsYXllZERlcGVuZGVuY3lEYXRhLnB1c2goe1xyXG4gICAgICAgICAgICAgICAgICAgIGRhdGE6IGRhdGEsXHJcbiAgICAgICAgICAgICAgICAgICAgb25EZXBlbmRlbmN5VGFza0RhdGE6IG9uRGVwZW5kZW5jeVRhc2tEYXRhXHJcbiAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgdGhhdC5fc2NoZWR1bGVQZW5kaW5nRGVsYXllZEFjdGlvbnMoKTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICB0aGF0Ll9kZXBlbmRUYXNrUmVzdWx0c1tpbmRleF0gPSBkYXRhO1xyXG4gICAgICAgICAgICB0aGF0Ll9oYXNEZXBlbmRUYXNrRGF0YVtpbmRleF0gPSB0cnVlO1xyXG4gICAgICAgICAgICB0aGF0LnRhc2tBcGkuX29uRXZlbnQoJ2RlcGVuZGVuY3lUYXNrRGF0YScsIGRhdGEsIHRhc2tLZXkpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBmdW5jdGlvbiBvbkRlcGVuZGVuY3lUYXNrQ3VzdG9tKGFyZzAsIGFyZzEpIHtcclxuICAgICAgICAgICAgdGhhdC50YXNrQXBpLl9vbkV2ZW50KCdkZXBlbmRlbmN5VGFza0N1c3RvbScsIGFyZzAsIGFyZzEpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBmdW5jdGlvbiBvbkRlcGVuZGVuY3lUYXNrVGVybWluYXRlZCgpIHtcclxuICAgICAgICAgICAgaWYgKGlzRGVwZW5kc1Rhc2tUZXJtaW5hdGVkKSB7XHJcbiAgICAgICAgICAgICAgICB0aHJvdyAnZGVwZW5kZW5jeVdvcmtlcnM6IERvdWJsZSB0ZXJtaW5hdGlvbic7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgaXNEZXBlbmRzVGFza1Rlcm1pbmF0ZWQgPSB0cnVlO1xyXG4gICAgICAgICAgICArK3RoYXQuX3BlbmRpbmdEZWxheWVkRGVwZW5kc1Rhc2tUZXJtaW5hdGVkO1xyXG4gICAgICAgICAgICB0aGF0Ll9zY2hlZHVsZVBlbmRpbmdEZWxheWVkQWN0aW9ucygpO1xyXG4gICAgICAgIH1cclxuICAgIH07XHJcbiAgICBcclxuICAgIERlcGVuZGVuY3lXb3JrZXJzVGFza0ludGVybmFscy5wcm90b3R5cGUuX3Rlcm1pbmF0ZUludGVybmFsID0gZnVuY3Rpb24gdGVybWluYXRlSW50ZXJuYWwoKSB7XHJcbiAgICAgICAgaWYgKHRoaXMuaXNUZXJtaW5hdGVkKSB7XHJcbiAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgdGhpcy5kZXRhY2hCZWZvcmVUZXJtaW5hdGlvbigpO1xyXG4gICAgICAgIHRoaXMuaXNUZXJtaW5hdGVkID0gdHJ1ZTtcclxuXHJcbiAgICAgICAgaWYgKHRoaXMuX2lzV2FpdGluZ0ZvcldvcmtlclJlc3VsdCkge1xyXG4gICAgICAgICAgICB0aGlzLmlzQWN0dWFsVGVybWluYXRpb25QZW5kaW5nID0gdHJ1ZTtcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICB0aGlzLmVuZGVkKCk7XHJcbiAgICAgICAgfVxyXG4gICAgfTtcclxuICAgIFxyXG4gICAgRGVwZW5kZW5jeVdvcmtlcnNUYXNrSW50ZXJuYWxzLnByb3RvdHlwZS5fc2NoZWR1bGVQZW5kaW5nRGVsYXllZEFjdGlvbnMgPSBmdW5jdGlvbigpIHtcclxuICAgICAgICB0aGlzLl9wZW5kaW5nRGVsYXllZEFjdGlvbiA9IHRydWU7XHJcbiAgICAgICAgaWYgKCF0aGlzLl9zaG91bGREZWxheUFjdGlvbnMpIHtcclxuICAgICAgICAgICAgdGhpcy5fcGVyZm9ybVBlbmRpbmdEZWxheWVkQWN0aW9ucygpO1xyXG4gICAgICAgIH1cclxuICAgIH07XHJcbiAgICBcclxuICAgIERlcGVuZGVuY3lXb3JrZXJzVGFza0ludGVybmFscy5wcm90b3R5cGUuX3BlcmZvcm1QZW5kaW5nRGVsYXllZEFjdGlvbnMgPSBmdW5jdGlvbiBwZXJmb3JtUGVuZGluZ0RlbGF5ZWRBY3Rpb25zKCkge1xyXG4gICAgICAgIGlmICghdGhpcy5fcGVuZGluZ0RlbGF5ZWRBY3Rpb24pIHtcclxuICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICB2YXIgdGhhdCA9IHRoaXM7XHJcbiAgICAgICAgdGhpcy5fcGVuZGluZ0RlbGF5ZWRBY3Rpb24gPSBmYWxzZTtcclxuICAgICAgICBcclxuICAgICAgICBpZiAodGhpcy5fcGVuZGluZ0RlbGF5ZWREZXBlbmRlbmN5RGF0YS5sZW5ndGggPiAwKSB7XHJcbiAgICAgICAgICAgIHZhciBsb2NhbExpc3RlbmVycyA9IHRoaXMuX3BlbmRpbmdEZWxheWVkRGVwZW5kZW5jeURhdGE7XHJcbiAgICAgICAgICAgIHRoaXMuX3BlbmRpbmdEZWxheWVkRGVwZW5kZW5jeURhdGEgPSBbXTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgbG9jYWxMaXN0ZW5lcnMubGVuZ3RoOyArK2kpIHtcclxuICAgICAgICAgICAgICAgIGxvY2FsTGlzdGVuZXJzW2ldLm9uRGVwZW5kZW5jeVRhc2tEYXRhKGxvY2FsTGlzdGVuZXJzW2ldLmRhdGEpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBpZiAodGhpcy5fcGVuZGluZ0RlbGF5ZWREZXBlbmRzVGFza1Rlcm1pbmF0ZWQgPiAwKSB7XHJcbiAgICAgICAgICAgIHRoaXMuX2RlcGVuZHNUYXNrc1Rlcm1pbmF0ZWRDb3VudCArPSB0aGlzLl9wZW5kaW5nRGVsYXllZERlcGVuZHNUYXNrVGVybWluYXRlZDtcclxuICAgICAgICAgICAgdGhpcy5fcGVuZGluZ0RlbGF5ZWREZXBlbmRzVGFza1Rlcm1pbmF0ZWQgPSAwO1xyXG4gICAgICAgICAgICBpZiAodGhpcy5fZGVwZW5kc1Rhc2tzVGVybWluYXRlZENvdW50ID09PSB0aGlzLl9kZXBlbmRzVGFza0NvbnRleHRzLmdldENvdW50KCkpIHtcclxuICAgICAgICAgICAgICAgIHRoaXMudGFza0FwaS5fb25FdmVudCgnYWxsRGVwZW5kVGFza3NUZXJtaW5hdGVkJyk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHRoaXMuc3RhdHVzVXBkYXRlKCk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBpZiAodGhpcy5fcGVuZGluZ0RlbGF5ZWROZXdEYXRhLmxlbmd0aCA+IDApIHtcclxuICAgICAgICAgICAgdmFyIG5ld0RhdGEgPSB0aGlzLl9wZW5kaW5nRGVsYXllZE5ld0RhdGE7XHJcbiAgICAgICAgICAgIHZhciBjYW5Ta2lwTGFzdCA9IHRoaXMuX3BlbmRpbmdEZWxheWVkQ2FuU2tpcExhc3ROZXdEYXRhO1xyXG4gICAgICAgICAgICB0aGlzLl9wZW5kaW5nRGVsYXllZE5ld0RhdGEgPSBbXTtcclxuICAgICAgICAgICAgdGhpcy5fcGVuZGluZ0RlbGF5ZWRDYW5Ta2lwTGFzdE5ld0RhdGEgPSBmYWxzZTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGlmICh0aGlzLl9jYW5Ta2lwTGFzdFByb2Nlc3NlZERhdGEpIHtcclxuICAgICAgICAgICAgICAgIHRoaXMucHJvY2Vzc2VkRGF0YS5wb3AoKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBuZXdEYXRhLmxlbmd0aDsgKytpKSB7XHJcbiAgICAgICAgICAgICAgICB0aGlzLnByb2Nlc3NlZERhdGEucHVzaChuZXdEYXRhW2ldKTtcclxuICAgICAgICAgICAgICAgIHRoaXMuX2NhblNraXBMYXN0UHJvY2Vzc2VkRGF0YSA9IGNhblNraXBMYXN0ICYmIGkgPT09IG5ld0RhdGEubGVuZ3RoIC0gMTtcclxuICAgICAgICAgICAgICAgIHRoaXMuX2l0ZXJhdGVDYWxsYmFja3MoZnVuY3Rpb24oY2FsbGJhY2tzKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY2FsbGJhY2tzLm9uRGF0YShuZXdEYXRhW2ldLCB0aGF0LnRhc2tLZXkpO1xyXG4gICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKHRoaXMuX3BlbmRpbmdXb3JrZXJEb25lKSB7XHJcbiAgICAgICAgICAgIHRoaXMuX2lzV2FpdGluZ0ZvcldvcmtlclJlc3VsdCA9IGZhbHNlO1xyXG4gICAgICAgICAgICB0aGlzLnN0YXR1c1VwZGF0ZSgpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBpZiAodGhpcy5fcGVuZGluZ0RlbGF5ZWRFbmRlZCkge1xyXG4gICAgICAgICAgICB0aGlzLl9wZW5kaW5nRGVsYXllZEVuZGVkID0gZmFsc2U7XHJcbiAgICAgICAgICAgIHRoaXMuX2l0ZXJhdGVDYWxsYmFja3MoZnVuY3Rpb24oY2FsbGJhY2tzKSB7XHJcbiAgICAgICAgICAgICAgICBpZiAoY2FsbGJhY2tzLm9uVGVybWluYXRlZCkge1xyXG4gICAgICAgICAgICAgICAgICAgIGNhbGxiYWNrcy5vblRlcm1pbmF0ZWQodGhhdC5faXNBYm9ydGVkKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICB0aGlzLnRhc2tDb250ZXh0cy5jbGVhcigpO1xyXG4gICAgICAgIH1cclxuICAgIH07XHJcbiAgICBcclxuICAgIERlcGVuZGVuY3lXb3JrZXJzVGFza0ludGVybmFscy5wcm90b3R5cGUuX2l0ZXJhdGVDYWxsYmFja3MgPSBmdW5jdGlvbihwZXJmb3JtKSB7XHJcbiAgICAgICAgdmFyIGl0ZXJhdG9yID0gdGhpcy50YXNrQ29udGV4dHMuZ2V0Rmlyc3RJdGVyYXRvcigpO1xyXG4gICAgICAgIHdoaWxlIChpdGVyYXRvciAhPT0gbnVsbCkge1xyXG4gICAgICAgICAgICB2YXIgY29udGV4dCA9IHRoaXMudGFza0NvbnRleHRzLmdldEZyb21JdGVyYXRvcihpdGVyYXRvcik7XHJcbiAgICAgICAgICAgIGl0ZXJhdG9yID0gdGhpcy50YXNrQ29udGV4dHMuZ2V0TmV4dEl0ZXJhdG9yKGl0ZXJhdG9yKTtcclxuXHJcbiAgICAgICAgICAgIHBlcmZvcm0oY29udGV4dC5fY2FsbGJhY2tzKTtcclxuICAgICAgICB9XHJcblxyXG4gICAgfTtcclxuICAgIFxyXG4gICAgcmV0dXJuIERlcGVuZGVuY3lXb3JrZXJzVGFza0ludGVybmFscztcclxufSkoKTtcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gRGVwZW5kZW5jeVdvcmtlcnNUYXNrSW50ZXJuYWxzOyIsIid1c2Ugc3RyaWN0JztcclxuXHJcbnZhciBwcmlvcml0aXplciA9IHtcclxuICAgIGdldFByaW9yaXR5OiBmdW5jdGlvbih0YXNrKSB7XHJcbiAgICAgICAgcmV0dXJuIHRhc2suY2FsY3VsYXRlUHJpb3JpdHkoKTtcclxuICAgIH1cclxufTtcclxuXHJcbmZ1bmN0aW9uIGNyZWF0ZUR1bW15UmVzb3VyY2UoKSB7XHJcbiAgICByZXR1cm4ge307XHJcbn1cclxuXHJcbmZ1bmN0aW9uIERlcGVuZGVuY3lXb3JrZXJzVGFza1NjaGVkdWxlcihqb2JzTGltaXQsIG9wdGlvbnMpIHtcclxuICAgIHJlc291cmNlU2NoZWR1bGVyLlByaW9yaXR5U2NoZWR1bGVyLmNhbGwodGhpcywgY3JlYXRlRHVtbXlSZXNvdXJjZSwgam9ic0xpbWl0LCBwcmlvcml0aXplciwgb3B0aW9ucyk7XHJcbn1cclxuXHJcbkRlcGVuZGVuY3lXb3JrZXJzVGFza1NjaGVkdWxlci5wcm90b3R5cGUgPSBPYmplY3QuY3JlYXRlKHJlc291cmNlU2NoZWR1bGVyLlByaW9yaXR5U2NoZWR1bGVyLnByb3RvdHlwZSk7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IERlcGVuZGVuY3lXb3JrZXJzVGFza1NjaGVkdWxlcjsiLCIndXNlIHN0cmljdCc7XHJcblxyXG52YXIgRGVwZW5kZW5jeVdvcmtlcnNUYXNrID0gKGZ1bmN0aW9uIERlcGVuZGVuY3lXb3JrZXJzVGFza0Nsb3N1cmUoKSB7XHJcbiAgICBmdW5jdGlvbiBEZXBlbmRlbmN5V29ya2Vyc1Rhc2sod3JhcHBlZCwga2V5LCByZWdpc3RlcldyYXBwZWRFdmVudHMpIHtcclxuICAgICAgICB0aGlzLl93cmFwcGVkID0gd3JhcHBlZDtcclxuICAgICAgICB3cmFwcGVkLl9fd3JhcHBpbmdUYXNrRm9yRGVidWcgPSB0aGlzO1xyXG4gICAgICAgIHRoaXMuX2tleSA9IGtleTtcclxuICAgICAgICB0aGlzLl9ldmVudExpc3RlbmVycyA9IHtcclxuICAgICAgICAgICAgJ2RlcGVuZGVuY3lUYXNrRGF0YSc6IFtdLFxyXG4gICAgICAgICAgICAnc3RhdHVzVXBkYXRlZCc6IFtdLFxyXG4gICAgICAgICAgICAnYWxsRGVwZW5kVGFza3NUZXJtaW5hdGVkJzogW10sXHJcbiAgICAgICAgICAgICdjdXN0b20nOiBbXSxcclxuICAgICAgICAgICAgJ2RlcGVuZGVuY3lUYXNrQ3VzdG9tJzogW11cclxuICAgICAgICB9O1xyXG4gICAgICAgIFxyXG4gICAgICAgIGlmIChyZWdpc3RlcldyYXBwZWRFdmVudHMpIHtcclxuICAgICAgICAgICAgZm9yICh2YXIgZXZlbnQgaW4gdGhpcy5fZXZlbnRMaXN0ZW5lcnMpIHtcclxuICAgICAgICAgICAgICAgIHRoaXMuX3JlZ2lzdGVyV3JhcHBlZEV2ZW50KGV2ZW50KTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgIH1cclxuICAgIFxyXG4gICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KERlcGVuZGVuY3lXb3JrZXJzVGFzay5wcm90b3R5cGUsICdpc1Rlcm1pbmF0ZWQnLCB7IGdldDogZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgcmV0dXJuIHRoaXMuX3dyYXBwZWQuaXNUZXJtaW5hdGVkO1xyXG4gICAgfSB9KTtcclxuICAgIFxyXG4gICAgRGVwZW5kZW5jeVdvcmtlcnNUYXNrLnByb3RvdHlwZS5kYXRhUmVhZHkgPSBmdW5jdGlvbiBkYXRhUmVhZHkobmV3RGF0YVRvUHJvY2Vzcywgd29ya2VyVHlwZSwgY2FuU2tpcCkge1xyXG4gICAgICAgIHRoaXMuX3dyYXBwZWQuZGF0YVJlYWR5KG5ld0RhdGFUb1Byb2Nlc3MsIHdvcmtlclR5cGUsIGNhblNraXApO1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgRGVwZW5kZW5jeVdvcmtlcnNUYXNrLnByb3RvdHlwZS5kZXRhY2hCZWZvcmVUZXJtaW5hdGlvbiA9IGZ1bmN0aW9uIGRldGFjaCgpIHtcclxuICAgICAgICB0aGlzLl93cmFwcGVkLmRldGFjaEJlZm9yZVRlcm1pbmF0aW9uKCk7XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBEZXBlbmRlbmN5V29ya2Vyc1Rhc2sucHJvdG90eXBlLnRlcm1pbmF0ZSA9IGZ1bmN0aW9uIHRlcm1pbmF0ZSgpIHtcclxuICAgICAgICB0aGlzLl93cmFwcGVkLnRlcm1pbmF0ZSgpO1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgRGVwZW5kZW5jeVdvcmtlcnNUYXNrLnByb3RvdHlwZS5yZWdpc3RlclRhc2tEZXBlbmRlbmN5ID0gZnVuY3Rpb24gcmVnaXN0ZXJUYXNrRGVwZW5kZW5jeSh0YXNrS2V5KSB7XHJcbiAgICAgICAgcmV0dXJuIHRoaXMuX3dyYXBwZWQucmVnaXN0ZXJUYXNrRGVwZW5kZW5jeSh0YXNrS2V5KTtcclxuICAgIH07XHJcbiAgICBcclxuICAgIERlcGVuZGVuY3lXb3JrZXJzVGFzay5wcm90b3R5cGUuY2FsY3VsYXRlUHJpb3JpdHkgPSBmdW5jdGlvbiBjYWxjdWxhdGVQcmlvcml0eSgpIHtcclxuICAgICAgICByZXR1cm4gdGhpcy5fd3JhcHBlZC5jYWxjdWxhdGVQcmlvcml0eSgpO1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgRGVwZW5kZW5jeVdvcmtlcnNUYXNrLnByb3RvdHlwZS5jdXN0b21FdmVudCA9IGZ1bmN0aW9uIGN1c3RvbUV2ZW50KGFyZzAsIGFyZzEpIHtcclxuICAgICAgICByZXR1cm4gdGhpcy5fd3JhcHBlZC5jdXN0b21FdmVudChhcmcwLCBhcmcxKTtcclxuICAgIH07XHJcbiAgICBcclxuICAgIERlcGVuZGVuY3lXb3JrZXJzVGFzay5wcm90b3R5cGUub24gPSBmdW5jdGlvbiBvbihldmVudCwgbGlzdGVuZXIpIHtcclxuICAgICAgICBpZiAoIXRoaXMuX2V2ZW50TGlzdGVuZXJzW2V2ZW50XSkge1xyXG4gICAgICAgICAgICB0aHJvdyAnZGVwZW5kZW5jeVdvcmtlcnM6IFRhc2sgaGFzIG5vIGV2ZW50ICcgKyBldmVudDtcclxuICAgICAgICB9XHJcbiAgICAgICAgdGhpcy5fZXZlbnRMaXN0ZW5lcnNbZXZlbnRdLnB1c2gobGlzdGVuZXIpO1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KERlcGVuZGVuY3lXb3JrZXJzVGFzay5wcm90b3R5cGUsICdrZXknLCB7XHJcbiAgICAgICAgZ2V0OiBmdW5jdGlvbiBnZXRLZXkoKSB7XHJcbiAgICAgICAgICAgIHJldHVybiB0aGlzLl9rZXk7XHJcbiAgICAgICAgfVxyXG4gICAgfSk7XHJcbiAgICBcclxuICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShEZXBlbmRlbmN5V29ya2Vyc1Rhc2sucHJvdG90eXBlLCAnZGVwZW5kVGFza0tleXMnLCB7XHJcbiAgICAgICAgZ2V0OiBmdW5jdGlvbiBnZXREZXBlbmRUYXNrS2V5cygpIHtcclxuICAgICAgICAgICAgcmV0dXJuIHRoaXMuX3dyYXBwZWQuZGVwZW5kVGFza0tleXM7XHJcbiAgICAgICAgfVxyXG4gICAgfSk7XHJcbiAgICBcclxuICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShEZXBlbmRlbmN5V29ya2Vyc1Rhc2sucHJvdG90eXBlLCAnZGVwZW5kVGFza1Jlc3VsdHMnLCB7XHJcbiAgICAgICAgZ2V0OiBmdW5jdGlvbiBnZXREZXBlbmRUYXNrUmVzdWx0cygpIHtcclxuICAgICAgICAgICAgcmV0dXJuIHRoaXMuX3dyYXBwZWQuZGVwZW5kVGFza1Jlc3VsdHM7XHJcbiAgICAgICAgfVxyXG4gICAgfSk7XHJcbiAgICBcclxuICAgIERlcGVuZGVuY3lXb3JrZXJzVGFzay5wcm90b3R5cGUuX29uRXZlbnQgPSBmdW5jdGlvbiBvbkV2ZW50KGV2ZW50LCBhcmcxLCBhcmcyKSB7XHJcbiAgICAgICAgaWYgKGV2ZW50ID09ICdzdGF0dXNVcGRhdGVkJykge1xyXG4gICAgICAgICAgICBhcmcxID0gdGhpcy5fbW9kaWZ5U3RhdHVzKGFyZzEpO1xyXG4gICAgICAgIH1cclxuICAgICAgICB2YXIgbGlzdGVuZXJzID0gdGhpcy5fZXZlbnRMaXN0ZW5lcnNbZXZlbnRdO1xyXG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgbGlzdGVuZXJzLmxlbmd0aDsgKytpKSB7XHJcbiAgICAgICAgICAgIGxpc3RlbmVyc1tpXS5jYWxsKHRoaXMsIGFyZzEsIGFyZzIpO1xyXG4gICAgICAgIH1cclxuICAgIH07XHJcbiAgICBcclxuICAgIERlcGVuZGVuY3lXb3JrZXJzVGFzay5wcm90b3R5cGUuX21vZGlmeVN0YXR1cyA9IGZ1bmN0aW9uIG1vZGlmeVN0YXR1cyhzdGF0dXMpIHtcclxuICAgICAgICByZXR1cm4gc3RhdHVzO1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgRGVwZW5kZW5jeVdvcmtlcnNUYXNrLnByb3RvdHlwZS5fcmVnaXN0ZXJXcmFwcGVkRXZlbnQgPSBmdW5jdGlvbiByZWdpc3RlcldyYXBwZWRFdmVudChldmVudCkge1xyXG4gICAgICAgIHZhciB0aGF0ID0gdGhpcztcclxuICAgICAgICB0aGlzLl93cmFwcGVkLm9uKGV2ZW50LCBmdW5jdGlvbihhcmcxLCBhcmcyKSB7XHJcbiAgICAgICAgICAgIHRoYXQuX29uRXZlbnQoZXZlbnQsIGFyZzEsIGFyZzIpO1xyXG4gICAgICAgIH0pO1xyXG4gICAgfTtcclxuXHJcbiAgICByZXR1cm4gRGVwZW5kZW5jeVdvcmtlcnNUYXNrO1xyXG59KSgpO1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBEZXBlbmRlbmN5V29ya2Vyc1Rhc2s7IiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxuLyogZ2xvYmFsIGNvbnNvbGU6IGZhbHNlICovXHJcbi8qIGdsb2JhbCBQcm9taXNlOiBmYWxzZSAqL1xyXG5cclxudmFyIEpzQnVpbHRpbkhhc2hNYXAgPSByZXF1aXJlKCdqcy1idWlsdGluLWhhc2gtbWFwJyk7XHJcbnZhciBEZXBlbmRlbmN5V29ya2Vyc1Rhc2tJbnRlcm5hbHMgPSByZXF1aXJlKCdkZXBlbmRlbmN5LXdvcmtlcnMtdGFzay1pbnRlcm5hbHMnKTtcclxudmFyIERlcGVuZGVuY3lXb3JrZXJzVGFza0NvbnRleHQgPSByZXF1aXJlKCdkZXBlbmRlbmN5LXdvcmtlcnMtdGFzay1jb250ZXh0Jyk7XHJcblxyXG52YXIgRGVwZW5kZW5jeVdvcmtlcnMgPSAoZnVuY3Rpb24gRGVwZW5kZW5jeVdvcmtlcnNDbG9zdXJlKCkge1xyXG4gICAgZnVuY3Rpb24gRGVwZW5kZW5jeVdvcmtlcnMod29ya2VySW5wdXRSZXRyZWl2ZXIpIHtcclxuICAgICAgICB2YXIgdGhhdCA9IHRoaXM7XHJcbiAgICAgICAgdGhhdC5fd29ya2VySW5wdXRSZXRyZWl2ZXIgPSB3b3JrZXJJbnB1dFJldHJlaXZlcjtcclxuICAgICAgICB0aGF0Ll90YXNrSW50ZXJuYWxzcyA9IG5ldyBKc0J1aWx0aW5IYXNoTWFwKCk7XHJcbiAgICAgICAgdGhhdC5fd29ya2VyUG9vbEJ5VGFza1R5cGUgPSBbXTtcclxuICAgICAgICB0aGF0Ll90YXNrT3B0aW9uc0J5VGFza1R5cGUgPSBbXTtcclxuICAgICAgICBcclxuICAgICAgICBpZiAoIXdvcmtlcklucHV0UmV0cmVpdmVyLmdldFdvcmtlclR5cGVPcHRpb25zKSB7XHJcbiAgICAgICAgICAgIHRocm93ICdkZXBlbmRlbmN5V29ya2VyczogTm8gJyArXHJcbiAgICAgICAgICAgICAgICAnd29ya2VySW5wdXRSZXRyZWl2ZXIuZ2V0V29ya2VyVHlwZU9wdGlvbnMoKSBtZXRob2QnO1xyXG4gICAgICAgIH1cclxuICAgICAgICBpZiAoIXdvcmtlcklucHV0UmV0cmVpdmVyLmdldEtleUFzU3RyaW5nKSB7XHJcbiAgICAgICAgICAgIHRocm93ICdkZXBlbmRlbmN5V29ya2VyczogTm8gJyArXHJcbiAgICAgICAgICAgICAgICAnd29ya2VySW5wdXRSZXRyZWl2ZXIuZ2V0S2V5QXNTdHJpbmcoKSBtZXRob2QnO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuICAgIFxyXG4gICAgRGVwZW5kZW5jeVdvcmtlcnMucHJvdG90eXBlLnN0YXJ0VGFzayA9IGZ1bmN0aW9uIHN0YXJ0VGFzayhcclxuICAgICAgICB0YXNrS2V5LCBjYWxsYmFja3MpIHtcclxuICAgICAgICBcclxuICAgICAgICB2YXIgZGVwZW5kZW5jeVdvcmtlcnMgPSB0aGlzO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHZhciBzdHJLZXkgPSB0aGlzLl93b3JrZXJJbnB1dFJldHJlaXZlci5nZXRLZXlBc1N0cmluZyh0YXNrS2V5KTtcclxuICAgICAgICB2YXIgYWRkUmVzdWx0ID0gdGhpcy5fdGFza0ludGVybmFsc3MudHJ5QWRkKHN0cktleSwgZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgICAgIHJldHVybiBuZXcgRGVwZW5kZW5jeVdvcmtlcnNUYXNrSW50ZXJuYWxzKCk7XHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgdmFyIHRhc2tJbnRlcm5hbHMgPSBhZGRSZXN1bHQudmFsdWU7XHJcbiAgICAgICAgdmFyIHRhc2tDb250ZXh0ID0gbmV3IERlcGVuZGVuY3lXb3JrZXJzVGFza0NvbnRleHQoXHJcbiAgICAgICAgICAgIHRhc2tJbnRlcm5hbHMsIGNhbGxiYWNrcyk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKGFkZFJlc3VsdC5pc05ldykge1xyXG4gICAgICAgICAgICB0YXNrSW50ZXJuYWxzLmluaXRpYWxpemUoXHJcbiAgICAgICAgICAgICAgICB0YXNrS2V5LFxyXG4gICAgICAgICAgICAgICAgdGhpcyxcclxuICAgICAgICAgICAgICAgIHRoaXMuX3dvcmtlcklucHV0UmV0cmVpdmVyLFxyXG4gICAgICAgICAgICAgICAgdGhpcy5fdGFza0ludGVybmFsc3MsXHJcbiAgICAgICAgICAgICAgICBhZGRSZXN1bHQuaXRlcmF0b3IsXHJcbiAgICAgICAgICAgICAgICB0aGlzLl93b3JrZXJJbnB1dFJldHJlaXZlcik7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgdGhpcy5fd29ya2VySW5wdXRSZXRyZWl2ZXIudGFza1N0YXJ0ZWQodGFza0ludGVybmFscy50YXNrQXBpKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHRhc2tJbnRlcm5hbHMuYWZ0ZXJUYXNrU3RhcnRlZCgpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgcmV0dXJuIHRhc2tDb250ZXh0O1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgRGVwZW5kZW5jeVdvcmtlcnMucHJvdG90eXBlLnN0YXJ0VGFza1Byb21pc2UgPVxyXG4gICAgICAgICAgICBmdW5jdGlvbiBzdGFydFRhc2tQcm9taXNlKHRhc2tLZXkpIHtcclxuICAgICAgICBcclxuICAgICAgICB2YXIgdGhhdCA9IHRoaXM7XHJcbiAgICAgICAgcmV0dXJuIG5ldyBQcm9taXNlKGZ1bmN0aW9uKHJlc29sdmUsIHJlamVjdCkge1xyXG4gICAgICAgICAgICB2YXIgdGFza0NvbnRleHQgPSB0aGF0LnN0YXJ0VGFzayhcclxuICAgICAgICAgICAgICAgIHRhc2tLZXksIHsgJ29uRGF0YSc6IG9uRGF0YSwgJ29uVGVybWluYXRlZCc6IG9uVGVybWluYXRlZCB9KTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICB2YXIgcHJvY2Vzc2VkRGF0YSA9IHRhc2tDb250ZXh0LmdldFByb2Nlc3NlZERhdGEoKTtcclxuICAgICAgICAgICAgdmFyIGhhc0RhdGEgPSBwcm9jZXNzZWREYXRhLmxlbmd0aCA+IDA7XHJcbiAgICAgICAgICAgIHZhciByZXN1bHQ7XHJcbiAgICAgICAgICAgIGlmIChoYXNEYXRhKSB7XHJcbiAgICAgICAgICAgICAgICByZXN1bHQgPSBwcm9jZXNzZWREYXRhW3Byb2Nlc3NlZERhdGEubGVuZ3RoIC0gMV07XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGZ1bmN0aW9uIG9uRGF0YShkYXRhKSB7XHJcbiAgICAgICAgICAgICAgICBoYXNEYXRhID0gdHJ1ZTtcclxuICAgICAgICAgICAgICAgIHJlc3VsdCA9IGRhdGE7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGZ1bmN0aW9uIG9uVGVybWluYXRlZChpc0Fib3J0ZWQpIHtcclxuICAgICAgICAgICAgICAgIGlmIChpc0Fib3J0ZWQpIHtcclxuICAgICAgICAgICAgICAgICAgICByZWplY3QoJ1Rhc2sgaXMgYWJvcnRlZCcpO1xyXG4gICAgICAgICAgICAgICAgfSBlbHNlIGlmIChoYXNEYXRhKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgcmVzb2x2ZShyZXN1bHQpO1xyXG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgICAgICByZWplY3QoJ1Rhc2sgdGVybWluYXRlZCBidXQgbm8gZGF0YSByZXR1cm5lZCcpO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfSk7XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBEZXBlbmRlbmN5V29ya2Vycy5wcm90b3R5cGUudGVybWluYXRlSW5hY3RpdmVXb3JrZXJzID0gZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgZm9yICh2YXIgdGFza1R5cGUgaW4gdGhpcy5fd29ya2VyUG9vbEJ5VGFza1R5cGUpIHtcclxuICAgICAgICAgICAgdmFyIHdvcmtlclBvb2wgPSB0aGlzLl93b3JrZXJQb29sQnlUYXNrVHlwZVt0YXNrVHlwZV07XHJcbiAgICAgICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgd29ya2VyUG9vbC5sZW5ndGg7ICsraSkge1xyXG4gICAgICAgICAgICAgICAgd29ya2VyUG9vbFtpXS5wcm94eS50ZXJtaW5hdGUoKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB3b3JrZXJQb29sLmxlbmd0aCA9IDA7XHJcbiAgICAgICAgfVxyXG4gICAgfTtcclxuICAgIFxyXG4gICAgRGVwZW5kZW5jeVdvcmtlcnMucHJvdG90eXBlLl9kYXRhUmVhZHkgPSBmdW5jdGlvbiBkYXRhUmVhZHkoXHJcbiAgICAgICAgICAgIHRhc2tJbnRlcm5hbHMsIGRhdGFUb1Byb2Nlc3MsIHdvcmtlclR5cGUsIGNhblNraXApIHtcclxuICAgICAgICBcclxuICAgICAgICB2YXIgdGhhdCA9IHRoaXM7XHJcbiAgICAgICAgdmFyIHdvcmtlcjtcclxuICAgICAgICB2YXIgd29ya2VyUG9vbCA9IHRoYXQuX3dvcmtlclBvb2xCeVRhc2tUeXBlW3dvcmtlclR5cGVdO1xyXG4gICAgICAgIGlmICghd29ya2VyUG9vbCkge1xyXG4gICAgICAgICAgICB3b3JrZXJQb29sID0gW107XHJcbiAgICAgICAgICAgIHRoYXQuX3dvcmtlclBvb2xCeVRhc2tUeXBlW3dvcmtlclR5cGVdID0gd29ya2VyUG9vbDtcclxuICAgICAgICB9XHJcbiAgICAgICAgaWYgKHdvcmtlclBvb2wubGVuZ3RoID4gMCkge1xyXG4gICAgICAgICAgICB3b3JrZXIgPSB3b3JrZXJQb29sLnBvcCgpO1xyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgIHZhciB3b3JrZXJBcmdzID0gdGhhdC5fd29ya2VySW5wdXRSZXRyZWl2ZXIuZ2V0V29ya2VyVHlwZU9wdGlvbnMoXHJcbiAgICAgICAgICAgICAgICB3b3JrZXJUeXBlKTtcclxuXHJcbiAgICAgICAgICAgIGlmICghd29ya2VyQXJncykge1xyXG4gICAgICAgICAgICAgICAgdGFza0ludGVybmFscy5uZXdEYXRhKGRhdGFUb1Byb2Nlc3MpO1xyXG4gICAgICAgICAgICAgICAgdGFza0ludGVybmFscy53b3JrZXJEb25lKCk7XHJcbiAgICAgICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHdvcmtlciA9IHtcclxuICAgICAgICAgICAgICAgIHByb3h5OiBuZXcgYXN5bmNQcm94eS5Bc3luY1Byb3h5TWFzdGVyKFxyXG4gICAgICAgICAgICAgICAgICAgIHdvcmtlckFyZ3Muc2NyaXB0c1RvSW1wb3J0LFxyXG4gICAgICAgICAgICAgICAgICAgIHdvcmtlckFyZ3MuY3Rvck5hbWUsXHJcbiAgICAgICAgICAgICAgICAgICAgd29ya2VyQXJncy5jdG9yQXJncyksXHJcbiAgICAgICAgICAgICAgICB0cmFuc2ZlcmFibGVzOiB3b3JrZXJBcmdzLnRyYW5zZmVyYWJsZXMsXHJcbiAgICAgICAgICAgICAgICBwYXRoVG9UcmFuc2ZlcmFibGVzSW5Qcm9taXNlUmVzdWx0OiB3b3JrZXJBcmdzLnBhdGhUb1RyYW5zZmVyYWJsZXNJblByb21pc2VSZXN1bHRcclxuICAgICAgICAgICAgfTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgdmFyIGFyZ3MgPSBbZGF0YVRvUHJvY2VzcywgdGFza0ludGVybmFscy50YXNrS2V5XTtcclxuICAgICAgICB2YXIgb3B0aW9ucyA9IHtcclxuICAgICAgICAgICAgJ2lzUmV0dXJuUHJvbWlzZSc6IHRydWUsXHJcbiAgICAgICAgICAgICd0cmFuc2ZlcmFibGVzJzogd29ya2VyLnRyYW5zZmVyYWJsZXMsXHJcbiAgICAgICAgICAgICdwYXRoVG9UcmFuc2ZlcmFibGVzSW5Qcm9taXNlUmVzdWx0Jzogd29ya2VyLnBhdGhUb1RyYW5zZmVyYWJsZXNJblByb21pc2VSZXN1bHRcclxuICAgICAgICB9O1xyXG5cclxuICAgICAgICB2YXIgcHJvbWlzZSA9IHdvcmtlci5wcm94eS5jYWxsRnVuY3Rpb24oJ3N0YXJ0JywgYXJncywgb3B0aW9ucyk7XHJcbiAgICAgICAgcHJvbWlzZVxyXG4gICAgICAgICAgICAudGhlbihmdW5jdGlvbihwcm9jZXNzZWREYXRhKSB7XHJcbiAgICAgICAgICAgICAgICB0YXNrSW50ZXJuYWxzLm5ld0RhdGEocHJvY2Vzc2VkRGF0YSwgY2FuU2tpcCk7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gcHJvY2Vzc2VkRGF0YTtcclxuICAgICAgICAgICAgfSkuY2F0Y2goZnVuY3Rpb24oZSkge1xyXG4gICAgICAgICAgICAgICAgY29uc29sZS5sb2coJ0Vycm9yIGluIERlcGVuZGVuY3lXb3JrZXJzXFwnIHdvcmtlcjogJyArIGUpO1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuIGU7XHJcbiAgICAgICAgICAgIH0pLnRoZW4oZnVuY3Rpb24ocmVzdWx0KSB7XHJcbiAgICAgICAgICAgICAgICB3b3JrZXJQb29sLnB1c2god29ya2VyKTtcclxuICAgICAgICAgICAgICAgIHRhc2tJbnRlcm5hbHMud29ya2VyRG9uZSgpO1xyXG4gICAgICAgICAgICB9KTtcclxuICAgIH07XHJcbiAgICBcclxuICAgIERlcGVuZGVuY3lXb3JrZXJzLnByb3RvdHlwZS53YWl0Rm9yU2NoZWR1bGUgPSBmdW5jdGlvbiB3YWl0Rm9yU2NoZWR1bGUoc2NoZWR1bGVOb3RpZmllcikge1xyXG4gICAgICAgIHNjaGVkdWxlTm90aWZpZXIuc2NoZWR1bGUoeyAnam9iRG9uZSc6IGZ1bmN0aW9uKCkgeyB9IH0pO1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgRGVwZW5kZW5jeVdvcmtlcnMucHJvdG90eXBlLmluaXRpYWxpemluZ1Rhc2sgPSBmdW5jdGlvbiBpbml0aWFsaXppbmdUYXNrKHRhc2tBcGkpIHtcclxuICAgICAgICAvLyBEbyBub3RoaW5nLCBvdmVycmlkZW4gYnkgaW5oZXJpdG9yc1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgcmV0dXJuIERlcGVuZGVuY3lXb3JrZXJzO1xyXG59KSgpO1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBEZXBlbmRlbmN5V29ya2VyczsiLCIndXNlIHN0cmljdCc7XHJcblxyXG52YXIgTGlua2VkTGlzdCA9IHJlcXVpcmUoJ2xpbmtlZC1saXN0Jyk7XHJcblxyXG52YXIgSGFzaE1hcCA9IChmdW5jdGlvbiBIYXNoTWFwQ2xvc3VyZSgpIHtcclxuXHJcbmZ1bmN0aW9uIEhhc2hNYXAoaGFzaGVyKSB7XHJcbiAgICB2YXIgdGhhdCA9IHRoaXM7XHJcbiAgICB0aGF0Ll9oYXNoZXIgPSBoYXNoZXI7XHJcbiAgICB0aGF0LmNsZWFyKCk7XHJcbn1cclxuXHJcbkhhc2hNYXAucHJvdG90eXBlLmNsZWFyID0gZnVuY3Rpb24gY2xlYXIoKSB7XHJcbiAgICB0aGlzLl9saXN0QnlLZXkgPSBbXTtcclxuICAgIHRoaXMuX2xpc3RPZkxpc3RzID0gbmV3IExpbmtlZExpc3QoKTtcclxuICAgIHRoaXMuX2NvdW50ID0gMDtcclxufTtcclxuXHJcbkhhc2hNYXAucHJvdG90eXBlLmdldEZyb21LZXkgPSBmdW5jdGlvbiBnZXRGcm9tS2V5KGtleSkge1xyXG4gICAgdmFyIGhhc2hDb2RlID0gdGhpcy5faGFzaGVyWydnZXRIYXNoQ29kZSddKGtleSk7XHJcbiAgICB2YXIgaGFzaEVsZW1lbnRzID0gdGhpcy5fbGlzdEJ5S2V5W2hhc2hDb2RlXTtcclxuICAgIGlmICghaGFzaEVsZW1lbnRzKSB7XHJcbiAgICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICB9XHJcbiAgICB2YXIgbGlzdCA9IGhhc2hFbGVtZW50cy5saXN0O1xyXG4gICAgXHJcbiAgICB2YXIgaXRlcmF0b3IgPSBsaXN0LmdldEZpcnN0SXRlcmF0b3IoKTtcclxuICAgIHdoaWxlIChpdGVyYXRvciAhPT0gbnVsbCkge1xyXG4gICAgICAgIHZhciBpdGVtID0gbGlzdC5nZXRGcm9tSXRlcmF0b3IoaXRlcmF0b3IpO1xyXG4gICAgICAgIGlmICh0aGlzLl9oYXNoZXJbJ2lzRXF1YWwnXShpdGVtLmtleSwga2V5KSkge1xyXG4gICAgICAgICAgICByZXR1cm4gaXRlbS52YWx1ZTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgaXRlcmF0b3IgPSBsaXN0LmdldE5leHRJdGVyYXRvcihpdGVyYXRvcik7XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIG51bGw7XHJcbn07XHJcblxyXG5IYXNoTWFwLnByb3RvdHlwZS5nZXRGcm9tSXRlcmF0b3IgPSBmdW5jdGlvbiBnZXRGcm9tSXRlcmF0b3IoaXRlcmF0b3IpIHtcclxuICAgIHJldHVybiBpdGVyYXRvci5faGFzaEVsZW1lbnRzLmxpc3QuZ2V0RnJvbUl0ZXJhdG9yKGl0ZXJhdG9yLl9pbnRlcm5hbEl0ZXJhdG9yKS52YWx1ZTtcclxufTtcclxuXHJcbkhhc2hNYXAucHJvdG90eXBlLnRyeUFkZCA9IGZ1bmN0aW9uIHRyeUFkZChrZXksIGNyZWF0ZVZhbHVlKSB7XHJcbiAgICB2YXIgaGFzaENvZGUgPSB0aGlzLl9oYXNoZXJbJ2dldEhhc2hDb2RlJ10oa2V5KTtcclxuICAgIHZhciBoYXNoRWxlbWVudHMgPSB0aGlzLl9saXN0QnlLZXlbaGFzaENvZGVdO1xyXG4gICAgaWYgKCFoYXNoRWxlbWVudHMpIHtcclxuICAgICAgICBoYXNoRWxlbWVudHMgPSB7XHJcbiAgICAgICAgICAgIGhhc2hDb2RlOiBoYXNoQ29kZSxcclxuICAgICAgICAgICAgbGlzdDogbmV3IExpbmtlZExpc3QoKSxcclxuICAgICAgICAgICAgbGlzdE9mTGlzdHNJdGVyYXRvcjogbnVsbFxyXG4gICAgICAgIH07XHJcbiAgICAgICAgaGFzaEVsZW1lbnRzLmxpc3RPZkxpc3RzSXRlcmF0b3IgPSB0aGlzLl9saXN0T2ZMaXN0cy5hZGQoaGFzaEVsZW1lbnRzKTtcclxuICAgICAgICB0aGlzLl9saXN0QnlLZXlbaGFzaENvZGVdID0gaGFzaEVsZW1lbnRzO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICB2YXIgaXRlcmF0b3IgPSB7XHJcbiAgICAgICAgX2hhc2hFbGVtZW50czogaGFzaEVsZW1lbnRzLFxyXG4gICAgICAgIF9pbnRlcm5hbEl0ZXJhdG9yOiBudWxsXHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBpdGVyYXRvci5faW50ZXJuYWxJdGVyYXRvciA9IGhhc2hFbGVtZW50cy5saXN0LmdldEZpcnN0SXRlcmF0b3IoKTtcclxuICAgIHdoaWxlIChpdGVyYXRvci5faW50ZXJuYWxJdGVyYXRvciAhPT0gbnVsbCkge1xyXG4gICAgICAgIHZhciBpdGVtID0gaGFzaEVsZW1lbnRzLmxpc3QuZ2V0RnJvbUl0ZXJhdG9yKGl0ZXJhdG9yLl9pbnRlcm5hbEl0ZXJhdG9yKTtcclxuICAgICAgICBpZiAodGhpcy5faGFzaGVyWydpc0VxdWFsJ10oaXRlbS5rZXksIGtleSkpIHtcclxuICAgICAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgICAgICAgIGl0ZXJhdG9yOiBpdGVyYXRvcixcclxuICAgICAgICAgICAgICAgIGlzTmV3OiBmYWxzZSxcclxuICAgICAgICAgICAgICAgIHZhbHVlOiBpdGVtLnZhbHVlXHJcbiAgICAgICAgICAgIH07XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIGl0ZXJhdG9yLl9pbnRlcm5hbEl0ZXJhdG9yID0gaGFzaEVsZW1lbnRzLmxpc3QuZ2V0TmV4dEl0ZXJhdG9yKGl0ZXJhdG9yLl9pbnRlcm5hbEl0ZXJhdG9yKTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgdmFyIHZhbHVlID0gY3JlYXRlVmFsdWUoKTtcclxuICAgIGl0ZXJhdG9yLl9pbnRlcm5hbEl0ZXJhdG9yID0gaGFzaEVsZW1lbnRzLmxpc3QuYWRkKHtcclxuICAgICAgICBrZXk6IGtleSxcclxuICAgICAgICB2YWx1ZTogdmFsdWVcclxuICAgIH0pO1xyXG4gICAgKyt0aGlzLl9jb3VudDtcclxuICAgIFxyXG4gICAgcmV0dXJuIHtcclxuICAgICAgICBpdGVyYXRvcjogaXRlcmF0b3IsXHJcbiAgICAgICAgaXNOZXc6IHRydWUsXHJcbiAgICAgICAgdmFsdWU6IHZhbHVlXHJcbiAgICB9O1xyXG59O1xyXG5cclxuSGFzaE1hcC5wcm90b3R5cGUucmVtb3ZlID0gZnVuY3Rpb24gcmVtb3ZlKGl0ZXJhdG9yKSB7XHJcbiAgICB2YXIgb2xkTGlzdENvdW50ID0gaXRlcmF0b3IuX2hhc2hFbGVtZW50cy5saXN0LmdldENvdW50KCk7XHJcbiAgICBpdGVyYXRvci5faGFzaEVsZW1lbnRzLmxpc3QucmVtb3ZlKGl0ZXJhdG9yLl9pbnRlcm5hbEl0ZXJhdG9yKTtcclxuICAgIHZhciBuZXdMaXN0Q291bnQgPSBpdGVyYXRvci5faGFzaEVsZW1lbnRzLmxpc3QuZ2V0Q291bnQoKTtcclxuICAgIFxyXG4gICAgdGhpcy5fY291bnQgKz0gKG5ld0xpc3RDb3VudCAtIG9sZExpc3RDb3VudCk7XHJcbiAgICBpZiAobmV3TGlzdENvdW50ID09PSAwKSB7XHJcbiAgICAgICAgdGhpcy5fbGlzdE9mTGlzdHMucmVtb3ZlKGl0ZXJhdG9yLl9oYXNoRWxlbWVudHMubGlzdE9mTGlzdHNJdGVyYXRvcik7XHJcbiAgICAgICAgZGVsZXRlIHRoaXMuX2xpc3RCeUtleVtpdGVyYXRvci5faGFzaEVsZW1lbnRzLmhhc2hDb2RlXTtcclxuICAgIH1cclxufTtcclxuXHJcbkhhc2hNYXAucHJvdG90eXBlLmdldENvdW50ID0gZnVuY3Rpb24gZ2V0Q291bnQoKSB7XHJcbiAgICByZXR1cm4gdGhpcy5fY291bnQ7XHJcbn07XHJcblxyXG5IYXNoTWFwLnByb3RvdHlwZS5nZXRGaXJzdEl0ZXJhdG9yID0gZnVuY3Rpb24gZ2V0Rmlyc3RJdGVyYXRvcigpIHtcclxuICAgIHZhciBmaXJzdExpc3RJdGVyYXRvciA9IHRoaXMuX2xpc3RPZkxpc3RzLmdldEZpcnN0SXRlcmF0b3IoKTtcclxuICAgIHZhciBmaXJzdEhhc2hFbGVtZW50cyA9IG51bGw7XHJcbiAgICB2YXIgZmlyc3RJbnRlcm5hbEl0ZXJhdG9yID0gbnVsbDtcclxuICAgIGlmIChmaXJzdExpc3RJdGVyYXRvciAhPT0gbnVsbCkge1xyXG4gICAgICAgIGZpcnN0SGFzaEVsZW1lbnRzID0gdGhpcy5fbGlzdE9mTGlzdHMuZ2V0RnJvbUl0ZXJhdG9yKGZpcnN0TGlzdEl0ZXJhdG9yKTtcclxuICAgICAgICBmaXJzdEludGVybmFsSXRlcmF0b3IgPSBmaXJzdEhhc2hFbGVtZW50cy5saXN0LmdldEZpcnN0SXRlcmF0b3IoKTtcclxuICAgIH1cclxuICAgIGlmIChmaXJzdEludGVybmFsSXRlcmF0b3IgPT09IG51bGwpIHtcclxuICAgICAgICByZXR1cm4gbnVsbDtcclxuICAgIH1cclxuICAgIFxyXG4gICAgcmV0dXJuIHtcclxuICAgICAgICBfaGFzaEVsZW1lbnRzOiBmaXJzdEhhc2hFbGVtZW50cyxcclxuICAgICAgICBfaW50ZXJuYWxJdGVyYXRvcjogZmlyc3RJbnRlcm5hbEl0ZXJhdG9yXHJcbiAgICB9O1xyXG59O1xyXG5cclxuSGFzaE1hcC5wcm90b3R5cGUuZ2V0TmV4dEl0ZXJhdG9yID0gZnVuY3Rpb24gZ2V0TmV4dEl0ZXJhdG9yKGl0ZXJhdG9yKSB7XHJcbiAgICB2YXIgbmV4dEl0ZXJhdG9yID0ge1xyXG4gICAgICAgIF9oYXNoRWxlbWVudHM6IGl0ZXJhdG9yLl9oYXNoRWxlbWVudHMsXHJcbiAgICAgICAgX2ludGVybmFsSXRlcmF0b3I6IGl0ZXJhdG9yLl9oYXNoRWxlbWVudHMubGlzdC5nZXROZXh0SXRlcmF0b3IoXHJcbiAgICAgICAgICAgIGl0ZXJhdG9yLl9pbnRlcm5hbEl0ZXJhdG9yKVxyXG4gICAgfTtcclxuICAgIFxyXG4gICAgd2hpbGUgKG5leHRJdGVyYXRvci5faW50ZXJuYWxJdGVyYXRvciA9PT0gbnVsbCkge1xyXG4gICAgICAgIHZhciBuZXh0TGlzdE9mTGlzdHNJdGVyYXRvciA9IHRoaXMuX2xpc3RPZkxpc3RzLmdldE5leHRJdGVyYXRvcihcclxuICAgICAgICAgICAgaXRlcmF0b3IuX2hhc2hFbGVtZW50cy5saXN0T2ZMaXN0c0l0ZXJhdG9yKTtcclxuICAgICAgICBpZiAobmV4dExpc3RPZkxpc3RzSXRlcmF0b3IgPT09IG51bGwpIHtcclxuICAgICAgICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIG5leHRJdGVyYXRvci5faGFzaEVsZW1lbnRzID0gdGhpcy5fbGlzdE9mTGlzdHMuZ2V0RnJvbUl0ZXJhdG9yKFxyXG4gICAgICAgICAgICBuZXh0TGlzdE9mTGlzdHNJdGVyYXRvcik7XHJcbiAgICAgICAgbmV4dEl0ZXJhdG9yLl9pbnRlcm5hbEl0ZXJhdG9yID1cclxuICAgICAgICAgICAgbmV4dEl0ZXJhdG9yLl9oYXNoRWxlbWVudHMubGlzdC5nZXRGaXJzdEl0ZXJhdG9yKCk7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gbmV4dEl0ZXJhdG9yO1xyXG59O1xyXG5cclxucmV0dXJuIEhhc2hNYXA7XHJcbn0pKCk7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IEhhc2hNYXA7IiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxudmFyIEhhc2hNYXAgPSByZXF1aXJlKCdoYXNoLW1hcCcpO1xyXG5cclxudmFyIEpzQnVpbHRpbkhhc2hNYXAgPSAoZnVuY3Rpb24gSGFzaE1hcENsb3N1cmUoKSB7XHJcbiAgICBcclxuLy8gVGhpcyBjbGFzcyBleHBvc2Ugc2FtZSBBUEkgYXMgSGFzaE1hcCBidXQgbm90IHJlcXVpcmluZyBnZXRIYXNoQ29kZSgpIGFuZCBpc0VxdWFsKCkgZnVuY3Rpb25zLlxyXG4vLyBUaGF0IHdheSBpdCdzIGVhc3kgdG8gc3dpdGNoIGJldHdlZW4gaW1wbGVtZW50YXRpb25zLlxyXG5cclxudmFyIHNpbXBsZUhhc2hlciA9IHtcclxuICAgICdnZXRIYXNoQ29kZSc6IGZ1bmN0aW9uIGdldEhhc2hDb2RlKGtleSkge1xyXG4gICAgICAgIHJldHVybiBrZXk7XHJcbiAgICB9LFxyXG4gICAgXHJcbiAgICAnaXNFcXVhbCc6IGZ1bmN0aW9uIGlzRXF1YWwoa2V5MSwga2V5Mikge1xyXG4gICAgICAgIHJldHVybiBrZXkxID09PSBrZXkyO1xyXG4gICAgfVxyXG59O1xyXG5cclxuZnVuY3Rpb24gSnNCdWlsdGluSGFzaE1hcCgpIHtcclxuICAgIEhhc2hNYXAuY2FsbCh0aGlzLCAvKmhhc2hlcj0qL3NpbXBsZUhhc2hlcik7XHJcbn1cclxuXHJcbkpzQnVpbHRpbkhhc2hNYXAucHJvdG90eXBlID0gT2JqZWN0LmNyZWF0ZShIYXNoTWFwLnByb3RvdHlwZSk7XHJcblxyXG5yZXR1cm4gSnNCdWlsdGluSGFzaE1hcDtcclxufSkoKTtcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gSnNCdWlsdGluSGFzaE1hcDsiLCIndXNlIHN0cmljdCc7XHJcblxyXG52YXIgTGlua2VkTGlzdCA9IChmdW5jdGlvbiBMaW5rZWRMaXN0Q2xvc3VyZSgpIHtcclxuXHJcbmZ1bmN0aW9uIExpbmtlZExpc3QoKSB7XHJcbiAgICB0aGlzLmNsZWFyKCk7XHJcbn1cclxuXHJcbkxpbmtlZExpc3QucHJvdG90eXBlLmNsZWFyID0gZnVuY3Rpb24gY2xlYXIoKSB7XHJcbiAgICB0aGlzLl9maXJzdCA9IHsgX3ByZXY6IG51bGwsIF9wYXJlbnQ6IHRoaXMgfTtcclxuICAgIHRoaXMuX2xhc3QgPSB7IF9uZXh0OiBudWxsLCBfcGFyZW50OiB0aGlzIH07XHJcbiAgICB0aGlzLl9jb3VudCA9IDA7XHJcbiAgICBcclxuICAgIHRoaXMuX2xhc3QuX3ByZXYgPSB0aGlzLl9maXJzdDtcclxuICAgIHRoaXMuX2ZpcnN0Ll9uZXh0ID0gdGhpcy5fbGFzdDtcclxufTtcclxuXHJcbkxpbmtlZExpc3QucHJvdG90eXBlLmFkZCA9IGZ1bmN0aW9uIGFkZCh2YWx1ZSwgYWRkQmVmb3JlKSB7XHJcbiAgICBpZiAoYWRkQmVmb3JlID09PSBudWxsIHx8IGFkZEJlZm9yZSA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgYWRkQmVmb3JlID0gdGhpcy5fbGFzdDtcclxuICAgIH1cclxuICAgIFxyXG4gICAgdGhpcy5fdmFsaWRhdGVJdGVyYXRvck9mVGhpcyhhZGRCZWZvcmUpO1xyXG4gICAgXHJcbiAgICArK3RoaXMuX2NvdW50O1xyXG4gICAgXHJcbiAgICB2YXIgbmV3Tm9kZSA9IHtcclxuICAgICAgICBfdmFsdWU6IHZhbHVlLFxyXG4gICAgICAgIF9uZXh0OiBhZGRCZWZvcmUsXHJcbiAgICAgICAgX3ByZXY6IGFkZEJlZm9yZS5fcHJldixcclxuICAgICAgICBfcGFyZW50OiB0aGlzXHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBuZXdOb2RlLl9wcmV2Ll9uZXh0ID0gbmV3Tm9kZTtcclxuICAgIGFkZEJlZm9yZS5fcHJldiA9IG5ld05vZGU7XHJcbiAgICBcclxuICAgIHJldHVybiBuZXdOb2RlO1xyXG59O1xyXG5cclxuTGlua2VkTGlzdC5wcm90b3R5cGUucmVtb3ZlID0gZnVuY3Rpb24gcmVtb3ZlKGl0ZXJhdG9yKSB7XHJcbiAgICB0aGlzLl92YWxpZGF0ZUl0ZXJhdG9yT2ZUaGlzKGl0ZXJhdG9yKTtcclxuICAgIFxyXG4gICAgLS10aGlzLl9jb3VudDtcclxuICAgIFxyXG4gICAgaXRlcmF0b3IuX3ByZXYuX25leHQgPSBpdGVyYXRvci5fbmV4dDtcclxuICAgIGl0ZXJhdG9yLl9uZXh0Ll9wcmV2ID0gaXRlcmF0b3IuX3ByZXY7XHJcbiAgICBpdGVyYXRvci5fcGFyZW50ID0gbnVsbDtcclxufTtcclxuXHJcbkxpbmtlZExpc3QucHJvdG90eXBlLmdldEZyb21JdGVyYXRvciA9IGZ1bmN0aW9uIGdldEZyb21JdGVyYXRvcihpdGVyYXRvcikge1xyXG4gICAgdGhpcy5fdmFsaWRhdGVJdGVyYXRvck9mVGhpcyhpdGVyYXRvcik7XHJcbiAgICBcclxuICAgIHJldHVybiBpdGVyYXRvci5fdmFsdWU7XHJcbn07XHJcblxyXG5MaW5rZWRMaXN0LnByb3RvdHlwZS5nZXRGaXJzdEl0ZXJhdG9yID0gZnVuY3Rpb24gZ2V0Rmlyc3RJdGVyYXRvcigpIHtcclxuICAgIHZhciBpdGVyYXRvciA9IHRoaXMuZ2V0TmV4dEl0ZXJhdG9yKHRoaXMuX2ZpcnN0KTtcclxuICAgIHJldHVybiBpdGVyYXRvcjtcclxufTtcclxuXHJcbkxpbmtlZExpc3QucHJvdG90eXBlLmdldExhc3RJdGVyYXRvciA9IGZ1bmN0aW9uIGdldEZpcnN0SXRlcmF0b3IoKSB7XHJcbiAgICB2YXIgaXRlcmF0b3IgPSB0aGlzLmdldFByZXZJdGVyYXRvcih0aGlzLl9sYXN0KTtcclxuICAgIHJldHVybiBpdGVyYXRvcjtcclxufTtcclxuXHJcbkxpbmtlZExpc3QucHJvdG90eXBlLmdldE5leHRJdGVyYXRvciA9IGZ1bmN0aW9uIGdldE5leHRJdGVyYXRvcihpdGVyYXRvcikge1xyXG4gICAgdGhpcy5fdmFsaWRhdGVJdGVyYXRvck9mVGhpcyhpdGVyYXRvcik7XHJcblxyXG4gICAgaWYgKGl0ZXJhdG9yLl9uZXh0ID09PSB0aGlzLl9sYXN0KSB7XHJcbiAgICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHJldHVybiBpdGVyYXRvci5fbmV4dDtcclxufTtcclxuXHJcbkxpbmtlZExpc3QucHJvdG90eXBlLmdldFByZXZJdGVyYXRvciA9IGZ1bmN0aW9uIGdldFByZXZJdGVyYXRvcihpdGVyYXRvcikge1xyXG4gICAgdGhpcy5fdmFsaWRhdGVJdGVyYXRvck9mVGhpcyhpdGVyYXRvcik7XHJcblxyXG4gICAgaWYgKGl0ZXJhdG9yLl9wcmV2ID09PSB0aGlzLl9maXJzdCkge1xyXG4gICAgICAgIHJldHVybiBudWxsO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICByZXR1cm4gaXRlcmF0b3IuX3ByZXY7XHJcbn07XHJcblxyXG5MaW5rZWRMaXN0LnByb3RvdHlwZS5nZXRDb3VudCA9IGZ1bmN0aW9uIGdldENvdW50KCkge1xyXG4gICAgcmV0dXJuIHRoaXMuX2NvdW50O1xyXG59O1xyXG5cclxuTGlua2VkTGlzdC5wcm90b3R5cGUuX3ZhbGlkYXRlSXRlcmF0b3JPZlRoaXMgPVxyXG4gICAgZnVuY3Rpb24gdmFsaWRhdGVJdGVyYXRvck9mVGhpcyhpdGVyYXRvcikge1xyXG4gICAgXHJcbiAgICBpZiAoaXRlcmF0b3IuX3BhcmVudCAhPT0gdGhpcykge1xyXG4gICAgICAgIHRocm93ICdpdGVyYXRvciBtdXN0IGJlIG9mIHRoZSBjdXJyZW50IExpbmtlZExpc3QnO1xyXG4gICAgfVxyXG59O1xyXG5cclxucmV0dXJuIExpbmtlZExpc3Q7XHJcbn0pKCk7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IExpbmtlZExpc3Q7IiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxudmFyIERlcGVuZGVuY3lXb3JrZXJzID0gcmVxdWlyZSgnZGVwZW5kZW5jeS13b3JrZXJzJyk7XHJcblxyXG52YXIgU2NoZWR1bGVyRGVwZW5kZW5jeVdvcmtlcnMgPSAoZnVuY3Rpb24gU2NoZWR1bGVyRGVwZW5kZW5jeVdvcmtlcnNDbG9zdXJlKCkge1xyXG4gICAgZnVuY3Rpb24gU2NoZWR1bGVyRGVwZW5kZW5jeVdvcmtlcnMoc2NoZWR1bGVyLCBpbnB1dFJldHJlaXZlcikge1xyXG4gICAgICAgIHZhciB0aGF0ID0gdGhpcztcclxuICAgICAgICBEZXBlbmRlbmN5V29ya2Vycy5jYWxsKHRoaXMsIGlucHV0UmV0cmVpdmVyKTtcclxuICAgICAgICB0aGF0Ll9zY2hlZHVsZXIgPSBzY2hlZHVsZXI7XHJcbiAgICAgICAgdGhhdC5faXNEaXNhYmxlV29ya2VyQ2FjaGUgPSBbXTtcclxuICAgICAgICB0aGF0Ll9pbnB1dFJldHJlaXZlciA9IGlucHV0UmV0cmVpdmVyO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBTY2hlZHVsZXJEZXBlbmRlbmN5V29ya2Vycy5wcm90b3R5cGUgPSBPYmplY3QuY3JlYXRlKERlcGVuZGVuY3lXb3JrZXJzLnByb3RvdHlwZSk7XHJcbiAgICBcclxuICAgIFNjaGVkdWxlckRlcGVuZGVuY3lXb3JrZXJzLnByb3RvdHlwZS5pbml0aWFsaXppbmdUYXNrID0gZnVuY3Rpb24gaW5pdGlhbGl6aW5nVGFzayh0YXNrQXBpLCBzY2hlZHVsZU5vdGlmaWVyKSB7XHJcbiAgICAgICAgdmFyIHRoYXQgPSB0aGlzO1xyXG4gICAgICAgIHRhc2tBcGkub24oJ2RlcGVuZGVuY3lUYXNrQ3VzdG9tJywgZnVuY3Rpb24oY3VzdG9tRXZlbnROYW1lLCBkZXBlbmRlbmN5VGFza0tleSkge1xyXG4gICAgICAgICAgICBpZiAoY3VzdG9tRXZlbnROYW1lICE9PSAnYWJvcnRpbmcnKSB7XHJcbiAgICAgICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGlmICghdGhhdC5fc2NoZWR1bGVyLnNob3VsZEFib3J0KHNjaGVkdWxlTm90aWZpZXIpKSB7XHJcbiAgICAgICAgICAgICAgICB0aHJvdyAnVGFzayAnICsgZGVwZW5kZW5jeVRhc2tLZXkgKyAnIGFib3J0ZWQgYnV0IGEgdGFzayBkZXBlbmRzICcgK1xyXG4gICAgICAgICAgICAgICAgICAgICdvbiBpdCBkaWRuXFwndC4gQ2hlY2sgc2NoZWR1bGVyIGNvbnNpc3RlbmN5JztcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgc2NoZWR1bGVOb3RpZmllci5hYm9ydCgvKmFib3J0QnlTY2hlZHVsZXI9Ki9mYWxzZSk7XHJcbiAgICAgICAgfSk7XHJcbiAgICB9O1xyXG5cclxuICAgIFNjaGVkdWxlckRlcGVuZGVuY3lXb3JrZXJzLnByb3RvdHlwZS53YWl0Rm9yU2NoZWR1bGUgPSBmdW5jdGlvbiB3YWl0Rm9yU2NoZWR1bGUoc2NoZWR1bGVOb3RpZmllciwgd29ya2VyVHlwZSkge1xyXG4gICAgICAgIGlmICh0aGlzLl9pc0Rpc2FibGVXb3JrZXJDYWNoZVt3b3JrZXJUeXBlXSA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgICAgIHRoaXMuX2lzRGlzYWJsZVdvcmtlckNhY2hlW3dvcmtlclR5cGVdID0gdGhpcy5faW5wdXRSZXRyZWl2ZXIuZ2V0V29ya2VyVHlwZU9wdGlvbnMod29ya2VyVHlwZSkgPT09IG51bGw7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIGlmICh0aGlzLl9pc0Rpc2FibGVXb3JrZXJDYWNoZVt3b3JrZXJUeXBlXSkge1xyXG4gICAgICAgICAgICBEZXBlbmRlbmN5V29ya2Vycy5wcm90b3R5cGUud2FpdEZvclNjaGVkdWxlLmNhbGwodGhpcywgc2NoZWR1bGVOb3RpZmllcik7XHJcbiAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIHZhciBpc0ZpbmlzaGVkID0gZmFsc2U7XHJcbiAgICAgICAgdmFyIGpvYkNhbGxiYWNrcyA9IG51bGw7XHJcbiAgICAgICAgdmFyIHRoYXQgPSB0aGlzO1xyXG5cclxuICAgICAgICB0aGlzLl9zY2hlZHVsZXIuZW5xdWV1ZUpvYihcclxuICAgICAgICAgICAgZnVuY3Rpb24gb25TY2hlZHVsZWQocmVzb3VyY2UsIGpvYkNvbnRleHQsIGpvYkNhbGxiYWNrc18pIHtcclxuICAgICAgICAgICAgICAgIGlmIChqb2JDb250ZXh0ICE9PSBzY2hlZHVsZU5vdGlmaWVyKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhyb3cgJ2RlcGVuZGVuY3lXb3JrZXJzOiBXcm9uZyBqb2JDb250ZXh0IC0gc2VlbXMgaW50ZXJuYWwgZXJyb3IgaW4gcmVzb3VyY2Utc2NoZWR1bGVyLmpzJztcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgaWYgKGlzRmluaXNoZWQpIHtcclxuICAgICAgICAgICAgICAgICAgICB0aHJvdyAnZGVwZW5kZW5jeVdvcmtlcnM6IHNjaGVkdWxlZCBhZnRlciBmaW5pc2gnO1xyXG4gICAgICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgICAgIGlmIChqb2JDYWxsYmFja3MgIT09IG51bGwpIHtcclxuICAgICAgICAgICAgICAgICAgICB0aHJvdyAnZGVwZW5kZW5jeVdvcmtlcnM6IFNjaGVkdWxlZCB0d2ljZSc7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIGpvYkNhbGxiYWNrcyA9IGpvYkNhbGxiYWNrc187XHJcbiAgICAgICAgICAgICAgICBzY2hlZHVsZU5vdGlmaWVyLnNjaGVkdWxlKGpvYkNhbGxiYWNrcyk7XHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIC8qam9iQ29udGV4dD0qL3NjaGVkdWxlTm90aWZpZXIsXHJcbiAgICAgICAgICAgIGZ1bmN0aW9uIG9uQWJvcnRlZCgpIHtcclxuICAgICAgICAgICAgICAgIGlmIChpc0ZpbmlzaGVkKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhyb3cgJ2RlcGVuZGVuY3lXb3JrZXJzOiBhYm9ydCBhZnRlciBmaW5pc2gnO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICBpZiAoam9iQ2FsbGJhY2tzICE9PSBudWxsKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhyb3cgJ2RlcGVuZGVuY3lXb3JrZXJzOiBhYm9ydCBhZnRlciBzY2hlZHVsZWQnO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICBqb2JDYWxsYmFja3MgPSBudWxsO1xyXG4gICAgICAgICAgICAgICAgaXNGaW5pc2hlZCA9IHRydWU7XHJcbiAgICAgICAgICAgICAgICBzY2hlZHVsZU5vdGlmaWVyLmFib3J0KC8qYWJvcnRCeVNjaGVkdWxlcj0qL3RydWUpO1xyXG4gICAgICAgICAgICB9KTtcclxuICAgIH07XHJcbiAgICBcclxuICAgIHJldHVybiBTY2hlZHVsZXJEZXBlbmRlbmN5V29ya2VycztcclxufSkoKTtcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gU2NoZWR1bGVyRGVwZW5kZW5jeVdvcmtlcnM7IiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxudmFyIFdyYXBwZXJJbnB1dFJldHJlaXZlckJhc2UgPSAoZnVuY3Rpb24gV3JhcHBlcklucHV0UmV0cmVpdmVyQmFzZUNsb3N1cmUoKSB7XHJcbiAgICBmdW5jdGlvbiBXcmFwcGVySW5wdXRSZXRyZWl2ZXJCYXNlKGlucHV0UmV0cmVpdmVyKSB7XHJcbiAgICAgICAgaWYgKCFpbnB1dFJldHJlaXZlci5nZXRLZXlBc1N0cmluZykge1xyXG4gICAgICAgICAgICB0aHJvdyAnZGVwZW5kZW5jeVdvcmtlcnM6IE5vICcgK1xyXG4gICAgICAgICAgICAgICAgJ2lucHV0UmV0cmVpdmVyLmdldEtleUFzU3RyaW5nKCkgbWV0aG9kJztcclxuICAgICAgICB9XHJcbiAgICAgICAgaWYgKCFpbnB1dFJldHJlaXZlci5nZXRXb3JrZXJUeXBlT3B0aW9ucykge1xyXG4gICAgICAgICAgICB0aHJvdyAnZGVwZW5kZW5jeVdvcmtlcnM6IE5vICcgK1xyXG4gICAgICAgICAgICAgICAgJ2lucHV0UmV0cmVpdmVyLmdldFRhc2tUeXBlT3B0aW9ucygpIG1ldGhvZCc7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICB2YXIgdGhhdCA9IHRoaXM7XHJcbiAgICAgICAgdGhhdC5faW5wdXRSZXRyZWl2ZXIgPSBpbnB1dFJldHJlaXZlcjtcclxuICAgIH1cclxuICAgIFxyXG4gICAgV3JhcHBlcklucHV0UmV0cmVpdmVyQmFzZS5wcm90b3R5cGUudGFza1N0YXJ0ZWQgPVxyXG4gICAgICAgICAgICBmdW5jdGlvbiB0YXNrU3RhcnRlZCh0YXNrKSB7XHJcbiAgICAgICAgXHJcbiAgICAgICAgdGhyb3cgJ2RlcGVuZGVuY3lXb3JrZXJzOiBOb3QgaW1wbGVtZW50ZWQgdGFza1N0YXJ0ZWQoKSc7XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBXcmFwcGVySW5wdXRSZXRyZWl2ZXJCYXNlLnByb3RvdHlwZS5nZXRLZXlBc1N0cmluZyA9IGZ1bmN0aW9uKGtleSkge1xyXG4gICAgICAgIHJldHVybiB0aGlzLl9pbnB1dFJldHJlaXZlci5nZXRLZXlBc1N0cmluZyhrZXkpO1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgXHJcbiAgICBXcmFwcGVySW5wdXRSZXRyZWl2ZXJCYXNlLnByb3RvdHlwZS5nZXRXb3JrZXJUeXBlT3B0aW9ucyA9IGZ1bmN0aW9uKHRhc2tUeXBlKSB7XHJcbiAgICAgICAgcmV0dXJuIHRoaXMuX2lucHV0UmV0cmVpdmVyLmdldFdvcmtlclR5cGVPcHRpb25zKHRhc2tUeXBlKTtcclxuICAgIH07XHJcbiAgICBcclxuICAgIHJldHVybiBXcmFwcGVySW5wdXRSZXRyZWl2ZXJCYXNlO1xyXG59KSgpO1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBXcmFwcGVySW5wdXRSZXRyZWl2ZXJCYXNlOyJdfQ==

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
    this._openArg = options.openArg;

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
    
    this._imageViewer.open(this._openArg);
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
    this._openArg = options.openArg;
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
    if (!url) {
        url = 'unknown-url';
    }
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
    
    this._imageDecoder.open(this._openArg)
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
    return this._url;
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

DecodeJob.WithPriority = DecodeJobWithPriority;

function DecodeJob(listenerHandle, imagePartParams, prioritizer) {
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

function DecodeJobWithPriority(listenerHandle, imagePartParams, prioritizer) {
    DecodeJob.call(this, listenerHandle, imagePartParams);
    this._prioritizer = prioritizer;
}

DecodeJobWithPriority.prototype = Object.create(DecodeJob.prototype);

DecodeJobWithPriority.prototype.priorityCalculator = function priorityCalculator() {
    return this._prioritizer.getPriority(this);
};
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
    var decodeJob = this._prioritizer === null ?
        new DecodeJob(listenerHandle, imagePartParams) :
        new DecodeJob.WithPriority(listenerHandle, imagePartParams, this._prioritizer);
    var taskContext = this._decodeDependencyWorkers.startTask(imagePartParams, decodeJob);
    listenerHandle.taskContexts.push(taskContext);
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

FetchManager.prototype.open = function open(openArg) {
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
    return this._fetcher.open(openArg).then(function(result) {
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
    isIndirectCreationNeeded: isIndirectCreationNeeded,
    renderToCanvas: renderToCanvas
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

function renderToCanvas(canvas, regionParams, imageDecoder, x, y) {
    var targetContext = canvas.getContext('2d');
    var tempCanvas, tempContext, alignedParams, imagePartParams;
    
    /* global Promise: false */
    return new Promise(function(resolve, reject) {
        alignedParams = alignParamsToTilesAndLevel(regionParams, imageDecoder);
        imagePartParams = alignedParams.imagePartParams;

        imageDecoder.requestPixelsProgressive(
            imagePartParams,
            regionDecodedCallback,
            function terminatedCallback(isAborted) {
                if (isAborted) {
                    reject('Fetch is aborted');
                } else {
                    resolve();
                }
            });
    });
    
    function regionDecodedCallback(partialDecodeResult) {
        if (!tempCanvas) {
            tempCanvas = document.createElement('canvas');
            tempCanvas.width  = imagePartParams.maxXExclusive - imagePartParams.minX;
            tempCanvas.height = imagePartParams.maxYExclusive - imagePartParams.minY;

            tempContext = tempCanvas.getContext('2d');
            tempContext.clearRect(0, 0, tempCanvas.width, tempCanvas.height);
        }
        
        tempContext.putImageData(
            partialDecodeResult.imageData,
            partialDecodeResult.xInOriginalRequest,
            partialDecodeResult.yInOriginalRequest);
        
        // Crop and scale original request region (before align) into canvas
        var crop = alignedParams.croppedScreen;
        targetContext.drawImage(tempCanvas,
            crop.minX, crop.minY, crop.maxXExclusive - crop.minX, crop.maxYExclusive - crop.minY,
            x || 0, y || 0, regionParams.screenWidth, regionParams.screenHeight);
    }
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
    
ImageDecoderViewer.prototype.open = function open(openArg) {
    return this._imageDecoder.open(openArg)
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

WorkerProxyImageDecoder.prototype.open = function open(openArg) {
    var self = this;
    var workerHelper = asyncProxy.AsyncProxyFactory.getWorkerHelper(this);
    return workerHelper.callFunction('open', [openArg], { isReturnPromise: true })
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

ImageDecoder.renderToCanvas = imageHelperFunctions.renderToCanvas;

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

ImageDecoder.prototype.open = function open(openArg) {
    this._validateFetcher();

    var self = this;
    var promise = this._fetchManager.open(openArg);
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
                
                this._imageViewer.open(this._options.openArg).catch(this._exceptionCallback);
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
//# sourceMappingURL=data:application/json;charset:utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJzcmMvY2VzaXVtLWltYWdlLWRlY29kZXIvY2FudmFzLWltYWdlcnktcHJvdmlkZXIuanMiLCJzcmMvY2VzaXVtLWltYWdlLWRlY29kZXIvY2VzaXVtLWZydXN0dW0tY2FsY3VsYXRvci5qcyIsInNyYy9jZXNpdW0taW1hZ2UtZGVjb2Rlci9jZXNpdW0taW1hZ2UtZGVjb2Rlci1sYXllci1tYW5hZ2VyLmpzIiwic3JjL2Nlc2l1bS1pbWFnZS1kZWNvZGVyL2ltYWdlLWRlY29kZXItaW1hZ2VyeS1wcm92aWRlci5qcyIsInNyYy9pbWFnZS1kZWNvZGVyLWV4cG9ydHMuanMiLCJzcmMvaW1hZ2UtZGVjb2Rlci9pbWFnZS1kZWNvZGVyLWhlbHBlcnMvZGVjb2RlLWpvYi5qcyIsInNyYy9pbWFnZS1kZWNvZGVyL2ltYWdlLWRlY29kZXItaGVscGVycy9kZWNvZGUtam9icy1wb29sLmpzIiwic3JjL2ltYWdlLWRlY29kZXIvaW1hZ2UtZGVjb2Rlci1oZWxwZXJzL2ZldGNoLWNvbnRleHQtYXBpLmpzIiwic3JjL2ltYWdlLWRlY29kZXIvaW1hZ2UtZGVjb2Rlci1oZWxwZXJzL2ZldGNoLWNvbnRleHQuanMiLCJzcmMvaW1hZ2UtZGVjb2Rlci9pbWFnZS1kZWNvZGVyLWhlbHBlcnMvZmV0Y2gtbWFuYWdlci5qcyIsInNyYy9pbWFnZS1kZWNvZGVyL2ltYWdlLWRlY29kZXItaGVscGVycy9mZXRjaGVyLWNsb3Nlci5qcyIsInNyYy9pbWFnZS1kZWNvZGVyL2ltYWdlLWRlY29kZXItaGVscGVycy9mcnVzdHVtLXJlcXVlc3RzLXByaW9yaXRpemVyLmpzIiwic3JjL2ltYWdlLWRlY29kZXIvaW1hZ2UtZGVjb2Rlci1oZWxwZXJzL2ltYWdlLWhlbHBlci1mdW5jdGlvbnMuanMiLCJzcmMvaW1hZ2UtZGVjb2Rlci9pbWFnZS1kZWNvZGVyLWhlbHBlcnMvbGlua2VkLWxpc3QuanMiLCJzcmMvaW1hZ2UtZGVjb2Rlci9pbWFnZS1kZWNvZGVyLXZpZXdlci5qcyIsInNyYy9pbWFnZS1kZWNvZGVyL2ltYWdlLWRlY29kZXItd29ya2Vycy9pbWFnZS1wYXJhbXMtcmV0cmlldmVyLXByb3h5LmpzIiwic3JjL2ltYWdlLWRlY29kZXIvaW1hZ2UtZGVjb2Rlci13b3JrZXJzL3dvcmtlci1wcm94eS1mZXRjaC1tYW5hZ2VyLmpzIiwic3JjL2ltYWdlLWRlY29kZXIvaW1hZ2UtZGVjb2Rlci13b3JrZXJzL3dvcmtlci1wcm94eS1pbWFnZS1kZWNvZGVyLmpzIiwic3JjL2ltYWdlLWRlY29kZXIvaW1hZ2UtZGVjb2Rlci5qcyIsInNyYy9sZWFmbGV0LWltYWdlLWRlY29kZXIvaW1hZ2UtZGVjb2Rlci1yZWdpb24tbGF5ZXIuanMiLCJzcmMvbGVhZmxldC1pbWFnZS1kZWNvZGVyL2xlYWZsZXQtZnJ1c3R1bS1jYWxjdWxhdG9yLmpzIiwic3JjL3NpbXBsZS1mZXRjaGVyL2dyaWQtZGVjb2Rlci13b3JrZXItYmFzZS5qcyIsInNyYy9zaW1wbGUtZmV0Y2hlci9ncmlkLWZldGNoZXItYmFzZS5qcyIsInNyYy9zaW1wbGUtZmV0Y2hlci9ncmlkLWltYWdlLWJhc2UuanMiLCJzcmMvc2ltcGxlLWZldGNoZXIvZ3JpZC1sZXZlbC1jYWxjdWxhdG9yLmpzIiwic3JjL3NpbXBsZS1mZXRjaGVyL3NpbXBsZS1mZXRjaGVyLWJhc2UuanMiLCJzcmMvc2ltcGxlLWZldGNoZXIvc2ltcGxlLW1vdmFibGUtZmV0Y2guanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7QUNBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdFVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzFGQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2pKQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDM2tCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNsQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDakZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDOUlBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM1Q0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3pVQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdE9BO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3ZDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3pLQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMxVUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3JHQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN0bkJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2pGQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDeERBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN6SUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BXQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQy9LQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ25CQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2pEQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMzUUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQy9JQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMzQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzFCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBIiwiZmlsZSI6ImdlbmVyYXRlZC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzQ29udGVudCI6WyIoZnVuY3Rpb24gZSh0LG4scil7ZnVuY3Rpb24gcyhvLHUpe2lmKCFuW29dKXtpZighdFtvXSl7dmFyIGE9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtpZighdSYmYSlyZXR1cm4gYShvLCEwKTtpZihpKXJldHVybiBpKG8sITApO3ZhciBmPW5ldyBFcnJvcihcIkNhbm5vdCBmaW5kIG1vZHVsZSAnXCIrbytcIidcIik7dGhyb3cgZi5jb2RlPVwiTU9EVUxFX05PVF9GT1VORFwiLGZ9dmFyIGw9bltvXT17ZXhwb3J0czp7fX07dFtvXVswXS5jYWxsKGwuZXhwb3J0cyxmdW5jdGlvbihlKXt2YXIgbj10W29dWzFdW2VdO3JldHVybiBzKG4/bjplKX0sbCxsLmV4cG9ydHMsZSx0LG4scil9cmV0dXJuIG5bb10uZXhwb3J0c312YXIgaT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2Zvcih2YXIgbz0wO288ci5sZW5ndGg7bysrKXMocltvXSk7cmV0dXJuIHN9KSIsIid1c2Ugc3RyaWN0JztcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gQ2FudmFzSW1hZ2VyeVByb3ZpZGVyO1xyXG5cclxuLyogZ2xvYmFsIENlc2l1bTogZmFsc2UgKi9cclxuLyogZ2xvYmFsIERldmVsb3BlckVycm9yOiBmYWxzZSAqL1xyXG4vKiBnbG9iYWwgQ3JlZGl0OiBmYWxzZSAqL1xyXG5cclxuLyoqXHJcbiAqIFByb3ZpZGVzIGEgU2luZ2xlIENhbnZhcyBpbWFnZXJ5IHRpbGUuICBUaGUgaW1hZ2UgaXMgYXNzdW1lZCB0byB1c2UgYVxyXG4gKiB7QGxpbmsgR2VvZ3JhcGhpY1RpbGluZ1NjaGVtZX0uXHJcbiAqXHJcbiAqIEBhbGlhcyBDYW52YXNJbWFnZXJ5UHJvdmlkZXJcclxuICogQGNvbnN0cnVjdG9yXHJcbiAqXHJcbiAqIEBwYXJhbSB7Y2FudmFzfSBDYW52YXMgZm9yIHRoZSB0aWxlLlxyXG4gKiBAcGFyYW0ge09iamVjdH0gb3B0aW9ucyBPYmplY3Qgd2l0aCB0aGUgZm9sbG93aW5nIHByb3BlcnRpZXM6XHJcbiAqIEBwYXJhbSB7Q3JlZGl0fFN0cmluZ30gW29wdGlvbnMuY3JlZGl0XSBBIGNyZWRpdCBmb3IgdGhlIGRhdGEgc291cmNlLCB3aGljaCBpcyBkaXNwbGF5ZWQgb24gdGhlIGNhbnZhcy5cclxuICpcclxuICogQHNlZSBBcmNHaXNNYXBTZXJ2ZXJJbWFnZXJ5UHJvdmlkZXJcclxuICogQHNlZSBCaW5nTWFwc0ltYWdlcnlQcm92aWRlclxyXG4gKiBAc2VlIEdvb2dsZUVhcnRoSW1hZ2VyeVByb3ZpZGVyXHJcbiAqIEBzZWUgT3BlblN0cmVldE1hcEltYWdlcnlQcm92aWRlclxyXG4gKiBAc2VlIFRpbGVNYXBTZXJ2aWNlSW1hZ2VyeVByb3ZpZGVyXHJcbiAqIEBzZWUgV2ViTWFwU2VydmljZUltYWdlcnlQcm92aWRlclxyXG4gKi9cclxuZnVuY3Rpb24gQ2FudmFzSW1hZ2VyeVByb3ZpZGVyKGNhbnZhcywgb3B0aW9ucykge1xyXG4gICAgaWYgKG9wdGlvbnMgPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIG9wdGlvbnMgPSB7fTtcclxuICAgIH1cclxuXHJcbiAgICAvLz4+aW5jbHVkZVN0YXJ0KCdkZWJ1ZycsIHByYWdtYXMuZGVidWcpO1xyXG4gICAgaWYgKGNhbnZhcyA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgdGhyb3cgbmV3IERldmVsb3BlckVycm9yKCdjYW52YXMgaXMgcmVxdWlyZWQuJyk7XHJcbiAgICB9XHJcbiAgICAvLz4+aW5jbHVkZUVuZCgnZGVidWcnKTtcclxuXHJcbiAgICB0aGlzLl9jYW52YXMgPSBjYW52YXM7XHJcblxyXG4gICAgdGhpcy5fZXJyb3JFdmVudCA9IG5ldyBFdmVudCgnQ2FudmFzSW1hZ2VyeVByb3ZpZGVyU3RhdHVzJyk7XHJcblxyXG4gICAgdGhpcy5fcmVhZHkgPSBmYWxzZTtcclxuXHJcbiAgICB2YXIgY3JlZGl0ID0gb3B0aW9ucy5jcmVkaXQ7XHJcbiAgICBpZiAodHlwZW9mIGNyZWRpdCA9PT0gJ3N0cmluZycpIHtcclxuICAgICAgICBjcmVkaXQgPSBuZXcgQ3JlZGl0KGNyZWRpdCk7XHJcbiAgICB9XHJcbiAgICB0aGlzLl9jcmVkaXQgPSBjcmVkaXQ7XHJcbn1cclxuXHJcbkNhbnZhc0ltYWdlcnlQcm92aWRlci5wcm90b3R5cGUgPSB7XHJcbiAgICAvKipcclxuICAgICAqIEdldHMgdGhlIHdpZHRoIG9mIGVhY2ggdGlsZSwgaW4gcGl4ZWxzLiBUaGlzIGZ1bmN0aW9uIHNob3VsZFxyXG4gICAgICogbm90IGJlIGNhbGxlZCBiZWZvcmUge0BsaW5rIENhbnZhc0ltYWdlcnlQcm92aWRlciNyZWFkeX0gcmV0dXJucyB0cnVlLlxyXG4gICAgICogQG1lbWJlcm9mIENhbnZhc0ltYWdlcnlQcm92aWRlci5wcm90b3R5cGVcclxuICAgICAqIEB0eXBlIHtOdW1iZXJ9XHJcbiAgICAgKiBAcmVhZG9ubHlcclxuICAgICAqL1xyXG4gICAgZ2V0IHRpbGVXaWR0aCgpIHtcclxuICAgICAgICAgICAgLy8+PmluY2x1ZGVTdGFydCgnZGVidWcnLCBwcmFnbWFzLmRlYnVnKTtcclxuICAgICAgICAgICAgaWYgKCF0aGlzLl9yZWFkeSkge1xyXG4gICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBEZXZlbG9wZXJFcnJvcigndGlsZVdpZHRoIG11c3Qgbm90IGJlIGNhbGxlZCBiZWZvcmUgdGhlIGltYWdlcnkgcHJvdmlkZXIgaXMgcmVhZHkuJyk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgLy8+PmluY2x1ZGVFbmQoJ2RlYnVnJyk7XHJcblxyXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5fY2FudmFzLndpZHRoO1xyXG4gICAgfSxcclxuXHJcbiAgICAvKipcclxuICAgICAqIEdldHMgdGhlIGhlaWdodCBvZiBlYWNoIHRpbGUsIGluIHBpeGVscy4gIFRoaXMgZnVuY3Rpb24gc2hvdWxkXHJcbiAgICAgKiBub3QgYmUgY2FsbGVkIGJlZm9yZSB7QGxpbmsgQ2FudmFzSW1hZ2VyeVByb3ZpZGVyI3JlYWR5fSByZXR1cm5zIHRydWUuXHJcbiAgICAgKiBAbWVtYmVyb2YgQ2FudmFzSW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZVxyXG4gICAgICogQHR5cGUge051bWJlcn1cclxuICAgICAqIEByZWFkb25seVxyXG4gICAgICovXHJcbiAgICBnZXQgdGlsZUhlaWdodCgpIHtcclxuICAgICAgICAgICAgLy8+PmluY2x1ZGVTdGFydCgnZGVidWcnLCBwcmFnbWFzLmRlYnVnKTtcclxuICAgICAgICAgICAgaWYgKCF0aGlzLl9yZWFkeSkge1xyXG4gICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBEZXZlbG9wZXJFcnJvcigndGlsZUhlaWdodCBtdXN0IG5vdCBiZSBjYWxsZWQgYmVmb3JlIHRoZSBpbWFnZXJ5IHByb3ZpZGVyIGlzIHJlYWR5LicpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIC8vPj5pbmNsdWRlRW5kKCdkZWJ1ZycpO1xyXG5cclxuICAgICAgICAgICAgcmV0dXJuIHRoaXMuX2NhbnZhcy5oZWlnaHQ7XHJcbiAgICB9LFxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2V0cyB0aGUgbWF4aW11bSBsZXZlbC1vZi1kZXRhaWwgdGhhdCBjYW4gYmUgcmVxdWVzdGVkLiAgVGhpcyBmdW5jdGlvbiBzaG91bGRcclxuICAgICAqIG5vdCBiZSBjYWxsZWQgYmVmb3JlIHtAbGluayBDYW52YXNJbWFnZXJ5UHJvdmlkZXIjcmVhZHl9IHJldHVybnMgdHJ1ZS5cclxuICAgICAqIEBtZW1iZXJvZiBDYW52YXNJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlXHJcbiAgICAgKiBAdHlwZSB7TnVtYmVyfVxyXG4gICAgICogQHJlYWRvbmx5XHJcbiAgICAgKi9cclxuICAgIGdldCBtYXhpbXVtTGV2ZWwoKSB7XHJcbiAgICAgICAgICAgIC8vPj5pbmNsdWRlU3RhcnQoJ2RlYnVnJywgcHJhZ21hcy5kZWJ1Zyk7XHJcbiAgICAgICAgICAgIGlmICghdGhpcy5fcmVhZHkpIHtcclxuICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRGV2ZWxvcGVyRXJyb3IoJ21heGltdW1MZXZlbCBtdXN0IG5vdCBiZSBjYWxsZWQgYmVmb3JlIHRoZSBpbWFnZXJ5IHByb3ZpZGVyIGlzIHJlYWR5LicpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIC8vPj5pbmNsdWRlRW5kKCdkZWJ1ZycpO1xyXG5cclxuICAgICAgICAgICAgcmV0dXJuIDA7XHJcbiAgICB9LFxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2V0cyB0aGUgbWluaW11bSBsZXZlbC1vZi1kZXRhaWwgdGhhdCBjYW4gYmUgcmVxdWVzdGVkLiAgVGhpcyBmdW5jdGlvbiBzaG91bGRcclxuICAgICAqIG5vdCBiZSBjYWxsZWQgYmVmb3JlIHtAbGluayBDYW52YXNJbWFnZXJ5UHJvdmlkZXIjcmVhZHl9IHJldHVybnMgdHJ1ZS5cclxuICAgICAqIEBtZW1iZXJvZiBDYW52YXNJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlXHJcbiAgICAgKiBAdHlwZSB7TnVtYmVyfVxyXG4gICAgICogQHJlYWRvbmx5XHJcbiAgICAgKi9cclxuICAgIGdldCBtaW5pbXVtTGV2ZWwoKSB7XHJcbiAgICAgICAgICAgIC8vPj5pbmNsdWRlU3RhcnQoJ2RlYnVnJywgcHJhZ21hcy5kZWJ1Zyk7XHJcbiAgICAgICAgICAgIGlmICghdGhpcy5fcmVhZHkpIHtcclxuICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRGV2ZWxvcGVyRXJyb3IoJ21pbmltdW1MZXZlbCBtdXN0IG5vdCBiZSBjYWxsZWQgYmVmb3JlIHRoZSBpbWFnZXJ5IHByb3ZpZGVyIGlzIHJlYWR5LicpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIC8vPj5pbmNsdWRlRW5kKCdkZWJ1ZycpO1xyXG5cclxuICAgICAgICAgICAgcmV0dXJuIDA7XHJcbiAgICB9LFxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2V0cyB0aGUgdGlsaW5nIHNjaGVtZSB1c2VkIGJ5IHRoaXMgcHJvdmlkZXIuICBUaGlzIGZ1bmN0aW9uIHNob3VsZFxyXG4gICAgICogbm90IGJlIGNhbGxlZCBiZWZvcmUge0BsaW5rIENhbnZhc0ltYWdlcnlQcm92aWRlciNyZWFkeX0gcmV0dXJucyB0cnVlLlxyXG4gICAgICogQG1lbWJlcm9mIENhbnZhc0ltYWdlcnlQcm92aWRlci5wcm90b3R5cGVcclxuICAgICAqIEB0eXBlIHtUaWxpbmdTY2hlbWV9XHJcbiAgICAgKiBAcmVhZG9ubHlcclxuICAgICAqL1xyXG4gICAgZ2V0IHRpbGluZ1NjaGVtZSgpIHtcclxuICAgICAgICAgICAgLy8+PmluY2x1ZGVTdGFydCgnZGVidWcnLCBwcmFnbWFzLmRlYnVnKTtcclxuICAgICAgICAgICAgaWYgKCF0aGlzLl9yZWFkeSkge1xyXG4gICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBEZXZlbG9wZXJFcnJvcigndGlsaW5nU2NoZW1lIG11c3Qgbm90IGJlIGNhbGxlZCBiZWZvcmUgdGhlIGltYWdlcnkgcHJvdmlkZXIgaXMgcmVhZHkuJyk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgLy8+PmluY2x1ZGVFbmQoJ2RlYnVnJyk7XHJcblxyXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5fdGlsaW5nU2NoZW1lO1xyXG4gICAgfSxcclxuXHJcbiAgICAvKipcclxuICAgICAqIEdldHMgdGhlIHJlY3RhbmdsZSwgaW4gcmFkaWFucywgb2YgdGhlIGltYWdlcnkgcHJvdmlkZWQgYnkgdGhpcyBpbnN0YW5jZS4gIFRoaXMgZnVuY3Rpb24gc2hvdWxkXHJcbiAgICAgKiBub3QgYmUgY2FsbGVkIGJlZm9yZSB7QGxpbmsgQ2FudmFzSW1hZ2VyeVByb3ZpZGVyI3JlYWR5fSByZXR1cm5zIHRydWUuXHJcbiAgICAgKiBAbWVtYmVyb2YgQ2FudmFzSW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZVxyXG4gICAgICogQHR5cGUge1JlY3RhbmdsZX1cclxuICAgICAqIEByZWFkb25seVxyXG4gICAgICovXHJcbiAgICBnZXQgcmVjdGFuZ2xlKCkge1xyXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5fdGlsaW5nU2NoZW1lLnJlY3RhbmdsZTtcclxuICAgIH0sXHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZXRzIHRoZSB0aWxlIGRpc2NhcmQgcG9saWN5LiAgSWYgbm90IHVuZGVmaW5lZCwgdGhlIGRpc2NhcmQgcG9saWN5IGlzIHJlc3BvbnNpYmxlXHJcbiAgICAgKiBmb3IgZmlsdGVyaW5nIG91dCBcIm1pc3NpbmdcIiB0aWxlcyB2aWEgaXRzIHNob3VsZERpc2NhcmRJbWFnZSBmdW5jdGlvbi4gIElmIHRoaXMgZnVuY3Rpb25cclxuICAgICAqIHJldHVybnMgdW5kZWZpbmVkLCBubyB0aWxlcyBhcmUgZmlsdGVyZWQuICBUaGlzIGZ1bmN0aW9uIHNob3VsZFxyXG4gICAgICogbm90IGJlIGNhbGxlZCBiZWZvcmUge0BsaW5rIENhbnZhc0ltYWdlcnlQcm92aWRlciNyZWFkeX0gcmV0dXJucyB0cnVlLlxyXG4gICAgICogQG1lbWJlcm9mIENhbnZhc0ltYWdlcnlQcm92aWRlci5wcm90b3R5cGVcclxuICAgICAqIEB0eXBlIHtUaWxlRGlzY2FyZFBvbGljeX1cclxuICAgICAqIEByZWFkb25seVxyXG4gICAgICovXHJcbiAgICBnZXQgdGlsZURpc2NhcmRQb2xpY3koKSB7XHJcbiAgICAgICAgICAgIC8vPj5pbmNsdWRlU3RhcnQoJ2RlYnVnJywgcHJhZ21hcy5kZWJ1Zyk7XHJcbiAgICAgICAgICAgIGlmICghdGhpcy5fcmVhZHkpIHtcclxuICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRGV2ZWxvcGVyRXJyb3IoJ3RpbGVEaXNjYXJkUG9saWN5IG11c3Qgbm90IGJlIGNhbGxlZCBiZWZvcmUgdGhlIGltYWdlcnkgcHJvdmlkZXIgaXMgcmVhZHkuJyk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgLy8+PmluY2x1ZGVFbmQoJ2RlYnVnJyk7XHJcblxyXG4gICAgICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xyXG4gICAgfSxcclxuXHJcbiAgICAvKipcclxuICAgICAqIEdldHMgYW4gZXZlbnQgdGhhdCBpcyByYWlzZWQgd2hlbiB0aGUgaW1hZ2VyeSBwcm92aWRlciBlbmNvdW50ZXJzIGFuIGFzeW5jaHJvbm91cyBlcnJvci4gIEJ5IHN1YnNjcmliaW5nXHJcbiAgICAgKiB0byB0aGUgZXZlbnQsIHlvdSB3aWxsIGJlIG5vdGlmaWVkIG9mIHRoZSBlcnJvciBhbmQgY2FuIHBvdGVudGlhbGx5IHJlY292ZXIgZnJvbSBpdC4gIEV2ZW50IGxpc3RlbmVyc1xyXG4gICAgICogYXJlIHBhc3NlZCBhbiBpbnN0YW5jZSBvZiB7QGxpbmsgVGlsZVByb3ZpZGVyRXJyb3J9LlxyXG4gICAgICogQG1lbWJlcm9mIENhbnZhc0ltYWdlcnlQcm92aWRlci5wcm90b3R5cGVcclxuICAgICAqIEB0eXBlIHtFdmVudH1cclxuICAgICAqIEByZWFkb25seVxyXG4gICAgICovXHJcbiAgICBnZXQgZXJyb3JFdmVudCgpIHtcclxuICAgICAgICAgICAgcmV0dXJuIHRoaXMuX2Vycm9yRXZlbnQ7XHJcbiAgICB9LFxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2V0cyBhIHZhbHVlIGluZGljYXRpbmcgd2hldGhlciBvciBub3QgdGhlIHByb3ZpZGVyIGlzIHJlYWR5IGZvciB1c2UuXHJcbiAgICAgKiBAbWVtYmVyb2YgQ2FudmFzSW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZVxyXG4gICAgICogQHR5cGUge0Jvb2xlYW59XHJcbiAgICAgKiBAcmVhZG9ubHlcclxuICAgICAqL1xyXG4gICAgZ2V0IHJlYWR5KCkge1xyXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5fcmVhZHk7XHJcbiAgICB9LFxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2V0cyB0aGUgY3JlZGl0IHRvIGRpc3BsYXkgd2hlbiB0aGlzIGltYWdlcnkgcHJvdmlkZXIgaXMgYWN0aXZlLiAgVHlwaWNhbGx5IHRoaXMgaXMgdXNlZCB0byBjcmVkaXRcclxuICAgICAqIHRoZSBzb3VyY2Ugb2YgdGhlIGltYWdlcnkuICBUaGlzIGZ1bmN0aW9uIHNob3VsZCBub3QgYmUgY2FsbGVkIGJlZm9yZSB7QGxpbmsgQ2FudmFzSW1hZ2VyeVByb3ZpZGVyI3JlYWR5fSByZXR1cm5zIHRydWUuXHJcbiAgICAgKiBAbWVtYmVyb2YgQ2FudmFzSW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZVxyXG4gICAgICogQHR5cGUge0NyZWRpdH1cclxuICAgICAqIEByZWFkb25seVxyXG4gICAgICovXHJcbiAgICBnZXQgY3JlZGl0KCkge1xyXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5fY3JlZGl0O1xyXG4gICAgfSxcclxuXHJcbiAgICAvKipcclxuICAgICAqIEdldHMgYSB2YWx1ZSBpbmRpY2F0aW5nIHdoZXRoZXIgb3Igbm90IHRoZSBpbWFnZXMgcHJvdmlkZWQgYnkgdGhpcyBpbWFnZXJ5IHByb3ZpZGVyXHJcbiAgICAgKiBpbmNsdWRlIGFuIGFscGhhIGNoYW5uZWwuICBJZiB0aGlzIHByb3BlcnR5IGlzIGZhbHNlLCBhbiBhbHBoYSBjaGFubmVsLCBpZiBwcmVzZW50LCB3aWxsXHJcbiAgICAgKiBiZSBpZ25vcmVkLiAgSWYgdGhpcyBwcm9wZXJ0eSBpcyB0cnVlLCBhbnkgaW1hZ2VzIHdpdGhvdXQgYW4gYWxwaGEgY2hhbm5lbCB3aWxsIGJlIHRyZWF0ZWRcclxuICAgICAqIGFzIGlmIHRoZWlyIGFscGhhIGlzIDEuMCBldmVyeXdoZXJlLiAgV2hlbiB0aGlzIHByb3BlcnR5IGlzIGZhbHNlLCBtZW1vcnkgdXNhZ2VcclxuICAgICAqIGFuZCB0ZXh0dXJlIHVwbG9hZCB0aW1lIGFyZSByZWR1Y2VkLlxyXG4gICAgICogQG1lbWJlcm9mIENhbnZhc0ltYWdlcnlQcm92aWRlci5wcm90b3R5cGVcclxuICAgICAqIEB0eXBlIHtCb29sZWFufVxyXG4gICAgICogQHJlYWRvbmx5XHJcbiAgICAgKi9cclxuICAgIGdldCBoYXNBbHBoYUNoYW5uZWwoKSB7XHJcbiAgICAgICAgICAgIHJldHVybiB0cnVlO1xyXG4gICAgfVxyXG59O1xyXG5cclxuQ2FudmFzSW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5zZXRSZWN0YW5nbGUgPSBmdW5jdGlvbiBzZXRSZWN0YW5nbGUocmVjdGFuZ2xlKSB7XHJcbiAgICBcclxuICAgIHRoaXMuX3RpbGluZ1NjaGVtZSA9IG5ldyBDZXNpdW0uR2VvZ3JhcGhpY1RpbGluZ1NjaGVtZSh7XHJcbiAgICAgICAgcmVjdGFuZ2xlOiByZWN0YW5nbGUsXHJcbiAgICAgICAgbnVtYmVyT2ZMZXZlbFplcm9UaWxlc1g6IDEsXHJcbiAgICAgICAgbnVtYmVyT2ZMZXZlbFplcm9UaWxlc1k6IDFcclxuICAgIH0pO1xyXG4gICAgXHJcbiAgICBpZiAoIXRoaXMuX3JlYWR5KSB7XHJcbiAgICAgICAgdGhpcy5fcmVhZHkgPSB0cnVlO1xyXG4gICAgICAgIENlc2l1bS5UaWxlUHJvdmlkZXJFcnJvci5oYW5kbGVTdWNjZXNzKHRoaXMuX2Vycm9yRXZlbnQpO1xyXG4gICAgfVxyXG59O1xyXG5cclxuQ2FudmFzSW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5nZXRUaWxlV2lkdGggPSBmdW5jdGlvbiBnZXRUaWxlV2lkdGgoKSB7XHJcbiAgICByZXR1cm4gdGhpcy50aWxlV2lkdGg7XHJcbn07XHJcblxyXG5DYW52YXNJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlLmdldFRpbGVIZWlnaHQgPSBmdW5jdGlvbiBnZXRUaWxlSGVpZ2h0KCkge1xyXG4gICAgcmV0dXJuIHRoaXMudGlsZUhlaWdodDtcclxufTtcclxuXHJcbkNhbnZhc0ltYWdlcnlQcm92aWRlci5wcm90b3R5cGUuZ2V0TWF4aW11bUxldmVsID0gZnVuY3Rpb24gZ2V0TWF4aW11bUxldmVsKCkge1xyXG4gICAgcmV0dXJuIHRoaXMubWF4aW11bUxldmVsO1xyXG59O1xyXG5cclxuQ2FudmFzSW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5nZXRNaW5pbXVtTGV2ZWwgPSBmdW5jdGlvbiBnZXRNaW5pbXVtTGV2ZWwoKSB7XHJcbiAgICByZXR1cm4gdGhpcy5taW5pbXVtTGV2ZWw7XHJcbn07XHJcblxyXG5DYW52YXNJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlLmlzUmVhZHkgPSBmdW5jdGlvbiBpc1JlYWR5KCkge1xyXG4gICAgcmV0dXJuIHRoaXMucmVhZHk7XHJcbn07XHJcblxyXG5DYW52YXNJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlLmdldENyZWRpdCA9IGZ1bmN0aW9uIGdldENyZWRpdCgpIHtcclxuICAgIHJldHVybiB0aGlzLmNyZWRpdDtcclxufTtcclxuXHJcbkNhbnZhc0ltYWdlcnlQcm92aWRlci5wcm90b3R5cGUuZ2V0UmVjdGFuZ2xlID0gZnVuY3Rpb24gZ2V0UmVjdGFuZ2xlKCkge1xyXG4gICAgcmV0dXJuIHRoaXMudGlsaW5nU2NoZW1lLnJlY3RhbmdsZTtcclxufTtcclxuXHJcbkNhbnZhc0ltYWdlcnlQcm92aWRlci5wcm90b3R5cGUuZ2V0VGlsaW5nU2NoZW1lID0gZnVuY3Rpb24gZ2V0VGlsaW5nU2NoZW1lKCkge1xyXG4gICAgcmV0dXJuIHRoaXMudGlsaW5nU2NoZW1lO1xyXG59O1xyXG5cclxuQ2FudmFzSW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5nZXRUaWxlRGlzY2FyZFBvbGljeSA9IGZ1bmN0aW9uIGdldFRpbGVEaXNjYXJkUG9saWN5KCkge1xyXG4gICAgcmV0dXJuIHRoaXMudGlsZURpc2NhcmRQb2xpY3k7XHJcbn07XHJcblxyXG5DYW52YXNJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlLmdldEVycm9yRXZlbnQgPSBmdW5jdGlvbiBnZXRFcnJvckV2ZW50KCkge1xyXG4gICAgcmV0dXJuIHRoaXMuZXJyb3JFdmVudDtcclxufTtcclxuXHJcbkNhbnZhc0ltYWdlcnlQcm92aWRlci5wcm90b3R5cGUuZ2V0SGFzQWxwaGFDaGFubmVsID0gZnVuY3Rpb24gZ2V0SGFzQWxwaGFDaGFubmVsKCkge1xyXG4gICAgcmV0dXJuIHRoaXMuaGFzQWxwaGFDaGFubmVsO1xyXG59O1xyXG5cclxuLyoqXHJcbiAqIEdldHMgdGhlIGNyZWRpdHMgdG8gYmUgZGlzcGxheWVkIHdoZW4gYSBnaXZlbiB0aWxlIGlzIGRpc3BsYXllZC5cclxuICpcclxuICogQHBhcmFtIHtOdW1iZXJ9IHggVGhlIHRpbGUgWCBjb29yZGluYXRlLlxyXG4gKiBAcGFyYW0ge051bWJlcn0geSBUaGUgdGlsZSBZIGNvb3JkaW5hdGUuXHJcbiAqIEBwYXJhbSB7TnVtYmVyfSBsZXZlbCBUaGUgdGlsZSBsZXZlbDtcclxuICogQHJldHVybnMge0NyZWRpdFtdfSBUaGUgY3JlZGl0cyB0byBiZSBkaXNwbGF5ZWQgd2hlbiB0aGUgdGlsZSBpcyBkaXNwbGF5ZWQuXHJcbiAqXHJcbiAqIEBleGNlcHRpb24ge0RldmVsb3BlckVycm9yfSA8Y29kZT5nZXRUaWxlQ3JlZGl0czwvY29kZT4gbXVzdCBub3QgYmUgY2FsbGVkIGJlZm9yZSB0aGUgaW1hZ2VyeSBwcm92aWRlciBpcyByZWFkeS5cclxuICovXHJcbkNhbnZhc0ltYWdlcnlQcm92aWRlci5wcm90b3R5cGUuZ2V0VGlsZUNyZWRpdHMgPSBmdW5jdGlvbih4LCB5LCBsZXZlbCkge1xyXG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcclxufTtcclxuXHJcbi8qKlxyXG4gKiBSZXF1ZXN0cyB0aGUgaW1hZ2UgZm9yIGEgZ2l2ZW4gdGlsZS4gIFRoaXMgZnVuY3Rpb24gc2hvdWxkXHJcbiAqIG5vdCBiZSBjYWxsZWQgYmVmb3JlIHtAbGluayBDYW52YXNJbWFnZXJ5UHJvdmlkZXIjcmVhZHl9IHJldHVybnMgdHJ1ZS5cclxuICpcclxuICogQHBhcmFtIHtOdW1iZXJ9IHggVGhlIHRpbGUgWCBjb29yZGluYXRlLlxyXG4gKiBAcGFyYW0ge051bWJlcn0geSBUaGUgdGlsZSBZIGNvb3JkaW5hdGUuXHJcbiAqIEBwYXJhbSB7TnVtYmVyfSBsZXZlbCBUaGUgdGlsZSBsZXZlbC5cclxuICogQHJldHVybnMge1Byb21pc2V9IEEgcHJvbWlzZSBmb3IgdGhlIGltYWdlIHRoYXQgd2lsbCByZXNvbHZlIHdoZW4gdGhlIGltYWdlIGlzIGF2YWlsYWJsZSwgb3JcclxuICogICAgICAgICAgdW5kZWZpbmVkIGlmIHRoZXJlIGFyZSB0b28gbWFueSBhY3RpdmUgcmVxdWVzdHMgdG8gdGhlIHNlcnZlciwgYW5kIHRoZSByZXF1ZXN0XHJcbiAqICAgICAgICAgIHNob3VsZCBiZSByZXRyaWVkIGxhdGVyLiAgVGhlIHJlc29sdmVkIGltYWdlIG1heSBiZSBlaXRoZXIgYW5cclxuICogICAgICAgICAgSW1hZ2Ugb3IgYSBDYW52YXMgRE9NIG9iamVjdC5cclxuICpcclxuICogQGV4Y2VwdGlvbiB7RGV2ZWxvcGVyRXJyb3J9IDxjb2RlPnJlcXVlc3RJbWFnZTwvY29kZT4gbXVzdCBub3QgYmUgY2FsbGVkIGJlZm9yZSB0aGUgaW1hZ2VyeSBwcm92aWRlciBpcyByZWFkeS5cclxuICovXHJcbkNhbnZhc0ltYWdlcnlQcm92aWRlci5wcm90b3R5cGUucmVxdWVzdEltYWdlID0gZnVuY3Rpb24oeCwgeSwgbGV2ZWwpIHtcclxuICAgIC8vPj5pbmNsdWRlU3RhcnQoJ2RlYnVnJywgcHJhZ21hcy5kZWJ1Zyk7XHJcbiAgICBpZiAoIXRoaXMuX3JlYWR5KSB7XHJcbiAgICAgICAgICAgIHRocm93IG5ldyBEZXZlbG9wZXJFcnJvcigncmVxdWVzdEltYWdlIG11c3Qgbm90IGJlIGNhbGxlZCBiZWZvcmUgdGhlIGltYWdlcnkgcHJvdmlkZXIgaXMgcmVhZHkuJyk7XHJcbiAgICB9XHJcbiAgICAvLz4+aW5jbHVkZUVuZCgnZGVidWcnKTtcclxuXHJcbiAgICByZXR1cm4gdGhpcy5fY2FudmFzO1xyXG59O1xyXG5cclxuLyoqXHJcbiAqIFBpY2tpbmcgZmVhdHVyZXMgaXMgbm90IGN1cnJlbnRseSBzdXBwb3J0ZWQgYnkgdGhpcyBpbWFnZXJ5IHByb3ZpZGVyLCBzbyB0aGlzIGZ1bmN0aW9uIHNpbXBseSByZXR1cm5zXHJcbiAqIHVuZGVmaW5lZC5cclxuICpcclxuICogQHBhcmFtIHtOdW1iZXJ9IHggVGhlIHRpbGUgWCBjb29yZGluYXRlLlxyXG4gKiBAcGFyYW0ge051bWJlcn0geSBUaGUgdGlsZSBZIGNvb3JkaW5hdGUuXHJcbiAqIEBwYXJhbSB7TnVtYmVyfSBsZXZlbCBUaGUgdGlsZSBsZXZlbC5cclxuICogQHBhcmFtIHtOdW1iZXJ9IGxvbmdpdHVkZSBUaGUgbG9uZ2l0dWRlIGF0IHdoaWNoIHRvIHBpY2sgZmVhdHVyZXMuXHJcbiAqIEBwYXJhbSB7TnVtYmVyfSBsYXRpdHVkZSAgVGhlIGxhdGl0dWRlIGF0IHdoaWNoIHRvIHBpY2sgZmVhdHVyZXMuXHJcbiAqIEByZXR1cm4ge1Byb21pc2V9IEEgcHJvbWlzZSBmb3IgdGhlIHBpY2tlZCBmZWF0dXJlcyB0aGF0IHdpbGwgcmVzb2x2ZSB3aGVuIHRoZSBhc3luY2hyb25vdXNcclxuICogICAgICAgICAgICAgICAgICAgcGlja2luZyBjb21wbGV0ZXMuICBUaGUgcmVzb2x2ZWQgdmFsdWUgaXMgYW4gYXJyYXkgb2Yge0BsaW5rIEltYWdlcnlMYXllckZlYXR1cmVJbmZvfVxyXG4gKiAgICAgICAgICAgICAgICAgICBpbnN0YW5jZXMuICBUaGUgYXJyYXkgbWF5IGJlIGVtcHR5IGlmIG5vIGZlYXR1cmVzIGFyZSBmb3VuZCBhdCB0aGUgZ2l2ZW4gbG9jYXRpb24uXHJcbiAqICAgICAgICAgICAgICAgICAgIEl0IG1heSBhbHNvIGJlIHVuZGVmaW5lZCBpZiBwaWNraW5nIGlzIG5vdCBzdXBwb3J0ZWQuXHJcbiAqL1xyXG5DYW52YXNJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlLnBpY2tGZWF0dXJlcyA9IGZ1bmN0aW9uKCkge1xyXG4gICAgICAgIHJldHVybiB1bmRlZmluZWQ7XHJcbn07IiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBjYWxjdWxhdGVGcnVzdHVtO1xyXG5cclxuLyogZ2xvYmFsIENlc2l1bTogZmFsc2UgKi9cclxuXHJcbnZhciBpbWFnZUhlbHBlckZ1bmN0aW9ucyA9IHJlcXVpcmUoJ2ltYWdlLWhlbHBlci1mdW5jdGlvbnMuanMnKTtcclxuXHJcbnZhciBNQVhfUkVDVVJTSVZFX0xFVkVMX09OX0ZBSUxFRF9UUkFOU0ZPUk0gPSA0O1xyXG5cclxuZnVuY3Rpb24gY2FsY3VsYXRlRnJ1c3R1bShjZXNpdW1XaWRnZXQpIHtcclxuICAgIHZhciBzY3JlZW5TaXplID0ge1xyXG4gICAgICAgIHg6IGNlc2l1bVdpZGdldC5zY2VuZS5jYW52YXMud2lkdGgsXHJcbiAgICAgICAgeTogY2VzaXVtV2lkZ2V0LnNjZW5lLmNhbnZhcy5oZWlnaHRcclxuICAgIH07XHJcbiAgICBcclxuICAgIHZhciBwb2ludHMgPSBbXTtcclxuICAgIHNlYXJjaEJvdW5kaW5nUG9pbnRzKFxyXG4gICAgICAgIDAsIDAsIHNjcmVlblNpemUueCwgc2NyZWVuU2l6ZS55LCBwb2ludHMsIGNlc2l1bVdpZGdldCwgLypyZWN1cnNpdmU9Ki8wKTtcclxuXHJcbiAgICB2YXIgZnJ1c3R1bVJlY3RhbmdsZSA9IENlc2l1bS5SZWN0YW5nbGUuZnJvbUNhcnRvZ3JhcGhpY0FycmF5KHBvaW50cyk7XHJcbiAgICBpZiAoZnJ1c3R1bVJlY3RhbmdsZS5lYXN0IDwgZnJ1c3R1bVJlY3RhbmdsZS53ZXN0IHx8IGZydXN0dW1SZWN0YW5nbGUubm9ydGggPCBmcnVzdHVtUmVjdGFuZ2xlLnNvdXRoKSB7XHJcbiAgICAgICAgZnJ1c3R1bVJlY3RhbmdsZSA9IHtcclxuICAgICAgICAgICAgZWFzdDogTWF0aC5tYXgoZnJ1c3R1bVJlY3RhbmdsZS5lYXN0LCBmcnVzdHVtUmVjdGFuZ2xlLndlc3QpLFxyXG4gICAgICAgICAgICB3ZXN0OiBNYXRoLm1pbihmcnVzdHVtUmVjdGFuZ2xlLmVhc3QsIGZydXN0dW1SZWN0YW5nbGUud2VzdCksXHJcbiAgICAgICAgICAgIG5vcnRoOiBNYXRoLm1heChmcnVzdHVtUmVjdGFuZ2xlLm5vcnRoLCBmcnVzdHVtUmVjdGFuZ2xlLnNvdXRoKSxcclxuICAgICAgICAgICAgc291dGg6IE1hdGgubWluKGZydXN0dW1SZWN0YW5nbGUubm9ydGgsIGZydXN0dW1SZWN0YW5nbGUuc291dGgpXHJcbiAgICAgICAgfTtcclxuICAgIH1cclxuXHJcbiAgICB2YXIgZnJ1c3R1bURhdGEgPSBpbWFnZUhlbHBlckZ1bmN0aW9ucy5jYWxjdWxhdGVGcnVzdHVtMkRGcm9tQm91bmRzKFxyXG4gICAgICAgIGZydXN0dW1SZWN0YW5nbGUsIHNjcmVlblNpemUpO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICByZXR1cm4gZnJ1c3R1bURhdGE7XHJcbn1cclxuICAgIFxyXG5mdW5jdGlvbiBzZWFyY2hCb3VuZGluZ1BvaW50cyhcclxuICAgIG1pblgsIG1pblksIG1heFgsIG1heFksIHBvaW50cywgY2VzaXVtV2lkZ2V0LCByZWN1cnNpdmVMZXZlbCkge1xyXG4gICAgXHJcbiAgICB2YXIgdHJhbnNmb3JtZWRQb2ludHMgPSAwO1xyXG4gICAgdHJhbnNmb3JtZWRQb2ludHMgKz0gdHJhbnNmb3JtQW5kQWRkUG9pbnQoXHJcbiAgICAgICAgbWluWCwgbWluWSwgY2VzaXVtV2lkZ2V0LCBwb2ludHMpO1xyXG4gICAgdHJhbnNmb3JtZWRQb2ludHMgKz0gdHJhbnNmb3JtQW5kQWRkUG9pbnQoXHJcbiAgICAgICAgbWF4WCwgbWluWSwgY2VzaXVtV2lkZ2V0LCBwb2ludHMpO1xyXG4gICAgdHJhbnNmb3JtZWRQb2ludHMgKz0gdHJhbnNmb3JtQW5kQWRkUG9pbnQoXHJcbiAgICAgICAgbWluWCwgbWF4WSwgY2VzaXVtV2lkZ2V0LCBwb2ludHMpO1xyXG4gICAgdHJhbnNmb3JtZWRQb2ludHMgKz0gdHJhbnNmb3JtQW5kQWRkUG9pbnQoXHJcbiAgICAgICAgbWF4WCwgbWF4WSwgY2VzaXVtV2lkZ2V0LCBwb2ludHMpO1xyXG5cclxuICAgIHZhciBtYXhMZXZlbCA9IE1BWF9SRUNVUlNJVkVfTEVWRUxfT05fRkFJTEVEX1RSQU5TRk9STTtcclxuICAgIFxyXG4gICAgaWYgKHRyYW5zZm9ybWVkUG9pbnRzID09PSA0IHx8IHJlY3Vyc2l2ZUxldmVsID49IG1heExldmVsKSB7XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICArK3JlY3Vyc2l2ZUxldmVsO1xyXG4gICAgXHJcbiAgICB2YXIgbWlkZGxlWCA9IChtaW5YICsgbWF4WCkgLyAyO1xyXG4gICAgdmFyIG1pZGRsZVkgPSAobWluWSArIG1heFkpIC8gMjtcclxuICAgIFxyXG4gICAgc2VhcmNoQm91bmRpbmdQb2ludHMoXHJcbiAgICAgICAgbWluWCwgbWluWSwgbWlkZGxlWCwgbWlkZGxlWSwgcG9pbnRzLCBjZXNpdW1XaWRnZXQsIHJlY3Vyc2l2ZUxldmVsKTtcclxuXHJcbiAgICBzZWFyY2hCb3VuZGluZ1BvaW50cyhcclxuICAgICAgICBtaW5YLCBtaWRkbGVZLCBtaWRkbGVYLCBtYXhZLCBwb2ludHMsIGNlc2l1bVdpZGdldCwgcmVjdXJzaXZlTGV2ZWwpO1xyXG5cclxuICAgIHNlYXJjaEJvdW5kaW5nUG9pbnRzKFxyXG4gICAgICAgIG1pZGRsZVgsIG1pblksIG1heFgsIG1pZGRsZVksIHBvaW50cywgY2VzaXVtV2lkZ2V0LCByZWN1cnNpdmVMZXZlbCk7XHJcblxyXG4gICAgc2VhcmNoQm91bmRpbmdQb2ludHMoXHJcbiAgICAgICAgbWlkZGxlWCwgbWlkZGxlWSwgbWF4WCwgbWF4WSwgcG9pbnRzLCBjZXNpdW1XaWRnZXQsIHJlY3Vyc2l2ZUxldmVsKTtcclxufVxyXG5cclxuZnVuY3Rpb24gdHJhbnNmb3JtQW5kQWRkUG9pbnQoeCwgeSwgY2VzaXVtV2lkZ2V0LCBwb2ludHMpIHtcclxuICAgIFxyXG4gICAgdmFyIHNjcmVlblBvaW50ID0gbmV3IENlc2l1bS5DYXJ0ZXNpYW4yKHgsIHkpO1xyXG4gICAgdmFyIGVsbGlwc29pZCA9IGNlc2l1bVdpZGdldC5zY2VuZS5tYXBQcm9qZWN0aW9uLmVsbGlwc29pZDtcclxuICAgIHZhciBwb2ludDNEID0gY2VzaXVtV2lkZ2V0LnNjZW5lLmNhbWVyYS5waWNrRWxsaXBzb2lkKHNjcmVlblBvaW50LCBlbGxpcHNvaWQpO1xyXG4gICAgXHJcbiAgICBpZiAocG9pbnQzRCA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgcmV0dXJuIDA7XHJcbiAgICB9XHJcblxyXG4gICAgdmFyIGNhcnRlc2lhbiA9IGVsbGlwc29pZC5jYXJ0ZXNpYW5Ub0NhcnRvZ3JhcGhpYyhwb2ludDNEKTtcclxuICAgIGlmIChjYXJ0ZXNpYW4gPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIHJldHVybiAwO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBwb2ludHMucHVzaChjYXJ0ZXNpYW4pO1xyXG4gICAgcmV0dXJuIDE7XHJcbn0iLCIndXNlIHN0cmljdCc7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IENlc2l1bUltYWdlRGVjb2RlckxheWVyTWFuYWdlcjtcclxuXHJcbnZhciBDYW52YXNJbWFnZXJ5UHJvdmlkZXIgPSByZXF1aXJlKCdjYW52YXMtaW1hZ2VyeS1wcm92aWRlci5qcycpO1xyXG52YXIgSW1hZ2VWaWV3ZXIgPSByZXF1aXJlKCdpbWFnZS1kZWNvZGVyLXZpZXdlci5qcycpO1xyXG52YXIgY2FsY3VsYXRlQ2VzaXVtRnJ1c3R1bSA9IHJlcXVpcmUoJ2Nlc2l1bS1mcnVzdHVtLWNhbGN1bGF0b3IuanMnKTtcclxuXHJcbi8qIGdsb2JhbCBDZXNpdW06IGZhbHNlICovXHJcblxyXG5mdW5jdGlvbiBDZXNpdW1JbWFnZURlY29kZXJMYXllck1hbmFnZXIoaW1hZ2VEZWNvZGVyLCBvcHRpb25zKSB7XHJcbiAgICB0aGlzLl9vcHRpb25zID0gb3B0aW9ucyB8fCB7fTtcclxuICAgIFxyXG4gICAgaWYgKHRoaXMuX29wdGlvbnMucmVjdGFuZ2xlICE9PSB1bmRlZmluZWQpIHtcclxuICAgICAgICB0aGlzLl9vcHRpb25zID0gSlNPTi5wYXJzZShKU09OLnN0cmluZ2lmeShvcHRpb25zKSk7XHJcbiAgICAgICAgdGhpcy5fb3B0aW9ucy5jYXJ0b2dyYXBoaWNCb3VuZHMgPSB7XHJcbiAgICAgICAgICAgIHdlc3Q6IG9wdGlvbnMucmVjdGFuZ2xlLndlc3QsXHJcbiAgICAgICAgICAgIGVhc3Q6IG9wdGlvbnMucmVjdGFuZ2xlLmVhc3QsXHJcbiAgICAgICAgICAgIHNvdXRoOiBvcHRpb25zLnJlY3RhbmdsZS5zb3V0aCxcclxuICAgICAgICAgICAgbm9ydGg6IG9wdGlvbnMucmVjdGFuZ2xlLm5vcnRoXHJcbiAgICAgICAgfTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgdGhpcy5fb3B0aW9ucy5taW5GdW5jdGlvbkNhbGxJbnRlcnZhbE1pbGxpc2Vjb25kcyA9XHJcbiAgICAgICAgb3B0aW9ucy5taW5GdW5jdGlvbkNhbGxJbnRlcnZhbE1pbGxpc2Vjb25kcyB8fCAxMDA7XHJcbiAgICB0aGlzLl9vcGVuQXJnID0gb3B0aW9ucy5vcGVuQXJnO1xyXG5cclxuICAgIHRoaXMuX3RhcmdldENhbnZhcyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2NhbnZhcycpO1xyXG4gICAgdGhpcy5faW1hZ2VyeVByb3ZpZGVycyA9IFtcclxuICAgICAgICBuZXcgQ2FudmFzSW1hZ2VyeVByb3ZpZGVyKHRoaXMuX3RhcmdldENhbnZhcyksXHJcbiAgICAgICAgbmV3IENhbnZhc0ltYWdlcnlQcm92aWRlcih0aGlzLl90YXJnZXRDYW52YXMpXHJcbiAgICBdO1xyXG4gICAgdGhpcy5faW1hZ2VyeUxheWVyU2hvd24gPSBuZXcgQ2VzaXVtLkltYWdlcnlMYXllcih0aGlzLl9pbWFnZXJ5UHJvdmlkZXJzWzBdKTtcclxuICAgIHRoaXMuX2ltYWdlcnlMYXllclBlbmRpbmcgPSBuZXcgQ2VzaXVtLkltYWdlcnlMYXllcih0aGlzLl9pbWFnZXJ5UHJvdmlkZXJzWzFdKTtcclxuXHJcbiAgICB0aGlzLl9jYW52YXNVcGRhdGVkQ2FsbGJhY2tCb3VuZCA9IHRoaXMuX2NhbnZhc1VwZGF0ZWRDYWxsYmFjay5iaW5kKHRoaXMpO1xyXG4gICAgXHJcbiAgICB0aGlzLl9pc1BlbmRpbmdVcGRhdGVDYWxsYmFjayA9IGZhbHNlO1xyXG4gICAgdGhpcy5faXNXaGlsZVJlcGxhY2VMYXllclNob3duID0gZmFsc2U7XHJcbiAgICB0aGlzLl9wZW5kaW5nUG9zaXRpb25SZWN0YW5nbGUgPSBudWxsO1xyXG4gICAgXHJcbiAgICB0aGlzLl9pbWFnZVZpZXdlciA9IG5ldyBJbWFnZVZpZXdlcihcclxuICAgICAgICBpbWFnZURlY29kZXIsXHJcbiAgICAgICAgdGhpcy5fY2FudmFzVXBkYXRlZENhbGxiYWNrQm91bmQsXHJcbiAgICAgICAgdGhpcy5fb3B0aW9ucyk7XHJcbiAgICBcclxuICAgIHRoaXMuX2ltYWdlVmlld2VyLnNldFRhcmdldENhbnZhcyh0aGlzLl90YXJnZXRDYW52YXMpO1xyXG4gICAgXHJcbiAgICB0aGlzLl91cGRhdGVGcnVzdHVtQm91bmQgPSB0aGlzLl91cGRhdGVGcnVzdHVtLmJpbmQodGhpcyk7XHJcbiAgICB0aGlzLl9wb3N0UmVuZGVyQm91bmQgPSB0aGlzLl9wb3N0UmVuZGVyLmJpbmQodGhpcyk7XHJcbn1cclxuXHJcbkNlc2l1bUltYWdlRGVjb2RlckxheWVyTWFuYWdlci5wcm90b3R5cGUuc2V0RXhjZXB0aW9uQ2FsbGJhY2sgPSBmdW5jdGlvbiBzZXRFeGNlcHRpb25DYWxsYmFjayhleGNlcHRpb25DYWxsYmFjaykge1xyXG4gICAgdGhpcy5faW1hZ2VWaWV3ZXIuc2V0RXhjZXB0aW9uQ2FsbGJhY2soZXhjZXB0aW9uQ2FsbGJhY2spO1xyXG59O1xyXG5cclxuQ2VzaXVtSW1hZ2VEZWNvZGVyTGF5ZXJNYW5hZ2VyLnByb3RvdHlwZS5vcGVuID0gZnVuY3Rpb24gb3Blbih3aWRnZXRPclZpZXdlcikge1xyXG4gICAgdGhpcy5fd2lkZ2V0ID0gd2lkZ2V0T3JWaWV3ZXI7XHJcbiAgICB0aGlzLl9sYXllcnMgPSB3aWRnZXRPclZpZXdlci5zY2VuZS5pbWFnZXJ5TGF5ZXJzO1xyXG4gICAgd2lkZ2V0T3JWaWV3ZXIuc2NlbmUucG9zdFJlbmRlci5hZGRFdmVudExpc3RlbmVyKHRoaXMuX3Bvc3RSZW5kZXJCb3VuZCk7XHJcbiAgICBcclxuICAgIHRoaXMuX2ltYWdlVmlld2VyLm9wZW4odGhpcy5fb3BlbkFyZyk7XHJcbiAgICB0aGlzLl9sYXllcnMuYWRkKHRoaXMuX2ltYWdlcnlMYXllclNob3duKTtcclxuICAgIFxyXG4gICAgLy8gTk9URTogSXMgdGhlcmUgYW4gZXZlbnQgaGFuZGxlciB0byByZWdpc3RlciBpbnN0ZWFkP1xyXG4gICAgLy8gKENlc2l1bSdzIGV2ZW50IGNvbnRyb2xsZXJzIG9ubHkgZXhwb3NlIGtleWJvYXJkIGFuZCBtb3VzZVxyXG4gICAgLy8gZXZlbnRzLCBidXQgdGhlcmUgaXMgbm8gZXZlbnQgZm9yIGZydXN0dW0gY2hhbmdlZFxyXG4gICAgLy8gcHJvZ3JhbW1hdGljYWxseSkuXHJcbiAgICB0aGlzLl9pbnRlcnZhbEhhbmRsZSA9IHNldEludGVydmFsKFxyXG4gICAgICAgIHRoaXMuX3VwZGF0ZUZydXN0dW1Cb3VuZCxcclxuICAgICAgICA1MDApO1xyXG59O1xyXG5cclxuQ2VzaXVtSW1hZ2VEZWNvZGVyTGF5ZXJNYW5hZ2VyLnByb3RvdHlwZS5jbG9zZSA9IGZ1bmN0aW9uIGNsb3NlKCkge1xyXG4gICAgdGhpcy5faW1hZ2VWaWV3ZXIuY2xvc2UoKTtcclxuICAgIGNsZWFySW50ZXJ2YWwodGhpcy5faW50ZXJ2YWxIYW5kbGUpO1xyXG5cclxuICAgIHRoaXMuX2xheWVycy5yZW1vdmUodGhpcy5faW1hZ2VyeUxheWVyU2hvd24pO1xyXG4gICAgdGhpcy5fd2lkZ2V0LnJlbW92ZUV2ZW50TGlzdGVuZXIodGhpcy5fcG9zdFJlbmRlckJvdW5kKTtcclxuICAgIGlmICh0aGlzLl9pc1doaWxlUmVwbGFjZUxheWVyU2hvd24pIHtcclxuICAgICAgICB0aGlzLl9pc1doaWxlUmVwbGFjZUxheWVyU2hvd24gPSBmYWxzZTtcclxuICAgICAgICB0aGlzLl9pc1BlbmRpbmdVcGRhdGVDYWxsYmFjayA9IGZhbHNlO1xyXG4gICAgICAgIHRoaXMuX2xheWVycy5yZW1vdmUodGhpcy5faW1hZ2VyeUxheWVyUGVuZGluZyk7XHJcbiAgICB9XHJcbn07XHJcblxyXG5DZXNpdW1JbWFnZURlY29kZXJMYXllck1hbmFnZXIucHJvdG90eXBlLmdldEltYWdlcnlMYXllcnMgPSBmdW5jdGlvbiBnZXRJbWFnZXJ5TGF5ZXJzKCkge1xyXG4gICAgcmV0dXJuIFt0aGlzLl9pbWFnZXJ5TGF5ZXJTaG93biwgdGhpcy5faW1hZ2VyeUxheWVyUGVuZGluZ107XHJcbn07XHJcblxyXG5DZXNpdW1JbWFnZURlY29kZXJMYXllck1hbmFnZXIucHJvdG90eXBlLl91cGRhdGVGcnVzdHVtID0gZnVuY3Rpb24gdXBkYXRlRnJ1c3R1bSgpIHtcclxuICAgIHZhciBmcnVzdHVtID0gY2FsY3VsYXRlQ2VzaXVtRnJ1c3R1bSh0aGlzLl93aWRnZXQpO1xyXG4gICAgaWYgKGZydXN0dW0gIT09IG51bGwpIHtcclxuICAgICAgICB0aGlzLl9pbWFnZVZpZXdlci51cGRhdGVWaWV3QXJlYShmcnVzdHVtKTtcclxuICAgIH1cclxufTtcclxuXHJcbkNlc2l1bUltYWdlRGVjb2RlckxheWVyTWFuYWdlci5wcm90b3R5cGUuX2NhbnZhc1VwZGF0ZWRDYWxsYmFjayA9IGZ1bmN0aW9uIGNhbnZhc1VwZGF0ZWRDYWxsYmFjayhuZXdQb3NpdGlvbikge1xyXG4gICAgaWYgKHRoaXMuX2lzV2hpbGVSZXBsYWNlTGF5ZXJTaG93bikge1xyXG4gICAgICAgIHRoaXMuX2lzUGVuZGluZ1VwZGF0ZUNhbGxiYWNrID0gdHJ1ZTtcclxuICAgICAgICB0aGlzLl9wZW5kaW5nUG9zaXRpb25SZWN0YW5nbGUgPSBuZXdQb3NpdGlvbjtcclxuICAgIH1cclxuICAgIFxyXG4gICAgaWYgKG5ld1Bvc2l0aW9uICE9PSBudWxsKSB7XHJcbiAgICAgICAgdmFyIHJlY3RhbmdsZSA9IG5ldyBDZXNpdW0uUmVjdGFuZ2xlKFxyXG4gICAgICAgICAgICBuZXdQb3NpdGlvbi53ZXN0LFxyXG4gICAgICAgICAgICBuZXdQb3NpdGlvbi5zb3V0aCxcclxuICAgICAgICAgICAgbmV3UG9zaXRpb24uZWFzdCxcclxuICAgICAgICAgICAgbmV3UG9zaXRpb24ubm9ydGgpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHRoaXMuX2ltYWdlcnlQcm92aWRlcnNbMF0uc2V0UmVjdGFuZ2xlKHJlY3RhbmdsZSk7XHJcbiAgICAgICAgdGhpcy5faW1hZ2VyeVByb3ZpZGVyc1sxXS5zZXRSZWN0YW5nbGUocmVjdGFuZ2xlKTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgdGhpcy5fcmVtb3ZlQW5kUmVBZGRMYXllcigpO1xyXG59O1xyXG5cclxuQ2VzaXVtSW1hZ2VEZWNvZGVyTGF5ZXJNYW5hZ2VyLnByb3RvdHlwZS5fcmVtb3ZlQW5kUmVBZGRMYXllciA9IGZ1bmN0aW9uIHJlbW92ZUFuZFJlQWRkTGF5ZXIoKSB7XHJcbiAgICB2YXIgaW5kZXggPSB0aGlzLl9sYXllcnMuaW5kZXhPZih0aGlzLl9pbWFnZXJ5TGF5ZXJTaG93bik7XHJcbiAgICBcclxuICAgIGlmIChpbmRleCA8IDApIHtcclxuICAgICAgICB0aHJvdyAnTGF5ZXIgd2FzIHJlbW92ZWQgZnJvbSB2aWV3ZXJcXCdzIGxheWVycyAgd2l0aG91dCAnICtcclxuICAgICAgICAgICAgJ2Nsb3NpbmcgbGF5ZXIgbWFuYWdlci4gVXNlIENlc2l1bUltYWdlRGVjb2RlckxheWVyTWFuYWdlci4nICtcclxuICAgICAgICAgICAgJ2Nsb3NlKCkgaW5zdGVhZCc7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHRoaXMuX2lzV2hpbGVSZXBsYWNlTGF5ZXJTaG93biA9IHRydWU7XHJcbiAgICB0aGlzLl9sYXllcnMuYWRkKHRoaXMuX2ltYWdlcnlMYXllclBlbmRpbmcsIGluZGV4KTtcclxufTtcclxuXHJcbkNlc2l1bUltYWdlRGVjb2RlckxheWVyTWFuYWdlci5wcm90b3R5cGUuX3Bvc3RSZW5kZXIgPSBmdW5jdGlvbiBwb3N0UmVuZGVyKCkge1xyXG4gICAgaWYgKCF0aGlzLl9pc1doaWxlUmVwbGFjZUxheWVyU2hvd24pXHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgXHJcbiAgICB0aGlzLl9pc1doaWxlUmVwbGFjZUxheWVyU2hvd24gPSBmYWxzZTtcclxuICAgIHRoaXMuX2xheWVycy5yZW1vdmUodGhpcy5faW1hZ2VyeUxheWVyU2hvd24sIC8qZGVzdHJveT0qL2ZhbHNlKTtcclxuICAgIFxyXG4gICAgdmFyIHN3YXAgPSB0aGlzLl9pbWFnZXJ5TGF5ZXJTaG93bjtcclxuICAgIHRoaXMuX2ltYWdlcnlMYXllclNob3duID0gdGhpcy5faW1hZ2VyeUxheWVyUGVuZGluZztcclxuICAgIHRoaXMuX2ltYWdlcnlMYXllclBlbmRpbmcgPSBzd2FwO1xyXG4gICAgXHJcbiAgICBpZiAodGhpcy5faXNQZW5kaW5nVXBkYXRlQ2FsbGJhY2spIHtcclxuICAgICAgICB0aGlzLl9pc1BlbmRpbmdVcGRhdGVDYWxsYmFjayA9IGZhbHNlO1xyXG4gICAgICAgIHRoaXMuX2NhbnZhc1VwZGF0ZWRDYWxsYmFjayh0aGlzLl9wZW5kaW5nUG9zaXRpb25SZWN0YW5nbGUpO1xyXG4gICAgfVxyXG59OyIsIid1c2Ugc3RyaWN0JztcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyO1xyXG5cclxudmFyIGNhbGN1bGF0ZUNlc2l1bUZydXN0dW0gPSByZXF1aXJlKCdjZXNpdW0tZnJ1c3R1bS1jYWxjdWxhdG9yLmpzJyk7XHJcbnZhciBpbWFnZUhlbHBlckZ1bmN0aW9ucyA9IHJlcXVpcmUoJ2ltYWdlLWhlbHBlci1mdW5jdGlvbnMuanMnKTtcclxuXHJcbi8qIGdsb2JhbCBDZXNpdW06IGZhbHNlICovXHJcbi8qIGdsb2JhbCBEZXZlbG9wZXJFcnJvcjogZmFsc2UgKi9cclxuLyogZ2xvYmFsIENyZWRpdDogZmFsc2UgKi9cclxuLyogZ2xvYmFsIFByb21pc2U6IGZhbHNlICovXHJcblxyXG4vKipcclxuICogUHJvdmlkZXMgYSBJbWFnZURlY29kZXIgY2xpZW50IGltYWdlcnkgdGlsZS4gIFRoZSBpbWFnZSBpcyBhc3N1bWVkIHRvIHVzZSBhXHJcbiAqIHtAbGluayBHZW9ncmFwaGljVGlsaW5nU2NoZW1lfS5cclxuICpcclxuICogQGFsaWFzIEltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlclxyXG4gKiBAY29uc3RydWN0b3JcclxuICpcclxuICogQHBhcmFtIHtPYmplY3R9IG9wdGlvbnMgT2JqZWN0IHdpdGggdGhlIGZvbGxvd2luZyBwcm9wZXJ0aWVzOlxyXG4gKiBAcGFyYW0ge1N0cmluZ30gb3B0aW9ucy51cmwgVGhlIHVybCBmb3IgdGhlIHRpbGUuXHJcbiAqIEBwYXJhbSB7UmVjdGFuZ2xlfSBbb3B0aW9ucy5yZWN0YW5nbGU9UmVjdGFuZ2xlLk1BWF9WQUxVRV0gVGhlIHJlY3RhbmdsZSwgaW4gcmFkaWFucywgY292ZXJlZCBieSB0aGUgaW1hZ2UuXHJcbiAqIEBwYXJhbSB7Q3JlZGl0fFN0cmluZ30gW29wdGlvbnMuY3JlZGl0XSBBIGNyZWRpdCBmb3IgdGhlIGRhdGEgc291cmNlLCB3aGljaCBpcyBkaXNwbGF5ZWQgb24gdGhlIGNhbnZhcy5cclxuICogQHBhcmFtIHtPYmplY3R9IFtvcHRpb25zLnByb3h5XSBBIHByb3h5IHRvIHVzZSBmb3IgcmVxdWVzdHMuIFRoaXMgb2JqZWN0IGlzIGV4cGVjdGVkIHRvIGhhdmUgYSBnZXRVUkwgZnVuY3Rpb24gd2hpY2ggcmV0dXJucyB0aGUgcHJveGllZCBVUkwsIGlmIG5lZWRlZC5cclxuICogQHBhcmFtIHtib29sZWFufSBbb3B0aW9ucy5hZGFwdFByb3BvcnRpb25zXSBkZXRlcm1pbmVzIGlmIHRvIGFkYXB0IHRoZSBwcm9wb3J0aW9ucyBvZiB0aGUgcmVjdGFuZ2xlIHByb3ZpZGVkIHRvIHRoZSBpbWFnZSBwaXhlbHMgcHJvcG9ydGlvbnMuXHJcbiAqXHJcbiAqIEBzZWUgQXJjR2lzTWFwU2VydmVySW1hZ2VyeVByb3ZpZGVyXHJcbiAqIEBzZWUgQmluZ01hcHNJbWFnZXJ5UHJvdmlkZXJcclxuICogQHNlZSBHb29nbGVFYXJ0aEltYWdlcnlQcm92aWRlclxyXG4gKiBAc2VlIE9wZW5TdHJlZXRNYXBJbWFnZXJ5UHJvdmlkZXJcclxuICogQHNlZSBUaWxlTWFwU2VydmljZUltYWdlcnlQcm92aWRlclxyXG4gKiBAc2VlIFdlYk1hcFNlcnZpY2VJbWFnZXJ5UHJvdmlkZXJcclxuICovXHJcbmZ1bmN0aW9uIEltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlcihpbWFnZURlY29kZXIsIG9wdGlvbnMpIHtcclxuICAgIHZhciB1cmwgPSBvcHRpb25zLnVybDtcclxuICAgIHRoaXMuX29wZW5BcmcgPSBvcHRpb25zLm9wZW5Bcmc7XHJcbiAgICB0aGlzLl9hZGFwdFByb3BvcnRpb25zID0gb3B0aW9ucy5hZGFwdFByb3BvcnRpb25zO1xyXG4gICAgdGhpcy5fcmVjdGFuZ2xlID0gb3B0aW9ucy5yZWN0YW5nbGU7XHJcbiAgICB0aGlzLl9wcm94eSA9IG9wdGlvbnMucHJveHk7XHJcbiAgICB0aGlzLl91cGRhdGVGcnVzdHVtSW50ZXJ2YWwgPSAxMDAwIHx8IG9wdGlvbnMudXBkYXRlRnJ1c3R1bUludGVydmFsO1xyXG4gICAgdGhpcy5fY3JlZGl0ID0gb3B0aW9ucy5jcmVkaXQ7XHJcbiAgICBcclxuICAgIGlmICh0eXBlb2YgdGhpcy5fY3JlZGl0ID09PSAnc3RyaW5nJykge1xyXG4gICAgICAgIHRoaXMuX2NyZWRpdCA9IG5ldyBDcmVkaXQodGhpcy5fY3JlZGl0KTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgaWYgKHRoaXMuX3JlY3RhbmdsZSA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgdGhpcy5fcmVjdGFuZ2xlID0gQ2VzaXVtLlJlY3RhbmdsZS5mcm9tRGVncmVlcygtMTgwLCAtOTAsIDE4MCwgOTApO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBpZiAodGhpcy5fYWRhcHRQcm9wb3J0aW9ucyA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgdGhpcy5fYWRhcHRQcm9wb3J0aW9ucyA9IHRydWU7XHJcbiAgICB9XHJcblxyXG4gICAgb3B0aW9ucyA9IEpTT04ucGFyc2UoSlNPTi5zdHJpbmdpZnkob3B0aW9ucyB8fCB7fSkpO1xyXG4gICAgb3B0aW9ucy5jYXJ0b2dyYXBoaWNCb3VuZHMgPSB7XHJcbiAgICAgICAgd2VzdDogdGhpcy5fcmVjdGFuZ2xlLndlc3QsXHJcbiAgICAgICAgZWFzdDogdGhpcy5fcmVjdGFuZ2xlLmVhc3QsXHJcbiAgICAgICAgc291dGg6IHRoaXMuX3JlY3RhbmdsZS5zb3V0aCxcclxuICAgICAgICBub3J0aDogdGhpcy5fcmVjdGFuZ2xlLm5vcnRoXHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICB0aGlzLl91cmwgPSB1cmw7XHJcblxyXG4gICAgdGhpcy5fdGlsaW5nU2NoZW1lID0gdW5kZWZpbmVkO1xyXG5cclxuICAgIHRoaXMuX3RpbGVXaWR0aCA9IDA7XHJcbiAgICB0aGlzLl90aWxlSGVpZ2h0ID0gMDtcclxuXHJcbiAgICB0aGlzLl9lcnJvckV2ZW50ID0gbmV3IEV2ZW50KCdJbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXJTdGF0dXMnKTtcclxuXHJcbiAgICB0aGlzLl9yZWFkeSA9IGZhbHNlO1xyXG4gICAgdGhpcy5fZXhjZXB0aW9uQ2FsbGJhY2sgPSBudWxsO1xyXG4gICAgdGhpcy5fY2VzaXVtV2lkZ2V0ID0gbnVsbDtcclxuICAgIHRoaXMuX3VwZGF0ZUZydXN0dW1JbnRlcnZhbEhhbmRsZSA9IG51bGw7XHJcbiAgICBcclxuICAgIHZhciBpbWFnZVVybCA9IHVybDtcclxuICAgIGlmICghdXJsKSB7XHJcbiAgICAgICAgdXJsID0gJ3Vua25vd24tdXJsJztcclxuICAgIH1cclxuICAgIGlmICh0aGlzLl9wcm94eSAhPT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgLy8gTk9URTogSXMgdGhhdCB0aGUgY29ycmVjdCBsb2dpYz9cclxuICAgICAgICBpbWFnZVVybCA9IHRoaXMuX3Byb3h5LmdldFVSTChpbWFnZVVybCk7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHRoaXMuX2ltYWdlRGVjb2RlciA9IGltYWdlRGVjb2RlcjtcclxuICAgIHRoaXMuX3VybCA9IGltYWdlVXJsO1xyXG59XHJcblxyXG5JbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlID0ge1xyXG4gICAgLyoqXHJcbiAgICAgKiBHZXRzIHRoZSBVUkwgb2YgdGhlIEltYWdlRGVjb2RlciBzZXJ2ZXIgKGluY2x1ZGluZyB0YXJnZXQpLlxyXG4gICAgICogQG1lbWJlcm9mIEltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlci5wcm90b3R5cGVcclxuICAgICAqIEB0eXBlIHtTdHJpbmd9XHJcbiAgICAgKiBAcmVhZG9ubHlcclxuICAgICAqL1xyXG4gICAgZ2V0IHVybCgpIHtcclxuICAgICAgICByZXR1cm4gdGhpcy5fdXJsO1xyXG4gICAgfSxcclxuXHJcbiAgICAvKipcclxuICAgICAqIEdldHMgdGhlIHByb3h5IHVzZWQgYnkgdGhpcyBwcm92aWRlci5cclxuICAgICAqIEBtZW1iZXJvZiBJbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlXHJcbiAgICAgKiBAdHlwZSB7UHJveHl9XHJcbiAgICAgKiBAcmVhZG9ubHlcclxuICAgICAqL1xyXG4gICAgZ2V0IHByb3h5KCkge1xyXG4gICAgICAgIHJldHVybiB0aGlzLl9wcm94eTtcclxuICAgIH0sXHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZXRzIHRoZSB3aWR0aCBvZiBlYWNoIHRpbGUsIGluIHBpeGVscy4gVGhpcyBmdW5jdGlvbiBzaG91bGRcclxuICAgICAqIG5vdCBiZSBjYWxsZWQgYmVmb3JlIHtAbGluayBJbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIjcmVhZHl9IHJldHVybnMgdHJ1ZS5cclxuICAgICAqIEBtZW1iZXJvZiBJbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlXHJcbiAgICAgKiBAdHlwZSB7TnVtYmVyfVxyXG4gICAgICogQHJlYWRvbmx5XHJcbiAgICAgKi9cclxuICAgIGdldCB0aWxlV2lkdGgoKSB7XHJcbiAgICAgICAgLy8+PmluY2x1ZGVTdGFydCgnZGVidWcnLCBwcmFnbWFzLmRlYnVnKTtcclxuICAgICAgICBpZiAoIXRoaXMuX3JlYWR5KSB7XHJcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRGV2ZWxvcGVyRXJyb3IoJ3RpbGVXaWR0aCBtdXN0IG5vdCBiZSBjYWxsZWQgYmVmb3JlIHRoZSBpbWFnZXJ5IHByb3ZpZGVyIGlzIHJlYWR5LicpO1xyXG4gICAgICAgIH1cclxuICAgICAgICAvLz4+aW5jbHVkZUVuZCgnZGVidWcnKTtcclxuXHJcbiAgICAgICAgcmV0dXJuIHRoaXMuX3RpbGVXaWR0aDtcclxuICAgIH0sXHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZXRzIHRoZSBoZWlnaHQgb2YgZWFjaCB0aWxlLCBpbiBwaXhlbHMuICBUaGlzIGZ1bmN0aW9uIHNob3VsZFxyXG4gICAgICogbm90IGJlIGNhbGxlZCBiZWZvcmUge0BsaW5rIEltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlciNyZWFkeX0gcmV0dXJucyB0cnVlLlxyXG4gICAgICogQG1lbWJlcm9mIEltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlci5wcm90b3R5cGVcclxuICAgICAqIEB0eXBlIHtOdW1iZXJ9XHJcbiAgICAgKiBAcmVhZG9ubHlcclxuICAgICAqL1xyXG4gICAgZ2V0IHRpbGVIZWlnaHQoKSB7XHJcbiAgICAgICAgLy8+PmluY2x1ZGVTdGFydCgnZGVidWcnLCBwcmFnbWFzLmRlYnVnKTtcclxuICAgICAgICBpZiAoIXRoaXMuX3JlYWR5KSB7XHJcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRGV2ZWxvcGVyRXJyb3IoJ3RpbGVIZWlnaHQgbXVzdCBub3QgYmUgY2FsbGVkIGJlZm9yZSB0aGUgaW1hZ2VyeSBwcm92aWRlciBpcyByZWFkeS4nKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgLy8+PmluY2x1ZGVFbmQoJ2RlYnVnJyk7XHJcblxyXG4gICAgICAgIHJldHVybiB0aGlzLl90aWxlSGVpZ2h0O1xyXG4gICAgfSxcclxuXHJcbiAgICAvKipcclxuICAgICAqIEdldHMgdGhlIG1heGltdW0gbGV2ZWwtb2YtZGV0YWlsIHRoYXQgY2FuIGJlIHJlcXVlc3RlZC4gIFRoaXMgZnVuY3Rpb24gc2hvdWxkXHJcbiAgICAgKiBub3QgYmUgY2FsbGVkIGJlZm9yZSB7QGxpbmsgSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyI3JlYWR5fSByZXR1cm5zIHRydWUuXHJcbiAgICAgKiBAbWVtYmVyb2YgSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZVxyXG4gICAgICogQHR5cGUge051bWJlcn1cclxuICAgICAqIEByZWFkb25seVxyXG4gICAgICovXHJcbiAgICBnZXQgbWF4aW11bUxldmVsKCkge1xyXG4gICAgICAgIC8vPj5pbmNsdWRlU3RhcnQoJ2RlYnVnJywgcHJhZ21hcy5kZWJ1Zyk7XHJcbiAgICAgICAgaWYgKCF0aGlzLl9yZWFkeSkge1xyXG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IERldmVsb3BlckVycm9yKCdtYXhpbXVtTGV2ZWwgbXVzdCBub3QgYmUgY2FsbGVkIGJlZm9yZSB0aGUgaW1hZ2VyeSBwcm92aWRlciBpcyByZWFkeS4nKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgLy8+PmluY2x1ZGVFbmQoJ2RlYnVnJyk7XHJcblxyXG4gICAgICAgIHJldHVybiB0aGlzLl9udW1SZXNvbHV0aW9uTGV2ZWxzIC0gMTtcclxuICAgIH0sXHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZXRzIHRoZSBtaW5pbXVtIGxldmVsLW9mLWRldGFpbCB0aGF0IGNhbiBiZSByZXF1ZXN0ZWQuICBUaGlzIGZ1bmN0aW9uIHNob3VsZFxyXG4gICAgICogbm90IGJlIGNhbGxlZCBiZWZvcmUge0BsaW5rIEltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlciNyZWFkeX0gcmV0dXJucyB0cnVlLlxyXG4gICAgICogQG1lbWJlcm9mIEltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlci5wcm90b3R5cGVcclxuICAgICAqIEB0eXBlIHtOdW1iZXJ9XHJcbiAgICAgKiBAcmVhZG9ubHlcclxuICAgICAqL1xyXG4gICAgZ2V0IG1pbmltdW1MZXZlbCgpIHtcclxuICAgICAgICAvLz4+aW5jbHVkZVN0YXJ0KCdkZWJ1ZycsIHByYWdtYXMuZGVidWcpO1xyXG4gICAgICAgIGlmICghdGhpcy5fcmVhZHkpIHtcclxuICAgICAgICAgICAgICAgIHRocm93IG5ldyBEZXZlbG9wZXJFcnJvcignbWluaW11bUxldmVsIG11c3Qgbm90IGJlIGNhbGxlZCBiZWZvcmUgdGhlIGltYWdlcnkgcHJvdmlkZXIgaXMgcmVhZHkuJyk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIC8vPj5pbmNsdWRlRW5kKCdkZWJ1ZycpO1xyXG5cclxuICAgICAgICByZXR1cm4gMDtcclxuICAgIH0sXHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZXRzIHRoZSB0aWxpbmcgc2NoZW1lIHVzZWQgYnkgdGhpcyBwcm92aWRlci4gIFRoaXMgZnVuY3Rpb24gc2hvdWxkXHJcbiAgICAgKiBub3QgYmUgY2FsbGVkIGJlZm9yZSB7QGxpbmsgSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyI3JlYWR5fSByZXR1cm5zIHRydWUuXHJcbiAgICAgKiBAbWVtYmVyb2YgSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZVxyXG4gICAgICogQHR5cGUge1RpbGluZ1NjaGVtZX1cclxuICAgICAqIEByZWFkb25seVxyXG4gICAgICovXHJcbiAgICBnZXQgdGlsaW5nU2NoZW1lKCkge1xyXG4gICAgICAgIC8vPj5pbmNsdWRlU3RhcnQoJ2RlYnVnJywgcHJhZ21hcy5kZWJ1Zyk7XHJcbiAgICAgICAgaWYgKCF0aGlzLl9yZWFkeSkge1xyXG4gICAgICAgICAgICB0aHJvdyBuZXcgRGV2ZWxvcGVyRXJyb3IoJ3RpbGluZ1NjaGVtZSBtdXN0IG5vdCBiZSBjYWxsZWQgYmVmb3JlIHRoZSBpbWFnZXJ5IHByb3ZpZGVyIGlzIHJlYWR5LicpO1xyXG4gICAgICAgIH1cclxuICAgICAgICAvLz4+aW5jbHVkZUVuZCgnZGVidWcnKTtcclxuXHJcbiAgICAgICAgcmV0dXJuIHRoaXMuX3RpbGluZ1NjaGVtZTtcclxuICAgIH0sXHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZXRzIHRoZSByZWN0YW5nbGUsIGluIHJhZGlhbnMsIG9mIHRoZSBpbWFnZXJ5IHByb3ZpZGVkIGJ5IHRoaXMgaW5zdGFuY2UuICBUaGlzIGZ1bmN0aW9uIHNob3VsZFxyXG4gICAgICogbm90IGJlIGNhbGxlZCBiZWZvcmUge0BsaW5rIEltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlciNyZWFkeX0gcmV0dXJucyB0cnVlLlxyXG4gICAgICogQG1lbWJlcm9mIEltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlci5wcm90b3R5cGVcclxuICAgICAqIEB0eXBlIHtSZWN0YW5nbGV9XHJcbiAgICAgKiBAcmVhZG9ubHlcclxuICAgICAqL1xyXG4gICAgZ2V0IHJlY3RhbmdsZSgpIHtcclxuICAgICAgICByZXR1cm4gdGhpcy5fdGlsaW5nU2NoZW1lLnJlY3RhbmdsZTtcclxuICAgIH0sXHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZXRzIHRoZSB0aWxlIGRpc2NhcmQgcG9saWN5LiAgSWYgbm90IHVuZGVmaW5lZCwgdGhlIGRpc2NhcmQgcG9saWN5IGlzIHJlc3BvbnNpYmxlXHJcbiAgICAgKiBmb3IgZmlsdGVyaW5nIG91dCBcIm1pc3NpbmdcIiB0aWxlcyB2aWEgaXRzIHNob3VsZERpc2NhcmRJbWFnZSBmdW5jdGlvbi4gIElmIHRoaXMgZnVuY3Rpb25cclxuICAgICAqIHJldHVybnMgdW5kZWZpbmVkLCBubyB0aWxlcyBhcmUgZmlsdGVyZWQuICBUaGlzIGZ1bmN0aW9uIHNob3VsZFxyXG4gICAgICogbm90IGJlIGNhbGxlZCBiZWZvcmUge0BsaW5rIEltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlciNyZWFkeX0gcmV0dXJucyB0cnVlLlxyXG4gICAgICogQG1lbWJlcm9mIEltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlci5wcm90b3R5cGVcclxuICAgICAqIEB0eXBlIHtUaWxlRGlzY2FyZFBvbGljeX1cclxuICAgICAqIEByZWFkb25seVxyXG4gICAgICovXHJcbiAgICBnZXQgdGlsZURpc2NhcmRQb2xpY3koKSB7XHJcbiAgICAgICAgLy8+PmluY2x1ZGVTdGFydCgnZGVidWcnLCBwcmFnbWFzLmRlYnVnKTtcclxuICAgICAgICBpZiAoIXRoaXMuX3JlYWR5KSB7XHJcbiAgICAgICAgICAgIHRocm93IG5ldyBEZXZlbG9wZXJFcnJvcigndGlsZURpc2NhcmRQb2xpY3kgbXVzdCBub3QgYmUgY2FsbGVkIGJlZm9yZSB0aGUgaW1hZ2VyeSBwcm92aWRlciBpcyByZWFkeS4nKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgLy8+PmluY2x1ZGVFbmQoJ2RlYnVnJyk7XHJcblxyXG4gICAgICAgIHJldHVybiB1bmRlZmluZWQ7XHJcbiAgICB9LFxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2V0cyBhbiBldmVudCB0aGF0IGlzIHJhaXNlZCB3aGVuIHRoZSBpbWFnZXJ5IHByb3ZpZGVyIGVuY291bnRlcnMgYW4gYXN5bmNocm9ub3VzIGVycm9yLiAgQnkgc3Vic2NyaWJpbmdcclxuICAgICAqIHRvIHRoZSBldmVudCwgeW91IHdpbGwgYmUgbm90aWZpZWQgb2YgdGhlIGVycm9yIGFuZCBjYW4gcG90ZW50aWFsbHkgcmVjb3ZlciBmcm9tIGl0LiAgRXZlbnQgbGlzdGVuZXJzXHJcbiAgICAgKiBhcmUgcGFzc2VkIGFuIGluc3RhbmNlIG9mIHtAbGluayBUaWxlUHJvdmlkZXJFcnJvcn0uXHJcbiAgICAgKiBAbWVtYmVyb2YgSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZVxyXG4gICAgICogQHR5cGUge0V2ZW50fVxyXG4gICAgICogQHJlYWRvbmx5XHJcbiAgICAgKi9cclxuICAgIGdldCBlcnJvckV2ZW50KCkge1xyXG4gICAgICAgIHJldHVybiB0aGlzLl9lcnJvckV2ZW50O1xyXG4gICAgfSxcclxuXHJcbiAgICAvKipcclxuICAgICAqIEdldHMgYSB2YWx1ZSBpbmRpY2F0aW5nIHdoZXRoZXIgb3Igbm90IHRoZSBwcm92aWRlciBpcyByZWFkeSBmb3IgdXNlLlxyXG4gICAgICogQG1lbWJlcm9mIEltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlci5wcm90b3R5cGVcclxuICAgICAqIEB0eXBlIHtCb29sZWFufVxyXG4gICAgICogQHJlYWRvbmx5XHJcbiAgICAgKi9cclxuICAgIGdldCByZWFkeSgpIHtcclxuICAgICAgICByZXR1cm4gdGhpcy5fcmVhZHk7XHJcbiAgICB9LFxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2V0cyB0aGUgY3JlZGl0IHRvIGRpc3BsYXkgd2hlbiB0aGlzIGltYWdlcnkgcHJvdmlkZXIgaXMgYWN0aXZlLiAgVHlwaWNhbGx5IHRoaXMgaXMgdXNlZCB0byBjcmVkaXRcclxuICAgICAqIHRoZSBzb3VyY2Ugb2YgdGhlIGltYWdlcnkuICBUaGlzIGZ1bmN0aW9uIHNob3VsZCBub3QgYmUgY2FsbGVkIGJlZm9yZSB7QGxpbmsgSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyI3JlYWR5fSByZXR1cm5zIHRydWUuXHJcbiAgICAgKiBAbWVtYmVyb2YgSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZVxyXG4gICAgICogQHR5cGUge0NyZWRpdH1cclxuICAgICAqIEByZWFkb25seVxyXG4gICAgICovXHJcbiAgICBnZXQgY3JlZGl0KCkge1xyXG4gICAgICAgIHJldHVybiB0aGlzLl9jcmVkaXQ7XHJcbiAgICB9LFxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2V0cyBhIHZhbHVlIGluZGljYXRpbmcgd2hldGhlciBvciBub3QgdGhlIGltYWdlcyBwcm92aWRlZCBieSB0aGlzIGltYWdlcnkgcHJvdmlkZXJcclxuICAgICAqIGluY2x1ZGUgYW4gYWxwaGEgY2hhbm5lbC4gIElmIHRoaXMgcHJvcGVydHkgaXMgZmFsc2UsIGFuIGFscGhhIGNoYW5uZWwsIGlmIHByZXNlbnQsIHdpbGxcclxuICAgICAqIGJlIGlnbm9yZWQuICBJZiB0aGlzIHByb3BlcnR5IGlzIHRydWUsIGFueSBpbWFnZXMgd2l0aG91dCBhbiBhbHBoYSBjaGFubmVsIHdpbGwgYmUgdHJlYXRlZFxyXG4gICAgICogYXMgaWYgdGhlaXIgYWxwaGEgaXMgMS4wIGV2ZXJ5d2hlcmUuICBXaGVuIHRoaXMgcHJvcGVydHkgaXMgZmFsc2UsIG1lbW9yeSB1c2FnZVxyXG4gICAgICogYW5kIHRleHR1cmUgdXBsb2FkIHRpbWUgYXJlIHJlZHVjZWQuXHJcbiAgICAgKiBAbWVtYmVyb2YgSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZVxyXG4gICAgICogQHR5cGUge0Jvb2xlYW59XHJcbiAgICAgKiBAcmVhZG9ubHlcclxuICAgICAqL1xyXG4gICAgZ2V0IGhhc0FscGhhQ2hhbm5lbCgpIHtcclxuICAgICAgICByZXR1cm4gdHJ1ZTtcclxuICAgIH1cclxufTtcclxuXHJcbkltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlci5wcm90b3R5cGUuc2V0RXhjZXB0aW9uQ2FsbGJhY2sgPVxyXG4gICAgZnVuY3Rpb24gc2V0RXhjZXB0aW9uQ2FsbGJhY2soZXhjZXB0aW9uQ2FsbGJhY2spIHtcclxuICAgIFxyXG4gICAgdGhpcy5fZXhjZXB0aW9uQ2FsbGJhY2sgPSBleGNlcHRpb25DYWxsYmFjaztcclxufTtcclxuXHJcbkltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlci5wcm90b3R5cGUub3BlbiA9IGZ1bmN0aW9uIG9wZW4od2lkZ2V0T3JWaWV3ZXIpIHtcclxuICAgIGlmICh0aGlzLl91cGRhdGVGcnVzdHVtSW50ZXJ2YWxIYW5kbGUgIT09IG51bGwpIHtcclxuICAgICAgICB0aHJvdyBuZXcgRGV2ZWxvcGVyRXJyb3IoJ0Nhbm5vdCBzZXQgdHdvIHBhcmVudCB2aWV3ZXJzLicpO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBpZiAod2lkZ2V0T3JWaWV3ZXIgPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIHRocm93IG5ldyBEZXZlbG9wZXJFcnJvcignd2lkZ2V0T3JWaWV3ZXIgc2hvdWxkIGJlIGdpdmVuLiBJdCBpcyAnICtcclxuICAgICAgICAgICAgJ25lZWRlZCBmb3IgZnJ1c3R1bSBjYWxjdWxhdGlvbiBmb3IgdGhlIHByaW9yaXR5IG1lY2hhbmlzbScpO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICB0aGlzLl9pbWFnZURlY29kZXIub3Blbih0aGlzLl9vcGVuQXJnKVxyXG4gICAgICAgIC50aGVuKHRoaXMuX29wZW5lZC5iaW5kKHRoaXMpKVxyXG4gICAgICAgIC5jYXRjaCh0aGlzLl9vbkV4Y2VwdGlvbi5iaW5kKHRoaXMpKTtcclxuICAgIFxyXG4gICAgdGhpcy5fY2VzaXVtV2lkZ2V0ID0gd2lkZ2V0T3JWaWV3ZXI7XHJcbiAgICBcclxuICAgIHRoaXMuX3VwZGF0ZUZydXN0dW1JbnRlcnZhbEhhbmRsZSA9IHNldEludGVydmFsKFxyXG4gICAgICAgIHRoaXMuX3NldFByaW9yaXR5QnlGcnVzdHVtLmJpbmQodGhpcyksXHJcbiAgICAgICAgdGhpcy5fdXBkYXRlRnJ1c3R1bUludGVydmFsKTtcclxufTtcclxuXHJcbkltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlci5wcm90b3R5cGUuY2xvc2UgPSBmdW5jdGlvbiBjbG9zZSgpIHtcclxuICAgIGNsZWFySW50ZXJ2YWwodGhpcy5fdXBkYXRlRnJ1c3R1bUludGVydmFsSGFuZGxlKTtcclxuICAgIHRoaXMuX2ltYWdlRGVjb2Rlci5jbG9zZSgpO1xyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5nZXRUaWxlV2lkdGggPSBmdW5jdGlvbiBnZXRUaWxlV2lkdGgoKSB7XHJcbiAgICByZXR1cm4gdGhpcy50aWxlV2lkdGg7XHJcbn07XHJcblxyXG5JbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlLmdldFRpbGVIZWlnaHQgPSBmdW5jdGlvbiBnZXRUaWxlSGVpZ2h0KCkge1xyXG4gICAgcmV0dXJuIHRoaXMudGlsZUhlaWdodDtcclxufTtcclxuXHJcbkltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlci5wcm90b3R5cGUuZ2V0TWF4aW11bUxldmVsID0gZnVuY3Rpb24gZ2V0TWF4aW11bUxldmVsKCkge1xyXG4gICAgcmV0dXJuIHRoaXMubWF4aW11bUxldmVsO1xyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5nZXRNaW5pbXVtTGV2ZWwgPSBmdW5jdGlvbiBnZXRNaW5pbXVtTGV2ZWwoKSB7XHJcbiAgICByZXR1cm4gdGhpcy5taW5pbXVtTGV2ZWw7XHJcbn07XHJcblxyXG5JbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlLmdldFVybCA9IGZ1bmN0aW9uIGdldFVybCgpIHtcclxuICAgIHJldHVybiB0aGlzLl91cmw7XHJcbn07XHJcblxyXG5JbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlLmdldFByb3h5ID0gZnVuY3Rpb24gZ2V0UHJveHkoKSB7XHJcbiAgICByZXR1cm4gdGhpcy5wcm94eTtcclxufTtcclxuXHJcbkltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlci5wcm90b3R5cGUuaXNSZWFkeSA9IGZ1bmN0aW9uIGlzUmVhZHkoKSB7XHJcbiAgICByZXR1cm4gdGhpcy5yZWFkeTtcclxufTtcclxuXHJcbkltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlci5wcm90b3R5cGUuZ2V0Q3JlZGl0ID0gZnVuY3Rpb24gZ2V0Q3JlZGl0KCkge1xyXG4gICAgcmV0dXJuIHRoaXMuY3JlZGl0O1xyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5nZXRSZWN0YW5nbGUgPSBmdW5jdGlvbiBnZXRSZWN0YW5nbGUoKSB7XHJcbiAgICByZXR1cm4gdGhpcy50aWxpbmdTY2hlbWUucmVjdGFuZ2xlO1xyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5nZXRUaWxpbmdTY2hlbWUgPSBmdW5jdGlvbiBnZXRUaWxpbmdTY2hlbWUoKSB7XHJcbiAgICByZXR1cm4gdGhpcy50aWxpbmdTY2hlbWU7XHJcbn07XHJcblxyXG5JbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlLmdldFRpbGVEaXNjYXJkUG9saWN5ID0gZnVuY3Rpb24gZ2V0VGlsZURpc2NhcmRQb2xpY3koKSB7XHJcbiAgICByZXR1cm4gdGhpcy50aWxlRGlzY2FyZFBvbGljeTtcclxufTtcclxuXHJcbkltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlci5wcm90b3R5cGUuZ2V0RXJyb3JFdmVudCA9IGZ1bmN0aW9uIGdldEVycm9yRXZlbnQoKSB7XHJcbiAgICByZXR1cm4gdGhpcy5lcnJvckV2ZW50O1xyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5nZXRIYXNBbHBoYUNoYW5uZWwgPSBmdW5jdGlvbiBnZXRIYXNBbHBoYUNoYW5uZWwoKSB7XHJcbiAgICByZXR1cm4gdGhpcy5oYXNBbHBoYUNoYW5uZWw7XHJcbn07XHJcblxyXG4vKipcclxuICogR2V0cyB0aGUgY3JlZGl0cyB0byBiZSBkaXNwbGF5ZWQgd2hlbiBhIGdpdmVuIHRpbGUgaXMgZGlzcGxheWVkLlxyXG4gKlxyXG4gKiBAcGFyYW0ge051bWJlcn0geCBUaGUgdGlsZSBYIGNvb3JkaW5hdGUuXHJcbiAqIEBwYXJhbSB7TnVtYmVyfSB5IFRoZSB0aWxlIFkgY29vcmRpbmF0ZS5cclxuICogQHBhcmFtIHtOdW1iZXJ9IGxldmVsIFRoZSB0aWxlIGxldmVsO1xyXG4gKiBAcmV0dXJucyB7Q3JlZGl0W119IFRoZSBjcmVkaXRzIHRvIGJlIGRpc3BsYXllZCB3aGVuIHRoZSB0aWxlIGlzIGRpc3BsYXllZC5cclxuICpcclxuICogQGV4Y2VwdGlvbiB7RGV2ZWxvcGVyRXJyb3J9IDxjb2RlPmdldFRpbGVDcmVkaXRzPC9jb2RlPiBtdXN0IG5vdCBiZSBjYWxsZWQgYmVmb3JlIHRoZSBpbWFnZXJ5IHByb3ZpZGVyIGlzIHJlYWR5LlxyXG4gKi9cclxuSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5nZXRUaWxlQ3JlZGl0cyA9IGZ1bmN0aW9uKHgsIHksIGxldmVsKSB7XHJcbiAgICByZXR1cm4gdW5kZWZpbmVkO1xyXG59O1xyXG5cclxuLyoqXHJcbiAqIFJlcXVlc3RzIHRoZSBpbWFnZSBmb3IgYSBnaXZlbiB0aWxlLiAgVGhpcyBmdW5jdGlvbiBzaG91bGRcclxuICogbm90IGJlIGNhbGxlZCBiZWZvcmUge0BsaW5rIEltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlciNyZWFkeX0gcmV0dXJucyB0cnVlLlxyXG4gKlxyXG4gKiBAcGFyYW0ge051bWJlcn0geCBUaGUgdGlsZSBYIGNvb3JkaW5hdGUuXHJcbiAqIEBwYXJhbSB7TnVtYmVyfSB5IFRoZSB0aWxlIFkgY29vcmRpbmF0ZS5cclxuICogQHBhcmFtIHtOdW1iZXJ9IGxldmVsIFRoZSB0aWxlIGxldmVsLlxyXG4gKiBAcmV0dXJucyB7UHJvbWlzZX0gQSBwcm9taXNlIGZvciB0aGUgaW1hZ2UgdGhhdCB3aWxsIHJlc29sdmUgd2hlbiB0aGUgaW1hZ2UgaXMgYXZhaWxhYmxlLCBvclxyXG4gKiAgICAgICAgICB1bmRlZmluZWQgaWYgdGhlcmUgYXJlIHRvbyBtYW55IGFjdGl2ZSByZXF1ZXN0cyB0byB0aGUgc2VydmVyLCBhbmQgdGhlIHJlcXVlc3RcclxuICogICAgICAgICAgc2hvdWxkIGJlIHJldHJpZWQgbGF0ZXIuICBUaGUgcmVzb2x2ZWQgaW1hZ2UgbWF5IGJlIGVpdGhlciBhblxyXG4gKiAgICAgICAgICBJbWFnZSBvciBhIENhbnZhcyBET00gb2JqZWN0LlxyXG4gKlxyXG4gKiBAZXhjZXB0aW9uIHtEZXZlbG9wZXJFcnJvcn0gPGNvZGU+cmVxdWVzdEltYWdlPC9jb2RlPiBtdXN0IG5vdCBiZSBjYWxsZWQgYmVmb3JlIHRoZSBpbWFnZXJ5IHByb3ZpZGVyIGlzIHJlYWR5LlxyXG4gKi9cclxuSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5yZXF1ZXN0SW1hZ2UgPSBmdW5jdGlvbih4LCB5LCBjZXNpdW1MZXZlbCkge1xyXG4gICAgLy8+PmluY2x1ZGVTdGFydCgnZGVidWcnLCBwcmFnbWFzLmRlYnVnKTtcclxuICAgIGlmICghdGhpcy5fcmVhZHkpIHtcclxuICAgICAgICB0aHJvdyBuZXcgRGV2ZWxvcGVyRXJyb3IoJ3JlcXVlc3RJbWFnZSBtdXN0IG5vdCBiZSBjYWxsZWQgYmVmb3JlIHRoZSBpbWFnZXJ5IHByb3ZpZGVyIGlzIHJlYWR5LicpO1xyXG4gICAgfVxyXG4gICAgLy8+PmluY2x1ZGVFbmQoJ2RlYnVnJyk7XHJcbiAgICBcclxuICAgIHZhciBzZWxmID0gdGhpcztcclxuICAgIFxyXG4gICAgdmFyIGxldmVsRmFjdG9yID0gTWF0aC5wb3coMiwgdGhpcy5fbnVtUmVzb2x1dGlvbkxldmVscyAtIGNlc2l1bUxldmVsIC0gMSk7XHJcbiAgICB2YXIgbWluWCA9IHggKiB0aGlzLl90aWxlV2lkdGggICogbGV2ZWxGYWN0b3I7XHJcbiAgICB2YXIgbWluWSA9IHkgKiB0aGlzLl90aWxlSGVpZ2h0ICogbGV2ZWxGYWN0b3I7XHJcbiAgICB2YXIgbWF4WEV4Y2x1c2l2ZSA9ICh4ICsgMSkgKiB0aGlzLl90aWxlV2lkdGggICogbGV2ZWxGYWN0b3I7XHJcbiAgICB2YXIgbWF4WUV4Y2x1c2l2ZSA9ICh5ICsgMSkgKiB0aGlzLl90aWxlSGVpZ2h0ICogbGV2ZWxGYWN0b3I7XHJcbiAgICBcclxuICAgIHZhciBhbGlnbmVkUGFyYW1zID0gaW1hZ2VIZWxwZXJGdW5jdGlvbnMuYWxpZ25QYXJhbXNUb1RpbGVzQW5kTGV2ZWwoe1xyXG4gICAgICAgIG1pblg6IG1pblgsXHJcbiAgICAgICAgbWluWTogbWluWSxcclxuICAgICAgICBtYXhYRXhjbHVzaXZlOiBtYXhYRXhjbHVzaXZlLFxyXG4gICAgICAgIG1heFlFeGNsdXNpdmU6IG1heFlFeGNsdXNpdmUsXHJcbiAgICAgICAgc2NyZWVuV2lkdGg6IHRoaXMuX3RpbGVXaWR0aCxcclxuICAgICAgICBzY3JlZW5IZWlnaHQ6IHRoaXMuX3RpbGVIZWlnaHRcclxuICAgIH0sIHRoaXMuX2ltYWdlRGVjb2Rlcik7XHJcbiAgICBcclxuICAgIHZhciBzY2FsZWRDYW52YXMgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdjYW52YXMnKTtcclxuICAgIHNjYWxlZENhbnZhcy53aWR0aCA9IHRoaXMuX3RpbGVXaWR0aDtcclxuICAgIHNjYWxlZENhbnZhcy5oZWlnaHQgPSB0aGlzLl90aWxlSGVpZ2h0O1xyXG4gICAgXHJcbiAgICB2YXIgc2NhbGVkQ29udGV4dCA9IHNjYWxlZENhbnZhcy5nZXRDb250ZXh0KCcyZCcpO1xyXG4gICAgc2NhbGVkQ29udGV4dC5jbGVhclJlY3QoMCwgMCwgdGhpcy5fdGlsZVdpZHRoLCB0aGlzLl90aWxlSGVpZ2h0KTtcclxuICAgIFxyXG4gICAgdmFyIHRlbXBQaXhlbFdpZHRoICA9IGFsaWduZWRQYXJhbXMuaW1hZ2VQYXJ0UGFyYW1zLm1heFhFeGNsdXNpdmUgLSBhbGlnbmVkUGFyYW1zLmltYWdlUGFydFBhcmFtcy5taW5YO1xyXG4gICAgdmFyIHRlbXBQaXhlbEhlaWdodCA9IGFsaWduZWRQYXJhbXMuaW1hZ2VQYXJ0UGFyYW1zLm1heFlFeGNsdXNpdmUgLSBhbGlnbmVkUGFyYW1zLmltYWdlUGFydFBhcmFtcy5taW5ZO1xyXG4gICAgaWYgKHRlbXBQaXhlbFdpZHRoIDw9IDAgfHwgdGVtcFBpeGVsSGVpZ2h0IDw9IDApIHtcclxuICAgICAgICByZXR1cm4gc2NhbGVkQ2FudmFzO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICB2YXIgdGVtcENhbnZhcyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2NhbnZhcycpO1xyXG4gICAgdGVtcENhbnZhcy53aWR0aCA9IHRlbXBQaXhlbFdpZHRoO1xyXG4gICAgdGVtcENhbnZhcy5oZWlnaHQgPSB0ZW1wUGl4ZWxIZWlnaHQ7XHJcbiAgICB2YXIgdGVtcENvbnRleHQgPSB0ZW1wQ2FudmFzLmdldENvbnRleHQoJzJkJyk7XHJcbiAgICB0ZW1wQ29udGV4dC5jbGVhclJlY3QoMCwgMCwgdGVtcFBpeGVsV2lkdGgsIHRlbXBQaXhlbEhlaWdodCk7XHJcbiAgICBcclxuICAgIGFsaWduZWRQYXJhbXMuaW1hZ2VQYXJ0UGFyYW1zLnF1YWxpdHkgPSB0aGlzLl9xdWFsaXR5O1xyXG4gICAgYWxpZ25lZFBhcmFtcy5pbWFnZVBhcnRQYXJhbXMucmVxdWVzdFByaW9yaXR5RGF0YSA9IHtcclxuICAgICAgICBpbWFnZVJlY3RhbmdsZTogdGhpcy5fcmVjdGFuZ2xlXHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICB2YXIgcmVzb2x2ZSwgcmVqZWN0O1xyXG4gICAgdmFyIHJlcXVlc3RQaXhlbHNQcm9taXNlID0gbmV3IFByb21pc2UoZnVuY3Rpb24ocmVzb2x2ZV8sIHJlamVjdF8pIHtcclxuICAgICAgICByZXNvbHZlID0gcmVzb2x2ZV87XHJcbiAgICAgICAgcmVqZWN0ID0gcmVqZWN0XztcclxuICAgICAgICBcclxuICAgICAgICBzZWxmLl9pbWFnZURlY29kZXIucmVxdWVzdFBpeGVsc1Byb2dyZXNzaXZlKFxyXG4gICAgICAgICAgICBhbGlnbmVkUGFyYW1zLmltYWdlUGFydFBhcmFtcyxcclxuICAgICAgICAgICAgcGl4ZWxzRGVjb2RlZENhbGxiYWNrLFxyXG4gICAgICAgICAgICB0ZXJtaW5hdGVkQ2FsbGJhY2spO1xyXG4gICAgfSk7XHJcbiAgICBcclxuICAgIGZ1bmN0aW9uIHBpeGVsc0RlY29kZWRDYWxsYmFjayhkZWNvZGVkKSB7XHJcbiAgICAgICAgdmFyIHBhcnRpYWxUaWxlV2lkdGggPSBkZWNvZGVkLmltYWdlRGF0YS53aWR0aDtcclxuICAgICAgICB2YXIgcGFydGlhbFRpbGVIZWlnaHQgPSBkZWNvZGVkLmltYWdlRGF0YS5oZWlnaHQ7XHJcblxyXG4gICAgICAgIGlmIChwYXJ0aWFsVGlsZVdpZHRoID4gMCAmJiBwYXJ0aWFsVGlsZUhlaWdodCA+IDApIHtcclxuICAgICAgICAgICAgdGVtcENvbnRleHQucHV0SW1hZ2VEYXRhKFxyXG4gICAgICAgICAgICAgICAgZGVjb2RlZC5pbWFnZURhdGEsXHJcbiAgICAgICAgICAgICAgICBkZWNvZGVkLnhJbk9yaWdpbmFsUmVxdWVzdCxcclxuICAgICAgICAgICAgICAgIGRlY29kZWQueUluT3JpZ2luYWxSZXF1ZXN0KTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgZnVuY3Rpb24gdGVybWluYXRlZENhbGxiYWNrKGlzQWJvcnRlZCkge1xyXG4gICAgICAgIGlmIChpc0Fib3J0ZWQpIHtcclxuICAgICAgICAgICAgcmVqZWN0KCdGZXRjaCByZXF1ZXN0IG9yIGRlY29kZSBhYm9ydGVkJyk7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgc2NhbGVkQ29udGV4dC5kcmF3SW1hZ2UoXHJcbiAgICAgICAgICAgICAgICB0ZW1wQ2FudmFzLFxyXG4gICAgICAgICAgICAgICAgMCwgMCwgdGVtcFBpeGVsV2lkdGgsIHRlbXBQaXhlbEhlaWdodCxcclxuICAgICAgICAgICAgICAgIGFsaWduZWRQYXJhbXMuY3JvcHBlZFNjcmVlbi5taW5YLCBhbGlnbmVkUGFyYW1zLmNyb3BwZWRTY3JlZW4ubWluWSxcclxuICAgICAgICAgICAgICAgIGFsaWduZWRQYXJhbXMuY3JvcHBlZFNjcmVlbi5tYXhYRXhjbHVzaXZlLCBhbGlnbmVkUGFyYW1zLmNyb3BwZWRTY3JlZW4ubWF4WUV4Y2x1c2l2ZSk7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgcmVzb2x2ZShzY2FsZWRDYW52YXMpO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4gcmVxdWVzdFBpeGVsc1Byb21pc2U7XHJcbn07XHJcblxyXG5JbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlLl9zZXRQcmlvcml0eUJ5RnJ1c3R1bSA9XHJcbiAgICBmdW5jdGlvbiBzZXRQcmlvcml0eUJ5RnJ1c3R1bSgpIHtcclxuICAgIFxyXG4gICAgaWYgKCF0aGlzLl9yZWFkeSkge1xyXG4gICAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIFxyXG4gICAgdmFyIGZydXN0dW1EYXRhID0gY2FsY3VsYXRlQ2VzaXVtRnJ1c3R1bShcclxuICAgICAgICB0aGlzLl9jZXNpdW1XaWRnZXQsIHRoaXMpO1xyXG4gICAgXHJcbiAgICBpZiAoZnJ1c3R1bURhdGEgPT09IG51bGwpIHtcclxuICAgICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGZydXN0dW1EYXRhLmltYWdlUmVjdGFuZ2xlID0gdGhpcy5nZXRSZWN0YW5nbGUoKTtcclxuICAgIGZydXN0dW1EYXRhLmV4YWN0bGV2ZWwgPSBudWxsO1xyXG5cclxuICAgIHRoaXMuX2ltYWdlRGVjb2Rlci5zZXRGZXRjaFByaW9yaXRpemVyRGF0YShmcnVzdHVtRGF0YSk7XHJcbiAgICB0aGlzLl9pbWFnZURlY29kZXIuc2V0RGVjb2RlUHJpb3JpdGl6ZXJEYXRhKGZydXN0dW1EYXRhKTtcclxufTtcclxuXHJcbi8qKlxyXG4gKiBQaWNraW5nIGZlYXR1cmVzIGlzIG5vdCBjdXJyZW50bHkgc3VwcG9ydGVkIGJ5IHRoaXMgaW1hZ2VyeSBwcm92aWRlciwgc28gdGhpcyBmdW5jdGlvbiBzaW1wbHkgcmV0dXJuc1xyXG4gKiB1bmRlZmluZWQuXHJcbiAqXHJcbiAqIEBwYXJhbSB7TnVtYmVyfSB4IFRoZSB0aWxlIFggY29vcmRpbmF0ZS5cclxuICogQHBhcmFtIHtOdW1iZXJ9IHkgVGhlIHRpbGUgWSBjb29yZGluYXRlLlxyXG4gKiBAcGFyYW0ge051bWJlcn0gbGV2ZWwgVGhlIHRpbGUgbGV2ZWwuXHJcbiAqIEBwYXJhbSB7TnVtYmVyfSBsb25naXR1ZGUgVGhlIGxvbmdpdHVkZSBhdCB3aGljaCB0byBwaWNrIGZlYXR1cmVzLlxyXG4gKiBAcGFyYW0ge051bWJlcn0gbGF0aXR1ZGUgIFRoZSBsYXRpdHVkZSBhdCB3aGljaCB0byBwaWNrIGZlYXR1cmVzLlxyXG4gKiBAcmV0dXJuIHtQcm9taXNlfSBBIHByb21pc2UgZm9yIHRoZSBwaWNrZWQgZmVhdHVyZXMgdGhhdCB3aWxsIHJlc29sdmUgd2hlbiB0aGUgYXN5bmNocm9ub3VzXHJcbiAqICAgICAgICAgICAgICAgICAgIHBpY2tpbmcgY29tcGxldGVzLiAgVGhlIHJlc29sdmVkIHZhbHVlIGlzIGFuIGFycmF5IG9mIHtAbGluayBJbWFnZXJ5TGF5ZXJGZWF0dXJlSW5mb31cclxuICogICAgICAgICAgICAgICAgICAgaW5zdGFuY2VzLiAgVGhlIGFycmF5IG1heSBiZSBlbXB0eSBpZiBubyBmZWF0dXJlcyBhcmUgZm91bmQgYXQgdGhlIGdpdmVuIGxvY2F0aW9uLlxyXG4gKiAgICAgICAgICAgICAgICAgICBJdCBtYXkgYWxzbyBiZSB1bmRlZmluZWQgaWYgcGlja2luZyBpcyBub3Qgc3VwcG9ydGVkLlxyXG4gKi9cclxuSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5waWNrRmVhdHVyZXMgPSBmdW5jdGlvbigpIHtcclxuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5fb25FeGNlcHRpb24gPSBmdW5jdGlvbiBvbkV4Y2VwdGlvbihyZWFzb24pIHtcclxuICAgIGlmICh0aGlzLl9leGNlcHRpb25DYWxsYmFjayAhPT0gbnVsbCkge1xyXG4gICAgICAgIHRoaXMuX2V4Y2VwdGlvbkNhbGxiYWNrKHJlYXNvbik7XHJcbiAgICB9XHJcbn07XHJcblxyXG5JbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlLl9vcGVuZWQgPSBmdW5jdGlvbiBvcGVuZWQoKSB7XHJcbiAgICBpZiAodGhpcy5fcmVhZHkpIHtcclxuICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyIGVycm9yOiBvcGVuZWQoKSB3YXMgY2FsbGVkIG1vcmUgdGhhbiBvbmNlISc7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHRoaXMuX3JlYWR5ID0gdHJ1ZTtcclxuXHJcbiAgICAvLyBUaGlzIGlzIHdyb25nIGlmIENPRCBvciBDT0MgZXhpc3RzIGJlc2lkZXMgbWFpbiBoZWFkZXIgQ09EXHJcbiAgICB0aGlzLl9udW1SZXNvbHV0aW9uTGV2ZWxzID0gdGhpcy5faW1hZ2VEZWNvZGVyLmdldE51bVJlc29sdXRpb25MZXZlbHNGb3JMaW1pdHRlZFZpZXdlcigpO1xyXG4gICAgdGhpcy5fcXVhbGl0eSA9IHRoaXMuX2ltYWdlRGVjb2Rlci5nZXRIaWdoZXN0UXVhbGl0eSgpO1xyXG4gICAgdmFyIG1heGltdW1DZXNpdW1MZXZlbCA9IHRoaXMuX251bVJlc29sdXRpb25MZXZlbHMgLSAxO1xyXG4gICAgICAgIFxyXG4gICAgdGhpcy5fdGlsZVdpZHRoID0gdGhpcy5faW1hZ2VEZWNvZGVyLmdldFRpbGVXaWR0aCgpO1xyXG4gICAgdGhpcy5fdGlsZUhlaWdodCA9IHRoaXMuX2ltYWdlRGVjb2Rlci5nZXRUaWxlSGVpZ2h0KCk7XHJcbiAgICAgICAgXHJcbiAgICB2YXIgYmVzdExldmVsV2lkdGggID0gdGhpcy5faW1hZ2VEZWNvZGVyLmdldEltYWdlV2lkdGggKCk7XHJcbiAgICB2YXIgYmVzdExldmVsSGVpZ2h0ID0gdGhpcy5faW1hZ2VEZWNvZGVyLmdldEltYWdlSGVpZ2h0KCk7XHJcbiAgICBcclxuICAgIHZhciBsb3dlc3RMZXZlbFRpbGVzWCA9IE1hdGguY2VpbChiZXN0TGV2ZWxXaWR0aCAgLyB0aGlzLl90aWxlV2lkdGggKSA+PiBtYXhpbXVtQ2VzaXVtTGV2ZWw7XHJcbiAgICB2YXIgbG93ZXN0TGV2ZWxUaWxlc1kgPSBNYXRoLmNlaWwoYmVzdExldmVsSGVpZ2h0IC8gdGhpcy5fdGlsZUhlaWdodCkgPj4gbWF4aW11bUNlc2l1bUxldmVsO1xyXG5cclxuICAgIGltYWdlSGVscGVyRnVuY3Rpb25zLmZpeEJvdW5kcyhcclxuICAgICAgICB0aGlzLl9yZWN0YW5nbGUsXHJcbiAgICAgICAgdGhpcy5faW1hZ2VEZWNvZGVyLFxyXG4gICAgICAgIHRoaXMuX2FkYXB0UHJvcG9ydGlvbnMpO1xyXG4gICAgdmFyIHJlY3RhbmdsZVdpZHRoICA9IHRoaXMuX3JlY3RhbmdsZS5lYXN0ICAtIHRoaXMuX3JlY3RhbmdsZS53ZXN0O1xyXG4gICAgdmFyIHJlY3RhbmdsZUhlaWdodCA9IHRoaXMuX3JlY3RhbmdsZS5ub3J0aCAtIHRoaXMuX3JlY3RhbmdsZS5zb3V0aDtcclxuICAgIFxyXG4gICAgdmFyIGJlc3RMZXZlbFNjYWxlID0gMSA8PCBtYXhpbXVtQ2VzaXVtTGV2ZWw7XHJcbiAgICB2YXIgcGl4ZWxzV2lkdGhGb3JDZXNpdW0gID0gdGhpcy5fdGlsZVdpZHRoICAqIGxvd2VzdExldmVsVGlsZXNYICogYmVzdExldmVsU2NhbGU7XHJcbiAgICB2YXIgcGl4ZWxzSGVpZ2h0Rm9yQ2VzaXVtID0gdGhpcy5fdGlsZUhlaWdodCAqIGxvd2VzdExldmVsVGlsZXNZICogYmVzdExldmVsU2NhbGU7XHJcbiAgICBcclxuICAgIC8vIENlc2l1bSB3b3JrcyB3aXRoIGZ1bGwgdGlsZXMgb25seSwgdGh1cyBmaXggdGhlIGdlb2dyYXBoaWMgYm91bmRzIHNvXHJcbiAgICAvLyB0aGUgcGl4ZWxzIGxpZXMgZXhhY3RseSBvbiB0aGUgb3JpZ2luYWwgYm91bmRzXHJcbiAgICBcclxuICAgIHZhciBnZW9ncmFwaGljV2lkdGhGb3JDZXNpdW0gPVxyXG4gICAgICAgIHJlY3RhbmdsZVdpZHRoICogcGl4ZWxzV2lkdGhGb3JDZXNpdW0gLyBiZXN0TGV2ZWxXaWR0aDtcclxuICAgIHZhciBnZW9ncmFwaGljSGVpZ2h0Rm9yQ2VzaXVtID1cclxuICAgICAgICByZWN0YW5nbGVIZWlnaHQgKiBwaXhlbHNIZWlnaHRGb3JDZXNpdW0gLyBiZXN0TGV2ZWxIZWlnaHQ7XHJcbiAgICBcclxuICAgIHZhciBmaXhlZEVhc3QgID0gdGhpcy5fcmVjdGFuZ2xlLndlc3QgICsgZ2VvZ3JhcGhpY1dpZHRoRm9yQ2VzaXVtO1xyXG4gICAgdmFyIGZpeGVkU291dGggPSB0aGlzLl9yZWN0YW5nbGUubm9ydGggLSBnZW9ncmFwaGljSGVpZ2h0Rm9yQ2VzaXVtO1xyXG4gICAgXHJcbiAgICB0aGlzLl90aWxpbmdTY2hlbWVQYXJhbXMgPSB7XHJcbiAgICAgICAgd2VzdDogdGhpcy5fcmVjdGFuZ2xlLndlc3QsXHJcbiAgICAgICAgZWFzdDogZml4ZWRFYXN0LFxyXG4gICAgICAgIHNvdXRoOiBmaXhlZFNvdXRoLFxyXG4gICAgICAgIG5vcnRoOiB0aGlzLl9yZWN0YW5nbGUubm9ydGgsXHJcbiAgICAgICAgbGV2ZWxaZXJvVGlsZXNYOiBsb3dlc3RMZXZlbFRpbGVzWCxcclxuICAgICAgICBsZXZlbFplcm9UaWxlc1k6IGxvd2VzdExldmVsVGlsZXNZLFxyXG4gICAgICAgIG1heGltdW1MZXZlbDogbWF4aW11bUNlc2l1bUxldmVsXHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICB0aGlzLl90aWxpbmdTY2hlbWUgPSBjcmVhdGVUaWxpbmdTY2hlbWUodGhpcy5fdGlsaW5nU2NoZW1lUGFyYW1zKTtcclxuICAgICAgICBcclxuICAgIENlc2l1bS5UaWxlUHJvdmlkZXJFcnJvci5oYW5kbGVTdWNjZXNzKHRoaXMuX2Vycm9yRXZlbnQpO1xyXG59O1xyXG5cclxuZnVuY3Rpb24gY3JlYXRlVGlsaW5nU2NoZW1lKHBhcmFtcykge1xyXG4gICAgdmFyIGdlb2dyYXBoaWNSZWN0YW5nbGVGb3JDZXNpdW0gPSBuZXcgQ2VzaXVtLlJlY3RhbmdsZShcclxuICAgICAgICBwYXJhbXMud2VzdCwgcGFyYW1zLnNvdXRoLCBwYXJhbXMuZWFzdCwgcGFyYW1zLm5vcnRoKTtcclxuICAgIFxyXG4gICAgdmFyIHRpbGluZ1NjaGVtZSA9IG5ldyBDZXNpdW0uR2VvZ3JhcGhpY1RpbGluZ1NjaGVtZSh7XHJcbiAgICAgICAgcmVjdGFuZ2xlOiBnZW9ncmFwaGljUmVjdGFuZ2xlRm9yQ2VzaXVtLFxyXG4gICAgICAgIG51bWJlck9mTGV2ZWxaZXJvVGlsZXNYOiBwYXJhbXMubGV2ZWxaZXJvVGlsZXNYLFxyXG4gICAgICAgIG51bWJlck9mTGV2ZWxaZXJvVGlsZXNZOiBwYXJhbXMubGV2ZWxaZXJvVGlsZXNZXHJcbiAgICB9KTtcclxuICAgIFxyXG4gICAgcmV0dXJuIHRpbGluZ1NjaGVtZTtcclxufSIsIid1c2Ugc3RyaWN0JztcclxuXHJcbnZhciBJbWFnZURlY29kZXIgPSByZXF1aXJlKCdpbWFnZS1kZWNvZGVyLmpzJyk7XHJcbnZhciBXb3JrZXJQcm94eUltYWdlRGVjb2RlciA9IHJlcXVpcmUoJ3dvcmtlci1wcm94eS1pbWFnZS1kZWNvZGVyLmpzJyk7XHJcbnZhciBpbWFnZUhlbHBlckZ1bmN0aW9ucyA9IHJlcXVpcmUoJ2ltYWdlLWhlbHBlci1mdW5jdGlvbnMuanMnKTtcclxuXHJcbm1vZHVsZS5leHBvcnRzLkltYWdlRGVjb2RlciA9IEltYWdlRGVjb2RlcjtcclxubW9kdWxlLmV4cG9ydHMuV29ya2VyUHJveHlJbWFnZURlY29kZXIgPSBXb3JrZXJQcm94eUltYWdlRGVjb2RlclxyXG5tb2R1bGUuZXhwb3J0cy5JbWFnZURlY29kZXJWaWV3ZXIgPSByZXF1aXJlKCdpbWFnZS1kZWNvZGVyLXZpZXdlci5qcycpO1xyXG5cclxubW9kdWxlLmV4cG9ydHMuU2ltcGxlRmV0Y2hlckJhc2UgPSByZXF1aXJlKCdzaW1wbGUtZmV0Y2hlci1iYXNlLmpzJyk7XHJcbm1vZHVsZS5leHBvcnRzLkdyaWRJbWFnZUJhc2UgPSByZXF1aXJlKCdncmlkLWltYWdlLWJhc2UuanMnKTtcclxubW9kdWxlLmV4cG9ydHMuR3JpZEZldGNoZXJCYXNlID0gcmVxdWlyZSgnZ3JpZC1mZXRjaGVyLWJhc2UuanMnKTtcclxubW9kdWxlLmV4cG9ydHMuR3JpZERlY29kZXJXb3JrZXJCYXNlID0gcmVxdWlyZSgnZ3JpZC1kZWNvZGVyLXdvcmtlci1iYXNlLmpzJyk7XHJcbm1vZHVsZS5leHBvcnRzLkdyaWRMZXZlbENhbGN1bGF0b3IgPSByZXF1aXJlKCdncmlkLWxldmVsLWNhbGN1bGF0b3IuanMnKTtcclxuXHJcbm1vZHVsZS5leHBvcnRzLkNlc2l1bUltYWdlRGVjb2RlckxheWVyTWFuYWdlciA9IHJlcXVpcmUoJ2Nlc2l1bS1pbWFnZS1kZWNvZGVyLWxheWVyLW1hbmFnZXIuanMnKTtcclxubW9kdWxlLmV4cG9ydHMuSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyID0gcmVxdWlyZSgnaW1hZ2UtZGVjb2Rlci1pbWFnZXJ5LXByb3ZpZGVyLmpzJyk7XHJcbm1vZHVsZS5leHBvcnRzLkltYWdlRGVjb2RlclJlZ2lvbkxheWVyID0gcmVxdWlyZSgnaW1hZ2UtZGVjb2Rlci1yZWdpb24tbGF5ZXIuanMnKTsiLCIndXNlIHN0cmljdCc7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IERlY29kZUpvYjtcclxuXHJcbnZhciBMaW5rZWRMaXN0ID0gcmVxdWlyZSgnbGlua2VkLWxpc3QuanMnKTtcclxuXHJcbnZhciByZXF1ZXN0SWRDb3VudGVyID0gMDtcclxuXHJcbkRlY29kZUpvYi5XaXRoUHJpb3JpdHkgPSBEZWNvZGVKb2JXaXRoUHJpb3JpdHk7XHJcblxyXG5mdW5jdGlvbiBEZWNvZGVKb2IobGlzdGVuZXJIYW5kbGUsIGltYWdlUGFydFBhcmFtcywgcHJpb3JpdGl6ZXIpIHtcclxuICAgIHRoaXMuX3Byb2dyZXNzaXZlU3RhZ2VzRG9uZSA9IDA7XHJcbiAgICB0aGlzLl9saXN0ZW5lckhhbmRsZSA9IGxpc3RlbmVySGFuZGxlO1xyXG4gICAgdGhpcy5faW1hZ2VQYXJ0UGFyYW1zID0gaW1hZ2VQYXJ0UGFyYW1zO1xyXG4gICAgdGhpcy5fYWxsUmVsZXZhbnRCeXRlc0xvYWRlZCA9IDA7XHJcbiAgICB2YXIgcmVxdWVzdFBhcmFtcyA9IGxpc3RlbmVySGFuZGxlLmltYWdlUGFydFBhcmFtcztcclxuICAgIHRoaXMuX29mZnNldFggPSBpbWFnZVBhcnRQYXJhbXMubWluWCAtIHJlcXVlc3RQYXJhbXMubWluWDtcclxuICAgIHRoaXMuX29mZnNldFkgPSBpbWFnZVBhcnRQYXJhbXMubWluWSAtIHJlcXVlc3RQYXJhbXMubWluWTtcclxuICAgIHRoaXMuX3JlcXVlc3RXaWR0aCA9IHJlcXVlc3RQYXJhbXMubWF4WEV4Y2x1c2l2ZSAtIHJlcXVlc3RQYXJhbXMubWluWDtcclxuICAgIHRoaXMuX3JlcXVlc3RIZWlnaHQgPSByZXF1ZXN0UGFyYW1zLm1heFlFeGNsdXNpdmUgLSByZXF1ZXN0UGFyYW1zLm1pblk7XHJcbn1cclxuXHJcbkRlY29kZUpvYi5wcm90b3R5cGUub25EYXRhID0gZnVuY3Rpb24gb25EYXRhKGRlY29kZVJlc3VsdCkge1xyXG4gICAgKyt0aGlzLl9wcm9ncmVzc2l2ZVN0YWdlc0RvbmU7XHJcblxyXG4gICAgdmFyIHJlbGV2YW50Qnl0ZXNMb2FkZWREaWZmID1cclxuICAgICAgICBkZWNvZGVSZXN1bHQuYWxsUmVsZXZhbnRCeXRlc0xvYWRlZCAtIHRoaXMuX2FsbFJlbGV2YW50Qnl0ZXNMb2FkZWQ7XHJcbiAgICB0aGlzLl9hbGxSZWxldmFudEJ5dGVzTG9hZGVkID0gZGVjb2RlUmVzdWx0LmFsbFJlbGV2YW50Qnl0ZXNMb2FkZWQ7XHJcbiAgICB0aGlzLl9saXN0ZW5lckhhbmRsZS5hbGxSZWxldmFudEJ5dGVzTG9hZGVkICs9IHJlbGV2YW50Qnl0ZXNMb2FkZWREaWZmO1xyXG4gICAgXHJcbiAgICB2YXIgZGVjb2RlZE9mZnNldHRlZCA9IHtcclxuICAgICAgICBvcmlnaW5hbFJlcXVlc3RXaWR0aDogdGhpcy5fcmVxdWVzdFdpZHRoLFxyXG4gICAgICAgIG9yaWdpbmFsUmVxdWVzdEhlaWdodDogdGhpcy5fcmVxdWVzdEhlaWdodCxcclxuICAgICAgICB4SW5PcmlnaW5hbFJlcXVlc3Q6IHRoaXMuX29mZnNldFgsXHJcbiAgICAgICAgeUluT3JpZ2luYWxSZXF1ZXN0OiB0aGlzLl9vZmZzZXRZLFxyXG4gICAgICAgIFxyXG4gICAgICAgIGltYWdlRGF0YTogZGVjb2RlUmVzdWx0LFxyXG4gICAgICAgIFxyXG4gICAgICAgIGFsbFJlbGV2YW50Qnl0ZXNMb2FkZWQ6IHRoaXMuX2xpc3RlbmVySGFuZGxlLmFsbFJlbGV2YW50Qnl0ZXNMb2FkZWRcclxuICAgIH07XHJcbiAgICBcclxuICAgIHRoaXMuX2xpc3RlbmVySGFuZGxlLmNhbGxiYWNrKGRlY29kZWRPZmZzZXR0ZWQpO1xyXG59O1xyXG5cclxuRGVjb2RlSm9iLnByb3RvdHlwZS5vblRlcm1pbmF0ZWQgPSBmdW5jdGlvbiBvblRlcm1pbmF0ZWQoKSB7XHJcbiAgICAvL3RoaXMuX2xpc3RlbmVySGFuZGxlLmlzQW55RGVjb2RlckFib3J0ZWQgfD0gdGhpcy5faXNBYm9ydGVkO1xyXG4gICAgXHJcbiAgICB2YXIgcmVtYWluaW5nID0gLS10aGlzLl9saXN0ZW5lckhhbmRsZS5yZW1haW5pbmdEZWNvZGVKb2JzO1xyXG4gICAgaWYgKHJlbWFpbmluZyA8IDApIHtcclxuICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBJbmNvbnNpc3RlbnQgbnVtYmVyIG9mIGRvbmUgcmVxdWVzdHMnO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICB2YXIgaXNMaXN0ZW5lckRvbmUgPSByZW1haW5pbmcgPT09IDA7XHJcbiAgICBpZiAoaXNMaXN0ZW5lckRvbmUpIHtcclxuICAgICAgICB0aGlzLl9saXN0ZW5lckhhbmRsZS5pc1Rlcm1pbmF0ZWRDYWxsYmFja0NhbGxlZCA9IHRydWU7XHJcbiAgICAgICAgdGhpcy5fbGlzdGVuZXJIYW5kbGUudGVybWluYXRlZENhbGxiYWNrKFxyXG4gICAgICAgICAgICB0aGlzLl9saXN0ZW5lckhhbmRsZS5pc0FueURlY29kZXJBYm9ydGVkKTtcclxuICAgIH1cclxufTtcclxuXHJcbk9iamVjdC5kZWZpbmVQcm9wZXJ0eShEZWNvZGVKb2IucHJvdG90eXBlLCAnaW1hZ2VQYXJ0UGFyYW1zJywge1xyXG4gICAgZ2V0OiBmdW5jdGlvbiBnZXRJbWFnZVBhcnRQYXJhbXMoKSB7XHJcbiAgICAgICAgcmV0dXJuIHRoaXMuX2ltYWdlUGFydFBhcmFtcztcclxuICAgIH1cclxufSk7XHJcblxyXG5PYmplY3QuZGVmaW5lUHJvcGVydHkoRGVjb2RlSm9iLnByb3RvdHlwZSwgJ3Byb2dyZXNzaXZlU3RhZ2VzRG9uZScsIHtcclxuICAgIGdldDogZnVuY3Rpb24gZ2V0UHJvZ3Jlc3NpdmVTdGFnZXNEb25lKCkge1xyXG4gICAgICAgIHJldHVybiB0aGlzLl9wcm9ncmVzc2l2ZVN0YWdlc0RvbmU7XHJcbiAgICB9XHJcbn0pO1xyXG5cclxuZnVuY3Rpb24gRGVjb2RlSm9iV2l0aFByaW9yaXR5KGxpc3RlbmVySGFuZGxlLCBpbWFnZVBhcnRQYXJhbXMsIHByaW9yaXRpemVyKSB7XHJcbiAgICBEZWNvZGVKb2IuY2FsbCh0aGlzLCBsaXN0ZW5lckhhbmRsZSwgaW1hZ2VQYXJ0UGFyYW1zKTtcclxuICAgIHRoaXMuX3ByaW9yaXRpemVyID0gcHJpb3JpdGl6ZXI7XHJcbn1cclxuXHJcbkRlY29kZUpvYldpdGhQcmlvcml0eS5wcm90b3R5cGUgPSBPYmplY3QuY3JlYXRlKERlY29kZUpvYi5wcm90b3R5cGUpO1xyXG5cclxuRGVjb2RlSm9iV2l0aFByaW9yaXR5LnByb3RvdHlwZS5wcmlvcml0eUNhbGN1bGF0b3IgPSBmdW5jdGlvbiBwcmlvcml0eUNhbGN1bGF0b3IoKSB7XHJcbiAgICByZXR1cm4gdGhpcy5fcHJpb3JpdGl6ZXIuZ2V0UHJpb3JpdHkodGhpcyk7XHJcbn07IiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBEZWNvZGVKb2JzUG9vbDtcclxuXHJcbnZhciBEZWNvZGVKb2IgPSByZXF1aXJlKCdkZWNvZGUtam9iLmpzJyk7XHJcblxyXG5mdW5jdGlvbiBEZWNvZGVKb2JzUG9vbChcclxuICAgIGRlY29kZURlcGVuZGVuY3lXb3JrZXJzLFxyXG4gICAgcHJpb3JpdGl6ZXIsXHJcbiAgICB0aWxlV2lkdGgsXHJcbiAgICB0aWxlSGVpZ2h0KSB7XHJcbiAgICBcclxuICAgIHRoaXMuX3ByaW9yaXRpemVyID0gcHJpb3JpdGl6ZXI7XHJcbiAgICB0aGlzLl90aWxlV2lkdGggPSB0aWxlV2lkdGg7XHJcbiAgICB0aGlzLl90aWxlSGVpZ2h0ID0gdGlsZUhlaWdodDtcclxuICAgIFxyXG4gICAgdGhpcy5fZGVjb2RlRGVwZW5kZW5jeVdvcmtlcnMgPSBkZWNvZGVEZXBlbmRlbmN5V29ya2VycztcclxufVxyXG5cclxuRGVjb2RlSm9ic1Bvb2wucHJvdG90eXBlLmZvcmtEZWNvZGVKb2JzID0gZnVuY3Rpb24gZm9ya0RlY29kZUpvYnMoXHJcbiAgICBpbWFnZVBhcnRQYXJhbXMsXHJcbiAgICBjYWxsYmFjayxcclxuICAgIHRlcm1pbmF0ZWRDYWxsYmFjayxcclxuICAgIGltYWdlUGFydFBhcmFtc05vdE5lZWRlZCkge1xyXG4gICAgXHJcbiAgICB2YXIgbWluWCA9IGltYWdlUGFydFBhcmFtcy5taW5YO1xyXG4gICAgdmFyIG1pblkgPSBpbWFnZVBhcnRQYXJhbXMubWluWTtcclxuICAgIHZhciBtYXhYID0gaW1hZ2VQYXJ0UGFyYW1zLm1heFhFeGNsdXNpdmU7XHJcbiAgICB2YXIgbWF4WSA9IGltYWdlUGFydFBhcmFtcy5tYXhZRXhjbHVzaXZlO1xyXG4gICAgdmFyIGxldmVsID0gaW1hZ2VQYXJ0UGFyYW1zLmxldmVsIHx8IDA7XHJcbiAgICB2YXIgcXVhbGl0eSA9IGltYWdlUGFydFBhcmFtcy5xdWFsaXR5O1xyXG4gICAgdmFyIHByaW9yaXR5RGF0YSA9IGltYWdlUGFydFBhcmFtcy5yZXF1ZXN0UHJpb3JpdHlEYXRhO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICB2YXIgaXNNaW5BbGlnbmVkID1cclxuICAgICAgICBtaW5YICUgdGhpcy5fdGlsZVdpZHRoID09PSAwICYmIG1pblkgJSB0aGlzLl90aWxlSGVpZ2h0ID09PSAwO1xyXG4gICAgdmFyIGlzTWF4WEFsaWduZWQgPSBtYXhYICUgdGhpcy5fdGlsZVdpZHRoICA9PT0gMCB8fCBtYXhYID09PSBpbWFnZVBhcnRQYXJhbXMubGV2ZWxXaWR0aDtcclxuICAgIHZhciBpc01heFlBbGlnbmVkID0gbWF4WSAlIHRoaXMuX3RpbGVIZWlnaHQgPT09IDAgfHwgbWF4WSA9PT0gaW1hZ2VQYXJ0UGFyYW1zLmxldmVsSGVpZ2h0O1xyXG4gICAgdmFyIGlzT3JkZXJWYWxpZCA9IG1pblggPCBtYXhYICYmIG1pblkgPCBtYXhZO1xyXG4gICAgXHJcbiAgICBpZiAoIWlzTWluQWxpZ25lZCB8fCAhaXNNYXhYQWxpZ25lZCB8fCAhaXNNYXhZQWxpZ25lZCB8fCAhaXNPcmRlclZhbGlkKSB7XHJcbiAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogaW1hZ2VQYXJ0UGFyYW1zIGZvciBkZWNvZGVycyBpcyBub3QgYWxpZ25lZCB0byAnICtcclxuICAgICAgICAgICAgJ3RpbGUgc2l6ZSBvciBub3QgaW4gdmFsaWQgb3JkZXInO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICB2YXIgbnVtVGlsZXNYID0gTWF0aC5jZWlsKChtYXhYIC0gbWluWCkgLyB0aGlzLl90aWxlV2lkdGgpO1xyXG4gICAgdmFyIG51bVRpbGVzWSA9IE1hdGguY2VpbCgobWF4WSAtIG1pblkpIC8gdGhpcy5fdGlsZUhlaWdodCk7XHJcbiAgICBcclxuICAgIHZhciBsaXN0ZW5lckhhbmRsZSA9IHtcclxuICAgICAgICBpbWFnZVBhcnRQYXJhbXM6IGltYWdlUGFydFBhcmFtcyxcclxuICAgICAgICBjYWxsYmFjazogY2FsbGJhY2ssXHJcbiAgICAgICAgdGVybWluYXRlZENhbGxiYWNrOiB0ZXJtaW5hdGVkQ2FsbGJhY2ssXHJcbiAgICAgICAgcmVtYWluaW5nRGVjb2RlSm9iczogbnVtVGlsZXNYICogbnVtVGlsZXNZLFxyXG4gICAgICAgIGlzQW55RGVjb2RlckFib3J0ZWQ6IGZhbHNlLFxyXG4gICAgICAgIGlzVGVybWluYXRlZENhbGxiYWNrQ2FsbGVkOiBmYWxzZSxcclxuICAgICAgICBhbGxSZWxldmFudEJ5dGVzTG9hZGVkOiAwLFxyXG4gICAgICAgIHRhc2tDb250ZXh0czogW11cclxuICAgIH07XHJcbiAgICBcclxuICAgIGZvciAodmFyIHggPSBtaW5YOyB4IDwgbWF4WDsgeCArPSB0aGlzLl90aWxlV2lkdGgpIHtcclxuICAgICAgICB2YXIgc2luZ2xlVGlsZU1heFggPSBNYXRoLm1pbih4ICsgdGhpcy5fdGlsZVdpZHRoLCBpbWFnZVBhcnRQYXJhbXMubGV2ZWxXaWR0aCk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgZm9yICh2YXIgeSA9IG1pblk7IHkgPCBtYXhZOyB5ICs9IHRoaXMuX3RpbGVIZWlnaHQpIHtcclxuICAgICAgICAgICAgdmFyIHNpbmdsZVRpbGVNYXhZID0gTWF0aC5taW4oeSArIHRoaXMuX3RpbGVIZWlnaHQsIGltYWdlUGFydFBhcmFtcy5sZXZlbEhlaWdodCk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICB2YXIgaXNUaWxlTm90TmVlZGVkID0gaXNVbm5lZWRlZChcclxuICAgICAgICAgICAgICAgIHgsXHJcbiAgICAgICAgICAgICAgICB5LFxyXG4gICAgICAgICAgICAgICAgc2luZ2xlVGlsZU1heFgsXHJcbiAgICAgICAgICAgICAgICBzaW5nbGVUaWxlTWF4WSxcclxuICAgICAgICAgICAgICAgIGltYWdlUGFydFBhcmFtc05vdE5lZWRlZCk7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgaWYgKGlzVGlsZU5vdE5lZWRlZCkge1xyXG4gICAgICAgICAgICAgICAgLS1saXN0ZW5lckhhbmRsZS5yZW1haW5pbmdEZWNvZGVKb2JzO1xyXG4gICAgICAgICAgICAgICAgY29udGludWU7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHZhciBzaW5nbGVUaWxlSW1hZ2VQYXJ0UGFyYW1zID0ge1xyXG4gICAgICAgICAgICAgICAgbWluWDogeCxcclxuICAgICAgICAgICAgICAgIG1pblk6IHksXHJcbiAgICAgICAgICAgICAgICBtYXhYRXhjbHVzaXZlOiBzaW5nbGVUaWxlTWF4WCxcclxuICAgICAgICAgICAgICAgIG1heFlFeGNsdXNpdmU6IHNpbmdsZVRpbGVNYXhZLFxyXG4gICAgICAgICAgICAgICAgbGV2ZWxXaWR0aDogaW1hZ2VQYXJ0UGFyYW1zLmxldmVsV2lkdGgsXHJcbiAgICAgICAgICAgICAgICBsZXZlbEhlaWdodDogaW1hZ2VQYXJ0UGFyYW1zLmxldmVsSGVpZ2h0LFxyXG4gICAgICAgICAgICAgICAgbGV2ZWw6IGxldmVsLFxyXG4gICAgICAgICAgICAgICAgcXVhbGl0eTogcXVhbGl0eSxcclxuICAgICAgICAgICAgICAgIHJlcXVlc3RQcmlvcml0eURhdGE6IHByaW9yaXR5RGF0YVxyXG4gICAgICAgICAgICB9O1xyXG5cclxuICAgICAgICAgICAgdGhpcy5fc3RhcnROZXdUYXNrKGxpc3RlbmVySGFuZGxlLCBzaW5nbGVUaWxlSW1hZ2VQYXJ0UGFyYW1zKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgXHJcbiAgICBpZiAoIWxpc3RlbmVySGFuZGxlLmlzVGVybWluYXRlZENhbGxiYWNrQ2FsbGVkICYmXHJcbiAgICAgICAgbGlzdGVuZXJIYW5kbGUucmVtYWluaW5nRGVjb2RlSm9icyA9PT0gMCkge1xyXG4gICAgICAgIFxyXG4gICAgICAgIGxpc3RlbmVySGFuZGxlLmlzVGVybWluYXRlZENhbGxiYWNrQ2FsbGVkID0gdHJ1ZTtcclxuICAgICAgICBsaXN0ZW5lckhhbmRsZS50ZXJtaW5hdGVkQ2FsbGJhY2sobGlzdGVuZXJIYW5kbGUuaXNBbnlEZWNvZGVyQWJvcnRlZCk7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHJldHVybiBsaXN0ZW5lckhhbmRsZTtcclxufTtcclxuXHJcbkRlY29kZUpvYnNQb29sLnByb3RvdHlwZS5fc3RhcnROZXdUYXNrID0gZnVuY3Rpb24gc3RhcnROZXdUYXNrKGxpc3RlbmVySGFuZGxlLCBpbWFnZVBhcnRQYXJhbXMpIHtcclxuICAgIHZhciBkZWNvZGVKb2IgPSB0aGlzLl9wcmlvcml0aXplciA9PT0gbnVsbCA/XHJcbiAgICAgICAgbmV3IERlY29kZUpvYihsaXN0ZW5lckhhbmRsZSwgaW1hZ2VQYXJ0UGFyYW1zKSA6XHJcbiAgICAgICAgbmV3IERlY29kZUpvYi5XaXRoUHJpb3JpdHkobGlzdGVuZXJIYW5kbGUsIGltYWdlUGFydFBhcmFtcywgdGhpcy5fcHJpb3JpdGl6ZXIpO1xyXG4gICAgdmFyIHRhc2tDb250ZXh0ID0gdGhpcy5fZGVjb2RlRGVwZW5kZW5jeVdvcmtlcnMuc3RhcnRUYXNrKGltYWdlUGFydFBhcmFtcywgZGVjb2RlSm9iKTtcclxuICAgIGxpc3RlbmVySGFuZGxlLnRhc2tDb250ZXh0cy5wdXNoKHRhc2tDb250ZXh0KTtcclxufTtcclxuXHJcbkRlY29kZUpvYnNQb29sLnByb3RvdHlwZS51bnJlZ2lzdGVyRm9ya2VkSm9icyA9IGZ1bmN0aW9uIHVucmVnaXN0ZXJGb3JrZWRKb2JzKFxyXG4gICAgbGlzdGVuZXJIYW5kbGUpIHtcclxuICAgICAgICAgICAgXHJcbiAgICBpZiAobGlzdGVuZXJIYW5kbGUucmVtYWluaW5nRGVjb2RlSm9icyA9PT0gMCkge1xyXG4gICAgICAgIC8vIEFsbCBqb2JzIGhhcyBhbHJlYWR5IGJlZW4gdGVybWluYXRlZCwgbm8gbmVlZCB0byB1bnJlZ2lzdGVyXHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IGxpc3RlbmVySGFuZGxlLnRhc2tDb250ZXh0cy5sZW5ndGg7ICsraSkge1xyXG4gICAgICAgIGxpc3RlbmVySGFuZGxlLnRhc2tDb250ZXh0c1tpXS51bnJlZ2lzdGVyKCk7XHJcbiAgICB9XHJcbn07XHJcblxyXG5mdW5jdGlvbiBpc1VubmVlZGVkKFxyXG4gICAgbWluWCwgbWluWSwgbWF4WCwgbWF4WSwgaW1hZ2VQYXJ0UGFyYW1zTm90TmVlZGVkKSB7XHJcbiAgICBcclxuICAgIGlmIChpbWFnZVBhcnRQYXJhbXNOb3ROZWVkZWQgPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIHJldHVybiBmYWxzZTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBpbWFnZVBhcnRQYXJhbXNOb3ROZWVkZWQubGVuZ3RoOyArK2kpIHtcclxuICAgICAgICB2YXIgbm90TmVlZGVkID0gaW1hZ2VQYXJ0UGFyYW1zTm90TmVlZGVkW2ldO1xyXG4gICAgICAgIHZhciBpc0luWCA9IG1pblggPj0gbm90TmVlZGVkLm1pblggJiYgbWF4WCA8PSBub3ROZWVkZWQubWF4WEV4Y2x1c2l2ZTtcclxuICAgICAgICB2YXIgaXNJblkgPSBtaW5ZID49IG5vdE5lZWRlZC5taW5ZICYmIG1heFkgPD0gbm90TmVlZGVkLm1heFlFeGNsdXNpdmU7XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKGlzSW5YICYmIGlzSW5ZKSB7XHJcbiAgICAgICAgICAgIHJldHVybiB0cnVlO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuICAgIFxyXG4gICAgcmV0dXJuIGZhbHNlO1xyXG59IiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBGZXRjaENvbnRleHRBcGk7XHJcblxyXG5mdW5jdGlvbiBGZXRjaENvbnRleHRBcGkoKSB7XHJcbiAgICB0aGlzLl9ldmVudHMgPSB7XHJcbiAgICAgICAgaXNQcm9ncmVzc2l2ZUNoYW5nZWQ6IFtdLFxyXG4gICAgICAgIG1vdmU6IFtdLFxyXG4gICAgICAgIHRlcm1pbmF0ZTogW10sXHJcbiAgICAgICAgXHJcbiAgICAgICAgc3RvcDogW10sXHJcbiAgICAgICAgcmVzdW1lOiBbXSxcclxuICAgICAgICBcclxuICAgICAgICBpbnRlcm5hbFN0b3BwZWQ6IFtdLFxyXG4gICAgICAgIGludGVybmFsRG9uZTogW11cclxuICAgIH07XHJcbn1cclxuXHJcbkZldGNoQ29udGV4dEFwaS5wcm90b3R5cGUuc3RvcHBlZCA9IGZ1bmN0aW9uIHN0b3BwZWQoKSB7XHJcbiAgICB0aGlzLl9vbkV2ZW50KCdpbnRlcm5hbFN0b3BwZWQnLCAvKmlzQWJvcnRlZD0qL2ZhbHNlKTtcclxufTtcclxuXHJcbkZldGNoQ29udGV4dEFwaS5wcm90b3R5cGUuZG9uZSA9IGZ1bmN0aW9uIGRvbmUoKSB7XHJcbiAgICB0aGlzLl9vbkV2ZW50KCdpbnRlcm5hbERvbmUnKTtcclxufTtcclxuXHJcbkZldGNoQ29udGV4dEFwaS5wcm90b3R5cGUub24gPSBmdW5jdGlvbiBvbihldmVudCwgbGlzdGVuZXIsIGxpc3RlbmVyVGhpcykge1xyXG4gICAgdmFyIGxpc3RlbmVycyA9IHRoaXMuX2V2ZW50c1tldmVudF07XHJcbiAgICBpZiAoIWxpc3RlbmVycykge1xyXG4gICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IGV2ZW50ICcgKyBldmVudCArICcgZG9lcyBub3QgZXhpc3QgaW4gRmV0Y2hDb250ZXh0JztcclxuICAgIH1cclxuICAgIGxpc3RlbmVycy5wdXNoKHtcclxuICAgICAgICBsaXN0ZW5lcjogbGlzdGVuZXIsXHJcbiAgICAgICAgbGlzdGVuZXJUaGlzOiBsaXN0ZW5lclRoaXMgfHwgdGhpc1xyXG4gICAgfSk7XHJcbiAgICBcclxuICAgIHJldHVybiB0aGlzO1xyXG59O1xyXG5cclxuRmV0Y2hDb250ZXh0QXBpLnByb3RvdHlwZS5fb25FdmVudCA9IGZ1bmN0aW9uIG9uRXZlbnQoZXZlbnQsIGFyZzEsIGFyZzIpIHtcclxuICAgIHZhciBsaXN0ZW5lcnMgPSB0aGlzLl9ldmVudHNbZXZlbnRdO1xyXG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBsaXN0ZW5lcnMubGVuZ3RoOyArK2kpIHtcclxuICAgICAgICBsaXN0ZW5lcnNbaV0ubGlzdGVuZXIuY2FsbChsaXN0ZW5lcnNbaV0ubGlzdGVuZXJUaGlzLCBhcmcxLCBhcmcyKTtcclxuICAgIH1cclxufTsiLCIndXNlIHN0cmljdCc7XHJcblxyXG52YXIgRmV0Y2hDb250ZXh0QXBpID0gcmVxdWlyZSgnZmV0Y2gtY29udGV4dC1hcGkuanMnKTtcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gRmV0Y2hDb250ZXh0O1xyXG5cclxuRmV0Y2hDb250ZXh0LkZFVENIX1RZUEVfUkVRVUVTVCA9IDE7XHJcbkZldGNoQ29udGV4dC5GRVRDSF9UWVBFX01PVkFCTEUgPSAyOyAvLyBtb3ZhYmxlXHJcbkZldGNoQ29udGV4dC5GRVRDSF9UWVBFX09OTFlfV0FJVF9GT1JfREFUQSA9IDM7XHJcblxyXG5GZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX1dBSVRfRk9SX0ZFVENIX0NBTEwgPSAxO1xyXG5GZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX01PVkFCTEVfV0FJVF9GT1JfTU9WRV9DQUxMID0gMjtcclxuRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19SRVFVRVNUX1dBSVRfRk9SX1NDSEVEVUxFID0gMztcclxuRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19BQ1RJVkUgPSA0O1xyXG5GZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX1JFUVVFU1RfQUJPVVRfVE9fWUlFTEQgPSA1O1xyXG5GZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX1JFUVVFU1RfWUlFTERFRCA9IDY7XHJcbkZldGNoQ29udGV4dC5GRVRDSF9TVEFUVVNfUkVRVUVTVF9BQk9VVF9UT19BQk9SVCA9IDc7XHJcbkZldGNoQ29udGV4dC5GRVRDSF9TVEFUVVNfUkVRVUVTVF9URVJNSU5BVEVEID0gODtcclxuRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19VTkVYUEVDVEVEX0ZBSUxVUkUgPSA5O1xyXG5cclxuZnVuY3Rpb24gRmV0Y2hDb250ZXh0KGZldGNoZXIsIGZldGNoZXJDbG9zZXIsIHNjaGVkdWxlciwgc2NoZWR1bGVkSm9ic0xpc3QsIGZldGNoVHlwZSwgY29udGV4dFZhcnMpIHtcclxuICAgIHRoaXMuX2ZldGNoZXIgPSBmZXRjaGVyO1xyXG4gICAgdGhpcy5fZmV0Y2hlckNsb3NlciA9IGZldGNoZXJDbG9zZXI7XHJcbiAgICB0aGlzLl9zY2hlZHVsZXIgPSBzY2hlZHVsZXI7XHJcbiAgICB0aGlzLl9zY2hlZHVsZWRKb2JzTGlzdCA9IHNjaGVkdWxlZEpvYnNMaXN0O1xyXG4gICAgdGhpcy5fc2NoZWR1bGVkSm9ic0xpc3RJdGVyYXRvciA9IG51bGw7XHJcbiAgICBcclxuICAgIHRoaXMuX3Rlcm1pbmF0ZWRMaXN0ZW5lcnMgPSBbXTtcclxuICAgIFxyXG4gICAgdGhpcy5faW1hZ2VQYXJ0UGFyYW1zID0gbnVsbDtcclxuICAgIFxyXG4gICAgdGhpcy5fc3RhdGUgPSBGZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX1dBSVRfRk9SX0ZFVENIX0NBTEw7XHJcbiAgICB0aGlzLl9pc01vdmFibGUgPSBmZXRjaFR5cGUgPT09IEZldGNoQ29udGV4dC5GRVRDSF9UWVBFX01PVkFCTEU7XHJcbiAgICB0aGlzLl9jb250ZXh0VmFycyA9IGNvbnRleHRWYXJzO1xyXG4gICAgdGhpcy5faXNPbmx5V2FpdEZvckRhdGEgPSBmZXRjaFR5cGUgPT09IEZldGNoQ29udGV4dC5GRVRDSF9UWVBFX09OTFlfV0FJVF9GT1JfREFUQTtcclxuICAgIHRoaXMuX3VzZVNjaGVkdWxlciA9IGZldGNoVHlwZSA9PT0gRmV0Y2hDb250ZXh0LkZFVENIX1RZUEVfUkVRVUVTVDtcclxuICAgIHRoaXMuX3Jlc291cmNlID0gbnVsbDtcclxuICAgIHRoaXMuX2ZldGNoQ29udGV4dEFwaSA9IG51bGw7XHJcbiAgICAvL3RoaXMuX2FscmVhZHlUZXJtaW5hdGVkV2hlbkFsbERhdGFBcnJpdmVkID0gZmFsc2U7XHJcbn1cclxuXHJcbkZldGNoQ29udGV4dC5wcm90b3R5cGUuZmV0Y2ggPSBmdW5jdGlvbiBmZXRjaChpbWFnZVBhcnRQYXJhbXMpIHtcclxuICAgIGlmICh0aGlzLl9pc01vdmFibGUpIHtcclxuICAgICAgICB0aGlzLl9pbWFnZVBhcnRQYXJhbXMgPSBpbWFnZVBhcnRQYXJhbXM7XHJcbiAgICAgICAgdGhpcy5fc3RhcnRGZXRjaCgpO1xyXG4gICAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIFxyXG4gICAgaWYgKHRoaXMuX2ltYWdlUGFydFBhcmFtcyAhPT0gbnVsbCkge1xyXG4gICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IENhbm5vdCBmZXRjaCB0d2ljZSBvbiBmZXRjaCB0eXBlIG9mIFwicmVxdWVzdFwiJztcclxuICAgIH1cclxuICAgIFxyXG4gICAgaWYgKHRoaXMuX3N0YXRlICE9PSBGZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX1dBSVRfRk9SX0ZFVENIX0NBTEwpIHtcclxuICAgICAgICB0aGlzLl9zdGF0ZSA9IEZldGNoQ29udGV4dC5GRVRDSF9TVEFUVVNfVU5FWFBFQ1RFRF9GQUlMVVJFO1xyXG4gICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IFVuZXhwZWN0ZWQgc3RhdGUgb24gZmV0Y2goKTogJyArIHRoaXMuX3N0YXRlO1xyXG4gICAgfVxyXG5cclxuICAgIHRoaXMuX2ltYWdlUGFydFBhcmFtcyA9IGltYWdlUGFydFBhcmFtcztcclxuICAgIHRoaXMuX3N0YXRlID0gRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19SRVFVRVNUX1dBSVRfRk9SX1NDSEVEVUxFO1xyXG4gICAgXHJcbiAgICBpZiAoIXRoaXMuX3VzZVNjaGVkdWxlcikge1xyXG4gICAgICAgIHN0YXJ0UmVxdWVzdCgvKnJlc291cmNlPSovbnVsbCwgdGhpcyk7XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICB0aGlzLl9zY2hlZHVsZXIuZW5xdWV1ZUpvYihzdGFydFJlcXVlc3QsIHRoaXMsIGZldGNoQWJvcnRlZEJ5U2NoZWR1bGVyKTtcclxufTtcclxuXHJcbkZldGNoQ29udGV4dC5wcm90b3R5cGUubWFudWFsQWJvcnRSZXF1ZXN0ID0gZnVuY3Rpb24gbWFudWFsQWJvcnRSZXF1ZXN0KCkge1xyXG4gICAgc3dpdGNoICh0aGlzLl9zdGF0ZSkge1xyXG4gICAgICAgIGNhc2UgRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19SRVFVRVNUX1RFUk1JTkFURUQ6XHJcbiAgICAgICAgY2FzZSBGZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX1VORVhQRUNURURfRkFJTFVSRTpcclxuICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgIGNhc2UgRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19SRVFVRVNUX0FCT1VUX1RPX0FCT1JUOlxyXG4gICAgICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBEb3VibGUgY2FsbCB0byBtYW51YWxBYm9ydFJlcXVlc3QoKSc7XHJcbiAgICAgICAgY2FzZSBGZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX0FDVElWRTpcclxuICAgICAgICAgICAgdGhpcy5fc3RhdGUgPSBGZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX1JFUVVFU1RfQUJPVVRfVE9fQUJPUlQ7XHJcbiAgICAgICAgICAgIGlmICh0aGlzLl9pc09ubHlXYWl0Rm9yRGF0YSkge1xyXG4gICAgICAgICAgICAgICAgdGhpcy5fZmV0Y2hTdG9wcGVkKC8qaXNBYm9ydGVkPSovdHJ1ZSk7XHJcbiAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICB0aGlzLl9mZXRjaENvbnRleHRBcGkuX29uRXZlbnQoJ3N0b3AnLCAvKmlzQWJvcnRlZD0qL3RydWUpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGJyZWFrO1xyXG4gICAgICAgIGNhc2UgRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19XQUlUX0ZPUl9GRVRDSF9DQUxMOlxyXG4gICAgICAgICAgICB0aGlzLl9zdGF0ZSA9IEZldGNoQ29udGV4dC5GRVRDSF9TVEFUVVNfUkVRVUVTVF9URVJNSU5BVEVEO1xyXG4gICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgY2FzZSBGZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX1JFUVVFU1RfV0FJVF9GT1JfU0NIRURVTEU6XHJcbiAgICAgICAgY2FzZSBGZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX1JFUVVFU1RfQUJPVVRfVE9fWUlFTEQ6XHJcbiAgICAgICAgY2FzZSBGZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX1JFUVVFU1RfWUlFTERFRDpcclxuICAgICAgICAgICAgdGhpcy5fc3RhdGUgPSBGZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX1JFUVVFU1RfQUJPVVRfVE9fQUJPUlQ7XHJcbiAgICAgICAgICAgIGJyZWFrO1xyXG4gICAgICAgIGRlZmF1bHQ6XHJcbiAgICAgICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IFVua25vd24gc3RhdGUgaW4gbWFudWFsQWJvcnRSZXF1ZXN0KCkgaW1wbGVtZW50YXRpb246ICcgKyB0aGlzLl9zdGF0ZTtcclxuICAgIH1cclxufTtcclxuXHJcbkZldGNoQ29udGV4dC5wcm90b3R5cGUuZ2V0Q29udGV4dFZhcnMgPSBmdW5jdGlvbiBnZXRDb250ZXh0VmFycygpIHtcclxuICAgIHJldHVybiB0aGlzLl9jb250ZXh0VmFycztcclxufTtcclxuXHJcbkZldGNoQ29udGV4dC5wcm90b3R5cGUub24gPSBmdW5jdGlvbiBvbihldmVudCwgbGlzdGVuZXIpIHtcclxuICAgIHN3aXRjaCAoZXZlbnQpIHtcclxuICAgICAgICBjYXNlICd0ZXJtaW5hdGVkJzpcclxuICAgICAgICAgICAgdGhpcy5fdGVybWluYXRlZExpc3RlbmVycy5wdXNoKGxpc3RlbmVyKTtcclxuICAgICAgICAgICAgYnJlYWs7XHJcbiAgICAgICAgZGVmYXVsdDpcclxuICAgICAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogVW5leHBlY3RlZCBldmVudCAnICsgZXZlbnQ7XHJcbiAgICB9XHJcbn07XHJcblxyXG5GZXRjaENvbnRleHQucHJvdG90eXBlLnNldElzUHJvZ3Jlc3NpdmUgPSBmdW5jdGlvbiBzZXRJc1Byb2dyZXNzaXZlKGlzUHJvZ3Jlc3NpdmUpIHtcclxuICAgIHRoaXMuX2lzUHJvZ3Jlc3NpdmUgPSBpc1Byb2dyZXNzaXZlO1xyXG4gICAgaWYgKHRoaXMuX2ZldGNoQ29udGV4dEFwaSAhPT0gbnVsbCkge1xyXG4gICAgICAgIHRoaXMuX2ZldGNoQ29udGV4dEFwaS5fb25FdmVudCgnaXNQcm9ncmVzc2l2ZUNoYW5nZWQnLCBpc1Byb2dyZXNzaXZlKTtcclxuICAgIH1cclxufTtcclxuXHJcbkZldGNoQ29udGV4dC5wcm90b3R5cGUuZ2V0SXNQcm9ncmVzc2l2ZSA9IGZ1bmN0aW9uIGdldElzUHJvZ3Jlc3NpdmUoKSB7XHJcbiAgICByZXR1cm4gdGhpcy5faXNQcm9ncmVzc2l2ZTtcclxufTtcclxuXHJcbkZldGNoQ29udGV4dC5wcm90b3R5cGUuX3N0YXJ0RmV0Y2ggPSBmdW5jdGlvbiBzdGFydEZldGNoKCkge1xyXG4gICAgdmFyIHByZXZTdGF0ZSA9IHRoaXMuX3N0YXRlO1xyXG4gICAgdGhpcy5fc3RhdGUgPSBGZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX0FDVElWRTtcclxuICAgIFxyXG4gICAgaWYgKHByZXZTdGF0ZSA9PT0gRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19XQUlUX0ZPUl9GRVRDSF9DQUxMIHx8XHJcbiAgICAgICAgcHJldlN0YXRlID09PSBGZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX01PVkFCTEVfV0FJVF9GT1JfTU9WRV9DQUxMKSB7XHJcbiAgICAgICAgXHJcbiAgICAgICAgdGhpcy5fZmV0Y2hlckNsb3Nlci5jaGFuZ2VBY3RpdmVGZXRjaGVzQ291bnQoKzEpO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBpZiAodGhpcy5faXNPbmx5V2FpdEZvckRhdGEpIHtcclxuICAgICAgICB0aGlzLl9mZXRjaENvbnRleHRBcGkgPSB0aGlzLl9leHRyYWN0QWxyZWFkeUZldGNoZWREYXRhKCk7XHJcbiAgICB9IGVsc2UgaWYgKCF0aGlzLl9pc01vdmFibGUgfHwgcHJldlN0YXRlID09PSBGZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX1dBSVRfRk9SX0ZFVENIX0NBTEwpIHtcclxuICAgICAgICBpZiAodGhpcy5fZmV0Y2hDb250ZXh0QXBpICE9PSBudWxsKSB7XHJcbiAgICAgICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IENhbm5vdCBzdGFydCBmZXRjaCBvZiBhbHJlYWR5IHN0YXJ0ZWQgZmV0Y2gnO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgdGhpcy5fZmV0Y2hDb250ZXh0QXBpID0gbmV3IEZldGNoQ29udGV4dEFwaSh0aGlzKTtcclxuICAgICAgICB0aGlzLl9mZXRjaENvbnRleHRBcGkub24oJ2ludGVybmFsU3RvcHBlZCcsIHRoaXMuX2ZldGNoU3RvcHBlZCwgdGhpcyk7XHJcbiAgICAgICAgdGhpcy5fZmV0Y2hDb250ZXh0QXBpLm9uKCdpbnRlcm5hbERvbmUnLCB0aGlzLl9mZXRjaERvbmUsIHRoaXMpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGlmICh0aGlzLl9pc01vdmFibGUpIHtcclxuICAgICAgICAgICAgdGhpcy5fZmV0Y2hlci5zdGFydE1vdmFibGVGZXRjaCh0aGlzLl9mZXRjaENvbnRleHRBcGksIHRoaXMuX2ltYWdlUGFydFBhcmFtcyk7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgdGhpcy5fZmV0Y2hlci5zdGFydEZldGNoKHRoaXMuX2ZldGNoQ29udGV4dEFwaSwgdGhpcy5faW1hZ2VQYXJ0UGFyYW1zKTtcclxuICAgICAgICB9XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICAgIHRoaXMuX2ZldGNoQ29udGV4dEFwaS5fb25FdmVudCgnbW92ZScsIHRoaXMuX2ltYWdlUGFydFBhcmFtcyk7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGlmICh0aGlzLl9mZXRjaENvbnRleHRBcGkgIT09IG51bGwpIHsgLy8gTWlnaHQgYmUgc2V0IHRvIG51bGwgaW4gaW1tZWRpYXRlIGNhbGwgb2YgZmV0Y2hUZXJtaW5hdGVkIG9uIHByZXZpb3VzIGxpbmVcclxuICAgICAgICB0aGlzLl9mZXRjaENvbnRleHRBcGkuX29uRXZlbnQoJ2lzUHJvZ3Jlc3NpdmVDaGFuZ2VkJywgdGhpcy5faXNQcm9ncmVzc2l2ZSk7XHJcbiAgICB9XHJcbn07XHJcblxyXG5GZXRjaENvbnRleHQucHJvdG90eXBlLmNoZWNrSWZTaG91bGRZaWVsZCA9IGZ1bmN0aW9uIGNoZWNrSWZTaG91bGRZaWVsZCgpIHtcclxuICAgIHRyeSB7XHJcbiAgICAgICAgaWYgKCF0aGlzLl91c2VTY2hlZHVsZXIgfHwgdGhpcy5fc3RhdGUgPT09IEZldGNoQ29udGV4dC5GRVRDSF9TVEFUVVNfUkVRVUVTVF9URVJNSU5BVEVEKSB7XHJcbiAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKHRoaXMuX3Jlc291cmNlID09PSBudWxsKSB7XHJcbiAgICAgICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IE5vIHJlc291cmNlIGFsbG9jYXRlZCBidXQgZmV0Y2ggY2FsbGJhY2sgY2FsbGVkJztcclxuICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgIGlmICghdGhpcy5fc2NoZWR1bGVyQ2FsbGJhY2tzLnNob3VsZFlpZWxkT3JBYm9ydCgpKSB7XHJcbiAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgdGhpcy5fc3RhdGUgPSBGZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX1JFUVVFU1RfQUJPVVRfVE9fWUlFTEQ7XHJcbiAgICAgICAgdGhpcy5fZmV0Y2hDb250ZXh0QXBpLl9vbkV2ZW50KCdzdG9wJywgLyppc0Fib3J0ZWQ9Ki9mYWxzZSk7XHJcbiAgICB9IGNhdGNoIChlKSB7XHJcbiAgICAgICAgdGhpcy5fc3RhdGUgPSBGZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX1VORVhQRUNURURfRkFJTFVSRTtcclxuICAgICAgICBmZXRjaEFib3J0ZWRCeVNjaGVkdWxlcih0aGlzKTtcclxuICAgIH1cclxufTtcclxuXHJcbkZldGNoQ29udGV4dC5wcm90b3R5cGUuX2ZldGNoRG9uZSA9IGZ1bmN0aW9uIGZldGNoRG9uZSgpIHtcclxuICAgIHN3aXRjaCAodGhpcy5fc3RhdGUpIHtcclxuICAgICAgICBjYXNlIEZldGNoQ29udGV4dC5GRVRDSF9TVEFUVVNfUkVRVUVTVF9BQk9VVF9UT19BQk9SVDpcclxuICAgICAgICBjYXNlIEZldGNoQ29udGV4dC5GRVRDSF9TVEFUVVNfQUNUSVZFOlxyXG4gICAgICAgIGNhc2UgRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19SRVFVRVNUX0FCT1VUX1RPX1lJRUxEOlxyXG4gICAgICAgICAgICBicmVhaztcclxuICAgICAgICBkZWZhdWx0OlxyXG4gICAgICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBVbmV4cGVjdGVkIHN0YXRlIG9uIGZldGNoIGRvbmU6ICcgKyB0aGlzLl9zdGF0ZTtcclxuICAgIH1cclxuXHJcbiAgICBpZiAodGhpcy5faXNNb3ZhYmxlKSB7XHJcbiAgICAgICAgdGhpcy5fc3RhdGUgPSBGZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX01PVkFCTEVfV0FJVF9GT1JfTU9WRV9DQUxMO1xyXG4gICAgfVxyXG4gICAgdGhpcy5fZmV0Y2hlckNsb3Nlci5jaGFuZ2VBY3RpdmVGZXRjaGVzQ291bnQoLTEpO1xyXG5cclxuICAgIGlmICh0aGlzLl9yZXNvdXJjZSAhPT0gbnVsbCkge1xyXG4gICAgICAgIHRoaXMuX3NjaGVkdWxlZEpvYnNMaXN0LnJlbW92ZSh0aGlzLl9zY2hlZHVsZWRKb2JzTGlzdEl0ZXJhdG9yKTtcclxuICAgICAgICB0aGlzLl9zY2hlZHVsZXJDYWxsYmFja3Muam9iRG9uZSgpO1xyXG5cclxuICAgICAgICB0aGlzLl9yZXNvdXJjZSA9IG51bGw7XHJcbiAgICB9IGVsc2UgaWYgKHRoaXMuX3VzZVNjaGVkdWxlcikge1xyXG4gICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IEpvYiBleHBlY3RlZCB0byBoYXZlIHJlc291cmNlIG9uIHN1Y2Nlc3NmdWwgdGVybWluYXRpb24nO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICB0aGlzLl90ZXJtaW5hdGVOb25Nb3ZhYmxlRmV0Y2goKTtcclxufTtcclxuXHJcbkZldGNoQ29udGV4dC5wcm90b3R5cGUuX2ZldGNoU3RvcHBlZCA9IGZ1bmN0aW9uIGZldGNoU3RvcHBlZChpc0Fib3J0ZWQpIHtcclxuICAgIHN3aXRjaCAodGhpcy5fc3RhdGUpIHtcclxuICAgICAgICBjYXNlIEZldGNoQ29udGV4dC5GRVRDSF9TVEFUVVNfUkVRVUVTVF9BQk9VVF9UT19BQk9SVDpcclxuICAgICAgICAgICAgaXNBYm9ydGVkID0gdHJ1ZTsgLy8gZm9yY2UgYWJvcnRlZFxyXG4gICAgICAgICAgICBicmVhaztcclxuICAgICAgICBjYXNlIEZldGNoQ29udGV4dC5GRVRDSF9TVEFUVVNfUkVRVUVTVF9BQk9VVF9UT19ZSUVMRDpcclxuICAgICAgICAgICAgdmFyIGlzWWllbGRlZCA9IHRoaXMuX3NjaGVkdWxlckNhbGxiYWNrcy50cnlZaWVsZChcclxuICAgICAgICAgICAgICAgIGNvbnRpbnVlWWllbGRlZFJlcXVlc3QsXHJcbiAgICAgICAgICAgICAgICBmZXRjaEFib3J0ZWRCeVNjaGVkdWxlcixcclxuICAgICAgICAgICAgICAgIGZldGNoWWllbGRlZEJ5U2NoZWR1bGVyKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGlmICghaXNZaWVsZGVkKSB7XHJcbiAgICAgICAgICAgICAgICBpZiAodGhpcy5fc3RhdGUgIT09IEZldGNoQ29udGV4dC5GRVRDSF9TVEFUVVNfUkVRVUVTVF9BQk9VVF9UT19ZSUVMRCkge1xyXG4gICAgICAgICAgICAgICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IFVuZXhwZWN0ZWQgc3RhdGUgb24gdHJ5WWllbGQoKSBmYWxzZTogJyArIHRoaXMuX3N0YXRlO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgdGhpcy5fc3RhdGUgPSBGZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX0FDVElWRTtcclxuICAgICAgICAgICAgICAgIHRoaXMuX2ZldGNoQ29udGV4dEFwaS5fb25FdmVudCgncmVzdW1lJyk7XHJcbiAgICAgICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgYnJlYWs7XHJcbiAgICAgICAgZGVmYXVsdDpcclxuICAgICAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogVW5leHBlY3RlZCBzdGF0ZSBvbiBmZXRjaCBzdG9wcGVkOiAnICsgdGhpcy5fc3RhdGU7XHJcbiAgICB9XHJcblxyXG4gICAgXHJcbiAgICBpZiAodGhpcy5fcmVzb3VyY2UgIT09IG51bGwpIHtcclxuICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBVbmV4cGVjdGVkIHJlcXVlc3QgdGVybWluYXRpb24gd2l0aG91dCByZXNvdXJjZSBhbGxvY2F0ZWQnO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICB0aGlzLl9mZXRjaGVyQ2xvc2VyLmNoYW5nZUFjdGl2ZUZldGNoZXNDb3VudCgtMSk7XHJcbiAgICBpZiAodGhpcy5faXNNb3ZhYmxlKSB7XHJcbiAgICAgICAgdGhpcy5fc3RhdGUgPSBGZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX01PVkFCTEVfV0FJVF9GT1JfTU9WRV9DQUxMO1xyXG4gICAgfSBlbHNlIGlmICghaXNBYm9ydGVkKSB7XHJcbiAgICAgICAgdGhpcy5fdGVybWluYXRlTm9uTW92YWJsZUZldGNoKCk7XHJcbiAgICB9XHJcbn07XHJcbiAgXHJcbkZldGNoQ29udGV4dC5wcm90b3R5cGUuX3Rlcm1pbmF0ZU5vbk1vdmFibGVGZXRjaCA9IGZ1bmN0aW9uIHRlcm1pbmF0ZU5vbk1vdmFibGVGZXRjaCgpIHsgIFxyXG4gICAgaWYgKHRoaXMuX2lzTW92YWJsZSkge1xyXG4gICAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIFxyXG4gICAgdGhpcy5fc3RhdGUgPSBGZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX1JFUVVFU1RfVEVSTUlOQVRFRDtcclxuICAgIFxyXG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCB0aGlzLl90ZXJtaW5hdGVkTGlzdGVuZXJzLmxlbmd0aDsgKytpKSB7XHJcbiAgICAgICAgdGhpcy5fdGVybWluYXRlZExpc3RlbmVyc1tpXSh0aGlzLl9jb250ZXh0VmFycyk7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGlmICh0aGlzLl9mZXRjaENvbnRleHRBcGkgIT09IG51bGwgJiZcclxuICAgICAgICB0aGlzLl9zdGF0ZSAhPT0gRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19VTkVYUEVDVEVEX0ZBSUxVUkUpIHtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgdGhpcy5fZmV0Y2hDb250ZXh0QXBpLl9vbkV2ZW50KCd0ZXJtaW5hdGUnKTtcclxuICAgICAgICB0aGlzLl9mZXRjaENvbnRleHRBcGkgPSBudWxsO1xyXG4gICAgfVxyXG59O1xyXG5cclxuLy8gUHJvcGVydGllcyBmb3IgRnJ1c3R1bVJlcXVlc2V0UHJpb3JpdGl6ZXJcclxuXHJcbk9iamVjdC5kZWZpbmVQcm9wZXJ0eShGZXRjaENvbnRleHQucHJvdG90eXBlLCAnaW1hZ2VQYXJ0UGFyYW1zJywge1xyXG4gICAgZ2V0OiBmdW5jdGlvbiBnZXRJbWFnZVBhcnRQYXJhbXMoKSB7XHJcbiAgICAgICAgcmV0dXJuIHRoaXMuX2ltYWdlUGFydFBhcmFtcztcclxuICAgIH1cclxufSk7XHJcblxyXG5mdW5jdGlvbiBzdGFydFJlcXVlc3QocmVzb3VyY2UsIHNlbGYsIGNhbGxiYWNrcykge1xyXG4gICAgaWYgKHNlbGYuX3Jlc291cmNlICE9PSBudWxsKSB7XHJcbiAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogVW5leHBlY3RlZCByZXN0YXJ0IG9mIGFscmVhZHkgc3RhcnRlZCByZXF1ZXN0JztcclxuICAgIH1cclxuICAgIFxyXG4gICAgaWYgKHNlbGYuX3N0YXRlID09PSBGZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX1JFUVVFU1RfQUJPVVRfVE9fQUJPUlQpIHtcclxuICAgICAgICBzZWxmLl9mZXRjaFN0b3BwZWQoLyppc0Fib3J0ZWQ9Ki90cnVlKTtcclxuICAgICAgICByZXR1cm47XHJcbiAgICB9IGVsc2UgaWYgKHNlbGYuX3N0YXRlICE9PSBGZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX1JFUVVFU1RfV0FJVF9GT1JfU0NIRURVTEUpIHtcclxuICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBVbmV4cGVjdGVkIHN0YXRlIG9uIHNjaGVkdWxlOiAnICsgc2VsZi5fc3RhdGU7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHNlbGYuX3Jlc291cmNlID0gcmVzb3VyY2U7XHJcbiAgICBzZWxmLl9zY2hlZHVsZXJDYWxsYmFja3MgPSBjYWxsYmFja3M7XHJcblxyXG4gICAgaWYgKHJlc291cmNlICE9PSBudWxsKSB7XHJcbiAgICAgICAgc2VsZi5fc2NoZWR1bGVkSm9ic0xpc3RJdGVyYXRvciA9IHNlbGYuX3NjaGVkdWxlZEpvYnNMaXN0LmFkZChzZWxmKTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgc2VsZi5fc3RhcnRGZXRjaCgpO1xyXG59XHJcblxyXG5mdW5jdGlvbiBjb250aW51ZVlpZWxkZWRSZXF1ZXN0KHJlc291cmNlLCBzZWxmKSB7XHJcbiAgICBpZiAoc2VsZi5faXNNb3ZhYmxlKSB7XHJcbiAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogVW5leHBlY3RlZCBjYWxsIHRvIGNvbnRpbnVlWWllbGRlZFJlcXVlc3Qgb24gbW92YWJsZSBmZXRjaCc7XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKHNlbGYuX3N0YXRlID09PSBGZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX1JFUVVFU1RfQUJPVVRfVE9fQUJPUlQgfHxcclxuICAgICAgICBzZWxmLl9zdGF0ZSA9PT0gRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19VTkVYUEVDVEVEX0ZBSUxVUkUpIHtcclxuICAgICAgICBcclxuICAgICAgICBzZWxmLl9zY2hlZHVsZXJDYWxsYmFja3Muam9iRG9uZSgpO1xyXG4gICAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIFxyXG4gICAgaWYgKHNlbGYuX3N0YXRlICE9PSBGZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX1JFUVVFU1RfWUlFTERFRCkge1xyXG4gICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IFVuZXhwZWN0ZWQgcmVxdWVzdCBzdGF0ZSBvbiBjb250aW51ZTogJyArIHNlbGYuX3N0YXRlO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBzZWxmLl9zdGF0ZSA9IEZldGNoQ29udGV4dC5GRVRDSF9TVEFUVVNfQUNUSVZFO1xyXG4gICAgc2VsZi5fcmVzb3VyY2UgPSByZXNvdXJjZTtcclxuICAgIFxyXG4gICAgc2VsZi5fc2NoZWR1bGVkSm9ic0xpc3RJdGVyYXRvciA9IHNlbGYuX3NjaGVkdWxlZEpvYnNMaXN0LmFkZChzZWxmKTtcclxuICAgIHNlbGYuX29uRXZlbnQoJ3Jlc3VtZScpO1xyXG59XHJcblxyXG5mdW5jdGlvbiBmZXRjaFlpZWxkZWRCeVNjaGVkdWxlcihzZWxmKSB7XHJcbiAgICB2YXIgbmV4dFN0YXRlO1xyXG4gICAgc2VsZi5fcmVzb3VyY2UgPSBudWxsO1xyXG4gICAgc2VsZi5fc2NoZWR1bGVkSm9ic0xpc3QucmVtb3ZlKHNlbGYuX3NjaGVkdWxlZEpvYnNMaXN0SXRlcmF0b3IpO1xyXG4gICAgaWYgKHNlbGYuc3RhdGUgPT09IEZldGNoQ29udGV4dC5GRVRDSF9TVEFUVVNfUkVRVUVTVF9BQk9VVF9UT19ZSUVMRCkge1xyXG4gICAgICAgIHNlbGYuX3N0YXRlID0gRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19SRVFVRVNUX1lJRUxERUQ7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICAgIHNlbGYuX3N0YXRlID0gRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19VTkVYUEVDVEVEX0ZBSUxVUkU7XHJcbiAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogVW5leHBlY3RlZCByZXF1ZXN0IHN0YXRlIG9uIHlpZWxkIHByb2Nlc3M6ICcgKyBzZWxmLl9zdGF0ZTtcclxuICAgIH1cclxufVxyXG5cclxuZnVuY3Rpb24gZmV0Y2hBYm9ydGVkQnlTY2hlZHVsZXIoc2VsZikge1xyXG4gICAgc2VsZi5fcmVzb3VyY2UgPSBudWxsO1xyXG4gICAgc2VsZi5fZmV0Y2hTdG9wcGVkKC8qaXNBYm9ydGVkPSovdHJ1ZSk7XHJcbn0iLCIndXNlIHN0cmljdCc7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IEZldGNoTWFuYWdlcjtcclxuXHJcbnZhciBpbWFnZUhlbHBlckZ1bmN0aW9ucyA9IHJlcXVpcmUoJ2ltYWdlLWhlbHBlci1mdW5jdGlvbnMuanMnKTtcclxudmFyIEZldGNoQ29udGV4dCA9IHJlcXVpcmUoJ2ZldGNoLWNvbnRleHQuanMnKTtcclxudmFyIExpbmtlZExpc3QgPSByZXF1aXJlKCdsaW5rZWQtbGlzdC5qcycpO1xyXG52YXIgRmV0Y2hlckNsb3NlciA9IHJlcXVpcmUoJ2ZldGNoZXItY2xvc2VyLmpzJyk7XHJcblxyXG4vKiBnbG9iYWwgY29uc29sZTogZmFsc2UgKi9cclxuLyogZ2xvYmFsIFByb21pc2U6IGZhbHNlICovXHJcblxyXG5GZXRjaE1hbmFnZXIuZmV0Y2hlckV4cGVjdGVkTWV0aG9kcyA9IFsnb3BlbicsICdvbicsICdjbG9zZScsICdzdGFydEZldGNoJywgJ3N0YXJ0TW92YWJsZUZldGNoJ107XHJcblxyXG5mdW5jdGlvbiBGZXRjaE1hbmFnZXIoZmV0Y2hlciwgb3B0aW9ucykge1xyXG4gICAgb3B0aW9ucyA9IG9wdGlvbnMgfHwge307XHJcbiAgICBcclxuICAgIHRoaXMuX2ZldGNoZXNMaW1pdCA9IG9wdGlvbnMuZmV0Y2hlc0xpbWl0IHx8IDU7XHJcbiAgICB0aGlzLl9zaG93TG9nID0gb3B0aW9ucy5zaG93TG9nO1xyXG4gICAgXHJcbiAgICAvKmlmICh0aGlzLl9zaG93TG9nKSB7XHJcbiAgICAgICAgLy8gT2xkIElFXHJcbiAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogc2hvd0xvZyBpcyBub3Qgc3VwcG9ydGVkIG9uIHRoaXMgYnJvd3Nlcic7XHJcbiAgICB9Ki9cclxuICAgIFxyXG4gICAgdGhpcy5fc2NoZWR1bGVyID0gbnVsbDtcclxuICAgIHRoaXMuX2ZldGNoUHJpb3JpdGl6ZXIgPSBudWxsO1xyXG4gICAgdGhpcy5fcHJpb3JpdGl6ZXJUeXBlID0gbnVsbDtcclxuICAgICAgICBcclxuICAgIHRoaXMuX21vdmFibGVIYW5kbGVDb3VudGVyID0gMDtcclxuICAgIHRoaXMuX21vdmFibGVIYW5kbGVzID0gW107XHJcbiAgICB0aGlzLl9yZXF1ZXN0QnlJZCA9IFtdO1xyXG4gICAgdGhpcy5faW1hZ2VQYXJhbXMgPSBudWxsO1xyXG4gICAgdGhpcy5fc2NoZWR1bGVkSm9ic0xpc3QgPSBuZXcgTGlua2VkTGlzdCgpO1xyXG4gICAgdGhpcy5fZmV0Y2hlckNsb3NlciA9IG5ldyBGZXRjaGVyQ2xvc2VyKCk7XHJcbiAgICBcclxuICAgIHRoaXMuX2ZldGNoZXIgPSBpbWFnZUhlbHBlckZ1bmN0aW9ucy5nZXRPckNyZWF0ZUluc3RhbmNlKFxyXG4gICAgICAgIGZldGNoZXIsICdmZXRjaGVyJywgRmV0Y2hNYW5hZ2VyLmZldGNoZXJFeHBlY3RlZE1ldGhvZHMpO1xyXG59XHJcblxyXG5GZXRjaE1hbmFnZXIucHJvdG90eXBlLm9wZW4gPSBmdW5jdGlvbiBvcGVuKG9wZW5BcmcpIHtcclxuICAgIHZhciBmZXRjaFNjaGVkdWxlciA9IGltYWdlSGVscGVyRnVuY3Rpb25zLmNyZWF0ZVByaW9yaXRpemVyKFxyXG4gICAgICAgIHRoaXMuX2ZldGNoZXNMaW1pdCxcclxuICAgICAgICB0aGlzLl9wcmlvcml0aXplclR5cGUsXHJcbiAgICAgICAgJ2ZldGNoJyxcclxuICAgICAgICB0aGlzLl9zaG93TG9nKTtcclxuICAgIFxyXG4gICAgdGhpcy5fZmV0Y2hQcmlvcml0aXplciA9IGZldGNoU2NoZWR1bGVyLnByaW9yaXRpemVyO1xyXG4gICAgaWYgKGZldGNoU2NoZWR1bGVyLnByaW9yaXRpemVyICE9PSBudWxsKSB7XHJcbiAgICAgICAgdGhpcy5fc2NoZWR1bGVyID0gbmV3IHJlc291cmNlU2NoZWR1bGVyLlByaW9yaXR5U2NoZWR1bGVyKFxyXG4gICAgICAgICAgICBjcmVhdGVEdW1teVJlc291cmNlLFxyXG4gICAgICAgICAgICB0aGlzLl9mZXRjaGVzTGltaXQsXHJcbiAgICAgICAgICAgIGZldGNoU2NoZWR1bGVyLnByaW9yaXRpemVyLFxyXG4gICAgICAgICAgICBmZXRjaFNjaGVkdWxlci5zY2hlZHVsZXJPcHRpb25zKTtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgICAgdGhpcy5fc2NoZWR1bGVyID0gbmV3IHJlc291cmNlU2NoZWR1bGVyLkxpZm9TY2hlZHVsZXIoXHJcbiAgICAgICAgICAgIGNyZWF0ZUR1bW15UmVzb3VyY2UsXHJcbiAgICAgICAgICAgIHRoaXMuX2ZldGNoZXNMaW1pdCxcclxuICAgICAgICAgICAgZmV0Y2hTY2hlZHVsZXIuc2NoZWR1bGVyT3B0aW9ucyk7XHJcbiAgICB9XHJcblxyXG4gICAgdmFyIHNlbGYgPSB0aGlzO1xyXG4gICAgcmV0dXJuIHRoaXMuX2ZldGNoZXIub3BlbihvcGVuQXJnKS50aGVuKGZ1bmN0aW9uKHJlc3VsdCkge1xyXG4gICAgICAgIHNlbGYuX2ltYWdlUGFyYW1zID0gcmVzdWx0O1xyXG4gICAgICAgIHJldHVybiByZXN1bHQ7XHJcbiAgICB9KTtcclxufTtcclxuXHJcbkZldGNoTWFuYWdlci5wcm90b3R5cGUub24gPSBmdW5jdGlvbiBvbihldmVudCwgY2FsbGJhY2ssIGFyZykge1xyXG4gICAgcmV0dXJuIHRoaXMuX2ZldGNoZXIub24oZXZlbnQsIGNhbGxiYWNrLCBhcmcpO1xyXG59O1xyXG5cclxuRmV0Y2hNYW5hZ2VyLnByb3RvdHlwZS5jbG9zZSA9IGZ1bmN0aW9uIGNsb3NlKCkge1xyXG4gICAgdmFyIHNlbGYgPSB0aGlzO1xyXG4gICAgdmFyIHJlc29sdmVfID0gbnVsbDtcclxuICAgIHZhciByZWplY3RfID0gbnVsbDtcclxuXHJcbiAgICBmdW5jdGlvbiB3YWl0Rm9yQWN0aXZlRmV0Y2hlcyhyZXN1bHQpIHtcclxuICAgICAgICBzZWxmLl9mZXRjaGVyQ2xvc2VyLmNsb3NlKClcclxuICAgICAgICAgICAgLnRoZW4oZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgICAgICAgICByZXNvbHZlXyhyZXN1bHQpO1xyXG4gICAgICAgICAgICB9KS5jYXRjaChyZWplY3RfKTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKGZ1bmN0aW9uKHJlc29sdmUsIHJlamVjdCkge1xyXG4gICAgICAgIHJlc29sdmVfID0gcmVzb2x2ZTtcclxuICAgICAgICByZWplY3RfID0gcmVqZWN0O1xyXG4gICAgICAgIHNlbGYuX2ZldGNoZXIuY2xvc2UoKVxyXG4gICAgICAgICAgICAudGhlbih3YWl0Rm9yQWN0aXZlRmV0Y2hlcylcclxuICAgICAgICAgICAgLmNhdGNoKHJlamVjdCk7XHJcbiAgICB9KTtcclxufTtcclxuXHJcbkZldGNoTWFuYWdlci5wcm90b3R5cGUuc2V0UHJpb3JpdGl6ZXJUeXBlID0gZnVuY3Rpb24gc2V0UHJpb3JpdGl6ZXJUeXBlKHByaW9yaXRpemVyVHlwZSkge1xyXG4gICAgaWYgKHRoaXMuX3NjaGVkdWxlciAhPT0gbnVsbCkge1xyXG4gICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IGNhbm5vdCBzZXQgcHJpb3JpdGl6ZXIgdHlwZSBhZnRlciBGZXRjaE1hbmFnZXIub3BlbigpIGNhbGxlZCc7XHJcbiAgICB9XHJcbiAgICB0aGlzLl9wcmlvcml0aXplclR5cGUgPSBwcmlvcml0aXplclR5cGU7XHJcbn07XHJcblxyXG5GZXRjaE1hbmFnZXIucHJvdG90eXBlLmdldEltYWdlUGFyYW1zID0gZnVuY3Rpb24gZ2V0SW1hZ2VQYXJhbXMoKSB7XHJcbiAgICByZXR1cm4gdGhpcy5faW1hZ2VQYXJhbXM7XHJcbn07XHJcblxyXG5GZXRjaE1hbmFnZXIucHJvdG90eXBlLnNldElzUHJvZ3Jlc3NpdmVSZXF1ZXN0ID0gZnVuY3Rpb24gc2V0SXNQcm9ncmVzc2l2ZVJlcXVlc3QoXHJcbiAgICByZXF1ZXN0SWQsIGlzUHJvZ3Jlc3NpdmUpIHtcclxuICAgIFxyXG4gICAgdmFyIGZldGNoSm9iID0gdGhpcy5fcmVxdWVzdEJ5SWRbcmVxdWVzdElkXTtcclxuICAgIGlmIChmZXRjaEpvYiA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgLy8gVGhpcyBzaXR1YXRpb24gbWlnaHQgb2NjdXIgaWYgcmVxdWVzdCBoYXMgYmVlbiB0ZXJtaW5hdGVkLFxyXG4gICAgICAgIC8vIGJ1dCB1c2VyJ3MgdGVybWluYXRlZENhbGxiYWNrIGhhcyBub3QgYmVlbiBjYWxsZWQgeWV0LiBJdFxyXG4gICAgICAgIC8vIGhhcHBlbnMgb24gV29ya2VyUHJveHlGZXRjaE1hbmFnZXIgZHVlIHRvIHRocmVhZFxyXG4gICAgICAgIC8vIG1lc3NhZ2UgZGVsYXkuXHJcbiAgICAgICAgXHJcbiAgICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGZldGNoSm9iLnNldElzUHJvZ3Jlc3NpdmUoaXNQcm9ncmVzc2l2ZSk7XHJcbn07XHJcblxyXG5GZXRjaE1hbmFnZXIucHJvdG90eXBlLmNyZWF0ZU1vdmFibGVGZXRjaCA9IGZ1bmN0aW9uIGNyZWF0ZU1vdmFibGVGZXRjaCgpIHtcclxuICAgIHZhciBzZWxmID0gdGhpcztcclxuICAgIHJldHVybiBuZXcgUHJvbWlzZShmdW5jdGlvbihyZXNvbHZlLCByZWplY3QpIHtcclxuICAgICAgICB2YXIgbW92YWJsZUhhbmRsZSA9ICsrc2VsZi5fbW92YWJsZUhhbmRsZUNvdW50ZXI7XHJcbiAgICAgICAgc2VsZi5fbW92YWJsZUhhbmRsZXNbbW92YWJsZUhhbmRsZV0gPSBuZXcgRmV0Y2hDb250ZXh0KFxyXG4gICAgICAgICAgICBzZWxmLl9mZXRjaGVyLFxyXG4gICAgICAgICAgICBzZWxmLl9mZXRjaGVyQ2xvc2VyLFxyXG4gICAgICAgICAgICBzZWxmLl9zY2hlZHVsZXIsXHJcbiAgICAgICAgICAgIHNlbGYuX3NjaGVkdWxlZEpvYnNMaXN0LFxyXG4gICAgICAgICAgICBGZXRjaENvbnRleHQuRkVUQ0hfVFlQRV9NT1ZBQkxFLFxyXG4gICAgICAgICAgICAvKmNvbnRleHRWYXJzPSovbnVsbCk7XHJcblxyXG4gICAgICAgIHJlc29sdmUobW92YWJsZUhhbmRsZSk7XHJcbiAgICB9KTtcclxufTtcclxuXHJcbkZldGNoTWFuYWdlci5wcm90b3R5cGUubW92ZUZldGNoID0gZnVuY3Rpb24gbW92ZUZldGNoKFxyXG4gICAgbW92YWJsZUhhbmRsZSwgaW1hZ2VQYXJ0UGFyYW1zKSB7XHJcbiAgICBcclxuICAgIHZhciBtb3ZhYmxlID0gdGhpcy5fbW92YWJsZUhhbmRsZXNbbW92YWJsZUhhbmRsZV07XHJcbiAgICBtb3ZhYmxlLmZldGNoKGltYWdlUGFydFBhcmFtcyk7XHJcbn07XHJcblxyXG5GZXRjaE1hbmFnZXIucHJvdG90eXBlLmNyZWF0ZVJlcXVlc3QgPSBmdW5jdGlvbiBjcmVhdGVSZXF1ZXN0KFxyXG4gICAgcmVxdWVzdElkLCBpbWFnZVBhcnRQYXJhbXMpIHtcclxuICAgIFxyXG4gICAgdmFyIGNvbnRleHRWYXJzID0ge1xyXG4gICAgICAgIHByb2dyZXNzaXZlU3RhZ2VzRG9uZTogMCxcclxuICAgICAgICBpc0xhc3RDYWxsYmFja0NhbGxlZFdpdGhvdXRMb3dRdWFsaXR5TGltaXQ6IGZhbHNlLFxyXG4gICAgICAgIHJlcXVlc3RJZDogcmVxdWVzdElkLFxyXG4gICAgICAgIGZldGNoSm9iOiBudWxsLFxyXG4gICAgICAgIHNlbGY6IHRoaXNcclxuICAgIH07XHJcbiAgICBcclxuICAgIHZhciBmZXRjaFR5cGUgPSAvKmlzT25seVdhaXRGb3JEYXRhID9cclxuICAgICAgICBGZXRjaENvbnRleHQuRkVUQ0hfVFlQRV9PTkxZX1dBSVRfRk9SX0RBVEEgOiAqL0ZldGNoQ29udGV4dC5GRVRDSF9UWVBFX1JFUVVFU1Q7XHJcbiAgICBcclxuICAgIHZhciBmZXRjaEpvYiA9IG5ldyBGZXRjaENvbnRleHQoXHJcbiAgICAgICAgdGhpcy5fZmV0Y2hlcixcclxuICAgICAgICB0aGlzLl9mZXRjaGVyQ2xvc2VyLFxyXG4gICAgICAgIHRoaXMuX3NjaGVkdWxlcixcclxuICAgICAgICB0aGlzLl9zY2hlZHVsZWRKb2JzTGlzdCxcclxuICAgICAgICBmZXRjaFR5cGUsXHJcbiAgICAgICAgY29udGV4dFZhcnMpO1xyXG4gICAgXHJcbiAgICBjb250ZXh0VmFycy5mZXRjaEpvYiA9IGZldGNoSm9iO1xyXG4gICAgXHJcbiAgICBpZiAodGhpcy5fcmVxdWVzdEJ5SWRbcmVxdWVzdElkXSAhPT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogRHVwbGljYXRpb24gb2YgcmVxdWVzdElkICcgKyByZXF1ZXN0SWQ7XHJcbiAgICB9IGVsc2UgaWYgKHJlcXVlc3RJZCAhPT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgdGhpcy5fcmVxdWVzdEJ5SWRbcmVxdWVzdElkXSA9IGZldGNoSm9iO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBmZXRjaEpvYi5vbigndGVybWluYXRlZCcsIGludGVybmFsVGVybWluYXRlZENhbGxiYWNrKTtcclxuICAgIFxyXG4gICAgZmV0Y2hKb2IuZmV0Y2goaW1hZ2VQYXJ0UGFyYW1zKTtcclxuICAgIFxyXG4gICAgdGhpcy5feWllbGRGZXRjaEpvYnMoKTtcclxufTtcclxuXHJcbkZldGNoTWFuYWdlci5wcm90b3R5cGUubWFudWFsQWJvcnRSZXF1ZXN0ID0gZnVuY3Rpb24gbWFudWFsQWJvcnRSZXF1ZXN0KFxyXG4gICAgcmVxdWVzdElkKSB7XHJcbiAgICBcclxuICAgIHZhciBmZXRjaEpvYiA9IHRoaXMuX3JlcXVlc3RCeUlkW3JlcXVlc3RJZF07XHJcbiAgICBcclxuICAgIGlmIChmZXRjaEpvYiA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgLy8gVGhpcyBzaXR1YXRpb24gbWlnaHQgb2NjdXIgaWYgcmVxdWVzdCBoYXMgYmVlbiB0ZXJtaW5hdGVkLFxyXG4gICAgICAgIC8vIGJ1dCB1c2VyJ3MgdGVybWluYXRlZENhbGxiYWNrIGhhcyBub3QgYmVlbiBjYWxsZWQgeWV0LiBJdFxyXG4gICAgICAgIC8vIGhhcHBlbnMgb24gV29ya2VyUHJveHlGZXRjaE1hbmFnZXIgZHVlIHRvIHdlYiB3b3JrZXJcclxuICAgICAgICAvLyBtZXNzYWdlIGRlbGF5LlxyXG4gICAgICAgIFxyXG4gICAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIFxyXG4gICAgZmV0Y2hKb2IubWFudWFsQWJvcnRSZXF1ZXN0KCk7XHJcbiAgICBkZWxldGUgdGhpcy5fcmVxdWVzdEJ5SWRbcmVxdWVzdElkXTtcclxufTtcclxuXHJcbkZldGNoTWFuYWdlci5wcm90b3R5cGUuc2V0RmV0Y2hQcmlvcml0aXplckRhdGEgPVxyXG4gICAgZnVuY3Rpb24gc2V0RmV0Y2hQcmlvcml0aXplckRhdGEocHJpb3JpdGl6ZXJEYXRhKSB7XHJcblxyXG4gICAgaWYgKHRoaXMuX2ZldGNoUHJpb3JpdGl6ZXIgPT09IG51bGwpIHtcclxuICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBObyBmZXRjaCBwcmlvcml0aXplciBoYXMgYmVlbiBzZXQnO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBpZiAodGhpcy5fc2hvd0xvZykge1xyXG4gICAgICAgIGNvbnNvbGUubG9nKCdzZXRGZXRjaFByaW9yaXRpemVyRGF0YSgnICsgcHJpb3JpdGl6ZXJEYXRhICsgJyknKTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgcHJpb3JpdGl6ZXJEYXRhLmltYWdlID0gdGhpcztcclxuICAgIHRoaXMuX2ZldGNoUHJpb3JpdGl6ZXIuc2V0UHJpb3JpdGl6ZXJEYXRhKHByaW9yaXRpemVyRGF0YSk7XHJcbiAgICB0aGlzLl95aWVsZEZldGNoSm9icygpO1xyXG59O1xyXG5cclxuRmV0Y2hNYW5hZ2VyLnByb3RvdHlwZS5feWllbGRGZXRjaEpvYnMgPSBmdW5jdGlvbiB5aWVsZEZldGNoSm9icygpIHtcclxuICAgIHZhciBpdGVyYXRvciA9IHRoaXMuX3NjaGVkdWxlZEpvYnNMaXN0LmdldEZpcnN0SXRlcmF0b3IoKTtcclxuICAgIHdoaWxlIChpdGVyYXRvciAhPT0gbnVsbCkge1xyXG4gICAgICAgIHZhciBmZXRjaEpvYiA9IHRoaXMuX3NjaGVkdWxlZEpvYnNMaXN0LmdldFZhbHVlKGl0ZXJhdG9yKTtcclxuICAgICAgICBpdGVyYXRvciA9IHRoaXMuX3NjaGVkdWxlZEpvYnNMaXN0LmdldE5leHRJdGVyYXRvcihpdGVyYXRvcik7XHJcbiAgICAgICAgXHJcbiAgICAgICAgZmV0Y2hKb2IuY2hlY2tJZlNob3VsZFlpZWxkKCk7XHJcbiAgICB9XHJcbn07XHJcblxyXG5mdW5jdGlvbiBpbnRlcm5hbFRlcm1pbmF0ZWRDYWxsYmFjayhjb250ZXh0VmFycykge1xyXG4gICAgZGVsZXRlIGNvbnRleHRWYXJzLnNlbGYuX3JlcXVlc3RCeUlkW2NvbnRleHRWYXJzLnJlcXVlc3RJZF07XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGNyZWF0ZUR1bW15UmVzb3VyY2UoKSB7XHJcbiAgICByZXR1cm4ge307XHJcbn0iLCIndXNlIHN0cmljdCc7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IEZldGNoZXJDbG9zZXI7XHJcblxyXG4vKiBnbG9iYWwgUHJvbWlzZTogZmFsc2UgKi9cclxuXHJcbmZ1bmN0aW9uIEZldGNoZXJDbG9zZXIoKSB7XHJcbiAgICB0aGlzLl9yZXNvbHZlQ2xvc2UgPSBudWxsO1xyXG4gICAgdGhpcy5fYWN0aXZlRmV0Y2hlcyA9IDA7XHJcbiAgICB0aGlzLl9pc0Nsb3NlZCA9IGZhbHNlO1xyXG59XHJcblxyXG5GZXRjaGVyQ2xvc2VyLnByb3RvdHlwZS5jaGFuZ2VBY3RpdmVGZXRjaGVzQ291bnQgPSBmdW5jdGlvbiBjaGFuZ2VBY3RpdmVGZXRjaGVzQ291bnQoYWRkVmFsdWUpIHtcclxuICAgIGlmICh0aGlzLl9pc0Nsb3NlZCkge1xyXG4gICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IFVuZXhwZWN0ZWQgY2hhbmdlIG9mIGFjdGl2ZSBmZXRjaGVzIGNvdW50IGFmdGVyIGNsb3NlZCc7XHJcbiAgICB9XHJcbiAgICB0aGlzLl9hY3RpdmVGZXRjaGVzICs9IGFkZFZhbHVlO1xyXG4gICAgXHJcbiAgICBpZiAodGhpcy5fYWN0aXZlRmV0Y2hlcyA9PT0gMCAmJiB0aGlzLl9yZXNvbHZlQ2xvc2UpIHtcclxuICAgICAgICB0aGlzLl9pc0Nsb3NlZCA9IHRydWU7XHJcbiAgICAgICAgdGhpcy5fcmVzb2x2ZUNsb3NlKCk7XHJcbiAgICB9XHJcbn07XHJcblxyXG5GZXRjaGVyQ2xvc2VyLnByb3RvdHlwZS5pc0Nsb3NlUmVxdWVzdGVkID0gZnVuY3Rpb24gaXNDbG9zZVJlcXVlc3RlZCgpIHtcclxuICAgIHJldHVybiB0aGlzLl9pc0Nsb3NlZCB8fCAodGhpcy5fcmVzb2x2ZUNsb3NlICE9PSBudWxsKTtcclxufTtcclxuXHJcbkZldGNoZXJDbG9zZXIucHJvdG90eXBlLmNsb3NlID0gZnVuY3Rpb24gY2xvc2UoKSB7XHJcbiAgICBpZiAodGhpcy5pc0Nsb3NlUmVxdWVzdGVkKCkpIHtcclxuICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBjbG9zZSgpIGNhbGxlZCB0d2ljZSc7XHJcbiAgICB9XHJcbiAgICB2YXIgc2VsZiA9IHRoaXM7XHJcbiAgICByZXR1cm4gbmV3IFByb21pc2UoZnVuY3Rpb24ocmVzb2x2ZSwgcmVqZWN0KSB7XHJcbiAgICAgICAgc2VsZi5fcmVzb2x2ZUNsb3NlID0gcmVzb2x2ZTtcclxuICAgICAgICBpZiAoc2VsZi5fYWN0aXZlRmV0Y2hlcyA9PT0gMCkge1xyXG4gICAgICAgICAgICBzZWxmLl9yZXNvbHZlQ2xvc2UoKTtcclxuICAgICAgICB9XHJcbiAgICB9KTtcclxufTsiLCIndXNlIHN0cmljdCc7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IEZydXN0dW1SZXF1ZXN0c1ByaW9yaXRpemVyO1xyXG52YXIgUFJJT1JJVFlfQUJPUlRfTk9UX0lOX0ZSVVNUVU0gPSAtMTtcclxudmFyIFBSSU9SSVRZX0NBTENVTEFUSU9OX0ZBSUxFRCA9IDA7XHJcbnZhciBQUklPUklUWV9UT09fR09PRF9SRVNPTFVUSU9OID0gMTtcclxudmFyIFBSSU9SSVRZX05PVF9JTl9GUlVTVFVNID0gMjtcclxudmFyIFBSSU9SSVRZX0xPV0VSX1JFU09MVVRJT04gPSAzO1xyXG5cclxudmFyIFBSSU9SSVRZX01JTk9SSVRZX0lOX0ZSVVNUVU0gPSA0O1xyXG52YXIgUFJJT1JJVFlfUEFSVElBTF9JTl9GUlVTVFVNID0gNTtcclxudmFyIFBSSU9SSVRZX01BSk9SSVRZX0lOX0ZSVVNUVU0gPSA2O1xyXG52YXIgUFJJT1JJVFlfRlVMTFlfSU5fRlJVU1RVTSA9IDc7XHJcblxyXG52YXIgQUREX1BSSU9SSVRZX1RPX0xPV19RVUFMSVRZID0gNTtcclxuXHJcbnZhciBQUklPUklUWV9ISUdIRVNUID0gMTM7XHJcblxyXG52YXIgbG9nMiA9IE1hdGgubG9nKDIpO1xyXG5cclxuZnVuY3Rpb24gRnJ1c3R1bVJlcXVlc3RzUHJpb3JpdGl6ZXIoXHJcbiAgICBpc0Fib3J0UmVxdWVzdHNOb3RJbkZydXN0dW0sIGlzUHJpb3JpdGl6ZUxvd1Byb2dyZXNzaXZlU3RhZ2UpIHtcclxuICAgIFxyXG4gICAgdGhpcy5fZnJ1c3R1bURhdGEgPSBudWxsO1xyXG4gICAgdGhpcy5faXNBYm9ydFJlcXVlc3RzTm90SW5GcnVzdHVtID0gaXNBYm9ydFJlcXVlc3RzTm90SW5GcnVzdHVtO1xyXG4gICAgdGhpcy5faXNQcmlvcml0aXplTG93UHJvZ3Jlc3NpdmVTdGFnZSA9IGlzUHJpb3JpdGl6ZUxvd1Byb2dyZXNzaXZlU3RhZ2U7XHJcbn1cclxuXHJcbk9iamVjdC5kZWZpbmVQcm9wZXJ0eShcclxuICAgIEZydXN0dW1SZXF1ZXN0c1ByaW9yaXRpemVyLnByb3RvdHlwZSwgJ21pbmltYWxMb3dRdWFsaXR5UHJpb3JpdHknLCB7XHJcbiAgICAgICAgZ2V0OiBmdW5jdGlvbiBtaW5pbWFsTG93UXVhbGl0eVByaW9yaXR5KCkge1xyXG4gICAgICAgICAgICByZXR1cm4gUFJJT1JJVFlfTUlOT1JJVFlfSU5fRlJVU1RVTSArIEFERF9QUklPUklUWV9UT19MT1dfUVVBTElUWTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbik7XHJcbiAgICBcclxuRnJ1c3R1bVJlcXVlc3RzUHJpb3JpdGl6ZXIucHJvdG90eXBlLnNldFByaW9yaXRpemVyRGF0YSA9IGZ1bmN0aW9uIHNldFByaW9yaXRpemVyRGF0YShkYXRhKSB7XHJcbiAgICB0aGlzLl9mcnVzdHVtRGF0YSA9IGRhdGE7XHJcbn07XHJcblxyXG5GcnVzdHVtUmVxdWVzdHNQcmlvcml0aXplci5wcm90b3R5cGUuZ2V0UHJpb3JpdHkgPSBmdW5jdGlvbiBnZXRQcmlvcml0eShqb2JDb250ZXh0KSB7XHJcbiAgICB2YXIgaW1hZ2VQYXJ0UGFyYW1zID0gam9iQ29udGV4dC5pbWFnZVBhcnRQYXJhbXM7XHJcbiAgICBpZiAoaW1hZ2VQYXJ0UGFyYW1zLnJlcXVlc3RQcmlvcml0eURhdGEub3ZlcnJpZGVIaWdoZXN0UHJpb3JpdHkpIHtcclxuICAgICAgICByZXR1cm4gUFJJT1JJVFlfSElHSEVTVDtcclxuICAgIH1cclxuXHJcbiAgICB2YXIgcHJpb3JpdHkgPSB0aGlzLl9nZXRQcmlvcml0eUludGVybmFsKGltYWdlUGFydFBhcmFtcyk7XHJcbiAgICB2YXIgaXNJbkZydXN0dW0gPSBwcmlvcml0eSA+PSBQUklPUklUWV9NSU5PUklUWV9JTl9GUlVTVFVNO1xyXG4gICAgXHJcbiAgICBpZiAodGhpcy5faXNBYm9ydFJlcXVlc3RzTm90SW5GcnVzdHVtICYmICFpc0luRnJ1c3R1bSkge1xyXG4gICAgICAgIHJldHVybiBQUklPUklUWV9BQk9SVF9OT1RfSU5fRlJVU1RVTTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgdmFyIHByaW9yaXRpemVMb3dQcm9ncmVzc2l2ZVN0YWdlID0gMDtcclxuICAgIFxyXG4gICAgaWYgKHRoaXMuX2lzUHJpb3JpdGl6ZUxvd1Byb2dyZXNzaXZlU3RhZ2UgJiYgaXNJbkZydXN0dW0pIHtcclxuICAgICAgICBwcmlvcml0aXplTG93UHJvZ3Jlc3NpdmVTdGFnZSA9XHJcbiAgICAgICAgICAgIGpvYkNvbnRleHQucHJvZ3Jlc3NpdmVTdGFnZXNEb25lID09PSAwID8gQUREX1BSSU9SSVRZX1RPX0xPV19RVUFMSVRZIDpcclxuICAgICAgICAgICAgam9iQ29udGV4dC5wcm9ncmVzc2l2ZVN0YWdlc0RvbmUgPT09IDEgPyAxIDpcclxuICAgICAgICAgICAgMDtcclxuICAgIH1cclxuICAgIFxyXG4gICAgcmV0dXJuIHByaW9yaXR5ICsgcHJpb3JpdGl6ZUxvd1Byb2dyZXNzaXZlU3RhZ2U7XHJcbn07XHJcblxyXG5GcnVzdHVtUmVxdWVzdHNQcmlvcml0aXplci5wcm90b3R5cGUuX2dldFByaW9yaXR5SW50ZXJuYWwgPSBmdW5jdGlvbiBnZXRQcmlvcml0eUludGVybmFsKGltYWdlUGFydFBhcmFtcykge1xyXG4gICAgaWYgKHRoaXMuX2ZydXN0dW1EYXRhID09PSBudWxsKSB7XHJcbiAgICAgICAgcmV0dXJuIFBSSU9SSVRZX0NBTENVTEFUSU9OX0ZBSUxFRDtcclxuICAgIH1cclxuICAgIFxyXG4gICAgaWYgKHRoaXMuX2ZydXN0dW1EYXRhLmltYWdlUmVjdGFuZ2xlID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBObyBpbWFnZVJlY3RhbmdsZSBpbmZvcm1hdGlvbiBwYXNzZWQgaW4gc2V0UHJpb3JpdGl6ZXJEYXRhJztcclxuICAgIH1cclxuICAgIFxyXG4gICAgdmFyIGV4YWN0RnJ1c3R1bUxldmVsID0gdGhpcy5fZnJ1c3R1bURhdGEuZXhhY3RsZXZlbDtcclxuICAgIFxyXG4gICAgaWYgKHRoaXMuX2ZydXN0dW1EYXRhLmV4YWN0bGV2ZWwgPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IE5vIGV4YWN0bGV2ZWwgaW5mb3JtYXRpb24gcGFzc2VkIGluICcgK1xyXG4gICAgICAgICAgICAnc2V0UHJpb3JpdGl6ZXJEYXRhLiBVc2UgbnVsbCBpZiB1bmtub3duJztcclxuICAgIH1cclxuICAgIFxyXG4gICAgdmFyIHRpbGVXZXN0ID0gdGhpcy5fcGl4ZWxUb0NhcnRvZ3JhcGhpY1goXHJcbiAgICAgICAgaW1hZ2VQYXJ0UGFyYW1zLm1pblgsIGltYWdlUGFydFBhcmFtcyk7XHJcbiAgICB2YXIgdGlsZUVhc3QgPSB0aGlzLl9waXhlbFRvQ2FydG9ncmFwaGljWChcclxuICAgICAgICBpbWFnZVBhcnRQYXJhbXMubWF4WEV4Y2x1c2l2ZSwgaW1hZ2VQYXJ0UGFyYW1zKTtcclxuICAgIHZhciB0aWxlTm9ydGggPSB0aGlzLl9waXhlbFRvQ2FydG9ncmFwaGljWShcclxuICAgICAgICBpbWFnZVBhcnRQYXJhbXMubWluWSwgaW1hZ2VQYXJ0UGFyYW1zKTtcclxuICAgIHZhciB0aWxlU291dGggPSB0aGlzLl9waXhlbFRvQ2FydG9ncmFwaGljWShcclxuICAgICAgICBpbWFnZVBhcnRQYXJhbXMubWF4WUV4Y2x1c2l2ZSwgaW1hZ2VQYXJ0UGFyYW1zKTtcclxuICAgIFxyXG4gICAgdmFyIHRpbGVQaXhlbHNXaWR0aCA9XHJcbiAgICAgICAgaW1hZ2VQYXJ0UGFyYW1zLm1heFhFeGNsdXNpdmUgLSBpbWFnZVBhcnRQYXJhbXMubWluWDtcclxuICAgIHZhciB0aWxlUGl4ZWxzSGVpZ2h0ID1cclxuICAgICAgICBpbWFnZVBhcnRQYXJhbXMubWF4WUV4Y2x1c2l2ZSAtIGltYWdlUGFydFBhcmFtcy5taW5ZO1xyXG4gICAgXHJcbiAgICB2YXIgcmVxdWVzdFRvRnJ1c3R1bVJlc29sdXRpb25SYXRpbztcclxuICAgIHZhciB0aWxlTGV2ZWwgPSBpbWFnZVBhcnRQYXJhbXMubGV2ZWwgfHwgMDtcclxuICAgIGlmIChleGFjdEZydXN0dW1MZXZlbCA9PT0gbnVsbCkge1xyXG4gICAgICAgIHZhciB0aWxlUmVzb2x1dGlvblggPSB0aWxlUGl4ZWxzV2lkdGggLyAodGlsZUVhc3QgLSB0aWxlV2VzdCk7XHJcbiAgICAgICAgdmFyIHRpbGVSZXNvbHV0aW9uWSA9IHRpbGVQaXhlbHNIZWlnaHQgLyAodGlsZU5vcnRoIC0gdGlsZVNvdXRoKTtcclxuICAgICAgICB2YXIgdGlsZVJlc29sdXRpb24gPSBNYXRoLm1heCh0aWxlUmVzb2x1dGlvblgsIHRpbGVSZXNvbHV0aW9uWSk7XHJcbiAgICAgICAgdmFyIGZydXN0dW1SZXNvbHV0aW9uID0gdGhpcy5fZnJ1c3R1bURhdGEucmVzb2x1dGlvbjtcclxuICAgICAgICByZXF1ZXN0VG9GcnVzdHVtUmVzb2x1dGlvblJhdGlvID0gdGlsZVJlc29sdXRpb24gLyBmcnVzdHVtUmVzb2x1dGlvbjtcclxuICAgIFxyXG4gICAgICAgIGlmIChyZXF1ZXN0VG9GcnVzdHVtUmVzb2x1dGlvblJhdGlvID4gMikge1xyXG4gICAgICAgICAgICByZXR1cm4gUFJJT1JJVFlfVE9PX0dPT0RfUkVTT0xVVElPTjtcclxuICAgICAgICB9XHJcbiAgICB9IGVsc2UgaWYgKHRpbGVMZXZlbCA8IGV4YWN0RnJ1c3R1bUxldmVsKSB7XHJcbiAgICAgICAgcmV0dXJuIFBSSU9SSVRZX1RPT19HT09EX1JFU09MVVRJT047XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHZhciBmcnVzdHVtUmVjdGFuZ2xlID0gdGhpcy5fZnJ1c3R1bURhdGEucmVjdGFuZ2xlO1xyXG4gICAgdmFyIGludGVyc2VjdGlvbldlc3QgPSBNYXRoLm1heChmcnVzdHVtUmVjdGFuZ2xlLndlc3QsIHRpbGVXZXN0KTtcclxuICAgIHZhciBpbnRlcnNlY3Rpb25FYXN0ID0gTWF0aC5taW4oZnJ1c3R1bVJlY3RhbmdsZS5lYXN0LCB0aWxlRWFzdCk7XHJcbiAgICB2YXIgaW50ZXJzZWN0aW9uU291dGggPSBNYXRoLm1heChmcnVzdHVtUmVjdGFuZ2xlLnNvdXRoLCB0aWxlU291dGgpO1xyXG4gICAgdmFyIGludGVyc2VjdGlvbk5vcnRoID0gTWF0aC5taW4oZnJ1c3R1bVJlY3RhbmdsZS5ub3J0aCwgdGlsZU5vcnRoKTtcclxuICAgIFxyXG4gICAgdmFyIGludGVyc2VjdGlvbldpZHRoID0gaW50ZXJzZWN0aW9uRWFzdCAtIGludGVyc2VjdGlvbldlc3Q7XHJcbiAgICB2YXIgaW50ZXJzZWN0aW9uSGVpZ2h0ID0gaW50ZXJzZWN0aW9uTm9ydGggLSBpbnRlcnNlY3Rpb25Tb3V0aDtcclxuICAgIFxyXG4gICAgaWYgKGludGVyc2VjdGlvbldpZHRoIDwgMCB8fCBpbnRlcnNlY3Rpb25IZWlnaHQgPCAwKSB7XHJcbiAgICAgICAgcmV0dXJuIFBSSU9SSVRZX05PVF9JTl9GUlVTVFVNO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBpZiAoZXhhY3RGcnVzdHVtTGV2ZWwgIT09IG51bGwpIHtcclxuICAgICAgICBpZiAodGlsZUxldmVsID4gZXhhY3RGcnVzdHVtTGV2ZWwpIHtcclxuICAgICAgICAgICAgcmV0dXJuIFBSSU9SSVRZX0xPV0VSX1JFU09MVVRJT047XHJcbiAgICAgICAgfVxyXG4gICAgfSBlbHNlIGlmICh0aWxlTGV2ZWwgPiAwICYmIHJlcXVlc3RUb0ZydXN0dW1SZXNvbHV0aW9uUmF0aW8gPCAwLjI1KSB7XHJcbiAgICAgICAgcmV0dXJuIFBSSU9SSVRZX0xPV0VSX1JFU09MVVRJT047XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHZhciBpbnRlcnNlY3Rpb25BcmVhID0gaW50ZXJzZWN0aW9uV2lkdGggKiBpbnRlcnNlY3Rpb25IZWlnaHQ7XHJcbiAgICB2YXIgdGlsZUFyZWEgPSAodGlsZUVhc3QgLSB0aWxlV2VzdCkgKiAodGlsZU5vcnRoIC0gdGlsZVNvdXRoKTtcclxuICAgIHZhciBwYXJ0SW5GcnVzdHVtID0gaW50ZXJzZWN0aW9uQXJlYSAvIHRpbGVBcmVhO1xyXG4gICAgXHJcbiAgICBpZiAocGFydEluRnJ1c3R1bSA+IDAuOTkpIHtcclxuICAgICAgICByZXR1cm4gUFJJT1JJVFlfRlVMTFlfSU5fRlJVU1RVTTtcclxuICAgIH0gZWxzZSBpZiAocGFydEluRnJ1c3R1bSA+IDAuNykge1xyXG4gICAgICAgIHJldHVybiBQUklPUklUWV9NQUpPUklUWV9JTl9GUlVTVFVNO1xyXG4gICAgfSBlbHNlIGlmIChwYXJ0SW5GcnVzdHVtID4gMC4zKSB7XHJcbiAgICAgICAgcmV0dXJuIFBSSU9SSVRZX1BBUlRJQUxfSU5fRlJVU1RVTTtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgICAgcmV0dXJuIFBSSU9SSVRZX01JTk9SSVRZX0lOX0ZSVVNUVU07XHJcbiAgICB9XHJcbn07XHJcblxyXG5GcnVzdHVtUmVxdWVzdHNQcmlvcml0aXplci5wcm90b3R5cGUuX3BpeGVsVG9DYXJ0b2dyYXBoaWNYID0gZnVuY3Rpb24gcGl4ZWxUb0NhcnRvZ3JhcGhpY1goXHJcbiAgICB4LCBpbWFnZVBhcnRQYXJhbXMpIHtcclxuICAgIFxyXG4gICAgdmFyIHJlbGF0aXZlWCA9IHggLyBpbWFnZVBhcnRQYXJhbXMubGV2ZWxXaWR0aDtcclxuICAgIFxyXG4gICAgdmFyIGltYWdlUmVjdGFuZ2xlID0gdGhpcy5fZnJ1c3R1bURhdGEuaW1hZ2VSZWN0YW5nbGU7XHJcbiAgICB2YXIgcmVjdGFuZ2xlV2lkdGggPSBpbWFnZVJlY3RhbmdsZS5lYXN0IC0gaW1hZ2VSZWN0YW5nbGUud2VzdDtcclxuICAgIFxyXG4gICAgdmFyIHhQcm9qZWN0ZWQgPSBpbWFnZVJlY3RhbmdsZS53ZXN0ICsgcmVsYXRpdmVYICogcmVjdGFuZ2xlV2lkdGg7XHJcbiAgICByZXR1cm4geFByb2plY3RlZDtcclxufTtcclxuXHJcbkZydXN0dW1SZXF1ZXN0c1ByaW9yaXRpemVyLnByb3RvdHlwZS5fcGl4ZWxUb0NhcnRvZ3JhcGhpY1kgPSBmdW5jdGlvbiB0aWxlVG9DYXJ0b2dyYXBoaWNZKFxyXG4gICAgeSwgaW1hZ2VQYXJ0UGFyYW1zLCBpbWFnZSkge1xyXG4gICAgXHJcbiAgICB2YXIgcmVsYXRpdmVZID0geSAvIGltYWdlUGFydFBhcmFtcy5sZXZlbEhlaWdodDtcclxuICAgIFxyXG4gICAgdmFyIGltYWdlUmVjdGFuZ2xlID0gdGhpcy5fZnJ1c3R1bURhdGEuaW1hZ2VSZWN0YW5nbGU7XHJcbiAgICB2YXIgcmVjdGFuZ2xlSGVpZ2h0ID0gaW1hZ2VSZWN0YW5nbGUubm9ydGggLSBpbWFnZVJlY3RhbmdsZS5zb3V0aDtcclxuICAgIFxyXG4gICAgdmFyIHlQcm9qZWN0ZWQgPSBpbWFnZVJlY3RhbmdsZS5ub3J0aCAtIHJlbGF0aXZlWSAqIHJlY3RhbmdsZUhlaWdodDtcclxuICAgIHJldHVybiB5UHJvamVjdGVkO1xyXG59OyIsIid1c2Ugc3RyaWN0JztcclxuXHJcbnZhciBGcnVzdHVtUmVxdWVzdHNQcmlvcml0aXplciA9IHJlcXVpcmUoJ2ZydXN0dW0tcmVxdWVzdHMtcHJpb3JpdGl6ZXIuanMnKTtcclxuXHJcbm1vZHVsZS5leHBvcnRzID0ge1xyXG4gICAgY2FsY3VsYXRlRnJ1c3R1bTJERnJvbUJvdW5kczogY2FsY3VsYXRlRnJ1c3R1bTJERnJvbUJvdW5kcyxcclxuICAgIGNyZWF0ZVByaW9yaXRpemVyOiBjcmVhdGVQcmlvcml0aXplcixcclxuICAgIGZpeEJvdW5kczogZml4Qm91bmRzLFxyXG4gICAgZW5zdXJlTGV2ZWxDYWxjdWxhdG9yOiBlbnN1cmVMZXZlbENhbGN1bGF0b3IsXHJcbiAgICBhbGlnblBhcmFtc1RvVGlsZXNBbmRMZXZlbDogYWxpZ25QYXJhbXNUb1RpbGVzQW5kTGV2ZWwsXHJcbiAgICBnZXRPckNyZWF0ZUluc3RhbmNlOiBnZXRPckNyZWF0ZUluc3RhbmNlLFxyXG4gICAgaXNJbmRpcmVjdENyZWF0aW9uTmVlZGVkOiBpc0luZGlyZWN0Q3JlYXRpb25OZWVkZWQsXHJcbiAgICByZW5kZXJUb0NhbnZhczogcmVuZGVyVG9DYW52YXNcclxufTtcclxuXHJcbi8vIEF2b2lkIGpzaGludCBlcnJvclxyXG4vKiBnbG9iYWwgc2VsZjogZmFsc2UgKi9cclxuLyogZ2xvYmFsIGdsb2JhbHM6IGZhbHNlICovXHJcbiAgICBcclxuLy92YXIgbG9nMiA9IE1hdGgubG9nKDIpO1xyXG5cclxuZnVuY3Rpb24gY2FsY3VsYXRlRnJ1c3R1bTJERnJvbUJvdW5kcyhcclxuICAgIGJvdW5kcywgc2NyZWVuU2l6ZSkge1xyXG4gICAgXHJcbiAgICB2YXIgc2NyZWVuUGl4ZWxzID1cclxuICAgICAgICBzY3JlZW5TaXplLnggKiBzY3JlZW5TaXplLnggKyBzY3JlZW5TaXplLnkgKiBzY3JlZW5TaXplLnk7XHJcbiAgICBcclxuICAgIHZhciBib3VuZHNXaWR0aCA9IGJvdW5kcy5lYXN0IC0gYm91bmRzLndlc3Q7XHJcbiAgICB2YXIgYm91bmRzSGVpZ2h0ID0gYm91bmRzLm5vcnRoIC0gYm91bmRzLnNvdXRoO1xyXG4gICAgdmFyIGJvdW5kc0Rpc3RhbmNlID1cclxuICAgICAgICBib3VuZHNXaWR0aCAqIGJvdW5kc1dpZHRoICsgYm91bmRzSGVpZ2h0ICogYm91bmRzSGVpZ2h0O1xyXG4gICAgXHJcbiAgICB2YXIgcmVzb2x1dGlvbiA9IE1hdGguc3FydChzY3JlZW5QaXhlbHMgLyBib3VuZHNEaXN0YW5jZSk7XHJcbiAgICBcclxuICAgIHZhciBmcnVzdHVtRGF0YSA9IHtcclxuICAgICAgICByZXNvbHV0aW9uOiByZXNvbHV0aW9uLFxyXG4gICAgICAgIHJlY3RhbmdsZTogYm91bmRzLFxyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIFJlZHVuZGFudCwgYnV0IGVuYWJsZXMgdG8gYXZvaWQgYWxyZWFkeS1wZXJmb3JtZWQgY2FsY3VsYXRpb25cclxuICAgICAgICBzY3JlZW5TaXplOiBzY3JlZW5TaXplXHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICByZXR1cm4gZnJ1c3R1bURhdGE7XHJcbn1cclxuICAgIFxyXG5mdW5jdGlvbiBjcmVhdGVQcmlvcml0aXplcihcclxuICAgIHJlc291cmNlTGltaXQsIHByaW9yaXRpemVyVHlwZSwgc2NoZWR1bGVyTmFtZSwgc2hvd0xvZykge1xyXG4gICAgXHJcbiAgICB2YXIgcHJpb3JpdGl6ZXI7XHJcbiAgICB2YXIgbGltaXRSZXNvdXJjZUJ5TG93UXVhbGl0eVByaW9yaXR5ID0gZmFsc2U7XHJcbiAgICBcclxuICAgIGlmIChwcmlvcml0aXplclR5cGUgPT09ICdmcnVzdHVtJykge1xyXG4gICAgICAgIGxpbWl0UmVzb3VyY2VCeUxvd1F1YWxpdHlQcmlvcml0eSA9IHRydWU7XHJcbiAgICAgICAgcHJpb3JpdGl6ZXIgPSBuZXcgRnJ1c3R1bVJlcXVlc3RzUHJpb3JpdGl6ZXIoKTtcclxuICAgIH0gZWxzZSBpZiAocHJpb3JpdGl6ZXJUeXBlID09PSAnZnJ1c3R1bU9ubHknKSB7XHJcbiAgICAgICAgbGltaXRSZXNvdXJjZUJ5TG93UXVhbGl0eVByaW9yaXR5ID0gdHJ1ZTtcclxuICAgICAgICBwcmlvcml0aXplciA9IG5ldyBGcnVzdHVtUmVxdWVzdHNQcmlvcml0aXplcihcclxuICAgICAgICAgICAgLyppc0Fib3J0UmVxdWVzdHNOb3RJbkZydXN0dW09Ki90cnVlLFxyXG4gICAgICAgICAgICAvKmlzUHJpb3JpdGl6ZUxvd1F1YWxpdHlTdGFnZT0qL3RydWUpO1xyXG4gICAgfSBlbHNlIGlmICghcHJpb3JpdGl6ZXJUeXBlKSB7XHJcbiAgICAgICAgcHJpb3JpdGl6ZXIgPSBudWxsO1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgICBwcmlvcml0aXplciA9IHByaW9yaXRpemVyVHlwZTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgdmFyIG9wdGlvbnMgPSB7XHJcbiAgICAgICAgc2NoZWR1bGVyTmFtZTogc2NoZWR1bGVyTmFtZSxcclxuICAgICAgICBzaG93TG9nOiBzaG93TG9nXHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBpZiAobGltaXRSZXNvdXJjZUJ5TG93UXVhbGl0eVByaW9yaXR5KSB7XHJcbiAgICAgICAgb3B0aW9ucy5yZXNvdXJjZUd1YXJhbnRlZWRGb3JIaWdoUHJpb3JpdHkgPSByZXNvdXJjZUxpbWl0IC0gMjtcclxuICAgICAgICBvcHRpb25zLmhpZ2hQcmlvcml0eVRvR3VhcmFudGVlUmVzb3VyY2UgPVxyXG4gICAgICAgICAgICBwcmlvcml0aXplci5taW5pbWFsTG93UXVhbGl0eVByaW9yaXR5O1xyXG4gICAgfVxyXG4gICAgICAgIFxyXG4gICAgcmV0dXJuIHtcclxuICAgICAgICBwcmlvcml0aXplcjogcHJpb3JpdGl6ZXIsXHJcbiAgICAgICAgc2NoZWR1bGVyT3B0aW9uczogb3B0aW9uc1xyXG4gICAgfTtcclxufVxyXG4gICAgXHJcbmZ1bmN0aW9uIGZpeEJvdW5kcyhib3VuZHMsIGltYWdlLCBhZGFwdFByb3BvcnRpb25zKSB7XHJcbiAgICBpZiAoIWFkYXB0UHJvcG9ydGlvbnMpIHtcclxuICAgICAgICByZXR1cm47XHJcbiAgICB9XHJcblxyXG4gICAgdmFyIHJlY3RhbmdsZVdpZHRoID0gYm91bmRzLmVhc3QgLSBib3VuZHMud2VzdDtcclxuICAgIHZhciByZWN0YW5nbGVIZWlnaHQgPSBib3VuZHMubm9ydGggLSBib3VuZHMuc291dGg7XHJcblxyXG4gICAgdmFyIHBpeGVsc0FzcGVjdFJhdGlvID0gaW1hZ2UuZ2V0SW1hZ2VXaWR0aCgpIC8gaW1hZ2UuZ2V0SW1hZ2VIZWlnaHQoKTtcclxuICAgIHZhciByZWN0YW5nbGVBc3BlY3RSYXRpbyA9IHJlY3RhbmdsZVdpZHRoIC8gcmVjdGFuZ2xlSGVpZ2h0O1xyXG4gICAgXHJcbiAgICBpZiAocGl4ZWxzQXNwZWN0UmF0aW8gPCByZWN0YW5nbGVBc3BlY3RSYXRpbykge1xyXG4gICAgICAgIHZhciBvbGRXaWR0aCA9IHJlY3RhbmdsZVdpZHRoO1xyXG4gICAgICAgIHJlY3RhbmdsZVdpZHRoID0gcmVjdGFuZ2xlSGVpZ2h0ICogcGl4ZWxzQXNwZWN0UmF0aW87XHJcbiAgICAgICAgdmFyIHN1YnN0cmFjdEZyb21XaWR0aCA9IG9sZFdpZHRoIC0gcmVjdGFuZ2xlV2lkdGg7XHJcbiAgICAgICAgXHJcbiAgICAgICAgYm91bmRzLmVhc3QgLT0gc3Vic3RyYWN0RnJvbVdpZHRoIC8gMjtcclxuICAgICAgICBib3VuZHMud2VzdCArPSBzdWJzdHJhY3RGcm9tV2lkdGggLyAyO1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgICB2YXIgb2xkSGVpZ2h0ID0gcmVjdGFuZ2xlSGVpZ2h0O1xyXG4gICAgICAgIHJlY3RhbmdsZUhlaWdodCA9IHJlY3RhbmdsZVdpZHRoIC8gcGl4ZWxzQXNwZWN0UmF0aW87XHJcbiAgICAgICAgdmFyIHN1YnN0cmFjdEZyb21IZWlnaHQgPSBvbGRIZWlnaHQgLSByZWN0YW5nbGVIZWlnaHQ7XHJcbiAgICAgICAgXHJcbiAgICAgICAgYm91bmRzLm5vcnRoIC09IHN1YnN0cmFjdEZyb21IZWlnaHQgLyAyO1xyXG4gICAgICAgIGJvdW5kcy5zb3V0aCArPSBzdWJzdHJhY3RGcm9tSGVpZ2h0IC8gMjtcclxuICAgIH1cclxufVxyXG5cclxuZnVuY3Rpb24gZW5zdXJlTGV2ZWxDYWxjdWxhdG9yKGxldmVsQ2FsY3VsYXRvcikge1xyXG4gICAgaWYgKCdmdW5jdGlvbicgIT09IHR5cGVvZiBsZXZlbENhbGN1bGF0b3IuZ2V0TGV2ZWwpIHtcclxuICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBNaXNzaW5nIG1ldGhvZCBsZXZlbENhbGN1bGF0b3IuZ2V0TGV2ZWwoKSc7XHJcbiAgICB9XHJcbiAgICBpZiAoJ2Z1bmN0aW9uJyAhPT0gdHlwZW9mIGxldmVsQ2FsY3VsYXRvci5nZXRMZXZlbFdpZHRoKSB7XHJcbiAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogTWlzc2luZyBtZXRob2QgbGV2ZWxDYWxjdWxhdG9yLmdldExldmVsV2lkdGgoKSc7XHJcbiAgICB9XHJcbiAgICBpZiAoJ2Z1bmN0aW9uJyAhPT0gdHlwZW9mIGxldmVsQ2FsY3VsYXRvci5nZXRMZXZlbEhlaWdodCkge1xyXG4gICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IE1pc3NpbmcgbWV0aG9kIGxldmVsQ2FsY3VsYXRvci5nZXRMZXZlbEhlaWdodCgpJztcclxuICAgIH1cclxufVxyXG5cclxuZnVuY3Rpb24gYWxpZ25QYXJhbXNUb1RpbGVzQW5kTGV2ZWwocmVnaW9uLCBpbWFnZURlY29kZXIpIHtcclxuICAgIHZhciB0aWxlV2lkdGggPSBpbWFnZURlY29kZXIuZ2V0VGlsZVdpZHRoKCk7XHJcbiAgICB2YXIgdGlsZUhlaWdodCA9IGltYWdlRGVjb2Rlci5nZXRUaWxlSGVpZ2h0KCk7XHJcbiAgICBcclxuICAgIHZhciByZWdpb25NaW5YID0gcmVnaW9uLm1pblg7XHJcbiAgICB2YXIgcmVnaW9uTWluWSA9IHJlZ2lvbi5taW5ZO1xyXG4gICAgdmFyIHJlZ2lvbk1heFggPSByZWdpb24ubWF4WEV4Y2x1c2l2ZTtcclxuICAgIHZhciByZWdpb25NYXhZID0gcmVnaW9uLm1heFlFeGNsdXNpdmU7XHJcbiAgICB2YXIgc2NyZWVuV2lkdGggPSByZWdpb24uc2NyZWVuV2lkdGg7XHJcbiAgICB2YXIgc2NyZWVuSGVpZ2h0ID0gcmVnaW9uLnNjcmVlbkhlaWdodDtcclxuICAgIFxyXG4gICAgdmFyIGlzVmFsaWRPcmRlciA9IHJlZ2lvbk1pblggPCByZWdpb25NYXhYICYmIHJlZ2lvbk1pblkgPCByZWdpb25NYXhZO1xyXG4gICAgaWYgKCFpc1ZhbGlkT3JkZXIpIHtcclxuICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBQYXJhbWV0ZXJzIG9yZGVyIGlzIGludmFsaWQnO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICB2YXIgZGVmYXVsdExldmVsV2lkdGggPSBpbWFnZURlY29kZXIuZ2V0SW1hZ2VXaWR0aCgpO1xyXG4gICAgdmFyIGRlZmF1bHRMZXZlbEhlaWdodCA9IGltYWdlRGVjb2Rlci5nZXRJbWFnZUhlaWdodCgpO1xyXG4gICAgaWYgKHJlZ2lvbk1heFggPCAwIHx8IHJlZ2lvbk1pblggPj0gZGVmYXVsdExldmVsV2lkdGggfHxcclxuICAgICAgICByZWdpb25NYXhZIDwgMCB8fCByZWdpb25NaW5ZID49IGRlZmF1bHRMZXZlbEhlaWdodCkge1xyXG4gICAgICAgIFxyXG4gICAgICAgIHJldHVybiBudWxsO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICB2YXIgbGV2ZWxDYWxjdWxhdG9yID0gaW1hZ2VEZWNvZGVyLmdldExldmVsQ2FsY3VsYXRvcigpO1xyXG4gICAgdmFyIGxldmVsID0gbGV2ZWxDYWxjdWxhdG9yLmdldExldmVsKHJlZ2lvbik7XHJcbiAgICB2YXIgbGV2ZWxXaWR0aCA9IGxldmVsQ2FsY3VsYXRvci5nZXRMZXZlbFdpZHRoKGxldmVsKTtcclxuICAgIHZhciBsZXZlbEhlaWdodCA9IGxldmVsQ2FsY3VsYXRvci5nZXRMZXZlbEhlaWdodChsZXZlbCk7XHJcbiAgICBcclxuICAgIHZhciBzY2FsZVggPSBkZWZhdWx0TGV2ZWxXaWR0aCAvIGxldmVsV2lkdGg7XHJcbiAgICB2YXIgc2NhbGVZID0gZGVmYXVsdExldmVsSGVpZ2h0IC8gbGV2ZWxIZWlnaHQ7XHJcbiAgICBcclxuICAgIHZhciBtaW5UaWxlWCA9IE1hdGguZmxvb3IocmVnaW9uTWluWCAvIChzY2FsZVggKiB0aWxlV2lkdGggKSk7XHJcbiAgICB2YXIgbWluVGlsZVkgPSBNYXRoLmZsb29yKHJlZ2lvbk1pblkgLyAoc2NhbGVZICogdGlsZUhlaWdodCkpO1xyXG4gICAgdmFyIG1heFRpbGVYID0gTWF0aC5jZWlsIChyZWdpb25NYXhYIC8gKHNjYWxlWCAqIHRpbGVXaWR0aCApKTtcclxuICAgIHZhciBtYXhUaWxlWSA9IE1hdGguY2VpbCAocmVnaW9uTWF4WSAvIChzY2FsZVkgKiB0aWxlSGVpZ2h0KSk7XHJcbiAgICBcclxuICAgIHZhciBtaW5YID0gbWluVGlsZVggKiB0aWxlV2lkdGg7XHJcbiAgICB2YXIgbWluWSA9IG1pblRpbGVZICogdGlsZUhlaWdodDtcclxuICAgIHZhciBtYXhYID0gbWF4VGlsZVggKiB0aWxlV2lkdGg7XHJcbiAgICB2YXIgbWF4WSA9IG1heFRpbGVZICogdGlsZUhlaWdodDtcclxuICAgIFxyXG4gICAgdmFyIGNyb3BwZWRNaW5YID0gTWF0aC5tYXgoMCwgTWF0aC5taW4obGV2ZWxXaWR0aCAsIG1pblgpKTtcclxuICAgIHZhciBjcm9wcGVkTWluWSA9IE1hdGgubWF4KDAsIE1hdGgubWluKGxldmVsSGVpZ2h0LCBtaW5ZKSk7XHJcbiAgICB2YXIgY3JvcHBlZE1heFggPSBNYXRoLm1heCgwLCBNYXRoLm1pbihsZXZlbFdpZHRoICwgbWF4WCkpO1xyXG4gICAgdmFyIGNyb3BwZWRNYXhZID0gTWF0aC5tYXgoMCwgTWF0aC5taW4obGV2ZWxIZWlnaHQsIG1heFkpKTtcclxuICAgIFxyXG4gICAgdmFyIGltYWdlUGFyYW1zVG9TY3JlZW5TY2FsZVggPSBzY3JlZW5XaWR0aCAgLyAobWF4WCAtIG1pblgpO1xyXG4gICAgdmFyIGltYWdlUGFyYW1zVG9TY3JlZW5TY2FsZVkgPSBzY3JlZW5IZWlnaHQgLyAobWF4WSAtIG1pblkpO1xyXG4gICAgXHJcbiAgICB2YXIgaW1hZ2VQYXJ0UGFyYW1zID0ge1xyXG4gICAgICAgIG1pblg6IGNyb3BwZWRNaW5YLFxyXG4gICAgICAgIG1pblk6IGNyb3BwZWRNaW5ZLFxyXG4gICAgICAgIG1heFhFeGNsdXNpdmU6IGNyb3BwZWRNYXhYLFxyXG4gICAgICAgIG1heFlFeGNsdXNpdmU6IGNyb3BwZWRNYXhZLFxyXG4gICAgICAgIGxldmVsV2lkdGg6IGxldmVsV2lkdGgsXHJcbiAgICAgICAgbGV2ZWxIZWlnaHQ6IGxldmVsSGVpZ2h0LFxyXG4gICAgICAgIGxldmVsOiBsZXZlbFxyXG4gICAgfTtcclxuICAgIFxyXG4gICAgdmFyIHBvc2l0aW9uSW5JbWFnZSA9IHtcclxuICAgICAgICBtaW5YOiBjcm9wcGVkTWluWCAqIHNjYWxlWCxcclxuICAgICAgICBtaW5ZOiBjcm9wcGVkTWluWSAqIHNjYWxlWSxcclxuICAgICAgICBtYXhYRXhjbHVzaXZlOiBjcm9wcGVkTWF4WCAqIHNjYWxlWCxcclxuICAgICAgICBtYXhZRXhjbHVzaXZlOiBjcm9wcGVkTWF4WSAqIHNjYWxlWVxyXG4gICAgfTtcclxuICAgIFxyXG4gICAgdmFyIGNyb3BwZWRTY3JlZW4gPSB7XHJcbiAgICAgICAgbWluWCA6IE1hdGguZmxvb3IoKGNyb3BwZWRNaW5YIC0gbWluWCkgKiBpbWFnZVBhcmFtc1RvU2NyZWVuU2NhbGVYKSxcclxuICAgICAgICBtaW5ZIDogTWF0aC5mbG9vcigoY3JvcHBlZE1pblkgLSBtaW5ZKSAqIGltYWdlUGFyYW1zVG9TY3JlZW5TY2FsZVkpLFxyXG4gICAgICAgIG1heFhFeGNsdXNpdmUgOiBNYXRoLmNlaWwoKGNyb3BwZWRNYXhYIC0gbWluWCkgKiBpbWFnZVBhcmFtc1RvU2NyZWVuU2NhbGVYKSxcclxuICAgICAgICBtYXhZRXhjbHVzaXZlIDogTWF0aC5jZWlsKChjcm9wcGVkTWF4WSAtIG1pblkpICogaW1hZ2VQYXJhbXNUb1NjcmVlblNjYWxlWSlcclxuICAgIH07XHJcbiAgICBcclxuICAgIHJldHVybiB7XHJcbiAgICAgICAgaW1hZ2VQYXJ0UGFyYW1zOiBpbWFnZVBhcnRQYXJhbXMsXHJcbiAgICAgICAgcG9zaXRpb25JbkltYWdlOiBwb3NpdGlvbkluSW1hZ2UsXHJcbiAgICAgICAgY3JvcHBlZFNjcmVlbjogY3JvcHBlZFNjcmVlblxyXG4gICAgfTtcclxufVxyXG5cclxuZnVuY3Rpb24gZ2V0T3JDcmVhdGVJbnN0YW5jZShvYmosIG9iak5hbWUsIGV4cGVjdGVkTWV0aG9kcykge1xyXG4gICAgaWYgKCFpc0luZGlyZWN0Q3JlYXRpb25OZWVkZWQob2JqLCBvYmpOYW1lLCBleHBlY3RlZE1ldGhvZHMpKSB7XHJcbiAgICAgICAgcmV0dXJuIG9iajtcclxuICAgIH1cclxuICAgIFxyXG4gICAgdmFyIGNsYXNzVG9DcmVhdGUgPSBudWxsO1xyXG4gICAgdHJ5IHtcclxuICAgICAgICBjbGFzc1RvQ3JlYXRlID0gZ2V0Q2xhc3NJbkdsb2JhbE9iamVjdCh3aW5kb3csIG9iai5jdG9yTmFtZSk7XHJcbiAgICB9IGNhdGNoKGUpIHsgfVxyXG5cclxuICAgIGlmICghY2xhc3NUb0NyZWF0ZSkge1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGNsYXNzVG9DcmVhdGUgPSBnZXRDbGFzc0luR2xvYmFsT2JqZWN0KGdsb2JhbHMsIG9iai5jdG9yTmFtZSk7XHJcbiAgICAgICAgfSBjYXRjaChlKSB7IH1cclxuICAgIH1cclxuICAgIFxyXG4gICAgaWYgKCFjbGFzc1RvQ3JlYXRlKSB7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgY2xhc3NUb0NyZWF0ZSA9IGdldENsYXNzSW5HbG9iYWxPYmplY3Qoc2VsZiwgb2JqLmN0b3JOYW1lKTtcclxuICAgICAgICB9IGNhdGNoKGUpIHsgfVxyXG4gICAgfVxyXG4gICAgXHJcbiAgICBpZiAoIWNsYXNzVG9DcmVhdGUpIHtcclxuICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBDb3VsZCBub3QgZmluZCBjbGFzcyAnICsgb2JqLmN0b3JOYW1lICsgJyBpbiBnbG9iYWwgJyArXHJcbiAgICAgICAgICAgICcgc2NvcGUgdG8gY3JlYXRlIGFuIGluc3RhbmNlIG9mICcgKyBvYmpOYW1lO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICB2YXIgcmVzdWx0ID0gbmV3IGNsYXNzVG9DcmVhdGUoKTtcclxuICAgIFxyXG4gICAgLy8gVGhyb3cgZXhjZXB0aW9uIGlmIG1ldGhvZHMgbm90IGV4aXN0XHJcbiAgICBpc0luZGlyZWN0Q3JlYXRpb25OZWVkZWQocmVzdWx0LCBvYmpOYW1lLCBleHBlY3RlZE1ldGhvZHMsIC8qZGlzYWJsZUN0b3JOYW1lU2VhcmNoPSovdHJ1ZSk7XHJcbiAgICBcclxuICAgIHJldHVybiByZXN1bHQ7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGlzSW5kaXJlY3RDcmVhdGlvbk5lZWRlZChvYmosIG9iak5hbWUsIGV4cGVjdGVkTWV0aG9kcywgZGlzYWJsZUN0b3JOYW1lU2VhcmNoKSB7XHJcbiAgICBpZiAoIW9iaikge1xyXG4gICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IG1pc3NpbmcgYXJndW1lbnQgJyArIG9iak5hbWU7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHZhciBub25leGlzdGluZ01ldGhvZDtcclxuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgZXhwZWN0ZWRNZXRob2RzLmxlbmd0aDsgKytpKSB7XHJcbiAgICAgICAgaWYgKCdmdW5jdGlvbicgIT09IHR5cGVvZiBvYmpbZXhwZWN0ZWRNZXRob2RzW2ldXSkge1xyXG4gICAgICAgICAgICBub25leGlzdGluZ01ldGhvZCA9IGV4cGVjdGVkTWV0aG9kc1tpXTtcclxuICAgICAgICAgICAgYnJlYWs7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgXHJcbiAgICBpZiAoaSA9PT0gZXhwZWN0ZWRNZXRob2RzLmxlbmd0aCkge1xyXG4gICAgICAgIHJldHVybiBmYWxzZTtcclxuICAgIH1cclxuXHJcbiAgICBpZiAoZGlzYWJsZUN0b3JOYW1lU2VhcmNoKSB7XHJcbiAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogQ291bGQgbm90IGZpbmQgbWV0aG9kICcgK1xyXG4gICAgICAgICAgICBub25leGlzdGluZ01ldGhvZCArICcgaW4gb2JqZWN0ICcgKyBvYmpOYW1lO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBpZiAoJ3N0cmluZycgIT09IHR5cGVvZiBvYmouY3Rvck5hbWUpIHtcclxuICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBDb3VsZCBub3QgZmluZCBtZXRob2QgJyArIG5vbmV4aXN0aW5nTWV0aG9kICtcclxuICAgICAgICAgICAgJyBpbiBvYmplY3QgJyArIG9iak5hbWUgKyAnLiBFaXRoZXIgbWV0aG9kIHNob3VsZCBiZSBleGlzdCBvciB0aGUgb2JqZWN0XFwncyAnICtcclxuICAgICAgICAgICAgJ2N0b3JOYW1lIHByb3BlcnR5IHNob3VsZCBwb2ludCB0byBhIGNsYXNzIHRvIGNyZWF0ZSBpbnN0YW5jZSBmcm9tJztcclxuICAgIH1cclxuICAgIGlmICghb2JqLnNjcmlwdHNUb0ltcG9ydCkge1xyXG4gICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IENvdWxkIG5vdCBmaW5kIG1ldGhvZCAnICsgbm9uZXhpc3RpbmdNZXRob2QgK1xyXG4gICAgICAgICAgICAnIGluIG9iamVjdCAnICsgb2JqTmFtZSArICcuIEVpdGhlciBtZXRob2Qgc2hvdWxkIGJlIGV4aXN0IG9yIHRoZSBvYmplY3RcXCdzICcgK1xyXG4gICAgICAgICAgICAnc2NyaXB0c1RvSW1wb3J0IHByb3BlcnR5IHNob3VsZCBiZSBleGlzdCc7XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIHRydWU7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGdldENsYXNzSW5HbG9iYWxPYmplY3QoZ2xvYmFsT2JqZWN0LCBjbGFzc05hbWUpIHtcclxuICAgIGlmIChnbG9iYWxPYmplY3RbY2xhc3NOYW1lXSkge1xyXG4gICAgICAgIHJldHVybiBnbG9iYWxPYmplY3RbY2xhc3NOYW1lXTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgdmFyIHJlc3VsdCA9IGdsb2JhbE9iamVjdDtcclxuICAgIHZhciBwYXRoID0gY2xhc3NOYW1lLnNwbGl0KCcuJyk7XHJcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IHBhdGgubGVuZ3RoOyArK2kpIHtcclxuICAgICAgICByZXN1bHQgPSByZXN1bHRbcGF0aFtpXV07XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHJldHVybiByZXN1bHQ7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIHJlbmRlclRvQ2FudmFzKGNhbnZhcywgcmVnaW9uUGFyYW1zLCBpbWFnZURlY29kZXIsIHgsIHkpIHtcclxuICAgIHZhciB0YXJnZXRDb250ZXh0ID0gY2FudmFzLmdldENvbnRleHQoJzJkJyk7XHJcbiAgICB2YXIgdGVtcENhbnZhcywgdGVtcENvbnRleHQsIGFsaWduZWRQYXJhbXMsIGltYWdlUGFydFBhcmFtcztcclxuICAgIFxyXG4gICAgLyogZ2xvYmFsIFByb21pc2U6IGZhbHNlICovXHJcbiAgICByZXR1cm4gbmV3IFByb21pc2UoZnVuY3Rpb24ocmVzb2x2ZSwgcmVqZWN0KSB7XHJcbiAgICAgICAgYWxpZ25lZFBhcmFtcyA9IGFsaWduUGFyYW1zVG9UaWxlc0FuZExldmVsKHJlZ2lvblBhcmFtcywgaW1hZ2VEZWNvZGVyKTtcclxuICAgICAgICBpbWFnZVBhcnRQYXJhbXMgPSBhbGlnbmVkUGFyYW1zLmltYWdlUGFydFBhcmFtcztcclxuXHJcbiAgICAgICAgaW1hZ2VEZWNvZGVyLnJlcXVlc3RQaXhlbHNQcm9ncmVzc2l2ZShcclxuICAgICAgICAgICAgaW1hZ2VQYXJ0UGFyYW1zLFxyXG4gICAgICAgICAgICByZWdpb25EZWNvZGVkQ2FsbGJhY2ssXHJcbiAgICAgICAgICAgIGZ1bmN0aW9uIHRlcm1pbmF0ZWRDYWxsYmFjayhpc0Fib3J0ZWQpIHtcclxuICAgICAgICAgICAgICAgIGlmIChpc0Fib3J0ZWQpIHtcclxuICAgICAgICAgICAgICAgICAgICByZWplY3QoJ0ZldGNoIGlzIGFib3J0ZWQnKTtcclxuICAgICAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgICAgcmVzb2x2ZSgpO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9KTtcclxuICAgIH0pO1xyXG4gICAgXHJcbiAgICBmdW5jdGlvbiByZWdpb25EZWNvZGVkQ2FsbGJhY2socGFydGlhbERlY29kZVJlc3VsdCkge1xyXG4gICAgICAgIGlmICghdGVtcENhbnZhcykge1xyXG4gICAgICAgICAgICB0ZW1wQ2FudmFzID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnY2FudmFzJyk7XHJcbiAgICAgICAgICAgIHRlbXBDYW52YXMud2lkdGggID0gaW1hZ2VQYXJ0UGFyYW1zLm1heFhFeGNsdXNpdmUgLSBpbWFnZVBhcnRQYXJhbXMubWluWDtcclxuICAgICAgICAgICAgdGVtcENhbnZhcy5oZWlnaHQgPSBpbWFnZVBhcnRQYXJhbXMubWF4WUV4Y2x1c2l2ZSAtIGltYWdlUGFydFBhcmFtcy5taW5ZO1xyXG5cclxuICAgICAgICAgICAgdGVtcENvbnRleHQgPSB0ZW1wQ2FudmFzLmdldENvbnRleHQoJzJkJyk7XHJcbiAgICAgICAgICAgIHRlbXBDb250ZXh0LmNsZWFyUmVjdCgwLCAwLCB0ZW1wQ2FudmFzLndpZHRoLCB0ZW1wQ2FudmFzLmhlaWdodCk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHRlbXBDb250ZXh0LnB1dEltYWdlRGF0YShcclxuICAgICAgICAgICAgcGFydGlhbERlY29kZVJlc3VsdC5pbWFnZURhdGEsXHJcbiAgICAgICAgICAgIHBhcnRpYWxEZWNvZGVSZXN1bHQueEluT3JpZ2luYWxSZXF1ZXN0LFxyXG4gICAgICAgICAgICBwYXJ0aWFsRGVjb2RlUmVzdWx0LnlJbk9yaWdpbmFsUmVxdWVzdCk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gQ3JvcCBhbmQgc2NhbGUgb3JpZ2luYWwgcmVxdWVzdCByZWdpb24gKGJlZm9yZSBhbGlnbikgaW50byBjYW52YXNcclxuICAgICAgICB2YXIgY3JvcCA9IGFsaWduZWRQYXJhbXMuY3JvcHBlZFNjcmVlbjtcclxuICAgICAgICB0YXJnZXRDb250ZXh0LmRyYXdJbWFnZSh0ZW1wQ2FudmFzLFxyXG4gICAgICAgICAgICBjcm9wLm1pblgsIGNyb3AubWluWSwgY3JvcC5tYXhYRXhjbHVzaXZlIC0gY3JvcC5taW5YLCBjcm9wLm1heFlFeGNsdXNpdmUgLSBjcm9wLm1pblksXHJcbiAgICAgICAgICAgIHggfHwgMCwgeSB8fCAwLCByZWdpb25QYXJhbXMuc2NyZWVuV2lkdGgsIHJlZ2lvblBhcmFtcy5zY3JlZW5IZWlnaHQpO1xyXG4gICAgfVxyXG59IiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBMaW5rZWRMaXN0O1xyXG5cclxuZnVuY3Rpb24gTGlua2VkTGlzdCh1c2VBdXRvbWF0aWNIYXphcmRIZXVyaXN0aWNzKSB7XHJcbiAgICB0aGlzLl9maXJzdCA9IHsgX3ByZXY6IG51bGwsIF9wYXJlbnQ6IHRoaXMgfTtcclxuICAgIHRoaXMuX2xhc3QgPSB7IF9uZXh0OiBudWxsLCBfcGFyZW50OiB0aGlzIH07XHJcbiAgICB0aGlzLl9jb3VudCA9IDA7XHJcbiAgICB0aGlzLl91c2VBdXRvbWF0aWNIYXphcmRIZXVyaXN0aWNzID0gdXNlQXV0b21hdGljSGF6YXJkSGV1cmlzdGljcztcclxuICAgIFxyXG4gICAgdGhpcy5fbGFzdC5fcHJldiA9IHRoaXMuX2ZpcnN0O1xyXG4gICAgdGhpcy5fZmlyc3QuX25leHQgPSB0aGlzLl9sYXN0O1xyXG59XHJcblxyXG5MaW5rZWRMaXN0LnByb3RvdHlwZS5hZGQgPSBmdW5jdGlvbiBhZGQodmFsdWUsIGFkZEJlZm9yZSkge1xyXG4gICAgaWYgKGFkZEJlZm9yZSA9PT0gbnVsbCB8fCBhZGRCZWZvcmUgPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIGFkZEJlZm9yZSA9IHRoaXMuX2xhc3Q7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHRoaXMuX3ZhbGlkYXRlSXRlcmF0b3JPZlRoaXMoYWRkQmVmb3JlKTtcclxuICAgIFxyXG4gICAgKyt0aGlzLl9jb3VudDtcclxuICAgIFxyXG4gICAgdmFyIG5ld05vZGUgPSB7XHJcbiAgICAgICAgX3ZhbHVlOiB2YWx1ZSxcclxuICAgICAgICBfbmV4dDogYWRkQmVmb3JlLFxyXG4gICAgICAgIF9wcmV2OiBhZGRCZWZvcmUuX3ByZXYsXHJcbiAgICAgICAgX2lzSXRlcmF0ZWQ6IGZhbHNlLFxyXG4gICAgICAgIF9wYXJlbnQ6IHRoaXNcclxuICAgIH07XHJcbiAgICBcclxuICAgIG5ld05vZGUuX3ByZXYuX25leHQgPSBuZXdOb2RlO1xyXG4gICAgYWRkQmVmb3JlLl9wcmV2ID0gbmV3Tm9kZTtcclxuICAgIFxyXG4gICAgcmV0dXJuIG5ld05vZGU7XHJcbn07XHJcblxyXG5MaW5rZWRMaXN0LnByb3RvdHlwZS5yZW1vdmUgPSBmdW5jdGlvbiByZW1vdmUoaXRlcmF0b3IpIHtcclxuICAgIHRoaXMuX3ZhbGlkYXRlSXRlcmF0b3JPZlRoaXMoaXRlcmF0b3IpO1xyXG4gICAgaWYgKHRoaXMuX3VzZUF1dG9tYXRpY0hhemFyZEhldXJpc3RpY3MgJiYgaXRlcmF0b3IuX2lzSXRlcmF0ZWQpIHtcclxuICAgICAgICB0aHJvdyAnZGVwZW5kZW5jeS13b3JrZXJzIGVycm9yOiBTdXNwZWN0IHJlbW92YWwgd2hpbGUgaXRlcmF0aW9uJztcclxuICAgIH1cclxuICAgIFxyXG4gICAgLS10aGlzLl9jb3VudDtcclxuICAgIFxyXG4gICAgaXRlcmF0b3IuX3ByZXYuX25leHQgPSBpdGVyYXRvci5fbmV4dDtcclxuICAgIGl0ZXJhdG9yLl9uZXh0Ll9wcmV2ID0gaXRlcmF0b3IuX3ByZXY7XHJcbiAgICBpdGVyYXRvci5fcGFyZW50ID0gbnVsbDtcclxufTtcclxuXHJcbkxpbmtlZExpc3QucHJvdG90eXBlLmdldFZhbHVlID0gZnVuY3Rpb24gZ2V0VmFsdWUoaXRlcmF0b3IpIHtcclxuICAgIHRoaXMuX3ZhbGlkYXRlSXRlcmF0b3JPZlRoaXMoaXRlcmF0b3IpO1xyXG4gICAgXHJcbiAgICByZXR1cm4gaXRlcmF0b3IuX3ZhbHVlO1xyXG59O1xyXG5cclxuTGlua2VkTGlzdC5wcm90b3R5cGUuZ2V0Rmlyc3RJdGVyYXRvciA9IGZ1bmN0aW9uIGdldEZpcnN0SXRlcmF0b3IoKSB7XHJcbiAgICB2YXIgaXRlcmF0b3IgPSB0aGlzLmdldE5leHRJdGVyYXRvcih0aGlzLl9maXJzdCk7XHJcbiAgICByZXR1cm4gaXRlcmF0b3I7XHJcbn07XHJcblxyXG5MaW5rZWRMaXN0LnByb3RvdHlwZS5nZXRMYXN0SXRlcmF0b3IgPSBmdW5jdGlvbiBnZXRGaXJzdEl0ZXJhdG9yKCkge1xyXG4gICAgdmFyIGl0ZXJhdG9yID0gdGhpcy5nZXRQcmV2SXRlcmF0b3IodGhpcy5fbGFzdCk7XHJcbiAgICBpdGVyYXRvci5faXNJdGVyYXRlZCA9IHRydWU7XHJcbiAgICByZXR1cm4gaXRlcmF0b3I7XHJcbn07XHJcblxyXG5MaW5rZWRMaXN0LnByb3RvdHlwZS5nZXROZXh0SXRlcmF0b3IgPSBmdW5jdGlvbiBnZXROZXh0SXRlcmF0b3IoaXRlcmF0b3IpIHtcclxuICAgIHRoaXMuX3ZhbGlkYXRlSXRlcmF0b3JPZlRoaXMoaXRlcmF0b3IpO1xyXG5cclxuICAgIGl0ZXJhdG9yLl9pc0l0ZXJhdGVkID0gZmFsc2U7XHJcbiAgICBpZiAoaXRlcmF0b3IuX25leHQgPT09IHRoaXMuX2xhc3QpIHtcclxuICAgICAgICByZXR1cm4gbnVsbDtcclxuICAgIH1cclxuICAgIFxyXG4gICAgaXRlcmF0b3IuX25leHQuX2lzSXRlcmF0ZWQgPSB0cnVlO1xyXG4gICAgcmV0dXJuIGl0ZXJhdG9yLl9uZXh0O1xyXG59O1xyXG5cclxuTGlua2VkTGlzdC5wcm90b3R5cGUuZ2V0UHJldkl0ZXJhdG9yID0gZnVuY3Rpb24gZ2V0UHJldkl0ZXJhdG9yKGl0ZXJhdG9yKSB7XHJcbiAgICB0aGlzLl92YWxpZGF0ZUl0ZXJhdG9yT2ZUaGlzKGl0ZXJhdG9yKTtcclxuXHJcbiAgICBpdGVyYXRvci5faXNJdGVyYXRlZCA9IGZhbHNlO1xyXG4gICAgaWYgKGl0ZXJhdG9yLl9wcmV2ID09PSB0aGlzLl9maXJzdCkge1xyXG4gICAgICAgIHJldHVybiBudWxsO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBpdGVyYXRvci5fcHJldi5faXNJdGVyYXRlZCA9IHRydWU7XHJcbiAgICByZXR1cm4gaXRlcmF0b3IuX3ByZXY7XHJcbn07XHJcblxyXG5MaW5rZWRMaXN0LnByb3RvdHlwZS5nZXRDb3VudCA9IGZ1bmN0aW9uIGdldENvdW50KCkge1xyXG4gICAgcmV0dXJuIHRoaXMuX2NvdW50O1xyXG59O1xyXG5cclxuTGlua2VkTGlzdC5wcm90b3R5cGUuX3ZhbGlkYXRlSXRlcmF0b3JPZlRoaXMgPVxyXG4gICAgZnVuY3Rpb24gdmFsaWRhdGVJdGVyYXRvck9mVGhpcyhpdGVyYXRvcikge1xyXG4gICAgXHJcbiAgICBpZiAoaXRlcmF0b3IuX3BhcmVudCAhPT0gdGhpcykge1xyXG4gICAgICAgIHRocm93ICdkZXBlbmRlbmN5LXdvcmtlcnMgZXJyb3I6IGl0ZXJhdG9yIG11c3QgYmUgb2YgdGhlIGN1cnJlbnQgTGlua2VkTGlzdCc7XHJcbiAgICB9XHJcbn07IiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBJbWFnZURlY29kZXJWaWV3ZXI7XHJcblxyXG52YXIgaW1hZ2VIZWxwZXJGdW5jdGlvbnMgPSByZXF1aXJlKCdpbWFnZS1oZWxwZXItZnVuY3Rpb25zLmpzJyk7XHJcblxyXG52YXIgUEVORElOR19DQUxMX1RZUEVfUElYRUxTX1VQREFURUQgPSAxO1xyXG52YXIgUEVORElOR19DQUxMX1RZUEVfUkVQT1NJVElPTiA9IDI7XHJcblxyXG52YXIgUkVHSU9OX09WRVJWSUVXID0gMDtcclxudmFyIFJFR0lPTl9EWU5BTUlDID0gMTtcclxuXHJcbmZ1bmN0aW9uIEltYWdlRGVjb2RlclZpZXdlcihpbWFnZURlY29kZXIsIGNhbnZhc1VwZGF0ZWRDYWxsYmFjaywgb3B0aW9ucykge1xyXG4gICAgdGhpcy5fY2FudmFzVXBkYXRlZENhbGxiYWNrID0gY2FudmFzVXBkYXRlZENhbGxiYWNrO1xyXG4gICAgXHJcbiAgICB0aGlzLl9hZGFwdFByb3BvcnRpb25zID0gb3B0aW9ucy5hZGFwdFByb3BvcnRpb25zO1xyXG4gICAgdGhpcy5fY2FydG9ncmFwaGljQm91bmRzID0gb3B0aW9ucy5jYXJ0b2dyYXBoaWNCb3VuZHM7XHJcbiAgICB0aGlzLl9hbGxvd011bHRpcGxlTW92YWJsZUZldGNoZXNJblNlc3Npb24gPVxyXG4gICAgICAgIG9wdGlvbnMuYWxsb3dNdWx0aXBsZU1vdmFibGVGZXRjaGVzSW5TZXNzaW9uO1xyXG4gICAgdGhpcy5fbWluRnVuY3Rpb25DYWxsSW50ZXJ2YWxNaWxsaXNlY29uZHMgPVxyXG4gICAgICAgIG9wdGlvbnMubWluRnVuY3Rpb25DYWxsSW50ZXJ2YWxNaWxsaXNlY29uZHM7XHJcbiAgICB0aGlzLl9vdmVydmlld1Jlc29sdXRpb25YID0gb3B0aW9ucy5vdmVydmlld1Jlc29sdXRpb25YIHx8IDEwMDtcclxuICAgIHRoaXMuX292ZXJ2aWV3UmVzb2x1dGlvblkgPSBvcHRpb25zLm92ZXJ2aWV3UmVzb2x1dGlvblkgfHwgMTAwO1xyXG4gICAgICAgIFxyXG4gICAgdGhpcy5fbGFzdFJlcXVlc3RJbmRleCA9IDA7XHJcbiAgICB0aGlzLl9wZW5kaW5nVXBkYXRlVmlld0FyZWEgPSBudWxsO1xyXG4gICAgdGhpcy5fcmVnaW9ucyA9IFtdO1xyXG4gICAgdGhpcy5fdGFyZ2V0Q2FudmFzID0gbnVsbDtcclxuICAgIFxyXG4gICAgdGhpcy5fY2FsbFBlbmRpbmdDYWxsYmFja3NCb3VuZCA9IHRoaXMuX2NhbGxQZW5kaW5nQ2FsbGJhY2tzLmJpbmQodGhpcyk7XHJcbiAgICB0aGlzLl9jcmVhdGVkTW92YWJsZUZldGNoQm91bmQgPSB0aGlzLl9jcmVhdGVkTW92YWJsZUZldGNoLmJpbmQodGhpcyk7XHJcbiAgICBcclxuICAgIHRoaXMuX3BlbmRpbmdDYWxsYmFja3NJbnRlcnZhbEhhbmRsZSA9IDA7XHJcbiAgICB0aGlzLl9wZW5kaW5nQ2FsbGJhY2tDYWxscyA9IFtdO1xyXG4gICAgdGhpcy5fY2FuU2hvd0R5bmFtaWNSZWdpb24gPSBmYWxzZTtcclxuICAgIFxyXG4gICAgaWYgKHRoaXMuX2NhcnRvZ3JhcGhpY0JvdW5kcyA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgdGhpcy5fY2FydG9ncmFwaGljQm91bmRzID0ge1xyXG4gICAgICAgICAgICB3ZXN0OiAtMTc1LjAsXHJcbiAgICAgICAgICAgIGVhc3Q6IDE3NS4wLFxyXG4gICAgICAgICAgICBzb3V0aDogLTg1LjAsXHJcbiAgICAgICAgICAgIG5vcnRoOiA4NS4wXHJcbiAgICAgICAgfTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgaWYgKHRoaXMuX2FkYXB0UHJvcG9ydGlvbnMgPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIHRoaXMuX2FkYXB0UHJvcG9ydGlvbnMgPSB0cnVlO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICB0aGlzLl9pbWFnZURlY29kZXIgPSBpbWFnZURlY29kZXI7XHJcbiAgICBpbWFnZURlY29kZXIuc2V0RGVjb2RlUHJpb3JpdGl6ZXJUeXBlKCdmcnVzdHVtT25seScpO1xyXG4gICAgaW1hZ2VEZWNvZGVyLnNldEZldGNoUHJpb3JpdGl6ZXJUeXBlKCdmcnVzdHVtT25seScpO1xyXG59XHJcblxyXG5JbWFnZURlY29kZXJWaWV3ZXIucHJvdG90eXBlLnNldEV4Y2VwdGlvbkNhbGxiYWNrID0gZnVuY3Rpb24gc2V0RXhjZXB0aW9uQ2FsbGJhY2soZXhjZXB0aW9uQ2FsbGJhY2spIHtcclxuICAgIC8vIFRPRE86IFN1cHBvcnQgZXhjZXB0aW9uQ2FsbGJhY2sgaW4gZXZlcnkgcGxhY2UgbmVlZGVkXHJcbiAgICB0aGlzLl9leGNlcHRpb25DYWxsYmFjayA9IGV4Y2VwdGlvbkNhbGxiYWNrO1xyXG59O1xyXG4gICAgXHJcbkltYWdlRGVjb2RlclZpZXdlci5wcm90b3R5cGUub3BlbiA9IGZ1bmN0aW9uIG9wZW4ob3BlbkFyZykge1xyXG4gICAgcmV0dXJuIHRoaXMuX2ltYWdlRGVjb2Rlci5vcGVuKG9wZW5BcmcpXHJcbiAgICAgICAgLnRoZW4odGhpcy5fb3BlbmVkLmJpbmQodGhpcykpXHJcbiAgICAgICAgLmNhdGNoKHRoaXMuX2V4Y2VwdGlvbkNhbGxiYWNrKTtcclxufTtcclxuXHJcbkltYWdlRGVjb2RlclZpZXdlci5wcm90b3R5cGUuY2xvc2UgPSBmdW5jdGlvbiBjbG9zZSgpIHtcclxuICAgIHZhciBwcm9taXNlID0gdGhpcy5faW1hZ2VEZWNvZGVyLmNsb3NlKCk7XHJcbiAgICBwcm9taXNlLmNhdGNoKHRoaXMuX2V4Y2VwdGlvbkNhbGxiYWNrKTtcclxuICAgIHRoaXMuX2lzUmVhZHkgPSBmYWxzZTtcclxuICAgIHRoaXMuX2NhblNob3dEeW5hbWljUmVnaW9uID0gZmFsc2U7XHJcbiAgICB0aGlzLl90YXJnZXRDYW52YXMgPSBudWxsO1xyXG4gICAgcmV0dXJuIHByb21pc2U7XHJcbn07XHJcblxyXG5JbWFnZURlY29kZXJWaWV3ZXIucHJvdG90eXBlLnNldFRhcmdldENhbnZhcyA9IGZ1bmN0aW9uIHNldFRhcmdldENhbnZhcyhjYW52YXMpIHtcclxuICAgIHRoaXMuX3RhcmdldENhbnZhcyA9IGNhbnZhcztcclxufTtcclxuXHJcbkltYWdlRGVjb2RlclZpZXdlci5wcm90b3R5cGUudXBkYXRlVmlld0FyZWEgPSBmdW5jdGlvbiB1cGRhdGVWaWV3QXJlYShmcnVzdHVtRGF0YSkge1xyXG4gICAgaWYgKHRoaXMuX3RhcmdldENhbnZhcyA9PT0gbnVsbCkge1xyXG4gICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IENhbm5vdCB1cGRhdGUgZHluYW1pYyByZWdpb24gYmVmb3JlIHNldFRhcmdldENhbnZhcygpJztcclxuICAgIH1cclxuICAgIFxyXG4gICAgaWYgKCF0aGlzLl9jYW5TaG93RHluYW1pY1JlZ2lvbikge1xyXG4gICAgICAgIHRoaXMuX3BlbmRpbmdVcGRhdGVWaWV3QXJlYSA9IGZydXN0dW1EYXRhO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIFxyXG4gICAgdmFyIGJvdW5kcyA9IGZydXN0dW1EYXRhLnJlY3RhbmdsZTtcclxuICAgIHZhciBzY3JlZW5TaXplID0gZnJ1c3R1bURhdGEuc2NyZWVuU2l6ZTtcclxuICAgIFxyXG4gICAgdmFyIHJlZ2lvblBhcmFtcyA9IHtcclxuICAgICAgICBtaW5YOiBib3VuZHMud2VzdCAqIHRoaXMuX3NjYWxlWCArIHRoaXMuX3RyYW5zbGF0ZVgsXHJcbiAgICAgICAgbWluWTogYm91bmRzLm5vcnRoICogdGhpcy5fc2NhbGVZICsgdGhpcy5fdHJhbnNsYXRlWSxcclxuICAgICAgICBtYXhYRXhjbHVzaXZlOiBib3VuZHMuZWFzdCAqIHRoaXMuX3NjYWxlWCArIHRoaXMuX3RyYW5zbGF0ZVgsXHJcbiAgICAgICAgbWF4WUV4Y2x1c2l2ZTogYm91bmRzLnNvdXRoICogdGhpcy5fc2NhbGVZICsgdGhpcy5fdHJhbnNsYXRlWSxcclxuICAgICAgICBzY3JlZW5XaWR0aDogc2NyZWVuU2l6ZS54LFxyXG4gICAgICAgIHNjcmVlbkhlaWdodDogc2NyZWVuU2l6ZS55XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICB2YXIgYWxpZ25lZFBhcmFtcyA9XHJcbiAgICAgICAgaW1hZ2VIZWxwZXJGdW5jdGlvbnMuYWxpZ25QYXJhbXNUb1RpbGVzQW5kTGV2ZWwoXHJcbiAgICAgICAgICAgIHJlZ2lvblBhcmFtcywgdGhpcy5faW1hZ2VEZWNvZGVyKTtcclxuICAgIFxyXG4gICAgdmFyIGlzT3V0c2lkZVNjcmVlbiA9IGFsaWduZWRQYXJhbXMgPT09IG51bGw7XHJcbiAgICBpZiAoaXNPdXRzaWRlU2NyZWVuKSB7XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBhbGlnbmVkUGFyYW1zLmltYWdlUGFydFBhcmFtcy5xdWFsaXR5ID0gdGhpcy5fcXVhbGl0eTtcclxuXHJcbiAgICB2YXIgaXNTYW1lUmVnaW9uID1cclxuICAgICAgICB0aGlzLl9keW5hbWljRmV0Y2hQYXJhbXMgIT09IHVuZGVmaW5lZCAmJlxyXG4gICAgICAgIHRoaXMuX2lzSW1hZ2VQYXJ0c0VxdWFsKFxyXG4gICAgICAgICAgICBhbGlnbmVkUGFyYW1zLmltYWdlUGFydFBhcmFtcyxcclxuICAgICAgICAgICAgdGhpcy5fZHluYW1pY0ZldGNoUGFyYW1zLmltYWdlUGFydFBhcmFtcyk7XHJcbiAgICBcclxuICAgIGlmIChpc1NhbWVSZWdpb24pIHtcclxuICAgICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGZydXN0dW1EYXRhLmltYWdlUmVjdGFuZ2xlID0gdGhpcy5fY2FydG9ncmFwaGljQm91bmRzRml4ZWQ7XHJcbiAgICBmcnVzdHVtRGF0YS5leGFjdGxldmVsID1cclxuICAgICAgICBhbGlnbmVkUGFyYW1zLmltYWdlUGFydFBhcmFtcy5sZXZlbDtcclxuICAgIFxyXG4gICAgdGhpcy5faW1hZ2VEZWNvZGVyLnNldERlY29kZVByaW9yaXRpemVyRGF0YShmcnVzdHVtRGF0YSk7XHJcbiAgICB0aGlzLl9pbWFnZURlY29kZXIuc2V0RmV0Y2hQcmlvcml0aXplckRhdGEoZnJ1c3R1bURhdGEpO1xyXG5cclxuICAgIHRoaXMuX2R5bmFtaWNGZXRjaFBhcmFtcyA9IGFsaWduZWRQYXJhbXM7XHJcbiAgICBcclxuICAgIHZhciBzdGFydER5bmFtaWNSZWdpb25PblRlcm1pbmF0aW9uID0gZmFsc2U7XHJcbiAgICB2YXIgbW92ZUV4aXN0aW5nRmV0Y2ggPSAhdGhpcy5fYWxsb3dNdWx0aXBsZU1vdmFibGVGZXRjaGVzSW5TZXNzaW9uO1xyXG4gICAgdGhpcy5fZmV0Y2goXHJcbiAgICAgICAgUkVHSU9OX0RZTkFNSUMsXHJcbiAgICAgICAgYWxpZ25lZFBhcmFtcyxcclxuICAgICAgICBzdGFydER5bmFtaWNSZWdpb25PblRlcm1pbmF0aW9uLFxyXG4gICAgICAgIG1vdmVFeGlzdGluZ0ZldGNoKTtcclxufTtcclxuXHJcbkltYWdlRGVjb2RlclZpZXdlci5wcm90b3R5cGUuZ2V0Qm91bmRzID0gZnVuY3Rpb24gZ2V0Q2FydG9ncmFwaGljQm91bmRzKCkge1xyXG4gICAgaWYgKCF0aGlzLl9pc1JlYWR5KSB7XHJcbiAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogSW1hZ2VEZWNvZGVyVmlld2VyIGVycm9yOiBJbWFnZSBpcyBub3QgcmVhZHkgeWV0JztcclxuICAgIH1cclxuICAgIHJldHVybiB0aGlzLl9jYXJ0b2dyYXBoaWNCb3VuZHNGaXhlZDtcclxufTtcclxuXHJcbkltYWdlRGVjb2RlclZpZXdlci5wcm90b3R5cGUuX2lzSW1hZ2VQYXJ0c0VxdWFsID0gZnVuY3Rpb24gaXNJbWFnZVBhcnRzRXF1YWwoZmlyc3QsIHNlY29uZCkge1xyXG4gICAgdmFyIGlzRXF1YWwgPVxyXG4gICAgICAgIHRoaXMuX2R5bmFtaWNGZXRjaFBhcmFtcyAhPT0gdW5kZWZpbmVkICYmXHJcbiAgICAgICAgZmlyc3QubWluWCA9PT0gc2Vjb25kLm1pblggJiZcclxuICAgICAgICBmaXJzdC5taW5ZID09PSBzZWNvbmQubWluWSAmJlxyXG4gICAgICAgIGZpcnN0Lm1heFhFeGNsdXNpdmUgPT09IHNlY29uZC5tYXhYRXhjbHVzaXZlICYmXHJcbiAgICAgICAgZmlyc3QubWF4WUV4Y2x1c2l2ZSA9PT0gc2Vjb25kLm1heFlFeGNsdXNpdmUgJiZcclxuICAgICAgICBmaXJzdC5sZXZlbCA9PT0gc2Vjb25kLmxldmVsO1xyXG4gICAgXHJcbiAgICByZXR1cm4gaXNFcXVhbDtcclxufTtcclxuXHJcbkltYWdlRGVjb2RlclZpZXdlci5wcm90b3R5cGUuX2ZldGNoID0gZnVuY3Rpb24gZmV0Y2goXHJcbiAgICByZWdpb25JZCxcclxuICAgIGZldGNoUGFyYW1zLFxyXG4gICAgc3RhcnREeW5hbWljUmVnaW9uT25UZXJtaW5hdGlvbixcclxuICAgIG1vdmVFeGlzdGluZ0ZldGNoKSB7XHJcbiAgICBcclxuICAgIHZhciByZXF1ZXN0SW5kZXggPSArK3RoaXMuX2xhc3RSZXF1ZXN0SW5kZXg7XHJcbiAgICBcclxuICAgIHZhciBpbWFnZVBhcnRQYXJhbXMgPSBmZXRjaFBhcmFtcy5pbWFnZVBhcnRQYXJhbXM7XHJcbiAgICBpbWFnZVBhcnRQYXJhbXMucmVxdWVzdFByaW9yaXR5RGF0YSA9XHJcbiAgICAgICAgaW1hZ2VQYXJ0UGFyYW1zLnJlcXVlc3RQcmlvcml0eURhdGEgfHwge307XHJcbiAgICBcclxuICAgIGltYWdlUGFydFBhcmFtcy5yZXF1ZXN0UHJpb3JpdHlEYXRhLnJlcXVlc3RJbmRleCA9IHJlcXVlc3RJbmRleDtcclxuXHJcbiAgICB2YXIgbWluWCA9IGZldGNoUGFyYW1zLnBvc2l0aW9uSW5JbWFnZS5taW5YO1xyXG4gICAgdmFyIG1pblkgPSBmZXRjaFBhcmFtcy5wb3NpdGlvbkluSW1hZ2UubWluWTtcclxuICAgIHZhciBtYXhYID0gZmV0Y2hQYXJhbXMucG9zaXRpb25JbkltYWdlLm1heFhFeGNsdXNpdmU7XHJcbiAgICB2YXIgbWF4WSA9IGZldGNoUGFyYW1zLnBvc2l0aW9uSW5JbWFnZS5tYXhZRXhjbHVzaXZlO1xyXG4gICAgXHJcbiAgICB2YXIgd2VzdCA9IChtaW5YIC0gdGhpcy5fdHJhbnNsYXRlWCkgLyB0aGlzLl9zY2FsZVg7XHJcbiAgICB2YXIgZWFzdCA9IChtYXhYIC0gdGhpcy5fdHJhbnNsYXRlWCkgLyB0aGlzLl9zY2FsZVg7XHJcbiAgICB2YXIgbm9ydGggPSAobWluWSAtIHRoaXMuX3RyYW5zbGF0ZVkpIC8gdGhpcy5fc2NhbGVZO1xyXG4gICAgdmFyIHNvdXRoID0gKG1heFkgLSB0aGlzLl90cmFuc2xhdGVZKSAvIHRoaXMuX3NjYWxlWTtcclxuICAgIFxyXG4gICAgdmFyIHBvc2l0aW9uID0ge1xyXG4gICAgICAgIHdlc3Q6IHdlc3QsXHJcbiAgICAgICAgZWFzdDogZWFzdCxcclxuICAgICAgICBub3J0aDogbm9ydGgsXHJcbiAgICAgICAgc291dGg6IHNvdXRoXHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICB2YXIgY2FuUmV1c2VPbGREYXRhID0gZmFsc2U7XHJcbiAgICB2YXIgZmV0Y2hQYXJhbXNOb3ROZWVkZWQ7XHJcbiAgICBcclxuICAgIHZhciByZWdpb24gPSB0aGlzLl9yZWdpb25zW3JlZ2lvbklkXTtcclxuICAgIGlmIChyZWdpb24gIT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIHZhciBuZXdSZXNvbHV0aW9uID0gaW1hZ2VQYXJ0UGFyYW1zLmxldmVsO1xyXG4gICAgICAgIHZhciBvbGRSZXNvbHV0aW9uID0gcmVnaW9uLmltYWdlUGFydFBhcmFtcy5sZXZlbDtcclxuICAgICAgICBcclxuICAgICAgICBjYW5SZXVzZU9sZERhdGEgPSBuZXdSZXNvbHV0aW9uID09PSBvbGRSZXNvbHV0aW9uO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGlmIChjYW5SZXVzZU9sZERhdGEgJiYgcmVnaW9uLmRvbmVQYXJ0UGFyYW1zKSB7XHJcbiAgICAgICAgICAgIGZldGNoUGFyYW1zTm90TmVlZGVkID0gWyByZWdpb24uZG9uZVBhcnRQYXJhbXMgXTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGlmIChyZWdpb25JZCAhPT0gUkVHSU9OX09WRVJWSUVXKSB7XHJcbiAgICAgICAgICAgIHZhciBhZGRlZFBlbmRpbmdDYWxsID0gdGhpcy5fY2hlY2tJZlJlcG9zaXRpb25OZWVkZWQoXHJcbiAgICAgICAgICAgICAgICByZWdpb24sIGltYWdlUGFydFBhcmFtcywgcG9zaXRpb24pO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgaWYgKGFkZGVkUGVuZGluZ0NhbGwpIHtcclxuICAgICAgICAgICAgICAgIHRoaXMuX25vdGlmeU5ld1BlbmRpbmdDYWxscygpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgXHJcbiAgICB2YXIgc2VsZiA9IHRoaXM7XHJcbiAgICBcclxuICAgIHZhciBtb3ZhYmxlSGFuZGxlID0gbW92ZUV4aXN0aW5nRmV0Y2ggPyB0aGlzLl9tb3ZhYmxlSGFuZGxlOiB1bmRlZmluZWQ7XHJcblxyXG4gICAgdGhpcy5faW1hZ2VEZWNvZGVyLnJlcXVlc3RQaXhlbHNQcm9ncmVzc2l2ZShcclxuICAgICAgICBmZXRjaFBhcmFtcy5pbWFnZVBhcnRQYXJhbXMsXHJcbiAgICAgICAgY2FsbGJhY2ssXHJcbiAgICAgICAgdGVybWluYXRlZENhbGxiYWNrLFxyXG4gICAgICAgIGZldGNoUGFyYW1zTm90TmVlZGVkLFxyXG4gICAgICAgIG1vdmFibGVIYW5kbGUpO1xyXG4gICAgXHJcbiAgICBmdW5jdGlvbiBjYWxsYmFjayhkZWNvZGVkKSB7XHJcbiAgICAgICAgc2VsZi5fdGlsZXNEZWNvZGVkQ2FsbGJhY2soXHJcbiAgICAgICAgICAgIHJlZ2lvbklkLFxyXG4gICAgICAgICAgICBmZXRjaFBhcmFtcyxcclxuICAgICAgICAgICAgcG9zaXRpb24sXHJcbiAgICAgICAgICAgIGRlY29kZWQpO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBmdW5jdGlvbiB0ZXJtaW5hdGVkQ2FsbGJhY2soaXNBYm9ydGVkKSB7XHJcbiAgICAgICAgaWYgKGlzQWJvcnRlZCAmJlxyXG4gICAgICAgICAgICBpbWFnZVBhcnRQYXJhbXMucmVxdWVzdFByaW9yaXR5RGF0YS5vdmVycmlkZUhpZ2hlc3RQcmlvcml0eSkge1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gTk9URTogQnVnIGluIGtkdV9zZXJ2ZXIgY2F1c2VzIGZpcnN0IHJlcXVlc3QgdG8gYmUgc2VudCB3cm9uZ2x5LlxyXG4gICAgICAgICAgICAvLyBUaGVuIENocm9tZSByYWlzZXMgRVJSX0lOVkFMSURfQ0hVTktFRF9FTkNPRElORyBhbmQgdGhlIHJlcXVlc3RcclxuICAgICAgICAgICAgLy8gbmV2ZXIgcmV0dXJucy4gVGh1cyBwZXJmb3JtIHNlY29uZCByZXF1ZXN0LlxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgc2VsZi5faW1hZ2VEZWNvZGVyLnJlcXVlc3RQaXhlbHNQcm9ncmVzc2l2ZShcclxuICAgICAgICAgICAgICAgIGZldGNoUGFyYW1zLmltYWdlUGFydFBhcmFtcyxcclxuICAgICAgICAgICAgICAgIGNhbGxiYWNrLFxyXG4gICAgICAgICAgICAgICAgdGVybWluYXRlZENhbGxiYWNrLFxyXG4gICAgICAgICAgICAgICAgZmV0Y2hQYXJhbXNOb3ROZWVkZWQpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBzZWxmLl9mZXRjaFRlcm1pbmF0ZWRDYWxsYmFjayhcclxuICAgICAgICAgICAgcmVnaW9uSWQsXHJcbiAgICAgICAgICAgIGZldGNoUGFyYW1zLmltYWdlUGFydFBhcmFtcy5yZXF1ZXN0UHJpb3JpdHlEYXRhLFxyXG4gICAgICAgICAgICBpc0Fib3J0ZWQsXHJcbiAgICAgICAgICAgIHN0YXJ0RHluYW1pY1JlZ2lvbk9uVGVybWluYXRpb24pO1xyXG4gICAgfVxyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVyVmlld2VyLnByb3RvdHlwZS5fZmV0Y2hUZXJtaW5hdGVkQ2FsbGJhY2sgPSBmdW5jdGlvbiBmZXRjaFRlcm1pbmF0ZWRDYWxsYmFjayhcclxuICAgIHJlZ2lvbklkLCBwcmlvcml0eURhdGEsIGlzQWJvcnRlZCwgc3RhcnREeW5hbWljUmVnaW9uT25UZXJtaW5hdGlvbikge1xyXG4gICAgXHJcbiAgICB2YXIgcmVnaW9uID0gdGhpcy5fcmVnaW9uc1tyZWdpb25JZF07XHJcbiAgICBpZiAocmVnaW9uID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGlmICghcHJpb3JpdHlEYXRhLm92ZXJyaWRlSGlnaGVzdFByaW9yaXR5ICYmXHJcbiAgICAgICAgcHJpb3JpdHlEYXRhLnJlcXVlc3RJbmRleCAhPT0gdGhpcy5fbGFzdFJlcXVlc3RJbmRleCkge1xyXG4gICAgXHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICByZWdpb24uaXNEb25lID0gIWlzQWJvcnRlZCAmJiB0aGlzLl9pc1JlYWR5O1xyXG4gICAgaWYgKHJlZ2lvbi5pc0RvbmUpIHtcclxuICAgICAgICByZWdpb24uZG9uZVBhcnRQYXJhbXMgPSByZWdpb24uaW1hZ2VQYXJ0UGFyYW1zO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBpZiAoc3RhcnREeW5hbWljUmVnaW9uT25UZXJtaW5hdGlvbikge1xyXG4gICAgICAgIHRoaXMuX2ltYWdlRGVjb2Rlci5jcmVhdGVNb3ZhYmxlRmV0Y2goKS50aGVuKHRoaXMuX2NyZWF0ZWRNb3ZhYmxlRmV0Y2hCb3VuZCk7XHJcbiAgICB9XHJcbn07XHJcblxyXG5JbWFnZURlY29kZXJWaWV3ZXIucHJvdG90eXBlLl9jcmVhdGVkTW92YWJsZUZldGNoID0gZnVuY3Rpb24gY3JlYXRlZE1vdmFibGVGZXRjaChtb3ZhYmxlSGFuZGxlKSB7XHJcbiAgICB0aGlzLl9tb3ZhYmxlSGFuZGxlID0gbW92YWJsZUhhbmRsZTtcclxuICAgIHRoaXMuX3N0YXJ0U2hvd2luZ0R5bmFtaWNSZWdpb24oKTtcclxufTtcclxuXHJcbkltYWdlRGVjb2RlclZpZXdlci5wcm90b3R5cGUuX3N0YXJ0U2hvd2luZ0R5bmFtaWNSZWdpb24gPSBmdW5jdGlvbiBzdGFydFNob3dpbmdEeW5hbWljUmVnaW9uKCkge1xyXG4gICAgdGhpcy5fY2FuU2hvd0R5bmFtaWNSZWdpb24gPSB0cnVlO1xyXG4gICAgXHJcbiAgICBpZiAodGhpcy5fcGVuZGluZ1VwZGF0ZVZpZXdBcmVhICE9PSBudWxsKSB7XHJcbiAgICAgICAgdGhpcy51cGRhdGVWaWV3QXJlYSh0aGlzLl9wZW5kaW5nVXBkYXRlVmlld0FyZWEpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHRoaXMuX3BlbmRpbmdVcGRhdGVWaWV3QXJlYSA9IG51bGw7XHJcbiAgICB9XHJcbn07XHJcblxyXG5JbWFnZURlY29kZXJWaWV3ZXIucHJvdG90eXBlLl90aWxlc0RlY29kZWRDYWxsYmFjayA9IGZ1bmN0aW9uIHRpbGVzRGVjb2RlZENhbGxiYWNrKFxyXG4gICAgcmVnaW9uSWQsIGZldGNoUGFyYW1zLCBwb3NpdGlvbiwgZGVjb2RlZCkge1xyXG4gICAgXHJcbiAgICBpZiAoIXRoaXMuX2lzUmVhZHkpIHtcclxuICAgICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHZhciByZWdpb24gPSB0aGlzLl9yZWdpb25zW3JlZ2lvbklkXTtcclxuICAgIGlmIChyZWdpb24gPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIHJlZ2lvbiA9IHt9O1xyXG4gICAgICAgIHRoaXMuX3JlZ2lvbnNbcmVnaW9uSWRdID0gcmVnaW9uO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHN3aXRjaCAocmVnaW9uSWQpIHtcclxuICAgICAgICAgICAgY2FzZSBSRUdJT05fRFlOQU1JQzpcclxuICAgICAgICAgICAgICAgIHJlZ2lvbi5jYW52YXMgPSB0aGlzLl90YXJnZXRDYW52YXM7XHJcbiAgICAgICAgICAgICAgICBicmVhaztcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBjYXNlIFJFR0lPTl9PVkVSVklFVzpcclxuICAgICAgICAgICAgICAgIHJlZ2lvbi5jYW52YXMgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdjYW52YXMnKTtcclxuICAgICAgICAgICAgICAgIGJyZWFrO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgZGVmYXVsdDpcclxuICAgICAgICAgICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IFVuZXhwZWN0ZWQgcmVnaW9uSWQgJyArIHJlZ2lvbklkO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuICAgIFxyXG4gICAgdmFyIHBhcnRQYXJhbXMgPSBmZXRjaFBhcmFtcy5pbWFnZVBhcnRQYXJhbXM7XHJcbiAgICBpZiAoIXBhcnRQYXJhbXMucmVxdWVzdFByaW9yaXR5RGF0YS5vdmVycmlkZUhpZ2hlc3RQcmlvcml0eSAmJlxyXG4gICAgICAgIHBhcnRQYXJhbXMucmVxdWVzdFByaW9yaXR5RGF0YS5yZXF1ZXN0SW5kZXggPCByZWdpb24uY3VycmVudERpc3BsYXlSZXF1ZXN0SW5kZXgpIHtcclxuICAgICAgICBcclxuICAgICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHRoaXMuX2NoZWNrSWZSZXBvc2l0aW9uTmVlZGVkKHJlZ2lvbiwgcGFydFBhcmFtcywgcG9zaXRpb24pO1xyXG4gICAgICAgIFxyXG4gICAgdGhpcy5fcGVuZGluZ0NhbGxiYWNrQ2FsbHMucHVzaCh7XHJcbiAgICAgICAgdHlwZTogUEVORElOR19DQUxMX1RZUEVfUElYRUxTX1VQREFURUQsXHJcbiAgICAgICAgcmVnaW9uOiByZWdpb24sXHJcbiAgICAgICAgZGVjb2RlZDogZGVjb2RlZFxyXG4gICAgfSk7XHJcbiAgICBcclxuICAgIHRoaXMuX25vdGlmeU5ld1BlbmRpbmdDYWxscygpO1xyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVyVmlld2VyLnByb3RvdHlwZS5fY2hlY2tJZlJlcG9zaXRpb25OZWVkZWQgPSBmdW5jdGlvbiBjaGVja0lmUmVwb3NpdGlvbk5lZWRlZChcclxuICAgIHJlZ2lvbiwgbmV3UGFydFBhcmFtcywgbmV3UG9zaXRpb24pIHtcclxuICAgIFxyXG4gICAgdmFyIG9sZFBhcnRQYXJhbXMgPSByZWdpb24uaW1hZ2VQYXJ0UGFyYW1zO1xyXG4gICAgdmFyIG9sZERvbmVQYXJ0UGFyYW1zID0gcmVnaW9uLmRvbmVQYXJ0UGFyYW1zO1xyXG4gICAgdmFyIGxldmVsID0gbmV3UGFydFBhcmFtcy5sZXZlbDtcclxuICAgIFxyXG4gICAgdmFyIG5lZWRSZXBvc2l0aW9uID1cclxuICAgICAgICBvbGRQYXJ0UGFyYW1zID09PSB1bmRlZmluZWQgfHxcclxuICAgICAgICBvbGRQYXJ0UGFyYW1zLm1pblggIT09IG5ld1BhcnRQYXJhbXMubWluWCB8fFxyXG4gICAgICAgIG9sZFBhcnRQYXJhbXMubWluWSAhPT0gbmV3UGFydFBhcmFtcy5taW5ZIHx8XHJcbiAgICAgICAgb2xkUGFydFBhcmFtcy5tYXhYRXhjbHVzaXZlICE9PSBuZXdQYXJ0UGFyYW1zLm1heFhFeGNsdXNpdmUgfHxcclxuICAgICAgICBvbGRQYXJ0UGFyYW1zLm1heFlFeGNsdXNpdmUgIT09IG5ld1BhcnRQYXJhbXMubWF4WUV4Y2x1c2l2ZSB8fFxyXG4gICAgICAgIG9sZFBhcnRQYXJhbXMubGV2ZWwgIT09IGxldmVsO1xyXG4gICAgXHJcbiAgICBpZiAoIW5lZWRSZXBvc2l0aW9uKSB7XHJcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICB2YXIgY29weURhdGE7XHJcbiAgICB2YXIgaW50ZXJzZWN0aW9uO1xyXG4gICAgdmFyIG5ld0RvbmVQYXJ0UGFyYW1zO1xyXG4gICAgdmFyIHJldXNlT2xkRGF0YSA9IGZhbHNlO1xyXG4gICAgdmFyIHNjYWxlWDtcclxuICAgIHZhciBzY2FsZVk7XHJcbiAgICBpZiAob2xkUGFydFBhcmFtcyAhPT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgc2NhbGVYID0gbmV3UGFydFBhcmFtcy5sZXZlbFdpZHRoICAvIG9sZFBhcnRQYXJhbXMubGV2ZWxXaWR0aDtcclxuICAgICAgICBzY2FsZVkgPSBuZXdQYXJ0UGFyYW1zLmxldmVsSGVpZ2h0IC8gb2xkUGFydFBhcmFtcy5sZXZlbEhlaWdodDtcclxuICAgICAgICBcclxuICAgICAgICBpbnRlcnNlY3Rpb24gPSB7XHJcbiAgICAgICAgICAgIG1pblg6IE1hdGgubWF4KG9sZFBhcnRQYXJhbXMubWluWCAqIHNjYWxlWCwgbmV3UGFydFBhcmFtcy5taW5YKSxcclxuICAgICAgICAgICAgbWluWTogTWF0aC5tYXgob2xkUGFydFBhcmFtcy5taW5ZICogc2NhbGVZLCBuZXdQYXJ0UGFyYW1zLm1pblkpLFxyXG4gICAgICAgICAgICBtYXhYOiBNYXRoLm1pbihvbGRQYXJ0UGFyYW1zLm1heFhFeGNsdXNpdmUgKiBzY2FsZVgsIG5ld1BhcnRQYXJhbXMubWF4WEV4Y2x1c2l2ZSksXHJcbiAgICAgICAgICAgIG1heFk6IE1hdGgubWluKG9sZFBhcnRQYXJhbXMubWF4WUV4Y2x1c2l2ZSAqIHNjYWxlWSwgbmV3UGFydFBhcmFtcy5tYXhZRXhjbHVzaXZlKVxyXG4gICAgICAgIH07XHJcbiAgICAgICAgcmV1c2VPbGREYXRhID1cclxuICAgICAgICAgICAgaW50ZXJzZWN0aW9uLm1heFggPiBpbnRlcnNlY3Rpb24ubWluWCAmJlxyXG4gICAgICAgICAgICBpbnRlcnNlY3Rpb24ubWF4WSA+IGludGVyc2VjdGlvbi5taW5ZO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBpZiAocmV1c2VPbGREYXRhKSB7XHJcbiAgICAgICAgY29weURhdGEgPSB7XHJcbiAgICAgICAgICAgIGZyb21YOiBpbnRlcnNlY3Rpb24ubWluWCAvIHNjYWxlWCAtIG9sZFBhcnRQYXJhbXMubWluWCxcclxuICAgICAgICAgICAgZnJvbVk6IGludGVyc2VjdGlvbi5taW5ZIC8gc2NhbGVZIC0gb2xkUGFydFBhcmFtcy5taW5ZLFxyXG4gICAgICAgICAgICBmcm9tV2lkdGggOiAoaW50ZXJzZWN0aW9uLm1heFggLSBpbnRlcnNlY3Rpb24ubWluWCkgLyBzY2FsZVgsXHJcbiAgICAgICAgICAgIGZyb21IZWlnaHQ6IChpbnRlcnNlY3Rpb24ubWF4WSAtIGludGVyc2VjdGlvbi5taW5ZKSAvIHNjYWxlWSxcclxuICAgICAgICAgICAgdG9YOiBpbnRlcnNlY3Rpb24ubWluWCAtIG5ld1BhcnRQYXJhbXMubWluWCxcclxuICAgICAgICAgICAgdG9ZOiBpbnRlcnNlY3Rpb24ubWluWSAtIG5ld1BhcnRQYXJhbXMubWluWSxcclxuICAgICAgICAgICAgdG9XaWR0aCA6IGludGVyc2VjdGlvbi5tYXhYIC0gaW50ZXJzZWN0aW9uLm1pblgsXHJcbiAgICAgICAgICAgIHRvSGVpZ2h0OiBpbnRlcnNlY3Rpb24ubWF4WSAtIGludGVyc2VjdGlvbi5taW5ZLFxyXG4gICAgICAgIH07XHJcbiAgICBcclxuICAgICAgICBpZiAob2xkRG9uZVBhcnRQYXJhbXMgJiYgb2xkUGFydFBhcmFtcy5sZXZlbCA9PT0gbGV2ZWwpIHtcclxuICAgICAgICAgICAgbmV3RG9uZVBhcnRQYXJhbXMgPSB7XHJcbiAgICAgICAgICAgICAgICBtaW5YOiBNYXRoLm1heChvbGREb25lUGFydFBhcmFtcy5taW5YLCBuZXdQYXJ0UGFyYW1zLm1pblgpLFxyXG4gICAgICAgICAgICAgICAgbWluWTogTWF0aC5tYXgob2xkRG9uZVBhcnRQYXJhbXMubWluWSwgbmV3UGFydFBhcmFtcy5taW5ZKSxcclxuICAgICAgICAgICAgICAgIG1heFhFeGNsdXNpdmU6IE1hdGgubWluKG9sZERvbmVQYXJ0UGFyYW1zLm1heFhFeGNsdXNpdmUsIG5ld1BhcnRQYXJhbXMubWF4WEV4Y2x1c2l2ZSksXHJcbiAgICAgICAgICAgICAgICBtYXhZRXhjbHVzaXZlOiBNYXRoLm1pbihvbGREb25lUGFydFBhcmFtcy5tYXhZRXhjbHVzaXZlLCBuZXdQYXJ0UGFyYW1zLm1heFlFeGNsdXNpdmUpXHJcbiAgICAgICAgICAgIH07XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgXHJcbiAgICByZWdpb24uaW1hZ2VQYXJ0UGFyYW1zID0gbmV3UGFydFBhcmFtcztcclxuICAgIHJlZ2lvbi5pc0RvbmUgPSBmYWxzZTtcclxuICAgIHJlZ2lvbi5jdXJyZW50RGlzcGxheVJlcXVlc3RJbmRleCA9IG5ld1BhcnRQYXJhbXMucmVxdWVzdFByaW9yaXR5RGF0YS5yZXF1ZXN0SW5kZXg7XHJcbiAgICBcclxuICAgIHZhciByZXBvc2l0aW9uQXJncyA9IHtcclxuICAgICAgICB0eXBlOiBQRU5ESU5HX0NBTExfVFlQRV9SRVBPU0lUSU9OLFxyXG4gICAgICAgIHJlZ2lvbjogcmVnaW9uLFxyXG4gICAgICAgIHBvc2l0aW9uOiBuZXdQb3NpdGlvbixcclxuICAgICAgICBkb25lUGFydFBhcmFtczogbmV3RG9uZVBhcnRQYXJhbXMsXHJcbiAgICAgICAgY29weURhdGE6IGNvcHlEYXRhLFxyXG4gICAgICAgIHBpeGVsc1dpZHRoOiBuZXdQYXJ0UGFyYW1zLm1heFhFeGNsdXNpdmUgLSBuZXdQYXJ0UGFyYW1zLm1pblgsXHJcbiAgICAgICAgcGl4ZWxzSGVpZ2h0OiBuZXdQYXJ0UGFyYW1zLm1heFlFeGNsdXNpdmUgLSBuZXdQYXJ0UGFyYW1zLm1pbllcclxuICAgIH07XHJcbiAgICBcclxuICAgIHRoaXMuX3BlbmRpbmdDYWxsYmFja0NhbGxzLnB1c2gocmVwb3NpdGlvbkFyZ3MpO1xyXG4gICAgXHJcbiAgICByZXR1cm4gdHJ1ZTtcclxufTtcclxuXHJcbkltYWdlRGVjb2RlclZpZXdlci5wcm90b3R5cGUuX25vdGlmeU5ld1BlbmRpbmdDYWxscyA9IGZ1bmN0aW9uIG5vdGlmeU5ld1BlbmRpbmdDYWxscygpIHtcclxuICAgIGlmICghdGhpcy5faXNOZWFyQ2FsbGJhY2tDYWxsZWQpIHtcclxuICAgICAgICB0aGlzLl9jYWxsUGVuZGluZ0NhbGxiYWNrcygpO1xyXG4gICAgfVxyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVyVmlld2VyLnByb3RvdHlwZS5fY2FsbFBlbmRpbmdDYWxsYmFja3MgPSBmdW5jdGlvbiBjYWxsUGVuZGluZ0NhbGxiYWNrcygpIHtcclxuICAgIGlmICh0aGlzLl9wZW5kaW5nQ2FsbGJhY2tDYWxscy5sZW5ndGggPT09IDAgfHwgIXRoaXMuX2lzUmVhZHkpIHtcclxuICAgICAgICB0aGlzLl9pc05lYXJDYWxsYmFja0NhbGxlZCA9IGZhbHNlO1xyXG4gICAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIFxyXG4gICAgaWYgKHRoaXMuX2lzTmVhckNhbGxiYWNrQ2FsbGVkKSB7XHJcbiAgICAgICAgY2xlYXJUaW1lb3V0KHRoaXMuX3BlbmRpbmdDYWxsYmFja3NJbnRlcnZhbEhhbmRsZSk7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGlmICh0aGlzLl9taW5GdW5jdGlvbkNhbGxJbnRlcnZhbE1pbGxpc2Vjb25kcyAhPT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgdGhpcy5fcGVuZGluZ0NhbGxiYWNrc0ludGVydmFsSGFuZGxlID1cclxuICAgICAgICAgICAgc2V0VGltZW91dCh0aGlzLl9jYWxsUGVuZGluZ0NhbGxiYWNrc0JvdW5kLFxyXG4gICAgICAgICAgICB0aGlzLl9taW5GdW5jdGlvbkNhbGxJbnRlcnZhbE1pbGxpc2Vjb25kcyk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgIHRoaXMuX2lzTmVhckNhbGxiYWNrQ2FsbGVkID0gdHJ1ZTtcclxuICAgIH1cclxuXHJcbiAgICB2YXIgbmV3UG9zaXRpb24gPSBudWxsO1xyXG4gICAgXHJcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IHRoaXMuX3BlbmRpbmdDYWxsYmFja0NhbGxzLmxlbmd0aDsgKytpKSB7XHJcbiAgICAgICAgdmFyIGNhbGxBcmdzID0gdGhpcy5fcGVuZGluZ0NhbGxiYWNrQ2FsbHNbaV07XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKGNhbGxBcmdzLnR5cGUgPT09IFBFTkRJTkdfQ0FMTF9UWVBFX1JFUE9TSVRJT04pIHtcclxuICAgICAgICAgICAgdGhpcy5fcmVwb3NpdGlvbkNhbnZhcyhjYWxsQXJncyk7XHJcbiAgICAgICAgICAgIG5ld1Bvc2l0aW9uID0gY2FsbEFyZ3MucG9zaXRpb247XHJcbiAgICAgICAgfSBlbHNlIGlmIChjYWxsQXJncy50eXBlID09PSBQRU5ESU5HX0NBTExfVFlQRV9QSVhFTFNfVVBEQVRFRCkge1xyXG4gICAgICAgICAgICB0aGlzLl9waXhlbHNVcGRhdGVkKGNhbGxBcmdzKTtcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBJbnRlcm5hbCBJbWFnZURlY29kZXJWaWV3ZXIgRXJyb3I6IFVuZXhwZWN0ZWQgY2FsbCB0eXBlICcgK1xyXG4gICAgICAgICAgICAgICAgY2FsbEFyZ3MudHlwZTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHRoaXMuX3BlbmRpbmdDYWxsYmFja0NhbGxzLmxlbmd0aCA9IDA7XHJcbiAgICBcclxuICAgIHRoaXMuX2NhbnZhc1VwZGF0ZWRDYWxsYmFjayhuZXdQb3NpdGlvbik7XHJcbn07XHJcblxyXG5JbWFnZURlY29kZXJWaWV3ZXIucHJvdG90eXBlLl9waXhlbHNVcGRhdGVkID0gZnVuY3Rpb24gcGl4ZWxzVXBkYXRlZChwaXhlbHNVcGRhdGVkQXJncykge1xyXG4gICAgdmFyIHJlZ2lvbiA9IHBpeGVsc1VwZGF0ZWRBcmdzLnJlZ2lvbjtcclxuICAgIHZhciBkZWNvZGVkID0gcGl4ZWxzVXBkYXRlZEFyZ3MuZGVjb2RlZDtcclxuICAgIGlmIChkZWNvZGVkLmltYWdlRGF0YS53aWR0aCA9PT0gMCB8fCBkZWNvZGVkLmltYWdlRGF0YS5oZWlnaHQgPT09IDApIHtcclxuICAgICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHZhciB4ID0gZGVjb2RlZC54SW5PcmlnaW5hbFJlcXVlc3Q7XHJcbiAgICB2YXIgeSA9IGRlY29kZWQueUluT3JpZ2luYWxSZXF1ZXN0O1xyXG4gICAgXHJcbiAgICB2YXIgY29udGV4dCA9IHJlZ2lvbi5jYW52YXMuZ2V0Q29udGV4dCgnMmQnKTtcclxuICAgIC8vdmFyIGltYWdlRGF0YSA9IGNvbnRleHQuY3JlYXRlSW1hZ2VEYXRhKGRlY29kZWQud2lkdGgsIGRlY29kZWQuaGVpZ2h0KTtcclxuICAgIC8vaW1hZ2VEYXRhLmRhdGEuc2V0KGRlY29kZWQucGl4ZWxzKTtcclxuICAgIFxyXG4gICAgY29udGV4dC5wdXRJbWFnZURhdGEoZGVjb2RlZC5pbWFnZURhdGEsIHgsIHkpO1xyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVyVmlld2VyLnByb3RvdHlwZS5fcmVwb3NpdGlvbkNhbnZhcyA9IGZ1bmN0aW9uIHJlcG9zaXRpb25DYW52YXMocmVwb3NpdGlvbkFyZ3MpIHtcclxuICAgIHZhciByZWdpb24gPSByZXBvc2l0aW9uQXJncy5yZWdpb247XHJcbiAgICB2YXIgcG9zaXRpb24gPSByZXBvc2l0aW9uQXJncy5wb3NpdGlvbjtcclxuICAgIHZhciBkb25lUGFydFBhcmFtcyA9IHJlcG9zaXRpb25BcmdzLmRvbmVQYXJ0UGFyYW1zO1xyXG4gICAgdmFyIGNvcHlEYXRhID0gcmVwb3NpdGlvbkFyZ3MuY29weURhdGE7XHJcbiAgICB2YXIgcGl4ZWxzV2lkdGggPSByZXBvc2l0aW9uQXJncy5waXhlbHNXaWR0aDtcclxuICAgIHZhciBwaXhlbHNIZWlnaHQgPSByZXBvc2l0aW9uQXJncy5waXhlbHNIZWlnaHQ7XHJcbiAgICBcclxuICAgIHZhciBpbWFnZURhdGFUb0NvcHk7XHJcbiAgICB2YXIgY29udGV4dCA9IHJlZ2lvbi5jYW52YXMuZ2V0Q29udGV4dCgnMmQnKTtcclxuICAgIFxyXG4gICAgaWYgKGNvcHlEYXRhICE9PSB1bmRlZmluZWQpIHtcclxuICAgICAgICBpZiAoY29weURhdGEuZnJvbVdpZHRoID09PSBjb3B5RGF0YS50b1dpZHRoICYmIGNvcHlEYXRhLmZyb21IZWlnaHQgPT09IGNvcHlEYXRhLnRvSGVpZ2h0KSB7XHJcbiAgICAgICAgICAgIGltYWdlRGF0YVRvQ29weSA9IGNvbnRleHQuZ2V0SW1hZ2VEYXRhKFxyXG4gICAgICAgICAgICAgICAgY29weURhdGEuZnJvbVgsIGNvcHlEYXRhLmZyb21ZLCBjb3B5RGF0YS5mcm9tV2lkdGgsIGNvcHlEYXRhLmZyb21IZWlnaHQpO1xyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgIGlmICghdGhpcy5fdG1wQ2FudmFzKSB7XHJcbiAgICAgICAgICAgICAgICB0aGlzLl90bXBDYW52YXMgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdjYW52YXMnKTtcclxuICAgICAgICAgICAgICAgIHRoaXMuX3RtcENhbnZhc0NvbnRleHQgPSB0aGlzLl90bXBDYW52YXMuZ2V0Q29udGV4dCgnMmQnKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgdGhpcy5fdG1wQ2FudmFzLndpZHRoICA9IGNvcHlEYXRhLnRvV2lkdGg7XHJcbiAgICAgICAgICAgIHRoaXMuX3RtcENhbnZhcy5oZWlnaHQgPSBjb3B5RGF0YS50b0hlaWdodDtcclxuICAgICAgICAgICAgdGhpcy5fdG1wQ2FudmFzQ29udGV4dC5kcmF3SW1hZ2UoXHJcbiAgICAgICAgICAgICAgICByZWdpb24uY2FudmFzLFxyXG4gICAgICAgICAgICAgICAgY29weURhdGEuZnJvbVgsIGNvcHlEYXRhLmZyb21ZLCBjb3B5RGF0YS5mcm9tV2lkdGgsIGNvcHlEYXRhLmZyb21IZWlnaHQsXHJcbiAgICAgICAgICAgICAgICAwLCAwLCBjb3B5RGF0YS50b1dpZHRoLCBjb3B5RGF0YS50b0hlaWdodCk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBpbWFnZURhdGFUb0NvcHkgPSB0aGlzLl90bXBDYW52YXNDb250ZXh0LmdldEltYWdlRGF0YShcclxuICAgICAgICAgICAgICAgIDAsIDAsIGNvcHlEYXRhLnRvV2lkdGgsIGNvcHlEYXRhLnRvSGVpZ2h0KTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHJlZ2lvbi5jYW52YXMud2lkdGggPSBwaXhlbHNXaWR0aDtcclxuICAgIHJlZ2lvbi5jYW52YXMuaGVpZ2h0ID0gcGl4ZWxzSGVpZ2h0O1xyXG4gICAgXHJcbiAgICBpZiAocmVnaW9uICE9PSB0aGlzLl9yZWdpb25zW1JFR0lPTl9PVkVSVklFV10pIHtcclxuICAgICAgICB0aGlzLl9jb3B5T3ZlcnZpZXdUb0NhbnZhcyhcclxuICAgICAgICAgICAgY29udGV4dCwgcG9zaXRpb24sIHBpeGVsc1dpZHRoLCBwaXhlbHNIZWlnaHQpO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBpZiAoY29weURhdGEgIT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIGNvbnRleHQucHV0SW1hZ2VEYXRhKGltYWdlRGF0YVRvQ29weSwgY29weURhdGEudG9YLCBjb3B5RGF0YS50b1kpO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICByZWdpb24ucG9zaXRpb24gPSBwb3NpdGlvbjtcclxuICAgIHJlZ2lvbi5kb25lUGFydFBhcmFtcyA9IGRvbmVQYXJ0UGFyYW1zO1xyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVyVmlld2VyLnByb3RvdHlwZS5fY29weU92ZXJ2aWV3VG9DYW52YXMgPSBmdW5jdGlvbiBjb3B5T3ZlcnZpZXdUb0NhbnZhcyhcclxuICAgIGNvbnRleHQsIGNhbnZhc1Bvc2l0aW9uLCBjYW52YXNQaXhlbHNXaWR0aCwgY2FudmFzUGl4ZWxzSGVpZ2h0KSB7XHJcbiAgICBcclxuICAgIHZhciBzb3VyY2VQb3NpdGlvbiA9IHRoaXMuX3JlZ2lvbnNbUkVHSU9OX09WRVJWSUVXXS5wb3NpdGlvbjtcclxuICAgIHZhciBzb3VyY2VQaXhlbHMgPVxyXG4gICAgICAgIHRoaXMuX3JlZ2lvbnNbUkVHSU9OX09WRVJWSUVXXS5pbWFnZVBhcnRQYXJhbXM7XHJcbiAgICBcclxuICAgIHZhciBzb3VyY2VQaXhlbHNXaWR0aCA9XHJcbiAgICAgICAgc291cmNlUGl4ZWxzLm1heFhFeGNsdXNpdmUgLSBzb3VyY2VQaXhlbHMubWluWDtcclxuICAgIHZhciBzb3VyY2VQaXhlbHNIZWlnaHQgPVxyXG4gICAgICAgIHNvdXJjZVBpeGVscy5tYXhZRXhjbHVzaXZlIC0gc291cmNlUGl4ZWxzLm1pblk7XHJcbiAgICBcclxuICAgIHZhciBzb3VyY2VQb3NpdGlvbldpZHRoID1cclxuICAgICAgICBzb3VyY2VQb3NpdGlvbi5lYXN0IC0gc291cmNlUG9zaXRpb24ud2VzdDtcclxuICAgIHZhciBzb3VyY2VQb3NpdGlvbkhlaWdodCA9XHJcbiAgICAgICAgc291cmNlUG9zaXRpb24ubm9ydGggLSBzb3VyY2VQb3NpdGlvbi5zb3V0aDtcclxuICAgICAgICBcclxuICAgIHZhciBzb3VyY2VSZXNvbHV0aW9uWCA9XHJcbiAgICAgICAgc291cmNlUGl4ZWxzV2lkdGggLyBzb3VyY2VQb3NpdGlvbldpZHRoO1xyXG4gICAgdmFyIHNvdXJjZVJlc29sdXRpb25ZID1cclxuICAgICAgICBzb3VyY2VQaXhlbHNIZWlnaHQgLyBzb3VyY2VQb3NpdGlvbkhlaWdodDtcclxuICAgIFxyXG4gICAgdmFyIHRhcmdldFBvc2l0aW9uV2lkdGggPVxyXG4gICAgICAgIGNhbnZhc1Bvc2l0aW9uLmVhc3QgLSBjYW52YXNQb3NpdGlvbi53ZXN0O1xyXG4gICAgdmFyIHRhcmdldFBvc2l0aW9uSGVpZ2h0ID1cclxuICAgICAgICBjYW52YXNQb3NpdGlvbi5ub3J0aCAtIGNhbnZhc1Bvc2l0aW9uLnNvdXRoO1xyXG4gICAgICAgIFxyXG4gICAgdmFyIGNyb3BXaWR0aCA9IHRhcmdldFBvc2l0aW9uV2lkdGggKiBzb3VyY2VSZXNvbHV0aW9uWDtcclxuICAgIHZhciBjcm9wSGVpZ2h0ID0gdGFyZ2V0UG9zaXRpb25IZWlnaHQgKiBzb3VyY2VSZXNvbHV0aW9uWTtcclxuICAgIFxyXG4gICAgdmFyIGNyb3BPZmZzZXRQb3NpdGlvblggPVxyXG4gICAgICAgIGNhbnZhc1Bvc2l0aW9uLndlc3QgLSBzb3VyY2VQb3NpdGlvbi53ZXN0O1xyXG4gICAgdmFyIGNyb3BPZmZzZXRQb3NpdGlvblkgPVxyXG4gICAgICAgIHNvdXJjZVBvc2l0aW9uLm5vcnRoIC0gY2FudmFzUG9zaXRpb24ubm9ydGg7XHJcbiAgICAgICAgXHJcbiAgICB2YXIgY3JvcFBpeGVsT2Zmc2V0WCA9IGNyb3BPZmZzZXRQb3NpdGlvblggKiBzb3VyY2VSZXNvbHV0aW9uWDtcclxuICAgIHZhciBjcm9wUGl4ZWxPZmZzZXRZID0gY3JvcE9mZnNldFBvc2l0aW9uWSAqIHNvdXJjZVJlc29sdXRpb25ZO1xyXG4gICAgXHJcbiAgICBjb250ZXh0LmRyYXdJbWFnZShcclxuICAgICAgICB0aGlzLl9yZWdpb25zW1JFR0lPTl9PVkVSVklFV10uY2FudmFzLFxyXG4gICAgICAgIGNyb3BQaXhlbE9mZnNldFgsIGNyb3BQaXhlbE9mZnNldFksIGNyb3BXaWR0aCwgY3JvcEhlaWdodCxcclxuICAgICAgICAwLCAwLCBjYW52YXNQaXhlbHNXaWR0aCwgY2FudmFzUGl4ZWxzSGVpZ2h0KTtcclxufTtcclxuXHJcbkltYWdlRGVjb2RlclZpZXdlci5wcm90b3R5cGUuX29wZW5lZCA9IGZ1bmN0aW9uIG9wZW5lZCgpIHtcclxuICAgIHRoaXMuX2lzUmVhZHkgPSB0cnVlO1xyXG4gICAgXHJcbiAgICB2YXIgZml4ZWRCb3VuZHMgPSB7XHJcbiAgICAgICAgd2VzdDogdGhpcy5fY2FydG9ncmFwaGljQm91bmRzLndlc3QsXHJcbiAgICAgICAgZWFzdDogdGhpcy5fY2FydG9ncmFwaGljQm91bmRzLmVhc3QsXHJcbiAgICAgICAgc291dGg6IHRoaXMuX2NhcnRvZ3JhcGhpY0JvdW5kcy5zb3V0aCxcclxuICAgICAgICBub3J0aDogdGhpcy5fY2FydG9ncmFwaGljQm91bmRzLm5vcnRoXHJcbiAgICB9O1xyXG4gICAgaW1hZ2VIZWxwZXJGdW5jdGlvbnMuZml4Qm91bmRzKFxyXG4gICAgICAgIGZpeGVkQm91bmRzLCB0aGlzLl9pbWFnZURlY29kZXIsIHRoaXMuX2FkYXB0UHJvcG9ydGlvbnMpO1xyXG4gICAgdGhpcy5fY2FydG9ncmFwaGljQm91bmRzRml4ZWQgPSBmaXhlZEJvdW5kcztcclxuICAgIFxyXG4gICAgdmFyIGltYWdlV2lkdGggID0gdGhpcy5faW1hZ2VEZWNvZGVyLmdldEltYWdlV2lkdGggKCk7XHJcbiAgICB2YXIgaW1hZ2VIZWlnaHQgPSB0aGlzLl9pbWFnZURlY29kZXIuZ2V0SW1hZ2VIZWlnaHQoKTtcclxuICAgIHRoaXMuX3F1YWxpdHkgPSB0aGlzLl9pbWFnZURlY29kZXIuZ2V0SGlnaGVzdFF1YWxpdHkoKTtcclxuXHJcbiAgICB2YXIgcmVjdGFuZ2xlV2lkdGggPSBmaXhlZEJvdW5kcy5lYXN0IC0gZml4ZWRCb3VuZHMud2VzdDtcclxuICAgIHZhciByZWN0YW5nbGVIZWlnaHQgPSBmaXhlZEJvdW5kcy5ub3J0aCAtIGZpeGVkQm91bmRzLnNvdXRoO1xyXG4gICAgdGhpcy5fc2NhbGVYID0gaW1hZ2VXaWR0aCAvIHJlY3RhbmdsZVdpZHRoO1xyXG4gICAgdGhpcy5fc2NhbGVZID0gLWltYWdlSGVpZ2h0IC8gcmVjdGFuZ2xlSGVpZ2h0O1xyXG4gICAgXHJcbiAgICB0aGlzLl90cmFuc2xhdGVYID0gLWZpeGVkQm91bmRzLndlc3QgKiB0aGlzLl9zY2FsZVg7XHJcbiAgICB0aGlzLl90cmFuc2xhdGVZID0gLWZpeGVkQm91bmRzLm5vcnRoICogdGhpcy5fc2NhbGVZO1xyXG4gICAgXHJcbiAgICB2YXIgb3ZlcnZpZXdQYXJhbXMgPSB7XHJcbiAgICAgICAgbWluWDogMCxcclxuICAgICAgICBtaW5ZOiAwLFxyXG4gICAgICAgIG1heFhFeGNsdXNpdmU6IGltYWdlV2lkdGgsXHJcbiAgICAgICAgbWF4WUV4Y2x1c2l2ZTogaW1hZ2VIZWlnaHQsXHJcbiAgICAgICAgc2NyZWVuV2lkdGg6IHRoaXMuX292ZXJ2aWV3UmVzb2x1dGlvblgsXHJcbiAgICAgICAgc2NyZWVuSGVpZ2h0OiB0aGlzLl9vdmVydmlld1Jlc29sdXRpb25ZXHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICB2YXIgb3ZlcnZpZXdBbGlnbmVkUGFyYW1zID1cclxuICAgICAgICBpbWFnZUhlbHBlckZ1bmN0aW9ucy5hbGlnblBhcmFtc1RvVGlsZXNBbmRMZXZlbChcclxuICAgICAgICAgICAgb3ZlcnZpZXdQYXJhbXMsIHRoaXMuX2ltYWdlRGVjb2Rlcik7XHJcbiAgICAgICAgICAgIFxyXG4gICAgb3ZlcnZpZXdBbGlnbmVkUGFyYW1zLmltYWdlUGFydFBhcmFtcy5yZXF1ZXN0UHJpb3JpdHlEYXRhID1cclxuICAgICAgICBvdmVydmlld0FsaWduZWRQYXJhbXMuaW1hZ2VQYXJ0UGFyYW1zLnJlcXVlc3RQcmlvcml0eURhdGEgfHwge307XHJcbiAgICBcclxuICAgIG92ZXJ2aWV3QWxpZ25lZFBhcmFtcy5pbWFnZVBhcnRQYXJhbXMucmVxdWVzdFByaW9yaXR5RGF0YS5vdmVycmlkZUhpZ2hlc3RQcmlvcml0eSA9IHRydWU7XHJcbiAgICBvdmVydmlld0FsaWduZWRQYXJhbXMuaW1hZ2VQYXJ0UGFyYW1zLnF1YWxpdHkgPSB0aGlzLl9pbWFnZURlY29kZXIuZ2V0TG93ZXN0UXVhbGl0eSgpO1xyXG4gICAgXHJcbiAgICB2YXIgc3RhcnREeW5hbWljUmVnaW9uT25UZXJtaW5hdGlvbiA9XHJcbiAgICAgICAgIXRoaXMuX2FsbG93TXVsdGlwbGVNb3ZhYmxlRmV0Y2hlc0luU2Vzc2lvbjtcclxuICAgICAgICBcclxuICAgIHRoaXMuX2ZldGNoKFxyXG4gICAgICAgIFJFR0lPTl9PVkVSVklFVyxcclxuICAgICAgICBvdmVydmlld0FsaWduZWRQYXJhbXMsXHJcbiAgICAgICAgc3RhcnREeW5hbWljUmVnaW9uT25UZXJtaW5hdGlvbik7XHJcbiAgICBcclxuICAgIGlmICh0aGlzLl9hbGxvd011bHRpcGxlTW92YWJsZUZldGNoZXNJblNlc3Npb24pIHtcclxuICAgICAgICB0aGlzLl9zdGFydFNob3dpbmdEeW5hbWljUmVnaW9uKCk7XHJcbiAgICB9XHJcbn07IiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBJbWFnZVBhcmFtc1JldHJpZXZlclByb3h5O1xyXG5cclxuZnVuY3Rpb24gSW1hZ2VQYXJhbXNSZXRyaWV2ZXJQcm94eSgpIHtcclxuICAgIHRoaXMuX3NpemVzUGFyYW1zID0gbnVsbDtcclxufVxyXG5cclxuSW1hZ2VQYXJhbXNSZXRyaWV2ZXJQcm94eS5wcm90b3R5cGUuZ2V0SW1hZ2VMZXZlbCA9IGZ1bmN0aW9uIGdldEltYWdlTGV2ZWwoKSB7XHJcbiAgICB2YXIgc2l6ZXNQYXJhbXMgPSB0aGlzLmdldEltYWdlUGFyYW1zKCk7XHJcblxyXG4gICAgcmV0dXJuIHNpemVzUGFyYW1zLmltYWdlTGV2ZWw7XHJcbn07XHJcblxyXG5JbWFnZVBhcmFtc1JldHJpZXZlclByb3h5LnByb3RvdHlwZS5nZXRJbWFnZVdpZHRoID0gZnVuY3Rpb24gZ2V0SW1hZ2VXaWR0aCgpIHtcclxuICAgIHZhciBzaXplc1BhcmFtcyA9IHRoaXMuZ2V0SW1hZ2VQYXJhbXMoKTtcclxuXHJcbiAgICByZXR1cm4gc2l6ZXNQYXJhbXMuaW1hZ2VXaWR0aDtcclxufTtcclxuXHJcbkltYWdlUGFyYW1zUmV0cmlldmVyUHJveHkucHJvdG90eXBlLmdldEltYWdlSGVpZ2h0ID0gZnVuY3Rpb24gZ2V0SW1hZ2VIZWlnaHQoKSB7XHJcbiAgICB2YXIgc2l6ZXNQYXJhbXMgPSB0aGlzLmdldEltYWdlUGFyYW1zKCk7XHJcblxyXG4gICAgcmV0dXJuIHNpemVzUGFyYW1zLmltYWdlSGVpZ2h0O1xyXG59O1xyXG5cclxuSW1hZ2VQYXJhbXNSZXRyaWV2ZXJQcm94eS5wcm90b3R5cGUuZ2V0TnVtUmVzb2x1dGlvbkxldmVsc0ZvckxpbWl0dGVkVmlld2VyID0gZnVuY3Rpb24gZ2V0TnVtUmVzb2x1dGlvbkxldmVsc0ZvckxpbWl0dGVkVmlld2VyKCkge1xyXG4gICAgdmFyIHNpemVzUGFyYW1zID0gdGhpcy5nZXRJbWFnZVBhcmFtcygpO1xyXG5cclxuICAgIHJldHVybiBzaXplc1BhcmFtcy5udW1SZXNvbHV0aW9uTGV2ZWxzRm9yTGltaXR0ZWRWaWV3ZXI7XHJcbn07XHJcblxyXG5JbWFnZVBhcmFtc1JldHJpZXZlclByb3h5LnByb3RvdHlwZS5nZXRMb3dlc3RRdWFsaXR5ID0gZnVuY3Rpb24gZ2V0TG93ZXN0UXVhbGl0eSgpIHtcclxuICAgIHZhciBzaXplc1BhcmFtcyA9IHRoaXMuZ2V0SW1hZ2VQYXJhbXMoKTtcclxuXHJcbiAgICByZXR1cm4gc2l6ZXNQYXJhbXMubG93ZXN0UXVhbGl0eTtcclxufTtcclxuXHJcbkltYWdlUGFyYW1zUmV0cmlldmVyUHJveHkucHJvdG90eXBlLmdldEhpZ2hlc3RRdWFsaXR5ID0gZnVuY3Rpb24gZ2V0SGlnaGVzdFF1YWxpdHkoKSB7XHJcbiAgICB2YXIgc2l6ZXNQYXJhbXMgPSB0aGlzLmdldEltYWdlUGFyYW1zKCk7XHJcblxyXG4gICAgcmV0dXJuIHNpemVzUGFyYW1zLmhpZ2hlc3RRdWFsaXR5O1xyXG59O1xyXG5cclxuSW1hZ2VQYXJhbXNSZXRyaWV2ZXJQcm94eS5wcm90b3R5cGUuZ2V0SW1hZ2VQYXJhbXMgPSBmdW5jdGlvbiBnZXRJbWFnZVBhcmFtcygpIHtcclxuICAgIGlmICghdGhpcy5fc2l6ZXNQYXJhbXMpIHtcclxuICAgICAgICB0aGlzLl9zaXplc1BhcmFtcyA9IHRoaXMuX2dldEltYWdlUGFyYW1zSW50ZXJuYWwoKTtcclxuICAgICAgICBpZiAoIXRoaXMuX3NpemVzUGFyYW1zKSB7XHJcbiAgICAgICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IGdldEltYWdlUGFyYW1zSW50ZXJuYWwoKSByZXR1cm5lZCBmYWxzeSB2YWx1ZTsgTWF5YmUgaW1hZ2Ugbm90IHJlYWR5IHlldD8nO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBpZiAodGhpcy5fc2l6ZXNQYXJhbXMuaW1hZ2VMZXZlbCA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IGdldEltYWdlUGFyYW1zSW50ZXJuYWwoKSByZXN1bHQgaGFzIG5vIGltYWdlTGV2ZWwgcHJvcGVydHknO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBpZiAodGhpcy5fc2l6ZXNQYXJhbXMuaW1hZ2VXaWR0aCA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IGdldEltYWdlUGFyYW1zSW50ZXJuYWwoKSByZXN1bHQgaGFzIG5vIGltYWdlV2lkdGggcHJvcGVydHknO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBpZiAodGhpcy5fc2l6ZXNQYXJhbXMuaW1hZ2VIZWlnaHQgPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBnZXRJbWFnZVBhcmFtc0ludGVybmFsKCkgcmVzdWx0IGhhcyBubyBpbWFnZUhlaWdodCBwcm9wZXJ0eSc7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIGlmICh0aGlzLl9zaXplc1BhcmFtcy5udW1SZXNvbHV0aW9uTGV2ZWxzRm9yTGltaXR0ZWRWaWV3ZXIgPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBnZXRJbWFnZVBhcmFtc0ludGVybmFsKCkgcmVzdWx0IGhhcyBubyBudW1SZXNvbHV0aW9uTGV2ZWxzRm9yTGltaXR0ZWRWaWV3ZXIgcHJvcGVydHknO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBpZiAodGhpcy5fc2l6ZXNQYXJhbXMubG93ZXN0UXVhbGl0eSA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IGdldEltYWdlUGFyYW1zSW50ZXJuYWwoKSByZXN1bHQgaGFzIG5vIGxvd2VzdFF1YWxpdHkgcHJvcGVydHknO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBpZiAodGhpcy5fc2l6ZXNQYXJhbXMuaGlnaGVzdFF1YWxpdHkgPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBnZXRJbWFnZVBhcmFtc0ludGVybmFsKCkgcmVzdWx0IGhhcyBubyBoaWdoZXN0UXVhbGl0eSBwcm9wZXJ0eSc7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgXHJcbiAgICByZXR1cm4gdGhpcy5fc2l6ZXNQYXJhbXM7XHJcbn07XHJcblxyXG5JbWFnZVBhcmFtc1JldHJpZXZlclByb3h5LnByb3RvdHlwZS5fZ2V0SW1hZ2VQYXJhbXNJbnRlcm5hbCA9IGZ1bmN0aW9uIGdldEltYWdlUGFyYW1zSW50ZXJuYWwoKSB7XHJcbiAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBJbWFnZVBhcmFtc1JldHJpZXZlclByb3h5IGluaGVyaXRvciBkaWQgbm90IGltcGxlbWVudCBfZ2V0SW1hZ2VQYXJhbXNJbnRlcm5hbCgpJztcclxufTsiLCIndXNlIHN0cmljdCc7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IFdvcmtlclByb3h5RmV0Y2hNYW5hZ2VyO1xyXG5cclxuZnVuY3Rpb24gV29ya2VyUHJveHlGZXRjaE1hbmFnZXIoZmV0Y2hlciwgb3B0aW9ucykge1xyXG4gICAgdGhpcy5fb3B0aW9ucyA9IG9wdGlvbnMgfHwge307XHJcbiAgICB0aGlzLl9pbnRlcm5hbFNpemVzUGFyYW1zID0gbnVsbDtcclxuICAgIHRoaXMuX3RpbGVXaWR0aCA9IDA7XHJcbiAgICB0aGlzLl90aWxlSGVpZ2h0ID0gMDtcclxuXHJcbiAgICBhc3luY1Byb3h5LkFzeW5jUHJveHlGYWN0b3J5LmluaXRpYWxpemUoXHJcbiAgICAgICAgdGhpcywgZmV0Y2hlci5zY3JpcHRzVG9JbXBvcnQsICdpbWFnZURlY29kZXJGcmFtZXdvcmsuRmV0Y2hNYW5hZ2VyJywgW2ZldGNoZXIsIG9wdGlvbnNdKTtcclxufVxyXG5cclxuYXN5bmNQcm94eS5Bc3luY1Byb3h5RmFjdG9yeS5hZGRNZXRob2RzKFdvcmtlclByb3h5RmV0Y2hNYW5hZ2VyLCB7XHJcbiAgICBjbG9zZTogW3tpc1JldHVyblByb21pc2U6IHRydWV9XSxcclxuICAgIHNldFByaW9yaXRpemVyVHlwZTogW10sXHJcbiAgICBzZXRGZXRjaFByaW9yaXRpemVyRGF0YTogW10sXHJcbiAgICBzZXRJc1Byb2dyZXNzaXZlUmVxdWVzdDogW10sXHJcbiAgICBjcmVhdGVNb3ZhYmxlRmV0Y2g6IFt7aXNSZXR1cm5Qcm9taXNlOiB0cnVlfV0sXHJcbiAgICBtb3ZlRmV0Y2g6IFtdLFxyXG4gICAgY3JlYXRlUmVxdWVzdDogW10sXHJcbiAgICBtYW51YWxBYm9ydFJlcXVlc3Q6IFtdXHJcbn0pO1xyXG5cclxuV29ya2VyUHJveHlGZXRjaE1hbmFnZXIucHJvdG90eXBlLm9wZW4gPSBmdW5jdGlvbiBvcGVuKG9wZW5BcmcpIHtcclxuICAgIHZhciBzZWxmID0gdGhpcztcclxuICAgIHZhciB3b3JrZXJIZWxwZXIgPSBhc3luY1Byb3h5LkFzeW5jUHJveHlGYWN0b3J5LmdldFdvcmtlckhlbHBlcih0aGlzKTtcclxuXHJcbiAgICByZXR1cm4gd29ya2VySGVscGVyLmNhbGxGdW5jdGlvbignb3BlbicsIFtvcGVuQXJnXSwgeyBpc1JldHVyblByb21pc2U6IHRydWUgfSlcclxuICAgICAgICAudGhlbihmdW5jdGlvbihkYXRhKSB7XHJcbiAgICAgICAgICAgIHNlbGYuX2ludGVybmFsU2l6ZXNQYXJhbXMgPSBkYXRhO1xyXG4gICAgICAgICAgICBzZWxmLmdldEltYWdlUGFyYW1zKCk7XHJcbiAgICAgICAgICAgIHJldHVybiBkYXRhO1xyXG4gICAgICAgIH0pO1xyXG59O1xyXG5cclxuV29ya2VyUHJveHlGZXRjaE1hbmFnZXIucHJvdG90eXBlLmdldEltYWdlUGFyYW1zID0gZnVuY3Rpb24gZ2V0SW1hZ2VQYXJhbXMoKSB7XHJcbiAgICBpZiAoIXRoaXMuX2ludGVybmFsU2l6ZXNQYXJhbXMpIHtcclxuICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBub3Qgb3BlbmVkIHlldCc7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gdGhpcy5faW50ZXJuYWxTaXplc1BhcmFtcztcclxufTtcclxuXHJcbldvcmtlclByb3h5RmV0Y2hNYW5hZ2VyLnByb3RvdHlwZS5vbiA9IGZ1bmN0aW9uIG9uKGV2ZW50LCBjYWxsYmFjaykge1xyXG4gICAgdmFyIHRyYW5zZmVyYWJsZVBhdGhzID0gdGhpcy5fb3B0aW9ucy50cmFuc2ZlcmFibGVQYXRoc09mRGF0YUNhbGxiYWNrO1xyXG4gICAgdmFyIHdvcmtlckhlbHBlciA9IGFzeW5jUHJveHkuQXN5bmNQcm94eUZhY3RvcnkuZ2V0V29ya2VySGVscGVyKHRoaXMpO1xyXG4gICAgXHJcbiAgICB2YXIgY2FsbGJhY2tXcmFwcGVyID0gd29ya2VySGVscGVyLndyYXBDYWxsYmFjayhcclxuICAgICAgICBjYWxsYmFjaywgZXZlbnQgKyAnLWNhbGxiYWNrJywge1xyXG4gICAgICAgICAgICBpc011bHRpcGxlVGltZUNhbGxiYWNrOiB0cnVlLFxyXG4gICAgICAgICAgICBwYXRoc1RvVHJhbnNmZXJhYmxlczogdHJhbnNmZXJhYmxlUGF0aHNcclxuICAgICAgICB9XHJcbiAgICApO1xyXG4gICAgXHJcbiAgICByZXR1cm4gd29ya2VySGVscGVyLmNhbGxGdW5jdGlvbignb24nLCBbZXZlbnQsIGNhbGxiYWNrV3JhcHBlcl0pO1xyXG59OyIsIid1c2Ugc3RyaWN0JztcclxuXHJcbnZhciBJbWFnZVBhcmFtc1JldHJpZXZlclByb3h5ID0gcmVxdWlyZSgnaW1hZ2UtcGFyYW1zLXJldHJpZXZlci1wcm94eS5qcycpO1xyXG52YXIgaW1hZ2VIZWxwZXJGdW5jdGlvbnMgPSByZXF1aXJlKCdpbWFnZS1oZWxwZXItZnVuY3Rpb25zLmpzJyk7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IFdvcmtlclByb3h5SW1hZ2VEZWNvZGVyO1xyXG5cclxuZnVuY3Rpb24gV29ya2VyUHJveHlJbWFnZURlY29kZXIoaW1hZ2UsIG9wdGlvbnMpIHtcclxuICAgIEltYWdlUGFyYW1zUmV0cmlldmVyUHJveHkuY2FsbCh0aGlzKTtcclxuICAgIFxyXG4gICAgaWYgKCdmdW5jdGlvbicgIT09IHR5cGVvZiBpbWFnZS5jcmVhdGVMZXZlbENhbGN1bGF0b3IpIHtcclxuICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBNaXNzaW5nIG1ldGhvZCBpbWFnZS5jcmVhdGVMZXZlbENhbGN1bGF0b3IoKSc7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGFzeW5jUHJveHkuQXN5bmNQcm94eUZhY3RvcnkuaW5pdGlhbGl6ZShcclxuICAgICAgICB0aGlzLFxyXG4gICAgICAgIGltYWdlLnNjcmlwdHNUb0ltcG9ydCxcclxuICAgICAgICAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrLkltYWdlRGVjb2RlcicsXHJcbiAgICAgICAgW3tjdG9yTmFtZTogaW1hZ2UuY3Rvck5hbWV9LCBvcHRpb25zXSk7XHJcbiAgICBcclxuICAgIHRoaXMuX2ltYWdlID0gaW1hZ2U7XHJcbiAgICB0aGlzLl9sZXZlbENhbGN1bGF0b3IgPSBudWxsO1xyXG4gICAgdGhpcy5faW50ZXJuYWxTaXplc1BhcmFtcyA9IG51bGw7XHJcbiAgICB0aGlzLl90aWxlV2lkdGggPSAwO1xyXG4gICAgdGhpcy5fdGlsZUhlaWdodCA9IDA7XHJcbn1cclxuXHJcbldvcmtlclByb3h5SW1hZ2VEZWNvZGVyLnByb3RvdHlwZSA9IE9iamVjdC5jcmVhdGUoSW1hZ2VQYXJhbXNSZXRyaWV2ZXJQcm94eS5wcm90b3R5cGUpO1xyXG5cclxuYXN5bmNQcm94eS5Bc3luY1Byb3h5RmFjdG9yeS5hZGRNZXRob2RzKFdvcmtlclByb3h5SW1hZ2VEZWNvZGVyLCB7XHJcbiAgICBzZXRGZXRjaFByaW9yaXRpemVyRGF0YTogW10sXHJcbiAgICBzZXREZWNvZGVQcmlvcml0aXplckRhdGE6IFtdLFxyXG4gICAgc2V0RmV0Y2hQcmlvcml0aXplclR5cGU6IFtdLFxyXG4gICAgc2V0RGVjb2RlUHJpb3JpdGl6ZXJUeXBlOiBbXSxcclxuICAgIGNsb3NlOiBbe2lzUmV0dXJuUHJvbWlzZTogdHJ1ZX1dLFxyXG4gICAgY3JlYXRlTW92YWJsZUZldGNoOiBbe2lzUmV0dXJuUHJvbWlzZTogdHJ1ZX1dLFxyXG4gICAgcmVxdWVzdFBpeGVsczogW3tpc1JldHVyblByb21pc2U6IHRydWV9XVxyXG59KTtcclxuXHJcbldvcmtlclByb3h5SW1hZ2VEZWNvZGVyLnByb3RvdHlwZS5vcGVuID0gZnVuY3Rpb24gb3BlbihvcGVuQXJnKSB7XHJcbiAgICB2YXIgc2VsZiA9IHRoaXM7XHJcbiAgICB2YXIgd29ya2VySGVscGVyID0gYXN5bmNQcm94eS5Bc3luY1Byb3h5RmFjdG9yeS5nZXRXb3JrZXJIZWxwZXIodGhpcyk7XHJcbiAgICByZXR1cm4gd29ya2VySGVscGVyLmNhbGxGdW5jdGlvbignb3BlbicsIFtvcGVuQXJnXSwgeyBpc1JldHVyblByb21pc2U6IHRydWUgfSlcclxuICAgICAgICAudGhlbihmdW5jdGlvbihkYXRhKSB7XHJcbiAgICAgICAgICAgIHNlbGYuX2ludGVybmFsU2l6ZXNQYXJhbXMgPSBkYXRhLnNpemVzUGFyYW1zO1xyXG4gICAgICAgICAgICBzZWxmLl90aWxlV2lkdGggPSBkYXRhLmFwcGxpY2F0aXZlVGlsZVdpZHRoO1xyXG4gICAgICAgICAgICBzZWxmLl90aWxlSGVpZ2h0ID0gZGF0YS5hcHBsaWNhdGl2ZVRpbGVIZWlnaHQ7XHJcbiAgICAgICAgICAgIHNlbGYuZ2V0SW1hZ2VQYXJhbXMoKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHNlbGYuX2xldmVsQ2FsY3VsYXRvciA9IHNlbGYuX2ltYWdlLmNyZWF0ZUxldmVsQ2FsY3VsYXRvcihzZWxmKTtcclxuICAgICAgICAgICAgaW1hZ2VIZWxwZXJGdW5jdGlvbnMuZW5zdXJlTGV2ZWxDYWxjdWxhdG9yKHNlbGYuX2xldmVsQ2FsY3VsYXRvcik7XHJcbiAgICAgICAgICAgIHJldHVybiBkYXRhO1xyXG4gICAgICAgIH0pO1xyXG59O1xyXG5cclxuV29ya2VyUHJveHlJbWFnZURlY29kZXIucHJvdG90eXBlLl9nZXRJbWFnZVBhcmFtc0ludGVybmFsID0gZnVuY3Rpb24gZ2V0SW1hZ2VQYXJhbXNJbnRlcm5hbCgpIHtcclxuICAgIGlmICghdGhpcy5faW50ZXJuYWxTaXplc1BhcmFtcykge1xyXG4gICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IG5vdCBvcGVuZWQgeWV0JztcclxuICAgIH1cclxuICAgIHJldHVybiB0aGlzLl9pbnRlcm5hbFNpemVzUGFyYW1zO1xyXG59O1xyXG5cclxuV29ya2VyUHJveHlJbWFnZURlY29kZXIucHJvdG90eXBlLmdldFRpbGVXaWR0aCA9IGZ1bmN0aW9uIGdldFRpbGVXaWR0aCgpIHtcclxuICAgIHRoaXMuX2dldEltYWdlUGFyYW1zSW50ZXJuYWwoKTsgLy8gZW5zdXJlIGFscmVhZHkgb3BlbmVkXHJcbiAgICByZXR1cm4gdGhpcy5fdGlsZVdpZHRoO1xyXG59O1xyXG5cclxuV29ya2VyUHJveHlJbWFnZURlY29kZXIucHJvdG90eXBlLmdldFRpbGVIZWlnaHQgPSBmdW5jdGlvbiBnZXRUaWxlSGVpZ2h0KCkge1xyXG4gICAgdGhpcy5fZ2V0SW1hZ2VQYXJhbXNJbnRlcm5hbCgpOyAvLyBlbnN1cmUgYWxyZWFkeSBvcGVuZWRcclxuICAgIHJldHVybiB0aGlzLl90aWxlSGVpZ2h0O1xyXG59O1xyXG5cclxuV29ya2VyUHJveHlJbWFnZURlY29kZXIucHJvdG90eXBlLm9uRmV0Y2hlckV2ZW50ID0gZnVuY3Rpb24gb25GZXRjaGVyRXZlbnQoZXZlbnQsIGNhbGxiYWNrKSB7XHJcbiAgICB2YXIgdHJhbnNmZXJhYmxlcztcclxuXHJcbiAgICB2YXIgd29ya2VySGVscGVyID0gYXN5bmNQcm94eS5Bc3luY1Byb3h5RmFjdG9yeS5nZXRXb3JrZXJIZWxwZXIodGhpcyk7XHJcbiAgICBcclxuICAgIHZhciBpbnRlcm5hbENhbGxiYWNrV3JhcHBlciA9XHJcbiAgICAgICAgd29ya2VySGVscGVyLndyYXBDYWxsYmFjayhcclxuICAgICAgICAgICAgY2FsbGJhY2ssICdvbkZldGNoZXJFdmVudENhbGxiYWNrJywge1xyXG4gICAgICAgICAgICAgICAgaXNNdWx0aXBsZVRpbWVDYWxsYmFjazogdHJ1ZSxcclxuICAgICAgICAgICAgICAgIHBhdGhzVG9UcmFuc2ZlcmFibGVzOiB0cmFuc2ZlcmFibGVzXHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICApO1xyXG4gICAgXHJcbiAgICB2YXIgYXJncyA9IFtldmVudCwgY2FsbGJhY2tdO1xyXG4gICAgXHJcbiAgICB3b3JrZXJIZWxwZXIuY2FsbEZ1bmN0aW9uKCdvbicsIGFyZ3MpO1xyXG59O1xyXG5cclxuV29ya2VyUHJveHlJbWFnZURlY29kZXIucHJvdG90eXBlLnJlcXVlc3RQaXhlbHNQcm9ncmVzc2l2ZSA9IGZ1bmN0aW9uIHJlcXVlc3RQaXhlbHNQcm9ncmVzc2l2ZShcclxuICAgICAgICBpbWFnZVBhcnRQYXJhbXMsXHJcbiAgICAgICAgY2FsbGJhY2ssXHJcbiAgICAgICAgdGVybWluYXRlZENhbGxiYWNrLFxyXG4gICAgICAgIGltYWdlUGFydFBhcmFtc05vdE5lZWRlZCxcclxuICAgICAgICBtb3ZhYmxlSGFuZGxlKSB7XHJcbiAgICBcclxuICAgIHZhciB0cmFuc2ZlcmFibGVzO1xyXG4gICAgdmFyIHdvcmtlckhlbHBlciA9IGFzeW5jUHJveHkuQXN5bmNQcm94eUZhY3RvcnkuZ2V0V29ya2VySGVscGVyKHRoaXMpO1xyXG5cclxuICAgIC8vIE5PVEU6IENhbm5vdCBwYXNzIGl0IGFzIHRyYW5zZmVyYWJsZXMgYmVjYXVzZSBpdCBpcyBwYXNzZWQgdG8gYWxsXHJcbiAgICAvLyBsaXN0ZW5lciBjYWxsYmFja3MsIHRodXMgYWZ0ZXIgdGhlIGZpcnN0IG9uZSB0aGUgYnVmZmVyIGlzIG5vdCB2YWxpZFxyXG4gICAgXHJcbiAgICAvL3ZhciBwYXRoVG9QaXhlbHNBcnJheSA9IFswLCAncGl4ZWxzJywgJ2J1ZmZlciddO1xyXG4gICAgLy90cmFuc2ZlcmFibGVzID0gW3BhdGhUb1BpeGVsc0FycmF5XTtcclxuICAgIFxyXG4gICAgdmFyIGludGVybmFsQ2FsbGJhY2tXcmFwcGVyID1cclxuICAgICAgICB3b3JrZXJIZWxwZXIud3JhcENhbGxiYWNrKFxyXG4gICAgICAgICAgICBjYWxsYmFjaywgJ3JlcXVlc3RQaXhlbHNQcm9ncmVzc2l2ZUNhbGxiYWNrJywge1xyXG4gICAgICAgICAgICAgICAgaXNNdWx0aXBsZVRpbWVDYWxsYmFjazogdHJ1ZSxcclxuICAgICAgICAgICAgICAgIHBhdGhzVG9UcmFuc2ZlcmFibGVzOiB0cmFuc2ZlcmFibGVzXHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICApO1xyXG4gICAgXHJcbiAgICB2YXIgaW50ZXJuYWxUZXJtaW5hdGVkQ2FsbGJhY2tXcmFwcGVyID1cclxuICAgICAgICB3b3JrZXJIZWxwZXIud3JhcENhbGxiYWNrKFxyXG4gICAgICAgICAgICBpbnRlcm5hbFRlcm1pbmF0ZWRDYWxsYmFjaywgJ3JlcXVlc3RQaXhlbHNQcm9ncmVzc2l2ZVRlcm1pbmF0ZWRDYWxsYmFjaycsIHtcclxuICAgICAgICAgICAgICAgIGlzTXVsdGlwbGVUaW1lQ2FsbGJhY2s6IGZhbHNlXHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICApO1xyXG4gICAgICAgICAgICBcclxuICAgIHZhciBhcmdzID0gW1xyXG4gICAgICAgIGltYWdlUGFydFBhcmFtcyxcclxuICAgICAgICBpbnRlcm5hbENhbGxiYWNrV3JhcHBlcixcclxuICAgICAgICBpbnRlcm5hbFRlcm1pbmF0ZWRDYWxsYmFja1dyYXBwZXIsXHJcbiAgICAgICAgaW1hZ2VQYXJ0UGFyYW1zTm90TmVlZGVkLFxyXG4gICAgICAgIG1vdmFibGVIYW5kbGVdO1xyXG4gICAgXHJcbiAgICB3b3JrZXJIZWxwZXIuY2FsbEZ1bmN0aW9uKCdyZXF1ZXN0UGl4ZWxzUHJvZ3Jlc3NpdmUnLCBhcmdzKTtcclxuICAgICAgICBcclxuICAgIHZhciBzZWxmID0gdGhpcztcclxuICAgIFxyXG4gICAgZnVuY3Rpb24gaW50ZXJuYWxUZXJtaW5hdGVkQ2FsbGJhY2soaXNBYm9ydGVkKSB7XHJcbiAgICAgICAgd29ya2VySGVscGVyLmZyZWVDYWxsYmFjayhpbnRlcm5hbENhbGxiYWNrV3JhcHBlcik7XHJcbiAgICAgICAgXHJcbiAgICAgICAgdGVybWluYXRlZENhbGxiYWNrKGlzQWJvcnRlZCk7XHJcbiAgICB9ICAgICAgICBcclxufTsiLCIndXNlIHN0cmljdCc7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IEltYWdlRGVjb2RlcjtcclxuXHJcbnZhciBpbWFnZUhlbHBlckZ1bmN0aW9ucyA9IHJlcXVpcmUoJ2ltYWdlLWhlbHBlci1mdW5jdGlvbnMuanMnKTtcclxudmFyIERlY29kZUpvYnNQb29sID0gcmVxdWlyZSgnZGVjb2RlLWpvYnMtcG9vbC5qcycpO1xyXG52YXIgSW1hZ2VQYXJhbXNSZXRyaWV2ZXJQcm94eSA9IHJlcXVpcmUoJ2ltYWdlLXBhcmFtcy1yZXRyaWV2ZXItcHJveHkuanMnKTtcclxudmFyIEZldGNoTWFuYWdlciA9IHJlcXVpcmUoJ2ZldGNoLW1hbmFnZXIuanMnKTtcclxudmFyIFdvcmtlclByb3h5RmV0Y2hNYW5hZ2VyID0gcmVxdWlyZSgnd29ya2VyLXByb3h5LWZldGNoLW1hbmFnZXIuanMnKTtcclxudmFyIFdvcmtlclByb3h5SW1hZ2VEZWNvZGVyID0gcmVxdWlyZSgnd29ya2VyLXByb3h5LWltYWdlLWRlY29kZXIuanMnKTtcclxuXHJcbi8qIGdsb2JhbCBjb25zb2xlOiBmYWxzZSAqL1xyXG4vKiBnbG9iYWwgUHJvbWlzZTogZmFsc2UgKi9cclxuXHJcbkltYWdlRGVjb2Rlci5hbGlnblBhcmFtc1RvVGlsZXNBbmRMZXZlbCA9IGltYWdlSGVscGVyRnVuY3Rpb25zLmFsaWduUGFyYW1zVG9UaWxlc0FuZExldmVsO1xyXG5cclxuSW1hZ2VEZWNvZGVyLnJlbmRlclRvQ2FudmFzID0gaW1hZ2VIZWxwZXJGdW5jdGlvbnMucmVuZGVyVG9DYW52YXM7XHJcblxyXG5JbWFnZURlY29kZXIuZnJvbUltYWdlID0gZnVuY3Rpb24gZnJvbUltYWdlKGltYWdlLCBvcHRpb25zKSB7XHJcbiAgICB2YXIgaXNJbmRpcmVjdENyZWF0aW9uTmVlZGVkID0gaW1hZ2VIZWxwZXJGdW5jdGlvbnMuaXNJbmRpcmVjdENyZWF0aW9uTmVlZGVkKFxyXG4gICAgICAgIGltYWdlLCAnaW1hZ2UnLCBJbWFnZURlY29kZXIuX2ltYWdlRXhwZWN0ZWRNZXRob2RzKTtcclxuICAgIFxyXG4gICAgaWYgKCFpc0luZGlyZWN0Q3JlYXRpb25OZWVkZWQgfHwgIWltYWdlLnVzZVdvcmtlcikge1xyXG4gICAgICAgIHJldHVybiBuZXcgSW1hZ2VEZWNvZGVyKGltYWdlLCBvcHRpb25zKTtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgICAgcmV0dXJuIG5ldyBXb3JrZXJQcm94eUltYWdlRGVjb2RlcihpbWFnZSwgb3B0aW9ucyk7XHJcbiAgICB9XHJcbn07XHJcblxyXG5JbWFnZURlY29kZXIuX2ltYWdlRXhwZWN0ZWRNZXRob2RzID0gWydvcGVuZWQnLCAnZ2V0TGV2ZWxDYWxjdWxhdG9yJywgJ2dldEZldGNoZXInLCAnZ2V0RGVjb2RlcldvcmtlcnNJbnB1dFJldHJlaXZlciddO1xyXG5cclxuZnVuY3Rpb24gSW1hZ2VEZWNvZGVyKGltYWdlLCBvcHRpb25zKSB7XHJcbiAgICBJbWFnZVBhcmFtc1JldHJpZXZlclByb3h5LmNhbGwodGhpcyk7XHJcbiAgICBcclxuICAgIHRoaXMuX29wdGlvbnMgPSBvcHRpb25zIHx8IHt9O1xyXG4gICAgdGhpcy5fZGVjb2RlV29ya2Vyc0xpbWl0ID0gdGhpcy5fb3B0aW9ucy5kZWNvZGVXb3JrZXJzTGltaXQgfHwgNTtcclxuICAgIFxyXG4gICAgdGhpcy5fdGlsZVdpZHRoID0gdGhpcy5fb3B0aW9ucy50aWxlV2lkdGggfHwgMjU2O1xyXG4gICAgdGhpcy5fdGlsZUhlaWdodCA9IHRoaXMuX29wdGlvbnMudGlsZUhlaWdodCB8fCAyNTY7XHJcbiAgICB0aGlzLl9zaG93TG9nID0gISF0aGlzLl9vcHRpb25zLnNob3dMb2c7XHJcbiAgICB0aGlzLl9mZXRjaE1hbmFnZXIgPSBudWxsO1xyXG4gICAgdGhpcy5fZGVjb2RlRGVwZW5kZW5jeVdvcmtlcnMgPSBudWxsO1xyXG4gICAgdGhpcy5fcmVxdWVzdHNEZWNvZGVKb2JzUG9vbCA9IG51bGw7XHJcbiAgICB0aGlzLl9tb3ZhYmxlc0RlY29kZUpvYnNQb29sID0gbnVsbDtcclxuICAgIHRoaXMuX2xldmVsQ2FsY3VsYXRvciA9IG51bGw7XHJcbiAgICB0aGlzLl9mZXRjaFJlcXVlc3RJZCA9IDA7XHJcbiAgICBcclxuICAgIC8qaWYgKHRoaXMuX3Nob3dMb2cpIHtcclxuICAgICAgICAvLyBPbGQgSUVcclxuICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBzaG93TG9nIGlzIG5vdCBzdXBwb3J0ZWQgb24gdGhpcyBicm93c2VyJztcclxuICAgIH0qL1xyXG5cclxuICAgIHRoaXMuX21vdmFibGVTdGF0ZXMgPSBbXTtcclxuICAgIHRoaXMuX2RlY29kZXJzID0gW107XHJcbiAgICBcclxuICAgIHRoaXMuX2RlY29kZVNjaGVkdWxlciA9IG51bGw7XHJcbiAgICB0aGlzLl9kZWNvZGVQcmlvcml0aXplciA9IG51bGw7XHJcbiAgICB0aGlzLl9wcmlvcml0aXplclR5cGUgPSBudWxsO1xyXG5cclxuICAgIHRoaXMuX2ltYWdlID0gaW1hZ2VIZWxwZXJGdW5jdGlvbnMuZ2V0T3JDcmVhdGVJbnN0YW5jZShcclxuICAgICAgICBpbWFnZSwgJ2ltYWdlJywgSW1hZ2VEZWNvZGVyLl9pbWFnZUV4cGVjdGVkTWV0aG9kcyk7XHJcbn1cclxuXHJcbkltYWdlRGVjb2Rlci5wcm90b3R5cGUgPSBPYmplY3QuY3JlYXRlKEltYWdlUGFyYW1zUmV0cmlldmVyUHJveHkucHJvdG90eXBlKTtcclxuXHJcbkltYWdlRGVjb2Rlci5wcm90b3R5cGUuZ2V0VGlsZVdpZHRoID0gZnVuY3Rpb24gZ2V0VGlsZVdpZHRoKCkge1xyXG4gICAgcmV0dXJuIHRoaXMuX3RpbGVXaWR0aDtcclxufTtcclxuXHJcbkltYWdlRGVjb2Rlci5wcm90b3R5cGUuZ2V0VGlsZUhlaWdodCA9IGZ1bmN0aW9uIGdldFRpbGVIZWlnaHQoKSB7XHJcbiAgICByZXR1cm4gdGhpcy5fdGlsZUhlaWdodDtcclxufTtcclxuICAgIFxyXG5JbWFnZURlY29kZXIucHJvdG90eXBlLnNldEZldGNoUHJpb3JpdGl6ZXJEYXRhID1cclxuICAgIGZ1bmN0aW9uIHNldEZldGNoUHJpb3JpdGl6ZXJEYXRhKHByaW9yaXRpemVyRGF0YSkge1xyXG5cclxuICAgIHRoaXMuX3ZhbGlkYXRlRmV0Y2hlcigpO1xyXG4gICAgXHJcbiAgICB0aGlzLl9mZXRjaE1hbmFnZXIuc2V0RmV0Y2hQcmlvcml0aXplckRhdGEoXHJcbiAgICAgICAgcHJpb3JpdGl6ZXJEYXRhKTtcclxufTtcclxuXHJcbkltYWdlRGVjb2Rlci5wcm90b3R5cGUuc2V0RGVjb2RlUHJpb3JpdGl6ZXJEYXRhID1cclxuICAgIGZ1bmN0aW9uIHNldERlY29kZVByaW9yaXRpemVyRGF0YShwcmlvcml0aXplckRhdGEpIHtcclxuXHJcbiAgICB0aGlzLl92YWxpZGF0ZURlY29kZXIoKTtcclxuICAgIFxyXG4gICAgaWYgKHRoaXMuX2RlY29kZVByaW9yaXRpemVyID09PSBudWxsKSB7XHJcbiAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogTm8gZGVjb2RlIHByaW9yaXRpemVyIGhhcyBiZWVuIHNldCc7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGlmICh0aGlzLl9zaG93TG9nKSB7XHJcbiAgICAgICAgY29uc29sZS5sb2coJ3NldERlY29kZVByaW9yaXRpemVyRGF0YSgnICsgcHJpb3JpdGl6ZXJEYXRhICsgJyknKTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgdmFyIHByaW9yaXRpemVyRGF0YU1vZGlmaWVkID0gT2JqZWN0LmNyZWF0ZShwcmlvcml0aXplckRhdGEpO1xyXG4gICAgcHJpb3JpdGl6ZXJEYXRhTW9kaWZpZWQuaW1hZ2UgPSB0aGlzO1xyXG4gICAgXHJcbiAgICB0aGlzLl9kZWNvZGVQcmlvcml0aXplci5zZXRQcmlvcml0aXplckRhdGEocHJpb3JpdGl6ZXJEYXRhTW9kaWZpZWQpO1xyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVyLnByb3RvdHlwZS5zZXREZWNvZGVQcmlvcml0aXplclR5cGUgPSBmdW5jdGlvbiBzZXRQcmlvcml0aXplclR5cGUocHJpb3JpdGl6ZXJUeXBlKSB7XHJcbiAgICBpZiAodGhpcy5fZGVjb2RlU2NoZWR1bGVyICE9PSBudWxsKSB7XHJcbiAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogQ2Fubm90IHNldCBwcmlvcml0aXplciB0eXBlIGF0IHRoaXMgdGltZSc7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHRoaXMuX3ByaW9yaXRpemVyVHlwZSA9IHByaW9yaXRpemVyVHlwZTtcclxufTtcclxuXHJcbkltYWdlRGVjb2Rlci5wcm90b3R5cGUuc2V0RmV0Y2hQcmlvcml0aXplclR5cGUgPSBmdW5jdGlvbiBzZXRQcmlvcml0aXplclR5cGUocHJpb3JpdGl6ZXJUeXBlKSB7XHJcbiAgICB0aGlzLl92YWxpZGF0ZUZldGNoZXIoKTtcclxuICAgIHRoaXMuX2ZldGNoTWFuYWdlci5zZXRQcmlvcml0aXplclR5cGUocHJpb3JpdGl6ZXJUeXBlKTtcclxufTtcclxuXHJcbkltYWdlRGVjb2Rlci5wcm90b3R5cGUub3BlbiA9IGZ1bmN0aW9uIG9wZW4ob3BlbkFyZykge1xyXG4gICAgdGhpcy5fdmFsaWRhdGVGZXRjaGVyKCk7XHJcblxyXG4gICAgdmFyIHNlbGYgPSB0aGlzO1xyXG4gICAgdmFyIHByb21pc2UgPSB0aGlzLl9mZXRjaE1hbmFnZXIub3BlbihvcGVuQXJnKTtcclxuICAgIHJldHVybiBwcm9taXNlLnRoZW4oZnVuY3Rpb24gKHNpemVzUGFyYW1zKSB7XHJcbiAgICAgICAgc2VsZi5faW50ZXJuYWxTaXplc1BhcmFtcyA9IHNpemVzUGFyYW1zO1xyXG4gICAgICAgIHNlbGYuX2ltYWdlLm9wZW5lZChzZWxmKTtcclxuICAgICAgICBzZWxmLl9sZXZlbENhbGN1bGF0b3IgPSBzZWxmLl9pbWFnZS5nZXRMZXZlbENhbGN1bGF0b3IoKTtcclxuICAgICAgICBpbWFnZUhlbHBlckZ1bmN0aW9ucy5lbnN1cmVMZXZlbENhbGN1bGF0b3Ioc2VsZi5fbGV2ZWxDYWxjdWxhdG9yKTtcclxuICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgICBzaXplc1BhcmFtczogc2l6ZXNQYXJhbXMsXHJcbiAgICAgICAgICAgIGFwcGxpY2F0aXZlVGlsZVdpZHRoIDogc2VsZi5nZXRUaWxlV2lkdGgoKSxcclxuICAgICAgICAgICAgYXBwbGljYXRpdmVUaWxlSGVpZ2h0OiBzZWxmLmdldFRpbGVIZWlnaHQoKVxyXG4gICAgICAgIH07XHJcbiAgICB9KTtcclxufTtcclxuXHJcbkltYWdlRGVjb2Rlci5wcm90b3R5cGUuY2xvc2UgPSBmdW5jdGlvbiBjbG9zZSgpIHtcclxuICAgIHRoaXMuX3ZhbGlkYXRlRmV0Y2hlcigpO1xyXG4gICAgdGhpcy5fdmFsaWRhdGVEZWNvZGVyKCk7XHJcbiAgICBcclxuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgdGhpcy5fZGVjb2RlcnMubGVuZ3RoOyArK2kpIHtcclxuICAgICAgICB0aGlzLl9kZWNvZGVyc1tpXS50ZXJtaW5hdGUoKTtcclxuICAgIH1cclxuXHJcbiAgICB2YXIgc2VsZiA9IHRoaXM7XHJcbiAgICByZXR1cm4gdGhpcy5fZmV0Y2hNYW5hZ2VyLmNsb3NlKCkudGhlbihmdW5jdGlvbigpIHtcclxuICAgICAgICBzZWxmLl9kZWNvZGVEZXBlbmRlbmN5V29ya2Vycy50ZXJtaW5hdGVJbmFjdGl2ZVdvcmtlcnMoKTtcclxuICAgIH0pO1xyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVyLnByb3RvdHlwZS5vbkZldGNoZXJFdmVudCA9IGZ1bmN0aW9uIG9uRmV0Y2hlckV2ZW50KGV2ZW50LCBjYWxsYmFjaykge1xyXG4gICAgdGhpcy5fdmFsaWRhdGVGZXRjaGVyKCk7XHJcbiAgICB0aGlzLl9mZXRjaE1hbmFnZXIub24oZXZlbnQsIGNhbGxiYWNrKTtcclxufTtcclxuXHJcbkltYWdlRGVjb2Rlci5wcm90b3R5cGUuY3JlYXRlTW92YWJsZUZldGNoID0gZnVuY3Rpb24gY3JlYXRlTW92YWJsZUZldGNoKCkge1xyXG4gICAgdGhpcy5fdmFsaWRhdGVGZXRjaGVyKCk7XHJcbiAgICB0aGlzLmdldEltYWdlUGFyYW1zKCk7XHJcbiAgICBcclxuICAgIHZhciBzZWxmID0gdGhpcztcclxuICAgIFxyXG4gICAgcmV0dXJuIHRoaXMuX2ZldGNoTWFuYWdlci5jcmVhdGVNb3ZhYmxlRmV0Y2goKS50aGVuKGZ1bmN0aW9uKG1vdmFibGVIYW5kbGUpIHtcclxuICAgICAgICBzZWxmLl9tb3ZhYmxlU3RhdGVzW21vdmFibGVIYW5kbGVdID0ge1xyXG4gICAgICAgICAgICBkZWNvZGVKb2JzTGlzdGVuZXJIYW5kbGU6IG51bGxcclxuICAgICAgICB9O1xyXG4gICAgICAgIFxyXG4gICAgICAgIHJldHVybiBtb3ZhYmxlSGFuZGxlO1xyXG4gICAgfSk7XHJcbn07XHJcblxyXG5JbWFnZURlY29kZXIucHJvdG90eXBlLnJlcXVlc3RQaXhlbHMgPSBmdW5jdGlvbiByZXF1ZXN0UGl4ZWxzKGltYWdlUGFydFBhcmFtcykge1xyXG4gICAgdGhpcy5fdmFsaWRhdGVEZWNvZGVyKCk7XHJcbiAgICB0aGlzLmdldEltYWdlUGFyYW1zKCk7XHJcbiAgICBcclxuICAgIHZhciByZXNvbHZlLCByZWplY3Q7XHJcbiAgICB2YXIgYWNjdW11bGF0ZWRSZXN1bHQgPSB7fTtcclxuICAgIFxyXG4gICAgdmFyIHNlbGYgPSB0aGlzO1xyXG4gICAgdmFyIHByb21pc2UgPSBuZXcgUHJvbWlzZShzdGFydFByb21pc2UpO1xyXG4gICAgcmV0dXJuIHByb21pc2U7XHJcbiAgICBcclxuICAgIGZ1bmN0aW9uIHN0YXJ0UHJvbWlzZShyZXNvbHZlXywgcmVqZWN0Xykge1xyXG4gICAgICAgIHJlc29sdmUgPSByZXNvbHZlXztcclxuICAgICAgICByZWplY3QgPSByZWplY3RfO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHNlbGYuX3JlcXVlc3RzRGVjb2RlSm9ic1Bvb2wuZm9ya0RlY29kZUpvYnMoXHJcbiAgICAgICAgICAgIGltYWdlUGFydFBhcmFtcyxcclxuICAgICAgICAgICAgaW50ZXJuYWxDYWxsYmFjayxcclxuICAgICAgICAgICAgaW50ZXJuYWxUZXJtaW5hdGVkQ2FsbGJhY2spO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBmdW5jdGlvbiBpbnRlcm5hbENhbGxiYWNrKGRlY29kZWREYXRhKSB7XHJcbiAgICAgICAgc2VsZi5fY29weVBpeGVsc1RvQWNjdW11bGF0ZWRSZXN1bHQoZGVjb2RlZERhdGEsIGFjY3VtdWxhdGVkUmVzdWx0KTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgZnVuY3Rpb24gaW50ZXJuYWxUZXJtaW5hdGVkQ2FsbGJhY2soaXNBYm9ydGVkKSB7XHJcbiAgICAgICAgaWYgKGlzQWJvcnRlZCkge1xyXG4gICAgICAgICAgICByZWplY3QoJ1JlcXVlc3Qgd2FzIGFib3J0ZWQgZHVlIHRvIGZhaWx1cmUgb3IgcHJpb3JpdHknKTtcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICByZXNvbHZlKGFjY3VtdWxhdGVkUmVzdWx0KTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbn07XHJcblxyXG5JbWFnZURlY29kZXIucHJvdG90eXBlLnJlcXVlc3RQaXhlbHNQcm9ncmVzc2l2ZSA9IGZ1bmN0aW9uIHJlcXVlc3RQaXhlbHNQcm9ncmVzc2l2ZShcclxuICAgIGltYWdlUGFydFBhcmFtcyxcclxuICAgIGNhbGxiYWNrLFxyXG4gICAgdGVybWluYXRlZENhbGxiYWNrLFxyXG4gICAgaW1hZ2VQYXJ0UGFyYW1zTm90TmVlZGVkLFxyXG4gICAgbW92YWJsZUhhbmRsZSkge1xyXG4gICAgXHJcbiAgICB0aGlzLl92YWxpZGF0ZURlY29kZXIoKTtcclxuICAgIHRoaXMuZ2V0SW1hZ2VQYXJhbXMoKTtcclxuICAgIFxyXG4gICAgdmFyIG1vdmFibGVTdGF0ZSA9IG51bGw7XHJcbiAgICB2YXIgZGVjb2RlSm9ic1Bvb2w7XHJcbiAgICBpZiAobW92YWJsZUhhbmRsZSA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgZGVjb2RlSm9ic1Bvb2wgPSB0aGlzLl9yZXF1ZXN0c0RlY29kZUpvYnNQb29sO1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgICBkZWNvZGVKb2JzUG9vbCA9IHRoaXMuX21vdmFibGVzRGVjb2RlSm9ic1Bvb2w7XHJcbiAgICAgICAgXHJcbiAgICAgICAgbW92YWJsZVN0YXRlID0gdGhpcy5fbW92YWJsZVN0YXRlc1ttb3ZhYmxlSGFuZGxlXTtcclxuICAgICAgICBcclxuICAgICAgICBpZiAobW92YWJsZVN0YXRlID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogTW92YWJsZSBoYW5kbGUgZG9lcyBub3QgZXhpc3QnO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuICAgIFxyXG4gICAgdmFyIGxpc3RlbmVySGFuZGxlID0gZGVjb2RlSm9ic1Bvb2wuZm9ya0RlY29kZUpvYnMoXHJcbiAgICAgICAgaW1hZ2VQYXJ0UGFyYW1zLFxyXG4gICAgICAgIGNhbGxiYWNrLFxyXG4gICAgICAgIHRlcm1pbmF0ZWRDYWxsYmFjayB8fCBmdW5jdGlvbigpIHsgfSxcclxuICAgICAgICBpbWFnZVBhcnRQYXJhbXNOb3ROZWVkZWQpO1xyXG4gICAgICAgIFxyXG4gICAgaWYgKG1vdmFibGVIYW5kbGUgIT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIGlmIChtb3ZhYmxlU3RhdGUuZGVjb2RlSm9ic0xpc3RlbmVySGFuZGxlICE9PSBudWxsKSB7XHJcbiAgICAgICAgICAgIC8vIFVucmVnaXN0ZXIgYWZ0ZXIgZm9ya2VkIG5ldyBqb2JzLCBzbyBubyB0ZXJtaW5hdGlvbiBvY2N1cnMgbWVhbndoaWxlXHJcbiAgICAgICAgICAgIGRlY29kZUpvYnNQb29sLnVucmVnaXN0ZXJGb3JrZWRKb2JzKFxyXG4gICAgICAgICAgICAgICAgbW92YWJsZVN0YXRlLmRlY29kZUpvYnNMaXN0ZW5lckhhbmRsZSk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIG1vdmFibGVTdGF0ZS5kZWNvZGVKb2JzTGlzdGVuZXJIYW5kbGUgPSBsaXN0ZW5lckhhbmRsZTtcclxuICAgICAgICB0aGlzLl9mZXRjaE1hbmFnZXIubW92ZUZldGNoKG1vdmFibGVIYW5kbGUsIGltYWdlUGFydFBhcmFtcyk7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICAgIHRoaXMuX2ZldGNoTWFuYWdlci5jcmVhdGVSZXF1ZXN0KCsrdGhpcy5fZmV0Y2hSZXF1ZXN0SWQsIGltYWdlUGFydFBhcmFtcyk7XHJcbiAgICB9XHJcbn07XHJcblxyXG5JbWFnZURlY29kZXIucHJvdG90eXBlLmdldExldmVsQ2FsY3VsYXRvciA9IGZ1bmN0aW9uIGdldExldmVsQ2FsY3VsYXRvcigpIHtcclxuICAgIHJldHVybiB0aGlzLl9sZXZlbENhbGN1bGF0b3I7XHJcbn07XHJcblxyXG4vLyBJbnRlcm5hbCBNZXRob2RzXHJcblxyXG5JbWFnZURlY29kZXIucHJvdG90eXBlLl92YWxpZGF0ZUZldGNoZXIgPSBmdW5jdGlvbiB2YWxpZGF0ZUZldGNoZXIoKSB7XHJcbiAgICBpZiAodGhpcy5fZmV0Y2hNYW5hZ2VyICE9PSBudWxsKSB7XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG5cclxuICAgIHZhciBmZXRjaGVyID0gdGhpcy5faW1hZ2UuZ2V0RmV0Y2hlcigpO1xyXG4gICAgdmFyIGlzSW5kaXJlY3RDcmVhdGlvbk5lZWRlZCA9IGltYWdlSGVscGVyRnVuY3Rpb25zLmlzSW5kaXJlY3RDcmVhdGlvbk5lZWRlZChcclxuICAgICAgICBmZXRjaGVyLCAnZmV0Y2hlcicsIEZldGNoTWFuYWdlci5mZXRjaGVyRXhwZWN0ZWRNZXRob2RzKTtcclxuICAgIFxyXG4gICAgaWYgKCFpc0luZGlyZWN0Q3JlYXRpb25OZWVkZWQgfHwgIWZldGNoZXIudXNlV29ya2VyKSB7XHJcbiAgICAgICAgdGhpcy5fZmV0Y2hNYW5hZ2VyID0gbmV3IEZldGNoTWFuYWdlcihmZXRjaGVyLCB0aGlzLl9vcHRpb25zKTtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgICAgdGhpcy5fZmV0Y2hNYW5hZ2VyID0gbmV3IFdvcmtlclByb3h5RmV0Y2hNYW5hZ2VyKFxyXG4gICAgICAgICAgICBmZXRjaGVyLCB0aGlzLl9vcHRpb25zKTtcclxuICAgIH1cclxufTtcclxuXHJcbkltYWdlRGVjb2Rlci5wcm90b3R5cGUuX3ZhbGlkYXRlRGVjb2RlciA9IGZ1bmN0aW9uIHZhbGlkYXRlQ29tcG9uZW50cygpIHtcclxuICAgIGlmICh0aGlzLl9kZWNvZGVEZXBlbmRlbmN5V29ya2VycyAhPT0gbnVsbCkge1xyXG4gICAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIFxyXG4gICAgdmFyIGRlY29kZVNjaGVkdWxpbmcgPSBpbWFnZUhlbHBlckZ1bmN0aW9ucy5jcmVhdGVQcmlvcml0aXplcihcclxuICAgICAgICB0aGlzLl9kZWNvZGVXb3JrZXJzTGltaXQsXHJcbiAgICAgICAgdGhpcy5fcHJpb3JpdGl6ZXJUeXBlLFxyXG4gICAgICAgICdkZWNvZGUnLFxyXG4gICAgICAgIHRoaXMuX3Nob3dMb2cpO1xyXG4gICAgXHJcbiAgICBpZiAoZGVjb2RlU2NoZWR1bGluZy5wcmlvcml0aXplciAhPT0gbnVsbCkge1xyXG4gICAgICAgIHRoaXMuX2RlY29kZVNjaGVkdWxlciA9IG5ldyBkZXBlbmRlbmN5V29ya2Vycy5EZXBlbmRlbmN5V29ya2Vyc1Rhc2tTY2hlZHVsZXIoXHJcbiAgICAgICAgICAgIHRoaXMuX2RlY29kZVdvcmtlcnNMaW1pdCwgZGVjb2RlU2NoZWR1bGluZy5zY2hlZHVsZXJPcHRpb25zKTtcclxuICAgICAgICB0aGlzLl9kZWNvZGVQcmlvcml0aXplciA9IGRlY29kZVNjaGVkdWxpbmcucHJpb3JpdGl6ZXI7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICAgIHRoaXMuX2RlY29kZVNjaGVkdWxlciA9IG5ldyByZXNvdXJjZVNjaGVkdWxlci5MaWZvU2NoZWR1bGVyKFxyXG4gICAgICAgICAgICBjcmVhdGVEdW1teVJlc291cmNlLFxyXG4gICAgICAgICAgICB0aGlzLl9kZWNvZGVXb3JrZXJzTGltaXQsXHJcbiAgICAgICAgICAgIGRlY29kZVNjaGVkdWxpbmcuc2NoZWR1bGVyT3B0aW9ucyk7XHJcbiAgICAgICAgdGhpcy5fZGVjb2RlUHJpb3JpdGl6ZXIgPSBudWxsO1xyXG4gICAgfVxyXG5cclxuICAgIHZhciBpbnB1dFJldHJlaXZlciA9IHRoaXMuX2ltYWdlLmdldERlY29kZXJXb3JrZXJzSW5wdXRSZXRyZWl2ZXIoKTtcclxuICAgIHRoaXMuX2RlY29kZURlcGVuZGVuY3lXb3JrZXJzID0gbmV3IGRlcGVuZGVuY3lXb3JrZXJzLlNjaGVkdWxlckRlcGVuZGVuY3lXb3JrZXJzKFxyXG4gICAgICAgIHRoaXMuX2RlY29kZVNjaGVkdWxlciwgaW5wdXRSZXRyZWl2ZXIpO1xyXG4gICAgXHJcbiAgICB0aGlzLl9yZXF1ZXN0c0RlY29kZUpvYnNQb29sID0gbmV3IERlY29kZUpvYnNQb29sKFxyXG4gICAgICAgIHRoaXMuX2RlY29kZURlcGVuZGVuY3lXb3JrZXJzLFxyXG4gICAgICAgIHRoaXMuX2RlY29kZVByaW9yaXRpemVyLFxyXG4gICAgICAgIHRoaXMuX3RpbGVXaWR0aCxcclxuICAgICAgICB0aGlzLl90aWxlSGVpZ2h0KTtcclxuICAgICAgICBcclxuICAgIHRoaXMuX21vdmFibGVzRGVjb2RlSm9ic1Bvb2wgPSBuZXcgRGVjb2RlSm9ic1Bvb2woXHJcbiAgICAgICAgdGhpcy5fZGVjb2RlRGVwZW5kZW5jeVdvcmtlcnMsXHJcbiAgICAgICAgdGhpcy5fZGVjb2RlUHJpb3JpdGl6ZXIsXHJcbiAgICAgICAgdGhpcy5fdGlsZVdpZHRoLFxyXG4gICAgICAgIHRoaXMuX3RpbGVIZWlnaHQpO1xyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVyLnByb3RvdHlwZS5fZ2V0SW1hZ2VQYXJhbXNJbnRlcm5hbCA9IGZ1bmN0aW9uIGdldEltYWdlUGFyYW1zSW50ZXJuYWwoKSB7XHJcbiAgICByZXR1cm4gdGhpcy5faW50ZXJuYWxTaXplc1BhcmFtcztcclxufTtcclxuXHJcbkltYWdlRGVjb2Rlci5wcm90b3R5cGUuX2NvcHlQaXhlbHNUb0FjY3VtdWxhdGVkUmVzdWx0ID1cclxuICAgIGZ1bmN0aW9uIGNvcHlQaXhlbHNUb0FjY3VtdWxhdGVkUmVzdWx0KGRlY29kZWREYXRhLCBhY2N1bXVsYXRlZFJlc3VsdCkge1xyXG4gICAgICAgIFxyXG4gICAgdmFyIGJ5dGVzUGVyUGl4ZWwgPSA0O1xyXG4gICAgdmFyIHNvdXJjZVN0cmlkZSA9IGRlY29kZWREYXRhLndpZHRoICogYnl0ZXNQZXJQaXhlbDtcclxuICAgIHZhciB0YXJnZXRTdHJpZGUgPVxyXG4gICAgICAgIGRlY29kZWREYXRhLm9yaWdpbmFsUmVxdWVzdFdpZHRoICogYnl0ZXNQZXJQaXhlbDtcclxuICAgIFxyXG4gICAgaWYgKGFjY3VtdWxhdGVkUmVzdWx0LnBpeGVscyA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgdmFyIHNpemUgPVxyXG4gICAgICAgICAgICB0YXJnZXRTdHJpZGUgKiBkZWNvZGVkRGF0YS5vcmlnaW5hbFJlcXVlc3RIZWlnaHQ7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgIGFjY3VtdWxhdGVkUmVzdWx0LnBpeGVscyA9IG5ldyBVaW50OEFycmF5KHNpemUpO1xyXG4gICAgICAgIGFjY3VtdWxhdGVkUmVzdWx0LnhJbk9yaWdpbmFsUmVxdWVzdCA9IDA7XHJcbiAgICAgICAgYWNjdW11bGF0ZWRSZXN1bHQueUluT3JpZ2luYWxSZXF1ZXN0ID0gMDtcclxuICAgICAgICBcclxuICAgICAgICB2YXIgd2lkdGggPSBkZWNvZGVkRGF0YS5vcmlnaW5hbFJlcXVlc3RXaWR0aDtcclxuICAgICAgICBhY2N1bXVsYXRlZFJlc3VsdC5vcmlnaW5hbFJlcXVlc3RXaWR0aCA9IHdpZHRoO1xyXG4gICAgICAgIGFjY3VtdWxhdGVkUmVzdWx0LndpZHRoID0gd2lkdGg7XHJcblxyXG4gICAgICAgIHZhciBoZWlnaHQgPSBkZWNvZGVkRGF0YS5vcmlnaW5hbFJlcXVlc3RIZWlnaHQ7XHJcbiAgICAgICAgYWNjdW11bGF0ZWRSZXN1bHQub3JpZ2luYWxSZXF1ZXN0SGVpZ2h0ID0gaGVpZ2h0O1xyXG4gICAgICAgIGFjY3VtdWxhdGVkUmVzdWx0LmhlaWdodCA9IGhlaWdodDtcclxuICAgIH1cclxuICAgIFxyXG4gICAgYWNjdW11bGF0ZWRSZXN1bHQuYWxsUmVsZXZhbnRCeXRlc0xvYWRlZCA9XHJcbiAgICAgICAgZGVjb2RlZERhdGEuYWxsUmVsZXZhbnRCeXRlc0xvYWRlZDtcclxuXHJcbiAgICB2YXIgc291cmNlT2Zmc2V0ID0gMDtcclxuICAgIHZhciB0YXJnZXRPZmZzZXQgPVxyXG4gICAgICAgIGRlY29kZWREYXRhLnhJbk9yaWdpbmFsUmVxdWVzdCAqIGJ5dGVzUGVyUGl4ZWwgKyBcclxuICAgICAgICBkZWNvZGVkRGF0YS55SW5PcmlnaW5hbFJlcXVlc3QgKiB0YXJnZXRTdHJpZGU7XHJcbiAgICBcclxuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgZGVjb2RlZERhdGEuaGVpZ2h0OyArK2kpIHtcclxuICAgICAgICB2YXIgc291cmNlU3ViQXJyYXkgPSBkZWNvZGVkRGF0YS5waXhlbHMuc3ViYXJyYXkoXHJcbiAgICAgICAgICAgIHNvdXJjZU9mZnNldCwgc291cmNlT2Zmc2V0ICsgc291cmNlU3RyaWRlKTtcclxuICAgICAgICBcclxuICAgICAgICBhY2N1bXVsYXRlZFJlc3VsdC5waXhlbHMuc2V0KHNvdXJjZVN1YkFycmF5LCB0YXJnZXRPZmZzZXQpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHNvdXJjZU9mZnNldCArPSBzb3VyY2VTdHJpZGU7XHJcbiAgICAgICAgdGFyZ2V0T2Zmc2V0ICs9IHRhcmdldFN0cmlkZTtcclxuICAgIH1cclxufTtcclxuXHJcbmZ1bmN0aW9uIGNyZWF0ZUR1bW15UmVzb3VyY2UoKVxyXG57XHJcbn0iLCIndXNlIHN0cmljdCc7XHJcblxyXG52YXIgSW1hZ2VWaWV3ZXIgPSByZXF1aXJlKCdpbWFnZS1kZWNvZGVyLXZpZXdlci5qcycpO1xyXG52YXIgY2FsY3VsYXRlTGVhZmxldEZydXN0dW0gPSByZXF1aXJlKCdsZWFmbGV0LWZydXN0dW0tY2FsY3VsYXRvci5qcycpO1xyXG5cclxuLyogZ2xvYmFsIEw6IGZhbHNlICovXHJcbi8qIGdsb2JhbCBzZWxmOiBmYWxzZSAqL1xyXG5cclxuaWYgKHNlbGYuTCkge1xyXG4gICAgbW9kdWxlLmV4cG9ydHMgPSBMLkNsYXNzLmV4dGVuZChjcmVhdGVJbWFnZURlY29kZXJSZWdpb25MYXllckZ1bmN0aW9ucygpKTtcclxufSBlbHNlIHtcclxuICAgIG1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IENhbm5vdCBpbnN0YW50aWF0ZSBJbWFnZURlY29kZXJSZWdpb25MYXllcjogTm8gTGVhZmxldCBuYW1lc3BhY2UgaW4gc2NvcGUnKTtcclxuICAgIH07XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGNyZWF0ZUltYWdlRGVjb2RlclJlZ2lvbkxheWVyRnVuY3Rpb25zKCkge1xyXG4gICAgcmV0dXJuIHtcclxuICAgICAgICBpbml0aWFsaXplOiBmdW5jdGlvbiBpbml0aWFsaXplKG9wdGlvbnMpIHtcclxuICAgICAgICAgICAgdGhpcy5fb3B0aW9ucyA9IG9wdGlvbnMgfHwge307XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBpZiAodGhpcy5fb3B0aW9ucy5sYXRMbmdCb3VuZHMgIT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgICAgICAgICAgdGhpcy5fb3B0aW9ucyA9IHt9O1xyXG4gICAgICAgICAgICAgICAgZm9yICh2YXIgbWVtYmVyIGluIG9wdGlvbnMpIHtcclxuICAgICAgICAgICAgICAgICAgICB0aGlzLl9vcHRpb25zW21lbWJlcl0gPSBvcHRpb25zW21lbWJlcl07XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB0aGlzLl9vcHRpb25zLmNhcnRvZ3JhcGhpY0JvdW5kcyA9IHtcclxuICAgICAgICAgICAgICAgICAgICB3ZXN0OiBvcHRpb25zLmxhdExuZ0JvdW5kcy5nZXRXZXN0KCksXHJcbiAgICAgICAgICAgICAgICAgICAgZWFzdDogb3B0aW9ucy5sYXRMbmdCb3VuZHMuZ2V0RWFzdCgpLFxyXG4gICAgICAgICAgICAgICAgICAgIHNvdXRoOiBvcHRpb25zLmxhdExuZ0JvdW5kcy5nZXRTb3V0aCgpLFxyXG4gICAgICAgICAgICAgICAgICAgIG5vcnRoOiBvcHRpb25zLmxhdExuZ0JvdW5kcy5nZXROb3J0aCgpXHJcbiAgICAgICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICB0aGlzLl90YXJnZXRDYW52YXMgPSBudWxsO1xyXG4gICAgICAgICAgICB0aGlzLl9jYW52YXNQb3NpdGlvbiA9IG51bGw7XHJcbiAgICAgICAgICAgIHRoaXMuX2NhbnZhc1VwZGF0ZWRDYWxsYmFja0JvdW5kID0gdGhpcy5fY2FudmFzVXBkYXRlZENhbGxiYWNrLmJpbmQodGhpcyk7XHJcbiAgICAgICAgICAgIHRoaXMuX2ltYWdlVmlld2VyID0gbnVsbDtcclxuICAgICAgICAgICAgdGhpcy5fZXhjZXB0aW9uQ2FsbGJhY2sgPSBudWxsO1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgXHJcbiAgICAgICAgc2V0RXhjZXB0aW9uQ2FsbGJhY2s6IGZ1bmN0aW9uIHNldEV4Y2VwdGlvbkNhbGxiYWNrKGV4Y2VwdGlvbkNhbGxiYWNrKSB7XHJcbiAgICAgICAgICAgIHRoaXMuX2V4Y2VwdGlvbkNhbGxiYWNrID0gZXhjZXB0aW9uQ2FsbGJhY2s7XHJcbiAgICAgICAgICAgIGlmICh0aGlzLl9pbWFnZVZpZXdlciAhPT0gbnVsbCkge1xyXG4gICAgICAgICAgICAgICAgdGhpcy5faW1hZ2VWaWV3ZXIuc2V0RXhjZXB0aW9uQ2FsbGJhY2soZXhjZXB0aW9uQ2FsbGJhY2spO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfSxcclxuICAgICAgICBcclxuICAgICAgICBfY3JlYXRlSW1hZ2U6IGZ1bmN0aW9uIGNyZWF0ZUltYWdlKCkge1xyXG4gICAgICAgICAgICBpZiAodGhpcy5faW1hZ2VWaWV3ZXIgPT09IG51bGwpIHtcclxuICAgICAgICAgICAgICAgIHRoaXMuX2ltYWdlVmlld2VyID0gbmV3IEltYWdlVmlld2VyKFxyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX29wdGlvbnMuaW1hZ2VEZWNvZGVyLFxyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX2NhbnZhc1VwZGF0ZWRDYWxsYmFja0JvdW5kLFxyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX29wdGlvbnMpO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICBpZiAodGhpcy5fZXhjZXB0aW9uQ2FsbGJhY2sgIT09IG51bGwpIHtcclxuICAgICAgICAgICAgICAgICAgICB0aGlzLl9pbWFnZVZpZXdlci5zZXRFeGNlcHRpb25DYWxsYmFjayh0aGlzLl9leGNlcHRpb25DYWxsYmFjayk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIHRoaXMuX2ltYWdlVmlld2VyLm9wZW4odGhpcy5fb3B0aW9ucy5vcGVuQXJnKS5jYXRjaCh0aGlzLl9leGNlcHRpb25DYWxsYmFjayk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9LFxyXG5cclxuICAgICAgICBvbkFkZDogZnVuY3Rpb24gb25BZGQobWFwKSB7XHJcbiAgICAgICAgICAgIGlmICh0aGlzLl9tYXAgIT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgICAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogQ2Fubm90IGFkZCB0aGlzIGxheWVyIHRvIHR3byBtYXBzJztcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgdGhpcy5fbWFwID0gbWFwO1xyXG4gICAgICAgICAgICB0aGlzLl9jcmVhdGVJbWFnZSgpO1xyXG5cclxuICAgICAgICAgICAgLy8gY3JlYXRlIGEgRE9NIGVsZW1lbnQgYW5kIHB1dCBpdCBpbnRvIG9uZSBvZiB0aGUgbWFwIHBhbmVzXHJcbiAgICAgICAgICAgIHRoaXMuX3RhcmdldENhbnZhcyA9IEwuRG9tVXRpbC5jcmVhdGUoXHJcbiAgICAgICAgICAgICAgICAnY2FudmFzJywgJ2ltYWdlLWRlY29kZXItbGF5ZXItY2FudmFzIGxlYWZsZXQtem9vbS1hbmltYXRlZCcpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgdGhpcy5faW1hZ2VWaWV3ZXIuc2V0VGFyZ2V0Q2FudmFzKHRoaXMuX3RhcmdldENhbnZhcyk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICB0aGlzLl9jYW52YXNQb3NpdGlvbiA9IG51bGw7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgbWFwLmdldFBhbmVzKCkubWFwUGFuZS5hcHBlbmRDaGlsZCh0aGlzLl90YXJnZXRDYW52YXMpO1xyXG5cclxuICAgICAgICAgICAgLy8gYWRkIGEgdmlld3Jlc2V0IGV2ZW50IGxpc3RlbmVyIGZvciB1cGRhdGluZyBsYXllcidzIHBvc2l0aW9uLCBkbyB0aGUgbGF0dGVyXHJcbiAgICAgICAgICAgIG1hcC5vbigndmlld3Jlc2V0JywgdGhpcy5fbW92ZWQsIHRoaXMpO1xyXG4gICAgICAgICAgICBtYXAub24oJ21vdmUnLCB0aGlzLl9tb3ZlZCwgdGhpcyk7XHJcblxyXG4gICAgICAgICAgICBpZiAoTC5Ccm93c2VyLmFueTNkKSB7XHJcbiAgICAgICAgICAgICAgICBtYXAub24oJ3pvb21hbmltJywgdGhpcy5fYW5pbWF0ZVpvb20sIHRoaXMpO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICB0aGlzLl9tb3ZlZCgpO1xyXG4gICAgICAgIH0sXHJcblxyXG4gICAgICAgIG9uUmVtb3ZlOiBmdW5jdGlvbiBvblJlbW92ZShtYXApIHtcclxuICAgICAgICAgICAgaWYgKG1hcCAhPT0gdGhpcy5fbWFwKSB7XHJcbiAgICAgICAgICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBSZW1vdmVkIGZyb20gd3JvbmcgbWFwJztcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgbWFwLm9mZigndmlld3Jlc2V0JywgdGhpcy5fbW92ZWQsIHRoaXMpO1xyXG4gICAgICAgICAgICBtYXAub2ZmKCdtb3ZlJywgdGhpcy5fbW92ZWQsIHRoaXMpO1xyXG4gICAgICAgICAgICBtYXAub2ZmKCd6b29tYW5pbScsIHRoaXMuX2FuaW1hdGVab29tLCB0aGlzKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIHJlbW92ZSBsYXllcidzIERPTSBlbGVtZW50cyBhbmQgbGlzdGVuZXJzXHJcbiAgICAgICAgICAgIG1hcC5nZXRQYW5lcygpLm1hcFBhbmUucmVtb3ZlQ2hpbGQodGhpcy5fdGFyZ2V0Q2FudmFzKTtcclxuICAgICAgICAgICAgdGhpcy5fdGFyZ2V0Q2FudmFzID0gbnVsbDtcclxuICAgICAgICAgICAgdGhpcy5fY2FudmFzUG9zaXRpb24gPSBudWxsO1xyXG5cclxuICAgICAgICAgICAgdGhpcy5fbWFwID0gdW5kZWZpbmVkO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgdGhpcy5faW1hZ2VWaWV3ZXIuY2xvc2UoKTtcclxuICAgICAgICAgICAgdGhpcy5faW1hZ2VWaWV3ZXIgPSBudWxsO1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgXHJcbiAgICAgICAgX21vdmVkOiBmdW5jdGlvbiAoKSB7XHJcbiAgICAgICAgICAgIHRoaXMuX21vdmVDYW52YXNlcygpO1xyXG5cclxuICAgICAgICAgICAgdmFyIGZydXN0dW1EYXRhID0gY2FsY3VsYXRlTGVhZmxldEZydXN0dW0odGhpcy5fbWFwKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHRoaXMuX2ltYWdlVmlld2VyLnVwZGF0ZVZpZXdBcmVhKGZydXN0dW1EYXRhKTtcclxuICAgICAgICB9LFxyXG4gICAgICAgIFxyXG4gICAgICAgIF9jYW52YXNVcGRhdGVkQ2FsbGJhY2s6IGZ1bmN0aW9uIGNhbnZhc1VwZGF0ZWRDYWxsYmFjayhuZXdQb3NpdGlvbikge1xyXG4gICAgICAgICAgICBpZiAobmV3UG9zaXRpb24gIT09IG51bGwpIHtcclxuICAgICAgICAgICAgICAgIHRoaXMuX2NhbnZhc1Bvc2l0aW9uID0gbmV3UG9zaXRpb247XHJcbiAgICAgICAgICAgICAgICB0aGlzLl9tb3ZlQ2FudmFzZXMoKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH0sXHJcbiAgICAgICAgXHJcbiAgICAgICAgX21vdmVDYW52YXNlczogZnVuY3Rpb24gbW92ZUNhbnZhc2VzKCkge1xyXG4gICAgICAgICAgICBpZiAodGhpcy5fY2FudmFzUG9zaXRpb24gPT09IG51bGwpIHtcclxuICAgICAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgICAgICAvLyB1cGRhdGUgbGF5ZXIncyBwb3NpdGlvblxyXG4gICAgICAgICAgICB2YXIgd2VzdCA9IHRoaXMuX2NhbnZhc1Bvc2l0aW9uLndlc3Q7XHJcbiAgICAgICAgICAgIHZhciBlYXN0ID0gdGhpcy5fY2FudmFzUG9zaXRpb24uZWFzdDtcclxuICAgICAgICAgICAgdmFyIHNvdXRoID0gdGhpcy5fY2FudmFzUG9zaXRpb24uc291dGg7XHJcbiAgICAgICAgICAgIHZhciBub3J0aCA9IHRoaXMuX2NhbnZhc1Bvc2l0aW9uLm5vcnRoO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgdmFyIHRvcExlZnQgPSB0aGlzLl9tYXAubGF0TG5nVG9MYXllclBvaW50KFtub3J0aCwgd2VzdF0pO1xyXG4gICAgICAgICAgICB2YXIgYm90dG9tUmlnaHQgPSB0aGlzLl9tYXAubGF0TG5nVG9MYXllclBvaW50KFtzb3V0aCwgZWFzdF0pO1xyXG4gICAgICAgICAgICB2YXIgc2l6ZSA9IGJvdHRvbVJpZ2h0LnN1YnRyYWN0KHRvcExlZnQpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgTC5Eb21VdGlsLnNldFBvc2l0aW9uKHRoaXMuX3RhcmdldENhbnZhcywgdG9wTGVmdCk7XHJcbiAgICAgICAgICAgIHRoaXMuX3RhcmdldENhbnZhcy5zdHlsZS53aWR0aCA9IHNpemUueCArICdweCc7XHJcbiAgICAgICAgICAgIHRoaXMuX3RhcmdldENhbnZhcy5zdHlsZS5oZWlnaHQgPSBzaXplLnkgKyAncHgnO1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgXHJcbiAgICAgICAgX2FuaW1hdGVab29tOiBmdW5jdGlvbiBhbmltYXRlWm9vbShvcHRpb25zKSB7XHJcbiAgICAgICAgICAgIGlmICh0aGlzLl9jYW52YXNQb3NpdGlvbiA9PT0gbnVsbCkge1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIE5PVEU6IEFsbCBtZXRob2QgKGluY2x1ZGluZyB1c2luZyBvZiBwcml2YXRlIG1ldGhvZFxyXG4gICAgICAgICAgICAvLyBfbGF0TG5nVG9OZXdMYXllclBvaW50KSB3YXMgY29waWVkIGZyb20gSW1hZ2VPdmVybGF5LFxyXG4gICAgICAgICAgICAvLyBhcyBMZWFmbGV0IGRvY3VtZW50YXRpb24gcmVjb21tZW5kcy5cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHZhciB3ZXN0ID0gIHRoaXMuX2NhbnZhc1Bvc2l0aW9uLndlc3Q7XHJcbiAgICAgICAgICAgIHZhciBlYXN0ID0gIHRoaXMuX2NhbnZhc1Bvc2l0aW9uLmVhc3Q7XHJcbiAgICAgICAgICAgIHZhciBzb3V0aCA9IHRoaXMuX2NhbnZhc1Bvc2l0aW9uLnNvdXRoO1xyXG4gICAgICAgICAgICB2YXIgbm9ydGggPSB0aGlzLl9jYW52YXNQb3NpdGlvbi5ub3J0aDtcclxuXHJcbiAgICAgICAgICAgIHZhciB0b3BMZWZ0ID0gdGhpcy5fbWFwLl9sYXRMbmdUb05ld0xheWVyUG9pbnQoXHJcbiAgICAgICAgICAgICAgICBbbm9ydGgsIHdlc3RdLCBvcHRpb25zLnpvb20sIG9wdGlvbnMuY2VudGVyKTtcclxuICAgICAgICAgICAgdmFyIGJvdHRvbVJpZ2h0ID0gdGhpcy5fbWFwLl9sYXRMbmdUb05ld0xheWVyUG9pbnQoXHJcbiAgICAgICAgICAgICAgICBbc291dGgsIGVhc3RdLCBvcHRpb25zLnpvb20sIG9wdGlvbnMuY2VudGVyKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHZhciBzY2FsZSA9IHRoaXMuX21hcC5nZXRab29tU2NhbGUob3B0aW9ucy56b29tKTtcclxuICAgICAgICAgICAgdmFyIHNpemUgPSBib3R0b21SaWdodC5zdWJ0cmFjdCh0b3BMZWZ0KTtcclxuICAgICAgICAgICAgdmFyIHNpemVTY2FsZWQgPSBzaXplLm11bHRpcGx5QnkoKDEgLyAyKSAqICgxIC0gMSAvIHNjYWxlKSk7XHJcbiAgICAgICAgICAgIHZhciBvcmlnaW4gPSB0b3BMZWZ0LmFkZChzaXplU2NhbGVkKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHRoaXMuX3RhcmdldENhbnZhcy5zdHlsZVtMLkRvbVV0aWwuVFJBTlNGT1JNXSA9XHJcbiAgICAgICAgICAgICAgICBMLkRvbVV0aWwuZ2V0VHJhbnNsYXRlU3RyaW5nKG9yaWdpbikgKyAnIHNjYWxlKCcgKyBzY2FsZSArICcpICc7XHJcbiAgICAgICAgfVxyXG4gICAgfTtcclxufSIsIid1c2Ugc3RyaWN0JztcclxuXHJcbnZhciBpbWFnZUhlbHBlckZ1bmN0aW9ucyA9IHJlcXVpcmUoJ2ltYWdlLWhlbHBlci1mdW5jdGlvbnMuanMnKTtcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gY2FsY3VsYXRlTGVhZmxldEZydXN0dW0obGVhZmxldE1hcCkge1xyXG4gICAgdmFyIHNjcmVlblNpemUgPSBsZWFmbGV0TWFwLmdldFNpemUoKTtcclxuICAgIHZhciBib3VuZHMgPSBsZWFmbGV0TWFwLmdldEJvdW5kcygpO1xyXG5cclxuICAgIHZhciBjYXJ0b2dyYXBoaWNCb3VuZHMgPSB7XHJcbiAgICAgICAgd2VzdDogYm91bmRzLmdldFdlc3QoKSxcclxuICAgICAgICBlYXN0OiBib3VuZHMuZ2V0RWFzdCgpLFxyXG4gICAgICAgIHNvdXRoOiBib3VuZHMuZ2V0U291dGgoKSxcclxuICAgICAgICBub3J0aDogYm91bmRzLmdldE5vcnRoKClcclxuICAgIH07XHJcbiAgICBcclxuICAgIHZhciBmcnVzdHVtRGF0YSA9IGltYWdlSGVscGVyRnVuY3Rpb25zLmNhbGN1bGF0ZUZydXN0dW0yREZyb21Cb3VuZHMoXHJcbiAgICAgICAgY2FydG9ncmFwaGljQm91bmRzLCBzY3JlZW5TaXplKTtcclxuXHJcbiAgICByZXR1cm4gZnJ1c3R1bURhdGE7XHJcbn07IiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBHcmlkRGVjb2RlcldvcmtlckJhc2U7XHJcblxyXG4vKiBnbG9iYWwgUHJvbWlzZSA6IGZhbHNlICovXHJcbi8qIGdsb2JhbCBJbWFnZURhdGEgOiBmYWxzZSAqL1xyXG5cclxuZnVuY3Rpb24gR3JpZERlY29kZXJXb3JrZXJCYXNlKCkge1xyXG4gICAgR3JpZERlY29kZXJXb3JrZXJCYXNlLnByb3RvdHlwZS5zdGFydCA9IGZ1bmN0aW9uIGRlY29kZShkZWNvZGVySW5wdXQpIHtcclxuICAgICAgICB2YXIgaW1hZ2VQYXJ0UGFyYW1zID0gZGVjb2RlcklucHV0LmltYWdlUGFydFBhcmFtcztcclxuICAgICAgICB2YXIgd2lkdGggID0gaW1hZ2VQYXJ0UGFyYW1zLm1heFhFeGNsdXNpdmUgLSBpbWFnZVBhcnRQYXJhbXMubWluWDtcclxuICAgICAgICB2YXIgaGVpZ2h0ID0gaW1hZ2VQYXJ0UGFyYW1zLm1heFlFeGNsdXNpdmUgLSBpbWFnZVBhcnRQYXJhbXMubWluWTtcclxuICAgICAgICB2YXIgcmVzdWx0ID0gbmV3IEltYWdlRGF0YSh3aWR0aCwgaGVpZ2h0KTtcclxuICAgICAgICB2YXIgcHJvbWlzZXMgPSBbXTtcclxuICAgICAgICB2YXIgdGlsZVBvc2l0aW9uICA9IHttaW5YOiAwLCBtaW5ZOiAwLCBtYXhYRXhjbHVzaXZlOiAwLCBtYXhZRXhjbHVzaXZlOiAwLCB3aWR0aDogZGVjb2RlcklucHV0LnRpbGVXaWR0aCwgaGVpZ2h0OiBkZWNvZGVySW5wdXQudGlsZUhlaWdodH07XHJcbiAgICAgICAgdmFyIHJlZ2lvbkluSW1hZ2UgPSB7bWluWDogMCwgbWluWTogMCwgbWF4WEV4Y2x1c2l2ZTogMCwgbWF4WUV4Y2x1c2l2ZTogMCwgd2lkdGg6IDAsIGhlaWdodDogMH07IFxyXG4gICAgICAgIHZhciBvZmZzZXQgPSB7eDogMCwgeTogMH07XHJcbiAgICAgICAgdmFyIHRpbGUgPSB7dGlsZVg6IDAsIHRpbGVZOiAwLCBsZXZlbDogMCwgcG9zaXRpb246IHRpbGVQb3NpdGlvbiwgY29udGVudDogbnVsbH07XHJcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBkZWNvZGVySW5wdXQudGlsZUluZGljZXMubGVuZ3RoOyArK2kpIHtcclxuICAgICAgICAgICAgdGlsZVBvc2l0aW9uLm1pblggICAgICAgICAgPSBkZWNvZGVySW5wdXQudGlsZUluZGljZXNbaV0udGlsZVggKiBkZWNvZGVySW5wdXQudGlsZVdpZHRoIDtcclxuICAgICAgICAgICAgdGlsZVBvc2l0aW9uLm1pblkgICAgICAgICAgPSBkZWNvZGVySW5wdXQudGlsZUluZGljZXNbaV0udGlsZVkgKiBkZWNvZGVySW5wdXQudGlsZUhlaWdodDtcclxuICAgICAgICAgICAgdGlsZVBvc2l0aW9uLm1heFhFeGNsdXNpdmUgPSB0aWxlUG9zaXRpb24ubWluWCArIGRlY29kZXJJbnB1dC50aWxlV2lkdGg7XHJcbiAgICAgICAgICAgIHRpbGVQb3NpdGlvbi5tYXhZRXhjbHVzaXZlID0gdGlsZVBvc2l0aW9uLm1pblkgKyBkZWNvZGVySW5wdXQudGlsZUhlaWdodDtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHJlZ2lvbkluSW1hZ2UubWluWCAgICAgICAgICA9IE1hdGgubWF4KHRpbGVQb3NpdGlvbi5taW5YLCBpbWFnZVBhcnRQYXJhbXMubWluWCk7XHJcbiAgICAgICAgICAgIHJlZ2lvbkluSW1hZ2UubWluWSAgICAgICAgICA9IE1hdGgubWF4KHRpbGVQb3NpdGlvbi5taW5ZLCBpbWFnZVBhcnRQYXJhbXMubWluWSk7XHJcbiAgICAgICAgICAgIHJlZ2lvbkluSW1hZ2UubWF4WEV4Y2x1c2l2ZSA9IE1hdGgubWluKHRpbGVQb3NpdGlvbi5tYXhYRXhjbHVzaXZlLCBpbWFnZVBhcnRQYXJhbXMubWF4WEV4Y2x1c2l2ZSk7XHJcbiAgICAgICAgICAgIHJlZ2lvbkluSW1hZ2UubWF4WUV4Y2x1c2l2ZSA9IE1hdGgubWluKHRpbGVQb3NpdGlvbi5tYXhZRXhjbHVzaXZlLCBpbWFnZVBhcnRQYXJhbXMubWF4WUV4Y2x1c2l2ZSk7XHJcbiAgICAgICAgICAgIHJlZ2lvbkluSW1hZ2Uud2lkdGggICAgICAgICA9IHJlZ2lvbkluSW1hZ2UubWF4WEV4Y2x1c2l2ZSAtIHJlZ2lvbkluSW1hZ2UubWluWDtcclxuICAgICAgICAgICAgcmVnaW9uSW5JbWFnZS5oZWlnaHQgICAgICAgID0gcmVnaW9uSW5JbWFnZS5tYXhZRXhjbHVzaXZlIC0gcmVnaW9uSW5JbWFnZS5taW5ZO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgb2Zmc2V0LnggPSByZWdpb25JbkltYWdlLm1pblggLSBpbWFnZVBhcnRQYXJhbXMubWluWDtcclxuICAgICAgICAgICAgb2Zmc2V0LnkgPSByZWdpb25JbkltYWdlLm1pblkgLSBpbWFnZVBhcnRQYXJhbXMubWluWTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHRpbGUudGlsZVkgPSBkZWNvZGVySW5wdXQudGlsZUluZGljZXNbaV0udGlsZVk7XHJcbiAgICAgICAgICAgIHRpbGUudGlsZVggPSBkZWNvZGVySW5wdXQudGlsZUluZGljZXNbaV0udGlsZVg7XHJcbiAgICAgICAgICAgIHRpbGUubGV2ZWwgPSBkZWNvZGVySW5wdXQudGlsZUluZGljZXNbaV0ubGV2ZWw7XHJcbiAgICAgICAgICAgIHRpbGUuY29udGVudCA9IGRlY29kZXJJbnB1dC50aWxlQ29udGVudHNbaV07XHJcbiAgICAgICAgICAgIHByb21pc2VzLnB1c2godGhpcy5kZWNvZGVSZWdpb24ocmVzdWx0LCBvZmZzZXQsIHJlZ2lvbkluSW1hZ2UsIHRpbGUpKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgcmV0dXJuIFByb21pc2UuYWxsKHByb21pc2VzKS50aGVuKGZ1bmN0aW9uKCkge1xyXG4gICAgICAgICAgICByZXR1cm4gcmVzdWx0O1xyXG4gICAgICAgIH0pO1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgR3JpZERlY29kZXJXb3JrZXJCYXNlLnByb3RvdHlwZS5kZWNvZGVSZWdpb24gPSBmdW5jdGlvbiBkZWNvZGVSZWdpb24odGFyZ2V0SW1hZ2VEYXRhLCBpbWFnZVBhcnRQYXJhbXMsIGtleSwgZmV0Y2hlZERhdGEpIHtcclxuICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBkZWNvZGVSZWdpb24gaXMgbm90IGltcGxlbWVudGVkJztcclxuICAgIH07XHJcbn0iLCIndXNlIHN0cmljdCc7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IEdyaWRGZXRjaGVyQmFzZTtcclxuXHJcbnZhciBTaW1wbGVGZXRjaGVyQmFzZSA9IHJlcXVpcmUoJ3NpbXBsZS1mZXRjaGVyLWJhc2UuanMnKTtcclxudmFyIEdyaWRJbWFnZUJhc2UgPSByZXF1aXJlKCdncmlkLWltYWdlLWJhc2UuanMnKTtcclxudmFyIExpbmtlZExpc3QgPSByZXF1aXJlKCdsaW5rZWQtbGlzdC5qcycpO1xyXG5cclxuLyogZ2xvYmFsIFByb21pc2U6IGZhbHNlICovXHJcblxyXG52YXIgVElMRV9TVEFURV9BQ1RJVkUgPSAwO1xyXG52YXIgVElMRV9TVEFURV9QRU5ESU5HX1NUT1AgPSAxO1xyXG52YXIgVElMRV9TVEFURV9TVE9QUEVEID0gMjtcclxudmFyIFRJTEVfU1RBVEVfVEVSTUlOQVRFRCA9IDM7XHJcblxyXG5mdW5jdGlvbiBHcmlkRmV0Y2hlckJhc2Uob3B0aW9ucykge1xyXG4gICAgU2ltcGxlRmV0Y2hlckJhc2UuY2FsbCh0aGlzLCBvcHRpb25zKTtcclxuICAgIHRoaXMuX2dyaWRGZXRjaGVyQmFzZUNhY2hlID0gW107XHJcbiAgICB0aGlzLl9ldmVudHMgPSB7XHJcbiAgICAgICAgJ2RhdGEnOiBbXSxcclxuICAgICAgICAndGlsZS10ZXJtaW5hdGVkJzogW11cclxuICAgIH07XHJcbn1cclxuXHJcbkdyaWRGZXRjaGVyQmFzZS5wcm90b3R5cGUgPSBPYmplY3QuY3JlYXRlKFNpbXBsZUZldGNoZXJCYXNlLnByb3RvdHlwZSk7XHJcblxyXG5HcmlkRmV0Y2hlckJhc2UucHJvdG90eXBlLmZldGNoVGlsZSA9IGZ1bmN0aW9uKGxldmVsLCB0aWxlWCwgdGlsZVksIGZldGNoVGFzaykge1xyXG4gICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogR3JpZEZldGNoZXJCYXNlLmZldGNoVGlsZSBpcyBub3QgaW1wbGVtZW50ZWQgYnkgaW5oZXJpdG9yJztcclxufTtcclxuXHJcbkdyaWRGZXRjaGVyQmFzZS5wcm90b3R5cGUub24gPSBmdW5jdGlvbihldmVudCwgbGlzdGVuZXIpIHtcclxuICAgIHZhciBsaXN0ZW5lcnMgPSB0aGlzLl9ldmVudHNbZXZlbnRdO1xyXG4gICAgaWYgKCFsaXN0ZW5lcnMpIHtcclxuICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBVbmV4cGVjdGVkIGV2ZW50ICcgKyBldmVudCArICcgaW4gR3JpZEZldGNoZXJCYXNlJztcclxuICAgIH1cclxuICAgIGxpc3RlbmVycy5wdXNoKGxpc3RlbmVyKTtcclxufTtcclxuXHJcbkdyaWRGZXRjaGVyQmFzZS5wcm90b3R5cGUuc3RhcnRGZXRjaCA9IGZ1bmN0aW9uIHN0YXJ0RmV0Y2goZmV0Y2hDb250ZXh0LCBpbWFnZVBhcnRQYXJhbXMpIHtcclxuICAgIHZhciBmZXRjaERhdGEgPSB7XHJcbiAgICAgICAgYWN0aXZlVGlsZXNDb3VudDogMCxcclxuICAgICAgICBhY3RpdmVUaWxlc0NvdW50V2l0aFNpbmdsZUxpc3RlbmVyOiAwLFxyXG4gICAgICAgIHRpbGVMaXN0ZW5lcnM6IFtdLFxyXG4gICAgICAgIGZldGNoQ29udGV4dDogZmV0Y2hDb250ZXh0LFxyXG4gICAgICAgIGlzUGVuZGluZ1N0b3A6IGZhbHNlLFxyXG4gICAgICAgIGlzQWN0aXZlOiBmYWxzZSxcclxuICAgICAgICBpbWFnZVBhcnRQYXJhbXM6IGltYWdlUGFydFBhcmFtcyxcclxuICAgICAgICBzZWxmOiB0aGlzXHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBmZXRjaENvbnRleHQub24oJ3N0b3AnLCBvbkZldGNoU3RvcCwgZmV0Y2hEYXRhKTtcclxuICAgIGZldGNoQ29udGV4dC5vbigncmVzdW1lJywgb25GZXRjaFJlc3VtZSwgZmV0Y2hEYXRhKTtcclxuICAgIGZldGNoQ29udGV4dC5vbigndGVybWluYXRlJywgb25GZXRjaFRlcm1pbmF0ZSwgZmV0Y2hEYXRhKTtcclxuXHJcbiAgICB2YXIgdGlsZXNUb1N0YXJ0WCA9IFtdO1xyXG4gICAgdmFyIHRpbGVzVG9TdGFydFkgPSBbXTtcclxuICAgIHZhciB0aWxlc1RvU3RhcnRUaWxlQ29udGV4dHMgPSBbXTtcclxuICAgIFxyXG4gICAgdmFyIHRpbGVzUmFuZ2UgPSBHcmlkSW1hZ2VCYXNlLmdldFRpbGVzUmFuZ2UodGhpcy5nZXRJbWFnZVBhcmFtcygpLCBpbWFnZVBhcnRQYXJhbXMpO1xyXG4gICAgZmV0Y2hEYXRhLmFjdGl2ZVRpbGVzQ291bnQgPSAodGlsZXNSYW5nZS5tYXhUaWxlWCAtIHRpbGVzUmFuZ2UubWluVGlsZVgpICogKHRpbGVzUmFuZ2UubWF4VGlsZVkgLSB0aWxlc1JhbmdlLm1pblRpbGVZKTtcclxuICAgIGZvciAodmFyIHRpbGVYID0gdGlsZXNSYW5nZS5taW5UaWxlWDsgdGlsZVggPCB0aWxlc1JhbmdlLm1heFRpbGVYOyArK3RpbGVYKSB7XHJcbiAgICAgICAgZm9yICh2YXIgdGlsZVkgPSB0aWxlc1JhbmdlLm1pblRpbGVZOyB0aWxlWSA8IHRpbGVzUmFuZ2UubWF4VGlsZVk7ICsrdGlsZVkpIHtcclxuICAgICAgICAgICAgdmFyIHRpbGVDb250ZXh0ID0gdGhpcy5fYWRkVG9DYWNoZSh0aWxlWCwgdGlsZVksIGZldGNoRGF0YSk7XHJcbiAgICAgICAgICAgIGlmICh0aWxlQ29udGV4dCA9PT0gbnVsbCkge1xyXG4gICAgICAgICAgICAgICAgY29udGludWU7XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIHRpbGVzVG9TdGFydFgucHVzaCh0aWxlWCk7XHJcbiAgICAgICAgICAgIHRpbGVzVG9TdGFydFkucHVzaCh0aWxlWSk7XHJcbiAgICAgICAgICAgIHRpbGVzVG9TdGFydFRpbGVDb250ZXh0cy5wdXNoKHRpbGVDb250ZXh0KTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICBcclxuICAgIG9uRmV0Y2hSZXN1bWUuY2FsbChmZXRjaERhdGEpO1xyXG4gICAgXHJcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IHRpbGVzVG9TdGFydFgubGVuZ3RoOyArK2kpIHtcclxuICAgICAgICB0aGlzLl9sb2FkVGlsZShmZXRjaERhdGEuaW1hZ2VQYXJ0UGFyYW1zLmxldmVsLCB0aWxlc1RvU3RhcnRYW2ldLCB0aWxlc1RvU3RhcnRZW2ldLCB0aWxlc1RvU3RhcnRUaWxlQ29udGV4dHNbaV0pO1xyXG4gICAgfVxyXG59O1xyXG5cclxuR3JpZEZldGNoZXJCYXNlLnByb3RvdHlwZS5fY2hlY2tJZlNob3VsZFN0b3AgPSBmdW5jdGlvbiB0cnlTdG9wRmV0Y2goZmV0Y2hEYXRhKSB7XHJcbiAgICBpZiAoIWZldGNoRGF0YS5pc1BlbmRpbmdTdG9wIHx8IGZldGNoRGF0YS5hY3RpdmVUaWxlc0NvdW50V2l0aFNpbmdsZUxpc3RlbmVyID4gMCkge1xyXG4gICAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIFxyXG4gICAgZmV0Y2hEYXRhLmlzUGVuZGluZ1N0b3AgPSBmYWxzZTtcclxuICAgIGZldGNoRGF0YS5pc0FjdGl2ZSA9IGZhbHNlO1xyXG4gICAgdGhpcy5fY2hhbmdlU2luZ2xlTGlzdGVuZXJDb3VudE9mT3ZlcmxhcHBpbmdGZXRjaGVzKGZldGNoRGF0YSwgKzEpO1xyXG4gICAgZmV0Y2hEYXRhLmZldGNoQ29udGV4dC5zdG9wcGVkKCk7XHJcbn07XHJcbiAgICBcclxuR3JpZEZldGNoZXJCYXNlLnByb3RvdHlwZS5fY2hhbmdlU2luZ2xlTGlzdGVuZXJDb3VudE9mT3ZlcmxhcHBpbmdGZXRjaGVzID1cclxuICAgICAgICBmdW5jdGlvbiBjaGFuZ2VTaW5nbGVMaXN0ZW5lckNvdW50T2ZPdmVybGFwcGluZ0ZldGNoZXMoZmV0Y2hEYXRhLCBhZGRWYWx1ZSkge1xyXG4gICAgICAgICAgICBcclxuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgZmV0Y2hEYXRhLnRpbGVMaXN0ZW5lcnMubGVuZ3RoOyArK2kpIHtcclxuICAgICAgICB2YXIgdGlsZUNvbnRleHQgPSBmZXRjaERhdGEudGlsZUxpc3RlbmVyc1tpXS50aWxlQ29udGV4dDtcclxuICAgICAgICB0aGlzLl9jaGFuZ2VTaW5nbGVMaXN0ZW5lckNvdW50KHRpbGVDb250ZXh0LmRlcGVuZEZldGNoZXMsIC8qc2luZ2xlTGlzdGVuZXJBZGRWYWx1ZT0qL2FkZFZhbHVlKTtcclxuICAgIH1cclxufTtcclxuXHJcbkdyaWRGZXRjaGVyQmFzZS5wcm90b3R5cGUuX2RlY3JlbWVudEFjdGl2ZVRpbGVzID0gZnVuY3Rpb24odGlsZURlcGVuZEZldGNoZXMpIHtcclxuICAgIHZhciBzaW5nbGVBY3RpdmVGZXRjaCA9IG51bGw7XHJcbiAgICB2YXIgaGFzQWN0aXZlRmV0Y2hlcyA9IGZhbHNlO1xyXG4gICAgdmFyIGl0ZXJhdG9yID0gdGlsZURlcGVuZEZldGNoZXMuZ2V0Rmlyc3RJdGVyYXRvcigpO1xyXG4gICAgd2hpbGUgKGl0ZXJhdG9yICE9PSBudWxsKSB7XHJcbiAgICAgICAgdmFyIGZldGNoRGF0YSA9IHRpbGVEZXBlbmRGZXRjaGVzLmdldFZhbHVlKGl0ZXJhdG9yKTtcclxuICAgICAgICBpdGVyYXRvciA9IHRpbGVEZXBlbmRGZXRjaGVzLmdldE5leHRJdGVyYXRvcihpdGVyYXRvcik7XHJcblxyXG4gICAgICAgIC0tZmV0Y2hEYXRhLmFjdGl2ZVRpbGVzQ291bnQ7XHJcbiAgICAgICAgaWYgKGZldGNoRGF0YS5hY3RpdmVUaWxlc0NvdW50ID09PSAwKSB7XHJcbiAgICAgICAgICAgIGZldGNoRGF0YS5pc0FjdGl2ZSA9IGZhbHNlO1xyXG4gICAgICAgICAgICBmZXRjaERhdGEuZmV0Y2hDb250ZXh0LmRvbmUoKTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbn07XHJcblxyXG5HcmlkRmV0Y2hlckJhc2UucHJvdG90eXBlLl9jaGFuZ2VTaW5nbGVMaXN0ZW5lckNvdW50ID0gZnVuY3Rpb24odGlsZURlcGVuZEZldGNoZXMsIHNpbmdsZUxpc3RlbmVyQWRkVmFsdWUpIHtcclxuICAgIHZhciBzaW5nbGVBY3RpdmVGZXRjaCA9IG51bGw7XHJcbiAgICB2YXIgaGFzQWN0aXZlRmV0Y2hlcyA9IGZhbHNlO1xyXG4gICAgdmFyIGl0ZXJhdG9yID0gdGlsZURlcGVuZEZldGNoZXMuZ2V0Rmlyc3RJdGVyYXRvcigpO1xyXG4gICAgd2hpbGUgKGl0ZXJhdG9yICE9PSBudWxsKSB7XHJcbiAgICAgICAgdmFyIGZldGNoRGF0YSA9IHRpbGVEZXBlbmRGZXRjaGVzLmdldFZhbHVlKGl0ZXJhdG9yKTtcclxuICAgICAgICBpdGVyYXRvciA9IHRpbGVEZXBlbmRGZXRjaGVzLmdldE5leHRJdGVyYXRvcihpdGVyYXRvcik7XHJcblxyXG4gICAgICAgIGlmICghZmV0Y2hEYXRhLmlzQWN0aXZlKSB7XHJcbiAgICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgIH0gZWxzZSBpZiAoc2luZ2xlQWN0aXZlRmV0Y2ggPT09IG51bGwpIHtcclxuICAgICAgICAgICAgc2luZ2xlQWN0aXZlRmV0Y2ggPSBmZXRjaERhdGE7XHJcbiAgICAgICAgICAgIGhhc0FjdGl2ZUZldGNoZXMgPSB0cnVlO1xyXG4gICAgICAgIH0gZWxzZSBpZiAoaGFzQWN0aXZlRmV0Y2hlcykge1xyXG4gICAgICAgICAgICAvLyBOb3Qgc2luZ2xlIGFueW1vcmVcclxuICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuICAgIFxyXG4gICAgaWYgKHNpbmdsZUFjdGl2ZUZldGNoICE9PSBudWxsKSB7XHJcbiAgICAgICAgc2luZ2xlQWN0aXZlRmV0Y2guYWN0aXZlVGlsZXNDb3VudFdpdGhTaW5nbGVMaXN0ZW5lciArPSBzaW5nbGVMaXN0ZW5lckFkZFZhbHVlO1xyXG4gICAgICAgIHRoaXMuX2NoZWNrSWZTaG91bGRTdG9wKHNpbmdsZUFjdGl2ZUZldGNoKTtcclxuICAgIH1cclxufTtcclxuXHJcbmZ1bmN0aW9uIG9uRmV0Y2hTdG9wKCkge1xyXG4gICAgLyoganNoaW50IHZhbGlkdGhpczogdHJ1ZSAqL1xyXG4gICAgdmFyIGZldGNoRGF0YSA9IHRoaXM7XHJcblxyXG4gICAgZmV0Y2hEYXRhLmlzUGVuZGluZ1N0b3AgPSB0cnVlO1xyXG4gICAgZmV0Y2hEYXRhLnNlbGYuX2NoZWNrSWZTaG91bGRTdG9wKGZldGNoRGF0YSk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIG9uRmV0Y2hSZXN1bWUoKSB7XHJcbiAgICAvKiBqc2hpbnQgdmFsaWR0aGlzOiB0cnVlICovXHJcbiAgICB2YXIgZmV0Y2hEYXRhID0gdGhpcztcclxuICAgIGZldGNoRGF0YS5pc1BlbmRpbmdTdG9wID0gZmFsc2U7XHJcbiAgICBcclxuICAgIGZldGNoRGF0YS5zZWxmLl9jaGFuZ2VTaW5nbGVMaXN0ZW5lckNvdW50T2ZPdmVybGFwcGluZ0ZldGNoZXMoZmV0Y2hEYXRhLCAtMSk7XHJcbiAgICBmZXRjaERhdGEuaXNBY3RpdmUgPSB0cnVlO1xyXG59XHJcblxyXG5mdW5jdGlvbiBvbkZldGNoVGVybWluYXRlKCkge1xyXG4gICAgLyoganNoaW50IHZhbGlkdGhpczogdHJ1ZSAqL1xyXG4gICAgdmFyIGZldGNoRGF0YSA9IHRoaXM7XHJcbiAgICBcclxuICAgIGlmIChmZXRjaERhdGEuaXNBY3RpdmUpIHtcclxuICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBVbmV4cGVjdGVkIGdyaWQgZmV0Y2ggdGVybWluYXRlZCBvZiBhIHN0aWxsIGFjdGl2ZSBmZXRjaCc7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgZmV0Y2hEYXRhLnRpbGVMaXN0ZW5lcnMubGVuZ3RoOyArK2kpIHtcclxuICAgICAgICBmZXRjaERhdGEudGlsZUxpc3RlbmVyc1tpXS50aWxlQ29udGV4dC5kZXBlbmRGZXRjaGVzLnJlbW92ZShmZXRjaERhdGEudGlsZUxpc3RlbmVyc1tpXS5pdGVyYXRvcik7XHJcbiAgICB9XHJcbn1cclxuXHJcbkdyaWRGZXRjaGVyQmFzZS5wcm90b3R5cGUuX2xvYWRUaWxlID0gZnVuY3Rpb24gbG9hZFRpbGUobGV2ZWwsIHRpbGVYLCB0aWxlWSwgdGlsZUNvbnRleHQpIHtcclxuICAgIHZhciB0aWxlS2V5ID0ge1xyXG4gICAgICAgIGZldGNoV2FpdFRhc2s6IHRydWUsXHJcbiAgICAgICAgdGlsZVg6IHRpbGVYLFxyXG4gICAgICAgIHRpbGVZOiB0aWxlWSxcclxuICAgICAgICBsZXZlbDogbGV2ZWxcclxuICAgIH07XHJcbiAgICBcclxuICAgIHZhciBzZWxmID0gdGhpcztcclxuICAgIHZhciB0aWxlRmV0Y2hBcGkgPSB7XHJcbiAgICAgICAgZGF0YVJlYWR5OiBmdW5jdGlvbihyZXN1bHQpIHtcclxuICAgICAgICAgICAgaWYgKHRpbGVDb250ZXh0LnRpbGVTdGF0ZSAhPT0gVElMRV9TVEFURV9BQ1RJVkUgJiYgdGlsZUNvbnRleHQudGlsZVN0YXRlICE9PSBUSUxFX1NUQVRFX1BFTkRJTkdfU1RPUCkge1xyXG4gICAgICAgICAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogZWl0aGVyIHN0b3BwZWQgb3IgYWxyZWFkeSB0ZXJtaW5hdGVkIGluIEdyaWRGZXRjaGVyQmFzZS5mZXRjaFRpbGUoKSc7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgaWYgKHNlbGYuX2dyaWRGZXRjaGVyQmFzZUNhY2hlW2xldmVsXVt0aWxlWF1bdGlsZVldICE9PSB0aWxlQ29udGV4dCkge1xyXG4gICAgICAgICAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogVW5leHBlY3RlZCBmZXRjaCBpbiBHcmlkRmV0Y2hlckJhc2UuZ3JpZEZldGNoZXJCYXNlQ2FjaGUnO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIHZhciBkYXRhID0ge1xyXG4gICAgICAgICAgICAgICAgdGlsZUtleTogdGlsZUtleSxcclxuICAgICAgICAgICAgICAgIHRpbGVDb250ZW50OiByZXN1bHRcclxuICAgICAgICAgICAgfTtcclxuICAgICAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBzZWxmLl9ldmVudHMuZGF0YS5sZW5ndGg7ICsraSkge1xyXG4gICAgICAgICAgICAgICAgc2VsZi5fZXZlbnRzLmRhdGFbaV0oZGF0YSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9LFxyXG4gICAgICAgIFxyXG4gICAgICAgIHRlcm1pbmF0ZTogZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgICAgIGlmICh0aWxlQ29udGV4dC50aWxlU3RhdGUgIT09IFRJTEVfU1RBVEVfQUNUSVZFICYmIHRpbGVDb250ZXh0LnRpbGVTdGF0ZSAhPT0gVElMRV9TVEFURV9QRU5ESU5HX1NUT1ApIHtcclxuICAgICAgICAgICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IGVpdGhlciBzdG9wcGVkIG9yIGFscmVhZHkgdGVybWluYXRlZCBpbiBHcmlkRmV0Y2hlckJhc2UuZmV0Y2hUaWxlKCknO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGlmIChzZWxmLl9ncmlkRmV0Y2hlckJhc2VDYWNoZVtsZXZlbF1bdGlsZVhdW3RpbGVZXSAhPT0gdGlsZUNvbnRleHQpIHtcclxuICAgICAgICAgICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IFVuZXhwZWN0ZWQgZmV0Y2ggaW4gR3JpZEZldGNoZXJCYXNlLmdyaWRGZXRjaGVyQmFzZUNhY2hlJztcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB0aWxlQ29udGV4dC50aWxlU3RhdGUgPSBUSUxFX1NUQVRFX1RFUk1JTkFURUQ7XHJcbiAgICAgICAgICAgIHNlbGYuX2dyaWRGZXRjaGVyQmFzZUNhY2hlW2xldmVsXVt0aWxlWF1bdGlsZVldID0gbnVsbDtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgc2VsZi5fZXZlbnRzWyd0aWxlLXRlcm1pbmF0ZWQnXS5sZW5ndGg7ICsraSkge1xyXG4gICAgICAgICAgICAgICAgc2VsZi5fZXZlbnRzWyd0aWxlLXRlcm1pbmF0ZWQnXVtpXSh0aWxlS2V5KTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgc2VsZi5fZGVjcmVtZW50QWN0aXZlVGlsZXModGlsZUNvbnRleHQuZGVwZW5kRmV0Y2hlcyk7XHJcbiAgICAgICAgICAgIHNlbGYuX2NoYW5nZVNpbmdsZUxpc3RlbmVyQ291bnQodGlsZUNvbnRleHQuZGVwZW5kRmV0Y2hlcywgLypzaW5nbGVMaXN0ZW5lckFkZFZhbHVlPSovLTEpO1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgLyogVE9ETzogZW5hYmxlIHN0b3AgJiByZXN1bWVcclxuICAgICAgICBvbjogZnVuY3Rpb24oZXZlbnQsIGhhbmRsZXIpIHtcclxuICAgICAgICAgICAgaWYgKGV2ZW50ICE9PSAnc3RvcCcgJiYgZXZlbnQgIT09ICdyZXN1bWUnKSB7XHJcbiAgICAgICAgICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBHcmlkRmV0Y2hlckJhc2UgdGlsZS5vbiB1bmV4cGVjdGVkIGV2ZW50ICcgKyBldmVudCArICc6IGV4cGVjdGVkIHN0b3Agb3IgcmVzdW1lJztcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgdGlsZUNvbnRleHRbZXZlbnQgKyAnTGlzdGVuZXJzJ10ucHVzaChoYW5kbGVyKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgc3RvcHBlZDogZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgICAgIGlmICh0aWxlQ29udGV4dC50aWxlU3RhdGUgIT09IFRJTEVfU1RBVEVfUEVORElOR19TVE9QKSB7XHJcbiAgICAgICAgICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBVbmV4cGVjdGVkIHN0b3BwZWQgY2FsbC4gRWl0aGVyOiAxLiBObyBzdG9wIHJlcXVlc3RlZCBvciwgMi4gcmVzdW1lIHdhcyBjYWxsZWQgJyArXHJcbiAgICAgICAgICAgICAgICAgICAgJ3RpbGwgdGhlbiBvciwgMy4gQWxyZWFkeSBjYWxsZWQgc3RvcHBlZCBvciwgNC4gQWxyZWFkeSBjYWxsZWQgdGVybWluYXRlJztcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgICAgICAqL1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgdGhpcy5mZXRjaFRpbGUobGV2ZWwsIHRpbGVYLCB0aWxlWSwgdGlsZUZldGNoQXBpKTtcclxufTtcclxuXHJcbkdyaWRGZXRjaGVyQmFzZS5wcm90b3R5cGUuX2FkZFRvQ2FjaGUgPSBmdW5jdGlvbiBhZGRUb0NhY2hlKHRpbGVYLCB0aWxlWSwgZmV0Y2hEYXRhKSB7XHJcbiAgICB2YXIgbGV2ZWxDYWNoZSA9IHRoaXMuX2dyaWRGZXRjaGVyQmFzZUNhY2hlW2ZldGNoRGF0YS5pbWFnZVBhcnRQYXJhbXMubGV2ZWxdO1xyXG4gICAgaWYgKCFsZXZlbENhY2hlKSB7XHJcbiAgICAgICAgbGV2ZWxDYWNoZSA9IFtdO1xyXG4gICAgICAgIHRoaXMuX2dyaWRGZXRjaGVyQmFzZUNhY2hlW2ZldGNoRGF0YS5pbWFnZVBhcnRQYXJhbXMubGV2ZWxdID0gbGV2ZWxDYWNoZTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgdmFyIHhDYWNoZSA9IGxldmVsQ2FjaGVbdGlsZVhdO1xyXG4gICAgaWYgKCF4Q2FjaGUpIHtcclxuICAgICAgICB4Q2FjaGUgPSBbXTtcclxuICAgICAgICBsZXZlbENhY2hlW3RpbGVYXSA9IHhDYWNoZTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgdmFyIHRpbGVDb250ZXh0ID0geENhY2hlW3RpbGVZXTtcclxuICAgIHZhciBpc05ldyA9IGZhbHNlO1xyXG4gICAgaWYgKCF0aWxlQ29udGV4dCkge1xyXG4gICAgICAgIHRpbGVDb250ZXh0ID0ge1xyXG4gICAgICAgICAgICBkZXBlbmRGZXRjaGVzOiBuZXcgTGlua2VkTGlzdCgpLFxyXG4gICAgICAgICAgICBzdG9wTGlzdGVuZXJzOiBbXSxcclxuICAgICAgICAgICAgcmVzdW1lTGlzdGVuZXJzOiBbXSxcclxuICAgICAgICAgICAgdGlsZVN0YXRlOiBUSUxFX1NUQVRFX0FDVElWRVxyXG4gICAgICAgIH07XHJcbiAgICAgICAgeENhY2hlW3RpbGVZXSA9IHRpbGVDb250ZXh0O1xyXG4gICAgICAgICsrZmV0Y2hEYXRhLmFjdGl2ZVRpbGVzQ291bnRXaXRoU2luZ2xlTGlzdGVuZXI7XHJcbiAgICAgICAgaXNOZXcgPSB0cnVlO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBmZXRjaERhdGEudGlsZUxpc3RlbmVycy5wdXNoKHtcclxuICAgICAgICB0aWxlQ29udGV4dDogdGlsZUNvbnRleHQsXHJcbiAgICAgICAgaXRlcmF0b3I6IHRpbGVDb250ZXh0LmRlcGVuZEZldGNoZXMuYWRkKGZldGNoRGF0YSlcclxuICAgIH0pO1xyXG4gICAgcmV0dXJuIGlzTmV3ID8gdGlsZUNvbnRleHQgOiBudWxsO1xyXG59OyIsIid1c2Ugc3RyaWN0JztcclxuXHJcbnZhciBHcmlkTGV2ZWxDYWxjdWxhdG9yID0gcmVxdWlyZSgnZ3JpZC1sZXZlbC1jYWxjdWxhdG9yLmpzJyk7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IEdyaWRJbWFnZUJhc2U7XHJcblxyXG4vKiBnbG9iYWwgUHJvbWlzZTogZmFsc2UgKi9cclxuXHJcbnZhciBGRVRDSF9XQUlUX1RBU0sgPSAwO1xyXG52YXIgREVDT0RFX1RBU0sgPSAxO1xyXG5cclxuZnVuY3Rpb24gR3JpZEltYWdlQmFzZShmZXRjaGVyKSB7XHJcbiAgICB0aGlzLl9mZXRjaGVyID0gZmV0Y2hlcjtcclxuICAgIHRoaXMuX2ltYWdlUGFyYW1zID0gbnVsbDtcclxuICAgIHRoaXMuX3dhaXRpbmdGZXRjaGVzID0ge307XHJcbiAgICB0aGlzLl9sZXZlbENhbGN1bGF0b3IgPSBudWxsO1xyXG59XHJcblxyXG5HcmlkSW1hZ2VCYXNlLnByb3RvdHlwZS5vcGVuZWQgPSBmdW5jdGlvbiBvcGVuZWQoaW1hZ2VEZWNvZGVyKSB7XHJcbiAgICB0aGlzLl9pbWFnZVBhcmFtcyA9IGltYWdlRGVjb2Rlci5nZXRJbWFnZVBhcmFtcygpO1xyXG4gICAgaW1hZ2VEZWNvZGVyLm9uRmV0Y2hlckV2ZW50KCdkYXRhJywgdGhpcy5fb25EYXRhRmV0Y2hlZC5iaW5kKHRoaXMpKTtcclxuICAgIGltYWdlRGVjb2Rlci5vbkZldGNoZXJFdmVudCgndGlsZS10ZXJtaW5hdGVkJywgdGhpcy5fb25UaWxlVGVybWluYXRlZC5iaW5kKHRoaXMpKTtcclxufTtcclxuXHJcbkdyaWRJbWFnZUJhc2UucHJvdG90eXBlLmdldExldmVsQ2FsY3VsYXRvciA9IGZ1bmN0aW9uIGdldExldmVsQ2FsY3VsYXRvcigpIHtcclxuICAgIGlmICh0aGlzLl9sZXZlbENhbGN1bGF0b3IgPT09IG51bGwpIHtcclxuICAgICAgICB0aGlzLl9sZXZlbENhbGN1bGF0b3IgPSBuZXcgR3JpZExldmVsQ2FsY3VsYXRvcih0aGlzLl9pbWFnZVBhcmFtcyk7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gdGhpcy5fbGV2ZWxDYWxjdWxhdG9yO1xyXG59O1xyXG5cclxuR3JpZEltYWdlQmFzZS5wcm90b3R5cGUuZ2V0RGVjb2RlV29ya2VyVHlwZU9wdGlvbnMgPSBmdW5jdGlvbiBnZXREZWNvZGVXb3JrZXJUeXBlT3B0aW9ucygpIHtcclxuICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IEdyaWRJbWFnZUJhc2UuZ2V0RGVjb2RlV29ya2VyVHlwZU9wdGlvbnMgaXMgbm90IGltcGxlbWVudGVkIGJ5IGluaGVyaXRvcic7XHJcbn07XHJcblxyXG5HcmlkSW1hZ2VCYXNlLnByb3RvdHlwZS5nZXREZWNvZGVyV29ya2Vyc0lucHV0UmV0cmVpdmVyID0gZnVuY3Rpb24gZ2V0RGVjb2RlcldvcmtlcnNJbnB1dFJldHJlaXZlcigpIHtcclxuICAgIHJldHVybiB0aGlzO1xyXG59O1xyXG5cclxuR3JpZEltYWdlQmFzZS5wcm90b3R5cGUuZGVjb2RlVGFza1N0YXJ0ZWQgPSBmdW5jdGlvbiBkZWNvZGVUYXNrU3RhcnRlZCh0YXNrKSB7XHJcbiAgICB2YXIgc2VsZiA9IHRoaXM7XHJcbiAgICB0YXNrLm9uKCdhbGxEZXBlbmRUYXNrc1Rlcm1pbmF0ZWQnLCBmdW5jdGlvbigpIHtcclxuICAgICAgICBzZWxmLmRhdGFSZWFkeUZvckRlY29kZSh0YXNrKTtcclxuICAgICAgICB0YXNrLnRlcm1pbmF0ZSgpO1xyXG4gICAgfSk7XHJcbn07XHJcblxyXG5HcmlkSW1hZ2VCYXNlLnByb3RvdHlwZS5kYXRhUmVhZHlGb3JEZWNvZGUgPSBmdW5jdGlvbiBkYXRhUmVhZHlGb3JEZWNvZGUodGFzaykge1xyXG4gICAgdGFzay5kYXRhUmVhZHkoe1xyXG4gICAgICAgIHRpbGVDb250ZW50czogdGFzay5kZXBlbmRUYXNrUmVzdWx0cyxcclxuICAgICAgICB0aWxlSW5kaWNlczogdGFzay5kZXBlbmRUYXNrS2V5cyxcclxuICAgICAgICBpbWFnZVBhcnRQYXJhbXM6IHRhc2sua2V5LFxyXG4gICAgICAgIHRpbGVXaWR0aDogdGhpcy5faW1hZ2VQYXJhbXMudGlsZVdpZHRoLFxyXG4gICAgICAgIHRpbGVIZWlnaHQ6IHRoaXMuX2ltYWdlUGFyYW1zLnRpbGVIZWlnaHRcclxuICAgIH0sIERFQ09ERV9UQVNLLCAvKmNhblNraXA9Ki90cnVlKTtcclxufTtcclxuXHJcbkdyaWRJbWFnZUJhc2UucHJvdG90eXBlLmdldEZldGNoZXIgPSBmdW5jdGlvbiBnZXRGZXRjaGVyKCkge1xyXG4gICAgcmV0dXJuIHRoaXMuX2ZldGNoZXI7XHJcbn07XHJcblxyXG4vLyBEZXBlbmRlbmN5V29ya2Vyc0lucHV0UmV0cmVpdmVyIGltcGxlbWVudGF0aW9uXHJcblxyXG5HcmlkSW1hZ2VCYXNlLnByb3RvdHlwZS5nZXRXb3JrZXJUeXBlT3B0aW9ucyA9IGZ1bmN0aW9uKHRhc2tUeXBlKSB7XHJcbiAgICBpZiAodGFza1R5cGUgPT09IEZFVENIX1dBSVRfVEFTSykge1xyXG4gICAgICAgIHJldHVybiBudWxsO1xyXG4gICAgfSBlbHNlIGlmICh0YXNrVHlwZSA9PT0gREVDT0RFX1RBU0spIHtcclxuICAgICAgICByZXR1cm4gdGhpcy5nZXREZWNvZGVXb3JrZXJUeXBlT3B0aW9ucygpO1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGludGVybmFsIGVycm9yOiBHcmlkSW1hZ2VCYXNlLmdldFRhc2tUeXBlT3B0aW9ucyBnb3QgdW5leHBlY3RlZCB0YXNrIHR5cGUgJyArIHRhc2tUeXBlO1xyXG4gICAgfVxyXG59O1xyXG5cclxuR3JpZEltYWdlQmFzZS5wcm90b3R5cGUuZ2V0S2V5QXNTdHJpbmcgPSBmdW5jdGlvbihrZXkpIHtcclxuICAgIGlmIChrZXkuZmV0Y2hXYWl0VGFzaykge1xyXG4gICAgICAgIHJldHVybiAnZmV0Y2hXYWl0OicgKyBrZXkudGlsZVggKyAnLCcgKyBrZXkudGlsZVkgKyAnOicgKyBrZXkubGV2ZWw7XHJcbiAgICB9XHJcbiAgICAvLyBPdGhlcndpc2UgaXQncyBhIGltYWdlUGFydFBhcmFtcyBrZXkgcGFzc2VkIGJ5IGltYWdlRGVjb2RlckZyYW1ld29yayBsaWIuIEp1c3QgY3JlYXRlIGEgdW5pcXVlIHN0cmluZ1xyXG4gICAgcmV0dXJuIEpTT04uc3RyaW5naWZ5KGtleSk7XHJcbn07XHJcblxyXG5HcmlkSW1hZ2VCYXNlLnByb3RvdHlwZS50YXNrU3RhcnRlZCA9IGZ1bmN0aW9uKHRhc2spIHsgICAgXHJcbiAgICB2YXIgc2VsZiA9IHRoaXM7XHJcbiAgICBcclxuICAgIGlmICh0YXNrLmtleS5mZXRjaFdhaXRUYXNrKSB7XHJcbiAgICAgICAgdmFyIHN0cktleSA9IHRoaXMuZ2V0S2V5QXNTdHJpbmcodGFzay5rZXkpO1xyXG4gICAgICAgIHRoaXMuX3dhaXRpbmdGZXRjaGVzW3N0cktleV0gPSB0YXNrO1xyXG4gICAgICAgIHJldHVybjtcclxuICAgIH1cclxuXHJcbiAgICBpZiAodGhpcy5faW1hZ2VQYXJhbXMgPT09IG51bGwpIHtcclxuICAgICAgICB0aGlzLl9pbWFnZVBhcmFtcyA9IHRoaXMuZ2V0SW1hZ2VQYXJhbXMoKTsgLy8gaW1hZ2VQYXJhbXMgdGhhdCByZXR1cm5lZCBieSBmZXRjaGVyLm9wZW4oKVxyXG4gICAgfVxyXG5cclxuICAgIHZhciBpbWFnZVBhcnRQYXJhbXMgPSB0YXNrLmtleTtcclxuICAgIHZhciB0aWxlc1JhbmdlID0gR3JpZEltYWdlQmFzZS5nZXRUaWxlc1JhbmdlKHRoaXMuX2ltYWdlUGFyYW1zLCBpbWFnZVBhcnRQYXJhbXMpO1xyXG4gICAgXHJcbiAgICB2YXIgaSA9IDA7XHJcbiAgICBmb3IgKHZhciB0aWxlWCA9IHRpbGVzUmFuZ2UubWluVGlsZVg7IHRpbGVYIDwgdGlsZXNSYW5nZS5tYXhUaWxlWDsgKyt0aWxlWCkge1xyXG4gICAgICAgIGZvciAodmFyIHRpbGVZID0gdGlsZXNSYW5nZS5taW5UaWxlWTsgdGlsZVkgPCB0aWxlc1JhbmdlLm1heFRpbGVZOyArK3RpbGVZKSB7XHJcbiAgICAgICAgICAgIHRhc2sucmVnaXN0ZXJUYXNrRGVwZW5kZW5jeSh7XHJcbiAgICAgICAgICAgICAgICBmZXRjaFdhaXRUYXNrOiB0cnVlLFxyXG4gICAgICAgICAgICAgICAgdGlsZVg6IHRpbGVYLFxyXG4gICAgICAgICAgICAgICAgdGlsZVk6IHRpbGVZLFxyXG4gICAgICAgICAgICAgICAgbGV2ZWw6IGltYWdlUGFydFBhcmFtcy5sZXZlbFxyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHRoaXMuZGVjb2RlVGFza1N0YXJ0ZWQodGFzayk7XHJcbn07XHJcblxyXG4vLyBBdXhpbGlhcnkgbWV0aG9kc1xyXG5cclxuR3JpZEltYWdlQmFzZS5wcm90b3R5cGUuX29uRGF0YUZldGNoZWQgPSBmdW5jdGlvbihmZXRjaGVkVGlsZSkge1xyXG4gICAgdmFyIHN0cktleSA9IHRoaXMuZ2V0S2V5QXNTdHJpbmcoZmV0Y2hlZFRpbGUudGlsZUtleSk7XHJcbiAgICB2YXIgd2FpdGluZ1Rhc2sgPSB0aGlzLl93YWl0aW5nRmV0Y2hlc1tzdHJLZXldO1xyXG4gICAgaWYgKHdhaXRpbmdUYXNrKSB7XHJcbiAgICAgICAgd2FpdGluZ1Rhc2suZGF0YVJlYWR5KGZldGNoZWRUaWxlLnRpbGVDb250ZW50LCBGRVRDSF9XQUlUX1RBU0spO1xyXG4gICAgfVxyXG59O1xyXG5cclxuR3JpZEltYWdlQmFzZS5wcm90b3R5cGUuX29uVGlsZVRlcm1pbmF0ZWQgPSBmdW5jdGlvbih0aWxlS2V5KSB7XHJcbiAgICB2YXIgc3RyS2V5ID0gdGhpcy5nZXRLZXlBc1N0cmluZyh0aWxlS2V5KTtcclxuICAgIHZhciB3YWl0aW5nVGFzayA9IHRoaXMuX3dhaXRpbmdGZXRjaGVzW3N0cktleV07XHJcbiAgICBpZiAod2FpdGluZ1Rhc2spIHtcclxuICAgICAgICB3YWl0aW5nVGFzay50ZXJtaW5hdGUoKTtcclxuICAgICAgICB0aGlzLl93YWl0aW5nRmV0Y2hlc1tzdHJLZXldID0gbnVsbDtcclxuICAgIH1cclxufTtcclxuXHJcbkdyaWRJbWFnZUJhc2UuZ2V0VGlsZXNSYW5nZSA9IGZ1bmN0aW9uKGltYWdlUGFyYW1zLCBpbWFnZVBhcnRQYXJhbXMpIHtcclxuICAgIHZhciBsZXZlbFdpZHRoICA9IGltYWdlUGFyYW1zLmltYWdlV2lkdGggICogTWF0aC5wb3coMiwgaW1hZ2VQYXJ0UGFyYW1zLmxldmVsIC0gaW1hZ2VQYXJhbXMuaW1hZ2VMZXZlbCk7XHJcbiAgICB2YXIgbGV2ZWxIZWlnaHQgPSBpbWFnZVBhcmFtcy5pbWFnZUhlaWdodCAqIE1hdGgucG93KDIsIGltYWdlUGFydFBhcmFtcy5sZXZlbCAtIGltYWdlUGFyYW1zLmltYWdlTGV2ZWwpO1xyXG4gICAgdmFyIGxldmVsVGlsZXNYID0gTWF0aC5jZWlsKGxldmVsV2lkdGggIC8gaW1hZ2VQYXJhbXMudGlsZVdpZHRoICk7XHJcbiAgICB2YXIgbGV2ZWxUaWxlc1kgPSBNYXRoLmNlaWwobGV2ZWxIZWlnaHQgLyBpbWFnZVBhcmFtcy50aWxlSGVpZ2h0KTtcclxuICAgIHJldHVybiB7XHJcbiAgICAgICAgbWluVGlsZVg6IE1hdGgubWF4KDAsIE1hdGguZmxvb3IoaW1hZ2VQYXJ0UGFyYW1zLm1pblggLyBpbWFnZVBhcmFtcy50aWxlV2lkdGggKSksXHJcbiAgICAgICAgbWluVGlsZVk6IE1hdGgubWF4KDAsIE1hdGguZmxvb3IoaW1hZ2VQYXJ0UGFyYW1zLm1pblkgLyBpbWFnZVBhcmFtcy50aWxlSGVpZ2h0KSksXHJcbiAgICAgICAgbWF4VGlsZVg6IE1hdGgubWluKGxldmVsVGlsZXNYLCBNYXRoLmNlaWwoaW1hZ2VQYXJ0UGFyYW1zLm1heFhFeGNsdXNpdmUgLyBpbWFnZVBhcmFtcy50aWxlV2lkdGggKSksXHJcbiAgICAgICAgbWF4VGlsZVk6IE1hdGgubWluKGxldmVsVGlsZXNZLCBNYXRoLmNlaWwoaW1hZ2VQYXJ0UGFyYW1zLm1heFlFeGNsdXNpdmUgLyBpbWFnZVBhcmFtcy50aWxlSGVpZ2h0KSlcclxuICAgIH07XHJcbn07XHJcbiIsIid1c2Ugc3RyaWN0JztcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gR3JpZExldmVsQ2FsY3VsYXRvcjtcclxuXHJcbmZ1bmN0aW9uIEdyaWRMZXZlbENhbGN1bGF0b3IoaW1hZ2VQYXJhbXMpIHtcclxuICAgIHRoaXMuX2ltYWdlUGFyYW1zID0gaW1hZ2VQYXJhbXM7XHJcbn1cclxuXHJcbkdyaWRMZXZlbENhbGN1bGF0b3IucHJvdG90eXBlLmdldExldmVsV2lkdGggPSBmdW5jdGlvbiBnZXRMZXZlbFdpZHRoKGxldmVsKSB7XHJcbiAgICB2YXIgd2lkdGggPSB0aGlzLl9pbWFnZVBhcmFtcy5pbWFnZVdpZHRoICogTWF0aC5wb3coMiwgbGV2ZWwgLSB0aGlzLl9pbWFnZVBhcmFtcy5pbWFnZUxldmVsKTtcclxuICAgIHJldHVybiB3aWR0aDtcclxufTtcclxuXHJcbkdyaWRMZXZlbENhbGN1bGF0b3IucHJvdG90eXBlLmdldExldmVsSGVpZ2h0ID0gZnVuY3Rpb24gZ2V0TGV2ZWxIZWlnaHQobGV2ZWwpIHtcclxuICAgIHZhciBoZWlnaHQgPSAgdGhpcy5faW1hZ2VQYXJhbXMuaW1hZ2VIZWlnaHQgKiBNYXRoLnBvdygyLCBsZXZlbCAtIHRoaXMuX2ltYWdlUGFyYW1zLmltYWdlTGV2ZWwpO1xyXG4gICAgcmV0dXJuIGhlaWdodDtcclxufTtcclxuXHJcbkdyaWRMZXZlbENhbGN1bGF0b3IucHJvdG90eXBlLmdldExldmVsID0gZnVuY3Rpb24gZ2V0TGV2ZWwocmVnaW9uSW1hZ2VMZXZlbCkge1xyXG4gICAgdmFyIGxvZzIgPSBNYXRoLmxvZygyKTtcclxuICAgIHZhciBsZXZlbFggPSBNYXRoLmxvZyhyZWdpb25JbWFnZUxldmVsLnNjcmVlbldpZHRoICAvIChyZWdpb25JbWFnZUxldmVsLm1heFhFeGNsdXNpdmUgLSByZWdpb25JbWFnZUxldmVsLm1pblgpKSAvIGxvZzI7XHJcbiAgICB2YXIgbGV2ZWxZID0gTWF0aC5sb2cocmVnaW9uSW1hZ2VMZXZlbC5zY3JlZW5IZWlnaHQgLyAocmVnaW9uSW1hZ2VMZXZlbC5tYXhZRXhjbHVzaXZlIC0gcmVnaW9uSW1hZ2VMZXZlbC5taW5ZKSkgLyBsb2cyO1xyXG4gICAgdmFyIGxldmVsID0gTWF0aC5jZWlsKE1hdGgubWluKGxldmVsWCwgbGV2ZWxZKSk7XHJcbiAgICBsZXZlbCArPSB0aGlzLl9pbWFnZVBhcmFtcy5pbWFnZUxldmVsO1xyXG4gICAgXHJcbiAgICByZXR1cm4gbGV2ZWw7XHJcbn07XHJcbiIsIid1c2Ugc3RyaWN0JztcclxuXHJcbnZhciBTaW1wbGVNb3ZhYmxlRmV0Y2ggPSByZXF1aXJlKCdzaW1wbGUtbW92YWJsZS1mZXRjaC5qcycpO1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBTaW1wbGVGZXRjaGVyQmFzZTtcclxuXHJcbi8qIGdsb2JhbCBQcm9taXNlOiBmYWxzZSAqL1xyXG5cclxuZnVuY3Rpb24gU2ltcGxlRmV0Y2hlckJhc2Uob3B0aW9ucykge1xyXG4gICAgdGhpcy5fbWF4QWN0aXZlRmV0Y2hlc0luTW92YWJsZUZldGNoID0gKG9wdGlvbnMgfHwge30pLm1heEFjdGl2ZUZldGNoZXNJbk1vdmFibGVGZXRjaCB8fCAyO1xyXG4gICAgdGhpcy5faW5kaXJlY3RDbG9zZUluZGljYXRpb24gPSB7IGlzQ2xvc2VSZXF1ZXN0ZWQ6IGZhbHNlIH07XHJcbn1cclxuXHJcblNpbXBsZUZldGNoZXJCYXNlLnByb3RvdHlwZS5zdGFydE1vdmFibGVGZXRjaCA9IGZ1bmN0aW9uIHN0YXJ0TW92YWJsZUZldGNoKGZldGNoQ29udGV4dCwgaW1hZ2VQYXJ0UGFyYW1zKSB7XHJcbiAgICB2YXIgbW92YWJsZUZldGNoID0gbmV3IFNpbXBsZU1vdmFibGVGZXRjaChcclxuICAgICAgICB0aGlzLCB0aGlzLl9pbmRpcmVjdENsb3NlSW5kaWNhdGlvbiwgZmV0Y2hDb250ZXh0LCB0aGlzLl9tYXhBY3RpdmVGZXRjaGVzSW5Nb3ZhYmxlRmV0Y2gpO1xyXG4gICAgXHJcbiAgICBtb3ZhYmxlRmV0Y2guc3RhcnQoaW1hZ2VQYXJ0UGFyYW1zKTtcclxufTtcclxuXHJcblNpbXBsZUZldGNoZXJCYXNlLnByb3RvdHlwZS5jbG9zZSA9IGZ1bmN0aW9uIGNsb3NlKCkge1xyXG4gICAgaWYgKHRoaXMuc3RhcnRNb3ZhYmxlRmV0Y2ggIT09IFNpbXBsZUZldGNoZXJCYXNlLnByb3RvdHlwZS5zdGFydE1vdmFibGVGZXRjaCkge1xyXG4gICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IE11c3Qgb3ZlcnJpZGUgRmV0Y2hlci5jbG9zZSgpIHdoZW4gRmV0Y2hlci5zdGFydE1vdmFibGVGZXRjaCgpIHdhcyBvdmVycmlkZW4nO1xyXG4gICAgfVxyXG4gICAgdGhpcy5faW5kaXJlY3RDbG9zZUluZGljYXRpb24uaXNDbG9zZVJlcXVlc3RlZCA9IHRydWU7XHJcbiAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XHJcbn07IiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxudmFyIEZldGNoQ29udGV4dEFwaSA9IHJlcXVpcmUoJ2ZldGNoLWNvbnRleHQtYXBpLmpzJyk7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IFNpbXBsZU1vdmFibGVGZXRjaDtcclxuXHJcbnZhciBGRVRDSF9TVEFURV9XQUlUX0ZPUl9NT1ZFID0gMTtcclxudmFyIEZFVENIX1NUQVRFX0FDVElWRSA9IDI7XHJcbnZhciBGRVRDSF9TVEFURV9TVE9QUElORyA9IDM7XHJcbnZhciBGRVRDSF9TVEFURV9TVE9QUEVEID0gNDtcclxudmFyIEZFVENIX1NUQVRFX1RFUk1JTkFURUQgPSA1O1xyXG5cclxuZnVuY3Rpb24gU2ltcGxlTW92YWJsZUZldGNoKGZldGNoZXIsIGluZGlyZWN0Q2xvc2VJbmRpY2F0aW9uLCBmZXRjaENvbnRleHQsIG1heEFjdGl2ZUZldGNoZXNJbk1vdmFibGVGZXRjaCkge1xyXG4gICAgdGhpcy5fZmV0Y2hlciA9IGZldGNoZXI7XHJcbiAgICB0aGlzLl9pbmRpcmVjdENsb3NlSW5kaWNhdGlvbiA9IGluZGlyZWN0Q2xvc2VJbmRpY2F0aW9uO1xyXG4gICAgdGhpcy5fbW92YWJsZUZldGNoQ29udGV4dCA9IGZldGNoQ29udGV4dDtcclxuICAgIHRoaXMuX21heEFjdGl2ZUZldGNoZXNJbk1vdmFibGVGZXRjaCA9IG1heEFjdGl2ZUZldGNoZXNJbk1vdmFibGVGZXRjaDtcclxuICAgIFxyXG4gICAgdGhpcy5fbGFzdEZldGNoID0gbnVsbDtcclxuICAgIHRoaXMuX2FjdGl2ZUZldGNoZXNJbk1vdmFibGVGZXRjaCA9IDA7XHJcbiAgICB0aGlzLl9wZW5kaW5nSW1hZ2VQYXJ0UGFyYW1zID0gbnVsbDtcclxuICAgIHRoaXMuX21vdmFibGVTdGF0ZSA9IEZFVENIX1NUQVRFX1dBSVRfRk9SX01PVkU7XHJcbiAgICBcclxuICAgIHRoaXMuX2lzUHJvZ3Jlc3NpdmUgPSBmYWxzZTtcclxuICAgIHRoaXMuX2lzUHJvZ3Jlc3NpdmVDaGFuZ2VkQ2FsbGVkID0gZmFsc2U7XHJcbiAgICBcclxuICAgIGZldGNoQ29udGV4dC5vbignbW92ZScsIHRoaXMuX29uTW92ZSwgdGhpcyk7XHJcbiAgICBmZXRjaENvbnRleHQub24oJ3Rlcm1pbmF0ZScsIHRoaXMuX29uVGVybWluYXRlZCwgdGhpcyk7XHJcbiAgICBmZXRjaENvbnRleHQub24oJ2lzUHJvZ3Jlc3NpdmVDaGFuZ2VkJywgdGhpcy5fb25Jc1Byb2dyZXNzaXZlQ2hhbmdlZCwgdGhpcyk7XHJcbiAgICBmZXRjaENvbnRleHQub24oJ3N0b3AnLCB0aGlzLl9vblN0b3AsIHRoaXMpO1xyXG4gICAgZmV0Y2hDb250ZXh0Lm9uKCdyZXN1bWUnLCB0aGlzLl9vblJlc3VtZSwgdGhpcyk7XHJcbn1cclxuXHJcblNpbXBsZU1vdmFibGVGZXRjaC5wcm90b3R5cGUuc3RhcnQgPSBmdW5jdGlvbiBzdGFydChpbWFnZVBhcnRQYXJhbXMpIHtcclxuICAgIHRoaXMuX29uTW92ZShpbWFnZVBhcnRQYXJhbXMpO1xyXG59O1xyXG5cclxuU2ltcGxlTW92YWJsZUZldGNoLnByb3RvdHlwZS5fb25Jc1Byb2dyZXNzaXZlQ2hhbmdlZCA9IGZ1bmN0aW9uIGlzUHJvZ3Jlc3NpdmVDaGFuZ2VkKGlzUHJvZ3Jlc3NpdmUpIHtcclxuICAgIHRoaXMuX2lzUHJvZ3Jlc3NpdmUgPSBpc1Byb2dyZXNzaXZlO1xyXG4gICAgdmFyIGxhc3RBY3RpdmVGZXRjaCA9IHRoaXMuX2dldExhc3RGZXRjaEFjdGl2ZSgpO1xyXG4gICAgaWYgKGxhc3RBY3RpdmVGZXRjaCAhPT0gbnVsbCkge1xyXG4gICAgICAgIGxhc3RBY3RpdmVGZXRjaC5fb25FdmVudCgnaXNQcm9ncmVzc2l2ZUNoYW5nZWQnLCBpc1Byb2dyZXNzaXZlKTtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgICAgdGhpcy5faXNQcm9ncmVzc2l2ZUNoYW5nZWRDYWxsZWQgPSB0cnVlO1xyXG4gICAgfVxyXG59O1xyXG5cclxuU2ltcGxlTW92YWJsZUZldGNoLnByb3RvdHlwZS5fb25TdG9wID0gZnVuY3Rpb24gc3RvcChpc0Fib3J0ZWQpIHtcclxuICAgIHRoaXMuX3N3aXRjaFN0YXRlKEZFVENIX1NUQVRFX1NUT1BQSU5HLCBGRVRDSF9TVEFURV9BQ1RJVkUpO1xyXG4gICAgdmFyIGxhc3RBY3RpdmVGZXRjaCA9IHRoaXMuX2dldExhc3RGZXRjaEFjdGl2ZSgpO1xyXG4gICAgaWYgKGxhc3RBY3RpdmVGZXRjaCAhPT0gbnVsbCkge1xyXG4gICAgICAgIGxhc3RBY3RpdmVGZXRjaC5fb25FdmVudCgnc3RvcCcsIGlzQWJvcnRlZCk7XHJcbiAgICB9XHJcbn07XHJcblxyXG5TaW1wbGVNb3ZhYmxlRmV0Y2gucHJvdG90eXBlLl9vblJlc3VtZSA9IGZ1bmN0aW9uIHJlc3VtZSgpIHtcclxuICAgIHRoaXMuX3N3aXRjaFN0YXRlKEZFVENIX1NUQVRFX0FDVElWRSwgRkVUQ0hfU1RBVEVfU1RPUFBFRCwgRkVUQ0hfU1RBVEVfU1RPUFBJTkcpO1xyXG5cclxuICAgIGlmICh0aGlzLl9sYXN0RmV0Y2ggPT09IG51bGwpIHtcclxuICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiByZXN1bWluZyBub24gc3RvcHBlZCBmZXRjaCc7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGlmICh0aGlzLl9pc1Byb2dyZXNzaXZlQ2hhbmdlZENhbGxlZCkge1xyXG4gICAgICAgIHRoaXMuX2lzUHJvZ3Jlc3NpdmVDaGFuZ2VkQ2FsbGVkID0gZmFsc2U7XHJcbiAgICAgICAgdGhpcy5fbGFzdEZldGNoLl9vbkV2ZW50KCdpc1Byb2dyZXNzaXZlQ2hhbmdlZCcsIHRoaXMuX2lzUHJvZ3Jlc3NpdmUpO1xyXG4gICAgfVxyXG4gICAgdGhpcy5fbGFzdEZldGNoLl9vbkV2ZW50KCdyZXN1bWUnKTtcclxufTtcclxuXHJcblNpbXBsZU1vdmFibGVGZXRjaC5wcm90b3R5cGUuX29uVGVybWluYXRlZCA9IGZ1bmN0aW9uIG9uVGVybWluYXRlZChpc0Fib3J0ZWQpIHtcclxuICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IFVuZXhwZWN0ZWQgdGVybWluYXRpb24gb2YgbW92YWJsZSBmZXRjaCc7XHJcbn07XHJcblxyXG5TaW1wbGVNb3ZhYmxlRmV0Y2gucHJvdG90eXBlLl9vbk1vdmUgPSBmdW5jdGlvbiBtb3ZlKGltYWdlUGFydFBhcmFtcykge1xyXG4gICAgdGhpcy5fcGVuZGluZ0ltYWdlUGFydFBhcmFtcyA9IGltYWdlUGFydFBhcmFtcztcclxuICAgIHRoaXMuX21vdmFibGVTdGF0ZSA9IEZFVENIX1NUQVRFX0FDVElWRTtcclxuICAgIHRoaXMuX3RyeVN0YXJ0UGVuZGluZ0ZldGNoKCk7XHJcbn07XHJcblxyXG5TaW1wbGVNb3ZhYmxlRmV0Y2gucHJvdG90eXBlLl90cnlTdGFydFBlbmRpbmdGZXRjaCA9IGZ1bmN0aW9uIHRyeVN0YXJ0UGVuZGluZ0ZldGNoKCkge1xyXG4gICAgaWYgKHRoaXMuX2luZGlyZWN0Q2xvc2VJbmRpY2F0aW9uLmlzQ2xvc2VSZXF1ZXN0ZWQgfHxcclxuICAgICAgICB0aGlzLl9hY3RpdmVGZXRjaGVzSW5Nb3ZhYmxlRmV0Y2ggPj0gdGhpcy5fbWF4QWN0aXZlRmV0Y2hlc0luTW92YWJsZUZldGNoIHx8XHJcbiAgICAgICAgdGhpcy5fcGVuZGluZ0ltYWdlUGFydFBhcmFtcyA9PT0gbnVsbCB8fFxyXG4gICAgICAgIHRoaXMuX21vdmFibGVTdGF0ZSAhPT0gRkVUQ0hfU1RBVEVfQUNUSVZFKSB7XHJcblxyXG4gICAgICAgICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHZhciBuZXdGZXRjaCA9IHtcclxuICAgICAgICBpbWFnZVBhcnRQYXJhbXM6IHRoaXMuX3BlbmRpbmdJbWFnZVBhcnRQYXJhbXMsXHJcbiAgICAgICAgc3RhdGU6IEZFVENIX1NUQVRFX0FDVElWRSxcclxuXHJcbiAgICAgICAgZmV0Y2hDb250ZXh0OiBudWxsLFxyXG4gICAgICAgIHNlbGY6IHRoaXNcclxuICAgIH07XHJcbiAgICBcclxuICAgIHRoaXMuX3BlbmRpbmdJbWFnZVBhcnRQYXJhbXMgPSBudWxsO1xyXG4gICAgKyt0aGlzLl9hY3RpdmVGZXRjaGVzSW5Nb3ZhYmxlRmV0Y2g7XHJcbiAgICBcclxuICAgIG5ld0ZldGNoLmZldGNoQ29udGV4dCA9IG5ldyBGZXRjaENvbnRleHRBcGkoKTtcclxuICAgIG5ld0ZldGNoLmZldGNoQ29udGV4dC5vbignaW50ZXJuYWxTdG9wcGVkJywgb25TaW5nbGVGZXRjaFN0b3BwZWQsIG5ld0ZldGNoKTtcclxuICAgIG5ld0ZldGNoLmZldGNoQ29udGV4dC5vbignaW50ZXJuYWxEb25lJywgb25TaW5nbGVGZXRjaERvbmUsIG5ld0ZldGNoKTtcclxuICAgIFxyXG4gICAgdGhpcy5fZmV0Y2hlci5zdGFydEZldGNoKG5ld0ZldGNoLmZldGNoQ29udGV4dCwgbmV3RmV0Y2guaW1hZ2VQYXJ0UGFyYW1zKTtcclxufTtcclxuXHJcblNpbXBsZU1vdmFibGVGZXRjaC5wcm90b3R5cGUuX3NpbmdsZUZldGNoU3RvcHBlZCA9IGZ1bmN0aW9uIHNpbmdsZUZldGNoU3RvcHBlZChmZXRjaCwgaXNEb25lKSB7XHJcbiAgICAtLXRoaXMuX2FjdGl2ZUZldGNoZXNJbk1vdmFibGVGZXRjaDtcclxuICAgIHRoaXMuX2xhc3RGZXRjaCA9IG51bGw7XHJcbiAgICBmZXRjaC5zdGF0ZSA9IEZFVENIX1NUQVRFX1RFUk1JTkFURUQ7XHJcblxyXG4gICAgdGhpcy5fdHJ5U3RhcnRQZW5kaW5nRmV0Y2goKTtcclxufTtcclxuXHJcblNpbXBsZU1vdmFibGVGZXRjaC5wcm90b3R5cGUuX2dldExhc3RGZXRjaEFjdGl2ZSA9IGZ1bmN0aW9uIGdldExhc3RGZXRjaEFjdGl2ZSgpIHtcclxuICAgIGlmICh0aGlzLl9tb3ZhYmxlU3RhdGUgPT09IEZFVENIX1NUQVRFX1NUT1BQRUQgfHwgdGhpcy5fbGFzdEZldGNoID09PSBudWxsKSB7XHJcbiAgICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGlmICh0aGlzLl9sYXN0RmV0Y2guc3RhdGUgPT09IEZFVENIX1NUQVRFX0FDVElWRSkge1xyXG4gICAgICAgIHJldHVybiB0aGlzLl9sYXN0RmV0Y2guZmV0Y2hDb250ZXh0O1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIG51bGw7XHJcbn07XHJcblxyXG5TaW1wbGVNb3ZhYmxlRmV0Y2gucHJvdG90eXBlLl9zd2l0Y2hTdGF0ZSA9IGZ1bmN0aW9uIHN3aXRjaFN0YXRlKHRhcmdldFN0YXRlLCBleHBlY3RlZFN0YXRlLCBleHBlY3RlZFN0YXRlMiwgZXhwZWN0ZWRTdGF0ZTMpIHtcclxuICAgIGlmICh0aGlzLl9tb3ZhYmxlU3RhdGUgIT09IGV4cGVjdGVkU3RhdGUgJiYgdGhpcy5fbW92YWJsZVN0YXRlICE9PSBleHBlY3RlZFN0YXRlMiAmJiB0aGlzLl9tb3ZhYmxlU3RhdGUgIT09IGV4cGVjdGVkU3RhdGUzKSB7XHJcbiAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogVW5leHBlY3RlZCBzdGF0ZSAnICsgdGhpcy5fbW92YWJsZVN0YXRlICsgJywgZXhwZWN0ZWQgJyArIGV4cGVjdGVkU3RhdGUgKyAnIG9yICcgKyBleHBlY3RlZFN0YXRlMiArICcgb3IgJyArIGV4cGVjdGVkU3RhdGUzO1xyXG4gICAgfVxyXG4gICAgdGhpcy5fbW92YWJsZVN0YXRlID0gdGFyZ2V0U3RhdGU7XHJcbn07XHJcblxyXG5TaW1wbGVNb3ZhYmxlRmV0Y2gucHJvdG90eXBlLl9pc0xhc3RGZXRjaCA9IGZ1bmN0aW9uIGlzTGFzdEZldGNoKGZldGNoKSB7XHJcbiAgICByZXR1cm4gdGhpcy5fbGFzdEZldGNoID09PSBmZXRjaCAmJiB0aGlzLl9wZW5kaW5nSW1hZ2VQYXJ0UGFyYW1zID09PSBudWxsO1xyXG59O1xyXG5cclxuZnVuY3Rpb24gb25TaW5nbGVGZXRjaFN0b3BwZWQoKSB7XHJcbiAgICAvKiBqc2hpbnQgdmFsaWR0aGlzOiB0cnVlICovXHJcbiAgICB2YXIgZmV0Y2ggPSB0aGlzO1xyXG4gICAgdmFyIG1vdmFibGVGZXRjaCA9IGZldGNoLnNlbGY7XHJcbiAgICBcclxuICAgIGlmIChmZXRjaC5zdGF0ZSAhPT0gRkVUQ0hfU1RBVEVfU1RPUFBJTkcpIHtcclxuICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBVbmV4cGVjdGVkIHN0YXRlIG9mIGZldGNoICcgKyBmZXRjaC5zdGF0ZSArICcgb24gc3RvcHBlZCc7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGlmIChtb3ZhYmxlRmV0Y2guX2lzTGFzdEZldGNoKGZldGNoKSkge1xyXG4gICAgICAgIGZldGNoLnN0YXRlID0gRkVUQ0hfU1RBVEVfU1RPUFBFRDtcclxuICAgICAgICBtb3ZhYmxlRmV0Y2guX3N3aXRjaFN0YXRlKEZFVENIX1NUQVRFX1NUT1BQRUQsIEZFVENIX1NUQVRFX1NUT1BQSU5HKTtcclxuICAgICAgICBtb3ZhYmxlRmV0Y2guX21vdmFibGVGZXRjaENvbnRleHQuc3RvcHBlZCgpO1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgICBtb3ZhYmxlRmV0Y2guX3NpbmdsZUZldGNoU3RvcHBlZChmZXRjaCk7XHJcbiAgICB9XHJcbn1cclxuXHJcbmZ1bmN0aW9uIG9uU2luZ2xlRmV0Y2hEb25lKCkge1xyXG4gICAgLyoganNoaW50IHZhbGlkdGhpczogdHJ1ZSAqL1xyXG4gICAgdmFyIGZldGNoID0gdGhpcztcclxuICAgIHZhciBtb3ZhYmxlRmV0Y2ggPSBmZXRjaC5zZWxmO1xyXG5cclxuICAgIGlmIChmZXRjaC5zdGF0ZSAhPT0gRkVUQ0hfU1RBVEVfQUNUSVZFICYmIGZldGNoLnN0YXRlICE9PSBGRVRDSF9TVEFURV9TVE9QUElORykge1xyXG4gICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IFVuZXhwZWN0ZWQgc3RhdGUgb2YgZmV0Y2ggJyArIGZldGNoLnN0YXRlICsgJyBvbiBkb25lJztcclxuICAgIH1cclxuXHJcbiAgICBmZXRjaC5zdGF0ZSA9IEZFVENIX1NUQVRFX1RFUk1JTkFURUQ7XHJcbiAgICBpZiAobW92YWJsZUZldGNoLl9pc0xhc3RGZXRjaChmZXRjaCkpIHtcclxuICAgICAgICBtb3ZhYmxlRmV0Y2guX3N3aXRjaFN0YXRlKEZFVENIX1NUQVRFX1dBSVRfRk9SX01PVkUsIEZFVENIX1NUQVRFX0FDVElWRSwgRkVUQ0hfU1RBVEVfU1RPUFBJTkcpO1xyXG4gICAgICAgIG1vdmFibGVGZXRjaC5fbW92YWJsZUZldGNoQ29udGV4dC5kb25lKCk7XHJcbiAgICB9XHJcbiAgICBtb3ZhYmxlRmV0Y2guX3NpbmdsZUZldGNoU3RvcHBlZChmZXRjaCk7XHJcbn0iXX0=
