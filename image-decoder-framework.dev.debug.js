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
//# sourceMappingURL=data:application/json;charset:utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJzcmMvY2VzaXVtLWltYWdlLWRlY29kZXIvY2FudmFzLWltYWdlcnktcHJvdmlkZXIuanMiLCJzcmMvY2VzaXVtLWltYWdlLWRlY29kZXIvY2VzaXVtLWZydXN0dW0tY2FsY3VsYXRvci5qcyIsInNyYy9jZXNpdW0taW1hZ2UtZGVjb2Rlci9jZXNpdW0taW1hZ2UtZGVjb2Rlci1sYXllci1tYW5hZ2VyLmpzIiwic3JjL2Nlc2l1bS1pbWFnZS1kZWNvZGVyL2ltYWdlLWRlY29kZXItaW1hZ2VyeS1wcm92aWRlci5qcyIsInNyYy9pbWFnZS1kZWNvZGVyLWV4cG9ydHMuanMiLCJzcmMvaW1hZ2UtZGVjb2Rlci9pbWFnZS1iYXNlLmpzIiwic3JjL2ltYWdlLWRlY29kZXIvaW1hZ2UtZGVjb2Rlci1oZWxwZXJzL2RlY29kZS1qb2IuanMiLCJzcmMvaW1hZ2UtZGVjb2Rlci9pbWFnZS1kZWNvZGVyLWhlbHBlcnMvZGVjb2RlLWpvYnMtcG9vbC5qcyIsInNyYy9pbWFnZS1kZWNvZGVyL2ltYWdlLWRlY29kZXItaGVscGVycy9mZXRjaC1jb250ZXh0LWFwaS5qcyIsInNyYy9pbWFnZS1kZWNvZGVyL2ltYWdlLWRlY29kZXItaGVscGVycy9mZXRjaC1jb250ZXh0LmpzIiwic3JjL2ltYWdlLWRlY29kZXIvaW1hZ2UtZGVjb2Rlci1oZWxwZXJzL2ZldGNoZXItYmFzZS5qcyIsInNyYy9pbWFnZS1kZWNvZGVyL2ltYWdlLWRlY29kZXItaGVscGVycy9mZXRjaGVyLWNsb3Nlci5qcyIsInNyYy9pbWFnZS1kZWNvZGVyL2ltYWdlLWRlY29kZXItaGVscGVycy9mcnVzdHVtLXJlcXVlc3RzLXByaW9yaXRpemVyLmpzIiwic3JjL2ltYWdlLWRlY29kZXIvaW1hZ2UtZGVjb2Rlci1oZWxwZXJzL2ltYWdlLWhlbHBlci1mdW5jdGlvbnMuanMiLCJzcmMvaW1hZ2UtZGVjb2Rlci9pbWFnZS1kZWNvZGVyLWhlbHBlcnMvbGlua2VkLWxpc3QuanMiLCJzcmMvaW1hZ2UtZGVjb2Rlci9pbWFnZS1kZWNvZGVyLWhlbHBlcnMvc2ltcGxlLW1vdmFibGUtZmV0Y2guanMiLCJzcmMvaW1hZ2UtZGVjb2Rlci9pbWFnZS1kZWNvZGVyLXdvcmtlcnMvaW1hZ2UtcGFyYW1zLXJldHJpZXZlci1wcm94eS5qcyIsInNyYy9pbWFnZS1kZWNvZGVyL2ltYWdlLXZpZXdlci5qcyIsInNyYy9sZWFmbGV0LWltYWdlLWRlY29kZXIvaW1hZ2UtZGVjb2Rlci1yZWdpb24tbGF5ZXIuanMiLCJzcmMvbGVhZmxldC1pbWFnZS1kZWNvZGVyL2xlYWZsZXQtZnJ1c3R1bS1jYWxjdWxhdG9yLmpzIiwic3JjL3NpbXBsZS1mZXRjaGVyL2dyaWQtZGVjb2Rlci13b3JrZXItYmFzZS5qcyIsInNyYy9zaW1wbGUtZmV0Y2hlci9ncmlkLWZldGNoZXItYmFzZS5qcyIsInNyYy9zaW1wbGUtZmV0Y2hlci9ncmlkLWltYWdlLWJhc2UuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7QUNBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdFVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzFGQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2pKQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMva0JBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNYQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNuU0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3hEQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzNJQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMxQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3ZUQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDM01BO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3ZDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3pLQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDN05BO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDM0ZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN0TEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDakZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDcG5CQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQy9LQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ25CQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2pEQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNwT0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSIsImZpbGUiOiJnZW5lcmF0ZWQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlc0NvbnRlbnQiOlsiKGZ1bmN0aW9uIGUodCxuLHIpe2Z1bmN0aW9uIHMobyx1KXtpZighbltvXSl7aWYoIXRbb10pe3ZhciBhPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7aWYoIXUmJmEpcmV0dXJuIGEobywhMCk7aWYoaSlyZXR1cm4gaShvLCEwKTt2YXIgZj1uZXcgRXJyb3IoXCJDYW5ub3QgZmluZCBtb2R1bGUgJ1wiK28rXCInXCIpO3Rocm93IGYuY29kZT1cIk1PRFVMRV9OT1RfRk9VTkRcIixmfXZhciBsPW5bb109e2V4cG9ydHM6e319O3Rbb11bMF0uY2FsbChsLmV4cG9ydHMsZnVuY3Rpb24oZSl7dmFyIG49dFtvXVsxXVtlXTtyZXR1cm4gcyhuP246ZSl9LGwsbC5leHBvcnRzLGUsdCxuLHIpfXJldHVybiBuW29dLmV4cG9ydHN9dmFyIGk9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtmb3IodmFyIG89MDtvPHIubGVuZ3RoO28rKylzKHJbb10pO3JldHVybiBzfSkiLCIndXNlIHN0cmljdCc7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IENhbnZhc0ltYWdlcnlQcm92aWRlcjtcclxuXHJcbi8qIGdsb2JhbCBDZXNpdW06IGZhbHNlICovXHJcbi8qIGdsb2JhbCBEZXZlbG9wZXJFcnJvcjogZmFsc2UgKi9cclxuLyogZ2xvYmFsIENyZWRpdDogZmFsc2UgKi9cclxuXHJcbi8qKlxyXG4gKiBQcm92aWRlcyBhIFNpbmdsZSBDYW52YXMgaW1hZ2VyeSB0aWxlLiAgVGhlIGltYWdlIGlzIGFzc3VtZWQgdG8gdXNlIGFcclxuICoge0BsaW5rIEdlb2dyYXBoaWNUaWxpbmdTY2hlbWV9LlxyXG4gKlxyXG4gKiBAYWxpYXMgQ2FudmFzSW1hZ2VyeVByb3ZpZGVyXHJcbiAqIEBjb25zdHJ1Y3RvclxyXG4gKlxyXG4gKiBAcGFyYW0ge2NhbnZhc30gQ2FudmFzIGZvciB0aGUgdGlsZS5cclxuICogQHBhcmFtIHtPYmplY3R9IG9wdGlvbnMgT2JqZWN0IHdpdGggdGhlIGZvbGxvd2luZyBwcm9wZXJ0aWVzOlxyXG4gKiBAcGFyYW0ge0NyZWRpdHxTdHJpbmd9IFtvcHRpb25zLmNyZWRpdF0gQSBjcmVkaXQgZm9yIHRoZSBkYXRhIHNvdXJjZSwgd2hpY2ggaXMgZGlzcGxheWVkIG9uIHRoZSBjYW52YXMuXHJcbiAqXHJcbiAqIEBzZWUgQXJjR2lzTWFwU2VydmVySW1hZ2VyeVByb3ZpZGVyXHJcbiAqIEBzZWUgQmluZ01hcHNJbWFnZXJ5UHJvdmlkZXJcclxuICogQHNlZSBHb29nbGVFYXJ0aEltYWdlcnlQcm92aWRlclxyXG4gKiBAc2VlIE9wZW5TdHJlZXRNYXBJbWFnZXJ5UHJvdmlkZXJcclxuICogQHNlZSBUaWxlTWFwU2VydmljZUltYWdlcnlQcm92aWRlclxyXG4gKiBAc2VlIFdlYk1hcFNlcnZpY2VJbWFnZXJ5UHJvdmlkZXJcclxuICovXHJcbmZ1bmN0aW9uIENhbnZhc0ltYWdlcnlQcm92aWRlcihjYW52YXMsIG9wdGlvbnMpIHtcclxuICAgIGlmIChvcHRpb25zID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICBvcHRpb25zID0ge307XHJcbiAgICB9XHJcblxyXG4gICAgLy8+PmluY2x1ZGVTdGFydCgnZGVidWcnLCBwcmFnbWFzLmRlYnVnKTtcclxuICAgIGlmIChjYW52YXMgPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIHRocm93IG5ldyBEZXZlbG9wZXJFcnJvcignY2FudmFzIGlzIHJlcXVpcmVkLicpO1xyXG4gICAgfVxyXG4gICAgLy8+PmluY2x1ZGVFbmQoJ2RlYnVnJyk7XHJcblxyXG4gICAgdGhpcy5fY2FudmFzID0gY2FudmFzO1xyXG5cclxuICAgIHRoaXMuX2Vycm9yRXZlbnQgPSBuZXcgRXZlbnQoJ0NhbnZhc0ltYWdlcnlQcm92aWRlclN0YXR1cycpO1xyXG5cclxuICAgIHRoaXMuX3JlYWR5ID0gZmFsc2U7XHJcblxyXG4gICAgdmFyIGNyZWRpdCA9IG9wdGlvbnMuY3JlZGl0O1xyXG4gICAgaWYgKHR5cGVvZiBjcmVkaXQgPT09ICdzdHJpbmcnKSB7XHJcbiAgICAgICAgY3JlZGl0ID0gbmV3IENyZWRpdChjcmVkaXQpO1xyXG4gICAgfVxyXG4gICAgdGhpcy5fY3JlZGl0ID0gY3JlZGl0O1xyXG59XHJcblxyXG5DYW52YXNJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlID0ge1xyXG4gICAgLyoqXHJcbiAgICAgKiBHZXRzIHRoZSB3aWR0aCBvZiBlYWNoIHRpbGUsIGluIHBpeGVscy4gVGhpcyBmdW5jdGlvbiBzaG91bGRcclxuICAgICAqIG5vdCBiZSBjYWxsZWQgYmVmb3JlIHtAbGluayBDYW52YXNJbWFnZXJ5UHJvdmlkZXIjcmVhZHl9IHJldHVybnMgdHJ1ZS5cclxuICAgICAqIEBtZW1iZXJvZiBDYW52YXNJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlXHJcbiAgICAgKiBAdHlwZSB7TnVtYmVyfVxyXG4gICAgICogQHJlYWRvbmx5XHJcbiAgICAgKi9cclxuICAgIGdldCB0aWxlV2lkdGgoKSB7XHJcbiAgICAgICAgICAgIC8vPj5pbmNsdWRlU3RhcnQoJ2RlYnVnJywgcHJhZ21hcy5kZWJ1Zyk7XHJcbiAgICAgICAgICAgIGlmICghdGhpcy5fcmVhZHkpIHtcclxuICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRGV2ZWxvcGVyRXJyb3IoJ3RpbGVXaWR0aCBtdXN0IG5vdCBiZSBjYWxsZWQgYmVmb3JlIHRoZSBpbWFnZXJ5IHByb3ZpZGVyIGlzIHJlYWR5LicpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIC8vPj5pbmNsdWRlRW5kKCdkZWJ1ZycpO1xyXG5cclxuICAgICAgICAgICAgcmV0dXJuIHRoaXMuX2NhbnZhcy53aWR0aDtcclxuICAgIH0sXHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZXRzIHRoZSBoZWlnaHQgb2YgZWFjaCB0aWxlLCBpbiBwaXhlbHMuICBUaGlzIGZ1bmN0aW9uIHNob3VsZFxyXG4gICAgICogbm90IGJlIGNhbGxlZCBiZWZvcmUge0BsaW5rIENhbnZhc0ltYWdlcnlQcm92aWRlciNyZWFkeX0gcmV0dXJucyB0cnVlLlxyXG4gICAgICogQG1lbWJlcm9mIENhbnZhc0ltYWdlcnlQcm92aWRlci5wcm90b3R5cGVcclxuICAgICAqIEB0eXBlIHtOdW1iZXJ9XHJcbiAgICAgKiBAcmVhZG9ubHlcclxuICAgICAqL1xyXG4gICAgZ2V0IHRpbGVIZWlnaHQoKSB7XHJcbiAgICAgICAgICAgIC8vPj5pbmNsdWRlU3RhcnQoJ2RlYnVnJywgcHJhZ21hcy5kZWJ1Zyk7XHJcbiAgICAgICAgICAgIGlmICghdGhpcy5fcmVhZHkpIHtcclxuICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRGV2ZWxvcGVyRXJyb3IoJ3RpbGVIZWlnaHQgbXVzdCBub3QgYmUgY2FsbGVkIGJlZm9yZSB0aGUgaW1hZ2VyeSBwcm92aWRlciBpcyByZWFkeS4nKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAvLz4+aW5jbHVkZUVuZCgnZGVidWcnKTtcclxuXHJcbiAgICAgICAgICAgIHJldHVybiB0aGlzLl9jYW52YXMuaGVpZ2h0O1xyXG4gICAgfSxcclxuXHJcbiAgICAvKipcclxuICAgICAqIEdldHMgdGhlIG1heGltdW0gbGV2ZWwtb2YtZGV0YWlsIHRoYXQgY2FuIGJlIHJlcXVlc3RlZC4gIFRoaXMgZnVuY3Rpb24gc2hvdWxkXHJcbiAgICAgKiBub3QgYmUgY2FsbGVkIGJlZm9yZSB7QGxpbmsgQ2FudmFzSW1hZ2VyeVByb3ZpZGVyI3JlYWR5fSByZXR1cm5zIHRydWUuXHJcbiAgICAgKiBAbWVtYmVyb2YgQ2FudmFzSW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZVxyXG4gICAgICogQHR5cGUge051bWJlcn1cclxuICAgICAqIEByZWFkb25seVxyXG4gICAgICovXHJcbiAgICBnZXQgbWF4aW11bUxldmVsKCkge1xyXG4gICAgICAgICAgICAvLz4+aW5jbHVkZVN0YXJ0KCdkZWJ1ZycsIHByYWdtYXMuZGVidWcpO1xyXG4gICAgICAgICAgICBpZiAoIXRoaXMuX3JlYWR5KSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IERldmVsb3BlckVycm9yKCdtYXhpbXVtTGV2ZWwgbXVzdCBub3QgYmUgY2FsbGVkIGJlZm9yZSB0aGUgaW1hZ2VyeSBwcm92aWRlciBpcyByZWFkeS4nKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAvLz4+aW5jbHVkZUVuZCgnZGVidWcnKTtcclxuXHJcbiAgICAgICAgICAgIHJldHVybiAwO1xyXG4gICAgfSxcclxuXHJcbiAgICAvKipcclxuICAgICAqIEdldHMgdGhlIG1pbmltdW0gbGV2ZWwtb2YtZGV0YWlsIHRoYXQgY2FuIGJlIHJlcXVlc3RlZC4gIFRoaXMgZnVuY3Rpb24gc2hvdWxkXHJcbiAgICAgKiBub3QgYmUgY2FsbGVkIGJlZm9yZSB7QGxpbmsgQ2FudmFzSW1hZ2VyeVByb3ZpZGVyI3JlYWR5fSByZXR1cm5zIHRydWUuXHJcbiAgICAgKiBAbWVtYmVyb2YgQ2FudmFzSW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZVxyXG4gICAgICogQHR5cGUge051bWJlcn1cclxuICAgICAqIEByZWFkb25seVxyXG4gICAgICovXHJcbiAgICBnZXQgbWluaW11bUxldmVsKCkge1xyXG4gICAgICAgICAgICAvLz4+aW5jbHVkZVN0YXJ0KCdkZWJ1ZycsIHByYWdtYXMuZGVidWcpO1xyXG4gICAgICAgICAgICBpZiAoIXRoaXMuX3JlYWR5KSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IERldmVsb3BlckVycm9yKCdtaW5pbXVtTGV2ZWwgbXVzdCBub3QgYmUgY2FsbGVkIGJlZm9yZSB0aGUgaW1hZ2VyeSBwcm92aWRlciBpcyByZWFkeS4nKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAvLz4+aW5jbHVkZUVuZCgnZGVidWcnKTtcclxuXHJcbiAgICAgICAgICAgIHJldHVybiAwO1xyXG4gICAgfSxcclxuXHJcbiAgICAvKipcclxuICAgICAqIEdldHMgdGhlIHRpbGluZyBzY2hlbWUgdXNlZCBieSB0aGlzIHByb3ZpZGVyLiAgVGhpcyBmdW5jdGlvbiBzaG91bGRcclxuICAgICAqIG5vdCBiZSBjYWxsZWQgYmVmb3JlIHtAbGluayBDYW52YXNJbWFnZXJ5UHJvdmlkZXIjcmVhZHl9IHJldHVybnMgdHJ1ZS5cclxuICAgICAqIEBtZW1iZXJvZiBDYW52YXNJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlXHJcbiAgICAgKiBAdHlwZSB7VGlsaW5nU2NoZW1lfVxyXG4gICAgICogQHJlYWRvbmx5XHJcbiAgICAgKi9cclxuICAgIGdldCB0aWxpbmdTY2hlbWUoKSB7XHJcbiAgICAgICAgICAgIC8vPj5pbmNsdWRlU3RhcnQoJ2RlYnVnJywgcHJhZ21hcy5kZWJ1Zyk7XHJcbiAgICAgICAgICAgIGlmICghdGhpcy5fcmVhZHkpIHtcclxuICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRGV2ZWxvcGVyRXJyb3IoJ3RpbGluZ1NjaGVtZSBtdXN0IG5vdCBiZSBjYWxsZWQgYmVmb3JlIHRoZSBpbWFnZXJ5IHByb3ZpZGVyIGlzIHJlYWR5LicpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIC8vPj5pbmNsdWRlRW5kKCdkZWJ1ZycpO1xyXG5cclxuICAgICAgICAgICAgcmV0dXJuIHRoaXMuX3RpbGluZ1NjaGVtZTtcclxuICAgIH0sXHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZXRzIHRoZSByZWN0YW5nbGUsIGluIHJhZGlhbnMsIG9mIHRoZSBpbWFnZXJ5IHByb3ZpZGVkIGJ5IHRoaXMgaW5zdGFuY2UuICBUaGlzIGZ1bmN0aW9uIHNob3VsZFxyXG4gICAgICogbm90IGJlIGNhbGxlZCBiZWZvcmUge0BsaW5rIENhbnZhc0ltYWdlcnlQcm92aWRlciNyZWFkeX0gcmV0dXJucyB0cnVlLlxyXG4gICAgICogQG1lbWJlcm9mIENhbnZhc0ltYWdlcnlQcm92aWRlci5wcm90b3R5cGVcclxuICAgICAqIEB0eXBlIHtSZWN0YW5nbGV9XHJcbiAgICAgKiBAcmVhZG9ubHlcclxuICAgICAqL1xyXG4gICAgZ2V0IHJlY3RhbmdsZSgpIHtcclxuICAgICAgICAgICAgcmV0dXJuIHRoaXMuX3RpbGluZ1NjaGVtZS5yZWN0YW5nbGU7XHJcbiAgICB9LFxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2V0cyB0aGUgdGlsZSBkaXNjYXJkIHBvbGljeS4gIElmIG5vdCB1bmRlZmluZWQsIHRoZSBkaXNjYXJkIHBvbGljeSBpcyByZXNwb25zaWJsZVxyXG4gICAgICogZm9yIGZpbHRlcmluZyBvdXQgXCJtaXNzaW5nXCIgdGlsZXMgdmlhIGl0cyBzaG91bGREaXNjYXJkSW1hZ2UgZnVuY3Rpb24uICBJZiB0aGlzIGZ1bmN0aW9uXHJcbiAgICAgKiByZXR1cm5zIHVuZGVmaW5lZCwgbm8gdGlsZXMgYXJlIGZpbHRlcmVkLiAgVGhpcyBmdW5jdGlvbiBzaG91bGRcclxuICAgICAqIG5vdCBiZSBjYWxsZWQgYmVmb3JlIHtAbGluayBDYW52YXNJbWFnZXJ5UHJvdmlkZXIjcmVhZHl9IHJldHVybnMgdHJ1ZS5cclxuICAgICAqIEBtZW1iZXJvZiBDYW52YXNJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlXHJcbiAgICAgKiBAdHlwZSB7VGlsZURpc2NhcmRQb2xpY3l9XHJcbiAgICAgKiBAcmVhZG9ubHlcclxuICAgICAqL1xyXG4gICAgZ2V0IHRpbGVEaXNjYXJkUG9saWN5KCkge1xyXG4gICAgICAgICAgICAvLz4+aW5jbHVkZVN0YXJ0KCdkZWJ1ZycsIHByYWdtYXMuZGVidWcpO1xyXG4gICAgICAgICAgICBpZiAoIXRoaXMuX3JlYWR5KSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IERldmVsb3BlckVycm9yKCd0aWxlRGlzY2FyZFBvbGljeSBtdXN0IG5vdCBiZSBjYWxsZWQgYmVmb3JlIHRoZSBpbWFnZXJ5IHByb3ZpZGVyIGlzIHJlYWR5LicpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIC8vPj5pbmNsdWRlRW5kKCdkZWJ1ZycpO1xyXG5cclxuICAgICAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcclxuICAgIH0sXHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZXRzIGFuIGV2ZW50IHRoYXQgaXMgcmFpc2VkIHdoZW4gdGhlIGltYWdlcnkgcHJvdmlkZXIgZW5jb3VudGVycyBhbiBhc3luY2hyb25vdXMgZXJyb3IuICBCeSBzdWJzY3JpYmluZ1xyXG4gICAgICogdG8gdGhlIGV2ZW50LCB5b3Ugd2lsbCBiZSBub3RpZmllZCBvZiB0aGUgZXJyb3IgYW5kIGNhbiBwb3RlbnRpYWxseSByZWNvdmVyIGZyb20gaXQuICBFdmVudCBsaXN0ZW5lcnNcclxuICAgICAqIGFyZSBwYXNzZWQgYW4gaW5zdGFuY2Ugb2Yge0BsaW5rIFRpbGVQcm92aWRlckVycm9yfS5cclxuICAgICAqIEBtZW1iZXJvZiBDYW52YXNJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlXHJcbiAgICAgKiBAdHlwZSB7RXZlbnR9XHJcbiAgICAgKiBAcmVhZG9ubHlcclxuICAgICAqL1xyXG4gICAgZ2V0IGVycm9yRXZlbnQoKSB7XHJcbiAgICAgICAgICAgIHJldHVybiB0aGlzLl9lcnJvckV2ZW50O1xyXG4gICAgfSxcclxuXHJcbiAgICAvKipcclxuICAgICAqIEdldHMgYSB2YWx1ZSBpbmRpY2F0aW5nIHdoZXRoZXIgb3Igbm90IHRoZSBwcm92aWRlciBpcyByZWFkeSBmb3IgdXNlLlxyXG4gICAgICogQG1lbWJlcm9mIENhbnZhc0ltYWdlcnlQcm92aWRlci5wcm90b3R5cGVcclxuICAgICAqIEB0eXBlIHtCb29sZWFufVxyXG4gICAgICogQHJlYWRvbmx5XHJcbiAgICAgKi9cclxuICAgIGdldCByZWFkeSgpIHtcclxuICAgICAgICAgICAgcmV0dXJuIHRoaXMuX3JlYWR5O1xyXG4gICAgfSxcclxuXHJcbiAgICAvKipcclxuICAgICAqIEdldHMgdGhlIGNyZWRpdCB0byBkaXNwbGF5IHdoZW4gdGhpcyBpbWFnZXJ5IHByb3ZpZGVyIGlzIGFjdGl2ZS4gIFR5cGljYWxseSB0aGlzIGlzIHVzZWQgdG8gY3JlZGl0XHJcbiAgICAgKiB0aGUgc291cmNlIG9mIHRoZSBpbWFnZXJ5LiAgVGhpcyBmdW5jdGlvbiBzaG91bGQgbm90IGJlIGNhbGxlZCBiZWZvcmUge0BsaW5rIENhbnZhc0ltYWdlcnlQcm92aWRlciNyZWFkeX0gcmV0dXJucyB0cnVlLlxyXG4gICAgICogQG1lbWJlcm9mIENhbnZhc0ltYWdlcnlQcm92aWRlci5wcm90b3R5cGVcclxuICAgICAqIEB0eXBlIHtDcmVkaXR9XHJcbiAgICAgKiBAcmVhZG9ubHlcclxuICAgICAqL1xyXG4gICAgZ2V0IGNyZWRpdCgpIHtcclxuICAgICAgICAgICAgcmV0dXJuIHRoaXMuX2NyZWRpdDtcclxuICAgIH0sXHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZXRzIGEgdmFsdWUgaW5kaWNhdGluZyB3aGV0aGVyIG9yIG5vdCB0aGUgaW1hZ2VzIHByb3ZpZGVkIGJ5IHRoaXMgaW1hZ2VyeSBwcm92aWRlclxyXG4gICAgICogaW5jbHVkZSBhbiBhbHBoYSBjaGFubmVsLiAgSWYgdGhpcyBwcm9wZXJ0eSBpcyBmYWxzZSwgYW4gYWxwaGEgY2hhbm5lbCwgaWYgcHJlc2VudCwgd2lsbFxyXG4gICAgICogYmUgaWdub3JlZC4gIElmIHRoaXMgcHJvcGVydHkgaXMgdHJ1ZSwgYW55IGltYWdlcyB3aXRob3V0IGFuIGFscGhhIGNoYW5uZWwgd2lsbCBiZSB0cmVhdGVkXHJcbiAgICAgKiBhcyBpZiB0aGVpciBhbHBoYSBpcyAxLjAgZXZlcnl3aGVyZS4gIFdoZW4gdGhpcyBwcm9wZXJ0eSBpcyBmYWxzZSwgbWVtb3J5IHVzYWdlXHJcbiAgICAgKiBhbmQgdGV4dHVyZSB1cGxvYWQgdGltZSBhcmUgcmVkdWNlZC5cclxuICAgICAqIEBtZW1iZXJvZiBDYW52YXNJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlXHJcbiAgICAgKiBAdHlwZSB7Qm9vbGVhbn1cclxuICAgICAqIEByZWFkb25seVxyXG4gICAgICovXHJcbiAgICBnZXQgaGFzQWxwaGFDaGFubmVsKCkge1xyXG4gICAgICAgICAgICByZXR1cm4gdHJ1ZTtcclxuICAgIH1cclxufTtcclxuXHJcbkNhbnZhc0ltYWdlcnlQcm92aWRlci5wcm90b3R5cGUuc2V0UmVjdGFuZ2xlID0gZnVuY3Rpb24gc2V0UmVjdGFuZ2xlKHJlY3RhbmdsZSkge1xyXG4gICAgXHJcbiAgICB0aGlzLl90aWxpbmdTY2hlbWUgPSBuZXcgQ2VzaXVtLkdlb2dyYXBoaWNUaWxpbmdTY2hlbWUoe1xyXG4gICAgICAgIHJlY3RhbmdsZTogcmVjdGFuZ2xlLFxyXG4gICAgICAgIG51bWJlck9mTGV2ZWxaZXJvVGlsZXNYOiAxLFxyXG4gICAgICAgIG51bWJlck9mTGV2ZWxaZXJvVGlsZXNZOiAxXHJcbiAgICB9KTtcclxuICAgIFxyXG4gICAgaWYgKCF0aGlzLl9yZWFkeSkge1xyXG4gICAgICAgIHRoaXMuX3JlYWR5ID0gdHJ1ZTtcclxuICAgICAgICBDZXNpdW0uVGlsZVByb3ZpZGVyRXJyb3IuaGFuZGxlU3VjY2Vzcyh0aGlzLl9lcnJvckV2ZW50KTtcclxuICAgIH1cclxufTtcclxuXHJcbkNhbnZhc0ltYWdlcnlQcm92aWRlci5wcm90b3R5cGUuZ2V0VGlsZVdpZHRoID0gZnVuY3Rpb24gZ2V0VGlsZVdpZHRoKCkge1xyXG4gICAgcmV0dXJuIHRoaXMudGlsZVdpZHRoO1xyXG59O1xyXG5cclxuQ2FudmFzSW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5nZXRUaWxlSGVpZ2h0ID0gZnVuY3Rpb24gZ2V0VGlsZUhlaWdodCgpIHtcclxuICAgIHJldHVybiB0aGlzLnRpbGVIZWlnaHQ7XHJcbn07XHJcblxyXG5DYW52YXNJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlLmdldE1heGltdW1MZXZlbCA9IGZ1bmN0aW9uIGdldE1heGltdW1MZXZlbCgpIHtcclxuICAgIHJldHVybiB0aGlzLm1heGltdW1MZXZlbDtcclxufTtcclxuXHJcbkNhbnZhc0ltYWdlcnlQcm92aWRlci5wcm90b3R5cGUuZ2V0TWluaW11bUxldmVsID0gZnVuY3Rpb24gZ2V0TWluaW11bUxldmVsKCkge1xyXG4gICAgcmV0dXJuIHRoaXMubWluaW11bUxldmVsO1xyXG59O1xyXG5cclxuQ2FudmFzSW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5pc1JlYWR5ID0gZnVuY3Rpb24gaXNSZWFkeSgpIHtcclxuICAgIHJldHVybiB0aGlzLnJlYWR5O1xyXG59O1xyXG5cclxuQ2FudmFzSW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5nZXRDcmVkaXQgPSBmdW5jdGlvbiBnZXRDcmVkaXQoKSB7XHJcbiAgICByZXR1cm4gdGhpcy5jcmVkaXQ7XHJcbn07XHJcblxyXG5DYW52YXNJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlLmdldFJlY3RhbmdsZSA9IGZ1bmN0aW9uIGdldFJlY3RhbmdsZSgpIHtcclxuICAgIHJldHVybiB0aGlzLnRpbGluZ1NjaGVtZS5yZWN0YW5nbGU7XHJcbn07XHJcblxyXG5DYW52YXNJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlLmdldFRpbGluZ1NjaGVtZSA9IGZ1bmN0aW9uIGdldFRpbGluZ1NjaGVtZSgpIHtcclxuICAgIHJldHVybiB0aGlzLnRpbGluZ1NjaGVtZTtcclxufTtcclxuXHJcbkNhbnZhc0ltYWdlcnlQcm92aWRlci5wcm90b3R5cGUuZ2V0VGlsZURpc2NhcmRQb2xpY3kgPSBmdW5jdGlvbiBnZXRUaWxlRGlzY2FyZFBvbGljeSgpIHtcclxuICAgIHJldHVybiB0aGlzLnRpbGVEaXNjYXJkUG9saWN5O1xyXG59O1xyXG5cclxuQ2FudmFzSW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5nZXRFcnJvckV2ZW50ID0gZnVuY3Rpb24gZ2V0RXJyb3JFdmVudCgpIHtcclxuICAgIHJldHVybiB0aGlzLmVycm9yRXZlbnQ7XHJcbn07XHJcblxyXG5DYW52YXNJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlLmdldEhhc0FscGhhQ2hhbm5lbCA9IGZ1bmN0aW9uIGdldEhhc0FscGhhQ2hhbm5lbCgpIHtcclxuICAgIHJldHVybiB0aGlzLmhhc0FscGhhQ2hhbm5lbDtcclxufTtcclxuXHJcbi8qKlxyXG4gKiBHZXRzIHRoZSBjcmVkaXRzIHRvIGJlIGRpc3BsYXllZCB3aGVuIGEgZ2l2ZW4gdGlsZSBpcyBkaXNwbGF5ZWQuXHJcbiAqXHJcbiAqIEBwYXJhbSB7TnVtYmVyfSB4IFRoZSB0aWxlIFggY29vcmRpbmF0ZS5cclxuICogQHBhcmFtIHtOdW1iZXJ9IHkgVGhlIHRpbGUgWSBjb29yZGluYXRlLlxyXG4gKiBAcGFyYW0ge051bWJlcn0gbGV2ZWwgVGhlIHRpbGUgbGV2ZWw7XHJcbiAqIEByZXR1cm5zIHtDcmVkaXRbXX0gVGhlIGNyZWRpdHMgdG8gYmUgZGlzcGxheWVkIHdoZW4gdGhlIHRpbGUgaXMgZGlzcGxheWVkLlxyXG4gKlxyXG4gKiBAZXhjZXB0aW9uIHtEZXZlbG9wZXJFcnJvcn0gPGNvZGU+Z2V0VGlsZUNyZWRpdHM8L2NvZGU+IG11c3Qgbm90IGJlIGNhbGxlZCBiZWZvcmUgdGhlIGltYWdlcnkgcHJvdmlkZXIgaXMgcmVhZHkuXHJcbiAqL1xyXG5DYW52YXNJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlLmdldFRpbGVDcmVkaXRzID0gZnVuY3Rpb24oeCwgeSwgbGV2ZWwpIHtcclxuICAgIHJldHVybiB1bmRlZmluZWQ7XHJcbn07XHJcblxyXG4vKipcclxuICogUmVxdWVzdHMgdGhlIGltYWdlIGZvciBhIGdpdmVuIHRpbGUuICBUaGlzIGZ1bmN0aW9uIHNob3VsZFxyXG4gKiBub3QgYmUgY2FsbGVkIGJlZm9yZSB7QGxpbmsgQ2FudmFzSW1hZ2VyeVByb3ZpZGVyI3JlYWR5fSByZXR1cm5zIHRydWUuXHJcbiAqXHJcbiAqIEBwYXJhbSB7TnVtYmVyfSB4IFRoZSB0aWxlIFggY29vcmRpbmF0ZS5cclxuICogQHBhcmFtIHtOdW1iZXJ9IHkgVGhlIHRpbGUgWSBjb29yZGluYXRlLlxyXG4gKiBAcGFyYW0ge051bWJlcn0gbGV2ZWwgVGhlIHRpbGUgbGV2ZWwuXHJcbiAqIEByZXR1cm5zIHtQcm9taXNlfSBBIHByb21pc2UgZm9yIHRoZSBpbWFnZSB0aGF0IHdpbGwgcmVzb2x2ZSB3aGVuIHRoZSBpbWFnZSBpcyBhdmFpbGFibGUsIG9yXHJcbiAqICAgICAgICAgIHVuZGVmaW5lZCBpZiB0aGVyZSBhcmUgdG9vIG1hbnkgYWN0aXZlIHJlcXVlc3RzIHRvIHRoZSBzZXJ2ZXIsIGFuZCB0aGUgcmVxdWVzdFxyXG4gKiAgICAgICAgICBzaG91bGQgYmUgcmV0cmllZCBsYXRlci4gIFRoZSByZXNvbHZlZCBpbWFnZSBtYXkgYmUgZWl0aGVyIGFuXHJcbiAqICAgICAgICAgIEltYWdlIG9yIGEgQ2FudmFzIERPTSBvYmplY3QuXHJcbiAqXHJcbiAqIEBleGNlcHRpb24ge0RldmVsb3BlckVycm9yfSA8Y29kZT5yZXF1ZXN0SW1hZ2U8L2NvZGU+IG11c3Qgbm90IGJlIGNhbGxlZCBiZWZvcmUgdGhlIGltYWdlcnkgcHJvdmlkZXIgaXMgcmVhZHkuXHJcbiAqL1xyXG5DYW52YXNJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlLnJlcXVlc3RJbWFnZSA9IGZ1bmN0aW9uKHgsIHksIGxldmVsKSB7XHJcbiAgICAvLz4+aW5jbHVkZVN0YXJ0KCdkZWJ1ZycsIHByYWdtYXMuZGVidWcpO1xyXG4gICAgaWYgKCF0aGlzLl9yZWFkeSkge1xyXG4gICAgICAgICAgICB0aHJvdyBuZXcgRGV2ZWxvcGVyRXJyb3IoJ3JlcXVlc3RJbWFnZSBtdXN0IG5vdCBiZSBjYWxsZWQgYmVmb3JlIHRoZSBpbWFnZXJ5IHByb3ZpZGVyIGlzIHJlYWR5LicpO1xyXG4gICAgfVxyXG4gICAgLy8+PmluY2x1ZGVFbmQoJ2RlYnVnJyk7XHJcblxyXG4gICAgcmV0dXJuIHRoaXMuX2NhbnZhcztcclxufTtcclxuXHJcbi8qKlxyXG4gKiBQaWNraW5nIGZlYXR1cmVzIGlzIG5vdCBjdXJyZW50bHkgc3VwcG9ydGVkIGJ5IHRoaXMgaW1hZ2VyeSBwcm92aWRlciwgc28gdGhpcyBmdW5jdGlvbiBzaW1wbHkgcmV0dXJuc1xyXG4gKiB1bmRlZmluZWQuXHJcbiAqXHJcbiAqIEBwYXJhbSB7TnVtYmVyfSB4IFRoZSB0aWxlIFggY29vcmRpbmF0ZS5cclxuICogQHBhcmFtIHtOdW1iZXJ9IHkgVGhlIHRpbGUgWSBjb29yZGluYXRlLlxyXG4gKiBAcGFyYW0ge051bWJlcn0gbGV2ZWwgVGhlIHRpbGUgbGV2ZWwuXHJcbiAqIEBwYXJhbSB7TnVtYmVyfSBsb25naXR1ZGUgVGhlIGxvbmdpdHVkZSBhdCB3aGljaCB0byBwaWNrIGZlYXR1cmVzLlxyXG4gKiBAcGFyYW0ge051bWJlcn0gbGF0aXR1ZGUgIFRoZSBsYXRpdHVkZSBhdCB3aGljaCB0byBwaWNrIGZlYXR1cmVzLlxyXG4gKiBAcmV0dXJuIHtQcm9taXNlfSBBIHByb21pc2UgZm9yIHRoZSBwaWNrZWQgZmVhdHVyZXMgdGhhdCB3aWxsIHJlc29sdmUgd2hlbiB0aGUgYXN5bmNocm9ub3VzXHJcbiAqICAgICAgICAgICAgICAgICAgIHBpY2tpbmcgY29tcGxldGVzLiAgVGhlIHJlc29sdmVkIHZhbHVlIGlzIGFuIGFycmF5IG9mIHtAbGluayBJbWFnZXJ5TGF5ZXJGZWF0dXJlSW5mb31cclxuICogICAgICAgICAgICAgICAgICAgaW5zdGFuY2VzLiAgVGhlIGFycmF5IG1heSBiZSBlbXB0eSBpZiBubyBmZWF0dXJlcyBhcmUgZm91bmQgYXQgdGhlIGdpdmVuIGxvY2F0aW9uLlxyXG4gKiAgICAgICAgICAgICAgICAgICBJdCBtYXkgYWxzbyBiZSB1bmRlZmluZWQgaWYgcGlja2luZyBpcyBub3Qgc3VwcG9ydGVkLlxyXG4gKi9cclxuQ2FudmFzSW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5waWNrRmVhdHVyZXMgPSBmdW5jdGlvbigpIHtcclxuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xyXG59OyIsIid1c2Ugc3RyaWN0JztcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gY2FsY3VsYXRlRnJ1c3R1bTtcclxuXHJcbi8qIGdsb2JhbCBDZXNpdW06IGZhbHNlICovXHJcblxyXG52YXIgaW1hZ2VIZWxwZXJGdW5jdGlvbnMgPSByZXF1aXJlKCdpbWFnZS1oZWxwZXItZnVuY3Rpb25zLmpzJyk7XHJcblxyXG52YXIgTUFYX1JFQ1VSU0lWRV9MRVZFTF9PTl9GQUlMRURfVFJBTlNGT1JNID0gNDtcclxuXHJcbmZ1bmN0aW9uIGNhbGN1bGF0ZUZydXN0dW0oY2VzaXVtV2lkZ2V0KSB7XHJcbiAgICB2YXIgc2NyZWVuU2l6ZSA9IHtcclxuICAgICAgICB4OiBjZXNpdW1XaWRnZXQuc2NlbmUuY2FudmFzLndpZHRoLFxyXG4gICAgICAgIHk6IGNlc2l1bVdpZGdldC5zY2VuZS5jYW52YXMuaGVpZ2h0XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICB2YXIgcG9pbnRzID0gW107XHJcbiAgICBzZWFyY2hCb3VuZGluZ1BvaW50cyhcclxuICAgICAgICAwLCAwLCBzY3JlZW5TaXplLngsIHNjcmVlblNpemUueSwgcG9pbnRzLCBjZXNpdW1XaWRnZXQsIC8qcmVjdXJzaXZlPSovMCk7XHJcblxyXG4gICAgdmFyIGZydXN0dW1SZWN0YW5nbGUgPSBDZXNpdW0uUmVjdGFuZ2xlLmZyb21DYXJ0b2dyYXBoaWNBcnJheShwb2ludHMpO1xyXG4gICAgaWYgKGZydXN0dW1SZWN0YW5nbGUuZWFzdCA8IGZydXN0dW1SZWN0YW5nbGUud2VzdCB8fCBmcnVzdHVtUmVjdGFuZ2xlLm5vcnRoIDwgZnJ1c3R1bVJlY3RhbmdsZS5zb3V0aCkge1xyXG4gICAgICAgIGZydXN0dW1SZWN0YW5nbGUgPSB7XHJcbiAgICAgICAgICAgIGVhc3Q6IE1hdGgubWF4KGZydXN0dW1SZWN0YW5nbGUuZWFzdCwgZnJ1c3R1bVJlY3RhbmdsZS53ZXN0KSxcclxuICAgICAgICAgICAgd2VzdDogTWF0aC5taW4oZnJ1c3R1bVJlY3RhbmdsZS5lYXN0LCBmcnVzdHVtUmVjdGFuZ2xlLndlc3QpLFxyXG4gICAgICAgICAgICBub3J0aDogTWF0aC5tYXgoZnJ1c3R1bVJlY3RhbmdsZS5ub3J0aCwgZnJ1c3R1bVJlY3RhbmdsZS5zb3V0aCksXHJcbiAgICAgICAgICAgIHNvdXRoOiBNYXRoLm1pbihmcnVzdHVtUmVjdGFuZ2xlLm5vcnRoLCBmcnVzdHVtUmVjdGFuZ2xlLnNvdXRoKVxyXG4gICAgICAgIH07XHJcbiAgICB9XHJcblxyXG4gICAgdmFyIGZydXN0dW1EYXRhID0gaW1hZ2VIZWxwZXJGdW5jdGlvbnMuY2FsY3VsYXRlRnJ1c3R1bTJERnJvbUJvdW5kcyhcclxuICAgICAgICBmcnVzdHVtUmVjdGFuZ2xlLCBzY3JlZW5TaXplKTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgcmV0dXJuIGZydXN0dW1EYXRhO1xyXG59XHJcbiAgICBcclxuZnVuY3Rpb24gc2VhcmNoQm91bmRpbmdQb2ludHMoXHJcbiAgICBtaW5YLCBtaW5ZLCBtYXhYLCBtYXhZLCBwb2ludHMsIGNlc2l1bVdpZGdldCwgcmVjdXJzaXZlTGV2ZWwpIHtcclxuICAgIFxyXG4gICAgdmFyIHRyYW5zZm9ybWVkUG9pbnRzID0gMDtcclxuICAgIHRyYW5zZm9ybWVkUG9pbnRzICs9IHRyYW5zZm9ybUFuZEFkZFBvaW50KFxyXG4gICAgICAgIG1pblgsIG1pblksIGNlc2l1bVdpZGdldCwgcG9pbnRzKTtcclxuICAgIHRyYW5zZm9ybWVkUG9pbnRzICs9IHRyYW5zZm9ybUFuZEFkZFBvaW50KFxyXG4gICAgICAgIG1heFgsIG1pblksIGNlc2l1bVdpZGdldCwgcG9pbnRzKTtcclxuICAgIHRyYW5zZm9ybWVkUG9pbnRzICs9IHRyYW5zZm9ybUFuZEFkZFBvaW50KFxyXG4gICAgICAgIG1pblgsIG1heFksIGNlc2l1bVdpZGdldCwgcG9pbnRzKTtcclxuICAgIHRyYW5zZm9ybWVkUG9pbnRzICs9IHRyYW5zZm9ybUFuZEFkZFBvaW50KFxyXG4gICAgICAgIG1heFgsIG1heFksIGNlc2l1bVdpZGdldCwgcG9pbnRzKTtcclxuXHJcbiAgICB2YXIgbWF4TGV2ZWwgPSBNQVhfUkVDVVJTSVZFX0xFVkVMX09OX0ZBSUxFRF9UUkFOU0ZPUk07XHJcbiAgICBcclxuICAgIGlmICh0cmFuc2Zvcm1lZFBvaW50cyA9PT0gNCB8fCByZWN1cnNpdmVMZXZlbCA+PSBtYXhMZXZlbCkge1xyXG4gICAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIFxyXG4gICAgKytyZWN1cnNpdmVMZXZlbDtcclxuICAgIFxyXG4gICAgdmFyIG1pZGRsZVggPSAobWluWCArIG1heFgpIC8gMjtcclxuICAgIHZhciBtaWRkbGVZID0gKG1pblkgKyBtYXhZKSAvIDI7XHJcbiAgICBcclxuICAgIHNlYXJjaEJvdW5kaW5nUG9pbnRzKFxyXG4gICAgICAgIG1pblgsIG1pblksIG1pZGRsZVgsIG1pZGRsZVksIHBvaW50cywgY2VzaXVtV2lkZ2V0LCByZWN1cnNpdmVMZXZlbCk7XHJcblxyXG4gICAgc2VhcmNoQm91bmRpbmdQb2ludHMoXHJcbiAgICAgICAgbWluWCwgbWlkZGxlWSwgbWlkZGxlWCwgbWF4WSwgcG9pbnRzLCBjZXNpdW1XaWRnZXQsIHJlY3Vyc2l2ZUxldmVsKTtcclxuXHJcbiAgICBzZWFyY2hCb3VuZGluZ1BvaW50cyhcclxuICAgICAgICBtaWRkbGVYLCBtaW5ZLCBtYXhYLCBtaWRkbGVZLCBwb2ludHMsIGNlc2l1bVdpZGdldCwgcmVjdXJzaXZlTGV2ZWwpO1xyXG5cclxuICAgIHNlYXJjaEJvdW5kaW5nUG9pbnRzKFxyXG4gICAgICAgIG1pZGRsZVgsIG1pZGRsZVksIG1heFgsIG1heFksIHBvaW50cywgY2VzaXVtV2lkZ2V0LCByZWN1cnNpdmVMZXZlbCk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIHRyYW5zZm9ybUFuZEFkZFBvaW50KHgsIHksIGNlc2l1bVdpZGdldCwgcG9pbnRzKSB7XHJcbiAgICBcclxuICAgIHZhciBzY3JlZW5Qb2ludCA9IG5ldyBDZXNpdW0uQ2FydGVzaWFuMih4LCB5KTtcclxuICAgIHZhciBlbGxpcHNvaWQgPSBjZXNpdW1XaWRnZXQuc2NlbmUubWFwUHJvamVjdGlvbi5lbGxpcHNvaWQ7XHJcbiAgICB2YXIgcG9pbnQzRCA9IGNlc2l1bVdpZGdldC5zY2VuZS5jYW1lcmEucGlja0VsbGlwc29pZChzY3JlZW5Qb2ludCwgZWxsaXBzb2lkKTtcclxuICAgIFxyXG4gICAgaWYgKHBvaW50M0QgPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIHJldHVybiAwO1xyXG4gICAgfVxyXG5cclxuICAgIHZhciBjYXJ0ZXNpYW4gPSBlbGxpcHNvaWQuY2FydGVzaWFuVG9DYXJ0b2dyYXBoaWMocG9pbnQzRCk7XHJcbiAgICBpZiAoY2FydGVzaWFuID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICByZXR1cm4gMDtcclxuICAgIH1cclxuICAgIFxyXG4gICAgcG9pbnRzLnB1c2goY2FydGVzaWFuKTtcclxuICAgIHJldHVybiAxO1xyXG59IiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBDZXNpdW1JbWFnZURlY29kZXJMYXllck1hbmFnZXI7XHJcblxyXG52YXIgQ2FudmFzSW1hZ2VyeVByb3ZpZGVyID0gcmVxdWlyZSgnY2FudmFzLWltYWdlcnktcHJvdmlkZXIuanMnKTtcclxudmFyIEltYWdlVmlld2VyID0gcmVxdWlyZSgnaW1hZ2Utdmlld2VyLmpzJyk7XHJcbnZhciBjYWxjdWxhdGVDZXNpdW1GcnVzdHVtID0gcmVxdWlyZSgnY2VzaXVtLWZydXN0dW0tY2FsY3VsYXRvci5qcycpO1xyXG5cclxuLyogZ2xvYmFsIENlc2l1bTogZmFsc2UgKi9cclxuXHJcbmZ1bmN0aW9uIENlc2l1bUltYWdlRGVjb2RlckxheWVyTWFuYWdlcihpbWFnZURlY29kZXIsIG9wdGlvbnMpIHtcclxuICAgIHRoaXMuX29wdGlvbnMgPSBvcHRpb25zIHx8IHt9O1xyXG4gICAgXHJcbiAgICBpZiAodGhpcy5fb3B0aW9ucy5yZWN0YW5nbGUgIT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIHRoaXMuX29wdGlvbnMgPSBKU09OLnBhcnNlKEpTT04uc3RyaW5naWZ5KG9wdGlvbnMpKTtcclxuICAgICAgICB0aGlzLl9vcHRpb25zLmNhcnRvZ3JhcGhpY0JvdW5kcyA9IHtcclxuICAgICAgICAgICAgd2VzdDogb3B0aW9ucy5yZWN0YW5nbGUud2VzdCxcclxuICAgICAgICAgICAgZWFzdDogb3B0aW9ucy5yZWN0YW5nbGUuZWFzdCxcclxuICAgICAgICAgICAgc291dGg6IG9wdGlvbnMucmVjdGFuZ2xlLnNvdXRoLFxyXG4gICAgICAgICAgICBub3J0aDogb3B0aW9ucy5yZWN0YW5nbGUubm9ydGhcclxuICAgICAgICB9O1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICB0aGlzLl9vcHRpb25zLm1pbkZ1bmN0aW9uQ2FsbEludGVydmFsTWlsbGlzZWNvbmRzID1cclxuICAgICAgICBvcHRpb25zLm1pbkZ1bmN0aW9uQ2FsbEludGVydmFsTWlsbGlzZWNvbmRzIHx8IDEwMDtcclxuICAgIHRoaXMuX3VybCA9IG9wdGlvbnMudXJsO1xyXG5cclxuICAgIHRoaXMuX3RhcmdldENhbnZhcyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2NhbnZhcycpO1xyXG4gICAgdGhpcy5faW1hZ2VyeVByb3ZpZGVycyA9IFtcclxuICAgICAgICBuZXcgQ2FudmFzSW1hZ2VyeVByb3ZpZGVyKHRoaXMuX3RhcmdldENhbnZhcyksXHJcbiAgICAgICAgbmV3IENhbnZhc0ltYWdlcnlQcm92aWRlcih0aGlzLl90YXJnZXRDYW52YXMpXHJcbiAgICBdO1xyXG4gICAgdGhpcy5faW1hZ2VyeUxheWVyU2hvd24gPSBuZXcgQ2VzaXVtLkltYWdlcnlMYXllcih0aGlzLl9pbWFnZXJ5UHJvdmlkZXJzWzBdKTtcclxuICAgIHRoaXMuX2ltYWdlcnlMYXllclBlbmRpbmcgPSBuZXcgQ2VzaXVtLkltYWdlcnlMYXllcih0aGlzLl9pbWFnZXJ5UHJvdmlkZXJzWzFdKTtcclxuXHJcbiAgICB0aGlzLl9jYW52YXNVcGRhdGVkQ2FsbGJhY2tCb3VuZCA9IHRoaXMuX2NhbnZhc1VwZGF0ZWRDYWxsYmFjay5iaW5kKHRoaXMpO1xyXG4gICAgXHJcbiAgICB0aGlzLl9pc1BlbmRpbmdVcGRhdGVDYWxsYmFjayA9IGZhbHNlO1xyXG4gICAgdGhpcy5faXNXaGlsZVJlcGxhY2VMYXllclNob3duID0gZmFsc2U7XHJcbiAgICB0aGlzLl9wZW5kaW5nUG9zaXRpb25SZWN0YW5nbGUgPSBudWxsO1xyXG4gICAgXHJcbiAgICB0aGlzLl9pbWFnZVZpZXdlciA9IG5ldyBJbWFnZVZpZXdlcihcclxuICAgICAgICBpbWFnZURlY29kZXIsXHJcbiAgICAgICAgdGhpcy5fY2FudmFzVXBkYXRlZENhbGxiYWNrQm91bmQsXHJcbiAgICAgICAgdGhpcy5fb3B0aW9ucyk7XHJcbiAgICBcclxuICAgIHRoaXMuX2ltYWdlVmlld2VyLnNldFRhcmdldENhbnZhcyh0aGlzLl90YXJnZXRDYW52YXMpO1xyXG4gICAgXHJcbiAgICB0aGlzLl91cGRhdGVGcnVzdHVtQm91bmQgPSB0aGlzLl91cGRhdGVGcnVzdHVtLmJpbmQodGhpcyk7XHJcbiAgICB0aGlzLl9wb3N0UmVuZGVyQm91bmQgPSB0aGlzLl9wb3N0UmVuZGVyLmJpbmQodGhpcyk7XHJcbn1cclxuXHJcbkNlc2l1bUltYWdlRGVjb2RlckxheWVyTWFuYWdlci5wcm90b3R5cGUuc2V0RXhjZXB0aW9uQ2FsbGJhY2sgPSBmdW5jdGlvbiBzZXRFeGNlcHRpb25DYWxsYmFjayhleGNlcHRpb25DYWxsYmFjaykge1xyXG4gICAgdGhpcy5faW1hZ2VWaWV3ZXIuc2V0RXhjZXB0aW9uQ2FsbGJhY2soZXhjZXB0aW9uQ2FsbGJhY2spO1xyXG59O1xyXG5cclxuQ2VzaXVtSW1hZ2VEZWNvZGVyTGF5ZXJNYW5hZ2VyLnByb3RvdHlwZS5vcGVuID0gZnVuY3Rpb24gb3Blbih3aWRnZXRPclZpZXdlcikge1xyXG4gICAgdGhpcy5fd2lkZ2V0ID0gd2lkZ2V0T3JWaWV3ZXI7XHJcbiAgICB0aGlzLl9sYXllcnMgPSB3aWRnZXRPclZpZXdlci5zY2VuZS5pbWFnZXJ5TGF5ZXJzO1xyXG4gICAgd2lkZ2V0T3JWaWV3ZXIuc2NlbmUucG9zdFJlbmRlci5hZGRFdmVudExpc3RlbmVyKHRoaXMuX3Bvc3RSZW5kZXJCb3VuZCk7XHJcbiAgICBcclxuICAgIHRoaXMuX2ltYWdlVmlld2VyLm9wZW4odGhpcy5fdXJsKTtcclxuICAgIHRoaXMuX2xheWVycy5hZGQodGhpcy5faW1hZ2VyeUxheWVyU2hvd24pO1xyXG4gICAgXHJcbiAgICAvLyBOT1RFOiBJcyB0aGVyZSBhbiBldmVudCBoYW5kbGVyIHRvIHJlZ2lzdGVyIGluc3RlYWQ/XHJcbiAgICAvLyAoQ2VzaXVtJ3MgZXZlbnQgY29udHJvbGxlcnMgb25seSBleHBvc2Uga2V5Ym9hcmQgYW5kIG1vdXNlXHJcbiAgICAvLyBldmVudHMsIGJ1dCB0aGVyZSBpcyBubyBldmVudCBmb3IgZnJ1c3R1bSBjaGFuZ2VkXHJcbiAgICAvLyBwcm9ncmFtbWF0aWNhbGx5KS5cclxuICAgIHRoaXMuX2ludGVydmFsSGFuZGxlID0gc2V0SW50ZXJ2YWwoXHJcbiAgICAgICAgdGhpcy5fdXBkYXRlRnJ1c3R1bUJvdW5kLFxyXG4gICAgICAgIDUwMCk7XHJcbn07XHJcblxyXG5DZXNpdW1JbWFnZURlY29kZXJMYXllck1hbmFnZXIucHJvdG90eXBlLmNsb3NlID0gZnVuY3Rpb24gY2xvc2UoKSB7XHJcbiAgICB0aGlzLl9pbWFnZVZpZXdlci5jbG9zZSgpO1xyXG4gICAgY2xlYXJJbnRlcnZhbCh0aGlzLl9pbnRlcnZhbEhhbmRsZSk7XHJcblxyXG4gICAgdGhpcy5fbGF5ZXJzLnJlbW92ZSh0aGlzLl9pbWFnZXJ5TGF5ZXJTaG93bik7XHJcbiAgICB0aGlzLl93aWRnZXQucmVtb3ZlRXZlbnRMaXN0ZW5lcih0aGlzLl9wb3N0UmVuZGVyQm91bmQpO1xyXG4gICAgaWYgKHRoaXMuX2lzV2hpbGVSZXBsYWNlTGF5ZXJTaG93bikge1xyXG4gICAgICAgIHRoaXMuX2lzV2hpbGVSZXBsYWNlTGF5ZXJTaG93biA9IGZhbHNlO1xyXG4gICAgICAgIHRoaXMuX2lzUGVuZGluZ1VwZGF0ZUNhbGxiYWNrID0gZmFsc2U7XHJcbiAgICAgICAgdGhpcy5fbGF5ZXJzLnJlbW92ZSh0aGlzLl9pbWFnZXJ5TGF5ZXJQZW5kaW5nKTtcclxuICAgIH1cclxufTtcclxuXHJcbkNlc2l1bUltYWdlRGVjb2RlckxheWVyTWFuYWdlci5wcm90b3R5cGUuZ2V0SW1hZ2VyeUxheWVycyA9IGZ1bmN0aW9uIGdldEltYWdlcnlMYXllcnMoKSB7XHJcbiAgICByZXR1cm4gW3RoaXMuX2ltYWdlcnlMYXllclNob3duLCB0aGlzLl9pbWFnZXJ5TGF5ZXJQZW5kaW5nXTtcclxufTtcclxuXHJcbkNlc2l1bUltYWdlRGVjb2RlckxheWVyTWFuYWdlci5wcm90b3R5cGUuX3VwZGF0ZUZydXN0dW0gPSBmdW5jdGlvbiB1cGRhdGVGcnVzdHVtKCkge1xyXG4gICAgdmFyIGZydXN0dW0gPSBjYWxjdWxhdGVDZXNpdW1GcnVzdHVtKHRoaXMuX3dpZGdldCk7XHJcbiAgICBpZiAoZnJ1c3R1bSAhPT0gbnVsbCkge1xyXG4gICAgICAgIHRoaXMuX2ltYWdlVmlld2VyLnVwZGF0ZVZpZXdBcmVhKGZydXN0dW0pO1xyXG4gICAgfVxyXG59O1xyXG5cclxuQ2VzaXVtSW1hZ2VEZWNvZGVyTGF5ZXJNYW5hZ2VyLnByb3RvdHlwZS5fY2FudmFzVXBkYXRlZENhbGxiYWNrID0gZnVuY3Rpb24gY2FudmFzVXBkYXRlZENhbGxiYWNrKG5ld1Bvc2l0aW9uKSB7XHJcbiAgICBpZiAodGhpcy5faXNXaGlsZVJlcGxhY2VMYXllclNob3duKSB7XHJcbiAgICAgICAgdGhpcy5faXNQZW5kaW5nVXBkYXRlQ2FsbGJhY2sgPSB0cnVlO1xyXG4gICAgICAgIHRoaXMuX3BlbmRpbmdQb3NpdGlvblJlY3RhbmdsZSA9IG5ld1Bvc2l0aW9uO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBpZiAobmV3UG9zaXRpb24gIT09IG51bGwpIHtcclxuICAgICAgICB2YXIgcmVjdGFuZ2xlID0gbmV3IENlc2l1bS5SZWN0YW5nbGUoXHJcbiAgICAgICAgICAgIG5ld1Bvc2l0aW9uLndlc3QsXHJcbiAgICAgICAgICAgIG5ld1Bvc2l0aW9uLnNvdXRoLFxyXG4gICAgICAgICAgICBuZXdQb3NpdGlvbi5lYXN0LFxyXG4gICAgICAgICAgICBuZXdQb3NpdGlvbi5ub3J0aCk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgdGhpcy5faW1hZ2VyeVByb3ZpZGVyc1swXS5zZXRSZWN0YW5nbGUocmVjdGFuZ2xlKTtcclxuICAgICAgICB0aGlzLl9pbWFnZXJ5UHJvdmlkZXJzWzFdLnNldFJlY3RhbmdsZShyZWN0YW5nbGUpO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICB0aGlzLl9yZW1vdmVBbmRSZUFkZExheWVyKCk7XHJcbn07XHJcblxyXG5DZXNpdW1JbWFnZURlY29kZXJMYXllck1hbmFnZXIucHJvdG90eXBlLl9yZW1vdmVBbmRSZUFkZExheWVyID0gZnVuY3Rpb24gcmVtb3ZlQW5kUmVBZGRMYXllcigpIHtcclxuICAgIHZhciBpbmRleCA9IHRoaXMuX2xheWVycy5pbmRleE9mKHRoaXMuX2ltYWdlcnlMYXllclNob3duKTtcclxuICAgIFxyXG4gICAgaWYgKGluZGV4IDwgMCkge1xyXG4gICAgICAgIHRocm93ICdMYXllciB3YXMgcmVtb3ZlZCBmcm9tIHZpZXdlclxcJ3MgbGF5ZXJzICB3aXRob3V0ICcgK1xyXG4gICAgICAgICAgICAnY2xvc2luZyBsYXllciBtYW5hZ2VyLiBVc2UgQ2VzaXVtSW1hZ2VEZWNvZGVyTGF5ZXJNYW5hZ2VyLicgK1xyXG4gICAgICAgICAgICAnY2xvc2UoKSBpbnN0ZWFkJztcclxuICAgIH1cclxuICAgIFxyXG4gICAgdGhpcy5faXNXaGlsZVJlcGxhY2VMYXllclNob3duID0gdHJ1ZTtcclxuICAgIHRoaXMuX2xheWVycy5hZGQodGhpcy5faW1hZ2VyeUxheWVyUGVuZGluZywgaW5kZXgpO1xyXG59O1xyXG5cclxuQ2VzaXVtSW1hZ2VEZWNvZGVyTGF5ZXJNYW5hZ2VyLnByb3RvdHlwZS5fcG9zdFJlbmRlciA9IGZ1bmN0aW9uIHBvc3RSZW5kZXIoKSB7XHJcbiAgICBpZiAoIXRoaXMuX2lzV2hpbGVSZXBsYWNlTGF5ZXJTaG93bilcclxuICAgICAgICByZXR1cm47XHJcbiAgICBcclxuICAgIHRoaXMuX2lzV2hpbGVSZXBsYWNlTGF5ZXJTaG93biA9IGZhbHNlO1xyXG4gICAgdGhpcy5fbGF5ZXJzLnJlbW92ZSh0aGlzLl9pbWFnZXJ5TGF5ZXJTaG93biwgLypkZXN0cm95PSovZmFsc2UpO1xyXG4gICAgXHJcbiAgICB2YXIgc3dhcCA9IHRoaXMuX2ltYWdlcnlMYXllclNob3duO1xyXG4gICAgdGhpcy5faW1hZ2VyeUxheWVyU2hvd24gPSB0aGlzLl9pbWFnZXJ5TGF5ZXJQZW5kaW5nO1xyXG4gICAgdGhpcy5faW1hZ2VyeUxheWVyUGVuZGluZyA9IHN3YXA7XHJcbiAgICBcclxuICAgIGlmICh0aGlzLl9pc1BlbmRpbmdVcGRhdGVDYWxsYmFjaykge1xyXG4gICAgICAgIHRoaXMuX2lzUGVuZGluZ1VwZGF0ZUNhbGxiYWNrID0gZmFsc2U7XHJcbiAgICAgICAgdGhpcy5fY2FudmFzVXBkYXRlZENhbGxiYWNrKHRoaXMuX3BlbmRpbmdQb3NpdGlvblJlY3RhbmdsZSk7XHJcbiAgICB9XHJcbn07IiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBJbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXI7XHJcblxyXG52YXIgY2FsY3VsYXRlQ2VzaXVtRnJ1c3R1bSA9IHJlcXVpcmUoJ2Nlc2l1bS1mcnVzdHVtLWNhbGN1bGF0b3IuanMnKTtcclxudmFyIGltYWdlSGVscGVyRnVuY3Rpb25zID0gcmVxdWlyZSgnaW1hZ2UtaGVscGVyLWZ1bmN0aW9ucy5qcycpO1xyXG5cclxuLyogZ2xvYmFsIENlc2l1bTogZmFsc2UgKi9cclxuLyogZ2xvYmFsIERldmVsb3BlckVycm9yOiBmYWxzZSAqL1xyXG4vKiBnbG9iYWwgQ3JlZGl0OiBmYWxzZSAqL1xyXG4vKiBnbG9iYWwgUHJvbWlzZTogZmFsc2UgKi9cclxuXHJcbi8qKlxyXG4gKiBQcm92aWRlcyBhIEltYWdlRGVjb2RlciBjbGllbnQgaW1hZ2VyeSB0aWxlLiAgVGhlIGltYWdlIGlzIGFzc3VtZWQgdG8gdXNlIGFcclxuICoge0BsaW5rIEdlb2dyYXBoaWNUaWxpbmdTY2hlbWV9LlxyXG4gKlxyXG4gKiBAYWxpYXMgSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyXHJcbiAqIEBjb25zdHJ1Y3RvclxyXG4gKlxyXG4gKiBAcGFyYW0ge09iamVjdH0gb3B0aW9ucyBPYmplY3Qgd2l0aCB0aGUgZm9sbG93aW5nIHByb3BlcnRpZXM6XHJcbiAqIEBwYXJhbSB7U3RyaW5nfSBvcHRpb25zLnVybCBUaGUgdXJsIGZvciB0aGUgdGlsZS5cclxuICogQHBhcmFtIHtSZWN0YW5nbGV9IFtvcHRpb25zLnJlY3RhbmdsZT1SZWN0YW5nbGUuTUFYX1ZBTFVFXSBUaGUgcmVjdGFuZ2xlLCBpbiByYWRpYW5zLCBjb3ZlcmVkIGJ5IHRoZSBpbWFnZS5cclxuICogQHBhcmFtIHtDcmVkaXR8U3RyaW5nfSBbb3B0aW9ucy5jcmVkaXRdIEEgY3JlZGl0IGZvciB0aGUgZGF0YSBzb3VyY2UsIHdoaWNoIGlzIGRpc3BsYXllZCBvbiB0aGUgY2FudmFzLlxyXG4gKiBAcGFyYW0ge09iamVjdH0gW29wdGlvbnMucHJveHldIEEgcHJveHkgdG8gdXNlIGZvciByZXF1ZXN0cy4gVGhpcyBvYmplY3QgaXMgZXhwZWN0ZWQgdG8gaGF2ZSBhIGdldFVSTCBmdW5jdGlvbiB3aGljaCByZXR1cm5zIHRoZSBwcm94aWVkIFVSTCwgaWYgbmVlZGVkLlxyXG4gKiBAcGFyYW0ge2Jvb2xlYW59IFtvcHRpb25zLmFkYXB0UHJvcG9ydGlvbnNdIGRldGVybWluZXMgaWYgdG8gYWRhcHQgdGhlIHByb3BvcnRpb25zIG9mIHRoZSByZWN0YW5nbGUgcHJvdmlkZWQgdG8gdGhlIGltYWdlIHBpeGVscyBwcm9wb3J0aW9ucy5cclxuICpcclxuICogQHNlZSBBcmNHaXNNYXBTZXJ2ZXJJbWFnZXJ5UHJvdmlkZXJcclxuICogQHNlZSBCaW5nTWFwc0ltYWdlcnlQcm92aWRlclxyXG4gKiBAc2VlIEdvb2dsZUVhcnRoSW1hZ2VyeVByb3ZpZGVyXHJcbiAqIEBzZWUgT3BlblN0cmVldE1hcEltYWdlcnlQcm92aWRlclxyXG4gKiBAc2VlIFRpbGVNYXBTZXJ2aWNlSW1hZ2VyeVByb3ZpZGVyXHJcbiAqIEBzZWUgV2ViTWFwU2VydmljZUltYWdlcnlQcm92aWRlclxyXG4gKi9cclxuZnVuY3Rpb24gSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyKGltYWdlLCBvcHRpb25zKSB7XHJcbiAgICB2YXIgdXJsID0gb3B0aW9ucy51cmw7XHJcbiAgICB0aGlzLl9hZGFwdFByb3BvcnRpb25zID0gb3B0aW9ucy5hZGFwdFByb3BvcnRpb25zO1xyXG4gICAgdGhpcy5fcmVjdGFuZ2xlID0gb3B0aW9ucy5yZWN0YW5nbGU7XHJcbiAgICB0aGlzLl9wcm94eSA9IG9wdGlvbnMucHJveHk7XHJcbiAgICB0aGlzLl91cGRhdGVGcnVzdHVtSW50ZXJ2YWwgPSAxMDAwIHx8IG9wdGlvbnMudXBkYXRlRnJ1c3R1bUludGVydmFsO1xyXG4gICAgdGhpcy5fY3JlZGl0ID0gb3B0aW9ucy5jcmVkaXQ7XHJcbiAgICBcclxuICAgIGlmICh0eXBlb2YgdGhpcy5fY3JlZGl0ID09PSAnc3RyaW5nJykge1xyXG4gICAgICAgIHRoaXMuX2NyZWRpdCA9IG5ldyBDcmVkaXQodGhpcy5fY3JlZGl0KTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgaWYgKHRoaXMuX3JlY3RhbmdsZSA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgdGhpcy5fcmVjdGFuZ2xlID0gQ2VzaXVtLlJlY3RhbmdsZS5mcm9tRGVncmVlcygtMTgwLCAtOTAsIDE4MCwgOTApO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBpZiAodGhpcy5fYWRhcHRQcm9wb3J0aW9ucyA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgdGhpcy5fYWRhcHRQcm9wb3J0aW9ucyA9IHRydWU7XHJcbiAgICB9XHJcblxyXG4gICAgb3B0aW9ucyA9IEpTT04ucGFyc2UoSlNPTi5zdHJpbmdpZnkob3B0aW9ucyB8fCB7fSkpO1xyXG4gICAgb3B0aW9ucy5jYXJ0b2dyYXBoaWNCb3VuZHMgPSB7XHJcbiAgICAgICAgd2VzdDogdGhpcy5fcmVjdGFuZ2xlLndlc3QsXHJcbiAgICAgICAgZWFzdDogdGhpcy5fcmVjdGFuZ2xlLmVhc3QsXHJcbiAgICAgICAgc291dGg6IHRoaXMuX3JlY3RhbmdsZS5zb3V0aCxcclxuICAgICAgICBub3J0aDogdGhpcy5fcmVjdGFuZ2xlLm5vcnRoXHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICAvLz4+aW5jbHVkZVN0YXJ0KCdkZWJ1ZycsIHByYWdtYXMuZGVidWcpO1xyXG4gICAgaWYgKHVybCA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgICAgIHRocm93IG5ldyBEZXZlbG9wZXJFcnJvcigndXJsIGlzIHJlcXVpcmVkLicpO1xyXG4gICAgfVxyXG4gICAgLy8+PmluY2x1ZGVFbmQoJ2RlYnVnJyk7XHJcblxyXG4gICAgdGhpcy5fdXJsID0gdXJsO1xyXG5cclxuICAgIHRoaXMuX3RpbGluZ1NjaGVtZSA9IHVuZGVmaW5lZDtcclxuXHJcbiAgICB0aGlzLl90aWxlV2lkdGggPSAwO1xyXG4gICAgdGhpcy5fdGlsZUhlaWdodCA9IDA7XHJcblxyXG4gICAgdGhpcy5fZXJyb3JFdmVudCA9IG5ldyBFdmVudCgnSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyU3RhdHVzJyk7XHJcblxyXG4gICAgdGhpcy5fcmVhZHkgPSBmYWxzZTtcclxuICAgIHRoaXMuX2V4Y2VwdGlvbkNhbGxiYWNrID0gbnVsbDtcclxuICAgIHRoaXMuX2Nlc2l1bVdpZGdldCA9IG51bGw7XHJcbiAgICB0aGlzLl91cGRhdGVGcnVzdHVtSW50ZXJ2YWxIYW5kbGUgPSBudWxsO1xyXG4gICAgXHJcblxyXG4gICAgdmFyIGltYWdlVXJsID0gdXJsO1xyXG4gICAgaWYgKHRoaXMuX3Byb3h5ICE9PSB1bmRlZmluZWQpIHtcclxuICAgICAgICAvLyBOT1RFOiBJcyB0aGF0IHRoZSBjb3JyZWN0IGxvZ2ljP1xyXG4gICAgICAgIGltYWdlVXJsID0gdGhpcy5fcHJveHkuZ2V0VVJMKGltYWdlVXJsKTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgdGhpcy5faW1hZ2UgPSBpbWFnZTtcclxuICAgIHRoaXMuX3VybCA9IGltYWdlVXJsO1xyXG59XHJcblxyXG5JbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlID0ge1xyXG4gICAgLyoqXHJcbiAgICAgKiBHZXRzIHRoZSBVUkwgb2YgdGhlIEltYWdlRGVjb2RlciBzZXJ2ZXIgKGluY2x1ZGluZyB0YXJnZXQpLlxyXG4gICAgICogQG1lbWJlcm9mIEltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlci5wcm90b3R5cGVcclxuICAgICAqIEB0eXBlIHtTdHJpbmd9XHJcbiAgICAgKiBAcmVhZG9ubHlcclxuICAgICAqL1xyXG4gICAgZ2V0IHVybCgpIHtcclxuICAgICAgICByZXR1cm4gdGhpcy5fdXJsO1xyXG4gICAgfSxcclxuXHJcbiAgICAvKipcclxuICAgICAqIEdldHMgdGhlIHByb3h5IHVzZWQgYnkgdGhpcyBwcm92aWRlci5cclxuICAgICAqIEBtZW1iZXJvZiBJbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlXHJcbiAgICAgKiBAdHlwZSB7UHJveHl9XHJcbiAgICAgKiBAcmVhZG9ubHlcclxuICAgICAqL1xyXG4gICAgZ2V0IHByb3h5KCkge1xyXG4gICAgICAgIHJldHVybiB0aGlzLl9wcm94eTtcclxuICAgIH0sXHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZXRzIHRoZSB3aWR0aCBvZiBlYWNoIHRpbGUsIGluIHBpeGVscy4gVGhpcyBmdW5jdGlvbiBzaG91bGRcclxuICAgICAqIG5vdCBiZSBjYWxsZWQgYmVmb3JlIHtAbGluayBJbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIjcmVhZHl9IHJldHVybnMgdHJ1ZS5cclxuICAgICAqIEBtZW1iZXJvZiBJbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlXHJcbiAgICAgKiBAdHlwZSB7TnVtYmVyfVxyXG4gICAgICogQHJlYWRvbmx5XHJcbiAgICAgKi9cclxuICAgIGdldCB0aWxlV2lkdGgoKSB7XHJcbiAgICAgICAgLy8+PmluY2x1ZGVTdGFydCgnZGVidWcnLCBwcmFnbWFzLmRlYnVnKTtcclxuICAgICAgICBpZiAoIXRoaXMuX3JlYWR5KSB7XHJcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRGV2ZWxvcGVyRXJyb3IoJ3RpbGVXaWR0aCBtdXN0IG5vdCBiZSBjYWxsZWQgYmVmb3JlIHRoZSBpbWFnZXJ5IHByb3ZpZGVyIGlzIHJlYWR5LicpO1xyXG4gICAgICAgIH1cclxuICAgICAgICAvLz4+aW5jbHVkZUVuZCgnZGVidWcnKTtcclxuXHJcbiAgICAgICAgcmV0dXJuIHRoaXMuX3RpbGVXaWR0aDtcclxuICAgIH0sXHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZXRzIHRoZSBoZWlnaHQgb2YgZWFjaCB0aWxlLCBpbiBwaXhlbHMuICBUaGlzIGZ1bmN0aW9uIHNob3VsZFxyXG4gICAgICogbm90IGJlIGNhbGxlZCBiZWZvcmUge0BsaW5rIEltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlciNyZWFkeX0gcmV0dXJucyB0cnVlLlxyXG4gICAgICogQG1lbWJlcm9mIEltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlci5wcm90b3R5cGVcclxuICAgICAqIEB0eXBlIHtOdW1iZXJ9XHJcbiAgICAgKiBAcmVhZG9ubHlcclxuICAgICAqL1xyXG4gICAgZ2V0IHRpbGVIZWlnaHQoKSB7XHJcbiAgICAgICAgLy8+PmluY2x1ZGVTdGFydCgnZGVidWcnLCBwcmFnbWFzLmRlYnVnKTtcclxuICAgICAgICBpZiAoIXRoaXMuX3JlYWR5KSB7XHJcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRGV2ZWxvcGVyRXJyb3IoJ3RpbGVIZWlnaHQgbXVzdCBub3QgYmUgY2FsbGVkIGJlZm9yZSB0aGUgaW1hZ2VyeSBwcm92aWRlciBpcyByZWFkeS4nKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgLy8+PmluY2x1ZGVFbmQoJ2RlYnVnJyk7XHJcblxyXG4gICAgICAgIHJldHVybiB0aGlzLl90aWxlSGVpZ2h0O1xyXG4gICAgfSxcclxuXHJcbiAgICAvKipcclxuICAgICAqIEdldHMgdGhlIG1heGltdW0gbGV2ZWwtb2YtZGV0YWlsIHRoYXQgY2FuIGJlIHJlcXVlc3RlZC4gIFRoaXMgZnVuY3Rpb24gc2hvdWxkXHJcbiAgICAgKiBub3QgYmUgY2FsbGVkIGJlZm9yZSB7QGxpbmsgSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyI3JlYWR5fSByZXR1cm5zIHRydWUuXHJcbiAgICAgKiBAbWVtYmVyb2YgSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZVxyXG4gICAgICogQHR5cGUge051bWJlcn1cclxuICAgICAqIEByZWFkb25seVxyXG4gICAgICovXHJcbiAgICBnZXQgbWF4aW11bUxldmVsKCkge1xyXG4gICAgICAgIC8vPj5pbmNsdWRlU3RhcnQoJ2RlYnVnJywgcHJhZ21hcy5kZWJ1Zyk7XHJcbiAgICAgICAgaWYgKCF0aGlzLl9yZWFkeSkge1xyXG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IERldmVsb3BlckVycm9yKCdtYXhpbXVtTGV2ZWwgbXVzdCBub3QgYmUgY2FsbGVkIGJlZm9yZSB0aGUgaW1hZ2VyeSBwcm92aWRlciBpcyByZWFkeS4nKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgLy8+PmluY2x1ZGVFbmQoJ2RlYnVnJyk7XHJcblxyXG4gICAgICAgIHJldHVybiB0aGlzLl9udW1SZXNvbHV0aW9uTGV2ZWxzIC0gMTtcclxuICAgIH0sXHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZXRzIHRoZSBtaW5pbXVtIGxldmVsLW9mLWRldGFpbCB0aGF0IGNhbiBiZSByZXF1ZXN0ZWQuICBUaGlzIGZ1bmN0aW9uIHNob3VsZFxyXG4gICAgICogbm90IGJlIGNhbGxlZCBiZWZvcmUge0BsaW5rIEltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlciNyZWFkeX0gcmV0dXJucyB0cnVlLlxyXG4gICAgICogQG1lbWJlcm9mIEltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlci5wcm90b3R5cGVcclxuICAgICAqIEB0eXBlIHtOdW1iZXJ9XHJcbiAgICAgKiBAcmVhZG9ubHlcclxuICAgICAqL1xyXG4gICAgZ2V0IG1pbmltdW1MZXZlbCgpIHtcclxuICAgICAgICAvLz4+aW5jbHVkZVN0YXJ0KCdkZWJ1ZycsIHByYWdtYXMuZGVidWcpO1xyXG4gICAgICAgIGlmICghdGhpcy5fcmVhZHkpIHtcclxuICAgICAgICAgICAgICAgIHRocm93IG5ldyBEZXZlbG9wZXJFcnJvcignbWluaW11bUxldmVsIG11c3Qgbm90IGJlIGNhbGxlZCBiZWZvcmUgdGhlIGltYWdlcnkgcHJvdmlkZXIgaXMgcmVhZHkuJyk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIC8vPj5pbmNsdWRlRW5kKCdkZWJ1ZycpO1xyXG5cclxuICAgICAgICByZXR1cm4gMDtcclxuICAgIH0sXHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZXRzIHRoZSB0aWxpbmcgc2NoZW1lIHVzZWQgYnkgdGhpcyBwcm92aWRlci4gIFRoaXMgZnVuY3Rpb24gc2hvdWxkXHJcbiAgICAgKiBub3QgYmUgY2FsbGVkIGJlZm9yZSB7QGxpbmsgSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyI3JlYWR5fSByZXR1cm5zIHRydWUuXHJcbiAgICAgKiBAbWVtYmVyb2YgSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZVxyXG4gICAgICogQHR5cGUge1RpbGluZ1NjaGVtZX1cclxuICAgICAqIEByZWFkb25seVxyXG4gICAgICovXHJcbiAgICBnZXQgdGlsaW5nU2NoZW1lKCkge1xyXG4gICAgICAgIC8vPj5pbmNsdWRlU3RhcnQoJ2RlYnVnJywgcHJhZ21hcy5kZWJ1Zyk7XHJcbiAgICAgICAgaWYgKCF0aGlzLl9yZWFkeSkge1xyXG4gICAgICAgICAgICB0aHJvdyBuZXcgRGV2ZWxvcGVyRXJyb3IoJ3RpbGluZ1NjaGVtZSBtdXN0IG5vdCBiZSBjYWxsZWQgYmVmb3JlIHRoZSBpbWFnZXJ5IHByb3ZpZGVyIGlzIHJlYWR5LicpO1xyXG4gICAgICAgIH1cclxuICAgICAgICAvLz4+aW5jbHVkZUVuZCgnZGVidWcnKTtcclxuXHJcbiAgICAgICAgcmV0dXJuIHRoaXMuX3RpbGluZ1NjaGVtZTtcclxuICAgIH0sXHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZXRzIHRoZSByZWN0YW5nbGUsIGluIHJhZGlhbnMsIG9mIHRoZSBpbWFnZXJ5IHByb3ZpZGVkIGJ5IHRoaXMgaW5zdGFuY2UuICBUaGlzIGZ1bmN0aW9uIHNob3VsZFxyXG4gICAgICogbm90IGJlIGNhbGxlZCBiZWZvcmUge0BsaW5rIEltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlciNyZWFkeX0gcmV0dXJucyB0cnVlLlxyXG4gICAgICogQG1lbWJlcm9mIEltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlci5wcm90b3R5cGVcclxuICAgICAqIEB0eXBlIHtSZWN0YW5nbGV9XHJcbiAgICAgKiBAcmVhZG9ubHlcclxuICAgICAqL1xyXG4gICAgZ2V0IHJlY3RhbmdsZSgpIHtcclxuICAgICAgICByZXR1cm4gdGhpcy5fdGlsaW5nU2NoZW1lLnJlY3RhbmdsZTtcclxuICAgIH0sXHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZXRzIHRoZSB0aWxlIGRpc2NhcmQgcG9saWN5LiAgSWYgbm90IHVuZGVmaW5lZCwgdGhlIGRpc2NhcmQgcG9saWN5IGlzIHJlc3BvbnNpYmxlXHJcbiAgICAgKiBmb3IgZmlsdGVyaW5nIG91dCBcIm1pc3NpbmdcIiB0aWxlcyB2aWEgaXRzIHNob3VsZERpc2NhcmRJbWFnZSBmdW5jdGlvbi4gIElmIHRoaXMgZnVuY3Rpb25cclxuICAgICAqIHJldHVybnMgdW5kZWZpbmVkLCBubyB0aWxlcyBhcmUgZmlsdGVyZWQuICBUaGlzIGZ1bmN0aW9uIHNob3VsZFxyXG4gICAgICogbm90IGJlIGNhbGxlZCBiZWZvcmUge0BsaW5rIEltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlciNyZWFkeX0gcmV0dXJucyB0cnVlLlxyXG4gICAgICogQG1lbWJlcm9mIEltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlci5wcm90b3R5cGVcclxuICAgICAqIEB0eXBlIHtUaWxlRGlzY2FyZFBvbGljeX1cclxuICAgICAqIEByZWFkb25seVxyXG4gICAgICovXHJcbiAgICBnZXQgdGlsZURpc2NhcmRQb2xpY3koKSB7XHJcbiAgICAgICAgLy8+PmluY2x1ZGVTdGFydCgnZGVidWcnLCBwcmFnbWFzLmRlYnVnKTtcclxuICAgICAgICBpZiAoIXRoaXMuX3JlYWR5KSB7XHJcbiAgICAgICAgICAgIHRocm93IG5ldyBEZXZlbG9wZXJFcnJvcigndGlsZURpc2NhcmRQb2xpY3kgbXVzdCBub3QgYmUgY2FsbGVkIGJlZm9yZSB0aGUgaW1hZ2VyeSBwcm92aWRlciBpcyByZWFkeS4nKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgLy8+PmluY2x1ZGVFbmQoJ2RlYnVnJyk7XHJcblxyXG4gICAgICAgIHJldHVybiB1bmRlZmluZWQ7XHJcbiAgICB9LFxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2V0cyBhbiBldmVudCB0aGF0IGlzIHJhaXNlZCB3aGVuIHRoZSBpbWFnZXJ5IHByb3ZpZGVyIGVuY291bnRlcnMgYW4gYXN5bmNocm9ub3VzIGVycm9yLiAgQnkgc3Vic2NyaWJpbmdcclxuICAgICAqIHRvIHRoZSBldmVudCwgeW91IHdpbGwgYmUgbm90aWZpZWQgb2YgdGhlIGVycm9yIGFuZCBjYW4gcG90ZW50aWFsbHkgcmVjb3ZlciBmcm9tIGl0LiAgRXZlbnQgbGlzdGVuZXJzXHJcbiAgICAgKiBhcmUgcGFzc2VkIGFuIGluc3RhbmNlIG9mIHtAbGluayBUaWxlUHJvdmlkZXJFcnJvcn0uXHJcbiAgICAgKiBAbWVtYmVyb2YgSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZVxyXG4gICAgICogQHR5cGUge0V2ZW50fVxyXG4gICAgICogQHJlYWRvbmx5XHJcbiAgICAgKi9cclxuICAgIGdldCBlcnJvckV2ZW50KCkge1xyXG4gICAgICAgIHJldHVybiB0aGlzLl9lcnJvckV2ZW50O1xyXG4gICAgfSxcclxuXHJcbiAgICAvKipcclxuICAgICAqIEdldHMgYSB2YWx1ZSBpbmRpY2F0aW5nIHdoZXRoZXIgb3Igbm90IHRoZSBwcm92aWRlciBpcyByZWFkeSBmb3IgdXNlLlxyXG4gICAgICogQG1lbWJlcm9mIEltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlci5wcm90b3R5cGVcclxuICAgICAqIEB0eXBlIHtCb29sZWFufVxyXG4gICAgICogQHJlYWRvbmx5XHJcbiAgICAgKi9cclxuICAgIGdldCByZWFkeSgpIHtcclxuICAgICAgICByZXR1cm4gdGhpcy5fcmVhZHk7XHJcbiAgICB9LFxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2V0cyB0aGUgY3JlZGl0IHRvIGRpc3BsYXkgd2hlbiB0aGlzIGltYWdlcnkgcHJvdmlkZXIgaXMgYWN0aXZlLiAgVHlwaWNhbGx5IHRoaXMgaXMgdXNlZCB0byBjcmVkaXRcclxuICAgICAqIHRoZSBzb3VyY2Ugb2YgdGhlIGltYWdlcnkuICBUaGlzIGZ1bmN0aW9uIHNob3VsZCBub3QgYmUgY2FsbGVkIGJlZm9yZSB7QGxpbmsgSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyI3JlYWR5fSByZXR1cm5zIHRydWUuXHJcbiAgICAgKiBAbWVtYmVyb2YgSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZVxyXG4gICAgICogQHR5cGUge0NyZWRpdH1cclxuICAgICAqIEByZWFkb25seVxyXG4gICAgICovXHJcbiAgICBnZXQgY3JlZGl0KCkge1xyXG4gICAgICAgIHJldHVybiB0aGlzLl9jcmVkaXQ7XHJcbiAgICB9LFxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2V0cyBhIHZhbHVlIGluZGljYXRpbmcgd2hldGhlciBvciBub3QgdGhlIGltYWdlcyBwcm92aWRlZCBieSB0aGlzIGltYWdlcnkgcHJvdmlkZXJcclxuICAgICAqIGluY2x1ZGUgYW4gYWxwaGEgY2hhbm5lbC4gIElmIHRoaXMgcHJvcGVydHkgaXMgZmFsc2UsIGFuIGFscGhhIGNoYW5uZWwsIGlmIHByZXNlbnQsIHdpbGxcclxuICAgICAqIGJlIGlnbm9yZWQuICBJZiB0aGlzIHByb3BlcnR5IGlzIHRydWUsIGFueSBpbWFnZXMgd2l0aG91dCBhbiBhbHBoYSBjaGFubmVsIHdpbGwgYmUgdHJlYXRlZFxyXG4gICAgICogYXMgaWYgdGhlaXIgYWxwaGEgaXMgMS4wIGV2ZXJ5d2hlcmUuICBXaGVuIHRoaXMgcHJvcGVydHkgaXMgZmFsc2UsIG1lbW9yeSB1c2FnZVxyXG4gICAgICogYW5kIHRleHR1cmUgdXBsb2FkIHRpbWUgYXJlIHJlZHVjZWQuXHJcbiAgICAgKiBAbWVtYmVyb2YgSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZVxyXG4gICAgICogQHR5cGUge0Jvb2xlYW59XHJcbiAgICAgKiBAcmVhZG9ubHlcclxuICAgICAqL1xyXG4gICAgZ2V0IGhhc0FscGhhQ2hhbm5lbCgpIHtcclxuICAgICAgICByZXR1cm4gdHJ1ZTtcclxuICAgIH1cclxufTtcclxuXHJcbkltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlci5wcm90b3R5cGUuc2V0RXhjZXB0aW9uQ2FsbGJhY2sgPVxyXG4gICAgZnVuY3Rpb24gc2V0RXhjZXB0aW9uQ2FsbGJhY2soZXhjZXB0aW9uQ2FsbGJhY2spIHtcclxuICAgIFxyXG4gICAgdGhpcy5fZXhjZXB0aW9uQ2FsbGJhY2sgPSBleGNlcHRpb25DYWxsYmFjaztcclxufTtcclxuXHJcbkltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlci5wcm90b3R5cGUub3BlbiA9IGZ1bmN0aW9uIG9wZW4od2lkZ2V0T3JWaWV3ZXIpIHtcclxuICAgIGlmICh0aGlzLl91cGRhdGVGcnVzdHVtSW50ZXJ2YWxIYW5kbGUgIT09IG51bGwpIHtcclxuICAgICAgICB0aHJvdyBuZXcgRGV2ZWxvcGVyRXJyb3IoJ0Nhbm5vdCBzZXQgdHdvIHBhcmVudCB2aWV3ZXJzLicpO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBpZiAod2lkZ2V0T3JWaWV3ZXIgPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIHRocm93IG5ldyBEZXZlbG9wZXJFcnJvcignd2lkZ2V0T3JWaWV3ZXIgc2hvdWxkIGJlIGdpdmVuLiBJdCBpcyAnICtcclxuICAgICAgICAgICAgJ25lZWRlZCBmb3IgZnJ1c3R1bSBjYWxjdWxhdGlvbiBmb3IgdGhlIHByaW9yaXR5IG1lY2hhbmlzbScpO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICB0aGlzLl9pbWFnZS5vcGVuKHRoaXMuX3VybClcclxuXHRcdC50aGVuKHRoaXMuX29wZW5lZC5iaW5kKHRoaXMpKVxyXG5cdFx0LmNhdGNoKHRoaXMuX29uRXhjZXB0aW9uLmJpbmQodGhpcykpO1xyXG4gICAgXHJcbiAgICB0aGlzLl9jZXNpdW1XaWRnZXQgPSB3aWRnZXRPclZpZXdlcjtcclxuICAgIFxyXG4gICAgdGhpcy5fdXBkYXRlRnJ1c3R1bUludGVydmFsSGFuZGxlID0gc2V0SW50ZXJ2YWwoXHJcbiAgICAgICAgdGhpcy5fc2V0UHJpb3JpdHlCeUZydXN0dW0uYmluZCh0aGlzKSxcclxuICAgICAgICB0aGlzLl91cGRhdGVGcnVzdHVtSW50ZXJ2YWwpO1xyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5jbG9zZSA9IGZ1bmN0aW9uIGNsb3NlKCkge1xyXG4gICAgY2xlYXJJbnRlcnZhbCh0aGlzLl91cGRhdGVGcnVzdHVtSW50ZXJ2YWxIYW5kbGUpO1xyXG4gICAgdGhpcy5faW1hZ2UuY2xvc2UoKTtcclxufTtcclxuXHJcbkltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlci5wcm90b3R5cGUuZ2V0VGlsZVdpZHRoID0gZnVuY3Rpb24gZ2V0VGlsZVdpZHRoKCkge1xyXG4gICAgcmV0dXJuIHRoaXMudGlsZVdpZHRoO1xyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5nZXRUaWxlSGVpZ2h0ID0gZnVuY3Rpb24gZ2V0VGlsZUhlaWdodCgpIHtcclxuICAgIHJldHVybiB0aGlzLnRpbGVIZWlnaHQ7XHJcbn07XHJcblxyXG5JbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlLmdldE1heGltdW1MZXZlbCA9IGZ1bmN0aW9uIGdldE1heGltdW1MZXZlbCgpIHtcclxuICAgIHJldHVybiB0aGlzLm1heGltdW1MZXZlbDtcclxufTtcclxuXHJcbkltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlci5wcm90b3R5cGUuZ2V0TWluaW11bUxldmVsID0gZnVuY3Rpb24gZ2V0TWluaW11bUxldmVsKCkge1xyXG4gICAgcmV0dXJuIHRoaXMubWluaW11bUxldmVsO1xyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5nZXRVcmwgPSBmdW5jdGlvbiBnZXRVcmwoKSB7XHJcbiAgICByZXR1cm4gdGhpcy51cmw7XHJcbn07XHJcblxyXG5JbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlLmdldFByb3h5ID0gZnVuY3Rpb24gZ2V0UHJveHkoKSB7XHJcbiAgICByZXR1cm4gdGhpcy5wcm94eTtcclxufTtcclxuXHJcbkltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlci5wcm90b3R5cGUuaXNSZWFkeSA9IGZ1bmN0aW9uIGlzUmVhZHkoKSB7XHJcbiAgICByZXR1cm4gdGhpcy5yZWFkeTtcclxufTtcclxuXHJcbkltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlci5wcm90b3R5cGUuZ2V0Q3JlZGl0ID0gZnVuY3Rpb24gZ2V0Q3JlZGl0KCkge1xyXG4gICAgcmV0dXJuIHRoaXMuY3JlZGl0O1xyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5nZXRSZWN0YW5nbGUgPSBmdW5jdGlvbiBnZXRSZWN0YW5nbGUoKSB7XHJcbiAgICByZXR1cm4gdGhpcy50aWxpbmdTY2hlbWUucmVjdGFuZ2xlO1xyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5nZXRUaWxpbmdTY2hlbWUgPSBmdW5jdGlvbiBnZXRUaWxpbmdTY2hlbWUoKSB7XHJcbiAgICByZXR1cm4gdGhpcy50aWxpbmdTY2hlbWU7XHJcbn07XHJcblxyXG5JbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlLmdldFRpbGVEaXNjYXJkUG9saWN5ID0gZnVuY3Rpb24gZ2V0VGlsZURpc2NhcmRQb2xpY3koKSB7XHJcbiAgICByZXR1cm4gdGhpcy50aWxlRGlzY2FyZFBvbGljeTtcclxufTtcclxuXHJcbkltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlci5wcm90b3R5cGUuZ2V0RXJyb3JFdmVudCA9IGZ1bmN0aW9uIGdldEVycm9yRXZlbnQoKSB7XHJcbiAgICByZXR1cm4gdGhpcy5lcnJvckV2ZW50O1xyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5nZXRIYXNBbHBoYUNoYW5uZWwgPSBmdW5jdGlvbiBnZXRIYXNBbHBoYUNoYW5uZWwoKSB7XHJcbiAgICByZXR1cm4gdGhpcy5oYXNBbHBoYUNoYW5uZWw7XHJcbn07XHJcblxyXG4vKipcclxuICogR2V0cyB0aGUgY3JlZGl0cyB0byBiZSBkaXNwbGF5ZWQgd2hlbiBhIGdpdmVuIHRpbGUgaXMgZGlzcGxheWVkLlxyXG4gKlxyXG4gKiBAcGFyYW0ge051bWJlcn0geCBUaGUgdGlsZSBYIGNvb3JkaW5hdGUuXHJcbiAqIEBwYXJhbSB7TnVtYmVyfSB5IFRoZSB0aWxlIFkgY29vcmRpbmF0ZS5cclxuICogQHBhcmFtIHtOdW1iZXJ9IGxldmVsIFRoZSB0aWxlIGxldmVsO1xyXG4gKiBAcmV0dXJucyB7Q3JlZGl0W119IFRoZSBjcmVkaXRzIHRvIGJlIGRpc3BsYXllZCB3aGVuIHRoZSB0aWxlIGlzIGRpc3BsYXllZC5cclxuICpcclxuICogQGV4Y2VwdGlvbiB7RGV2ZWxvcGVyRXJyb3J9IDxjb2RlPmdldFRpbGVDcmVkaXRzPC9jb2RlPiBtdXN0IG5vdCBiZSBjYWxsZWQgYmVmb3JlIHRoZSBpbWFnZXJ5IHByb3ZpZGVyIGlzIHJlYWR5LlxyXG4gKi9cclxuSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5nZXRUaWxlQ3JlZGl0cyA9IGZ1bmN0aW9uKHgsIHksIGxldmVsKSB7XHJcbiAgICByZXR1cm4gdW5kZWZpbmVkO1xyXG59O1xyXG5cclxuLyoqXHJcbiAqIFJlcXVlc3RzIHRoZSBpbWFnZSBmb3IgYSBnaXZlbiB0aWxlLiAgVGhpcyBmdW5jdGlvbiBzaG91bGRcclxuICogbm90IGJlIGNhbGxlZCBiZWZvcmUge0BsaW5rIEltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlciNyZWFkeX0gcmV0dXJucyB0cnVlLlxyXG4gKlxyXG4gKiBAcGFyYW0ge051bWJlcn0geCBUaGUgdGlsZSBYIGNvb3JkaW5hdGUuXHJcbiAqIEBwYXJhbSB7TnVtYmVyfSB5IFRoZSB0aWxlIFkgY29vcmRpbmF0ZS5cclxuICogQHBhcmFtIHtOdW1iZXJ9IGxldmVsIFRoZSB0aWxlIGxldmVsLlxyXG4gKiBAcmV0dXJucyB7UHJvbWlzZX0gQSBwcm9taXNlIGZvciB0aGUgaW1hZ2UgdGhhdCB3aWxsIHJlc29sdmUgd2hlbiB0aGUgaW1hZ2UgaXMgYXZhaWxhYmxlLCBvclxyXG4gKiAgICAgICAgICB1bmRlZmluZWQgaWYgdGhlcmUgYXJlIHRvbyBtYW55IGFjdGl2ZSByZXF1ZXN0cyB0byB0aGUgc2VydmVyLCBhbmQgdGhlIHJlcXVlc3RcclxuICogICAgICAgICAgc2hvdWxkIGJlIHJldHJpZWQgbGF0ZXIuICBUaGUgcmVzb2x2ZWQgaW1hZ2UgbWF5IGJlIGVpdGhlciBhblxyXG4gKiAgICAgICAgICBJbWFnZSBvciBhIENhbnZhcyBET00gb2JqZWN0LlxyXG4gKlxyXG4gKiBAZXhjZXB0aW9uIHtEZXZlbG9wZXJFcnJvcn0gPGNvZGU+cmVxdWVzdEltYWdlPC9jb2RlPiBtdXN0IG5vdCBiZSBjYWxsZWQgYmVmb3JlIHRoZSBpbWFnZXJ5IHByb3ZpZGVyIGlzIHJlYWR5LlxyXG4gKi9cclxuSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5yZXF1ZXN0SW1hZ2UgPSBmdW5jdGlvbih4LCB5LCBjZXNpdW1MZXZlbCkge1xyXG4gICAgLy8+PmluY2x1ZGVTdGFydCgnZGVidWcnLCBwcmFnbWFzLmRlYnVnKTtcclxuICAgIGlmICghdGhpcy5fcmVhZHkpIHtcclxuICAgICAgICB0aHJvdyBuZXcgRGV2ZWxvcGVyRXJyb3IoJ3JlcXVlc3RJbWFnZSBtdXN0IG5vdCBiZSBjYWxsZWQgYmVmb3JlIHRoZSBpbWFnZXJ5IHByb3ZpZGVyIGlzIHJlYWR5LicpO1xyXG4gICAgfVxyXG4gICAgLy8+PmluY2x1ZGVFbmQoJ2RlYnVnJyk7XHJcbiAgICBcclxuICAgIHZhciBzZWxmID0gdGhpcztcclxuICAgIFxyXG4gICAgdmFyIGxldmVsRmFjdG9yID0gTWF0aC5wb3coMiwgdGhpcy5fbnVtUmVzb2x1dGlvbkxldmVscyAtIGNlc2l1bUxldmVsIC0gMSk7XHJcbiAgICB2YXIgbWluWCA9IHggKiB0aGlzLl90aWxlV2lkdGggICogbGV2ZWxGYWN0b3I7XHJcbiAgICB2YXIgbWluWSA9IHkgKiB0aGlzLl90aWxlSGVpZ2h0ICogbGV2ZWxGYWN0b3I7XHJcbiAgICB2YXIgbWF4WEV4Y2x1c2l2ZSA9ICh4ICsgMSkgKiB0aGlzLl90aWxlV2lkdGggICogbGV2ZWxGYWN0b3I7XHJcbiAgICB2YXIgbWF4WUV4Y2x1c2l2ZSA9ICh5ICsgMSkgKiB0aGlzLl90aWxlSGVpZ2h0ICogbGV2ZWxGYWN0b3I7XHJcbiAgICBcclxuICAgIHZhciBhbGlnbmVkUGFyYW1zID0gaW1hZ2VIZWxwZXJGdW5jdGlvbnMuYWxpZ25QYXJhbXNUb1RpbGVzQW5kTGV2ZWwoe1xyXG4gICAgICAgIG1pblg6IG1pblgsXHJcbiAgICAgICAgbWluWTogbWluWSxcclxuICAgICAgICBtYXhYRXhjbHVzaXZlOiBtYXhYRXhjbHVzaXZlLFxyXG4gICAgICAgIG1heFlFeGNsdXNpdmU6IG1heFlFeGNsdXNpdmUsXHJcbiAgICAgICAgc2NyZWVuV2lkdGg6IHRoaXMuX3RpbGVXaWR0aCxcclxuICAgICAgICBzY3JlZW5IZWlnaHQ6IHRoaXMuX3RpbGVIZWlnaHRcclxuICAgIH0sIHRoaXMuX2ltYWdlLCB0aGlzLl9pbWFnZSk7XHJcbiAgICBcclxuICAgIHZhciBzY2FsZWRDYW52YXMgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdjYW52YXMnKTtcclxuICAgIHNjYWxlZENhbnZhcy53aWR0aCA9IHRoaXMuX3RpbGVXaWR0aDtcclxuICAgIHNjYWxlZENhbnZhcy5oZWlnaHQgPSB0aGlzLl90aWxlSGVpZ2h0O1xyXG4gICAgXHJcbiAgICB2YXIgc2NhbGVkQ29udGV4dCA9IHNjYWxlZENhbnZhcy5nZXRDb250ZXh0KCcyZCcpO1xyXG4gICAgc2NhbGVkQ29udGV4dC5jbGVhclJlY3QoMCwgMCwgdGhpcy5fdGlsZVdpZHRoLCB0aGlzLl90aWxlSGVpZ2h0KTtcclxuICAgIFxyXG4gICAgdmFyIHRlbXBQaXhlbFdpZHRoICA9IGFsaWduZWRQYXJhbXMuaW1hZ2VQYXJ0UGFyYW1zLm1heFhFeGNsdXNpdmUgLSBhbGlnbmVkUGFyYW1zLmltYWdlUGFydFBhcmFtcy5taW5YO1xyXG4gICAgdmFyIHRlbXBQaXhlbEhlaWdodCA9IGFsaWduZWRQYXJhbXMuaW1hZ2VQYXJ0UGFyYW1zLm1heFlFeGNsdXNpdmUgLSBhbGlnbmVkUGFyYW1zLmltYWdlUGFydFBhcmFtcy5taW5ZO1xyXG4gICAgaWYgKHRlbXBQaXhlbFdpZHRoIDw9IDAgfHwgdGVtcFBpeGVsSGVpZ2h0IDw9IDApIHtcclxuICAgICAgICByZXR1cm4gc2NhbGVkQ2FudmFzO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICB2YXIgdGVtcENhbnZhcyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2NhbnZhcycpO1xyXG4gICAgdGVtcENhbnZhcy53aWR0aCA9IHRlbXBQaXhlbFdpZHRoO1xyXG4gICAgdGVtcENhbnZhcy5oZWlnaHQgPSB0ZW1wUGl4ZWxIZWlnaHQ7XHJcbiAgICB2YXIgdGVtcENvbnRleHQgPSB0ZW1wQ2FudmFzLmdldENvbnRleHQoJzJkJyk7XHJcbiAgICB0ZW1wQ29udGV4dC5jbGVhclJlY3QoMCwgMCwgdGVtcFBpeGVsV2lkdGgsIHRlbXBQaXhlbEhlaWdodCk7XHJcbiAgICBcclxuICAgIGFsaWduZWRQYXJhbXMuaW1hZ2VQYXJ0UGFyYW1zLnF1YWxpdHkgPSB0aGlzLl9xdWFsaXR5O1xyXG4gICAgYWxpZ25lZFBhcmFtcy5pbWFnZVBhcnRQYXJhbXMucmVxdWVzdFByaW9yaXR5RGF0YSA9IHtcclxuICAgICAgICBpbWFnZVJlY3RhbmdsZTogdGhpcy5fcmVjdGFuZ2xlXHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICB2YXIgcmVzb2x2ZSwgcmVqZWN0O1xyXG4gICAgdmFyIHJlcXVlc3RQaXhlbHNQcm9taXNlID0gbmV3IFByb21pc2UoZnVuY3Rpb24ocmVzb2x2ZV8sIHJlamVjdF8pIHtcclxuICAgICAgICByZXNvbHZlID0gcmVzb2x2ZV87XHJcbiAgICAgICAgcmVqZWN0ID0gcmVqZWN0XztcclxuICAgICAgICBcclxuICAgICAgICBzZWxmLl9pbWFnZS5yZXF1ZXN0UGl4ZWxzUHJvZ3Jlc3NpdmUoXHJcbiAgICAgICAgICAgIGFsaWduZWRQYXJhbXMuaW1hZ2VQYXJ0UGFyYW1zLFxyXG4gICAgICAgICAgICBwaXhlbHNEZWNvZGVkQ2FsbGJhY2ssXHJcbiAgICAgICAgICAgIHRlcm1pbmF0ZWRDYWxsYmFjayk7XHJcbiAgICB9KTtcclxuICAgIFxyXG4gICAgZnVuY3Rpb24gcGl4ZWxzRGVjb2RlZENhbGxiYWNrKGRlY29kZWQpIHtcclxuICAgICAgICB2YXIgcGFydGlhbFRpbGVXaWR0aCA9IGRlY29kZWQuaW1hZ2VEYXRhLndpZHRoO1xyXG4gICAgICAgIHZhciBwYXJ0aWFsVGlsZUhlaWdodCA9IGRlY29kZWQuaW1hZ2VEYXRhLmhlaWdodDtcclxuXHJcbiAgICAgICAgaWYgKHBhcnRpYWxUaWxlV2lkdGggPiAwICYmIHBhcnRpYWxUaWxlSGVpZ2h0ID4gMCkge1xyXG4gICAgICAgICAgICB0ZW1wQ29udGV4dC5wdXRJbWFnZURhdGEoXHJcbiAgICAgICAgICAgICAgICBkZWNvZGVkLmltYWdlRGF0YSxcclxuICAgICAgICAgICAgICAgIGRlY29kZWQueEluT3JpZ2luYWxSZXF1ZXN0LFxyXG4gICAgICAgICAgICAgICAgZGVjb2RlZC55SW5PcmlnaW5hbFJlcXVlc3QpO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICBmdW5jdGlvbiB0ZXJtaW5hdGVkQ2FsbGJhY2soaXNBYm9ydGVkKSB7XHJcbiAgICAgICAgaWYgKGlzQWJvcnRlZCkge1xyXG4gICAgICAgICAgICByZWplY3QoJ0ZldGNoIHJlcXVlc3Qgb3IgZGVjb2RlIGFib3J0ZWQnKTtcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICBzY2FsZWRDb250ZXh0LmRyYXdJbWFnZShcclxuICAgICAgICAgICAgICAgIHRlbXBDYW52YXMsXHJcbiAgICAgICAgICAgICAgICAwLCAwLCB0ZW1wUGl4ZWxXaWR0aCwgdGVtcFBpeGVsSGVpZ2h0LFxyXG4gICAgICAgICAgICAgICAgYWxpZ25lZFBhcmFtcy5jcm9wcGVkU2NyZWVuLm1pblgsIGFsaWduZWRQYXJhbXMuY3JvcHBlZFNjcmVlbi5taW5ZLFxyXG4gICAgICAgICAgICAgICAgYWxpZ25lZFBhcmFtcy5jcm9wcGVkU2NyZWVuLm1heFhFeGNsdXNpdmUsIGFsaWduZWRQYXJhbXMuY3JvcHBlZFNjcmVlbi5tYXhZRXhjbHVzaXZlKTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICByZXNvbHZlKHNjYWxlZENhbnZhcyk7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiByZXF1ZXN0UGl4ZWxzUHJvbWlzZTtcclxufTtcclxuXHJcbkltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlci5wcm90b3R5cGUuX3NldFByaW9yaXR5QnlGcnVzdHVtID1cclxuICAgIGZ1bmN0aW9uIHNldFByaW9yaXR5QnlGcnVzdHVtKCkge1xyXG4gICAgXHJcbiAgICBpZiAoIXRoaXMuX3JlYWR5KSB7XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICB2YXIgZnJ1c3R1bURhdGEgPSBjYWxjdWxhdGVDZXNpdW1GcnVzdHVtKFxyXG4gICAgICAgIHRoaXMuX2Nlc2l1bVdpZGdldCwgdGhpcyk7XHJcbiAgICBcclxuICAgIGlmIChmcnVzdHVtRGF0YSA9PT0gbnVsbCkge1xyXG4gICAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIFxyXG4gICAgZnJ1c3R1bURhdGEuaW1hZ2VSZWN0YW5nbGUgPSB0aGlzLmdldFJlY3RhbmdsZSgpO1xyXG4gICAgZnJ1c3R1bURhdGEuZXhhY3RsZXZlbCA9IG51bGw7XHJcblxyXG4gICAgdGhpcy5faW1hZ2Uuc2V0U2VydmVyUmVxdWVzdFByaW9yaXRpemVyRGF0YShmcnVzdHVtRGF0YSk7XHJcbiAgICB0aGlzLl9pbWFnZS5zZXREZWNvZGVQcmlvcml0aXplckRhdGEoZnJ1c3R1bURhdGEpO1xyXG59O1xyXG5cclxuLyoqXHJcbiAqIFBpY2tpbmcgZmVhdHVyZXMgaXMgbm90IGN1cnJlbnRseSBzdXBwb3J0ZWQgYnkgdGhpcyBpbWFnZXJ5IHByb3ZpZGVyLCBzbyB0aGlzIGZ1bmN0aW9uIHNpbXBseSByZXR1cm5zXHJcbiAqIHVuZGVmaW5lZC5cclxuICpcclxuICogQHBhcmFtIHtOdW1iZXJ9IHggVGhlIHRpbGUgWCBjb29yZGluYXRlLlxyXG4gKiBAcGFyYW0ge051bWJlcn0geSBUaGUgdGlsZSBZIGNvb3JkaW5hdGUuXHJcbiAqIEBwYXJhbSB7TnVtYmVyfSBsZXZlbCBUaGUgdGlsZSBsZXZlbC5cclxuICogQHBhcmFtIHtOdW1iZXJ9IGxvbmdpdHVkZSBUaGUgbG9uZ2l0dWRlIGF0IHdoaWNoIHRvIHBpY2sgZmVhdHVyZXMuXHJcbiAqIEBwYXJhbSB7TnVtYmVyfSBsYXRpdHVkZSAgVGhlIGxhdGl0dWRlIGF0IHdoaWNoIHRvIHBpY2sgZmVhdHVyZXMuXHJcbiAqIEByZXR1cm4ge1Byb21pc2V9IEEgcHJvbWlzZSBmb3IgdGhlIHBpY2tlZCBmZWF0dXJlcyB0aGF0IHdpbGwgcmVzb2x2ZSB3aGVuIHRoZSBhc3luY2hyb25vdXNcclxuICogICAgICAgICAgICAgICAgICAgcGlja2luZyBjb21wbGV0ZXMuICBUaGUgcmVzb2x2ZWQgdmFsdWUgaXMgYW4gYXJyYXkgb2Yge0BsaW5rIEltYWdlcnlMYXllckZlYXR1cmVJbmZvfVxyXG4gKiAgICAgICAgICAgICAgICAgICBpbnN0YW5jZXMuICBUaGUgYXJyYXkgbWF5IGJlIGVtcHR5IGlmIG5vIGZlYXR1cmVzIGFyZSBmb3VuZCBhdCB0aGUgZ2l2ZW4gbG9jYXRpb24uXHJcbiAqICAgICAgICAgICAgICAgICAgIEl0IG1heSBhbHNvIGJlIHVuZGVmaW5lZCBpZiBwaWNraW5nIGlzIG5vdCBzdXBwb3J0ZWQuXHJcbiAqL1xyXG5JbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlLnBpY2tGZWF0dXJlcyA9IGZ1bmN0aW9uKCkge1xyXG4gICAgICAgIHJldHVybiB1bmRlZmluZWQ7XHJcbn07XHJcblxyXG5JbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlLl9vbkV4Y2VwdGlvbiA9IGZ1bmN0aW9uIG9uRXhjZXB0aW9uKHJlYXNvbikge1xyXG4gICAgaWYgKHRoaXMuX2V4Y2VwdGlvbkNhbGxiYWNrICE9PSBudWxsKSB7XHJcblx0XHR0aGlzLl9leGNlcHRpb25DYWxsYmFjayhyZWFzb24pO1xyXG4gICAgfVxyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5fb3BlbmVkID0gZnVuY3Rpb24gb3BlbmVkKCkge1xyXG4gICAgaWYgKHRoaXMuX3JlYWR5KSB7XHJcbiAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlciBlcnJvcjogb3BlbmVkKCkgd2FzIGNhbGxlZCBtb3JlIHRoYW4gb25jZSEnO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICB0aGlzLl9yZWFkeSA9IHRydWU7XHJcblxyXG4gICAgLy8gVGhpcyBpcyB3cm9uZyBpZiBDT0Qgb3IgQ09DIGV4aXN0cyBiZXNpZGVzIG1haW4gaGVhZGVyIENPRFxyXG4gICAgdGhpcy5fbnVtUmVzb2x1dGlvbkxldmVscyA9IHRoaXMuX2ltYWdlLmdldE51bVJlc29sdXRpb25MZXZlbHNGb3JMaW1pdHRlZFZpZXdlcigpO1xyXG4gICAgdGhpcy5fcXVhbGl0eSA9IHRoaXMuX2ltYWdlLmdldEhpZ2hlc3RRdWFsaXR5KCk7XHJcbiAgICB2YXIgbWF4aW11bUNlc2l1bUxldmVsID0gdGhpcy5fbnVtUmVzb2x1dGlvbkxldmVscyAtIDE7XHJcbiAgICAgICAgXHJcbiAgICB0aGlzLl90aWxlV2lkdGggPSB0aGlzLl9pbWFnZS5nZXRUaWxlV2lkdGgoKTtcclxuICAgIHRoaXMuX3RpbGVIZWlnaHQgPSB0aGlzLl9pbWFnZS5nZXRUaWxlSGVpZ2h0KCk7XHJcbiAgICAgICAgXHJcbiAgICB2YXIgYmVzdExldmVsID0gdGhpcy5faW1hZ2UuZ2V0SW1hZ2VMZXZlbCgpO1xyXG4gICAgdmFyIGJlc3RMZXZlbFdpZHRoICA9IHRoaXMuX2ltYWdlLmdldEltYWdlV2lkdGggKCk7XHJcbiAgICB2YXIgYmVzdExldmVsSGVpZ2h0ID0gdGhpcy5faW1hZ2UuZ2V0SW1hZ2VIZWlnaHQoKTtcclxuICAgIFxyXG4gICAgdmFyIGxvd2VzdExldmVsVGlsZXNYID0gTWF0aC5jZWlsKGJlc3RMZXZlbFdpZHRoICAvIHRoaXMuX3RpbGVXaWR0aCApID4+IG1heGltdW1DZXNpdW1MZXZlbDtcclxuICAgIHZhciBsb3dlc3RMZXZlbFRpbGVzWSA9IE1hdGguY2VpbChiZXN0TGV2ZWxIZWlnaHQgLyB0aGlzLl90aWxlSGVpZ2h0KSA+PiBtYXhpbXVtQ2VzaXVtTGV2ZWw7XHJcblxyXG4gICAgaW1hZ2VIZWxwZXJGdW5jdGlvbnMuZml4Qm91bmRzKFxyXG4gICAgICAgIHRoaXMuX3JlY3RhbmdsZSxcclxuICAgICAgICB0aGlzLl9pbWFnZSxcclxuICAgICAgICB0aGlzLl9hZGFwdFByb3BvcnRpb25zKTtcclxuICAgIHZhciByZWN0YW5nbGVXaWR0aCAgPSB0aGlzLl9yZWN0YW5nbGUuZWFzdCAgLSB0aGlzLl9yZWN0YW5nbGUud2VzdDtcclxuICAgIHZhciByZWN0YW5nbGVIZWlnaHQgPSB0aGlzLl9yZWN0YW5nbGUubm9ydGggLSB0aGlzLl9yZWN0YW5nbGUuc291dGg7XHJcbiAgICBcclxuICAgIHZhciBiZXN0TGV2ZWxTY2FsZSA9IDEgPDwgbWF4aW11bUNlc2l1bUxldmVsO1xyXG4gICAgdmFyIHBpeGVsc1dpZHRoRm9yQ2VzaXVtICA9IHRoaXMuX3RpbGVXaWR0aCAgKiBsb3dlc3RMZXZlbFRpbGVzWCAqIGJlc3RMZXZlbFNjYWxlO1xyXG4gICAgdmFyIHBpeGVsc0hlaWdodEZvckNlc2l1bSA9IHRoaXMuX3RpbGVIZWlnaHQgKiBsb3dlc3RMZXZlbFRpbGVzWSAqIGJlc3RMZXZlbFNjYWxlO1xyXG4gICAgXHJcbiAgICAvLyBDZXNpdW0gd29ya3Mgd2l0aCBmdWxsIHRpbGVzIG9ubHksIHRodXMgZml4IHRoZSBnZW9ncmFwaGljIGJvdW5kcyBzb1xyXG4gICAgLy8gdGhlIHBpeGVscyBsaWVzIGV4YWN0bHkgb24gdGhlIG9yaWdpbmFsIGJvdW5kc1xyXG4gICAgXHJcbiAgICB2YXIgZ2VvZ3JhcGhpY1dpZHRoRm9yQ2VzaXVtID1cclxuICAgICAgICByZWN0YW5nbGVXaWR0aCAqIHBpeGVsc1dpZHRoRm9yQ2VzaXVtIC8gYmVzdExldmVsV2lkdGg7XHJcbiAgICB2YXIgZ2VvZ3JhcGhpY0hlaWdodEZvckNlc2l1bSA9XHJcbiAgICAgICAgcmVjdGFuZ2xlSGVpZ2h0ICogcGl4ZWxzSGVpZ2h0Rm9yQ2VzaXVtIC8gYmVzdExldmVsSGVpZ2h0O1xyXG4gICAgXHJcbiAgICB2YXIgZml4ZWRFYXN0ICA9IHRoaXMuX3JlY3RhbmdsZS53ZXN0ICArIGdlb2dyYXBoaWNXaWR0aEZvckNlc2l1bTtcclxuICAgIHZhciBmaXhlZFNvdXRoID0gdGhpcy5fcmVjdGFuZ2xlLm5vcnRoIC0gZ2VvZ3JhcGhpY0hlaWdodEZvckNlc2l1bTtcclxuICAgIFxyXG4gICAgdGhpcy5fdGlsaW5nU2NoZW1lUGFyYW1zID0ge1xyXG4gICAgICAgIHdlc3Q6IHRoaXMuX3JlY3RhbmdsZS53ZXN0LFxyXG4gICAgICAgIGVhc3Q6IGZpeGVkRWFzdCxcclxuICAgICAgICBzb3V0aDogZml4ZWRTb3V0aCxcclxuICAgICAgICBub3J0aDogdGhpcy5fcmVjdGFuZ2xlLm5vcnRoLFxyXG4gICAgICAgIGxldmVsWmVyb1RpbGVzWDogbG93ZXN0TGV2ZWxUaWxlc1gsXHJcbiAgICAgICAgbGV2ZWxaZXJvVGlsZXNZOiBsb3dlc3RMZXZlbFRpbGVzWSxcclxuICAgICAgICBtYXhpbXVtTGV2ZWw6IG1heGltdW1DZXNpdW1MZXZlbFxyXG4gICAgfTtcclxuICAgIFxyXG4gICAgdGhpcy5fdGlsaW5nU2NoZW1lID0gY3JlYXRlVGlsaW5nU2NoZW1lKHRoaXMuX3RpbGluZ1NjaGVtZVBhcmFtcyk7XHJcbiAgICAgICAgXHJcbiAgICBDZXNpdW0uVGlsZVByb3ZpZGVyRXJyb3IuaGFuZGxlU3VjY2Vzcyh0aGlzLl9lcnJvckV2ZW50KTtcclxufTtcclxuXHJcbmZ1bmN0aW9uIGNyZWF0ZVRpbGluZ1NjaGVtZShwYXJhbXMpIHtcclxuICAgIHZhciBnZW9ncmFwaGljUmVjdGFuZ2xlRm9yQ2VzaXVtID0gbmV3IENlc2l1bS5SZWN0YW5nbGUoXHJcbiAgICAgICAgcGFyYW1zLndlc3QsIHBhcmFtcy5zb3V0aCwgcGFyYW1zLmVhc3QsIHBhcmFtcy5ub3J0aCk7XHJcbiAgICBcclxuICAgIHZhciB0aWxpbmdTY2hlbWUgPSBuZXcgQ2VzaXVtLkdlb2dyYXBoaWNUaWxpbmdTY2hlbWUoe1xyXG4gICAgICAgIHJlY3RhbmdsZTogZ2VvZ3JhcGhpY1JlY3RhbmdsZUZvckNlc2l1bSxcclxuICAgICAgICBudW1iZXJPZkxldmVsWmVyb1RpbGVzWDogcGFyYW1zLmxldmVsWmVyb1RpbGVzWCxcclxuICAgICAgICBudW1iZXJPZkxldmVsWmVyb1RpbGVzWTogcGFyYW1zLmxldmVsWmVyb1RpbGVzWVxyXG4gICAgfSk7XHJcbiAgICBcclxuICAgIHJldHVybiB0aWxpbmdTY2hlbWU7XHJcbn0iLCIndXNlIHN0cmljdCc7XHJcblxyXG5tb2R1bGUuZXhwb3J0cy5JbWFnZVZpZXdlciA9IHJlcXVpcmUoJ2ltYWdlLXZpZXdlci5qcycpO1xyXG5tb2R1bGUuZXhwb3J0cy5JbWFnZUJhc2UgPSByZXF1aXJlKCdpbWFnZS1iYXNlLmpzJyk7XHJcbm1vZHVsZS5leHBvcnRzLkZldGNoZXJCYXNlID0gcmVxdWlyZSgnZmV0Y2hlci1iYXNlLmpzJyk7XHJcbm1vZHVsZS5leHBvcnRzLkdyaWRJbWFnZUJhc2UgPSByZXF1aXJlKCdncmlkLWltYWdlLWJhc2UuanMnKTtcclxubW9kdWxlLmV4cG9ydHMuR3JpZEZldGNoZXJCYXNlID0gcmVxdWlyZSgnZ3JpZC1mZXRjaGVyLWJhc2UuanMnKTtcclxubW9kdWxlLmV4cG9ydHMuR3JpZERlY29kZXJXb3JrZXJCYXNlID0gcmVxdWlyZSgnZ3JpZC1kZWNvZGVyLXdvcmtlci1iYXNlLmpzJyk7XHJcbm1vZHVsZS5leHBvcnRzLkNlc2l1bUltYWdlRGVjb2RlckxheWVyTWFuYWdlciA9IHJlcXVpcmUoJ2Nlc2l1bS1pbWFnZS1kZWNvZGVyLWxheWVyLW1hbmFnZXIuanMnKTtcclxubW9kdWxlLmV4cG9ydHMuSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyID0gcmVxdWlyZSgnaW1hZ2UtZGVjb2Rlci1pbWFnZXJ5LXByb3ZpZGVyLmpzJyk7XHJcbm1vZHVsZS5leHBvcnRzLkltYWdlRGVjb2RlclJlZ2lvbkxheWVyID0gcmVxdWlyZSgnaW1hZ2UtZGVjb2Rlci1yZWdpb24tbGF5ZXIuanMnKTtcclxuIiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBJbWFnZUJhc2U7XHJcblxyXG52YXIgaW1hZ2VIZWxwZXJGdW5jdGlvbnMgPSByZXF1aXJlKCdpbWFnZS1oZWxwZXItZnVuY3Rpb25zLmpzJyk7XHJcbnZhciBEZWNvZGVKb2JzUG9vbCA9IHJlcXVpcmUoJ2RlY29kZS1qb2JzLXBvb2wuanMnKTtcclxudmFyIEltYWdlUGFyYW1zUmV0cmlldmVyUHJveHkgPSByZXF1aXJlKCdpbWFnZS1wYXJhbXMtcmV0cmlldmVyLXByb3h5LmpzJyk7XHJcblxyXG4vKiBnbG9iYWwgY29uc29sZTogZmFsc2UgKi9cclxuLyogZ2xvYmFsIFByb21pc2U6IGZhbHNlICovXHJcblxyXG5JbWFnZUJhc2UuYWxpZ25QYXJhbXNUb1RpbGVzQW5kTGV2ZWwgPSBpbWFnZUhlbHBlckZ1bmN0aW9ucy5hbGlnblBhcmFtc1RvVGlsZXNBbmRMZXZlbDtcclxuXHJcbmZ1bmN0aW9uIEltYWdlQmFzZShvcHRpb25zKSB7XHJcbiAgICBJbWFnZVBhcmFtc1JldHJpZXZlclByb3h5LmNhbGwodGhpcyk7XHJcbiAgICBcclxuICAgIHRoaXMuX29wdGlvbnMgPSBvcHRpb25zIHx8IHt9O1xyXG4gICAgLy92YXIgZGVjb2RlV29ya2Vyc0xpbWl0ID0gdGhpcy5fb3B0aW9ucy53b3JrZXJzTGltaXQgfHwgNTtcclxuICAgIFxyXG4gICAgdGhpcy5fdGlsZVdpZHRoID0gdGhpcy5fb3B0aW9ucy50aWxlV2lkdGggfHwgMjU2O1xyXG4gICAgdGhpcy5fdGlsZUhlaWdodCA9IHRoaXMuX29wdGlvbnMudGlsZUhlaWdodCB8fCAyNTY7XHJcbiAgICB0aGlzLl9zaG93TG9nID0gISF0aGlzLl9vcHRpb25zLnNob3dMb2c7XHJcbiAgICB0aGlzLl9mZXRjaGVyID0gbnVsbDtcclxuICAgIHRoaXMuX2RlY29kZURlcGVuZGVuY3lXb3JrZXJzID0gbnVsbDtcclxuICAgIHRoaXMuX3JlcXVlc3RzRGVjb2RlSm9ic1Bvb2wgPSBudWxsO1xyXG4gICAgdGhpcy5fbW92YWJsZXNEZWNvZGVKb2JzUG9vbCA9IG51bGw7XHJcblx0dGhpcy5fZmV0Y2hSZXF1ZXN0SWQgPSAwO1xyXG4gICAgXHJcbiAgICAvKmlmICh0aGlzLl9zaG93TG9nKSB7XHJcbiAgICAgICAgLy8gT2xkIElFXHJcbiAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogc2hvd0xvZyBpcyBub3Qgc3VwcG9ydGVkIG9uIHRoaXMgYnJvd3Nlcic7XHJcbiAgICB9Ki9cclxuXHJcbiAgICB0aGlzLl9tb3ZhYmxlU3RhdGVzID0gW107XHJcbiAgICB0aGlzLl9kZWNvZGVycyA9IFtdO1xyXG5cclxuICAgIC8qIFRPRE9cclxuICAgIHZhciBkZWNvZGVTY2hlZHVsZXIgPSBpbWFnZUhlbHBlckZ1bmN0aW9ucy5jcmVhdGVTY2hlZHVsZXIoXHJcbiAgICAgICAgdGhpcy5fc2hvd0xvZyxcclxuICAgICAgICB0aGlzLl9vcHRpb25zLmRlY29kZVByaW9yaXRpemVyLFxyXG4gICAgICAgICdkZWNvZGUnLFxyXG4gICAgICAgIGZ1bmN0aW9uIGNyZWF0ZVJlc291cmNlKCkge1xyXG4gICAgICAgICAgICByZXR1cm4ge307XHJcbiAgICAgICAgfSxcclxuICAgICAgICBkZWNvZGVXb3JrZXJzTGltaXQpO1xyXG4gICAgKi9cclxuICAgIFxyXG4gICAgLy90aGlzLl9kZWNvZGVQcmlvcml0aXplciA9IGRlY29kZVNjaGVkdWxlci5wcmlvcml0aXplcjtcclxufVxyXG5cclxuSW1hZ2VCYXNlLnByb3RvdHlwZSA9IE9iamVjdC5jcmVhdGUoSW1hZ2VQYXJhbXNSZXRyaWV2ZXJQcm94eS5wcm90b3R5cGUpO1xyXG5cclxuSW1hZ2VCYXNlLnByb3RvdHlwZS5nZXRGZXRjaGVyID0gZnVuY3Rpb24gZ2V0RmV0Y2hlcigpIHtcclxuXHR0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBJbWFnZS5nZXRGZXRjaGVyKCkgaXMgbm90IGltcGxlbWVudGVkIGJ5IEltYWdlQmFzZSBpbmhlcml0b3InO1xyXG59O1xyXG5cclxuSW1hZ2VCYXNlLnByb3RvdHlwZS5nZXREZWNvZGVyV29ya2VycyA9IGZ1bmN0aW9uIGdldERlY29kZXJXb3JrZXJzKCkge1xyXG5cdHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IEltYWdlLmdldERlY29kZXJXb3JrZXJzKCkgaXMgbm90IGltcGxlbWVudGVkIGJ5IEltYWdlQmFzZSBpbmhlcml0b3InO1xyXG59O1xyXG5cclxuSW1hZ2VCYXNlLnByb3RvdHlwZS5nZXRUaWxlV2lkdGggPSBmdW5jdGlvbiBnZXRUaWxlV2lkdGgoKSB7XHJcbiAgICByZXR1cm4gdGhpcy5fdGlsZVdpZHRoO1xyXG59O1xyXG5cclxuSW1hZ2VCYXNlLnByb3RvdHlwZS5nZXRUaWxlSGVpZ2h0ID0gZnVuY3Rpb24gZ2V0VGlsZUhlaWdodCgpIHtcclxuICAgIHJldHVybiB0aGlzLl90aWxlSGVpZ2h0O1xyXG59O1xyXG4gICAgXHJcbkltYWdlQmFzZS5wcm90b3R5cGUuc2V0U2VydmVyUmVxdWVzdFByaW9yaXRpemVyRGF0YSA9XHJcbiAgICBmdW5jdGlvbiBzZXRTZXJ2ZXJSZXF1ZXN0UHJpb3JpdGl6ZXJEYXRhKHByaW9yaXRpemVyRGF0YSkge1xyXG5cclxuICAgIHRoaXMuX3ZhbGlkYXRlRmV0Y2hlcigpO1xyXG4gICAgXHJcbiAgICAvLyBUT0RPXHJcbiAgICAvL3RoaXMuX2ZldGNoZXIuc2V0U2VydmVyUmVxdWVzdFByaW9yaXRpemVyRGF0YShcclxuICAgIC8vICAgIHByaW9yaXRpemVyRGF0YSk7XHJcbn07XHJcblxyXG5JbWFnZUJhc2UucHJvdG90eXBlLnNldERlY29kZVByaW9yaXRpemVyRGF0YSA9XHJcbiAgICBmdW5jdGlvbiBzZXREZWNvZGVQcmlvcml0aXplckRhdGEocHJpb3JpdGl6ZXJEYXRhKSB7XHJcblxyXG4gICAgdGhpcy5fdmFsaWRhdGVEZWNvZGVyKCk7XHJcbiAgICBcclxuICAgIC8vIFRPRE9cclxuICAgIGlmICghSW1hZ2VCYXNlLnVuZGVmaW5lZFZhcikgeyAvLyBBdm9pZCB1bnJlYWNoYWJsZSB3YXJuaW5nXHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgaWYgKHRoaXMuX2RlY29kZVByaW9yaXRpemVyID09PSBudWxsKSB7XHJcbiAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogTm8gZGVjb2RlIHByaW9yaXRpemVyIGhhcyBiZWVuIHNldCc7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGlmICh0aGlzLl9zaG93TG9nKSB7XHJcbiAgICAgICAgY29uc29sZS5sb2coJ3NldERlY29kZVByaW9yaXRpemVyRGF0YSgnICsgcHJpb3JpdGl6ZXJEYXRhICsgJyknKTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgdmFyIHByaW9yaXRpemVyRGF0YU1vZGlmaWVkID0gT2JqZWN0LmNyZWF0ZShwcmlvcml0aXplckRhdGEpO1xyXG4gICAgcHJpb3JpdGl6ZXJEYXRhTW9kaWZpZWQuaW1hZ2UgPSB0aGlzO1xyXG4gICAgXHJcbiAgICB0aGlzLl9kZWNvZGVQcmlvcml0aXplci5zZXRQcmlvcml0aXplckRhdGEocHJpb3JpdGl6ZXJEYXRhTW9kaWZpZWQpO1xyXG59O1xyXG5cclxuSW1hZ2VCYXNlLnByb3RvdHlwZS5vcGVuID0gZnVuY3Rpb24gb3Blbih1cmwpIHtcclxuICAgIHRoaXMuX3ZhbGlkYXRlRmV0Y2hlcigpO1xyXG4gICAgXHJcbiAgICB2YXIgc2VsZiA9IHRoaXM7XHJcbiAgICB2YXIgcHJvbWlzZSA9IHRoaXMuX2ZldGNoZXIub3BlbkludGVybmFsKHVybCk7XHJcbiAgICByZXR1cm4gcHJvbWlzZS50aGVuKGZ1bmN0aW9uIChzaXplc1BhcmFtcykge1xyXG4gICAgICAgIHNlbGYuX2ludGVybmFsU2l6ZXNQYXJhbXMgPSBzaXplc1BhcmFtcztcclxuICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgICBzaXplc1BhcmFtczogc2l6ZXNQYXJhbXMsXHJcbiAgICAgICAgICAgIGFwcGxpY2F0aXZlVGlsZVdpZHRoIDogc2VsZi5nZXRUaWxlV2lkdGgoKSxcclxuICAgICAgICAgICAgYXBwbGljYXRpdmVUaWxlSGVpZ2h0OiBzZWxmLmdldFRpbGVIZWlnaHQoKVxyXG4gICAgICAgIH07XHJcbiAgICB9KTtcclxufTtcclxuXHJcbkltYWdlQmFzZS5wcm90b3R5cGUuY2xvc2UgPSBmdW5jdGlvbiBjbG9zZSgpIHtcclxuICAgIHRoaXMuX3ZhbGlkYXRlRmV0Y2hlcigpO1xyXG4gICAgdGhpcy5fdmFsaWRhdGVEZWNvZGVyKCk7XHJcbiAgICBcclxuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgdGhpcy5fZGVjb2RlcnMubGVuZ3RoOyArK2kpIHtcclxuICAgICAgICB0aGlzLl9kZWNvZGVyc1tpXS50ZXJtaW5hdGUoKTtcclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4gdGhpcy5fZmV0Y2hlci5jbG9zZSgpO1xyXG59O1xyXG5cclxuSW1hZ2VCYXNlLnByb3RvdHlwZS5jcmVhdGVNb3ZhYmxlRmV0Y2ggPSBmdW5jdGlvbiBjcmVhdGVNb3ZhYmxlRmV0Y2goKSB7XHJcbiAgICB0aGlzLl92YWxpZGF0ZUZldGNoZXIoKTtcclxuICAgIHRoaXMuZ2V0SW1hZ2VQYXJhbXMoKTtcclxuICAgIFxyXG4gICAgdmFyIHNlbGYgPSB0aGlzO1xyXG4gICAgXHJcbiAgICByZXR1cm4gdGhpcy5fZmV0Y2hlci5jcmVhdGVNb3ZhYmxlRmV0Y2goKS50aGVuKGZ1bmN0aW9uKG1vdmFibGVIYW5kbGUpIHtcclxuICAgICAgICBzZWxmLl9tb3ZhYmxlU3RhdGVzW21vdmFibGVIYW5kbGVdID0ge1xyXG4gICAgICAgICAgICBkZWNvZGVKb2JzTGlzdGVuZXJIYW5kbGU6IG51bGxcclxuICAgICAgICB9O1xyXG4gICAgICAgIFxyXG4gICAgICAgIHJldHVybiBtb3ZhYmxlSGFuZGxlO1xyXG4gICAgfSk7XHJcbn07XHJcblxyXG5JbWFnZUJhc2UucHJvdG90eXBlLnJlcXVlc3RQaXhlbHMgPSBmdW5jdGlvbiByZXF1ZXN0UGl4ZWxzKGltYWdlUGFydFBhcmFtcykge1xyXG4gICAgdGhpcy5fdmFsaWRhdGVEZWNvZGVyKCk7XHJcbiAgICB0aGlzLmdldEltYWdlUGFyYW1zKCk7XHJcbiAgICBcclxuICAgIHZhciByZXNvbHZlLCByZWplY3Q7XHJcbiAgICB2YXIgYWNjdW11bGF0ZWRSZXN1bHQgPSB7fTtcclxuICAgIFxyXG4gICAgdmFyIHNlbGYgPSB0aGlzO1xyXG4gICAgdmFyIHByb21pc2UgPSBuZXcgUHJvbWlzZShzdGFydFByb21pc2UpO1xyXG4gICAgcmV0dXJuIHByb21pc2U7XHJcbiAgICBcclxuICAgIGZ1bmN0aW9uIHN0YXJ0UHJvbWlzZShyZXNvbHZlXywgcmVqZWN0Xykge1xyXG4gICAgICAgIHJlc29sdmUgPSByZXNvbHZlXztcclxuICAgICAgICByZWplY3QgPSByZWplY3RfO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHNlbGYuX3JlcXVlc3RzRGVjb2RlSm9ic1Bvb2wuZm9ya0RlY29kZUpvYnMoXHJcbiAgICAgICAgICAgIGltYWdlUGFydFBhcmFtcyxcclxuICAgICAgICAgICAgaW50ZXJuYWxDYWxsYmFjayxcclxuICAgICAgICAgICAgaW50ZXJuYWxUZXJtaW5hdGVkQ2FsbGJhY2spO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBmdW5jdGlvbiBpbnRlcm5hbENhbGxiYWNrKGRlY29kZWREYXRhKSB7XHJcbiAgICAgICAgc2VsZi5fY29weVBpeGVsc1RvQWNjdW11bGF0ZWRSZXN1bHQoZGVjb2RlZERhdGEsIGFjY3VtdWxhdGVkUmVzdWx0KTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgZnVuY3Rpb24gaW50ZXJuYWxUZXJtaW5hdGVkQ2FsbGJhY2soaXNBYm9ydGVkKSB7XHJcbiAgICAgICAgaWYgKGlzQWJvcnRlZCkge1xyXG4gICAgICAgICAgICByZWplY3QoJ1JlcXVlc3Qgd2FzIGFib3J0ZWQgZHVlIHRvIGZhaWx1cmUgb3IgcHJpb3JpdHknKTtcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICByZXNvbHZlKGFjY3VtdWxhdGVkUmVzdWx0KTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbn07XHJcblxyXG5JbWFnZUJhc2UucHJvdG90eXBlLnJlcXVlc3RQaXhlbHNQcm9ncmVzc2l2ZSA9IGZ1bmN0aW9uIHJlcXVlc3RQaXhlbHNQcm9ncmVzc2l2ZShcclxuICAgIGltYWdlUGFydFBhcmFtcyxcclxuICAgIGNhbGxiYWNrLFxyXG4gICAgdGVybWluYXRlZENhbGxiYWNrLFxyXG4gICAgaW1hZ2VQYXJ0UGFyYW1zTm90TmVlZGVkLFxyXG4gICAgbW92YWJsZUhhbmRsZSkge1xyXG4gICAgXHJcbiAgICB0aGlzLl92YWxpZGF0ZURlY29kZXIoKTtcclxuICAgIHRoaXMuZ2V0SW1hZ2VQYXJhbXMoKTtcclxuICAgIFxyXG4gICAgdmFyIG1vdmFibGVTdGF0ZSA9IG51bGw7XHJcbiAgICB2YXIgZGVjb2RlSm9ic1Bvb2w7XHJcbiAgICBpZiAobW92YWJsZUhhbmRsZSA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgZGVjb2RlSm9ic1Bvb2wgPSB0aGlzLl9yZXF1ZXN0c0RlY29kZUpvYnNQb29sO1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgICBkZWNvZGVKb2JzUG9vbCA9IHRoaXMuX21vdmFibGVzRGVjb2RlSm9ic1Bvb2w7XHJcbiAgICAgICAgXHJcbiAgICAgICAgbW92YWJsZVN0YXRlID0gdGhpcy5fbW92YWJsZVN0YXRlc1ttb3ZhYmxlSGFuZGxlXTtcclxuICAgICAgICBcclxuICAgICAgICBpZiAobW92YWJsZVN0YXRlID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogTW92YWJsZSBoYW5kbGUgZG9lcyBub3QgZXhpc3QnO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuICAgIFxyXG4gICAgdmFyIGxpc3RlbmVySGFuZGxlID0gZGVjb2RlSm9ic1Bvb2wuZm9ya0RlY29kZUpvYnMoXHJcbiAgICAgICAgaW1hZ2VQYXJ0UGFyYW1zLFxyXG4gICAgICAgIGNhbGxiYWNrLFxyXG4gICAgICAgIHRlcm1pbmF0ZWRDYWxsYmFjayxcclxuICAgICAgICBpbWFnZVBhcnRQYXJhbXNOb3ROZWVkZWQpO1xyXG4gICAgICAgIFxyXG4gICAgaWYgKG1vdmFibGVIYW5kbGUgIT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIGlmIChtb3ZhYmxlU3RhdGUuZGVjb2RlSm9ic0xpc3RlbmVySGFuZGxlICE9PSBudWxsKSB7XHJcbiAgICAgICAgICAgIC8vIFVucmVnaXN0ZXIgYWZ0ZXIgZm9ya2VkIG5ldyBqb2JzLCBzbyBubyB0ZXJtaW5hdGlvbiBvY2N1cnMgbWVhbndoaWxlXHJcbiAgICAgICAgICAgIGRlY29kZUpvYnNQb29sLnVucmVnaXN0ZXJGb3JrZWRKb2JzKFxyXG4gICAgICAgICAgICAgICAgbW92YWJsZVN0YXRlLmRlY29kZUpvYnNMaXN0ZW5lckhhbmRsZSk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIG1vdmFibGVTdGF0ZS5kZWNvZGVKb2JzTGlzdGVuZXJIYW5kbGUgPSBsaXN0ZW5lckhhbmRsZTtcclxuICAgICAgICB0aGlzLl9mZXRjaGVyLm1vdmVGZXRjaChtb3ZhYmxlSGFuZGxlLCBpbWFnZVBhcnRQYXJhbXMpO1xyXG4gICAgfSBlbHNlIHtcclxuXHRcdHRoaXMuX2ZldGNoZXIuY3JlYXRlUmVxdWVzdCgrK3RoaXMuX2ZldGNoUmVxdWVzdElkLCBpbWFnZVBhcnRQYXJhbXMpO1xyXG5cdH1cclxufTtcclxuXHJcbi8vIEludGVybmFsIE1ldGhvZHNcclxuXHJcbkltYWdlQmFzZS5wcm90b3R5cGUuX3ZhbGlkYXRlRmV0Y2hlciA9IGZ1bmN0aW9uIHZhbGlkYXRlRmV0Y2hlcigpIHtcclxuICAgIGlmICh0aGlzLl9mZXRjaGVyID09PSBudWxsKSB7XHJcbiAgICAgICAgdGhpcy5fZmV0Y2hlciA9IHRoaXMuZ2V0RmV0Y2hlcigpO1xyXG4gICAgfVxyXG59O1xyXG5cclxuSW1hZ2VCYXNlLnByb3RvdHlwZS5fdmFsaWRhdGVEZWNvZGVyID0gZnVuY3Rpb24gdmFsaWRhdGVDb21wb25lbnRzKCkge1xyXG4gICAgaWYgKHRoaXMuX2RlY29kZURlcGVuZGVuY3lXb3JrZXJzICE9PSBudWxsKSB7XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICB0aGlzLl9kZWNvZGVEZXBlbmRlbmN5V29ya2VycyA9IHRoaXMuZ2V0RGVjb2RlcldvcmtlcnMoKTtcclxuICAgIFxyXG4gICAgdGhpcy5fcmVxdWVzdHNEZWNvZGVKb2JzUG9vbCA9IG5ldyBEZWNvZGVKb2JzUG9vbChcclxuICAgICAgICB0aGlzLl9kZWNvZGVEZXBlbmRlbmN5V29ya2VycyxcclxuICAgICAgICB0aGlzLl90aWxlV2lkdGgsXHJcbiAgICAgICAgdGhpcy5fdGlsZUhlaWdodCk7XHJcbiAgICAgICAgXHJcbiAgICB0aGlzLl9tb3ZhYmxlc0RlY29kZUpvYnNQb29sID0gbmV3IERlY29kZUpvYnNQb29sKFxyXG4gICAgICAgIHRoaXMuX2RlY29kZURlcGVuZGVuY3lXb3JrZXJzLFxyXG4gICAgICAgIHRoaXMuX3RpbGVXaWR0aCxcclxuICAgICAgICB0aGlzLl90aWxlSGVpZ2h0KTtcclxufTtcclxuXHJcbkltYWdlQmFzZS5wcm90b3R5cGUuX2dldEltYWdlUGFyYW1zSW50ZXJuYWwgPSBmdW5jdGlvbiBnZXRJbWFnZVBhcmFtc0ludGVybmFsKCkge1xyXG4gICAgcmV0dXJuIHRoaXMuX2ludGVybmFsU2l6ZXNQYXJhbXM7XHJcbn07XHJcblxyXG5JbWFnZUJhc2UucHJvdG90eXBlLl9jb3B5UGl4ZWxzVG9BY2N1bXVsYXRlZFJlc3VsdCA9XHJcbiAgICBmdW5jdGlvbiBjb3B5UGl4ZWxzVG9BY2N1bXVsYXRlZFJlc3VsdChkZWNvZGVkRGF0YSwgYWNjdW11bGF0ZWRSZXN1bHQpIHtcclxuICAgICAgICBcclxuICAgIHZhciBieXRlc1BlclBpeGVsID0gNDtcclxuICAgIHZhciBzb3VyY2VTdHJpZGUgPSBkZWNvZGVkRGF0YS53aWR0aCAqIGJ5dGVzUGVyUGl4ZWw7XHJcbiAgICB2YXIgdGFyZ2V0U3RyaWRlID1cclxuICAgICAgICBkZWNvZGVkRGF0YS5vcmlnaW5hbFJlcXVlc3RXaWR0aCAqIGJ5dGVzUGVyUGl4ZWw7XHJcbiAgICBcclxuICAgIGlmIChhY2N1bXVsYXRlZFJlc3VsdC5waXhlbHMgPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIHZhciBzaXplID1cclxuICAgICAgICAgICAgdGFyZ2V0U3RyaWRlICogZGVjb2RlZERhdGEub3JpZ2luYWxSZXF1ZXN0SGVpZ2h0O1xyXG4gICAgICAgICAgICBcclxuICAgICAgICBhY2N1bXVsYXRlZFJlc3VsdC5waXhlbHMgPSBuZXcgVWludDhBcnJheShzaXplKTtcclxuICAgICAgICBhY2N1bXVsYXRlZFJlc3VsdC54SW5PcmlnaW5hbFJlcXVlc3QgPSAwO1xyXG4gICAgICAgIGFjY3VtdWxhdGVkUmVzdWx0LnlJbk9yaWdpbmFsUmVxdWVzdCA9IDA7XHJcbiAgICAgICAgXHJcbiAgICAgICAgdmFyIHdpZHRoID0gZGVjb2RlZERhdGEub3JpZ2luYWxSZXF1ZXN0V2lkdGg7XHJcbiAgICAgICAgYWNjdW11bGF0ZWRSZXN1bHQub3JpZ2luYWxSZXF1ZXN0V2lkdGggPSB3aWR0aDtcclxuICAgICAgICBhY2N1bXVsYXRlZFJlc3VsdC53aWR0aCA9IHdpZHRoO1xyXG5cclxuICAgICAgICB2YXIgaGVpZ2h0ID0gZGVjb2RlZERhdGEub3JpZ2luYWxSZXF1ZXN0SGVpZ2h0O1xyXG4gICAgICAgIGFjY3VtdWxhdGVkUmVzdWx0Lm9yaWdpbmFsUmVxdWVzdEhlaWdodCA9IGhlaWdodDtcclxuICAgICAgICBhY2N1bXVsYXRlZFJlc3VsdC5oZWlnaHQgPSBoZWlnaHQ7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGFjY3VtdWxhdGVkUmVzdWx0LmFsbFJlbGV2YW50Qnl0ZXNMb2FkZWQgPVxyXG4gICAgICAgIGRlY29kZWREYXRhLmFsbFJlbGV2YW50Qnl0ZXNMb2FkZWQ7XHJcblxyXG4gICAgdmFyIHNvdXJjZU9mZnNldCA9IDA7XHJcbiAgICB2YXIgdGFyZ2V0T2Zmc2V0ID1cclxuICAgICAgICBkZWNvZGVkRGF0YS54SW5PcmlnaW5hbFJlcXVlc3QgKiBieXRlc1BlclBpeGVsICsgXHJcbiAgICAgICAgZGVjb2RlZERhdGEueUluT3JpZ2luYWxSZXF1ZXN0ICogdGFyZ2V0U3RyaWRlO1xyXG4gICAgXHJcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IGRlY29kZWREYXRhLmhlaWdodDsgKytpKSB7XHJcbiAgICAgICAgdmFyIHNvdXJjZVN1YkFycmF5ID0gZGVjb2RlZERhdGEucGl4ZWxzLnN1YmFycmF5KFxyXG4gICAgICAgICAgICBzb3VyY2VPZmZzZXQsIHNvdXJjZU9mZnNldCArIHNvdXJjZVN0cmlkZSk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgYWNjdW11bGF0ZWRSZXN1bHQucGl4ZWxzLnNldChzb3VyY2VTdWJBcnJheSwgdGFyZ2V0T2Zmc2V0KTtcclxuICAgICAgICBcclxuICAgICAgICBzb3VyY2VPZmZzZXQgKz0gc291cmNlU3RyaWRlO1xyXG4gICAgICAgIHRhcmdldE9mZnNldCArPSB0YXJnZXRTdHJpZGU7XHJcbiAgICB9XHJcbn07IiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBEZWNvZGVKb2I7XHJcblxyXG52YXIgTGlua2VkTGlzdCA9IHJlcXVpcmUoJ2xpbmtlZC1saXN0LmpzJyk7XHJcblxyXG52YXIgcmVxdWVzdElkQ291bnRlciA9IDA7XHJcblxyXG5mdW5jdGlvbiBEZWNvZGVKb2IobGlzdGVuZXJIYW5kbGUsIGltYWdlUGFydFBhcmFtcykge1xyXG4gICAgdGhpcy5faXNGaXJzdFN0YWdlID0gdHJ1ZTtcclxuICAgIHRoaXMuX2xpc3RlbmVySGFuZGxlID0gbGlzdGVuZXJIYW5kbGU7XHJcbiAgICB0aGlzLl9pbWFnZVBhcnRQYXJhbXMgPSBpbWFnZVBhcnRQYXJhbXM7XHJcbiAgICB0aGlzLl9hbGxSZWxldmFudEJ5dGVzTG9hZGVkID0gMDtcclxuICAgIHZhciByZXF1ZXN0UGFyYW1zID0gbGlzdGVuZXJIYW5kbGUuaW1hZ2VQYXJ0UGFyYW1zO1xyXG4gICAgdGhpcy5fb2Zmc2V0WCA9IGltYWdlUGFydFBhcmFtcy5taW5YIC0gcmVxdWVzdFBhcmFtcy5taW5YO1xyXG4gICAgdGhpcy5fb2Zmc2V0WSA9IGltYWdlUGFydFBhcmFtcy5taW5ZIC0gcmVxdWVzdFBhcmFtcy5taW5ZO1xyXG4gICAgdGhpcy5fcmVxdWVzdFdpZHRoID0gcmVxdWVzdFBhcmFtcy5tYXhYRXhjbHVzaXZlIC0gcmVxdWVzdFBhcmFtcy5taW5YO1xyXG4gICAgdGhpcy5fcmVxdWVzdEhlaWdodCA9IHJlcXVlc3RQYXJhbXMubWF4WUV4Y2x1c2l2ZSAtIHJlcXVlc3RQYXJhbXMubWluWTtcclxufVxyXG5cclxuRGVjb2RlSm9iLnByb3RvdHlwZS5vbkRhdGEgPSBmdW5jdGlvbiBvbkRhdGEoZGVjb2RlUmVzdWx0KSB7XHJcbiAgICB0aGlzLl9pc0ZpcnN0U3RhZ2UgPSBmYWxzZTtcclxuXHJcbiAgICB2YXIgcmVsZXZhbnRCeXRlc0xvYWRlZERpZmYgPVxyXG4gICAgICAgIGRlY29kZVJlc3VsdC5hbGxSZWxldmFudEJ5dGVzTG9hZGVkIC0gdGhpcy5fYWxsUmVsZXZhbnRCeXRlc0xvYWRlZDtcclxuICAgIHRoaXMuX2FsbFJlbGV2YW50Qnl0ZXNMb2FkZWQgPSBkZWNvZGVSZXN1bHQuYWxsUmVsZXZhbnRCeXRlc0xvYWRlZDtcclxuICAgIHRoaXMuX2xpc3RlbmVySGFuZGxlLmFsbFJlbGV2YW50Qnl0ZXNMb2FkZWQgKz0gcmVsZXZhbnRCeXRlc0xvYWRlZERpZmY7XHJcbiAgICBcclxuICAgIHZhciBkZWNvZGVkT2Zmc2V0dGVkID0ge1xyXG4gICAgICAgIG9yaWdpbmFsUmVxdWVzdFdpZHRoOiB0aGlzLl9yZXF1ZXN0V2lkdGgsXHJcbiAgICAgICAgb3JpZ2luYWxSZXF1ZXN0SGVpZ2h0OiB0aGlzLl9yZXF1ZXN0SGVpZ2h0LFxyXG4gICAgICAgIHhJbk9yaWdpbmFsUmVxdWVzdDogdGhpcy5fb2Zmc2V0WCxcclxuICAgICAgICB5SW5PcmlnaW5hbFJlcXVlc3Q6IHRoaXMuX29mZnNldFksXHJcbiAgICAgICAgXHJcbiAgICAgICAgaW1hZ2VEYXRhOiBkZWNvZGVSZXN1bHQsXHJcbiAgICAgICAgXHJcbiAgICAgICAgYWxsUmVsZXZhbnRCeXRlc0xvYWRlZDogdGhpcy5fbGlzdGVuZXJIYW5kbGUuYWxsUmVsZXZhbnRCeXRlc0xvYWRlZFxyXG4gICAgfTtcclxuICAgIFxyXG4gICAgdGhpcy5fbGlzdGVuZXJIYW5kbGUuY2FsbGJhY2soZGVjb2RlZE9mZnNldHRlZCk7XHJcbn07XHJcblxyXG5EZWNvZGVKb2IucHJvdG90eXBlLm9uVGVybWluYXRlZCA9IGZ1bmN0aW9uIG9uVGVybWluYXRlZCgpIHtcclxuICAgIC8vdGhpcy5fbGlzdGVuZXJIYW5kbGUuaXNBbnlEZWNvZGVyQWJvcnRlZCB8PSB0aGlzLl9pc0Fib3J0ZWQ7XHJcbiAgICBcclxuICAgIHZhciByZW1haW5pbmcgPSAtLXRoaXMuX2xpc3RlbmVySGFuZGxlLnJlbWFpbmluZ0RlY29kZUpvYnM7XHJcbiAgICBpZiAocmVtYWluaW5nIDwgMCkge1xyXG4gICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IEluY29uc2lzdGVudCBudW1iZXIgb2YgZG9uZSByZXF1ZXN0cyc7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHZhciBpc0xpc3RlbmVyRG9uZSA9IHJlbWFpbmluZyA9PT0gMDtcclxuICAgIGlmIChpc0xpc3RlbmVyRG9uZSkge1xyXG4gICAgICAgIHRoaXMuX2xpc3RlbmVySGFuZGxlLmlzVGVybWluYXRlZENhbGxiYWNrQ2FsbGVkID0gdHJ1ZTtcclxuICAgICAgICB0aGlzLl9saXN0ZW5lckhhbmRsZS50ZXJtaW5hdGVkQ2FsbGJhY2soXHJcbiAgICAgICAgICAgIHRoaXMuX2xpc3RlbmVySGFuZGxlLmlzQW55RGVjb2RlckFib3J0ZWQpO1xyXG4gICAgfVxyXG59OyIsIid1c2Ugc3RyaWN0JztcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gRGVjb2RlSm9ic1Bvb2w7XHJcblxyXG52YXIgRGVjb2RlSm9iID0gcmVxdWlyZSgnZGVjb2RlLWpvYi5qcycpO1xyXG5cclxuZnVuY3Rpb24gRGVjb2RlSm9ic1Bvb2woXHJcbiAgICBkZWNvZGVEZXBlbmRlbmN5V29ya2VycyxcclxuICAgIHRpbGVXaWR0aCxcclxuICAgIHRpbGVIZWlnaHQpIHtcclxuICAgIFxyXG4gICAgdGhpcy5fdGlsZVdpZHRoID0gdGlsZVdpZHRoO1xyXG4gICAgdGhpcy5fdGlsZUhlaWdodCA9IHRpbGVIZWlnaHQ7XHJcbiAgICBcclxuICAgIHRoaXMuX2RlY29kZURlcGVuZGVuY3lXb3JrZXJzID0gZGVjb2RlRGVwZW5kZW5jeVdvcmtlcnM7XHJcbn1cclxuXHJcbkRlY29kZUpvYnNQb29sLnByb3RvdHlwZS5mb3JrRGVjb2RlSm9icyA9IGZ1bmN0aW9uIGZvcmtEZWNvZGVKb2JzKFxyXG4gICAgaW1hZ2VQYXJ0UGFyYW1zLFxyXG4gICAgY2FsbGJhY2ssXHJcbiAgICB0ZXJtaW5hdGVkQ2FsbGJhY2ssXHJcbiAgICBpbWFnZVBhcnRQYXJhbXNOb3ROZWVkZWQpIHtcclxuICAgIFxyXG4gICAgdmFyIG1pblggPSBpbWFnZVBhcnRQYXJhbXMubWluWDtcclxuICAgIHZhciBtaW5ZID0gaW1hZ2VQYXJ0UGFyYW1zLm1pblk7XHJcbiAgICB2YXIgbWF4WCA9IGltYWdlUGFydFBhcmFtcy5tYXhYRXhjbHVzaXZlO1xyXG4gICAgdmFyIG1heFkgPSBpbWFnZVBhcnRQYXJhbXMubWF4WUV4Y2x1c2l2ZTtcclxuICAgIHZhciBsZXZlbCA9IGltYWdlUGFydFBhcmFtcy5sZXZlbCB8fCAwO1xyXG4gICAgdmFyIHF1YWxpdHkgPSBpbWFnZVBhcnRQYXJhbXMucXVhbGl0eTtcclxuICAgIHZhciBwcmlvcml0eURhdGEgPSBpbWFnZVBhcnRQYXJhbXMucmVxdWVzdFByaW9yaXR5RGF0YTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgdmFyIGlzTWluQWxpZ25lZCA9XHJcbiAgICAgICAgbWluWCAlIHRoaXMuX3RpbGVXaWR0aCA9PT0gMCAmJiBtaW5ZICUgdGhpcy5fdGlsZUhlaWdodCA9PT0gMDtcclxuICAgIHZhciBpc01heFhBbGlnbmVkID0gbWF4WCAlIHRoaXMuX3RpbGVXaWR0aCAgPT09IDAgfHwgbWF4WCA9PT0gaW1hZ2VQYXJ0UGFyYW1zLmxldmVsV2lkdGg7XHJcbiAgICB2YXIgaXNNYXhZQWxpZ25lZCA9IG1heFkgJSB0aGlzLl90aWxlSGVpZ2h0ID09PSAwIHx8IG1heFkgPT09IGltYWdlUGFydFBhcmFtcy5sZXZlbEhlaWdodDtcclxuICAgIHZhciBpc09yZGVyVmFsaWQgPSBtaW5YIDwgbWF4WCAmJiBtaW5ZIDwgbWF4WTtcclxuICAgIFxyXG4gICAgaWYgKCFpc01pbkFsaWduZWQgfHwgIWlzTWF4WEFsaWduZWQgfHwgIWlzTWF4WUFsaWduZWQgfHwgIWlzT3JkZXJWYWxpZCkge1xyXG4gICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IGltYWdlUGFydFBhcmFtcyBmb3IgZGVjb2RlcnMgaXMgbm90IGFsaWduZWQgdG8gJyArXHJcbiAgICAgICAgICAgICd0aWxlIHNpemUgb3Igbm90IGluIHZhbGlkIG9yZGVyJztcclxuICAgIH1cclxuICAgIFxyXG4gICAgdmFyIG51bVRpbGVzWCA9IE1hdGguY2VpbCgobWF4WCAtIG1pblgpIC8gdGhpcy5fdGlsZVdpZHRoKTtcclxuICAgIHZhciBudW1UaWxlc1kgPSBNYXRoLmNlaWwoKG1heFkgLSBtaW5ZKSAvIHRoaXMuX3RpbGVIZWlnaHQpO1xyXG4gICAgXHJcbiAgICB2YXIgbGlzdGVuZXJIYW5kbGUgPSB7XHJcbiAgICAgICAgaW1hZ2VQYXJ0UGFyYW1zOiBpbWFnZVBhcnRQYXJhbXMsXHJcbiAgICAgICAgY2FsbGJhY2s6IGNhbGxiYWNrLFxyXG4gICAgICAgIHRlcm1pbmF0ZWRDYWxsYmFjazogdGVybWluYXRlZENhbGxiYWNrLFxyXG4gICAgICAgIHJlbWFpbmluZ0RlY29kZUpvYnM6IG51bVRpbGVzWCAqIG51bVRpbGVzWSxcclxuICAgICAgICBpc0FueURlY29kZXJBYm9ydGVkOiBmYWxzZSxcclxuICAgICAgICBpc1Rlcm1pbmF0ZWRDYWxsYmFja0NhbGxlZDogZmFsc2UsXHJcbiAgICAgICAgYWxsUmVsZXZhbnRCeXRlc0xvYWRlZDogMCxcclxuICAgICAgICB1bnJlZ2lzdGVySGFuZGxlczogW11cclxuICAgIH07XHJcbiAgICBcclxuICAgIGZvciAodmFyIHggPSBtaW5YOyB4IDwgbWF4WDsgeCArPSB0aGlzLl90aWxlV2lkdGgpIHtcclxuICAgICAgICB2YXIgc2luZ2xlVGlsZU1heFggPSBNYXRoLm1pbih4ICsgdGhpcy5fdGlsZVdpZHRoLCBpbWFnZVBhcnRQYXJhbXMubGV2ZWxXaWR0aCk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgZm9yICh2YXIgeSA9IG1pblk7IHkgPCBtYXhZOyB5ICs9IHRoaXMuX3RpbGVIZWlnaHQpIHtcclxuICAgICAgICAgICAgdmFyIHNpbmdsZVRpbGVNYXhZID0gTWF0aC5taW4oeSArIHRoaXMuX3RpbGVIZWlnaHQsIGltYWdlUGFydFBhcmFtcy5sZXZlbEhlaWdodCk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICB2YXIgaXNUaWxlTm90TmVlZGVkID0gaXNVbm5lZWRlZChcclxuICAgICAgICAgICAgICAgIHgsXHJcbiAgICAgICAgICAgICAgICB5LFxyXG4gICAgICAgICAgICAgICAgc2luZ2xlVGlsZU1heFgsXHJcbiAgICAgICAgICAgICAgICBzaW5nbGVUaWxlTWF4WSxcclxuICAgICAgICAgICAgICAgIGltYWdlUGFydFBhcmFtc05vdE5lZWRlZCk7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgaWYgKGlzVGlsZU5vdE5lZWRlZCkge1xyXG4gICAgICAgICAgICAgICAgLS1saXN0ZW5lckhhbmRsZS5yZW1haW5pbmdEZWNvZGVKb2JzO1xyXG4gICAgICAgICAgICAgICAgY29udGludWU7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHZhciBzaW5nbGVUaWxlSW1hZ2VQYXJ0UGFyYW1zID0ge1xyXG4gICAgICAgICAgICAgICAgbWluWDogeCxcclxuICAgICAgICAgICAgICAgIG1pblk6IHksXHJcbiAgICAgICAgICAgICAgICBtYXhYRXhjbHVzaXZlOiBzaW5nbGVUaWxlTWF4WCxcclxuICAgICAgICAgICAgICAgIG1heFlFeGNsdXNpdmU6IHNpbmdsZVRpbGVNYXhZLFxyXG4gICAgICAgICAgICAgICAgbGV2ZWxXaWR0aDogaW1hZ2VQYXJ0UGFyYW1zLmxldmVsV2lkdGgsXHJcbiAgICAgICAgICAgICAgICBsZXZlbEhlaWdodDogaW1hZ2VQYXJ0UGFyYW1zLmxldmVsSGVpZ2h0LFxyXG4gICAgICAgICAgICAgICAgbGV2ZWw6IGxldmVsLFxyXG4gICAgICAgICAgICAgICAgcXVhbGl0eTogcXVhbGl0eSxcclxuICAgICAgICAgICAgICAgIHJlcXVlc3RQcmlvcml0eURhdGE6IHByaW9yaXR5RGF0YVxyXG4gICAgICAgICAgICB9O1xyXG5cclxuICAgICAgICAgICAgdmFyIGRlY29kZUpvYiA9IG5ldyBEZWNvZGVKb2IoXHJcbiAgICAgICAgICAgICAgICBsaXN0ZW5lckhhbmRsZSxcclxuICAgICAgICAgICAgICAgIHNpbmdsZVRpbGVJbWFnZVBhcnRQYXJhbXMpO1xyXG5cclxuICAgICAgICAgICAgdmFyIHRhc2tIYW5kbGUgPVxyXG4gICAgICAgICAgICAgICAgdGhpcy5fZGVjb2RlRGVwZW5kZW5jeVdvcmtlcnMuc3RhcnRUYXNrKFxyXG4gICAgICAgICAgICAgICAgICAgIHNpbmdsZVRpbGVJbWFnZVBhcnRQYXJhbXMsIGRlY29kZUpvYik7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBsaXN0ZW5lckhhbmRsZS51bnJlZ2lzdGVySGFuZGxlcy5wdXNoKHRhc2tIYW5kbGUpO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuICAgIFxyXG4gICAgaWYgKCFsaXN0ZW5lckhhbmRsZS5pc1Rlcm1pbmF0ZWRDYWxsYmFja0NhbGxlZCAmJlxyXG4gICAgICAgIGxpc3RlbmVySGFuZGxlLnJlbWFpbmluZ0RlY29kZUpvYnMgPT09IDApIHtcclxuICAgICAgICBcclxuICAgICAgICBsaXN0ZW5lckhhbmRsZS5pc1Rlcm1pbmF0ZWRDYWxsYmFja0NhbGxlZCA9IHRydWU7XHJcbiAgICAgICAgbGlzdGVuZXJIYW5kbGUudGVybWluYXRlZENhbGxiYWNrKGxpc3RlbmVySGFuZGxlLmlzQW55RGVjb2RlckFib3J0ZWQpO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICByZXR1cm4gbGlzdGVuZXJIYW5kbGU7XHJcbn07XHJcblxyXG5EZWNvZGVKb2JzUG9vbC5wcm90b3R5cGUudW5yZWdpc3RlckZvcmtlZEpvYnMgPSBmdW5jdGlvbiB1bnJlZ2lzdGVyRm9ya2VkSm9icyhcclxuICAgIGxpc3RlbmVySGFuZGxlKSB7XHJcbiAgICAgICAgICAgIFxyXG4gICAgaWYgKGxpc3RlbmVySGFuZGxlLnJlbWFpbmluZ0RlY29kZUpvYnMgPT09IDApIHtcclxuICAgICAgICAvLyBBbGwgam9icyBoYXMgYWxyZWFkeSBiZWVuIHRlcm1pbmF0ZWQsIG5vIG5lZWQgdG8gdW5yZWdpc3RlclxyXG4gICAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIFxyXG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBsaXN0ZW5lckhhbmRsZS51bnJlZ2lzdGVySGFuZGxlcy5sZW5ndGg7ICsraSkge1xyXG4gICAgICAgIGxpc3RlbmVySGFuZGxlLnVucmVnaXN0ZXJIYW5kbGVzW2ldLnVucmVnaXN0ZXIoKTtcclxuICAgIH1cclxufTtcclxuXHJcbmZ1bmN0aW9uIGlzVW5uZWVkZWQoXHJcbiAgICBtaW5YLCBtaW5ZLCBtYXhYLCBtYXhZLCBpbWFnZVBhcnRQYXJhbXNOb3ROZWVkZWQpIHtcclxuICAgIFxyXG4gICAgaWYgKGltYWdlUGFydFBhcmFtc05vdE5lZWRlZCA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IGltYWdlUGFydFBhcmFtc05vdE5lZWRlZC5sZW5ndGg7ICsraSkge1xyXG4gICAgICAgIHZhciBub3ROZWVkZWQgPSBpbWFnZVBhcnRQYXJhbXNOb3ROZWVkZWRbaV07XHJcbiAgICAgICAgdmFyIGlzSW5YID0gbWluWCA+PSBub3ROZWVkZWQubWluWCAmJiBtYXhYIDw9IG5vdE5lZWRlZC5tYXhYRXhjbHVzaXZlO1xyXG4gICAgICAgIHZhciBpc0luWSA9IG1pblkgPj0gbm90TmVlZGVkLm1pblkgJiYgbWF4WSA8PSBub3ROZWVkZWQubWF4WUV4Y2x1c2l2ZTtcclxuICAgICAgICBcclxuICAgICAgICBpZiAoaXNJblggJiYgaXNJblkpIHtcclxuICAgICAgICAgICAgcmV0dXJuIHRydWU7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgXHJcbiAgICByZXR1cm4gZmFsc2U7XHJcbn0iLCIndXNlIHN0cmljdCc7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IEZldGNoQ29udGV4dEFwaTtcclxuXHJcbmZ1bmN0aW9uIEZldGNoQ29udGV4dEFwaSgpIHtcclxuXHR0aGlzLl9ldmVudHMgPSB7XHJcblx0XHRpc1Byb2dyZXNzaXZlQ2hhbmdlZDogW10sXHJcblx0XHRtb3ZlOiBbXSxcclxuXHRcdHRlcm1pbmF0ZTogW10sXHJcblx0XHRcclxuXHRcdHN0b3A6IFtdLFxyXG5cdFx0cmVzdW1lOiBbXSxcclxuXHRcdFxyXG5cdFx0aW50ZXJuYWxTdG9wcGVkOiBbXSxcclxuXHRcdGludGVybmFsRG9uZTogW11cclxuXHR9O1xyXG59XHJcblxyXG5GZXRjaENvbnRleHRBcGkucHJvdG90eXBlLnN0b3BwZWQgPSBmdW5jdGlvbiBzdG9wcGVkKCkge1xyXG5cdHRoaXMuX29uRXZlbnQoJ2ludGVybmFsU3RvcHBlZCcsIC8qaXNBYm9ydGVkPSovZmFsc2UpO1xyXG59O1xyXG5cclxuRmV0Y2hDb250ZXh0QXBpLnByb3RvdHlwZS5kb25lID0gZnVuY3Rpb24gZG9uZSgpIHtcclxuXHR0aGlzLl9vbkV2ZW50KCdpbnRlcm5hbERvbmUnKTtcclxufTtcclxuXHJcbkZldGNoQ29udGV4dEFwaS5wcm90b3R5cGUub24gPSBmdW5jdGlvbiBvbihldmVudCwgbGlzdGVuZXIsIGxpc3RlbmVyVGhpcykge1xyXG5cdHZhciBsaXN0ZW5lcnMgPSB0aGlzLl9ldmVudHNbZXZlbnRdO1xyXG5cdGlmICghbGlzdGVuZXJzKSB7XHJcblx0XHR0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBldmVudCAnICsgZXZlbnQgKyAnIGRvZXMgbm90IGV4aXN0IGluIEZldGNoQ29udGV4dCc7XHJcblx0fVxyXG5cdGxpc3RlbmVycy5wdXNoKHtcclxuXHRcdGxpc3RlbmVyOiBsaXN0ZW5lcixcclxuXHRcdGxpc3RlbmVyVGhpczogbGlzdGVuZXJUaGlzIHx8IHRoaXNcclxuXHR9KTtcclxufTtcclxuXHJcbkZldGNoQ29udGV4dEFwaS5wcm90b3R5cGUuX29uRXZlbnQgPSBmdW5jdGlvbiBvbkV2ZW50KGV2ZW50LCBhcmcxLCBhcmcyKSB7XHJcblx0dmFyIGxpc3RlbmVycyA9IHRoaXMuX2V2ZW50c1tldmVudF07XHJcblx0Zm9yICh2YXIgaSA9IDA7IGkgPCBsaXN0ZW5lcnMubGVuZ3RoOyArK2kpIHtcclxuXHRcdGxpc3RlbmVyc1tpXS5saXN0ZW5lci5jYWxsKGxpc3RlbmVyc1tpXS5saXN0ZW5lclRoaXMsIGFyZzEsIGFyZzIpO1xyXG5cdH1cclxufTsiLCIndXNlIHN0cmljdCc7XHJcblxyXG52YXIgRmV0Y2hDb250ZXh0QXBpID0gcmVxdWlyZSgnZmV0Y2gtY29udGV4dC1hcGkuanMnKTtcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gRmV0Y2hDb250ZXh0O1xyXG5cclxuRmV0Y2hDb250ZXh0LkZFVENIX1RZUEVfUkVRVUVTVCA9IDE7XHJcbkZldGNoQ29udGV4dC5GRVRDSF9UWVBFX01PVkFCTEUgPSAyOyAvLyBtb3ZhYmxlXHJcbkZldGNoQ29udGV4dC5GRVRDSF9UWVBFX09OTFlfV0FJVF9GT1JfREFUQSA9IDM7XHJcblxyXG5GZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX1dBSVRfRk9SX0ZFVENIX0NBTEwgPSAxO1xyXG5GZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX1JFUVVFU1RfV0FJVF9GT1JfU0NIRURVTEUgPSAyO1xyXG5GZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX0FDVElWRSA9IDM7XHJcbkZldGNoQ29udGV4dC5GRVRDSF9TVEFUVVNfUkVRVUVTVF9BQk9VVF9UT19ZSUVMRCA9IDQ7XHJcbkZldGNoQ29udGV4dC5GRVRDSF9TVEFUVVNfUkVRVUVTVF9ZSUVMREVEID0gNjtcclxuRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19SRVFVRVNUX0FCT1VUX1RPX0FCT1JUID0gODtcclxuRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19SRVFVRVNUX1RFUk1JTkFURUQgPSA5O1xyXG5GZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX1VORVhQRUNURURfRkFJTFVSRSA9IDEwO1xyXG5cclxuZnVuY3Rpb24gRmV0Y2hDb250ZXh0KGZldGNoZXIsIHNjaGVkdWxlciwgc2NoZWR1bGVkSm9ic0xpc3QsIGZldGNoVHlwZSwgY29udGV4dFZhcnMpIHtcclxuICAgIHRoaXMuX2ZldGNoZXIgPSBmZXRjaGVyO1xyXG4gICAgdGhpcy5fc2NoZWR1bGVyID0gc2NoZWR1bGVyO1xyXG4gICAgdGhpcy5fc2NoZWR1bGVkSm9ic0xpc3QgPSBzY2hlZHVsZWRKb2JzTGlzdDtcclxuICAgIHRoaXMuX3NjaGVkdWxlZEpvYnNMaXN0SXRlcmF0b3IgPSBudWxsO1xyXG4gICAgXHJcbiAgICB0aGlzLl90ZXJtaW5hdGVkTGlzdGVuZXJzID0gW107XHJcbiAgICBcclxuICAgIHRoaXMuX2ltYWdlUGFydFBhcmFtcyA9IG51bGw7XHJcbiAgICBcclxuICAgIHRoaXMuX3N0YXRlID0gRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19XQUlUX0ZPUl9GRVRDSF9DQUxMO1xyXG4gICAgdGhpcy5faXNNb3ZhYmxlID0gZmV0Y2hUeXBlID09PSBGZXRjaENvbnRleHQuRkVUQ0hfVFlQRV9NT1ZBQkxFO1xyXG4gICAgdGhpcy5fY29udGV4dFZhcnMgPSBjb250ZXh0VmFycztcclxuICAgIHRoaXMuX2lzT25seVdhaXRGb3JEYXRhID0gZmV0Y2hUeXBlID09PSBGZXRjaENvbnRleHQuRkVUQ0hfVFlQRV9PTkxZX1dBSVRfRk9SX0RBVEE7XHJcbiAgICB0aGlzLl91c2VTY2hlZHVsZXIgPSBmZXRjaFR5cGUgPT09IEZldGNoQ29udGV4dC5GRVRDSF9UWVBFX1JFUVVFU1Q7XHJcbiAgICB0aGlzLl9yZXNvdXJjZSA9IG51bGw7XHJcbiAgICB0aGlzLl9mZXRjaENvbnRleHRBcGkgPSBudWxsO1xyXG4gICAgLy90aGlzLl9hbHJlYWR5VGVybWluYXRlZFdoZW5BbGxEYXRhQXJyaXZlZCA9IGZhbHNlO1xyXG59XHJcblxyXG5GZXRjaENvbnRleHQucHJvdG90eXBlLmZldGNoID0gZnVuY3Rpb24gZmV0Y2goaW1hZ2VQYXJ0UGFyYW1zKSB7XHJcbiAgICBpZiAodGhpcy5faXNNb3ZhYmxlKSB7XHJcbiAgICAgICAgdGhpcy5faW1hZ2VQYXJ0UGFyYW1zID0gaW1hZ2VQYXJ0UGFyYW1zO1xyXG4gICAgICAgIHRoaXMuX3N0YXJ0RmV0Y2goKTtcclxuICAgICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGlmICh0aGlzLl9pbWFnZVBhcnRQYXJhbXMgIT09IG51bGwpIHtcclxuICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBDYW5ub3QgZmV0Y2ggdHdpY2Ugb24gZmV0Y2ggdHlwZSBvZiBcInJlcXVlc3RcIic7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGlmICh0aGlzLl9zdGF0ZSAhPT0gRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19XQUlUX0ZPUl9GRVRDSF9DQUxMKSB7XHJcbiAgICAgICAgdGhpcy5fc3RhdGUgPSBGZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX1VORVhQRUNURURfRkFJTFVSRTtcclxuICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBVbmV4cGVjdGVkIHN0YXRlIG9uIGZldGNoKCk6ICcgKyB0aGlzLl9zdGF0ZTtcclxuICAgIH1cclxuXHJcbiAgICB0aGlzLl9pbWFnZVBhcnRQYXJhbXMgPSBpbWFnZVBhcnRQYXJhbXM7XHJcbiAgICB0aGlzLl9zdGF0ZSA9IEZldGNoQ29udGV4dC5GRVRDSF9TVEFUVVNfUkVRVUVTVF9XQUlUX0ZPUl9TQ0hFRFVMRTtcclxuICAgIFxyXG4gICAgaWYgKCF0aGlzLl91c2VTY2hlZHVsZXIpIHtcclxuICAgICAgICBzdGFydFJlcXVlc3QoLypyZXNvdXJjZT0qL251bGwsIHRoaXMpO1xyXG4gICAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIFxyXG4gICAgdGhpcy5fc2NoZWR1bGVyLmVucXVldWVKb2Ioc3RhcnRSZXF1ZXN0LCB0aGlzLCBmZXRjaEFib3J0ZWRCeVNjaGVkdWxlcik7XHJcbn07XHJcblxyXG5GZXRjaENvbnRleHQucHJvdG90eXBlLm1hbnVhbEFib3J0UmVxdWVzdCA9IGZ1bmN0aW9uIG1hbnVhbEFib3J0UmVxdWVzdCgpIHtcclxuICAgIHN3aXRjaCAodGhpcy5fc3RhdGUpIHtcclxuICAgICAgICBjYXNlIEZldGNoQ29udGV4dC5GRVRDSF9TVEFUVVNfUkVRVUVTVF9URVJNSU5BVEVEOlxyXG4gICAgICAgIGNhc2UgRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19VTkVYUEVDVEVEX0ZBSUxVUkU6XHJcbiAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICBjYXNlIEZldGNoQ29udGV4dC5GRVRDSF9TVEFUVVNfUkVRVUVTVF9BQk9VVF9UT19BQk9SVDpcclxuICAgICAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogRG91YmxlIGNhbGwgdG8gbWFudWFsQWJvcnRSZXF1ZXN0KCknO1xyXG4gICAgICAgIGNhc2UgRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19BQ1RJVkU6XHJcbiAgICAgICAgICAgIHRoaXMuX3N0YXRlID0gRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19SRVFVRVNUX0FCT1VUX1RPX0FCT1JUO1xyXG4gICAgICAgICAgICBpZiAodGhpcy5faXNPbmx5V2FpdEZvckRhdGEpIHtcclxuICAgICAgICAgICAgICAgIHRoaXMuX2ZldGNoU3RvcHBlZCgvKmlzQWJvcnRlZD0qL3RydWUpO1xyXG4gICAgICAgICAgICB9IGVsc2Uge1xyXG5cdFx0XHRcdHRoaXMuX2ZldGNoQ29udGV4dEFwaS5fb25FdmVudCgnc3RvcCcsIC8qaXNBYm9ydGVkPSovdHJ1ZSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgYnJlYWs7XHJcbiAgICAgICAgY2FzZSBGZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX1dBSVRfRk9SX0ZFVENIX0NBTEw6XHJcbiAgICAgICAgICAgIHRoaXMuX3N0YXRlID0gRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19SRVFVRVNUX1RFUk1JTkFURUQ7XHJcbiAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICBjYXNlIEZldGNoQ29udGV4dC5GRVRDSF9TVEFUVVNfUkVRVUVTVF9XQUlUX0ZPUl9TQ0hFRFVMRTpcclxuICAgICAgICBjYXNlIEZldGNoQ29udGV4dC5GRVRDSF9TVEFUVVNfUkVRVUVTVF9BQk9VVF9UT19ZSUVMRDpcclxuICAgICAgICBjYXNlIEZldGNoQ29udGV4dC5GRVRDSF9TVEFUVVNfUkVRVUVTVF9ZSUVMREVEOlxyXG4gICAgICAgICAgICB0aGlzLl9zdGF0ZSA9IEZldGNoQ29udGV4dC5GRVRDSF9TVEFUVVNfUkVRVUVTVF9BQk9VVF9UT19BQk9SVDtcclxuICAgICAgICAgICAgYnJlYWs7XHJcbiAgICAgICAgZGVmYXVsdDpcclxuICAgICAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogVW5rbm93biBzdGF0ZSBpbiBtYW51YWxBYm9ydFJlcXVlc3QoKSBpbXBsZW1lbnRhdGlvbjogJyArIHRoaXMuX3N0YXRlO1xyXG4gICAgfVxyXG59O1xyXG5cclxuRmV0Y2hDb250ZXh0LnByb3RvdHlwZS5nZXRDb250ZXh0VmFycyA9IGZ1bmN0aW9uIGdldENvbnRleHRWYXJzKCkge1xyXG4gICAgcmV0dXJuIHRoaXMuX2NvbnRleHRWYXJzO1xyXG59O1xyXG5cclxuRmV0Y2hDb250ZXh0LnByb3RvdHlwZS5vbiA9IGZ1bmN0aW9uIG9uKGV2ZW50LCBsaXN0ZW5lcikge1xyXG4gICAgc3dpdGNoIChldmVudCkge1xyXG4gICAgICAgIGNhc2UgJ3Rlcm1pbmF0ZWQnOlxyXG4gICAgICAgICAgICB0aGlzLl90ZXJtaW5hdGVkTGlzdGVuZXJzLnB1c2gobGlzdGVuZXIpO1xyXG4gICAgICAgICAgICBicmVhaztcclxuICAgICAgICBkZWZhdWx0OlxyXG4gICAgICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBVbmV4cGVjdGVkIGV2ZW50ICcgKyBldmVudDtcclxuICAgIH1cclxufTtcclxuXHJcbkZldGNoQ29udGV4dC5wcm90b3R5cGUuc2V0SXNQcm9ncmVzc2l2ZSA9IGZ1bmN0aW9uIHNldElzUHJvZ3Jlc3NpdmUoaXNQcm9ncmVzc2l2ZSkge1xyXG4gICAgdGhpcy5faXNQcm9ncmVzc2l2ZSA9IGlzUHJvZ3Jlc3NpdmU7XHJcbiAgICBpZiAodGhpcy5fZmV0Y2hDb250ZXh0QXBpICE9PSBudWxsKSB7XHJcbiAgICAgICAgdGhpcy5fZmV0Y2hDb250ZXh0QXBpLl9vbkV2ZW50KCdpc1Byb2dyZXNzaXZlQ2hhbmdlZCcsIGlzUHJvZ3Jlc3NpdmUpO1xyXG4gICAgfVxyXG59O1xyXG5cclxuRmV0Y2hDb250ZXh0LnByb3RvdHlwZS5nZXRJc1Byb2dyZXNzaXZlID0gZnVuY3Rpb24gZ2V0SXNQcm9ncmVzc2l2ZSgpIHtcclxuICAgIHJldHVybiB0aGlzLl9pc1Byb2dyZXNzaXZlO1xyXG59O1xyXG5cclxuRmV0Y2hDb250ZXh0LnByb3RvdHlwZS5fc3RhcnRGZXRjaCA9IGZ1bmN0aW9uIHN0YXJ0RmV0Y2goKSB7XHJcbiAgICB2YXIgcHJldlN0YXRlID0gdGhpcy5fc3RhdGU7XHJcbiAgICB0aGlzLl9zdGF0ZSA9IEZldGNoQ29udGV4dC5GRVRDSF9TVEFUVVNfQUNUSVZFO1xyXG5cdFxyXG4gICAgaWYgKHRoaXMuX2lzT25seVdhaXRGb3JEYXRhKSB7XHJcbiAgICAgICAgdGhpcy5fZmV0Y2hDb250ZXh0QXBpID0gdGhpcy5fZXh0cmFjdEFscmVhZHlGZXRjaGVkRGF0YSgpO1xyXG4gICAgfSBlbHNlIGlmICghdGhpcy5faXNNb3ZhYmxlIHx8IHByZXZTdGF0ZSA9PT0gRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19XQUlUX0ZPUl9GRVRDSF9DQUxMKSB7XHJcblx0XHRpZiAodGhpcy5fZmV0Y2hDb250ZXh0QXBpICE9PSBudWxsKSB7XHJcblx0XHRcdHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IENhbm5vdCBzdGFydCBmZXRjaCBvZiBhbHJlYWR5IHN0YXJ0ZWQgZmV0Y2gnO1xyXG5cdFx0fVxyXG5cclxuICAgICAgICB0aGlzLl9mZXRjaENvbnRleHRBcGkgPSBuZXcgRmV0Y2hDb250ZXh0QXBpKHRoaXMpO1xyXG5cdFx0dGhpcy5fZmV0Y2hDb250ZXh0QXBpLm9uKCdpbnRlcm5hbFN0b3BwZWQnLCB0aGlzLl9mZXRjaFN0b3BwZWQsIHRoaXMpO1xyXG5cdFx0dGhpcy5fZmV0Y2hDb250ZXh0QXBpLm9uKCdpbnRlcm5hbERvbmUnLCB0aGlzLl9mZXRjaERvbmUsIHRoaXMpO1xyXG5cdFx0XHJcblx0XHRpZiAodGhpcy5faXNNb3ZhYmxlKSB7XHJcblx0XHRcdHRoaXMuX2ZldGNoZXIuc3RhcnRNb3ZhYmxlRmV0Y2godGhpcy5fZmV0Y2hDb250ZXh0QXBpLCB0aGlzLl9pbWFnZVBhcnRQYXJhbXMpO1xyXG5cdFx0fSBlbHNlIHtcclxuXHRcdFx0dGhpcy5fZmV0Y2hlci5zdGFydEZldGNoKHRoaXMuX2ZldGNoQ29udGV4dEFwaSwgdGhpcy5faW1hZ2VQYXJ0UGFyYW1zKTtcclxuXHRcdH1cclxuICAgIH0gZWxzZSB7XHJcbiAgICAgICAgdGhpcy5fZmV0Y2hDb250ZXh0QXBpLl9vbkV2ZW50KCdtb3ZlJywgdGhpcy5faW1hZ2VQYXJ0UGFyYW1zKTtcclxuICAgIH1cclxuICAgIFxyXG5cdGlmICh0aGlzLl9mZXRjaENvbnRleHRBcGkgIT09IG51bGwpIHsgLy8gTWlnaHQgYmUgc2V0IHRvIG51bGwgaW4gaW1tZWRpYXRlIGNhbGwgb2YgZmV0Y2hUZXJtaW5hdGVkIG9uIHByZXZpb3VzIGxpbmVcclxuXHRcdHRoaXMuX2ZldGNoQ29udGV4dEFwaS5fb25FdmVudCgnaXNQcm9ncmVzc2l2ZUNoYW5nZWQnLCB0aGlzLl9pc1Byb2dyZXNzaXZlKTtcclxuXHR9XHJcbn07XHJcblxyXG5GZXRjaENvbnRleHQucHJvdG90eXBlLmNoZWNrSWZTaG91bGRZaWVsZCA9IGZ1bmN0aW9uIGNoZWNrSWZTaG91bGRZaWVsZCgpIHtcclxuICAgIHRyeSB7XHJcbiAgICAgICAgaWYgKCF0aGlzLl91c2VTY2hlZHVsZXIgfHwgdGhpcy5fc3RhdGUgPT09IEZldGNoQ29udGV4dC5GRVRDSF9TVEFUVVNfUkVRVUVTVF9URVJNSU5BVEVEKSB7XHJcbiAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKHRoaXMuX3Jlc291cmNlID09PSBudWxsKSB7XHJcbiAgICAgICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IE5vIHJlc291cmNlIGFsbG9jYXRlZCBidXQgZmV0Y2ggY2FsbGJhY2sgY2FsbGVkJztcclxuICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgIGlmICghdGhpcy5fc2NoZWR1bGVyQ2FsbGJhY2tzLnNob3VsZFlpZWxkT3JBYm9ydCgpKSB7XHJcbiAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgdGhpcy5fc3RhdGUgPSBGZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX1JFUVVFU1RfQUJPVVRfVE9fWUlFTEQ7XHJcblx0XHR0aGlzLl9mZXRjaENvbnRleHRBcGkuX29uRXZlbnQoJ3N0b3AnLCAvKmlzQWJvcnRlZD0qL2ZhbHNlKTtcclxuICAgIH0gY2F0Y2ggKGUpIHtcclxuICAgICAgICB0aGlzLl9zdGF0ZSA9IEZldGNoQ29udGV4dC5GRVRDSF9TVEFUVVNfVU5FWFBFQ1RFRF9GQUlMVVJFO1xyXG4gICAgICAgIGZldGNoQWJvcnRlZEJ5U2NoZWR1bGVyKHRoaXMpO1xyXG4gICAgfVxyXG59O1xyXG5cclxuRmV0Y2hDb250ZXh0LnByb3RvdHlwZS5fZmV0Y2hEb25lID0gZnVuY3Rpb24gZmV0Y2hEb25lKCkge1xyXG4gICAgc3dpdGNoICh0aGlzLl9zdGF0ZSkge1xyXG4gICAgICAgIGNhc2UgRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19SRVFVRVNUX0FCT1VUX1RPX0FCT1JUOlxyXG4gICAgICAgIGNhc2UgRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19BQ1RJVkU6XHJcbiAgICAgICAgY2FzZSBGZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX1JFUVVFU1RfQUJPVVRfVE9fWUlFTEQ6XHJcbiAgICAgICAgICAgIGJyZWFrO1xyXG4gICAgICAgIGRlZmF1bHQ6XHJcbiAgICAgICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IFVuZXhwZWN0ZWQgc3RhdGUgb24gZmV0Y2ggZG9uZTogJyArIHRoaXMuX3N0YXRlO1xyXG4gICAgfVxyXG5cclxuXHRpZiAodGhpcy5fcmVzb3VyY2UgIT09IG51bGwpIHtcclxuICAgICAgICB0aGlzLl9zY2hlZHVsZWRKb2JzTGlzdC5yZW1vdmUodGhpcy5fc2NoZWR1bGVkSm9ic0xpc3RJdGVyYXRvcik7XHJcbiAgICAgICAgdGhpcy5fc2NoZWR1bGVyQ2FsbGJhY2tzLmpvYkRvbmUoKTtcclxuXHJcbiAgICAgICAgdGhpcy5fcmVzb3VyY2UgPSBudWxsO1xyXG4gICAgfSBlbHNlIGlmICh0aGlzLl91c2VTY2hlZHVsZXIpIHtcclxuICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBKb2IgZXhwZWN0ZWQgdG8gaGF2ZSByZXNvdXJjZSBvbiBzdWNjZXNzZnVsIHRlcm1pbmF0aW9uJztcclxuICAgIH1cclxuXHRcclxuXHR0aGlzLl90ZXJtaW5hdGVOb25Nb3ZhYmxlRmV0Y2goKTtcclxufTtcclxuXHJcbkZldGNoQ29udGV4dC5wcm90b3R5cGUuX2ZldGNoU3RvcHBlZCA9IGZ1bmN0aW9uIGZldGNoU3RvcHBlZChpc0Fib3J0ZWQpIHtcclxuICAgIHN3aXRjaCAodGhpcy5fc3RhdGUpIHtcclxuICAgICAgICBjYXNlIEZldGNoQ29udGV4dC5GRVRDSF9TVEFUVVNfUkVRVUVTVF9BQk9VVF9UT19BQk9SVDpcclxuXHRcdFx0aXNBYm9ydGVkID0gdHJ1ZTsgLy8gZm9yY2UgYWJvcnRlZFxyXG4gICAgICAgICAgICBicmVhaztcclxuICAgICAgICBjYXNlIEZldGNoQ29udGV4dC5GRVRDSF9TVEFUVVNfUkVRVUVTVF9BQk9VVF9UT19ZSUVMRDpcclxuXHRcdFx0dmFyIGlzWWllbGRlZCA9IHRoaXMuX3NjaGVkdWxlckNhbGxiYWNrcy50cnlZaWVsZChcclxuXHRcdFx0XHRjb250aW51ZVlpZWxkZWRSZXF1ZXN0LFxyXG5cdFx0XHRcdGZldGNoQWJvcnRlZEJ5U2NoZWR1bGVyLFxyXG5cdFx0XHRcdGZldGNoWWllbGRlZEJ5U2NoZWR1bGVyKTtcclxuXHRcdFx0XHJcblx0XHRcdGlmICghaXNZaWVsZGVkKSB7XHJcblx0XHRcdFx0aWYgKHRoaXMuX3N0YXRlICE9PSBGZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX1JFUVVFU1RfQUJPVVRfVE9fWUlFTEQpIHtcclxuXHRcdFx0XHRcdHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IFVuZXhwZWN0ZWQgc3RhdGUgb24gdHJ5WWllbGQoKSBmYWxzZTogJyArIHRoaXMuX3N0YXRlO1xyXG5cdFx0XHRcdH1cclxuXHRcdFx0XHR0aGlzLl9zdGF0ZSA9IEZldGNoQ29udGV4dC5GRVRDSF9TVEFUVVNfQUNUSVZFO1xyXG5cdFx0XHRcdHRoaXMuX2ZldGNoQ29udGV4dEFwaS5fb25FdmVudCgncmVzdW1lJyk7XHJcblx0XHRcdFx0cmV0dXJuO1xyXG5cdFx0XHR9XHJcbiAgICAgICAgICAgIGJyZWFrO1xyXG4gICAgICAgIGRlZmF1bHQ6XHJcbiAgICAgICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IFVuZXhwZWN0ZWQgc3RhdGUgb24gZmV0Y2ggc3RvcHBlZDogJyArIHRoaXMuX3N0YXRlO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBpZiAodGhpcy5fcmVzb3VyY2UgIT09IG51bGwpIHtcclxuXHRcdHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IFVuZXhwZWN0ZWQgcmVxdWVzdCB0ZXJtaW5hdGlvbiB3aXRob3V0IHJlc291cmNlIGFsbG9jYXRlZCc7XHJcbiAgICB9XHJcblx0aWYgKCFpc0Fib3J0ZWQpIHtcclxuXHRcdHRoaXMuX3Rlcm1pbmF0ZU5vbk1vdmFibGVGZXRjaCgpO1xyXG5cdH1cclxufTtcclxuICBcclxuRmV0Y2hDb250ZXh0LnByb3RvdHlwZS5fdGVybWluYXRlTm9uTW92YWJsZUZldGNoID0gZnVuY3Rpb24gdGVybWluYXRlTm9uTW92YWJsZUZldGNoKCkgeyAgXHJcbiAgICBpZiAodGhpcy5faXNNb3ZhYmxlKSB7XHJcblx0XHRyZXR1cm47XHJcblx0fVxyXG5cdFxyXG5cdHRoaXMuX3N0YXRlID0gRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19SRVFVRVNUX1RFUk1JTkFURUQ7XHJcblx0XHJcblx0Zm9yICh2YXIgaSA9IDA7IGkgPCB0aGlzLl90ZXJtaW5hdGVkTGlzdGVuZXJzLmxlbmd0aDsgKytpKSB7XHJcblx0XHR0aGlzLl90ZXJtaW5hdGVkTGlzdGVuZXJzW2ldKHRoaXMuX2NvbnRleHRWYXJzKTtcclxuXHR9XHJcbiAgICBcclxuICAgIGlmICh0aGlzLl9mZXRjaENvbnRleHRBcGkgIT09IG51bGwgJiZcclxuICAgICAgICB0aGlzLl9zdGF0ZSAhPT0gRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19VTkVYUEVDVEVEX0ZBSUxVUkUpIHtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgdGhpcy5fZmV0Y2hDb250ZXh0QXBpLl9vbkV2ZW50KCd0ZXJtaW5hdGUnKTtcclxuICAgICAgICB0aGlzLl9mZXRjaENvbnRleHRBcGkgPSBudWxsO1xyXG4gICAgfVxyXG59O1xyXG5cclxuLy8gUHJvcGVydGllcyBmb3IgRnJ1c3R1bVJlcXVlc2V0UHJpb3JpdGl6ZXJcclxuXHJcbk9iamVjdC5kZWZpbmVQcm9wZXJ0eShGZXRjaENvbnRleHQucHJvdG90eXBlLCAnaW1hZ2VQYXJ0UGFyYW1zJywge1xyXG4gICAgZ2V0OiBmdW5jdGlvbiBnZXRJbWFnZVBhcnRQYXJhbXMoKSB7XHJcbiAgICAgICAgcmV0dXJuIHRoaXMuX2ltYWdlUGFydFBhcmFtcztcclxuICAgIH1cclxufSk7XHJcblxyXG5mdW5jdGlvbiBzdGFydFJlcXVlc3QocmVzb3VyY2UsIHNlbGYsIGNhbGxiYWNrcykge1xyXG4gICAgaWYgKHNlbGYuX3Jlc291cmNlICE9PSBudWxsKSB7XHJcbiAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogVW5leHBlY3RlZCByZXN0YXJ0IG9mIGFscmVhZHkgc3RhcnRlZCByZXF1ZXN0JztcclxuICAgIH1cclxuICAgIFxyXG4gICAgaWYgKHNlbGYuX3N0YXRlID09PSBGZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX1JFUVVFU1RfQUJPVVRfVE9fQUJPUlQpIHtcclxuICAgICAgICBzZWxmLl9mZXRjaFN0b3BwZWQoLyppc0Fib3J0ZWQ9Ki90cnVlKTtcclxuICAgICAgICByZXR1cm47XHJcbiAgICB9IGVsc2UgaWYgKHNlbGYuX3N0YXRlICE9PSBGZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX1JFUVVFU1RfV0FJVF9GT1JfU0NIRURVTEUpIHtcclxuICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBVbmV4cGVjdGVkIHN0YXRlIG9uIHNjaGVkdWxlOiAnICsgc2VsZi5fc3RhdGU7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHNlbGYuX3Jlc291cmNlID0gcmVzb3VyY2U7XHJcblx0c2VsZi5fc2NoZWR1bGVyQ2FsbGJhY2tzID0gY2FsbGJhY2tzO1xyXG5cclxuICAgIGlmIChyZXNvdXJjZSAhPT0gbnVsbCkge1xyXG4gICAgICAgIHNlbGYuX3NjaGVkdWxlZEpvYnNMaXN0SXRlcmF0b3IgPSBzZWxmLl9zY2hlZHVsZWRKb2JzTGlzdC5hZGQoc2VsZik7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHNlbGYuX3N0YXJ0RmV0Y2goKTtcclxufVxyXG5cclxuZnVuY3Rpb24gY29udGludWVZaWVsZGVkUmVxdWVzdChyZXNvdXJjZSwgc2VsZikge1xyXG4gICAgaWYgKHNlbGYuX2lzTW92YWJsZSkge1xyXG4gICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IFVuZXhwZWN0ZWQgY2FsbCB0byBjb250aW51ZVlpZWxkZWRSZXF1ZXN0IG9uIG1vdmFibGUgZmV0Y2gnO1xyXG4gICAgfVxyXG5cclxuICAgIGlmIChzZWxmLl9zdGF0ZSA9PT0gRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19SRVFVRVNUX0FCT1VUX1RPX0FCT1JUIHx8XHJcbiAgICAgICAgc2VsZi5fc3RhdGUgPT09IEZldGNoQ29udGV4dC5GRVRDSF9TVEFUVVNfVU5FWFBFQ1RFRF9GQUlMVVJFKSB7XHJcbiAgICAgICAgXHJcbiAgICAgICAgc2VsZi5fc2NoZWR1bGVyQ2FsbGJhY2tzLmpvYkRvbmUoKTtcclxuICAgICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGlmIChzZWxmLl9zdGF0ZSAhPT0gRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19SRVFVRVNUX1lJRUxERUQpIHtcclxuICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBVbmV4cGVjdGVkIHJlcXVlc3Qgc3RhdGUgb24gY29udGludWU6ICcgKyBzZWxmLl9zdGF0ZTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgc2VsZi5fc3RhdGUgPSBGZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX0FDVElWRTtcclxuICAgIHNlbGYuX3Jlc291cmNlID0gcmVzb3VyY2U7XHJcbiAgICBcclxuICAgIHNlbGYuX3NjaGVkdWxlZEpvYnNMaXN0SXRlcmF0b3IgPSBzZWxmLl9zY2hlZHVsZWRKb2JzTGlzdC5hZGQoc2VsZik7XHJcbiAgICBzZWxmLl9vbkV2ZW50KCdyZXN1bWUnKTtcclxufVxyXG5cclxuZnVuY3Rpb24gZmV0Y2hZaWVsZGVkQnlTY2hlZHVsZXIoc2VsZikge1xyXG4gICAgdmFyIG5leHRTdGF0ZTtcclxuICAgIHNlbGYuX3Jlc291cmNlID0gbnVsbDtcclxuICAgIHNlbGYuX3NjaGVkdWxlZEpvYnNMaXN0LnJlbW92ZShzZWxmLl9zY2hlZHVsZWRKb2JzTGlzdEl0ZXJhdG9yKTtcclxuICAgIGlmIChzZWxmLnN0YXRlID09PSBGZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX1JFUVVFU1RfQUJPVVRfVE9fWUlFTEQpIHtcclxuICAgICAgICBzZWxmLl9zdGF0ZSA9IEZldGNoQ29udGV4dC5GRVRDSF9TVEFUVVNfUkVRVUVTVF9ZSUVMREVEO1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgICBzZWxmLl9zdGF0ZSA9IEZldGNoQ29udGV4dC5GRVRDSF9TVEFUVVNfVU5FWFBFQ1RFRF9GQUlMVVJFO1xyXG4gICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IFVuZXhwZWN0ZWQgcmVxdWVzdCBzdGF0ZSBvbiB5aWVsZCBwcm9jZXNzOiAnICsgc2VsZi5fc3RhdGU7XHJcbiAgICB9XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGZldGNoQWJvcnRlZEJ5U2NoZWR1bGVyKHNlbGYpIHtcclxuICAgIHNlbGYuX3Jlc291cmNlID0gbnVsbDtcclxuICAgIHNlbGYuX2ZldGNoU3RvcHBlZCgvKmlzQWJvcnRlZD0qL3RydWUpO1xyXG59IiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBGZXRjaGVyQmFzZTtcclxuXHJcbnZhciBpbWFnZUhlbHBlckZ1bmN0aW9ucyA9IHJlcXVpcmUoJ2ltYWdlLWhlbHBlci1mdW5jdGlvbnMuanMnKTtcclxudmFyIEZldGNoQ29udGV4dCA9IHJlcXVpcmUoJ2ZldGNoLWNvbnRleHQuanMnKTtcclxudmFyIExpbmtlZExpc3QgPSByZXF1aXJlKCdsaW5rZWQtbGlzdC5qcycpO1xyXG52YXIgRmV0Y2hlckNsb3NlciA9IHJlcXVpcmUoJ2ZldGNoZXItY2xvc2VyLmpzJyk7XHJcbnZhciBTaW1wbGVNb3ZhYmxlRmV0Y2ggPSByZXF1aXJlKCdzaW1wbGUtbW92YWJsZS1mZXRjaC5qcycpO1xyXG5cclxuLyogZ2xvYmFsIGNvbnNvbGU6IGZhbHNlICovXHJcbi8qIGdsb2JhbCBQcm9taXNlOiBmYWxzZSAqL1xyXG5cclxuZnVuY3Rpb24gRmV0Y2hlckJhc2Uob3B0aW9ucykge1xyXG4gICAgb3B0aW9ucyA9IG9wdGlvbnMgfHwge307XHJcblx0XHJcblx0dmFyIHNlbGYgPSB0aGlzO1xyXG4gICAgdmFyIHNlcnZlclJlcXVlc3RzTGltaXQgPSBvcHRpb25zLnNlcnZlclJlcXVlc3RzTGltaXQgfHwgNTtcclxuICAgIFxyXG4gICAgc2VsZi5fc2hvd0xvZyA9IG9wdGlvbnMuc2hvd0xvZztcclxuXHRzZWxmLl9tYXhBY3RpdmVGZXRjaGVzSW5Nb3ZhYmxlRmV0Y2ggPSBvcHRpb25zLm1heEFjdGl2ZUZldGNoZXNJbk1vdmFibGVGZXRjaCB8fCAyO1xyXG4gICAgXHJcbiAgICBpZiAoc2VsZi5fc2hvd0xvZykge1xyXG4gICAgICAgIC8vIE9sZCBJRVxyXG4gICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IHNob3dMb2cgaXMgbm90IHN1cHBvcnRlZCBvbiB0aGlzIGJyb3dzZXInO1xyXG4gICAgfVxyXG5cdFxyXG4gICAgdmFyIHNlcnZlclJlcXVlc3RTY2hlZHVsZXIgPSBpbWFnZUhlbHBlckZ1bmN0aW9ucy5jcmVhdGVTY2hlZHVsZXIoXHJcbiAgICAgICAgb3B0aW9ucy5zaG93TG9nLFxyXG4gICAgICAgIG9wdGlvbnMuc2VydmVyUmVxdWVzdFByaW9yaXRpemVyLFxyXG4gICAgICAgICdzZXJ2ZXJSZXF1ZXN0JyxcclxuICAgICAgICBjcmVhdGVTZXJ2ZXJSZXF1ZXN0RHVtbXlSZXNvdXJjZSxcclxuICAgICAgICBzZXJ2ZXJSZXF1ZXN0c0xpbWl0KTtcclxuICAgIFxyXG4gICAgc2VsZi5fc2VydmVyUmVxdWVzdFByaW9yaXRpemVyID0gc2VydmVyUmVxdWVzdFNjaGVkdWxlci5wcmlvcml0aXplcjtcclxuICAgIFxyXG4gICAgc2VsZi5fc2NoZWR1bGVyID0gc2VydmVyUmVxdWVzdFNjaGVkdWxlci5zY2hlZHVsZXI7XHJcbiAgICBzZWxmLl9tb3ZhYmxlSGFuZGxlQ291bnRlciA9IDA7XHJcbiAgICBzZWxmLl9tb3ZhYmxlSGFuZGxlcyA9IFtdO1xyXG4gICAgc2VsZi5fcmVxdWVzdEJ5SWQgPSBbXTtcclxuXHRzZWxmLl9pbWFnZVBhcmFtcyA9IG51bGw7XHJcbiAgICBzZWxmLl9zY2hlZHVsZWRKb2JzTGlzdCA9IG5ldyBMaW5rZWRMaXN0KCk7XHJcblx0c2VsZi5fZmV0Y2hlckNsb3NlciA9IG5ldyBGZXRjaGVyQ2xvc2VyKCk7XHJcbn1cclxuXHJcbkZldGNoZXJCYXNlLnByb3RvdHlwZS5vcGVuID0gZnVuY3Rpb24gb3Blbih1cmwpIHtcclxuICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IG9wZW4oKSBpcyBub3QgaW1wbGVtZW50ZWQgYnkgRmV0Y2hlckJhc2UgaW5oZXJpdG9yJztcclxufTtcclxuXHJcbkZldGNoZXJCYXNlLnByb3RvdHlwZS5vbiA9IGZ1bmN0aW9uIG9uKGV2ZW50LCBjYWxsYmFjaykge1xyXG4gICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogb24oKSBpcyBub3QgaW1wbGVtZW50ZWQgYnkgRmV0Y2hlckJhc2UgaW5oZXJpdG9yJztcclxufTtcclxuXHJcbkZldGNoZXJCYXNlLnByb3RvdHlwZS5jbG9zZSA9IGZ1bmN0aW9uIGNsb3NlKCkge1xyXG5cdGlmICh0aGlzLnN0YXJ0TW92YWJsZUZldGNoICE9PSBGZXRjaGVyQmFzZS5wcm90b3R5cGUuc3RhcnRNb3ZhYmxlRmV0Y2gpIHtcclxuXHRcdHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IE11c3Qgb3ZlcnJpZGUgRmV0Y2hlckJhc2UuY2xvc2UoKSB3aGVuIEZldGNoZXJCYXNlLnN0YXJ0TW92YWJsZUZldGNoKCkgd2FzIG92ZXJyaWRlJztcclxuXHR9XHJcbiAgICByZXR1cm4gdGhpcy5fZmV0Y2hlckNsb3Nlci5jbG9zZSgpO1xyXG59O1xyXG5cclxuRmV0Y2hlckJhc2UucHJvdG90eXBlLm9wZW5JbnRlcm5hbCA9IGZ1bmN0aW9uIG9wZW5JbnRlcm5hbCh1cmwpIHtcclxuXHR2YXIgc2VsZiA9IHRoaXM7XHJcbiAgICByZXR1cm4gdGhpcy5vcGVuKHVybCkudGhlbihmdW5jdGlvbihyZXN1bHQpIHtcclxuXHRcdHNlbGYuX2ltYWdlUGFyYW1zID0gcmVzdWx0O1xyXG5cdFx0cmV0dXJuIHJlc3VsdDtcclxuXHR9KTtcclxufTtcclxuXHJcbkZldGNoZXJCYXNlLnByb3RvdHlwZS5nZXRJbWFnZVBhcmFtcyA9IGZ1bmN0aW9uIGdldEltYWdlUGFyYW1zKCkge1xyXG5cdHJldHVybiB0aGlzLl9pbWFnZVBhcmFtcztcclxufTtcclxuXHJcbkZldGNoZXJCYXNlLnByb3RvdHlwZS5zdGFydEZldGNoID0gZnVuY3Rpb24gc3RhcnRGZXRjaChmZXRjaENvbnRleHQsIGltYWdlUGFydFBhcmFtcykge1xyXG4gICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogc3RhcnRGZXRjaCgpIGlzIG5vdCBpbXBsZW1lbnRlZCBieSBGZXRjaGVyQmFzZSBpbmhlcml0b3InO1xyXG59O1xyXG5cclxuRmV0Y2hlckJhc2UucHJvdG90eXBlLnN0YXJ0TW92YWJsZUZldGNoID0gZnVuY3Rpb24gc3RhcnRGZXRjaChmZXRjaENvbnRleHQsIGltYWdlUGFydFBhcmFtcykge1xyXG4gICAgdmFyIG1vdmFibGVGZXRjaCA9IG5ldyBTaW1wbGVNb3ZhYmxlRmV0Y2goXHJcblx0XHR0aGlzLCB0aGlzLl9mZXRjaGVyQ2xvc2VyLCBmZXRjaENvbnRleHQsIHRoaXMuX21heEFjdGl2ZUZldGNoZXNJbk1vdmFibGVGZXRjaCk7XHJcblx0XHJcblx0bW92YWJsZUZldGNoLnN0YXJ0KGltYWdlUGFydFBhcmFtcyk7XHJcbn07XHJcblxyXG5GZXRjaGVyQmFzZS5wcm90b3R5cGUuc2V0SXNQcm9ncmVzc2l2ZVJlcXVlc3QgPSBmdW5jdGlvbiBzZXRJc1Byb2dyZXNzaXZlUmVxdWVzdChcclxuICAgIHJlcXVlc3RJZCwgaXNQcm9ncmVzc2l2ZSkge1xyXG4gICAgXHJcbiAgICB2YXIgZmV0Y2hKb2IgPSB0aGlzLl9yZXF1ZXN0QnlJZFtyZXF1ZXN0SWRdO1xyXG4gICAgaWYgKGZldGNoSm9iID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICAvLyBUaGlzIHNpdHVhdGlvbiBtaWdodCBvY2N1ciBpZiByZXF1ZXN0IGhhcyBiZWVuIHRlcm1pbmF0ZWQsXHJcbiAgICAgICAgLy8gYnV0IHVzZXIncyB0ZXJtaW5hdGVkQ2FsbGJhY2sgaGFzIG5vdCBiZWVuIGNhbGxlZCB5ZXQuIEl0XHJcbiAgICAgICAgLy8gaGFwcGVucyBvbiBXb3JrZXJQcm94eUZldGNoZXJCYXNlIGR1ZSB0byB0aHJlYWRcclxuICAgICAgICAvLyBtZXNzYWdlIGRlbGF5LlxyXG4gICAgICAgIFxyXG4gICAgICAgIHJldHVybiBudWxsO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBmZXRjaEpvYi5zZXRJc1Byb2dyZXNzaXZlKGlzUHJvZ3Jlc3NpdmUpO1xyXG59O1xyXG5cclxuRmV0Y2hlckJhc2UucHJvdG90eXBlLmNyZWF0ZU1vdmFibGVGZXRjaCA9IGZ1bmN0aW9uIGNyZWF0ZU1vdmFibGVGZXRjaCgpIHtcclxuXHR2YXIgc2VsZiA9IHRoaXM7XHJcbiAgICByZXR1cm4gbmV3IFByb21pc2UoZnVuY3Rpb24ocmVzb2x2ZSwgcmVqZWN0KSB7XHJcbiAgICAgICAgdmFyIG1vdmFibGVIYW5kbGUgPSArK3NlbGYuX21vdmFibGVIYW5kbGVDb3VudGVyO1xyXG4gICAgICAgIHNlbGYuX21vdmFibGVIYW5kbGVzW21vdmFibGVIYW5kbGVdID0gbmV3IEZldGNoQ29udGV4dChcclxuICAgICAgICAgICAgc2VsZixcclxuICAgICAgICAgICAgc2VsZi5fc2NoZWR1bGVyLFxyXG4gICAgICAgICAgICBzZWxmLl9zY2hlZHVsZWRKb2JzTGlzdCxcclxuICAgICAgICAgICAgRmV0Y2hDb250ZXh0LkZFVENIX1RZUEVfTU9WQUJMRSxcclxuICAgICAgICAgICAgLypjb250ZXh0VmFycz0qL251bGwpO1xyXG5cclxuICAgICAgICByZXNvbHZlKG1vdmFibGVIYW5kbGUpO1xyXG4gICAgfSk7XHJcbn07XHJcblxyXG5GZXRjaGVyQmFzZS5wcm90b3R5cGUubW92ZUZldGNoID0gZnVuY3Rpb24gbW92ZUZldGNoKFxyXG4gICAgbW92YWJsZUhhbmRsZSwgaW1hZ2VQYXJ0UGFyYW1zKSB7XHJcbiAgICBcclxuICAgIHZhciBtb3ZhYmxlID0gdGhpcy5fbW92YWJsZUhhbmRsZXNbbW92YWJsZUhhbmRsZV07XHJcbiAgICBtb3ZhYmxlLmZldGNoKGltYWdlUGFydFBhcmFtcyk7XHJcbn07XHJcblxyXG5GZXRjaGVyQmFzZS5wcm90b3R5cGUuY3JlYXRlUmVxdWVzdCA9IGZ1bmN0aW9uIGNyZWF0ZVJlcXVlc3QoXHJcbiAgICByZXF1ZXN0SWQsIGltYWdlUGFydFBhcmFtcykge1xyXG4gICAgXHJcbiAgICB2YXIgY29udGV4dFZhcnMgPSB7XHJcbiAgICAgICAgcHJvZ3Jlc3NpdmVTdGFnZXNEb25lOiAwLFxyXG4gICAgICAgIGlzTGFzdENhbGxiYWNrQ2FsbGVkV2l0aG91dExvd1F1YWxpdHlMaW1pdDogZmFsc2UsXHJcbiAgICAgICAgcmVxdWVzdElkOiByZXF1ZXN0SWQsXHJcbiAgICAgICAgZmV0Y2hKb2I6IG51bGwsXHJcbiAgICAgICAgc2VsZjogdGhpc1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgdmFyIGZldGNoVHlwZSA9IC8qaXNPbmx5V2FpdEZvckRhdGEgP1xyXG4gICAgICAgIEZldGNoQ29udGV4dC5GRVRDSF9UWVBFX09OTFlfV0FJVF9GT1JfREFUQSA6ICovRmV0Y2hDb250ZXh0LkZFVENIX1RZUEVfUkVRVUVTVDtcclxuICAgIFxyXG4gICAgdmFyIGZldGNoSm9iID0gbmV3IEZldGNoQ29udGV4dChcclxuICAgICAgICB0aGlzLCB0aGlzLl9zY2hlZHVsZXIsIHRoaXMuX3NjaGVkdWxlZEpvYnNMaXN0LCBmZXRjaFR5cGUsIGNvbnRleHRWYXJzKTtcclxuICAgIFxyXG4gICAgY29udGV4dFZhcnMuZmV0Y2hKb2IgPSBmZXRjaEpvYjtcclxuICAgIFxyXG4gICAgaWYgKHRoaXMuX3JlcXVlc3RCeUlkW3JlcXVlc3RJZF0gIT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IER1cGxpY2F0aW9uIG9mIHJlcXVlc3RJZCAnICsgcmVxdWVzdElkO1xyXG4gICAgfSBlbHNlIGlmIChyZXF1ZXN0SWQgIT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIHRoaXMuX3JlcXVlc3RCeUlkW3JlcXVlc3RJZF0gPSBmZXRjaEpvYjtcclxuICAgIH1cclxuICAgIFxyXG4gICAgZmV0Y2hKb2Iub24oJ3Rlcm1pbmF0ZWQnLCBpbnRlcm5hbFRlcm1pbmF0ZWRDYWxsYmFjayk7XHJcbiAgICBcclxuICAgIGZldGNoSm9iLmZldGNoKGltYWdlUGFydFBhcmFtcyk7XHJcbiAgICBcclxuICAgIHRoaXMuX3lpZWxkRmV0Y2hKb2JzKCk7XHJcbn07XHJcblxyXG5GZXRjaGVyQmFzZS5wcm90b3R5cGUubWFudWFsQWJvcnRSZXF1ZXN0ID0gZnVuY3Rpb24gbWFudWFsQWJvcnRSZXF1ZXN0KFxyXG4gICAgcmVxdWVzdElkKSB7XHJcbiAgICBcclxuICAgIHZhciBmZXRjaEpvYiA9IHRoaXMuX3JlcXVlc3RCeUlkW3JlcXVlc3RJZF07XHJcbiAgICBcclxuICAgIGlmIChmZXRjaEpvYiA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgLy8gVGhpcyBzaXR1YXRpb24gbWlnaHQgb2NjdXIgaWYgcmVxdWVzdCBoYXMgYmVlbiB0ZXJtaW5hdGVkLFxyXG4gICAgICAgIC8vIGJ1dCB1c2VyJ3MgdGVybWluYXRlZENhbGxiYWNrIGhhcyBub3QgYmVlbiBjYWxsZWQgeWV0LiBJdFxyXG4gICAgICAgIC8vIGhhcHBlbnMgb24gV29ya2VyUHJveHlGZXRjaGVyQmFzZSBkdWUgdG8gd2ViIHdvcmtlclxyXG4gICAgICAgIC8vIG1lc3NhZ2UgZGVsYXkuXHJcbiAgICAgICAgXHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBmZXRjaEpvYi5tYW51YWxBYm9ydFJlcXVlc3QoKTtcclxuICAgIGRlbGV0ZSB0aGlzLl9yZXF1ZXN0QnlJZFtyZXF1ZXN0SWRdO1xyXG59O1xyXG5cclxuRmV0Y2hlckJhc2UucHJvdG90eXBlLnNldFNlcnZlclJlcXVlc3RQcmlvcml0aXplckRhdGEgPVxyXG4gICAgZnVuY3Rpb24gc2V0U2VydmVyUmVxdWVzdFByaW9yaXRpemVyRGF0YShwcmlvcml0aXplckRhdGEpIHtcclxuXHJcbiAgICBpZiAodGhpcy5fc2VydmVyUmVxdWVzdFByaW9yaXRpemVyID09PSBudWxsKSB7XHJcbiAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogTm8gc2VydmVyUmVxdWVzdCBwcmlvcml0aXplciBoYXMgYmVlbiBzZXQnO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBpZiAodGhpcy5fc2hvd0xvZykge1xyXG4gICAgICAgIGNvbnNvbGUubG9nKCdzZXRTZXJ2ZXJSZXF1ZXN0UHJpb3JpdGl6ZXJEYXRhKCcgKyBwcmlvcml0aXplckRhdGEgKyAnKScpO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBwcmlvcml0aXplckRhdGEuaW1hZ2UgPSB0aGlzO1xyXG4gICAgdGhpcy5fc2VydmVyUmVxdWVzdFByaW9yaXRpemVyLnNldFByaW9yaXRpemVyRGF0YShwcmlvcml0aXplckRhdGEpO1xyXG4gICAgdGhpcy5feWllbGRGZXRjaEpvYnMoKTtcclxufTtcclxuXHJcbkZldGNoZXJCYXNlLnByb3RvdHlwZS5feWllbGRGZXRjaEpvYnMgPSBmdW5jdGlvbiB5aWVsZEZldGNoSm9icygpIHtcclxuICAgIHZhciBpdGVyYXRvciA9IHRoaXMuX3NjaGVkdWxlZEpvYnNMaXN0LmdldEZpcnN0SXRlcmF0b3IoKTtcclxuICAgIHdoaWxlIChpdGVyYXRvciAhPT0gbnVsbCkge1xyXG4gICAgICAgIHZhciBmZXRjaEpvYiA9IHRoaXMuX3NjaGVkdWxlZEpvYnNMaXN0LmdldFZhbHVlKGl0ZXJhdG9yKTtcclxuICAgICAgICBpdGVyYXRvciA9IHRoaXMuX3NjaGVkdWxlZEpvYnNMaXN0LmdldE5leHRJdGVyYXRvcihpdGVyYXRvcik7XHJcbiAgICAgICAgXHJcbiAgICAgICAgZmV0Y2hKb2IuY2hlY2tJZlNob3VsZFlpZWxkKCk7XHJcbiAgICB9XHJcbn07XHJcblxyXG5mdW5jdGlvbiBpbnRlcm5hbFRlcm1pbmF0ZWRDYWxsYmFjayhjb250ZXh0VmFycykge1xyXG4gICAgZGVsZXRlIGNvbnRleHRWYXJzLnNlbGYuX3JlcXVlc3RCeUlkW2NvbnRleHRWYXJzLnJlcXVlc3RJZF07XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGNyZWF0ZVNlcnZlclJlcXVlc3REdW1teVJlc291cmNlKCkge1xyXG4gICAgcmV0dXJuIHt9O1xyXG59IiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBGZXRjaGVyQ2xvc2VyO1xyXG5cclxuLyogZ2xvYmFsIFByb21pc2U6IGZhbHNlICovXHJcblxyXG5mdW5jdGlvbiBGZXRjaGVyQ2xvc2VyKCkge1xyXG5cdHRoaXMuX3Jlc29sdmVDbG9zZSA9IG51bGw7XHJcblx0dGhpcy5fYWN0aXZlRmV0Y2hlcyA9IDA7XHJcblx0dGhpcy5faXNDbG9zZWQgPSBmYWxzZTtcclxufVxyXG5cclxuRmV0Y2hlckNsb3Nlci5wcm90b3R5cGUuY2hhbmdlQWN0aXZlRmV0Y2hlc0NvdW50ID0gZnVuY3Rpb24gY2hhbmdlQWN0aXZlRmV0Y2hlc0NvdW50KGFkZFZhbHVlKSB7XHJcblx0aWYgKHRoaXMuX2lzQ2xvc2VkKSB7XHJcblx0XHR0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBVbmV4cGVjdGVkIGNoYW5nZSBvZiBhY3RpdmUgZmV0Y2hlcyBjb3VudCBhZnRlciBjbG9zZWQnO1xyXG5cdH1cclxuXHR0aGlzLl9hY3RpdmVGZXRjaGVzICs9IGFkZFZhbHVlO1xyXG5cdFxyXG5cdGlmICh0aGlzLl9hY3RpdmVGZXRjaGVzID09PSAwICYmIHRoaXMuX3Jlc29sdmVDbG9zZSkge1xyXG5cdFx0dGhpcy5faXNDbG9zZWQgPSB0cnVlO1xyXG5cdFx0dGhpcy5fcmVzb2x2ZUNsb3NlKCk7XHJcblx0fVxyXG59O1xyXG5cclxuRmV0Y2hlckNsb3Nlci5wcm90b3R5cGUuaXNDbG9zZVJlcXVlc3RlZCA9IGZ1bmN0aW9uIGlzQ2xvc2VSZXF1ZXN0ZWQoKSB7XHJcblx0cmV0dXJuIHRoaXMuX2lzQ2xvc2VkIHx8ICh0aGlzLl9yZXNvbHZlQ2xvc2UgIT09IG51bGwpO1xyXG59O1xyXG5cclxuRmV0Y2hlckNsb3Nlci5wcm90b3R5cGUuY2xvc2UgPSBmdW5jdGlvbiBjbG9zZSgpIHtcclxuXHRpZiAodGhpcy5pc0Nsb3NlUmVxdWVzdGVkKCkpIHtcclxuXHRcdHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IGNsb3NlKCkgY2FsbGVkIHR3aWNlJztcclxuXHR9XHJcblx0dmFyIHNlbGYgPSB0aGlzO1xyXG5cdHJldHVybiBuZXcgUHJvbWlzZShmdW5jdGlvbihyZXNvbHZlLCByZWplY3QpIHtcclxuXHRcdHNlbGYuX3Jlc29sdmVDbG9zZSA9IHJlc29sdmU7XHJcblx0XHRpZiAoc2VsZi5fYWN0aXZlRmV0Y2hlcyA9PT0gMCkge1xyXG5cdFx0XHRzZWxmLl9yZXNvbHZlQ2xvc2UoKTtcclxuXHRcdH1cclxuXHR9KTtcclxufTsiLCIndXNlIHN0cmljdCc7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IEZydXN0dW1SZXF1ZXN0c1ByaW9yaXRpemVyO1xyXG52YXIgUFJJT1JJVFlfQUJPUlRfTk9UX0lOX0ZSVVNUVU0gPSAtMTtcclxudmFyIFBSSU9SSVRZX0NBTENVTEFUSU9OX0ZBSUxFRCA9IDA7XHJcbnZhciBQUklPUklUWV9UT09fR09PRF9SRVNPTFVUSU9OID0gMTtcclxudmFyIFBSSU9SSVRZX05PVF9JTl9GUlVTVFVNID0gMjtcclxudmFyIFBSSU9SSVRZX0xPV0VSX1JFU09MVVRJT04gPSAzO1xyXG5cclxudmFyIFBSSU9SSVRZX01JTk9SSVRZX0lOX0ZSVVNUVU0gPSA0O1xyXG52YXIgUFJJT1JJVFlfUEFSVElBTF9JTl9GUlVTVFVNID0gNTtcclxudmFyIFBSSU9SSVRZX01BSk9SSVRZX0lOX0ZSVVNUVU0gPSA2O1xyXG52YXIgUFJJT1JJVFlfRlVMTFlfSU5fRlJVU1RVTSA9IDc7XHJcblxyXG52YXIgQUREX1BSSU9SSVRZX1RPX0xPV19RVUFMSVRZID0gNTtcclxuXHJcbnZhciBQUklPUklUWV9ISUdIRVNUID0gMTM7XHJcblxyXG52YXIgbG9nMiA9IE1hdGgubG9nKDIpO1xyXG5cclxuZnVuY3Rpb24gRnJ1c3R1bVJlcXVlc3RzUHJpb3JpdGl6ZXIoXHJcbiAgICBpc0Fib3J0UmVxdWVzdHNOb3RJbkZydXN0dW0sIGlzUHJpb3JpdGl6ZUxvd1Byb2dyZXNzaXZlU3RhZ2UpIHtcclxuICAgIFxyXG4gICAgdGhpcy5fZnJ1c3R1bURhdGEgPSBudWxsO1xyXG4gICAgdGhpcy5faXNBYm9ydFJlcXVlc3RzTm90SW5GcnVzdHVtID0gaXNBYm9ydFJlcXVlc3RzTm90SW5GcnVzdHVtO1xyXG4gICAgdGhpcy5faXNQcmlvcml0aXplTG93UHJvZ3Jlc3NpdmVTdGFnZSA9IGlzUHJpb3JpdGl6ZUxvd1Byb2dyZXNzaXZlU3RhZ2U7XHJcbn1cclxuXHJcbk9iamVjdC5kZWZpbmVQcm9wZXJ0eShcclxuICAgIEZydXN0dW1SZXF1ZXN0c1ByaW9yaXRpemVyLnByb3RvdHlwZSwgJ21pbmltYWxMb3dRdWFsaXR5UHJpb3JpdHknLCB7XHJcbiAgICAgICAgZ2V0OiBmdW5jdGlvbiBtaW5pbWFsTG93UXVhbGl0eVByaW9yaXR5KCkge1xyXG4gICAgICAgICAgICByZXR1cm4gUFJJT1JJVFlfTUlOT1JJVFlfSU5fRlJVU1RVTSArIEFERF9QUklPUklUWV9UT19MT1dfUVVBTElUWTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbik7XHJcbiAgICBcclxuRnJ1c3R1bVJlcXVlc3RzUHJpb3JpdGl6ZXIucHJvdG90eXBlLnNldFByaW9yaXRpemVyRGF0YSA9IGZ1bmN0aW9uIHNldFByaW9yaXRpemVyRGF0YShwcmlvcml0aXplckRhdGEpIHtcclxuICAgIHRoaXMuX2ZydXN0dW1EYXRhID0gcHJpb3JpdGl6ZXJEYXRhO1xyXG59O1xyXG5cclxuRnJ1c3R1bVJlcXVlc3RzUHJpb3JpdGl6ZXIucHJvdG90eXBlLmdldFByaW9yaXR5ID0gZnVuY3Rpb24gZ2V0UHJpb3JpdHkoam9iQ29udGV4dCkge1xyXG4gICAgdmFyIGltYWdlUGFydFBhcmFtcyA9IGpvYkNvbnRleHQuaW1hZ2VQYXJ0UGFyYW1zO1xyXG4gICAgaWYgKGltYWdlUGFydFBhcmFtcy5yZXF1ZXN0UHJpb3JpdHlEYXRhLm92ZXJyaWRlSGlnaGVzdFByaW9yaXR5KSB7XHJcbiAgICAgICAgcmV0dXJuIFBSSU9SSVRZX0hJR0hFU1Q7XHJcbiAgICB9XHJcblxyXG4gICAgdmFyIHByaW9yaXR5ID0gdGhpcy5fZ2V0UHJpb3JpdHlJbnRlcm5hbChpbWFnZVBhcnRQYXJhbXMpO1xyXG4gICAgdmFyIGlzSW5GcnVzdHVtID0gcHJpb3JpdHkgPj0gUFJJT1JJVFlfTUlOT1JJVFlfSU5fRlJVU1RVTTtcclxuICAgIFxyXG4gICAgaWYgKHRoaXMuX2lzQWJvcnRSZXF1ZXN0c05vdEluRnJ1c3R1bSAmJiAhaXNJbkZydXN0dW0pIHtcclxuICAgICAgICByZXR1cm4gUFJJT1JJVFlfQUJPUlRfTk9UX0lOX0ZSVVNUVU07XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHZhciBwcmlvcml0aXplTG93UHJvZ3Jlc3NpdmVTdGFnZSA9IDA7XHJcbiAgICBcclxuICAgIGlmICh0aGlzLl9pc1ByaW9yaXRpemVMb3dQcm9ncmVzc2l2ZVN0YWdlICYmIGlzSW5GcnVzdHVtKSB7XHJcbiAgICAgICAgcHJpb3JpdGl6ZUxvd1Byb2dyZXNzaXZlU3RhZ2UgPVxyXG4gICAgICAgICAgICBqb2JDb250ZXh0LnByb2dyZXNzaXZlU3RhZ2VzRG9uZSA9PT0gMCA/IEFERF9QUklPUklUWV9UT19MT1dfUVVBTElUWSA6XHJcbiAgICAgICAgICAgIGpvYkNvbnRleHQucHJvZ3Jlc3NpdmVTdGFnZXNEb25lID09PSAxID8gMSA6XHJcbiAgICAgICAgICAgIDA7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHJldHVybiBwcmlvcml0eSArIHByaW9yaXRpemVMb3dQcm9ncmVzc2l2ZVN0YWdlO1xyXG59O1xyXG5cclxuRnJ1c3R1bVJlcXVlc3RzUHJpb3JpdGl6ZXIucHJvdG90eXBlLl9nZXRQcmlvcml0eUludGVybmFsID0gZnVuY3Rpb24gZ2V0UHJpb3JpdHlJbnRlcm5hbChpbWFnZVBhcnRQYXJhbXMpIHtcclxuICAgIGlmICh0aGlzLl9mcnVzdHVtRGF0YSA9PT0gbnVsbCkge1xyXG4gICAgICAgIHJldHVybiBQUklPUklUWV9DQUxDVUxBVElPTl9GQUlMRUQ7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGlmICh0aGlzLl9mcnVzdHVtRGF0YS5pbWFnZVJlY3RhbmdsZSA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogTm8gaW1hZ2VSZWN0YW5nbGUgaW5mb3JtYXRpb24gcGFzc2VkIGluIHNldFByaW9yaXRpemVyRGF0YSc7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHZhciBleGFjdEZydXN0dW1MZXZlbCA9IHRoaXMuX2ZydXN0dW1EYXRhLmV4YWN0bGV2ZWw7XHJcbiAgICBcclxuICAgIGlmICh0aGlzLl9mcnVzdHVtRGF0YS5leGFjdGxldmVsID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBObyBleGFjdGxldmVsIGluZm9ybWF0aW9uIHBhc3NlZCBpbiAnICtcclxuICAgICAgICAgICAgJ3NldFByaW9yaXRpemVyRGF0YS4gVXNlIG51bGwgaWYgdW5rbm93bic7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHZhciB0aWxlV2VzdCA9IHRoaXMuX3BpeGVsVG9DYXJ0b2dyYXBoaWNYKFxyXG4gICAgICAgIGltYWdlUGFydFBhcmFtcy5taW5YLCBpbWFnZVBhcnRQYXJhbXMpO1xyXG4gICAgdmFyIHRpbGVFYXN0ID0gdGhpcy5fcGl4ZWxUb0NhcnRvZ3JhcGhpY1goXHJcbiAgICAgICAgaW1hZ2VQYXJ0UGFyYW1zLm1heFhFeGNsdXNpdmUsIGltYWdlUGFydFBhcmFtcyk7XHJcbiAgICB2YXIgdGlsZU5vcnRoID0gdGhpcy5fcGl4ZWxUb0NhcnRvZ3JhcGhpY1koXHJcbiAgICAgICAgaW1hZ2VQYXJ0UGFyYW1zLm1pblksIGltYWdlUGFydFBhcmFtcyk7XHJcbiAgICB2YXIgdGlsZVNvdXRoID0gdGhpcy5fcGl4ZWxUb0NhcnRvZ3JhcGhpY1koXHJcbiAgICAgICAgaW1hZ2VQYXJ0UGFyYW1zLm1heFlFeGNsdXNpdmUsIGltYWdlUGFydFBhcmFtcyk7XHJcbiAgICBcclxuICAgIHZhciB0aWxlUGl4ZWxzV2lkdGggPVxyXG4gICAgICAgIGltYWdlUGFydFBhcmFtcy5tYXhYRXhjbHVzaXZlIC0gaW1hZ2VQYXJ0UGFyYW1zLm1pblg7XHJcbiAgICB2YXIgdGlsZVBpeGVsc0hlaWdodCA9XHJcbiAgICAgICAgaW1hZ2VQYXJ0UGFyYW1zLm1heFlFeGNsdXNpdmUgLSBpbWFnZVBhcnRQYXJhbXMubWluWTtcclxuICAgIFxyXG4gICAgdmFyIHJlcXVlc3RUb0ZydXN0dW1SZXNvbHV0aW9uUmF0aW87XHJcbiAgICB2YXIgdGlsZUxldmVsID0gaW1hZ2VQYXJ0UGFyYW1zLmxldmVsIHx8IDA7XHJcbiAgICBpZiAoZXhhY3RGcnVzdHVtTGV2ZWwgPT09IG51bGwpIHtcclxuICAgICAgICB2YXIgdGlsZVJlc29sdXRpb25YID0gdGlsZVBpeGVsc1dpZHRoIC8gKHRpbGVFYXN0IC0gdGlsZVdlc3QpO1xyXG4gICAgICAgIHZhciB0aWxlUmVzb2x1dGlvblkgPSB0aWxlUGl4ZWxzSGVpZ2h0IC8gKHRpbGVOb3J0aCAtIHRpbGVTb3V0aCk7XHJcbiAgICAgICAgdmFyIHRpbGVSZXNvbHV0aW9uID0gTWF0aC5tYXgodGlsZVJlc29sdXRpb25YLCB0aWxlUmVzb2x1dGlvblkpO1xyXG4gICAgICAgIHZhciBmcnVzdHVtUmVzb2x1dGlvbiA9IHRoaXMuX2ZydXN0dW1EYXRhLnJlc29sdXRpb247XHJcbiAgICAgICAgcmVxdWVzdFRvRnJ1c3R1bVJlc29sdXRpb25SYXRpbyA9IHRpbGVSZXNvbHV0aW9uIC8gZnJ1c3R1bVJlc29sdXRpb247XHJcbiAgICBcclxuICAgICAgICBpZiAocmVxdWVzdFRvRnJ1c3R1bVJlc29sdXRpb25SYXRpbyA+IDIpIHtcclxuICAgICAgICAgICAgcmV0dXJuIFBSSU9SSVRZX1RPT19HT09EX1JFU09MVVRJT047XHJcbiAgICAgICAgfVxyXG4gICAgfSBlbHNlIGlmICh0aWxlTGV2ZWwgPCBleGFjdEZydXN0dW1MZXZlbCkge1xyXG4gICAgICAgIHJldHVybiBQUklPUklUWV9UT09fR09PRF9SRVNPTFVUSU9OO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICB2YXIgZnJ1c3R1bVJlY3RhbmdsZSA9IHRoaXMuX2ZydXN0dW1EYXRhLnJlY3RhbmdsZTtcclxuICAgIHZhciBpbnRlcnNlY3Rpb25XZXN0ID0gTWF0aC5tYXgoZnJ1c3R1bVJlY3RhbmdsZS53ZXN0LCB0aWxlV2VzdCk7XHJcbiAgICB2YXIgaW50ZXJzZWN0aW9uRWFzdCA9IE1hdGgubWluKGZydXN0dW1SZWN0YW5nbGUuZWFzdCwgdGlsZUVhc3QpO1xyXG4gICAgdmFyIGludGVyc2VjdGlvblNvdXRoID0gTWF0aC5tYXgoZnJ1c3R1bVJlY3RhbmdsZS5zb3V0aCwgdGlsZVNvdXRoKTtcclxuICAgIHZhciBpbnRlcnNlY3Rpb25Ob3J0aCA9IE1hdGgubWluKGZydXN0dW1SZWN0YW5nbGUubm9ydGgsIHRpbGVOb3J0aCk7XHJcbiAgICBcclxuICAgIHZhciBpbnRlcnNlY3Rpb25XaWR0aCA9IGludGVyc2VjdGlvbkVhc3QgLSBpbnRlcnNlY3Rpb25XZXN0O1xyXG4gICAgdmFyIGludGVyc2VjdGlvbkhlaWdodCA9IGludGVyc2VjdGlvbk5vcnRoIC0gaW50ZXJzZWN0aW9uU291dGg7XHJcbiAgICBcclxuICAgIGlmIChpbnRlcnNlY3Rpb25XaWR0aCA8IDAgfHwgaW50ZXJzZWN0aW9uSGVpZ2h0IDwgMCkge1xyXG4gICAgICAgIHJldHVybiBQUklPUklUWV9OT1RfSU5fRlJVU1RVTTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgaWYgKGV4YWN0RnJ1c3R1bUxldmVsICE9PSBudWxsKSB7XHJcbiAgICAgICAgaWYgKHRpbGVMZXZlbCA+IGV4YWN0RnJ1c3R1bUxldmVsKSB7XHJcbiAgICAgICAgICAgIHJldHVybiBQUklPUklUWV9MT1dFUl9SRVNPTFVUSU9OO1xyXG4gICAgICAgIH1cclxuICAgIH0gZWxzZSBpZiAodGlsZUxldmVsID4gMCAmJiByZXF1ZXN0VG9GcnVzdHVtUmVzb2x1dGlvblJhdGlvIDwgMC4yNSkge1xyXG4gICAgICAgIHJldHVybiBQUklPUklUWV9MT1dFUl9SRVNPTFVUSU9OO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICB2YXIgaW50ZXJzZWN0aW9uQXJlYSA9IGludGVyc2VjdGlvbldpZHRoICogaW50ZXJzZWN0aW9uSGVpZ2h0O1xyXG4gICAgdmFyIHRpbGVBcmVhID0gKHRpbGVFYXN0IC0gdGlsZVdlc3QpICogKHRpbGVOb3J0aCAtIHRpbGVTb3V0aCk7XHJcbiAgICB2YXIgcGFydEluRnJ1c3R1bSA9IGludGVyc2VjdGlvbkFyZWEgLyB0aWxlQXJlYTtcclxuICAgIFxyXG4gICAgaWYgKHBhcnRJbkZydXN0dW0gPiAwLjk5KSB7XHJcbiAgICAgICAgcmV0dXJuIFBSSU9SSVRZX0ZVTExZX0lOX0ZSVVNUVU07XHJcbiAgICB9IGVsc2UgaWYgKHBhcnRJbkZydXN0dW0gPiAwLjcpIHtcclxuICAgICAgICByZXR1cm4gUFJJT1JJVFlfTUFKT1JJVFlfSU5fRlJVU1RVTTtcclxuICAgIH0gZWxzZSBpZiAocGFydEluRnJ1c3R1bSA+IDAuMykge1xyXG4gICAgICAgIHJldHVybiBQUklPUklUWV9QQVJUSUFMX0lOX0ZSVVNUVU07XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICAgIHJldHVybiBQUklPUklUWV9NSU5PUklUWV9JTl9GUlVTVFVNO1xyXG4gICAgfVxyXG59O1xyXG5cclxuRnJ1c3R1bVJlcXVlc3RzUHJpb3JpdGl6ZXIucHJvdG90eXBlLl9waXhlbFRvQ2FydG9ncmFwaGljWCA9IGZ1bmN0aW9uIHBpeGVsVG9DYXJ0b2dyYXBoaWNYKFxyXG4gICAgeCwgaW1hZ2VQYXJ0UGFyYW1zKSB7XHJcbiAgICBcclxuICAgIHZhciByZWxhdGl2ZVggPSB4IC8gaW1hZ2VQYXJ0UGFyYW1zLmxldmVsV2lkdGg7XHJcbiAgICBcclxuICAgIHZhciBpbWFnZVJlY3RhbmdsZSA9IHRoaXMuX2ZydXN0dW1EYXRhLmltYWdlUmVjdGFuZ2xlO1xyXG4gICAgdmFyIHJlY3RhbmdsZVdpZHRoID0gaW1hZ2VSZWN0YW5nbGUuZWFzdCAtIGltYWdlUmVjdGFuZ2xlLndlc3Q7XHJcbiAgICBcclxuICAgIHZhciB4UHJvamVjdGVkID0gaW1hZ2VSZWN0YW5nbGUud2VzdCArIHJlbGF0aXZlWCAqIHJlY3RhbmdsZVdpZHRoO1xyXG4gICAgcmV0dXJuIHhQcm9qZWN0ZWQ7XHJcbn07XHJcblxyXG5GcnVzdHVtUmVxdWVzdHNQcmlvcml0aXplci5wcm90b3R5cGUuX3BpeGVsVG9DYXJ0b2dyYXBoaWNZID0gZnVuY3Rpb24gdGlsZVRvQ2FydG9ncmFwaGljWShcclxuICAgIHksIGltYWdlUGFydFBhcmFtcywgaW1hZ2UpIHtcclxuICAgIFxyXG4gICAgdmFyIHJlbGF0aXZlWSA9IHkgLyBpbWFnZVBhcnRQYXJhbXMubGV2ZWxIZWlnaHQ7XHJcbiAgICBcclxuICAgIHZhciBpbWFnZVJlY3RhbmdsZSA9IHRoaXMuX2ZydXN0dW1EYXRhLmltYWdlUmVjdGFuZ2xlO1xyXG4gICAgdmFyIHJlY3RhbmdsZUhlaWdodCA9IGltYWdlUmVjdGFuZ2xlLm5vcnRoIC0gaW1hZ2VSZWN0YW5nbGUuc291dGg7XHJcbiAgICBcclxuICAgIHZhciB5UHJvamVjdGVkID0gaW1hZ2VSZWN0YW5nbGUubm9ydGggLSByZWxhdGl2ZVkgKiByZWN0YW5nbGVIZWlnaHQ7XHJcbiAgICByZXR1cm4geVByb2plY3RlZDtcclxufTsiLCIndXNlIHN0cmljdCc7XHJcblxyXG52YXIgRnJ1c3R1bVJlcXVlc3RzUHJpb3JpdGl6ZXIgPSByZXF1aXJlKCdmcnVzdHVtLXJlcXVlc3RzLXByaW9yaXRpemVyLmpzJyk7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IHtcclxuICAgIGNhbGN1bGF0ZUZydXN0dW0yREZyb21Cb3VuZHM6IGNhbGN1bGF0ZUZydXN0dW0yREZyb21Cb3VuZHMsXHJcbiAgICBjcmVhdGVTY2hlZHVsZXI6IGNyZWF0ZVNjaGVkdWxlcixcclxuICAgIGZpeEJvdW5kczogZml4Qm91bmRzLFxyXG4gICAgYWxpZ25QYXJhbXNUb1RpbGVzQW5kTGV2ZWw6IGFsaWduUGFyYW1zVG9UaWxlc0FuZExldmVsLFxyXG59O1xyXG5cclxuLy8gQXZvaWQganNoaW50IGVycm9yXHJcbi8qIGdsb2JhbCBzZWxmOiBmYWxzZSAqL1xyXG4vKiBnbG9iYWwgZ2xvYmFsczogZmFsc2UgKi9cclxuICAgIFxyXG4vL3ZhciBsb2cyID0gTWF0aC5sb2coMik7XHJcblxyXG5mdW5jdGlvbiBjYWxjdWxhdGVGcnVzdHVtMkRGcm9tQm91bmRzKFxyXG4gICAgYm91bmRzLCBzY3JlZW5TaXplKSB7XHJcbiAgICBcclxuICAgIHZhciBzY3JlZW5QaXhlbHMgPVxyXG4gICAgICAgIHNjcmVlblNpemUueCAqIHNjcmVlblNpemUueCArIHNjcmVlblNpemUueSAqIHNjcmVlblNpemUueTtcclxuICAgIFxyXG4gICAgdmFyIGJvdW5kc1dpZHRoID0gYm91bmRzLmVhc3QgLSBib3VuZHMud2VzdDtcclxuICAgIHZhciBib3VuZHNIZWlnaHQgPSBib3VuZHMubm9ydGggLSBib3VuZHMuc291dGg7XHJcbiAgICB2YXIgYm91bmRzRGlzdGFuY2UgPVxyXG4gICAgICAgIGJvdW5kc1dpZHRoICogYm91bmRzV2lkdGggKyBib3VuZHNIZWlnaHQgKiBib3VuZHNIZWlnaHQ7XHJcbiAgICBcclxuICAgIHZhciByZXNvbHV0aW9uID0gTWF0aC5zcXJ0KHNjcmVlblBpeGVscyAvIGJvdW5kc0Rpc3RhbmNlKTtcclxuICAgIFxyXG4gICAgdmFyIGZydXN0dW1EYXRhID0ge1xyXG4gICAgICAgIHJlc29sdXRpb246IHJlc29sdXRpb24sXHJcbiAgICAgICAgcmVjdGFuZ2xlOiBib3VuZHMsXHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gUmVkdW5kYW50LCBidXQgZW5hYmxlcyB0byBhdm9pZCBhbHJlYWR5LXBlcmZvcm1lZCBjYWxjdWxhdGlvblxyXG4gICAgICAgIHNjcmVlblNpemU6IHNjcmVlblNpemVcclxuICAgIH07XHJcbiAgICBcclxuICAgIHJldHVybiBmcnVzdHVtRGF0YTtcclxufVxyXG4gICAgXHJcbmZ1bmN0aW9uIGNyZWF0ZVNjaGVkdWxlcihcclxuICAgIHNob3dMb2csIHByaW9yaXRpemVyVHlwZSwgc2NoZWR1bGVyTmFtZSwgY3JlYXRlUmVzb3VyY2UsIHJlc291cmNlTGltaXQpIHtcclxuICAgIFxyXG4gICAgdmFyIHByaW9yaXRpemVyO1xyXG4gICAgdmFyIHNjaGVkdWxlcjtcclxuICAgIFxyXG4gICAgaWYgKHByaW9yaXRpemVyVHlwZSA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgcHJpb3JpdGl6ZXIgPSBudWxsO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHNjaGVkdWxlciA9IG5ldyByZXNvdXJjZVNjaGVkdWxlci5MaWZvU2NoZWR1bGVyKFxyXG4gICAgICAgICAgICBjcmVhdGVSZXNvdXJjZSxcclxuICAgICAgICAgICAgcmVzb3VyY2VMaW1pdCk7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICAgIHZhciBsaW1pdFJlc291cmNlQnlMb3dRdWFsaXR5UHJpb3JpdHkgPSBmYWxzZTtcclxuICAgICAgICBcclxuICAgICAgICBpZiAocHJpb3JpdGl6ZXJUeXBlID09PSAnZnJ1c3R1bScpIHtcclxuICAgICAgICAgICAgbGltaXRSZXNvdXJjZUJ5TG93UXVhbGl0eVByaW9yaXR5ID0gdHJ1ZTtcclxuICAgICAgICAgICAgcHJpb3JpdGl6ZXIgPSBuZXcgRnJ1c3R1bVJlcXVlc3RzUHJpb3JpdGl6ZXIoKTtcclxuICAgICAgICB9IGVsc2UgaWYgKHByaW9yaXRpemVyVHlwZSA9PT0gJ2ZydXN0dW1Pbmx5Jykge1xyXG4gICAgICAgICAgICBsaW1pdFJlc291cmNlQnlMb3dRdWFsaXR5UHJpb3JpdHkgPSB0cnVlO1xyXG4gICAgICAgICAgICBwcmlvcml0aXplciA9IG5ldyBGcnVzdHVtUmVxdWVzdHNQcmlvcml0aXplcihcclxuICAgICAgICAgICAgICAgIC8qaXNBYm9ydFJlcXVlc3RzTm90SW5GcnVzdHVtPSovdHJ1ZSxcclxuICAgICAgICAgICAgICAgIC8qaXNQcmlvcml0aXplTG93UXVhbGl0eVN0YWdlPSovdHJ1ZSk7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgcHJpb3JpdGl6ZXIgPSBwcmlvcml0aXplclR5cGU7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHZhciBvcHRpb25zID0ge1xyXG4gICAgICAgICAgICBzY2hlZHVsZXJOYW1lOiBzY2hlZHVsZXJOYW1lLFxyXG4gICAgICAgICAgICBzaG93TG9nOiBzaG93TG9nXHJcbiAgICAgICAgfTtcclxuICAgICAgICBcclxuICAgICAgICBpZiAobGltaXRSZXNvdXJjZUJ5TG93UXVhbGl0eVByaW9yaXR5KSB7XHJcbiAgICAgICAgICAgIG9wdGlvbnMucmVzb3VyY2VHdWFyYW50ZWVkRm9ySGlnaFByaW9yaXR5ID0gcmVzb3VyY2VMaW1pdCAtIDI7XHJcbiAgICAgICAgICAgIG9wdGlvbnMuaGlnaFByaW9yaXR5VG9HdWFyYW50ZWVSZXNvdXJjZSA9XHJcbiAgICAgICAgICAgICAgICBwcmlvcml0aXplci5taW5pbWFsTG93UXVhbGl0eVByaW9yaXR5O1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBzY2hlZHVsZXIgPSBuZXcgcmVzb3VyY2VTY2hlZHVsZXIuUHJpb3JpdHlTY2hlZHVsZXIoXHJcbiAgICAgICAgICAgIGNyZWF0ZVJlc291cmNlLFxyXG4gICAgICAgICAgICByZXNvdXJjZUxpbWl0LFxyXG4gICAgICAgICAgICBwcmlvcml0aXplcixcclxuICAgICAgICAgICAgb3B0aW9ucyk7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHJldHVybiB7XHJcbiAgICAgICAgcHJpb3JpdGl6ZXI6IHByaW9yaXRpemVyLFxyXG4gICAgICAgIHNjaGVkdWxlcjogc2NoZWR1bGVyXHJcbiAgICB9O1xyXG59XHJcbiAgICBcclxuZnVuY3Rpb24gZml4Qm91bmRzKGJvdW5kcywgaW1hZ2UsIGFkYXB0UHJvcG9ydGlvbnMpIHtcclxuICAgIGlmICghYWRhcHRQcm9wb3J0aW9ucykge1xyXG4gICAgICAgIHJldHVybjtcclxuICAgIH1cclxuXHJcbiAgICB2YXIgcmVjdGFuZ2xlV2lkdGggPSBib3VuZHMuZWFzdCAtIGJvdW5kcy53ZXN0O1xyXG4gICAgdmFyIHJlY3RhbmdsZUhlaWdodCA9IGJvdW5kcy5ub3J0aCAtIGJvdW5kcy5zb3V0aDtcclxuXHJcbiAgICB2YXIgcGl4ZWxzQXNwZWN0UmF0aW8gPSBpbWFnZS5nZXRJbWFnZVdpZHRoKCkgLyBpbWFnZS5nZXRJbWFnZUhlaWdodCgpO1xyXG4gICAgdmFyIHJlY3RhbmdsZUFzcGVjdFJhdGlvID0gcmVjdGFuZ2xlV2lkdGggLyByZWN0YW5nbGVIZWlnaHQ7XHJcbiAgICBcclxuICAgIGlmIChwaXhlbHNBc3BlY3RSYXRpbyA8IHJlY3RhbmdsZUFzcGVjdFJhdGlvKSB7XHJcbiAgICAgICAgdmFyIG9sZFdpZHRoID0gcmVjdGFuZ2xlV2lkdGg7XHJcbiAgICAgICAgcmVjdGFuZ2xlV2lkdGggPSByZWN0YW5nbGVIZWlnaHQgKiBwaXhlbHNBc3BlY3RSYXRpbztcclxuICAgICAgICB2YXIgc3Vic3RyYWN0RnJvbVdpZHRoID0gb2xkV2lkdGggLSByZWN0YW5nbGVXaWR0aDtcclxuICAgICAgICBcclxuICAgICAgICBib3VuZHMuZWFzdCAtPSBzdWJzdHJhY3RGcm9tV2lkdGggLyAyO1xyXG4gICAgICAgIGJvdW5kcy53ZXN0ICs9IHN1YnN0cmFjdEZyb21XaWR0aCAvIDI7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICAgIHZhciBvbGRIZWlnaHQgPSByZWN0YW5nbGVIZWlnaHQ7XHJcbiAgICAgICAgcmVjdGFuZ2xlSGVpZ2h0ID0gcmVjdGFuZ2xlV2lkdGggLyBwaXhlbHNBc3BlY3RSYXRpbztcclxuICAgICAgICB2YXIgc3Vic3RyYWN0RnJvbUhlaWdodCA9IG9sZEhlaWdodCAtIHJlY3RhbmdsZUhlaWdodDtcclxuICAgICAgICBcclxuICAgICAgICBib3VuZHMubm9ydGggLT0gc3Vic3RyYWN0RnJvbUhlaWdodCAvIDI7XHJcbiAgICAgICAgYm91bmRzLnNvdXRoICs9IHN1YnN0cmFjdEZyb21IZWlnaHQgLyAyO1xyXG4gICAgfVxyXG59XHJcblxyXG5mdW5jdGlvbiBhbGlnblBhcmFtc1RvVGlsZXNBbmRMZXZlbChcclxuICAgIHJlZ2lvbiwgaW1hZ2UpIHtcclxuICAgIFxyXG4gICAgdmFyIHRpbGVXaWR0aCA9IGltYWdlLmdldFRpbGVXaWR0aCgpO1xyXG4gICAgdmFyIHRpbGVIZWlnaHQgPSBpbWFnZS5nZXRUaWxlSGVpZ2h0KCk7XHJcbiAgICBcclxuICAgIHZhciByZWdpb25NaW5YID0gcmVnaW9uLm1pblg7XHJcbiAgICB2YXIgcmVnaW9uTWluWSA9IHJlZ2lvbi5taW5ZO1xyXG4gICAgdmFyIHJlZ2lvbk1heFggPSByZWdpb24ubWF4WEV4Y2x1c2l2ZTtcclxuICAgIHZhciByZWdpb25NYXhZID0gcmVnaW9uLm1heFlFeGNsdXNpdmU7XHJcbiAgICB2YXIgc2NyZWVuV2lkdGggPSByZWdpb24uc2NyZWVuV2lkdGg7XHJcbiAgICB2YXIgc2NyZWVuSGVpZ2h0ID0gcmVnaW9uLnNjcmVlbkhlaWdodDtcclxuICAgIFxyXG4gICAgdmFyIGlzVmFsaWRPcmRlciA9IHJlZ2lvbk1pblggPCByZWdpb25NYXhYICYmIHJlZ2lvbk1pblkgPCByZWdpb25NYXhZO1xyXG4gICAgaWYgKCFpc1ZhbGlkT3JkZXIpIHtcclxuICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBQYXJhbWV0ZXJzIG9yZGVyIGlzIGludmFsaWQnO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICB2YXIgZGVmYXVsdExldmVsV2lkdGggPSBpbWFnZS5nZXRJbWFnZVdpZHRoKCk7XHJcbiAgICB2YXIgZGVmYXVsdExldmVsSGVpZ2h0ID0gaW1hZ2UuZ2V0SW1hZ2VIZWlnaHQoKTtcclxuICAgIGlmIChyZWdpb25NYXhYIDwgMCB8fCByZWdpb25NaW5YID49IGRlZmF1bHRMZXZlbFdpZHRoIHx8XHJcbiAgICAgICAgcmVnaW9uTWF4WSA8IDAgfHwgcmVnaW9uTWluWSA+PSBkZWZhdWx0TGV2ZWxIZWlnaHQpIHtcclxuICAgICAgICBcclxuICAgICAgICByZXR1cm4gbnVsbDtcclxuICAgIH1cclxuICAgIFxyXG4gICAgLy92YXIgbWF4TGV2ZWwgPVxyXG4gICAgLy8gICAgaW1hZ2UuZ2V0RGVmYXVsdE51bVJlc29sdXRpb25MZXZlbHMoKSAtIDE7XHJcblxyXG4gICAgLy92YXIgbGV2ZWxYID0gTWF0aC5sb2coKHJlZ2lvbk1heFggLSByZWdpb25NaW5YKSAvIHNjcmVlbldpZHRoICkgLyBsb2cyO1xyXG4gICAgLy92YXIgbGV2ZWxZID0gTWF0aC5sb2coKHJlZ2lvbk1heFkgLSByZWdpb25NaW5ZKSAvIHNjcmVlbkhlaWdodCkgLyBsb2cyO1xyXG4gICAgLy92YXIgbGV2ZWwgPSBNYXRoLmNlaWwoTWF0aC5taW4obGV2ZWxYLCBsZXZlbFkpKTtcclxuICAgIC8vbGV2ZWwgPSBNYXRoLm1heCgwLCBNYXRoLm1pbihtYXhMZXZlbCwgbGV2ZWwpKTtcclxuICAgIHZhciBsZXZlbCA9IGltYWdlLmdldExldmVsKHJlZ2lvbik7XHJcbiAgICB2YXIgbGV2ZWxXaWR0aCA9IGltYWdlLmdldExldmVsV2lkdGgobGV2ZWwpO1xyXG4gICAgdmFyIGxldmVsSGVpZ2h0ID0gaW1hZ2UuZ2V0TGV2ZWxIZWlnaHQobGV2ZWwpO1xyXG4gICAgXHJcbiAgICB2YXIgc2NhbGVYID0gZGVmYXVsdExldmVsV2lkdGggLyBsZXZlbFdpZHRoO1xyXG4gICAgdmFyIHNjYWxlWSA9IGRlZmF1bHRMZXZlbEhlaWdodCAvIGxldmVsSGVpZ2h0O1xyXG4gICAgXHJcbiAgICB2YXIgbWluVGlsZVggPSBNYXRoLmZsb29yKHJlZ2lvbk1pblggLyAoc2NhbGVYICogdGlsZVdpZHRoICkpO1xyXG4gICAgdmFyIG1pblRpbGVZID0gTWF0aC5mbG9vcihyZWdpb25NaW5ZIC8gKHNjYWxlWSAqIHRpbGVIZWlnaHQpKTtcclxuICAgIHZhciBtYXhUaWxlWCA9IE1hdGguY2VpbCAocmVnaW9uTWF4WCAvIChzY2FsZVggKiB0aWxlV2lkdGggKSk7XHJcbiAgICB2YXIgbWF4VGlsZVkgPSBNYXRoLmNlaWwgKHJlZ2lvbk1heFkgLyAoc2NhbGVZICogdGlsZUhlaWdodCkpO1xyXG4gICAgXHJcbiAgICB2YXIgbWluWCA9IG1pblRpbGVYICogdGlsZVdpZHRoO1xyXG4gICAgdmFyIG1pblkgPSBtaW5UaWxlWSAqIHRpbGVIZWlnaHQ7XHJcbiAgICB2YXIgbWF4WCA9IG1heFRpbGVYICogdGlsZVdpZHRoO1xyXG4gICAgdmFyIG1heFkgPSBtYXhUaWxlWSAqIHRpbGVIZWlnaHQ7XHJcbiAgICBcclxuICAgIHZhciBjcm9wcGVkTWluWCA9IE1hdGgubWF4KDAsIE1hdGgubWluKGxldmVsV2lkdGggLCBtaW5YKSk7XHJcbiAgICB2YXIgY3JvcHBlZE1pblkgPSBNYXRoLm1heCgwLCBNYXRoLm1pbihsZXZlbEhlaWdodCwgbWluWSkpO1xyXG4gICAgdmFyIGNyb3BwZWRNYXhYID0gTWF0aC5tYXgoMCwgTWF0aC5taW4obGV2ZWxXaWR0aCAsIG1heFgpKTtcclxuICAgIHZhciBjcm9wcGVkTWF4WSA9IE1hdGgubWF4KDAsIE1hdGgubWluKGxldmVsSGVpZ2h0LCBtYXhZKSk7XHJcbiAgICBcclxuICAgIHZhciBpbWFnZVBhcmFtc1RvU2NyZWVuU2NhbGVYID0gc2NyZWVuV2lkdGggIC8gKG1heFggLSBtaW5YKTtcclxuICAgIHZhciBpbWFnZVBhcmFtc1RvU2NyZWVuU2NhbGVZID0gc2NyZWVuSGVpZ2h0IC8gKG1heFkgLSBtaW5ZKTtcclxuICAgIFxyXG4gICAgdmFyIGltYWdlUGFydFBhcmFtcyA9IHtcclxuICAgICAgICBtaW5YOiBjcm9wcGVkTWluWCxcclxuICAgICAgICBtaW5ZOiBjcm9wcGVkTWluWSxcclxuICAgICAgICBtYXhYRXhjbHVzaXZlOiBjcm9wcGVkTWF4WCxcclxuICAgICAgICBtYXhZRXhjbHVzaXZlOiBjcm9wcGVkTWF4WSxcclxuICAgICAgICBsZXZlbFdpZHRoOiBsZXZlbFdpZHRoLFxyXG4gICAgICAgIGxldmVsSGVpZ2h0OiBsZXZlbEhlaWdodCxcclxuICAgICAgICBsZXZlbDogbGV2ZWxcclxuICAgIH07XHJcbiAgICBcclxuICAgIHZhciBwb3NpdGlvbkluSW1hZ2UgPSB7XHJcbiAgICAgICAgbWluWDogY3JvcHBlZE1pblggKiBzY2FsZVgsXHJcbiAgICAgICAgbWluWTogY3JvcHBlZE1pblkgKiBzY2FsZVksXHJcbiAgICAgICAgbWF4WEV4Y2x1c2l2ZTogY3JvcHBlZE1heFggKiBzY2FsZVgsXHJcbiAgICAgICAgbWF4WUV4Y2x1c2l2ZTogY3JvcHBlZE1heFkgKiBzY2FsZVlcclxuICAgIH07XHJcbiAgICBcclxuICAgIHZhciBjcm9wcGVkU2NyZWVuID0ge1xyXG4gICAgICAgIG1pblggOiBNYXRoLmZsb29yKChjcm9wcGVkTWluWCAtIG1pblgpICogaW1hZ2VQYXJhbXNUb1NjcmVlblNjYWxlWCksXHJcbiAgICAgICAgbWluWSA6IE1hdGguZmxvb3IoKGNyb3BwZWRNaW5ZIC0gbWluWSkgKiBpbWFnZVBhcmFtc1RvU2NyZWVuU2NhbGVZKSxcclxuICAgICAgICBtYXhYRXhjbHVzaXZlIDogTWF0aC5jZWlsKChjcm9wcGVkTWF4WCAtIG1pblgpICogaW1hZ2VQYXJhbXNUb1NjcmVlblNjYWxlWCksXHJcbiAgICAgICAgbWF4WUV4Y2x1c2l2ZSA6IE1hdGguY2VpbCgoY3JvcHBlZE1heFkgLSBtaW5ZKSAqIGltYWdlUGFyYW1zVG9TY3JlZW5TY2FsZVkpXHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICByZXR1cm4ge1xyXG4gICAgICAgIGltYWdlUGFydFBhcmFtczogaW1hZ2VQYXJ0UGFyYW1zLFxyXG4gICAgICAgIHBvc2l0aW9uSW5JbWFnZTogcG9zaXRpb25JbkltYWdlLFxyXG4gICAgICAgIGNyb3BwZWRTY3JlZW46IGNyb3BwZWRTY3JlZW5cclxuICAgIH07XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGdldENsYXNzSW5HbG9iYWxPYmplY3QoZ2xvYmFsT2JqZWN0LCBjbGFzc05hbWUpIHtcclxuICAgIGlmIChnbG9iYWxPYmplY3RbY2xhc3NOYW1lXSkge1xyXG4gICAgICAgIHJldHVybiBnbG9iYWxPYmplY3RbY2xhc3NOYW1lXTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgdmFyIHJlc3VsdCA9IGdsb2JhbE9iamVjdDtcclxuICAgIHZhciBwYXRoID0gY2xhc3NOYW1lLnNwbGl0KCcuJyk7XHJcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IHBhdGgubGVuZ3RoOyArK2kpIHtcclxuICAgICAgICByZXN1bHQgPSByZXN1bHRbcGF0aFtpXV07XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHJldHVybiByZXN1bHQ7XHJcbn0iLCIndXNlIHN0cmljdCc7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IExpbmtlZExpc3Q7XHJcblxyXG5mdW5jdGlvbiBMaW5rZWRMaXN0KCkge1xyXG4gICAgdGhpcy5fZmlyc3QgPSB7IF9wcmV2OiBudWxsLCBfcGFyZW50OiB0aGlzIH07XHJcbiAgICB0aGlzLl9sYXN0ID0geyBfbmV4dDogbnVsbCwgX3BhcmVudDogdGhpcyB9O1xyXG4gICAgdGhpcy5fY291bnQgPSAwO1xyXG4gICAgXHJcbiAgICB0aGlzLl9sYXN0Ll9wcmV2ID0gdGhpcy5fZmlyc3Q7XHJcbiAgICB0aGlzLl9maXJzdC5fbmV4dCA9IHRoaXMuX2xhc3Q7XHJcbn1cclxuXHJcbkxpbmtlZExpc3QucHJvdG90eXBlLmFkZCA9IGZ1bmN0aW9uIGFkZCh2YWx1ZSwgYWRkQmVmb3JlKSB7XHJcbiAgICBpZiAoYWRkQmVmb3JlID09PSBudWxsIHx8IGFkZEJlZm9yZSA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgYWRkQmVmb3JlID0gdGhpcy5fbGFzdDtcclxuICAgIH1cclxuICAgIFxyXG4gICAgdGhpcy5fdmFsaWRhdGVJdGVyYXRvck9mVGhpcyhhZGRCZWZvcmUpO1xyXG4gICAgXHJcbiAgICArK3RoaXMuX2NvdW50O1xyXG4gICAgXHJcbiAgICB2YXIgbmV3Tm9kZSA9IHtcclxuICAgICAgICBfdmFsdWU6IHZhbHVlLFxyXG4gICAgICAgIF9uZXh0OiBhZGRCZWZvcmUsXHJcbiAgICAgICAgX3ByZXY6IGFkZEJlZm9yZS5fcHJldixcclxuICAgICAgICBfcGFyZW50OiB0aGlzXHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBuZXdOb2RlLl9wcmV2Ll9uZXh0ID0gbmV3Tm9kZTtcclxuICAgIGFkZEJlZm9yZS5fcHJldiA9IG5ld05vZGU7XHJcbiAgICBcclxuICAgIHJldHVybiBuZXdOb2RlO1xyXG59O1xyXG5cclxuTGlua2VkTGlzdC5wcm90b3R5cGUucmVtb3ZlID0gZnVuY3Rpb24gcmVtb3ZlKGl0ZXJhdG9yKSB7XHJcbiAgICB0aGlzLl92YWxpZGF0ZUl0ZXJhdG9yT2ZUaGlzKGl0ZXJhdG9yKTtcclxuICAgIFxyXG4gICAgLS10aGlzLl9jb3VudDtcclxuICAgIFxyXG4gICAgaXRlcmF0b3IuX3ByZXYuX25leHQgPSBpdGVyYXRvci5fbmV4dDtcclxuICAgIGl0ZXJhdG9yLl9uZXh0Ll9wcmV2ID0gaXRlcmF0b3IuX3ByZXY7XHJcbiAgICBpdGVyYXRvci5fcGFyZW50ID0gbnVsbDtcclxufTtcclxuXHJcbkxpbmtlZExpc3QucHJvdG90eXBlLmdldFZhbHVlID0gZnVuY3Rpb24gZ2V0VmFsdWUoaXRlcmF0b3IpIHtcclxuICAgIHRoaXMuX3ZhbGlkYXRlSXRlcmF0b3JPZlRoaXMoaXRlcmF0b3IpO1xyXG4gICAgXHJcbiAgICByZXR1cm4gaXRlcmF0b3IuX3ZhbHVlO1xyXG59O1xyXG5cclxuTGlua2VkTGlzdC5wcm90b3R5cGUuZ2V0Rmlyc3RJdGVyYXRvciA9IGZ1bmN0aW9uIGdldEZpcnN0SXRlcmF0b3IoKSB7XHJcbiAgICB2YXIgaXRlcmF0b3IgPSB0aGlzLmdldE5leHRJdGVyYXRvcih0aGlzLl9maXJzdCk7XHJcbiAgICByZXR1cm4gaXRlcmF0b3I7XHJcbn07XHJcblxyXG5MaW5rZWRMaXN0LnByb3RvdHlwZS5nZXRMYXN0SXRlcmF0b3IgPSBmdW5jdGlvbiBnZXRGaXJzdEl0ZXJhdG9yKCkge1xyXG4gICAgdmFyIGl0ZXJhdG9yID0gdGhpcy5nZXRQcmV2SXRlcmF0b3IodGhpcy5fbGFzdCk7XHJcbiAgICByZXR1cm4gaXRlcmF0b3I7XHJcbn07XHJcblxyXG5MaW5rZWRMaXN0LnByb3RvdHlwZS5nZXROZXh0SXRlcmF0b3IgPSBmdW5jdGlvbiBnZXROZXh0SXRlcmF0b3IoaXRlcmF0b3IpIHtcclxuICAgIHRoaXMuX3ZhbGlkYXRlSXRlcmF0b3JPZlRoaXMoaXRlcmF0b3IpO1xyXG5cclxuICAgIGlmIChpdGVyYXRvci5fbmV4dCA9PT0gdGhpcy5fbGFzdCkge1xyXG4gICAgICAgIHJldHVybiBudWxsO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICByZXR1cm4gaXRlcmF0b3IuX25leHQ7XHJcbn07XHJcblxyXG5MaW5rZWRMaXN0LnByb3RvdHlwZS5nZXRQcmV2SXRlcmF0b3IgPSBmdW5jdGlvbiBnZXRQcmV2SXRlcmF0b3IoaXRlcmF0b3IpIHtcclxuICAgIHRoaXMuX3ZhbGlkYXRlSXRlcmF0b3JPZlRoaXMoaXRlcmF0b3IpO1xyXG5cclxuICAgIGlmIChpdGVyYXRvci5fcHJldiA9PT0gdGhpcy5fZmlyc3QpIHtcclxuICAgICAgICByZXR1cm4gbnVsbDtcclxuICAgIH1cclxuICAgIFxyXG4gICAgcmV0dXJuIGl0ZXJhdG9yLl9wcmV2O1xyXG59O1xyXG5cclxuTGlua2VkTGlzdC5wcm90b3R5cGUuZ2V0Q291bnQgPSBmdW5jdGlvbiBnZXRDb3VudCgpIHtcclxuICAgIHJldHVybiB0aGlzLl9jb3VudDtcclxufTtcclxuXHJcbkxpbmtlZExpc3QucHJvdG90eXBlLl92YWxpZGF0ZUl0ZXJhdG9yT2ZUaGlzID1cclxuICAgIGZ1bmN0aW9uIHZhbGlkYXRlSXRlcmF0b3JPZlRoaXMoaXRlcmF0b3IpIHtcclxuICAgIFxyXG4gICAgaWYgKGl0ZXJhdG9yLl9wYXJlbnQgIT09IHRoaXMpIHtcclxuICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBpdGVyYXRvciBtdXN0IGJlIG9mIHRoZSBjdXJyZW50IExpbmtlZExpc3QnO1xyXG4gICAgfVxyXG59OyIsIid1c2Ugc3RyaWN0JztcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gU2ltcGxlTW92YWJsZUZldGNoO1xyXG5mdW5jdGlvbiBTaW1wbGVNb3ZhYmxlRmV0Y2goKXt9XHJcbnZhciBMaW5rZWRMaXN0ID0gcmVxdWlyZSgnbGlua2VkLWxpc3QuanMnKTtcclxudmFyIEZldGNoQ29udGV4dEFwaSA9IHJlcXVpcmUoJ2ZldGNoLWNvbnRleHQtYXBpLmpzJyk7XHJcblxyXG52YXIgRkVUQ0hfU1RBVEVfV0FJVF9GT1JfTU9WRSA9IDE7XHJcbnZhciBGRVRDSF9TVEFURV9BQ1RJVkUgPSAyO1xyXG52YXIgRkVUQ0hfU1RBVEVfU1RPUFBJTkcgPSAzO1xyXG52YXIgRkVUQ0hfU1RBVEVfU1RPUFBFRCA9IDQ7XHJcbnZhciBGRVRDSF9TVEFURV9URVJNSU5BVEVEID0gNTtcclxuXHJcbmZ1bmN0aW9uIFNpbXBsZU1vdmFibGVGZXRjaChmZXRjaGVyLCBmZXRjaGVyQ2xvc2VyLCBmZXRjaENvbnRleHQsIG1heEFjdGl2ZUZldGNoZXNJbk1vdmFibGVGZXRjaCkge1xyXG5cdHRoaXMuX2ZldGNoZXIgPSBmZXRjaGVyO1xyXG5cdHRoaXMuX2ZldGNoZXJDbG9zZXIgPSBmZXRjaGVyQ2xvc2VyO1xyXG5cdHRoaXMuX21vdmFibGVGZXRjaENvbnRleHQgPSBmZXRjaENvbnRleHQ7XHJcblx0dGhpcy5fbWF4QWN0aXZlRmV0Y2hlc0luTW92YWJsZUZldGNoID0gbWF4QWN0aXZlRmV0Y2hlc0luTW92YWJsZUZldGNoO1xyXG5cdFxyXG5cdHRoaXMuX2FjdGl2ZUZldGNoZXNJbk1vdmFibGVGZXRjaCA9IG5ldyBMaW5rZWRMaXN0KCk7XHJcblx0dGhpcy5fcGVuZGluZ0ltYWdlUGFydFBhcmFtcyA9IG51bGw7XHJcblx0dGhpcy5fbW92YWJsZVN0YXRlID0gRkVUQ0hfU1RBVEVfV0FJVF9GT1JfTU9WRTtcclxuXHRcclxuXHR0aGlzLl9pc1Byb2dyZXNzaXZlID0gZmFsc2U7XHJcblx0dGhpcy5faXNQcm9ncmVzc2l2ZUNoYW5nZWRDYWxsZWQgPSBmYWxzZTtcclxuXHRcclxuXHRmZXRjaENvbnRleHQub24oJ21vdmUnLCB0aGlzLl9vbk1vdmUsIHRoaXMpO1xyXG5cdGZldGNoQ29udGV4dC5vbigndGVybWluYXRlJywgdGhpcy5fb25UZXJtaW5hdGVkLCB0aGlzKTtcclxuXHRmZXRjaENvbnRleHQub24oJ2lzUHJvZ3Jlc3NpdmVDaGFuZ2VkJywgdGhpcy5fb25Jc1Byb2dyZXNzaXZlQ2hhbmdlZCwgdGhpcyk7XHJcblx0ZmV0Y2hDb250ZXh0Lm9uKCdzdG9wJywgdGhpcy5fb25TdG9wLCB0aGlzKTtcclxuXHRmZXRjaENvbnRleHQub24oJ3Jlc3VtZScsIHRoaXMuX29uUmVzdW1lLCB0aGlzKTtcclxufVxyXG5cclxuU2ltcGxlTW92YWJsZUZldGNoLnByb3RvdHlwZS5zdGFydCA9IGZ1bmN0aW9uIHN0YXJ0KGltYWdlUGFydFBhcmFtcykge1xyXG5cdHRoaXMuX29uTW92ZShpbWFnZVBhcnRQYXJhbXMpO1xyXG59O1xyXG5cclxuU2ltcGxlTW92YWJsZUZldGNoLnByb3RvdHlwZS5fb25Jc1Byb2dyZXNzaXZlQ2hhbmdlZCA9IGZ1bmN0aW9uIGlzUHJvZ3Jlc3NpdmVDaGFuZ2VkKGlzUHJvZ3Jlc3NpdmUpIHtcclxuXHR0aGlzLl9pc1Byb2dyZXNzaXZlID0gaXNQcm9ncmVzc2l2ZTtcclxuXHR2YXIgbGFzdEFjdGl2ZUZldGNoID0gdGhpcy5fZ2V0TGFzdEZldGNoKCk7XHJcblx0aWYgKGxhc3RBY3RpdmVGZXRjaCAhPT0gbnVsbCkge1xyXG5cdFx0bGFzdEFjdGl2ZUZldGNoLl9vbkV2ZW50KCdpc1Byb2dyZXNzaXZlQ2hhbmdlZCcsIGlzUHJvZ3Jlc3NpdmUpO1xyXG5cdH0gZWxzZSB7XHJcblx0XHR0aGlzLl9pc1Byb2dyZXNzaXZlQ2hhbmdlZENhbGxlZCA9IHRydWU7XHJcblx0fVxyXG59O1xyXG5cclxuU2ltcGxlTW92YWJsZUZldGNoLnByb3RvdHlwZS5fb25TdG9wID0gZnVuY3Rpb24gc3RvcChpc0Fib3J0ZWQpIHtcclxuXHR0aGlzLl9zd2l0Y2hTdGF0ZShGRVRDSF9TVEFURV9TVE9QUElORywgRkVUQ0hfU1RBVEVfQUNUSVZFKTtcclxuXHR2YXIgbGFzdEFjdGl2ZUZldGNoID0gdGhpcy5fZ2V0TGFzdEZldGNoKCk7XHJcblx0aWYgKGxhc3RBY3RpdmVGZXRjaCAhPT0gbnVsbCkge1xyXG5cdFx0bGFzdEFjdGl2ZUZldGNoLl9vbkV2ZW50KCdzdG9wJywgaXNBYm9ydGVkKTtcclxuXHR9XHJcbn07XHJcblxyXG5TaW1wbGVNb3ZhYmxlRmV0Y2gucHJvdG90eXBlLl9vblJlc3VtZSA9IGZ1bmN0aW9uIHJlc3VtZSgpIHtcclxuXHR0aGlzLl9zd2l0Y2hTdGF0ZShGRVRDSF9TVEFURV9BQ1RJVkUsIEZFVENIX1NUQVRFX1NUT1BQRUQsIEZFVENIX1NUQVRFX1NUT1BQSU5HKTtcclxuXHJcblx0dmFyIGxhc3RGZXRjaEl0ZXJhdG9yID0gdGhpcy5fYWN0aXZlRmV0Y2hlc0luTW92YWJsZUZldGNoLmdldExhc3RJdGVyYXRvcigpO1xyXG5cdGlmIChsYXN0RmV0Y2hJdGVyYXRvciAhPT0gbnVsbCkge1xyXG5cdFx0dGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogcmVzdW1pbmcgbm9uIHN0b3BwZWQgZmV0Y2gnO1xyXG5cdH1cclxuXHRcclxuXHR2YXIgbGFzdEZldGNoID0gdGhpcy5fYWN0aXZlRmV0Y2hlc0luTW92YWJsZUZldGNoLmdldFZhbHVlKGxhc3RGZXRjaEl0ZXJhdG9yKTtcclxuXHRpZiAodGhpcy5faXNQcm9ncmVzc2l2ZUNoYW5nZWRDYWxsZWQpIHtcclxuXHRcdHRoaXMuX2lzUHJvZ3Jlc3NpdmVDaGFuZ2VkQ2FsbGVkID0gZmFsc2U7XHJcblx0XHRsYXN0RmV0Y2guX29uRXZlbnQoJ2lzUHJvZ3Jlc3NpdmVDaGFuZ2VkJywgdGhpcy5faXNQcm9ncmVzc2l2ZSk7XHJcblx0fVxyXG5cdGxhc3RGZXRjaC5fb25FdmVudCgncmVzdW1lJyk7XHJcbn07XHJcblxyXG5TaW1wbGVNb3ZhYmxlRmV0Y2gucHJvdG90eXBlLl9vblRlcm1pbmF0ZWQgPSBmdW5jdGlvbiBvblRlcm1pbmF0ZWQoaXNBYm9ydGVkKSB7XHJcblx0dGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogVW5leHBlY3RlZCB0ZXJtaW5hdGlvbiBvZiBtb3ZhYmxlIGZldGNoJztcclxufTtcclxuXHJcblNpbXBsZU1vdmFibGVGZXRjaC5wcm90b3R5cGUuX29uTW92ZSA9IGZ1bmN0aW9uIG1vdmUoaW1hZ2VQYXJ0UGFyYW1zKSB7XHJcblx0dGhpcy5fcGVuZGluZ0ltYWdlUGFydFBhcmFtcyA9IGltYWdlUGFydFBhcmFtcztcclxuXHR0aGlzLl9tb3ZhYmxlU3RhdGUgPSBGRVRDSF9TVEFURV9BQ1RJVkU7XHJcblx0dGhpcy5fdHJ5U3RhcnRQZW5kaW5nRmV0Y2goKTtcclxufTtcclxuXHJcblNpbXBsZU1vdmFibGVGZXRjaC5wcm90b3R5cGUuX3RyeVN0YXJ0UGVuZGluZ0ZldGNoID0gZnVuY3Rpb24gdHJ5U3RhcnRQZW5kaW5nRmV0Y2goKSB7XHJcblx0aWYgKHRoaXMuX2ZldGNoZXJDbG9zZXIuaXNDbG9zZVJlcXVlc3RlZCgpIHx8XHJcblx0XHR0aGlzLl9hY3RpdmVGZXRjaGVzSW5Nb3ZhYmxlRmV0Y2guZ2V0Q291bnQoKSA+PSB0aGlzLl9tYXhBY3RpdmVGZXRjaGVzSW5Nb3ZhYmxlRmV0Y2ggfHxcclxuXHRcdHRoaXMuX3BlbmRpbmdJbWFnZVBhcnRQYXJhbXMgPT09IG51bGwgfHxcclxuXHRcdHRoaXMuX21vdmFibGVTdGF0ZSAhPT0gRkVUQ0hfU1RBVEVfQUNUSVZFKSB7XHJcblxyXG5cdFx0XHRyZXR1cm47XHJcblx0fVxyXG5cdFxyXG5cdHZhciBuZXdGZXRjaCA9IHtcclxuXHRcdGltYWdlUGFydFBhcmFtczogdGhpcy5fcGVuZGluZ0ltYWdlUGFydFBhcmFtcyxcclxuXHRcdHN0YXRlOiBGRVRDSF9TVEFURV9BQ1RJVkUsXHJcblxyXG5cdFx0ZmV0Y2hDb250ZXh0OiBudWxsLFxyXG5cdFx0cGFyZW50SXRlcmF0b3I6IG51bGwsXHJcblx0XHRzZWxmOiB0aGlzXHJcblx0fTtcclxuXHRcclxuXHR0aGlzLl9wZW5kaW5nSW1hZ2VQYXJ0UGFyYW1zID0gbnVsbDtcclxuXHRuZXdGZXRjaC5wYXJlbnRJdGVyYXRvciA9IHRoaXMuX2FjdGl2ZUZldGNoZXNJbk1vdmFibGVGZXRjaC5hZGQobmV3RmV0Y2gpO1xyXG5cdFxyXG4gICAgdGhpcy5fZmV0Y2hlckNsb3Nlci5jaGFuZ2VBY3RpdmVGZXRjaGVzQ291bnQoKzEpO1xyXG5cdFxyXG5cdG5ld0ZldGNoLmZldGNoQ29udGV4dCA9IG5ldyBGZXRjaENvbnRleHRBcGkoKTtcclxuXHRuZXdGZXRjaC5mZXRjaENvbnRleHQub24oJ2ludGVybmFsU3RvcHBlZCcsIG9uU2luZ2xlRmV0Y2hTdG9wcGVkLCBuZXdGZXRjaCk7XHJcblx0bmV3RmV0Y2guZmV0Y2hDb250ZXh0Lm9uKCdpbnRlcm5hbERvbmUnLCBvblNpbmdsZUZldGNoRG9uZSwgbmV3RmV0Y2gpO1xyXG4gICAgXHJcbiAgICB0aGlzLl9mZXRjaGVyLnN0YXJ0RmV0Y2gobmV3RmV0Y2guZmV0Y2hDb250ZXh0LCBuZXdGZXRjaC5pbWFnZVBhcnRQYXJhbXMpO1xyXG59O1xyXG5cclxuU2ltcGxlTW92YWJsZUZldGNoLnByb3RvdHlwZS5fc2luZ2xlRmV0Y2hTdG9wcGVkID0gZnVuY3Rpb24gc2luZ2xlRmV0Y2hTdG9wcGVkKGZldGNoLCBpc0RvbmUpIHtcclxuXHR0aGlzLl9mZXRjaGVyQ2xvc2VyLmNoYW5nZUFjdGl2ZUZldGNoZXNDb3VudCgtMSk7XHJcblx0dGhpcy5fYWN0aXZlRmV0Y2hlc0luTW92YWJsZUZldGNoLnJlbW92ZShmZXRjaC5wYXJlbnRJdGVyYXRvcik7XHJcblx0ZmV0Y2guc3RhdGUgPSBGRVRDSF9TVEFURV9URVJNSU5BVEVEO1xyXG5cdGZldGNoLnBhcmVudEl0ZXJhdG9yID0gbnVsbDtcclxufTtcclxuXHJcblNpbXBsZU1vdmFibGVGZXRjaC5wcm90b3R5cGUuX2dldExhc3RGZXRjaCA9IGZ1bmN0aW9uIGdldExhc3RGZXRjaCgpIHtcclxuXHRpZiAodGhpcy5fbW92YWJsZVN0YXRlID09PSBGRVRDSF9TVEFURV9TVE9QUEVEKSB7XHJcblx0XHRyZXR1cm4gbnVsbDtcclxuXHR9XHJcblx0XHJcblx0dmFyIGxhc3RGZXRjaEl0ZXJhdG9yID0gdGhpcy5fYWN0aXZlRmV0Y2hlc0luTW92YWJsZUZldGNoLmdldExhc3RJdGVyYXRvcigpO1xyXG5cdGlmIChsYXN0RmV0Y2hJdGVyYXRvciA9PT0gbnVsbCkge1xyXG5cdFx0cmV0dXJuIG51bGw7XHJcblx0fVxyXG5cdFxyXG5cdHZhciBsYXN0RmV0Y2ggPSB0aGlzLl9hY3RpdmVGZXRjaGVzSW5Nb3ZhYmxlRmV0Y2guZ2V0VmFsdWUobGFzdEZldGNoSXRlcmF0b3IpO1xyXG5cdGlmIChsYXN0RmV0Y2guc3RhdGUgPT09IEZFVENIX1NUQVRFX0FDVElWRSkge1xyXG5cdFx0cmV0dXJuIGxhc3RGZXRjaC5mZXRjaENvbnRleHQ7XHJcblx0fVxyXG5cdHJldHVybiBudWxsO1xyXG59O1xyXG5cclxuU2ltcGxlTW92YWJsZUZldGNoLnByb3RvdHlwZS5fc3dpdGNoU3RhdGUgPSBmdW5jdGlvbiBzd2l0Y2hTdGF0ZSh0YXJnZXRTdGF0ZSwgZXhwZWN0ZWRTdGF0ZSwgZXhwZWN0ZWRTdGF0ZTIsIGV4cGVjdGVkU3RhdGUzKSB7XHJcblx0aWYgKHRoaXMuX21vdmFibGVTdGF0ZSAhPT0gZXhwZWN0ZWRTdGF0ZSAmJiB0aGlzLl9tb3ZhYmxlU3RhdGUgIT09IGV4cGVjdGVkU3RhdGUyICYmIHRoaXMuX21vdmFibGVTdGF0ZSAhPT0gZXhwZWN0ZWRTdGF0ZTMpIHtcclxuXHRcdHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IFVuZXhwZWN0ZWQgc3RhdGUgJyArIHRoaXMuX21vdmFibGVTdGF0ZSArICcsIGV4cGVjdGVkICcgKyBleHBlY3RlZFN0YXRlICsgJyBvciAnICsgZXhwZWN0ZWRTdGF0ZTIgKyAnIG9yICcgKyBleHBlY3RlZFN0YXRlMztcclxuXHR9XHJcblx0dGhpcy5fbW92YWJsZVN0YXRlID0gdGFyZ2V0U3RhdGU7XHJcbn07XHJcblxyXG5TaW1wbGVNb3ZhYmxlRmV0Y2gucHJvdG90eXBlLl9pc0xhc3RGZXRjaCA9IGZ1bmN0aW9uIGlzTGFzdEZldGNoKGZldGNoKSB7XHJcblx0cmV0dXJuXHR0aGlzLl9hY3RpdmVGZXRjaGVzSW5Nb3ZhYmxlRmV0Y2guZ2V0TmV4dEl0ZXJhdG9yKGZldGNoLnBhcmVudEl0ZXJhdG9yKSA9PT0gbnVsbCAmJlxyXG5cdFx0XHR0aGlzLl9wZW5kaW5nSW1hZ2VQYXJ0UGFyYW1zID09PSBudWxsO1xyXG59O1xyXG5cclxuZnVuY3Rpb24gb25TaW5nbGVGZXRjaFN0b3BwZWQoKSB7XHJcblx0LyoganNoaW50IHZhbGlkdGhpczogdHJ1ZSAqL1xyXG5cdHZhciBmZXRjaCA9IHRoaXM7XHJcblx0dmFyIG1vdmFibGVGZXRjaCA9IGZldGNoLnNlbGY7XHJcblx0XHJcblx0aWYgKGZldGNoLnN0YXRlICE9PSBGRVRDSF9TVEFURV9TVE9QUElORykge1xyXG5cdFx0dGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogVW5leHBlY3RlZCBzdGF0ZSBvZiBmZXRjaCAnICsgZmV0Y2guc3RhdGUgKyAnIG9uIHN0b3BwZWQnO1xyXG5cdH1cclxuXHRcclxuXHRpZiAobW92YWJsZUZldGNoLl9pc0xhc3RGZXRjaChmZXRjaCkpIHtcclxuXHRcdGZldGNoLnN0YXRlID0gRkVUQ0hfU1RBVEVfU1RPUFBFRDtcclxuXHRcdG1vdmFibGVGZXRjaC5fc3dpdGNoU3RhdGUoRkVUQ0hfU1RBVEVfU1RPUFBFRCwgRkVUQ0hfU1RBVEVfU1RPUFBJTkcpO1xyXG5cdFx0bW92YWJsZUZldGNoLl9tb3ZhYmxlRmV0Y2hDb250ZXh0LnN0b3BwZWQoKTtcclxuXHR9IGVsc2Uge1xyXG5cdFx0bW92YWJsZUZldGNoLl9zaW5nbGVGZXRjaFN0b3BwZWQoZmV0Y2gpO1xyXG5cdH1cclxuXHJcblx0bW92YWJsZUZldGNoLl90cnlTdGFydFBlbmRpbmdGZXRjaCgpO1xyXG59XHJcblxyXG5mdW5jdGlvbiBvblNpbmdsZUZldGNoRG9uZSgpIHtcclxuXHQvKiBqc2hpbnQgdmFsaWR0aGlzOiB0cnVlICovXHJcblx0dmFyIGZldGNoID0gdGhpcztcclxuXHR2YXIgbW92YWJsZUZldGNoID0gZmV0Y2guc2VsZjtcclxuXHJcblx0aWYgKGZldGNoLnN0YXRlICE9PSBGRVRDSF9TVEFURV9BQ1RJVkUgJiYgZmV0Y2guc3RhdGUgIT09IEZFVENIX1NUQVRFX1NUT1BQSU5HKSB7XHJcblx0XHR0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBVbmV4cGVjdGVkIHN0YXRlIG9mIGZldGNoICcgKyBmZXRjaC5zdGF0ZSArICcgb24gZG9uZSc7XHJcblx0fVxyXG5cclxuXHRmZXRjaC5zdGF0ZSA9IEZFVENIX1NUQVRFX1RFUk1JTkFURUQ7XHJcblx0aWYgKG1vdmFibGVGZXRjaC5faXNMYXN0RmV0Y2goZmV0Y2gpKSB7XHJcblx0XHRtb3ZhYmxlRmV0Y2guX3N3aXRjaFN0YXRlKEZFVENIX1NUQVRFX1dBSVRfRk9SX01PVkUsIEZFVENIX1NUQVRFX0FDVElWRSwgRkVUQ0hfU1RBVEVfU1RPUFBJTkcpO1xyXG5cdFx0bW92YWJsZUZldGNoLl9tb3ZhYmxlRmV0Y2hDb250ZXh0LmRvbmUoKTtcclxuXHR9XHJcblx0bW92YWJsZUZldGNoLl9zaW5nbGVGZXRjaFN0b3BwZWQoZmV0Y2gpO1xyXG59IiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBJbWFnZVBhcmFtc1JldHJpZXZlclByb3h5O1xyXG5cclxuZnVuY3Rpb24gSW1hZ2VQYXJhbXNSZXRyaWV2ZXJQcm94eSgpIHtcclxuICAgIHRoaXMuX3NpemVzUGFyYW1zID0gbnVsbDtcclxufVxyXG5cclxuSW1hZ2VQYXJhbXNSZXRyaWV2ZXJQcm94eS5wcm90b3R5cGUuZ2V0SW1hZ2VMZXZlbCA9IGZ1bmN0aW9uIGdldEltYWdlTGV2ZWwoKSB7XHJcbiAgICB2YXIgc2l6ZXNQYXJhbXMgPSB0aGlzLmdldEltYWdlUGFyYW1zKCk7XHJcblxyXG4gICAgcmV0dXJuIHNpemVzUGFyYW1zLmltYWdlTGV2ZWw7XHJcbn07XHJcblxyXG5JbWFnZVBhcmFtc1JldHJpZXZlclByb3h5LnByb3RvdHlwZS5nZXRJbWFnZVdpZHRoID0gZnVuY3Rpb24gZ2V0SW1hZ2VXaWR0aCgpIHtcclxuICAgIHZhciBzaXplc1BhcmFtcyA9IHRoaXMuZ2V0SW1hZ2VQYXJhbXMoKTtcclxuXHJcbiAgICByZXR1cm4gc2l6ZXNQYXJhbXMuaW1hZ2VXaWR0aDtcclxufTtcclxuXHJcbkltYWdlUGFyYW1zUmV0cmlldmVyUHJveHkucHJvdG90eXBlLmdldEltYWdlSGVpZ2h0ID0gZnVuY3Rpb24gZ2V0SW1hZ2VIZWlnaHQoKSB7XHJcbiAgICB2YXIgc2l6ZXNQYXJhbXMgPSB0aGlzLmdldEltYWdlUGFyYW1zKCk7XHJcblxyXG4gICAgcmV0dXJuIHNpemVzUGFyYW1zLmltYWdlSGVpZ2h0O1xyXG59O1xyXG5cclxuSW1hZ2VQYXJhbXNSZXRyaWV2ZXJQcm94eS5wcm90b3R5cGUuZ2V0TnVtUmVzb2x1dGlvbkxldmVsc0ZvckxpbWl0dGVkVmlld2VyID0gZnVuY3Rpb24gZ2V0TnVtUmVzb2x1dGlvbkxldmVsc0ZvckxpbWl0dGVkVmlld2VyKCkge1xyXG4gICAgdmFyIHNpemVzUGFyYW1zID0gdGhpcy5nZXRJbWFnZVBhcmFtcygpO1xyXG5cclxuICAgIHJldHVybiBzaXplc1BhcmFtcy5udW1SZXNvbHV0aW9uTGV2ZWxzRm9yTGltaXR0ZWRWaWV3ZXI7XHJcbn07XHJcblxyXG5JbWFnZVBhcmFtc1JldHJpZXZlclByb3h5LnByb3RvdHlwZS5nZXRMb3dlc3RRdWFsaXR5ID0gZnVuY3Rpb24gZ2V0TG93ZXN0UXVhbGl0eSgpIHtcclxuICAgIHZhciBzaXplc1BhcmFtcyA9IHRoaXMuZ2V0SW1hZ2VQYXJhbXMoKTtcclxuXHJcbiAgICByZXR1cm4gc2l6ZXNQYXJhbXMubG93ZXN0UXVhbGl0eTtcclxufTtcclxuXHJcbkltYWdlUGFyYW1zUmV0cmlldmVyUHJveHkucHJvdG90eXBlLmdldEhpZ2hlc3RRdWFsaXR5ID0gZnVuY3Rpb24gZ2V0SGlnaGVzdFF1YWxpdHkoKSB7XHJcbiAgICB2YXIgc2l6ZXNQYXJhbXMgPSB0aGlzLmdldEltYWdlUGFyYW1zKCk7XHJcblxyXG4gICAgcmV0dXJuIHNpemVzUGFyYW1zLmhpZ2hlc3RRdWFsaXR5O1xyXG59O1xyXG5cclxuSW1hZ2VQYXJhbXNSZXRyaWV2ZXJQcm94eS5wcm90b3R5cGUuZ2V0SW1hZ2VQYXJhbXMgPSBmdW5jdGlvbiBnZXRJbWFnZVBhcmFtcygpIHtcclxuICAgIGlmICghdGhpcy5fc2l6ZXNQYXJhbXMpIHtcclxuICAgICAgICB0aGlzLl9zaXplc1BhcmFtcyA9IHRoaXMuX2dldEltYWdlUGFyYW1zSW50ZXJuYWwoKTtcclxuICAgICAgICBpZiAoIXRoaXMuX3NpemVzUGFyYW1zKSB7XHJcbiAgICAgICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IGdldEltYWdlUGFyYW1zSW50ZXJuYWwoKSByZXR1cm5lZCBmYWxzeSB2YWx1ZTsgTWF5YmUgaW1hZ2Ugbm90IHJlYWR5IHlldD8nO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBpZiAodGhpcy5fc2l6ZXNQYXJhbXMuaW1hZ2VMZXZlbCA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IGdldEltYWdlUGFyYW1zSW50ZXJuYWwoKSByZXN1bHQgaGFzIG5vIGltYWdlTGV2ZWwgcHJvcGVydHknO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBpZiAodGhpcy5fc2l6ZXNQYXJhbXMuaW1hZ2VXaWR0aCA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IGdldEltYWdlUGFyYW1zSW50ZXJuYWwoKSByZXN1bHQgaGFzIG5vIGltYWdlV2lkdGggcHJvcGVydHknO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBpZiAodGhpcy5fc2l6ZXNQYXJhbXMuaW1hZ2VIZWlnaHQgPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBnZXRJbWFnZVBhcmFtc0ludGVybmFsKCkgcmVzdWx0IGhhcyBubyBpbWFnZUhlaWdodCBwcm9wZXJ0eSc7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIGlmICh0aGlzLl9zaXplc1BhcmFtcy5udW1SZXNvbHV0aW9uTGV2ZWxzRm9yTGltaXR0ZWRWaWV3ZXIgPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBnZXRJbWFnZVBhcmFtc0ludGVybmFsKCkgcmVzdWx0IGhhcyBubyBudW1SZXNvbHV0aW9uTGV2ZWxzRm9yTGltaXR0ZWRWaWV3ZXIgcHJvcGVydHknO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBpZiAodGhpcy5fc2l6ZXNQYXJhbXMubG93ZXN0UXVhbGl0eSA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IGdldEltYWdlUGFyYW1zSW50ZXJuYWwoKSByZXN1bHQgaGFzIG5vIGxvd2VzdFF1YWxpdHkgcHJvcGVydHknO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBpZiAodGhpcy5fc2l6ZXNQYXJhbXMuaGlnaGVzdFF1YWxpdHkgPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBnZXRJbWFnZVBhcmFtc0ludGVybmFsKCkgcmVzdWx0IGhhcyBubyBoaWdoZXN0UXVhbGl0eSBwcm9wZXJ0eSc7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgXHJcbiAgICByZXR1cm4gdGhpcy5fc2l6ZXNQYXJhbXM7XHJcbn07XHJcblxyXG5JbWFnZVBhcmFtc1JldHJpZXZlclByb3h5LnByb3RvdHlwZS5fZ2V0SW1hZ2VQYXJhbXNJbnRlcm5hbCA9IGZ1bmN0aW9uIGdldEltYWdlUGFyYW1zSW50ZXJuYWwoKSB7XHJcbiAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBJbWFnZVBhcmFtc1JldHJpZXZlclByb3h5IGluaGVyaXRvciBkaWQgbm90IGltcGxlbWVudCBfZ2V0SW1hZ2VQYXJhbXNJbnRlcm5hbCgpJztcclxufTsiLCIndXNlIHN0cmljdCc7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IEltYWdlVmlld2VyO1xyXG5cclxudmFyIGltYWdlSGVscGVyRnVuY3Rpb25zID0gcmVxdWlyZSgnaW1hZ2UtaGVscGVyLWZ1bmN0aW9ucy5qcycpO1xyXG5cclxudmFyIFBFTkRJTkdfQ0FMTF9UWVBFX1BJWEVMU19VUERBVEVEID0gMTtcclxudmFyIFBFTkRJTkdfQ0FMTF9UWVBFX1JFUE9TSVRJT04gPSAyO1xyXG5cclxudmFyIFJFR0lPTl9PVkVSVklFVyA9IDA7XHJcbnZhciBSRUdJT05fRFlOQU1JQyA9IDE7XHJcblxyXG5mdW5jdGlvbiBJbWFnZVZpZXdlcihpbWFnZSwgY2FudmFzVXBkYXRlZENhbGxiYWNrLCBvcHRpb25zKSB7XHJcbiAgICB0aGlzLl9jYW52YXNVcGRhdGVkQ2FsbGJhY2sgPSBjYW52YXNVcGRhdGVkQ2FsbGJhY2s7XHJcbiAgICBcclxuICAgIHRoaXMuX2FkYXB0UHJvcG9ydGlvbnMgPSBvcHRpb25zLmFkYXB0UHJvcG9ydGlvbnM7XHJcbiAgICB0aGlzLl9jYXJ0b2dyYXBoaWNCb3VuZHMgPSBvcHRpb25zLmNhcnRvZ3JhcGhpY0JvdW5kcztcclxuICAgIHRoaXMuX2FsbG93TXVsdGlwbGVNb3ZhYmxlRmV0Y2hlc0luU2Vzc2lvbiA9XHJcbiAgICAgICAgb3B0aW9ucy5hbGxvd011bHRpcGxlTW92YWJsZUZldGNoZXNJblNlc3Npb247XHJcbiAgICB0aGlzLl9taW5GdW5jdGlvbkNhbGxJbnRlcnZhbE1pbGxpc2Vjb25kcyA9XHJcbiAgICAgICAgb3B0aW9ucy5taW5GdW5jdGlvbkNhbGxJbnRlcnZhbE1pbGxpc2Vjb25kcztcclxuICAgIHRoaXMuX292ZXJ2aWV3UmVzb2x1dGlvblggPSBvcHRpb25zLm92ZXJ2aWV3UmVzb2x1dGlvblggfHwgMTAwO1xyXG4gICAgdGhpcy5fb3ZlcnZpZXdSZXNvbHV0aW9uWSA9IG9wdGlvbnMub3ZlcnZpZXdSZXNvbHV0aW9uWSB8fCAxMDA7XHJcbiAgICAgICAgXHJcbiAgICB0aGlzLl9sYXN0UmVxdWVzdEluZGV4ID0gMDtcclxuICAgIHRoaXMuX3BlbmRpbmdVcGRhdGVWaWV3QXJlYSA9IG51bGw7XHJcbiAgICB0aGlzLl9yZWdpb25zID0gW107XHJcbiAgICB0aGlzLl90YXJnZXRDYW52YXMgPSBudWxsO1xyXG4gICAgXHJcbiAgICB0aGlzLl9jYWxsUGVuZGluZ0NhbGxiYWNrc0JvdW5kID0gdGhpcy5fY2FsbFBlbmRpbmdDYWxsYmFja3MuYmluZCh0aGlzKTtcclxuICAgIHRoaXMuX2NyZWF0ZWRNb3ZhYmxlRmV0Y2hCb3VuZCA9IHRoaXMuX2NyZWF0ZWRNb3ZhYmxlRmV0Y2guYmluZCh0aGlzKTtcclxuICAgIFxyXG4gICAgdGhpcy5fcGVuZGluZ0NhbGxiYWNrc0ludGVydmFsSGFuZGxlID0gMDtcclxuICAgIHRoaXMuX3BlbmRpbmdDYWxsYmFja0NhbGxzID0gW107XHJcbiAgICB0aGlzLl9jYW5TaG93RHluYW1pY1JlZ2lvbiA9IGZhbHNlO1xyXG4gICAgXHJcbiAgICBpZiAodGhpcy5fY2FydG9ncmFwaGljQm91bmRzID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICB0aGlzLl9jYXJ0b2dyYXBoaWNCb3VuZHMgPSB7XHJcbiAgICAgICAgICAgIHdlc3Q6IC0xNzUuMCxcclxuICAgICAgICAgICAgZWFzdDogMTc1LjAsXHJcbiAgICAgICAgICAgIHNvdXRoOiAtODUuMCxcclxuICAgICAgICAgICAgbm9ydGg6IDg1LjBcclxuICAgICAgICB9O1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBpZiAodGhpcy5fYWRhcHRQcm9wb3J0aW9ucyA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgdGhpcy5fYWRhcHRQcm9wb3J0aW9ucyA9IHRydWU7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHRoaXMuX2ltYWdlID0gaW1hZ2U7XHJcbn1cclxuXHJcbkltYWdlVmlld2VyLnByb3RvdHlwZS5zZXRFeGNlcHRpb25DYWxsYmFjayA9IGZ1bmN0aW9uIHNldEV4Y2VwdGlvbkNhbGxiYWNrKGV4Y2VwdGlvbkNhbGxiYWNrKSB7XHJcbiAgICAvLyBUT0RPOiBTdXBwb3J0IGV4Y2VwdGlvbkNhbGxiYWNrIGluIGV2ZXJ5IHBsYWNlIG5lZWRlZFxyXG5cdHRoaXMuX2V4Y2VwdGlvbkNhbGxiYWNrID0gZXhjZXB0aW9uQ2FsbGJhY2s7XHJcbn07XHJcbiAgICBcclxuSW1hZ2VWaWV3ZXIucHJvdG90eXBlLm9wZW4gPSBmdW5jdGlvbiBvcGVuKHVybCkge1xyXG4gICAgcmV0dXJuIHRoaXMuX2ltYWdlLm9wZW4odXJsKVxyXG4gICAgICAgIC50aGVuKHRoaXMuX29wZW5lZC5iaW5kKHRoaXMpKVxyXG4gICAgICAgIC5jYXRjaCh0aGlzLl9leGNlcHRpb25DYWxsYmFjayk7XHJcbn07XHJcblxyXG5JbWFnZVZpZXdlci5wcm90b3R5cGUuY2xvc2UgPSBmdW5jdGlvbiBjbG9zZSgpIHtcclxuICAgIHZhciBwcm9taXNlID0gdGhpcy5faW1hZ2UuY2xvc2UoKTtcclxuICAgIHByb21pc2UuY2F0Y2godGhpcy5fZXhjZXB0aW9uQ2FsbGJhY2spO1xyXG4gICAgdGhpcy5faXNSZWFkeSA9IGZhbHNlO1xyXG4gICAgdGhpcy5fY2FuU2hvd0R5bmFtaWNSZWdpb24gPSBmYWxzZTtcclxuICAgIHRoaXMuX3RhcmdldENhbnZhcyA9IG51bGw7XHJcblx0cmV0dXJuIHByb21pc2U7XHJcbn07XHJcblxyXG5JbWFnZVZpZXdlci5wcm90b3R5cGUuc2V0VGFyZ2V0Q2FudmFzID0gZnVuY3Rpb24gc2V0VGFyZ2V0Q2FudmFzKGNhbnZhcykge1xyXG4gICAgdGhpcy5fdGFyZ2V0Q2FudmFzID0gY2FudmFzO1xyXG59O1xyXG5cclxuSW1hZ2VWaWV3ZXIucHJvdG90eXBlLnVwZGF0ZVZpZXdBcmVhID0gZnVuY3Rpb24gdXBkYXRlVmlld0FyZWEoZnJ1c3R1bURhdGEpIHtcclxuICAgIGlmICh0aGlzLl90YXJnZXRDYW52YXMgPT09IG51bGwpIHtcclxuICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBDYW5ub3QgdXBkYXRlIGR5bmFtaWMgcmVnaW9uIGJlZm9yZSBzZXRUYXJnZXRDYW52YXMoKSc7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGlmICghdGhpcy5fY2FuU2hvd0R5bmFtaWNSZWdpb24pIHtcclxuICAgICAgICB0aGlzLl9wZW5kaW5nVXBkYXRlVmlld0FyZWEgPSBmcnVzdHVtRGF0YTtcclxuICAgICAgICBcclxuICAgICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHZhciBib3VuZHMgPSBmcnVzdHVtRGF0YS5yZWN0YW5nbGU7XHJcbiAgICB2YXIgc2NyZWVuU2l6ZSA9IGZydXN0dW1EYXRhLnNjcmVlblNpemU7XHJcbiAgICBcclxuICAgIHZhciByZWdpb25QYXJhbXMgPSB7XHJcbiAgICAgICAgbWluWDogYm91bmRzLndlc3QgKiB0aGlzLl9zY2FsZVggKyB0aGlzLl90cmFuc2xhdGVYLFxyXG4gICAgICAgIG1pblk6IGJvdW5kcy5ub3J0aCAqIHRoaXMuX3NjYWxlWSArIHRoaXMuX3RyYW5zbGF0ZVksXHJcbiAgICAgICAgbWF4WEV4Y2x1c2l2ZTogYm91bmRzLmVhc3QgKiB0aGlzLl9zY2FsZVggKyB0aGlzLl90cmFuc2xhdGVYLFxyXG4gICAgICAgIG1heFlFeGNsdXNpdmU6IGJvdW5kcy5zb3V0aCAqIHRoaXMuX3NjYWxlWSArIHRoaXMuX3RyYW5zbGF0ZVksXHJcbiAgICAgICAgc2NyZWVuV2lkdGg6IHNjcmVlblNpemUueCxcclxuICAgICAgICBzY3JlZW5IZWlnaHQ6IHNjcmVlblNpemUueVxyXG4gICAgfTtcclxuICAgIFxyXG4gICAgdmFyIGFsaWduZWRQYXJhbXMgPVxyXG4gICAgICAgIGltYWdlSGVscGVyRnVuY3Rpb25zLmFsaWduUGFyYW1zVG9UaWxlc0FuZExldmVsKFxyXG4gICAgICAgICAgICByZWdpb25QYXJhbXMsIHRoaXMuX2ltYWdlLCB0aGlzLl9pbWFnZSk7XHJcbiAgICBcclxuICAgIHZhciBpc091dHNpZGVTY3JlZW4gPSBhbGlnbmVkUGFyYW1zID09PSBudWxsO1xyXG4gICAgaWYgKGlzT3V0c2lkZVNjcmVlbikge1xyXG4gICAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIFxyXG4gICAgYWxpZ25lZFBhcmFtcy5pbWFnZVBhcnRQYXJhbXMucXVhbGl0eSA9IHRoaXMuX3F1YWxpdHk7XHJcblxyXG4gICAgdmFyIGlzU2FtZVJlZ2lvbiA9XHJcbiAgICAgICAgdGhpcy5fZHluYW1pY0ZldGNoUGFyYW1zICE9PSB1bmRlZmluZWQgJiZcclxuICAgICAgICB0aGlzLl9pc0ltYWdlUGFydHNFcXVhbChcclxuICAgICAgICAgICAgYWxpZ25lZFBhcmFtcy5pbWFnZVBhcnRQYXJhbXMsXHJcbiAgICAgICAgICAgIHRoaXMuX2R5bmFtaWNGZXRjaFBhcmFtcy5pbWFnZVBhcnRQYXJhbXMpO1xyXG4gICAgXHJcbiAgICBpZiAoaXNTYW1lUmVnaW9uKSB7XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBmcnVzdHVtRGF0YS5pbWFnZVJlY3RhbmdsZSA9IHRoaXMuX2NhcnRvZ3JhcGhpY0JvdW5kc0ZpeGVkO1xyXG4gICAgZnJ1c3R1bURhdGEuZXhhY3RsZXZlbCA9XHJcbiAgICAgICAgYWxpZ25lZFBhcmFtcy5pbWFnZVBhcnRQYXJhbXMubGV2ZWw7XHJcbiAgICBcclxuICAgIHRoaXMuX2ltYWdlLnNldERlY29kZVByaW9yaXRpemVyRGF0YShmcnVzdHVtRGF0YSk7XHJcbiAgICB0aGlzLl9pbWFnZS5zZXRTZXJ2ZXJSZXF1ZXN0UHJpb3JpdGl6ZXJEYXRhKGZydXN0dW1EYXRhKTtcclxuXHJcbiAgICB0aGlzLl9keW5hbWljRmV0Y2hQYXJhbXMgPSBhbGlnbmVkUGFyYW1zO1xyXG4gICAgXHJcbiAgICB2YXIgc3RhcnREeW5hbWljUmVnaW9uT25UZXJtaW5hdGlvbiA9IGZhbHNlO1xyXG4gICAgdmFyIG1vdmVFeGlzdGluZ0ZldGNoID0gIXRoaXMuX2FsbG93TXVsdGlwbGVNb3ZhYmxlRmV0Y2hlc0luU2Vzc2lvbjtcclxuICAgIHRoaXMuX2ZldGNoKFxyXG4gICAgICAgIFJFR0lPTl9EWU5BTUlDLFxyXG4gICAgICAgIGFsaWduZWRQYXJhbXMsXHJcbiAgICAgICAgc3RhcnREeW5hbWljUmVnaW9uT25UZXJtaW5hdGlvbixcclxuICAgICAgICBtb3ZlRXhpc3RpbmdGZXRjaCk7XHJcbn07XHJcblxyXG5JbWFnZVZpZXdlci5wcm90b3R5cGUuZ2V0Qm91bmRzID0gZnVuY3Rpb24gZ2V0Q2FydG9ncmFwaGljQm91bmRzKCkge1xyXG4gICAgaWYgKCF0aGlzLl9pc1JlYWR5KSB7XHJcbiAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogSW1hZ2VWaWV3ZXIgZXJyb3I6IEltYWdlIGlzIG5vdCByZWFkeSB5ZXQnO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIHRoaXMuX2NhcnRvZ3JhcGhpY0JvdW5kc0ZpeGVkO1xyXG59O1xyXG5cclxuSW1hZ2VWaWV3ZXIucHJvdG90eXBlLl9pc0ltYWdlUGFydHNFcXVhbCA9IGZ1bmN0aW9uIGlzSW1hZ2VQYXJ0c0VxdWFsKGZpcnN0LCBzZWNvbmQpIHtcclxuICAgIHZhciBpc0VxdWFsID1cclxuICAgICAgICB0aGlzLl9keW5hbWljRmV0Y2hQYXJhbXMgIT09IHVuZGVmaW5lZCAmJlxyXG4gICAgICAgIGZpcnN0Lm1pblggPT09IHNlY29uZC5taW5YICYmXHJcbiAgICAgICAgZmlyc3QubWluWSA9PT0gc2Vjb25kLm1pblkgJiZcclxuICAgICAgICBmaXJzdC5tYXhYRXhjbHVzaXZlID09PSBzZWNvbmQubWF4WEV4Y2x1c2l2ZSAmJlxyXG4gICAgICAgIGZpcnN0Lm1heFlFeGNsdXNpdmUgPT09IHNlY29uZC5tYXhZRXhjbHVzaXZlICYmXHJcbiAgICAgICAgZmlyc3QubGV2ZWwgPT09IHNlY29uZC5sZXZlbDtcclxuICAgIFxyXG4gICAgcmV0dXJuIGlzRXF1YWw7XHJcbn07XHJcblxyXG5JbWFnZVZpZXdlci5wcm90b3R5cGUuX2ZldGNoID0gZnVuY3Rpb24gZmV0Y2goXHJcbiAgICByZWdpb25JZCxcclxuICAgIGZldGNoUGFyYW1zLFxyXG4gICAgc3RhcnREeW5hbWljUmVnaW9uT25UZXJtaW5hdGlvbixcclxuICAgIG1vdmVFeGlzdGluZ0ZldGNoKSB7XHJcbiAgICBcclxuICAgIHZhciByZXF1ZXN0SW5kZXggPSArK3RoaXMuX2xhc3RSZXF1ZXN0SW5kZXg7XHJcbiAgICBcclxuICAgIHZhciBpbWFnZVBhcnRQYXJhbXMgPSBmZXRjaFBhcmFtcy5pbWFnZVBhcnRQYXJhbXM7XHJcbiAgICBpbWFnZVBhcnRQYXJhbXMucmVxdWVzdFByaW9yaXR5RGF0YSA9XHJcbiAgICAgICAgaW1hZ2VQYXJ0UGFyYW1zLnJlcXVlc3RQcmlvcml0eURhdGEgfHwge307XHJcbiAgICBcclxuICAgIGltYWdlUGFydFBhcmFtcy5yZXF1ZXN0UHJpb3JpdHlEYXRhLnJlcXVlc3RJbmRleCA9IHJlcXVlc3RJbmRleDtcclxuXHJcbiAgICB2YXIgbWluWCA9IGZldGNoUGFyYW1zLnBvc2l0aW9uSW5JbWFnZS5taW5YO1xyXG4gICAgdmFyIG1pblkgPSBmZXRjaFBhcmFtcy5wb3NpdGlvbkluSW1hZ2UubWluWTtcclxuICAgIHZhciBtYXhYID0gZmV0Y2hQYXJhbXMucG9zaXRpb25JbkltYWdlLm1heFhFeGNsdXNpdmU7XHJcbiAgICB2YXIgbWF4WSA9IGZldGNoUGFyYW1zLnBvc2l0aW9uSW5JbWFnZS5tYXhZRXhjbHVzaXZlO1xyXG4gICAgXHJcbiAgICB2YXIgd2VzdCA9IChtaW5YIC0gdGhpcy5fdHJhbnNsYXRlWCkgLyB0aGlzLl9zY2FsZVg7XHJcbiAgICB2YXIgZWFzdCA9IChtYXhYIC0gdGhpcy5fdHJhbnNsYXRlWCkgLyB0aGlzLl9zY2FsZVg7XHJcbiAgICB2YXIgbm9ydGggPSAobWluWSAtIHRoaXMuX3RyYW5zbGF0ZVkpIC8gdGhpcy5fc2NhbGVZO1xyXG4gICAgdmFyIHNvdXRoID0gKG1heFkgLSB0aGlzLl90cmFuc2xhdGVZKSAvIHRoaXMuX3NjYWxlWTtcclxuICAgIFxyXG4gICAgdmFyIHBvc2l0aW9uID0ge1xyXG4gICAgICAgIHdlc3Q6IHdlc3QsXHJcbiAgICAgICAgZWFzdDogZWFzdCxcclxuICAgICAgICBub3J0aDogbm9ydGgsXHJcbiAgICAgICAgc291dGg6IHNvdXRoXHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICB2YXIgY2FuUmV1c2VPbGREYXRhID0gZmFsc2U7XHJcbiAgICB2YXIgZmV0Y2hQYXJhbXNOb3ROZWVkZWQ7XHJcbiAgICBcclxuICAgIHZhciByZWdpb24gPSB0aGlzLl9yZWdpb25zW3JlZ2lvbklkXTtcclxuICAgIGlmIChyZWdpb24gIT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIHZhciBuZXdSZXNvbHV0aW9uID0gaW1hZ2VQYXJ0UGFyYW1zLmxldmVsO1xyXG4gICAgICAgIHZhciBvbGRSZXNvbHV0aW9uID0gcmVnaW9uLmltYWdlUGFydFBhcmFtcy5sZXZlbDtcclxuICAgICAgICBcclxuICAgICAgICBjYW5SZXVzZU9sZERhdGEgPSBuZXdSZXNvbHV0aW9uID09PSBvbGRSZXNvbHV0aW9uO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGlmIChjYW5SZXVzZU9sZERhdGEgJiYgcmVnaW9uLmRvbmVQYXJ0UGFyYW1zKSB7XHJcbiAgICAgICAgICAgIGZldGNoUGFyYW1zTm90TmVlZGVkID0gWyByZWdpb24uZG9uZVBhcnRQYXJhbXMgXTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGlmIChyZWdpb25JZCAhPT0gUkVHSU9OX09WRVJWSUVXKSB7XHJcbiAgICAgICAgICAgIHZhciBhZGRlZFBlbmRpbmdDYWxsID0gdGhpcy5fY2hlY2tJZlJlcG9zaXRpb25OZWVkZWQoXHJcbiAgICAgICAgICAgICAgICByZWdpb24sIGltYWdlUGFydFBhcmFtcywgcG9zaXRpb24pO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgaWYgKGFkZGVkUGVuZGluZ0NhbGwpIHtcclxuICAgICAgICAgICAgICAgIHRoaXMuX25vdGlmeU5ld1BlbmRpbmdDYWxscygpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgXHJcbiAgICB2YXIgc2VsZiA9IHRoaXM7XHJcbiAgICBcclxuICAgIHZhciBtb3ZhYmxlSGFuZGxlID0gbW92ZUV4aXN0aW5nRmV0Y2ggPyB0aGlzLl9tb3ZhYmxlSGFuZGxlOiB1bmRlZmluZWQ7XHJcblxyXG4gICAgdGhpcy5faW1hZ2UucmVxdWVzdFBpeGVsc1Byb2dyZXNzaXZlKFxyXG4gICAgICAgIGZldGNoUGFyYW1zLmltYWdlUGFydFBhcmFtcyxcclxuICAgICAgICBjYWxsYmFjayxcclxuICAgICAgICB0ZXJtaW5hdGVkQ2FsbGJhY2ssXHJcbiAgICAgICAgZmV0Y2hQYXJhbXNOb3ROZWVkZWQsXHJcbiAgICAgICAgbW92YWJsZUhhbmRsZSk7XHJcbiAgICBcclxuICAgIGZ1bmN0aW9uIGNhbGxiYWNrKGRlY29kZWQpIHtcclxuICAgICAgICBzZWxmLl90aWxlc0RlY29kZWRDYWxsYmFjayhcclxuICAgICAgICAgICAgcmVnaW9uSWQsXHJcbiAgICAgICAgICAgIGZldGNoUGFyYW1zLFxyXG4gICAgICAgICAgICBwb3NpdGlvbixcclxuICAgICAgICAgICAgZGVjb2RlZCk7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGZ1bmN0aW9uIHRlcm1pbmF0ZWRDYWxsYmFjayhpc0Fib3J0ZWQpIHtcclxuICAgICAgICBpZiAoaXNBYm9ydGVkICYmXHJcbiAgICAgICAgICAgIGltYWdlUGFydFBhcmFtcy5yZXF1ZXN0UHJpb3JpdHlEYXRhLm92ZXJyaWRlSGlnaGVzdFByaW9yaXR5KSB7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBOT1RFOiBCdWcgaW4ga2R1X3NlcnZlciBjYXVzZXMgZmlyc3QgcmVxdWVzdCB0byBiZSBzZW50IHdyb25nbHkuXHJcbiAgICAgICAgICAgIC8vIFRoZW4gQ2hyb21lIHJhaXNlcyBFUlJfSU5WQUxJRF9DSFVOS0VEX0VOQ09ESU5HIGFuZCB0aGUgcmVxdWVzdFxyXG4gICAgICAgICAgICAvLyBuZXZlciByZXR1cm5zLiBUaHVzIHBlcmZvcm0gc2Vjb25kIHJlcXVlc3QuXHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBzZWxmLl9pbWFnZS5yZXF1ZXN0UGl4ZWxzUHJvZ3Jlc3NpdmUoXHJcbiAgICAgICAgICAgICAgICBmZXRjaFBhcmFtcy5pbWFnZVBhcnRQYXJhbXMsXHJcbiAgICAgICAgICAgICAgICBjYWxsYmFjayxcclxuICAgICAgICAgICAgICAgIHRlcm1pbmF0ZWRDYWxsYmFjayxcclxuICAgICAgICAgICAgICAgIGZldGNoUGFyYW1zTm90TmVlZGVkKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgc2VsZi5fZmV0Y2hUZXJtaW5hdGVkQ2FsbGJhY2soXHJcbiAgICAgICAgICAgIHJlZ2lvbklkLFxyXG4gICAgICAgICAgICBmZXRjaFBhcmFtcy5pbWFnZVBhcnRQYXJhbXMucmVxdWVzdFByaW9yaXR5RGF0YSxcclxuICAgICAgICAgICAgaXNBYm9ydGVkLFxyXG4gICAgICAgICAgICBzdGFydER5bmFtaWNSZWdpb25PblRlcm1pbmF0aW9uKTtcclxuICAgIH1cclxufTtcclxuXHJcbkltYWdlVmlld2VyLnByb3RvdHlwZS5fZmV0Y2hUZXJtaW5hdGVkQ2FsbGJhY2sgPSBmdW5jdGlvbiBmZXRjaFRlcm1pbmF0ZWRDYWxsYmFjayhcclxuICAgIHJlZ2lvbklkLCBwcmlvcml0eURhdGEsIGlzQWJvcnRlZCwgc3RhcnREeW5hbWljUmVnaW9uT25UZXJtaW5hdGlvbikge1xyXG4gICAgXHJcbiAgICB2YXIgcmVnaW9uID0gdGhpcy5fcmVnaW9uc1tyZWdpb25JZF07XHJcbiAgICBpZiAocmVnaW9uID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGlmICghcHJpb3JpdHlEYXRhLm92ZXJyaWRlSGlnaGVzdFByaW9yaXR5ICYmXHJcbiAgICAgICAgcHJpb3JpdHlEYXRhLnJlcXVlc3RJbmRleCAhPT0gdGhpcy5fbGFzdFJlcXVlc3RJbmRleCkge1xyXG4gICAgXHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICByZWdpb24uaXNEb25lID0gIWlzQWJvcnRlZCAmJiB0aGlzLl9pc1JlYWR5O1xyXG5cdGlmIChyZWdpb24uaXNEb25lKSB7XHJcblx0XHRyZWdpb24uZG9uZVBhcnRQYXJhbXMgPSByZWdpb24uaW1hZ2VQYXJ0UGFyYW1zO1xyXG5cdH1cclxuICAgIFxyXG4gICAgaWYgKHN0YXJ0RHluYW1pY1JlZ2lvbk9uVGVybWluYXRpb24pIHtcclxuICAgICAgICB0aGlzLl9pbWFnZS5jcmVhdGVNb3ZhYmxlRmV0Y2goKS50aGVuKHRoaXMuX2NyZWF0ZWRNb3ZhYmxlRmV0Y2hCb3VuZCk7XHJcbiAgICB9XHJcbn07XHJcblxyXG5JbWFnZVZpZXdlci5wcm90b3R5cGUuX2NyZWF0ZWRNb3ZhYmxlRmV0Y2ggPSBmdW5jdGlvbiBjcmVhdGVkTW92YWJsZUZldGNoKG1vdmFibGVIYW5kbGUpIHtcclxuICAgIHRoaXMuX21vdmFibGVIYW5kbGUgPSBtb3ZhYmxlSGFuZGxlO1xyXG4gICAgdGhpcy5fc3RhcnRTaG93aW5nRHluYW1pY1JlZ2lvbigpO1xyXG59O1xyXG5cclxuSW1hZ2VWaWV3ZXIucHJvdG90eXBlLl9zdGFydFNob3dpbmdEeW5hbWljUmVnaW9uID0gZnVuY3Rpb24gc3RhcnRTaG93aW5nRHluYW1pY1JlZ2lvbigpIHtcclxuICAgIHRoaXMuX2NhblNob3dEeW5hbWljUmVnaW9uID0gdHJ1ZTtcclxuICAgIFxyXG4gICAgaWYgKHRoaXMuX3BlbmRpbmdVcGRhdGVWaWV3QXJlYSAhPT0gbnVsbCkge1xyXG4gICAgICAgIHRoaXMudXBkYXRlVmlld0FyZWEodGhpcy5fcGVuZGluZ1VwZGF0ZVZpZXdBcmVhKTtcclxuICAgICAgICBcclxuICAgICAgICB0aGlzLl9wZW5kaW5nVXBkYXRlVmlld0FyZWEgPSBudWxsO1xyXG4gICAgfVxyXG59O1xyXG5cclxuSW1hZ2VWaWV3ZXIucHJvdG90eXBlLl90aWxlc0RlY29kZWRDYWxsYmFjayA9IGZ1bmN0aW9uIHRpbGVzRGVjb2RlZENhbGxiYWNrKFxyXG4gICAgcmVnaW9uSWQsIGZldGNoUGFyYW1zLCBwb3NpdGlvbiwgZGVjb2RlZCkge1xyXG4gICAgXHJcbiAgICBpZiAoIXRoaXMuX2lzUmVhZHkpIHtcclxuICAgICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHZhciByZWdpb24gPSB0aGlzLl9yZWdpb25zW3JlZ2lvbklkXTtcclxuICAgIGlmIChyZWdpb24gPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIHJlZ2lvbiA9IHt9O1xyXG4gICAgICAgIHRoaXMuX3JlZ2lvbnNbcmVnaW9uSWRdID0gcmVnaW9uO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHN3aXRjaCAocmVnaW9uSWQpIHtcclxuICAgICAgICAgICAgY2FzZSBSRUdJT05fRFlOQU1JQzpcclxuICAgICAgICAgICAgICAgIHJlZ2lvbi5jYW52YXMgPSB0aGlzLl90YXJnZXRDYW52YXM7XHJcbiAgICAgICAgICAgICAgICBicmVhaztcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBjYXNlIFJFR0lPTl9PVkVSVklFVzpcclxuICAgICAgICAgICAgICAgIHJlZ2lvbi5jYW52YXMgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdjYW52YXMnKTtcclxuICAgICAgICAgICAgICAgIGJyZWFrO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgZGVmYXVsdDpcclxuICAgICAgICAgICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IFVuZXhwZWN0ZWQgcmVnaW9uSWQgJyArIHJlZ2lvbklkO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuICAgIFxyXG4gICAgdmFyIHBhcnRQYXJhbXMgPSBmZXRjaFBhcmFtcy5pbWFnZVBhcnRQYXJhbXM7XHJcbiAgICBpZiAoIXBhcnRQYXJhbXMucmVxdWVzdFByaW9yaXR5RGF0YS5vdmVycmlkZUhpZ2hlc3RQcmlvcml0eSAmJlxyXG4gICAgICAgIHBhcnRQYXJhbXMucmVxdWVzdFByaW9yaXR5RGF0YS5yZXF1ZXN0SW5kZXggPCByZWdpb24uY3VycmVudERpc3BsYXlSZXF1ZXN0SW5kZXgpIHtcclxuICAgICAgICBcclxuICAgICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHRoaXMuX2NoZWNrSWZSZXBvc2l0aW9uTmVlZGVkKHJlZ2lvbiwgcGFydFBhcmFtcywgcG9zaXRpb24pO1xyXG4gICAgICAgIFxyXG4gICAgdGhpcy5fcGVuZGluZ0NhbGxiYWNrQ2FsbHMucHVzaCh7XHJcbiAgICAgICAgdHlwZTogUEVORElOR19DQUxMX1RZUEVfUElYRUxTX1VQREFURUQsXHJcbiAgICAgICAgcmVnaW9uOiByZWdpb24sXHJcbiAgICAgICAgZGVjb2RlZDogZGVjb2RlZFxyXG4gICAgfSk7XHJcbiAgICBcclxuICAgIHRoaXMuX25vdGlmeU5ld1BlbmRpbmdDYWxscygpO1xyXG59O1xyXG5cclxuSW1hZ2VWaWV3ZXIucHJvdG90eXBlLl9jaGVja0lmUmVwb3NpdGlvbk5lZWRlZCA9IGZ1bmN0aW9uIGNoZWNrSWZSZXBvc2l0aW9uTmVlZGVkKFxyXG4gICAgcmVnaW9uLCBuZXdQYXJ0UGFyYW1zLCBuZXdQb3NpdGlvbikge1xyXG4gICAgXHJcbiAgICB2YXIgb2xkUGFydFBhcmFtcyA9IHJlZ2lvbi5pbWFnZVBhcnRQYXJhbXM7XHJcblx0dmFyIG9sZERvbmVQYXJ0UGFyYW1zID0gcmVnaW9uLmRvbmVQYXJ0UGFyYW1zO1xyXG4gICAgdmFyIGxldmVsID0gbmV3UGFydFBhcmFtcy5sZXZlbDtcclxuICAgIFxyXG4gICAgdmFyIG5lZWRSZXBvc2l0aW9uID1cclxuICAgICAgICBvbGRQYXJ0UGFyYW1zID09PSB1bmRlZmluZWQgfHxcclxuICAgICAgICBvbGRQYXJ0UGFyYW1zLm1pblggIT09IG5ld1BhcnRQYXJhbXMubWluWCB8fFxyXG4gICAgICAgIG9sZFBhcnRQYXJhbXMubWluWSAhPT0gbmV3UGFydFBhcmFtcy5taW5ZIHx8XHJcbiAgICAgICAgb2xkUGFydFBhcmFtcy5tYXhYRXhjbHVzaXZlICE9PSBuZXdQYXJ0UGFyYW1zLm1heFhFeGNsdXNpdmUgfHxcclxuICAgICAgICBvbGRQYXJ0UGFyYW1zLm1heFlFeGNsdXNpdmUgIT09IG5ld1BhcnRQYXJhbXMubWF4WUV4Y2x1c2l2ZSB8fFxyXG4gICAgICAgIG9sZFBhcnRQYXJhbXMubGV2ZWwgIT09IGxldmVsO1xyXG4gICAgXHJcbiAgICBpZiAoIW5lZWRSZXBvc2l0aW9uKSB7XHJcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICB2YXIgY29weURhdGE7XHJcbiAgICB2YXIgaW50ZXJzZWN0aW9uO1xyXG5cdHZhciBuZXdEb25lUGFydFBhcmFtcztcclxuICAgIHZhciByZXVzZU9sZERhdGEgPSBmYWxzZTtcclxuICAgIHZhciBzY2FsZVg7XHJcbiAgICB2YXIgc2NhbGVZO1xyXG4gICAgaWYgKG9sZFBhcnRQYXJhbXMgIT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIHNjYWxlWCA9IG5ld1BhcnRQYXJhbXMubGV2ZWxXaWR0aCAgLyBvbGRQYXJ0UGFyYW1zLmxldmVsV2lkdGg7XHJcbiAgICAgICAgc2NhbGVZID0gbmV3UGFydFBhcmFtcy5sZXZlbEhlaWdodCAvIG9sZFBhcnRQYXJhbXMubGV2ZWxIZWlnaHQ7XHJcbiAgICAgICAgXHJcbiAgICAgICAgaW50ZXJzZWN0aW9uID0ge1xyXG4gICAgICAgICAgICBtaW5YOiBNYXRoLm1heChvbGRQYXJ0UGFyYW1zLm1pblggKiBzY2FsZVgsIG5ld1BhcnRQYXJhbXMubWluWCksXHJcbiAgICAgICAgICAgIG1pblk6IE1hdGgubWF4KG9sZFBhcnRQYXJhbXMubWluWSAqIHNjYWxlWSwgbmV3UGFydFBhcmFtcy5taW5ZKSxcclxuICAgICAgICAgICAgbWF4WDogTWF0aC5taW4ob2xkUGFydFBhcmFtcy5tYXhYRXhjbHVzaXZlICogc2NhbGVYLCBuZXdQYXJ0UGFyYW1zLm1heFhFeGNsdXNpdmUpLFxyXG4gICAgICAgICAgICBtYXhZOiBNYXRoLm1pbihvbGRQYXJ0UGFyYW1zLm1heFlFeGNsdXNpdmUgKiBzY2FsZVksIG5ld1BhcnRQYXJhbXMubWF4WUV4Y2x1c2l2ZSlcclxuICAgICAgICB9O1xyXG4gICAgICAgIHJldXNlT2xkRGF0YSA9XHJcbiAgICAgICAgICAgIGludGVyc2VjdGlvbi5tYXhYID4gaW50ZXJzZWN0aW9uLm1pblggJiZcclxuICAgICAgICAgICAgaW50ZXJzZWN0aW9uLm1heFkgPiBpbnRlcnNlY3Rpb24ubWluWTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgaWYgKHJldXNlT2xkRGF0YSkge1xyXG4gICAgICAgIGNvcHlEYXRhID0ge1xyXG4gICAgICAgICAgICBmcm9tWDogaW50ZXJzZWN0aW9uLm1pblggLyBzY2FsZVggLSBvbGRQYXJ0UGFyYW1zLm1pblgsXHJcbiAgICAgICAgICAgIGZyb21ZOiBpbnRlcnNlY3Rpb24ubWluWSAvIHNjYWxlWSAtIG9sZFBhcnRQYXJhbXMubWluWSxcclxuICAgICAgICAgICAgZnJvbVdpZHRoIDogKGludGVyc2VjdGlvbi5tYXhYIC0gaW50ZXJzZWN0aW9uLm1pblgpIC8gc2NhbGVYLFxyXG4gICAgICAgICAgICBmcm9tSGVpZ2h0OiAoaW50ZXJzZWN0aW9uLm1heFkgLSBpbnRlcnNlY3Rpb24ubWluWSkgLyBzY2FsZVksXHJcbiAgICAgICAgICAgIHRvWDogaW50ZXJzZWN0aW9uLm1pblggLSBuZXdQYXJ0UGFyYW1zLm1pblgsXHJcbiAgICAgICAgICAgIHRvWTogaW50ZXJzZWN0aW9uLm1pblkgLSBuZXdQYXJ0UGFyYW1zLm1pblksXHJcbiAgICAgICAgICAgIHRvV2lkdGggOiBpbnRlcnNlY3Rpb24ubWF4WCAtIGludGVyc2VjdGlvbi5taW5YLFxyXG4gICAgICAgICAgICB0b0hlaWdodDogaW50ZXJzZWN0aW9uLm1heFkgLSBpbnRlcnNlY3Rpb24ubWluWSxcclxuICAgICAgICB9O1xyXG5cdFxyXG5cdFx0aWYgKG9sZERvbmVQYXJ0UGFyYW1zICYmIG9sZFBhcnRQYXJhbXMubGV2ZWwgPT09IGxldmVsKSB7XHJcblx0XHRcdG5ld0RvbmVQYXJ0UGFyYW1zID0ge1xyXG5cdFx0XHRcdG1pblg6IE1hdGgubWF4KG9sZERvbmVQYXJ0UGFyYW1zLm1pblgsIG5ld1BhcnRQYXJhbXMubWluWCksXHJcblx0XHRcdFx0bWluWTogTWF0aC5tYXgob2xkRG9uZVBhcnRQYXJhbXMubWluWSwgbmV3UGFydFBhcmFtcy5taW5ZKSxcclxuXHRcdFx0XHRtYXhYRXhjbHVzaXZlOiBNYXRoLm1pbihvbGREb25lUGFydFBhcmFtcy5tYXhYRXhjbHVzaXZlLCBuZXdQYXJ0UGFyYW1zLm1heFhFeGNsdXNpdmUpLFxyXG5cdFx0XHRcdG1heFlFeGNsdXNpdmU6IE1hdGgubWluKG9sZERvbmVQYXJ0UGFyYW1zLm1heFlFeGNsdXNpdmUsIG5ld1BhcnRQYXJhbXMubWF4WUV4Y2x1c2l2ZSlcclxuXHRcdFx0fTtcclxuXHRcdH1cclxuXHR9XHJcbiAgICBcclxuICAgIHJlZ2lvbi5pbWFnZVBhcnRQYXJhbXMgPSBuZXdQYXJ0UGFyYW1zO1xyXG4gICAgcmVnaW9uLmlzRG9uZSA9IGZhbHNlO1xyXG4gICAgcmVnaW9uLmN1cnJlbnREaXNwbGF5UmVxdWVzdEluZGV4ID0gbmV3UGFydFBhcmFtcy5yZXF1ZXN0UHJpb3JpdHlEYXRhLnJlcXVlc3RJbmRleDtcclxuICAgIFxyXG4gICAgdmFyIHJlcG9zaXRpb25BcmdzID0ge1xyXG4gICAgICAgIHR5cGU6IFBFTkRJTkdfQ0FMTF9UWVBFX1JFUE9TSVRJT04sXHJcbiAgICAgICAgcmVnaW9uOiByZWdpb24sXHJcbiAgICAgICAgcG9zaXRpb246IG5ld1Bvc2l0aW9uLFxyXG5cdFx0ZG9uZVBhcnRQYXJhbXM6IG5ld0RvbmVQYXJ0UGFyYW1zLFxyXG4gICAgICAgIGNvcHlEYXRhOiBjb3B5RGF0YSxcclxuICAgICAgICBwaXhlbHNXaWR0aDogbmV3UGFydFBhcmFtcy5tYXhYRXhjbHVzaXZlIC0gbmV3UGFydFBhcmFtcy5taW5YLFxyXG4gICAgICAgIHBpeGVsc0hlaWdodDogbmV3UGFydFBhcmFtcy5tYXhZRXhjbHVzaXZlIC0gbmV3UGFydFBhcmFtcy5taW5ZXHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICB0aGlzLl9wZW5kaW5nQ2FsbGJhY2tDYWxscy5wdXNoKHJlcG9zaXRpb25BcmdzKTtcclxuICAgIFxyXG4gICAgcmV0dXJuIHRydWU7XHJcbn07XHJcblxyXG5JbWFnZVZpZXdlci5wcm90b3R5cGUuX25vdGlmeU5ld1BlbmRpbmdDYWxscyA9IGZ1bmN0aW9uIG5vdGlmeU5ld1BlbmRpbmdDYWxscygpIHtcclxuICAgIGlmICghdGhpcy5faXNOZWFyQ2FsbGJhY2tDYWxsZWQpIHtcclxuICAgICAgICB0aGlzLl9jYWxsUGVuZGluZ0NhbGxiYWNrcygpO1xyXG4gICAgfVxyXG59O1xyXG5cclxuSW1hZ2VWaWV3ZXIucHJvdG90eXBlLl9jYWxsUGVuZGluZ0NhbGxiYWNrcyA9IGZ1bmN0aW9uIGNhbGxQZW5kaW5nQ2FsbGJhY2tzKCkge1xyXG4gICAgaWYgKHRoaXMuX3BlbmRpbmdDYWxsYmFja0NhbGxzLmxlbmd0aCA9PT0gMCB8fCAhdGhpcy5faXNSZWFkeSkge1xyXG4gICAgICAgIHRoaXMuX2lzTmVhckNhbGxiYWNrQ2FsbGVkID0gZmFsc2U7XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBpZiAodGhpcy5faXNOZWFyQ2FsbGJhY2tDYWxsZWQpIHtcclxuICAgICAgICBjbGVhclRpbWVvdXQodGhpcy5fcGVuZGluZ0NhbGxiYWNrc0ludGVydmFsSGFuZGxlKTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgaWYgKHRoaXMuX21pbkZ1bmN0aW9uQ2FsbEludGVydmFsTWlsbGlzZWNvbmRzICE9PSB1bmRlZmluZWQpIHtcclxuICAgICAgICB0aGlzLl9wZW5kaW5nQ2FsbGJhY2tzSW50ZXJ2YWxIYW5kbGUgPVxyXG4gICAgICAgICAgICBzZXRUaW1lb3V0KHRoaXMuX2NhbGxQZW5kaW5nQ2FsbGJhY2tzQm91bmQsXHJcbiAgICAgICAgICAgIHRoaXMuX21pbkZ1bmN0aW9uQ2FsbEludGVydmFsTWlsbGlzZWNvbmRzKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgdGhpcy5faXNOZWFyQ2FsbGJhY2tDYWxsZWQgPSB0cnVlO1xyXG4gICAgfVxyXG5cclxuICAgIHZhciBuZXdQb3NpdGlvbiA9IG51bGw7XHJcbiAgICBcclxuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgdGhpcy5fcGVuZGluZ0NhbGxiYWNrQ2FsbHMubGVuZ3RoOyArK2kpIHtcclxuICAgICAgICB2YXIgY2FsbEFyZ3MgPSB0aGlzLl9wZW5kaW5nQ2FsbGJhY2tDYWxsc1tpXTtcclxuICAgICAgICBcclxuICAgICAgICBpZiAoY2FsbEFyZ3MudHlwZSA9PT0gUEVORElOR19DQUxMX1RZUEVfUkVQT1NJVElPTikge1xyXG4gICAgICAgICAgICB0aGlzLl9yZXBvc2l0aW9uQ2FudmFzKGNhbGxBcmdzKTtcclxuICAgICAgICAgICAgbmV3UG9zaXRpb24gPSBjYWxsQXJncy5wb3NpdGlvbjtcclxuICAgICAgICB9IGVsc2UgaWYgKGNhbGxBcmdzLnR5cGUgPT09IFBFTkRJTkdfQ0FMTF9UWVBFX1BJWEVMU19VUERBVEVEKSB7XHJcbiAgICAgICAgICAgIHRoaXMuX3BpeGVsc1VwZGF0ZWQoY2FsbEFyZ3MpO1xyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IEludGVybmFsIEltYWdlVmlld2VyIEVycm9yOiBVbmV4cGVjdGVkIGNhbGwgdHlwZSAnICtcclxuICAgICAgICAgICAgICAgIGNhbGxBcmdzLnR5cGU7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgXHJcbiAgICB0aGlzLl9wZW5kaW5nQ2FsbGJhY2tDYWxscy5sZW5ndGggPSAwO1xyXG4gICAgXHJcbiAgICB0aGlzLl9jYW52YXNVcGRhdGVkQ2FsbGJhY2sobmV3UG9zaXRpb24pO1xyXG59O1xyXG5cclxuSW1hZ2VWaWV3ZXIucHJvdG90eXBlLl9waXhlbHNVcGRhdGVkID0gZnVuY3Rpb24gcGl4ZWxzVXBkYXRlZChwaXhlbHNVcGRhdGVkQXJncykge1xyXG4gICAgdmFyIHJlZ2lvbiA9IHBpeGVsc1VwZGF0ZWRBcmdzLnJlZ2lvbjtcclxuICAgIHZhciBkZWNvZGVkID0gcGl4ZWxzVXBkYXRlZEFyZ3MuZGVjb2RlZDtcclxuICAgIGlmIChkZWNvZGVkLmltYWdlRGF0YS53aWR0aCA9PT0gMCB8fCBkZWNvZGVkLmltYWdlRGF0YS5oZWlnaHQgPT09IDApIHtcclxuICAgICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHZhciB4ID0gZGVjb2RlZC54SW5PcmlnaW5hbFJlcXVlc3Q7XHJcbiAgICB2YXIgeSA9IGRlY29kZWQueUluT3JpZ2luYWxSZXF1ZXN0O1xyXG4gICAgXHJcbiAgICB2YXIgY29udGV4dCA9IHJlZ2lvbi5jYW52YXMuZ2V0Q29udGV4dCgnMmQnKTtcclxuICAgIC8vdmFyIGltYWdlRGF0YSA9IGNvbnRleHQuY3JlYXRlSW1hZ2VEYXRhKGRlY29kZWQud2lkdGgsIGRlY29kZWQuaGVpZ2h0KTtcclxuICAgIC8vaW1hZ2VEYXRhLmRhdGEuc2V0KGRlY29kZWQucGl4ZWxzKTtcclxuICAgIFxyXG4gICAgY29udGV4dC5wdXRJbWFnZURhdGEoZGVjb2RlZC5pbWFnZURhdGEsIHgsIHkpO1xyXG59O1xyXG5cclxuSW1hZ2VWaWV3ZXIucHJvdG90eXBlLl9yZXBvc2l0aW9uQ2FudmFzID0gZnVuY3Rpb24gcmVwb3NpdGlvbkNhbnZhcyhyZXBvc2l0aW9uQXJncykge1xyXG4gICAgdmFyIHJlZ2lvbiA9IHJlcG9zaXRpb25BcmdzLnJlZ2lvbjtcclxuICAgIHZhciBwb3NpdGlvbiA9IHJlcG9zaXRpb25BcmdzLnBvc2l0aW9uO1xyXG5cdHZhciBkb25lUGFydFBhcmFtcyA9IHJlcG9zaXRpb25BcmdzLmRvbmVQYXJ0UGFyYW1zO1xyXG4gICAgdmFyIGNvcHlEYXRhID0gcmVwb3NpdGlvbkFyZ3MuY29weURhdGE7XHJcbiAgICB2YXIgcGl4ZWxzV2lkdGggPSByZXBvc2l0aW9uQXJncy5waXhlbHNXaWR0aDtcclxuICAgIHZhciBwaXhlbHNIZWlnaHQgPSByZXBvc2l0aW9uQXJncy5waXhlbHNIZWlnaHQ7XHJcbiAgICBcclxuICAgIHZhciBpbWFnZURhdGFUb0NvcHk7XHJcbiAgICB2YXIgY29udGV4dCA9IHJlZ2lvbi5jYW52YXMuZ2V0Q29udGV4dCgnMmQnKTtcclxuICAgIFxyXG4gICAgaWYgKGNvcHlEYXRhICE9PSB1bmRlZmluZWQpIHtcclxuICAgICAgICBpZiAoY29weURhdGEuZnJvbVdpZHRoID09PSBjb3B5RGF0YS50b1dpZHRoICYmIGNvcHlEYXRhLmZyb21IZWlnaHQgPT09IGNvcHlEYXRhLnRvSGVpZ2h0KSB7XHJcbiAgICAgICAgICAgIGltYWdlRGF0YVRvQ29weSA9IGNvbnRleHQuZ2V0SW1hZ2VEYXRhKFxyXG4gICAgICAgICAgICAgICAgY29weURhdGEuZnJvbVgsIGNvcHlEYXRhLmZyb21ZLCBjb3B5RGF0YS5mcm9tV2lkdGgsIGNvcHlEYXRhLmZyb21IZWlnaHQpO1xyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgIGlmICghdGhpcy5fdG1wQ2FudmFzKSB7XHJcbiAgICAgICAgICAgICAgICB0aGlzLl90bXBDYW52YXMgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdjYW52YXMnKTtcclxuICAgICAgICAgICAgICAgIHRoaXMuX3RtcENhbnZhc0NvbnRleHQgPSB0aGlzLl90bXBDYW52YXMuZ2V0Q29udGV4dCgnMmQnKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgdGhpcy5fdG1wQ2FudmFzLndpZHRoICA9IGNvcHlEYXRhLnRvV2lkdGg7XHJcbiAgICAgICAgICAgIHRoaXMuX3RtcENhbnZhcy5oZWlnaHQgPSBjb3B5RGF0YS50b0hlaWdodDtcclxuICAgICAgICAgICAgdGhpcy5fdG1wQ2FudmFzQ29udGV4dC5kcmF3SW1hZ2UoXHJcbiAgICAgICAgICAgICAgICByZWdpb24uY2FudmFzLFxyXG4gICAgICAgICAgICAgICAgY29weURhdGEuZnJvbVgsIGNvcHlEYXRhLmZyb21ZLCBjb3B5RGF0YS5mcm9tV2lkdGgsIGNvcHlEYXRhLmZyb21IZWlnaHQsXHJcbiAgICAgICAgICAgICAgICAwLCAwLCBjb3B5RGF0YS50b1dpZHRoLCBjb3B5RGF0YS50b0hlaWdodCk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBpbWFnZURhdGFUb0NvcHkgPSB0aGlzLl90bXBDYW52YXNDb250ZXh0LmdldEltYWdlRGF0YShcclxuICAgICAgICAgICAgICAgIDAsIDAsIGNvcHlEYXRhLnRvV2lkdGgsIGNvcHlEYXRhLnRvSGVpZ2h0KTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHJlZ2lvbi5jYW52YXMud2lkdGggPSBwaXhlbHNXaWR0aDtcclxuICAgIHJlZ2lvbi5jYW52YXMuaGVpZ2h0ID0gcGl4ZWxzSGVpZ2h0O1xyXG4gICAgXHJcbiAgICBpZiAocmVnaW9uICE9PSB0aGlzLl9yZWdpb25zW1JFR0lPTl9PVkVSVklFV10pIHtcclxuICAgICAgICB0aGlzLl9jb3B5T3ZlcnZpZXdUb0NhbnZhcyhcclxuICAgICAgICAgICAgY29udGV4dCwgcG9zaXRpb24sIHBpeGVsc1dpZHRoLCBwaXhlbHNIZWlnaHQpO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBpZiAoY29weURhdGEgIT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIGNvbnRleHQucHV0SW1hZ2VEYXRhKGltYWdlRGF0YVRvQ29weSwgY29weURhdGEudG9YLCBjb3B5RGF0YS50b1kpO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICByZWdpb24ucG9zaXRpb24gPSBwb3NpdGlvbjtcclxuXHRyZWdpb24uZG9uZVBhcnRQYXJhbXMgPSBkb25lUGFydFBhcmFtcztcclxufTtcclxuXHJcbkltYWdlVmlld2VyLnByb3RvdHlwZS5fY29weU92ZXJ2aWV3VG9DYW52YXMgPSBmdW5jdGlvbiBjb3B5T3ZlcnZpZXdUb0NhbnZhcyhcclxuICAgIGNvbnRleHQsIGNhbnZhc1Bvc2l0aW9uLCBjYW52YXNQaXhlbHNXaWR0aCwgY2FudmFzUGl4ZWxzSGVpZ2h0KSB7XHJcbiAgICBcclxuICAgIHZhciBzb3VyY2VQb3NpdGlvbiA9IHRoaXMuX3JlZ2lvbnNbUkVHSU9OX09WRVJWSUVXXS5wb3NpdGlvbjtcclxuICAgIHZhciBzb3VyY2VQaXhlbHMgPVxyXG4gICAgICAgIHRoaXMuX3JlZ2lvbnNbUkVHSU9OX09WRVJWSUVXXS5pbWFnZVBhcnRQYXJhbXM7XHJcbiAgICBcclxuICAgIHZhciBzb3VyY2VQaXhlbHNXaWR0aCA9XHJcbiAgICAgICAgc291cmNlUGl4ZWxzLm1heFhFeGNsdXNpdmUgLSBzb3VyY2VQaXhlbHMubWluWDtcclxuICAgIHZhciBzb3VyY2VQaXhlbHNIZWlnaHQgPVxyXG4gICAgICAgIHNvdXJjZVBpeGVscy5tYXhZRXhjbHVzaXZlIC0gc291cmNlUGl4ZWxzLm1pblk7XHJcbiAgICBcclxuICAgIHZhciBzb3VyY2VQb3NpdGlvbldpZHRoID1cclxuICAgICAgICBzb3VyY2VQb3NpdGlvbi5lYXN0IC0gc291cmNlUG9zaXRpb24ud2VzdDtcclxuICAgIHZhciBzb3VyY2VQb3NpdGlvbkhlaWdodCA9XHJcbiAgICAgICAgc291cmNlUG9zaXRpb24ubm9ydGggLSBzb3VyY2VQb3NpdGlvbi5zb3V0aDtcclxuICAgICAgICBcclxuICAgIHZhciBzb3VyY2VSZXNvbHV0aW9uWCA9XHJcbiAgICAgICAgc291cmNlUGl4ZWxzV2lkdGggLyBzb3VyY2VQb3NpdGlvbldpZHRoO1xyXG4gICAgdmFyIHNvdXJjZVJlc29sdXRpb25ZID1cclxuICAgICAgICBzb3VyY2VQaXhlbHNIZWlnaHQgLyBzb3VyY2VQb3NpdGlvbkhlaWdodDtcclxuICAgIFxyXG4gICAgdmFyIHRhcmdldFBvc2l0aW9uV2lkdGggPVxyXG4gICAgICAgIGNhbnZhc1Bvc2l0aW9uLmVhc3QgLSBjYW52YXNQb3NpdGlvbi53ZXN0O1xyXG4gICAgdmFyIHRhcmdldFBvc2l0aW9uSGVpZ2h0ID1cclxuICAgICAgICBjYW52YXNQb3NpdGlvbi5ub3J0aCAtIGNhbnZhc1Bvc2l0aW9uLnNvdXRoO1xyXG4gICAgICAgIFxyXG4gICAgdmFyIGNyb3BXaWR0aCA9IHRhcmdldFBvc2l0aW9uV2lkdGggKiBzb3VyY2VSZXNvbHV0aW9uWDtcclxuICAgIHZhciBjcm9wSGVpZ2h0ID0gdGFyZ2V0UG9zaXRpb25IZWlnaHQgKiBzb3VyY2VSZXNvbHV0aW9uWTtcclxuICAgIFxyXG4gICAgdmFyIGNyb3BPZmZzZXRQb3NpdGlvblggPVxyXG4gICAgICAgIGNhbnZhc1Bvc2l0aW9uLndlc3QgLSBzb3VyY2VQb3NpdGlvbi53ZXN0O1xyXG4gICAgdmFyIGNyb3BPZmZzZXRQb3NpdGlvblkgPVxyXG4gICAgICAgIHNvdXJjZVBvc2l0aW9uLm5vcnRoIC0gY2FudmFzUG9zaXRpb24ubm9ydGg7XHJcbiAgICAgICAgXHJcbiAgICB2YXIgY3JvcFBpeGVsT2Zmc2V0WCA9IGNyb3BPZmZzZXRQb3NpdGlvblggKiBzb3VyY2VSZXNvbHV0aW9uWDtcclxuICAgIHZhciBjcm9wUGl4ZWxPZmZzZXRZID0gY3JvcE9mZnNldFBvc2l0aW9uWSAqIHNvdXJjZVJlc29sdXRpb25ZO1xyXG4gICAgXHJcbiAgICBjb250ZXh0LmRyYXdJbWFnZShcclxuICAgICAgICB0aGlzLl9yZWdpb25zW1JFR0lPTl9PVkVSVklFV10uY2FudmFzLFxyXG4gICAgICAgIGNyb3BQaXhlbE9mZnNldFgsIGNyb3BQaXhlbE9mZnNldFksIGNyb3BXaWR0aCwgY3JvcEhlaWdodCxcclxuICAgICAgICAwLCAwLCBjYW52YXNQaXhlbHNXaWR0aCwgY2FudmFzUGl4ZWxzSGVpZ2h0KTtcclxufTtcclxuXHJcbkltYWdlVmlld2VyLnByb3RvdHlwZS5fb3BlbmVkID0gZnVuY3Rpb24gb3BlbmVkKCkge1xyXG4gICAgdGhpcy5faXNSZWFkeSA9IHRydWU7XHJcbiAgICBcclxuICAgIHZhciBmaXhlZEJvdW5kcyA9IHtcclxuICAgICAgICB3ZXN0OiB0aGlzLl9jYXJ0b2dyYXBoaWNCb3VuZHMud2VzdCxcclxuICAgICAgICBlYXN0OiB0aGlzLl9jYXJ0b2dyYXBoaWNCb3VuZHMuZWFzdCxcclxuICAgICAgICBzb3V0aDogdGhpcy5fY2FydG9ncmFwaGljQm91bmRzLnNvdXRoLFxyXG4gICAgICAgIG5vcnRoOiB0aGlzLl9jYXJ0b2dyYXBoaWNCb3VuZHMubm9ydGhcclxuICAgIH07XHJcbiAgICBpbWFnZUhlbHBlckZ1bmN0aW9ucy5maXhCb3VuZHMoXHJcbiAgICAgICAgZml4ZWRCb3VuZHMsIHRoaXMuX2ltYWdlLCB0aGlzLl9hZGFwdFByb3BvcnRpb25zKTtcclxuICAgIHRoaXMuX2NhcnRvZ3JhcGhpY0JvdW5kc0ZpeGVkID0gZml4ZWRCb3VuZHM7XHJcbiAgICBcclxuICAgIHZhciBpbWFnZVdpZHRoICA9IHRoaXMuX2ltYWdlLmdldEltYWdlV2lkdGggKCk7XHJcbiAgICB2YXIgaW1hZ2VIZWlnaHQgPSB0aGlzLl9pbWFnZS5nZXRJbWFnZUhlaWdodCgpO1xyXG4gICAgdGhpcy5fcXVhbGl0eSA9IHRoaXMuX2ltYWdlLmdldEhpZ2hlc3RRdWFsaXR5KCk7XHJcblxyXG4gICAgdmFyIHJlY3RhbmdsZVdpZHRoID0gZml4ZWRCb3VuZHMuZWFzdCAtIGZpeGVkQm91bmRzLndlc3Q7XHJcbiAgICB2YXIgcmVjdGFuZ2xlSGVpZ2h0ID0gZml4ZWRCb3VuZHMubm9ydGggLSBmaXhlZEJvdW5kcy5zb3V0aDtcclxuICAgIHRoaXMuX3NjYWxlWCA9IGltYWdlV2lkdGggLyByZWN0YW5nbGVXaWR0aDtcclxuICAgIHRoaXMuX3NjYWxlWSA9IC1pbWFnZUhlaWdodCAvIHJlY3RhbmdsZUhlaWdodDtcclxuICAgIFxyXG4gICAgdGhpcy5fdHJhbnNsYXRlWCA9IC1maXhlZEJvdW5kcy53ZXN0ICogdGhpcy5fc2NhbGVYO1xyXG4gICAgdGhpcy5fdHJhbnNsYXRlWSA9IC1maXhlZEJvdW5kcy5ub3J0aCAqIHRoaXMuX3NjYWxlWTtcclxuICAgIFxyXG4gICAgdmFyIG92ZXJ2aWV3UGFyYW1zID0ge1xyXG4gICAgICAgIG1pblg6IDAsXHJcbiAgICAgICAgbWluWTogMCxcclxuICAgICAgICBtYXhYRXhjbHVzaXZlOiBpbWFnZVdpZHRoLFxyXG4gICAgICAgIG1heFlFeGNsdXNpdmU6IGltYWdlSGVpZ2h0LFxyXG4gICAgICAgIHNjcmVlbldpZHRoOiB0aGlzLl9vdmVydmlld1Jlc29sdXRpb25YLFxyXG4gICAgICAgIHNjcmVlbkhlaWdodDogdGhpcy5fb3ZlcnZpZXdSZXNvbHV0aW9uWVxyXG4gICAgfTtcclxuICAgIFxyXG4gICAgdmFyIG92ZXJ2aWV3QWxpZ25lZFBhcmFtcyA9XHJcbiAgICAgICAgaW1hZ2VIZWxwZXJGdW5jdGlvbnMuYWxpZ25QYXJhbXNUb1RpbGVzQW5kTGV2ZWwoXHJcbiAgICAgICAgICAgIG92ZXJ2aWV3UGFyYW1zLCB0aGlzLl9pbWFnZSwgdGhpcy5faW1hZ2UpO1xyXG4gICAgICAgICAgICBcclxuICAgIG92ZXJ2aWV3QWxpZ25lZFBhcmFtcy5pbWFnZVBhcnRQYXJhbXMucmVxdWVzdFByaW9yaXR5RGF0YSA9XHJcbiAgICAgICAgb3ZlcnZpZXdBbGlnbmVkUGFyYW1zLmltYWdlUGFydFBhcmFtcy5yZXF1ZXN0UHJpb3JpdHlEYXRhIHx8IHt9O1xyXG4gICAgXHJcbiAgICBvdmVydmlld0FsaWduZWRQYXJhbXMuaW1hZ2VQYXJ0UGFyYW1zLnJlcXVlc3RQcmlvcml0eURhdGEub3ZlcnJpZGVIaWdoZXN0UHJpb3JpdHkgPSB0cnVlO1xyXG4gICAgb3ZlcnZpZXdBbGlnbmVkUGFyYW1zLmltYWdlUGFydFBhcmFtcy5xdWFsaXR5ID0gdGhpcy5faW1hZ2UuZ2V0TG93ZXN0UXVhbGl0eSgpO1xyXG4gICAgXHJcbiAgICB2YXIgc3RhcnREeW5hbWljUmVnaW9uT25UZXJtaW5hdGlvbiA9XHJcbiAgICAgICAgIXRoaXMuX2FsbG93TXVsdGlwbGVNb3ZhYmxlRmV0Y2hlc0luU2Vzc2lvbjtcclxuICAgICAgICBcclxuICAgIHRoaXMuX2ZldGNoKFxyXG4gICAgICAgIFJFR0lPTl9PVkVSVklFVyxcclxuICAgICAgICBvdmVydmlld0FsaWduZWRQYXJhbXMsXHJcbiAgICAgICAgc3RhcnREeW5hbWljUmVnaW9uT25UZXJtaW5hdGlvbik7XHJcbiAgICBcclxuICAgIGlmICh0aGlzLl9hbGxvd011bHRpcGxlTW92YWJsZUZldGNoZXNJblNlc3Npb24pIHtcclxuICAgICAgICB0aGlzLl9zdGFydFNob3dpbmdEeW5hbWljUmVnaW9uKCk7XHJcbiAgICB9XHJcbn07IiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxudmFyIEltYWdlVmlld2VyID0gcmVxdWlyZSgnaW1hZ2Utdmlld2VyLmpzJyk7XHJcbnZhciBjYWxjdWxhdGVMZWFmbGV0RnJ1c3R1bSA9IHJlcXVpcmUoJ2xlYWZsZXQtZnJ1c3R1bS1jYWxjdWxhdG9yLmpzJyk7XHJcblxyXG4vKiBnbG9iYWwgTDogZmFsc2UgKi9cclxuLyogZ2xvYmFsIHNlbGY6IGZhbHNlICovXHJcblxyXG5pZiAoc2VsZi5MKSB7XHJcbiAgICBtb2R1bGUuZXhwb3J0cyA9IEwuQ2xhc3MuZXh0ZW5kKGNyZWF0ZUltYWdlRGVjb2RlclJlZ2lvbkxheWVyRnVuY3Rpb25zKCkpO1xyXG59IGVsc2Uge1xyXG4gICAgbW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbigpIHtcclxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogQ2Fubm90IGluc3RhbnRpYXRlIEltYWdlRGVjb2RlclJlZ2lvbkxheWVyOiBObyBMZWFmbGV0IG5hbWVzcGFjZSBpbiBzY29wZScpO1xyXG4gICAgfTtcclxufVxyXG5cclxuZnVuY3Rpb24gY3JlYXRlSW1hZ2VEZWNvZGVyUmVnaW9uTGF5ZXJGdW5jdGlvbnMoKSB7XHJcbiAgICByZXR1cm4ge1xyXG4gICAgICAgIGluaXRpYWxpemU6IGZ1bmN0aW9uIGluaXRpYWxpemUob3B0aW9ucykge1xyXG4gICAgICAgICAgICB0aGlzLl9vcHRpb25zID0gb3B0aW9ucyB8fCB7fTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGlmICh0aGlzLl9vcHRpb25zLmxhdExuZ0JvdW5kcyAhPT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgICAgICAgICB0aGlzLl9vcHRpb25zID0ge307XHJcbiAgICAgICAgICAgICAgICBmb3IgKHZhciBtZW1iZXIgaW4gb3B0aW9ucykge1xyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX29wdGlvbnNbbWVtYmVyXSA9IG9wdGlvbnNbbWVtYmVyXTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIHRoaXMuX29wdGlvbnMuY2FydG9ncmFwaGljQm91bmRzID0ge1xyXG4gICAgICAgICAgICAgICAgICAgIHdlc3Q6IG9wdGlvbnMubGF0TG5nQm91bmRzLmdldFdlc3QoKSxcclxuICAgICAgICAgICAgICAgICAgICBlYXN0OiBvcHRpb25zLmxhdExuZ0JvdW5kcy5nZXRFYXN0KCksXHJcbiAgICAgICAgICAgICAgICAgICAgc291dGg6IG9wdGlvbnMubGF0TG5nQm91bmRzLmdldFNvdXRoKCksXHJcbiAgICAgICAgICAgICAgICAgICAgbm9ydGg6IG9wdGlvbnMubGF0TG5nQm91bmRzLmdldE5vcnRoKClcclxuICAgICAgICAgICAgICAgIH07XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHRoaXMuX3RhcmdldENhbnZhcyA9IG51bGw7XHJcbiAgICAgICAgICAgIHRoaXMuX2NhbnZhc1Bvc2l0aW9uID0gbnVsbDtcclxuICAgICAgICAgICAgdGhpcy5fY2FudmFzVXBkYXRlZENhbGxiYWNrQm91bmQgPSB0aGlzLl9jYW52YXNVcGRhdGVkQ2FsbGJhY2suYmluZCh0aGlzKTtcclxuICAgICAgICAgICAgdGhpcy5faW1hZ2VWaWV3ZXIgPSBudWxsO1xyXG4gICAgICAgICAgICB0aGlzLl9leGNlcHRpb25DYWxsYmFjayA9IG51bGw7XHJcbiAgICAgICAgfSxcclxuICAgICAgICBcclxuICAgICAgICBzZXRFeGNlcHRpb25DYWxsYmFjazogZnVuY3Rpb24gc2V0RXhjZXB0aW9uQ2FsbGJhY2soZXhjZXB0aW9uQ2FsbGJhY2spIHtcclxuICAgICAgICAgICAgdGhpcy5fZXhjZXB0aW9uQ2FsbGJhY2sgPSBleGNlcHRpb25DYWxsYmFjaztcclxuICAgICAgICAgICAgaWYgKHRoaXMuX2ltYWdlVmlld2VyICE9PSBudWxsKSB7XHJcbiAgICAgICAgICAgICAgICB0aGlzLl9pbWFnZVZpZXdlci5zZXRFeGNlcHRpb25DYWxsYmFjayhleGNlcHRpb25DYWxsYmFjayk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9LFxyXG4gICAgICAgIFxyXG4gICAgICAgIF9jcmVhdGVJbWFnZTogZnVuY3Rpb24gY3JlYXRlSW1hZ2UoKSB7XHJcbiAgICAgICAgICAgIGlmICh0aGlzLl9pbWFnZVZpZXdlciA9PT0gbnVsbCkge1xyXG4gICAgICAgICAgICAgICAgdGhpcy5faW1hZ2VWaWV3ZXIgPSBuZXcgSW1hZ2VWaWV3ZXIoXHJcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5fb3B0aW9ucy5pbWFnZSxcclxuICAgICAgICAgICAgICAgICAgICB0aGlzLl9jYW52YXNVcGRhdGVkQ2FsbGJhY2tCb3VuZCxcclxuICAgICAgICAgICAgICAgICAgICB0aGlzLl9vcHRpb25zKTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgaWYgKHRoaXMuX2V4Y2VwdGlvbkNhbGxiYWNrICE9PSBudWxsKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5faW1hZ2VWaWV3ZXIuc2V0RXhjZXB0aW9uQ2FsbGJhY2sodGhpcy5fZXhjZXB0aW9uQ2FsbGJhY2spO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICB0aGlzLl9pbWFnZVZpZXdlci5vcGVuKHRoaXMuX29wdGlvbnMudXJsKS5jYXRjaCh0aGlzLl9leGNlcHRpb25DYWxsYmFjayk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9LFxyXG5cclxuICAgICAgICBvbkFkZDogZnVuY3Rpb24gb25BZGQobWFwKSB7XHJcbiAgICAgICAgICAgIGlmICh0aGlzLl9tYXAgIT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgICAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogQ2Fubm90IGFkZCB0aGlzIGxheWVyIHRvIHR3byBtYXBzJztcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgdGhpcy5fbWFwID0gbWFwO1xyXG4gICAgICAgICAgICB0aGlzLl9jcmVhdGVJbWFnZSgpO1xyXG5cclxuICAgICAgICAgICAgLy8gY3JlYXRlIGEgRE9NIGVsZW1lbnQgYW5kIHB1dCBpdCBpbnRvIG9uZSBvZiB0aGUgbWFwIHBhbmVzXHJcbiAgICAgICAgICAgIHRoaXMuX3RhcmdldENhbnZhcyA9IEwuRG9tVXRpbC5jcmVhdGUoXHJcbiAgICAgICAgICAgICAgICAnY2FudmFzJywgJ2ltYWdlLWRlY29kZXItbGF5ZXItY2FudmFzIGxlYWZsZXQtem9vbS1hbmltYXRlZCcpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgdGhpcy5faW1hZ2VWaWV3ZXIuc2V0VGFyZ2V0Q2FudmFzKHRoaXMuX3RhcmdldENhbnZhcyk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICB0aGlzLl9jYW52YXNQb3NpdGlvbiA9IG51bGw7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgbWFwLmdldFBhbmVzKCkubWFwUGFuZS5hcHBlbmRDaGlsZCh0aGlzLl90YXJnZXRDYW52YXMpO1xyXG5cclxuICAgICAgICAgICAgLy8gYWRkIGEgdmlld3Jlc2V0IGV2ZW50IGxpc3RlbmVyIGZvciB1cGRhdGluZyBsYXllcidzIHBvc2l0aW9uLCBkbyB0aGUgbGF0dGVyXHJcbiAgICAgICAgICAgIG1hcC5vbigndmlld3Jlc2V0JywgdGhpcy5fbW92ZWQsIHRoaXMpO1xyXG4gICAgICAgICAgICBtYXAub24oJ21vdmUnLCB0aGlzLl9tb3ZlZCwgdGhpcyk7XHJcblxyXG4gICAgICAgICAgICBpZiAoTC5Ccm93c2VyLmFueTNkKSB7XHJcbiAgICAgICAgICAgICAgICBtYXAub24oJ3pvb21hbmltJywgdGhpcy5fYW5pbWF0ZVpvb20sIHRoaXMpO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICB0aGlzLl9tb3ZlZCgpO1xyXG4gICAgICAgIH0sXHJcblxyXG4gICAgICAgIG9uUmVtb3ZlOiBmdW5jdGlvbiBvblJlbW92ZShtYXApIHtcclxuICAgICAgICAgICAgaWYgKG1hcCAhPT0gdGhpcy5fbWFwKSB7XHJcbiAgICAgICAgICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBSZW1vdmVkIGZyb20gd3JvbmcgbWFwJztcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgbWFwLm9mZigndmlld3Jlc2V0JywgdGhpcy5fbW92ZWQsIHRoaXMpO1xyXG4gICAgICAgICAgICBtYXAub2ZmKCdtb3ZlJywgdGhpcy5fbW92ZWQsIHRoaXMpO1xyXG4gICAgICAgICAgICBtYXAub2ZmKCd6b29tYW5pbScsIHRoaXMuX2FuaW1hdGVab29tLCB0aGlzKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIHJlbW92ZSBsYXllcidzIERPTSBlbGVtZW50cyBhbmQgbGlzdGVuZXJzXHJcbiAgICAgICAgICAgIG1hcC5nZXRQYW5lcygpLm1hcFBhbmUucmVtb3ZlQ2hpbGQodGhpcy5fdGFyZ2V0Q2FudmFzKTtcclxuICAgICAgICAgICAgdGhpcy5fdGFyZ2V0Q2FudmFzID0gbnVsbDtcclxuICAgICAgICAgICAgdGhpcy5fY2FudmFzUG9zaXRpb24gPSBudWxsO1xyXG5cclxuICAgICAgICAgICAgdGhpcy5fbWFwID0gdW5kZWZpbmVkO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgdGhpcy5faW1hZ2VWaWV3ZXIuY2xvc2UoKTtcclxuICAgICAgICAgICAgdGhpcy5faW1hZ2VWaWV3ZXIgPSBudWxsO1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgXHJcbiAgICAgICAgX21vdmVkOiBmdW5jdGlvbiAoKSB7XHJcbiAgICAgICAgICAgIHRoaXMuX21vdmVDYW52YXNlcygpO1xyXG5cclxuICAgICAgICAgICAgdmFyIGZydXN0dW1EYXRhID0gY2FsY3VsYXRlTGVhZmxldEZydXN0dW0odGhpcy5fbWFwKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHRoaXMuX2ltYWdlVmlld2VyLnVwZGF0ZVZpZXdBcmVhKGZydXN0dW1EYXRhKTtcclxuICAgICAgICB9LFxyXG4gICAgICAgIFxyXG4gICAgICAgIF9jYW52YXNVcGRhdGVkQ2FsbGJhY2s6IGZ1bmN0aW9uIGNhbnZhc1VwZGF0ZWRDYWxsYmFjayhuZXdQb3NpdGlvbikge1xyXG4gICAgICAgICAgICBpZiAobmV3UG9zaXRpb24gIT09IG51bGwpIHtcclxuICAgICAgICAgICAgICAgIHRoaXMuX2NhbnZhc1Bvc2l0aW9uID0gbmV3UG9zaXRpb247XHJcbiAgICAgICAgICAgICAgICB0aGlzLl9tb3ZlQ2FudmFzZXMoKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH0sXHJcbiAgICAgICAgXHJcbiAgICAgICAgX21vdmVDYW52YXNlczogZnVuY3Rpb24gbW92ZUNhbnZhc2VzKCkge1xyXG4gICAgICAgICAgICBpZiAodGhpcy5fY2FudmFzUG9zaXRpb24gPT09IG51bGwpIHtcclxuICAgICAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgICAgICAvLyB1cGRhdGUgbGF5ZXIncyBwb3NpdGlvblxyXG4gICAgICAgICAgICB2YXIgd2VzdCA9IHRoaXMuX2NhbnZhc1Bvc2l0aW9uLndlc3Q7XHJcbiAgICAgICAgICAgIHZhciBlYXN0ID0gdGhpcy5fY2FudmFzUG9zaXRpb24uZWFzdDtcclxuICAgICAgICAgICAgdmFyIHNvdXRoID0gdGhpcy5fY2FudmFzUG9zaXRpb24uc291dGg7XHJcbiAgICAgICAgICAgIHZhciBub3J0aCA9IHRoaXMuX2NhbnZhc1Bvc2l0aW9uLm5vcnRoO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgdmFyIHRvcExlZnQgPSB0aGlzLl9tYXAubGF0TG5nVG9MYXllclBvaW50KFtub3J0aCwgd2VzdF0pO1xyXG4gICAgICAgICAgICB2YXIgYm90dG9tUmlnaHQgPSB0aGlzLl9tYXAubGF0TG5nVG9MYXllclBvaW50KFtzb3V0aCwgZWFzdF0pO1xyXG4gICAgICAgICAgICB2YXIgc2l6ZSA9IGJvdHRvbVJpZ2h0LnN1YnRyYWN0KHRvcExlZnQpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgTC5Eb21VdGlsLnNldFBvc2l0aW9uKHRoaXMuX3RhcmdldENhbnZhcywgdG9wTGVmdCk7XHJcbiAgICAgICAgICAgIHRoaXMuX3RhcmdldENhbnZhcy5zdHlsZS53aWR0aCA9IHNpemUueCArICdweCc7XHJcbiAgICAgICAgICAgIHRoaXMuX3RhcmdldENhbnZhcy5zdHlsZS5oZWlnaHQgPSBzaXplLnkgKyAncHgnO1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgXHJcbiAgICAgICAgX2FuaW1hdGVab29tOiBmdW5jdGlvbiBhbmltYXRlWm9vbShvcHRpb25zKSB7XHJcbiAgICAgICAgICAgIGlmICh0aGlzLl9jYW52YXNQb3NpdGlvbiA9PT0gbnVsbCkge1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIE5PVEU6IEFsbCBtZXRob2QgKGluY2x1ZGluZyB1c2luZyBvZiBwcml2YXRlIG1ldGhvZFxyXG4gICAgICAgICAgICAvLyBfbGF0TG5nVG9OZXdMYXllclBvaW50KSB3YXMgY29waWVkIGZyb20gSW1hZ2VPdmVybGF5LFxyXG4gICAgICAgICAgICAvLyBhcyBMZWFmbGV0IGRvY3VtZW50YXRpb24gcmVjb21tZW5kcy5cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHZhciB3ZXN0ID0gIHRoaXMuX2NhbnZhc1Bvc2l0aW9uLndlc3Q7XHJcbiAgICAgICAgICAgIHZhciBlYXN0ID0gIHRoaXMuX2NhbnZhc1Bvc2l0aW9uLmVhc3Q7XHJcbiAgICAgICAgICAgIHZhciBzb3V0aCA9IHRoaXMuX2NhbnZhc1Bvc2l0aW9uLnNvdXRoO1xyXG4gICAgICAgICAgICB2YXIgbm9ydGggPSB0aGlzLl9jYW52YXNQb3NpdGlvbi5ub3J0aDtcclxuXHJcbiAgICAgICAgICAgIHZhciB0b3BMZWZ0ID0gdGhpcy5fbWFwLl9sYXRMbmdUb05ld0xheWVyUG9pbnQoXHJcbiAgICAgICAgICAgICAgICBbbm9ydGgsIHdlc3RdLCBvcHRpb25zLnpvb20sIG9wdGlvbnMuY2VudGVyKTtcclxuICAgICAgICAgICAgdmFyIGJvdHRvbVJpZ2h0ID0gdGhpcy5fbWFwLl9sYXRMbmdUb05ld0xheWVyUG9pbnQoXHJcbiAgICAgICAgICAgICAgICBbc291dGgsIGVhc3RdLCBvcHRpb25zLnpvb20sIG9wdGlvbnMuY2VudGVyKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHZhciBzY2FsZSA9IHRoaXMuX21hcC5nZXRab29tU2NhbGUob3B0aW9ucy56b29tKTtcclxuICAgICAgICAgICAgdmFyIHNpemUgPSBib3R0b21SaWdodC5zdWJ0cmFjdCh0b3BMZWZ0KTtcclxuICAgICAgICAgICAgdmFyIHNpemVTY2FsZWQgPSBzaXplLm11bHRpcGx5QnkoKDEgLyAyKSAqICgxIC0gMSAvIHNjYWxlKSk7XHJcbiAgICAgICAgICAgIHZhciBvcmlnaW4gPSB0b3BMZWZ0LmFkZChzaXplU2NhbGVkKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHRoaXMuX3RhcmdldENhbnZhcy5zdHlsZVtMLkRvbVV0aWwuVFJBTlNGT1JNXSA9XHJcbiAgICAgICAgICAgICAgICBMLkRvbVV0aWwuZ2V0VHJhbnNsYXRlU3RyaW5nKG9yaWdpbikgKyAnIHNjYWxlKCcgKyBzY2FsZSArICcpICc7XHJcbiAgICAgICAgfVxyXG4gICAgfTtcclxufSIsIid1c2Ugc3RyaWN0JztcclxuXHJcbnZhciBpbWFnZUhlbHBlckZ1bmN0aW9ucyA9IHJlcXVpcmUoJ2ltYWdlLWhlbHBlci1mdW5jdGlvbnMuanMnKTtcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gY2FsY3VsYXRlTGVhZmxldEZydXN0dW0obGVhZmxldE1hcCkge1xyXG4gICAgdmFyIHNjcmVlblNpemUgPSBsZWFmbGV0TWFwLmdldFNpemUoKTtcclxuICAgIHZhciBib3VuZHMgPSBsZWFmbGV0TWFwLmdldEJvdW5kcygpO1xyXG5cclxuICAgIHZhciBjYXJ0b2dyYXBoaWNCb3VuZHMgPSB7XHJcbiAgICAgICAgd2VzdDogYm91bmRzLmdldFdlc3QoKSxcclxuICAgICAgICBlYXN0OiBib3VuZHMuZ2V0RWFzdCgpLFxyXG4gICAgICAgIHNvdXRoOiBib3VuZHMuZ2V0U291dGgoKSxcclxuICAgICAgICBub3J0aDogYm91bmRzLmdldE5vcnRoKClcclxuICAgIH07XHJcbiAgICBcclxuICAgIHZhciBmcnVzdHVtRGF0YSA9IGltYWdlSGVscGVyRnVuY3Rpb25zLmNhbGN1bGF0ZUZydXN0dW0yREZyb21Cb3VuZHMoXHJcbiAgICAgICAgY2FydG9ncmFwaGljQm91bmRzLCBzY3JlZW5TaXplKTtcclxuXHJcbiAgICByZXR1cm4gZnJ1c3R1bURhdGE7XHJcbn07IiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBHcmlkRGVjb2RlcldvcmtlckJhc2U7XHJcblxyXG4vKiBnbG9iYWwgUHJvbWlzZSA6IGZhbHNlICovXHJcbi8qIGdsb2JhbCBJbWFnZURhdGEgOiBmYWxzZSAqL1xyXG5cclxuZnVuY3Rpb24gR3JpZERlY29kZXJXb3JrZXJCYXNlKCkge1xyXG4gICAgR3JpZERlY29kZXJXb3JrZXJCYXNlLnByb3RvdHlwZS5zdGFydCA9IGZ1bmN0aW9uIGRlY29kZShkZWNvZGVySW5wdXQpIHtcclxuICAgICAgICB2YXIgaW1hZ2VQYXJ0UGFyYW1zID0gZGVjb2RlcklucHV0LmltYWdlUGFydFBhcmFtcztcclxuICAgICAgICB2YXIgd2lkdGggID0gaW1hZ2VQYXJ0UGFyYW1zLm1heFhFeGNsdXNpdmUgLSBpbWFnZVBhcnRQYXJhbXMubWluWDtcclxuICAgICAgICB2YXIgaGVpZ2h0ID0gaW1hZ2VQYXJ0UGFyYW1zLm1heFlFeGNsdXNpdmUgLSBpbWFnZVBhcnRQYXJhbXMubWluWTtcclxuICAgICAgICB2YXIgcmVzdWx0ID0gbmV3IEltYWdlRGF0YSh3aWR0aCwgaGVpZ2h0KTtcclxuICAgICAgICB2YXIgcHJvbWlzZXMgPSBbXTtcclxuXHRcdHZhciB0aWxlUG9zaXRpb24gID0ge21pblg6IDAsIG1pblk6IDAsIG1heFhFeGNsdXNpdmU6IDAsIG1heFlFeGNsdXNpdmU6IDAsIHdpZHRoOiBkZWNvZGVySW5wdXQudGlsZVdpZHRoLCBoZWlnaHQ6IGRlY29kZXJJbnB1dC50aWxlSGVpZ2h0fTtcclxuXHRcdHZhciByZWdpb25JbkltYWdlID0ge21pblg6IDAsIG1pblk6IDAsIG1heFhFeGNsdXNpdmU6IDAsIG1heFlFeGNsdXNpdmU6IDAsIHdpZHRoOiAwLCBoZWlnaHQ6IDB9OyBcclxuXHRcdHZhciBvZmZzZXQgPSB7eDogMCwgeTogMH07XHJcblx0XHR2YXIgdGlsZSA9IHt0aWxlWDogMCwgdGlsZVk6IDAsIGxldmVsOiAwLCBwb3NpdGlvbjogdGlsZVBvc2l0aW9uLCBjb250ZW50OiBudWxsfTtcclxuXHRcdGZvciAodmFyIGkgPSAwOyBpIDwgZGVjb2RlcklucHV0LnRpbGVJbmRpY2VzLmxlbmd0aDsgKytpKSB7XHJcblx0XHRcdHRpbGVQb3NpdGlvbi5taW5YICAgICAgICAgID0gZGVjb2RlcklucHV0LnRpbGVJbmRpY2VzW2ldLnRpbGVYICogZGVjb2RlcklucHV0LnRpbGVXaWR0aCA7XHJcblx0XHRcdHRpbGVQb3NpdGlvbi5taW5ZICAgICAgICAgID0gZGVjb2RlcklucHV0LnRpbGVJbmRpY2VzW2ldLnRpbGVZICogZGVjb2RlcklucHV0LnRpbGVIZWlnaHQ7XHJcblx0XHRcdHRpbGVQb3NpdGlvbi5tYXhYRXhjbHVzaXZlID0gdGlsZVBvc2l0aW9uLm1pblggKyBkZWNvZGVySW5wdXQudGlsZVdpZHRoO1xyXG5cdFx0XHR0aWxlUG9zaXRpb24ubWF4WUV4Y2x1c2l2ZSA9IHRpbGVQb3NpdGlvbi5taW5ZICsgZGVjb2RlcklucHV0LnRpbGVIZWlnaHQ7XHJcblx0XHRcdFxyXG5cdFx0XHRyZWdpb25JbkltYWdlLm1pblggICAgICAgICAgPSBNYXRoLm1heCh0aWxlUG9zaXRpb24ubWluWCwgaW1hZ2VQYXJ0UGFyYW1zLm1pblgpO1xyXG5cdFx0XHRyZWdpb25JbkltYWdlLm1pblkgICAgICAgICAgPSBNYXRoLm1heCh0aWxlUG9zaXRpb24ubWluWSwgaW1hZ2VQYXJ0UGFyYW1zLm1pblkpO1xyXG5cdFx0XHRyZWdpb25JbkltYWdlLm1heFhFeGNsdXNpdmUgPSBNYXRoLm1pbih0aWxlUG9zaXRpb24ubWF4WEV4Y2x1c2l2ZSwgaW1hZ2VQYXJ0UGFyYW1zLm1heFhFeGNsdXNpdmUpO1xyXG5cdFx0XHRyZWdpb25JbkltYWdlLm1heFlFeGNsdXNpdmUgPSBNYXRoLm1pbih0aWxlUG9zaXRpb24ubWF4WUV4Y2x1c2l2ZSwgaW1hZ2VQYXJ0UGFyYW1zLm1heFlFeGNsdXNpdmUpO1xyXG5cdFx0XHRyZWdpb25JbkltYWdlLndpZHRoICAgICAgICAgPSByZWdpb25JbkltYWdlLm1heFhFeGNsdXNpdmUgLSByZWdpb25JbkltYWdlLm1pblg7XHJcblx0XHRcdHJlZ2lvbkluSW1hZ2UuaGVpZ2h0ICAgICAgICA9IHJlZ2lvbkluSW1hZ2UubWF4WUV4Y2x1c2l2ZSAtIHJlZ2lvbkluSW1hZ2UubWluWTtcclxuXHRcdFx0XHJcblx0XHRcdG9mZnNldC54ID0gcmVnaW9uSW5JbWFnZS5taW5YIC0gaW1hZ2VQYXJ0UGFyYW1zLm1pblg7XHJcblx0XHRcdG9mZnNldC55ID0gcmVnaW9uSW5JbWFnZS5taW5ZIC0gaW1hZ2VQYXJ0UGFyYW1zLm1pblk7XHJcblx0XHRcdFxyXG5cdFx0XHR0aWxlLnRpbGVZID0gZGVjb2RlcklucHV0LnRpbGVJbmRpY2VzW2ldLnRpbGVZO1xyXG5cdFx0XHR0aWxlLnRpbGVYID0gZGVjb2RlcklucHV0LnRpbGVJbmRpY2VzW2ldLnRpbGVYO1xyXG5cdFx0XHR0aWxlLmxldmVsID0gZGVjb2RlcklucHV0LnRpbGVJbmRpY2VzW2ldLmxldmVsO1xyXG5cdFx0XHR0aWxlLmNvbnRlbnQgPSBkZWNvZGVySW5wdXQudGlsZUNvbnRlbnRzW2ldO1xyXG4gICAgICAgICAgICBwcm9taXNlcy5wdXNoKHRoaXMuZGVjb2RlUmVnaW9uKHJlc3VsdCwgb2Zmc2V0LCByZWdpb25JbkltYWdlLCB0aWxlKSk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHJldHVybiBQcm9taXNlLmFsbChwcm9taXNlcykudGhlbihmdW5jdGlvbigpIHtcclxuICAgICAgICAgICAgcmV0dXJuIHJlc3VsdDtcclxuICAgICAgICB9KTtcclxuICAgIH07XHJcbiAgICBcclxuICAgIEdyaWREZWNvZGVyV29ya2VyQmFzZS5wcm90b3R5cGUuZGVjb2RlUmVnaW9uID0gZnVuY3Rpb24gZGVjb2RlUmVnaW9uKHRhcmdldEltYWdlRGF0YSwgaW1hZ2VQYXJ0UGFyYW1zLCBrZXksIGZldGNoZWREYXRhKSB7XHJcbiAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogZGVjb2RlUmVnaW9uIGlzIG5vdCBpbXBsZW1lbnRlZCc7XHJcbiAgICB9O1xyXG59IiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBHcmlkRmV0Y2hlckJhc2U7XHJcblxyXG52YXIgRmV0Y2hlckJhc2UgPSByZXF1aXJlKCdmZXRjaGVyLWJhc2UuanMnKTtcclxudmFyIEdyaWRJbWFnZUJhc2UgPSByZXF1aXJlKCdncmlkLWltYWdlLWJhc2UuanMnKTtcclxudmFyIExpbmtlZExpc3QgPSByZXF1aXJlKCdsaW5rZWQtbGlzdC5qcycpO1xyXG5cclxuLyogZ2xvYmFsIFByb21pc2U6IGZhbHNlICovXHJcblxyXG5mdW5jdGlvbiBHcmlkRmV0Y2hlckJhc2Uob3B0aW9ucykge1xyXG5cdEZldGNoZXJCYXNlLmNhbGwodGhpcywgb3B0aW9ucyk7XHJcblx0dGhpcy5fZ3JpZEZldGNoZXJCYXNlQ2FjaGUgPSBbXTtcclxuXHR0aGlzLl9ldmVudHMgPSB7XHJcblx0XHQnZGF0YSc6IFtdLFxyXG5cdFx0J3RpbGUtdGVybWluYXRlZCc6IFtdXHJcblx0fTtcclxufVxyXG5cclxuR3JpZEZldGNoZXJCYXNlLnByb3RvdHlwZSA9IE9iamVjdC5jcmVhdGUoRmV0Y2hlckJhc2UucHJvdG90eXBlKTtcclxuXHJcbkdyaWRGZXRjaGVyQmFzZS5wcm90b3R5cGUuZmV0Y2hUaWxlID0gZnVuY3Rpb24obGV2ZWwsIHRpbGVYLCB0aWxlWSwgZmV0Y2hUYXNrKSB7XHJcblx0dGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogR3JpZEZldGNoZXJCYXNlLmZldGNoVGlsZSBpcyBub3QgaW1wbGVtZW50ZWQgYnkgaW5oZXJpdG9yJztcclxufTtcclxuXHJcbkdyaWRGZXRjaGVyQmFzZS5wcm90b3R5cGUub24gPSBmdW5jdGlvbihldmVudCwgbGlzdGVuZXIpIHtcclxuXHR2YXIgbGlzdGVuZXJzID0gdGhpcy5fZXZlbnRzW2V2ZW50XTtcclxuXHRpZiAoIWxpc3RlbmVycykge1xyXG5cdFx0dGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogVW5leHBlY3RlZCBldmVudCAnICsgZXZlbnQgKyAnIGluIEdyaWRGZXRjaGVyQmFzZSc7XHJcblx0fVxyXG5cdGxpc3RlbmVycy5wdXNoKGxpc3RlbmVyKTtcclxufTtcclxuXHJcbkdyaWRGZXRjaGVyQmFzZS5wcm90b3R5cGUuc3RhcnRGZXRjaCA9IGZ1bmN0aW9uIHN0YXJ0RmV0Y2goZmV0Y2hDb250ZXh0LCBpbWFnZVBhcnRQYXJhbXMpIHtcclxuXHR2YXIgZmV0Y2hEYXRhID0ge1xyXG5cdFx0YWN0aXZlVGlsZXNDb3VudDogMCxcclxuXHRcdGFjdGl2ZVRpbGVzQ291bnRXaXRoU2luZ2xlTGlzdGVuZXI6IDAsXHJcblx0XHR0aWxlTGlzdGVuZXJzOiBbXSxcclxuXHRcdGZldGNoQ29udGV4dDogZmV0Y2hDb250ZXh0LFxyXG5cdFx0aXNQZW5kaW5nU3RvcDogZmFsc2UsXHJcblx0XHRpc0FjdGl2ZTogZmFsc2UsXHJcblx0XHRpbWFnZVBhcnRQYXJhbXM6IGltYWdlUGFydFBhcmFtcyxcclxuXHRcdHNlbGY6IHRoaXNcclxuXHR9O1xyXG5cdFxyXG5cdGZldGNoQ29udGV4dC5vbignc3RvcCcsIG9uRmV0Y2hTdG9wLCBmZXRjaERhdGEpO1xyXG5cdGZldGNoQ29udGV4dC5vbigncmVzdW1lJywgb25GZXRjaFJlc3VtZSwgZmV0Y2hEYXRhKTtcclxuXHRmZXRjaENvbnRleHQub24oJ3Rlcm1pbmF0ZScsIG9uRmV0Y2hUZXJtaW5hdGUsIGZldGNoRGF0YSk7XHJcblxyXG5cdHZhciB0aWxlc1RvU3RhcnRYID0gW107XHJcblx0dmFyIHRpbGVzVG9TdGFydFkgPSBbXTtcclxuXHR2YXIgdGlsZXNUb1N0YXJ0RGVwZW5kRmV0Y2hlcyA9IFtdO1xyXG5cdFxyXG5cdHZhciB0aWxlc1JhbmdlID0gR3JpZEltYWdlQmFzZS5nZXRUaWxlc1JhbmdlKHRoaXMuZ2V0SW1hZ2VQYXJhbXMoKSwgaW1hZ2VQYXJ0UGFyYW1zKTtcclxuXHRmZXRjaERhdGEuYWN0aXZlVGlsZXNDb3VudCA9ICh0aWxlc1JhbmdlLm1heFRpbGVYIC0gdGlsZXNSYW5nZS5taW5UaWxlWCkgKiAodGlsZXNSYW5nZS5tYXhUaWxlWSAtIHRpbGVzUmFuZ2UubWluVGlsZVkpO1xyXG5cdGZvciAodmFyIHRpbGVYID0gdGlsZXNSYW5nZS5taW5UaWxlWDsgdGlsZVggPCB0aWxlc1JhbmdlLm1heFRpbGVYOyArK3RpbGVYKSB7XHJcblx0XHRmb3IgKHZhciB0aWxlWSA9IHRpbGVzUmFuZ2UubWluVGlsZVk7IHRpbGVZIDwgdGlsZXNSYW5nZS5tYXhUaWxlWTsgKyt0aWxlWSkge1xyXG5cdFx0XHR2YXIgZGVwZW5kRmV0Y2hlcyA9IHRoaXMuX2FkZFRvQ2FjaGUodGlsZVgsIHRpbGVZLCBmZXRjaERhdGEpO1xyXG5cdFx0XHRpZiAoZGVwZW5kRmV0Y2hlcyA9PT0gbnVsbCkge1xyXG5cdFx0XHRcdGNvbnRpbnVlO1xyXG5cdFx0XHR9XHJcblxyXG5cdFx0XHR0aWxlc1RvU3RhcnRYLnB1c2godGlsZVgpO1xyXG5cdFx0XHR0aWxlc1RvU3RhcnRZLnB1c2godGlsZVkpO1xyXG5cdFx0XHR0aWxlc1RvU3RhcnREZXBlbmRGZXRjaGVzLnB1c2goZGVwZW5kRmV0Y2hlcyk7XHJcblx0XHR9XHJcblx0fVxyXG5cdFxyXG5cdG9uRmV0Y2hSZXN1bWUuY2FsbChmZXRjaERhdGEpO1xyXG5cdFxyXG5cdGZvciAodmFyIGkgPSAwOyBpIDwgdGlsZXNUb1N0YXJ0WC5sZW5ndGg7ICsraSkge1xyXG5cdFx0dGhpcy5fbG9hZFRpbGUoZmV0Y2hEYXRhLmltYWdlUGFydFBhcmFtcy5sZXZlbCwgdGlsZXNUb1N0YXJ0WFtpXSwgdGlsZXNUb1N0YXJ0WVtpXSwgdGlsZXNUb1N0YXJ0RGVwZW5kRmV0Y2hlc1tpXSk7XHJcblx0fVxyXG59O1xyXG5cclxuR3JpZEZldGNoZXJCYXNlLnByb3RvdHlwZS5fY2hlY2tJZlNob3VsZFN0b3AgPSBmdW5jdGlvbiB0cnlTdG9wRmV0Y2goZmV0Y2hEYXRhKSB7XHJcblx0aWYgKCFmZXRjaERhdGEuaXNQZW5kaW5nU3RvcCB8fCBmZXRjaERhdGEuYWN0aXZlVGlsZXNDb3VudFdpdGhTaW5nbGVMaXN0ZW5lciA+IDApIHtcclxuXHRcdHJldHVybjtcclxuXHR9XHJcblx0XHJcblx0ZmV0Y2hEYXRhLmlzUGVuZGluZ1N0b3AgPSBmYWxzZTtcclxuXHRmZXRjaERhdGEuaXNBY3RpdmUgPSBmYWxzZTtcclxuXHR0aGlzLl9jaGFuZ2VTaW5nbGVMaXN0ZW5lckNvdW50T2ZPdmVybGFwcGluZ0ZldGNoZXMoZmV0Y2hEYXRhLCArMSk7XHJcblx0ZmV0Y2hEYXRhLmZldGNoQ29udGV4dC5zdG9wcGVkKCk7XHJcbn07XHJcblx0XHJcbkdyaWRGZXRjaGVyQmFzZS5wcm90b3R5cGUuX2NoYW5nZVNpbmdsZUxpc3RlbmVyQ291bnRPZk92ZXJsYXBwaW5nRmV0Y2hlcyA9XHJcblx0XHRmdW5jdGlvbiBjaGFuZ2VTaW5nbGVMaXN0ZW5lckNvdW50T2ZPdmVybGFwcGluZ0ZldGNoZXMoZmV0Y2hEYXRhLCBhZGRWYWx1ZSkge1xyXG5cdFx0XHRcclxuXHRmb3IgKHZhciBpID0gMDsgaSA8IGZldGNoRGF0YS50aWxlTGlzdGVuZXJzLmxlbmd0aDsgKytpKSB7XHJcblx0XHR2YXIgdGlsZURlcGVuZEZldGNoZXMgPSBmZXRjaERhdGEudGlsZUxpc3RlbmVyc1tpXS5kZXBlbmRGZXRjaGVzO1xyXG5cdFx0dGhpcy5fY2hhbmdlVGlsZXNDb3VudE9mVGlsZURlcGVuZEZldGNoZXModGlsZURlcGVuZEZldGNoZXMsIC8qc2luZ2xlTGlzdGVuZXJBZGRWYWx1ZT0qL2FkZFZhbHVlLCAvKmFjdGl2ZVRpbGVzQWRkVmFsdWU9Ki8wKTtcclxuXHR9XHJcbn07XHJcblxyXG5HcmlkRmV0Y2hlckJhc2UucHJvdG90eXBlLl9jaGFuZ2VUaWxlc0NvdW50T2ZUaWxlRGVwZW5kRmV0Y2hlcyA9IGZ1bmN0aW9uKHRpbGVEZXBlbmRGZXRjaGVzLCBzaW5nbGVMaXN0ZW5lckFkZFZhbHVlLCBhY3RpdmVUaWxlc0FkZFZhbHVlKSB7XHJcblx0dmFyIHNpbmdsZUFjdGl2ZUZldGNoID0gbnVsbDtcclxuXHR2YXIgaGFzQWN0aXZlRmV0Y2hlcyA9IGZhbHNlO1xyXG5cdHZhciBpdGVyYXRvciA9IHRpbGVEZXBlbmRGZXRjaGVzLmdldEZpcnN0SXRlcmF0b3IoKTtcclxuXHR3aGlsZSAoaXRlcmF0b3IgIT09IG51bGwpIHtcclxuXHRcdHZhciBmZXRjaERhdGEgPSB0aWxlRGVwZW5kRmV0Y2hlcy5nZXRWYWx1ZShpdGVyYXRvcik7XHJcblx0XHRpdGVyYXRvciA9IHRpbGVEZXBlbmRGZXRjaGVzLmdldE5leHRJdGVyYXRvcihpdGVyYXRvcik7XHJcblxyXG5cdFx0ZmV0Y2hEYXRhLmFjdGl2ZVRpbGVzQ291bnQgKz0gYWN0aXZlVGlsZXNBZGRWYWx1ZTtcclxuXHRcdGlmIChmZXRjaERhdGEuYWN0aXZlVGlsZXNDb3VudCA9PT0gMCkge1xyXG5cdFx0XHRmZXRjaERhdGEuaXNBY3RpdmUgPSBmYWxzZTtcclxuXHRcdFx0ZmV0Y2hEYXRhLmZldGNoQ29udGV4dC5kb25lKCk7XHJcblx0XHR9XHJcblxyXG5cdFx0aWYgKCFmZXRjaERhdGEuaXNBY3RpdmUpIHtcclxuXHRcdFx0Y29udGludWU7XHJcblx0XHR9IGVsc2UgaWYgKHNpbmdsZUFjdGl2ZUZldGNoID09PSBudWxsKSB7XHJcblx0XHRcdHNpbmdsZUFjdGl2ZUZldGNoID0gZmV0Y2hEYXRhO1xyXG5cdFx0XHRoYXNBY3RpdmVGZXRjaGVzID0gdHJ1ZTtcclxuXHRcdH0gZWxzZSBpZiAoaGFzQWN0aXZlRmV0Y2hlcykge1xyXG5cdFx0XHQvLyBOb3Qgc2luZ2xlIGFueW1vcmVcclxuXHRcdFx0c2luZ2xlQWN0aXZlRmV0Y2ggPSBudWxsO1xyXG5cdFx0XHRpZiAoIWFjdGl2ZVRpbGVzQWRkVmFsdWUpIHtcclxuXHRcdFx0XHRicmVhaztcclxuXHRcdFx0fVxyXG5cdFx0fVxyXG5cdH1cclxuXHRcclxuXHRpZiAoc2luZ2xlQWN0aXZlRmV0Y2ggIT09IG51bGwpIHtcclxuXHRcdHNpbmdsZUFjdGl2ZUZldGNoLmFjdGl2ZVRpbGVzQ291bnRXaXRoU2luZ2xlTGlzdGVuZXIgKz0gc2luZ2xlTGlzdGVuZXJBZGRWYWx1ZTtcclxuXHRcdHRoaXMuX2NoZWNrSWZTaG91bGRTdG9wKHNpbmdsZUFjdGl2ZUZldGNoKTtcclxuXHR9XHJcbn07XHJcblxyXG5mdW5jdGlvbiBvbkZldGNoU3RvcCgpIHtcclxuXHQvKiBqc2hpbnQgdmFsaWR0aGlzOiB0cnVlICovXHJcblx0dmFyIGZldGNoRGF0YSA9IHRoaXM7XHJcblxyXG5cdGZldGNoRGF0YS5pc1BlbmRpbmdTdG9wID0gdHJ1ZTtcclxuXHRmZXRjaERhdGEuc2VsZi5fY2hlY2tJZlNob3VsZFN0b3AoZmV0Y2hEYXRhKTtcclxufVxyXG5cclxuZnVuY3Rpb24gb25GZXRjaFJlc3VtZSgpIHtcclxuXHQvKiBqc2hpbnQgdmFsaWR0aGlzOiB0cnVlICovXHJcblx0dmFyIGZldGNoRGF0YSA9IHRoaXM7XHJcblx0ZmV0Y2hEYXRhLmlzUGVuZGluZ1N0b3AgPSBmYWxzZTtcclxuXHRcclxuXHRmZXRjaERhdGEuc2VsZi5fY2hhbmdlU2luZ2xlTGlzdGVuZXJDb3VudE9mT3ZlcmxhcHBpbmdGZXRjaGVzKGZldGNoRGF0YSwgLTEpO1xyXG5cdGZldGNoRGF0YS5pc0FjdGl2ZSA9IHRydWU7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIG9uRmV0Y2hUZXJtaW5hdGUoKSB7XHJcblx0LyoganNoaW50IHZhbGlkdGhpczogdHJ1ZSAqL1xyXG5cdHZhciBmZXRjaERhdGEgPSB0aGlzO1xyXG5cdFxyXG5cdGlmIChmZXRjaERhdGEuaXNBY3RpdmUpIHtcclxuXHRcdHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IFVuZXhwZWN0ZWQgZ3JpZCBmZXRjaCB0ZXJtaW5hdGVkIG9mIGEgc3RpbGwgYWN0aXZlIGZldGNoJztcclxuXHR9XHJcblx0XHJcblx0Zm9yICh2YXIgaSA9IDA7IGkgPCBmZXRjaERhdGEudGlsZUxpc3RlbmVycy5sZW5ndGg7ICsraSkge1xyXG5cdFx0ZmV0Y2hEYXRhLnRpbGVMaXN0ZW5lcnNbaV0uZGVwZW5kRmV0Y2hlcy5yZW1vdmUoZmV0Y2hEYXRhLnRpbGVMaXN0ZW5lcnNbaV0uaXRlcmF0b3IpO1xyXG5cdH1cclxufVxyXG5cclxuR3JpZEZldGNoZXJCYXNlLnByb3RvdHlwZS5fbG9hZFRpbGUgPSBmdW5jdGlvbiBsb2FkVGlsZShsZXZlbCwgdGlsZVgsIHRpbGVZLCBkZXBlbmRGZXRjaGVzKSB7XHJcblx0dmFyIGlzVGVybWluYXRlZCA9IGZhbHNlO1xyXG5cdHZhciB0aWxlS2V5ID0ge1xyXG5cdFx0ZmV0Y2hXYWl0VGFzazogdHJ1ZSxcclxuXHRcdHRpbGVYOiB0aWxlWCxcclxuXHRcdHRpbGVZOiB0aWxlWSxcclxuXHRcdGxldmVsOiBsZXZlbFxyXG5cdH07XHJcblx0XHJcblx0dmFyIHNlbGYgPSB0aGlzO1xyXG5cdHRoaXMuZmV0Y2hUaWxlKGxldmVsLCB0aWxlWCwgdGlsZVksIHtcclxuXHRcdG9uRGF0YTogZnVuY3Rpb24ocmVzdWx0KSB7XHJcblx0XHRcdGlmIChpc1Rlcm1pbmF0ZWQpIHtcclxuXHRcdFx0XHR0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBhbHJlYWR5IHRlcm1pbmF0ZWQgaW4gR3JpZEZldGNoZXJCYXNlLmZldGNoVGlsZSgpJztcclxuXHRcdFx0fVxyXG5cdFx0XHR2YXIgZGF0YSA9IHtcclxuXHRcdFx0XHR0aWxlS2V5OiB0aWxlS2V5LFxyXG5cdFx0XHRcdHRpbGVDb250ZW50OiByZXN1bHRcclxuXHRcdFx0fTtcclxuXHRcdFx0Zm9yICh2YXIgaSA9IDA7IGkgPCBzZWxmLl9ldmVudHMuZGF0YS5sZW5ndGg7ICsraSkge1xyXG5cdFx0XHRcdHNlbGYuX2V2ZW50cy5kYXRhW2ldKGRhdGEpO1xyXG5cdFx0XHR9XHJcblx0XHR9LFxyXG5cdFx0XHJcblx0XHRvblRlcm1pbmF0ZWQ6IGZ1bmN0aW9uKCkge1xyXG5cdFx0XHRpZiAoaXNUZXJtaW5hdGVkKSB7XHJcblx0XHRcdFx0dGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogZG91YmxlIHRlcm1pbmF0aW9uIGluIEdyaWRGZXRjaGVyQmFzZS5mZXRjaFRpbGUoKSc7XHJcblx0XHRcdH1cclxuXHRcdFx0aWYgKHNlbGYuX2dyaWRGZXRjaGVyQmFzZUNhY2hlW2xldmVsXVt0aWxlWF1bdGlsZVldICE9PSBkZXBlbmRGZXRjaGVzKSB7XHJcblx0XHRcdFx0dGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogVW5leHBlY3RlZCBmZXRjaCBpbiBHcmlkRmV0Y2hlckJhc2UuZ3JpZEZldGNoZXJCYXNlQ2FjaGUnO1xyXG5cdFx0XHR9XHJcblx0XHRcdHNlbGYuX2dyaWRGZXRjaGVyQmFzZUNhY2hlW2xldmVsXVt0aWxlWF1bdGlsZVldID0gbnVsbDtcclxuXHRcdFx0XHJcblx0XHRcdGZvciAodmFyIGkgPSAwOyBpIDwgc2VsZi5fZXZlbnRzWyd0aWxlLXRlcm1pbmF0ZWQnXS5sZW5ndGg7ICsraSkge1xyXG5cdFx0XHRcdHNlbGYuX2V2ZW50c1sndGlsZS10ZXJtaW5hdGVkJ11baV0odGlsZUtleSk7XHJcblx0XHRcdH1cclxuXHRcdFx0XHJcblx0XHRcdHNlbGYuX2NoYW5nZVRpbGVzQ291bnRPZlRpbGVEZXBlbmRGZXRjaGVzKGRlcGVuZEZldGNoZXMsIC8qc2luZ2xlTGlzdGVuZXJBZGRWYWx1ZT0qLy0xLCAvKmFjdGl2ZVRpbGVzQWRkVmFsdWU9Ki8tMSk7XHJcblx0XHR9XHJcblx0fSk7XHJcbn07XHJcblxyXG5HcmlkRmV0Y2hlckJhc2UucHJvdG90eXBlLl9hZGRUb0NhY2hlID0gZnVuY3Rpb24gYWRkVG9DYWNoZSh0aWxlWCwgdGlsZVksIGZldGNoRGF0YSkge1xyXG5cdHZhciBsZXZlbENhY2hlID0gdGhpcy5fZ3JpZEZldGNoZXJCYXNlQ2FjaGVbZmV0Y2hEYXRhLmltYWdlUGFydFBhcmFtcy5sZXZlbF07XHJcblx0aWYgKCFsZXZlbENhY2hlKSB7XHJcblx0XHRsZXZlbENhY2hlID0gW107XHJcblx0XHR0aGlzLl9ncmlkRmV0Y2hlckJhc2VDYWNoZVtmZXRjaERhdGEuaW1hZ2VQYXJ0UGFyYW1zLmxldmVsXSA9IGxldmVsQ2FjaGU7XHJcblx0fVxyXG5cdFxyXG5cdHZhciB4Q2FjaGUgPSBsZXZlbENhY2hlW3RpbGVYXTtcclxuXHRpZiAoIXhDYWNoZSkge1xyXG5cdFx0eENhY2hlID0gW107XHJcblx0XHRsZXZlbENhY2hlW3RpbGVYXSA9IHhDYWNoZTtcclxuXHR9XHJcblx0XHJcblx0dmFyIGRlcGVuZEZldGNoZXMgPSB4Q2FjaGVbdGlsZVldO1xyXG5cdHZhciBpc1NpbmdsZSA9IGZhbHNlO1xyXG5cdGlmICghZGVwZW5kRmV0Y2hlcykge1xyXG5cdFx0ZGVwZW5kRmV0Y2hlcyA9IG5ldyBMaW5rZWRMaXN0KCk7XHJcblx0XHR4Q2FjaGVbdGlsZVldID0gZGVwZW5kRmV0Y2hlcztcclxuXHRcdCsrZmV0Y2hEYXRhLmFjdGl2ZVRpbGVzQ291bnRXaXRoU2luZ2xlTGlzdGVuZXI7XHJcblx0XHRpc1NpbmdsZSA9IHRydWU7XHJcblx0fVxyXG5cdFxyXG5cdGZldGNoRGF0YS50aWxlTGlzdGVuZXJzLnB1c2goe1xyXG5cdFx0ZGVwZW5kRmV0Y2hlczogZGVwZW5kRmV0Y2hlcyxcclxuXHRcdGl0ZXJhdG9yOiBkZXBlbmRGZXRjaGVzLmFkZChmZXRjaERhdGEpXHJcblx0fSk7XHJcblx0cmV0dXJuIGlzU2luZ2xlID8gZGVwZW5kRmV0Y2hlcyA6IG51bGw7XHJcbn07IiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxudmFyIEltYWdlQmFzZSA9IHJlcXVpcmUoJ2ltYWdlLWJhc2UuanMnKTtcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gR3JpZEltYWdlQmFzZTtcclxuXHJcbi8qIGdsb2JhbCBQcm9taXNlOiBmYWxzZSAqL1xyXG5cclxudmFyIEZFVENIX1dBSVRfVEFTSyA9IDA7XHJcbnZhciBERUNPREVfVEFTSyA9IDE7XHJcblxyXG5mdW5jdGlvbiBHcmlkSW1hZ2VCYXNlKGZldGNoZXIpIHtcclxuXHRJbWFnZUJhc2UuY2FsbCh0aGlzKTtcclxuXHRcclxuXHR0aGlzLl9mZXRjaGVyID0gZmV0Y2hlcjtcclxuXHR0aGlzLl9pbWFnZVBhcmFtcyA9IG51bGw7XHJcblx0dGhpcy5fd2FpdGluZ0ZldGNoZXMgPSB7fTtcclxuXHJcblx0dGhpcy5fZmV0Y2hlci5vbignZGF0YScsIHRoaXMuX29uRGF0YUZldGNoZWQuYmluZCh0aGlzKSk7XHJcblx0dGhpcy5fZmV0Y2hlci5vbigndGlsZS10ZXJtaW5hdGVkJywgdGhpcy5fb25UaWxlVGVybWluYXRlZC5iaW5kKHRoaXMpKTtcclxufVxyXG5cclxuR3JpZEltYWdlQmFzZS5wcm90b3R5cGUgPSBPYmplY3QuY3JlYXRlKEltYWdlQmFzZS5wcm90b3R5cGUpO1xyXG5cclxuR3JpZEltYWdlQmFzZS5wcm90b3R5cGUuZ2V0RGVjb2RlV29ya2VyVHlwZU9wdGlvbnMgPSBmdW5jdGlvbiBnZXREZWNvZGVXb3JrZXJUeXBlT3B0aW9ucygpIHtcclxuXHR0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBHcmlkSW1hZ2VCYXNlLmdldERlY29kZVdvcmtlclR5cGVPcHRpb25zIGlzIG5vdCBpbXBsZW1lbnRlZCBieSBpbmhlcml0b3InO1xyXG59O1xyXG5cclxuR3JpZEltYWdlQmFzZS5wcm90b3R5cGUuZ2V0RGVjb2RlcldvcmtlcnMgPSBmdW5jdGlvbiBnZXREZWNvZGVyV29ya2VycygpIHtcclxuXHR0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBHcmlkSW1hZ2VCYXNlLmdldERlY29kZXJXb3JrZXJzIGlzIG5vdCBpbXBsZW1lbnRlZCBieSBpbmhlcml0b3InO1xyXG59O1xyXG5cclxuR3JpZEltYWdlQmFzZS5wcm90b3R5cGUuZGVjb2RlVGFza1N0YXJ0ZWQgPSBmdW5jdGlvbiBkZWNvZGVUYXNrU3RhcnRlZCh0YXNrKSB7XHJcblx0dmFyIHNlbGYgPSB0aGlzO1xyXG5cdHRhc2sub24oJ2FsbERlcGVuZFRhc2tzVGVybWluYXRlZCcsIGZ1bmN0aW9uKCkge1xyXG5cdFx0c2VsZi5kYXRhUmVhZHlGb3JEZWNvZGUodGFzayk7XHJcblx0XHR0YXNrLnRlcm1pbmF0ZSgpO1xyXG5cdH0pO1xyXG59O1xyXG5cclxuR3JpZEltYWdlQmFzZS5wcm90b3R5cGUuZ2V0RmV0Y2hlciA9IGZ1bmN0aW9uIGdldEZldGNoZXIoKSB7XHJcblx0cmV0dXJuIHRoaXMuX2ZldGNoZXI7XHJcbn07XHJcblxyXG4vLyBsZXZlbCBjYWxjdWxhdGlvbnNcclxuXHJcbkdyaWRJbWFnZUJhc2UucHJvdG90eXBlLmdldExldmVsV2lkdGggPSBmdW5jdGlvbiBnZXRMZXZlbFdpZHRoKGxldmVsKSB7XHJcblx0dmFyIGltYWdlUGFyYW1zID0gdGhpcy5nZXRJbWFnZVBhcmFtcygpO1xyXG5cdHJldHVybiBpbWFnZVBhcmFtcy5pbWFnZVdpZHRoICogTWF0aC5wb3coMiwgbGV2ZWwgLSBpbWFnZVBhcmFtcy5pbWFnZUxldmVsKTtcclxufTtcclxuXHJcbkdyaWRJbWFnZUJhc2UucHJvdG90eXBlLmdldExldmVsSGVpZ2h0ID0gZnVuY3Rpb24gZ2V0TGV2ZWxIZWlnaHQobGV2ZWwpIHtcclxuXHR2YXIgaW1hZ2VQYXJhbXMgPSB0aGlzLmdldEltYWdlUGFyYW1zKCk7XHJcblx0cmV0dXJuIGltYWdlUGFyYW1zLmltYWdlSGVpZ2h0ICogTWF0aC5wb3coMiwgbGV2ZWwgLSBpbWFnZVBhcmFtcy5pbWFnZUxldmVsKTtcclxufTtcclxuXHJcbkdyaWRJbWFnZUJhc2UucHJvdG90eXBlLmdldExldmVsID0gZnVuY3Rpb24gZ2V0TGV2ZWwocmVnaW9uSW1hZ2VMZXZlbCkge1xyXG5cdHZhciBpbWFnZVBhcmFtcyA9IHRoaXMuZ2V0SW1hZ2VQYXJhbXMoKTtcclxuXHRcclxuXHR2YXIgbG9nMiA9IE1hdGgubG9nKDIpO1xyXG5cdHZhciBsZXZlbFggPSBNYXRoLmxvZyhyZWdpb25JbWFnZUxldmVsLnNjcmVlbldpZHRoICAvIChyZWdpb25JbWFnZUxldmVsLm1heFhFeGNsdXNpdmUgLSByZWdpb25JbWFnZUxldmVsLm1pblgpKSAvIGxvZzI7XHJcblx0dmFyIGxldmVsWSA9IE1hdGgubG9nKHJlZ2lvbkltYWdlTGV2ZWwuc2NyZWVuSGVpZ2h0IC8gKHJlZ2lvbkltYWdlTGV2ZWwubWF4WUV4Y2x1c2l2ZSAtIHJlZ2lvbkltYWdlTGV2ZWwubWluWSkpIC8gbG9nMjtcclxuXHR2YXIgbGV2ZWwgPSBNYXRoLmNlaWwoTWF0aC5taW4obGV2ZWxYLCBsZXZlbFkpKTtcclxuXHRsZXZlbCArPSBpbWFnZVBhcmFtcy5pbWFnZUxldmVsO1xyXG5cdFxyXG5cdHJldHVybiBsZXZlbDtcclxufTtcclxuXHJcbi8vIERlcGVuZGVuY3lXb3JrZXJzSW5wdXRSZXRyZWl2ZXIgaW1wbGVtZW50YXRpb25cclxuXHJcbkdyaWRJbWFnZUJhc2UucHJvdG90eXBlLmdldFdvcmtlclR5cGVPcHRpb25zID0gZnVuY3Rpb24odGFza1R5cGUpIHtcclxuXHRpZiAodGFza1R5cGUgPT09IEZFVENIX1dBSVRfVEFTSykge1xyXG5cdFx0cmV0dXJuIG51bGw7XHJcblx0fSBlbHNlIGlmICh0YXNrVHlwZSA9PT0gREVDT0RFX1RBU0spIHtcclxuXHRcdHJldHVybiB0aGlzLmdldERlY29kZVdvcmtlclR5cGVPcHRpb25zKCk7XHJcblx0fSBlbHNlIHtcclxuXHRcdHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgaW50ZXJuYWwgZXJyb3I6IEdyaWRJbWFnZUJhc2UuZ2V0VGFza1R5cGVPcHRpb25zIGdvdCB1bmV4cGVjdGVkIHRhc2sgdHlwZSAnICsgdGFza1R5cGU7XHJcblx0fVxyXG59O1xyXG5cclxuR3JpZEltYWdlQmFzZS5wcm90b3R5cGUuZ2V0S2V5QXNTdHJpbmcgPSBmdW5jdGlvbihrZXkpIHtcclxuXHRpZiAoa2V5LmZldGNoV2FpdFRhc2spIHtcclxuXHRcdHJldHVybiAnZmV0Y2hXYWl0OicgKyBrZXkudGlsZVggKyAnLCcgKyBrZXkudGlsZVkgKyAnOicgKyBrZXkubGV2ZWw7XHJcblx0fVxyXG5cdC8vIE90aGVyd2lzZSBpdCdzIGEgaW1hZ2VQYXJ0UGFyYW1zIGtleSBwYXNzZWQgYnkgaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGxpYi4gSnVzdCBjcmVhdGUgYSB1bmlxdWUgc3RyaW5nXHJcblx0cmV0dXJuIEpTT04uc3RyaW5naWZ5KGtleSk7XHJcbn07XHJcblxyXG5HcmlkSW1hZ2VCYXNlLnByb3RvdHlwZS50YXNrU3RhcnRlZCA9IGZ1bmN0aW9uKHRhc2spIHtcdFxyXG5cdHZhciBzZWxmID0gdGhpcztcclxuXHRcclxuXHRpZiAodGFzay5rZXkuZmV0Y2hXYWl0VGFzaykge1xyXG5cdFx0dmFyIHN0cktleSA9IHRoaXMuZ2V0S2V5QXNTdHJpbmcodGFzay5rZXkpO1xyXG5cdFx0dGhpcy5fd2FpdGluZ0ZldGNoZXNbc3RyS2V5XSA9IHRhc2s7XHJcblx0XHRyZXR1cm47XHJcblx0fVxyXG5cclxuXHRpZiAodGhpcy5faW1hZ2VQYXJhbXMgPT09IG51bGwpIHtcclxuXHRcdHRoaXMuX2ltYWdlUGFyYW1zID0gdGhpcy5nZXRJbWFnZVBhcmFtcygpOyAvLyBpbWFnZVBhcmFtcyB0aGF0IHJldHVybmVkIGJ5IGZldGNoZXIub3BlbigpXHJcblx0fVxyXG5cclxuXHR2YXIgaW1hZ2VQYXJ0UGFyYW1zID0gdGFzay5rZXk7XHJcblx0dmFyIHRpbGVzUmFuZ2UgPSBHcmlkSW1hZ2VCYXNlLmdldFRpbGVzUmFuZ2UodGhpcy5faW1hZ2VQYXJhbXMsIGltYWdlUGFydFBhcmFtcyk7XHJcblx0XHJcblx0dmFyIGkgPSAwO1xyXG5cdGZvciAodmFyIHRpbGVYID0gdGlsZXNSYW5nZS5taW5UaWxlWDsgdGlsZVggPCB0aWxlc1JhbmdlLm1heFRpbGVYOyArK3RpbGVYKSB7XHJcblx0XHRmb3IgKHZhciB0aWxlWSA9IHRpbGVzUmFuZ2UubWluVGlsZVk7IHRpbGVZIDwgdGlsZXNSYW5nZS5tYXhUaWxlWTsgKyt0aWxlWSkge1xyXG5cdFx0XHR0YXNrLnJlZ2lzdGVyVGFza0RlcGVuZGVuY3koe1xyXG5cdFx0XHRcdGZldGNoV2FpdFRhc2s6IHRydWUsXHJcblx0XHRcdFx0dGlsZVg6IHRpbGVYLFxyXG5cdFx0XHRcdHRpbGVZOiB0aWxlWSxcclxuXHRcdFx0XHRsZXZlbDogaW1hZ2VQYXJ0UGFyYW1zLmxldmVsXHJcblx0XHRcdH0pO1xyXG5cdFx0fVxyXG5cdH1cclxuXHRcclxuXHR0aGlzLmRlY29kZVRhc2tTdGFydGVkKHRhc2spO1xyXG59O1xyXG5cclxuR3JpZEltYWdlQmFzZS5wcm90b3R5cGUuZGF0YVJlYWR5Rm9yRGVjb2RlID0gZnVuY3Rpb24gZGF0YVJlYWR5Rm9yRGVjb2RlKHRhc2spIHtcclxuXHR0YXNrLmRhdGFSZWFkeSh7XHJcblx0XHR0aWxlQ29udGVudHM6IHRhc2suZGVwZW5kVGFza1Jlc3VsdHMsXHJcblx0XHR0aWxlSW5kaWNlczogdGFzay5kZXBlbmRUYXNrS2V5cyxcclxuXHRcdGltYWdlUGFydFBhcmFtczogdGFzay5rZXksXHJcblx0XHR0aWxlV2lkdGg6IHRoaXMuX2ltYWdlUGFyYW1zLnRpbGVXaWR0aCxcclxuXHRcdHRpbGVIZWlnaHQ6IHRoaXMuX2ltYWdlUGFyYW1zLnRpbGVIZWlnaHRcclxuXHR9LCBERUNPREVfVEFTSyk7XHJcbn07XHJcblxyXG4vLyBBdXhpbGlhcnkgbWV0aG9kc1xyXG5cclxuR3JpZEltYWdlQmFzZS5wcm90b3R5cGUuX29uRGF0YUZldGNoZWQgPSBmdW5jdGlvbihmZXRjaGVkVGlsZSkge1xyXG5cdHZhciBzdHJLZXkgPSB0aGlzLmdldEtleUFzU3RyaW5nKGZldGNoZWRUaWxlLnRpbGVLZXkpO1xyXG5cdHZhciB3YWl0aW5nVGFzayA9IHRoaXMuX3dhaXRpbmdGZXRjaGVzW3N0cktleV07XHJcblx0aWYgKHdhaXRpbmdUYXNrKSB7XHJcblx0XHR3YWl0aW5nVGFzay5kYXRhUmVhZHkoZmV0Y2hlZFRpbGUudGlsZUNvbnRlbnQsIEZFVENIX1dBSVRfVEFTSyk7XHJcblx0fVxyXG59O1xyXG5cclxuR3JpZEltYWdlQmFzZS5wcm90b3R5cGUuX29uVGlsZVRlcm1pbmF0ZWQgPSBmdW5jdGlvbih0aWxlS2V5KSB7XHJcblx0dmFyIHN0cktleSA9IHRoaXMuZ2V0S2V5QXNTdHJpbmcodGlsZUtleSk7XHJcblx0dmFyIHdhaXRpbmdUYXNrID0gdGhpcy5fd2FpdGluZ0ZldGNoZXNbc3RyS2V5XTtcclxuXHRpZiAod2FpdGluZ1Rhc2spIHtcclxuXHRcdHdhaXRpbmdUYXNrLnRlcm1pbmF0ZSgpO1xyXG5cdFx0dGhpcy5fd2FpdGluZ0ZldGNoZXNbc3RyS2V5XSA9IG51bGw7XHJcblx0fVxyXG59O1xyXG5cclxuR3JpZEltYWdlQmFzZS5nZXRUaWxlc1JhbmdlID0gZnVuY3Rpb24oaW1hZ2VQYXJhbXMsIGltYWdlUGFydFBhcmFtcykge1xyXG5cdHZhciBsZXZlbFdpZHRoICA9IGltYWdlUGFyYW1zLmltYWdlV2lkdGggICogTWF0aC5wb3coMiwgaW1hZ2VQYXJ0UGFyYW1zLmxldmVsIC0gaW1hZ2VQYXJhbXMuaW1hZ2VMZXZlbCk7XHJcblx0dmFyIGxldmVsSGVpZ2h0ID0gaW1hZ2VQYXJhbXMuaW1hZ2VIZWlnaHQgKiBNYXRoLnBvdygyLCBpbWFnZVBhcnRQYXJhbXMubGV2ZWwgLSBpbWFnZVBhcmFtcy5pbWFnZUxldmVsKTtcclxuXHR2YXIgbGV2ZWxUaWxlc1ggPSBNYXRoLmNlaWwobGV2ZWxXaWR0aCAgLyBpbWFnZVBhcmFtcy50aWxlV2lkdGggKTtcclxuXHR2YXIgbGV2ZWxUaWxlc1kgPSBNYXRoLmNlaWwobGV2ZWxIZWlnaHQgLyBpbWFnZVBhcmFtcy50aWxlSGVpZ2h0KTtcclxuXHRyZXR1cm4ge1xyXG5cdFx0bWluVGlsZVg6IE1hdGgubWF4KDAsIE1hdGguZmxvb3IoaW1hZ2VQYXJ0UGFyYW1zLm1pblggLyBpbWFnZVBhcmFtcy50aWxlV2lkdGggKSksXHJcblx0XHRtaW5UaWxlWTogTWF0aC5tYXgoMCwgTWF0aC5mbG9vcihpbWFnZVBhcnRQYXJhbXMubWluWSAvIGltYWdlUGFyYW1zLnRpbGVIZWlnaHQpKSxcclxuXHRcdG1heFRpbGVYOiBNYXRoLm1pbihsZXZlbFRpbGVzWCwgTWF0aC5jZWlsKGltYWdlUGFydFBhcmFtcy5tYXhYRXhjbHVzaXZlIC8gaW1hZ2VQYXJhbXMudGlsZVdpZHRoICkpLFxyXG5cdFx0bWF4VGlsZVk6IE1hdGgubWluKGxldmVsVGlsZXNZLCBNYXRoLmNlaWwoaW1hZ2VQYXJ0UGFyYW1zLm1heFlFeGNsdXNpdmUgLyBpbWFnZVBhcmFtcy50aWxlSGVpZ2h0KSlcclxuXHR9O1xyXG59O1xyXG4iXX0=
