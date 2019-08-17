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
        this._performPendingDelayedActionsBound = this._performPendingDelayedActions.bind(this);
        
        var that = this;
        this._scheduleNotifier = {
            'calculatePriority': this.calculatePriority.bind(this),
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
            'abort': this.abort.bind(this)
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
        if (!this._pendingDelayedAction) {
            setTimeout(this._performPendingDelayedActionsBound);
        }
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
        
        if (!this._pendingDelayedAction) {
            this._pendingDelayedAction = true;
            setTimeout(this._performPendingDelayedActionsBound);
        }
    };
    
    DependencyWorkersTaskInternals.prototype.workerDone = function() {
        if (this._jobCallbacks === null) {
            throw 'dependencyWorkers: Job done without previously started';
        }
        
        var jobCallbacks = this._jobCallbacks;
        this._jobCallbacks = null;
        
        if (this.pendingDataForWorker.length === 0) {
            this._pendingWorkerDone = true;
            if (!this._pendingDelayedAction) {
                this._pendingDelayedAction = true;
                setTimeout(this._performPendingDelayedActionsBound);
            }
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
        if (processedData.length > 0 && !this._pendingDelayedAction) {
            this._pendingDelayedAction = true;
            setTimeout(this._performPendingDelayedActionsBound);
        }
        
        return addResult.value.taskContext;
        
        function onDependencyTaskData(data) {
            if (that._pendingDelayedDependencyData.length > 0) {
                // Avoid bypass of delayed data by new data
                that._pendingDelayedDependencyData.push({
                    data: data,
                    onDependencyTaskData: onDependencyTaskData
                });
                
                if (!that._pendingDelayedAction) {
                    that._pendingDelayedAction = true;
                    setTimeout(that._performPendingDelayedActionsBound);
                }
                
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
            this._priorityCalculator = this.calculatePriority.bind(this);
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
    
    DependencyWorkersTaskInternals.prototype._performPendingDelayedActions = function() {
        var iterator;
        var context;
        this._pendingDelayedAction = false;
        
        if (this._pendingDelayedDependencyData.length > 0) {
            var localListeners = this._pendingDelayedDependencyData;
            this._pendingDelayedDependencyData = [];
            
            for (var i = 0; i < localListeners.length; ++i) {
                localListeners[i].onDependencyTaskData(localListeners[i].data);
            }
        }
        
        if (this._pendingDelayedNewData.length > 0) {
            var that = this;
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
            var that = this;
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJzcmMvZGVwZW5kZW5jeS13b3JrZXJzLWV4cG9ydHMuanMiLCJzcmMvZGVwZW5kZW5jeS13b3JrZXJzLXRhc2stY29udGV4dC5qcyIsInNyYy9kZXBlbmRlbmN5LXdvcmtlcnMtdGFzay1pbnRlcm5hbHMuanMiLCJzcmMvZGVwZW5kZW5jeS13b3JrZXJzLXRhc2stc2NoZWR1bGVyLmpzIiwic3JjL2RlcGVuZGVuY3ktd29ya2Vycy10YXNrLmpzIiwic3JjL2RlcGVuZGVuY3ktd29ya2Vycy5qcyIsInNyYy9oYXNoLW1hcC5qcyIsInNyYy9qcy1idWlsdGluLWhhc2gtbWFwLmpzIiwic3JjL2xpbmtlZC1saXN0LmpzIiwic3JjL3NjaGVkdWxlci1kZXBlbmRlbmN5LXdvcmtlcnMuanMiLCJzcmMvd3JhcHBlci1pbnB1dC1yZXRyZWl2ZXItYmFzZS5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTtBQ0FBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDUEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzlEQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3JnQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbEJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ25HQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNsS0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNwSkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM1QkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNwR0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDakZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSIsImZpbGUiOiJnZW5lcmF0ZWQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlc0NvbnRlbnQiOlsiKGZ1bmN0aW9uIGUodCxuLHIpe2Z1bmN0aW9uIHMobyx1KXtpZighbltvXSl7aWYoIXRbb10pe3ZhciBhPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7aWYoIXUmJmEpcmV0dXJuIGEobywhMCk7aWYoaSlyZXR1cm4gaShvLCEwKTt2YXIgZj1uZXcgRXJyb3IoXCJDYW5ub3QgZmluZCBtb2R1bGUgJ1wiK28rXCInXCIpO3Rocm93IGYuY29kZT1cIk1PRFVMRV9OT1RfRk9VTkRcIixmfXZhciBsPW5bb109e2V4cG9ydHM6e319O3Rbb11bMF0uY2FsbChsLmV4cG9ydHMsZnVuY3Rpb24oZSl7dmFyIG49dFtvXVsxXVtlXTtyZXR1cm4gcyhuP246ZSl9LGwsbC5leHBvcnRzLGUsdCxuLHIpfXJldHVybiBuW29dLmV4cG9ydHN9dmFyIGk9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtmb3IodmFyIG89MDtvPHIubGVuZ3RoO28rKylzKHJbb10pO3JldHVybiBzfSkiLCIndXNlIHN0cmljdCc7XHJcblxyXG5tb2R1bGUuZXhwb3J0cy5EZXBlbmRlbmN5V29ya2VycyA9IHJlcXVpcmUoJ2RlcGVuZGVuY3ktd29ya2VycycpO1xyXG5tb2R1bGUuZXhwb3J0cy5EZXBlbmRlbmN5V29ya2Vyc1Rhc2tDb250ZXh0ID0gcmVxdWlyZSgnZGVwZW5kZW5jeS13b3JrZXJzLXRhc2stY29udGV4dCcpO1xyXG5tb2R1bGUuZXhwb3J0cy5EZXBlbmRlbmN5V29ya2Vyc1Rhc2sgPSByZXF1aXJlKCdkZXBlbmRlbmN5LXdvcmtlcnMtdGFzaycpO1xyXG5tb2R1bGUuZXhwb3J0cy5XcmFwcGVySW5wdXRSZXRyZWl2ZXJCYXNlID0gcmVxdWlyZSgnd3JhcHBlci1pbnB1dC1yZXRyZWl2ZXItYmFzZScpO1xyXG5tb2R1bGUuZXhwb3J0cy5TY2hlZHVsZXJEZXBlbmRlbmN5V29ya2VycyA9IHJlcXVpcmUoJ3NjaGVkdWxlci1kZXBlbmRlbmN5LXdvcmtlcnMnKTtcclxubW9kdWxlLmV4cG9ydHMuRGVwZW5kZW5jeVdvcmtlcnNUYXNrU2NoZWR1bGVyID0gcmVxdWlyZSgnZGVwZW5kZW5jeS13b3JrZXJzLXRhc2stc2NoZWR1bGVyJyk7IiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxudmFyIERlcGVuZGVuY3lXb3JrZXJzVGFza0NvbnRleHQgPSAoZnVuY3Rpb24gRGVwZW5kZW5jeVdvcmtlcnNUYXNrQ29udGV4dENsb3N1cmUoKSB7XHJcbiAgICBmdW5jdGlvbiBEZXBlbmRlbmN5V29ya2Vyc1Rhc2tDb250ZXh0KHRhc2tJbnRlcm5hbHMsIGNhbGxiYWNrcykge1xyXG4gICAgICAgIHRoaXMuX3Rhc2tJbnRlcm5hbHMgPSB0YXNrSW50ZXJuYWxzO1xyXG4gICAgICAgIHRoaXMuX2NhbGxiYWNrcyA9IGNhbGxiYWNrcztcclxuICAgICAgICB0aGlzLl90YXNrQ29udGV4dHNJdGVyYXRvciA9IHRhc2tJbnRlcm5hbHMudGFza0NvbnRleHRzLmFkZCh0aGlzKTtcclxuICAgICAgICB0aGlzLl9wcmlvcml0eUNhbGN1bGF0b3JJdGVyYXRvciA9IG51bGw7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShEZXBlbmRlbmN5V29ya2Vyc1Rhc2tDb250ZXh0LnByb3RvdHlwZSwgJ2lzQWN0aXZlJywgeyBnZXQ6IGZ1bmN0aW9uKCkge1xyXG4gICAgICAgIHJldHVybiB0aGlzLl90YXNrSW50ZXJuYWxzLmlzQWN0dWFsVGVybWluYXRpb25QZW5kaW5nIHx8ICF0aGlzLl90YXNrSW50ZXJuYWxzLmlzVGVybWluYXRlZDtcclxuICAgIH0gfSk7XHJcbiAgICBcclxuICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShEZXBlbmRlbmN5V29ya2Vyc1Rhc2tDb250ZXh0LnByb3RvdHlwZSwgJ2lzVGVybWluYXRlZCcsIHsgZ2V0OiBmdW5jdGlvbigpIHtcclxuICAgICAgICByZXR1cm4gdGhpcy5fdGFza0ludGVybmFscy5pc1Rlcm1pbmF0ZWQ7XHJcbiAgICB9IH0pO1xyXG4gICAgXHJcbiAgICBEZXBlbmRlbmN5V29ya2Vyc1Rhc2tDb250ZXh0LnByb3RvdHlwZS5nZXRQcm9jZXNzZWREYXRhID0gZnVuY3Rpb24gZ2V0UHJvY2Vzc2VkRGF0YSgpIHtcclxuICAgICAgICByZXR1cm4gdGhpcy5fdGFza0ludGVybmFscy5wcm9jZXNzZWREYXRhO1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgRGVwZW5kZW5jeVdvcmtlcnNUYXNrQ29udGV4dC5wcm90b3R5cGUuc2V0UHJpb3JpdHlDYWxjdWxhdG9yID0gZnVuY3Rpb24gc2V0UHJpb3JpdHlDYWxjdWxhdG9yKGNhbGN1bGF0b3IpIHtcclxuICAgICAgICBpZiAodGhpcy5fcHJpb3JpdHlDYWxjdWxhdG9ySXRlcmF0b3IgIT09IG51bGwpIHtcclxuICAgICAgICAgICAgdGhpcy5fdGFza0ludGVybmFscy5wcmlvcml0eUNhbGN1bGF0b3JzLnJlbW92ZSh0aGlzLl9wcmlvcml0eUNhbGN1bGF0b3JJdGVyYXRvcik7XHJcbiAgICAgICAgICAgIHRoaXMuX3ByaW9yaXR5Q2FsY3VsYXRvckl0ZXJhdG9yID0gbnVsbDtcclxuICAgICAgICAgICAgLy8gVGhlIGZvbGxvd2luZyBvcHRpbWl6YXRpb24sIHRvIHJlZ2lzdGVyIG9ubHkgaWYgbWUgaGF2aW5nIGNhbGN1bGF0b3IsIHNlZW1zIHRvIGJlIGJ1Z2d5OyBJdCBtaWdodCBjYXVzZVxyXG4gICAgICAgICAgICAvLyBhIFNjaGVkdWxlclRhc2sgdG8gYWJvcnQgYWx0aG91Z2ggaGF2aW5nIG5vbiBhYm9ydGVkIGRlcGVuZGFudCB0YXNrcy5cclxuICAgICAgICAgICAgLy8gSW5zdGVhZCB3ZSByZWdpc3RlciBmb3IgYWxsIHRoZSBsaWZldGltZSBvZiB0aGUgdGFza0ludGVybmFsc1xyXG4gICAgICAgICAgICAvL2lmICghY2FsY3VsYXRvciAmJiB0aGlzLl90YXNrSW50ZXJuYWxzLnByaW9yaXR5Q2FsY3VsYXRvcnMuZ2V0Q291bnQoKSA9PT0gMCkge1xyXG4gICAgICAgICAgICAvLyAgICB0aGlzLl90YXNrSW50ZXJuYWxzLnVucmVnaXN0ZXJEZXBlbmRQcmlvcml0eUNhbGN1bGF0b3IoKTtcclxuICAgICAgICAgICAgLy99XHJcbiAgICAgICAgLy99IGVsc2UgaWYgKGNhbGN1bGF0b3IgJiYgdGhpcy5fdGFza0ludGVybmFscy5wcmlvcml0eUNhbGN1bGF0b3JzLmdldENvdW50KCkgPT09IDApIHtcclxuICAgICAgICAvLyAgICB0aGlzLl90YXNrSW50ZXJuYWxzLnJlZ2lzdGVyRGVwZW5kUHJpb3JpdHlDYWxjdWxhdG9yKCk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIGlmIChjYWxjdWxhdG9yKSB7XHJcbiAgICAgICAgICAgIHRoaXMuX3ByaW9yaXR5Q2FsY3VsYXRvckl0ZXJhdG9yID0gdGhpcy5fdGFza0ludGVybmFscy5wcmlvcml0eUNhbGN1bGF0b3JzLmFkZChjYWxjdWxhdG9yKTtcclxuICAgICAgICB9XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBEZXBlbmRlbmN5V29ya2Vyc1Rhc2tDb250ZXh0LnByb3RvdHlwZS51bnJlZ2lzdGVyID0gZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgaWYgKCF0aGlzLl90YXNrQ29udGV4dHNJdGVyYXRvcikge1xyXG4gICAgICAgICAgICB0aHJvdyAnZGVwZW5kZW5jeVdvcmtlcnM6IEFscmVhZHkgdW5yZWdpc3RlcmVkJztcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgdGhpcy5zZXRQcmlvcml0eUNhbGN1bGF0b3IobnVsbCk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgdGhpcy5fdGFza0ludGVybmFscy50YXNrQ29udGV4dHMucmVtb3ZlKHRoaXMuX3Rhc2tDb250ZXh0c0l0ZXJhdG9yKTtcclxuICAgICAgICB0aGlzLl90YXNrQ29udGV4dHNJdGVyYXRvciA9IG51bGw7XHJcbiAgICAgICAgaWYgKCF0aGlzLl90YXNrSW50ZXJuYWxzLmlzVGVybWluYXRlZCkge1xyXG4gICAgICAgICAgICBpZiAodGhpcy5fdGFza0ludGVybmFscy50YXNrQ29udGV4dHMuZ2V0Q291bnQoKSA9PT0gMCkge1xyXG4gICAgICAgICAgICAgICAgdGhpcy5fdGFza0ludGVybmFscy5hYm9ydCgvKmFib3J0QnlTY2hlZHVsZXI9Ki9mYWxzZSk7XHJcbiAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICB0aGlzLl90YXNrSW50ZXJuYWxzLnN0YXR1c1VwZGF0ZSgpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgfTtcclxuXHJcbiAgICByZXR1cm4gRGVwZW5kZW5jeVdvcmtlcnNUYXNrQ29udGV4dDtcclxufSkoKTtcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gRGVwZW5kZW5jeVdvcmtlcnNUYXNrQ29udGV4dDsiLCIndXNlIHN0cmljdCc7XHJcblxyXG52YXIgTGlua2VkTGlzdCA9IHJlcXVpcmUoJ2xpbmtlZC1saXN0Jyk7XHJcbnZhciBKc0J1aWx0aW5IYXNoTWFwID0gcmVxdWlyZSgnanMtYnVpbHRpbi1oYXNoLW1hcCcpO1xyXG52YXIgRGVwZW5kZW5jeVdvcmtlcnNUYXNrID0gcmVxdWlyZSgnZGVwZW5kZW5jeS13b3JrZXJzLXRhc2snKTtcclxuXHJcbnZhciBEZXBlbmRlbmN5V29ya2Vyc1Rhc2tJbnRlcm5hbHMgPSAoZnVuY3Rpb24gRGVwZW5kZW5jeVdvcmtlcnNUYXNrSW50ZXJuYWxzQ2xvc3VyZSgpIHtcclxuICAgIGZ1bmN0aW9uIERlcGVuZGVuY3lXb3JrZXJzVGFza0ludGVybmFscygpIHtcclxuICAgICAgICAvLyBUaGlzIGNsYXNzIGlzIG5vdCBleHBvc2VkIG91dHNpZGUgZGVwZW5kZW5jeVdvcmtlcnMgYnV0IGFzIGFuIGludGVybmFsIHN0cnVjdCwgdGh1cyBcclxuICAgICAgICAvLyBtYXkgY29udGFpbiBwdWJsaWMgbWVtYmVyc1xyXG4gICAgICAgIFxyXG4gICAgICAgIHRoaXMuaXNUZXJtaW5hdGVkID0gZmFsc2U7XHJcbiAgICAgICAgdGhpcy5pc0FjdHVhbFRlcm1pbmF0aW9uUGVuZGluZyA9IGZhbHNlO1xyXG4gICAgICAgIHRoaXMucHJvY2Vzc2VkRGF0YSA9IFtdO1xyXG4gICAgICAgIHRoaXMudGFza0FwaSA9IG51bGw7XHJcbiAgICAgICAgXHJcbiAgICAgICAgdGhpcy5wZW5kaW5nRGF0YUZvcldvcmtlciA9IFtdO1xyXG4gICAgICAgIHRoaXMuY2FuU2tpcExhc3RQZW5kaW5nRGF0YUZvcldvcmtlciA9IGZhbHNlO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHRoaXMudGFza0NvbnRleHRzID0gbmV3IExpbmtlZExpc3QoKTtcclxuICAgICAgICB0aGlzLnByaW9yaXR5Q2FsY3VsYXRvcnMgPSBuZXcgTGlua2VkTGlzdCgpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHRoaXMudGFza0tleSA9IG51bGw7XHJcbiAgICAgICAgdGhpcy5fZGVwZW5kc1Rhc2tzVGVybWluYXRlZENvdW50ID0gMDtcclxuICAgICAgICB0aGlzLl9wYXJlbnREZXBlbmRlbmN5V29ya2VycyA9IG51bGw7XHJcbiAgICAgICAgdGhpcy5fd29ya2VySW5wdXRSZXRyZWl2ZXIgPSBudWxsO1xyXG4gICAgICAgIHRoaXMuX3BhcmVudExpc3QgPSBudWxsO1xyXG4gICAgICAgIHRoaXMuX3BhcmVudEl0ZXJhdG9yID0gbnVsbDtcclxuICAgICAgICB0aGlzLl9kZXBlbmRzVGFza0NvbnRleHRzID0gbnVsbDtcclxuICAgICAgICB0aGlzLl9wcmlvcml0eUNhbGN1bGF0b3IgPSBudWxsO1xyXG4gICAgICAgIHRoaXMuX2lzUmVnaXN0ZXJlZERlcGVuZFByaW9yaXR5Q2FsY3VsYXRvciA9IGZhbHNlO1xyXG4gICAgICAgIHRoaXMuX2lzRGV0YWNoZWQgPSBmYWxzZTtcclxuICAgICAgICB0aGlzLl9jYW5Ta2lwTGFzdFByb2Nlc3NlZERhdGEgPSBmYWxzZTtcclxuICAgICAgICB0aGlzLl9qb2JDYWxsYmFja3MgPSBudWxsO1xyXG4gICAgICAgIHRoaXMuX2lzQWJvcnRlZCA9IGZhbHNlO1xyXG4gICAgICAgIHRoaXMuX2lzQWJvcnRlZE5vdEJ5U2NoZWR1bGVyID0gZmFsc2U7XHJcbiAgICAgICAgdGhpcy5faXNVc2VyQ2FsbGVkVGVybWluYXRlID0gZmFsc2U7XHJcbiAgICAgICAgdGhpcy5faXNXYWl0aW5nRm9yV29ya2VyUmVzdWx0ID0gZmFsc2U7XHJcbiAgICAgICAgXHJcbiAgICAgICAgdGhpcy5fZGVwZW5kVGFza0tleXMgPSBbXTtcclxuICAgICAgICB0aGlzLl9kZXBlbmRUYXNrUmVzdWx0cyA9IFtdO1xyXG4gICAgICAgIHRoaXMuX2hhc0RlcGVuZFRhc2tEYXRhID0gW107XHJcbiAgICAgICAgXHJcbiAgICAgICAgdGhpcy5fcGVuZGluZ0RlbGF5ZWRBY3Rpb24gPSBmYWxzZTtcclxuICAgICAgICB0aGlzLl9wZW5kaW5nRGVsYXllZERlcGVuZGVuY3lEYXRhID0gW107XHJcbiAgICAgICAgdGhpcy5fcGVuZGluZ0RlbGF5ZWRFbmRlZCA9IGZhbHNlO1xyXG4gICAgICAgIHRoaXMuX3BlbmRpbmdEZWxheWVkTmV3RGF0YSA9IFtdO1xyXG4gICAgICAgIHRoaXMuX3BlbmRpbmdEZWxheWVkQ2FuU2tpcExhc3ROZXdEYXRhID0gZmFsc2U7XHJcbiAgICAgICAgdGhpcy5fcGVuZGluZ1dvcmtlckRvbmUgPSBmYWxzZTtcclxuICAgICAgICB0aGlzLl9wZXJmb3JtUGVuZGluZ0RlbGF5ZWRBY3Rpb25zQm91bmQgPSB0aGlzLl9wZXJmb3JtUGVuZGluZ0RlbGF5ZWRBY3Rpb25zLmJpbmQodGhpcyk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgdmFyIHRoYXQgPSB0aGlzO1xyXG4gICAgICAgIHRoaXMuX3NjaGVkdWxlTm90aWZpZXIgPSB7XHJcbiAgICAgICAgICAgICdjYWxjdWxhdGVQcmlvcml0eSc6IHRoaXMuY2FsY3VsYXRlUHJpb3JpdHkuYmluZCh0aGlzKSxcclxuICAgICAgICAgICAgJ3NjaGVkdWxlJzogZnVuY3Rpb24oam9iQ2FsbGJhY2tzKSB7XHJcbiAgICAgICAgICAgICAgICBpZiAodGhhdC5fam9iQ2FsbGJhY2tzICE9PSBudWxsKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhyb3cgJ2RlcGVuZGVuY3lXb3JrZXJzOiBzY2hlZHVsZU5vdGlmaWVyLnNjaGVkdWxlIHdhcyBjYWxsZWQgdHdpY2UnO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICBpZiAoKCFqb2JDYWxsYmFja3MpIHx8ICFqb2JDYWxsYmFja3NbJ2pvYkRvbmUnXSkge1xyXG4gICAgICAgICAgICAgICAgICAgIHRocm93ICdkZXBlbmRlbmN5V29ya2VyczogUGFzc2VkIGludmFsaWQgam9iQ2FsbGJhY2tzIGFyZ3VtZW50IHRvIHNjaGVkdWxlTm90aWZpZXIuc2NoZWR1bGUoKS4gRW5zdXJlIGpvYkNhbGxiYWNrcyBoYXMgam9iRG9uZSBtZXRob2QnO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICBpZiAodGhhdC5faXNBYm9ydGVkTm90QnlTY2hlZHVsZXIpIHtcclxuICAgICAgICAgICAgICAgICAgICBqb2JDYWxsYmFja3Muam9iRG9uZSgpO1xyXG4gICAgICAgICAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgaWYgKHRoaXMuaXNUZXJtaW5hdGVkICYmICF0aGlzLmlzQWN0dWFsVGVybWluYXRpb25QZW5kaW5nKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhyb3cgJ2RlcGVuZGVuY3lXb3JrZXJzOiBzY2hlZHVsZWQgYWZ0ZXIgdGVybWluYXRpb24nO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICB2YXIgZGF0YVRvUHJvY2VzcyA9IHRoYXQucGVuZGluZ0RhdGFGb3JXb3JrZXIuc2hpZnQoKTtcclxuICAgICAgICAgICAgICAgIHZhciBjYW5Ta2lwID0gZmFsc2U7XHJcbiAgICAgICAgICAgICAgICBpZiAodGhhdC5wZW5kaW5nRGF0YUZvcldvcmtlci5sZW5ndGggPT09IDApIHtcclxuICAgICAgICAgICAgICAgICAgICBjYW5Ta2lwID0gdGhhdC5jYW5Ta2lwTGFzdFBlbmRpbmdEYXRhRm9yV29ya2VyO1xyXG4gICAgICAgICAgICAgICAgICAgIHRoYXQuY2FuU2tpcExhc3RQZW5kaW5nRGF0YUZvcldvcmtlciA9IGZhbHNlO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICB0aGF0Ll9qb2JDYWxsYmFja3MgPSBqb2JDYWxsYmFja3M7XHJcbiAgICAgICAgICAgICAgICB0aGF0Ll9wYXJlbnREZXBlbmRlbmN5V29ya2Vycy5fZGF0YVJlYWR5KFxyXG4gICAgICAgICAgICAgICAgICAgIHRoYXQsXHJcbiAgICAgICAgICAgICAgICAgICAgZGF0YVRvUHJvY2Vzcy5kYXRhLFxyXG4gICAgICAgICAgICAgICAgICAgIGRhdGFUb1Byb2Nlc3Mud29ya2VyVHlwZSxcclxuICAgICAgICAgICAgICAgICAgICBjYW5Ta2lwKTtcclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgJ2Fib3J0JzogdGhpcy5hYm9ydC5iaW5kKHRoaXMpXHJcbiAgICAgICAgfTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgRGVwZW5kZW5jeVdvcmtlcnNUYXNrSW50ZXJuYWxzLnByb3RvdHlwZS5pbml0aWFsaXplID0gZnVuY3Rpb24oXHJcbiAgICAgICAgICAgIHRhc2tLZXksIGRlcGVuZGVuY3lXb3JrZXJzLCBpbnB1dFJldHJlaXZlciwgbGlzdCwgaXRlcmF0b3IgLyosIGhhc2hlciovKSB7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICB0aGlzLnRhc2tLZXkgPSB0YXNrS2V5O1xyXG4gICAgICAgIHRoaXMuX3BhcmVudERlcGVuZGVuY3lXb3JrZXJzID0gZGVwZW5kZW5jeVdvcmtlcnM7XHJcbiAgICAgICAgdGhpcy5fd29ya2VySW5wdXRSZXRyZWl2ZXIgPSBpbnB1dFJldHJlaXZlcjtcclxuICAgICAgICB0aGlzLl9wYXJlbnRMaXN0ID0gbGlzdDtcclxuICAgICAgICB0aGlzLl9wYXJlbnRJdGVyYXRvciA9IGl0ZXJhdG9yO1xyXG4gICAgICAgIHRoaXMuX2RlcGVuZHNUYXNrQ29udGV4dHMgPSBuZXcgSnNCdWlsdGluSGFzaE1hcCgpO1xyXG4gICAgICAgIHRoaXMudGFza0FwaSA9IG5ldyBEZXBlbmRlbmN5V29ya2Vyc1Rhc2sodGhpcywgdGFza0tleSk7XHJcbiAgICAgICAgdGhpcy5fcmVnaXN0ZXJEZXBlbmRQcmlvcml0eUNhbGN1bGF0b3IoKTtcclxuICAgICAgICBkZXBlbmRlbmN5V29ya2Vycy5pbml0aWFsaXppbmdUYXNrKHRoaXMudGFza0FwaSwgdGhpcy5fc2NoZWR1bGVOb3RpZmllcik7XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBEZXBlbmRlbmN5V29ya2Vyc1Rhc2tJbnRlcm5hbHMucHJvdG90eXBlLmVuZGVkID0gZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgdGhpcy5fcGVuZGluZ0RlbGF5ZWRFbmRlZCA9IHRydWU7XHJcbiAgICAgICAgaWYgKCF0aGlzLl9wZW5kaW5nRGVsYXllZEFjdGlvbikge1xyXG4gICAgICAgICAgICBzZXRUaW1lb3V0KHRoaXMuX3BlcmZvcm1QZW5kaW5nRGVsYXllZEFjdGlvbnNCb3VuZCk7XHJcbiAgICAgICAgfVxyXG4gICAgfTtcclxuICAgIFxyXG4gICAgRGVwZW5kZW5jeVdvcmtlcnNUYXNrSW50ZXJuYWxzLnByb3RvdHlwZS5zdGF0dXNVcGRhdGUgPSBmdW5jdGlvbigpIHtcclxuICAgICAgICB2YXIgc3RhdHVzID0ge1xyXG4gICAgICAgICAgICAnaGFzTGlzdGVuZXJzJzogdGhpcy50YXNrQ29udGV4dHMuZ2V0Q291bnQoKSA+IDAsXHJcbiAgICAgICAgICAgICdpc1dhaXRpbmdGb3JXb3JrZXJSZXN1bHQnOiB0aGlzLl9pc1dhaXRpbmdGb3JXb3JrZXJSZXN1bHQsXHJcbiAgICAgICAgICAgICd0ZXJtaW5hdGVkRGVwZW5kc1Rhc2tzJzogdGhpcy5fZGVwZW5kc1Rhc2tzVGVybWluYXRlZENvdW50LFxyXG4gICAgICAgICAgICAnZGVwZW5kc1Rhc2tzJzogdGhpcy5fZGVwZW5kc1Rhc2tDb250ZXh0cy5nZXRDb3VudCgpXHJcbiAgICAgICAgfTtcclxuICAgICAgICB0aGlzLnRhc2tBcGkuX29uRXZlbnQoJ3N0YXR1c1VwZGF0ZWQnLCBzdGF0dXMpO1xyXG5cclxuICAgICAgICBpZiAodGhpcy5pc0FjdHVhbFRlcm1pbmF0aW9uUGVuZGluZyAmJiAhdGhpcy5faXNXYWl0aW5nRm9yV29ya2VyUmVzdWx0KSB7XHJcbiAgICAgICAgICAgIHRoaXMuaXNBY3R1YWxUZXJtaW5hdGlvblBlbmRpbmcgPSBmYWxzZTtcclxuICAgICAgICAgICAgdGhpcy5lbmRlZCgpO1xyXG4gICAgICAgIH1cclxuICAgIH07XHJcbiAgICBcclxuICAgIERlcGVuZGVuY3lXb3JrZXJzVGFza0ludGVybmFscy5wcm90b3R5cGUuY2FsY3VsYXRlUHJpb3JpdHkgPSBmdW5jdGlvbigpIHtcclxuICAgICAgICB2YXIgaXRlcmF0b3IgPSB0aGlzLnByaW9yaXR5Q2FsY3VsYXRvcnMuZ2V0Rmlyc3RJdGVyYXRvcigpO1xyXG4gICAgICAgIHZhciBpc0ZpcnN0ID0gdHJ1ZTtcclxuICAgICAgICB2YXIgcHJpb3JpdHkgPSAwO1xyXG4gICAgICAgIHdoaWxlIChpdGVyYXRvciAhPT0gbnVsbCkge1xyXG4gICAgICAgICAgICB2YXIgcHJpb3JpdHlDYWxjdWxhdG9yID0gdGhpcy5wcmlvcml0eUNhbGN1bGF0b3JzLmdldEZyb21JdGVyYXRvcihpdGVyYXRvcik7XHJcbiAgICAgICAgICAgIHZhciBjdXJyZW50UHJpb3JpdHkgPSBwcmlvcml0eUNhbGN1bGF0b3IoKTtcclxuICAgICAgICAgICAgaWYgKGlzRmlyc3QgfHwgY3VycmVudFByaW9yaXR5ID4gcHJpb3JpdHkpIHtcclxuICAgICAgICAgICAgICAgIHByaW9yaXR5ID0gY3VycmVudFByaW9yaXR5O1xyXG4gICAgICAgICAgICAgICAgaXNGaXJzdCA9IGZhbHNlO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGl0ZXJhdG9yID0gdGhpcy5wcmlvcml0eUNhbGN1bGF0b3JzLmdldE5leHRJdGVyYXRvcihpdGVyYXRvcik7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICByZXR1cm4gcHJpb3JpdHk7XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBEZXBlbmRlbmN5V29ya2Vyc1Rhc2tJbnRlcm5hbHMucHJvdG90eXBlLm5ld0RhdGEgPSBmdW5jdGlvbihkYXRhLCBjYW5Ta2lwKSB7XHJcbiAgICAgICAgaWYgKHRoaXMuX3BlbmRpbmdEZWxheWVkQ2FuU2tpcExhc3ROZXdEYXRhKSB7XHJcbiAgICAgICAgICAgIHRoaXMuX3BlbmRpbmdEZWxheWVkTmV3RGF0YVt0aGlzLl9wZW5kaW5nRGVsYXllZE5ld0RhdGEubGVuZ3RoIC0gMV0gPSBkYXRhO1xyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgIHRoaXMuX3BlbmRpbmdEZWxheWVkTmV3RGF0YS5wdXNoKGRhdGEpO1xyXG4gICAgICAgIH1cclxuICAgICAgICB0aGlzLl9wZW5kaW5nRGVsYXllZENhblNraXBMYXN0TmV3RGF0YSA9ICEhY2FuU2tpcDtcclxuICAgICAgICBcclxuICAgICAgICBpZiAoIXRoaXMuX3BlbmRpbmdEZWxheWVkQWN0aW9uKSB7XHJcbiAgICAgICAgICAgIHRoaXMuX3BlbmRpbmdEZWxheWVkQWN0aW9uID0gdHJ1ZTtcclxuICAgICAgICAgICAgc2V0VGltZW91dCh0aGlzLl9wZXJmb3JtUGVuZGluZ0RlbGF5ZWRBY3Rpb25zQm91bmQpO1xyXG4gICAgICAgIH1cclxuICAgIH07XHJcbiAgICBcclxuICAgIERlcGVuZGVuY3lXb3JrZXJzVGFza0ludGVybmFscy5wcm90b3R5cGUud29ya2VyRG9uZSA9IGZ1bmN0aW9uKCkge1xyXG4gICAgICAgIGlmICh0aGlzLl9qb2JDYWxsYmFja3MgPT09IG51bGwpIHtcclxuICAgICAgICAgICAgdGhyb3cgJ2RlcGVuZGVuY3lXb3JrZXJzOiBKb2IgZG9uZSB3aXRob3V0IHByZXZpb3VzbHkgc3RhcnRlZCc7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHZhciBqb2JDYWxsYmFja3MgPSB0aGlzLl9qb2JDYWxsYmFja3M7XHJcbiAgICAgICAgdGhpcy5fam9iQ2FsbGJhY2tzID0gbnVsbDtcclxuICAgICAgICBcclxuICAgICAgICBpZiAodGhpcy5wZW5kaW5nRGF0YUZvcldvcmtlci5sZW5ndGggPT09IDApIHtcclxuICAgICAgICAgICAgdGhpcy5fcGVuZGluZ1dvcmtlckRvbmUgPSB0cnVlO1xyXG4gICAgICAgICAgICBpZiAoIXRoaXMuX3BlbmRpbmdEZWxheWVkQWN0aW9uKSB7XHJcbiAgICAgICAgICAgICAgICB0aGlzLl9wZW5kaW5nRGVsYXllZEFjdGlvbiA9IHRydWU7XHJcbiAgICAgICAgICAgICAgICBzZXRUaW1lb3V0KHRoaXMuX3BlcmZvcm1QZW5kaW5nRGVsYXllZEFjdGlvbnNCb3VuZCk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgam9iQ2FsbGJhY2tzWydqb2JEb25lJ10oKTtcclxuXHJcbiAgICAgICAgaWYgKHRoaXMucGVuZGluZ0RhdGFGb3JXb3JrZXIubGVuZ3RoID4gMCkge1xyXG4gICAgICAgICAgICB0aGlzLndhaXRGb3JTY2hlZHVsZSgpO1xyXG4gICAgICAgIH1cclxuICAgIH07XHJcbiAgICBcclxuICAgIERlcGVuZGVuY3lXb3JrZXJzVGFza0ludGVybmFscy5wcm90b3R5cGUuZGF0YVJlYWR5ID0gZnVuY3Rpb24gZGF0YVJlYWR5KFxyXG4gICAgICAgIG5ld0RhdGFUb1Byb2Nlc3MsIHdvcmtlclR5cGUsIGNhblNraXApIHtcclxuICAgICAgICBcclxuICAgICAgICBpZiAodGhpcy5pc1Rlcm1pbmF0ZWQpIHtcclxuICAgICAgICAgICAgaWYgKHRoaXMuX2lzVXNlckNhbGxlZFRlcm1pbmF0ZSkge1xyXG4gICAgICAgICAgICAgICAgdGhyb3cgJ2RlcGVuZGVuY3lXb3JrZXJzOiBhbHJlYWR5IHRlcm1pbmF0ZWQnO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIFVzZWQgaW4gRGVwZW5kZW5jeVdvcmtlcnMuX3N0YXJ0V29ya2VyKCkgd2hlbiBwcmV2aW91cyB3b3JrZXIgaGFzIGZpbmlzaGVkXHJcbiAgICAgICAgdmFyIHBlbmRpbmdEYXRhID0ge1xyXG4gICAgICAgICAgICBkYXRhOiBuZXdEYXRhVG9Qcm9jZXNzLFxyXG4gICAgICAgICAgICB3b3JrZXJUeXBlOiB3b3JrZXJUeXBlXHJcbiAgICAgICAgfTtcclxuICAgICAgICBcclxuICAgICAgICBpZiAodGhpcy5jYW5Ta2lwTGFzdFBlbmRpbmdEYXRhRm9yV29ya2VyKSB7XHJcbiAgICAgICAgICAgIHRoaXMucGVuZGluZ0RhdGFGb3JXb3JrZXJbdGhpcy5wZW5kaW5nRGF0YUZvcldvcmtlci5sZW5ndGggLSAxXSA9IHBlbmRpbmdEYXRhO1xyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgIHRoaXMucGVuZGluZ0RhdGFGb3JXb3JrZXIucHVzaChwZW5kaW5nRGF0YSk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHRoaXMuY2FuU2tpcExhc3RQZW5kaW5nRGF0YUZvcldvcmtlciA9ICEhY2FuU2tpcDtcclxuICAgICAgICBcclxuICAgICAgICBpZiAoIXRoaXMuX2lzV2FpdGluZ0ZvcldvcmtlclJlc3VsdCB8fCB0aGlzLl9wZW5kaW5nV29ya2VyRG9uZSkge1xyXG4gICAgICAgICAgICB0aGlzLl9pc1dhaXRpbmdGb3JXb3JrZXJSZXN1bHQgPSB0cnVlO1xyXG4gICAgICAgICAgICB0aGlzLl9wZW5kaW5nV29ya2VyRG9uZSA9IGZhbHNlO1xyXG4gICAgICAgICAgICB0aGlzLndhaXRGb3JTY2hlZHVsZSgpO1xyXG4gICAgICAgICAgICB0aGlzLnN0YXR1c1VwZGF0ZSgpO1xyXG4gICAgICAgIH1cclxuICAgIH07XHJcbiAgICBcclxuICAgIERlcGVuZGVuY3lXb3JrZXJzVGFza0ludGVybmFscy5wcm90b3R5cGUud2FpdEZvclNjaGVkdWxlID0gZnVuY3Rpb24gd2FpdEZvclNjaGVkdWxlKCkge1xyXG4gICAgICAgIHZhciB3b3JrZXJUeXBlID0gdGhpcy5wZW5kaW5nRGF0YUZvcldvcmtlclswXS53b3JrZXJUeXBlO1xyXG4gICAgICAgIHRoaXMuX3BhcmVudERlcGVuZGVuY3lXb3JrZXJzLndhaXRGb3JTY2hlZHVsZSh0aGlzLl9zY2hlZHVsZU5vdGlmaWVyLCB3b3JrZXJUeXBlKTtcclxuICAgIH07XHJcbiAgICBcclxuICAgIERlcGVuZGVuY3lXb3JrZXJzVGFza0ludGVybmFscy5wcm90b3R5cGUuZGV0YWNoQmVmb3JlVGVybWluYXRpb24gPSBmdW5jdGlvbiBkZXRhY2goKSB7XHJcbiAgICAgICAgaWYgKHRoaXMuX2lzRGV0YWNoZWQpIHtcclxuICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICB0aGlzLl9pc0RldGFjaGVkID0gdHJ1ZTtcclxuICAgICAgICB0aGlzLl9wYXJlbnRMaXN0LnJlbW92ZSh0aGlzLl9wYXJlbnRJdGVyYXRvcik7XHJcbiAgICAgICAgdGhpcy5fcGFyZW50SXRlcmF0b3IgPSBudWxsO1xyXG5cclxuICAgICAgICB2YXIgaXRlcmF0b3IgPSB0aGlzLl9kZXBlbmRzVGFza0NvbnRleHRzLmdldEZpcnN0SXRlcmF0b3IoKTtcclxuICAgICAgICB3aGlsZSAoaXRlcmF0b3IgIT09IG51bGwpIHtcclxuICAgICAgICAgICAgdmFyIGNvbnRleHQgPSB0aGlzLl9kZXBlbmRzVGFza0NvbnRleHRzLmdldEZyb21JdGVyYXRvcihpdGVyYXRvcikudGFza0NvbnRleHQ7XHJcbiAgICAgICAgICAgIGl0ZXJhdG9yID0gdGhpcy5fZGVwZW5kc1Rhc2tDb250ZXh0cy5nZXROZXh0SXRlcmF0b3IoaXRlcmF0b3IpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgY29udGV4dC51bnJlZ2lzdGVyKCk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHRoaXMuX2RlcGVuZHNUYXNrQ29udGV4dHMuY2xlYXIoKTtcclxuICAgICAgICBcclxuICAgICAgICB0aGlzLl91bnJlZ2lzdGVyRGVwZW5kUHJpb3JpdHlDYWxjdWxhdG9yKCk7XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBEZXBlbmRlbmN5V29ya2Vyc1Rhc2tJbnRlcm5hbHMucHJvdG90eXBlLmN1c3RvbUV2ZW50ID0gZnVuY3Rpb24gY3VzdG9tRXZlbnQoYXJnMCwgYXJnMSkge1xyXG4gICAgICAgIGlmICh0aGlzLmlzVGVybWluYXRlZCAmJiAhdGhpcy5pc0FjdHVhbFRlcm1pbmF0aW9uUGVuZGluZykge1xyXG4gICAgICAgICAgICB0aHJvdyAnZGVwZW5kZW5jeVdvcmtlcnM6IGFscmVhZHkgdGVybWluYXRlZCc7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHRoaXMuX2l0ZXJhdGVDYWxsYmFja3MoZnVuY3Rpb24oY2FsbGJhY2tzKSB7XHJcbiAgICAgICAgICAgIGlmIChjYWxsYmFja3Mub25DdXN0b20pIHtcclxuICAgICAgICAgICAgICAgIGNhbGxiYWNrcy5vbkN1c3RvbShhcmcwLCBhcmcxKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHRoaXMudGFza0FwaS5fb25FdmVudCgnY3VzdG9tJywgYXJnMCwgYXJnMSk7XHJcbiAgICB9O1xyXG5cclxuICAgIERlcGVuZGVuY3lXb3JrZXJzVGFza0ludGVybmFscy5wcm90b3R5cGUudGVybWluYXRlID0gZnVuY3Rpb24gdGVybWluYXRlKCkge1xyXG4gICAgICAgIGlmICh0aGlzLl9pc1VzZXJDYWxsZWRUZXJtaW5hdGUpIHtcclxuICAgICAgICAgICAgdGhyb3cgJ2RlcGVuZGVuY3lXb3JrZXJzOiBhbHJlYWR5IHRlcm1pbmF0ZWQnO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICB0aGlzLl9pc1VzZXJDYWxsZWRUZXJtaW5hdGUgPSB0cnVlO1xyXG4gICAgICAgIHRoaXMuX3Rlcm1pbmF0ZUludGVybmFsKCk7XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBEZXBlbmRlbmN5V29ya2Vyc1Rhc2tJbnRlcm5hbHMucHJvdG90eXBlLmFib3J0ID0gZnVuY3Rpb24gYWJvcnQoYWJvcnRlZEJ5U2NoZWR1bGVyKSB7XHJcbiAgICAgICAgaWYgKHRoaXMuX2lzQWJvcnRlZCkge1xyXG4gICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHRoaXMuX2lzQWJvcnRlZCA9IHRydWU7XHJcbiAgICAgICAgaWYgKHRoaXMuaXNUZXJtaW5hdGVkKSB7XHJcbiAgICAgICAgICAgIGlmICghdGhpcy5pc0FjdHVhbFRlcm1pbmF0aW9uUGVuZGluZyAmJiAhdGhpcy5faXNBYm9ydGVkTm90QnlTY2hlZHVsZXIpIHtcclxuICAgICAgICAgICAgICAgIHRocm93ICdkZXBlbmRlbmN5V29ya2VyczogYWJvcnRlZCBhZnRlciB0ZXJtaW5hdGlvbic7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9IGVsc2UgaWYgKCFhYm9ydGVkQnlTY2hlZHVsZXIpIHtcclxuICAgICAgICAgICAgdGhpcy5faXNBYm9ydGVkTm90QnlTY2hlZHVsZXIgPSB0cnVlO1xyXG4gICAgICAgIH0gZWxzZSBpZiAodGhpcy5wZW5kaW5nRGF0YUZvcldvcmtlci5sZW5ndGggPT09IDApIHtcclxuICAgICAgICAgICAgdGhyb3cgJ2RlcGVuZGVuY3lXb3JrZXJzOiBBYm9ydCB3aXRob3V0IHRhc2sgd2FpdGluZyBmb3Igc2NoZWR1bGUnO1xyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgIHRoaXMuX2lzV2FpdGluZ0ZvcldvcmtlclJlc3VsdCA9IGZhbHNlOyAvLyBvbmx5IGlmIGFib3J0ZWQgYnkgc2NoZWR1bGVyXHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHRoaXMucGVuZGluZ0RhdGFGb3JXb3JrZXIgPSBbXTtcclxuICAgICAgICB0aGlzLmNhblNraXBMYXN0UGVuZGluZ0RhdGFGb3JXb3JrZXIgPSBmYWxzZTtcclxuICAgICAgICBcclxuICAgICAgICBpZiAoIXRoaXMuaXNUZXJtaW5hdGVkKSB7XHJcbiAgICAgICAgICAgIHRoaXMuY3VzdG9tRXZlbnQoJ2Fib3J0aW5nJywgdGhpcy50YXNrS2V5KTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgdGhpcy5fdGVybWluYXRlSW50ZXJuYWwoKTtcclxuICAgIH07XHJcbiAgICBcclxuICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShEZXBlbmRlbmN5V29ya2Vyc1Rhc2tJbnRlcm5hbHMucHJvdG90eXBlLCAnZGVwZW5kVGFza0tleXMnLCB7XHJcbiAgICAgICAgZ2V0OiBmdW5jdGlvbiBnZXREZXBlbmRUYXNrS2V5cygpIHtcclxuICAgICAgICAgICAgcmV0dXJuIHRoaXMuX2RlcGVuZFRhc2tLZXlzO1xyXG4gICAgICAgIH1cclxuICAgIH0pO1xyXG4gICAgXHJcbiAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkoRGVwZW5kZW5jeVdvcmtlcnNUYXNrSW50ZXJuYWxzLnByb3RvdHlwZSwgJ2RlcGVuZFRhc2tSZXN1bHRzJywge1xyXG4gICAgICAgIGdldDogZnVuY3Rpb24gZ2V0RGVwZW5kVGFza1Jlc3VsdHMoKSB7XHJcbiAgICAgICAgICAgIHJldHVybiB0aGlzLl9kZXBlbmRUYXNrUmVzdWx0cztcclxuICAgICAgICB9XHJcbiAgICB9KTtcclxuICAgIFxyXG4gICAgRGVwZW5kZW5jeVdvcmtlcnNUYXNrSW50ZXJuYWxzLnByb3RvdHlwZS5yZWdpc3RlclRhc2tEZXBlbmRlbmN5ID0gZnVuY3Rpb24oXHJcbiAgICAgICAgICAgIHRhc2tLZXkpIHtcclxuICAgICAgICBcclxuICAgICAgICB2YXIgc3RyS2V5ID0gdGhpcy5fd29ya2VySW5wdXRSZXRyZWl2ZXIuZ2V0S2V5QXNTdHJpbmcodGFza0tleSk7XHJcbiAgICAgICAgdmFyIGFkZFJlc3VsdCA9IHRoaXMuX2RlcGVuZHNUYXNrQ29udGV4dHMudHJ5QWRkKHN0cktleSwgZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgICAgIHJldHVybiB7IHRhc2tDb250ZXh0OiBudWxsIH07XHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKCFhZGRSZXN1bHQuaXNOZXcpIHtcclxuICAgICAgICAgICAgdGhyb3cgJ2RlcGVuZGVuY3lXb3JrZXJzOiBDYW5ub3QgYWRkIHRhc2sgZGVwZW5kZW5jeSB0d2ljZSc7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHZhciB0aGF0ID0gdGhpcztcclxuICAgICAgICB2YXIgZ290RGF0YSA9IGZhbHNlO1xyXG4gICAgICAgIHZhciBpc0RlcGVuZHNUYXNrVGVybWluYXRlZCA9IGZhbHNlO1xyXG4gICAgICAgIHZhciBpbmRleCA9IHRoaXMuX2RlcGVuZFRhc2tLZXlzLmxlbmd0aDtcclxuICAgICAgICBcclxuICAgICAgICB0aGlzLl9kZXBlbmRUYXNrS2V5c1tpbmRleF0gPSB0YXNrS2V5O1xyXG4gICAgICAgIFxyXG4gICAgICAgIGFkZFJlc3VsdC52YWx1ZS50YXNrQ29udGV4dCA9IHRoaXMuX3BhcmVudERlcGVuZGVuY3lXb3JrZXJzLnN0YXJ0VGFzayhcclxuICAgICAgICAgICAgdGFza0tleSwge1xyXG4gICAgICAgICAgICAgICAgJ29uRGF0YSc6IG9uRGVwZW5kZW5jeVRhc2tEYXRhLFxyXG4gICAgICAgICAgICAgICAgJ29uVGVybWluYXRlZCc6IG9uRGVwZW5kZW5jeVRhc2tUZXJtaW5hdGVkLFxyXG4gICAgICAgICAgICAgICAgJ29uQ3VzdG9tJzogb25EZXBlbmRlbmN5VGFza0N1c3RvbSxcclxuICAgICAgICAgICAgICAgIGNhbGxlZUZvckRlYnVnOiB0aGlzXHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICApO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGlmICghYWRkUmVzdWx0LnZhbHVlLnRhc2tDb250ZXh0LmlzQWN0aXZlKSB7XHJcbiAgICAgICAgICAgIHRocm93ICdkZXBlbmRlbmN5LXdvcmtlcnMgZXJyb3I6IGRlcGVuZGFudCB0YXNrIGFscmVhZHkgdGVybWluYXRlZCc7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIE1pZ2h0IGJlIHJlbW92ZWQ6IENvZGUgZm9yIGRlYnVnIHdoaWNoIHJlbGllcyBvbiBpbnRlcm5hbCBtZW1iZXIgdGFza0NvbnRleHQuX3Rhc2tJbnRlcm5hbHNcclxuICAgICAgICBpZiAoYWRkUmVzdWx0LnZhbHVlLnRhc2tDb250ZXh0Ll90YXNrSW50ZXJuYWxzLl9pc0Fib3J0ZWQpIHtcclxuICAgICAgICAgICAgdGhyb3cgJ2RlcGVuZGVuY3lXb3JrZXJzIGVycm9yOiBkZXBlbmRhbnQgdGFzayBhbHJlYWR5IGFib3J0ZWQnO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBpZiAodGhpcy5faXNSZWdpc3RlcmVkRGVwZW5kUHJpb3JpdHlDYWxjdWxhdG9yKSB7XHJcbiAgICAgICAgICAgIGFkZFJlc3VsdC52YWx1ZS50YXNrQ29udGV4dC5zZXRQcmlvcml0eUNhbGN1bGF0b3IodGhpcy5fcHJpb3JpdHlDYWxjdWxhdG9yKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKGdvdERhdGEpIHtcclxuICAgICAgICAgICAgdGhyb3cgJ2RlcGVuZGVuY3ktd29ya2VycyBlcnJvcjogSW50ZXJuYWwgZXJyb3I6IGNhbGxiYWNrIGNhbGxlZCBiZWZvcmUgZGVwZW5kZW5jeSByZWdpc3RyYXRpb24gY29tcGxldGVkJztcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgdmFyIHByb2Nlc3NlZERhdGEgPSBhZGRSZXN1bHQudmFsdWUudGFza0NvbnRleHQuZ2V0UHJvY2Vzc2VkRGF0YSgpO1xyXG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgcHJvY2Vzc2VkRGF0YS5sZW5ndGg7ICsraSkge1xyXG4gICAgICAgICAgICB0aGlzLl9wZW5kaW5nRGVsYXllZERlcGVuZGVuY3lEYXRhLnB1c2goe1xyXG4gICAgICAgICAgICAgICAgZGF0YTogcHJvY2Vzc2VkRGF0YVtpXSxcclxuICAgICAgICAgICAgICAgIG9uRGVwZW5kZW5jeVRhc2tEYXRhOiBvbkRlcGVuZGVuY3lUYXNrRGF0YVxyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICB9XHJcbiAgICAgICAgaWYgKHByb2Nlc3NlZERhdGEubGVuZ3RoID4gMCAmJiAhdGhpcy5fcGVuZGluZ0RlbGF5ZWRBY3Rpb24pIHtcclxuICAgICAgICAgICAgdGhpcy5fcGVuZGluZ0RlbGF5ZWRBY3Rpb24gPSB0cnVlO1xyXG4gICAgICAgICAgICBzZXRUaW1lb3V0KHRoaXMuX3BlcmZvcm1QZW5kaW5nRGVsYXllZEFjdGlvbnNCb3VuZCk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHJldHVybiBhZGRSZXN1bHQudmFsdWUudGFza0NvbnRleHQ7XHJcbiAgICAgICAgXHJcbiAgICAgICAgZnVuY3Rpb24gb25EZXBlbmRlbmN5VGFza0RhdGEoZGF0YSkge1xyXG4gICAgICAgICAgICBpZiAodGhhdC5fcGVuZGluZ0RlbGF5ZWREZXBlbmRlbmN5RGF0YS5sZW5ndGggPiAwKSB7XHJcbiAgICAgICAgICAgICAgICAvLyBBdm9pZCBieXBhc3Mgb2YgZGVsYXllZCBkYXRhIGJ5IG5ldyBkYXRhXHJcbiAgICAgICAgICAgICAgICB0aGF0Ll9wZW5kaW5nRGVsYXllZERlcGVuZGVuY3lEYXRhLnB1c2goe1xyXG4gICAgICAgICAgICAgICAgICAgIGRhdGE6IGRhdGEsXHJcbiAgICAgICAgICAgICAgICAgICAgb25EZXBlbmRlbmN5VGFza0RhdGE6IG9uRGVwZW5kZW5jeVRhc2tEYXRhXHJcbiAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgaWYgKCF0aGF0Ll9wZW5kaW5nRGVsYXllZEFjdGlvbikge1xyXG4gICAgICAgICAgICAgICAgICAgIHRoYXQuX3BlbmRpbmdEZWxheWVkQWN0aW9uID0gdHJ1ZTtcclxuICAgICAgICAgICAgICAgICAgICBzZXRUaW1lb3V0KHRoYXQuX3BlcmZvcm1QZW5kaW5nRGVsYXllZEFjdGlvbnNCb3VuZCk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgdGhhdC5fZGVwZW5kVGFza1Jlc3VsdHNbaW5kZXhdID0gZGF0YTtcclxuICAgICAgICAgICAgdGhhdC5faGFzRGVwZW5kVGFza0RhdGFbaW5kZXhdID0gdHJ1ZTtcclxuICAgICAgICAgICAgdGhhdC50YXNrQXBpLl9vbkV2ZW50KCdkZXBlbmRlbmN5VGFza0RhdGEnLCBkYXRhLCB0YXNrS2V5KTtcclxuICAgICAgICAgICAgZ290RGF0YSA9IHRydWU7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIGZ1bmN0aW9uIG9uRGVwZW5kZW5jeVRhc2tDdXN0b20oYXJnMCwgYXJnMSkge1xyXG4gICAgICAgICAgICB0aGF0LnRhc2tBcGkuX29uRXZlbnQoJ2RlcGVuZGVuY3lUYXNrQ3VzdG9tJywgYXJnMCwgYXJnMSk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIGZ1bmN0aW9uIG9uRGVwZW5kZW5jeVRhc2tUZXJtaW5hdGVkKCkge1xyXG4gICAgICAgICAgICBpZiAoaXNEZXBlbmRzVGFza1Rlcm1pbmF0ZWQpIHtcclxuICAgICAgICAgICAgICAgIHRocm93ICdkZXBlbmRlbmN5V29ya2VyczogRG91YmxlIHRlcm1pbmF0aW9uJztcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBpc0RlcGVuZHNUYXNrVGVybWluYXRlZCA9IHRydWU7XHJcbiAgICAgICAgICAgIHRoYXQuX2RlcGVuZHNUYXNrVGVybWluYXRlZCgpO1xyXG4gICAgICAgIH1cclxuICAgIH07XHJcbiAgICBcclxuICAgIERlcGVuZGVuY3lXb3JrZXJzVGFza0ludGVybmFscy5wcm90b3R5cGUuX3Rlcm1pbmF0ZUludGVybmFsID0gZnVuY3Rpb24gdGVybWluYXRlSW50ZXJuYWwoKSB7XHJcbiAgICAgICAgaWYgKHRoaXMuaXNUZXJtaW5hdGVkKSB7XHJcbiAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgdGhpcy5kZXRhY2hCZWZvcmVUZXJtaW5hdGlvbigpO1xyXG4gICAgICAgIHRoaXMuaXNUZXJtaW5hdGVkID0gdHJ1ZTtcclxuXHJcbiAgICAgICAgaWYgKHRoaXMuX2lzV2FpdGluZ0ZvcldvcmtlclJlc3VsdCkge1xyXG4gICAgICAgICAgICB0aGlzLmlzQWN0dWFsVGVybWluYXRpb25QZW5kaW5nID0gdHJ1ZTtcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICB0aGlzLmVuZGVkKCk7XHJcbiAgICAgICAgfVxyXG4gICAgfTtcclxuICAgIFxyXG4gICAgRGVwZW5kZW5jeVdvcmtlcnNUYXNrSW50ZXJuYWxzLnByb3RvdHlwZS5fcmVnaXN0ZXJEZXBlbmRQcmlvcml0eUNhbGN1bGF0b3IgPSBmdW5jdGlvbiByZWdpc3RlckRlcGVuZFByaW9yaXR5Q2FsY3VsYXRvcigpIHtcclxuICAgICAgICBpZiAodGhpcy5faXNSZWdpc3RlcmVkRGVwZW5kUHJpb3JpdHlDYWxjdWxhdG9yKSB7XHJcbiAgICAgICAgICAgIHRocm93ICdkZXBlbmRlbmN5V29ya2VyczogYWxyZWFkeSByZWdpc3RlcmVkIGRlcGVuZCBwcmlvcml0eSBjYWxjdWxhdG9yJztcclxuICAgICAgICB9XHJcbiAgICAgICAgaWYgKHRoaXMuX3ByaW9yaXR5Q2FsY3VsYXRvciA9PT0gbnVsbCkge1xyXG4gICAgICAgICAgICB0aGlzLl9wcmlvcml0eUNhbGN1bGF0b3IgPSB0aGlzLmNhbGN1bGF0ZVByaW9yaXR5LmJpbmQodGhpcyk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHRoaXMuX2lzUmVnaXN0ZXJlZERlcGVuZFByaW9yaXR5Q2FsY3VsYXRvciA9IHRydWU7XHJcbiAgICAgICAgXHJcbiAgICAgICAgdmFyIGl0ZXJhdG9yID0gdGhpcy5fZGVwZW5kc1Rhc2tDb250ZXh0cy5nZXRGaXJzdEl0ZXJhdG9yKCk7XHJcbiAgICAgICAgd2hpbGUgKGl0ZXJhdG9yICE9PSBudWxsKSB7XHJcbiAgICAgICAgICAgIHZhciBjb250ZXh0ID0gdGhpcy5fZGVwZW5kc1Rhc2tDb250ZXh0cy5nZXRGcm9tSXRlcmF0b3IoaXRlcmF0b3IpLnRhc2tDb250ZXh0O1xyXG4gICAgICAgICAgICBpdGVyYXRvciA9IHRoaXMuX2RlcGVuZHNUYXNrQ29udGV4dHMuZ2V0TmV4dEl0ZXJhdG9yKGl0ZXJhdG9yKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGNvbnRleHQuc2V0UHJpb3JpdHlDYWxjdWxhdG9yKHRoaXMuX3ByaW9yaXR5Q2FsY3VsYXRvcik7XHJcbiAgICAgICAgfVxyXG4gICAgfTtcclxuICAgIFxyXG4gICAgRGVwZW5kZW5jeVdvcmtlcnNUYXNrSW50ZXJuYWxzLnByb3RvdHlwZS5fdW5yZWdpc3RlckRlcGVuZFByaW9yaXR5Q2FsY3VsYXRvciA9IGZ1bmN0aW9uIHVucmVnaXN0ZXJEZXBlbmRQcmlvcml0eUNhbGN1bGF0b3IoKSB7XHJcbiAgICAgICAgaWYgKCF0aGlzLl9pc1JlZ2lzdGVyZWREZXBlbmRQcmlvcml0eUNhbGN1bGF0b3IpIHtcclxuICAgICAgICAgICAgdGhyb3cgJ2RlcGVuZGVuY3lXb3JrZXJzOiBub3QgcmVnaXN0ZXJlZCBkZXBlbmQgcHJpb3JpdHkgY2FsY3VsYXRvcic7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHRoaXMuX2lzUmVnaXN0ZXJlZERlcGVuZFByaW9yaXR5Q2FsY3VsYXRvciA9IGZhbHNlO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHZhciBpdGVyYXRvciA9IHRoaXMuX2RlcGVuZHNUYXNrQ29udGV4dHMuZ2V0Rmlyc3RJdGVyYXRvcigpO1xyXG4gICAgICAgIHdoaWxlIChpdGVyYXRvciAhPT0gbnVsbCkge1xyXG4gICAgICAgICAgICB2YXIgY29udGV4dCA9IHRoaXMuX2RlcGVuZHNUYXNrQ29udGV4dHMuZ2V0RnJvbUl0ZXJhdG9yKGl0ZXJhdG9yKS50YXNrQ29udGV4dDtcclxuICAgICAgICAgICAgaXRlcmF0b3IgPSB0aGlzLl9kZXBlbmRzVGFza0NvbnRleHRzLmdldE5leHRJdGVyYXRvcihpdGVyYXRvcik7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBjb250ZXh0LnNldFByaW9yaXR5Q2FsY3VsYXRvcihudWxsKTtcclxuICAgICAgICB9XHJcbiAgICB9O1xyXG5cclxuICAgIERlcGVuZGVuY3lXb3JrZXJzVGFza0ludGVybmFscy5wcm90b3R5cGUuX2RlcGVuZHNUYXNrVGVybWluYXRlZCA9IGZ1bmN0aW9uIGRlcGVuZHNUYXNrVGVybWluYXRlZCgpIHtcclxuICAgICAgICArK3RoaXMuX2RlcGVuZHNUYXNrc1Rlcm1pbmF0ZWRDb3VudDtcclxuICAgICAgICBpZiAodGhpcy5fZGVwZW5kc1Rhc2tzVGVybWluYXRlZENvdW50ID09PSB0aGlzLl9kZXBlbmRzVGFza0NvbnRleHRzLmdldENvdW50KCkpIHtcclxuICAgICAgICAgICAgdGhpcy50YXNrQXBpLl9vbkV2ZW50KCdhbGxEZXBlbmRUYXNrc1Rlcm1pbmF0ZWQnKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgdGhpcy5zdGF0dXNVcGRhdGUoKTtcclxuICAgIH07XHJcbiAgICBcclxuICAgIERlcGVuZGVuY3lXb3JrZXJzVGFza0ludGVybmFscy5wcm90b3R5cGUuX3BlcmZvcm1QZW5kaW5nRGVsYXllZEFjdGlvbnMgPSBmdW5jdGlvbigpIHtcclxuICAgICAgICB2YXIgaXRlcmF0b3I7XHJcbiAgICAgICAgdmFyIGNvbnRleHQ7XHJcbiAgICAgICAgdGhpcy5fcGVuZGluZ0RlbGF5ZWRBY3Rpb24gPSBmYWxzZTtcclxuICAgICAgICBcclxuICAgICAgICBpZiAodGhpcy5fcGVuZGluZ0RlbGF5ZWREZXBlbmRlbmN5RGF0YS5sZW5ndGggPiAwKSB7XHJcbiAgICAgICAgICAgIHZhciBsb2NhbExpc3RlbmVycyA9IHRoaXMuX3BlbmRpbmdEZWxheWVkRGVwZW5kZW5jeURhdGE7XHJcbiAgICAgICAgICAgIHRoaXMuX3BlbmRpbmdEZWxheWVkRGVwZW5kZW5jeURhdGEgPSBbXTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgbG9jYWxMaXN0ZW5lcnMubGVuZ3RoOyArK2kpIHtcclxuICAgICAgICAgICAgICAgIGxvY2FsTGlzdGVuZXJzW2ldLm9uRGVwZW5kZW5jeVRhc2tEYXRhKGxvY2FsTGlzdGVuZXJzW2ldLmRhdGEpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIGlmICh0aGlzLl9wZW5kaW5nRGVsYXllZE5ld0RhdGEubGVuZ3RoID4gMCkge1xyXG4gICAgICAgICAgICB2YXIgdGhhdCA9IHRoaXM7XHJcbiAgICAgICAgICAgIHZhciBuZXdEYXRhID0gdGhpcy5fcGVuZGluZ0RlbGF5ZWROZXdEYXRhO1xyXG4gICAgICAgICAgICB2YXIgY2FuU2tpcExhc3QgPSB0aGlzLl9wZW5kaW5nRGVsYXllZENhblNraXBMYXN0TmV3RGF0YTtcclxuICAgICAgICAgICAgdGhpcy5fcGVuZGluZ0RlbGF5ZWROZXdEYXRhID0gW107XHJcbiAgICAgICAgICAgIHRoaXMuX3BlbmRpbmdEZWxheWVkQ2FuU2tpcExhc3ROZXdEYXRhID0gZmFsc2U7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBpZiAodGhpcy5fY2FuU2tpcExhc3RQcm9jZXNzZWREYXRhKSB7XHJcbiAgICAgICAgICAgICAgICB0aGlzLnByb2Nlc3NlZERhdGEucG9wKCk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgbmV3RGF0YS5sZW5ndGg7ICsraSkge1xyXG4gICAgICAgICAgICAgICAgdGhpcy5wcm9jZXNzZWREYXRhLnB1c2gobmV3RGF0YVtpXSk7XHJcbiAgICAgICAgICAgICAgICB0aGlzLl9jYW5Ta2lwTGFzdFByb2Nlc3NlZERhdGEgPSBjYW5Ta2lwTGFzdCAmJiBpID09PSBuZXdEYXRhLmxlbmd0aCAtIDE7XHJcbiAgICAgICAgICAgICAgICB0aGlzLl9pdGVyYXRlQ2FsbGJhY2tzKGZ1bmN0aW9uKGNhbGxiYWNrcykge1xyXG4gICAgICAgICAgICAgICAgICAgIGNhbGxiYWNrcy5vbkRhdGEobmV3RGF0YVtpXSwgdGhhdC50YXNrS2V5KTtcclxuICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIGlmICh0aGlzLl9wZW5kaW5nV29ya2VyRG9uZSkge1xyXG4gICAgICAgICAgICB0aGlzLl9pc1dhaXRpbmdGb3JXb3JrZXJSZXN1bHQgPSBmYWxzZTtcclxuICAgICAgICAgICAgdGhpcy5zdGF0dXNVcGRhdGUoKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKHRoaXMuX3BlbmRpbmdEZWxheWVkRW5kZWQpIHtcclxuICAgICAgICAgICAgdGhpcy5fcGVuZGluZ0RlbGF5ZWRFbmRlZCA9IGZhbHNlO1xyXG4gICAgICAgICAgICB2YXIgdGhhdCA9IHRoaXM7XHJcbiAgICAgICAgICAgIHRoaXMuX2l0ZXJhdGVDYWxsYmFja3MoZnVuY3Rpb24oY2FsbGJhY2tzKSB7XHJcbiAgICAgICAgICAgICAgICBpZiAoY2FsbGJhY2tzLm9uVGVybWluYXRlZCkge1xyXG4gICAgICAgICAgICAgICAgICAgIGNhbGxiYWNrcy5vblRlcm1pbmF0ZWQodGhhdC5faXNBYm9ydGVkKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICB0aGlzLnRhc2tDb250ZXh0cy5jbGVhcigpO1xyXG4gICAgICAgIH1cclxuICAgIH07XHJcbiAgICBcclxuICAgIERlcGVuZGVuY3lXb3JrZXJzVGFza0ludGVybmFscy5wcm90b3R5cGUuX2l0ZXJhdGVDYWxsYmFja3MgPSBmdW5jdGlvbihwZXJmb3JtKSB7XHJcbiAgICAgICAgdmFyIGl0ZXJhdG9yID0gdGhpcy50YXNrQ29udGV4dHMuZ2V0Rmlyc3RJdGVyYXRvcigpO1xyXG4gICAgICAgIHdoaWxlIChpdGVyYXRvciAhPT0gbnVsbCkge1xyXG4gICAgICAgICAgICB2YXIgY29udGV4dCA9IHRoaXMudGFza0NvbnRleHRzLmdldEZyb21JdGVyYXRvcihpdGVyYXRvcik7XHJcbiAgICAgICAgICAgIGl0ZXJhdG9yID0gdGhpcy50YXNrQ29udGV4dHMuZ2V0TmV4dEl0ZXJhdG9yKGl0ZXJhdG9yKTtcclxuXHJcbiAgICAgICAgICAgIHBlcmZvcm0oY29udGV4dC5fY2FsbGJhY2tzKTtcclxuICAgICAgICB9XHJcblxyXG4gICAgfTtcclxuICAgIFxyXG4gICAgcmV0dXJuIERlcGVuZGVuY3lXb3JrZXJzVGFza0ludGVybmFscztcclxufSkoKTtcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gRGVwZW5kZW5jeVdvcmtlcnNUYXNrSW50ZXJuYWxzOyIsIid1c2Ugc3RyaWN0JztcclxuXHJcbnZhciBwcmlvcml0aXplciA9IHtcclxuICAgIGdldFByaW9yaXR5OiBmdW5jdGlvbih0YXNrKSB7XHJcbiAgICAgICAgcmV0dXJuIHRhc2suY2FsY3VsYXRlUHJpb3JpdHkoKTtcclxuICAgIH1cclxufTtcclxuXHJcbmZ1bmN0aW9uIGNyZWF0ZUR1bW15UmVzb3VyY2UoKSB7XHJcbiAgICByZXR1cm4ge307XHJcbn1cclxuXHJcbmZ1bmN0aW9uIERlcGVuZGVuY3lXb3JrZXJzVGFza1NjaGVkdWxlcihqb2JzTGltaXQsIG9wdGlvbnMpIHtcclxuICAgIHJlc291cmNlU2NoZWR1bGVyLlByaW9yaXR5U2NoZWR1bGVyLmNhbGwodGhpcywgY3JlYXRlRHVtbXlSZXNvdXJjZSwgam9ic0xpbWl0LCBwcmlvcml0aXplciwgb3B0aW9ucyk7XHJcbn1cclxuXHJcbkRlcGVuZGVuY3lXb3JrZXJzVGFza1NjaGVkdWxlci5wcm90b3R5cGUgPSBPYmplY3QuY3JlYXRlKHJlc291cmNlU2NoZWR1bGVyLlByaW9yaXR5U2NoZWR1bGVyLnByb3RvdHlwZSk7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IERlcGVuZGVuY3lXb3JrZXJzVGFza1NjaGVkdWxlcjsiLCIndXNlIHN0cmljdCc7XHJcblxyXG52YXIgRGVwZW5kZW5jeVdvcmtlcnNUYXNrID0gKGZ1bmN0aW9uIERlcGVuZGVuY3lXb3JrZXJzVGFza0Nsb3N1cmUoKSB7XHJcbiAgICBmdW5jdGlvbiBEZXBlbmRlbmN5V29ya2Vyc1Rhc2sod3JhcHBlZCwga2V5LCByZWdpc3RlcldyYXBwZWRFdmVudHMpIHtcclxuICAgICAgICB0aGlzLl93cmFwcGVkID0gd3JhcHBlZDtcclxuICAgICAgICB3cmFwcGVkLl9fd3JhcHBpbmdUYXNrRm9yRGVidWcgPSB0aGlzO1xyXG4gICAgICAgIHRoaXMuX2tleSA9IGtleTtcclxuICAgICAgICB0aGlzLl9ldmVudExpc3RlbmVycyA9IHtcclxuICAgICAgICAgICAgJ2RlcGVuZGVuY3lUYXNrRGF0YSc6IFtdLFxyXG4gICAgICAgICAgICAnc3RhdHVzVXBkYXRlZCc6IFtdLFxyXG4gICAgICAgICAgICAnYWxsRGVwZW5kVGFza3NUZXJtaW5hdGVkJzogW10sXHJcbiAgICAgICAgICAgICdjdXN0b20nOiBbXSxcclxuICAgICAgICAgICAgJ2RlcGVuZGVuY3lUYXNrQ3VzdG9tJzogW11cclxuICAgICAgICB9O1xyXG4gICAgICAgIFxyXG4gICAgICAgIGlmIChyZWdpc3RlcldyYXBwZWRFdmVudHMpIHtcclxuICAgICAgICAgICAgZm9yICh2YXIgZXZlbnQgaW4gdGhpcy5fZXZlbnRMaXN0ZW5lcnMpIHtcclxuICAgICAgICAgICAgICAgIHRoaXMuX3JlZ2lzdGVyV3JhcHBlZEV2ZW50KGV2ZW50KTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgIH1cclxuICAgIFxyXG4gICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KERlcGVuZGVuY3lXb3JrZXJzVGFzay5wcm90b3R5cGUsICdpc1Rlcm1pbmF0ZWQnLCB7IGdldDogZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgcmV0dXJuIHRoaXMuX3dyYXBwZWQuaXNUZXJtaW5hdGVkO1xyXG4gICAgfSB9KTtcclxuICAgIFxyXG4gICAgRGVwZW5kZW5jeVdvcmtlcnNUYXNrLnByb3RvdHlwZS5kYXRhUmVhZHkgPSBmdW5jdGlvbiBkYXRhUmVhZHkobmV3RGF0YVRvUHJvY2Vzcywgd29ya2VyVHlwZSwgY2FuU2tpcCkge1xyXG4gICAgICAgIHRoaXMuX3dyYXBwZWQuZGF0YVJlYWR5KG5ld0RhdGFUb1Byb2Nlc3MsIHdvcmtlclR5cGUsIGNhblNraXApO1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgRGVwZW5kZW5jeVdvcmtlcnNUYXNrLnByb3RvdHlwZS5kZXRhY2hCZWZvcmVUZXJtaW5hdGlvbiA9IGZ1bmN0aW9uIGRldGFjaCgpIHtcclxuICAgICAgICB0aGlzLl93cmFwcGVkLmRldGFjaEJlZm9yZVRlcm1pbmF0aW9uKCk7XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBEZXBlbmRlbmN5V29ya2Vyc1Rhc2sucHJvdG90eXBlLnRlcm1pbmF0ZSA9IGZ1bmN0aW9uIHRlcm1pbmF0ZSgpIHtcclxuICAgICAgICB0aGlzLl93cmFwcGVkLnRlcm1pbmF0ZSgpO1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgRGVwZW5kZW5jeVdvcmtlcnNUYXNrLnByb3RvdHlwZS5yZWdpc3RlclRhc2tEZXBlbmRlbmN5ID0gZnVuY3Rpb24gcmVnaXN0ZXJUYXNrRGVwZW5kZW5jeSh0YXNrS2V5KSB7XHJcbiAgICAgICAgcmV0dXJuIHRoaXMuX3dyYXBwZWQucmVnaXN0ZXJUYXNrRGVwZW5kZW5jeSh0YXNrS2V5KTtcclxuICAgIH07XHJcbiAgICBcclxuICAgIERlcGVuZGVuY3lXb3JrZXJzVGFzay5wcm90b3R5cGUuY2FsY3VsYXRlUHJpb3JpdHkgPSBmdW5jdGlvbiBjYWxjdWxhdGVQcmlvcml0eSgpIHtcclxuICAgICAgICByZXR1cm4gdGhpcy5fd3JhcHBlZC5jYWxjdWxhdGVQcmlvcml0eSgpO1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgRGVwZW5kZW5jeVdvcmtlcnNUYXNrLnByb3RvdHlwZS5jdXN0b21FdmVudCA9IGZ1bmN0aW9uIGN1c3RvbUV2ZW50KGFyZzAsIGFyZzEpIHtcclxuICAgICAgICByZXR1cm4gdGhpcy5fd3JhcHBlZC5jdXN0b21FdmVudChhcmcwLCBhcmcxKTtcclxuICAgIH07XHJcbiAgICBcclxuICAgIERlcGVuZGVuY3lXb3JrZXJzVGFzay5wcm90b3R5cGUub24gPSBmdW5jdGlvbiBvbihldmVudCwgbGlzdGVuZXIpIHtcclxuICAgICAgICBpZiAoIXRoaXMuX2V2ZW50TGlzdGVuZXJzW2V2ZW50XSkge1xyXG4gICAgICAgICAgICB0aHJvdyAnZGVwZW5kZW5jeVdvcmtlcnM6IFRhc2sgaGFzIG5vIGV2ZW50ICcgKyBldmVudDtcclxuICAgICAgICB9XHJcbiAgICAgICAgdGhpcy5fZXZlbnRMaXN0ZW5lcnNbZXZlbnRdLnB1c2gobGlzdGVuZXIpO1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KERlcGVuZGVuY3lXb3JrZXJzVGFzay5wcm90b3R5cGUsICdrZXknLCB7XHJcbiAgICAgICAgZ2V0OiBmdW5jdGlvbiBnZXRLZXkoKSB7XHJcbiAgICAgICAgICAgIHJldHVybiB0aGlzLl9rZXk7XHJcbiAgICAgICAgfVxyXG4gICAgfSk7XHJcbiAgICBcclxuICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShEZXBlbmRlbmN5V29ya2Vyc1Rhc2sucHJvdG90eXBlLCAnZGVwZW5kVGFza0tleXMnLCB7XHJcbiAgICAgICAgZ2V0OiBmdW5jdGlvbiBnZXREZXBlbmRUYXNrS2V5cygpIHtcclxuICAgICAgICAgICAgcmV0dXJuIHRoaXMuX3dyYXBwZWQuZGVwZW5kVGFza0tleXM7XHJcbiAgICAgICAgfVxyXG4gICAgfSk7XHJcbiAgICBcclxuICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShEZXBlbmRlbmN5V29ya2Vyc1Rhc2sucHJvdG90eXBlLCAnZGVwZW5kVGFza1Jlc3VsdHMnLCB7XHJcbiAgICAgICAgZ2V0OiBmdW5jdGlvbiBnZXREZXBlbmRUYXNrUmVzdWx0cygpIHtcclxuICAgICAgICAgICAgcmV0dXJuIHRoaXMuX3dyYXBwZWQuZGVwZW5kVGFza1Jlc3VsdHM7XHJcbiAgICAgICAgfVxyXG4gICAgfSk7XHJcbiAgICBcclxuICAgIERlcGVuZGVuY3lXb3JrZXJzVGFzay5wcm90b3R5cGUuX29uRXZlbnQgPSBmdW5jdGlvbiBvbkV2ZW50KGV2ZW50LCBhcmcxLCBhcmcyKSB7XHJcbiAgICAgICAgaWYgKGV2ZW50ID09ICdzdGF0dXNVcGRhdGVkJykge1xyXG4gICAgICAgICAgICBhcmcxID0gdGhpcy5fbW9kaWZ5U3RhdHVzKGFyZzEpO1xyXG4gICAgICAgIH1cclxuICAgICAgICB2YXIgbGlzdGVuZXJzID0gdGhpcy5fZXZlbnRMaXN0ZW5lcnNbZXZlbnRdO1xyXG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgbGlzdGVuZXJzLmxlbmd0aDsgKytpKSB7XHJcbiAgICAgICAgICAgIGxpc3RlbmVyc1tpXS5jYWxsKHRoaXMsIGFyZzEsIGFyZzIpO1xyXG4gICAgICAgIH1cclxuICAgIH07XHJcbiAgICBcclxuICAgIERlcGVuZGVuY3lXb3JrZXJzVGFzay5wcm90b3R5cGUuX21vZGlmeVN0YXR1cyA9IGZ1bmN0aW9uIG1vZGlmeVN0YXR1cyhzdGF0dXMpIHtcclxuICAgICAgICByZXR1cm4gc3RhdHVzO1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgRGVwZW5kZW5jeVdvcmtlcnNUYXNrLnByb3RvdHlwZS5fcmVnaXN0ZXJXcmFwcGVkRXZlbnQgPSBmdW5jdGlvbiByZWdpc3RlcldyYXBwZWRFdmVudChldmVudCkge1xyXG4gICAgICAgIHZhciB0aGF0ID0gdGhpcztcclxuICAgICAgICB0aGlzLl93cmFwcGVkLm9uKGV2ZW50LCBmdW5jdGlvbihhcmcxLCBhcmcyKSB7XHJcbiAgICAgICAgICAgIHRoYXQuX29uRXZlbnQoZXZlbnQsIGFyZzEsIGFyZzIpO1xyXG4gICAgICAgIH0pO1xyXG4gICAgfTtcclxuXHJcbiAgICByZXR1cm4gRGVwZW5kZW5jeVdvcmtlcnNUYXNrO1xyXG59KSgpO1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBEZXBlbmRlbmN5V29ya2Vyc1Rhc2s7IiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxuLyogZ2xvYmFsIGNvbnNvbGU6IGZhbHNlICovXHJcbi8qIGdsb2JhbCBQcm9taXNlOiBmYWxzZSAqL1xyXG5cclxudmFyIEpzQnVpbHRpbkhhc2hNYXAgPSByZXF1aXJlKCdqcy1idWlsdGluLWhhc2gtbWFwJyk7XHJcbnZhciBEZXBlbmRlbmN5V29ya2Vyc1Rhc2tJbnRlcm5hbHMgPSByZXF1aXJlKCdkZXBlbmRlbmN5LXdvcmtlcnMtdGFzay1pbnRlcm5hbHMnKTtcclxudmFyIERlcGVuZGVuY3lXb3JrZXJzVGFza0NvbnRleHQgPSByZXF1aXJlKCdkZXBlbmRlbmN5LXdvcmtlcnMtdGFzay1jb250ZXh0Jyk7XHJcblxyXG52YXIgRGVwZW5kZW5jeVdvcmtlcnMgPSAoZnVuY3Rpb24gRGVwZW5kZW5jeVdvcmtlcnNDbG9zdXJlKCkge1xyXG4gICAgZnVuY3Rpb24gRGVwZW5kZW5jeVdvcmtlcnMod29ya2VySW5wdXRSZXRyZWl2ZXIpIHtcclxuICAgICAgICB2YXIgdGhhdCA9IHRoaXM7XHJcbiAgICAgICAgdGhhdC5fd29ya2VySW5wdXRSZXRyZWl2ZXIgPSB3b3JrZXJJbnB1dFJldHJlaXZlcjtcclxuICAgICAgICB0aGF0Ll90YXNrSW50ZXJuYWxzcyA9IG5ldyBKc0J1aWx0aW5IYXNoTWFwKCk7XHJcbiAgICAgICAgdGhhdC5fd29ya2VyUG9vbEJ5VGFza1R5cGUgPSBbXTtcclxuICAgICAgICB0aGF0Ll90YXNrT3B0aW9uc0J5VGFza1R5cGUgPSBbXTtcclxuICAgICAgICBcclxuICAgICAgICBpZiAoIXdvcmtlcklucHV0UmV0cmVpdmVyLmdldFdvcmtlclR5cGVPcHRpb25zKSB7XHJcbiAgICAgICAgICAgIHRocm93ICdkZXBlbmRlbmN5V29ya2VyczogTm8gJyArXHJcbiAgICAgICAgICAgICAgICAnd29ya2VySW5wdXRSZXRyZWl2ZXIuZ2V0V29ya2VyVHlwZU9wdGlvbnMoKSBtZXRob2QnO1xyXG4gICAgICAgIH1cclxuICAgICAgICBpZiAoIXdvcmtlcklucHV0UmV0cmVpdmVyLmdldEtleUFzU3RyaW5nKSB7XHJcbiAgICAgICAgICAgIHRocm93ICdkZXBlbmRlbmN5V29ya2VyczogTm8gJyArXHJcbiAgICAgICAgICAgICAgICAnd29ya2VySW5wdXRSZXRyZWl2ZXIuZ2V0S2V5QXNTdHJpbmcoKSBtZXRob2QnO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuICAgIFxyXG4gICAgRGVwZW5kZW5jeVdvcmtlcnMucHJvdG90eXBlLnN0YXJ0VGFzayA9IGZ1bmN0aW9uIHN0YXJ0VGFzayhcclxuICAgICAgICB0YXNrS2V5LCBjYWxsYmFja3MpIHtcclxuICAgICAgICBcclxuICAgICAgICB2YXIgZGVwZW5kZW5jeVdvcmtlcnMgPSB0aGlzO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHZhciBzdHJLZXkgPSB0aGlzLl93b3JrZXJJbnB1dFJldHJlaXZlci5nZXRLZXlBc1N0cmluZyh0YXNrS2V5KTtcclxuICAgICAgICB2YXIgYWRkUmVzdWx0ID0gdGhpcy5fdGFza0ludGVybmFsc3MudHJ5QWRkKHN0cktleSwgZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgICAgIHJldHVybiBuZXcgRGVwZW5kZW5jeVdvcmtlcnNUYXNrSW50ZXJuYWxzKCk7XHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgdmFyIHRhc2tJbnRlcm5hbHMgPSBhZGRSZXN1bHQudmFsdWU7XHJcbiAgICAgICAgdmFyIHRhc2tDb250ZXh0ID0gbmV3IERlcGVuZGVuY3lXb3JrZXJzVGFza0NvbnRleHQoXHJcbiAgICAgICAgICAgIHRhc2tJbnRlcm5hbHMsIGNhbGxiYWNrcyk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKGFkZFJlc3VsdC5pc05ldykge1xyXG4gICAgICAgICAgICB0YXNrSW50ZXJuYWxzLmluaXRpYWxpemUoXHJcbiAgICAgICAgICAgICAgICB0YXNrS2V5LFxyXG4gICAgICAgICAgICAgICAgdGhpcyxcclxuICAgICAgICAgICAgICAgIHRoaXMuX3dvcmtlcklucHV0UmV0cmVpdmVyLFxyXG4gICAgICAgICAgICAgICAgdGhpcy5fdGFza0ludGVybmFsc3MsXHJcbiAgICAgICAgICAgICAgICBhZGRSZXN1bHQuaXRlcmF0b3IsXHJcbiAgICAgICAgICAgICAgICB0aGlzLl93b3JrZXJJbnB1dFJldHJlaXZlcik7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgdGhpcy5fd29ya2VySW5wdXRSZXRyZWl2ZXIudGFza1N0YXJ0ZWQodGFza0ludGVybmFscy50YXNrQXBpKTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIHJldHVybiB0YXNrQ29udGV4dDtcclxuICAgIH07XHJcbiAgICBcclxuICAgIERlcGVuZGVuY3lXb3JrZXJzLnByb3RvdHlwZS5zdGFydFRhc2tQcm9taXNlID1cclxuICAgICAgICAgICAgZnVuY3Rpb24gc3RhcnRUYXNrUHJvbWlzZSh0YXNrS2V5KSB7XHJcbiAgICAgICAgXHJcbiAgICAgICAgdmFyIHRoYXQgPSB0aGlzO1xyXG4gICAgICAgIHJldHVybiBuZXcgUHJvbWlzZShmdW5jdGlvbihyZXNvbHZlLCByZWplY3QpIHtcclxuICAgICAgICAgICAgdmFyIHRhc2tDb250ZXh0ID0gdGhhdC5zdGFydFRhc2soXHJcbiAgICAgICAgICAgICAgICB0YXNrS2V5LCB7ICdvbkRhdGEnOiBvbkRhdGEsICdvblRlcm1pbmF0ZWQnOiBvblRlcm1pbmF0ZWQgfSk7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgdmFyIHByb2Nlc3NlZERhdGEgPSB0YXNrQ29udGV4dC5nZXRQcm9jZXNzZWREYXRhKCk7XHJcbiAgICAgICAgICAgIHZhciBoYXNEYXRhID0gcHJvY2Vzc2VkRGF0YS5sZW5ndGggPiAwO1xyXG4gICAgICAgICAgICB2YXIgcmVzdWx0O1xyXG4gICAgICAgICAgICBpZiAoaGFzRGF0YSkge1xyXG4gICAgICAgICAgICAgICAgcmVzdWx0ID0gcHJvY2Vzc2VkRGF0YVtwcm9jZXNzZWREYXRhLmxlbmd0aCAtIDFdO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBmdW5jdGlvbiBvbkRhdGEoZGF0YSkge1xyXG4gICAgICAgICAgICAgICAgaGFzRGF0YSA9IHRydWU7XHJcbiAgICAgICAgICAgICAgICByZXN1bHQgPSBkYXRhO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBmdW5jdGlvbiBvblRlcm1pbmF0ZWQoaXNBYm9ydGVkKSB7XHJcbiAgICAgICAgICAgICAgICBpZiAoaXNBYm9ydGVkKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgcmVqZWN0KCdUYXNrIGlzIGFib3J0ZWQnKTtcclxuICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAoaGFzRGF0YSkge1xyXG4gICAgICAgICAgICAgICAgICAgIHJlc29sdmUocmVzdWx0KTtcclxuICAgICAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgICAgcmVqZWN0KCdUYXNrIHRlcm1pbmF0ZWQgYnV0IG5vIGRhdGEgcmV0dXJuZWQnKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH0pO1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgRGVwZW5kZW5jeVdvcmtlcnMucHJvdG90eXBlLnRlcm1pbmF0ZUluYWN0aXZlV29ya2VycyA9IGZ1bmN0aW9uKCkge1xyXG4gICAgICAgIGZvciAodmFyIHRhc2tUeXBlIGluIHRoaXMuX3dvcmtlclBvb2xCeVRhc2tUeXBlKSB7XHJcbiAgICAgICAgICAgIHZhciB3b3JrZXJQb29sID0gdGhpcy5fd29ya2VyUG9vbEJ5VGFza1R5cGVbdGFza1R5cGVdO1xyXG4gICAgICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IHdvcmtlclBvb2wubGVuZ3RoOyArK2kpIHtcclxuICAgICAgICAgICAgICAgIHdvcmtlclBvb2xbaV0ucHJveHkudGVybWluYXRlKCk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgd29ya2VyUG9vbC5sZW5ndGggPSAwO1xyXG4gICAgICAgIH1cclxuICAgIH07XHJcbiAgICBcclxuICAgIERlcGVuZGVuY3lXb3JrZXJzLnByb3RvdHlwZS5fZGF0YVJlYWR5ID0gZnVuY3Rpb24gZGF0YVJlYWR5KFxyXG4gICAgICAgICAgICB0YXNrSW50ZXJuYWxzLCBkYXRhVG9Qcm9jZXNzLCB3b3JrZXJUeXBlLCBjYW5Ta2lwKSB7XHJcbiAgICAgICAgXHJcbiAgICAgICAgdmFyIHRoYXQgPSB0aGlzO1xyXG4gICAgICAgIHZhciB3b3JrZXI7XHJcbiAgICAgICAgdmFyIHdvcmtlclBvb2wgPSB0aGF0Ll93b3JrZXJQb29sQnlUYXNrVHlwZVt3b3JrZXJUeXBlXTtcclxuICAgICAgICBpZiAoIXdvcmtlclBvb2wpIHtcclxuICAgICAgICAgICAgd29ya2VyUG9vbCA9IFtdO1xyXG4gICAgICAgICAgICB0aGF0Ll93b3JrZXJQb29sQnlUYXNrVHlwZVt3b3JrZXJUeXBlXSA9IHdvcmtlclBvb2w7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGlmICh3b3JrZXJQb29sLmxlbmd0aCA+IDApIHtcclxuICAgICAgICAgICAgd29ya2VyID0gd29ya2VyUG9vbC5wb3AoKTtcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICB2YXIgd29ya2VyQXJncyA9IHRoYXQuX3dvcmtlcklucHV0UmV0cmVpdmVyLmdldFdvcmtlclR5cGVPcHRpb25zKFxyXG4gICAgICAgICAgICAgICAgd29ya2VyVHlwZSk7XHJcblxyXG4gICAgICAgICAgICBpZiAoIXdvcmtlckFyZ3MpIHtcclxuICAgICAgICAgICAgICAgIHRhc2tJbnRlcm5hbHMubmV3RGF0YShkYXRhVG9Qcm9jZXNzKTtcclxuICAgICAgICAgICAgICAgIHRhc2tJbnRlcm5hbHMud29ya2VyRG9uZSgpO1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICB3b3JrZXIgPSB7XHJcbiAgICAgICAgICAgICAgICBwcm94eTogbmV3IGFzeW5jUHJveHkuQXN5bmNQcm94eU1hc3RlcihcclxuICAgICAgICAgICAgICAgICAgICB3b3JrZXJBcmdzLnNjcmlwdHNUb0ltcG9ydCxcclxuICAgICAgICAgICAgICAgICAgICB3b3JrZXJBcmdzLmN0b3JOYW1lLFxyXG4gICAgICAgICAgICAgICAgICAgIHdvcmtlckFyZ3MuY3RvckFyZ3MpLFxyXG4gICAgICAgICAgICAgICAgdHJhbnNmZXJhYmxlczogd29ya2VyQXJncy50cmFuc2ZlcmFibGVzLFxyXG4gICAgICAgICAgICAgICAgcGF0aFRvVHJhbnNmZXJhYmxlc0luUHJvbWlzZVJlc3VsdDogd29ya2VyQXJncy5wYXRoVG9UcmFuc2ZlcmFibGVzSW5Qcm9taXNlUmVzdWx0XHJcbiAgICAgICAgICAgIH07XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHZhciBhcmdzID0gW2RhdGFUb1Byb2Nlc3MsIHRhc2tJbnRlcm5hbHMudGFza0tleV07XHJcbiAgICAgICAgdmFyIG9wdGlvbnMgPSB7XHJcbiAgICAgICAgICAgICdpc1JldHVyblByb21pc2UnOiB0cnVlLFxyXG4gICAgICAgICAgICAndHJhbnNmZXJhYmxlcyc6IHdvcmtlci50cmFuc2ZlcmFibGVzLFxyXG4gICAgICAgICAgICAncGF0aFRvVHJhbnNmZXJhYmxlc0luUHJvbWlzZVJlc3VsdCc6IHdvcmtlci5wYXRoVG9UcmFuc2ZlcmFibGVzSW5Qcm9taXNlUmVzdWx0XHJcbiAgICAgICAgfTtcclxuXHJcbiAgICAgICAgdmFyIHByb21pc2UgPSB3b3JrZXIucHJveHkuY2FsbEZ1bmN0aW9uKCdzdGFydCcsIGFyZ3MsIG9wdGlvbnMpO1xyXG4gICAgICAgIHByb21pc2VcclxuICAgICAgICAgICAgLnRoZW4oZnVuY3Rpb24ocHJvY2Vzc2VkRGF0YSkge1xyXG4gICAgICAgICAgICAgICAgdGFza0ludGVybmFscy5uZXdEYXRhKHByb2Nlc3NlZERhdGEsIGNhblNraXApO1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuIHByb2Nlc3NlZERhdGE7XHJcbiAgICAgICAgICAgIH0pLmNhdGNoKGZ1bmN0aW9uKGUpIHtcclxuICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKCdFcnJvciBpbiBEZXBlbmRlbmN5V29ya2Vyc1xcJyB3b3JrZXI6ICcgKyBlKTtcclxuICAgICAgICAgICAgICAgIHJldHVybiBlO1xyXG4gICAgICAgICAgICB9KS50aGVuKGZ1bmN0aW9uKHJlc3VsdCkge1xyXG4gICAgICAgICAgICAgICAgd29ya2VyUG9vbC5wdXNoKHdvcmtlcik7XHJcbiAgICAgICAgICAgICAgICB0YXNrSW50ZXJuYWxzLndvcmtlckRvbmUoKTtcclxuICAgICAgICAgICAgfSk7XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBEZXBlbmRlbmN5V29ya2Vycy5wcm90b3R5cGUud2FpdEZvclNjaGVkdWxlID0gZnVuY3Rpb24gd2FpdEZvclNjaGVkdWxlKHNjaGVkdWxlTm90aWZpZXIpIHtcclxuICAgICAgICBzY2hlZHVsZU5vdGlmaWVyLnNjaGVkdWxlKHsgJ2pvYkRvbmUnOiBmdW5jdGlvbigpIHsgfSB9KTtcclxuICAgIH07XHJcbiAgICBcclxuICAgIERlcGVuZGVuY3lXb3JrZXJzLnByb3RvdHlwZS5pbml0aWFsaXppbmdUYXNrID0gZnVuY3Rpb24gaW5pdGlhbGl6aW5nVGFzayh0YXNrQXBpKSB7XHJcbiAgICAgICAgLy8gRG8gbm90aGluZywgb3ZlcnJpZGVuIGJ5IGluaGVyaXRvcnNcclxuICAgIH07XHJcbiAgICBcclxuICAgIHJldHVybiBEZXBlbmRlbmN5V29ya2VycztcclxufSkoKTtcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gRGVwZW5kZW5jeVdvcmtlcnM7IiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxudmFyIExpbmtlZExpc3QgPSByZXF1aXJlKCdsaW5rZWQtbGlzdCcpO1xyXG5cclxudmFyIEhhc2hNYXAgPSAoZnVuY3Rpb24gSGFzaE1hcENsb3N1cmUoKSB7XHJcblxyXG5mdW5jdGlvbiBIYXNoTWFwKGhhc2hlcikge1xyXG4gICAgdmFyIHRoYXQgPSB0aGlzO1xyXG4gICAgdGhhdC5faGFzaGVyID0gaGFzaGVyO1xyXG4gICAgdGhhdC5jbGVhcigpO1xyXG59XHJcblxyXG5IYXNoTWFwLnByb3RvdHlwZS5jbGVhciA9IGZ1bmN0aW9uIGNsZWFyKCkge1xyXG4gICAgdGhpcy5fbGlzdEJ5S2V5ID0gW107XHJcbiAgICB0aGlzLl9saXN0T2ZMaXN0cyA9IG5ldyBMaW5rZWRMaXN0KCk7XHJcbiAgICB0aGlzLl9jb3VudCA9IDA7XHJcbn07XHJcblxyXG5IYXNoTWFwLnByb3RvdHlwZS5nZXRGcm9tS2V5ID0gZnVuY3Rpb24gZ2V0RnJvbUtleShrZXkpIHtcclxuICAgIHZhciBoYXNoQ29kZSA9IHRoaXMuX2hhc2hlclsnZ2V0SGFzaENvZGUnXShrZXkpO1xyXG4gICAgdmFyIGhhc2hFbGVtZW50cyA9IHRoaXMuX2xpc3RCeUtleVtoYXNoQ29kZV07XHJcbiAgICBpZiAoIWhhc2hFbGVtZW50cykge1xyXG4gICAgICAgIHJldHVybiBudWxsO1xyXG4gICAgfVxyXG4gICAgdmFyIGxpc3QgPSBoYXNoRWxlbWVudHMubGlzdDtcclxuICAgIFxyXG4gICAgdmFyIGl0ZXJhdG9yID0gbGlzdC5nZXRGaXJzdEl0ZXJhdG9yKCk7XHJcbiAgICB3aGlsZSAoaXRlcmF0b3IgIT09IG51bGwpIHtcclxuICAgICAgICB2YXIgaXRlbSA9IGxpc3QuZ2V0RnJvbUl0ZXJhdG9yKGl0ZXJhdG9yKTtcclxuICAgICAgICBpZiAodGhpcy5faGFzaGVyWydpc0VxdWFsJ10oaXRlbS5rZXksIGtleSkpIHtcclxuICAgICAgICAgICAgcmV0dXJuIGl0ZW0udmFsdWU7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIGl0ZXJhdG9yID0gbGlzdC5nZXROZXh0SXRlcmF0b3IoaXRlcmF0b3IpO1xyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiBudWxsO1xyXG59O1xyXG5cclxuSGFzaE1hcC5wcm90b3R5cGUuZ2V0RnJvbUl0ZXJhdG9yID0gZnVuY3Rpb24gZ2V0RnJvbUl0ZXJhdG9yKGl0ZXJhdG9yKSB7XHJcbiAgICByZXR1cm4gaXRlcmF0b3IuX2hhc2hFbGVtZW50cy5saXN0LmdldEZyb21JdGVyYXRvcihpdGVyYXRvci5faW50ZXJuYWxJdGVyYXRvcikudmFsdWU7XHJcbn07XHJcblxyXG5IYXNoTWFwLnByb3RvdHlwZS50cnlBZGQgPSBmdW5jdGlvbiB0cnlBZGQoa2V5LCBjcmVhdGVWYWx1ZSkge1xyXG4gICAgdmFyIGhhc2hDb2RlID0gdGhpcy5faGFzaGVyWydnZXRIYXNoQ29kZSddKGtleSk7XHJcbiAgICB2YXIgaGFzaEVsZW1lbnRzID0gdGhpcy5fbGlzdEJ5S2V5W2hhc2hDb2RlXTtcclxuICAgIGlmICghaGFzaEVsZW1lbnRzKSB7XHJcbiAgICAgICAgaGFzaEVsZW1lbnRzID0ge1xyXG4gICAgICAgICAgICBoYXNoQ29kZTogaGFzaENvZGUsXHJcbiAgICAgICAgICAgIGxpc3Q6IG5ldyBMaW5rZWRMaXN0KCksXHJcbiAgICAgICAgICAgIGxpc3RPZkxpc3RzSXRlcmF0b3I6IG51bGxcclxuICAgICAgICB9O1xyXG4gICAgICAgIGhhc2hFbGVtZW50cy5saXN0T2ZMaXN0c0l0ZXJhdG9yID0gdGhpcy5fbGlzdE9mTGlzdHMuYWRkKGhhc2hFbGVtZW50cyk7XHJcbiAgICAgICAgdGhpcy5fbGlzdEJ5S2V5W2hhc2hDb2RlXSA9IGhhc2hFbGVtZW50cztcclxuICAgIH1cclxuICAgIFxyXG4gICAgdmFyIGl0ZXJhdG9yID0ge1xyXG4gICAgICAgIF9oYXNoRWxlbWVudHM6IGhhc2hFbGVtZW50cyxcclxuICAgICAgICBfaW50ZXJuYWxJdGVyYXRvcjogbnVsbFxyXG4gICAgfTtcclxuICAgIFxyXG4gICAgaXRlcmF0b3IuX2ludGVybmFsSXRlcmF0b3IgPSBoYXNoRWxlbWVudHMubGlzdC5nZXRGaXJzdEl0ZXJhdG9yKCk7XHJcbiAgICB3aGlsZSAoaXRlcmF0b3IuX2ludGVybmFsSXRlcmF0b3IgIT09IG51bGwpIHtcclxuICAgICAgICB2YXIgaXRlbSA9IGhhc2hFbGVtZW50cy5saXN0LmdldEZyb21JdGVyYXRvcihpdGVyYXRvci5faW50ZXJuYWxJdGVyYXRvcik7XHJcbiAgICAgICAgaWYgKHRoaXMuX2hhc2hlclsnaXNFcXVhbCddKGl0ZW0ua2V5LCBrZXkpKSB7XHJcbiAgICAgICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICAgICAgICBpdGVyYXRvcjogaXRlcmF0b3IsXHJcbiAgICAgICAgICAgICAgICBpc05ldzogZmFsc2UsXHJcbiAgICAgICAgICAgICAgICB2YWx1ZTogaXRlbS52YWx1ZVxyXG4gICAgICAgICAgICB9O1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBpdGVyYXRvci5faW50ZXJuYWxJdGVyYXRvciA9IGhhc2hFbGVtZW50cy5saXN0LmdldE5leHRJdGVyYXRvcihpdGVyYXRvci5faW50ZXJuYWxJdGVyYXRvcik7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHZhciB2YWx1ZSA9IGNyZWF0ZVZhbHVlKCk7XHJcbiAgICBpdGVyYXRvci5faW50ZXJuYWxJdGVyYXRvciA9IGhhc2hFbGVtZW50cy5saXN0LmFkZCh7XHJcbiAgICAgICAga2V5OiBrZXksXHJcbiAgICAgICAgdmFsdWU6IHZhbHVlXHJcbiAgICB9KTtcclxuICAgICsrdGhpcy5fY291bnQ7XHJcbiAgICBcclxuICAgIHJldHVybiB7XHJcbiAgICAgICAgaXRlcmF0b3I6IGl0ZXJhdG9yLFxyXG4gICAgICAgIGlzTmV3OiB0cnVlLFxyXG4gICAgICAgIHZhbHVlOiB2YWx1ZVxyXG4gICAgfTtcclxufTtcclxuXHJcbkhhc2hNYXAucHJvdG90eXBlLnJlbW92ZSA9IGZ1bmN0aW9uIHJlbW92ZShpdGVyYXRvcikge1xyXG4gICAgdmFyIG9sZExpc3RDb3VudCA9IGl0ZXJhdG9yLl9oYXNoRWxlbWVudHMubGlzdC5nZXRDb3VudCgpO1xyXG4gICAgaXRlcmF0b3IuX2hhc2hFbGVtZW50cy5saXN0LnJlbW92ZShpdGVyYXRvci5faW50ZXJuYWxJdGVyYXRvcik7XHJcbiAgICB2YXIgbmV3TGlzdENvdW50ID0gaXRlcmF0b3IuX2hhc2hFbGVtZW50cy5saXN0LmdldENvdW50KCk7XHJcbiAgICBcclxuICAgIHRoaXMuX2NvdW50ICs9IChuZXdMaXN0Q291bnQgLSBvbGRMaXN0Q291bnQpO1xyXG4gICAgaWYgKG5ld0xpc3RDb3VudCA9PT0gMCkge1xyXG4gICAgICAgIHRoaXMuX2xpc3RPZkxpc3RzLnJlbW92ZShpdGVyYXRvci5faGFzaEVsZW1lbnRzLmxpc3RPZkxpc3RzSXRlcmF0b3IpO1xyXG4gICAgICAgIGRlbGV0ZSB0aGlzLl9saXN0QnlLZXlbaXRlcmF0b3IuX2hhc2hFbGVtZW50cy5oYXNoQ29kZV07XHJcbiAgICB9XHJcbn07XHJcblxyXG5IYXNoTWFwLnByb3RvdHlwZS5nZXRDb3VudCA9IGZ1bmN0aW9uIGdldENvdW50KCkge1xyXG4gICAgcmV0dXJuIHRoaXMuX2NvdW50O1xyXG59O1xyXG5cclxuSGFzaE1hcC5wcm90b3R5cGUuZ2V0Rmlyc3RJdGVyYXRvciA9IGZ1bmN0aW9uIGdldEZpcnN0SXRlcmF0b3IoKSB7XHJcbiAgICB2YXIgZmlyc3RMaXN0SXRlcmF0b3IgPSB0aGlzLl9saXN0T2ZMaXN0cy5nZXRGaXJzdEl0ZXJhdG9yKCk7XHJcbiAgICB2YXIgZmlyc3RIYXNoRWxlbWVudHMgPSBudWxsO1xyXG4gICAgdmFyIGZpcnN0SW50ZXJuYWxJdGVyYXRvciA9IG51bGw7XHJcbiAgICBpZiAoZmlyc3RMaXN0SXRlcmF0b3IgIT09IG51bGwpIHtcclxuICAgICAgICBmaXJzdEhhc2hFbGVtZW50cyA9IHRoaXMuX2xpc3RPZkxpc3RzLmdldEZyb21JdGVyYXRvcihmaXJzdExpc3RJdGVyYXRvcik7XHJcbiAgICAgICAgZmlyc3RJbnRlcm5hbEl0ZXJhdG9yID0gZmlyc3RIYXNoRWxlbWVudHMubGlzdC5nZXRGaXJzdEl0ZXJhdG9yKCk7XHJcbiAgICB9XHJcbiAgICBpZiAoZmlyc3RJbnRlcm5hbEl0ZXJhdG9yID09PSBudWxsKSB7XHJcbiAgICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHJldHVybiB7XHJcbiAgICAgICAgX2hhc2hFbGVtZW50czogZmlyc3RIYXNoRWxlbWVudHMsXHJcbiAgICAgICAgX2ludGVybmFsSXRlcmF0b3I6IGZpcnN0SW50ZXJuYWxJdGVyYXRvclxyXG4gICAgfTtcclxufTtcclxuXHJcbkhhc2hNYXAucHJvdG90eXBlLmdldE5leHRJdGVyYXRvciA9IGZ1bmN0aW9uIGdldE5leHRJdGVyYXRvcihpdGVyYXRvcikge1xyXG4gICAgdmFyIG5leHRJdGVyYXRvciA9IHtcclxuICAgICAgICBfaGFzaEVsZW1lbnRzOiBpdGVyYXRvci5faGFzaEVsZW1lbnRzLFxyXG4gICAgICAgIF9pbnRlcm5hbEl0ZXJhdG9yOiBpdGVyYXRvci5faGFzaEVsZW1lbnRzLmxpc3QuZ2V0TmV4dEl0ZXJhdG9yKFxyXG4gICAgICAgICAgICBpdGVyYXRvci5faW50ZXJuYWxJdGVyYXRvcilcclxuICAgIH07XHJcbiAgICBcclxuICAgIHdoaWxlIChuZXh0SXRlcmF0b3IuX2ludGVybmFsSXRlcmF0b3IgPT09IG51bGwpIHtcclxuICAgICAgICB2YXIgbmV4dExpc3RPZkxpc3RzSXRlcmF0b3IgPSB0aGlzLl9saXN0T2ZMaXN0cy5nZXROZXh0SXRlcmF0b3IoXHJcbiAgICAgICAgICAgIGl0ZXJhdG9yLl9oYXNoRWxlbWVudHMubGlzdE9mTGlzdHNJdGVyYXRvcik7XHJcbiAgICAgICAgaWYgKG5leHRMaXN0T2ZMaXN0c0l0ZXJhdG9yID09PSBudWxsKSB7XHJcbiAgICAgICAgICAgIHJldHVybiBudWxsO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBuZXh0SXRlcmF0b3IuX2hhc2hFbGVtZW50cyA9IHRoaXMuX2xpc3RPZkxpc3RzLmdldEZyb21JdGVyYXRvcihcclxuICAgICAgICAgICAgbmV4dExpc3RPZkxpc3RzSXRlcmF0b3IpO1xyXG4gICAgICAgIG5leHRJdGVyYXRvci5faW50ZXJuYWxJdGVyYXRvciA9XHJcbiAgICAgICAgICAgIG5leHRJdGVyYXRvci5faGFzaEVsZW1lbnRzLmxpc3QuZ2V0Rmlyc3RJdGVyYXRvcigpO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIG5leHRJdGVyYXRvcjtcclxufTtcclxuXHJcbnJldHVybiBIYXNoTWFwO1xyXG59KSgpO1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBIYXNoTWFwOyIsIid1c2Ugc3RyaWN0JztcclxuXHJcbnZhciBIYXNoTWFwID0gcmVxdWlyZSgnaGFzaC1tYXAnKTtcclxuXHJcbnZhciBKc0J1aWx0aW5IYXNoTWFwID0gKGZ1bmN0aW9uIEhhc2hNYXBDbG9zdXJlKCkge1xyXG4gICAgXHJcbi8vIFRoaXMgY2xhc3MgZXhwb3NlIHNhbWUgQVBJIGFzIEhhc2hNYXAgYnV0IG5vdCByZXF1aXJpbmcgZ2V0SGFzaENvZGUoKSBhbmQgaXNFcXVhbCgpIGZ1bmN0aW9ucy5cclxuLy8gVGhhdCB3YXkgaXQncyBlYXN5IHRvIHN3aXRjaCBiZXR3ZWVuIGltcGxlbWVudGF0aW9ucy5cclxuXHJcbnZhciBzaW1wbGVIYXNoZXIgPSB7XHJcbiAgICAnZ2V0SGFzaENvZGUnOiBmdW5jdGlvbiBnZXRIYXNoQ29kZShrZXkpIHtcclxuICAgICAgICByZXR1cm4ga2V5O1xyXG4gICAgfSxcclxuICAgIFxyXG4gICAgJ2lzRXF1YWwnOiBmdW5jdGlvbiBpc0VxdWFsKGtleTEsIGtleTIpIHtcclxuICAgICAgICByZXR1cm4ga2V5MSA9PT0ga2V5MjtcclxuICAgIH1cclxufTtcclxuXHJcbmZ1bmN0aW9uIEpzQnVpbHRpbkhhc2hNYXAoKSB7XHJcbiAgICBIYXNoTWFwLmNhbGwodGhpcywgLypoYXNoZXI9Ki9zaW1wbGVIYXNoZXIpO1xyXG59XHJcblxyXG5Kc0J1aWx0aW5IYXNoTWFwLnByb3RvdHlwZSA9IE9iamVjdC5jcmVhdGUoSGFzaE1hcC5wcm90b3R5cGUpO1xyXG5cclxucmV0dXJuIEpzQnVpbHRpbkhhc2hNYXA7XHJcbn0pKCk7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IEpzQnVpbHRpbkhhc2hNYXA7IiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxudmFyIExpbmtlZExpc3QgPSAoZnVuY3Rpb24gTGlua2VkTGlzdENsb3N1cmUoKSB7XHJcblxyXG5mdW5jdGlvbiBMaW5rZWRMaXN0KCkge1xyXG4gICAgdGhpcy5jbGVhcigpO1xyXG59XHJcblxyXG5MaW5rZWRMaXN0LnByb3RvdHlwZS5jbGVhciA9IGZ1bmN0aW9uIGNsZWFyKCkge1xyXG4gICAgdGhpcy5fZmlyc3QgPSB7IF9wcmV2OiBudWxsLCBfcGFyZW50OiB0aGlzIH07XHJcbiAgICB0aGlzLl9sYXN0ID0geyBfbmV4dDogbnVsbCwgX3BhcmVudDogdGhpcyB9O1xyXG4gICAgdGhpcy5fY291bnQgPSAwO1xyXG4gICAgXHJcbiAgICB0aGlzLl9sYXN0Ll9wcmV2ID0gdGhpcy5fZmlyc3Q7XHJcbiAgICB0aGlzLl9maXJzdC5fbmV4dCA9IHRoaXMuX2xhc3Q7XHJcbn07XHJcblxyXG5MaW5rZWRMaXN0LnByb3RvdHlwZS5hZGQgPSBmdW5jdGlvbiBhZGQodmFsdWUsIGFkZEJlZm9yZSkge1xyXG4gICAgaWYgKGFkZEJlZm9yZSA9PT0gbnVsbCB8fCBhZGRCZWZvcmUgPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIGFkZEJlZm9yZSA9IHRoaXMuX2xhc3Q7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHRoaXMuX3ZhbGlkYXRlSXRlcmF0b3JPZlRoaXMoYWRkQmVmb3JlKTtcclxuICAgIFxyXG4gICAgKyt0aGlzLl9jb3VudDtcclxuICAgIFxyXG4gICAgdmFyIG5ld05vZGUgPSB7XHJcbiAgICAgICAgX3ZhbHVlOiB2YWx1ZSxcclxuICAgICAgICBfbmV4dDogYWRkQmVmb3JlLFxyXG4gICAgICAgIF9wcmV2OiBhZGRCZWZvcmUuX3ByZXYsXHJcbiAgICAgICAgX3BhcmVudDogdGhpc1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgbmV3Tm9kZS5fcHJldi5fbmV4dCA9IG5ld05vZGU7XHJcbiAgICBhZGRCZWZvcmUuX3ByZXYgPSBuZXdOb2RlO1xyXG4gICAgXHJcbiAgICByZXR1cm4gbmV3Tm9kZTtcclxufTtcclxuXHJcbkxpbmtlZExpc3QucHJvdG90eXBlLnJlbW92ZSA9IGZ1bmN0aW9uIHJlbW92ZShpdGVyYXRvcikge1xyXG4gICAgdGhpcy5fdmFsaWRhdGVJdGVyYXRvck9mVGhpcyhpdGVyYXRvcik7XHJcbiAgICBcclxuICAgIC0tdGhpcy5fY291bnQ7XHJcbiAgICBcclxuICAgIGl0ZXJhdG9yLl9wcmV2Ll9uZXh0ID0gaXRlcmF0b3IuX25leHQ7XHJcbiAgICBpdGVyYXRvci5fbmV4dC5fcHJldiA9IGl0ZXJhdG9yLl9wcmV2O1xyXG4gICAgaXRlcmF0b3IuX3BhcmVudCA9IG51bGw7XHJcbn07XHJcblxyXG5MaW5rZWRMaXN0LnByb3RvdHlwZS5nZXRGcm9tSXRlcmF0b3IgPSBmdW5jdGlvbiBnZXRGcm9tSXRlcmF0b3IoaXRlcmF0b3IpIHtcclxuICAgIHRoaXMuX3ZhbGlkYXRlSXRlcmF0b3JPZlRoaXMoaXRlcmF0b3IpO1xyXG4gICAgXHJcbiAgICByZXR1cm4gaXRlcmF0b3IuX3ZhbHVlO1xyXG59O1xyXG5cclxuTGlua2VkTGlzdC5wcm90b3R5cGUuZ2V0Rmlyc3RJdGVyYXRvciA9IGZ1bmN0aW9uIGdldEZpcnN0SXRlcmF0b3IoKSB7XHJcbiAgICB2YXIgaXRlcmF0b3IgPSB0aGlzLmdldE5leHRJdGVyYXRvcih0aGlzLl9maXJzdCk7XHJcbiAgICByZXR1cm4gaXRlcmF0b3I7XHJcbn07XHJcblxyXG5MaW5rZWRMaXN0LnByb3RvdHlwZS5nZXRMYXN0SXRlcmF0b3IgPSBmdW5jdGlvbiBnZXRGaXJzdEl0ZXJhdG9yKCkge1xyXG4gICAgdmFyIGl0ZXJhdG9yID0gdGhpcy5nZXRQcmV2SXRlcmF0b3IodGhpcy5fbGFzdCk7XHJcbiAgICByZXR1cm4gaXRlcmF0b3I7XHJcbn07XHJcblxyXG5MaW5rZWRMaXN0LnByb3RvdHlwZS5nZXROZXh0SXRlcmF0b3IgPSBmdW5jdGlvbiBnZXROZXh0SXRlcmF0b3IoaXRlcmF0b3IpIHtcclxuICAgIHRoaXMuX3ZhbGlkYXRlSXRlcmF0b3JPZlRoaXMoaXRlcmF0b3IpO1xyXG5cclxuICAgIGlmIChpdGVyYXRvci5fbmV4dCA9PT0gdGhpcy5fbGFzdCkge1xyXG4gICAgICAgIHJldHVybiBudWxsO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICByZXR1cm4gaXRlcmF0b3IuX25leHQ7XHJcbn07XHJcblxyXG5MaW5rZWRMaXN0LnByb3RvdHlwZS5nZXRQcmV2SXRlcmF0b3IgPSBmdW5jdGlvbiBnZXRQcmV2SXRlcmF0b3IoaXRlcmF0b3IpIHtcclxuICAgIHRoaXMuX3ZhbGlkYXRlSXRlcmF0b3JPZlRoaXMoaXRlcmF0b3IpO1xyXG5cclxuICAgIGlmIChpdGVyYXRvci5fcHJldiA9PT0gdGhpcy5fZmlyc3QpIHtcclxuICAgICAgICByZXR1cm4gbnVsbDtcclxuICAgIH1cclxuICAgIFxyXG4gICAgcmV0dXJuIGl0ZXJhdG9yLl9wcmV2O1xyXG59O1xyXG5cclxuTGlua2VkTGlzdC5wcm90b3R5cGUuZ2V0Q291bnQgPSBmdW5jdGlvbiBnZXRDb3VudCgpIHtcclxuICAgIHJldHVybiB0aGlzLl9jb3VudDtcclxufTtcclxuXHJcbkxpbmtlZExpc3QucHJvdG90eXBlLl92YWxpZGF0ZUl0ZXJhdG9yT2ZUaGlzID1cclxuICAgIGZ1bmN0aW9uIHZhbGlkYXRlSXRlcmF0b3JPZlRoaXMoaXRlcmF0b3IpIHtcclxuICAgIFxyXG4gICAgaWYgKGl0ZXJhdG9yLl9wYXJlbnQgIT09IHRoaXMpIHtcclxuICAgICAgICB0aHJvdyAnaXRlcmF0b3IgbXVzdCBiZSBvZiB0aGUgY3VycmVudCBMaW5rZWRMaXN0JztcclxuICAgIH1cclxufTtcclxuXHJcbnJldHVybiBMaW5rZWRMaXN0O1xyXG59KSgpO1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBMaW5rZWRMaXN0OyIsIid1c2Ugc3RyaWN0JztcclxuXHJcbnZhciBEZXBlbmRlbmN5V29ya2VycyA9IHJlcXVpcmUoJ2RlcGVuZGVuY3ktd29ya2VycycpO1xyXG5cclxudmFyIFNjaGVkdWxlckRlcGVuZGVuY3lXb3JrZXJzID0gKGZ1bmN0aW9uIFNjaGVkdWxlckRlcGVuZGVuY3lXb3JrZXJzQ2xvc3VyZSgpIHtcclxuICAgIGZ1bmN0aW9uIFNjaGVkdWxlckRlcGVuZGVuY3lXb3JrZXJzKHNjaGVkdWxlciwgaW5wdXRSZXRyZWl2ZXIpIHtcclxuICAgICAgICB2YXIgdGhhdCA9IHRoaXM7XHJcbiAgICAgICAgRGVwZW5kZW5jeVdvcmtlcnMuY2FsbCh0aGlzLCBpbnB1dFJldHJlaXZlcik7XHJcbiAgICAgICAgdGhhdC5fc2NoZWR1bGVyID0gc2NoZWR1bGVyO1xyXG4gICAgICAgIHRoYXQuX2lzRGlzYWJsZVdvcmtlckNhY2hlID0gW107XHJcbiAgICAgICAgdGhhdC5faW5wdXRSZXRyZWl2ZXIgPSBpbnB1dFJldHJlaXZlcjtcclxuICAgIH1cclxuICAgIFxyXG4gICAgU2NoZWR1bGVyRGVwZW5kZW5jeVdvcmtlcnMucHJvdG90eXBlID0gT2JqZWN0LmNyZWF0ZShEZXBlbmRlbmN5V29ya2Vycy5wcm90b3R5cGUpO1xyXG4gICAgXHJcbiAgICBTY2hlZHVsZXJEZXBlbmRlbmN5V29ya2Vycy5wcm90b3R5cGUuaW5pdGlhbGl6aW5nVGFzayA9IGZ1bmN0aW9uIGluaXRpYWxpemluZ1Rhc2sodGFza0FwaSwgc2NoZWR1bGVOb3RpZmllcikge1xyXG4gICAgICAgIHZhciB0aGF0ID0gdGhpcztcclxuICAgICAgICB0YXNrQXBpLm9uKCdkZXBlbmRlbmN5VGFza0N1c3RvbScsIGZ1bmN0aW9uKGN1c3RvbUV2ZW50TmFtZSwgZGVwZW5kZW5jeVRhc2tLZXkpIHtcclxuICAgICAgICAgICAgaWYgKGN1c3RvbUV2ZW50TmFtZSAhPT0gJ2Fib3J0aW5nJykge1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBpZiAoIXRoYXQuX3NjaGVkdWxlci5zaG91bGRBYm9ydChzY2hlZHVsZU5vdGlmaWVyKSkge1xyXG4gICAgICAgICAgICAgICAgdGhyb3cgJ1Rhc2sgJyArIGRlcGVuZGVuY3lUYXNrS2V5ICsgJyBhYm9ydGVkIGJ1dCBhIHRhc2sgZGVwZW5kcyAnICtcclxuICAgICAgICAgICAgICAgICAgICAnb24gaXQgZGlkblxcJ3QuIENoZWNrIHNjaGVkdWxlciBjb25zaXN0ZW5jeSc7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHNjaGVkdWxlTm90aWZpZXIuYWJvcnQoLyphYm9ydEJ5U2NoZWR1bGVyPSovZmFsc2UpO1xyXG4gICAgICAgIH0pO1xyXG4gICAgfTtcclxuXHJcbiAgICBTY2hlZHVsZXJEZXBlbmRlbmN5V29ya2Vycy5wcm90b3R5cGUud2FpdEZvclNjaGVkdWxlID0gZnVuY3Rpb24gd2FpdEZvclNjaGVkdWxlKHNjaGVkdWxlTm90aWZpZXIsIHdvcmtlclR5cGUpIHtcclxuICAgICAgICBpZiAodGhpcy5faXNEaXNhYmxlV29ya2VyQ2FjaGVbd29ya2VyVHlwZV0gPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgICAgICB0aGlzLl9pc0Rpc2FibGVXb3JrZXJDYWNoZVt3b3JrZXJUeXBlXSA9IHRoaXMuX2lucHV0UmV0cmVpdmVyLmdldFdvcmtlclR5cGVPcHRpb25zKHdvcmtlclR5cGUpID09PSBudWxsO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBpZiAodGhpcy5faXNEaXNhYmxlV29ya2VyQ2FjaGVbd29ya2VyVHlwZV0pIHtcclxuICAgICAgICAgICAgRGVwZW5kZW5jeVdvcmtlcnMucHJvdG90eXBlLndhaXRGb3JTY2hlZHVsZS5jYWxsKHRoaXMsIHNjaGVkdWxlTm90aWZpZXIpO1xyXG4gICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICB2YXIgaXNGaW5pc2hlZCA9IGZhbHNlO1xyXG4gICAgICAgIHZhciBqb2JDYWxsYmFja3MgPSBudWxsO1xyXG4gICAgICAgIHZhciB0aGF0ID0gdGhpcztcclxuXHJcbiAgICAgICAgdGhpcy5fc2NoZWR1bGVyLmVucXVldWVKb2IoXHJcbiAgICAgICAgICAgIGZ1bmN0aW9uIG9uU2NoZWR1bGVkKHJlc291cmNlLCBqb2JDb250ZXh0LCBqb2JDYWxsYmFja3NfKSB7XHJcbiAgICAgICAgICAgICAgICBpZiAoam9iQ29udGV4dCAhPT0gc2NoZWR1bGVOb3RpZmllcikge1xyXG4gICAgICAgICAgICAgICAgICAgIHRocm93ICdkZXBlbmRlbmN5V29ya2VyczogV3Jvbmcgam9iQ29udGV4dCAtIHNlZW1zIGludGVybmFsIGVycm9yIGluIHJlc291cmNlLXNjaGVkdWxlci5qcyc7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIGlmIChpc0ZpbmlzaGVkKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhyb3cgJ2RlcGVuZGVuY3lXb3JrZXJzOiBzY2hlZHVsZWQgYWZ0ZXIgZmluaXNoJztcclxuICAgICAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgICAgICBpZiAoam9iQ2FsbGJhY2tzICE9PSBudWxsKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhyb3cgJ2RlcGVuZGVuY3lXb3JrZXJzOiBTY2hlZHVsZWQgdHdpY2UnO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICBqb2JDYWxsYmFja3MgPSBqb2JDYWxsYmFja3NfO1xyXG4gICAgICAgICAgICAgICAgc2NoZWR1bGVOb3RpZmllci5zY2hlZHVsZShqb2JDYWxsYmFja3MpO1xyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAvKmpvYkNvbnRleHQ9Ki9zY2hlZHVsZU5vdGlmaWVyLFxyXG4gICAgICAgICAgICBmdW5jdGlvbiBvbkFib3J0ZWQoKSB7XHJcbiAgICAgICAgICAgICAgICBpZiAoaXNGaW5pc2hlZCkge1xyXG4gICAgICAgICAgICAgICAgICAgIHRocm93ICdkZXBlbmRlbmN5V29ya2VyczogYWJvcnQgYWZ0ZXIgZmluaXNoJztcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgaWYgKGpvYkNhbGxiYWNrcyAhPT0gbnVsbCkge1xyXG4gICAgICAgICAgICAgICAgICAgIHRocm93ICdkZXBlbmRlbmN5V29ya2VyczogYWJvcnQgYWZ0ZXIgc2NoZWR1bGVkJztcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgam9iQ2FsbGJhY2tzID0gbnVsbDtcclxuICAgICAgICAgICAgICAgIGlzRmluaXNoZWQgPSB0cnVlO1xyXG4gICAgICAgICAgICAgICAgc2NoZWR1bGVOb3RpZmllci5hYm9ydCgvKmFib3J0QnlTY2hlZHVsZXI9Ki90cnVlKTtcclxuICAgICAgICAgICAgfSk7XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICByZXR1cm4gU2NoZWR1bGVyRGVwZW5kZW5jeVdvcmtlcnM7XHJcbn0pKCk7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IFNjaGVkdWxlckRlcGVuZGVuY3lXb3JrZXJzOyIsIid1c2Ugc3RyaWN0JztcclxuXHJcbnZhciBXcmFwcGVySW5wdXRSZXRyZWl2ZXJCYXNlID0gKGZ1bmN0aW9uIFdyYXBwZXJJbnB1dFJldHJlaXZlckJhc2VDbG9zdXJlKCkge1xyXG4gICAgZnVuY3Rpb24gV3JhcHBlcklucHV0UmV0cmVpdmVyQmFzZShpbnB1dFJldHJlaXZlcikge1xyXG4gICAgICAgIGlmICghaW5wdXRSZXRyZWl2ZXIuZ2V0S2V5QXNTdHJpbmcpIHtcclxuICAgICAgICAgICAgdGhyb3cgJ2RlcGVuZGVuY3lXb3JrZXJzOiBObyAnICtcclxuICAgICAgICAgICAgICAgICdpbnB1dFJldHJlaXZlci5nZXRLZXlBc1N0cmluZygpIG1ldGhvZCc7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGlmICghaW5wdXRSZXRyZWl2ZXIuZ2V0V29ya2VyVHlwZU9wdGlvbnMpIHtcclxuICAgICAgICAgICAgdGhyb3cgJ2RlcGVuZGVuY3lXb3JrZXJzOiBObyAnICtcclxuICAgICAgICAgICAgICAgICdpbnB1dFJldHJlaXZlci5nZXRUYXNrVHlwZU9wdGlvbnMoKSBtZXRob2QnO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgdmFyIHRoYXQgPSB0aGlzO1xyXG4gICAgICAgIHRoYXQuX2lucHV0UmV0cmVpdmVyID0gaW5wdXRSZXRyZWl2ZXI7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIFdyYXBwZXJJbnB1dFJldHJlaXZlckJhc2UucHJvdG90eXBlLnRhc2tTdGFydGVkID1cclxuICAgICAgICAgICAgZnVuY3Rpb24gdGFza1N0YXJ0ZWQodGFzaykge1xyXG4gICAgICAgIFxyXG4gICAgICAgIHRocm93ICdkZXBlbmRlbmN5V29ya2VyczogTm90IGltcGxlbWVudGVkIHRhc2tTdGFydGVkKCknO1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgV3JhcHBlcklucHV0UmV0cmVpdmVyQmFzZS5wcm90b3R5cGUuZ2V0S2V5QXNTdHJpbmcgPSBmdW5jdGlvbihrZXkpIHtcclxuICAgICAgICByZXR1cm4gdGhpcy5faW5wdXRSZXRyZWl2ZXIuZ2V0S2V5QXNTdHJpbmcoa2V5KTtcclxuICAgIH07XHJcbiAgICBcclxuICAgIFxyXG4gICAgV3JhcHBlcklucHV0UmV0cmVpdmVyQmFzZS5wcm90b3R5cGUuZ2V0V29ya2VyVHlwZU9wdGlvbnMgPSBmdW5jdGlvbih0YXNrVHlwZSkge1xyXG4gICAgICAgIHJldHVybiB0aGlzLl9pbnB1dFJldHJlaXZlci5nZXRXb3JrZXJUeXBlT3B0aW9ucyh0YXNrVHlwZSk7XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICByZXR1cm4gV3JhcHBlcklucHV0UmV0cmVpdmVyQmFzZTtcclxufSkoKTtcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gV3JhcHBlcklucHV0UmV0cmVpdmVyQmFzZTsiXX0=
