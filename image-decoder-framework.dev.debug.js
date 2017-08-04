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
        
        var currentStackFrameRegex = /at (|[^ ]+ \()([^ ]+):\d+:\d+/;
        var source = currentStackFrameRegex.exec(stack);
        if (source && source[2] !== "") {
            return source[2];
        }

        var lastStackFrameRegex = new RegExp(/.+\/(.*?):\d+(:\d+)*$/);
        source = lastStackFrameRegex.exec(stack);
        if (source && source[1] !== "") {
            return source[1];
        }
        
        if (errorWithStackTrace.fileName !== undefined) {
            return errorWithStackTrace.fileName;
        }
        
        throw 'ImageDecoderFramework.js: Could not get current script URL';
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJzcmMvYXN5bmMtcHJveHktZXhwb3J0cy5qcyIsInNyYy9hc3luYy1wcm94eS1mYWN0b3J5LmpzIiwic3JjL2FzeW5jLXByb3h5LW1hc3Rlci5qcyIsInNyYy9hc3luYy1wcm94eS1zbGF2ZS5qcyIsInNyYy9zY3JpcHRzLXRvLUltcG9ydC1Qb29sLmpzIiwic3JjL3N1Yi13b3JrZXItZW11bGF0aW9uLWZvci1jaHJvbWUuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7QUNBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1BBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDOUZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzFVQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM5TkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7OztBQzFEQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBIiwiZmlsZSI6ImdlbmVyYXRlZC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzQ29udGVudCI6WyIoZnVuY3Rpb24gZSh0LG4scil7ZnVuY3Rpb24gcyhvLHUpe2lmKCFuW29dKXtpZighdFtvXSl7dmFyIGE9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtpZighdSYmYSlyZXR1cm4gYShvLCEwKTtpZihpKXJldHVybiBpKG8sITApO3ZhciBmPW5ldyBFcnJvcihcIkNhbm5vdCBmaW5kIG1vZHVsZSAnXCIrbytcIidcIik7dGhyb3cgZi5jb2RlPVwiTU9EVUxFX05PVF9GT1VORFwiLGZ9dmFyIGw9bltvXT17ZXhwb3J0czp7fX07dFtvXVswXS5jYWxsKGwuZXhwb3J0cyxmdW5jdGlvbihlKXt2YXIgbj10W29dWzFdW2VdO3JldHVybiBzKG4/bjplKX0sbCxsLmV4cG9ydHMsZSx0LG4scil9cmV0dXJuIG5bb10uZXhwb3J0c312YXIgaT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2Zvcih2YXIgbz0wO288ci5sZW5ndGg7bysrKXMocltvXSk7cmV0dXJuIHN9KSIsIid1c2Ugc3RyaWN0JztcclxuXHJcbm1vZHVsZS5leHBvcnRzLlN1YldvcmtlckVtdWxhdGlvbkZvckNocm9tZSA9IHJlcXVpcmUoJ3N1Yi13b3JrZXItZW11bGF0aW9uLWZvci1jaHJvbWUnKTtcclxubW9kdWxlLmV4cG9ydHMuQXN5bmNQcm94eUZhY3RvcnkgPSByZXF1aXJlKCdhc3luYy1wcm94eS1mYWN0b3J5Jyk7XHJcbm1vZHVsZS5leHBvcnRzLkFzeW5jUHJveHlTbGF2ZSA9IHJlcXVpcmUoJ2FzeW5jLXByb3h5LXNsYXZlJyk7XHJcbm1vZHVsZS5leHBvcnRzLkFzeW5jUHJveHlNYXN0ZXIgPSByZXF1aXJlKCdhc3luYy1wcm94eS1tYXN0ZXInKTtcclxubW9kdWxlLmV4cG9ydHMuU2NyaXB0c1RvSW1wb3J0UG9vbCA9IHJlcXVpcmUoJ3NjcmlwdHMtdG8tSW1wb3J0LVBvb2wnKTtcclxuIiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxudmFyIEFzeW5jUHJveHlNYXN0ZXIgPSByZXF1aXJlKCdhc3luYy1wcm94eS1tYXN0ZXInKTtcclxuXHJcbnZhciBBc3luY1Byb3h5RmFjdG9yeSA9IChmdW5jdGlvbiBBc3luY1Byb3h5RmFjdG9yeUNsb3N1cmUoKSB7XHJcbiAgICB2YXIgZmFjdG9yeVNpbmdsZXRvbiA9IHt9O1xyXG5cdFxyXG5cdGZhY3RvcnlTaW5nbGV0b24uY3JlYXRlID0gZnVuY3Rpb24gY3JlYXRlKHNjcmlwdHNUb0ltcG9ydCwgY3Rvck5hbWUsIG1ldGhvZHMsIHByb3h5Q3Rvcikge1xyXG5cdFx0aWYgKCghc2NyaXB0c1RvSW1wb3J0KSB8fCAhKHNjcmlwdHNUb0ltcG9ydC5sZW5ndGgpKSB7XHJcblx0XHRcdHRocm93ICdBc3luY1Byb3h5RmFjdG9yeSBlcnJvcjogbWlzc2luZyBzY3JpcHRzVG9JbXBvcnQgKDJuZCBhcmd1bWVudCknO1xyXG5cdFx0fVxyXG5cdFx0XHJcblx0XHR2YXIgUHJveHlDbGFzcyA9IHByb3h5Q3RvciB8fCBmdW5jdGlvbigpIHtcclxuXHRcdFx0dmFyIGN0b3JBcmdzID0gZmFjdG9yeVNpbmdsZXRvbi5jb252ZXJ0QXJncyhhcmd1bWVudHMpO1xyXG5cdFx0XHRmYWN0b3J5U2luZ2xldG9uLmluaXRpYWxpemUodGhpcywgc2NyaXB0c1RvSW1wb3J0LCBjdG9yTmFtZSwgY3RvckFyZ3MpO1xyXG5cdFx0fTtcclxuXHRcdFxyXG5cdFx0aWYgKG1ldGhvZHMpIHtcclxuXHRcdFx0ZmFjdG9yeVNpbmdsZXRvbi5hZGRNZXRob2RzKFByb3h5Q2xhc3MsIG1ldGhvZHMpO1xyXG5cdFx0fVxyXG5cdFx0XHJcblx0XHRyZXR1cm4gUHJveHlDbGFzcztcclxuXHR9O1xyXG5cdFxyXG5cdGZhY3RvcnlTaW5nbGV0b24uYWRkTWV0aG9kcyA9IGZ1bmN0aW9uIGFkZE1ldGhvZHMoUHJveHlDbGFzcywgbWV0aG9kcykge1xyXG5cdFx0Zm9yICh2YXIgbWV0aG9kTmFtZSBpbiBtZXRob2RzKSB7XHJcblx0XHRcdGdlbmVyYXRlTWV0aG9kKFByb3h5Q2xhc3MsIG1ldGhvZE5hbWUsIG1ldGhvZHNbbWV0aG9kTmFtZV0gfHwgW10pO1xyXG5cdFx0fVxyXG5cdFx0XHJcblx0XHRyZXR1cm4gUHJveHlDbGFzcztcclxuXHR9O1xyXG5cdFxyXG5cdGZ1bmN0aW9uIGdlbmVyYXRlTWV0aG9kKFByb3h5Q2xhc3MsIG1ldGhvZE5hbWUsIG1ldGhvZEFyZ3NEZXNjcmlwdGlvbikge1xyXG5cdFx0dmFyIG1ldGhvZE9wdGlvbnMgPSBtZXRob2RBcmdzRGVzY3JpcHRpb25bMF0gfHwge307XHJcblx0XHRQcm94eUNsYXNzLnByb3RvdHlwZVttZXRob2ROYW1lXSA9IGZ1bmN0aW9uIGdlbmVyYXRlZEZ1bmN0aW9uKCkge1xyXG5cdFx0XHR2YXIgd29ya2VySGVscGVyID0gZmFjdG9yeVNpbmdsZXRvbi5nZXRXb3JrZXJIZWxwZXIodGhpcyk7XHJcblx0XHRcdHZhciBhcmdzVG9TZW5kID0gW107XHJcblx0XHRcdGZvciAodmFyIGkgPSAwOyBpIDwgYXJndW1lbnRzLmxlbmd0aDsgKytpKSB7XHJcblx0XHRcdFx0dmFyIGFyZ0Rlc2NyaXB0aW9uID0gbWV0aG9kQXJnc0Rlc2NyaXB0aW9uW2kgKyAxXTtcclxuXHRcdFx0XHR2YXIgYXJnVmFsdWUgPSBhcmd1bWVudHNbaV07XHJcblx0XHRcdFx0XHJcblx0XHRcdFx0aWYgKGFyZ0Rlc2NyaXB0aW9uID09PSAnY2FsbGJhY2snKSB7XHJcblx0XHRcdFx0XHRhcmdzVG9TZW5kW2ldID0gd29ya2VySGVscGVyLndyYXBDYWxsYmFjayhhcmdWYWx1ZSk7XHJcblx0XHRcdFx0fSBlbHNlIGlmICghYXJnRGVzY3JpcHRpb24pIHtcclxuXHRcdFx0XHRcdGFyZ3NUb1NlbmRbaV0gPSBhcmdWYWx1ZTtcclxuXHRcdFx0XHR9IGVsc2Uge1xyXG5cdFx0XHRcdFx0dGhyb3cgJ0FzeW5jUHJveHlGYWN0b3J5IGVycm9yOiBVbnJlY29nbml6ZWQgYXJndW1lbnQgJyArXHJcblx0XHRcdFx0XHRcdCdkZXNjcmlwdGlvbiAnICsgYXJnRGVzY3JpcHRpb24gKyAnIGluIGFyZ3VtZW50ICcgK1xyXG5cdFx0XHRcdFx0XHQoaSArIDEpICsgJyBvZiBtZXRob2QgJyArIG1ldGhvZE5hbWU7XHJcblx0XHRcdFx0fVxyXG5cdFx0XHR9XHJcblx0XHRcdHJldHVybiB3b3JrZXJIZWxwZXIuY2FsbEZ1bmN0aW9uKFxyXG5cdFx0XHRcdG1ldGhvZE5hbWUsIGFyZ3NUb1NlbmQsIG1ldGhvZEFyZ3NEZXNjcmlwdGlvblswXSk7XHJcblx0XHR9O1xyXG5cdH1cclxuXHRcclxuXHRmYWN0b3J5U2luZ2xldG9uLmluaXRpYWxpemUgPSBmdW5jdGlvbiBpbml0aWFsaXplKHByb3h5SW5zdGFuY2UsIHNjcmlwdHNUb0ltcG9ydCwgY3Rvck5hbWUsIGN0b3JBcmdzKSB7XHJcblx0XHRpZiAocHJveHlJbnN0YW5jZS5fX3dvcmtlckhlbHBlckluaXRBcmdzKSB7XHJcblx0XHRcdHRocm93ICdhc3luY1Byb3h5IGVycm9yOiBEb3VibGUgaW5pdGlhbGl6YXRpb24gb2YgQXN5bmNQcm94eSBtYXN0ZXInO1xyXG5cdFx0fVxyXG5cdFx0cHJveHlJbnN0YW5jZS5fX3dvcmtlckhlbHBlckluaXRBcmdzID0ge1xyXG5cdFx0XHRzY3JpcHRzVG9JbXBvcnQ6IHNjcmlwdHNUb0ltcG9ydCxcclxuXHRcdFx0Y3Rvck5hbWU6IGN0b3JOYW1lLFxyXG5cdFx0XHRjdG9yQXJnczogY3RvckFyZ3NcclxuXHRcdH07XHJcblx0fTtcclxuXHRcclxuXHRmYWN0b3J5U2luZ2xldG9uLmNvbnZlcnRBcmdzID0gZnVuY3Rpb24gY29udmVydEFyZ3MoYXJnc09iamVjdCkge1xyXG5cdFx0dmFyIGFyZ3MgPSBuZXcgQXJyYXkoYXJnc09iamVjdC5sZW5ndGgpO1xyXG5cdFx0Zm9yICh2YXIgaSA9IDA7IGkgPCBhcmdzT2JqZWN0Lmxlbmd0aDsgKytpKSB7XHJcblx0XHRcdGFyZ3NbaV0gPSBhcmdzT2JqZWN0W2ldO1xyXG5cdFx0fVxyXG5cdFx0XHJcblx0XHRyZXR1cm4gYXJncztcclxuXHR9O1xyXG4gICAgXHJcblx0ZmFjdG9yeVNpbmdsZXRvbi5nZXRXb3JrZXJIZWxwZXIgPSBmdW5jdGlvbiBnZXRXb3JrZXJIZWxwZXIocHJveHlJbnN0YW5jZSkge1xyXG5cdFx0aWYgKCFwcm94eUluc3RhbmNlLl9fd29ya2VySGVscGVyKSB7XHJcblx0XHRcdGlmICghcHJveHlJbnN0YW5jZS5fX3dvcmtlckhlbHBlckluaXRBcmdzKSB7XHJcblx0XHRcdFx0dGhyb3cgJ2FzeW5jUHJveHkgZXJyb3I6IGFzeW5jUHJveHlGYWN0b3J5LmluaXRpYWxpemUoKSBub3QgY2FsbGVkIHlldCc7XHJcblx0XHRcdH1cclxuXHRcdFx0XHJcblx0XHRcdHByb3h5SW5zdGFuY2UuX193b3JrZXJIZWxwZXIgPSBuZXcgQXN5bmNQcm94eU1hc3RlcihcclxuXHRcdFx0XHRwcm94eUluc3RhbmNlLl9fd29ya2VySGVscGVySW5pdEFyZ3Muc2NyaXB0c1RvSW1wb3J0LFxyXG5cdFx0XHRcdHByb3h5SW5zdGFuY2UuX193b3JrZXJIZWxwZXJJbml0QXJncy5jdG9yTmFtZSxcclxuXHRcdFx0XHRwcm94eUluc3RhbmNlLl9fd29ya2VySGVscGVySW5pdEFyZ3MuY3RvckFyZ3MgfHwgW10pO1xyXG5cdFx0fVxyXG5cdFx0XHJcblx0XHRyZXR1cm4gcHJveHlJbnN0YW5jZS5fX3dvcmtlckhlbHBlcjtcclxuXHR9O1xyXG5cclxuICAgIHJldHVybiBmYWN0b3J5U2luZ2xldG9uO1xyXG59KSgpO1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBBc3luY1Byb3h5RmFjdG9yeTsiLCIndXNlIHN0cmljdCc7XHJcblxyXG4vKiBnbG9iYWwgUHJvbWlzZTogZmFsc2UgKi9cclxuXHJcbnZhciBTY3JpcHRzVG9JbXBvcnRQb29sID0gcmVxdWlyZSgnc2NyaXB0cy10by1pbXBvcnQtcG9vbCcpO1xyXG5cclxudmFyIEFzeW5jUHJveHlNYXN0ZXIgPSAoZnVuY3Rpb24gQXN5bmNQcm94eU1hc3RlckNsb3N1cmUoKSB7XHJcbiAgICB2YXIgY2FsbElkID0gMDtcclxuICAgIHZhciBpc0dldE1hc3RlckVudHJ5VXJsQ2FsbGVkID0gZmFsc2U7XHJcbiAgICB2YXIgbWFzdGVyRW50cnlVcmwgPSBnZXRCYXNlVXJsRnJvbUVudHJ5U2NyaXB0KCk7XHJcbiAgICBcclxuICAgIGZ1bmN0aW9uIEFzeW5jUHJveHlNYXN0ZXIoc2NyaXB0c1RvSW1wb3J0LCBjdG9yTmFtZSwgY3RvckFyZ3MsIG9wdGlvbnMpIHtcclxuICAgICAgICB2YXIgdGhhdCA9IHRoaXM7XHJcbiAgICAgICAgb3B0aW9ucyA9IG9wdGlvbnMgfHwge307XHJcbiAgICAgICAgXHJcbiAgICAgICAgdGhhdC5fY2FsbGJhY2tzID0gW107XHJcbiAgICAgICAgdGhhdC5fcGVuZGluZ1Byb21pc2VDYWxscyA9IFtdO1xyXG4gICAgICAgIHRoYXQuX3N1YldvcmtlckJ5SWQgPSBbXTtcclxuICAgICAgICB0aGF0Ll9zdWJXb3JrZXJzID0gW107XHJcbiAgICAgICAgdGhhdC5fdXNlckRhdGFIYW5kbGVyID0gbnVsbDtcclxuICAgICAgICB0aGF0Ll9ub3RSZXR1cm5lZEZ1bmN0aW9ucyA9IDA7XHJcbiAgICAgICAgdGhhdC5fZnVuY3Rpb25zQnVmZmVyU2l6ZSA9IG9wdGlvbnMuZnVuY3Rpb25zQnVmZmVyU2l6ZSB8fCA1O1xyXG4gICAgICAgIHRoYXQuX3BlbmRpbmdNZXNzYWdlcyA9IFtdO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHZhciBzY3JpcHROYW1lID0gZ2V0U2NyaXB0TmFtZSgpO1xyXG4gICAgICAgIHZhciBzbGF2ZVNjcmlwdENvbnRlbnRTdHJpbmcgPSBtYWluU2xhdmVTY3JpcHRDb250ZW50LnRvU3RyaW5nKCk7XHJcbiAgICAgICAgc2xhdmVTY3JpcHRDb250ZW50U3RyaW5nID0gc2xhdmVTY3JpcHRDb250ZW50U3RyaW5nLnJlcGxhY2UoXHJcbiAgICAgICAgICAgICdTQ1JJUFRfUExBQ0VIT0xERVInLCBzY3JpcHROYW1lKTtcclxuICAgICAgICB2YXIgc2xhdmVTY3JpcHRDb250ZW50QmxvYiA9IG5ldyBCbG9iKFxyXG4gICAgICAgICAgICBbJygnLCBzbGF2ZVNjcmlwdENvbnRlbnRTdHJpbmcsICcpKCknXSxcclxuICAgICAgICAgICAgeyB0eXBlOiAnYXBwbGljYXRpb24vamF2YXNjcmlwdCcgfSk7XHJcbiAgICAgICAgdmFyIHNsYXZlU2NyaXB0VXJsID0gVVJMLmNyZWF0ZU9iamVjdFVSTChzbGF2ZVNjcmlwdENvbnRlbnRCbG9iKTtcclxuXHJcbiAgICAgICAgdGhhdC5fd29ya2VyID0gbmV3IFdvcmtlcihzbGF2ZVNjcmlwdFVybCk7XHJcbiAgICAgICAgdGhhdC5fd29ya2VyLm9ubWVzc2FnZSA9IG9uV29ya2VyTWVzc2FnZUludGVybmFsO1xyXG5cclxuICAgICAgICB0aGF0Ll93b3JrZXIucG9zdE1lc3NhZ2Uoe1xyXG4gICAgICAgICAgICBmdW5jdGlvblRvQ2FsbDogJ2N0b3InLFxyXG4gICAgICAgICAgICBzY3JpcHRzVG9JbXBvcnQ6IHNjcmlwdHNUb0ltcG9ydCxcclxuICAgICAgICAgICAgY3Rvck5hbWU6IGN0b3JOYW1lLFxyXG4gICAgICAgICAgICBhcmdzOiBjdG9yQXJncyxcclxuICAgICAgICAgICAgY2FsbElkOiArK2NhbGxJZCxcclxuICAgICAgICAgICAgaXNQcm9taXNlOiBmYWxzZSxcclxuICAgICAgICAgICAgbWFzdGVyRW50cnlVcmw6IEFzeW5jUHJveHlNYXN0ZXIuZ2V0RW50cnlVcmwoKVxyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGZ1bmN0aW9uIG9uV29ya2VyTWVzc2FnZUludGVybmFsKHdvcmtlckV2ZW50KSB7XHJcbiAgICAgICAgICAgIG9uV29ya2VyTWVzc2FnZSh0aGF0LCB3b3JrZXJFdmVudCk7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgXHJcbiAgICBBc3luY1Byb3h5TWFzdGVyLnByb3RvdHlwZS5zZXRVc2VyRGF0YUhhbmRsZXIgPSBmdW5jdGlvbiBzZXRVc2VyRGF0YUhhbmRsZXIodXNlckRhdGFIYW5kbGVyKSB7XHJcbiAgICAgICAgdGhpcy5fdXNlckRhdGFIYW5kbGVyID0gdXNlckRhdGFIYW5kbGVyO1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgQXN5bmNQcm94eU1hc3Rlci5wcm90b3R5cGUudGVybWluYXRlID0gZnVuY3Rpb24gdGVybWluYXRlKCkge1xyXG4gICAgICAgIHRoaXMuX3dvcmtlci50ZXJtaW5hdGUoKTtcclxuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IHRoaXMuX3N1YldvcmtlcnMubGVuZ3RoOyArK2kpIHtcclxuICAgICAgICAgICAgdGhpcy5fc3ViV29ya2Vyc1tpXS50ZXJtaW5hdGUoKTtcclxuICAgICAgICB9XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBBc3luY1Byb3h5TWFzdGVyLnByb3RvdHlwZS5jYWxsRnVuY3Rpb24gPSBmdW5jdGlvbiBjYWxsRnVuY3Rpb24oZnVuY3Rpb25Ub0NhbGwsIGFyZ3MsIG9wdGlvbnMpIHtcclxuICAgICAgICBvcHRpb25zID0gb3B0aW9ucyB8fCB7fTtcclxuICAgICAgICB2YXIgaXNSZXR1cm5Qcm9taXNlID0gISFvcHRpb25zLmlzUmV0dXJuUHJvbWlzZTtcclxuICAgICAgICB2YXIgdHJhbnNmZXJhYmxlc0FyZyA9IG9wdGlvbnMudHJhbnNmZXJhYmxlcyB8fCBbXTtcclxuICAgICAgICB2YXIgcGF0aHNUb1RyYW5zZmVyYWJsZXMgPVxyXG4gICAgICAgICAgICBvcHRpb25zLnBhdGhzVG9UcmFuc2ZlcmFibGVzSW5Qcm9taXNlUmVzdWx0O1xyXG4gICAgICAgIFxyXG4gICAgICAgIHZhciBsb2NhbENhbGxJZCA9ICsrY2FsbElkO1xyXG4gICAgICAgIHZhciBwcm9taXNlT25NYXN0ZXJTaWRlID0gbnVsbDtcclxuICAgICAgICB2YXIgdGhhdCA9IHRoaXM7XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKGlzUmV0dXJuUHJvbWlzZSkge1xyXG4gICAgICAgICAgICBwcm9taXNlT25NYXN0ZXJTaWRlID0gbmV3IFByb21pc2UoZnVuY3Rpb24gcHJvbWlzZUZ1bmMocmVzb2x2ZSwgcmVqZWN0KSB7XHJcbiAgICAgICAgICAgICAgICB0aGF0Ll9wZW5kaW5nUHJvbWlzZUNhbGxzW2xvY2FsQ2FsbElkXSA9IHtcclxuICAgICAgICAgICAgICAgICAgICByZXNvbHZlOiByZXNvbHZlLFxyXG4gICAgICAgICAgICAgICAgICAgIHJlamVjdDogcmVqZWN0XHJcbiAgICAgICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgdmFyIHNlbmRNZXNzYWdlRnVuY3Rpb24gPSBvcHRpb25zLmlzU2VuZEltbWVkaWF0ZWx5ID9cclxuICAgICAgICAgICAgc2VuZE1lc3NhZ2VUb1NsYXZlOiBlbnF1ZXVlTWVzc2FnZVRvU2xhdmU7XHJcblx0XHRcclxuXHRcdHZhciB0cmFuc2ZlcmFibGVzO1xyXG5cdFx0aWYgKHR5cGVvZiB0cmFuc2ZlcmFibGVzQXJnID09PSAnZnVuY3Rpb24nKSB7XHJcblx0XHRcdHRyYW5zZmVyYWJsZXMgPSB0cmFuc2ZlcmFibGVzQXJnKCk7XHJcblx0XHR9IGVsc2Uge1xyXG5cdFx0XHR0cmFuc2ZlcmFibGVzID0gQXN5bmNQcm94eU1hc3Rlci5fZXh0cmFjdFRyYW5zZmVyYWJsZXMoXHJcblx0XHRcdFx0dHJhbnNmZXJhYmxlc0FyZywgYXJncyk7XHJcblx0XHR9XHJcbiAgICAgICAgXHJcbiAgICAgICAgc2VuZE1lc3NhZ2VGdW5jdGlvbih0aGlzLCB0cmFuc2ZlcmFibGVzLCAvKmlzRnVuY3Rpb25DYWxsPSovdHJ1ZSwge1xyXG4gICAgICAgICAgICBmdW5jdGlvblRvQ2FsbDogZnVuY3Rpb25Ub0NhbGwsXHJcbiAgICAgICAgICAgIGFyZ3M6IGFyZ3MgfHwgW10sXHJcbiAgICAgICAgICAgIGNhbGxJZDogbG9jYWxDYWxsSWQsXHJcbiAgICAgICAgICAgIGlzUHJvbWlzZTogaXNSZXR1cm5Qcm9taXNlLFxyXG4gICAgICAgICAgICBwYXRoc1RvVHJhbnNmZXJhYmxlc0luUHJvbWlzZVJlc3VsdCA6IHBhdGhzVG9UcmFuc2ZlcmFibGVzXHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKGlzUmV0dXJuUHJvbWlzZSkge1xyXG4gICAgICAgICAgICByZXR1cm4gcHJvbWlzZU9uTWFzdGVyU2lkZTtcclxuICAgICAgICB9XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBBc3luY1Byb3h5TWFzdGVyLnByb3RvdHlwZS53cmFwQ2FsbGJhY2sgPSBmdW5jdGlvbiB3cmFwQ2FsbGJhY2soXHJcbiAgICAgICAgY2FsbGJhY2ssIGNhbGxiYWNrTmFtZSwgb3B0aW9ucykge1xyXG4gICAgICAgIFxyXG4gICAgICAgIG9wdGlvbnMgPSBvcHRpb25zIHx8IHt9O1xyXG4gICAgICAgIHZhciBsb2NhbENhbGxJZCA9ICsrY2FsbElkO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHZhciBjYWxsYmFja0hhbmRsZSA9IHtcclxuICAgICAgICAgICAgaXNXb3JrZXJIZWxwZXJDYWxsYmFjazogdHJ1ZSxcclxuICAgICAgICAgICAgaXNNdWx0aXBsZVRpbWVDYWxsYmFjazogISFvcHRpb25zLmlzTXVsdGlwbGVUaW1lQ2FsbGJhY2ssXHJcbiAgICAgICAgICAgIGNhbGxJZDogbG9jYWxDYWxsSWQsXHJcbiAgICAgICAgICAgIGNhbGxiYWNrTmFtZTogY2FsbGJhY2tOYW1lLFxyXG4gICAgICAgICAgICBwYXRoc1RvVHJhbnNmZXJhYmxlczogb3B0aW9ucy5wYXRoc1RvVHJhbnNmZXJhYmxlc1xyXG4gICAgICAgIH07XHJcbiAgICAgICAgXHJcbiAgICAgICAgdmFyIGludGVybmFsQ2FsbGJhY2tIYW5kbGUgPSB7XHJcbiAgICAgICAgICAgIGlzTXVsdGlwbGVUaW1lQ2FsbGJhY2s6ICEhb3B0aW9ucy5pc011bHRpcGxlVGltZUNhbGxiYWNrLFxyXG4gICAgICAgICAgICBjYWxsSWQ6IGxvY2FsQ2FsbElkLFxyXG4gICAgICAgICAgICBjYWxsYmFjazogY2FsbGJhY2ssXHJcbiAgICAgICAgICAgIHBhdGhzVG9UcmFuc2ZlcmFibGVzOiBvcHRpb25zLnBhdGhzVG9UcmFuc2ZlcmFibGVzXHJcbiAgICAgICAgfTtcclxuICAgICAgICBcclxuICAgICAgICB0aGlzLl9jYWxsYmFja3NbbG9jYWxDYWxsSWRdID0gaW50ZXJuYWxDYWxsYmFja0hhbmRsZTtcclxuICAgICAgICBcclxuICAgICAgICByZXR1cm4gY2FsbGJhY2tIYW5kbGU7XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBBc3luY1Byb3h5TWFzdGVyLnByb3RvdHlwZS5mcmVlQ2FsbGJhY2sgPSBmdW5jdGlvbiBmcmVlQ2FsbGJhY2soY2FsbGJhY2tIYW5kbGUpIHtcclxuICAgICAgICBkZWxldGUgdGhpcy5fY2FsbGJhY2tzW2NhbGxiYWNrSGFuZGxlLmNhbGxJZF07XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICAvLyBTdGF0aWMgZnVuY3Rpb25zXHJcbiAgICBcclxuICAgIEFzeW5jUHJveHlNYXN0ZXIuZ2V0RW50cnlVcmwgPSBmdW5jdGlvbiBnZXRFbnRyeVVybCgpIHtcclxuICAgICAgICBpc0dldE1hc3RlckVudHJ5VXJsQ2FsbGVkID0gdHJ1ZTtcclxuICAgICAgICByZXR1cm4gbWFzdGVyRW50cnlVcmw7XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBBc3luY1Byb3h5TWFzdGVyLl9zZXRFbnRyeVVybCA9IGZ1bmN0aW9uIHNldEVudHJ5VXJsKG5ld1VybCkge1xyXG4gICAgICAgIGlmIChtYXN0ZXJFbnRyeVVybCAhPT0gbmV3VXJsICYmIGlzR2V0TWFzdGVyRW50cnlVcmxDYWxsZWQpIHtcclxuICAgICAgICAgICAgdGhyb3cgJ1ByZXZpb3VzIHZhbHVlcyByZXR1cm5lZCBmcm9tIGdldE1hc3RlckVudHJ5VXJsICcgK1xyXG4gICAgICAgICAgICAgICAgJ2lzIHdyb25nLiBBdm9pZCBjYWxsaW5nIGl0IHdpdGhpbiB0aGUgc2xhdmUgY2B0b3InO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgbWFzdGVyRW50cnlVcmwgPSBuZXdVcmw7XHJcbiAgICB9O1xyXG5cdFxyXG5cdEFzeW5jUHJveHlNYXN0ZXIuX2V4dHJhY3RUcmFuc2ZlcmFibGVzID0gZnVuY3Rpb24gZXh0cmFjdFRyYW5zZmVyYWJsZXMoXHJcblx0XHRcdHBhdGhzVG9UcmFuc2ZlcmFibGVzLCBwYXRoc0Jhc2UpIHtcclxuXHRcdFxyXG4gICAgICAgIGlmIChwYXRoc1RvVHJhbnNmZXJhYmxlcyA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgICAgIHJldHVybiB1bmRlZmluZWQ7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHZhciB0cmFuc2ZlcmFibGVzID0gbmV3IEFycmF5KHBhdGhzVG9UcmFuc2ZlcmFibGVzLmxlbmd0aCk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBwYXRoc1RvVHJhbnNmZXJhYmxlcy5sZW5ndGg7ICsraSkge1xyXG4gICAgICAgICAgICB2YXIgcGF0aCA9IHBhdGhzVG9UcmFuc2ZlcmFibGVzW2ldO1xyXG4gICAgICAgICAgICB2YXIgdHJhbnNmZXJhYmxlID0gcGF0aHNCYXNlO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgZm9yICh2YXIgaiA9IDA7IGogPCBwYXRoLmxlbmd0aDsgKytqKSB7XHJcbiAgICAgICAgICAgICAgICB2YXIgbWVtYmVyID0gcGF0aFtqXTtcclxuICAgICAgICAgICAgICAgIHRyYW5zZmVyYWJsZSA9IHRyYW5zZmVyYWJsZVttZW1iZXJdO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICB0cmFuc2ZlcmFibGVzW2ldID0gdHJhbnNmZXJhYmxlO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICByZXR1cm4gdHJhbnNmZXJhYmxlcztcclxuICAgIH07XHJcbiAgICBcclxuICAgIC8vIFByaXZhdGUgZnVuY3Rpb25zXHJcblx0XHJcblx0ZnVuY3Rpb24gZ2V0U2NyaXB0TmFtZSgpIHtcclxuICAgICAgICB2YXIgZXJyb3IgPSBuZXcgRXJyb3IoKTtcclxuXHRcdHJldHVybiBTY3JpcHRzVG9JbXBvcnRQb29sLl9nZXRTY3JpcHROYW1lKGVycm9yKTtcclxuXHR9XHJcbiAgICBcclxuICAgIGZ1bmN0aW9uIG1haW5TbGF2ZVNjcmlwdENvbnRlbnQoKSB7XHJcblx0XHQvLyBUaGlzIGZ1bmN0aW9uIGlzIG5vdCBydW4gZGlyZWN0bHk6IEl0IGNvcGllZCBhcyBhIHN0cmluZyBpbnRvIGEgYmxvYlxyXG5cdFx0Ly8gYW5kIHJ1biBpbiB0aGUgV2ViIFdvcmtlciBnbG9iYWwgc2NvcGVcclxuXHRcdFxyXG5cdFx0LyogZ2xvYmFsIGltcG9ydFNjcmlwdHM6IGZhbHNlICovXHJcbiAgICAgICAgaW1wb3J0U2NyaXB0cygnU0NSSVBUX1BMQUNFSE9MREVSJyk7XHJcblx0XHQvKiBnbG9iYWwgYXN5bmNQcm94eTogZmFsc2UgKi9cclxuICAgICAgICBhc3luY1Byb3h5LkFzeW5jUHJveHlTbGF2ZS5faW5pdGlhbGl6ZVNsYXZlKCk7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGZ1bmN0aW9uIG9uV29ya2VyTWVzc2FnZSh0aGF0LCB3b3JrZXJFdmVudCkge1xyXG4gICAgICAgIHZhciBjYWxsSWQgPSB3b3JrZXJFdmVudC5kYXRhLmNhbGxJZDtcclxuICAgICAgICBcclxuICAgICAgICBzd2l0Y2ggKHdvcmtlckV2ZW50LmRhdGEudHlwZSkge1xyXG4gICAgICAgICAgICBjYXNlICdmdW5jdGlvbkNhbGxlZCc6XHJcbiAgICAgICAgICAgICAgICAtLXRoYXQuX25vdFJldHVybmVkRnVuY3Rpb25zO1xyXG4gICAgICAgICAgICAgICAgdHJ5U2VuZFBlbmRpbmdNZXNzYWdlcyh0aGF0KTtcclxuICAgICAgICAgICAgICAgIGJyZWFrO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgY2FzZSAncHJvbWlzZVJlc3VsdCc6XHJcbiAgICAgICAgICAgICAgICB2YXIgcHJvbWlzZVRvUmVzb2x2ZSA9IHRoYXQuX3BlbmRpbmdQcm9taXNlQ2FsbHNbY2FsbElkXTtcclxuICAgICAgICAgICAgICAgIGRlbGV0ZSB0aGF0Ll9wZW5kaW5nUHJvbWlzZUNhbGxzW2NhbGxJZF07XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIHZhciByZXN1bHQgPSB3b3JrZXJFdmVudC5kYXRhLnJlc3VsdDtcclxuICAgICAgICAgICAgICAgIHByb21pc2VUb1Jlc29sdmUucmVzb2x2ZShyZXN1bHQpO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICBicmVhaztcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGNhc2UgJ3Byb21pc2VGYWlsdXJlJzpcclxuICAgICAgICAgICAgICAgIHZhciBwcm9taXNlVG9SZWplY3QgPSB0aGF0Ll9wZW5kaW5nUHJvbWlzZUNhbGxzW2NhbGxJZF07XHJcbiAgICAgICAgICAgICAgICBkZWxldGUgdGhhdC5fcGVuZGluZ1Byb21pc2VDYWxsc1tjYWxsSWRdO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICB2YXIgcmVhc29uID0gd29ya2VyRXZlbnQuZGF0YS5yZWFzb247XHJcbiAgICAgICAgICAgICAgICBwcm9taXNlVG9SZWplY3QucmVqZWN0KHJlYXNvbik7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIGJyZWFrO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgY2FzZSAndXNlckRhdGEnOlxyXG4gICAgICAgICAgICAgICAgaWYgKHRoYXQuX3VzZXJEYXRhSGFuZGxlciAhPT0gbnVsbCkge1xyXG4gICAgICAgICAgICAgICAgICAgIHRoYXQuX3VzZXJEYXRhSGFuZGxlcih3b3JrZXJFdmVudC5kYXRhLnVzZXJEYXRhKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgYnJlYWs7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBjYXNlICdjYWxsYmFjayc6XHJcbiAgICAgICAgICAgICAgICB2YXIgY2FsbGJhY2tIYW5kbGUgPSB0aGF0Ll9jYWxsYmFja3Nbd29ya2VyRXZlbnQuZGF0YS5jYWxsSWRdO1xyXG4gICAgICAgICAgICAgICAgaWYgKGNhbGxiYWNrSGFuZGxlID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICAgICAgICAgICAgICB0aHJvdyAnVW5leHBlY3RlZCBtZXNzYWdlIGZyb20gU2xhdmVXb3JrZXIgb2YgY2FsbGJhY2sgSUQ6ICcgK1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB3b3JrZXJFdmVudC5kYXRhLmNhbGxJZCArICcuIE1heWJlIHNob3VsZCBpbmRpY2F0ZSAnICtcclxuICAgICAgICAgICAgICAgICAgICAgICAgJ2lzTXVsdGlwbGVUaW1lc0NhbGxiYWNrID0gdHJ1ZSBvbiBjcmVhdGlvbj8nO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICBpZiAoIWNhbGxiYWNrSGFuZGxlLmlzTXVsdGlwbGVUaW1lQ2FsbGJhY2spIHtcclxuICAgICAgICAgICAgICAgICAgICB0aGF0LmZyZWVDYWxsYmFjayh0aGF0Ll9jYWxsYmFja3Nbd29ya2VyRXZlbnQuZGF0YS5jYWxsSWRdKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgaWYgKGNhbGxiYWNrSGFuZGxlLmNhbGxiYWNrICE9PSBudWxsKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY2FsbGJhY2tIYW5kbGUuY2FsbGJhY2suYXBwbHkobnVsbCwgd29ya2VyRXZlbnQuZGF0YS5hcmdzKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgYnJlYWs7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBjYXNlICdzdWJXb3JrZXJDdG9yJzpcclxuICAgICAgICAgICAgICAgIHZhciBzdWJXb3JrZXJDcmVhdGVkID0gbmV3IFdvcmtlcih3b3JrZXJFdmVudC5kYXRhLnNjcmlwdFVybCk7XHJcbiAgICAgICAgICAgICAgICB2YXIgaWQgPSB3b3JrZXJFdmVudC5kYXRhLnN1YldvcmtlcklkO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICB0aGF0Ll9zdWJXb3JrZXJCeUlkW2lkXSA9IHN1YldvcmtlckNyZWF0ZWQ7XHJcbiAgICAgICAgICAgICAgICB0aGF0Ll9zdWJXb3JrZXJzLnB1c2goc3ViV29ya2VyQ3JlYXRlZCk7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIHN1YldvcmtlckNyZWF0ZWQub25tZXNzYWdlID0gZnVuY3Rpb24gb25TdWJXb3JrZXJNZXNzYWdlKHN1YldvcmtlckV2ZW50KSB7XHJcbiAgICAgICAgICAgICAgICAgICAgZW5xdWV1ZU1lc3NhZ2VUb1NsYXZlKFxyXG4gICAgICAgICAgICAgICAgICAgICAgICB0aGF0LCBzdWJXb3JrZXJFdmVudC5wb3J0cywgLyppc0Z1bmN0aW9uQ2FsbD0qL2ZhbHNlLCB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBmdW5jdGlvblRvQ2FsbDogJ3N1Yldvcmtlck9uTWVzc2FnZScsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBzdWJXb3JrZXJJZDogaWQsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBkYXRhOiBzdWJXb3JrZXJFdmVudC5kYXRhXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgfTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgYnJlYWs7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBjYXNlICdzdWJXb3JrZXJQb3N0TWVzc2FnZSc6XHJcbiAgICAgICAgICAgICAgICB2YXIgc3ViV29ya2VyVG9Qb3N0TWVzc2FnZSA9IHRoYXQuX3N1YldvcmtlckJ5SWRbd29ya2VyRXZlbnQuZGF0YS5zdWJXb3JrZXJJZF07XHJcbiAgICAgICAgICAgICAgICBzdWJXb3JrZXJUb1Bvc3RNZXNzYWdlLnBvc3RNZXNzYWdlKHdvcmtlckV2ZW50LmRhdGEuZGF0YSk7XHJcbiAgICAgICAgICAgICAgICBicmVhaztcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGNhc2UgJ3N1YldvcmtlclRlcm1pbmF0ZSc6XHJcbiAgICAgICAgICAgICAgICB2YXIgc3ViV29ya2VyVG9UZXJtaW5hdGUgPSB0aGF0Ll9zdWJXb3JrZXJCeUlkW3dvcmtlckV2ZW50LmRhdGEuc3ViV29ya2VySWRdO1xyXG4gICAgICAgICAgICAgICAgc3ViV29ya2VyVG9UZXJtaW5hdGUudGVybWluYXRlKCk7XHJcbiAgICAgICAgICAgICAgICBicmVhaztcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGRlZmF1bHQ6XHJcbiAgICAgICAgICAgICAgICB0aHJvdyAnVW5rbm93biBtZXNzYWdlIGZyb20gQXN5bmNQcm94eVNsYXZlIG9mIHR5cGU6ICcgK1xyXG4gICAgICAgICAgICAgICAgICAgIHdvcmtlckV2ZW50LmRhdGEudHlwZTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGZ1bmN0aW9uIGVucXVldWVNZXNzYWdlVG9TbGF2ZShcclxuICAgICAgICB0aGF0LCB0cmFuc2ZlcmFibGVzLCBpc0Z1bmN0aW9uQ2FsbCwgbWVzc2FnZSkge1xyXG4gICAgICAgIFxyXG4gICAgICAgIGlmICh0aGF0Ll9ub3RSZXR1cm5lZEZ1bmN0aW9ucyA+PSB0aGF0Ll9mdW5jdGlvbnNCdWZmZXJTaXplKSB7XHJcbiAgICAgICAgICAgIHRoYXQuX3BlbmRpbmdNZXNzYWdlcy5wdXNoKHtcclxuICAgICAgICAgICAgICAgIHRyYW5zZmVyYWJsZXM6IHRyYW5zZmVyYWJsZXMsXHJcbiAgICAgICAgICAgICAgICBpc0Z1bmN0aW9uQ2FsbDogaXNGdW5jdGlvbkNhbGwsXHJcbiAgICAgICAgICAgICAgICBtZXNzYWdlOiBtZXNzYWdlXHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHNlbmRNZXNzYWdlVG9TbGF2ZSh0aGF0LCB0cmFuc2ZlcmFibGVzLCBpc0Z1bmN0aW9uQ2FsbCwgbWVzc2FnZSk7XHJcbiAgICB9XHJcbiAgICAgICAgXHJcbiAgICBmdW5jdGlvbiBzZW5kTWVzc2FnZVRvU2xhdmUoXHJcbiAgICAgICAgdGhhdCwgdHJhbnNmZXJhYmxlcywgaXNGdW5jdGlvbkNhbGwsIG1lc3NhZ2UpIHtcclxuICAgICAgICBcclxuICAgICAgICBpZiAoaXNGdW5jdGlvbkNhbGwpIHtcclxuICAgICAgICAgICAgKyt0aGF0Ll9ub3RSZXR1cm5lZEZ1bmN0aW9ucztcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgdGhhdC5fd29ya2VyLnBvc3RNZXNzYWdlKG1lc3NhZ2UsIHRyYW5zZmVyYWJsZXMpO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBmdW5jdGlvbiB0cnlTZW5kUGVuZGluZ01lc3NhZ2VzKHRoYXQpIHtcclxuICAgICAgICB3aGlsZSAodGhhdC5fbm90UmV0dXJuZWRGdW5jdGlvbnMgPCB0aGF0Ll9mdW5jdGlvbnNCdWZmZXJTaXplICYmXHJcbiAgICAgICAgICAgICAgIHRoYXQuX3BlbmRpbmdNZXNzYWdlcy5sZW5ndGggPiAwKSB7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICB2YXIgbWVzc2FnZSA9IHRoYXQuX3BlbmRpbmdNZXNzYWdlcy5zaGlmdCgpO1xyXG4gICAgICAgICAgICBzZW5kTWVzc2FnZVRvU2xhdmUoXHJcbiAgICAgICAgICAgICAgICB0aGF0LFxyXG4gICAgICAgICAgICAgICAgbWVzc2FnZS50cmFuc2ZlcmFibGVzLFxyXG4gICAgICAgICAgICAgICAgbWVzc2FnZS5pc0Z1bmN0aW9uQ2FsbCxcclxuICAgICAgICAgICAgICAgIG1lc3NhZ2UubWVzc2FnZSk7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgXHJcbiAgICBmdW5jdGlvbiBnZXRCYXNlVXJsRnJvbUVudHJ5U2NyaXB0KCkge1xyXG4gICAgICAgIHZhciBiYXNlVXJsID0gbG9jYXRpb24uaHJlZjtcclxuICAgICAgICB2YXIgZW5kT2ZQYXRoID0gYmFzZVVybC5sYXN0SW5kZXhPZignLycpO1xyXG4gICAgICAgIGlmIChlbmRPZlBhdGggPj0gMCkge1xyXG4gICAgICAgICAgICBiYXNlVXJsID0gYmFzZVVybC5zdWJzdHJpbmcoMCwgZW5kT2ZQYXRoKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgcmV0dXJuIGJhc2VVcmw7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHJldHVybiBBc3luY1Byb3h5TWFzdGVyO1xyXG59KSgpO1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBBc3luY1Byb3h5TWFzdGVyOyIsIid1c2Ugc3RyaWN0JztcclxuXHJcbi8qIGdsb2JhbCBjb25zb2xlOiBmYWxzZSAqL1xyXG4vKiBnbG9iYWwgc2VsZjogZmFsc2UgKi9cclxuXHJcbnZhciBBc3luY1Byb3h5TWFzdGVyID0gcmVxdWlyZSgnYXN5bmMtcHJveHktbWFzdGVyJyk7XHJcbnZhciBTdWJXb3JrZXJFbXVsYXRpb25Gb3JDaHJvbWUgPSByZXF1aXJlKCdzdWItd29ya2VyLWVtdWxhdGlvbi1mb3ItY2hyb21lJyk7XHJcblxyXG52YXIgQXN5bmNQcm94eVNsYXZlID0gKGZ1bmN0aW9uIEFzeW5jUHJveHlTbGF2ZUNsb3N1cmUoKSB7XHJcbiAgICB2YXIgc2xhdmVIZWxwZXJTaW5nbGV0b24gPSB7fTtcclxuICAgIFxyXG4gICAgdmFyIGJlZm9yZU9wZXJhdGlvbkxpc3RlbmVyID0gbnVsbDtcclxuICAgIHZhciBzbGF2ZVNpZGVNYWluSW5zdGFuY2U7XHJcbiAgICB2YXIgc2xhdmVTaWRlSW5zdGFuY2VDcmVhdG9yID0gZGVmYXVsdEluc3RhbmNlQ3JlYXRvcjtcclxuICAgIHZhciBzdWJXb3JrZXJJZFRvU3ViV29ya2VyID0ge307XHJcbiAgICB2YXIgY3Rvck5hbWU7XHJcbiAgICBcclxuICAgIHNsYXZlSGVscGVyU2luZ2xldG9uLl9pbml0aWFsaXplU2xhdmUgPSBmdW5jdGlvbiBpbml0aWFsaXplU2xhdmUoKSB7XHJcbiAgICAgICAgc2VsZi5vbm1lc3NhZ2UgPSBvbk1lc3NhZ2U7XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBzbGF2ZUhlbHBlclNpbmdsZXRvbi5zZXRTbGF2ZVNpZGVDcmVhdG9yID0gZnVuY3Rpb24gc2V0U2xhdmVTaWRlQ3JlYXRvcihjcmVhdG9yKSB7XHJcbiAgICAgICAgc2xhdmVTaWRlSW5zdGFuY2VDcmVhdG9yID0gY3JlYXRvcjtcclxuICAgIH07XHJcbiAgICBcclxuICAgIHNsYXZlSGVscGVyU2luZ2xldG9uLnNldEJlZm9yZU9wZXJhdGlvbkxpc3RlbmVyID1cclxuICAgICAgICBmdW5jdGlvbiBzZXRCZWZvcmVPcGVyYXRpb25MaXN0ZW5lcihsaXN0ZW5lcikge1xyXG4gICAgICAgICAgICBiZWZvcmVPcGVyYXRpb25MaXN0ZW5lciA9IGxpc3RlbmVyO1xyXG4gICAgICAgIH07XHJcbiAgICAgICAgXHJcbiAgICBzbGF2ZUhlbHBlclNpbmdsZXRvbi5zZW5kVXNlckRhdGFUb01hc3RlciA9IGZ1bmN0aW9uIHNlbmRVc2VyRGF0YVRvTWFzdGVyKFxyXG4gICAgICAgIHVzZXJEYXRhKSB7XHJcbiAgICAgICAgXHJcbiAgICAgICAgc2VsZi5wb3N0TWVzc2FnZSh7XHJcbiAgICAgICAgICAgIHR5cGU6ICd1c2VyRGF0YScsXHJcbiAgICAgICAgICAgIHVzZXJEYXRhOiB1c2VyRGF0YVxyXG4gICAgICAgIH0pO1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgc2xhdmVIZWxwZXJTaW5nbGV0b24ud3JhcFByb21pc2VGcm9tU2xhdmVTaWRlID1cclxuICAgICAgICBmdW5jdGlvbiB3cmFwUHJvbWlzZUZyb21TbGF2ZVNpZGUoXHJcbiAgICAgICAgICAgIGNhbGxJZCwgcHJvbWlzZSwgcGF0aHNUb1RyYW5zZmVyYWJsZXMpIHtcclxuICAgICAgICBcclxuICAgICAgICB2YXIgcHJvbWlzZVRoZW4gPSBwcm9taXNlLnRoZW4oZnVuY3Rpb24gc2VuZFByb21pc2VUb01hc3RlcihyZXN1bHQpIHtcclxuICAgICAgICAgICAgdmFyIHRyYW5zZmVyYWJsZXMgPVxyXG5cdFx0XHRcdEFzeW5jUHJveHlNYXN0ZXIuX2V4dHJhY3RUcmFuc2ZlcmFibGVzKFxyXG5cdFx0XHRcdFx0cGF0aHNUb1RyYW5zZmVyYWJsZXMsIHJlc3VsdCk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBzZWxmLnBvc3RNZXNzYWdlKFxyXG4gICAgICAgICAgICAgICAge1xyXG4gICAgICAgICAgICAgICAgICAgIHR5cGU6ICdwcm9taXNlUmVzdWx0JyxcclxuICAgICAgICAgICAgICAgICAgICBjYWxsSWQ6IGNhbGxJZCxcclxuICAgICAgICAgICAgICAgICAgICByZXN1bHQ6IHJlc3VsdFxyXG4gICAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgICAgIHRyYW5zZmVyYWJsZXMpO1xyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHByb21pc2VUaGVuWydjYXRjaCddKGZ1bmN0aW9uIHNlbmRGYWlsdXJlVG9NYXN0ZXIocmVhc29uKSB7XHJcbiAgICAgICAgICAgIHNlbGYucG9zdE1lc3NhZ2Uoe1xyXG4gICAgICAgICAgICAgICAgdHlwZTogJ3Byb21pc2VGYWlsdXJlJyxcclxuICAgICAgICAgICAgICAgIGNhbGxJZDogY2FsbElkLFxyXG4gICAgICAgICAgICAgICAgcmVhc29uOiByZWFzb25cclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgfSk7XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBzbGF2ZUhlbHBlclNpbmdsZXRvbi53cmFwQ2FsbGJhY2tGcm9tU2xhdmVTaWRlID1cclxuICAgICAgICBmdW5jdGlvbiB3cmFwQ2FsbGJhY2tGcm9tU2xhdmVTaWRlKGNhbGxiYWNrSGFuZGxlKSB7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgIHZhciBpc0FscmVhZHlDYWxsZWQgPSBmYWxzZTtcclxuICAgICAgICBcclxuICAgICAgICBmdW5jdGlvbiBjYWxsYmFja1dyYXBwZXJGcm9tU2xhdmVTaWRlKCkge1xyXG4gICAgICAgICAgICBpZiAoaXNBbHJlYWR5Q2FsbGVkKSB7XHJcbiAgICAgICAgICAgICAgICB0aHJvdyAnQ2FsbGJhY2sgaXMgY2FsbGVkIHR3aWNlIGJ1dCBpc011bHRpcGxlVGltZUNhbGxiYWNrICcgK1xyXG4gICAgICAgICAgICAgICAgICAgICc9IGZhbHNlJztcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgdmFyIGFyZ3VtZW50c0FzQXJyYXkgPSBnZXRBcmd1bWVudHNBc0FycmF5KGFyZ3VtZW50cyk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBpZiAoYmVmb3JlT3BlcmF0aW9uTGlzdGVuZXIgIT09IG51bGwpIHtcclxuXHRcdFx0XHR0cnkge1xyXG5cdFx0XHRcdFx0YmVmb3JlT3BlcmF0aW9uTGlzdGVuZXIuY2FsbChcclxuXHRcdFx0XHRcdFx0c2xhdmVTaWRlTWFpbkluc3RhbmNlLFxyXG5cdFx0XHRcdFx0XHQnY2FsbGJhY2snLFxyXG5cdFx0XHRcdFx0XHRjYWxsYmFja0hhbmRsZS5jYWxsYmFja05hbWUsXHJcblx0XHRcdFx0XHRcdGFyZ3VtZW50c0FzQXJyYXkpO1xyXG5cdFx0XHRcdH0gY2F0Y2ggKGUpIHtcclxuXHRcdFx0XHRcdGNvbnNvbGUubG9nKCdBc3luY1Byb3h5U2xhdmUuYmVmb3JlT3BlcmF0aW9uTGlzdGVuZXIgaGFzIHRocm93biBhbiBleGNlcHRpb246ICcgKyBlKTtcclxuXHRcdFx0XHR9XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHZhciB0cmFuc2ZlcmFibGVzID1cclxuXHRcdFx0XHRBc3luY1Byb3h5TWFzdGVyLl9leHRyYWN0VHJhbnNmZXJhYmxlcyhcclxuXHRcdFx0XHRcdGNhbGxiYWNrSGFuZGxlLnBhdGhzVG9UcmFuc2ZlcmFibGVzLCBhcmd1bWVudHNBc0FycmF5KTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHNlbGYucG9zdE1lc3NhZ2Uoe1xyXG4gICAgICAgICAgICAgICAgICAgIHR5cGU6ICdjYWxsYmFjaycsXHJcbiAgICAgICAgICAgICAgICAgICAgY2FsbElkOiBjYWxsYmFja0hhbmRsZS5jYWxsSWQsXHJcbiAgICAgICAgICAgICAgICAgICAgYXJnczogYXJndW1lbnRzQXNBcnJheVxyXG4gICAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgICAgIHRyYW5zZmVyYWJsZXMpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgaWYgKCFjYWxsYmFja0hhbmRsZS5pc011bHRpcGxlVGltZUNhbGxiYWNrKSB7XHJcbiAgICAgICAgICAgICAgICBpc0FscmVhZHlDYWxsZWQgPSB0cnVlO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHJldHVybiBjYWxsYmFja1dyYXBwZXJGcm9tU2xhdmVTaWRlO1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgZnVuY3Rpb24gb25NZXNzYWdlKGV2ZW50KSB7XHJcbiAgICAgICAgdmFyIGZ1bmN0aW9uTmFtZVRvQ2FsbCA9IGV2ZW50LmRhdGEuZnVuY3Rpb25Ub0NhbGw7XHJcbiAgICAgICAgdmFyIGFyZ3MgPSBldmVudC5kYXRhLmFyZ3M7XHJcbiAgICAgICAgdmFyIGNhbGxJZCA9IGV2ZW50LmRhdGEuY2FsbElkO1xyXG4gICAgICAgIHZhciBpc1Byb21pc2UgPSBldmVudC5kYXRhLmlzUHJvbWlzZTtcclxuICAgICAgICB2YXIgcGF0aHNUb1RyYW5zZmVyYWJsZXNJblByb21pc2VSZXN1bHQgPVxyXG4gICAgICAgICAgICBldmVudC5kYXRhLnBhdGhzVG9UcmFuc2ZlcmFibGVzSW5Qcm9taXNlUmVzdWx0O1xyXG4gICAgICAgIFxyXG4gICAgICAgIHZhciByZXN1bHQgPSBudWxsO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHN3aXRjaCAoZnVuY3Rpb25OYW1lVG9DYWxsKSB7XHJcbiAgICAgICAgICAgIGNhc2UgJ2N0b3InOlxyXG4gICAgICAgICAgICAgICAgQXN5bmNQcm94eU1hc3Rlci5fc2V0RW50cnlVcmwoZXZlbnQuZGF0YS5tYXN0ZXJFbnRyeVVybCk7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIHZhciBzY3JpcHRzVG9JbXBvcnQgPSBldmVudC5kYXRhLnNjcmlwdHNUb0ltcG9ydDtcclxuICAgICAgICAgICAgICAgIGN0b3JOYW1lID0gZXZlbnQuZGF0YS5jdG9yTmFtZTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBzY3JpcHRzVG9JbXBvcnQubGVuZ3RoOyArK2kpIHtcclxuXHRcdFx0XHRcdC8qIGdsb2JhbCBpbXBvcnRTY3JpcHRzOiBmYWxzZSAqL1xyXG4gICAgICAgICAgICAgICAgICAgIGltcG9ydFNjcmlwdHMoc2NyaXB0c1RvSW1wb3J0W2ldKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgc2xhdmVTaWRlTWFpbkluc3RhbmNlID0gc2xhdmVTaWRlSW5zdGFuY2VDcmVhdG9yLmFwcGx5KG51bGwsIGFyZ3MpO1xyXG5cclxuICAgICAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGNhc2UgJ3N1Yldvcmtlck9uTWVzc2FnZSc6XHJcbiAgICAgICAgICAgICAgICB2YXIgc3ViV29ya2VyID0gc3ViV29ya2VySWRUb1N1YldvcmtlcltldmVudC5kYXRhLnN1YldvcmtlcklkXTtcclxuICAgICAgICAgICAgICAgIHZhciB3b3JrZXJFdmVudCA9IHsgZGF0YTogZXZlbnQuZGF0YS5kYXRhIH07XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIHN1Yldvcmtlci5vbm1lc3NhZ2Uod29ya2VyRXZlbnQpO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIGFyZ3MgPSBuZXcgQXJyYXkoZXZlbnQuZGF0YS5hcmdzLmxlbmd0aCk7XHJcbiAgICAgICAgZm9yICh2YXIgaiA9IDA7IGogPCBldmVudC5kYXRhLmFyZ3MubGVuZ3RoOyArK2opIHtcclxuICAgICAgICAgICAgdmFyIGFyZyA9IGV2ZW50LmRhdGEuYXJnc1tqXTtcclxuICAgICAgICAgICAgaWYgKGFyZyAhPT0gdW5kZWZpbmVkICYmXHJcbiAgICAgICAgICAgICAgICBhcmcgIT09IG51bGwgJiZcclxuICAgICAgICAgICAgICAgIGFyZy5pc1dvcmtlckhlbHBlckNhbGxiYWNrKSB7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIGFyZyA9IHNsYXZlSGVscGVyU2luZ2xldG9uLndyYXBDYWxsYmFja0Zyb21TbGF2ZVNpZGUoYXJnKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgYXJnc1tqXSA9IGFyZztcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgdmFyIGZ1bmN0aW9uQ29udGFpbmVyID0gc2xhdmVTaWRlTWFpbkluc3RhbmNlO1xyXG4gICAgICAgIHZhciBmdW5jdGlvblRvQ2FsbDtcclxuICAgICAgICB3aGlsZSAoZnVuY3Rpb25Db250YWluZXIpIHtcclxuICAgICAgICAgICAgZnVuY3Rpb25Ub0NhbGwgPSBzbGF2ZVNpZGVNYWluSW5zdGFuY2VbZnVuY3Rpb25OYW1lVG9DYWxsXTtcclxuICAgICAgICAgICAgaWYgKGZ1bmN0aW9uVG9DYWxsKSB7XHJcbiAgICAgICAgICAgICAgICBicmVhaztcclxuICAgICAgICAgICAgfVxyXG5cdFx0XHQvKiBqc2hpbnQgcHJvdG86IHRydWUgKi9cclxuICAgICAgICAgICAgZnVuY3Rpb25Db250YWluZXIgPSBmdW5jdGlvbkNvbnRhaW5lci5fX3Byb3RvX187XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIGlmICghZnVuY3Rpb25Ub0NhbGwpIHtcclxuICAgICAgICAgICAgdGhyb3cgJ0FzeW5jUHJveHkgZXJyb3I6IGNvdWxkIG5vdCBmaW5kIGZ1bmN0aW9uICcgKyBmdW5jdGlvbk5hbWVUb0NhbGw7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHZhciBwcm9taXNlID0gZnVuY3Rpb25Ub0NhbGwuYXBwbHkoc2xhdmVTaWRlTWFpbkluc3RhbmNlLCBhcmdzKTtcclxuICAgICAgICBcclxuICAgICAgICBpZiAoaXNQcm9taXNlKSB7XHJcbiAgICAgICAgICAgIHNsYXZlSGVscGVyU2luZ2xldG9uLndyYXBQcm9taXNlRnJvbVNsYXZlU2lkZShcclxuICAgICAgICAgICAgICAgIGNhbGxJZCwgcHJvbWlzZSwgcGF0aHNUb1RyYW5zZmVyYWJsZXNJblByb21pc2VSZXN1bHQpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgc2VsZi5wb3N0TWVzc2FnZSh7XHJcbiAgICAgICAgICAgIHR5cGU6ICdmdW5jdGlvbkNhbGxlZCcsXHJcbiAgICAgICAgICAgIGNhbGxJZDogZXZlbnQuZGF0YS5jYWxsSWQsXHJcbiAgICAgICAgICAgIHJlc3VsdDogcmVzdWx0XHJcbiAgICAgICAgfSk7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGZ1bmN0aW9uIGRlZmF1bHRJbnN0YW5jZUNyZWF0b3IoKSB7XHJcbiAgICAgICAgdmFyIGluc3RhbmNlO1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIHZhciBuYW1lc3BhY2VzQW5kQ3Rvck5hbWUgPSBjdG9yTmFtZS5zcGxpdCgnLicpO1xyXG4gICAgICAgICAgICB2YXIgbWVtYmVyID0gc2VsZjtcclxuICAgICAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBuYW1lc3BhY2VzQW5kQ3Rvck5hbWUubGVuZ3RoOyArK2kpXHJcbiAgICAgICAgICAgICAgICBtZW1iZXIgPSBtZW1iZXJbbmFtZXNwYWNlc0FuZEN0b3JOYW1lW2ldXTtcclxuICAgICAgICAgICAgdmFyIFR5cGVDdG9yID0gbWVtYmVyO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgdmFyIGJpbmRBcmdzID0gW251bGxdLmNvbmNhdChnZXRBcmd1bWVudHNBc0FycmF5KGFyZ3VtZW50cykpO1xyXG4gICAgICAgICAgICBpbnN0YW5jZSA9IG5ldyAoRnVuY3Rpb24ucHJvdG90eXBlLmJpbmQuYXBwbHkoVHlwZUN0b3IsIGJpbmRBcmdzKSkoKTtcclxuICAgICAgICB9IGNhdGNoIChlKSB7XHJcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignRmFpbGVkIGxvY2F0aW5nIGNsYXNzIG5hbWUgJyArIGN0b3JOYW1lICsgJzogJyArIGUpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICByZXR1cm4gaW5zdGFuY2U7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGZ1bmN0aW9uIGdldEFyZ3VtZW50c0FzQXJyYXkoYXJncykge1xyXG4gICAgICAgIHZhciBhcmd1bWVudHNBc0FycmF5ID0gbmV3IEFycmF5KGFyZ3MubGVuZ3RoKTtcclxuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IGFyZ3MubGVuZ3RoOyArK2kpIHtcclxuICAgICAgICAgICAgYXJndW1lbnRzQXNBcnJheVtpXSA9IGFyZ3NbaV07XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHJldHVybiBhcmd1bWVudHNBc0FycmF5O1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBpZiAoc2VsZi5Xb3JrZXIgPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIFN1YldvcmtlckVtdWxhdGlvbkZvckNocm9tZS5pbml0aWFsaXplKHN1YldvcmtlcklkVG9TdWJXb3JrZXIpO1xyXG4gICAgICAgIHNlbGYuV29ya2VyID0gU3ViV29ya2VyRW11bGF0aW9uRm9yQ2hyb21lO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICByZXR1cm4gc2xhdmVIZWxwZXJTaW5nbGV0b247XHJcbn0pKCk7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IEFzeW5jUHJveHlTbGF2ZTsiLCIndXNlIHN0cmljdCc7XHJcblxyXG52YXIgU2NyaXB0c1RvSW1wb3J0UG9vbCA9IChmdW5jdGlvbiBTY3JpcHRzVG9JbXBvcnRQb29sQ2xvc3VyZSgpIHtcclxuICAgIGZ1bmN0aW9uIFNjcmlwdHNUb0ltcG9ydFBvb2woKSB7XHJcbiAgICAgICAgdmFyIHRoYXQgPSB0aGlzO1xyXG4gICAgICAgIHRoYXQuX3NjcmlwdHNCeU5hbWUgPSB7fTtcclxuICAgICAgICB0aGF0Ll9zY3JpcHRzQXJyYXkgPSBudWxsO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBTY3JpcHRzVG9JbXBvcnRQb29sLnByb3RvdHlwZS5hZGRTY3JpcHRGcm9tRXJyb3JXaXRoU3RhY2tUcmFjZSA9XHJcbiAgICAgICAgZnVuY3Rpb24gYWRkU2NyaXB0Rm9yV29ya2VySW1wb3J0KGVycm9yV2l0aFN0YWNrVHJhY2UpIHtcclxuICAgICAgICBcclxuICAgICAgICB2YXIgZmlsZU5hbWUgPSBTY3JpcHRzVG9JbXBvcnRQb29sLl9nZXRTY3JpcHROYW1lKGVycm9yV2l0aFN0YWNrVHJhY2UpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGlmICghdGhpcy5fc2NyaXB0c0J5TmFtZVtmaWxlTmFtZV0pIHtcclxuICAgICAgICAgICAgdGhpcy5fc2NyaXB0c0J5TmFtZVtmaWxlTmFtZV0gPSB0cnVlO1xyXG4gICAgICAgICAgICB0aGlzLl9zY3JpcHRzQXJyYXkgPSBudWxsO1xyXG4gICAgICAgIH1cclxuICAgIH07XHJcbiAgICBcclxuICAgIFNjcmlwdHNUb0ltcG9ydFBvb2wucHJvdG90eXBlLmdldFNjcmlwdHNGb3JXb3JrZXJJbXBvcnQgPVxyXG4gICAgICAgIGZ1bmN0aW9uIGdldFNjcmlwdHNGb3JXb3JrZXJJbXBvcnQoKSB7XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKHRoaXMuX3NjcmlwdHNBcnJheSA9PT0gbnVsbCkge1xyXG4gICAgICAgICAgICB0aGlzLl9zY3JpcHRzQXJyYXkgPSBbXTtcclxuICAgICAgICAgICAgZm9yICh2YXIgZmlsZU5hbWUgaW4gdGhpcy5fc2NyaXB0c0J5TmFtZSkge1xyXG4gICAgICAgICAgICAgICAgdGhpcy5fc2NyaXB0c0FycmF5LnB1c2goZmlsZU5hbWUpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHJldHVybiB0aGlzLl9zY3JpcHRzQXJyYXk7XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBTY3JpcHRzVG9JbXBvcnRQb29sLl9nZXRTY3JpcHROYW1lID0gZnVuY3Rpb24gZ2V0U2NyaXB0TmFtZShlcnJvcldpdGhTdGFja1RyYWNlKSB7XHJcbiAgICAgICAgdmFyIHN0YWNrID0gZXJyb3JXaXRoU3RhY2tUcmFjZS5zdGFjay50cmltKCk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgdmFyIGN1cnJlbnRTdGFja0ZyYW1lUmVnZXggPSAvYXQgKHxbXiBdKyBcXCgpKFteIF0rKTpcXGQrOlxcZCsvO1xyXG4gICAgICAgIHZhciBzb3VyY2UgPSBjdXJyZW50U3RhY2tGcmFtZVJlZ2V4LmV4ZWMoc3RhY2spO1xyXG4gICAgICAgIGlmIChzb3VyY2UgJiYgc291cmNlWzJdICE9PSBcIlwiKSB7XHJcbiAgICAgICAgICAgIHJldHVybiBzb3VyY2VbMl07XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICB2YXIgbGFzdFN0YWNrRnJhbWVSZWdleCA9IG5ldyBSZWdFeHAoLy4rXFwvKC4qPyk6XFxkKyg6XFxkKykqJC8pO1xyXG4gICAgICAgIHNvdXJjZSA9IGxhc3RTdGFja0ZyYW1lUmVnZXguZXhlYyhzdGFjayk7XHJcbiAgICAgICAgaWYgKHNvdXJjZSAmJiBzb3VyY2VbMV0gIT09IFwiXCIpIHtcclxuICAgICAgICAgICAgcmV0dXJuIHNvdXJjZVsxXTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKGVycm9yV2l0aFN0YWNrVHJhY2UuZmlsZU5hbWUgIT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgICAgICByZXR1cm4gZXJyb3JXaXRoU3RhY2tUcmFjZS5maWxlTmFtZTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgdGhyb3cgJ0ltYWdlRGVjb2RlckZyYW1ld29yay5qczogQ291bGQgbm90IGdldCBjdXJyZW50IHNjcmlwdCBVUkwnO1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgcmV0dXJuIFNjcmlwdHNUb0ltcG9ydFBvb2w7XHJcbn0pKCk7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IFNjcmlwdHNUb0ltcG9ydFBvb2w7IiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxuLyogZ2xvYmFsIHNlbGY6IGZhbHNlICovXHJcblxyXG52YXIgU3ViV29ya2VyRW11bGF0aW9uRm9yQ2hyb21lID0gKGZ1bmN0aW9uIFN1YldvcmtlckVtdWxhdGlvbkZvckNocm9tZUNsb3N1cmUoKSB7XHJcbiAgICB2YXIgc3ViV29ya2VySWQgPSAwO1xyXG4gICAgdmFyIHN1YldvcmtlcklkVG9TdWJXb3JrZXIgPSBudWxsO1xyXG4gICAgXHJcbiAgICBmdW5jdGlvbiBTdWJXb3JrZXJFbXVsYXRpb25Gb3JDaHJvbWUoc2NyaXB0VXJsKSB7XHJcbiAgICAgICAgaWYgKHN1YldvcmtlcklkVG9TdWJXb3JrZXIgPT09IG51bGwpIHtcclxuICAgICAgICAgICAgdGhyb3cgJ0FzeW5jUHJveHkgaW50ZXJuYWwgZXJyb3I6IFN1YldvcmtlckVtdWxhdGlvbkZvckNocm9tZSAnICtcclxuICAgICAgICAgICAgICAgICdub3QgaW5pdGlhbGl6ZWQnO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICB2YXIgdGhhdCA9IHRoaXM7XHJcbiAgICAgICAgdGhhdC5fc3ViV29ya2VySWQgPSArK3N1YldvcmtlcklkO1xyXG4gICAgICAgIHN1YldvcmtlcklkVG9TdWJXb3JrZXJbdGhhdC5fc3ViV29ya2VySWRdID0gdGhhdDtcclxuICAgICAgICBcclxuICAgICAgICBzZWxmLnBvc3RNZXNzYWdlKHtcclxuICAgICAgICAgICAgdHlwZTogJ3N1YldvcmtlckN0b3InLFxyXG4gICAgICAgICAgICBzdWJXb3JrZXJJZDogdGhhdC5fc3ViV29ya2VySWQsXHJcbiAgICAgICAgICAgIHNjcmlwdFVybDogc2NyaXB0VXJsXHJcbiAgICAgICAgfSk7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIFN1YldvcmtlckVtdWxhdGlvbkZvckNocm9tZS5pbml0aWFsaXplID0gZnVuY3Rpb24gaW5pdGlhbGl6ZShcclxuICAgICAgICBzdWJXb3JrZXJJZFRvU3ViV29ya2VyXykge1xyXG4gICAgICAgIFxyXG4gICAgICAgIHN1YldvcmtlcklkVG9TdWJXb3JrZXIgPSBzdWJXb3JrZXJJZFRvU3ViV29ya2VyXztcclxuICAgIH07XHJcbiAgICBcclxuICAgIFN1YldvcmtlckVtdWxhdGlvbkZvckNocm9tZS5wcm90b3R5cGUucG9zdE1lc3NhZ2UgPSBmdW5jdGlvbiBwb3N0TWVzc2FnZShcclxuICAgICAgICBkYXRhLCB0cmFuc2ZlcmFibGVzKSB7XHJcbiAgICAgICAgXHJcbiAgICAgICAgc2VsZi5wb3N0TWVzc2FnZSh7XHJcbiAgICAgICAgICAgIHR5cGU6ICdzdWJXb3JrZXJQb3N0TWVzc2FnZScsXHJcbiAgICAgICAgICAgIHN1YldvcmtlcklkOiB0aGlzLl9zdWJXb3JrZXJJZCxcclxuICAgICAgICAgICAgZGF0YTogZGF0YVxyXG4gICAgICAgIH0sXHJcbiAgICAgICAgdHJhbnNmZXJhYmxlcyk7XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBTdWJXb3JrZXJFbXVsYXRpb25Gb3JDaHJvbWUucHJvdG90eXBlLnRlcm1pbmF0ZSA9IGZ1bmN0aW9uIHRlcm1pbmF0ZShcclxuICAgICAgICBkYXRhLCB0cmFuc2ZlcmFibGVzKSB7XHJcbiAgICAgICAgXHJcbiAgICAgICAgc2VsZi5wb3N0TWVzc2FnZSh7XHJcbiAgICAgICAgICAgIHR5cGU6ICdzdWJXb3JrZXJUZXJtaW5hdGUnLFxyXG4gICAgICAgICAgICBzdWJXb3JrZXJJZDogdGhpcy5fc3ViV29ya2VySWRcclxuICAgICAgICB9LFxyXG4gICAgICAgIHRyYW5zZmVyYWJsZXMpO1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgcmV0dXJuIFN1YldvcmtlckVtdWxhdGlvbkZvckNocm9tZTtcclxufSkoKTtcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gU3ViV29ya2VyRW11bGF0aW9uRm9yQ2hyb21lOyJdfQ==

(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.dependencyWorkers = f()}})(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
'use strict';

module.exports.DependencyWorkers = require('dependency-workers');
module.exports.DependencyWorkersTaskContext = require('dependency-workers-task-context');
module.exports.DependencyWorkersTask = require('dependency-workers-task');
module.exports.WrapperInputRetreiverBase = require('wrapper-input-retreiver-base');
module.exports.SchedulerTask = require('scheduler-task');
module.exports.SchedulerWrapperInputRetreiver = require('scheduler-wrapper-input-retreiver');
module.exports.SchedulerDependencyWorkers = require('scheduler-dependency-workers');
module.exports.DependencyWorkersTaskScheduler = require('dependency-workers-task-scheduler');
},{"dependency-workers":6,"dependency-workers-task":5,"dependency-workers-task-context":2,"dependency-workers-task-scheduler":4,"scheduler-dependency-workers":10,"scheduler-task":11,"scheduler-wrapper-input-retreiver":12,"wrapper-input-retreiver-base":13}],2:[function(require,module,exports){
'use strict';

var DependencyWorkersTaskContext = (function DependencyWorkersTaskContextClosure() {
    function DependencyWorkersTaskContext(taskInternals, callbacks) {
        this._taskInternals = taskInternals;
        this._callbacks = callbacks;
        this._taskContextsIterator = taskInternals.taskContexts.add(this);
		this._priorityCalculatorIterator = null;
    }
    
    DependencyWorkersTaskContext.prototype.hasData = function hasData() {
        return this._taskInternals.hasProcessedData;
    };
    
    DependencyWorkersTaskContext.prototype.getLastData = function getLastData() {
        return this._taskInternals.lastProcessedData;
    };
	
	DependencyWorkersTaskContext.prototype.setPriorityCalculator = function setPriorityCalculator(calculator) {
		if (this._priorityCalculatorIterator !== null) {
			this._taskInternals.priorityCalculators.remove(this._priorityCalculatorIterator);
			this._priorityCalculatorIterator = null;
			if (!calculator && this._taskInternals.priorityCalculators.getCount() === 0) {
				this._taskInternals.unregisterDependPriorityCalculator();
			}
		} else if (calculator && this._taskInternals.priorityCalculators.getCount() === 0) {
			this._taskInternals.registerDependPriorityCalculator();
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
			// Should be called from statusUpdate when worker shut down
			//this._taskInternals.ended();
			
			this._taskInternals.statusUpdate();
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
        this.lastProcessedData = null;
		this.taskApi = null;
        this.hasProcessedData = false;
        
        this.waitingForWorkerResult = false;
        this.isPendingDataForWorker = false;
        this.pendingDataForWorker = null;
        this.pendingWorkerType = 0;
        
        this.taskContexts = new LinkedList();
		this.priorityCalculators = new LinkedList();
        
        this.taskKey = null;
		this._isActualTerminationPending = false;
        this._dependsTasksTerminatedCount = 0;
        this._parentDependencyWorkers = null;
        this._workerInputRetreiver = null;
        this._parentList = null;
        this._parentIterator = null;
        this._dependsTaskContexts = null;
		this._priorityCalculator = null;
		this._isRegisteredDependPriorityCalculator = false;
		
		this._dependTaskKeys = [];
		this._dependTaskResults = [];
		this._hasDependTaskData = [];
		
		this._pendingDelayedAction = false;
		this._pendingDelayedDependencyData = [];
		this._pendingDelayedEnded = false;
		this._pendingDelayedNewData = false;
		this._performPendingDelayedActionsBound = this._performPendingDelayedActions.bind(this);
	}
    
    DependencyWorkersTaskInternals.prototype.initialize = function(
            taskKey, dependencyWorkers, inputRetreiver, list, iterator /*, hasher*/) {
                
        this.taskKey = taskKey;
        this._parentDependencyWorkers = dependencyWorkers;
        this._workerInputRetreiver = inputRetreiver;
        this._parentList = list;
        this._parentIterator = iterator;
        //this._dependsTaskContexts = new HashMap(hasher);
        this._dependsTaskContexts = new JsBuiltinHashMap();
		this.taskApi = new DependencyWorkersTask(this, taskKey);
    };
    
    DependencyWorkersTaskInternals.prototype.ended = function() {
        this._parentList.remove(this._parentIterator);
        this._parentIterator = null;

        var iterator = this._dependsTaskContexts.getFirstIterator();
        while (iterator !== null) {
            var context = this._dependsTaskContexts.getFromIterator(iterator).taskContext;
            iterator = this._dependsTaskContexts.getNextIterator(iterator);
            
            context.unregister();
        }
        this._dependsTaskContexts.clear();

		this._pendingDelayedEnded = true;
		if (!this._pendingDelayedAction) {
			this._pendingDelayedAction = true;
			setTimeout(this._performPendingDelayedActionsBound);
		}
    };
	
    DependencyWorkersTaskInternals.prototype.statusUpdate = function() {
        var status = {
            'hasListeners': this.taskContexts.getCount() > 0,
            'isWaitingForWorkerResult': this.waitingForWorkerResult,
            'terminatedDependsTasks': this._dependsTasksTerminatedCount,
            'dependsTasks': this._dependsTaskContexts.getCount()
        };
        this.taskApi._onEvent('statusUpdated', status);

		if (this._isActualTerminationPending && !this.waitingForWorkerResult) {
			this._isActualTerminationPending = false;
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
            }
            iterator = this.priorityCalculators.getNextIterator(iterator);
        }

        return priority;
    };
    
    DependencyWorkersTaskInternals.prototype.newData = function(data) {
        this.hasProcessedData = true;
        this.lastProcessedData = data;
        
		this._pendingDelayedNewData = true;
		if (!this._pendingDelayedAction) {
			this._pendingDelayedAction = true;
			setTimeout(this._performPendingDelayedActionsBound);
		}
    };
    
	DependencyWorkersTaskInternals.prototype.dataReady = function dataReady(newDataToProcess, workerType) {
		if (this.isTerminated) {
			throw 'dependencyWorkers: already terminated';
		} else if (this.waitingForWorkerResult) {
			// Used in DependencyWorkers._startWorker() when previous worker has finished
			this.pendingDataForWorker = newDataToProcess;
			this.isPendingDataForWorker = true;
			this.pendingWorkerType = workerType;
		} else {
			this._parentDependencyWorkers._dataReady(
				this, newDataToProcess, workerType);
		}
	};

    DependencyWorkersTaskInternals.prototype.terminate = function terminate() {
        if (this.isTerminated) {
            throw 'dependencyWorkers: already terminated';
        }
		
        this.isTerminated = true;
		if (this.waitingForWorkerResult) {
            this._isActualTerminationPending = true;
        } else {
			this.ended();
		}
    };
	
	DependencyWorkersTaskInternals.prototype.registerDependPriorityCalculator = function registerDependPriorityCalculator() {
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
	
	DependencyWorkersTaskInternals.prototype.unregisterDependPriorityCalculator = function registerDependPriorityCalculator() {
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
        var isTerminated = false;
		var index = this._dependTaskKeys.length;
		
		this._dependTaskKeys[index] = taskKey;
        
        addResult.value.taskContext = this._parentDependencyWorkers.startTask(
            taskKey, {
                'onData': onDependencyTaskData,
                'onTerminated': onDependencyTaskTerminated
            }
        );
        
		if (!gotData && addResult.value.taskContext.hasData()) {
			this._pendingDelayedDependencyData.push({
				data: addResult.value.taskContext.getLastData(),
				onDependencyTaskData: onDependencyTaskData
			});
			if (!this._pendingDelayedAction) {
				this._pendingDelayedAction = true;
				setTimeout(this._performPendingDelayedActionsBound);
			}
		}
        
        function onDependencyTaskData(data) {
			that._dependTaskResults[index] = data;
			that._hasDependTaskData[index] = true;
			that.taskApi._onEvent('dependencyTaskData', data, taskKey);
            gotData = true;
        }
        
        function onDependencyTaskTerminated() {
            if (isTerminated) {
                throw 'dependencyWorkers: Double termination';
            }
            isTerminated = true;
            that._dependsTaskTerminated();
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
		
		if (this._pendingDelayedNewData) {
			var contexts = this.taskContexts;
			iterator = contexts.getFirstIterator();
			while (iterator !== null) {
				context = contexts.getFromIterator(iterator);
				iterator = contexts.getNextIterator(iterator);
				
				context._callbacks.onData(this.lastProcessedData, this.taskKey);
			}
		}
		
		if (this._pendingDelayedEnded) {
			iterator = this.taskContexts.getFirstIterator();
			while (iterator !== null) {
				context = this.taskContexts.getFromIterator(iterator);
				iterator = this.taskContexts.getNextIterator(iterator);

				if (context._callbacks.onTerminated) {
					context._callbacks.onTerminated();
				}
			}
			
			this.taskContexts.clear();
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
		this._key = key;
		this._eventListeners = {
			'dependencyTaskData': [],
			'statusUpdated': [],
			'allDependTasksTerminated': []
		};
		
		if (registerWrappedEvents) {
			for (var event in this._eventListeners) {
				this._registerWrappedEvent(event);
			}
		}
	}
	
	DependencyWorkersTask.prototype.dataReady = function dataReady(newDataToProcess, workerType) {
		this._wrapped.dataReady(newDataToProcess, workerType);
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
            
            var hasData = taskContext.hasData();
            var result;
            if (hasData) {
                result = taskContext.getLastData();
            }
            
            function onData(data) {
                hasData = true;
                result = data;
            }
            
            function onTerminated() {
                if (hasData) {
                    resolve(result);
                } else {
                    reject('dependencyWorkers: Internal ' +
                        'error - task terminated but no data returned');
                }
            }
        });
    };
	
	DependencyWorkers.prototype.terminateInactiveWorkers = function() {
		for (var taskType in this._workerPoolByTaskType) {
			var workerPool = this._workerPoolByTaskType[taskType];
			for (var i = 0; i < workerPool; ++i) {
				workerPool[i].terminate();
				workerPool.length = 0;
			}
		}
	};
    
    DependencyWorkers.prototype._dataReady = function dataReady(
			taskInternals, dataToProcess, workerType) {
        
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
				taskInternals.statusUpdate();
				return;
			}
            
			worker = new asyncProxy.AsyncProxyMaster(
                workerArgs.scriptsToImport,
                workerArgs.ctorName,
                workerArgs.ctorArgs);
        }
        
        if (!taskInternals.waitingForWorkerResult) {
            taskInternals.waitingForWorkerResult = true;
            taskInternals.statusUpdate();
        }
        
        worker.callFunction(
                'start',
                [dataToProcess, taskInternals.taskKey],
                {'isReturnPromise': true})
            .then(function(processedData) {
                taskInternals.newData(processedData);
                return processedData;
            }).catch(function(e) {
                console.log('Error in DependencyWorkers\' worker: ' + e);
                return e;
            }).then(function(result) {
                workerPool.push(worker);
                
                if (!that._checkIfPendingData(taskInternals)) {
                    taskInternals.waitingForWorkerResult = false;
                    taskInternals.statusUpdate();
                }
            });
    };
	
	DependencyWorkers.prototype._checkIfPendingData = function checkIfPendingData(taskInternals) {
		if (!taskInternals.isPendingDataForWorker) {
			return false;
		}
		
		var dataToProcess = taskInternals.pendingDataForWorker;
		taskInternals.isPendingDataForWorker = false;
		taskInternals.pendingDataForWorker = null;
		
		this._dataReady(
			taskInternals,
			dataToProcess,
			taskInternals.pendingWorkerType);
		
		return true;
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

var SchedulerWrapperInputRetreiver = require('scheduler-wrapper-input-retreiver');
var DependencyWorkers = require('dependency-workers');

var SchedulerDependencyWorkers = (function SchedulerDependencyWorkersClosure() {
    function SchedulerDependencyWorkers(scheduler, inputRetreiver) {
        var wrapperInputRetreiver = new SchedulerWrapperInputRetreiver(scheduler, inputRetreiver);
        DependencyWorkers.call(this, wrapperInputRetreiver);
    }
    
    SchedulerDependencyWorkers.prototype = Object.create(DependencyWorkers.prototype);
    
    return SchedulerDependencyWorkers;
})();

module.exports = SchedulerDependencyWorkers;
},{"dependency-workers":6,"scheduler-wrapper-input-retreiver":12}],11:[function(require,module,exports){
'use strict';

var DependencyWorkersTask = require('dependency-workers-task');

var SchedulerTask = (function SchedulerTaskClosure() {
    function SchedulerTask(scheduler, inputRetreiver, isDisableWorkerCache, wrappedTask) {
        var that = this;
		DependencyWorkersTask.call(this, wrappedTask, wrappedTask.key, /*registerWrappedEvents=*/true);
        that._scheduler = scheduler;
		that._inputRetreiver = inputRetreiver;
		that._isDisableWorkerCache = isDisableWorkerCache;
		that._wrappedTask = wrappedTask;
        that._onScheduledBound = that._onScheduled.bind(that);
        
		that._jobCallbacks = null;
        that._pendingDataToProcess = null;
		that._pendingWorkerType = 0;
        that._hasPendingDataToProcess = false;
        that._cancelPendingDataToProcess = false;
        that._isWorkerActive = false;
		that._isTerminated = false;
        that._lastStatus = { 'isWaitingForWorkerResult': false };
    }
	
	SchedulerTask.prototype = Object.create(DependencyWorkersTask.prototype);
    
    SchedulerTask.prototype._modifyStatus = function modifyStatus(status) {
        this._lastStatus = JSON.parse(JSON.stringify(status));
        this._checkIfJobDone(status);
        this._lastStatus.isWaitingForWorkerResult =
            status.isWaitingForWorkerResult || this._hasPendingDataToProcess;
        
		return this._lastStatus;
    };
    
    SchedulerTask.prototype.dataReady = function onDataReadyToProcess(
            newDataToProcess, workerType) {
                
        if (this._isTerminated) {
            throw 'dependencyWorkers: Data after termination';
        }
        
        if (this._isDisableWorkerCache[workerType] === undefined) {
			this._isDisableWorkerCache[workerType] = this._inputRetreiver.getWorkerTypeOptions(workerType) === null;
		}
		if (this._isDisableWorkerCache[workerType]) {
            this._pendingDataToProcess = null;
            this._cancelPendingDataToProcess =
                this._hasPendingDataToProcess && !this._isWorkerActive;
            this._hasPendingDataToProcess = false;
            DependencyWorkersTask.prototype.dataReady.call(this, newDataToProcess, workerType);
            
            var isStatusChanged =
                this._lastStatus.isWaitingForWorkerResult &&
                !this._hasPendingDataToProcess;
            if (isStatusChanged) {
                this._lastStatus.isWaitingForWorkerResult = false;
                this._onEvent('statusUpdated', this._lastStatus);
            }
            
            return;
        }
        
        this._pendingDataToProcess = newDataToProcess;
		this._pendingWorkerType = workerType;
        this._cancelPendingDataToProcess = false;
        var hadPendingDataToProcess = this._hasPendingDataToProcess;
        this._hasPendingDataToProcess = true;

        if (!hadPendingDataToProcess && !this._isWorkerActive) {
            this._scheduler.enqueueJob(
                this._onScheduledBound, this);
        }
    };
    
    SchedulerTask.prototype.terminate = function terminate() {
        if (this._isTerminated) {
            throw 'dependencyWorkers: Double termination';
        }
        
        this._isTerminated = true;
        if (!this._hasPendingDataToProcess) {
			DependencyWorkersTask.prototype.terminate.call(this);
		}
    };
    
    SchedulerTask.prototype._onScheduled = function dataReadyForWorker(
            resource, jobContext, jobCallbacks) {
                
        if (jobContext !== this) {
            throw 'dependencyWorkers: Unexpected context';
        }
        
        if (this._cancelPendingDataToProcess) {
            this._cancelPendingDataToProcess = false;
			jobCallbacks.jobDone();
        } else {
			if (!this._hasPendingDataToProcess) {
				throw 'dependencyWorkers: !enqueuedProcessJob';
			}
			
			this._isWorkerActive = true;
			this._hasPendingDataToProcess = false;
			this._jobCallbacks = jobCallbacks;
			var data = this._pendingDataToProcess;
			this._pendingDataToProcess = null;
			DependencyWorkersTask.prototype.dataReady.call(this, data, this._pendingWorkerType);
		}
		
		if (this._isTerminated) {
			DependencyWorkersTask.prototype.terminate.call(this);
		}
    };
    
    SchedulerTask.prototype._checkIfJobDone = function checkIfJobDone(status) {
        if (!this._isWorkerActive || status.isWaitingForWorkerResult) {
            return;
        }
        
        if (this._cancelPendingDataToProcess) {
            throw 'dependencyWorkers: cancelPendingDataToProcess';
        }
        
        this._isWorkerActive = false;
        
		var jobCallbacks = this._jobCallbacks;
		this._jobCallbacks = null;
		
        if (this._hasPendingDataToProcess) {
            this._scheduler.enqueueJob(
                this._onScheduledBound, this);
        }

        jobCallbacks.jobDone();
    };
    
    return SchedulerTask;
})();

module.exports = SchedulerTask;
},{"dependency-workers-task":5}],12:[function(require,module,exports){
'use strict';

var SchedulerTask = require('scheduler-task');
var WrapperInputRetreiverBase = require('wrapper-input-retreiver-base');

var SchedulerWrapperInputRetreiver = (function SchedulerWrapperInputRetreiverClosure() {
    function SchedulerWrapperInputRetreiver(scheduler, inputRetreiver) {
        WrapperInputRetreiverBase.call(this, inputRetreiver);
        var that = this;
        that._scheduler = scheduler;
		that._inputRetreiver = inputRetreiver;
		that._isDisableWorkerCache = {};

        if (!inputRetreiver.taskStarted) {
            throw 'dependencyWorkers: No ' +
                'inputRetreiver.taskStarted() method';
        }
    }
    
    SchedulerWrapperInputRetreiver.prototype = Object.create(WrapperInputRetreiverBase.prototype);
    
    SchedulerWrapperInputRetreiver.prototype.taskStarted =
            function taskStarted(task) {
        
        var wrapperTask = new SchedulerTask(
			this._scheduler, this._inputRetreiver, this._isDisableWorkerCache, task);
        return this._inputRetreiver.taskStarted(wrapperTask);
    };
    
    return SchedulerWrapperInputRetreiver;
})();

module.exports = SchedulerWrapperInputRetreiver;
},{"scheduler-task":11,"wrapper-input-retreiver-base":13}],13:[function(require,module,exports){
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJzcmMvZGVwZW5kZW5jeS13b3JrZXJzLWV4cG9ydHMuanMiLCJzcmMvZGVwZW5kZW5jeS13b3JrZXJzLXRhc2stY29udGV4dC5qcyIsInNyYy9kZXBlbmRlbmN5LXdvcmtlcnMtdGFzay1pbnRlcm5hbHMuanMiLCJzcmMvZGVwZW5kZW5jeS13b3JrZXJzLXRhc2stc2NoZWR1bGVyLmpzIiwic3JjL2RlcGVuZGVuY3ktd29ya2Vycy10YXNrLmpzIiwic3JjL2RlcGVuZGVuY3ktd29ya2Vycy5qcyIsInNyYy9oYXNoLW1hcC5qcyIsInNyYy9qcy1idWlsdGluLWhhc2gtbWFwLmpzIiwic3JjL2xpbmtlZC1saXN0LmpzIiwic3JjL3NjaGVkdWxlci1kZXBlbmRlbmN5LXdvcmtlcnMuanMiLCJzcmMvc2NoZWR1bGVyLXRhc2suanMiLCJzcmMvc2NoZWR1bGVyLXdyYXBwZXItaW5wdXQtcmV0cmVpdmVyLmpzIiwic3JjL3dyYXBwZXItaW5wdXQtcmV0cmVpdmVyLWJhc2UuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7QUNBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNUQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3ZEQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzFTQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNsQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDcEZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMxS0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNwSkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM1QkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNwR0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNoQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMzSUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2hDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EiLCJmaWxlIjoiZ2VuZXJhdGVkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXNDb250ZW50IjpbIihmdW5jdGlvbiBlKHQsbixyKXtmdW5jdGlvbiBzKG8sdSl7aWYoIW5bb10pe2lmKCF0W29dKXt2YXIgYT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2lmKCF1JiZhKXJldHVybiBhKG8sITApO2lmKGkpcmV0dXJuIGkobywhMCk7dmFyIGY9bmV3IEVycm9yKFwiQ2Fubm90IGZpbmQgbW9kdWxlICdcIitvK1wiJ1wiKTt0aHJvdyBmLmNvZGU9XCJNT0RVTEVfTk9UX0ZPVU5EXCIsZn12YXIgbD1uW29dPXtleHBvcnRzOnt9fTt0W29dWzBdLmNhbGwobC5leHBvcnRzLGZ1bmN0aW9uKGUpe3ZhciBuPXRbb11bMV1bZV07cmV0dXJuIHMobj9uOmUpfSxsLGwuZXhwb3J0cyxlLHQsbixyKX1yZXR1cm4gbltvXS5leHBvcnRzfXZhciBpPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7Zm9yKHZhciBvPTA7bzxyLmxlbmd0aDtvKyspcyhyW29dKTtyZXR1cm4gc30pIiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxubW9kdWxlLmV4cG9ydHMuRGVwZW5kZW5jeVdvcmtlcnMgPSByZXF1aXJlKCdkZXBlbmRlbmN5LXdvcmtlcnMnKTtcclxubW9kdWxlLmV4cG9ydHMuRGVwZW5kZW5jeVdvcmtlcnNUYXNrQ29udGV4dCA9IHJlcXVpcmUoJ2RlcGVuZGVuY3ktd29ya2Vycy10YXNrLWNvbnRleHQnKTtcclxubW9kdWxlLmV4cG9ydHMuRGVwZW5kZW5jeVdvcmtlcnNUYXNrID0gcmVxdWlyZSgnZGVwZW5kZW5jeS13b3JrZXJzLXRhc2snKTtcclxubW9kdWxlLmV4cG9ydHMuV3JhcHBlcklucHV0UmV0cmVpdmVyQmFzZSA9IHJlcXVpcmUoJ3dyYXBwZXItaW5wdXQtcmV0cmVpdmVyLWJhc2UnKTtcclxubW9kdWxlLmV4cG9ydHMuU2NoZWR1bGVyVGFzayA9IHJlcXVpcmUoJ3NjaGVkdWxlci10YXNrJyk7XHJcbm1vZHVsZS5leHBvcnRzLlNjaGVkdWxlcldyYXBwZXJJbnB1dFJldHJlaXZlciA9IHJlcXVpcmUoJ3NjaGVkdWxlci13cmFwcGVyLWlucHV0LXJldHJlaXZlcicpO1xyXG5tb2R1bGUuZXhwb3J0cy5TY2hlZHVsZXJEZXBlbmRlbmN5V29ya2VycyA9IHJlcXVpcmUoJ3NjaGVkdWxlci1kZXBlbmRlbmN5LXdvcmtlcnMnKTtcclxubW9kdWxlLmV4cG9ydHMuRGVwZW5kZW5jeVdvcmtlcnNUYXNrU2NoZWR1bGVyID0gcmVxdWlyZSgnZGVwZW5kZW5jeS13b3JrZXJzLXRhc2stc2NoZWR1bGVyJyk7IiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxudmFyIERlcGVuZGVuY3lXb3JrZXJzVGFza0NvbnRleHQgPSAoZnVuY3Rpb24gRGVwZW5kZW5jeVdvcmtlcnNUYXNrQ29udGV4dENsb3N1cmUoKSB7XHJcbiAgICBmdW5jdGlvbiBEZXBlbmRlbmN5V29ya2Vyc1Rhc2tDb250ZXh0KHRhc2tJbnRlcm5hbHMsIGNhbGxiYWNrcykge1xyXG4gICAgICAgIHRoaXMuX3Rhc2tJbnRlcm5hbHMgPSB0YXNrSW50ZXJuYWxzO1xyXG4gICAgICAgIHRoaXMuX2NhbGxiYWNrcyA9IGNhbGxiYWNrcztcclxuICAgICAgICB0aGlzLl90YXNrQ29udGV4dHNJdGVyYXRvciA9IHRhc2tJbnRlcm5hbHMudGFza0NvbnRleHRzLmFkZCh0aGlzKTtcclxuXHRcdHRoaXMuX3ByaW9yaXR5Q2FsY3VsYXRvckl0ZXJhdG9yID0gbnVsbDtcclxuICAgIH1cclxuICAgIFxyXG4gICAgRGVwZW5kZW5jeVdvcmtlcnNUYXNrQ29udGV4dC5wcm90b3R5cGUuaGFzRGF0YSA9IGZ1bmN0aW9uIGhhc0RhdGEoKSB7XHJcbiAgICAgICAgcmV0dXJuIHRoaXMuX3Rhc2tJbnRlcm5hbHMuaGFzUHJvY2Vzc2VkRGF0YTtcclxuICAgIH07XHJcbiAgICBcclxuICAgIERlcGVuZGVuY3lXb3JrZXJzVGFza0NvbnRleHQucHJvdG90eXBlLmdldExhc3REYXRhID0gZnVuY3Rpb24gZ2V0TGFzdERhdGEoKSB7XHJcbiAgICAgICAgcmV0dXJuIHRoaXMuX3Rhc2tJbnRlcm5hbHMubGFzdFByb2Nlc3NlZERhdGE7XHJcbiAgICB9O1xyXG5cdFxyXG5cdERlcGVuZGVuY3lXb3JrZXJzVGFza0NvbnRleHQucHJvdG90eXBlLnNldFByaW9yaXR5Q2FsY3VsYXRvciA9IGZ1bmN0aW9uIHNldFByaW9yaXR5Q2FsY3VsYXRvcihjYWxjdWxhdG9yKSB7XHJcblx0XHRpZiAodGhpcy5fcHJpb3JpdHlDYWxjdWxhdG9ySXRlcmF0b3IgIT09IG51bGwpIHtcclxuXHRcdFx0dGhpcy5fdGFza0ludGVybmFscy5wcmlvcml0eUNhbGN1bGF0b3JzLnJlbW92ZSh0aGlzLl9wcmlvcml0eUNhbGN1bGF0b3JJdGVyYXRvcik7XHJcblx0XHRcdHRoaXMuX3ByaW9yaXR5Q2FsY3VsYXRvckl0ZXJhdG9yID0gbnVsbDtcclxuXHRcdFx0aWYgKCFjYWxjdWxhdG9yICYmIHRoaXMuX3Rhc2tJbnRlcm5hbHMucHJpb3JpdHlDYWxjdWxhdG9ycy5nZXRDb3VudCgpID09PSAwKSB7XHJcblx0XHRcdFx0dGhpcy5fdGFza0ludGVybmFscy51bnJlZ2lzdGVyRGVwZW5kUHJpb3JpdHlDYWxjdWxhdG9yKCk7XHJcblx0XHRcdH1cclxuXHRcdH0gZWxzZSBpZiAoY2FsY3VsYXRvciAmJiB0aGlzLl90YXNrSW50ZXJuYWxzLnByaW9yaXR5Q2FsY3VsYXRvcnMuZ2V0Q291bnQoKSA9PT0gMCkge1xyXG5cdFx0XHR0aGlzLl90YXNrSW50ZXJuYWxzLnJlZ2lzdGVyRGVwZW5kUHJpb3JpdHlDYWxjdWxhdG9yKCk7XHJcblx0XHR9XHJcblx0XHRcclxuXHRcdGlmIChjYWxjdWxhdG9yKSB7XHJcblx0XHRcdHRoaXMuX3ByaW9yaXR5Q2FsY3VsYXRvckl0ZXJhdG9yID0gdGhpcy5fdGFza0ludGVybmFscy5wcmlvcml0eUNhbGN1bGF0b3JzLmFkZChjYWxjdWxhdG9yKTtcclxuXHRcdH1cclxuXHR9O1xyXG4gICAgXHJcbiAgICBEZXBlbmRlbmN5V29ya2Vyc1Rhc2tDb250ZXh0LnByb3RvdHlwZS51bnJlZ2lzdGVyID0gZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgaWYgKCF0aGlzLl90YXNrQ29udGV4dHNJdGVyYXRvcikge1xyXG4gICAgICAgICAgICB0aHJvdyAnZGVwZW5kZW5jeVdvcmtlcnM6IEFscmVhZHkgdW5yZWdpc3RlcmVkJztcclxuICAgICAgICB9XHJcblx0XHRcclxuXHRcdHRoaXMuc2V0UHJpb3JpdHlDYWxjdWxhdG9yKG51bGwpO1xyXG5cdFx0XHJcbiAgICAgICAgdGhpcy5fdGFza0ludGVybmFscy50YXNrQ29udGV4dHMucmVtb3ZlKHRoaXMuX3Rhc2tDb250ZXh0c0l0ZXJhdG9yKTtcclxuICAgICAgICB0aGlzLl90YXNrQ29udGV4dHNJdGVyYXRvciA9IG51bGw7XHJcbiAgICAgICAgXHJcblx0XHRpZiAoIXRoaXMuX3Rhc2tJbnRlcm5hbHMuaXNUZXJtaW5hdGVkKSB7XHJcblx0XHRcdC8vIFNob3VsZCBiZSBjYWxsZWQgZnJvbSBzdGF0dXNVcGRhdGUgd2hlbiB3b3JrZXIgc2h1dCBkb3duXHJcblx0XHRcdC8vdGhpcy5fdGFza0ludGVybmFscy5lbmRlZCgpO1xyXG5cdFx0XHRcclxuXHRcdFx0dGhpcy5fdGFza0ludGVybmFscy5zdGF0dXNVcGRhdGUoKTtcclxuXHRcdH1cclxuICAgIH07XHJcblxyXG4gICAgcmV0dXJuIERlcGVuZGVuY3lXb3JrZXJzVGFza0NvbnRleHQ7XHJcbn0pKCk7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IERlcGVuZGVuY3lXb3JrZXJzVGFza0NvbnRleHQ7IiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxudmFyIExpbmtlZExpc3QgPSByZXF1aXJlKCdsaW5rZWQtbGlzdCcpO1xyXG52YXIgSnNCdWlsdGluSGFzaE1hcCA9IHJlcXVpcmUoJ2pzLWJ1aWx0aW4taGFzaC1tYXAnKTtcclxudmFyIERlcGVuZGVuY3lXb3JrZXJzVGFzayA9IHJlcXVpcmUoJ2RlcGVuZGVuY3ktd29ya2Vycy10YXNrJyk7XHJcblxyXG52YXIgRGVwZW5kZW5jeVdvcmtlcnNUYXNrSW50ZXJuYWxzID0gKGZ1bmN0aW9uIERlcGVuZGVuY3lXb3JrZXJzVGFza0ludGVybmFsc0Nsb3N1cmUoKSB7XHJcblx0ZnVuY3Rpb24gRGVwZW5kZW5jeVdvcmtlcnNUYXNrSW50ZXJuYWxzKCkge1xyXG4gICAgICAgIC8vIFRoaXMgY2xhc3MgaXMgbm90IGV4cG9zZWQgb3V0c2lkZSBkZXBlbmRlbmN5V29ya2VycyBidXQgYXMgYW4gaW50ZXJuYWwgc3RydWN0LCB0aHVzIFxyXG4gICAgICAgIC8vIG1heSBjb250YWluIHB1YmxpYyBtZW1iZXJzXHJcbiAgICAgICAgXHJcbiAgICAgICAgdGhpcy5pc1Rlcm1pbmF0ZWQgPSBmYWxzZTtcclxuICAgICAgICB0aGlzLmxhc3RQcm9jZXNzZWREYXRhID0gbnVsbDtcclxuXHRcdHRoaXMudGFza0FwaSA9IG51bGw7XHJcbiAgICAgICAgdGhpcy5oYXNQcm9jZXNzZWREYXRhID0gZmFsc2U7XHJcbiAgICAgICAgXHJcbiAgICAgICAgdGhpcy53YWl0aW5nRm9yV29ya2VyUmVzdWx0ID0gZmFsc2U7XHJcbiAgICAgICAgdGhpcy5pc1BlbmRpbmdEYXRhRm9yV29ya2VyID0gZmFsc2U7XHJcbiAgICAgICAgdGhpcy5wZW5kaW5nRGF0YUZvcldvcmtlciA9IG51bGw7XHJcbiAgICAgICAgdGhpcy5wZW5kaW5nV29ya2VyVHlwZSA9IDA7XHJcbiAgICAgICAgXHJcbiAgICAgICAgdGhpcy50YXNrQ29udGV4dHMgPSBuZXcgTGlua2VkTGlzdCgpO1xyXG5cdFx0dGhpcy5wcmlvcml0eUNhbGN1bGF0b3JzID0gbmV3IExpbmtlZExpc3QoKTtcclxuICAgICAgICBcclxuICAgICAgICB0aGlzLnRhc2tLZXkgPSBudWxsO1xyXG5cdFx0dGhpcy5faXNBY3R1YWxUZXJtaW5hdGlvblBlbmRpbmcgPSBmYWxzZTtcclxuICAgICAgICB0aGlzLl9kZXBlbmRzVGFza3NUZXJtaW5hdGVkQ291bnQgPSAwO1xyXG4gICAgICAgIHRoaXMuX3BhcmVudERlcGVuZGVuY3lXb3JrZXJzID0gbnVsbDtcclxuICAgICAgICB0aGlzLl93b3JrZXJJbnB1dFJldHJlaXZlciA9IG51bGw7XHJcbiAgICAgICAgdGhpcy5fcGFyZW50TGlzdCA9IG51bGw7XHJcbiAgICAgICAgdGhpcy5fcGFyZW50SXRlcmF0b3IgPSBudWxsO1xyXG4gICAgICAgIHRoaXMuX2RlcGVuZHNUYXNrQ29udGV4dHMgPSBudWxsO1xyXG5cdFx0dGhpcy5fcHJpb3JpdHlDYWxjdWxhdG9yID0gbnVsbDtcclxuXHRcdHRoaXMuX2lzUmVnaXN0ZXJlZERlcGVuZFByaW9yaXR5Q2FsY3VsYXRvciA9IGZhbHNlO1xyXG5cdFx0XHJcblx0XHR0aGlzLl9kZXBlbmRUYXNrS2V5cyA9IFtdO1xyXG5cdFx0dGhpcy5fZGVwZW5kVGFza1Jlc3VsdHMgPSBbXTtcclxuXHRcdHRoaXMuX2hhc0RlcGVuZFRhc2tEYXRhID0gW107XHJcblx0XHRcclxuXHRcdHRoaXMuX3BlbmRpbmdEZWxheWVkQWN0aW9uID0gZmFsc2U7XHJcblx0XHR0aGlzLl9wZW5kaW5nRGVsYXllZERlcGVuZGVuY3lEYXRhID0gW107XHJcblx0XHR0aGlzLl9wZW5kaW5nRGVsYXllZEVuZGVkID0gZmFsc2U7XHJcblx0XHR0aGlzLl9wZW5kaW5nRGVsYXllZE5ld0RhdGEgPSBmYWxzZTtcclxuXHRcdHRoaXMuX3BlcmZvcm1QZW5kaW5nRGVsYXllZEFjdGlvbnNCb3VuZCA9IHRoaXMuX3BlcmZvcm1QZW5kaW5nRGVsYXllZEFjdGlvbnMuYmluZCh0aGlzKTtcclxuXHR9XHJcbiAgICBcclxuICAgIERlcGVuZGVuY3lXb3JrZXJzVGFza0ludGVybmFscy5wcm90b3R5cGUuaW5pdGlhbGl6ZSA9IGZ1bmN0aW9uKFxyXG4gICAgICAgICAgICB0YXNrS2V5LCBkZXBlbmRlbmN5V29ya2VycywgaW5wdXRSZXRyZWl2ZXIsIGxpc3QsIGl0ZXJhdG9yIC8qLCBoYXNoZXIqLykge1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgdGhpcy50YXNrS2V5ID0gdGFza0tleTtcclxuICAgICAgICB0aGlzLl9wYXJlbnREZXBlbmRlbmN5V29ya2VycyA9IGRlcGVuZGVuY3lXb3JrZXJzO1xyXG4gICAgICAgIHRoaXMuX3dvcmtlcklucHV0UmV0cmVpdmVyID0gaW5wdXRSZXRyZWl2ZXI7XHJcbiAgICAgICAgdGhpcy5fcGFyZW50TGlzdCA9IGxpc3Q7XHJcbiAgICAgICAgdGhpcy5fcGFyZW50SXRlcmF0b3IgPSBpdGVyYXRvcjtcclxuICAgICAgICAvL3RoaXMuX2RlcGVuZHNUYXNrQ29udGV4dHMgPSBuZXcgSGFzaE1hcChoYXNoZXIpO1xyXG4gICAgICAgIHRoaXMuX2RlcGVuZHNUYXNrQ29udGV4dHMgPSBuZXcgSnNCdWlsdGluSGFzaE1hcCgpO1xyXG5cdFx0dGhpcy50YXNrQXBpID0gbmV3IERlcGVuZGVuY3lXb3JrZXJzVGFzayh0aGlzLCB0YXNrS2V5KTtcclxuICAgIH07XHJcbiAgICBcclxuICAgIERlcGVuZGVuY3lXb3JrZXJzVGFza0ludGVybmFscy5wcm90b3R5cGUuZW5kZWQgPSBmdW5jdGlvbigpIHtcclxuICAgICAgICB0aGlzLl9wYXJlbnRMaXN0LnJlbW92ZSh0aGlzLl9wYXJlbnRJdGVyYXRvcik7XHJcbiAgICAgICAgdGhpcy5fcGFyZW50SXRlcmF0b3IgPSBudWxsO1xyXG5cclxuICAgICAgICB2YXIgaXRlcmF0b3IgPSB0aGlzLl9kZXBlbmRzVGFza0NvbnRleHRzLmdldEZpcnN0SXRlcmF0b3IoKTtcclxuICAgICAgICB3aGlsZSAoaXRlcmF0b3IgIT09IG51bGwpIHtcclxuICAgICAgICAgICAgdmFyIGNvbnRleHQgPSB0aGlzLl9kZXBlbmRzVGFza0NvbnRleHRzLmdldEZyb21JdGVyYXRvcihpdGVyYXRvcikudGFza0NvbnRleHQ7XHJcbiAgICAgICAgICAgIGl0ZXJhdG9yID0gdGhpcy5fZGVwZW5kc1Rhc2tDb250ZXh0cy5nZXROZXh0SXRlcmF0b3IoaXRlcmF0b3IpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgY29udGV4dC51bnJlZ2lzdGVyKCk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHRoaXMuX2RlcGVuZHNUYXNrQ29udGV4dHMuY2xlYXIoKTtcclxuXHJcblx0XHR0aGlzLl9wZW5kaW5nRGVsYXllZEVuZGVkID0gdHJ1ZTtcclxuXHRcdGlmICghdGhpcy5fcGVuZGluZ0RlbGF5ZWRBY3Rpb24pIHtcclxuXHRcdFx0dGhpcy5fcGVuZGluZ0RlbGF5ZWRBY3Rpb24gPSB0cnVlO1xyXG5cdFx0XHRzZXRUaW1lb3V0KHRoaXMuX3BlcmZvcm1QZW5kaW5nRGVsYXllZEFjdGlvbnNCb3VuZCk7XHJcblx0XHR9XHJcbiAgICB9O1xyXG5cdFxyXG4gICAgRGVwZW5kZW5jeVdvcmtlcnNUYXNrSW50ZXJuYWxzLnByb3RvdHlwZS5zdGF0dXNVcGRhdGUgPSBmdW5jdGlvbigpIHtcclxuICAgICAgICB2YXIgc3RhdHVzID0ge1xyXG4gICAgICAgICAgICAnaGFzTGlzdGVuZXJzJzogdGhpcy50YXNrQ29udGV4dHMuZ2V0Q291bnQoKSA+IDAsXHJcbiAgICAgICAgICAgICdpc1dhaXRpbmdGb3JXb3JrZXJSZXN1bHQnOiB0aGlzLndhaXRpbmdGb3JXb3JrZXJSZXN1bHQsXHJcbiAgICAgICAgICAgICd0ZXJtaW5hdGVkRGVwZW5kc1Rhc2tzJzogdGhpcy5fZGVwZW5kc1Rhc2tzVGVybWluYXRlZENvdW50LFxyXG4gICAgICAgICAgICAnZGVwZW5kc1Rhc2tzJzogdGhpcy5fZGVwZW5kc1Rhc2tDb250ZXh0cy5nZXRDb3VudCgpXHJcbiAgICAgICAgfTtcclxuICAgICAgICB0aGlzLnRhc2tBcGkuX29uRXZlbnQoJ3N0YXR1c1VwZGF0ZWQnLCBzdGF0dXMpO1xyXG5cclxuXHRcdGlmICh0aGlzLl9pc0FjdHVhbFRlcm1pbmF0aW9uUGVuZGluZyAmJiAhdGhpcy53YWl0aW5nRm9yV29ya2VyUmVzdWx0KSB7XHJcblx0XHRcdHRoaXMuX2lzQWN0dWFsVGVybWluYXRpb25QZW5kaW5nID0gZmFsc2U7XHJcblx0XHRcdHRoaXMuZW5kZWQoKTtcclxuXHRcdH1cclxuXHR9O1xyXG4gICAgXHJcbiAgICBEZXBlbmRlbmN5V29ya2Vyc1Rhc2tJbnRlcm5hbHMucHJvdG90eXBlLmNhbGN1bGF0ZVByaW9yaXR5ID0gZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgXHJcbiAgICAgICAgdmFyIGl0ZXJhdG9yID0gdGhpcy5wcmlvcml0eUNhbGN1bGF0b3JzLmdldEZpcnN0SXRlcmF0b3IoKTtcclxuICAgICAgICB2YXIgaXNGaXJzdCA9IHRydWU7XHJcbiAgICAgICAgdmFyIHByaW9yaXR5ID0gMDtcclxuICAgICAgICB3aGlsZSAoaXRlcmF0b3IgIT09IG51bGwpIHtcclxuICAgICAgICAgICAgdmFyIHByaW9yaXR5Q2FsY3VsYXRvciA9IHRoaXMucHJpb3JpdHlDYWxjdWxhdG9ycy5nZXRGcm9tSXRlcmF0b3IoaXRlcmF0b3IpO1xyXG5cdFx0XHR2YXIgY3VycmVudFByaW9yaXR5ID0gcHJpb3JpdHlDYWxjdWxhdG9yKCk7XHJcbiAgICAgICAgICAgIGlmIChpc0ZpcnN0IHx8IGN1cnJlbnRQcmlvcml0eSA+IHByaW9yaXR5KSB7XHJcbiAgICAgICAgICAgICAgICBwcmlvcml0eSA9IGN1cnJlbnRQcmlvcml0eTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBpdGVyYXRvciA9IHRoaXMucHJpb3JpdHlDYWxjdWxhdG9ycy5nZXROZXh0SXRlcmF0b3IoaXRlcmF0b3IpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgcmV0dXJuIHByaW9yaXR5O1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgRGVwZW5kZW5jeVdvcmtlcnNUYXNrSW50ZXJuYWxzLnByb3RvdHlwZS5uZXdEYXRhID0gZnVuY3Rpb24oZGF0YSkge1xyXG4gICAgICAgIHRoaXMuaGFzUHJvY2Vzc2VkRGF0YSA9IHRydWU7XHJcbiAgICAgICAgdGhpcy5sYXN0UHJvY2Vzc2VkRGF0YSA9IGRhdGE7XHJcbiAgICAgICAgXHJcblx0XHR0aGlzLl9wZW5kaW5nRGVsYXllZE5ld0RhdGEgPSB0cnVlO1xyXG5cdFx0aWYgKCF0aGlzLl9wZW5kaW5nRGVsYXllZEFjdGlvbikge1xyXG5cdFx0XHR0aGlzLl9wZW5kaW5nRGVsYXllZEFjdGlvbiA9IHRydWU7XHJcblx0XHRcdHNldFRpbWVvdXQodGhpcy5fcGVyZm9ybVBlbmRpbmdEZWxheWVkQWN0aW9uc0JvdW5kKTtcclxuXHRcdH1cclxuICAgIH07XHJcbiAgICBcclxuXHREZXBlbmRlbmN5V29ya2Vyc1Rhc2tJbnRlcm5hbHMucHJvdG90eXBlLmRhdGFSZWFkeSA9IGZ1bmN0aW9uIGRhdGFSZWFkeShuZXdEYXRhVG9Qcm9jZXNzLCB3b3JrZXJUeXBlKSB7XHJcblx0XHRpZiAodGhpcy5pc1Rlcm1pbmF0ZWQpIHtcclxuXHRcdFx0dGhyb3cgJ2RlcGVuZGVuY3lXb3JrZXJzOiBhbHJlYWR5IHRlcm1pbmF0ZWQnO1xyXG5cdFx0fSBlbHNlIGlmICh0aGlzLndhaXRpbmdGb3JXb3JrZXJSZXN1bHQpIHtcclxuXHRcdFx0Ly8gVXNlZCBpbiBEZXBlbmRlbmN5V29ya2Vycy5fc3RhcnRXb3JrZXIoKSB3aGVuIHByZXZpb3VzIHdvcmtlciBoYXMgZmluaXNoZWRcclxuXHRcdFx0dGhpcy5wZW5kaW5nRGF0YUZvcldvcmtlciA9IG5ld0RhdGFUb1Byb2Nlc3M7XHJcblx0XHRcdHRoaXMuaXNQZW5kaW5nRGF0YUZvcldvcmtlciA9IHRydWU7XHJcblx0XHRcdHRoaXMucGVuZGluZ1dvcmtlclR5cGUgPSB3b3JrZXJUeXBlO1xyXG5cdFx0fSBlbHNlIHtcclxuXHRcdFx0dGhpcy5fcGFyZW50RGVwZW5kZW5jeVdvcmtlcnMuX2RhdGFSZWFkeShcclxuXHRcdFx0XHR0aGlzLCBuZXdEYXRhVG9Qcm9jZXNzLCB3b3JrZXJUeXBlKTtcclxuXHRcdH1cclxuXHR9O1xyXG5cclxuICAgIERlcGVuZGVuY3lXb3JrZXJzVGFza0ludGVybmFscy5wcm90b3R5cGUudGVybWluYXRlID0gZnVuY3Rpb24gdGVybWluYXRlKCkge1xyXG4gICAgICAgIGlmICh0aGlzLmlzVGVybWluYXRlZCkge1xyXG4gICAgICAgICAgICB0aHJvdyAnZGVwZW5kZW5jeVdvcmtlcnM6IGFscmVhZHkgdGVybWluYXRlZCc7XHJcbiAgICAgICAgfVxyXG5cdFx0XHJcbiAgICAgICAgdGhpcy5pc1Rlcm1pbmF0ZWQgPSB0cnVlO1xyXG5cdFx0aWYgKHRoaXMud2FpdGluZ0ZvcldvcmtlclJlc3VsdCkge1xyXG4gICAgICAgICAgICB0aGlzLl9pc0FjdHVhbFRlcm1pbmF0aW9uUGVuZGluZyA9IHRydWU7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuXHRcdFx0dGhpcy5lbmRlZCgpO1xyXG5cdFx0fVxyXG4gICAgfTtcclxuXHRcclxuXHREZXBlbmRlbmN5V29ya2Vyc1Rhc2tJbnRlcm5hbHMucHJvdG90eXBlLnJlZ2lzdGVyRGVwZW5kUHJpb3JpdHlDYWxjdWxhdG9yID0gZnVuY3Rpb24gcmVnaXN0ZXJEZXBlbmRQcmlvcml0eUNhbGN1bGF0b3IoKSB7XHJcblx0XHRpZiAodGhpcy5faXNSZWdpc3RlcmVkRGVwZW5kUHJpb3JpdHlDYWxjdWxhdG9yKSB7XHJcblx0XHRcdHRocm93ICdkZXBlbmRlbmN5V29ya2VyczogYWxyZWFkeSByZWdpc3RlcmVkIGRlcGVuZCBwcmlvcml0eSBjYWxjdWxhdG9yJztcclxuXHRcdH1cclxuXHRcdGlmICh0aGlzLl9wcmlvcml0eUNhbGN1bGF0b3IgPT09IG51bGwpIHtcclxuXHRcdFx0dGhpcy5fcHJpb3JpdHlDYWxjdWxhdG9yID0gdGhpcy5jYWxjdWxhdGVQcmlvcml0eS5iaW5kKHRoaXMpO1xyXG5cdFx0fVxyXG5cdFx0dGhpcy5faXNSZWdpc3RlcmVkRGVwZW5kUHJpb3JpdHlDYWxjdWxhdG9yID0gdHJ1ZTtcclxuXHRcdFxyXG4gICAgICAgIHZhciBpdGVyYXRvciA9IHRoaXMuX2RlcGVuZHNUYXNrQ29udGV4dHMuZ2V0Rmlyc3RJdGVyYXRvcigpO1xyXG4gICAgICAgIHdoaWxlIChpdGVyYXRvciAhPT0gbnVsbCkge1xyXG4gICAgICAgICAgICB2YXIgY29udGV4dCA9IHRoaXMuX2RlcGVuZHNUYXNrQ29udGV4dHMuZ2V0RnJvbUl0ZXJhdG9yKGl0ZXJhdG9yKS50YXNrQ29udGV4dDtcclxuICAgICAgICAgICAgaXRlcmF0b3IgPSB0aGlzLl9kZXBlbmRzVGFza0NvbnRleHRzLmdldE5leHRJdGVyYXRvcihpdGVyYXRvcik7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBjb250ZXh0LnNldFByaW9yaXR5Q2FsY3VsYXRvcih0aGlzLl9wcmlvcml0eUNhbGN1bGF0b3IpO1xyXG4gICAgICAgIH1cclxuXHR9O1xyXG5cdFxyXG5cdERlcGVuZGVuY3lXb3JrZXJzVGFza0ludGVybmFscy5wcm90b3R5cGUudW5yZWdpc3RlckRlcGVuZFByaW9yaXR5Q2FsY3VsYXRvciA9IGZ1bmN0aW9uIHJlZ2lzdGVyRGVwZW5kUHJpb3JpdHlDYWxjdWxhdG9yKCkge1xyXG5cdFx0aWYgKCF0aGlzLl9pc1JlZ2lzdGVyZWREZXBlbmRQcmlvcml0eUNhbGN1bGF0b3IpIHtcclxuXHRcdFx0dGhyb3cgJ2RlcGVuZGVuY3lXb3JrZXJzOiBub3QgcmVnaXN0ZXJlZCBkZXBlbmQgcHJpb3JpdHkgY2FsY3VsYXRvcic7XHJcblx0XHR9XHJcblx0XHR0aGlzLl9pc1JlZ2lzdGVyZWREZXBlbmRQcmlvcml0eUNhbGN1bGF0b3IgPSBmYWxzZTtcclxuXHRcdFxyXG4gICAgICAgIHZhciBpdGVyYXRvciA9IHRoaXMuX2RlcGVuZHNUYXNrQ29udGV4dHMuZ2V0Rmlyc3RJdGVyYXRvcigpO1xyXG4gICAgICAgIHdoaWxlIChpdGVyYXRvciAhPT0gbnVsbCkge1xyXG4gICAgICAgICAgICB2YXIgY29udGV4dCA9IHRoaXMuX2RlcGVuZHNUYXNrQ29udGV4dHMuZ2V0RnJvbUl0ZXJhdG9yKGl0ZXJhdG9yKS50YXNrQ29udGV4dDtcclxuICAgICAgICAgICAgaXRlcmF0b3IgPSB0aGlzLl9kZXBlbmRzVGFza0NvbnRleHRzLmdldE5leHRJdGVyYXRvcihpdGVyYXRvcik7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBjb250ZXh0LnNldFByaW9yaXR5Q2FsY3VsYXRvcihudWxsKTtcclxuICAgICAgICB9XHJcblx0fTtcclxuXHRcclxuXHRPYmplY3QuZGVmaW5lUHJvcGVydHkoRGVwZW5kZW5jeVdvcmtlcnNUYXNrSW50ZXJuYWxzLnByb3RvdHlwZSwgJ2RlcGVuZFRhc2tLZXlzJywge1xyXG5cdFx0Z2V0OiBmdW5jdGlvbiBnZXREZXBlbmRUYXNrS2V5cygpIHtcclxuXHRcdFx0cmV0dXJuIHRoaXMuX2RlcGVuZFRhc2tLZXlzO1xyXG5cdFx0fVxyXG5cdH0pO1xyXG5cdFxyXG5cdE9iamVjdC5kZWZpbmVQcm9wZXJ0eShEZXBlbmRlbmN5V29ya2Vyc1Rhc2tJbnRlcm5hbHMucHJvdG90eXBlLCAnZGVwZW5kVGFza1Jlc3VsdHMnLCB7XHJcblx0XHRnZXQ6IGZ1bmN0aW9uIGdldERlcGVuZFRhc2tSZXN1bHRzKCkge1xyXG5cdFx0XHRyZXR1cm4gdGhpcy5fZGVwZW5kVGFza1Jlc3VsdHM7XHJcblx0XHR9XHJcblx0fSk7XHJcblx0XHJcbiAgICBEZXBlbmRlbmN5V29ya2Vyc1Rhc2tJbnRlcm5hbHMucHJvdG90eXBlLnJlZ2lzdGVyVGFza0RlcGVuZGVuY3kgPSBmdW5jdGlvbihcclxuICAgICAgICAgICAgdGFza0tleSkge1xyXG4gICAgICAgIFxyXG4gICAgICAgIHZhciBzdHJLZXkgPSB0aGlzLl93b3JrZXJJbnB1dFJldHJlaXZlci5nZXRLZXlBc1N0cmluZyh0YXNrS2V5KTtcclxuICAgICAgICB2YXIgYWRkUmVzdWx0ID0gdGhpcy5fZGVwZW5kc1Rhc2tDb250ZXh0cy50cnlBZGQoc3RyS2V5LCBmdW5jdGlvbigpIHtcclxuICAgICAgICAgICAgcmV0dXJuIHsgdGFza0NvbnRleHQ6IG51bGwgfTtcclxuICAgICAgICB9KTtcclxuICAgICAgICBcclxuICAgICAgICBpZiAoIWFkZFJlc3VsdC5pc05ldykge1xyXG4gICAgICAgICAgICB0aHJvdyAnZGVwZW5kZW5jeVdvcmtlcnM6IENhbm5vdCBhZGQgdGFzayBkZXBlbmRlbmN5IHR3aWNlJztcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgdmFyIHRoYXQgPSB0aGlzO1xyXG4gICAgICAgIHZhciBnb3REYXRhID0gZmFsc2U7XHJcbiAgICAgICAgdmFyIGlzVGVybWluYXRlZCA9IGZhbHNlO1xyXG5cdFx0dmFyIGluZGV4ID0gdGhpcy5fZGVwZW5kVGFza0tleXMubGVuZ3RoO1xyXG5cdFx0XHJcblx0XHR0aGlzLl9kZXBlbmRUYXNrS2V5c1tpbmRleF0gPSB0YXNrS2V5O1xyXG4gICAgICAgIFxyXG4gICAgICAgIGFkZFJlc3VsdC52YWx1ZS50YXNrQ29udGV4dCA9IHRoaXMuX3BhcmVudERlcGVuZGVuY3lXb3JrZXJzLnN0YXJ0VGFzayhcclxuICAgICAgICAgICAgdGFza0tleSwge1xyXG4gICAgICAgICAgICAgICAgJ29uRGF0YSc6IG9uRGVwZW5kZW5jeVRhc2tEYXRhLFxyXG4gICAgICAgICAgICAgICAgJ29uVGVybWluYXRlZCc6IG9uRGVwZW5kZW5jeVRhc2tUZXJtaW5hdGVkXHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICApO1xyXG4gICAgICAgIFxyXG5cdFx0aWYgKCFnb3REYXRhICYmIGFkZFJlc3VsdC52YWx1ZS50YXNrQ29udGV4dC5oYXNEYXRhKCkpIHtcclxuXHRcdFx0dGhpcy5fcGVuZGluZ0RlbGF5ZWREZXBlbmRlbmN5RGF0YS5wdXNoKHtcclxuXHRcdFx0XHRkYXRhOiBhZGRSZXN1bHQudmFsdWUudGFza0NvbnRleHQuZ2V0TGFzdERhdGEoKSxcclxuXHRcdFx0XHRvbkRlcGVuZGVuY3lUYXNrRGF0YTogb25EZXBlbmRlbmN5VGFza0RhdGFcclxuXHRcdFx0fSk7XHJcblx0XHRcdGlmICghdGhpcy5fcGVuZGluZ0RlbGF5ZWRBY3Rpb24pIHtcclxuXHRcdFx0XHR0aGlzLl9wZW5kaW5nRGVsYXllZEFjdGlvbiA9IHRydWU7XHJcblx0XHRcdFx0c2V0VGltZW91dCh0aGlzLl9wZXJmb3JtUGVuZGluZ0RlbGF5ZWRBY3Rpb25zQm91bmQpO1xyXG5cdFx0XHR9XHJcblx0XHR9XHJcbiAgICAgICAgXHJcbiAgICAgICAgZnVuY3Rpb24gb25EZXBlbmRlbmN5VGFza0RhdGEoZGF0YSkge1xyXG5cdFx0XHR0aGF0Ll9kZXBlbmRUYXNrUmVzdWx0c1tpbmRleF0gPSBkYXRhO1xyXG5cdFx0XHR0aGF0Ll9oYXNEZXBlbmRUYXNrRGF0YVtpbmRleF0gPSB0cnVlO1xyXG5cdFx0XHR0aGF0LnRhc2tBcGkuX29uRXZlbnQoJ2RlcGVuZGVuY3lUYXNrRGF0YScsIGRhdGEsIHRhc2tLZXkpO1xyXG4gICAgICAgICAgICBnb3REYXRhID0gdHJ1ZTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgZnVuY3Rpb24gb25EZXBlbmRlbmN5VGFza1Rlcm1pbmF0ZWQoKSB7XHJcbiAgICAgICAgICAgIGlmIChpc1Rlcm1pbmF0ZWQpIHtcclxuICAgICAgICAgICAgICAgIHRocm93ICdkZXBlbmRlbmN5V29ya2VyczogRG91YmxlIHRlcm1pbmF0aW9uJztcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBpc1Rlcm1pbmF0ZWQgPSB0cnVlO1xyXG4gICAgICAgICAgICB0aGF0Ll9kZXBlbmRzVGFza1Rlcm1pbmF0ZWQoKTtcclxuICAgICAgICB9XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBEZXBlbmRlbmN5V29ya2Vyc1Rhc2tJbnRlcm5hbHMucHJvdG90eXBlLl9kZXBlbmRzVGFza1Rlcm1pbmF0ZWQgPSBmdW5jdGlvbiBkZXBlbmRzVGFza1Rlcm1pbmF0ZWQoKSB7XHJcbiAgICAgICAgKyt0aGlzLl9kZXBlbmRzVGFza3NUZXJtaW5hdGVkQ291bnQ7XHJcblx0XHRpZiAodGhpcy5fZGVwZW5kc1Rhc2tzVGVybWluYXRlZENvdW50ID09PSB0aGlzLl9kZXBlbmRzVGFza0NvbnRleHRzLmdldENvdW50KCkpIHtcclxuXHRcdFx0dGhpcy50YXNrQXBpLl9vbkV2ZW50KCdhbGxEZXBlbmRUYXNrc1Rlcm1pbmF0ZWQnKTtcclxuXHRcdH1cclxuICAgICAgICB0aGlzLnN0YXR1c1VwZGF0ZSgpO1xyXG4gICAgfTtcclxuXHRcclxuXHREZXBlbmRlbmN5V29ya2Vyc1Rhc2tJbnRlcm5hbHMucHJvdG90eXBlLl9wZXJmb3JtUGVuZGluZ0RlbGF5ZWRBY3Rpb25zID0gZnVuY3Rpb24oKSB7XHJcblx0XHR2YXIgaXRlcmF0b3I7XHJcblx0XHR2YXIgY29udGV4dDtcclxuXHRcdHRoaXMuX3BlbmRpbmdEZWxheWVkQWN0aW9uID0gZmFsc2U7XHJcblx0XHRcclxuXHRcdGlmICh0aGlzLl9wZW5kaW5nRGVsYXllZERlcGVuZGVuY3lEYXRhLmxlbmd0aCA+IDApIHtcclxuXHRcdFx0dmFyIGxvY2FsTGlzdGVuZXJzID0gdGhpcy5fcGVuZGluZ0RlbGF5ZWREZXBlbmRlbmN5RGF0YTtcclxuXHRcdFx0dGhpcy5fcGVuZGluZ0RlbGF5ZWREZXBlbmRlbmN5RGF0YSA9IFtdO1xyXG5cdFx0XHRcclxuXHRcdFx0Zm9yICh2YXIgaSA9IDA7IGkgPCBsb2NhbExpc3RlbmVycy5sZW5ndGg7ICsraSkge1xyXG5cdFx0XHRcdGxvY2FsTGlzdGVuZXJzW2ldLm9uRGVwZW5kZW5jeVRhc2tEYXRhKGxvY2FsTGlzdGVuZXJzW2ldLmRhdGEpO1xyXG5cdFx0XHR9XHJcblx0XHR9XHJcblx0XHRcclxuXHRcdGlmICh0aGlzLl9wZW5kaW5nRGVsYXllZE5ld0RhdGEpIHtcclxuXHRcdFx0dmFyIGNvbnRleHRzID0gdGhpcy50YXNrQ29udGV4dHM7XHJcblx0XHRcdGl0ZXJhdG9yID0gY29udGV4dHMuZ2V0Rmlyc3RJdGVyYXRvcigpO1xyXG5cdFx0XHR3aGlsZSAoaXRlcmF0b3IgIT09IG51bGwpIHtcclxuXHRcdFx0XHRjb250ZXh0ID0gY29udGV4dHMuZ2V0RnJvbUl0ZXJhdG9yKGl0ZXJhdG9yKTtcclxuXHRcdFx0XHRpdGVyYXRvciA9IGNvbnRleHRzLmdldE5leHRJdGVyYXRvcihpdGVyYXRvcik7XHJcblx0XHRcdFx0XHJcblx0XHRcdFx0Y29udGV4dC5fY2FsbGJhY2tzLm9uRGF0YSh0aGlzLmxhc3RQcm9jZXNzZWREYXRhLCB0aGlzLnRhc2tLZXkpO1xyXG5cdFx0XHR9XHJcblx0XHR9XHJcblx0XHRcclxuXHRcdGlmICh0aGlzLl9wZW5kaW5nRGVsYXllZEVuZGVkKSB7XHJcblx0XHRcdGl0ZXJhdG9yID0gdGhpcy50YXNrQ29udGV4dHMuZ2V0Rmlyc3RJdGVyYXRvcigpO1xyXG5cdFx0XHR3aGlsZSAoaXRlcmF0b3IgIT09IG51bGwpIHtcclxuXHRcdFx0XHRjb250ZXh0ID0gdGhpcy50YXNrQ29udGV4dHMuZ2V0RnJvbUl0ZXJhdG9yKGl0ZXJhdG9yKTtcclxuXHRcdFx0XHRpdGVyYXRvciA9IHRoaXMudGFza0NvbnRleHRzLmdldE5leHRJdGVyYXRvcihpdGVyYXRvcik7XHJcblxyXG5cdFx0XHRcdGlmIChjb250ZXh0Ll9jYWxsYmFja3Mub25UZXJtaW5hdGVkKSB7XHJcblx0XHRcdFx0XHRjb250ZXh0Ll9jYWxsYmFja3Mub25UZXJtaW5hdGVkKCk7XHJcblx0XHRcdFx0fVxyXG5cdFx0XHR9XHJcblx0XHRcdFxyXG5cdFx0XHR0aGlzLnRhc2tDb250ZXh0cy5jbGVhcigpO1xyXG5cdFx0fVxyXG5cdH07XHJcblx0XHJcbiAgICByZXR1cm4gRGVwZW5kZW5jeVdvcmtlcnNUYXNrSW50ZXJuYWxzO1xyXG59KSgpO1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBEZXBlbmRlbmN5V29ya2Vyc1Rhc2tJbnRlcm5hbHM7IiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxudmFyIHByaW9yaXRpemVyID0ge1xyXG5cdGdldFByaW9yaXR5OiBmdW5jdGlvbih0YXNrKSB7XHJcbiAgICAgICAgcmV0dXJuIHRhc2suY2FsY3VsYXRlUHJpb3JpdHkoKTtcclxuICAgIH1cclxufTtcclxuXHJcbmZ1bmN0aW9uIGNyZWF0ZUR1bW15UmVzb3VyY2UoKSB7XHJcblx0cmV0dXJuIHt9O1xyXG59XHJcblxyXG5mdW5jdGlvbiBEZXBlbmRlbmN5V29ya2Vyc1Rhc2tTY2hlZHVsZXIoam9ic0xpbWl0LCBvcHRpb25zKSB7XHJcblx0cmVzb3VyY2VTY2hlZHVsZXIuUHJpb3JpdHlTY2hlZHVsZXIuY2FsbCh0aGlzLCBjcmVhdGVEdW1teVJlc291cmNlLCBqb2JzTGltaXQsIHByaW9yaXRpemVyLCBvcHRpb25zKTtcclxufVxyXG5cclxuRGVwZW5kZW5jeVdvcmtlcnNUYXNrU2NoZWR1bGVyLnByb3RvdHlwZSA9IE9iamVjdC5jcmVhdGUocmVzb3VyY2VTY2hlZHVsZXIuUHJpb3JpdHlTY2hlZHVsZXIucHJvdG90eXBlKTtcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gRGVwZW5kZW5jeVdvcmtlcnNUYXNrU2NoZWR1bGVyOyIsIid1c2Ugc3RyaWN0JztcclxuXHJcbnZhciBEZXBlbmRlbmN5V29ya2Vyc1Rhc2sgPSAoZnVuY3Rpb24gRGVwZW5kZW5jeVdvcmtlcnNUYXNrQ2xvc3VyZSgpIHtcclxuXHRmdW5jdGlvbiBEZXBlbmRlbmN5V29ya2Vyc1Rhc2sod3JhcHBlZCwga2V5LCByZWdpc3RlcldyYXBwZWRFdmVudHMpIHtcclxuXHRcdHRoaXMuX3dyYXBwZWQgPSB3cmFwcGVkO1xyXG5cdFx0dGhpcy5fa2V5ID0ga2V5O1xyXG5cdFx0dGhpcy5fZXZlbnRMaXN0ZW5lcnMgPSB7XHJcblx0XHRcdCdkZXBlbmRlbmN5VGFza0RhdGEnOiBbXSxcclxuXHRcdFx0J3N0YXR1c1VwZGF0ZWQnOiBbXSxcclxuXHRcdFx0J2FsbERlcGVuZFRhc2tzVGVybWluYXRlZCc6IFtdXHJcblx0XHR9O1xyXG5cdFx0XHJcblx0XHRpZiAocmVnaXN0ZXJXcmFwcGVkRXZlbnRzKSB7XHJcblx0XHRcdGZvciAodmFyIGV2ZW50IGluIHRoaXMuX2V2ZW50TGlzdGVuZXJzKSB7XHJcblx0XHRcdFx0dGhpcy5fcmVnaXN0ZXJXcmFwcGVkRXZlbnQoZXZlbnQpO1xyXG5cdFx0XHR9XHJcblx0XHR9XHJcblx0fVxyXG5cdFxyXG5cdERlcGVuZGVuY3lXb3JrZXJzVGFzay5wcm90b3R5cGUuZGF0YVJlYWR5ID0gZnVuY3Rpb24gZGF0YVJlYWR5KG5ld0RhdGFUb1Byb2Nlc3MsIHdvcmtlclR5cGUpIHtcclxuXHRcdHRoaXMuX3dyYXBwZWQuZGF0YVJlYWR5KG5ld0RhdGFUb1Byb2Nlc3MsIHdvcmtlclR5cGUpO1xyXG5cdH07XHJcblx0XHJcblx0RGVwZW5kZW5jeVdvcmtlcnNUYXNrLnByb3RvdHlwZS50ZXJtaW5hdGUgPSBmdW5jdGlvbiB0ZXJtaW5hdGUoKSB7XHJcblx0XHR0aGlzLl93cmFwcGVkLnRlcm1pbmF0ZSgpO1xyXG5cdH07XHJcblx0XHJcblx0RGVwZW5kZW5jeVdvcmtlcnNUYXNrLnByb3RvdHlwZS5yZWdpc3RlclRhc2tEZXBlbmRlbmN5ID0gZnVuY3Rpb24gcmVnaXN0ZXJUYXNrRGVwZW5kZW5jeSh0YXNrS2V5KSB7XHJcblx0XHRyZXR1cm4gdGhpcy5fd3JhcHBlZC5yZWdpc3RlclRhc2tEZXBlbmRlbmN5KHRhc2tLZXkpO1xyXG5cdH07XHJcblx0XHJcblx0RGVwZW5kZW5jeVdvcmtlcnNUYXNrLnByb3RvdHlwZS5jYWxjdWxhdGVQcmlvcml0eSA9IGZ1bmN0aW9uIGNhbGN1bGF0ZVByaW9yaXR5KCkge1xyXG5cdFx0cmV0dXJuIHRoaXMuX3dyYXBwZWQuY2FsY3VsYXRlUHJpb3JpdHkoKTtcclxuXHR9O1xyXG5cdFxyXG5cdERlcGVuZGVuY3lXb3JrZXJzVGFzay5wcm90b3R5cGUub24gPSBmdW5jdGlvbiBvbihldmVudCwgbGlzdGVuZXIpIHtcclxuXHRcdGlmICghdGhpcy5fZXZlbnRMaXN0ZW5lcnNbZXZlbnRdKSB7XHJcblx0XHRcdHRocm93ICdkZXBlbmRlbmN5V29ya2VyczogVGFzayBoYXMgbm8gZXZlbnQgJyArIGV2ZW50O1xyXG5cdFx0fVxyXG5cdFx0dGhpcy5fZXZlbnRMaXN0ZW5lcnNbZXZlbnRdLnB1c2gobGlzdGVuZXIpO1xyXG5cdH07XHJcblx0XHJcblx0T2JqZWN0LmRlZmluZVByb3BlcnR5KERlcGVuZGVuY3lXb3JrZXJzVGFzay5wcm90b3R5cGUsICdrZXknLCB7XHJcblx0XHRnZXQ6IGZ1bmN0aW9uIGdldEtleSgpIHtcclxuXHRcdFx0cmV0dXJuIHRoaXMuX2tleTtcclxuXHRcdH1cclxuXHR9KTtcclxuXHRcclxuXHRPYmplY3QuZGVmaW5lUHJvcGVydHkoRGVwZW5kZW5jeVdvcmtlcnNUYXNrLnByb3RvdHlwZSwgJ2RlcGVuZFRhc2tLZXlzJywge1xyXG5cdFx0Z2V0OiBmdW5jdGlvbiBnZXREZXBlbmRUYXNrS2V5cygpIHtcclxuXHRcdFx0cmV0dXJuIHRoaXMuX3dyYXBwZWQuZGVwZW5kVGFza0tleXM7XHJcblx0XHR9XHJcblx0fSk7XHJcblx0XHJcblx0T2JqZWN0LmRlZmluZVByb3BlcnR5KERlcGVuZGVuY3lXb3JrZXJzVGFzay5wcm90b3R5cGUsICdkZXBlbmRUYXNrUmVzdWx0cycsIHtcclxuXHRcdGdldDogZnVuY3Rpb24gZ2V0RGVwZW5kVGFza1Jlc3VsdHMoKSB7XHJcblx0XHRcdHJldHVybiB0aGlzLl93cmFwcGVkLmRlcGVuZFRhc2tSZXN1bHRzO1xyXG5cdFx0fVxyXG5cdH0pO1xyXG5cdFxyXG5cdERlcGVuZGVuY3lXb3JrZXJzVGFzay5wcm90b3R5cGUuX29uRXZlbnQgPSBmdW5jdGlvbiBvbkV2ZW50KGV2ZW50LCBhcmcxLCBhcmcyKSB7XHJcblx0XHRpZiAoZXZlbnQgPT0gJ3N0YXR1c1VwZGF0ZWQnKSB7XHJcblx0XHRcdGFyZzEgPSB0aGlzLl9tb2RpZnlTdGF0dXMoYXJnMSk7XHJcblx0XHR9XHJcblx0XHR2YXIgbGlzdGVuZXJzID0gdGhpcy5fZXZlbnRMaXN0ZW5lcnNbZXZlbnRdO1xyXG5cdFx0Zm9yICh2YXIgaSA9IDA7IGkgPCBsaXN0ZW5lcnMubGVuZ3RoOyArK2kpIHtcclxuXHRcdFx0bGlzdGVuZXJzW2ldLmNhbGwodGhpcywgYXJnMSwgYXJnMik7XHJcblx0XHR9XHJcblx0fTtcclxuXHRcclxuXHREZXBlbmRlbmN5V29ya2Vyc1Rhc2sucHJvdG90eXBlLl9tb2RpZnlTdGF0dXMgPSBmdW5jdGlvbiBtb2RpZnlTdGF0dXMoc3RhdHVzKSB7XHJcblx0XHRyZXR1cm4gc3RhdHVzO1xyXG5cdH07XHJcblx0XHJcblx0RGVwZW5kZW5jeVdvcmtlcnNUYXNrLnByb3RvdHlwZS5fcmVnaXN0ZXJXcmFwcGVkRXZlbnQgPSBmdW5jdGlvbiByZWdpc3RlcldyYXBwZWRFdmVudChldmVudCkge1xyXG5cdFx0dmFyIHRoYXQgPSB0aGlzO1xyXG5cdFx0dGhpcy5fd3JhcHBlZC5vbihldmVudCwgZnVuY3Rpb24oYXJnMSwgYXJnMikge1xyXG5cdFx0XHR0aGF0Ll9vbkV2ZW50KGV2ZW50LCBhcmcxLCBhcmcyKTtcclxuXHRcdH0pO1xyXG5cdH07XHJcblxyXG5cdHJldHVybiBEZXBlbmRlbmN5V29ya2Vyc1Rhc2s7XHJcbn0pKCk7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IERlcGVuZGVuY3lXb3JrZXJzVGFzazsiLCIndXNlIHN0cmljdCc7XHJcblxyXG4vKiBnbG9iYWwgY29uc29sZTogZmFsc2UgKi9cclxuLyogZ2xvYmFsIFByb21pc2U6IGZhbHNlICovXHJcblxyXG52YXIgSnNCdWlsdGluSGFzaE1hcCA9IHJlcXVpcmUoJ2pzLWJ1aWx0aW4taGFzaC1tYXAnKTtcclxudmFyIERlcGVuZGVuY3lXb3JrZXJzVGFza0ludGVybmFscyA9IHJlcXVpcmUoJ2RlcGVuZGVuY3ktd29ya2Vycy10YXNrLWludGVybmFscycpO1xyXG52YXIgRGVwZW5kZW5jeVdvcmtlcnNUYXNrQ29udGV4dCA9IHJlcXVpcmUoJ2RlcGVuZGVuY3ktd29ya2Vycy10YXNrLWNvbnRleHQnKTtcclxuXHJcbnZhciBEZXBlbmRlbmN5V29ya2VycyA9IChmdW5jdGlvbiBEZXBlbmRlbmN5V29ya2Vyc0Nsb3N1cmUoKSB7XHJcbiAgICBmdW5jdGlvbiBEZXBlbmRlbmN5V29ya2Vycyh3b3JrZXJJbnB1dFJldHJlaXZlcikge1xyXG4gICAgICAgIHZhciB0aGF0ID0gdGhpcztcclxuICAgICAgICB0aGF0Ll93b3JrZXJJbnB1dFJldHJlaXZlciA9IHdvcmtlcklucHV0UmV0cmVpdmVyO1xyXG4gICAgICAgIHRoYXQuX3Rhc2tJbnRlcm5hbHNzID0gbmV3IEpzQnVpbHRpbkhhc2hNYXAoKTtcclxuICAgICAgICB0aGF0Ll93b3JrZXJQb29sQnlUYXNrVHlwZSA9IFtdO1xyXG4gICAgICAgIHRoYXQuX3Rhc2tPcHRpb25zQnlUYXNrVHlwZSA9IFtdO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGlmICghd29ya2VySW5wdXRSZXRyZWl2ZXIuZ2V0V29ya2VyVHlwZU9wdGlvbnMpIHtcclxuICAgICAgICAgICAgdGhyb3cgJ2RlcGVuZGVuY3lXb3JrZXJzOiBObyAnICtcclxuICAgICAgICAgICAgICAgICd3b3JrZXJJbnB1dFJldHJlaXZlci5nZXRXb3JrZXJUeXBlT3B0aW9ucygpIG1ldGhvZCc7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGlmICghd29ya2VySW5wdXRSZXRyZWl2ZXIuZ2V0S2V5QXNTdHJpbmcpIHtcclxuICAgICAgICAgICAgdGhyb3cgJ2RlcGVuZGVuY3lXb3JrZXJzOiBObyAnICtcclxuICAgICAgICAgICAgICAgICd3b3JrZXJJbnB1dFJldHJlaXZlci5nZXRLZXlBc1N0cmluZygpIG1ldGhvZCc7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgXHJcbiAgICBEZXBlbmRlbmN5V29ya2Vycy5wcm90b3R5cGUuc3RhcnRUYXNrID0gZnVuY3Rpb24gc3RhcnRUYXNrKFxyXG4gICAgICAgIHRhc2tLZXksIGNhbGxiYWNrcykge1xyXG4gICAgICAgIFxyXG4gICAgICAgIHZhciBkZXBlbmRlbmN5V29ya2VycyA9IHRoaXM7XHJcbiAgICAgICAgXHJcbiAgICAgICAgdmFyIHN0cktleSA9IHRoaXMuX3dvcmtlcklucHV0UmV0cmVpdmVyLmdldEtleUFzU3RyaW5nKHRhc2tLZXkpO1xyXG4gICAgICAgIHZhciBhZGRSZXN1bHQgPSB0aGlzLl90YXNrSW50ZXJuYWxzcy50cnlBZGQoc3RyS2V5LCBmdW5jdGlvbigpIHtcclxuICAgICAgICAgICAgcmV0dXJuIG5ldyBEZXBlbmRlbmN5V29ya2Vyc1Rhc2tJbnRlcm5hbHMoKTtcclxuICAgICAgICB9KTtcclxuICAgICAgICBcclxuICAgICAgICB2YXIgdGFza0ludGVybmFscyA9IGFkZFJlc3VsdC52YWx1ZTtcclxuICAgICAgICB2YXIgdGFza0NvbnRleHQgPSBuZXcgRGVwZW5kZW5jeVdvcmtlcnNUYXNrQ29udGV4dChcclxuICAgICAgICAgICAgdGFza0ludGVybmFscywgY2FsbGJhY2tzKTtcclxuICAgICAgICBcclxuICAgICAgICBpZiAoYWRkUmVzdWx0LmlzTmV3KSB7XHJcbiAgICAgICAgICAgIHRhc2tJbnRlcm5hbHMuaW5pdGlhbGl6ZShcclxuICAgICAgICAgICAgICAgIHRhc2tLZXksXHJcbiAgICAgICAgICAgICAgICB0aGlzLFxyXG4gICAgICAgICAgICAgICAgdGhpcy5fd29ya2VySW5wdXRSZXRyZWl2ZXIsXHJcbiAgICAgICAgICAgICAgICB0aGlzLl90YXNrSW50ZXJuYWxzcyxcclxuICAgICAgICAgICAgICAgIGFkZFJlc3VsdC5pdGVyYXRvcixcclxuICAgICAgICAgICAgICAgIHRoaXMuX3dvcmtlcklucHV0UmV0cmVpdmVyKTtcclxuXHRcdFx0XHRcclxuICAgICAgICAgICAgdGhpcy5fd29ya2VySW5wdXRSZXRyZWl2ZXIudGFza1N0YXJ0ZWQodGFza0ludGVybmFscy50YXNrQXBpKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcblxyXG4gICAgICAgIHJldHVybiB0YXNrQ29udGV4dDtcclxuICAgIH07XHJcbiAgICBcclxuICAgIERlcGVuZGVuY3lXb3JrZXJzLnByb3RvdHlwZS5zdGFydFRhc2tQcm9taXNlID1cclxuICAgICAgICAgICAgZnVuY3Rpb24gc3RhcnRUYXNrUHJvbWlzZSh0YXNrS2V5KSB7XHJcbiAgICAgICAgXHJcbiAgICAgICAgdmFyIHRoYXQgPSB0aGlzO1xyXG4gICAgICAgIHJldHVybiBuZXcgUHJvbWlzZShmdW5jdGlvbihyZXNvbHZlLCByZWplY3QpIHtcclxuICAgICAgICAgICAgdmFyIHRhc2tDb250ZXh0ID0gdGhhdC5zdGFydFRhc2soXHJcbiAgICAgICAgICAgICAgICB0YXNrS2V5LCB7ICdvbkRhdGEnOiBvbkRhdGEsICdvblRlcm1pbmF0ZWQnOiBvblRlcm1pbmF0ZWQgfSk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICB2YXIgaGFzRGF0YSA9IHRhc2tDb250ZXh0Lmhhc0RhdGEoKTtcclxuICAgICAgICAgICAgdmFyIHJlc3VsdDtcclxuICAgICAgICAgICAgaWYgKGhhc0RhdGEpIHtcclxuICAgICAgICAgICAgICAgIHJlc3VsdCA9IHRhc2tDb250ZXh0LmdldExhc3REYXRhKCk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGZ1bmN0aW9uIG9uRGF0YShkYXRhKSB7XHJcbiAgICAgICAgICAgICAgICBoYXNEYXRhID0gdHJ1ZTtcclxuICAgICAgICAgICAgICAgIHJlc3VsdCA9IGRhdGE7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGZ1bmN0aW9uIG9uVGVybWluYXRlZCgpIHtcclxuICAgICAgICAgICAgICAgIGlmIChoYXNEYXRhKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgcmVzb2x2ZShyZXN1bHQpO1xyXG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgICAgICByZWplY3QoJ2RlcGVuZGVuY3lXb3JrZXJzOiBJbnRlcm5hbCAnICtcclxuICAgICAgICAgICAgICAgICAgICAgICAgJ2Vycm9yIC0gdGFzayB0ZXJtaW5hdGVkIGJ1dCBubyBkYXRhIHJldHVybmVkJyk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9KTtcclxuICAgIH07XHJcblx0XHJcblx0RGVwZW5kZW5jeVdvcmtlcnMucHJvdG90eXBlLnRlcm1pbmF0ZUluYWN0aXZlV29ya2VycyA9IGZ1bmN0aW9uKCkge1xyXG5cdFx0Zm9yICh2YXIgdGFza1R5cGUgaW4gdGhpcy5fd29ya2VyUG9vbEJ5VGFza1R5cGUpIHtcclxuXHRcdFx0dmFyIHdvcmtlclBvb2wgPSB0aGlzLl93b3JrZXJQb29sQnlUYXNrVHlwZVt0YXNrVHlwZV07XHJcblx0XHRcdGZvciAodmFyIGkgPSAwOyBpIDwgd29ya2VyUG9vbDsgKytpKSB7XHJcblx0XHRcdFx0d29ya2VyUG9vbFtpXS50ZXJtaW5hdGUoKTtcclxuXHRcdFx0XHR3b3JrZXJQb29sLmxlbmd0aCA9IDA7XHJcblx0XHRcdH1cclxuXHRcdH1cclxuXHR9O1xyXG4gICAgXHJcbiAgICBEZXBlbmRlbmN5V29ya2Vycy5wcm90b3R5cGUuX2RhdGFSZWFkeSA9IGZ1bmN0aW9uIGRhdGFSZWFkeShcclxuXHRcdFx0dGFza0ludGVybmFscywgZGF0YVRvUHJvY2Vzcywgd29ya2VyVHlwZSkge1xyXG4gICAgICAgIFxyXG5cdFx0dmFyIHRoYXQgPSB0aGlzO1xyXG4gICAgICAgIHZhciB3b3JrZXI7XHJcbiAgICAgICAgdmFyIHdvcmtlclBvb2wgPSB0aGF0Ll93b3JrZXJQb29sQnlUYXNrVHlwZVt3b3JrZXJUeXBlXTtcclxuICAgICAgICBpZiAoIXdvcmtlclBvb2wpIHtcclxuICAgICAgICAgICAgd29ya2VyUG9vbCA9IFtdO1xyXG4gICAgICAgICAgICB0aGF0Ll93b3JrZXJQb29sQnlUYXNrVHlwZVt3b3JrZXJUeXBlXSA9IHdvcmtlclBvb2w7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGlmICh3b3JrZXJQb29sLmxlbmd0aCA+IDApIHtcclxuICAgICAgICAgICAgd29ya2VyID0gd29ya2VyUG9vbC5wb3AoKTtcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICB2YXIgd29ya2VyQXJncyA9IHRoYXQuX3dvcmtlcklucHV0UmV0cmVpdmVyLmdldFdvcmtlclR5cGVPcHRpb25zKFxyXG4gICAgICAgICAgICAgICAgd29ya2VyVHlwZSk7XHJcblxyXG5cdFx0XHRpZiAoIXdvcmtlckFyZ3MpIHtcclxuXHRcdFx0XHR0YXNrSW50ZXJuYWxzLm5ld0RhdGEoZGF0YVRvUHJvY2Vzcyk7XHJcblx0XHRcdFx0dGFza0ludGVybmFscy5zdGF0dXNVcGRhdGUoKTtcclxuXHRcdFx0XHRyZXR1cm47XHJcblx0XHRcdH1cclxuICAgICAgICAgICAgXHJcblx0XHRcdHdvcmtlciA9IG5ldyBhc3luY1Byb3h5LkFzeW5jUHJveHlNYXN0ZXIoXHJcbiAgICAgICAgICAgICAgICB3b3JrZXJBcmdzLnNjcmlwdHNUb0ltcG9ydCxcclxuICAgICAgICAgICAgICAgIHdvcmtlckFyZ3MuY3Rvck5hbWUsXHJcbiAgICAgICAgICAgICAgICB3b3JrZXJBcmdzLmN0b3JBcmdzKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKCF0YXNrSW50ZXJuYWxzLndhaXRpbmdGb3JXb3JrZXJSZXN1bHQpIHtcclxuICAgICAgICAgICAgdGFza0ludGVybmFscy53YWl0aW5nRm9yV29ya2VyUmVzdWx0ID0gdHJ1ZTtcclxuICAgICAgICAgICAgdGFza0ludGVybmFscy5zdGF0dXNVcGRhdGUoKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgd29ya2VyLmNhbGxGdW5jdGlvbihcclxuICAgICAgICAgICAgICAgICdzdGFydCcsXHJcbiAgICAgICAgICAgICAgICBbZGF0YVRvUHJvY2VzcywgdGFza0ludGVybmFscy50YXNrS2V5XSxcclxuICAgICAgICAgICAgICAgIHsnaXNSZXR1cm5Qcm9taXNlJzogdHJ1ZX0pXHJcbiAgICAgICAgICAgIC50aGVuKGZ1bmN0aW9uKHByb2Nlc3NlZERhdGEpIHtcclxuICAgICAgICAgICAgICAgIHRhc2tJbnRlcm5hbHMubmV3RGF0YShwcm9jZXNzZWREYXRhKTtcclxuICAgICAgICAgICAgICAgIHJldHVybiBwcm9jZXNzZWREYXRhO1xyXG4gICAgICAgICAgICB9KS5jYXRjaChmdW5jdGlvbihlKSB7XHJcbiAgICAgICAgICAgICAgICBjb25zb2xlLmxvZygnRXJyb3IgaW4gRGVwZW5kZW5jeVdvcmtlcnNcXCcgd29ya2VyOiAnICsgZSk7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gZTtcclxuICAgICAgICAgICAgfSkudGhlbihmdW5jdGlvbihyZXN1bHQpIHtcclxuICAgICAgICAgICAgICAgIHdvcmtlclBvb2wucHVzaCh3b3JrZXIpO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICBpZiAoIXRoYXQuX2NoZWNrSWZQZW5kaW5nRGF0YSh0YXNrSW50ZXJuYWxzKSkge1xyXG4gICAgICAgICAgICAgICAgICAgIHRhc2tJbnRlcm5hbHMud2FpdGluZ0ZvcldvcmtlclJlc3VsdCA9IGZhbHNlO1xyXG4gICAgICAgICAgICAgICAgICAgIHRhc2tJbnRlcm5hbHMuc3RhdHVzVXBkYXRlKCk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgfTtcclxuXHRcclxuXHREZXBlbmRlbmN5V29ya2Vycy5wcm90b3R5cGUuX2NoZWNrSWZQZW5kaW5nRGF0YSA9IGZ1bmN0aW9uIGNoZWNrSWZQZW5kaW5nRGF0YSh0YXNrSW50ZXJuYWxzKSB7XHJcblx0XHRpZiAoIXRhc2tJbnRlcm5hbHMuaXNQZW5kaW5nRGF0YUZvcldvcmtlcikge1xyXG5cdFx0XHRyZXR1cm4gZmFsc2U7XHJcblx0XHR9XHJcblx0XHRcclxuXHRcdHZhciBkYXRhVG9Qcm9jZXNzID0gdGFza0ludGVybmFscy5wZW5kaW5nRGF0YUZvcldvcmtlcjtcclxuXHRcdHRhc2tJbnRlcm5hbHMuaXNQZW5kaW5nRGF0YUZvcldvcmtlciA9IGZhbHNlO1xyXG5cdFx0dGFza0ludGVybmFscy5wZW5kaW5nRGF0YUZvcldvcmtlciA9IG51bGw7XHJcblx0XHRcclxuXHRcdHRoaXMuX2RhdGFSZWFkeShcclxuXHRcdFx0dGFza0ludGVybmFscyxcclxuXHRcdFx0ZGF0YVRvUHJvY2VzcyxcclxuXHRcdFx0dGFza0ludGVybmFscy5wZW5kaW5nV29ya2VyVHlwZSk7XHJcblx0XHRcclxuXHRcdHJldHVybiB0cnVlO1xyXG5cdH07XHJcbiAgICBcclxuICAgIHJldHVybiBEZXBlbmRlbmN5V29ya2VycztcclxufSkoKTtcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gRGVwZW5kZW5jeVdvcmtlcnM7IiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxudmFyIExpbmtlZExpc3QgPSByZXF1aXJlKCdsaW5rZWQtbGlzdCcpO1xyXG5cclxudmFyIEhhc2hNYXAgPSAoZnVuY3Rpb24gSGFzaE1hcENsb3N1cmUoKSB7XHJcblxyXG5mdW5jdGlvbiBIYXNoTWFwKGhhc2hlcikge1xyXG4gICAgdmFyIHRoYXQgPSB0aGlzO1xyXG4gICAgdGhhdC5faGFzaGVyID0gaGFzaGVyO1xyXG5cdHRoYXQuY2xlYXIoKTtcclxufVxyXG5cclxuSGFzaE1hcC5wcm90b3R5cGUuY2xlYXIgPSBmdW5jdGlvbiBjbGVhcigpIHtcclxuICAgIHRoaXMuX2xpc3RCeUtleSA9IFtdO1xyXG4gICAgdGhpcy5fbGlzdE9mTGlzdHMgPSBuZXcgTGlua2VkTGlzdCgpO1xyXG4gICAgdGhpcy5fY291bnQgPSAwO1xyXG59O1xyXG5cclxuSGFzaE1hcC5wcm90b3R5cGUuZ2V0RnJvbUtleSA9IGZ1bmN0aW9uIGdldEZyb21LZXkoa2V5KSB7XHJcbiAgICB2YXIgaGFzaENvZGUgPSB0aGlzLl9oYXNoZXJbJ2dldEhhc2hDb2RlJ10oa2V5KTtcclxuICAgIHZhciBoYXNoRWxlbWVudHMgPSB0aGlzLl9saXN0QnlLZXlbaGFzaENvZGVdO1xyXG4gICAgaWYgKCFoYXNoRWxlbWVudHMpIHtcclxuICAgICAgICByZXR1cm4gbnVsbDtcclxuICAgIH1cclxuICAgIHZhciBsaXN0ID0gaGFzaEVsZW1lbnRzLmxpc3Q7XHJcbiAgICBcclxuICAgIHZhciBpdGVyYXRvciA9IGxpc3QuZ2V0Rmlyc3RJdGVyYXRvcigpO1xyXG4gICAgd2hpbGUgKGl0ZXJhdG9yICE9PSBudWxsKSB7XHJcbiAgICAgICAgdmFyIGl0ZW0gPSBsaXN0LmdldEZyb21JdGVyYXRvcihpdGVyYXRvcik7XHJcbiAgICAgICAgaWYgKHRoaXMuX2hhc2hlclsnaXNFcXVhbCddKGl0ZW0ua2V5LCBrZXkpKSB7XHJcbiAgICAgICAgICAgIHJldHVybiBpdGVtLnZhbHVlO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBpdGVyYXRvciA9IGxpc3QuZ2V0TmV4dEl0ZXJhdG9yKGl0ZXJhdG9yKTtcclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4gbnVsbDtcclxufTtcclxuXHJcbkhhc2hNYXAucHJvdG90eXBlLmdldEZyb21JdGVyYXRvciA9IGZ1bmN0aW9uIGdldEZyb21JdGVyYXRvcihpdGVyYXRvcikge1xyXG4gICAgcmV0dXJuIGl0ZXJhdG9yLl9oYXNoRWxlbWVudHMubGlzdC5nZXRGcm9tSXRlcmF0b3IoaXRlcmF0b3IuX2ludGVybmFsSXRlcmF0b3IpLnZhbHVlO1xyXG59O1xyXG5cclxuSGFzaE1hcC5wcm90b3R5cGUudHJ5QWRkID0gZnVuY3Rpb24gdHJ5QWRkKGtleSwgY3JlYXRlVmFsdWUpIHtcclxuICAgIHZhciBoYXNoQ29kZSA9IHRoaXMuX2hhc2hlclsnZ2V0SGFzaENvZGUnXShrZXkpO1xyXG4gICAgdmFyIGhhc2hFbGVtZW50cyA9IHRoaXMuX2xpc3RCeUtleVtoYXNoQ29kZV07XHJcbiAgICBpZiAoIWhhc2hFbGVtZW50cykge1xyXG4gICAgICAgIGhhc2hFbGVtZW50cyA9IHtcclxuICAgICAgICAgICAgaGFzaENvZGU6IGhhc2hDb2RlLFxyXG4gICAgICAgICAgICBsaXN0OiBuZXcgTGlua2VkTGlzdCgpLFxyXG4gICAgICAgICAgICBsaXN0T2ZMaXN0c0l0ZXJhdG9yOiBudWxsXHJcbiAgICAgICAgfTtcclxuICAgICAgICBoYXNoRWxlbWVudHMubGlzdE9mTGlzdHNJdGVyYXRvciA9IHRoaXMuX2xpc3RPZkxpc3RzLmFkZChoYXNoRWxlbWVudHMpO1xyXG4gICAgICAgIHRoaXMuX2xpc3RCeUtleVtoYXNoQ29kZV0gPSBoYXNoRWxlbWVudHM7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHZhciBpdGVyYXRvciA9IHtcclxuICAgICAgICBfaGFzaEVsZW1lbnRzOiBoYXNoRWxlbWVudHMsXHJcbiAgICAgICAgX2ludGVybmFsSXRlcmF0b3I6IG51bGxcclxuICAgIH07XHJcbiAgICBcclxuICAgIGl0ZXJhdG9yLl9pbnRlcm5hbEl0ZXJhdG9yID0gaGFzaEVsZW1lbnRzLmxpc3QuZ2V0Rmlyc3RJdGVyYXRvcigpO1xyXG4gICAgd2hpbGUgKGl0ZXJhdG9yLl9pbnRlcm5hbEl0ZXJhdG9yICE9PSBudWxsKSB7XHJcbiAgICAgICAgdmFyIGl0ZW0gPSBoYXNoRWxlbWVudHMubGlzdC5nZXRGcm9tSXRlcmF0b3IoaXRlcmF0b3IuX2ludGVybmFsSXRlcmF0b3IpO1xyXG4gICAgICAgIGlmICh0aGlzLl9oYXNoZXJbJ2lzRXF1YWwnXShpdGVtLmtleSwga2V5KSkge1xyXG4gICAgICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgICAgICAgaXRlcmF0b3I6IGl0ZXJhdG9yLFxyXG4gICAgICAgICAgICAgICAgaXNOZXc6IGZhbHNlLFxyXG4gICAgICAgICAgICAgICAgdmFsdWU6IGl0ZW0udmFsdWVcclxuICAgICAgICAgICAgfTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgaXRlcmF0b3IuX2ludGVybmFsSXRlcmF0b3IgPSBoYXNoRWxlbWVudHMubGlzdC5nZXROZXh0SXRlcmF0b3IoaXRlcmF0b3IuX2ludGVybmFsSXRlcmF0b3IpO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICB2YXIgdmFsdWUgPSBjcmVhdGVWYWx1ZSgpO1xyXG4gICAgaXRlcmF0b3IuX2ludGVybmFsSXRlcmF0b3IgPSBoYXNoRWxlbWVudHMubGlzdC5hZGQoe1xyXG4gICAgICAgIGtleToga2V5LFxyXG4gICAgICAgIHZhbHVlOiB2YWx1ZVxyXG4gICAgfSk7XHJcbiAgICArK3RoaXMuX2NvdW50O1xyXG4gICAgXHJcbiAgICByZXR1cm4ge1xyXG4gICAgICAgIGl0ZXJhdG9yOiBpdGVyYXRvcixcclxuICAgICAgICBpc05ldzogdHJ1ZSxcclxuICAgICAgICB2YWx1ZTogdmFsdWVcclxuICAgIH07XHJcbn07XHJcblxyXG5IYXNoTWFwLnByb3RvdHlwZS5yZW1vdmUgPSBmdW5jdGlvbiByZW1vdmUoaXRlcmF0b3IpIHtcclxuICAgIHZhciBvbGRMaXN0Q291bnQgPSBpdGVyYXRvci5faGFzaEVsZW1lbnRzLmxpc3QuZ2V0Q291bnQoKTtcclxuICAgIGl0ZXJhdG9yLl9oYXNoRWxlbWVudHMubGlzdC5yZW1vdmUoaXRlcmF0b3IuX2ludGVybmFsSXRlcmF0b3IpO1xyXG4gICAgdmFyIG5ld0xpc3RDb3VudCA9IGl0ZXJhdG9yLl9oYXNoRWxlbWVudHMubGlzdC5nZXRDb3VudCgpO1xyXG4gICAgXHJcbiAgICB0aGlzLl9jb3VudCArPSAobmV3TGlzdENvdW50IC0gb2xkTGlzdENvdW50KTtcclxuICAgIGlmIChuZXdMaXN0Q291bnQgPT09IDApIHtcclxuICAgICAgICB0aGlzLl9saXN0T2ZMaXN0cy5yZW1vdmUoaXRlcmF0b3IuX2hhc2hFbGVtZW50cy5saXN0T2ZMaXN0c0l0ZXJhdG9yKTtcclxuICAgICAgICBkZWxldGUgdGhpcy5fbGlzdEJ5S2V5W2l0ZXJhdG9yLl9oYXNoRWxlbWVudHMuaGFzaENvZGVdO1xyXG4gICAgfVxyXG59O1xyXG5cclxuSGFzaE1hcC5wcm90b3R5cGUuZ2V0Q291bnQgPSBmdW5jdGlvbiBnZXRDb3VudCgpIHtcclxuICAgIHJldHVybiB0aGlzLl9jb3VudDtcclxufTtcclxuXHJcbkhhc2hNYXAucHJvdG90eXBlLmdldEZpcnN0SXRlcmF0b3IgPSBmdW5jdGlvbiBnZXRGaXJzdEl0ZXJhdG9yKCkge1xyXG4gICAgdmFyIGZpcnN0TGlzdEl0ZXJhdG9yID0gdGhpcy5fbGlzdE9mTGlzdHMuZ2V0Rmlyc3RJdGVyYXRvcigpO1xyXG4gICAgdmFyIGZpcnN0SGFzaEVsZW1lbnRzID0gbnVsbDtcclxuICAgIHZhciBmaXJzdEludGVybmFsSXRlcmF0b3IgPSBudWxsO1xyXG4gICAgaWYgKGZpcnN0TGlzdEl0ZXJhdG9yICE9PSBudWxsKSB7XHJcbiAgICAgICAgZmlyc3RIYXNoRWxlbWVudHMgPSB0aGlzLl9saXN0T2ZMaXN0cy5nZXRGcm9tSXRlcmF0b3IoZmlyc3RMaXN0SXRlcmF0b3IpO1xyXG4gICAgICAgIGZpcnN0SW50ZXJuYWxJdGVyYXRvciA9IGZpcnN0SGFzaEVsZW1lbnRzLmxpc3QuZ2V0Rmlyc3RJdGVyYXRvcigpO1xyXG4gICAgfVxyXG4gICAgaWYgKGZpcnN0SW50ZXJuYWxJdGVyYXRvciA9PT0gbnVsbCkge1xyXG4gICAgICAgIHJldHVybiBudWxsO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICByZXR1cm4ge1xyXG4gICAgICAgIF9oYXNoRWxlbWVudHM6IGZpcnN0SGFzaEVsZW1lbnRzLFxyXG4gICAgICAgIF9pbnRlcm5hbEl0ZXJhdG9yOiBmaXJzdEludGVybmFsSXRlcmF0b3JcclxuICAgIH07XHJcbn07XHJcblxyXG5IYXNoTWFwLnByb3RvdHlwZS5nZXROZXh0SXRlcmF0b3IgPSBmdW5jdGlvbiBnZXROZXh0SXRlcmF0b3IoaXRlcmF0b3IpIHtcclxuICAgIHZhciBuZXh0SXRlcmF0b3IgPSB7XHJcbiAgICAgICAgX2hhc2hFbGVtZW50czogaXRlcmF0b3IuX2hhc2hFbGVtZW50cyxcclxuICAgICAgICBfaW50ZXJuYWxJdGVyYXRvcjogaXRlcmF0b3IuX2hhc2hFbGVtZW50cy5saXN0LmdldE5leHRJdGVyYXRvcihcclxuICAgICAgICAgICAgaXRlcmF0b3IuX2ludGVybmFsSXRlcmF0b3IpXHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICB3aGlsZSAobmV4dEl0ZXJhdG9yLl9pbnRlcm5hbEl0ZXJhdG9yID09PSBudWxsKSB7XHJcbiAgICAgICAgdmFyIG5leHRMaXN0T2ZMaXN0c0l0ZXJhdG9yID0gdGhpcy5fbGlzdE9mTGlzdHMuZ2V0TmV4dEl0ZXJhdG9yKFxyXG4gICAgICAgICAgICBpdGVyYXRvci5faGFzaEVsZW1lbnRzLmxpc3RPZkxpc3RzSXRlcmF0b3IpO1xyXG4gICAgICAgIGlmIChuZXh0TGlzdE9mTGlzdHNJdGVyYXRvciA9PT0gbnVsbCkge1xyXG4gICAgICAgICAgICByZXR1cm4gbnVsbDtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgbmV4dEl0ZXJhdG9yLl9oYXNoRWxlbWVudHMgPSB0aGlzLl9saXN0T2ZMaXN0cy5nZXRGcm9tSXRlcmF0b3IoXHJcbiAgICAgICAgICAgIG5leHRMaXN0T2ZMaXN0c0l0ZXJhdG9yKTtcclxuICAgICAgICBuZXh0SXRlcmF0b3IuX2ludGVybmFsSXRlcmF0b3IgPVxyXG4gICAgICAgICAgICBuZXh0SXRlcmF0b3IuX2hhc2hFbGVtZW50cy5saXN0LmdldEZpcnN0SXRlcmF0b3IoKTtcclxuICAgIH1cclxuICAgIHJldHVybiBuZXh0SXRlcmF0b3I7XHJcbn07XHJcblxyXG5yZXR1cm4gSGFzaE1hcDtcclxufSkoKTtcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gSGFzaE1hcDsiLCIndXNlIHN0cmljdCc7XHJcblxyXG52YXIgSGFzaE1hcCA9IHJlcXVpcmUoJ2hhc2gtbWFwJyk7XHJcblxyXG52YXIgSnNCdWlsdGluSGFzaE1hcCA9IChmdW5jdGlvbiBIYXNoTWFwQ2xvc3VyZSgpIHtcclxuICAgIFxyXG4vLyBUaGlzIGNsYXNzIGV4cG9zZSBzYW1lIEFQSSBhcyBIYXNoTWFwIGJ1dCBub3QgcmVxdWlyaW5nIGdldEhhc2hDb2RlKCkgYW5kIGlzRXF1YWwoKSBmdW5jdGlvbnMuXHJcbi8vIFRoYXQgd2F5IGl0J3MgZWFzeSB0byBzd2l0Y2ggYmV0d2VlbiBpbXBsZW1lbnRhdGlvbnMuXHJcblxyXG52YXIgc2ltcGxlSGFzaGVyID0ge1xyXG4gICAgJ2dldEhhc2hDb2RlJzogZnVuY3Rpb24gZ2V0SGFzaENvZGUoa2V5KSB7XHJcbiAgICAgICAgcmV0dXJuIGtleTtcclxuICAgIH0sXHJcbiAgICBcclxuICAgICdpc0VxdWFsJzogZnVuY3Rpb24gaXNFcXVhbChrZXkxLCBrZXkyKSB7XHJcbiAgICAgICAgcmV0dXJuIGtleTEgPT09IGtleTI7XHJcbiAgICB9XHJcbn07XHJcblxyXG5mdW5jdGlvbiBKc0J1aWx0aW5IYXNoTWFwKCkge1xyXG4gICAgSGFzaE1hcC5jYWxsKHRoaXMsIC8qaGFzaGVyPSovc2ltcGxlSGFzaGVyKTtcclxufVxyXG5cclxuSnNCdWlsdGluSGFzaE1hcC5wcm90b3R5cGUgPSBPYmplY3QuY3JlYXRlKEhhc2hNYXAucHJvdG90eXBlKTtcclxuXHJcbnJldHVybiBKc0J1aWx0aW5IYXNoTWFwO1xyXG59KSgpO1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBKc0J1aWx0aW5IYXNoTWFwOyIsIid1c2Ugc3RyaWN0JztcclxuXHJcbnZhciBMaW5rZWRMaXN0ID0gKGZ1bmN0aW9uIExpbmtlZExpc3RDbG9zdXJlKCkge1xyXG5cclxuZnVuY3Rpb24gTGlua2VkTGlzdCgpIHtcclxuICAgIHRoaXMuY2xlYXIoKTtcclxufVxyXG5cclxuTGlua2VkTGlzdC5wcm90b3R5cGUuY2xlYXIgPSBmdW5jdGlvbiBjbGVhcigpIHtcclxuICAgIHRoaXMuX2ZpcnN0ID0geyBfcHJldjogbnVsbCwgX3BhcmVudDogdGhpcyB9O1xyXG4gICAgdGhpcy5fbGFzdCA9IHsgX25leHQ6IG51bGwsIF9wYXJlbnQ6IHRoaXMgfTtcclxuICAgIHRoaXMuX2NvdW50ID0gMDtcclxuICAgIFxyXG4gICAgdGhpcy5fbGFzdC5fcHJldiA9IHRoaXMuX2ZpcnN0O1xyXG4gICAgdGhpcy5fZmlyc3QuX25leHQgPSB0aGlzLl9sYXN0O1xyXG59O1xyXG5cclxuTGlua2VkTGlzdC5wcm90b3R5cGUuYWRkID0gZnVuY3Rpb24gYWRkKHZhbHVlLCBhZGRCZWZvcmUpIHtcclxuICAgIGlmIChhZGRCZWZvcmUgPT09IG51bGwgfHwgYWRkQmVmb3JlID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICBhZGRCZWZvcmUgPSB0aGlzLl9sYXN0O1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICB0aGlzLl92YWxpZGF0ZUl0ZXJhdG9yT2ZUaGlzKGFkZEJlZm9yZSk7XHJcbiAgICBcclxuICAgICsrdGhpcy5fY291bnQ7XHJcbiAgICBcclxuICAgIHZhciBuZXdOb2RlID0ge1xyXG4gICAgICAgIF92YWx1ZTogdmFsdWUsXHJcbiAgICAgICAgX25leHQ6IGFkZEJlZm9yZSxcclxuICAgICAgICBfcHJldjogYWRkQmVmb3JlLl9wcmV2LFxyXG4gICAgICAgIF9wYXJlbnQ6IHRoaXNcclxuICAgIH07XHJcbiAgICBcclxuICAgIG5ld05vZGUuX3ByZXYuX25leHQgPSBuZXdOb2RlO1xyXG4gICAgYWRkQmVmb3JlLl9wcmV2ID0gbmV3Tm9kZTtcclxuICAgIFxyXG4gICAgcmV0dXJuIG5ld05vZGU7XHJcbn07XHJcblxyXG5MaW5rZWRMaXN0LnByb3RvdHlwZS5yZW1vdmUgPSBmdW5jdGlvbiByZW1vdmUoaXRlcmF0b3IpIHtcclxuICAgIHRoaXMuX3ZhbGlkYXRlSXRlcmF0b3JPZlRoaXMoaXRlcmF0b3IpO1xyXG4gICAgXHJcbiAgICAtLXRoaXMuX2NvdW50O1xyXG4gICAgXHJcbiAgICBpdGVyYXRvci5fcHJldi5fbmV4dCA9IGl0ZXJhdG9yLl9uZXh0O1xyXG4gICAgaXRlcmF0b3IuX25leHQuX3ByZXYgPSBpdGVyYXRvci5fcHJldjtcclxuICAgIGl0ZXJhdG9yLl9wYXJlbnQgPSBudWxsO1xyXG59O1xyXG5cclxuTGlua2VkTGlzdC5wcm90b3R5cGUuZ2V0RnJvbUl0ZXJhdG9yID0gZnVuY3Rpb24gZ2V0RnJvbUl0ZXJhdG9yKGl0ZXJhdG9yKSB7XHJcbiAgICB0aGlzLl92YWxpZGF0ZUl0ZXJhdG9yT2ZUaGlzKGl0ZXJhdG9yKTtcclxuICAgIFxyXG4gICAgcmV0dXJuIGl0ZXJhdG9yLl92YWx1ZTtcclxufTtcclxuXHJcbkxpbmtlZExpc3QucHJvdG90eXBlLmdldEZpcnN0SXRlcmF0b3IgPSBmdW5jdGlvbiBnZXRGaXJzdEl0ZXJhdG9yKCkge1xyXG4gICAgdmFyIGl0ZXJhdG9yID0gdGhpcy5nZXROZXh0SXRlcmF0b3IodGhpcy5fZmlyc3QpO1xyXG4gICAgcmV0dXJuIGl0ZXJhdG9yO1xyXG59O1xyXG5cclxuTGlua2VkTGlzdC5wcm90b3R5cGUuZ2V0TGFzdEl0ZXJhdG9yID0gZnVuY3Rpb24gZ2V0Rmlyc3RJdGVyYXRvcigpIHtcclxuICAgIHZhciBpdGVyYXRvciA9IHRoaXMuZ2V0UHJldkl0ZXJhdG9yKHRoaXMuX2xhc3QpO1xyXG4gICAgcmV0dXJuIGl0ZXJhdG9yO1xyXG59O1xyXG5cclxuTGlua2VkTGlzdC5wcm90b3R5cGUuZ2V0TmV4dEl0ZXJhdG9yID0gZnVuY3Rpb24gZ2V0TmV4dEl0ZXJhdG9yKGl0ZXJhdG9yKSB7XHJcbiAgICB0aGlzLl92YWxpZGF0ZUl0ZXJhdG9yT2ZUaGlzKGl0ZXJhdG9yKTtcclxuXHJcbiAgICBpZiAoaXRlcmF0b3IuX25leHQgPT09IHRoaXMuX2xhc3QpIHtcclxuICAgICAgICByZXR1cm4gbnVsbDtcclxuICAgIH1cclxuICAgIFxyXG4gICAgcmV0dXJuIGl0ZXJhdG9yLl9uZXh0O1xyXG59O1xyXG5cclxuTGlua2VkTGlzdC5wcm90b3R5cGUuZ2V0UHJldkl0ZXJhdG9yID0gZnVuY3Rpb24gZ2V0UHJldkl0ZXJhdG9yKGl0ZXJhdG9yKSB7XHJcbiAgICB0aGlzLl92YWxpZGF0ZUl0ZXJhdG9yT2ZUaGlzKGl0ZXJhdG9yKTtcclxuXHJcbiAgICBpZiAoaXRlcmF0b3IuX3ByZXYgPT09IHRoaXMuX2ZpcnN0KSB7XHJcbiAgICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHJldHVybiBpdGVyYXRvci5fcHJldjtcclxufTtcclxuXHJcbkxpbmtlZExpc3QucHJvdG90eXBlLmdldENvdW50ID0gZnVuY3Rpb24gZ2V0Q291bnQoKSB7XHJcbiAgICByZXR1cm4gdGhpcy5fY291bnQ7XHJcbn07XHJcblxyXG5MaW5rZWRMaXN0LnByb3RvdHlwZS5fdmFsaWRhdGVJdGVyYXRvck9mVGhpcyA9XHJcbiAgICBmdW5jdGlvbiB2YWxpZGF0ZUl0ZXJhdG9yT2ZUaGlzKGl0ZXJhdG9yKSB7XHJcbiAgICBcclxuICAgIGlmIChpdGVyYXRvci5fcGFyZW50ICE9PSB0aGlzKSB7XHJcbiAgICAgICAgdGhyb3cgJ2l0ZXJhdG9yIG11c3QgYmUgb2YgdGhlIGN1cnJlbnQgTGlua2VkTGlzdCc7XHJcbiAgICB9XHJcbn07XHJcblxyXG5yZXR1cm4gTGlua2VkTGlzdDtcclxufSkoKTtcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gTGlua2VkTGlzdDsiLCIndXNlIHN0cmljdCc7XHJcblxyXG52YXIgU2NoZWR1bGVyV3JhcHBlcklucHV0UmV0cmVpdmVyID0gcmVxdWlyZSgnc2NoZWR1bGVyLXdyYXBwZXItaW5wdXQtcmV0cmVpdmVyJyk7XHJcbnZhciBEZXBlbmRlbmN5V29ya2VycyA9IHJlcXVpcmUoJ2RlcGVuZGVuY3ktd29ya2VycycpO1xyXG5cclxudmFyIFNjaGVkdWxlckRlcGVuZGVuY3lXb3JrZXJzID0gKGZ1bmN0aW9uIFNjaGVkdWxlckRlcGVuZGVuY3lXb3JrZXJzQ2xvc3VyZSgpIHtcclxuICAgIGZ1bmN0aW9uIFNjaGVkdWxlckRlcGVuZGVuY3lXb3JrZXJzKHNjaGVkdWxlciwgaW5wdXRSZXRyZWl2ZXIpIHtcclxuICAgICAgICB2YXIgd3JhcHBlcklucHV0UmV0cmVpdmVyID0gbmV3IFNjaGVkdWxlcldyYXBwZXJJbnB1dFJldHJlaXZlcihzY2hlZHVsZXIsIGlucHV0UmV0cmVpdmVyKTtcclxuICAgICAgICBEZXBlbmRlbmN5V29ya2Vycy5jYWxsKHRoaXMsIHdyYXBwZXJJbnB1dFJldHJlaXZlcik7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIFNjaGVkdWxlckRlcGVuZGVuY3lXb3JrZXJzLnByb3RvdHlwZSA9IE9iamVjdC5jcmVhdGUoRGVwZW5kZW5jeVdvcmtlcnMucHJvdG90eXBlKTtcclxuICAgIFxyXG4gICAgcmV0dXJuIFNjaGVkdWxlckRlcGVuZGVuY3lXb3JrZXJzO1xyXG59KSgpO1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBTY2hlZHVsZXJEZXBlbmRlbmN5V29ya2VyczsiLCIndXNlIHN0cmljdCc7XHJcblxyXG52YXIgRGVwZW5kZW5jeVdvcmtlcnNUYXNrID0gcmVxdWlyZSgnZGVwZW5kZW5jeS13b3JrZXJzLXRhc2snKTtcclxuXHJcbnZhciBTY2hlZHVsZXJUYXNrID0gKGZ1bmN0aW9uIFNjaGVkdWxlclRhc2tDbG9zdXJlKCkge1xyXG4gICAgZnVuY3Rpb24gU2NoZWR1bGVyVGFzayhzY2hlZHVsZXIsIGlucHV0UmV0cmVpdmVyLCBpc0Rpc2FibGVXb3JrZXJDYWNoZSwgd3JhcHBlZFRhc2spIHtcclxuICAgICAgICB2YXIgdGhhdCA9IHRoaXM7XHJcblx0XHREZXBlbmRlbmN5V29ya2Vyc1Rhc2suY2FsbCh0aGlzLCB3cmFwcGVkVGFzaywgd3JhcHBlZFRhc2sua2V5LCAvKnJlZ2lzdGVyV3JhcHBlZEV2ZW50cz0qL3RydWUpO1xyXG4gICAgICAgIHRoYXQuX3NjaGVkdWxlciA9IHNjaGVkdWxlcjtcclxuXHRcdHRoYXQuX2lucHV0UmV0cmVpdmVyID0gaW5wdXRSZXRyZWl2ZXI7XHJcblx0XHR0aGF0Ll9pc0Rpc2FibGVXb3JrZXJDYWNoZSA9IGlzRGlzYWJsZVdvcmtlckNhY2hlO1xyXG5cdFx0dGhhdC5fd3JhcHBlZFRhc2sgPSB3cmFwcGVkVGFzaztcclxuICAgICAgICB0aGF0Ll9vblNjaGVkdWxlZEJvdW5kID0gdGhhdC5fb25TY2hlZHVsZWQuYmluZCh0aGF0KTtcclxuICAgICAgICBcclxuXHRcdHRoYXQuX2pvYkNhbGxiYWNrcyA9IG51bGw7XHJcbiAgICAgICAgdGhhdC5fcGVuZGluZ0RhdGFUb1Byb2Nlc3MgPSBudWxsO1xyXG5cdFx0dGhhdC5fcGVuZGluZ1dvcmtlclR5cGUgPSAwO1xyXG4gICAgICAgIHRoYXQuX2hhc1BlbmRpbmdEYXRhVG9Qcm9jZXNzID0gZmFsc2U7XHJcbiAgICAgICAgdGhhdC5fY2FuY2VsUGVuZGluZ0RhdGFUb1Byb2Nlc3MgPSBmYWxzZTtcclxuICAgICAgICB0aGF0Ll9pc1dvcmtlckFjdGl2ZSA9IGZhbHNlO1xyXG5cdFx0dGhhdC5faXNUZXJtaW5hdGVkID0gZmFsc2U7XHJcbiAgICAgICAgdGhhdC5fbGFzdFN0YXR1cyA9IHsgJ2lzV2FpdGluZ0ZvcldvcmtlclJlc3VsdCc6IGZhbHNlIH07XHJcbiAgICB9XHJcblx0XHJcblx0U2NoZWR1bGVyVGFzay5wcm90b3R5cGUgPSBPYmplY3QuY3JlYXRlKERlcGVuZGVuY3lXb3JrZXJzVGFzay5wcm90b3R5cGUpO1xyXG4gICAgXHJcbiAgICBTY2hlZHVsZXJUYXNrLnByb3RvdHlwZS5fbW9kaWZ5U3RhdHVzID0gZnVuY3Rpb24gbW9kaWZ5U3RhdHVzKHN0YXR1cykge1xyXG4gICAgICAgIHRoaXMuX2xhc3RTdGF0dXMgPSBKU09OLnBhcnNlKEpTT04uc3RyaW5naWZ5KHN0YXR1cykpO1xyXG4gICAgICAgIHRoaXMuX2NoZWNrSWZKb2JEb25lKHN0YXR1cyk7XHJcbiAgICAgICAgdGhpcy5fbGFzdFN0YXR1cy5pc1dhaXRpbmdGb3JXb3JrZXJSZXN1bHQgPVxyXG4gICAgICAgICAgICBzdGF0dXMuaXNXYWl0aW5nRm9yV29ya2VyUmVzdWx0IHx8IHRoaXMuX2hhc1BlbmRpbmdEYXRhVG9Qcm9jZXNzO1xyXG4gICAgICAgIFxyXG5cdFx0cmV0dXJuIHRoaXMuX2xhc3RTdGF0dXM7XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBTY2hlZHVsZXJUYXNrLnByb3RvdHlwZS5kYXRhUmVhZHkgPSBmdW5jdGlvbiBvbkRhdGFSZWFkeVRvUHJvY2VzcyhcclxuICAgICAgICAgICAgbmV3RGF0YVRvUHJvY2Vzcywgd29ya2VyVHlwZSkge1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgaWYgKHRoaXMuX2lzVGVybWluYXRlZCkge1xyXG4gICAgICAgICAgICB0aHJvdyAnZGVwZW5kZW5jeVdvcmtlcnM6IERhdGEgYWZ0ZXIgdGVybWluYXRpb24nO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBpZiAodGhpcy5faXNEaXNhYmxlV29ya2VyQ2FjaGVbd29ya2VyVHlwZV0gPT09IHVuZGVmaW5lZCkge1xyXG5cdFx0XHR0aGlzLl9pc0Rpc2FibGVXb3JrZXJDYWNoZVt3b3JrZXJUeXBlXSA9IHRoaXMuX2lucHV0UmV0cmVpdmVyLmdldFdvcmtlclR5cGVPcHRpb25zKHdvcmtlclR5cGUpID09PSBudWxsO1xyXG5cdFx0fVxyXG5cdFx0aWYgKHRoaXMuX2lzRGlzYWJsZVdvcmtlckNhY2hlW3dvcmtlclR5cGVdKSB7XHJcbiAgICAgICAgICAgIHRoaXMuX3BlbmRpbmdEYXRhVG9Qcm9jZXNzID0gbnVsbDtcclxuICAgICAgICAgICAgdGhpcy5fY2FuY2VsUGVuZGluZ0RhdGFUb1Byb2Nlc3MgPVxyXG4gICAgICAgICAgICAgICAgdGhpcy5faGFzUGVuZGluZ0RhdGFUb1Byb2Nlc3MgJiYgIXRoaXMuX2lzV29ya2VyQWN0aXZlO1xyXG4gICAgICAgICAgICB0aGlzLl9oYXNQZW5kaW5nRGF0YVRvUHJvY2VzcyA9IGZhbHNlO1xyXG4gICAgICAgICAgICBEZXBlbmRlbmN5V29ya2Vyc1Rhc2sucHJvdG90eXBlLmRhdGFSZWFkeS5jYWxsKHRoaXMsIG5ld0RhdGFUb1Byb2Nlc3MsIHdvcmtlclR5cGUpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgdmFyIGlzU3RhdHVzQ2hhbmdlZCA9XHJcbiAgICAgICAgICAgICAgICB0aGlzLl9sYXN0U3RhdHVzLmlzV2FpdGluZ0ZvcldvcmtlclJlc3VsdCAmJlxyXG4gICAgICAgICAgICAgICAgIXRoaXMuX2hhc1BlbmRpbmdEYXRhVG9Qcm9jZXNzO1xyXG4gICAgICAgICAgICBpZiAoaXNTdGF0dXNDaGFuZ2VkKSB7XHJcbiAgICAgICAgICAgICAgICB0aGlzLl9sYXN0U3RhdHVzLmlzV2FpdGluZ0ZvcldvcmtlclJlc3VsdCA9IGZhbHNlO1xyXG4gICAgICAgICAgICAgICAgdGhpcy5fb25FdmVudCgnc3RhdHVzVXBkYXRlZCcsIHRoaXMuX2xhc3RTdGF0dXMpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHRoaXMuX3BlbmRpbmdEYXRhVG9Qcm9jZXNzID0gbmV3RGF0YVRvUHJvY2VzcztcclxuXHRcdHRoaXMuX3BlbmRpbmdXb3JrZXJUeXBlID0gd29ya2VyVHlwZTtcclxuICAgICAgICB0aGlzLl9jYW5jZWxQZW5kaW5nRGF0YVRvUHJvY2VzcyA9IGZhbHNlO1xyXG4gICAgICAgIHZhciBoYWRQZW5kaW5nRGF0YVRvUHJvY2VzcyA9IHRoaXMuX2hhc1BlbmRpbmdEYXRhVG9Qcm9jZXNzO1xyXG4gICAgICAgIHRoaXMuX2hhc1BlbmRpbmdEYXRhVG9Qcm9jZXNzID0gdHJ1ZTtcclxuXHJcbiAgICAgICAgaWYgKCFoYWRQZW5kaW5nRGF0YVRvUHJvY2VzcyAmJiAhdGhpcy5faXNXb3JrZXJBY3RpdmUpIHtcclxuICAgICAgICAgICAgdGhpcy5fc2NoZWR1bGVyLmVucXVldWVKb2IoXHJcbiAgICAgICAgICAgICAgICB0aGlzLl9vblNjaGVkdWxlZEJvdW5kLCB0aGlzKTtcclxuICAgICAgICB9XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBTY2hlZHVsZXJUYXNrLnByb3RvdHlwZS50ZXJtaW5hdGUgPSBmdW5jdGlvbiB0ZXJtaW5hdGUoKSB7XHJcbiAgICAgICAgaWYgKHRoaXMuX2lzVGVybWluYXRlZCkge1xyXG4gICAgICAgICAgICB0aHJvdyAnZGVwZW5kZW5jeVdvcmtlcnM6IERvdWJsZSB0ZXJtaW5hdGlvbic7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHRoaXMuX2lzVGVybWluYXRlZCA9IHRydWU7XHJcbiAgICAgICAgaWYgKCF0aGlzLl9oYXNQZW5kaW5nRGF0YVRvUHJvY2Vzcykge1xyXG5cdFx0XHREZXBlbmRlbmN5V29ya2Vyc1Rhc2sucHJvdG90eXBlLnRlcm1pbmF0ZS5jYWxsKHRoaXMpO1xyXG5cdFx0fVxyXG4gICAgfTtcclxuICAgIFxyXG4gICAgU2NoZWR1bGVyVGFzay5wcm90b3R5cGUuX29uU2NoZWR1bGVkID0gZnVuY3Rpb24gZGF0YVJlYWR5Rm9yV29ya2VyKFxyXG4gICAgICAgICAgICByZXNvdXJjZSwgam9iQ29udGV4dCwgam9iQ2FsbGJhY2tzKSB7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICBpZiAoam9iQ29udGV4dCAhPT0gdGhpcykge1xyXG4gICAgICAgICAgICB0aHJvdyAnZGVwZW5kZW5jeVdvcmtlcnM6IFVuZXhwZWN0ZWQgY29udGV4dCc7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIGlmICh0aGlzLl9jYW5jZWxQZW5kaW5nRGF0YVRvUHJvY2Vzcykge1xyXG4gICAgICAgICAgICB0aGlzLl9jYW5jZWxQZW5kaW5nRGF0YVRvUHJvY2VzcyA9IGZhbHNlO1xyXG5cdFx0XHRqb2JDYWxsYmFja3Muam9iRG9uZSgpO1xyXG4gICAgICAgIH0gZWxzZSB7XHJcblx0XHRcdGlmICghdGhpcy5faGFzUGVuZGluZ0RhdGFUb1Byb2Nlc3MpIHtcclxuXHRcdFx0XHR0aHJvdyAnZGVwZW5kZW5jeVdvcmtlcnM6ICFlbnF1ZXVlZFByb2Nlc3NKb2InO1xyXG5cdFx0XHR9XHJcblx0XHRcdFxyXG5cdFx0XHR0aGlzLl9pc1dvcmtlckFjdGl2ZSA9IHRydWU7XHJcblx0XHRcdHRoaXMuX2hhc1BlbmRpbmdEYXRhVG9Qcm9jZXNzID0gZmFsc2U7XHJcblx0XHRcdHRoaXMuX2pvYkNhbGxiYWNrcyA9IGpvYkNhbGxiYWNrcztcclxuXHRcdFx0dmFyIGRhdGEgPSB0aGlzLl9wZW5kaW5nRGF0YVRvUHJvY2VzcztcclxuXHRcdFx0dGhpcy5fcGVuZGluZ0RhdGFUb1Byb2Nlc3MgPSBudWxsO1xyXG5cdFx0XHREZXBlbmRlbmN5V29ya2Vyc1Rhc2sucHJvdG90eXBlLmRhdGFSZWFkeS5jYWxsKHRoaXMsIGRhdGEsIHRoaXMuX3BlbmRpbmdXb3JrZXJUeXBlKTtcclxuXHRcdH1cclxuXHRcdFxyXG5cdFx0aWYgKHRoaXMuX2lzVGVybWluYXRlZCkge1xyXG5cdFx0XHREZXBlbmRlbmN5V29ya2Vyc1Rhc2sucHJvdG90eXBlLnRlcm1pbmF0ZS5jYWxsKHRoaXMpO1xyXG5cdFx0fVxyXG4gICAgfTtcclxuICAgIFxyXG4gICAgU2NoZWR1bGVyVGFzay5wcm90b3R5cGUuX2NoZWNrSWZKb2JEb25lID0gZnVuY3Rpb24gY2hlY2tJZkpvYkRvbmUoc3RhdHVzKSB7XHJcbiAgICAgICAgaWYgKCF0aGlzLl9pc1dvcmtlckFjdGl2ZSB8fCBzdGF0dXMuaXNXYWl0aW5nRm9yV29ya2VyUmVzdWx0KSB7XHJcbiAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKHRoaXMuX2NhbmNlbFBlbmRpbmdEYXRhVG9Qcm9jZXNzKSB7XHJcbiAgICAgICAgICAgIHRocm93ICdkZXBlbmRlbmN5V29ya2VyczogY2FuY2VsUGVuZGluZ0RhdGFUb1Byb2Nlc3MnO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICB0aGlzLl9pc1dvcmtlckFjdGl2ZSA9IGZhbHNlO1xyXG4gICAgICAgIFxyXG5cdFx0dmFyIGpvYkNhbGxiYWNrcyA9IHRoaXMuX2pvYkNhbGxiYWNrcztcclxuXHRcdHRoaXMuX2pvYkNhbGxiYWNrcyA9IG51bGw7XHJcblx0XHRcclxuICAgICAgICBpZiAodGhpcy5faGFzUGVuZGluZ0RhdGFUb1Byb2Nlc3MpIHtcclxuICAgICAgICAgICAgdGhpcy5fc2NoZWR1bGVyLmVucXVldWVKb2IoXHJcbiAgICAgICAgICAgICAgICB0aGlzLl9vblNjaGVkdWxlZEJvdW5kLCB0aGlzKTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGpvYkNhbGxiYWNrcy5qb2JEb25lKCk7XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICByZXR1cm4gU2NoZWR1bGVyVGFzaztcclxufSkoKTtcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gU2NoZWR1bGVyVGFzazsiLCIndXNlIHN0cmljdCc7XHJcblxyXG52YXIgU2NoZWR1bGVyVGFzayA9IHJlcXVpcmUoJ3NjaGVkdWxlci10YXNrJyk7XHJcbnZhciBXcmFwcGVySW5wdXRSZXRyZWl2ZXJCYXNlID0gcmVxdWlyZSgnd3JhcHBlci1pbnB1dC1yZXRyZWl2ZXItYmFzZScpO1xyXG5cclxudmFyIFNjaGVkdWxlcldyYXBwZXJJbnB1dFJldHJlaXZlciA9IChmdW5jdGlvbiBTY2hlZHVsZXJXcmFwcGVySW5wdXRSZXRyZWl2ZXJDbG9zdXJlKCkge1xyXG4gICAgZnVuY3Rpb24gU2NoZWR1bGVyV3JhcHBlcklucHV0UmV0cmVpdmVyKHNjaGVkdWxlciwgaW5wdXRSZXRyZWl2ZXIpIHtcclxuICAgICAgICBXcmFwcGVySW5wdXRSZXRyZWl2ZXJCYXNlLmNhbGwodGhpcywgaW5wdXRSZXRyZWl2ZXIpO1xyXG4gICAgICAgIHZhciB0aGF0ID0gdGhpcztcclxuICAgICAgICB0aGF0Ll9zY2hlZHVsZXIgPSBzY2hlZHVsZXI7XHJcblx0XHR0aGF0Ll9pbnB1dFJldHJlaXZlciA9IGlucHV0UmV0cmVpdmVyO1xyXG5cdFx0dGhhdC5faXNEaXNhYmxlV29ya2VyQ2FjaGUgPSB7fTtcclxuXHJcbiAgICAgICAgaWYgKCFpbnB1dFJldHJlaXZlci50YXNrU3RhcnRlZCkge1xyXG4gICAgICAgICAgICB0aHJvdyAnZGVwZW5kZW5jeVdvcmtlcnM6IE5vICcgK1xyXG4gICAgICAgICAgICAgICAgJ2lucHV0UmV0cmVpdmVyLnRhc2tTdGFydGVkKCkgbWV0aG9kJztcclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICBcclxuICAgIFNjaGVkdWxlcldyYXBwZXJJbnB1dFJldHJlaXZlci5wcm90b3R5cGUgPSBPYmplY3QuY3JlYXRlKFdyYXBwZXJJbnB1dFJldHJlaXZlckJhc2UucHJvdG90eXBlKTtcclxuICAgIFxyXG4gICAgU2NoZWR1bGVyV3JhcHBlcklucHV0UmV0cmVpdmVyLnByb3RvdHlwZS50YXNrU3RhcnRlZCA9XHJcbiAgICAgICAgICAgIGZ1bmN0aW9uIHRhc2tTdGFydGVkKHRhc2spIHtcclxuICAgICAgICBcclxuICAgICAgICB2YXIgd3JhcHBlclRhc2sgPSBuZXcgU2NoZWR1bGVyVGFzayhcclxuXHRcdFx0dGhpcy5fc2NoZWR1bGVyLCB0aGlzLl9pbnB1dFJldHJlaXZlciwgdGhpcy5faXNEaXNhYmxlV29ya2VyQ2FjaGUsIHRhc2spO1xyXG4gICAgICAgIHJldHVybiB0aGlzLl9pbnB1dFJldHJlaXZlci50YXNrU3RhcnRlZCh3cmFwcGVyVGFzayk7XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICByZXR1cm4gU2NoZWR1bGVyV3JhcHBlcklucHV0UmV0cmVpdmVyO1xyXG59KSgpO1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBTY2hlZHVsZXJXcmFwcGVySW5wdXRSZXRyZWl2ZXI7IiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxudmFyIFdyYXBwZXJJbnB1dFJldHJlaXZlckJhc2UgPSAoZnVuY3Rpb24gV3JhcHBlcklucHV0UmV0cmVpdmVyQmFzZUNsb3N1cmUoKSB7XHJcbiAgICBmdW5jdGlvbiBXcmFwcGVySW5wdXRSZXRyZWl2ZXJCYXNlKGlucHV0UmV0cmVpdmVyKSB7XHJcbiAgICAgICAgaWYgKCFpbnB1dFJldHJlaXZlci5nZXRLZXlBc1N0cmluZykge1xyXG4gICAgICAgICAgICB0aHJvdyAnZGVwZW5kZW5jeVdvcmtlcnM6IE5vICcgK1xyXG4gICAgICAgICAgICAgICAgJ2lucHV0UmV0cmVpdmVyLmdldEtleUFzU3RyaW5nKCkgbWV0aG9kJztcclxuICAgICAgICB9XHJcbiAgICAgICAgaWYgKCFpbnB1dFJldHJlaXZlci5nZXRXb3JrZXJUeXBlT3B0aW9ucykge1xyXG4gICAgICAgICAgICB0aHJvdyAnZGVwZW5kZW5jeVdvcmtlcnM6IE5vICcgK1xyXG4gICAgICAgICAgICAgICAgJ2lucHV0UmV0cmVpdmVyLmdldFRhc2tUeXBlT3B0aW9ucygpIG1ldGhvZCc7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICB2YXIgdGhhdCA9IHRoaXM7XHJcbiAgICAgICAgdGhhdC5faW5wdXRSZXRyZWl2ZXIgPSBpbnB1dFJldHJlaXZlcjtcclxuICAgIH1cclxuICAgIFxyXG4gICAgV3JhcHBlcklucHV0UmV0cmVpdmVyQmFzZS5wcm90b3R5cGUudGFza1N0YXJ0ZWQgPVxyXG4gICAgICAgICAgICBmdW5jdGlvbiB0YXNrU3RhcnRlZCh0YXNrKSB7XHJcbiAgICAgICAgXHJcbiAgICAgICAgdGhyb3cgJ2RlcGVuZGVuY3lXb3JrZXJzOiBOb3QgaW1wbGVtZW50ZWQgdGFza1N0YXJ0ZWQoKSc7XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBXcmFwcGVySW5wdXRSZXRyZWl2ZXJCYXNlLnByb3RvdHlwZS5nZXRLZXlBc1N0cmluZyA9IGZ1bmN0aW9uKGtleSkge1xyXG4gICAgICAgIHJldHVybiB0aGlzLl9pbnB1dFJldHJlaXZlci5nZXRLZXlBc1N0cmluZyhrZXkpO1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgXHJcbiAgICBXcmFwcGVySW5wdXRSZXRyZWl2ZXJCYXNlLnByb3RvdHlwZS5nZXRXb3JrZXJUeXBlT3B0aW9ucyA9IGZ1bmN0aW9uKHRhc2tUeXBlKSB7XHJcbiAgICAgICAgcmV0dXJuIHRoaXMuX2lucHV0UmV0cmVpdmVyLmdldFdvcmtlclR5cGVPcHRpb25zKHRhc2tUeXBlKTtcclxuICAgIH07XHJcbiAgICBcclxuICAgIHJldHVybiBXcmFwcGVySW5wdXRSZXRyZWl2ZXJCYXNlO1xyXG59KSgpO1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBXcmFwcGVySW5wdXRSZXRyZWl2ZXJCYXNlOyJdfQ==

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
},{"canvas-imagery-provider.js":1,"cesium-frustum-calculator.js":2,"image-decoder-viewer.js":16}],4:[function(require,module,exports){
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
        
    var bestLevel = this._imageDecoder.getImageLevel();
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
},{"cesium-image-decoder-layer-manager.js":3,"grid-decoder-worker-base.js":23,"grid-fetcher-base.js":24,"grid-image-base.js":25,"grid-level-calculator.js":26,"image-decoder-imagery-provider.js":4,"image-decoder-region-layer.js":21,"image-decoder-viewer.js":16,"image-decoder.js":20,"image-helper-functions.js":13,"simple-fetcher-base.js":27,"worker-proxy-image-decoder.js":19}],6:[function(require,module,exports){
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
    
    if (this._showLog) {
        // Old IE
        throw 'imageDecoderFramework error: showLog is not supported on this browser';
    }
	
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
},{}],15:[function(require,module,exports){
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
},{"fetch-context-api.js":8}],16:[function(require,module,exports){
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
},{"image-helper-functions.js":13}],17:[function(require,module,exports){
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
},{}],19:[function(require,module,exports){
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
},{"image-helper-functions.js":13,"image-params-retriever-proxy.js":17}],20:[function(require,module,exports){
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
        terminatedCallback,
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
},{"decode-jobs-pool.js":7,"fetch-manager.js":10,"image-helper-functions.js":13,"image-params-retriever-proxy.js":17,"worker-proxy-fetch-manager.js":18,"worker-proxy-image-decoder.js":19}],21:[function(require,module,exports){
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
},{"image-decoder-viewer.js":16,"leaflet-frustum-calculator.js":22}],22:[function(require,module,exports){
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
},{"image-helper-functions.js":13}],23:[function(require,module,exports){
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
},{}],24:[function(require,module,exports){
'use strict';

module.exports = GridFetcherBase;

var SimpleFetcherBase = require('simple-fetcher-base.js');
var GridImageBase = require('grid-image-base.js');
var LinkedList = require('linked-list.js');

/* global Promise: false */

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
			isTerminated = true;
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
},{"grid-image-base.js":25,"linked-list.js":14,"simple-fetcher-base.js":27}],25:[function(require,module,exports){
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
	}, DECODE_TASK);
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

},{"grid-level-calculator.js":26}],26:[function(require,module,exports){
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

},{}],27:[function(require,module,exports){
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
},{"simple-movable-fetch.js":15}]},{},[5])(5)
});
//# sourceMappingURL=data:application/json;charset:utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJzcmMvY2VzaXVtLWltYWdlLWRlY29kZXIvY2FudmFzLWltYWdlcnktcHJvdmlkZXIuanMiLCJzcmMvY2VzaXVtLWltYWdlLWRlY29kZXIvY2VzaXVtLWZydXN0dW0tY2FsY3VsYXRvci5qcyIsInNyYy9jZXNpdW0taW1hZ2UtZGVjb2Rlci9jZXNpdW0taW1hZ2UtZGVjb2Rlci1sYXllci1tYW5hZ2VyLmpzIiwic3JjL2Nlc2l1bS1pbWFnZS1kZWNvZGVyL2ltYWdlLWRlY29kZXItaW1hZ2VyeS1wcm92aWRlci5qcyIsInNyYy9pbWFnZS1kZWNvZGVyLWV4cG9ydHMuanMiLCJzcmMvaW1hZ2UtZGVjb2Rlci9pbWFnZS1kZWNvZGVyLWhlbHBlcnMvZGVjb2RlLWpvYi5qcyIsInNyYy9pbWFnZS1kZWNvZGVyL2ltYWdlLWRlY29kZXItaGVscGVycy9kZWNvZGUtam9icy1wb29sLmpzIiwic3JjL2ltYWdlLWRlY29kZXIvaW1hZ2UtZGVjb2Rlci1oZWxwZXJzL2ZldGNoLWNvbnRleHQtYXBpLmpzIiwic3JjL2ltYWdlLWRlY29kZXIvaW1hZ2UtZGVjb2Rlci1oZWxwZXJzL2ZldGNoLWNvbnRleHQuanMiLCJzcmMvaW1hZ2UtZGVjb2Rlci9pbWFnZS1kZWNvZGVyLWhlbHBlcnMvZmV0Y2gtbWFuYWdlci5qcyIsInNyYy9pbWFnZS1kZWNvZGVyL2ltYWdlLWRlY29kZXItaGVscGVycy9mZXRjaGVyLWNsb3Nlci5qcyIsInNyYy9pbWFnZS1kZWNvZGVyL2ltYWdlLWRlY29kZXItaGVscGVycy9mcnVzdHVtLXJlcXVlc3RzLXByaW9yaXRpemVyLmpzIiwic3JjL2ltYWdlLWRlY29kZXIvaW1hZ2UtZGVjb2Rlci1oZWxwZXJzL2ltYWdlLWhlbHBlci1mdW5jdGlvbnMuanMiLCJzcmMvaW1hZ2UtZGVjb2Rlci9pbWFnZS1kZWNvZGVyLWhlbHBlcnMvbGlua2VkLWxpc3QuanMiLCJzcmMvaW1hZ2UtZGVjb2Rlci9pbWFnZS1kZWNvZGVyLWhlbHBlcnMvc2ltcGxlLW1vdmFibGUtZmV0Y2guanMiLCJzcmMvaW1hZ2UtZGVjb2Rlci9pbWFnZS1kZWNvZGVyLXZpZXdlci5qcyIsInNyYy9pbWFnZS1kZWNvZGVyL2ltYWdlLWRlY29kZXItd29ya2Vycy9pbWFnZS1wYXJhbXMtcmV0cmlldmVyLXByb3h5LmpzIiwic3JjL2ltYWdlLWRlY29kZXIvaW1hZ2UtZGVjb2Rlci13b3JrZXJzL3dvcmtlci1wcm94eS1mZXRjaC1tYW5hZ2VyLmpzIiwic3JjL2ltYWdlLWRlY29kZXIvaW1hZ2UtZGVjb2Rlci13b3JrZXJzL3dvcmtlci1wcm94eS1pbWFnZS1kZWNvZGVyLmpzIiwic3JjL2ltYWdlLWRlY29kZXIvaW1hZ2UtZGVjb2Rlci5qcyIsInNyYy9sZWFmbGV0LWltYWdlLWRlY29kZXIvaW1hZ2UtZGVjb2Rlci1yZWdpb24tbGF5ZXIuanMiLCJzcmMvbGVhZmxldC1pbWFnZS1kZWNvZGVyL2xlYWZsZXQtZnJ1c3R1bS1jYWxjdWxhdG9yLmpzIiwic3JjL3NpbXBsZS1mZXRjaGVyL2dyaWQtZGVjb2Rlci13b3JrZXItYmFzZS5qcyIsInNyYy9zaW1wbGUtZmV0Y2hlci9ncmlkLWZldGNoZXItYmFzZS5qcyIsInNyYy9zaW1wbGUtZmV0Y2hlci9ncmlkLWltYWdlLWJhc2UuanMiLCJzcmMvc2ltcGxlLWZldGNoZXIvZ3JpZC1sZXZlbC1jYWxjdWxhdG9yLmpzIiwic3JjL3NpbXBsZS1mZXRjaGVyL3NpbXBsZS1mZXRjaGVyLWJhc2UuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7QUNBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdFVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzFGQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2pKQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMva0JBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2xCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDcEVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3RKQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDNUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN6VUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3RPQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN2Q0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN6S0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDN1JBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDM0ZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDektBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3RuQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDakZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN4REE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3pJQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNsV0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMvS0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNuQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNqREE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNyT0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQy9JQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMzQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBIiwiZmlsZSI6ImdlbmVyYXRlZC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzQ29udGVudCI6WyIoZnVuY3Rpb24gZSh0LG4scil7ZnVuY3Rpb24gcyhvLHUpe2lmKCFuW29dKXtpZighdFtvXSl7dmFyIGE9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtpZighdSYmYSlyZXR1cm4gYShvLCEwKTtpZihpKXJldHVybiBpKG8sITApO3ZhciBmPW5ldyBFcnJvcihcIkNhbm5vdCBmaW5kIG1vZHVsZSAnXCIrbytcIidcIik7dGhyb3cgZi5jb2RlPVwiTU9EVUxFX05PVF9GT1VORFwiLGZ9dmFyIGw9bltvXT17ZXhwb3J0czp7fX07dFtvXVswXS5jYWxsKGwuZXhwb3J0cyxmdW5jdGlvbihlKXt2YXIgbj10W29dWzFdW2VdO3JldHVybiBzKG4/bjplKX0sbCxsLmV4cG9ydHMsZSx0LG4scil9cmV0dXJuIG5bb10uZXhwb3J0c312YXIgaT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2Zvcih2YXIgbz0wO288ci5sZW5ndGg7bysrKXMocltvXSk7cmV0dXJuIHN9KSIsIid1c2Ugc3RyaWN0JztcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gQ2FudmFzSW1hZ2VyeVByb3ZpZGVyO1xyXG5cclxuLyogZ2xvYmFsIENlc2l1bTogZmFsc2UgKi9cclxuLyogZ2xvYmFsIERldmVsb3BlckVycm9yOiBmYWxzZSAqL1xyXG4vKiBnbG9iYWwgQ3JlZGl0OiBmYWxzZSAqL1xyXG5cclxuLyoqXHJcbiAqIFByb3ZpZGVzIGEgU2luZ2xlIENhbnZhcyBpbWFnZXJ5IHRpbGUuICBUaGUgaW1hZ2UgaXMgYXNzdW1lZCB0byB1c2UgYVxyXG4gKiB7QGxpbmsgR2VvZ3JhcGhpY1RpbGluZ1NjaGVtZX0uXHJcbiAqXHJcbiAqIEBhbGlhcyBDYW52YXNJbWFnZXJ5UHJvdmlkZXJcclxuICogQGNvbnN0cnVjdG9yXHJcbiAqXHJcbiAqIEBwYXJhbSB7Y2FudmFzfSBDYW52YXMgZm9yIHRoZSB0aWxlLlxyXG4gKiBAcGFyYW0ge09iamVjdH0gb3B0aW9ucyBPYmplY3Qgd2l0aCB0aGUgZm9sbG93aW5nIHByb3BlcnRpZXM6XHJcbiAqIEBwYXJhbSB7Q3JlZGl0fFN0cmluZ30gW29wdGlvbnMuY3JlZGl0XSBBIGNyZWRpdCBmb3IgdGhlIGRhdGEgc291cmNlLCB3aGljaCBpcyBkaXNwbGF5ZWQgb24gdGhlIGNhbnZhcy5cclxuICpcclxuICogQHNlZSBBcmNHaXNNYXBTZXJ2ZXJJbWFnZXJ5UHJvdmlkZXJcclxuICogQHNlZSBCaW5nTWFwc0ltYWdlcnlQcm92aWRlclxyXG4gKiBAc2VlIEdvb2dsZUVhcnRoSW1hZ2VyeVByb3ZpZGVyXHJcbiAqIEBzZWUgT3BlblN0cmVldE1hcEltYWdlcnlQcm92aWRlclxyXG4gKiBAc2VlIFRpbGVNYXBTZXJ2aWNlSW1hZ2VyeVByb3ZpZGVyXHJcbiAqIEBzZWUgV2ViTWFwU2VydmljZUltYWdlcnlQcm92aWRlclxyXG4gKi9cclxuZnVuY3Rpb24gQ2FudmFzSW1hZ2VyeVByb3ZpZGVyKGNhbnZhcywgb3B0aW9ucykge1xyXG4gICAgaWYgKG9wdGlvbnMgPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIG9wdGlvbnMgPSB7fTtcclxuICAgIH1cclxuXHJcbiAgICAvLz4+aW5jbHVkZVN0YXJ0KCdkZWJ1ZycsIHByYWdtYXMuZGVidWcpO1xyXG4gICAgaWYgKGNhbnZhcyA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgdGhyb3cgbmV3IERldmVsb3BlckVycm9yKCdjYW52YXMgaXMgcmVxdWlyZWQuJyk7XHJcbiAgICB9XHJcbiAgICAvLz4+aW5jbHVkZUVuZCgnZGVidWcnKTtcclxuXHJcbiAgICB0aGlzLl9jYW52YXMgPSBjYW52YXM7XHJcblxyXG4gICAgdGhpcy5fZXJyb3JFdmVudCA9IG5ldyBFdmVudCgnQ2FudmFzSW1hZ2VyeVByb3ZpZGVyU3RhdHVzJyk7XHJcblxyXG4gICAgdGhpcy5fcmVhZHkgPSBmYWxzZTtcclxuXHJcbiAgICB2YXIgY3JlZGl0ID0gb3B0aW9ucy5jcmVkaXQ7XHJcbiAgICBpZiAodHlwZW9mIGNyZWRpdCA9PT0gJ3N0cmluZycpIHtcclxuICAgICAgICBjcmVkaXQgPSBuZXcgQ3JlZGl0KGNyZWRpdCk7XHJcbiAgICB9XHJcbiAgICB0aGlzLl9jcmVkaXQgPSBjcmVkaXQ7XHJcbn1cclxuXHJcbkNhbnZhc0ltYWdlcnlQcm92aWRlci5wcm90b3R5cGUgPSB7XHJcbiAgICAvKipcclxuICAgICAqIEdldHMgdGhlIHdpZHRoIG9mIGVhY2ggdGlsZSwgaW4gcGl4ZWxzLiBUaGlzIGZ1bmN0aW9uIHNob3VsZFxyXG4gICAgICogbm90IGJlIGNhbGxlZCBiZWZvcmUge0BsaW5rIENhbnZhc0ltYWdlcnlQcm92aWRlciNyZWFkeX0gcmV0dXJucyB0cnVlLlxyXG4gICAgICogQG1lbWJlcm9mIENhbnZhc0ltYWdlcnlQcm92aWRlci5wcm90b3R5cGVcclxuICAgICAqIEB0eXBlIHtOdW1iZXJ9XHJcbiAgICAgKiBAcmVhZG9ubHlcclxuICAgICAqL1xyXG4gICAgZ2V0IHRpbGVXaWR0aCgpIHtcclxuICAgICAgICAgICAgLy8+PmluY2x1ZGVTdGFydCgnZGVidWcnLCBwcmFnbWFzLmRlYnVnKTtcclxuICAgICAgICAgICAgaWYgKCF0aGlzLl9yZWFkeSkge1xyXG4gICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBEZXZlbG9wZXJFcnJvcigndGlsZVdpZHRoIG11c3Qgbm90IGJlIGNhbGxlZCBiZWZvcmUgdGhlIGltYWdlcnkgcHJvdmlkZXIgaXMgcmVhZHkuJyk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgLy8+PmluY2x1ZGVFbmQoJ2RlYnVnJyk7XHJcblxyXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5fY2FudmFzLndpZHRoO1xyXG4gICAgfSxcclxuXHJcbiAgICAvKipcclxuICAgICAqIEdldHMgdGhlIGhlaWdodCBvZiBlYWNoIHRpbGUsIGluIHBpeGVscy4gIFRoaXMgZnVuY3Rpb24gc2hvdWxkXHJcbiAgICAgKiBub3QgYmUgY2FsbGVkIGJlZm9yZSB7QGxpbmsgQ2FudmFzSW1hZ2VyeVByb3ZpZGVyI3JlYWR5fSByZXR1cm5zIHRydWUuXHJcbiAgICAgKiBAbWVtYmVyb2YgQ2FudmFzSW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZVxyXG4gICAgICogQHR5cGUge051bWJlcn1cclxuICAgICAqIEByZWFkb25seVxyXG4gICAgICovXHJcbiAgICBnZXQgdGlsZUhlaWdodCgpIHtcclxuICAgICAgICAgICAgLy8+PmluY2x1ZGVTdGFydCgnZGVidWcnLCBwcmFnbWFzLmRlYnVnKTtcclxuICAgICAgICAgICAgaWYgKCF0aGlzLl9yZWFkeSkge1xyXG4gICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBEZXZlbG9wZXJFcnJvcigndGlsZUhlaWdodCBtdXN0IG5vdCBiZSBjYWxsZWQgYmVmb3JlIHRoZSBpbWFnZXJ5IHByb3ZpZGVyIGlzIHJlYWR5LicpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIC8vPj5pbmNsdWRlRW5kKCdkZWJ1ZycpO1xyXG5cclxuICAgICAgICAgICAgcmV0dXJuIHRoaXMuX2NhbnZhcy5oZWlnaHQ7XHJcbiAgICB9LFxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2V0cyB0aGUgbWF4aW11bSBsZXZlbC1vZi1kZXRhaWwgdGhhdCBjYW4gYmUgcmVxdWVzdGVkLiAgVGhpcyBmdW5jdGlvbiBzaG91bGRcclxuICAgICAqIG5vdCBiZSBjYWxsZWQgYmVmb3JlIHtAbGluayBDYW52YXNJbWFnZXJ5UHJvdmlkZXIjcmVhZHl9IHJldHVybnMgdHJ1ZS5cclxuICAgICAqIEBtZW1iZXJvZiBDYW52YXNJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlXHJcbiAgICAgKiBAdHlwZSB7TnVtYmVyfVxyXG4gICAgICogQHJlYWRvbmx5XHJcbiAgICAgKi9cclxuICAgIGdldCBtYXhpbXVtTGV2ZWwoKSB7XHJcbiAgICAgICAgICAgIC8vPj5pbmNsdWRlU3RhcnQoJ2RlYnVnJywgcHJhZ21hcy5kZWJ1Zyk7XHJcbiAgICAgICAgICAgIGlmICghdGhpcy5fcmVhZHkpIHtcclxuICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRGV2ZWxvcGVyRXJyb3IoJ21heGltdW1MZXZlbCBtdXN0IG5vdCBiZSBjYWxsZWQgYmVmb3JlIHRoZSBpbWFnZXJ5IHByb3ZpZGVyIGlzIHJlYWR5LicpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIC8vPj5pbmNsdWRlRW5kKCdkZWJ1ZycpO1xyXG5cclxuICAgICAgICAgICAgcmV0dXJuIDA7XHJcbiAgICB9LFxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2V0cyB0aGUgbWluaW11bSBsZXZlbC1vZi1kZXRhaWwgdGhhdCBjYW4gYmUgcmVxdWVzdGVkLiAgVGhpcyBmdW5jdGlvbiBzaG91bGRcclxuICAgICAqIG5vdCBiZSBjYWxsZWQgYmVmb3JlIHtAbGluayBDYW52YXNJbWFnZXJ5UHJvdmlkZXIjcmVhZHl9IHJldHVybnMgdHJ1ZS5cclxuICAgICAqIEBtZW1iZXJvZiBDYW52YXNJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlXHJcbiAgICAgKiBAdHlwZSB7TnVtYmVyfVxyXG4gICAgICogQHJlYWRvbmx5XHJcbiAgICAgKi9cclxuICAgIGdldCBtaW5pbXVtTGV2ZWwoKSB7XHJcbiAgICAgICAgICAgIC8vPj5pbmNsdWRlU3RhcnQoJ2RlYnVnJywgcHJhZ21hcy5kZWJ1Zyk7XHJcbiAgICAgICAgICAgIGlmICghdGhpcy5fcmVhZHkpIHtcclxuICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRGV2ZWxvcGVyRXJyb3IoJ21pbmltdW1MZXZlbCBtdXN0IG5vdCBiZSBjYWxsZWQgYmVmb3JlIHRoZSBpbWFnZXJ5IHByb3ZpZGVyIGlzIHJlYWR5LicpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIC8vPj5pbmNsdWRlRW5kKCdkZWJ1ZycpO1xyXG5cclxuICAgICAgICAgICAgcmV0dXJuIDA7XHJcbiAgICB9LFxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2V0cyB0aGUgdGlsaW5nIHNjaGVtZSB1c2VkIGJ5IHRoaXMgcHJvdmlkZXIuICBUaGlzIGZ1bmN0aW9uIHNob3VsZFxyXG4gICAgICogbm90IGJlIGNhbGxlZCBiZWZvcmUge0BsaW5rIENhbnZhc0ltYWdlcnlQcm92aWRlciNyZWFkeX0gcmV0dXJucyB0cnVlLlxyXG4gICAgICogQG1lbWJlcm9mIENhbnZhc0ltYWdlcnlQcm92aWRlci5wcm90b3R5cGVcclxuICAgICAqIEB0eXBlIHtUaWxpbmdTY2hlbWV9XHJcbiAgICAgKiBAcmVhZG9ubHlcclxuICAgICAqL1xyXG4gICAgZ2V0IHRpbGluZ1NjaGVtZSgpIHtcclxuICAgICAgICAgICAgLy8+PmluY2x1ZGVTdGFydCgnZGVidWcnLCBwcmFnbWFzLmRlYnVnKTtcclxuICAgICAgICAgICAgaWYgKCF0aGlzLl9yZWFkeSkge1xyXG4gICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBEZXZlbG9wZXJFcnJvcigndGlsaW5nU2NoZW1lIG11c3Qgbm90IGJlIGNhbGxlZCBiZWZvcmUgdGhlIGltYWdlcnkgcHJvdmlkZXIgaXMgcmVhZHkuJyk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgLy8+PmluY2x1ZGVFbmQoJ2RlYnVnJyk7XHJcblxyXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5fdGlsaW5nU2NoZW1lO1xyXG4gICAgfSxcclxuXHJcbiAgICAvKipcclxuICAgICAqIEdldHMgdGhlIHJlY3RhbmdsZSwgaW4gcmFkaWFucywgb2YgdGhlIGltYWdlcnkgcHJvdmlkZWQgYnkgdGhpcyBpbnN0YW5jZS4gIFRoaXMgZnVuY3Rpb24gc2hvdWxkXHJcbiAgICAgKiBub3QgYmUgY2FsbGVkIGJlZm9yZSB7QGxpbmsgQ2FudmFzSW1hZ2VyeVByb3ZpZGVyI3JlYWR5fSByZXR1cm5zIHRydWUuXHJcbiAgICAgKiBAbWVtYmVyb2YgQ2FudmFzSW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZVxyXG4gICAgICogQHR5cGUge1JlY3RhbmdsZX1cclxuICAgICAqIEByZWFkb25seVxyXG4gICAgICovXHJcbiAgICBnZXQgcmVjdGFuZ2xlKCkge1xyXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5fdGlsaW5nU2NoZW1lLnJlY3RhbmdsZTtcclxuICAgIH0sXHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZXRzIHRoZSB0aWxlIGRpc2NhcmQgcG9saWN5LiAgSWYgbm90IHVuZGVmaW5lZCwgdGhlIGRpc2NhcmQgcG9saWN5IGlzIHJlc3BvbnNpYmxlXHJcbiAgICAgKiBmb3IgZmlsdGVyaW5nIG91dCBcIm1pc3NpbmdcIiB0aWxlcyB2aWEgaXRzIHNob3VsZERpc2NhcmRJbWFnZSBmdW5jdGlvbi4gIElmIHRoaXMgZnVuY3Rpb25cclxuICAgICAqIHJldHVybnMgdW5kZWZpbmVkLCBubyB0aWxlcyBhcmUgZmlsdGVyZWQuICBUaGlzIGZ1bmN0aW9uIHNob3VsZFxyXG4gICAgICogbm90IGJlIGNhbGxlZCBiZWZvcmUge0BsaW5rIENhbnZhc0ltYWdlcnlQcm92aWRlciNyZWFkeX0gcmV0dXJucyB0cnVlLlxyXG4gICAgICogQG1lbWJlcm9mIENhbnZhc0ltYWdlcnlQcm92aWRlci5wcm90b3R5cGVcclxuICAgICAqIEB0eXBlIHtUaWxlRGlzY2FyZFBvbGljeX1cclxuICAgICAqIEByZWFkb25seVxyXG4gICAgICovXHJcbiAgICBnZXQgdGlsZURpc2NhcmRQb2xpY3koKSB7XHJcbiAgICAgICAgICAgIC8vPj5pbmNsdWRlU3RhcnQoJ2RlYnVnJywgcHJhZ21hcy5kZWJ1Zyk7XHJcbiAgICAgICAgICAgIGlmICghdGhpcy5fcmVhZHkpIHtcclxuICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRGV2ZWxvcGVyRXJyb3IoJ3RpbGVEaXNjYXJkUG9saWN5IG11c3Qgbm90IGJlIGNhbGxlZCBiZWZvcmUgdGhlIGltYWdlcnkgcHJvdmlkZXIgaXMgcmVhZHkuJyk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgLy8+PmluY2x1ZGVFbmQoJ2RlYnVnJyk7XHJcblxyXG4gICAgICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xyXG4gICAgfSxcclxuXHJcbiAgICAvKipcclxuICAgICAqIEdldHMgYW4gZXZlbnQgdGhhdCBpcyByYWlzZWQgd2hlbiB0aGUgaW1hZ2VyeSBwcm92aWRlciBlbmNvdW50ZXJzIGFuIGFzeW5jaHJvbm91cyBlcnJvci4gIEJ5IHN1YnNjcmliaW5nXHJcbiAgICAgKiB0byB0aGUgZXZlbnQsIHlvdSB3aWxsIGJlIG5vdGlmaWVkIG9mIHRoZSBlcnJvciBhbmQgY2FuIHBvdGVudGlhbGx5IHJlY292ZXIgZnJvbSBpdC4gIEV2ZW50IGxpc3RlbmVyc1xyXG4gICAgICogYXJlIHBhc3NlZCBhbiBpbnN0YW5jZSBvZiB7QGxpbmsgVGlsZVByb3ZpZGVyRXJyb3J9LlxyXG4gICAgICogQG1lbWJlcm9mIENhbnZhc0ltYWdlcnlQcm92aWRlci5wcm90b3R5cGVcclxuICAgICAqIEB0eXBlIHtFdmVudH1cclxuICAgICAqIEByZWFkb25seVxyXG4gICAgICovXHJcbiAgICBnZXQgZXJyb3JFdmVudCgpIHtcclxuICAgICAgICAgICAgcmV0dXJuIHRoaXMuX2Vycm9yRXZlbnQ7XHJcbiAgICB9LFxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2V0cyBhIHZhbHVlIGluZGljYXRpbmcgd2hldGhlciBvciBub3QgdGhlIHByb3ZpZGVyIGlzIHJlYWR5IGZvciB1c2UuXHJcbiAgICAgKiBAbWVtYmVyb2YgQ2FudmFzSW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZVxyXG4gICAgICogQHR5cGUge0Jvb2xlYW59XHJcbiAgICAgKiBAcmVhZG9ubHlcclxuICAgICAqL1xyXG4gICAgZ2V0IHJlYWR5KCkge1xyXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5fcmVhZHk7XHJcbiAgICB9LFxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2V0cyB0aGUgY3JlZGl0IHRvIGRpc3BsYXkgd2hlbiB0aGlzIGltYWdlcnkgcHJvdmlkZXIgaXMgYWN0aXZlLiAgVHlwaWNhbGx5IHRoaXMgaXMgdXNlZCB0byBjcmVkaXRcclxuICAgICAqIHRoZSBzb3VyY2Ugb2YgdGhlIGltYWdlcnkuICBUaGlzIGZ1bmN0aW9uIHNob3VsZCBub3QgYmUgY2FsbGVkIGJlZm9yZSB7QGxpbmsgQ2FudmFzSW1hZ2VyeVByb3ZpZGVyI3JlYWR5fSByZXR1cm5zIHRydWUuXHJcbiAgICAgKiBAbWVtYmVyb2YgQ2FudmFzSW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZVxyXG4gICAgICogQHR5cGUge0NyZWRpdH1cclxuICAgICAqIEByZWFkb25seVxyXG4gICAgICovXHJcbiAgICBnZXQgY3JlZGl0KCkge1xyXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5fY3JlZGl0O1xyXG4gICAgfSxcclxuXHJcbiAgICAvKipcclxuICAgICAqIEdldHMgYSB2YWx1ZSBpbmRpY2F0aW5nIHdoZXRoZXIgb3Igbm90IHRoZSBpbWFnZXMgcHJvdmlkZWQgYnkgdGhpcyBpbWFnZXJ5IHByb3ZpZGVyXHJcbiAgICAgKiBpbmNsdWRlIGFuIGFscGhhIGNoYW5uZWwuICBJZiB0aGlzIHByb3BlcnR5IGlzIGZhbHNlLCBhbiBhbHBoYSBjaGFubmVsLCBpZiBwcmVzZW50LCB3aWxsXHJcbiAgICAgKiBiZSBpZ25vcmVkLiAgSWYgdGhpcyBwcm9wZXJ0eSBpcyB0cnVlLCBhbnkgaW1hZ2VzIHdpdGhvdXQgYW4gYWxwaGEgY2hhbm5lbCB3aWxsIGJlIHRyZWF0ZWRcclxuICAgICAqIGFzIGlmIHRoZWlyIGFscGhhIGlzIDEuMCBldmVyeXdoZXJlLiAgV2hlbiB0aGlzIHByb3BlcnR5IGlzIGZhbHNlLCBtZW1vcnkgdXNhZ2VcclxuICAgICAqIGFuZCB0ZXh0dXJlIHVwbG9hZCB0aW1lIGFyZSByZWR1Y2VkLlxyXG4gICAgICogQG1lbWJlcm9mIENhbnZhc0ltYWdlcnlQcm92aWRlci5wcm90b3R5cGVcclxuICAgICAqIEB0eXBlIHtCb29sZWFufVxyXG4gICAgICogQHJlYWRvbmx5XHJcbiAgICAgKi9cclxuICAgIGdldCBoYXNBbHBoYUNoYW5uZWwoKSB7XHJcbiAgICAgICAgICAgIHJldHVybiB0cnVlO1xyXG4gICAgfVxyXG59O1xyXG5cclxuQ2FudmFzSW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5zZXRSZWN0YW5nbGUgPSBmdW5jdGlvbiBzZXRSZWN0YW5nbGUocmVjdGFuZ2xlKSB7XHJcbiAgICBcclxuICAgIHRoaXMuX3RpbGluZ1NjaGVtZSA9IG5ldyBDZXNpdW0uR2VvZ3JhcGhpY1RpbGluZ1NjaGVtZSh7XHJcbiAgICAgICAgcmVjdGFuZ2xlOiByZWN0YW5nbGUsXHJcbiAgICAgICAgbnVtYmVyT2ZMZXZlbFplcm9UaWxlc1g6IDEsXHJcbiAgICAgICAgbnVtYmVyT2ZMZXZlbFplcm9UaWxlc1k6IDFcclxuICAgIH0pO1xyXG4gICAgXHJcbiAgICBpZiAoIXRoaXMuX3JlYWR5KSB7XHJcbiAgICAgICAgdGhpcy5fcmVhZHkgPSB0cnVlO1xyXG4gICAgICAgIENlc2l1bS5UaWxlUHJvdmlkZXJFcnJvci5oYW5kbGVTdWNjZXNzKHRoaXMuX2Vycm9yRXZlbnQpO1xyXG4gICAgfVxyXG59O1xyXG5cclxuQ2FudmFzSW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5nZXRUaWxlV2lkdGggPSBmdW5jdGlvbiBnZXRUaWxlV2lkdGgoKSB7XHJcbiAgICByZXR1cm4gdGhpcy50aWxlV2lkdGg7XHJcbn07XHJcblxyXG5DYW52YXNJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlLmdldFRpbGVIZWlnaHQgPSBmdW5jdGlvbiBnZXRUaWxlSGVpZ2h0KCkge1xyXG4gICAgcmV0dXJuIHRoaXMudGlsZUhlaWdodDtcclxufTtcclxuXHJcbkNhbnZhc0ltYWdlcnlQcm92aWRlci5wcm90b3R5cGUuZ2V0TWF4aW11bUxldmVsID0gZnVuY3Rpb24gZ2V0TWF4aW11bUxldmVsKCkge1xyXG4gICAgcmV0dXJuIHRoaXMubWF4aW11bUxldmVsO1xyXG59O1xyXG5cclxuQ2FudmFzSW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5nZXRNaW5pbXVtTGV2ZWwgPSBmdW5jdGlvbiBnZXRNaW5pbXVtTGV2ZWwoKSB7XHJcbiAgICByZXR1cm4gdGhpcy5taW5pbXVtTGV2ZWw7XHJcbn07XHJcblxyXG5DYW52YXNJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlLmlzUmVhZHkgPSBmdW5jdGlvbiBpc1JlYWR5KCkge1xyXG4gICAgcmV0dXJuIHRoaXMucmVhZHk7XHJcbn07XHJcblxyXG5DYW52YXNJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlLmdldENyZWRpdCA9IGZ1bmN0aW9uIGdldENyZWRpdCgpIHtcclxuICAgIHJldHVybiB0aGlzLmNyZWRpdDtcclxufTtcclxuXHJcbkNhbnZhc0ltYWdlcnlQcm92aWRlci5wcm90b3R5cGUuZ2V0UmVjdGFuZ2xlID0gZnVuY3Rpb24gZ2V0UmVjdGFuZ2xlKCkge1xyXG4gICAgcmV0dXJuIHRoaXMudGlsaW5nU2NoZW1lLnJlY3RhbmdsZTtcclxufTtcclxuXHJcbkNhbnZhc0ltYWdlcnlQcm92aWRlci5wcm90b3R5cGUuZ2V0VGlsaW5nU2NoZW1lID0gZnVuY3Rpb24gZ2V0VGlsaW5nU2NoZW1lKCkge1xyXG4gICAgcmV0dXJuIHRoaXMudGlsaW5nU2NoZW1lO1xyXG59O1xyXG5cclxuQ2FudmFzSW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5nZXRUaWxlRGlzY2FyZFBvbGljeSA9IGZ1bmN0aW9uIGdldFRpbGVEaXNjYXJkUG9saWN5KCkge1xyXG4gICAgcmV0dXJuIHRoaXMudGlsZURpc2NhcmRQb2xpY3k7XHJcbn07XHJcblxyXG5DYW52YXNJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlLmdldEVycm9yRXZlbnQgPSBmdW5jdGlvbiBnZXRFcnJvckV2ZW50KCkge1xyXG4gICAgcmV0dXJuIHRoaXMuZXJyb3JFdmVudDtcclxufTtcclxuXHJcbkNhbnZhc0ltYWdlcnlQcm92aWRlci5wcm90b3R5cGUuZ2V0SGFzQWxwaGFDaGFubmVsID0gZnVuY3Rpb24gZ2V0SGFzQWxwaGFDaGFubmVsKCkge1xyXG4gICAgcmV0dXJuIHRoaXMuaGFzQWxwaGFDaGFubmVsO1xyXG59O1xyXG5cclxuLyoqXHJcbiAqIEdldHMgdGhlIGNyZWRpdHMgdG8gYmUgZGlzcGxheWVkIHdoZW4gYSBnaXZlbiB0aWxlIGlzIGRpc3BsYXllZC5cclxuICpcclxuICogQHBhcmFtIHtOdW1iZXJ9IHggVGhlIHRpbGUgWCBjb29yZGluYXRlLlxyXG4gKiBAcGFyYW0ge051bWJlcn0geSBUaGUgdGlsZSBZIGNvb3JkaW5hdGUuXHJcbiAqIEBwYXJhbSB7TnVtYmVyfSBsZXZlbCBUaGUgdGlsZSBsZXZlbDtcclxuICogQHJldHVybnMge0NyZWRpdFtdfSBUaGUgY3JlZGl0cyB0byBiZSBkaXNwbGF5ZWQgd2hlbiB0aGUgdGlsZSBpcyBkaXNwbGF5ZWQuXHJcbiAqXHJcbiAqIEBleGNlcHRpb24ge0RldmVsb3BlckVycm9yfSA8Y29kZT5nZXRUaWxlQ3JlZGl0czwvY29kZT4gbXVzdCBub3QgYmUgY2FsbGVkIGJlZm9yZSB0aGUgaW1hZ2VyeSBwcm92aWRlciBpcyByZWFkeS5cclxuICovXHJcbkNhbnZhc0ltYWdlcnlQcm92aWRlci5wcm90b3R5cGUuZ2V0VGlsZUNyZWRpdHMgPSBmdW5jdGlvbih4LCB5LCBsZXZlbCkge1xyXG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcclxufTtcclxuXHJcbi8qKlxyXG4gKiBSZXF1ZXN0cyB0aGUgaW1hZ2UgZm9yIGEgZ2l2ZW4gdGlsZS4gIFRoaXMgZnVuY3Rpb24gc2hvdWxkXHJcbiAqIG5vdCBiZSBjYWxsZWQgYmVmb3JlIHtAbGluayBDYW52YXNJbWFnZXJ5UHJvdmlkZXIjcmVhZHl9IHJldHVybnMgdHJ1ZS5cclxuICpcclxuICogQHBhcmFtIHtOdW1iZXJ9IHggVGhlIHRpbGUgWCBjb29yZGluYXRlLlxyXG4gKiBAcGFyYW0ge051bWJlcn0geSBUaGUgdGlsZSBZIGNvb3JkaW5hdGUuXHJcbiAqIEBwYXJhbSB7TnVtYmVyfSBsZXZlbCBUaGUgdGlsZSBsZXZlbC5cclxuICogQHJldHVybnMge1Byb21pc2V9IEEgcHJvbWlzZSBmb3IgdGhlIGltYWdlIHRoYXQgd2lsbCByZXNvbHZlIHdoZW4gdGhlIGltYWdlIGlzIGF2YWlsYWJsZSwgb3JcclxuICogICAgICAgICAgdW5kZWZpbmVkIGlmIHRoZXJlIGFyZSB0b28gbWFueSBhY3RpdmUgcmVxdWVzdHMgdG8gdGhlIHNlcnZlciwgYW5kIHRoZSByZXF1ZXN0XHJcbiAqICAgICAgICAgIHNob3VsZCBiZSByZXRyaWVkIGxhdGVyLiAgVGhlIHJlc29sdmVkIGltYWdlIG1heSBiZSBlaXRoZXIgYW5cclxuICogICAgICAgICAgSW1hZ2Ugb3IgYSBDYW52YXMgRE9NIG9iamVjdC5cclxuICpcclxuICogQGV4Y2VwdGlvbiB7RGV2ZWxvcGVyRXJyb3J9IDxjb2RlPnJlcXVlc3RJbWFnZTwvY29kZT4gbXVzdCBub3QgYmUgY2FsbGVkIGJlZm9yZSB0aGUgaW1hZ2VyeSBwcm92aWRlciBpcyByZWFkeS5cclxuICovXHJcbkNhbnZhc0ltYWdlcnlQcm92aWRlci5wcm90b3R5cGUucmVxdWVzdEltYWdlID0gZnVuY3Rpb24oeCwgeSwgbGV2ZWwpIHtcclxuICAgIC8vPj5pbmNsdWRlU3RhcnQoJ2RlYnVnJywgcHJhZ21hcy5kZWJ1Zyk7XHJcbiAgICBpZiAoIXRoaXMuX3JlYWR5KSB7XHJcbiAgICAgICAgICAgIHRocm93IG5ldyBEZXZlbG9wZXJFcnJvcigncmVxdWVzdEltYWdlIG11c3Qgbm90IGJlIGNhbGxlZCBiZWZvcmUgdGhlIGltYWdlcnkgcHJvdmlkZXIgaXMgcmVhZHkuJyk7XHJcbiAgICB9XHJcbiAgICAvLz4+aW5jbHVkZUVuZCgnZGVidWcnKTtcclxuXHJcbiAgICByZXR1cm4gdGhpcy5fY2FudmFzO1xyXG59O1xyXG5cclxuLyoqXHJcbiAqIFBpY2tpbmcgZmVhdHVyZXMgaXMgbm90IGN1cnJlbnRseSBzdXBwb3J0ZWQgYnkgdGhpcyBpbWFnZXJ5IHByb3ZpZGVyLCBzbyB0aGlzIGZ1bmN0aW9uIHNpbXBseSByZXR1cm5zXHJcbiAqIHVuZGVmaW5lZC5cclxuICpcclxuICogQHBhcmFtIHtOdW1iZXJ9IHggVGhlIHRpbGUgWCBjb29yZGluYXRlLlxyXG4gKiBAcGFyYW0ge051bWJlcn0geSBUaGUgdGlsZSBZIGNvb3JkaW5hdGUuXHJcbiAqIEBwYXJhbSB7TnVtYmVyfSBsZXZlbCBUaGUgdGlsZSBsZXZlbC5cclxuICogQHBhcmFtIHtOdW1iZXJ9IGxvbmdpdHVkZSBUaGUgbG9uZ2l0dWRlIGF0IHdoaWNoIHRvIHBpY2sgZmVhdHVyZXMuXHJcbiAqIEBwYXJhbSB7TnVtYmVyfSBsYXRpdHVkZSAgVGhlIGxhdGl0dWRlIGF0IHdoaWNoIHRvIHBpY2sgZmVhdHVyZXMuXHJcbiAqIEByZXR1cm4ge1Byb21pc2V9IEEgcHJvbWlzZSBmb3IgdGhlIHBpY2tlZCBmZWF0dXJlcyB0aGF0IHdpbGwgcmVzb2x2ZSB3aGVuIHRoZSBhc3luY2hyb25vdXNcclxuICogICAgICAgICAgICAgICAgICAgcGlja2luZyBjb21wbGV0ZXMuICBUaGUgcmVzb2x2ZWQgdmFsdWUgaXMgYW4gYXJyYXkgb2Yge0BsaW5rIEltYWdlcnlMYXllckZlYXR1cmVJbmZvfVxyXG4gKiAgICAgICAgICAgICAgICAgICBpbnN0YW5jZXMuICBUaGUgYXJyYXkgbWF5IGJlIGVtcHR5IGlmIG5vIGZlYXR1cmVzIGFyZSBmb3VuZCBhdCB0aGUgZ2l2ZW4gbG9jYXRpb24uXHJcbiAqICAgICAgICAgICAgICAgICAgIEl0IG1heSBhbHNvIGJlIHVuZGVmaW5lZCBpZiBwaWNraW5nIGlzIG5vdCBzdXBwb3J0ZWQuXHJcbiAqL1xyXG5DYW52YXNJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlLnBpY2tGZWF0dXJlcyA9IGZ1bmN0aW9uKCkge1xyXG4gICAgICAgIHJldHVybiB1bmRlZmluZWQ7XHJcbn07IiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBjYWxjdWxhdGVGcnVzdHVtO1xyXG5cclxuLyogZ2xvYmFsIENlc2l1bTogZmFsc2UgKi9cclxuXHJcbnZhciBpbWFnZUhlbHBlckZ1bmN0aW9ucyA9IHJlcXVpcmUoJ2ltYWdlLWhlbHBlci1mdW5jdGlvbnMuanMnKTtcclxuXHJcbnZhciBNQVhfUkVDVVJTSVZFX0xFVkVMX09OX0ZBSUxFRF9UUkFOU0ZPUk0gPSA0O1xyXG5cclxuZnVuY3Rpb24gY2FsY3VsYXRlRnJ1c3R1bShjZXNpdW1XaWRnZXQpIHtcclxuICAgIHZhciBzY3JlZW5TaXplID0ge1xyXG4gICAgICAgIHg6IGNlc2l1bVdpZGdldC5zY2VuZS5jYW52YXMud2lkdGgsXHJcbiAgICAgICAgeTogY2VzaXVtV2lkZ2V0LnNjZW5lLmNhbnZhcy5oZWlnaHRcclxuICAgIH07XHJcbiAgICBcclxuICAgIHZhciBwb2ludHMgPSBbXTtcclxuICAgIHNlYXJjaEJvdW5kaW5nUG9pbnRzKFxyXG4gICAgICAgIDAsIDAsIHNjcmVlblNpemUueCwgc2NyZWVuU2l6ZS55LCBwb2ludHMsIGNlc2l1bVdpZGdldCwgLypyZWN1cnNpdmU9Ki8wKTtcclxuXHJcbiAgICB2YXIgZnJ1c3R1bVJlY3RhbmdsZSA9IENlc2l1bS5SZWN0YW5nbGUuZnJvbUNhcnRvZ3JhcGhpY0FycmF5KHBvaW50cyk7XHJcbiAgICBpZiAoZnJ1c3R1bVJlY3RhbmdsZS5lYXN0IDwgZnJ1c3R1bVJlY3RhbmdsZS53ZXN0IHx8IGZydXN0dW1SZWN0YW5nbGUubm9ydGggPCBmcnVzdHVtUmVjdGFuZ2xlLnNvdXRoKSB7XHJcbiAgICAgICAgZnJ1c3R1bVJlY3RhbmdsZSA9IHtcclxuICAgICAgICAgICAgZWFzdDogTWF0aC5tYXgoZnJ1c3R1bVJlY3RhbmdsZS5lYXN0LCBmcnVzdHVtUmVjdGFuZ2xlLndlc3QpLFxyXG4gICAgICAgICAgICB3ZXN0OiBNYXRoLm1pbihmcnVzdHVtUmVjdGFuZ2xlLmVhc3QsIGZydXN0dW1SZWN0YW5nbGUud2VzdCksXHJcbiAgICAgICAgICAgIG5vcnRoOiBNYXRoLm1heChmcnVzdHVtUmVjdGFuZ2xlLm5vcnRoLCBmcnVzdHVtUmVjdGFuZ2xlLnNvdXRoKSxcclxuICAgICAgICAgICAgc291dGg6IE1hdGgubWluKGZydXN0dW1SZWN0YW5nbGUubm9ydGgsIGZydXN0dW1SZWN0YW5nbGUuc291dGgpXHJcbiAgICAgICAgfTtcclxuICAgIH1cclxuXHJcbiAgICB2YXIgZnJ1c3R1bURhdGEgPSBpbWFnZUhlbHBlckZ1bmN0aW9ucy5jYWxjdWxhdGVGcnVzdHVtMkRGcm9tQm91bmRzKFxyXG4gICAgICAgIGZydXN0dW1SZWN0YW5nbGUsIHNjcmVlblNpemUpO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICByZXR1cm4gZnJ1c3R1bURhdGE7XHJcbn1cclxuICAgIFxyXG5mdW5jdGlvbiBzZWFyY2hCb3VuZGluZ1BvaW50cyhcclxuICAgIG1pblgsIG1pblksIG1heFgsIG1heFksIHBvaW50cywgY2VzaXVtV2lkZ2V0LCByZWN1cnNpdmVMZXZlbCkge1xyXG4gICAgXHJcbiAgICB2YXIgdHJhbnNmb3JtZWRQb2ludHMgPSAwO1xyXG4gICAgdHJhbnNmb3JtZWRQb2ludHMgKz0gdHJhbnNmb3JtQW5kQWRkUG9pbnQoXHJcbiAgICAgICAgbWluWCwgbWluWSwgY2VzaXVtV2lkZ2V0LCBwb2ludHMpO1xyXG4gICAgdHJhbnNmb3JtZWRQb2ludHMgKz0gdHJhbnNmb3JtQW5kQWRkUG9pbnQoXHJcbiAgICAgICAgbWF4WCwgbWluWSwgY2VzaXVtV2lkZ2V0LCBwb2ludHMpO1xyXG4gICAgdHJhbnNmb3JtZWRQb2ludHMgKz0gdHJhbnNmb3JtQW5kQWRkUG9pbnQoXHJcbiAgICAgICAgbWluWCwgbWF4WSwgY2VzaXVtV2lkZ2V0LCBwb2ludHMpO1xyXG4gICAgdHJhbnNmb3JtZWRQb2ludHMgKz0gdHJhbnNmb3JtQW5kQWRkUG9pbnQoXHJcbiAgICAgICAgbWF4WCwgbWF4WSwgY2VzaXVtV2lkZ2V0LCBwb2ludHMpO1xyXG5cclxuICAgIHZhciBtYXhMZXZlbCA9IE1BWF9SRUNVUlNJVkVfTEVWRUxfT05fRkFJTEVEX1RSQU5TRk9STTtcclxuICAgIFxyXG4gICAgaWYgKHRyYW5zZm9ybWVkUG9pbnRzID09PSA0IHx8IHJlY3Vyc2l2ZUxldmVsID49IG1heExldmVsKSB7XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICArK3JlY3Vyc2l2ZUxldmVsO1xyXG4gICAgXHJcbiAgICB2YXIgbWlkZGxlWCA9IChtaW5YICsgbWF4WCkgLyAyO1xyXG4gICAgdmFyIG1pZGRsZVkgPSAobWluWSArIG1heFkpIC8gMjtcclxuICAgIFxyXG4gICAgc2VhcmNoQm91bmRpbmdQb2ludHMoXHJcbiAgICAgICAgbWluWCwgbWluWSwgbWlkZGxlWCwgbWlkZGxlWSwgcG9pbnRzLCBjZXNpdW1XaWRnZXQsIHJlY3Vyc2l2ZUxldmVsKTtcclxuXHJcbiAgICBzZWFyY2hCb3VuZGluZ1BvaW50cyhcclxuICAgICAgICBtaW5YLCBtaWRkbGVZLCBtaWRkbGVYLCBtYXhZLCBwb2ludHMsIGNlc2l1bVdpZGdldCwgcmVjdXJzaXZlTGV2ZWwpO1xyXG5cclxuICAgIHNlYXJjaEJvdW5kaW5nUG9pbnRzKFxyXG4gICAgICAgIG1pZGRsZVgsIG1pblksIG1heFgsIG1pZGRsZVksIHBvaW50cywgY2VzaXVtV2lkZ2V0LCByZWN1cnNpdmVMZXZlbCk7XHJcblxyXG4gICAgc2VhcmNoQm91bmRpbmdQb2ludHMoXHJcbiAgICAgICAgbWlkZGxlWCwgbWlkZGxlWSwgbWF4WCwgbWF4WSwgcG9pbnRzLCBjZXNpdW1XaWRnZXQsIHJlY3Vyc2l2ZUxldmVsKTtcclxufVxyXG5cclxuZnVuY3Rpb24gdHJhbnNmb3JtQW5kQWRkUG9pbnQoeCwgeSwgY2VzaXVtV2lkZ2V0LCBwb2ludHMpIHtcclxuICAgIFxyXG4gICAgdmFyIHNjcmVlblBvaW50ID0gbmV3IENlc2l1bS5DYXJ0ZXNpYW4yKHgsIHkpO1xyXG4gICAgdmFyIGVsbGlwc29pZCA9IGNlc2l1bVdpZGdldC5zY2VuZS5tYXBQcm9qZWN0aW9uLmVsbGlwc29pZDtcclxuICAgIHZhciBwb2ludDNEID0gY2VzaXVtV2lkZ2V0LnNjZW5lLmNhbWVyYS5waWNrRWxsaXBzb2lkKHNjcmVlblBvaW50LCBlbGxpcHNvaWQpO1xyXG4gICAgXHJcbiAgICBpZiAocG9pbnQzRCA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgcmV0dXJuIDA7XHJcbiAgICB9XHJcblxyXG4gICAgdmFyIGNhcnRlc2lhbiA9IGVsbGlwc29pZC5jYXJ0ZXNpYW5Ub0NhcnRvZ3JhcGhpYyhwb2ludDNEKTtcclxuICAgIGlmIChjYXJ0ZXNpYW4gPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIHJldHVybiAwO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBwb2ludHMucHVzaChjYXJ0ZXNpYW4pO1xyXG4gICAgcmV0dXJuIDE7XHJcbn0iLCIndXNlIHN0cmljdCc7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IENlc2l1bUltYWdlRGVjb2RlckxheWVyTWFuYWdlcjtcclxuXHJcbnZhciBDYW52YXNJbWFnZXJ5UHJvdmlkZXIgPSByZXF1aXJlKCdjYW52YXMtaW1hZ2VyeS1wcm92aWRlci5qcycpO1xyXG52YXIgSW1hZ2VWaWV3ZXIgPSByZXF1aXJlKCdpbWFnZS1kZWNvZGVyLXZpZXdlci5qcycpO1xyXG52YXIgY2FsY3VsYXRlQ2VzaXVtRnJ1c3R1bSA9IHJlcXVpcmUoJ2Nlc2l1bS1mcnVzdHVtLWNhbGN1bGF0b3IuanMnKTtcclxuXHJcbi8qIGdsb2JhbCBDZXNpdW06IGZhbHNlICovXHJcblxyXG5mdW5jdGlvbiBDZXNpdW1JbWFnZURlY29kZXJMYXllck1hbmFnZXIoaW1hZ2VEZWNvZGVyLCBvcHRpb25zKSB7XHJcbiAgICB0aGlzLl9vcHRpb25zID0gb3B0aW9ucyB8fCB7fTtcclxuICAgIFxyXG4gICAgaWYgKHRoaXMuX29wdGlvbnMucmVjdGFuZ2xlICE9PSB1bmRlZmluZWQpIHtcclxuICAgICAgICB0aGlzLl9vcHRpb25zID0gSlNPTi5wYXJzZShKU09OLnN0cmluZ2lmeShvcHRpb25zKSk7XHJcbiAgICAgICAgdGhpcy5fb3B0aW9ucy5jYXJ0b2dyYXBoaWNCb3VuZHMgPSB7XHJcbiAgICAgICAgICAgIHdlc3Q6IG9wdGlvbnMucmVjdGFuZ2xlLndlc3QsXHJcbiAgICAgICAgICAgIGVhc3Q6IG9wdGlvbnMucmVjdGFuZ2xlLmVhc3QsXHJcbiAgICAgICAgICAgIHNvdXRoOiBvcHRpb25zLnJlY3RhbmdsZS5zb3V0aCxcclxuICAgICAgICAgICAgbm9ydGg6IG9wdGlvbnMucmVjdGFuZ2xlLm5vcnRoXHJcbiAgICAgICAgfTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgdGhpcy5fb3B0aW9ucy5taW5GdW5jdGlvbkNhbGxJbnRlcnZhbE1pbGxpc2Vjb25kcyA9XHJcbiAgICAgICAgb3B0aW9ucy5taW5GdW5jdGlvbkNhbGxJbnRlcnZhbE1pbGxpc2Vjb25kcyB8fCAxMDA7XHJcbiAgICB0aGlzLl91cmwgPSBvcHRpb25zLnVybDtcclxuXHJcbiAgICB0aGlzLl90YXJnZXRDYW52YXMgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdjYW52YXMnKTtcclxuICAgIHRoaXMuX2ltYWdlcnlQcm92aWRlcnMgPSBbXHJcbiAgICAgICAgbmV3IENhbnZhc0ltYWdlcnlQcm92aWRlcih0aGlzLl90YXJnZXRDYW52YXMpLFxyXG4gICAgICAgIG5ldyBDYW52YXNJbWFnZXJ5UHJvdmlkZXIodGhpcy5fdGFyZ2V0Q2FudmFzKVxyXG4gICAgXTtcclxuICAgIHRoaXMuX2ltYWdlcnlMYXllclNob3duID0gbmV3IENlc2l1bS5JbWFnZXJ5TGF5ZXIodGhpcy5faW1hZ2VyeVByb3ZpZGVyc1swXSk7XHJcbiAgICB0aGlzLl9pbWFnZXJ5TGF5ZXJQZW5kaW5nID0gbmV3IENlc2l1bS5JbWFnZXJ5TGF5ZXIodGhpcy5faW1hZ2VyeVByb3ZpZGVyc1sxXSk7XHJcblxyXG4gICAgdGhpcy5fY2FudmFzVXBkYXRlZENhbGxiYWNrQm91bmQgPSB0aGlzLl9jYW52YXNVcGRhdGVkQ2FsbGJhY2suYmluZCh0aGlzKTtcclxuICAgIFxyXG4gICAgdGhpcy5faXNQZW5kaW5nVXBkYXRlQ2FsbGJhY2sgPSBmYWxzZTtcclxuICAgIHRoaXMuX2lzV2hpbGVSZXBsYWNlTGF5ZXJTaG93biA9IGZhbHNlO1xyXG4gICAgdGhpcy5fcGVuZGluZ1Bvc2l0aW9uUmVjdGFuZ2xlID0gbnVsbDtcclxuICAgIFxyXG4gICAgdGhpcy5faW1hZ2VWaWV3ZXIgPSBuZXcgSW1hZ2VWaWV3ZXIoXHJcbiAgICAgICAgaW1hZ2VEZWNvZGVyLFxyXG4gICAgICAgIHRoaXMuX2NhbnZhc1VwZGF0ZWRDYWxsYmFja0JvdW5kLFxyXG4gICAgICAgIHRoaXMuX29wdGlvbnMpO1xyXG4gICAgXHJcbiAgICB0aGlzLl9pbWFnZVZpZXdlci5zZXRUYXJnZXRDYW52YXModGhpcy5fdGFyZ2V0Q2FudmFzKTtcclxuICAgIFxyXG4gICAgdGhpcy5fdXBkYXRlRnJ1c3R1bUJvdW5kID0gdGhpcy5fdXBkYXRlRnJ1c3R1bS5iaW5kKHRoaXMpO1xyXG4gICAgdGhpcy5fcG9zdFJlbmRlckJvdW5kID0gdGhpcy5fcG9zdFJlbmRlci5iaW5kKHRoaXMpO1xyXG59XHJcblxyXG5DZXNpdW1JbWFnZURlY29kZXJMYXllck1hbmFnZXIucHJvdG90eXBlLnNldEV4Y2VwdGlvbkNhbGxiYWNrID0gZnVuY3Rpb24gc2V0RXhjZXB0aW9uQ2FsbGJhY2soZXhjZXB0aW9uQ2FsbGJhY2spIHtcclxuICAgIHRoaXMuX2ltYWdlVmlld2VyLnNldEV4Y2VwdGlvbkNhbGxiYWNrKGV4Y2VwdGlvbkNhbGxiYWNrKTtcclxufTtcclxuXHJcbkNlc2l1bUltYWdlRGVjb2RlckxheWVyTWFuYWdlci5wcm90b3R5cGUub3BlbiA9IGZ1bmN0aW9uIG9wZW4od2lkZ2V0T3JWaWV3ZXIpIHtcclxuICAgIHRoaXMuX3dpZGdldCA9IHdpZGdldE9yVmlld2VyO1xyXG4gICAgdGhpcy5fbGF5ZXJzID0gd2lkZ2V0T3JWaWV3ZXIuc2NlbmUuaW1hZ2VyeUxheWVycztcclxuICAgIHdpZGdldE9yVmlld2VyLnNjZW5lLnBvc3RSZW5kZXIuYWRkRXZlbnRMaXN0ZW5lcih0aGlzLl9wb3N0UmVuZGVyQm91bmQpO1xyXG4gICAgXHJcbiAgICB0aGlzLl9pbWFnZVZpZXdlci5vcGVuKHRoaXMuX3VybCk7XHJcbiAgICB0aGlzLl9sYXllcnMuYWRkKHRoaXMuX2ltYWdlcnlMYXllclNob3duKTtcclxuICAgIFxyXG4gICAgLy8gTk9URTogSXMgdGhlcmUgYW4gZXZlbnQgaGFuZGxlciB0byByZWdpc3RlciBpbnN0ZWFkP1xyXG4gICAgLy8gKENlc2l1bSdzIGV2ZW50IGNvbnRyb2xsZXJzIG9ubHkgZXhwb3NlIGtleWJvYXJkIGFuZCBtb3VzZVxyXG4gICAgLy8gZXZlbnRzLCBidXQgdGhlcmUgaXMgbm8gZXZlbnQgZm9yIGZydXN0dW0gY2hhbmdlZFxyXG4gICAgLy8gcHJvZ3JhbW1hdGljYWxseSkuXHJcbiAgICB0aGlzLl9pbnRlcnZhbEhhbmRsZSA9IHNldEludGVydmFsKFxyXG4gICAgICAgIHRoaXMuX3VwZGF0ZUZydXN0dW1Cb3VuZCxcclxuICAgICAgICA1MDApO1xyXG59O1xyXG5cclxuQ2VzaXVtSW1hZ2VEZWNvZGVyTGF5ZXJNYW5hZ2VyLnByb3RvdHlwZS5jbG9zZSA9IGZ1bmN0aW9uIGNsb3NlKCkge1xyXG4gICAgdGhpcy5faW1hZ2VWaWV3ZXIuY2xvc2UoKTtcclxuICAgIGNsZWFySW50ZXJ2YWwodGhpcy5faW50ZXJ2YWxIYW5kbGUpO1xyXG5cclxuICAgIHRoaXMuX2xheWVycy5yZW1vdmUodGhpcy5faW1hZ2VyeUxheWVyU2hvd24pO1xyXG4gICAgdGhpcy5fd2lkZ2V0LnJlbW92ZUV2ZW50TGlzdGVuZXIodGhpcy5fcG9zdFJlbmRlckJvdW5kKTtcclxuICAgIGlmICh0aGlzLl9pc1doaWxlUmVwbGFjZUxheWVyU2hvd24pIHtcclxuICAgICAgICB0aGlzLl9pc1doaWxlUmVwbGFjZUxheWVyU2hvd24gPSBmYWxzZTtcclxuICAgICAgICB0aGlzLl9pc1BlbmRpbmdVcGRhdGVDYWxsYmFjayA9IGZhbHNlO1xyXG4gICAgICAgIHRoaXMuX2xheWVycy5yZW1vdmUodGhpcy5faW1hZ2VyeUxheWVyUGVuZGluZyk7XHJcbiAgICB9XHJcbn07XHJcblxyXG5DZXNpdW1JbWFnZURlY29kZXJMYXllck1hbmFnZXIucHJvdG90eXBlLmdldEltYWdlcnlMYXllcnMgPSBmdW5jdGlvbiBnZXRJbWFnZXJ5TGF5ZXJzKCkge1xyXG4gICAgcmV0dXJuIFt0aGlzLl9pbWFnZXJ5TGF5ZXJTaG93biwgdGhpcy5faW1hZ2VyeUxheWVyUGVuZGluZ107XHJcbn07XHJcblxyXG5DZXNpdW1JbWFnZURlY29kZXJMYXllck1hbmFnZXIucHJvdG90eXBlLl91cGRhdGVGcnVzdHVtID0gZnVuY3Rpb24gdXBkYXRlRnJ1c3R1bSgpIHtcclxuICAgIHZhciBmcnVzdHVtID0gY2FsY3VsYXRlQ2VzaXVtRnJ1c3R1bSh0aGlzLl93aWRnZXQpO1xyXG4gICAgaWYgKGZydXN0dW0gIT09IG51bGwpIHtcclxuICAgICAgICB0aGlzLl9pbWFnZVZpZXdlci51cGRhdGVWaWV3QXJlYShmcnVzdHVtKTtcclxuICAgIH1cclxufTtcclxuXHJcbkNlc2l1bUltYWdlRGVjb2RlckxheWVyTWFuYWdlci5wcm90b3R5cGUuX2NhbnZhc1VwZGF0ZWRDYWxsYmFjayA9IGZ1bmN0aW9uIGNhbnZhc1VwZGF0ZWRDYWxsYmFjayhuZXdQb3NpdGlvbikge1xyXG4gICAgaWYgKHRoaXMuX2lzV2hpbGVSZXBsYWNlTGF5ZXJTaG93bikge1xyXG4gICAgICAgIHRoaXMuX2lzUGVuZGluZ1VwZGF0ZUNhbGxiYWNrID0gdHJ1ZTtcclxuICAgICAgICB0aGlzLl9wZW5kaW5nUG9zaXRpb25SZWN0YW5nbGUgPSBuZXdQb3NpdGlvbjtcclxuICAgIH1cclxuICAgIFxyXG4gICAgaWYgKG5ld1Bvc2l0aW9uICE9PSBudWxsKSB7XHJcbiAgICAgICAgdmFyIHJlY3RhbmdsZSA9IG5ldyBDZXNpdW0uUmVjdGFuZ2xlKFxyXG4gICAgICAgICAgICBuZXdQb3NpdGlvbi53ZXN0LFxyXG4gICAgICAgICAgICBuZXdQb3NpdGlvbi5zb3V0aCxcclxuICAgICAgICAgICAgbmV3UG9zaXRpb24uZWFzdCxcclxuICAgICAgICAgICAgbmV3UG9zaXRpb24ubm9ydGgpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHRoaXMuX2ltYWdlcnlQcm92aWRlcnNbMF0uc2V0UmVjdGFuZ2xlKHJlY3RhbmdsZSk7XHJcbiAgICAgICAgdGhpcy5faW1hZ2VyeVByb3ZpZGVyc1sxXS5zZXRSZWN0YW5nbGUocmVjdGFuZ2xlKTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgdGhpcy5fcmVtb3ZlQW5kUmVBZGRMYXllcigpO1xyXG59O1xyXG5cclxuQ2VzaXVtSW1hZ2VEZWNvZGVyTGF5ZXJNYW5hZ2VyLnByb3RvdHlwZS5fcmVtb3ZlQW5kUmVBZGRMYXllciA9IGZ1bmN0aW9uIHJlbW92ZUFuZFJlQWRkTGF5ZXIoKSB7XHJcbiAgICB2YXIgaW5kZXggPSB0aGlzLl9sYXllcnMuaW5kZXhPZih0aGlzLl9pbWFnZXJ5TGF5ZXJTaG93bik7XHJcbiAgICBcclxuICAgIGlmIChpbmRleCA8IDApIHtcclxuICAgICAgICB0aHJvdyAnTGF5ZXIgd2FzIHJlbW92ZWQgZnJvbSB2aWV3ZXJcXCdzIGxheWVycyAgd2l0aG91dCAnICtcclxuICAgICAgICAgICAgJ2Nsb3NpbmcgbGF5ZXIgbWFuYWdlci4gVXNlIENlc2l1bUltYWdlRGVjb2RlckxheWVyTWFuYWdlci4nICtcclxuICAgICAgICAgICAgJ2Nsb3NlKCkgaW5zdGVhZCc7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHRoaXMuX2lzV2hpbGVSZXBsYWNlTGF5ZXJTaG93biA9IHRydWU7XHJcbiAgICB0aGlzLl9sYXllcnMuYWRkKHRoaXMuX2ltYWdlcnlMYXllclBlbmRpbmcsIGluZGV4KTtcclxufTtcclxuXHJcbkNlc2l1bUltYWdlRGVjb2RlckxheWVyTWFuYWdlci5wcm90b3R5cGUuX3Bvc3RSZW5kZXIgPSBmdW5jdGlvbiBwb3N0UmVuZGVyKCkge1xyXG4gICAgaWYgKCF0aGlzLl9pc1doaWxlUmVwbGFjZUxheWVyU2hvd24pXHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgXHJcbiAgICB0aGlzLl9pc1doaWxlUmVwbGFjZUxheWVyU2hvd24gPSBmYWxzZTtcclxuICAgIHRoaXMuX2xheWVycy5yZW1vdmUodGhpcy5faW1hZ2VyeUxheWVyU2hvd24sIC8qZGVzdHJveT0qL2ZhbHNlKTtcclxuICAgIFxyXG4gICAgdmFyIHN3YXAgPSB0aGlzLl9pbWFnZXJ5TGF5ZXJTaG93bjtcclxuICAgIHRoaXMuX2ltYWdlcnlMYXllclNob3duID0gdGhpcy5faW1hZ2VyeUxheWVyUGVuZGluZztcclxuICAgIHRoaXMuX2ltYWdlcnlMYXllclBlbmRpbmcgPSBzd2FwO1xyXG4gICAgXHJcbiAgICBpZiAodGhpcy5faXNQZW5kaW5nVXBkYXRlQ2FsbGJhY2spIHtcclxuICAgICAgICB0aGlzLl9pc1BlbmRpbmdVcGRhdGVDYWxsYmFjayA9IGZhbHNlO1xyXG4gICAgICAgIHRoaXMuX2NhbnZhc1VwZGF0ZWRDYWxsYmFjayh0aGlzLl9wZW5kaW5nUG9zaXRpb25SZWN0YW5nbGUpO1xyXG4gICAgfVxyXG59OyIsIid1c2Ugc3RyaWN0JztcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyO1xyXG5cclxudmFyIGNhbGN1bGF0ZUNlc2l1bUZydXN0dW0gPSByZXF1aXJlKCdjZXNpdW0tZnJ1c3R1bS1jYWxjdWxhdG9yLmpzJyk7XHJcbnZhciBpbWFnZUhlbHBlckZ1bmN0aW9ucyA9IHJlcXVpcmUoJ2ltYWdlLWhlbHBlci1mdW5jdGlvbnMuanMnKTtcclxuXHJcbi8qIGdsb2JhbCBDZXNpdW06IGZhbHNlICovXHJcbi8qIGdsb2JhbCBEZXZlbG9wZXJFcnJvcjogZmFsc2UgKi9cclxuLyogZ2xvYmFsIENyZWRpdDogZmFsc2UgKi9cclxuLyogZ2xvYmFsIFByb21pc2U6IGZhbHNlICovXHJcblxyXG4vKipcclxuICogUHJvdmlkZXMgYSBJbWFnZURlY29kZXIgY2xpZW50IGltYWdlcnkgdGlsZS4gIFRoZSBpbWFnZSBpcyBhc3N1bWVkIHRvIHVzZSBhXHJcbiAqIHtAbGluayBHZW9ncmFwaGljVGlsaW5nU2NoZW1lfS5cclxuICpcclxuICogQGFsaWFzIEltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlclxyXG4gKiBAY29uc3RydWN0b3JcclxuICpcclxuICogQHBhcmFtIHtPYmplY3R9IG9wdGlvbnMgT2JqZWN0IHdpdGggdGhlIGZvbGxvd2luZyBwcm9wZXJ0aWVzOlxyXG4gKiBAcGFyYW0ge1N0cmluZ30gb3B0aW9ucy51cmwgVGhlIHVybCBmb3IgdGhlIHRpbGUuXHJcbiAqIEBwYXJhbSB7UmVjdGFuZ2xlfSBbb3B0aW9ucy5yZWN0YW5nbGU9UmVjdGFuZ2xlLk1BWF9WQUxVRV0gVGhlIHJlY3RhbmdsZSwgaW4gcmFkaWFucywgY292ZXJlZCBieSB0aGUgaW1hZ2UuXHJcbiAqIEBwYXJhbSB7Q3JlZGl0fFN0cmluZ30gW29wdGlvbnMuY3JlZGl0XSBBIGNyZWRpdCBmb3IgdGhlIGRhdGEgc291cmNlLCB3aGljaCBpcyBkaXNwbGF5ZWQgb24gdGhlIGNhbnZhcy5cclxuICogQHBhcmFtIHtPYmplY3R9IFtvcHRpb25zLnByb3h5XSBBIHByb3h5IHRvIHVzZSBmb3IgcmVxdWVzdHMuIFRoaXMgb2JqZWN0IGlzIGV4cGVjdGVkIHRvIGhhdmUgYSBnZXRVUkwgZnVuY3Rpb24gd2hpY2ggcmV0dXJucyB0aGUgcHJveGllZCBVUkwsIGlmIG5lZWRlZC5cclxuICogQHBhcmFtIHtib29sZWFufSBbb3B0aW9ucy5hZGFwdFByb3BvcnRpb25zXSBkZXRlcm1pbmVzIGlmIHRvIGFkYXB0IHRoZSBwcm9wb3J0aW9ucyBvZiB0aGUgcmVjdGFuZ2xlIHByb3ZpZGVkIHRvIHRoZSBpbWFnZSBwaXhlbHMgcHJvcG9ydGlvbnMuXHJcbiAqXHJcbiAqIEBzZWUgQXJjR2lzTWFwU2VydmVySW1hZ2VyeVByb3ZpZGVyXHJcbiAqIEBzZWUgQmluZ01hcHNJbWFnZXJ5UHJvdmlkZXJcclxuICogQHNlZSBHb29nbGVFYXJ0aEltYWdlcnlQcm92aWRlclxyXG4gKiBAc2VlIE9wZW5TdHJlZXRNYXBJbWFnZXJ5UHJvdmlkZXJcclxuICogQHNlZSBUaWxlTWFwU2VydmljZUltYWdlcnlQcm92aWRlclxyXG4gKiBAc2VlIFdlYk1hcFNlcnZpY2VJbWFnZXJ5UHJvdmlkZXJcclxuICovXHJcbmZ1bmN0aW9uIEltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlcihpbWFnZURlY29kZXIsIG9wdGlvbnMpIHtcclxuICAgIHZhciB1cmwgPSBvcHRpb25zLnVybDtcclxuICAgIHRoaXMuX2FkYXB0UHJvcG9ydGlvbnMgPSBvcHRpb25zLmFkYXB0UHJvcG9ydGlvbnM7XHJcbiAgICB0aGlzLl9yZWN0YW5nbGUgPSBvcHRpb25zLnJlY3RhbmdsZTtcclxuICAgIHRoaXMuX3Byb3h5ID0gb3B0aW9ucy5wcm94eTtcclxuICAgIHRoaXMuX3VwZGF0ZUZydXN0dW1JbnRlcnZhbCA9IDEwMDAgfHwgb3B0aW9ucy51cGRhdGVGcnVzdHVtSW50ZXJ2YWw7XHJcbiAgICB0aGlzLl9jcmVkaXQgPSBvcHRpb25zLmNyZWRpdDtcclxuICAgIFxyXG4gICAgaWYgKHR5cGVvZiB0aGlzLl9jcmVkaXQgPT09ICdzdHJpbmcnKSB7XHJcbiAgICAgICAgdGhpcy5fY3JlZGl0ID0gbmV3IENyZWRpdCh0aGlzLl9jcmVkaXQpO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBpZiAodGhpcy5fcmVjdGFuZ2xlID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICB0aGlzLl9yZWN0YW5nbGUgPSBDZXNpdW0uUmVjdGFuZ2xlLmZyb21EZWdyZWVzKC0xODAsIC05MCwgMTgwLCA5MCk7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGlmICh0aGlzLl9hZGFwdFByb3BvcnRpb25zID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICB0aGlzLl9hZGFwdFByb3BvcnRpb25zID0gdHJ1ZTtcclxuICAgIH1cclxuXHJcbiAgICBvcHRpb25zID0gSlNPTi5wYXJzZShKU09OLnN0cmluZ2lmeShvcHRpb25zIHx8IHt9KSk7XHJcbiAgICBvcHRpb25zLmNhcnRvZ3JhcGhpY0JvdW5kcyA9IHtcclxuICAgICAgICB3ZXN0OiB0aGlzLl9yZWN0YW5nbGUud2VzdCxcclxuICAgICAgICBlYXN0OiB0aGlzLl9yZWN0YW5nbGUuZWFzdCxcclxuICAgICAgICBzb3V0aDogdGhpcy5fcmVjdGFuZ2xlLnNvdXRoLFxyXG4gICAgICAgIG5vcnRoOiB0aGlzLl9yZWN0YW5nbGUubm9ydGhcclxuICAgIH07XHJcbiAgICBcclxuICAgIC8vPj5pbmNsdWRlU3RhcnQoJ2RlYnVnJywgcHJhZ21hcy5kZWJ1Zyk7XHJcbiAgICBpZiAodXJsID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICAgICAgdGhyb3cgbmV3IERldmVsb3BlckVycm9yKCd1cmwgaXMgcmVxdWlyZWQuJyk7XHJcbiAgICB9XHJcbiAgICAvLz4+aW5jbHVkZUVuZCgnZGVidWcnKTtcclxuXHJcbiAgICB0aGlzLl91cmwgPSB1cmw7XHJcblxyXG4gICAgdGhpcy5fdGlsaW5nU2NoZW1lID0gdW5kZWZpbmVkO1xyXG5cclxuICAgIHRoaXMuX3RpbGVXaWR0aCA9IDA7XHJcbiAgICB0aGlzLl90aWxlSGVpZ2h0ID0gMDtcclxuXHJcbiAgICB0aGlzLl9lcnJvckV2ZW50ID0gbmV3IEV2ZW50KCdJbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXJTdGF0dXMnKTtcclxuXHJcbiAgICB0aGlzLl9yZWFkeSA9IGZhbHNlO1xyXG4gICAgdGhpcy5fZXhjZXB0aW9uQ2FsbGJhY2sgPSBudWxsO1xyXG4gICAgdGhpcy5fY2VzaXVtV2lkZ2V0ID0gbnVsbDtcclxuICAgIHRoaXMuX3VwZGF0ZUZydXN0dW1JbnRlcnZhbEhhbmRsZSA9IG51bGw7XHJcbiAgICBcclxuXHJcbiAgICB2YXIgaW1hZ2VVcmwgPSB1cmw7XHJcbiAgICBpZiAodGhpcy5fcHJveHkgIT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIC8vIE5PVEU6IElzIHRoYXQgdGhlIGNvcnJlY3QgbG9naWM/XHJcbiAgICAgICAgaW1hZ2VVcmwgPSB0aGlzLl9wcm94eS5nZXRVUkwoaW1hZ2VVcmwpO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICB0aGlzLl9pbWFnZURlY29kZXIgPSBpbWFnZURlY29kZXI7XHJcbiAgICB0aGlzLl91cmwgPSBpbWFnZVVybDtcclxufVxyXG5cclxuSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZSA9IHtcclxuICAgIC8qKlxyXG4gICAgICogR2V0cyB0aGUgVVJMIG9mIHRoZSBJbWFnZURlY29kZXIgc2VydmVyIChpbmNsdWRpbmcgdGFyZ2V0KS5cclxuICAgICAqIEBtZW1iZXJvZiBJbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlXHJcbiAgICAgKiBAdHlwZSB7U3RyaW5nfVxyXG4gICAgICogQHJlYWRvbmx5XHJcbiAgICAgKi9cclxuICAgIGdldCB1cmwoKSB7XHJcbiAgICAgICAgcmV0dXJuIHRoaXMuX3VybDtcclxuICAgIH0sXHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZXRzIHRoZSBwcm94eSB1c2VkIGJ5IHRoaXMgcHJvdmlkZXIuXHJcbiAgICAgKiBAbWVtYmVyb2YgSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZVxyXG4gICAgICogQHR5cGUge1Byb3h5fVxyXG4gICAgICogQHJlYWRvbmx5XHJcbiAgICAgKi9cclxuICAgIGdldCBwcm94eSgpIHtcclxuICAgICAgICByZXR1cm4gdGhpcy5fcHJveHk7XHJcbiAgICB9LFxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2V0cyB0aGUgd2lkdGggb2YgZWFjaCB0aWxlLCBpbiBwaXhlbHMuIFRoaXMgZnVuY3Rpb24gc2hvdWxkXHJcbiAgICAgKiBub3QgYmUgY2FsbGVkIGJlZm9yZSB7QGxpbmsgSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyI3JlYWR5fSByZXR1cm5zIHRydWUuXHJcbiAgICAgKiBAbWVtYmVyb2YgSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZVxyXG4gICAgICogQHR5cGUge051bWJlcn1cclxuICAgICAqIEByZWFkb25seVxyXG4gICAgICovXHJcbiAgICBnZXQgdGlsZVdpZHRoKCkge1xyXG4gICAgICAgIC8vPj5pbmNsdWRlU3RhcnQoJ2RlYnVnJywgcHJhZ21hcy5kZWJ1Zyk7XHJcbiAgICAgICAgaWYgKCF0aGlzLl9yZWFkeSkge1xyXG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IERldmVsb3BlckVycm9yKCd0aWxlV2lkdGggbXVzdCBub3QgYmUgY2FsbGVkIGJlZm9yZSB0aGUgaW1hZ2VyeSBwcm92aWRlciBpcyByZWFkeS4nKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgLy8+PmluY2x1ZGVFbmQoJ2RlYnVnJyk7XHJcblxyXG4gICAgICAgIHJldHVybiB0aGlzLl90aWxlV2lkdGg7XHJcbiAgICB9LFxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2V0cyB0aGUgaGVpZ2h0IG9mIGVhY2ggdGlsZSwgaW4gcGl4ZWxzLiAgVGhpcyBmdW5jdGlvbiBzaG91bGRcclxuICAgICAqIG5vdCBiZSBjYWxsZWQgYmVmb3JlIHtAbGluayBJbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIjcmVhZHl9IHJldHVybnMgdHJ1ZS5cclxuICAgICAqIEBtZW1iZXJvZiBJbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlXHJcbiAgICAgKiBAdHlwZSB7TnVtYmVyfVxyXG4gICAgICogQHJlYWRvbmx5XHJcbiAgICAgKi9cclxuICAgIGdldCB0aWxlSGVpZ2h0KCkge1xyXG4gICAgICAgIC8vPj5pbmNsdWRlU3RhcnQoJ2RlYnVnJywgcHJhZ21hcy5kZWJ1Zyk7XHJcbiAgICAgICAgaWYgKCF0aGlzLl9yZWFkeSkge1xyXG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IERldmVsb3BlckVycm9yKCd0aWxlSGVpZ2h0IG11c3Qgbm90IGJlIGNhbGxlZCBiZWZvcmUgdGhlIGltYWdlcnkgcHJvdmlkZXIgaXMgcmVhZHkuJyk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIC8vPj5pbmNsdWRlRW5kKCdkZWJ1ZycpO1xyXG5cclxuICAgICAgICByZXR1cm4gdGhpcy5fdGlsZUhlaWdodDtcclxuICAgIH0sXHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZXRzIHRoZSBtYXhpbXVtIGxldmVsLW9mLWRldGFpbCB0aGF0IGNhbiBiZSByZXF1ZXN0ZWQuICBUaGlzIGZ1bmN0aW9uIHNob3VsZFxyXG4gICAgICogbm90IGJlIGNhbGxlZCBiZWZvcmUge0BsaW5rIEltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlciNyZWFkeX0gcmV0dXJucyB0cnVlLlxyXG4gICAgICogQG1lbWJlcm9mIEltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlci5wcm90b3R5cGVcclxuICAgICAqIEB0eXBlIHtOdW1iZXJ9XHJcbiAgICAgKiBAcmVhZG9ubHlcclxuICAgICAqL1xyXG4gICAgZ2V0IG1heGltdW1MZXZlbCgpIHtcclxuICAgICAgICAvLz4+aW5jbHVkZVN0YXJ0KCdkZWJ1ZycsIHByYWdtYXMuZGVidWcpO1xyXG4gICAgICAgIGlmICghdGhpcy5fcmVhZHkpIHtcclxuICAgICAgICAgICAgICAgIHRocm93IG5ldyBEZXZlbG9wZXJFcnJvcignbWF4aW11bUxldmVsIG11c3Qgbm90IGJlIGNhbGxlZCBiZWZvcmUgdGhlIGltYWdlcnkgcHJvdmlkZXIgaXMgcmVhZHkuJyk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIC8vPj5pbmNsdWRlRW5kKCdkZWJ1ZycpO1xyXG5cclxuICAgICAgICByZXR1cm4gdGhpcy5fbnVtUmVzb2x1dGlvbkxldmVscyAtIDE7XHJcbiAgICB9LFxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2V0cyB0aGUgbWluaW11bSBsZXZlbC1vZi1kZXRhaWwgdGhhdCBjYW4gYmUgcmVxdWVzdGVkLiAgVGhpcyBmdW5jdGlvbiBzaG91bGRcclxuICAgICAqIG5vdCBiZSBjYWxsZWQgYmVmb3JlIHtAbGluayBJbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIjcmVhZHl9IHJldHVybnMgdHJ1ZS5cclxuICAgICAqIEBtZW1iZXJvZiBJbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlXHJcbiAgICAgKiBAdHlwZSB7TnVtYmVyfVxyXG4gICAgICogQHJlYWRvbmx5XHJcbiAgICAgKi9cclxuICAgIGdldCBtaW5pbXVtTGV2ZWwoKSB7XHJcbiAgICAgICAgLy8+PmluY2x1ZGVTdGFydCgnZGVidWcnLCBwcmFnbWFzLmRlYnVnKTtcclxuICAgICAgICBpZiAoIXRoaXMuX3JlYWR5KSB7XHJcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRGV2ZWxvcGVyRXJyb3IoJ21pbmltdW1MZXZlbCBtdXN0IG5vdCBiZSBjYWxsZWQgYmVmb3JlIHRoZSBpbWFnZXJ5IHByb3ZpZGVyIGlzIHJlYWR5LicpO1xyXG4gICAgICAgIH1cclxuICAgICAgICAvLz4+aW5jbHVkZUVuZCgnZGVidWcnKTtcclxuXHJcbiAgICAgICAgcmV0dXJuIDA7XHJcbiAgICB9LFxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2V0cyB0aGUgdGlsaW5nIHNjaGVtZSB1c2VkIGJ5IHRoaXMgcHJvdmlkZXIuICBUaGlzIGZ1bmN0aW9uIHNob3VsZFxyXG4gICAgICogbm90IGJlIGNhbGxlZCBiZWZvcmUge0BsaW5rIEltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlciNyZWFkeX0gcmV0dXJucyB0cnVlLlxyXG4gICAgICogQG1lbWJlcm9mIEltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlci5wcm90b3R5cGVcclxuICAgICAqIEB0eXBlIHtUaWxpbmdTY2hlbWV9XHJcbiAgICAgKiBAcmVhZG9ubHlcclxuICAgICAqL1xyXG4gICAgZ2V0IHRpbGluZ1NjaGVtZSgpIHtcclxuICAgICAgICAvLz4+aW5jbHVkZVN0YXJ0KCdkZWJ1ZycsIHByYWdtYXMuZGVidWcpO1xyXG4gICAgICAgIGlmICghdGhpcy5fcmVhZHkpIHtcclxuICAgICAgICAgICAgdGhyb3cgbmV3IERldmVsb3BlckVycm9yKCd0aWxpbmdTY2hlbWUgbXVzdCBub3QgYmUgY2FsbGVkIGJlZm9yZSB0aGUgaW1hZ2VyeSBwcm92aWRlciBpcyByZWFkeS4nKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgLy8+PmluY2x1ZGVFbmQoJ2RlYnVnJyk7XHJcblxyXG4gICAgICAgIHJldHVybiB0aGlzLl90aWxpbmdTY2hlbWU7XHJcbiAgICB9LFxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2V0cyB0aGUgcmVjdGFuZ2xlLCBpbiByYWRpYW5zLCBvZiB0aGUgaW1hZ2VyeSBwcm92aWRlZCBieSB0aGlzIGluc3RhbmNlLiAgVGhpcyBmdW5jdGlvbiBzaG91bGRcclxuICAgICAqIG5vdCBiZSBjYWxsZWQgYmVmb3JlIHtAbGluayBJbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIjcmVhZHl9IHJldHVybnMgdHJ1ZS5cclxuICAgICAqIEBtZW1iZXJvZiBJbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlXHJcbiAgICAgKiBAdHlwZSB7UmVjdGFuZ2xlfVxyXG4gICAgICogQHJlYWRvbmx5XHJcbiAgICAgKi9cclxuICAgIGdldCByZWN0YW5nbGUoKSB7XHJcbiAgICAgICAgcmV0dXJuIHRoaXMuX3RpbGluZ1NjaGVtZS5yZWN0YW5nbGU7XHJcbiAgICB9LFxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2V0cyB0aGUgdGlsZSBkaXNjYXJkIHBvbGljeS4gIElmIG5vdCB1bmRlZmluZWQsIHRoZSBkaXNjYXJkIHBvbGljeSBpcyByZXNwb25zaWJsZVxyXG4gICAgICogZm9yIGZpbHRlcmluZyBvdXQgXCJtaXNzaW5nXCIgdGlsZXMgdmlhIGl0cyBzaG91bGREaXNjYXJkSW1hZ2UgZnVuY3Rpb24uICBJZiB0aGlzIGZ1bmN0aW9uXHJcbiAgICAgKiByZXR1cm5zIHVuZGVmaW5lZCwgbm8gdGlsZXMgYXJlIGZpbHRlcmVkLiAgVGhpcyBmdW5jdGlvbiBzaG91bGRcclxuICAgICAqIG5vdCBiZSBjYWxsZWQgYmVmb3JlIHtAbGluayBJbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIjcmVhZHl9IHJldHVybnMgdHJ1ZS5cclxuICAgICAqIEBtZW1iZXJvZiBJbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlXHJcbiAgICAgKiBAdHlwZSB7VGlsZURpc2NhcmRQb2xpY3l9XHJcbiAgICAgKiBAcmVhZG9ubHlcclxuICAgICAqL1xyXG4gICAgZ2V0IHRpbGVEaXNjYXJkUG9saWN5KCkge1xyXG4gICAgICAgIC8vPj5pbmNsdWRlU3RhcnQoJ2RlYnVnJywgcHJhZ21hcy5kZWJ1Zyk7XHJcbiAgICAgICAgaWYgKCF0aGlzLl9yZWFkeSkge1xyXG4gICAgICAgICAgICB0aHJvdyBuZXcgRGV2ZWxvcGVyRXJyb3IoJ3RpbGVEaXNjYXJkUG9saWN5IG11c3Qgbm90IGJlIGNhbGxlZCBiZWZvcmUgdGhlIGltYWdlcnkgcHJvdmlkZXIgaXMgcmVhZHkuJyk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIC8vPj5pbmNsdWRlRW5kKCdkZWJ1ZycpO1xyXG5cclxuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xyXG4gICAgfSxcclxuXHJcbiAgICAvKipcclxuICAgICAqIEdldHMgYW4gZXZlbnQgdGhhdCBpcyByYWlzZWQgd2hlbiB0aGUgaW1hZ2VyeSBwcm92aWRlciBlbmNvdW50ZXJzIGFuIGFzeW5jaHJvbm91cyBlcnJvci4gIEJ5IHN1YnNjcmliaW5nXHJcbiAgICAgKiB0byB0aGUgZXZlbnQsIHlvdSB3aWxsIGJlIG5vdGlmaWVkIG9mIHRoZSBlcnJvciBhbmQgY2FuIHBvdGVudGlhbGx5IHJlY292ZXIgZnJvbSBpdC4gIEV2ZW50IGxpc3RlbmVyc1xyXG4gICAgICogYXJlIHBhc3NlZCBhbiBpbnN0YW5jZSBvZiB7QGxpbmsgVGlsZVByb3ZpZGVyRXJyb3J9LlxyXG4gICAgICogQG1lbWJlcm9mIEltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlci5wcm90b3R5cGVcclxuICAgICAqIEB0eXBlIHtFdmVudH1cclxuICAgICAqIEByZWFkb25seVxyXG4gICAgICovXHJcbiAgICBnZXQgZXJyb3JFdmVudCgpIHtcclxuICAgICAgICByZXR1cm4gdGhpcy5fZXJyb3JFdmVudDtcclxuICAgIH0sXHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZXRzIGEgdmFsdWUgaW5kaWNhdGluZyB3aGV0aGVyIG9yIG5vdCB0aGUgcHJvdmlkZXIgaXMgcmVhZHkgZm9yIHVzZS5cclxuICAgICAqIEBtZW1iZXJvZiBJbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlXHJcbiAgICAgKiBAdHlwZSB7Qm9vbGVhbn1cclxuICAgICAqIEByZWFkb25seVxyXG4gICAgICovXHJcbiAgICBnZXQgcmVhZHkoKSB7XHJcbiAgICAgICAgcmV0dXJuIHRoaXMuX3JlYWR5O1xyXG4gICAgfSxcclxuXHJcbiAgICAvKipcclxuICAgICAqIEdldHMgdGhlIGNyZWRpdCB0byBkaXNwbGF5IHdoZW4gdGhpcyBpbWFnZXJ5IHByb3ZpZGVyIGlzIGFjdGl2ZS4gIFR5cGljYWxseSB0aGlzIGlzIHVzZWQgdG8gY3JlZGl0XHJcbiAgICAgKiB0aGUgc291cmNlIG9mIHRoZSBpbWFnZXJ5LiAgVGhpcyBmdW5jdGlvbiBzaG91bGQgbm90IGJlIGNhbGxlZCBiZWZvcmUge0BsaW5rIEltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlciNyZWFkeX0gcmV0dXJucyB0cnVlLlxyXG4gICAgICogQG1lbWJlcm9mIEltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlci5wcm90b3R5cGVcclxuICAgICAqIEB0eXBlIHtDcmVkaXR9XHJcbiAgICAgKiBAcmVhZG9ubHlcclxuICAgICAqL1xyXG4gICAgZ2V0IGNyZWRpdCgpIHtcclxuICAgICAgICByZXR1cm4gdGhpcy5fY3JlZGl0O1xyXG4gICAgfSxcclxuXHJcbiAgICAvKipcclxuICAgICAqIEdldHMgYSB2YWx1ZSBpbmRpY2F0aW5nIHdoZXRoZXIgb3Igbm90IHRoZSBpbWFnZXMgcHJvdmlkZWQgYnkgdGhpcyBpbWFnZXJ5IHByb3ZpZGVyXHJcbiAgICAgKiBpbmNsdWRlIGFuIGFscGhhIGNoYW5uZWwuICBJZiB0aGlzIHByb3BlcnR5IGlzIGZhbHNlLCBhbiBhbHBoYSBjaGFubmVsLCBpZiBwcmVzZW50LCB3aWxsXHJcbiAgICAgKiBiZSBpZ25vcmVkLiAgSWYgdGhpcyBwcm9wZXJ0eSBpcyB0cnVlLCBhbnkgaW1hZ2VzIHdpdGhvdXQgYW4gYWxwaGEgY2hhbm5lbCB3aWxsIGJlIHRyZWF0ZWRcclxuICAgICAqIGFzIGlmIHRoZWlyIGFscGhhIGlzIDEuMCBldmVyeXdoZXJlLiAgV2hlbiB0aGlzIHByb3BlcnR5IGlzIGZhbHNlLCBtZW1vcnkgdXNhZ2VcclxuICAgICAqIGFuZCB0ZXh0dXJlIHVwbG9hZCB0aW1lIGFyZSByZWR1Y2VkLlxyXG4gICAgICogQG1lbWJlcm9mIEltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlci5wcm90b3R5cGVcclxuICAgICAqIEB0eXBlIHtCb29sZWFufVxyXG4gICAgICogQHJlYWRvbmx5XHJcbiAgICAgKi9cclxuICAgIGdldCBoYXNBbHBoYUNoYW5uZWwoKSB7XHJcbiAgICAgICAgcmV0dXJuIHRydWU7XHJcbiAgICB9XHJcbn07XHJcblxyXG5JbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlLnNldEV4Y2VwdGlvbkNhbGxiYWNrID1cclxuICAgIGZ1bmN0aW9uIHNldEV4Y2VwdGlvbkNhbGxiYWNrKGV4Y2VwdGlvbkNhbGxiYWNrKSB7XHJcbiAgICBcclxuICAgIHRoaXMuX2V4Y2VwdGlvbkNhbGxiYWNrID0gZXhjZXB0aW9uQ2FsbGJhY2s7XHJcbn07XHJcblxyXG5JbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlLm9wZW4gPSBmdW5jdGlvbiBvcGVuKHdpZGdldE9yVmlld2VyKSB7XHJcbiAgICBpZiAodGhpcy5fdXBkYXRlRnJ1c3R1bUludGVydmFsSGFuZGxlICE9PSBudWxsKSB7XHJcbiAgICAgICAgdGhyb3cgbmV3IERldmVsb3BlckVycm9yKCdDYW5ub3Qgc2V0IHR3byBwYXJlbnQgdmlld2Vycy4nKTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgaWYgKHdpZGdldE9yVmlld2VyID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICB0aHJvdyBuZXcgRGV2ZWxvcGVyRXJyb3IoJ3dpZGdldE9yVmlld2VyIHNob3VsZCBiZSBnaXZlbi4gSXQgaXMgJyArXHJcbiAgICAgICAgICAgICduZWVkZWQgZm9yIGZydXN0dW0gY2FsY3VsYXRpb24gZm9yIHRoZSBwcmlvcml0eSBtZWNoYW5pc20nKTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgdGhpcy5faW1hZ2VEZWNvZGVyLm9wZW4odGhpcy5fdXJsKVxyXG5cdFx0LnRoZW4odGhpcy5fb3BlbmVkLmJpbmQodGhpcykpXHJcblx0XHQuY2F0Y2godGhpcy5fb25FeGNlcHRpb24uYmluZCh0aGlzKSk7XHJcbiAgICBcclxuICAgIHRoaXMuX2Nlc2l1bVdpZGdldCA9IHdpZGdldE9yVmlld2VyO1xyXG4gICAgXHJcbiAgICB0aGlzLl91cGRhdGVGcnVzdHVtSW50ZXJ2YWxIYW5kbGUgPSBzZXRJbnRlcnZhbChcclxuICAgICAgICB0aGlzLl9zZXRQcmlvcml0eUJ5RnJ1c3R1bS5iaW5kKHRoaXMpLFxyXG4gICAgICAgIHRoaXMuX3VwZGF0ZUZydXN0dW1JbnRlcnZhbCk7XHJcbn07XHJcblxyXG5JbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlLmNsb3NlID0gZnVuY3Rpb24gY2xvc2UoKSB7XHJcbiAgICBjbGVhckludGVydmFsKHRoaXMuX3VwZGF0ZUZydXN0dW1JbnRlcnZhbEhhbmRsZSk7XHJcbiAgICB0aGlzLl9pbWFnZURlY29kZXIuY2xvc2UoKTtcclxufTtcclxuXHJcbkltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlci5wcm90b3R5cGUuZ2V0VGlsZVdpZHRoID0gZnVuY3Rpb24gZ2V0VGlsZVdpZHRoKCkge1xyXG4gICAgcmV0dXJuIHRoaXMudGlsZVdpZHRoO1xyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5nZXRUaWxlSGVpZ2h0ID0gZnVuY3Rpb24gZ2V0VGlsZUhlaWdodCgpIHtcclxuICAgIHJldHVybiB0aGlzLnRpbGVIZWlnaHQ7XHJcbn07XHJcblxyXG5JbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlLmdldE1heGltdW1MZXZlbCA9IGZ1bmN0aW9uIGdldE1heGltdW1MZXZlbCgpIHtcclxuICAgIHJldHVybiB0aGlzLm1heGltdW1MZXZlbDtcclxufTtcclxuXHJcbkltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlci5wcm90b3R5cGUuZ2V0TWluaW11bUxldmVsID0gZnVuY3Rpb24gZ2V0TWluaW11bUxldmVsKCkge1xyXG4gICAgcmV0dXJuIHRoaXMubWluaW11bUxldmVsO1xyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5nZXRVcmwgPSBmdW5jdGlvbiBnZXRVcmwoKSB7XHJcbiAgICByZXR1cm4gdGhpcy51cmw7XHJcbn07XHJcblxyXG5JbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlLmdldFByb3h5ID0gZnVuY3Rpb24gZ2V0UHJveHkoKSB7XHJcbiAgICByZXR1cm4gdGhpcy5wcm94eTtcclxufTtcclxuXHJcbkltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlci5wcm90b3R5cGUuaXNSZWFkeSA9IGZ1bmN0aW9uIGlzUmVhZHkoKSB7XHJcbiAgICByZXR1cm4gdGhpcy5yZWFkeTtcclxufTtcclxuXHJcbkltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlci5wcm90b3R5cGUuZ2V0Q3JlZGl0ID0gZnVuY3Rpb24gZ2V0Q3JlZGl0KCkge1xyXG4gICAgcmV0dXJuIHRoaXMuY3JlZGl0O1xyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5nZXRSZWN0YW5nbGUgPSBmdW5jdGlvbiBnZXRSZWN0YW5nbGUoKSB7XHJcbiAgICByZXR1cm4gdGhpcy50aWxpbmdTY2hlbWUucmVjdGFuZ2xlO1xyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5nZXRUaWxpbmdTY2hlbWUgPSBmdW5jdGlvbiBnZXRUaWxpbmdTY2hlbWUoKSB7XHJcbiAgICByZXR1cm4gdGhpcy50aWxpbmdTY2hlbWU7XHJcbn07XHJcblxyXG5JbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlLmdldFRpbGVEaXNjYXJkUG9saWN5ID0gZnVuY3Rpb24gZ2V0VGlsZURpc2NhcmRQb2xpY3koKSB7XHJcbiAgICByZXR1cm4gdGhpcy50aWxlRGlzY2FyZFBvbGljeTtcclxufTtcclxuXHJcbkltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlci5wcm90b3R5cGUuZ2V0RXJyb3JFdmVudCA9IGZ1bmN0aW9uIGdldEVycm9yRXZlbnQoKSB7XHJcbiAgICByZXR1cm4gdGhpcy5lcnJvckV2ZW50O1xyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5nZXRIYXNBbHBoYUNoYW5uZWwgPSBmdW5jdGlvbiBnZXRIYXNBbHBoYUNoYW5uZWwoKSB7XHJcbiAgICByZXR1cm4gdGhpcy5oYXNBbHBoYUNoYW5uZWw7XHJcbn07XHJcblxyXG4vKipcclxuICogR2V0cyB0aGUgY3JlZGl0cyB0byBiZSBkaXNwbGF5ZWQgd2hlbiBhIGdpdmVuIHRpbGUgaXMgZGlzcGxheWVkLlxyXG4gKlxyXG4gKiBAcGFyYW0ge051bWJlcn0geCBUaGUgdGlsZSBYIGNvb3JkaW5hdGUuXHJcbiAqIEBwYXJhbSB7TnVtYmVyfSB5IFRoZSB0aWxlIFkgY29vcmRpbmF0ZS5cclxuICogQHBhcmFtIHtOdW1iZXJ9IGxldmVsIFRoZSB0aWxlIGxldmVsO1xyXG4gKiBAcmV0dXJucyB7Q3JlZGl0W119IFRoZSBjcmVkaXRzIHRvIGJlIGRpc3BsYXllZCB3aGVuIHRoZSB0aWxlIGlzIGRpc3BsYXllZC5cclxuICpcclxuICogQGV4Y2VwdGlvbiB7RGV2ZWxvcGVyRXJyb3J9IDxjb2RlPmdldFRpbGVDcmVkaXRzPC9jb2RlPiBtdXN0IG5vdCBiZSBjYWxsZWQgYmVmb3JlIHRoZSBpbWFnZXJ5IHByb3ZpZGVyIGlzIHJlYWR5LlxyXG4gKi9cclxuSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5nZXRUaWxlQ3JlZGl0cyA9IGZ1bmN0aW9uKHgsIHksIGxldmVsKSB7XHJcbiAgICByZXR1cm4gdW5kZWZpbmVkO1xyXG59O1xyXG5cclxuLyoqXHJcbiAqIFJlcXVlc3RzIHRoZSBpbWFnZSBmb3IgYSBnaXZlbiB0aWxlLiAgVGhpcyBmdW5jdGlvbiBzaG91bGRcclxuICogbm90IGJlIGNhbGxlZCBiZWZvcmUge0BsaW5rIEltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlciNyZWFkeX0gcmV0dXJucyB0cnVlLlxyXG4gKlxyXG4gKiBAcGFyYW0ge051bWJlcn0geCBUaGUgdGlsZSBYIGNvb3JkaW5hdGUuXHJcbiAqIEBwYXJhbSB7TnVtYmVyfSB5IFRoZSB0aWxlIFkgY29vcmRpbmF0ZS5cclxuICogQHBhcmFtIHtOdW1iZXJ9IGxldmVsIFRoZSB0aWxlIGxldmVsLlxyXG4gKiBAcmV0dXJucyB7UHJvbWlzZX0gQSBwcm9taXNlIGZvciB0aGUgaW1hZ2UgdGhhdCB3aWxsIHJlc29sdmUgd2hlbiB0aGUgaW1hZ2UgaXMgYXZhaWxhYmxlLCBvclxyXG4gKiAgICAgICAgICB1bmRlZmluZWQgaWYgdGhlcmUgYXJlIHRvbyBtYW55IGFjdGl2ZSByZXF1ZXN0cyB0byB0aGUgc2VydmVyLCBhbmQgdGhlIHJlcXVlc3RcclxuICogICAgICAgICAgc2hvdWxkIGJlIHJldHJpZWQgbGF0ZXIuICBUaGUgcmVzb2x2ZWQgaW1hZ2UgbWF5IGJlIGVpdGhlciBhblxyXG4gKiAgICAgICAgICBJbWFnZSBvciBhIENhbnZhcyBET00gb2JqZWN0LlxyXG4gKlxyXG4gKiBAZXhjZXB0aW9uIHtEZXZlbG9wZXJFcnJvcn0gPGNvZGU+cmVxdWVzdEltYWdlPC9jb2RlPiBtdXN0IG5vdCBiZSBjYWxsZWQgYmVmb3JlIHRoZSBpbWFnZXJ5IHByb3ZpZGVyIGlzIHJlYWR5LlxyXG4gKi9cclxuSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5yZXF1ZXN0SW1hZ2UgPSBmdW5jdGlvbih4LCB5LCBjZXNpdW1MZXZlbCkge1xyXG4gICAgLy8+PmluY2x1ZGVTdGFydCgnZGVidWcnLCBwcmFnbWFzLmRlYnVnKTtcclxuICAgIGlmICghdGhpcy5fcmVhZHkpIHtcclxuICAgICAgICB0aHJvdyBuZXcgRGV2ZWxvcGVyRXJyb3IoJ3JlcXVlc3RJbWFnZSBtdXN0IG5vdCBiZSBjYWxsZWQgYmVmb3JlIHRoZSBpbWFnZXJ5IHByb3ZpZGVyIGlzIHJlYWR5LicpO1xyXG4gICAgfVxyXG4gICAgLy8+PmluY2x1ZGVFbmQoJ2RlYnVnJyk7XHJcbiAgICBcclxuICAgIHZhciBzZWxmID0gdGhpcztcclxuICAgIFxyXG4gICAgdmFyIGxldmVsRmFjdG9yID0gTWF0aC5wb3coMiwgdGhpcy5fbnVtUmVzb2x1dGlvbkxldmVscyAtIGNlc2l1bUxldmVsIC0gMSk7XHJcbiAgICB2YXIgbWluWCA9IHggKiB0aGlzLl90aWxlV2lkdGggICogbGV2ZWxGYWN0b3I7XHJcbiAgICB2YXIgbWluWSA9IHkgKiB0aGlzLl90aWxlSGVpZ2h0ICogbGV2ZWxGYWN0b3I7XHJcbiAgICB2YXIgbWF4WEV4Y2x1c2l2ZSA9ICh4ICsgMSkgKiB0aGlzLl90aWxlV2lkdGggICogbGV2ZWxGYWN0b3I7XHJcbiAgICB2YXIgbWF4WUV4Y2x1c2l2ZSA9ICh5ICsgMSkgKiB0aGlzLl90aWxlSGVpZ2h0ICogbGV2ZWxGYWN0b3I7XHJcbiAgICBcclxuICAgIHZhciBhbGlnbmVkUGFyYW1zID0gaW1hZ2VIZWxwZXJGdW5jdGlvbnMuYWxpZ25QYXJhbXNUb1RpbGVzQW5kTGV2ZWwoe1xyXG4gICAgICAgIG1pblg6IG1pblgsXHJcbiAgICAgICAgbWluWTogbWluWSxcclxuICAgICAgICBtYXhYRXhjbHVzaXZlOiBtYXhYRXhjbHVzaXZlLFxyXG4gICAgICAgIG1heFlFeGNsdXNpdmU6IG1heFlFeGNsdXNpdmUsXHJcbiAgICAgICAgc2NyZWVuV2lkdGg6IHRoaXMuX3RpbGVXaWR0aCxcclxuICAgICAgICBzY3JlZW5IZWlnaHQ6IHRoaXMuX3RpbGVIZWlnaHRcclxuICAgIH0sIHRoaXMuX2ltYWdlRGVjb2Rlcik7XHJcbiAgICBcclxuICAgIHZhciBzY2FsZWRDYW52YXMgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdjYW52YXMnKTtcclxuICAgIHNjYWxlZENhbnZhcy53aWR0aCA9IHRoaXMuX3RpbGVXaWR0aDtcclxuICAgIHNjYWxlZENhbnZhcy5oZWlnaHQgPSB0aGlzLl90aWxlSGVpZ2h0O1xyXG4gICAgXHJcbiAgICB2YXIgc2NhbGVkQ29udGV4dCA9IHNjYWxlZENhbnZhcy5nZXRDb250ZXh0KCcyZCcpO1xyXG4gICAgc2NhbGVkQ29udGV4dC5jbGVhclJlY3QoMCwgMCwgdGhpcy5fdGlsZVdpZHRoLCB0aGlzLl90aWxlSGVpZ2h0KTtcclxuICAgIFxyXG4gICAgdmFyIHRlbXBQaXhlbFdpZHRoICA9IGFsaWduZWRQYXJhbXMuaW1hZ2VQYXJ0UGFyYW1zLm1heFhFeGNsdXNpdmUgLSBhbGlnbmVkUGFyYW1zLmltYWdlUGFydFBhcmFtcy5taW5YO1xyXG4gICAgdmFyIHRlbXBQaXhlbEhlaWdodCA9IGFsaWduZWRQYXJhbXMuaW1hZ2VQYXJ0UGFyYW1zLm1heFlFeGNsdXNpdmUgLSBhbGlnbmVkUGFyYW1zLmltYWdlUGFydFBhcmFtcy5taW5ZO1xyXG4gICAgaWYgKHRlbXBQaXhlbFdpZHRoIDw9IDAgfHwgdGVtcFBpeGVsSGVpZ2h0IDw9IDApIHtcclxuICAgICAgICByZXR1cm4gc2NhbGVkQ2FudmFzO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICB2YXIgdGVtcENhbnZhcyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2NhbnZhcycpO1xyXG4gICAgdGVtcENhbnZhcy53aWR0aCA9IHRlbXBQaXhlbFdpZHRoO1xyXG4gICAgdGVtcENhbnZhcy5oZWlnaHQgPSB0ZW1wUGl4ZWxIZWlnaHQ7XHJcbiAgICB2YXIgdGVtcENvbnRleHQgPSB0ZW1wQ2FudmFzLmdldENvbnRleHQoJzJkJyk7XHJcbiAgICB0ZW1wQ29udGV4dC5jbGVhclJlY3QoMCwgMCwgdGVtcFBpeGVsV2lkdGgsIHRlbXBQaXhlbEhlaWdodCk7XHJcbiAgICBcclxuICAgIGFsaWduZWRQYXJhbXMuaW1hZ2VQYXJ0UGFyYW1zLnF1YWxpdHkgPSB0aGlzLl9xdWFsaXR5O1xyXG4gICAgYWxpZ25lZFBhcmFtcy5pbWFnZVBhcnRQYXJhbXMucmVxdWVzdFByaW9yaXR5RGF0YSA9IHtcclxuICAgICAgICBpbWFnZVJlY3RhbmdsZTogdGhpcy5fcmVjdGFuZ2xlXHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICB2YXIgcmVzb2x2ZSwgcmVqZWN0O1xyXG4gICAgdmFyIHJlcXVlc3RQaXhlbHNQcm9taXNlID0gbmV3IFByb21pc2UoZnVuY3Rpb24ocmVzb2x2ZV8sIHJlamVjdF8pIHtcclxuICAgICAgICByZXNvbHZlID0gcmVzb2x2ZV87XHJcbiAgICAgICAgcmVqZWN0ID0gcmVqZWN0XztcclxuICAgICAgICBcclxuICAgICAgICBzZWxmLl9pbWFnZURlY29kZXIucmVxdWVzdFBpeGVsc1Byb2dyZXNzaXZlKFxyXG4gICAgICAgICAgICBhbGlnbmVkUGFyYW1zLmltYWdlUGFydFBhcmFtcyxcclxuICAgICAgICAgICAgcGl4ZWxzRGVjb2RlZENhbGxiYWNrLFxyXG4gICAgICAgICAgICB0ZXJtaW5hdGVkQ2FsbGJhY2spO1xyXG4gICAgfSk7XHJcbiAgICBcclxuICAgIGZ1bmN0aW9uIHBpeGVsc0RlY29kZWRDYWxsYmFjayhkZWNvZGVkKSB7XHJcbiAgICAgICAgdmFyIHBhcnRpYWxUaWxlV2lkdGggPSBkZWNvZGVkLmltYWdlRGF0YS53aWR0aDtcclxuICAgICAgICB2YXIgcGFydGlhbFRpbGVIZWlnaHQgPSBkZWNvZGVkLmltYWdlRGF0YS5oZWlnaHQ7XHJcblxyXG4gICAgICAgIGlmIChwYXJ0aWFsVGlsZVdpZHRoID4gMCAmJiBwYXJ0aWFsVGlsZUhlaWdodCA+IDApIHtcclxuICAgICAgICAgICAgdGVtcENvbnRleHQucHV0SW1hZ2VEYXRhKFxyXG4gICAgICAgICAgICAgICAgZGVjb2RlZC5pbWFnZURhdGEsXHJcbiAgICAgICAgICAgICAgICBkZWNvZGVkLnhJbk9yaWdpbmFsUmVxdWVzdCxcclxuICAgICAgICAgICAgICAgIGRlY29kZWQueUluT3JpZ2luYWxSZXF1ZXN0KTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgZnVuY3Rpb24gdGVybWluYXRlZENhbGxiYWNrKGlzQWJvcnRlZCkge1xyXG4gICAgICAgIGlmIChpc0Fib3J0ZWQpIHtcclxuICAgICAgICAgICAgcmVqZWN0KCdGZXRjaCByZXF1ZXN0IG9yIGRlY29kZSBhYm9ydGVkJyk7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgc2NhbGVkQ29udGV4dC5kcmF3SW1hZ2UoXHJcbiAgICAgICAgICAgICAgICB0ZW1wQ2FudmFzLFxyXG4gICAgICAgICAgICAgICAgMCwgMCwgdGVtcFBpeGVsV2lkdGgsIHRlbXBQaXhlbEhlaWdodCxcclxuICAgICAgICAgICAgICAgIGFsaWduZWRQYXJhbXMuY3JvcHBlZFNjcmVlbi5taW5YLCBhbGlnbmVkUGFyYW1zLmNyb3BwZWRTY3JlZW4ubWluWSxcclxuICAgICAgICAgICAgICAgIGFsaWduZWRQYXJhbXMuY3JvcHBlZFNjcmVlbi5tYXhYRXhjbHVzaXZlLCBhbGlnbmVkUGFyYW1zLmNyb3BwZWRTY3JlZW4ubWF4WUV4Y2x1c2l2ZSk7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgcmVzb2x2ZShzY2FsZWRDYW52YXMpO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4gcmVxdWVzdFBpeGVsc1Byb21pc2U7XHJcbn07XHJcblxyXG5JbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlLl9zZXRQcmlvcml0eUJ5RnJ1c3R1bSA9XHJcbiAgICBmdW5jdGlvbiBzZXRQcmlvcml0eUJ5RnJ1c3R1bSgpIHtcclxuICAgIFxyXG4gICAgaWYgKCF0aGlzLl9yZWFkeSkge1xyXG4gICAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIFxyXG4gICAgdmFyIGZydXN0dW1EYXRhID0gY2FsY3VsYXRlQ2VzaXVtRnJ1c3R1bShcclxuICAgICAgICB0aGlzLl9jZXNpdW1XaWRnZXQsIHRoaXMpO1xyXG4gICAgXHJcbiAgICBpZiAoZnJ1c3R1bURhdGEgPT09IG51bGwpIHtcclxuICAgICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGZydXN0dW1EYXRhLmltYWdlUmVjdGFuZ2xlID0gdGhpcy5nZXRSZWN0YW5nbGUoKTtcclxuICAgIGZydXN0dW1EYXRhLmV4YWN0bGV2ZWwgPSBudWxsO1xyXG5cclxuICAgIHRoaXMuX2ltYWdlRGVjb2Rlci5zZXRGZXRjaFByaW9yaXRpemVyRGF0YShmcnVzdHVtRGF0YSk7XHJcbiAgICB0aGlzLl9pbWFnZURlY29kZXIuc2V0RGVjb2RlUHJpb3JpdGl6ZXJEYXRhKGZydXN0dW1EYXRhKTtcclxufTtcclxuXHJcbi8qKlxyXG4gKiBQaWNraW5nIGZlYXR1cmVzIGlzIG5vdCBjdXJyZW50bHkgc3VwcG9ydGVkIGJ5IHRoaXMgaW1hZ2VyeSBwcm92aWRlciwgc28gdGhpcyBmdW5jdGlvbiBzaW1wbHkgcmV0dXJuc1xyXG4gKiB1bmRlZmluZWQuXHJcbiAqXHJcbiAqIEBwYXJhbSB7TnVtYmVyfSB4IFRoZSB0aWxlIFggY29vcmRpbmF0ZS5cclxuICogQHBhcmFtIHtOdW1iZXJ9IHkgVGhlIHRpbGUgWSBjb29yZGluYXRlLlxyXG4gKiBAcGFyYW0ge051bWJlcn0gbGV2ZWwgVGhlIHRpbGUgbGV2ZWwuXHJcbiAqIEBwYXJhbSB7TnVtYmVyfSBsb25naXR1ZGUgVGhlIGxvbmdpdHVkZSBhdCB3aGljaCB0byBwaWNrIGZlYXR1cmVzLlxyXG4gKiBAcGFyYW0ge051bWJlcn0gbGF0aXR1ZGUgIFRoZSBsYXRpdHVkZSBhdCB3aGljaCB0byBwaWNrIGZlYXR1cmVzLlxyXG4gKiBAcmV0dXJuIHtQcm9taXNlfSBBIHByb21pc2UgZm9yIHRoZSBwaWNrZWQgZmVhdHVyZXMgdGhhdCB3aWxsIHJlc29sdmUgd2hlbiB0aGUgYXN5bmNocm9ub3VzXHJcbiAqICAgICAgICAgICAgICAgICAgIHBpY2tpbmcgY29tcGxldGVzLiAgVGhlIHJlc29sdmVkIHZhbHVlIGlzIGFuIGFycmF5IG9mIHtAbGluayBJbWFnZXJ5TGF5ZXJGZWF0dXJlSW5mb31cclxuICogICAgICAgICAgICAgICAgICAgaW5zdGFuY2VzLiAgVGhlIGFycmF5IG1heSBiZSBlbXB0eSBpZiBubyBmZWF0dXJlcyBhcmUgZm91bmQgYXQgdGhlIGdpdmVuIGxvY2F0aW9uLlxyXG4gKiAgICAgICAgICAgICAgICAgICBJdCBtYXkgYWxzbyBiZSB1bmRlZmluZWQgaWYgcGlja2luZyBpcyBub3Qgc3VwcG9ydGVkLlxyXG4gKi9cclxuSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5waWNrRmVhdHVyZXMgPSBmdW5jdGlvbigpIHtcclxuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5fb25FeGNlcHRpb24gPSBmdW5jdGlvbiBvbkV4Y2VwdGlvbihyZWFzb24pIHtcclxuICAgIGlmICh0aGlzLl9leGNlcHRpb25DYWxsYmFjayAhPT0gbnVsbCkge1xyXG5cdFx0dGhpcy5fZXhjZXB0aW9uQ2FsbGJhY2socmVhc29uKTtcclxuICAgIH1cclxufTtcclxuXHJcbkltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlci5wcm90b3R5cGUuX29wZW5lZCA9IGZ1bmN0aW9uIG9wZW5lZCgpIHtcclxuICAgIGlmICh0aGlzLl9yZWFkeSkge1xyXG4gICAgICAgIHRocm93ICdpbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIgZXJyb3I6IG9wZW5lZCgpIHdhcyBjYWxsZWQgbW9yZSB0aGFuIG9uY2UhJztcclxuICAgIH1cclxuICAgIFxyXG4gICAgdGhpcy5fcmVhZHkgPSB0cnVlO1xyXG5cclxuICAgIC8vIFRoaXMgaXMgd3JvbmcgaWYgQ09EIG9yIENPQyBleGlzdHMgYmVzaWRlcyBtYWluIGhlYWRlciBDT0RcclxuICAgIHRoaXMuX251bVJlc29sdXRpb25MZXZlbHMgPSB0aGlzLl9pbWFnZURlY29kZXIuZ2V0TnVtUmVzb2x1dGlvbkxldmVsc0ZvckxpbWl0dGVkVmlld2VyKCk7XHJcbiAgICB0aGlzLl9xdWFsaXR5ID0gdGhpcy5faW1hZ2VEZWNvZGVyLmdldEhpZ2hlc3RRdWFsaXR5KCk7XHJcbiAgICB2YXIgbWF4aW11bUNlc2l1bUxldmVsID0gdGhpcy5fbnVtUmVzb2x1dGlvbkxldmVscyAtIDE7XHJcbiAgICAgICAgXHJcbiAgICB0aGlzLl90aWxlV2lkdGggPSB0aGlzLl9pbWFnZURlY29kZXIuZ2V0VGlsZVdpZHRoKCk7XHJcbiAgICB0aGlzLl90aWxlSGVpZ2h0ID0gdGhpcy5faW1hZ2VEZWNvZGVyLmdldFRpbGVIZWlnaHQoKTtcclxuICAgICAgICBcclxuICAgIHZhciBiZXN0TGV2ZWwgPSB0aGlzLl9pbWFnZURlY29kZXIuZ2V0SW1hZ2VMZXZlbCgpO1xyXG4gICAgdmFyIGJlc3RMZXZlbFdpZHRoICA9IHRoaXMuX2ltYWdlRGVjb2Rlci5nZXRJbWFnZVdpZHRoICgpO1xyXG4gICAgdmFyIGJlc3RMZXZlbEhlaWdodCA9IHRoaXMuX2ltYWdlRGVjb2Rlci5nZXRJbWFnZUhlaWdodCgpO1xyXG4gICAgXHJcbiAgICB2YXIgbG93ZXN0TGV2ZWxUaWxlc1ggPSBNYXRoLmNlaWwoYmVzdExldmVsV2lkdGggIC8gdGhpcy5fdGlsZVdpZHRoICkgPj4gbWF4aW11bUNlc2l1bUxldmVsO1xyXG4gICAgdmFyIGxvd2VzdExldmVsVGlsZXNZID0gTWF0aC5jZWlsKGJlc3RMZXZlbEhlaWdodCAvIHRoaXMuX3RpbGVIZWlnaHQpID4+IG1heGltdW1DZXNpdW1MZXZlbDtcclxuXHJcbiAgICBpbWFnZUhlbHBlckZ1bmN0aW9ucy5maXhCb3VuZHMoXHJcbiAgICAgICAgdGhpcy5fcmVjdGFuZ2xlLFxyXG4gICAgICAgIHRoaXMuX2ltYWdlRGVjb2RlcixcclxuICAgICAgICB0aGlzLl9hZGFwdFByb3BvcnRpb25zKTtcclxuICAgIHZhciByZWN0YW5nbGVXaWR0aCAgPSB0aGlzLl9yZWN0YW5nbGUuZWFzdCAgLSB0aGlzLl9yZWN0YW5nbGUud2VzdDtcclxuICAgIHZhciByZWN0YW5nbGVIZWlnaHQgPSB0aGlzLl9yZWN0YW5nbGUubm9ydGggLSB0aGlzLl9yZWN0YW5nbGUuc291dGg7XHJcbiAgICBcclxuICAgIHZhciBiZXN0TGV2ZWxTY2FsZSA9IDEgPDwgbWF4aW11bUNlc2l1bUxldmVsO1xyXG4gICAgdmFyIHBpeGVsc1dpZHRoRm9yQ2VzaXVtICA9IHRoaXMuX3RpbGVXaWR0aCAgKiBsb3dlc3RMZXZlbFRpbGVzWCAqIGJlc3RMZXZlbFNjYWxlO1xyXG4gICAgdmFyIHBpeGVsc0hlaWdodEZvckNlc2l1bSA9IHRoaXMuX3RpbGVIZWlnaHQgKiBsb3dlc3RMZXZlbFRpbGVzWSAqIGJlc3RMZXZlbFNjYWxlO1xyXG4gICAgXHJcbiAgICAvLyBDZXNpdW0gd29ya3Mgd2l0aCBmdWxsIHRpbGVzIG9ubHksIHRodXMgZml4IHRoZSBnZW9ncmFwaGljIGJvdW5kcyBzb1xyXG4gICAgLy8gdGhlIHBpeGVscyBsaWVzIGV4YWN0bHkgb24gdGhlIG9yaWdpbmFsIGJvdW5kc1xyXG4gICAgXHJcbiAgICB2YXIgZ2VvZ3JhcGhpY1dpZHRoRm9yQ2VzaXVtID1cclxuICAgICAgICByZWN0YW5nbGVXaWR0aCAqIHBpeGVsc1dpZHRoRm9yQ2VzaXVtIC8gYmVzdExldmVsV2lkdGg7XHJcbiAgICB2YXIgZ2VvZ3JhcGhpY0hlaWdodEZvckNlc2l1bSA9XHJcbiAgICAgICAgcmVjdGFuZ2xlSGVpZ2h0ICogcGl4ZWxzSGVpZ2h0Rm9yQ2VzaXVtIC8gYmVzdExldmVsSGVpZ2h0O1xyXG4gICAgXHJcbiAgICB2YXIgZml4ZWRFYXN0ICA9IHRoaXMuX3JlY3RhbmdsZS53ZXN0ICArIGdlb2dyYXBoaWNXaWR0aEZvckNlc2l1bTtcclxuICAgIHZhciBmaXhlZFNvdXRoID0gdGhpcy5fcmVjdGFuZ2xlLm5vcnRoIC0gZ2VvZ3JhcGhpY0hlaWdodEZvckNlc2l1bTtcclxuICAgIFxyXG4gICAgdGhpcy5fdGlsaW5nU2NoZW1lUGFyYW1zID0ge1xyXG4gICAgICAgIHdlc3Q6IHRoaXMuX3JlY3RhbmdsZS53ZXN0LFxyXG4gICAgICAgIGVhc3Q6IGZpeGVkRWFzdCxcclxuICAgICAgICBzb3V0aDogZml4ZWRTb3V0aCxcclxuICAgICAgICBub3J0aDogdGhpcy5fcmVjdGFuZ2xlLm5vcnRoLFxyXG4gICAgICAgIGxldmVsWmVyb1RpbGVzWDogbG93ZXN0TGV2ZWxUaWxlc1gsXHJcbiAgICAgICAgbGV2ZWxaZXJvVGlsZXNZOiBsb3dlc3RMZXZlbFRpbGVzWSxcclxuICAgICAgICBtYXhpbXVtTGV2ZWw6IG1heGltdW1DZXNpdW1MZXZlbFxyXG4gICAgfTtcclxuICAgIFxyXG4gICAgdGhpcy5fdGlsaW5nU2NoZW1lID0gY3JlYXRlVGlsaW5nU2NoZW1lKHRoaXMuX3RpbGluZ1NjaGVtZVBhcmFtcyk7XHJcbiAgICAgICAgXHJcbiAgICBDZXNpdW0uVGlsZVByb3ZpZGVyRXJyb3IuaGFuZGxlU3VjY2Vzcyh0aGlzLl9lcnJvckV2ZW50KTtcclxufTtcclxuXHJcbmZ1bmN0aW9uIGNyZWF0ZVRpbGluZ1NjaGVtZShwYXJhbXMpIHtcclxuICAgIHZhciBnZW9ncmFwaGljUmVjdGFuZ2xlRm9yQ2VzaXVtID0gbmV3IENlc2l1bS5SZWN0YW5nbGUoXHJcbiAgICAgICAgcGFyYW1zLndlc3QsIHBhcmFtcy5zb3V0aCwgcGFyYW1zLmVhc3QsIHBhcmFtcy5ub3J0aCk7XHJcbiAgICBcclxuICAgIHZhciB0aWxpbmdTY2hlbWUgPSBuZXcgQ2VzaXVtLkdlb2dyYXBoaWNUaWxpbmdTY2hlbWUoe1xyXG4gICAgICAgIHJlY3RhbmdsZTogZ2VvZ3JhcGhpY1JlY3RhbmdsZUZvckNlc2l1bSxcclxuICAgICAgICBudW1iZXJPZkxldmVsWmVyb1RpbGVzWDogcGFyYW1zLmxldmVsWmVyb1RpbGVzWCxcclxuICAgICAgICBudW1iZXJPZkxldmVsWmVyb1RpbGVzWTogcGFyYW1zLmxldmVsWmVyb1RpbGVzWVxyXG4gICAgfSk7XHJcbiAgICBcclxuICAgIHJldHVybiB0aWxpbmdTY2hlbWU7XHJcbn0iLCIndXNlIHN0cmljdCc7XHJcblxyXG52YXIgSW1hZ2VEZWNvZGVyID0gcmVxdWlyZSgnaW1hZ2UtZGVjb2Rlci5qcycpO1xyXG52YXIgV29ya2VyUHJveHlJbWFnZURlY29kZXIgPSByZXF1aXJlKCd3b3JrZXItcHJveHktaW1hZ2UtZGVjb2Rlci5qcycpO1xyXG52YXIgaW1hZ2VIZWxwZXJGdW5jdGlvbnMgPSByZXF1aXJlKCdpbWFnZS1oZWxwZXItZnVuY3Rpb25zLmpzJyk7XHJcblxyXG5tb2R1bGUuZXhwb3J0cy5JbWFnZURlY29kZXIgPSBJbWFnZURlY29kZXI7XHJcbm1vZHVsZS5leHBvcnRzLldvcmtlclByb3h5SW1hZ2VEZWNvZGVyID0gV29ya2VyUHJveHlJbWFnZURlY29kZXJcclxubW9kdWxlLmV4cG9ydHMuSW1hZ2VEZWNvZGVyVmlld2VyID0gcmVxdWlyZSgnaW1hZ2UtZGVjb2Rlci12aWV3ZXIuanMnKTtcclxuXHJcbm1vZHVsZS5leHBvcnRzLlNpbXBsZUZldGNoZXJCYXNlID0gcmVxdWlyZSgnc2ltcGxlLWZldGNoZXItYmFzZS5qcycpO1xyXG5tb2R1bGUuZXhwb3J0cy5HcmlkSW1hZ2VCYXNlID0gcmVxdWlyZSgnZ3JpZC1pbWFnZS1iYXNlLmpzJyk7XHJcbm1vZHVsZS5leHBvcnRzLkdyaWRGZXRjaGVyQmFzZSA9IHJlcXVpcmUoJ2dyaWQtZmV0Y2hlci1iYXNlLmpzJyk7XHJcbm1vZHVsZS5leHBvcnRzLkdyaWREZWNvZGVyV29ya2VyQmFzZSA9IHJlcXVpcmUoJ2dyaWQtZGVjb2Rlci13b3JrZXItYmFzZS5qcycpO1xyXG5tb2R1bGUuZXhwb3J0cy5HcmlkTGV2ZWxDYWxjdWxhdG9yID0gcmVxdWlyZSgnZ3JpZC1sZXZlbC1jYWxjdWxhdG9yLmpzJyk7XHJcblxyXG5tb2R1bGUuZXhwb3J0cy5DZXNpdW1JbWFnZURlY29kZXJMYXllck1hbmFnZXIgPSByZXF1aXJlKCdjZXNpdW0taW1hZ2UtZGVjb2Rlci1sYXllci1tYW5hZ2VyLmpzJyk7XHJcbm1vZHVsZS5leHBvcnRzLkltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlciA9IHJlcXVpcmUoJ2ltYWdlLWRlY29kZXItaW1hZ2VyeS1wcm92aWRlci5qcycpO1xyXG5tb2R1bGUuZXhwb3J0cy5JbWFnZURlY29kZXJSZWdpb25MYXllciA9IHJlcXVpcmUoJ2ltYWdlLWRlY29kZXItcmVnaW9uLWxheWVyLmpzJyk7IiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBEZWNvZGVKb2I7XHJcblxyXG52YXIgTGlua2VkTGlzdCA9IHJlcXVpcmUoJ2xpbmtlZC1saXN0LmpzJyk7XHJcblxyXG52YXIgcmVxdWVzdElkQ291bnRlciA9IDA7XHJcblxyXG5mdW5jdGlvbiBEZWNvZGVKb2IobGlzdGVuZXJIYW5kbGUsIGltYWdlUGFydFBhcmFtcykge1xyXG4gICAgdGhpcy5fcHJvZ3Jlc3NpdmVTdGFnZXNEb25lID0gMDtcclxuICAgIHRoaXMuX2xpc3RlbmVySGFuZGxlID0gbGlzdGVuZXJIYW5kbGU7XHJcbiAgICB0aGlzLl9pbWFnZVBhcnRQYXJhbXMgPSBpbWFnZVBhcnRQYXJhbXM7XHJcbiAgICB0aGlzLl9hbGxSZWxldmFudEJ5dGVzTG9hZGVkID0gMDtcclxuICAgIHZhciByZXF1ZXN0UGFyYW1zID0gbGlzdGVuZXJIYW5kbGUuaW1hZ2VQYXJ0UGFyYW1zO1xyXG4gICAgdGhpcy5fb2Zmc2V0WCA9IGltYWdlUGFydFBhcmFtcy5taW5YIC0gcmVxdWVzdFBhcmFtcy5taW5YO1xyXG4gICAgdGhpcy5fb2Zmc2V0WSA9IGltYWdlUGFydFBhcmFtcy5taW5ZIC0gcmVxdWVzdFBhcmFtcy5taW5ZO1xyXG4gICAgdGhpcy5fcmVxdWVzdFdpZHRoID0gcmVxdWVzdFBhcmFtcy5tYXhYRXhjbHVzaXZlIC0gcmVxdWVzdFBhcmFtcy5taW5YO1xyXG4gICAgdGhpcy5fcmVxdWVzdEhlaWdodCA9IHJlcXVlc3RQYXJhbXMubWF4WUV4Y2x1c2l2ZSAtIHJlcXVlc3RQYXJhbXMubWluWTtcclxufVxyXG5cclxuRGVjb2RlSm9iLnByb3RvdHlwZS5vbkRhdGEgPSBmdW5jdGlvbiBvbkRhdGEoZGVjb2RlUmVzdWx0KSB7XHJcbiAgICArK3RoaXMuX3Byb2dyZXNzaXZlU3RhZ2VzRG9uZTtcclxuXHJcbiAgICB2YXIgcmVsZXZhbnRCeXRlc0xvYWRlZERpZmYgPVxyXG4gICAgICAgIGRlY29kZVJlc3VsdC5hbGxSZWxldmFudEJ5dGVzTG9hZGVkIC0gdGhpcy5fYWxsUmVsZXZhbnRCeXRlc0xvYWRlZDtcclxuICAgIHRoaXMuX2FsbFJlbGV2YW50Qnl0ZXNMb2FkZWQgPSBkZWNvZGVSZXN1bHQuYWxsUmVsZXZhbnRCeXRlc0xvYWRlZDtcclxuICAgIHRoaXMuX2xpc3RlbmVySGFuZGxlLmFsbFJlbGV2YW50Qnl0ZXNMb2FkZWQgKz0gcmVsZXZhbnRCeXRlc0xvYWRlZERpZmY7XHJcbiAgICBcclxuICAgIHZhciBkZWNvZGVkT2Zmc2V0dGVkID0ge1xyXG4gICAgICAgIG9yaWdpbmFsUmVxdWVzdFdpZHRoOiB0aGlzLl9yZXF1ZXN0V2lkdGgsXHJcbiAgICAgICAgb3JpZ2luYWxSZXF1ZXN0SGVpZ2h0OiB0aGlzLl9yZXF1ZXN0SGVpZ2h0LFxyXG4gICAgICAgIHhJbk9yaWdpbmFsUmVxdWVzdDogdGhpcy5fb2Zmc2V0WCxcclxuICAgICAgICB5SW5PcmlnaW5hbFJlcXVlc3Q6IHRoaXMuX29mZnNldFksXHJcbiAgICAgICAgXHJcbiAgICAgICAgaW1hZ2VEYXRhOiBkZWNvZGVSZXN1bHQsXHJcbiAgICAgICAgXHJcbiAgICAgICAgYWxsUmVsZXZhbnRCeXRlc0xvYWRlZDogdGhpcy5fbGlzdGVuZXJIYW5kbGUuYWxsUmVsZXZhbnRCeXRlc0xvYWRlZFxyXG4gICAgfTtcclxuICAgIFxyXG4gICAgdGhpcy5fbGlzdGVuZXJIYW5kbGUuY2FsbGJhY2soZGVjb2RlZE9mZnNldHRlZCk7XHJcbn07XHJcblxyXG5EZWNvZGVKb2IucHJvdG90eXBlLm9uVGVybWluYXRlZCA9IGZ1bmN0aW9uIG9uVGVybWluYXRlZCgpIHtcclxuICAgIC8vdGhpcy5fbGlzdGVuZXJIYW5kbGUuaXNBbnlEZWNvZGVyQWJvcnRlZCB8PSB0aGlzLl9pc0Fib3J0ZWQ7XHJcbiAgICBcclxuICAgIHZhciByZW1haW5pbmcgPSAtLXRoaXMuX2xpc3RlbmVySGFuZGxlLnJlbWFpbmluZ0RlY29kZUpvYnM7XHJcbiAgICBpZiAocmVtYWluaW5nIDwgMCkge1xyXG4gICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IEluY29uc2lzdGVudCBudW1iZXIgb2YgZG9uZSByZXF1ZXN0cyc7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHZhciBpc0xpc3RlbmVyRG9uZSA9IHJlbWFpbmluZyA9PT0gMDtcclxuICAgIGlmIChpc0xpc3RlbmVyRG9uZSkge1xyXG4gICAgICAgIHRoaXMuX2xpc3RlbmVySGFuZGxlLmlzVGVybWluYXRlZENhbGxiYWNrQ2FsbGVkID0gdHJ1ZTtcclxuICAgICAgICB0aGlzLl9saXN0ZW5lckhhbmRsZS50ZXJtaW5hdGVkQ2FsbGJhY2soXHJcbiAgICAgICAgICAgIHRoaXMuX2xpc3RlbmVySGFuZGxlLmlzQW55RGVjb2RlckFib3J0ZWQpO1xyXG4gICAgfVxyXG59O1xyXG5cclxuT2JqZWN0LmRlZmluZVByb3BlcnR5KERlY29kZUpvYi5wcm90b3R5cGUsICdpbWFnZVBhcnRQYXJhbXMnLCB7XHJcblx0Z2V0OiBmdW5jdGlvbiBnZXRJbWFnZVBhcnRQYXJhbXMoKSB7XHJcblx0XHRyZXR1cm4gdGhpcy5faW1hZ2VQYXJ0UGFyYW1zO1xyXG5cdH1cclxufSk7XHJcblxyXG5PYmplY3QuZGVmaW5lUHJvcGVydHkoRGVjb2RlSm9iLnByb3RvdHlwZSwgJ3Byb2dyZXNzaXZlU3RhZ2VzRG9uZScsIHtcclxuXHRnZXQ6IGZ1bmN0aW9uIGdldFByb2dyZXNzaXZlU3RhZ2VzRG9uZSgpIHtcclxuXHRcdHJldHVybiB0aGlzLl9wcm9ncmVzc2l2ZVN0YWdlc0RvbmU7XHJcblx0fVxyXG59KTsiLCIndXNlIHN0cmljdCc7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IERlY29kZUpvYnNQb29sO1xyXG5cclxudmFyIERlY29kZUpvYiA9IHJlcXVpcmUoJ2RlY29kZS1qb2IuanMnKTtcclxuXHJcbmZ1bmN0aW9uIERlY29kZUpvYnNQb29sKFxyXG4gICAgZGVjb2RlRGVwZW5kZW5jeVdvcmtlcnMsXHJcblx0cHJpb3JpdGl6ZXIsXHJcbiAgICB0aWxlV2lkdGgsXHJcbiAgICB0aWxlSGVpZ2h0KSB7XHJcbiAgICBcclxuXHR0aGlzLl9wcmlvcml0aXplciA9IHByaW9yaXRpemVyO1xyXG4gICAgdGhpcy5fdGlsZVdpZHRoID0gdGlsZVdpZHRoO1xyXG4gICAgdGhpcy5fdGlsZUhlaWdodCA9IHRpbGVIZWlnaHQ7XHJcbiAgICBcclxuICAgIHRoaXMuX2RlY29kZURlcGVuZGVuY3lXb3JrZXJzID0gZGVjb2RlRGVwZW5kZW5jeVdvcmtlcnM7XHJcbn1cclxuXHJcbkRlY29kZUpvYnNQb29sLnByb3RvdHlwZS5mb3JrRGVjb2RlSm9icyA9IGZ1bmN0aW9uIGZvcmtEZWNvZGVKb2JzKFxyXG4gICAgaW1hZ2VQYXJ0UGFyYW1zLFxyXG4gICAgY2FsbGJhY2ssXHJcbiAgICB0ZXJtaW5hdGVkQ2FsbGJhY2ssXHJcbiAgICBpbWFnZVBhcnRQYXJhbXNOb3ROZWVkZWQpIHtcclxuICAgIFxyXG4gICAgdmFyIG1pblggPSBpbWFnZVBhcnRQYXJhbXMubWluWDtcclxuICAgIHZhciBtaW5ZID0gaW1hZ2VQYXJ0UGFyYW1zLm1pblk7XHJcbiAgICB2YXIgbWF4WCA9IGltYWdlUGFydFBhcmFtcy5tYXhYRXhjbHVzaXZlO1xyXG4gICAgdmFyIG1heFkgPSBpbWFnZVBhcnRQYXJhbXMubWF4WUV4Y2x1c2l2ZTtcclxuICAgIHZhciBsZXZlbCA9IGltYWdlUGFydFBhcmFtcy5sZXZlbCB8fCAwO1xyXG4gICAgdmFyIHF1YWxpdHkgPSBpbWFnZVBhcnRQYXJhbXMucXVhbGl0eTtcclxuICAgIHZhciBwcmlvcml0eURhdGEgPSBpbWFnZVBhcnRQYXJhbXMucmVxdWVzdFByaW9yaXR5RGF0YTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgdmFyIGlzTWluQWxpZ25lZCA9XHJcbiAgICAgICAgbWluWCAlIHRoaXMuX3RpbGVXaWR0aCA9PT0gMCAmJiBtaW5ZICUgdGhpcy5fdGlsZUhlaWdodCA9PT0gMDtcclxuICAgIHZhciBpc01heFhBbGlnbmVkID0gbWF4WCAlIHRoaXMuX3RpbGVXaWR0aCAgPT09IDAgfHwgbWF4WCA9PT0gaW1hZ2VQYXJ0UGFyYW1zLmxldmVsV2lkdGg7XHJcbiAgICB2YXIgaXNNYXhZQWxpZ25lZCA9IG1heFkgJSB0aGlzLl90aWxlSGVpZ2h0ID09PSAwIHx8IG1heFkgPT09IGltYWdlUGFydFBhcmFtcy5sZXZlbEhlaWdodDtcclxuICAgIHZhciBpc09yZGVyVmFsaWQgPSBtaW5YIDwgbWF4WCAmJiBtaW5ZIDwgbWF4WTtcclxuICAgIFxyXG4gICAgaWYgKCFpc01pbkFsaWduZWQgfHwgIWlzTWF4WEFsaWduZWQgfHwgIWlzTWF4WUFsaWduZWQgfHwgIWlzT3JkZXJWYWxpZCkge1xyXG4gICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IGltYWdlUGFydFBhcmFtcyBmb3IgZGVjb2RlcnMgaXMgbm90IGFsaWduZWQgdG8gJyArXHJcbiAgICAgICAgICAgICd0aWxlIHNpemUgb3Igbm90IGluIHZhbGlkIG9yZGVyJztcclxuICAgIH1cclxuICAgIFxyXG4gICAgdmFyIG51bVRpbGVzWCA9IE1hdGguY2VpbCgobWF4WCAtIG1pblgpIC8gdGhpcy5fdGlsZVdpZHRoKTtcclxuICAgIHZhciBudW1UaWxlc1kgPSBNYXRoLmNlaWwoKG1heFkgLSBtaW5ZKSAvIHRoaXMuX3RpbGVIZWlnaHQpO1xyXG4gICAgXHJcbiAgICB2YXIgbGlzdGVuZXJIYW5kbGUgPSB7XHJcbiAgICAgICAgaW1hZ2VQYXJ0UGFyYW1zOiBpbWFnZVBhcnRQYXJhbXMsXHJcbiAgICAgICAgY2FsbGJhY2s6IGNhbGxiYWNrLFxyXG4gICAgICAgIHRlcm1pbmF0ZWRDYWxsYmFjazogdGVybWluYXRlZENhbGxiYWNrLFxyXG4gICAgICAgIHJlbWFpbmluZ0RlY29kZUpvYnM6IG51bVRpbGVzWCAqIG51bVRpbGVzWSxcclxuICAgICAgICBpc0FueURlY29kZXJBYm9ydGVkOiBmYWxzZSxcclxuICAgICAgICBpc1Rlcm1pbmF0ZWRDYWxsYmFja0NhbGxlZDogZmFsc2UsXHJcbiAgICAgICAgYWxsUmVsZXZhbnRCeXRlc0xvYWRlZDogMCxcclxuICAgICAgICB0YXNrQ29udGV4dHM6IFtdXHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBmb3IgKHZhciB4ID0gbWluWDsgeCA8IG1heFg7IHggKz0gdGhpcy5fdGlsZVdpZHRoKSB7XHJcbiAgICAgICAgdmFyIHNpbmdsZVRpbGVNYXhYID0gTWF0aC5taW4oeCArIHRoaXMuX3RpbGVXaWR0aCwgaW1hZ2VQYXJ0UGFyYW1zLmxldmVsV2lkdGgpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGZvciAodmFyIHkgPSBtaW5ZOyB5IDwgbWF4WTsgeSArPSB0aGlzLl90aWxlSGVpZ2h0KSB7XHJcbiAgICAgICAgICAgIHZhciBzaW5nbGVUaWxlTWF4WSA9IE1hdGgubWluKHkgKyB0aGlzLl90aWxlSGVpZ2h0LCBpbWFnZVBhcnRQYXJhbXMubGV2ZWxIZWlnaHQpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgdmFyIGlzVGlsZU5vdE5lZWRlZCA9IGlzVW5uZWVkZWQoXHJcbiAgICAgICAgICAgICAgICB4LFxyXG4gICAgICAgICAgICAgICAgeSxcclxuICAgICAgICAgICAgICAgIHNpbmdsZVRpbGVNYXhYLFxyXG4gICAgICAgICAgICAgICAgc2luZ2xlVGlsZU1heFksXHJcbiAgICAgICAgICAgICAgICBpbWFnZVBhcnRQYXJhbXNOb3ROZWVkZWQpO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGlmIChpc1RpbGVOb3ROZWVkZWQpIHtcclxuICAgICAgICAgICAgICAgIC0tbGlzdGVuZXJIYW5kbGUucmVtYWluaW5nRGVjb2RlSm9icztcclxuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgICAgICB9XHJcblx0XHRcdFxyXG4gICAgICAgICAgICB2YXIgc2luZ2xlVGlsZUltYWdlUGFydFBhcmFtcyA9IHtcclxuICAgICAgICAgICAgICAgIG1pblg6IHgsXHJcbiAgICAgICAgICAgICAgICBtaW5ZOiB5LFxyXG4gICAgICAgICAgICAgICAgbWF4WEV4Y2x1c2l2ZTogc2luZ2xlVGlsZU1heFgsXHJcbiAgICAgICAgICAgICAgICBtYXhZRXhjbHVzaXZlOiBzaW5nbGVUaWxlTWF4WSxcclxuICAgICAgICAgICAgICAgIGxldmVsV2lkdGg6IGltYWdlUGFydFBhcmFtcy5sZXZlbFdpZHRoLFxyXG4gICAgICAgICAgICAgICAgbGV2ZWxIZWlnaHQ6IGltYWdlUGFydFBhcmFtcy5sZXZlbEhlaWdodCxcclxuICAgICAgICAgICAgICAgIGxldmVsOiBsZXZlbCxcclxuICAgICAgICAgICAgICAgIHF1YWxpdHk6IHF1YWxpdHksXHJcbiAgICAgICAgICAgICAgICByZXF1ZXN0UHJpb3JpdHlEYXRhOiBwcmlvcml0eURhdGFcclxuICAgICAgICAgICAgfTtcclxuXHJcblx0XHRcdHRoaXMuX3N0YXJ0TmV3VGFzayhsaXN0ZW5lckhhbmRsZSwgc2luZ2xlVGlsZUltYWdlUGFydFBhcmFtcyk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgIH1cclxuICAgIH1cclxuICAgIFxyXG4gICAgaWYgKCFsaXN0ZW5lckhhbmRsZS5pc1Rlcm1pbmF0ZWRDYWxsYmFja0NhbGxlZCAmJlxyXG4gICAgICAgIGxpc3RlbmVySGFuZGxlLnJlbWFpbmluZ0RlY29kZUpvYnMgPT09IDApIHtcclxuICAgICAgICBcclxuICAgICAgICBsaXN0ZW5lckhhbmRsZS5pc1Rlcm1pbmF0ZWRDYWxsYmFja0NhbGxlZCA9IHRydWU7XHJcbiAgICAgICAgbGlzdGVuZXJIYW5kbGUudGVybWluYXRlZENhbGxiYWNrKGxpc3RlbmVySGFuZGxlLmlzQW55RGVjb2RlckFib3J0ZWQpO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICByZXR1cm4gbGlzdGVuZXJIYW5kbGU7XHJcbn07XHJcblxyXG5EZWNvZGVKb2JzUG9vbC5wcm90b3R5cGUuX3N0YXJ0TmV3VGFzayA9IGZ1bmN0aW9uIHN0YXJ0TmV3VGFzayhsaXN0ZW5lckhhbmRsZSwgaW1hZ2VQYXJ0UGFyYW1zKSB7XHJcblx0dmFyIGRlY29kZUpvYiA9IG5ldyBEZWNvZGVKb2IobGlzdGVuZXJIYW5kbGUsIGltYWdlUGFydFBhcmFtcyk7XHJcblx0dmFyIHRhc2tDb250ZXh0ID0gdGhpcy5fZGVjb2RlRGVwZW5kZW5jeVdvcmtlcnMuc3RhcnRUYXNrKGltYWdlUGFydFBhcmFtcywgZGVjb2RlSm9iKTtcclxuXHRsaXN0ZW5lckhhbmRsZS50YXNrQ29udGV4dHMucHVzaCh0YXNrQ29udGV4dCk7XHJcblx0XHJcblx0aWYgKHRoaXMuX3ByaW9yaXRpemVyID09PSBudWxsKSB7XHJcblx0XHRyZXR1cm47XHJcblx0fVxyXG5cdFxyXG5cdHZhciBzZWxmID0gdGhpcztcclxuXHRcclxuXHR0YXNrQ29udGV4dC5zZXRQcmlvcml0eUNhbGN1bGF0b3IoZnVuY3Rpb24oKSB7XHJcblx0XHRyZXR1cm4gc2VsZi5fcHJpb3JpdGl6ZXIuZ2V0UHJpb3JpdHkoZGVjb2RlSm9iKTtcclxuXHR9KTtcclxufTtcclxuXHJcbkRlY29kZUpvYnNQb29sLnByb3RvdHlwZS51bnJlZ2lzdGVyRm9ya2VkSm9icyA9IGZ1bmN0aW9uIHVucmVnaXN0ZXJGb3JrZWRKb2JzKFxyXG4gICAgbGlzdGVuZXJIYW5kbGUpIHtcclxuICAgICAgICAgICAgXHJcbiAgICBpZiAobGlzdGVuZXJIYW5kbGUucmVtYWluaW5nRGVjb2RlSm9icyA9PT0gMCkge1xyXG4gICAgICAgIC8vIEFsbCBqb2JzIGhhcyBhbHJlYWR5IGJlZW4gdGVybWluYXRlZCwgbm8gbmVlZCB0byB1bnJlZ2lzdGVyXHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IGxpc3RlbmVySGFuZGxlLnRhc2tDb250ZXh0cy5sZW5ndGg7ICsraSkge1xyXG4gICAgICAgIGxpc3RlbmVySGFuZGxlLnRhc2tDb250ZXh0c1tpXS51bnJlZ2lzdGVyKCk7XHJcbiAgICB9XHJcbn07XHJcblxyXG5mdW5jdGlvbiBpc1VubmVlZGVkKFxyXG4gICAgbWluWCwgbWluWSwgbWF4WCwgbWF4WSwgaW1hZ2VQYXJ0UGFyYW1zTm90TmVlZGVkKSB7XHJcbiAgICBcclxuICAgIGlmIChpbWFnZVBhcnRQYXJhbXNOb3ROZWVkZWQgPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIHJldHVybiBmYWxzZTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBpbWFnZVBhcnRQYXJhbXNOb3ROZWVkZWQubGVuZ3RoOyArK2kpIHtcclxuICAgICAgICB2YXIgbm90TmVlZGVkID0gaW1hZ2VQYXJ0UGFyYW1zTm90TmVlZGVkW2ldO1xyXG4gICAgICAgIHZhciBpc0luWCA9IG1pblggPj0gbm90TmVlZGVkLm1pblggJiYgbWF4WCA8PSBub3ROZWVkZWQubWF4WEV4Y2x1c2l2ZTtcclxuICAgICAgICB2YXIgaXNJblkgPSBtaW5ZID49IG5vdE5lZWRlZC5taW5ZICYmIG1heFkgPD0gbm90TmVlZGVkLm1heFlFeGNsdXNpdmU7XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKGlzSW5YICYmIGlzSW5ZKSB7XHJcbiAgICAgICAgICAgIHJldHVybiB0cnVlO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuICAgIFxyXG4gICAgcmV0dXJuIGZhbHNlO1xyXG59IiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBGZXRjaENvbnRleHRBcGk7XHJcblxyXG5mdW5jdGlvbiBGZXRjaENvbnRleHRBcGkoKSB7XHJcblx0dGhpcy5fZXZlbnRzID0ge1xyXG5cdFx0aXNQcm9ncmVzc2l2ZUNoYW5nZWQ6IFtdLFxyXG5cdFx0bW92ZTogW10sXHJcblx0XHR0ZXJtaW5hdGU6IFtdLFxyXG5cdFx0XHJcblx0XHRzdG9wOiBbXSxcclxuXHRcdHJlc3VtZTogW10sXHJcblx0XHRcclxuXHRcdGludGVybmFsU3RvcHBlZDogW10sXHJcblx0XHRpbnRlcm5hbERvbmU6IFtdXHJcblx0fTtcclxufVxyXG5cclxuRmV0Y2hDb250ZXh0QXBpLnByb3RvdHlwZS5zdG9wcGVkID0gZnVuY3Rpb24gc3RvcHBlZCgpIHtcclxuXHR0aGlzLl9vbkV2ZW50KCdpbnRlcm5hbFN0b3BwZWQnLCAvKmlzQWJvcnRlZD0qL2ZhbHNlKTtcclxufTtcclxuXHJcbkZldGNoQ29udGV4dEFwaS5wcm90b3R5cGUuZG9uZSA9IGZ1bmN0aW9uIGRvbmUoKSB7XHJcblx0dGhpcy5fb25FdmVudCgnaW50ZXJuYWxEb25lJyk7XHJcbn07XHJcblxyXG5GZXRjaENvbnRleHRBcGkucHJvdG90eXBlLm9uID0gZnVuY3Rpb24gb24oZXZlbnQsIGxpc3RlbmVyLCBsaXN0ZW5lclRoaXMpIHtcclxuXHR2YXIgbGlzdGVuZXJzID0gdGhpcy5fZXZlbnRzW2V2ZW50XTtcclxuXHRpZiAoIWxpc3RlbmVycykge1xyXG5cdFx0dGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogZXZlbnQgJyArIGV2ZW50ICsgJyBkb2VzIG5vdCBleGlzdCBpbiBGZXRjaENvbnRleHQnO1xyXG5cdH1cclxuXHRsaXN0ZW5lcnMucHVzaCh7XHJcblx0XHRsaXN0ZW5lcjogbGlzdGVuZXIsXHJcblx0XHRsaXN0ZW5lclRoaXM6IGxpc3RlbmVyVGhpcyB8fCB0aGlzXHJcblx0fSk7XHJcblx0XHJcblx0cmV0dXJuIHRoaXM7XHJcbn07XHJcblxyXG5GZXRjaENvbnRleHRBcGkucHJvdG90eXBlLl9vbkV2ZW50ID0gZnVuY3Rpb24gb25FdmVudChldmVudCwgYXJnMSwgYXJnMikge1xyXG5cdHZhciBsaXN0ZW5lcnMgPSB0aGlzLl9ldmVudHNbZXZlbnRdO1xyXG5cdGZvciAodmFyIGkgPSAwOyBpIDwgbGlzdGVuZXJzLmxlbmd0aDsgKytpKSB7XHJcblx0XHRsaXN0ZW5lcnNbaV0ubGlzdGVuZXIuY2FsbChsaXN0ZW5lcnNbaV0ubGlzdGVuZXJUaGlzLCBhcmcxLCBhcmcyKTtcclxuXHR9XHJcbn07IiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxudmFyIEZldGNoQ29udGV4dEFwaSA9IHJlcXVpcmUoJ2ZldGNoLWNvbnRleHQtYXBpLmpzJyk7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IEZldGNoQ29udGV4dDtcclxuXHJcbkZldGNoQ29udGV4dC5GRVRDSF9UWVBFX1JFUVVFU1QgPSAxO1xyXG5GZXRjaENvbnRleHQuRkVUQ0hfVFlQRV9NT1ZBQkxFID0gMjsgLy8gbW92YWJsZVxyXG5GZXRjaENvbnRleHQuRkVUQ0hfVFlQRV9PTkxZX1dBSVRfRk9SX0RBVEEgPSAzO1xyXG5cclxuRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19XQUlUX0ZPUl9GRVRDSF9DQUxMID0gMTtcclxuRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19NT1ZBQkxFX1dBSVRfRk9SX01PVkVfQ0FMTCA9IDI7XHJcbkZldGNoQ29udGV4dC5GRVRDSF9TVEFUVVNfUkVRVUVTVF9XQUlUX0ZPUl9TQ0hFRFVMRSA9IDM7XHJcbkZldGNoQ29udGV4dC5GRVRDSF9TVEFUVVNfQUNUSVZFID0gNDtcclxuRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19SRVFVRVNUX0FCT1VUX1RPX1lJRUxEID0gNTtcclxuRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19SRVFVRVNUX1lJRUxERUQgPSA2O1xyXG5GZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX1JFUVVFU1RfQUJPVVRfVE9fQUJPUlQgPSA3O1xyXG5GZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX1JFUVVFU1RfVEVSTUlOQVRFRCA9IDg7XHJcbkZldGNoQ29udGV4dC5GRVRDSF9TVEFUVVNfVU5FWFBFQ1RFRF9GQUlMVVJFID0gOTtcclxuXHJcbmZ1bmN0aW9uIEZldGNoQ29udGV4dChmZXRjaGVyLCBmZXRjaGVyQ2xvc2VyLCBzY2hlZHVsZXIsIHNjaGVkdWxlZEpvYnNMaXN0LCBmZXRjaFR5cGUsIGNvbnRleHRWYXJzKSB7XHJcbiAgICB0aGlzLl9mZXRjaGVyID0gZmV0Y2hlcjtcclxuICAgIHRoaXMuX2ZldGNoZXJDbG9zZXIgPSBmZXRjaGVyQ2xvc2VyO1xyXG4gICAgdGhpcy5fc2NoZWR1bGVyID0gc2NoZWR1bGVyO1xyXG4gICAgdGhpcy5fc2NoZWR1bGVkSm9ic0xpc3QgPSBzY2hlZHVsZWRKb2JzTGlzdDtcclxuICAgIHRoaXMuX3NjaGVkdWxlZEpvYnNMaXN0SXRlcmF0b3IgPSBudWxsO1xyXG4gICAgXHJcbiAgICB0aGlzLl90ZXJtaW5hdGVkTGlzdGVuZXJzID0gW107XHJcbiAgICBcclxuICAgIHRoaXMuX2ltYWdlUGFydFBhcmFtcyA9IG51bGw7XHJcbiAgICBcclxuICAgIHRoaXMuX3N0YXRlID0gRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19XQUlUX0ZPUl9GRVRDSF9DQUxMO1xyXG4gICAgdGhpcy5faXNNb3ZhYmxlID0gZmV0Y2hUeXBlID09PSBGZXRjaENvbnRleHQuRkVUQ0hfVFlQRV9NT1ZBQkxFO1xyXG4gICAgdGhpcy5fY29udGV4dFZhcnMgPSBjb250ZXh0VmFycztcclxuICAgIHRoaXMuX2lzT25seVdhaXRGb3JEYXRhID0gZmV0Y2hUeXBlID09PSBGZXRjaENvbnRleHQuRkVUQ0hfVFlQRV9PTkxZX1dBSVRfRk9SX0RBVEE7XHJcbiAgICB0aGlzLl91c2VTY2hlZHVsZXIgPSBmZXRjaFR5cGUgPT09IEZldGNoQ29udGV4dC5GRVRDSF9UWVBFX1JFUVVFU1Q7XHJcbiAgICB0aGlzLl9yZXNvdXJjZSA9IG51bGw7XHJcbiAgICB0aGlzLl9mZXRjaENvbnRleHRBcGkgPSBudWxsO1xyXG4gICAgLy90aGlzLl9hbHJlYWR5VGVybWluYXRlZFdoZW5BbGxEYXRhQXJyaXZlZCA9IGZhbHNlO1xyXG59XHJcblxyXG5GZXRjaENvbnRleHQucHJvdG90eXBlLmZldGNoID0gZnVuY3Rpb24gZmV0Y2goaW1hZ2VQYXJ0UGFyYW1zKSB7XHJcbiAgICBpZiAodGhpcy5faXNNb3ZhYmxlKSB7XHJcbiAgICAgICAgdGhpcy5faW1hZ2VQYXJ0UGFyYW1zID0gaW1hZ2VQYXJ0UGFyYW1zO1xyXG4gICAgICAgIHRoaXMuX3N0YXJ0RmV0Y2goKTtcclxuICAgICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGlmICh0aGlzLl9pbWFnZVBhcnRQYXJhbXMgIT09IG51bGwpIHtcclxuICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBDYW5ub3QgZmV0Y2ggdHdpY2Ugb24gZmV0Y2ggdHlwZSBvZiBcInJlcXVlc3RcIic7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGlmICh0aGlzLl9zdGF0ZSAhPT0gRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19XQUlUX0ZPUl9GRVRDSF9DQUxMKSB7XHJcbiAgICAgICAgdGhpcy5fc3RhdGUgPSBGZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX1VORVhQRUNURURfRkFJTFVSRTtcclxuICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBVbmV4cGVjdGVkIHN0YXRlIG9uIGZldGNoKCk6ICcgKyB0aGlzLl9zdGF0ZTtcclxuICAgIH1cclxuXHJcbiAgICB0aGlzLl9pbWFnZVBhcnRQYXJhbXMgPSBpbWFnZVBhcnRQYXJhbXM7XHJcbiAgICB0aGlzLl9zdGF0ZSA9IEZldGNoQ29udGV4dC5GRVRDSF9TVEFUVVNfUkVRVUVTVF9XQUlUX0ZPUl9TQ0hFRFVMRTtcclxuICAgIFxyXG4gICAgaWYgKCF0aGlzLl91c2VTY2hlZHVsZXIpIHtcclxuICAgICAgICBzdGFydFJlcXVlc3QoLypyZXNvdXJjZT0qL251bGwsIHRoaXMpO1xyXG4gICAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIFxyXG4gICAgdGhpcy5fc2NoZWR1bGVyLmVucXVldWVKb2Ioc3RhcnRSZXF1ZXN0LCB0aGlzLCBmZXRjaEFib3J0ZWRCeVNjaGVkdWxlcik7XHJcbn07XHJcblxyXG5GZXRjaENvbnRleHQucHJvdG90eXBlLm1hbnVhbEFib3J0UmVxdWVzdCA9IGZ1bmN0aW9uIG1hbnVhbEFib3J0UmVxdWVzdCgpIHtcclxuICAgIHN3aXRjaCAodGhpcy5fc3RhdGUpIHtcclxuICAgICAgICBjYXNlIEZldGNoQ29udGV4dC5GRVRDSF9TVEFUVVNfUkVRVUVTVF9URVJNSU5BVEVEOlxyXG4gICAgICAgIGNhc2UgRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19VTkVYUEVDVEVEX0ZBSUxVUkU6XHJcbiAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICBjYXNlIEZldGNoQ29udGV4dC5GRVRDSF9TVEFUVVNfUkVRVUVTVF9BQk9VVF9UT19BQk9SVDpcclxuICAgICAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogRG91YmxlIGNhbGwgdG8gbWFudWFsQWJvcnRSZXF1ZXN0KCknO1xyXG4gICAgICAgIGNhc2UgRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19BQ1RJVkU6XHJcbiAgICAgICAgICAgIHRoaXMuX3N0YXRlID0gRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19SRVFVRVNUX0FCT1VUX1RPX0FCT1JUO1xyXG4gICAgICAgICAgICBpZiAodGhpcy5faXNPbmx5V2FpdEZvckRhdGEpIHtcclxuICAgICAgICAgICAgICAgIHRoaXMuX2ZldGNoU3RvcHBlZCgvKmlzQWJvcnRlZD0qL3RydWUpO1xyXG4gICAgICAgICAgICB9IGVsc2Uge1xyXG5cdFx0XHRcdHRoaXMuX2ZldGNoQ29udGV4dEFwaS5fb25FdmVudCgnc3RvcCcsIC8qaXNBYm9ydGVkPSovdHJ1ZSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgYnJlYWs7XHJcbiAgICAgICAgY2FzZSBGZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX1dBSVRfRk9SX0ZFVENIX0NBTEw6XHJcbiAgICAgICAgICAgIHRoaXMuX3N0YXRlID0gRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19SRVFVRVNUX1RFUk1JTkFURUQ7XHJcbiAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICBjYXNlIEZldGNoQ29udGV4dC5GRVRDSF9TVEFUVVNfUkVRVUVTVF9XQUlUX0ZPUl9TQ0hFRFVMRTpcclxuICAgICAgICBjYXNlIEZldGNoQ29udGV4dC5GRVRDSF9TVEFUVVNfUkVRVUVTVF9BQk9VVF9UT19ZSUVMRDpcclxuICAgICAgICBjYXNlIEZldGNoQ29udGV4dC5GRVRDSF9TVEFUVVNfUkVRVUVTVF9ZSUVMREVEOlxyXG4gICAgICAgICAgICB0aGlzLl9zdGF0ZSA9IEZldGNoQ29udGV4dC5GRVRDSF9TVEFUVVNfUkVRVUVTVF9BQk9VVF9UT19BQk9SVDtcclxuICAgICAgICAgICAgYnJlYWs7XHJcbiAgICAgICAgZGVmYXVsdDpcclxuICAgICAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogVW5rbm93biBzdGF0ZSBpbiBtYW51YWxBYm9ydFJlcXVlc3QoKSBpbXBsZW1lbnRhdGlvbjogJyArIHRoaXMuX3N0YXRlO1xyXG4gICAgfVxyXG59O1xyXG5cclxuRmV0Y2hDb250ZXh0LnByb3RvdHlwZS5nZXRDb250ZXh0VmFycyA9IGZ1bmN0aW9uIGdldENvbnRleHRWYXJzKCkge1xyXG4gICAgcmV0dXJuIHRoaXMuX2NvbnRleHRWYXJzO1xyXG59O1xyXG5cclxuRmV0Y2hDb250ZXh0LnByb3RvdHlwZS5vbiA9IGZ1bmN0aW9uIG9uKGV2ZW50LCBsaXN0ZW5lcikge1xyXG4gICAgc3dpdGNoIChldmVudCkge1xyXG4gICAgICAgIGNhc2UgJ3Rlcm1pbmF0ZWQnOlxyXG4gICAgICAgICAgICB0aGlzLl90ZXJtaW5hdGVkTGlzdGVuZXJzLnB1c2gobGlzdGVuZXIpO1xyXG4gICAgICAgICAgICBicmVhaztcclxuICAgICAgICBkZWZhdWx0OlxyXG4gICAgICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBVbmV4cGVjdGVkIGV2ZW50ICcgKyBldmVudDtcclxuICAgIH1cclxufTtcclxuXHJcbkZldGNoQ29udGV4dC5wcm90b3R5cGUuc2V0SXNQcm9ncmVzc2l2ZSA9IGZ1bmN0aW9uIHNldElzUHJvZ3Jlc3NpdmUoaXNQcm9ncmVzc2l2ZSkge1xyXG4gICAgdGhpcy5faXNQcm9ncmVzc2l2ZSA9IGlzUHJvZ3Jlc3NpdmU7XHJcbiAgICBpZiAodGhpcy5fZmV0Y2hDb250ZXh0QXBpICE9PSBudWxsKSB7XHJcbiAgICAgICAgdGhpcy5fZmV0Y2hDb250ZXh0QXBpLl9vbkV2ZW50KCdpc1Byb2dyZXNzaXZlQ2hhbmdlZCcsIGlzUHJvZ3Jlc3NpdmUpO1xyXG4gICAgfVxyXG59O1xyXG5cclxuRmV0Y2hDb250ZXh0LnByb3RvdHlwZS5nZXRJc1Byb2dyZXNzaXZlID0gZnVuY3Rpb24gZ2V0SXNQcm9ncmVzc2l2ZSgpIHtcclxuICAgIHJldHVybiB0aGlzLl9pc1Byb2dyZXNzaXZlO1xyXG59O1xyXG5cclxuRmV0Y2hDb250ZXh0LnByb3RvdHlwZS5fc3RhcnRGZXRjaCA9IGZ1bmN0aW9uIHN0YXJ0RmV0Y2goKSB7XHJcbiAgICB2YXIgcHJldlN0YXRlID0gdGhpcy5fc3RhdGU7XHJcbiAgICB0aGlzLl9zdGF0ZSA9IEZldGNoQ29udGV4dC5GRVRDSF9TVEFUVVNfQUNUSVZFO1xyXG5cdFxyXG4gICAgaWYgKHByZXZTdGF0ZSA9PT0gRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19XQUlUX0ZPUl9GRVRDSF9DQUxMIHx8XHJcbiAgICAgICAgcHJldlN0YXRlID09PSBGZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX01PVkFCTEVfV0FJVF9GT1JfTU9WRV9DQUxMKSB7XHJcbiAgICAgICAgXHJcbiAgICAgICAgdGhpcy5fZmV0Y2hlckNsb3Nlci5jaGFuZ2VBY3RpdmVGZXRjaGVzQ291bnQoKzEpO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBpZiAodGhpcy5faXNPbmx5V2FpdEZvckRhdGEpIHtcclxuICAgICAgICB0aGlzLl9mZXRjaENvbnRleHRBcGkgPSB0aGlzLl9leHRyYWN0QWxyZWFkeUZldGNoZWREYXRhKCk7XHJcbiAgICB9IGVsc2UgaWYgKCF0aGlzLl9pc01vdmFibGUgfHwgcHJldlN0YXRlID09PSBGZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX1dBSVRfRk9SX0ZFVENIX0NBTEwpIHtcclxuXHRcdGlmICh0aGlzLl9mZXRjaENvbnRleHRBcGkgIT09IG51bGwpIHtcclxuXHRcdFx0dGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogQ2Fubm90IHN0YXJ0IGZldGNoIG9mIGFscmVhZHkgc3RhcnRlZCBmZXRjaCc7XHJcblx0XHR9XHJcblxyXG4gICAgICAgIHRoaXMuX2ZldGNoQ29udGV4dEFwaSA9IG5ldyBGZXRjaENvbnRleHRBcGkodGhpcyk7XHJcblx0XHR0aGlzLl9mZXRjaENvbnRleHRBcGkub24oJ2ludGVybmFsU3RvcHBlZCcsIHRoaXMuX2ZldGNoU3RvcHBlZCwgdGhpcyk7XHJcblx0XHR0aGlzLl9mZXRjaENvbnRleHRBcGkub24oJ2ludGVybmFsRG9uZScsIHRoaXMuX2ZldGNoRG9uZSwgdGhpcyk7XHJcblx0XHRcclxuXHRcdGlmICh0aGlzLl9pc01vdmFibGUpIHtcclxuXHRcdFx0dGhpcy5fZmV0Y2hlci5zdGFydE1vdmFibGVGZXRjaCh0aGlzLl9mZXRjaENvbnRleHRBcGksIHRoaXMuX2ltYWdlUGFydFBhcmFtcyk7XHJcblx0XHR9IGVsc2Uge1xyXG5cdFx0XHR0aGlzLl9mZXRjaGVyLnN0YXJ0RmV0Y2godGhpcy5fZmV0Y2hDb250ZXh0QXBpLCB0aGlzLl9pbWFnZVBhcnRQYXJhbXMpO1xyXG5cdFx0fVxyXG4gICAgfSBlbHNlIHtcclxuICAgICAgICB0aGlzLl9mZXRjaENvbnRleHRBcGkuX29uRXZlbnQoJ21vdmUnLCB0aGlzLl9pbWFnZVBhcnRQYXJhbXMpO1xyXG4gICAgfVxyXG4gICAgXHJcblx0aWYgKHRoaXMuX2ZldGNoQ29udGV4dEFwaSAhPT0gbnVsbCkgeyAvLyBNaWdodCBiZSBzZXQgdG8gbnVsbCBpbiBpbW1lZGlhdGUgY2FsbCBvZiBmZXRjaFRlcm1pbmF0ZWQgb24gcHJldmlvdXMgbGluZVxyXG5cdFx0dGhpcy5fZmV0Y2hDb250ZXh0QXBpLl9vbkV2ZW50KCdpc1Byb2dyZXNzaXZlQ2hhbmdlZCcsIHRoaXMuX2lzUHJvZ3Jlc3NpdmUpO1xyXG5cdH1cclxufTtcclxuXHJcbkZldGNoQ29udGV4dC5wcm90b3R5cGUuY2hlY2tJZlNob3VsZFlpZWxkID0gZnVuY3Rpb24gY2hlY2tJZlNob3VsZFlpZWxkKCkge1xyXG4gICAgdHJ5IHtcclxuICAgICAgICBpZiAoIXRoaXMuX3VzZVNjaGVkdWxlciB8fCB0aGlzLl9zdGF0ZSA9PT0gRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19SRVFVRVNUX1RFUk1JTkFURUQpIHtcclxuICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBpZiAodGhpcy5fcmVzb3VyY2UgPT09IG51bGwpIHtcclxuICAgICAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogTm8gcmVzb3VyY2UgYWxsb2NhdGVkIGJ1dCBmZXRjaCBjYWxsYmFjayBjYWxsZWQnO1xyXG4gICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgaWYgKCF0aGlzLl9zY2hlZHVsZXJDYWxsYmFja3Muc2hvdWxkWWllbGRPckFib3J0KCkpIHtcclxuICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICB0aGlzLl9zdGF0ZSA9IEZldGNoQ29udGV4dC5GRVRDSF9TVEFUVVNfUkVRVUVTVF9BQk9VVF9UT19ZSUVMRDtcclxuXHRcdHRoaXMuX2ZldGNoQ29udGV4dEFwaS5fb25FdmVudCgnc3RvcCcsIC8qaXNBYm9ydGVkPSovZmFsc2UpO1xyXG4gICAgfSBjYXRjaCAoZSkge1xyXG4gICAgICAgIHRoaXMuX3N0YXRlID0gRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19VTkVYUEVDVEVEX0ZBSUxVUkU7XHJcbiAgICAgICAgZmV0Y2hBYm9ydGVkQnlTY2hlZHVsZXIodGhpcyk7XHJcbiAgICB9XHJcbn07XHJcblxyXG5GZXRjaENvbnRleHQucHJvdG90eXBlLl9mZXRjaERvbmUgPSBmdW5jdGlvbiBmZXRjaERvbmUoKSB7XHJcbiAgICBzd2l0Y2ggKHRoaXMuX3N0YXRlKSB7XHJcbiAgICAgICAgY2FzZSBGZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX1JFUVVFU1RfQUJPVVRfVE9fQUJPUlQ6XHJcbiAgICAgICAgY2FzZSBGZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX0FDVElWRTpcclxuICAgICAgICBjYXNlIEZldGNoQ29udGV4dC5GRVRDSF9TVEFUVVNfUkVRVUVTVF9BQk9VVF9UT19ZSUVMRDpcclxuICAgICAgICAgICAgYnJlYWs7XHJcbiAgICAgICAgZGVmYXVsdDpcclxuICAgICAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogVW5leHBlY3RlZCBzdGF0ZSBvbiBmZXRjaCBkb25lOiAnICsgdGhpcy5fc3RhdGU7XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKHRoaXMuX2lzTW92YWJsZSkge1xyXG4gICAgICAgIHRoaXMuX3N0YXRlID0gRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19NT1ZBQkxFX1dBSVRfRk9SX01PVkVfQ0FMTDtcclxuICAgIH1cclxuICAgIHRoaXMuX2ZldGNoZXJDbG9zZXIuY2hhbmdlQWN0aXZlRmV0Y2hlc0NvdW50KC0xKTtcclxuXHJcblx0aWYgKHRoaXMuX3Jlc291cmNlICE9PSBudWxsKSB7XHJcbiAgICAgICAgdGhpcy5fc2NoZWR1bGVkSm9ic0xpc3QucmVtb3ZlKHRoaXMuX3NjaGVkdWxlZEpvYnNMaXN0SXRlcmF0b3IpO1xyXG4gICAgICAgIHRoaXMuX3NjaGVkdWxlckNhbGxiYWNrcy5qb2JEb25lKCk7XHJcblxyXG4gICAgICAgIHRoaXMuX3Jlc291cmNlID0gbnVsbDtcclxuICAgIH0gZWxzZSBpZiAodGhpcy5fdXNlU2NoZWR1bGVyKSB7XHJcbiAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogSm9iIGV4cGVjdGVkIHRvIGhhdmUgcmVzb3VyY2Ugb24gc3VjY2Vzc2Z1bCB0ZXJtaW5hdGlvbic7XHJcbiAgICB9XHJcblx0XHJcblx0dGhpcy5fdGVybWluYXRlTm9uTW92YWJsZUZldGNoKCk7XHJcbn07XHJcblxyXG5GZXRjaENvbnRleHQucHJvdG90eXBlLl9mZXRjaFN0b3BwZWQgPSBmdW5jdGlvbiBmZXRjaFN0b3BwZWQoaXNBYm9ydGVkKSB7XHJcbiAgICBzd2l0Y2ggKHRoaXMuX3N0YXRlKSB7XHJcbiAgICAgICAgY2FzZSBGZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX1JFUVVFU1RfQUJPVVRfVE9fQUJPUlQ6XHJcblx0XHRcdGlzQWJvcnRlZCA9IHRydWU7IC8vIGZvcmNlIGFib3J0ZWRcclxuICAgICAgICAgICAgYnJlYWs7XHJcbiAgICAgICAgY2FzZSBGZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX1JFUVVFU1RfQUJPVVRfVE9fWUlFTEQ6XHJcblx0XHRcdHZhciBpc1lpZWxkZWQgPSB0aGlzLl9zY2hlZHVsZXJDYWxsYmFja3MudHJ5WWllbGQoXHJcblx0XHRcdFx0Y29udGludWVZaWVsZGVkUmVxdWVzdCxcclxuXHRcdFx0XHRmZXRjaEFib3J0ZWRCeVNjaGVkdWxlcixcclxuXHRcdFx0XHRmZXRjaFlpZWxkZWRCeVNjaGVkdWxlcik7XHJcblx0XHRcdFxyXG5cdFx0XHRpZiAoIWlzWWllbGRlZCkge1xyXG5cdFx0XHRcdGlmICh0aGlzLl9zdGF0ZSAhPT0gRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19SRVFVRVNUX0FCT1VUX1RPX1lJRUxEKSB7XHJcblx0XHRcdFx0XHR0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBVbmV4cGVjdGVkIHN0YXRlIG9uIHRyeVlpZWxkKCkgZmFsc2U6ICcgKyB0aGlzLl9zdGF0ZTtcclxuXHRcdFx0XHR9XHJcblx0XHRcdFx0dGhpcy5fc3RhdGUgPSBGZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX0FDVElWRTtcclxuXHRcdFx0XHR0aGlzLl9mZXRjaENvbnRleHRBcGkuX29uRXZlbnQoJ3Jlc3VtZScpO1xyXG5cdFx0XHRcdHJldHVybjtcclxuXHRcdFx0fVxyXG4gICAgICAgICAgICBicmVhaztcclxuICAgICAgICBkZWZhdWx0OlxyXG4gICAgICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBVbmV4cGVjdGVkIHN0YXRlIG9uIGZldGNoIHN0b3BwZWQ6ICcgKyB0aGlzLl9zdGF0ZTtcclxuICAgIH1cclxuXHJcbiAgICBcclxuICAgIGlmICh0aGlzLl9yZXNvdXJjZSAhPT0gbnVsbCkge1xyXG5cdFx0dGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogVW5leHBlY3RlZCByZXF1ZXN0IHRlcm1pbmF0aW9uIHdpdGhvdXQgcmVzb3VyY2UgYWxsb2NhdGVkJztcclxuICAgIH1cclxuICAgIFxyXG4gICAgdGhpcy5fZmV0Y2hlckNsb3Nlci5jaGFuZ2VBY3RpdmVGZXRjaGVzQ291bnQoLTEpO1xyXG4gICAgaWYgKHRoaXMuX2lzTW92YWJsZSkge1xyXG4gICAgICAgIHRoaXMuX3N0YXRlID0gRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19NT1ZBQkxFX1dBSVRfRk9SX01PVkVfQ0FMTDtcclxuICAgIH0gZWxzZSBpZiAoIWlzQWJvcnRlZCkge1xyXG5cdFx0dGhpcy5fdGVybWluYXRlTm9uTW92YWJsZUZldGNoKCk7XHJcblx0fVxyXG59O1xyXG4gIFxyXG5GZXRjaENvbnRleHQucHJvdG90eXBlLl90ZXJtaW5hdGVOb25Nb3ZhYmxlRmV0Y2ggPSBmdW5jdGlvbiB0ZXJtaW5hdGVOb25Nb3ZhYmxlRmV0Y2goKSB7ICBcclxuICAgIGlmICh0aGlzLl9pc01vdmFibGUpIHtcclxuXHRcdHJldHVybjtcclxuXHR9XHJcblx0XHJcblx0dGhpcy5fc3RhdGUgPSBGZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX1JFUVVFU1RfVEVSTUlOQVRFRDtcclxuXHRcclxuXHRmb3IgKHZhciBpID0gMDsgaSA8IHRoaXMuX3Rlcm1pbmF0ZWRMaXN0ZW5lcnMubGVuZ3RoOyArK2kpIHtcclxuXHRcdHRoaXMuX3Rlcm1pbmF0ZWRMaXN0ZW5lcnNbaV0odGhpcy5fY29udGV4dFZhcnMpO1xyXG5cdH1cclxuICAgIFxyXG4gICAgaWYgKHRoaXMuX2ZldGNoQ29udGV4dEFwaSAhPT0gbnVsbCAmJlxyXG4gICAgICAgIHRoaXMuX3N0YXRlICE9PSBGZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX1VORVhQRUNURURfRkFJTFVSRSkge1xyXG4gICAgICAgICAgICBcclxuICAgICAgICB0aGlzLl9mZXRjaENvbnRleHRBcGkuX29uRXZlbnQoJ3Rlcm1pbmF0ZScpO1xyXG4gICAgICAgIHRoaXMuX2ZldGNoQ29udGV4dEFwaSA9IG51bGw7XHJcbiAgICB9XHJcbn07XHJcblxyXG4vLyBQcm9wZXJ0aWVzIGZvciBGcnVzdHVtUmVxdWVzZXRQcmlvcml0aXplclxyXG5cclxuT2JqZWN0LmRlZmluZVByb3BlcnR5KEZldGNoQ29udGV4dC5wcm90b3R5cGUsICdpbWFnZVBhcnRQYXJhbXMnLCB7XHJcbiAgICBnZXQ6IGZ1bmN0aW9uIGdldEltYWdlUGFydFBhcmFtcygpIHtcclxuICAgICAgICByZXR1cm4gdGhpcy5faW1hZ2VQYXJ0UGFyYW1zO1xyXG4gICAgfVxyXG59KTtcclxuXHJcbmZ1bmN0aW9uIHN0YXJ0UmVxdWVzdChyZXNvdXJjZSwgc2VsZiwgY2FsbGJhY2tzKSB7XHJcbiAgICBpZiAoc2VsZi5fcmVzb3VyY2UgIT09IG51bGwpIHtcclxuICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBVbmV4cGVjdGVkIHJlc3RhcnQgb2YgYWxyZWFkeSBzdGFydGVkIHJlcXVlc3QnO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBpZiAoc2VsZi5fc3RhdGUgPT09IEZldGNoQ29udGV4dC5GRVRDSF9TVEFUVVNfUkVRVUVTVF9BQk9VVF9UT19BQk9SVCkge1xyXG4gICAgICAgIHNlbGYuX2ZldGNoU3RvcHBlZCgvKmlzQWJvcnRlZD0qL3RydWUpO1xyXG4gICAgICAgIHJldHVybjtcclxuICAgIH0gZWxzZSBpZiAoc2VsZi5fc3RhdGUgIT09IEZldGNoQ29udGV4dC5GRVRDSF9TVEFUVVNfUkVRVUVTVF9XQUlUX0ZPUl9TQ0hFRFVMRSkge1xyXG4gICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IFVuZXhwZWN0ZWQgc3RhdGUgb24gc2NoZWR1bGU6ICcgKyBzZWxmLl9zdGF0ZTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgc2VsZi5fcmVzb3VyY2UgPSByZXNvdXJjZTtcclxuXHRzZWxmLl9zY2hlZHVsZXJDYWxsYmFja3MgPSBjYWxsYmFja3M7XHJcblxyXG4gICAgaWYgKHJlc291cmNlICE9PSBudWxsKSB7XHJcbiAgICAgICAgc2VsZi5fc2NoZWR1bGVkSm9ic0xpc3RJdGVyYXRvciA9IHNlbGYuX3NjaGVkdWxlZEpvYnNMaXN0LmFkZChzZWxmKTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgc2VsZi5fc3RhcnRGZXRjaCgpO1xyXG59XHJcblxyXG5mdW5jdGlvbiBjb250aW51ZVlpZWxkZWRSZXF1ZXN0KHJlc291cmNlLCBzZWxmKSB7XHJcbiAgICBpZiAoc2VsZi5faXNNb3ZhYmxlKSB7XHJcbiAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogVW5leHBlY3RlZCBjYWxsIHRvIGNvbnRpbnVlWWllbGRlZFJlcXVlc3Qgb24gbW92YWJsZSBmZXRjaCc7XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKHNlbGYuX3N0YXRlID09PSBGZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX1JFUVVFU1RfQUJPVVRfVE9fQUJPUlQgfHxcclxuICAgICAgICBzZWxmLl9zdGF0ZSA9PT0gRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19VTkVYUEVDVEVEX0ZBSUxVUkUpIHtcclxuICAgICAgICBcclxuICAgICAgICBzZWxmLl9zY2hlZHVsZXJDYWxsYmFja3Muam9iRG9uZSgpO1xyXG4gICAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIFxyXG4gICAgaWYgKHNlbGYuX3N0YXRlICE9PSBGZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX1JFUVVFU1RfWUlFTERFRCkge1xyXG4gICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IFVuZXhwZWN0ZWQgcmVxdWVzdCBzdGF0ZSBvbiBjb250aW51ZTogJyArIHNlbGYuX3N0YXRlO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBzZWxmLl9zdGF0ZSA9IEZldGNoQ29udGV4dC5GRVRDSF9TVEFUVVNfQUNUSVZFO1xyXG4gICAgc2VsZi5fcmVzb3VyY2UgPSByZXNvdXJjZTtcclxuICAgIFxyXG4gICAgc2VsZi5fc2NoZWR1bGVkSm9ic0xpc3RJdGVyYXRvciA9IHNlbGYuX3NjaGVkdWxlZEpvYnNMaXN0LmFkZChzZWxmKTtcclxuICAgIHNlbGYuX29uRXZlbnQoJ3Jlc3VtZScpO1xyXG59XHJcblxyXG5mdW5jdGlvbiBmZXRjaFlpZWxkZWRCeVNjaGVkdWxlcihzZWxmKSB7XHJcbiAgICB2YXIgbmV4dFN0YXRlO1xyXG4gICAgc2VsZi5fcmVzb3VyY2UgPSBudWxsO1xyXG4gICAgc2VsZi5fc2NoZWR1bGVkSm9ic0xpc3QucmVtb3ZlKHNlbGYuX3NjaGVkdWxlZEpvYnNMaXN0SXRlcmF0b3IpO1xyXG4gICAgaWYgKHNlbGYuc3RhdGUgPT09IEZldGNoQ29udGV4dC5GRVRDSF9TVEFUVVNfUkVRVUVTVF9BQk9VVF9UT19ZSUVMRCkge1xyXG4gICAgICAgIHNlbGYuX3N0YXRlID0gRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19SRVFVRVNUX1lJRUxERUQ7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICAgIHNlbGYuX3N0YXRlID0gRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19VTkVYUEVDVEVEX0ZBSUxVUkU7XHJcbiAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogVW5leHBlY3RlZCByZXF1ZXN0IHN0YXRlIG9uIHlpZWxkIHByb2Nlc3M6ICcgKyBzZWxmLl9zdGF0ZTtcclxuICAgIH1cclxufVxyXG5cclxuZnVuY3Rpb24gZmV0Y2hBYm9ydGVkQnlTY2hlZHVsZXIoc2VsZikge1xyXG4gICAgc2VsZi5fcmVzb3VyY2UgPSBudWxsO1xyXG4gICAgc2VsZi5fZmV0Y2hTdG9wcGVkKC8qaXNBYm9ydGVkPSovdHJ1ZSk7XHJcbn0iLCIndXNlIHN0cmljdCc7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IEZldGNoTWFuYWdlcjtcclxuXHJcbnZhciBpbWFnZUhlbHBlckZ1bmN0aW9ucyA9IHJlcXVpcmUoJ2ltYWdlLWhlbHBlci1mdW5jdGlvbnMuanMnKTtcclxudmFyIEZldGNoQ29udGV4dCA9IHJlcXVpcmUoJ2ZldGNoLWNvbnRleHQuanMnKTtcclxudmFyIExpbmtlZExpc3QgPSByZXF1aXJlKCdsaW5rZWQtbGlzdC5qcycpO1xyXG52YXIgRmV0Y2hlckNsb3NlciA9IHJlcXVpcmUoJ2ZldGNoZXItY2xvc2VyLmpzJyk7XHJcblxyXG4vKiBnbG9iYWwgY29uc29sZTogZmFsc2UgKi9cclxuLyogZ2xvYmFsIFByb21pc2U6IGZhbHNlICovXHJcblxyXG5GZXRjaE1hbmFnZXIuZmV0Y2hlckV4cGVjdGVkTWV0aG9kcyA9IFsnb3BlbicsICdvbicsICdjbG9zZScsICdzdGFydEZldGNoJywgJ3N0YXJ0TW92YWJsZUZldGNoJ107XHJcblxyXG5mdW5jdGlvbiBGZXRjaE1hbmFnZXIoZmV0Y2hlciwgb3B0aW9ucykge1xyXG4gICAgb3B0aW9ucyA9IG9wdGlvbnMgfHwge307XHJcblx0XHJcbiAgICB0aGlzLl9mZXRjaGVzTGltaXQgPSBvcHRpb25zLmZldGNoZXNMaW1pdCB8fCA1O1xyXG4gICAgdGhpcy5fc2hvd0xvZyA9IG9wdGlvbnMuc2hvd0xvZztcclxuICAgIFxyXG4gICAgaWYgKHRoaXMuX3Nob3dMb2cpIHtcclxuICAgICAgICAvLyBPbGQgSUVcclxuICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBzaG93TG9nIGlzIG5vdCBzdXBwb3J0ZWQgb24gdGhpcyBicm93c2VyJztcclxuICAgIH1cclxuXHRcclxuICAgIHRoaXMuX3NjaGVkdWxlciA9IG51bGw7XHJcblx0dGhpcy5fZmV0Y2hQcmlvcml0aXplciA9IG51bGw7XHJcblx0dGhpcy5fcHJpb3JpdGl6ZXJUeXBlID0gbnVsbDtcclxuXHRcdFxyXG4gICAgdGhpcy5fbW92YWJsZUhhbmRsZUNvdW50ZXIgPSAwO1xyXG4gICAgdGhpcy5fbW92YWJsZUhhbmRsZXMgPSBbXTtcclxuICAgIHRoaXMuX3JlcXVlc3RCeUlkID0gW107XHJcblx0dGhpcy5faW1hZ2VQYXJhbXMgPSBudWxsO1xyXG4gICAgdGhpcy5fc2NoZWR1bGVkSm9ic0xpc3QgPSBuZXcgTGlua2VkTGlzdCgpO1xyXG5cdHRoaXMuX2ZldGNoZXJDbG9zZXIgPSBuZXcgRmV0Y2hlckNsb3NlcigpO1xyXG4gICAgXHJcbiAgICB0aGlzLl9mZXRjaGVyID0gaW1hZ2VIZWxwZXJGdW5jdGlvbnMuZ2V0T3JDcmVhdGVJbnN0YW5jZShcclxuICAgICAgICBmZXRjaGVyLCAnZmV0Y2hlcicsIEZldGNoTWFuYWdlci5mZXRjaGVyRXhwZWN0ZWRNZXRob2RzKTtcclxufVxyXG5cclxuRmV0Y2hNYW5hZ2VyLnByb3RvdHlwZS5vcGVuID0gZnVuY3Rpb24gb3Blbih1cmwpIHtcclxuICAgIHZhciBmZXRjaFNjaGVkdWxlciA9IGltYWdlSGVscGVyRnVuY3Rpb25zLmNyZWF0ZVByaW9yaXRpemVyKFxyXG4gICAgICAgIHRoaXMuX2ZldGNoZXNMaW1pdCxcclxuICAgICAgICB0aGlzLl9wcmlvcml0aXplclR5cGUsXHJcbiAgICAgICAgJ2ZldGNoJyxcclxuICAgICAgICB0aGlzLl9zaG93TG9nKTtcclxuICAgIFxyXG4gICAgdGhpcy5fZmV0Y2hQcmlvcml0aXplciA9IGZldGNoU2NoZWR1bGVyLnByaW9yaXRpemVyO1xyXG5cdGlmIChmZXRjaFNjaGVkdWxlci5wcmlvcml0aXplciAhPT0gbnVsbCkge1xyXG5cdFx0dGhpcy5fc2NoZWR1bGVyID0gbmV3IHJlc291cmNlU2NoZWR1bGVyLlByaW9yaXR5U2NoZWR1bGVyKFxyXG5cdFx0XHRjcmVhdGVEdW1teVJlc291cmNlLFxyXG5cdFx0XHR0aGlzLl9mZXRjaGVzTGltaXQsXHJcblx0XHRcdGZldGNoU2NoZWR1bGVyLnByaW9yaXRpemVyLFxyXG5cdFx0XHRmZXRjaFNjaGVkdWxlci5zY2hlZHVsZXJPcHRpb25zKTtcclxuXHR9IGVsc2Uge1xyXG5cdFx0dGhpcy5fc2NoZWR1bGVyID0gbmV3IHJlc291cmNlU2NoZWR1bGVyLkxpZm9TY2hlZHVsZXIoXHJcblx0XHRcdGNyZWF0ZUR1bW15UmVzb3VyY2UsXHJcblx0XHRcdHRoaXMuX2ZldGNoZXNMaW1pdCxcclxuXHRcdFx0ZmV0Y2hTY2hlZHVsZXIuc2NoZWR1bGVyT3B0aW9ucyk7XHJcblx0fVxyXG5cclxuXHR2YXIgc2VsZiA9IHRoaXM7XHJcbiAgICByZXR1cm4gdGhpcy5fZmV0Y2hlci5vcGVuKHVybCkudGhlbihmdW5jdGlvbihyZXN1bHQpIHtcclxuXHRcdHNlbGYuX2ltYWdlUGFyYW1zID0gcmVzdWx0O1xyXG5cdFx0cmV0dXJuIHJlc3VsdDtcclxuXHR9KTtcclxufTtcclxuXHJcbkZldGNoTWFuYWdlci5wcm90b3R5cGUub24gPSBmdW5jdGlvbiBvbihldmVudCwgY2FsbGJhY2ssIGFyZykge1xyXG4gICAgcmV0dXJuIHRoaXMuX2ZldGNoZXIub24oZXZlbnQsIGNhbGxiYWNrLCBhcmcpO1xyXG59O1xyXG5cclxuRmV0Y2hNYW5hZ2VyLnByb3RvdHlwZS5jbG9zZSA9IGZ1bmN0aW9uIGNsb3NlKCkge1xyXG4gICAgdmFyIHNlbGYgPSB0aGlzO1xyXG4gICAgdmFyIHJlc29sdmVfID0gbnVsbDtcclxuICAgIHZhciByZWplY3RfID0gbnVsbDtcclxuXHJcbiAgICBmdW5jdGlvbiB3YWl0Rm9yQWN0aXZlRmV0Y2hlcyhyZXN1bHQpIHtcclxuICAgICAgICBzZWxmLl9mZXRjaGVyQ2xvc2VyLmNsb3NlKClcclxuICAgICAgICAgICAgLnRoZW4oZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgICAgICAgICByZXNvbHZlXyhyZXN1bHQpO1xyXG4gICAgICAgICAgICB9KS5jYXRjaChyZWplY3RfKTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKGZ1bmN0aW9uKHJlc29sdmUsIHJlamVjdCkge1xyXG4gICAgICAgIHJlc29sdmVfID0gcmVzb2x2ZTtcclxuICAgICAgICByZWplY3RfID0gcmVqZWN0O1xyXG4gICAgICAgIHNlbGYuX2ZldGNoZXIuY2xvc2UoKVxyXG4gICAgICAgICAgICAudGhlbih3YWl0Rm9yQWN0aXZlRmV0Y2hlcylcclxuICAgICAgICAgICAgLmNhdGNoKHJlamVjdCk7XHJcbiAgICB9KTtcclxufTtcclxuXHJcbkZldGNoTWFuYWdlci5wcm90b3R5cGUuc2V0UHJpb3JpdGl6ZXJUeXBlID0gZnVuY3Rpb24gc2V0UHJpb3JpdGl6ZXJUeXBlKHByaW9yaXRpemVyVHlwZSkge1xyXG5cdGlmICh0aGlzLl9zY2hlZHVsZXIgIT09IG51bGwpIHtcclxuXHRcdHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IGNhbm5vdCBzZXQgcHJpb3JpdGl6ZXIgdHlwZSBhZnRlciBGZXRjaE1hbmFnZXIub3BlbigpIGNhbGxlZCc7XHJcblx0fVxyXG5cdHRoaXMuX3ByaW9yaXRpemVyVHlwZSA9IHByaW9yaXRpemVyVHlwZTtcclxufTtcclxuXHJcbkZldGNoTWFuYWdlci5wcm90b3R5cGUuZ2V0SW1hZ2VQYXJhbXMgPSBmdW5jdGlvbiBnZXRJbWFnZVBhcmFtcygpIHtcclxuXHRyZXR1cm4gdGhpcy5faW1hZ2VQYXJhbXM7XHJcbn07XHJcblxyXG5GZXRjaE1hbmFnZXIucHJvdG90eXBlLnNldElzUHJvZ3Jlc3NpdmVSZXF1ZXN0ID0gZnVuY3Rpb24gc2V0SXNQcm9ncmVzc2l2ZVJlcXVlc3QoXHJcbiAgICByZXF1ZXN0SWQsIGlzUHJvZ3Jlc3NpdmUpIHtcclxuICAgIFxyXG4gICAgdmFyIGZldGNoSm9iID0gdGhpcy5fcmVxdWVzdEJ5SWRbcmVxdWVzdElkXTtcclxuICAgIGlmIChmZXRjaEpvYiA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgLy8gVGhpcyBzaXR1YXRpb24gbWlnaHQgb2NjdXIgaWYgcmVxdWVzdCBoYXMgYmVlbiB0ZXJtaW5hdGVkLFxyXG4gICAgICAgIC8vIGJ1dCB1c2VyJ3MgdGVybWluYXRlZENhbGxiYWNrIGhhcyBub3QgYmVlbiBjYWxsZWQgeWV0LiBJdFxyXG4gICAgICAgIC8vIGhhcHBlbnMgb24gV29ya2VyUHJveHlGZXRjaE1hbmFnZXIgZHVlIHRvIHRocmVhZFxyXG4gICAgICAgIC8vIG1lc3NhZ2UgZGVsYXkuXHJcbiAgICAgICAgXHJcbiAgICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGZldGNoSm9iLnNldElzUHJvZ3Jlc3NpdmUoaXNQcm9ncmVzc2l2ZSk7XHJcbn07XHJcblxyXG5GZXRjaE1hbmFnZXIucHJvdG90eXBlLmNyZWF0ZU1vdmFibGVGZXRjaCA9IGZ1bmN0aW9uIGNyZWF0ZU1vdmFibGVGZXRjaCgpIHtcclxuXHR2YXIgc2VsZiA9IHRoaXM7XHJcbiAgICByZXR1cm4gbmV3IFByb21pc2UoZnVuY3Rpb24ocmVzb2x2ZSwgcmVqZWN0KSB7XHJcbiAgICAgICAgdmFyIG1vdmFibGVIYW5kbGUgPSArK3NlbGYuX21vdmFibGVIYW5kbGVDb3VudGVyO1xyXG4gICAgICAgIHNlbGYuX21vdmFibGVIYW5kbGVzW21vdmFibGVIYW5kbGVdID0gbmV3IEZldGNoQ29udGV4dChcclxuICAgICAgICAgICAgc2VsZi5fZmV0Y2hlcixcclxuICAgICAgICAgICAgc2VsZi5fZmV0Y2hlckNsb3NlcixcclxuICAgICAgICAgICAgc2VsZi5fc2NoZWR1bGVyLFxyXG4gICAgICAgICAgICBzZWxmLl9zY2hlZHVsZWRKb2JzTGlzdCxcclxuICAgICAgICAgICAgRmV0Y2hDb250ZXh0LkZFVENIX1RZUEVfTU9WQUJMRSxcclxuICAgICAgICAgICAgLypjb250ZXh0VmFycz0qL251bGwpO1xyXG5cclxuICAgICAgICByZXNvbHZlKG1vdmFibGVIYW5kbGUpO1xyXG4gICAgfSk7XHJcbn07XHJcblxyXG5GZXRjaE1hbmFnZXIucHJvdG90eXBlLm1vdmVGZXRjaCA9IGZ1bmN0aW9uIG1vdmVGZXRjaChcclxuICAgIG1vdmFibGVIYW5kbGUsIGltYWdlUGFydFBhcmFtcykge1xyXG4gICAgXHJcbiAgICB2YXIgbW92YWJsZSA9IHRoaXMuX21vdmFibGVIYW5kbGVzW21vdmFibGVIYW5kbGVdO1xyXG4gICAgbW92YWJsZS5mZXRjaChpbWFnZVBhcnRQYXJhbXMpO1xyXG59O1xyXG5cclxuRmV0Y2hNYW5hZ2VyLnByb3RvdHlwZS5jcmVhdGVSZXF1ZXN0ID0gZnVuY3Rpb24gY3JlYXRlUmVxdWVzdChcclxuICAgIHJlcXVlc3RJZCwgaW1hZ2VQYXJ0UGFyYW1zKSB7XHJcbiAgICBcclxuICAgIHZhciBjb250ZXh0VmFycyA9IHtcclxuICAgICAgICBwcm9ncmVzc2l2ZVN0YWdlc0RvbmU6IDAsXHJcbiAgICAgICAgaXNMYXN0Q2FsbGJhY2tDYWxsZWRXaXRob3V0TG93UXVhbGl0eUxpbWl0OiBmYWxzZSxcclxuICAgICAgICByZXF1ZXN0SWQ6IHJlcXVlc3RJZCxcclxuICAgICAgICBmZXRjaEpvYjogbnVsbCxcclxuICAgICAgICBzZWxmOiB0aGlzXHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICB2YXIgZmV0Y2hUeXBlID0gLyppc09ubHlXYWl0Rm9yRGF0YSA/XHJcbiAgICAgICAgRmV0Y2hDb250ZXh0LkZFVENIX1RZUEVfT05MWV9XQUlUX0ZPUl9EQVRBIDogKi9GZXRjaENvbnRleHQuRkVUQ0hfVFlQRV9SRVFVRVNUO1xyXG4gICAgXHJcbiAgICB2YXIgZmV0Y2hKb2IgPSBuZXcgRmV0Y2hDb250ZXh0KFxyXG4gICAgICAgIHRoaXMuX2ZldGNoZXIsXHJcbiAgICAgICAgdGhpcy5fZmV0Y2hlckNsb3NlcixcclxuICAgICAgICB0aGlzLl9zY2hlZHVsZXIsXHJcbiAgICAgICAgdGhpcy5fc2NoZWR1bGVkSm9ic0xpc3QsXHJcbiAgICAgICAgZmV0Y2hUeXBlLFxyXG4gICAgICAgIGNvbnRleHRWYXJzKTtcclxuICAgIFxyXG4gICAgY29udGV4dFZhcnMuZmV0Y2hKb2IgPSBmZXRjaEpvYjtcclxuICAgIFxyXG4gICAgaWYgKHRoaXMuX3JlcXVlc3RCeUlkW3JlcXVlc3RJZF0gIT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IER1cGxpY2F0aW9uIG9mIHJlcXVlc3RJZCAnICsgcmVxdWVzdElkO1xyXG4gICAgfSBlbHNlIGlmIChyZXF1ZXN0SWQgIT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIHRoaXMuX3JlcXVlc3RCeUlkW3JlcXVlc3RJZF0gPSBmZXRjaEpvYjtcclxuICAgIH1cclxuICAgIFxyXG4gICAgZmV0Y2hKb2Iub24oJ3Rlcm1pbmF0ZWQnLCBpbnRlcm5hbFRlcm1pbmF0ZWRDYWxsYmFjayk7XHJcbiAgICBcclxuICAgIGZldGNoSm9iLmZldGNoKGltYWdlUGFydFBhcmFtcyk7XHJcbiAgICBcclxuICAgIHRoaXMuX3lpZWxkRmV0Y2hKb2JzKCk7XHJcbn07XHJcblxyXG5GZXRjaE1hbmFnZXIucHJvdG90eXBlLm1hbnVhbEFib3J0UmVxdWVzdCA9IGZ1bmN0aW9uIG1hbnVhbEFib3J0UmVxdWVzdChcclxuICAgIHJlcXVlc3RJZCkge1xyXG4gICAgXHJcbiAgICB2YXIgZmV0Y2hKb2IgPSB0aGlzLl9yZXF1ZXN0QnlJZFtyZXF1ZXN0SWRdO1xyXG4gICAgXHJcbiAgICBpZiAoZmV0Y2hKb2IgPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIC8vIFRoaXMgc2l0dWF0aW9uIG1pZ2h0IG9jY3VyIGlmIHJlcXVlc3QgaGFzIGJlZW4gdGVybWluYXRlZCxcclxuICAgICAgICAvLyBidXQgdXNlcidzIHRlcm1pbmF0ZWRDYWxsYmFjayBoYXMgbm90IGJlZW4gY2FsbGVkIHlldC4gSXRcclxuICAgICAgICAvLyBoYXBwZW5zIG9uIFdvcmtlclByb3h5RmV0Y2hNYW5hZ2VyIGR1ZSB0byB3ZWIgd29ya2VyXHJcbiAgICAgICAgLy8gbWVzc2FnZSBkZWxheS5cclxuICAgICAgICBcclxuICAgICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGZldGNoSm9iLm1hbnVhbEFib3J0UmVxdWVzdCgpO1xyXG4gICAgZGVsZXRlIHRoaXMuX3JlcXVlc3RCeUlkW3JlcXVlc3RJZF07XHJcbn07XHJcblxyXG5GZXRjaE1hbmFnZXIucHJvdG90eXBlLnNldEZldGNoUHJpb3JpdGl6ZXJEYXRhID1cclxuICAgIGZ1bmN0aW9uIHNldEZldGNoUHJpb3JpdGl6ZXJEYXRhKHByaW9yaXRpemVyRGF0YSkge1xyXG5cclxuICAgIGlmICh0aGlzLl9mZXRjaFByaW9yaXRpemVyID09PSBudWxsKSB7XHJcbiAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogTm8gZmV0Y2ggcHJpb3JpdGl6ZXIgaGFzIGJlZW4gc2V0JztcclxuICAgIH1cclxuICAgIFxyXG4gICAgaWYgKHRoaXMuX3Nob3dMb2cpIHtcclxuICAgICAgICBjb25zb2xlLmxvZygnc2V0RmV0Y2hQcmlvcml0aXplckRhdGEoJyArIHByaW9yaXRpemVyRGF0YSArICcpJyk7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHByaW9yaXRpemVyRGF0YS5pbWFnZSA9IHRoaXM7XHJcbiAgICB0aGlzLl9mZXRjaFByaW9yaXRpemVyLnNldFByaW9yaXRpemVyRGF0YShwcmlvcml0aXplckRhdGEpO1xyXG4gICAgdGhpcy5feWllbGRGZXRjaEpvYnMoKTtcclxufTtcclxuXHJcbkZldGNoTWFuYWdlci5wcm90b3R5cGUuX3lpZWxkRmV0Y2hKb2JzID0gZnVuY3Rpb24geWllbGRGZXRjaEpvYnMoKSB7XHJcbiAgICB2YXIgaXRlcmF0b3IgPSB0aGlzLl9zY2hlZHVsZWRKb2JzTGlzdC5nZXRGaXJzdEl0ZXJhdG9yKCk7XHJcbiAgICB3aGlsZSAoaXRlcmF0b3IgIT09IG51bGwpIHtcclxuICAgICAgICB2YXIgZmV0Y2hKb2IgPSB0aGlzLl9zY2hlZHVsZWRKb2JzTGlzdC5nZXRWYWx1ZShpdGVyYXRvcik7XHJcbiAgICAgICAgaXRlcmF0b3IgPSB0aGlzLl9zY2hlZHVsZWRKb2JzTGlzdC5nZXROZXh0SXRlcmF0b3IoaXRlcmF0b3IpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGZldGNoSm9iLmNoZWNrSWZTaG91bGRZaWVsZCgpO1xyXG4gICAgfVxyXG59O1xyXG5cclxuZnVuY3Rpb24gaW50ZXJuYWxUZXJtaW5hdGVkQ2FsbGJhY2soY29udGV4dFZhcnMpIHtcclxuICAgIGRlbGV0ZSBjb250ZXh0VmFycy5zZWxmLl9yZXF1ZXN0QnlJZFtjb250ZXh0VmFycy5yZXF1ZXN0SWRdO1xyXG59XHJcblxyXG5mdW5jdGlvbiBjcmVhdGVEdW1teVJlc291cmNlKCkge1xyXG5cdHJldHVybiB7fTtcclxufSIsIid1c2Ugc3RyaWN0JztcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gRmV0Y2hlckNsb3NlcjtcclxuXHJcbi8qIGdsb2JhbCBQcm9taXNlOiBmYWxzZSAqL1xyXG5cclxuZnVuY3Rpb24gRmV0Y2hlckNsb3NlcigpIHtcclxuXHR0aGlzLl9yZXNvbHZlQ2xvc2UgPSBudWxsO1xyXG5cdHRoaXMuX2FjdGl2ZUZldGNoZXMgPSAwO1xyXG5cdHRoaXMuX2lzQ2xvc2VkID0gZmFsc2U7XHJcbn1cclxuXHJcbkZldGNoZXJDbG9zZXIucHJvdG90eXBlLmNoYW5nZUFjdGl2ZUZldGNoZXNDb3VudCA9IGZ1bmN0aW9uIGNoYW5nZUFjdGl2ZUZldGNoZXNDb3VudChhZGRWYWx1ZSkge1xyXG5cdGlmICh0aGlzLl9pc0Nsb3NlZCkge1xyXG5cdFx0dGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogVW5leHBlY3RlZCBjaGFuZ2Ugb2YgYWN0aXZlIGZldGNoZXMgY291bnQgYWZ0ZXIgY2xvc2VkJztcclxuXHR9XHJcblx0dGhpcy5fYWN0aXZlRmV0Y2hlcyArPSBhZGRWYWx1ZTtcclxuXHRcclxuXHRpZiAodGhpcy5fYWN0aXZlRmV0Y2hlcyA9PT0gMCAmJiB0aGlzLl9yZXNvbHZlQ2xvc2UpIHtcclxuXHRcdHRoaXMuX2lzQ2xvc2VkID0gdHJ1ZTtcclxuXHRcdHRoaXMuX3Jlc29sdmVDbG9zZSgpO1xyXG5cdH1cclxufTtcclxuXHJcbkZldGNoZXJDbG9zZXIucHJvdG90eXBlLmlzQ2xvc2VSZXF1ZXN0ZWQgPSBmdW5jdGlvbiBpc0Nsb3NlUmVxdWVzdGVkKCkge1xyXG5cdHJldHVybiB0aGlzLl9pc0Nsb3NlZCB8fCAodGhpcy5fcmVzb2x2ZUNsb3NlICE9PSBudWxsKTtcclxufTtcclxuXHJcbkZldGNoZXJDbG9zZXIucHJvdG90eXBlLmNsb3NlID0gZnVuY3Rpb24gY2xvc2UoKSB7XHJcblx0aWYgKHRoaXMuaXNDbG9zZVJlcXVlc3RlZCgpKSB7XHJcblx0XHR0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBjbG9zZSgpIGNhbGxlZCB0d2ljZSc7XHJcblx0fVxyXG5cdHZhciBzZWxmID0gdGhpcztcclxuXHRyZXR1cm4gbmV3IFByb21pc2UoZnVuY3Rpb24ocmVzb2x2ZSwgcmVqZWN0KSB7XHJcblx0XHRzZWxmLl9yZXNvbHZlQ2xvc2UgPSByZXNvbHZlO1xyXG5cdFx0aWYgKHNlbGYuX2FjdGl2ZUZldGNoZXMgPT09IDApIHtcclxuXHRcdFx0c2VsZi5fcmVzb2x2ZUNsb3NlKCk7XHJcblx0XHR9XHJcblx0fSk7XHJcbn07IiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBGcnVzdHVtUmVxdWVzdHNQcmlvcml0aXplcjtcclxudmFyIFBSSU9SSVRZX0FCT1JUX05PVF9JTl9GUlVTVFVNID0gLTE7XHJcbnZhciBQUklPUklUWV9DQUxDVUxBVElPTl9GQUlMRUQgPSAwO1xyXG52YXIgUFJJT1JJVFlfVE9PX0dPT0RfUkVTT0xVVElPTiA9IDE7XHJcbnZhciBQUklPUklUWV9OT1RfSU5fRlJVU1RVTSA9IDI7XHJcbnZhciBQUklPUklUWV9MT1dFUl9SRVNPTFVUSU9OID0gMztcclxuXHJcbnZhciBQUklPUklUWV9NSU5PUklUWV9JTl9GUlVTVFVNID0gNDtcclxudmFyIFBSSU9SSVRZX1BBUlRJQUxfSU5fRlJVU1RVTSA9IDU7XHJcbnZhciBQUklPUklUWV9NQUpPUklUWV9JTl9GUlVTVFVNID0gNjtcclxudmFyIFBSSU9SSVRZX0ZVTExZX0lOX0ZSVVNUVU0gPSA3O1xyXG5cclxudmFyIEFERF9QUklPUklUWV9UT19MT1dfUVVBTElUWSA9IDU7XHJcblxyXG52YXIgUFJJT1JJVFlfSElHSEVTVCA9IDEzO1xyXG5cclxudmFyIGxvZzIgPSBNYXRoLmxvZygyKTtcclxuXHJcbmZ1bmN0aW9uIEZydXN0dW1SZXF1ZXN0c1ByaW9yaXRpemVyKFxyXG4gICAgaXNBYm9ydFJlcXVlc3RzTm90SW5GcnVzdHVtLCBpc1ByaW9yaXRpemVMb3dQcm9ncmVzc2l2ZVN0YWdlKSB7XHJcbiAgICBcclxuICAgIHRoaXMuX2ZydXN0dW1EYXRhID0gbnVsbDtcclxuICAgIHRoaXMuX2lzQWJvcnRSZXF1ZXN0c05vdEluRnJ1c3R1bSA9IGlzQWJvcnRSZXF1ZXN0c05vdEluRnJ1c3R1bTtcclxuICAgIHRoaXMuX2lzUHJpb3JpdGl6ZUxvd1Byb2dyZXNzaXZlU3RhZ2UgPSBpc1ByaW9yaXRpemVMb3dQcm9ncmVzc2l2ZVN0YWdlO1xyXG59XHJcblxyXG5PYmplY3QuZGVmaW5lUHJvcGVydHkoXHJcbiAgICBGcnVzdHVtUmVxdWVzdHNQcmlvcml0aXplci5wcm90b3R5cGUsICdtaW5pbWFsTG93UXVhbGl0eVByaW9yaXR5Jywge1xyXG4gICAgICAgIGdldDogZnVuY3Rpb24gbWluaW1hbExvd1F1YWxpdHlQcmlvcml0eSgpIHtcclxuICAgICAgICAgICAgcmV0dXJuIFBSSU9SSVRZX01JTk9SSVRZX0lOX0ZSVVNUVU0gKyBBRERfUFJJT1JJVFlfVE9fTE9XX1FVQUxJVFk7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4pO1xyXG4gICAgXHJcbkZydXN0dW1SZXF1ZXN0c1ByaW9yaXRpemVyLnByb3RvdHlwZS5zZXRQcmlvcml0aXplckRhdGEgPSBmdW5jdGlvbiBzZXRQcmlvcml0aXplckRhdGEoZGF0YSkge1xyXG4gICAgdGhpcy5fZnJ1c3R1bURhdGEgPSBkYXRhO1xyXG59O1xyXG5cclxuRnJ1c3R1bVJlcXVlc3RzUHJpb3JpdGl6ZXIucHJvdG90eXBlLmdldFByaW9yaXR5ID0gZnVuY3Rpb24gZ2V0UHJpb3JpdHkoam9iQ29udGV4dCkge1xyXG4gICAgdmFyIGltYWdlUGFydFBhcmFtcyA9IGpvYkNvbnRleHQuaW1hZ2VQYXJ0UGFyYW1zO1xyXG4gICAgaWYgKGltYWdlUGFydFBhcmFtcy5yZXF1ZXN0UHJpb3JpdHlEYXRhLm92ZXJyaWRlSGlnaGVzdFByaW9yaXR5KSB7XHJcbiAgICAgICAgcmV0dXJuIFBSSU9SSVRZX0hJR0hFU1Q7XHJcbiAgICB9XHJcblxyXG4gICAgdmFyIHByaW9yaXR5ID0gdGhpcy5fZ2V0UHJpb3JpdHlJbnRlcm5hbChpbWFnZVBhcnRQYXJhbXMpO1xyXG4gICAgdmFyIGlzSW5GcnVzdHVtID0gcHJpb3JpdHkgPj0gUFJJT1JJVFlfTUlOT1JJVFlfSU5fRlJVU1RVTTtcclxuICAgIFxyXG4gICAgaWYgKHRoaXMuX2lzQWJvcnRSZXF1ZXN0c05vdEluRnJ1c3R1bSAmJiAhaXNJbkZydXN0dW0pIHtcclxuICAgICAgICByZXR1cm4gUFJJT1JJVFlfQUJPUlRfTk9UX0lOX0ZSVVNUVU07XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHZhciBwcmlvcml0aXplTG93UHJvZ3Jlc3NpdmVTdGFnZSA9IDA7XHJcbiAgICBcclxuICAgIGlmICh0aGlzLl9pc1ByaW9yaXRpemVMb3dQcm9ncmVzc2l2ZVN0YWdlICYmIGlzSW5GcnVzdHVtKSB7XHJcbiAgICAgICAgcHJpb3JpdGl6ZUxvd1Byb2dyZXNzaXZlU3RhZ2UgPVxyXG4gICAgICAgICAgICBqb2JDb250ZXh0LnByb2dyZXNzaXZlU3RhZ2VzRG9uZSA9PT0gMCA/IEFERF9QUklPUklUWV9UT19MT1dfUVVBTElUWSA6XHJcbiAgICAgICAgICAgIGpvYkNvbnRleHQucHJvZ3Jlc3NpdmVTdGFnZXNEb25lID09PSAxID8gMSA6XHJcbiAgICAgICAgICAgIDA7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHJldHVybiBwcmlvcml0eSArIHByaW9yaXRpemVMb3dQcm9ncmVzc2l2ZVN0YWdlO1xyXG59O1xyXG5cclxuRnJ1c3R1bVJlcXVlc3RzUHJpb3JpdGl6ZXIucHJvdG90eXBlLl9nZXRQcmlvcml0eUludGVybmFsID0gZnVuY3Rpb24gZ2V0UHJpb3JpdHlJbnRlcm5hbChpbWFnZVBhcnRQYXJhbXMpIHtcclxuICAgIGlmICh0aGlzLl9mcnVzdHVtRGF0YSA9PT0gbnVsbCkge1xyXG4gICAgICAgIHJldHVybiBQUklPUklUWV9DQUxDVUxBVElPTl9GQUlMRUQ7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGlmICh0aGlzLl9mcnVzdHVtRGF0YS5pbWFnZVJlY3RhbmdsZSA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogTm8gaW1hZ2VSZWN0YW5nbGUgaW5mb3JtYXRpb24gcGFzc2VkIGluIHNldFByaW9yaXRpemVyRGF0YSc7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHZhciBleGFjdEZydXN0dW1MZXZlbCA9IHRoaXMuX2ZydXN0dW1EYXRhLmV4YWN0bGV2ZWw7XHJcbiAgICBcclxuICAgIGlmICh0aGlzLl9mcnVzdHVtRGF0YS5leGFjdGxldmVsID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBObyBleGFjdGxldmVsIGluZm9ybWF0aW9uIHBhc3NlZCBpbiAnICtcclxuICAgICAgICAgICAgJ3NldFByaW9yaXRpemVyRGF0YS4gVXNlIG51bGwgaWYgdW5rbm93bic7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHZhciB0aWxlV2VzdCA9IHRoaXMuX3BpeGVsVG9DYXJ0b2dyYXBoaWNYKFxyXG4gICAgICAgIGltYWdlUGFydFBhcmFtcy5taW5YLCBpbWFnZVBhcnRQYXJhbXMpO1xyXG4gICAgdmFyIHRpbGVFYXN0ID0gdGhpcy5fcGl4ZWxUb0NhcnRvZ3JhcGhpY1goXHJcbiAgICAgICAgaW1hZ2VQYXJ0UGFyYW1zLm1heFhFeGNsdXNpdmUsIGltYWdlUGFydFBhcmFtcyk7XHJcbiAgICB2YXIgdGlsZU5vcnRoID0gdGhpcy5fcGl4ZWxUb0NhcnRvZ3JhcGhpY1koXHJcbiAgICAgICAgaW1hZ2VQYXJ0UGFyYW1zLm1pblksIGltYWdlUGFydFBhcmFtcyk7XHJcbiAgICB2YXIgdGlsZVNvdXRoID0gdGhpcy5fcGl4ZWxUb0NhcnRvZ3JhcGhpY1koXHJcbiAgICAgICAgaW1hZ2VQYXJ0UGFyYW1zLm1heFlFeGNsdXNpdmUsIGltYWdlUGFydFBhcmFtcyk7XHJcbiAgICBcclxuICAgIHZhciB0aWxlUGl4ZWxzV2lkdGggPVxyXG4gICAgICAgIGltYWdlUGFydFBhcmFtcy5tYXhYRXhjbHVzaXZlIC0gaW1hZ2VQYXJ0UGFyYW1zLm1pblg7XHJcbiAgICB2YXIgdGlsZVBpeGVsc0hlaWdodCA9XHJcbiAgICAgICAgaW1hZ2VQYXJ0UGFyYW1zLm1heFlFeGNsdXNpdmUgLSBpbWFnZVBhcnRQYXJhbXMubWluWTtcclxuICAgIFxyXG4gICAgdmFyIHJlcXVlc3RUb0ZydXN0dW1SZXNvbHV0aW9uUmF0aW87XHJcbiAgICB2YXIgdGlsZUxldmVsID0gaW1hZ2VQYXJ0UGFyYW1zLmxldmVsIHx8IDA7XHJcbiAgICBpZiAoZXhhY3RGcnVzdHVtTGV2ZWwgPT09IG51bGwpIHtcclxuICAgICAgICB2YXIgdGlsZVJlc29sdXRpb25YID0gdGlsZVBpeGVsc1dpZHRoIC8gKHRpbGVFYXN0IC0gdGlsZVdlc3QpO1xyXG4gICAgICAgIHZhciB0aWxlUmVzb2x1dGlvblkgPSB0aWxlUGl4ZWxzSGVpZ2h0IC8gKHRpbGVOb3J0aCAtIHRpbGVTb3V0aCk7XHJcbiAgICAgICAgdmFyIHRpbGVSZXNvbHV0aW9uID0gTWF0aC5tYXgodGlsZVJlc29sdXRpb25YLCB0aWxlUmVzb2x1dGlvblkpO1xyXG4gICAgICAgIHZhciBmcnVzdHVtUmVzb2x1dGlvbiA9IHRoaXMuX2ZydXN0dW1EYXRhLnJlc29sdXRpb247XHJcbiAgICAgICAgcmVxdWVzdFRvRnJ1c3R1bVJlc29sdXRpb25SYXRpbyA9IHRpbGVSZXNvbHV0aW9uIC8gZnJ1c3R1bVJlc29sdXRpb247XHJcbiAgICBcclxuICAgICAgICBpZiAocmVxdWVzdFRvRnJ1c3R1bVJlc29sdXRpb25SYXRpbyA+IDIpIHtcclxuICAgICAgICAgICAgcmV0dXJuIFBSSU9SSVRZX1RPT19HT09EX1JFU09MVVRJT047XHJcbiAgICAgICAgfVxyXG4gICAgfSBlbHNlIGlmICh0aWxlTGV2ZWwgPCBleGFjdEZydXN0dW1MZXZlbCkge1xyXG4gICAgICAgIHJldHVybiBQUklPUklUWV9UT09fR09PRF9SRVNPTFVUSU9OO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICB2YXIgZnJ1c3R1bVJlY3RhbmdsZSA9IHRoaXMuX2ZydXN0dW1EYXRhLnJlY3RhbmdsZTtcclxuICAgIHZhciBpbnRlcnNlY3Rpb25XZXN0ID0gTWF0aC5tYXgoZnJ1c3R1bVJlY3RhbmdsZS53ZXN0LCB0aWxlV2VzdCk7XHJcbiAgICB2YXIgaW50ZXJzZWN0aW9uRWFzdCA9IE1hdGgubWluKGZydXN0dW1SZWN0YW5nbGUuZWFzdCwgdGlsZUVhc3QpO1xyXG4gICAgdmFyIGludGVyc2VjdGlvblNvdXRoID0gTWF0aC5tYXgoZnJ1c3R1bVJlY3RhbmdsZS5zb3V0aCwgdGlsZVNvdXRoKTtcclxuICAgIHZhciBpbnRlcnNlY3Rpb25Ob3J0aCA9IE1hdGgubWluKGZydXN0dW1SZWN0YW5nbGUubm9ydGgsIHRpbGVOb3J0aCk7XHJcbiAgICBcclxuICAgIHZhciBpbnRlcnNlY3Rpb25XaWR0aCA9IGludGVyc2VjdGlvbkVhc3QgLSBpbnRlcnNlY3Rpb25XZXN0O1xyXG4gICAgdmFyIGludGVyc2VjdGlvbkhlaWdodCA9IGludGVyc2VjdGlvbk5vcnRoIC0gaW50ZXJzZWN0aW9uU291dGg7XHJcbiAgICBcclxuICAgIGlmIChpbnRlcnNlY3Rpb25XaWR0aCA8IDAgfHwgaW50ZXJzZWN0aW9uSGVpZ2h0IDwgMCkge1xyXG4gICAgICAgIHJldHVybiBQUklPUklUWV9OT1RfSU5fRlJVU1RVTTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgaWYgKGV4YWN0RnJ1c3R1bUxldmVsICE9PSBudWxsKSB7XHJcbiAgICAgICAgaWYgKHRpbGVMZXZlbCA+IGV4YWN0RnJ1c3R1bUxldmVsKSB7XHJcbiAgICAgICAgICAgIHJldHVybiBQUklPUklUWV9MT1dFUl9SRVNPTFVUSU9OO1xyXG4gICAgICAgIH1cclxuICAgIH0gZWxzZSBpZiAodGlsZUxldmVsID4gMCAmJiByZXF1ZXN0VG9GcnVzdHVtUmVzb2x1dGlvblJhdGlvIDwgMC4yNSkge1xyXG4gICAgICAgIHJldHVybiBQUklPUklUWV9MT1dFUl9SRVNPTFVUSU9OO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICB2YXIgaW50ZXJzZWN0aW9uQXJlYSA9IGludGVyc2VjdGlvbldpZHRoICogaW50ZXJzZWN0aW9uSGVpZ2h0O1xyXG4gICAgdmFyIHRpbGVBcmVhID0gKHRpbGVFYXN0IC0gdGlsZVdlc3QpICogKHRpbGVOb3J0aCAtIHRpbGVTb3V0aCk7XHJcbiAgICB2YXIgcGFydEluRnJ1c3R1bSA9IGludGVyc2VjdGlvbkFyZWEgLyB0aWxlQXJlYTtcclxuICAgIFxyXG4gICAgaWYgKHBhcnRJbkZydXN0dW0gPiAwLjk5KSB7XHJcbiAgICAgICAgcmV0dXJuIFBSSU9SSVRZX0ZVTExZX0lOX0ZSVVNUVU07XHJcbiAgICB9IGVsc2UgaWYgKHBhcnRJbkZydXN0dW0gPiAwLjcpIHtcclxuICAgICAgICByZXR1cm4gUFJJT1JJVFlfTUFKT1JJVFlfSU5fRlJVU1RVTTtcclxuICAgIH0gZWxzZSBpZiAocGFydEluRnJ1c3R1bSA+IDAuMykge1xyXG4gICAgICAgIHJldHVybiBQUklPUklUWV9QQVJUSUFMX0lOX0ZSVVNUVU07XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICAgIHJldHVybiBQUklPUklUWV9NSU5PUklUWV9JTl9GUlVTVFVNO1xyXG4gICAgfVxyXG59O1xyXG5cclxuRnJ1c3R1bVJlcXVlc3RzUHJpb3JpdGl6ZXIucHJvdG90eXBlLl9waXhlbFRvQ2FydG9ncmFwaGljWCA9IGZ1bmN0aW9uIHBpeGVsVG9DYXJ0b2dyYXBoaWNYKFxyXG4gICAgeCwgaW1hZ2VQYXJ0UGFyYW1zKSB7XHJcbiAgICBcclxuICAgIHZhciByZWxhdGl2ZVggPSB4IC8gaW1hZ2VQYXJ0UGFyYW1zLmxldmVsV2lkdGg7XHJcbiAgICBcclxuICAgIHZhciBpbWFnZVJlY3RhbmdsZSA9IHRoaXMuX2ZydXN0dW1EYXRhLmltYWdlUmVjdGFuZ2xlO1xyXG4gICAgdmFyIHJlY3RhbmdsZVdpZHRoID0gaW1hZ2VSZWN0YW5nbGUuZWFzdCAtIGltYWdlUmVjdGFuZ2xlLndlc3Q7XHJcbiAgICBcclxuICAgIHZhciB4UHJvamVjdGVkID0gaW1hZ2VSZWN0YW5nbGUud2VzdCArIHJlbGF0aXZlWCAqIHJlY3RhbmdsZVdpZHRoO1xyXG4gICAgcmV0dXJuIHhQcm9qZWN0ZWQ7XHJcbn07XHJcblxyXG5GcnVzdHVtUmVxdWVzdHNQcmlvcml0aXplci5wcm90b3R5cGUuX3BpeGVsVG9DYXJ0b2dyYXBoaWNZID0gZnVuY3Rpb24gdGlsZVRvQ2FydG9ncmFwaGljWShcclxuICAgIHksIGltYWdlUGFydFBhcmFtcywgaW1hZ2UpIHtcclxuICAgIFxyXG4gICAgdmFyIHJlbGF0aXZlWSA9IHkgLyBpbWFnZVBhcnRQYXJhbXMubGV2ZWxIZWlnaHQ7XHJcbiAgICBcclxuICAgIHZhciBpbWFnZVJlY3RhbmdsZSA9IHRoaXMuX2ZydXN0dW1EYXRhLmltYWdlUmVjdGFuZ2xlO1xyXG4gICAgdmFyIHJlY3RhbmdsZUhlaWdodCA9IGltYWdlUmVjdGFuZ2xlLm5vcnRoIC0gaW1hZ2VSZWN0YW5nbGUuc291dGg7XHJcbiAgICBcclxuICAgIHZhciB5UHJvamVjdGVkID0gaW1hZ2VSZWN0YW5nbGUubm9ydGggLSByZWxhdGl2ZVkgKiByZWN0YW5nbGVIZWlnaHQ7XHJcbiAgICByZXR1cm4geVByb2plY3RlZDtcclxufTsiLCIndXNlIHN0cmljdCc7XHJcblxyXG52YXIgRnJ1c3R1bVJlcXVlc3RzUHJpb3JpdGl6ZXIgPSByZXF1aXJlKCdmcnVzdHVtLXJlcXVlc3RzLXByaW9yaXRpemVyLmpzJyk7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IHtcclxuICAgIGNhbGN1bGF0ZUZydXN0dW0yREZyb21Cb3VuZHM6IGNhbGN1bGF0ZUZydXN0dW0yREZyb21Cb3VuZHMsXHJcbiAgICBjcmVhdGVQcmlvcml0aXplcjogY3JlYXRlUHJpb3JpdGl6ZXIsXHJcbiAgICBmaXhCb3VuZHM6IGZpeEJvdW5kcyxcclxuICAgIGVuc3VyZUxldmVsQ2FsY3VsYXRvcjogZW5zdXJlTGV2ZWxDYWxjdWxhdG9yLFxyXG4gICAgYWxpZ25QYXJhbXNUb1RpbGVzQW5kTGV2ZWw6IGFsaWduUGFyYW1zVG9UaWxlc0FuZExldmVsLFxyXG4gICAgZ2V0T3JDcmVhdGVJbnN0YW5jZTogZ2V0T3JDcmVhdGVJbnN0YW5jZSxcclxuICAgIGlzSW5kaXJlY3RDcmVhdGlvbk5lZWRlZDogaXNJbmRpcmVjdENyZWF0aW9uTmVlZGVkXHJcbn07XHJcblxyXG4vLyBBdm9pZCBqc2hpbnQgZXJyb3JcclxuLyogZ2xvYmFsIHNlbGY6IGZhbHNlICovXHJcbi8qIGdsb2JhbCBnbG9iYWxzOiBmYWxzZSAqL1xyXG4gICAgXHJcbi8vdmFyIGxvZzIgPSBNYXRoLmxvZygyKTtcclxuXHJcbmZ1bmN0aW9uIGNhbGN1bGF0ZUZydXN0dW0yREZyb21Cb3VuZHMoXHJcbiAgICBib3VuZHMsIHNjcmVlblNpemUpIHtcclxuICAgIFxyXG4gICAgdmFyIHNjcmVlblBpeGVscyA9XHJcbiAgICAgICAgc2NyZWVuU2l6ZS54ICogc2NyZWVuU2l6ZS54ICsgc2NyZWVuU2l6ZS55ICogc2NyZWVuU2l6ZS55O1xyXG4gICAgXHJcbiAgICB2YXIgYm91bmRzV2lkdGggPSBib3VuZHMuZWFzdCAtIGJvdW5kcy53ZXN0O1xyXG4gICAgdmFyIGJvdW5kc0hlaWdodCA9IGJvdW5kcy5ub3J0aCAtIGJvdW5kcy5zb3V0aDtcclxuICAgIHZhciBib3VuZHNEaXN0YW5jZSA9XHJcbiAgICAgICAgYm91bmRzV2lkdGggKiBib3VuZHNXaWR0aCArIGJvdW5kc0hlaWdodCAqIGJvdW5kc0hlaWdodDtcclxuICAgIFxyXG4gICAgdmFyIHJlc29sdXRpb24gPSBNYXRoLnNxcnQoc2NyZWVuUGl4ZWxzIC8gYm91bmRzRGlzdGFuY2UpO1xyXG4gICAgXHJcbiAgICB2YXIgZnJ1c3R1bURhdGEgPSB7XHJcbiAgICAgICAgcmVzb2x1dGlvbjogcmVzb2x1dGlvbixcclxuICAgICAgICByZWN0YW5nbGU6IGJvdW5kcyxcclxuICAgICAgICBcclxuICAgICAgICAvLyBSZWR1bmRhbnQsIGJ1dCBlbmFibGVzIHRvIGF2b2lkIGFscmVhZHktcGVyZm9ybWVkIGNhbGN1bGF0aW9uXHJcbiAgICAgICAgc2NyZWVuU2l6ZTogc2NyZWVuU2l6ZVxyXG4gICAgfTtcclxuICAgIFxyXG4gICAgcmV0dXJuIGZydXN0dW1EYXRhO1xyXG59XHJcbiAgICBcclxuZnVuY3Rpb24gY3JlYXRlUHJpb3JpdGl6ZXIoXHJcbiAgICByZXNvdXJjZUxpbWl0LCBwcmlvcml0aXplclR5cGUsIHNjaGVkdWxlck5hbWUsIHNob3dMb2cpIHtcclxuICAgIFxyXG4gICAgdmFyIHByaW9yaXRpemVyO1xyXG5cdHZhciBsaW1pdFJlc291cmNlQnlMb3dRdWFsaXR5UHJpb3JpdHkgPSBmYWxzZTtcclxuXHRcclxuXHRpZiAocHJpb3JpdGl6ZXJUeXBlID09PSAnZnJ1c3R1bScpIHtcclxuXHRcdGxpbWl0UmVzb3VyY2VCeUxvd1F1YWxpdHlQcmlvcml0eSA9IHRydWU7XHJcblx0XHRwcmlvcml0aXplciA9IG5ldyBGcnVzdHVtUmVxdWVzdHNQcmlvcml0aXplcigpO1xyXG5cdH0gZWxzZSBpZiAocHJpb3JpdGl6ZXJUeXBlID09PSAnZnJ1c3R1bU9ubHknKSB7XHJcblx0XHRsaW1pdFJlc291cmNlQnlMb3dRdWFsaXR5UHJpb3JpdHkgPSB0cnVlO1xyXG5cdFx0cHJpb3JpdGl6ZXIgPSBuZXcgRnJ1c3R1bVJlcXVlc3RzUHJpb3JpdGl6ZXIoXHJcblx0XHRcdC8qaXNBYm9ydFJlcXVlc3RzTm90SW5GcnVzdHVtPSovdHJ1ZSxcclxuXHRcdFx0Lyppc1ByaW9yaXRpemVMb3dRdWFsaXR5U3RhZ2U9Ki90cnVlKTtcclxuXHR9IGVsc2UgaWYgKCFwcmlvcml0aXplclR5cGUpIHtcclxuXHRcdHByaW9yaXRpemVyID0gbnVsbDtcclxuXHR9IGVsc2Uge1xyXG5cdFx0cHJpb3JpdGl6ZXIgPSBwcmlvcml0aXplclR5cGU7XHJcblx0fVxyXG5cdFxyXG5cdHZhciBvcHRpb25zID0ge1xyXG5cdFx0c2NoZWR1bGVyTmFtZTogc2NoZWR1bGVyTmFtZSxcclxuXHRcdHNob3dMb2c6IHNob3dMb2dcclxuXHR9O1xyXG5cdFxyXG5cdGlmIChsaW1pdFJlc291cmNlQnlMb3dRdWFsaXR5UHJpb3JpdHkpIHtcclxuXHRcdG9wdGlvbnMucmVzb3VyY2VHdWFyYW50ZWVkRm9ySGlnaFByaW9yaXR5ID0gcmVzb3VyY2VMaW1pdCAtIDI7XHJcblx0XHRvcHRpb25zLmhpZ2hQcmlvcml0eVRvR3VhcmFudGVlUmVzb3VyY2UgPVxyXG5cdFx0XHRwcmlvcml0aXplci5taW5pbWFsTG93UXVhbGl0eVByaW9yaXR5O1xyXG5cdH1cclxuICAgICAgICBcclxuICAgIHJldHVybiB7XHJcbiAgICAgICAgcHJpb3JpdGl6ZXI6IHByaW9yaXRpemVyLFxyXG4gICAgICAgIHNjaGVkdWxlck9wdGlvbnM6IG9wdGlvbnNcclxuICAgIH07XHJcbn1cclxuICAgIFxyXG5mdW5jdGlvbiBmaXhCb3VuZHMoYm91bmRzLCBpbWFnZSwgYWRhcHRQcm9wb3J0aW9ucykge1xyXG4gICAgaWYgKCFhZGFwdFByb3BvcnRpb25zKSB7XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG5cclxuICAgIHZhciByZWN0YW5nbGVXaWR0aCA9IGJvdW5kcy5lYXN0IC0gYm91bmRzLndlc3Q7XHJcbiAgICB2YXIgcmVjdGFuZ2xlSGVpZ2h0ID0gYm91bmRzLm5vcnRoIC0gYm91bmRzLnNvdXRoO1xyXG5cclxuICAgIHZhciBwaXhlbHNBc3BlY3RSYXRpbyA9IGltYWdlLmdldEltYWdlV2lkdGgoKSAvIGltYWdlLmdldEltYWdlSGVpZ2h0KCk7XHJcbiAgICB2YXIgcmVjdGFuZ2xlQXNwZWN0UmF0aW8gPSByZWN0YW5nbGVXaWR0aCAvIHJlY3RhbmdsZUhlaWdodDtcclxuICAgIFxyXG4gICAgaWYgKHBpeGVsc0FzcGVjdFJhdGlvIDwgcmVjdGFuZ2xlQXNwZWN0UmF0aW8pIHtcclxuICAgICAgICB2YXIgb2xkV2lkdGggPSByZWN0YW5nbGVXaWR0aDtcclxuICAgICAgICByZWN0YW5nbGVXaWR0aCA9IHJlY3RhbmdsZUhlaWdodCAqIHBpeGVsc0FzcGVjdFJhdGlvO1xyXG4gICAgICAgIHZhciBzdWJzdHJhY3RGcm9tV2lkdGggPSBvbGRXaWR0aCAtIHJlY3RhbmdsZVdpZHRoO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGJvdW5kcy5lYXN0IC09IHN1YnN0cmFjdEZyb21XaWR0aCAvIDI7XHJcbiAgICAgICAgYm91bmRzLndlc3QgKz0gc3Vic3RyYWN0RnJvbVdpZHRoIC8gMjtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgICAgdmFyIG9sZEhlaWdodCA9IHJlY3RhbmdsZUhlaWdodDtcclxuICAgICAgICByZWN0YW5nbGVIZWlnaHQgPSByZWN0YW5nbGVXaWR0aCAvIHBpeGVsc0FzcGVjdFJhdGlvO1xyXG4gICAgICAgIHZhciBzdWJzdHJhY3RGcm9tSGVpZ2h0ID0gb2xkSGVpZ2h0IC0gcmVjdGFuZ2xlSGVpZ2h0O1xyXG4gICAgICAgIFxyXG4gICAgICAgIGJvdW5kcy5ub3J0aCAtPSBzdWJzdHJhY3RGcm9tSGVpZ2h0IC8gMjtcclxuICAgICAgICBib3VuZHMuc291dGggKz0gc3Vic3RyYWN0RnJvbUhlaWdodCAvIDI7XHJcbiAgICB9XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGVuc3VyZUxldmVsQ2FsY3VsYXRvcihsZXZlbENhbGN1bGF0b3IpIHtcclxuICAgIGlmICgnZnVuY3Rpb24nICE9PSB0eXBlb2YgbGV2ZWxDYWxjdWxhdG9yLmdldExldmVsKSB7XHJcbiAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogTWlzc2luZyBtZXRob2QgbGV2ZWxDYWxjdWxhdG9yLmdldExldmVsKCknO1xyXG4gICAgfVxyXG4gICAgaWYgKCdmdW5jdGlvbicgIT09IHR5cGVvZiBsZXZlbENhbGN1bGF0b3IuZ2V0TGV2ZWxXaWR0aCkge1xyXG4gICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IE1pc3NpbmcgbWV0aG9kIGxldmVsQ2FsY3VsYXRvci5nZXRMZXZlbFdpZHRoKCknO1xyXG4gICAgfVxyXG4gICAgaWYgKCdmdW5jdGlvbicgIT09IHR5cGVvZiBsZXZlbENhbGN1bGF0b3IuZ2V0TGV2ZWxIZWlnaHQpIHtcclxuICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBNaXNzaW5nIG1ldGhvZCBsZXZlbENhbGN1bGF0b3IuZ2V0TGV2ZWxIZWlnaHQoKSc7XHJcbiAgICB9XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGFsaWduUGFyYW1zVG9UaWxlc0FuZExldmVsKHJlZ2lvbiwgaW1hZ2VEZWNvZGVyKSB7XHJcbiAgICB2YXIgdGlsZVdpZHRoID0gaW1hZ2VEZWNvZGVyLmdldFRpbGVXaWR0aCgpO1xyXG4gICAgdmFyIHRpbGVIZWlnaHQgPSBpbWFnZURlY29kZXIuZ2V0VGlsZUhlaWdodCgpO1xyXG4gICAgXHJcbiAgICB2YXIgcmVnaW9uTWluWCA9IHJlZ2lvbi5taW5YO1xyXG4gICAgdmFyIHJlZ2lvbk1pblkgPSByZWdpb24ubWluWTtcclxuICAgIHZhciByZWdpb25NYXhYID0gcmVnaW9uLm1heFhFeGNsdXNpdmU7XHJcbiAgICB2YXIgcmVnaW9uTWF4WSA9IHJlZ2lvbi5tYXhZRXhjbHVzaXZlO1xyXG4gICAgdmFyIHNjcmVlbldpZHRoID0gcmVnaW9uLnNjcmVlbldpZHRoO1xyXG4gICAgdmFyIHNjcmVlbkhlaWdodCA9IHJlZ2lvbi5zY3JlZW5IZWlnaHQ7XHJcbiAgICBcclxuICAgIHZhciBpc1ZhbGlkT3JkZXIgPSByZWdpb25NaW5YIDwgcmVnaW9uTWF4WCAmJiByZWdpb25NaW5ZIDwgcmVnaW9uTWF4WTtcclxuICAgIGlmICghaXNWYWxpZE9yZGVyKSB7XHJcbiAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogUGFyYW1ldGVycyBvcmRlciBpcyBpbnZhbGlkJztcclxuICAgIH1cclxuICAgIFxyXG4gICAgdmFyIGRlZmF1bHRMZXZlbFdpZHRoID0gaW1hZ2VEZWNvZGVyLmdldEltYWdlV2lkdGgoKTtcclxuICAgIHZhciBkZWZhdWx0TGV2ZWxIZWlnaHQgPSBpbWFnZURlY29kZXIuZ2V0SW1hZ2VIZWlnaHQoKTtcclxuICAgIGlmIChyZWdpb25NYXhYIDwgMCB8fCByZWdpb25NaW5YID49IGRlZmF1bHRMZXZlbFdpZHRoIHx8XHJcbiAgICAgICAgcmVnaW9uTWF4WSA8IDAgfHwgcmVnaW9uTWluWSA+PSBkZWZhdWx0TGV2ZWxIZWlnaHQpIHtcclxuICAgICAgICBcclxuICAgICAgICByZXR1cm4gbnVsbDtcclxuICAgIH1cclxuICAgIFxyXG4gICAgdmFyIGxldmVsQ2FsY3VsYXRvciA9IGltYWdlRGVjb2Rlci5nZXRMZXZlbENhbGN1bGF0b3IoKTtcclxuICAgIHZhciBsZXZlbCA9IGxldmVsQ2FsY3VsYXRvci5nZXRMZXZlbChyZWdpb24pO1xyXG4gICAgdmFyIGxldmVsV2lkdGggPSBsZXZlbENhbGN1bGF0b3IuZ2V0TGV2ZWxXaWR0aChsZXZlbCk7XHJcbiAgICB2YXIgbGV2ZWxIZWlnaHQgPSBsZXZlbENhbGN1bGF0b3IuZ2V0TGV2ZWxIZWlnaHQobGV2ZWwpO1xyXG4gICAgXHJcbiAgICB2YXIgc2NhbGVYID0gZGVmYXVsdExldmVsV2lkdGggLyBsZXZlbFdpZHRoO1xyXG4gICAgdmFyIHNjYWxlWSA9IGRlZmF1bHRMZXZlbEhlaWdodCAvIGxldmVsSGVpZ2h0O1xyXG4gICAgXHJcbiAgICB2YXIgbWluVGlsZVggPSBNYXRoLmZsb29yKHJlZ2lvbk1pblggLyAoc2NhbGVYICogdGlsZVdpZHRoICkpO1xyXG4gICAgdmFyIG1pblRpbGVZID0gTWF0aC5mbG9vcihyZWdpb25NaW5ZIC8gKHNjYWxlWSAqIHRpbGVIZWlnaHQpKTtcclxuICAgIHZhciBtYXhUaWxlWCA9IE1hdGguY2VpbCAocmVnaW9uTWF4WCAvIChzY2FsZVggKiB0aWxlV2lkdGggKSk7XHJcbiAgICB2YXIgbWF4VGlsZVkgPSBNYXRoLmNlaWwgKHJlZ2lvbk1heFkgLyAoc2NhbGVZICogdGlsZUhlaWdodCkpO1xyXG4gICAgXHJcbiAgICB2YXIgbWluWCA9IG1pblRpbGVYICogdGlsZVdpZHRoO1xyXG4gICAgdmFyIG1pblkgPSBtaW5UaWxlWSAqIHRpbGVIZWlnaHQ7XHJcbiAgICB2YXIgbWF4WCA9IG1heFRpbGVYICogdGlsZVdpZHRoO1xyXG4gICAgdmFyIG1heFkgPSBtYXhUaWxlWSAqIHRpbGVIZWlnaHQ7XHJcbiAgICBcclxuICAgIHZhciBjcm9wcGVkTWluWCA9IE1hdGgubWF4KDAsIE1hdGgubWluKGxldmVsV2lkdGggLCBtaW5YKSk7XHJcbiAgICB2YXIgY3JvcHBlZE1pblkgPSBNYXRoLm1heCgwLCBNYXRoLm1pbihsZXZlbEhlaWdodCwgbWluWSkpO1xyXG4gICAgdmFyIGNyb3BwZWRNYXhYID0gTWF0aC5tYXgoMCwgTWF0aC5taW4obGV2ZWxXaWR0aCAsIG1heFgpKTtcclxuICAgIHZhciBjcm9wcGVkTWF4WSA9IE1hdGgubWF4KDAsIE1hdGgubWluKGxldmVsSGVpZ2h0LCBtYXhZKSk7XHJcbiAgICBcclxuICAgIHZhciBpbWFnZVBhcmFtc1RvU2NyZWVuU2NhbGVYID0gc2NyZWVuV2lkdGggIC8gKG1heFggLSBtaW5YKTtcclxuICAgIHZhciBpbWFnZVBhcmFtc1RvU2NyZWVuU2NhbGVZID0gc2NyZWVuSGVpZ2h0IC8gKG1heFkgLSBtaW5ZKTtcclxuICAgIFxyXG4gICAgdmFyIGltYWdlUGFydFBhcmFtcyA9IHtcclxuICAgICAgICBtaW5YOiBjcm9wcGVkTWluWCxcclxuICAgICAgICBtaW5ZOiBjcm9wcGVkTWluWSxcclxuICAgICAgICBtYXhYRXhjbHVzaXZlOiBjcm9wcGVkTWF4WCxcclxuICAgICAgICBtYXhZRXhjbHVzaXZlOiBjcm9wcGVkTWF4WSxcclxuICAgICAgICBsZXZlbFdpZHRoOiBsZXZlbFdpZHRoLFxyXG4gICAgICAgIGxldmVsSGVpZ2h0OiBsZXZlbEhlaWdodCxcclxuICAgICAgICBsZXZlbDogbGV2ZWxcclxuICAgIH07XHJcbiAgICBcclxuICAgIHZhciBwb3NpdGlvbkluSW1hZ2UgPSB7XHJcbiAgICAgICAgbWluWDogY3JvcHBlZE1pblggKiBzY2FsZVgsXHJcbiAgICAgICAgbWluWTogY3JvcHBlZE1pblkgKiBzY2FsZVksXHJcbiAgICAgICAgbWF4WEV4Y2x1c2l2ZTogY3JvcHBlZE1heFggKiBzY2FsZVgsXHJcbiAgICAgICAgbWF4WUV4Y2x1c2l2ZTogY3JvcHBlZE1heFkgKiBzY2FsZVlcclxuICAgIH07XHJcbiAgICBcclxuICAgIHZhciBjcm9wcGVkU2NyZWVuID0ge1xyXG4gICAgICAgIG1pblggOiBNYXRoLmZsb29yKChjcm9wcGVkTWluWCAtIG1pblgpICogaW1hZ2VQYXJhbXNUb1NjcmVlblNjYWxlWCksXHJcbiAgICAgICAgbWluWSA6IE1hdGguZmxvb3IoKGNyb3BwZWRNaW5ZIC0gbWluWSkgKiBpbWFnZVBhcmFtc1RvU2NyZWVuU2NhbGVZKSxcclxuICAgICAgICBtYXhYRXhjbHVzaXZlIDogTWF0aC5jZWlsKChjcm9wcGVkTWF4WCAtIG1pblgpICogaW1hZ2VQYXJhbXNUb1NjcmVlblNjYWxlWCksXHJcbiAgICAgICAgbWF4WUV4Y2x1c2l2ZSA6IE1hdGguY2VpbCgoY3JvcHBlZE1heFkgLSBtaW5ZKSAqIGltYWdlUGFyYW1zVG9TY3JlZW5TY2FsZVkpXHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICByZXR1cm4ge1xyXG4gICAgICAgIGltYWdlUGFydFBhcmFtczogaW1hZ2VQYXJ0UGFyYW1zLFxyXG4gICAgICAgIHBvc2l0aW9uSW5JbWFnZTogcG9zaXRpb25JbkltYWdlLFxyXG4gICAgICAgIGNyb3BwZWRTY3JlZW46IGNyb3BwZWRTY3JlZW5cclxuICAgIH07XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGdldE9yQ3JlYXRlSW5zdGFuY2Uob2JqLCBvYmpOYW1lLCBleHBlY3RlZE1ldGhvZHMpIHtcclxuICAgIGlmICghaXNJbmRpcmVjdENyZWF0aW9uTmVlZGVkKG9iaiwgb2JqTmFtZSwgZXhwZWN0ZWRNZXRob2RzKSkge1xyXG4gICAgICAgIHJldHVybiBvYmo7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHZhciBjbGFzc1RvQ3JlYXRlID0gbnVsbDtcclxuICAgIHRyeSB7XHJcbiAgICAgICAgY2xhc3NUb0NyZWF0ZSA9IGdldENsYXNzSW5HbG9iYWxPYmplY3Qod2luZG93LCBvYmouY3Rvck5hbWUpO1xyXG4gICAgfSBjYXRjaChlKSB7IH1cclxuXHJcbiAgICBpZiAoIWNsYXNzVG9DcmVhdGUpIHtcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICBjbGFzc1RvQ3JlYXRlID0gZ2V0Q2xhc3NJbkdsb2JhbE9iamVjdChnbG9iYWxzLCBvYmouY3Rvck5hbWUpO1xyXG4gICAgICAgIH0gY2F0Y2goZSkgeyB9XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGlmICghY2xhc3NUb0NyZWF0ZSkge1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGNsYXNzVG9DcmVhdGUgPSBnZXRDbGFzc0luR2xvYmFsT2JqZWN0KHNlbGYsIG9iai5jdG9yTmFtZSk7XHJcbiAgICAgICAgfSBjYXRjaChlKSB7IH1cclxuICAgIH1cclxuICAgIFxyXG4gICAgaWYgKCFjbGFzc1RvQ3JlYXRlKSB7XHJcbiAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogQ291bGQgbm90IGZpbmQgY2xhc3MgJyArIG9iai5jdG9yTmFtZSArICcgaW4gZ2xvYmFsICcgK1xyXG4gICAgICAgICAgICAnIHNjb3BlIHRvIGNyZWF0ZSBhbiBpbnN0YW5jZSBvZiAnICsgb2JqTmFtZTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgdmFyIHJlc3VsdCA9IG5ldyBjbGFzc1RvQ3JlYXRlKCk7XHJcbiAgICBcclxuICAgIC8vIFRocm93IGV4Y2VwdGlvbiBpZiBtZXRob2RzIG5vdCBleGlzdFxyXG4gICAgaXNJbmRpcmVjdENyZWF0aW9uTmVlZGVkKHJlc3VsdCwgb2JqTmFtZSwgZXhwZWN0ZWRNZXRob2RzLCAvKmRpc2FibGVDdG9yTmFtZVNlYXJjaD0qL3RydWUpO1xyXG4gICAgXHJcbiAgICByZXR1cm4gcmVzdWx0O1xyXG59XHJcblxyXG5mdW5jdGlvbiBpc0luZGlyZWN0Q3JlYXRpb25OZWVkZWQob2JqLCBvYmpOYW1lLCBleHBlY3RlZE1ldGhvZHMsIGRpc2FibGVDdG9yTmFtZVNlYXJjaCkge1xyXG4gICAgaWYgKCFvYmopIHtcclxuICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBtaXNzaW5nIGFyZ3VtZW50ICcgKyBvYmpOYW1lO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICB2YXIgbm9uZXhpc3RpbmdNZXRob2Q7XHJcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IGV4cGVjdGVkTWV0aG9kcy5sZW5ndGg7ICsraSkge1xyXG4gICAgICAgIGlmICgnZnVuY3Rpb24nICE9PSB0eXBlb2Ygb2JqW2V4cGVjdGVkTWV0aG9kc1tpXV0pIHtcclxuICAgICAgICAgICAgbm9uZXhpc3RpbmdNZXRob2QgPSBleHBlY3RlZE1ldGhvZHNbaV07XHJcbiAgICAgICAgICAgIGJyZWFrO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuICAgIFxyXG4gICAgaWYgKGkgPT09IGV4cGVjdGVkTWV0aG9kcy5sZW5ndGgpIHtcclxuICAgICAgICByZXR1cm4gZmFsc2U7XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKGRpc2FibGVDdG9yTmFtZVNlYXJjaCkge1xyXG4gICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IENvdWxkIG5vdCBmaW5kIG1ldGhvZCAnICtcclxuICAgICAgICAgICAgbm9uZXhpc3RpbmdNZXRob2QgKyAnIGluIG9iamVjdCAnICsgb2JqTmFtZTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgaWYgKCdzdHJpbmcnICE9PSB0eXBlb2Ygb2JqLmN0b3JOYW1lKSB7XHJcbiAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogQ291bGQgbm90IGZpbmQgbWV0aG9kICcgKyBub25leGlzdGluZ01ldGhvZCArXHJcbiAgICAgICAgICAgICcgaW4gb2JqZWN0ICcgKyBvYmpOYW1lICsgJy4gRWl0aGVyIG1ldGhvZCBzaG91bGQgYmUgZXhpc3Qgb3IgdGhlIG9iamVjdFxcJ3MgJyArXHJcbiAgICAgICAgICAgICdjdG9yTmFtZSBwcm9wZXJ0eSBzaG91bGQgcG9pbnQgdG8gYSBjbGFzcyB0byBjcmVhdGUgaW5zdGFuY2UgZnJvbSc7XHJcbiAgICB9XHJcbiAgICBpZiAoIW9iai5zY3JpcHRzVG9JbXBvcnQpIHtcclxuICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBDb3VsZCBub3QgZmluZCBtZXRob2QgJyArIG5vbmV4aXN0aW5nTWV0aG9kICtcclxuICAgICAgICAgICAgJyBpbiBvYmplY3QgJyArIG9iak5hbWUgKyAnLiBFaXRoZXIgbWV0aG9kIHNob3VsZCBiZSBleGlzdCBvciB0aGUgb2JqZWN0XFwncyAnICtcclxuICAgICAgICAgICAgJ3NjcmlwdHNUb0ltcG9ydCBwcm9wZXJ0eSBzaG91bGQgYmUgZXhpc3QnO1xyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiB0cnVlO1xyXG59XHJcblxyXG5mdW5jdGlvbiBnZXRDbGFzc0luR2xvYmFsT2JqZWN0KGdsb2JhbE9iamVjdCwgY2xhc3NOYW1lKSB7XHJcbiAgICBpZiAoZ2xvYmFsT2JqZWN0W2NsYXNzTmFtZV0pIHtcclxuICAgICAgICByZXR1cm4gZ2xvYmFsT2JqZWN0W2NsYXNzTmFtZV07XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHZhciByZXN1bHQgPSBnbG9iYWxPYmplY3Q7XHJcbiAgICB2YXIgcGF0aCA9IGNsYXNzTmFtZS5zcGxpdCgnLicpO1xyXG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBwYXRoLmxlbmd0aDsgKytpKSB7XHJcbiAgICAgICAgcmVzdWx0ID0gcmVzdWx0W3BhdGhbaV1dO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICByZXR1cm4gcmVzdWx0O1xyXG59IiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBMaW5rZWRMaXN0O1xyXG5cclxuZnVuY3Rpb24gTGlua2VkTGlzdCgpIHtcclxuICAgIHRoaXMuX2ZpcnN0ID0geyBfcHJldjogbnVsbCwgX3BhcmVudDogdGhpcyB9O1xyXG4gICAgdGhpcy5fbGFzdCA9IHsgX25leHQ6IG51bGwsIF9wYXJlbnQ6IHRoaXMgfTtcclxuICAgIHRoaXMuX2NvdW50ID0gMDtcclxuICAgIFxyXG4gICAgdGhpcy5fbGFzdC5fcHJldiA9IHRoaXMuX2ZpcnN0O1xyXG4gICAgdGhpcy5fZmlyc3QuX25leHQgPSB0aGlzLl9sYXN0O1xyXG59XHJcblxyXG5MaW5rZWRMaXN0LnByb3RvdHlwZS5hZGQgPSBmdW5jdGlvbiBhZGQodmFsdWUsIGFkZEJlZm9yZSkge1xyXG4gICAgaWYgKGFkZEJlZm9yZSA9PT0gbnVsbCB8fCBhZGRCZWZvcmUgPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIGFkZEJlZm9yZSA9IHRoaXMuX2xhc3Q7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHRoaXMuX3ZhbGlkYXRlSXRlcmF0b3JPZlRoaXMoYWRkQmVmb3JlKTtcclxuICAgIFxyXG4gICAgKyt0aGlzLl9jb3VudDtcclxuICAgIFxyXG4gICAgdmFyIG5ld05vZGUgPSB7XHJcbiAgICAgICAgX3ZhbHVlOiB2YWx1ZSxcclxuICAgICAgICBfbmV4dDogYWRkQmVmb3JlLFxyXG4gICAgICAgIF9wcmV2OiBhZGRCZWZvcmUuX3ByZXYsXHJcbiAgICAgICAgX3BhcmVudDogdGhpc1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgbmV3Tm9kZS5fcHJldi5fbmV4dCA9IG5ld05vZGU7XHJcbiAgICBhZGRCZWZvcmUuX3ByZXYgPSBuZXdOb2RlO1xyXG4gICAgXHJcbiAgICByZXR1cm4gbmV3Tm9kZTtcclxufTtcclxuXHJcbkxpbmtlZExpc3QucHJvdG90eXBlLnJlbW92ZSA9IGZ1bmN0aW9uIHJlbW92ZShpdGVyYXRvcikge1xyXG4gICAgdGhpcy5fdmFsaWRhdGVJdGVyYXRvck9mVGhpcyhpdGVyYXRvcik7XHJcbiAgICBcclxuICAgIC0tdGhpcy5fY291bnQ7XHJcbiAgICBcclxuICAgIGl0ZXJhdG9yLl9wcmV2Ll9uZXh0ID0gaXRlcmF0b3IuX25leHQ7XHJcbiAgICBpdGVyYXRvci5fbmV4dC5fcHJldiA9IGl0ZXJhdG9yLl9wcmV2O1xyXG4gICAgaXRlcmF0b3IuX3BhcmVudCA9IG51bGw7XHJcbn07XHJcblxyXG5MaW5rZWRMaXN0LnByb3RvdHlwZS5nZXRWYWx1ZSA9IGZ1bmN0aW9uIGdldFZhbHVlKGl0ZXJhdG9yKSB7XHJcbiAgICB0aGlzLl92YWxpZGF0ZUl0ZXJhdG9yT2ZUaGlzKGl0ZXJhdG9yKTtcclxuICAgIFxyXG4gICAgcmV0dXJuIGl0ZXJhdG9yLl92YWx1ZTtcclxufTtcclxuXHJcbkxpbmtlZExpc3QucHJvdG90eXBlLmdldEZpcnN0SXRlcmF0b3IgPSBmdW5jdGlvbiBnZXRGaXJzdEl0ZXJhdG9yKCkge1xyXG4gICAgdmFyIGl0ZXJhdG9yID0gdGhpcy5nZXROZXh0SXRlcmF0b3IodGhpcy5fZmlyc3QpO1xyXG4gICAgcmV0dXJuIGl0ZXJhdG9yO1xyXG59O1xyXG5cclxuTGlua2VkTGlzdC5wcm90b3R5cGUuZ2V0TGFzdEl0ZXJhdG9yID0gZnVuY3Rpb24gZ2V0Rmlyc3RJdGVyYXRvcigpIHtcclxuICAgIHZhciBpdGVyYXRvciA9IHRoaXMuZ2V0UHJldkl0ZXJhdG9yKHRoaXMuX2xhc3QpO1xyXG4gICAgcmV0dXJuIGl0ZXJhdG9yO1xyXG59O1xyXG5cclxuTGlua2VkTGlzdC5wcm90b3R5cGUuZ2V0TmV4dEl0ZXJhdG9yID0gZnVuY3Rpb24gZ2V0TmV4dEl0ZXJhdG9yKGl0ZXJhdG9yKSB7XHJcbiAgICB0aGlzLl92YWxpZGF0ZUl0ZXJhdG9yT2ZUaGlzKGl0ZXJhdG9yKTtcclxuXHJcbiAgICBpZiAoaXRlcmF0b3IuX25leHQgPT09IHRoaXMuX2xhc3QpIHtcclxuICAgICAgICByZXR1cm4gbnVsbDtcclxuICAgIH1cclxuICAgIFxyXG4gICAgcmV0dXJuIGl0ZXJhdG9yLl9uZXh0O1xyXG59O1xyXG5cclxuTGlua2VkTGlzdC5wcm90b3R5cGUuZ2V0UHJldkl0ZXJhdG9yID0gZnVuY3Rpb24gZ2V0UHJldkl0ZXJhdG9yKGl0ZXJhdG9yKSB7XHJcbiAgICB0aGlzLl92YWxpZGF0ZUl0ZXJhdG9yT2ZUaGlzKGl0ZXJhdG9yKTtcclxuXHJcbiAgICBpZiAoaXRlcmF0b3IuX3ByZXYgPT09IHRoaXMuX2ZpcnN0KSB7XHJcbiAgICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHJldHVybiBpdGVyYXRvci5fcHJldjtcclxufTtcclxuXHJcbkxpbmtlZExpc3QucHJvdG90eXBlLmdldENvdW50ID0gZnVuY3Rpb24gZ2V0Q291bnQoKSB7XHJcbiAgICByZXR1cm4gdGhpcy5fY291bnQ7XHJcbn07XHJcblxyXG5MaW5rZWRMaXN0LnByb3RvdHlwZS5fdmFsaWRhdGVJdGVyYXRvck9mVGhpcyA9XHJcbiAgICBmdW5jdGlvbiB2YWxpZGF0ZUl0ZXJhdG9yT2ZUaGlzKGl0ZXJhdG9yKSB7XHJcbiAgICBcclxuICAgIGlmIChpdGVyYXRvci5fcGFyZW50ICE9PSB0aGlzKSB7XHJcbiAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogaXRlcmF0b3IgbXVzdCBiZSBvZiB0aGUgY3VycmVudCBMaW5rZWRMaXN0JztcclxuICAgIH1cclxufTsiLCIndXNlIHN0cmljdCc7XHJcblxyXG52YXIgRmV0Y2hDb250ZXh0QXBpID0gcmVxdWlyZSgnZmV0Y2gtY29udGV4dC1hcGkuanMnKTtcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gU2ltcGxlTW92YWJsZUZldGNoO1xyXG5cclxudmFyIEZFVENIX1NUQVRFX1dBSVRfRk9SX01PVkUgPSAxO1xyXG52YXIgRkVUQ0hfU1RBVEVfQUNUSVZFID0gMjtcclxudmFyIEZFVENIX1NUQVRFX1NUT1BQSU5HID0gMztcclxudmFyIEZFVENIX1NUQVRFX1NUT1BQRUQgPSA0O1xyXG52YXIgRkVUQ0hfU1RBVEVfVEVSTUlOQVRFRCA9IDU7XHJcblxyXG5mdW5jdGlvbiBTaW1wbGVNb3ZhYmxlRmV0Y2goZmV0Y2hlciwgaW5kaXJlY3RDbG9zZUluZGljYXRpb24sIGZldGNoQ29udGV4dCwgbWF4QWN0aXZlRmV0Y2hlc0luTW92YWJsZUZldGNoKSB7XHJcblx0dGhpcy5fZmV0Y2hlciA9IGZldGNoZXI7XHJcblx0dGhpcy5faW5kaXJlY3RDbG9zZUluZGljYXRpb24gPSBpbmRpcmVjdENsb3NlSW5kaWNhdGlvbjtcclxuXHR0aGlzLl9tb3ZhYmxlRmV0Y2hDb250ZXh0ID0gZmV0Y2hDb250ZXh0O1xyXG5cdHRoaXMuX21heEFjdGl2ZUZldGNoZXNJbk1vdmFibGVGZXRjaCA9IG1heEFjdGl2ZUZldGNoZXNJbk1vdmFibGVGZXRjaDtcclxuXHRcclxuXHR0aGlzLl9sYXN0RmV0Y2ggPSBudWxsO1xyXG5cdHRoaXMuX2FjdGl2ZUZldGNoZXNJbk1vdmFibGVGZXRjaCA9IDA7XHJcblx0dGhpcy5fcGVuZGluZ0ltYWdlUGFydFBhcmFtcyA9IG51bGw7XHJcblx0dGhpcy5fbW92YWJsZVN0YXRlID0gRkVUQ0hfU1RBVEVfV0FJVF9GT1JfTU9WRTtcclxuXHRcclxuXHR0aGlzLl9pc1Byb2dyZXNzaXZlID0gZmFsc2U7XHJcblx0dGhpcy5faXNQcm9ncmVzc2l2ZUNoYW5nZWRDYWxsZWQgPSBmYWxzZTtcclxuXHRcclxuXHRmZXRjaENvbnRleHQub24oJ21vdmUnLCB0aGlzLl9vbk1vdmUsIHRoaXMpO1xyXG5cdGZldGNoQ29udGV4dC5vbigndGVybWluYXRlJywgdGhpcy5fb25UZXJtaW5hdGVkLCB0aGlzKTtcclxuXHRmZXRjaENvbnRleHQub24oJ2lzUHJvZ3Jlc3NpdmVDaGFuZ2VkJywgdGhpcy5fb25Jc1Byb2dyZXNzaXZlQ2hhbmdlZCwgdGhpcyk7XHJcblx0ZmV0Y2hDb250ZXh0Lm9uKCdzdG9wJywgdGhpcy5fb25TdG9wLCB0aGlzKTtcclxuXHRmZXRjaENvbnRleHQub24oJ3Jlc3VtZScsIHRoaXMuX29uUmVzdW1lLCB0aGlzKTtcclxufVxyXG5cclxuU2ltcGxlTW92YWJsZUZldGNoLnByb3RvdHlwZS5zdGFydCA9IGZ1bmN0aW9uIHN0YXJ0KGltYWdlUGFydFBhcmFtcykge1xyXG5cdHRoaXMuX29uTW92ZShpbWFnZVBhcnRQYXJhbXMpO1xyXG59O1xyXG5cclxuU2ltcGxlTW92YWJsZUZldGNoLnByb3RvdHlwZS5fb25Jc1Byb2dyZXNzaXZlQ2hhbmdlZCA9IGZ1bmN0aW9uIGlzUHJvZ3Jlc3NpdmVDaGFuZ2VkKGlzUHJvZ3Jlc3NpdmUpIHtcclxuXHR0aGlzLl9pc1Byb2dyZXNzaXZlID0gaXNQcm9ncmVzc2l2ZTtcclxuXHR2YXIgbGFzdEFjdGl2ZUZldGNoID0gdGhpcy5fZ2V0TGFzdEZldGNoQWN0aXZlKCk7XHJcblx0aWYgKGxhc3RBY3RpdmVGZXRjaCAhPT0gbnVsbCkge1xyXG5cdFx0bGFzdEFjdGl2ZUZldGNoLl9vbkV2ZW50KCdpc1Byb2dyZXNzaXZlQ2hhbmdlZCcsIGlzUHJvZ3Jlc3NpdmUpO1xyXG5cdH0gZWxzZSB7XHJcblx0XHR0aGlzLl9pc1Byb2dyZXNzaXZlQ2hhbmdlZENhbGxlZCA9IHRydWU7XHJcblx0fVxyXG59O1xyXG5cclxuU2ltcGxlTW92YWJsZUZldGNoLnByb3RvdHlwZS5fb25TdG9wID0gZnVuY3Rpb24gc3RvcChpc0Fib3J0ZWQpIHtcclxuXHR0aGlzLl9zd2l0Y2hTdGF0ZShGRVRDSF9TVEFURV9TVE9QUElORywgRkVUQ0hfU1RBVEVfQUNUSVZFKTtcclxuXHR2YXIgbGFzdEFjdGl2ZUZldGNoID0gdGhpcy5fZ2V0TGFzdEZldGNoQWN0aXZlKCk7XHJcblx0aWYgKGxhc3RBY3RpdmVGZXRjaCAhPT0gbnVsbCkge1xyXG5cdFx0bGFzdEFjdGl2ZUZldGNoLl9vbkV2ZW50KCdzdG9wJywgaXNBYm9ydGVkKTtcclxuXHR9XHJcbn07XHJcblxyXG5TaW1wbGVNb3ZhYmxlRmV0Y2gucHJvdG90eXBlLl9vblJlc3VtZSA9IGZ1bmN0aW9uIHJlc3VtZSgpIHtcclxuXHR0aGlzLl9zd2l0Y2hTdGF0ZShGRVRDSF9TVEFURV9BQ1RJVkUsIEZFVENIX1NUQVRFX1NUT1BQRUQsIEZFVENIX1NUQVRFX1NUT1BQSU5HKTtcclxuXHJcblx0aWYgKHRoaXMuX2xhc3RGZXRjaCA9PT0gbnVsbCkge1xyXG5cdFx0dGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogcmVzdW1pbmcgbm9uIHN0b3BwZWQgZmV0Y2gnO1xyXG5cdH1cclxuXHRcclxuXHRpZiAodGhpcy5faXNQcm9ncmVzc2l2ZUNoYW5nZWRDYWxsZWQpIHtcclxuXHRcdHRoaXMuX2lzUHJvZ3Jlc3NpdmVDaGFuZ2VkQ2FsbGVkID0gZmFsc2U7XHJcblx0XHR0aGlzLl9sYXN0RmV0Y2guX29uRXZlbnQoJ2lzUHJvZ3Jlc3NpdmVDaGFuZ2VkJywgdGhpcy5faXNQcm9ncmVzc2l2ZSk7XHJcblx0fVxyXG5cdHRoaXMuX2xhc3RGZXRjaC5fb25FdmVudCgncmVzdW1lJyk7XHJcbn07XHJcblxyXG5TaW1wbGVNb3ZhYmxlRmV0Y2gucHJvdG90eXBlLl9vblRlcm1pbmF0ZWQgPSBmdW5jdGlvbiBvblRlcm1pbmF0ZWQoaXNBYm9ydGVkKSB7XHJcblx0dGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogVW5leHBlY3RlZCB0ZXJtaW5hdGlvbiBvZiBtb3ZhYmxlIGZldGNoJztcclxufTtcclxuXHJcblNpbXBsZU1vdmFibGVGZXRjaC5wcm90b3R5cGUuX29uTW92ZSA9IGZ1bmN0aW9uIG1vdmUoaW1hZ2VQYXJ0UGFyYW1zKSB7XHJcblx0dGhpcy5fcGVuZGluZ0ltYWdlUGFydFBhcmFtcyA9IGltYWdlUGFydFBhcmFtcztcclxuXHR0aGlzLl9tb3ZhYmxlU3RhdGUgPSBGRVRDSF9TVEFURV9BQ1RJVkU7XHJcblx0dGhpcy5fdHJ5U3RhcnRQZW5kaW5nRmV0Y2goKTtcclxufTtcclxuXHJcblNpbXBsZU1vdmFibGVGZXRjaC5wcm90b3R5cGUuX3RyeVN0YXJ0UGVuZGluZ0ZldGNoID0gZnVuY3Rpb24gdHJ5U3RhcnRQZW5kaW5nRmV0Y2goKSB7XHJcblx0aWYgKHRoaXMuX2luZGlyZWN0Q2xvc2VJbmRpY2F0aW9uLmlzQ2xvc2VSZXF1ZXN0ZWQgfHxcclxuXHRcdHRoaXMuX2FjdGl2ZUZldGNoZXNJbk1vdmFibGVGZXRjaCA+PSB0aGlzLl9tYXhBY3RpdmVGZXRjaGVzSW5Nb3ZhYmxlRmV0Y2ggfHxcclxuXHRcdHRoaXMuX3BlbmRpbmdJbWFnZVBhcnRQYXJhbXMgPT09IG51bGwgfHxcclxuXHRcdHRoaXMuX21vdmFibGVTdGF0ZSAhPT0gRkVUQ0hfU1RBVEVfQUNUSVZFKSB7XHJcblxyXG5cdFx0XHRyZXR1cm47XHJcblx0fVxyXG5cdFxyXG5cdHZhciBuZXdGZXRjaCA9IHtcclxuXHRcdGltYWdlUGFydFBhcmFtczogdGhpcy5fcGVuZGluZ0ltYWdlUGFydFBhcmFtcyxcclxuXHRcdHN0YXRlOiBGRVRDSF9TVEFURV9BQ1RJVkUsXHJcblxyXG5cdFx0ZmV0Y2hDb250ZXh0OiBudWxsLFxyXG5cdFx0c2VsZjogdGhpc1xyXG5cdH07XHJcblx0XHJcblx0dGhpcy5fcGVuZGluZ0ltYWdlUGFydFBhcmFtcyA9IG51bGw7XHJcblx0Kyt0aGlzLl9hY3RpdmVGZXRjaGVzSW5Nb3ZhYmxlRmV0Y2g7XHJcblx0XHJcblx0bmV3RmV0Y2guZmV0Y2hDb250ZXh0ID0gbmV3IEZldGNoQ29udGV4dEFwaSgpO1xyXG5cdG5ld0ZldGNoLmZldGNoQ29udGV4dC5vbignaW50ZXJuYWxTdG9wcGVkJywgb25TaW5nbGVGZXRjaFN0b3BwZWQsIG5ld0ZldGNoKTtcclxuXHRuZXdGZXRjaC5mZXRjaENvbnRleHQub24oJ2ludGVybmFsRG9uZScsIG9uU2luZ2xlRmV0Y2hEb25lLCBuZXdGZXRjaCk7XHJcbiAgICBcclxuICAgIHRoaXMuX2ZldGNoZXIuc3RhcnRGZXRjaChuZXdGZXRjaC5mZXRjaENvbnRleHQsIG5ld0ZldGNoLmltYWdlUGFydFBhcmFtcyk7XHJcbn07XHJcblxyXG5TaW1wbGVNb3ZhYmxlRmV0Y2gucHJvdG90eXBlLl9zaW5nbGVGZXRjaFN0b3BwZWQgPSBmdW5jdGlvbiBzaW5nbGVGZXRjaFN0b3BwZWQoZmV0Y2gsIGlzRG9uZSkge1xyXG5cdC0tdGhpcy5fYWN0aXZlRmV0Y2hlc0luTW92YWJsZUZldGNoO1xyXG5cdHRoaXMuX2xhc3RGZXRjaCA9IG51bGw7XHJcblx0ZmV0Y2guc3RhdGUgPSBGRVRDSF9TVEFURV9URVJNSU5BVEVEO1xyXG59O1xyXG5cclxuU2ltcGxlTW92YWJsZUZldGNoLnByb3RvdHlwZS5fZ2V0TGFzdEZldGNoQWN0aXZlID0gZnVuY3Rpb24gZ2V0TGFzdEZldGNoQWN0aXZlKCkge1xyXG5cdGlmICh0aGlzLl9tb3ZhYmxlU3RhdGUgPT09IEZFVENIX1NUQVRFX1NUT1BQRUQgfHwgdGhpcy5fbGFzdEZldGNoID09PSBudWxsKSB7XHJcblx0XHRyZXR1cm4gbnVsbDtcclxuXHR9XHJcblx0XHJcblx0aWYgKHRoaXMuX2xhc3RGZXRjaC5zdGF0ZSA9PT0gRkVUQ0hfU1RBVEVfQUNUSVZFKSB7XHJcblx0XHRyZXR1cm4gdGhpcy5fbGFzdEZldGNoLmZldGNoQ29udGV4dDtcclxuXHR9XHJcblx0cmV0dXJuIG51bGw7XHJcbn07XHJcblxyXG5TaW1wbGVNb3ZhYmxlRmV0Y2gucHJvdG90eXBlLl9zd2l0Y2hTdGF0ZSA9IGZ1bmN0aW9uIHN3aXRjaFN0YXRlKHRhcmdldFN0YXRlLCBleHBlY3RlZFN0YXRlLCBleHBlY3RlZFN0YXRlMiwgZXhwZWN0ZWRTdGF0ZTMpIHtcclxuXHRpZiAodGhpcy5fbW92YWJsZVN0YXRlICE9PSBleHBlY3RlZFN0YXRlICYmIHRoaXMuX21vdmFibGVTdGF0ZSAhPT0gZXhwZWN0ZWRTdGF0ZTIgJiYgdGhpcy5fbW92YWJsZVN0YXRlICE9PSBleHBlY3RlZFN0YXRlMykge1xyXG5cdFx0dGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogVW5leHBlY3RlZCBzdGF0ZSAnICsgdGhpcy5fbW92YWJsZVN0YXRlICsgJywgZXhwZWN0ZWQgJyArIGV4cGVjdGVkU3RhdGUgKyAnIG9yICcgKyBleHBlY3RlZFN0YXRlMiArICcgb3IgJyArIGV4cGVjdGVkU3RhdGUzO1xyXG5cdH1cclxuXHR0aGlzLl9tb3ZhYmxlU3RhdGUgPSB0YXJnZXRTdGF0ZTtcclxufTtcclxuXHJcblNpbXBsZU1vdmFibGVGZXRjaC5wcm90b3R5cGUuX2lzTGFzdEZldGNoID0gZnVuY3Rpb24gaXNMYXN0RmV0Y2goZmV0Y2gpIHtcclxuXHRyZXR1cm4gdGhpcy5fbGFzdEZldGNoID09PSBmZXRjaCAmJiB0aGlzLl9wZW5kaW5nSW1hZ2VQYXJ0UGFyYW1zID09PSBudWxsO1xyXG59O1xyXG5cclxuZnVuY3Rpb24gb25TaW5nbGVGZXRjaFN0b3BwZWQoKSB7XHJcblx0LyoganNoaW50IHZhbGlkdGhpczogdHJ1ZSAqL1xyXG5cdHZhciBmZXRjaCA9IHRoaXM7XHJcblx0dmFyIG1vdmFibGVGZXRjaCA9IGZldGNoLnNlbGY7XHJcblx0XHJcblx0aWYgKGZldGNoLnN0YXRlICE9PSBGRVRDSF9TVEFURV9TVE9QUElORykge1xyXG5cdFx0dGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogVW5leHBlY3RlZCBzdGF0ZSBvZiBmZXRjaCAnICsgZmV0Y2guc3RhdGUgKyAnIG9uIHN0b3BwZWQnO1xyXG5cdH1cclxuXHRcclxuXHRpZiAobW92YWJsZUZldGNoLl9pc0xhc3RGZXRjaChmZXRjaCkpIHtcclxuXHRcdGZldGNoLnN0YXRlID0gRkVUQ0hfU1RBVEVfU1RPUFBFRDtcclxuXHRcdG1vdmFibGVGZXRjaC5fc3dpdGNoU3RhdGUoRkVUQ0hfU1RBVEVfU1RPUFBFRCwgRkVUQ0hfU1RBVEVfU1RPUFBJTkcpO1xyXG5cdFx0bW92YWJsZUZldGNoLl9tb3ZhYmxlRmV0Y2hDb250ZXh0LnN0b3BwZWQoKTtcclxuXHR9IGVsc2Uge1xyXG5cdFx0bW92YWJsZUZldGNoLl9zaW5nbGVGZXRjaFN0b3BwZWQoZmV0Y2gpO1xyXG5cdH1cclxuXHJcblx0bW92YWJsZUZldGNoLl90cnlTdGFydFBlbmRpbmdGZXRjaCgpO1xyXG59XHJcblxyXG5mdW5jdGlvbiBvblNpbmdsZUZldGNoRG9uZSgpIHtcclxuXHQvKiBqc2hpbnQgdmFsaWR0aGlzOiB0cnVlICovXHJcblx0dmFyIGZldGNoID0gdGhpcztcclxuXHR2YXIgbW92YWJsZUZldGNoID0gZmV0Y2guc2VsZjtcclxuXHJcblx0aWYgKGZldGNoLnN0YXRlICE9PSBGRVRDSF9TVEFURV9BQ1RJVkUgJiYgZmV0Y2guc3RhdGUgIT09IEZFVENIX1NUQVRFX1NUT1BQSU5HKSB7XHJcblx0XHR0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBVbmV4cGVjdGVkIHN0YXRlIG9mIGZldGNoICcgKyBmZXRjaC5zdGF0ZSArICcgb24gZG9uZSc7XHJcblx0fVxyXG5cclxuXHRmZXRjaC5zdGF0ZSA9IEZFVENIX1NUQVRFX1RFUk1JTkFURUQ7XHJcblx0aWYgKG1vdmFibGVGZXRjaC5faXNMYXN0RmV0Y2goZmV0Y2gpKSB7XHJcblx0XHRtb3ZhYmxlRmV0Y2guX3N3aXRjaFN0YXRlKEZFVENIX1NUQVRFX1dBSVRfRk9SX01PVkUsIEZFVENIX1NUQVRFX0FDVElWRSwgRkVUQ0hfU1RBVEVfU1RPUFBJTkcpO1xyXG5cdFx0bW92YWJsZUZldGNoLl9tb3ZhYmxlRmV0Y2hDb250ZXh0LmRvbmUoKTtcclxuXHR9XHJcblx0bW92YWJsZUZldGNoLl9zaW5nbGVGZXRjaFN0b3BwZWQoZmV0Y2gpO1xyXG59IiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBJbWFnZURlY29kZXJWaWV3ZXI7XHJcblxyXG52YXIgaW1hZ2VIZWxwZXJGdW5jdGlvbnMgPSByZXF1aXJlKCdpbWFnZS1oZWxwZXItZnVuY3Rpb25zLmpzJyk7XHJcblxyXG52YXIgUEVORElOR19DQUxMX1RZUEVfUElYRUxTX1VQREFURUQgPSAxO1xyXG52YXIgUEVORElOR19DQUxMX1RZUEVfUkVQT1NJVElPTiA9IDI7XHJcblxyXG52YXIgUkVHSU9OX09WRVJWSUVXID0gMDtcclxudmFyIFJFR0lPTl9EWU5BTUlDID0gMTtcclxuXHJcbmZ1bmN0aW9uIEltYWdlRGVjb2RlclZpZXdlcihpbWFnZURlY29kZXIsIGNhbnZhc1VwZGF0ZWRDYWxsYmFjaywgb3B0aW9ucykge1xyXG4gICAgdGhpcy5fY2FudmFzVXBkYXRlZENhbGxiYWNrID0gY2FudmFzVXBkYXRlZENhbGxiYWNrO1xyXG4gICAgXHJcbiAgICB0aGlzLl9hZGFwdFByb3BvcnRpb25zID0gb3B0aW9ucy5hZGFwdFByb3BvcnRpb25zO1xyXG4gICAgdGhpcy5fY2FydG9ncmFwaGljQm91bmRzID0gb3B0aW9ucy5jYXJ0b2dyYXBoaWNCb3VuZHM7XHJcbiAgICB0aGlzLl9hbGxvd011bHRpcGxlTW92YWJsZUZldGNoZXNJblNlc3Npb24gPVxyXG4gICAgICAgIG9wdGlvbnMuYWxsb3dNdWx0aXBsZU1vdmFibGVGZXRjaGVzSW5TZXNzaW9uO1xyXG4gICAgdGhpcy5fbWluRnVuY3Rpb25DYWxsSW50ZXJ2YWxNaWxsaXNlY29uZHMgPVxyXG4gICAgICAgIG9wdGlvbnMubWluRnVuY3Rpb25DYWxsSW50ZXJ2YWxNaWxsaXNlY29uZHM7XHJcbiAgICB0aGlzLl9vdmVydmlld1Jlc29sdXRpb25YID0gb3B0aW9ucy5vdmVydmlld1Jlc29sdXRpb25YIHx8IDEwMDtcclxuICAgIHRoaXMuX292ZXJ2aWV3UmVzb2x1dGlvblkgPSBvcHRpb25zLm92ZXJ2aWV3UmVzb2x1dGlvblkgfHwgMTAwO1xyXG4gICAgICAgIFxyXG4gICAgdGhpcy5fbGFzdFJlcXVlc3RJbmRleCA9IDA7XHJcbiAgICB0aGlzLl9wZW5kaW5nVXBkYXRlVmlld0FyZWEgPSBudWxsO1xyXG4gICAgdGhpcy5fcmVnaW9ucyA9IFtdO1xyXG4gICAgdGhpcy5fdGFyZ2V0Q2FudmFzID0gbnVsbDtcclxuICAgIFxyXG4gICAgdGhpcy5fY2FsbFBlbmRpbmdDYWxsYmFja3NCb3VuZCA9IHRoaXMuX2NhbGxQZW5kaW5nQ2FsbGJhY2tzLmJpbmQodGhpcyk7XHJcbiAgICB0aGlzLl9jcmVhdGVkTW92YWJsZUZldGNoQm91bmQgPSB0aGlzLl9jcmVhdGVkTW92YWJsZUZldGNoLmJpbmQodGhpcyk7XHJcbiAgICBcclxuICAgIHRoaXMuX3BlbmRpbmdDYWxsYmFja3NJbnRlcnZhbEhhbmRsZSA9IDA7XHJcbiAgICB0aGlzLl9wZW5kaW5nQ2FsbGJhY2tDYWxscyA9IFtdO1xyXG4gICAgdGhpcy5fY2FuU2hvd0R5bmFtaWNSZWdpb24gPSBmYWxzZTtcclxuICAgIFxyXG4gICAgaWYgKHRoaXMuX2NhcnRvZ3JhcGhpY0JvdW5kcyA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgdGhpcy5fY2FydG9ncmFwaGljQm91bmRzID0ge1xyXG4gICAgICAgICAgICB3ZXN0OiAtMTc1LjAsXHJcbiAgICAgICAgICAgIGVhc3Q6IDE3NS4wLFxyXG4gICAgICAgICAgICBzb3V0aDogLTg1LjAsXHJcbiAgICAgICAgICAgIG5vcnRoOiA4NS4wXHJcbiAgICAgICAgfTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgaWYgKHRoaXMuX2FkYXB0UHJvcG9ydGlvbnMgPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIHRoaXMuX2FkYXB0UHJvcG9ydGlvbnMgPSB0cnVlO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICB0aGlzLl9pbWFnZURlY29kZXIgPSBpbWFnZURlY29kZXI7XHJcblx0aW1hZ2VEZWNvZGVyLnNldERlY29kZVByaW9yaXRpemVyVHlwZSgnZnJ1c3R1bU9ubHknKTtcclxuXHRpbWFnZURlY29kZXIuc2V0RmV0Y2hQcmlvcml0aXplclR5cGUoJ2ZydXN0dW1Pbmx5Jyk7XHJcbn1cclxuXHJcbkltYWdlRGVjb2RlclZpZXdlci5wcm90b3R5cGUuc2V0RXhjZXB0aW9uQ2FsbGJhY2sgPSBmdW5jdGlvbiBzZXRFeGNlcHRpb25DYWxsYmFjayhleGNlcHRpb25DYWxsYmFjaykge1xyXG4gICAgLy8gVE9ETzogU3VwcG9ydCBleGNlcHRpb25DYWxsYmFjayBpbiBldmVyeSBwbGFjZSBuZWVkZWRcclxuXHR0aGlzLl9leGNlcHRpb25DYWxsYmFjayA9IGV4Y2VwdGlvbkNhbGxiYWNrO1xyXG59O1xyXG4gICAgXHJcbkltYWdlRGVjb2RlclZpZXdlci5wcm90b3R5cGUub3BlbiA9IGZ1bmN0aW9uIG9wZW4odXJsKSB7XHJcbiAgICByZXR1cm4gdGhpcy5faW1hZ2VEZWNvZGVyLm9wZW4odXJsKVxyXG4gICAgICAgIC50aGVuKHRoaXMuX29wZW5lZC5iaW5kKHRoaXMpKVxyXG4gICAgICAgIC5jYXRjaCh0aGlzLl9leGNlcHRpb25DYWxsYmFjayk7XHJcbn07XHJcblxyXG5JbWFnZURlY29kZXJWaWV3ZXIucHJvdG90eXBlLmNsb3NlID0gZnVuY3Rpb24gY2xvc2UoKSB7XHJcbiAgICB2YXIgcHJvbWlzZSA9IHRoaXMuX2ltYWdlRGVjb2Rlci5jbG9zZSgpO1xyXG4gICAgcHJvbWlzZS5jYXRjaCh0aGlzLl9leGNlcHRpb25DYWxsYmFjayk7XHJcbiAgICB0aGlzLl9pc1JlYWR5ID0gZmFsc2U7XHJcbiAgICB0aGlzLl9jYW5TaG93RHluYW1pY1JlZ2lvbiA9IGZhbHNlO1xyXG4gICAgdGhpcy5fdGFyZ2V0Q2FudmFzID0gbnVsbDtcclxuXHRyZXR1cm4gcHJvbWlzZTtcclxufTtcclxuXHJcbkltYWdlRGVjb2RlclZpZXdlci5wcm90b3R5cGUuc2V0VGFyZ2V0Q2FudmFzID0gZnVuY3Rpb24gc2V0VGFyZ2V0Q2FudmFzKGNhbnZhcykge1xyXG4gICAgdGhpcy5fdGFyZ2V0Q2FudmFzID0gY2FudmFzO1xyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVyVmlld2VyLnByb3RvdHlwZS51cGRhdGVWaWV3QXJlYSA9IGZ1bmN0aW9uIHVwZGF0ZVZpZXdBcmVhKGZydXN0dW1EYXRhKSB7XHJcbiAgICBpZiAodGhpcy5fdGFyZ2V0Q2FudmFzID09PSBudWxsKSB7XHJcbiAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogQ2Fubm90IHVwZGF0ZSBkeW5hbWljIHJlZ2lvbiBiZWZvcmUgc2V0VGFyZ2V0Q2FudmFzKCknO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBpZiAoIXRoaXMuX2NhblNob3dEeW5hbWljUmVnaW9uKSB7XHJcbiAgICAgICAgdGhpcy5fcGVuZGluZ1VwZGF0ZVZpZXdBcmVhID0gZnJ1c3R1bURhdGE7XHJcbiAgICAgICAgXHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICB2YXIgYm91bmRzID0gZnJ1c3R1bURhdGEucmVjdGFuZ2xlO1xyXG4gICAgdmFyIHNjcmVlblNpemUgPSBmcnVzdHVtRGF0YS5zY3JlZW5TaXplO1xyXG4gICAgXHJcbiAgICB2YXIgcmVnaW9uUGFyYW1zID0ge1xyXG4gICAgICAgIG1pblg6IGJvdW5kcy53ZXN0ICogdGhpcy5fc2NhbGVYICsgdGhpcy5fdHJhbnNsYXRlWCxcclxuICAgICAgICBtaW5ZOiBib3VuZHMubm9ydGggKiB0aGlzLl9zY2FsZVkgKyB0aGlzLl90cmFuc2xhdGVZLFxyXG4gICAgICAgIG1heFhFeGNsdXNpdmU6IGJvdW5kcy5lYXN0ICogdGhpcy5fc2NhbGVYICsgdGhpcy5fdHJhbnNsYXRlWCxcclxuICAgICAgICBtYXhZRXhjbHVzaXZlOiBib3VuZHMuc291dGggKiB0aGlzLl9zY2FsZVkgKyB0aGlzLl90cmFuc2xhdGVZLFxyXG4gICAgICAgIHNjcmVlbldpZHRoOiBzY3JlZW5TaXplLngsXHJcbiAgICAgICAgc2NyZWVuSGVpZ2h0OiBzY3JlZW5TaXplLnlcclxuICAgIH07XHJcbiAgICBcclxuICAgIHZhciBhbGlnbmVkUGFyYW1zID1cclxuICAgICAgICBpbWFnZUhlbHBlckZ1bmN0aW9ucy5hbGlnblBhcmFtc1RvVGlsZXNBbmRMZXZlbChcclxuICAgICAgICAgICAgcmVnaW9uUGFyYW1zLCB0aGlzLl9pbWFnZURlY29kZXIpO1xyXG4gICAgXHJcbiAgICB2YXIgaXNPdXRzaWRlU2NyZWVuID0gYWxpZ25lZFBhcmFtcyA9PT0gbnVsbDtcclxuICAgIGlmIChpc091dHNpZGVTY3JlZW4pIHtcclxuICAgICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGFsaWduZWRQYXJhbXMuaW1hZ2VQYXJ0UGFyYW1zLnF1YWxpdHkgPSB0aGlzLl9xdWFsaXR5O1xyXG5cclxuICAgIHZhciBpc1NhbWVSZWdpb24gPVxyXG4gICAgICAgIHRoaXMuX2R5bmFtaWNGZXRjaFBhcmFtcyAhPT0gdW5kZWZpbmVkICYmXHJcbiAgICAgICAgdGhpcy5faXNJbWFnZVBhcnRzRXF1YWwoXHJcbiAgICAgICAgICAgIGFsaWduZWRQYXJhbXMuaW1hZ2VQYXJ0UGFyYW1zLFxyXG4gICAgICAgICAgICB0aGlzLl9keW5hbWljRmV0Y2hQYXJhbXMuaW1hZ2VQYXJ0UGFyYW1zKTtcclxuICAgIFxyXG4gICAgaWYgKGlzU2FtZVJlZ2lvbikge1xyXG4gICAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIFxyXG4gICAgZnJ1c3R1bURhdGEuaW1hZ2VSZWN0YW5nbGUgPSB0aGlzLl9jYXJ0b2dyYXBoaWNCb3VuZHNGaXhlZDtcclxuICAgIGZydXN0dW1EYXRhLmV4YWN0bGV2ZWwgPVxyXG4gICAgICAgIGFsaWduZWRQYXJhbXMuaW1hZ2VQYXJ0UGFyYW1zLmxldmVsO1xyXG4gICAgXHJcbiAgICB0aGlzLl9pbWFnZURlY29kZXIuc2V0RGVjb2RlUHJpb3JpdGl6ZXJEYXRhKGZydXN0dW1EYXRhKTtcclxuICAgIHRoaXMuX2ltYWdlRGVjb2Rlci5zZXRGZXRjaFByaW9yaXRpemVyRGF0YShmcnVzdHVtRGF0YSk7XHJcblxyXG4gICAgdGhpcy5fZHluYW1pY0ZldGNoUGFyYW1zID0gYWxpZ25lZFBhcmFtcztcclxuICAgIFxyXG4gICAgdmFyIHN0YXJ0RHluYW1pY1JlZ2lvbk9uVGVybWluYXRpb24gPSBmYWxzZTtcclxuICAgIHZhciBtb3ZlRXhpc3RpbmdGZXRjaCA9ICF0aGlzLl9hbGxvd011bHRpcGxlTW92YWJsZUZldGNoZXNJblNlc3Npb247XHJcbiAgICB0aGlzLl9mZXRjaChcclxuICAgICAgICBSRUdJT05fRFlOQU1JQyxcclxuICAgICAgICBhbGlnbmVkUGFyYW1zLFxyXG4gICAgICAgIHN0YXJ0RHluYW1pY1JlZ2lvbk9uVGVybWluYXRpb24sXHJcbiAgICAgICAgbW92ZUV4aXN0aW5nRmV0Y2gpO1xyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVyVmlld2VyLnByb3RvdHlwZS5nZXRCb3VuZHMgPSBmdW5jdGlvbiBnZXRDYXJ0b2dyYXBoaWNCb3VuZHMoKSB7XHJcbiAgICBpZiAoIXRoaXMuX2lzUmVhZHkpIHtcclxuICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBJbWFnZURlY29kZXJWaWV3ZXIgZXJyb3I6IEltYWdlIGlzIG5vdCByZWFkeSB5ZXQnO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIHRoaXMuX2NhcnRvZ3JhcGhpY0JvdW5kc0ZpeGVkO1xyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVyVmlld2VyLnByb3RvdHlwZS5faXNJbWFnZVBhcnRzRXF1YWwgPSBmdW5jdGlvbiBpc0ltYWdlUGFydHNFcXVhbChmaXJzdCwgc2Vjb25kKSB7XHJcbiAgICB2YXIgaXNFcXVhbCA9XHJcbiAgICAgICAgdGhpcy5fZHluYW1pY0ZldGNoUGFyYW1zICE9PSB1bmRlZmluZWQgJiZcclxuICAgICAgICBmaXJzdC5taW5YID09PSBzZWNvbmQubWluWCAmJlxyXG4gICAgICAgIGZpcnN0Lm1pblkgPT09IHNlY29uZC5taW5ZICYmXHJcbiAgICAgICAgZmlyc3QubWF4WEV4Y2x1c2l2ZSA9PT0gc2Vjb25kLm1heFhFeGNsdXNpdmUgJiZcclxuICAgICAgICBmaXJzdC5tYXhZRXhjbHVzaXZlID09PSBzZWNvbmQubWF4WUV4Y2x1c2l2ZSAmJlxyXG4gICAgICAgIGZpcnN0LmxldmVsID09PSBzZWNvbmQubGV2ZWw7XHJcbiAgICBcclxuICAgIHJldHVybiBpc0VxdWFsO1xyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVyVmlld2VyLnByb3RvdHlwZS5fZmV0Y2ggPSBmdW5jdGlvbiBmZXRjaChcclxuICAgIHJlZ2lvbklkLFxyXG4gICAgZmV0Y2hQYXJhbXMsXHJcbiAgICBzdGFydER5bmFtaWNSZWdpb25PblRlcm1pbmF0aW9uLFxyXG4gICAgbW92ZUV4aXN0aW5nRmV0Y2gpIHtcclxuICAgIFxyXG4gICAgdmFyIHJlcXVlc3RJbmRleCA9ICsrdGhpcy5fbGFzdFJlcXVlc3RJbmRleDtcclxuICAgIFxyXG4gICAgdmFyIGltYWdlUGFydFBhcmFtcyA9IGZldGNoUGFyYW1zLmltYWdlUGFydFBhcmFtcztcclxuICAgIGltYWdlUGFydFBhcmFtcy5yZXF1ZXN0UHJpb3JpdHlEYXRhID1cclxuICAgICAgICBpbWFnZVBhcnRQYXJhbXMucmVxdWVzdFByaW9yaXR5RGF0YSB8fCB7fTtcclxuICAgIFxyXG4gICAgaW1hZ2VQYXJ0UGFyYW1zLnJlcXVlc3RQcmlvcml0eURhdGEucmVxdWVzdEluZGV4ID0gcmVxdWVzdEluZGV4O1xyXG5cclxuICAgIHZhciBtaW5YID0gZmV0Y2hQYXJhbXMucG9zaXRpb25JbkltYWdlLm1pblg7XHJcbiAgICB2YXIgbWluWSA9IGZldGNoUGFyYW1zLnBvc2l0aW9uSW5JbWFnZS5taW5ZO1xyXG4gICAgdmFyIG1heFggPSBmZXRjaFBhcmFtcy5wb3NpdGlvbkluSW1hZ2UubWF4WEV4Y2x1c2l2ZTtcclxuICAgIHZhciBtYXhZID0gZmV0Y2hQYXJhbXMucG9zaXRpb25JbkltYWdlLm1heFlFeGNsdXNpdmU7XHJcbiAgICBcclxuICAgIHZhciB3ZXN0ID0gKG1pblggLSB0aGlzLl90cmFuc2xhdGVYKSAvIHRoaXMuX3NjYWxlWDtcclxuICAgIHZhciBlYXN0ID0gKG1heFggLSB0aGlzLl90cmFuc2xhdGVYKSAvIHRoaXMuX3NjYWxlWDtcclxuICAgIHZhciBub3J0aCA9IChtaW5ZIC0gdGhpcy5fdHJhbnNsYXRlWSkgLyB0aGlzLl9zY2FsZVk7XHJcbiAgICB2YXIgc291dGggPSAobWF4WSAtIHRoaXMuX3RyYW5zbGF0ZVkpIC8gdGhpcy5fc2NhbGVZO1xyXG4gICAgXHJcbiAgICB2YXIgcG9zaXRpb24gPSB7XHJcbiAgICAgICAgd2VzdDogd2VzdCxcclxuICAgICAgICBlYXN0OiBlYXN0LFxyXG4gICAgICAgIG5vcnRoOiBub3J0aCxcclxuICAgICAgICBzb3V0aDogc291dGhcclxuICAgIH07XHJcbiAgICBcclxuICAgIHZhciBjYW5SZXVzZU9sZERhdGEgPSBmYWxzZTtcclxuICAgIHZhciBmZXRjaFBhcmFtc05vdE5lZWRlZDtcclxuICAgIFxyXG4gICAgdmFyIHJlZ2lvbiA9IHRoaXMuX3JlZ2lvbnNbcmVnaW9uSWRdO1xyXG4gICAgaWYgKHJlZ2lvbiAhPT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgdmFyIG5ld1Jlc29sdXRpb24gPSBpbWFnZVBhcnRQYXJhbXMubGV2ZWw7XHJcbiAgICAgICAgdmFyIG9sZFJlc29sdXRpb24gPSByZWdpb24uaW1hZ2VQYXJ0UGFyYW1zLmxldmVsO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGNhblJldXNlT2xkRGF0YSA9IG5ld1Jlc29sdXRpb24gPT09IG9sZFJlc29sdXRpb247XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKGNhblJldXNlT2xkRGF0YSAmJiByZWdpb24uZG9uZVBhcnRQYXJhbXMpIHtcclxuICAgICAgICAgICAgZmV0Y2hQYXJhbXNOb3ROZWVkZWQgPSBbIHJlZ2lvbi5kb25lUGFydFBhcmFtcyBdO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgaWYgKHJlZ2lvbklkICE9PSBSRUdJT05fT1ZFUlZJRVcpIHtcclxuICAgICAgICAgICAgdmFyIGFkZGVkUGVuZGluZ0NhbGwgPSB0aGlzLl9jaGVja0lmUmVwb3NpdGlvbk5lZWRlZChcclxuICAgICAgICAgICAgICAgIHJlZ2lvbiwgaW1hZ2VQYXJ0UGFyYW1zLCBwb3NpdGlvbik7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBpZiAoYWRkZWRQZW5kaW5nQ2FsbCkge1xyXG4gICAgICAgICAgICAgICAgdGhpcy5fbm90aWZ5TmV3UGVuZGluZ0NhbGxzKCk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHZhciBzZWxmID0gdGhpcztcclxuICAgIFxyXG4gICAgdmFyIG1vdmFibGVIYW5kbGUgPSBtb3ZlRXhpc3RpbmdGZXRjaCA/IHRoaXMuX21vdmFibGVIYW5kbGU6IHVuZGVmaW5lZDtcclxuXHJcbiAgICB0aGlzLl9pbWFnZURlY29kZXIucmVxdWVzdFBpeGVsc1Byb2dyZXNzaXZlKFxyXG4gICAgICAgIGZldGNoUGFyYW1zLmltYWdlUGFydFBhcmFtcyxcclxuICAgICAgICBjYWxsYmFjayxcclxuICAgICAgICB0ZXJtaW5hdGVkQ2FsbGJhY2ssXHJcbiAgICAgICAgZmV0Y2hQYXJhbXNOb3ROZWVkZWQsXHJcbiAgICAgICAgbW92YWJsZUhhbmRsZSk7XHJcbiAgICBcclxuICAgIGZ1bmN0aW9uIGNhbGxiYWNrKGRlY29kZWQpIHtcclxuICAgICAgICBzZWxmLl90aWxlc0RlY29kZWRDYWxsYmFjayhcclxuICAgICAgICAgICAgcmVnaW9uSWQsXHJcbiAgICAgICAgICAgIGZldGNoUGFyYW1zLFxyXG4gICAgICAgICAgICBwb3NpdGlvbixcclxuICAgICAgICAgICAgZGVjb2RlZCk7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGZ1bmN0aW9uIHRlcm1pbmF0ZWRDYWxsYmFjayhpc0Fib3J0ZWQpIHtcclxuICAgICAgICBpZiAoaXNBYm9ydGVkICYmXHJcbiAgICAgICAgICAgIGltYWdlUGFydFBhcmFtcy5yZXF1ZXN0UHJpb3JpdHlEYXRhLm92ZXJyaWRlSGlnaGVzdFByaW9yaXR5KSB7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBOT1RFOiBCdWcgaW4ga2R1X3NlcnZlciBjYXVzZXMgZmlyc3QgcmVxdWVzdCB0byBiZSBzZW50IHdyb25nbHkuXHJcbiAgICAgICAgICAgIC8vIFRoZW4gQ2hyb21lIHJhaXNlcyBFUlJfSU5WQUxJRF9DSFVOS0VEX0VOQ09ESU5HIGFuZCB0aGUgcmVxdWVzdFxyXG4gICAgICAgICAgICAvLyBuZXZlciByZXR1cm5zLiBUaHVzIHBlcmZvcm0gc2Vjb25kIHJlcXVlc3QuXHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBzZWxmLl9pbWFnZURlY29kZXIucmVxdWVzdFBpeGVsc1Byb2dyZXNzaXZlKFxyXG4gICAgICAgICAgICAgICAgZmV0Y2hQYXJhbXMuaW1hZ2VQYXJ0UGFyYW1zLFxyXG4gICAgICAgICAgICAgICAgY2FsbGJhY2ssXHJcbiAgICAgICAgICAgICAgICB0ZXJtaW5hdGVkQ2FsbGJhY2ssXHJcbiAgICAgICAgICAgICAgICBmZXRjaFBhcmFtc05vdE5lZWRlZCk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHNlbGYuX2ZldGNoVGVybWluYXRlZENhbGxiYWNrKFxyXG4gICAgICAgICAgICByZWdpb25JZCxcclxuICAgICAgICAgICAgZmV0Y2hQYXJhbXMuaW1hZ2VQYXJ0UGFyYW1zLnJlcXVlc3RQcmlvcml0eURhdGEsXHJcbiAgICAgICAgICAgIGlzQWJvcnRlZCxcclxuICAgICAgICAgICAgc3RhcnREeW5hbWljUmVnaW9uT25UZXJtaW5hdGlvbik7XHJcbiAgICB9XHJcbn07XHJcblxyXG5JbWFnZURlY29kZXJWaWV3ZXIucHJvdG90eXBlLl9mZXRjaFRlcm1pbmF0ZWRDYWxsYmFjayA9IGZ1bmN0aW9uIGZldGNoVGVybWluYXRlZENhbGxiYWNrKFxyXG4gICAgcmVnaW9uSWQsIHByaW9yaXR5RGF0YSwgaXNBYm9ydGVkLCBzdGFydER5bmFtaWNSZWdpb25PblRlcm1pbmF0aW9uKSB7XHJcbiAgICBcclxuICAgIHZhciByZWdpb24gPSB0aGlzLl9yZWdpb25zW3JlZ2lvbklkXTtcclxuICAgIGlmIChyZWdpb24gPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIFxyXG4gICAgaWYgKCFwcmlvcml0eURhdGEub3ZlcnJpZGVIaWdoZXN0UHJpb3JpdHkgJiZcclxuICAgICAgICBwcmlvcml0eURhdGEucmVxdWVzdEluZGV4ICE9PSB0aGlzLl9sYXN0UmVxdWVzdEluZGV4KSB7XHJcbiAgICBcclxuICAgICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHJlZ2lvbi5pc0RvbmUgPSAhaXNBYm9ydGVkICYmIHRoaXMuX2lzUmVhZHk7XHJcblx0aWYgKHJlZ2lvbi5pc0RvbmUpIHtcclxuXHRcdHJlZ2lvbi5kb25lUGFydFBhcmFtcyA9IHJlZ2lvbi5pbWFnZVBhcnRQYXJhbXM7XHJcblx0fVxyXG4gICAgXHJcbiAgICBpZiAoc3RhcnREeW5hbWljUmVnaW9uT25UZXJtaW5hdGlvbikge1xyXG4gICAgICAgIHRoaXMuX2ltYWdlRGVjb2Rlci5jcmVhdGVNb3ZhYmxlRmV0Y2goKS50aGVuKHRoaXMuX2NyZWF0ZWRNb3ZhYmxlRmV0Y2hCb3VuZCk7XHJcbiAgICB9XHJcbn07XHJcblxyXG5JbWFnZURlY29kZXJWaWV3ZXIucHJvdG90eXBlLl9jcmVhdGVkTW92YWJsZUZldGNoID0gZnVuY3Rpb24gY3JlYXRlZE1vdmFibGVGZXRjaChtb3ZhYmxlSGFuZGxlKSB7XHJcbiAgICB0aGlzLl9tb3ZhYmxlSGFuZGxlID0gbW92YWJsZUhhbmRsZTtcclxuICAgIHRoaXMuX3N0YXJ0U2hvd2luZ0R5bmFtaWNSZWdpb24oKTtcclxufTtcclxuXHJcbkltYWdlRGVjb2RlclZpZXdlci5wcm90b3R5cGUuX3N0YXJ0U2hvd2luZ0R5bmFtaWNSZWdpb24gPSBmdW5jdGlvbiBzdGFydFNob3dpbmdEeW5hbWljUmVnaW9uKCkge1xyXG4gICAgdGhpcy5fY2FuU2hvd0R5bmFtaWNSZWdpb24gPSB0cnVlO1xyXG4gICAgXHJcbiAgICBpZiAodGhpcy5fcGVuZGluZ1VwZGF0ZVZpZXdBcmVhICE9PSBudWxsKSB7XHJcbiAgICAgICAgdGhpcy51cGRhdGVWaWV3QXJlYSh0aGlzLl9wZW5kaW5nVXBkYXRlVmlld0FyZWEpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHRoaXMuX3BlbmRpbmdVcGRhdGVWaWV3QXJlYSA9IG51bGw7XHJcbiAgICB9XHJcbn07XHJcblxyXG5JbWFnZURlY29kZXJWaWV3ZXIucHJvdG90eXBlLl90aWxlc0RlY29kZWRDYWxsYmFjayA9IGZ1bmN0aW9uIHRpbGVzRGVjb2RlZENhbGxiYWNrKFxyXG4gICAgcmVnaW9uSWQsIGZldGNoUGFyYW1zLCBwb3NpdGlvbiwgZGVjb2RlZCkge1xyXG4gICAgXHJcbiAgICBpZiAoIXRoaXMuX2lzUmVhZHkpIHtcclxuICAgICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHZhciByZWdpb24gPSB0aGlzLl9yZWdpb25zW3JlZ2lvbklkXTtcclxuICAgIGlmIChyZWdpb24gPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIHJlZ2lvbiA9IHt9O1xyXG4gICAgICAgIHRoaXMuX3JlZ2lvbnNbcmVnaW9uSWRdID0gcmVnaW9uO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHN3aXRjaCAocmVnaW9uSWQpIHtcclxuICAgICAgICAgICAgY2FzZSBSRUdJT05fRFlOQU1JQzpcclxuICAgICAgICAgICAgICAgIHJlZ2lvbi5jYW52YXMgPSB0aGlzLl90YXJnZXRDYW52YXM7XHJcbiAgICAgICAgICAgICAgICBicmVhaztcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBjYXNlIFJFR0lPTl9PVkVSVklFVzpcclxuICAgICAgICAgICAgICAgIHJlZ2lvbi5jYW52YXMgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdjYW52YXMnKTtcclxuICAgICAgICAgICAgICAgIGJyZWFrO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgZGVmYXVsdDpcclxuICAgICAgICAgICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IFVuZXhwZWN0ZWQgcmVnaW9uSWQgJyArIHJlZ2lvbklkO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuICAgIFxyXG4gICAgdmFyIHBhcnRQYXJhbXMgPSBmZXRjaFBhcmFtcy5pbWFnZVBhcnRQYXJhbXM7XHJcbiAgICBpZiAoIXBhcnRQYXJhbXMucmVxdWVzdFByaW9yaXR5RGF0YS5vdmVycmlkZUhpZ2hlc3RQcmlvcml0eSAmJlxyXG4gICAgICAgIHBhcnRQYXJhbXMucmVxdWVzdFByaW9yaXR5RGF0YS5yZXF1ZXN0SW5kZXggPCByZWdpb24uY3VycmVudERpc3BsYXlSZXF1ZXN0SW5kZXgpIHtcclxuICAgICAgICBcclxuICAgICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHRoaXMuX2NoZWNrSWZSZXBvc2l0aW9uTmVlZGVkKHJlZ2lvbiwgcGFydFBhcmFtcywgcG9zaXRpb24pO1xyXG4gICAgICAgIFxyXG4gICAgdGhpcy5fcGVuZGluZ0NhbGxiYWNrQ2FsbHMucHVzaCh7XHJcbiAgICAgICAgdHlwZTogUEVORElOR19DQUxMX1RZUEVfUElYRUxTX1VQREFURUQsXHJcbiAgICAgICAgcmVnaW9uOiByZWdpb24sXHJcbiAgICAgICAgZGVjb2RlZDogZGVjb2RlZFxyXG4gICAgfSk7XHJcbiAgICBcclxuICAgIHRoaXMuX25vdGlmeU5ld1BlbmRpbmdDYWxscygpO1xyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVyVmlld2VyLnByb3RvdHlwZS5fY2hlY2tJZlJlcG9zaXRpb25OZWVkZWQgPSBmdW5jdGlvbiBjaGVja0lmUmVwb3NpdGlvbk5lZWRlZChcclxuICAgIHJlZ2lvbiwgbmV3UGFydFBhcmFtcywgbmV3UG9zaXRpb24pIHtcclxuICAgIFxyXG4gICAgdmFyIG9sZFBhcnRQYXJhbXMgPSByZWdpb24uaW1hZ2VQYXJ0UGFyYW1zO1xyXG5cdHZhciBvbGREb25lUGFydFBhcmFtcyA9IHJlZ2lvbi5kb25lUGFydFBhcmFtcztcclxuICAgIHZhciBsZXZlbCA9IG5ld1BhcnRQYXJhbXMubGV2ZWw7XHJcbiAgICBcclxuICAgIHZhciBuZWVkUmVwb3NpdGlvbiA9XHJcbiAgICAgICAgb2xkUGFydFBhcmFtcyA9PT0gdW5kZWZpbmVkIHx8XHJcbiAgICAgICAgb2xkUGFydFBhcmFtcy5taW5YICE9PSBuZXdQYXJ0UGFyYW1zLm1pblggfHxcclxuICAgICAgICBvbGRQYXJ0UGFyYW1zLm1pblkgIT09IG5ld1BhcnRQYXJhbXMubWluWSB8fFxyXG4gICAgICAgIG9sZFBhcnRQYXJhbXMubWF4WEV4Y2x1c2l2ZSAhPT0gbmV3UGFydFBhcmFtcy5tYXhYRXhjbHVzaXZlIHx8XHJcbiAgICAgICAgb2xkUGFydFBhcmFtcy5tYXhZRXhjbHVzaXZlICE9PSBuZXdQYXJ0UGFyYW1zLm1heFlFeGNsdXNpdmUgfHxcclxuICAgICAgICBvbGRQYXJ0UGFyYW1zLmxldmVsICE9PSBsZXZlbDtcclxuICAgIFxyXG4gICAgaWYgKCFuZWVkUmVwb3NpdGlvbikge1xyXG4gICAgICAgIHJldHVybiBmYWxzZTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgdmFyIGNvcHlEYXRhO1xyXG4gICAgdmFyIGludGVyc2VjdGlvbjtcclxuXHR2YXIgbmV3RG9uZVBhcnRQYXJhbXM7XHJcbiAgICB2YXIgcmV1c2VPbGREYXRhID0gZmFsc2U7XHJcbiAgICB2YXIgc2NhbGVYO1xyXG4gICAgdmFyIHNjYWxlWTtcclxuICAgIGlmIChvbGRQYXJ0UGFyYW1zICE9PSB1bmRlZmluZWQpIHtcclxuICAgICAgICBzY2FsZVggPSBuZXdQYXJ0UGFyYW1zLmxldmVsV2lkdGggIC8gb2xkUGFydFBhcmFtcy5sZXZlbFdpZHRoO1xyXG4gICAgICAgIHNjYWxlWSA9IG5ld1BhcnRQYXJhbXMubGV2ZWxIZWlnaHQgLyBvbGRQYXJ0UGFyYW1zLmxldmVsSGVpZ2h0O1xyXG4gICAgICAgIFxyXG4gICAgICAgIGludGVyc2VjdGlvbiA9IHtcclxuICAgICAgICAgICAgbWluWDogTWF0aC5tYXgob2xkUGFydFBhcmFtcy5taW5YICogc2NhbGVYLCBuZXdQYXJ0UGFyYW1zLm1pblgpLFxyXG4gICAgICAgICAgICBtaW5ZOiBNYXRoLm1heChvbGRQYXJ0UGFyYW1zLm1pblkgKiBzY2FsZVksIG5ld1BhcnRQYXJhbXMubWluWSksXHJcbiAgICAgICAgICAgIG1heFg6IE1hdGgubWluKG9sZFBhcnRQYXJhbXMubWF4WEV4Y2x1c2l2ZSAqIHNjYWxlWCwgbmV3UGFydFBhcmFtcy5tYXhYRXhjbHVzaXZlKSxcclxuICAgICAgICAgICAgbWF4WTogTWF0aC5taW4ob2xkUGFydFBhcmFtcy5tYXhZRXhjbHVzaXZlICogc2NhbGVZLCBuZXdQYXJ0UGFyYW1zLm1heFlFeGNsdXNpdmUpXHJcbiAgICAgICAgfTtcclxuICAgICAgICByZXVzZU9sZERhdGEgPVxyXG4gICAgICAgICAgICBpbnRlcnNlY3Rpb24ubWF4WCA+IGludGVyc2VjdGlvbi5taW5YICYmXHJcbiAgICAgICAgICAgIGludGVyc2VjdGlvbi5tYXhZID4gaW50ZXJzZWN0aW9uLm1pblk7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGlmIChyZXVzZU9sZERhdGEpIHtcclxuICAgICAgICBjb3B5RGF0YSA9IHtcclxuICAgICAgICAgICAgZnJvbVg6IGludGVyc2VjdGlvbi5taW5YIC8gc2NhbGVYIC0gb2xkUGFydFBhcmFtcy5taW5YLFxyXG4gICAgICAgICAgICBmcm9tWTogaW50ZXJzZWN0aW9uLm1pblkgLyBzY2FsZVkgLSBvbGRQYXJ0UGFyYW1zLm1pblksXHJcbiAgICAgICAgICAgIGZyb21XaWR0aCA6IChpbnRlcnNlY3Rpb24ubWF4WCAtIGludGVyc2VjdGlvbi5taW5YKSAvIHNjYWxlWCxcclxuICAgICAgICAgICAgZnJvbUhlaWdodDogKGludGVyc2VjdGlvbi5tYXhZIC0gaW50ZXJzZWN0aW9uLm1pblkpIC8gc2NhbGVZLFxyXG4gICAgICAgICAgICB0b1g6IGludGVyc2VjdGlvbi5taW5YIC0gbmV3UGFydFBhcmFtcy5taW5YLFxyXG4gICAgICAgICAgICB0b1k6IGludGVyc2VjdGlvbi5taW5ZIC0gbmV3UGFydFBhcmFtcy5taW5ZLFxyXG4gICAgICAgICAgICB0b1dpZHRoIDogaW50ZXJzZWN0aW9uLm1heFggLSBpbnRlcnNlY3Rpb24ubWluWCxcclxuICAgICAgICAgICAgdG9IZWlnaHQ6IGludGVyc2VjdGlvbi5tYXhZIC0gaW50ZXJzZWN0aW9uLm1pblksXHJcbiAgICAgICAgfTtcclxuXHRcclxuXHRcdGlmIChvbGREb25lUGFydFBhcmFtcyAmJiBvbGRQYXJ0UGFyYW1zLmxldmVsID09PSBsZXZlbCkge1xyXG5cdFx0XHRuZXdEb25lUGFydFBhcmFtcyA9IHtcclxuXHRcdFx0XHRtaW5YOiBNYXRoLm1heChvbGREb25lUGFydFBhcmFtcy5taW5YLCBuZXdQYXJ0UGFyYW1zLm1pblgpLFxyXG5cdFx0XHRcdG1pblk6IE1hdGgubWF4KG9sZERvbmVQYXJ0UGFyYW1zLm1pblksIG5ld1BhcnRQYXJhbXMubWluWSksXHJcblx0XHRcdFx0bWF4WEV4Y2x1c2l2ZTogTWF0aC5taW4ob2xkRG9uZVBhcnRQYXJhbXMubWF4WEV4Y2x1c2l2ZSwgbmV3UGFydFBhcmFtcy5tYXhYRXhjbHVzaXZlKSxcclxuXHRcdFx0XHRtYXhZRXhjbHVzaXZlOiBNYXRoLm1pbihvbGREb25lUGFydFBhcmFtcy5tYXhZRXhjbHVzaXZlLCBuZXdQYXJ0UGFyYW1zLm1heFlFeGNsdXNpdmUpXHJcblx0XHRcdH07XHJcblx0XHR9XHJcblx0fVxyXG4gICAgXHJcbiAgICByZWdpb24uaW1hZ2VQYXJ0UGFyYW1zID0gbmV3UGFydFBhcmFtcztcclxuICAgIHJlZ2lvbi5pc0RvbmUgPSBmYWxzZTtcclxuICAgIHJlZ2lvbi5jdXJyZW50RGlzcGxheVJlcXVlc3RJbmRleCA9IG5ld1BhcnRQYXJhbXMucmVxdWVzdFByaW9yaXR5RGF0YS5yZXF1ZXN0SW5kZXg7XHJcbiAgICBcclxuICAgIHZhciByZXBvc2l0aW9uQXJncyA9IHtcclxuICAgICAgICB0eXBlOiBQRU5ESU5HX0NBTExfVFlQRV9SRVBPU0lUSU9OLFxyXG4gICAgICAgIHJlZ2lvbjogcmVnaW9uLFxyXG4gICAgICAgIHBvc2l0aW9uOiBuZXdQb3NpdGlvbixcclxuXHRcdGRvbmVQYXJ0UGFyYW1zOiBuZXdEb25lUGFydFBhcmFtcyxcclxuICAgICAgICBjb3B5RGF0YTogY29weURhdGEsXHJcbiAgICAgICAgcGl4ZWxzV2lkdGg6IG5ld1BhcnRQYXJhbXMubWF4WEV4Y2x1c2l2ZSAtIG5ld1BhcnRQYXJhbXMubWluWCxcclxuICAgICAgICBwaXhlbHNIZWlnaHQ6IG5ld1BhcnRQYXJhbXMubWF4WUV4Y2x1c2l2ZSAtIG5ld1BhcnRQYXJhbXMubWluWVxyXG4gICAgfTtcclxuICAgIFxyXG4gICAgdGhpcy5fcGVuZGluZ0NhbGxiYWNrQ2FsbHMucHVzaChyZXBvc2l0aW9uQXJncyk7XHJcbiAgICBcclxuICAgIHJldHVybiB0cnVlO1xyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVyVmlld2VyLnByb3RvdHlwZS5fbm90aWZ5TmV3UGVuZGluZ0NhbGxzID0gZnVuY3Rpb24gbm90aWZ5TmV3UGVuZGluZ0NhbGxzKCkge1xyXG4gICAgaWYgKCF0aGlzLl9pc05lYXJDYWxsYmFja0NhbGxlZCkge1xyXG4gICAgICAgIHRoaXMuX2NhbGxQZW5kaW5nQ2FsbGJhY2tzKCk7XHJcbiAgICB9XHJcbn07XHJcblxyXG5JbWFnZURlY29kZXJWaWV3ZXIucHJvdG90eXBlLl9jYWxsUGVuZGluZ0NhbGxiYWNrcyA9IGZ1bmN0aW9uIGNhbGxQZW5kaW5nQ2FsbGJhY2tzKCkge1xyXG4gICAgaWYgKHRoaXMuX3BlbmRpbmdDYWxsYmFja0NhbGxzLmxlbmd0aCA9PT0gMCB8fCAhdGhpcy5faXNSZWFkeSkge1xyXG4gICAgICAgIHRoaXMuX2lzTmVhckNhbGxiYWNrQ2FsbGVkID0gZmFsc2U7XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBpZiAodGhpcy5faXNOZWFyQ2FsbGJhY2tDYWxsZWQpIHtcclxuICAgICAgICBjbGVhclRpbWVvdXQodGhpcy5fcGVuZGluZ0NhbGxiYWNrc0ludGVydmFsSGFuZGxlKTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgaWYgKHRoaXMuX21pbkZ1bmN0aW9uQ2FsbEludGVydmFsTWlsbGlzZWNvbmRzICE9PSB1bmRlZmluZWQpIHtcclxuICAgICAgICB0aGlzLl9wZW5kaW5nQ2FsbGJhY2tzSW50ZXJ2YWxIYW5kbGUgPVxyXG4gICAgICAgICAgICBzZXRUaW1lb3V0KHRoaXMuX2NhbGxQZW5kaW5nQ2FsbGJhY2tzQm91bmQsXHJcbiAgICAgICAgICAgIHRoaXMuX21pbkZ1bmN0aW9uQ2FsbEludGVydmFsTWlsbGlzZWNvbmRzKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgdGhpcy5faXNOZWFyQ2FsbGJhY2tDYWxsZWQgPSB0cnVlO1xyXG4gICAgfVxyXG5cclxuICAgIHZhciBuZXdQb3NpdGlvbiA9IG51bGw7XHJcbiAgICBcclxuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgdGhpcy5fcGVuZGluZ0NhbGxiYWNrQ2FsbHMubGVuZ3RoOyArK2kpIHtcclxuICAgICAgICB2YXIgY2FsbEFyZ3MgPSB0aGlzLl9wZW5kaW5nQ2FsbGJhY2tDYWxsc1tpXTtcclxuICAgICAgICBcclxuICAgICAgICBpZiAoY2FsbEFyZ3MudHlwZSA9PT0gUEVORElOR19DQUxMX1RZUEVfUkVQT1NJVElPTikge1xyXG4gICAgICAgICAgICB0aGlzLl9yZXBvc2l0aW9uQ2FudmFzKGNhbGxBcmdzKTtcclxuICAgICAgICAgICAgbmV3UG9zaXRpb24gPSBjYWxsQXJncy5wb3NpdGlvbjtcclxuICAgICAgICB9IGVsc2UgaWYgKGNhbGxBcmdzLnR5cGUgPT09IFBFTkRJTkdfQ0FMTF9UWVBFX1BJWEVMU19VUERBVEVEKSB7XHJcbiAgICAgICAgICAgIHRoaXMuX3BpeGVsc1VwZGF0ZWQoY2FsbEFyZ3MpO1xyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IEludGVybmFsIEltYWdlRGVjb2RlclZpZXdlciBFcnJvcjogVW5leHBlY3RlZCBjYWxsIHR5cGUgJyArXHJcbiAgICAgICAgICAgICAgICBjYWxsQXJncy50eXBlO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuICAgIFxyXG4gICAgdGhpcy5fcGVuZGluZ0NhbGxiYWNrQ2FsbHMubGVuZ3RoID0gMDtcclxuICAgIFxyXG4gICAgdGhpcy5fY2FudmFzVXBkYXRlZENhbGxiYWNrKG5ld1Bvc2l0aW9uKTtcclxufTtcclxuXHJcbkltYWdlRGVjb2RlclZpZXdlci5wcm90b3R5cGUuX3BpeGVsc1VwZGF0ZWQgPSBmdW5jdGlvbiBwaXhlbHNVcGRhdGVkKHBpeGVsc1VwZGF0ZWRBcmdzKSB7XHJcbiAgICB2YXIgcmVnaW9uID0gcGl4ZWxzVXBkYXRlZEFyZ3MucmVnaW9uO1xyXG4gICAgdmFyIGRlY29kZWQgPSBwaXhlbHNVcGRhdGVkQXJncy5kZWNvZGVkO1xyXG4gICAgaWYgKGRlY29kZWQuaW1hZ2VEYXRhLndpZHRoID09PSAwIHx8IGRlY29kZWQuaW1hZ2VEYXRhLmhlaWdodCA9PT0gMCkge1xyXG4gICAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIFxyXG4gICAgdmFyIHggPSBkZWNvZGVkLnhJbk9yaWdpbmFsUmVxdWVzdDtcclxuICAgIHZhciB5ID0gZGVjb2RlZC55SW5PcmlnaW5hbFJlcXVlc3Q7XHJcbiAgICBcclxuICAgIHZhciBjb250ZXh0ID0gcmVnaW9uLmNhbnZhcy5nZXRDb250ZXh0KCcyZCcpO1xyXG4gICAgLy92YXIgaW1hZ2VEYXRhID0gY29udGV4dC5jcmVhdGVJbWFnZURhdGEoZGVjb2RlZC53aWR0aCwgZGVjb2RlZC5oZWlnaHQpO1xyXG4gICAgLy9pbWFnZURhdGEuZGF0YS5zZXQoZGVjb2RlZC5waXhlbHMpO1xyXG4gICAgXHJcbiAgICBjb250ZXh0LnB1dEltYWdlRGF0YShkZWNvZGVkLmltYWdlRGF0YSwgeCwgeSk7XHJcbn07XHJcblxyXG5JbWFnZURlY29kZXJWaWV3ZXIucHJvdG90eXBlLl9yZXBvc2l0aW9uQ2FudmFzID0gZnVuY3Rpb24gcmVwb3NpdGlvbkNhbnZhcyhyZXBvc2l0aW9uQXJncykge1xyXG4gICAgdmFyIHJlZ2lvbiA9IHJlcG9zaXRpb25BcmdzLnJlZ2lvbjtcclxuICAgIHZhciBwb3NpdGlvbiA9IHJlcG9zaXRpb25BcmdzLnBvc2l0aW9uO1xyXG5cdHZhciBkb25lUGFydFBhcmFtcyA9IHJlcG9zaXRpb25BcmdzLmRvbmVQYXJ0UGFyYW1zO1xyXG4gICAgdmFyIGNvcHlEYXRhID0gcmVwb3NpdGlvbkFyZ3MuY29weURhdGE7XHJcbiAgICB2YXIgcGl4ZWxzV2lkdGggPSByZXBvc2l0aW9uQXJncy5waXhlbHNXaWR0aDtcclxuICAgIHZhciBwaXhlbHNIZWlnaHQgPSByZXBvc2l0aW9uQXJncy5waXhlbHNIZWlnaHQ7XHJcbiAgICBcclxuICAgIHZhciBpbWFnZURhdGFUb0NvcHk7XHJcbiAgICB2YXIgY29udGV4dCA9IHJlZ2lvbi5jYW52YXMuZ2V0Q29udGV4dCgnMmQnKTtcclxuICAgIFxyXG4gICAgaWYgKGNvcHlEYXRhICE9PSB1bmRlZmluZWQpIHtcclxuICAgICAgICBpZiAoY29weURhdGEuZnJvbVdpZHRoID09PSBjb3B5RGF0YS50b1dpZHRoICYmIGNvcHlEYXRhLmZyb21IZWlnaHQgPT09IGNvcHlEYXRhLnRvSGVpZ2h0KSB7XHJcbiAgICAgICAgICAgIGltYWdlRGF0YVRvQ29weSA9IGNvbnRleHQuZ2V0SW1hZ2VEYXRhKFxyXG4gICAgICAgICAgICAgICAgY29weURhdGEuZnJvbVgsIGNvcHlEYXRhLmZyb21ZLCBjb3B5RGF0YS5mcm9tV2lkdGgsIGNvcHlEYXRhLmZyb21IZWlnaHQpO1xyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgIGlmICghdGhpcy5fdG1wQ2FudmFzKSB7XHJcbiAgICAgICAgICAgICAgICB0aGlzLl90bXBDYW52YXMgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdjYW52YXMnKTtcclxuICAgICAgICAgICAgICAgIHRoaXMuX3RtcENhbnZhc0NvbnRleHQgPSB0aGlzLl90bXBDYW52YXMuZ2V0Q29udGV4dCgnMmQnKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgdGhpcy5fdG1wQ2FudmFzLndpZHRoICA9IGNvcHlEYXRhLnRvV2lkdGg7XHJcbiAgICAgICAgICAgIHRoaXMuX3RtcENhbnZhcy5oZWlnaHQgPSBjb3B5RGF0YS50b0hlaWdodDtcclxuICAgICAgICAgICAgdGhpcy5fdG1wQ2FudmFzQ29udGV4dC5kcmF3SW1hZ2UoXHJcbiAgICAgICAgICAgICAgICByZWdpb24uY2FudmFzLFxyXG4gICAgICAgICAgICAgICAgY29weURhdGEuZnJvbVgsIGNvcHlEYXRhLmZyb21ZLCBjb3B5RGF0YS5mcm9tV2lkdGgsIGNvcHlEYXRhLmZyb21IZWlnaHQsXHJcbiAgICAgICAgICAgICAgICAwLCAwLCBjb3B5RGF0YS50b1dpZHRoLCBjb3B5RGF0YS50b0hlaWdodCk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBpbWFnZURhdGFUb0NvcHkgPSB0aGlzLl90bXBDYW52YXNDb250ZXh0LmdldEltYWdlRGF0YShcclxuICAgICAgICAgICAgICAgIDAsIDAsIGNvcHlEYXRhLnRvV2lkdGgsIGNvcHlEYXRhLnRvSGVpZ2h0KTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHJlZ2lvbi5jYW52YXMud2lkdGggPSBwaXhlbHNXaWR0aDtcclxuICAgIHJlZ2lvbi5jYW52YXMuaGVpZ2h0ID0gcGl4ZWxzSGVpZ2h0O1xyXG4gICAgXHJcbiAgICBpZiAocmVnaW9uICE9PSB0aGlzLl9yZWdpb25zW1JFR0lPTl9PVkVSVklFV10pIHtcclxuICAgICAgICB0aGlzLl9jb3B5T3ZlcnZpZXdUb0NhbnZhcyhcclxuICAgICAgICAgICAgY29udGV4dCwgcG9zaXRpb24sIHBpeGVsc1dpZHRoLCBwaXhlbHNIZWlnaHQpO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBpZiAoY29weURhdGEgIT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIGNvbnRleHQucHV0SW1hZ2VEYXRhKGltYWdlRGF0YVRvQ29weSwgY29weURhdGEudG9YLCBjb3B5RGF0YS50b1kpO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICByZWdpb24ucG9zaXRpb24gPSBwb3NpdGlvbjtcclxuXHRyZWdpb24uZG9uZVBhcnRQYXJhbXMgPSBkb25lUGFydFBhcmFtcztcclxufTtcclxuXHJcbkltYWdlRGVjb2RlclZpZXdlci5wcm90b3R5cGUuX2NvcHlPdmVydmlld1RvQ2FudmFzID0gZnVuY3Rpb24gY29weU92ZXJ2aWV3VG9DYW52YXMoXHJcbiAgICBjb250ZXh0LCBjYW52YXNQb3NpdGlvbiwgY2FudmFzUGl4ZWxzV2lkdGgsIGNhbnZhc1BpeGVsc0hlaWdodCkge1xyXG4gICAgXHJcbiAgICB2YXIgc291cmNlUG9zaXRpb24gPSB0aGlzLl9yZWdpb25zW1JFR0lPTl9PVkVSVklFV10ucG9zaXRpb247XHJcbiAgICB2YXIgc291cmNlUGl4ZWxzID1cclxuICAgICAgICB0aGlzLl9yZWdpb25zW1JFR0lPTl9PVkVSVklFV10uaW1hZ2VQYXJ0UGFyYW1zO1xyXG4gICAgXHJcbiAgICB2YXIgc291cmNlUGl4ZWxzV2lkdGggPVxyXG4gICAgICAgIHNvdXJjZVBpeGVscy5tYXhYRXhjbHVzaXZlIC0gc291cmNlUGl4ZWxzLm1pblg7XHJcbiAgICB2YXIgc291cmNlUGl4ZWxzSGVpZ2h0ID1cclxuICAgICAgICBzb3VyY2VQaXhlbHMubWF4WUV4Y2x1c2l2ZSAtIHNvdXJjZVBpeGVscy5taW5ZO1xyXG4gICAgXHJcbiAgICB2YXIgc291cmNlUG9zaXRpb25XaWR0aCA9XHJcbiAgICAgICAgc291cmNlUG9zaXRpb24uZWFzdCAtIHNvdXJjZVBvc2l0aW9uLndlc3Q7XHJcbiAgICB2YXIgc291cmNlUG9zaXRpb25IZWlnaHQgPVxyXG4gICAgICAgIHNvdXJjZVBvc2l0aW9uLm5vcnRoIC0gc291cmNlUG9zaXRpb24uc291dGg7XHJcbiAgICAgICAgXHJcbiAgICB2YXIgc291cmNlUmVzb2x1dGlvblggPVxyXG4gICAgICAgIHNvdXJjZVBpeGVsc1dpZHRoIC8gc291cmNlUG9zaXRpb25XaWR0aDtcclxuICAgIHZhciBzb3VyY2VSZXNvbHV0aW9uWSA9XHJcbiAgICAgICAgc291cmNlUGl4ZWxzSGVpZ2h0IC8gc291cmNlUG9zaXRpb25IZWlnaHQ7XHJcbiAgICBcclxuICAgIHZhciB0YXJnZXRQb3NpdGlvbldpZHRoID1cclxuICAgICAgICBjYW52YXNQb3NpdGlvbi5lYXN0IC0gY2FudmFzUG9zaXRpb24ud2VzdDtcclxuICAgIHZhciB0YXJnZXRQb3NpdGlvbkhlaWdodCA9XHJcbiAgICAgICAgY2FudmFzUG9zaXRpb24ubm9ydGggLSBjYW52YXNQb3NpdGlvbi5zb3V0aDtcclxuICAgICAgICBcclxuICAgIHZhciBjcm9wV2lkdGggPSB0YXJnZXRQb3NpdGlvbldpZHRoICogc291cmNlUmVzb2x1dGlvblg7XHJcbiAgICB2YXIgY3JvcEhlaWdodCA9IHRhcmdldFBvc2l0aW9uSGVpZ2h0ICogc291cmNlUmVzb2x1dGlvblk7XHJcbiAgICBcclxuICAgIHZhciBjcm9wT2Zmc2V0UG9zaXRpb25YID1cclxuICAgICAgICBjYW52YXNQb3NpdGlvbi53ZXN0IC0gc291cmNlUG9zaXRpb24ud2VzdDtcclxuICAgIHZhciBjcm9wT2Zmc2V0UG9zaXRpb25ZID1cclxuICAgICAgICBzb3VyY2VQb3NpdGlvbi5ub3J0aCAtIGNhbnZhc1Bvc2l0aW9uLm5vcnRoO1xyXG4gICAgICAgIFxyXG4gICAgdmFyIGNyb3BQaXhlbE9mZnNldFggPSBjcm9wT2Zmc2V0UG9zaXRpb25YICogc291cmNlUmVzb2x1dGlvblg7XHJcbiAgICB2YXIgY3JvcFBpeGVsT2Zmc2V0WSA9IGNyb3BPZmZzZXRQb3NpdGlvblkgKiBzb3VyY2VSZXNvbHV0aW9uWTtcclxuICAgIFxyXG4gICAgY29udGV4dC5kcmF3SW1hZ2UoXHJcbiAgICAgICAgdGhpcy5fcmVnaW9uc1tSRUdJT05fT1ZFUlZJRVddLmNhbnZhcyxcclxuICAgICAgICBjcm9wUGl4ZWxPZmZzZXRYLCBjcm9wUGl4ZWxPZmZzZXRZLCBjcm9wV2lkdGgsIGNyb3BIZWlnaHQsXHJcbiAgICAgICAgMCwgMCwgY2FudmFzUGl4ZWxzV2lkdGgsIGNhbnZhc1BpeGVsc0hlaWdodCk7XHJcbn07XHJcblxyXG5JbWFnZURlY29kZXJWaWV3ZXIucHJvdG90eXBlLl9vcGVuZWQgPSBmdW5jdGlvbiBvcGVuZWQoKSB7XHJcbiAgICB0aGlzLl9pc1JlYWR5ID0gdHJ1ZTtcclxuICAgIFxyXG4gICAgdmFyIGZpeGVkQm91bmRzID0ge1xyXG4gICAgICAgIHdlc3Q6IHRoaXMuX2NhcnRvZ3JhcGhpY0JvdW5kcy53ZXN0LFxyXG4gICAgICAgIGVhc3Q6IHRoaXMuX2NhcnRvZ3JhcGhpY0JvdW5kcy5lYXN0LFxyXG4gICAgICAgIHNvdXRoOiB0aGlzLl9jYXJ0b2dyYXBoaWNCb3VuZHMuc291dGgsXHJcbiAgICAgICAgbm9ydGg6IHRoaXMuX2NhcnRvZ3JhcGhpY0JvdW5kcy5ub3J0aFxyXG4gICAgfTtcclxuICAgIGltYWdlSGVscGVyRnVuY3Rpb25zLmZpeEJvdW5kcyhcclxuICAgICAgICBmaXhlZEJvdW5kcywgdGhpcy5faW1hZ2VEZWNvZGVyLCB0aGlzLl9hZGFwdFByb3BvcnRpb25zKTtcclxuICAgIHRoaXMuX2NhcnRvZ3JhcGhpY0JvdW5kc0ZpeGVkID0gZml4ZWRCb3VuZHM7XHJcbiAgICBcclxuICAgIHZhciBpbWFnZVdpZHRoICA9IHRoaXMuX2ltYWdlRGVjb2Rlci5nZXRJbWFnZVdpZHRoICgpO1xyXG4gICAgdmFyIGltYWdlSGVpZ2h0ID0gdGhpcy5faW1hZ2VEZWNvZGVyLmdldEltYWdlSGVpZ2h0KCk7XHJcbiAgICB0aGlzLl9xdWFsaXR5ID0gdGhpcy5faW1hZ2VEZWNvZGVyLmdldEhpZ2hlc3RRdWFsaXR5KCk7XHJcblxyXG4gICAgdmFyIHJlY3RhbmdsZVdpZHRoID0gZml4ZWRCb3VuZHMuZWFzdCAtIGZpeGVkQm91bmRzLndlc3Q7XHJcbiAgICB2YXIgcmVjdGFuZ2xlSGVpZ2h0ID0gZml4ZWRCb3VuZHMubm9ydGggLSBmaXhlZEJvdW5kcy5zb3V0aDtcclxuICAgIHRoaXMuX3NjYWxlWCA9IGltYWdlV2lkdGggLyByZWN0YW5nbGVXaWR0aDtcclxuICAgIHRoaXMuX3NjYWxlWSA9IC1pbWFnZUhlaWdodCAvIHJlY3RhbmdsZUhlaWdodDtcclxuICAgIFxyXG4gICAgdGhpcy5fdHJhbnNsYXRlWCA9IC1maXhlZEJvdW5kcy53ZXN0ICogdGhpcy5fc2NhbGVYO1xyXG4gICAgdGhpcy5fdHJhbnNsYXRlWSA9IC1maXhlZEJvdW5kcy5ub3J0aCAqIHRoaXMuX3NjYWxlWTtcclxuICAgIFxyXG4gICAgdmFyIG92ZXJ2aWV3UGFyYW1zID0ge1xyXG4gICAgICAgIG1pblg6IDAsXHJcbiAgICAgICAgbWluWTogMCxcclxuICAgICAgICBtYXhYRXhjbHVzaXZlOiBpbWFnZVdpZHRoLFxyXG4gICAgICAgIG1heFlFeGNsdXNpdmU6IGltYWdlSGVpZ2h0LFxyXG4gICAgICAgIHNjcmVlbldpZHRoOiB0aGlzLl9vdmVydmlld1Jlc29sdXRpb25YLFxyXG4gICAgICAgIHNjcmVlbkhlaWdodDogdGhpcy5fb3ZlcnZpZXdSZXNvbHV0aW9uWVxyXG4gICAgfTtcclxuICAgIFxyXG4gICAgdmFyIG92ZXJ2aWV3QWxpZ25lZFBhcmFtcyA9XHJcbiAgICAgICAgaW1hZ2VIZWxwZXJGdW5jdGlvbnMuYWxpZ25QYXJhbXNUb1RpbGVzQW5kTGV2ZWwoXHJcbiAgICAgICAgICAgIG92ZXJ2aWV3UGFyYW1zLCB0aGlzLl9pbWFnZURlY29kZXIpO1xyXG4gICAgICAgICAgICBcclxuICAgIG92ZXJ2aWV3QWxpZ25lZFBhcmFtcy5pbWFnZVBhcnRQYXJhbXMucmVxdWVzdFByaW9yaXR5RGF0YSA9XHJcbiAgICAgICAgb3ZlcnZpZXdBbGlnbmVkUGFyYW1zLmltYWdlUGFydFBhcmFtcy5yZXF1ZXN0UHJpb3JpdHlEYXRhIHx8IHt9O1xyXG4gICAgXHJcbiAgICBvdmVydmlld0FsaWduZWRQYXJhbXMuaW1hZ2VQYXJ0UGFyYW1zLnJlcXVlc3RQcmlvcml0eURhdGEub3ZlcnJpZGVIaWdoZXN0UHJpb3JpdHkgPSB0cnVlO1xyXG4gICAgb3ZlcnZpZXdBbGlnbmVkUGFyYW1zLmltYWdlUGFydFBhcmFtcy5xdWFsaXR5ID0gdGhpcy5faW1hZ2VEZWNvZGVyLmdldExvd2VzdFF1YWxpdHkoKTtcclxuICAgIFxyXG4gICAgdmFyIHN0YXJ0RHluYW1pY1JlZ2lvbk9uVGVybWluYXRpb24gPVxyXG4gICAgICAgICF0aGlzLl9hbGxvd011bHRpcGxlTW92YWJsZUZldGNoZXNJblNlc3Npb247XHJcbiAgICAgICAgXHJcbiAgICB0aGlzLl9mZXRjaChcclxuICAgICAgICBSRUdJT05fT1ZFUlZJRVcsXHJcbiAgICAgICAgb3ZlcnZpZXdBbGlnbmVkUGFyYW1zLFxyXG4gICAgICAgIHN0YXJ0RHluYW1pY1JlZ2lvbk9uVGVybWluYXRpb24pO1xyXG4gICAgXHJcbiAgICBpZiAodGhpcy5fYWxsb3dNdWx0aXBsZU1vdmFibGVGZXRjaGVzSW5TZXNzaW9uKSB7XHJcbiAgICAgICAgdGhpcy5fc3RhcnRTaG93aW5nRHluYW1pY1JlZ2lvbigpO1xyXG4gICAgfVxyXG59OyIsIid1c2Ugc3RyaWN0JztcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gSW1hZ2VQYXJhbXNSZXRyaWV2ZXJQcm94eTtcclxuXHJcbmZ1bmN0aW9uIEltYWdlUGFyYW1zUmV0cmlldmVyUHJveHkoKSB7XHJcbiAgICB0aGlzLl9zaXplc1BhcmFtcyA9IG51bGw7XHJcbn1cclxuXHJcbkltYWdlUGFyYW1zUmV0cmlldmVyUHJveHkucHJvdG90eXBlLmdldEltYWdlTGV2ZWwgPSBmdW5jdGlvbiBnZXRJbWFnZUxldmVsKCkge1xyXG4gICAgdmFyIHNpemVzUGFyYW1zID0gdGhpcy5nZXRJbWFnZVBhcmFtcygpO1xyXG5cclxuICAgIHJldHVybiBzaXplc1BhcmFtcy5pbWFnZUxldmVsO1xyXG59O1xyXG5cclxuSW1hZ2VQYXJhbXNSZXRyaWV2ZXJQcm94eS5wcm90b3R5cGUuZ2V0SW1hZ2VXaWR0aCA9IGZ1bmN0aW9uIGdldEltYWdlV2lkdGgoKSB7XHJcbiAgICB2YXIgc2l6ZXNQYXJhbXMgPSB0aGlzLmdldEltYWdlUGFyYW1zKCk7XHJcblxyXG4gICAgcmV0dXJuIHNpemVzUGFyYW1zLmltYWdlV2lkdGg7XHJcbn07XHJcblxyXG5JbWFnZVBhcmFtc1JldHJpZXZlclByb3h5LnByb3RvdHlwZS5nZXRJbWFnZUhlaWdodCA9IGZ1bmN0aW9uIGdldEltYWdlSGVpZ2h0KCkge1xyXG4gICAgdmFyIHNpemVzUGFyYW1zID0gdGhpcy5nZXRJbWFnZVBhcmFtcygpO1xyXG5cclxuICAgIHJldHVybiBzaXplc1BhcmFtcy5pbWFnZUhlaWdodDtcclxufTtcclxuXHJcbkltYWdlUGFyYW1zUmV0cmlldmVyUHJveHkucHJvdG90eXBlLmdldE51bVJlc29sdXRpb25MZXZlbHNGb3JMaW1pdHRlZFZpZXdlciA9IGZ1bmN0aW9uIGdldE51bVJlc29sdXRpb25MZXZlbHNGb3JMaW1pdHRlZFZpZXdlcigpIHtcclxuICAgIHZhciBzaXplc1BhcmFtcyA9IHRoaXMuZ2V0SW1hZ2VQYXJhbXMoKTtcclxuXHJcbiAgICByZXR1cm4gc2l6ZXNQYXJhbXMubnVtUmVzb2x1dGlvbkxldmVsc0ZvckxpbWl0dGVkVmlld2VyO1xyXG59O1xyXG5cclxuSW1hZ2VQYXJhbXNSZXRyaWV2ZXJQcm94eS5wcm90b3R5cGUuZ2V0TG93ZXN0UXVhbGl0eSA9IGZ1bmN0aW9uIGdldExvd2VzdFF1YWxpdHkoKSB7XHJcbiAgICB2YXIgc2l6ZXNQYXJhbXMgPSB0aGlzLmdldEltYWdlUGFyYW1zKCk7XHJcblxyXG4gICAgcmV0dXJuIHNpemVzUGFyYW1zLmxvd2VzdFF1YWxpdHk7XHJcbn07XHJcblxyXG5JbWFnZVBhcmFtc1JldHJpZXZlclByb3h5LnByb3RvdHlwZS5nZXRIaWdoZXN0UXVhbGl0eSA9IGZ1bmN0aW9uIGdldEhpZ2hlc3RRdWFsaXR5KCkge1xyXG4gICAgdmFyIHNpemVzUGFyYW1zID0gdGhpcy5nZXRJbWFnZVBhcmFtcygpO1xyXG5cclxuICAgIHJldHVybiBzaXplc1BhcmFtcy5oaWdoZXN0UXVhbGl0eTtcclxufTtcclxuXHJcbkltYWdlUGFyYW1zUmV0cmlldmVyUHJveHkucHJvdG90eXBlLmdldEltYWdlUGFyYW1zID0gZnVuY3Rpb24gZ2V0SW1hZ2VQYXJhbXMoKSB7XHJcbiAgICBpZiAoIXRoaXMuX3NpemVzUGFyYW1zKSB7XHJcbiAgICAgICAgdGhpcy5fc2l6ZXNQYXJhbXMgPSB0aGlzLl9nZXRJbWFnZVBhcmFtc0ludGVybmFsKCk7XHJcbiAgICAgICAgaWYgKCF0aGlzLl9zaXplc1BhcmFtcykge1xyXG4gICAgICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBnZXRJbWFnZVBhcmFtc0ludGVybmFsKCkgcmV0dXJuZWQgZmFsc3kgdmFsdWU7IE1heWJlIGltYWdlIG5vdCByZWFkeSB5ZXQ/JztcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKHRoaXMuX3NpemVzUGFyYW1zLmltYWdlTGV2ZWwgPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBnZXRJbWFnZVBhcmFtc0ludGVybmFsKCkgcmVzdWx0IGhhcyBubyBpbWFnZUxldmVsIHByb3BlcnR5JztcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKHRoaXMuX3NpemVzUGFyYW1zLmltYWdlV2lkdGggPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBnZXRJbWFnZVBhcmFtc0ludGVybmFsKCkgcmVzdWx0IGhhcyBubyBpbWFnZVdpZHRoIHByb3BlcnR5JztcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKHRoaXMuX3NpemVzUGFyYW1zLmltYWdlSGVpZ2h0ID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogZ2V0SW1hZ2VQYXJhbXNJbnRlcm5hbCgpIHJlc3VsdCBoYXMgbm8gaW1hZ2VIZWlnaHQgcHJvcGVydHknO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBpZiAodGhpcy5fc2l6ZXNQYXJhbXMubnVtUmVzb2x1dGlvbkxldmVsc0ZvckxpbWl0dGVkVmlld2VyID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogZ2V0SW1hZ2VQYXJhbXNJbnRlcm5hbCgpIHJlc3VsdCBoYXMgbm8gbnVtUmVzb2x1dGlvbkxldmVsc0ZvckxpbWl0dGVkVmlld2VyIHByb3BlcnR5JztcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKHRoaXMuX3NpemVzUGFyYW1zLmxvd2VzdFF1YWxpdHkgPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBnZXRJbWFnZVBhcmFtc0ludGVybmFsKCkgcmVzdWx0IGhhcyBubyBsb3dlc3RRdWFsaXR5IHByb3BlcnR5JztcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKHRoaXMuX3NpemVzUGFyYW1zLmhpZ2hlc3RRdWFsaXR5ID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogZ2V0SW1hZ2VQYXJhbXNJbnRlcm5hbCgpIHJlc3VsdCBoYXMgbm8gaGlnaGVzdFF1YWxpdHkgcHJvcGVydHknO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuICAgIFxyXG4gICAgcmV0dXJuIHRoaXMuX3NpemVzUGFyYW1zO1xyXG59O1xyXG5cclxuSW1hZ2VQYXJhbXNSZXRyaWV2ZXJQcm94eS5wcm90b3R5cGUuX2dldEltYWdlUGFyYW1zSW50ZXJuYWwgPSBmdW5jdGlvbiBnZXRJbWFnZVBhcmFtc0ludGVybmFsKCkge1xyXG4gICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogSW1hZ2VQYXJhbXNSZXRyaWV2ZXJQcm94eSBpbmhlcml0b3IgZGlkIG5vdCBpbXBsZW1lbnQgX2dldEltYWdlUGFyYW1zSW50ZXJuYWwoKSc7XHJcbn07IiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBXb3JrZXJQcm94eUZldGNoTWFuYWdlcjtcclxuXHJcbmZ1bmN0aW9uIFdvcmtlclByb3h5RmV0Y2hNYW5hZ2VyKGZldGNoZXIsIG9wdGlvbnMpIHtcclxuXHR0aGlzLl9vcHRpb25zID0gb3B0aW9ucyB8fCB7fTtcclxuXHR0aGlzLl9pbnRlcm5hbFNpemVzUGFyYW1zID0gbnVsbDtcclxuXHR0aGlzLl90aWxlV2lkdGggPSAwO1xyXG5cdHRoaXMuX3RpbGVIZWlnaHQgPSAwO1xyXG5cclxuXHRhc3luY1Byb3h5LkFzeW5jUHJveHlGYWN0b3J5LmluaXRpYWxpemUoXHJcbiAgICAgICAgdGhpcywgZmV0Y2hlci5zY3JpcHRzVG9JbXBvcnQsICdpbWFnZURlY29kZXJGcmFtZXdvcmsuRmV0Y2hNYW5hZ2VyJywgW2ZldGNoZXIsIG9wdGlvbnNdKTtcclxufVxyXG5cclxuYXN5bmNQcm94eS5Bc3luY1Byb3h5RmFjdG9yeS5hZGRNZXRob2RzKFdvcmtlclByb3h5RmV0Y2hNYW5hZ2VyLCB7XHJcblx0Y2xvc2U6IFt7aXNSZXR1cm5Qcm9taXNlOiB0cnVlfV0sXHJcblx0c2V0UHJpb3JpdGl6ZXJUeXBlOiBbXSxcclxuXHRzZXRGZXRjaFByaW9yaXRpemVyRGF0YTogW10sXHJcblx0c2V0SXNQcm9ncmVzc2l2ZVJlcXVlc3Q6IFtdLFxyXG5cdGNyZWF0ZU1vdmFibGVGZXRjaDogW3tpc1JldHVyblByb21pc2U6IHRydWV9XSxcclxuXHRtb3ZlRmV0Y2g6IFtdLFxyXG5cdGNyZWF0ZVJlcXVlc3Q6IFtdLFxyXG5cdG1hbnVhbEFib3J0UmVxdWVzdDogW11cclxufSk7XHJcblxyXG5Xb3JrZXJQcm94eUZldGNoTWFuYWdlci5wcm90b3R5cGUub3BlbiA9IGZ1bmN0aW9uIG9wZW4odXJsKSB7XHJcblx0dmFyIHNlbGYgPSB0aGlzO1xyXG5cdHZhciB3b3JrZXJIZWxwZXIgPSBhc3luY1Byb3h5LkFzeW5jUHJveHlGYWN0b3J5LmdldFdvcmtlckhlbHBlcih0aGlzKTtcclxuXHJcblx0cmV0dXJuIHdvcmtlckhlbHBlci5jYWxsRnVuY3Rpb24oJ29wZW4nLCBbdXJsXSwgeyBpc1JldHVyblByb21pc2U6IHRydWUgfSlcclxuXHRcdC50aGVuKGZ1bmN0aW9uKGRhdGEpIHtcclxuXHRcdFx0c2VsZi5faW50ZXJuYWxTaXplc1BhcmFtcyA9IGRhdGE7XHJcblx0XHRcdHNlbGYuZ2V0SW1hZ2VQYXJhbXMoKTtcclxuXHRcdFx0cmV0dXJuIGRhdGE7XHJcblx0XHR9KTtcclxufTtcclxuXHJcbldvcmtlclByb3h5RmV0Y2hNYW5hZ2VyLnByb3RvdHlwZS5nZXRJbWFnZVBhcmFtcyA9IGZ1bmN0aW9uIGdldEltYWdlUGFyYW1zKCkge1xyXG5cdGlmICghdGhpcy5faW50ZXJuYWxTaXplc1BhcmFtcykge1xyXG5cdFx0dGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogbm90IG9wZW5lZCB5ZXQnO1xyXG5cdH1cclxuXHRyZXR1cm4gdGhpcy5faW50ZXJuYWxTaXplc1BhcmFtcztcclxufTtcclxuXHJcbldvcmtlclByb3h5RmV0Y2hNYW5hZ2VyLnByb3RvdHlwZS5vbiA9IGZ1bmN0aW9uIG9uKGV2ZW50LCBjYWxsYmFjaykge1xyXG4gICAgdmFyIHRyYW5zZmVyYWJsZVBhdGhzID0gdGhpcy5fb3B0aW9ucy50cmFuc2ZlcmFibGVQYXRoc09mRGF0YUNhbGxiYWNrO1xyXG5cdHZhciB3b3JrZXJIZWxwZXIgPSBhc3luY1Byb3h5LkFzeW5jUHJveHlGYWN0b3J5LmdldFdvcmtlckhlbHBlcih0aGlzKTtcclxuICAgIFxyXG4gICAgdmFyIGNhbGxiYWNrV3JhcHBlciA9IHdvcmtlckhlbHBlci53cmFwQ2FsbGJhY2soXHJcbiAgICAgICAgY2FsbGJhY2ssIGV2ZW50ICsgJy1jYWxsYmFjaycsIHtcclxuICAgICAgICAgICAgaXNNdWx0aXBsZVRpbWVDYWxsYmFjazogdHJ1ZSxcclxuICAgICAgICAgICAgcGF0aHNUb1RyYW5zZmVyYWJsZXM6IHRyYW5zZmVyYWJsZVBhdGhzXHJcbiAgICAgICAgfVxyXG4gICAgKTtcclxuXHRcclxuXHRyZXR1cm4gd29ya2VySGVscGVyLmNhbGxGdW5jdGlvbignb24nLCBbZXZlbnQsIGNhbGxiYWNrV3JhcHBlcl0pO1xyXG59OyIsIid1c2Ugc3RyaWN0JztcclxuXHJcbnZhciBJbWFnZVBhcmFtc1JldHJpZXZlclByb3h5ID0gcmVxdWlyZSgnaW1hZ2UtcGFyYW1zLXJldHJpZXZlci1wcm94eS5qcycpO1xyXG52YXIgaW1hZ2VIZWxwZXJGdW5jdGlvbnMgPSByZXF1aXJlKCdpbWFnZS1oZWxwZXItZnVuY3Rpb25zLmpzJyk7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IFdvcmtlclByb3h5SW1hZ2VEZWNvZGVyO1xyXG5cclxuZnVuY3Rpb24gV29ya2VyUHJveHlJbWFnZURlY29kZXIoaW1hZ2UsIG9wdGlvbnMpIHtcclxuXHRJbWFnZVBhcmFtc1JldHJpZXZlclByb3h5LmNhbGwodGhpcyk7XHJcbiAgICBcclxuICAgIGlmICgnZnVuY3Rpb24nICE9PSB0eXBlb2YgaW1hZ2UuY3JlYXRlTGV2ZWxDYWxjdWxhdG9yKSB7XHJcbiAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogTWlzc2luZyBtZXRob2QgaW1hZ2UuY3JlYXRlTGV2ZWxDYWxjdWxhdG9yKCknO1xyXG4gICAgfVxyXG4gICAgXHJcblx0YXN5bmNQcm94eS5Bc3luY1Byb3h5RmFjdG9yeS5pbml0aWFsaXplKFxyXG4gICAgICAgIHRoaXMsXHJcbiAgICAgICAgaW1hZ2Uuc2NyaXB0c1RvSW1wb3J0LFxyXG4gICAgICAgICdpbWFnZURlY29kZXJGcmFtZXdvcmsuSW1hZ2VEZWNvZGVyJyxcclxuICAgICAgICBbe2N0b3JOYW1lOiBpbWFnZS5jdG9yTmFtZX0sIG9wdGlvbnNdKTtcclxuXHRcclxuICAgIHRoaXMuX2ltYWdlID0gaW1hZ2U7XHJcbiAgICB0aGlzLl9sZXZlbENhbGN1bGF0b3IgPSBudWxsO1xyXG5cdHRoaXMuX2ludGVybmFsU2l6ZXNQYXJhbXMgPSBudWxsO1xyXG5cdHRoaXMuX3RpbGVXaWR0aCA9IDA7XHJcblx0dGhpcy5fdGlsZUhlaWdodCA9IDA7XHJcbn1cclxuXHJcbldvcmtlclByb3h5SW1hZ2VEZWNvZGVyLnByb3RvdHlwZSA9IE9iamVjdC5jcmVhdGUoSW1hZ2VQYXJhbXNSZXRyaWV2ZXJQcm94eS5wcm90b3R5cGUpO1xyXG5cclxuYXN5bmNQcm94eS5Bc3luY1Byb3h5RmFjdG9yeS5hZGRNZXRob2RzKFdvcmtlclByb3h5SW1hZ2VEZWNvZGVyLCB7XHJcblx0c2V0RmV0Y2hQcmlvcml0aXplckRhdGE6IFtdLFxyXG5cdHNldERlY29kZVByaW9yaXRpemVyRGF0YTogW10sXHJcblx0c2V0RmV0Y2hQcmlvcml0aXplclR5cGU6IFtdLFxyXG5cdHNldERlY29kZVByaW9yaXRpemVyVHlwZTogW10sXHJcblx0Y2xvc2U6IFt7aXNSZXR1cm5Qcm9taXNlOiB0cnVlfV0sXHJcblx0Y3JlYXRlTW92YWJsZUZldGNoOiBbe2lzUmV0dXJuUHJvbWlzZTogdHJ1ZX1dLFxyXG5cdHJlcXVlc3RQaXhlbHM6IFt7aXNSZXR1cm5Qcm9taXNlOiB0cnVlfV1cclxufSk7XHJcblxyXG5Xb3JrZXJQcm94eUltYWdlRGVjb2Rlci5wcm90b3R5cGUub3BlbiA9IGZ1bmN0aW9uIG9wZW4odXJsKSB7XHJcblx0dmFyIHNlbGYgPSB0aGlzO1xyXG5cdHZhciB3b3JrZXJIZWxwZXIgPSBhc3luY1Byb3h5LkFzeW5jUHJveHlGYWN0b3J5LmdldFdvcmtlckhlbHBlcih0aGlzKTtcclxuXHRyZXR1cm4gd29ya2VySGVscGVyLmNhbGxGdW5jdGlvbignb3BlbicsIFt1cmxdLCB7IGlzUmV0dXJuUHJvbWlzZTogdHJ1ZSB9KVxyXG5cdFx0LnRoZW4oZnVuY3Rpb24oZGF0YSkge1xyXG5cdFx0XHRzZWxmLl9pbnRlcm5hbFNpemVzUGFyYW1zID0gZGF0YS5zaXplc1BhcmFtcztcclxuXHRcdFx0c2VsZi5fdGlsZVdpZHRoID0gZGF0YS5hcHBsaWNhdGl2ZVRpbGVXaWR0aDtcclxuXHRcdFx0c2VsZi5fdGlsZUhlaWdodCA9IGRhdGEuYXBwbGljYXRpdmVUaWxlSGVpZ2h0O1xyXG5cdFx0XHRzZWxmLmdldEltYWdlUGFyYW1zKCk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBzZWxmLl9sZXZlbENhbGN1bGF0b3IgPSBzZWxmLl9pbWFnZS5jcmVhdGVMZXZlbENhbGN1bGF0b3Ioc2VsZik7XHJcbiAgICAgICAgICAgIGltYWdlSGVscGVyRnVuY3Rpb25zLmVuc3VyZUxldmVsQ2FsY3VsYXRvcihzZWxmLl9sZXZlbENhbGN1bGF0b3IpO1xyXG5cdFx0XHRyZXR1cm4gZGF0YTtcclxuXHRcdH0pO1xyXG59O1xyXG5cclxuV29ya2VyUHJveHlJbWFnZURlY29kZXIucHJvdG90eXBlLl9nZXRJbWFnZVBhcmFtc0ludGVybmFsID0gZnVuY3Rpb24gZ2V0SW1hZ2VQYXJhbXNJbnRlcm5hbCgpIHtcclxuXHRpZiAoIXRoaXMuX2ludGVybmFsU2l6ZXNQYXJhbXMpIHtcclxuXHRcdHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IG5vdCBvcGVuZWQgeWV0JztcclxuXHR9XHJcblx0cmV0dXJuIHRoaXMuX2ludGVybmFsU2l6ZXNQYXJhbXM7XHJcbn07XHJcblxyXG5Xb3JrZXJQcm94eUltYWdlRGVjb2Rlci5wcm90b3R5cGUuZ2V0VGlsZVdpZHRoID0gZnVuY3Rpb24gZ2V0VGlsZVdpZHRoKCkge1xyXG5cdHRoaXMuX2dldEltYWdlUGFyYW1zSW50ZXJuYWwoKTsgLy8gZW5zdXJlIGFscmVhZHkgb3BlbmVkXHJcblx0cmV0dXJuIHRoaXMuX3RpbGVXaWR0aDtcclxufTtcclxuXHJcbldvcmtlclByb3h5SW1hZ2VEZWNvZGVyLnByb3RvdHlwZS5nZXRUaWxlSGVpZ2h0ID0gZnVuY3Rpb24gZ2V0VGlsZUhlaWdodCgpIHtcclxuXHR0aGlzLl9nZXRJbWFnZVBhcmFtc0ludGVybmFsKCk7IC8vIGVuc3VyZSBhbHJlYWR5IG9wZW5lZFxyXG5cdHJldHVybiB0aGlzLl90aWxlSGVpZ2h0O1xyXG59O1xyXG5cclxuV29ya2VyUHJveHlJbWFnZURlY29kZXIucHJvdG90eXBlLm9uRmV0Y2hlckV2ZW50ID0gZnVuY3Rpb24gb25GZXRjaGVyRXZlbnQoZXZlbnQsIGNhbGxiYWNrKSB7XHJcblx0dmFyIHRyYW5zZmVyYWJsZXM7XHJcblxyXG5cdHZhciB3b3JrZXJIZWxwZXIgPSBhc3luY1Byb3h5LkFzeW5jUHJveHlGYWN0b3J5LmdldFdvcmtlckhlbHBlcih0aGlzKTtcclxuICAgIFxyXG5cdHZhciBpbnRlcm5hbENhbGxiYWNrV3JhcHBlciA9XHJcblx0XHR3b3JrZXJIZWxwZXIud3JhcENhbGxiYWNrKFxyXG5cdFx0XHRjYWxsYmFjaywgJ29uRmV0Y2hlckV2ZW50Q2FsbGJhY2snLCB7XHJcblx0XHRcdFx0aXNNdWx0aXBsZVRpbWVDYWxsYmFjazogdHJ1ZSxcclxuXHRcdFx0XHRwYXRoc1RvVHJhbnNmZXJhYmxlczogdHJhbnNmZXJhYmxlc1xyXG5cdFx0XHR9XHJcblx0XHQpO1xyXG4gICAgXHJcbiAgICB2YXIgYXJncyA9IFtldmVudCwgY2FsbGJhY2tdO1xyXG4gICAgXHJcbiAgICB3b3JrZXJIZWxwZXIuY2FsbEZ1bmN0aW9uKCdvbicsIGFyZ3MpO1xyXG59O1xyXG5cclxuV29ya2VyUHJveHlJbWFnZURlY29kZXIucHJvdG90eXBlLnJlcXVlc3RQaXhlbHNQcm9ncmVzc2l2ZSA9IGZ1bmN0aW9uIHJlcXVlc3RQaXhlbHNQcm9ncmVzc2l2ZShcclxuXHRcdGltYWdlUGFydFBhcmFtcyxcclxuXHRcdGNhbGxiYWNrLFxyXG5cdFx0dGVybWluYXRlZENhbGxiYWNrLFxyXG5cdFx0aW1hZ2VQYXJ0UGFyYW1zTm90TmVlZGVkLFxyXG5cdFx0bW92YWJsZUhhbmRsZSkge1xyXG5cdFxyXG5cdHZhciB0cmFuc2ZlcmFibGVzO1xyXG5cdHZhciB3b3JrZXJIZWxwZXIgPSBhc3luY1Byb3h5LkFzeW5jUHJveHlGYWN0b3J5LmdldFdvcmtlckhlbHBlcih0aGlzKTtcclxuXHJcblx0Ly8gTk9URTogQ2Fubm90IHBhc3MgaXQgYXMgdHJhbnNmZXJhYmxlcyBiZWNhdXNlIGl0IGlzIHBhc3NlZCB0byBhbGxcclxuXHQvLyBsaXN0ZW5lciBjYWxsYmFja3MsIHRodXMgYWZ0ZXIgdGhlIGZpcnN0IG9uZSB0aGUgYnVmZmVyIGlzIG5vdCB2YWxpZFxyXG5cdFxyXG5cdC8vdmFyIHBhdGhUb1BpeGVsc0FycmF5ID0gWzAsICdwaXhlbHMnLCAnYnVmZmVyJ107XHJcblx0Ly90cmFuc2ZlcmFibGVzID0gW3BhdGhUb1BpeGVsc0FycmF5XTtcclxuXHRcclxuXHR2YXIgaW50ZXJuYWxDYWxsYmFja1dyYXBwZXIgPVxyXG5cdFx0d29ya2VySGVscGVyLndyYXBDYWxsYmFjayhcclxuXHRcdFx0Y2FsbGJhY2ssICdyZXF1ZXN0UGl4ZWxzUHJvZ3Jlc3NpdmVDYWxsYmFjaycsIHtcclxuXHRcdFx0XHRpc011bHRpcGxlVGltZUNhbGxiYWNrOiB0cnVlLFxyXG5cdFx0XHRcdHBhdGhzVG9UcmFuc2ZlcmFibGVzOiB0cmFuc2ZlcmFibGVzXHJcblx0XHRcdH1cclxuXHRcdCk7XHJcblx0XHJcblx0dmFyIGludGVybmFsVGVybWluYXRlZENhbGxiYWNrV3JhcHBlciA9XHJcblx0XHR3b3JrZXJIZWxwZXIud3JhcENhbGxiYWNrKFxyXG5cdFx0XHRpbnRlcm5hbFRlcm1pbmF0ZWRDYWxsYmFjaywgJ3JlcXVlc3RQaXhlbHNQcm9ncmVzc2l2ZVRlcm1pbmF0ZWRDYWxsYmFjaycsIHtcclxuXHRcdFx0XHRpc011bHRpcGxlVGltZUNhbGxiYWNrOiBmYWxzZVxyXG5cdFx0XHR9XHJcblx0XHQpO1xyXG5cdFx0XHRcclxuXHR2YXIgYXJncyA9IFtcclxuXHRcdGltYWdlUGFydFBhcmFtcyxcclxuXHRcdGludGVybmFsQ2FsbGJhY2tXcmFwcGVyLFxyXG5cdFx0aW50ZXJuYWxUZXJtaW5hdGVkQ2FsbGJhY2tXcmFwcGVyLFxyXG5cdFx0aW1hZ2VQYXJ0UGFyYW1zTm90TmVlZGVkLFxyXG5cdFx0bW92YWJsZUhhbmRsZV07XHJcblx0XHJcblx0d29ya2VySGVscGVyLmNhbGxGdW5jdGlvbigncmVxdWVzdFBpeGVsc1Byb2dyZXNzaXZlJywgYXJncyk7XHJcblx0XHRcclxuXHR2YXIgc2VsZiA9IHRoaXM7XHJcblx0XHJcblx0ZnVuY3Rpb24gaW50ZXJuYWxUZXJtaW5hdGVkQ2FsbGJhY2soaXNBYm9ydGVkKSB7XHJcblx0XHR3b3JrZXJIZWxwZXIuZnJlZUNhbGxiYWNrKGludGVybmFsQ2FsbGJhY2tXcmFwcGVyKTtcclxuXHRcdFxyXG5cdFx0dGVybWluYXRlZENhbGxiYWNrKGlzQWJvcnRlZCk7XHJcblx0fVx0XHRcclxufTsiLCIndXNlIHN0cmljdCc7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IEltYWdlRGVjb2RlcjtcclxuXHJcbnZhciBpbWFnZUhlbHBlckZ1bmN0aW9ucyA9IHJlcXVpcmUoJ2ltYWdlLWhlbHBlci1mdW5jdGlvbnMuanMnKTtcclxudmFyIERlY29kZUpvYnNQb29sID0gcmVxdWlyZSgnZGVjb2RlLWpvYnMtcG9vbC5qcycpO1xyXG52YXIgSW1hZ2VQYXJhbXNSZXRyaWV2ZXJQcm94eSA9IHJlcXVpcmUoJ2ltYWdlLXBhcmFtcy1yZXRyaWV2ZXItcHJveHkuanMnKTtcclxudmFyIEZldGNoTWFuYWdlciA9IHJlcXVpcmUoJ2ZldGNoLW1hbmFnZXIuanMnKTtcclxudmFyIFdvcmtlclByb3h5RmV0Y2hNYW5hZ2VyID0gcmVxdWlyZSgnd29ya2VyLXByb3h5LWZldGNoLW1hbmFnZXIuanMnKTtcclxudmFyIFdvcmtlclByb3h5SW1hZ2VEZWNvZGVyID0gcmVxdWlyZSgnd29ya2VyLXByb3h5LWltYWdlLWRlY29kZXIuanMnKTtcclxuXHJcbi8qIGdsb2JhbCBjb25zb2xlOiBmYWxzZSAqL1xyXG4vKiBnbG9iYWwgUHJvbWlzZTogZmFsc2UgKi9cclxuXHJcbkltYWdlRGVjb2Rlci5hbGlnblBhcmFtc1RvVGlsZXNBbmRMZXZlbCA9IGltYWdlSGVscGVyRnVuY3Rpb25zLmFsaWduUGFyYW1zVG9UaWxlc0FuZExldmVsO1xyXG5cclxuSW1hZ2VEZWNvZGVyLmZyb21JbWFnZSA9IGZ1bmN0aW9uIGZyb21JbWFnZShpbWFnZSwgb3B0aW9ucykge1xyXG4gICAgdmFyIGlzSW5kaXJlY3RDcmVhdGlvbk5lZWRlZCA9IGltYWdlSGVscGVyRnVuY3Rpb25zLmlzSW5kaXJlY3RDcmVhdGlvbk5lZWRlZChcclxuICAgICAgICBpbWFnZSwgJ2ltYWdlJywgSW1hZ2VEZWNvZGVyLl9pbWFnZUV4cGVjdGVkTWV0aG9kcyk7XHJcbiAgICBcclxuICAgIGlmICghaXNJbmRpcmVjdENyZWF0aW9uTmVlZGVkIHx8ICFpbWFnZS51c2VXb3JrZXIpIHtcclxuICAgICAgICByZXR1cm4gbmV3IEltYWdlRGVjb2RlcihpbWFnZSwgb3B0aW9ucyk7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICAgIHJldHVybiBuZXcgV29ya2VyUHJveHlJbWFnZURlY29kZXIoaW1hZ2UsIG9wdGlvbnMpO1xyXG4gICAgfVxyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVyLl9pbWFnZUV4cGVjdGVkTWV0aG9kcyA9IFsnb3BlbmVkJywgJ2dldExldmVsQ2FsY3VsYXRvcicsICdnZXRGZXRjaGVyJywgJ2dldERlY29kZXJXb3JrZXJzSW5wdXRSZXRyZWl2ZXInXTtcclxuXHJcbmZ1bmN0aW9uIEltYWdlRGVjb2RlcihpbWFnZSwgb3B0aW9ucykge1xyXG4gICAgSW1hZ2VQYXJhbXNSZXRyaWV2ZXJQcm94eS5jYWxsKHRoaXMpO1xyXG4gICAgXHJcbiAgICB0aGlzLl9vcHRpb25zID0gb3B0aW9ucyB8fCB7fTtcclxuICAgIHRoaXMuX2RlY29kZVdvcmtlcnNMaW1pdCA9IHRoaXMuX29wdGlvbnMuZGVjb2RlV29ya2Vyc0xpbWl0IHx8IDU7XHJcbiAgICBcclxuICAgIHRoaXMuX3RpbGVXaWR0aCA9IHRoaXMuX29wdGlvbnMudGlsZVdpZHRoIHx8IDI1NjtcclxuICAgIHRoaXMuX3RpbGVIZWlnaHQgPSB0aGlzLl9vcHRpb25zLnRpbGVIZWlnaHQgfHwgMjU2O1xyXG4gICAgdGhpcy5fc2hvd0xvZyA9ICEhdGhpcy5fb3B0aW9ucy5zaG93TG9nO1xyXG4gICAgdGhpcy5fZmV0Y2hNYW5hZ2VyID0gbnVsbDtcclxuICAgIHRoaXMuX2RlY29kZURlcGVuZGVuY3lXb3JrZXJzID0gbnVsbDtcclxuICAgIHRoaXMuX3JlcXVlc3RzRGVjb2RlSm9ic1Bvb2wgPSBudWxsO1xyXG4gICAgdGhpcy5fbW92YWJsZXNEZWNvZGVKb2JzUG9vbCA9IG51bGw7XHJcbiAgICB0aGlzLl9sZXZlbENhbGN1bGF0b3IgPSBudWxsO1xyXG5cdHRoaXMuX2ZldGNoUmVxdWVzdElkID0gMDtcclxuICAgIFxyXG4gICAgLyppZiAodGhpcy5fc2hvd0xvZykge1xyXG4gICAgICAgIC8vIE9sZCBJRVxyXG4gICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IHNob3dMb2cgaXMgbm90IHN1cHBvcnRlZCBvbiB0aGlzIGJyb3dzZXInO1xyXG4gICAgfSovXHJcblxyXG4gICAgdGhpcy5fbW92YWJsZVN0YXRlcyA9IFtdO1xyXG4gICAgdGhpcy5fZGVjb2RlcnMgPSBbXTtcclxuXHRcclxuXHR0aGlzLl9kZWNvZGVTY2hlZHVsZXIgPSBudWxsO1xyXG5cdHRoaXMuX2RlY29kZVByaW9yaXRpemVyID0gbnVsbDtcclxuXHR0aGlzLl9wcmlvcml0aXplclR5cGUgPSBudWxsO1xyXG5cclxuICAgIHRoaXMuX2ltYWdlID0gaW1hZ2VIZWxwZXJGdW5jdGlvbnMuZ2V0T3JDcmVhdGVJbnN0YW5jZShcclxuICAgICAgICBpbWFnZSwgJ2ltYWdlJywgSW1hZ2VEZWNvZGVyLl9pbWFnZUV4cGVjdGVkTWV0aG9kcyk7XHJcbn1cclxuXHJcbkltYWdlRGVjb2Rlci5wcm90b3R5cGUgPSBPYmplY3QuY3JlYXRlKEltYWdlUGFyYW1zUmV0cmlldmVyUHJveHkucHJvdG90eXBlKTtcclxuXHJcbkltYWdlRGVjb2Rlci5wcm90b3R5cGUuZ2V0VGlsZVdpZHRoID0gZnVuY3Rpb24gZ2V0VGlsZVdpZHRoKCkge1xyXG4gICAgcmV0dXJuIHRoaXMuX3RpbGVXaWR0aDtcclxufTtcclxuXHJcbkltYWdlRGVjb2Rlci5wcm90b3R5cGUuZ2V0VGlsZUhlaWdodCA9IGZ1bmN0aW9uIGdldFRpbGVIZWlnaHQoKSB7XHJcbiAgICByZXR1cm4gdGhpcy5fdGlsZUhlaWdodDtcclxufTtcclxuICAgIFxyXG5JbWFnZURlY29kZXIucHJvdG90eXBlLnNldEZldGNoUHJpb3JpdGl6ZXJEYXRhID1cclxuICAgIGZ1bmN0aW9uIHNldEZldGNoUHJpb3JpdGl6ZXJEYXRhKHByaW9yaXRpemVyRGF0YSkge1xyXG5cclxuICAgIHRoaXMuX3ZhbGlkYXRlRmV0Y2hlcigpO1xyXG4gICAgXHJcbiAgICB0aGlzLl9mZXRjaE1hbmFnZXIuc2V0RmV0Y2hQcmlvcml0aXplckRhdGEoXHJcbiAgICAgICAgcHJpb3JpdGl6ZXJEYXRhKTtcclxufTtcclxuXHJcbkltYWdlRGVjb2Rlci5wcm90b3R5cGUuc2V0RGVjb2RlUHJpb3JpdGl6ZXJEYXRhID1cclxuICAgIGZ1bmN0aW9uIHNldERlY29kZVByaW9yaXRpemVyRGF0YShwcmlvcml0aXplckRhdGEpIHtcclxuXHJcbiAgICB0aGlzLl92YWxpZGF0ZURlY29kZXIoKTtcclxuICAgIFxyXG4gICAgaWYgKHRoaXMuX2RlY29kZVByaW9yaXRpemVyID09PSBudWxsKSB7XHJcbiAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogTm8gZGVjb2RlIHByaW9yaXRpemVyIGhhcyBiZWVuIHNldCc7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGlmICh0aGlzLl9zaG93TG9nKSB7XHJcbiAgICAgICAgY29uc29sZS5sb2coJ3NldERlY29kZVByaW9yaXRpemVyRGF0YSgnICsgcHJpb3JpdGl6ZXJEYXRhICsgJyknKTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgdmFyIHByaW9yaXRpemVyRGF0YU1vZGlmaWVkID0gT2JqZWN0LmNyZWF0ZShwcmlvcml0aXplckRhdGEpO1xyXG4gICAgcHJpb3JpdGl6ZXJEYXRhTW9kaWZpZWQuaW1hZ2UgPSB0aGlzO1xyXG4gICAgXHJcbiAgICB0aGlzLl9kZWNvZGVQcmlvcml0aXplci5zZXRQcmlvcml0aXplckRhdGEocHJpb3JpdGl6ZXJEYXRhTW9kaWZpZWQpO1xyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVyLnByb3RvdHlwZS5zZXREZWNvZGVQcmlvcml0aXplclR5cGUgPSBmdW5jdGlvbiBzZXRQcmlvcml0aXplclR5cGUocHJpb3JpdGl6ZXJUeXBlKSB7XHJcblx0aWYgKHRoaXMuX2RlY29kZVNjaGVkdWxlciAhPT0gbnVsbCkge1xyXG5cdFx0dGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogQ2Fubm90IHNldCBwcmlvcml0aXplciB0eXBlIGF0IHRoaXMgdGltZSc7XHJcblx0fVxyXG5cdFxyXG5cdHRoaXMuX3ByaW9yaXRpemVyVHlwZSA9IHByaW9yaXRpemVyVHlwZTtcclxufTtcclxuXHJcbkltYWdlRGVjb2Rlci5wcm90b3R5cGUuc2V0RmV0Y2hQcmlvcml0aXplclR5cGUgPSBmdW5jdGlvbiBzZXRQcmlvcml0aXplclR5cGUocHJpb3JpdGl6ZXJUeXBlKSB7XHJcbiAgICB0aGlzLl92YWxpZGF0ZUZldGNoZXIoKTtcclxuXHR0aGlzLl9mZXRjaE1hbmFnZXIuc2V0UHJpb3JpdGl6ZXJUeXBlKHByaW9yaXRpemVyVHlwZSk7XHJcbn07XHJcblxyXG5JbWFnZURlY29kZXIucHJvdG90eXBlLm9wZW4gPSBmdW5jdGlvbiBvcGVuKHVybCkge1xyXG4gICAgdGhpcy5fdmFsaWRhdGVGZXRjaGVyKCk7XHJcblxyXG4gICAgdmFyIHNlbGYgPSB0aGlzO1xyXG4gICAgdmFyIHByb21pc2UgPSB0aGlzLl9mZXRjaE1hbmFnZXIub3Blbih1cmwpO1xyXG4gICAgcmV0dXJuIHByb21pc2UudGhlbihmdW5jdGlvbiAoc2l6ZXNQYXJhbXMpIHtcclxuICAgICAgICBzZWxmLl9pbnRlcm5hbFNpemVzUGFyYW1zID0gc2l6ZXNQYXJhbXM7XHJcbiAgICAgICAgc2VsZi5faW1hZ2Uub3BlbmVkKHNlbGYpO1xyXG4gICAgICAgIHNlbGYuX2xldmVsQ2FsY3VsYXRvciA9IHNlbGYuX2ltYWdlLmdldExldmVsQ2FsY3VsYXRvcigpO1xyXG4gICAgICAgIGltYWdlSGVscGVyRnVuY3Rpb25zLmVuc3VyZUxldmVsQ2FsY3VsYXRvcihzZWxmLl9sZXZlbENhbGN1bGF0b3IpO1xyXG4gICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICAgIHNpemVzUGFyYW1zOiBzaXplc1BhcmFtcyxcclxuICAgICAgICAgICAgYXBwbGljYXRpdmVUaWxlV2lkdGggOiBzZWxmLmdldFRpbGVXaWR0aCgpLFxyXG4gICAgICAgICAgICBhcHBsaWNhdGl2ZVRpbGVIZWlnaHQ6IHNlbGYuZ2V0VGlsZUhlaWdodCgpXHJcbiAgICAgICAgfTtcclxuICAgIH0pO1xyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVyLnByb3RvdHlwZS5jbG9zZSA9IGZ1bmN0aW9uIGNsb3NlKCkge1xyXG4gICAgdGhpcy5fdmFsaWRhdGVGZXRjaGVyKCk7XHJcbiAgICB0aGlzLl92YWxpZGF0ZURlY29kZXIoKTtcclxuICAgIFxyXG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCB0aGlzLl9kZWNvZGVycy5sZW5ndGg7ICsraSkge1xyXG4gICAgICAgIHRoaXMuX2RlY29kZXJzW2ldLnRlcm1pbmF0ZSgpO1xyXG4gICAgfVxyXG5cclxuXHR2YXIgc2VsZiA9IHRoaXM7XHJcbiAgICByZXR1cm4gdGhpcy5fZmV0Y2hNYW5hZ2VyLmNsb3NlKCkudGhlbihmdW5jdGlvbigpIHtcclxuXHRcdHNlbGYuX2RlY29kZURlcGVuZGVuY3lXb3JrZXJzLnRlcm1pbmF0ZUluYWN0aXZlV29ya2VycygpO1xyXG5cdH0pO1xyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVyLnByb3RvdHlwZS5vbkZldGNoZXJFdmVudCA9IGZ1bmN0aW9uIG9uRmV0Y2hlckV2ZW50KGV2ZW50LCBjYWxsYmFjaykge1xyXG4gICAgdGhpcy5fdmFsaWRhdGVGZXRjaGVyKCk7XHJcbiAgICB0aGlzLl9mZXRjaE1hbmFnZXIub24oZXZlbnQsIGNhbGxiYWNrKTtcclxufTtcclxuXHJcbkltYWdlRGVjb2Rlci5wcm90b3R5cGUuY3JlYXRlTW92YWJsZUZldGNoID0gZnVuY3Rpb24gY3JlYXRlTW92YWJsZUZldGNoKCkge1xyXG4gICAgdGhpcy5fdmFsaWRhdGVGZXRjaGVyKCk7XHJcbiAgICB0aGlzLmdldEltYWdlUGFyYW1zKCk7XHJcbiAgICBcclxuICAgIHZhciBzZWxmID0gdGhpcztcclxuICAgIFxyXG4gICAgcmV0dXJuIHRoaXMuX2ZldGNoTWFuYWdlci5jcmVhdGVNb3ZhYmxlRmV0Y2goKS50aGVuKGZ1bmN0aW9uKG1vdmFibGVIYW5kbGUpIHtcclxuICAgICAgICBzZWxmLl9tb3ZhYmxlU3RhdGVzW21vdmFibGVIYW5kbGVdID0ge1xyXG4gICAgICAgICAgICBkZWNvZGVKb2JzTGlzdGVuZXJIYW5kbGU6IG51bGxcclxuICAgICAgICB9O1xyXG4gICAgICAgIFxyXG4gICAgICAgIHJldHVybiBtb3ZhYmxlSGFuZGxlO1xyXG4gICAgfSk7XHJcbn07XHJcblxyXG5JbWFnZURlY29kZXIucHJvdG90eXBlLnJlcXVlc3RQaXhlbHMgPSBmdW5jdGlvbiByZXF1ZXN0UGl4ZWxzKGltYWdlUGFydFBhcmFtcykge1xyXG4gICAgdGhpcy5fdmFsaWRhdGVEZWNvZGVyKCk7XHJcbiAgICB0aGlzLmdldEltYWdlUGFyYW1zKCk7XHJcbiAgICBcclxuICAgIHZhciByZXNvbHZlLCByZWplY3Q7XHJcbiAgICB2YXIgYWNjdW11bGF0ZWRSZXN1bHQgPSB7fTtcclxuICAgIFxyXG4gICAgdmFyIHNlbGYgPSB0aGlzO1xyXG4gICAgdmFyIHByb21pc2UgPSBuZXcgUHJvbWlzZShzdGFydFByb21pc2UpO1xyXG4gICAgcmV0dXJuIHByb21pc2U7XHJcbiAgICBcclxuICAgIGZ1bmN0aW9uIHN0YXJ0UHJvbWlzZShyZXNvbHZlXywgcmVqZWN0Xykge1xyXG4gICAgICAgIHJlc29sdmUgPSByZXNvbHZlXztcclxuICAgICAgICByZWplY3QgPSByZWplY3RfO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHNlbGYuX3JlcXVlc3RzRGVjb2RlSm9ic1Bvb2wuZm9ya0RlY29kZUpvYnMoXHJcbiAgICAgICAgICAgIGltYWdlUGFydFBhcmFtcyxcclxuICAgICAgICAgICAgaW50ZXJuYWxDYWxsYmFjayxcclxuICAgICAgICAgICAgaW50ZXJuYWxUZXJtaW5hdGVkQ2FsbGJhY2spO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBmdW5jdGlvbiBpbnRlcm5hbENhbGxiYWNrKGRlY29kZWREYXRhKSB7XHJcbiAgICAgICAgc2VsZi5fY29weVBpeGVsc1RvQWNjdW11bGF0ZWRSZXN1bHQoZGVjb2RlZERhdGEsIGFjY3VtdWxhdGVkUmVzdWx0KTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgZnVuY3Rpb24gaW50ZXJuYWxUZXJtaW5hdGVkQ2FsbGJhY2soaXNBYm9ydGVkKSB7XHJcbiAgICAgICAgaWYgKGlzQWJvcnRlZCkge1xyXG4gICAgICAgICAgICByZWplY3QoJ1JlcXVlc3Qgd2FzIGFib3J0ZWQgZHVlIHRvIGZhaWx1cmUgb3IgcHJpb3JpdHknKTtcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICByZXNvbHZlKGFjY3VtdWxhdGVkUmVzdWx0KTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbn07XHJcblxyXG5JbWFnZURlY29kZXIucHJvdG90eXBlLnJlcXVlc3RQaXhlbHNQcm9ncmVzc2l2ZSA9IGZ1bmN0aW9uIHJlcXVlc3RQaXhlbHNQcm9ncmVzc2l2ZShcclxuICAgIGltYWdlUGFydFBhcmFtcyxcclxuICAgIGNhbGxiYWNrLFxyXG4gICAgdGVybWluYXRlZENhbGxiYWNrLFxyXG4gICAgaW1hZ2VQYXJ0UGFyYW1zTm90TmVlZGVkLFxyXG4gICAgbW92YWJsZUhhbmRsZSkge1xyXG4gICAgXHJcbiAgICB0aGlzLl92YWxpZGF0ZURlY29kZXIoKTtcclxuICAgIHRoaXMuZ2V0SW1hZ2VQYXJhbXMoKTtcclxuICAgIFxyXG4gICAgdmFyIG1vdmFibGVTdGF0ZSA9IG51bGw7XHJcbiAgICB2YXIgZGVjb2RlSm9ic1Bvb2w7XHJcbiAgICBpZiAobW92YWJsZUhhbmRsZSA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgZGVjb2RlSm9ic1Bvb2wgPSB0aGlzLl9yZXF1ZXN0c0RlY29kZUpvYnNQb29sO1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgICBkZWNvZGVKb2JzUG9vbCA9IHRoaXMuX21vdmFibGVzRGVjb2RlSm9ic1Bvb2w7XHJcbiAgICAgICAgXHJcbiAgICAgICAgbW92YWJsZVN0YXRlID0gdGhpcy5fbW92YWJsZVN0YXRlc1ttb3ZhYmxlSGFuZGxlXTtcclxuICAgICAgICBcclxuICAgICAgICBpZiAobW92YWJsZVN0YXRlID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogTW92YWJsZSBoYW5kbGUgZG9lcyBub3QgZXhpc3QnO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuICAgIFxyXG4gICAgdmFyIGxpc3RlbmVySGFuZGxlID0gZGVjb2RlSm9ic1Bvb2wuZm9ya0RlY29kZUpvYnMoXHJcbiAgICAgICAgaW1hZ2VQYXJ0UGFyYW1zLFxyXG4gICAgICAgIGNhbGxiYWNrLFxyXG4gICAgICAgIHRlcm1pbmF0ZWRDYWxsYmFjayxcclxuICAgICAgICBpbWFnZVBhcnRQYXJhbXNOb3ROZWVkZWQpO1xyXG4gICAgICAgIFxyXG4gICAgaWYgKG1vdmFibGVIYW5kbGUgIT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIGlmIChtb3ZhYmxlU3RhdGUuZGVjb2RlSm9ic0xpc3RlbmVySGFuZGxlICE9PSBudWxsKSB7XHJcbiAgICAgICAgICAgIC8vIFVucmVnaXN0ZXIgYWZ0ZXIgZm9ya2VkIG5ldyBqb2JzLCBzbyBubyB0ZXJtaW5hdGlvbiBvY2N1cnMgbWVhbndoaWxlXHJcbiAgICAgICAgICAgIGRlY29kZUpvYnNQb29sLnVucmVnaXN0ZXJGb3JrZWRKb2JzKFxyXG4gICAgICAgICAgICAgICAgbW92YWJsZVN0YXRlLmRlY29kZUpvYnNMaXN0ZW5lckhhbmRsZSk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIG1vdmFibGVTdGF0ZS5kZWNvZGVKb2JzTGlzdGVuZXJIYW5kbGUgPSBsaXN0ZW5lckhhbmRsZTtcclxuICAgICAgICB0aGlzLl9mZXRjaE1hbmFnZXIubW92ZUZldGNoKG1vdmFibGVIYW5kbGUsIGltYWdlUGFydFBhcmFtcyk7XHJcbiAgICB9IGVsc2Uge1xyXG5cdFx0dGhpcy5fZmV0Y2hNYW5hZ2VyLmNyZWF0ZVJlcXVlc3QoKyt0aGlzLl9mZXRjaFJlcXVlc3RJZCwgaW1hZ2VQYXJ0UGFyYW1zKTtcclxuXHR9XHJcbn07XHJcblxyXG5JbWFnZURlY29kZXIucHJvdG90eXBlLmdldExldmVsQ2FsY3VsYXRvciA9IGZ1bmN0aW9uIGdldExldmVsQ2FsY3VsYXRvcigpIHtcclxuICAgIHJldHVybiB0aGlzLl9sZXZlbENhbGN1bGF0b3I7XHJcbn07XHJcblxyXG4vLyBJbnRlcm5hbCBNZXRob2RzXHJcblxyXG5JbWFnZURlY29kZXIucHJvdG90eXBlLl92YWxpZGF0ZUZldGNoZXIgPSBmdW5jdGlvbiB2YWxpZGF0ZUZldGNoZXIoKSB7XHJcbiAgICBpZiAodGhpcy5fZmV0Y2hNYW5hZ2VyICE9PSBudWxsKSB7XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG5cclxuICAgIHZhciBmZXRjaGVyID0gdGhpcy5faW1hZ2UuZ2V0RmV0Y2hlcigpO1xyXG4gICAgdmFyIGlzSW5kaXJlY3RDcmVhdGlvbk5lZWRlZCA9IGltYWdlSGVscGVyRnVuY3Rpb25zLmlzSW5kaXJlY3RDcmVhdGlvbk5lZWRlZChcclxuICAgICAgICBmZXRjaGVyLCAnZmV0Y2hlcicsIEZldGNoTWFuYWdlci5mZXRjaGVyRXhwZWN0ZWRNZXRob2RzKTtcclxuICAgIFxyXG4gICAgaWYgKCFpc0luZGlyZWN0Q3JlYXRpb25OZWVkZWQgfHwgIWZldGNoZXIudXNlV29ya2VyKSB7XHJcbiAgICAgICAgdGhpcy5fZmV0Y2hNYW5hZ2VyID0gbmV3IEZldGNoTWFuYWdlcihmZXRjaGVyLCB0aGlzLl9vcHRpb25zKTtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgICAgdGhpcy5fZmV0Y2hNYW5hZ2VyID0gbmV3IFdvcmtlclByb3h5RmV0Y2hNYW5hZ2VyKFxyXG4gICAgICAgICAgICBmZXRjaGVyLCB0aGlzLl9vcHRpb25zKTtcclxuICAgIH1cclxufTtcclxuXHJcbkltYWdlRGVjb2Rlci5wcm90b3R5cGUuX3ZhbGlkYXRlRGVjb2RlciA9IGZ1bmN0aW9uIHZhbGlkYXRlQ29tcG9uZW50cygpIHtcclxuICAgIGlmICh0aGlzLl9kZWNvZGVEZXBlbmRlbmN5V29ya2VycyAhPT0gbnVsbCkge1xyXG4gICAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIFxyXG4gICAgdmFyIGRlY29kZVNjaGVkdWxpbmcgPSBpbWFnZUhlbHBlckZ1bmN0aW9ucy5jcmVhdGVQcmlvcml0aXplcihcclxuICAgICAgICB0aGlzLl9kZWNvZGVXb3JrZXJzTGltaXQsXHJcbiAgICAgICAgdGhpcy5fcHJpb3JpdGl6ZXJUeXBlLFxyXG4gICAgICAgICdkZWNvZGUnLFxyXG4gICAgICAgIHRoaXMuX3Nob3dMb2cpO1xyXG5cdFxyXG5cdGlmIChkZWNvZGVTY2hlZHVsaW5nLnByaW9yaXRpemVyICE9PSBudWxsKSB7XHJcblx0XHR0aGlzLl9kZWNvZGVTY2hlZHVsZXIgPSBuZXcgZGVwZW5kZW5jeVdvcmtlcnMuRGVwZW5kZW5jeVdvcmtlcnNUYXNrU2NoZWR1bGVyKFxyXG5cdFx0XHR0aGlzLl9kZWNvZGVXb3JrZXJzTGltaXQsIGRlY29kZVNjaGVkdWxpbmcuc2NoZWR1bGVyT3B0aW9ucyk7XHJcblx0XHR0aGlzLl9kZWNvZGVQcmlvcml0aXplciA9IGRlY29kZVNjaGVkdWxpbmcucHJpb3JpdGl6ZXI7XHJcblx0fSBlbHNlIHtcclxuXHRcdHRoaXMuX2RlY29kZVNjaGVkdWxlciA9IG5ldyByZXNvdXJjZVNjaGVkdWxlci5MaWZvU2NoZWR1bGVyKFxyXG5cdFx0XHRjcmVhdGVEdW1teVJlc291cmNlLFxyXG5cdFx0XHR0aGlzLl9kZWNvZGVXb3JrZXJzTGltaXQsXHJcblx0XHRcdGRlY29kZVNjaGVkdWxpbmcuc2NoZWR1bGVyT3B0aW9ucyk7XHJcblx0XHR0aGlzLl9kZWNvZGVQcmlvcml0aXplciA9IG51bGw7XHJcblx0fVxyXG5cclxuXHR2YXIgaW5wdXRSZXRyZWl2ZXIgPSB0aGlzLl9pbWFnZS5nZXREZWNvZGVyV29ya2Vyc0lucHV0UmV0cmVpdmVyKCk7XHJcblx0dGhpcy5fZGVjb2RlRGVwZW5kZW5jeVdvcmtlcnMgPSBuZXcgZGVwZW5kZW5jeVdvcmtlcnMuU2NoZWR1bGVyRGVwZW5kZW5jeVdvcmtlcnMoXHJcblx0XHR0aGlzLl9kZWNvZGVTY2hlZHVsZXIsIGlucHV0UmV0cmVpdmVyKTtcclxuICAgIFxyXG4gICAgdGhpcy5fcmVxdWVzdHNEZWNvZGVKb2JzUG9vbCA9IG5ldyBEZWNvZGVKb2JzUG9vbChcclxuICAgICAgICB0aGlzLl9kZWNvZGVEZXBlbmRlbmN5V29ya2VycyxcclxuXHRcdHRoaXMuX2RlY29kZVByaW9yaXRpemVyLFxyXG4gICAgICAgIHRoaXMuX3RpbGVXaWR0aCxcclxuICAgICAgICB0aGlzLl90aWxlSGVpZ2h0KTtcclxuICAgICAgICBcclxuICAgIHRoaXMuX21vdmFibGVzRGVjb2RlSm9ic1Bvb2wgPSBuZXcgRGVjb2RlSm9ic1Bvb2woXHJcbiAgICAgICAgdGhpcy5fZGVjb2RlRGVwZW5kZW5jeVdvcmtlcnMsXHJcblx0XHR0aGlzLl9kZWNvZGVQcmlvcml0aXplcixcclxuICAgICAgICB0aGlzLl90aWxlV2lkdGgsXHJcbiAgICAgICAgdGhpcy5fdGlsZUhlaWdodCk7XHJcbn07XHJcblxyXG5JbWFnZURlY29kZXIucHJvdG90eXBlLl9nZXRJbWFnZVBhcmFtc0ludGVybmFsID0gZnVuY3Rpb24gZ2V0SW1hZ2VQYXJhbXNJbnRlcm5hbCgpIHtcclxuICAgIHJldHVybiB0aGlzLl9pbnRlcm5hbFNpemVzUGFyYW1zO1xyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVyLnByb3RvdHlwZS5fY29weVBpeGVsc1RvQWNjdW11bGF0ZWRSZXN1bHQgPVxyXG4gICAgZnVuY3Rpb24gY29weVBpeGVsc1RvQWNjdW11bGF0ZWRSZXN1bHQoZGVjb2RlZERhdGEsIGFjY3VtdWxhdGVkUmVzdWx0KSB7XHJcbiAgICAgICAgXHJcbiAgICB2YXIgYnl0ZXNQZXJQaXhlbCA9IDQ7XHJcbiAgICB2YXIgc291cmNlU3RyaWRlID0gZGVjb2RlZERhdGEud2lkdGggKiBieXRlc1BlclBpeGVsO1xyXG4gICAgdmFyIHRhcmdldFN0cmlkZSA9XHJcbiAgICAgICAgZGVjb2RlZERhdGEub3JpZ2luYWxSZXF1ZXN0V2lkdGggKiBieXRlc1BlclBpeGVsO1xyXG4gICAgXHJcbiAgICBpZiAoYWNjdW11bGF0ZWRSZXN1bHQucGl4ZWxzID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICB2YXIgc2l6ZSA9XHJcbiAgICAgICAgICAgIHRhcmdldFN0cmlkZSAqIGRlY29kZWREYXRhLm9yaWdpbmFsUmVxdWVzdEhlaWdodDtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgYWNjdW11bGF0ZWRSZXN1bHQucGl4ZWxzID0gbmV3IFVpbnQ4QXJyYXkoc2l6ZSk7XHJcbiAgICAgICAgYWNjdW11bGF0ZWRSZXN1bHQueEluT3JpZ2luYWxSZXF1ZXN0ID0gMDtcclxuICAgICAgICBhY2N1bXVsYXRlZFJlc3VsdC55SW5PcmlnaW5hbFJlcXVlc3QgPSAwO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHZhciB3aWR0aCA9IGRlY29kZWREYXRhLm9yaWdpbmFsUmVxdWVzdFdpZHRoO1xyXG4gICAgICAgIGFjY3VtdWxhdGVkUmVzdWx0Lm9yaWdpbmFsUmVxdWVzdFdpZHRoID0gd2lkdGg7XHJcbiAgICAgICAgYWNjdW11bGF0ZWRSZXN1bHQud2lkdGggPSB3aWR0aDtcclxuXHJcbiAgICAgICAgdmFyIGhlaWdodCA9IGRlY29kZWREYXRhLm9yaWdpbmFsUmVxdWVzdEhlaWdodDtcclxuICAgICAgICBhY2N1bXVsYXRlZFJlc3VsdC5vcmlnaW5hbFJlcXVlc3RIZWlnaHQgPSBoZWlnaHQ7XHJcbiAgICAgICAgYWNjdW11bGF0ZWRSZXN1bHQuaGVpZ2h0ID0gaGVpZ2h0O1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBhY2N1bXVsYXRlZFJlc3VsdC5hbGxSZWxldmFudEJ5dGVzTG9hZGVkID1cclxuICAgICAgICBkZWNvZGVkRGF0YS5hbGxSZWxldmFudEJ5dGVzTG9hZGVkO1xyXG5cclxuICAgIHZhciBzb3VyY2VPZmZzZXQgPSAwO1xyXG4gICAgdmFyIHRhcmdldE9mZnNldCA9XHJcbiAgICAgICAgZGVjb2RlZERhdGEueEluT3JpZ2luYWxSZXF1ZXN0ICogYnl0ZXNQZXJQaXhlbCArIFxyXG4gICAgICAgIGRlY29kZWREYXRhLnlJbk9yaWdpbmFsUmVxdWVzdCAqIHRhcmdldFN0cmlkZTtcclxuICAgIFxyXG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBkZWNvZGVkRGF0YS5oZWlnaHQ7ICsraSkge1xyXG4gICAgICAgIHZhciBzb3VyY2VTdWJBcnJheSA9IGRlY29kZWREYXRhLnBpeGVscy5zdWJhcnJheShcclxuICAgICAgICAgICAgc291cmNlT2Zmc2V0LCBzb3VyY2VPZmZzZXQgKyBzb3VyY2VTdHJpZGUpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGFjY3VtdWxhdGVkUmVzdWx0LnBpeGVscy5zZXQoc291cmNlU3ViQXJyYXksIHRhcmdldE9mZnNldCk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgc291cmNlT2Zmc2V0ICs9IHNvdXJjZVN0cmlkZTtcclxuICAgICAgICB0YXJnZXRPZmZzZXQgKz0gdGFyZ2V0U3RyaWRlO1xyXG4gICAgfVxyXG59O1xyXG5cclxuZnVuY3Rpb24gY3JlYXRlRHVtbXlSZXNvdXJjZSgpXHJcbntcclxufSIsIid1c2Ugc3RyaWN0JztcclxuXHJcbnZhciBJbWFnZVZpZXdlciA9IHJlcXVpcmUoJ2ltYWdlLWRlY29kZXItdmlld2VyLmpzJyk7XHJcbnZhciBjYWxjdWxhdGVMZWFmbGV0RnJ1c3R1bSA9IHJlcXVpcmUoJ2xlYWZsZXQtZnJ1c3R1bS1jYWxjdWxhdG9yLmpzJyk7XHJcblxyXG4vKiBnbG9iYWwgTDogZmFsc2UgKi9cclxuLyogZ2xvYmFsIHNlbGY6IGZhbHNlICovXHJcblxyXG5pZiAoc2VsZi5MKSB7XHJcbiAgICBtb2R1bGUuZXhwb3J0cyA9IEwuQ2xhc3MuZXh0ZW5kKGNyZWF0ZUltYWdlRGVjb2RlclJlZ2lvbkxheWVyRnVuY3Rpb25zKCkpO1xyXG59IGVsc2Uge1xyXG4gICAgbW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbigpIHtcclxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogQ2Fubm90IGluc3RhbnRpYXRlIEltYWdlRGVjb2RlclJlZ2lvbkxheWVyOiBObyBMZWFmbGV0IG5hbWVzcGFjZSBpbiBzY29wZScpO1xyXG4gICAgfTtcclxufVxyXG5cclxuZnVuY3Rpb24gY3JlYXRlSW1hZ2VEZWNvZGVyUmVnaW9uTGF5ZXJGdW5jdGlvbnMoKSB7XHJcbiAgICByZXR1cm4ge1xyXG4gICAgICAgIGluaXRpYWxpemU6IGZ1bmN0aW9uIGluaXRpYWxpemUob3B0aW9ucykge1xyXG4gICAgICAgICAgICB0aGlzLl9vcHRpb25zID0gb3B0aW9ucyB8fCB7fTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGlmICh0aGlzLl9vcHRpb25zLmxhdExuZ0JvdW5kcyAhPT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgICAgICAgICB0aGlzLl9vcHRpb25zID0ge307XHJcbiAgICAgICAgICAgICAgICBmb3IgKHZhciBtZW1iZXIgaW4gb3B0aW9ucykge1xyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX29wdGlvbnNbbWVtYmVyXSA9IG9wdGlvbnNbbWVtYmVyXTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIHRoaXMuX29wdGlvbnMuY2FydG9ncmFwaGljQm91bmRzID0ge1xyXG4gICAgICAgICAgICAgICAgICAgIHdlc3Q6IG9wdGlvbnMubGF0TG5nQm91bmRzLmdldFdlc3QoKSxcclxuICAgICAgICAgICAgICAgICAgICBlYXN0OiBvcHRpb25zLmxhdExuZ0JvdW5kcy5nZXRFYXN0KCksXHJcbiAgICAgICAgICAgICAgICAgICAgc291dGg6IG9wdGlvbnMubGF0TG5nQm91bmRzLmdldFNvdXRoKCksXHJcbiAgICAgICAgICAgICAgICAgICAgbm9ydGg6IG9wdGlvbnMubGF0TG5nQm91bmRzLmdldE5vcnRoKClcclxuICAgICAgICAgICAgICAgIH07XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHRoaXMuX3RhcmdldENhbnZhcyA9IG51bGw7XHJcbiAgICAgICAgICAgIHRoaXMuX2NhbnZhc1Bvc2l0aW9uID0gbnVsbDtcclxuICAgICAgICAgICAgdGhpcy5fY2FudmFzVXBkYXRlZENhbGxiYWNrQm91bmQgPSB0aGlzLl9jYW52YXNVcGRhdGVkQ2FsbGJhY2suYmluZCh0aGlzKTtcclxuICAgICAgICAgICAgdGhpcy5faW1hZ2VWaWV3ZXIgPSBudWxsO1xyXG4gICAgICAgICAgICB0aGlzLl9leGNlcHRpb25DYWxsYmFjayA9IG51bGw7XHJcbiAgICAgICAgfSxcclxuICAgICAgICBcclxuICAgICAgICBzZXRFeGNlcHRpb25DYWxsYmFjazogZnVuY3Rpb24gc2V0RXhjZXB0aW9uQ2FsbGJhY2soZXhjZXB0aW9uQ2FsbGJhY2spIHtcclxuICAgICAgICAgICAgdGhpcy5fZXhjZXB0aW9uQ2FsbGJhY2sgPSBleGNlcHRpb25DYWxsYmFjaztcclxuICAgICAgICAgICAgaWYgKHRoaXMuX2ltYWdlVmlld2VyICE9PSBudWxsKSB7XHJcbiAgICAgICAgICAgICAgICB0aGlzLl9pbWFnZVZpZXdlci5zZXRFeGNlcHRpb25DYWxsYmFjayhleGNlcHRpb25DYWxsYmFjayk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9LFxyXG4gICAgICAgIFxyXG4gICAgICAgIF9jcmVhdGVJbWFnZTogZnVuY3Rpb24gY3JlYXRlSW1hZ2UoKSB7XHJcbiAgICAgICAgICAgIGlmICh0aGlzLl9pbWFnZVZpZXdlciA9PT0gbnVsbCkge1xyXG4gICAgICAgICAgICAgICAgdGhpcy5faW1hZ2VWaWV3ZXIgPSBuZXcgSW1hZ2VWaWV3ZXIoXHJcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5fb3B0aW9ucy5pbWFnZURlY29kZXIsXHJcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5fY2FudmFzVXBkYXRlZENhbGxiYWNrQm91bmQsXHJcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5fb3B0aW9ucyk7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIGlmICh0aGlzLl9leGNlcHRpb25DYWxsYmFjayAhPT0gbnVsbCkge1xyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX2ltYWdlVmlld2VyLnNldEV4Y2VwdGlvbkNhbGxiYWNrKHRoaXMuX2V4Y2VwdGlvbkNhbGxiYWNrKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgdGhpcy5faW1hZ2VWaWV3ZXIub3Blbih0aGlzLl9vcHRpb25zLnVybCkuY2F0Y2godGhpcy5fZXhjZXB0aW9uQ2FsbGJhY2spO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfSxcclxuXHJcbiAgICAgICAgb25BZGQ6IGZ1bmN0aW9uIG9uQWRkKG1hcCkge1xyXG4gICAgICAgICAgICBpZiAodGhpcy5fbWFwICE9PSB1bmRlZmluZWQpIHtcclxuICAgICAgICAgICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IENhbm5vdCBhZGQgdGhpcyBsYXllciB0byB0d28gbWFwcyc7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHRoaXMuX21hcCA9IG1hcDtcclxuICAgICAgICAgICAgdGhpcy5fY3JlYXRlSW1hZ2UoKTtcclxuXHJcbiAgICAgICAgICAgIC8vIGNyZWF0ZSBhIERPTSBlbGVtZW50IGFuZCBwdXQgaXQgaW50byBvbmUgb2YgdGhlIG1hcCBwYW5lc1xyXG4gICAgICAgICAgICB0aGlzLl90YXJnZXRDYW52YXMgPSBMLkRvbVV0aWwuY3JlYXRlKFxyXG4gICAgICAgICAgICAgICAgJ2NhbnZhcycsICdpbWFnZS1kZWNvZGVyLWxheWVyLWNhbnZhcyBsZWFmbGV0LXpvb20tYW5pbWF0ZWQnKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHRoaXMuX2ltYWdlVmlld2VyLnNldFRhcmdldENhbnZhcyh0aGlzLl90YXJnZXRDYW52YXMpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgdGhpcy5fY2FudmFzUG9zaXRpb24gPSBudWxsO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIG1hcC5nZXRQYW5lcygpLm1hcFBhbmUuYXBwZW5kQ2hpbGQodGhpcy5fdGFyZ2V0Q2FudmFzKTtcclxuXHJcbiAgICAgICAgICAgIC8vIGFkZCBhIHZpZXdyZXNldCBldmVudCBsaXN0ZW5lciBmb3IgdXBkYXRpbmcgbGF5ZXIncyBwb3NpdGlvbiwgZG8gdGhlIGxhdHRlclxyXG4gICAgICAgICAgICBtYXAub24oJ3ZpZXdyZXNldCcsIHRoaXMuX21vdmVkLCB0aGlzKTtcclxuICAgICAgICAgICAgbWFwLm9uKCdtb3ZlJywgdGhpcy5fbW92ZWQsIHRoaXMpO1xyXG5cclxuICAgICAgICAgICAgaWYgKEwuQnJvd3Nlci5hbnkzZCkge1xyXG4gICAgICAgICAgICAgICAgbWFwLm9uKCd6b29tYW5pbScsIHRoaXMuX2FuaW1hdGVab29tLCB0aGlzKTtcclxuICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgdGhpcy5fbW92ZWQoKTtcclxuICAgICAgICB9LFxyXG5cclxuICAgICAgICBvblJlbW92ZTogZnVuY3Rpb24gb25SZW1vdmUobWFwKSB7XHJcbiAgICAgICAgICAgIGlmIChtYXAgIT09IHRoaXMuX21hcCkge1xyXG4gICAgICAgICAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogUmVtb3ZlZCBmcm9tIHdyb25nIG1hcCc7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIG1hcC5vZmYoJ3ZpZXdyZXNldCcsIHRoaXMuX21vdmVkLCB0aGlzKTtcclxuICAgICAgICAgICAgbWFwLm9mZignbW92ZScsIHRoaXMuX21vdmVkLCB0aGlzKTtcclxuICAgICAgICAgICAgbWFwLm9mZignem9vbWFuaW0nLCB0aGlzLl9hbmltYXRlWm9vbSwgdGhpcyk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyByZW1vdmUgbGF5ZXIncyBET00gZWxlbWVudHMgYW5kIGxpc3RlbmVyc1xyXG4gICAgICAgICAgICBtYXAuZ2V0UGFuZXMoKS5tYXBQYW5lLnJlbW92ZUNoaWxkKHRoaXMuX3RhcmdldENhbnZhcyk7XHJcbiAgICAgICAgICAgIHRoaXMuX3RhcmdldENhbnZhcyA9IG51bGw7XHJcbiAgICAgICAgICAgIHRoaXMuX2NhbnZhc1Bvc2l0aW9uID0gbnVsbDtcclxuXHJcbiAgICAgICAgICAgIHRoaXMuX21hcCA9IHVuZGVmaW5lZDtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHRoaXMuX2ltYWdlVmlld2VyLmNsb3NlKCk7XHJcbiAgICAgICAgICAgIHRoaXMuX2ltYWdlVmlld2VyID0gbnVsbDtcclxuICAgICAgICB9LFxyXG4gICAgICAgIFxyXG4gICAgICAgIF9tb3ZlZDogZnVuY3Rpb24gKCkge1xyXG4gICAgICAgICAgICB0aGlzLl9tb3ZlQ2FudmFzZXMoKTtcclxuXHJcbiAgICAgICAgICAgIHZhciBmcnVzdHVtRGF0YSA9IGNhbGN1bGF0ZUxlYWZsZXRGcnVzdHVtKHRoaXMuX21hcCk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICB0aGlzLl9pbWFnZVZpZXdlci51cGRhdGVWaWV3QXJlYShmcnVzdHVtRGF0YSk7XHJcbiAgICAgICAgfSxcclxuICAgICAgICBcclxuICAgICAgICBfY2FudmFzVXBkYXRlZENhbGxiYWNrOiBmdW5jdGlvbiBjYW52YXNVcGRhdGVkQ2FsbGJhY2sobmV3UG9zaXRpb24pIHtcclxuICAgICAgICAgICAgaWYgKG5ld1Bvc2l0aW9uICE9PSBudWxsKSB7XHJcbiAgICAgICAgICAgICAgICB0aGlzLl9jYW52YXNQb3NpdGlvbiA9IG5ld1Bvc2l0aW9uO1xyXG4gICAgICAgICAgICAgICAgdGhpcy5fbW92ZUNhbnZhc2VzKCk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9LFxyXG4gICAgICAgIFxyXG4gICAgICAgIF9tb3ZlQ2FudmFzZXM6IGZ1bmN0aW9uIG1vdmVDYW52YXNlcygpIHtcclxuICAgICAgICAgICAgaWYgKHRoaXMuX2NhbnZhc1Bvc2l0aW9uID09PSBudWxsKSB7XHJcbiAgICAgICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICAgICAgLy8gdXBkYXRlIGxheWVyJ3MgcG9zaXRpb25cclxuICAgICAgICAgICAgdmFyIHdlc3QgPSB0aGlzLl9jYW52YXNQb3NpdGlvbi53ZXN0O1xyXG4gICAgICAgICAgICB2YXIgZWFzdCA9IHRoaXMuX2NhbnZhc1Bvc2l0aW9uLmVhc3Q7XHJcbiAgICAgICAgICAgIHZhciBzb3V0aCA9IHRoaXMuX2NhbnZhc1Bvc2l0aW9uLnNvdXRoO1xyXG4gICAgICAgICAgICB2YXIgbm9ydGggPSB0aGlzLl9jYW52YXNQb3NpdGlvbi5ub3J0aDtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHZhciB0b3BMZWZ0ID0gdGhpcy5fbWFwLmxhdExuZ1RvTGF5ZXJQb2ludChbbm9ydGgsIHdlc3RdKTtcclxuICAgICAgICAgICAgdmFyIGJvdHRvbVJpZ2h0ID0gdGhpcy5fbWFwLmxhdExuZ1RvTGF5ZXJQb2ludChbc291dGgsIGVhc3RdKTtcclxuICAgICAgICAgICAgdmFyIHNpemUgPSBib3R0b21SaWdodC5zdWJ0cmFjdCh0b3BMZWZ0KTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIEwuRG9tVXRpbC5zZXRQb3NpdGlvbih0aGlzLl90YXJnZXRDYW52YXMsIHRvcExlZnQpO1xyXG4gICAgICAgICAgICB0aGlzLl90YXJnZXRDYW52YXMuc3R5bGUud2lkdGggPSBzaXplLnggKyAncHgnO1xyXG4gICAgICAgICAgICB0aGlzLl90YXJnZXRDYW52YXMuc3R5bGUuaGVpZ2h0ID0gc2l6ZS55ICsgJ3B4JztcclxuICAgICAgICB9LFxyXG4gICAgICAgIFxyXG4gICAgICAgIF9hbmltYXRlWm9vbTogZnVuY3Rpb24gYW5pbWF0ZVpvb20ob3B0aW9ucykge1xyXG4gICAgICAgICAgICBpZiAodGhpcy5fY2FudmFzUG9zaXRpb24gPT09IG51bGwpIHtcclxuICAgICAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgICAgICAvLyBOT1RFOiBBbGwgbWV0aG9kIChpbmNsdWRpbmcgdXNpbmcgb2YgcHJpdmF0ZSBtZXRob2RcclxuICAgICAgICAgICAgLy8gX2xhdExuZ1RvTmV3TGF5ZXJQb2ludCkgd2FzIGNvcGllZCBmcm9tIEltYWdlT3ZlcmxheSxcclxuICAgICAgICAgICAgLy8gYXMgTGVhZmxldCBkb2N1bWVudGF0aW9uIHJlY29tbWVuZHMuXHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICB2YXIgd2VzdCA9ICB0aGlzLl9jYW52YXNQb3NpdGlvbi53ZXN0O1xyXG4gICAgICAgICAgICB2YXIgZWFzdCA9ICB0aGlzLl9jYW52YXNQb3NpdGlvbi5lYXN0O1xyXG4gICAgICAgICAgICB2YXIgc291dGggPSB0aGlzLl9jYW52YXNQb3NpdGlvbi5zb3V0aDtcclxuICAgICAgICAgICAgdmFyIG5vcnRoID0gdGhpcy5fY2FudmFzUG9zaXRpb24ubm9ydGg7XHJcblxyXG4gICAgICAgICAgICB2YXIgdG9wTGVmdCA9IHRoaXMuX21hcC5fbGF0TG5nVG9OZXdMYXllclBvaW50KFxyXG4gICAgICAgICAgICAgICAgW25vcnRoLCB3ZXN0XSwgb3B0aW9ucy56b29tLCBvcHRpb25zLmNlbnRlcik7XHJcbiAgICAgICAgICAgIHZhciBib3R0b21SaWdodCA9IHRoaXMuX21hcC5fbGF0TG5nVG9OZXdMYXllclBvaW50KFxyXG4gICAgICAgICAgICAgICAgW3NvdXRoLCBlYXN0XSwgb3B0aW9ucy56b29tLCBvcHRpb25zLmNlbnRlcik7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICB2YXIgc2NhbGUgPSB0aGlzLl9tYXAuZ2V0Wm9vbVNjYWxlKG9wdGlvbnMuem9vbSk7XHJcbiAgICAgICAgICAgIHZhciBzaXplID0gYm90dG9tUmlnaHQuc3VidHJhY3QodG9wTGVmdCk7XHJcbiAgICAgICAgICAgIHZhciBzaXplU2NhbGVkID0gc2l6ZS5tdWx0aXBseUJ5KCgxIC8gMikgKiAoMSAtIDEgLyBzY2FsZSkpO1xyXG4gICAgICAgICAgICB2YXIgb3JpZ2luID0gdG9wTGVmdC5hZGQoc2l6ZVNjYWxlZCk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICB0aGlzLl90YXJnZXRDYW52YXMuc3R5bGVbTC5Eb21VdGlsLlRSQU5TRk9STV0gPVxyXG4gICAgICAgICAgICAgICAgTC5Eb21VdGlsLmdldFRyYW5zbGF0ZVN0cmluZyhvcmlnaW4pICsgJyBzY2FsZSgnICsgc2NhbGUgKyAnKSAnO1xyXG4gICAgICAgIH1cclxuICAgIH07XHJcbn0iLCIndXNlIHN0cmljdCc7XHJcblxyXG52YXIgaW1hZ2VIZWxwZXJGdW5jdGlvbnMgPSByZXF1aXJlKCdpbWFnZS1oZWxwZXItZnVuY3Rpb25zLmpzJyk7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIGNhbGN1bGF0ZUxlYWZsZXRGcnVzdHVtKGxlYWZsZXRNYXApIHtcclxuICAgIHZhciBzY3JlZW5TaXplID0gbGVhZmxldE1hcC5nZXRTaXplKCk7XHJcbiAgICB2YXIgYm91bmRzID0gbGVhZmxldE1hcC5nZXRCb3VuZHMoKTtcclxuXHJcbiAgICB2YXIgY2FydG9ncmFwaGljQm91bmRzID0ge1xyXG4gICAgICAgIHdlc3Q6IGJvdW5kcy5nZXRXZXN0KCksXHJcbiAgICAgICAgZWFzdDogYm91bmRzLmdldEVhc3QoKSxcclxuICAgICAgICBzb3V0aDogYm91bmRzLmdldFNvdXRoKCksXHJcbiAgICAgICAgbm9ydGg6IGJvdW5kcy5nZXROb3J0aCgpXHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICB2YXIgZnJ1c3R1bURhdGEgPSBpbWFnZUhlbHBlckZ1bmN0aW9ucy5jYWxjdWxhdGVGcnVzdHVtMkRGcm9tQm91bmRzKFxyXG4gICAgICAgIGNhcnRvZ3JhcGhpY0JvdW5kcywgc2NyZWVuU2l6ZSk7XHJcblxyXG4gICAgcmV0dXJuIGZydXN0dW1EYXRhO1xyXG59OyIsIid1c2Ugc3RyaWN0JztcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gR3JpZERlY29kZXJXb3JrZXJCYXNlO1xyXG5cclxuLyogZ2xvYmFsIFByb21pc2UgOiBmYWxzZSAqL1xyXG4vKiBnbG9iYWwgSW1hZ2VEYXRhIDogZmFsc2UgKi9cclxuXHJcbmZ1bmN0aW9uIEdyaWREZWNvZGVyV29ya2VyQmFzZSgpIHtcclxuICAgIEdyaWREZWNvZGVyV29ya2VyQmFzZS5wcm90b3R5cGUuc3RhcnQgPSBmdW5jdGlvbiBkZWNvZGUoZGVjb2RlcklucHV0KSB7XHJcbiAgICAgICAgdmFyIGltYWdlUGFydFBhcmFtcyA9IGRlY29kZXJJbnB1dC5pbWFnZVBhcnRQYXJhbXM7XHJcbiAgICAgICAgdmFyIHdpZHRoICA9IGltYWdlUGFydFBhcmFtcy5tYXhYRXhjbHVzaXZlIC0gaW1hZ2VQYXJ0UGFyYW1zLm1pblg7XHJcbiAgICAgICAgdmFyIGhlaWdodCA9IGltYWdlUGFydFBhcmFtcy5tYXhZRXhjbHVzaXZlIC0gaW1hZ2VQYXJ0UGFyYW1zLm1pblk7XHJcbiAgICAgICAgdmFyIHJlc3VsdCA9IG5ldyBJbWFnZURhdGEod2lkdGgsIGhlaWdodCk7XHJcbiAgICAgICAgdmFyIHByb21pc2VzID0gW107XHJcblx0XHR2YXIgdGlsZVBvc2l0aW9uICA9IHttaW5YOiAwLCBtaW5ZOiAwLCBtYXhYRXhjbHVzaXZlOiAwLCBtYXhZRXhjbHVzaXZlOiAwLCB3aWR0aDogZGVjb2RlcklucHV0LnRpbGVXaWR0aCwgaGVpZ2h0OiBkZWNvZGVySW5wdXQudGlsZUhlaWdodH07XHJcblx0XHR2YXIgcmVnaW9uSW5JbWFnZSA9IHttaW5YOiAwLCBtaW5ZOiAwLCBtYXhYRXhjbHVzaXZlOiAwLCBtYXhZRXhjbHVzaXZlOiAwLCB3aWR0aDogMCwgaGVpZ2h0OiAwfTsgXHJcblx0XHR2YXIgb2Zmc2V0ID0ge3g6IDAsIHk6IDB9O1xyXG5cdFx0dmFyIHRpbGUgPSB7dGlsZVg6IDAsIHRpbGVZOiAwLCBsZXZlbDogMCwgcG9zaXRpb246IHRpbGVQb3NpdGlvbiwgY29udGVudDogbnVsbH07XHJcblx0XHRmb3IgKHZhciBpID0gMDsgaSA8IGRlY29kZXJJbnB1dC50aWxlSW5kaWNlcy5sZW5ndGg7ICsraSkge1xyXG5cdFx0XHR0aWxlUG9zaXRpb24ubWluWCAgICAgICAgICA9IGRlY29kZXJJbnB1dC50aWxlSW5kaWNlc1tpXS50aWxlWCAqIGRlY29kZXJJbnB1dC50aWxlV2lkdGggO1xyXG5cdFx0XHR0aWxlUG9zaXRpb24ubWluWSAgICAgICAgICA9IGRlY29kZXJJbnB1dC50aWxlSW5kaWNlc1tpXS50aWxlWSAqIGRlY29kZXJJbnB1dC50aWxlSGVpZ2h0O1xyXG5cdFx0XHR0aWxlUG9zaXRpb24ubWF4WEV4Y2x1c2l2ZSA9IHRpbGVQb3NpdGlvbi5taW5YICsgZGVjb2RlcklucHV0LnRpbGVXaWR0aDtcclxuXHRcdFx0dGlsZVBvc2l0aW9uLm1heFlFeGNsdXNpdmUgPSB0aWxlUG9zaXRpb24ubWluWSArIGRlY29kZXJJbnB1dC50aWxlSGVpZ2h0O1xyXG5cdFx0XHRcclxuXHRcdFx0cmVnaW9uSW5JbWFnZS5taW5YICAgICAgICAgID0gTWF0aC5tYXgodGlsZVBvc2l0aW9uLm1pblgsIGltYWdlUGFydFBhcmFtcy5taW5YKTtcclxuXHRcdFx0cmVnaW9uSW5JbWFnZS5taW5ZICAgICAgICAgID0gTWF0aC5tYXgodGlsZVBvc2l0aW9uLm1pblksIGltYWdlUGFydFBhcmFtcy5taW5ZKTtcclxuXHRcdFx0cmVnaW9uSW5JbWFnZS5tYXhYRXhjbHVzaXZlID0gTWF0aC5taW4odGlsZVBvc2l0aW9uLm1heFhFeGNsdXNpdmUsIGltYWdlUGFydFBhcmFtcy5tYXhYRXhjbHVzaXZlKTtcclxuXHRcdFx0cmVnaW9uSW5JbWFnZS5tYXhZRXhjbHVzaXZlID0gTWF0aC5taW4odGlsZVBvc2l0aW9uLm1heFlFeGNsdXNpdmUsIGltYWdlUGFydFBhcmFtcy5tYXhZRXhjbHVzaXZlKTtcclxuXHRcdFx0cmVnaW9uSW5JbWFnZS53aWR0aCAgICAgICAgID0gcmVnaW9uSW5JbWFnZS5tYXhYRXhjbHVzaXZlIC0gcmVnaW9uSW5JbWFnZS5taW5YO1xyXG5cdFx0XHRyZWdpb25JbkltYWdlLmhlaWdodCAgICAgICAgPSByZWdpb25JbkltYWdlLm1heFlFeGNsdXNpdmUgLSByZWdpb25JbkltYWdlLm1pblk7XHJcblx0XHRcdFxyXG5cdFx0XHRvZmZzZXQueCA9IHJlZ2lvbkluSW1hZ2UubWluWCAtIGltYWdlUGFydFBhcmFtcy5taW5YO1xyXG5cdFx0XHRvZmZzZXQueSA9IHJlZ2lvbkluSW1hZ2UubWluWSAtIGltYWdlUGFydFBhcmFtcy5taW5ZO1xyXG5cdFx0XHRcclxuXHRcdFx0dGlsZS50aWxlWSA9IGRlY29kZXJJbnB1dC50aWxlSW5kaWNlc1tpXS50aWxlWTtcclxuXHRcdFx0dGlsZS50aWxlWCA9IGRlY29kZXJJbnB1dC50aWxlSW5kaWNlc1tpXS50aWxlWDtcclxuXHRcdFx0dGlsZS5sZXZlbCA9IGRlY29kZXJJbnB1dC50aWxlSW5kaWNlc1tpXS5sZXZlbDtcclxuXHRcdFx0dGlsZS5jb250ZW50ID0gZGVjb2RlcklucHV0LnRpbGVDb250ZW50c1tpXTtcclxuICAgICAgICAgICAgcHJvbWlzZXMucHVzaCh0aGlzLmRlY29kZVJlZ2lvbihyZXN1bHQsIG9mZnNldCwgcmVnaW9uSW5JbWFnZSwgdGlsZSkpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICByZXR1cm4gUHJvbWlzZS5hbGwocHJvbWlzZXMpLnRoZW4oZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgICAgIHJldHVybiByZXN1bHQ7XHJcbiAgICAgICAgfSk7XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBHcmlkRGVjb2RlcldvcmtlckJhc2UucHJvdG90eXBlLmRlY29kZVJlZ2lvbiA9IGZ1bmN0aW9uIGRlY29kZVJlZ2lvbih0YXJnZXRJbWFnZURhdGEsIGltYWdlUGFydFBhcmFtcywga2V5LCBmZXRjaGVkRGF0YSkge1xyXG4gICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IGRlY29kZVJlZ2lvbiBpcyBub3QgaW1wbGVtZW50ZWQnO1xyXG4gICAgfTtcclxufSIsIid1c2Ugc3RyaWN0JztcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gR3JpZEZldGNoZXJCYXNlO1xyXG5cclxudmFyIFNpbXBsZUZldGNoZXJCYXNlID0gcmVxdWlyZSgnc2ltcGxlLWZldGNoZXItYmFzZS5qcycpO1xyXG52YXIgR3JpZEltYWdlQmFzZSA9IHJlcXVpcmUoJ2dyaWQtaW1hZ2UtYmFzZS5qcycpO1xyXG52YXIgTGlua2VkTGlzdCA9IHJlcXVpcmUoJ2xpbmtlZC1saXN0LmpzJyk7XHJcblxyXG4vKiBnbG9iYWwgUHJvbWlzZTogZmFsc2UgKi9cclxuXHJcbmZ1bmN0aW9uIEdyaWRGZXRjaGVyQmFzZShvcHRpb25zKSB7XHJcblx0U2ltcGxlRmV0Y2hlckJhc2UuY2FsbCh0aGlzLCBvcHRpb25zKTtcclxuXHR0aGlzLl9ncmlkRmV0Y2hlckJhc2VDYWNoZSA9IFtdO1xyXG5cdHRoaXMuX2V2ZW50cyA9IHtcclxuXHRcdCdkYXRhJzogW10sXHJcblx0XHQndGlsZS10ZXJtaW5hdGVkJzogW11cclxuXHR9O1xyXG59XHJcblxyXG5HcmlkRmV0Y2hlckJhc2UucHJvdG90eXBlID0gT2JqZWN0LmNyZWF0ZShTaW1wbGVGZXRjaGVyQmFzZS5wcm90b3R5cGUpO1xyXG5cclxuR3JpZEZldGNoZXJCYXNlLnByb3RvdHlwZS5mZXRjaFRpbGUgPSBmdW5jdGlvbihsZXZlbCwgdGlsZVgsIHRpbGVZLCBmZXRjaFRhc2spIHtcclxuXHR0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBHcmlkRmV0Y2hlckJhc2UuZmV0Y2hUaWxlIGlzIG5vdCBpbXBsZW1lbnRlZCBieSBpbmhlcml0b3InO1xyXG59O1xyXG5cclxuR3JpZEZldGNoZXJCYXNlLnByb3RvdHlwZS5vbiA9IGZ1bmN0aW9uKGV2ZW50LCBsaXN0ZW5lcikge1xyXG5cdHZhciBsaXN0ZW5lcnMgPSB0aGlzLl9ldmVudHNbZXZlbnRdO1xyXG5cdGlmICghbGlzdGVuZXJzKSB7XHJcblx0XHR0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBVbmV4cGVjdGVkIGV2ZW50ICcgKyBldmVudCArICcgaW4gR3JpZEZldGNoZXJCYXNlJztcclxuXHR9XHJcblx0bGlzdGVuZXJzLnB1c2gobGlzdGVuZXIpO1xyXG59O1xyXG5cclxuR3JpZEZldGNoZXJCYXNlLnByb3RvdHlwZS5zdGFydEZldGNoID0gZnVuY3Rpb24gc3RhcnRGZXRjaChmZXRjaENvbnRleHQsIGltYWdlUGFydFBhcmFtcykge1xyXG5cdHZhciBmZXRjaERhdGEgPSB7XHJcblx0XHRhY3RpdmVUaWxlc0NvdW50OiAwLFxyXG5cdFx0YWN0aXZlVGlsZXNDb3VudFdpdGhTaW5nbGVMaXN0ZW5lcjogMCxcclxuXHRcdHRpbGVMaXN0ZW5lcnM6IFtdLFxyXG5cdFx0ZmV0Y2hDb250ZXh0OiBmZXRjaENvbnRleHQsXHJcblx0XHRpc1BlbmRpbmdTdG9wOiBmYWxzZSxcclxuXHRcdGlzQWN0aXZlOiBmYWxzZSxcclxuXHRcdGltYWdlUGFydFBhcmFtczogaW1hZ2VQYXJ0UGFyYW1zLFxyXG5cdFx0c2VsZjogdGhpc1xyXG5cdH07XHJcblx0XHJcblx0ZmV0Y2hDb250ZXh0Lm9uKCdzdG9wJywgb25GZXRjaFN0b3AsIGZldGNoRGF0YSk7XHJcblx0ZmV0Y2hDb250ZXh0Lm9uKCdyZXN1bWUnLCBvbkZldGNoUmVzdW1lLCBmZXRjaERhdGEpO1xyXG5cdGZldGNoQ29udGV4dC5vbigndGVybWluYXRlJywgb25GZXRjaFRlcm1pbmF0ZSwgZmV0Y2hEYXRhKTtcclxuXHJcblx0dmFyIHRpbGVzVG9TdGFydFggPSBbXTtcclxuXHR2YXIgdGlsZXNUb1N0YXJ0WSA9IFtdO1xyXG5cdHZhciB0aWxlc1RvU3RhcnREZXBlbmRGZXRjaGVzID0gW107XHJcblx0XHJcblx0dmFyIHRpbGVzUmFuZ2UgPSBHcmlkSW1hZ2VCYXNlLmdldFRpbGVzUmFuZ2UodGhpcy5nZXRJbWFnZVBhcmFtcygpLCBpbWFnZVBhcnRQYXJhbXMpO1xyXG5cdGZldGNoRGF0YS5hY3RpdmVUaWxlc0NvdW50ID0gKHRpbGVzUmFuZ2UubWF4VGlsZVggLSB0aWxlc1JhbmdlLm1pblRpbGVYKSAqICh0aWxlc1JhbmdlLm1heFRpbGVZIC0gdGlsZXNSYW5nZS5taW5UaWxlWSk7XHJcblx0Zm9yICh2YXIgdGlsZVggPSB0aWxlc1JhbmdlLm1pblRpbGVYOyB0aWxlWCA8IHRpbGVzUmFuZ2UubWF4VGlsZVg7ICsrdGlsZVgpIHtcclxuXHRcdGZvciAodmFyIHRpbGVZID0gdGlsZXNSYW5nZS5taW5UaWxlWTsgdGlsZVkgPCB0aWxlc1JhbmdlLm1heFRpbGVZOyArK3RpbGVZKSB7XHJcblx0XHRcdHZhciBkZXBlbmRGZXRjaGVzID0gdGhpcy5fYWRkVG9DYWNoZSh0aWxlWCwgdGlsZVksIGZldGNoRGF0YSk7XHJcblx0XHRcdGlmIChkZXBlbmRGZXRjaGVzID09PSBudWxsKSB7XHJcblx0XHRcdFx0Y29udGludWU7XHJcblx0XHRcdH1cclxuXHJcblx0XHRcdHRpbGVzVG9TdGFydFgucHVzaCh0aWxlWCk7XHJcblx0XHRcdHRpbGVzVG9TdGFydFkucHVzaCh0aWxlWSk7XHJcblx0XHRcdHRpbGVzVG9TdGFydERlcGVuZEZldGNoZXMucHVzaChkZXBlbmRGZXRjaGVzKTtcclxuXHRcdH1cclxuXHR9XHJcblx0XHJcblx0b25GZXRjaFJlc3VtZS5jYWxsKGZldGNoRGF0YSk7XHJcblx0XHJcblx0Zm9yICh2YXIgaSA9IDA7IGkgPCB0aWxlc1RvU3RhcnRYLmxlbmd0aDsgKytpKSB7XHJcblx0XHR0aGlzLl9sb2FkVGlsZShmZXRjaERhdGEuaW1hZ2VQYXJ0UGFyYW1zLmxldmVsLCB0aWxlc1RvU3RhcnRYW2ldLCB0aWxlc1RvU3RhcnRZW2ldLCB0aWxlc1RvU3RhcnREZXBlbmRGZXRjaGVzW2ldKTtcclxuXHR9XHJcbn07XHJcblxyXG5HcmlkRmV0Y2hlckJhc2UucHJvdG90eXBlLl9jaGVja0lmU2hvdWxkU3RvcCA9IGZ1bmN0aW9uIHRyeVN0b3BGZXRjaChmZXRjaERhdGEpIHtcclxuXHRpZiAoIWZldGNoRGF0YS5pc1BlbmRpbmdTdG9wIHx8IGZldGNoRGF0YS5hY3RpdmVUaWxlc0NvdW50V2l0aFNpbmdsZUxpc3RlbmVyID4gMCkge1xyXG5cdFx0cmV0dXJuO1xyXG5cdH1cclxuXHRcclxuXHRmZXRjaERhdGEuaXNQZW5kaW5nU3RvcCA9IGZhbHNlO1xyXG5cdGZldGNoRGF0YS5pc0FjdGl2ZSA9IGZhbHNlO1xyXG5cdHRoaXMuX2NoYW5nZVNpbmdsZUxpc3RlbmVyQ291bnRPZk92ZXJsYXBwaW5nRmV0Y2hlcyhmZXRjaERhdGEsICsxKTtcclxuXHRmZXRjaERhdGEuZmV0Y2hDb250ZXh0LnN0b3BwZWQoKTtcclxufTtcclxuXHRcclxuR3JpZEZldGNoZXJCYXNlLnByb3RvdHlwZS5fY2hhbmdlU2luZ2xlTGlzdGVuZXJDb3VudE9mT3ZlcmxhcHBpbmdGZXRjaGVzID1cclxuXHRcdGZ1bmN0aW9uIGNoYW5nZVNpbmdsZUxpc3RlbmVyQ291bnRPZk92ZXJsYXBwaW5nRmV0Y2hlcyhmZXRjaERhdGEsIGFkZFZhbHVlKSB7XHJcblx0XHRcdFxyXG5cdGZvciAodmFyIGkgPSAwOyBpIDwgZmV0Y2hEYXRhLnRpbGVMaXN0ZW5lcnMubGVuZ3RoOyArK2kpIHtcclxuXHRcdHZhciB0aWxlRGVwZW5kRmV0Y2hlcyA9IGZldGNoRGF0YS50aWxlTGlzdGVuZXJzW2ldLmRlcGVuZEZldGNoZXM7XHJcblx0XHR0aGlzLl9jaGFuZ2VUaWxlc0NvdW50T2ZUaWxlRGVwZW5kRmV0Y2hlcyh0aWxlRGVwZW5kRmV0Y2hlcywgLypzaW5nbGVMaXN0ZW5lckFkZFZhbHVlPSovYWRkVmFsdWUsIC8qYWN0aXZlVGlsZXNBZGRWYWx1ZT0qLzApO1xyXG5cdH1cclxufTtcclxuXHJcbkdyaWRGZXRjaGVyQmFzZS5wcm90b3R5cGUuX2NoYW5nZVRpbGVzQ291bnRPZlRpbGVEZXBlbmRGZXRjaGVzID0gZnVuY3Rpb24odGlsZURlcGVuZEZldGNoZXMsIHNpbmdsZUxpc3RlbmVyQWRkVmFsdWUsIGFjdGl2ZVRpbGVzQWRkVmFsdWUpIHtcclxuXHR2YXIgc2luZ2xlQWN0aXZlRmV0Y2ggPSBudWxsO1xyXG5cdHZhciBoYXNBY3RpdmVGZXRjaGVzID0gZmFsc2U7XHJcblx0dmFyIGl0ZXJhdG9yID0gdGlsZURlcGVuZEZldGNoZXMuZ2V0Rmlyc3RJdGVyYXRvcigpO1xyXG5cdHdoaWxlIChpdGVyYXRvciAhPT0gbnVsbCkge1xyXG5cdFx0dmFyIGZldGNoRGF0YSA9IHRpbGVEZXBlbmRGZXRjaGVzLmdldFZhbHVlKGl0ZXJhdG9yKTtcclxuXHRcdGl0ZXJhdG9yID0gdGlsZURlcGVuZEZldGNoZXMuZ2V0TmV4dEl0ZXJhdG9yKGl0ZXJhdG9yKTtcclxuXHJcblx0XHRmZXRjaERhdGEuYWN0aXZlVGlsZXNDb3VudCArPSBhY3RpdmVUaWxlc0FkZFZhbHVlO1xyXG5cdFx0aWYgKGZldGNoRGF0YS5hY3RpdmVUaWxlc0NvdW50ID09PSAwKSB7XHJcblx0XHRcdGZldGNoRGF0YS5pc0FjdGl2ZSA9IGZhbHNlO1xyXG5cdFx0XHRmZXRjaERhdGEuZmV0Y2hDb250ZXh0LmRvbmUoKTtcclxuXHRcdH1cclxuXHJcblx0XHRpZiAoIWZldGNoRGF0YS5pc0FjdGl2ZSkge1xyXG5cdFx0XHRjb250aW51ZTtcclxuXHRcdH0gZWxzZSBpZiAoc2luZ2xlQWN0aXZlRmV0Y2ggPT09IG51bGwpIHtcclxuXHRcdFx0c2luZ2xlQWN0aXZlRmV0Y2ggPSBmZXRjaERhdGE7XHJcblx0XHRcdGhhc0FjdGl2ZUZldGNoZXMgPSB0cnVlO1xyXG5cdFx0fSBlbHNlIGlmIChoYXNBY3RpdmVGZXRjaGVzKSB7XHJcblx0XHRcdC8vIE5vdCBzaW5nbGUgYW55bW9yZVxyXG5cdFx0XHRzaW5nbGVBY3RpdmVGZXRjaCA9IG51bGw7XHJcblx0XHRcdGlmICghYWN0aXZlVGlsZXNBZGRWYWx1ZSkge1xyXG5cdFx0XHRcdGJyZWFrO1xyXG5cdFx0XHR9XHJcblx0XHR9XHJcblx0fVxyXG5cdFxyXG5cdGlmIChzaW5nbGVBY3RpdmVGZXRjaCAhPT0gbnVsbCkge1xyXG5cdFx0c2luZ2xlQWN0aXZlRmV0Y2guYWN0aXZlVGlsZXNDb3VudFdpdGhTaW5nbGVMaXN0ZW5lciArPSBzaW5nbGVMaXN0ZW5lckFkZFZhbHVlO1xyXG5cdFx0dGhpcy5fY2hlY2tJZlNob3VsZFN0b3Aoc2luZ2xlQWN0aXZlRmV0Y2gpO1xyXG5cdH1cclxufTtcclxuXHJcbmZ1bmN0aW9uIG9uRmV0Y2hTdG9wKCkge1xyXG5cdC8qIGpzaGludCB2YWxpZHRoaXM6IHRydWUgKi9cclxuXHR2YXIgZmV0Y2hEYXRhID0gdGhpcztcclxuXHJcblx0ZmV0Y2hEYXRhLmlzUGVuZGluZ1N0b3AgPSB0cnVlO1xyXG5cdGZldGNoRGF0YS5zZWxmLl9jaGVja0lmU2hvdWxkU3RvcChmZXRjaERhdGEpO1xyXG59XHJcblxyXG5mdW5jdGlvbiBvbkZldGNoUmVzdW1lKCkge1xyXG5cdC8qIGpzaGludCB2YWxpZHRoaXM6IHRydWUgKi9cclxuXHR2YXIgZmV0Y2hEYXRhID0gdGhpcztcclxuXHRmZXRjaERhdGEuaXNQZW5kaW5nU3RvcCA9IGZhbHNlO1xyXG5cdFxyXG5cdGZldGNoRGF0YS5zZWxmLl9jaGFuZ2VTaW5nbGVMaXN0ZW5lckNvdW50T2ZPdmVybGFwcGluZ0ZldGNoZXMoZmV0Y2hEYXRhLCAtMSk7XHJcblx0ZmV0Y2hEYXRhLmlzQWN0aXZlID0gdHJ1ZTtcclxufVxyXG5cclxuZnVuY3Rpb24gb25GZXRjaFRlcm1pbmF0ZSgpIHtcclxuXHQvKiBqc2hpbnQgdmFsaWR0aGlzOiB0cnVlICovXHJcblx0dmFyIGZldGNoRGF0YSA9IHRoaXM7XHJcblx0XHJcblx0aWYgKGZldGNoRGF0YS5pc0FjdGl2ZSkge1xyXG5cdFx0dGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogVW5leHBlY3RlZCBncmlkIGZldGNoIHRlcm1pbmF0ZWQgb2YgYSBzdGlsbCBhY3RpdmUgZmV0Y2gnO1xyXG5cdH1cclxuXHRcclxuXHRmb3IgKHZhciBpID0gMDsgaSA8IGZldGNoRGF0YS50aWxlTGlzdGVuZXJzLmxlbmd0aDsgKytpKSB7XHJcblx0XHRmZXRjaERhdGEudGlsZUxpc3RlbmVyc1tpXS5kZXBlbmRGZXRjaGVzLnJlbW92ZShmZXRjaERhdGEudGlsZUxpc3RlbmVyc1tpXS5pdGVyYXRvcik7XHJcblx0fVxyXG59XHJcblxyXG5HcmlkRmV0Y2hlckJhc2UucHJvdG90eXBlLl9sb2FkVGlsZSA9IGZ1bmN0aW9uIGxvYWRUaWxlKGxldmVsLCB0aWxlWCwgdGlsZVksIGRlcGVuZEZldGNoZXMpIHtcclxuXHR2YXIgaXNUZXJtaW5hdGVkID0gZmFsc2U7XHJcblx0dmFyIHRpbGVLZXkgPSB7XHJcblx0XHRmZXRjaFdhaXRUYXNrOiB0cnVlLFxyXG5cdFx0dGlsZVg6IHRpbGVYLFxyXG5cdFx0dGlsZVk6IHRpbGVZLFxyXG5cdFx0bGV2ZWw6IGxldmVsXHJcblx0fTtcclxuXHRcclxuXHR2YXIgc2VsZiA9IHRoaXM7XHJcblx0dGhpcy5mZXRjaFRpbGUobGV2ZWwsIHRpbGVYLCB0aWxlWSwge1xyXG5cdFx0b25EYXRhOiBmdW5jdGlvbihyZXN1bHQpIHtcclxuXHRcdFx0aWYgKGlzVGVybWluYXRlZCkge1xyXG5cdFx0XHRcdHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IGFscmVhZHkgdGVybWluYXRlZCBpbiBHcmlkRmV0Y2hlckJhc2UuZmV0Y2hUaWxlKCknO1xyXG5cdFx0XHR9XHJcblx0XHRcdHZhciBkYXRhID0ge1xyXG5cdFx0XHRcdHRpbGVLZXk6IHRpbGVLZXksXHJcblx0XHRcdFx0dGlsZUNvbnRlbnQ6IHJlc3VsdFxyXG5cdFx0XHR9O1xyXG5cdFx0XHRmb3IgKHZhciBpID0gMDsgaSA8IHNlbGYuX2V2ZW50cy5kYXRhLmxlbmd0aDsgKytpKSB7XHJcblx0XHRcdFx0c2VsZi5fZXZlbnRzLmRhdGFbaV0oZGF0YSk7XHJcblx0XHRcdH1cclxuXHRcdH0sXHJcblx0XHRcclxuXHRcdG9uVGVybWluYXRlZDogZnVuY3Rpb24oKSB7XHJcblx0XHRcdGlmIChpc1Rlcm1pbmF0ZWQpIHtcclxuXHRcdFx0XHR0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBkb3VibGUgdGVybWluYXRpb24gaW4gR3JpZEZldGNoZXJCYXNlLmZldGNoVGlsZSgpJztcclxuXHRcdFx0fVxyXG5cdFx0XHRpZiAoc2VsZi5fZ3JpZEZldGNoZXJCYXNlQ2FjaGVbbGV2ZWxdW3RpbGVYXVt0aWxlWV0gIT09IGRlcGVuZEZldGNoZXMpIHtcclxuXHRcdFx0XHR0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBVbmV4cGVjdGVkIGZldGNoIGluIEdyaWRGZXRjaGVyQmFzZS5ncmlkRmV0Y2hlckJhc2VDYWNoZSc7XHJcblx0XHRcdH1cclxuXHRcdFx0aXNUZXJtaW5hdGVkID0gdHJ1ZTtcclxuXHRcdFx0c2VsZi5fZ3JpZEZldGNoZXJCYXNlQ2FjaGVbbGV2ZWxdW3RpbGVYXVt0aWxlWV0gPSBudWxsO1xyXG5cdFx0XHRcclxuXHRcdFx0Zm9yICh2YXIgaSA9IDA7IGkgPCBzZWxmLl9ldmVudHNbJ3RpbGUtdGVybWluYXRlZCddLmxlbmd0aDsgKytpKSB7XHJcblx0XHRcdFx0c2VsZi5fZXZlbnRzWyd0aWxlLXRlcm1pbmF0ZWQnXVtpXSh0aWxlS2V5KTtcclxuXHRcdFx0fVxyXG5cdFx0XHRcclxuXHRcdFx0c2VsZi5fY2hhbmdlVGlsZXNDb3VudE9mVGlsZURlcGVuZEZldGNoZXMoZGVwZW5kRmV0Y2hlcywgLypzaW5nbGVMaXN0ZW5lckFkZFZhbHVlPSovLTEsIC8qYWN0aXZlVGlsZXNBZGRWYWx1ZT0qLy0xKTtcclxuXHRcdH1cclxuXHR9KTtcclxufTtcclxuXHJcbkdyaWRGZXRjaGVyQmFzZS5wcm90b3R5cGUuX2FkZFRvQ2FjaGUgPSBmdW5jdGlvbiBhZGRUb0NhY2hlKHRpbGVYLCB0aWxlWSwgZmV0Y2hEYXRhKSB7XHJcblx0dmFyIGxldmVsQ2FjaGUgPSB0aGlzLl9ncmlkRmV0Y2hlckJhc2VDYWNoZVtmZXRjaERhdGEuaW1hZ2VQYXJ0UGFyYW1zLmxldmVsXTtcclxuXHRpZiAoIWxldmVsQ2FjaGUpIHtcclxuXHRcdGxldmVsQ2FjaGUgPSBbXTtcclxuXHRcdHRoaXMuX2dyaWRGZXRjaGVyQmFzZUNhY2hlW2ZldGNoRGF0YS5pbWFnZVBhcnRQYXJhbXMubGV2ZWxdID0gbGV2ZWxDYWNoZTtcclxuXHR9XHJcblx0XHJcblx0dmFyIHhDYWNoZSA9IGxldmVsQ2FjaGVbdGlsZVhdO1xyXG5cdGlmICgheENhY2hlKSB7XHJcblx0XHR4Q2FjaGUgPSBbXTtcclxuXHRcdGxldmVsQ2FjaGVbdGlsZVhdID0geENhY2hlO1xyXG5cdH1cclxuXHRcclxuXHR2YXIgZGVwZW5kRmV0Y2hlcyA9IHhDYWNoZVt0aWxlWV07XHJcblx0dmFyIGlzU2luZ2xlID0gZmFsc2U7XHJcblx0aWYgKCFkZXBlbmRGZXRjaGVzKSB7XHJcblx0XHRkZXBlbmRGZXRjaGVzID0gbmV3IExpbmtlZExpc3QoKTtcclxuXHRcdHhDYWNoZVt0aWxlWV0gPSBkZXBlbmRGZXRjaGVzO1xyXG5cdFx0KytmZXRjaERhdGEuYWN0aXZlVGlsZXNDb3VudFdpdGhTaW5nbGVMaXN0ZW5lcjtcclxuXHRcdGlzU2luZ2xlID0gdHJ1ZTtcclxuXHR9XHJcblx0XHJcblx0ZmV0Y2hEYXRhLnRpbGVMaXN0ZW5lcnMucHVzaCh7XHJcblx0XHRkZXBlbmRGZXRjaGVzOiBkZXBlbmRGZXRjaGVzLFxyXG5cdFx0aXRlcmF0b3I6IGRlcGVuZEZldGNoZXMuYWRkKGZldGNoRGF0YSlcclxuXHR9KTtcclxuXHRyZXR1cm4gaXNTaW5nbGUgPyBkZXBlbmRGZXRjaGVzIDogbnVsbDtcclxufTsiLCIndXNlIHN0cmljdCc7XHJcblxyXG52YXIgR3JpZExldmVsQ2FsY3VsYXRvciA9IHJlcXVpcmUoJ2dyaWQtbGV2ZWwtY2FsY3VsYXRvci5qcycpO1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBHcmlkSW1hZ2VCYXNlO1xyXG5cclxuLyogZ2xvYmFsIFByb21pc2U6IGZhbHNlICovXHJcblxyXG52YXIgRkVUQ0hfV0FJVF9UQVNLID0gMDtcclxudmFyIERFQ09ERV9UQVNLID0gMTtcclxuXHJcbmZ1bmN0aW9uIEdyaWRJbWFnZUJhc2UoZmV0Y2hlcikge1xyXG5cdHRoaXMuX2ZldGNoZXIgPSBmZXRjaGVyO1xyXG5cdHRoaXMuX2ltYWdlUGFyYW1zID0gbnVsbDtcclxuXHR0aGlzLl93YWl0aW5nRmV0Y2hlcyA9IHt9O1xyXG4gICAgdGhpcy5fbGV2ZWxDYWxjdWxhdG9yID0gbnVsbDtcclxufVxyXG5cclxuR3JpZEltYWdlQmFzZS5wcm90b3R5cGUub3BlbmVkID0gZnVuY3Rpb24gb3BlbmVkKGltYWdlRGVjb2Rlcikge1xyXG4gICAgdGhpcy5faW1hZ2VQYXJhbXMgPSBpbWFnZURlY29kZXIuZ2V0SW1hZ2VQYXJhbXMoKTtcclxuICAgIGltYWdlRGVjb2Rlci5vbkZldGNoZXJFdmVudCgnZGF0YScsIHRoaXMuX29uRGF0YUZldGNoZWQuYmluZCh0aGlzKSk7XHJcbiAgICBpbWFnZURlY29kZXIub25GZXRjaGVyRXZlbnQoJ3RpbGUtdGVybWluYXRlZCcsIHRoaXMuX29uVGlsZVRlcm1pbmF0ZWQuYmluZCh0aGlzKSk7XHJcbn07XHJcblxyXG5HcmlkSW1hZ2VCYXNlLnByb3RvdHlwZS5nZXRMZXZlbENhbGN1bGF0b3IgPSBmdW5jdGlvbiBnZXRMZXZlbENhbGN1bGF0b3IoKSB7XHJcbiAgICBpZiAodGhpcy5fbGV2ZWxDYWxjdWxhdG9yID09PSBudWxsKSB7XHJcbiAgICAgICAgdGhpcy5fbGV2ZWxDYWxjdWxhdG9yID0gbmV3IEdyaWRMZXZlbENhbGN1bGF0b3IodGhpcy5faW1hZ2VQYXJhbXMpO1xyXG4gICAgfVxyXG5cdHJldHVybiB0aGlzLl9sZXZlbENhbGN1bGF0b3I7XHJcbn07XHJcblxyXG5HcmlkSW1hZ2VCYXNlLnByb3RvdHlwZS5nZXREZWNvZGVXb3JrZXJUeXBlT3B0aW9ucyA9IGZ1bmN0aW9uIGdldERlY29kZVdvcmtlclR5cGVPcHRpb25zKCkge1xyXG5cdHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IEdyaWRJbWFnZUJhc2UuZ2V0RGVjb2RlV29ya2VyVHlwZU9wdGlvbnMgaXMgbm90IGltcGxlbWVudGVkIGJ5IGluaGVyaXRvcic7XHJcbn07XHJcblxyXG5HcmlkSW1hZ2VCYXNlLnByb3RvdHlwZS5nZXREZWNvZGVyV29ya2Vyc0lucHV0UmV0cmVpdmVyID0gZnVuY3Rpb24gZ2V0RGVjb2RlcldvcmtlcnNJbnB1dFJldHJlaXZlcigpIHtcclxuXHRyZXR1cm4gdGhpcztcclxufTtcclxuXHJcbkdyaWRJbWFnZUJhc2UucHJvdG90eXBlLmRlY29kZVRhc2tTdGFydGVkID0gZnVuY3Rpb24gZGVjb2RlVGFza1N0YXJ0ZWQodGFzaykge1xyXG5cdHZhciBzZWxmID0gdGhpcztcclxuXHR0YXNrLm9uKCdhbGxEZXBlbmRUYXNrc1Rlcm1pbmF0ZWQnLCBmdW5jdGlvbigpIHtcclxuXHRcdHNlbGYuZGF0YVJlYWR5Rm9yRGVjb2RlKHRhc2spO1xyXG5cdFx0dGFzay50ZXJtaW5hdGUoKTtcclxuXHR9KTtcclxufTtcclxuXHJcbkdyaWRJbWFnZUJhc2UucHJvdG90eXBlLmRhdGFSZWFkeUZvckRlY29kZSA9IGZ1bmN0aW9uIGRhdGFSZWFkeUZvckRlY29kZSh0YXNrKSB7XHJcblx0dGFzay5kYXRhUmVhZHkoe1xyXG5cdFx0dGlsZUNvbnRlbnRzOiB0YXNrLmRlcGVuZFRhc2tSZXN1bHRzLFxyXG5cdFx0dGlsZUluZGljZXM6IHRhc2suZGVwZW5kVGFza0tleXMsXHJcblx0XHRpbWFnZVBhcnRQYXJhbXM6IHRhc2sua2V5LFxyXG5cdFx0dGlsZVdpZHRoOiB0aGlzLl9pbWFnZVBhcmFtcy50aWxlV2lkdGgsXHJcblx0XHR0aWxlSGVpZ2h0OiB0aGlzLl9pbWFnZVBhcmFtcy50aWxlSGVpZ2h0XHJcblx0fSwgREVDT0RFX1RBU0spO1xyXG59O1xyXG5cclxuR3JpZEltYWdlQmFzZS5wcm90b3R5cGUuZ2V0RmV0Y2hlciA9IGZ1bmN0aW9uIGdldEZldGNoZXIoKSB7XHJcblx0cmV0dXJuIHRoaXMuX2ZldGNoZXI7XHJcbn07XHJcblxyXG4vLyBEZXBlbmRlbmN5V29ya2Vyc0lucHV0UmV0cmVpdmVyIGltcGxlbWVudGF0aW9uXHJcblxyXG5HcmlkSW1hZ2VCYXNlLnByb3RvdHlwZS5nZXRXb3JrZXJUeXBlT3B0aW9ucyA9IGZ1bmN0aW9uKHRhc2tUeXBlKSB7XHJcblx0aWYgKHRhc2tUeXBlID09PSBGRVRDSF9XQUlUX1RBU0spIHtcclxuXHRcdHJldHVybiBudWxsO1xyXG5cdH0gZWxzZSBpZiAodGFza1R5cGUgPT09IERFQ09ERV9UQVNLKSB7XHJcblx0XHRyZXR1cm4gdGhpcy5nZXREZWNvZGVXb3JrZXJUeXBlT3B0aW9ucygpO1xyXG5cdH0gZWxzZSB7XHJcblx0XHR0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGludGVybmFsIGVycm9yOiBHcmlkSW1hZ2VCYXNlLmdldFRhc2tUeXBlT3B0aW9ucyBnb3QgdW5leHBlY3RlZCB0YXNrIHR5cGUgJyArIHRhc2tUeXBlO1xyXG5cdH1cclxufTtcclxuXHJcbkdyaWRJbWFnZUJhc2UucHJvdG90eXBlLmdldEtleUFzU3RyaW5nID0gZnVuY3Rpb24oa2V5KSB7XHJcblx0aWYgKGtleS5mZXRjaFdhaXRUYXNrKSB7XHJcblx0XHRyZXR1cm4gJ2ZldGNoV2FpdDonICsga2V5LnRpbGVYICsgJywnICsga2V5LnRpbGVZICsgJzonICsga2V5LmxldmVsO1xyXG5cdH1cclxuXHQvLyBPdGhlcndpc2UgaXQncyBhIGltYWdlUGFydFBhcmFtcyBrZXkgcGFzc2VkIGJ5IGltYWdlRGVjb2RlckZyYW1ld29yayBsaWIuIEp1c3QgY3JlYXRlIGEgdW5pcXVlIHN0cmluZ1xyXG5cdHJldHVybiBKU09OLnN0cmluZ2lmeShrZXkpO1xyXG59O1xyXG5cclxuR3JpZEltYWdlQmFzZS5wcm90b3R5cGUudGFza1N0YXJ0ZWQgPSBmdW5jdGlvbih0YXNrKSB7XHRcclxuXHR2YXIgc2VsZiA9IHRoaXM7XHJcblx0XHJcblx0aWYgKHRhc2sua2V5LmZldGNoV2FpdFRhc2spIHtcclxuXHRcdHZhciBzdHJLZXkgPSB0aGlzLmdldEtleUFzU3RyaW5nKHRhc2sua2V5KTtcclxuXHRcdHRoaXMuX3dhaXRpbmdGZXRjaGVzW3N0cktleV0gPSB0YXNrO1xyXG5cdFx0cmV0dXJuO1xyXG5cdH1cclxuXHJcblx0aWYgKHRoaXMuX2ltYWdlUGFyYW1zID09PSBudWxsKSB7XHJcblx0XHR0aGlzLl9pbWFnZVBhcmFtcyA9IHRoaXMuZ2V0SW1hZ2VQYXJhbXMoKTsgLy8gaW1hZ2VQYXJhbXMgdGhhdCByZXR1cm5lZCBieSBmZXRjaGVyLm9wZW4oKVxyXG5cdH1cclxuXHJcblx0dmFyIGltYWdlUGFydFBhcmFtcyA9IHRhc2sua2V5O1xyXG5cdHZhciB0aWxlc1JhbmdlID0gR3JpZEltYWdlQmFzZS5nZXRUaWxlc1JhbmdlKHRoaXMuX2ltYWdlUGFyYW1zLCBpbWFnZVBhcnRQYXJhbXMpO1xyXG5cdFxyXG5cdHZhciBpID0gMDtcclxuXHRmb3IgKHZhciB0aWxlWCA9IHRpbGVzUmFuZ2UubWluVGlsZVg7IHRpbGVYIDwgdGlsZXNSYW5nZS5tYXhUaWxlWDsgKyt0aWxlWCkge1xyXG5cdFx0Zm9yICh2YXIgdGlsZVkgPSB0aWxlc1JhbmdlLm1pblRpbGVZOyB0aWxlWSA8IHRpbGVzUmFuZ2UubWF4VGlsZVk7ICsrdGlsZVkpIHtcclxuXHRcdFx0dGFzay5yZWdpc3RlclRhc2tEZXBlbmRlbmN5KHtcclxuXHRcdFx0XHRmZXRjaFdhaXRUYXNrOiB0cnVlLFxyXG5cdFx0XHRcdHRpbGVYOiB0aWxlWCxcclxuXHRcdFx0XHR0aWxlWTogdGlsZVksXHJcblx0XHRcdFx0bGV2ZWw6IGltYWdlUGFydFBhcmFtcy5sZXZlbFxyXG5cdFx0XHR9KTtcclxuXHRcdH1cclxuXHR9XHJcblx0XHJcblx0dGhpcy5kZWNvZGVUYXNrU3RhcnRlZCh0YXNrKTtcclxufTtcclxuXHJcbi8vIEF1eGlsaWFyeSBtZXRob2RzXHJcblxyXG5HcmlkSW1hZ2VCYXNlLnByb3RvdHlwZS5fb25EYXRhRmV0Y2hlZCA9IGZ1bmN0aW9uKGZldGNoZWRUaWxlKSB7XHJcblx0dmFyIHN0cktleSA9IHRoaXMuZ2V0S2V5QXNTdHJpbmcoZmV0Y2hlZFRpbGUudGlsZUtleSk7XHJcblx0dmFyIHdhaXRpbmdUYXNrID0gdGhpcy5fd2FpdGluZ0ZldGNoZXNbc3RyS2V5XTtcclxuXHRpZiAod2FpdGluZ1Rhc2spIHtcclxuXHRcdHdhaXRpbmdUYXNrLmRhdGFSZWFkeShmZXRjaGVkVGlsZS50aWxlQ29udGVudCwgRkVUQ0hfV0FJVF9UQVNLKTtcclxuXHR9XHJcbn07XHJcblxyXG5HcmlkSW1hZ2VCYXNlLnByb3RvdHlwZS5fb25UaWxlVGVybWluYXRlZCA9IGZ1bmN0aW9uKHRpbGVLZXkpIHtcclxuXHR2YXIgc3RyS2V5ID0gdGhpcy5nZXRLZXlBc1N0cmluZyh0aWxlS2V5KTtcclxuXHR2YXIgd2FpdGluZ1Rhc2sgPSB0aGlzLl93YWl0aW5nRmV0Y2hlc1tzdHJLZXldO1xyXG5cdGlmICh3YWl0aW5nVGFzaykge1xyXG5cdFx0d2FpdGluZ1Rhc2sudGVybWluYXRlKCk7XHJcblx0XHR0aGlzLl93YWl0aW5nRmV0Y2hlc1tzdHJLZXldID0gbnVsbDtcclxuXHR9XHJcbn07XHJcblxyXG5HcmlkSW1hZ2VCYXNlLmdldFRpbGVzUmFuZ2UgPSBmdW5jdGlvbihpbWFnZVBhcmFtcywgaW1hZ2VQYXJ0UGFyYW1zKSB7XHJcblx0dmFyIGxldmVsV2lkdGggID0gaW1hZ2VQYXJhbXMuaW1hZ2VXaWR0aCAgKiBNYXRoLnBvdygyLCBpbWFnZVBhcnRQYXJhbXMubGV2ZWwgLSBpbWFnZVBhcmFtcy5pbWFnZUxldmVsKTtcclxuXHR2YXIgbGV2ZWxIZWlnaHQgPSBpbWFnZVBhcmFtcy5pbWFnZUhlaWdodCAqIE1hdGgucG93KDIsIGltYWdlUGFydFBhcmFtcy5sZXZlbCAtIGltYWdlUGFyYW1zLmltYWdlTGV2ZWwpO1xyXG5cdHZhciBsZXZlbFRpbGVzWCA9IE1hdGguY2VpbChsZXZlbFdpZHRoICAvIGltYWdlUGFyYW1zLnRpbGVXaWR0aCApO1xyXG5cdHZhciBsZXZlbFRpbGVzWSA9IE1hdGguY2VpbChsZXZlbEhlaWdodCAvIGltYWdlUGFyYW1zLnRpbGVIZWlnaHQpO1xyXG5cdHJldHVybiB7XHJcblx0XHRtaW5UaWxlWDogTWF0aC5tYXgoMCwgTWF0aC5mbG9vcihpbWFnZVBhcnRQYXJhbXMubWluWCAvIGltYWdlUGFyYW1zLnRpbGVXaWR0aCApKSxcclxuXHRcdG1pblRpbGVZOiBNYXRoLm1heCgwLCBNYXRoLmZsb29yKGltYWdlUGFydFBhcmFtcy5taW5ZIC8gaW1hZ2VQYXJhbXMudGlsZUhlaWdodCkpLFxyXG5cdFx0bWF4VGlsZVg6IE1hdGgubWluKGxldmVsVGlsZXNYLCBNYXRoLmNlaWwoaW1hZ2VQYXJ0UGFyYW1zLm1heFhFeGNsdXNpdmUgLyBpbWFnZVBhcmFtcy50aWxlV2lkdGggKSksXHJcblx0XHRtYXhUaWxlWTogTWF0aC5taW4obGV2ZWxUaWxlc1ksIE1hdGguY2VpbChpbWFnZVBhcnRQYXJhbXMubWF4WUV4Y2x1c2l2ZSAvIGltYWdlUGFyYW1zLnRpbGVIZWlnaHQpKVxyXG5cdH07XHJcbn07XHJcbiIsIid1c2Ugc3RyaWN0JztcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gR3JpZExldmVsQ2FsY3VsYXRvcjtcclxuXHJcbmZ1bmN0aW9uIEdyaWRMZXZlbENhbGN1bGF0b3IoaW1hZ2VQYXJhbXMpIHtcclxuXHR0aGlzLl9pbWFnZVBhcmFtcyA9IGltYWdlUGFyYW1zO1xyXG59XHJcblxyXG5HcmlkTGV2ZWxDYWxjdWxhdG9yLnByb3RvdHlwZS5nZXRMZXZlbFdpZHRoID0gZnVuY3Rpb24gZ2V0TGV2ZWxXaWR0aChsZXZlbCkge1xyXG5cdHZhciB3aWR0aCA9IHRoaXMuX2ltYWdlUGFyYW1zLmltYWdlV2lkdGggKiBNYXRoLnBvdygyLCBsZXZlbCAtIHRoaXMuX2ltYWdlUGFyYW1zLmltYWdlTGV2ZWwpO1xyXG4gICAgcmV0dXJuIHdpZHRoO1xyXG59O1xyXG5cclxuR3JpZExldmVsQ2FsY3VsYXRvci5wcm90b3R5cGUuZ2V0TGV2ZWxIZWlnaHQgPSBmdW5jdGlvbiBnZXRMZXZlbEhlaWdodChsZXZlbCkge1xyXG5cdHZhciBoZWlnaHQgPSAgdGhpcy5faW1hZ2VQYXJhbXMuaW1hZ2VIZWlnaHQgKiBNYXRoLnBvdygyLCBsZXZlbCAtIHRoaXMuX2ltYWdlUGFyYW1zLmltYWdlTGV2ZWwpO1xyXG4gICAgcmV0dXJuIGhlaWdodDtcclxufTtcclxuXHJcbkdyaWRMZXZlbENhbGN1bGF0b3IucHJvdG90eXBlLmdldExldmVsID0gZnVuY3Rpb24gZ2V0TGV2ZWwocmVnaW9uSW1hZ2VMZXZlbCkge1xyXG5cdHZhciBsb2cyID0gTWF0aC5sb2coMik7XHJcblx0dmFyIGxldmVsWCA9IE1hdGgubG9nKHJlZ2lvbkltYWdlTGV2ZWwuc2NyZWVuV2lkdGggIC8gKHJlZ2lvbkltYWdlTGV2ZWwubWF4WEV4Y2x1c2l2ZSAtIHJlZ2lvbkltYWdlTGV2ZWwubWluWCkpIC8gbG9nMjtcclxuXHR2YXIgbGV2ZWxZID0gTWF0aC5sb2cocmVnaW9uSW1hZ2VMZXZlbC5zY3JlZW5IZWlnaHQgLyAocmVnaW9uSW1hZ2VMZXZlbC5tYXhZRXhjbHVzaXZlIC0gcmVnaW9uSW1hZ2VMZXZlbC5taW5ZKSkgLyBsb2cyO1xyXG5cdHZhciBsZXZlbCA9IE1hdGguY2VpbChNYXRoLm1pbihsZXZlbFgsIGxldmVsWSkpO1xyXG5cdGxldmVsICs9IHRoaXMuX2ltYWdlUGFyYW1zLmltYWdlTGV2ZWw7XHJcblx0XHJcblx0cmV0dXJuIGxldmVsO1xyXG59O1xyXG4iLCIndXNlIHN0cmljdCc7XHJcblxyXG52YXIgU2ltcGxlTW92YWJsZUZldGNoID0gcmVxdWlyZSgnc2ltcGxlLW1vdmFibGUtZmV0Y2guanMnKTtcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gU2ltcGxlRmV0Y2hlckJhc2U7XHJcblxyXG4vKiBnbG9iYWwgUHJvbWlzZTogZmFsc2UgKi9cclxuXHJcbmZ1bmN0aW9uIFNpbXBsZUZldGNoZXJCYXNlKG9wdGlvbnMpIHtcclxuICAgIHRoaXMuX21heEFjdGl2ZUZldGNoZXNJbk1vdmFibGVGZXRjaCA9IChvcHRpb25zIHx8IHt9KS5tYXhBY3RpdmVGZXRjaGVzSW5Nb3ZhYmxlRmV0Y2ggfHwgMjtcclxuXHR0aGlzLl9pbmRpcmVjdENsb3NlSW5kaWNhdGlvbiA9IHsgaXNDbG9zZVJlcXVlc3RlZDogZmFsc2UgfTtcclxufVxyXG5cclxuU2ltcGxlRmV0Y2hlckJhc2UucHJvdG90eXBlLnN0YXJ0TW92YWJsZUZldGNoID0gZnVuY3Rpb24gc3RhcnRNb3ZhYmxlRmV0Y2goZmV0Y2hDb250ZXh0LCBpbWFnZVBhcnRQYXJhbXMpIHtcclxuICAgIHZhciBtb3ZhYmxlRmV0Y2ggPSBuZXcgU2ltcGxlTW92YWJsZUZldGNoKFxyXG4gICAgICAgIHRoaXMsIHRoaXMuX2luZGlyZWN0Q2xvc2VJbmRpY2F0aW9uLCBmZXRjaENvbnRleHQsIHRoaXMuX21heEFjdGl2ZUZldGNoZXNJbk1vdmFibGVGZXRjaCk7XHJcbiAgICBcclxuICAgIG1vdmFibGVGZXRjaC5zdGFydChpbWFnZVBhcnRQYXJhbXMpO1xyXG59O1xyXG5cclxuU2ltcGxlRmV0Y2hlckJhc2UucHJvdG90eXBlLmNsb3NlID0gZnVuY3Rpb24gY2xvc2UoKSB7XHJcblx0aWYgKHRoaXMuc3RhcnRNb3ZhYmxlRmV0Y2ggIT09IFNpbXBsZUZldGNoZXJCYXNlLnByb3RvdHlwZS5zdGFydE1vdmFibGVGZXRjaCkge1xyXG5cdFx0dGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogTXVzdCBvdmVycmlkZSBGZXRjaGVyLmNsb3NlKCkgd2hlbiBGZXRjaGVyLnN0YXJ0TW92YWJsZUZldGNoKCkgd2FzIG92ZXJyaWRlbic7XHJcblx0fVxyXG4gICAgdGhpcy5faW5kaXJlY3RDbG9zZUluZGljYXRpb24uaXNDbG9zZVJlcXVlc3RlZCA9IHRydWU7XHJcbiAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XHJcbn07Il19
