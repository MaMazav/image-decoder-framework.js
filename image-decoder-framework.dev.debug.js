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
        
        var job = tryDequeueNewJobWithHigherPriority(self, minPriority);

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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJzcmMvbGlmby1zY2hlZHVsZXIuanMiLCJzcmMvbGlua2VkLWxpc3QuanMiLCJzcmMvcHJpb3JpdHktc2NoZWR1bGVyLmpzIiwic3JjL3Jlc291cmNlLXNjaGVkdWxlci1leHBvcnRzLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBO0FDQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDNURBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ25HQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3psQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQSIsImZpbGUiOiJnZW5lcmF0ZWQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlc0NvbnRlbnQiOlsiKGZ1bmN0aW9uIGUodCxuLHIpe2Z1bmN0aW9uIHMobyx1KXtpZighbltvXSl7aWYoIXRbb10pe3ZhciBhPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7aWYoIXUmJmEpcmV0dXJuIGEobywhMCk7aWYoaSlyZXR1cm4gaShvLCEwKTt2YXIgZj1uZXcgRXJyb3IoXCJDYW5ub3QgZmluZCBtb2R1bGUgJ1wiK28rXCInXCIpO3Rocm93IGYuY29kZT1cIk1PRFVMRV9OT1RfRk9VTkRcIixmfXZhciBsPW5bb109e2V4cG9ydHM6e319O3Rbb11bMF0uY2FsbChsLmV4cG9ydHMsZnVuY3Rpb24oZSl7dmFyIG49dFtvXVsxXVtlXTtyZXR1cm4gcyhuP246ZSl9LGwsbC5leHBvcnRzLGUsdCxuLHIpfXJldHVybiBuW29dLmV4cG9ydHN9dmFyIGk9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtmb3IodmFyIG89MDtvPHIubGVuZ3RoO28rKylzKHJbb10pO3JldHVybiBzfSkiLCIndXNlIHN0cmljdCc7XHJcblxyXG52YXIgTGlmb1NjaGVkdWxlciA9IChmdW5jdGlvbiBMaWZvU2NoZWR1bGVyQ2xvc3VyZSgpIHtcclxuICAgIGZ1bmN0aW9uIExpZm9TY2hlZHVsZXIoY3JlYXRlUmVzb3VyY2UsIGpvYnNMaW1pdCkge1xyXG4gICAgICAgIHRoaXMuX3Jlc291cmNlQ3JlYXRvciA9IGNyZWF0ZVJlc291cmNlO1xyXG4gICAgICAgIHRoaXMuX2pvYnNMaW1pdCA9IGpvYnNMaW1pdDtcclxuICAgICAgICB0aGlzLl9mcmVlUmVzb3VyY2VzQ291bnQgPSB0aGlzLl9qb2JzTGltaXQ7XHJcbiAgICAgICAgdGhpcy5fZnJlZVJlc291cmNlcyA9IG5ldyBBcnJheSh0aGlzLl9qb2JzTGltaXQpO1xyXG4gICAgICAgIHRoaXMuX3BlbmRpbmdKb2JzID0gW107XHJcbiAgICB9XHJcbiAgICBcclxuICAgIExpZm9TY2hlZHVsZXIucHJvdG90eXBlLmVucXVldWVKb2IgPSBmdW5jdGlvbiBlbnF1ZXVlSm9iKGpvYkZ1bmMsIGpvYkNvbnRleHQpIHtcclxuXHRcdGlmICh0aGlzLl9mcmVlUmVzb3VyY2VzQ291bnQgPiAwKSB7XHJcblx0XHRcdC0tdGhpcy5fZnJlZVJlc291cmNlc0NvdW50O1xyXG5cdFx0XHRcclxuXHRcdFx0dmFyIHJlc291cmNlID0gdGhpcy5fZnJlZVJlc291cmNlcy5wb3AoKTtcclxuXHRcdFx0aWYgKHJlc291cmNlID09PSB1bmRlZmluZWQpIHtcclxuXHRcdFx0XHRyZXNvdXJjZSA9IHRoaXMuX3Jlc291cmNlQ3JlYXRvcigpO1xyXG5cdFx0XHR9XHJcblx0XHRcdFxyXG5cdFx0XHR0aGlzLl9zY2hlZHVsZShqb2JGdW5jLCByZXNvdXJjZSwgam9iQ29udGV4dCk7XHJcblx0XHR9IGVsc2Uge1xyXG5cdFx0XHR0aGlzLl9wZW5kaW5nSm9icy5wdXNoKHtcclxuXHRcdFx0XHRqb2JGdW5jOiBqb2JGdW5jLFxyXG5cdFx0XHRcdGpvYkNvbnRleHQ6IGpvYkNvbnRleHRcclxuXHRcdFx0XHR9KTtcclxuXHRcdH1cclxuXHR9O1xyXG5cdFxyXG5cdExpZm9TY2hlZHVsZXIucHJvdG90eXBlLl9zY2hlZHVsZSA9IGZ1bmN0aW9uIHNjaGVkdWxlKGpvYkZ1bmMsIHJlc291cmNlLCBqb2JDb250ZXh0KSB7XHJcblx0XHR2YXIgY2FsbGJhY2tzID0gbmV3IExpZm9TY2hlZHVsZXJDYWxsYmFja3ModGhpcywgcmVzb3VyY2UpO1xyXG5cdFx0am9iRnVuYyhyZXNvdXJjZSwgam9iQ29udGV4dCwgY2FsbGJhY2tzKTtcclxuXHR9O1xyXG5cdFxyXG5cdGZ1bmN0aW9uIExpZm9TY2hlZHVsZXJDYWxsYmFja3Moc2NoZWR1bGVyLCByZXNvdXJjZSkge1xyXG5cdFx0dGhpcy5fc2NoZWR1bGVyID0gc2NoZWR1bGVyO1xyXG5cdFx0dGhpcy5fcmVzb3VyY2UgPSByZXNvdXJjZTtcclxuXHR9XHJcblx0XHJcblx0TGlmb1NjaGVkdWxlckNhbGxiYWNrcy5wcm90b3R5cGUuam9iRG9uZSA9IGZ1bmN0aW9uIGpvYkRvbmUoKSB7XHJcblx0XHRpZiAodGhpcy5fc2NoZWR1bGVyLl9wZW5kaW5nSm9icy5sZW5ndGggPiAwKSB7XHJcblx0XHRcdHZhciBuZXh0Sm9iID0gdGhpcy5fc2NoZWR1bGVyLl9wZW5kaW5nSm9icy5wb3AoKTtcclxuXHRcdFx0dGhpcy5fc2NoZWR1bGVyLl9zY2hlZHVsZShuZXh0Sm9iLmpvYkZ1bmMsIHRoaXMuX3Jlc291cmNlLCBuZXh0Sm9iLmpvYkNvbnRleHQpO1xyXG5cdFx0fSBlbHNlIHtcclxuXHRcdFx0dGhpcy5fc2NoZWR1bGVyLl9mcmVlUmVzb3VyY2VzLnB1c2godGhpcy5fcmVzb3VyY2UpO1xyXG5cdFx0XHQrK3RoaXMuX3NjaGVkdWxlci5fZnJlZVJlc291cmNlc0NvdW50O1xyXG5cdFx0fVxyXG5cdH07XHJcblx0XHJcblx0TGlmb1NjaGVkdWxlckNhbGxiYWNrcy5wcm90b3R5cGUuc2hvdWxkWWllbGRPckFib3J0ID0gZnVuY3Rpb24gc2hvdWxkWWllbGRPckFib3J0KCkge1xyXG5cdFx0cmV0dXJuIGZhbHNlO1xyXG5cdH07XHJcblx0XHJcblx0TGlmb1NjaGVkdWxlckNhbGxiYWNrcy5wcm90b3R5cGUudHJ5WWllbGQgPSBmdW5jdGlvbiB0cnlZaWVsZCgpIHtcclxuXHRcdHJldHVybiBmYWxzZTtcclxuXHR9O1xyXG4gICAgXHJcbiAgICByZXR1cm4gTGlmb1NjaGVkdWxlcjtcclxufSkoKTtcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gTGlmb1NjaGVkdWxlcjsiLCIndXNlIHN0cmljdCc7XHJcblxyXG52YXIgTGlua2VkTGlzdCA9IChmdW5jdGlvbiBMaW5rZWRMaXN0Q2xvc3VyZSgpIHtcclxuICAgIGZ1bmN0aW9uIExpbmtlZExpc3QoKSB7XHJcblx0XHR0aGlzLmNsZWFyKCk7XHJcblx0fVxyXG5cdFxyXG5cdExpbmtlZExpc3QucHJvdG90eXBlLmNsZWFyID0gZnVuY3Rpb24gY2xlYXIoKSB7XHJcbiAgICAgICAgdGhpcy5fZmlyc3QgPSB7IF9wcmV2OiBudWxsLCBfcGFyZW50OiB0aGlzIH07XHJcbiAgICAgICAgdGhpcy5fbGFzdCA9IHsgX25leHQ6IG51bGwsIF9wYXJlbnQ6IHRoaXMgfTtcclxuICAgICAgICB0aGlzLl9jb3VudCA9IDA7XHJcbiAgICAgICAgXHJcbiAgICAgICAgdGhpcy5fbGFzdC5fcHJldiA9IHRoaXMuX2ZpcnN0O1xyXG4gICAgICAgIHRoaXMuX2ZpcnN0Ll9uZXh0ID0gdGhpcy5fbGFzdDtcclxuICAgIH07XHJcbiAgICBcclxuICAgIExpbmtlZExpc3QucHJvdG90eXBlLmFkZCA9IGZ1bmN0aW9uIGFkZCh2YWx1ZSwgYWRkQmVmb3JlKSB7XHJcbiAgICAgICAgaWYgKGFkZEJlZm9yZSA9PT0gbnVsbCB8fCBhZGRCZWZvcmUgPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgICAgICBhZGRCZWZvcmUgPSB0aGlzLl9sYXN0O1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICB0aGlzLl92YWxpZGF0ZUl0ZXJhdG9yT2ZUaGlzKGFkZEJlZm9yZSk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgKyt0aGlzLl9jb3VudDtcclxuICAgICAgICBcclxuICAgICAgICB2YXIgbmV3Tm9kZSA9IHtcclxuICAgICAgICAgICAgX3ZhbHVlOiB2YWx1ZSxcclxuICAgICAgICAgICAgX25leHQ6IGFkZEJlZm9yZSxcclxuICAgICAgICAgICAgX3ByZXY6IGFkZEJlZm9yZS5fcHJldixcclxuICAgICAgICAgICAgX3BhcmVudDogdGhpc1xyXG4gICAgICAgIH07XHJcbiAgICAgICAgXHJcbiAgICAgICAgbmV3Tm9kZS5fcHJldi5fbmV4dCA9IG5ld05vZGU7XHJcbiAgICAgICAgYWRkQmVmb3JlLl9wcmV2ID0gbmV3Tm9kZTtcclxuICAgICAgICBcclxuICAgICAgICByZXR1cm4gbmV3Tm9kZTtcclxuICAgIH07XHJcbiAgICBcclxuICAgIExpbmtlZExpc3QucHJvdG90eXBlLnJlbW92ZSA9IGZ1bmN0aW9uIHJlbW92ZShpdGVyYXRvcikge1xyXG4gICAgICAgIHRoaXMuX3ZhbGlkYXRlSXRlcmF0b3JPZlRoaXMoaXRlcmF0b3IpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC0tdGhpcy5fY291bnQ7XHJcbiAgICAgICAgXHJcbiAgICAgICAgaXRlcmF0b3IuX3ByZXYuX25leHQgPSBpdGVyYXRvci5fbmV4dDtcclxuICAgICAgICBpdGVyYXRvci5fbmV4dC5fcHJldiA9IGl0ZXJhdG9yLl9wcmV2O1xyXG4gICAgICAgIGl0ZXJhdG9yLl9wYXJlbnQgPSBudWxsO1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgTGlua2VkTGlzdC5wcm90b3R5cGUuZ2V0RnJvbUl0ZXJhdG9yID0gZnVuY3Rpb24gZ2V0RnJvbUl0ZXJhdG9yKGl0ZXJhdG9yKSB7XHJcbiAgICAgICAgdGhpcy5fdmFsaWRhdGVJdGVyYXRvck9mVGhpcyhpdGVyYXRvcik7XHJcbiAgICAgICAgXHJcbiAgICAgICAgcmV0dXJuIGl0ZXJhdG9yLl92YWx1ZTtcclxuICAgIH07XHJcbiAgICBcclxuICAgIExpbmtlZExpc3QucHJvdG90eXBlLmdldEZpcnN0SXRlcmF0b3IgPSBmdW5jdGlvbiBnZXRGaXJzdEl0ZXJhdG9yKCkge1xyXG4gICAgICAgIHZhciBpdGVyYXRvciA9IHRoaXMuZ2V0TmV4dEl0ZXJhdG9yKHRoaXMuX2ZpcnN0KTtcclxuICAgICAgICByZXR1cm4gaXRlcmF0b3I7XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBMaW5rZWRMaXN0LnByb3RvdHlwZS5nZXRMYXN0SXRlcmF0b3IgPSBmdW5jdGlvbiBnZXRGaXJzdEl0ZXJhdG9yKCkge1xyXG4gICAgICAgIHZhciBpdGVyYXRvciA9IHRoaXMuZ2V0UHJldkl0ZXJhdG9yKHRoaXMuX2xhc3QpO1xyXG4gICAgICAgIHJldHVybiBpdGVyYXRvcjtcclxuICAgIH07XHJcbiAgICBcclxuICAgIExpbmtlZExpc3QucHJvdG90eXBlLmdldE5leHRJdGVyYXRvciA9IGZ1bmN0aW9uIGdldE5leHRJdGVyYXRvcihpdGVyYXRvcikge1xyXG4gICAgICAgIHRoaXMuX3ZhbGlkYXRlSXRlcmF0b3JPZlRoaXMoaXRlcmF0b3IpO1xyXG5cclxuICAgICAgICBpZiAoaXRlcmF0b3IuX25leHQgPT09IHRoaXMuX2xhc3QpIHtcclxuICAgICAgICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHJldHVybiBpdGVyYXRvci5fbmV4dDtcclxuICAgIH07XHJcbiAgICBcclxuICAgIExpbmtlZExpc3QucHJvdG90eXBlLmdldFByZXZJdGVyYXRvciA9IGZ1bmN0aW9uIGdldFByZXZJdGVyYXRvcihpdGVyYXRvcikge1xyXG4gICAgICAgIHRoaXMuX3ZhbGlkYXRlSXRlcmF0b3JPZlRoaXMoaXRlcmF0b3IpO1xyXG5cclxuICAgICAgICBpZiAoaXRlcmF0b3IuX3ByZXYgPT09IHRoaXMuX2ZpcnN0KSB7XHJcbiAgICAgICAgICAgIHJldHVybiBudWxsO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICByZXR1cm4gaXRlcmF0b3IuX3ByZXY7XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBMaW5rZWRMaXN0LnByb3RvdHlwZS5nZXRDb3VudCA9IGZ1bmN0aW9uIGdldENvdW50KCkge1xyXG4gICAgICAgIHJldHVybiB0aGlzLl9jb3VudDtcclxuICAgIH07XHJcbiAgICBcclxuICAgIExpbmtlZExpc3QucHJvdG90eXBlLl92YWxpZGF0ZUl0ZXJhdG9yT2ZUaGlzID1cclxuICAgICAgICBmdW5jdGlvbiB2YWxpZGF0ZUl0ZXJhdG9yT2ZUaGlzKGl0ZXJhdG9yKSB7XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKGl0ZXJhdG9yLl9wYXJlbnQgIT09IHRoaXMpIHtcclxuICAgICAgICAgICAgdGhyb3cgJ2l0ZXJhdG9yIG11c3QgYmUgb2YgdGhlIGN1cnJlbnQgTGlua2VkTGlzdCc7XHJcbiAgICAgICAgfVxyXG4gICAgfTtcclxuICAgIFxyXG4gICAgcmV0dXJuIExpbmtlZExpc3Q7XHJcbn0pKCk7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IExpbmtlZExpc3Q7IiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxudmFyIExpbmtlZExpc3QgPSByZXF1aXJlKCdsaW5rZWQtbGlzdCcpO1xyXG5cclxudmFyIFByaW9yaXR5U2NoZWR1bGVyID0gKGZ1bmN0aW9uIFByaW9yaXR5U2NoZWR1bGVyQ2xvc3VyZSgpIHtcclxuICAgIGZ1bmN0aW9uIFByaW9yaXR5U2NoZWR1bGVyKFxyXG4gICAgICAgIGNyZWF0ZVJlc291cmNlLCBqb2JzTGltaXQsIHByaW9yaXRpemVyLCBvcHRpb25zKSB7XHJcbiAgICAgICAgXHJcbiAgICAgICAgb3B0aW9ucyA9IG9wdGlvbnMgfHwge307XHJcbiAgICAgICAgdGhpcy5fcmVzb3VyY2VDcmVhdG9yID0gY3JlYXRlUmVzb3VyY2U7XHJcbiAgICAgICAgdGhpcy5fam9ic0xpbWl0ID0gam9ic0xpbWl0O1xyXG4gICAgICAgIHRoaXMuX3ByaW9yaXRpemVyID0gcHJpb3JpdGl6ZXI7XHJcbiAgICAgICAgXHJcbiAgICAgICAgdGhpcy5fc2hvd0xvZyA9IG9wdGlvbnMuc2hvd0xvZztcclxuICAgICAgICB0aGlzLl9zY2hlZHVsZXJOYW1lID0gb3B0aW9ucy5zY2hlZHVsZXJOYW1lO1xyXG4gICAgICAgIHRoaXMuX251bU5ld0pvYnMgPSBvcHRpb25zLm51bU5ld0pvYnMgfHwgMjA7XHJcbiAgICAgICAgdGhpcy5fbnVtSm9ic0JlZm9yZVJlcmFua09sZFByaW9yaXRpZXMgPVxyXG4gICAgICAgICAgICBvcHRpb25zLm51bUpvYnNCZWZvcmVSZXJhbmtPbGRQcmlvcml0aWVzIHx8IDIwO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICB0aGlzLl9mcmVlUmVzb3VyY2VzQ291bnQgPSB0aGlzLl9qb2JzTGltaXQ7XHJcbiAgICAgICAgdGhpcy5fZnJlZVJlc291cmNlcyA9IG5ldyBBcnJheSh0aGlzLl9qb2JzTGltaXQpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHRoaXMuX3Jlc291cmNlc0d1YXJhbnRlZWRGb3JIaWdoUHJpb3JpdHkgPVxyXG4gICAgICAgICAgICBvcHRpb25zLnJlc291cmNlc0d1YXJhbnRlZWRGb3JIaWdoUHJpb3JpdHkgfHwgMDtcclxuICAgICAgICB0aGlzLl9oaWdoUHJpb3JpdHlUb0d1YXJhbnRlZVJlc291cmNlID1cclxuICAgICAgICAgICAgb3B0aW9ucy5oaWdoUHJpb3JpdHlUb0d1YXJhbnRlZVJlc291cmNlIHx8IDA7XHJcbiAgICAgICAgXHJcbiAgICAgICAgdGhpcy5fbG9nQ2FsbEluZGVudFByZWZpeCA9ICc+JztcclxuICAgICAgICB0aGlzLl9wZW5kaW5nSm9ic0NvdW50ID0gMDtcclxuICAgICAgICB0aGlzLl9vbGRQZW5kaW5nSm9ic0J5UHJpb3JpdHkgPSBbXTtcclxuICAgICAgICB0aGlzLl9uZXdQZW5kaW5nSm9ic0xpbmtlZExpc3QgPSBuZXcgTGlua2VkTGlzdCgpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHRoaXMuX3NjaGVkdWxlc0NvdW50ZXIgPSAwO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBQcmlvcml0eVNjaGVkdWxlci5wcm90b3R5cGUuZW5xdWV1ZUpvYiA9IGZ1bmN0aW9uIGVucXVldWVKb2Ioam9iRnVuYywgam9iQ29udGV4dCwgam9iQWJvcnRlZEZ1bmMpIHtcclxuXHRcdGxvZyh0aGlzLCAnZW5xdWV1ZUpvYigpIHN0YXJ0JywgKzEpO1xyXG5cdFx0dmFyIHByaW9yaXR5ID0gdGhpcy5fcHJpb3JpdGl6ZXIuZ2V0UHJpb3JpdHkoam9iQ29udGV4dCk7XHJcblx0XHRcclxuXHRcdGlmIChwcmlvcml0eSA8IDApIHtcclxuXHRcdFx0am9iQWJvcnRlZEZ1bmMoam9iQ29udGV4dCk7XHJcblx0XHRcdGxvZyh0aGlzLCAnZW5xdWV1ZUpvYigpIGVuZDogam9iIGFib3J0ZWQnLCAtMSk7XHJcblx0XHRcdHJldHVybjtcclxuXHRcdH1cclxuXHRcdFxyXG5cdFx0dmFyIGpvYiA9IHtcclxuXHRcdFx0am9iRnVuYzogam9iRnVuYyxcclxuXHRcdFx0am9iQWJvcnRlZEZ1bmM6IGpvYkFib3J0ZWRGdW5jLFxyXG5cdFx0XHRqb2JDb250ZXh0OiBqb2JDb250ZXh0XHJcblx0XHR9O1xyXG5cdFx0XHJcblx0XHR2YXIgbWluUHJpb3JpdHkgPSBnZXRNaW5pbWFsUHJpb3JpdHlUb1NjaGVkdWxlKHRoaXMpO1xyXG5cdFx0XHJcblx0XHR2YXIgcmVzb3VyY2UgPSBudWxsO1xyXG5cdFx0aWYgKHByaW9yaXR5ID49IG1pblByaW9yaXR5KSB7XHJcblx0XHRcdHJlc291cmNlID0gdHJ5R2V0RnJlZVJlc291cmNlKHRoaXMpO1xyXG5cdFx0fVxyXG5cdFx0XHJcblx0XHRpZiAocmVzb3VyY2UgIT09IG51bGwpIHtcclxuXHRcdFx0c2NoZWR1bGUodGhpcywgam9iLCByZXNvdXJjZSk7XHJcblx0XHRcdGxvZyh0aGlzLCAnZW5xdWV1ZUpvYigpIGVuZDogam9iIHNjaGVkdWxlZCcsIC0xKTtcclxuXHRcdFx0cmV0dXJuO1xyXG5cdFx0fVxyXG5cdFx0XHJcblx0XHRlbnF1ZXVlTmV3Sm9iKHRoaXMsIGpvYiwgcHJpb3JpdHkpO1xyXG5cdFx0ZW5zdXJlUGVuZGluZ0pvYnNDb3VudCh0aGlzKTtcclxuXHRcdGxvZyh0aGlzLCAnZW5xdWV1ZUpvYigpIGVuZDogam9iIHBlbmRpbmcnLCAtMSk7XHJcblx0fTtcclxuXHJcblx0ZnVuY3Rpb24gam9iRG9uZUludGVybmFsKHNlbGYsIHJlc291cmNlLCBqb2JDb250ZXh0KSB7XHJcblx0XHRpZiAoc2VsZi5fc2hvd0xvZykge1xyXG5cdFx0XHR2YXIgcHJpb3JpdHkgPSBzZWxmLl9wcmlvcml0aXplci5nZXRQcmlvcml0eShqb2JDb250ZXh0KTtcclxuXHRcdFx0bG9nKHNlbGYsICdqb2JEb25lKCkgc3RhcnQ6IGpvYiBkb25lIG9mIHByaW9yaXR5ICcgKyBwcmlvcml0eSwgKzEpO1xyXG5cdFx0fVxyXG5cdFx0XHJcblx0XHRyZXNvdXJjZUZyZWVkKHNlbGYsIHJlc291cmNlKTtcclxuXHRcdGVuc3VyZVBlbmRpbmdKb2JzQ291bnQoc2VsZik7XHJcblx0XHRsb2coc2VsZiwgJ2pvYkRvbmUoKSBlbmQnLCAtMSk7XHJcblx0fVxyXG5cdFxyXG5cdGZ1bmN0aW9uIHNob3VsZFlpZWxkT3JBYm9ydEludGVybmFsKHNlbGYsIGpvYkNvbnRleHQpIHtcclxuXHRcdGxvZyhzZWxmLCAnc2hvdWxkWWllbGRPckFib3J0KCkgc3RhcnQnLCArMSk7XHJcblx0XHR2YXIgcHJpb3JpdHkgPSBzZWxmLl9wcmlvcml0aXplci5nZXRQcmlvcml0eShqb2JDb250ZXh0KTtcclxuXHRcdHZhciByZXN1bHQgPSAocHJpb3JpdHkgPCAwKSB8fCBoYXNOZXdKb2JXaXRoSGlnaGVyUHJpb3JpdHkoc2VsZiwgcHJpb3JpdHkpO1xyXG5cdFx0bG9nKHNlbGYsICdzaG91bGRZaWVsZE9yQWJvcnQoKSBlbmQnLCAtMSk7XHJcblx0XHRyZXR1cm4gcmVzdWx0O1xyXG5cdH1cclxuXHRcclxuXHRmdW5jdGlvbiB0cnlZaWVsZEludGVybmFsKFxyXG5cdFx0c2VsZiwgam9iQ29udGludWVGdW5jLCBqb2JDb250ZXh0LCBqb2JBYm9ydGVkRnVuYywgam9iWWllbGRlZEZ1bmMsIHJlc291cmNlKSB7XHJcblx0XHRcclxuXHRcdGxvZyhzZWxmLCAndHJ5WWllbGQoKSBzdGFydCcsICsxKTtcclxuXHRcdHZhciBwcmlvcml0eSA9IHNlbGYuX3ByaW9yaXRpemVyLmdldFByaW9yaXR5KGpvYkNvbnRleHQpO1xyXG5cdFx0aWYgKHByaW9yaXR5IDwgMCkge1xyXG5cdFx0XHRqb2JBYm9ydGVkRnVuYyhqb2JDb250ZXh0KTtcclxuXHRcdFx0cmVzb3VyY2VGcmVlZChzZWxmLCByZXNvdXJjZSk7XHJcblx0XHRcdGxvZyhzZWxmLCAndHJ5WWllbGQoKSBlbmQ6IGpvYiBhYm9ydGVkJywgLTEpO1xyXG5cdFx0XHRyZXR1cm4gdHJ1ZTtcclxuXHRcdH1cclxuXHRcdFx0XHJcblx0XHR2YXIgaGlnaGVyUHJpb3JpdHlKb2IgPSB0cnlEZXF1ZXVlTmV3Sm9iV2l0aEhpZ2hlclByaW9yaXR5KFxyXG5cdFx0XHRzZWxmLCBwcmlvcml0eSk7XHJcblx0XHRlbnN1cmVQZW5kaW5nSm9ic0NvdW50KHNlbGYpO1xyXG5cdFx0XHJcblx0XHRpZiAoaGlnaGVyUHJpb3JpdHlKb2IgPT09IG51bGwpIHtcclxuXHRcdFx0bG9nKHNlbGYsICd0cnlZaWVsZCgpIGVuZDogam9iIGNvbnRpbnVlcycsIC0xKTtcclxuXHRcdFx0cmV0dXJuIGZhbHNlO1xyXG5cdFx0fVxyXG5cdFx0XHJcblx0XHRqb2JZaWVsZGVkRnVuYyhqb2JDb250ZXh0KTtcclxuXHJcblx0XHR2YXIgam9iID0ge1xyXG5cdFx0XHRqb2JGdW5jOiBqb2JDb250aW51ZUZ1bmMsXHJcblx0XHRcdGpvYkFib3J0ZWRGdW5jOiBqb2JBYm9ydGVkRnVuYyxcclxuXHRcdFx0am9iQ29udGV4dDogam9iQ29udGV4dFxyXG5cdFx0XHR9O1xyXG5cdFx0XHRcclxuXHRcdGVucXVldWVOZXdKb2Ioc2VsZiwgam9iLCBwcmlvcml0eSk7XHJcblx0XHRlbnN1cmVQZW5kaW5nSm9ic0NvdW50KHNlbGYpO1xyXG5cclxuXHRcdHNjaGVkdWxlKHNlbGYsIGhpZ2hlclByaW9yaXR5Sm9iLCByZXNvdXJjZSk7XHJcblx0XHRlbnN1cmVQZW5kaW5nSm9ic0NvdW50KHNlbGYpO1xyXG5cdFx0XHJcblx0XHRsb2coc2VsZiwgJ3RyeVlpZWxkKCkgZW5kOiBqb2IgeWllbGRlZCcsIC0xKTtcclxuXHRcdHJldHVybiB0cnVlO1xyXG5cdH1cclxuICAgIFxyXG4gICAgZnVuY3Rpb24gaGFzTmV3Sm9iV2l0aEhpZ2hlclByaW9yaXR5KHNlbGYsIGxvd1ByaW9yaXR5KSB7XHJcbiAgICAgICAgdmFyIGN1cnJlbnROb2RlID0gc2VsZi5fbmV3UGVuZGluZ0pvYnNMaW5rZWRMaXN0LmdldEZpcnN0SXRlcmF0b3IoKTtcclxuICAgICAgICBcclxuICAgICAgICBsb2coc2VsZiwgJ2hhc05ld0pvYldpdGhIaWdoZXJQcmlvcml0eSgpIHN0YXJ0JywgKzEpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHdoaWxlIChjdXJyZW50Tm9kZSAhPT0gbnVsbCkge1xyXG4gICAgICAgICAgICB2YXIgbmV4dE5vZGUgPSBzZWxmLl9uZXdQZW5kaW5nSm9ic0xpbmtlZExpc3QuZ2V0TmV4dEl0ZXJhdG9yKFxyXG4gICAgICAgICAgICAgICAgY3VycmVudE5vZGUpO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHZhciBqb2IgPSBzZWxmLl9uZXdQZW5kaW5nSm9ic0xpbmtlZExpc3QuZ2V0RnJvbUl0ZXJhdG9yKGN1cnJlbnROb2RlKTtcclxuICAgICAgICAgICAgdmFyIHByaW9yaXR5ID0gc2VsZi5fcHJpb3JpdGl6ZXIuZ2V0UHJpb3JpdHkoam9iLmpvYkNvbnRleHQpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgaWYgKHByaW9yaXR5IDwgMCkge1xyXG4gICAgICAgICAgICAgICAgZXh0cmFjdEpvYkZyb21MaW5rZWRMaXN0KHNlbGYsIGN1cnJlbnROb2RlKTtcclxuICAgICAgICAgICAgICAgIC0tc2VsZi5fcGVuZGluZ0pvYnNDb3VudDtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgam9iLmpvYkFib3J0ZWRGdW5jKGpvYi5qb2JDb250ZXh0KTtcclxuICAgICAgICAgICAgICAgIGN1cnJlbnROb2RlID0gbmV4dE5vZGU7XHJcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgaWYgKHByaW9yaXR5ID4gbG93UHJpb3JpdHkpIHtcclxuICAgICAgICAgICAgICAgIGxvZyhzZWxmLCAnaGFzTmV3Sm9iV2l0aEhpZ2hlclByaW9yaXR5KCkgZW5kOiByZXR1cm5zIHRydWUnLCAtMSk7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gdHJ1ZTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgY3VycmVudE5vZGUgPSBuZXh0Tm9kZTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgbG9nKHNlbGYsICdoYXNOZXdKb2JXaXRoSGlnaGVyUHJpb3JpdHkoKSBlbmQ6IHJldHVybnMgZmFsc2UnLCAtMSk7XHJcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBmdW5jdGlvbiB0cnlEZXF1ZXVlTmV3Sm9iV2l0aEhpZ2hlclByaW9yaXR5KHNlbGYsIGxvd1ByaW9yaXR5KSB7XHJcbiAgICAgICAgbG9nKHNlbGYsICd0cnlEZXF1ZXVlTmV3Sm9iV2l0aEhpZ2hlclByaW9yaXR5KCkgc3RhcnQnLCArMSk7XHJcbiAgICAgICAgdmFyIGpvYlRvU2NoZWR1bGVOb2RlID0gbnVsbDtcclxuICAgICAgICB2YXIgaGlnaGVzdFByaW9yaXR5Rm91bmQgPSBsb3dQcmlvcml0eTtcclxuICAgICAgICB2YXIgY291bnRlZFByaW9yaXRpZXMgPSBbXTtcclxuXHJcbiAgICAgICAgdmFyIGN1cnJlbnROb2RlID0gc2VsZi5fbmV3UGVuZGluZ0pvYnNMaW5rZWRMaXN0LmdldEZpcnN0SXRlcmF0b3IoKTtcclxuICAgICAgICBcclxuICAgICAgICB3aGlsZSAoY3VycmVudE5vZGUgIT09IG51bGwpIHtcclxuICAgICAgICAgICAgdmFyIG5leHROb2RlID0gc2VsZi5fbmV3UGVuZGluZ0pvYnNMaW5rZWRMaXN0LmdldE5leHRJdGVyYXRvcihcclxuICAgICAgICAgICAgICAgIGN1cnJlbnROb2RlKTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICB2YXIgam9iID0gc2VsZi5fbmV3UGVuZGluZ0pvYnNMaW5rZWRMaXN0LmdldEZyb21JdGVyYXRvcihjdXJyZW50Tm9kZSk7XHJcbiAgICAgICAgICAgIHZhciBwcmlvcml0eSA9IHNlbGYuX3ByaW9yaXRpemVyLmdldFByaW9yaXR5KGpvYi5qb2JDb250ZXh0KTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGlmIChwcmlvcml0eSA8IDApIHtcclxuICAgICAgICAgICAgICAgIGV4dHJhY3RKb2JGcm9tTGlua2VkTGlzdChzZWxmLCBjdXJyZW50Tm9kZSk7XHJcbiAgICAgICAgICAgICAgICAtLXNlbGYuX3BlbmRpbmdKb2JzQ291bnQ7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIGpvYi5qb2JBYm9ydGVkRnVuYyhqb2Iuam9iQ29udGV4dCk7XHJcbiAgICAgICAgICAgICAgICBjdXJyZW50Tm9kZSA9IG5leHROb2RlO1xyXG4gICAgICAgICAgICAgICAgY29udGludWU7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGlmIChoaWdoZXN0UHJpb3JpdHlGb3VuZCA9PT0gdW5kZWZpbmVkIHx8XHJcbiAgICAgICAgICAgICAgICBwcmlvcml0eSA+IGhpZ2hlc3RQcmlvcml0eUZvdW5kKSB7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIGhpZ2hlc3RQcmlvcml0eUZvdW5kID0gcHJpb3JpdHk7XHJcbiAgICAgICAgICAgICAgICBqb2JUb1NjaGVkdWxlTm9kZSA9IGN1cnJlbnROb2RlO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBpZiAoIXNlbGYuX3Nob3dMb2cpIHtcclxuICAgICAgICAgICAgICAgIGN1cnJlbnROb2RlID0gbmV4dE5vZGU7XHJcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgaWYgKGNvdW50ZWRQcmlvcml0aWVzW3ByaW9yaXR5XSA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgICAgICAgICBjb3VudGVkUHJpb3JpdGllc1twcmlvcml0eV0gPSAxO1xyXG4gICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgKytjb3VudGVkUHJpb3JpdGllc1twcmlvcml0eV07XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGN1cnJlbnROb2RlID0gbmV4dE5vZGU7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHZhciBqb2JUb1NjaGVkdWxlID0gbnVsbDtcclxuICAgICAgICBpZiAoam9iVG9TY2hlZHVsZU5vZGUgIT09IG51bGwpIHtcclxuICAgICAgICAgICAgam9iVG9TY2hlZHVsZSA9IGV4dHJhY3RKb2JGcm9tTGlua2VkTGlzdChzZWxmLCBqb2JUb1NjaGVkdWxlTm9kZSk7XHJcbiAgICAgICAgICAgIC0tc2VsZi5fcGVuZGluZ0pvYnNDb3VudDtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKHNlbGYuX3Nob3dMb2cpIHtcclxuICAgICAgICAgICAgdmFyIGpvYnNMaXN0TWVzc2FnZSA9ICd0cnlEZXF1ZXVlTmV3Sm9iV2l0aEhpZ2hlclByaW9yaXR5KCk6IEpvYnMgbGlzdDonO1xyXG5cclxuICAgICAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBjb3VudGVkUHJpb3JpdGllcy5sZW5ndGg7ICsraSkge1xyXG4gICAgICAgICAgICAgICAgaWYgKGNvdW50ZWRQcmlvcml0aWVzW2ldICE9PSB1bmRlZmluZWQpIHtcclxuICAgICAgICAgICAgICAgICAgICBqb2JzTGlzdE1lc3NhZ2UgKz0gY291bnRlZFByaW9yaXRpZXNbaV0gKyAnIGpvYnMgb2YgcHJpb3JpdHkgJyArIGkgKyAnOyc7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGxvZyhzZWxmLCBqb2JzTGlzdE1lc3NhZ2UpO1xyXG5cclxuICAgICAgICAgICAgaWYgKGpvYlRvU2NoZWR1bGUgIT09IG51bGwpIHtcclxuICAgICAgICAgICAgICAgIGxvZyhzZWxmLCAndHJ5RGVxdWV1ZU5ld0pvYldpdGhIaWdoZXJQcmlvcml0eSgpOiBkZXF1ZXVlZCBuZXcgam9iIG9mIHByaW9yaXR5ICcgKyBoaWdoZXN0UHJpb3JpdHlGb3VuZCk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgZW5zdXJlUGVuZGluZ0pvYnNDb3VudChzZWxmKTtcclxuICAgICAgICBcclxuICAgICAgICBsb2coc2VsZiwgJ3RyeURlcXVldWVOZXdKb2JXaXRoSGlnaGVyUHJpb3JpdHkoKSBlbmQnLCAtMSk7XHJcbiAgICAgICAgcmV0dXJuIGpvYlRvU2NoZWR1bGU7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGZ1bmN0aW9uIHRyeUdldEZyZWVSZXNvdXJjZShzZWxmKSB7XHJcbiAgICAgICAgbG9nKHNlbGYsICd0cnlHZXRGcmVlUmVzb3VyY2UoKSBzdGFydCcsICsxKTtcclxuICAgICAgICBpZiAoc2VsZi5fZnJlZVJlc291cmNlc0NvdW50ID09PSAwKSB7XHJcbiAgICAgICAgICAgIHJldHVybiBudWxsO1xyXG4gICAgICAgIH1cclxuICAgICAgICAtLXNlbGYuX2ZyZWVSZXNvdXJjZXNDb3VudDtcclxuICAgICAgICB2YXIgcmVzb3VyY2UgPSBzZWxmLl9mcmVlUmVzb3VyY2VzLnBvcCgpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGlmIChyZXNvdXJjZSA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgICAgIHJlc291cmNlID0gc2VsZi5fcmVzb3VyY2VDcmVhdG9yKCk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIGVuc3VyZVBlbmRpbmdKb2JzQ291bnQoc2VsZik7XHJcbiAgICAgICAgXHJcbiAgICAgICAgbG9nKHNlbGYsICd0cnlHZXRGcmVlUmVzb3VyY2UoKSBlbmQnLCAtMSk7XHJcbiAgICAgICAgcmV0dXJuIHJlc291cmNlO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBmdW5jdGlvbiBlbnF1ZXVlTmV3Sm9iKHNlbGYsIGpvYiwgcHJpb3JpdHkpIHtcclxuICAgICAgICBsb2coc2VsZiwgJ2VucXVldWVOZXdKb2IoKSBzdGFydCcsICsxKTtcclxuICAgICAgICArK3NlbGYuX3BlbmRpbmdKb2JzQ291bnQ7XHJcbiAgICAgICAgXHJcbiAgICAgICAgdmFyIGZpcnN0SXRlcmF0b3IgPSBzZWxmLl9uZXdQZW5kaW5nSm9ic0xpbmtlZExpc3QuZ2V0Rmlyc3RJdGVyYXRvcigpO1xyXG4gICAgICAgIGFkZEpvYlRvTGlua2VkTGlzdChzZWxmLCBqb2IsIGZpcnN0SXRlcmF0b3IpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGlmIChzZWxmLl9zaG93TG9nKSB7XHJcbiAgICAgICAgICAgIGxvZyhzZWxmLCAnZW5xdWV1ZU5ld0pvYigpOiBlbnF1ZXVlZCBqb2Igb2YgcHJpb3JpdHkgJyArIHByaW9yaXR5KTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKHNlbGYuX25ld1BlbmRpbmdKb2JzTGlua2VkTGlzdC5nZXRDb3VudCgpIDw9IHNlbGYuX251bU5ld0pvYnMpIHtcclxuICAgICAgICAgICAgZW5zdXJlUGVuZGluZ0pvYnNDb3VudChzZWxmKTtcclxuICAgICAgICAgICAgbG9nKHNlbGYsICdlbnF1ZXVlTmV3Sm9iKCkgZW5kOiBfbmV3UGVuZGluZ0pvYnNMaW5rZWRMaXN0IGlzIHNtYWxsIGVub3VnaCcsIC0xKTtcclxuICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICB2YXIgbGFzdEl0ZXJhdG9yID0gc2VsZi5fbmV3UGVuZGluZ0pvYnNMaW5rZWRMaXN0LmdldExhc3RJdGVyYXRvcigpO1xyXG4gICAgICAgIHZhciBvbGRKb2IgPSBleHRyYWN0Sm9iRnJvbUxpbmtlZExpc3Qoc2VsZiwgbGFzdEl0ZXJhdG9yKTtcclxuICAgICAgICBlbnF1ZXVlT2xkSm9iKHNlbGYsIG9sZEpvYik7XHJcbiAgICAgICAgZW5zdXJlUGVuZGluZ0pvYnNDb3VudChzZWxmKTtcclxuICAgICAgICBsb2coc2VsZiwgJ2VucXVldWVOZXdKb2IoKSBlbmQ6IE9uZSBqb2IgbW92ZWQgZnJvbSBuZXcgam9iIGxpc3QgdG8gb2xkIGpvYiBsaXN0JywgLTEpO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBmdW5jdGlvbiBlbnF1ZXVlT2xkSm9iKHNlbGYsIGpvYikge1xyXG4gICAgICAgIGxvZyhzZWxmLCAnZW5xdWV1ZU9sZEpvYigpIHN0YXJ0JywgKzEpO1xyXG4gICAgICAgIHZhciBwcmlvcml0eSA9IHNlbGYuX3ByaW9yaXRpemVyLmdldFByaW9yaXR5KGpvYi5qb2JDb250ZXh0KTtcclxuICAgICAgICBcclxuICAgICAgICBpZiAocHJpb3JpdHkgPCAwKSB7XHJcbiAgICAgICAgICAgIC0tc2VsZi5fcGVuZGluZ0pvYnNDb3VudDtcclxuICAgICAgICAgICAgam9iLmpvYkFib3J0ZWRGdW5jKGpvYi5qb2JDb250ZXh0KTtcclxuICAgICAgICAgICAgbG9nKHNlbGYsICdlbnF1ZXVlT2xkSm9iKCkgZW5kOiBqb2IgYWJvcnRlZCcsIC0xKTtcclxuICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBpZiAoc2VsZi5fb2xkUGVuZGluZ0pvYnNCeVByaW9yaXR5W3ByaW9yaXR5XSA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgICAgIHNlbGYuX29sZFBlbmRpbmdKb2JzQnlQcmlvcml0eVtwcmlvcml0eV0gPSBbXTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgc2VsZi5fb2xkUGVuZGluZ0pvYnNCeVByaW9yaXR5W3ByaW9yaXR5XS5wdXNoKGpvYik7XHJcbiAgICAgICAgbG9nKHNlbGYsICdlbnF1ZXVlT2xkSm9iKCkgZW5kOiBqb2IgZW5xdWV1ZWQgdG8gb2xkIGpvYiBsaXN0JywgLTEpO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBmdW5jdGlvbiByZXJhbmtQcmlvcml0aWVzKHNlbGYpIHtcclxuICAgICAgICBsb2coc2VsZiwgJ3JlcmFua1ByaW9yaXRpZXMoKSBzdGFydCcsICsxKTtcclxuICAgICAgICB2YXIgb3JpZ2luYWxPbGRzQXJyYXkgPSBzZWxmLl9vbGRQZW5kaW5nSm9ic0J5UHJpb3JpdHk7XHJcbiAgICAgICAgdmFyIG9yaWdpbmFsTmV3c0xpc3QgPSBzZWxmLl9uZXdQZW5kaW5nSm9ic0xpbmtlZExpc3Q7XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKG9yaWdpbmFsT2xkc0FycmF5Lmxlbmd0aCA9PT0gMCkge1xyXG4gICAgICAgICAgICBsb2coc2VsZiwgJ3JlcmFua1ByaW9yaXRpZXMoKSBlbmQ6IG5vIG5lZWQgdG8gcmVyYW5rJywgLTEpO1xyXG4gICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHNlbGYuX29sZFBlbmRpbmdKb2JzQnlQcmlvcml0eSA9IFtdO1xyXG4gICAgICAgIHNlbGYuX25ld1BlbmRpbmdKb2JzTGlua2VkTGlzdCA9IG5ldyBMaW5rZWRMaXN0KCk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBvcmlnaW5hbE9sZHNBcnJheS5sZW5ndGg7ICsraSkge1xyXG4gICAgICAgICAgICBpZiAob3JpZ2luYWxPbGRzQXJyYXlbaV0gPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgICAgICAgICAgY29udGludWU7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGZvciAodmFyIGogPSAwOyBqIDwgb3JpZ2luYWxPbGRzQXJyYXlbaV0ubGVuZ3RoOyArK2opIHtcclxuICAgICAgICAgICAgICAgIGVucXVldWVPbGRKb2Ioc2VsZiwgb3JpZ2luYWxPbGRzQXJyYXlbaV1bal0pO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHZhciBpdGVyYXRvciA9IG9yaWdpbmFsTmV3c0xpc3QuZ2V0Rmlyc3RJdGVyYXRvcigpO1xyXG4gICAgICAgIHdoaWxlIChpdGVyYXRvciAhPT0gbnVsbCkge1xyXG4gICAgICAgICAgICB2YXIgdmFsdWUgPSBvcmlnaW5hbE5ld3NMaXN0LmdldEZyb21JdGVyYXRvcihpdGVyYXRvcik7XHJcbiAgICAgICAgICAgIGVucXVldWVPbGRKb2Ioc2VsZiwgdmFsdWUpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgaXRlcmF0b3IgPSBvcmlnaW5hbE5ld3NMaXN0LmdldE5leHRJdGVyYXRvcihpdGVyYXRvcik7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHZhciBtZXNzYWdlID0gJ3JlcmFua1ByaW9yaXRpZXMoKTogJztcclxuICAgICAgICBcclxuICAgICAgICBmb3IgKHZhciBrID0gc2VsZi5fb2xkUGVuZGluZ0pvYnNCeVByaW9yaXR5Lmxlbmd0aCAtIDE7IGsgPj0gMDsgLS1rKSB7XHJcbiAgICAgICAgICAgIHZhciBoaWdoUHJpb3JpdHlKb2JzID0gc2VsZi5fb2xkUGVuZGluZ0pvYnNCeVByaW9yaXR5W2tdO1xyXG4gICAgICAgICAgICBpZiAoaGlnaFByaW9yaXR5Sm9icyA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgaWYgKHNlbGYuX3Nob3dMb2cpIHtcclxuICAgICAgICAgICAgICAgIG1lc3NhZ2UgKz0gaGlnaFByaW9yaXR5Sm9icy5sZW5ndGggKyAnIGpvYnMgaW4gcHJpb3JpdHkgJyArIGsgKyAnOyc7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHdoaWxlIChoaWdoUHJpb3JpdHlKb2JzLmxlbmd0aCA+IDAgJiZcclxuICAgICAgICAgICAgICAgICAgICBzZWxmLl9uZXdQZW5kaW5nSm9ic0xpbmtlZExpc3QuZ2V0Q291bnQoKSA8IHNlbGYuX251bU5ld0pvYnMpIHtcclxuICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIHZhciBqb2IgPSBoaWdoUHJpb3JpdHlKb2JzLnBvcCgpO1xyXG4gICAgICAgICAgICAgICAgYWRkSm9iVG9MaW5rZWRMaXN0KHNlbGYsIGpvYik7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGlmIChzZWxmLl9uZXdQZW5kaW5nSm9ic0xpbmtlZExpc3QuZ2V0Q291bnQoKSA+PSBzZWxmLl9udW1OZXdKb2JzICYmXHJcbiAgICAgICAgICAgICAgICAhc2VsZi5fc2hvd0xvZykge1xyXG4gICAgICAgICAgICAgICAgYnJlYWs7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKHNlbGYuX3Nob3dMb2cpIHtcclxuICAgICAgICAgICAgbG9nKHNlbGYsIG1lc3NhZ2UpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBlbnN1cmVQZW5kaW5nSm9ic0NvdW50KHNlbGYpO1xyXG4gICAgICAgIGxvZyhzZWxmLCAncmVyYW5rUHJpb3JpdGllcygpIGVuZDogcmVyYW5rIGRvbmUnLCAtMSk7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGZ1bmN0aW9uIHJlc291cmNlRnJlZWQoc2VsZiwgcmVzb3VyY2UpIHtcclxuICAgICAgICBsb2coc2VsZiwgJ3Jlc291cmNlRnJlZWQoKSBzdGFydCcsICsxKTtcclxuICAgICAgICArK3NlbGYuX2ZyZWVSZXNvdXJjZXNDb3VudDtcclxuICAgICAgICB2YXIgbWluUHJpb3JpdHkgPSBnZXRNaW5pbWFsUHJpb3JpdHlUb1NjaGVkdWxlKHNlbGYpO1xyXG4gICAgICAgIC0tc2VsZi5fZnJlZVJlc291cmNlc0NvdW50O1xyXG4gICAgICAgIFxyXG4gICAgICAgIHZhciBqb2IgPSB0cnlEZXF1ZXVlTmV3Sm9iV2l0aEhpZ2hlclByaW9yaXR5KHNlbGYsIG1pblByaW9yaXR5KTtcclxuXHJcbiAgICAgICAgaWYgKGpvYiAhPT0gbnVsbCkge1xyXG4gICAgICAgICAgICBlbnN1cmVQZW5kaW5nSm9ic0NvdW50KHNlbGYpO1xyXG4gICAgICAgICAgICBzY2hlZHVsZShzZWxmLCBqb2IsIHJlc291cmNlKTtcclxuICAgICAgICAgICAgZW5zdXJlUGVuZGluZ0pvYnNDb3VudChzZWxmKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGxvZyhzZWxmLCAncmVzb3VyY2VGcmVlZCgpIGVuZDogbmV3IGpvYiBzY2hlZHVsZWQnLCAtMSk7XHJcbiAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgdmFyIGhhc09sZEpvYnMgPVxyXG4gICAgICAgICAgICBzZWxmLl9wZW5kaW5nSm9ic0NvdW50ID4gc2VsZi5fbmV3UGVuZGluZ0pvYnNMaW5rZWRMaXN0LmdldENvdW50KCk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgIGlmICghaGFzT2xkSm9icykge1xyXG4gICAgICAgICAgICBzZWxmLl9mcmVlUmVzb3VyY2VzLnB1c2gocmVzb3VyY2UpO1xyXG4gICAgICAgICAgICArK3NlbGYuX2ZyZWVSZXNvdXJjZXNDb3VudDtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGVuc3VyZVBlbmRpbmdKb2JzQ291bnQoc2VsZik7XHJcbiAgICAgICAgICAgIGxvZyhzZWxmLCAncmVzb3VyY2VGcmVlZCgpIGVuZDogbm8gam9iIHRvIHNjaGVkdWxlJywgLTEpO1xyXG4gICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHZhciBudW1Qcmlvcml0aWVzID0gc2VsZi5fb2xkUGVuZGluZ0pvYnNCeVByaW9yaXR5Lmxlbmd0aDtcclxuICAgICAgICB2YXIgam9iUHJpb3JpdHk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgZm9yICh2YXIgcHJpb3JpdHkgPSBudW1Qcmlvcml0aWVzIC0gMTsgcHJpb3JpdHkgPj0gMDsgLS1wcmlvcml0eSkge1xyXG4gICAgICAgICAgICB2YXIgam9icyA9IHNlbGYuX29sZFBlbmRpbmdKb2JzQnlQcmlvcml0eVtwcmlvcml0eV07XHJcbiAgICAgICAgICAgIGlmIChqb2JzID09PSB1bmRlZmluZWQgfHwgam9icy5sZW5ndGggPT09IDApIHtcclxuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBmb3IgKHZhciBpID0gam9icy5sZW5ndGggLSAxOyBpID49IDA7IC0taSkge1xyXG4gICAgICAgICAgICAgICAgam9iID0gam9ic1tpXTtcclxuICAgICAgICAgICAgICAgIGpvYlByaW9yaXR5ID0gc2VsZi5fcHJpb3JpdGl6ZXIuZ2V0UHJpb3JpdHkoam9iLmpvYkNvbnRleHQpO1xyXG4gICAgICAgICAgICAgICAgaWYgKGpvYlByaW9yaXR5ID49IHByaW9yaXR5KSB7XHJcbiAgICAgICAgICAgICAgICAgICAgam9icy5sZW5ndGggPSBpO1xyXG4gICAgICAgICAgICAgICAgICAgIGJyZWFrO1xyXG4gICAgICAgICAgICAgICAgfSBlbHNlIGlmIChqb2JQcmlvcml0eSA8IDApIHtcclxuICAgICAgICAgICAgICAgICAgICAtLXNlbGYuX3BlbmRpbmdKb2JzQ291bnQ7XHJcbiAgICAgICAgICAgICAgICAgICAgam9iLmpvYkFib3J0ZWRGdW5jKGpvYi5qb2JDb250ZXh0KTtcclxuICAgICAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKHNlbGYuX29sZFBlbmRpbmdKb2JzQnlQcmlvcml0eVtqb2JQcmlvcml0eV0gPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBzZWxmLl9vbGRQZW5kaW5nSm9ic0J5UHJpb3JpdHlbam9iUHJpb3JpdHldID0gW107XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgIHNlbGYuX29sZFBlbmRpbmdKb2JzQnlQcmlvcml0eVtqb2JQcmlvcml0eV0ucHVzaChqb2IpO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICBqb2IgPSBudWxsO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBpZiAoam9iICE9PSBudWxsKSB7XHJcbiAgICAgICAgICAgICAgICBicmVhaztcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgam9icy5sZW5ndGggPSAwO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBpZiAoam9iID09PSBudWxsKSB7XHJcbiAgICAgICAgICAgIHNlbGYuX2ZyZWVSZXNvdXJjZXMucHVzaChyZXNvdXJjZSk7XHJcbiAgICAgICAgICAgICsrc2VsZi5fZnJlZVJlc291cmNlc0NvdW50O1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgZW5zdXJlUGVuZGluZ0pvYnNDb3VudChzZWxmKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGxvZyhzZWxmLCAncmVzb3VyY2VGcmVlZCgpIGVuZDogbm8gbm9uLWFib3J0ZWQgam9iIHRvIHNjaGVkdWxlJywgLTEpO1xyXG4gICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIGlmIChzZWxmLl9zaG93TG9nKSB7XHJcbiAgICAgICAgICAgIGxvZyhzZWxmLCAncmVzb3VyY2VGcmVlZCgpOiBkZXF1ZXVlZCBvbGQgam9iIG9mIHByaW9yaXR5ICcgKyBqb2JQcmlvcml0eSk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIC0tc2VsZi5fcGVuZGluZ0pvYnNDb3VudDtcclxuICAgICAgICBcclxuICAgICAgICBlbnN1cmVQZW5kaW5nSm9ic0NvdW50KHNlbGYpO1xyXG4gICAgICAgIHNjaGVkdWxlKHNlbGYsIGpvYiwgcmVzb3VyY2UpO1xyXG4gICAgICAgIGVuc3VyZVBlbmRpbmdKb2JzQ291bnQoc2VsZik7XHJcbiAgICAgICAgbG9nKHNlbGYsICdyZXNvdXJjZUZyZWVkKCkgZW5kOiBqb2Igc2NoZWR1bGVkJywgLTEpO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBmdW5jdGlvbiBzY2hlZHVsZShzZWxmLCBqb2IsIHJlc291cmNlKSB7XHJcbiAgICAgICAgbG9nKHNlbGYsICdzY2hlZHVsZSgpIHN0YXJ0JywgKzEpO1xyXG4gICAgICAgICsrc2VsZi5fc2NoZWR1bGVzQ291bnRlcjtcclxuICAgICAgICBcclxuICAgICAgICBpZiAoc2VsZi5fc2NoZWR1bGVzQ291bnRlciA+PSBzZWxmLl9udW1Kb2JzQmVmb3JlUmVyYW5rT2xkUHJpb3JpdGllcykge1xyXG4gICAgICAgICAgICBzZWxmLl9zY2hlZHVsZXNDb3VudGVyID0gMDtcclxuICAgICAgICAgICAgcmVyYW5rUHJpb3JpdGllcyhzZWxmKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKHNlbGYuX3Nob3dMb2cpIHtcclxuICAgICAgICAgICAgdmFyIHByaW9yaXR5ID0gc2VsZi5fcHJpb3JpdGl6ZXIuZ2V0UHJpb3JpdHkoam9iLmpvYkNvbnRleHQpO1xyXG4gICAgICAgICAgICBsb2coc2VsZiwgJ3NjaGVkdWxlKCk6IHNjaGVkdWxlZCBqb2Igb2YgcHJpb3JpdHkgJyArIHByaW9yaXR5KTtcclxuICAgICAgICB9XHJcblx0XHRcclxuXHRcdHZhciBjYWxsYmFja3MgPSBuZXcgUHJpb3JpdHlTY2hlZHVsZXJDYWxsYmFja3Moc2VsZiwgcmVzb3VyY2UsIGpvYi5qb2JDb250ZXh0KTtcclxuICAgICAgICBcclxuICAgICAgICBqb2Iuam9iRnVuYyhyZXNvdXJjZSwgam9iLmpvYkNvbnRleHQsIGNhbGxiYWNrcyk7XHJcbiAgICAgICAgbG9nKHNlbGYsICdzY2hlZHVsZSgpIGVuZCcsIC0xKTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgZnVuY3Rpb24gYWRkSm9iVG9MaW5rZWRMaXN0KHNlbGYsIGpvYiwgYWRkQmVmb3JlKSB7XHJcbiAgICAgICAgbG9nKHNlbGYsICdhZGRKb2JUb0xpbmtlZExpc3QoKSBzdGFydCcsICsxKTtcclxuICAgICAgICBzZWxmLl9uZXdQZW5kaW5nSm9ic0xpbmtlZExpc3QuYWRkKGpvYiwgYWRkQmVmb3JlKTtcclxuICAgICAgICBlbnN1cmVOdW1iZXJPZk5vZGVzKHNlbGYpO1xyXG4gICAgICAgIGxvZyhzZWxmLCAnYWRkSm9iVG9MaW5rZWRMaXN0KCkgZW5kJywgLTEpO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBmdW5jdGlvbiBleHRyYWN0Sm9iRnJvbUxpbmtlZExpc3Qoc2VsZiwgaXRlcmF0b3IpIHtcclxuICAgICAgICBsb2coc2VsZiwgJ2V4dHJhY3RKb2JGcm9tTGlua2VkTGlzdCgpIHN0YXJ0JywgKzEpO1xyXG4gICAgICAgIHZhciB2YWx1ZSA9IHNlbGYuX25ld1BlbmRpbmdKb2JzTGlua2VkTGlzdC5nZXRGcm9tSXRlcmF0b3IoaXRlcmF0b3IpO1xyXG4gICAgICAgIHNlbGYuX25ld1BlbmRpbmdKb2JzTGlua2VkTGlzdC5yZW1vdmUoaXRlcmF0b3IpO1xyXG4gICAgICAgIGVuc3VyZU51bWJlck9mTm9kZXMoc2VsZik7XHJcbiAgICAgICAgXHJcbiAgICAgICAgbG9nKHNlbGYsICdleHRyYWN0Sm9iRnJvbUxpbmtlZExpc3QoKSBlbmQnLCAtMSk7XHJcbiAgICAgICAgcmV0dXJuIHZhbHVlO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBmdW5jdGlvbiBlbnN1cmVOdW1iZXJPZk5vZGVzKHNlbGYpIHtcclxuICAgICAgICBpZiAoIXNlbGYuX3Nob3dMb2cpIHtcclxuICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBsb2coc2VsZiwgJ2Vuc3VyZU51bWJlck9mTm9kZXMoKSBzdGFydCcsICsxKTtcclxuICAgICAgICB2YXIgaXRlcmF0b3IgPSBzZWxmLl9uZXdQZW5kaW5nSm9ic0xpbmtlZExpc3QuZ2V0Rmlyc3RJdGVyYXRvcigpO1xyXG4gICAgICAgIHZhciBleHBlY3RlZENvdW50ID0gMDtcclxuICAgICAgICB3aGlsZSAoaXRlcmF0b3IgIT09IG51bGwpIHtcclxuICAgICAgICAgICAgKytleHBlY3RlZENvdW50O1xyXG4gICAgICAgICAgICBpdGVyYXRvciA9IHNlbGYuX25ld1BlbmRpbmdKb2JzTGlua2VkTGlzdC5nZXROZXh0SXRlcmF0b3IoaXRlcmF0b3IpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBpZiAoZXhwZWN0ZWRDb3VudCAhPT0gc2VsZi5fbmV3UGVuZGluZ0pvYnNMaW5rZWRMaXN0LmdldENvdW50KCkpIHtcclxuICAgICAgICAgICAgdGhyb3cgJ1VuZXhwZWN0ZWQgY291bnQgb2YgbmV3IGpvYnMnO1xyXG4gICAgICAgIH1cclxuICAgICAgICBsb2coc2VsZiwgJ2Vuc3VyZU51bWJlck9mTm9kZXMoKSBlbmQnLCAtMSk7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGZ1bmN0aW9uIGVuc3VyZVBlbmRpbmdKb2JzQ291bnQoc2VsZikge1xyXG4gICAgICAgIGlmICghc2VsZi5fc2hvd0xvZykge1xyXG4gICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIGxvZyhzZWxmLCAnZW5zdXJlUGVuZGluZ0pvYnNDb3VudCgpIHN0YXJ0JywgKzEpO1xyXG4gICAgICAgIHZhciBvbGRKb2JzQ291bnQgPSAwO1xyXG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgc2VsZi5fb2xkUGVuZGluZ0pvYnNCeVByaW9yaXR5Lmxlbmd0aDsgKytpKSB7XHJcbiAgICAgICAgICAgIHZhciBqb2JzID0gc2VsZi5fb2xkUGVuZGluZ0pvYnNCeVByaW9yaXR5W2ldO1xyXG4gICAgICAgICAgICBpZiAoam9icyAhPT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgICAgICAgICBvbGRKb2JzQ291bnQgKz0gam9icy5sZW5ndGg7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgdmFyIGV4cGVjdGVkQ291bnQgPVxyXG4gICAgICAgICAgICBvbGRKb2JzQ291bnQgKyBzZWxmLl9uZXdQZW5kaW5nSm9ic0xpbmtlZExpc3QuZ2V0Q291bnQoKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgaWYgKGV4cGVjdGVkQ291bnQgIT09IHNlbGYuX3BlbmRpbmdKb2JzQ291bnQpIHtcclxuICAgICAgICAgICAgdGhyb3cgJ1VuZXhwZWN0ZWQgY291bnQgb2Ygam9icyc7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGxvZyhzZWxmLCAnZW5zdXJlUGVuZGluZ0pvYnNDb3VudCgpIGVuZCcsIC0xKTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgZnVuY3Rpb24gZ2V0TWluaW1hbFByaW9yaXR5VG9TY2hlZHVsZShzZWxmKSB7XHJcbiAgICAgICAgbG9nKHNlbGYsICdnZXRNaW5pbWFsUHJpb3JpdHlUb1NjaGVkdWxlKCkgc3RhcnQnLCArMSk7XHJcbiAgICAgICAgaWYgKHNlbGYuX2ZyZWVSZXNvdXJjZXNDb3VudCA8PSBzZWxmLl9yZXNvdXJjZXNHdWFyYW50ZWVkRm9ySGlnaFByaW9yaXR5KSB7XHJcbiAgICAgICAgICAgIGxvZyhzZWxmLCAnZ2V0TWluaW1hbFByaW9yaXR5VG9TY2hlZHVsZSgpIGVuZDogZ3VhcmFudGVlIHJlc291cmNlIGZvciBoaWdoIHByaW9yaXR5IGlzIG5lZWRlZCcsIC0xKTtcclxuICAgICAgICAgICAgcmV0dXJuIHNlbGYuX2hpZ2hQcmlvcml0eVRvR3VhcmFudGVlUmVzb3VyY2VzO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBsb2coc2VsZiwgJ2dldE1pbmltYWxQcmlvcml0eVRvU2NoZWR1bGUoKSBlbmQ6IGVub3VnaCByZXNvdXJjZXMsIG5vIG5lZWQgdG8gZ3VhcmFudGVlIHJlc291cmNlIGZvciBoaWdoIHByaW9yaXR5JywgLTEpO1xyXG4gICAgICAgIHJldHVybiAwO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBmdW5jdGlvbiBsb2coc2VsZiwgbXNnLCBhZGRJbmRlbnQpIHtcclxuICAgICAgICBpZiAoIXNlbGYuX3Nob3dMb2cpIHtcclxuICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBpZiAoYWRkSW5kZW50ID09PSAtMSkge1xyXG4gICAgICAgICAgICBzZWxmLl9sb2dDYWxsSW5kZW50UHJlZml4ID0gc2VsZi5fbG9nQ2FsbEluZGVudFByZWZpeC5zdWJzdHIoMSk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIGlmIChzZWxmLl9zY2hlZHVsZXJOYW1lICE9PSB1bmRlZmluZWQpIHtcclxuXHRcdFx0LyogZ2xvYmFsIGNvbnNvbGU6IGZhbHNlICovXHJcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKHNlbGYuX2xvZ0NhbGxJbmRlbnRQcmVmaXggKyAnUHJpb3JpdHlTY2hlZHVsZXIgJyArIHNlbGYuX3NjaGVkdWxlck5hbWUgKyAnOiAnICsgbXNnKTtcclxuICAgICAgICB9IGVsc2Uge1xyXG5cdFx0XHQvKiBnbG9iYWwgY29uc29sZTogZmFsc2UgKi9cclxuICAgICAgICAgICAgY29uc29sZS5sb2coc2VsZi5fbG9nQ2FsbEluZGVudFByZWZpeCArICdQcmlvcml0eVNjaGVkdWxlcjogJyArIG1zZyk7XHJcbiAgICAgICAgfVxyXG4gICAgXHJcbiAgICAgICAgaWYgKGFkZEluZGVudCA9PT0gMSkge1xyXG4gICAgICAgICAgICBzZWxmLl9sb2dDYWxsSW5kZW50UHJlZml4ICs9ICc+JztcclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICBcclxuXHRmdW5jdGlvbiBQcmlvcml0eVNjaGVkdWxlckNhbGxiYWNrcyhzY2hlZHVsZXIsIHJlc291cmNlLCBjb250ZXh0KSB7XHJcblx0XHR0aGlzLl9pc1ZhbGlkID0gdHJ1ZTtcclxuXHRcdHRoaXMuX3NjaGVkdWxlciA9IHNjaGVkdWxlcjtcclxuXHRcdHRoaXMuX3Jlc291cmNlID0gcmVzb3VyY2U7XHJcblx0XHR0aGlzLl9jb250ZXh0ID0gY29udGV4dDtcclxuXHR9XHJcblx0XHJcblx0UHJpb3JpdHlTY2hlZHVsZXJDYWxsYmFja3MucHJvdG90eXBlLl9jaGVja1ZhbGlkaXR5ID0gZnVuY3Rpb24gY2hlY2tWYWxpZGl0eSgpIHtcclxuXHRcdGlmICghdGhpcy5faXNWYWxpZCkge1xyXG5cdFx0XHR0aHJvdyAnUmVzb3VyY2VTY2hlZHVsZXIgZXJyb3I6IEFscmVhZHkgdGVybWluYXRlZCBqb2InO1xyXG5cdFx0fVxyXG5cdH07XHJcblx0XHJcblx0UHJpb3JpdHlTY2hlZHVsZXJDYWxsYmFja3MucHJvdG90eXBlLl9jbGVhclZhbGlkaXR5ID0gZnVuY3Rpb24oKSB7XHJcblx0XHR0aGlzLl9pc1ZhbGlkID0gZmFsc2U7XHJcblx0XHR0aGlzLl9yZXNvdXJjZSA9IG51bGw7XHJcblx0XHR0aGlzLl9jb250ZXh0ID0gbnVsbDtcclxuXHRcdHRoaXMuX3NjaGVkdWxlciA9IG51bGw7XHJcblx0fTtcclxuXHRcclxuXHRQcmlvcml0eVNjaGVkdWxlckNhbGxiYWNrcy5wcm90b3R5cGUuam9iRG9uZSA9IGZ1bmN0aW9uIGpvYkRvbmUoKSB7XHJcblx0XHR0aGlzLl9jaGVja1ZhbGlkaXR5KCk7XHJcblx0XHRqb2JEb25lSW50ZXJuYWwodGhpcy5fc2NoZWR1bGVyLCB0aGlzLl9yZXNvdXJjZSwgdGhpcy5fY29udGV4dCk7XHJcblx0XHR0aGlzLl9jbGVhclZhbGlkaXR5KCk7XHJcblx0fTtcclxuXHRcclxuXHRQcmlvcml0eVNjaGVkdWxlckNhbGxiYWNrcy5wcm90b3R5cGUuc2hvdWxkWWllbGRPckFib3J0ID0gZnVuY3Rpb24oKSB7XHJcblx0XHR0aGlzLl9jaGVja1ZhbGlkaXR5KCk7XHJcblx0XHRyZXR1cm4gc2hvdWxkWWllbGRPckFib3J0SW50ZXJuYWwodGhpcy5fc2NoZWR1bGVyLCB0aGlzLl9jb250ZXh0KTtcclxuXHR9O1xyXG5cdFxyXG5cdFByaW9yaXR5U2NoZWR1bGVyQ2FsbGJhY2tzLnByb3RvdHlwZS50cnlZaWVsZCA9IGZ1bmN0aW9uIHRyeVlpZWxkKGpvYkNvbnRpbnVlRnVuYywgam9iQWJvcnRlZEZ1bmMsIGpvYllpZWxkZWRGdW5jKSB7XHJcblx0XHR0aGlzLl9jaGVja1ZhbGlkaXR5KCk7XHJcblx0XHR2YXIgaXNZaWVsZGVkID0gdHJ5WWllbGRJbnRlcm5hbChcclxuXHRcdFx0dGhpcy5fc2NoZWR1bGVyLCBqb2JDb250aW51ZUZ1bmMsIHRoaXMuX2NvbnRleHQsIGpvYkFib3J0ZWRGdW5jLCBqb2JZaWVsZGVkRnVuYywgdGhpcy5fcmVzb3VyY2UpO1xyXG5cdFx0aWYgKGlzWWllbGRlZCkge1xyXG5cdFx0XHR0aGlzLl9jbGVhclZhbGlkaXR5KCk7XHJcblx0XHR9XHJcblx0XHRyZXR1cm4gaXNZaWVsZGVkO1xyXG5cdH07XHJcblxyXG5cdHJldHVybiBQcmlvcml0eVNjaGVkdWxlcjtcclxufSkoKTtcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gUHJpb3JpdHlTY2hlZHVsZXI7IiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxubW9kdWxlLmV4cG9ydHMuUHJpb3JpdHlTY2hlZHVsZXIgPSByZXF1aXJlKCdwcmlvcml0eS1zY2hlZHVsZXInKTtcclxubW9kdWxlLmV4cG9ydHMuTGlmb1NjaGVkdWxlciA9IHJlcXVpcmUoJ2xpZm8tc2NoZWR1bGVyJyk7XHJcbiJdfQ==

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
},{"image-helper-functions.js":14}],3:[function(require,module,exports){
'use strict';

module.exports = CesiumImageDecoderLayerManager;

var CanvasImageryProvider = require('canvas-imagery-provider.js');
var ImageViewer = require('image-viewer.js');
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
},{"canvas-imagery-provider.js":1,"cesium-frustum-calculator.js":2,"image-viewer.js":18}],4:[function(require,module,exports){
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
function ImageDecoderImageryProvider(image, options) {
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
    
    this._image = image;
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
    
    this._image.open(this._url)
		.then(this._opened.bind(this))
		.catch(this._onException.bind(this));
    
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
    }, this._image, this._image);
    
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
        
        self._image.requestPixelsProgressive(
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
    this._numResolutionLevels = this._image.getNumResolutionLevelsForLimittedViewer();
    this._quality = this._image.getHighestQuality();
    var maximumCesiumLevel = this._numResolutionLevels - 1;
        
    this._tileWidth = this._image.getTileWidth();
    this._tileHeight = this._image.getTileHeight();
        
    var bestLevel = this._image.getImageLevel();
    var bestLevelWidth  = this._image.getImageWidth ();
    var bestLevelHeight = this._image.getImageHeight();
    
    var lowestLevelTilesX = Math.ceil(bestLevelWidth  / this._tileWidth ) >> maximumCesiumLevel;
    var lowestLevelTilesY = Math.ceil(bestLevelHeight / this._tileHeight) >> maximumCesiumLevel;

    imageHelperFunctions.fixBounds(
        this._rectangle,
        this._image,
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
},{"cesium-frustum-calculator.js":2,"image-helper-functions.js":14}],5:[function(require,module,exports){
'use strict';

module.exports.ImageViewer = require('image-viewer.js');
module.exports.ImageBase = require('image-base.js');
module.exports.FetcherBase = require('fetcher-base.js');
module.exports.GridImageBase = require('grid-image-base.js');
module.exports.GridFetcherBase = require('grid-fetcher-base.js');
module.exports.GridDecoderWorkerBase = require('grid-decoder-worker-base.js');
module.exports.CesiumImageDecoderLayerManager = require('cesium-image-decoder-layer-manager.js');
module.exports.ImageDecoderImageryProvider = require('image-decoder-imagery-provider.js');
module.exports.ImageDecoderRegionLayer = require('image-decoder-region-layer.js');

},{"cesium-image-decoder-layer-manager.js":3,"fetcher-base.js":11,"grid-decoder-worker-base.js":21,"grid-fetcher-base.js":22,"grid-image-base.js":23,"image-base.js":6,"image-decoder-imagery-provider.js":4,"image-decoder-region-layer.js":19,"image-viewer.js":18}],6:[function(require,module,exports){
'use strict';

module.exports = ImageBase;

var imageHelperFunctions = require('image-helper-functions.js');
var DecodeJobsPool = require('decode-jobs-pool.js');
var ImageParamsRetrieverProxy = require('image-params-retriever-proxy.js');

/* global console: false */
/* global Promise: false */

ImageBase.alignParamsToTilesAndLevel = imageHelperFunctions.alignParamsToTilesAndLevel;

function ImageBase(options) {
    ImageParamsRetrieverProxy.call(this);
    
    this._options = options || {};
    //var decodeWorkersLimit = this._options.workersLimit || 5;
    
    this._tileWidth = this._options.tileWidth || 256;
    this._tileHeight = this._options.tileHeight || 256;
    this._showLog = !!this._options.showLog;
    this._fetcher = null;
    this._decodeDependencyWorkers = null;
    this._requestsDecodeJobsPool = null;
    this._movablesDecodeJobsPool = null;
	this._fetchRequestId = 0;
    
    /*if (this._showLog) {
        // Old IE
        throw 'imageDecoderFramework error: showLog is not supported on this browser';
    }*/

    this._movableStates = [];
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
}

ImageBase.prototype = Object.create(ImageParamsRetrieverProxy.prototype);

ImageBase.prototype.getFetcher = function getFetcher() {
	throw 'imageDecoderFramework error: Image.getFetcher() is not implemented by ImageBase inheritor';
};

ImageBase.prototype.getDecoderWorkers = function getDecoderWorkers() {
	throw 'imageDecoderFramework error: Image.getDecoderWorkers() is not implemented by ImageBase inheritor';
};

ImageBase.prototype.getTileWidth = function getTileWidth() {
    return this._tileWidth;
};

ImageBase.prototype.getTileHeight = function getTileHeight() {
    return this._tileHeight;
};
    
ImageBase.prototype.setServerRequestPrioritizerData =
    function setServerRequestPrioritizerData(prioritizerData) {

    this._validateFetcher();
    
    // TODO
    //this._fetcher.setServerRequestPrioritizerData(
    //    prioritizerData);
};

ImageBase.prototype.setDecodePrioritizerData =
    function setDecodePrioritizerData(prioritizerData) {

    this._validateDecoder();
    
    // TODO
    if (!ImageBase.undefinedVar) { // Avoid unreachable warning
        return;
    }
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

ImageBase.prototype.open = function open(url) {
    this._validateFetcher();
    
    var self = this;
    var promise = this._fetcher.openInternal(url);
    return promise.then(function (sizesParams) {
        self._internalSizesParams = sizesParams;
        return {
            sizesParams: sizesParams,
            applicativeTileWidth : self.getTileWidth(),
            applicativeTileHeight: self.getTileHeight()
        };
    });
};

ImageBase.prototype.close = function close() {
    this._validateFetcher();
    this._validateDecoder();
    
    for (var i = 0; i < this._decoders.length; ++i) {
        this._decoders[i].terminate();
    }

    return this._fetcher.close();
};

ImageBase.prototype.createMovableFetch = function createMovableFetch() {
    this._validateFetcher();
    this.getImageParams();
    
    var self = this;
    
    return this._fetcher.createMovableFetch().then(function(movableHandle) {
        self._movableStates[movableHandle] = {
            decodeJobsListenerHandle: null
        };
        
        return movableHandle;
    });
};

ImageBase.prototype.requestPixels = function requestPixels(imagePartParams) {
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

ImageBase.prototype.requestPixelsProgressive = function requestPixelsProgressive(
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
        terminatedCallback,
        imagePartParamsNotNeeded);
        
    if (movableHandle !== undefined) {
        if (movableState.decodeJobsListenerHandle !== null) {
            // Unregister after forked new jobs, so no termination occurs meanwhile
            decodeJobsPool.unregisterForkedJobs(
                movableState.decodeJobsListenerHandle);
        }
        movableState.decodeJobsListenerHandle = listenerHandle;
        this._fetcher.moveFetch(movableHandle, imagePartParams);
    } else {
		this._fetcher.createRequest(++this._fetchRequestId, imagePartParams);
	}
};

// Internal Methods

ImageBase.prototype._validateFetcher = function validateFetcher() {
    if (this._fetcher === null) {
        this._fetcher = this.getFetcher();
    }
};

ImageBase.prototype._validateDecoder = function validateComponents() {
    if (this._decodeDependencyWorkers !== null) {
        return;
    }
    
    this._decodeDependencyWorkers = this.getDecoderWorkers();
    
    this._requestsDecodeJobsPool = new DecodeJobsPool(
        this._decodeDependencyWorkers,
        this._tileWidth,
        this._tileHeight);
        
    this._movablesDecodeJobsPool = new DecodeJobsPool(
        this._decodeDependencyWorkers,
        this._tileWidth,
        this._tileHeight);
};

ImageBase.prototype._getImageParamsInternal = function getImageParamsInternal() {
    return this._internalSizesParams;
};

ImageBase.prototype._copyPixelsToAccumulatedResult =
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
},{"decode-jobs-pool.js":8,"image-helper-functions.js":14,"image-params-retriever-proxy.js":17}],7:[function(require,module,exports){
'use strict';

module.exports = DecodeJob;

var LinkedList = require('linked-list.js');

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
        throw 'imageDecoderFramework error: Inconsistent number of done requests';
    }
    
    var isListenerDone = remaining === 0;
    if (isListenerDone) {
        this._listenerHandle.isTerminatedCallbackCalled = true;
        this._listenerHandle.terminatedCallback(
            this._listenerHandle.isAnyDecoderAborted);
    }
};
},{"linked-list.js":15}],8:[function(require,module,exports){
'use strict';

module.exports = DecodeJobsPool;

var DecodeJob = require('decode-job.js');

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
},{"decode-job.js":7}],9:[function(require,module,exports){
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
};

FetchContextApi.prototype._onEvent = function onEvent(event, arg1, arg2) {
	var listeners = this._events[event];
	for (var i = 0; i < listeners.length; ++i) {
		listeners[i].listener.call(listeners[i].listenerThis, arg1, arg2);
	}
};
},{}],10:[function(require,module,exports){
'use strict';

var FetchContextApi = require('fetch-context-api.js');

module.exports = FetchContext;

FetchContext.FETCH_TYPE_REQUEST = 1;
FetchContext.FETCH_TYPE_MOVABLE = 2; // movable
FetchContext.FETCH_TYPE_ONLY_WAIT_FOR_DATA = 3;

FetchContext.FETCH_STATUS_WAIT_FOR_FETCH_CALL = 1;
FetchContext.FETCH_STATUS_REQUEST_WAIT_FOR_SCHEDULE = 2;
FetchContext.FETCH_STATUS_ACTIVE = 3;
FetchContext.FETCH_STATUS_REQUEST_ABOUT_TO_YIELD = 4;
FetchContext.FETCH_STATUS_REQUEST_YIELDED = 6;
FetchContext.FETCH_STATUS_REQUEST_ABOUT_TO_ABORT = 8;
FetchContext.FETCH_STATUS_REQUEST_TERMINATED = 9;
FetchContext.FETCH_STATUS_UNEXPECTED_FAILURE = 10;

function FetchContext(fetcher, scheduler, scheduledJobsList, fetchType, contextVars) {
    this._fetcher = fetcher;
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
	if (!isAborted) {
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
},{"fetch-context-api.js":9}],11:[function(require,module,exports){
'use strict';

module.exports = FetcherBase;

var imageHelperFunctions = require('image-helper-functions.js');
var FetchContext = require('fetch-context.js');
var LinkedList = require('linked-list.js');
var FetcherCloser = require('fetcher-closer.js');
var SimpleMovableFetch = require('simple-movable-fetch.js');

/* global console: false */
/* global Promise: false */

function FetcherBase(options) {
    options = options || {};
	
	var self = this;
    var serverRequestsLimit = options.serverRequestsLimit || 5;
    
    self._showLog = options.showLog;
	self._maxActiveFetchesInMovableFetch = options.maxActiveFetchesInMovableFetch || 2;
    
    if (self._showLog) {
        // Old IE
        throw 'imageDecoderFramework error: showLog is not supported on this browser';
    }
	
    var serverRequestScheduler = imageHelperFunctions.createScheduler(
        options.showLog,
        options.serverRequestPrioritizer,
        'serverRequest',
        createServerRequestDummyResource,
        serverRequestsLimit);
    
    self._serverRequestPrioritizer = serverRequestScheduler.prioritizer;
    
    self._scheduler = serverRequestScheduler.scheduler;
    self._movableHandleCounter = 0;
    self._movableHandles = [];
    self._requestById = [];
	self._imageParams = null;
    self._scheduledJobsList = new LinkedList();
	self._fetcherCloser = new FetcherCloser();
}

FetcherBase.prototype.open = function open(url) {
    throw 'imageDecoderFramework error: open() is not implemented by FetcherBase inheritor';
};

FetcherBase.prototype.on = function on(event, callback) {
    throw 'imageDecoderFramework error: on() is not implemented by FetcherBase inheritor';
};

FetcherBase.prototype.close = function close() {
	if (this.startMovableFetch !== FetcherBase.prototype.startMovableFetch) {
		throw 'imageDecoderFramework error: Must override FetcherBase.close() when FetcherBase.startMovableFetch() was override';
	}
    return this._fetcherCloser.close();
};

FetcherBase.prototype.openInternal = function openInternal(url) {
	var self = this;
    return this.open(url).then(function(result) {
		self._imageParams = result;
		return result;
	});
};

FetcherBase.prototype.getImageParams = function getImageParams() {
	return this._imageParams;
};

FetcherBase.prototype.startFetch = function startFetch(fetchContext, imagePartParams) {
    throw 'imageDecoderFramework error: startFetch() is not implemented by FetcherBase inheritor';
};

FetcherBase.prototype.startMovableFetch = function startFetch(fetchContext, imagePartParams) {
    var movableFetch = new SimpleMovableFetch(
		this, this._fetcherCloser, fetchContext, this._maxActiveFetchesInMovableFetch);
	
	movableFetch.start(imagePartParams);
};

FetcherBase.prototype.setIsProgressiveRequest = function setIsProgressiveRequest(
    requestId, isProgressive) {
    
    var fetchJob = this._requestById[requestId];
    if (fetchJob === undefined) {
        // This situation might occur if request has been terminated,
        // but user's terminatedCallback has not been called yet. It
        // happens on WorkerProxyFetcherBase due to thread
        // message delay.
        
        return null;
    }
    
    fetchJob.setIsProgressive(isProgressive);
};

FetcherBase.prototype.createMovableFetch = function createMovableFetch() {
	var self = this;
    return new Promise(function(resolve, reject) {
        var movableHandle = ++self._movableHandleCounter;
        self._movableHandles[movableHandle] = new FetchContext(
            self,
            self._scheduler,
            self._scheduledJobsList,
            FetchContext.FETCH_TYPE_MOVABLE,
            /*contextVars=*/null);

        resolve(movableHandle);
    });
};

FetcherBase.prototype.moveFetch = function moveFetch(
    movableHandle, imagePartParams) {
    
    var movable = this._movableHandles[movableHandle];
    movable.fetch(imagePartParams);
};

FetcherBase.prototype.createRequest = function createRequest(
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
        this, this._scheduler, this._scheduledJobsList, fetchType, contextVars);
    
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

FetcherBase.prototype.manualAbortRequest = function manualAbortRequest(
    requestId) {
    
    var fetchJob = this._requestById[requestId];
    
    if (fetchJob === undefined) {
        // This situation might occur if request has been terminated,
        // but user's terminatedCallback has not been called yet. It
        // happens on WorkerProxyFetcherBase due to web worker
        // message delay.
        
        return;
    }
    
    fetchJob.manualAbortRequest();
    delete this._requestById[requestId];
};

FetcherBase.prototype.setServerRequestPrioritizerData =
    function setServerRequestPrioritizerData(prioritizerData) {

    if (this._serverRequestPrioritizer === null) {
        throw 'imageDecoderFramework error: No serverRequest prioritizer has been set';
    }
    
    if (this._showLog) {
        console.log('setServerRequestPrioritizerData(' + prioritizerData + ')');
    }
    
    prioritizerData.image = this;
    this._serverRequestPrioritizer.setPrioritizerData(prioritizerData);
    this._yieldFetchJobs();
};

FetcherBase.prototype._yieldFetchJobs = function yieldFetchJobs() {
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

function createServerRequestDummyResource() {
    return {};
}
},{"fetch-context.js":10,"fetcher-closer.js":12,"image-helper-functions.js":14,"linked-list.js":15,"simple-movable-fetch.js":16}],12:[function(require,module,exports){
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
	return new Promise(function(resolve, reject) {
		this._resolveClose = resolve;
		if (this._activeFetches === 0) {
			this._resolveClose();
		}
	});
};
},{}],13:[function(require,module,exports){
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
},{}],14:[function(require,module,exports){
'use strict';

var FrustumRequestsPrioritizer = require('frustum-requests-prioritizer.js');

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
        
        scheduler = new resourceScheduler.LifoScheduler(
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
        
        scheduler = new resourceScheduler.PriorityScheduler(
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
    region, image) {
    
    var tileWidth = image.getTileWidth();
    var tileHeight = image.getTileHeight();
    
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
    
    var defaultLevelWidth = image.getImageWidth();
    var defaultLevelHeight = image.getImageHeight();
    if (regionMaxX < 0 || regionMinX >= defaultLevelWidth ||
        regionMaxY < 0 || regionMinY >= defaultLevelHeight) {
        
        return null;
    }
    
    //var maxLevel =
    //    image.getDefaultNumResolutionLevels() - 1;

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
},{"frustum-requests-prioritizer.js":13}],15:[function(require,module,exports){
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
        throw 'imageDecoderFramework error: iterator must be of the current LinkedList';
    }
};
},{}],16:[function(require,module,exports){
'use strict';

module.exports = SimpleMovableFetch;
function SimpleMovableFetch(){}
var LinkedList = require('linked-list.js');
var FetchContextApi = require('fetch-context-api.js');

var FETCH_STATE_WAIT_FOR_MOVE = 1;
var FETCH_STATE_ACTIVE = 2;
var FETCH_STATE_STOPPING = 3;
var FETCH_STATE_STOPPED = 4;
var FETCH_STATE_TERMINATED = 5;

function SimpleMovableFetch(fetcher, fetcherCloser, fetchContext, maxActiveFetchesInMovableFetch) {
	this._fetcher = fetcher;
	this._fetcherCloser = fetcherCloser;
	this._movableFetchContext = fetchContext;
	this._maxActiveFetchesInMovableFetch = maxActiveFetchesInMovableFetch;
	
	this._activeFetchesInMovableFetch = new LinkedList();
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
	var lastActiveFetch = this._getLastFetch();
	if (lastActiveFetch !== null) {
		lastActiveFetch._onEvent('isProgressiveChanged', isProgressive);
	} else {
		this._isProgressiveChangedCalled = true;
	}
};

SimpleMovableFetch.prototype._onStop = function stop(isAborted) {
	this._switchState(FETCH_STATE_STOPPING, FETCH_STATE_ACTIVE);
	var lastActiveFetch = this._getLastFetch();
	if (lastActiveFetch !== null) {
		lastActiveFetch._onEvent('stop', isAborted);
	}
};

SimpleMovableFetch.prototype._onResume = function resume() {
	this._switchState(FETCH_STATE_ACTIVE, FETCH_STATE_STOPPED, FETCH_STATE_STOPPING);

	var lastFetchIterator = this._activeFetchesInMovableFetch.getLastIterator();
	if (lastFetchIterator !== null) {
		throw 'imageDecoderFramework error: resuming non stopped fetch';
	}
	
	var lastFetch = this._activeFetchesInMovableFetch.getValue(lastFetchIterator);
	if (this._isProgressiveChangedCalled) {
		this._isProgressiveChangedCalled = false;
		lastFetch._onEvent('isProgressiveChanged', this._isProgressive);
	}
	lastFetch._onEvent('resume');
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
	if (this._fetcherCloser.isCloseRequested() ||
		this._activeFetchesInMovableFetch.getCount() >= this._maxActiveFetchesInMovableFetch ||
		this._pendingImagePartParams === null ||
		this._movableState !== FETCH_STATE_ACTIVE) {

			return;
	}
	
	var newFetch = {
		imagePartParams: this._pendingImagePartParams,
		state: FETCH_STATE_ACTIVE,

		fetchContext: null,
		parentIterator: null,
		self: this
	};
	
	this._pendingImagePartParams = null;
	newFetch.parentIterator = this._activeFetchesInMovableFetch.add(newFetch);
	
    this._fetcherCloser.changeActiveFetchesCount(+1);
	
	newFetch.fetchContext = new FetchContextApi();
	newFetch.fetchContext.on('internalStopped', onSingleFetchStopped, newFetch);
	newFetch.fetchContext.on('internalDone', onSingleFetchDone, newFetch);
    
    this._fetcher.startFetch(newFetch.fetchContext, newFetch.imagePartParams);
};

SimpleMovableFetch.prototype._singleFetchStopped = function singleFetchStopped(fetch, isDone) {
	this._fetcherCloser.changeActiveFetchesCount(-1);
	this._activeFetchesInMovableFetch.remove(fetch.parentIterator);
	fetch.state = FETCH_STATE_TERMINATED;
	fetch.parentIterator = null;
};

SimpleMovableFetch.prototype._getLastFetch = function getLastFetch() {
	if (this._movableState === FETCH_STATE_STOPPED) {
		return null;
	}
	
	var lastFetchIterator = this._activeFetchesInMovableFetch.getLastIterator();
	if (lastFetchIterator === null) {
		return null;
	}
	
	var lastFetch = this._activeFetchesInMovableFetch.getValue(lastFetchIterator);
	if (lastFetch.state === FETCH_STATE_ACTIVE) {
		return lastFetch.fetchContext;
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
	return	this._activeFetchesInMovableFetch.getNextIterator(fetch.parentIterator) === null &&
			this._pendingImagePartParams === null;
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

	movableFetch._tryStartPendingFetch();
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
},{"fetch-context-api.js":9,"linked-list.js":15}],17:[function(require,module,exports){
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
},{}],18:[function(require,module,exports){
'use strict';

module.exports = ImageViewer;

var imageHelperFunctions = require('image-helper-functions.js');

var PENDING_CALL_TYPE_PIXELS_UPDATED = 1;
var PENDING_CALL_TYPE_REPOSITION = 2;

var REGION_OVERVIEW = 0;
var REGION_DYNAMIC = 1;

function ImageViewer(image, canvasUpdatedCallback, options) {
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
    
    this._image = image;
}

ImageViewer.prototype.setExceptionCallback = function setExceptionCallback(exceptionCallback) {
    // TODO: Support exceptionCallback in every place needed
	this._exceptionCallback = exceptionCallback;
};
    
ImageViewer.prototype.open = function open(url) {
    return this._image.open(url)
        .then(this._opened.bind(this))
        .catch(this._exceptionCallback);
};

ImageViewer.prototype.close = function close() {
    var promise = this._image.close();
    promise.catch(this._exceptionCallback);
    this._isReady = false;
    this._canShowDynamicRegion = false;
    this._targetCanvas = null;
	return promise;
};

ImageViewer.prototype.setTargetCanvas = function setTargetCanvas(canvas) {
    this._targetCanvas = canvas;
};

ImageViewer.prototype.updateViewArea = function updateViewArea(frustumData) {
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
            regionParams, this._image, this._image);
    
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
    
    this._image.setDecodePrioritizerData(frustumData);
    this._image.setServerRequestPrioritizerData(frustumData);

    this._dynamicFetchParams = alignedParams;
    
    var startDynamicRegionOnTermination = false;
    var moveExistingFetch = !this._allowMultipleMovableFetchesInSession;
    this._fetch(
        REGION_DYNAMIC,
        alignedParams,
        startDynamicRegionOnTermination,
        moveExistingFetch);
};

ImageViewer.prototype.getBounds = function getCartographicBounds() {
    if (!this._isReady) {
        throw 'imageDecoderFramework error: ImageViewer error: Image is not ready yet';
    }
    return this._cartographicBoundsFixed;
};

ImageViewer.prototype._isImagePartsEqual = function isImagePartsEqual(first, second) {
    var isEqual =
        this._dynamicFetchParams !== undefined &&
        first.minX === second.minX &&
        first.minY === second.minY &&
        first.maxXExclusive === second.maxXExclusive &&
        first.maxYExclusive === second.maxYExclusive &&
        first.level === second.level;
    
    return isEqual;
};

ImageViewer.prototype._fetch = function fetch(
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

    this._image.requestPixelsProgressive(
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
            startDynamicRegionOnTermination);
    }
};

ImageViewer.prototype._fetchTerminatedCallback = function fetchTerminatedCallback(
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
        this._image.createMovableFetch().then(this._createdMovableFetchBound);
    }
};

ImageViewer.prototype._createdMovableFetch = function createdMovableFetch(movableHandle) {
    this._movableHandle = movableHandle;
    this._startShowingDynamicRegion();
};

ImageViewer.prototype._startShowingDynamicRegion = function startShowingDynamicRegion() {
    this._canShowDynamicRegion = true;
    
    if (this._pendingUpdateViewArea !== null) {
        this.updateViewArea(this._pendingUpdateViewArea);
        
        this._pendingUpdateViewArea = null;
    }
};

ImageViewer.prototype._tilesDecodedCallback = function tilesDecodedCallback(
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

ImageViewer.prototype._checkIfRepositionNeeded = function checkIfRepositionNeeded(
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

ImageViewer.prototype._notifyNewPendingCalls = function notifyNewPendingCalls() {
    if (!this._isNearCallbackCalled) {
        this._callPendingCallbacks();
    }
};

ImageViewer.prototype._callPendingCallbacks = function callPendingCallbacks() {
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
            throw 'imageDecoderFramework error: Internal ImageViewer Error: Unexpected call type ' +
                callArgs.type;
        }
    }
    
    this._pendingCallbackCalls.length = 0;
    
    this._canvasUpdatedCallback(newPosition);
};

ImageViewer.prototype._pixelsUpdated = function pixelsUpdated(pixelsUpdatedArgs) {
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

ImageViewer.prototype._repositionCanvas = function repositionCanvas(repositionArgs) {
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

ImageViewer.prototype._copyOverviewToCanvas = function copyOverviewToCanvas(
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

ImageViewer.prototype._opened = function opened() {
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
    
    var imageWidth  = this._image.getImageWidth ();
    var imageHeight = this._image.getImageHeight();
    this._quality = this._image.getHighestQuality();

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
            overviewParams, this._image, this._image);
            
    overviewAlignedParams.imagePartParams.requestPriorityData =
        overviewAlignedParams.imagePartParams.requestPriorityData || {};
    
    overviewAlignedParams.imagePartParams.requestPriorityData.overrideHighestPriority = true;
    overviewAlignedParams.imagePartParams.quality = this._image.getLowestQuality();
    
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
},{"image-helper-functions.js":14}],19:[function(require,module,exports){
'use strict';

var ImageViewer = require('image-viewer.js');
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
                    this._options.image,
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
},{"image-viewer.js":18,"leaflet-frustum-calculator.js":20}],20:[function(require,module,exports){
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
},{"image-helper-functions.js":14}],21:[function(require,module,exports){
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
},{}],22:[function(require,module,exports){
'use strict';

module.exports = GridFetcherBase;

var FetcherBase = require('fetcher-base.js');
var GridImageBase = require('grid-image-base.js');
var LinkedList = require('linked-list.js');

/* global Promise: false */

function GridFetcherBase(options) {
	FetcherBase.call(this, options);
	this._gridFetcherBaseCache = [];
	this._events = {
		'data': [],
		'tile-terminated': []
	};
}

GridFetcherBase.prototype = Object.create(FetcherBase.prototype);

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
	var tilesToStartDependFetches = [];
	
	var tilesRange = GridImageBase.getTilesRange(this.getImageParams(), imagePartParams);
	fetchData.activeTilesCount = (tilesRange.maxTileX - tilesRange.minTileX) * (tilesRange.maxTileY - tilesRange.minTileY);
	for (var tileX = tilesRange.minTileX; tileX < tilesRange.maxTileX; ++tileX) {
		for (var tileY = tilesRange.minTileY; tileY < tilesRange.maxTileY; ++tileY) {
			var dependFetches = this._addToCache(tileX, tileY, fetchData);
			if (dependFetches === null) {
				continue;
			}

			tilesToStartX.push(tileX);
			tilesToStartY.push(tileY);
			tilesToStartDependFetches.push(dependFetches);
		}
	}
	
	onFetchResume.call(fetchData);
	
	for (var i = 0; i < tilesToStartX.length; ++i) {
		this._loadTile(fetchData.imagePartParams.level, tilesToStartX[i], tilesToStartY[i], tilesToStartDependFetches[i]);
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
		var tileDependFetches = fetchData.tileListeners[i].dependFetches;
		this._changeTilesCountOfTileDependFetches(tileDependFetches, /*singleListenerAddValue=*/addValue, /*activeTilesAddValue=*/0);
	}
};

GridFetcherBase.prototype._changeTilesCountOfTileDependFetches = function(tileDependFetches, singleListenerAddValue, activeTilesAddValue) {
	var singleActiveFetch = null;
	var hasActiveFetches = false;
	var iterator = tileDependFetches.getFirstIterator();
	while (iterator !== null) {
		var fetchData = tileDependFetches.getValue(iterator);
		iterator = tileDependFetches.getNextIterator(iterator);

		fetchData.activeTilesCount += activeTilesAddValue;
		if (fetchData.activeTilesCount === 0) {
			fetchData.isActive = false;
			fetchData.fetchContext.done();
		}

		if (!fetchData.isActive) {
			continue;
		} else if (singleActiveFetch === null) {
			singleActiveFetch = fetchData;
			hasActiveFetches = true;
		} else if (hasActiveFetches) {
			// Not single anymore
			singleActiveFetch = null;
			if (!activeTilesAddValue) {
				break;
			}
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
		fetchData.tileListeners[i].dependFetches.remove(fetchData.tileListeners[i].iterator);
	}
}

GridFetcherBase.prototype._loadTile = function loadTile(level, tileX, tileY, dependFetches) {
	var isTerminated = false;
	var tileKey = {
		fetchWaitTask: true,
		tileX: tileX,
		tileY: tileY,
		level: level
	};
	
	var self = this;
	this.fetchTile(level, tileX, tileY, {
		onData: function(result) {
			if (isTerminated) {
				throw 'imageDecoderFramework error: already terminated in GridFetcherBase.fetchTile()';
			}
			var data = {
				tileKey: tileKey,
				tileContent: result
			};
			for (var i = 0; i < self._events.data.length; ++i) {
				self._events.data[i](data);
			}
		},
		
		onTerminated: function() {
			if (isTerminated) {
				throw 'imageDecoderFramework error: double termination in GridFetcherBase.fetchTile()';
			}
			if (self._gridFetcherBaseCache[level][tileX][tileY] !== dependFetches) {
				throw 'imageDecoderFramework error: Unexpected fetch in GridFetcherBase.gridFetcherBaseCache';
			}
			self._gridFetcherBaseCache[level][tileX][tileY] = null;
			
			for (var i = 0; i < self._events['tile-terminated'].length; ++i) {
				self._events['tile-terminated'][i](tileKey);
			}
			
			self._changeTilesCountOfTileDependFetches(dependFetches, /*singleListenerAddValue=*/-1, /*activeTilesAddValue=*/-1);
		}
	});
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
	
	var dependFetches = xCache[tileY];
	var isSingle = false;
	if (!dependFetches) {
		dependFetches = new LinkedList();
		xCache[tileY] = dependFetches;
		++fetchData.activeTilesCountWithSingleListener;
		isSingle = true;
	}
	
	fetchData.tileListeners.push({
		dependFetches: dependFetches,
		iterator: dependFetches.add(fetchData)
	});
	return isSingle ? dependFetches : null;
};
},{"fetcher-base.js":11,"grid-image-base.js":23,"linked-list.js":15}],23:[function(require,module,exports){
'use strict';

var ImageBase = require('image-base.js');

module.exports = GridImageBase;

/* global Promise: false */

var FETCH_WAIT_TASK = 0;
var DECODE_TASK = 1;

function GridImageBase(fetcher) {
	ImageBase.call(this);
	
	this._fetcher = fetcher;
	this._imageParams = null;
	this._waitingFetches = {};

	this._fetcher.on('data', this._onDataFetched.bind(this));
	this._fetcher.on('tile-terminated', this._onTileTerminated.bind(this));
}

GridImageBase.prototype = Object.create(ImageBase.prototype);

GridImageBase.prototype.getDecodeWorkerTypeOptions = function getDecodeWorkerTypeOptions() {
	throw 'imageDecoderFramework error: GridImageBase.getDecodeWorkerTypeOptions is not implemented by inheritor';
};

GridImageBase.prototype.getDecoderWorkers = function getDecoderWorkers() {
	throw 'imageDecoderFramework error: GridImageBase.getDecoderWorkers is not implemented by inheritor';
};

GridImageBase.prototype.decodeTaskStarted = function decodeTaskStarted(task) {
	var self = this;
	task.on('allDependTasksTerminated', function() {
		self.dataReadyForDecode(task);
		task.terminate();
	});
};

GridImageBase.prototype.getFetcher = function getFetcher() {
	return this._fetcher;
};

// level calculations

GridImageBase.prototype.getLevelWidth = function getLevelWidth(level) {
	var imageParams = this.getImageParams();
	return imageParams.imageWidth * Math.pow(2, level - imageParams.imageLevel);
};

GridImageBase.prototype.getLevelHeight = function getLevelHeight(level) {
	var imageParams = this.getImageParams();
	return imageParams.imageHeight * Math.pow(2, level - imageParams.imageLevel);
};

GridImageBase.prototype.getLevel = function getLevel(regionImageLevel) {
	var imageParams = this.getImageParams();
	
	var log2 = Math.log(2);
	var levelX = Math.log(regionImageLevel.screenWidth  / (regionImageLevel.maxXExclusive - regionImageLevel.minX)) / log2;
	var levelY = Math.log(regionImageLevel.screenHeight / (regionImageLevel.maxYExclusive - regionImageLevel.minY)) / log2;
	var level = Math.ceil(Math.min(levelX, levelY));
	level += imageParams.imageLevel;
	
	return level;
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

GridImageBase.prototype.dataReadyForDecode = function dataReadyForDecode(task) {
	task.dataReady({
		tileContents: task.dependTaskResults,
		tileIndices: task.dependTaskKeys,
		imagePartParams: task.key,
		tileWidth: this._imageParams.tileWidth,
		tileHeight: this._imageParams.tileHeight
	}, DECODE_TASK);
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

},{"image-base.js":6}]},{},[5])(5)
});
//# sourceMappingURL=data:application/json;charset:utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJzcmMvY2VzaXVtLWltYWdlLWRlY29kZXIvY2FudmFzLWltYWdlcnktcHJvdmlkZXIuanMiLCJzcmMvY2VzaXVtLWltYWdlLWRlY29kZXIvY2VzaXVtLWZydXN0dW0tY2FsY3VsYXRvci5qcyIsInNyYy9jZXNpdW0taW1hZ2UtZGVjb2Rlci9jZXNpdW0taW1hZ2UtZGVjb2Rlci1sYXllci1tYW5hZ2VyLmpzIiwic3JjL2Nlc2l1bS1pbWFnZS1kZWNvZGVyL2ltYWdlLWRlY29kZXItaW1hZ2VyeS1wcm92aWRlci5qcyIsInNyYy9pbWFnZS1kZWNvZGVyLWV4cG9ydHMuanMiLCJzcmMvaW1hZ2UtZGVjb2Rlci9pbWFnZS1iYXNlLmpzIiwic3JjL2ltYWdlLWRlY29kZXIvaW1hZ2UtZGVjb2Rlci1oZWxwZXJzL2RlY29kZS1qb2IuanMiLCJzcmMvaW1hZ2UtZGVjb2Rlci9pbWFnZS1kZWNvZGVyLWhlbHBlcnMvZGVjb2RlLWpvYnMtcG9vbC5qcyIsInNyYy9pbWFnZS1kZWNvZGVyL2ltYWdlLWRlY29kZXItaGVscGVycy9mZXRjaC1jb250ZXh0LWFwaS5qcyIsInNyYy9pbWFnZS1kZWNvZGVyL2ltYWdlLWRlY29kZXItaGVscGVycy9mZXRjaC1jb250ZXh0LmpzIiwic3JjL2ltYWdlLWRlY29kZXIvaW1hZ2UtZGVjb2Rlci1oZWxwZXJzL2ZldGNoZXItYmFzZS5qcyIsInNyYy9pbWFnZS1kZWNvZGVyL2ltYWdlLWRlY29kZXItaGVscGVycy9mZXRjaGVyLWNsb3Nlci5qcyIsInNyYy9pbWFnZS1kZWNvZGVyL2ltYWdlLWRlY29kZXItaGVscGVycy9mcnVzdHVtLXJlcXVlc3RzLXByaW9yaXRpemVyLmpzIiwic3JjL2ltYWdlLWRlY29kZXIvaW1hZ2UtZGVjb2Rlci1oZWxwZXJzL2ltYWdlLWhlbHBlci1mdW5jdGlvbnMuanMiLCJzcmMvaW1hZ2UtZGVjb2Rlci9pbWFnZS1kZWNvZGVyLWhlbHBlcnMvbGlua2VkLWxpc3QuanMiLCJzcmMvaW1hZ2UtZGVjb2Rlci9pbWFnZS1kZWNvZGVyLWhlbHBlcnMvc2ltcGxlLW1vdmFibGUtZmV0Y2guanMiLCJzcmMvaW1hZ2UtZGVjb2Rlci9pbWFnZS1kZWNvZGVyLXdvcmtlcnMvaW1hZ2UtcGFyYW1zLXJldHJpZXZlci1wcm94eS5qcyIsInNyYy9pbWFnZS1kZWNvZGVyL2ltYWdlLXZpZXdlci5qcyIsInNyYy9sZWFmbGV0LWltYWdlLWRlY29kZXIvaW1hZ2UtZGVjb2Rlci1yZWdpb24tbGF5ZXIuanMiLCJzcmMvbGVhZmxldC1pbWFnZS1kZWNvZGVyL2xlYWZsZXQtZnJ1c3R1bS1jYWxjdWxhdG9yLmpzIiwic3JjL3NpbXBsZS1mZXRjaGVyL2dyaWQtZGVjb2Rlci13b3JrZXItYmFzZS5qcyIsInNyYy9zaW1wbGUtZmV0Y2hlci9ncmlkLWZldGNoZXItYmFzZS5qcyIsInNyYy9zaW1wbGUtZmV0Y2hlci9ncmlkLWltYWdlLWJhc2UuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7QUNBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdFVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzFGQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2pKQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMva0JBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNYQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNuU0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3hEQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzNJQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMxQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3ZUQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDM01BO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNuQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN6S0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzdOQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzNGQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdExBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2pGQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BuQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMvS0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNuQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNqREE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDcE9BO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EiLCJmaWxlIjoiZ2VuZXJhdGVkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXNDb250ZW50IjpbIihmdW5jdGlvbiBlKHQsbixyKXtmdW5jdGlvbiBzKG8sdSl7aWYoIW5bb10pe2lmKCF0W29dKXt2YXIgYT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2lmKCF1JiZhKXJldHVybiBhKG8sITApO2lmKGkpcmV0dXJuIGkobywhMCk7dmFyIGY9bmV3IEVycm9yKFwiQ2Fubm90IGZpbmQgbW9kdWxlICdcIitvK1wiJ1wiKTt0aHJvdyBmLmNvZGU9XCJNT0RVTEVfTk9UX0ZPVU5EXCIsZn12YXIgbD1uW29dPXtleHBvcnRzOnt9fTt0W29dWzBdLmNhbGwobC5leHBvcnRzLGZ1bmN0aW9uKGUpe3ZhciBuPXRbb11bMV1bZV07cmV0dXJuIHMobj9uOmUpfSxsLGwuZXhwb3J0cyxlLHQsbixyKX1yZXR1cm4gbltvXS5leHBvcnRzfXZhciBpPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7Zm9yKHZhciBvPTA7bzxyLmxlbmd0aDtvKyspcyhyW29dKTtyZXR1cm4gc30pIiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBDYW52YXNJbWFnZXJ5UHJvdmlkZXI7XHJcblxyXG4vKiBnbG9iYWwgQ2VzaXVtOiBmYWxzZSAqL1xyXG4vKiBnbG9iYWwgRGV2ZWxvcGVyRXJyb3I6IGZhbHNlICovXHJcbi8qIGdsb2JhbCBDcmVkaXQ6IGZhbHNlICovXHJcblxyXG4vKipcclxuICogUHJvdmlkZXMgYSBTaW5nbGUgQ2FudmFzIGltYWdlcnkgdGlsZS4gIFRoZSBpbWFnZSBpcyBhc3N1bWVkIHRvIHVzZSBhXHJcbiAqIHtAbGluayBHZW9ncmFwaGljVGlsaW5nU2NoZW1lfS5cclxuICpcclxuICogQGFsaWFzIENhbnZhc0ltYWdlcnlQcm92aWRlclxyXG4gKiBAY29uc3RydWN0b3JcclxuICpcclxuICogQHBhcmFtIHtjYW52YXN9IENhbnZhcyBmb3IgdGhlIHRpbGUuXHJcbiAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zIE9iamVjdCB3aXRoIHRoZSBmb2xsb3dpbmcgcHJvcGVydGllczpcclxuICogQHBhcmFtIHtDcmVkaXR8U3RyaW5nfSBbb3B0aW9ucy5jcmVkaXRdIEEgY3JlZGl0IGZvciB0aGUgZGF0YSBzb3VyY2UsIHdoaWNoIGlzIGRpc3BsYXllZCBvbiB0aGUgY2FudmFzLlxyXG4gKlxyXG4gKiBAc2VlIEFyY0dpc01hcFNlcnZlckltYWdlcnlQcm92aWRlclxyXG4gKiBAc2VlIEJpbmdNYXBzSW1hZ2VyeVByb3ZpZGVyXHJcbiAqIEBzZWUgR29vZ2xlRWFydGhJbWFnZXJ5UHJvdmlkZXJcclxuICogQHNlZSBPcGVuU3RyZWV0TWFwSW1hZ2VyeVByb3ZpZGVyXHJcbiAqIEBzZWUgVGlsZU1hcFNlcnZpY2VJbWFnZXJ5UHJvdmlkZXJcclxuICogQHNlZSBXZWJNYXBTZXJ2aWNlSW1hZ2VyeVByb3ZpZGVyXHJcbiAqL1xyXG5mdW5jdGlvbiBDYW52YXNJbWFnZXJ5UHJvdmlkZXIoY2FudmFzLCBvcHRpb25zKSB7XHJcbiAgICBpZiAob3B0aW9ucyA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgb3B0aW9ucyA9IHt9O1xyXG4gICAgfVxyXG5cclxuICAgIC8vPj5pbmNsdWRlU3RhcnQoJ2RlYnVnJywgcHJhZ21hcy5kZWJ1Zyk7XHJcbiAgICBpZiAoY2FudmFzID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICB0aHJvdyBuZXcgRGV2ZWxvcGVyRXJyb3IoJ2NhbnZhcyBpcyByZXF1aXJlZC4nKTtcclxuICAgIH1cclxuICAgIC8vPj5pbmNsdWRlRW5kKCdkZWJ1ZycpO1xyXG5cclxuICAgIHRoaXMuX2NhbnZhcyA9IGNhbnZhcztcclxuXHJcbiAgICB0aGlzLl9lcnJvckV2ZW50ID0gbmV3IEV2ZW50KCdDYW52YXNJbWFnZXJ5UHJvdmlkZXJTdGF0dXMnKTtcclxuXHJcbiAgICB0aGlzLl9yZWFkeSA9IGZhbHNlO1xyXG5cclxuICAgIHZhciBjcmVkaXQgPSBvcHRpb25zLmNyZWRpdDtcclxuICAgIGlmICh0eXBlb2YgY3JlZGl0ID09PSAnc3RyaW5nJykge1xyXG4gICAgICAgIGNyZWRpdCA9IG5ldyBDcmVkaXQoY3JlZGl0KTtcclxuICAgIH1cclxuICAgIHRoaXMuX2NyZWRpdCA9IGNyZWRpdDtcclxufVxyXG5cclxuQ2FudmFzSW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZSA9IHtcclxuICAgIC8qKlxyXG4gICAgICogR2V0cyB0aGUgd2lkdGggb2YgZWFjaCB0aWxlLCBpbiBwaXhlbHMuIFRoaXMgZnVuY3Rpb24gc2hvdWxkXHJcbiAgICAgKiBub3QgYmUgY2FsbGVkIGJlZm9yZSB7QGxpbmsgQ2FudmFzSW1hZ2VyeVByb3ZpZGVyI3JlYWR5fSByZXR1cm5zIHRydWUuXHJcbiAgICAgKiBAbWVtYmVyb2YgQ2FudmFzSW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZVxyXG4gICAgICogQHR5cGUge051bWJlcn1cclxuICAgICAqIEByZWFkb25seVxyXG4gICAgICovXHJcbiAgICBnZXQgdGlsZVdpZHRoKCkge1xyXG4gICAgICAgICAgICAvLz4+aW5jbHVkZVN0YXJ0KCdkZWJ1ZycsIHByYWdtYXMuZGVidWcpO1xyXG4gICAgICAgICAgICBpZiAoIXRoaXMuX3JlYWR5KSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IERldmVsb3BlckVycm9yKCd0aWxlV2lkdGggbXVzdCBub3QgYmUgY2FsbGVkIGJlZm9yZSB0aGUgaW1hZ2VyeSBwcm92aWRlciBpcyByZWFkeS4nKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAvLz4+aW5jbHVkZUVuZCgnZGVidWcnKTtcclxuXHJcbiAgICAgICAgICAgIHJldHVybiB0aGlzLl9jYW52YXMud2lkdGg7XHJcbiAgICB9LFxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2V0cyB0aGUgaGVpZ2h0IG9mIGVhY2ggdGlsZSwgaW4gcGl4ZWxzLiAgVGhpcyBmdW5jdGlvbiBzaG91bGRcclxuICAgICAqIG5vdCBiZSBjYWxsZWQgYmVmb3JlIHtAbGluayBDYW52YXNJbWFnZXJ5UHJvdmlkZXIjcmVhZHl9IHJldHVybnMgdHJ1ZS5cclxuICAgICAqIEBtZW1iZXJvZiBDYW52YXNJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlXHJcbiAgICAgKiBAdHlwZSB7TnVtYmVyfVxyXG4gICAgICogQHJlYWRvbmx5XHJcbiAgICAgKi9cclxuICAgIGdldCB0aWxlSGVpZ2h0KCkge1xyXG4gICAgICAgICAgICAvLz4+aW5jbHVkZVN0YXJ0KCdkZWJ1ZycsIHByYWdtYXMuZGVidWcpO1xyXG4gICAgICAgICAgICBpZiAoIXRoaXMuX3JlYWR5KSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IERldmVsb3BlckVycm9yKCd0aWxlSGVpZ2h0IG11c3Qgbm90IGJlIGNhbGxlZCBiZWZvcmUgdGhlIGltYWdlcnkgcHJvdmlkZXIgaXMgcmVhZHkuJyk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgLy8+PmluY2x1ZGVFbmQoJ2RlYnVnJyk7XHJcblxyXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5fY2FudmFzLmhlaWdodDtcclxuICAgIH0sXHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZXRzIHRoZSBtYXhpbXVtIGxldmVsLW9mLWRldGFpbCB0aGF0IGNhbiBiZSByZXF1ZXN0ZWQuICBUaGlzIGZ1bmN0aW9uIHNob3VsZFxyXG4gICAgICogbm90IGJlIGNhbGxlZCBiZWZvcmUge0BsaW5rIENhbnZhc0ltYWdlcnlQcm92aWRlciNyZWFkeX0gcmV0dXJucyB0cnVlLlxyXG4gICAgICogQG1lbWJlcm9mIENhbnZhc0ltYWdlcnlQcm92aWRlci5wcm90b3R5cGVcclxuICAgICAqIEB0eXBlIHtOdW1iZXJ9XHJcbiAgICAgKiBAcmVhZG9ubHlcclxuICAgICAqL1xyXG4gICAgZ2V0IG1heGltdW1MZXZlbCgpIHtcclxuICAgICAgICAgICAgLy8+PmluY2x1ZGVTdGFydCgnZGVidWcnLCBwcmFnbWFzLmRlYnVnKTtcclxuICAgICAgICAgICAgaWYgKCF0aGlzLl9yZWFkeSkge1xyXG4gICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBEZXZlbG9wZXJFcnJvcignbWF4aW11bUxldmVsIG11c3Qgbm90IGJlIGNhbGxlZCBiZWZvcmUgdGhlIGltYWdlcnkgcHJvdmlkZXIgaXMgcmVhZHkuJyk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgLy8+PmluY2x1ZGVFbmQoJ2RlYnVnJyk7XHJcblxyXG4gICAgICAgICAgICByZXR1cm4gMDtcclxuICAgIH0sXHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZXRzIHRoZSBtaW5pbXVtIGxldmVsLW9mLWRldGFpbCB0aGF0IGNhbiBiZSByZXF1ZXN0ZWQuICBUaGlzIGZ1bmN0aW9uIHNob3VsZFxyXG4gICAgICogbm90IGJlIGNhbGxlZCBiZWZvcmUge0BsaW5rIENhbnZhc0ltYWdlcnlQcm92aWRlciNyZWFkeX0gcmV0dXJucyB0cnVlLlxyXG4gICAgICogQG1lbWJlcm9mIENhbnZhc0ltYWdlcnlQcm92aWRlci5wcm90b3R5cGVcclxuICAgICAqIEB0eXBlIHtOdW1iZXJ9XHJcbiAgICAgKiBAcmVhZG9ubHlcclxuICAgICAqL1xyXG4gICAgZ2V0IG1pbmltdW1MZXZlbCgpIHtcclxuICAgICAgICAgICAgLy8+PmluY2x1ZGVTdGFydCgnZGVidWcnLCBwcmFnbWFzLmRlYnVnKTtcclxuICAgICAgICAgICAgaWYgKCF0aGlzLl9yZWFkeSkge1xyXG4gICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBEZXZlbG9wZXJFcnJvcignbWluaW11bUxldmVsIG11c3Qgbm90IGJlIGNhbGxlZCBiZWZvcmUgdGhlIGltYWdlcnkgcHJvdmlkZXIgaXMgcmVhZHkuJyk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgLy8+PmluY2x1ZGVFbmQoJ2RlYnVnJyk7XHJcblxyXG4gICAgICAgICAgICByZXR1cm4gMDtcclxuICAgIH0sXHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZXRzIHRoZSB0aWxpbmcgc2NoZW1lIHVzZWQgYnkgdGhpcyBwcm92aWRlci4gIFRoaXMgZnVuY3Rpb24gc2hvdWxkXHJcbiAgICAgKiBub3QgYmUgY2FsbGVkIGJlZm9yZSB7QGxpbmsgQ2FudmFzSW1hZ2VyeVByb3ZpZGVyI3JlYWR5fSByZXR1cm5zIHRydWUuXHJcbiAgICAgKiBAbWVtYmVyb2YgQ2FudmFzSW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZVxyXG4gICAgICogQHR5cGUge1RpbGluZ1NjaGVtZX1cclxuICAgICAqIEByZWFkb25seVxyXG4gICAgICovXHJcbiAgICBnZXQgdGlsaW5nU2NoZW1lKCkge1xyXG4gICAgICAgICAgICAvLz4+aW5jbHVkZVN0YXJ0KCdkZWJ1ZycsIHByYWdtYXMuZGVidWcpO1xyXG4gICAgICAgICAgICBpZiAoIXRoaXMuX3JlYWR5KSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IERldmVsb3BlckVycm9yKCd0aWxpbmdTY2hlbWUgbXVzdCBub3QgYmUgY2FsbGVkIGJlZm9yZSB0aGUgaW1hZ2VyeSBwcm92aWRlciBpcyByZWFkeS4nKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAvLz4+aW5jbHVkZUVuZCgnZGVidWcnKTtcclxuXHJcbiAgICAgICAgICAgIHJldHVybiB0aGlzLl90aWxpbmdTY2hlbWU7XHJcbiAgICB9LFxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2V0cyB0aGUgcmVjdGFuZ2xlLCBpbiByYWRpYW5zLCBvZiB0aGUgaW1hZ2VyeSBwcm92aWRlZCBieSB0aGlzIGluc3RhbmNlLiAgVGhpcyBmdW5jdGlvbiBzaG91bGRcclxuICAgICAqIG5vdCBiZSBjYWxsZWQgYmVmb3JlIHtAbGluayBDYW52YXNJbWFnZXJ5UHJvdmlkZXIjcmVhZHl9IHJldHVybnMgdHJ1ZS5cclxuICAgICAqIEBtZW1iZXJvZiBDYW52YXNJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlXHJcbiAgICAgKiBAdHlwZSB7UmVjdGFuZ2xlfVxyXG4gICAgICogQHJlYWRvbmx5XHJcbiAgICAgKi9cclxuICAgIGdldCByZWN0YW5nbGUoKSB7XHJcbiAgICAgICAgICAgIHJldHVybiB0aGlzLl90aWxpbmdTY2hlbWUucmVjdGFuZ2xlO1xyXG4gICAgfSxcclxuXHJcbiAgICAvKipcclxuICAgICAqIEdldHMgdGhlIHRpbGUgZGlzY2FyZCBwb2xpY3kuICBJZiBub3QgdW5kZWZpbmVkLCB0aGUgZGlzY2FyZCBwb2xpY3kgaXMgcmVzcG9uc2libGVcclxuICAgICAqIGZvciBmaWx0ZXJpbmcgb3V0IFwibWlzc2luZ1wiIHRpbGVzIHZpYSBpdHMgc2hvdWxkRGlzY2FyZEltYWdlIGZ1bmN0aW9uLiAgSWYgdGhpcyBmdW5jdGlvblxyXG4gICAgICogcmV0dXJucyB1bmRlZmluZWQsIG5vIHRpbGVzIGFyZSBmaWx0ZXJlZC4gIFRoaXMgZnVuY3Rpb24gc2hvdWxkXHJcbiAgICAgKiBub3QgYmUgY2FsbGVkIGJlZm9yZSB7QGxpbmsgQ2FudmFzSW1hZ2VyeVByb3ZpZGVyI3JlYWR5fSByZXR1cm5zIHRydWUuXHJcbiAgICAgKiBAbWVtYmVyb2YgQ2FudmFzSW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZVxyXG4gICAgICogQHR5cGUge1RpbGVEaXNjYXJkUG9saWN5fVxyXG4gICAgICogQHJlYWRvbmx5XHJcbiAgICAgKi9cclxuICAgIGdldCB0aWxlRGlzY2FyZFBvbGljeSgpIHtcclxuICAgICAgICAgICAgLy8+PmluY2x1ZGVTdGFydCgnZGVidWcnLCBwcmFnbWFzLmRlYnVnKTtcclxuICAgICAgICAgICAgaWYgKCF0aGlzLl9yZWFkeSkge1xyXG4gICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBEZXZlbG9wZXJFcnJvcigndGlsZURpc2NhcmRQb2xpY3kgbXVzdCBub3QgYmUgY2FsbGVkIGJlZm9yZSB0aGUgaW1hZ2VyeSBwcm92aWRlciBpcyByZWFkeS4nKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAvLz4+aW5jbHVkZUVuZCgnZGVidWcnKTtcclxuXHJcbiAgICAgICAgICAgIHJldHVybiB1bmRlZmluZWQ7XHJcbiAgICB9LFxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2V0cyBhbiBldmVudCB0aGF0IGlzIHJhaXNlZCB3aGVuIHRoZSBpbWFnZXJ5IHByb3ZpZGVyIGVuY291bnRlcnMgYW4gYXN5bmNocm9ub3VzIGVycm9yLiAgQnkgc3Vic2NyaWJpbmdcclxuICAgICAqIHRvIHRoZSBldmVudCwgeW91IHdpbGwgYmUgbm90aWZpZWQgb2YgdGhlIGVycm9yIGFuZCBjYW4gcG90ZW50aWFsbHkgcmVjb3ZlciBmcm9tIGl0LiAgRXZlbnQgbGlzdGVuZXJzXHJcbiAgICAgKiBhcmUgcGFzc2VkIGFuIGluc3RhbmNlIG9mIHtAbGluayBUaWxlUHJvdmlkZXJFcnJvcn0uXHJcbiAgICAgKiBAbWVtYmVyb2YgQ2FudmFzSW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZVxyXG4gICAgICogQHR5cGUge0V2ZW50fVxyXG4gICAgICogQHJlYWRvbmx5XHJcbiAgICAgKi9cclxuICAgIGdldCBlcnJvckV2ZW50KCkge1xyXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5fZXJyb3JFdmVudDtcclxuICAgIH0sXHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZXRzIGEgdmFsdWUgaW5kaWNhdGluZyB3aGV0aGVyIG9yIG5vdCB0aGUgcHJvdmlkZXIgaXMgcmVhZHkgZm9yIHVzZS5cclxuICAgICAqIEBtZW1iZXJvZiBDYW52YXNJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlXHJcbiAgICAgKiBAdHlwZSB7Qm9vbGVhbn1cclxuICAgICAqIEByZWFkb25seVxyXG4gICAgICovXHJcbiAgICBnZXQgcmVhZHkoKSB7XHJcbiAgICAgICAgICAgIHJldHVybiB0aGlzLl9yZWFkeTtcclxuICAgIH0sXHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZXRzIHRoZSBjcmVkaXQgdG8gZGlzcGxheSB3aGVuIHRoaXMgaW1hZ2VyeSBwcm92aWRlciBpcyBhY3RpdmUuICBUeXBpY2FsbHkgdGhpcyBpcyB1c2VkIHRvIGNyZWRpdFxyXG4gICAgICogdGhlIHNvdXJjZSBvZiB0aGUgaW1hZ2VyeS4gIFRoaXMgZnVuY3Rpb24gc2hvdWxkIG5vdCBiZSBjYWxsZWQgYmVmb3JlIHtAbGluayBDYW52YXNJbWFnZXJ5UHJvdmlkZXIjcmVhZHl9IHJldHVybnMgdHJ1ZS5cclxuICAgICAqIEBtZW1iZXJvZiBDYW52YXNJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlXHJcbiAgICAgKiBAdHlwZSB7Q3JlZGl0fVxyXG4gICAgICogQHJlYWRvbmx5XHJcbiAgICAgKi9cclxuICAgIGdldCBjcmVkaXQoKSB7XHJcbiAgICAgICAgICAgIHJldHVybiB0aGlzLl9jcmVkaXQ7XHJcbiAgICB9LFxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2V0cyBhIHZhbHVlIGluZGljYXRpbmcgd2hldGhlciBvciBub3QgdGhlIGltYWdlcyBwcm92aWRlZCBieSB0aGlzIGltYWdlcnkgcHJvdmlkZXJcclxuICAgICAqIGluY2x1ZGUgYW4gYWxwaGEgY2hhbm5lbC4gIElmIHRoaXMgcHJvcGVydHkgaXMgZmFsc2UsIGFuIGFscGhhIGNoYW5uZWwsIGlmIHByZXNlbnQsIHdpbGxcclxuICAgICAqIGJlIGlnbm9yZWQuICBJZiB0aGlzIHByb3BlcnR5IGlzIHRydWUsIGFueSBpbWFnZXMgd2l0aG91dCBhbiBhbHBoYSBjaGFubmVsIHdpbGwgYmUgdHJlYXRlZFxyXG4gICAgICogYXMgaWYgdGhlaXIgYWxwaGEgaXMgMS4wIGV2ZXJ5d2hlcmUuICBXaGVuIHRoaXMgcHJvcGVydHkgaXMgZmFsc2UsIG1lbW9yeSB1c2FnZVxyXG4gICAgICogYW5kIHRleHR1cmUgdXBsb2FkIHRpbWUgYXJlIHJlZHVjZWQuXHJcbiAgICAgKiBAbWVtYmVyb2YgQ2FudmFzSW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZVxyXG4gICAgICogQHR5cGUge0Jvb2xlYW59XHJcbiAgICAgKiBAcmVhZG9ubHlcclxuICAgICAqL1xyXG4gICAgZ2V0IGhhc0FscGhhQ2hhbm5lbCgpIHtcclxuICAgICAgICAgICAgcmV0dXJuIHRydWU7XHJcbiAgICB9XHJcbn07XHJcblxyXG5DYW52YXNJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlLnNldFJlY3RhbmdsZSA9IGZ1bmN0aW9uIHNldFJlY3RhbmdsZShyZWN0YW5nbGUpIHtcclxuICAgIFxyXG4gICAgdGhpcy5fdGlsaW5nU2NoZW1lID0gbmV3IENlc2l1bS5HZW9ncmFwaGljVGlsaW5nU2NoZW1lKHtcclxuICAgICAgICByZWN0YW5nbGU6IHJlY3RhbmdsZSxcclxuICAgICAgICBudW1iZXJPZkxldmVsWmVyb1RpbGVzWDogMSxcclxuICAgICAgICBudW1iZXJPZkxldmVsWmVyb1RpbGVzWTogMVxyXG4gICAgfSk7XHJcbiAgICBcclxuICAgIGlmICghdGhpcy5fcmVhZHkpIHtcclxuICAgICAgICB0aGlzLl9yZWFkeSA9IHRydWU7XHJcbiAgICAgICAgQ2VzaXVtLlRpbGVQcm92aWRlckVycm9yLmhhbmRsZVN1Y2Nlc3ModGhpcy5fZXJyb3JFdmVudCk7XHJcbiAgICB9XHJcbn07XHJcblxyXG5DYW52YXNJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlLmdldFRpbGVXaWR0aCA9IGZ1bmN0aW9uIGdldFRpbGVXaWR0aCgpIHtcclxuICAgIHJldHVybiB0aGlzLnRpbGVXaWR0aDtcclxufTtcclxuXHJcbkNhbnZhc0ltYWdlcnlQcm92aWRlci5wcm90b3R5cGUuZ2V0VGlsZUhlaWdodCA9IGZ1bmN0aW9uIGdldFRpbGVIZWlnaHQoKSB7XHJcbiAgICByZXR1cm4gdGhpcy50aWxlSGVpZ2h0O1xyXG59O1xyXG5cclxuQ2FudmFzSW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5nZXRNYXhpbXVtTGV2ZWwgPSBmdW5jdGlvbiBnZXRNYXhpbXVtTGV2ZWwoKSB7XHJcbiAgICByZXR1cm4gdGhpcy5tYXhpbXVtTGV2ZWw7XHJcbn07XHJcblxyXG5DYW52YXNJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlLmdldE1pbmltdW1MZXZlbCA9IGZ1bmN0aW9uIGdldE1pbmltdW1MZXZlbCgpIHtcclxuICAgIHJldHVybiB0aGlzLm1pbmltdW1MZXZlbDtcclxufTtcclxuXHJcbkNhbnZhc0ltYWdlcnlQcm92aWRlci5wcm90b3R5cGUuaXNSZWFkeSA9IGZ1bmN0aW9uIGlzUmVhZHkoKSB7XHJcbiAgICByZXR1cm4gdGhpcy5yZWFkeTtcclxufTtcclxuXHJcbkNhbnZhc0ltYWdlcnlQcm92aWRlci5wcm90b3R5cGUuZ2V0Q3JlZGl0ID0gZnVuY3Rpb24gZ2V0Q3JlZGl0KCkge1xyXG4gICAgcmV0dXJuIHRoaXMuY3JlZGl0O1xyXG59O1xyXG5cclxuQ2FudmFzSW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5nZXRSZWN0YW5nbGUgPSBmdW5jdGlvbiBnZXRSZWN0YW5nbGUoKSB7XHJcbiAgICByZXR1cm4gdGhpcy50aWxpbmdTY2hlbWUucmVjdGFuZ2xlO1xyXG59O1xyXG5cclxuQ2FudmFzSW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5nZXRUaWxpbmdTY2hlbWUgPSBmdW5jdGlvbiBnZXRUaWxpbmdTY2hlbWUoKSB7XHJcbiAgICByZXR1cm4gdGhpcy50aWxpbmdTY2hlbWU7XHJcbn07XHJcblxyXG5DYW52YXNJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlLmdldFRpbGVEaXNjYXJkUG9saWN5ID0gZnVuY3Rpb24gZ2V0VGlsZURpc2NhcmRQb2xpY3koKSB7XHJcbiAgICByZXR1cm4gdGhpcy50aWxlRGlzY2FyZFBvbGljeTtcclxufTtcclxuXHJcbkNhbnZhc0ltYWdlcnlQcm92aWRlci5wcm90b3R5cGUuZ2V0RXJyb3JFdmVudCA9IGZ1bmN0aW9uIGdldEVycm9yRXZlbnQoKSB7XHJcbiAgICByZXR1cm4gdGhpcy5lcnJvckV2ZW50O1xyXG59O1xyXG5cclxuQ2FudmFzSW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5nZXRIYXNBbHBoYUNoYW5uZWwgPSBmdW5jdGlvbiBnZXRIYXNBbHBoYUNoYW5uZWwoKSB7XHJcbiAgICByZXR1cm4gdGhpcy5oYXNBbHBoYUNoYW5uZWw7XHJcbn07XHJcblxyXG4vKipcclxuICogR2V0cyB0aGUgY3JlZGl0cyB0byBiZSBkaXNwbGF5ZWQgd2hlbiBhIGdpdmVuIHRpbGUgaXMgZGlzcGxheWVkLlxyXG4gKlxyXG4gKiBAcGFyYW0ge051bWJlcn0geCBUaGUgdGlsZSBYIGNvb3JkaW5hdGUuXHJcbiAqIEBwYXJhbSB7TnVtYmVyfSB5IFRoZSB0aWxlIFkgY29vcmRpbmF0ZS5cclxuICogQHBhcmFtIHtOdW1iZXJ9IGxldmVsIFRoZSB0aWxlIGxldmVsO1xyXG4gKiBAcmV0dXJucyB7Q3JlZGl0W119IFRoZSBjcmVkaXRzIHRvIGJlIGRpc3BsYXllZCB3aGVuIHRoZSB0aWxlIGlzIGRpc3BsYXllZC5cclxuICpcclxuICogQGV4Y2VwdGlvbiB7RGV2ZWxvcGVyRXJyb3J9IDxjb2RlPmdldFRpbGVDcmVkaXRzPC9jb2RlPiBtdXN0IG5vdCBiZSBjYWxsZWQgYmVmb3JlIHRoZSBpbWFnZXJ5IHByb3ZpZGVyIGlzIHJlYWR5LlxyXG4gKi9cclxuQ2FudmFzSW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5nZXRUaWxlQ3JlZGl0cyA9IGZ1bmN0aW9uKHgsIHksIGxldmVsKSB7XHJcbiAgICByZXR1cm4gdW5kZWZpbmVkO1xyXG59O1xyXG5cclxuLyoqXHJcbiAqIFJlcXVlc3RzIHRoZSBpbWFnZSBmb3IgYSBnaXZlbiB0aWxlLiAgVGhpcyBmdW5jdGlvbiBzaG91bGRcclxuICogbm90IGJlIGNhbGxlZCBiZWZvcmUge0BsaW5rIENhbnZhc0ltYWdlcnlQcm92aWRlciNyZWFkeX0gcmV0dXJucyB0cnVlLlxyXG4gKlxyXG4gKiBAcGFyYW0ge051bWJlcn0geCBUaGUgdGlsZSBYIGNvb3JkaW5hdGUuXHJcbiAqIEBwYXJhbSB7TnVtYmVyfSB5IFRoZSB0aWxlIFkgY29vcmRpbmF0ZS5cclxuICogQHBhcmFtIHtOdW1iZXJ9IGxldmVsIFRoZSB0aWxlIGxldmVsLlxyXG4gKiBAcmV0dXJucyB7UHJvbWlzZX0gQSBwcm9taXNlIGZvciB0aGUgaW1hZ2UgdGhhdCB3aWxsIHJlc29sdmUgd2hlbiB0aGUgaW1hZ2UgaXMgYXZhaWxhYmxlLCBvclxyXG4gKiAgICAgICAgICB1bmRlZmluZWQgaWYgdGhlcmUgYXJlIHRvbyBtYW55IGFjdGl2ZSByZXF1ZXN0cyB0byB0aGUgc2VydmVyLCBhbmQgdGhlIHJlcXVlc3RcclxuICogICAgICAgICAgc2hvdWxkIGJlIHJldHJpZWQgbGF0ZXIuICBUaGUgcmVzb2x2ZWQgaW1hZ2UgbWF5IGJlIGVpdGhlciBhblxyXG4gKiAgICAgICAgICBJbWFnZSBvciBhIENhbnZhcyBET00gb2JqZWN0LlxyXG4gKlxyXG4gKiBAZXhjZXB0aW9uIHtEZXZlbG9wZXJFcnJvcn0gPGNvZGU+cmVxdWVzdEltYWdlPC9jb2RlPiBtdXN0IG5vdCBiZSBjYWxsZWQgYmVmb3JlIHRoZSBpbWFnZXJ5IHByb3ZpZGVyIGlzIHJlYWR5LlxyXG4gKi9cclxuQ2FudmFzSW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5yZXF1ZXN0SW1hZ2UgPSBmdW5jdGlvbih4LCB5LCBsZXZlbCkge1xyXG4gICAgLy8+PmluY2x1ZGVTdGFydCgnZGVidWcnLCBwcmFnbWFzLmRlYnVnKTtcclxuICAgIGlmICghdGhpcy5fcmVhZHkpIHtcclxuICAgICAgICAgICAgdGhyb3cgbmV3IERldmVsb3BlckVycm9yKCdyZXF1ZXN0SW1hZ2UgbXVzdCBub3QgYmUgY2FsbGVkIGJlZm9yZSB0aGUgaW1hZ2VyeSBwcm92aWRlciBpcyByZWFkeS4nKTtcclxuICAgIH1cclxuICAgIC8vPj5pbmNsdWRlRW5kKCdkZWJ1ZycpO1xyXG5cclxuICAgIHJldHVybiB0aGlzLl9jYW52YXM7XHJcbn07XHJcblxyXG4vKipcclxuICogUGlja2luZyBmZWF0dXJlcyBpcyBub3QgY3VycmVudGx5IHN1cHBvcnRlZCBieSB0aGlzIGltYWdlcnkgcHJvdmlkZXIsIHNvIHRoaXMgZnVuY3Rpb24gc2ltcGx5IHJldHVybnNcclxuICogdW5kZWZpbmVkLlxyXG4gKlxyXG4gKiBAcGFyYW0ge051bWJlcn0geCBUaGUgdGlsZSBYIGNvb3JkaW5hdGUuXHJcbiAqIEBwYXJhbSB7TnVtYmVyfSB5IFRoZSB0aWxlIFkgY29vcmRpbmF0ZS5cclxuICogQHBhcmFtIHtOdW1iZXJ9IGxldmVsIFRoZSB0aWxlIGxldmVsLlxyXG4gKiBAcGFyYW0ge051bWJlcn0gbG9uZ2l0dWRlIFRoZSBsb25naXR1ZGUgYXQgd2hpY2ggdG8gcGljayBmZWF0dXJlcy5cclxuICogQHBhcmFtIHtOdW1iZXJ9IGxhdGl0dWRlICBUaGUgbGF0aXR1ZGUgYXQgd2hpY2ggdG8gcGljayBmZWF0dXJlcy5cclxuICogQHJldHVybiB7UHJvbWlzZX0gQSBwcm9taXNlIGZvciB0aGUgcGlja2VkIGZlYXR1cmVzIHRoYXQgd2lsbCByZXNvbHZlIHdoZW4gdGhlIGFzeW5jaHJvbm91c1xyXG4gKiAgICAgICAgICAgICAgICAgICBwaWNraW5nIGNvbXBsZXRlcy4gIFRoZSByZXNvbHZlZCB2YWx1ZSBpcyBhbiBhcnJheSBvZiB7QGxpbmsgSW1hZ2VyeUxheWVyRmVhdHVyZUluZm99XHJcbiAqICAgICAgICAgICAgICAgICAgIGluc3RhbmNlcy4gIFRoZSBhcnJheSBtYXkgYmUgZW1wdHkgaWYgbm8gZmVhdHVyZXMgYXJlIGZvdW5kIGF0IHRoZSBnaXZlbiBsb2NhdGlvbi5cclxuICogICAgICAgICAgICAgICAgICAgSXQgbWF5IGFsc28gYmUgdW5kZWZpbmVkIGlmIHBpY2tpbmcgaXMgbm90IHN1cHBvcnRlZC5cclxuICovXHJcbkNhbnZhc0ltYWdlcnlQcm92aWRlci5wcm90b3R5cGUucGlja0ZlYXR1cmVzID0gZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcclxufTsiLCIndXNlIHN0cmljdCc7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IGNhbGN1bGF0ZUZydXN0dW07XHJcblxyXG4vKiBnbG9iYWwgQ2VzaXVtOiBmYWxzZSAqL1xyXG5cclxudmFyIGltYWdlSGVscGVyRnVuY3Rpb25zID0gcmVxdWlyZSgnaW1hZ2UtaGVscGVyLWZ1bmN0aW9ucy5qcycpO1xyXG5cclxudmFyIE1BWF9SRUNVUlNJVkVfTEVWRUxfT05fRkFJTEVEX1RSQU5TRk9STSA9IDQ7XHJcblxyXG5mdW5jdGlvbiBjYWxjdWxhdGVGcnVzdHVtKGNlc2l1bVdpZGdldCkge1xyXG4gICAgdmFyIHNjcmVlblNpemUgPSB7XHJcbiAgICAgICAgeDogY2VzaXVtV2lkZ2V0LnNjZW5lLmNhbnZhcy53aWR0aCxcclxuICAgICAgICB5OiBjZXNpdW1XaWRnZXQuc2NlbmUuY2FudmFzLmhlaWdodFxyXG4gICAgfTtcclxuICAgIFxyXG4gICAgdmFyIHBvaW50cyA9IFtdO1xyXG4gICAgc2VhcmNoQm91bmRpbmdQb2ludHMoXHJcbiAgICAgICAgMCwgMCwgc2NyZWVuU2l6ZS54LCBzY3JlZW5TaXplLnksIHBvaW50cywgY2VzaXVtV2lkZ2V0LCAvKnJlY3Vyc2l2ZT0qLzApO1xyXG5cclxuICAgIHZhciBmcnVzdHVtUmVjdGFuZ2xlID0gQ2VzaXVtLlJlY3RhbmdsZS5mcm9tQ2FydG9ncmFwaGljQXJyYXkocG9pbnRzKTtcclxuICAgIGlmIChmcnVzdHVtUmVjdGFuZ2xlLmVhc3QgPCBmcnVzdHVtUmVjdGFuZ2xlLndlc3QgfHwgZnJ1c3R1bVJlY3RhbmdsZS5ub3J0aCA8IGZydXN0dW1SZWN0YW5nbGUuc291dGgpIHtcclxuICAgICAgICBmcnVzdHVtUmVjdGFuZ2xlID0ge1xyXG4gICAgICAgICAgICBlYXN0OiBNYXRoLm1heChmcnVzdHVtUmVjdGFuZ2xlLmVhc3QsIGZydXN0dW1SZWN0YW5nbGUud2VzdCksXHJcbiAgICAgICAgICAgIHdlc3Q6IE1hdGgubWluKGZydXN0dW1SZWN0YW5nbGUuZWFzdCwgZnJ1c3R1bVJlY3RhbmdsZS53ZXN0KSxcclxuICAgICAgICAgICAgbm9ydGg6IE1hdGgubWF4KGZydXN0dW1SZWN0YW5nbGUubm9ydGgsIGZydXN0dW1SZWN0YW5nbGUuc291dGgpLFxyXG4gICAgICAgICAgICBzb3V0aDogTWF0aC5taW4oZnJ1c3R1bVJlY3RhbmdsZS5ub3J0aCwgZnJ1c3R1bVJlY3RhbmdsZS5zb3V0aClcclxuICAgICAgICB9O1xyXG4gICAgfVxyXG5cclxuICAgIHZhciBmcnVzdHVtRGF0YSA9IGltYWdlSGVscGVyRnVuY3Rpb25zLmNhbGN1bGF0ZUZydXN0dW0yREZyb21Cb3VuZHMoXHJcbiAgICAgICAgZnJ1c3R1bVJlY3RhbmdsZSwgc2NyZWVuU2l6ZSk7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgIHJldHVybiBmcnVzdHVtRGF0YTtcclxufVxyXG4gICAgXHJcbmZ1bmN0aW9uIHNlYXJjaEJvdW5kaW5nUG9pbnRzKFxyXG4gICAgbWluWCwgbWluWSwgbWF4WCwgbWF4WSwgcG9pbnRzLCBjZXNpdW1XaWRnZXQsIHJlY3Vyc2l2ZUxldmVsKSB7XHJcbiAgICBcclxuICAgIHZhciB0cmFuc2Zvcm1lZFBvaW50cyA9IDA7XHJcbiAgICB0cmFuc2Zvcm1lZFBvaW50cyArPSB0cmFuc2Zvcm1BbmRBZGRQb2ludChcclxuICAgICAgICBtaW5YLCBtaW5ZLCBjZXNpdW1XaWRnZXQsIHBvaW50cyk7XHJcbiAgICB0cmFuc2Zvcm1lZFBvaW50cyArPSB0cmFuc2Zvcm1BbmRBZGRQb2ludChcclxuICAgICAgICBtYXhYLCBtaW5ZLCBjZXNpdW1XaWRnZXQsIHBvaW50cyk7XHJcbiAgICB0cmFuc2Zvcm1lZFBvaW50cyArPSB0cmFuc2Zvcm1BbmRBZGRQb2ludChcclxuICAgICAgICBtaW5YLCBtYXhZLCBjZXNpdW1XaWRnZXQsIHBvaW50cyk7XHJcbiAgICB0cmFuc2Zvcm1lZFBvaW50cyArPSB0cmFuc2Zvcm1BbmRBZGRQb2ludChcclxuICAgICAgICBtYXhYLCBtYXhZLCBjZXNpdW1XaWRnZXQsIHBvaW50cyk7XHJcblxyXG4gICAgdmFyIG1heExldmVsID0gTUFYX1JFQ1VSU0lWRV9MRVZFTF9PTl9GQUlMRURfVFJBTlNGT1JNO1xyXG4gICAgXHJcbiAgICBpZiAodHJhbnNmb3JtZWRQb2ludHMgPT09IDQgfHwgcmVjdXJzaXZlTGV2ZWwgPj0gbWF4TGV2ZWwpIHtcclxuICAgICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBcclxuICAgICsrcmVjdXJzaXZlTGV2ZWw7XHJcbiAgICBcclxuICAgIHZhciBtaWRkbGVYID0gKG1pblggKyBtYXhYKSAvIDI7XHJcbiAgICB2YXIgbWlkZGxlWSA9IChtaW5ZICsgbWF4WSkgLyAyO1xyXG4gICAgXHJcbiAgICBzZWFyY2hCb3VuZGluZ1BvaW50cyhcclxuICAgICAgICBtaW5YLCBtaW5ZLCBtaWRkbGVYLCBtaWRkbGVZLCBwb2ludHMsIGNlc2l1bVdpZGdldCwgcmVjdXJzaXZlTGV2ZWwpO1xyXG5cclxuICAgIHNlYXJjaEJvdW5kaW5nUG9pbnRzKFxyXG4gICAgICAgIG1pblgsIG1pZGRsZVksIG1pZGRsZVgsIG1heFksIHBvaW50cywgY2VzaXVtV2lkZ2V0LCByZWN1cnNpdmVMZXZlbCk7XHJcblxyXG4gICAgc2VhcmNoQm91bmRpbmdQb2ludHMoXHJcbiAgICAgICAgbWlkZGxlWCwgbWluWSwgbWF4WCwgbWlkZGxlWSwgcG9pbnRzLCBjZXNpdW1XaWRnZXQsIHJlY3Vyc2l2ZUxldmVsKTtcclxuXHJcbiAgICBzZWFyY2hCb3VuZGluZ1BvaW50cyhcclxuICAgICAgICBtaWRkbGVYLCBtaWRkbGVZLCBtYXhYLCBtYXhZLCBwb2ludHMsIGNlc2l1bVdpZGdldCwgcmVjdXJzaXZlTGV2ZWwpO1xyXG59XHJcblxyXG5mdW5jdGlvbiB0cmFuc2Zvcm1BbmRBZGRQb2ludCh4LCB5LCBjZXNpdW1XaWRnZXQsIHBvaW50cykge1xyXG4gICAgXHJcbiAgICB2YXIgc2NyZWVuUG9pbnQgPSBuZXcgQ2VzaXVtLkNhcnRlc2lhbjIoeCwgeSk7XHJcbiAgICB2YXIgZWxsaXBzb2lkID0gY2VzaXVtV2lkZ2V0LnNjZW5lLm1hcFByb2plY3Rpb24uZWxsaXBzb2lkO1xyXG4gICAgdmFyIHBvaW50M0QgPSBjZXNpdW1XaWRnZXQuc2NlbmUuY2FtZXJhLnBpY2tFbGxpcHNvaWQoc2NyZWVuUG9pbnQsIGVsbGlwc29pZCk7XHJcbiAgICBcclxuICAgIGlmIChwb2ludDNEID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICByZXR1cm4gMDtcclxuICAgIH1cclxuXHJcbiAgICB2YXIgY2FydGVzaWFuID0gZWxsaXBzb2lkLmNhcnRlc2lhblRvQ2FydG9ncmFwaGljKHBvaW50M0QpO1xyXG4gICAgaWYgKGNhcnRlc2lhbiA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgcmV0dXJuIDA7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHBvaW50cy5wdXNoKGNhcnRlc2lhbik7XHJcbiAgICByZXR1cm4gMTtcclxufSIsIid1c2Ugc3RyaWN0JztcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gQ2VzaXVtSW1hZ2VEZWNvZGVyTGF5ZXJNYW5hZ2VyO1xyXG5cclxudmFyIENhbnZhc0ltYWdlcnlQcm92aWRlciA9IHJlcXVpcmUoJ2NhbnZhcy1pbWFnZXJ5LXByb3ZpZGVyLmpzJyk7XHJcbnZhciBJbWFnZVZpZXdlciA9IHJlcXVpcmUoJ2ltYWdlLXZpZXdlci5qcycpO1xyXG52YXIgY2FsY3VsYXRlQ2VzaXVtRnJ1c3R1bSA9IHJlcXVpcmUoJ2Nlc2l1bS1mcnVzdHVtLWNhbGN1bGF0b3IuanMnKTtcclxuXHJcbi8qIGdsb2JhbCBDZXNpdW06IGZhbHNlICovXHJcblxyXG5mdW5jdGlvbiBDZXNpdW1JbWFnZURlY29kZXJMYXllck1hbmFnZXIoaW1hZ2VEZWNvZGVyLCBvcHRpb25zKSB7XHJcbiAgICB0aGlzLl9vcHRpb25zID0gb3B0aW9ucyB8fCB7fTtcclxuICAgIFxyXG4gICAgaWYgKHRoaXMuX29wdGlvbnMucmVjdGFuZ2xlICE9PSB1bmRlZmluZWQpIHtcclxuICAgICAgICB0aGlzLl9vcHRpb25zID0gSlNPTi5wYXJzZShKU09OLnN0cmluZ2lmeShvcHRpb25zKSk7XHJcbiAgICAgICAgdGhpcy5fb3B0aW9ucy5jYXJ0b2dyYXBoaWNCb3VuZHMgPSB7XHJcbiAgICAgICAgICAgIHdlc3Q6IG9wdGlvbnMucmVjdGFuZ2xlLndlc3QsXHJcbiAgICAgICAgICAgIGVhc3Q6IG9wdGlvbnMucmVjdGFuZ2xlLmVhc3QsXHJcbiAgICAgICAgICAgIHNvdXRoOiBvcHRpb25zLnJlY3RhbmdsZS5zb3V0aCxcclxuICAgICAgICAgICAgbm9ydGg6IG9wdGlvbnMucmVjdGFuZ2xlLm5vcnRoXHJcbiAgICAgICAgfTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgdGhpcy5fb3B0aW9ucy5taW5GdW5jdGlvbkNhbGxJbnRlcnZhbE1pbGxpc2Vjb25kcyA9XHJcbiAgICAgICAgb3B0aW9ucy5taW5GdW5jdGlvbkNhbGxJbnRlcnZhbE1pbGxpc2Vjb25kcyB8fCAxMDA7XHJcbiAgICB0aGlzLl91cmwgPSBvcHRpb25zLnVybDtcclxuXHJcbiAgICB0aGlzLl90YXJnZXRDYW52YXMgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdjYW52YXMnKTtcclxuICAgIHRoaXMuX2ltYWdlcnlQcm92aWRlcnMgPSBbXHJcbiAgICAgICAgbmV3IENhbnZhc0ltYWdlcnlQcm92aWRlcih0aGlzLl90YXJnZXRDYW52YXMpLFxyXG4gICAgICAgIG5ldyBDYW52YXNJbWFnZXJ5UHJvdmlkZXIodGhpcy5fdGFyZ2V0Q2FudmFzKVxyXG4gICAgXTtcclxuICAgIHRoaXMuX2ltYWdlcnlMYXllclNob3duID0gbmV3IENlc2l1bS5JbWFnZXJ5TGF5ZXIodGhpcy5faW1hZ2VyeVByb3ZpZGVyc1swXSk7XHJcbiAgICB0aGlzLl9pbWFnZXJ5TGF5ZXJQZW5kaW5nID0gbmV3IENlc2l1bS5JbWFnZXJ5TGF5ZXIodGhpcy5faW1hZ2VyeVByb3ZpZGVyc1sxXSk7XHJcblxyXG4gICAgdGhpcy5fY2FudmFzVXBkYXRlZENhbGxiYWNrQm91bmQgPSB0aGlzLl9jYW52YXNVcGRhdGVkQ2FsbGJhY2suYmluZCh0aGlzKTtcclxuICAgIFxyXG4gICAgdGhpcy5faXNQZW5kaW5nVXBkYXRlQ2FsbGJhY2sgPSBmYWxzZTtcclxuICAgIHRoaXMuX2lzV2hpbGVSZXBsYWNlTGF5ZXJTaG93biA9IGZhbHNlO1xyXG4gICAgdGhpcy5fcGVuZGluZ1Bvc2l0aW9uUmVjdGFuZ2xlID0gbnVsbDtcclxuICAgIFxyXG4gICAgdGhpcy5faW1hZ2VWaWV3ZXIgPSBuZXcgSW1hZ2VWaWV3ZXIoXHJcbiAgICAgICAgaW1hZ2VEZWNvZGVyLFxyXG4gICAgICAgIHRoaXMuX2NhbnZhc1VwZGF0ZWRDYWxsYmFja0JvdW5kLFxyXG4gICAgICAgIHRoaXMuX29wdGlvbnMpO1xyXG4gICAgXHJcbiAgICB0aGlzLl9pbWFnZVZpZXdlci5zZXRUYXJnZXRDYW52YXModGhpcy5fdGFyZ2V0Q2FudmFzKTtcclxuICAgIFxyXG4gICAgdGhpcy5fdXBkYXRlRnJ1c3R1bUJvdW5kID0gdGhpcy5fdXBkYXRlRnJ1c3R1bS5iaW5kKHRoaXMpO1xyXG4gICAgdGhpcy5fcG9zdFJlbmRlckJvdW5kID0gdGhpcy5fcG9zdFJlbmRlci5iaW5kKHRoaXMpO1xyXG59XHJcblxyXG5DZXNpdW1JbWFnZURlY29kZXJMYXllck1hbmFnZXIucHJvdG90eXBlLnNldEV4Y2VwdGlvbkNhbGxiYWNrID0gZnVuY3Rpb24gc2V0RXhjZXB0aW9uQ2FsbGJhY2soZXhjZXB0aW9uQ2FsbGJhY2spIHtcclxuICAgIHRoaXMuX2ltYWdlVmlld2VyLnNldEV4Y2VwdGlvbkNhbGxiYWNrKGV4Y2VwdGlvbkNhbGxiYWNrKTtcclxufTtcclxuXHJcbkNlc2l1bUltYWdlRGVjb2RlckxheWVyTWFuYWdlci5wcm90b3R5cGUub3BlbiA9IGZ1bmN0aW9uIG9wZW4od2lkZ2V0T3JWaWV3ZXIpIHtcclxuICAgIHRoaXMuX3dpZGdldCA9IHdpZGdldE9yVmlld2VyO1xyXG4gICAgdGhpcy5fbGF5ZXJzID0gd2lkZ2V0T3JWaWV3ZXIuc2NlbmUuaW1hZ2VyeUxheWVycztcclxuICAgIHdpZGdldE9yVmlld2VyLnNjZW5lLnBvc3RSZW5kZXIuYWRkRXZlbnRMaXN0ZW5lcih0aGlzLl9wb3N0UmVuZGVyQm91bmQpO1xyXG4gICAgXHJcbiAgICB0aGlzLl9pbWFnZVZpZXdlci5vcGVuKHRoaXMuX3VybCk7XHJcbiAgICB0aGlzLl9sYXllcnMuYWRkKHRoaXMuX2ltYWdlcnlMYXllclNob3duKTtcclxuICAgIFxyXG4gICAgLy8gTk9URTogSXMgdGhlcmUgYW4gZXZlbnQgaGFuZGxlciB0byByZWdpc3RlciBpbnN0ZWFkP1xyXG4gICAgLy8gKENlc2l1bSdzIGV2ZW50IGNvbnRyb2xsZXJzIG9ubHkgZXhwb3NlIGtleWJvYXJkIGFuZCBtb3VzZVxyXG4gICAgLy8gZXZlbnRzLCBidXQgdGhlcmUgaXMgbm8gZXZlbnQgZm9yIGZydXN0dW0gY2hhbmdlZFxyXG4gICAgLy8gcHJvZ3JhbW1hdGljYWxseSkuXHJcbiAgICB0aGlzLl9pbnRlcnZhbEhhbmRsZSA9IHNldEludGVydmFsKFxyXG4gICAgICAgIHRoaXMuX3VwZGF0ZUZydXN0dW1Cb3VuZCxcclxuICAgICAgICA1MDApO1xyXG59O1xyXG5cclxuQ2VzaXVtSW1hZ2VEZWNvZGVyTGF5ZXJNYW5hZ2VyLnByb3RvdHlwZS5jbG9zZSA9IGZ1bmN0aW9uIGNsb3NlKCkge1xyXG4gICAgdGhpcy5faW1hZ2VWaWV3ZXIuY2xvc2UoKTtcclxuICAgIGNsZWFySW50ZXJ2YWwodGhpcy5faW50ZXJ2YWxIYW5kbGUpO1xyXG5cclxuICAgIHRoaXMuX2xheWVycy5yZW1vdmUodGhpcy5faW1hZ2VyeUxheWVyU2hvd24pO1xyXG4gICAgdGhpcy5fd2lkZ2V0LnJlbW92ZUV2ZW50TGlzdGVuZXIodGhpcy5fcG9zdFJlbmRlckJvdW5kKTtcclxuICAgIGlmICh0aGlzLl9pc1doaWxlUmVwbGFjZUxheWVyU2hvd24pIHtcclxuICAgICAgICB0aGlzLl9pc1doaWxlUmVwbGFjZUxheWVyU2hvd24gPSBmYWxzZTtcclxuICAgICAgICB0aGlzLl9pc1BlbmRpbmdVcGRhdGVDYWxsYmFjayA9IGZhbHNlO1xyXG4gICAgICAgIHRoaXMuX2xheWVycy5yZW1vdmUodGhpcy5faW1hZ2VyeUxheWVyUGVuZGluZyk7XHJcbiAgICB9XHJcbn07XHJcblxyXG5DZXNpdW1JbWFnZURlY29kZXJMYXllck1hbmFnZXIucHJvdG90eXBlLmdldEltYWdlcnlMYXllcnMgPSBmdW5jdGlvbiBnZXRJbWFnZXJ5TGF5ZXJzKCkge1xyXG4gICAgcmV0dXJuIFt0aGlzLl9pbWFnZXJ5TGF5ZXJTaG93biwgdGhpcy5faW1hZ2VyeUxheWVyUGVuZGluZ107XHJcbn07XHJcblxyXG5DZXNpdW1JbWFnZURlY29kZXJMYXllck1hbmFnZXIucHJvdG90eXBlLl91cGRhdGVGcnVzdHVtID0gZnVuY3Rpb24gdXBkYXRlRnJ1c3R1bSgpIHtcclxuICAgIHZhciBmcnVzdHVtID0gY2FsY3VsYXRlQ2VzaXVtRnJ1c3R1bSh0aGlzLl93aWRnZXQpO1xyXG4gICAgaWYgKGZydXN0dW0gIT09IG51bGwpIHtcclxuICAgICAgICB0aGlzLl9pbWFnZVZpZXdlci51cGRhdGVWaWV3QXJlYShmcnVzdHVtKTtcclxuICAgIH1cclxufTtcclxuXHJcbkNlc2l1bUltYWdlRGVjb2RlckxheWVyTWFuYWdlci5wcm90b3R5cGUuX2NhbnZhc1VwZGF0ZWRDYWxsYmFjayA9IGZ1bmN0aW9uIGNhbnZhc1VwZGF0ZWRDYWxsYmFjayhuZXdQb3NpdGlvbikge1xyXG4gICAgaWYgKHRoaXMuX2lzV2hpbGVSZXBsYWNlTGF5ZXJTaG93bikge1xyXG4gICAgICAgIHRoaXMuX2lzUGVuZGluZ1VwZGF0ZUNhbGxiYWNrID0gdHJ1ZTtcclxuICAgICAgICB0aGlzLl9wZW5kaW5nUG9zaXRpb25SZWN0YW5nbGUgPSBuZXdQb3NpdGlvbjtcclxuICAgIH1cclxuICAgIFxyXG4gICAgaWYgKG5ld1Bvc2l0aW9uICE9PSBudWxsKSB7XHJcbiAgICAgICAgdmFyIHJlY3RhbmdsZSA9IG5ldyBDZXNpdW0uUmVjdGFuZ2xlKFxyXG4gICAgICAgICAgICBuZXdQb3NpdGlvbi53ZXN0LFxyXG4gICAgICAgICAgICBuZXdQb3NpdGlvbi5zb3V0aCxcclxuICAgICAgICAgICAgbmV3UG9zaXRpb24uZWFzdCxcclxuICAgICAgICAgICAgbmV3UG9zaXRpb24ubm9ydGgpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHRoaXMuX2ltYWdlcnlQcm92aWRlcnNbMF0uc2V0UmVjdGFuZ2xlKHJlY3RhbmdsZSk7XHJcbiAgICAgICAgdGhpcy5faW1hZ2VyeVByb3ZpZGVyc1sxXS5zZXRSZWN0YW5nbGUocmVjdGFuZ2xlKTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgdGhpcy5fcmVtb3ZlQW5kUmVBZGRMYXllcigpO1xyXG59O1xyXG5cclxuQ2VzaXVtSW1hZ2VEZWNvZGVyTGF5ZXJNYW5hZ2VyLnByb3RvdHlwZS5fcmVtb3ZlQW5kUmVBZGRMYXllciA9IGZ1bmN0aW9uIHJlbW92ZUFuZFJlQWRkTGF5ZXIoKSB7XHJcbiAgICB2YXIgaW5kZXggPSB0aGlzLl9sYXllcnMuaW5kZXhPZih0aGlzLl9pbWFnZXJ5TGF5ZXJTaG93bik7XHJcbiAgICBcclxuICAgIGlmIChpbmRleCA8IDApIHtcclxuICAgICAgICB0aHJvdyAnTGF5ZXIgd2FzIHJlbW92ZWQgZnJvbSB2aWV3ZXJcXCdzIGxheWVycyAgd2l0aG91dCAnICtcclxuICAgICAgICAgICAgJ2Nsb3NpbmcgbGF5ZXIgbWFuYWdlci4gVXNlIENlc2l1bUltYWdlRGVjb2RlckxheWVyTWFuYWdlci4nICtcclxuICAgICAgICAgICAgJ2Nsb3NlKCkgaW5zdGVhZCc7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHRoaXMuX2lzV2hpbGVSZXBsYWNlTGF5ZXJTaG93biA9IHRydWU7XHJcbiAgICB0aGlzLl9sYXllcnMuYWRkKHRoaXMuX2ltYWdlcnlMYXllclBlbmRpbmcsIGluZGV4KTtcclxufTtcclxuXHJcbkNlc2l1bUltYWdlRGVjb2RlckxheWVyTWFuYWdlci5wcm90b3R5cGUuX3Bvc3RSZW5kZXIgPSBmdW5jdGlvbiBwb3N0UmVuZGVyKCkge1xyXG4gICAgaWYgKCF0aGlzLl9pc1doaWxlUmVwbGFjZUxheWVyU2hvd24pXHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgXHJcbiAgICB0aGlzLl9pc1doaWxlUmVwbGFjZUxheWVyU2hvd24gPSBmYWxzZTtcclxuICAgIHRoaXMuX2xheWVycy5yZW1vdmUodGhpcy5faW1hZ2VyeUxheWVyU2hvd24sIC8qZGVzdHJveT0qL2ZhbHNlKTtcclxuICAgIFxyXG4gICAgdmFyIHN3YXAgPSB0aGlzLl9pbWFnZXJ5TGF5ZXJTaG93bjtcclxuICAgIHRoaXMuX2ltYWdlcnlMYXllclNob3duID0gdGhpcy5faW1hZ2VyeUxheWVyUGVuZGluZztcclxuICAgIHRoaXMuX2ltYWdlcnlMYXllclBlbmRpbmcgPSBzd2FwO1xyXG4gICAgXHJcbiAgICBpZiAodGhpcy5faXNQZW5kaW5nVXBkYXRlQ2FsbGJhY2spIHtcclxuICAgICAgICB0aGlzLl9pc1BlbmRpbmdVcGRhdGVDYWxsYmFjayA9IGZhbHNlO1xyXG4gICAgICAgIHRoaXMuX2NhbnZhc1VwZGF0ZWRDYWxsYmFjayh0aGlzLl9wZW5kaW5nUG9zaXRpb25SZWN0YW5nbGUpO1xyXG4gICAgfVxyXG59OyIsIid1c2Ugc3RyaWN0JztcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyO1xyXG5cclxudmFyIGNhbGN1bGF0ZUNlc2l1bUZydXN0dW0gPSByZXF1aXJlKCdjZXNpdW0tZnJ1c3R1bS1jYWxjdWxhdG9yLmpzJyk7XHJcbnZhciBpbWFnZUhlbHBlckZ1bmN0aW9ucyA9IHJlcXVpcmUoJ2ltYWdlLWhlbHBlci1mdW5jdGlvbnMuanMnKTtcclxuXHJcbi8qIGdsb2JhbCBDZXNpdW06IGZhbHNlICovXHJcbi8qIGdsb2JhbCBEZXZlbG9wZXJFcnJvcjogZmFsc2UgKi9cclxuLyogZ2xvYmFsIENyZWRpdDogZmFsc2UgKi9cclxuLyogZ2xvYmFsIFByb21pc2U6IGZhbHNlICovXHJcblxyXG4vKipcclxuICogUHJvdmlkZXMgYSBJbWFnZURlY29kZXIgY2xpZW50IGltYWdlcnkgdGlsZS4gIFRoZSBpbWFnZSBpcyBhc3N1bWVkIHRvIHVzZSBhXHJcbiAqIHtAbGluayBHZW9ncmFwaGljVGlsaW5nU2NoZW1lfS5cclxuICpcclxuICogQGFsaWFzIEltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlclxyXG4gKiBAY29uc3RydWN0b3JcclxuICpcclxuICogQHBhcmFtIHtPYmplY3R9IG9wdGlvbnMgT2JqZWN0IHdpdGggdGhlIGZvbGxvd2luZyBwcm9wZXJ0aWVzOlxyXG4gKiBAcGFyYW0ge1N0cmluZ30gb3B0aW9ucy51cmwgVGhlIHVybCBmb3IgdGhlIHRpbGUuXHJcbiAqIEBwYXJhbSB7UmVjdGFuZ2xlfSBbb3B0aW9ucy5yZWN0YW5nbGU9UmVjdGFuZ2xlLk1BWF9WQUxVRV0gVGhlIHJlY3RhbmdsZSwgaW4gcmFkaWFucywgY292ZXJlZCBieSB0aGUgaW1hZ2UuXHJcbiAqIEBwYXJhbSB7Q3JlZGl0fFN0cmluZ30gW29wdGlvbnMuY3JlZGl0XSBBIGNyZWRpdCBmb3IgdGhlIGRhdGEgc291cmNlLCB3aGljaCBpcyBkaXNwbGF5ZWQgb24gdGhlIGNhbnZhcy5cclxuICogQHBhcmFtIHtPYmplY3R9IFtvcHRpb25zLnByb3h5XSBBIHByb3h5IHRvIHVzZSBmb3IgcmVxdWVzdHMuIFRoaXMgb2JqZWN0IGlzIGV4cGVjdGVkIHRvIGhhdmUgYSBnZXRVUkwgZnVuY3Rpb24gd2hpY2ggcmV0dXJucyB0aGUgcHJveGllZCBVUkwsIGlmIG5lZWRlZC5cclxuICogQHBhcmFtIHtib29sZWFufSBbb3B0aW9ucy5hZGFwdFByb3BvcnRpb25zXSBkZXRlcm1pbmVzIGlmIHRvIGFkYXB0IHRoZSBwcm9wb3J0aW9ucyBvZiB0aGUgcmVjdGFuZ2xlIHByb3ZpZGVkIHRvIHRoZSBpbWFnZSBwaXhlbHMgcHJvcG9ydGlvbnMuXHJcbiAqXHJcbiAqIEBzZWUgQXJjR2lzTWFwU2VydmVySW1hZ2VyeVByb3ZpZGVyXHJcbiAqIEBzZWUgQmluZ01hcHNJbWFnZXJ5UHJvdmlkZXJcclxuICogQHNlZSBHb29nbGVFYXJ0aEltYWdlcnlQcm92aWRlclxyXG4gKiBAc2VlIE9wZW5TdHJlZXRNYXBJbWFnZXJ5UHJvdmlkZXJcclxuICogQHNlZSBUaWxlTWFwU2VydmljZUltYWdlcnlQcm92aWRlclxyXG4gKiBAc2VlIFdlYk1hcFNlcnZpY2VJbWFnZXJ5UHJvdmlkZXJcclxuICovXHJcbmZ1bmN0aW9uIEltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlcihpbWFnZSwgb3B0aW9ucykge1xyXG4gICAgdmFyIHVybCA9IG9wdGlvbnMudXJsO1xyXG4gICAgdGhpcy5fYWRhcHRQcm9wb3J0aW9ucyA9IG9wdGlvbnMuYWRhcHRQcm9wb3J0aW9ucztcclxuICAgIHRoaXMuX3JlY3RhbmdsZSA9IG9wdGlvbnMucmVjdGFuZ2xlO1xyXG4gICAgdGhpcy5fcHJveHkgPSBvcHRpb25zLnByb3h5O1xyXG4gICAgdGhpcy5fdXBkYXRlRnJ1c3R1bUludGVydmFsID0gMTAwMCB8fCBvcHRpb25zLnVwZGF0ZUZydXN0dW1JbnRlcnZhbDtcclxuICAgIHRoaXMuX2NyZWRpdCA9IG9wdGlvbnMuY3JlZGl0O1xyXG4gICAgXHJcbiAgICBpZiAodHlwZW9mIHRoaXMuX2NyZWRpdCA9PT0gJ3N0cmluZycpIHtcclxuICAgICAgICB0aGlzLl9jcmVkaXQgPSBuZXcgQ3JlZGl0KHRoaXMuX2NyZWRpdCk7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGlmICh0aGlzLl9yZWN0YW5nbGUgPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIHRoaXMuX3JlY3RhbmdsZSA9IENlc2l1bS5SZWN0YW5nbGUuZnJvbURlZ3JlZXMoLTE4MCwgLTkwLCAxODAsIDkwKTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgaWYgKHRoaXMuX2FkYXB0UHJvcG9ydGlvbnMgPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIHRoaXMuX2FkYXB0UHJvcG9ydGlvbnMgPSB0cnVlO1xyXG4gICAgfVxyXG5cclxuICAgIG9wdGlvbnMgPSBKU09OLnBhcnNlKEpTT04uc3RyaW5naWZ5KG9wdGlvbnMgfHwge30pKTtcclxuICAgIG9wdGlvbnMuY2FydG9ncmFwaGljQm91bmRzID0ge1xyXG4gICAgICAgIHdlc3Q6IHRoaXMuX3JlY3RhbmdsZS53ZXN0LFxyXG4gICAgICAgIGVhc3Q6IHRoaXMuX3JlY3RhbmdsZS5lYXN0LFxyXG4gICAgICAgIHNvdXRoOiB0aGlzLl9yZWN0YW5nbGUuc291dGgsXHJcbiAgICAgICAgbm9ydGg6IHRoaXMuX3JlY3RhbmdsZS5ub3J0aFxyXG4gICAgfTtcclxuICAgIFxyXG4gICAgLy8+PmluY2x1ZGVTdGFydCgnZGVidWcnLCBwcmFnbWFzLmRlYnVnKTtcclxuICAgIGlmICh1cmwgPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgICAgICB0aHJvdyBuZXcgRGV2ZWxvcGVyRXJyb3IoJ3VybCBpcyByZXF1aXJlZC4nKTtcclxuICAgIH1cclxuICAgIC8vPj5pbmNsdWRlRW5kKCdkZWJ1ZycpO1xyXG5cclxuICAgIHRoaXMuX3VybCA9IHVybDtcclxuXHJcbiAgICB0aGlzLl90aWxpbmdTY2hlbWUgPSB1bmRlZmluZWQ7XHJcblxyXG4gICAgdGhpcy5fdGlsZVdpZHRoID0gMDtcclxuICAgIHRoaXMuX3RpbGVIZWlnaHQgPSAwO1xyXG5cclxuICAgIHRoaXMuX2Vycm9yRXZlbnQgPSBuZXcgRXZlbnQoJ0ltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlclN0YXR1cycpO1xyXG5cclxuICAgIHRoaXMuX3JlYWR5ID0gZmFsc2U7XHJcbiAgICB0aGlzLl9leGNlcHRpb25DYWxsYmFjayA9IG51bGw7XHJcbiAgICB0aGlzLl9jZXNpdW1XaWRnZXQgPSBudWxsO1xyXG4gICAgdGhpcy5fdXBkYXRlRnJ1c3R1bUludGVydmFsSGFuZGxlID0gbnVsbDtcclxuICAgIFxyXG5cclxuICAgIHZhciBpbWFnZVVybCA9IHVybDtcclxuICAgIGlmICh0aGlzLl9wcm94eSAhPT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgLy8gTk9URTogSXMgdGhhdCB0aGUgY29ycmVjdCBsb2dpYz9cclxuICAgICAgICBpbWFnZVVybCA9IHRoaXMuX3Byb3h5LmdldFVSTChpbWFnZVVybCk7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHRoaXMuX2ltYWdlID0gaW1hZ2U7XHJcbiAgICB0aGlzLl91cmwgPSBpbWFnZVVybDtcclxufVxyXG5cclxuSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZSA9IHtcclxuICAgIC8qKlxyXG4gICAgICogR2V0cyB0aGUgVVJMIG9mIHRoZSBJbWFnZURlY29kZXIgc2VydmVyIChpbmNsdWRpbmcgdGFyZ2V0KS5cclxuICAgICAqIEBtZW1iZXJvZiBJbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlXHJcbiAgICAgKiBAdHlwZSB7U3RyaW5nfVxyXG4gICAgICogQHJlYWRvbmx5XHJcbiAgICAgKi9cclxuICAgIGdldCB1cmwoKSB7XHJcbiAgICAgICAgcmV0dXJuIHRoaXMuX3VybDtcclxuICAgIH0sXHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZXRzIHRoZSBwcm94eSB1c2VkIGJ5IHRoaXMgcHJvdmlkZXIuXHJcbiAgICAgKiBAbWVtYmVyb2YgSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZVxyXG4gICAgICogQHR5cGUge1Byb3h5fVxyXG4gICAgICogQHJlYWRvbmx5XHJcbiAgICAgKi9cclxuICAgIGdldCBwcm94eSgpIHtcclxuICAgICAgICByZXR1cm4gdGhpcy5fcHJveHk7XHJcbiAgICB9LFxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2V0cyB0aGUgd2lkdGggb2YgZWFjaCB0aWxlLCBpbiBwaXhlbHMuIFRoaXMgZnVuY3Rpb24gc2hvdWxkXHJcbiAgICAgKiBub3QgYmUgY2FsbGVkIGJlZm9yZSB7QGxpbmsgSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyI3JlYWR5fSByZXR1cm5zIHRydWUuXHJcbiAgICAgKiBAbWVtYmVyb2YgSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZVxyXG4gICAgICogQHR5cGUge051bWJlcn1cclxuICAgICAqIEByZWFkb25seVxyXG4gICAgICovXHJcbiAgICBnZXQgdGlsZVdpZHRoKCkge1xyXG4gICAgICAgIC8vPj5pbmNsdWRlU3RhcnQoJ2RlYnVnJywgcHJhZ21hcy5kZWJ1Zyk7XHJcbiAgICAgICAgaWYgKCF0aGlzLl9yZWFkeSkge1xyXG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IERldmVsb3BlckVycm9yKCd0aWxlV2lkdGggbXVzdCBub3QgYmUgY2FsbGVkIGJlZm9yZSB0aGUgaW1hZ2VyeSBwcm92aWRlciBpcyByZWFkeS4nKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgLy8+PmluY2x1ZGVFbmQoJ2RlYnVnJyk7XHJcblxyXG4gICAgICAgIHJldHVybiB0aGlzLl90aWxlV2lkdGg7XHJcbiAgICB9LFxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2V0cyB0aGUgaGVpZ2h0IG9mIGVhY2ggdGlsZSwgaW4gcGl4ZWxzLiAgVGhpcyBmdW5jdGlvbiBzaG91bGRcclxuICAgICAqIG5vdCBiZSBjYWxsZWQgYmVmb3JlIHtAbGluayBJbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIjcmVhZHl9IHJldHVybnMgdHJ1ZS5cclxuICAgICAqIEBtZW1iZXJvZiBJbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlXHJcbiAgICAgKiBAdHlwZSB7TnVtYmVyfVxyXG4gICAgICogQHJlYWRvbmx5XHJcbiAgICAgKi9cclxuICAgIGdldCB0aWxlSGVpZ2h0KCkge1xyXG4gICAgICAgIC8vPj5pbmNsdWRlU3RhcnQoJ2RlYnVnJywgcHJhZ21hcy5kZWJ1Zyk7XHJcbiAgICAgICAgaWYgKCF0aGlzLl9yZWFkeSkge1xyXG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IERldmVsb3BlckVycm9yKCd0aWxlSGVpZ2h0IG11c3Qgbm90IGJlIGNhbGxlZCBiZWZvcmUgdGhlIGltYWdlcnkgcHJvdmlkZXIgaXMgcmVhZHkuJyk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIC8vPj5pbmNsdWRlRW5kKCdkZWJ1ZycpO1xyXG5cclxuICAgICAgICByZXR1cm4gdGhpcy5fdGlsZUhlaWdodDtcclxuICAgIH0sXHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZXRzIHRoZSBtYXhpbXVtIGxldmVsLW9mLWRldGFpbCB0aGF0IGNhbiBiZSByZXF1ZXN0ZWQuICBUaGlzIGZ1bmN0aW9uIHNob3VsZFxyXG4gICAgICogbm90IGJlIGNhbGxlZCBiZWZvcmUge0BsaW5rIEltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlciNyZWFkeX0gcmV0dXJucyB0cnVlLlxyXG4gICAgICogQG1lbWJlcm9mIEltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlci5wcm90b3R5cGVcclxuICAgICAqIEB0eXBlIHtOdW1iZXJ9XHJcbiAgICAgKiBAcmVhZG9ubHlcclxuICAgICAqL1xyXG4gICAgZ2V0IG1heGltdW1MZXZlbCgpIHtcclxuICAgICAgICAvLz4+aW5jbHVkZVN0YXJ0KCdkZWJ1ZycsIHByYWdtYXMuZGVidWcpO1xyXG4gICAgICAgIGlmICghdGhpcy5fcmVhZHkpIHtcclxuICAgICAgICAgICAgICAgIHRocm93IG5ldyBEZXZlbG9wZXJFcnJvcignbWF4aW11bUxldmVsIG11c3Qgbm90IGJlIGNhbGxlZCBiZWZvcmUgdGhlIGltYWdlcnkgcHJvdmlkZXIgaXMgcmVhZHkuJyk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIC8vPj5pbmNsdWRlRW5kKCdkZWJ1ZycpO1xyXG5cclxuICAgICAgICByZXR1cm4gdGhpcy5fbnVtUmVzb2x1dGlvbkxldmVscyAtIDE7XHJcbiAgICB9LFxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2V0cyB0aGUgbWluaW11bSBsZXZlbC1vZi1kZXRhaWwgdGhhdCBjYW4gYmUgcmVxdWVzdGVkLiAgVGhpcyBmdW5jdGlvbiBzaG91bGRcclxuICAgICAqIG5vdCBiZSBjYWxsZWQgYmVmb3JlIHtAbGluayBJbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIjcmVhZHl9IHJldHVybnMgdHJ1ZS5cclxuICAgICAqIEBtZW1iZXJvZiBJbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlXHJcbiAgICAgKiBAdHlwZSB7TnVtYmVyfVxyXG4gICAgICogQHJlYWRvbmx5XHJcbiAgICAgKi9cclxuICAgIGdldCBtaW5pbXVtTGV2ZWwoKSB7XHJcbiAgICAgICAgLy8+PmluY2x1ZGVTdGFydCgnZGVidWcnLCBwcmFnbWFzLmRlYnVnKTtcclxuICAgICAgICBpZiAoIXRoaXMuX3JlYWR5KSB7XHJcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRGV2ZWxvcGVyRXJyb3IoJ21pbmltdW1MZXZlbCBtdXN0IG5vdCBiZSBjYWxsZWQgYmVmb3JlIHRoZSBpbWFnZXJ5IHByb3ZpZGVyIGlzIHJlYWR5LicpO1xyXG4gICAgICAgIH1cclxuICAgICAgICAvLz4+aW5jbHVkZUVuZCgnZGVidWcnKTtcclxuXHJcbiAgICAgICAgcmV0dXJuIDA7XHJcbiAgICB9LFxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2V0cyB0aGUgdGlsaW5nIHNjaGVtZSB1c2VkIGJ5IHRoaXMgcHJvdmlkZXIuICBUaGlzIGZ1bmN0aW9uIHNob3VsZFxyXG4gICAgICogbm90IGJlIGNhbGxlZCBiZWZvcmUge0BsaW5rIEltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlciNyZWFkeX0gcmV0dXJucyB0cnVlLlxyXG4gICAgICogQG1lbWJlcm9mIEltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlci5wcm90b3R5cGVcclxuICAgICAqIEB0eXBlIHtUaWxpbmdTY2hlbWV9XHJcbiAgICAgKiBAcmVhZG9ubHlcclxuICAgICAqL1xyXG4gICAgZ2V0IHRpbGluZ1NjaGVtZSgpIHtcclxuICAgICAgICAvLz4+aW5jbHVkZVN0YXJ0KCdkZWJ1ZycsIHByYWdtYXMuZGVidWcpO1xyXG4gICAgICAgIGlmICghdGhpcy5fcmVhZHkpIHtcclxuICAgICAgICAgICAgdGhyb3cgbmV3IERldmVsb3BlckVycm9yKCd0aWxpbmdTY2hlbWUgbXVzdCBub3QgYmUgY2FsbGVkIGJlZm9yZSB0aGUgaW1hZ2VyeSBwcm92aWRlciBpcyByZWFkeS4nKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgLy8+PmluY2x1ZGVFbmQoJ2RlYnVnJyk7XHJcblxyXG4gICAgICAgIHJldHVybiB0aGlzLl90aWxpbmdTY2hlbWU7XHJcbiAgICB9LFxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2V0cyB0aGUgcmVjdGFuZ2xlLCBpbiByYWRpYW5zLCBvZiB0aGUgaW1hZ2VyeSBwcm92aWRlZCBieSB0aGlzIGluc3RhbmNlLiAgVGhpcyBmdW5jdGlvbiBzaG91bGRcclxuICAgICAqIG5vdCBiZSBjYWxsZWQgYmVmb3JlIHtAbGluayBJbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIjcmVhZHl9IHJldHVybnMgdHJ1ZS5cclxuICAgICAqIEBtZW1iZXJvZiBJbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlXHJcbiAgICAgKiBAdHlwZSB7UmVjdGFuZ2xlfVxyXG4gICAgICogQHJlYWRvbmx5XHJcbiAgICAgKi9cclxuICAgIGdldCByZWN0YW5nbGUoKSB7XHJcbiAgICAgICAgcmV0dXJuIHRoaXMuX3RpbGluZ1NjaGVtZS5yZWN0YW5nbGU7XHJcbiAgICB9LFxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2V0cyB0aGUgdGlsZSBkaXNjYXJkIHBvbGljeS4gIElmIG5vdCB1bmRlZmluZWQsIHRoZSBkaXNjYXJkIHBvbGljeSBpcyByZXNwb25zaWJsZVxyXG4gICAgICogZm9yIGZpbHRlcmluZyBvdXQgXCJtaXNzaW5nXCIgdGlsZXMgdmlhIGl0cyBzaG91bGREaXNjYXJkSW1hZ2UgZnVuY3Rpb24uICBJZiB0aGlzIGZ1bmN0aW9uXHJcbiAgICAgKiByZXR1cm5zIHVuZGVmaW5lZCwgbm8gdGlsZXMgYXJlIGZpbHRlcmVkLiAgVGhpcyBmdW5jdGlvbiBzaG91bGRcclxuICAgICAqIG5vdCBiZSBjYWxsZWQgYmVmb3JlIHtAbGluayBJbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIjcmVhZHl9IHJldHVybnMgdHJ1ZS5cclxuICAgICAqIEBtZW1iZXJvZiBJbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlXHJcbiAgICAgKiBAdHlwZSB7VGlsZURpc2NhcmRQb2xpY3l9XHJcbiAgICAgKiBAcmVhZG9ubHlcclxuICAgICAqL1xyXG4gICAgZ2V0IHRpbGVEaXNjYXJkUG9saWN5KCkge1xyXG4gICAgICAgIC8vPj5pbmNsdWRlU3RhcnQoJ2RlYnVnJywgcHJhZ21hcy5kZWJ1Zyk7XHJcbiAgICAgICAgaWYgKCF0aGlzLl9yZWFkeSkge1xyXG4gICAgICAgICAgICB0aHJvdyBuZXcgRGV2ZWxvcGVyRXJyb3IoJ3RpbGVEaXNjYXJkUG9saWN5IG11c3Qgbm90IGJlIGNhbGxlZCBiZWZvcmUgdGhlIGltYWdlcnkgcHJvdmlkZXIgaXMgcmVhZHkuJyk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIC8vPj5pbmNsdWRlRW5kKCdkZWJ1ZycpO1xyXG5cclxuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xyXG4gICAgfSxcclxuXHJcbiAgICAvKipcclxuICAgICAqIEdldHMgYW4gZXZlbnQgdGhhdCBpcyByYWlzZWQgd2hlbiB0aGUgaW1hZ2VyeSBwcm92aWRlciBlbmNvdW50ZXJzIGFuIGFzeW5jaHJvbm91cyBlcnJvci4gIEJ5IHN1YnNjcmliaW5nXHJcbiAgICAgKiB0byB0aGUgZXZlbnQsIHlvdSB3aWxsIGJlIG5vdGlmaWVkIG9mIHRoZSBlcnJvciBhbmQgY2FuIHBvdGVudGlhbGx5IHJlY292ZXIgZnJvbSBpdC4gIEV2ZW50IGxpc3RlbmVyc1xyXG4gICAgICogYXJlIHBhc3NlZCBhbiBpbnN0YW5jZSBvZiB7QGxpbmsgVGlsZVByb3ZpZGVyRXJyb3J9LlxyXG4gICAgICogQG1lbWJlcm9mIEltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlci5wcm90b3R5cGVcclxuICAgICAqIEB0eXBlIHtFdmVudH1cclxuICAgICAqIEByZWFkb25seVxyXG4gICAgICovXHJcbiAgICBnZXQgZXJyb3JFdmVudCgpIHtcclxuICAgICAgICByZXR1cm4gdGhpcy5fZXJyb3JFdmVudDtcclxuICAgIH0sXHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZXRzIGEgdmFsdWUgaW5kaWNhdGluZyB3aGV0aGVyIG9yIG5vdCB0aGUgcHJvdmlkZXIgaXMgcmVhZHkgZm9yIHVzZS5cclxuICAgICAqIEBtZW1iZXJvZiBJbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlXHJcbiAgICAgKiBAdHlwZSB7Qm9vbGVhbn1cclxuICAgICAqIEByZWFkb25seVxyXG4gICAgICovXHJcbiAgICBnZXQgcmVhZHkoKSB7XHJcbiAgICAgICAgcmV0dXJuIHRoaXMuX3JlYWR5O1xyXG4gICAgfSxcclxuXHJcbiAgICAvKipcclxuICAgICAqIEdldHMgdGhlIGNyZWRpdCB0byBkaXNwbGF5IHdoZW4gdGhpcyBpbWFnZXJ5IHByb3ZpZGVyIGlzIGFjdGl2ZS4gIFR5cGljYWxseSB0aGlzIGlzIHVzZWQgdG8gY3JlZGl0XHJcbiAgICAgKiB0aGUgc291cmNlIG9mIHRoZSBpbWFnZXJ5LiAgVGhpcyBmdW5jdGlvbiBzaG91bGQgbm90IGJlIGNhbGxlZCBiZWZvcmUge0BsaW5rIEltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlciNyZWFkeX0gcmV0dXJucyB0cnVlLlxyXG4gICAgICogQG1lbWJlcm9mIEltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlci5wcm90b3R5cGVcclxuICAgICAqIEB0eXBlIHtDcmVkaXR9XHJcbiAgICAgKiBAcmVhZG9ubHlcclxuICAgICAqL1xyXG4gICAgZ2V0IGNyZWRpdCgpIHtcclxuICAgICAgICByZXR1cm4gdGhpcy5fY3JlZGl0O1xyXG4gICAgfSxcclxuXHJcbiAgICAvKipcclxuICAgICAqIEdldHMgYSB2YWx1ZSBpbmRpY2F0aW5nIHdoZXRoZXIgb3Igbm90IHRoZSBpbWFnZXMgcHJvdmlkZWQgYnkgdGhpcyBpbWFnZXJ5IHByb3ZpZGVyXHJcbiAgICAgKiBpbmNsdWRlIGFuIGFscGhhIGNoYW5uZWwuICBJZiB0aGlzIHByb3BlcnR5IGlzIGZhbHNlLCBhbiBhbHBoYSBjaGFubmVsLCBpZiBwcmVzZW50LCB3aWxsXHJcbiAgICAgKiBiZSBpZ25vcmVkLiAgSWYgdGhpcyBwcm9wZXJ0eSBpcyB0cnVlLCBhbnkgaW1hZ2VzIHdpdGhvdXQgYW4gYWxwaGEgY2hhbm5lbCB3aWxsIGJlIHRyZWF0ZWRcclxuICAgICAqIGFzIGlmIHRoZWlyIGFscGhhIGlzIDEuMCBldmVyeXdoZXJlLiAgV2hlbiB0aGlzIHByb3BlcnR5IGlzIGZhbHNlLCBtZW1vcnkgdXNhZ2VcclxuICAgICAqIGFuZCB0ZXh0dXJlIHVwbG9hZCB0aW1lIGFyZSByZWR1Y2VkLlxyXG4gICAgICogQG1lbWJlcm9mIEltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlci5wcm90b3R5cGVcclxuICAgICAqIEB0eXBlIHtCb29sZWFufVxyXG4gICAgICogQHJlYWRvbmx5XHJcbiAgICAgKi9cclxuICAgIGdldCBoYXNBbHBoYUNoYW5uZWwoKSB7XHJcbiAgICAgICAgcmV0dXJuIHRydWU7XHJcbiAgICB9XHJcbn07XHJcblxyXG5JbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlLnNldEV4Y2VwdGlvbkNhbGxiYWNrID1cclxuICAgIGZ1bmN0aW9uIHNldEV4Y2VwdGlvbkNhbGxiYWNrKGV4Y2VwdGlvbkNhbGxiYWNrKSB7XHJcbiAgICBcclxuICAgIHRoaXMuX2V4Y2VwdGlvbkNhbGxiYWNrID0gZXhjZXB0aW9uQ2FsbGJhY2s7XHJcbn07XHJcblxyXG5JbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlLm9wZW4gPSBmdW5jdGlvbiBvcGVuKHdpZGdldE9yVmlld2VyKSB7XHJcbiAgICBpZiAodGhpcy5fdXBkYXRlRnJ1c3R1bUludGVydmFsSGFuZGxlICE9PSBudWxsKSB7XHJcbiAgICAgICAgdGhyb3cgbmV3IERldmVsb3BlckVycm9yKCdDYW5ub3Qgc2V0IHR3byBwYXJlbnQgdmlld2Vycy4nKTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgaWYgKHdpZGdldE9yVmlld2VyID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICB0aHJvdyBuZXcgRGV2ZWxvcGVyRXJyb3IoJ3dpZGdldE9yVmlld2VyIHNob3VsZCBiZSBnaXZlbi4gSXQgaXMgJyArXHJcbiAgICAgICAgICAgICduZWVkZWQgZm9yIGZydXN0dW0gY2FsY3VsYXRpb24gZm9yIHRoZSBwcmlvcml0eSBtZWNoYW5pc20nKTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgdGhpcy5faW1hZ2Uub3Blbih0aGlzLl91cmwpXHJcblx0XHQudGhlbih0aGlzLl9vcGVuZWQuYmluZCh0aGlzKSlcclxuXHRcdC5jYXRjaCh0aGlzLl9vbkV4Y2VwdGlvbi5iaW5kKHRoaXMpKTtcclxuICAgIFxyXG4gICAgdGhpcy5fY2VzaXVtV2lkZ2V0ID0gd2lkZ2V0T3JWaWV3ZXI7XHJcbiAgICBcclxuICAgIHRoaXMuX3VwZGF0ZUZydXN0dW1JbnRlcnZhbEhhbmRsZSA9IHNldEludGVydmFsKFxyXG4gICAgICAgIHRoaXMuX3NldFByaW9yaXR5QnlGcnVzdHVtLmJpbmQodGhpcyksXHJcbiAgICAgICAgdGhpcy5fdXBkYXRlRnJ1c3R1bUludGVydmFsKTtcclxufTtcclxuXHJcbkltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlci5wcm90b3R5cGUuY2xvc2UgPSBmdW5jdGlvbiBjbG9zZSgpIHtcclxuICAgIGNsZWFySW50ZXJ2YWwodGhpcy5fdXBkYXRlRnJ1c3R1bUludGVydmFsSGFuZGxlKTtcclxuICAgIHRoaXMuX2ltYWdlLmNsb3NlKCk7XHJcbn07XHJcblxyXG5JbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlLmdldFRpbGVXaWR0aCA9IGZ1bmN0aW9uIGdldFRpbGVXaWR0aCgpIHtcclxuICAgIHJldHVybiB0aGlzLnRpbGVXaWR0aDtcclxufTtcclxuXHJcbkltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlci5wcm90b3R5cGUuZ2V0VGlsZUhlaWdodCA9IGZ1bmN0aW9uIGdldFRpbGVIZWlnaHQoKSB7XHJcbiAgICByZXR1cm4gdGhpcy50aWxlSGVpZ2h0O1xyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5nZXRNYXhpbXVtTGV2ZWwgPSBmdW5jdGlvbiBnZXRNYXhpbXVtTGV2ZWwoKSB7XHJcbiAgICByZXR1cm4gdGhpcy5tYXhpbXVtTGV2ZWw7XHJcbn07XHJcblxyXG5JbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlLmdldE1pbmltdW1MZXZlbCA9IGZ1bmN0aW9uIGdldE1pbmltdW1MZXZlbCgpIHtcclxuICAgIHJldHVybiB0aGlzLm1pbmltdW1MZXZlbDtcclxufTtcclxuXHJcbkltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlci5wcm90b3R5cGUuZ2V0VXJsID0gZnVuY3Rpb24gZ2V0VXJsKCkge1xyXG4gICAgcmV0dXJuIHRoaXMudXJsO1xyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5nZXRQcm94eSA9IGZ1bmN0aW9uIGdldFByb3h5KCkge1xyXG4gICAgcmV0dXJuIHRoaXMucHJveHk7XHJcbn07XHJcblxyXG5JbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlLmlzUmVhZHkgPSBmdW5jdGlvbiBpc1JlYWR5KCkge1xyXG4gICAgcmV0dXJuIHRoaXMucmVhZHk7XHJcbn07XHJcblxyXG5JbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlLmdldENyZWRpdCA9IGZ1bmN0aW9uIGdldENyZWRpdCgpIHtcclxuICAgIHJldHVybiB0aGlzLmNyZWRpdDtcclxufTtcclxuXHJcbkltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlci5wcm90b3R5cGUuZ2V0UmVjdGFuZ2xlID0gZnVuY3Rpb24gZ2V0UmVjdGFuZ2xlKCkge1xyXG4gICAgcmV0dXJuIHRoaXMudGlsaW5nU2NoZW1lLnJlY3RhbmdsZTtcclxufTtcclxuXHJcbkltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlci5wcm90b3R5cGUuZ2V0VGlsaW5nU2NoZW1lID0gZnVuY3Rpb24gZ2V0VGlsaW5nU2NoZW1lKCkge1xyXG4gICAgcmV0dXJuIHRoaXMudGlsaW5nU2NoZW1lO1xyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5nZXRUaWxlRGlzY2FyZFBvbGljeSA9IGZ1bmN0aW9uIGdldFRpbGVEaXNjYXJkUG9saWN5KCkge1xyXG4gICAgcmV0dXJuIHRoaXMudGlsZURpc2NhcmRQb2xpY3k7XHJcbn07XHJcblxyXG5JbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlLmdldEVycm9yRXZlbnQgPSBmdW5jdGlvbiBnZXRFcnJvckV2ZW50KCkge1xyXG4gICAgcmV0dXJuIHRoaXMuZXJyb3JFdmVudDtcclxufTtcclxuXHJcbkltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlci5wcm90b3R5cGUuZ2V0SGFzQWxwaGFDaGFubmVsID0gZnVuY3Rpb24gZ2V0SGFzQWxwaGFDaGFubmVsKCkge1xyXG4gICAgcmV0dXJuIHRoaXMuaGFzQWxwaGFDaGFubmVsO1xyXG59O1xyXG5cclxuLyoqXHJcbiAqIEdldHMgdGhlIGNyZWRpdHMgdG8gYmUgZGlzcGxheWVkIHdoZW4gYSBnaXZlbiB0aWxlIGlzIGRpc3BsYXllZC5cclxuICpcclxuICogQHBhcmFtIHtOdW1iZXJ9IHggVGhlIHRpbGUgWCBjb29yZGluYXRlLlxyXG4gKiBAcGFyYW0ge051bWJlcn0geSBUaGUgdGlsZSBZIGNvb3JkaW5hdGUuXHJcbiAqIEBwYXJhbSB7TnVtYmVyfSBsZXZlbCBUaGUgdGlsZSBsZXZlbDtcclxuICogQHJldHVybnMge0NyZWRpdFtdfSBUaGUgY3JlZGl0cyB0byBiZSBkaXNwbGF5ZWQgd2hlbiB0aGUgdGlsZSBpcyBkaXNwbGF5ZWQuXHJcbiAqXHJcbiAqIEBleGNlcHRpb24ge0RldmVsb3BlckVycm9yfSA8Y29kZT5nZXRUaWxlQ3JlZGl0czwvY29kZT4gbXVzdCBub3QgYmUgY2FsbGVkIGJlZm9yZSB0aGUgaW1hZ2VyeSBwcm92aWRlciBpcyByZWFkeS5cclxuICovXHJcbkltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlci5wcm90b3R5cGUuZ2V0VGlsZUNyZWRpdHMgPSBmdW5jdGlvbih4LCB5LCBsZXZlbCkge1xyXG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcclxufTtcclxuXHJcbi8qKlxyXG4gKiBSZXF1ZXN0cyB0aGUgaW1hZ2UgZm9yIGEgZ2l2ZW4gdGlsZS4gIFRoaXMgZnVuY3Rpb24gc2hvdWxkXHJcbiAqIG5vdCBiZSBjYWxsZWQgYmVmb3JlIHtAbGluayBJbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIjcmVhZHl9IHJldHVybnMgdHJ1ZS5cclxuICpcclxuICogQHBhcmFtIHtOdW1iZXJ9IHggVGhlIHRpbGUgWCBjb29yZGluYXRlLlxyXG4gKiBAcGFyYW0ge051bWJlcn0geSBUaGUgdGlsZSBZIGNvb3JkaW5hdGUuXHJcbiAqIEBwYXJhbSB7TnVtYmVyfSBsZXZlbCBUaGUgdGlsZSBsZXZlbC5cclxuICogQHJldHVybnMge1Byb21pc2V9IEEgcHJvbWlzZSBmb3IgdGhlIGltYWdlIHRoYXQgd2lsbCByZXNvbHZlIHdoZW4gdGhlIGltYWdlIGlzIGF2YWlsYWJsZSwgb3JcclxuICogICAgICAgICAgdW5kZWZpbmVkIGlmIHRoZXJlIGFyZSB0b28gbWFueSBhY3RpdmUgcmVxdWVzdHMgdG8gdGhlIHNlcnZlciwgYW5kIHRoZSByZXF1ZXN0XHJcbiAqICAgICAgICAgIHNob3VsZCBiZSByZXRyaWVkIGxhdGVyLiAgVGhlIHJlc29sdmVkIGltYWdlIG1heSBiZSBlaXRoZXIgYW5cclxuICogICAgICAgICAgSW1hZ2Ugb3IgYSBDYW52YXMgRE9NIG9iamVjdC5cclxuICpcclxuICogQGV4Y2VwdGlvbiB7RGV2ZWxvcGVyRXJyb3J9IDxjb2RlPnJlcXVlc3RJbWFnZTwvY29kZT4gbXVzdCBub3QgYmUgY2FsbGVkIGJlZm9yZSB0aGUgaW1hZ2VyeSBwcm92aWRlciBpcyByZWFkeS5cclxuICovXHJcbkltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlci5wcm90b3R5cGUucmVxdWVzdEltYWdlID0gZnVuY3Rpb24oeCwgeSwgY2VzaXVtTGV2ZWwpIHtcclxuICAgIC8vPj5pbmNsdWRlU3RhcnQoJ2RlYnVnJywgcHJhZ21hcy5kZWJ1Zyk7XHJcbiAgICBpZiAoIXRoaXMuX3JlYWR5KSB7XHJcbiAgICAgICAgdGhyb3cgbmV3IERldmVsb3BlckVycm9yKCdyZXF1ZXN0SW1hZ2UgbXVzdCBub3QgYmUgY2FsbGVkIGJlZm9yZSB0aGUgaW1hZ2VyeSBwcm92aWRlciBpcyByZWFkeS4nKTtcclxuICAgIH1cclxuICAgIC8vPj5pbmNsdWRlRW5kKCdkZWJ1ZycpO1xyXG4gICAgXHJcbiAgICB2YXIgc2VsZiA9IHRoaXM7XHJcbiAgICBcclxuICAgIHZhciBsZXZlbEZhY3RvciA9IE1hdGgucG93KDIsIHRoaXMuX251bVJlc29sdXRpb25MZXZlbHMgLSBjZXNpdW1MZXZlbCAtIDEpO1xyXG4gICAgdmFyIG1pblggPSB4ICogdGhpcy5fdGlsZVdpZHRoICAqIGxldmVsRmFjdG9yO1xyXG4gICAgdmFyIG1pblkgPSB5ICogdGhpcy5fdGlsZUhlaWdodCAqIGxldmVsRmFjdG9yO1xyXG4gICAgdmFyIG1heFhFeGNsdXNpdmUgPSAoeCArIDEpICogdGhpcy5fdGlsZVdpZHRoICAqIGxldmVsRmFjdG9yO1xyXG4gICAgdmFyIG1heFlFeGNsdXNpdmUgPSAoeSArIDEpICogdGhpcy5fdGlsZUhlaWdodCAqIGxldmVsRmFjdG9yO1xyXG4gICAgXHJcbiAgICB2YXIgYWxpZ25lZFBhcmFtcyA9IGltYWdlSGVscGVyRnVuY3Rpb25zLmFsaWduUGFyYW1zVG9UaWxlc0FuZExldmVsKHtcclxuICAgICAgICBtaW5YOiBtaW5YLFxyXG4gICAgICAgIG1pblk6IG1pblksXHJcbiAgICAgICAgbWF4WEV4Y2x1c2l2ZTogbWF4WEV4Y2x1c2l2ZSxcclxuICAgICAgICBtYXhZRXhjbHVzaXZlOiBtYXhZRXhjbHVzaXZlLFxyXG4gICAgICAgIHNjcmVlbldpZHRoOiB0aGlzLl90aWxlV2lkdGgsXHJcbiAgICAgICAgc2NyZWVuSGVpZ2h0OiB0aGlzLl90aWxlSGVpZ2h0XHJcbiAgICB9LCB0aGlzLl9pbWFnZSwgdGhpcy5faW1hZ2UpO1xyXG4gICAgXHJcbiAgICB2YXIgc2NhbGVkQ2FudmFzID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnY2FudmFzJyk7XHJcbiAgICBzY2FsZWRDYW52YXMud2lkdGggPSB0aGlzLl90aWxlV2lkdGg7XHJcbiAgICBzY2FsZWRDYW52YXMuaGVpZ2h0ID0gdGhpcy5fdGlsZUhlaWdodDtcclxuICAgIFxyXG4gICAgdmFyIHNjYWxlZENvbnRleHQgPSBzY2FsZWRDYW52YXMuZ2V0Q29udGV4dCgnMmQnKTtcclxuICAgIHNjYWxlZENvbnRleHQuY2xlYXJSZWN0KDAsIDAsIHRoaXMuX3RpbGVXaWR0aCwgdGhpcy5fdGlsZUhlaWdodCk7XHJcbiAgICBcclxuICAgIHZhciB0ZW1wUGl4ZWxXaWR0aCAgPSBhbGlnbmVkUGFyYW1zLmltYWdlUGFydFBhcmFtcy5tYXhYRXhjbHVzaXZlIC0gYWxpZ25lZFBhcmFtcy5pbWFnZVBhcnRQYXJhbXMubWluWDtcclxuICAgIHZhciB0ZW1wUGl4ZWxIZWlnaHQgPSBhbGlnbmVkUGFyYW1zLmltYWdlUGFydFBhcmFtcy5tYXhZRXhjbHVzaXZlIC0gYWxpZ25lZFBhcmFtcy5pbWFnZVBhcnRQYXJhbXMubWluWTtcclxuICAgIGlmICh0ZW1wUGl4ZWxXaWR0aCA8PSAwIHx8IHRlbXBQaXhlbEhlaWdodCA8PSAwKSB7XHJcbiAgICAgICAgcmV0dXJuIHNjYWxlZENhbnZhcztcclxuICAgIH1cclxuICAgIFxyXG4gICAgdmFyIHRlbXBDYW52YXMgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdjYW52YXMnKTtcclxuICAgIHRlbXBDYW52YXMud2lkdGggPSB0ZW1wUGl4ZWxXaWR0aDtcclxuICAgIHRlbXBDYW52YXMuaGVpZ2h0ID0gdGVtcFBpeGVsSGVpZ2h0O1xyXG4gICAgdmFyIHRlbXBDb250ZXh0ID0gdGVtcENhbnZhcy5nZXRDb250ZXh0KCcyZCcpO1xyXG4gICAgdGVtcENvbnRleHQuY2xlYXJSZWN0KDAsIDAsIHRlbXBQaXhlbFdpZHRoLCB0ZW1wUGl4ZWxIZWlnaHQpO1xyXG4gICAgXHJcbiAgICBhbGlnbmVkUGFyYW1zLmltYWdlUGFydFBhcmFtcy5xdWFsaXR5ID0gdGhpcy5fcXVhbGl0eTtcclxuICAgIGFsaWduZWRQYXJhbXMuaW1hZ2VQYXJ0UGFyYW1zLnJlcXVlc3RQcmlvcml0eURhdGEgPSB7XHJcbiAgICAgICAgaW1hZ2VSZWN0YW5nbGU6IHRoaXMuX3JlY3RhbmdsZVxyXG4gICAgfTtcclxuICAgIFxyXG4gICAgdmFyIHJlc29sdmUsIHJlamVjdDtcclxuICAgIHZhciByZXF1ZXN0UGl4ZWxzUHJvbWlzZSA9IG5ldyBQcm9taXNlKGZ1bmN0aW9uKHJlc29sdmVfLCByZWplY3RfKSB7XHJcbiAgICAgICAgcmVzb2x2ZSA9IHJlc29sdmVfO1xyXG4gICAgICAgIHJlamVjdCA9IHJlamVjdF87XHJcbiAgICAgICAgXHJcbiAgICAgICAgc2VsZi5faW1hZ2UucmVxdWVzdFBpeGVsc1Byb2dyZXNzaXZlKFxyXG4gICAgICAgICAgICBhbGlnbmVkUGFyYW1zLmltYWdlUGFydFBhcmFtcyxcclxuICAgICAgICAgICAgcGl4ZWxzRGVjb2RlZENhbGxiYWNrLFxyXG4gICAgICAgICAgICB0ZXJtaW5hdGVkQ2FsbGJhY2spO1xyXG4gICAgfSk7XHJcbiAgICBcclxuICAgIGZ1bmN0aW9uIHBpeGVsc0RlY29kZWRDYWxsYmFjayhkZWNvZGVkKSB7XHJcbiAgICAgICAgdmFyIHBhcnRpYWxUaWxlV2lkdGggPSBkZWNvZGVkLmltYWdlRGF0YS53aWR0aDtcclxuICAgICAgICB2YXIgcGFydGlhbFRpbGVIZWlnaHQgPSBkZWNvZGVkLmltYWdlRGF0YS5oZWlnaHQ7XHJcblxyXG4gICAgICAgIGlmIChwYXJ0aWFsVGlsZVdpZHRoID4gMCAmJiBwYXJ0aWFsVGlsZUhlaWdodCA+IDApIHtcclxuICAgICAgICAgICAgdGVtcENvbnRleHQucHV0SW1hZ2VEYXRhKFxyXG4gICAgICAgICAgICAgICAgZGVjb2RlZC5pbWFnZURhdGEsXHJcbiAgICAgICAgICAgICAgICBkZWNvZGVkLnhJbk9yaWdpbmFsUmVxdWVzdCxcclxuICAgICAgICAgICAgICAgIGRlY29kZWQueUluT3JpZ2luYWxSZXF1ZXN0KTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgZnVuY3Rpb24gdGVybWluYXRlZENhbGxiYWNrKGlzQWJvcnRlZCkge1xyXG4gICAgICAgIGlmIChpc0Fib3J0ZWQpIHtcclxuICAgICAgICAgICAgcmVqZWN0KCdGZXRjaCByZXF1ZXN0IG9yIGRlY29kZSBhYm9ydGVkJyk7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgc2NhbGVkQ29udGV4dC5kcmF3SW1hZ2UoXHJcbiAgICAgICAgICAgICAgICB0ZW1wQ2FudmFzLFxyXG4gICAgICAgICAgICAgICAgMCwgMCwgdGVtcFBpeGVsV2lkdGgsIHRlbXBQaXhlbEhlaWdodCxcclxuICAgICAgICAgICAgICAgIGFsaWduZWRQYXJhbXMuY3JvcHBlZFNjcmVlbi5taW5YLCBhbGlnbmVkUGFyYW1zLmNyb3BwZWRTY3JlZW4ubWluWSxcclxuICAgICAgICAgICAgICAgIGFsaWduZWRQYXJhbXMuY3JvcHBlZFNjcmVlbi5tYXhYRXhjbHVzaXZlLCBhbGlnbmVkUGFyYW1zLmNyb3BwZWRTY3JlZW4ubWF4WUV4Y2x1c2l2ZSk7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgcmVzb2x2ZShzY2FsZWRDYW52YXMpO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4gcmVxdWVzdFBpeGVsc1Byb21pc2U7XHJcbn07XHJcblxyXG5JbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlLl9zZXRQcmlvcml0eUJ5RnJ1c3R1bSA9XHJcbiAgICBmdW5jdGlvbiBzZXRQcmlvcml0eUJ5RnJ1c3R1bSgpIHtcclxuICAgIFxyXG4gICAgaWYgKCF0aGlzLl9yZWFkeSkge1xyXG4gICAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIFxyXG4gICAgdmFyIGZydXN0dW1EYXRhID0gY2FsY3VsYXRlQ2VzaXVtRnJ1c3R1bShcclxuICAgICAgICB0aGlzLl9jZXNpdW1XaWRnZXQsIHRoaXMpO1xyXG4gICAgXHJcbiAgICBpZiAoZnJ1c3R1bURhdGEgPT09IG51bGwpIHtcclxuICAgICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGZydXN0dW1EYXRhLmltYWdlUmVjdGFuZ2xlID0gdGhpcy5nZXRSZWN0YW5nbGUoKTtcclxuICAgIGZydXN0dW1EYXRhLmV4YWN0bGV2ZWwgPSBudWxsO1xyXG5cclxuICAgIHRoaXMuX2ltYWdlLnNldFNlcnZlclJlcXVlc3RQcmlvcml0aXplckRhdGEoZnJ1c3R1bURhdGEpO1xyXG4gICAgdGhpcy5faW1hZ2Uuc2V0RGVjb2RlUHJpb3JpdGl6ZXJEYXRhKGZydXN0dW1EYXRhKTtcclxufTtcclxuXHJcbi8qKlxyXG4gKiBQaWNraW5nIGZlYXR1cmVzIGlzIG5vdCBjdXJyZW50bHkgc3VwcG9ydGVkIGJ5IHRoaXMgaW1hZ2VyeSBwcm92aWRlciwgc28gdGhpcyBmdW5jdGlvbiBzaW1wbHkgcmV0dXJuc1xyXG4gKiB1bmRlZmluZWQuXHJcbiAqXHJcbiAqIEBwYXJhbSB7TnVtYmVyfSB4IFRoZSB0aWxlIFggY29vcmRpbmF0ZS5cclxuICogQHBhcmFtIHtOdW1iZXJ9IHkgVGhlIHRpbGUgWSBjb29yZGluYXRlLlxyXG4gKiBAcGFyYW0ge051bWJlcn0gbGV2ZWwgVGhlIHRpbGUgbGV2ZWwuXHJcbiAqIEBwYXJhbSB7TnVtYmVyfSBsb25naXR1ZGUgVGhlIGxvbmdpdHVkZSBhdCB3aGljaCB0byBwaWNrIGZlYXR1cmVzLlxyXG4gKiBAcGFyYW0ge051bWJlcn0gbGF0aXR1ZGUgIFRoZSBsYXRpdHVkZSBhdCB3aGljaCB0byBwaWNrIGZlYXR1cmVzLlxyXG4gKiBAcmV0dXJuIHtQcm9taXNlfSBBIHByb21pc2UgZm9yIHRoZSBwaWNrZWQgZmVhdHVyZXMgdGhhdCB3aWxsIHJlc29sdmUgd2hlbiB0aGUgYXN5bmNocm9ub3VzXHJcbiAqICAgICAgICAgICAgICAgICAgIHBpY2tpbmcgY29tcGxldGVzLiAgVGhlIHJlc29sdmVkIHZhbHVlIGlzIGFuIGFycmF5IG9mIHtAbGluayBJbWFnZXJ5TGF5ZXJGZWF0dXJlSW5mb31cclxuICogICAgICAgICAgICAgICAgICAgaW5zdGFuY2VzLiAgVGhlIGFycmF5IG1heSBiZSBlbXB0eSBpZiBubyBmZWF0dXJlcyBhcmUgZm91bmQgYXQgdGhlIGdpdmVuIGxvY2F0aW9uLlxyXG4gKiAgICAgICAgICAgICAgICAgICBJdCBtYXkgYWxzbyBiZSB1bmRlZmluZWQgaWYgcGlja2luZyBpcyBub3Qgc3VwcG9ydGVkLlxyXG4gKi9cclxuSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5waWNrRmVhdHVyZXMgPSBmdW5jdGlvbigpIHtcclxuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5fb25FeGNlcHRpb24gPSBmdW5jdGlvbiBvbkV4Y2VwdGlvbihyZWFzb24pIHtcclxuICAgIGlmICh0aGlzLl9leGNlcHRpb25DYWxsYmFjayAhPT0gbnVsbCkge1xyXG5cdFx0dGhpcy5fZXhjZXB0aW9uQ2FsbGJhY2socmVhc29uKTtcclxuICAgIH1cclxufTtcclxuXHJcbkltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlci5wcm90b3R5cGUuX29wZW5lZCA9IGZ1bmN0aW9uIG9wZW5lZCgpIHtcclxuICAgIGlmICh0aGlzLl9yZWFkeSkge1xyXG4gICAgICAgIHRocm93ICdpbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIgZXJyb3I6IG9wZW5lZCgpIHdhcyBjYWxsZWQgbW9yZSB0aGFuIG9uY2UhJztcclxuICAgIH1cclxuICAgIFxyXG4gICAgdGhpcy5fcmVhZHkgPSB0cnVlO1xyXG5cclxuICAgIC8vIFRoaXMgaXMgd3JvbmcgaWYgQ09EIG9yIENPQyBleGlzdHMgYmVzaWRlcyBtYWluIGhlYWRlciBDT0RcclxuICAgIHRoaXMuX251bVJlc29sdXRpb25MZXZlbHMgPSB0aGlzLl9pbWFnZS5nZXROdW1SZXNvbHV0aW9uTGV2ZWxzRm9yTGltaXR0ZWRWaWV3ZXIoKTtcclxuICAgIHRoaXMuX3F1YWxpdHkgPSB0aGlzLl9pbWFnZS5nZXRIaWdoZXN0UXVhbGl0eSgpO1xyXG4gICAgdmFyIG1heGltdW1DZXNpdW1MZXZlbCA9IHRoaXMuX251bVJlc29sdXRpb25MZXZlbHMgLSAxO1xyXG4gICAgICAgIFxyXG4gICAgdGhpcy5fdGlsZVdpZHRoID0gdGhpcy5faW1hZ2UuZ2V0VGlsZVdpZHRoKCk7XHJcbiAgICB0aGlzLl90aWxlSGVpZ2h0ID0gdGhpcy5faW1hZ2UuZ2V0VGlsZUhlaWdodCgpO1xyXG4gICAgICAgIFxyXG4gICAgdmFyIGJlc3RMZXZlbCA9IHRoaXMuX2ltYWdlLmdldEltYWdlTGV2ZWwoKTtcclxuICAgIHZhciBiZXN0TGV2ZWxXaWR0aCAgPSB0aGlzLl9pbWFnZS5nZXRJbWFnZVdpZHRoICgpO1xyXG4gICAgdmFyIGJlc3RMZXZlbEhlaWdodCA9IHRoaXMuX2ltYWdlLmdldEltYWdlSGVpZ2h0KCk7XHJcbiAgICBcclxuICAgIHZhciBsb3dlc3RMZXZlbFRpbGVzWCA9IE1hdGguY2VpbChiZXN0TGV2ZWxXaWR0aCAgLyB0aGlzLl90aWxlV2lkdGggKSA+PiBtYXhpbXVtQ2VzaXVtTGV2ZWw7XHJcbiAgICB2YXIgbG93ZXN0TGV2ZWxUaWxlc1kgPSBNYXRoLmNlaWwoYmVzdExldmVsSGVpZ2h0IC8gdGhpcy5fdGlsZUhlaWdodCkgPj4gbWF4aW11bUNlc2l1bUxldmVsO1xyXG5cclxuICAgIGltYWdlSGVscGVyRnVuY3Rpb25zLmZpeEJvdW5kcyhcclxuICAgICAgICB0aGlzLl9yZWN0YW5nbGUsXHJcbiAgICAgICAgdGhpcy5faW1hZ2UsXHJcbiAgICAgICAgdGhpcy5fYWRhcHRQcm9wb3J0aW9ucyk7XHJcbiAgICB2YXIgcmVjdGFuZ2xlV2lkdGggID0gdGhpcy5fcmVjdGFuZ2xlLmVhc3QgIC0gdGhpcy5fcmVjdGFuZ2xlLndlc3Q7XHJcbiAgICB2YXIgcmVjdGFuZ2xlSGVpZ2h0ID0gdGhpcy5fcmVjdGFuZ2xlLm5vcnRoIC0gdGhpcy5fcmVjdGFuZ2xlLnNvdXRoO1xyXG4gICAgXHJcbiAgICB2YXIgYmVzdExldmVsU2NhbGUgPSAxIDw8IG1heGltdW1DZXNpdW1MZXZlbDtcclxuICAgIHZhciBwaXhlbHNXaWR0aEZvckNlc2l1bSAgPSB0aGlzLl90aWxlV2lkdGggICogbG93ZXN0TGV2ZWxUaWxlc1ggKiBiZXN0TGV2ZWxTY2FsZTtcclxuICAgIHZhciBwaXhlbHNIZWlnaHRGb3JDZXNpdW0gPSB0aGlzLl90aWxlSGVpZ2h0ICogbG93ZXN0TGV2ZWxUaWxlc1kgKiBiZXN0TGV2ZWxTY2FsZTtcclxuICAgIFxyXG4gICAgLy8gQ2VzaXVtIHdvcmtzIHdpdGggZnVsbCB0aWxlcyBvbmx5LCB0aHVzIGZpeCB0aGUgZ2VvZ3JhcGhpYyBib3VuZHMgc29cclxuICAgIC8vIHRoZSBwaXhlbHMgbGllcyBleGFjdGx5IG9uIHRoZSBvcmlnaW5hbCBib3VuZHNcclxuICAgIFxyXG4gICAgdmFyIGdlb2dyYXBoaWNXaWR0aEZvckNlc2l1bSA9XHJcbiAgICAgICAgcmVjdGFuZ2xlV2lkdGggKiBwaXhlbHNXaWR0aEZvckNlc2l1bSAvIGJlc3RMZXZlbFdpZHRoO1xyXG4gICAgdmFyIGdlb2dyYXBoaWNIZWlnaHRGb3JDZXNpdW0gPVxyXG4gICAgICAgIHJlY3RhbmdsZUhlaWdodCAqIHBpeGVsc0hlaWdodEZvckNlc2l1bSAvIGJlc3RMZXZlbEhlaWdodDtcclxuICAgIFxyXG4gICAgdmFyIGZpeGVkRWFzdCAgPSB0aGlzLl9yZWN0YW5nbGUud2VzdCAgKyBnZW9ncmFwaGljV2lkdGhGb3JDZXNpdW07XHJcbiAgICB2YXIgZml4ZWRTb3V0aCA9IHRoaXMuX3JlY3RhbmdsZS5ub3J0aCAtIGdlb2dyYXBoaWNIZWlnaHRGb3JDZXNpdW07XHJcbiAgICBcclxuICAgIHRoaXMuX3RpbGluZ1NjaGVtZVBhcmFtcyA9IHtcclxuICAgICAgICB3ZXN0OiB0aGlzLl9yZWN0YW5nbGUud2VzdCxcclxuICAgICAgICBlYXN0OiBmaXhlZEVhc3QsXHJcbiAgICAgICAgc291dGg6IGZpeGVkU291dGgsXHJcbiAgICAgICAgbm9ydGg6IHRoaXMuX3JlY3RhbmdsZS5ub3J0aCxcclxuICAgICAgICBsZXZlbFplcm9UaWxlc1g6IGxvd2VzdExldmVsVGlsZXNYLFxyXG4gICAgICAgIGxldmVsWmVyb1RpbGVzWTogbG93ZXN0TGV2ZWxUaWxlc1ksXHJcbiAgICAgICAgbWF4aW11bUxldmVsOiBtYXhpbXVtQ2VzaXVtTGV2ZWxcclxuICAgIH07XHJcbiAgICBcclxuICAgIHRoaXMuX3RpbGluZ1NjaGVtZSA9IGNyZWF0ZVRpbGluZ1NjaGVtZSh0aGlzLl90aWxpbmdTY2hlbWVQYXJhbXMpO1xyXG4gICAgICAgIFxyXG4gICAgQ2VzaXVtLlRpbGVQcm92aWRlckVycm9yLmhhbmRsZVN1Y2Nlc3ModGhpcy5fZXJyb3JFdmVudCk7XHJcbn07XHJcblxyXG5mdW5jdGlvbiBjcmVhdGVUaWxpbmdTY2hlbWUocGFyYW1zKSB7XHJcbiAgICB2YXIgZ2VvZ3JhcGhpY1JlY3RhbmdsZUZvckNlc2l1bSA9IG5ldyBDZXNpdW0uUmVjdGFuZ2xlKFxyXG4gICAgICAgIHBhcmFtcy53ZXN0LCBwYXJhbXMuc291dGgsIHBhcmFtcy5lYXN0LCBwYXJhbXMubm9ydGgpO1xyXG4gICAgXHJcbiAgICB2YXIgdGlsaW5nU2NoZW1lID0gbmV3IENlc2l1bS5HZW9ncmFwaGljVGlsaW5nU2NoZW1lKHtcclxuICAgICAgICByZWN0YW5nbGU6IGdlb2dyYXBoaWNSZWN0YW5nbGVGb3JDZXNpdW0sXHJcbiAgICAgICAgbnVtYmVyT2ZMZXZlbFplcm9UaWxlc1g6IHBhcmFtcy5sZXZlbFplcm9UaWxlc1gsXHJcbiAgICAgICAgbnVtYmVyT2ZMZXZlbFplcm9UaWxlc1k6IHBhcmFtcy5sZXZlbFplcm9UaWxlc1lcclxuICAgIH0pO1xyXG4gICAgXHJcbiAgICByZXR1cm4gdGlsaW5nU2NoZW1lO1xyXG59IiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxubW9kdWxlLmV4cG9ydHMuSW1hZ2VWaWV3ZXIgPSByZXF1aXJlKCdpbWFnZS12aWV3ZXIuanMnKTtcclxubW9kdWxlLmV4cG9ydHMuSW1hZ2VCYXNlID0gcmVxdWlyZSgnaW1hZ2UtYmFzZS5qcycpO1xyXG5tb2R1bGUuZXhwb3J0cy5GZXRjaGVyQmFzZSA9IHJlcXVpcmUoJ2ZldGNoZXItYmFzZS5qcycpO1xyXG5tb2R1bGUuZXhwb3J0cy5HcmlkSW1hZ2VCYXNlID0gcmVxdWlyZSgnZ3JpZC1pbWFnZS1iYXNlLmpzJyk7XHJcbm1vZHVsZS5leHBvcnRzLkdyaWRGZXRjaGVyQmFzZSA9IHJlcXVpcmUoJ2dyaWQtZmV0Y2hlci1iYXNlLmpzJyk7XHJcbm1vZHVsZS5leHBvcnRzLkdyaWREZWNvZGVyV29ya2VyQmFzZSA9IHJlcXVpcmUoJ2dyaWQtZGVjb2Rlci13b3JrZXItYmFzZS5qcycpO1xyXG5tb2R1bGUuZXhwb3J0cy5DZXNpdW1JbWFnZURlY29kZXJMYXllck1hbmFnZXIgPSByZXF1aXJlKCdjZXNpdW0taW1hZ2UtZGVjb2Rlci1sYXllci1tYW5hZ2VyLmpzJyk7XHJcbm1vZHVsZS5leHBvcnRzLkltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlciA9IHJlcXVpcmUoJ2ltYWdlLWRlY29kZXItaW1hZ2VyeS1wcm92aWRlci5qcycpO1xyXG5tb2R1bGUuZXhwb3J0cy5JbWFnZURlY29kZXJSZWdpb25MYXllciA9IHJlcXVpcmUoJ2ltYWdlLWRlY29kZXItcmVnaW9uLWxheWVyLmpzJyk7XHJcbiIsIid1c2Ugc3RyaWN0JztcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gSW1hZ2VCYXNlO1xyXG5cclxudmFyIGltYWdlSGVscGVyRnVuY3Rpb25zID0gcmVxdWlyZSgnaW1hZ2UtaGVscGVyLWZ1bmN0aW9ucy5qcycpO1xyXG52YXIgRGVjb2RlSm9ic1Bvb2wgPSByZXF1aXJlKCdkZWNvZGUtam9icy1wb29sLmpzJyk7XHJcbnZhciBJbWFnZVBhcmFtc1JldHJpZXZlclByb3h5ID0gcmVxdWlyZSgnaW1hZ2UtcGFyYW1zLXJldHJpZXZlci1wcm94eS5qcycpO1xyXG5cclxuLyogZ2xvYmFsIGNvbnNvbGU6IGZhbHNlICovXHJcbi8qIGdsb2JhbCBQcm9taXNlOiBmYWxzZSAqL1xyXG5cclxuSW1hZ2VCYXNlLmFsaWduUGFyYW1zVG9UaWxlc0FuZExldmVsID0gaW1hZ2VIZWxwZXJGdW5jdGlvbnMuYWxpZ25QYXJhbXNUb1RpbGVzQW5kTGV2ZWw7XHJcblxyXG5mdW5jdGlvbiBJbWFnZUJhc2Uob3B0aW9ucykge1xyXG4gICAgSW1hZ2VQYXJhbXNSZXRyaWV2ZXJQcm94eS5jYWxsKHRoaXMpO1xyXG4gICAgXHJcbiAgICB0aGlzLl9vcHRpb25zID0gb3B0aW9ucyB8fCB7fTtcclxuICAgIC8vdmFyIGRlY29kZVdvcmtlcnNMaW1pdCA9IHRoaXMuX29wdGlvbnMud29ya2Vyc0xpbWl0IHx8IDU7XHJcbiAgICBcclxuICAgIHRoaXMuX3RpbGVXaWR0aCA9IHRoaXMuX29wdGlvbnMudGlsZVdpZHRoIHx8IDI1NjtcclxuICAgIHRoaXMuX3RpbGVIZWlnaHQgPSB0aGlzLl9vcHRpb25zLnRpbGVIZWlnaHQgfHwgMjU2O1xyXG4gICAgdGhpcy5fc2hvd0xvZyA9ICEhdGhpcy5fb3B0aW9ucy5zaG93TG9nO1xyXG4gICAgdGhpcy5fZmV0Y2hlciA9IG51bGw7XHJcbiAgICB0aGlzLl9kZWNvZGVEZXBlbmRlbmN5V29ya2VycyA9IG51bGw7XHJcbiAgICB0aGlzLl9yZXF1ZXN0c0RlY29kZUpvYnNQb29sID0gbnVsbDtcclxuICAgIHRoaXMuX21vdmFibGVzRGVjb2RlSm9ic1Bvb2wgPSBudWxsO1xyXG5cdHRoaXMuX2ZldGNoUmVxdWVzdElkID0gMDtcclxuICAgIFxyXG4gICAgLyppZiAodGhpcy5fc2hvd0xvZykge1xyXG4gICAgICAgIC8vIE9sZCBJRVxyXG4gICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IHNob3dMb2cgaXMgbm90IHN1cHBvcnRlZCBvbiB0aGlzIGJyb3dzZXInO1xyXG4gICAgfSovXHJcblxyXG4gICAgdGhpcy5fbW92YWJsZVN0YXRlcyA9IFtdO1xyXG4gICAgdGhpcy5fZGVjb2RlcnMgPSBbXTtcclxuXHJcbiAgICAvKiBUT0RPXHJcbiAgICB2YXIgZGVjb2RlU2NoZWR1bGVyID0gaW1hZ2VIZWxwZXJGdW5jdGlvbnMuY3JlYXRlU2NoZWR1bGVyKFxyXG4gICAgICAgIHRoaXMuX3Nob3dMb2csXHJcbiAgICAgICAgdGhpcy5fb3B0aW9ucy5kZWNvZGVQcmlvcml0aXplcixcclxuICAgICAgICAnZGVjb2RlJyxcclxuICAgICAgICBmdW5jdGlvbiBjcmVhdGVSZXNvdXJjZSgpIHtcclxuICAgICAgICAgICAgcmV0dXJuIHt9O1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgZGVjb2RlV29ya2Vyc0xpbWl0KTtcclxuICAgICovXHJcbiAgICBcclxuICAgIC8vdGhpcy5fZGVjb2RlUHJpb3JpdGl6ZXIgPSBkZWNvZGVTY2hlZHVsZXIucHJpb3JpdGl6ZXI7XHJcbn1cclxuXHJcbkltYWdlQmFzZS5wcm90b3R5cGUgPSBPYmplY3QuY3JlYXRlKEltYWdlUGFyYW1zUmV0cmlldmVyUHJveHkucHJvdG90eXBlKTtcclxuXHJcbkltYWdlQmFzZS5wcm90b3R5cGUuZ2V0RmV0Y2hlciA9IGZ1bmN0aW9uIGdldEZldGNoZXIoKSB7XHJcblx0dGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogSW1hZ2UuZ2V0RmV0Y2hlcigpIGlzIG5vdCBpbXBsZW1lbnRlZCBieSBJbWFnZUJhc2UgaW5oZXJpdG9yJztcclxufTtcclxuXHJcbkltYWdlQmFzZS5wcm90b3R5cGUuZ2V0RGVjb2RlcldvcmtlcnMgPSBmdW5jdGlvbiBnZXREZWNvZGVyV29ya2VycygpIHtcclxuXHR0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBJbWFnZS5nZXREZWNvZGVyV29ya2VycygpIGlzIG5vdCBpbXBsZW1lbnRlZCBieSBJbWFnZUJhc2UgaW5oZXJpdG9yJztcclxufTtcclxuXHJcbkltYWdlQmFzZS5wcm90b3R5cGUuZ2V0VGlsZVdpZHRoID0gZnVuY3Rpb24gZ2V0VGlsZVdpZHRoKCkge1xyXG4gICAgcmV0dXJuIHRoaXMuX3RpbGVXaWR0aDtcclxufTtcclxuXHJcbkltYWdlQmFzZS5wcm90b3R5cGUuZ2V0VGlsZUhlaWdodCA9IGZ1bmN0aW9uIGdldFRpbGVIZWlnaHQoKSB7XHJcbiAgICByZXR1cm4gdGhpcy5fdGlsZUhlaWdodDtcclxufTtcclxuICAgIFxyXG5JbWFnZUJhc2UucHJvdG90eXBlLnNldFNlcnZlclJlcXVlc3RQcmlvcml0aXplckRhdGEgPVxyXG4gICAgZnVuY3Rpb24gc2V0U2VydmVyUmVxdWVzdFByaW9yaXRpemVyRGF0YShwcmlvcml0aXplckRhdGEpIHtcclxuXHJcbiAgICB0aGlzLl92YWxpZGF0ZUZldGNoZXIoKTtcclxuICAgIFxyXG4gICAgLy8gVE9ET1xyXG4gICAgLy90aGlzLl9mZXRjaGVyLnNldFNlcnZlclJlcXVlc3RQcmlvcml0aXplckRhdGEoXHJcbiAgICAvLyAgICBwcmlvcml0aXplckRhdGEpO1xyXG59O1xyXG5cclxuSW1hZ2VCYXNlLnByb3RvdHlwZS5zZXREZWNvZGVQcmlvcml0aXplckRhdGEgPVxyXG4gICAgZnVuY3Rpb24gc2V0RGVjb2RlUHJpb3JpdGl6ZXJEYXRhKHByaW9yaXRpemVyRGF0YSkge1xyXG5cclxuICAgIHRoaXMuX3ZhbGlkYXRlRGVjb2RlcigpO1xyXG4gICAgXHJcbiAgICAvLyBUT0RPXHJcbiAgICBpZiAoIUltYWdlQmFzZS51bmRlZmluZWRWYXIpIHsgLy8gQXZvaWQgdW5yZWFjaGFibGUgd2FybmluZ1xyXG4gICAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIGlmICh0aGlzLl9kZWNvZGVQcmlvcml0aXplciA9PT0gbnVsbCkge1xyXG4gICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IE5vIGRlY29kZSBwcmlvcml0aXplciBoYXMgYmVlbiBzZXQnO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBpZiAodGhpcy5fc2hvd0xvZykge1xyXG4gICAgICAgIGNvbnNvbGUubG9nKCdzZXREZWNvZGVQcmlvcml0aXplckRhdGEoJyArIHByaW9yaXRpemVyRGF0YSArICcpJyk7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHZhciBwcmlvcml0aXplckRhdGFNb2RpZmllZCA9IE9iamVjdC5jcmVhdGUocHJpb3JpdGl6ZXJEYXRhKTtcclxuICAgIHByaW9yaXRpemVyRGF0YU1vZGlmaWVkLmltYWdlID0gdGhpcztcclxuICAgIFxyXG4gICAgdGhpcy5fZGVjb2RlUHJpb3JpdGl6ZXIuc2V0UHJpb3JpdGl6ZXJEYXRhKHByaW9yaXRpemVyRGF0YU1vZGlmaWVkKTtcclxufTtcclxuXHJcbkltYWdlQmFzZS5wcm90b3R5cGUub3BlbiA9IGZ1bmN0aW9uIG9wZW4odXJsKSB7XHJcbiAgICB0aGlzLl92YWxpZGF0ZUZldGNoZXIoKTtcclxuICAgIFxyXG4gICAgdmFyIHNlbGYgPSB0aGlzO1xyXG4gICAgdmFyIHByb21pc2UgPSB0aGlzLl9mZXRjaGVyLm9wZW5JbnRlcm5hbCh1cmwpO1xyXG4gICAgcmV0dXJuIHByb21pc2UudGhlbihmdW5jdGlvbiAoc2l6ZXNQYXJhbXMpIHtcclxuICAgICAgICBzZWxmLl9pbnRlcm5hbFNpemVzUGFyYW1zID0gc2l6ZXNQYXJhbXM7XHJcbiAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgICAgc2l6ZXNQYXJhbXM6IHNpemVzUGFyYW1zLFxyXG4gICAgICAgICAgICBhcHBsaWNhdGl2ZVRpbGVXaWR0aCA6IHNlbGYuZ2V0VGlsZVdpZHRoKCksXHJcbiAgICAgICAgICAgIGFwcGxpY2F0aXZlVGlsZUhlaWdodDogc2VsZi5nZXRUaWxlSGVpZ2h0KClcclxuICAgICAgICB9O1xyXG4gICAgfSk7XHJcbn07XHJcblxyXG5JbWFnZUJhc2UucHJvdG90eXBlLmNsb3NlID0gZnVuY3Rpb24gY2xvc2UoKSB7XHJcbiAgICB0aGlzLl92YWxpZGF0ZUZldGNoZXIoKTtcclxuICAgIHRoaXMuX3ZhbGlkYXRlRGVjb2RlcigpO1xyXG4gICAgXHJcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IHRoaXMuX2RlY29kZXJzLmxlbmd0aDsgKytpKSB7XHJcbiAgICAgICAgdGhpcy5fZGVjb2RlcnNbaV0udGVybWluYXRlKCk7XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIHRoaXMuX2ZldGNoZXIuY2xvc2UoKTtcclxufTtcclxuXHJcbkltYWdlQmFzZS5wcm90b3R5cGUuY3JlYXRlTW92YWJsZUZldGNoID0gZnVuY3Rpb24gY3JlYXRlTW92YWJsZUZldGNoKCkge1xyXG4gICAgdGhpcy5fdmFsaWRhdGVGZXRjaGVyKCk7XHJcbiAgICB0aGlzLmdldEltYWdlUGFyYW1zKCk7XHJcbiAgICBcclxuICAgIHZhciBzZWxmID0gdGhpcztcclxuICAgIFxyXG4gICAgcmV0dXJuIHRoaXMuX2ZldGNoZXIuY3JlYXRlTW92YWJsZUZldGNoKCkudGhlbihmdW5jdGlvbihtb3ZhYmxlSGFuZGxlKSB7XHJcbiAgICAgICAgc2VsZi5fbW92YWJsZVN0YXRlc1ttb3ZhYmxlSGFuZGxlXSA9IHtcclxuICAgICAgICAgICAgZGVjb2RlSm9ic0xpc3RlbmVySGFuZGxlOiBudWxsXHJcbiAgICAgICAgfTtcclxuICAgICAgICBcclxuICAgICAgICByZXR1cm4gbW92YWJsZUhhbmRsZTtcclxuICAgIH0pO1xyXG59O1xyXG5cclxuSW1hZ2VCYXNlLnByb3RvdHlwZS5yZXF1ZXN0UGl4ZWxzID0gZnVuY3Rpb24gcmVxdWVzdFBpeGVscyhpbWFnZVBhcnRQYXJhbXMpIHtcclxuICAgIHRoaXMuX3ZhbGlkYXRlRGVjb2RlcigpO1xyXG4gICAgdGhpcy5nZXRJbWFnZVBhcmFtcygpO1xyXG4gICAgXHJcbiAgICB2YXIgcmVzb2x2ZSwgcmVqZWN0O1xyXG4gICAgdmFyIGFjY3VtdWxhdGVkUmVzdWx0ID0ge307XHJcbiAgICBcclxuICAgIHZhciBzZWxmID0gdGhpcztcclxuICAgIHZhciBwcm9taXNlID0gbmV3IFByb21pc2Uoc3RhcnRQcm9taXNlKTtcclxuICAgIHJldHVybiBwcm9taXNlO1xyXG4gICAgXHJcbiAgICBmdW5jdGlvbiBzdGFydFByb21pc2UocmVzb2x2ZV8sIHJlamVjdF8pIHtcclxuICAgICAgICByZXNvbHZlID0gcmVzb2x2ZV87XHJcbiAgICAgICAgcmVqZWN0ID0gcmVqZWN0XztcclxuICAgICAgICBcclxuICAgICAgICBzZWxmLl9yZXF1ZXN0c0RlY29kZUpvYnNQb29sLmZvcmtEZWNvZGVKb2JzKFxyXG4gICAgICAgICAgICBpbWFnZVBhcnRQYXJhbXMsXHJcbiAgICAgICAgICAgIGludGVybmFsQ2FsbGJhY2ssXHJcbiAgICAgICAgICAgIGludGVybmFsVGVybWluYXRlZENhbGxiYWNrKTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgZnVuY3Rpb24gaW50ZXJuYWxDYWxsYmFjayhkZWNvZGVkRGF0YSkge1xyXG4gICAgICAgIHNlbGYuX2NvcHlQaXhlbHNUb0FjY3VtdWxhdGVkUmVzdWx0KGRlY29kZWREYXRhLCBhY2N1bXVsYXRlZFJlc3VsdCk7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGZ1bmN0aW9uIGludGVybmFsVGVybWluYXRlZENhbGxiYWNrKGlzQWJvcnRlZCkge1xyXG4gICAgICAgIGlmIChpc0Fib3J0ZWQpIHtcclxuICAgICAgICAgICAgcmVqZWN0KCdSZXF1ZXN0IHdhcyBhYm9ydGVkIGR1ZSB0byBmYWlsdXJlIG9yIHByaW9yaXR5Jyk7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgcmVzb2x2ZShhY2N1bXVsYXRlZFJlc3VsdCk7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG59O1xyXG5cclxuSW1hZ2VCYXNlLnByb3RvdHlwZS5yZXF1ZXN0UGl4ZWxzUHJvZ3Jlc3NpdmUgPSBmdW5jdGlvbiByZXF1ZXN0UGl4ZWxzUHJvZ3Jlc3NpdmUoXHJcbiAgICBpbWFnZVBhcnRQYXJhbXMsXHJcbiAgICBjYWxsYmFjayxcclxuICAgIHRlcm1pbmF0ZWRDYWxsYmFjayxcclxuICAgIGltYWdlUGFydFBhcmFtc05vdE5lZWRlZCxcclxuICAgIG1vdmFibGVIYW5kbGUpIHtcclxuICAgIFxyXG4gICAgdGhpcy5fdmFsaWRhdGVEZWNvZGVyKCk7XHJcbiAgICB0aGlzLmdldEltYWdlUGFyYW1zKCk7XHJcbiAgICBcclxuICAgIHZhciBtb3ZhYmxlU3RhdGUgPSBudWxsO1xyXG4gICAgdmFyIGRlY29kZUpvYnNQb29sO1xyXG4gICAgaWYgKG1vdmFibGVIYW5kbGUgPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIGRlY29kZUpvYnNQb29sID0gdGhpcy5fcmVxdWVzdHNEZWNvZGVKb2JzUG9vbDtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgICAgZGVjb2RlSm9ic1Bvb2wgPSB0aGlzLl9tb3ZhYmxlc0RlY29kZUpvYnNQb29sO1xyXG4gICAgICAgIFxyXG4gICAgICAgIG1vdmFibGVTdGF0ZSA9IHRoaXMuX21vdmFibGVTdGF0ZXNbbW92YWJsZUhhbmRsZV07XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKG1vdmFibGVTdGF0ZSA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IE1vdmFibGUgaGFuZGxlIGRvZXMgbm90IGV4aXN0JztcclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHZhciBsaXN0ZW5lckhhbmRsZSA9IGRlY29kZUpvYnNQb29sLmZvcmtEZWNvZGVKb2JzKFxyXG4gICAgICAgIGltYWdlUGFydFBhcmFtcyxcclxuICAgICAgICBjYWxsYmFjayxcclxuICAgICAgICB0ZXJtaW5hdGVkQ2FsbGJhY2ssXHJcbiAgICAgICAgaW1hZ2VQYXJ0UGFyYW1zTm90TmVlZGVkKTtcclxuICAgICAgICBcclxuICAgIGlmIChtb3ZhYmxlSGFuZGxlICE9PSB1bmRlZmluZWQpIHtcclxuICAgICAgICBpZiAobW92YWJsZVN0YXRlLmRlY29kZUpvYnNMaXN0ZW5lckhhbmRsZSAhPT0gbnVsbCkge1xyXG4gICAgICAgICAgICAvLyBVbnJlZ2lzdGVyIGFmdGVyIGZvcmtlZCBuZXcgam9icywgc28gbm8gdGVybWluYXRpb24gb2NjdXJzIG1lYW53aGlsZVxyXG4gICAgICAgICAgICBkZWNvZGVKb2JzUG9vbC51bnJlZ2lzdGVyRm9ya2VkSm9icyhcclxuICAgICAgICAgICAgICAgIG1vdmFibGVTdGF0ZS5kZWNvZGVKb2JzTGlzdGVuZXJIYW5kbGUpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBtb3ZhYmxlU3RhdGUuZGVjb2RlSm9ic0xpc3RlbmVySGFuZGxlID0gbGlzdGVuZXJIYW5kbGU7XHJcbiAgICAgICAgdGhpcy5fZmV0Y2hlci5tb3ZlRmV0Y2gobW92YWJsZUhhbmRsZSwgaW1hZ2VQYXJ0UGFyYW1zKTtcclxuICAgIH0gZWxzZSB7XHJcblx0XHR0aGlzLl9mZXRjaGVyLmNyZWF0ZVJlcXVlc3QoKyt0aGlzLl9mZXRjaFJlcXVlc3RJZCwgaW1hZ2VQYXJ0UGFyYW1zKTtcclxuXHR9XHJcbn07XHJcblxyXG4vLyBJbnRlcm5hbCBNZXRob2RzXHJcblxyXG5JbWFnZUJhc2UucHJvdG90eXBlLl92YWxpZGF0ZUZldGNoZXIgPSBmdW5jdGlvbiB2YWxpZGF0ZUZldGNoZXIoKSB7XHJcbiAgICBpZiAodGhpcy5fZmV0Y2hlciA9PT0gbnVsbCkge1xyXG4gICAgICAgIHRoaXMuX2ZldGNoZXIgPSB0aGlzLmdldEZldGNoZXIoKTtcclxuICAgIH1cclxufTtcclxuXHJcbkltYWdlQmFzZS5wcm90b3R5cGUuX3ZhbGlkYXRlRGVjb2RlciA9IGZ1bmN0aW9uIHZhbGlkYXRlQ29tcG9uZW50cygpIHtcclxuICAgIGlmICh0aGlzLl9kZWNvZGVEZXBlbmRlbmN5V29ya2VycyAhPT0gbnVsbCkge1xyXG4gICAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIFxyXG4gICAgdGhpcy5fZGVjb2RlRGVwZW5kZW5jeVdvcmtlcnMgPSB0aGlzLmdldERlY29kZXJXb3JrZXJzKCk7XHJcbiAgICBcclxuICAgIHRoaXMuX3JlcXVlc3RzRGVjb2RlSm9ic1Bvb2wgPSBuZXcgRGVjb2RlSm9ic1Bvb2woXHJcbiAgICAgICAgdGhpcy5fZGVjb2RlRGVwZW5kZW5jeVdvcmtlcnMsXHJcbiAgICAgICAgdGhpcy5fdGlsZVdpZHRoLFxyXG4gICAgICAgIHRoaXMuX3RpbGVIZWlnaHQpO1xyXG4gICAgICAgIFxyXG4gICAgdGhpcy5fbW92YWJsZXNEZWNvZGVKb2JzUG9vbCA9IG5ldyBEZWNvZGVKb2JzUG9vbChcclxuICAgICAgICB0aGlzLl9kZWNvZGVEZXBlbmRlbmN5V29ya2VycyxcclxuICAgICAgICB0aGlzLl90aWxlV2lkdGgsXHJcbiAgICAgICAgdGhpcy5fdGlsZUhlaWdodCk7XHJcbn07XHJcblxyXG5JbWFnZUJhc2UucHJvdG90eXBlLl9nZXRJbWFnZVBhcmFtc0ludGVybmFsID0gZnVuY3Rpb24gZ2V0SW1hZ2VQYXJhbXNJbnRlcm5hbCgpIHtcclxuICAgIHJldHVybiB0aGlzLl9pbnRlcm5hbFNpemVzUGFyYW1zO1xyXG59O1xyXG5cclxuSW1hZ2VCYXNlLnByb3RvdHlwZS5fY29weVBpeGVsc1RvQWNjdW11bGF0ZWRSZXN1bHQgPVxyXG4gICAgZnVuY3Rpb24gY29weVBpeGVsc1RvQWNjdW11bGF0ZWRSZXN1bHQoZGVjb2RlZERhdGEsIGFjY3VtdWxhdGVkUmVzdWx0KSB7XHJcbiAgICAgICAgXHJcbiAgICB2YXIgYnl0ZXNQZXJQaXhlbCA9IDQ7XHJcbiAgICB2YXIgc291cmNlU3RyaWRlID0gZGVjb2RlZERhdGEud2lkdGggKiBieXRlc1BlclBpeGVsO1xyXG4gICAgdmFyIHRhcmdldFN0cmlkZSA9XHJcbiAgICAgICAgZGVjb2RlZERhdGEub3JpZ2luYWxSZXF1ZXN0V2lkdGggKiBieXRlc1BlclBpeGVsO1xyXG4gICAgXHJcbiAgICBpZiAoYWNjdW11bGF0ZWRSZXN1bHQucGl4ZWxzID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICB2YXIgc2l6ZSA9XHJcbiAgICAgICAgICAgIHRhcmdldFN0cmlkZSAqIGRlY29kZWREYXRhLm9yaWdpbmFsUmVxdWVzdEhlaWdodDtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgYWNjdW11bGF0ZWRSZXN1bHQucGl4ZWxzID0gbmV3IFVpbnQ4QXJyYXkoc2l6ZSk7XHJcbiAgICAgICAgYWNjdW11bGF0ZWRSZXN1bHQueEluT3JpZ2luYWxSZXF1ZXN0ID0gMDtcclxuICAgICAgICBhY2N1bXVsYXRlZFJlc3VsdC55SW5PcmlnaW5hbFJlcXVlc3QgPSAwO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHZhciB3aWR0aCA9IGRlY29kZWREYXRhLm9yaWdpbmFsUmVxdWVzdFdpZHRoO1xyXG4gICAgICAgIGFjY3VtdWxhdGVkUmVzdWx0Lm9yaWdpbmFsUmVxdWVzdFdpZHRoID0gd2lkdGg7XHJcbiAgICAgICAgYWNjdW11bGF0ZWRSZXN1bHQud2lkdGggPSB3aWR0aDtcclxuXHJcbiAgICAgICAgdmFyIGhlaWdodCA9IGRlY29kZWREYXRhLm9yaWdpbmFsUmVxdWVzdEhlaWdodDtcclxuICAgICAgICBhY2N1bXVsYXRlZFJlc3VsdC5vcmlnaW5hbFJlcXVlc3RIZWlnaHQgPSBoZWlnaHQ7XHJcbiAgICAgICAgYWNjdW11bGF0ZWRSZXN1bHQuaGVpZ2h0ID0gaGVpZ2h0O1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBhY2N1bXVsYXRlZFJlc3VsdC5hbGxSZWxldmFudEJ5dGVzTG9hZGVkID1cclxuICAgICAgICBkZWNvZGVkRGF0YS5hbGxSZWxldmFudEJ5dGVzTG9hZGVkO1xyXG5cclxuICAgIHZhciBzb3VyY2VPZmZzZXQgPSAwO1xyXG4gICAgdmFyIHRhcmdldE9mZnNldCA9XHJcbiAgICAgICAgZGVjb2RlZERhdGEueEluT3JpZ2luYWxSZXF1ZXN0ICogYnl0ZXNQZXJQaXhlbCArIFxyXG4gICAgICAgIGRlY29kZWREYXRhLnlJbk9yaWdpbmFsUmVxdWVzdCAqIHRhcmdldFN0cmlkZTtcclxuICAgIFxyXG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBkZWNvZGVkRGF0YS5oZWlnaHQ7ICsraSkge1xyXG4gICAgICAgIHZhciBzb3VyY2VTdWJBcnJheSA9IGRlY29kZWREYXRhLnBpeGVscy5zdWJhcnJheShcclxuICAgICAgICAgICAgc291cmNlT2Zmc2V0LCBzb3VyY2VPZmZzZXQgKyBzb3VyY2VTdHJpZGUpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGFjY3VtdWxhdGVkUmVzdWx0LnBpeGVscy5zZXQoc291cmNlU3ViQXJyYXksIHRhcmdldE9mZnNldCk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgc291cmNlT2Zmc2V0ICs9IHNvdXJjZVN0cmlkZTtcclxuICAgICAgICB0YXJnZXRPZmZzZXQgKz0gdGFyZ2V0U3RyaWRlO1xyXG4gICAgfVxyXG59OyIsIid1c2Ugc3RyaWN0JztcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gRGVjb2RlSm9iO1xyXG5cclxudmFyIExpbmtlZExpc3QgPSByZXF1aXJlKCdsaW5rZWQtbGlzdC5qcycpO1xyXG5cclxudmFyIHJlcXVlc3RJZENvdW50ZXIgPSAwO1xyXG5cclxuZnVuY3Rpb24gRGVjb2RlSm9iKGxpc3RlbmVySGFuZGxlLCBpbWFnZVBhcnRQYXJhbXMpIHtcclxuICAgIHRoaXMuX2lzRmlyc3RTdGFnZSA9IHRydWU7XHJcbiAgICB0aGlzLl9saXN0ZW5lckhhbmRsZSA9IGxpc3RlbmVySGFuZGxlO1xyXG4gICAgdGhpcy5faW1hZ2VQYXJ0UGFyYW1zID0gaW1hZ2VQYXJ0UGFyYW1zO1xyXG4gICAgdGhpcy5fYWxsUmVsZXZhbnRCeXRlc0xvYWRlZCA9IDA7XHJcbiAgICB2YXIgcmVxdWVzdFBhcmFtcyA9IGxpc3RlbmVySGFuZGxlLmltYWdlUGFydFBhcmFtcztcclxuICAgIHRoaXMuX29mZnNldFggPSBpbWFnZVBhcnRQYXJhbXMubWluWCAtIHJlcXVlc3RQYXJhbXMubWluWDtcclxuICAgIHRoaXMuX29mZnNldFkgPSBpbWFnZVBhcnRQYXJhbXMubWluWSAtIHJlcXVlc3RQYXJhbXMubWluWTtcclxuICAgIHRoaXMuX3JlcXVlc3RXaWR0aCA9IHJlcXVlc3RQYXJhbXMubWF4WEV4Y2x1c2l2ZSAtIHJlcXVlc3RQYXJhbXMubWluWDtcclxuICAgIHRoaXMuX3JlcXVlc3RIZWlnaHQgPSByZXF1ZXN0UGFyYW1zLm1heFlFeGNsdXNpdmUgLSByZXF1ZXN0UGFyYW1zLm1pblk7XHJcbn1cclxuXHJcbkRlY29kZUpvYi5wcm90b3R5cGUub25EYXRhID0gZnVuY3Rpb24gb25EYXRhKGRlY29kZVJlc3VsdCkge1xyXG4gICAgdGhpcy5faXNGaXJzdFN0YWdlID0gZmFsc2U7XHJcblxyXG4gICAgdmFyIHJlbGV2YW50Qnl0ZXNMb2FkZWREaWZmID1cclxuICAgICAgICBkZWNvZGVSZXN1bHQuYWxsUmVsZXZhbnRCeXRlc0xvYWRlZCAtIHRoaXMuX2FsbFJlbGV2YW50Qnl0ZXNMb2FkZWQ7XHJcbiAgICB0aGlzLl9hbGxSZWxldmFudEJ5dGVzTG9hZGVkID0gZGVjb2RlUmVzdWx0LmFsbFJlbGV2YW50Qnl0ZXNMb2FkZWQ7XHJcbiAgICB0aGlzLl9saXN0ZW5lckhhbmRsZS5hbGxSZWxldmFudEJ5dGVzTG9hZGVkICs9IHJlbGV2YW50Qnl0ZXNMb2FkZWREaWZmO1xyXG4gICAgXHJcbiAgICB2YXIgZGVjb2RlZE9mZnNldHRlZCA9IHtcclxuICAgICAgICBvcmlnaW5hbFJlcXVlc3RXaWR0aDogdGhpcy5fcmVxdWVzdFdpZHRoLFxyXG4gICAgICAgIG9yaWdpbmFsUmVxdWVzdEhlaWdodDogdGhpcy5fcmVxdWVzdEhlaWdodCxcclxuICAgICAgICB4SW5PcmlnaW5hbFJlcXVlc3Q6IHRoaXMuX29mZnNldFgsXHJcbiAgICAgICAgeUluT3JpZ2luYWxSZXF1ZXN0OiB0aGlzLl9vZmZzZXRZLFxyXG4gICAgICAgIFxyXG4gICAgICAgIGltYWdlRGF0YTogZGVjb2RlUmVzdWx0LFxyXG4gICAgICAgIFxyXG4gICAgICAgIGFsbFJlbGV2YW50Qnl0ZXNMb2FkZWQ6IHRoaXMuX2xpc3RlbmVySGFuZGxlLmFsbFJlbGV2YW50Qnl0ZXNMb2FkZWRcclxuICAgIH07XHJcbiAgICBcclxuICAgIHRoaXMuX2xpc3RlbmVySGFuZGxlLmNhbGxiYWNrKGRlY29kZWRPZmZzZXR0ZWQpO1xyXG59O1xyXG5cclxuRGVjb2RlSm9iLnByb3RvdHlwZS5vblRlcm1pbmF0ZWQgPSBmdW5jdGlvbiBvblRlcm1pbmF0ZWQoKSB7XHJcbiAgICAvL3RoaXMuX2xpc3RlbmVySGFuZGxlLmlzQW55RGVjb2RlckFib3J0ZWQgfD0gdGhpcy5faXNBYm9ydGVkO1xyXG4gICAgXHJcbiAgICB2YXIgcmVtYWluaW5nID0gLS10aGlzLl9saXN0ZW5lckhhbmRsZS5yZW1haW5pbmdEZWNvZGVKb2JzO1xyXG4gICAgaWYgKHJlbWFpbmluZyA8IDApIHtcclxuICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBJbmNvbnNpc3RlbnQgbnVtYmVyIG9mIGRvbmUgcmVxdWVzdHMnO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICB2YXIgaXNMaXN0ZW5lckRvbmUgPSByZW1haW5pbmcgPT09IDA7XHJcbiAgICBpZiAoaXNMaXN0ZW5lckRvbmUpIHtcclxuICAgICAgICB0aGlzLl9saXN0ZW5lckhhbmRsZS5pc1Rlcm1pbmF0ZWRDYWxsYmFja0NhbGxlZCA9IHRydWU7XHJcbiAgICAgICAgdGhpcy5fbGlzdGVuZXJIYW5kbGUudGVybWluYXRlZENhbGxiYWNrKFxyXG4gICAgICAgICAgICB0aGlzLl9saXN0ZW5lckhhbmRsZS5pc0FueURlY29kZXJBYm9ydGVkKTtcclxuICAgIH1cclxufTsiLCIndXNlIHN0cmljdCc7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IERlY29kZUpvYnNQb29sO1xyXG5cclxudmFyIERlY29kZUpvYiA9IHJlcXVpcmUoJ2RlY29kZS1qb2IuanMnKTtcclxuXHJcbmZ1bmN0aW9uIERlY29kZUpvYnNQb29sKFxyXG4gICAgZGVjb2RlRGVwZW5kZW5jeVdvcmtlcnMsXHJcbiAgICB0aWxlV2lkdGgsXHJcbiAgICB0aWxlSGVpZ2h0KSB7XHJcbiAgICBcclxuICAgIHRoaXMuX3RpbGVXaWR0aCA9IHRpbGVXaWR0aDtcclxuICAgIHRoaXMuX3RpbGVIZWlnaHQgPSB0aWxlSGVpZ2h0O1xyXG4gICAgXHJcbiAgICB0aGlzLl9kZWNvZGVEZXBlbmRlbmN5V29ya2VycyA9IGRlY29kZURlcGVuZGVuY3lXb3JrZXJzO1xyXG59XHJcblxyXG5EZWNvZGVKb2JzUG9vbC5wcm90b3R5cGUuZm9ya0RlY29kZUpvYnMgPSBmdW5jdGlvbiBmb3JrRGVjb2RlSm9icyhcclxuICAgIGltYWdlUGFydFBhcmFtcyxcclxuICAgIGNhbGxiYWNrLFxyXG4gICAgdGVybWluYXRlZENhbGxiYWNrLFxyXG4gICAgaW1hZ2VQYXJ0UGFyYW1zTm90TmVlZGVkKSB7XHJcbiAgICBcclxuICAgIHZhciBtaW5YID0gaW1hZ2VQYXJ0UGFyYW1zLm1pblg7XHJcbiAgICB2YXIgbWluWSA9IGltYWdlUGFydFBhcmFtcy5taW5ZO1xyXG4gICAgdmFyIG1heFggPSBpbWFnZVBhcnRQYXJhbXMubWF4WEV4Y2x1c2l2ZTtcclxuICAgIHZhciBtYXhZID0gaW1hZ2VQYXJ0UGFyYW1zLm1heFlFeGNsdXNpdmU7XHJcbiAgICB2YXIgbGV2ZWwgPSBpbWFnZVBhcnRQYXJhbXMubGV2ZWwgfHwgMDtcclxuICAgIHZhciBxdWFsaXR5ID0gaW1hZ2VQYXJ0UGFyYW1zLnF1YWxpdHk7XHJcbiAgICB2YXIgcHJpb3JpdHlEYXRhID0gaW1hZ2VQYXJ0UGFyYW1zLnJlcXVlc3RQcmlvcml0eURhdGE7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgIHZhciBpc01pbkFsaWduZWQgPVxyXG4gICAgICAgIG1pblggJSB0aGlzLl90aWxlV2lkdGggPT09IDAgJiYgbWluWSAlIHRoaXMuX3RpbGVIZWlnaHQgPT09IDA7XHJcbiAgICB2YXIgaXNNYXhYQWxpZ25lZCA9IG1heFggJSB0aGlzLl90aWxlV2lkdGggID09PSAwIHx8IG1heFggPT09IGltYWdlUGFydFBhcmFtcy5sZXZlbFdpZHRoO1xyXG4gICAgdmFyIGlzTWF4WUFsaWduZWQgPSBtYXhZICUgdGhpcy5fdGlsZUhlaWdodCA9PT0gMCB8fCBtYXhZID09PSBpbWFnZVBhcnRQYXJhbXMubGV2ZWxIZWlnaHQ7XHJcbiAgICB2YXIgaXNPcmRlclZhbGlkID0gbWluWCA8IG1heFggJiYgbWluWSA8IG1heFk7XHJcbiAgICBcclxuICAgIGlmICghaXNNaW5BbGlnbmVkIHx8ICFpc01heFhBbGlnbmVkIHx8ICFpc01heFlBbGlnbmVkIHx8ICFpc09yZGVyVmFsaWQpIHtcclxuICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBpbWFnZVBhcnRQYXJhbXMgZm9yIGRlY29kZXJzIGlzIG5vdCBhbGlnbmVkIHRvICcgK1xyXG4gICAgICAgICAgICAndGlsZSBzaXplIG9yIG5vdCBpbiB2YWxpZCBvcmRlcic7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHZhciBudW1UaWxlc1ggPSBNYXRoLmNlaWwoKG1heFggLSBtaW5YKSAvIHRoaXMuX3RpbGVXaWR0aCk7XHJcbiAgICB2YXIgbnVtVGlsZXNZID0gTWF0aC5jZWlsKChtYXhZIC0gbWluWSkgLyB0aGlzLl90aWxlSGVpZ2h0KTtcclxuICAgIFxyXG4gICAgdmFyIGxpc3RlbmVySGFuZGxlID0ge1xyXG4gICAgICAgIGltYWdlUGFydFBhcmFtczogaW1hZ2VQYXJ0UGFyYW1zLFxyXG4gICAgICAgIGNhbGxiYWNrOiBjYWxsYmFjayxcclxuICAgICAgICB0ZXJtaW5hdGVkQ2FsbGJhY2s6IHRlcm1pbmF0ZWRDYWxsYmFjayxcclxuICAgICAgICByZW1haW5pbmdEZWNvZGVKb2JzOiBudW1UaWxlc1ggKiBudW1UaWxlc1ksXHJcbiAgICAgICAgaXNBbnlEZWNvZGVyQWJvcnRlZDogZmFsc2UsXHJcbiAgICAgICAgaXNUZXJtaW5hdGVkQ2FsbGJhY2tDYWxsZWQ6IGZhbHNlLFxyXG4gICAgICAgIGFsbFJlbGV2YW50Qnl0ZXNMb2FkZWQ6IDAsXHJcbiAgICAgICAgdW5yZWdpc3RlckhhbmRsZXM6IFtdXHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBmb3IgKHZhciB4ID0gbWluWDsgeCA8IG1heFg7IHggKz0gdGhpcy5fdGlsZVdpZHRoKSB7XHJcbiAgICAgICAgdmFyIHNpbmdsZVRpbGVNYXhYID0gTWF0aC5taW4oeCArIHRoaXMuX3RpbGVXaWR0aCwgaW1hZ2VQYXJ0UGFyYW1zLmxldmVsV2lkdGgpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGZvciAodmFyIHkgPSBtaW5ZOyB5IDwgbWF4WTsgeSArPSB0aGlzLl90aWxlSGVpZ2h0KSB7XHJcbiAgICAgICAgICAgIHZhciBzaW5nbGVUaWxlTWF4WSA9IE1hdGgubWluKHkgKyB0aGlzLl90aWxlSGVpZ2h0LCBpbWFnZVBhcnRQYXJhbXMubGV2ZWxIZWlnaHQpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgdmFyIGlzVGlsZU5vdE5lZWRlZCA9IGlzVW5uZWVkZWQoXHJcbiAgICAgICAgICAgICAgICB4LFxyXG4gICAgICAgICAgICAgICAgeSxcclxuICAgICAgICAgICAgICAgIHNpbmdsZVRpbGVNYXhYLFxyXG4gICAgICAgICAgICAgICAgc2luZ2xlVGlsZU1heFksXHJcbiAgICAgICAgICAgICAgICBpbWFnZVBhcnRQYXJhbXNOb3ROZWVkZWQpO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGlmIChpc1RpbGVOb3ROZWVkZWQpIHtcclxuICAgICAgICAgICAgICAgIC0tbGlzdGVuZXJIYW5kbGUucmVtYWluaW5nRGVjb2RlSm9icztcclxuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICB2YXIgc2luZ2xlVGlsZUltYWdlUGFydFBhcmFtcyA9IHtcclxuICAgICAgICAgICAgICAgIG1pblg6IHgsXHJcbiAgICAgICAgICAgICAgICBtaW5ZOiB5LFxyXG4gICAgICAgICAgICAgICAgbWF4WEV4Y2x1c2l2ZTogc2luZ2xlVGlsZU1heFgsXHJcbiAgICAgICAgICAgICAgICBtYXhZRXhjbHVzaXZlOiBzaW5nbGVUaWxlTWF4WSxcclxuICAgICAgICAgICAgICAgIGxldmVsV2lkdGg6IGltYWdlUGFydFBhcmFtcy5sZXZlbFdpZHRoLFxyXG4gICAgICAgICAgICAgICAgbGV2ZWxIZWlnaHQ6IGltYWdlUGFydFBhcmFtcy5sZXZlbEhlaWdodCxcclxuICAgICAgICAgICAgICAgIGxldmVsOiBsZXZlbCxcclxuICAgICAgICAgICAgICAgIHF1YWxpdHk6IHF1YWxpdHksXHJcbiAgICAgICAgICAgICAgICByZXF1ZXN0UHJpb3JpdHlEYXRhOiBwcmlvcml0eURhdGFcclxuICAgICAgICAgICAgfTtcclxuXHJcbiAgICAgICAgICAgIHZhciBkZWNvZGVKb2IgPSBuZXcgRGVjb2RlSm9iKFxyXG4gICAgICAgICAgICAgICAgbGlzdGVuZXJIYW5kbGUsXHJcbiAgICAgICAgICAgICAgICBzaW5nbGVUaWxlSW1hZ2VQYXJ0UGFyYW1zKTtcclxuXHJcbiAgICAgICAgICAgIHZhciB0YXNrSGFuZGxlID1cclxuICAgICAgICAgICAgICAgIHRoaXMuX2RlY29kZURlcGVuZGVuY3lXb3JrZXJzLnN0YXJ0VGFzayhcclxuICAgICAgICAgICAgICAgICAgICBzaW5nbGVUaWxlSW1hZ2VQYXJ0UGFyYW1zLCBkZWNvZGVKb2IpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgbGlzdGVuZXJIYW5kbGUudW5yZWdpc3RlckhhbmRsZXMucHVzaCh0YXNrSGFuZGxlKTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGlmICghbGlzdGVuZXJIYW5kbGUuaXNUZXJtaW5hdGVkQ2FsbGJhY2tDYWxsZWQgJiZcclxuICAgICAgICBsaXN0ZW5lckhhbmRsZS5yZW1haW5pbmdEZWNvZGVKb2JzID09PSAwKSB7XHJcbiAgICAgICAgXHJcbiAgICAgICAgbGlzdGVuZXJIYW5kbGUuaXNUZXJtaW5hdGVkQ2FsbGJhY2tDYWxsZWQgPSB0cnVlO1xyXG4gICAgICAgIGxpc3RlbmVySGFuZGxlLnRlcm1pbmF0ZWRDYWxsYmFjayhsaXN0ZW5lckhhbmRsZS5pc0FueURlY29kZXJBYm9ydGVkKTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgcmV0dXJuIGxpc3RlbmVySGFuZGxlO1xyXG59O1xyXG5cclxuRGVjb2RlSm9ic1Bvb2wucHJvdG90eXBlLnVucmVnaXN0ZXJGb3JrZWRKb2JzID0gZnVuY3Rpb24gdW5yZWdpc3RlckZvcmtlZEpvYnMoXHJcbiAgICBsaXN0ZW5lckhhbmRsZSkge1xyXG4gICAgICAgICAgICBcclxuICAgIGlmIChsaXN0ZW5lckhhbmRsZS5yZW1haW5pbmdEZWNvZGVKb2JzID09PSAwKSB7XHJcbiAgICAgICAgLy8gQWxsIGpvYnMgaGFzIGFscmVhZHkgYmVlbiB0ZXJtaW5hdGVkLCBubyBuZWVkIHRvIHVucmVnaXN0ZXJcclxuICAgICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgbGlzdGVuZXJIYW5kbGUudW5yZWdpc3RlckhhbmRsZXMubGVuZ3RoOyArK2kpIHtcclxuICAgICAgICBsaXN0ZW5lckhhbmRsZS51bnJlZ2lzdGVySGFuZGxlc1tpXS51bnJlZ2lzdGVyKCk7XHJcbiAgICB9XHJcbn07XHJcblxyXG5mdW5jdGlvbiBpc1VubmVlZGVkKFxyXG4gICAgbWluWCwgbWluWSwgbWF4WCwgbWF4WSwgaW1hZ2VQYXJ0UGFyYW1zTm90TmVlZGVkKSB7XHJcbiAgICBcclxuICAgIGlmIChpbWFnZVBhcnRQYXJhbXNOb3ROZWVkZWQgPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIHJldHVybiBmYWxzZTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBpbWFnZVBhcnRQYXJhbXNOb3ROZWVkZWQubGVuZ3RoOyArK2kpIHtcclxuICAgICAgICB2YXIgbm90TmVlZGVkID0gaW1hZ2VQYXJ0UGFyYW1zTm90TmVlZGVkW2ldO1xyXG4gICAgICAgIHZhciBpc0luWCA9IG1pblggPj0gbm90TmVlZGVkLm1pblggJiYgbWF4WCA8PSBub3ROZWVkZWQubWF4WEV4Y2x1c2l2ZTtcclxuICAgICAgICB2YXIgaXNJblkgPSBtaW5ZID49IG5vdE5lZWRlZC5taW5ZICYmIG1heFkgPD0gbm90TmVlZGVkLm1heFlFeGNsdXNpdmU7XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKGlzSW5YICYmIGlzSW5ZKSB7XHJcbiAgICAgICAgICAgIHJldHVybiB0cnVlO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuICAgIFxyXG4gICAgcmV0dXJuIGZhbHNlO1xyXG59IiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBGZXRjaENvbnRleHRBcGk7XHJcblxyXG5mdW5jdGlvbiBGZXRjaENvbnRleHRBcGkoKSB7XHJcblx0dGhpcy5fZXZlbnRzID0ge1xyXG5cdFx0aXNQcm9ncmVzc2l2ZUNoYW5nZWQ6IFtdLFxyXG5cdFx0bW92ZTogW10sXHJcblx0XHR0ZXJtaW5hdGU6IFtdLFxyXG5cdFx0XHJcblx0XHRzdG9wOiBbXSxcclxuXHRcdHJlc3VtZTogW10sXHJcblx0XHRcclxuXHRcdGludGVybmFsU3RvcHBlZDogW10sXHJcblx0XHRpbnRlcm5hbERvbmU6IFtdXHJcblx0fTtcclxufVxyXG5cclxuRmV0Y2hDb250ZXh0QXBpLnByb3RvdHlwZS5zdG9wcGVkID0gZnVuY3Rpb24gc3RvcHBlZCgpIHtcclxuXHR0aGlzLl9vbkV2ZW50KCdpbnRlcm5hbFN0b3BwZWQnLCAvKmlzQWJvcnRlZD0qL2ZhbHNlKTtcclxufTtcclxuXHJcbkZldGNoQ29udGV4dEFwaS5wcm90b3R5cGUuZG9uZSA9IGZ1bmN0aW9uIGRvbmUoKSB7XHJcblx0dGhpcy5fb25FdmVudCgnaW50ZXJuYWxEb25lJyk7XHJcbn07XHJcblxyXG5GZXRjaENvbnRleHRBcGkucHJvdG90eXBlLm9uID0gZnVuY3Rpb24gb24oZXZlbnQsIGxpc3RlbmVyLCBsaXN0ZW5lclRoaXMpIHtcclxuXHR2YXIgbGlzdGVuZXJzID0gdGhpcy5fZXZlbnRzW2V2ZW50XTtcclxuXHRpZiAoIWxpc3RlbmVycykge1xyXG5cdFx0dGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogZXZlbnQgJyArIGV2ZW50ICsgJyBkb2VzIG5vdCBleGlzdCBpbiBGZXRjaENvbnRleHQnO1xyXG5cdH1cclxuXHRsaXN0ZW5lcnMucHVzaCh7XHJcblx0XHRsaXN0ZW5lcjogbGlzdGVuZXIsXHJcblx0XHRsaXN0ZW5lclRoaXM6IGxpc3RlbmVyVGhpcyB8fCB0aGlzXHJcblx0fSk7XHJcbn07XHJcblxyXG5GZXRjaENvbnRleHRBcGkucHJvdG90eXBlLl9vbkV2ZW50ID0gZnVuY3Rpb24gb25FdmVudChldmVudCwgYXJnMSwgYXJnMikge1xyXG5cdHZhciBsaXN0ZW5lcnMgPSB0aGlzLl9ldmVudHNbZXZlbnRdO1xyXG5cdGZvciAodmFyIGkgPSAwOyBpIDwgbGlzdGVuZXJzLmxlbmd0aDsgKytpKSB7XHJcblx0XHRsaXN0ZW5lcnNbaV0ubGlzdGVuZXIuY2FsbChsaXN0ZW5lcnNbaV0ubGlzdGVuZXJUaGlzLCBhcmcxLCBhcmcyKTtcclxuXHR9XHJcbn07IiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxudmFyIEZldGNoQ29udGV4dEFwaSA9IHJlcXVpcmUoJ2ZldGNoLWNvbnRleHQtYXBpLmpzJyk7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IEZldGNoQ29udGV4dDtcclxuXHJcbkZldGNoQ29udGV4dC5GRVRDSF9UWVBFX1JFUVVFU1QgPSAxO1xyXG5GZXRjaENvbnRleHQuRkVUQ0hfVFlQRV9NT1ZBQkxFID0gMjsgLy8gbW92YWJsZVxyXG5GZXRjaENvbnRleHQuRkVUQ0hfVFlQRV9PTkxZX1dBSVRfRk9SX0RBVEEgPSAzO1xyXG5cclxuRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19XQUlUX0ZPUl9GRVRDSF9DQUxMID0gMTtcclxuRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19SRVFVRVNUX1dBSVRfRk9SX1NDSEVEVUxFID0gMjtcclxuRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19BQ1RJVkUgPSAzO1xyXG5GZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX1JFUVVFU1RfQUJPVVRfVE9fWUlFTEQgPSA0O1xyXG5GZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX1JFUVVFU1RfWUlFTERFRCA9IDY7XHJcbkZldGNoQ29udGV4dC5GRVRDSF9TVEFUVVNfUkVRVUVTVF9BQk9VVF9UT19BQk9SVCA9IDg7XHJcbkZldGNoQ29udGV4dC5GRVRDSF9TVEFUVVNfUkVRVUVTVF9URVJNSU5BVEVEID0gOTtcclxuRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19VTkVYUEVDVEVEX0ZBSUxVUkUgPSAxMDtcclxuXHJcbmZ1bmN0aW9uIEZldGNoQ29udGV4dChmZXRjaGVyLCBzY2hlZHVsZXIsIHNjaGVkdWxlZEpvYnNMaXN0LCBmZXRjaFR5cGUsIGNvbnRleHRWYXJzKSB7XHJcbiAgICB0aGlzLl9mZXRjaGVyID0gZmV0Y2hlcjtcclxuICAgIHRoaXMuX3NjaGVkdWxlciA9IHNjaGVkdWxlcjtcclxuICAgIHRoaXMuX3NjaGVkdWxlZEpvYnNMaXN0ID0gc2NoZWR1bGVkSm9ic0xpc3Q7XHJcbiAgICB0aGlzLl9zY2hlZHVsZWRKb2JzTGlzdEl0ZXJhdG9yID0gbnVsbDtcclxuICAgIFxyXG4gICAgdGhpcy5fdGVybWluYXRlZExpc3RlbmVycyA9IFtdO1xyXG4gICAgXHJcbiAgICB0aGlzLl9pbWFnZVBhcnRQYXJhbXMgPSBudWxsO1xyXG4gICAgXHJcbiAgICB0aGlzLl9zdGF0ZSA9IEZldGNoQ29udGV4dC5GRVRDSF9TVEFUVVNfV0FJVF9GT1JfRkVUQ0hfQ0FMTDtcclxuICAgIHRoaXMuX2lzTW92YWJsZSA9IGZldGNoVHlwZSA9PT0gRmV0Y2hDb250ZXh0LkZFVENIX1RZUEVfTU9WQUJMRTtcclxuICAgIHRoaXMuX2NvbnRleHRWYXJzID0gY29udGV4dFZhcnM7XHJcbiAgICB0aGlzLl9pc09ubHlXYWl0Rm9yRGF0YSA9IGZldGNoVHlwZSA9PT0gRmV0Y2hDb250ZXh0LkZFVENIX1RZUEVfT05MWV9XQUlUX0ZPUl9EQVRBO1xyXG4gICAgdGhpcy5fdXNlU2NoZWR1bGVyID0gZmV0Y2hUeXBlID09PSBGZXRjaENvbnRleHQuRkVUQ0hfVFlQRV9SRVFVRVNUO1xyXG4gICAgdGhpcy5fcmVzb3VyY2UgPSBudWxsO1xyXG4gICAgdGhpcy5fZmV0Y2hDb250ZXh0QXBpID0gbnVsbDtcclxuICAgIC8vdGhpcy5fYWxyZWFkeVRlcm1pbmF0ZWRXaGVuQWxsRGF0YUFycml2ZWQgPSBmYWxzZTtcclxufVxyXG5cclxuRmV0Y2hDb250ZXh0LnByb3RvdHlwZS5mZXRjaCA9IGZ1bmN0aW9uIGZldGNoKGltYWdlUGFydFBhcmFtcykge1xyXG4gICAgaWYgKHRoaXMuX2lzTW92YWJsZSkge1xyXG4gICAgICAgIHRoaXMuX2ltYWdlUGFydFBhcmFtcyA9IGltYWdlUGFydFBhcmFtcztcclxuICAgICAgICB0aGlzLl9zdGFydEZldGNoKCk7XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBpZiAodGhpcy5faW1hZ2VQYXJ0UGFyYW1zICE9PSBudWxsKSB7XHJcbiAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogQ2Fubm90IGZldGNoIHR3aWNlIG9uIGZldGNoIHR5cGUgb2YgXCJyZXF1ZXN0XCInO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBpZiAodGhpcy5fc3RhdGUgIT09IEZldGNoQ29udGV4dC5GRVRDSF9TVEFUVVNfV0FJVF9GT1JfRkVUQ0hfQ0FMTCkge1xyXG4gICAgICAgIHRoaXMuX3N0YXRlID0gRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19VTkVYUEVDVEVEX0ZBSUxVUkU7XHJcbiAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogVW5leHBlY3RlZCBzdGF0ZSBvbiBmZXRjaCgpOiAnICsgdGhpcy5fc3RhdGU7XHJcbiAgICB9XHJcblxyXG4gICAgdGhpcy5faW1hZ2VQYXJ0UGFyYW1zID0gaW1hZ2VQYXJ0UGFyYW1zO1xyXG4gICAgdGhpcy5fc3RhdGUgPSBGZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX1JFUVVFU1RfV0FJVF9GT1JfU0NIRURVTEU7XHJcbiAgICBcclxuICAgIGlmICghdGhpcy5fdXNlU2NoZWR1bGVyKSB7XHJcbiAgICAgICAgc3RhcnRSZXF1ZXN0KC8qcmVzb3VyY2U9Ki9udWxsLCB0aGlzKTtcclxuICAgICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHRoaXMuX3NjaGVkdWxlci5lbnF1ZXVlSm9iKHN0YXJ0UmVxdWVzdCwgdGhpcywgZmV0Y2hBYm9ydGVkQnlTY2hlZHVsZXIpO1xyXG59O1xyXG5cclxuRmV0Y2hDb250ZXh0LnByb3RvdHlwZS5tYW51YWxBYm9ydFJlcXVlc3QgPSBmdW5jdGlvbiBtYW51YWxBYm9ydFJlcXVlc3QoKSB7XHJcbiAgICBzd2l0Y2ggKHRoaXMuX3N0YXRlKSB7XHJcbiAgICAgICAgY2FzZSBGZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX1JFUVVFU1RfVEVSTUlOQVRFRDpcclxuICAgICAgICBjYXNlIEZldGNoQ29udGV4dC5GRVRDSF9TVEFUVVNfVU5FWFBFQ1RFRF9GQUlMVVJFOlxyXG4gICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgY2FzZSBGZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX1JFUVVFU1RfQUJPVVRfVE9fQUJPUlQ6XHJcbiAgICAgICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IERvdWJsZSBjYWxsIHRvIG1hbnVhbEFib3J0UmVxdWVzdCgpJztcclxuICAgICAgICBjYXNlIEZldGNoQ29udGV4dC5GRVRDSF9TVEFUVVNfQUNUSVZFOlxyXG4gICAgICAgICAgICB0aGlzLl9zdGF0ZSA9IEZldGNoQ29udGV4dC5GRVRDSF9TVEFUVVNfUkVRVUVTVF9BQk9VVF9UT19BQk9SVDtcclxuICAgICAgICAgICAgaWYgKHRoaXMuX2lzT25seVdhaXRGb3JEYXRhKSB7XHJcbiAgICAgICAgICAgICAgICB0aGlzLl9mZXRjaFN0b3BwZWQoLyppc0Fib3J0ZWQ9Ki90cnVlKTtcclxuICAgICAgICAgICAgfSBlbHNlIHtcclxuXHRcdFx0XHR0aGlzLl9mZXRjaENvbnRleHRBcGkuX29uRXZlbnQoJ3N0b3AnLCAvKmlzQWJvcnRlZD0qL3RydWUpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGJyZWFrO1xyXG4gICAgICAgIGNhc2UgRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19XQUlUX0ZPUl9GRVRDSF9DQUxMOlxyXG4gICAgICAgICAgICB0aGlzLl9zdGF0ZSA9IEZldGNoQ29udGV4dC5GRVRDSF9TVEFUVVNfUkVRVUVTVF9URVJNSU5BVEVEO1xyXG4gICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgY2FzZSBGZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX1JFUVVFU1RfV0FJVF9GT1JfU0NIRURVTEU6XHJcbiAgICAgICAgY2FzZSBGZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX1JFUVVFU1RfQUJPVVRfVE9fWUlFTEQ6XHJcbiAgICAgICAgY2FzZSBGZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX1JFUVVFU1RfWUlFTERFRDpcclxuICAgICAgICAgICAgdGhpcy5fc3RhdGUgPSBGZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX1JFUVVFU1RfQUJPVVRfVE9fQUJPUlQ7XHJcbiAgICAgICAgICAgIGJyZWFrO1xyXG4gICAgICAgIGRlZmF1bHQ6XHJcbiAgICAgICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IFVua25vd24gc3RhdGUgaW4gbWFudWFsQWJvcnRSZXF1ZXN0KCkgaW1wbGVtZW50YXRpb246ICcgKyB0aGlzLl9zdGF0ZTtcclxuICAgIH1cclxufTtcclxuXHJcbkZldGNoQ29udGV4dC5wcm90b3R5cGUuZ2V0Q29udGV4dFZhcnMgPSBmdW5jdGlvbiBnZXRDb250ZXh0VmFycygpIHtcclxuICAgIHJldHVybiB0aGlzLl9jb250ZXh0VmFycztcclxufTtcclxuXHJcbkZldGNoQ29udGV4dC5wcm90b3R5cGUub24gPSBmdW5jdGlvbiBvbihldmVudCwgbGlzdGVuZXIpIHtcclxuICAgIHN3aXRjaCAoZXZlbnQpIHtcclxuICAgICAgICBjYXNlICd0ZXJtaW5hdGVkJzpcclxuICAgICAgICAgICAgdGhpcy5fdGVybWluYXRlZExpc3RlbmVycy5wdXNoKGxpc3RlbmVyKTtcclxuICAgICAgICAgICAgYnJlYWs7XHJcbiAgICAgICAgZGVmYXVsdDpcclxuICAgICAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogVW5leHBlY3RlZCBldmVudCAnICsgZXZlbnQ7XHJcbiAgICB9XHJcbn07XHJcblxyXG5GZXRjaENvbnRleHQucHJvdG90eXBlLnNldElzUHJvZ3Jlc3NpdmUgPSBmdW5jdGlvbiBzZXRJc1Byb2dyZXNzaXZlKGlzUHJvZ3Jlc3NpdmUpIHtcclxuICAgIHRoaXMuX2lzUHJvZ3Jlc3NpdmUgPSBpc1Byb2dyZXNzaXZlO1xyXG4gICAgaWYgKHRoaXMuX2ZldGNoQ29udGV4dEFwaSAhPT0gbnVsbCkge1xyXG4gICAgICAgIHRoaXMuX2ZldGNoQ29udGV4dEFwaS5fb25FdmVudCgnaXNQcm9ncmVzc2l2ZUNoYW5nZWQnLCBpc1Byb2dyZXNzaXZlKTtcclxuICAgIH1cclxufTtcclxuXHJcbkZldGNoQ29udGV4dC5wcm90b3R5cGUuZ2V0SXNQcm9ncmVzc2l2ZSA9IGZ1bmN0aW9uIGdldElzUHJvZ3Jlc3NpdmUoKSB7XHJcbiAgICByZXR1cm4gdGhpcy5faXNQcm9ncmVzc2l2ZTtcclxufTtcclxuXHJcbkZldGNoQ29udGV4dC5wcm90b3R5cGUuX3N0YXJ0RmV0Y2ggPSBmdW5jdGlvbiBzdGFydEZldGNoKCkge1xyXG4gICAgdmFyIHByZXZTdGF0ZSA9IHRoaXMuX3N0YXRlO1xyXG4gICAgdGhpcy5fc3RhdGUgPSBGZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX0FDVElWRTtcclxuXHRcclxuICAgIGlmICh0aGlzLl9pc09ubHlXYWl0Rm9yRGF0YSkge1xyXG4gICAgICAgIHRoaXMuX2ZldGNoQ29udGV4dEFwaSA9IHRoaXMuX2V4dHJhY3RBbHJlYWR5RmV0Y2hlZERhdGEoKTtcclxuICAgIH0gZWxzZSBpZiAoIXRoaXMuX2lzTW92YWJsZSB8fCBwcmV2U3RhdGUgPT09IEZldGNoQ29udGV4dC5GRVRDSF9TVEFUVVNfV0FJVF9GT1JfRkVUQ0hfQ0FMTCkge1xyXG5cdFx0aWYgKHRoaXMuX2ZldGNoQ29udGV4dEFwaSAhPT0gbnVsbCkge1xyXG5cdFx0XHR0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBDYW5ub3Qgc3RhcnQgZmV0Y2ggb2YgYWxyZWFkeSBzdGFydGVkIGZldGNoJztcclxuXHRcdH1cclxuXHJcbiAgICAgICAgdGhpcy5fZmV0Y2hDb250ZXh0QXBpID0gbmV3IEZldGNoQ29udGV4dEFwaSh0aGlzKTtcclxuXHRcdHRoaXMuX2ZldGNoQ29udGV4dEFwaS5vbignaW50ZXJuYWxTdG9wcGVkJywgdGhpcy5fZmV0Y2hTdG9wcGVkLCB0aGlzKTtcclxuXHRcdHRoaXMuX2ZldGNoQ29udGV4dEFwaS5vbignaW50ZXJuYWxEb25lJywgdGhpcy5fZmV0Y2hEb25lLCB0aGlzKTtcclxuXHRcdFxyXG5cdFx0aWYgKHRoaXMuX2lzTW92YWJsZSkge1xyXG5cdFx0XHR0aGlzLl9mZXRjaGVyLnN0YXJ0TW92YWJsZUZldGNoKHRoaXMuX2ZldGNoQ29udGV4dEFwaSwgdGhpcy5faW1hZ2VQYXJ0UGFyYW1zKTtcclxuXHRcdH0gZWxzZSB7XHJcblx0XHRcdHRoaXMuX2ZldGNoZXIuc3RhcnRGZXRjaCh0aGlzLl9mZXRjaENvbnRleHRBcGksIHRoaXMuX2ltYWdlUGFydFBhcmFtcyk7XHJcblx0XHR9XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICAgIHRoaXMuX2ZldGNoQ29udGV4dEFwaS5fb25FdmVudCgnbW92ZScsIHRoaXMuX2ltYWdlUGFydFBhcmFtcyk7XHJcbiAgICB9XHJcbiAgICBcclxuXHRpZiAodGhpcy5fZmV0Y2hDb250ZXh0QXBpICE9PSBudWxsKSB7IC8vIE1pZ2h0IGJlIHNldCB0byBudWxsIGluIGltbWVkaWF0ZSBjYWxsIG9mIGZldGNoVGVybWluYXRlZCBvbiBwcmV2aW91cyBsaW5lXHJcblx0XHR0aGlzLl9mZXRjaENvbnRleHRBcGkuX29uRXZlbnQoJ2lzUHJvZ3Jlc3NpdmVDaGFuZ2VkJywgdGhpcy5faXNQcm9ncmVzc2l2ZSk7XHJcblx0fVxyXG59O1xyXG5cclxuRmV0Y2hDb250ZXh0LnByb3RvdHlwZS5jaGVja0lmU2hvdWxkWWllbGQgPSBmdW5jdGlvbiBjaGVja0lmU2hvdWxkWWllbGQoKSB7XHJcbiAgICB0cnkge1xyXG4gICAgICAgIGlmICghdGhpcy5fdXNlU2NoZWR1bGVyIHx8IHRoaXMuX3N0YXRlID09PSBGZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX1JFUVVFU1RfVEVSTUlOQVRFRCkge1xyXG4gICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIGlmICh0aGlzLl9yZXNvdXJjZSA9PT0gbnVsbCkge1xyXG4gICAgICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBObyByZXNvdXJjZSBhbGxvY2F0ZWQgYnV0IGZldGNoIGNhbGxiYWNrIGNhbGxlZCc7XHJcbiAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICBpZiAoIXRoaXMuX3NjaGVkdWxlckNhbGxiYWNrcy5zaG91bGRZaWVsZE9yQWJvcnQoKSkge1xyXG4gICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHRoaXMuX3N0YXRlID0gRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19SRVFVRVNUX0FCT1VUX1RPX1lJRUxEO1xyXG5cdFx0dGhpcy5fZmV0Y2hDb250ZXh0QXBpLl9vbkV2ZW50KCdzdG9wJywgLyppc0Fib3J0ZWQ9Ki9mYWxzZSk7XHJcbiAgICB9IGNhdGNoIChlKSB7XHJcbiAgICAgICAgdGhpcy5fc3RhdGUgPSBGZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX1VORVhQRUNURURfRkFJTFVSRTtcclxuICAgICAgICBmZXRjaEFib3J0ZWRCeVNjaGVkdWxlcih0aGlzKTtcclxuICAgIH1cclxufTtcclxuXHJcbkZldGNoQ29udGV4dC5wcm90b3R5cGUuX2ZldGNoRG9uZSA9IGZ1bmN0aW9uIGZldGNoRG9uZSgpIHtcclxuICAgIHN3aXRjaCAodGhpcy5fc3RhdGUpIHtcclxuICAgICAgICBjYXNlIEZldGNoQ29udGV4dC5GRVRDSF9TVEFUVVNfUkVRVUVTVF9BQk9VVF9UT19BQk9SVDpcclxuICAgICAgICBjYXNlIEZldGNoQ29udGV4dC5GRVRDSF9TVEFUVVNfQUNUSVZFOlxyXG4gICAgICAgIGNhc2UgRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19SRVFVRVNUX0FCT1VUX1RPX1lJRUxEOlxyXG4gICAgICAgICAgICBicmVhaztcclxuICAgICAgICBkZWZhdWx0OlxyXG4gICAgICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBVbmV4cGVjdGVkIHN0YXRlIG9uIGZldGNoIGRvbmU6ICcgKyB0aGlzLl9zdGF0ZTtcclxuICAgIH1cclxuXHJcblx0aWYgKHRoaXMuX3Jlc291cmNlICE9PSBudWxsKSB7XHJcbiAgICAgICAgdGhpcy5fc2NoZWR1bGVkSm9ic0xpc3QucmVtb3ZlKHRoaXMuX3NjaGVkdWxlZEpvYnNMaXN0SXRlcmF0b3IpO1xyXG4gICAgICAgIHRoaXMuX3NjaGVkdWxlckNhbGxiYWNrcy5qb2JEb25lKCk7XHJcblxyXG4gICAgICAgIHRoaXMuX3Jlc291cmNlID0gbnVsbDtcclxuICAgIH0gZWxzZSBpZiAodGhpcy5fdXNlU2NoZWR1bGVyKSB7XHJcbiAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogSm9iIGV4cGVjdGVkIHRvIGhhdmUgcmVzb3VyY2Ugb24gc3VjY2Vzc2Z1bCB0ZXJtaW5hdGlvbic7XHJcbiAgICB9XHJcblx0XHJcblx0dGhpcy5fdGVybWluYXRlTm9uTW92YWJsZUZldGNoKCk7XHJcbn07XHJcblxyXG5GZXRjaENvbnRleHQucHJvdG90eXBlLl9mZXRjaFN0b3BwZWQgPSBmdW5jdGlvbiBmZXRjaFN0b3BwZWQoaXNBYm9ydGVkKSB7XHJcbiAgICBzd2l0Y2ggKHRoaXMuX3N0YXRlKSB7XHJcbiAgICAgICAgY2FzZSBGZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX1JFUVVFU1RfQUJPVVRfVE9fQUJPUlQ6XHJcblx0XHRcdGlzQWJvcnRlZCA9IHRydWU7IC8vIGZvcmNlIGFib3J0ZWRcclxuICAgICAgICAgICAgYnJlYWs7XHJcbiAgICAgICAgY2FzZSBGZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX1JFUVVFU1RfQUJPVVRfVE9fWUlFTEQ6XHJcblx0XHRcdHZhciBpc1lpZWxkZWQgPSB0aGlzLl9zY2hlZHVsZXJDYWxsYmFja3MudHJ5WWllbGQoXHJcblx0XHRcdFx0Y29udGludWVZaWVsZGVkUmVxdWVzdCxcclxuXHRcdFx0XHRmZXRjaEFib3J0ZWRCeVNjaGVkdWxlcixcclxuXHRcdFx0XHRmZXRjaFlpZWxkZWRCeVNjaGVkdWxlcik7XHJcblx0XHRcdFxyXG5cdFx0XHRpZiAoIWlzWWllbGRlZCkge1xyXG5cdFx0XHRcdGlmICh0aGlzLl9zdGF0ZSAhPT0gRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19SRVFVRVNUX0FCT1VUX1RPX1lJRUxEKSB7XHJcblx0XHRcdFx0XHR0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBVbmV4cGVjdGVkIHN0YXRlIG9uIHRyeVlpZWxkKCkgZmFsc2U6ICcgKyB0aGlzLl9zdGF0ZTtcclxuXHRcdFx0XHR9XHJcblx0XHRcdFx0dGhpcy5fc3RhdGUgPSBGZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX0FDVElWRTtcclxuXHRcdFx0XHR0aGlzLl9mZXRjaENvbnRleHRBcGkuX29uRXZlbnQoJ3Jlc3VtZScpO1xyXG5cdFx0XHRcdHJldHVybjtcclxuXHRcdFx0fVxyXG4gICAgICAgICAgICBicmVhaztcclxuICAgICAgICBkZWZhdWx0OlxyXG4gICAgICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBVbmV4cGVjdGVkIHN0YXRlIG9uIGZldGNoIHN0b3BwZWQ6ICcgKyB0aGlzLl9zdGF0ZTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgaWYgKHRoaXMuX3Jlc291cmNlICE9PSBudWxsKSB7XHJcblx0XHR0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBVbmV4cGVjdGVkIHJlcXVlc3QgdGVybWluYXRpb24gd2l0aG91dCByZXNvdXJjZSBhbGxvY2F0ZWQnO1xyXG4gICAgfVxyXG5cdGlmICghaXNBYm9ydGVkKSB7XHJcblx0XHR0aGlzLl90ZXJtaW5hdGVOb25Nb3ZhYmxlRmV0Y2goKTtcclxuXHR9XHJcbn07XHJcbiAgXHJcbkZldGNoQ29udGV4dC5wcm90b3R5cGUuX3Rlcm1pbmF0ZU5vbk1vdmFibGVGZXRjaCA9IGZ1bmN0aW9uIHRlcm1pbmF0ZU5vbk1vdmFibGVGZXRjaCgpIHsgIFxyXG4gICAgaWYgKHRoaXMuX2lzTW92YWJsZSkge1xyXG5cdFx0cmV0dXJuO1xyXG5cdH1cclxuXHRcclxuXHR0aGlzLl9zdGF0ZSA9IEZldGNoQ29udGV4dC5GRVRDSF9TVEFUVVNfUkVRVUVTVF9URVJNSU5BVEVEO1xyXG5cdFxyXG5cdGZvciAodmFyIGkgPSAwOyBpIDwgdGhpcy5fdGVybWluYXRlZExpc3RlbmVycy5sZW5ndGg7ICsraSkge1xyXG5cdFx0dGhpcy5fdGVybWluYXRlZExpc3RlbmVyc1tpXSh0aGlzLl9jb250ZXh0VmFycyk7XHJcblx0fVxyXG4gICAgXHJcbiAgICBpZiAodGhpcy5fZmV0Y2hDb250ZXh0QXBpICE9PSBudWxsICYmXHJcbiAgICAgICAgdGhpcy5fc3RhdGUgIT09IEZldGNoQ29udGV4dC5GRVRDSF9TVEFUVVNfVU5FWFBFQ1RFRF9GQUlMVVJFKSB7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgIHRoaXMuX2ZldGNoQ29udGV4dEFwaS5fb25FdmVudCgndGVybWluYXRlJyk7XHJcbiAgICAgICAgdGhpcy5fZmV0Y2hDb250ZXh0QXBpID0gbnVsbDtcclxuICAgIH1cclxufTtcclxuXHJcbi8vIFByb3BlcnRpZXMgZm9yIEZydXN0dW1SZXF1ZXNldFByaW9yaXRpemVyXHJcblxyXG5PYmplY3QuZGVmaW5lUHJvcGVydHkoRmV0Y2hDb250ZXh0LnByb3RvdHlwZSwgJ2ltYWdlUGFydFBhcmFtcycsIHtcclxuICAgIGdldDogZnVuY3Rpb24gZ2V0SW1hZ2VQYXJ0UGFyYW1zKCkge1xyXG4gICAgICAgIHJldHVybiB0aGlzLl9pbWFnZVBhcnRQYXJhbXM7XHJcbiAgICB9XHJcbn0pO1xyXG5cclxuZnVuY3Rpb24gc3RhcnRSZXF1ZXN0KHJlc291cmNlLCBzZWxmLCBjYWxsYmFja3MpIHtcclxuICAgIGlmIChzZWxmLl9yZXNvdXJjZSAhPT0gbnVsbCkge1xyXG4gICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IFVuZXhwZWN0ZWQgcmVzdGFydCBvZiBhbHJlYWR5IHN0YXJ0ZWQgcmVxdWVzdCc7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGlmIChzZWxmLl9zdGF0ZSA9PT0gRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19SRVFVRVNUX0FCT1VUX1RPX0FCT1JUKSB7XHJcbiAgICAgICAgc2VsZi5fZmV0Y2hTdG9wcGVkKC8qaXNBYm9ydGVkPSovdHJ1ZSk7XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgfSBlbHNlIGlmIChzZWxmLl9zdGF0ZSAhPT0gRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19SRVFVRVNUX1dBSVRfRk9SX1NDSEVEVUxFKSB7XHJcbiAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogVW5leHBlY3RlZCBzdGF0ZSBvbiBzY2hlZHVsZTogJyArIHNlbGYuX3N0YXRlO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBzZWxmLl9yZXNvdXJjZSA9IHJlc291cmNlO1xyXG5cdHNlbGYuX3NjaGVkdWxlckNhbGxiYWNrcyA9IGNhbGxiYWNrcztcclxuXHJcbiAgICBpZiAocmVzb3VyY2UgIT09IG51bGwpIHtcclxuICAgICAgICBzZWxmLl9zY2hlZHVsZWRKb2JzTGlzdEl0ZXJhdG9yID0gc2VsZi5fc2NoZWR1bGVkSm9ic0xpc3QuYWRkKHNlbGYpO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBzZWxmLl9zdGFydEZldGNoKCk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGNvbnRpbnVlWWllbGRlZFJlcXVlc3QocmVzb3VyY2UsIHNlbGYpIHtcclxuICAgIGlmIChzZWxmLl9pc01vdmFibGUpIHtcclxuICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBVbmV4cGVjdGVkIGNhbGwgdG8gY29udGludWVZaWVsZGVkUmVxdWVzdCBvbiBtb3ZhYmxlIGZldGNoJztcclxuICAgIH1cclxuXHJcbiAgICBpZiAoc2VsZi5fc3RhdGUgPT09IEZldGNoQ29udGV4dC5GRVRDSF9TVEFUVVNfUkVRVUVTVF9BQk9VVF9UT19BQk9SVCB8fFxyXG4gICAgICAgIHNlbGYuX3N0YXRlID09PSBGZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX1VORVhQRUNURURfRkFJTFVSRSkge1xyXG4gICAgICAgIFxyXG4gICAgICAgIHNlbGYuX3NjaGVkdWxlckNhbGxiYWNrcy5qb2JEb25lKCk7XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBpZiAoc2VsZi5fc3RhdGUgIT09IEZldGNoQ29udGV4dC5GRVRDSF9TVEFUVVNfUkVRVUVTVF9ZSUVMREVEKSB7XHJcbiAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogVW5leHBlY3RlZCByZXF1ZXN0IHN0YXRlIG9uIGNvbnRpbnVlOiAnICsgc2VsZi5fc3RhdGU7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHNlbGYuX3N0YXRlID0gRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19BQ1RJVkU7XHJcbiAgICBzZWxmLl9yZXNvdXJjZSA9IHJlc291cmNlO1xyXG4gICAgXHJcbiAgICBzZWxmLl9zY2hlZHVsZWRKb2JzTGlzdEl0ZXJhdG9yID0gc2VsZi5fc2NoZWR1bGVkSm9ic0xpc3QuYWRkKHNlbGYpO1xyXG4gICAgc2VsZi5fb25FdmVudCgncmVzdW1lJyk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGZldGNoWWllbGRlZEJ5U2NoZWR1bGVyKHNlbGYpIHtcclxuICAgIHZhciBuZXh0U3RhdGU7XHJcbiAgICBzZWxmLl9yZXNvdXJjZSA9IG51bGw7XHJcbiAgICBzZWxmLl9zY2hlZHVsZWRKb2JzTGlzdC5yZW1vdmUoc2VsZi5fc2NoZWR1bGVkSm9ic0xpc3RJdGVyYXRvcik7XHJcbiAgICBpZiAoc2VsZi5zdGF0ZSA9PT0gRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19SRVFVRVNUX0FCT1VUX1RPX1lJRUxEKSB7XHJcbiAgICAgICAgc2VsZi5fc3RhdGUgPSBGZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX1JFUVVFU1RfWUlFTERFRDtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgICAgc2VsZi5fc3RhdGUgPSBGZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX1VORVhQRUNURURfRkFJTFVSRTtcclxuICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBVbmV4cGVjdGVkIHJlcXVlc3Qgc3RhdGUgb24geWllbGQgcHJvY2VzczogJyArIHNlbGYuX3N0YXRlO1xyXG4gICAgfVxyXG59XHJcblxyXG5mdW5jdGlvbiBmZXRjaEFib3J0ZWRCeVNjaGVkdWxlcihzZWxmKSB7XHJcbiAgICBzZWxmLl9yZXNvdXJjZSA9IG51bGw7XHJcbiAgICBzZWxmLl9mZXRjaFN0b3BwZWQoLyppc0Fib3J0ZWQ9Ki90cnVlKTtcclxufSIsIid1c2Ugc3RyaWN0JztcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gRmV0Y2hlckJhc2U7XHJcblxyXG52YXIgaW1hZ2VIZWxwZXJGdW5jdGlvbnMgPSByZXF1aXJlKCdpbWFnZS1oZWxwZXItZnVuY3Rpb25zLmpzJyk7XHJcbnZhciBGZXRjaENvbnRleHQgPSByZXF1aXJlKCdmZXRjaC1jb250ZXh0LmpzJyk7XHJcbnZhciBMaW5rZWRMaXN0ID0gcmVxdWlyZSgnbGlua2VkLWxpc3QuanMnKTtcclxudmFyIEZldGNoZXJDbG9zZXIgPSByZXF1aXJlKCdmZXRjaGVyLWNsb3Nlci5qcycpO1xyXG52YXIgU2ltcGxlTW92YWJsZUZldGNoID0gcmVxdWlyZSgnc2ltcGxlLW1vdmFibGUtZmV0Y2guanMnKTtcclxuXHJcbi8qIGdsb2JhbCBjb25zb2xlOiBmYWxzZSAqL1xyXG4vKiBnbG9iYWwgUHJvbWlzZTogZmFsc2UgKi9cclxuXHJcbmZ1bmN0aW9uIEZldGNoZXJCYXNlKG9wdGlvbnMpIHtcclxuICAgIG9wdGlvbnMgPSBvcHRpb25zIHx8IHt9O1xyXG5cdFxyXG5cdHZhciBzZWxmID0gdGhpcztcclxuICAgIHZhciBzZXJ2ZXJSZXF1ZXN0c0xpbWl0ID0gb3B0aW9ucy5zZXJ2ZXJSZXF1ZXN0c0xpbWl0IHx8IDU7XHJcbiAgICBcclxuICAgIHNlbGYuX3Nob3dMb2cgPSBvcHRpb25zLnNob3dMb2c7XHJcblx0c2VsZi5fbWF4QWN0aXZlRmV0Y2hlc0luTW92YWJsZUZldGNoID0gb3B0aW9ucy5tYXhBY3RpdmVGZXRjaGVzSW5Nb3ZhYmxlRmV0Y2ggfHwgMjtcclxuICAgIFxyXG4gICAgaWYgKHNlbGYuX3Nob3dMb2cpIHtcclxuICAgICAgICAvLyBPbGQgSUVcclxuICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBzaG93TG9nIGlzIG5vdCBzdXBwb3J0ZWQgb24gdGhpcyBicm93c2VyJztcclxuICAgIH1cclxuXHRcclxuICAgIHZhciBzZXJ2ZXJSZXF1ZXN0U2NoZWR1bGVyID0gaW1hZ2VIZWxwZXJGdW5jdGlvbnMuY3JlYXRlU2NoZWR1bGVyKFxyXG4gICAgICAgIG9wdGlvbnMuc2hvd0xvZyxcclxuICAgICAgICBvcHRpb25zLnNlcnZlclJlcXVlc3RQcmlvcml0aXplcixcclxuICAgICAgICAnc2VydmVyUmVxdWVzdCcsXHJcbiAgICAgICAgY3JlYXRlU2VydmVyUmVxdWVzdER1bW15UmVzb3VyY2UsXHJcbiAgICAgICAgc2VydmVyUmVxdWVzdHNMaW1pdCk7XHJcbiAgICBcclxuICAgIHNlbGYuX3NlcnZlclJlcXVlc3RQcmlvcml0aXplciA9IHNlcnZlclJlcXVlc3RTY2hlZHVsZXIucHJpb3JpdGl6ZXI7XHJcbiAgICBcclxuICAgIHNlbGYuX3NjaGVkdWxlciA9IHNlcnZlclJlcXVlc3RTY2hlZHVsZXIuc2NoZWR1bGVyO1xyXG4gICAgc2VsZi5fbW92YWJsZUhhbmRsZUNvdW50ZXIgPSAwO1xyXG4gICAgc2VsZi5fbW92YWJsZUhhbmRsZXMgPSBbXTtcclxuICAgIHNlbGYuX3JlcXVlc3RCeUlkID0gW107XHJcblx0c2VsZi5faW1hZ2VQYXJhbXMgPSBudWxsO1xyXG4gICAgc2VsZi5fc2NoZWR1bGVkSm9ic0xpc3QgPSBuZXcgTGlua2VkTGlzdCgpO1xyXG5cdHNlbGYuX2ZldGNoZXJDbG9zZXIgPSBuZXcgRmV0Y2hlckNsb3NlcigpO1xyXG59XHJcblxyXG5GZXRjaGVyQmFzZS5wcm90b3R5cGUub3BlbiA9IGZ1bmN0aW9uIG9wZW4odXJsKSB7XHJcbiAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBvcGVuKCkgaXMgbm90IGltcGxlbWVudGVkIGJ5IEZldGNoZXJCYXNlIGluaGVyaXRvcic7XHJcbn07XHJcblxyXG5GZXRjaGVyQmFzZS5wcm90b3R5cGUub24gPSBmdW5jdGlvbiBvbihldmVudCwgY2FsbGJhY2spIHtcclxuICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IG9uKCkgaXMgbm90IGltcGxlbWVudGVkIGJ5IEZldGNoZXJCYXNlIGluaGVyaXRvcic7XHJcbn07XHJcblxyXG5GZXRjaGVyQmFzZS5wcm90b3R5cGUuY2xvc2UgPSBmdW5jdGlvbiBjbG9zZSgpIHtcclxuXHRpZiAodGhpcy5zdGFydE1vdmFibGVGZXRjaCAhPT0gRmV0Y2hlckJhc2UucHJvdG90eXBlLnN0YXJ0TW92YWJsZUZldGNoKSB7XHJcblx0XHR0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBNdXN0IG92ZXJyaWRlIEZldGNoZXJCYXNlLmNsb3NlKCkgd2hlbiBGZXRjaGVyQmFzZS5zdGFydE1vdmFibGVGZXRjaCgpIHdhcyBvdmVycmlkZSc7XHJcblx0fVxyXG4gICAgcmV0dXJuIHRoaXMuX2ZldGNoZXJDbG9zZXIuY2xvc2UoKTtcclxufTtcclxuXHJcbkZldGNoZXJCYXNlLnByb3RvdHlwZS5vcGVuSW50ZXJuYWwgPSBmdW5jdGlvbiBvcGVuSW50ZXJuYWwodXJsKSB7XHJcblx0dmFyIHNlbGYgPSB0aGlzO1xyXG4gICAgcmV0dXJuIHRoaXMub3Blbih1cmwpLnRoZW4oZnVuY3Rpb24ocmVzdWx0KSB7XHJcblx0XHRzZWxmLl9pbWFnZVBhcmFtcyA9IHJlc3VsdDtcclxuXHRcdHJldHVybiByZXN1bHQ7XHJcblx0fSk7XHJcbn07XHJcblxyXG5GZXRjaGVyQmFzZS5wcm90b3R5cGUuZ2V0SW1hZ2VQYXJhbXMgPSBmdW5jdGlvbiBnZXRJbWFnZVBhcmFtcygpIHtcclxuXHRyZXR1cm4gdGhpcy5faW1hZ2VQYXJhbXM7XHJcbn07XHJcblxyXG5GZXRjaGVyQmFzZS5wcm90b3R5cGUuc3RhcnRGZXRjaCA9IGZ1bmN0aW9uIHN0YXJ0RmV0Y2goZmV0Y2hDb250ZXh0LCBpbWFnZVBhcnRQYXJhbXMpIHtcclxuICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IHN0YXJ0RmV0Y2goKSBpcyBub3QgaW1wbGVtZW50ZWQgYnkgRmV0Y2hlckJhc2UgaW5oZXJpdG9yJztcclxufTtcclxuXHJcbkZldGNoZXJCYXNlLnByb3RvdHlwZS5zdGFydE1vdmFibGVGZXRjaCA9IGZ1bmN0aW9uIHN0YXJ0RmV0Y2goZmV0Y2hDb250ZXh0LCBpbWFnZVBhcnRQYXJhbXMpIHtcclxuICAgIHZhciBtb3ZhYmxlRmV0Y2ggPSBuZXcgU2ltcGxlTW92YWJsZUZldGNoKFxyXG5cdFx0dGhpcywgdGhpcy5fZmV0Y2hlckNsb3NlciwgZmV0Y2hDb250ZXh0LCB0aGlzLl9tYXhBY3RpdmVGZXRjaGVzSW5Nb3ZhYmxlRmV0Y2gpO1xyXG5cdFxyXG5cdG1vdmFibGVGZXRjaC5zdGFydChpbWFnZVBhcnRQYXJhbXMpO1xyXG59O1xyXG5cclxuRmV0Y2hlckJhc2UucHJvdG90eXBlLnNldElzUHJvZ3Jlc3NpdmVSZXF1ZXN0ID0gZnVuY3Rpb24gc2V0SXNQcm9ncmVzc2l2ZVJlcXVlc3QoXHJcbiAgICByZXF1ZXN0SWQsIGlzUHJvZ3Jlc3NpdmUpIHtcclxuICAgIFxyXG4gICAgdmFyIGZldGNoSm9iID0gdGhpcy5fcmVxdWVzdEJ5SWRbcmVxdWVzdElkXTtcclxuICAgIGlmIChmZXRjaEpvYiA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgLy8gVGhpcyBzaXR1YXRpb24gbWlnaHQgb2NjdXIgaWYgcmVxdWVzdCBoYXMgYmVlbiB0ZXJtaW5hdGVkLFxyXG4gICAgICAgIC8vIGJ1dCB1c2VyJ3MgdGVybWluYXRlZENhbGxiYWNrIGhhcyBub3QgYmVlbiBjYWxsZWQgeWV0LiBJdFxyXG4gICAgICAgIC8vIGhhcHBlbnMgb24gV29ya2VyUHJveHlGZXRjaGVyQmFzZSBkdWUgdG8gdGhyZWFkXHJcbiAgICAgICAgLy8gbWVzc2FnZSBkZWxheS5cclxuICAgICAgICBcclxuICAgICAgICByZXR1cm4gbnVsbDtcclxuICAgIH1cclxuICAgIFxyXG4gICAgZmV0Y2hKb2Iuc2V0SXNQcm9ncmVzc2l2ZShpc1Byb2dyZXNzaXZlKTtcclxufTtcclxuXHJcbkZldGNoZXJCYXNlLnByb3RvdHlwZS5jcmVhdGVNb3ZhYmxlRmV0Y2ggPSBmdW5jdGlvbiBjcmVhdGVNb3ZhYmxlRmV0Y2goKSB7XHJcblx0dmFyIHNlbGYgPSB0aGlzO1xyXG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKGZ1bmN0aW9uKHJlc29sdmUsIHJlamVjdCkge1xyXG4gICAgICAgIHZhciBtb3ZhYmxlSGFuZGxlID0gKytzZWxmLl9tb3ZhYmxlSGFuZGxlQ291bnRlcjtcclxuICAgICAgICBzZWxmLl9tb3ZhYmxlSGFuZGxlc1ttb3ZhYmxlSGFuZGxlXSA9IG5ldyBGZXRjaENvbnRleHQoXHJcbiAgICAgICAgICAgIHNlbGYsXHJcbiAgICAgICAgICAgIHNlbGYuX3NjaGVkdWxlcixcclxuICAgICAgICAgICAgc2VsZi5fc2NoZWR1bGVkSm9ic0xpc3QsXHJcbiAgICAgICAgICAgIEZldGNoQ29udGV4dC5GRVRDSF9UWVBFX01PVkFCTEUsXHJcbiAgICAgICAgICAgIC8qY29udGV4dFZhcnM9Ki9udWxsKTtcclxuXHJcbiAgICAgICAgcmVzb2x2ZShtb3ZhYmxlSGFuZGxlKTtcclxuICAgIH0pO1xyXG59O1xyXG5cclxuRmV0Y2hlckJhc2UucHJvdG90eXBlLm1vdmVGZXRjaCA9IGZ1bmN0aW9uIG1vdmVGZXRjaChcclxuICAgIG1vdmFibGVIYW5kbGUsIGltYWdlUGFydFBhcmFtcykge1xyXG4gICAgXHJcbiAgICB2YXIgbW92YWJsZSA9IHRoaXMuX21vdmFibGVIYW5kbGVzW21vdmFibGVIYW5kbGVdO1xyXG4gICAgbW92YWJsZS5mZXRjaChpbWFnZVBhcnRQYXJhbXMpO1xyXG59O1xyXG5cclxuRmV0Y2hlckJhc2UucHJvdG90eXBlLmNyZWF0ZVJlcXVlc3QgPSBmdW5jdGlvbiBjcmVhdGVSZXF1ZXN0KFxyXG4gICAgcmVxdWVzdElkLCBpbWFnZVBhcnRQYXJhbXMpIHtcclxuICAgIFxyXG4gICAgdmFyIGNvbnRleHRWYXJzID0ge1xyXG4gICAgICAgIHByb2dyZXNzaXZlU3RhZ2VzRG9uZTogMCxcclxuICAgICAgICBpc0xhc3RDYWxsYmFja0NhbGxlZFdpdGhvdXRMb3dRdWFsaXR5TGltaXQ6IGZhbHNlLFxyXG4gICAgICAgIHJlcXVlc3RJZDogcmVxdWVzdElkLFxyXG4gICAgICAgIGZldGNoSm9iOiBudWxsLFxyXG4gICAgICAgIHNlbGY6IHRoaXNcclxuICAgIH07XHJcbiAgICBcclxuICAgIHZhciBmZXRjaFR5cGUgPSAvKmlzT25seVdhaXRGb3JEYXRhID9cclxuICAgICAgICBGZXRjaENvbnRleHQuRkVUQ0hfVFlQRV9PTkxZX1dBSVRfRk9SX0RBVEEgOiAqL0ZldGNoQ29udGV4dC5GRVRDSF9UWVBFX1JFUVVFU1Q7XHJcbiAgICBcclxuICAgIHZhciBmZXRjaEpvYiA9IG5ldyBGZXRjaENvbnRleHQoXHJcbiAgICAgICAgdGhpcywgdGhpcy5fc2NoZWR1bGVyLCB0aGlzLl9zY2hlZHVsZWRKb2JzTGlzdCwgZmV0Y2hUeXBlLCBjb250ZXh0VmFycyk7XHJcbiAgICBcclxuICAgIGNvbnRleHRWYXJzLmZldGNoSm9iID0gZmV0Y2hKb2I7XHJcbiAgICBcclxuICAgIGlmICh0aGlzLl9yZXF1ZXN0QnlJZFtyZXF1ZXN0SWRdICE9PSB1bmRlZmluZWQpIHtcclxuICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBEdXBsaWNhdGlvbiBvZiByZXF1ZXN0SWQgJyArIHJlcXVlc3RJZDtcclxuICAgIH0gZWxzZSBpZiAocmVxdWVzdElkICE9PSB1bmRlZmluZWQpIHtcclxuICAgICAgICB0aGlzLl9yZXF1ZXN0QnlJZFtyZXF1ZXN0SWRdID0gZmV0Y2hKb2I7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGZldGNoSm9iLm9uKCd0ZXJtaW5hdGVkJywgaW50ZXJuYWxUZXJtaW5hdGVkQ2FsbGJhY2spO1xyXG4gICAgXHJcbiAgICBmZXRjaEpvYi5mZXRjaChpbWFnZVBhcnRQYXJhbXMpO1xyXG4gICAgXHJcbiAgICB0aGlzLl95aWVsZEZldGNoSm9icygpO1xyXG59O1xyXG5cclxuRmV0Y2hlckJhc2UucHJvdG90eXBlLm1hbnVhbEFib3J0UmVxdWVzdCA9IGZ1bmN0aW9uIG1hbnVhbEFib3J0UmVxdWVzdChcclxuICAgIHJlcXVlc3RJZCkge1xyXG4gICAgXHJcbiAgICB2YXIgZmV0Y2hKb2IgPSB0aGlzLl9yZXF1ZXN0QnlJZFtyZXF1ZXN0SWRdO1xyXG4gICAgXHJcbiAgICBpZiAoZmV0Y2hKb2IgPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIC8vIFRoaXMgc2l0dWF0aW9uIG1pZ2h0IG9jY3VyIGlmIHJlcXVlc3QgaGFzIGJlZW4gdGVybWluYXRlZCxcclxuICAgICAgICAvLyBidXQgdXNlcidzIHRlcm1pbmF0ZWRDYWxsYmFjayBoYXMgbm90IGJlZW4gY2FsbGVkIHlldC4gSXRcclxuICAgICAgICAvLyBoYXBwZW5zIG9uIFdvcmtlclByb3h5RmV0Y2hlckJhc2UgZHVlIHRvIHdlYiB3b3JrZXJcclxuICAgICAgICAvLyBtZXNzYWdlIGRlbGF5LlxyXG4gICAgICAgIFxyXG4gICAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIFxyXG4gICAgZmV0Y2hKb2IubWFudWFsQWJvcnRSZXF1ZXN0KCk7XHJcbiAgICBkZWxldGUgdGhpcy5fcmVxdWVzdEJ5SWRbcmVxdWVzdElkXTtcclxufTtcclxuXHJcbkZldGNoZXJCYXNlLnByb3RvdHlwZS5zZXRTZXJ2ZXJSZXF1ZXN0UHJpb3JpdGl6ZXJEYXRhID1cclxuICAgIGZ1bmN0aW9uIHNldFNlcnZlclJlcXVlc3RQcmlvcml0aXplckRhdGEocHJpb3JpdGl6ZXJEYXRhKSB7XHJcblxyXG4gICAgaWYgKHRoaXMuX3NlcnZlclJlcXVlc3RQcmlvcml0aXplciA9PT0gbnVsbCkge1xyXG4gICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IE5vIHNlcnZlclJlcXVlc3QgcHJpb3JpdGl6ZXIgaGFzIGJlZW4gc2V0JztcclxuICAgIH1cclxuICAgIFxyXG4gICAgaWYgKHRoaXMuX3Nob3dMb2cpIHtcclxuICAgICAgICBjb25zb2xlLmxvZygnc2V0U2VydmVyUmVxdWVzdFByaW9yaXRpemVyRGF0YSgnICsgcHJpb3JpdGl6ZXJEYXRhICsgJyknKTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgcHJpb3JpdGl6ZXJEYXRhLmltYWdlID0gdGhpcztcclxuICAgIHRoaXMuX3NlcnZlclJlcXVlc3RQcmlvcml0aXplci5zZXRQcmlvcml0aXplckRhdGEocHJpb3JpdGl6ZXJEYXRhKTtcclxuICAgIHRoaXMuX3lpZWxkRmV0Y2hKb2JzKCk7XHJcbn07XHJcblxyXG5GZXRjaGVyQmFzZS5wcm90b3R5cGUuX3lpZWxkRmV0Y2hKb2JzID0gZnVuY3Rpb24geWllbGRGZXRjaEpvYnMoKSB7XHJcbiAgICB2YXIgaXRlcmF0b3IgPSB0aGlzLl9zY2hlZHVsZWRKb2JzTGlzdC5nZXRGaXJzdEl0ZXJhdG9yKCk7XHJcbiAgICB3aGlsZSAoaXRlcmF0b3IgIT09IG51bGwpIHtcclxuICAgICAgICB2YXIgZmV0Y2hKb2IgPSB0aGlzLl9zY2hlZHVsZWRKb2JzTGlzdC5nZXRWYWx1ZShpdGVyYXRvcik7XHJcbiAgICAgICAgaXRlcmF0b3IgPSB0aGlzLl9zY2hlZHVsZWRKb2JzTGlzdC5nZXROZXh0SXRlcmF0b3IoaXRlcmF0b3IpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGZldGNoSm9iLmNoZWNrSWZTaG91bGRZaWVsZCgpO1xyXG4gICAgfVxyXG59O1xyXG5cclxuZnVuY3Rpb24gaW50ZXJuYWxUZXJtaW5hdGVkQ2FsbGJhY2soY29udGV4dFZhcnMpIHtcclxuICAgIGRlbGV0ZSBjb250ZXh0VmFycy5zZWxmLl9yZXF1ZXN0QnlJZFtjb250ZXh0VmFycy5yZXF1ZXN0SWRdO1xyXG59XHJcblxyXG5mdW5jdGlvbiBjcmVhdGVTZXJ2ZXJSZXF1ZXN0RHVtbXlSZXNvdXJjZSgpIHtcclxuICAgIHJldHVybiB7fTtcclxufSIsIid1c2Ugc3RyaWN0JztcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gRmV0Y2hlckNsb3NlcjtcclxuXHJcbi8qIGdsb2JhbCBQcm9taXNlOiBmYWxzZSAqL1xyXG5cclxuZnVuY3Rpb24gRmV0Y2hlckNsb3NlcigpIHtcclxuXHR0aGlzLl9yZXNvbHZlQ2xvc2UgPSBudWxsO1xyXG5cdHRoaXMuX2FjdGl2ZUZldGNoZXMgPSAwO1xyXG5cdHRoaXMuX2lzQ2xvc2VkID0gZmFsc2U7XHJcbn1cclxuXHJcbkZldGNoZXJDbG9zZXIucHJvdG90eXBlLmNoYW5nZUFjdGl2ZUZldGNoZXNDb3VudCA9IGZ1bmN0aW9uIGNoYW5nZUFjdGl2ZUZldGNoZXNDb3VudChhZGRWYWx1ZSkge1xyXG5cdGlmICh0aGlzLl9pc0Nsb3NlZCkge1xyXG5cdFx0dGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogVW5leHBlY3RlZCBjaGFuZ2Ugb2YgYWN0aXZlIGZldGNoZXMgY291bnQgYWZ0ZXIgY2xvc2VkJztcclxuXHR9XHJcblx0dGhpcy5fYWN0aXZlRmV0Y2hlcyArPSBhZGRWYWx1ZTtcclxuXHRcclxuXHRpZiAodGhpcy5fYWN0aXZlRmV0Y2hlcyA9PT0gMCAmJiB0aGlzLl9yZXNvbHZlQ2xvc2UpIHtcclxuXHRcdHRoaXMuX2lzQ2xvc2VkID0gdHJ1ZTtcclxuXHRcdHRoaXMuX3Jlc29sdmVDbG9zZSgpO1xyXG5cdH1cclxufTtcclxuXHJcbkZldGNoZXJDbG9zZXIucHJvdG90eXBlLmlzQ2xvc2VSZXF1ZXN0ZWQgPSBmdW5jdGlvbiBpc0Nsb3NlUmVxdWVzdGVkKCkge1xyXG5cdHJldHVybiB0aGlzLl9pc0Nsb3NlZCB8fCAodGhpcy5fcmVzb2x2ZUNsb3NlICE9PSBudWxsKTtcclxufTtcclxuXHJcbkZldGNoZXJDbG9zZXIucHJvdG90eXBlLmNsb3NlID0gZnVuY3Rpb24gY2xvc2UoKSB7XHJcblx0cmV0dXJuIG5ldyBQcm9taXNlKGZ1bmN0aW9uKHJlc29sdmUsIHJlamVjdCkge1xyXG5cdFx0dGhpcy5fcmVzb2x2ZUNsb3NlID0gcmVzb2x2ZTtcclxuXHRcdGlmICh0aGlzLl9hY3RpdmVGZXRjaGVzID09PSAwKSB7XHJcblx0XHRcdHRoaXMuX3Jlc29sdmVDbG9zZSgpO1xyXG5cdFx0fVxyXG5cdH0pO1xyXG59OyIsIid1c2Ugc3RyaWN0JztcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gRnJ1c3R1bVJlcXVlc3RzUHJpb3JpdGl6ZXI7XHJcbnZhciBQUklPUklUWV9BQk9SVF9OT1RfSU5fRlJVU1RVTSA9IC0xO1xyXG52YXIgUFJJT1JJVFlfQ0FMQ1VMQVRJT05fRkFJTEVEID0gMDtcclxudmFyIFBSSU9SSVRZX1RPT19HT09EX1JFU09MVVRJT04gPSAxO1xyXG52YXIgUFJJT1JJVFlfTk9UX0lOX0ZSVVNUVU0gPSAyO1xyXG52YXIgUFJJT1JJVFlfTE9XRVJfUkVTT0xVVElPTiA9IDM7XHJcblxyXG52YXIgUFJJT1JJVFlfTUlOT1JJVFlfSU5fRlJVU1RVTSA9IDQ7XHJcbnZhciBQUklPUklUWV9QQVJUSUFMX0lOX0ZSVVNUVU0gPSA1O1xyXG52YXIgUFJJT1JJVFlfTUFKT1JJVFlfSU5fRlJVU1RVTSA9IDY7XHJcbnZhciBQUklPUklUWV9GVUxMWV9JTl9GUlVTVFVNID0gNztcclxuXHJcbnZhciBBRERfUFJJT1JJVFlfVE9fTE9XX1FVQUxJVFkgPSA1O1xyXG5cclxudmFyIFBSSU9SSVRZX0hJR0hFU1QgPSAxMztcclxuXHJcbnZhciBsb2cyID0gTWF0aC5sb2coMik7XHJcblxyXG5mdW5jdGlvbiBGcnVzdHVtUmVxdWVzdHNQcmlvcml0aXplcihcclxuICAgIGlzQWJvcnRSZXF1ZXN0c05vdEluRnJ1c3R1bSwgaXNQcmlvcml0aXplTG93UHJvZ3Jlc3NpdmVTdGFnZSkge1xyXG4gICAgXHJcbiAgICB0aGlzLl9mcnVzdHVtRGF0YSA9IG51bGw7XHJcbiAgICB0aGlzLl9pc0Fib3J0UmVxdWVzdHNOb3RJbkZydXN0dW0gPSBpc0Fib3J0UmVxdWVzdHNOb3RJbkZydXN0dW07XHJcbiAgICB0aGlzLl9pc1ByaW9yaXRpemVMb3dQcm9ncmVzc2l2ZVN0YWdlID0gaXNQcmlvcml0aXplTG93UHJvZ3Jlc3NpdmVTdGFnZTtcclxufVxyXG5cclxuT2JqZWN0LmRlZmluZVByb3BlcnR5KFxyXG4gICAgRnJ1c3R1bVJlcXVlc3RzUHJpb3JpdGl6ZXIucHJvdG90eXBlLCAnbWluaW1hbExvd1F1YWxpdHlQcmlvcml0eScsIHtcclxuICAgICAgICBnZXQ6IGZ1bmN0aW9uIG1pbmltYWxMb3dRdWFsaXR5UHJpb3JpdHkoKSB7XHJcbiAgICAgICAgICAgIHJldHVybiBQUklPUklUWV9NSU5PUklUWV9JTl9GUlVTVFVNICsgQUREX1BSSU9SSVRZX1RPX0xPV19RVUFMSVRZO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuKTtcclxuICAgIFxyXG5GcnVzdHVtUmVxdWVzdHNQcmlvcml0aXplci5wcm90b3R5cGUuc2V0UHJpb3JpdGl6ZXJEYXRhID0gZnVuY3Rpb24gc2V0UHJpb3JpdGl6ZXJEYXRhKHByaW9yaXRpemVyRGF0YSkge1xyXG4gICAgdGhpcy5fZnJ1c3R1bURhdGEgPSBwcmlvcml0aXplckRhdGE7XHJcbn07XHJcblxyXG5GcnVzdHVtUmVxdWVzdHNQcmlvcml0aXplci5wcm90b3R5cGUuZ2V0UHJpb3JpdHkgPSBmdW5jdGlvbiBnZXRQcmlvcml0eShqb2JDb250ZXh0KSB7XHJcbiAgICB2YXIgaW1hZ2VQYXJ0UGFyYW1zID0gam9iQ29udGV4dC5pbWFnZVBhcnRQYXJhbXM7XHJcbiAgICBpZiAoaW1hZ2VQYXJ0UGFyYW1zLnJlcXVlc3RQcmlvcml0eURhdGEub3ZlcnJpZGVIaWdoZXN0UHJpb3JpdHkpIHtcclxuICAgICAgICByZXR1cm4gUFJJT1JJVFlfSElHSEVTVDtcclxuICAgIH1cclxuXHJcbiAgICB2YXIgcHJpb3JpdHkgPSB0aGlzLl9nZXRQcmlvcml0eUludGVybmFsKGltYWdlUGFydFBhcmFtcyk7XHJcbiAgICB2YXIgaXNJbkZydXN0dW0gPSBwcmlvcml0eSA+PSBQUklPUklUWV9NSU5PUklUWV9JTl9GUlVTVFVNO1xyXG4gICAgXHJcbiAgICBpZiAodGhpcy5faXNBYm9ydFJlcXVlc3RzTm90SW5GcnVzdHVtICYmICFpc0luRnJ1c3R1bSkge1xyXG4gICAgICAgIHJldHVybiBQUklPUklUWV9BQk9SVF9OT1RfSU5fRlJVU1RVTTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgdmFyIHByaW9yaXRpemVMb3dQcm9ncmVzc2l2ZVN0YWdlID0gMDtcclxuICAgIFxyXG4gICAgaWYgKHRoaXMuX2lzUHJpb3JpdGl6ZUxvd1Byb2dyZXNzaXZlU3RhZ2UgJiYgaXNJbkZydXN0dW0pIHtcclxuICAgICAgICBwcmlvcml0aXplTG93UHJvZ3Jlc3NpdmVTdGFnZSA9XHJcbiAgICAgICAgICAgIGpvYkNvbnRleHQucHJvZ3Jlc3NpdmVTdGFnZXNEb25lID09PSAwID8gQUREX1BSSU9SSVRZX1RPX0xPV19RVUFMSVRZIDpcclxuICAgICAgICAgICAgam9iQ29udGV4dC5wcm9ncmVzc2l2ZVN0YWdlc0RvbmUgPT09IDEgPyAxIDpcclxuICAgICAgICAgICAgMDtcclxuICAgIH1cclxuICAgIFxyXG4gICAgcmV0dXJuIHByaW9yaXR5ICsgcHJpb3JpdGl6ZUxvd1Byb2dyZXNzaXZlU3RhZ2U7XHJcbn07XHJcblxyXG5GcnVzdHVtUmVxdWVzdHNQcmlvcml0aXplci5wcm90b3R5cGUuX2dldFByaW9yaXR5SW50ZXJuYWwgPSBmdW5jdGlvbiBnZXRQcmlvcml0eUludGVybmFsKGltYWdlUGFydFBhcmFtcykge1xyXG4gICAgaWYgKHRoaXMuX2ZydXN0dW1EYXRhID09PSBudWxsKSB7XHJcbiAgICAgICAgcmV0dXJuIFBSSU9SSVRZX0NBTENVTEFUSU9OX0ZBSUxFRDtcclxuICAgIH1cclxuICAgIFxyXG4gICAgaWYgKHRoaXMuX2ZydXN0dW1EYXRhLmltYWdlUmVjdGFuZ2xlID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBObyBpbWFnZVJlY3RhbmdsZSBpbmZvcm1hdGlvbiBwYXNzZWQgaW4gc2V0UHJpb3JpdGl6ZXJEYXRhJztcclxuICAgIH1cclxuICAgIFxyXG4gICAgdmFyIGV4YWN0RnJ1c3R1bUxldmVsID0gdGhpcy5fZnJ1c3R1bURhdGEuZXhhY3RsZXZlbDtcclxuICAgIFxyXG4gICAgaWYgKHRoaXMuX2ZydXN0dW1EYXRhLmV4YWN0bGV2ZWwgPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IE5vIGV4YWN0bGV2ZWwgaW5mb3JtYXRpb24gcGFzc2VkIGluICcgK1xyXG4gICAgICAgICAgICAnc2V0UHJpb3JpdGl6ZXJEYXRhLiBVc2UgbnVsbCBpZiB1bmtub3duJztcclxuICAgIH1cclxuICAgIFxyXG4gICAgdmFyIHRpbGVXZXN0ID0gdGhpcy5fcGl4ZWxUb0NhcnRvZ3JhcGhpY1goXHJcbiAgICAgICAgaW1hZ2VQYXJ0UGFyYW1zLm1pblgsIGltYWdlUGFydFBhcmFtcyk7XHJcbiAgICB2YXIgdGlsZUVhc3QgPSB0aGlzLl9waXhlbFRvQ2FydG9ncmFwaGljWChcclxuICAgICAgICBpbWFnZVBhcnRQYXJhbXMubWF4WEV4Y2x1c2l2ZSwgaW1hZ2VQYXJ0UGFyYW1zKTtcclxuICAgIHZhciB0aWxlTm9ydGggPSB0aGlzLl9waXhlbFRvQ2FydG9ncmFwaGljWShcclxuICAgICAgICBpbWFnZVBhcnRQYXJhbXMubWluWSwgaW1hZ2VQYXJ0UGFyYW1zKTtcclxuICAgIHZhciB0aWxlU291dGggPSB0aGlzLl9waXhlbFRvQ2FydG9ncmFwaGljWShcclxuICAgICAgICBpbWFnZVBhcnRQYXJhbXMubWF4WUV4Y2x1c2l2ZSwgaW1hZ2VQYXJ0UGFyYW1zKTtcclxuICAgIFxyXG4gICAgdmFyIHRpbGVQaXhlbHNXaWR0aCA9XHJcbiAgICAgICAgaW1hZ2VQYXJ0UGFyYW1zLm1heFhFeGNsdXNpdmUgLSBpbWFnZVBhcnRQYXJhbXMubWluWDtcclxuICAgIHZhciB0aWxlUGl4ZWxzSGVpZ2h0ID1cclxuICAgICAgICBpbWFnZVBhcnRQYXJhbXMubWF4WUV4Y2x1c2l2ZSAtIGltYWdlUGFydFBhcmFtcy5taW5ZO1xyXG4gICAgXHJcbiAgICB2YXIgcmVxdWVzdFRvRnJ1c3R1bVJlc29sdXRpb25SYXRpbztcclxuICAgIHZhciB0aWxlTGV2ZWwgPSBpbWFnZVBhcnRQYXJhbXMubGV2ZWwgfHwgMDtcclxuICAgIGlmIChleGFjdEZydXN0dW1MZXZlbCA9PT0gbnVsbCkge1xyXG4gICAgICAgIHZhciB0aWxlUmVzb2x1dGlvblggPSB0aWxlUGl4ZWxzV2lkdGggLyAodGlsZUVhc3QgLSB0aWxlV2VzdCk7XHJcbiAgICAgICAgdmFyIHRpbGVSZXNvbHV0aW9uWSA9IHRpbGVQaXhlbHNIZWlnaHQgLyAodGlsZU5vcnRoIC0gdGlsZVNvdXRoKTtcclxuICAgICAgICB2YXIgdGlsZVJlc29sdXRpb24gPSBNYXRoLm1heCh0aWxlUmVzb2x1dGlvblgsIHRpbGVSZXNvbHV0aW9uWSk7XHJcbiAgICAgICAgdmFyIGZydXN0dW1SZXNvbHV0aW9uID0gdGhpcy5fZnJ1c3R1bURhdGEucmVzb2x1dGlvbjtcclxuICAgICAgICByZXF1ZXN0VG9GcnVzdHVtUmVzb2x1dGlvblJhdGlvID0gdGlsZVJlc29sdXRpb24gLyBmcnVzdHVtUmVzb2x1dGlvbjtcclxuICAgIFxyXG4gICAgICAgIGlmIChyZXF1ZXN0VG9GcnVzdHVtUmVzb2x1dGlvblJhdGlvID4gMikge1xyXG4gICAgICAgICAgICByZXR1cm4gUFJJT1JJVFlfVE9PX0dPT0RfUkVTT0xVVElPTjtcclxuICAgICAgICB9XHJcbiAgICB9IGVsc2UgaWYgKHRpbGVMZXZlbCA8IGV4YWN0RnJ1c3R1bUxldmVsKSB7XHJcbiAgICAgICAgcmV0dXJuIFBSSU9SSVRZX1RPT19HT09EX1JFU09MVVRJT047XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHZhciBmcnVzdHVtUmVjdGFuZ2xlID0gdGhpcy5fZnJ1c3R1bURhdGEucmVjdGFuZ2xlO1xyXG4gICAgdmFyIGludGVyc2VjdGlvbldlc3QgPSBNYXRoLm1heChmcnVzdHVtUmVjdGFuZ2xlLndlc3QsIHRpbGVXZXN0KTtcclxuICAgIHZhciBpbnRlcnNlY3Rpb25FYXN0ID0gTWF0aC5taW4oZnJ1c3R1bVJlY3RhbmdsZS5lYXN0LCB0aWxlRWFzdCk7XHJcbiAgICB2YXIgaW50ZXJzZWN0aW9uU291dGggPSBNYXRoLm1heChmcnVzdHVtUmVjdGFuZ2xlLnNvdXRoLCB0aWxlU291dGgpO1xyXG4gICAgdmFyIGludGVyc2VjdGlvbk5vcnRoID0gTWF0aC5taW4oZnJ1c3R1bVJlY3RhbmdsZS5ub3J0aCwgdGlsZU5vcnRoKTtcclxuICAgIFxyXG4gICAgdmFyIGludGVyc2VjdGlvbldpZHRoID0gaW50ZXJzZWN0aW9uRWFzdCAtIGludGVyc2VjdGlvbldlc3Q7XHJcbiAgICB2YXIgaW50ZXJzZWN0aW9uSGVpZ2h0ID0gaW50ZXJzZWN0aW9uTm9ydGggLSBpbnRlcnNlY3Rpb25Tb3V0aDtcclxuICAgIFxyXG4gICAgaWYgKGludGVyc2VjdGlvbldpZHRoIDwgMCB8fCBpbnRlcnNlY3Rpb25IZWlnaHQgPCAwKSB7XHJcbiAgICAgICAgcmV0dXJuIFBSSU9SSVRZX05PVF9JTl9GUlVTVFVNO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBpZiAoZXhhY3RGcnVzdHVtTGV2ZWwgIT09IG51bGwpIHtcclxuICAgICAgICBpZiAodGlsZUxldmVsID4gZXhhY3RGcnVzdHVtTGV2ZWwpIHtcclxuICAgICAgICAgICAgcmV0dXJuIFBSSU9SSVRZX0xPV0VSX1JFU09MVVRJT047XHJcbiAgICAgICAgfVxyXG4gICAgfSBlbHNlIGlmICh0aWxlTGV2ZWwgPiAwICYmIHJlcXVlc3RUb0ZydXN0dW1SZXNvbHV0aW9uUmF0aW8gPCAwLjI1KSB7XHJcbiAgICAgICAgcmV0dXJuIFBSSU9SSVRZX0xPV0VSX1JFU09MVVRJT047XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHZhciBpbnRlcnNlY3Rpb25BcmVhID0gaW50ZXJzZWN0aW9uV2lkdGggKiBpbnRlcnNlY3Rpb25IZWlnaHQ7XHJcbiAgICB2YXIgdGlsZUFyZWEgPSAodGlsZUVhc3QgLSB0aWxlV2VzdCkgKiAodGlsZU5vcnRoIC0gdGlsZVNvdXRoKTtcclxuICAgIHZhciBwYXJ0SW5GcnVzdHVtID0gaW50ZXJzZWN0aW9uQXJlYSAvIHRpbGVBcmVhO1xyXG4gICAgXHJcbiAgICBpZiAocGFydEluRnJ1c3R1bSA+IDAuOTkpIHtcclxuICAgICAgICByZXR1cm4gUFJJT1JJVFlfRlVMTFlfSU5fRlJVU1RVTTtcclxuICAgIH0gZWxzZSBpZiAocGFydEluRnJ1c3R1bSA+IDAuNykge1xyXG4gICAgICAgIHJldHVybiBQUklPUklUWV9NQUpPUklUWV9JTl9GUlVTVFVNO1xyXG4gICAgfSBlbHNlIGlmIChwYXJ0SW5GcnVzdHVtID4gMC4zKSB7XHJcbiAgICAgICAgcmV0dXJuIFBSSU9SSVRZX1BBUlRJQUxfSU5fRlJVU1RVTTtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgICAgcmV0dXJuIFBSSU9SSVRZX01JTk9SSVRZX0lOX0ZSVVNUVU07XHJcbiAgICB9XHJcbn07XHJcblxyXG5GcnVzdHVtUmVxdWVzdHNQcmlvcml0aXplci5wcm90b3R5cGUuX3BpeGVsVG9DYXJ0b2dyYXBoaWNYID0gZnVuY3Rpb24gcGl4ZWxUb0NhcnRvZ3JhcGhpY1goXHJcbiAgICB4LCBpbWFnZVBhcnRQYXJhbXMpIHtcclxuICAgIFxyXG4gICAgdmFyIHJlbGF0aXZlWCA9IHggLyBpbWFnZVBhcnRQYXJhbXMubGV2ZWxXaWR0aDtcclxuICAgIFxyXG4gICAgdmFyIGltYWdlUmVjdGFuZ2xlID0gdGhpcy5fZnJ1c3R1bURhdGEuaW1hZ2VSZWN0YW5nbGU7XHJcbiAgICB2YXIgcmVjdGFuZ2xlV2lkdGggPSBpbWFnZVJlY3RhbmdsZS5lYXN0IC0gaW1hZ2VSZWN0YW5nbGUud2VzdDtcclxuICAgIFxyXG4gICAgdmFyIHhQcm9qZWN0ZWQgPSBpbWFnZVJlY3RhbmdsZS53ZXN0ICsgcmVsYXRpdmVYICogcmVjdGFuZ2xlV2lkdGg7XHJcbiAgICByZXR1cm4geFByb2plY3RlZDtcclxufTtcclxuXHJcbkZydXN0dW1SZXF1ZXN0c1ByaW9yaXRpemVyLnByb3RvdHlwZS5fcGl4ZWxUb0NhcnRvZ3JhcGhpY1kgPSBmdW5jdGlvbiB0aWxlVG9DYXJ0b2dyYXBoaWNZKFxyXG4gICAgeSwgaW1hZ2VQYXJ0UGFyYW1zLCBpbWFnZSkge1xyXG4gICAgXHJcbiAgICB2YXIgcmVsYXRpdmVZID0geSAvIGltYWdlUGFydFBhcmFtcy5sZXZlbEhlaWdodDtcclxuICAgIFxyXG4gICAgdmFyIGltYWdlUmVjdGFuZ2xlID0gdGhpcy5fZnJ1c3R1bURhdGEuaW1hZ2VSZWN0YW5nbGU7XHJcbiAgICB2YXIgcmVjdGFuZ2xlSGVpZ2h0ID0gaW1hZ2VSZWN0YW5nbGUubm9ydGggLSBpbWFnZVJlY3RhbmdsZS5zb3V0aDtcclxuICAgIFxyXG4gICAgdmFyIHlQcm9qZWN0ZWQgPSBpbWFnZVJlY3RhbmdsZS5ub3J0aCAtIHJlbGF0aXZlWSAqIHJlY3RhbmdsZUhlaWdodDtcclxuICAgIHJldHVybiB5UHJvamVjdGVkO1xyXG59OyIsIid1c2Ugc3RyaWN0JztcclxuXHJcbnZhciBGcnVzdHVtUmVxdWVzdHNQcmlvcml0aXplciA9IHJlcXVpcmUoJ2ZydXN0dW0tcmVxdWVzdHMtcHJpb3JpdGl6ZXIuanMnKTtcclxuXHJcbm1vZHVsZS5leHBvcnRzID0ge1xyXG4gICAgY2FsY3VsYXRlRnJ1c3R1bTJERnJvbUJvdW5kczogY2FsY3VsYXRlRnJ1c3R1bTJERnJvbUJvdW5kcyxcclxuICAgIGNyZWF0ZVNjaGVkdWxlcjogY3JlYXRlU2NoZWR1bGVyLFxyXG4gICAgZml4Qm91bmRzOiBmaXhCb3VuZHMsXHJcbiAgICBhbGlnblBhcmFtc1RvVGlsZXNBbmRMZXZlbDogYWxpZ25QYXJhbXNUb1RpbGVzQW5kTGV2ZWwsXHJcbn07XHJcblxyXG4vLyBBdm9pZCBqc2hpbnQgZXJyb3JcclxuLyogZ2xvYmFsIHNlbGY6IGZhbHNlICovXHJcbi8qIGdsb2JhbCBnbG9iYWxzOiBmYWxzZSAqL1xyXG4gICAgXHJcbi8vdmFyIGxvZzIgPSBNYXRoLmxvZygyKTtcclxuXHJcbmZ1bmN0aW9uIGNhbGN1bGF0ZUZydXN0dW0yREZyb21Cb3VuZHMoXHJcbiAgICBib3VuZHMsIHNjcmVlblNpemUpIHtcclxuICAgIFxyXG4gICAgdmFyIHNjcmVlblBpeGVscyA9XHJcbiAgICAgICAgc2NyZWVuU2l6ZS54ICogc2NyZWVuU2l6ZS54ICsgc2NyZWVuU2l6ZS55ICogc2NyZWVuU2l6ZS55O1xyXG4gICAgXHJcbiAgICB2YXIgYm91bmRzV2lkdGggPSBib3VuZHMuZWFzdCAtIGJvdW5kcy53ZXN0O1xyXG4gICAgdmFyIGJvdW5kc0hlaWdodCA9IGJvdW5kcy5ub3J0aCAtIGJvdW5kcy5zb3V0aDtcclxuICAgIHZhciBib3VuZHNEaXN0YW5jZSA9XHJcbiAgICAgICAgYm91bmRzV2lkdGggKiBib3VuZHNXaWR0aCArIGJvdW5kc0hlaWdodCAqIGJvdW5kc0hlaWdodDtcclxuICAgIFxyXG4gICAgdmFyIHJlc29sdXRpb24gPSBNYXRoLnNxcnQoc2NyZWVuUGl4ZWxzIC8gYm91bmRzRGlzdGFuY2UpO1xyXG4gICAgXHJcbiAgICB2YXIgZnJ1c3R1bURhdGEgPSB7XHJcbiAgICAgICAgcmVzb2x1dGlvbjogcmVzb2x1dGlvbixcclxuICAgICAgICByZWN0YW5nbGU6IGJvdW5kcyxcclxuICAgICAgICBcclxuICAgICAgICAvLyBSZWR1bmRhbnQsIGJ1dCBlbmFibGVzIHRvIGF2b2lkIGFscmVhZHktcGVyZm9ybWVkIGNhbGN1bGF0aW9uXHJcbiAgICAgICAgc2NyZWVuU2l6ZTogc2NyZWVuU2l6ZVxyXG4gICAgfTtcclxuICAgIFxyXG4gICAgcmV0dXJuIGZydXN0dW1EYXRhO1xyXG59XHJcbiAgICBcclxuZnVuY3Rpb24gY3JlYXRlU2NoZWR1bGVyKFxyXG4gICAgc2hvd0xvZywgcHJpb3JpdGl6ZXJUeXBlLCBzY2hlZHVsZXJOYW1lLCBjcmVhdGVSZXNvdXJjZSwgcmVzb3VyY2VMaW1pdCkge1xyXG4gICAgXHJcbiAgICB2YXIgcHJpb3JpdGl6ZXI7XHJcbiAgICB2YXIgc2NoZWR1bGVyO1xyXG4gICAgXHJcbiAgICBpZiAocHJpb3JpdGl6ZXJUeXBlID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICBwcmlvcml0aXplciA9IG51bGw7XHJcbiAgICAgICAgXHJcbiAgICAgICAgc2NoZWR1bGVyID0gbmV3IHJlc291cmNlU2NoZWR1bGVyLkxpZm9TY2hlZHVsZXIoXHJcbiAgICAgICAgICAgIGNyZWF0ZVJlc291cmNlLFxyXG4gICAgICAgICAgICByZXNvdXJjZUxpbWl0KTtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgICAgdmFyIGxpbWl0UmVzb3VyY2VCeUxvd1F1YWxpdHlQcmlvcml0eSA9IGZhbHNlO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGlmIChwcmlvcml0aXplclR5cGUgPT09ICdmcnVzdHVtJykge1xyXG4gICAgICAgICAgICBsaW1pdFJlc291cmNlQnlMb3dRdWFsaXR5UHJpb3JpdHkgPSB0cnVlO1xyXG4gICAgICAgICAgICBwcmlvcml0aXplciA9IG5ldyBGcnVzdHVtUmVxdWVzdHNQcmlvcml0aXplcigpO1xyXG4gICAgICAgIH0gZWxzZSBpZiAocHJpb3JpdGl6ZXJUeXBlID09PSAnZnJ1c3R1bU9ubHknKSB7XHJcbiAgICAgICAgICAgIGxpbWl0UmVzb3VyY2VCeUxvd1F1YWxpdHlQcmlvcml0eSA9IHRydWU7XHJcbiAgICAgICAgICAgIHByaW9yaXRpemVyID0gbmV3IEZydXN0dW1SZXF1ZXN0c1ByaW9yaXRpemVyKFxyXG4gICAgICAgICAgICAgICAgLyppc0Fib3J0UmVxdWVzdHNOb3RJbkZydXN0dW09Ki90cnVlLFxyXG4gICAgICAgICAgICAgICAgLyppc1ByaW9yaXRpemVMb3dRdWFsaXR5U3RhZ2U9Ki90cnVlKTtcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICBwcmlvcml0aXplciA9IHByaW9yaXRpemVyVHlwZTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgdmFyIG9wdGlvbnMgPSB7XHJcbiAgICAgICAgICAgIHNjaGVkdWxlck5hbWU6IHNjaGVkdWxlck5hbWUsXHJcbiAgICAgICAgICAgIHNob3dMb2c6IHNob3dMb2dcclxuICAgICAgICB9O1xyXG4gICAgICAgIFxyXG4gICAgICAgIGlmIChsaW1pdFJlc291cmNlQnlMb3dRdWFsaXR5UHJpb3JpdHkpIHtcclxuICAgICAgICAgICAgb3B0aW9ucy5yZXNvdXJjZUd1YXJhbnRlZWRGb3JIaWdoUHJpb3JpdHkgPSByZXNvdXJjZUxpbWl0IC0gMjtcclxuICAgICAgICAgICAgb3B0aW9ucy5oaWdoUHJpb3JpdHlUb0d1YXJhbnRlZVJlc291cmNlID1cclxuICAgICAgICAgICAgICAgIHByaW9yaXRpemVyLm1pbmltYWxMb3dRdWFsaXR5UHJpb3JpdHk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHNjaGVkdWxlciA9IG5ldyByZXNvdXJjZVNjaGVkdWxlci5Qcmlvcml0eVNjaGVkdWxlcihcclxuICAgICAgICAgICAgY3JlYXRlUmVzb3VyY2UsXHJcbiAgICAgICAgICAgIHJlc291cmNlTGltaXQsXHJcbiAgICAgICAgICAgIHByaW9yaXRpemVyLFxyXG4gICAgICAgICAgICBvcHRpb25zKTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgcmV0dXJuIHtcclxuICAgICAgICBwcmlvcml0aXplcjogcHJpb3JpdGl6ZXIsXHJcbiAgICAgICAgc2NoZWR1bGVyOiBzY2hlZHVsZXJcclxuICAgIH07XHJcbn1cclxuICAgIFxyXG5mdW5jdGlvbiBmaXhCb3VuZHMoYm91bmRzLCBpbWFnZSwgYWRhcHRQcm9wb3J0aW9ucykge1xyXG4gICAgaWYgKCFhZGFwdFByb3BvcnRpb25zKSB7XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG5cclxuICAgIHZhciByZWN0YW5nbGVXaWR0aCA9IGJvdW5kcy5lYXN0IC0gYm91bmRzLndlc3Q7XHJcbiAgICB2YXIgcmVjdGFuZ2xlSGVpZ2h0ID0gYm91bmRzLm5vcnRoIC0gYm91bmRzLnNvdXRoO1xyXG5cclxuICAgIHZhciBwaXhlbHNBc3BlY3RSYXRpbyA9IGltYWdlLmdldEltYWdlV2lkdGgoKSAvIGltYWdlLmdldEltYWdlSGVpZ2h0KCk7XHJcbiAgICB2YXIgcmVjdGFuZ2xlQXNwZWN0UmF0aW8gPSByZWN0YW5nbGVXaWR0aCAvIHJlY3RhbmdsZUhlaWdodDtcclxuICAgIFxyXG4gICAgaWYgKHBpeGVsc0FzcGVjdFJhdGlvIDwgcmVjdGFuZ2xlQXNwZWN0UmF0aW8pIHtcclxuICAgICAgICB2YXIgb2xkV2lkdGggPSByZWN0YW5nbGVXaWR0aDtcclxuICAgICAgICByZWN0YW5nbGVXaWR0aCA9IHJlY3RhbmdsZUhlaWdodCAqIHBpeGVsc0FzcGVjdFJhdGlvO1xyXG4gICAgICAgIHZhciBzdWJzdHJhY3RGcm9tV2lkdGggPSBvbGRXaWR0aCAtIHJlY3RhbmdsZVdpZHRoO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGJvdW5kcy5lYXN0IC09IHN1YnN0cmFjdEZyb21XaWR0aCAvIDI7XHJcbiAgICAgICAgYm91bmRzLndlc3QgKz0gc3Vic3RyYWN0RnJvbVdpZHRoIC8gMjtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgICAgdmFyIG9sZEhlaWdodCA9IHJlY3RhbmdsZUhlaWdodDtcclxuICAgICAgICByZWN0YW5nbGVIZWlnaHQgPSByZWN0YW5nbGVXaWR0aCAvIHBpeGVsc0FzcGVjdFJhdGlvO1xyXG4gICAgICAgIHZhciBzdWJzdHJhY3RGcm9tSGVpZ2h0ID0gb2xkSGVpZ2h0IC0gcmVjdGFuZ2xlSGVpZ2h0O1xyXG4gICAgICAgIFxyXG4gICAgICAgIGJvdW5kcy5ub3J0aCAtPSBzdWJzdHJhY3RGcm9tSGVpZ2h0IC8gMjtcclxuICAgICAgICBib3VuZHMuc291dGggKz0gc3Vic3RyYWN0RnJvbUhlaWdodCAvIDI7XHJcbiAgICB9XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGFsaWduUGFyYW1zVG9UaWxlc0FuZExldmVsKFxyXG4gICAgcmVnaW9uLCBpbWFnZSkge1xyXG4gICAgXHJcbiAgICB2YXIgdGlsZVdpZHRoID0gaW1hZ2UuZ2V0VGlsZVdpZHRoKCk7XHJcbiAgICB2YXIgdGlsZUhlaWdodCA9IGltYWdlLmdldFRpbGVIZWlnaHQoKTtcclxuICAgIFxyXG4gICAgdmFyIHJlZ2lvbk1pblggPSByZWdpb24ubWluWDtcclxuICAgIHZhciByZWdpb25NaW5ZID0gcmVnaW9uLm1pblk7XHJcbiAgICB2YXIgcmVnaW9uTWF4WCA9IHJlZ2lvbi5tYXhYRXhjbHVzaXZlO1xyXG4gICAgdmFyIHJlZ2lvbk1heFkgPSByZWdpb24ubWF4WUV4Y2x1c2l2ZTtcclxuICAgIHZhciBzY3JlZW5XaWR0aCA9IHJlZ2lvbi5zY3JlZW5XaWR0aDtcclxuICAgIHZhciBzY3JlZW5IZWlnaHQgPSByZWdpb24uc2NyZWVuSGVpZ2h0O1xyXG4gICAgXHJcbiAgICB2YXIgaXNWYWxpZE9yZGVyID0gcmVnaW9uTWluWCA8IHJlZ2lvbk1heFggJiYgcmVnaW9uTWluWSA8IHJlZ2lvbk1heFk7XHJcbiAgICBpZiAoIWlzVmFsaWRPcmRlcikge1xyXG4gICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IFBhcmFtZXRlcnMgb3JkZXIgaXMgaW52YWxpZCc7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHZhciBkZWZhdWx0TGV2ZWxXaWR0aCA9IGltYWdlLmdldEltYWdlV2lkdGgoKTtcclxuICAgIHZhciBkZWZhdWx0TGV2ZWxIZWlnaHQgPSBpbWFnZS5nZXRJbWFnZUhlaWdodCgpO1xyXG4gICAgaWYgKHJlZ2lvbk1heFggPCAwIHx8IHJlZ2lvbk1pblggPj0gZGVmYXVsdExldmVsV2lkdGggfHxcclxuICAgICAgICByZWdpb25NYXhZIDwgMCB8fCByZWdpb25NaW5ZID49IGRlZmF1bHRMZXZlbEhlaWdodCkge1xyXG4gICAgICAgIFxyXG4gICAgICAgIHJldHVybiBudWxsO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICAvL3ZhciBtYXhMZXZlbCA9XHJcbiAgICAvLyAgICBpbWFnZS5nZXREZWZhdWx0TnVtUmVzb2x1dGlvbkxldmVscygpIC0gMTtcclxuXHJcbiAgICAvL3ZhciBsZXZlbFggPSBNYXRoLmxvZygocmVnaW9uTWF4WCAtIHJlZ2lvbk1pblgpIC8gc2NyZWVuV2lkdGggKSAvIGxvZzI7XHJcbiAgICAvL3ZhciBsZXZlbFkgPSBNYXRoLmxvZygocmVnaW9uTWF4WSAtIHJlZ2lvbk1pblkpIC8gc2NyZWVuSGVpZ2h0KSAvIGxvZzI7XHJcbiAgICAvL3ZhciBsZXZlbCA9IE1hdGguY2VpbChNYXRoLm1pbihsZXZlbFgsIGxldmVsWSkpO1xyXG4gICAgLy9sZXZlbCA9IE1hdGgubWF4KDAsIE1hdGgubWluKG1heExldmVsLCBsZXZlbCkpO1xyXG4gICAgdmFyIGxldmVsID0gaW1hZ2UuZ2V0TGV2ZWwocmVnaW9uKTtcclxuICAgIHZhciBsZXZlbFdpZHRoID0gaW1hZ2UuZ2V0TGV2ZWxXaWR0aChsZXZlbCk7XHJcbiAgICB2YXIgbGV2ZWxIZWlnaHQgPSBpbWFnZS5nZXRMZXZlbEhlaWdodChsZXZlbCk7XHJcbiAgICBcclxuICAgIHZhciBzY2FsZVggPSBkZWZhdWx0TGV2ZWxXaWR0aCAvIGxldmVsV2lkdGg7XHJcbiAgICB2YXIgc2NhbGVZID0gZGVmYXVsdExldmVsSGVpZ2h0IC8gbGV2ZWxIZWlnaHQ7XHJcbiAgICBcclxuICAgIHZhciBtaW5UaWxlWCA9IE1hdGguZmxvb3IocmVnaW9uTWluWCAvIChzY2FsZVggKiB0aWxlV2lkdGggKSk7XHJcbiAgICB2YXIgbWluVGlsZVkgPSBNYXRoLmZsb29yKHJlZ2lvbk1pblkgLyAoc2NhbGVZICogdGlsZUhlaWdodCkpO1xyXG4gICAgdmFyIG1heFRpbGVYID0gTWF0aC5jZWlsIChyZWdpb25NYXhYIC8gKHNjYWxlWCAqIHRpbGVXaWR0aCApKTtcclxuICAgIHZhciBtYXhUaWxlWSA9IE1hdGguY2VpbCAocmVnaW9uTWF4WSAvIChzY2FsZVkgKiB0aWxlSGVpZ2h0KSk7XHJcbiAgICBcclxuICAgIHZhciBtaW5YID0gbWluVGlsZVggKiB0aWxlV2lkdGg7XHJcbiAgICB2YXIgbWluWSA9IG1pblRpbGVZICogdGlsZUhlaWdodDtcclxuICAgIHZhciBtYXhYID0gbWF4VGlsZVggKiB0aWxlV2lkdGg7XHJcbiAgICB2YXIgbWF4WSA9IG1heFRpbGVZICogdGlsZUhlaWdodDtcclxuICAgIFxyXG4gICAgdmFyIGNyb3BwZWRNaW5YID0gTWF0aC5tYXgoMCwgTWF0aC5taW4obGV2ZWxXaWR0aCAsIG1pblgpKTtcclxuICAgIHZhciBjcm9wcGVkTWluWSA9IE1hdGgubWF4KDAsIE1hdGgubWluKGxldmVsSGVpZ2h0LCBtaW5ZKSk7XHJcbiAgICB2YXIgY3JvcHBlZE1heFggPSBNYXRoLm1heCgwLCBNYXRoLm1pbihsZXZlbFdpZHRoICwgbWF4WCkpO1xyXG4gICAgdmFyIGNyb3BwZWRNYXhZID0gTWF0aC5tYXgoMCwgTWF0aC5taW4obGV2ZWxIZWlnaHQsIG1heFkpKTtcclxuICAgIFxyXG4gICAgdmFyIGltYWdlUGFyYW1zVG9TY3JlZW5TY2FsZVggPSBzY3JlZW5XaWR0aCAgLyAobWF4WCAtIG1pblgpO1xyXG4gICAgdmFyIGltYWdlUGFyYW1zVG9TY3JlZW5TY2FsZVkgPSBzY3JlZW5IZWlnaHQgLyAobWF4WSAtIG1pblkpO1xyXG4gICAgXHJcbiAgICB2YXIgaW1hZ2VQYXJ0UGFyYW1zID0ge1xyXG4gICAgICAgIG1pblg6IGNyb3BwZWRNaW5YLFxyXG4gICAgICAgIG1pblk6IGNyb3BwZWRNaW5ZLFxyXG4gICAgICAgIG1heFhFeGNsdXNpdmU6IGNyb3BwZWRNYXhYLFxyXG4gICAgICAgIG1heFlFeGNsdXNpdmU6IGNyb3BwZWRNYXhZLFxyXG4gICAgICAgIGxldmVsV2lkdGg6IGxldmVsV2lkdGgsXHJcbiAgICAgICAgbGV2ZWxIZWlnaHQ6IGxldmVsSGVpZ2h0LFxyXG4gICAgICAgIGxldmVsOiBsZXZlbFxyXG4gICAgfTtcclxuICAgIFxyXG4gICAgdmFyIHBvc2l0aW9uSW5JbWFnZSA9IHtcclxuICAgICAgICBtaW5YOiBjcm9wcGVkTWluWCAqIHNjYWxlWCxcclxuICAgICAgICBtaW5ZOiBjcm9wcGVkTWluWSAqIHNjYWxlWSxcclxuICAgICAgICBtYXhYRXhjbHVzaXZlOiBjcm9wcGVkTWF4WCAqIHNjYWxlWCxcclxuICAgICAgICBtYXhZRXhjbHVzaXZlOiBjcm9wcGVkTWF4WSAqIHNjYWxlWVxyXG4gICAgfTtcclxuICAgIFxyXG4gICAgdmFyIGNyb3BwZWRTY3JlZW4gPSB7XHJcbiAgICAgICAgbWluWCA6IE1hdGguZmxvb3IoKGNyb3BwZWRNaW5YIC0gbWluWCkgKiBpbWFnZVBhcmFtc1RvU2NyZWVuU2NhbGVYKSxcclxuICAgICAgICBtaW5ZIDogTWF0aC5mbG9vcigoY3JvcHBlZE1pblkgLSBtaW5ZKSAqIGltYWdlUGFyYW1zVG9TY3JlZW5TY2FsZVkpLFxyXG4gICAgICAgIG1heFhFeGNsdXNpdmUgOiBNYXRoLmNlaWwoKGNyb3BwZWRNYXhYIC0gbWluWCkgKiBpbWFnZVBhcmFtc1RvU2NyZWVuU2NhbGVYKSxcclxuICAgICAgICBtYXhZRXhjbHVzaXZlIDogTWF0aC5jZWlsKChjcm9wcGVkTWF4WSAtIG1pblkpICogaW1hZ2VQYXJhbXNUb1NjcmVlblNjYWxlWSlcclxuICAgIH07XHJcbiAgICBcclxuICAgIHJldHVybiB7XHJcbiAgICAgICAgaW1hZ2VQYXJ0UGFyYW1zOiBpbWFnZVBhcnRQYXJhbXMsXHJcbiAgICAgICAgcG9zaXRpb25JbkltYWdlOiBwb3NpdGlvbkluSW1hZ2UsXHJcbiAgICAgICAgY3JvcHBlZFNjcmVlbjogY3JvcHBlZFNjcmVlblxyXG4gICAgfTtcclxufVxyXG5cclxuZnVuY3Rpb24gZ2V0Q2xhc3NJbkdsb2JhbE9iamVjdChnbG9iYWxPYmplY3QsIGNsYXNzTmFtZSkge1xyXG4gICAgaWYgKGdsb2JhbE9iamVjdFtjbGFzc05hbWVdKSB7XHJcbiAgICAgICAgcmV0dXJuIGdsb2JhbE9iamVjdFtjbGFzc05hbWVdO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICB2YXIgcmVzdWx0ID0gZ2xvYmFsT2JqZWN0O1xyXG4gICAgdmFyIHBhdGggPSBjbGFzc05hbWUuc3BsaXQoJy4nKTtcclxuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgcGF0aC5sZW5ndGg7ICsraSkge1xyXG4gICAgICAgIHJlc3VsdCA9IHJlc3VsdFtwYXRoW2ldXTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgcmV0dXJuIHJlc3VsdDtcclxufSIsIid1c2Ugc3RyaWN0JztcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gTGlua2VkTGlzdDtcclxuXHJcbmZ1bmN0aW9uIExpbmtlZExpc3QoKSB7XHJcbiAgICB0aGlzLl9maXJzdCA9IHsgX3ByZXY6IG51bGwsIF9wYXJlbnQ6IHRoaXMgfTtcclxuICAgIHRoaXMuX2xhc3QgPSB7IF9uZXh0OiBudWxsLCBfcGFyZW50OiB0aGlzIH07XHJcbiAgICB0aGlzLl9jb3VudCA9IDA7XHJcbiAgICBcclxuICAgIHRoaXMuX2xhc3QuX3ByZXYgPSB0aGlzLl9maXJzdDtcclxuICAgIHRoaXMuX2ZpcnN0Ll9uZXh0ID0gdGhpcy5fbGFzdDtcclxufVxyXG5cclxuTGlua2VkTGlzdC5wcm90b3R5cGUuYWRkID0gZnVuY3Rpb24gYWRkKHZhbHVlLCBhZGRCZWZvcmUpIHtcclxuICAgIGlmIChhZGRCZWZvcmUgPT09IG51bGwgfHwgYWRkQmVmb3JlID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICBhZGRCZWZvcmUgPSB0aGlzLl9sYXN0O1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICB0aGlzLl92YWxpZGF0ZUl0ZXJhdG9yT2ZUaGlzKGFkZEJlZm9yZSk7XHJcbiAgICBcclxuICAgICsrdGhpcy5fY291bnQ7XHJcbiAgICBcclxuICAgIHZhciBuZXdOb2RlID0ge1xyXG4gICAgICAgIF92YWx1ZTogdmFsdWUsXHJcbiAgICAgICAgX25leHQ6IGFkZEJlZm9yZSxcclxuICAgICAgICBfcHJldjogYWRkQmVmb3JlLl9wcmV2LFxyXG4gICAgICAgIF9wYXJlbnQ6IHRoaXNcclxuICAgIH07XHJcbiAgICBcclxuICAgIG5ld05vZGUuX3ByZXYuX25leHQgPSBuZXdOb2RlO1xyXG4gICAgYWRkQmVmb3JlLl9wcmV2ID0gbmV3Tm9kZTtcclxuICAgIFxyXG4gICAgcmV0dXJuIG5ld05vZGU7XHJcbn07XHJcblxyXG5MaW5rZWRMaXN0LnByb3RvdHlwZS5yZW1vdmUgPSBmdW5jdGlvbiByZW1vdmUoaXRlcmF0b3IpIHtcclxuICAgIHRoaXMuX3ZhbGlkYXRlSXRlcmF0b3JPZlRoaXMoaXRlcmF0b3IpO1xyXG4gICAgXHJcbiAgICAtLXRoaXMuX2NvdW50O1xyXG4gICAgXHJcbiAgICBpdGVyYXRvci5fcHJldi5fbmV4dCA9IGl0ZXJhdG9yLl9uZXh0O1xyXG4gICAgaXRlcmF0b3IuX25leHQuX3ByZXYgPSBpdGVyYXRvci5fcHJldjtcclxuICAgIGl0ZXJhdG9yLl9wYXJlbnQgPSBudWxsO1xyXG59O1xyXG5cclxuTGlua2VkTGlzdC5wcm90b3R5cGUuZ2V0VmFsdWUgPSBmdW5jdGlvbiBnZXRWYWx1ZShpdGVyYXRvcikge1xyXG4gICAgdGhpcy5fdmFsaWRhdGVJdGVyYXRvck9mVGhpcyhpdGVyYXRvcik7XHJcbiAgICBcclxuICAgIHJldHVybiBpdGVyYXRvci5fdmFsdWU7XHJcbn07XHJcblxyXG5MaW5rZWRMaXN0LnByb3RvdHlwZS5nZXRGaXJzdEl0ZXJhdG9yID0gZnVuY3Rpb24gZ2V0Rmlyc3RJdGVyYXRvcigpIHtcclxuICAgIHZhciBpdGVyYXRvciA9IHRoaXMuZ2V0TmV4dEl0ZXJhdG9yKHRoaXMuX2ZpcnN0KTtcclxuICAgIHJldHVybiBpdGVyYXRvcjtcclxufTtcclxuXHJcbkxpbmtlZExpc3QucHJvdG90eXBlLmdldExhc3RJdGVyYXRvciA9IGZ1bmN0aW9uIGdldEZpcnN0SXRlcmF0b3IoKSB7XHJcbiAgICB2YXIgaXRlcmF0b3IgPSB0aGlzLmdldFByZXZJdGVyYXRvcih0aGlzLl9sYXN0KTtcclxuICAgIHJldHVybiBpdGVyYXRvcjtcclxufTtcclxuXHJcbkxpbmtlZExpc3QucHJvdG90eXBlLmdldE5leHRJdGVyYXRvciA9IGZ1bmN0aW9uIGdldE5leHRJdGVyYXRvcihpdGVyYXRvcikge1xyXG4gICAgdGhpcy5fdmFsaWRhdGVJdGVyYXRvck9mVGhpcyhpdGVyYXRvcik7XHJcblxyXG4gICAgaWYgKGl0ZXJhdG9yLl9uZXh0ID09PSB0aGlzLl9sYXN0KSB7XHJcbiAgICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHJldHVybiBpdGVyYXRvci5fbmV4dDtcclxufTtcclxuXHJcbkxpbmtlZExpc3QucHJvdG90eXBlLmdldFByZXZJdGVyYXRvciA9IGZ1bmN0aW9uIGdldFByZXZJdGVyYXRvcihpdGVyYXRvcikge1xyXG4gICAgdGhpcy5fdmFsaWRhdGVJdGVyYXRvck9mVGhpcyhpdGVyYXRvcik7XHJcblxyXG4gICAgaWYgKGl0ZXJhdG9yLl9wcmV2ID09PSB0aGlzLl9maXJzdCkge1xyXG4gICAgICAgIHJldHVybiBudWxsO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICByZXR1cm4gaXRlcmF0b3IuX3ByZXY7XHJcbn07XHJcblxyXG5MaW5rZWRMaXN0LnByb3RvdHlwZS5nZXRDb3VudCA9IGZ1bmN0aW9uIGdldENvdW50KCkge1xyXG4gICAgcmV0dXJuIHRoaXMuX2NvdW50O1xyXG59O1xyXG5cclxuTGlua2VkTGlzdC5wcm90b3R5cGUuX3ZhbGlkYXRlSXRlcmF0b3JPZlRoaXMgPVxyXG4gICAgZnVuY3Rpb24gdmFsaWRhdGVJdGVyYXRvck9mVGhpcyhpdGVyYXRvcikge1xyXG4gICAgXHJcbiAgICBpZiAoaXRlcmF0b3IuX3BhcmVudCAhPT0gdGhpcykge1xyXG4gICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IGl0ZXJhdG9yIG11c3QgYmUgb2YgdGhlIGN1cnJlbnQgTGlua2VkTGlzdCc7XHJcbiAgICB9XHJcbn07IiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBTaW1wbGVNb3ZhYmxlRmV0Y2g7XHJcbmZ1bmN0aW9uIFNpbXBsZU1vdmFibGVGZXRjaCgpe31cclxudmFyIExpbmtlZExpc3QgPSByZXF1aXJlKCdsaW5rZWQtbGlzdC5qcycpO1xyXG52YXIgRmV0Y2hDb250ZXh0QXBpID0gcmVxdWlyZSgnZmV0Y2gtY29udGV4dC1hcGkuanMnKTtcclxuXHJcbnZhciBGRVRDSF9TVEFURV9XQUlUX0ZPUl9NT1ZFID0gMTtcclxudmFyIEZFVENIX1NUQVRFX0FDVElWRSA9IDI7XHJcbnZhciBGRVRDSF9TVEFURV9TVE9QUElORyA9IDM7XHJcbnZhciBGRVRDSF9TVEFURV9TVE9QUEVEID0gNDtcclxudmFyIEZFVENIX1NUQVRFX1RFUk1JTkFURUQgPSA1O1xyXG5cclxuZnVuY3Rpb24gU2ltcGxlTW92YWJsZUZldGNoKGZldGNoZXIsIGZldGNoZXJDbG9zZXIsIGZldGNoQ29udGV4dCwgbWF4QWN0aXZlRmV0Y2hlc0luTW92YWJsZUZldGNoKSB7XHJcblx0dGhpcy5fZmV0Y2hlciA9IGZldGNoZXI7XHJcblx0dGhpcy5fZmV0Y2hlckNsb3NlciA9IGZldGNoZXJDbG9zZXI7XHJcblx0dGhpcy5fbW92YWJsZUZldGNoQ29udGV4dCA9IGZldGNoQ29udGV4dDtcclxuXHR0aGlzLl9tYXhBY3RpdmVGZXRjaGVzSW5Nb3ZhYmxlRmV0Y2ggPSBtYXhBY3RpdmVGZXRjaGVzSW5Nb3ZhYmxlRmV0Y2g7XHJcblx0XHJcblx0dGhpcy5fYWN0aXZlRmV0Y2hlc0luTW92YWJsZUZldGNoID0gbmV3IExpbmtlZExpc3QoKTtcclxuXHR0aGlzLl9wZW5kaW5nSW1hZ2VQYXJ0UGFyYW1zID0gbnVsbDtcclxuXHR0aGlzLl9tb3ZhYmxlU3RhdGUgPSBGRVRDSF9TVEFURV9XQUlUX0ZPUl9NT1ZFO1xyXG5cdFxyXG5cdHRoaXMuX2lzUHJvZ3Jlc3NpdmUgPSBmYWxzZTtcclxuXHR0aGlzLl9pc1Byb2dyZXNzaXZlQ2hhbmdlZENhbGxlZCA9IGZhbHNlO1xyXG5cdFxyXG5cdGZldGNoQ29udGV4dC5vbignbW92ZScsIHRoaXMuX29uTW92ZSwgdGhpcyk7XHJcblx0ZmV0Y2hDb250ZXh0Lm9uKCd0ZXJtaW5hdGUnLCB0aGlzLl9vblRlcm1pbmF0ZWQsIHRoaXMpO1xyXG5cdGZldGNoQ29udGV4dC5vbignaXNQcm9ncmVzc2l2ZUNoYW5nZWQnLCB0aGlzLl9vbklzUHJvZ3Jlc3NpdmVDaGFuZ2VkLCB0aGlzKTtcclxuXHRmZXRjaENvbnRleHQub24oJ3N0b3AnLCB0aGlzLl9vblN0b3AsIHRoaXMpO1xyXG5cdGZldGNoQ29udGV4dC5vbigncmVzdW1lJywgdGhpcy5fb25SZXN1bWUsIHRoaXMpO1xyXG59XHJcblxyXG5TaW1wbGVNb3ZhYmxlRmV0Y2gucHJvdG90eXBlLnN0YXJ0ID0gZnVuY3Rpb24gc3RhcnQoaW1hZ2VQYXJ0UGFyYW1zKSB7XHJcblx0dGhpcy5fb25Nb3ZlKGltYWdlUGFydFBhcmFtcyk7XHJcbn07XHJcblxyXG5TaW1wbGVNb3ZhYmxlRmV0Y2gucHJvdG90eXBlLl9vbklzUHJvZ3Jlc3NpdmVDaGFuZ2VkID0gZnVuY3Rpb24gaXNQcm9ncmVzc2l2ZUNoYW5nZWQoaXNQcm9ncmVzc2l2ZSkge1xyXG5cdHRoaXMuX2lzUHJvZ3Jlc3NpdmUgPSBpc1Byb2dyZXNzaXZlO1xyXG5cdHZhciBsYXN0QWN0aXZlRmV0Y2ggPSB0aGlzLl9nZXRMYXN0RmV0Y2goKTtcclxuXHRpZiAobGFzdEFjdGl2ZUZldGNoICE9PSBudWxsKSB7XHJcblx0XHRsYXN0QWN0aXZlRmV0Y2guX29uRXZlbnQoJ2lzUHJvZ3Jlc3NpdmVDaGFuZ2VkJywgaXNQcm9ncmVzc2l2ZSk7XHJcblx0fSBlbHNlIHtcclxuXHRcdHRoaXMuX2lzUHJvZ3Jlc3NpdmVDaGFuZ2VkQ2FsbGVkID0gdHJ1ZTtcclxuXHR9XHJcbn07XHJcblxyXG5TaW1wbGVNb3ZhYmxlRmV0Y2gucHJvdG90eXBlLl9vblN0b3AgPSBmdW5jdGlvbiBzdG9wKGlzQWJvcnRlZCkge1xyXG5cdHRoaXMuX3N3aXRjaFN0YXRlKEZFVENIX1NUQVRFX1NUT1BQSU5HLCBGRVRDSF9TVEFURV9BQ1RJVkUpO1xyXG5cdHZhciBsYXN0QWN0aXZlRmV0Y2ggPSB0aGlzLl9nZXRMYXN0RmV0Y2goKTtcclxuXHRpZiAobGFzdEFjdGl2ZUZldGNoICE9PSBudWxsKSB7XHJcblx0XHRsYXN0QWN0aXZlRmV0Y2guX29uRXZlbnQoJ3N0b3AnLCBpc0Fib3J0ZWQpO1xyXG5cdH1cclxufTtcclxuXHJcblNpbXBsZU1vdmFibGVGZXRjaC5wcm90b3R5cGUuX29uUmVzdW1lID0gZnVuY3Rpb24gcmVzdW1lKCkge1xyXG5cdHRoaXMuX3N3aXRjaFN0YXRlKEZFVENIX1NUQVRFX0FDVElWRSwgRkVUQ0hfU1RBVEVfU1RPUFBFRCwgRkVUQ0hfU1RBVEVfU1RPUFBJTkcpO1xyXG5cclxuXHR2YXIgbGFzdEZldGNoSXRlcmF0b3IgPSB0aGlzLl9hY3RpdmVGZXRjaGVzSW5Nb3ZhYmxlRmV0Y2guZ2V0TGFzdEl0ZXJhdG9yKCk7XHJcblx0aWYgKGxhc3RGZXRjaEl0ZXJhdG9yICE9PSBudWxsKSB7XHJcblx0XHR0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiByZXN1bWluZyBub24gc3RvcHBlZCBmZXRjaCc7XHJcblx0fVxyXG5cdFxyXG5cdHZhciBsYXN0RmV0Y2ggPSB0aGlzLl9hY3RpdmVGZXRjaGVzSW5Nb3ZhYmxlRmV0Y2guZ2V0VmFsdWUobGFzdEZldGNoSXRlcmF0b3IpO1xyXG5cdGlmICh0aGlzLl9pc1Byb2dyZXNzaXZlQ2hhbmdlZENhbGxlZCkge1xyXG5cdFx0dGhpcy5faXNQcm9ncmVzc2l2ZUNoYW5nZWRDYWxsZWQgPSBmYWxzZTtcclxuXHRcdGxhc3RGZXRjaC5fb25FdmVudCgnaXNQcm9ncmVzc2l2ZUNoYW5nZWQnLCB0aGlzLl9pc1Byb2dyZXNzaXZlKTtcclxuXHR9XHJcblx0bGFzdEZldGNoLl9vbkV2ZW50KCdyZXN1bWUnKTtcclxufTtcclxuXHJcblNpbXBsZU1vdmFibGVGZXRjaC5wcm90b3R5cGUuX29uVGVybWluYXRlZCA9IGZ1bmN0aW9uIG9uVGVybWluYXRlZChpc0Fib3J0ZWQpIHtcclxuXHR0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBVbmV4cGVjdGVkIHRlcm1pbmF0aW9uIG9mIG1vdmFibGUgZmV0Y2gnO1xyXG59O1xyXG5cclxuU2ltcGxlTW92YWJsZUZldGNoLnByb3RvdHlwZS5fb25Nb3ZlID0gZnVuY3Rpb24gbW92ZShpbWFnZVBhcnRQYXJhbXMpIHtcclxuXHR0aGlzLl9wZW5kaW5nSW1hZ2VQYXJ0UGFyYW1zID0gaW1hZ2VQYXJ0UGFyYW1zO1xyXG5cdHRoaXMuX21vdmFibGVTdGF0ZSA9IEZFVENIX1NUQVRFX0FDVElWRTtcclxuXHR0aGlzLl90cnlTdGFydFBlbmRpbmdGZXRjaCgpO1xyXG59O1xyXG5cclxuU2ltcGxlTW92YWJsZUZldGNoLnByb3RvdHlwZS5fdHJ5U3RhcnRQZW5kaW5nRmV0Y2ggPSBmdW5jdGlvbiB0cnlTdGFydFBlbmRpbmdGZXRjaCgpIHtcclxuXHRpZiAodGhpcy5fZmV0Y2hlckNsb3Nlci5pc0Nsb3NlUmVxdWVzdGVkKCkgfHxcclxuXHRcdHRoaXMuX2FjdGl2ZUZldGNoZXNJbk1vdmFibGVGZXRjaC5nZXRDb3VudCgpID49IHRoaXMuX21heEFjdGl2ZUZldGNoZXNJbk1vdmFibGVGZXRjaCB8fFxyXG5cdFx0dGhpcy5fcGVuZGluZ0ltYWdlUGFydFBhcmFtcyA9PT0gbnVsbCB8fFxyXG5cdFx0dGhpcy5fbW92YWJsZVN0YXRlICE9PSBGRVRDSF9TVEFURV9BQ1RJVkUpIHtcclxuXHJcblx0XHRcdHJldHVybjtcclxuXHR9XHJcblx0XHJcblx0dmFyIG5ld0ZldGNoID0ge1xyXG5cdFx0aW1hZ2VQYXJ0UGFyYW1zOiB0aGlzLl9wZW5kaW5nSW1hZ2VQYXJ0UGFyYW1zLFxyXG5cdFx0c3RhdGU6IEZFVENIX1NUQVRFX0FDVElWRSxcclxuXHJcblx0XHRmZXRjaENvbnRleHQ6IG51bGwsXHJcblx0XHRwYXJlbnRJdGVyYXRvcjogbnVsbCxcclxuXHRcdHNlbGY6IHRoaXNcclxuXHR9O1xyXG5cdFxyXG5cdHRoaXMuX3BlbmRpbmdJbWFnZVBhcnRQYXJhbXMgPSBudWxsO1xyXG5cdG5ld0ZldGNoLnBhcmVudEl0ZXJhdG9yID0gdGhpcy5fYWN0aXZlRmV0Y2hlc0luTW92YWJsZUZldGNoLmFkZChuZXdGZXRjaCk7XHJcblx0XHJcbiAgICB0aGlzLl9mZXRjaGVyQ2xvc2VyLmNoYW5nZUFjdGl2ZUZldGNoZXNDb3VudCgrMSk7XHJcblx0XHJcblx0bmV3RmV0Y2guZmV0Y2hDb250ZXh0ID0gbmV3IEZldGNoQ29udGV4dEFwaSgpO1xyXG5cdG5ld0ZldGNoLmZldGNoQ29udGV4dC5vbignaW50ZXJuYWxTdG9wcGVkJywgb25TaW5nbGVGZXRjaFN0b3BwZWQsIG5ld0ZldGNoKTtcclxuXHRuZXdGZXRjaC5mZXRjaENvbnRleHQub24oJ2ludGVybmFsRG9uZScsIG9uU2luZ2xlRmV0Y2hEb25lLCBuZXdGZXRjaCk7XHJcbiAgICBcclxuICAgIHRoaXMuX2ZldGNoZXIuc3RhcnRGZXRjaChuZXdGZXRjaC5mZXRjaENvbnRleHQsIG5ld0ZldGNoLmltYWdlUGFydFBhcmFtcyk7XHJcbn07XHJcblxyXG5TaW1wbGVNb3ZhYmxlRmV0Y2gucHJvdG90eXBlLl9zaW5nbGVGZXRjaFN0b3BwZWQgPSBmdW5jdGlvbiBzaW5nbGVGZXRjaFN0b3BwZWQoZmV0Y2gsIGlzRG9uZSkge1xyXG5cdHRoaXMuX2ZldGNoZXJDbG9zZXIuY2hhbmdlQWN0aXZlRmV0Y2hlc0NvdW50KC0xKTtcclxuXHR0aGlzLl9hY3RpdmVGZXRjaGVzSW5Nb3ZhYmxlRmV0Y2gucmVtb3ZlKGZldGNoLnBhcmVudEl0ZXJhdG9yKTtcclxuXHRmZXRjaC5zdGF0ZSA9IEZFVENIX1NUQVRFX1RFUk1JTkFURUQ7XHJcblx0ZmV0Y2gucGFyZW50SXRlcmF0b3IgPSBudWxsO1xyXG59O1xyXG5cclxuU2ltcGxlTW92YWJsZUZldGNoLnByb3RvdHlwZS5fZ2V0TGFzdEZldGNoID0gZnVuY3Rpb24gZ2V0TGFzdEZldGNoKCkge1xyXG5cdGlmICh0aGlzLl9tb3ZhYmxlU3RhdGUgPT09IEZFVENIX1NUQVRFX1NUT1BQRUQpIHtcclxuXHRcdHJldHVybiBudWxsO1xyXG5cdH1cclxuXHRcclxuXHR2YXIgbGFzdEZldGNoSXRlcmF0b3IgPSB0aGlzLl9hY3RpdmVGZXRjaGVzSW5Nb3ZhYmxlRmV0Y2guZ2V0TGFzdEl0ZXJhdG9yKCk7XHJcblx0aWYgKGxhc3RGZXRjaEl0ZXJhdG9yID09PSBudWxsKSB7XHJcblx0XHRyZXR1cm4gbnVsbDtcclxuXHR9XHJcblx0XHJcblx0dmFyIGxhc3RGZXRjaCA9IHRoaXMuX2FjdGl2ZUZldGNoZXNJbk1vdmFibGVGZXRjaC5nZXRWYWx1ZShsYXN0RmV0Y2hJdGVyYXRvcik7XHJcblx0aWYgKGxhc3RGZXRjaC5zdGF0ZSA9PT0gRkVUQ0hfU1RBVEVfQUNUSVZFKSB7XHJcblx0XHRyZXR1cm4gbGFzdEZldGNoLmZldGNoQ29udGV4dDtcclxuXHR9XHJcblx0cmV0dXJuIG51bGw7XHJcbn07XHJcblxyXG5TaW1wbGVNb3ZhYmxlRmV0Y2gucHJvdG90eXBlLl9zd2l0Y2hTdGF0ZSA9IGZ1bmN0aW9uIHN3aXRjaFN0YXRlKHRhcmdldFN0YXRlLCBleHBlY3RlZFN0YXRlLCBleHBlY3RlZFN0YXRlMiwgZXhwZWN0ZWRTdGF0ZTMpIHtcclxuXHRpZiAodGhpcy5fbW92YWJsZVN0YXRlICE9PSBleHBlY3RlZFN0YXRlICYmIHRoaXMuX21vdmFibGVTdGF0ZSAhPT0gZXhwZWN0ZWRTdGF0ZTIgJiYgdGhpcy5fbW92YWJsZVN0YXRlICE9PSBleHBlY3RlZFN0YXRlMykge1xyXG5cdFx0dGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogVW5leHBlY3RlZCBzdGF0ZSAnICsgdGhpcy5fbW92YWJsZVN0YXRlICsgJywgZXhwZWN0ZWQgJyArIGV4cGVjdGVkU3RhdGUgKyAnIG9yICcgKyBleHBlY3RlZFN0YXRlMiArICcgb3IgJyArIGV4cGVjdGVkU3RhdGUzO1xyXG5cdH1cclxuXHR0aGlzLl9tb3ZhYmxlU3RhdGUgPSB0YXJnZXRTdGF0ZTtcclxufTtcclxuXHJcblNpbXBsZU1vdmFibGVGZXRjaC5wcm90b3R5cGUuX2lzTGFzdEZldGNoID0gZnVuY3Rpb24gaXNMYXN0RmV0Y2goZmV0Y2gpIHtcclxuXHRyZXR1cm5cdHRoaXMuX2FjdGl2ZUZldGNoZXNJbk1vdmFibGVGZXRjaC5nZXROZXh0SXRlcmF0b3IoZmV0Y2gucGFyZW50SXRlcmF0b3IpID09PSBudWxsICYmXHJcblx0XHRcdHRoaXMuX3BlbmRpbmdJbWFnZVBhcnRQYXJhbXMgPT09IG51bGw7XHJcbn07XHJcblxyXG5mdW5jdGlvbiBvblNpbmdsZUZldGNoU3RvcHBlZCgpIHtcclxuXHQvKiBqc2hpbnQgdmFsaWR0aGlzOiB0cnVlICovXHJcblx0dmFyIGZldGNoID0gdGhpcztcclxuXHR2YXIgbW92YWJsZUZldGNoID0gZmV0Y2guc2VsZjtcclxuXHRcclxuXHRpZiAoZmV0Y2guc3RhdGUgIT09IEZFVENIX1NUQVRFX1NUT1BQSU5HKSB7XHJcblx0XHR0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBVbmV4cGVjdGVkIHN0YXRlIG9mIGZldGNoICcgKyBmZXRjaC5zdGF0ZSArICcgb24gc3RvcHBlZCc7XHJcblx0fVxyXG5cdFxyXG5cdGlmIChtb3ZhYmxlRmV0Y2guX2lzTGFzdEZldGNoKGZldGNoKSkge1xyXG5cdFx0ZmV0Y2guc3RhdGUgPSBGRVRDSF9TVEFURV9TVE9QUEVEO1xyXG5cdFx0bW92YWJsZUZldGNoLl9zd2l0Y2hTdGF0ZShGRVRDSF9TVEFURV9TVE9QUEVELCBGRVRDSF9TVEFURV9TVE9QUElORyk7XHJcblx0XHRtb3ZhYmxlRmV0Y2guX21vdmFibGVGZXRjaENvbnRleHQuc3RvcHBlZCgpO1xyXG5cdH0gZWxzZSB7XHJcblx0XHRtb3ZhYmxlRmV0Y2guX3NpbmdsZUZldGNoU3RvcHBlZChmZXRjaCk7XHJcblx0fVxyXG5cclxuXHRtb3ZhYmxlRmV0Y2guX3RyeVN0YXJ0UGVuZGluZ0ZldGNoKCk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIG9uU2luZ2xlRmV0Y2hEb25lKCkge1xyXG5cdC8qIGpzaGludCB2YWxpZHRoaXM6IHRydWUgKi9cclxuXHR2YXIgZmV0Y2ggPSB0aGlzO1xyXG5cdHZhciBtb3ZhYmxlRmV0Y2ggPSBmZXRjaC5zZWxmO1xyXG5cclxuXHRpZiAoZmV0Y2guc3RhdGUgIT09IEZFVENIX1NUQVRFX0FDVElWRSAmJiBmZXRjaC5zdGF0ZSAhPT0gRkVUQ0hfU1RBVEVfU1RPUFBJTkcpIHtcclxuXHRcdHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IFVuZXhwZWN0ZWQgc3RhdGUgb2YgZmV0Y2ggJyArIGZldGNoLnN0YXRlICsgJyBvbiBkb25lJztcclxuXHR9XHJcblxyXG5cdGZldGNoLnN0YXRlID0gRkVUQ0hfU1RBVEVfVEVSTUlOQVRFRDtcclxuXHRpZiAobW92YWJsZUZldGNoLl9pc0xhc3RGZXRjaChmZXRjaCkpIHtcclxuXHRcdG1vdmFibGVGZXRjaC5fc3dpdGNoU3RhdGUoRkVUQ0hfU1RBVEVfV0FJVF9GT1JfTU9WRSwgRkVUQ0hfU1RBVEVfQUNUSVZFLCBGRVRDSF9TVEFURV9TVE9QUElORyk7XHJcblx0XHRtb3ZhYmxlRmV0Y2guX21vdmFibGVGZXRjaENvbnRleHQuZG9uZSgpO1xyXG5cdH1cclxuXHRtb3ZhYmxlRmV0Y2guX3NpbmdsZUZldGNoU3RvcHBlZChmZXRjaCk7XHJcbn0iLCIndXNlIHN0cmljdCc7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IEltYWdlUGFyYW1zUmV0cmlldmVyUHJveHk7XHJcblxyXG5mdW5jdGlvbiBJbWFnZVBhcmFtc1JldHJpZXZlclByb3h5KCkge1xyXG4gICAgdGhpcy5fc2l6ZXNQYXJhbXMgPSBudWxsO1xyXG59XHJcblxyXG5JbWFnZVBhcmFtc1JldHJpZXZlclByb3h5LnByb3RvdHlwZS5nZXRJbWFnZUxldmVsID0gZnVuY3Rpb24gZ2V0SW1hZ2VMZXZlbCgpIHtcclxuICAgIHZhciBzaXplc1BhcmFtcyA9IHRoaXMuZ2V0SW1hZ2VQYXJhbXMoKTtcclxuXHJcbiAgICByZXR1cm4gc2l6ZXNQYXJhbXMuaW1hZ2VMZXZlbDtcclxufTtcclxuXHJcbkltYWdlUGFyYW1zUmV0cmlldmVyUHJveHkucHJvdG90eXBlLmdldEltYWdlV2lkdGggPSBmdW5jdGlvbiBnZXRJbWFnZVdpZHRoKCkge1xyXG4gICAgdmFyIHNpemVzUGFyYW1zID0gdGhpcy5nZXRJbWFnZVBhcmFtcygpO1xyXG5cclxuICAgIHJldHVybiBzaXplc1BhcmFtcy5pbWFnZVdpZHRoO1xyXG59O1xyXG5cclxuSW1hZ2VQYXJhbXNSZXRyaWV2ZXJQcm94eS5wcm90b3R5cGUuZ2V0SW1hZ2VIZWlnaHQgPSBmdW5jdGlvbiBnZXRJbWFnZUhlaWdodCgpIHtcclxuICAgIHZhciBzaXplc1BhcmFtcyA9IHRoaXMuZ2V0SW1hZ2VQYXJhbXMoKTtcclxuXHJcbiAgICByZXR1cm4gc2l6ZXNQYXJhbXMuaW1hZ2VIZWlnaHQ7XHJcbn07XHJcblxyXG5JbWFnZVBhcmFtc1JldHJpZXZlclByb3h5LnByb3RvdHlwZS5nZXROdW1SZXNvbHV0aW9uTGV2ZWxzRm9yTGltaXR0ZWRWaWV3ZXIgPSBmdW5jdGlvbiBnZXROdW1SZXNvbHV0aW9uTGV2ZWxzRm9yTGltaXR0ZWRWaWV3ZXIoKSB7XHJcbiAgICB2YXIgc2l6ZXNQYXJhbXMgPSB0aGlzLmdldEltYWdlUGFyYW1zKCk7XHJcblxyXG4gICAgcmV0dXJuIHNpemVzUGFyYW1zLm51bVJlc29sdXRpb25MZXZlbHNGb3JMaW1pdHRlZFZpZXdlcjtcclxufTtcclxuXHJcbkltYWdlUGFyYW1zUmV0cmlldmVyUHJveHkucHJvdG90eXBlLmdldExvd2VzdFF1YWxpdHkgPSBmdW5jdGlvbiBnZXRMb3dlc3RRdWFsaXR5KCkge1xyXG4gICAgdmFyIHNpemVzUGFyYW1zID0gdGhpcy5nZXRJbWFnZVBhcmFtcygpO1xyXG5cclxuICAgIHJldHVybiBzaXplc1BhcmFtcy5sb3dlc3RRdWFsaXR5O1xyXG59O1xyXG5cclxuSW1hZ2VQYXJhbXNSZXRyaWV2ZXJQcm94eS5wcm90b3R5cGUuZ2V0SGlnaGVzdFF1YWxpdHkgPSBmdW5jdGlvbiBnZXRIaWdoZXN0UXVhbGl0eSgpIHtcclxuICAgIHZhciBzaXplc1BhcmFtcyA9IHRoaXMuZ2V0SW1hZ2VQYXJhbXMoKTtcclxuXHJcbiAgICByZXR1cm4gc2l6ZXNQYXJhbXMuaGlnaGVzdFF1YWxpdHk7XHJcbn07XHJcblxyXG5JbWFnZVBhcmFtc1JldHJpZXZlclByb3h5LnByb3RvdHlwZS5nZXRJbWFnZVBhcmFtcyA9IGZ1bmN0aW9uIGdldEltYWdlUGFyYW1zKCkge1xyXG4gICAgaWYgKCF0aGlzLl9zaXplc1BhcmFtcykge1xyXG4gICAgICAgIHRoaXMuX3NpemVzUGFyYW1zID0gdGhpcy5fZ2V0SW1hZ2VQYXJhbXNJbnRlcm5hbCgpO1xyXG4gICAgICAgIGlmICghdGhpcy5fc2l6ZXNQYXJhbXMpIHtcclxuICAgICAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogZ2V0SW1hZ2VQYXJhbXNJbnRlcm5hbCgpIHJldHVybmVkIGZhbHN5IHZhbHVlOyBNYXliZSBpbWFnZSBub3QgcmVhZHkgeWV0Pyc7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIGlmICh0aGlzLl9zaXplc1BhcmFtcy5pbWFnZUxldmVsID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogZ2V0SW1hZ2VQYXJhbXNJbnRlcm5hbCgpIHJlc3VsdCBoYXMgbm8gaW1hZ2VMZXZlbCBwcm9wZXJ0eSc7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIGlmICh0aGlzLl9zaXplc1BhcmFtcy5pbWFnZVdpZHRoID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogZ2V0SW1hZ2VQYXJhbXNJbnRlcm5hbCgpIHJlc3VsdCBoYXMgbm8gaW1hZ2VXaWR0aCBwcm9wZXJ0eSc7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIGlmICh0aGlzLl9zaXplc1BhcmFtcy5pbWFnZUhlaWdodCA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IGdldEltYWdlUGFyYW1zSW50ZXJuYWwoKSByZXN1bHQgaGFzIG5vIGltYWdlSGVpZ2h0IHByb3BlcnR5JztcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKHRoaXMuX3NpemVzUGFyYW1zLm51bVJlc29sdXRpb25MZXZlbHNGb3JMaW1pdHRlZFZpZXdlciA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IGdldEltYWdlUGFyYW1zSW50ZXJuYWwoKSByZXN1bHQgaGFzIG5vIG51bVJlc29sdXRpb25MZXZlbHNGb3JMaW1pdHRlZFZpZXdlciBwcm9wZXJ0eSc7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIGlmICh0aGlzLl9zaXplc1BhcmFtcy5sb3dlc3RRdWFsaXR5ID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogZ2V0SW1hZ2VQYXJhbXNJbnRlcm5hbCgpIHJlc3VsdCBoYXMgbm8gbG93ZXN0UXVhbGl0eSBwcm9wZXJ0eSc7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIGlmICh0aGlzLl9zaXplc1BhcmFtcy5oaWdoZXN0UXVhbGl0eSA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IGdldEltYWdlUGFyYW1zSW50ZXJuYWwoKSByZXN1bHQgaGFzIG5vIGhpZ2hlc3RRdWFsaXR5IHByb3BlcnR5JztcclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHJldHVybiB0aGlzLl9zaXplc1BhcmFtcztcclxufTtcclxuXHJcbkltYWdlUGFyYW1zUmV0cmlldmVyUHJveHkucHJvdG90eXBlLl9nZXRJbWFnZVBhcmFtc0ludGVybmFsID0gZnVuY3Rpb24gZ2V0SW1hZ2VQYXJhbXNJbnRlcm5hbCgpIHtcclxuICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IEltYWdlUGFyYW1zUmV0cmlldmVyUHJveHkgaW5oZXJpdG9yIGRpZCBub3QgaW1wbGVtZW50IF9nZXRJbWFnZVBhcmFtc0ludGVybmFsKCknO1xyXG59OyIsIid1c2Ugc3RyaWN0JztcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gSW1hZ2VWaWV3ZXI7XHJcblxyXG52YXIgaW1hZ2VIZWxwZXJGdW5jdGlvbnMgPSByZXF1aXJlKCdpbWFnZS1oZWxwZXItZnVuY3Rpb25zLmpzJyk7XHJcblxyXG52YXIgUEVORElOR19DQUxMX1RZUEVfUElYRUxTX1VQREFURUQgPSAxO1xyXG52YXIgUEVORElOR19DQUxMX1RZUEVfUkVQT1NJVElPTiA9IDI7XHJcblxyXG52YXIgUkVHSU9OX09WRVJWSUVXID0gMDtcclxudmFyIFJFR0lPTl9EWU5BTUlDID0gMTtcclxuXHJcbmZ1bmN0aW9uIEltYWdlVmlld2VyKGltYWdlLCBjYW52YXNVcGRhdGVkQ2FsbGJhY2ssIG9wdGlvbnMpIHtcclxuICAgIHRoaXMuX2NhbnZhc1VwZGF0ZWRDYWxsYmFjayA9IGNhbnZhc1VwZGF0ZWRDYWxsYmFjaztcclxuICAgIFxyXG4gICAgdGhpcy5fYWRhcHRQcm9wb3J0aW9ucyA9IG9wdGlvbnMuYWRhcHRQcm9wb3J0aW9ucztcclxuICAgIHRoaXMuX2NhcnRvZ3JhcGhpY0JvdW5kcyA9IG9wdGlvbnMuY2FydG9ncmFwaGljQm91bmRzO1xyXG4gICAgdGhpcy5fYWxsb3dNdWx0aXBsZU1vdmFibGVGZXRjaGVzSW5TZXNzaW9uID1cclxuICAgICAgICBvcHRpb25zLmFsbG93TXVsdGlwbGVNb3ZhYmxlRmV0Y2hlc0luU2Vzc2lvbjtcclxuICAgIHRoaXMuX21pbkZ1bmN0aW9uQ2FsbEludGVydmFsTWlsbGlzZWNvbmRzID1cclxuICAgICAgICBvcHRpb25zLm1pbkZ1bmN0aW9uQ2FsbEludGVydmFsTWlsbGlzZWNvbmRzO1xyXG4gICAgdGhpcy5fb3ZlcnZpZXdSZXNvbHV0aW9uWCA9IG9wdGlvbnMub3ZlcnZpZXdSZXNvbHV0aW9uWCB8fCAxMDA7XHJcbiAgICB0aGlzLl9vdmVydmlld1Jlc29sdXRpb25ZID0gb3B0aW9ucy5vdmVydmlld1Jlc29sdXRpb25ZIHx8IDEwMDtcclxuICAgICAgICBcclxuICAgIHRoaXMuX2xhc3RSZXF1ZXN0SW5kZXggPSAwO1xyXG4gICAgdGhpcy5fcGVuZGluZ1VwZGF0ZVZpZXdBcmVhID0gbnVsbDtcclxuICAgIHRoaXMuX3JlZ2lvbnMgPSBbXTtcclxuICAgIHRoaXMuX3RhcmdldENhbnZhcyA9IG51bGw7XHJcbiAgICBcclxuICAgIHRoaXMuX2NhbGxQZW5kaW5nQ2FsbGJhY2tzQm91bmQgPSB0aGlzLl9jYWxsUGVuZGluZ0NhbGxiYWNrcy5iaW5kKHRoaXMpO1xyXG4gICAgdGhpcy5fY3JlYXRlZE1vdmFibGVGZXRjaEJvdW5kID0gdGhpcy5fY3JlYXRlZE1vdmFibGVGZXRjaC5iaW5kKHRoaXMpO1xyXG4gICAgXHJcbiAgICB0aGlzLl9wZW5kaW5nQ2FsbGJhY2tzSW50ZXJ2YWxIYW5kbGUgPSAwO1xyXG4gICAgdGhpcy5fcGVuZGluZ0NhbGxiYWNrQ2FsbHMgPSBbXTtcclxuICAgIHRoaXMuX2NhblNob3dEeW5hbWljUmVnaW9uID0gZmFsc2U7XHJcbiAgICBcclxuICAgIGlmICh0aGlzLl9jYXJ0b2dyYXBoaWNCb3VuZHMgPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIHRoaXMuX2NhcnRvZ3JhcGhpY0JvdW5kcyA9IHtcclxuICAgICAgICAgICAgd2VzdDogLTE3NS4wLFxyXG4gICAgICAgICAgICBlYXN0OiAxNzUuMCxcclxuICAgICAgICAgICAgc291dGg6IC04NS4wLFxyXG4gICAgICAgICAgICBub3J0aDogODUuMFxyXG4gICAgICAgIH07XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGlmICh0aGlzLl9hZGFwdFByb3BvcnRpb25zID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICB0aGlzLl9hZGFwdFByb3BvcnRpb25zID0gdHJ1ZTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgdGhpcy5faW1hZ2UgPSBpbWFnZTtcclxufVxyXG5cclxuSW1hZ2VWaWV3ZXIucHJvdG90eXBlLnNldEV4Y2VwdGlvbkNhbGxiYWNrID0gZnVuY3Rpb24gc2V0RXhjZXB0aW9uQ2FsbGJhY2soZXhjZXB0aW9uQ2FsbGJhY2spIHtcclxuICAgIC8vIFRPRE86IFN1cHBvcnQgZXhjZXB0aW9uQ2FsbGJhY2sgaW4gZXZlcnkgcGxhY2UgbmVlZGVkXHJcblx0dGhpcy5fZXhjZXB0aW9uQ2FsbGJhY2sgPSBleGNlcHRpb25DYWxsYmFjaztcclxufTtcclxuICAgIFxyXG5JbWFnZVZpZXdlci5wcm90b3R5cGUub3BlbiA9IGZ1bmN0aW9uIG9wZW4odXJsKSB7XHJcbiAgICByZXR1cm4gdGhpcy5faW1hZ2Uub3Blbih1cmwpXHJcbiAgICAgICAgLnRoZW4odGhpcy5fb3BlbmVkLmJpbmQodGhpcykpXHJcbiAgICAgICAgLmNhdGNoKHRoaXMuX2V4Y2VwdGlvbkNhbGxiYWNrKTtcclxufTtcclxuXHJcbkltYWdlVmlld2VyLnByb3RvdHlwZS5jbG9zZSA9IGZ1bmN0aW9uIGNsb3NlKCkge1xyXG4gICAgdmFyIHByb21pc2UgPSB0aGlzLl9pbWFnZS5jbG9zZSgpO1xyXG4gICAgcHJvbWlzZS5jYXRjaCh0aGlzLl9leGNlcHRpb25DYWxsYmFjayk7XHJcbiAgICB0aGlzLl9pc1JlYWR5ID0gZmFsc2U7XHJcbiAgICB0aGlzLl9jYW5TaG93RHluYW1pY1JlZ2lvbiA9IGZhbHNlO1xyXG4gICAgdGhpcy5fdGFyZ2V0Q2FudmFzID0gbnVsbDtcclxuXHRyZXR1cm4gcHJvbWlzZTtcclxufTtcclxuXHJcbkltYWdlVmlld2VyLnByb3RvdHlwZS5zZXRUYXJnZXRDYW52YXMgPSBmdW5jdGlvbiBzZXRUYXJnZXRDYW52YXMoY2FudmFzKSB7XHJcbiAgICB0aGlzLl90YXJnZXRDYW52YXMgPSBjYW52YXM7XHJcbn07XHJcblxyXG5JbWFnZVZpZXdlci5wcm90b3R5cGUudXBkYXRlVmlld0FyZWEgPSBmdW5jdGlvbiB1cGRhdGVWaWV3QXJlYShmcnVzdHVtRGF0YSkge1xyXG4gICAgaWYgKHRoaXMuX3RhcmdldENhbnZhcyA9PT0gbnVsbCkge1xyXG4gICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IENhbm5vdCB1cGRhdGUgZHluYW1pYyByZWdpb24gYmVmb3JlIHNldFRhcmdldENhbnZhcygpJztcclxuICAgIH1cclxuICAgIFxyXG4gICAgaWYgKCF0aGlzLl9jYW5TaG93RHluYW1pY1JlZ2lvbikge1xyXG4gICAgICAgIHRoaXMuX3BlbmRpbmdVcGRhdGVWaWV3QXJlYSA9IGZydXN0dW1EYXRhO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIFxyXG4gICAgdmFyIGJvdW5kcyA9IGZydXN0dW1EYXRhLnJlY3RhbmdsZTtcclxuICAgIHZhciBzY3JlZW5TaXplID0gZnJ1c3R1bURhdGEuc2NyZWVuU2l6ZTtcclxuICAgIFxyXG4gICAgdmFyIHJlZ2lvblBhcmFtcyA9IHtcclxuICAgICAgICBtaW5YOiBib3VuZHMud2VzdCAqIHRoaXMuX3NjYWxlWCArIHRoaXMuX3RyYW5zbGF0ZVgsXHJcbiAgICAgICAgbWluWTogYm91bmRzLm5vcnRoICogdGhpcy5fc2NhbGVZICsgdGhpcy5fdHJhbnNsYXRlWSxcclxuICAgICAgICBtYXhYRXhjbHVzaXZlOiBib3VuZHMuZWFzdCAqIHRoaXMuX3NjYWxlWCArIHRoaXMuX3RyYW5zbGF0ZVgsXHJcbiAgICAgICAgbWF4WUV4Y2x1c2l2ZTogYm91bmRzLnNvdXRoICogdGhpcy5fc2NhbGVZICsgdGhpcy5fdHJhbnNsYXRlWSxcclxuICAgICAgICBzY3JlZW5XaWR0aDogc2NyZWVuU2l6ZS54LFxyXG4gICAgICAgIHNjcmVlbkhlaWdodDogc2NyZWVuU2l6ZS55XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICB2YXIgYWxpZ25lZFBhcmFtcyA9XHJcbiAgICAgICAgaW1hZ2VIZWxwZXJGdW5jdGlvbnMuYWxpZ25QYXJhbXNUb1RpbGVzQW5kTGV2ZWwoXHJcbiAgICAgICAgICAgIHJlZ2lvblBhcmFtcywgdGhpcy5faW1hZ2UsIHRoaXMuX2ltYWdlKTtcclxuICAgIFxyXG4gICAgdmFyIGlzT3V0c2lkZVNjcmVlbiA9IGFsaWduZWRQYXJhbXMgPT09IG51bGw7XHJcbiAgICBpZiAoaXNPdXRzaWRlU2NyZWVuKSB7XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBhbGlnbmVkUGFyYW1zLmltYWdlUGFydFBhcmFtcy5xdWFsaXR5ID0gdGhpcy5fcXVhbGl0eTtcclxuXHJcbiAgICB2YXIgaXNTYW1lUmVnaW9uID1cclxuICAgICAgICB0aGlzLl9keW5hbWljRmV0Y2hQYXJhbXMgIT09IHVuZGVmaW5lZCAmJlxyXG4gICAgICAgIHRoaXMuX2lzSW1hZ2VQYXJ0c0VxdWFsKFxyXG4gICAgICAgICAgICBhbGlnbmVkUGFyYW1zLmltYWdlUGFydFBhcmFtcyxcclxuICAgICAgICAgICAgdGhpcy5fZHluYW1pY0ZldGNoUGFyYW1zLmltYWdlUGFydFBhcmFtcyk7XHJcbiAgICBcclxuICAgIGlmIChpc1NhbWVSZWdpb24pIHtcclxuICAgICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGZydXN0dW1EYXRhLmltYWdlUmVjdGFuZ2xlID0gdGhpcy5fY2FydG9ncmFwaGljQm91bmRzRml4ZWQ7XHJcbiAgICBmcnVzdHVtRGF0YS5leGFjdGxldmVsID1cclxuICAgICAgICBhbGlnbmVkUGFyYW1zLmltYWdlUGFydFBhcmFtcy5sZXZlbDtcclxuICAgIFxyXG4gICAgdGhpcy5faW1hZ2Uuc2V0RGVjb2RlUHJpb3JpdGl6ZXJEYXRhKGZydXN0dW1EYXRhKTtcclxuICAgIHRoaXMuX2ltYWdlLnNldFNlcnZlclJlcXVlc3RQcmlvcml0aXplckRhdGEoZnJ1c3R1bURhdGEpO1xyXG5cclxuICAgIHRoaXMuX2R5bmFtaWNGZXRjaFBhcmFtcyA9IGFsaWduZWRQYXJhbXM7XHJcbiAgICBcclxuICAgIHZhciBzdGFydER5bmFtaWNSZWdpb25PblRlcm1pbmF0aW9uID0gZmFsc2U7XHJcbiAgICB2YXIgbW92ZUV4aXN0aW5nRmV0Y2ggPSAhdGhpcy5fYWxsb3dNdWx0aXBsZU1vdmFibGVGZXRjaGVzSW5TZXNzaW9uO1xyXG4gICAgdGhpcy5fZmV0Y2goXHJcbiAgICAgICAgUkVHSU9OX0RZTkFNSUMsXHJcbiAgICAgICAgYWxpZ25lZFBhcmFtcyxcclxuICAgICAgICBzdGFydER5bmFtaWNSZWdpb25PblRlcm1pbmF0aW9uLFxyXG4gICAgICAgIG1vdmVFeGlzdGluZ0ZldGNoKTtcclxufTtcclxuXHJcbkltYWdlVmlld2VyLnByb3RvdHlwZS5nZXRCb3VuZHMgPSBmdW5jdGlvbiBnZXRDYXJ0b2dyYXBoaWNCb3VuZHMoKSB7XHJcbiAgICBpZiAoIXRoaXMuX2lzUmVhZHkpIHtcclxuICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBJbWFnZVZpZXdlciBlcnJvcjogSW1hZ2UgaXMgbm90IHJlYWR5IHlldCc7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gdGhpcy5fY2FydG9ncmFwaGljQm91bmRzRml4ZWQ7XHJcbn07XHJcblxyXG5JbWFnZVZpZXdlci5wcm90b3R5cGUuX2lzSW1hZ2VQYXJ0c0VxdWFsID0gZnVuY3Rpb24gaXNJbWFnZVBhcnRzRXF1YWwoZmlyc3QsIHNlY29uZCkge1xyXG4gICAgdmFyIGlzRXF1YWwgPVxyXG4gICAgICAgIHRoaXMuX2R5bmFtaWNGZXRjaFBhcmFtcyAhPT0gdW5kZWZpbmVkICYmXHJcbiAgICAgICAgZmlyc3QubWluWCA9PT0gc2Vjb25kLm1pblggJiZcclxuICAgICAgICBmaXJzdC5taW5ZID09PSBzZWNvbmQubWluWSAmJlxyXG4gICAgICAgIGZpcnN0Lm1heFhFeGNsdXNpdmUgPT09IHNlY29uZC5tYXhYRXhjbHVzaXZlICYmXHJcbiAgICAgICAgZmlyc3QubWF4WUV4Y2x1c2l2ZSA9PT0gc2Vjb25kLm1heFlFeGNsdXNpdmUgJiZcclxuICAgICAgICBmaXJzdC5sZXZlbCA9PT0gc2Vjb25kLmxldmVsO1xyXG4gICAgXHJcbiAgICByZXR1cm4gaXNFcXVhbDtcclxufTtcclxuXHJcbkltYWdlVmlld2VyLnByb3RvdHlwZS5fZmV0Y2ggPSBmdW5jdGlvbiBmZXRjaChcclxuICAgIHJlZ2lvbklkLFxyXG4gICAgZmV0Y2hQYXJhbXMsXHJcbiAgICBzdGFydER5bmFtaWNSZWdpb25PblRlcm1pbmF0aW9uLFxyXG4gICAgbW92ZUV4aXN0aW5nRmV0Y2gpIHtcclxuICAgIFxyXG4gICAgdmFyIHJlcXVlc3RJbmRleCA9ICsrdGhpcy5fbGFzdFJlcXVlc3RJbmRleDtcclxuICAgIFxyXG4gICAgdmFyIGltYWdlUGFydFBhcmFtcyA9IGZldGNoUGFyYW1zLmltYWdlUGFydFBhcmFtcztcclxuICAgIGltYWdlUGFydFBhcmFtcy5yZXF1ZXN0UHJpb3JpdHlEYXRhID1cclxuICAgICAgICBpbWFnZVBhcnRQYXJhbXMucmVxdWVzdFByaW9yaXR5RGF0YSB8fCB7fTtcclxuICAgIFxyXG4gICAgaW1hZ2VQYXJ0UGFyYW1zLnJlcXVlc3RQcmlvcml0eURhdGEucmVxdWVzdEluZGV4ID0gcmVxdWVzdEluZGV4O1xyXG5cclxuICAgIHZhciBtaW5YID0gZmV0Y2hQYXJhbXMucG9zaXRpb25JbkltYWdlLm1pblg7XHJcbiAgICB2YXIgbWluWSA9IGZldGNoUGFyYW1zLnBvc2l0aW9uSW5JbWFnZS5taW5ZO1xyXG4gICAgdmFyIG1heFggPSBmZXRjaFBhcmFtcy5wb3NpdGlvbkluSW1hZ2UubWF4WEV4Y2x1c2l2ZTtcclxuICAgIHZhciBtYXhZID0gZmV0Y2hQYXJhbXMucG9zaXRpb25JbkltYWdlLm1heFlFeGNsdXNpdmU7XHJcbiAgICBcclxuICAgIHZhciB3ZXN0ID0gKG1pblggLSB0aGlzLl90cmFuc2xhdGVYKSAvIHRoaXMuX3NjYWxlWDtcclxuICAgIHZhciBlYXN0ID0gKG1heFggLSB0aGlzLl90cmFuc2xhdGVYKSAvIHRoaXMuX3NjYWxlWDtcclxuICAgIHZhciBub3J0aCA9IChtaW5ZIC0gdGhpcy5fdHJhbnNsYXRlWSkgLyB0aGlzLl9zY2FsZVk7XHJcbiAgICB2YXIgc291dGggPSAobWF4WSAtIHRoaXMuX3RyYW5zbGF0ZVkpIC8gdGhpcy5fc2NhbGVZO1xyXG4gICAgXHJcbiAgICB2YXIgcG9zaXRpb24gPSB7XHJcbiAgICAgICAgd2VzdDogd2VzdCxcclxuICAgICAgICBlYXN0OiBlYXN0LFxyXG4gICAgICAgIG5vcnRoOiBub3J0aCxcclxuICAgICAgICBzb3V0aDogc291dGhcclxuICAgIH07XHJcbiAgICBcclxuICAgIHZhciBjYW5SZXVzZU9sZERhdGEgPSBmYWxzZTtcclxuICAgIHZhciBmZXRjaFBhcmFtc05vdE5lZWRlZDtcclxuICAgIFxyXG4gICAgdmFyIHJlZ2lvbiA9IHRoaXMuX3JlZ2lvbnNbcmVnaW9uSWRdO1xyXG4gICAgaWYgKHJlZ2lvbiAhPT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgdmFyIG5ld1Jlc29sdXRpb24gPSBpbWFnZVBhcnRQYXJhbXMubGV2ZWw7XHJcbiAgICAgICAgdmFyIG9sZFJlc29sdXRpb24gPSByZWdpb24uaW1hZ2VQYXJ0UGFyYW1zLmxldmVsO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGNhblJldXNlT2xkRGF0YSA9IG5ld1Jlc29sdXRpb24gPT09IG9sZFJlc29sdXRpb247XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKGNhblJldXNlT2xkRGF0YSAmJiByZWdpb24uZG9uZVBhcnRQYXJhbXMpIHtcclxuICAgICAgICAgICAgZmV0Y2hQYXJhbXNOb3ROZWVkZWQgPSBbIHJlZ2lvbi5kb25lUGFydFBhcmFtcyBdO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgaWYgKHJlZ2lvbklkICE9PSBSRUdJT05fT1ZFUlZJRVcpIHtcclxuICAgICAgICAgICAgdmFyIGFkZGVkUGVuZGluZ0NhbGwgPSB0aGlzLl9jaGVja0lmUmVwb3NpdGlvbk5lZWRlZChcclxuICAgICAgICAgICAgICAgIHJlZ2lvbiwgaW1hZ2VQYXJ0UGFyYW1zLCBwb3NpdGlvbik7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBpZiAoYWRkZWRQZW5kaW5nQ2FsbCkge1xyXG4gICAgICAgICAgICAgICAgdGhpcy5fbm90aWZ5TmV3UGVuZGluZ0NhbGxzKCk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHZhciBzZWxmID0gdGhpcztcclxuICAgIFxyXG4gICAgdmFyIG1vdmFibGVIYW5kbGUgPSBtb3ZlRXhpc3RpbmdGZXRjaCA/IHRoaXMuX21vdmFibGVIYW5kbGU6IHVuZGVmaW5lZDtcclxuXHJcbiAgICB0aGlzLl9pbWFnZS5yZXF1ZXN0UGl4ZWxzUHJvZ3Jlc3NpdmUoXHJcbiAgICAgICAgZmV0Y2hQYXJhbXMuaW1hZ2VQYXJ0UGFyYW1zLFxyXG4gICAgICAgIGNhbGxiYWNrLFxyXG4gICAgICAgIHRlcm1pbmF0ZWRDYWxsYmFjayxcclxuICAgICAgICBmZXRjaFBhcmFtc05vdE5lZWRlZCxcclxuICAgICAgICBtb3ZhYmxlSGFuZGxlKTtcclxuICAgIFxyXG4gICAgZnVuY3Rpb24gY2FsbGJhY2soZGVjb2RlZCkge1xyXG4gICAgICAgIHNlbGYuX3RpbGVzRGVjb2RlZENhbGxiYWNrKFxyXG4gICAgICAgICAgICByZWdpb25JZCxcclxuICAgICAgICAgICAgZmV0Y2hQYXJhbXMsXHJcbiAgICAgICAgICAgIHBvc2l0aW9uLFxyXG4gICAgICAgICAgICBkZWNvZGVkKTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgZnVuY3Rpb24gdGVybWluYXRlZENhbGxiYWNrKGlzQWJvcnRlZCkge1xyXG4gICAgICAgIGlmIChpc0Fib3J0ZWQgJiZcclxuICAgICAgICAgICAgaW1hZ2VQYXJ0UGFyYW1zLnJlcXVlc3RQcmlvcml0eURhdGEub3ZlcnJpZGVIaWdoZXN0UHJpb3JpdHkpIHtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIE5PVEU6IEJ1ZyBpbiBrZHVfc2VydmVyIGNhdXNlcyBmaXJzdCByZXF1ZXN0IHRvIGJlIHNlbnQgd3JvbmdseS5cclxuICAgICAgICAgICAgLy8gVGhlbiBDaHJvbWUgcmFpc2VzIEVSUl9JTlZBTElEX0NIVU5LRURfRU5DT0RJTkcgYW5kIHRoZSByZXF1ZXN0XHJcbiAgICAgICAgICAgIC8vIG5ldmVyIHJldHVybnMuIFRodXMgcGVyZm9ybSBzZWNvbmQgcmVxdWVzdC5cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHNlbGYuX2ltYWdlLnJlcXVlc3RQaXhlbHNQcm9ncmVzc2l2ZShcclxuICAgICAgICAgICAgICAgIGZldGNoUGFyYW1zLmltYWdlUGFydFBhcmFtcyxcclxuICAgICAgICAgICAgICAgIGNhbGxiYWNrLFxyXG4gICAgICAgICAgICAgICAgdGVybWluYXRlZENhbGxiYWNrLFxyXG4gICAgICAgICAgICAgICAgZmV0Y2hQYXJhbXNOb3ROZWVkZWQpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBzZWxmLl9mZXRjaFRlcm1pbmF0ZWRDYWxsYmFjayhcclxuICAgICAgICAgICAgcmVnaW9uSWQsXHJcbiAgICAgICAgICAgIGZldGNoUGFyYW1zLmltYWdlUGFydFBhcmFtcy5yZXF1ZXN0UHJpb3JpdHlEYXRhLFxyXG4gICAgICAgICAgICBpc0Fib3J0ZWQsXHJcbiAgICAgICAgICAgIHN0YXJ0RHluYW1pY1JlZ2lvbk9uVGVybWluYXRpb24pO1xyXG4gICAgfVxyXG59O1xyXG5cclxuSW1hZ2VWaWV3ZXIucHJvdG90eXBlLl9mZXRjaFRlcm1pbmF0ZWRDYWxsYmFjayA9IGZ1bmN0aW9uIGZldGNoVGVybWluYXRlZENhbGxiYWNrKFxyXG4gICAgcmVnaW9uSWQsIHByaW9yaXR5RGF0YSwgaXNBYm9ydGVkLCBzdGFydER5bmFtaWNSZWdpb25PblRlcm1pbmF0aW9uKSB7XHJcbiAgICBcclxuICAgIHZhciByZWdpb24gPSB0aGlzLl9yZWdpb25zW3JlZ2lvbklkXTtcclxuICAgIGlmIChyZWdpb24gPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIFxyXG4gICAgaWYgKCFwcmlvcml0eURhdGEub3ZlcnJpZGVIaWdoZXN0UHJpb3JpdHkgJiZcclxuICAgICAgICBwcmlvcml0eURhdGEucmVxdWVzdEluZGV4ICE9PSB0aGlzLl9sYXN0UmVxdWVzdEluZGV4KSB7XHJcbiAgICBcclxuICAgICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHJlZ2lvbi5pc0RvbmUgPSAhaXNBYm9ydGVkICYmIHRoaXMuX2lzUmVhZHk7XHJcblx0aWYgKHJlZ2lvbi5pc0RvbmUpIHtcclxuXHRcdHJlZ2lvbi5kb25lUGFydFBhcmFtcyA9IHJlZ2lvbi5pbWFnZVBhcnRQYXJhbXM7XHJcblx0fVxyXG4gICAgXHJcbiAgICBpZiAoc3RhcnREeW5hbWljUmVnaW9uT25UZXJtaW5hdGlvbikge1xyXG4gICAgICAgIHRoaXMuX2ltYWdlLmNyZWF0ZU1vdmFibGVGZXRjaCgpLnRoZW4odGhpcy5fY3JlYXRlZE1vdmFibGVGZXRjaEJvdW5kKTtcclxuICAgIH1cclxufTtcclxuXHJcbkltYWdlVmlld2VyLnByb3RvdHlwZS5fY3JlYXRlZE1vdmFibGVGZXRjaCA9IGZ1bmN0aW9uIGNyZWF0ZWRNb3ZhYmxlRmV0Y2gobW92YWJsZUhhbmRsZSkge1xyXG4gICAgdGhpcy5fbW92YWJsZUhhbmRsZSA9IG1vdmFibGVIYW5kbGU7XHJcbiAgICB0aGlzLl9zdGFydFNob3dpbmdEeW5hbWljUmVnaW9uKCk7XHJcbn07XHJcblxyXG5JbWFnZVZpZXdlci5wcm90b3R5cGUuX3N0YXJ0U2hvd2luZ0R5bmFtaWNSZWdpb24gPSBmdW5jdGlvbiBzdGFydFNob3dpbmdEeW5hbWljUmVnaW9uKCkge1xyXG4gICAgdGhpcy5fY2FuU2hvd0R5bmFtaWNSZWdpb24gPSB0cnVlO1xyXG4gICAgXHJcbiAgICBpZiAodGhpcy5fcGVuZGluZ1VwZGF0ZVZpZXdBcmVhICE9PSBudWxsKSB7XHJcbiAgICAgICAgdGhpcy51cGRhdGVWaWV3QXJlYSh0aGlzLl9wZW5kaW5nVXBkYXRlVmlld0FyZWEpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHRoaXMuX3BlbmRpbmdVcGRhdGVWaWV3QXJlYSA9IG51bGw7XHJcbiAgICB9XHJcbn07XHJcblxyXG5JbWFnZVZpZXdlci5wcm90b3R5cGUuX3RpbGVzRGVjb2RlZENhbGxiYWNrID0gZnVuY3Rpb24gdGlsZXNEZWNvZGVkQ2FsbGJhY2soXHJcbiAgICByZWdpb25JZCwgZmV0Y2hQYXJhbXMsIHBvc2l0aW9uLCBkZWNvZGVkKSB7XHJcbiAgICBcclxuICAgIGlmICghdGhpcy5faXNSZWFkeSkge1xyXG4gICAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIFxyXG4gICAgdmFyIHJlZ2lvbiA9IHRoaXMuX3JlZ2lvbnNbcmVnaW9uSWRdO1xyXG4gICAgaWYgKHJlZ2lvbiA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgcmVnaW9uID0ge307XHJcbiAgICAgICAgdGhpcy5fcmVnaW9uc1tyZWdpb25JZF0gPSByZWdpb247XHJcbiAgICAgICAgXHJcbiAgICAgICAgc3dpdGNoIChyZWdpb25JZCkge1xyXG4gICAgICAgICAgICBjYXNlIFJFR0lPTl9EWU5BTUlDOlxyXG4gICAgICAgICAgICAgICAgcmVnaW9uLmNhbnZhcyA9IHRoaXMuX3RhcmdldENhbnZhcztcclxuICAgICAgICAgICAgICAgIGJyZWFrO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGNhc2UgUkVHSU9OX09WRVJWSUVXOlxyXG4gICAgICAgICAgICAgICAgcmVnaW9uLmNhbnZhcyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2NhbnZhcycpO1xyXG4gICAgICAgICAgICAgICAgYnJlYWs7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBkZWZhdWx0OlxyXG4gICAgICAgICAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogVW5leHBlY3RlZCByZWdpb25JZCAnICsgcmVnaW9uSWQ7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgXHJcbiAgICB2YXIgcGFydFBhcmFtcyA9IGZldGNoUGFyYW1zLmltYWdlUGFydFBhcmFtcztcclxuICAgIGlmICghcGFydFBhcmFtcy5yZXF1ZXN0UHJpb3JpdHlEYXRhLm92ZXJyaWRlSGlnaGVzdFByaW9yaXR5ICYmXHJcbiAgICAgICAgcGFydFBhcmFtcy5yZXF1ZXN0UHJpb3JpdHlEYXRhLnJlcXVlc3RJbmRleCA8IHJlZ2lvbi5jdXJyZW50RGlzcGxheVJlcXVlc3RJbmRleCkge1xyXG4gICAgICAgIFxyXG4gICAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIFxyXG4gICAgdGhpcy5fY2hlY2tJZlJlcG9zaXRpb25OZWVkZWQocmVnaW9uLCBwYXJ0UGFyYW1zLCBwb3NpdGlvbik7XHJcbiAgICAgICAgXHJcbiAgICB0aGlzLl9wZW5kaW5nQ2FsbGJhY2tDYWxscy5wdXNoKHtcclxuICAgICAgICB0eXBlOiBQRU5ESU5HX0NBTExfVFlQRV9QSVhFTFNfVVBEQVRFRCxcclxuICAgICAgICByZWdpb246IHJlZ2lvbixcclxuICAgICAgICBkZWNvZGVkOiBkZWNvZGVkXHJcbiAgICB9KTtcclxuICAgIFxyXG4gICAgdGhpcy5fbm90aWZ5TmV3UGVuZGluZ0NhbGxzKCk7XHJcbn07XHJcblxyXG5JbWFnZVZpZXdlci5wcm90b3R5cGUuX2NoZWNrSWZSZXBvc2l0aW9uTmVlZGVkID0gZnVuY3Rpb24gY2hlY2tJZlJlcG9zaXRpb25OZWVkZWQoXHJcbiAgICByZWdpb24sIG5ld1BhcnRQYXJhbXMsIG5ld1Bvc2l0aW9uKSB7XHJcbiAgICBcclxuICAgIHZhciBvbGRQYXJ0UGFyYW1zID0gcmVnaW9uLmltYWdlUGFydFBhcmFtcztcclxuXHR2YXIgb2xkRG9uZVBhcnRQYXJhbXMgPSByZWdpb24uZG9uZVBhcnRQYXJhbXM7XHJcbiAgICB2YXIgbGV2ZWwgPSBuZXdQYXJ0UGFyYW1zLmxldmVsO1xyXG4gICAgXHJcbiAgICB2YXIgbmVlZFJlcG9zaXRpb24gPVxyXG4gICAgICAgIG9sZFBhcnRQYXJhbXMgPT09IHVuZGVmaW5lZCB8fFxyXG4gICAgICAgIG9sZFBhcnRQYXJhbXMubWluWCAhPT0gbmV3UGFydFBhcmFtcy5taW5YIHx8XHJcbiAgICAgICAgb2xkUGFydFBhcmFtcy5taW5ZICE9PSBuZXdQYXJ0UGFyYW1zLm1pblkgfHxcclxuICAgICAgICBvbGRQYXJ0UGFyYW1zLm1heFhFeGNsdXNpdmUgIT09IG5ld1BhcnRQYXJhbXMubWF4WEV4Y2x1c2l2ZSB8fFxyXG4gICAgICAgIG9sZFBhcnRQYXJhbXMubWF4WUV4Y2x1c2l2ZSAhPT0gbmV3UGFydFBhcmFtcy5tYXhZRXhjbHVzaXZlIHx8XHJcbiAgICAgICAgb2xkUGFydFBhcmFtcy5sZXZlbCAhPT0gbGV2ZWw7XHJcbiAgICBcclxuICAgIGlmICghbmVlZFJlcG9zaXRpb24pIHtcclxuICAgICAgICByZXR1cm4gZmFsc2U7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHZhciBjb3B5RGF0YTtcclxuICAgIHZhciBpbnRlcnNlY3Rpb247XHJcblx0dmFyIG5ld0RvbmVQYXJ0UGFyYW1zO1xyXG4gICAgdmFyIHJldXNlT2xkRGF0YSA9IGZhbHNlO1xyXG4gICAgdmFyIHNjYWxlWDtcclxuICAgIHZhciBzY2FsZVk7XHJcbiAgICBpZiAob2xkUGFydFBhcmFtcyAhPT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgc2NhbGVYID0gbmV3UGFydFBhcmFtcy5sZXZlbFdpZHRoICAvIG9sZFBhcnRQYXJhbXMubGV2ZWxXaWR0aDtcclxuICAgICAgICBzY2FsZVkgPSBuZXdQYXJ0UGFyYW1zLmxldmVsSGVpZ2h0IC8gb2xkUGFydFBhcmFtcy5sZXZlbEhlaWdodDtcclxuICAgICAgICBcclxuICAgICAgICBpbnRlcnNlY3Rpb24gPSB7XHJcbiAgICAgICAgICAgIG1pblg6IE1hdGgubWF4KG9sZFBhcnRQYXJhbXMubWluWCAqIHNjYWxlWCwgbmV3UGFydFBhcmFtcy5taW5YKSxcclxuICAgICAgICAgICAgbWluWTogTWF0aC5tYXgob2xkUGFydFBhcmFtcy5taW5ZICogc2NhbGVZLCBuZXdQYXJ0UGFyYW1zLm1pblkpLFxyXG4gICAgICAgICAgICBtYXhYOiBNYXRoLm1pbihvbGRQYXJ0UGFyYW1zLm1heFhFeGNsdXNpdmUgKiBzY2FsZVgsIG5ld1BhcnRQYXJhbXMubWF4WEV4Y2x1c2l2ZSksXHJcbiAgICAgICAgICAgIG1heFk6IE1hdGgubWluKG9sZFBhcnRQYXJhbXMubWF4WUV4Y2x1c2l2ZSAqIHNjYWxlWSwgbmV3UGFydFBhcmFtcy5tYXhZRXhjbHVzaXZlKVxyXG4gICAgICAgIH07XHJcbiAgICAgICAgcmV1c2VPbGREYXRhID1cclxuICAgICAgICAgICAgaW50ZXJzZWN0aW9uLm1heFggPiBpbnRlcnNlY3Rpb24ubWluWCAmJlxyXG4gICAgICAgICAgICBpbnRlcnNlY3Rpb24ubWF4WSA+IGludGVyc2VjdGlvbi5taW5ZO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBpZiAocmV1c2VPbGREYXRhKSB7XHJcbiAgICAgICAgY29weURhdGEgPSB7XHJcbiAgICAgICAgICAgIGZyb21YOiBpbnRlcnNlY3Rpb24ubWluWCAvIHNjYWxlWCAtIG9sZFBhcnRQYXJhbXMubWluWCxcclxuICAgICAgICAgICAgZnJvbVk6IGludGVyc2VjdGlvbi5taW5ZIC8gc2NhbGVZIC0gb2xkUGFydFBhcmFtcy5taW5ZLFxyXG4gICAgICAgICAgICBmcm9tV2lkdGggOiAoaW50ZXJzZWN0aW9uLm1heFggLSBpbnRlcnNlY3Rpb24ubWluWCkgLyBzY2FsZVgsXHJcbiAgICAgICAgICAgIGZyb21IZWlnaHQ6IChpbnRlcnNlY3Rpb24ubWF4WSAtIGludGVyc2VjdGlvbi5taW5ZKSAvIHNjYWxlWSxcclxuICAgICAgICAgICAgdG9YOiBpbnRlcnNlY3Rpb24ubWluWCAtIG5ld1BhcnRQYXJhbXMubWluWCxcclxuICAgICAgICAgICAgdG9ZOiBpbnRlcnNlY3Rpb24ubWluWSAtIG5ld1BhcnRQYXJhbXMubWluWSxcclxuICAgICAgICAgICAgdG9XaWR0aCA6IGludGVyc2VjdGlvbi5tYXhYIC0gaW50ZXJzZWN0aW9uLm1pblgsXHJcbiAgICAgICAgICAgIHRvSGVpZ2h0OiBpbnRlcnNlY3Rpb24ubWF4WSAtIGludGVyc2VjdGlvbi5taW5ZLFxyXG4gICAgICAgIH07XHJcblx0XHJcblx0XHRpZiAob2xkRG9uZVBhcnRQYXJhbXMgJiYgb2xkUGFydFBhcmFtcy5sZXZlbCA9PT0gbGV2ZWwpIHtcclxuXHRcdFx0bmV3RG9uZVBhcnRQYXJhbXMgPSB7XHJcblx0XHRcdFx0bWluWDogTWF0aC5tYXgob2xkRG9uZVBhcnRQYXJhbXMubWluWCwgbmV3UGFydFBhcmFtcy5taW5YKSxcclxuXHRcdFx0XHRtaW5ZOiBNYXRoLm1heChvbGREb25lUGFydFBhcmFtcy5taW5ZLCBuZXdQYXJ0UGFyYW1zLm1pblkpLFxyXG5cdFx0XHRcdG1heFhFeGNsdXNpdmU6IE1hdGgubWluKG9sZERvbmVQYXJ0UGFyYW1zLm1heFhFeGNsdXNpdmUsIG5ld1BhcnRQYXJhbXMubWF4WEV4Y2x1c2l2ZSksXHJcblx0XHRcdFx0bWF4WUV4Y2x1c2l2ZTogTWF0aC5taW4ob2xkRG9uZVBhcnRQYXJhbXMubWF4WUV4Y2x1c2l2ZSwgbmV3UGFydFBhcmFtcy5tYXhZRXhjbHVzaXZlKVxyXG5cdFx0XHR9O1xyXG5cdFx0fVxyXG5cdH1cclxuICAgIFxyXG4gICAgcmVnaW9uLmltYWdlUGFydFBhcmFtcyA9IG5ld1BhcnRQYXJhbXM7XHJcbiAgICByZWdpb24uaXNEb25lID0gZmFsc2U7XHJcbiAgICByZWdpb24uY3VycmVudERpc3BsYXlSZXF1ZXN0SW5kZXggPSBuZXdQYXJ0UGFyYW1zLnJlcXVlc3RQcmlvcml0eURhdGEucmVxdWVzdEluZGV4O1xyXG4gICAgXHJcbiAgICB2YXIgcmVwb3NpdGlvbkFyZ3MgPSB7XHJcbiAgICAgICAgdHlwZTogUEVORElOR19DQUxMX1RZUEVfUkVQT1NJVElPTixcclxuICAgICAgICByZWdpb246IHJlZ2lvbixcclxuICAgICAgICBwb3NpdGlvbjogbmV3UG9zaXRpb24sXHJcblx0XHRkb25lUGFydFBhcmFtczogbmV3RG9uZVBhcnRQYXJhbXMsXHJcbiAgICAgICAgY29weURhdGE6IGNvcHlEYXRhLFxyXG4gICAgICAgIHBpeGVsc1dpZHRoOiBuZXdQYXJ0UGFyYW1zLm1heFhFeGNsdXNpdmUgLSBuZXdQYXJ0UGFyYW1zLm1pblgsXHJcbiAgICAgICAgcGl4ZWxzSGVpZ2h0OiBuZXdQYXJ0UGFyYW1zLm1heFlFeGNsdXNpdmUgLSBuZXdQYXJ0UGFyYW1zLm1pbllcclxuICAgIH07XHJcbiAgICBcclxuICAgIHRoaXMuX3BlbmRpbmdDYWxsYmFja0NhbGxzLnB1c2gocmVwb3NpdGlvbkFyZ3MpO1xyXG4gICAgXHJcbiAgICByZXR1cm4gdHJ1ZTtcclxufTtcclxuXHJcbkltYWdlVmlld2VyLnByb3RvdHlwZS5fbm90aWZ5TmV3UGVuZGluZ0NhbGxzID0gZnVuY3Rpb24gbm90aWZ5TmV3UGVuZGluZ0NhbGxzKCkge1xyXG4gICAgaWYgKCF0aGlzLl9pc05lYXJDYWxsYmFja0NhbGxlZCkge1xyXG4gICAgICAgIHRoaXMuX2NhbGxQZW5kaW5nQ2FsbGJhY2tzKCk7XHJcbiAgICB9XHJcbn07XHJcblxyXG5JbWFnZVZpZXdlci5wcm90b3R5cGUuX2NhbGxQZW5kaW5nQ2FsbGJhY2tzID0gZnVuY3Rpb24gY2FsbFBlbmRpbmdDYWxsYmFja3MoKSB7XHJcbiAgICBpZiAodGhpcy5fcGVuZGluZ0NhbGxiYWNrQ2FsbHMubGVuZ3RoID09PSAwIHx8ICF0aGlzLl9pc1JlYWR5KSB7XHJcbiAgICAgICAgdGhpcy5faXNOZWFyQ2FsbGJhY2tDYWxsZWQgPSBmYWxzZTtcclxuICAgICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGlmICh0aGlzLl9pc05lYXJDYWxsYmFja0NhbGxlZCkge1xyXG4gICAgICAgIGNsZWFyVGltZW91dCh0aGlzLl9wZW5kaW5nQ2FsbGJhY2tzSW50ZXJ2YWxIYW5kbGUpO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBpZiAodGhpcy5fbWluRnVuY3Rpb25DYWxsSW50ZXJ2YWxNaWxsaXNlY29uZHMgIT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIHRoaXMuX3BlbmRpbmdDYWxsYmFja3NJbnRlcnZhbEhhbmRsZSA9XHJcbiAgICAgICAgICAgIHNldFRpbWVvdXQodGhpcy5fY2FsbFBlbmRpbmdDYWxsYmFja3NCb3VuZCxcclxuICAgICAgICAgICAgdGhpcy5fbWluRnVuY3Rpb25DYWxsSW50ZXJ2YWxNaWxsaXNlY29uZHMpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICB0aGlzLl9pc05lYXJDYWxsYmFja0NhbGxlZCA9IHRydWU7XHJcbiAgICB9XHJcblxyXG4gICAgdmFyIG5ld1Bvc2l0aW9uID0gbnVsbDtcclxuICAgIFxyXG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCB0aGlzLl9wZW5kaW5nQ2FsbGJhY2tDYWxscy5sZW5ndGg7ICsraSkge1xyXG4gICAgICAgIHZhciBjYWxsQXJncyA9IHRoaXMuX3BlbmRpbmdDYWxsYmFja0NhbGxzW2ldO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGlmIChjYWxsQXJncy50eXBlID09PSBQRU5ESU5HX0NBTExfVFlQRV9SRVBPU0lUSU9OKSB7XHJcbiAgICAgICAgICAgIHRoaXMuX3JlcG9zaXRpb25DYW52YXMoY2FsbEFyZ3MpO1xyXG4gICAgICAgICAgICBuZXdQb3NpdGlvbiA9IGNhbGxBcmdzLnBvc2l0aW9uO1xyXG4gICAgICAgIH0gZWxzZSBpZiAoY2FsbEFyZ3MudHlwZSA9PT0gUEVORElOR19DQUxMX1RZUEVfUElYRUxTX1VQREFURUQpIHtcclxuICAgICAgICAgICAgdGhpcy5fcGl4ZWxzVXBkYXRlZChjYWxsQXJncyk7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogSW50ZXJuYWwgSW1hZ2VWaWV3ZXIgRXJyb3I6IFVuZXhwZWN0ZWQgY2FsbCB0eXBlICcgK1xyXG4gICAgICAgICAgICAgICAgY2FsbEFyZ3MudHlwZTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHRoaXMuX3BlbmRpbmdDYWxsYmFja0NhbGxzLmxlbmd0aCA9IDA7XHJcbiAgICBcclxuICAgIHRoaXMuX2NhbnZhc1VwZGF0ZWRDYWxsYmFjayhuZXdQb3NpdGlvbik7XHJcbn07XHJcblxyXG5JbWFnZVZpZXdlci5wcm90b3R5cGUuX3BpeGVsc1VwZGF0ZWQgPSBmdW5jdGlvbiBwaXhlbHNVcGRhdGVkKHBpeGVsc1VwZGF0ZWRBcmdzKSB7XHJcbiAgICB2YXIgcmVnaW9uID0gcGl4ZWxzVXBkYXRlZEFyZ3MucmVnaW9uO1xyXG4gICAgdmFyIGRlY29kZWQgPSBwaXhlbHNVcGRhdGVkQXJncy5kZWNvZGVkO1xyXG4gICAgaWYgKGRlY29kZWQuaW1hZ2VEYXRhLndpZHRoID09PSAwIHx8IGRlY29kZWQuaW1hZ2VEYXRhLmhlaWdodCA9PT0gMCkge1xyXG4gICAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIFxyXG4gICAgdmFyIHggPSBkZWNvZGVkLnhJbk9yaWdpbmFsUmVxdWVzdDtcclxuICAgIHZhciB5ID0gZGVjb2RlZC55SW5PcmlnaW5hbFJlcXVlc3Q7XHJcbiAgICBcclxuICAgIHZhciBjb250ZXh0ID0gcmVnaW9uLmNhbnZhcy5nZXRDb250ZXh0KCcyZCcpO1xyXG4gICAgLy92YXIgaW1hZ2VEYXRhID0gY29udGV4dC5jcmVhdGVJbWFnZURhdGEoZGVjb2RlZC53aWR0aCwgZGVjb2RlZC5oZWlnaHQpO1xyXG4gICAgLy9pbWFnZURhdGEuZGF0YS5zZXQoZGVjb2RlZC5waXhlbHMpO1xyXG4gICAgXHJcbiAgICBjb250ZXh0LnB1dEltYWdlRGF0YShkZWNvZGVkLmltYWdlRGF0YSwgeCwgeSk7XHJcbn07XHJcblxyXG5JbWFnZVZpZXdlci5wcm90b3R5cGUuX3JlcG9zaXRpb25DYW52YXMgPSBmdW5jdGlvbiByZXBvc2l0aW9uQ2FudmFzKHJlcG9zaXRpb25BcmdzKSB7XHJcbiAgICB2YXIgcmVnaW9uID0gcmVwb3NpdGlvbkFyZ3MucmVnaW9uO1xyXG4gICAgdmFyIHBvc2l0aW9uID0gcmVwb3NpdGlvbkFyZ3MucG9zaXRpb247XHJcblx0dmFyIGRvbmVQYXJ0UGFyYW1zID0gcmVwb3NpdGlvbkFyZ3MuZG9uZVBhcnRQYXJhbXM7XHJcbiAgICB2YXIgY29weURhdGEgPSByZXBvc2l0aW9uQXJncy5jb3B5RGF0YTtcclxuICAgIHZhciBwaXhlbHNXaWR0aCA9IHJlcG9zaXRpb25BcmdzLnBpeGVsc1dpZHRoO1xyXG4gICAgdmFyIHBpeGVsc0hlaWdodCA9IHJlcG9zaXRpb25BcmdzLnBpeGVsc0hlaWdodDtcclxuICAgIFxyXG4gICAgdmFyIGltYWdlRGF0YVRvQ29weTtcclxuICAgIHZhciBjb250ZXh0ID0gcmVnaW9uLmNhbnZhcy5nZXRDb250ZXh0KCcyZCcpO1xyXG4gICAgXHJcbiAgICBpZiAoY29weURhdGEgIT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIGlmIChjb3B5RGF0YS5mcm9tV2lkdGggPT09IGNvcHlEYXRhLnRvV2lkdGggJiYgY29weURhdGEuZnJvbUhlaWdodCA9PT0gY29weURhdGEudG9IZWlnaHQpIHtcclxuICAgICAgICAgICAgaW1hZ2VEYXRhVG9Db3B5ID0gY29udGV4dC5nZXRJbWFnZURhdGEoXHJcbiAgICAgICAgICAgICAgICBjb3B5RGF0YS5mcm9tWCwgY29weURhdGEuZnJvbVksIGNvcHlEYXRhLmZyb21XaWR0aCwgY29weURhdGEuZnJvbUhlaWdodCk7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgaWYgKCF0aGlzLl90bXBDYW52YXMpIHtcclxuICAgICAgICAgICAgICAgIHRoaXMuX3RtcENhbnZhcyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2NhbnZhcycpO1xyXG4gICAgICAgICAgICAgICAgdGhpcy5fdG1wQ2FudmFzQ29udGV4dCA9IHRoaXMuX3RtcENhbnZhcy5nZXRDb250ZXh0KCcyZCcpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICB0aGlzLl90bXBDYW52YXMud2lkdGggID0gY29weURhdGEudG9XaWR0aDtcclxuICAgICAgICAgICAgdGhpcy5fdG1wQ2FudmFzLmhlaWdodCA9IGNvcHlEYXRhLnRvSGVpZ2h0O1xyXG4gICAgICAgICAgICB0aGlzLl90bXBDYW52YXNDb250ZXh0LmRyYXdJbWFnZShcclxuICAgICAgICAgICAgICAgIHJlZ2lvbi5jYW52YXMsXHJcbiAgICAgICAgICAgICAgICBjb3B5RGF0YS5mcm9tWCwgY29weURhdGEuZnJvbVksIGNvcHlEYXRhLmZyb21XaWR0aCwgY29weURhdGEuZnJvbUhlaWdodCxcclxuICAgICAgICAgICAgICAgIDAsIDAsIGNvcHlEYXRhLnRvV2lkdGgsIGNvcHlEYXRhLnRvSGVpZ2h0KTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGltYWdlRGF0YVRvQ29weSA9IHRoaXMuX3RtcENhbnZhc0NvbnRleHQuZ2V0SW1hZ2VEYXRhKFxyXG4gICAgICAgICAgICAgICAgMCwgMCwgY29weURhdGEudG9XaWR0aCwgY29weURhdGEudG9IZWlnaHQpO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuICAgIFxyXG4gICAgcmVnaW9uLmNhbnZhcy53aWR0aCA9IHBpeGVsc1dpZHRoO1xyXG4gICAgcmVnaW9uLmNhbnZhcy5oZWlnaHQgPSBwaXhlbHNIZWlnaHQ7XHJcbiAgICBcclxuICAgIGlmIChyZWdpb24gIT09IHRoaXMuX3JlZ2lvbnNbUkVHSU9OX09WRVJWSUVXXSkge1xyXG4gICAgICAgIHRoaXMuX2NvcHlPdmVydmlld1RvQ2FudmFzKFxyXG4gICAgICAgICAgICBjb250ZXh0LCBwb3NpdGlvbiwgcGl4ZWxzV2lkdGgsIHBpeGVsc0hlaWdodCk7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGlmIChjb3B5RGF0YSAhPT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgY29udGV4dC5wdXRJbWFnZURhdGEoaW1hZ2VEYXRhVG9Db3B5LCBjb3B5RGF0YS50b1gsIGNvcHlEYXRhLnRvWSk7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHJlZ2lvbi5wb3NpdGlvbiA9IHBvc2l0aW9uO1xyXG5cdHJlZ2lvbi5kb25lUGFydFBhcmFtcyA9IGRvbmVQYXJ0UGFyYW1zO1xyXG59O1xyXG5cclxuSW1hZ2VWaWV3ZXIucHJvdG90eXBlLl9jb3B5T3ZlcnZpZXdUb0NhbnZhcyA9IGZ1bmN0aW9uIGNvcHlPdmVydmlld1RvQ2FudmFzKFxyXG4gICAgY29udGV4dCwgY2FudmFzUG9zaXRpb24sIGNhbnZhc1BpeGVsc1dpZHRoLCBjYW52YXNQaXhlbHNIZWlnaHQpIHtcclxuICAgIFxyXG4gICAgdmFyIHNvdXJjZVBvc2l0aW9uID0gdGhpcy5fcmVnaW9uc1tSRUdJT05fT1ZFUlZJRVddLnBvc2l0aW9uO1xyXG4gICAgdmFyIHNvdXJjZVBpeGVscyA9XHJcbiAgICAgICAgdGhpcy5fcmVnaW9uc1tSRUdJT05fT1ZFUlZJRVddLmltYWdlUGFydFBhcmFtcztcclxuICAgIFxyXG4gICAgdmFyIHNvdXJjZVBpeGVsc1dpZHRoID1cclxuICAgICAgICBzb3VyY2VQaXhlbHMubWF4WEV4Y2x1c2l2ZSAtIHNvdXJjZVBpeGVscy5taW5YO1xyXG4gICAgdmFyIHNvdXJjZVBpeGVsc0hlaWdodCA9XHJcbiAgICAgICAgc291cmNlUGl4ZWxzLm1heFlFeGNsdXNpdmUgLSBzb3VyY2VQaXhlbHMubWluWTtcclxuICAgIFxyXG4gICAgdmFyIHNvdXJjZVBvc2l0aW9uV2lkdGggPVxyXG4gICAgICAgIHNvdXJjZVBvc2l0aW9uLmVhc3QgLSBzb3VyY2VQb3NpdGlvbi53ZXN0O1xyXG4gICAgdmFyIHNvdXJjZVBvc2l0aW9uSGVpZ2h0ID1cclxuICAgICAgICBzb3VyY2VQb3NpdGlvbi5ub3J0aCAtIHNvdXJjZVBvc2l0aW9uLnNvdXRoO1xyXG4gICAgICAgIFxyXG4gICAgdmFyIHNvdXJjZVJlc29sdXRpb25YID1cclxuICAgICAgICBzb3VyY2VQaXhlbHNXaWR0aCAvIHNvdXJjZVBvc2l0aW9uV2lkdGg7XHJcbiAgICB2YXIgc291cmNlUmVzb2x1dGlvblkgPVxyXG4gICAgICAgIHNvdXJjZVBpeGVsc0hlaWdodCAvIHNvdXJjZVBvc2l0aW9uSGVpZ2h0O1xyXG4gICAgXHJcbiAgICB2YXIgdGFyZ2V0UG9zaXRpb25XaWR0aCA9XHJcbiAgICAgICAgY2FudmFzUG9zaXRpb24uZWFzdCAtIGNhbnZhc1Bvc2l0aW9uLndlc3Q7XHJcbiAgICB2YXIgdGFyZ2V0UG9zaXRpb25IZWlnaHQgPVxyXG4gICAgICAgIGNhbnZhc1Bvc2l0aW9uLm5vcnRoIC0gY2FudmFzUG9zaXRpb24uc291dGg7XHJcbiAgICAgICAgXHJcbiAgICB2YXIgY3JvcFdpZHRoID0gdGFyZ2V0UG9zaXRpb25XaWR0aCAqIHNvdXJjZVJlc29sdXRpb25YO1xyXG4gICAgdmFyIGNyb3BIZWlnaHQgPSB0YXJnZXRQb3NpdGlvbkhlaWdodCAqIHNvdXJjZVJlc29sdXRpb25ZO1xyXG4gICAgXHJcbiAgICB2YXIgY3JvcE9mZnNldFBvc2l0aW9uWCA9XHJcbiAgICAgICAgY2FudmFzUG9zaXRpb24ud2VzdCAtIHNvdXJjZVBvc2l0aW9uLndlc3Q7XHJcbiAgICB2YXIgY3JvcE9mZnNldFBvc2l0aW9uWSA9XHJcbiAgICAgICAgc291cmNlUG9zaXRpb24ubm9ydGggLSBjYW52YXNQb3NpdGlvbi5ub3J0aDtcclxuICAgICAgICBcclxuICAgIHZhciBjcm9wUGl4ZWxPZmZzZXRYID0gY3JvcE9mZnNldFBvc2l0aW9uWCAqIHNvdXJjZVJlc29sdXRpb25YO1xyXG4gICAgdmFyIGNyb3BQaXhlbE9mZnNldFkgPSBjcm9wT2Zmc2V0UG9zaXRpb25ZICogc291cmNlUmVzb2x1dGlvblk7XHJcbiAgICBcclxuICAgIGNvbnRleHQuZHJhd0ltYWdlKFxyXG4gICAgICAgIHRoaXMuX3JlZ2lvbnNbUkVHSU9OX09WRVJWSUVXXS5jYW52YXMsXHJcbiAgICAgICAgY3JvcFBpeGVsT2Zmc2V0WCwgY3JvcFBpeGVsT2Zmc2V0WSwgY3JvcFdpZHRoLCBjcm9wSGVpZ2h0LFxyXG4gICAgICAgIDAsIDAsIGNhbnZhc1BpeGVsc1dpZHRoLCBjYW52YXNQaXhlbHNIZWlnaHQpO1xyXG59O1xyXG5cclxuSW1hZ2VWaWV3ZXIucHJvdG90eXBlLl9vcGVuZWQgPSBmdW5jdGlvbiBvcGVuZWQoKSB7XHJcbiAgICB0aGlzLl9pc1JlYWR5ID0gdHJ1ZTtcclxuICAgIFxyXG4gICAgdmFyIGZpeGVkQm91bmRzID0ge1xyXG4gICAgICAgIHdlc3Q6IHRoaXMuX2NhcnRvZ3JhcGhpY0JvdW5kcy53ZXN0LFxyXG4gICAgICAgIGVhc3Q6IHRoaXMuX2NhcnRvZ3JhcGhpY0JvdW5kcy5lYXN0LFxyXG4gICAgICAgIHNvdXRoOiB0aGlzLl9jYXJ0b2dyYXBoaWNCb3VuZHMuc291dGgsXHJcbiAgICAgICAgbm9ydGg6IHRoaXMuX2NhcnRvZ3JhcGhpY0JvdW5kcy5ub3J0aFxyXG4gICAgfTtcclxuICAgIGltYWdlSGVscGVyRnVuY3Rpb25zLmZpeEJvdW5kcyhcclxuICAgICAgICBmaXhlZEJvdW5kcywgdGhpcy5faW1hZ2UsIHRoaXMuX2FkYXB0UHJvcG9ydGlvbnMpO1xyXG4gICAgdGhpcy5fY2FydG9ncmFwaGljQm91bmRzRml4ZWQgPSBmaXhlZEJvdW5kcztcclxuICAgIFxyXG4gICAgdmFyIGltYWdlV2lkdGggID0gdGhpcy5faW1hZ2UuZ2V0SW1hZ2VXaWR0aCAoKTtcclxuICAgIHZhciBpbWFnZUhlaWdodCA9IHRoaXMuX2ltYWdlLmdldEltYWdlSGVpZ2h0KCk7XHJcbiAgICB0aGlzLl9xdWFsaXR5ID0gdGhpcy5faW1hZ2UuZ2V0SGlnaGVzdFF1YWxpdHkoKTtcclxuXHJcbiAgICB2YXIgcmVjdGFuZ2xlV2lkdGggPSBmaXhlZEJvdW5kcy5lYXN0IC0gZml4ZWRCb3VuZHMud2VzdDtcclxuICAgIHZhciByZWN0YW5nbGVIZWlnaHQgPSBmaXhlZEJvdW5kcy5ub3J0aCAtIGZpeGVkQm91bmRzLnNvdXRoO1xyXG4gICAgdGhpcy5fc2NhbGVYID0gaW1hZ2VXaWR0aCAvIHJlY3RhbmdsZVdpZHRoO1xyXG4gICAgdGhpcy5fc2NhbGVZID0gLWltYWdlSGVpZ2h0IC8gcmVjdGFuZ2xlSGVpZ2h0O1xyXG4gICAgXHJcbiAgICB0aGlzLl90cmFuc2xhdGVYID0gLWZpeGVkQm91bmRzLndlc3QgKiB0aGlzLl9zY2FsZVg7XHJcbiAgICB0aGlzLl90cmFuc2xhdGVZID0gLWZpeGVkQm91bmRzLm5vcnRoICogdGhpcy5fc2NhbGVZO1xyXG4gICAgXHJcbiAgICB2YXIgb3ZlcnZpZXdQYXJhbXMgPSB7XHJcbiAgICAgICAgbWluWDogMCxcclxuICAgICAgICBtaW5ZOiAwLFxyXG4gICAgICAgIG1heFhFeGNsdXNpdmU6IGltYWdlV2lkdGgsXHJcbiAgICAgICAgbWF4WUV4Y2x1c2l2ZTogaW1hZ2VIZWlnaHQsXHJcbiAgICAgICAgc2NyZWVuV2lkdGg6IHRoaXMuX292ZXJ2aWV3UmVzb2x1dGlvblgsXHJcbiAgICAgICAgc2NyZWVuSGVpZ2h0OiB0aGlzLl9vdmVydmlld1Jlc29sdXRpb25ZXHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICB2YXIgb3ZlcnZpZXdBbGlnbmVkUGFyYW1zID1cclxuICAgICAgICBpbWFnZUhlbHBlckZ1bmN0aW9ucy5hbGlnblBhcmFtc1RvVGlsZXNBbmRMZXZlbChcclxuICAgICAgICAgICAgb3ZlcnZpZXdQYXJhbXMsIHRoaXMuX2ltYWdlLCB0aGlzLl9pbWFnZSk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgb3ZlcnZpZXdBbGlnbmVkUGFyYW1zLmltYWdlUGFydFBhcmFtcy5yZXF1ZXN0UHJpb3JpdHlEYXRhID1cclxuICAgICAgICBvdmVydmlld0FsaWduZWRQYXJhbXMuaW1hZ2VQYXJ0UGFyYW1zLnJlcXVlc3RQcmlvcml0eURhdGEgfHwge307XHJcbiAgICBcclxuICAgIG92ZXJ2aWV3QWxpZ25lZFBhcmFtcy5pbWFnZVBhcnRQYXJhbXMucmVxdWVzdFByaW9yaXR5RGF0YS5vdmVycmlkZUhpZ2hlc3RQcmlvcml0eSA9IHRydWU7XHJcbiAgICBvdmVydmlld0FsaWduZWRQYXJhbXMuaW1hZ2VQYXJ0UGFyYW1zLnF1YWxpdHkgPSB0aGlzLl9pbWFnZS5nZXRMb3dlc3RRdWFsaXR5KCk7XHJcbiAgICBcclxuICAgIHZhciBzdGFydER5bmFtaWNSZWdpb25PblRlcm1pbmF0aW9uID1cclxuICAgICAgICAhdGhpcy5fYWxsb3dNdWx0aXBsZU1vdmFibGVGZXRjaGVzSW5TZXNzaW9uO1xyXG4gICAgICAgIFxyXG4gICAgdGhpcy5fZmV0Y2goXHJcbiAgICAgICAgUkVHSU9OX09WRVJWSUVXLFxyXG4gICAgICAgIG92ZXJ2aWV3QWxpZ25lZFBhcmFtcyxcclxuICAgICAgICBzdGFydER5bmFtaWNSZWdpb25PblRlcm1pbmF0aW9uKTtcclxuICAgIFxyXG4gICAgaWYgKHRoaXMuX2FsbG93TXVsdGlwbGVNb3ZhYmxlRmV0Y2hlc0luU2Vzc2lvbikge1xyXG4gICAgICAgIHRoaXMuX3N0YXJ0U2hvd2luZ0R5bmFtaWNSZWdpb24oKTtcclxuICAgIH1cclxufTsiLCIndXNlIHN0cmljdCc7XHJcblxyXG52YXIgSW1hZ2VWaWV3ZXIgPSByZXF1aXJlKCdpbWFnZS12aWV3ZXIuanMnKTtcclxudmFyIGNhbGN1bGF0ZUxlYWZsZXRGcnVzdHVtID0gcmVxdWlyZSgnbGVhZmxldC1mcnVzdHVtLWNhbGN1bGF0b3IuanMnKTtcclxuXHJcbi8qIGdsb2JhbCBMOiBmYWxzZSAqL1xyXG4vKiBnbG9iYWwgc2VsZjogZmFsc2UgKi9cclxuXHJcbmlmIChzZWxmLkwpIHtcclxuICAgIG1vZHVsZS5leHBvcnRzID0gTC5DbGFzcy5leHRlbmQoY3JlYXRlSW1hZ2VEZWNvZGVyUmVnaW9uTGF5ZXJGdW5jdGlvbnMoKSk7XHJcbn0gZWxzZSB7XHJcbiAgICBtb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uKCkge1xyXG4gICAgICAgIHRocm93IG5ldyBFcnJvcignaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBDYW5ub3QgaW5zdGFudGlhdGUgSW1hZ2VEZWNvZGVyUmVnaW9uTGF5ZXI6IE5vIExlYWZsZXQgbmFtZXNwYWNlIGluIHNjb3BlJyk7XHJcbiAgICB9O1xyXG59XHJcblxyXG5mdW5jdGlvbiBjcmVhdGVJbWFnZURlY29kZXJSZWdpb25MYXllckZ1bmN0aW9ucygpIHtcclxuICAgIHJldHVybiB7XHJcbiAgICAgICAgaW5pdGlhbGl6ZTogZnVuY3Rpb24gaW5pdGlhbGl6ZShvcHRpb25zKSB7XHJcbiAgICAgICAgICAgIHRoaXMuX29wdGlvbnMgPSBvcHRpb25zIHx8IHt9O1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgaWYgKHRoaXMuX29wdGlvbnMubGF0TG5nQm91bmRzICE9PSB1bmRlZmluZWQpIHtcclxuICAgICAgICAgICAgICAgIHRoaXMuX29wdGlvbnMgPSB7fTtcclxuICAgICAgICAgICAgICAgIGZvciAodmFyIG1lbWJlciBpbiBvcHRpb25zKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5fb3B0aW9uc1ttZW1iZXJdID0gb3B0aW9uc1ttZW1iZXJdO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgdGhpcy5fb3B0aW9ucy5jYXJ0b2dyYXBoaWNCb3VuZHMgPSB7XHJcbiAgICAgICAgICAgICAgICAgICAgd2VzdDogb3B0aW9ucy5sYXRMbmdCb3VuZHMuZ2V0V2VzdCgpLFxyXG4gICAgICAgICAgICAgICAgICAgIGVhc3Q6IG9wdGlvbnMubGF0TG5nQm91bmRzLmdldEVhc3QoKSxcclxuICAgICAgICAgICAgICAgICAgICBzb3V0aDogb3B0aW9ucy5sYXRMbmdCb3VuZHMuZ2V0U291dGgoKSxcclxuICAgICAgICAgICAgICAgICAgICBub3J0aDogb3B0aW9ucy5sYXRMbmdCb3VuZHMuZ2V0Tm9ydGgoKVxyXG4gICAgICAgICAgICAgICAgfTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgdGhpcy5fdGFyZ2V0Q2FudmFzID0gbnVsbDtcclxuICAgICAgICAgICAgdGhpcy5fY2FudmFzUG9zaXRpb24gPSBudWxsO1xyXG4gICAgICAgICAgICB0aGlzLl9jYW52YXNVcGRhdGVkQ2FsbGJhY2tCb3VuZCA9IHRoaXMuX2NhbnZhc1VwZGF0ZWRDYWxsYmFjay5iaW5kKHRoaXMpO1xyXG4gICAgICAgICAgICB0aGlzLl9pbWFnZVZpZXdlciA9IG51bGw7XHJcbiAgICAgICAgICAgIHRoaXMuX2V4Y2VwdGlvbkNhbGxiYWNrID0gbnVsbDtcclxuICAgICAgICB9LFxyXG4gICAgICAgIFxyXG4gICAgICAgIHNldEV4Y2VwdGlvbkNhbGxiYWNrOiBmdW5jdGlvbiBzZXRFeGNlcHRpb25DYWxsYmFjayhleGNlcHRpb25DYWxsYmFjaykge1xyXG4gICAgICAgICAgICB0aGlzLl9leGNlcHRpb25DYWxsYmFjayA9IGV4Y2VwdGlvbkNhbGxiYWNrO1xyXG4gICAgICAgICAgICBpZiAodGhpcy5faW1hZ2VWaWV3ZXIgIT09IG51bGwpIHtcclxuICAgICAgICAgICAgICAgIHRoaXMuX2ltYWdlVmlld2VyLnNldEV4Y2VwdGlvbkNhbGxiYWNrKGV4Y2VwdGlvbkNhbGxiYWNrKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH0sXHJcbiAgICAgICAgXHJcbiAgICAgICAgX2NyZWF0ZUltYWdlOiBmdW5jdGlvbiBjcmVhdGVJbWFnZSgpIHtcclxuICAgICAgICAgICAgaWYgKHRoaXMuX2ltYWdlVmlld2VyID09PSBudWxsKSB7XHJcbiAgICAgICAgICAgICAgICB0aGlzLl9pbWFnZVZpZXdlciA9IG5ldyBJbWFnZVZpZXdlcihcclxuICAgICAgICAgICAgICAgICAgICB0aGlzLl9vcHRpb25zLmltYWdlLFxyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX2NhbnZhc1VwZGF0ZWRDYWxsYmFja0JvdW5kLFxyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX29wdGlvbnMpO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICBpZiAodGhpcy5fZXhjZXB0aW9uQ2FsbGJhY2sgIT09IG51bGwpIHtcclxuICAgICAgICAgICAgICAgICAgICB0aGlzLl9pbWFnZVZpZXdlci5zZXRFeGNlcHRpb25DYWxsYmFjayh0aGlzLl9leGNlcHRpb25DYWxsYmFjayk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIHRoaXMuX2ltYWdlVmlld2VyLm9wZW4odGhpcy5fb3B0aW9ucy51cmwpLmNhdGNoKHRoaXMuX2V4Y2VwdGlvbkNhbGxiYWNrKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH0sXHJcblxyXG4gICAgICAgIG9uQWRkOiBmdW5jdGlvbiBvbkFkZChtYXApIHtcclxuICAgICAgICAgICAgaWYgKHRoaXMuX21hcCAhPT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBDYW5ub3QgYWRkIHRoaXMgbGF5ZXIgdG8gdHdvIG1hcHMnO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICB0aGlzLl9tYXAgPSBtYXA7XHJcbiAgICAgICAgICAgIHRoaXMuX2NyZWF0ZUltYWdlKCk7XHJcblxyXG4gICAgICAgICAgICAvLyBjcmVhdGUgYSBET00gZWxlbWVudCBhbmQgcHV0IGl0IGludG8gb25lIG9mIHRoZSBtYXAgcGFuZXNcclxuICAgICAgICAgICAgdGhpcy5fdGFyZ2V0Q2FudmFzID0gTC5Eb21VdGlsLmNyZWF0ZShcclxuICAgICAgICAgICAgICAgICdjYW52YXMnLCAnaW1hZ2UtZGVjb2Rlci1sYXllci1jYW52YXMgbGVhZmxldC16b29tLWFuaW1hdGVkJyk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICB0aGlzLl9pbWFnZVZpZXdlci5zZXRUYXJnZXRDYW52YXModGhpcy5fdGFyZ2V0Q2FudmFzKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHRoaXMuX2NhbnZhc1Bvc2l0aW9uID0gbnVsbDtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBtYXAuZ2V0UGFuZXMoKS5tYXBQYW5lLmFwcGVuZENoaWxkKHRoaXMuX3RhcmdldENhbnZhcyk7XHJcblxyXG4gICAgICAgICAgICAvLyBhZGQgYSB2aWV3cmVzZXQgZXZlbnQgbGlzdGVuZXIgZm9yIHVwZGF0aW5nIGxheWVyJ3MgcG9zaXRpb24sIGRvIHRoZSBsYXR0ZXJcclxuICAgICAgICAgICAgbWFwLm9uKCd2aWV3cmVzZXQnLCB0aGlzLl9tb3ZlZCwgdGhpcyk7XHJcbiAgICAgICAgICAgIG1hcC5vbignbW92ZScsIHRoaXMuX21vdmVkLCB0aGlzKTtcclxuXHJcbiAgICAgICAgICAgIGlmIChMLkJyb3dzZXIuYW55M2QpIHtcclxuICAgICAgICAgICAgICAgIG1hcC5vbignem9vbWFuaW0nLCB0aGlzLl9hbmltYXRlWm9vbSwgdGhpcyk7XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIHRoaXMuX21vdmVkKCk7XHJcbiAgICAgICAgfSxcclxuXHJcbiAgICAgICAgb25SZW1vdmU6IGZ1bmN0aW9uIG9uUmVtb3ZlKG1hcCkge1xyXG4gICAgICAgICAgICBpZiAobWFwICE9PSB0aGlzLl9tYXApIHtcclxuICAgICAgICAgICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IFJlbW92ZWQgZnJvbSB3cm9uZyBtYXAnO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBtYXAub2ZmKCd2aWV3cmVzZXQnLCB0aGlzLl9tb3ZlZCwgdGhpcyk7XHJcbiAgICAgICAgICAgIG1hcC5vZmYoJ21vdmUnLCB0aGlzLl9tb3ZlZCwgdGhpcyk7XHJcbiAgICAgICAgICAgIG1hcC5vZmYoJ3pvb21hbmltJywgdGhpcy5fYW5pbWF0ZVpvb20sIHRoaXMpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gcmVtb3ZlIGxheWVyJ3MgRE9NIGVsZW1lbnRzIGFuZCBsaXN0ZW5lcnNcclxuICAgICAgICAgICAgbWFwLmdldFBhbmVzKCkubWFwUGFuZS5yZW1vdmVDaGlsZCh0aGlzLl90YXJnZXRDYW52YXMpO1xyXG4gICAgICAgICAgICB0aGlzLl90YXJnZXRDYW52YXMgPSBudWxsO1xyXG4gICAgICAgICAgICB0aGlzLl9jYW52YXNQb3NpdGlvbiA9IG51bGw7XHJcblxyXG4gICAgICAgICAgICB0aGlzLl9tYXAgPSB1bmRlZmluZWQ7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICB0aGlzLl9pbWFnZVZpZXdlci5jbG9zZSgpO1xyXG4gICAgICAgICAgICB0aGlzLl9pbWFnZVZpZXdlciA9IG51bGw7XHJcbiAgICAgICAgfSxcclxuICAgICAgICBcclxuICAgICAgICBfbW92ZWQ6IGZ1bmN0aW9uICgpIHtcclxuICAgICAgICAgICAgdGhpcy5fbW92ZUNhbnZhc2VzKCk7XHJcblxyXG4gICAgICAgICAgICB2YXIgZnJ1c3R1bURhdGEgPSBjYWxjdWxhdGVMZWFmbGV0RnJ1c3R1bSh0aGlzLl9tYXApO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgdGhpcy5faW1hZ2VWaWV3ZXIudXBkYXRlVmlld0FyZWEoZnJ1c3R1bURhdGEpO1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgXHJcbiAgICAgICAgX2NhbnZhc1VwZGF0ZWRDYWxsYmFjazogZnVuY3Rpb24gY2FudmFzVXBkYXRlZENhbGxiYWNrKG5ld1Bvc2l0aW9uKSB7XHJcbiAgICAgICAgICAgIGlmIChuZXdQb3NpdGlvbiAhPT0gbnVsbCkge1xyXG4gICAgICAgICAgICAgICAgdGhpcy5fY2FudmFzUG9zaXRpb24gPSBuZXdQb3NpdGlvbjtcclxuICAgICAgICAgICAgICAgIHRoaXMuX21vdmVDYW52YXNlcygpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfSxcclxuICAgICAgICBcclxuICAgICAgICBfbW92ZUNhbnZhc2VzOiBmdW5jdGlvbiBtb3ZlQ2FudmFzZXMoKSB7XHJcbiAgICAgICAgICAgIGlmICh0aGlzLl9jYW52YXNQb3NpdGlvbiA9PT0gbnVsbCkge1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIHVwZGF0ZSBsYXllcidzIHBvc2l0aW9uXHJcbiAgICAgICAgICAgIHZhciB3ZXN0ID0gdGhpcy5fY2FudmFzUG9zaXRpb24ud2VzdDtcclxuICAgICAgICAgICAgdmFyIGVhc3QgPSB0aGlzLl9jYW52YXNQb3NpdGlvbi5lYXN0O1xyXG4gICAgICAgICAgICB2YXIgc291dGggPSB0aGlzLl9jYW52YXNQb3NpdGlvbi5zb3V0aDtcclxuICAgICAgICAgICAgdmFyIG5vcnRoID0gdGhpcy5fY2FudmFzUG9zaXRpb24ubm9ydGg7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICB2YXIgdG9wTGVmdCA9IHRoaXMuX21hcC5sYXRMbmdUb0xheWVyUG9pbnQoW25vcnRoLCB3ZXN0XSk7XHJcbiAgICAgICAgICAgIHZhciBib3R0b21SaWdodCA9IHRoaXMuX21hcC5sYXRMbmdUb0xheWVyUG9pbnQoW3NvdXRoLCBlYXN0XSk7XHJcbiAgICAgICAgICAgIHZhciBzaXplID0gYm90dG9tUmlnaHQuc3VidHJhY3QodG9wTGVmdCk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBMLkRvbVV0aWwuc2V0UG9zaXRpb24odGhpcy5fdGFyZ2V0Q2FudmFzLCB0b3BMZWZ0KTtcclxuICAgICAgICAgICAgdGhpcy5fdGFyZ2V0Q2FudmFzLnN0eWxlLndpZHRoID0gc2l6ZS54ICsgJ3B4JztcclxuICAgICAgICAgICAgdGhpcy5fdGFyZ2V0Q2FudmFzLnN0eWxlLmhlaWdodCA9IHNpemUueSArICdweCc7XHJcbiAgICAgICAgfSxcclxuICAgICAgICBcclxuICAgICAgICBfYW5pbWF0ZVpvb206IGZ1bmN0aW9uIGFuaW1hdGVab29tKG9wdGlvbnMpIHtcclxuICAgICAgICAgICAgaWYgKHRoaXMuX2NhbnZhc1Bvc2l0aW9uID09PSBudWxsKSB7XHJcbiAgICAgICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICAgICAgLy8gTk9URTogQWxsIG1ldGhvZCAoaW5jbHVkaW5nIHVzaW5nIG9mIHByaXZhdGUgbWV0aG9kXHJcbiAgICAgICAgICAgIC8vIF9sYXRMbmdUb05ld0xheWVyUG9pbnQpIHdhcyBjb3BpZWQgZnJvbSBJbWFnZU92ZXJsYXksXHJcbiAgICAgICAgICAgIC8vIGFzIExlYWZsZXQgZG9jdW1lbnRhdGlvbiByZWNvbW1lbmRzLlxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgdmFyIHdlc3QgPSAgdGhpcy5fY2FudmFzUG9zaXRpb24ud2VzdDtcclxuICAgICAgICAgICAgdmFyIGVhc3QgPSAgdGhpcy5fY2FudmFzUG9zaXRpb24uZWFzdDtcclxuICAgICAgICAgICAgdmFyIHNvdXRoID0gdGhpcy5fY2FudmFzUG9zaXRpb24uc291dGg7XHJcbiAgICAgICAgICAgIHZhciBub3J0aCA9IHRoaXMuX2NhbnZhc1Bvc2l0aW9uLm5vcnRoO1xyXG5cclxuICAgICAgICAgICAgdmFyIHRvcExlZnQgPSB0aGlzLl9tYXAuX2xhdExuZ1RvTmV3TGF5ZXJQb2ludChcclxuICAgICAgICAgICAgICAgIFtub3J0aCwgd2VzdF0sIG9wdGlvbnMuem9vbSwgb3B0aW9ucy5jZW50ZXIpO1xyXG4gICAgICAgICAgICB2YXIgYm90dG9tUmlnaHQgPSB0aGlzLl9tYXAuX2xhdExuZ1RvTmV3TGF5ZXJQb2ludChcclxuICAgICAgICAgICAgICAgIFtzb3V0aCwgZWFzdF0sIG9wdGlvbnMuem9vbSwgb3B0aW9ucy5jZW50ZXIpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgdmFyIHNjYWxlID0gdGhpcy5fbWFwLmdldFpvb21TY2FsZShvcHRpb25zLnpvb20pO1xyXG4gICAgICAgICAgICB2YXIgc2l6ZSA9IGJvdHRvbVJpZ2h0LnN1YnRyYWN0KHRvcExlZnQpO1xyXG4gICAgICAgICAgICB2YXIgc2l6ZVNjYWxlZCA9IHNpemUubXVsdGlwbHlCeSgoMSAvIDIpICogKDEgLSAxIC8gc2NhbGUpKTtcclxuICAgICAgICAgICAgdmFyIG9yaWdpbiA9IHRvcExlZnQuYWRkKHNpemVTY2FsZWQpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgdGhpcy5fdGFyZ2V0Q2FudmFzLnN0eWxlW0wuRG9tVXRpbC5UUkFOU0ZPUk1dID1cclxuICAgICAgICAgICAgICAgIEwuRG9tVXRpbC5nZXRUcmFuc2xhdGVTdHJpbmcob3JpZ2luKSArICcgc2NhbGUoJyArIHNjYWxlICsgJykgJztcclxuICAgICAgICB9XHJcbiAgICB9O1xyXG59IiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxudmFyIGltYWdlSGVscGVyRnVuY3Rpb25zID0gcmVxdWlyZSgnaW1hZ2UtaGVscGVyLWZ1bmN0aW9ucy5qcycpO1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiBjYWxjdWxhdGVMZWFmbGV0RnJ1c3R1bShsZWFmbGV0TWFwKSB7XHJcbiAgICB2YXIgc2NyZWVuU2l6ZSA9IGxlYWZsZXRNYXAuZ2V0U2l6ZSgpO1xyXG4gICAgdmFyIGJvdW5kcyA9IGxlYWZsZXRNYXAuZ2V0Qm91bmRzKCk7XHJcblxyXG4gICAgdmFyIGNhcnRvZ3JhcGhpY0JvdW5kcyA9IHtcclxuICAgICAgICB3ZXN0OiBib3VuZHMuZ2V0V2VzdCgpLFxyXG4gICAgICAgIGVhc3Q6IGJvdW5kcy5nZXRFYXN0KCksXHJcbiAgICAgICAgc291dGg6IGJvdW5kcy5nZXRTb3V0aCgpLFxyXG4gICAgICAgIG5vcnRoOiBib3VuZHMuZ2V0Tm9ydGgoKVxyXG4gICAgfTtcclxuICAgIFxyXG4gICAgdmFyIGZydXN0dW1EYXRhID0gaW1hZ2VIZWxwZXJGdW5jdGlvbnMuY2FsY3VsYXRlRnJ1c3R1bTJERnJvbUJvdW5kcyhcclxuICAgICAgICBjYXJ0b2dyYXBoaWNCb3VuZHMsIHNjcmVlblNpemUpO1xyXG5cclxuICAgIHJldHVybiBmcnVzdHVtRGF0YTtcclxufTsiLCIndXNlIHN0cmljdCc7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IEdyaWREZWNvZGVyV29ya2VyQmFzZTtcclxuXHJcbi8qIGdsb2JhbCBQcm9taXNlIDogZmFsc2UgKi9cclxuLyogZ2xvYmFsIEltYWdlRGF0YSA6IGZhbHNlICovXHJcblxyXG5mdW5jdGlvbiBHcmlkRGVjb2RlcldvcmtlckJhc2UoKSB7XHJcbiAgICBHcmlkRGVjb2RlcldvcmtlckJhc2UucHJvdG90eXBlLnN0YXJ0ID0gZnVuY3Rpb24gZGVjb2RlKGRlY29kZXJJbnB1dCkge1xyXG4gICAgICAgIHZhciBpbWFnZVBhcnRQYXJhbXMgPSBkZWNvZGVySW5wdXQuaW1hZ2VQYXJ0UGFyYW1zO1xyXG4gICAgICAgIHZhciB3aWR0aCAgPSBpbWFnZVBhcnRQYXJhbXMubWF4WEV4Y2x1c2l2ZSAtIGltYWdlUGFydFBhcmFtcy5taW5YO1xyXG4gICAgICAgIHZhciBoZWlnaHQgPSBpbWFnZVBhcnRQYXJhbXMubWF4WUV4Y2x1c2l2ZSAtIGltYWdlUGFydFBhcmFtcy5taW5ZO1xyXG4gICAgICAgIHZhciByZXN1bHQgPSBuZXcgSW1hZ2VEYXRhKHdpZHRoLCBoZWlnaHQpO1xyXG4gICAgICAgIHZhciBwcm9taXNlcyA9IFtdO1xyXG5cdFx0dmFyIHRpbGVQb3NpdGlvbiAgPSB7bWluWDogMCwgbWluWTogMCwgbWF4WEV4Y2x1c2l2ZTogMCwgbWF4WUV4Y2x1c2l2ZTogMCwgd2lkdGg6IGRlY29kZXJJbnB1dC50aWxlV2lkdGgsIGhlaWdodDogZGVjb2RlcklucHV0LnRpbGVIZWlnaHR9O1xyXG5cdFx0dmFyIHJlZ2lvbkluSW1hZ2UgPSB7bWluWDogMCwgbWluWTogMCwgbWF4WEV4Y2x1c2l2ZTogMCwgbWF4WUV4Y2x1c2l2ZTogMCwgd2lkdGg6IDAsIGhlaWdodDogMH07IFxyXG5cdFx0dmFyIG9mZnNldCA9IHt4OiAwLCB5OiAwfTtcclxuXHRcdHZhciB0aWxlID0ge3RpbGVYOiAwLCB0aWxlWTogMCwgbGV2ZWw6IDAsIHBvc2l0aW9uOiB0aWxlUG9zaXRpb24sIGNvbnRlbnQ6IG51bGx9O1xyXG5cdFx0Zm9yICh2YXIgaSA9IDA7IGkgPCBkZWNvZGVySW5wdXQudGlsZUluZGljZXMubGVuZ3RoOyArK2kpIHtcclxuXHRcdFx0dGlsZVBvc2l0aW9uLm1pblggICAgICAgICAgPSBkZWNvZGVySW5wdXQudGlsZUluZGljZXNbaV0udGlsZVggKiBkZWNvZGVySW5wdXQudGlsZVdpZHRoIDtcclxuXHRcdFx0dGlsZVBvc2l0aW9uLm1pblkgICAgICAgICAgPSBkZWNvZGVySW5wdXQudGlsZUluZGljZXNbaV0udGlsZVkgKiBkZWNvZGVySW5wdXQudGlsZUhlaWdodDtcclxuXHRcdFx0dGlsZVBvc2l0aW9uLm1heFhFeGNsdXNpdmUgPSB0aWxlUG9zaXRpb24ubWluWCArIGRlY29kZXJJbnB1dC50aWxlV2lkdGg7XHJcblx0XHRcdHRpbGVQb3NpdGlvbi5tYXhZRXhjbHVzaXZlID0gdGlsZVBvc2l0aW9uLm1pblkgKyBkZWNvZGVySW5wdXQudGlsZUhlaWdodDtcclxuXHRcdFx0XHJcblx0XHRcdHJlZ2lvbkluSW1hZ2UubWluWCAgICAgICAgICA9IE1hdGgubWF4KHRpbGVQb3NpdGlvbi5taW5YLCBpbWFnZVBhcnRQYXJhbXMubWluWCk7XHJcblx0XHRcdHJlZ2lvbkluSW1hZ2UubWluWSAgICAgICAgICA9IE1hdGgubWF4KHRpbGVQb3NpdGlvbi5taW5ZLCBpbWFnZVBhcnRQYXJhbXMubWluWSk7XHJcblx0XHRcdHJlZ2lvbkluSW1hZ2UubWF4WEV4Y2x1c2l2ZSA9IE1hdGgubWluKHRpbGVQb3NpdGlvbi5tYXhYRXhjbHVzaXZlLCBpbWFnZVBhcnRQYXJhbXMubWF4WEV4Y2x1c2l2ZSk7XHJcblx0XHRcdHJlZ2lvbkluSW1hZ2UubWF4WUV4Y2x1c2l2ZSA9IE1hdGgubWluKHRpbGVQb3NpdGlvbi5tYXhZRXhjbHVzaXZlLCBpbWFnZVBhcnRQYXJhbXMubWF4WUV4Y2x1c2l2ZSk7XHJcblx0XHRcdHJlZ2lvbkluSW1hZ2Uud2lkdGggICAgICAgICA9IHJlZ2lvbkluSW1hZ2UubWF4WEV4Y2x1c2l2ZSAtIHJlZ2lvbkluSW1hZ2UubWluWDtcclxuXHRcdFx0cmVnaW9uSW5JbWFnZS5oZWlnaHQgICAgICAgID0gcmVnaW9uSW5JbWFnZS5tYXhZRXhjbHVzaXZlIC0gcmVnaW9uSW5JbWFnZS5taW5ZO1xyXG5cdFx0XHRcclxuXHRcdFx0b2Zmc2V0LnggPSByZWdpb25JbkltYWdlLm1pblggLSBpbWFnZVBhcnRQYXJhbXMubWluWDtcclxuXHRcdFx0b2Zmc2V0LnkgPSByZWdpb25JbkltYWdlLm1pblkgLSBpbWFnZVBhcnRQYXJhbXMubWluWTtcclxuXHRcdFx0XHJcblx0XHRcdHRpbGUudGlsZVkgPSBkZWNvZGVySW5wdXQudGlsZUluZGljZXNbaV0udGlsZVk7XHJcblx0XHRcdHRpbGUudGlsZVggPSBkZWNvZGVySW5wdXQudGlsZUluZGljZXNbaV0udGlsZVg7XHJcblx0XHRcdHRpbGUubGV2ZWwgPSBkZWNvZGVySW5wdXQudGlsZUluZGljZXNbaV0ubGV2ZWw7XHJcblx0XHRcdHRpbGUuY29udGVudCA9IGRlY29kZXJJbnB1dC50aWxlQ29udGVudHNbaV07XHJcbiAgICAgICAgICAgIHByb21pc2VzLnB1c2godGhpcy5kZWNvZGVSZWdpb24ocmVzdWx0LCBvZmZzZXQsIHJlZ2lvbkluSW1hZ2UsIHRpbGUpKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgcmV0dXJuIFByb21pc2UuYWxsKHByb21pc2VzKS50aGVuKGZ1bmN0aW9uKCkge1xyXG4gICAgICAgICAgICByZXR1cm4gcmVzdWx0O1xyXG4gICAgICAgIH0pO1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgR3JpZERlY29kZXJXb3JrZXJCYXNlLnByb3RvdHlwZS5kZWNvZGVSZWdpb24gPSBmdW5jdGlvbiBkZWNvZGVSZWdpb24odGFyZ2V0SW1hZ2VEYXRhLCBpbWFnZVBhcnRQYXJhbXMsIGtleSwgZmV0Y2hlZERhdGEpIHtcclxuICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBkZWNvZGVSZWdpb24gaXMgbm90IGltcGxlbWVudGVkJztcclxuICAgIH07XHJcbn0iLCIndXNlIHN0cmljdCc7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IEdyaWRGZXRjaGVyQmFzZTtcclxuXHJcbnZhciBGZXRjaGVyQmFzZSA9IHJlcXVpcmUoJ2ZldGNoZXItYmFzZS5qcycpO1xyXG52YXIgR3JpZEltYWdlQmFzZSA9IHJlcXVpcmUoJ2dyaWQtaW1hZ2UtYmFzZS5qcycpO1xyXG52YXIgTGlua2VkTGlzdCA9IHJlcXVpcmUoJ2xpbmtlZC1saXN0LmpzJyk7XHJcblxyXG4vKiBnbG9iYWwgUHJvbWlzZTogZmFsc2UgKi9cclxuXHJcbmZ1bmN0aW9uIEdyaWRGZXRjaGVyQmFzZShvcHRpb25zKSB7XHJcblx0RmV0Y2hlckJhc2UuY2FsbCh0aGlzLCBvcHRpb25zKTtcclxuXHR0aGlzLl9ncmlkRmV0Y2hlckJhc2VDYWNoZSA9IFtdO1xyXG5cdHRoaXMuX2V2ZW50cyA9IHtcclxuXHRcdCdkYXRhJzogW10sXHJcblx0XHQndGlsZS10ZXJtaW5hdGVkJzogW11cclxuXHR9O1xyXG59XHJcblxyXG5HcmlkRmV0Y2hlckJhc2UucHJvdG90eXBlID0gT2JqZWN0LmNyZWF0ZShGZXRjaGVyQmFzZS5wcm90b3R5cGUpO1xyXG5cclxuR3JpZEZldGNoZXJCYXNlLnByb3RvdHlwZS5mZXRjaFRpbGUgPSBmdW5jdGlvbihsZXZlbCwgdGlsZVgsIHRpbGVZLCBmZXRjaFRhc2spIHtcclxuXHR0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBHcmlkRmV0Y2hlckJhc2UuZmV0Y2hUaWxlIGlzIG5vdCBpbXBsZW1lbnRlZCBieSBpbmhlcml0b3InO1xyXG59O1xyXG5cclxuR3JpZEZldGNoZXJCYXNlLnByb3RvdHlwZS5vbiA9IGZ1bmN0aW9uKGV2ZW50LCBsaXN0ZW5lcikge1xyXG5cdHZhciBsaXN0ZW5lcnMgPSB0aGlzLl9ldmVudHNbZXZlbnRdO1xyXG5cdGlmICghbGlzdGVuZXJzKSB7XHJcblx0XHR0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBVbmV4cGVjdGVkIGV2ZW50ICcgKyBldmVudCArICcgaW4gR3JpZEZldGNoZXJCYXNlJztcclxuXHR9XHJcblx0bGlzdGVuZXJzLnB1c2gobGlzdGVuZXIpO1xyXG59O1xyXG5cclxuR3JpZEZldGNoZXJCYXNlLnByb3RvdHlwZS5zdGFydEZldGNoID0gZnVuY3Rpb24gc3RhcnRGZXRjaChmZXRjaENvbnRleHQsIGltYWdlUGFydFBhcmFtcykge1xyXG5cdHZhciBmZXRjaERhdGEgPSB7XHJcblx0XHRhY3RpdmVUaWxlc0NvdW50OiAwLFxyXG5cdFx0YWN0aXZlVGlsZXNDb3VudFdpdGhTaW5nbGVMaXN0ZW5lcjogMCxcclxuXHRcdHRpbGVMaXN0ZW5lcnM6IFtdLFxyXG5cdFx0ZmV0Y2hDb250ZXh0OiBmZXRjaENvbnRleHQsXHJcblx0XHRpc1BlbmRpbmdTdG9wOiBmYWxzZSxcclxuXHRcdGlzQWN0aXZlOiBmYWxzZSxcclxuXHRcdGltYWdlUGFydFBhcmFtczogaW1hZ2VQYXJ0UGFyYW1zLFxyXG5cdFx0c2VsZjogdGhpc1xyXG5cdH07XHJcblx0XHJcblx0ZmV0Y2hDb250ZXh0Lm9uKCdzdG9wJywgb25GZXRjaFN0b3AsIGZldGNoRGF0YSk7XHJcblx0ZmV0Y2hDb250ZXh0Lm9uKCdyZXN1bWUnLCBvbkZldGNoUmVzdW1lLCBmZXRjaERhdGEpO1xyXG5cdGZldGNoQ29udGV4dC5vbigndGVybWluYXRlJywgb25GZXRjaFRlcm1pbmF0ZSwgZmV0Y2hEYXRhKTtcclxuXHJcblx0dmFyIHRpbGVzVG9TdGFydFggPSBbXTtcclxuXHR2YXIgdGlsZXNUb1N0YXJ0WSA9IFtdO1xyXG5cdHZhciB0aWxlc1RvU3RhcnREZXBlbmRGZXRjaGVzID0gW107XHJcblx0XHJcblx0dmFyIHRpbGVzUmFuZ2UgPSBHcmlkSW1hZ2VCYXNlLmdldFRpbGVzUmFuZ2UodGhpcy5nZXRJbWFnZVBhcmFtcygpLCBpbWFnZVBhcnRQYXJhbXMpO1xyXG5cdGZldGNoRGF0YS5hY3RpdmVUaWxlc0NvdW50ID0gKHRpbGVzUmFuZ2UubWF4VGlsZVggLSB0aWxlc1JhbmdlLm1pblRpbGVYKSAqICh0aWxlc1JhbmdlLm1heFRpbGVZIC0gdGlsZXNSYW5nZS5taW5UaWxlWSk7XHJcblx0Zm9yICh2YXIgdGlsZVggPSB0aWxlc1JhbmdlLm1pblRpbGVYOyB0aWxlWCA8IHRpbGVzUmFuZ2UubWF4VGlsZVg7ICsrdGlsZVgpIHtcclxuXHRcdGZvciAodmFyIHRpbGVZID0gdGlsZXNSYW5nZS5taW5UaWxlWTsgdGlsZVkgPCB0aWxlc1JhbmdlLm1heFRpbGVZOyArK3RpbGVZKSB7XHJcblx0XHRcdHZhciBkZXBlbmRGZXRjaGVzID0gdGhpcy5fYWRkVG9DYWNoZSh0aWxlWCwgdGlsZVksIGZldGNoRGF0YSk7XHJcblx0XHRcdGlmIChkZXBlbmRGZXRjaGVzID09PSBudWxsKSB7XHJcblx0XHRcdFx0Y29udGludWU7XHJcblx0XHRcdH1cclxuXHJcblx0XHRcdHRpbGVzVG9TdGFydFgucHVzaCh0aWxlWCk7XHJcblx0XHRcdHRpbGVzVG9TdGFydFkucHVzaCh0aWxlWSk7XHJcblx0XHRcdHRpbGVzVG9TdGFydERlcGVuZEZldGNoZXMucHVzaChkZXBlbmRGZXRjaGVzKTtcclxuXHRcdH1cclxuXHR9XHJcblx0XHJcblx0b25GZXRjaFJlc3VtZS5jYWxsKGZldGNoRGF0YSk7XHJcblx0XHJcblx0Zm9yICh2YXIgaSA9IDA7IGkgPCB0aWxlc1RvU3RhcnRYLmxlbmd0aDsgKytpKSB7XHJcblx0XHR0aGlzLl9sb2FkVGlsZShmZXRjaERhdGEuaW1hZ2VQYXJ0UGFyYW1zLmxldmVsLCB0aWxlc1RvU3RhcnRYW2ldLCB0aWxlc1RvU3RhcnRZW2ldLCB0aWxlc1RvU3RhcnREZXBlbmRGZXRjaGVzW2ldKTtcclxuXHR9XHJcbn07XHJcblxyXG5HcmlkRmV0Y2hlckJhc2UucHJvdG90eXBlLl9jaGVja0lmU2hvdWxkU3RvcCA9IGZ1bmN0aW9uIHRyeVN0b3BGZXRjaChmZXRjaERhdGEpIHtcclxuXHRpZiAoIWZldGNoRGF0YS5pc1BlbmRpbmdTdG9wIHx8IGZldGNoRGF0YS5hY3RpdmVUaWxlc0NvdW50V2l0aFNpbmdsZUxpc3RlbmVyID4gMCkge1xyXG5cdFx0cmV0dXJuO1xyXG5cdH1cclxuXHRcclxuXHRmZXRjaERhdGEuaXNQZW5kaW5nU3RvcCA9IGZhbHNlO1xyXG5cdGZldGNoRGF0YS5pc0FjdGl2ZSA9IGZhbHNlO1xyXG5cdHRoaXMuX2NoYW5nZVNpbmdsZUxpc3RlbmVyQ291bnRPZk92ZXJsYXBwaW5nRmV0Y2hlcyhmZXRjaERhdGEsICsxKTtcclxuXHRmZXRjaERhdGEuZmV0Y2hDb250ZXh0LnN0b3BwZWQoKTtcclxufTtcclxuXHRcclxuR3JpZEZldGNoZXJCYXNlLnByb3RvdHlwZS5fY2hhbmdlU2luZ2xlTGlzdGVuZXJDb3VudE9mT3ZlcmxhcHBpbmdGZXRjaGVzID1cclxuXHRcdGZ1bmN0aW9uIGNoYW5nZVNpbmdsZUxpc3RlbmVyQ291bnRPZk92ZXJsYXBwaW5nRmV0Y2hlcyhmZXRjaERhdGEsIGFkZFZhbHVlKSB7XHJcblx0XHRcdFxyXG5cdGZvciAodmFyIGkgPSAwOyBpIDwgZmV0Y2hEYXRhLnRpbGVMaXN0ZW5lcnMubGVuZ3RoOyArK2kpIHtcclxuXHRcdHZhciB0aWxlRGVwZW5kRmV0Y2hlcyA9IGZldGNoRGF0YS50aWxlTGlzdGVuZXJzW2ldLmRlcGVuZEZldGNoZXM7XHJcblx0XHR0aGlzLl9jaGFuZ2VUaWxlc0NvdW50T2ZUaWxlRGVwZW5kRmV0Y2hlcyh0aWxlRGVwZW5kRmV0Y2hlcywgLypzaW5nbGVMaXN0ZW5lckFkZFZhbHVlPSovYWRkVmFsdWUsIC8qYWN0aXZlVGlsZXNBZGRWYWx1ZT0qLzApO1xyXG5cdH1cclxufTtcclxuXHJcbkdyaWRGZXRjaGVyQmFzZS5wcm90b3R5cGUuX2NoYW5nZVRpbGVzQ291bnRPZlRpbGVEZXBlbmRGZXRjaGVzID0gZnVuY3Rpb24odGlsZURlcGVuZEZldGNoZXMsIHNpbmdsZUxpc3RlbmVyQWRkVmFsdWUsIGFjdGl2ZVRpbGVzQWRkVmFsdWUpIHtcclxuXHR2YXIgc2luZ2xlQWN0aXZlRmV0Y2ggPSBudWxsO1xyXG5cdHZhciBoYXNBY3RpdmVGZXRjaGVzID0gZmFsc2U7XHJcblx0dmFyIGl0ZXJhdG9yID0gdGlsZURlcGVuZEZldGNoZXMuZ2V0Rmlyc3RJdGVyYXRvcigpO1xyXG5cdHdoaWxlIChpdGVyYXRvciAhPT0gbnVsbCkge1xyXG5cdFx0dmFyIGZldGNoRGF0YSA9IHRpbGVEZXBlbmRGZXRjaGVzLmdldFZhbHVlKGl0ZXJhdG9yKTtcclxuXHRcdGl0ZXJhdG9yID0gdGlsZURlcGVuZEZldGNoZXMuZ2V0TmV4dEl0ZXJhdG9yKGl0ZXJhdG9yKTtcclxuXHJcblx0XHRmZXRjaERhdGEuYWN0aXZlVGlsZXNDb3VudCArPSBhY3RpdmVUaWxlc0FkZFZhbHVlO1xyXG5cdFx0aWYgKGZldGNoRGF0YS5hY3RpdmVUaWxlc0NvdW50ID09PSAwKSB7XHJcblx0XHRcdGZldGNoRGF0YS5pc0FjdGl2ZSA9IGZhbHNlO1xyXG5cdFx0XHRmZXRjaERhdGEuZmV0Y2hDb250ZXh0LmRvbmUoKTtcclxuXHRcdH1cclxuXHJcblx0XHRpZiAoIWZldGNoRGF0YS5pc0FjdGl2ZSkge1xyXG5cdFx0XHRjb250aW51ZTtcclxuXHRcdH0gZWxzZSBpZiAoc2luZ2xlQWN0aXZlRmV0Y2ggPT09IG51bGwpIHtcclxuXHRcdFx0c2luZ2xlQWN0aXZlRmV0Y2ggPSBmZXRjaERhdGE7XHJcblx0XHRcdGhhc0FjdGl2ZUZldGNoZXMgPSB0cnVlO1xyXG5cdFx0fSBlbHNlIGlmIChoYXNBY3RpdmVGZXRjaGVzKSB7XHJcblx0XHRcdC8vIE5vdCBzaW5nbGUgYW55bW9yZVxyXG5cdFx0XHRzaW5nbGVBY3RpdmVGZXRjaCA9IG51bGw7XHJcblx0XHRcdGlmICghYWN0aXZlVGlsZXNBZGRWYWx1ZSkge1xyXG5cdFx0XHRcdGJyZWFrO1xyXG5cdFx0XHR9XHJcblx0XHR9XHJcblx0fVxyXG5cdFxyXG5cdGlmIChzaW5nbGVBY3RpdmVGZXRjaCAhPT0gbnVsbCkge1xyXG5cdFx0c2luZ2xlQWN0aXZlRmV0Y2guYWN0aXZlVGlsZXNDb3VudFdpdGhTaW5nbGVMaXN0ZW5lciArPSBzaW5nbGVMaXN0ZW5lckFkZFZhbHVlO1xyXG5cdFx0dGhpcy5fY2hlY2tJZlNob3VsZFN0b3Aoc2luZ2xlQWN0aXZlRmV0Y2gpO1xyXG5cdH1cclxufTtcclxuXHJcbmZ1bmN0aW9uIG9uRmV0Y2hTdG9wKCkge1xyXG5cdC8qIGpzaGludCB2YWxpZHRoaXM6IHRydWUgKi9cclxuXHR2YXIgZmV0Y2hEYXRhID0gdGhpcztcclxuXHJcblx0ZmV0Y2hEYXRhLmlzUGVuZGluZ1N0b3AgPSB0cnVlO1xyXG5cdGZldGNoRGF0YS5zZWxmLl9jaGVja0lmU2hvdWxkU3RvcChmZXRjaERhdGEpO1xyXG59XHJcblxyXG5mdW5jdGlvbiBvbkZldGNoUmVzdW1lKCkge1xyXG5cdC8qIGpzaGludCB2YWxpZHRoaXM6IHRydWUgKi9cclxuXHR2YXIgZmV0Y2hEYXRhID0gdGhpcztcclxuXHRmZXRjaERhdGEuaXNQZW5kaW5nU3RvcCA9IGZhbHNlO1xyXG5cdFxyXG5cdGZldGNoRGF0YS5zZWxmLl9jaGFuZ2VTaW5nbGVMaXN0ZW5lckNvdW50T2ZPdmVybGFwcGluZ0ZldGNoZXMoZmV0Y2hEYXRhLCAtMSk7XHJcblx0ZmV0Y2hEYXRhLmlzQWN0aXZlID0gdHJ1ZTtcclxufVxyXG5cclxuZnVuY3Rpb24gb25GZXRjaFRlcm1pbmF0ZSgpIHtcclxuXHQvKiBqc2hpbnQgdmFsaWR0aGlzOiB0cnVlICovXHJcblx0dmFyIGZldGNoRGF0YSA9IHRoaXM7XHJcblx0XHJcblx0aWYgKGZldGNoRGF0YS5pc0FjdGl2ZSkge1xyXG5cdFx0dGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogVW5leHBlY3RlZCBncmlkIGZldGNoIHRlcm1pbmF0ZWQgb2YgYSBzdGlsbCBhY3RpdmUgZmV0Y2gnO1xyXG5cdH1cclxuXHRcclxuXHRmb3IgKHZhciBpID0gMDsgaSA8IGZldGNoRGF0YS50aWxlTGlzdGVuZXJzLmxlbmd0aDsgKytpKSB7XHJcblx0XHRmZXRjaERhdGEudGlsZUxpc3RlbmVyc1tpXS5kZXBlbmRGZXRjaGVzLnJlbW92ZShmZXRjaERhdGEudGlsZUxpc3RlbmVyc1tpXS5pdGVyYXRvcik7XHJcblx0fVxyXG59XHJcblxyXG5HcmlkRmV0Y2hlckJhc2UucHJvdG90eXBlLl9sb2FkVGlsZSA9IGZ1bmN0aW9uIGxvYWRUaWxlKGxldmVsLCB0aWxlWCwgdGlsZVksIGRlcGVuZEZldGNoZXMpIHtcclxuXHR2YXIgaXNUZXJtaW5hdGVkID0gZmFsc2U7XHJcblx0dmFyIHRpbGVLZXkgPSB7XHJcblx0XHRmZXRjaFdhaXRUYXNrOiB0cnVlLFxyXG5cdFx0dGlsZVg6IHRpbGVYLFxyXG5cdFx0dGlsZVk6IHRpbGVZLFxyXG5cdFx0bGV2ZWw6IGxldmVsXHJcblx0fTtcclxuXHRcclxuXHR2YXIgc2VsZiA9IHRoaXM7XHJcblx0dGhpcy5mZXRjaFRpbGUobGV2ZWwsIHRpbGVYLCB0aWxlWSwge1xyXG5cdFx0b25EYXRhOiBmdW5jdGlvbihyZXN1bHQpIHtcclxuXHRcdFx0aWYgKGlzVGVybWluYXRlZCkge1xyXG5cdFx0XHRcdHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IGFscmVhZHkgdGVybWluYXRlZCBpbiBHcmlkRmV0Y2hlckJhc2UuZmV0Y2hUaWxlKCknO1xyXG5cdFx0XHR9XHJcblx0XHRcdHZhciBkYXRhID0ge1xyXG5cdFx0XHRcdHRpbGVLZXk6IHRpbGVLZXksXHJcblx0XHRcdFx0dGlsZUNvbnRlbnQ6IHJlc3VsdFxyXG5cdFx0XHR9O1xyXG5cdFx0XHRmb3IgKHZhciBpID0gMDsgaSA8IHNlbGYuX2V2ZW50cy5kYXRhLmxlbmd0aDsgKytpKSB7XHJcblx0XHRcdFx0c2VsZi5fZXZlbnRzLmRhdGFbaV0oZGF0YSk7XHJcblx0XHRcdH1cclxuXHRcdH0sXHJcblx0XHRcclxuXHRcdG9uVGVybWluYXRlZDogZnVuY3Rpb24oKSB7XHJcblx0XHRcdGlmIChpc1Rlcm1pbmF0ZWQpIHtcclxuXHRcdFx0XHR0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBkb3VibGUgdGVybWluYXRpb24gaW4gR3JpZEZldGNoZXJCYXNlLmZldGNoVGlsZSgpJztcclxuXHRcdFx0fVxyXG5cdFx0XHRpZiAoc2VsZi5fZ3JpZEZldGNoZXJCYXNlQ2FjaGVbbGV2ZWxdW3RpbGVYXVt0aWxlWV0gIT09IGRlcGVuZEZldGNoZXMpIHtcclxuXHRcdFx0XHR0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBVbmV4cGVjdGVkIGZldGNoIGluIEdyaWRGZXRjaGVyQmFzZS5ncmlkRmV0Y2hlckJhc2VDYWNoZSc7XHJcblx0XHRcdH1cclxuXHRcdFx0c2VsZi5fZ3JpZEZldGNoZXJCYXNlQ2FjaGVbbGV2ZWxdW3RpbGVYXVt0aWxlWV0gPSBudWxsO1xyXG5cdFx0XHRcclxuXHRcdFx0Zm9yICh2YXIgaSA9IDA7IGkgPCBzZWxmLl9ldmVudHNbJ3RpbGUtdGVybWluYXRlZCddLmxlbmd0aDsgKytpKSB7XHJcblx0XHRcdFx0c2VsZi5fZXZlbnRzWyd0aWxlLXRlcm1pbmF0ZWQnXVtpXSh0aWxlS2V5KTtcclxuXHRcdFx0fVxyXG5cdFx0XHRcclxuXHRcdFx0c2VsZi5fY2hhbmdlVGlsZXNDb3VudE9mVGlsZURlcGVuZEZldGNoZXMoZGVwZW5kRmV0Y2hlcywgLypzaW5nbGVMaXN0ZW5lckFkZFZhbHVlPSovLTEsIC8qYWN0aXZlVGlsZXNBZGRWYWx1ZT0qLy0xKTtcclxuXHRcdH1cclxuXHR9KTtcclxufTtcclxuXHJcbkdyaWRGZXRjaGVyQmFzZS5wcm90b3R5cGUuX2FkZFRvQ2FjaGUgPSBmdW5jdGlvbiBhZGRUb0NhY2hlKHRpbGVYLCB0aWxlWSwgZmV0Y2hEYXRhKSB7XHJcblx0dmFyIGxldmVsQ2FjaGUgPSB0aGlzLl9ncmlkRmV0Y2hlckJhc2VDYWNoZVtmZXRjaERhdGEuaW1hZ2VQYXJ0UGFyYW1zLmxldmVsXTtcclxuXHRpZiAoIWxldmVsQ2FjaGUpIHtcclxuXHRcdGxldmVsQ2FjaGUgPSBbXTtcclxuXHRcdHRoaXMuX2dyaWRGZXRjaGVyQmFzZUNhY2hlW2ZldGNoRGF0YS5pbWFnZVBhcnRQYXJhbXMubGV2ZWxdID0gbGV2ZWxDYWNoZTtcclxuXHR9XHJcblx0XHJcblx0dmFyIHhDYWNoZSA9IGxldmVsQ2FjaGVbdGlsZVhdO1xyXG5cdGlmICgheENhY2hlKSB7XHJcblx0XHR4Q2FjaGUgPSBbXTtcclxuXHRcdGxldmVsQ2FjaGVbdGlsZVhdID0geENhY2hlO1xyXG5cdH1cclxuXHRcclxuXHR2YXIgZGVwZW5kRmV0Y2hlcyA9IHhDYWNoZVt0aWxlWV07XHJcblx0dmFyIGlzU2luZ2xlID0gZmFsc2U7XHJcblx0aWYgKCFkZXBlbmRGZXRjaGVzKSB7XHJcblx0XHRkZXBlbmRGZXRjaGVzID0gbmV3IExpbmtlZExpc3QoKTtcclxuXHRcdHhDYWNoZVt0aWxlWV0gPSBkZXBlbmRGZXRjaGVzO1xyXG5cdFx0KytmZXRjaERhdGEuYWN0aXZlVGlsZXNDb3VudFdpdGhTaW5nbGVMaXN0ZW5lcjtcclxuXHRcdGlzU2luZ2xlID0gdHJ1ZTtcclxuXHR9XHJcblx0XHJcblx0ZmV0Y2hEYXRhLnRpbGVMaXN0ZW5lcnMucHVzaCh7XHJcblx0XHRkZXBlbmRGZXRjaGVzOiBkZXBlbmRGZXRjaGVzLFxyXG5cdFx0aXRlcmF0b3I6IGRlcGVuZEZldGNoZXMuYWRkKGZldGNoRGF0YSlcclxuXHR9KTtcclxuXHRyZXR1cm4gaXNTaW5nbGUgPyBkZXBlbmRGZXRjaGVzIDogbnVsbDtcclxufTsiLCIndXNlIHN0cmljdCc7XHJcblxyXG52YXIgSW1hZ2VCYXNlID0gcmVxdWlyZSgnaW1hZ2UtYmFzZS5qcycpO1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBHcmlkSW1hZ2VCYXNlO1xyXG5cclxuLyogZ2xvYmFsIFByb21pc2U6IGZhbHNlICovXHJcblxyXG52YXIgRkVUQ0hfV0FJVF9UQVNLID0gMDtcclxudmFyIERFQ09ERV9UQVNLID0gMTtcclxuXHJcbmZ1bmN0aW9uIEdyaWRJbWFnZUJhc2UoZmV0Y2hlcikge1xyXG5cdEltYWdlQmFzZS5jYWxsKHRoaXMpO1xyXG5cdFxyXG5cdHRoaXMuX2ZldGNoZXIgPSBmZXRjaGVyO1xyXG5cdHRoaXMuX2ltYWdlUGFyYW1zID0gbnVsbDtcclxuXHR0aGlzLl93YWl0aW5nRmV0Y2hlcyA9IHt9O1xyXG5cclxuXHR0aGlzLl9mZXRjaGVyLm9uKCdkYXRhJywgdGhpcy5fb25EYXRhRmV0Y2hlZC5iaW5kKHRoaXMpKTtcclxuXHR0aGlzLl9mZXRjaGVyLm9uKCd0aWxlLXRlcm1pbmF0ZWQnLCB0aGlzLl9vblRpbGVUZXJtaW5hdGVkLmJpbmQodGhpcykpO1xyXG59XHJcblxyXG5HcmlkSW1hZ2VCYXNlLnByb3RvdHlwZSA9IE9iamVjdC5jcmVhdGUoSW1hZ2VCYXNlLnByb3RvdHlwZSk7XHJcblxyXG5HcmlkSW1hZ2VCYXNlLnByb3RvdHlwZS5nZXREZWNvZGVXb3JrZXJUeXBlT3B0aW9ucyA9IGZ1bmN0aW9uIGdldERlY29kZVdvcmtlclR5cGVPcHRpb25zKCkge1xyXG5cdHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IEdyaWRJbWFnZUJhc2UuZ2V0RGVjb2RlV29ya2VyVHlwZU9wdGlvbnMgaXMgbm90IGltcGxlbWVudGVkIGJ5IGluaGVyaXRvcic7XHJcbn07XHJcblxyXG5HcmlkSW1hZ2VCYXNlLnByb3RvdHlwZS5nZXREZWNvZGVyV29ya2VycyA9IGZ1bmN0aW9uIGdldERlY29kZXJXb3JrZXJzKCkge1xyXG5cdHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IEdyaWRJbWFnZUJhc2UuZ2V0RGVjb2RlcldvcmtlcnMgaXMgbm90IGltcGxlbWVudGVkIGJ5IGluaGVyaXRvcic7XHJcbn07XHJcblxyXG5HcmlkSW1hZ2VCYXNlLnByb3RvdHlwZS5kZWNvZGVUYXNrU3RhcnRlZCA9IGZ1bmN0aW9uIGRlY29kZVRhc2tTdGFydGVkKHRhc2spIHtcclxuXHR2YXIgc2VsZiA9IHRoaXM7XHJcblx0dGFzay5vbignYWxsRGVwZW5kVGFza3NUZXJtaW5hdGVkJywgZnVuY3Rpb24oKSB7XHJcblx0XHRzZWxmLmRhdGFSZWFkeUZvckRlY29kZSh0YXNrKTtcclxuXHRcdHRhc2sudGVybWluYXRlKCk7XHJcblx0fSk7XHJcbn07XHJcblxyXG5HcmlkSW1hZ2VCYXNlLnByb3RvdHlwZS5nZXRGZXRjaGVyID0gZnVuY3Rpb24gZ2V0RmV0Y2hlcigpIHtcclxuXHRyZXR1cm4gdGhpcy5fZmV0Y2hlcjtcclxufTtcclxuXHJcbi8vIGxldmVsIGNhbGN1bGF0aW9uc1xyXG5cclxuR3JpZEltYWdlQmFzZS5wcm90b3R5cGUuZ2V0TGV2ZWxXaWR0aCA9IGZ1bmN0aW9uIGdldExldmVsV2lkdGgobGV2ZWwpIHtcclxuXHR2YXIgaW1hZ2VQYXJhbXMgPSB0aGlzLmdldEltYWdlUGFyYW1zKCk7XHJcblx0cmV0dXJuIGltYWdlUGFyYW1zLmltYWdlV2lkdGggKiBNYXRoLnBvdygyLCBsZXZlbCAtIGltYWdlUGFyYW1zLmltYWdlTGV2ZWwpO1xyXG59O1xyXG5cclxuR3JpZEltYWdlQmFzZS5wcm90b3R5cGUuZ2V0TGV2ZWxIZWlnaHQgPSBmdW5jdGlvbiBnZXRMZXZlbEhlaWdodChsZXZlbCkge1xyXG5cdHZhciBpbWFnZVBhcmFtcyA9IHRoaXMuZ2V0SW1hZ2VQYXJhbXMoKTtcclxuXHRyZXR1cm4gaW1hZ2VQYXJhbXMuaW1hZ2VIZWlnaHQgKiBNYXRoLnBvdygyLCBsZXZlbCAtIGltYWdlUGFyYW1zLmltYWdlTGV2ZWwpO1xyXG59O1xyXG5cclxuR3JpZEltYWdlQmFzZS5wcm90b3R5cGUuZ2V0TGV2ZWwgPSBmdW5jdGlvbiBnZXRMZXZlbChyZWdpb25JbWFnZUxldmVsKSB7XHJcblx0dmFyIGltYWdlUGFyYW1zID0gdGhpcy5nZXRJbWFnZVBhcmFtcygpO1xyXG5cdFxyXG5cdHZhciBsb2cyID0gTWF0aC5sb2coMik7XHJcblx0dmFyIGxldmVsWCA9IE1hdGgubG9nKHJlZ2lvbkltYWdlTGV2ZWwuc2NyZWVuV2lkdGggIC8gKHJlZ2lvbkltYWdlTGV2ZWwubWF4WEV4Y2x1c2l2ZSAtIHJlZ2lvbkltYWdlTGV2ZWwubWluWCkpIC8gbG9nMjtcclxuXHR2YXIgbGV2ZWxZID0gTWF0aC5sb2cocmVnaW9uSW1hZ2VMZXZlbC5zY3JlZW5IZWlnaHQgLyAocmVnaW9uSW1hZ2VMZXZlbC5tYXhZRXhjbHVzaXZlIC0gcmVnaW9uSW1hZ2VMZXZlbC5taW5ZKSkgLyBsb2cyO1xyXG5cdHZhciBsZXZlbCA9IE1hdGguY2VpbChNYXRoLm1pbihsZXZlbFgsIGxldmVsWSkpO1xyXG5cdGxldmVsICs9IGltYWdlUGFyYW1zLmltYWdlTGV2ZWw7XHJcblx0XHJcblx0cmV0dXJuIGxldmVsO1xyXG59O1xyXG5cclxuLy8gRGVwZW5kZW5jeVdvcmtlcnNJbnB1dFJldHJlaXZlciBpbXBsZW1lbnRhdGlvblxyXG5cclxuR3JpZEltYWdlQmFzZS5wcm90b3R5cGUuZ2V0V29ya2VyVHlwZU9wdGlvbnMgPSBmdW5jdGlvbih0YXNrVHlwZSkge1xyXG5cdGlmICh0YXNrVHlwZSA9PT0gRkVUQ0hfV0FJVF9UQVNLKSB7XHJcblx0XHRyZXR1cm4gbnVsbDtcclxuXHR9IGVsc2UgaWYgKHRhc2tUeXBlID09PSBERUNPREVfVEFTSykge1xyXG5cdFx0cmV0dXJuIHRoaXMuZ2V0RGVjb2RlV29ya2VyVHlwZU9wdGlvbnMoKTtcclxuXHR9IGVsc2Uge1xyXG5cdFx0dGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBpbnRlcm5hbCBlcnJvcjogR3JpZEltYWdlQmFzZS5nZXRUYXNrVHlwZU9wdGlvbnMgZ290IHVuZXhwZWN0ZWQgdGFzayB0eXBlICcgKyB0YXNrVHlwZTtcclxuXHR9XHJcbn07XHJcblxyXG5HcmlkSW1hZ2VCYXNlLnByb3RvdHlwZS5nZXRLZXlBc1N0cmluZyA9IGZ1bmN0aW9uKGtleSkge1xyXG5cdGlmIChrZXkuZmV0Y2hXYWl0VGFzaykge1xyXG5cdFx0cmV0dXJuICdmZXRjaFdhaXQ6JyArIGtleS50aWxlWCArICcsJyArIGtleS50aWxlWSArICc6JyArIGtleS5sZXZlbDtcclxuXHR9XHJcblx0Ly8gT3RoZXJ3aXNlIGl0J3MgYSBpbWFnZVBhcnRQYXJhbXMga2V5IHBhc3NlZCBieSBpbWFnZURlY29kZXJGcmFtZXdvcmsgbGliLiBKdXN0IGNyZWF0ZSBhIHVuaXF1ZSBzdHJpbmdcclxuXHRyZXR1cm4gSlNPTi5zdHJpbmdpZnkoa2V5KTtcclxufTtcclxuXHJcbkdyaWRJbWFnZUJhc2UucHJvdG90eXBlLnRhc2tTdGFydGVkID0gZnVuY3Rpb24odGFzaykge1x0XHJcblx0dmFyIHNlbGYgPSB0aGlzO1xyXG5cdFxyXG5cdGlmICh0YXNrLmtleS5mZXRjaFdhaXRUYXNrKSB7XHJcblx0XHR2YXIgc3RyS2V5ID0gdGhpcy5nZXRLZXlBc1N0cmluZyh0YXNrLmtleSk7XHJcblx0XHR0aGlzLl93YWl0aW5nRmV0Y2hlc1tzdHJLZXldID0gdGFzaztcclxuXHRcdHJldHVybjtcclxuXHR9XHJcblxyXG5cdGlmICh0aGlzLl9pbWFnZVBhcmFtcyA9PT0gbnVsbCkge1xyXG5cdFx0dGhpcy5faW1hZ2VQYXJhbXMgPSB0aGlzLmdldEltYWdlUGFyYW1zKCk7IC8vIGltYWdlUGFyYW1zIHRoYXQgcmV0dXJuZWQgYnkgZmV0Y2hlci5vcGVuKClcclxuXHR9XHJcblxyXG5cdHZhciBpbWFnZVBhcnRQYXJhbXMgPSB0YXNrLmtleTtcclxuXHR2YXIgdGlsZXNSYW5nZSA9IEdyaWRJbWFnZUJhc2UuZ2V0VGlsZXNSYW5nZSh0aGlzLl9pbWFnZVBhcmFtcywgaW1hZ2VQYXJ0UGFyYW1zKTtcclxuXHRcclxuXHR2YXIgaSA9IDA7XHJcblx0Zm9yICh2YXIgdGlsZVggPSB0aWxlc1JhbmdlLm1pblRpbGVYOyB0aWxlWCA8IHRpbGVzUmFuZ2UubWF4VGlsZVg7ICsrdGlsZVgpIHtcclxuXHRcdGZvciAodmFyIHRpbGVZID0gdGlsZXNSYW5nZS5taW5UaWxlWTsgdGlsZVkgPCB0aWxlc1JhbmdlLm1heFRpbGVZOyArK3RpbGVZKSB7XHJcblx0XHRcdHRhc2sucmVnaXN0ZXJUYXNrRGVwZW5kZW5jeSh7XHJcblx0XHRcdFx0ZmV0Y2hXYWl0VGFzazogdHJ1ZSxcclxuXHRcdFx0XHR0aWxlWDogdGlsZVgsXHJcblx0XHRcdFx0dGlsZVk6IHRpbGVZLFxyXG5cdFx0XHRcdGxldmVsOiBpbWFnZVBhcnRQYXJhbXMubGV2ZWxcclxuXHRcdFx0fSk7XHJcblx0XHR9XHJcblx0fVxyXG5cdFxyXG5cdHRoaXMuZGVjb2RlVGFza1N0YXJ0ZWQodGFzayk7XHJcbn07XHJcblxyXG5HcmlkSW1hZ2VCYXNlLnByb3RvdHlwZS5kYXRhUmVhZHlGb3JEZWNvZGUgPSBmdW5jdGlvbiBkYXRhUmVhZHlGb3JEZWNvZGUodGFzaykge1xyXG5cdHRhc2suZGF0YVJlYWR5KHtcclxuXHRcdHRpbGVDb250ZW50czogdGFzay5kZXBlbmRUYXNrUmVzdWx0cyxcclxuXHRcdHRpbGVJbmRpY2VzOiB0YXNrLmRlcGVuZFRhc2tLZXlzLFxyXG5cdFx0aW1hZ2VQYXJ0UGFyYW1zOiB0YXNrLmtleSxcclxuXHRcdHRpbGVXaWR0aDogdGhpcy5faW1hZ2VQYXJhbXMudGlsZVdpZHRoLFxyXG5cdFx0dGlsZUhlaWdodDogdGhpcy5faW1hZ2VQYXJhbXMudGlsZUhlaWdodFxyXG5cdH0sIERFQ09ERV9UQVNLKTtcclxufTtcclxuXHJcbi8vIEF1eGlsaWFyeSBtZXRob2RzXHJcblxyXG5HcmlkSW1hZ2VCYXNlLnByb3RvdHlwZS5fb25EYXRhRmV0Y2hlZCA9IGZ1bmN0aW9uKGZldGNoZWRUaWxlKSB7XHJcblx0dmFyIHN0cktleSA9IHRoaXMuZ2V0S2V5QXNTdHJpbmcoZmV0Y2hlZFRpbGUudGlsZUtleSk7XHJcblx0dmFyIHdhaXRpbmdUYXNrID0gdGhpcy5fd2FpdGluZ0ZldGNoZXNbc3RyS2V5XTtcclxuXHRpZiAod2FpdGluZ1Rhc2spIHtcclxuXHRcdHdhaXRpbmdUYXNrLmRhdGFSZWFkeShmZXRjaGVkVGlsZS50aWxlQ29udGVudCwgRkVUQ0hfV0FJVF9UQVNLKTtcclxuXHR9XHJcbn07XHJcblxyXG5HcmlkSW1hZ2VCYXNlLnByb3RvdHlwZS5fb25UaWxlVGVybWluYXRlZCA9IGZ1bmN0aW9uKHRpbGVLZXkpIHtcclxuXHR2YXIgc3RyS2V5ID0gdGhpcy5nZXRLZXlBc1N0cmluZyh0aWxlS2V5KTtcclxuXHR2YXIgd2FpdGluZ1Rhc2sgPSB0aGlzLl93YWl0aW5nRmV0Y2hlc1tzdHJLZXldO1xyXG5cdGlmICh3YWl0aW5nVGFzaykge1xyXG5cdFx0d2FpdGluZ1Rhc2sudGVybWluYXRlKCk7XHJcblx0XHR0aGlzLl93YWl0aW5nRmV0Y2hlc1tzdHJLZXldID0gbnVsbDtcclxuXHR9XHJcbn07XHJcblxyXG5HcmlkSW1hZ2VCYXNlLmdldFRpbGVzUmFuZ2UgPSBmdW5jdGlvbihpbWFnZVBhcmFtcywgaW1hZ2VQYXJ0UGFyYW1zKSB7XHJcblx0dmFyIGxldmVsV2lkdGggID0gaW1hZ2VQYXJhbXMuaW1hZ2VXaWR0aCAgKiBNYXRoLnBvdygyLCBpbWFnZVBhcnRQYXJhbXMubGV2ZWwgLSBpbWFnZVBhcmFtcy5pbWFnZUxldmVsKTtcclxuXHR2YXIgbGV2ZWxIZWlnaHQgPSBpbWFnZVBhcmFtcy5pbWFnZUhlaWdodCAqIE1hdGgucG93KDIsIGltYWdlUGFydFBhcmFtcy5sZXZlbCAtIGltYWdlUGFyYW1zLmltYWdlTGV2ZWwpO1xyXG5cdHZhciBsZXZlbFRpbGVzWCA9IE1hdGguY2VpbChsZXZlbFdpZHRoICAvIGltYWdlUGFyYW1zLnRpbGVXaWR0aCApO1xyXG5cdHZhciBsZXZlbFRpbGVzWSA9IE1hdGguY2VpbChsZXZlbEhlaWdodCAvIGltYWdlUGFyYW1zLnRpbGVIZWlnaHQpO1xyXG5cdHJldHVybiB7XHJcblx0XHRtaW5UaWxlWDogTWF0aC5tYXgoMCwgTWF0aC5mbG9vcihpbWFnZVBhcnRQYXJhbXMubWluWCAvIGltYWdlUGFyYW1zLnRpbGVXaWR0aCApKSxcclxuXHRcdG1pblRpbGVZOiBNYXRoLm1heCgwLCBNYXRoLmZsb29yKGltYWdlUGFydFBhcmFtcy5taW5ZIC8gaW1hZ2VQYXJhbXMudGlsZUhlaWdodCkpLFxyXG5cdFx0bWF4VGlsZVg6IE1hdGgubWluKGxldmVsVGlsZXNYLCBNYXRoLmNlaWwoaW1hZ2VQYXJ0UGFyYW1zLm1heFhFeGNsdXNpdmUgLyBpbWFnZVBhcmFtcy50aWxlV2lkdGggKSksXHJcblx0XHRtYXhUaWxlWTogTWF0aC5taW4obGV2ZWxUaWxlc1ksIE1hdGguY2VpbChpbWFnZVBhcnRQYXJhbXMubWF4WUV4Y2x1c2l2ZSAvIGltYWdlUGFyYW1zLnRpbGVIZWlnaHQpKVxyXG5cdH07XHJcbn07XHJcbiJdfQ==
