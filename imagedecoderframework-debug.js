var BlobScriptGenerator=BlobScriptGeneratorClosure();self["asyncProxyScriptBlob"]=new BlobScriptGenerator;
function BlobScriptGeneratorClosure(){function BlobScriptGenerator(){var that=this;that._blobChunks=["'use strict';"];that._blob=null;that._blobUrl=null;that._namespaces={};that.addMember(BlobScriptGeneratorClosure,"BlobScriptGenerator");that.addStatement("var asyncProxyScriptBlob = new BlobScriptGenerator();")}BlobScriptGenerator.prototype.addMember=function addMember(closureFunction,memberName,namespace){if(this._blob)throw new Error("Cannot add member to AsyncProxyScriptBlob after blob was used");
if(memberName){if(namespace){this._namespaces[namespace]=true;this._blobChunks.push(namespace);this._blobChunks.push(".")}else this._blobChunks.push("var ");this._blobChunks.push(memberName);this._blobChunks.push(" = ")}this._blobChunks.push("(");this._blobChunks.push(closureFunction.toString());this._blobChunks.push(")();")};BlobScriptGenerator.prototype.addStatement=function addStatement(statement){if(this._blob)throw new Error("Cannot add statement to AsyncProxyScriptBlob after blob was used");
this._blobChunks.push(statement)};BlobScriptGenerator.prototype.getBlob=function getBlob(){if(!this._blob)this._blob=new Blob(this._blobChunks,{type:"application/javascript"});return this._blob};BlobScriptGenerator.prototype.getBlobUrl=function getBlobUrl(){if(!this._blobUrl)this._blobUrl=URL.createObjectURL(this.getBlob());return this._blobUrl};return BlobScriptGenerator};function SubWorkerEmulationForChromeClosure(){var subWorkerId=0;var subWorkerIdToSubWorker=null;function SubWorkerEmulationForChrome(scriptUrl){if(subWorkerIdToSubWorker===null)throw"AsyncProxy internal error: SubWorkerEmulationForChrome "+"not initialized";var that=this;that._subWorkerId=++subWorkerId;subWorkerIdToSubWorker[that._subWorkerId]=that;self.postMessage({type:"subWorkerCtor",subWorkerId:that._subWorkerId,scriptUrl:scriptUrl})}SubWorkerEmulationForChrome.initialize=function initialize(subWorkerIdToSubWorker_){subWorkerIdToSubWorker=
subWorkerIdToSubWorker_};SubWorkerEmulationForChrome.prototype.postMessage=function postMessage(data,transferables){self.postMessage({type:"subWorkerPostMessage",subWorkerId:this._subWorkerId,data:data},transferables)};SubWorkerEmulationForChrome.prototype.terminate=function terminate(data,transferables){self.postMessage({type:"subWorkerTerminate",subWorkerId:this._subWorkerId},transferables)};self["asyncProxyScriptBlob"].addMember(SubWorkerEmulationForChromeClosure,"SubWorkerEmulationForChrome");
return SubWorkerEmulationForChrome}var SubWorkerEmulationForChrome=SubWorkerEmulationForChromeClosure();function AsyncProxyMasterClosure(){var asyncProxyScriptBlob=self["asyncProxyScriptBlob"];var callId=0;var isGetMasterEntryUrlCalled=false;var masterEntryUrl=getBaseUrlFromEntryScript();function AsyncProxyMaster(scriptsToImport,ctorName,ctorArgs,options){var that=this;options=options||{};var slaveScriptContentString=mainSlaveScriptContent.toString();slaveScriptContentString=slaveScriptContentString.replace("SCRIPT_PLACEHOLDER",asyncProxyScriptBlob.getBlobUrl());var slaveScriptContentBlob=new Blob(["(",
slaveScriptContentString,")()"],{type:"application/javascript"});var slaveScriptUrl=URL.createObjectURL(slaveScriptContentBlob);that._callbacks=[];that._pendingPromiseCalls=[];that._subWorkerById=[];that._subWorkers=[];that._worker=new Worker(slaveScriptUrl);that._worker.onmessage=onWorkerMessageInternal;that._userDataHandler=null;that._notReturnedFunctions=0;that._functionsBufferSize=options["functionsBufferSize"]||5;that._pendingMessages=[];that._worker.postMessage({functionToCall:"ctor",scriptsToImport:scriptsToImport,
ctorName:ctorName,args:ctorArgs,callId:++callId,isPromise:false,masterEntryUrl:AsyncProxyMaster.getEntryUrl()});function onWorkerMessageInternal(workerEvent){onWorkerMessage(that,workerEvent)}}AsyncProxyMaster.prototype.setUserDataHandler=function setUserDataHandler(userDataHandler){this._userDataHandler=userDataHandler};AsyncProxyMaster.prototype.terminate=function terminate(){this._worker.terminate();for(var i=0;i<this._subWorkers.length;++i)this._subWorkers[i].terminate()};AsyncProxyMaster.prototype.callFunction=
function callFunction(functionToCall,args,options){options=options||{};var isReturnPromise=!!options["isReturnPromise"];var transferables=options["transferables"];var pathsToTransferables=options["pathsToTransferablesInPromiseResult"];var localCallId=++callId;var promiseOnMasterSide=null;var that=this;if(isReturnPromise)promiseOnMasterSide=new Promise(function promiseFunc(resolve,reject){that._pendingPromiseCalls[localCallId]={resolve:resolve,reject:reject}});var sendMessageFunction=options["isSendImmediately"]?
sendMessageToSlave:enqueueMessageToSlave;sendMessageFunction(this,transferables,true,{functionToCall:functionToCall,args:args||[],callId:localCallId,isPromise:isReturnPromise,pathsToTransferablesInPromiseResult:pathsToTransferables});if(isReturnPromise)return promiseOnMasterSide};AsyncProxyMaster.prototype.wrapCallback=function wrapCallback(callback,callbackName,options){options=options||{};var localCallId=++callId;var callbackHandle={isWorkerHelperCallback:true,isMultipleTimeCallback:!!options["isMultipleTimeCallback"],
callId:localCallId,callbackName:callbackName,pathsToTransferables:options["pathsToTransferables"]};var internalCallbackHandle={isMultipleTimeCallback:!!options["isMultipleTimeCallback"],callId:localCallId,callback:callback,pathsToTransferables:options["pathsToTransferables"]};this._callbacks[localCallId]=internalCallbackHandle;return callbackHandle};AsyncProxyMaster.prototype.freeCallback=function freeCallback(callbackHandle){delete this._callbacks[callbackHandle.callId]};AsyncProxyMaster.getEntryUrl=
function getEntryUrl(){isGetMasterEntryUrlCalled=true;return masterEntryUrl};AsyncProxyMaster._setEntryUrl=function setEntryUrl(newUrl){if(masterEntryUrl!==newUrl&&isGetMasterEntryUrlCalled)throw"Previous values returned from getMasterEntryUrl "+"is wrong. Avoid calling it within the slave c`tor";masterEntryUrl=newUrl};function mainSlaveScriptContent(){importScripts("SCRIPT_PLACEHOLDER");AsyncProxy["AsyncProxySlave"]=self["AsyncProxy"]["AsyncProxySlaveSingleton"];AsyncProxy["AsyncProxySlave"]._initializeSlave()}
function onWorkerMessage(that,workerEvent){var callId=workerEvent.data.callId;switch(workerEvent.data.type){case "functionCalled":--that._notReturnedFunctions;trySendPendingMessages(that);break;case "promiseResult":var promiseData=that._pendingPromiseCalls[callId];delete that._pendingPromiseCalls[callId];var result=workerEvent.data.result;promiseData.resolve(result);break;case "promiseFailure":var promiseData=that._pendingPromiseCalls[callId];delete that._pendingPromiseCalls[callId];var reason=workerEvent.data.reason;
promiseData.reject(reason);break;case "userData":if(that._userDataHandler!==null)that._userDataHandler(workerEvent.data.userData);break;case "callback":var callbackHandle=that._callbacks[workerEvent.data.callId];if(callbackHandle===undefined)throw"Unexpected message from SlaveWorker of callback ID: "+workerEvent.data.callId+". Maybe should indicate "+"isMultipleTimesCallback = true on creation?";if(!callbackHandle.isMultipleTimeCallback)that.freeCallback(that._callbacks[workerEvent.data.callId]);
if(callbackHandle.callback!==null)callbackHandle.callback.apply(null,workerEvent.data.args);break;case "subWorkerCtor":var subWorker=new Worker(workerEvent.data.scriptUrl);var id=workerEvent.data.subWorkerId;that._subWorkerById[id]=subWorker;that._subWorkers.push(subWorker);subWorker.onmessage=function onSubWorkerMessage(subWorkerEvent){enqueueMessageToSlave(that,subWorkerEvent.ports,false,{functionToCall:"subWorkerOnMessage",subWorkerId:id,data:subWorkerEvent.data})};break;case "subWorkerPostMessage":var subWorker=
that._subWorkerById[workerEvent.data.subWorkerId];subWorker.postMessage(workerEvent.data.data);break;case "subWorkerTerminate":var subWorker=that._subWorkerById[workerEvent.data.subWorkerId];subWorker.terminate();break;default:throw"Unknown message from AsyncProxySlave of type: "+workerEvent.data.type;}}function enqueueMessageToSlave(that,transferables,isFunctionCall,message){if(that._notReturnedFunctions>=that._functionsBufferSize){that._pendingMessages.push({transferables:transferables,isFunctionCall:isFunctionCall,
message:message});return}sendMessageToSlave(that,transferables,isFunctionCall,message)}function sendMessageToSlave(that,transferables,isFunctionCall,message){if(isFunctionCall)++that._notReturnedFunctions;that._worker.postMessage(message,transferables)}function trySendPendingMessages(that){while(that._notReturnedFunctions<that._functionsBufferSize&&that._pendingMessages.length>0){var message=that._pendingMessages.shift();sendMessageToSlave(that,message.transferables,message.isFunctionCall,message.message)}}
function getBaseUrlFromEntryScript(){var baseUrl=location.href;var endOfPath=baseUrl.lastIndexOf("/");if(endOfPath>=0)baseUrl=baseUrl.substring(0,endOfPath);return baseUrl}asyncProxyScriptBlob.addMember(AsyncProxyMasterClosure,"AsyncProxyMaster");return AsyncProxyMaster}var AsyncProxyMaster=AsyncProxyMasterClosure();function AsyncProxySlaveClosure(){var slaveHelperSingleton={};var beforeOperationListener=null;var slaveSideMainInstance;var slaveSideInstanceCreator=defaultInstanceCreator;var subWorkerIdToSubWorker={};var ctorName;slaveHelperSingleton._initializeSlave=function initializeSlave(){self.onmessage=onMessage};slaveHelperSingleton.setSlaveSideCreator=function setSlaveSideCreator(creator){slaveSideInstanceCreator=creator};slaveHelperSingleton.setBeforeOperationListener=function setBeforeOperationListener(listener){beforeOperationListener=
listener};slaveHelperSingleton.sendUserDataToMaster=function sendUserDataToMaster(userData){self.postMessage({type:"userData",userData:userData})};slaveHelperSingleton.wrapPromiseFromSlaveSide=function wrapPromiseFromSlaveSide(callId,promise,pathsToTransferables){var promiseThen=promise.then(function sendPromiseToMaster(result){var transferables=extractTransferables(pathsToTransferables,result);self.postMessage({type:"promiseResult",callId:callId,result:result},transferables)});promiseThen["catch"](function sendFailureToMaster(reason){self.postMessage({type:"promiseFailure",
callId:callId,reason:reason})})};slaveHelperSingleton.wrapCallbackFromSlaveSide=function wrapCallbackFromSlaveSide(callbackHandle){var isAlreadyCalled=false;function callbackWrapperFromSlaveSide(){if(isAlreadyCalled)throw"Callback is called twice but isMultipleTimeCallback "+"= false";var argumentsAsArray=getArgumentsAsArray(arguments);if(beforeOperationListener!==null)try{beforeOperationListener.call(slaveSideMainInstance,"callback",callbackHandle.callbackName,argumentsAsArray)}catch(e){console.log("AsyncProxySlave.beforeOperationListener has thrown an exception: "+
e)}var transferables=extractTransferables(callbackHandle.pathsToTransferables,argumentsAsArray);self.postMessage({type:"callback",callId:callbackHandle.callId,args:argumentsAsArray},transferables);if(!callbackHandle.isMultipleTimeCallback)isAlreadyCalled=true}return callbackWrapperFromSlaveSide};slaveHelperSingleton._getScriptName=function _getScriptName(){var error=new Error;var scriptName=ScriptsToImportPool._getScriptName(error);return scriptName};function extractTransferables(pathsToTransferables,
pathsBase){if(pathsToTransferables===undefined)return undefined;var transferables=new Array(pathsToTransferables.length);for(var i=0;i<pathsToTransferables.length;++i){var path=pathsToTransferables[i];var transferable=pathsBase;for(var j=0;j<path.length;++j){var member=path[j];transferable=transferable[member]}transferables[i]=transferable}return transferables}function onMessage(event){var functionNameToCall=event.data.functionToCall;var args=event.data.args;var callId=event.data.callId;var isPromise=
event.data.isPromise;var pathsToTransferablesInPromiseResult=event.data.pathsToTransferablesInPromiseResult;var result=null;switch(functionNameToCall){case "ctor":self["AsyncProxy"]["AsyncProxyMaster"]._setEntryUrl(event.data.masterEntryUrl);var scriptsToImport=event.data.scriptsToImport;ctorName=event.data.ctorName;for(var i=0;i<scriptsToImport.length;++i)importScripts(scriptsToImport[i]);slaveSideMainInstance=slaveSideInstanceCreator.apply(null,args);return;case "subWorkerOnMessage":var subWorker=
subWorkerIdToSubWorker[event.data.subWorkerId];var workerEvent={data:event.data.data};subWorker.onmessage(workerEvent);return}args=new Array(event.data.args.length);for(var i=0;i<event.data.args.length;++i){var arg=event.data.args[i];if(arg!==undefined&&arg!==null&&arg.isWorkerHelperCallback)arg=slaveHelperSingleton.wrapCallbackFromSlaveSide(arg);args[i]=arg}var functionContainer=slaveSideMainInstance;var functionToCall;while(functionContainer){functionToCall=slaveSideMainInstance[functionNameToCall];
if(functionToCall)break;functionContainer=functionContainer.__proto__}if(!functionToCall)throw"AsyncProxy error: could not find function "+functionToCall;var promise=functionToCall.apply(slaveSideMainInstance,args);if(isPromise)slaveHelperSingleton.wrapPromiseFromSlaveSide(callId,promise,pathsToTransferablesInPromiseResult);self.postMessage({type:"functionCalled",callId:event.data.callId,result:result})}function defaultInstanceCreator(){var namespacesAndCtorName=ctorName.split(".");var member=self;
for(var i=0;i<namespacesAndCtorName.length;++i)member=member[namespacesAndCtorName[i]];var TypeCtor=member;var bindArgs=[null].concat(getArgumentsAsArray(arguments));var instance=new (Function.prototype.bind.apply(TypeCtor,bindArgs));return instance}function getArgumentsAsArray(args){var argumentsAsArray=new Array(args.length);for(var i=0;i<args.length;++i)argumentsAsArray[i]=args[i];return argumentsAsArray}if(self["Worker"]===undefined){var SubWorkerEmulationForChrome=self["SubWorkerEmulationForChrome"];
SubWorkerEmulationForChrome.initialize(subWorkerIdToSubWorker);self["Worker"]=SubWorkerEmulationForChrome}self["asyncProxyScriptBlob"].addMember(AsyncProxySlaveClosure,"AsyncProxySlaveSingleton");return slaveHelperSingleton}var AsyncProxySlaveSingleton=AsyncProxySlaveClosure();function ScriptsToImportPoolClosure(){function ScriptsToImportPool(){var that=this;that._scriptsByName={};that._scriptsArray=null}ScriptsToImportPool.prototype.addScriptFromErrorWithStackTrace=function addScriptForWorkerImport(errorWithStackTrace){var fileName=ScriptsToImportPool._getScriptName(errorWithStackTrace);if(!this._scriptsByName[fileName]){this._scriptsByName[fileName]=true;this._scriptsArray=null}};ScriptsToImportPool.prototype.getScriptsForWorkerImport=function getScriptsForWorkerImport(){if(this._scriptsArray===
null){this._scriptsArray=[];for(var fileName in this._scriptsByName)this._scriptsArray.push(fileName)}return this._scriptsArray};ScriptsToImportPool._getScriptName=function getScriptName(errorWithStackTrace){var stack=errorWithStackTrace.stack.trim();var currentStackFrameRegex=/at (|[^ ]+ \()([^ ]+):\d+:\d+/;var source=currentStackFrameRegex.exec(stack);if(source&&source[2]!=="")return source[2];var lastStackFrameRegex=new RegExp(/.+\/(.*?):\d+(:\d+)*$/);source=lastStackFrameRegex.exec(stack);if(source&&
source[1]!=="")return source[1];if(errorWithStackTrace.fileName!=undefined)return errorWithStackTrace.fileName;throw"ImageDecoderFramework.js: Could not get current script URL";};self["asyncProxyScriptBlob"].addMember(ScriptsToImportPoolClosure,"ScriptsToImportPool");return ScriptsToImportPool}var ScriptsToImportPool=ScriptsToImportPoolClosure();function ExportAsyncProxySymbolsClosure(){function ExportAsyncProxySymbols(SubWorkerEmulationForChrome,AsyncProxySlaveSingleton,AsyncProxyMaster,ScriptsToImportPool){self["AsyncProxy"]=self["AsyncProxy"]||{};SubWorkerEmulationForChrome.prototype["postMessage"]=SubWorkerEmulationForChrome.prototype.postMessage;SubWorkerEmulationForChrome.prototype["terminate"]=SubWorkerEmulationForChrome.prototype.terminate;AsyncProxySlaveSingleton["setSlaveSideCreator"]=AsyncProxySlaveSingleton.setSlaveSideCreator;
AsyncProxySlaveSingleton["setBeforeOperationListener"]=AsyncProxySlaveSingleton.setBeforeOperationListener;AsyncProxySlaveSingleton["sendUserDataToMaster"]=AsyncProxySlaveSingleton.sendUserDataToMaster;AsyncProxySlaveSingleton["wrapPromiseFromSlaveSide"]=AsyncProxySlaveSingleton.wrapPromiseFromSlaveSide;AsyncProxySlaveSingleton["wrapCallbackFromSlaveSide"]=AsyncProxySlaveSingleton.wrapCallbackFromSlaveSide;AsyncProxyMaster.prototype["setUserDataHandler"]=AsyncProxyMaster.prototype.setUserDataHandler;
AsyncProxyMaster.prototype["terminate"]=AsyncProxyMaster.prototype.terminate;AsyncProxyMaster.prototype["callFunction"]=AsyncProxyMaster.prototype.callFunction;AsyncProxyMaster.prototype["wrapCallback"]=AsyncProxyMaster.prototype.wrapCallback;AsyncProxyMaster.prototype["freeCallback"]=AsyncProxyMaster.prototype.freeCallback;AsyncProxyMaster["getEntryUrl"]=AsyncProxyMaster.getEntryUrl;ScriptsToImportPool.prototype["addScriptFromErrorWithStackTrace"]=ScriptsToImportPool.prototype.addScriptFromErrorWithStackTrace;
ScriptsToImportPool.prototype["getScriptsForWorkerImport"]=ScriptsToImportPool.prototype.getScriptsForWorkerImport}asyncProxyScriptBlob.addMember(ExportAsyncProxySymbolsClosure,"ExportAsyncProxySymbols");asyncProxyScriptBlob.addStatement("ExportAsyncProxySymbols(SubWorkerEmulationForChrome, AsyncProxySlaveSingleton, AsyncProxyMaster, ScriptsToImportPool);");asyncProxyScriptBlob.addStatement("self['AsyncProxy']['AsyncProxySlaveSingleton'] = AsyncProxySlaveSingleton;");asyncProxyScriptBlob.addStatement("self['AsyncProxy']['AsyncProxyMaster'] = AsyncProxyMaster;");
asyncProxyScriptBlob.addStatement("self['AsyncProxy']['ScriptsToImportPool'] = ScriptsToImportPool;");return ExportAsyncProxySymbols}ExportAsyncProxySymbolsClosure()(SubWorkerEmulationForChrome,AsyncProxySlaveSingleton,AsyncProxyMaster,ScriptsToImportPool);self["AsyncProxy"]["AsyncProxySlaveSingleton"]=AsyncProxySlaveSingleton;self["AsyncProxy"]["AsyncProxyMaster"]=AsyncProxyMaster;self["AsyncProxy"]["ScriptsToImportPool"]=ScriptsToImportPool;

var LifoScheduler=function LifoSchedulerClosure(){function LifoScheduler(createResource,jobsLimit){this._resourceCreator=createResource;this._jobsLimit=jobsLimit;this._freeResourcesCount=this._jobsLimit;this._freeResources=new Array(this._jobsLimit);this._pendingJobs=[]}LifoScheduler.prototype={enqueueJob:function enqueueJob(jobFunc,jobContext){if(this._freeResourcesCount>0){--this._freeResourcesCount;var resource=this._freeResources.pop();if(resource===undefined)resource=this._resourceCreator();
jobFunc(resource,jobContext)}else this._pendingJobs.push({jobFunc:jobFunc,jobContext:jobContext})},jobDone:function jobDone(resource){if(this._pendingJobs.length>0){var nextJob=this._pendingJobs.pop();nextJob.jobFunc(resource,nextJob.jobContext)}else{this._freeResources.push(resource);++this._freeResourcesCount}},shouldYieldOrAbort:function shouldYieldOrAbort(jobContext){return false},tryYield:function yieldResource(jobFunc,jobContext,resource){return false}};return LifoScheduler}();var LinkedList=function LinkedListClosure(){function LinkedList(){this._first={_prev:null,_parent:this};this._last={_next:null,_parent:this};this._count=0;this._last._prev=this._first;this._first._next=this._last}LinkedList.prototype.add=function add(value,addBefore){if(addBefore===null||addBefore===undefined)addBefore=this._last;this._validateIteratorOfThis(addBefore);++this._count;var newNode={_value:value,_next:addBefore,_prev:addBefore._prev,_parent:this};newNode._prev._next=newNode;addBefore._prev=
newNode;return newNode};LinkedList.prototype.remove=function remove(iterator){this._validateIteratorOfThis(iterator);--this._count;iterator._prev._next=iterator._next;iterator._next._prev=iterator._prev;iterator._parent=null};LinkedList.prototype.getValue=function getValue(iterator){this._validateIteratorOfThis(iterator);return iterator._value};LinkedList.prototype.getFirstIterator=function getFirstIterator(){var iterator=this.getNextIterator(this._first);return iterator};LinkedList.prototype.getLastIterator=
function getFirstIterator(){var iterator=this.getPrevIterator(this._last);return iterator};LinkedList.prototype.getNextIterator=function getNextIterator(iterator){this._validateIteratorOfThis(iterator);if(iterator._next===this._last)return null;return iterator._next};LinkedList.prototype.getPrevIterator=function getPrevIterator(iterator){this._validateIteratorOfThis(iterator);if(iterator._prev===this._first)return null;return iterator._prev};LinkedList.prototype.getCount=function getCount(){return this._count};
LinkedList.prototype._validateIteratorOfThis=function validateIteratorOfThis(iterator){if(iterator._parent!==this)throw"iterator must be of the current LinkedList";};return LinkedList}();var PriorityScheduler=function PrioritySchedulerClosure(){function PriorityScheduler(createResource,jobsLimit,prioritizer,options){options=options||{};this._resourceCreator=createResource;this._jobsLimit=jobsLimit;this._prioritizer=prioritizer;this._showLog=options["showLog"];this._schedulerName=options["schedulerName"];this._numNewJobs=options["numNewJobs"]||20;this._numJobsBeforeRerankOldPriorities=options["numJobsBeforeRerankOldPriorities"]||20;this._freeResourcesCount=this._jobsLimit;this._freeResources=
new Array(this._jobsLimit);this._resourcesGuaranteedForHighPriority=options["resourcesGuaranteedForHighPriority"]||0;this._highPriorityToGuaranteeResource=options["highPriorityToGuaranteeResource"]||0;this._pendingJobsCount=0;this._oldPendingJobsByPriority=[];initializeNewPendingJobsLinkedList(this);this._schedulesCounter=0}PriorityScheduler.prototype={enqueueJob:function enqueueJob(jobFunc,jobContext,jobAbortedFunc){var priority=this._prioritizer["getPriority"](jobContext);if(priority<0){jobAbortedFunc(jobContext);
return}var job={jobFunc:jobFunc,jobAbortedFunc:jobAbortedFunc,jobContext:jobContext};var minPriority=getMinimalPriorityToSchedule(self);var resource=null;if(priority>=minPriority)resource=tryGetFreeResource(this);if(resource!==null){schedule(this,job,resource);return}enqueueNewJob(this,job,priority);ensurePendingJobsCount(self)},jobDone:function jobDone(resource,jobContext){if(this._showLog){var message="";if(this._schedulerName!==undefined)message=this._schedulerName+"'s ";var priority=this._prioritizer["getPriority"](jobContext);
message+=" job done of priority "+priority;console.log(message)}resourceFreed(this,resource);ensurePendingJobsCount(self)},tryYield:function tryYield(jobContinueFunc,jobContext,jobAbortedFunc,jobYieldedFunc,resource){var priority=this._prioritizer["getPriority"](jobContext);if(priority<0){jobAbortedFunc(jobContext);resourceFreed(this,resource);return true}var higherPriorityJob=tryDequeueNewJobWithHigherPriority(this,priority);ensurePendingJobsCount(self);if(higherPriorityJob===null)return false;jobYieldedFunc(jobContext);
var job={jobFunc:jobContinueFunc,jobAbortedFunc:jobAbortedFunc,jobContext:jobContext};enqueueNewJob(this,job,priority);ensurePendingJobsCount(self);schedule(this,higherPriorityJob,resource);ensurePendingJobsCount(self);return true}};function tryDequeueNewJobWithHigherPriority(self,lowPriority){var jobToScheduleNode=null;var highestPriorityFound=lowPriority;var countedPriorities=[];var currentNode=self._newPendingJobsLinkedList.getFirstIterator();while(currentNode!==null){var nextNode=self._newPendingJobsLinkedList.getNextIterator(currentNode);
var job=self._newPendingJobsLinkedList.getValue(currentNode);var priority=self._prioritizer["getPriority"](job.jobContext);if(priority<0){extractJobFromLinkedList(self,currentNode);--self._pendingJobsCount;job.jobAbortedFunc(job.jobContext);currentNode=nextNode;continue}if(highestPriorityFound===undefined||priority>highestPriorityFound){highestPriorityFound=priority;jobToScheduleNode=currentNode}if(!self._showLog){currentNode=nextNode;continue}if(countedPriorities[priority]===undefined)countedPriorities[priority]=
1;else++countedPriorities[priority];currentNode=nextNode}var jobToSchedule=null;if(jobToScheduleNode!==null){jobToSchedule=extractJobFromLinkedList(self,jobToScheduleNode);--self._pendingJobsCount}if(self._showLog){var jobsListMessage="";var jobDequeuedMessage="";if(self._schedulerName!==undefined){jobsListMessage=self._schedulerName+"'s ";jobDequeuedMessage=self._schedulerName+"'s "}jobsListMessage+="Jobs list:";for(var i=0;i<countedPriorities.length;++i)if(countedPriorities[i]!==undefined)jobsListMessage+=
countedPriorities[i]+" jobs of priority "+i+";";console.log(jobsListMessage);if(jobToSchedule!==null){jobDequeuedMessage+=" dequeued new job of priority "+highestPriorityFound;console.log(jobDequeuedMessage)}}ensurePendingJobsCount(self);return jobToSchedule}function tryGetFreeResource(self){if(self._freeResourcesCount===0)return null;--self._freeResourcesCount;var resource=self._freeResources.pop();if(resource===undefined)resource=self._resourceCreator();ensurePendingJobsCount(self);return resource}
function enqueueNewJob(self,job,priority){++self._pendingJobsCount;var firstIterator=self._newPendingJobsLinkedList.getFirstIterator();addJobToLinkedList(self,job,firstIterator);if(self._showLog){var message="";if(self._schedulerName!==undefined)message=self._schedulerName+"'s ";message+=" enqueued job of priority "+priority;console.log(message)}if(self._newPendingJobsLinkedList.getCount()<=self._numNewJobs){ensurePendingJobsCount(self);return}var lastIterator=self._newPendingJobsLinkedList.getLastIterator();
var oldJob=extractJobFromLinkedList(self,lastIterator);enqueueOldJob(self,oldJob);ensurePendingJobsCount(self)}function enqueueOldJob(self,job){var priority=self._prioritizer["getPriority"](job.jobContext);if(priority<0){--self._pendingJobsCount;job.jobAbortedFunc(job.jobContext);return}if(self._oldPendingJobsByPriority[priority]===undefined)self._oldPendingJobsByPriority[priority]=[];self._oldPendingJobsByPriority[priority].push(job)}function rerankPriorities(self){var originalOldsArray=self._oldPendingJobsByPriority;
var originalNewsList=self._newPendingJobsLinkedList;if(originalOldsArray.length===0)return;self._oldPendingJobsByPriority=[];initializeNewPendingJobsLinkedList(self);for(var i=0;i<originalOldsArray.length;++i){if(originalOldsArray[i]===undefined)continue;for(var j=0;j<originalOldsArray[i].length;++j)enqueueOldJob(self,originalOldsArray[i][j])}var iterator=originalNewsList.getFirstIterator();while(iterator!==null){var value=originalNewsList.getValue(iterator);enqueueOldJob(self,value);iterator=originalNewsList.getNextIterator(iterator)}var message=
"";if(self._schedulerName!==undefined)message=self._schedulerName+"'s ";message+="rerank: ";for(var i=self._oldPendingJobsByPriority.length-1;i>=0;--i){var highPriorityJobs=self._oldPendingJobsByPriority[i];if(highPriorityJobs===undefined)continue;if(self._showLog)message+=highPriorityJobs.length+" jobs in priority "+i+";";while(highPriorityJobs.length>0&&self._newPendingJobsLinkedList.getCount()<self._numNewJobs){var job=highPriorityJobs.pop();addJobToLinkedList(self,job)}if(self._newPendingJobsLinkedList.getCount()>=
self._numNewJobs&&!self._showLog)break}if(self._showLog)console.log(message);ensurePendingJobsCount(self)}function resourceFreed(self,resource){++self._freeResourcesCount;var minPriority=getMinimalPriorityToSchedule(self);--self._freeResourcesCount;var job=tryDequeueNewJobWithHigherPriority(self,minPriority);if(job!==null){ensurePendingJobsCount(self);schedule(self,job,resource);ensurePendingJobsCount(self);return}var hasOldJobs=self._pendingJobsCount>self._newPendingJobsLinkedList.getCount();if(hasOldJobs){self._freeResources.push(resource);
++self._freeResourcesCount;ensurePendingJobsCount(self);return}var numPriorities=self._oldPendingJobsByPriority.length;var jobPriority;for(var priority=numPriorities-1;priority>=0;--priority){var jobs=self._oldPendingJobsByPriority[priority];if(jobs===undefined||jobs.length===0)continue;for(var i=jobs.length-1;i>=0;--i){job=jobs[i];jobPriority=self._prioritizer["getPriority"](job.jobContext);if(jobPriority>=priority){jobs.length=i;break}else if(jobPriority<0){--self._pendingJobsCount;job.jobAbortedFunc(job.jobContext)}else{if(self._oldPendingJobsByPriority[jobPriority]===
undefined)self._oldPendingJobsByPriority[jobPriority]=[];self._oldPendingJobsByPriority[jobPriority].push(job)}job=null}if(job!==null)break;jobs.length=0}if(job===null){self._freeResources.push(resource);++self._freeResourcesCount;ensurePendingJobsCount(self);return}if(self._showLog){var message="";if(self._schedulerName!==undefined)message=self._schedulerName+"'s ";message+=" dequeued old job of priority "+jobPriority;console.log(message)}--self._pendingJobsCount;ensurePendingJobsCount(self);schedule(self,
job,resource);ensurePendingJobsCount(self)}function schedule(self,job,resource){++self._schedulesCounter;if(self._schedulesCounter>=self._numJobsBeforeRerankOldPriorities){self._schedulesCounter=0;rerankPriorities(self)}if(self._showLog){var message="";if(self._schedulerName!==undefined)message=self._schedulerName+"'s ";var priority=self._prioritizer["getPriority"](job.jobContext);message+=" scheduled job of priority "+priority;console.log(message)}job.jobFunc(resource,job.jobContext)}function initializeNewPendingJobsLinkedList(self){self._newPendingJobsLinkedList=
new LinkedList}function addJobToLinkedList(self,job,addBefore){self._newPendingJobsLinkedList.add(job,addBefore);ensureNumberOfNodes(self)}function extractJobFromLinkedList(self,iterator){var value=self._newPendingJobsLinkedList.getValue(iterator);self._newPendingJobsLinkedList.remove(iterator);ensureNumberOfNodes(self);return value}function ensureNumberOfNodes(self){if(!self._showLog)return;var iterator=self._newPendingJobsLinkedList.getIterator();var expectedCount=0;while(iterator!==null){++expectedCount;
iterator=self._newPendingJobsLinkedList.getNextIterator(iterator)}if(expectedCount!==self._newPendingJobsLinkedList.getCount())throw"Unexpected count of new jobs";}function ensurePendingJobsCount(self){if(!self._showLog)return;var oldJobsCount=0;for(var i=0;i<self._oldPendingJobsByPriority.length;++i){var jobs=self._oldPendingJobsByPriority[i];if(jobs!==undefined)oldJobsCount+=jobs.length}var expectedCount=oldJobsCount+self._newPendingJobsLinkedList.getCount();if(expectedCount!==self._pendingJobsCount)throw"Unexpected count of jobs";
}function getMinimalPriorityToSchedule(self){if(self._freeResourcesCount<=self._resourcesGuaranteedForHighPriority)return self._highPriorityToGuaranteeResources;return 0}return PriorityScheduler}();self["ResourceScheduler"]={};self["ResourceScheduler"]["PriorityScheduler"]=PriorityScheduler;self["ResourceScheduler"]["LifoScheduler"]=LifoScheduler;PriorityScheduler.prototype["enqueueJob"]=PriorityScheduler.prototype.enqueueJob;PriorityScheduler.prototype["tryYield"]=PriorityScheduler.prototype.tryYield;PriorityScheduler.prototype["jobDone"]=PriorityScheduler.prototype.jobDone;LifoScheduler.prototype["enqueueJob"]=LifoScheduler.prototype.enqueueJob;LifoScheduler.prototype["tryYield"]=LifoScheduler.prototype.tryYield;
LifoScheduler.prototype["jobDone"]=LifoScheduler.prototype.jobDone;

var n=function(){function b(e,g){this.w=e;this.d=this.m=g;this.l=Array(this.m);this.v=[]}b.prototype={B:function(e,g){if(0<this.d){--this.d;var b=this.l.pop();void 0===b&&(b=this.w());e(b,g)}else this.v.push({t:e,f:g})},F:function(e){if(0<this.v.length){var b=this.v.pop();b.t(e,b.f)}else this.l.push(e),++this.d},G:function(){return!1}};return b}();var p=function(){function b(){this.p={g:null,q:this};this.n={i:null,q:this};this.h=0;this.n.g=this.p;this.p.i=this.n}b.prototype.add=function(e,b){if(null===b||void 0===b)b=this.n;this.o(b);++this.h;var l={K:e,i:b,g:b.g,q:this};l.g.i=l;return b.g=l};b.prototype.remove=function(e){this.o(e);--this.h;e.g.i=e.i;e.i.g=e.g;e.q=null};b.prototype.D=function(e){this.o(e);return e.K};b.prototype.C=function(){return this.r(this.p)};b.prototype.L=function(){return this.M(this.n)};b.prototype.r=function(e){this.o(e);
return e.i===this.n?null:e.i};b.prototype.M=function(e){this.o(e);return e.g===this.p?null:e.g};b.prototype.o=function(e){if(e.q!==this)throw"iterator must be of the current LinkedList";};return b}();var u=function(){function b(a,h,c,d){d=d||{};this.w=a;this.m=h;this.k=c;this.e=d.showLog;this.c=d.schedulerName;this.u=d.numNewJobs||20;this.J=d.numJobsBeforeRerankOldPriorities||20;this.d=this.m;this.l=Array(this.m);this.H=d.resourcesGuaranteedForHighPriority||0;this.j=0;this.b=[];this.a=new p;this.A=0}function e(a,h){for(var c=null,d=h,e=[],f=a.a.C();null!==f;){var b=a.a.r(f),m=a.a.D(f),g=a.k.getPriority(m.f);if(0>g)q(a,f),--a.j,m.s(m.f);else{if(void 0===d||g>d)d=g,c=f;a.e&&(void 0===e[g]?e[g]=
1:++e[g])}f=b}f=null;null!==c&&(f=q(a,c),--a.j);if(a.e){b=c="";void 0!==a.c&&(c=a.c+"'s ",b=a.c+"'s ");c+="Jobs list:";for(m=0;m<e.length;++m)void 0!==e[m]&&(c+=e[m]+" jobs of priority "+m+";");console.log(c);null!==f&&console.log(b+(" dequeued new job of priority "+d))}k(a);return f}function g(a,h,c){++a.j;var d=a.a.C();a.a.add(h,d);t(a);a.e&&(h="",void 0!==a.c&&(h=a.c+"'s "),console.log(h+(" enqueued job of priority "+c)));a.a.h<=a.u||(c=a.a.L(),c=q(a,c),l(a,c));k(a)}function l(a,h){var c=a.k.getPriority(h.f);
0>c?(--a.j,h.s(h.f)):(void 0===a.b[c]&&(a.b[c]=[]),a.b[c].push(h))}function v(a,h){++a.d;var c=a.d<=a.H?a.I:0;--a.d;c=e(a,c);if(null!==c)k(a),r(a,c,h);else if(a.j>a.a.h)a.l.push(h),++a.d;else{for(var d,b=a.b.length-1;0<=b;--b){var f=a.b[b];if(void 0!==f&&0!==f.length){for(var g=f.length-1;0<=g;--g){c=f[g];d=a.k.getPriority(c.f);if(d>=b){f.length=g;break}else 0>d?(--a.j,c.s(c.f)):(void 0===a.b[d]&&(a.b[d]=[]),a.b[d].push(c));c=null}if(null!==c)break;f.length=0}}null===c?(a.l.push(h),++a.d):(a.e&&(b=
"",void 0!==a.c&&(b=a.c+"'s "),console.log(b+(" dequeued old job of priority "+d))),--a.j,k(a),r(a,c,h))}k(a)}function r(a,h,c){++a.A;if(a.A>=a.J){a.A=0;var d=a.b,b=a.a;if(0!==d.length){a.b=[];a.a=new p;for(var f=0;f<d.length;++f)if(void 0!==d[f])for(var e=0;e<d[f].length;++e)l(a,d[f][e]);for(f=b.C();null!==f;)d=b.D(f),l(a,d),f=b.r(f);b="";void 0!==a.c&&(b=a.c+"'s ");b+="rerank: ";for(f=a.b.length-1;0<=f;--f)if(d=a.b[f],void 0!==d){for(a.e&&(b+=d.length+" jobs in priority "+f+";");0<d.length&&a.a.h<
a.u;){var e=d.pop(),g=a;g.a.add(e,void 0);t(g)}if(a.a.h>=a.u&&!a.e)break}a.e&&console.log(b);k(a)}}a.e&&(f="",void 0!==a.c&&(f=a.c+"'s "),a=a.k.getPriority(h.f),console.log(f+(" scheduled job of priority "+a)));h.t(c,h.f)}function q(a,b){var c=a.a.D(b);a.a.remove(b);t(a);return c}function t(a){if(a.e){for(var b=a.a.N(),c=0;null!==b;)++c,b=a.a.r(b);if(c!==a.a.h)throw"Unexpected count of new jobs";}}function k(a){if(a.e){for(var b=0,c=0;c<a.b.length;++c){var d=a.b[c];void 0!==d&&(b+=d.length)}if(b+
a.a.h!==a.j)throw"Unexpected count of jobs";}}b.prototype={B:function(a,b,c){var d=this.k.getPriority(b);0>d?c(b):(a={t:a,s:c,f:b},b=null,d>=(self.d<=self.H?self.I:0)&&(0===this.d?b=null:(--this.d,b=this.l.pop(),void 0===b&&(b=this.w()),k(this))),null!==b?r(this,a,b):(g(this,a,d),k(self)))},F:function(a,b){if(this.e){var c="";void 0!==this.c&&(c=this.c+"'s ");var d=this.k.getPriority(b);console.log(c+(" job done of priority "+d))}v(this,a);k(self)},G:function(a,b,c,d,l){var f=this.k.getPriority(b);
if(0>f)return c(b),v(this,l),!0;var q=e(this,f);k(self);if(null===q)return!1;d(b);g(this,{t:a,s:c,f:b},f);k(self);r(this,q,l);k(self);return!0}};return b}();self.ResourceScheduler={};self.ResourceScheduler.PriorityScheduler=u;self.ResourceScheduler.LifoScheduler=n;u.prototype.enqueueJob=u.prototype.B;u.prototype.tryYield=u.prototype.G;u.prototype.jobDone=u.prototype.F;n.prototype.enqueueJob=n.prototype.B;n.prototype.tryYield=n.prototype.G;n.prototype.jobDone=n.prototype.F;

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
},{"_cesiumfrustumcalculator.js":1,"canvasimageryprovider.js":3,"viewerimagedecoder.js":20}],3:[function(require,module,exports){
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
function ImageDecoderImageryProvider(imageImplementationClassName, options) {
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
        
    this._image = new WorkerProxyImageDecoder(imageImplementationClassName, {
        serverRequestPrioritizer: 'frustum',
        decodePrioritizer: 'frustum'
    });

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
    }, this._image);
    
    var level = alignedParams.imagePartParams.level;
    var levelWidth = this._image.getLevelWidth(level);
    var levelHeight = this._image.getLevelHeight(level);
    
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
        throw 'ImageDecoderImageryProvider error: opened() was called more than once!';
    }
    
    this._ready = true;
    
    // This is wrong if COD or COC exists besides main header COD
    this._numResolutionLevels = this._image.getNumResolutionLevelsForLimittedViewer();
    this._quality = this._image.getHighestQuality();
    var maximumCesiumLevel = this._numResolutionLevels - 1;
        
    this._tileWidth = this._image.getTileWidth();
    this._tileHeight = this._image.getTileHeight();
        
    var bestLevel = this._image.getImageLevel();
    var bestLevelWidth  = this._image.getLevelWidth (bestLevel);
    var bestLevelHeight = this._image.getLevelHeight(bestLevel);
    
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
},{"_cesiumfrustumcalculator.js":1,"imagehelperfunctions.js":12,"workerproxyimagedecoder.js":18}],5:[function(require,module,exports){
'use strict';

module.exports = ImageDecoder;

var WorkerProxyFetchManager = require('workerproxyfetchmanager.js');
var imageHelperFunctions = require('imageHelperFunctions.js');
var DecodeJobsPool = require('decodejobspool.js');
var WorkerProxyPixelsDecoder = require('workerproxypixelsdecoder.js');
var ImageParamsRetrieverProxy = require('imageparamsretrieverproxy.js');

/* global console: false */
/* global Promise: false */

function ImageDecoder(imageImplementationClassName, options) {
    ImageParamsRetrieverProxy.call(this, imageImplementationClassName);
    
    this._options = options || {};
    this._optionsWebWorkers = imageHelperFunctions.createInternalOptions(imageImplementationClassName, this._options);
    var decodeWorkersLimit = this._options.workersLimit || 5;
    
    this._tileWidth = this._options.tileWidth || 256;
    this._tileHeight = this._options.tileHeight || 256;
    this._showLog = !!this._options.showLog;
    
    /*if (this._showLog) {
        // Old IE
        throw 'showLog is not supported on this browser';
    }*/

    this._channelStates = [];
    this._decoders = [];

    this._fetchManager = new WorkerProxyFetchManager(this._optionsWebWorkers);
    
    var decodeScheduler = imageHelperFunctions.createScheduler(
        this._showLog,
        this._options.decodePrioritizer,
        'decode',
        this._createDecoder.bind(this),
        decodeWorkersLimit);
    
    this._decodePrioritizer = decodeScheduler.prioritizer;

    this._requestsDecodeJobsPool = new DecodeJobsPool(
        this._fetchManager,
        decodeScheduler.scheduler,
        this._tileWidth,
        this._tileHeight,
        /*onlyWaitForDataAndDecode=*/false);
        
    this._channelsDecodeJobsPool = new DecodeJobsPool(
        this._fetchManager,
        decodeScheduler.scheduler,
        this._tileWidth,
        this._tileHeight,
        /*onlyWaitForDataAndDecode=*/true);
}

ImageDecoder.prototype = Object.create(ImageParamsRetrieverProxy.prototype);

ImageDecoder.prototype.getTileWidth = function getTileWidth() {
    this._validateSizesCalculator();
    return this._tileWidth;
};

ImageDecoder.prototype.getTileHeight = function getTileHeight() {
    this._validateSizesCalculator();
    return this._tileHeight;
};
    
ImageDecoder.prototype.setServerRequestPrioritizerData =
    function setServerRequestPrioritizerData(prioritizerData) {
    
    this._fetchManager.setServerRequestPrioritizerData(
        prioritizerData);
};

ImageDecoder.prototype.setDecodePrioritizerData =
    function setDecodePrioritizerData(prioritizerData) {
    
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
    var self = this;
    return this._fetchManager.open(url).then(function (sizesParams) {
        self._internalSizesParams = sizesParams;
        return {
            sizesParams: sizesParams,
            applicativeTileWidth : self.getTileWidth(),
            applicativeTileHeight: self.getTileHeight()
        };
    });
};

ImageDecoder.prototype.close = function close() {
    for (var i = 0; i < this._decoders.length; ++i) {
        this._decoders[i].terminate();
    }

    return this._fetchManager.close();
};

ImageDecoder.prototype.createChannel = function createChannel(
    createdCallback) {
    
    this._validateSizesCalculator();
    
    var self = this;
    
    function channelCreated(channelHandle) {
        self._channelStates[channelHandle] = {
            decodeJobsListenerHandle: null
        };
        
        createdCallback(channelHandle);
    }
    
    this._fetchManager.createChannel(
        channelCreated);
};

ImageDecoder.prototype.requestPixels = function requestPixels(imagePartParams) {
    this._validateSizesCalculator();
    
    var level = imagePartParams.level;
    var levelWidth = this._sizesCalculator.getLevelWidth(level);
    var levelHeight = this._sizesCalculator.getLevelHeight(level);
    
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
            internalTerminatedCallback,
            levelWidth,
            levelHeight,
            /*isProgressive=*/false);
    }
    
    function internalCallback(decodedData) {
        copyPixelsToAccumulatedResult(decodedData, accumulatedResult);
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
    
    this._validateSizesCalculator();
    
    var level = imagePartParams.level;
    var levelWidth = this._sizesCalculator.getLevelWidth(level);
    var levelHeight = this._sizesCalculator.getLevelHeight(level);
    
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
        levelWidth,
        levelHeight,
        /*isProgressive=*/true,
        imagePartParamsNotNeeded);
        
    if (channelHandle !== undefined) {
        if (channelState.decodeJobsListenerHandle !== null) {
            // Unregister after forked new jobs, so no termination occurs meanwhile
            decodeJobsPool.unregisterForkedJobs(
                channelState.decodeJobsListenerHandle);
        }
        channelState.decodeJobsListenerHandle = listenerHandle;
        this._fetchManager.moveChannel(channelHandle, imagePartParams);
    }
};

ImageDecoder.prototype.reconnect = function reconnect() {
    this._fetchManager.reconnect();
};

ImageDecoder.prototype.alignParamsToTilesAndLevel = function alignParamsToTilesAndLevel(region) {
	return imageHelperFunctions.alignParamsToTilesAndLevel(region, this);
};

ImageDecoder.prototype._getSizesParamsInternal = function getSizesParamsInternal() {
    return this._internalSizesParams;
};

ImageDecoder.prototype._createDecoder = function createDecoder() {
    var decoder = new WorkerProxyPixelsDecoder(this._optionsWebWorkers);
    this._decoders.push(decoder);
    
    return decoder;
};

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
}
},{"decodejobspool.js":7,"imageHelperFunctions.js":12,"imageparamsretrieverproxy.js":15,"workerproxyfetchmanager.js":17,"workerproxypixelsdecoder.js":19}],6:[function(require,module,exports){
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
},{"linkedlist.js":13}],7:[function(require,module,exports){
'use strict';

module.exports = DecodeJobsPool;

var DecodeJob = require('decodejob.js');

function DecodeJobsPool(
    fetchManager,
    decodeScheduler,
    tileWidth,
    tileHeight,
    onlyWaitForDataAndDecode) {
    
    this._tileWidth = tileWidth;
    this._tileHeight = tileHeight;
    this._activeRequests = [];
    this._onlyWaitForDataAndDecode = onlyWaitForDataAndDecode;
    
    this._fetchManager = fetchManager;
    
    this._decodeScheduler = decodeScheduler;
}

DecodeJobsPool.prototype.forkDecodeJobs = function forkDecodeJobs(
    imagePartParams,
    callback,
    terminatedCallback,
    levelWidth,
    levelHeight,
    isProgressive,
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
    var isMaxXAligned = maxX % this._tileWidth === 0 || maxX === levelWidth;
    var isMaxYAligned = maxY % this._tileHeight === 0 || maxY === levelHeight;
    var isOrderValid = minX < maxX && minY < maxY;
    
    if (!isMinAligned || !isMaxXAligned || !isMaxYAligned || !isOrderValid) {
        throw 'imagePartParams for decoders is not aligned to ' +
            'tile size or not in valid order';
    }
    
    var requestsInLevel = getOrAddValue(this._activeRequests, level, []);
    var requestsInQuality = getOrAddValue(
        requestsInLevel, imagePartParams.quality, []);
        
    var numTilesX = Math.ceil((maxX - minX) / this._tileWidth);
    var numTilesY = Math.ceil((maxY - minY) / this._tileHeight);
    
    var listenerHandle = {
        imagePartParams: imagePartParams,
        callback: callback,
        terminatedCallback: terminatedCallback,
        remainingDecodeJobs: numTilesX * numTilesY,
        isProgressive: isProgressive,
        isAnyDecoderAborted: false,
        isTerminatedCallbackCalled: false,
        allRelevantBytesLoaded: 0,
        unregisterHandles: []
    };
    
    for (var x = minX; x < maxX; x += this._tileWidth) {
        var requestsInX = getOrAddValue(requestsInQuality, x, []);
        var singleTileMaxX = Math.min(x + this._tileWidth, levelWidth);
        
        for (var y = minY; y < maxY; y += this._tileHeight) {
            var singleTileMaxY = Math.min(y + this._tileHeight, levelHeight);
            
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
        
            var decodeJobContainer = getOrAddValue(requestsInX, y, {});
            
            if (decodeJobContainer.job === undefined ||
                decodeJobContainer.job.getIsTerminated()) {
                
                var singleTileImagePartParams = {
                    minX: x,
                    minY: y,
                    maxXExclusive: singleTileMaxX,
                    maxYExclusive: singleTileMaxY,
                    level: level,
                    quality: quality,
                    requestPriorityData: priorityData
                };
                
                decodeJobContainer.job = new DecodeJob(
                    singleTileImagePartParams,
                    this._fetchManager,
                    this._decodeScheduler,
                    this._onlyWaitForDataAndDecode);
            }
            
            var unregisterHandle =
                decodeJobContainer.job.registerListener(listenerHandle);
            listenerHandle.unregisterHandles.push({
                unregisterHandle: unregisterHandle,
                job: decodeJobContainer.job
            });
        }
    }
    
    if (!listenerHandle.isTerminatedCallbackCalled &&
        listenerHandle.remainingDecodeJobs === 0) {
        
        listenerHandle.isTerminatedCallbackCalled = true;
        listenerHandle.terminatedCallback(listenerHandle.isAnyDecoderAborted);
    }
    
    return listenerHandle;
};

DecodeJobsPool.prototype.unregisterForkedJobs = function unregisterForkedJobs(listenerHandle) {
    if (listenerHandle.remainingDecodeJobs === 0) {
        // All jobs has already been terminated, no need to unregister
        return;
    }
    
    for (var i = 0; i < listenerHandle.unregisterHandles.length; ++i) {
        var handle = listenerHandle.unregisterHandles[i];
        if (handle.job.getIsTerminated()) {
            continue;
        }
        
        handle.job.unregisterListener(handle.unregisterHandle);
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

function getOrAddValue(parentArray, index, defaultValue) {
    var subArray = parentArray[index];
    if (subArray === undefined) {
        subArray = defaultValue;
        parentArray[index] = subArray;
    }
    
    return subArray;
}
},{"decodejob.js":6}],8:[function(require,module,exports){
'use strict';

module.exports = FetchJob;

FetchJob.FETCH_TYPE_REQUEST = 1;
FetchJob.FETCH_TYPE_CHANNEL = 2; // movable
FetchJob.FETCH_TYPE_ONLY_WAIT_FOR_DATA = 3;

function FetchJob(fetcher, scheduler, fetchType, contextVars) {
    this._fetcher = fetcher;
    this._scheduler = scheduler;
    
    this._dataListeners = [];
    this._terminatedListeners = [];
    
    this._imagePartParams = null;
    this._progressiveStagesDone = 0;
    
    this._isYielded = false;
    this._isFailure = false;
    this._isTerminated = false;
    this._isManuallyAborted = false;
    this._isChannel = fetchType === FetchJob.FETCH_TYPE_CHANNEL;
	this._isChannelStartedFetch = false;
    this._contextVars = contextVars;
    this._isOnlyWaitForData = fetchType === FetchJob.FETCH_TYPE_ONLY_WAIT_FOR_DATA;
    this._useScheduler = fetchType === FetchJob.FETCH_TYPE_REQUEST;
    this._imageDataContext = null;
    this._resource = null;
    this._abortedBound = this._aborted.bind(this);
	this._fetchHandle = null;
    //this._alreadyTerminatedWhenAllDataArrived = false;
    
    if (fetchType === FetchJob.FETCH_TYPE_CHANNEL) {
        this._movableFetchState = {};
    } else {
        this._movableFetchState = null;
    }
}

FetchJob.prototype.fetch = function fetch(imagePartParams) {
    if (this._isChannel) {
		if (this._imageDataContext !== null) {
			this._imageDataContext.dispose();
		}
        this._imagePartParams = imagePartParams;
        this._startFetch();
        return;
    }
    
    if (this._imagePartParams !== null) {
        throw 'Cannot fetch twice on fetch type of "request"';
    }
    
    this._imagePartParams = imagePartParams;
    
    if (!this._useScheduler) {
        startRequest(/*resource=*/null, this);
        return;
    }
    
    this._scheduler.enqueueJob(startRequest, this, fetchAbortedByScheduler);
};

FetchJob.prototype.manualAbortRequest = function manualAbortRequest() {
    this._isManuallyAborted = true;
    this._isTerminated = true;
    
    if (this._fetchHandle !== null) {
        this._fetchHandle.abortAsync().then(this._abortedBound);
    } else {
		this._imageDataContext.dispose();
	}
};

FetchJob.prototype.getContextVars = function getContextVars(requestId) {
    return this._contextVars;
};

FetchJob.prototype.on = function on(event, listener) {
    switch (event) {
        case 'data':
            this._dataListeners.push(listener);
            break;
        case 'terminated':
            this._terminatedListeners.push(listener);
            break;
        default:
            throw 'Unexpected event ' + event;
    }
};

FetchJob.prototype.setIsProgressive = function setIsProgressive(isProgressive) {
    this._isProgressive = isProgressive;
	if (this._imageDataContext !== null) {
		this._imageDataContext.setIsProgressive(isProgressive);
	}
};

FetchJob.prototype.getIsProgressive = function getIsProgressive() {
    return this._isProgressive;
};

FetchJob.prototype._startFetch = function startFetch() {
    var imageDataContext = this._fetcher.createImageDataContext(
        this._imagePartParams);
    
    this._imageDataContext = imageDataContext;
	this._imageDataContext.setIsProgressive(this._isProgressive);

    if (imageDataContext.isDone()) {
        for (var i = 0; i < this._dataListeners.length; ++i) {
            this._dataListeners[i].call(this, this._contextVars, imageDataContext);
        }

        this._fetchTerminated(/*isAborted=*/false);
        //this._alreadyTerminatedWhenAllDataArrived = true;
        
        return;
    }
    
    if (imageDataContext.hasData()) {
        for (var j = 0; j < this._dataListeners.length; ++j) {
            this._dataListeners[j].call(this, this._contextVars, imageDataContext);
        }
    }
    
    var self = this;
    imageDataContext.on('data', function() {
        self._dataCallback(imageDataContext);
    });
    
    if (!this._isOnlyWaitForData) {
		if (!this._isChannel) {
			this._fetchHandle = this._fetcher.fetch(imageDataContext);
		} else if (this._isChannelStartedFetch) {
			this._fetcher.moveFetch(imageDataContext, this._movableFetchState);
		} else {
			this._fetcher.startMovableFetch(imageDataContext, this._movableFetchState);
			this._isChannelStartedFetch = true;
		}
    }
};

FetchJob.prototype._fetchTerminated = function fetchTerminated(isAborted) {
    if (this._isYielded || this._isTerminated) {
        throw 'Unexpected request state on terminated';
    }
    
    if (this._resource !== null) {
        if (isAborted) {
            throw 'Unexpected request termination without resource allocated';
        }

        this._scheduler.jobDone(this._resource, this);

        this._resource = null;
    } else if (!isAborted && this._useScheduler) {
        throw 'Job expected to have resource on successful termination';
    }
    
    // Channel is not really terminated, but only fetches a new region
    // (see moveChannel()).
    if (!this._isChannel) {
        this._isTerminated = true;
        
        for (var i = 0; i < this._terminatedListeners.length; ++i) {
            this._terminatedListeners[i](
                this._contextVars, this._imageDataContext, isAborted);
        }
    }
    
    if (this._imageDataContext !== null && !this._isFailure) {
        this._imageDataContext.dispose();
    }
};

FetchJob.prototype._continueFetch = function continueFetch() {
    if (this.isChannel) {
        throw 'Unexpected call to continueFetch on channel';
    }
    
    this._fetchHandle = this._fetcher.fetch(this._imageDataContext);
};

FetchJob.prototype._dataCallback = function dataCallback(imageDataContext) {
    try {
        if (this._isYielded || this._isTerminated) {
            throw 'Unexpected request state on fetch callback';
        }
            
        if (imageDataContext !== this._imageDataContext) {
            throw 'Unexpected imageDataContext';
        }

        ++this._progressiveStagesDone;
        
        
        for (var i = 0; i < this._dataListeners.length; ++i) {
            this._dataListeners[i].call(this, this._contextVars, imageDataContext);
        }
        
        if (imageDataContext.isDone()) {
            this._fetchTerminated(/*isAborted=*/false);
            //this._alreadyTerminatedWhenAllDataArrived = true;
            return;
        }
        
        if (this._useScheduler) {
            if (this._resource === null) {
                throw 'No resource allocated but fetch callback called';
            }
            
			var isYielded = this._scheduler.tryYield(
				continueYieldedRequest,
				this,
				fetchAbortedByScheduler,
				fetchYieldedByScheduler,
				this._resource);
            
			if (isYielded) {
                this._fetchHandle.abortAsync().then(this._abortedBound);
            }
        }
    } catch (e) {
        this._isFailure = true;
        fetchAbortedByScheduler(this);
    }
};

FetchJob.prototype._aborted = function aborted() {
    // TODO: It seems that this function is totally historical code. Should review it.
    
    //if (this._alreadyTerminatedWhenAllDataArrived) {
    //    // Resources were already released ASAP
    //    return;
    //}
    
    if (this._isYielded || this._resource === null) {
        throw 'Unexpected request state on stopped';
    }
    
    if (this._isOnlyWaitForData ||
        this._fetchHandle === null) {
        
        throw 'Unexpected request type on stopped';
    }
    
    /*
    if (!isAborted) {
        if (!this._isTerminated) {
            throw '"stopped" listener was called with isAborted=false but ' +
                'imageDataContext "data" listener was not called yet';
        }
        
        return;
    }
    //*/
    
    var scheduler = this._scheduler;
    
    var isYielded = scheduler.tryYield(
        continueYieldedRequest,
        this,
        fetchAbortedByScheduler,
        fetchYieldedByScheduler,
        this._resource);
    
    if (isYielded || this._isTerminated) {
        this._fetchHandle = null;
        scheduler.jobDone(this._resource, this);
        
        return;
    }
    
    this._continueFetch();
};

// Properties for FrustumRequesetPrioritizer

Object.defineProperty(FetchJob.prototype, 'imagePartParams', {
    get: function getImagePartParams() {
        return this._imagePartParams;
    }
});

Object.defineProperty(FetchJob.prototype, 'progressiveStagesDone', {
    get: function getProgressiveStagesDone() {
        return this._progressiveStagesDone;
    }
});

function startRequest(resource, self) {
    if (self._imageDataContext !== null) {
        throw 'Unexpected restart of already started request';
    }
    
    if (self._isManuallyAborted) {
        if (resource !== null) {
            self._scheduler.jobDone(resource, self);
        }
        
        return;
    }
    
    self._resource = resource;
    
    self._startFetch();
}

function continueYieldedRequest(resource, self) {
    if (self._isManuallyAborted || self._isFailure) {
        self._scheduler.jobDone(self._resource, self);
        
        return;
    }
    
    if (!self.isYielded || self.isTerminated) {
        throw 'Unexpected request state on continue';
    }
    
    self.isYielded = false;
    self.resource = resource;
    
    self._continueFetch();
}

function fetchYieldedByScheduler(self) {
    if (self._isYielded || self._isTerminated) {
        throw 'Unexpected request state on yield';
    }
    
    self._isYielded = true;
    self._resource = null;
}

function fetchAbortedByScheduler(self) {
    self._isYielded = false;
    self._resource = null;
    self._fetchTerminated(/*isAborted=*/true);
}
},{}],9:[function(require,module,exports){
'use strict';

module.exports = FetchManager;

var imageHelperFunctions = require('imagehelperfunctions.js');
var FetchJob = require('fetchjob.js');
var ImageParamsRetrieverProxy = require('imageparamsretrieverproxy.js');

/* global console: false */

function FetchManager(options) {
    ImageParamsRetrieverProxy.call(this, options.imageImplementationClassName);

    var serverRequestsLimit = options.serverRequestsLimit || 5;
    
    this._fetcher = null;
    this._internalSizesParams = null;
    this._showLog = options.showLog;
    
    if (this._showLog) {
        // Old IE
        throw 'showLog is not supported on this browser';
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
}

FetchManager.prototype = Object.create(ImageParamsRetrieverProxy.prototype);

FetchManager.prototype.open = function open(url) {
    var promise = this._imageImplementation.createFetcher(url, {isReturnPromise: true});
    var self = this;
    return promise.then(function(result) {
        self._fetcher = result.fetcher;
        self._internalSizesParams = result.sizesParams;
        return result.sizesParams;
    });
};

FetchManager.prototype.close = function close() {
    return this._fetcher.close({isReturnPromise: true});
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

FetchManager.prototype.createChannel = function createChannel(
    createdCallback) {
    
    var channelHandle = ++this._channelHandleCounter;
    this._channelHandles[channelHandle] = new FetchJob(
        this._fetcher,
        this._scheduler,
        FetchJob.FETCH_TYPE_CHANNEL,
        /*contextVars=*/null);

    createdCallback(channelHandle);
};

FetchManager.prototype.moveChannel = function moveChannel(
    channelHandle, imagePartParams) {
    
    var channel = this._channelHandles[channelHandle];
    channel.fetch(imagePartParams);
};

FetchManager.prototype.createRequest = function createRequest(
    fetchParams,
    callbackThis,
    callback,
    terminatedCallback,
    isOnlyWaitForData,
    requestId) {
    
    var contextVars = {
        progressiveStagesDone: 0,
        isLastCallbackCalledWithoutLowQualityLimit: false,
        callbackThis: callbackThis,
        callback: callback,
        terminatedCallback: terminatedCallback,
        requestId: requestId,
        fetchJob: null,
        self: this
    };
    
    var fetchType = isOnlyWaitForData ?
        FetchJob.FETCH_TYPE_ONLY_WAIT_FOR_DATA : FetchJob.FETCH_TYPE_REQUEST;
    
    var fetchJob = new FetchJob(
        this._fetcher, this._scheduler, fetchType, contextVars);
    
    contextVars.fetchJob = fetchJob;
    
    if (this._requestById[requestId] !== undefined) {
        throw 'Duplication of requestId ' + requestId;
    } else if (requestId !== undefined) {
        this._requestById[requestId] = fetchJob;
    }
    
    fetchJob.on('data', internalCallback);
    fetchJob.on('terminated', internalTerminatedCallback);
    
    fetchJob.fetch(fetchParams);
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
    };

FetchManager.prototype._getSizesParamsInternal = function getSizesParamsInternal() {
    return this._internalSizesParams;
};

function internalCallback(contextVars, imageDataContext) {
    var isProgressive = contextVars.fetchJob.getIsProgressive();
    var isLimitToLowQuality = 
        contextVars.progressiveStagesDone === 0;
    
    // See comment at internalTerminatedCallback method
    contextVars.isLastCallbackCalledWithoutLowQualityLimit |=
        isProgressive && !isLimitToLowQuality;
    
    if (!isProgressive) {
        return;
    }
    
    var quality = isLimitToLowQuality ? contextVars.self.getLowestQuality() : undefined;
    
    ++contextVars.progressiveStagesDone;
    
    extractDataAndCallCallback(contextVars, imageDataContext, quality);
}

function internalTerminatedCallback(contextVars, imageDataContext, isAborted) {
    if (!contextVars.isLastCallbackCalledWithoutLowQualityLimit) {
        // This condition come to check if another decoding should be done.
        // One situation it may happen is when the request is not
        // progressive, then the decoding is done only on termination.
        // Another situation is when only the first stage has been reached,
        // thus the callback was called with only the first quality (for
        // performance reasons). Thus another decoding should be done.
        
        extractDataAndCallCallback(contextVars, imageDataContext);
    }
    
    contextVars.terminatedCallback.call(
        contextVars.callbackThis, isAborted);
    
    delete contextVars.self._requestById[contextVars.requestId];
}

function extractDataAndCallCallback(contextVars, imageDataContext, quality) {
    var dataForDecode = imageDataContext.getFetchedData(quality);
    
    contextVars.callback.call(
        contextVars.callbackThis, dataForDecode);
}

function createServerRequestDummyResource() {
    return {};
}
},{"fetchjob.js":8,"imagehelperfunctions.js":12,"imageparamsretrieverproxy.js":15}],10:[function(require,module,exports){
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
        if (jobContext.progressiveStagesDone === undefined) {
            throw 'Missing progressive stage information';
        }
        
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
    
    var relativeX = x / this._frustumData.image.getLevelWidth(
        imagePartParams.level);
    
    var imageRectangle = this._frustumData.imageRectangle;
    var rectangleWidth = imageRectangle.east - imageRectangle.west;
    
    var xProjected = imageRectangle.west + relativeX * rectangleWidth;
    return xProjected;
};

FrustumRequestsPrioritizer.prototype._pixelToCartographicY = function tileToCartographicY(
    y, imagePartParams, image) {
    
    var relativeY = y / this._frustumData.image.getLevelHeight(
        imagePartParams.level);
    
    var imageRectangle = this._frustumData.imageRectangle;
    var rectangleHeight = imageRectangle.north - imageRectangle.south;
    
    var yProjected = imageRectangle.north - relativeY * rectangleHeight;
    return yProjected;
};
},{}],11:[function(require,module,exports){
'use strict';

module.exports = HashMap;

var LinkedList = require('linkedlist.js');

function HashMap(hasher) {
    this._byKey = [];
    this._hasher = hasher;
}

HashMap.prototype.getFromKey = function getFromKey(key) {
    var hashCode = this._hasher.getHashCode(key);
    var hashElements = this._byKey[hashCode];
    if (!hashElements) {
        return null;
    }
    
    var iterator = hashElements.getFirstIterator();
    while (iterator !== null) {
        var item = hashElements.getValue(iterator);
        if (this._hasher.isEqual(item.key, key)) {
            return item.value;
        }
        
        iterator = hashElements.getNextIterator(iterator);
    }

    return null;
};

HashMap.prototype.getFromIterator = function getFromIterator(iterator) {
    return iterator._hashElements.getValue(iterator._internalIterator).value;
};

HashMap.prototype.tryAdd = function tryAdd(key, createValue) {
    var hashCode = this._hasher.getHashCode(key);
    var hashElements = this._byKey[hashCode];
    if (!hashElements) {
        hashElements = new LinkedList();
        this._byKey[hashCode] = hashElements ;
    }
    
    var iterator = {
        _hashCode: hashCode,
        _hashElements: hashElements,
        _internalIterator: null
    };
    
    iterator._internalIterator = hashElements.getFirstIterator();
    while (iterator._internalIterator !== null) {
        var item = hashElements.getValue(iterator._internalIterator);
        if (this._hasher.isEqual(item.key, key)) {
            return {
                iterator: iterator,
                isNew: false,
                value: item.value
            };
        }
        
        iterator._internalIterator = hashElements.getNextIterator(iterator._internalIterator);
    }
    
    var value = createValue();
    iterator._internalIterator = hashElements.add({
        key: key,
        value: value
    });
    
    return {
        iterator: iterator,
        isNew: true,
        value: value
    };
};

HashMap.prototype.remove = function remove(iterator) {
    iterator._hashElements.remove(iterator._internalIterator);
    if (iterator._hashElements.getCount() === 0) {
        delete this._byKey[iterator._hashCode];
    }
};
},{"linkedlist.js":13}],12:[function(require,module,exports){
'use strict';

var FrustumRequestsPrioritizer = require('frustumrequestsprioritizer.js');

module.exports = {
    calculateFrustum2DFromBounds: calculateFrustum2DFromBounds,
    createScheduler: createScheduler,
    fixBounds: fixBounds,
    alignParamsToTilesAndLevel: alignParamsToTilesAndLevel,
    getImageImplementation: getImageImplementation,
    getScriptsForWorkerImport: getScriptsForWorkerImport,
    createInternalOptions: createInternalOptions
};

// Avoid jshint error
/* global self: false */
/* global globals: false */
    
//var log2 = Math.log(2);

var imageDecoderFrameworkScript = new AsyncProxy.ScriptsToImportPool();
imageDecoderFrameworkScript.addScriptFromErrorWithStackTrace(new Error());
var scriptsForWorkerToImport = imageDecoderFrameworkScript.getScriptsForWorkerImport();

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

    var level = image.getImageLevel();
    var pixelsAspectRatio =
        image.getLevelWidth(level) / image.getLevelHeight(level);
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
    region, imageDecoder) {
    
    var sizesCalculator = imageDecoder._getSizesCalculator();
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
    
    var imageLevel = sizesCalculator.getImageLevel();
    var defaultLevelWidth = sizesCalculator.getLevelWidth(imageLevel);
    var defaultLevelHeight = sizesCalculator.getLevelHeight(imageLevel);
    if (regionMaxX < 0 || regionMinX >= defaultLevelWidth ||
        regionMaxY < 0 || regionMinY >= defaultLevelHeight) {
        
        return null;
    }
    
    //var maxLevel =
    //    sizesCalculator.getDefaultNumResolutionLevels() - 1;

    //var levelX = Math.log((regionMaxX - regionMinX) / screenWidth ) / log2;
    //var levelY = Math.log((regionMaxY - regionMinY) / screenHeight) / log2;
    //var level = Math.ceil(Math.min(levelX, levelY));
    //level = Math.max(0, Math.min(maxLevel, level));
    var level = sizesCalculator.getLevel(region);
    var levelWidth = sizesCalculator.getLevelWidth(level);
    var levelHeight = sizesCalculator.getLevelHeight(level);
    
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

function getImageImplementation(imageImplementationClassName) {
    try {
        return window && window[imageImplementationClassName];
    } catch(e) { }

    try {
        return globals && globals[imageImplementationClassName];
    } catch(e) { }

    try {
        return self && self[imageImplementationClassName];
    } catch(e) { }
}

function getScriptsForWorkerImport(imageImplementation, options) {
    return scriptsForWorkerToImport.concat(
        imageImplementation.getScriptsToImport());
}

function createInternalOptions(imageImplementationClassName, options) {
    options = options || {};
    
    if (options.imageImplementationClassName &&
        options.scriptsToImport) {
            
        return options;
    }
    
    var imageImplementation = getImageImplementation(imageImplementationClassName);
    
    var optionsInternal = JSON.parse(JSON.stringify(options));
    optionsInternal.imageImplementationClassName = options.imageImplementationClassName || imageImplementationClassName;
    optionsInternal.scriptsToImport = options.scriptsToImport || getScriptsForWorkerImport(imageImplementation, options);
    
    return optionsInternal;
}
},{"frustumrequestsprioritizer.js":10}],13:[function(require,module,exports){
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

var imageHelperFunctions = require('imagehelperfunctions.js');

function ImageParamsRetrieverProxy(imageImplementationClassName) {
    this._imageImplementation = imageHelperFunctions.getImageImplementation(imageImplementationClassName);
    this._sizesParams = null;
    this._sizesCalculator = null;
}

ImageParamsRetrieverProxy.prototype.getImageLevel = function getImageLevel() {
    this._validateSizesCalculator();
    var level = this._sizesCalculator.getImageLevel();

    return level;
};

ImageParamsRetrieverProxy.prototype.getNumResolutionLevelsForLimittedViewer = function getNumResolutionLevelsForLimittedViewer() {
    this._validateSizesCalculator();
    var levels = this._sizesCalculator.getNumResolutionLevelsForLimittedViewer();

    return levels;
};

ImageParamsRetrieverProxy.prototype.getLevelWidth = function getLevelWidth(level) {
    this._validateSizesCalculator();
    var width = this._sizesCalculator.getLevelWidth(
        level);

    return width;
};

ImageParamsRetrieverProxy.prototype.getLevelHeight = function getLevelHeight(level) {
    this._validateSizesCalculator();
    var height = this._sizesCalculator.getLevelHeight(
        level);

    return height;
};

ImageParamsRetrieverProxy.prototype.getLevel = function getLevel(regionLevel0) {
    this._validateSizesCalculator();
    var level = this._sizesCalculator.getLevel(regionLevel0);
    
    return level;
};

ImageParamsRetrieverProxy.prototype.getLowestQuality = function getLowestQuality() {
    this._validateSizesCalculator();
    var quality = this._sizesCalculator.getLowestQuality();
    
    return quality;
};

ImageParamsRetrieverProxy.prototype.getHighestQuality = function getHighestQuality() {
    this._validateSizesCalculator();
    var quality = this._sizesCalculator.getHighestQuality();

    return quality;
};

ImageParamsRetrieverProxy.prototype._getSizesCalculator = function getSizesCalculator() {
    this._validateSizesCalculator(this);
    
    return this._sizesCalculator;
};

ImageParamsRetrieverProxy.prototype._getSizesParams = function getSizesParams() {
    if (!this._sizesParams) {
        this._sizesParams = this._getSizesParamsInternal();
        if (!this._sizesParams) {
            throw 'getSizesParams() return falsy value; Maybe image not ready yet?';
        }
    }
    
    return this._sizesParams;
};

ImageParamsRetrieverProxy.prototype._getSizesParamsInternal = function getSizesParamsInternal() {
    throw 'ImageParamsRetrieverProxy implemented did not implement _getSizesParamsInternal()';
};

ImageParamsRetrieverProxy.prototype._validateSizesCalculator = function validateSizesCalculator() {
    if (this._sizesCalculator !== null) {
        return;
    }
    
    var sizesParams = this._getSizesParams();
    this._sizesCalculator = this._imageImplementation.createImageParamsRetriever(
        sizesParams);
}
},{"imagehelperfunctions.js":12}],16:[function(require,module,exports){
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
        
        var data = { sizesParams: this._getSizesParams() };
        
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

module.exports = WorkerProxyFetchManager;

var imageHelperFunctions = require('imagehelperfunctions.js');
var sendImageParametersToMaster = require('sendimageparameterstomaster.js');
var ImageParamsRetrieverProxy = require('imageparamsretrieverproxy.js');

function WorkerProxyFetchManager(options) {
    ImageParamsRetrieverProxy.call(this, options.imageImplementationClassName);

    this._imageWidth = null;
    this._imageHeight = null;
    this._internalSizesParams = null;
    this._options = options;
    
    var ctorArgs = [options];
    var scriptsToImport = options.scriptsToImport.concat([sendImageParametersToMaster.getScriptUrl()]);
    
    this._workerHelper = new AsyncProxy.AsyncProxyMaster(
        scriptsToImport, 'imageDecoderFramework.Internals.FetchManager', ctorArgs);
    
    var boundUserDataHandler = this._userDataHandler.bind(this);
    this._workerHelper.setUserDataHandler(boundUserDataHandler);
}

WorkerProxyFetchManager.prototype = Object.create(ImageParamsRetrieverProxy.prototype);

WorkerProxyFetchManager.prototype.open = function open(url) {
    return this._workerHelper.callFunction('open', [url], { isReturnPromise: true });
};

WorkerProxyFetchManager.prototype.close = function close() {
    var self = this;
    return this._workerHelper.callFunction('close', [], { isReturnPromise: true }).then(function() {
        self._workerHelper.terminate();
    });
};

WorkerProxyFetchManager.prototype.createChannel = function createChannel(
    createdCallback) {
    
    var callbackWrapper = this._workerHelper.wrapCallback(
        createdCallback,
        'FetchManager_createChannelCallback');
    
    var args = [callbackWrapper];
    this._workerHelper.callFunction('createChannel', args);
};

WorkerProxyFetchManager.prototype.moveChannel = function moveChannel(
    channelHandle, imagePartParams) {
    
    var args = [channelHandle, imagePartParams];
    this._workerHelper.callFunction('moveChannel', args);
};

WorkerProxyFetchManager.prototype.createRequest = function createRequest(
    fetchParams,
    callbackThis,
    callback,
    terminatedCallback,
    isOnlyWaitForData,
    requestId) {
    
    //var pathToArrayInPacketsData = [0, 'data', 'buffer'];
    //var pathToHeadersCodestream = [1, 'codestream', 'buffer'];
    //var transferablePaths = [
    //    pathToArrayInPacketsData,
    //    pathToHeadersCodestream
    //];
    
    var transferablePaths = this._options.transferablePathsOfRequestCallback;
    
    var internalCallbackWrapper =
        this._workerHelper.wrapCallback(
            callback.bind(callbackThis), 'requestTilesProgressiveCallback', {
                isMultipleTimeCallback: true,
                pathsToTransferables: transferablePaths
            }
        );
    
    var internalTerminatedCallbackWrapper =
        this._workerHelper.wrapCallback(
            internalTerminatedCallback, 'requestTilesProgressiveTerminatedCallback', {
                isMultipleTimeCallback: false
            }
        );
            
    var args = [
        fetchParams,
        /*callbackThis=*/{ dummyThis: 'dummyThis' },
        internalCallbackWrapper,
        internalTerminatedCallbackWrapper,
        isOnlyWaitForData,
        requestId];
        
    var self = this;
    
    this._workerHelper.callFunction('createRequest', args);
    
    function internalTerminatedCallback(isAborted) {
        self._workerHelper.freeCallback(internalCallbackWrapper);
        terminatedCallback.call(callbackThis, isAborted);
    }
};

WorkerProxyFetchManager.prototype.manualAbortRequest = function manualAbortRequest(
    requestId) {
    
    var args = [requestId];
    this._workerHelper.callFunction(
        'manualAbortRequest', args);
};

WorkerProxyFetchManager.prototype.setIsProgressiveRequest = function setIsProgressiveRequest(
    requestId, isProgressive) {
    
    var args = [requestId, isProgressive];
    this._workerHelper.callFunction('setIsProgressiveRequest', args);
};

WorkerProxyFetchManager.prototype.setServerRequestPrioritizerData =
    function setServerRequestPrioritizerData(prioritizerData) {
    
    this._workerHelper.callFunction(
        'setServerRequestPrioritizerData',
        [ prioritizerData ],
        { isSendImmediately: true });
};

WorkerProxyFetchManager.prototype.reconnect = function reconnect() {
    this._workerHelper.callFunction('reconnect');
};

WorkerProxyFetchManager.prototype._getSizesParamsInternal = function getSizesParamsInternal() {
    return this._internalSizesParams;
};

WorkerProxyFetchManager.prototype._userDataHandler = function userDataHandler(data) {
    this._internalSizesParams = data.sizesParams;
};
},{"imagehelperfunctions.js":12,"imageparamsretrieverproxy.js":15,"sendimageparameterstomaster.js":16}],18:[function(require,module,exports){
'use strict';

module.exports = WorkerProxyImageDecoder;

var imageHelperFunctions = require('imagehelperfunctions.js');
var sendImageParametersToMaster = require('sendimageparameterstomaster.js');
var createImageDecoderSlaveSide = require('createimagedecoderonslaveside.js');
var ImageParamsRetrieverProxy = require('imageparamsretrieverproxy.js');

function WorkerProxyImageDecoder(imageImplementationClassName, options) {
    ImageParamsRetrieverProxy.call(this, imageImplementationClassName);

    this._imageWidth = null;
    this._imageHeight = null;
    this._tileWidth = 0;
    this._tileHeight = 0;
    this._sizesCalculator = null;
    
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
    this._validateSizesCalculator();
    return this._tileWidth;
};

WorkerProxyImageDecoder.prototype.getTileHeight = function getTileHeight() {
    this._validateSizesCalculator();
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

WorkerProxyImageDecoder.prototype.createChannel = function createChannel(
    createdCallback) {
    
    var callbackWrapper = this._workerHelper.wrapCallback(
        createdCallback, 'ImageDecoder_createChannelCallback');
    
    var args = [callbackWrapper];
    this._workerHelper.callFunction('createChannel', args);
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
    this._validateSizesCalculator();
};

WorkerProxyImageDecoder.prototype._getSizesParamsInternal = function getSizesParamsInternal() {
    return this._internalSizesParams;
};
},{"createimagedecoderonslaveside.js":14,"imagehelperfunctions.js":12,"imageparamsretrieverproxy.js":15,"sendimageparameterstomaster.js":16}],19:[function(require,module,exports){
'use strict';

// Suppress "Unnecessary directive 'use strict'" for the slaveScriptContent function
/*jshint -W034 */

/* global self: false */

module.exports = WorkerProxyPixelsDecoder;

var imageHelperFunctions = require('imagehelperfunctions.js');

var decoderSlaveScriptBlob = new Blob(
    ['(', decoderSlaveScriptBody.toString(), ')()'],
    { type: 'application/javascript' });
var decoderSlaveScriptUrl = URL.createObjectURL(decoderSlaveScriptBlob);

function WorkerProxyPixelsDecoder(options) {
    this._options = options || {};
    this._imageImplementation = imageHelperFunctions.getImageImplementation(
        options.imageImplementationClassName);
    
    var scriptsToImport = (this._options.scriptsToImport || []).concat([decoderSlaveScriptUrl]);
    var args = [this._options];
    
    this._workerHelper = new AsyncProxy.AsyncProxyMaster(
        scriptsToImport,
        'ArbitraryClassName',
        args);
}

WorkerProxyPixelsDecoder.prototype.decode = function decode(dataForDecode) {
    //var transferables = this._imageImplementation.getTransferableOfDecodeArguments(dataForDecode);
    var resultTransferables = [['data', 'buffer']];
    
    var args = [dataForDecode];
    var options = {
        //transferables: transferables,
        pathsToTransferablesInPromiseResult: resultTransferables,
        isReturnPromise: true
    };
    
    return this._workerHelper.callFunction('decode', args, options);
};

WorkerProxyPixelsDecoder.prototype.terminate = function terminate() {
    this._workerHelper.terminate();
};

function decoderSlaveScriptBody() {
    'use strict';

    AsyncProxy.AsyncProxySlave.setSlaveSideCreator(function createDecoder(options) {
        var imageImplementation = self[options.imageImplementationClassName];
        return imageImplementation.createPixelsDecoder();
    });
}
},{"imagehelperfunctions.js":12}],20:[function(require,module,exports){
'use strict';

module.exports = ViewerImageDecoder;

var ImageDecoder = require('imagedecoder.js');
var WorkerProxyImageDecoder = require('workerproxyimagedecoder.js');
var imageHelperFunctions = require('imagehelperfunctions.js');

var PENDING_CALL_TYPE_PIXELS_UPDATED = 1;
var PENDING_CALL_TYPE_REPOSITION = 2;

var REGION_OVERVIEW = 0;
var REGION_DYNAMIC = 1;

function ViewerImageDecoder(imageImplementationClassName, canvasUpdatedCallback, options) {
    this._imageImplementationClassName = imageImplementationClassName;
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
    this._workersLimit = options.workersLimit;
        
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
    
    var ImageType = this._isMainImageOnUi ?
        ImageDecoder: WorkerProxyImageDecoder;
        
    this._image = new ImageType(imageImplementationClassName, {
        serverRequestPrioritizer: 'frustumOnly',
        decodePrioritizer: 'frustumOnly',
        showLog: this._showLog,
        workersLimit: this._workersLimit
        });
}

ViewerImageDecoder.prototype.setExceptionCallback = function setExceptionCallback(exceptionCallback) {
    // TODO: Support exceptionCallback in every place needed
	this._exceptionCallback = exceptionCallback;
};
    
ViewerImageDecoder.prototype.open = function open(url) {
    return this._image.open(url)
        .then(this._opened.bind(this))
        .catch(this._exceptionCallback);
};

ViewerImageDecoder.prototype.close = function close() {
    var promise = this._image.close();
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
            regionParams, this._image);
    
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

    this._image.requestPixelsProgressive(
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
        this._image.createChannel(
            this._createdChannelBound);
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
        scaleX = this._image.getLevelWidth (level) / this._image.getLevelWidth (oldPartParams.level);
        scaleY = this._image.getLevelHeight(level) / this._image.getLevelHeight(oldPartParams.level);
        
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
        fixedBounds, this._image, this._adaptProportions);
    this._cartographicBoundsFixed = fixedBounds;
    
    var level = this._image.getImageLevel();
    var imageWidth = this._image.getLevelWidth(level);
    var imageHeight = this._image.getLevelHeight(level);
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
            overviewParams, this._image);
            
    overviewAlignedParams.imagePartParams.requestPriorityData =
        overviewAlignedParams.imagePartParams.requestPriorityData || {};
    
    overviewAlignedParams.imagePartParams.requestPriorityData.overrideHighestPriority = true;
    overviewAlignedParams.imagePartParams.quality = this._image.getLowestQuality();
    
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
},{"imagedecoder.js":5,"imagehelperfunctions.js":12,"workerproxyimagedecoder.js":18}],21:[function(require,module,exports){
'use strict';

module.exports.ViewerImageDecoder = require('viewerimagedecoder.js');
module.exports.ImageDecoder = require('imagedecoder.js');
module.exports.SimpleFetcher = require('simplefetcher.js');
module.exports.SimplePixelsDecoderBase = require('simplepixelsdecoderbase.js');
module.exports.CesiumImageDecoderLayerManager = require('_cesiumimagedecoderlayermanager.js');
module.exports.ImageDecoderImageryProvider = require('imagedecoderimageryprovider.js');
module.exports.ImageDecoderRegionLayer = require('imagedecoderregionlayer.js');
module.exports.Internals = {
    FetchManager: require('fetchmanager.js')
};
},{"_cesiumimagedecoderlayermanager.js":2,"fetchmanager.js":9,"imagedecoder.js":5,"imagedecoderimageryprovider.js":4,"imagedecoderregionlayer.js":22,"simplefetcher.js":25,"simplepixelsdecoderbase.js":28,"viewerimagedecoder.js":20}],22:[function(require,module,exports){
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
                this._options = JSON.parse(JSON.stringify(options));
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
            this._image = null;
            this._exceptionCallback = null;
        },
        
        setExceptionCallback: function setExceptionCallback(exceptionCallback) {
            this._exceptionCallback = exceptionCallback;
            if (this._image !== null) {
                this._image.setExceptionCallback(exceptionCallback);
            }
        },
        
        _createImage: function createImage() {
            if (this._image === null) {
                this._image = new ViewerImageDecoder(
                    this._options.imageImplementationClassName,
                    this._canvasUpdatedCallbackBound,
                    this._options);
                
                if (this._exceptionCallback !== null) {
                    this._image.setExceptionCallback(this._exceptionCallback);
                }
                
                this._image.open(this._options.url);
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
            
            this._image.setTargetCanvas(this._targetCanvas);
            
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
            
            this._image.close();
            this._image = null;
        },
        
        _moved: function () {
            this._moveCanvases();

            var frustumData = calculateLeafletFrustum(this._map);
            
            this._image.updateViewArea(frustumData);
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
},{"leafletfrustumcalculator.js":23,"viewerimagedecoder.js":20}],23:[function(require,module,exports){
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
},{"imagehelperfunctions.js":12}],24:[function(require,module,exports){
'use strict';

module.exports = DataPublisher;

var LinkedList = require('linkedlist.js');
var HashMap = require('hashmap.js');

function DataPublisher(hasher) {
    this._subscribersByKey = new HashMap(hasher);
}

DataPublisher.prototype.publish = function publish(key, data, fetchEnded) {
    var subscribers = this._subscribersByKey.getFromKey(key);
    if (!subscribers) {
        return;
    }
    
    var iterator = subscribers.subscribersList.getFirstIterator();
    var listeners = [];
    while (iterator !== null) {
        var subscriber = subscribers.subscribersList.getValue(iterator);
	
		if (!subscriber.isEnded) {
			listeners.push(subscriber.listener);
			if (fetchEnded) {
				--subscribers.subscribersNotEndedCount;
				subscriber.isEnded = true;
			}
		}
        
        iterator = subscribers.subscribersList.getNextIterator(iterator);
    }
    
    // Call only after collecting all listeners, so the list will not be destroyed while iterating
    for (var i = 0; i < listeners.length; ++i) {
        listeners[i].call(this, key, data, fetchEnded);
    }
};

DataPublisher.prototype.subscribe = function subscribe(key, subscriber) {
    var subscribers = this._subscribersByKey.tryAdd(key, function() {
        return {
            subscribersList: new LinkedList(),
            subscribersNotEndedCount: 0
        };
    });
    
    ++subscribers.value.subscribersNotEndedCount;
    
    var listIterator = subscribers.value.subscribersList.add({
        listener: subscriber,
        isEnded: false
    });
    
    var handle = {
        _listIterator: listIterator,
        _hashIterator: subscribers.iterator
    };
    return handle;
};

DataPublisher.prototype.unsubscribe = function unsubscribe(handle) {
    var subscribers = this._subscribersByKey.getFromIterator(handle._hashIterator);
    
    var subscriber = subscribers.subscribersList.getValue(handle._listIterator);
    subscribers.subscribersList.remove(handle._listIterator);
    if (subscribers.subscribersList.getCount() === 0) {
        this._subscribersByKey.remove(handle._hashIterator);
    } else if (!subscriber.isEnded) {
        --subscribers.subscribersNotEndedCount;
        subscriber.isEnded = true;
    }
};

DataPublisher.prototype.isKeyNeedFetch = function isKeyNeedFetch(key) {
    var subscribers = this._subscribersByKey.getFromKey(key);
    return (!!subscribers) && (subscribers.subscribersNotEndedCount > 0);
};
},{"hashmap.js":11,"linkedlist.js":13}],25:[function(require,module,exports){
'use strict';

module.exports = SimpleFetcher;

var SimpleImageDataContext = require('simpleimagedatacontext.js');
var SimpleNonProgressiveFetchHandle = require('simplenonprogressivefetchhandle.js');
var DataPublisher = require('datapublisher.js');

/* global Promise: false */

function SimpleFetcher(fetcherMethods, options) {
    this._url = null;
    this._fetcherMethods = fetcherMethods;
    this._options = options || {};
    this._isReady = true;
    
    if (!this._fetcherMethods.getDataKeys) {
        throw 'SimpleFetcher error: getDataKeys is not implemented';
    }
    if (!this._fetcherMethods.fetch && !this._fetcherMethods.fetchProgressive) {
        throw 'SimpleFetcher error: Neither fetch nor fetchProgressive methods are implemented';
    }
    
    if (!this._fetcherMethods.getHashCode) {
        throw 'SimpleFetcher error: getHashCode is not implemented';
    }
    if (!this._fetcherMethods.isEqual) {
        throw 'SimpleFetcher error: isEqual is not implemented';
    }

    this._hasher = {
        _fetcherMethods: this._fetcherMethods,
        getHashCode: function(dataKey) {
            return this._fetcherMethods.getHashCode(dataKey);
        },
        isEqual: function(key1, key2) {
            if (key1.maxQuality !== key2.maxQuality) {
                return false;
            }

            return this._fetcherMethods.isEqual(key1.dataKey, key2.dataKey);
        }
    };

    if (this._fetcherMethods.createDataPublisher) {
        this._dataPublisher = this.fetcherMethods.createDataPublisher(this._hasher);
    } else {
        this._dataPublisher = new DataPublisher(this._hasher);
    }
}

SimpleFetcher.prototype.fetchProgressive = function fetchProgressive(imagePartParams, dataKeys, dataCallback, queryIsKeyNeedFetch, maxQuality) {
    this._ensureReady();
    if (!this._fetcherMethods.fetchProgressive) {
        var fetchHandle = new SimpleNonProgressiveFetchHandle(this._fetcherMethods, dataCallback, queryIsKeyNeedFetch, this._options);
        fetchHandle.fetch(dataKeys);
        return fetchHandle;
    }
    
    return this._fetcherMethods.fetchProgressive(imagePartParams, dataKeys, dataCallback, queryIsKeyNeedFetch, maxQuality);
};

SimpleFetcher.prototype.reconnect = function reconnect() {
    this._ensureReady();
    if (!this._fetcherMethods.reconnect) {
        throw 'SimpleFetcher error: reconnect is not implemented';
    }
    this._fetcherMethods.reconnect();
};

// Fetcher implementation

SimpleFetcher.prototype.createImageDataContext = function createImageDataContext(
    imagePartParams) {
    
    this._ensureReady();
    var dataKeys = this._fetcherMethods.getDataKeys(imagePartParams);
    return new SimpleImageDataContext(dataKeys, imagePartParams, this._dataPublisher, this._hasher);
};

SimpleFetcher.prototype.fetch = function fetch(imageDataContext) {
	var maxQuality = imageDataContext.getMaxQuality();
	var self = this;
	
	function dataCallback(dataKey, data, isFetchEnded) {
		var key = {
			dataKey: dataKey,
			maxQuality: maxQuality
		};
		self._dataPublisher.publish(key, data, isFetchEnded);
	}
	
	function queryIsKeyNeedFetch(dataKey) {
		var key = {
			dataKey: dataKey,
			maxQuality: maxQuality
		};
		return self._dataPublisher.isKeyNeedFetch(key);
	}
	
	return this.fetchProgressive(imageDataContext.getImagePartParams(), imageDataContext.getDataKeys(), dataCallback, queryIsKeyNeedFetch, maxQuality);
};

SimpleFetcher.prototype.startMovableFetch = function startMovableFetch(imageDataContext, movableFetchState) {
	movableFetchState.fetchHandle = this.fetch(imageDataContext);
};

SimpleFetcher.prototype.moveFetch = function moveFetch(imageDataContext, movableFetchState) {
	movableFetchState.fetchHandle.abortAsync();
	movableFetchState.fetchHandle = this.fetch(imageDataContext);
};

SimpleFetcher.prototype.close = function close(closedCallback) {
    this._ensureReady();
    this._isReady = false;
    return new Promise(function(resolve, reject) {
        // NOTE: Wait for all fetchHandles to finish?
        resolve();
    });
};

SimpleFetcher.prototype._ensureReady = function ensureReady() {
    if (!this._isReady) {
        throw 'SimpleFetcher error: fetch client is not opened';
    }
};

},{"datapublisher.js":24,"simpleimagedatacontext.js":26,"simplenonprogressivefetchhandle.js":27}],26:[function(require,module,exports){
'use strict';

module.exports = SimpleImageDataContext;

var HashMap = require('hashmap.js');

function SimpleImageDataContext(dataKeys, imagePartParams, dataPublisher, hasher) {
    this._dataByKey = new HashMap(hasher);
    this._dataToReturn = {
        imagePartParams: JSON.parse(JSON.stringify(imagePartParams)),
        fetchedItems: []
    };
	this._maxQuality = imagePartParams.quality;
    this._fetchEndedCount = 0;
	this._fetchedLowQualityCount = 0;
    this._dataListeners = [];
    this._dataKeys = dataKeys;
    this._imagePartParams = imagePartParams;
    this._dataPublisher = dataPublisher;
	this._isProgressive = false;
	this._isDisposed = false;
    
    this._subscribeHandles = [];
    
    var dataFetchedBound = this._dataFetched.bind(this);
    for (var i = 0; i < dataKeys.length; ++i) {
        var subscribeHandle = this._dataPublisher.subscribe(
			{ dataKey: dataKeys[i], maxQuality: this._maxQuality },
			dataFetchedBound);
        
        this._subscribeHandles.push(subscribeHandle);
    }
}

// Not part of ImageDataContext interface, only service for SimpleFetcher
SimpleImageDataContext.prototype.getMaxQuality = function getMaxQuality() {
	return this._maxQuality;
};

SimpleImageDataContext.prototype.getDataKeys = function getDataKeys() {
    return this._dataKeys;
};

SimpleImageDataContext.prototype.getImagePartParams = function getImagePartParams() {
    return this._imagePartParams;
};

SimpleImageDataContext.prototype.hasData = function hasData() {
    return this._fetchedLowQualityCount == this._dataKeys.length;
};

SimpleImageDataContext.prototype.getFetchedData = function getFetchedData() {
    if (!this.hasData()) {
        throw 'SimpleImageDataContext error: cannot call getFetchedData before hasData = true';
    }
    
    return this._dataToReturn;
};

SimpleImageDataContext.prototype.on = function on(event, listener) {
	if (this._isDisposed) {
		throw 'Cannot register to event on disposed ImageDataContext';
	}
    if (event !== 'data') {
        throw 'SimpleImageDataContext error: Unexpected event ' + event;
    }
    
    this._dataListeners.push(listener);
};

SimpleImageDataContext.prototype.isDone = function isDone() {
    return this._fetchEndedCount === this._dataKeys.length;
};

SimpleImageDataContext.prototype.dispose = function dispose() {
	this._isDisposed = true;
    for (var i = 0; i < this._subscribeHandles.length; ++i) {
        this._dataPublisher.unsubscribe(this._subscribeHandles[i]);
    }
    
    this._subscribeHandles = [];
	this._dataListeners = [];
};

SimpleImageDataContext.prototype.setIsProgressive = function setIsProgressive(isProgressive) {
	var oldIsProgressive = this._isProgressive;
    this._isProgressive = isProgressive;
	if (!oldIsProgressive && isProgressive && this.hasData()) {
		for (var i = 0; i < this._dataListeners.length; ++i) {
            this._dataListeners[i](this);
        }
	}
};

SimpleImageDataContext.prototype._dataFetched = function dataFetched(key, data, fetchEnded) {
	if (this._isDisposed) {
		throw 'Unexpected dataFetched listener call on disposed ImageDataContext';
	}

	var self = this;
	var added = this._dataByKey.tryAdd(key, function() {
		// Executed if new item
        self._dataToReturn.fetchedItems.push({
            key: key.dataKey,
            data: data
        });
		++self._fetchedLowQualityCount;
		return {
			fetchEnded: false,
			fetchedItemsOffset: self._dataToReturn.fetchedItems.length - 1
		};
	});
	
    if (added.value.fetchEnded) {
		// Already fetched full quality, nothing to refresh
		return;
	}
	
	this._dataToReturn.fetchedItems[added.value.fetchedItemsOffset].data = data;
	if (fetchEnded)
	{
		added.value.fetchEnded = true;
        ++this._fetchEndedCount;
    }
    
    if (this.isDone() || (this.hasData() && this._isProgressive)) {
        for (var i = 0; i < this._dataListeners.length; ++i) {
            this._dataListeners[i](this);
        }
    }
};
},{"hashmap.js":11}],27:[function(require,module,exports){
'use strict';

module.exports = SimpleNonProgressiveFetchHandle;

/* global Promise: false */

function SimpleNonProgressiveFetchHandle(fetchMethods, dataCallback, queryIsKeyNeedFetch, options) {
    this._fetchMethods = fetchMethods;
	this._dataCallback = dataCallback;
    this._queryIsKeyNeedFetch = queryIsKeyNeedFetch;
    this._fetchLimit = (options || {}).fetchLimitPerFetcher || 2;
    this._keysToFetch = null;
    this._nextKeyToFetch = 0;
    this._activeFetches = {};
    this._activeFetchesCount = 0;
    this._isAborted = false;
    this._isStoppedCalled = false;
    this._resolveAbort = null;
}

SimpleNonProgressiveFetchHandle.prototype.fetch = function fetch(keys) {
    if (this._keysToFetch !== null) {
        throw 'SimpleNonProgressiveFetchHandle error: Request fetcher can fetch only one region';
    }
    
    this._keysToFetch = keys;
    this._nextKeyToFetch = 0;
    while (this._activeFetchesCount < this._fetchLimit) {
        if (!this._fetchSingleKey()) {
            break;
        }
    }
};

SimpleNonProgressiveFetchHandle.prototype.abortAsync = function abortAsync() {
    var self = this;
    return new Promise(function(resolve, reject) {
        if (self._activeFetchesCount === 0) {
            resolve();
        } else {
            this._resolveAbort = resolve;
        }
    });
};

SimpleNonProgressiveFetchHandle.prototype._fetchSingleKey = function fetchSingleKey() {
    var key;
    do {
        if (this._nextKeyToFetch >= this._keysToFetch.length) {
            return false;
        }
        key = this._keysToFetch[this._nextKeyToFetch++];
    } while (!this._queryIsKeyNeedFetch(key));
    
    var self = this;
    this._activeFetches[key] = true;
    ++this._activeFetchesCount;
    
    this._fetchMethods.fetch(key)
        .then(function resolved(result) {
            self._dataCallback(key, result, /*fetchEnded=*/true);
            self._fetchEnded(null, key, result);
        }).catch(function failed(reason) {
            //self._fetchClient._onError(reason);
            self._fetchEnded(reason, key);
        });
    
    return true;
};

SimpleNonProgressiveFetchHandle.prototype._fetchEnded = function fetchEnded(error, key, result) {
    delete this._activeFetches[key];
    --this._activeFetchesCount;
    
    if (!this._resolveAbort) {
        this._fetchSingleKey();
    } else if (this._activeFetchesCount === 0) {
        this._resolveAbort();
        this._resolveAbort = null;
    }
};
},{}],28:[function(require,module,exports){
'use strict';

module.exports = SimplePixelsDecoderBase;

/* global Promise : false */
/* global ImageData : false */

function SimplePixelsDecoderBase() {
    SimplePixelsDecoderBase.prototype.decode = function decode(fetchedData) {
        var imagePartParams = fetchedData.imagePartParams;
        var width  = imagePartParams.maxXExclusive - imagePartParams.minX;
        var height = imagePartParams.maxYExclusive - imagePartParams.minY;
        var result = new ImageData(width, height);
        var promises = [];
        for (var i = 0; i < fetchedData.fetchedItems.length; ++i) {
            promises.push(this.decodeRegion(result, imagePartParams.minX, imagePartParams.minY, fetchedData.fetchedItems[i].key, fetchedData.fetchedItems[i].data));
        }
        
        return Promise.all(promises).then(function() {
            return result;
        });
    };
    
    SimplePixelsDecoderBase.prototype.decodeRegion = function decodeRegion(targetImageData, imagePartParams, key, fetchedData) {
        throw 'SimplePixelsDecoderBase error: decodeRegion is not implemented';
    };
}
},{}]},{},[21])(21)
});

