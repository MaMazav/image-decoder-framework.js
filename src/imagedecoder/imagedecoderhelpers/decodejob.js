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

    this._firstDecodeInput = null;
    this._pendingDecodeInput = null;
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
    
	// Implementation idea:
	// 1. We have at most one active decode per DecodeJob. Thus if already
	//    active decode is done, we put the new data in a "pendingDecodeInput"
	//    variable which will be decoded when current decode is done.
	// 2. When we have more than a single decode we need to decode only last
	//    fetched data (because it is of highest quality). Thus older pending
	//    data is overriden by last one.
	// 3. The only case that older data should be decoded is the lowest quality
	//    (which is the first fetched data arrived). This is because we want to
	//    show a primary image ASAP, and the the lowest quality is easier to
	//    than others decode.
	// The idea described below is correct for JPIP, and I guess for other
	// heavy-decoded image types. One may add options to the ImageDecoder
	// library in order to configure another behavior, and change the
	// implementation in the DecodeJob class accordingly.
	
    if (this._isFirstStage) {
        this._firstDecodeInput = {
            dataForDecode: dataForDecode
        };
    } else {
        this._pendingDecodeInput = {
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
    var decodeInput;
    if (this._firstDecodeInput !== null) {
        decodeInput = this._firstDecodeInput;
        this._firstDecodeInput = null;
    } else {
        decodeInput = this._pendingDecodeInput;
        this._pendingDecodeInput = null;
        
        this._isAlreadyScheduledNonFirstJob = false;
    }
    
    jobContext.allRelevantBytesLoaded = decodeInput.dataForDecode.allRelevantBytesLoaded;
    
    if (this._isAbortedNoTermination()) {
        --this._activeSubJobs;
        this._decodeScheduler.jobDone(decoder, jobContext);
        this._checkIfAllTerminated();
        
        return;
    }
    
    var jobSequenceId = ++this._jobSequenceId;
    
    var params = this._imagePartParams;
    var width = params.maxXExclusive - params.minX;
    var height = params.maxYExclusive - params.minY;

    decoder.decode(decodeInput.dataForDecode).then(pixelsDecodedCallbackInClosure);
        
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
        this._checkIfAllTerminated();
        return;
    }
    
    var lastFinished = this._lastFinishedJobSequenceId;
    if (lastFinished > jobSequenceId) {
        // Do not refresh pixels with lower quality than
        // what was already returned
        
        this._checkIfAllTerminated();
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
            
            imageData: decodeResult,
            
            allRelevantBytesLoaded: listenerHandle.allRelevantBytesLoaded
        };
        
        listenerHandle.callback(decodedOffsetted);
        
        iterator = this._listenersLinkedList.getNextIterator(iterator);
    }

    this._checkIfAllTerminated();
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
    
    this._checkIfAllTerminated();
};

DecodeJob.prototype._decodeAborted = function decodeAborted(jobContext) {
    this._isAborted = true;
    
    if (this._firstDecodeInput !== null) {
        this._firstDecodeInput = null;
    } else {
        this._pendingDecodeInput = null;
        this._isAlreadyScheduledNonFirstJob = false;
    }
    
    --this._activeSubJobs;
    
    this._checkIfAllTerminated();
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

DecodeJob.prototype._checkIfAllTerminated = function checkIfAllTerminated() {
    if (this._activeSubJobs < 0) {
        throw 'Inconsistent number of decode jobs';
    }
    
    if (this._activeSubJobs > 0) {
        return;
    }
    
    if (this._isAlreadyScheduledNonFirstJob) {
        throw 'Inconsistent isAlreadyScheduledNonFirstJob flag';
    }
    
    this._isTerminated = true;
    var linkedList = this._listenersLinkedList;
    this._listenersLinkedList = null;

    var iterator = linkedList.getFirstIterator();
    
    while (iterator !== null) {
        var listenerHandle = linkedList.getValue(iterator);
        listenerHandle.isAnyDecoderAborted |= this._isAborted;
        
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
};