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

var SubWorkerEmulationForChrome = require('sub-worker-emulation-for-chrome');
var AsyncProxyFactory = require('async-proxy-factory');
var AsyncProxySlave = require('async-proxy-slave');
var AsyncProxyMaster = require('async-proxy-master');
var ScriptsToImportPool = require('scripts-to-Import-Pool');
var DependencyWorkers = require('dependency-workers');
var DependencyWorkersTaskContext = require('dependency-workers-task-context');
var DependencyWorkersTask = require('dependency-workers-task');
var WrapperInputRetreiverBase = require('wrapper-input-retreiver-base');
var SchedulerTask = require('scheduler-task');
var SchedulerWrapperInputRetreiver = require('scheduler-wrapper-input-retreiver');
var SchedulerDependencyWorkers = require('scheduler-dependency-workers');
var DependencyWorkersTaskScheduler = require('dependency-workers-task-scheduler');

module.exports.SubWorkerEmulationForChrome = SubWorkerEmulationForChrome;
module.exports.AsyncProxyFactory = AsyncProxyFactory;
module.exports.AsyncProxySlave = AsyncProxySlave;
module.exports.AsyncProxyMaster = AsyncProxyMaster;
module.exports.ScriptsToImportPool = ScriptsToImportPool;
module.exports.DependencyWorkers = DependencyWorkers;
module.exports.DependencyWorkersTaskContext = DependencyWorkersTaskContext;
module.exports.DependencyWorkersTask = DependencyWorkersTask;
module.exports.WrapperInputRetreiverBase = WrapperInputRetreiverBase;
module.exports.SchedulerTask = SchedulerTask;
module.exports.SchedulerWrapperInputRetreiver = SchedulerWrapperInputRetreiver;
module.exports.SchedulerDependencyWorkers = SchedulerDependencyWorkers;
module.exports.DependencyWorkersTaskScheduler = DependencyWorkersTaskScheduler;
},{"async-proxy-factory":2,"async-proxy-master":3,"async-proxy-slave":4,"dependency-workers":9,"dependency-workers-task":8,"dependency-workers-task-context":5,"dependency-workers-task-scheduler":7,"scheduler-dependency-workers":13,"scheduler-task":14,"scheduler-wrapper-input-retreiver":15,"scripts-to-Import-Pool":17,"sub-worker-emulation-for-chrome":19,"wrapper-input-retreiver-base":16}],2:[function(require,module,exports){
'use strict';

var AsyncProxyMaster = require('async-proxy-master');

var AsyncProxyFactory = (function AsyncProxyFactoryClosure() {
    var factorySingleton = {};
	
	factorySingleton.create = function create(scriptsToImport, ctorName, methods, proxyCtor) {
		if ((!scriptsToImport) || !(scriptsToImport.length)) {
			throw 'AsyncProxyFactory error: missing scriptsToImport (2nd argument)';
		}
		if (!methods) {
			throw 'AsyncProxyFactory error: missing methods (3rd argument)';
		}
		
		var ProxyClass = proxyCtor || function() {
			var that = this;
			this.__workerHelperCtorArgs = convertArgs(arguments);
		};
		
		ProxyClass.prototype._getWorkerHelper = function getWorkerHelper() {
			if (!this.__workerHelper) {
				this.__workerHelper = new AsyncProxyMaster(
					scriptsToImport, ctorName, this.__workerHelperCtorArgs || []);
			}
			
			return this.__workerHelper;
		};
		
		for (var methodName in methods) {
			generateMethod(ProxyClass, methodName, methods[methodName] || []);
		}
		
		return ProxyClass;
	};
	
	function generateMethod(ProxyClass, methodName, methodArgsDescription) {
		if (typeof methodArgsDescription === 'function') {
			ProxyClass.prototype[methodName] = methodArgsDescription;
			return;
		}
		
		var methodOptions = methodArgsDescription[0] || {};
		ProxyClass.prototype[methodName] = function generatedFunction() {
			var workerHelper = this._getWorkerHelper();
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
	
	function convertArgs(argsObject) {
		var args = new Array(argsObject.length);
		for (var i = 0; i < argsObject.length; ++i) {
			args[i] = argsObject[i];
		}
		
		return args;
	}
    
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
},{"scripts-to-import-pool":18}],4:[function(require,module,exports){
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
},{"async-proxy-master":3,"sub-worker-emulation-for-chrome":19}],5:[function(require,module,exports){
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
            throw 'AsyncProxy.DependencyWorkers: Already unregistered';
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
},{}],6:[function(require,module,exports){
'use strict';

var LinkedList = require('linked-list');
var JsBuiltinHashMap = require('js-builtin-hash-map');
var DependencyWorkersTask = require('dependency-workers-task');

var DependencyWorkersTaskInternals = (function DependencyWorkersTaskInternalsClosure() {
	function DependencyWorkersTaskInternals() {
        // This class is not exposed outside AsyncProxy but as an internal struct, thus 
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
			throw 'AsyncProxy.DependencyWorkers: already terminated';
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
            throw 'AsyncProxy.DependencyWorkers: already terminated';
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
			throw 'AsyncProxy.DependencyWorkers: already registered depend priority calculator';
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
			throw 'AsyncProxy.DependencyWorkers: not registered depend priority calculator';
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
            throw 'AsyncProxy.DependencyWorkers: Cannot add task dependency twice';
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
                throw 'AsyncProxy.DependencyWorkers: Double termination';
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
},{"dependency-workers-task":8,"js-builtin-hash-map":11,"linked-list":12}],7:[function(require,module,exports){
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
},{}],8:[function(require,module,exports){
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
			throw 'AsyncProxy.DependencyWorkers: Task has no event ' + event;
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
},{}],9:[function(require,module,exports){
'use strict';

/* global console: false */
/* global Promise: false */

var JsBuiltinHashMap = require('js-builtin-hash-map');
var DependencyWorkersTaskInternals = require('dependency-workers-task-internals');
var DependencyWorkersTaskContext = require('dependency-workers-task-context');
var AsyncProxyMaster = require('async-proxy-master');

var DependencyWorkers = (function DependencyWorkersClosure() {
    function DependencyWorkers(workerInputRetreiver) {
        var that = this;
        that._workerInputRetreiver = workerInputRetreiver;
        that._taskInternalss = new JsBuiltinHashMap();
        that._workerPoolByTaskType = [];
        that._taskOptionsByTaskType = [];
        
        if (!workerInputRetreiver.getWorkerTypeOptions) {
            throw 'AsyncProxy.DependencyWorkers: No ' +
                'workerInputRetreiver.getWorkerTypeOptions() method';
        }
        if (!workerInputRetreiver.getKeyAsString) {
            throw 'AsyncProxy.DependencyWorkers: No ' +
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
                    reject('AsyncProxy.DependencyWorkers: Internal ' +
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
            
			worker = new AsyncProxyMaster(
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
},{"async-proxy-master":3,"dependency-workers-task-context":5,"dependency-workers-task-internals":6,"js-builtin-hash-map":11}],10:[function(require,module,exports){
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
},{"linked-list":12}],11:[function(require,module,exports){
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
},{"hash-map":10}],12:[function(require,module,exports){
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
},{}],13:[function(require,module,exports){
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
},{"dependency-workers":9,"scheduler-wrapper-input-retreiver":15}],14:[function(require,module,exports){
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
            throw 'AsyncProxy.DependencyWorkers: Data after termination';
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
            throw 'AsyncProxy.DependencyWorkers: Double termination';
        }
        
        this._isTerminated = true;
        if (!this._hasPendingDataToProcess) {
			DependencyWorkersTask.prototype.terminate.call(this);
		}
    };
    
    SchedulerTask.prototype._onScheduled = function dataReadyForWorker(
            resource, jobContext, jobCallbacks) {
                
        if (jobContext !== this) {
            throw 'AsyncProxy.DependencyWorkers: Unexpected context';
        }
        
        if (this._cancelPendingDataToProcess) {
            this._cancelPendingDataToProcess = false;
			jobCallbacks.jobDone();
        } else {
			if (!this._hasPendingDataToProcess) {
				throw 'AsyncProxy.DependencyWorkers: !enqueuedProcessJob';
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
            throw 'AsyncProxy.DependencyWorkers: cancelPendingDataToProcess';
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
},{"dependency-workers-task":8}],15:[function(require,module,exports){
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
            throw 'AsyncProxy.DependencyWorkers: No ' +
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
},{"scheduler-task":14,"wrapper-input-retreiver-base":16}],16:[function(require,module,exports){
'use strict';

var WrapperInputRetreiverBase = (function WrapperInputRetreiverBaseClosure() {
    function WrapperInputRetreiverBase(inputRetreiver) {
        if (!inputRetreiver.getKeyAsString) {
            throw 'AsyncProxy.DependencyWorkers: No ' +
                'inputRetreiver.getKeyAsString() method';
        }
        if (!inputRetreiver.getWorkerTypeOptions) {
            throw 'AsyncProxy.DependencyWorkers: No ' +
                'inputRetreiver.getTaskTypeOptions() method';
        }

        var that = this;
        that._inputRetreiver = inputRetreiver;
    }
    
    WrapperInputRetreiverBase.prototype.taskStarted =
            function taskStarted(task) {
        
        throw 'AsyncProxy.WrapperInputRetreiverBase internal error: Not implemented taskStarted()';
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
},{}],17:[function(require,module,exports){
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
},{}],18:[function(require,module,exports){
arguments[4][17][0].apply(exports,arguments)
},{"dup":17}],19:[function(require,module,exports){
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJzcmMvYXN5bmMtcHJveHktZXhwb3J0cy5qcyIsInNyYy9hc3luYy1wcm94eS1mYWN0b3J5LmpzIiwic3JjL2FzeW5jLXByb3h5LW1hc3Rlci5qcyIsInNyYy9hc3luYy1wcm94eS1zbGF2ZS5qcyIsInNyYy9kZXBlbmRlbmN5LXdvcmtlcnMvZGVwZW5kZW5jeS13b3JrZXJzLXRhc2stY29udGV4dC5qcyIsInNyYy9kZXBlbmRlbmN5LXdvcmtlcnMvZGVwZW5kZW5jeS13b3JrZXJzLXRhc2staW50ZXJuYWxzLmpzIiwic3JjL2RlcGVuZGVuY3ktd29ya2Vycy9kZXBlbmRlbmN5LXdvcmtlcnMtdGFzay1zY2hlZHVsZXIuanMiLCJzcmMvZGVwZW5kZW5jeS13b3JrZXJzL2RlcGVuZGVuY3ktd29ya2Vycy10YXNrLmpzIiwic3JjL2RlcGVuZGVuY3ktd29ya2Vycy9kZXBlbmRlbmN5LXdvcmtlcnMuanMiLCJzcmMvZGVwZW5kZW5jeS13b3JrZXJzL2hhc2gtbWFwLmpzIiwic3JjL2RlcGVuZGVuY3ktd29ya2Vycy9qcy1idWlsdGluLWhhc2gtbWFwLmpzIiwic3JjL2RlcGVuZGVuY3ktd29ya2Vycy9saW5rZWQtbGlzdC5qcyIsInNyYy9kZXBlbmRlbmN5LXdvcmtlcnMvc2NoZWR1bGVyLWRlcGVuZGVuY3ktd29ya2Vycy5qcyIsInNyYy9kZXBlbmRlbmN5LXdvcmtlcnMvc2NoZWR1bGVyLXRhc2suanMiLCJzcmMvZGVwZW5kZW5jeS13b3JrZXJzL3NjaGVkdWxlci13cmFwcGVyLWlucHV0LXJldHJlaXZlci5qcyIsInNyYy9kZXBlbmRlbmN5LXdvcmtlcnMvd3JhcHBlci1pbnB1dC1yZXRyZWl2ZXItYmFzZS5qcyIsInNyYy9zY3JpcHRzLXRvLUltcG9ydC1Qb29sLmpzIiwic3JjL3N1Yi13b3JrZXItZW11bGF0aW9uLWZvci1jaHJvbWUuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7QUNBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzVCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDN0VBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzFVQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM5TkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN2REE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMxU0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbEJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BGQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMzS0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNwSkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM1QkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNwR0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNoQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMzSUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2hDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbkNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7Ozs7QUMxREE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSIsImZpbGUiOiJnZW5lcmF0ZWQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlc0NvbnRlbnQiOlsiKGZ1bmN0aW9uIGUodCxuLHIpe2Z1bmN0aW9uIHMobyx1KXtpZighbltvXSl7aWYoIXRbb10pe3ZhciBhPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7aWYoIXUmJmEpcmV0dXJuIGEobywhMCk7aWYoaSlyZXR1cm4gaShvLCEwKTt2YXIgZj1uZXcgRXJyb3IoXCJDYW5ub3QgZmluZCBtb2R1bGUgJ1wiK28rXCInXCIpO3Rocm93IGYuY29kZT1cIk1PRFVMRV9OT1RfRk9VTkRcIixmfXZhciBsPW5bb109e2V4cG9ydHM6e319O3Rbb11bMF0uY2FsbChsLmV4cG9ydHMsZnVuY3Rpb24oZSl7dmFyIG49dFtvXVsxXVtlXTtyZXR1cm4gcyhuP246ZSl9LGwsbC5leHBvcnRzLGUsdCxuLHIpfXJldHVybiBuW29dLmV4cG9ydHN9dmFyIGk9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtmb3IodmFyIG89MDtvPHIubGVuZ3RoO28rKylzKHJbb10pO3JldHVybiBzfSkiLCIndXNlIHN0cmljdCc7XHJcblxyXG52YXIgU3ViV29ya2VyRW11bGF0aW9uRm9yQ2hyb21lID0gcmVxdWlyZSgnc3ViLXdvcmtlci1lbXVsYXRpb24tZm9yLWNocm9tZScpO1xyXG52YXIgQXN5bmNQcm94eUZhY3RvcnkgPSByZXF1aXJlKCdhc3luYy1wcm94eS1mYWN0b3J5Jyk7XG52YXIgQXN5bmNQcm94eVNsYXZlID0gcmVxdWlyZSgnYXN5bmMtcHJveHktc2xhdmUnKTtcbnZhciBBc3luY1Byb3h5TWFzdGVyID0gcmVxdWlyZSgnYXN5bmMtcHJveHktbWFzdGVyJyk7XG52YXIgU2NyaXB0c1RvSW1wb3J0UG9vbCA9IHJlcXVpcmUoJ3NjcmlwdHMtdG8tSW1wb3J0LVBvb2wnKTtcclxudmFyIERlcGVuZGVuY3lXb3JrZXJzID0gcmVxdWlyZSgnZGVwZW5kZW5jeS13b3JrZXJzJyk7XG52YXIgRGVwZW5kZW5jeVdvcmtlcnNUYXNrQ29udGV4dCA9IHJlcXVpcmUoJ2RlcGVuZGVuY3ktd29ya2Vycy10YXNrLWNvbnRleHQnKTtcbnZhciBEZXBlbmRlbmN5V29ya2Vyc1Rhc2sgPSByZXF1aXJlKCdkZXBlbmRlbmN5LXdvcmtlcnMtdGFzaycpO1xudmFyIFdyYXBwZXJJbnB1dFJldHJlaXZlckJhc2UgPSByZXF1aXJlKCd3cmFwcGVyLWlucHV0LXJldHJlaXZlci1iYXNlJyk7XHJcbnZhciBTY2hlZHVsZXJUYXNrID0gcmVxdWlyZSgnc2NoZWR1bGVyLXRhc2snKTtcbnZhciBTY2hlZHVsZXJXcmFwcGVySW5wdXRSZXRyZWl2ZXIgPSByZXF1aXJlKCdzY2hlZHVsZXItd3JhcHBlci1pbnB1dC1yZXRyZWl2ZXInKTtcbnZhciBTY2hlZHVsZXJEZXBlbmRlbmN5V29ya2VycyA9IHJlcXVpcmUoJ3NjaGVkdWxlci1kZXBlbmRlbmN5LXdvcmtlcnMnKTtcclxudmFyIERlcGVuZGVuY3lXb3JrZXJzVGFza1NjaGVkdWxlciA9IHJlcXVpcmUoJ2RlcGVuZGVuY3ktd29ya2Vycy10YXNrLXNjaGVkdWxlcicpO1xyXG5cclxubW9kdWxlLmV4cG9ydHMuU3ViV29ya2VyRW11bGF0aW9uRm9yQ2hyb21lID0gU3ViV29ya2VyRW11bGF0aW9uRm9yQ2hyb21lO1xyXG5tb2R1bGUuZXhwb3J0cy5Bc3luY1Byb3h5RmFjdG9yeSA9IEFzeW5jUHJveHlGYWN0b3J5O1xyXG5tb2R1bGUuZXhwb3J0cy5Bc3luY1Byb3h5U2xhdmUgPSBBc3luY1Byb3h5U2xhdmU7XHJcbm1vZHVsZS5leHBvcnRzLkFzeW5jUHJveHlNYXN0ZXIgPSBBc3luY1Byb3h5TWFzdGVyO1xyXG5tb2R1bGUuZXhwb3J0cy5TY3JpcHRzVG9JbXBvcnRQb29sID0gU2NyaXB0c1RvSW1wb3J0UG9vbDtcclxubW9kdWxlLmV4cG9ydHMuRGVwZW5kZW5jeVdvcmtlcnMgPSBEZXBlbmRlbmN5V29ya2VycztcclxubW9kdWxlLmV4cG9ydHMuRGVwZW5kZW5jeVdvcmtlcnNUYXNrQ29udGV4dCA9IERlcGVuZGVuY3lXb3JrZXJzVGFza0NvbnRleHQ7XHJcbm1vZHVsZS5leHBvcnRzLkRlcGVuZGVuY3lXb3JrZXJzVGFzayA9IERlcGVuZGVuY3lXb3JrZXJzVGFzaztcclxubW9kdWxlLmV4cG9ydHMuV3JhcHBlcklucHV0UmV0cmVpdmVyQmFzZSA9IFdyYXBwZXJJbnB1dFJldHJlaXZlckJhc2U7XHJcbm1vZHVsZS5leHBvcnRzLlNjaGVkdWxlclRhc2sgPSBTY2hlZHVsZXJUYXNrO1xyXG5tb2R1bGUuZXhwb3J0cy5TY2hlZHVsZXJXcmFwcGVySW5wdXRSZXRyZWl2ZXIgPSBTY2hlZHVsZXJXcmFwcGVySW5wdXRSZXRyZWl2ZXI7XHJcbm1vZHVsZS5leHBvcnRzLlNjaGVkdWxlckRlcGVuZGVuY3lXb3JrZXJzID0gU2NoZWR1bGVyRGVwZW5kZW5jeVdvcmtlcnM7XHJcbm1vZHVsZS5leHBvcnRzLkRlcGVuZGVuY3lXb3JrZXJzVGFza1NjaGVkdWxlciA9IERlcGVuZGVuY3lXb3JrZXJzVGFza1NjaGVkdWxlcjsiLCIndXNlIHN0cmljdCc7XHJcblxyXG52YXIgQXN5bmNQcm94eU1hc3RlciA9IHJlcXVpcmUoJ2FzeW5jLXByb3h5LW1hc3RlcicpO1xyXG5cclxudmFyIEFzeW5jUHJveHlGYWN0b3J5ID0gKGZ1bmN0aW9uIEFzeW5jUHJveHlGYWN0b3J5Q2xvc3VyZSgpIHtcclxuICAgIHZhciBmYWN0b3J5U2luZ2xldG9uID0ge307XHJcblx0XHJcblx0ZmFjdG9yeVNpbmdsZXRvbi5jcmVhdGUgPSBmdW5jdGlvbiBjcmVhdGUoc2NyaXB0c1RvSW1wb3J0LCBjdG9yTmFtZSwgbWV0aG9kcywgcHJveHlDdG9yKSB7XHJcblx0XHRpZiAoKCFzY3JpcHRzVG9JbXBvcnQpIHx8ICEoc2NyaXB0c1RvSW1wb3J0Lmxlbmd0aCkpIHtcclxuXHRcdFx0dGhyb3cgJ0FzeW5jUHJveHlGYWN0b3J5IGVycm9yOiBtaXNzaW5nIHNjcmlwdHNUb0ltcG9ydCAoMm5kIGFyZ3VtZW50KSc7XHJcblx0XHR9XHJcblx0XHRpZiAoIW1ldGhvZHMpIHtcclxuXHRcdFx0dGhyb3cgJ0FzeW5jUHJveHlGYWN0b3J5IGVycm9yOiBtaXNzaW5nIG1ldGhvZHMgKDNyZCBhcmd1bWVudCknO1xyXG5cdFx0fVxyXG5cdFx0XHJcblx0XHR2YXIgUHJveHlDbGFzcyA9IHByb3h5Q3RvciB8fCBmdW5jdGlvbigpIHtcclxuXHRcdFx0dmFyIHRoYXQgPSB0aGlzO1xyXG5cdFx0XHR0aGlzLl9fd29ya2VySGVscGVyQ3RvckFyZ3MgPSBjb252ZXJ0QXJncyhhcmd1bWVudHMpO1xyXG5cdFx0fTtcclxuXHRcdFxyXG5cdFx0UHJveHlDbGFzcy5wcm90b3R5cGUuX2dldFdvcmtlckhlbHBlciA9IGZ1bmN0aW9uIGdldFdvcmtlckhlbHBlcigpIHtcclxuXHRcdFx0aWYgKCF0aGlzLl9fd29ya2VySGVscGVyKSB7XHJcblx0XHRcdFx0dGhpcy5fX3dvcmtlckhlbHBlciA9IG5ldyBBc3luY1Byb3h5TWFzdGVyKFxyXG5cdFx0XHRcdFx0c2NyaXB0c1RvSW1wb3J0LCBjdG9yTmFtZSwgdGhpcy5fX3dvcmtlckhlbHBlckN0b3JBcmdzIHx8IFtdKTtcclxuXHRcdFx0fVxyXG5cdFx0XHRcclxuXHRcdFx0cmV0dXJuIHRoaXMuX193b3JrZXJIZWxwZXI7XHJcblx0XHR9O1xyXG5cdFx0XHJcblx0XHRmb3IgKHZhciBtZXRob2ROYW1lIGluIG1ldGhvZHMpIHtcclxuXHRcdFx0Z2VuZXJhdGVNZXRob2QoUHJveHlDbGFzcywgbWV0aG9kTmFtZSwgbWV0aG9kc1ttZXRob2ROYW1lXSB8fCBbXSk7XHJcblx0XHR9XHJcblx0XHRcclxuXHRcdHJldHVybiBQcm94eUNsYXNzO1xyXG5cdH07XHJcblx0XHJcblx0ZnVuY3Rpb24gZ2VuZXJhdGVNZXRob2QoUHJveHlDbGFzcywgbWV0aG9kTmFtZSwgbWV0aG9kQXJnc0Rlc2NyaXB0aW9uKSB7XHJcblx0XHRpZiAodHlwZW9mIG1ldGhvZEFyZ3NEZXNjcmlwdGlvbiA9PT0gJ2Z1bmN0aW9uJykge1xyXG5cdFx0XHRQcm94eUNsYXNzLnByb3RvdHlwZVttZXRob2ROYW1lXSA9IG1ldGhvZEFyZ3NEZXNjcmlwdGlvbjtcclxuXHRcdFx0cmV0dXJuO1xyXG5cdFx0fVxyXG5cdFx0XHJcblx0XHR2YXIgbWV0aG9kT3B0aW9ucyA9IG1ldGhvZEFyZ3NEZXNjcmlwdGlvblswXSB8fCB7fTtcclxuXHRcdFByb3h5Q2xhc3MucHJvdG90eXBlW21ldGhvZE5hbWVdID0gZnVuY3Rpb24gZ2VuZXJhdGVkRnVuY3Rpb24oKSB7XHJcblx0XHRcdHZhciB3b3JrZXJIZWxwZXIgPSB0aGlzLl9nZXRXb3JrZXJIZWxwZXIoKTtcclxuXHRcdFx0dmFyIGFyZ3NUb1NlbmQgPSBbXTtcclxuXHRcdFx0Zm9yICh2YXIgaSA9IDA7IGkgPCBhcmd1bWVudHMubGVuZ3RoOyArK2kpIHtcclxuXHRcdFx0XHR2YXIgYXJnRGVzY3JpcHRpb24gPSBtZXRob2RBcmdzRGVzY3JpcHRpb25baSArIDFdO1xyXG5cdFx0XHRcdHZhciBhcmdWYWx1ZSA9IGFyZ3VtZW50c1tpXTtcclxuXHRcdFx0XHRcclxuXHRcdFx0XHRpZiAoYXJnRGVzY3JpcHRpb24gPT09ICdjYWxsYmFjaycpIHtcclxuXHRcdFx0XHRcdGFyZ3NUb1NlbmRbaV0gPSB3b3JrZXJIZWxwZXIud3JhcENhbGxiYWNrKGFyZ1ZhbHVlKTtcclxuXHRcdFx0XHR9IGVsc2UgaWYgKCFhcmdEZXNjcmlwdGlvbikge1xyXG5cdFx0XHRcdFx0YXJnc1RvU2VuZFtpXSA9IGFyZ1ZhbHVlO1xyXG5cdFx0XHRcdH0gZWxzZSB7XHJcblx0XHRcdFx0XHR0aHJvdyAnQXN5bmNQcm94eUZhY3RvcnkgZXJyb3I6IFVucmVjb2duaXplZCBhcmd1bWVudCAnICtcclxuXHRcdFx0XHRcdFx0J2Rlc2NyaXB0aW9uICcgKyBhcmdEZXNjcmlwdGlvbiArICcgaW4gYXJndW1lbnQgJyArXHJcblx0XHRcdFx0XHRcdChpICsgMSkgKyAnIG9mIG1ldGhvZCAnICsgbWV0aG9kTmFtZTtcclxuXHRcdFx0XHR9XHJcblx0XHRcdH1cclxuXHRcdFx0cmV0dXJuIHdvcmtlckhlbHBlci5jYWxsRnVuY3Rpb24oXHJcblx0XHRcdFx0bWV0aG9kTmFtZSwgYXJnc1RvU2VuZCwgbWV0aG9kQXJnc0Rlc2NyaXB0aW9uWzBdKTtcclxuXHRcdH07XHJcblx0fVxyXG5cdFxyXG5cdGZ1bmN0aW9uIGNvbnZlcnRBcmdzKGFyZ3NPYmplY3QpIHtcclxuXHRcdHZhciBhcmdzID0gbmV3IEFycmF5KGFyZ3NPYmplY3QubGVuZ3RoKTtcclxuXHRcdGZvciAodmFyIGkgPSAwOyBpIDwgYXJnc09iamVjdC5sZW5ndGg7ICsraSkge1xyXG5cdFx0XHRhcmdzW2ldID0gYXJnc09iamVjdFtpXTtcclxuXHRcdH1cclxuXHRcdFxyXG5cdFx0cmV0dXJuIGFyZ3M7XHJcblx0fVxyXG4gICAgXHJcbiAgICByZXR1cm4gZmFjdG9yeVNpbmdsZXRvbjtcclxufSkoKTtcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gQXN5bmNQcm94eUZhY3Rvcnk7IiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxuLyogZ2xvYmFsIFByb21pc2U6IGZhbHNlICovXHJcblxyXG52YXIgU2NyaXB0c1RvSW1wb3J0UG9vbCA9IHJlcXVpcmUoJ3NjcmlwdHMtdG8taW1wb3J0LXBvb2wnKTtcclxuXHJcbnZhciBBc3luY1Byb3h5TWFzdGVyID0gKGZ1bmN0aW9uIEFzeW5jUHJveHlNYXN0ZXJDbG9zdXJlKCkge1xyXG4gICAgdmFyIGNhbGxJZCA9IDA7XHJcbiAgICB2YXIgaXNHZXRNYXN0ZXJFbnRyeVVybENhbGxlZCA9IGZhbHNlO1xyXG4gICAgdmFyIG1hc3RlckVudHJ5VXJsID0gZ2V0QmFzZVVybEZyb21FbnRyeVNjcmlwdCgpO1xyXG4gICAgXHJcbiAgICBmdW5jdGlvbiBBc3luY1Byb3h5TWFzdGVyKHNjcmlwdHNUb0ltcG9ydCwgY3Rvck5hbWUsIGN0b3JBcmdzLCBvcHRpb25zKSB7XHJcbiAgICAgICAgdmFyIHRoYXQgPSB0aGlzO1xyXG4gICAgICAgIG9wdGlvbnMgPSBvcHRpb25zIHx8IHt9O1xyXG4gICAgICAgIFxyXG4gICAgICAgIHRoYXQuX2NhbGxiYWNrcyA9IFtdO1xyXG4gICAgICAgIHRoYXQuX3BlbmRpbmdQcm9taXNlQ2FsbHMgPSBbXTtcclxuICAgICAgICB0aGF0Ll9zdWJXb3JrZXJCeUlkID0gW107XHJcbiAgICAgICAgdGhhdC5fc3ViV29ya2VycyA9IFtdO1xyXG4gICAgICAgIHRoYXQuX3VzZXJEYXRhSGFuZGxlciA9IG51bGw7XHJcbiAgICAgICAgdGhhdC5fbm90UmV0dXJuZWRGdW5jdGlvbnMgPSAwO1xyXG4gICAgICAgIHRoYXQuX2Z1bmN0aW9uc0J1ZmZlclNpemUgPSBvcHRpb25zLmZ1bmN0aW9uc0J1ZmZlclNpemUgfHwgNTtcclxuICAgICAgICB0aGF0Ll9wZW5kaW5nTWVzc2FnZXMgPSBbXTtcclxuICAgICAgICBcclxuICAgICAgICB2YXIgc2NyaXB0TmFtZSA9IGdldFNjcmlwdE5hbWUoKTtcclxuICAgICAgICB2YXIgc2xhdmVTY3JpcHRDb250ZW50U3RyaW5nID0gbWFpblNsYXZlU2NyaXB0Q29udGVudC50b1N0cmluZygpO1xyXG4gICAgICAgIHNsYXZlU2NyaXB0Q29udGVudFN0cmluZyA9IHNsYXZlU2NyaXB0Q29udGVudFN0cmluZy5yZXBsYWNlKFxyXG4gICAgICAgICAgICAnU0NSSVBUX1BMQUNFSE9MREVSJywgc2NyaXB0TmFtZSk7XHJcbiAgICAgICAgdmFyIHNsYXZlU2NyaXB0Q29udGVudEJsb2IgPSBuZXcgQmxvYihcclxuICAgICAgICAgICAgWycoJywgc2xhdmVTY3JpcHRDb250ZW50U3RyaW5nLCAnKSgpJ10sXHJcbiAgICAgICAgICAgIHsgdHlwZTogJ2FwcGxpY2F0aW9uL2phdmFzY3JpcHQnIH0pO1xyXG4gICAgICAgIHZhciBzbGF2ZVNjcmlwdFVybCA9IFVSTC5jcmVhdGVPYmplY3RVUkwoc2xhdmVTY3JpcHRDb250ZW50QmxvYik7XHJcblxyXG4gICAgICAgIHRoYXQuX3dvcmtlciA9IG5ldyBXb3JrZXIoc2xhdmVTY3JpcHRVcmwpO1xyXG4gICAgICAgIHRoYXQuX3dvcmtlci5vbm1lc3NhZ2UgPSBvbldvcmtlck1lc3NhZ2VJbnRlcm5hbDtcclxuXHJcbiAgICAgICAgdGhhdC5fd29ya2VyLnBvc3RNZXNzYWdlKHtcclxuICAgICAgICAgICAgZnVuY3Rpb25Ub0NhbGw6ICdjdG9yJyxcclxuICAgICAgICAgICAgc2NyaXB0c1RvSW1wb3J0OiBzY3JpcHRzVG9JbXBvcnQsXHJcbiAgICAgICAgICAgIGN0b3JOYW1lOiBjdG9yTmFtZSxcclxuICAgICAgICAgICAgYXJnczogY3RvckFyZ3MsXHJcbiAgICAgICAgICAgIGNhbGxJZDogKytjYWxsSWQsXHJcbiAgICAgICAgICAgIGlzUHJvbWlzZTogZmFsc2UsXHJcbiAgICAgICAgICAgIG1hc3RlckVudHJ5VXJsOiBBc3luY1Byb3h5TWFzdGVyLmdldEVudHJ5VXJsKClcclxuICAgICAgICB9KTtcclxuICAgICAgICBcclxuICAgICAgICBmdW5jdGlvbiBvbldvcmtlck1lc3NhZ2VJbnRlcm5hbCh3b3JrZXJFdmVudCkge1xyXG4gICAgICAgICAgICBvbldvcmtlck1lc3NhZ2UodGhhdCwgd29ya2VyRXZlbnQpO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuICAgIFxyXG4gICAgQXN5bmNQcm94eU1hc3Rlci5wcm90b3R5cGUuc2V0VXNlckRhdGFIYW5kbGVyID0gZnVuY3Rpb24gc2V0VXNlckRhdGFIYW5kbGVyKHVzZXJEYXRhSGFuZGxlcikge1xyXG4gICAgICAgIHRoaXMuX3VzZXJEYXRhSGFuZGxlciA9IHVzZXJEYXRhSGFuZGxlcjtcclxuICAgIH07XHJcbiAgICBcclxuICAgIEFzeW5jUHJveHlNYXN0ZXIucHJvdG90eXBlLnRlcm1pbmF0ZSA9IGZ1bmN0aW9uIHRlcm1pbmF0ZSgpIHtcclxuICAgICAgICB0aGlzLl93b3JrZXIudGVybWluYXRlKCk7XHJcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCB0aGlzLl9zdWJXb3JrZXJzLmxlbmd0aDsgKytpKSB7XHJcbiAgICAgICAgICAgIHRoaXMuX3N1YldvcmtlcnNbaV0udGVybWluYXRlKCk7XHJcbiAgICAgICAgfVxyXG4gICAgfTtcclxuICAgIFxyXG4gICAgQXN5bmNQcm94eU1hc3Rlci5wcm90b3R5cGUuY2FsbEZ1bmN0aW9uID0gZnVuY3Rpb24gY2FsbEZ1bmN0aW9uKGZ1bmN0aW9uVG9DYWxsLCBhcmdzLCBvcHRpb25zKSB7XHJcbiAgICAgICAgb3B0aW9ucyA9IG9wdGlvbnMgfHwge307XHJcbiAgICAgICAgdmFyIGlzUmV0dXJuUHJvbWlzZSA9ICEhb3B0aW9ucy5pc1JldHVyblByb21pc2U7XHJcbiAgICAgICAgdmFyIHRyYW5zZmVyYWJsZXNBcmcgPSBvcHRpb25zLnRyYW5zZmVyYWJsZXMgfHwgW107XHJcbiAgICAgICAgdmFyIHBhdGhzVG9UcmFuc2ZlcmFibGVzID1cclxuICAgICAgICAgICAgb3B0aW9ucy5wYXRoc1RvVHJhbnNmZXJhYmxlc0luUHJvbWlzZVJlc3VsdDtcclxuICAgICAgICBcclxuICAgICAgICB2YXIgbG9jYWxDYWxsSWQgPSArK2NhbGxJZDtcclxuICAgICAgICB2YXIgcHJvbWlzZU9uTWFzdGVyU2lkZSA9IG51bGw7XHJcbiAgICAgICAgdmFyIHRoYXQgPSB0aGlzO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGlmIChpc1JldHVyblByb21pc2UpIHtcclxuICAgICAgICAgICAgcHJvbWlzZU9uTWFzdGVyU2lkZSA9IG5ldyBQcm9taXNlKGZ1bmN0aW9uIHByb21pc2VGdW5jKHJlc29sdmUsIHJlamVjdCkge1xyXG4gICAgICAgICAgICAgICAgdGhhdC5fcGVuZGluZ1Byb21pc2VDYWxsc1tsb2NhbENhbGxJZF0gPSB7XHJcbiAgICAgICAgICAgICAgICAgICAgcmVzb2x2ZTogcmVzb2x2ZSxcclxuICAgICAgICAgICAgICAgICAgICByZWplY3Q6IHJlamVjdFxyXG4gICAgICAgICAgICAgICAgfTtcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHZhciBzZW5kTWVzc2FnZUZ1bmN0aW9uID0gb3B0aW9ucy5pc1NlbmRJbW1lZGlhdGVseSA/XHJcbiAgICAgICAgICAgIHNlbmRNZXNzYWdlVG9TbGF2ZTogZW5xdWV1ZU1lc3NhZ2VUb1NsYXZlO1xyXG5cdFx0XHJcblx0XHR2YXIgdHJhbnNmZXJhYmxlcztcclxuXHRcdGlmICh0eXBlb2YgdHJhbnNmZXJhYmxlc0FyZyA9PT0gJ2Z1bmN0aW9uJykge1xyXG5cdFx0XHR0cmFuc2ZlcmFibGVzID0gdHJhbnNmZXJhYmxlc0FyZygpO1xyXG5cdFx0fSBlbHNlIHtcclxuXHRcdFx0dHJhbnNmZXJhYmxlcyA9IEFzeW5jUHJveHlNYXN0ZXIuX2V4dHJhY3RUcmFuc2ZlcmFibGVzKFxyXG5cdFx0XHRcdHRyYW5zZmVyYWJsZXNBcmcsIGFyZ3MpO1xyXG5cdFx0fVxyXG4gICAgICAgIFxyXG4gICAgICAgIHNlbmRNZXNzYWdlRnVuY3Rpb24odGhpcywgdHJhbnNmZXJhYmxlcywgLyppc0Z1bmN0aW9uQ2FsbD0qL3RydWUsIHtcclxuICAgICAgICAgICAgZnVuY3Rpb25Ub0NhbGw6IGZ1bmN0aW9uVG9DYWxsLFxyXG4gICAgICAgICAgICBhcmdzOiBhcmdzIHx8IFtdLFxyXG4gICAgICAgICAgICBjYWxsSWQ6IGxvY2FsQ2FsbElkLFxyXG4gICAgICAgICAgICBpc1Byb21pc2U6IGlzUmV0dXJuUHJvbWlzZSxcclxuICAgICAgICAgICAgcGF0aHNUb1RyYW5zZmVyYWJsZXNJblByb21pc2VSZXN1bHQgOiBwYXRoc1RvVHJhbnNmZXJhYmxlc1xyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGlmIChpc1JldHVyblByb21pc2UpIHtcclxuICAgICAgICAgICAgcmV0dXJuIHByb21pc2VPbk1hc3RlclNpZGU7XHJcbiAgICAgICAgfVxyXG4gICAgfTtcclxuICAgIFxyXG4gICAgQXN5bmNQcm94eU1hc3Rlci5wcm90b3R5cGUud3JhcENhbGxiYWNrID0gZnVuY3Rpb24gd3JhcENhbGxiYWNrKFxyXG4gICAgICAgIGNhbGxiYWNrLCBjYWxsYmFja05hbWUsIG9wdGlvbnMpIHtcclxuICAgICAgICBcclxuICAgICAgICBvcHRpb25zID0gb3B0aW9ucyB8fCB7fTtcclxuICAgICAgICB2YXIgbG9jYWxDYWxsSWQgPSArK2NhbGxJZDtcclxuICAgICAgICBcclxuICAgICAgICB2YXIgY2FsbGJhY2tIYW5kbGUgPSB7XHJcbiAgICAgICAgICAgIGlzV29ya2VySGVscGVyQ2FsbGJhY2s6IHRydWUsXHJcbiAgICAgICAgICAgIGlzTXVsdGlwbGVUaW1lQ2FsbGJhY2s6ICEhb3B0aW9ucy5pc011bHRpcGxlVGltZUNhbGxiYWNrLFxyXG4gICAgICAgICAgICBjYWxsSWQ6IGxvY2FsQ2FsbElkLFxyXG4gICAgICAgICAgICBjYWxsYmFja05hbWU6IGNhbGxiYWNrTmFtZSxcclxuICAgICAgICAgICAgcGF0aHNUb1RyYW5zZmVyYWJsZXM6IG9wdGlvbnMucGF0aHNUb1RyYW5zZmVyYWJsZXNcclxuICAgICAgICB9O1xyXG4gICAgICAgIFxyXG4gICAgICAgIHZhciBpbnRlcm5hbENhbGxiYWNrSGFuZGxlID0ge1xyXG4gICAgICAgICAgICBpc011bHRpcGxlVGltZUNhbGxiYWNrOiAhIW9wdGlvbnMuaXNNdWx0aXBsZVRpbWVDYWxsYmFjayxcclxuICAgICAgICAgICAgY2FsbElkOiBsb2NhbENhbGxJZCxcclxuICAgICAgICAgICAgY2FsbGJhY2s6IGNhbGxiYWNrLFxyXG4gICAgICAgICAgICBwYXRoc1RvVHJhbnNmZXJhYmxlczogb3B0aW9ucy5wYXRoc1RvVHJhbnNmZXJhYmxlc1xyXG4gICAgICAgIH07XHJcbiAgICAgICAgXHJcbiAgICAgICAgdGhpcy5fY2FsbGJhY2tzW2xvY2FsQ2FsbElkXSA9IGludGVybmFsQ2FsbGJhY2tIYW5kbGU7XHJcbiAgICAgICAgXHJcbiAgICAgICAgcmV0dXJuIGNhbGxiYWNrSGFuZGxlO1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgQXN5bmNQcm94eU1hc3Rlci5wcm90b3R5cGUuZnJlZUNhbGxiYWNrID0gZnVuY3Rpb24gZnJlZUNhbGxiYWNrKGNhbGxiYWNrSGFuZGxlKSB7XHJcbiAgICAgICAgZGVsZXRlIHRoaXMuX2NhbGxiYWNrc1tjYWxsYmFja0hhbmRsZS5jYWxsSWRdO1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgLy8gU3RhdGljIGZ1bmN0aW9uc1xyXG4gICAgXHJcbiAgICBBc3luY1Byb3h5TWFzdGVyLmdldEVudHJ5VXJsID0gZnVuY3Rpb24gZ2V0RW50cnlVcmwoKSB7XHJcbiAgICAgICAgaXNHZXRNYXN0ZXJFbnRyeVVybENhbGxlZCA9IHRydWU7XHJcbiAgICAgICAgcmV0dXJuIG1hc3RlckVudHJ5VXJsO1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgQXN5bmNQcm94eU1hc3Rlci5fc2V0RW50cnlVcmwgPSBmdW5jdGlvbiBzZXRFbnRyeVVybChuZXdVcmwpIHtcclxuICAgICAgICBpZiAobWFzdGVyRW50cnlVcmwgIT09IG5ld1VybCAmJiBpc0dldE1hc3RlckVudHJ5VXJsQ2FsbGVkKSB7XHJcbiAgICAgICAgICAgIHRocm93ICdQcmV2aW91cyB2YWx1ZXMgcmV0dXJuZWQgZnJvbSBnZXRNYXN0ZXJFbnRyeVVybCAnICtcclxuICAgICAgICAgICAgICAgICdpcyB3cm9uZy4gQXZvaWQgY2FsbGluZyBpdCB3aXRoaW4gdGhlIHNsYXZlIGNgdG9yJztcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIG1hc3RlckVudHJ5VXJsID0gbmV3VXJsO1xyXG4gICAgfTtcclxuXHRcclxuXHRBc3luY1Byb3h5TWFzdGVyLl9leHRyYWN0VHJhbnNmZXJhYmxlcyA9IGZ1bmN0aW9uIGV4dHJhY3RUcmFuc2ZlcmFibGVzKFxyXG5cdFx0XHRwYXRoc1RvVHJhbnNmZXJhYmxlcywgcGF0aHNCYXNlKSB7XHJcblx0XHRcclxuICAgICAgICBpZiAocGF0aHNUb1RyYW5zZmVyYWJsZXMgPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICB2YXIgdHJhbnNmZXJhYmxlcyA9IG5ldyBBcnJheShwYXRoc1RvVHJhbnNmZXJhYmxlcy5sZW5ndGgpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgcGF0aHNUb1RyYW5zZmVyYWJsZXMubGVuZ3RoOyArK2kpIHtcclxuICAgICAgICAgICAgdmFyIHBhdGggPSBwYXRoc1RvVHJhbnNmZXJhYmxlc1tpXTtcclxuICAgICAgICAgICAgdmFyIHRyYW5zZmVyYWJsZSA9IHBhdGhzQmFzZTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGZvciAodmFyIGogPSAwOyBqIDwgcGF0aC5sZW5ndGg7ICsraikge1xyXG4gICAgICAgICAgICAgICAgdmFyIG1lbWJlciA9IHBhdGhbal07XHJcbiAgICAgICAgICAgICAgICB0cmFuc2ZlcmFibGUgPSB0cmFuc2ZlcmFibGVbbWVtYmVyXTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgdHJhbnNmZXJhYmxlc1tpXSA9IHRyYW5zZmVyYWJsZTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgcmV0dXJuIHRyYW5zZmVyYWJsZXM7XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICAvLyBQcml2YXRlIGZ1bmN0aW9uc1xyXG5cdFxyXG5cdGZ1bmN0aW9uIGdldFNjcmlwdE5hbWUoKSB7XHJcbiAgICAgICAgdmFyIGVycm9yID0gbmV3IEVycm9yKCk7XHJcblx0XHRyZXR1cm4gU2NyaXB0c1RvSW1wb3J0UG9vbC5fZ2V0U2NyaXB0TmFtZShlcnJvcik7XHJcblx0fVxyXG4gICAgXHJcbiAgICBmdW5jdGlvbiBtYWluU2xhdmVTY3JpcHRDb250ZW50KCkge1xyXG5cdFx0Ly8gVGhpcyBmdW5jdGlvbiBpcyBub3QgcnVuIGRpcmVjdGx5OiBJdCBjb3BpZWQgYXMgYSBzdHJpbmcgaW50byBhIGJsb2JcclxuXHRcdC8vIGFuZCBydW4gaW4gdGhlIFdlYiBXb3JrZXIgZ2xvYmFsIHNjb3BlXHJcblx0XHRcclxuXHRcdC8qIGdsb2JhbCBpbXBvcnRTY3JpcHRzOiBmYWxzZSAqL1xyXG4gICAgICAgIGltcG9ydFNjcmlwdHMoJ1NDUklQVF9QTEFDRUhPTERFUicpO1xyXG5cdFx0LyogZ2xvYmFsIGFzeW5jUHJveHk6IGZhbHNlICovXHJcbiAgICAgICAgYXN5bmNQcm94eS5Bc3luY1Byb3h5U2xhdmUuX2luaXRpYWxpemVTbGF2ZSgpO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBmdW5jdGlvbiBvbldvcmtlck1lc3NhZ2UodGhhdCwgd29ya2VyRXZlbnQpIHtcclxuICAgICAgICB2YXIgY2FsbElkID0gd29ya2VyRXZlbnQuZGF0YS5jYWxsSWQ7XHJcbiAgICAgICAgXHJcbiAgICAgICAgc3dpdGNoICh3b3JrZXJFdmVudC5kYXRhLnR5cGUpIHtcclxuICAgICAgICAgICAgY2FzZSAnZnVuY3Rpb25DYWxsZWQnOlxyXG4gICAgICAgICAgICAgICAgLS10aGF0Ll9ub3RSZXR1cm5lZEZ1bmN0aW9ucztcclxuICAgICAgICAgICAgICAgIHRyeVNlbmRQZW5kaW5nTWVzc2FnZXModGhhdCk7XHJcbiAgICAgICAgICAgICAgICBicmVhaztcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGNhc2UgJ3Byb21pc2VSZXN1bHQnOlxyXG4gICAgICAgICAgICAgICAgdmFyIHByb21pc2VUb1Jlc29sdmUgPSB0aGF0Ll9wZW5kaW5nUHJvbWlzZUNhbGxzW2NhbGxJZF07XHJcbiAgICAgICAgICAgICAgICBkZWxldGUgdGhhdC5fcGVuZGluZ1Byb21pc2VDYWxsc1tjYWxsSWRdO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICB2YXIgcmVzdWx0ID0gd29ya2VyRXZlbnQuZGF0YS5yZXN1bHQ7XHJcbiAgICAgICAgICAgICAgICBwcm9taXNlVG9SZXNvbHZlLnJlc29sdmUocmVzdWx0KTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgYnJlYWs7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBjYXNlICdwcm9taXNlRmFpbHVyZSc6XHJcbiAgICAgICAgICAgICAgICB2YXIgcHJvbWlzZVRvUmVqZWN0ID0gdGhhdC5fcGVuZGluZ1Byb21pc2VDYWxsc1tjYWxsSWRdO1xyXG4gICAgICAgICAgICAgICAgZGVsZXRlIHRoYXQuX3BlbmRpbmdQcm9taXNlQ2FsbHNbY2FsbElkXTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgdmFyIHJlYXNvbiA9IHdvcmtlckV2ZW50LmRhdGEucmVhc29uO1xyXG4gICAgICAgICAgICAgICAgcHJvbWlzZVRvUmVqZWN0LnJlamVjdChyZWFzb24pO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICBicmVhaztcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGNhc2UgJ3VzZXJEYXRhJzpcclxuICAgICAgICAgICAgICAgIGlmICh0aGF0Ll91c2VyRGF0YUhhbmRsZXIgIT09IG51bGwpIHtcclxuICAgICAgICAgICAgICAgICAgICB0aGF0Ll91c2VyRGF0YUhhbmRsZXIod29ya2VyRXZlbnQuZGF0YS51c2VyRGF0YSk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIGJyZWFrO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgY2FzZSAnY2FsbGJhY2snOlxyXG4gICAgICAgICAgICAgICAgdmFyIGNhbGxiYWNrSGFuZGxlID0gdGhhdC5fY2FsbGJhY2tzW3dvcmtlckV2ZW50LmRhdGEuY2FsbElkXTtcclxuICAgICAgICAgICAgICAgIGlmIChjYWxsYmFja0hhbmRsZSA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhyb3cgJ1VuZXhwZWN0ZWQgbWVzc2FnZSBmcm9tIFNsYXZlV29ya2VyIG9mIGNhbGxiYWNrIElEOiAnICtcclxuICAgICAgICAgICAgICAgICAgICAgICAgd29ya2VyRXZlbnQuZGF0YS5jYWxsSWQgKyAnLiBNYXliZSBzaG91bGQgaW5kaWNhdGUgJyArXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICdpc011bHRpcGxlVGltZXNDYWxsYmFjayA9IHRydWUgb24gY3JlYXRpb24/JztcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgaWYgKCFjYWxsYmFja0hhbmRsZS5pc011bHRpcGxlVGltZUNhbGxiYWNrKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhhdC5mcmVlQ2FsbGJhY2sodGhhdC5fY2FsbGJhY2tzW3dvcmtlckV2ZW50LmRhdGEuY2FsbElkXSk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIGlmIChjYWxsYmFja0hhbmRsZS5jYWxsYmFjayAhPT0gbnVsbCkge1xyXG4gICAgICAgICAgICAgICAgICAgIGNhbGxiYWNrSGFuZGxlLmNhbGxiYWNrLmFwcGx5KG51bGwsIHdvcmtlckV2ZW50LmRhdGEuYXJncyk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIGJyZWFrO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgY2FzZSAnc3ViV29ya2VyQ3Rvcic6XHJcbiAgICAgICAgICAgICAgICB2YXIgc3ViV29ya2VyQ3JlYXRlZCA9IG5ldyBXb3JrZXIod29ya2VyRXZlbnQuZGF0YS5zY3JpcHRVcmwpO1xyXG4gICAgICAgICAgICAgICAgdmFyIGlkID0gd29ya2VyRXZlbnQuZGF0YS5zdWJXb3JrZXJJZDtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgdGhhdC5fc3ViV29ya2VyQnlJZFtpZF0gPSBzdWJXb3JrZXJDcmVhdGVkO1xyXG4gICAgICAgICAgICAgICAgdGhhdC5fc3ViV29ya2Vycy5wdXNoKHN1YldvcmtlckNyZWF0ZWQpO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICBzdWJXb3JrZXJDcmVhdGVkLm9ubWVzc2FnZSA9IGZ1bmN0aW9uIG9uU3ViV29ya2VyTWVzc2FnZShzdWJXb3JrZXJFdmVudCkge1xyXG4gICAgICAgICAgICAgICAgICAgIGVucXVldWVNZXNzYWdlVG9TbGF2ZShcclxuICAgICAgICAgICAgICAgICAgICAgICAgdGhhdCwgc3ViV29ya2VyRXZlbnQucG9ydHMsIC8qaXNGdW5jdGlvbkNhbGw9Ki9mYWxzZSwge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZnVuY3Rpb25Ub0NhbGw6ICdzdWJXb3JrZXJPbk1lc3NhZ2UnLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgc3ViV29ya2VySWQ6IGlkLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZGF0YTogc3ViV29ya2VyRXZlbnQuZGF0YVxyXG4gICAgICAgICAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgIH07XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIGJyZWFrO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgY2FzZSAnc3ViV29ya2VyUG9zdE1lc3NhZ2UnOlxyXG4gICAgICAgICAgICAgICAgdmFyIHN1YldvcmtlclRvUG9zdE1lc3NhZ2UgPSB0aGF0Ll9zdWJXb3JrZXJCeUlkW3dvcmtlckV2ZW50LmRhdGEuc3ViV29ya2VySWRdO1xyXG4gICAgICAgICAgICAgICAgc3ViV29ya2VyVG9Qb3N0TWVzc2FnZS5wb3N0TWVzc2FnZSh3b3JrZXJFdmVudC5kYXRhLmRhdGEpO1xyXG4gICAgICAgICAgICAgICAgYnJlYWs7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBjYXNlICdzdWJXb3JrZXJUZXJtaW5hdGUnOlxyXG4gICAgICAgICAgICAgICAgdmFyIHN1YldvcmtlclRvVGVybWluYXRlID0gdGhhdC5fc3ViV29ya2VyQnlJZFt3b3JrZXJFdmVudC5kYXRhLnN1YldvcmtlcklkXTtcclxuICAgICAgICAgICAgICAgIHN1YldvcmtlclRvVGVybWluYXRlLnRlcm1pbmF0ZSgpO1xyXG4gICAgICAgICAgICAgICAgYnJlYWs7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBkZWZhdWx0OlxyXG4gICAgICAgICAgICAgICAgdGhyb3cgJ1Vua25vd24gbWVzc2FnZSBmcm9tIEFzeW5jUHJveHlTbGF2ZSBvZiB0eXBlOiAnICtcclxuICAgICAgICAgICAgICAgICAgICB3b3JrZXJFdmVudC5kYXRhLnR5cGU7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgXHJcbiAgICBmdW5jdGlvbiBlbnF1ZXVlTWVzc2FnZVRvU2xhdmUoXHJcbiAgICAgICAgdGhhdCwgdHJhbnNmZXJhYmxlcywgaXNGdW5jdGlvbkNhbGwsIG1lc3NhZ2UpIHtcclxuICAgICAgICBcclxuICAgICAgICBpZiAodGhhdC5fbm90UmV0dXJuZWRGdW5jdGlvbnMgPj0gdGhhdC5fZnVuY3Rpb25zQnVmZmVyU2l6ZSkge1xyXG4gICAgICAgICAgICB0aGF0Ll9wZW5kaW5nTWVzc2FnZXMucHVzaCh7XHJcbiAgICAgICAgICAgICAgICB0cmFuc2ZlcmFibGVzOiB0cmFuc2ZlcmFibGVzLFxyXG4gICAgICAgICAgICAgICAgaXNGdW5jdGlvbkNhbGw6IGlzRnVuY3Rpb25DYWxsLFxyXG4gICAgICAgICAgICAgICAgbWVzc2FnZTogbWVzc2FnZVxyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBzZW5kTWVzc2FnZVRvU2xhdmUodGhhdCwgdHJhbnNmZXJhYmxlcywgaXNGdW5jdGlvbkNhbGwsIG1lc3NhZ2UpO1xyXG4gICAgfVxyXG4gICAgICAgIFxyXG4gICAgZnVuY3Rpb24gc2VuZE1lc3NhZ2VUb1NsYXZlKFxyXG4gICAgICAgIHRoYXQsIHRyYW5zZmVyYWJsZXMsIGlzRnVuY3Rpb25DYWxsLCBtZXNzYWdlKSB7XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKGlzRnVuY3Rpb25DYWxsKSB7XHJcbiAgICAgICAgICAgICsrdGhhdC5fbm90UmV0dXJuZWRGdW5jdGlvbnM7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHRoYXQuX3dvcmtlci5wb3N0TWVzc2FnZShtZXNzYWdlLCB0cmFuc2ZlcmFibGVzKTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgZnVuY3Rpb24gdHJ5U2VuZFBlbmRpbmdNZXNzYWdlcyh0aGF0KSB7XHJcbiAgICAgICAgd2hpbGUgKHRoYXQuX25vdFJldHVybmVkRnVuY3Rpb25zIDwgdGhhdC5fZnVuY3Rpb25zQnVmZmVyU2l6ZSAmJlxyXG4gICAgICAgICAgICAgICB0aGF0Ll9wZW5kaW5nTWVzc2FnZXMubGVuZ3RoID4gMCkge1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgdmFyIG1lc3NhZ2UgPSB0aGF0Ll9wZW5kaW5nTWVzc2FnZXMuc2hpZnQoKTtcclxuICAgICAgICAgICAgc2VuZE1lc3NhZ2VUb1NsYXZlKFxyXG4gICAgICAgICAgICAgICAgdGhhdCxcclxuICAgICAgICAgICAgICAgIG1lc3NhZ2UudHJhbnNmZXJhYmxlcyxcclxuICAgICAgICAgICAgICAgIG1lc3NhZ2UuaXNGdW5jdGlvbkNhbGwsXHJcbiAgICAgICAgICAgICAgICBtZXNzYWdlLm1lc3NhZ2UpO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuICAgIFxyXG4gICAgZnVuY3Rpb24gZ2V0QmFzZVVybEZyb21FbnRyeVNjcmlwdCgpIHtcclxuICAgICAgICB2YXIgYmFzZVVybCA9IGxvY2F0aW9uLmhyZWY7XHJcbiAgICAgICAgdmFyIGVuZE9mUGF0aCA9IGJhc2VVcmwubGFzdEluZGV4T2YoJy8nKTtcclxuICAgICAgICBpZiAoZW5kT2ZQYXRoID49IDApIHtcclxuICAgICAgICAgICAgYmFzZVVybCA9IGJhc2VVcmwuc3Vic3RyaW5nKDAsIGVuZE9mUGF0aCk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHJldHVybiBiYXNlVXJsO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICByZXR1cm4gQXN5bmNQcm94eU1hc3RlcjtcclxufSkoKTtcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gQXN5bmNQcm94eU1hc3RlcjsiLCIndXNlIHN0cmljdCc7XHJcblxyXG4vKiBnbG9iYWwgY29uc29sZTogZmFsc2UgKi9cclxuLyogZ2xvYmFsIHNlbGY6IGZhbHNlICovXHJcblxyXG52YXIgQXN5bmNQcm94eU1hc3RlciA9IHJlcXVpcmUoJ2FzeW5jLXByb3h5LW1hc3RlcicpO1xyXG52YXIgU3ViV29ya2VyRW11bGF0aW9uRm9yQ2hyb21lID0gcmVxdWlyZSgnc3ViLXdvcmtlci1lbXVsYXRpb24tZm9yLWNocm9tZScpO1xyXG5cclxudmFyIEFzeW5jUHJveHlTbGF2ZSA9IChmdW5jdGlvbiBBc3luY1Byb3h5U2xhdmVDbG9zdXJlKCkge1xyXG4gICAgdmFyIHNsYXZlSGVscGVyU2luZ2xldG9uID0ge307XHJcbiAgICBcclxuICAgIHZhciBiZWZvcmVPcGVyYXRpb25MaXN0ZW5lciA9IG51bGw7XHJcbiAgICB2YXIgc2xhdmVTaWRlTWFpbkluc3RhbmNlO1xyXG4gICAgdmFyIHNsYXZlU2lkZUluc3RhbmNlQ3JlYXRvciA9IGRlZmF1bHRJbnN0YW5jZUNyZWF0b3I7XHJcbiAgICB2YXIgc3ViV29ya2VySWRUb1N1YldvcmtlciA9IHt9O1xyXG4gICAgdmFyIGN0b3JOYW1lO1xyXG4gICAgXHJcbiAgICBzbGF2ZUhlbHBlclNpbmdsZXRvbi5faW5pdGlhbGl6ZVNsYXZlID0gZnVuY3Rpb24gaW5pdGlhbGl6ZVNsYXZlKCkge1xyXG4gICAgICAgIHNlbGYub25tZXNzYWdlID0gb25NZXNzYWdlO1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgc2xhdmVIZWxwZXJTaW5nbGV0b24uc2V0U2xhdmVTaWRlQ3JlYXRvciA9IGZ1bmN0aW9uIHNldFNsYXZlU2lkZUNyZWF0b3IoY3JlYXRvcikge1xyXG4gICAgICAgIHNsYXZlU2lkZUluc3RhbmNlQ3JlYXRvciA9IGNyZWF0b3I7XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBzbGF2ZUhlbHBlclNpbmdsZXRvbi5zZXRCZWZvcmVPcGVyYXRpb25MaXN0ZW5lciA9XHJcbiAgICAgICAgZnVuY3Rpb24gc2V0QmVmb3JlT3BlcmF0aW9uTGlzdGVuZXIobGlzdGVuZXIpIHtcclxuICAgICAgICAgICAgYmVmb3JlT3BlcmF0aW9uTGlzdGVuZXIgPSBsaXN0ZW5lcjtcclxuICAgICAgICB9O1xyXG4gICAgICAgIFxyXG4gICAgc2xhdmVIZWxwZXJTaW5nbGV0b24uc2VuZFVzZXJEYXRhVG9NYXN0ZXIgPSBmdW5jdGlvbiBzZW5kVXNlckRhdGFUb01hc3RlcihcclxuICAgICAgICB1c2VyRGF0YSkge1xyXG4gICAgICAgIFxyXG4gICAgICAgIHNlbGYucG9zdE1lc3NhZ2Uoe1xyXG4gICAgICAgICAgICB0eXBlOiAndXNlckRhdGEnLFxyXG4gICAgICAgICAgICB1c2VyRGF0YTogdXNlckRhdGFcclxuICAgICAgICB9KTtcclxuICAgIH07XHJcbiAgICBcclxuICAgIHNsYXZlSGVscGVyU2luZ2xldG9uLndyYXBQcm9taXNlRnJvbVNsYXZlU2lkZSA9XHJcbiAgICAgICAgZnVuY3Rpb24gd3JhcFByb21pc2VGcm9tU2xhdmVTaWRlKFxyXG4gICAgICAgICAgICBjYWxsSWQsIHByb21pc2UsIHBhdGhzVG9UcmFuc2ZlcmFibGVzKSB7XHJcbiAgICAgICAgXHJcbiAgICAgICAgdmFyIHByb21pc2VUaGVuID0gcHJvbWlzZS50aGVuKGZ1bmN0aW9uIHNlbmRQcm9taXNlVG9NYXN0ZXIocmVzdWx0KSB7XHJcbiAgICAgICAgICAgIHZhciB0cmFuc2ZlcmFibGVzID1cclxuXHRcdFx0XHRBc3luY1Byb3h5TWFzdGVyLl9leHRyYWN0VHJhbnNmZXJhYmxlcyhcclxuXHRcdFx0XHRcdHBhdGhzVG9UcmFuc2ZlcmFibGVzLCByZXN1bHQpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgc2VsZi5wb3N0TWVzc2FnZShcclxuICAgICAgICAgICAgICAgIHtcclxuICAgICAgICAgICAgICAgICAgICB0eXBlOiAncHJvbWlzZVJlc3VsdCcsXHJcbiAgICAgICAgICAgICAgICAgICAgY2FsbElkOiBjYWxsSWQsXHJcbiAgICAgICAgICAgICAgICAgICAgcmVzdWx0OiByZXN1bHRcclxuICAgICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgICAgICB0cmFuc2ZlcmFibGVzKTtcclxuICAgICAgICB9KTtcclxuICAgICAgICBcclxuICAgICAgICBwcm9taXNlVGhlblsnY2F0Y2gnXShmdW5jdGlvbiBzZW5kRmFpbHVyZVRvTWFzdGVyKHJlYXNvbikge1xyXG4gICAgICAgICAgICBzZWxmLnBvc3RNZXNzYWdlKHtcclxuICAgICAgICAgICAgICAgIHR5cGU6ICdwcm9taXNlRmFpbHVyZScsXHJcbiAgICAgICAgICAgICAgICBjYWxsSWQ6IGNhbGxJZCxcclxuICAgICAgICAgICAgICAgIHJlYXNvbjogcmVhc29uXHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgIH0pO1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgc2xhdmVIZWxwZXJTaW5nbGV0b24ud3JhcENhbGxiYWNrRnJvbVNsYXZlU2lkZSA9XHJcbiAgICAgICAgZnVuY3Rpb24gd3JhcENhbGxiYWNrRnJvbVNsYXZlU2lkZShjYWxsYmFja0hhbmRsZSkge1xyXG4gICAgICAgICAgICBcclxuICAgICAgICB2YXIgaXNBbHJlYWR5Q2FsbGVkID0gZmFsc2U7XHJcbiAgICAgICAgXHJcbiAgICAgICAgZnVuY3Rpb24gY2FsbGJhY2tXcmFwcGVyRnJvbVNsYXZlU2lkZSgpIHtcclxuICAgICAgICAgICAgaWYgKGlzQWxyZWFkeUNhbGxlZCkge1xyXG4gICAgICAgICAgICAgICAgdGhyb3cgJ0NhbGxiYWNrIGlzIGNhbGxlZCB0d2ljZSBidXQgaXNNdWx0aXBsZVRpbWVDYWxsYmFjayAnICtcclxuICAgICAgICAgICAgICAgICAgICAnPSBmYWxzZSc7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHZhciBhcmd1bWVudHNBc0FycmF5ID0gZ2V0QXJndW1lbnRzQXNBcnJheShhcmd1bWVudHMpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgaWYgKGJlZm9yZU9wZXJhdGlvbkxpc3RlbmVyICE9PSBudWxsKSB7XHJcblx0XHRcdFx0dHJ5IHtcclxuXHRcdFx0XHRcdGJlZm9yZU9wZXJhdGlvbkxpc3RlbmVyLmNhbGwoXHJcblx0XHRcdFx0XHRcdHNsYXZlU2lkZU1haW5JbnN0YW5jZSxcclxuXHRcdFx0XHRcdFx0J2NhbGxiYWNrJyxcclxuXHRcdFx0XHRcdFx0Y2FsbGJhY2tIYW5kbGUuY2FsbGJhY2tOYW1lLFxyXG5cdFx0XHRcdFx0XHRhcmd1bWVudHNBc0FycmF5KTtcclxuXHRcdFx0XHR9IGNhdGNoIChlKSB7XHJcblx0XHRcdFx0XHRjb25zb2xlLmxvZygnQXN5bmNQcm94eVNsYXZlLmJlZm9yZU9wZXJhdGlvbkxpc3RlbmVyIGhhcyB0aHJvd24gYW4gZXhjZXB0aW9uOiAnICsgZSk7XHJcblx0XHRcdFx0fVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICB2YXIgdHJhbnNmZXJhYmxlcyA9XHJcblx0XHRcdFx0QXN5bmNQcm94eU1hc3Rlci5fZXh0cmFjdFRyYW5zZmVyYWJsZXMoXHJcblx0XHRcdFx0XHRjYWxsYmFja0hhbmRsZS5wYXRoc1RvVHJhbnNmZXJhYmxlcywgYXJndW1lbnRzQXNBcnJheSk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBzZWxmLnBvc3RNZXNzYWdlKHtcclxuICAgICAgICAgICAgICAgICAgICB0eXBlOiAnY2FsbGJhY2snLFxyXG4gICAgICAgICAgICAgICAgICAgIGNhbGxJZDogY2FsbGJhY2tIYW5kbGUuY2FsbElkLFxyXG4gICAgICAgICAgICAgICAgICAgIGFyZ3M6IGFyZ3VtZW50c0FzQXJyYXlcclxuICAgICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgICAgICB0cmFuc2ZlcmFibGVzKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGlmICghY2FsbGJhY2tIYW5kbGUuaXNNdWx0aXBsZVRpbWVDYWxsYmFjaykge1xyXG4gICAgICAgICAgICAgICAgaXNBbHJlYWR5Q2FsbGVkID0gdHJ1ZTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICByZXR1cm4gY2FsbGJhY2tXcmFwcGVyRnJvbVNsYXZlU2lkZTtcclxuICAgIH07XHJcbiAgICBcclxuICAgIGZ1bmN0aW9uIG9uTWVzc2FnZShldmVudCkge1xyXG4gICAgICAgIHZhciBmdW5jdGlvbk5hbWVUb0NhbGwgPSBldmVudC5kYXRhLmZ1bmN0aW9uVG9DYWxsO1xyXG4gICAgICAgIHZhciBhcmdzID0gZXZlbnQuZGF0YS5hcmdzO1xyXG4gICAgICAgIHZhciBjYWxsSWQgPSBldmVudC5kYXRhLmNhbGxJZDtcclxuICAgICAgICB2YXIgaXNQcm9taXNlID0gZXZlbnQuZGF0YS5pc1Byb21pc2U7XHJcbiAgICAgICAgdmFyIHBhdGhzVG9UcmFuc2ZlcmFibGVzSW5Qcm9taXNlUmVzdWx0ID1cclxuICAgICAgICAgICAgZXZlbnQuZGF0YS5wYXRoc1RvVHJhbnNmZXJhYmxlc0luUHJvbWlzZVJlc3VsdDtcclxuICAgICAgICBcclxuICAgICAgICB2YXIgcmVzdWx0ID0gbnVsbDtcclxuICAgICAgICBcclxuICAgICAgICBzd2l0Y2ggKGZ1bmN0aW9uTmFtZVRvQ2FsbCkge1xyXG4gICAgICAgICAgICBjYXNlICdjdG9yJzpcclxuICAgICAgICAgICAgICAgIEFzeW5jUHJveHlNYXN0ZXIuX3NldEVudHJ5VXJsKGV2ZW50LmRhdGEubWFzdGVyRW50cnlVcmwpO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICB2YXIgc2NyaXB0c1RvSW1wb3J0ID0gZXZlbnQuZGF0YS5zY3JpcHRzVG9JbXBvcnQ7XHJcbiAgICAgICAgICAgICAgICBjdG9yTmFtZSA9IGV2ZW50LmRhdGEuY3Rvck5hbWU7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgc2NyaXB0c1RvSW1wb3J0Lmxlbmd0aDsgKytpKSB7XHJcblx0XHRcdFx0XHQvKiBnbG9iYWwgaW1wb3J0U2NyaXB0czogZmFsc2UgKi9cclxuICAgICAgICAgICAgICAgICAgICBpbXBvcnRTY3JpcHRzKHNjcmlwdHNUb0ltcG9ydFtpXSk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIHNsYXZlU2lkZU1haW5JbnN0YW5jZSA9IHNsYXZlU2lkZUluc3RhbmNlQ3JlYXRvci5hcHBseShudWxsLCBhcmdzKTtcclxuXHJcbiAgICAgICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBjYXNlICdzdWJXb3JrZXJPbk1lc3NhZ2UnOlxyXG4gICAgICAgICAgICAgICAgdmFyIHN1YldvcmtlciA9IHN1YldvcmtlcklkVG9TdWJXb3JrZXJbZXZlbnQuZGF0YS5zdWJXb3JrZXJJZF07XHJcbiAgICAgICAgICAgICAgICB2YXIgd29ya2VyRXZlbnQgPSB7IGRhdGE6IGV2ZW50LmRhdGEuZGF0YSB9O1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICBzdWJXb3JrZXIub25tZXNzYWdlKHdvcmtlckV2ZW50KTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBhcmdzID0gbmV3IEFycmF5KGV2ZW50LmRhdGEuYXJncy5sZW5ndGgpO1xyXG4gICAgICAgIGZvciAodmFyIGogPSAwOyBqIDwgZXZlbnQuZGF0YS5hcmdzLmxlbmd0aDsgKytqKSB7XHJcbiAgICAgICAgICAgIHZhciBhcmcgPSBldmVudC5kYXRhLmFyZ3Nbal07XHJcbiAgICAgICAgICAgIGlmIChhcmcgIT09IHVuZGVmaW5lZCAmJlxyXG4gICAgICAgICAgICAgICAgYXJnICE9PSBudWxsICYmXHJcbiAgICAgICAgICAgICAgICBhcmcuaXNXb3JrZXJIZWxwZXJDYWxsYmFjaykge1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICBhcmcgPSBzbGF2ZUhlbHBlclNpbmdsZXRvbi53cmFwQ2FsbGJhY2tGcm9tU2xhdmVTaWRlKGFyZyk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGFyZ3Nbal0gPSBhcmc7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHZhciBmdW5jdGlvbkNvbnRhaW5lciA9IHNsYXZlU2lkZU1haW5JbnN0YW5jZTtcclxuICAgICAgICB2YXIgZnVuY3Rpb25Ub0NhbGw7XHJcbiAgICAgICAgd2hpbGUgKGZ1bmN0aW9uQ29udGFpbmVyKSB7XHJcbiAgICAgICAgICAgIGZ1bmN0aW9uVG9DYWxsID0gc2xhdmVTaWRlTWFpbkluc3RhbmNlW2Z1bmN0aW9uTmFtZVRvQ2FsbF07XHJcbiAgICAgICAgICAgIGlmIChmdW5jdGlvblRvQ2FsbCkge1xyXG4gICAgICAgICAgICAgICAgYnJlYWs7XHJcbiAgICAgICAgICAgIH1cclxuXHRcdFx0LyoganNoaW50IHByb3RvOiB0cnVlICovXHJcbiAgICAgICAgICAgIGZ1bmN0aW9uQ29udGFpbmVyID0gZnVuY3Rpb25Db250YWluZXIuX19wcm90b19fO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBpZiAoIWZ1bmN0aW9uVG9DYWxsKSB7XHJcbiAgICAgICAgICAgIHRocm93ICdBc3luY1Byb3h5IGVycm9yOiBjb3VsZCBub3QgZmluZCBmdW5jdGlvbiAnICsgZnVuY3Rpb25OYW1lVG9DYWxsO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICB2YXIgcHJvbWlzZSA9IGZ1bmN0aW9uVG9DYWxsLmFwcGx5KHNsYXZlU2lkZU1haW5JbnN0YW5jZSwgYXJncyk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKGlzUHJvbWlzZSkge1xyXG4gICAgICAgICAgICBzbGF2ZUhlbHBlclNpbmdsZXRvbi53cmFwUHJvbWlzZUZyb21TbGF2ZVNpZGUoXHJcbiAgICAgICAgICAgICAgICBjYWxsSWQsIHByb21pc2UsIHBhdGhzVG9UcmFuc2ZlcmFibGVzSW5Qcm9taXNlUmVzdWx0KTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIHNlbGYucG9zdE1lc3NhZ2Uoe1xyXG4gICAgICAgICAgICB0eXBlOiAnZnVuY3Rpb25DYWxsZWQnLFxyXG4gICAgICAgICAgICBjYWxsSWQ6IGV2ZW50LmRhdGEuY2FsbElkLFxyXG4gICAgICAgICAgICByZXN1bHQ6IHJlc3VsdFxyXG4gICAgICAgIH0pO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBmdW5jdGlvbiBkZWZhdWx0SW5zdGFuY2VDcmVhdG9yKCkge1xyXG4gICAgICAgIHZhciBpbnN0YW5jZTtcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICB2YXIgbmFtZXNwYWNlc0FuZEN0b3JOYW1lID0gY3Rvck5hbWUuc3BsaXQoJy4nKTtcclxuICAgICAgICAgICAgdmFyIG1lbWJlciA9IHNlbGY7XHJcbiAgICAgICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgbmFtZXNwYWNlc0FuZEN0b3JOYW1lLmxlbmd0aDsgKytpKVxyXG4gICAgICAgICAgICAgICAgbWVtYmVyID0gbWVtYmVyW25hbWVzcGFjZXNBbmRDdG9yTmFtZVtpXV07XHJcbiAgICAgICAgICAgIHZhciBUeXBlQ3RvciA9IG1lbWJlcjtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHZhciBiaW5kQXJncyA9IFtudWxsXS5jb25jYXQoZ2V0QXJndW1lbnRzQXNBcnJheShhcmd1bWVudHMpKTtcclxuICAgICAgICAgICAgaW5zdGFuY2UgPSBuZXcgKEZ1bmN0aW9uLnByb3RvdHlwZS5iaW5kLmFwcGx5KFR5cGVDdG9yLCBiaW5kQXJncykpKCk7XHJcbiAgICAgICAgfSBjYXRjaCAoZSkge1xyXG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0ZhaWxlZCBsb2NhdGluZyBjbGFzcyBuYW1lICcgKyBjdG9yTmFtZSArICc6ICcgKyBlKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgcmV0dXJuIGluc3RhbmNlO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBmdW5jdGlvbiBnZXRBcmd1bWVudHNBc0FycmF5KGFyZ3MpIHtcclxuICAgICAgICB2YXIgYXJndW1lbnRzQXNBcnJheSA9IG5ldyBBcnJheShhcmdzLmxlbmd0aCk7XHJcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBhcmdzLmxlbmd0aDsgKytpKSB7XHJcbiAgICAgICAgICAgIGFyZ3VtZW50c0FzQXJyYXlbaV0gPSBhcmdzW2ldO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICByZXR1cm4gYXJndW1lbnRzQXNBcnJheTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgaWYgKHNlbGYuV29ya2VyID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICBTdWJXb3JrZXJFbXVsYXRpb25Gb3JDaHJvbWUuaW5pdGlhbGl6ZShzdWJXb3JrZXJJZFRvU3ViV29ya2VyKTtcclxuICAgICAgICBzZWxmLldvcmtlciA9IFN1YldvcmtlckVtdWxhdGlvbkZvckNocm9tZTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgcmV0dXJuIHNsYXZlSGVscGVyU2luZ2xldG9uO1xyXG59KSgpO1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBBc3luY1Byb3h5U2xhdmU7IiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxudmFyIERlcGVuZGVuY3lXb3JrZXJzVGFza0NvbnRleHQgPSAoZnVuY3Rpb24gRGVwZW5kZW5jeVdvcmtlcnNUYXNrQ29udGV4dENsb3N1cmUoKSB7XHJcbiAgICBmdW5jdGlvbiBEZXBlbmRlbmN5V29ya2Vyc1Rhc2tDb250ZXh0KHRhc2tJbnRlcm5hbHMsIGNhbGxiYWNrcykge1xyXG4gICAgICAgIHRoaXMuX3Rhc2tJbnRlcm5hbHMgPSB0YXNrSW50ZXJuYWxzO1xyXG4gICAgICAgIHRoaXMuX2NhbGxiYWNrcyA9IGNhbGxiYWNrcztcclxuICAgICAgICB0aGlzLl90YXNrQ29udGV4dHNJdGVyYXRvciA9IHRhc2tJbnRlcm5hbHMudGFza0NvbnRleHRzLmFkZCh0aGlzKTtcclxuXHRcdHRoaXMuX3ByaW9yaXR5Q2FsY3VsYXRvckl0ZXJhdG9yID0gbnVsbDtcclxuICAgIH1cclxuICAgIFxyXG4gICAgRGVwZW5kZW5jeVdvcmtlcnNUYXNrQ29udGV4dC5wcm90b3R5cGUuaGFzRGF0YSA9IGZ1bmN0aW9uIGhhc0RhdGEoKSB7XHJcbiAgICAgICAgcmV0dXJuIHRoaXMuX3Rhc2tJbnRlcm5hbHMuaGFzUHJvY2Vzc2VkRGF0YTtcclxuICAgIH07XHJcbiAgICBcclxuICAgIERlcGVuZGVuY3lXb3JrZXJzVGFza0NvbnRleHQucHJvdG90eXBlLmdldExhc3REYXRhID0gZnVuY3Rpb24gZ2V0TGFzdERhdGEoKSB7XHJcbiAgICAgICAgcmV0dXJuIHRoaXMuX3Rhc2tJbnRlcm5hbHMubGFzdFByb2Nlc3NlZERhdGE7XHJcbiAgICB9O1xyXG5cdFxyXG5cdERlcGVuZGVuY3lXb3JrZXJzVGFza0NvbnRleHQucHJvdG90eXBlLnNldFByaW9yaXR5Q2FsY3VsYXRvciA9IGZ1bmN0aW9uIHNldFByaW9yaXR5Q2FsY3VsYXRvcihjYWxjdWxhdG9yKSB7XHJcblx0XHRpZiAodGhpcy5fcHJpb3JpdHlDYWxjdWxhdG9ySXRlcmF0b3IgIT09IG51bGwpIHtcclxuXHRcdFx0dGhpcy5fdGFza0ludGVybmFscy5wcmlvcml0eUNhbGN1bGF0b3JzLnJlbW92ZSh0aGlzLl9wcmlvcml0eUNhbGN1bGF0b3JJdGVyYXRvcik7XHJcblx0XHRcdHRoaXMuX3ByaW9yaXR5Q2FsY3VsYXRvckl0ZXJhdG9yID0gbnVsbDtcclxuXHRcdFx0aWYgKCFjYWxjdWxhdG9yICYmIHRoaXMuX3Rhc2tJbnRlcm5hbHMucHJpb3JpdHlDYWxjdWxhdG9ycy5nZXRDb3VudCgpID09PSAwKSB7XHJcblx0XHRcdFx0dGhpcy5fdGFza0ludGVybmFscy51bnJlZ2lzdGVyRGVwZW5kUHJpb3JpdHlDYWxjdWxhdG9yKCk7XHJcblx0XHRcdH1cclxuXHRcdH0gZWxzZSBpZiAoY2FsY3VsYXRvciAmJiB0aGlzLl90YXNrSW50ZXJuYWxzLnByaW9yaXR5Q2FsY3VsYXRvcnMuZ2V0Q291bnQoKSA9PT0gMCkge1xyXG5cdFx0XHR0aGlzLl90YXNrSW50ZXJuYWxzLnJlZ2lzdGVyRGVwZW5kUHJpb3JpdHlDYWxjdWxhdG9yKCk7XHJcblx0XHR9XHJcblx0XHRcclxuXHRcdGlmIChjYWxjdWxhdG9yKSB7XHJcblx0XHRcdHRoaXMuX3ByaW9yaXR5Q2FsY3VsYXRvckl0ZXJhdG9yID0gdGhpcy5fdGFza0ludGVybmFscy5wcmlvcml0eUNhbGN1bGF0b3JzLmFkZChjYWxjdWxhdG9yKTtcclxuXHRcdH1cclxuXHR9O1xyXG4gICAgXHJcbiAgICBEZXBlbmRlbmN5V29ya2Vyc1Rhc2tDb250ZXh0LnByb3RvdHlwZS51bnJlZ2lzdGVyID0gZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgaWYgKCF0aGlzLl90YXNrQ29udGV4dHNJdGVyYXRvcikge1xyXG4gICAgICAgICAgICB0aHJvdyAnQXN5bmNQcm94eS5EZXBlbmRlbmN5V29ya2VyczogQWxyZWFkeSB1bnJlZ2lzdGVyZWQnO1xyXG4gICAgICAgIH1cclxuXHRcdFxyXG5cdFx0dGhpcy5zZXRQcmlvcml0eUNhbGN1bGF0b3IobnVsbCk7XHJcblx0XHRcclxuICAgICAgICB0aGlzLl90YXNrSW50ZXJuYWxzLnRhc2tDb250ZXh0cy5yZW1vdmUodGhpcy5fdGFza0NvbnRleHRzSXRlcmF0b3IpO1xyXG4gICAgICAgIHRoaXMuX3Rhc2tDb250ZXh0c0l0ZXJhdG9yID0gbnVsbDtcclxuICAgICAgICBcclxuXHRcdGlmICghdGhpcy5fdGFza0ludGVybmFscy5pc1Rlcm1pbmF0ZWQpIHtcclxuXHRcdFx0Ly8gU2hvdWxkIGJlIGNhbGxlZCBmcm9tIHN0YXR1c1VwZGF0ZSB3aGVuIHdvcmtlciBzaHV0IGRvd25cclxuXHRcdFx0Ly90aGlzLl90YXNrSW50ZXJuYWxzLmVuZGVkKCk7XHJcblx0XHRcdFxyXG5cdFx0XHR0aGlzLl90YXNrSW50ZXJuYWxzLnN0YXR1c1VwZGF0ZSgpO1xyXG5cdFx0fVxyXG4gICAgfTtcclxuXHJcbiAgICByZXR1cm4gRGVwZW5kZW5jeVdvcmtlcnNUYXNrQ29udGV4dDtcclxufSkoKTtcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gRGVwZW5kZW5jeVdvcmtlcnNUYXNrQ29udGV4dDsiLCIndXNlIHN0cmljdCc7XHJcblxyXG52YXIgTGlua2VkTGlzdCA9IHJlcXVpcmUoJ2xpbmtlZC1saXN0Jyk7XHJcbnZhciBKc0J1aWx0aW5IYXNoTWFwID0gcmVxdWlyZSgnanMtYnVpbHRpbi1oYXNoLW1hcCcpO1xyXG52YXIgRGVwZW5kZW5jeVdvcmtlcnNUYXNrID0gcmVxdWlyZSgnZGVwZW5kZW5jeS13b3JrZXJzLXRhc2snKTtcclxuXHJcbnZhciBEZXBlbmRlbmN5V29ya2Vyc1Rhc2tJbnRlcm5hbHMgPSAoZnVuY3Rpb24gRGVwZW5kZW5jeVdvcmtlcnNUYXNrSW50ZXJuYWxzQ2xvc3VyZSgpIHtcclxuXHRmdW5jdGlvbiBEZXBlbmRlbmN5V29ya2Vyc1Rhc2tJbnRlcm5hbHMoKSB7XHJcbiAgICAgICAgLy8gVGhpcyBjbGFzcyBpcyBub3QgZXhwb3NlZCBvdXRzaWRlIEFzeW5jUHJveHkgYnV0IGFzIGFuIGludGVybmFsIHN0cnVjdCwgdGh1cyBcclxuICAgICAgICAvLyBtYXkgY29udGFpbiBwdWJsaWMgbWVtYmVyc1xyXG4gICAgICAgIFxyXG4gICAgICAgIHRoaXMuaXNUZXJtaW5hdGVkID0gZmFsc2U7XHJcbiAgICAgICAgdGhpcy5sYXN0UHJvY2Vzc2VkRGF0YSA9IG51bGw7XHJcblx0XHR0aGlzLnRhc2tBcGkgPSBudWxsO1xyXG4gICAgICAgIHRoaXMuaGFzUHJvY2Vzc2VkRGF0YSA9IGZhbHNlO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHRoaXMud2FpdGluZ0ZvcldvcmtlclJlc3VsdCA9IGZhbHNlO1xyXG4gICAgICAgIHRoaXMuaXNQZW5kaW5nRGF0YUZvcldvcmtlciA9IGZhbHNlO1xyXG4gICAgICAgIHRoaXMucGVuZGluZ0RhdGFGb3JXb3JrZXIgPSBudWxsO1xyXG4gICAgICAgIHRoaXMucGVuZGluZ1dvcmtlclR5cGUgPSAwO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHRoaXMudGFza0NvbnRleHRzID0gbmV3IExpbmtlZExpc3QoKTtcclxuXHRcdHRoaXMucHJpb3JpdHlDYWxjdWxhdG9ycyA9IG5ldyBMaW5rZWRMaXN0KCk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgdGhpcy50YXNrS2V5ID0gbnVsbDtcclxuXHRcdHRoaXMuX2lzQWN0dWFsVGVybWluYXRpb25QZW5kaW5nID0gZmFsc2U7XHJcbiAgICAgICAgdGhpcy5fZGVwZW5kc1Rhc2tzVGVybWluYXRlZENvdW50ID0gMDtcclxuICAgICAgICB0aGlzLl9wYXJlbnREZXBlbmRlbmN5V29ya2VycyA9IG51bGw7XHJcbiAgICAgICAgdGhpcy5fd29ya2VySW5wdXRSZXRyZWl2ZXIgPSBudWxsO1xyXG4gICAgICAgIHRoaXMuX3BhcmVudExpc3QgPSBudWxsO1xyXG4gICAgICAgIHRoaXMuX3BhcmVudEl0ZXJhdG9yID0gbnVsbDtcclxuICAgICAgICB0aGlzLl9kZXBlbmRzVGFza0NvbnRleHRzID0gbnVsbDtcclxuXHRcdHRoaXMuX3ByaW9yaXR5Q2FsY3VsYXRvciA9IG51bGw7XHJcblx0XHR0aGlzLl9pc1JlZ2lzdGVyZWREZXBlbmRQcmlvcml0eUNhbGN1bGF0b3IgPSBmYWxzZTtcclxuXHRcdFxyXG5cdFx0dGhpcy5fZGVwZW5kVGFza0tleXMgPSBbXTtcclxuXHRcdHRoaXMuX2RlcGVuZFRhc2tSZXN1bHRzID0gW107XHJcblx0XHR0aGlzLl9oYXNEZXBlbmRUYXNrRGF0YSA9IFtdO1xyXG5cdFx0XHJcblx0XHR0aGlzLl9wZW5kaW5nRGVsYXllZEFjdGlvbiA9IGZhbHNlO1xyXG5cdFx0dGhpcy5fcGVuZGluZ0RlbGF5ZWREZXBlbmRlbmN5RGF0YSA9IFtdO1xyXG5cdFx0dGhpcy5fcGVuZGluZ0RlbGF5ZWRFbmRlZCA9IGZhbHNlO1xyXG5cdFx0dGhpcy5fcGVuZGluZ0RlbGF5ZWROZXdEYXRhID0gZmFsc2U7XHJcblx0XHR0aGlzLl9wZXJmb3JtUGVuZGluZ0RlbGF5ZWRBY3Rpb25zQm91bmQgPSB0aGlzLl9wZXJmb3JtUGVuZGluZ0RlbGF5ZWRBY3Rpb25zLmJpbmQodGhpcyk7XHJcblx0fVxyXG4gICAgXHJcbiAgICBEZXBlbmRlbmN5V29ya2Vyc1Rhc2tJbnRlcm5hbHMucHJvdG90eXBlLmluaXRpYWxpemUgPSBmdW5jdGlvbihcclxuICAgICAgICAgICAgdGFza0tleSwgZGVwZW5kZW5jeVdvcmtlcnMsIGlucHV0UmV0cmVpdmVyLCBsaXN0LCBpdGVyYXRvciAvKiwgaGFzaGVyKi8pIHtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgIHRoaXMudGFza0tleSA9IHRhc2tLZXk7XHJcbiAgICAgICAgdGhpcy5fcGFyZW50RGVwZW5kZW5jeVdvcmtlcnMgPSBkZXBlbmRlbmN5V29ya2VycztcclxuICAgICAgICB0aGlzLl93b3JrZXJJbnB1dFJldHJlaXZlciA9IGlucHV0UmV0cmVpdmVyO1xyXG4gICAgICAgIHRoaXMuX3BhcmVudExpc3QgPSBsaXN0O1xyXG4gICAgICAgIHRoaXMuX3BhcmVudEl0ZXJhdG9yID0gaXRlcmF0b3I7XHJcbiAgICAgICAgLy90aGlzLl9kZXBlbmRzVGFza0NvbnRleHRzID0gbmV3IEhhc2hNYXAoaGFzaGVyKTtcclxuICAgICAgICB0aGlzLl9kZXBlbmRzVGFza0NvbnRleHRzID0gbmV3IEpzQnVpbHRpbkhhc2hNYXAoKTtcclxuXHRcdHRoaXMudGFza0FwaSA9IG5ldyBEZXBlbmRlbmN5V29ya2Vyc1Rhc2sodGhpcywgdGFza0tleSk7XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBEZXBlbmRlbmN5V29ya2Vyc1Rhc2tJbnRlcm5hbHMucHJvdG90eXBlLmVuZGVkID0gZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgdGhpcy5fcGFyZW50TGlzdC5yZW1vdmUodGhpcy5fcGFyZW50SXRlcmF0b3IpO1xyXG4gICAgICAgIHRoaXMuX3BhcmVudEl0ZXJhdG9yID0gbnVsbDtcclxuXHJcbiAgICAgICAgdmFyIGl0ZXJhdG9yID0gdGhpcy5fZGVwZW5kc1Rhc2tDb250ZXh0cy5nZXRGaXJzdEl0ZXJhdG9yKCk7XHJcbiAgICAgICAgd2hpbGUgKGl0ZXJhdG9yICE9PSBudWxsKSB7XHJcbiAgICAgICAgICAgIHZhciBjb250ZXh0ID0gdGhpcy5fZGVwZW5kc1Rhc2tDb250ZXh0cy5nZXRGcm9tSXRlcmF0b3IoaXRlcmF0b3IpLnRhc2tDb250ZXh0O1xyXG4gICAgICAgICAgICBpdGVyYXRvciA9IHRoaXMuX2RlcGVuZHNUYXNrQ29udGV4dHMuZ2V0TmV4dEl0ZXJhdG9yKGl0ZXJhdG9yKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGNvbnRleHQudW5yZWdpc3RlcigpO1xyXG4gICAgICAgIH1cclxuICAgICAgICB0aGlzLl9kZXBlbmRzVGFza0NvbnRleHRzLmNsZWFyKCk7XHJcblxyXG5cdFx0dGhpcy5fcGVuZGluZ0RlbGF5ZWRFbmRlZCA9IHRydWU7XHJcblx0XHRpZiAoIXRoaXMuX3BlbmRpbmdEZWxheWVkQWN0aW9uKSB7XHJcblx0XHRcdHRoaXMuX3BlbmRpbmdEZWxheWVkQWN0aW9uID0gdHJ1ZTtcclxuXHRcdFx0c2V0VGltZW91dCh0aGlzLl9wZXJmb3JtUGVuZGluZ0RlbGF5ZWRBY3Rpb25zQm91bmQpO1xyXG5cdFx0fVxyXG4gICAgfTtcclxuXHRcclxuICAgIERlcGVuZGVuY3lXb3JrZXJzVGFza0ludGVybmFscy5wcm90b3R5cGUuc3RhdHVzVXBkYXRlID0gZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgdmFyIHN0YXR1cyA9IHtcclxuICAgICAgICAgICAgJ2hhc0xpc3RlbmVycyc6IHRoaXMudGFza0NvbnRleHRzLmdldENvdW50KCkgPiAwLFxyXG4gICAgICAgICAgICAnaXNXYWl0aW5nRm9yV29ya2VyUmVzdWx0JzogdGhpcy53YWl0aW5nRm9yV29ya2VyUmVzdWx0LFxyXG4gICAgICAgICAgICAndGVybWluYXRlZERlcGVuZHNUYXNrcyc6IHRoaXMuX2RlcGVuZHNUYXNrc1Rlcm1pbmF0ZWRDb3VudCxcclxuICAgICAgICAgICAgJ2RlcGVuZHNUYXNrcyc6IHRoaXMuX2RlcGVuZHNUYXNrQ29udGV4dHMuZ2V0Q291bnQoKVxyXG4gICAgICAgIH07XHJcbiAgICAgICAgdGhpcy50YXNrQXBpLl9vbkV2ZW50KCdzdGF0dXNVcGRhdGVkJywgc3RhdHVzKTtcclxuXHJcblx0XHRpZiAodGhpcy5faXNBY3R1YWxUZXJtaW5hdGlvblBlbmRpbmcgJiYgIXRoaXMud2FpdGluZ0ZvcldvcmtlclJlc3VsdCkge1xyXG5cdFx0XHR0aGlzLl9pc0FjdHVhbFRlcm1pbmF0aW9uUGVuZGluZyA9IGZhbHNlO1xyXG5cdFx0XHR0aGlzLmVuZGVkKCk7XHJcblx0XHR9XHJcblx0fTtcclxuICAgIFxyXG4gICAgRGVwZW5kZW5jeVdvcmtlcnNUYXNrSW50ZXJuYWxzLnByb3RvdHlwZS5jYWxjdWxhdGVQcmlvcml0eSA9IGZ1bmN0aW9uKCkge1xyXG4gICAgICAgIFxyXG4gICAgICAgIHZhciBpdGVyYXRvciA9IHRoaXMucHJpb3JpdHlDYWxjdWxhdG9ycy5nZXRGaXJzdEl0ZXJhdG9yKCk7XHJcbiAgICAgICAgdmFyIGlzRmlyc3QgPSB0cnVlO1xyXG4gICAgICAgIHZhciBwcmlvcml0eSA9IDA7XHJcbiAgICAgICAgd2hpbGUgKGl0ZXJhdG9yICE9PSBudWxsKSB7XHJcbiAgICAgICAgICAgIHZhciBwcmlvcml0eUNhbGN1bGF0b3IgPSB0aGlzLnByaW9yaXR5Q2FsY3VsYXRvcnMuZ2V0RnJvbUl0ZXJhdG9yKGl0ZXJhdG9yKTtcclxuXHRcdFx0dmFyIGN1cnJlbnRQcmlvcml0eSA9IHByaW9yaXR5Q2FsY3VsYXRvcigpO1xyXG4gICAgICAgICAgICBpZiAoaXNGaXJzdCB8fCBjdXJyZW50UHJpb3JpdHkgPiBwcmlvcml0eSkge1xyXG4gICAgICAgICAgICAgICAgcHJpb3JpdHkgPSBjdXJyZW50UHJpb3JpdHk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgaXRlcmF0b3IgPSB0aGlzLnByaW9yaXR5Q2FsY3VsYXRvcnMuZ2V0TmV4dEl0ZXJhdG9yKGl0ZXJhdG9yKTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIHJldHVybiBwcmlvcml0eTtcclxuICAgIH07XHJcbiAgICBcclxuICAgIERlcGVuZGVuY3lXb3JrZXJzVGFza0ludGVybmFscy5wcm90b3R5cGUubmV3RGF0YSA9IGZ1bmN0aW9uKGRhdGEpIHtcclxuICAgICAgICB0aGlzLmhhc1Byb2Nlc3NlZERhdGEgPSB0cnVlO1xyXG4gICAgICAgIHRoaXMubGFzdFByb2Nlc3NlZERhdGEgPSBkYXRhO1xyXG4gICAgICAgIFxyXG5cdFx0dGhpcy5fcGVuZGluZ0RlbGF5ZWROZXdEYXRhID0gdHJ1ZTtcclxuXHRcdGlmICghdGhpcy5fcGVuZGluZ0RlbGF5ZWRBY3Rpb24pIHtcclxuXHRcdFx0dGhpcy5fcGVuZGluZ0RlbGF5ZWRBY3Rpb24gPSB0cnVlO1xyXG5cdFx0XHRzZXRUaW1lb3V0KHRoaXMuX3BlcmZvcm1QZW5kaW5nRGVsYXllZEFjdGlvbnNCb3VuZCk7XHJcblx0XHR9XHJcbiAgICB9O1xyXG4gICAgXHJcblx0RGVwZW5kZW5jeVdvcmtlcnNUYXNrSW50ZXJuYWxzLnByb3RvdHlwZS5kYXRhUmVhZHkgPSBmdW5jdGlvbiBkYXRhUmVhZHkobmV3RGF0YVRvUHJvY2Vzcywgd29ya2VyVHlwZSkge1xyXG5cdFx0aWYgKHRoaXMuaXNUZXJtaW5hdGVkKSB7XHJcblx0XHRcdHRocm93ICdBc3luY1Byb3h5LkRlcGVuZGVuY3lXb3JrZXJzOiBhbHJlYWR5IHRlcm1pbmF0ZWQnO1xyXG5cdFx0fSBlbHNlIGlmICh0aGlzLndhaXRpbmdGb3JXb3JrZXJSZXN1bHQpIHtcclxuXHRcdFx0Ly8gVXNlZCBpbiBEZXBlbmRlbmN5V29ya2Vycy5fc3RhcnRXb3JrZXIoKSB3aGVuIHByZXZpb3VzIHdvcmtlciBoYXMgZmluaXNoZWRcclxuXHRcdFx0dGhpcy5wZW5kaW5nRGF0YUZvcldvcmtlciA9IG5ld0RhdGFUb1Byb2Nlc3M7XHJcblx0XHRcdHRoaXMuaXNQZW5kaW5nRGF0YUZvcldvcmtlciA9IHRydWU7XHJcblx0XHRcdHRoaXMucGVuZGluZ1dvcmtlclR5cGUgPSB3b3JrZXJUeXBlO1xyXG5cdFx0fSBlbHNlIHtcclxuXHRcdFx0dGhpcy5fcGFyZW50RGVwZW5kZW5jeVdvcmtlcnMuX2RhdGFSZWFkeShcclxuXHRcdFx0XHR0aGlzLCBuZXdEYXRhVG9Qcm9jZXNzLCB3b3JrZXJUeXBlKTtcclxuXHRcdH1cclxuXHR9O1xyXG5cclxuICAgIERlcGVuZGVuY3lXb3JrZXJzVGFza0ludGVybmFscy5wcm90b3R5cGUudGVybWluYXRlID0gZnVuY3Rpb24gdGVybWluYXRlKCkge1xyXG4gICAgICAgIGlmICh0aGlzLmlzVGVybWluYXRlZCkge1xyXG4gICAgICAgICAgICB0aHJvdyAnQXN5bmNQcm94eS5EZXBlbmRlbmN5V29ya2VyczogYWxyZWFkeSB0ZXJtaW5hdGVkJztcclxuICAgICAgICB9XHJcblx0XHRcclxuICAgICAgICB0aGlzLmlzVGVybWluYXRlZCA9IHRydWU7XHJcblx0XHRpZiAodGhpcy53YWl0aW5nRm9yV29ya2VyUmVzdWx0KSB7XHJcbiAgICAgICAgICAgIHRoaXMuX2lzQWN0dWFsVGVybWluYXRpb25QZW5kaW5nID0gdHJ1ZTtcclxuICAgICAgICB9IGVsc2Uge1xyXG5cdFx0XHR0aGlzLmVuZGVkKCk7XHJcblx0XHR9XHJcbiAgICB9O1xyXG5cdFxyXG5cdERlcGVuZGVuY3lXb3JrZXJzVGFza0ludGVybmFscy5wcm90b3R5cGUucmVnaXN0ZXJEZXBlbmRQcmlvcml0eUNhbGN1bGF0b3IgPSBmdW5jdGlvbiByZWdpc3RlckRlcGVuZFByaW9yaXR5Q2FsY3VsYXRvcigpIHtcclxuXHRcdGlmICh0aGlzLl9pc1JlZ2lzdGVyZWREZXBlbmRQcmlvcml0eUNhbGN1bGF0b3IpIHtcclxuXHRcdFx0dGhyb3cgJ0FzeW5jUHJveHkuRGVwZW5kZW5jeVdvcmtlcnM6IGFscmVhZHkgcmVnaXN0ZXJlZCBkZXBlbmQgcHJpb3JpdHkgY2FsY3VsYXRvcic7XHJcblx0XHR9XHJcblx0XHRpZiAodGhpcy5fcHJpb3JpdHlDYWxjdWxhdG9yID09PSBudWxsKSB7XHJcblx0XHRcdHRoaXMuX3ByaW9yaXR5Q2FsY3VsYXRvciA9IHRoaXMuY2FsY3VsYXRlUHJpb3JpdHkuYmluZCh0aGlzKTtcclxuXHRcdH1cclxuXHRcdHRoaXMuX2lzUmVnaXN0ZXJlZERlcGVuZFByaW9yaXR5Q2FsY3VsYXRvciA9IHRydWU7XHJcblx0XHRcclxuICAgICAgICB2YXIgaXRlcmF0b3IgPSB0aGlzLl9kZXBlbmRzVGFza0NvbnRleHRzLmdldEZpcnN0SXRlcmF0b3IoKTtcclxuICAgICAgICB3aGlsZSAoaXRlcmF0b3IgIT09IG51bGwpIHtcclxuICAgICAgICAgICAgdmFyIGNvbnRleHQgPSB0aGlzLl9kZXBlbmRzVGFza0NvbnRleHRzLmdldEZyb21JdGVyYXRvcihpdGVyYXRvcikudGFza0NvbnRleHQ7XHJcbiAgICAgICAgICAgIGl0ZXJhdG9yID0gdGhpcy5fZGVwZW5kc1Rhc2tDb250ZXh0cy5nZXROZXh0SXRlcmF0b3IoaXRlcmF0b3IpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgY29udGV4dC5zZXRQcmlvcml0eUNhbGN1bGF0b3IodGhpcy5fcHJpb3JpdHlDYWxjdWxhdG9yKTtcclxuICAgICAgICB9XHJcblx0fTtcclxuXHRcclxuXHREZXBlbmRlbmN5V29ya2Vyc1Rhc2tJbnRlcm5hbHMucHJvdG90eXBlLnVucmVnaXN0ZXJEZXBlbmRQcmlvcml0eUNhbGN1bGF0b3IgPSBmdW5jdGlvbiByZWdpc3RlckRlcGVuZFByaW9yaXR5Q2FsY3VsYXRvcigpIHtcclxuXHRcdGlmICghdGhpcy5faXNSZWdpc3RlcmVkRGVwZW5kUHJpb3JpdHlDYWxjdWxhdG9yKSB7XHJcblx0XHRcdHRocm93ICdBc3luY1Byb3h5LkRlcGVuZGVuY3lXb3JrZXJzOiBub3QgcmVnaXN0ZXJlZCBkZXBlbmQgcHJpb3JpdHkgY2FsY3VsYXRvcic7XHJcblx0XHR9XHJcblx0XHR0aGlzLl9pc1JlZ2lzdGVyZWREZXBlbmRQcmlvcml0eUNhbGN1bGF0b3IgPSBmYWxzZTtcclxuXHRcdFxyXG4gICAgICAgIHZhciBpdGVyYXRvciA9IHRoaXMuX2RlcGVuZHNUYXNrQ29udGV4dHMuZ2V0Rmlyc3RJdGVyYXRvcigpO1xyXG4gICAgICAgIHdoaWxlIChpdGVyYXRvciAhPT0gbnVsbCkge1xyXG4gICAgICAgICAgICB2YXIgY29udGV4dCA9IHRoaXMuX2RlcGVuZHNUYXNrQ29udGV4dHMuZ2V0RnJvbUl0ZXJhdG9yKGl0ZXJhdG9yKS50YXNrQ29udGV4dDtcclxuICAgICAgICAgICAgaXRlcmF0b3IgPSB0aGlzLl9kZXBlbmRzVGFza0NvbnRleHRzLmdldE5leHRJdGVyYXRvcihpdGVyYXRvcik7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBjb250ZXh0LnNldFByaW9yaXR5Q2FsY3VsYXRvcihudWxsKTtcclxuICAgICAgICB9XHJcblx0fTtcclxuXHRcclxuXHRPYmplY3QuZGVmaW5lUHJvcGVydHkoRGVwZW5kZW5jeVdvcmtlcnNUYXNrSW50ZXJuYWxzLnByb3RvdHlwZSwgJ2RlcGVuZFRhc2tLZXlzJywge1xyXG5cdFx0Z2V0OiBmdW5jdGlvbiBnZXREZXBlbmRUYXNrS2V5cygpIHtcclxuXHRcdFx0cmV0dXJuIHRoaXMuX2RlcGVuZFRhc2tLZXlzO1xyXG5cdFx0fVxyXG5cdH0pO1xyXG5cdFxyXG5cdE9iamVjdC5kZWZpbmVQcm9wZXJ0eShEZXBlbmRlbmN5V29ya2Vyc1Rhc2tJbnRlcm5hbHMucHJvdG90eXBlLCAnZGVwZW5kVGFza1Jlc3VsdHMnLCB7XHJcblx0XHRnZXQ6IGZ1bmN0aW9uIGdldERlcGVuZFRhc2tSZXN1bHRzKCkge1xyXG5cdFx0XHRyZXR1cm4gdGhpcy5fZGVwZW5kVGFza1Jlc3VsdHM7XHJcblx0XHR9XHJcblx0fSk7XHJcblx0XHJcbiAgICBEZXBlbmRlbmN5V29ya2Vyc1Rhc2tJbnRlcm5hbHMucHJvdG90eXBlLnJlZ2lzdGVyVGFza0RlcGVuZGVuY3kgPSBmdW5jdGlvbihcclxuICAgICAgICAgICAgdGFza0tleSkge1xyXG4gICAgICAgIFxyXG4gICAgICAgIHZhciBzdHJLZXkgPSB0aGlzLl93b3JrZXJJbnB1dFJldHJlaXZlci5nZXRLZXlBc1N0cmluZyh0YXNrS2V5KTtcclxuICAgICAgICB2YXIgYWRkUmVzdWx0ID0gdGhpcy5fZGVwZW5kc1Rhc2tDb250ZXh0cy50cnlBZGQoc3RyS2V5LCBmdW5jdGlvbigpIHtcclxuICAgICAgICAgICAgcmV0dXJuIHsgdGFza0NvbnRleHQ6IG51bGwgfTtcclxuICAgICAgICB9KTtcclxuICAgICAgICBcclxuICAgICAgICBpZiAoIWFkZFJlc3VsdC5pc05ldykge1xyXG4gICAgICAgICAgICB0aHJvdyAnQXN5bmNQcm94eS5EZXBlbmRlbmN5V29ya2VyczogQ2Fubm90IGFkZCB0YXNrIGRlcGVuZGVuY3kgdHdpY2UnO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICB2YXIgdGhhdCA9IHRoaXM7XHJcbiAgICAgICAgdmFyIGdvdERhdGEgPSBmYWxzZTtcclxuICAgICAgICB2YXIgaXNUZXJtaW5hdGVkID0gZmFsc2U7XHJcblx0XHR2YXIgaW5kZXggPSB0aGlzLl9kZXBlbmRUYXNrS2V5cy5sZW5ndGg7XHJcblx0XHRcclxuXHRcdHRoaXMuX2RlcGVuZFRhc2tLZXlzW2luZGV4XSA9IHRhc2tLZXk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgYWRkUmVzdWx0LnZhbHVlLnRhc2tDb250ZXh0ID0gdGhpcy5fcGFyZW50RGVwZW5kZW5jeVdvcmtlcnMuc3RhcnRUYXNrKFxyXG4gICAgICAgICAgICB0YXNrS2V5LCB7XHJcbiAgICAgICAgICAgICAgICAnb25EYXRhJzogb25EZXBlbmRlbmN5VGFza0RhdGEsXHJcbiAgICAgICAgICAgICAgICAnb25UZXJtaW5hdGVkJzogb25EZXBlbmRlbmN5VGFza1Rlcm1pbmF0ZWRcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICk7XHJcbiAgICAgICAgXHJcblx0XHRpZiAoIWdvdERhdGEgJiYgYWRkUmVzdWx0LnZhbHVlLnRhc2tDb250ZXh0Lmhhc0RhdGEoKSkge1xyXG5cdFx0XHR0aGlzLl9wZW5kaW5nRGVsYXllZERlcGVuZGVuY3lEYXRhLnB1c2goe1xyXG5cdFx0XHRcdGRhdGE6IGFkZFJlc3VsdC52YWx1ZS50YXNrQ29udGV4dC5nZXRMYXN0RGF0YSgpLFxyXG5cdFx0XHRcdG9uRGVwZW5kZW5jeVRhc2tEYXRhOiBvbkRlcGVuZGVuY3lUYXNrRGF0YVxyXG5cdFx0XHR9KTtcclxuXHRcdFx0aWYgKCF0aGlzLl9wZW5kaW5nRGVsYXllZEFjdGlvbikge1xyXG5cdFx0XHRcdHRoaXMuX3BlbmRpbmdEZWxheWVkQWN0aW9uID0gdHJ1ZTtcclxuXHRcdFx0XHRzZXRUaW1lb3V0KHRoaXMuX3BlcmZvcm1QZW5kaW5nRGVsYXllZEFjdGlvbnNCb3VuZCk7XHJcblx0XHRcdH1cclxuXHRcdH1cclxuICAgICAgICBcclxuICAgICAgICBmdW5jdGlvbiBvbkRlcGVuZGVuY3lUYXNrRGF0YShkYXRhKSB7XHJcblx0XHRcdHRoYXQuX2RlcGVuZFRhc2tSZXN1bHRzW2luZGV4XSA9IGRhdGE7XHJcblx0XHRcdHRoYXQuX2hhc0RlcGVuZFRhc2tEYXRhW2luZGV4XSA9IHRydWU7XHJcblx0XHRcdHRoYXQudGFza0FwaS5fb25FdmVudCgnZGVwZW5kZW5jeVRhc2tEYXRhJywgZGF0YSwgdGFza0tleSk7XHJcbiAgICAgICAgICAgIGdvdERhdGEgPSB0cnVlO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBmdW5jdGlvbiBvbkRlcGVuZGVuY3lUYXNrVGVybWluYXRlZCgpIHtcclxuICAgICAgICAgICAgaWYgKGlzVGVybWluYXRlZCkge1xyXG4gICAgICAgICAgICAgICAgdGhyb3cgJ0FzeW5jUHJveHkuRGVwZW5kZW5jeVdvcmtlcnM6IERvdWJsZSB0ZXJtaW5hdGlvbic7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgaXNUZXJtaW5hdGVkID0gdHJ1ZTtcclxuICAgICAgICAgICAgdGhhdC5fZGVwZW5kc1Rhc2tUZXJtaW5hdGVkKCk7XHJcbiAgICAgICAgfVxyXG4gICAgfTtcclxuICAgIFxyXG4gICAgRGVwZW5kZW5jeVdvcmtlcnNUYXNrSW50ZXJuYWxzLnByb3RvdHlwZS5fZGVwZW5kc1Rhc2tUZXJtaW5hdGVkID0gZnVuY3Rpb24gZGVwZW5kc1Rhc2tUZXJtaW5hdGVkKCkge1xyXG4gICAgICAgICsrdGhpcy5fZGVwZW5kc1Rhc2tzVGVybWluYXRlZENvdW50O1xyXG5cdFx0aWYgKHRoaXMuX2RlcGVuZHNUYXNrc1Rlcm1pbmF0ZWRDb3VudCA9PT0gdGhpcy5fZGVwZW5kc1Rhc2tDb250ZXh0cy5nZXRDb3VudCgpKSB7XHJcblx0XHRcdHRoaXMudGFza0FwaS5fb25FdmVudCgnYWxsRGVwZW5kVGFza3NUZXJtaW5hdGVkJyk7XHJcblx0XHR9XHJcbiAgICAgICAgdGhpcy5zdGF0dXNVcGRhdGUoKTtcclxuICAgIH07XHJcblx0XHJcblx0RGVwZW5kZW5jeVdvcmtlcnNUYXNrSW50ZXJuYWxzLnByb3RvdHlwZS5fcGVyZm9ybVBlbmRpbmdEZWxheWVkQWN0aW9ucyA9IGZ1bmN0aW9uKCkge1xyXG5cdFx0dmFyIGl0ZXJhdG9yO1xyXG5cdFx0dmFyIGNvbnRleHQ7XHJcblx0XHR0aGlzLl9wZW5kaW5nRGVsYXllZEFjdGlvbiA9IGZhbHNlO1xyXG5cdFx0XHJcblx0XHRpZiAodGhpcy5fcGVuZGluZ0RlbGF5ZWREZXBlbmRlbmN5RGF0YS5sZW5ndGggPiAwKSB7XHJcblx0XHRcdHZhciBsb2NhbExpc3RlbmVycyA9IHRoaXMuX3BlbmRpbmdEZWxheWVkRGVwZW5kZW5jeURhdGE7XHJcblx0XHRcdHRoaXMuX3BlbmRpbmdEZWxheWVkRGVwZW5kZW5jeURhdGEgPSBbXTtcclxuXHRcdFx0XHJcblx0XHRcdGZvciAodmFyIGkgPSAwOyBpIDwgbG9jYWxMaXN0ZW5lcnMubGVuZ3RoOyArK2kpIHtcclxuXHRcdFx0XHRsb2NhbExpc3RlbmVyc1tpXS5vbkRlcGVuZGVuY3lUYXNrRGF0YShsb2NhbExpc3RlbmVyc1tpXS5kYXRhKTtcclxuXHRcdFx0fVxyXG5cdFx0fVxyXG5cdFx0XHJcblx0XHRpZiAodGhpcy5fcGVuZGluZ0RlbGF5ZWROZXdEYXRhKSB7XHJcblx0XHRcdHZhciBjb250ZXh0cyA9IHRoaXMudGFza0NvbnRleHRzO1xyXG5cdFx0XHRpdGVyYXRvciA9IGNvbnRleHRzLmdldEZpcnN0SXRlcmF0b3IoKTtcclxuXHRcdFx0d2hpbGUgKGl0ZXJhdG9yICE9PSBudWxsKSB7XHJcblx0XHRcdFx0Y29udGV4dCA9IGNvbnRleHRzLmdldEZyb21JdGVyYXRvcihpdGVyYXRvcik7XHJcblx0XHRcdFx0aXRlcmF0b3IgPSBjb250ZXh0cy5nZXROZXh0SXRlcmF0b3IoaXRlcmF0b3IpO1xyXG5cdFx0XHRcdFxyXG5cdFx0XHRcdGNvbnRleHQuX2NhbGxiYWNrcy5vbkRhdGEodGhpcy5sYXN0UHJvY2Vzc2VkRGF0YSwgdGhpcy50YXNrS2V5KTtcclxuXHRcdFx0fVxyXG5cdFx0fVxyXG5cdFx0XHJcblx0XHRpZiAodGhpcy5fcGVuZGluZ0RlbGF5ZWRFbmRlZCkge1xyXG5cdFx0XHRpdGVyYXRvciA9IHRoaXMudGFza0NvbnRleHRzLmdldEZpcnN0SXRlcmF0b3IoKTtcclxuXHRcdFx0d2hpbGUgKGl0ZXJhdG9yICE9PSBudWxsKSB7XHJcblx0XHRcdFx0Y29udGV4dCA9IHRoaXMudGFza0NvbnRleHRzLmdldEZyb21JdGVyYXRvcihpdGVyYXRvcik7XHJcblx0XHRcdFx0aXRlcmF0b3IgPSB0aGlzLnRhc2tDb250ZXh0cy5nZXROZXh0SXRlcmF0b3IoaXRlcmF0b3IpO1xyXG5cclxuXHRcdFx0XHRpZiAoY29udGV4dC5fY2FsbGJhY2tzLm9uVGVybWluYXRlZCkge1xyXG5cdFx0XHRcdFx0Y29udGV4dC5fY2FsbGJhY2tzLm9uVGVybWluYXRlZCgpO1xyXG5cdFx0XHRcdH1cclxuXHRcdFx0fVxyXG5cdFx0XHRcclxuXHRcdFx0dGhpcy50YXNrQ29udGV4dHMuY2xlYXIoKTtcclxuXHRcdH1cclxuXHR9O1xyXG5cdFxyXG4gICAgcmV0dXJuIERlcGVuZGVuY3lXb3JrZXJzVGFza0ludGVybmFscztcclxufSkoKTtcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gRGVwZW5kZW5jeVdvcmtlcnNUYXNrSW50ZXJuYWxzOyIsIid1c2Ugc3RyaWN0JztcclxuXHJcbnZhciBwcmlvcml0aXplciA9IHtcclxuXHRnZXRQcmlvcml0eTogZnVuY3Rpb24odGFzaykge1xyXG4gICAgICAgIHJldHVybiB0YXNrLmNhbGN1bGF0ZVByaW9yaXR5KCk7XHJcbiAgICB9XHJcbn07XHJcblxyXG5mdW5jdGlvbiBjcmVhdGVEdW1teVJlc291cmNlKCkge1xyXG5cdHJldHVybiB7fTtcclxufVxyXG5cclxuZnVuY3Rpb24gRGVwZW5kZW5jeVdvcmtlcnNUYXNrU2NoZWR1bGVyKGpvYnNMaW1pdCwgb3B0aW9ucykge1xyXG5cdHJlc291cmNlU2NoZWR1bGVyLlByaW9yaXR5U2NoZWR1bGVyLmNhbGwodGhpcywgY3JlYXRlRHVtbXlSZXNvdXJjZSwgam9ic0xpbWl0LCBwcmlvcml0aXplciwgb3B0aW9ucyk7XHJcbn1cclxuXHJcbkRlcGVuZGVuY3lXb3JrZXJzVGFza1NjaGVkdWxlci5wcm90b3R5cGUgPSBPYmplY3QuY3JlYXRlKHJlc291cmNlU2NoZWR1bGVyLlByaW9yaXR5U2NoZWR1bGVyLnByb3RvdHlwZSk7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IERlcGVuZGVuY3lXb3JrZXJzVGFza1NjaGVkdWxlcjsiLCIndXNlIHN0cmljdCc7XHJcblxyXG52YXIgRGVwZW5kZW5jeVdvcmtlcnNUYXNrID0gKGZ1bmN0aW9uIERlcGVuZGVuY3lXb3JrZXJzVGFza0Nsb3N1cmUoKSB7XHJcblx0ZnVuY3Rpb24gRGVwZW5kZW5jeVdvcmtlcnNUYXNrKHdyYXBwZWQsIGtleSwgcmVnaXN0ZXJXcmFwcGVkRXZlbnRzKSB7XHJcblx0XHR0aGlzLl93cmFwcGVkID0gd3JhcHBlZDtcclxuXHRcdHRoaXMuX2tleSA9IGtleTtcclxuXHRcdHRoaXMuX2V2ZW50TGlzdGVuZXJzID0ge1xyXG5cdFx0XHQnZGVwZW5kZW5jeVRhc2tEYXRhJzogW10sXHJcblx0XHRcdCdzdGF0dXNVcGRhdGVkJzogW10sXHJcblx0XHRcdCdhbGxEZXBlbmRUYXNrc1Rlcm1pbmF0ZWQnOiBbXVxyXG5cdFx0fTtcclxuXHRcdFxyXG5cdFx0aWYgKHJlZ2lzdGVyV3JhcHBlZEV2ZW50cykge1xyXG5cdFx0XHRmb3IgKHZhciBldmVudCBpbiB0aGlzLl9ldmVudExpc3RlbmVycykge1xyXG5cdFx0XHRcdHRoaXMuX3JlZ2lzdGVyV3JhcHBlZEV2ZW50KGV2ZW50KTtcclxuXHRcdFx0fVxyXG5cdFx0fVxyXG5cdH1cclxuXHRcclxuXHREZXBlbmRlbmN5V29ya2Vyc1Rhc2sucHJvdG90eXBlLmRhdGFSZWFkeSA9IGZ1bmN0aW9uIGRhdGFSZWFkeShuZXdEYXRhVG9Qcm9jZXNzLCB3b3JrZXJUeXBlKSB7XHJcblx0XHR0aGlzLl93cmFwcGVkLmRhdGFSZWFkeShuZXdEYXRhVG9Qcm9jZXNzLCB3b3JrZXJUeXBlKTtcclxuXHR9O1xyXG5cdFxyXG5cdERlcGVuZGVuY3lXb3JrZXJzVGFzay5wcm90b3R5cGUudGVybWluYXRlID0gZnVuY3Rpb24gdGVybWluYXRlKCkge1xyXG5cdFx0dGhpcy5fd3JhcHBlZC50ZXJtaW5hdGUoKTtcclxuXHR9O1xyXG5cdFxyXG5cdERlcGVuZGVuY3lXb3JrZXJzVGFzay5wcm90b3R5cGUucmVnaXN0ZXJUYXNrRGVwZW5kZW5jeSA9IGZ1bmN0aW9uIHJlZ2lzdGVyVGFza0RlcGVuZGVuY3kodGFza0tleSkge1xyXG5cdFx0cmV0dXJuIHRoaXMuX3dyYXBwZWQucmVnaXN0ZXJUYXNrRGVwZW5kZW5jeSh0YXNrS2V5KTtcclxuXHR9O1xyXG5cdFxyXG5cdERlcGVuZGVuY3lXb3JrZXJzVGFzay5wcm90b3R5cGUuY2FsY3VsYXRlUHJpb3JpdHkgPSBmdW5jdGlvbiBjYWxjdWxhdGVQcmlvcml0eSgpIHtcclxuXHRcdHJldHVybiB0aGlzLl93cmFwcGVkLmNhbGN1bGF0ZVByaW9yaXR5KCk7XHJcblx0fTtcclxuXHRcclxuXHREZXBlbmRlbmN5V29ya2Vyc1Rhc2sucHJvdG90eXBlLm9uID0gZnVuY3Rpb24gb24oZXZlbnQsIGxpc3RlbmVyKSB7XHJcblx0XHRpZiAoIXRoaXMuX2V2ZW50TGlzdGVuZXJzW2V2ZW50XSkge1xyXG5cdFx0XHR0aHJvdyAnQXN5bmNQcm94eS5EZXBlbmRlbmN5V29ya2VyczogVGFzayBoYXMgbm8gZXZlbnQgJyArIGV2ZW50O1xyXG5cdFx0fVxyXG5cdFx0dGhpcy5fZXZlbnRMaXN0ZW5lcnNbZXZlbnRdLnB1c2gobGlzdGVuZXIpO1xyXG5cdH07XHJcblx0XHJcblx0T2JqZWN0LmRlZmluZVByb3BlcnR5KERlcGVuZGVuY3lXb3JrZXJzVGFzay5wcm90b3R5cGUsICdrZXknLCB7XHJcblx0XHRnZXQ6IGZ1bmN0aW9uIGdldEtleSgpIHtcclxuXHRcdFx0cmV0dXJuIHRoaXMuX2tleTtcclxuXHRcdH1cclxuXHR9KTtcclxuXHRcclxuXHRPYmplY3QuZGVmaW5lUHJvcGVydHkoRGVwZW5kZW5jeVdvcmtlcnNUYXNrLnByb3RvdHlwZSwgJ2RlcGVuZFRhc2tLZXlzJywge1xyXG5cdFx0Z2V0OiBmdW5jdGlvbiBnZXREZXBlbmRUYXNrS2V5cygpIHtcclxuXHRcdFx0cmV0dXJuIHRoaXMuX3dyYXBwZWQuZGVwZW5kVGFza0tleXM7XHJcblx0XHR9XHJcblx0fSk7XHJcblx0XHJcblx0T2JqZWN0LmRlZmluZVByb3BlcnR5KERlcGVuZGVuY3lXb3JrZXJzVGFzay5wcm90b3R5cGUsICdkZXBlbmRUYXNrUmVzdWx0cycsIHtcclxuXHRcdGdldDogZnVuY3Rpb24gZ2V0RGVwZW5kVGFza1Jlc3VsdHMoKSB7XHJcblx0XHRcdHJldHVybiB0aGlzLl93cmFwcGVkLmRlcGVuZFRhc2tSZXN1bHRzO1xyXG5cdFx0fVxyXG5cdH0pO1xyXG5cdFxyXG5cdERlcGVuZGVuY3lXb3JrZXJzVGFzay5wcm90b3R5cGUuX29uRXZlbnQgPSBmdW5jdGlvbiBvbkV2ZW50KGV2ZW50LCBhcmcxLCBhcmcyKSB7XHJcblx0XHRpZiAoZXZlbnQgPT0gJ3N0YXR1c1VwZGF0ZWQnKSB7XHJcblx0XHRcdGFyZzEgPSB0aGlzLl9tb2RpZnlTdGF0dXMoYXJnMSk7XHJcblx0XHR9XHJcblx0XHR2YXIgbGlzdGVuZXJzID0gdGhpcy5fZXZlbnRMaXN0ZW5lcnNbZXZlbnRdO1xyXG5cdFx0Zm9yICh2YXIgaSA9IDA7IGkgPCBsaXN0ZW5lcnMubGVuZ3RoOyArK2kpIHtcclxuXHRcdFx0bGlzdGVuZXJzW2ldLmNhbGwodGhpcywgYXJnMSwgYXJnMik7XHJcblx0XHR9XHJcblx0fTtcclxuXHRcclxuXHREZXBlbmRlbmN5V29ya2Vyc1Rhc2sucHJvdG90eXBlLl9tb2RpZnlTdGF0dXMgPSBmdW5jdGlvbiBtb2RpZnlTdGF0dXMoc3RhdHVzKSB7XHJcblx0XHRyZXR1cm4gc3RhdHVzO1xyXG5cdH07XHJcblx0XHJcblx0RGVwZW5kZW5jeVdvcmtlcnNUYXNrLnByb3RvdHlwZS5fcmVnaXN0ZXJXcmFwcGVkRXZlbnQgPSBmdW5jdGlvbiByZWdpc3RlcldyYXBwZWRFdmVudChldmVudCkge1xyXG5cdFx0dmFyIHRoYXQgPSB0aGlzO1xyXG5cdFx0dGhpcy5fd3JhcHBlZC5vbihldmVudCwgZnVuY3Rpb24oYXJnMSwgYXJnMikge1xyXG5cdFx0XHR0aGF0Ll9vbkV2ZW50KGV2ZW50LCBhcmcxLCBhcmcyKTtcclxuXHRcdH0pO1xyXG5cdH07XHJcblxyXG5cdHJldHVybiBEZXBlbmRlbmN5V29ya2Vyc1Rhc2s7XHJcbn0pKCk7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IERlcGVuZGVuY3lXb3JrZXJzVGFzazsiLCIndXNlIHN0cmljdCc7XHJcblxyXG4vKiBnbG9iYWwgY29uc29sZTogZmFsc2UgKi9cclxuLyogZ2xvYmFsIFByb21pc2U6IGZhbHNlICovXHJcblxyXG52YXIgSnNCdWlsdGluSGFzaE1hcCA9IHJlcXVpcmUoJ2pzLWJ1aWx0aW4taGFzaC1tYXAnKTtcclxudmFyIERlcGVuZGVuY3lXb3JrZXJzVGFza0ludGVybmFscyA9IHJlcXVpcmUoJ2RlcGVuZGVuY3ktd29ya2Vycy10YXNrLWludGVybmFscycpO1xyXG52YXIgRGVwZW5kZW5jeVdvcmtlcnNUYXNrQ29udGV4dCA9IHJlcXVpcmUoJ2RlcGVuZGVuY3ktd29ya2Vycy10YXNrLWNvbnRleHQnKTtcclxudmFyIEFzeW5jUHJveHlNYXN0ZXIgPSByZXF1aXJlKCdhc3luYy1wcm94eS1tYXN0ZXInKTtcclxuXHJcbnZhciBEZXBlbmRlbmN5V29ya2VycyA9IChmdW5jdGlvbiBEZXBlbmRlbmN5V29ya2Vyc0Nsb3N1cmUoKSB7XHJcbiAgICBmdW5jdGlvbiBEZXBlbmRlbmN5V29ya2Vycyh3b3JrZXJJbnB1dFJldHJlaXZlcikge1xyXG4gICAgICAgIHZhciB0aGF0ID0gdGhpcztcclxuICAgICAgICB0aGF0Ll93b3JrZXJJbnB1dFJldHJlaXZlciA9IHdvcmtlcklucHV0UmV0cmVpdmVyO1xyXG4gICAgICAgIHRoYXQuX3Rhc2tJbnRlcm5hbHNzID0gbmV3IEpzQnVpbHRpbkhhc2hNYXAoKTtcclxuICAgICAgICB0aGF0Ll93b3JrZXJQb29sQnlUYXNrVHlwZSA9IFtdO1xyXG4gICAgICAgIHRoYXQuX3Rhc2tPcHRpb25zQnlUYXNrVHlwZSA9IFtdO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGlmICghd29ya2VySW5wdXRSZXRyZWl2ZXIuZ2V0V29ya2VyVHlwZU9wdGlvbnMpIHtcclxuICAgICAgICAgICAgdGhyb3cgJ0FzeW5jUHJveHkuRGVwZW5kZW5jeVdvcmtlcnM6IE5vICcgK1xyXG4gICAgICAgICAgICAgICAgJ3dvcmtlcklucHV0UmV0cmVpdmVyLmdldFdvcmtlclR5cGVPcHRpb25zKCkgbWV0aG9kJztcclxuICAgICAgICB9XHJcbiAgICAgICAgaWYgKCF3b3JrZXJJbnB1dFJldHJlaXZlci5nZXRLZXlBc1N0cmluZykge1xyXG4gICAgICAgICAgICB0aHJvdyAnQXN5bmNQcm94eS5EZXBlbmRlbmN5V29ya2VyczogTm8gJyArXHJcbiAgICAgICAgICAgICAgICAnd29ya2VySW5wdXRSZXRyZWl2ZXIuZ2V0S2V5QXNTdHJpbmcoKSBtZXRob2QnO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuICAgIFxyXG4gICAgRGVwZW5kZW5jeVdvcmtlcnMucHJvdG90eXBlLnN0YXJ0VGFzayA9IGZ1bmN0aW9uIHN0YXJ0VGFzayhcclxuICAgICAgICB0YXNrS2V5LCBjYWxsYmFja3MpIHtcclxuICAgICAgICBcclxuICAgICAgICB2YXIgZGVwZW5kZW5jeVdvcmtlcnMgPSB0aGlzO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHZhciBzdHJLZXkgPSB0aGlzLl93b3JrZXJJbnB1dFJldHJlaXZlci5nZXRLZXlBc1N0cmluZyh0YXNrS2V5KTtcclxuICAgICAgICB2YXIgYWRkUmVzdWx0ID0gdGhpcy5fdGFza0ludGVybmFsc3MudHJ5QWRkKHN0cktleSwgZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgICAgIHJldHVybiBuZXcgRGVwZW5kZW5jeVdvcmtlcnNUYXNrSW50ZXJuYWxzKCk7XHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgdmFyIHRhc2tJbnRlcm5hbHMgPSBhZGRSZXN1bHQudmFsdWU7XHJcbiAgICAgICAgdmFyIHRhc2tDb250ZXh0ID0gbmV3IERlcGVuZGVuY3lXb3JrZXJzVGFza0NvbnRleHQoXHJcbiAgICAgICAgICAgIHRhc2tJbnRlcm5hbHMsIGNhbGxiYWNrcyk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKGFkZFJlc3VsdC5pc05ldykge1xyXG4gICAgICAgICAgICB0YXNrSW50ZXJuYWxzLmluaXRpYWxpemUoXHJcbiAgICAgICAgICAgICAgICB0YXNrS2V5LFxyXG4gICAgICAgICAgICAgICAgdGhpcyxcclxuICAgICAgICAgICAgICAgIHRoaXMuX3dvcmtlcklucHV0UmV0cmVpdmVyLFxyXG4gICAgICAgICAgICAgICAgdGhpcy5fdGFza0ludGVybmFsc3MsXHJcbiAgICAgICAgICAgICAgICBhZGRSZXN1bHQuaXRlcmF0b3IsXHJcbiAgICAgICAgICAgICAgICB0aGlzLl93b3JrZXJJbnB1dFJldHJlaXZlcik7XHJcblx0XHRcdFx0XHJcbiAgICAgICAgICAgIHRoaXMuX3dvcmtlcklucHV0UmV0cmVpdmVyLnRhc2tTdGFydGVkKHRhc2tJbnRlcm5hbHMudGFza0FwaSk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG5cclxuICAgICAgICByZXR1cm4gdGFza0NvbnRleHQ7XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBEZXBlbmRlbmN5V29ya2Vycy5wcm90b3R5cGUuc3RhcnRUYXNrUHJvbWlzZSA9XHJcbiAgICAgICAgICAgIGZ1bmN0aW9uIHN0YXJ0VGFza1Byb21pc2UodGFza0tleSkge1xyXG4gICAgICAgIFxyXG4gICAgICAgIHZhciB0aGF0ID0gdGhpcztcclxuICAgICAgICByZXR1cm4gbmV3IFByb21pc2UoZnVuY3Rpb24ocmVzb2x2ZSwgcmVqZWN0KSB7XHJcbiAgICAgICAgICAgIHZhciB0YXNrQ29udGV4dCA9IHRoYXQuc3RhcnRUYXNrKFxyXG4gICAgICAgICAgICAgICAgdGFza0tleSwgeyAnb25EYXRhJzogb25EYXRhLCAnb25UZXJtaW5hdGVkJzogb25UZXJtaW5hdGVkIH0pO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgdmFyIGhhc0RhdGEgPSB0YXNrQ29udGV4dC5oYXNEYXRhKCk7XHJcbiAgICAgICAgICAgIHZhciByZXN1bHQ7XHJcbiAgICAgICAgICAgIGlmIChoYXNEYXRhKSB7XHJcbiAgICAgICAgICAgICAgICByZXN1bHQgPSB0YXNrQ29udGV4dC5nZXRMYXN0RGF0YSgpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBmdW5jdGlvbiBvbkRhdGEoZGF0YSkge1xyXG4gICAgICAgICAgICAgICAgaGFzRGF0YSA9IHRydWU7XHJcbiAgICAgICAgICAgICAgICByZXN1bHQgPSBkYXRhO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBmdW5jdGlvbiBvblRlcm1pbmF0ZWQoKSB7XHJcbiAgICAgICAgICAgICAgICBpZiAoaGFzRGF0YSkge1xyXG4gICAgICAgICAgICAgICAgICAgIHJlc29sdmUocmVzdWx0KTtcclxuICAgICAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgICAgcmVqZWN0KCdBc3luY1Byb3h5LkRlcGVuZGVuY3lXb3JrZXJzOiBJbnRlcm5hbCAnICtcclxuICAgICAgICAgICAgICAgICAgICAgICAgJ2Vycm9yIC0gdGFzayB0ZXJtaW5hdGVkIGJ1dCBubyBkYXRhIHJldHVybmVkJyk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9KTtcclxuICAgIH07XHJcblx0XHJcblx0RGVwZW5kZW5jeVdvcmtlcnMucHJvdG90eXBlLnRlcm1pbmF0ZUluYWN0aXZlV29ya2VycyA9IGZ1bmN0aW9uKCkge1xyXG5cdFx0Zm9yICh2YXIgdGFza1R5cGUgaW4gdGhpcy5fd29ya2VyUG9vbEJ5VGFza1R5cGUpIHtcclxuXHRcdFx0dmFyIHdvcmtlclBvb2wgPSB0aGlzLl93b3JrZXJQb29sQnlUYXNrVHlwZVt0YXNrVHlwZV07XHJcblx0XHRcdGZvciAodmFyIGkgPSAwOyBpIDwgd29ya2VyUG9vbDsgKytpKSB7XHJcblx0XHRcdFx0d29ya2VyUG9vbFtpXS50ZXJtaW5hdGUoKTtcclxuXHRcdFx0XHR3b3JrZXJQb29sLmxlbmd0aCA9IDA7XHJcblx0XHRcdH1cclxuXHRcdH1cclxuXHR9O1xyXG4gICAgXHJcbiAgICBEZXBlbmRlbmN5V29ya2Vycy5wcm90b3R5cGUuX2RhdGFSZWFkeSA9IGZ1bmN0aW9uIGRhdGFSZWFkeShcclxuXHRcdFx0dGFza0ludGVybmFscywgZGF0YVRvUHJvY2Vzcywgd29ya2VyVHlwZSkge1xyXG4gICAgICAgIFxyXG5cdFx0dmFyIHRoYXQgPSB0aGlzO1xyXG4gICAgICAgIHZhciB3b3JrZXI7XHJcbiAgICAgICAgdmFyIHdvcmtlclBvb2wgPSB0aGF0Ll93b3JrZXJQb29sQnlUYXNrVHlwZVt3b3JrZXJUeXBlXTtcclxuICAgICAgICBpZiAoIXdvcmtlclBvb2wpIHtcclxuICAgICAgICAgICAgd29ya2VyUG9vbCA9IFtdO1xyXG4gICAgICAgICAgICB0aGF0Ll93b3JrZXJQb29sQnlUYXNrVHlwZVt3b3JrZXJUeXBlXSA9IHdvcmtlclBvb2w7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGlmICh3b3JrZXJQb29sLmxlbmd0aCA+IDApIHtcclxuICAgICAgICAgICAgd29ya2VyID0gd29ya2VyUG9vbC5wb3AoKTtcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICB2YXIgd29ya2VyQXJncyA9IHRoYXQuX3dvcmtlcklucHV0UmV0cmVpdmVyLmdldFdvcmtlclR5cGVPcHRpb25zKFxyXG4gICAgICAgICAgICAgICAgd29ya2VyVHlwZSk7XHJcblxyXG5cdFx0XHRpZiAoIXdvcmtlckFyZ3MpIHtcclxuXHRcdFx0XHR0YXNrSW50ZXJuYWxzLm5ld0RhdGEoZGF0YVRvUHJvY2Vzcyk7XHJcblx0XHRcdFx0dGFza0ludGVybmFscy5zdGF0dXNVcGRhdGUoKTtcclxuXHRcdFx0XHRyZXR1cm47XHJcblx0XHRcdH1cclxuICAgICAgICAgICAgXHJcblx0XHRcdHdvcmtlciA9IG5ldyBBc3luY1Byb3h5TWFzdGVyKFxyXG4gICAgICAgICAgICAgICAgd29ya2VyQXJncy5zY3JpcHRzVG9JbXBvcnQsXHJcbiAgICAgICAgICAgICAgICB3b3JrZXJBcmdzLmN0b3JOYW1lLFxyXG4gICAgICAgICAgICAgICAgd29ya2VyQXJncy5jdG9yQXJncyk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIGlmICghdGFza0ludGVybmFscy53YWl0aW5nRm9yV29ya2VyUmVzdWx0KSB7XHJcbiAgICAgICAgICAgIHRhc2tJbnRlcm5hbHMud2FpdGluZ0ZvcldvcmtlclJlc3VsdCA9IHRydWU7XHJcbiAgICAgICAgICAgIHRhc2tJbnRlcm5hbHMuc3RhdHVzVXBkYXRlKCk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHdvcmtlci5jYWxsRnVuY3Rpb24oXHJcbiAgICAgICAgICAgICAgICAnc3RhcnQnLFxyXG4gICAgICAgICAgICAgICAgW2RhdGFUb1Byb2Nlc3MsIHRhc2tJbnRlcm5hbHMudGFza0tleV0sXHJcbiAgICAgICAgICAgICAgICB7J2lzUmV0dXJuUHJvbWlzZSc6IHRydWV9KVxyXG4gICAgICAgICAgICAudGhlbihmdW5jdGlvbihwcm9jZXNzZWREYXRhKSB7XHJcbiAgICAgICAgICAgICAgICB0YXNrSW50ZXJuYWxzLm5ld0RhdGEocHJvY2Vzc2VkRGF0YSk7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gcHJvY2Vzc2VkRGF0YTtcclxuICAgICAgICAgICAgfSkuY2F0Y2goZnVuY3Rpb24oZSkge1xyXG4gICAgICAgICAgICAgICAgY29uc29sZS5sb2coJ0Vycm9yIGluIERlcGVuZGVuY3lXb3JrZXJzXFwnIHdvcmtlcjogJyArIGUpO1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuIGU7XHJcbiAgICAgICAgICAgIH0pLnRoZW4oZnVuY3Rpb24ocmVzdWx0KSB7XHJcbiAgICAgICAgICAgICAgICB3b3JrZXJQb29sLnB1c2god29ya2VyKTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgaWYgKCF0aGF0Ll9jaGVja0lmUGVuZGluZ0RhdGEodGFza0ludGVybmFscykpIHtcclxuICAgICAgICAgICAgICAgICAgICB0YXNrSW50ZXJuYWxzLndhaXRpbmdGb3JXb3JrZXJSZXN1bHQgPSBmYWxzZTtcclxuICAgICAgICAgICAgICAgICAgICB0YXNrSW50ZXJuYWxzLnN0YXR1c1VwZGF0ZSgpO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9KTtcclxuICAgIH07XHJcblx0XHJcblx0RGVwZW5kZW5jeVdvcmtlcnMucHJvdG90eXBlLl9jaGVja0lmUGVuZGluZ0RhdGEgPSBmdW5jdGlvbiBjaGVja0lmUGVuZGluZ0RhdGEodGFza0ludGVybmFscykge1xyXG5cdFx0aWYgKCF0YXNrSW50ZXJuYWxzLmlzUGVuZGluZ0RhdGFGb3JXb3JrZXIpIHtcclxuXHRcdFx0cmV0dXJuIGZhbHNlO1xyXG5cdFx0fVxyXG5cdFx0XHJcblx0XHR2YXIgZGF0YVRvUHJvY2VzcyA9IHRhc2tJbnRlcm5hbHMucGVuZGluZ0RhdGFGb3JXb3JrZXI7XHJcblx0XHR0YXNrSW50ZXJuYWxzLmlzUGVuZGluZ0RhdGFGb3JXb3JrZXIgPSBmYWxzZTtcclxuXHRcdHRhc2tJbnRlcm5hbHMucGVuZGluZ0RhdGFGb3JXb3JrZXIgPSBudWxsO1xyXG5cdFx0XHJcblx0XHR0aGlzLl9kYXRhUmVhZHkoXHJcblx0XHRcdHRhc2tJbnRlcm5hbHMsXHJcblx0XHRcdGRhdGFUb1Byb2Nlc3MsXHJcblx0XHRcdHRhc2tJbnRlcm5hbHMucGVuZGluZ1dvcmtlclR5cGUpO1xyXG5cdFx0XHJcblx0XHRyZXR1cm4gdHJ1ZTtcclxuXHR9O1xyXG4gICAgXHJcbiAgICByZXR1cm4gRGVwZW5kZW5jeVdvcmtlcnM7XHJcbn0pKCk7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IERlcGVuZGVuY3lXb3JrZXJzOyIsIid1c2Ugc3RyaWN0JztcclxuXHJcbnZhciBMaW5rZWRMaXN0ID0gcmVxdWlyZSgnbGlua2VkLWxpc3QnKTtcclxuXHJcbnZhciBIYXNoTWFwID0gKGZ1bmN0aW9uIEhhc2hNYXBDbG9zdXJlKCkge1xyXG5cclxuZnVuY3Rpb24gSGFzaE1hcChoYXNoZXIpIHtcclxuICAgIHZhciB0aGF0ID0gdGhpcztcclxuICAgIHRoYXQuX2hhc2hlciA9IGhhc2hlcjtcclxuXHR0aGF0LmNsZWFyKCk7XHJcbn1cclxuXHJcbkhhc2hNYXAucHJvdG90eXBlLmNsZWFyID0gZnVuY3Rpb24gY2xlYXIoKSB7XHJcbiAgICB0aGlzLl9saXN0QnlLZXkgPSBbXTtcclxuICAgIHRoaXMuX2xpc3RPZkxpc3RzID0gbmV3IExpbmtlZExpc3QoKTtcclxuICAgIHRoaXMuX2NvdW50ID0gMDtcclxufTtcclxuXHJcbkhhc2hNYXAucHJvdG90eXBlLmdldEZyb21LZXkgPSBmdW5jdGlvbiBnZXRGcm9tS2V5KGtleSkge1xyXG4gICAgdmFyIGhhc2hDb2RlID0gdGhpcy5faGFzaGVyWydnZXRIYXNoQ29kZSddKGtleSk7XHJcbiAgICB2YXIgaGFzaEVsZW1lbnRzID0gdGhpcy5fbGlzdEJ5S2V5W2hhc2hDb2RlXTtcclxuICAgIGlmICghaGFzaEVsZW1lbnRzKSB7XHJcbiAgICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICB9XHJcbiAgICB2YXIgbGlzdCA9IGhhc2hFbGVtZW50cy5saXN0O1xyXG4gICAgXHJcbiAgICB2YXIgaXRlcmF0b3IgPSBsaXN0LmdldEZpcnN0SXRlcmF0b3IoKTtcclxuICAgIHdoaWxlIChpdGVyYXRvciAhPT0gbnVsbCkge1xyXG4gICAgICAgIHZhciBpdGVtID0gbGlzdC5nZXRGcm9tSXRlcmF0b3IoaXRlcmF0b3IpO1xyXG4gICAgICAgIGlmICh0aGlzLl9oYXNoZXJbJ2lzRXF1YWwnXShpdGVtLmtleSwga2V5KSkge1xyXG4gICAgICAgICAgICByZXR1cm4gaXRlbS52YWx1ZTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgaXRlcmF0b3IgPSBsaXN0LmdldE5leHRJdGVyYXRvcihpdGVyYXRvcik7XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIG51bGw7XHJcbn07XHJcblxyXG5IYXNoTWFwLnByb3RvdHlwZS5nZXRGcm9tSXRlcmF0b3IgPSBmdW5jdGlvbiBnZXRGcm9tSXRlcmF0b3IoaXRlcmF0b3IpIHtcclxuICAgIHJldHVybiBpdGVyYXRvci5faGFzaEVsZW1lbnRzLmxpc3QuZ2V0RnJvbUl0ZXJhdG9yKGl0ZXJhdG9yLl9pbnRlcm5hbEl0ZXJhdG9yKS52YWx1ZTtcclxufTtcclxuXHJcbkhhc2hNYXAucHJvdG90eXBlLnRyeUFkZCA9IGZ1bmN0aW9uIHRyeUFkZChrZXksIGNyZWF0ZVZhbHVlKSB7XHJcbiAgICB2YXIgaGFzaENvZGUgPSB0aGlzLl9oYXNoZXJbJ2dldEhhc2hDb2RlJ10oa2V5KTtcclxuICAgIHZhciBoYXNoRWxlbWVudHMgPSB0aGlzLl9saXN0QnlLZXlbaGFzaENvZGVdO1xyXG4gICAgaWYgKCFoYXNoRWxlbWVudHMpIHtcclxuICAgICAgICBoYXNoRWxlbWVudHMgPSB7XHJcbiAgICAgICAgICAgIGhhc2hDb2RlOiBoYXNoQ29kZSxcclxuICAgICAgICAgICAgbGlzdDogbmV3IExpbmtlZExpc3QoKSxcclxuICAgICAgICAgICAgbGlzdE9mTGlzdHNJdGVyYXRvcjogbnVsbFxyXG4gICAgICAgIH07XHJcbiAgICAgICAgaGFzaEVsZW1lbnRzLmxpc3RPZkxpc3RzSXRlcmF0b3IgPSB0aGlzLl9saXN0T2ZMaXN0cy5hZGQoaGFzaEVsZW1lbnRzKTtcclxuICAgICAgICB0aGlzLl9saXN0QnlLZXlbaGFzaENvZGVdID0gaGFzaEVsZW1lbnRzO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICB2YXIgaXRlcmF0b3IgPSB7XHJcbiAgICAgICAgX2hhc2hFbGVtZW50czogaGFzaEVsZW1lbnRzLFxyXG4gICAgICAgIF9pbnRlcm5hbEl0ZXJhdG9yOiBudWxsXHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBpdGVyYXRvci5faW50ZXJuYWxJdGVyYXRvciA9IGhhc2hFbGVtZW50cy5saXN0LmdldEZpcnN0SXRlcmF0b3IoKTtcclxuICAgIHdoaWxlIChpdGVyYXRvci5faW50ZXJuYWxJdGVyYXRvciAhPT0gbnVsbCkge1xyXG4gICAgICAgIHZhciBpdGVtID0gaGFzaEVsZW1lbnRzLmxpc3QuZ2V0RnJvbUl0ZXJhdG9yKGl0ZXJhdG9yLl9pbnRlcm5hbEl0ZXJhdG9yKTtcclxuICAgICAgICBpZiAodGhpcy5faGFzaGVyWydpc0VxdWFsJ10oaXRlbS5rZXksIGtleSkpIHtcclxuICAgICAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgICAgICAgIGl0ZXJhdG9yOiBpdGVyYXRvcixcclxuICAgICAgICAgICAgICAgIGlzTmV3OiBmYWxzZSxcclxuICAgICAgICAgICAgICAgIHZhbHVlOiBpdGVtLnZhbHVlXHJcbiAgICAgICAgICAgIH07XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIGl0ZXJhdG9yLl9pbnRlcm5hbEl0ZXJhdG9yID0gaGFzaEVsZW1lbnRzLmxpc3QuZ2V0TmV4dEl0ZXJhdG9yKGl0ZXJhdG9yLl9pbnRlcm5hbEl0ZXJhdG9yKTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgdmFyIHZhbHVlID0gY3JlYXRlVmFsdWUoKTtcclxuICAgIGl0ZXJhdG9yLl9pbnRlcm5hbEl0ZXJhdG9yID0gaGFzaEVsZW1lbnRzLmxpc3QuYWRkKHtcclxuICAgICAgICBrZXk6IGtleSxcclxuICAgICAgICB2YWx1ZTogdmFsdWVcclxuICAgIH0pO1xyXG4gICAgKyt0aGlzLl9jb3VudDtcclxuICAgIFxyXG4gICAgcmV0dXJuIHtcclxuICAgICAgICBpdGVyYXRvcjogaXRlcmF0b3IsXHJcbiAgICAgICAgaXNOZXc6IHRydWUsXHJcbiAgICAgICAgdmFsdWU6IHZhbHVlXHJcbiAgICB9O1xyXG59O1xyXG5cclxuSGFzaE1hcC5wcm90b3R5cGUucmVtb3ZlID0gZnVuY3Rpb24gcmVtb3ZlKGl0ZXJhdG9yKSB7XHJcbiAgICB2YXIgb2xkTGlzdENvdW50ID0gaXRlcmF0b3IuX2hhc2hFbGVtZW50cy5saXN0LmdldENvdW50KCk7XHJcbiAgICBpdGVyYXRvci5faGFzaEVsZW1lbnRzLmxpc3QucmVtb3ZlKGl0ZXJhdG9yLl9pbnRlcm5hbEl0ZXJhdG9yKTtcclxuICAgIHZhciBuZXdMaXN0Q291bnQgPSBpdGVyYXRvci5faGFzaEVsZW1lbnRzLmxpc3QuZ2V0Q291bnQoKTtcclxuICAgIFxyXG4gICAgdGhpcy5fY291bnQgKz0gKG5ld0xpc3RDb3VudCAtIG9sZExpc3RDb3VudCk7XHJcbiAgICBpZiAobmV3TGlzdENvdW50ID09PSAwKSB7XHJcbiAgICAgICAgdGhpcy5fbGlzdE9mTGlzdHMucmVtb3ZlKGl0ZXJhdG9yLl9oYXNoRWxlbWVudHMubGlzdE9mTGlzdHNJdGVyYXRvcik7XHJcbiAgICAgICAgZGVsZXRlIHRoaXMuX2xpc3RCeUtleVtpdGVyYXRvci5faGFzaEVsZW1lbnRzLmhhc2hDb2RlXTtcclxuICAgIH1cclxufTtcclxuXHJcbkhhc2hNYXAucHJvdG90eXBlLmdldENvdW50ID0gZnVuY3Rpb24gZ2V0Q291bnQoKSB7XHJcbiAgICByZXR1cm4gdGhpcy5fY291bnQ7XHJcbn07XHJcblxyXG5IYXNoTWFwLnByb3RvdHlwZS5nZXRGaXJzdEl0ZXJhdG9yID0gZnVuY3Rpb24gZ2V0Rmlyc3RJdGVyYXRvcigpIHtcclxuICAgIHZhciBmaXJzdExpc3RJdGVyYXRvciA9IHRoaXMuX2xpc3RPZkxpc3RzLmdldEZpcnN0SXRlcmF0b3IoKTtcclxuICAgIHZhciBmaXJzdEhhc2hFbGVtZW50cyA9IG51bGw7XHJcbiAgICB2YXIgZmlyc3RJbnRlcm5hbEl0ZXJhdG9yID0gbnVsbDtcclxuICAgIGlmIChmaXJzdExpc3RJdGVyYXRvciAhPT0gbnVsbCkge1xyXG4gICAgICAgIGZpcnN0SGFzaEVsZW1lbnRzID0gdGhpcy5fbGlzdE9mTGlzdHMuZ2V0RnJvbUl0ZXJhdG9yKGZpcnN0TGlzdEl0ZXJhdG9yKTtcclxuICAgICAgICBmaXJzdEludGVybmFsSXRlcmF0b3IgPSBmaXJzdEhhc2hFbGVtZW50cy5saXN0LmdldEZpcnN0SXRlcmF0b3IoKTtcclxuICAgIH1cclxuICAgIGlmIChmaXJzdEludGVybmFsSXRlcmF0b3IgPT09IG51bGwpIHtcclxuICAgICAgICByZXR1cm4gbnVsbDtcclxuICAgIH1cclxuICAgIFxyXG4gICAgcmV0dXJuIHtcclxuICAgICAgICBfaGFzaEVsZW1lbnRzOiBmaXJzdEhhc2hFbGVtZW50cyxcclxuICAgICAgICBfaW50ZXJuYWxJdGVyYXRvcjogZmlyc3RJbnRlcm5hbEl0ZXJhdG9yXHJcbiAgICB9O1xyXG59O1xyXG5cclxuSGFzaE1hcC5wcm90b3R5cGUuZ2V0TmV4dEl0ZXJhdG9yID0gZnVuY3Rpb24gZ2V0TmV4dEl0ZXJhdG9yKGl0ZXJhdG9yKSB7XHJcbiAgICB2YXIgbmV4dEl0ZXJhdG9yID0ge1xyXG4gICAgICAgIF9oYXNoRWxlbWVudHM6IGl0ZXJhdG9yLl9oYXNoRWxlbWVudHMsXHJcbiAgICAgICAgX2ludGVybmFsSXRlcmF0b3I6IGl0ZXJhdG9yLl9oYXNoRWxlbWVudHMubGlzdC5nZXROZXh0SXRlcmF0b3IoXHJcbiAgICAgICAgICAgIGl0ZXJhdG9yLl9pbnRlcm5hbEl0ZXJhdG9yKVxyXG4gICAgfTtcclxuICAgIFxyXG4gICAgd2hpbGUgKG5leHRJdGVyYXRvci5faW50ZXJuYWxJdGVyYXRvciA9PT0gbnVsbCkge1xyXG4gICAgICAgIHZhciBuZXh0TGlzdE9mTGlzdHNJdGVyYXRvciA9IHRoaXMuX2xpc3RPZkxpc3RzLmdldE5leHRJdGVyYXRvcihcclxuICAgICAgICAgICAgaXRlcmF0b3IuX2hhc2hFbGVtZW50cy5saXN0T2ZMaXN0c0l0ZXJhdG9yKTtcclxuICAgICAgICBpZiAobmV4dExpc3RPZkxpc3RzSXRlcmF0b3IgPT09IG51bGwpIHtcclxuICAgICAgICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIG5leHRJdGVyYXRvci5faGFzaEVsZW1lbnRzID0gdGhpcy5fbGlzdE9mTGlzdHMuZ2V0RnJvbUl0ZXJhdG9yKFxyXG4gICAgICAgICAgICBuZXh0TGlzdE9mTGlzdHNJdGVyYXRvcik7XHJcbiAgICAgICAgbmV4dEl0ZXJhdG9yLl9pbnRlcm5hbEl0ZXJhdG9yID1cclxuICAgICAgICAgICAgbmV4dEl0ZXJhdG9yLl9oYXNoRWxlbWVudHMubGlzdC5nZXRGaXJzdEl0ZXJhdG9yKCk7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gbmV4dEl0ZXJhdG9yO1xyXG59O1xyXG5cclxucmV0dXJuIEhhc2hNYXA7XHJcbn0pKCk7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IEhhc2hNYXA7IiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxudmFyIEhhc2hNYXAgPSByZXF1aXJlKCdoYXNoLW1hcCcpO1xyXG5cclxudmFyIEpzQnVpbHRpbkhhc2hNYXAgPSAoZnVuY3Rpb24gSGFzaE1hcENsb3N1cmUoKSB7XHJcbiAgICBcclxuLy8gVGhpcyBjbGFzcyBleHBvc2Ugc2FtZSBBUEkgYXMgSGFzaE1hcCBidXQgbm90IHJlcXVpcmluZyBnZXRIYXNoQ29kZSgpIGFuZCBpc0VxdWFsKCkgZnVuY3Rpb25zLlxyXG4vLyBUaGF0IHdheSBpdCdzIGVhc3kgdG8gc3dpdGNoIGJldHdlZW4gaW1wbGVtZW50YXRpb25zLlxyXG5cclxudmFyIHNpbXBsZUhhc2hlciA9IHtcclxuICAgICdnZXRIYXNoQ29kZSc6IGZ1bmN0aW9uIGdldEhhc2hDb2RlKGtleSkge1xyXG4gICAgICAgIHJldHVybiBrZXk7XHJcbiAgICB9LFxyXG4gICAgXHJcbiAgICAnaXNFcXVhbCc6IGZ1bmN0aW9uIGlzRXF1YWwoa2V5MSwga2V5Mikge1xyXG4gICAgICAgIHJldHVybiBrZXkxID09PSBrZXkyO1xyXG4gICAgfVxyXG59O1xyXG5cclxuZnVuY3Rpb24gSnNCdWlsdGluSGFzaE1hcCgpIHtcclxuICAgIEhhc2hNYXAuY2FsbCh0aGlzLCAvKmhhc2hlcj0qL3NpbXBsZUhhc2hlcik7XHJcbn1cclxuXHJcbkpzQnVpbHRpbkhhc2hNYXAucHJvdG90eXBlID0gT2JqZWN0LmNyZWF0ZShIYXNoTWFwLnByb3RvdHlwZSk7XHJcblxyXG5yZXR1cm4gSnNCdWlsdGluSGFzaE1hcDtcclxufSkoKTtcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gSnNCdWlsdGluSGFzaE1hcDsiLCIndXNlIHN0cmljdCc7XHJcblxyXG52YXIgTGlua2VkTGlzdCA9IChmdW5jdGlvbiBMaW5rZWRMaXN0Q2xvc3VyZSgpIHtcclxuXHJcbmZ1bmN0aW9uIExpbmtlZExpc3QoKSB7XHJcbiAgICB0aGlzLmNsZWFyKCk7XHJcbn1cclxuXHJcbkxpbmtlZExpc3QucHJvdG90eXBlLmNsZWFyID0gZnVuY3Rpb24gY2xlYXIoKSB7XHJcbiAgICB0aGlzLl9maXJzdCA9IHsgX3ByZXY6IG51bGwsIF9wYXJlbnQ6IHRoaXMgfTtcclxuICAgIHRoaXMuX2xhc3QgPSB7IF9uZXh0OiBudWxsLCBfcGFyZW50OiB0aGlzIH07XHJcbiAgICB0aGlzLl9jb3VudCA9IDA7XHJcbiAgICBcclxuICAgIHRoaXMuX2xhc3QuX3ByZXYgPSB0aGlzLl9maXJzdDtcclxuICAgIHRoaXMuX2ZpcnN0Ll9uZXh0ID0gdGhpcy5fbGFzdDtcclxufTtcclxuXHJcbkxpbmtlZExpc3QucHJvdG90eXBlLmFkZCA9IGZ1bmN0aW9uIGFkZCh2YWx1ZSwgYWRkQmVmb3JlKSB7XHJcbiAgICBpZiAoYWRkQmVmb3JlID09PSBudWxsIHx8IGFkZEJlZm9yZSA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgYWRkQmVmb3JlID0gdGhpcy5fbGFzdDtcclxuICAgIH1cclxuICAgIFxyXG4gICAgdGhpcy5fdmFsaWRhdGVJdGVyYXRvck9mVGhpcyhhZGRCZWZvcmUpO1xyXG4gICAgXHJcbiAgICArK3RoaXMuX2NvdW50O1xyXG4gICAgXHJcbiAgICB2YXIgbmV3Tm9kZSA9IHtcclxuICAgICAgICBfdmFsdWU6IHZhbHVlLFxyXG4gICAgICAgIF9uZXh0OiBhZGRCZWZvcmUsXHJcbiAgICAgICAgX3ByZXY6IGFkZEJlZm9yZS5fcHJldixcclxuICAgICAgICBfcGFyZW50OiB0aGlzXHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBuZXdOb2RlLl9wcmV2Ll9uZXh0ID0gbmV3Tm9kZTtcclxuICAgIGFkZEJlZm9yZS5fcHJldiA9IG5ld05vZGU7XHJcbiAgICBcclxuICAgIHJldHVybiBuZXdOb2RlO1xyXG59O1xyXG5cclxuTGlua2VkTGlzdC5wcm90b3R5cGUucmVtb3ZlID0gZnVuY3Rpb24gcmVtb3ZlKGl0ZXJhdG9yKSB7XHJcbiAgICB0aGlzLl92YWxpZGF0ZUl0ZXJhdG9yT2ZUaGlzKGl0ZXJhdG9yKTtcclxuICAgIFxyXG4gICAgLS10aGlzLl9jb3VudDtcclxuICAgIFxyXG4gICAgaXRlcmF0b3IuX3ByZXYuX25leHQgPSBpdGVyYXRvci5fbmV4dDtcclxuICAgIGl0ZXJhdG9yLl9uZXh0Ll9wcmV2ID0gaXRlcmF0b3IuX3ByZXY7XHJcbiAgICBpdGVyYXRvci5fcGFyZW50ID0gbnVsbDtcclxufTtcclxuXHJcbkxpbmtlZExpc3QucHJvdG90eXBlLmdldEZyb21JdGVyYXRvciA9IGZ1bmN0aW9uIGdldEZyb21JdGVyYXRvcihpdGVyYXRvcikge1xyXG4gICAgdGhpcy5fdmFsaWRhdGVJdGVyYXRvck9mVGhpcyhpdGVyYXRvcik7XHJcbiAgICBcclxuICAgIHJldHVybiBpdGVyYXRvci5fdmFsdWU7XHJcbn07XHJcblxyXG5MaW5rZWRMaXN0LnByb3RvdHlwZS5nZXRGaXJzdEl0ZXJhdG9yID0gZnVuY3Rpb24gZ2V0Rmlyc3RJdGVyYXRvcigpIHtcclxuICAgIHZhciBpdGVyYXRvciA9IHRoaXMuZ2V0TmV4dEl0ZXJhdG9yKHRoaXMuX2ZpcnN0KTtcclxuICAgIHJldHVybiBpdGVyYXRvcjtcclxufTtcclxuXHJcbkxpbmtlZExpc3QucHJvdG90eXBlLmdldExhc3RJdGVyYXRvciA9IGZ1bmN0aW9uIGdldEZpcnN0SXRlcmF0b3IoKSB7XHJcbiAgICB2YXIgaXRlcmF0b3IgPSB0aGlzLmdldFByZXZJdGVyYXRvcih0aGlzLl9sYXN0KTtcclxuICAgIHJldHVybiBpdGVyYXRvcjtcclxufTtcclxuXHJcbkxpbmtlZExpc3QucHJvdG90eXBlLmdldE5leHRJdGVyYXRvciA9IGZ1bmN0aW9uIGdldE5leHRJdGVyYXRvcihpdGVyYXRvcikge1xyXG4gICAgdGhpcy5fdmFsaWRhdGVJdGVyYXRvck9mVGhpcyhpdGVyYXRvcik7XHJcblxyXG4gICAgaWYgKGl0ZXJhdG9yLl9uZXh0ID09PSB0aGlzLl9sYXN0KSB7XHJcbiAgICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHJldHVybiBpdGVyYXRvci5fbmV4dDtcclxufTtcclxuXHJcbkxpbmtlZExpc3QucHJvdG90eXBlLmdldFByZXZJdGVyYXRvciA9IGZ1bmN0aW9uIGdldFByZXZJdGVyYXRvcihpdGVyYXRvcikge1xyXG4gICAgdGhpcy5fdmFsaWRhdGVJdGVyYXRvck9mVGhpcyhpdGVyYXRvcik7XHJcblxyXG4gICAgaWYgKGl0ZXJhdG9yLl9wcmV2ID09PSB0aGlzLl9maXJzdCkge1xyXG4gICAgICAgIHJldHVybiBudWxsO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICByZXR1cm4gaXRlcmF0b3IuX3ByZXY7XHJcbn07XHJcblxyXG5MaW5rZWRMaXN0LnByb3RvdHlwZS5nZXRDb3VudCA9IGZ1bmN0aW9uIGdldENvdW50KCkge1xyXG4gICAgcmV0dXJuIHRoaXMuX2NvdW50O1xyXG59O1xyXG5cclxuTGlua2VkTGlzdC5wcm90b3R5cGUuX3ZhbGlkYXRlSXRlcmF0b3JPZlRoaXMgPVxyXG4gICAgZnVuY3Rpb24gdmFsaWRhdGVJdGVyYXRvck9mVGhpcyhpdGVyYXRvcikge1xyXG4gICAgXHJcbiAgICBpZiAoaXRlcmF0b3IuX3BhcmVudCAhPT0gdGhpcykge1xyXG4gICAgICAgIHRocm93ICdpdGVyYXRvciBtdXN0IGJlIG9mIHRoZSBjdXJyZW50IExpbmtlZExpc3QnO1xyXG4gICAgfVxyXG59O1xyXG5cclxucmV0dXJuIExpbmtlZExpc3Q7XHJcbn0pKCk7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IExpbmtlZExpc3Q7IiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxudmFyIFNjaGVkdWxlcldyYXBwZXJJbnB1dFJldHJlaXZlciA9IHJlcXVpcmUoJ3NjaGVkdWxlci13cmFwcGVyLWlucHV0LXJldHJlaXZlcicpO1xyXG52YXIgRGVwZW5kZW5jeVdvcmtlcnMgPSByZXF1aXJlKCdkZXBlbmRlbmN5LXdvcmtlcnMnKTtcclxuXHJcbnZhciBTY2hlZHVsZXJEZXBlbmRlbmN5V29ya2VycyA9IChmdW5jdGlvbiBTY2hlZHVsZXJEZXBlbmRlbmN5V29ya2Vyc0Nsb3N1cmUoKSB7XHJcbiAgICBmdW5jdGlvbiBTY2hlZHVsZXJEZXBlbmRlbmN5V29ya2VycyhzY2hlZHVsZXIsIGlucHV0UmV0cmVpdmVyKSB7XHJcbiAgICAgICAgdmFyIHdyYXBwZXJJbnB1dFJldHJlaXZlciA9IG5ldyBTY2hlZHVsZXJXcmFwcGVySW5wdXRSZXRyZWl2ZXIoc2NoZWR1bGVyLCBpbnB1dFJldHJlaXZlcik7XHJcbiAgICAgICAgRGVwZW5kZW5jeVdvcmtlcnMuY2FsbCh0aGlzLCB3cmFwcGVySW5wdXRSZXRyZWl2ZXIpO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBTY2hlZHVsZXJEZXBlbmRlbmN5V29ya2Vycy5wcm90b3R5cGUgPSBPYmplY3QuY3JlYXRlKERlcGVuZGVuY3lXb3JrZXJzLnByb3RvdHlwZSk7XHJcbiAgICBcclxuICAgIHJldHVybiBTY2hlZHVsZXJEZXBlbmRlbmN5V29ya2VycztcclxufSkoKTtcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gU2NoZWR1bGVyRGVwZW5kZW5jeVdvcmtlcnM7IiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxudmFyIERlcGVuZGVuY3lXb3JrZXJzVGFzayA9IHJlcXVpcmUoJ2RlcGVuZGVuY3ktd29ya2Vycy10YXNrJyk7XHJcblxyXG52YXIgU2NoZWR1bGVyVGFzayA9IChmdW5jdGlvbiBTY2hlZHVsZXJUYXNrQ2xvc3VyZSgpIHtcclxuICAgIGZ1bmN0aW9uIFNjaGVkdWxlclRhc2soc2NoZWR1bGVyLCBpbnB1dFJldHJlaXZlciwgaXNEaXNhYmxlV29ya2VyQ2FjaGUsIHdyYXBwZWRUYXNrKSB7XHJcbiAgICAgICAgdmFyIHRoYXQgPSB0aGlzO1xyXG5cdFx0RGVwZW5kZW5jeVdvcmtlcnNUYXNrLmNhbGwodGhpcywgd3JhcHBlZFRhc2ssIHdyYXBwZWRUYXNrLmtleSwgLypyZWdpc3RlcldyYXBwZWRFdmVudHM9Ki90cnVlKTtcclxuICAgICAgICB0aGF0Ll9zY2hlZHVsZXIgPSBzY2hlZHVsZXI7XHJcblx0XHR0aGF0Ll9pbnB1dFJldHJlaXZlciA9IGlucHV0UmV0cmVpdmVyO1xyXG5cdFx0dGhhdC5faXNEaXNhYmxlV29ya2VyQ2FjaGUgPSBpc0Rpc2FibGVXb3JrZXJDYWNoZTtcclxuXHRcdHRoYXQuX3dyYXBwZWRUYXNrID0gd3JhcHBlZFRhc2s7XHJcbiAgICAgICAgdGhhdC5fb25TY2hlZHVsZWRCb3VuZCA9IHRoYXQuX29uU2NoZWR1bGVkLmJpbmQodGhhdCk7XHJcbiAgICAgICAgXHJcblx0XHR0aGF0Ll9qb2JDYWxsYmFja3MgPSBudWxsO1xyXG4gICAgICAgIHRoYXQuX3BlbmRpbmdEYXRhVG9Qcm9jZXNzID0gbnVsbDtcclxuXHRcdHRoYXQuX3BlbmRpbmdXb3JrZXJUeXBlID0gMDtcclxuICAgICAgICB0aGF0Ll9oYXNQZW5kaW5nRGF0YVRvUHJvY2VzcyA9IGZhbHNlO1xyXG4gICAgICAgIHRoYXQuX2NhbmNlbFBlbmRpbmdEYXRhVG9Qcm9jZXNzID0gZmFsc2U7XHJcbiAgICAgICAgdGhhdC5faXNXb3JrZXJBY3RpdmUgPSBmYWxzZTtcclxuXHRcdHRoYXQuX2lzVGVybWluYXRlZCA9IGZhbHNlO1xyXG4gICAgICAgIHRoYXQuX2xhc3RTdGF0dXMgPSB7ICdpc1dhaXRpbmdGb3JXb3JrZXJSZXN1bHQnOiBmYWxzZSB9O1xyXG4gICAgfVxyXG5cdFxyXG5cdFNjaGVkdWxlclRhc2sucHJvdG90eXBlID0gT2JqZWN0LmNyZWF0ZShEZXBlbmRlbmN5V29ya2Vyc1Rhc2sucHJvdG90eXBlKTtcclxuICAgIFxyXG4gICAgU2NoZWR1bGVyVGFzay5wcm90b3R5cGUuX21vZGlmeVN0YXR1cyA9IGZ1bmN0aW9uIG1vZGlmeVN0YXR1cyhzdGF0dXMpIHtcclxuICAgICAgICB0aGlzLl9sYXN0U3RhdHVzID0gSlNPTi5wYXJzZShKU09OLnN0cmluZ2lmeShzdGF0dXMpKTtcclxuICAgICAgICB0aGlzLl9jaGVja0lmSm9iRG9uZShzdGF0dXMpO1xyXG4gICAgICAgIHRoaXMuX2xhc3RTdGF0dXMuaXNXYWl0aW5nRm9yV29ya2VyUmVzdWx0ID1cclxuICAgICAgICAgICAgc3RhdHVzLmlzV2FpdGluZ0ZvcldvcmtlclJlc3VsdCB8fCB0aGlzLl9oYXNQZW5kaW5nRGF0YVRvUHJvY2VzcztcclxuICAgICAgICBcclxuXHRcdHJldHVybiB0aGlzLl9sYXN0U3RhdHVzO1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgU2NoZWR1bGVyVGFzay5wcm90b3R5cGUuZGF0YVJlYWR5ID0gZnVuY3Rpb24gb25EYXRhUmVhZHlUb1Byb2Nlc3MoXHJcbiAgICAgICAgICAgIG5ld0RhdGFUb1Byb2Nlc3MsIHdvcmtlclR5cGUpIHtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgIGlmICh0aGlzLl9pc1Rlcm1pbmF0ZWQpIHtcclxuICAgICAgICAgICAgdGhyb3cgJ0FzeW5jUHJveHkuRGVwZW5kZW5jeVdvcmtlcnM6IERhdGEgYWZ0ZXIgdGVybWluYXRpb24nO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBpZiAodGhpcy5faXNEaXNhYmxlV29ya2VyQ2FjaGVbd29ya2VyVHlwZV0gPT09IHVuZGVmaW5lZCkge1xyXG5cdFx0XHR0aGlzLl9pc0Rpc2FibGVXb3JrZXJDYWNoZVt3b3JrZXJUeXBlXSA9IHRoaXMuX2lucHV0UmV0cmVpdmVyLmdldFdvcmtlclR5cGVPcHRpb25zKHdvcmtlclR5cGUpID09PSBudWxsO1xyXG5cdFx0fVxyXG5cdFx0aWYgKHRoaXMuX2lzRGlzYWJsZVdvcmtlckNhY2hlW3dvcmtlclR5cGVdKSB7XHJcbiAgICAgICAgICAgIHRoaXMuX3BlbmRpbmdEYXRhVG9Qcm9jZXNzID0gbnVsbDtcclxuICAgICAgICAgICAgdGhpcy5fY2FuY2VsUGVuZGluZ0RhdGFUb1Byb2Nlc3MgPVxyXG4gICAgICAgICAgICAgICAgdGhpcy5faGFzUGVuZGluZ0RhdGFUb1Byb2Nlc3MgJiYgIXRoaXMuX2lzV29ya2VyQWN0aXZlO1xyXG4gICAgICAgICAgICB0aGlzLl9oYXNQZW5kaW5nRGF0YVRvUHJvY2VzcyA9IGZhbHNlO1xyXG4gICAgICAgICAgICBEZXBlbmRlbmN5V29ya2Vyc1Rhc2sucHJvdG90eXBlLmRhdGFSZWFkeS5jYWxsKHRoaXMsIG5ld0RhdGFUb1Byb2Nlc3MsIHdvcmtlclR5cGUpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgdmFyIGlzU3RhdHVzQ2hhbmdlZCA9XHJcbiAgICAgICAgICAgICAgICB0aGlzLl9sYXN0U3RhdHVzLmlzV2FpdGluZ0ZvcldvcmtlclJlc3VsdCAmJlxyXG4gICAgICAgICAgICAgICAgIXRoaXMuX2hhc1BlbmRpbmdEYXRhVG9Qcm9jZXNzO1xyXG4gICAgICAgICAgICBpZiAoaXNTdGF0dXNDaGFuZ2VkKSB7XHJcbiAgICAgICAgICAgICAgICB0aGlzLl9sYXN0U3RhdHVzLmlzV2FpdGluZ0ZvcldvcmtlclJlc3VsdCA9IGZhbHNlO1xyXG4gICAgICAgICAgICAgICAgdGhpcy5fb25FdmVudCgnc3RhdHVzVXBkYXRlZCcsIHRoaXMuX2xhc3RTdGF0dXMpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHRoaXMuX3BlbmRpbmdEYXRhVG9Qcm9jZXNzID0gbmV3RGF0YVRvUHJvY2VzcztcclxuXHRcdHRoaXMuX3BlbmRpbmdXb3JrZXJUeXBlID0gd29ya2VyVHlwZTtcclxuICAgICAgICB0aGlzLl9jYW5jZWxQZW5kaW5nRGF0YVRvUHJvY2VzcyA9IGZhbHNlO1xyXG4gICAgICAgIHZhciBoYWRQZW5kaW5nRGF0YVRvUHJvY2VzcyA9IHRoaXMuX2hhc1BlbmRpbmdEYXRhVG9Qcm9jZXNzO1xyXG4gICAgICAgIHRoaXMuX2hhc1BlbmRpbmdEYXRhVG9Qcm9jZXNzID0gdHJ1ZTtcclxuXHJcbiAgICAgICAgaWYgKCFoYWRQZW5kaW5nRGF0YVRvUHJvY2VzcyAmJiAhdGhpcy5faXNXb3JrZXJBY3RpdmUpIHtcclxuICAgICAgICAgICAgdGhpcy5fc2NoZWR1bGVyLmVucXVldWVKb2IoXHJcbiAgICAgICAgICAgICAgICB0aGlzLl9vblNjaGVkdWxlZEJvdW5kLCB0aGlzKTtcclxuICAgICAgICB9XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBTY2hlZHVsZXJUYXNrLnByb3RvdHlwZS50ZXJtaW5hdGUgPSBmdW5jdGlvbiB0ZXJtaW5hdGUoKSB7XHJcbiAgICAgICAgaWYgKHRoaXMuX2lzVGVybWluYXRlZCkge1xyXG4gICAgICAgICAgICB0aHJvdyAnQXN5bmNQcm94eS5EZXBlbmRlbmN5V29ya2VyczogRG91YmxlIHRlcm1pbmF0aW9uJztcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgdGhpcy5faXNUZXJtaW5hdGVkID0gdHJ1ZTtcclxuICAgICAgICBpZiAoIXRoaXMuX2hhc1BlbmRpbmdEYXRhVG9Qcm9jZXNzKSB7XHJcblx0XHRcdERlcGVuZGVuY3lXb3JrZXJzVGFzay5wcm90b3R5cGUudGVybWluYXRlLmNhbGwodGhpcyk7XHJcblx0XHR9XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBTY2hlZHVsZXJUYXNrLnByb3RvdHlwZS5fb25TY2hlZHVsZWQgPSBmdW5jdGlvbiBkYXRhUmVhZHlGb3JXb3JrZXIoXHJcbiAgICAgICAgICAgIHJlc291cmNlLCBqb2JDb250ZXh0LCBqb2JDYWxsYmFja3MpIHtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgIGlmIChqb2JDb250ZXh0ICE9PSB0aGlzKSB7XHJcbiAgICAgICAgICAgIHRocm93ICdBc3luY1Byb3h5LkRlcGVuZGVuY3lXb3JrZXJzOiBVbmV4cGVjdGVkIGNvbnRleHQnO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBpZiAodGhpcy5fY2FuY2VsUGVuZGluZ0RhdGFUb1Byb2Nlc3MpIHtcclxuICAgICAgICAgICAgdGhpcy5fY2FuY2VsUGVuZGluZ0RhdGFUb1Byb2Nlc3MgPSBmYWxzZTtcclxuXHRcdFx0am9iQ2FsbGJhY2tzLmpvYkRvbmUoKTtcclxuICAgICAgICB9IGVsc2Uge1xyXG5cdFx0XHRpZiAoIXRoaXMuX2hhc1BlbmRpbmdEYXRhVG9Qcm9jZXNzKSB7XHJcblx0XHRcdFx0dGhyb3cgJ0FzeW5jUHJveHkuRGVwZW5kZW5jeVdvcmtlcnM6ICFlbnF1ZXVlZFByb2Nlc3NKb2InO1xyXG5cdFx0XHR9XHJcblx0XHRcdFxyXG5cdFx0XHR0aGlzLl9pc1dvcmtlckFjdGl2ZSA9IHRydWU7XHJcblx0XHRcdHRoaXMuX2hhc1BlbmRpbmdEYXRhVG9Qcm9jZXNzID0gZmFsc2U7XHJcblx0XHRcdHRoaXMuX2pvYkNhbGxiYWNrcyA9IGpvYkNhbGxiYWNrcztcclxuXHRcdFx0dmFyIGRhdGEgPSB0aGlzLl9wZW5kaW5nRGF0YVRvUHJvY2VzcztcclxuXHRcdFx0dGhpcy5fcGVuZGluZ0RhdGFUb1Byb2Nlc3MgPSBudWxsO1xyXG5cdFx0XHREZXBlbmRlbmN5V29ya2Vyc1Rhc2sucHJvdG90eXBlLmRhdGFSZWFkeS5jYWxsKHRoaXMsIGRhdGEsIHRoaXMuX3BlbmRpbmdXb3JrZXJUeXBlKTtcclxuXHRcdH1cclxuXHRcdFxyXG5cdFx0aWYgKHRoaXMuX2lzVGVybWluYXRlZCkge1xyXG5cdFx0XHREZXBlbmRlbmN5V29ya2Vyc1Rhc2sucHJvdG90eXBlLnRlcm1pbmF0ZS5jYWxsKHRoaXMpO1xyXG5cdFx0fVxyXG4gICAgfTtcclxuICAgIFxyXG4gICAgU2NoZWR1bGVyVGFzay5wcm90b3R5cGUuX2NoZWNrSWZKb2JEb25lID0gZnVuY3Rpb24gY2hlY2tJZkpvYkRvbmUoc3RhdHVzKSB7XHJcbiAgICAgICAgaWYgKCF0aGlzLl9pc1dvcmtlckFjdGl2ZSB8fCBzdGF0dXMuaXNXYWl0aW5nRm9yV29ya2VyUmVzdWx0KSB7XHJcbiAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKHRoaXMuX2NhbmNlbFBlbmRpbmdEYXRhVG9Qcm9jZXNzKSB7XHJcbiAgICAgICAgICAgIHRocm93ICdBc3luY1Byb3h5LkRlcGVuZGVuY3lXb3JrZXJzOiBjYW5jZWxQZW5kaW5nRGF0YVRvUHJvY2Vzcyc7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHRoaXMuX2lzV29ya2VyQWN0aXZlID0gZmFsc2U7XHJcbiAgICAgICAgXHJcblx0XHR2YXIgam9iQ2FsbGJhY2tzID0gdGhpcy5fam9iQ2FsbGJhY2tzO1xyXG5cdFx0dGhpcy5fam9iQ2FsbGJhY2tzID0gbnVsbDtcclxuXHRcdFxyXG4gICAgICAgIGlmICh0aGlzLl9oYXNQZW5kaW5nRGF0YVRvUHJvY2Vzcykge1xyXG4gICAgICAgICAgICB0aGlzLl9zY2hlZHVsZXIuZW5xdWV1ZUpvYihcclxuICAgICAgICAgICAgICAgIHRoaXMuX29uU2NoZWR1bGVkQm91bmQsIHRoaXMpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgam9iQ2FsbGJhY2tzLmpvYkRvbmUoKTtcclxuICAgIH07XHJcbiAgICBcclxuICAgIHJldHVybiBTY2hlZHVsZXJUYXNrO1xyXG59KSgpO1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBTY2hlZHVsZXJUYXNrOyIsIid1c2Ugc3RyaWN0JztcclxuXHJcbnZhciBTY2hlZHVsZXJUYXNrID0gcmVxdWlyZSgnc2NoZWR1bGVyLXRhc2snKTtcclxudmFyIFdyYXBwZXJJbnB1dFJldHJlaXZlckJhc2UgPSByZXF1aXJlKCd3cmFwcGVyLWlucHV0LXJldHJlaXZlci1iYXNlJyk7XHJcblxyXG52YXIgU2NoZWR1bGVyV3JhcHBlcklucHV0UmV0cmVpdmVyID0gKGZ1bmN0aW9uIFNjaGVkdWxlcldyYXBwZXJJbnB1dFJldHJlaXZlckNsb3N1cmUoKSB7XHJcbiAgICBmdW5jdGlvbiBTY2hlZHVsZXJXcmFwcGVySW5wdXRSZXRyZWl2ZXIoc2NoZWR1bGVyLCBpbnB1dFJldHJlaXZlcikge1xyXG4gICAgICAgIFdyYXBwZXJJbnB1dFJldHJlaXZlckJhc2UuY2FsbCh0aGlzLCBpbnB1dFJldHJlaXZlcik7XHJcbiAgICAgICAgdmFyIHRoYXQgPSB0aGlzO1xyXG4gICAgICAgIHRoYXQuX3NjaGVkdWxlciA9IHNjaGVkdWxlcjtcclxuXHRcdHRoYXQuX2lucHV0UmV0cmVpdmVyID0gaW5wdXRSZXRyZWl2ZXI7XHJcblx0XHR0aGF0Ll9pc0Rpc2FibGVXb3JrZXJDYWNoZSA9IHt9O1xyXG5cclxuICAgICAgICBpZiAoIWlucHV0UmV0cmVpdmVyLnRhc2tTdGFydGVkKSB7XHJcbiAgICAgICAgICAgIHRocm93ICdBc3luY1Byb3h5LkRlcGVuZGVuY3lXb3JrZXJzOiBObyAnICtcclxuICAgICAgICAgICAgICAgICdpbnB1dFJldHJlaXZlci50YXNrU3RhcnRlZCgpIG1ldGhvZCc7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgXHJcbiAgICBTY2hlZHVsZXJXcmFwcGVySW5wdXRSZXRyZWl2ZXIucHJvdG90eXBlID0gT2JqZWN0LmNyZWF0ZShXcmFwcGVySW5wdXRSZXRyZWl2ZXJCYXNlLnByb3RvdHlwZSk7XHJcbiAgICBcclxuICAgIFNjaGVkdWxlcldyYXBwZXJJbnB1dFJldHJlaXZlci5wcm90b3R5cGUudGFza1N0YXJ0ZWQgPVxyXG4gICAgICAgICAgICBmdW5jdGlvbiB0YXNrU3RhcnRlZCh0YXNrKSB7XHJcbiAgICAgICAgXHJcbiAgICAgICAgdmFyIHdyYXBwZXJUYXNrID0gbmV3IFNjaGVkdWxlclRhc2soXHJcblx0XHRcdHRoaXMuX3NjaGVkdWxlciwgdGhpcy5faW5wdXRSZXRyZWl2ZXIsIHRoaXMuX2lzRGlzYWJsZVdvcmtlckNhY2hlLCB0YXNrKTtcclxuICAgICAgICByZXR1cm4gdGhpcy5faW5wdXRSZXRyZWl2ZXIudGFza1N0YXJ0ZWQod3JhcHBlclRhc2spO1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgcmV0dXJuIFNjaGVkdWxlcldyYXBwZXJJbnB1dFJldHJlaXZlcjtcclxufSkoKTtcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gU2NoZWR1bGVyV3JhcHBlcklucHV0UmV0cmVpdmVyOyIsIid1c2Ugc3RyaWN0JztcclxuXHJcbnZhciBXcmFwcGVySW5wdXRSZXRyZWl2ZXJCYXNlID0gKGZ1bmN0aW9uIFdyYXBwZXJJbnB1dFJldHJlaXZlckJhc2VDbG9zdXJlKCkge1xyXG4gICAgZnVuY3Rpb24gV3JhcHBlcklucHV0UmV0cmVpdmVyQmFzZShpbnB1dFJldHJlaXZlcikge1xyXG4gICAgICAgIGlmICghaW5wdXRSZXRyZWl2ZXIuZ2V0S2V5QXNTdHJpbmcpIHtcclxuICAgICAgICAgICAgdGhyb3cgJ0FzeW5jUHJveHkuRGVwZW5kZW5jeVdvcmtlcnM6IE5vICcgK1xyXG4gICAgICAgICAgICAgICAgJ2lucHV0UmV0cmVpdmVyLmdldEtleUFzU3RyaW5nKCkgbWV0aG9kJztcclxuICAgICAgICB9XHJcbiAgICAgICAgaWYgKCFpbnB1dFJldHJlaXZlci5nZXRXb3JrZXJUeXBlT3B0aW9ucykge1xyXG4gICAgICAgICAgICB0aHJvdyAnQXN5bmNQcm94eS5EZXBlbmRlbmN5V29ya2VyczogTm8gJyArXHJcbiAgICAgICAgICAgICAgICAnaW5wdXRSZXRyZWl2ZXIuZ2V0VGFza1R5cGVPcHRpb25zKCkgbWV0aG9kJztcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIHZhciB0aGF0ID0gdGhpcztcclxuICAgICAgICB0aGF0Ll9pbnB1dFJldHJlaXZlciA9IGlucHV0UmV0cmVpdmVyO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBXcmFwcGVySW5wdXRSZXRyZWl2ZXJCYXNlLnByb3RvdHlwZS50YXNrU3RhcnRlZCA9XHJcbiAgICAgICAgICAgIGZ1bmN0aW9uIHRhc2tTdGFydGVkKHRhc2spIHtcclxuICAgICAgICBcclxuICAgICAgICB0aHJvdyAnQXN5bmNQcm94eS5XcmFwcGVySW5wdXRSZXRyZWl2ZXJCYXNlIGludGVybmFsIGVycm9yOiBOb3QgaW1wbGVtZW50ZWQgdGFza1N0YXJ0ZWQoKSc7XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBXcmFwcGVySW5wdXRSZXRyZWl2ZXJCYXNlLnByb3RvdHlwZS5nZXRLZXlBc1N0cmluZyA9IGZ1bmN0aW9uKGtleSkge1xyXG4gICAgICAgIHJldHVybiB0aGlzLl9pbnB1dFJldHJlaXZlci5nZXRLZXlBc1N0cmluZyhrZXkpO1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgXHJcbiAgICBXcmFwcGVySW5wdXRSZXRyZWl2ZXJCYXNlLnByb3RvdHlwZS5nZXRXb3JrZXJUeXBlT3B0aW9ucyA9IGZ1bmN0aW9uKHRhc2tUeXBlKSB7XHJcbiAgICAgICAgcmV0dXJuIHRoaXMuX2lucHV0UmV0cmVpdmVyLmdldFdvcmtlclR5cGVPcHRpb25zKHRhc2tUeXBlKTtcclxuICAgIH07XHJcbiAgICBcclxuICAgIHJldHVybiBXcmFwcGVySW5wdXRSZXRyZWl2ZXJCYXNlO1xyXG59KSgpO1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBXcmFwcGVySW5wdXRSZXRyZWl2ZXJCYXNlOyIsIid1c2Ugc3RyaWN0JztcclxuXHJcbnZhciBTY3JpcHRzVG9JbXBvcnRQb29sID0gKGZ1bmN0aW9uIFNjcmlwdHNUb0ltcG9ydFBvb2xDbG9zdXJlKCkge1xyXG4gICAgZnVuY3Rpb24gU2NyaXB0c1RvSW1wb3J0UG9vbCgpIHtcclxuICAgICAgICB2YXIgdGhhdCA9IHRoaXM7XHJcbiAgICAgICAgdGhhdC5fc2NyaXB0c0J5TmFtZSA9IHt9O1xyXG4gICAgICAgIHRoYXQuX3NjcmlwdHNBcnJheSA9IG51bGw7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIFNjcmlwdHNUb0ltcG9ydFBvb2wucHJvdG90eXBlLmFkZFNjcmlwdEZyb21FcnJvcldpdGhTdGFja1RyYWNlID1cclxuICAgICAgICBmdW5jdGlvbiBhZGRTY3JpcHRGb3JXb3JrZXJJbXBvcnQoZXJyb3JXaXRoU3RhY2tUcmFjZSkge1xyXG4gICAgICAgIFxyXG4gICAgICAgIHZhciBmaWxlTmFtZSA9IFNjcmlwdHNUb0ltcG9ydFBvb2wuX2dldFNjcmlwdE5hbWUoZXJyb3JXaXRoU3RhY2tUcmFjZSk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKCF0aGlzLl9zY3JpcHRzQnlOYW1lW2ZpbGVOYW1lXSkge1xyXG4gICAgICAgICAgICB0aGlzLl9zY3JpcHRzQnlOYW1lW2ZpbGVOYW1lXSA9IHRydWU7XHJcbiAgICAgICAgICAgIHRoaXMuX3NjcmlwdHNBcnJheSA9IG51bGw7XHJcbiAgICAgICAgfVxyXG4gICAgfTtcclxuICAgIFxyXG4gICAgU2NyaXB0c1RvSW1wb3J0UG9vbC5wcm90b3R5cGUuZ2V0U2NyaXB0c0ZvcldvcmtlckltcG9ydCA9XHJcbiAgICAgICAgZnVuY3Rpb24gZ2V0U2NyaXB0c0ZvcldvcmtlckltcG9ydCgpIHtcclxuICAgICAgICBcclxuICAgICAgICBpZiAodGhpcy5fc2NyaXB0c0FycmF5ID09PSBudWxsKSB7XHJcbiAgICAgICAgICAgIHRoaXMuX3NjcmlwdHNBcnJheSA9IFtdO1xyXG4gICAgICAgICAgICBmb3IgKHZhciBmaWxlTmFtZSBpbiB0aGlzLl9zY3JpcHRzQnlOYW1lKSB7XHJcbiAgICAgICAgICAgICAgICB0aGlzLl9zY3JpcHRzQXJyYXkucHVzaChmaWxlTmFtZSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgcmV0dXJuIHRoaXMuX3NjcmlwdHNBcnJheTtcclxuICAgIH07XHJcbiAgICBcclxuICAgIFNjcmlwdHNUb0ltcG9ydFBvb2wuX2dldFNjcmlwdE5hbWUgPSBmdW5jdGlvbiBnZXRTY3JpcHROYW1lKGVycm9yV2l0aFN0YWNrVHJhY2UpIHtcclxuICAgICAgICB2YXIgc3RhY2sgPSBlcnJvcldpdGhTdGFja1RyYWNlLnN0YWNrLnRyaW0oKTtcclxuICAgICAgICBcclxuICAgICAgICB2YXIgY3VycmVudFN0YWNrRnJhbWVSZWdleCA9IC9hdCAofFteIF0rIFxcKCkoW14gXSspOlxcZCs6XFxkKy87XHJcbiAgICAgICAgdmFyIHNvdXJjZSA9IGN1cnJlbnRTdGFja0ZyYW1lUmVnZXguZXhlYyhzdGFjayk7XHJcbiAgICAgICAgaWYgKHNvdXJjZSAmJiBzb3VyY2VbMl0gIT09IFwiXCIpIHtcclxuICAgICAgICAgICAgcmV0dXJuIHNvdXJjZVsyXTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIHZhciBsYXN0U3RhY2tGcmFtZVJlZ2V4ID0gbmV3IFJlZ0V4cCgvLitcXC8oLio/KTpcXGQrKDpcXGQrKSokLyk7XHJcbiAgICAgICAgc291cmNlID0gbGFzdFN0YWNrRnJhbWVSZWdleC5leGVjKHN0YWNrKTtcclxuICAgICAgICBpZiAoc291cmNlICYmIHNvdXJjZVsxXSAhPT0gXCJcIikge1xyXG4gICAgICAgICAgICByZXR1cm4gc291cmNlWzFdO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBpZiAoZXJyb3JXaXRoU3RhY2tUcmFjZS5maWxlTmFtZSAhPT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgICAgIHJldHVybiBlcnJvcldpdGhTdGFja1RyYWNlLmZpbGVOYW1lO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICB0aHJvdyAnSW1hZ2VEZWNvZGVyRnJhbWV3b3JrLmpzOiBDb3VsZCBub3QgZ2V0IGN1cnJlbnQgc2NyaXB0IFVSTCc7XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICByZXR1cm4gU2NyaXB0c1RvSW1wb3J0UG9vbDtcclxufSkoKTtcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gU2NyaXB0c1RvSW1wb3J0UG9vbDsiLCIndXNlIHN0cmljdCc7XHJcblxyXG4vKiBnbG9iYWwgc2VsZjogZmFsc2UgKi9cclxuXHJcbnZhciBTdWJXb3JrZXJFbXVsYXRpb25Gb3JDaHJvbWUgPSAoZnVuY3Rpb24gU3ViV29ya2VyRW11bGF0aW9uRm9yQ2hyb21lQ2xvc3VyZSgpIHtcclxuICAgIHZhciBzdWJXb3JrZXJJZCA9IDA7XHJcbiAgICB2YXIgc3ViV29ya2VySWRUb1N1YldvcmtlciA9IG51bGw7XHJcbiAgICBcclxuICAgIGZ1bmN0aW9uIFN1YldvcmtlckVtdWxhdGlvbkZvckNocm9tZShzY3JpcHRVcmwpIHtcclxuICAgICAgICBpZiAoc3ViV29ya2VySWRUb1N1YldvcmtlciA9PT0gbnVsbCkge1xyXG4gICAgICAgICAgICB0aHJvdyAnQXN5bmNQcm94eSBpbnRlcm5hbCBlcnJvcjogU3ViV29ya2VyRW11bGF0aW9uRm9yQ2hyb21lICcgK1xyXG4gICAgICAgICAgICAgICAgJ25vdCBpbml0aWFsaXplZCc7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHZhciB0aGF0ID0gdGhpcztcclxuICAgICAgICB0aGF0Ll9zdWJXb3JrZXJJZCA9ICsrc3ViV29ya2VySWQ7XHJcbiAgICAgICAgc3ViV29ya2VySWRUb1N1Yldvcmtlclt0aGF0Ll9zdWJXb3JrZXJJZF0gPSB0aGF0O1xyXG4gICAgICAgIFxyXG4gICAgICAgIHNlbGYucG9zdE1lc3NhZ2Uoe1xyXG4gICAgICAgICAgICB0eXBlOiAnc3ViV29ya2VyQ3RvcicsXHJcbiAgICAgICAgICAgIHN1YldvcmtlcklkOiB0aGF0Ll9zdWJXb3JrZXJJZCxcclxuICAgICAgICAgICAgc2NyaXB0VXJsOiBzY3JpcHRVcmxcclxuICAgICAgICB9KTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgU3ViV29ya2VyRW11bGF0aW9uRm9yQ2hyb21lLmluaXRpYWxpemUgPSBmdW5jdGlvbiBpbml0aWFsaXplKFxyXG4gICAgICAgIHN1YldvcmtlcklkVG9TdWJXb3JrZXJfKSB7XHJcbiAgICAgICAgXHJcbiAgICAgICAgc3ViV29ya2VySWRUb1N1YldvcmtlciA9IHN1YldvcmtlcklkVG9TdWJXb3JrZXJfO1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgU3ViV29ya2VyRW11bGF0aW9uRm9yQ2hyb21lLnByb3RvdHlwZS5wb3N0TWVzc2FnZSA9IGZ1bmN0aW9uIHBvc3RNZXNzYWdlKFxyXG4gICAgICAgIGRhdGEsIHRyYW5zZmVyYWJsZXMpIHtcclxuICAgICAgICBcclxuICAgICAgICBzZWxmLnBvc3RNZXNzYWdlKHtcclxuICAgICAgICAgICAgdHlwZTogJ3N1YldvcmtlclBvc3RNZXNzYWdlJyxcclxuICAgICAgICAgICAgc3ViV29ya2VySWQ6IHRoaXMuX3N1YldvcmtlcklkLFxyXG4gICAgICAgICAgICBkYXRhOiBkYXRhXHJcbiAgICAgICAgfSxcclxuICAgICAgICB0cmFuc2ZlcmFibGVzKTtcclxuICAgIH07XHJcbiAgICBcclxuICAgIFN1YldvcmtlckVtdWxhdGlvbkZvckNocm9tZS5wcm90b3R5cGUudGVybWluYXRlID0gZnVuY3Rpb24gdGVybWluYXRlKFxyXG4gICAgICAgIGRhdGEsIHRyYW5zZmVyYWJsZXMpIHtcclxuICAgICAgICBcclxuICAgICAgICBzZWxmLnBvc3RNZXNzYWdlKHtcclxuICAgICAgICAgICAgdHlwZTogJ3N1YldvcmtlclRlcm1pbmF0ZScsXHJcbiAgICAgICAgICAgIHN1YldvcmtlcklkOiB0aGlzLl9zdWJXb3JrZXJJZFxyXG4gICAgICAgIH0sXHJcbiAgICAgICAgdHJhbnNmZXJhYmxlcyk7XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICByZXR1cm4gU3ViV29ya2VyRW11bGF0aW9uRm9yQ2hyb21lO1xyXG59KSgpO1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBTdWJXb3JrZXJFbXVsYXRpb25Gb3JDaHJvbWU7Il19
