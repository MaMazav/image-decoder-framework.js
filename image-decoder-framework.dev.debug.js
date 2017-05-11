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
//# sourceMappingURL=data:application/json;charset:utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJzcmMvY2VzaXVtLWltYWdlLWRlY29kZXIvY2FudmFzLWltYWdlcnktcHJvdmlkZXIuanMiLCJzcmMvY2VzaXVtLWltYWdlLWRlY29kZXIvY2VzaXVtLWZydXN0dW0tY2FsY3VsYXRvci5qcyIsInNyYy9jZXNpdW0taW1hZ2UtZGVjb2Rlci9jZXNpdW0taW1hZ2UtZGVjb2Rlci1sYXllci1tYW5hZ2VyLmpzIiwic3JjL2Nlc2l1bS1pbWFnZS1kZWNvZGVyL2ltYWdlLWRlY29kZXItaW1hZ2VyeS1wcm92aWRlci5qcyIsInNyYy9pbWFnZS1kZWNvZGVyLWV4cG9ydHMuanMiLCJzcmMvaW1hZ2UtZGVjb2Rlci9pbWFnZS1kZWNvZGVyLWhlbHBlcnMvZGVjb2RlLWpvYi5qcyIsInNyYy9pbWFnZS1kZWNvZGVyL2ltYWdlLWRlY29kZXItaGVscGVycy9kZWNvZGUtam9icy1wb29sLmpzIiwic3JjL2ltYWdlLWRlY29kZXIvaW1hZ2UtZGVjb2Rlci1oZWxwZXJzL2ZldGNoLWNvbnRleHQtYXBpLmpzIiwic3JjL2ltYWdlLWRlY29kZXIvaW1hZ2UtZGVjb2Rlci1oZWxwZXJzL2ZldGNoLWNvbnRleHQuanMiLCJzcmMvaW1hZ2UtZGVjb2Rlci9pbWFnZS1kZWNvZGVyLWhlbHBlcnMvZmV0Y2gtbWFuYWdlci5qcyIsInNyYy9pbWFnZS1kZWNvZGVyL2ltYWdlLWRlY29kZXItaGVscGVycy9mZXRjaGVyLWNsb3Nlci5qcyIsInNyYy9pbWFnZS1kZWNvZGVyL2ltYWdlLWRlY29kZXItaGVscGVycy9mcnVzdHVtLXJlcXVlc3RzLXByaW9yaXRpemVyLmpzIiwic3JjL2ltYWdlLWRlY29kZXIvaW1hZ2UtZGVjb2Rlci1oZWxwZXJzL2ltYWdlLWhlbHBlci1mdW5jdGlvbnMuanMiLCJzcmMvaW1hZ2UtZGVjb2Rlci9pbWFnZS1kZWNvZGVyLWhlbHBlcnMvbGlua2VkLWxpc3QuanMiLCJzcmMvaW1hZ2UtZGVjb2Rlci9pbWFnZS1kZWNvZGVyLWhlbHBlcnMvc2ltcGxlLW1vdmFibGUtZmV0Y2guanMiLCJzcmMvaW1hZ2UtZGVjb2Rlci9pbWFnZS1kZWNvZGVyLXZpZXdlci5qcyIsInNyYy9pbWFnZS1kZWNvZGVyL2ltYWdlLWRlY29kZXItd29ya2Vycy9pbWFnZS1wYXJhbXMtcmV0cmlldmVyLXByb3h5LmpzIiwic3JjL2ltYWdlLWRlY29kZXIvaW1hZ2UtZGVjb2Rlci13b3JrZXJzL3dvcmtlci1wcm94eS1mZXRjaC1tYW5hZ2VyLmpzIiwic3JjL2ltYWdlLWRlY29kZXIvaW1hZ2UtZGVjb2Rlci13b3JrZXJzL3dvcmtlci1wcm94eS1pbWFnZS1kZWNvZGVyLmpzIiwic3JjL2ltYWdlLWRlY29kZXIvaW1hZ2UtZGVjb2Rlci5qcyIsInNyYy9sZWFmbGV0LWltYWdlLWRlY29kZXIvaW1hZ2UtZGVjb2Rlci1yZWdpb24tbGF5ZXIuanMiLCJzcmMvbGVhZmxldC1pbWFnZS1kZWNvZGVyL2xlYWZsZXQtZnJ1c3R1bS1jYWxjdWxhdG9yLmpzIiwic3JjL3NpbXBsZS1mZXRjaGVyL2dyaWQtZGVjb2Rlci13b3JrZXItYmFzZS5qcyIsInNyYy9zaW1wbGUtZmV0Y2hlci9ncmlkLWZldGNoZXItYmFzZS5qcyIsInNyYy9zaW1wbGUtZmV0Y2hlci9ncmlkLWltYWdlLWJhc2UuanMiLCJzcmMvc2ltcGxlLWZldGNoZXIvZ3JpZC1sZXZlbC1jYWxjdWxhdG9yLmpzIiwic3JjL3NpbXBsZS1mZXRjaGVyL3NpbXBsZS1mZXRjaGVyLWJhc2UuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7QUNBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdFVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzFGQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2pKQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMva0JBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2xCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDcEVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3RKQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMxQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3pVQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdE9BO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3ZDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3pLQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM3UkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMzRkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN6S0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdG5CQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNqRkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3hEQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDeklBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2xXQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQy9LQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ25CQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2pEQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3JPQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDL0lBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzNCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EiLCJmaWxlIjoiZ2VuZXJhdGVkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXNDb250ZW50IjpbIihmdW5jdGlvbiBlKHQsbixyKXtmdW5jdGlvbiBzKG8sdSl7aWYoIW5bb10pe2lmKCF0W29dKXt2YXIgYT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2lmKCF1JiZhKXJldHVybiBhKG8sITApO2lmKGkpcmV0dXJuIGkobywhMCk7dmFyIGY9bmV3IEVycm9yKFwiQ2Fubm90IGZpbmQgbW9kdWxlICdcIitvK1wiJ1wiKTt0aHJvdyBmLmNvZGU9XCJNT0RVTEVfTk9UX0ZPVU5EXCIsZn12YXIgbD1uW29dPXtleHBvcnRzOnt9fTt0W29dWzBdLmNhbGwobC5leHBvcnRzLGZ1bmN0aW9uKGUpe3ZhciBuPXRbb11bMV1bZV07cmV0dXJuIHMobj9uOmUpfSxsLGwuZXhwb3J0cyxlLHQsbixyKX1yZXR1cm4gbltvXS5leHBvcnRzfXZhciBpPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7Zm9yKHZhciBvPTA7bzxyLmxlbmd0aDtvKyspcyhyW29dKTtyZXR1cm4gc30pIiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBDYW52YXNJbWFnZXJ5UHJvdmlkZXI7XHJcblxyXG4vKiBnbG9iYWwgQ2VzaXVtOiBmYWxzZSAqL1xyXG4vKiBnbG9iYWwgRGV2ZWxvcGVyRXJyb3I6IGZhbHNlICovXHJcbi8qIGdsb2JhbCBDcmVkaXQ6IGZhbHNlICovXHJcblxyXG4vKipcclxuICogUHJvdmlkZXMgYSBTaW5nbGUgQ2FudmFzIGltYWdlcnkgdGlsZS4gIFRoZSBpbWFnZSBpcyBhc3N1bWVkIHRvIHVzZSBhXHJcbiAqIHtAbGluayBHZW9ncmFwaGljVGlsaW5nU2NoZW1lfS5cclxuICpcclxuICogQGFsaWFzIENhbnZhc0ltYWdlcnlQcm92aWRlclxyXG4gKiBAY29uc3RydWN0b3JcclxuICpcclxuICogQHBhcmFtIHtjYW52YXN9IENhbnZhcyBmb3IgdGhlIHRpbGUuXHJcbiAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zIE9iamVjdCB3aXRoIHRoZSBmb2xsb3dpbmcgcHJvcGVydGllczpcclxuICogQHBhcmFtIHtDcmVkaXR8U3RyaW5nfSBbb3B0aW9ucy5jcmVkaXRdIEEgY3JlZGl0IGZvciB0aGUgZGF0YSBzb3VyY2UsIHdoaWNoIGlzIGRpc3BsYXllZCBvbiB0aGUgY2FudmFzLlxyXG4gKlxyXG4gKiBAc2VlIEFyY0dpc01hcFNlcnZlckltYWdlcnlQcm92aWRlclxyXG4gKiBAc2VlIEJpbmdNYXBzSW1hZ2VyeVByb3ZpZGVyXHJcbiAqIEBzZWUgR29vZ2xlRWFydGhJbWFnZXJ5UHJvdmlkZXJcclxuICogQHNlZSBPcGVuU3RyZWV0TWFwSW1hZ2VyeVByb3ZpZGVyXHJcbiAqIEBzZWUgVGlsZU1hcFNlcnZpY2VJbWFnZXJ5UHJvdmlkZXJcclxuICogQHNlZSBXZWJNYXBTZXJ2aWNlSW1hZ2VyeVByb3ZpZGVyXHJcbiAqL1xyXG5mdW5jdGlvbiBDYW52YXNJbWFnZXJ5UHJvdmlkZXIoY2FudmFzLCBvcHRpb25zKSB7XHJcbiAgICBpZiAob3B0aW9ucyA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgb3B0aW9ucyA9IHt9O1xyXG4gICAgfVxyXG5cclxuICAgIC8vPj5pbmNsdWRlU3RhcnQoJ2RlYnVnJywgcHJhZ21hcy5kZWJ1Zyk7XHJcbiAgICBpZiAoY2FudmFzID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICB0aHJvdyBuZXcgRGV2ZWxvcGVyRXJyb3IoJ2NhbnZhcyBpcyByZXF1aXJlZC4nKTtcclxuICAgIH1cclxuICAgIC8vPj5pbmNsdWRlRW5kKCdkZWJ1ZycpO1xyXG5cclxuICAgIHRoaXMuX2NhbnZhcyA9IGNhbnZhcztcclxuXHJcbiAgICB0aGlzLl9lcnJvckV2ZW50ID0gbmV3IEV2ZW50KCdDYW52YXNJbWFnZXJ5UHJvdmlkZXJTdGF0dXMnKTtcclxuXHJcbiAgICB0aGlzLl9yZWFkeSA9IGZhbHNlO1xyXG5cclxuICAgIHZhciBjcmVkaXQgPSBvcHRpb25zLmNyZWRpdDtcclxuICAgIGlmICh0eXBlb2YgY3JlZGl0ID09PSAnc3RyaW5nJykge1xyXG4gICAgICAgIGNyZWRpdCA9IG5ldyBDcmVkaXQoY3JlZGl0KTtcclxuICAgIH1cclxuICAgIHRoaXMuX2NyZWRpdCA9IGNyZWRpdDtcclxufVxyXG5cclxuQ2FudmFzSW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZSA9IHtcclxuICAgIC8qKlxyXG4gICAgICogR2V0cyB0aGUgd2lkdGggb2YgZWFjaCB0aWxlLCBpbiBwaXhlbHMuIFRoaXMgZnVuY3Rpb24gc2hvdWxkXHJcbiAgICAgKiBub3QgYmUgY2FsbGVkIGJlZm9yZSB7QGxpbmsgQ2FudmFzSW1hZ2VyeVByb3ZpZGVyI3JlYWR5fSByZXR1cm5zIHRydWUuXHJcbiAgICAgKiBAbWVtYmVyb2YgQ2FudmFzSW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZVxyXG4gICAgICogQHR5cGUge051bWJlcn1cclxuICAgICAqIEByZWFkb25seVxyXG4gICAgICovXHJcbiAgICBnZXQgdGlsZVdpZHRoKCkge1xyXG4gICAgICAgICAgICAvLz4+aW5jbHVkZVN0YXJ0KCdkZWJ1ZycsIHByYWdtYXMuZGVidWcpO1xyXG4gICAgICAgICAgICBpZiAoIXRoaXMuX3JlYWR5KSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IERldmVsb3BlckVycm9yKCd0aWxlV2lkdGggbXVzdCBub3QgYmUgY2FsbGVkIGJlZm9yZSB0aGUgaW1hZ2VyeSBwcm92aWRlciBpcyByZWFkeS4nKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAvLz4+aW5jbHVkZUVuZCgnZGVidWcnKTtcclxuXHJcbiAgICAgICAgICAgIHJldHVybiB0aGlzLl9jYW52YXMud2lkdGg7XHJcbiAgICB9LFxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2V0cyB0aGUgaGVpZ2h0IG9mIGVhY2ggdGlsZSwgaW4gcGl4ZWxzLiAgVGhpcyBmdW5jdGlvbiBzaG91bGRcclxuICAgICAqIG5vdCBiZSBjYWxsZWQgYmVmb3JlIHtAbGluayBDYW52YXNJbWFnZXJ5UHJvdmlkZXIjcmVhZHl9IHJldHVybnMgdHJ1ZS5cclxuICAgICAqIEBtZW1iZXJvZiBDYW52YXNJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlXHJcbiAgICAgKiBAdHlwZSB7TnVtYmVyfVxyXG4gICAgICogQHJlYWRvbmx5XHJcbiAgICAgKi9cclxuICAgIGdldCB0aWxlSGVpZ2h0KCkge1xyXG4gICAgICAgICAgICAvLz4+aW5jbHVkZVN0YXJ0KCdkZWJ1ZycsIHByYWdtYXMuZGVidWcpO1xyXG4gICAgICAgICAgICBpZiAoIXRoaXMuX3JlYWR5KSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IERldmVsb3BlckVycm9yKCd0aWxlSGVpZ2h0IG11c3Qgbm90IGJlIGNhbGxlZCBiZWZvcmUgdGhlIGltYWdlcnkgcHJvdmlkZXIgaXMgcmVhZHkuJyk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgLy8+PmluY2x1ZGVFbmQoJ2RlYnVnJyk7XHJcblxyXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5fY2FudmFzLmhlaWdodDtcclxuICAgIH0sXHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZXRzIHRoZSBtYXhpbXVtIGxldmVsLW9mLWRldGFpbCB0aGF0IGNhbiBiZSByZXF1ZXN0ZWQuICBUaGlzIGZ1bmN0aW9uIHNob3VsZFxyXG4gICAgICogbm90IGJlIGNhbGxlZCBiZWZvcmUge0BsaW5rIENhbnZhc0ltYWdlcnlQcm92aWRlciNyZWFkeX0gcmV0dXJucyB0cnVlLlxyXG4gICAgICogQG1lbWJlcm9mIENhbnZhc0ltYWdlcnlQcm92aWRlci5wcm90b3R5cGVcclxuICAgICAqIEB0eXBlIHtOdW1iZXJ9XHJcbiAgICAgKiBAcmVhZG9ubHlcclxuICAgICAqL1xyXG4gICAgZ2V0IG1heGltdW1MZXZlbCgpIHtcclxuICAgICAgICAgICAgLy8+PmluY2x1ZGVTdGFydCgnZGVidWcnLCBwcmFnbWFzLmRlYnVnKTtcclxuICAgICAgICAgICAgaWYgKCF0aGlzLl9yZWFkeSkge1xyXG4gICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBEZXZlbG9wZXJFcnJvcignbWF4aW11bUxldmVsIG11c3Qgbm90IGJlIGNhbGxlZCBiZWZvcmUgdGhlIGltYWdlcnkgcHJvdmlkZXIgaXMgcmVhZHkuJyk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgLy8+PmluY2x1ZGVFbmQoJ2RlYnVnJyk7XHJcblxyXG4gICAgICAgICAgICByZXR1cm4gMDtcclxuICAgIH0sXHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZXRzIHRoZSBtaW5pbXVtIGxldmVsLW9mLWRldGFpbCB0aGF0IGNhbiBiZSByZXF1ZXN0ZWQuICBUaGlzIGZ1bmN0aW9uIHNob3VsZFxyXG4gICAgICogbm90IGJlIGNhbGxlZCBiZWZvcmUge0BsaW5rIENhbnZhc0ltYWdlcnlQcm92aWRlciNyZWFkeX0gcmV0dXJucyB0cnVlLlxyXG4gICAgICogQG1lbWJlcm9mIENhbnZhc0ltYWdlcnlQcm92aWRlci5wcm90b3R5cGVcclxuICAgICAqIEB0eXBlIHtOdW1iZXJ9XHJcbiAgICAgKiBAcmVhZG9ubHlcclxuICAgICAqL1xyXG4gICAgZ2V0IG1pbmltdW1MZXZlbCgpIHtcclxuICAgICAgICAgICAgLy8+PmluY2x1ZGVTdGFydCgnZGVidWcnLCBwcmFnbWFzLmRlYnVnKTtcclxuICAgICAgICAgICAgaWYgKCF0aGlzLl9yZWFkeSkge1xyXG4gICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBEZXZlbG9wZXJFcnJvcignbWluaW11bUxldmVsIG11c3Qgbm90IGJlIGNhbGxlZCBiZWZvcmUgdGhlIGltYWdlcnkgcHJvdmlkZXIgaXMgcmVhZHkuJyk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgLy8+PmluY2x1ZGVFbmQoJ2RlYnVnJyk7XHJcblxyXG4gICAgICAgICAgICByZXR1cm4gMDtcclxuICAgIH0sXHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZXRzIHRoZSB0aWxpbmcgc2NoZW1lIHVzZWQgYnkgdGhpcyBwcm92aWRlci4gIFRoaXMgZnVuY3Rpb24gc2hvdWxkXHJcbiAgICAgKiBub3QgYmUgY2FsbGVkIGJlZm9yZSB7QGxpbmsgQ2FudmFzSW1hZ2VyeVByb3ZpZGVyI3JlYWR5fSByZXR1cm5zIHRydWUuXHJcbiAgICAgKiBAbWVtYmVyb2YgQ2FudmFzSW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZVxyXG4gICAgICogQHR5cGUge1RpbGluZ1NjaGVtZX1cclxuICAgICAqIEByZWFkb25seVxyXG4gICAgICovXHJcbiAgICBnZXQgdGlsaW5nU2NoZW1lKCkge1xyXG4gICAgICAgICAgICAvLz4+aW5jbHVkZVN0YXJ0KCdkZWJ1ZycsIHByYWdtYXMuZGVidWcpO1xyXG4gICAgICAgICAgICBpZiAoIXRoaXMuX3JlYWR5KSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IERldmVsb3BlckVycm9yKCd0aWxpbmdTY2hlbWUgbXVzdCBub3QgYmUgY2FsbGVkIGJlZm9yZSB0aGUgaW1hZ2VyeSBwcm92aWRlciBpcyByZWFkeS4nKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAvLz4+aW5jbHVkZUVuZCgnZGVidWcnKTtcclxuXHJcbiAgICAgICAgICAgIHJldHVybiB0aGlzLl90aWxpbmdTY2hlbWU7XHJcbiAgICB9LFxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2V0cyB0aGUgcmVjdGFuZ2xlLCBpbiByYWRpYW5zLCBvZiB0aGUgaW1hZ2VyeSBwcm92aWRlZCBieSB0aGlzIGluc3RhbmNlLiAgVGhpcyBmdW5jdGlvbiBzaG91bGRcclxuICAgICAqIG5vdCBiZSBjYWxsZWQgYmVmb3JlIHtAbGluayBDYW52YXNJbWFnZXJ5UHJvdmlkZXIjcmVhZHl9IHJldHVybnMgdHJ1ZS5cclxuICAgICAqIEBtZW1iZXJvZiBDYW52YXNJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlXHJcbiAgICAgKiBAdHlwZSB7UmVjdGFuZ2xlfVxyXG4gICAgICogQHJlYWRvbmx5XHJcbiAgICAgKi9cclxuICAgIGdldCByZWN0YW5nbGUoKSB7XHJcbiAgICAgICAgICAgIHJldHVybiB0aGlzLl90aWxpbmdTY2hlbWUucmVjdGFuZ2xlO1xyXG4gICAgfSxcclxuXHJcbiAgICAvKipcclxuICAgICAqIEdldHMgdGhlIHRpbGUgZGlzY2FyZCBwb2xpY3kuICBJZiBub3QgdW5kZWZpbmVkLCB0aGUgZGlzY2FyZCBwb2xpY3kgaXMgcmVzcG9uc2libGVcclxuICAgICAqIGZvciBmaWx0ZXJpbmcgb3V0IFwibWlzc2luZ1wiIHRpbGVzIHZpYSBpdHMgc2hvdWxkRGlzY2FyZEltYWdlIGZ1bmN0aW9uLiAgSWYgdGhpcyBmdW5jdGlvblxyXG4gICAgICogcmV0dXJucyB1bmRlZmluZWQsIG5vIHRpbGVzIGFyZSBmaWx0ZXJlZC4gIFRoaXMgZnVuY3Rpb24gc2hvdWxkXHJcbiAgICAgKiBub3QgYmUgY2FsbGVkIGJlZm9yZSB7QGxpbmsgQ2FudmFzSW1hZ2VyeVByb3ZpZGVyI3JlYWR5fSByZXR1cm5zIHRydWUuXHJcbiAgICAgKiBAbWVtYmVyb2YgQ2FudmFzSW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZVxyXG4gICAgICogQHR5cGUge1RpbGVEaXNjYXJkUG9saWN5fVxyXG4gICAgICogQHJlYWRvbmx5XHJcbiAgICAgKi9cclxuICAgIGdldCB0aWxlRGlzY2FyZFBvbGljeSgpIHtcclxuICAgICAgICAgICAgLy8+PmluY2x1ZGVTdGFydCgnZGVidWcnLCBwcmFnbWFzLmRlYnVnKTtcclxuICAgICAgICAgICAgaWYgKCF0aGlzLl9yZWFkeSkge1xyXG4gICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBEZXZlbG9wZXJFcnJvcigndGlsZURpc2NhcmRQb2xpY3kgbXVzdCBub3QgYmUgY2FsbGVkIGJlZm9yZSB0aGUgaW1hZ2VyeSBwcm92aWRlciBpcyByZWFkeS4nKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAvLz4+aW5jbHVkZUVuZCgnZGVidWcnKTtcclxuXHJcbiAgICAgICAgICAgIHJldHVybiB1bmRlZmluZWQ7XHJcbiAgICB9LFxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2V0cyBhbiBldmVudCB0aGF0IGlzIHJhaXNlZCB3aGVuIHRoZSBpbWFnZXJ5IHByb3ZpZGVyIGVuY291bnRlcnMgYW4gYXN5bmNocm9ub3VzIGVycm9yLiAgQnkgc3Vic2NyaWJpbmdcclxuICAgICAqIHRvIHRoZSBldmVudCwgeW91IHdpbGwgYmUgbm90aWZpZWQgb2YgdGhlIGVycm9yIGFuZCBjYW4gcG90ZW50aWFsbHkgcmVjb3ZlciBmcm9tIGl0LiAgRXZlbnQgbGlzdGVuZXJzXHJcbiAgICAgKiBhcmUgcGFzc2VkIGFuIGluc3RhbmNlIG9mIHtAbGluayBUaWxlUHJvdmlkZXJFcnJvcn0uXHJcbiAgICAgKiBAbWVtYmVyb2YgQ2FudmFzSW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZVxyXG4gICAgICogQHR5cGUge0V2ZW50fVxyXG4gICAgICogQHJlYWRvbmx5XHJcbiAgICAgKi9cclxuICAgIGdldCBlcnJvckV2ZW50KCkge1xyXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5fZXJyb3JFdmVudDtcclxuICAgIH0sXHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZXRzIGEgdmFsdWUgaW5kaWNhdGluZyB3aGV0aGVyIG9yIG5vdCB0aGUgcHJvdmlkZXIgaXMgcmVhZHkgZm9yIHVzZS5cclxuICAgICAqIEBtZW1iZXJvZiBDYW52YXNJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlXHJcbiAgICAgKiBAdHlwZSB7Qm9vbGVhbn1cclxuICAgICAqIEByZWFkb25seVxyXG4gICAgICovXHJcbiAgICBnZXQgcmVhZHkoKSB7XHJcbiAgICAgICAgICAgIHJldHVybiB0aGlzLl9yZWFkeTtcclxuICAgIH0sXHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZXRzIHRoZSBjcmVkaXQgdG8gZGlzcGxheSB3aGVuIHRoaXMgaW1hZ2VyeSBwcm92aWRlciBpcyBhY3RpdmUuICBUeXBpY2FsbHkgdGhpcyBpcyB1c2VkIHRvIGNyZWRpdFxyXG4gICAgICogdGhlIHNvdXJjZSBvZiB0aGUgaW1hZ2VyeS4gIFRoaXMgZnVuY3Rpb24gc2hvdWxkIG5vdCBiZSBjYWxsZWQgYmVmb3JlIHtAbGluayBDYW52YXNJbWFnZXJ5UHJvdmlkZXIjcmVhZHl9IHJldHVybnMgdHJ1ZS5cclxuICAgICAqIEBtZW1iZXJvZiBDYW52YXNJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlXHJcbiAgICAgKiBAdHlwZSB7Q3JlZGl0fVxyXG4gICAgICogQHJlYWRvbmx5XHJcbiAgICAgKi9cclxuICAgIGdldCBjcmVkaXQoKSB7XHJcbiAgICAgICAgICAgIHJldHVybiB0aGlzLl9jcmVkaXQ7XHJcbiAgICB9LFxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2V0cyBhIHZhbHVlIGluZGljYXRpbmcgd2hldGhlciBvciBub3QgdGhlIGltYWdlcyBwcm92aWRlZCBieSB0aGlzIGltYWdlcnkgcHJvdmlkZXJcclxuICAgICAqIGluY2x1ZGUgYW4gYWxwaGEgY2hhbm5lbC4gIElmIHRoaXMgcHJvcGVydHkgaXMgZmFsc2UsIGFuIGFscGhhIGNoYW5uZWwsIGlmIHByZXNlbnQsIHdpbGxcclxuICAgICAqIGJlIGlnbm9yZWQuICBJZiB0aGlzIHByb3BlcnR5IGlzIHRydWUsIGFueSBpbWFnZXMgd2l0aG91dCBhbiBhbHBoYSBjaGFubmVsIHdpbGwgYmUgdHJlYXRlZFxyXG4gICAgICogYXMgaWYgdGhlaXIgYWxwaGEgaXMgMS4wIGV2ZXJ5d2hlcmUuICBXaGVuIHRoaXMgcHJvcGVydHkgaXMgZmFsc2UsIG1lbW9yeSB1c2FnZVxyXG4gICAgICogYW5kIHRleHR1cmUgdXBsb2FkIHRpbWUgYXJlIHJlZHVjZWQuXHJcbiAgICAgKiBAbWVtYmVyb2YgQ2FudmFzSW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZVxyXG4gICAgICogQHR5cGUge0Jvb2xlYW59XHJcbiAgICAgKiBAcmVhZG9ubHlcclxuICAgICAqL1xyXG4gICAgZ2V0IGhhc0FscGhhQ2hhbm5lbCgpIHtcclxuICAgICAgICAgICAgcmV0dXJuIHRydWU7XHJcbiAgICB9XHJcbn07XHJcblxyXG5DYW52YXNJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlLnNldFJlY3RhbmdsZSA9IGZ1bmN0aW9uIHNldFJlY3RhbmdsZShyZWN0YW5nbGUpIHtcclxuICAgIFxyXG4gICAgdGhpcy5fdGlsaW5nU2NoZW1lID0gbmV3IENlc2l1bS5HZW9ncmFwaGljVGlsaW5nU2NoZW1lKHtcclxuICAgICAgICByZWN0YW5nbGU6IHJlY3RhbmdsZSxcclxuICAgICAgICBudW1iZXJPZkxldmVsWmVyb1RpbGVzWDogMSxcclxuICAgICAgICBudW1iZXJPZkxldmVsWmVyb1RpbGVzWTogMVxyXG4gICAgfSk7XHJcbiAgICBcclxuICAgIGlmICghdGhpcy5fcmVhZHkpIHtcclxuICAgICAgICB0aGlzLl9yZWFkeSA9IHRydWU7XHJcbiAgICAgICAgQ2VzaXVtLlRpbGVQcm92aWRlckVycm9yLmhhbmRsZVN1Y2Nlc3ModGhpcy5fZXJyb3JFdmVudCk7XHJcbiAgICB9XHJcbn07XHJcblxyXG5DYW52YXNJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlLmdldFRpbGVXaWR0aCA9IGZ1bmN0aW9uIGdldFRpbGVXaWR0aCgpIHtcclxuICAgIHJldHVybiB0aGlzLnRpbGVXaWR0aDtcclxufTtcclxuXHJcbkNhbnZhc0ltYWdlcnlQcm92aWRlci5wcm90b3R5cGUuZ2V0VGlsZUhlaWdodCA9IGZ1bmN0aW9uIGdldFRpbGVIZWlnaHQoKSB7XHJcbiAgICByZXR1cm4gdGhpcy50aWxlSGVpZ2h0O1xyXG59O1xyXG5cclxuQ2FudmFzSW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5nZXRNYXhpbXVtTGV2ZWwgPSBmdW5jdGlvbiBnZXRNYXhpbXVtTGV2ZWwoKSB7XHJcbiAgICByZXR1cm4gdGhpcy5tYXhpbXVtTGV2ZWw7XHJcbn07XHJcblxyXG5DYW52YXNJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlLmdldE1pbmltdW1MZXZlbCA9IGZ1bmN0aW9uIGdldE1pbmltdW1MZXZlbCgpIHtcclxuICAgIHJldHVybiB0aGlzLm1pbmltdW1MZXZlbDtcclxufTtcclxuXHJcbkNhbnZhc0ltYWdlcnlQcm92aWRlci5wcm90b3R5cGUuaXNSZWFkeSA9IGZ1bmN0aW9uIGlzUmVhZHkoKSB7XHJcbiAgICByZXR1cm4gdGhpcy5yZWFkeTtcclxufTtcclxuXHJcbkNhbnZhc0ltYWdlcnlQcm92aWRlci5wcm90b3R5cGUuZ2V0Q3JlZGl0ID0gZnVuY3Rpb24gZ2V0Q3JlZGl0KCkge1xyXG4gICAgcmV0dXJuIHRoaXMuY3JlZGl0O1xyXG59O1xyXG5cclxuQ2FudmFzSW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5nZXRSZWN0YW5nbGUgPSBmdW5jdGlvbiBnZXRSZWN0YW5nbGUoKSB7XHJcbiAgICByZXR1cm4gdGhpcy50aWxpbmdTY2hlbWUucmVjdGFuZ2xlO1xyXG59O1xyXG5cclxuQ2FudmFzSW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5nZXRUaWxpbmdTY2hlbWUgPSBmdW5jdGlvbiBnZXRUaWxpbmdTY2hlbWUoKSB7XHJcbiAgICByZXR1cm4gdGhpcy50aWxpbmdTY2hlbWU7XHJcbn07XHJcblxyXG5DYW52YXNJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlLmdldFRpbGVEaXNjYXJkUG9saWN5ID0gZnVuY3Rpb24gZ2V0VGlsZURpc2NhcmRQb2xpY3koKSB7XHJcbiAgICByZXR1cm4gdGhpcy50aWxlRGlzY2FyZFBvbGljeTtcclxufTtcclxuXHJcbkNhbnZhc0ltYWdlcnlQcm92aWRlci5wcm90b3R5cGUuZ2V0RXJyb3JFdmVudCA9IGZ1bmN0aW9uIGdldEVycm9yRXZlbnQoKSB7XHJcbiAgICByZXR1cm4gdGhpcy5lcnJvckV2ZW50O1xyXG59O1xyXG5cclxuQ2FudmFzSW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5nZXRIYXNBbHBoYUNoYW5uZWwgPSBmdW5jdGlvbiBnZXRIYXNBbHBoYUNoYW5uZWwoKSB7XHJcbiAgICByZXR1cm4gdGhpcy5oYXNBbHBoYUNoYW5uZWw7XHJcbn07XHJcblxyXG4vKipcclxuICogR2V0cyB0aGUgY3JlZGl0cyB0byBiZSBkaXNwbGF5ZWQgd2hlbiBhIGdpdmVuIHRpbGUgaXMgZGlzcGxheWVkLlxyXG4gKlxyXG4gKiBAcGFyYW0ge051bWJlcn0geCBUaGUgdGlsZSBYIGNvb3JkaW5hdGUuXHJcbiAqIEBwYXJhbSB7TnVtYmVyfSB5IFRoZSB0aWxlIFkgY29vcmRpbmF0ZS5cclxuICogQHBhcmFtIHtOdW1iZXJ9IGxldmVsIFRoZSB0aWxlIGxldmVsO1xyXG4gKiBAcmV0dXJucyB7Q3JlZGl0W119IFRoZSBjcmVkaXRzIHRvIGJlIGRpc3BsYXllZCB3aGVuIHRoZSB0aWxlIGlzIGRpc3BsYXllZC5cclxuICpcclxuICogQGV4Y2VwdGlvbiB7RGV2ZWxvcGVyRXJyb3J9IDxjb2RlPmdldFRpbGVDcmVkaXRzPC9jb2RlPiBtdXN0IG5vdCBiZSBjYWxsZWQgYmVmb3JlIHRoZSBpbWFnZXJ5IHByb3ZpZGVyIGlzIHJlYWR5LlxyXG4gKi9cclxuQ2FudmFzSW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5nZXRUaWxlQ3JlZGl0cyA9IGZ1bmN0aW9uKHgsIHksIGxldmVsKSB7XHJcbiAgICByZXR1cm4gdW5kZWZpbmVkO1xyXG59O1xyXG5cclxuLyoqXHJcbiAqIFJlcXVlc3RzIHRoZSBpbWFnZSBmb3IgYSBnaXZlbiB0aWxlLiAgVGhpcyBmdW5jdGlvbiBzaG91bGRcclxuICogbm90IGJlIGNhbGxlZCBiZWZvcmUge0BsaW5rIENhbnZhc0ltYWdlcnlQcm92aWRlciNyZWFkeX0gcmV0dXJucyB0cnVlLlxyXG4gKlxyXG4gKiBAcGFyYW0ge051bWJlcn0geCBUaGUgdGlsZSBYIGNvb3JkaW5hdGUuXHJcbiAqIEBwYXJhbSB7TnVtYmVyfSB5IFRoZSB0aWxlIFkgY29vcmRpbmF0ZS5cclxuICogQHBhcmFtIHtOdW1iZXJ9IGxldmVsIFRoZSB0aWxlIGxldmVsLlxyXG4gKiBAcmV0dXJucyB7UHJvbWlzZX0gQSBwcm9taXNlIGZvciB0aGUgaW1hZ2UgdGhhdCB3aWxsIHJlc29sdmUgd2hlbiB0aGUgaW1hZ2UgaXMgYXZhaWxhYmxlLCBvclxyXG4gKiAgICAgICAgICB1bmRlZmluZWQgaWYgdGhlcmUgYXJlIHRvbyBtYW55IGFjdGl2ZSByZXF1ZXN0cyB0byB0aGUgc2VydmVyLCBhbmQgdGhlIHJlcXVlc3RcclxuICogICAgICAgICAgc2hvdWxkIGJlIHJldHJpZWQgbGF0ZXIuICBUaGUgcmVzb2x2ZWQgaW1hZ2UgbWF5IGJlIGVpdGhlciBhblxyXG4gKiAgICAgICAgICBJbWFnZSBvciBhIENhbnZhcyBET00gb2JqZWN0LlxyXG4gKlxyXG4gKiBAZXhjZXB0aW9uIHtEZXZlbG9wZXJFcnJvcn0gPGNvZGU+cmVxdWVzdEltYWdlPC9jb2RlPiBtdXN0IG5vdCBiZSBjYWxsZWQgYmVmb3JlIHRoZSBpbWFnZXJ5IHByb3ZpZGVyIGlzIHJlYWR5LlxyXG4gKi9cclxuQ2FudmFzSW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5yZXF1ZXN0SW1hZ2UgPSBmdW5jdGlvbih4LCB5LCBsZXZlbCkge1xyXG4gICAgLy8+PmluY2x1ZGVTdGFydCgnZGVidWcnLCBwcmFnbWFzLmRlYnVnKTtcclxuICAgIGlmICghdGhpcy5fcmVhZHkpIHtcclxuICAgICAgICAgICAgdGhyb3cgbmV3IERldmVsb3BlckVycm9yKCdyZXF1ZXN0SW1hZ2UgbXVzdCBub3QgYmUgY2FsbGVkIGJlZm9yZSB0aGUgaW1hZ2VyeSBwcm92aWRlciBpcyByZWFkeS4nKTtcclxuICAgIH1cclxuICAgIC8vPj5pbmNsdWRlRW5kKCdkZWJ1ZycpO1xyXG5cclxuICAgIHJldHVybiB0aGlzLl9jYW52YXM7XHJcbn07XHJcblxyXG4vKipcclxuICogUGlja2luZyBmZWF0dXJlcyBpcyBub3QgY3VycmVudGx5IHN1cHBvcnRlZCBieSB0aGlzIGltYWdlcnkgcHJvdmlkZXIsIHNvIHRoaXMgZnVuY3Rpb24gc2ltcGx5IHJldHVybnNcclxuICogdW5kZWZpbmVkLlxyXG4gKlxyXG4gKiBAcGFyYW0ge051bWJlcn0geCBUaGUgdGlsZSBYIGNvb3JkaW5hdGUuXHJcbiAqIEBwYXJhbSB7TnVtYmVyfSB5IFRoZSB0aWxlIFkgY29vcmRpbmF0ZS5cclxuICogQHBhcmFtIHtOdW1iZXJ9IGxldmVsIFRoZSB0aWxlIGxldmVsLlxyXG4gKiBAcGFyYW0ge051bWJlcn0gbG9uZ2l0dWRlIFRoZSBsb25naXR1ZGUgYXQgd2hpY2ggdG8gcGljayBmZWF0dXJlcy5cclxuICogQHBhcmFtIHtOdW1iZXJ9IGxhdGl0dWRlICBUaGUgbGF0aXR1ZGUgYXQgd2hpY2ggdG8gcGljayBmZWF0dXJlcy5cclxuICogQHJldHVybiB7UHJvbWlzZX0gQSBwcm9taXNlIGZvciB0aGUgcGlja2VkIGZlYXR1cmVzIHRoYXQgd2lsbCByZXNvbHZlIHdoZW4gdGhlIGFzeW5jaHJvbm91c1xyXG4gKiAgICAgICAgICAgICAgICAgICBwaWNraW5nIGNvbXBsZXRlcy4gIFRoZSByZXNvbHZlZCB2YWx1ZSBpcyBhbiBhcnJheSBvZiB7QGxpbmsgSW1hZ2VyeUxheWVyRmVhdHVyZUluZm99XHJcbiAqICAgICAgICAgICAgICAgICAgIGluc3RhbmNlcy4gIFRoZSBhcnJheSBtYXkgYmUgZW1wdHkgaWYgbm8gZmVhdHVyZXMgYXJlIGZvdW5kIGF0IHRoZSBnaXZlbiBsb2NhdGlvbi5cclxuICogICAgICAgICAgICAgICAgICAgSXQgbWF5IGFsc28gYmUgdW5kZWZpbmVkIGlmIHBpY2tpbmcgaXMgbm90IHN1cHBvcnRlZC5cclxuICovXHJcbkNhbnZhc0ltYWdlcnlQcm92aWRlci5wcm90b3R5cGUucGlja0ZlYXR1cmVzID0gZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcclxufTsiLCIndXNlIHN0cmljdCc7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IGNhbGN1bGF0ZUZydXN0dW07XHJcblxyXG4vKiBnbG9iYWwgQ2VzaXVtOiBmYWxzZSAqL1xyXG5cclxudmFyIGltYWdlSGVscGVyRnVuY3Rpb25zID0gcmVxdWlyZSgnaW1hZ2UtaGVscGVyLWZ1bmN0aW9ucy5qcycpO1xyXG5cclxudmFyIE1BWF9SRUNVUlNJVkVfTEVWRUxfT05fRkFJTEVEX1RSQU5TRk9STSA9IDQ7XHJcblxyXG5mdW5jdGlvbiBjYWxjdWxhdGVGcnVzdHVtKGNlc2l1bVdpZGdldCkge1xyXG4gICAgdmFyIHNjcmVlblNpemUgPSB7XHJcbiAgICAgICAgeDogY2VzaXVtV2lkZ2V0LnNjZW5lLmNhbnZhcy53aWR0aCxcclxuICAgICAgICB5OiBjZXNpdW1XaWRnZXQuc2NlbmUuY2FudmFzLmhlaWdodFxyXG4gICAgfTtcclxuICAgIFxyXG4gICAgdmFyIHBvaW50cyA9IFtdO1xyXG4gICAgc2VhcmNoQm91bmRpbmdQb2ludHMoXHJcbiAgICAgICAgMCwgMCwgc2NyZWVuU2l6ZS54LCBzY3JlZW5TaXplLnksIHBvaW50cywgY2VzaXVtV2lkZ2V0LCAvKnJlY3Vyc2l2ZT0qLzApO1xyXG5cclxuICAgIHZhciBmcnVzdHVtUmVjdGFuZ2xlID0gQ2VzaXVtLlJlY3RhbmdsZS5mcm9tQ2FydG9ncmFwaGljQXJyYXkocG9pbnRzKTtcclxuICAgIGlmIChmcnVzdHVtUmVjdGFuZ2xlLmVhc3QgPCBmcnVzdHVtUmVjdGFuZ2xlLndlc3QgfHwgZnJ1c3R1bVJlY3RhbmdsZS5ub3J0aCA8IGZydXN0dW1SZWN0YW5nbGUuc291dGgpIHtcclxuICAgICAgICBmcnVzdHVtUmVjdGFuZ2xlID0ge1xyXG4gICAgICAgICAgICBlYXN0OiBNYXRoLm1heChmcnVzdHVtUmVjdGFuZ2xlLmVhc3QsIGZydXN0dW1SZWN0YW5nbGUud2VzdCksXHJcbiAgICAgICAgICAgIHdlc3Q6IE1hdGgubWluKGZydXN0dW1SZWN0YW5nbGUuZWFzdCwgZnJ1c3R1bVJlY3RhbmdsZS53ZXN0KSxcclxuICAgICAgICAgICAgbm9ydGg6IE1hdGgubWF4KGZydXN0dW1SZWN0YW5nbGUubm9ydGgsIGZydXN0dW1SZWN0YW5nbGUuc291dGgpLFxyXG4gICAgICAgICAgICBzb3V0aDogTWF0aC5taW4oZnJ1c3R1bVJlY3RhbmdsZS5ub3J0aCwgZnJ1c3R1bVJlY3RhbmdsZS5zb3V0aClcclxuICAgICAgICB9O1xyXG4gICAgfVxyXG5cclxuICAgIHZhciBmcnVzdHVtRGF0YSA9IGltYWdlSGVscGVyRnVuY3Rpb25zLmNhbGN1bGF0ZUZydXN0dW0yREZyb21Cb3VuZHMoXHJcbiAgICAgICAgZnJ1c3R1bVJlY3RhbmdsZSwgc2NyZWVuU2l6ZSk7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgIHJldHVybiBmcnVzdHVtRGF0YTtcclxufVxyXG4gICAgXHJcbmZ1bmN0aW9uIHNlYXJjaEJvdW5kaW5nUG9pbnRzKFxyXG4gICAgbWluWCwgbWluWSwgbWF4WCwgbWF4WSwgcG9pbnRzLCBjZXNpdW1XaWRnZXQsIHJlY3Vyc2l2ZUxldmVsKSB7XHJcbiAgICBcclxuICAgIHZhciB0cmFuc2Zvcm1lZFBvaW50cyA9IDA7XHJcbiAgICB0cmFuc2Zvcm1lZFBvaW50cyArPSB0cmFuc2Zvcm1BbmRBZGRQb2ludChcclxuICAgICAgICBtaW5YLCBtaW5ZLCBjZXNpdW1XaWRnZXQsIHBvaW50cyk7XHJcbiAgICB0cmFuc2Zvcm1lZFBvaW50cyArPSB0cmFuc2Zvcm1BbmRBZGRQb2ludChcclxuICAgICAgICBtYXhYLCBtaW5ZLCBjZXNpdW1XaWRnZXQsIHBvaW50cyk7XHJcbiAgICB0cmFuc2Zvcm1lZFBvaW50cyArPSB0cmFuc2Zvcm1BbmRBZGRQb2ludChcclxuICAgICAgICBtaW5YLCBtYXhZLCBjZXNpdW1XaWRnZXQsIHBvaW50cyk7XHJcbiAgICB0cmFuc2Zvcm1lZFBvaW50cyArPSB0cmFuc2Zvcm1BbmRBZGRQb2ludChcclxuICAgICAgICBtYXhYLCBtYXhZLCBjZXNpdW1XaWRnZXQsIHBvaW50cyk7XHJcblxyXG4gICAgdmFyIG1heExldmVsID0gTUFYX1JFQ1VSU0lWRV9MRVZFTF9PTl9GQUlMRURfVFJBTlNGT1JNO1xyXG4gICAgXHJcbiAgICBpZiAodHJhbnNmb3JtZWRQb2ludHMgPT09IDQgfHwgcmVjdXJzaXZlTGV2ZWwgPj0gbWF4TGV2ZWwpIHtcclxuICAgICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBcclxuICAgICsrcmVjdXJzaXZlTGV2ZWw7XHJcbiAgICBcclxuICAgIHZhciBtaWRkbGVYID0gKG1pblggKyBtYXhYKSAvIDI7XHJcbiAgICB2YXIgbWlkZGxlWSA9IChtaW5ZICsgbWF4WSkgLyAyO1xyXG4gICAgXHJcbiAgICBzZWFyY2hCb3VuZGluZ1BvaW50cyhcclxuICAgICAgICBtaW5YLCBtaW5ZLCBtaWRkbGVYLCBtaWRkbGVZLCBwb2ludHMsIGNlc2l1bVdpZGdldCwgcmVjdXJzaXZlTGV2ZWwpO1xyXG5cclxuICAgIHNlYXJjaEJvdW5kaW5nUG9pbnRzKFxyXG4gICAgICAgIG1pblgsIG1pZGRsZVksIG1pZGRsZVgsIG1heFksIHBvaW50cywgY2VzaXVtV2lkZ2V0LCByZWN1cnNpdmVMZXZlbCk7XHJcblxyXG4gICAgc2VhcmNoQm91bmRpbmdQb2ludHMoXHJcbiAgICAgICAgbWlkZGxlWCwgbWluWSwgbWF4WCwgbWlkZGxlWSwgcG9pbnRzLCBjZXNpdW1XaWRnZXQsIHJlY3Vyc2l2ZUxldmVsKTtcclxuXHJcbiAgICBzZWFyY2hCb3VuZGluZ1BvaW50cyhcclxuICAgICAgICBtaWRkbGVYLCBtaWRkbGVZLCBtYXhYLCBtYXhZLCBwb2ludHMsIGNlc2l1bVdpZGdldCwgcmVjdXJzaXZlTGV2ZWwpO1xyXG59XHJcblxyXG5mdW5jdGlvbiB0cmFuc2Zvcm1BbmRBZGRQb2ludCh4LCB5LCBjZXNpdW1XaWRnZXQsIHBvaW50cykge1xyXG4gICAgXHJcbiAgICB2YXIgc2NyZWVuUG9pbnQgPSBuZXcgQ2VzaXVtLkNhcnRlc2lhbjIoeCwgeSk7XHJcbiAgICB2YXIgZWxsaXBzb2lkID0gY2VzaXVtV2lkZ2V0LnNjZW5lLm1hcFByb2plY3Rpb24uZWxsaXBzb2lkO1xyXG4gICAgdmFyIHBvaW50M0QgPSBjZXNpdW1XaWRnZXQuc2NlbmUuY2FtZXJhLnBpY2tFbGxpcHNvaWQoc2NyZWVuUG9pbnQsIGVsbGlwc29pZCk7XHJcbiAgICBcclxuICAgIGlmIChwb2ludDNEID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICByZXR1cm4gMDtcclxuICAgIH1cclxuXHJcbiAgICB2YXIgY2FydGVzaWFuID0gZWxsaXBzb2lkLmNhcnRlc2lhblRvQ2FydG9ncmFwaGljKHBvaW50M0QpO1xyXG4gICAgaWYgKGNhcnRlc2lhbiA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgcmV0dXJuIDA7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHBvaW50cy5wdXNoKGNhcnRlc2lhbik7XHJcbiAgICByZXR1cm4gMTtcclxufSIsIid1c2Ugc3RyaWN0JztcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gQ2VzaXVtSW1hZ2VEZWNvZGVyTGF5ZXJNYW5hZ2VyO1xyXG5cclxudmFyIENhbnZhc0ltYWdlcnlQcm92aWRlciA9IHJlcXVpcmUoJ2NhbnZhcy1pbWFnZXJ5LXByb3ZpZGVyLmpzJyk7XHJcbnZhciBJbWFnZVZpZXdlciA9IHJlcXVpcmUoJ2ltYWdlLWRlY29kZXItdmlld2VyLmpzJyk7XHJcbnZhciBjYWxjdWxhdGVDZXNpdW1GcnVzdHVtID0gcmVxdWlyZSgnY2VzaXVtLWZydXN0dW0tY2FsY3VsYXRvci5qcycpO1xyXG5cclxuLyogZ2xvYmFsIENlc2l1bTogZmFsc2UgKi9cclxuXHJcbmZ1bmN0aW9uIENlc2l1bUltYWdlRGVjb2RlckxheWVyTWFuYWdlcihpbWFnZURlY29kZXIsIG9wdGlvbnMpIHtcclxuICAgIHRoaXMuX29wdGlvbnMgPSBvcHRpb25zIHx8IHt9O1xyXG4gICAgXHJcbiAgICBpZiAodGhpcy5fb3B0aW9ucy5yZWN0YW5nbGUgIT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIHRoaXMuX29wdGlvbnMgPSBKU09OLnBhcnNlKEpTT04uc3RyaW5naWZ5KG9wdGlvbnMpKTtcclxuICAgICAgICB0aGlzLl9vcHRpb25zLmNhcnRvZ3JhcGhpY0JvdW5kcyA9IHtcclxuICAgICAgICAgICAgd2VzdDogb3B0aW9ucy5yZWN0YW5nbGUud2VzdCxcclxuICAgICAgICAgICAgZWFzdDogb3B0aW9ucy5yZWN0YW5nbGUuZWFzdCxcclxuICAgICAgICAgICAgc291dGg6IG9wdGlvbnMucmVjdGFuZ2xlLnNvdXRoLFxyXG4gICAgICAgICAgICBub3J0aDogb3B0aW9ucy5yZWN0YW5nbGUubm9ydGhcclxuICAgICAgICB9O1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICB0aGlzLl9vcHRpb25zLm1pbkZ1bmN0aW9uQ2FsbEludGVydmFsTWlsbGlzZWNvbmRzID1cclxuICAgICAgICBvcHRpb25zLm1pbkZ1bmN0aW9uQ2FsbEludGVydmFsTWlsbGlzZWNvbmRzIHx8IDEwMDtcclxuICAgIHRoaXMuX3VybCA9IG9wdGlvbnMudXJsO1xyXG5cclxuICAgIHRoaXMuX3RhcmdldENhbnZhcyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2NhbnZhcycpO1xyXG4gICAgdGhpcy5faW1hZ2VyeVByb3ZpZGVycyA9IFtcclxuICAgICAgICBuZXcgQ2FudmFzSW1hZ2VyeVByb3ZpZGVyKHRoaXMuX3RhcmdldENhbnZhcyksXHJcbiAgICAgICAgbmV3IENhbnZhc0ltYWdlcnlQcm92aWRlcih0aGlzLl90YXJnZXRDYW52YXMpXHJcbiAgICBdO1xyXG4gICAgdGhpcy5faW1hZ2VyeUxheWVyU2hvd24gPSBuZXcgQ2VzaXVtLkltYWdlcnlMYXllcih0aGlzLl9pbWFnZXJ5UHJvdmlkZXJzWzBdKTtcclxuICAgIHRoaXMuX2ltYWdlcnlMYXllclBlbmRpbmcgPSBuZXcgQ2VzaXVtLkltYWdlcnlMYXllcih0aGlzLl9pbWFnZXJ5UHJvdmlkZXJzWzFdKTtcclxuXHJcbiAgICB0aGlzLl9jYW52YXNVcGRhdGVkQ2FsbGJhY2tCb3VuZCA9IHRoaXMuX2NhbnZhc1VwZGF0ZWRDYWxsYmFjay5iaW5kKHRoaXMpO1xyXG4gICAgXHJcbiAgICB0aGlzLl9pc1BlbmRpbmdVcGRhdGVDYWxsYmFjayA9IGZhbHNlO1xyXG4gICAgdGhpcy5faXNXaGlsZVJlcGxhY2VMYXllclNob3duID0gZmFsc2U7XHJcbiAgICB0aGlzLl9wZW5kaW5nUG9zaXRpb25SZWN0YW5nbGUgPSBudWxsO1xyXG4gICAgXHJcbiAgICB0aGlzLl9pbWFnZVZpZXdlciA9IG5ldyBJbWFnZVZpZXdlcihcclxuICAgICAgICBpbWFnZURlY29kZXIsXHJcbiAgICAgICAgdGhpcy5fY2FudmFzVXBkYXRlZENhbGxiYWNrQm91bmQsXHJcbiAgICAgICAgdGhpcy5fb3B0aW9ucyk7XHJcbiAgICBcclxuICAgIHRoaXMuX2ltYWdlVmlld2VyLnNldFRhcmdldENhbnZhcyh0aGlzLl90YXJnZXRDYW52YXMpO1xyXG4gICAgXHJcbiAgICB0aGlzLl91cGRhdGVGcnVzdHVtQm91bmQgPSB0aGlzLl91cGRhdGVGcnVzdHVtLmJpbmQodGhpcyk7XHJcbiAgICB0aGlzLl9wb3N0UmVuZGVyQm91bmQgPSB0aGlzLl9wb3N0UmVuZGVyLmJpbmQodGhpcyk7XHJcbn1cclxuXHJcbkNlc2l1bUltYWdlRGVjb2RlckxheWVyTWFuYWdlci5wcm90b3R5cGUuc2V0RXhjZXB0aW9uQ2FsbGJhY2sgPSBmdW5jdGlvbiBzZXRFeGNlcHRpb25DYWxsYmFjayhleGNlcHRpb25DYWxsYmFjaykge1xyXG4gICAgdGhpcy5faW1hZ2VWaWV3ZXIuc2V0RXhjZXB0aW9uQ2FsbGJhY2soZXhjZXB0aW9uQ2FsbGJhY2spO1xyXG59O1xyXG5cclxuQ2VzaXVtSW1hZ2VEZWNvZGVyTGF5ZXJNYW5hZ2VyLnByb3RvdHlwZS5vcGVuID0gZnVuY3Rpb24gb3Blbih3aWRnZXRPclZpZXdlcikge1xyXG4gICAgdGhpcy5fd2lkZ2V0ID0gd2lkZ2V0T3JWaWV3ZXI7XHJcbiAgICB0aGlzLl9sYXllcnMgPSB3aWRnZXRPclZpZXdlci5zY2VuZS5pbWFnZXJ5TGF5ZXJzO1xyXG4gICAgd2lkZ2V0T3JWaWV3ZXIuc2NlbmUucG9zdFJlbmRlci5hZGRFdmVudExpc3RlbmVyKHRoaXMuX3Bvc3RSZW5kZXJCb3VuZCk7XHJcbiAgICBcclxuICAgIHRoaXMuX2ltYWdlVmlld2VyLm9wZW4odGhpcy5fdXJsKTtcclxuICAgIHRoaXMuX2xheWVycy5hZGQodGhpcy5faW1hZ2VyeUxheWVyU2hvd24pO1xyXG4gICAgXHJcbiAgICAvLyBOT1RFOiBJcyB0aGVyZSBhbiBldmVudCBoYW5kbGVyIHRvIHJlZ2lzdGVyIGluc3RlYWQ/XHJcbiAgICAvLyAoQ2VzaXVtJ3MgZXZlbnQgY29udHJvbGxlcnMgb25seSBleHBvc2Uga2V5Ym9hcmQgYW5kIG1vdXNlXHJcbiAgICAvLyBldmVudHMsIGJ1dCB0aGVyZSBpcyBubyBldmVudCBmb3IgZnJ1c3R1bSBjaGFuZ2VkXHJcbiAgICAvLyBwcm9ncmFtbWF0aWNhbGx5KS5cclxuICAgIHRoaXMuX2ludGVydmFsSGFuZGxlID0gc2V0SW50ZXJ2YWwoXHJcbiAgICAgICAgdGhpcy5fdXBkYXRlRnJ1c3R1bUJvdW5kLFxyXG4gICAgICAgIDUwMCk7XHJcbn07XHJcblxyXG5DZXNpdW1JbWFnZURlY29kZXJMYXllck1hbmFnZXIucHJvdG90eXBlLmNsb3NlID0gZnVuY3Rpb24gY2xvc2UoKSB7XHJcbiAgICB0aGlzLl9pbWFnZVZpZXdlci5jbG9zZSgpO1xyXG4gICAgY2xlYXJJbnRlcnZhbCh0aGlzLl9pbnRlcnZhbEhhbmRsZSk7XHJcblxyXG4gICAgdGhpcy5fbGF5ZXJzLnJlbW92ZSh0aGlzLl9pbWFnZXJ5TGF5ZXJTaG93bik7XHJcbiAgICB0aGlzLl93aWRnZXQucmVtb3ZlRXZlbnRMaXN0ZW5lcih0aGlzLl9wb3N0UmVuZGVyQm91bmQpO1xyXG4gICAgaWYgKHRoaXMuX2lzV2hpbGVSZXBsYWNlTGF5ZXJTaG93bikge1xyXG4gICAgICAgIHRoaXMuX2lzV2hpbGVSZXBsYWNlTGF5ZXJTaG93biA9IGZhbHNlO1xyXG4gICAgICAgIHRoaXMuX2lzUGVuZGluZ1VwZGF0ZUNhbGxiYWNrID0gZmFsc2U7XHJcbiAgICAgICAgdGhpcy5fbGF5ZXJzLnJlbW92ZSh0aGlzLl9pbWFnZXJ5TGF5ZXJQZW5kaW5nKTtcclxuICAgIH1cclxufTtcclxuXHJcbkNlc2l1bUltYWdlRGVjb2RlckxheWVyTWFuYWdlci5wcm90b3R5cGUuZ2V0SW1hZ2VyeUxheWVycyA9IGZ1bmN0aW9uIGdldEltYWdlcnlMYXllcnMoKSB7XHJcbiAgICByZXR1cm4gW3RoaXMuX2ltYWdlcnlMYXllclNob3duLCB0aGlzLl9pbWFnZXJ5TGF5ZXJQZW5kaW5nXTtcclxufTtcclxuXHJcbkNlc2l1bUltYWdlRGVjb2RlckxheWVyTWFuYWdlci5wcm90b3R5cGUuX3VwZGF0ZUZydXN0dW0gPSBmdW5jdGlvbiB1cGRhdGVGcnVzdHVtKCkge1xyXG4gICAgdmFyIGZydXN0dW0gPSBjYWxjdWxhdGVDZXNpdW1GcnVzdHVtKHRoaXMuX3dpZGdldCk7XHJcbiAgICBpZiAoZnJ1c3R1bSAhPT0gbnVsbCkge1xyXG4gICAgICAgIHRoaXMuX2ltYWdlVmlld2VyLnVwZGF0ZVZpZXdBcmVhKGZydXN0dW0pO1xyXG4gICAgfVxyXG59O1xyXG5cclxuQ2VzaXVtSW1hZ2VEZWNvZGVyTGF5ZXJNYW5hZ2VyLnByb3RvdHlwZS5fY2FudmFzVXBkYXRlZENhbGxiYWNrID0gZnVuY3Rpb24gY2FudmFzVXBkYXRlZENhbGxiYWNrKG5ld1Bvc2l0aW9uKSB7XHJcbiAgICBpZiAodGhpcy5faXNXaGlsZVJlcGxhY2VMYXllclNob3duKSB7XHJcbiAgICAgICAgdGhpcy5faXNQZW5kaW5nVXBkYXRlQ2FsbGJhY2sgPSB0cnVlO1xyXG4gICAgICAgIHRoaXMuX3BlbmRpbmdQb3NpdGlvblJlY3RhbmdsZSA9IG5ld1Bvc2l0aW9uO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBpZiAobmV3UG9zaXRpb24gIT09IG51bGwpIHtcclxuICAgICAgICB2YXIgcmVjdGFuZ2xlID0gbmV3IENlc2l1bS5SZWN0YW5nbGUoXHJcbiAgICAgICAgICAgIG5ld1Bvc2l0aW9uLndlc3QsXHJcbiAgICAgICAgICAgIG5ld1Bvc2l0aW9uLnNvdXRoLFxyXG4gICAgICAgICAgICBuZXdQb3NpdGlvbi5lYXN0LFxyXG4gICAgICAgICAgICBuZXdQb3NpdGlvbi5ub3J0aCk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgdGhpcy5faW1hZ2VyeVByb3ZpZGVyc1swXS5zZXRSZWN0YW5nbGUocmVjdGFuZ2xlKTtcclxuICAgICAgICB0aGlzLl9pbWFnZXJ5UHJvdmlkZXJzWzFdLnNldFJlY3RhbmdsZShyZWN0YW5nbGUpO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICB0aGlzLl9yZW1vdmVBbmRSZUFkZExheWVyKCk7XHJcbn07XHJcblxyXG5DZXNpdW1JbWFnZURlY29kZXJMYXllck1hbmFnZXIucHJvdG90eXBlLl9yZW1vdmVBbmRSZUFkZExheWVyID0gZnVuY3Rpb24gcmVtb3ZlQW5kUmVBZGRMYXllcigpIHtcclxuICAgIHZhciBpbmRleCA9IHRoaXMuX2xheWVycy5pbmRleE9mKHRoaXMuX2ltYWdlcnlMYXllclNob3duKTtcclxuICAgIFxyXG4gICAgaWYgKGluZGV4IDwgMCkge1xyXG4gICAgICAgIHRocm93ICdMYXllciB3YXMgcmVtb3ZlZCBmcm9tIHZpZXdlclxcJ3MgbGF5ZXJzICB3aXRob3V0ICcgK1xyXG4gICAgICAgICAgICAnY2xvc2luZyBsYXllciBtYW5hZ2VyLiBVc2UgQ2VzaXVtSW1hZ2VEZWNvZGVyTGF5ZXJNYW5hZ2VyLicgK1xyXG4gICAgICAgICAgICAnY2xvc2UoKSBpbnN0ZWFkJztcclxuICAgIH1cclxuICAgIFxyXG4gICAgdGhpcy5faXNXaGlsZVJlcGxhY2VMYXllclNob3duID0gdHJ1ZTtcclxuICAgIHRoaXMuX2xheWVycy5hZGQodGhpcy5faW1hZ2VyeUxheWVyUGVuZGluZywgaW5kZXgpO1xyXG59O1xyXG5cclxuQ2VzaXVtSW1hZ2VEZWNvZGVyTGF5ZXJNYW5hZ2VyLnByb3RvdHlwZS5fcG9zdFJlbmRlciA9IGZ1bmN0aW9uIHBvc3RSZW5kZXIoKSB7XHJcbiAgICBpZiAoIXRoaXMuX2lzV2hpbGVSZXBsYWNlTGF5ZXJTaG93bilcclxuICAgICAgICByZXR1cm47XHJcbiAgICBcclxuICAgIHRoaXMuX2lzV2hpbGVSZXBsYWNlTGF5ZXJTaG93biA9IGZhbHNlO1xyXG4gICAgdGhpcy5fbGF5ZXJzLnJlbW92ZSh0aGlzLl9pbWFnZXJ5TGF5ZXJTaG93biwgLypkZXN0cm95PSovZmFsc2UpO1xyXG4gICAgXHJcbiAgICB2YXIgc3dhcCA9IHRoaXMuX2ltYWdlcnlMYXllclNob3duO1xyXG4gICAgdGhpcy5faW1hZ2VyeUxheWVyU2hvd24gPSB0aGlzLl9pbWFnZXJ5TGF5ZXJQZW5kaW5nO1xyXG4gICAgdGhpcy5faW1hZ2VyeUxheWVyUGVuZGluZyA9IHN3YXA7XHJcbiAgICBcclxuICAgIGlmICh0aGlzLl9pc1BlbmRpbmdVcGRhdGVDYWxsYmFjaykge1xyXG4gICAgICAgIHRoaXMuX2lzUGVuZGluZ1VwZGF0ZUNhbGxiYWNrID0gZmFsc2U7XHJcbiAgICAgICAgdGhpcy5fY2FudmFzVXBkYXRlZENhbGxiYWNrKHRoaXMuX3BlbmRpbmdQb3NpdGlvblJlY3RhbmdsZSk7XHJcbiAgICB9XHJcbn07IiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBJbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXI7XHJcblxyXG52YXIgY2FsY3VsYXRlQ2VzaXVtRnJ1c3R1bSA9IHJlcXVpcmUoJ2Nlc2l1bS1mcnVzdHVtLWNhbGN1bGF0b3IuanMnKTtcclxudmFyIGltYWdlSGVscGVyRnVuY3Rpb25zID0gcmVxdWlyZSgnaW1hZ2UtaGVscGVyLWZ1bmN0aW9ucy5qcycpO1xyXG5cclxuLyogZ2xvYmFsIENlc2l1bTogZmFsc2UgKi9cclxuLyogZ2xvYmFsIERldmVsb3BlckVycm9yOiBmYWxzZSAqL1xyXG4vKiBnbG9iYWwgQ3JlZGl0OiBmYWxzZSAqL1xyXG4vKiBnbG9iYWwgUHJvbWlzZTogZmFsc2UgKi9cclxuXHJcbi8qKlxyXG4gKiBQcm92aWRlcyBhIEltYWdlRGVjb2RlciBjbGllbnQgaW1hZ2VyeSB0aWxlLiAgVGhlIGltYWdlIGlzIGFzc3VtZWQgdG8gdXNlIGFcclxuICoge0BsaW5rIEdlb2dyYXBoaWNUaWxpbmdTY2hlbWV9LlxyXG4gKlxyXG4gKiBAYWxpYXMgSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyXHJcbiAqIEBjb25zdHJ1Y3RvclxyXG4gKlxyXG4gKiBAcGFyYW0ge09iamVjdH0gb3B0aW9ucyBPYmplY3Qgd2l0aCB0aGUgZm9sbG93aW5nIHByb3BlcnRpZXM6XHJcbiAqIEBwYXJhbSB7U3RyaW5nfSBvcHRpb25zLnVybCBUaGUgdXJsIGZvciB0aGUgdGlsZS5cclxuICogQHBhcmFtIHtSZWN0YW5nbGV9IFtvcHRpb25zLnJlY3RhbmdsZT1SZWN0YW5nbGUuTUFYX1ZBTFVFXSBUaGUgcmVjdGFuZ2xlLCBpbiByYWRpYW5zLCBjb3ZlcmVkIGJ5IHRoZSBpbWFnZS5cclxuICogQHBhcmFtIHtDcmVkaXR8U3RyaW5nfSBbb3B0aW9ucy5jcmVkaXRdIEEgY3JlZGl0IGZvciB0aGUgZGF0YSBzb3VyY2UsIHdoaWNoIGlzIGRpc3BsYXllZCBvbiB0aGUgY2FudmFzLlxyXG4gKiBAcGFyYW0ge09iamVjdH0gW29wdGlvbnMucHJveHldIEEgcHJveHkgdG8gdXNlIGZvciByZXF1ZXN0cy4gVGhpcyBvYmplY3QgaXMgZXhwZWN0ZWQgdG8gaGF2ZSBhIGdldFVSTCBmdW5jdGlvbiB3aGljaCByZXR1cm5zIHRoZSBwcm94aWVkIFVSTCwgaWYgbmVlZGVkLlxyXG4gKiBAcGFyYW0ge2Jvb2xlYW59IFtvcHRpb25zLmFkYXB0UHJvcG9ydGlvbnNdIGRldGVybWluZXMgaWYgdG8gYWRhcHQgdGhlIHByb3BvcnRpb25zIG9mIHRoZSByZWN0YW5nbGUgcHJvdmlkZWQgdG8gdGhlIGltYWdlIHBpeGVscyBwcm9wb3J0aW9ucy5cclxuICpcclxuICogQHNlZSBBcmNHaXNNYXBTZXJ2ZXJJbWFnZXJ5UHJvdmlkZXJcclxuICogQHNlZSBCaW5nTWFwc0ltYWdlcnlQcm92aWRlclxyXG4gKiBAc2VlIEdvb2dsZUVhcnRoSW1hZ2VyeVByb3ZpZGVyXHJcbiAqIEBzZWUgT3BlblN0cmVldE1hcEltYWdlcnlQcm92aWRlclxyXG4gKiBAc2VlIFRpbGVNYXBTZXJ2aWNlSW1hZ2VyeVByb3ZpZGVyXHJcbiAqIEBzZWUgV2ViTWFwU2VydmljZUltYWdlcnlQcm92aWRlclxyXG4gKi9cclxuZnVuY3Rpb24gSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyKGltYWdlRGVjb2Rlciwgb3B0aW9ucykge1xyXG4gICAgdmFyIHVybCA9IG9wdGlvbnMudXJsO1xyXG4gICAgdGhpcy5fYWRhcHRQcm9wb3J0aW9ucyA9IG9wdGlvbnMuYWRhcHRQcm9wb3J0aW9ucztcclxuICAgIHRoaXMuX3JlY3RhbmdsZSA9IG9wdGlvbnMucmVjdGFuZ2xlO1xyXG4gICAgdGhpcy5fcHJveHkgPSBvcHRpb25zLnByb3h5O1xyXG4gICAgdGhpcy5fdXBkYXRlRnJ1c3R1bUludGVydmFsID0gMTAwMCB8fCBvcHRpb25zLnVwZGF0ZUZydXN0dW1JbnRlcnZhbDtcclxuICAgIHRoaXMuX2NyZWRpdCA9IG9wdGlvbnMuY3JlZGl0O1xyXG4gICAgXHJcbiAgICBpZiAodHlwZW9mIHRoaXMuX2NyZWRpdCA9PT0gJ3N0cmluZycpIHtcclxuICAgICAgICB0aGlzLl9jcmVkaXQgPSBuZXcgQ3JlZGl0KHRoaXMuX2NyZWRpdCk7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGlmICh0aGlzLl9yZWN0YW5nbGUgPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIHRoaXMuX3JlY3RhbmdsZSA9IENlc2l1bS5SZWN0YW5nbGUuZnJvbURlZ3JlZXMoLTE4MCwgLTkwLCAxODAsIDkwKTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgaWYgKHRoaXMuX2FkYXB0UHJvcG9ydGlvbnMgPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIHRoaXMuX2FkYXB0UHJvcG9ydGlvbnMgPSB0cnVlO1xyXG4gICAgfVxyXG5cclxuICAgIG9wdGlvbnMgPSBKU09OLnBhcnNlKEpTT04uc3RyaW5naWZ5KG9wdGlvbnMgfHwge30pKTtcclxuICAgIG9wdGlvbnMuY2FydG9ncmFwaGljQm91bmRzID0ge1xyXG4gICAgICAgIHdlc3Q6IHRoaXMuX3JlY3RhbmdsZS53ZXN0LFxyXG4gICAgICAgIGVhc3Q6IHRoaXMuX3JlY3RhbmdsZS5lYXN0LFxyXG4gICAgICAgIHNvdXRoOiB0aGlzLl9yZWN0YW5nbGUuc291dGgsXHJcbiAgICAgICAgbm9ydGg6IHRoaXMuX3JlY3RhbmdsZS5ub3J0aFxyXG4gICAgfTtcclxuICAgIFxyXG4gICAgLy8+PmluY2x1ZGVTdGFydCgnZGVidWcnLCBwcmFnbWFzLmRlYnVnKTtcclxuICAgIGlmICh1cmwgPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgICAgICB0aHJvdyBuZXcgRGV2ZWxvcGVyRXJyb3IoJ3VybCBpcyByZXF1aXJlZC4nKTtcclxuICAgIH1cclxuICAgIC8vPj5pbmNsdWRlRW5kKCdkZWJ1ZycpO1xyXG5cclxuICAgIHRoaXMuX3VybCA9IHVybDtcclxuXHJcbiAgICB0aGlzLl90aWxpbmdTY2hlbWUgPSB1bmRlZmluZWQ7XHJcblxyXG4gICAgdGhpcy5fdGlsZVdpZHRoID0gMDtcclxuICAgIHRoaXMuX3RpbGVIZWlnaHQgPSAwO1xyXG5cclxuICAgIHRoaXMuX2Vycm9yRXZlbnQgPSBuZXcgRXZlbnQoJ0ltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlclN0YXR1cycpO1xyXG5cclxuICAgIHRoaXMuX3JlYWR5ID0gZmFsc2U7XHJcbiAgICB0aGlzLl9leGNlcHRpb25DYWxsYmFjayA9IG51bGw7XHJcbiAgICB0aGlzLl9jZXNpdW1XaWRnZXQgPSBudWxsO1xyXG4gICAgdGhpcy5fdXBkYXRlRnJ1c3R1bUludGVydmFsSGFuZGxlID0gbnVsbDtcclxuICAgIFxyXG5cclxuICAgIHZhciBpbWFnZVVybCA9IHVybDtcclxuICAgIGlmICh0aGlzLl9wcm94eSAhPT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgLy8gTk9URTogSXMgdGhhdCB0aGUgY29ycmVjdCBsb2dpYz9cclxuICAgICAgICBpbWFnZVVybCA9IHRoaXMuX3Byb3h5LmdldFVSTChpbWFnZVVybCk7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHRoaXMuX2ltYWdlRGVjb2RlciA9IGltYWdlRGVjb2RlcjtcclxuICAgIHRoaXMuX3VybCA9IGltYWdlVXJsO1xyXG59XHJcblxyXG5JbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlID0ge1xyXG4gICAgLyoqXHJcbiAgICAgKiBHZXRzIHRoZSBVUkwgb2YgdGhlIEltYWdlRGVjb2RlciBzZXJ2ZXIgKGluY2x1ZGluZyB0YXJnZXQpLlxyXG4gICAgICogQG1lbWJlcm9mIEltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlci5wcm90b3R5cGVcclxuICAgICAqIEB0eXBlIHtTdHJpbmd9XHJcbiAgICAgKiBAcmVhZG9ubHlcclxuICAgICAqL1xyXG4gICAgZ2V0IHVybCgpIHtcclxuICAgICAgICByZXR1cm4gdGhpcy5fdXJsO1xyXG4gICAgfSxcclxuXHJcbiAgICAvKipcclxuICAgICAqIEdldHMgdGhlIHByb3h5IHVzZWQgYnkgdGhpcyBwcm92aWRlci5cclxuICAgICAqIEBtZW1iZXJvZiBJbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlXHJcbiAgICAgKiBAdHlwZSB7UHJveHl9XHJcbiAgICAgKiBAcmVhZG9ubHlcclxuICAgICAqL1xyXG4gICAgZ2V0IHByb3h5KCkge1xyXG4gICAgICAgIHJldHVybiB0aGlzLl9wcm94eTtcclxuICAgIH0sXHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZXRzIHRoZSB3aWR0aCBvZiBlYWNoIHRpbGUsIGluIHBpeGVscy4gVGhpcyBmdW5jdGlvbiBzaG91bGRcclxuICAgICAqIG5vdCBiZSBjYWxsZWQgYmVmb3JlIHtAbGluayBJbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIjcmVhZHl9IHJldHVybnMgdHJ1ZS5cclxuICAgICAqIEBtZW1iZXJvZiBJbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlXHJcbiAgICAgKiBAdHlwZSB7TnVtYmVyfVxyXG4gICAgICogQHJlYWRvbmx5XHJcbiAgICAgKi9cclxuICAgIGdldCB0aWxlV2lkdGgoKSB7XHJcbiAgICAgICAgLy8+PmluY2x1ZGVTdGFydCgnZGVidWcnLCBwcmFnbWFzLmRlYnVnKTtcclxuICAgICAgICBpZiAoIXRoaXMuX3JlYWR5KSB7XHJcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRGV2ZWxvcGVyRXJyb3IoJ3RpbGVXaWR0aCBtdXN0IG5vdCBiZSBjYWxsZWQgYmVmb3JlIHRoZSBpbWFnZXJ5IHByb3ZpZGVyIGlzIHJlYWR5LicpO1xyXG4gICAgICAgIH1cclxuICAgICAgICAvLz4+aW5jbHVkZUVuZCgnZGVidWcnKTtcclxuXHJcbiAgICAgICAgcmV0dXJuIHRoaXMuX3RpbGVXaWR0aDtcclxuICAgIH0sXHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZXRzIHRoZSBoZWlnaHQgb2YgZWFjaCB0aWxlLCBpbiBwaXhlbHMuICBUaGlzIGZ1bmN0aW9uIHNob3VsZFxyXG4gICAgICogbm90IGJlIGNhbGxlZCBiZWZvcmUge0BsaW5rIEltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlciNyZWFkeX0gcmV0dXJucyB0cnVlLlxyXG4gICAgICogQG1lbWJlcm9mIEltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlci5wcm90b3R5cGVcclxuICAgICAqIEB0eXBlIHtOdW1iZXJ9XHJcbiAgICAgKiBAcmVhZG9ubHlcclxuICAgICAqL1xyXG4gICAgZ2V0IHRpbGVIZWlnaHQoKSB7XHJcbiAgICAgICAgLy8+PmluY2x1ZGVTdGFydCgnZGVidWcnLCBwcmFnbWFzLmRlYnVnKTtcclxuICAgICAgICBpZiAoIXRoaXMuX3JlYWR5KSB7XHJcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRGV2ZWxvcGVyRXJyb3IoJ3RpbGVIZWlnaHQgbXVzdCBub3QgYmUgY2FsbGVkIGJlZm9yZSB0aGUgaW1hZ2VyeSBwcm92aWRlciBpcyByZWFkeS4nKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgLy8+PmluY2x1ZGVFbmQoJ2RlYnVnJyk7XHJcblxyXG4gICAgICAgIHJldHVybiB0aGlzLl90aWxlSGVpZ2h0O1xyXG4gICAgfSxcclxuXHJcbiAgICAvKipcclxuICAgICAqIEdldHMgdGhlIG1heGltdW0gbGV2ZWwtb2YtZGV0YWlsIHRoYXQgY2FuIGJlIHJlcXVlc3RlZC4gIFRoaXMgZnVuY3Rpb24gc2hvdWxkXHJcbiAgICAgKiBub3QgYmUgY2FsbGVkIGJlZm9yZSB7QGxpbmsgSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyI3JlYWR5fSByZXR1cm5zIHRydWUuXHJcbiAgICAgKiBAbWVtYmVyb2YgSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZVxyXG4gICAgICogQHR5cGUge051bWJlcn1cclxuICAgICAqIEByZWFkb25seVxyXG4gICAgICovXHJcbiAgICBnZXQgbWF4aW11bUxldmVsKCkge1xyXG4gICAgICAgIC8vPj5pbmNsdWRlU3RhcnQoJ2RlYnVnJywgcHJhZ21hcy5kZWJ1Zyk7XHJcbiAgICAgICAgaWYgKCF0aGlzLl9yZWFkeSkge1xyXG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IERldmVsb3BlckVycm9yKCdtYXhpbXVtTGV2ZWwgbXVzdCBub3QgYmUgY2FsbGVkIGJlZm9yZSB0aGUgaW1hZ2VyeSBwcm92aWRlciBpcyByZWFkeS4nKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgLy8+PmluY2x1ZGVFbmQoJ2RlYnVnJyk7XHJcblxyXG4gICAgICAgIHJldHVybiB0aGlzLl9udW1SZXNvbHV0aW9uTGV2ZWxzIC0gMTtcclxuICAgIH0sXHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZXRzIHRoZSBtaW5pbXVtIGxldmVsLW9mLWRldGFpbCB0aGF0IGNhbiBiZSByZXF1ZXN0ZWQuICBUaGlzIGZ1bmN0aW9uIHNob3VsZFxyXG4gICAgICogbm90IGJlIGNhbGxlZCBiZWZvcmUge0BsaW5rIEltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlciNyZWFkeX0gcmV0dXJucyB0cnVlLlxyXG4gICAgICogQG1lbWJlcm9mIEltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlci5wcm90b3R5cGVcclxuICAgICAqIEB0eXBlIHtOdW1iZXJ9XHJcbiAgICAgKiBAcmVhZG9ubHlcclxuICAgICAqL1xyXG4gICAgZ2V0IG1pbmltdW1MZXZlbCgpIHtcclxuICAgICAgICAvLz4+aW5jbHVkZVN0YXJ0KCdkZWJ1ZycsIHByYWdtYXMuZGVidWcpO1xyXG4gICAgICAgIGlmICghdGhpcy5fcmVhZHkpIHtcclxuICAgICAgICAgICAgICAgIHRocm93IG5ldyBEZXZlbG9wZXJFcnJvcignbWluaW11bUxldmVsIG11c3Qgbm90IGJlIGNhbGxlZCBiZWZvcmUgdGhlIGltYWdlcnkgcHJvdmlkZXIgaXMgcmVhZHkuJyk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIC8vPj5pbmNsdWRlRW5kKCdkZWJ1ZycpO1xyXG5cclxuICAgICAgICByZXR1cm4gMDtcclxuICAgIH0sXHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZXRzIHRoZSB0aWxpbmcgc2NoZW1lIHVzZWQgYnkgdGhpcyBwcm92aWRlci4gIFRoaXMgZnVuY3Rpb24gc2hvdWxkXHJcbiAgICAgKiBub3QgYmUgY2FsbGVkIGJlZm9yZSB7QGxpbmsgSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyI3JlYWR5fSByZXR1cm5zIHRydWUuXHJcbiAgICAgKiBAbWVtYmVyb2YgSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZVxyXG4gICAgICogQHR5cGUge1RpbGluZ1NjaGVtZX1cclxuICAgICAqIEByZWFkb25seVxyXG4gICAgICovXHJcbiAgICBnZXQgdGlsaW5nU2NoZW1lKCkge1xyXG4gICAgICAgIC8vPj5pbmNsdWRlU3RhcnQoJ2RlYnVnJywgcHJhZ21hcy5kZWJ1Zyk7XHJcbiAgICAgICAgaWYgKCF0aGlzLl9yZWFkeSkge1xyXG4gICAgICAgICAgICB0aHJvdyBuZXcgRGV2ZWxvcGVyRXJyb3IoJ3RpbGluZ1NjaGVtZSBtdXN0IG5vdCBiZSBjYWxsZWQgYmVmb3JlIHRoZSBpbWFnZXJ5IHByb3ZpZGVyIGlzIHJlYWR5LicpO1xyXG4gICAgICAgIH1cclxuICAgICAgICAvLz4+aW5jbHVkZUVuZCgnZGVidWcnKTtcclxuXHJcbiAgICAgICAgcmV0dXJuIHRoaXMuX3RpbGluZ1NjaGVtZTtcclxuICAgIH0sXHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZXRzIHRoZSByZWN0YW5nbGUsIGluIHJhZGlhbnMsIG9mIHRoZSBpbWFnZXJ5IHByb3ZpZGVkIGJ5IHRoaXMgaW5zdGFuY2UuICBUaGlzIGZ1bmN0aW9uIHNob3VsZFxyXG4gICAgICogbm90IGJlIGNhbGxlZCBiZWZvcmUge0BsaW5rIEltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlciNyZWFkeX0gcmV0dXJucyB0cnVlLlxyXG4gICAgICogQG1lbWJlcm9mIEltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlci5wcm90b3R5cGVcclxuICAgICAqIEB0eXBlIHtSZWN0YW5nbGV9XHJcbiAgICAgKiBAcmVhZG9ubHlcclxuICAgICAqL1xyXG4gICAgZ2V0IHJlY3RhbmdsZSgpIHtcclxuICAgICAgICByZXR1cm4gdGhpcy5fdGlsaW5nU2NoZW1lLnJlY3RhbmdsZTtcclxuICAgIH0sXHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZXRzIHRoZSB0aWxlIGRpc2NhcmQgcG9saWN5LiAgSWYgbm90IHVuZGVmaW5lZCwgdGhlIGRpc2NhcmQgcG9saWN5IGlzIHJlc3BvbnNpYmxlXHJcbiAgICAgKiBmb3IgZmlsdGVyaW5nIG91dCBcIm1pc3NpbmdcIiB0aWxlcyB2aWEgaXRzIHNob3VsZERpc2NhcmRJbWFnZSBmdW5jdGlvbi4gIElmIHRoaXMgZnVuY3Rpb25cclxuICAgICAqIHJldHVybnMgdW5kZWZpbmVkLCBubyB0aWxlcyBhcmUgZmlsdGVyZWQuICBUaGlzIGZ1bmN0aW9uIHNob3VsZFxyXG4gICAgICogbm90IGJlIGNhbGxlZCBiZWZvcmUge0BsaW5rIEltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlciNyZWFkeX0gcmV0dXJucyB0cnVlLlxyXG4gICAgICogQG1lbWJlcm9mIEltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlci5wcm90b3R5cGVcclxuICAgICAqIEB0eXBlIHtUaWxlRGlzY2FyZFBvbGljeX1cclxuICAgICAqIEByZWFkb25seVxyXG4gICAgICovXHJcbiAgICBnZXQgdGlsZURpc2NhcmRQb2xpY3koKSB7XHJcbiAgICAgICAgLy8+PmluY2x1ZGVTdGFydCgnZGVidWcnLCBwcmFnbWFzLmRlYnVnKTtcclxuICAgICAgICBpZiAoIXRoaXMuX3JlYWR5KSB7XHJcbiAgICAgICAgICAgIHRocm93IG5ldyBEZXZlbG9wZXJFcnJvcigndGlsZURpc2NhcmRQb2xpY3kgbXVzdCBub3QgYmUgY2FsbGVkIGJlZm9yZSB0aGUgaW1hZ2VyeSBwcm92aWRlciBpcyByZWFkeS4nKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgLy8+PmluY2x1ZGVFbmQoJ2RlYnVnJyk7XHJcblxyXG4gICAgICAgIHJldHVybiB1bmRlZmluZWQ7XHJcbiAgICB9LFxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2V0cyBhbiBldmVudCB0aGF0IGlzIHJhaXNlZCB3aGVuIHRoZSBpbWFnZXJ5IHByb3ZpZGVyIGVuY291bnRlcnMgYW4gYXN5bmNocm9ub3VzIGVycm9yLiAgQnkgc3Vic2NyaWJpbmdcclxuICAgICAqIHRvIHRoZSBldmVudCwgeW91IHdpbGwgYmUgbm90aWZpZWQgb2YgdGhlIGVycm9yIGFuZCBjYW4gcG90ZW50aWFsbHkgcmVjb3ZlciBmcm9tIGl0LiAgRXZlbnQgbGlzdGVuZXJzXHJcbiAgICAgKiBhcmUgcGFzc2VkIGFuIGluc3RhbmNlIG9mIHtAbGluayBUaWxlUHJvdmlkZXJFcnJvcn0uXHJcbiAgICAgKiBAbWVtYmVyb2YgSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZVxyXG4gICAgICogQHR5cGUge0V2ZW50fVxyXG4gICAgICogQHJlYWRvbmx5XHJcbiAgICAgKi9cclxuICAgIGdldCBlcnJvckV2ZW50KCkge1xyXG4gICAgICAgIHJldHVybiB0aGlzLl9lcnJvckV2ZW50O1xyXG4gICAgfSxcclxuXHJcbiAgICAvKipcclxuICAgICAqIEdldHMgYSB2YWx1ZSBpbmRpY2F0aW5nIHdoZXRoZXIgb3Igbm90IHRoZSBwcm92aWRlciBpcyByZWFkeSBmb3IgdXNlLlxyXG4gICAgICogQG1lbWJlcm9mIEltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlci5wcm90b3R5cGVcclxuICAgICAqIEB0eXBlIHtCb29sZWFufVxyXG4gICAgICogQHJlYWRvbmx5XHJcbiAgICAgKi9cclxuICAgIGdldCByZWFkeSgpIHtcclxuICAgICAgICByZXR1cm4gdGhpcy5fcmVhZHk7XHJcbiAgICB9LFxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2V0cyB0aGUgY3JlZGl0IHRvIGRpc3BsYXkgd2hlbiB0aGlzIGltYWdlcnkgcHJvdmlkZXIgaXMgYWN0aXZlLiAgVHlwaWNhbGx5IHRoaXMgaXMgdXNlZCB0byBjcmVkaXRcclxuICAgICAqIHRoZSBzb3VyY2Ugb2YgdGhlIGltYWdlcnkuICBUaGlzIGZ1bmN0aW9uIHNob3VsZCBub3QgYmUgY2FsbGVkIGJlZm9yZSB7QGxpbmsgSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyI3JlYWR5fSByZXR1cm5zIHRydWUuXHJcbiAgICAgKiBAbWVtYmVyb2YgSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZVxyXG4gICAgICogQHR5cGUge0NyZWRpdH1cclxuICAgICAqIEByZWFkb25seVxyXG4gICAgICovXHJcbiAgICBnZXQgY3JlZGl0KCkge1xyXG4gICAgICAgIHJldHVybiB0aGlzLl9jcmVkaXQ7XHJcbiAgICB9LFxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2V0cyBhIHZhbHVlIGluZGljYXRpbmcgd2hldGhlciBvciBub3QgdGhlIGltYWdlcyBwcm92aWRlZCBieSB0aGlzIGltYWdlcnkgcHJvdmlkZXJcclxuICAgICAqIGluY2x1ZGUgYW4gYWxwaGEgY2hhbm5lbC4gIElmIHRoaXMgcHJvcGVydHkgaXMgZmFsc2UsIGFuIGFscGhhIGNoYW5uZWwsIGlmIHByZXNlbnQsIHdpbGxcclxuICAgICAqIGJlIGlnbm9yZWQuICBJZiB0aGlzIHByb3BlcnR5IGlzIHRydWUsIGFueSBpbWFnZXMgd2l0aG91dCBhbiBhbHBoYSBjaGFubmVsIHdpbGwgYmUgdHJlYXRlZFxyXG4gICAgICogYXMgaWYgdGhlaXIgYWxwaGEgaXMgMS4wIGV2ZXJ5d2hlcmUuICBXaGVuIHRoaXMgcHJvcGVydHkgaXMgZmFsc2UsIG1lbW9yeSB1c2FnZVxyXG4gICAgICogYW5kIHRleHR1cmUgdXBsb2FkIHRpbWUgYXJlIHJlZHVjZWQuXHJcbiAgICAgKiBAbWVtYmVyb2YgSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZVxyXG4gICAgICogQHR5cGUge0Jvb2xlYW59XHJcbiAgICAgKiBAcmVhZG9ubHlcclxuICAgICAqL1xyXG4gICAgZ2V0IGhhc0FscGhhQ2hhbm5lbCgpIHtcclxuICAgICAgICByZXR1cm4gdHJ1ZTtcclxuICAgIH1cclxufTtcclxuXHJcbkltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlci5wcm90b3R5cGUuc2V0RXhjZXB0aW9uQ2FsbGJhY2sgPVxyXG4gICAgZnVuY3Rpb24gc2V0RXhjZXB0aW9uQ2FsbGJhY2soZXhjZXB0aW9uQ2FsbGJhY2spIHtcclxuICAgIFxyXG4gICAgdGhpcy5fZXhjZXB0aW9uQ2FsbGJhY2sgPSBleGNlcHRpb25DYWxsYmFjaztcclxufTtcclxuXHJcbkltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlci5wcm90b3R5cGUub3BlbiA9IGZ1bmN0aW9uIG9wZW4od2lkZ2V0T3JWaWV3ZXIpIHtcclxuICAgIGlmICh0aGlzLl91cGRhdGVGcnVzdHVtSW50ZXJ2YWxIYW5kbGUgIT09IG51bGwpIHtcclxuICAgICAgICB0aHJvdyBuZXcgRGV2ZWxvcGVyRXJyb3IoJ0Nhbm5vdCBzZXQgdHdvIHBhcmVudCB2aWV3ZXJzLicpO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBpZiAod2lkZ2V0T3JWaWV3ZXIgPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIHRocm93IG5ldyBEZXZlbG9wZXJFcnJvcignd2lkZ2V0T3JWaWV3ZXIgc2hvdWxkIGJlIGdpdmVuLiBJdCBpcyAnICtcclxuICAgICAgICAgICAgJ25lZWRlZCBmb3IgZnJ1c3R1bSBjYWxjdWxhdGlvbiBmb3IgdGhlIHByaW9yaXR5IG1lY2hhbmlzbScpO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICB0aGlzLl9pbWFnZURlY29kZXIub3Blbih0aGlzLl91cmwpXHJcblx0XHQudGhlbih0aGlzLl9vcGVuZWQuYmluZCh0aGlzKSlcclxuXHRcdC5jYXRjaCh0aGlzLl9vbkV4Y2VwdGlvbi5iaW5kKHRoaXMpKTtcclxuICAgIFxyXG4gICAgdGhpcy5fY2VzaXVtV2lkZ2V0ID0gd2lkZ2V0T3JWaWV3ZXI7XHJcbiAgICBcclxuICAgIHRoaXMuX3VwZGF0ZUZydXN0dW1JbnRlcnZhbEhhbmRsZSA9IHNldEludGVydmFsKFxyXG4gICAgICAgIHRoaXMuX3NldFByaW9yaXR5QnlGcnVzdHVtLmJpbmQodGhpcyksXHJcbiAgICAgICAgdGhpcy5fdXBkYXRlRnJ1c3R1bUludGVydmFsKTtcclxufTtcclxuXHJcbkltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlci5wcm90b3R5cGUuY2xvc2UgPSBmdW5jdGlvbiBjbG9zZSgpIHtcclxuICAgIGNsZWFySW50ZXJ2YWwodGhpcy5fdXBkYXRlRnJ1c3R1bUludGVydmFsSGFuZGxlKTtcclxuICAgIHRoaXMuX2ltYWdlRGVjb2Rlci5jbG9zZSgpO1xyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5nZXRUaWxlV2lkdGggPSBmdW5jdGlvbiBnZXRUaWxlV2lkdGgoKSB7XHJcbiAgICByZXR1cm4gdGhpcy50aWxlV2lkdGg7XHJcbn07XHJcblxyXG5JbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlLmdldFRpbGVIZWlnaHQgPSBmdW5jdGlvbiBnZXRUaWxlSGVpZ2h0KCkge1xyXG4gICAgcmV0dXJuIHRoaXMudGlsZUhlaWdodDtcclxufTtcclxuXHJcbkltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlci5wcm90b3R5cGUuZ2V0TWF4aW11bUxldmVsID0gZnVuY3Rpb24gZ2V0TWF4aW11bUxldmVsKCkge1xyXG4gICAgcmV0dXJuIHRoaXMubWF4aW11bUxldmVsO1xyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5nZXRNaW5pbXVtTGV2ZWwgPSBmdW5jdGlvbiBnZXRNaW5pbXVtTGV2ZWwoKSB7XHJcbiAgICByZXR1cm4gdGhpcy5taW5pbXVtTGV2ZWw7XHJcbn07XHJcblxyXG5JbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlLmdldFVybCA9IGZ1bmN0aW9uIGdldFVybCgpIHtcclxuICAgIHJldHVybiB0aGlzLnVybDtcclxufTtcclxuXHJcbkltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlci5wcm90b3R5cGUuZ2V0UHJveHkgPSBmdW5jdGlvbiBnZXRQcm94eSgpIHtcclxuICAgIHJldHVybiB0aGlzLnByb3h5O1xyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5pc1JlYWR5ID0gZnVuY3Rpb24gaXNSZWFkeSgpIHtcclxuICAgIHJldHVybiB0aGlzLnJlYWR5O1xyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5nZXRDcmVkaXQgPSBmdW5jdGlvbiBnZXRDcmVkaXQoKSB7XHJcbiAgICByZXR1cm4gdGhpcy5jcmVkaXQ7XHJcbn07XHJcblxyXG5JbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlLmdldFJlY3RhbmdsZSA9IGZ1bmN0aW9uIGdldFJlY3RhbmdsZSgpIHtcclxuICAgIHJldHVybiB0aGlzLnRpbGluZ1NjaGVtZS5yZWN0YW5nbGU7XHJcbn07XHJcblxyXG5JbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlLmdldFRpbGluZ1NjaGVtZSA9IGZ1bmN0aW9uIGdldFRpbGluZ1NjaGVtZSgpIHtcclxuICAgIHJldHVybiB0aGlzLnRpbGluZ1NjaGVtZTtcclxufTtcclxuXHJcbkltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlci5wcm90b3R5cGUuZ2V0VGlsZURpc2NhcmRQb2xpY3kgPSBmdW5jdGlvbiBnZXRUaWxlRGlzY2FyZFBvbGljeSgpIHtcclxuICAgIHJldHVybiB0aGlzLnRpbGVEaXNjYXJkUG9saWN5O1xyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5nZXRFcnJvckV2ZW50ID0gZnVuY3Rpb24gZ2V0RXJyb3JFdmVudCgpIHtcclxuICAgIHJldHVybiB0aGlzLmVycm9yRXZlbnQ7XHJcbn07XHJcblxyXG5JbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlLmdldEhhc0FscGhhQ2hhbm5lbCA9IGZ1bmN0aW9uIGdldEhhc0FscGhhQ2hhbm5lbCgpIHtcclxuICAgIHJldHVybiB0aGlzLmhhc0FscGhhQ2hhbm5lbDtcclxufTtcclxuXHJcbi8qKlxyXG4gKiBHZXRzIHRoZSBjcmVkaXRzIHRvIGJlIGRpc3BsYXllZCB3aGVuIGEgZ2l2ZW4gdGlsZSBpcyBkaXNwbGF5ZWQuXHJcbiAqXHJcbiAqIEBwYXJhbSB7TnVtYmVyfSB4IFRoZSB0aWxlIFggY29vcmRpbmF0ZS5cclxuICogQHBhcmFtIHtOdW1iZXJ9IHkgVGhlIHRpbGUgWSBjb29yZGluYXRlLlxyXG4gKiBAcGFyYW0ge051bWJlcn0gbGV2ZWwgVGhlIHRpbGUgbGV2ZWw7XHJcbiAqIEByZXR1cm5zIHtDcmVkaXRbXX0gVGhlIGNyZWRpdHMgdG8gYmUgZGlzcGxheWVkIHdoZW4gdGhlIHRpbGUgaXMgZGlzcGxheWVkLlxyXG4gKlxyXG4gKiBAZXhjZXB0aW9uIHtEZXZlbG9wZXJFcnJvcn0gPGNvZGU+Z2V0VGlsZUNyZWRpdHM8L2NvZGU+IG11c3Qgbm90IGJlIGNhbGxlZCBiZWZvcmUgdGhlIGltYWdlcnkgcHJvdmlkZXIgaXMgcmVhZHkuXHJcbiAqL1xyXG5JbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlLmdldFRpbGVDcmVkaXRzID0gZnVuY3Rpb24oeCwgeSwgbGV2ZWwpIHtcclxuICAgIHJldHVybiB1bmRlZmluZWQ7XHJcbn07XHJcblxyXG4vKipcclxuICogUmVxdWVzdHMgdGhlIGltYWdlIGZvciBhIGdpdmVuIHRpbGUuICBUaGlzIGZ1bmN0aW9uIHNob3VsZFxyXG4gKiBub3QgYmUgY2FsbGVkIGJlZm9yZSB7QGxpbmsgSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyI3JlYWR5fSByZXR1cm5zIHRydWUuXHJcbiAqXHJcbiAqIEBwYXJhbSB7TnVtYmVyfSB4IFRoZSB0aWxlIFggY29vcmRpbmF0ZS5cclxuICogQHBhcmFtIHtOdW1iZXJ9IHkgVGhlIHRpbGUgWSBjb29yZGluYXRlLlxyXG4gKiBAcGFyYW0ge051bWJlcn0gbGV2ZWwgVGhlIHRpbGUgbGV2ZWwuXHJcbiAqIEByZXR1cm5zIHtQcm9taXNlfSBBIHByb21pc2UgZm9yIHRoZSBpbWFnZSB0aGF0IHdpbGwgcmVzb2x2ZSB3aGVuIHRoZSBpbWFnZSBpcyBhdmFpbGFibGUsIG9yXHJcbiAqICAgICAgICAgIHVuZGVmaW5lZCBpZiB0aGVyZSBhcmUgdG9vIG1hbnkgYWN0aXZlIHJlcXVlc3RzIHRvIHRoZSBzZXJ2ZXIsIGFuZCB0aGUgcmVxdWVzdFxyXG4gKiAgICAgICAgICBzaG91bGQgYmUgcmV0cmllZCBsYXRlci4gIFRoZSByZXNvbHZlZCBpbWFnZSBtYXkgYmUgZWl0aGVyIGFuXHJcbiAqICAgICAgICAgIEltYWdlIG9yIGEgQ2FudmFzIERPTSBvYmplY3QuXHJcbiAqXHJcbiAqIEBleGNlcHRpb24ge0RldmVsb3BlckVycm9yfSA8Y29kZT5yZXF1ZXN0SW1hZ2U8L2NvZGU+IG11c3Qgbm90IGJlIGNhbGxlZCBiZWZvcmUgdGhlIGltYWdlcnkgcHJvdmlkZXIgaXMgcmVhZHkuXHJcbiAqL1xyXG5JbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlLnJlcXVlc3RJbWFnZSA9IGZ1bmN0aW9uKHgsIHksIGNlc2l1bUxldmVsKSB7XHJcbiAgICAvLz4+aW5jbHVkZVN0YXJ0KCdkZWJ1ZycsIHByYWdtYXMuZGVidWcpO1xyXG4gICAgaWYgKCF0aGlzLl9yZWFkeSkge1xyXG4gICAgICAgIHRocm93IG5ldyBEZXZlbG9wZXJFcnJvcigncmVxdWVzdEltYWdlIG11c3Qgbm90IGJlIGNhbGxlZCBiZWZvcmUgdGhlIGltYWdlcnkgcHJvdmlkZXIgaXMgcmVhZHkuJyk7XHJcbiAgICB9XHJcbiAgICAvLz4+aW5jbHVkZUVuZCgnZGVidWcnKTtcclxuICAgIFxyXG4gICAgdmFyIHNlbGYgPSB0aGlzO1xyXG4gICAgXHJcbiAgICB2YXIgbGV2ZWxGYWN0b3IgPSBNYXRoLnBvdygyLCB0aGlzLl9udW1SZXNvbHV0aW9uTGV2ZWxzIC0gY2VzaXVtTGV2ZWwgLSAxKTtcclxuICAgIHZhciBtaW5YID0geCAqIHRoaXMuX3RpbGVXaWR0aCAgKiBsZXZlbEZhY3RvcjtcclxuICAgIHZhciBtaW5ZID0geSAqIHRoaXMuX3RpbGVIZWlnaHQgKiBsZXZlbEZhY3RvcjtcclxuICAgIHZhciBtYXhYRXhjbHVzaXZlID0gKHggKyAxKSAqIHRoaXMuX3RpbGVXaWR0aCAgKiBsZXZlbEZhY3RvcjtcclxuICAgIHZhciBtYXhZRXhjbHVzaXZlID0gKHkgKyAxKSAqIHRoaXMuX3RpbGVIZWlnaHQgKiBsZXZlbEZhY3RvcjtcclxuICAgIFxyXG4gICAgdmFyIGFsaWduZWRQYXJhbXMgPSBpbWFnZUhlbHBlckZ1bmN0aW9ucy5hbGlnblBhcmFtc1RvVGlsZXNBbmRMZXZlbCh7XHJcbiAgICAgICAgbWluWDogbWluWCxcclxuICAgICAgICBtaW5ZOiBtaW5ZLFxyXG4gICAgICAgIG1heFhFeGNsdXNpdmU6IG1heFhFeGNsdXNpdmUsXHJcbiAgICAgICAgbWF4WUV4Y2x1c2l2ZTogbWF4WUV4Y2x1c2l2ZSxcclxuICAgICAgICBzY3JlZW5XaWR0aDogdGhpcy5fdGlsZVdpZHRoLFxyXG4gICAgICAgIHNjcmVlbkhlaWdodDogdGhpcy5fdGlsZUhlaWdodFxyXG4gICAgfSwgdGhpcy5faW1hZ2VEZWNvZGVyKTtcclxuICAgIFxyXG4gICAgdmFyIHNjYWxlZENhbnZhcyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2NhbnZhcycpO1xyXG4gICAgc2NhbGVkQ2FudmFzLndpZHRoID0gdGhpcy5fdGlsZVdpZHRoO1xyXG4gICAgc2NhbGVkQ2FudmFzLmhlaWdodCA9IHRoaXMuX3RpbGVIZWlnaHQ7XHJcbiAgICBcclxuICAgIHZhciBzY2FsZWRDb250ZXh0ID0gc2NhbGVkQ2FudmFzLmdldENvbnRleHQoJzJkJyk7XHJcbiAgICBzY2FsZWRDb250ZXh0LmNsZWFyUmVjdCgwLCAwLCB0aGlzLl90aWxlV2lkdGgsIHRoaXMuX3RpbGVIZWlnaHQpO1xyXG4gICAgXHJcbiAgICB2YXIgdGVtcFBpeGVsV2lkdGggID0gYWxpZ25lZFBhcmFtcy5pbWFnZVBhcnRQYXJhbXMubWF4WEV4Y2x1c2l2ZSAtIGFsaWduZWRQYXJhbXMuaW1hZ2VQYXJ0UGFyYW1zLm1pblg7XHJcbiAgICB2YXIgdGVtcFBpeGVsSGVpZ2h0ID0gYWxpZ25lZFBhcmFtcy5pbWFnZVBhcnRQYXJhbXMubWF4WUV4Y2x1c2l2ZSAtIGFsaWduZWRQYXJhbXMuaW1hZ2VQYXJ0UGFyYW1zLm1pblk7XHJcbiAgICBpZiAodGVtcFBpeGVsV2lkdGggPD0gMCB8fCB0ZW1wUGl4ZWxIZWlnaHQgPD0gMCkge1xyXG4gICAgICAgIHJldHVybiBzY2FsZWRDYW52YXM7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHZhciB0ZW1wQ2FudmFzID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnY2FudmFzJyk7XHJcbiAgICB0ZW1wQ2FudmFzLndpZHRoID0gdGVtcFBpeGVsV2lkdGg7XHJcbiAgICB0ZW1wQ2FudmFzLmhlaWdodCA9IHRlbXBQaXhlbEhlaWdodDtcclxuICAgIHZhciB0ZW1wQ29udGV4dCA9IHRlbXBDYW52YXMuZ2V0Q29udGV4dCgnMmQnKTtcclxuICAgIHRlbXBDb250ZXh0LmNsZWFyUmVjdCgwLCAwLCB0ZW1wUGl4ZWxXaWR0aCwgdGVtcFBpeGVsSGVpZ2h0KTtcclxuICAgIFxyXG4gICAgYWxpZ25lZFBhcmFtcy5pbWFnZVBhcnRQYXJhbXMucXVhbGl0eSA9IHRoaXMuX3F1YWxpdHk7XHJcbiAgICBhbGlnbmVkUGFyYW1zLmltYWdlUGFydFBhcmFtcy5yZXF1ZXN0UHJpb3JpdHlEYXRhID0ge1xyXG4gICAgICAgIGltYWdlUmVjdGFuZ2xlOiB0aGlzLl9yZWN0YW5nbGVcclxuICAgIH07XHJcbiAgICBcclxuICAgIHZhciByZXNvbHZlLCByZWplY3Q7XHJcbiAgICB2YXIgcmVxdWVzdFBpeGVsc1Byb21pc2UgPSBuZXcgUHJvbWlzZShmdW5jdGlvbihyZXNvbHZlXywgcmVqZWN0Xykge1xyXG4gICAgICAgIHJlc29sdmUgPSByZXNvbHZlXztcclxuICAgICAgICByZWplY3QgPSByZWplY3RfO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHNlbGYuX2ltYWdlRGVjb2Rlci5yZXF1ZXN0UGl4ZWxzUHJvZ3Jlc3NpdmUoXHJcbiAgICAgICAgICAgIGFsaWduZWRQYXJhbXMuaW1hZ2VQYXJ0UGFyYW1zLFxyXG4gICAgICAgICAgICBwaXhlbHNEZWNvZGVkQ2FsbGJhY2ssXHJcbiAgICAgICAgICAgIHRlcm1pbmF0ZWRDYWxsYmFjayk7XHJcbiAgICB9KTtcclxuICAgIFxyXG4gICAgZnVuY3Rpb24gcGl4ZWxzRGVjb2RlZENhbGxiYWNrKGRlY29kZWQpIHtcclxuICAgICAgICB2YXIgcGFydGlhbFRpbGVXaWR0aCA9IGRlY29kZWQuaW1hZ2VEYXRhLndpZHRoO1xyXG4gICAgICAgIHZhciBwYXJ0aWFsVGlsZUhlaWdodCA9IGRlY29kZWQuaW1hZ2VEYXRhLmhlaWdodDtcclxuXHJcbiAgICAgICAgaWYgKHBhcnRpYWxUaWxlV2lkdGggPiAwICYmIHBhcnRpYWxUaWxlSGVpZ2h0ID4gMCkge1xyXG4gICAgICAgICAgICB0ZW1wQ29udGV4dC5wdXRJbWFnZURhdGEoXHJcbiAgICAgICAgICAgICAgICBkZWNvZGVkLmltYWdlRGF0YSxcclxuICAgICAgICAgICAgICAgIGRlY29kZWQueEluT3JpZ2luYWxSZXF1ZXN0LFxyXG4gICAgICAgICAgICAgICAgZGVjb2RlZC55SW5PcmlnaW5hbFJlcXVlc3QpO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICBmdW5jdGlvbiB0ZXJtaW5hdGVkQ2FsbGJhY2soaXNBYm9ydGVkKSB7XHJcbiAgICAgICAgaWYgKGlzQWJvcnRlZCkge1xyXG4gICAgICAgICAgICByZWplY3QoJ0ZldGNoIHJlcXVlc3Qgb3IgZGVjb2RlIGFib3J0ZWQnKTtcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICBzY2FsZWRDb250ZXh0LmRyYXdJbWFnZShcclxuICAgICAgICAgICAgICAgIHRlbXBDYW52YXMsXHJcbiAgICAgICAgICAgICAgICAwLCAwLCB0ZW1wUGl4ZWxXaWR0aCwgdGVtcFBpeGVsSGVpZ2h0LFxyXG4gICAgICAgICAgICAgICAgYWxpZ25lZFBhcmFtcy5jcm9wcGVkU2NyZWVuLm1pblgsIGFsaWduZWRQYXJhbXMuY3JvcHBlZFNjcmVlbi5taW5ZLFxyXG4gICAgICAgICAgICAgICAgYWxpZ25lZFBhcmFtcy5jcm9wcGVkU2NyZWVuLm1heFhFeGNsdXNpdmUsIGFsaWduZWRQYXJhbXMuY3JvcHBlZFNjcmVlbi5tYXhZRXhjbHVzaXZlKTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICByZXNvbHZlKHNjYWxlZENhbnZhcyk7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiByZXF1ZXN0UGl4ZWxzUHJvbWlzZTtcclxufTtcclxuXHJcbkltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlci5wcm90b3R5cGUuX3NldFByaW9yaXR5QnlGcnVzdHVtID1cclxuICAgIGZ1bmN0aW9uIHNldFByaW9yaXR5QnlGcnVzdHVtKCkge1xyXG4gICAgXHJcbiAgICBpZiAoIXRoaXMuX3JlYWR5KSB7XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICB2YXIgZnJ1c3R1bURhdGEgPSBjYWxjdWxhdGVDZXNpdW1GcnVzdHVtKFxyXG4gICAgICAgIHRoaXMuX2Nlc2l1bVdpZGdldCwgdGhpcyk7XHJcbiAgICBcclxuICAgIGlmIChmcnVzdHVtRGF0YSA9PT0gbnVsbCkge1xyXG4gICAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIFxyXG4gICAgZnJ1c3R1bURhdGEuaW1hZ2VSZWN0YW5nbGUgPSB0aGlzLmdldFJlY3RhbmdsZSgpO1xyXG4gICAgZnJ1c3R1bURhdGEuZXhhY3RsZXZlbCA9IG51bGw7XHJcblxyXG4gICAgdGhpcy5faW1hZ2VEZWNvZGVyLnNldEZldGNoUHJpb3JpdGl6ZXJEYXRhKGZydXN0dW1EYXRhKTtcclxuICAgIHRoaXMuX2ltYWdlRGVjb2Rlci5zZXREZWNvZGVQcmlvcml0aXplckRhdGEoZnJ1c3R1bURhdGEpO1xyXG59O1xyXG5cclxuLyoqXHJcbiAqIFBpY2tpbmcgZmVhdHVyZXMgaXMgbm90IGN1cnJlbnRseSBzdXBwb3J0ZWQgYnkgdGhpcyBpbWFnZXJ5IHByb3ZpZGVyLCBzbyB0aGlzIGZ1bmN0aW9uIHNpbXBseSByZXR1cm5zXHJcbiAqIHVuZGVmaW5lZC5cclxuICpcclxuICogQHBhcmFtIHtOdW1iZXJ9IHggVGhlIHRpbGUgWCBjb29yZGluYXRlLlxyXG4gKiBAcGFyYW0ge051bWJlcn0geSBUaGUgdGlsZSBZIGNvb3JkaW5hdGUuXHJcbiAqIEBwYXJhbSB7TnVtYmVyfSBsZXZlbCBUaGUgdGlsZSBsZXZlbC5cclxuICogQHBhcmFtIHtOdW1iZXJ9IGxvbmdpdHVkZSBUaGUgbG9uZ2l0dWRlIGF0IHdoaWNoIHRvIHBpY2sgZmVhdHVyZXMuXHJcbiAqIEBwYXJhbSB7TnVtYmVyfSBsYXRpdHVkZSAgVGhlIGxhdGl0dWRlIGF0IHdoaWNoIHRvIHBpY2sgZmVhdHVyZXMuXHJcbiAqIEByZXR1cm4ge1Byb21pc2V9IEEgcHJvbWlzZSBmb3IgdGhlIHBpY2tlZCBmZWF0dXJlcyB0aGF0IHdpbGwgcmVzb2x2ZSB3aGVuIHRoZSBhc3luY2hyb25vdXNcclxuICogICAgICAgICAgICAgICAgICAgcGlja2luZyBjb21wbGV0ZXMuICBUaGUgcmVzb2x2ZWQgdmFsdWUgaXMgYW4gYXJyYXkgb2Yge0BsaW5rIEltYWdlcnlMYXllckZlYXR1cmVJbmZvfVxyXG4gKiAgICAgICAgICAgICAgICAgICBpbnN0YW5jZXMuICBUaGUgYXJyYXkgbWF5IGJlIGVtcHR5IGlmIG5vIGZlYXR1cmVzIGFyZSBmb3VuZCBhdCB0aGUgZ2l2ZW4gbG9jYXRpb24uXHJcbiAqICAgICAgICAgICAgICAgICAgIEl0IG1heSBhbHNvIGJlIHVuZGVmaW5lZCBpZiBwaWNraW5nIGlzIG5vdCBzdXBwb3J0ZWQuXHJcbiAqL1xyXG5JbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlLnBpY2tGZWF0dXJlcyA9IGZ1bmN0aW9uKCkge1xyXG4gICAgICAgIHJldHVybiB1bmRlZmluZWQ7XHJcbn07XHJcblxyXG5JbWFnZURlY29kZXJJbWFnZXJ5UHJvdmlkZXIucHJvdG90eXBlLl9vbkV4Y2VwdGlvbiA9IGZ1bmN0aW9uIG9uRXhjZXB0aW9uKHJlYXNvbikge1xyXG4gICAgaWYgKHRoaXMuX2V4Y2VwdGlvbkNhbGxiYWNrICE9PSBudWxsKSB7XHJcblx0XHR0aGlzLl9leGNlcHRpb25DYWxsYmFjayhyZWFzb24pO1xyXG4gICAgfVxyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyLnByb3RvdHlwZS5fb3BlbmVkID0gZnVuY3Rpb24gb3BlbmVkKCkge1xyXG4gICAgaWYgKHRoaXMuX3JlYWR5KSB7XHJcbiAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckltYWdlcnlQcm92aWRlciBlcnJvcjogb3BlbmVkKCkgd2FzIGNhbGxlZCBtb3JlIHRoYW4gb25jZSEnO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICB0aGlzLl9yZWFkeSA9IHRydWU7XHJcblxyXG4gICAgLy8gVGhpcyBpcyB3cm9uZyBpZiBDT0Qgb3IgQ09DIGV4aXN0cyBiZXNpZGVzIG1haW4gaGVhZGVyIENPRFxyXG4gICAgdGhpcy5fbnVtUmVzb2x1dGlvbkxldmVscyA9IHRoaXMuX2ltYWdlRGVjb2Rlci5nZXROdW1SZXNvbHV0aW9uTGV2ZWxzRm9yTGltaXR0ZWRWaWV3ZXIoKTtcclxuICAgIHRoaXMuX3F1YWxpdHkgPSB0aGlzLl9pbWFnZURlY29kZXIuZ2V0SGlnaGVzdFF1YWxpdHkoKTtcclxuICAgIHZhciBtYXhpbXVtQ2VzaXVtTGV2ZWwgPSB0aGlzLl9udW1SZXNvbHV0aW9uTGV2ZWxzIC0gMTtcclxuICAgICAgICBcclxuICAgIHRoaXMuX3RpbGVXaWR0aCA9IHRoaXMuX2ltYWdlRGVjb2Rlci5nZXRUaWxlV2lkdGgoKTtcclxuICAgIHRoaXMuX3RpbGVIZWlnaHQgPSB0aGlzLl9pbWFnZURlY29kZXIuZ2V0VGlsZUhlaWdodCgpO1xyXG4gICAgICAgIFxyXG4gICAgdmFyIGJlc3RMZXZlbCA9IHRoaXMuX2ltYWdlRGVjb2Rlci5nZXRJbWFnZUxldmVsKCk7XHJcbiAgICB2YXIgYmVzdExldmVsV2lkdGggID0gdGhpcy5faW1hZ2VEZWNvZGVyLmdldEltYWdlV2lkdGggKCk7XHJcbiAgICB2YXIgYmVzdExldmVsSGVpZ2h0ID0gdGhpcy5faW1hZ2VEZWNvZGVyLmdldEltYWdlSGVpZ2h0KCk7XHJcbiAgICBcclxuICAgIHZhciBsb3dlc3RMZXZlbFRpbGVzWCA9IE1hdGguY2VpbChiZXN0TGV2ZWxXaWR0aCAgLyB0aGlzLl90aWxlV2lkdGggKSA+PiBtYXhpbXVtQ2VzaXVtTGV2ZWw7XHJcbiAgICB2YXIgbG93ZXN0TGV2ZWxUaWxlc1kgPSBNYXRoLmNlaWwoYmVzdExldmVsSGVpZ2h0IC8gdGhpcy5fdGlsZUhlaWdodCkgPj4gbWF4aW11bUNlc2l1bUxldmVsO1xyXG5cclxuICAgIGltYWdlSGVscGVyRnVuY3Rpb25zLmZpeEJvdW5kcyhcclxuICAgICAgICB0aGlzLl9yZWN0YW5nbGUsXHJcbiAgICAgICAgdGhpcy5faW1hZ2VEZWNvZGVyLFxyXG4gICAgICAgIHRoaXMuX2FkYXB0UHJvcG9ydGlvbnMpO1xyXG4gICAgdmFyIHJlY3RhbmdsZVdpZHRoICA9IHRoaXMuX3JlY3RhbmdsZS5lYXN0ICAtIHRoaXMuX3JlY3RhbmdsZS53ZXN0O1xyXG4gICAgdmFyIHJlY3RhbmdsZUhlaWdodCA9IHRoaXMuX3JlY3RhbmdsZS5ub3J0aCAtIHRoaXMuX3JlY3RhbmdsZS5zb3V0aDtcclxuICAgIFxyXG4gICAgdmFyIGJlc3RMZXZlbFNjYWxlID0gMSA8PCBtYXhpbXVtQ2VzaXVtTGV2ZWw7XHJcbiAgICB2YXIgcGl4ZWxzV2lkdGhGb3JDZXNpdW0gID0gdGhpcy5fdGlsZVdpZHRoICAqIGxvd2VzdExldmVsVGlsZXNYICogYmVzdExldmVsU2NhbGU7XHJcbiAgICB2YXIgcGl4ZWxzSGVpZ2h0Rm9yQ2VzaXVtID0gdGhpcy5fdGlsZUhlaWdodCAqIGxvd2VzdExldmVsVGlsZXNZICogYmVzdExldmVsU2NhbGU7XHJcbiAgICBcclxuICAgIC8vIENlc2l1bSB3b3JrcyB3aXRoIGZ1bGwgdGlsZXMgb25seSwgdGh1cyBmaXggdGhlIGdlb2dyYXBoaWMgYm91bmRzIHNvXHJcbiAgICAvLyB0aGUgcGl4ZWxzIGxpZXMgZXhhY3RseSBvbiB0aGUgb3JpZ2luYWwgYm91bmRzXHJcbiAgICBcclxuICAgIHZhciBnZW9ncmFwaGljV2lkdGhGb3JDZXNpdW0gPVxyXG4gICAgICAgIHJlY3RhbmdsZVdpZHRoICogcGl4ZWxzV2lkdGhGb3JDZXNpdW0gLyBiZXN0TGV2ZWxXaWR0aDtcclxuICAgIHZhciBnZW9ncmFwaGljSGVpZ2h0Rm9yQ2VzaXVtID1cclxuICAgICAgICByZWN0YW5nbGVIZWlnaHQgKiBwaXhlbHNIZWlnaHRGb3JDZXNpdW0gLyBiZXN0TGV2ZWxIZWlnaHQ7XHJcbiAgICBcclxuICAgIHZhciBmaXhlZEVhc3QgID0gdGhpcy5fcmVjdGFuZ2xlLndlc3QgICsgZ2VvZ3JhcGhpY1dpZHRoRm9yQ2VzaXVtO1xyXG4gICAgdmFyIGZpeGVkU291dGggPSB0aGlzLl9yZWN0YW5nbGUubm9ydGggLSBnZW9ncmFwaGljSGVpZ2h0Rm9yQ2VzaXVtO1xyXG4gICAgXHJcbiAgICB0aGlzLl90aWxpbmdTY2hlbWVQYXJhbXMgPSB7XHJcbiAgICAgICAgd2VzdDogdGhpcy5fcmVjdGFuZ2xlLndlc3QsXHJcbiAgICAgICAgZWFzdDogZml4ZWRFYXN0LFxyXG4gICAgICAgIHNvdXRoOiBmaXhlZFNvdXRoLFxyXG4gICAgICAgIG5vcnRoOiB0aGlzLl9yZWN0YW5nbGUubm9ydGgsXHJcbiAgICAgICAgbGV2ZWxaZXJvVGlsZXNYOiBsb3dlc3RMZXZlbFRpbGVzWCxcclxuICAgICAgICBsZXZlbFplcm9UaWxlc1k6IGxvd2VzdExldmVsVGlsZXNZLFxyXG4gICAgICAgIG1heGltdW1MZXZlbDogbWF4aW11bUNlc2l1bUxldmVsXHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICB0aGlzLl90aWxpbmdTY2hlbWUgPSBjcmVhdGVUaWxpbmdTY2hlbWUodGhpcy5fdGlsaW5nU2NoZW1lUGFyYW1zKTtcclxuICAgICAgICBcclxuICAgIENlc2l1bS5UaWxlUHJvdmlkZXJFcnJvci5oYW5kbGVTdWNjZXNzKHRoaXMuX2Vycm9yRXZlbnQpO1xyXG59O1xyXG5cclxuZnVuY3Rpb24gY3JlYXRlVGlsaW5nU2NoZW1lKHBhcmFtcykge1xyXG4gICAgdmFyIGdlb2dyYXBoaWNSZWN0YW5nbGVGb3JDZXNpdW0gPSBuZXcgQ2VzaXVtLlJlY3RhbmdsZShcclxuICAgICAgICBwYXJhbXMud2VzdCwgcGFyYW1zLnNvdXRoLCBwYXJhbXMuZWFzdCwgcGFyYW1zLm5vcnRoKTtcclxuICAgIFxyXG4gICAgdmFyIHRpbGluZ1NjaGVtZSA9IG5ldyBDZXNpdW0uR2VvZ3JhcGhpY1RpbGluZ1NjaGVtZSh7XHJcbiAgICAgICAgcmVjdGFuZ2xlOiBnZW9ncmFwaGljUmVjdGFuZ2xlRm9yQ2VzaXVtLFxyXG4gICAgICAgIG51bWJlck9mTGV2ZWxaZXJvVGlsZXNYOiBwYXJhbXMubGV2ZWxaZXJvVGlsZXNYLFxyXG4gICAgICAgIG51bWJlck9mTGV2ZWxaZXJvVGlsZXNZOiBwYXJhbXMubGV2ZWxaZXJvVGlsZXNZXHJcbiAgICB9KTtcclxuICAgIFxyXG4gICAgcmV0dXJuIHRpbGluZ1NjaGVtZTtcclxufSIsIid1c2Ugc3RyaWN0JztcclxuXHJcbnZhciBJbWFnZURlY29kZXIgPSByZXF1aXJlKCdpbWFnZS1kZWNvZGVyLmpzJyk7XHJcbnZhciBXb3JrZXJQcm94eUltYWdlRGVjb2RlciA9IHJlcXVpcmUoJ3dvcmtlci1wcm94eS1pbWFnZS1kZWNvZGVyLmpzJyk7XHJcbnZhciBpbWFnZUhlbHBlckZ1bmN0aW9ucyA9IHJlcXVpcmUoJ2ltYWdlLWhlbHBlci1mdW5jdGlvbnMuanMnKTtcclxuXHJcbm1vZHVsZS5leHBvcnRzLkltYWdlRGVjb2RlciA9IEltYWdlRGVjb2RlcjtcclxubW9kdWxlLmV4cG9ydHMuV29ya2VyUHJveHlJbWFnZURlY29kZXIgPSBXb3JrZXJQcm94eUltYWdlRGVjb2RlclxyXG5tb2R1bGUuZXhwb3J0cy5JbWFnZURlY29kZXJWaWV3ZXIgPSByZXF1aXJlKCdpbWFnZS1kZWNvZGVyLXZpZXdlci5qcycpO1xyXG5cclxubW9kdWxlLmV4cG9ydHMuU2ltcGxlRmV0Y2hlckJhc2UgPSByZXF1aXJlKCdzaW1wbGUtZmV0Y2hlci1iYXNlLmpzJyk7XHJcbm1vZHVsZS5leHBvcnRzLkdyaWRJbWFnZUJhc2UgPSByZXF1aXJlKCdncmlkLWltYWdlLWJhc2UuanMnKTtcclxubW9kdWxlLmV4cG9ydHMuR3JpZEZldGNoZXJCYXNlID0gcmVxdWlyZSgnZ3JpZC1mZXRjaGVyLWJhc2UuanMnKTtcclxubW9kdWxlLmV4cG9ydHMuR3JpZERlY29kZXJXb3JrZXJCYXNlID0gcmVxdWlyZSgnZ3JpZC1kZWNvZGVyLXdvcmtlci1iYXNlLmpzJyk7XHJcbm1vZHVsZS5leHBvcnRzLkdyaWRMZXZlbENhbGN1bGF0b3IgPSByZXF1aXJlKCdncmlkLWxldmVsLWNhbGN1bGF0b3IuanMnKTtcclxuXHJcbm1vZHVsZS5leHBvcnRzLkNlc2l1bUltYWdlRGVjb2RlckxheWVyTWFuYWdlciA9IHJlcXVpcmUoJ2Nlc2l1bS1pbWFnZS1kZWNvZGVyLWxheWVyLW1hbmFnZXIuanMnKTtcclxubW9kdWxlLmV4cG9ydHMuSW1hZ2VEZWNvZGVySW1hZ2VyeVByb3ZpZGVyID0gcmVxdWlyZSgnaW1hZ2UtZGVjb2Rlci1pbWFnZXJ5LXByb3ZpZGVyLmpzJyk7XHJcbm1vZHVsZS5leHBvcnRzLkltYWdlRGVjb2RlclJlZ2lvbkxheWVyID0gcmVxdWlyZSgnaW1hZ2UtZGVjb2Rlci1yZWdpb24tbGF5ZXIuanMnKTsiLCIndXNlIHN0cmljdCc7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IERlY29kZUpvYjtcclxuXHJcbnZhciBMaW5rZWRMaXN0ID0gcmVxdWlyZSgnbGlua2VkLWxpc3QuanMnKTtcclxuXHJcbnZhciByZXF1ZXN0SWRDb3VudGVyID0gMDtcclxuXHJcbmZ1bmN0aW9uIERlY29kZUpvYihsaXN0ZW5lckhhbmRsZSwgaW1hZ2VQYXJ0UGFyYW1zKSB7XHJcbiAgICB0aGlzLl9wcm9ncmVzc2l2ZVN0YWdlc0RvbmUgPSAwO1xyXG4gICAgdGhpcy5fbGlzdGVuZXJIYW5kbGUgPSBsaXN0ZW5lckhhbmRsZTtcclxuICAgIHRoaXMuX2ltYWdlUGFydFBhcmFtcyA9IGltYWdlUGFydFBhcmFtcztcclxuICAgIHRoaXMuX2FsbFJlbGV2YW50Qnl0ZXNMb2FkZWQgPSAwO1xyXG4gICAgdmFyIHJlcXVlc3RQYXJhbXMgPSBsaXN0ZW5lckhhbmRsZS5pbWFnZVBhcnRQYXJhbXM7XHJcbiAgICB0aGlzLl9vZmZzZXRYID0gaW1hZ2VQYXJ0UGFyYW1zLm1pblggLSByZXF1ZXN0UGFyYW1zLm1pblg7XHJcbiAgICB0aGlzLl9vZmZzZXRZID0gaW1hZ2VQYXJ0UGFyYW1zLm1pblkgLSByZXF1ZXN0UGFyYW1zLm1pblk7XHJcbiAgICB0aGlzLl9yZXF1ZXN0V2lkdGggPSByZXF1ZXN0UGFyYW1zLm1heFhFeGNsdXNpdmUgLSByZXF1ZXN0UGFyYW1zLm1pblg7XHJcbiAgICB0aGlzLl9yZXF1ZXN0SGVpZ2h0ID0gcmVxdWVzdFBhcmFtcy5tYXhZRXhjbHVzaXZlIC0gcmVxdWVzdFBhcmFtcy5taW5ZO1xyXG59XHJcblxyXG5EZWNvZGVKb2IucHJvdG90eXBlLm9uRGF0YSA9IGZ1bmN0aW9uIG9uRGF0YShkZWNvZGVSZXN1bHQpIHtcclxuICAgICsrdGhpcy5fcHJvZ3Jlc3NpdmVTdGFnZXNEb25lO1xyXG5cclxuICAgIHZhciByZWxldmFudEJ5dGVzTG9hZGVkRGlmZiA9XHJcbiAgICAgICAgZGVjb2RlUmVzdWx0LmFsbFJlbGV2YW50Qnl0ZXNMb2FkZWQgLSB0aGlzLl9hbGxSZWxldmFudEJ5dGVzTG9hZGVkO1xyXG4gICAgdGhpcy5fYWxsUmVsZXZhbnRCeXRlc0xvYWRlZCA9IGRlY29kZVJlc3VsdC5hbGxSZWxldmFudEJ5dGVzTG9hZGVkO1xyXG4gICAgdGhpcy5fbGlzdGVuZXJIYW5kbGUuYWxsUmVsZXZhbnRCeXRlc0xvYWRlZCArPSByZWxldmFudEJ5dGVzTG9hZGVkRGlmZjtcclxuICAgIFxyXG4gICAgdmFyIGRlY29kZWRPZmZzZXR0ZWQgPSB7XHJcbiAgICAgICAgb3JpZ2luYWxSZXF1ZXN0V2lkdGg6IHRoaXMuX3JlcXVlc3RXaWR0aCxcclxuICAgICAgICBvcmlnaW5hbFJlcXVlc3RIZWlnaHQ6IHRoaXMuX3JlcXVlc3RIZWlnaHQsXHJcbiAgICAgICAgeEluT3JpZ2luYWxSZXF1ZXN0OiB0aGlzLl9vZmZzZXRYLFxyXG4gICAgICAgIHlJbk9yaWdpbmFsUmVxdWVzdDogdGhpcy5fb2Zmc2V0WSxcclxuICAgICAgICBcclxuICAgICAgICBpbWFnZURhdGE6IGRlY29kZVJlc3VsdCxcclxuICAgICAgICBcclxuICAgICAgICBhbGxSZWxldmFudEJ5dGVzTG9hZGVkOiB0aGlzLl9saXN0ZW5lckhhbmRsZS5hbGxSZWxldmFudEJ5dGVzTG9hZGVkXHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICB0aGlzLl9saXN0ZW5lckhhbmRsZS5jYWxsYmFjayhkZWNvZGVkT2Zmc2V0dGVkKTtcclxufTtcclxuXHJcbkRlY29kZUpvYi5wcm90b3R5cGUub25UZXJtaW5hdGVkID0gZnVuY3Rpb24gb25UZXJtaW5hdGVkKCkge1xyXG4gICAgLy90aGlzLl9saXN0ZW5lckhhbmRsZS5pc0FueURlY29kZXJBYm9ydGVkIHw9IHRoaXMuX2lzQWJvcnRlZDtcclxuICAgIFxyXG4gICAgdmFyIHJlbWFpbmluZyA9IC0tdGhpcy5fbGlzdGVuZXJIYW5kbGUucmVtYWluaW5nRGVjb2RlSm9icztcclxuICAgIGlmIChyZW1haW5pbmcgPCAwKSB7XHJcbiAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogSW5jb25zaXN0ZW50IG51bWJlciBvZiBkb25lIHJlcXVlc3RzJztcclxuICAgIH1cclxuICAgIFxyXG4gICAgdmFyIGlzTGlzdGVuZXJEb25lID0gcmVtYWluaW5nID09PSAwO1xyXG4gICAgaWYgKGlzTGlzdGVuZXJEb25lKSB7XHJcbiAgICAgICAgdGhpcy5fbGlzdGVuZXJIYW5kbGUuaXNUZXJtaW5hdGVkQ2FsbGJhY2tDYWxsZWQgPSB0cnVlO1xyXG4gICAgICAgIHRoaXMuX2xpc3RlbmVySGFuZGxlLnRlcm1pbmF0ZWRDYWxsYmFjayhcclxuICAgICAgICAgICAgdGhpcy5fbGlzdGVuZXJIYW5kbGUuaXNBbnlEZWNvZGVyQWJvcnRlZCk7XHJcbiAgICB9XHJcbn07XHJcblxyXG5PYmplY3QuZGVmaW5lUHJvcGVydHkoRGVjb2RlSm9iLnByb3RvdHlwZSwgJ2ltYWdlUGFydFBhcmFtcycsIHtcclxuXHRnZXQ6IGZ1bmN0aW9uIGdldEltYWdlUGFydFBhcmFtcygpIHtcclxuXHRcdHJldHVybiB0aGlzLl9pbWFnZVBhcnRQYXJhbXM7XHJcblx0fVxyXG59KTtcclxuXHJcbk9iamVjdC5kZWZpbmVQcm9wZXJ0eShEZWNvZGVKb2IucHJvdG90eXBlLCAncHJvZ3Jlc3NpdmVTdGFnZXNEb25lJywge1xyXG5cdGdldDogZnVuY3Rpb24gZ2V0UHJvZ3Jlc3NpdmVTdGFnZXNEb25lKCkge1xyXG5cdFx0cmV0dXJuIHRoaXMuX3Byb2dyZXNzaXZlU3RhZ2VzRG9uZTtcclxuXHR9XHJcbn0pOyIsIid1c2Ugc3RyaWN0JztcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gRGVjb2RlSm9ic1Bvb2w7XHJcblxyXG52YXIgRGVjb2RlSm9iID0gcmVxdWlyZSgnZGVjb2RlLWpvYi5qcycpO1xyXG5cclxuZnVuY3Rpb24gRGVjb2RlSm9ic1Bvb2woXHJcbiAgICBkZWNvZGVEZXBlbmRlbmN5V29ya2VycyxcclxuXHRwcmlvcml0aXplcixcclxuICAgIHRpbGVXaWR0aCxcclxuICAgIHRpbGVIZWlnaHQpIHtcclxuICAgIFxyXG5cdHRoaXMuX3ByaW9yaXRpemVyID0gcHJpb3JpdGl6ZXI7XHJcbiAgICB0aGlzLl90aWxlV2lkdGggPSB0aWxlV2lkdGg7XHJcbiAgICB0aGlzLl90aWxlSGVpZ2h0ID0gdGlsZUhlaWdodDtcclxuICAgIFxyXG4gICAgdGhpcy5fZGVjb2RlRGVwZW5kZW5jeVdvcmtlcnMgPSBkZWNvZGVEZXBlbmRlbmN5V29ya2VycztcclxufVxyXG5cclxuRGVjb2RlSm9ic1Bvb2wucHJvdG90eXBlLmZvcmtEZWNvZGVKb2JzID0gZnVuY3Rpb24gZm9ya0RlY29kZUpvYnMoXHJcbiAgICBpbWFnZVBhcnRQYXJhbXMsXHJcbiAgICBjYWxsYmFjayxcclxuICAgIHRlcm1pbmF0ZWRDYWxsYmFjayxcclxuICAgIGltYWdlUGFydFBhcmFtc05vdE5lZWRlZCkge1xyXG4gICAgXHJcbiAgICB2YXIgbWluWCA9IGltYWdlUGFydFBhcmFtcy5taW5YO1xyXG4gICAgdmFyIG1pblkgPSBpbWFnZVBhcnRQYXJhbXMubWluWTtcclxuICAgIHZhciBtYXhYID0gaW1hZ2VQYXJ0UGFyYW1zLm1heFhFeGNsdXNpdmU7XHJcbiAgICB2YXIgbWF4WSA9IGltYWdlUGFydFBhcmFtcy5tYXhZRXhjbHVzaXZlO1xyXG4gICAgdmFyIGxldmVsID0gaW1hZ2VQYXJ0UGFyYW1zLmxldmVsIHx8IDA7XHJcbiAgICB2YXIgcXVhbGl0eSA9IGltYWdlUGFydFBhcmFtcy5xdWFsaXR5O1xyXG4gICAgdmFyIHByaW9yaXR5RGF0YSA9IGltYWdlUGFydFBhcmFtcy5yZXF1ZXN0UHJpb3JpdHlEYXRhO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICB2YXIgaXNNaW5BbGlnbmVkID1cclxuICAgICAgICBtaW5YICUgdGhpcy5fdGlsZVdpZHRoID09PSAwICYmIG1pblkgJSB0aGlzLl90aWxlSGVpZ2h0ID09PSAwO1xyXG4gICAgdmFyIGlzTWF4WEFsaWduZWQgPSBtYXhYICUgdGhpcy5fdGlsZVdpZHRoICA9PT0gMCB8fCBtYXhYID09PSBpbWFnZVBhcnRQYXJhbXMubGV2ZWxXaWR0aDtcclxuICAgIHZhciBpc01heFlBbGlnbmVkID0gbWF4WSAlIHRoaXMuX3RpbGVIZWlnaHQgPT09IDAgfHwgbWF4WSA9PT0gaW1hZ2VQYXJ0UGFyYW1zLmxldmVsSGVpZ2h0O1xyXG4gICAgdmFyIGlzT3JkZXJWYWxpZCA9IG1pblggPCBtYXhYICYmIG1pblkgPCBtYXhZO1xyXG4gICAgXHJcbiAgICBpZiAoIWlzTWluQWxpZ25lZCB8fCAhaXNNYXhYQWxpZ25lZCB8fCAhaXNNYXhZQWxpZ25lZCB8fCAhaXNPcmRlclZhbGlkKSB7XHJcbiAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogaW1hZ2VQYXJ0UGFyYW1zIGZvciBkZWNvZGVycyBpcyBub3QgYWxpZ25lZCB0byAnICtcclxuICAgICAgICAgICAgJ3RpbGUgc2l6ZSBvciBub3QgaW4gdmFsaWQgb3JkZXInO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICB2YXIgbnVtVGlsZXNYID0gTWF0aC5jZWlsKChtYXhYIC0gbWluWCkgLyB0aGlzLl90aWxlV2lkdGgpO1xyXG4gICAgdmFyIG51bVRpbGVzWSA9IE1hdGguY2VpbCgobWF4WSAtIG1pblkpIC8gdGhpcy5fdGlsZUhlaWdodCk7XHJcbiAgICBcclxuICAgIHZhciBsaXN0ZW5lckhhbmRsZSA9IHtcclxuICAgICAgICBpbWFnZVBhcnRQYXJhbXM6IGltYWdlUGFydFBhcmFtcyxcclxuICAgICAgICBjYWxsYmFjazogY2FsbGJhY2ssXHJcbiAgICAgICAgdGVybWluYXRlZENhbGxiYWNrOiB0ZXJtaW5hdGVkQ2FsbGJhY2ssXHJcbiAgICAgICAgcmVtYWluaW5nRGVjb2RlSm9iczogbnVtVGlsZXNYICogbnVtVGlsZXNZLFxyXG4gICAgICAgIGlzQW55RGVjb2RlckFib3J0ZWQ6IGZhbHNlLFxyXG4gICAgICAgIGlzVGVybWluYXRlZENhbGxiYWNrQ2FsbGVkOiBmYWxzZSxcclxuICAgICAgICBhbGxSZWxldmFudEJ5dGVzTG9hZGVkOiAwLFxyXG4gICAgICAgIHRhc2tDb250ZXh0czogW11cclxuICAgIH07XHJcbiAgICBcclxuICAgIGZvciAodmFyIHggPSBtaW5YOyB4IDwgbWF4WDsgeCArPSB0aGlzLl90aWxlV2lkdGgpIHtcclxuICAgICAgICB2YXIgc2luZ2xlVGlsZU1heFggPSBNYXRoLm1pbih4ICsgdGhpcy5fdGlsZVdpZHRoLCBpbWFnZVBhcnRQYXJhbXMubGV2ZWxXaWR0aCk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgZm9yICh2YXIgeSA9IG1pblk7IHkgPCBtYXhZOyB5ICs9IHRoaXMuX3RpbGVIZWlnaHQpIHtcclxuICAgICAgICAgICAgdmFyIHNpbmdsZVRpbGVNYXhZID0gTWF0aC5taW4oeSArIHRoaXMuX3RpbGVIZWlnaHQsIGltYWdlUGFydFBhcmFtcy5sZXZlbEhlaWdodCk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICB2YXIgaXNUaWxlTm90TmVlZGVkID0gaXNVbm5lZWRlZChcclxuICAgICAgICAgICAgICAgIHgsXHJcbiAgICAgICAgICAgICAgICB5LFxyXG4gICAgICAgICAgICAgICAgc2luZ2xlVGlsZU1heFgsXHJcbiAgICAgICAgICAgICAgICBzaW5nbGVUaWxlTWF4WSxcclxuICAgICAgICAgICAgICAgIGltYWdlUGFydFBhcmFtc05vdE5lZWRlZCk7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgaWYgKGlzVGlsZU5vdE5lZWRlZCkge1xyXG4gICAgICAgICAgICAgICAgLS1saXN0ZW5lckhhbmRsZS5yZW1haW5pbmdEZWNvZGVKb2JzO1xyXG4gICAgICAgICAgICAgICAgY29udGludWU7XHJcbiAgICAgICAgICAgIH1cclxuXHRcdFx0XHJcbiAgICAgICAgICAgIHZhciBzaW5nbGVUaWxlSW1hZ2VQYXJ0UGFyYW1zID0ge1xyXG4gICAgICAgICAgICAgICAgbWluWDogeCxcclxuICAgICAgICAgICAgICAgIG1pblk6IHksXHJcbiAgICAgICAgICAgICAgICBtYXhYRXhjbHVzaXZlOiBzaW5nbGVUaWxlTWF4WCxcclxuICAgICAgICAgICAgICAgIG1heFlFeGNsdXNpdmU6IHNpbmdsZVRpbGVNYXhZLFxyXG4gICAgICAgICAgICAgICAgbGV2ZWxXaWR0aDogaW1hZ2VQYXJ0UGFyYW1zLmxldmVsV2lkdGgsXHJcbiAgICAgICAgICAgICAgICBsZXZlbEhlaWdodDogaW1hZ2VQYXJ0UGFyYW1zLmxldmVsSGVpZ2h0LFxyXG4gICAgICAgICAgICAgICAgbGV2ZWw6IGxldmVsLFxyXG4gICAgICAgICAgICAgICAgcXVhbGl0eTogcXVhbGl0eSxcclxuICAgICAgICAgICAgICAgIHJlcXVlc3RQcmlvcml0eURhdGE6IHByaW9yaXR5RGF0YVxyXG4gICAgICAgICAgICB9O1xyXG5cclxuXHRcdFx0dGhpcy5fc3RhcnROZXdUYXNrKGxpc3RlbmVySGFuZGxlLCBzaW5nbGVUaWxlSW1hZ2VQYXJ0UGFyYW1zKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgXHJcbiAgICBpZiAoIWxpc3RlbmVySGFuZGxlLmlzVGVybWluYXRlZENhbGxiYWNrQ2FsbGVkICYmXHJcbiAgICAgICAgbGlzdGVuZXJIYW5kbGUucmVtYWluaW5nRGVjb2RlSm9icyA9PT0gMCkge1xyXG4gICAgICAgIFxyXG4gICAgICAgIGxpc3RlbmVySGFuZGxlLmlzVGVybWluYXRlZENhbGxiYWNrQ2FsbGVkID0gdHJ1ZTtcclxuICAgICAgICBsaXN0ZW5lckhhbmRsZS50ZXJtaW5hdGVkQ2FsbGJhY2sobGlzdGVuZXJIYW5kbGUuaXNBbnlEZWNvZGVyQWJvcnRlZCk7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHJldHVybiBsaXN0ZW5lckhhbmRsZTtcclxufTtcclxuXHJcbkRlY29kZUpvYnNQb29sLnByb3RvdHlwZS5fc3RhcnROZXdUYXNrID0gZnVuY3Rpb24gc3RhcnROZXdUYXNrKGxpc3RlbmVySGFuZGxlLCBpbWFnZVBhcnRQYXJhbXMpIHtcclxuXHR2YXIgZGVjb2RlSm9iID0gbmV3IERlY29kZUpvYihsaXN0ZW5lckhhbmRsZSwgaW1hZ2VQYXJ0UGFyYW1zKTtcclxuXHR2YXIgdGFza0NvbnRleHQgPSB0aGlzLl9kZWNvZGVEZXBlbmRlbmN5V29ya2Vycy5zdGFydFRhc2soaW1hZ2VQYXJ0UGFyYW1zLCBkZWNvZGVKb2IpO1xyXG5cdGxpc3RlbmVySGFuZGxlLnRhc2tDb250ZXh0cy5wdXNoKHRhc2tDb250ZXh0KTtcclxuXHRcclxuXHRpZiAodGhpcy5fcHJpb3JpdGl6ZXIgPT09IG51bGwpIHtcclxuXHRcdHJldHVybjtcclxuXHR9XHJcblx0XHJcblx0dmFyIHNlbGYgPSB0aGlzO1xyXG5cdFxyXG5cdHRhc2tDb250ZXh0LnNldFByaW9yaXR5Q2FsY3VsYXRvcihmdW5jdGlvbigpIHtcclxuXHRcdHJldHVybiBzZWxmLl9wcmlvcml0aXplci5nZXRQcmlvcml0eShkZWNvZGVKb2IpO1xyXG5cdH0pO1xyXG59O1xyXG5cclxuRGVjb2RlSm9ic1Bvb2wucHJvdG90eXBlLnVucmVnaXN0ZXJGb3JrZWRKb2JzID0gZnVuY3Rpb24gdW5yZWdpc3RlckZvcmtlZEpvYnMoXHJcbiAgICBsaXN0ZW5lckhhbmRsZSkge1xyXG4gICAgICAgICAgICBcclxuICAgIGlmIChsaXN0ZW5lckhhbmRsZS5yZW1haW5pbmdEZWNvZGVKb2JzID09PSAwKSB7XHJcbiAgICAgICAgLy8gQWxsIGpvYnMgaGFzIGFscmVhZHkgYmVlbiB0ZXJtaW5hdGVkLCBubyBuZWVkIHRvIHVucmVnaXN0ZXJcclxuICAgICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgbGlzdGVuZXJIYW5kbGUudGFza0NvbnRleHRzLmxlbmd0aDsgKytpKSB7XHJcbiAgICAgICAgbGlzdGVuZXJIYW5kbGUudGFza0NvbnRleHRzW2ldLnVucmVnaXN0ZXIoKTtcclxuICAgIH1cclxufTtcclxuXHJcbmZ1bmN0aW9uIGlzVW5uZWVkZWQoXHJcbiAgICBtaW5YLCBtaW5ZLCBtYXhYLCBtYXhZLCBpbWFnZVBhcnRQYXJhbXNOb3ROZWVkZWQpIHtcclxuICAgIFxyXG4gICAgaWYgKGltYWdlUGFydFBhcmFtc05vdE5lZWRlZCA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IGltYWdlUGFydFBhcmFtc05vdE5lZWRlZC5sZW5ndGg7ICsraSkge1xyXG4gICAgICAgIHZhciBub3ROZWVkZWQgPSBpbWFnZVBhcnRQYXJhbXNOb3ROZWVkZWRbaV07XHJcbiAgICAgICAgdmFyIGlzSW5YID0gbWluWCA+PSBub3ROZWVkZWQubWluWCAmJiBtYXhYIDw9IG5vdE5lZWRlZC5tYXhYRXhjbHVzaXZlO1xyXG4gICAgICAgIHZhciBpc0luWSA9IG1pblkgPj0gbm90TmVlZGVkLm1pblkgJiYgbWF4WSA8PSBub3ROZWVkZWQubWF4WUV4Y2x1c2l2ZTtcclxuICAgICAgICBcclxuICAgICAgICBpZiAoaXNJblggJiYgaXNJblkpIHtcclxuICAgICAgICAgICAgcmV0dXJuIHRydWU7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgXHJcbiAgICByZXR1cm4gZmFsc2U7XHJcbn0iLCIndXNlIHN0cmljdCc7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IEZldGNoQ29udGV4dEFwaTtcclxuXHJcbmZ1bmN0aW9uIEZldGNoQ29udGV4dEFwaSgpIHtcclxuXHR0aGlzLl9ldmVudHMgPSB7XHJcblx0XHRpc1Byb2dyZXNzaXZlQ2hhbmdlZDogW10sXHJcblx0XHRtb3ZlOiBbXSxcclxuXHRcdHRlcm1pbmF0ZTogW10sXHJcblx0XHRcclxuXHRcdHN0b3A6IFtdLFxyXG5cdFx0cmVzdW1lOiBbXSxcclxuXHRcdFxyXG5cdFx0aW50ZXJuYWxTdG9wcGVkOiBbXSxcclxuXHRcdGludGVybmFsRG9uZTogW11cclxuXHR9O1xyXG59XHJcblxyXG5GZXRjaENvbnRleHRBcGkucHJvdG90eXBlLnN0b3BwZWQgPSBmdW5jdGlvbiBzdG9wcGVkKCkge1xyXG5cdHRoaXMuX29uRXZlbnQoJ2ludGVybmFsU3RvcHBlZCcsIC8qaXNBYm9ydGVkPSovZmFsc2UpO1xyXG59O1xyXG5cclxuRmV0Y2hDb250ZXh0QXBpLnByb3RvdHlwZS5kb25lID0gZnVuY3Rpb24gZG9uZSgpIHtcclxuXHR0aGlzLl9vbkV2ZW50KCdpbnRlcm5hbERvbmUnKTtcclxufTtcclxuXHJcbkZldGNoQ29udGV4dEFwaS5wcm90b3R5cGUub24gPSBmdW5jdGlvbiBvbihldmVudCwgbGlzdGVuZXIsIGxpc3RlbmVyVGhpcykge1xyXG5cdHZhciBsaXN0ZW5lcnMgPSB0aGlzLl9ldmVudHNbZXZlbnRdO1xyXG5cdGlmICghbGlzdGVuZXJzKSB7XHJcblx0XHR0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBldmVudCAnICsgZXZlbnQgKyAnIGRvZXMgbm90IGV4aXN0IGluIEZldGNoQ29udGV4dCc7XHJcblx0fVxyXG5cdGxpc3RlbmVycy5wdXNoKHtcclxuXHRcdGxpc3RlbmVyOiBsaXN0ZW5lcixcclxuXHRcdGxpc3RlbmVyVGhpczogbGlzdGVuZXJUaGlzIHx8IHRoaXNcclxuXHR9KTtcclxufTtcclxuXHJcbkZldGNoQ29udGV4dEFwaS5wcm90b3R5cGUuX29uRXZlbnQgPSBmdW5jdGlvbiBvbkV2ZW50KGV2ZW50LCBhcmcxLCBhcmcyKSB7XHJcblx0dmFyIGxpc3RlbmVycyA9IHRoaXMuX2V2ZW50c1tldmVudF07XHJcblx0Zm9yICh2YXIgaSA9IDA7IGkgPCBsaXN0ZW5lcnMubGVuZ3RoOyArK2kpIHtcclxuXHRcdGxpc3RlbmVyc1tpXS5saXN0ZW5lci5jYWxsKGxpc3RlbmVyc1tpXS5saXN0ZW5lclRoaXMsIGFyZzEsIGFyZzIpO1xyXG5cdH1cclxufTsiLCIndXNlIHN0cmljdCc7XHJcblxyXG52YXIgRmV0Y2hDb250ZXh0QXBpID0gcmVxdWlyZSgnZmV0Y2gtY29udGV4dC1hcGkuanMnKTtcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gRmV0Y2hDb250ZXh0O1xyXG5cclxuRmV0Y2hDb250ZXh0LkZFVENIX1RZUEVfUkVRVUVTVCA9IDE7XHJcbkZldGNoQ29udGV4dC5GRVRDSF9UWVBFX01PVkFCTEUgPSAyOyAvLyBtb3ZhYmxlXHJcbkZldGNoQ29udGV4dC5GRVRDSF9UWVBFX09OTFlfV0FJVF9GT1JfREFUQSA9IDM7XHJcblxyXG5GZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX1dBSVRfRk9SX0ZFVENIX0NBTEwgPSAxO1xyXG5GZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX01PVkFCTEVfV0FJVF9GT1JfTU9WRV9DQUxMID0gMjtcclxuRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19SRVFVRVNUX1dBSVRfRk9SX1NDSEVEVUxFID0gMztcclxuRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19BQ1RJVkUgPSA0O1xyXG5GZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX1JFUVVFU1RfQUJPVVRfVE9fWUlFTEQgPSA1O1xyXG5GZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX1JFUVVFU1RfWUlFTERFRCA9IDY7XHJcbkZldGNoQ29udGV4dC5GRVRDSF9TVEFUVVNfUkVRVUVTVF9BQk9VVF9UT19BQk9SVCA9IDc7XHJcbkZldGNoQ29udGV4dC5GRVRDSF9TVEFUVVNfUkVRVUVTVF9URVJNSU5BVEVEID0gODtcclxuRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19VTkVYUEVDVEVEX0ZBSUxVUkUgPSA5O1xyXG5cclxuZnVuY3Rpb24gRmV0Y2hDb250ZXh0KGZldGNoZXIsIGZldGNoZXJDbG9zZXIsIHNjaGVkdWxlciwgc2NoZWR1bGVkSm9ic0xpc3QsIGZldGNoVHlwZSwgY29udGV4dFZhcnMpIHtcclxuICAgIHRoaXMuX2ZldGNoZXIgPSBmZXRjaGVyO1xyXG4gICAgdGhpcy5fZmV0Y2hlckNsb3NlciA9IGZldGNoZXJDbG9zZXI7XHJcbiAgICB0aGlzLl9zY2hlZHVsZXIgPSBzY2hlZHVsZXI7XHJcbiAgICB0aGlzLl9zY2hlZHVsZWRKb2JzTGlzdCA9IHNjaGVkdWxlZEpvYnNMaXN0O1xyXG4gICAgdGhpcy5fc2NoZWR1bGVkSm9ic0xpc3RJdGVyYXRvciA9IG51bGw7XHJcbiAgICBcclxuICAgIHRoaXMuX3Rlcm1pbmF0ZWRMaXN0ZW5lcnMgPSBbXTtcclxuICAgIFxyXG4gICAgdGhpcy5faW1hZ2VQYXJ0UGFyYW1zID0gbnVsbDtcclxuICAgIFxyXG4gICAgdGhpcy5fc3RhdGUgPSBGZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX1dBSVRfRk9SX0ZFVENIX0NBTEw7XHJcbiAgICB0aGlzLl9pc01vdmFibGUgPSBmZXRjaFR5cGUgPT09IEZldGNoQ29udGV4dC5GRVRDSF9UWVBFX01PVkFCTEU7XHJcbiAgICB0aGlzLl9jb250ZXh0VmFycyA9IGNvbnRleHRWYXJzO1xyXG4gICAgdGhpcy5faXNPbmx5V2FpdEZvckRhdGEgPSBmZXRjaFR5cGUgPT09IEZldGNoQ29udGV4dC5GRVRDSF9UWVBFX09OTFlfV0FJVF9GT1JfREFUQTtcclxuICAgIHRoaXMuX3VzZVNjaGVkdWxlciA9IGZldGNoVHlwZSA9PT0gRmV0Y2hDb250ZXh0LkZFVENIX1RZUEVfUkVRVUVTVDtcclxuICAgIHRoaXMuX3Jlc291cmNlID0gbnVsbDtcclxuICAgIHRoaXMuX2ZldGNoQ29udGV4dEFwaSA9IG51bGw7XHJcbiAgICAvL3RoaXMuX2FscmVhZHlUZXJtaW5hdGVkV2hlbkFsbERhdGFBcnJpdmVkID0gZmFsc2U7XHJcbn1cclxuXHJcbkZldGNoQ29udGV4dC5wcm90b3R5cGUuZmV0Y2ggPSBmdW5jdGlvbiBmZXRjaChpbWFnZVBhcnRQYXJhbXMpIHtcclxuICAgIGlmICh0aGlzLl9pc01vdmFibGUpIHtcclxuICAgICAgICB0aGlzLl9pbWFnZVBhcnRQYXJhbXMgPSBpbWFnZVBhcnRQYXJhbXM7XHJcbiAgICAgICAgdGhpcy5fc3RhcnRGZXRjaCgpO1xyXG4gICAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIFxyXG4gICAgaWYgKHRoaXMuX2ltYWdlUGFydFBhcmFtcyAhPT0gbnVsbCkge1xyXG4gICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IENhbm5vdCBmZXRjaCB0d2ljZSBvbiBmZXRjaCB0eXBlIG9mIFwicmVxdWVzdFwiJztcclxuICAgIH1cclxuICAgIFxyXG4gICAgaWYgKHRoaXMuX3N0YXRlICE9PSBGZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX1dBSVRfRk9SX0ZFVENIX0NBTEwpIHtcclxuICAgICAgICB0aGlzLl9zdGF0ZSA9IEZldGNoQ29udGV4dC5GRVRDSF9TVEFUVVNfVU5FWFBFQ1RFRF9GQUlMVVJFO1xyXG4gICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IFVuZXhwZWN0ZWQgc3RhdGUgb24gZmV0Y2goKTogJyArIHRoaXMuX3N0YXRlO1xyXG4gICAgfVxyXG5cclxuICAgIHRoaXMuX2ltYWdlUGFydFBhcmFtcyA9IGltYWdlUGFydFBhcmFtcztcclxuICAgIHRoaXMuX3N0YXRlID0gRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19SRVFVRVNUX1dBSVRfRk9SX1NDSEVEVUxFO1xyXG4gICAgXHJcbiAgICBpZiAoIXRoaXMuX3VzZVNjaGVkdWxlcikge1xyXG4gICAgICAgIHN0YXJ0UmVxdWVzdCgvKnJlc291cmNlPSovbnVsbCwgdGhpcyk7XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICB0aGlzLl9zY2hlZHVsZXIuZW5xdWV1ZUpvYihzdGFydFJlcXVlc3QsIHRoaXMsIGZldGNoQWJvcnRlZEJ5U2NoZWR1bGVyKTtcclxufTtcclxuXHJcbkZldGNoQ29udGV4dC5wcm90b3R5cGUubWFudWFsQWJvcnRSZXF1ZXN0ID0gZnVuY3Rpb24gbWFudWFsQWJvcnRSZXF1ZXN0KCkge1xyXG4gICAgc3dpdGNoICh0aGlzLl9zdGF0ZSkge1xyXG4gICAgICAgIGNhc2UgRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19SRVFVRVNUX1RFUk1JTkFURUQ6XHJcbiAgICAgICAgY2FzZSBGZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX1VORVhQRUNURURfRkFJTFVSRTpcclxuICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgIGNhc2UgRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19SRVFVRVNUX0FCT1VUX1RPX0FCT1JUOlxyXG4gICAgICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBEb3VibGUgY2FsbCB0byBtYW51YWxBYm9ydFJlcXVlc3QoKSc7XHJcbiAgICAgICAgY2FzZSBGZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX0FDVElWRTpcclxuICAgICAgICAgICAgdGhpcy5fc3RhdGUgPSBGZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX1JFUVVFU1RfQUJPVVRfVE9fQUJPUlQ7XHJcbiAgICAgICAgICAgIGlmICh0aGlzLl9pc09ubHlXYWl0Rm9yRGF0YSkge1xyXG4gICAgICAgICAgICAgICAgdGhpcy5fZmV0Y2hTdG9wcGVkKC8qaXNBYm9ydGVkPSovdHJ1ZSk7XHJcbiAgICAgICAgICAgIH0gZWxzZSB7XHJcblx0XHRcdFx0dGhpcy5fZmV0Y2hDb250ZXh0QXBpLl9vbkV2ZW50KCdzdG9wJywgLyppc0Fib3J0ZWQ9Ki90cnVlKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBicmVhaztcclxuICAgICAgICBjYXNlIEZldGNoQ29udGV4dC5GRVRDSF9TVEFUVVNfV0FJVF9GT1JfRkVUQ0hfQ0FMTDpcclxuICAgICAgICAgICAgdGhpcy5fc3RhdGUgPSBGZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX1JFUVVFU1RfVEVSTUlOQVRFRDtcclxuICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgIGNhc2UgRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19SRVFVRVNUX1dBSVRfRk9SX1NDSEVEVUxFOlxyXG4gICAgICAgIGNhc2UgRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19SRVFVRVNUX0FCT1VUX1RPX1lJRUxEOlxyXG4gICAgICAgIGNhc2UgRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19SRVFVRVNUX1lJRUxERUQ6XHJcbiAgICAgICAgICAgIHRoaXMuX3N0YXRlID0gRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19SRVFVRVNUX0FCT1VUX1RPX0FCT1JUO1xyXG4gICAgICAgICAgICBicmVhaztcclxuICAgICAgICBkZWZhdWx0OlxyXG4gICAgICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBVbmtub3duIHN0YXRlIGluIG1hbnVhbEFib3J0UmVxdWVzdCgpIGltcGxlbWVudGF0aW9uOiAnICsgdGhpcy5fc3RhdGU7XHJcbiAgICB9XHJcbn07XHJcblxyXG5GZXRjaENvbnRleHQucHJvdG90eXBlLmdldENvbnRleHRWYXJzID0gZnVuY3Rpb24gZ2V0Q29udGV4dFZhcnMoKSB7XHJcbiAgICByZXR1cm4gdGhpcy5fY29udGV4dFZhcnM7XHJcbn07XHJcblxyXG5GZXRjaENvbnRleHQucHJvdG90eXBlLm9uID0gZnVuY3Rpb24gb24oZXZlbnQsIGxpc3RlbmVyKSB7XHJcbiAgICBzd2l0Y2ggKGV2ZW50KSB7XHJcbiAgICAgICAgY2FzZSAndGVybWluYXRlZCc6XHJcbiAgICAgICAgICAgIHRoaXMuX3Rlcm1pbmF0ZWRMaXN0ZW5lcnMucHVzaChsaXN0ZW5lcik7XHJcbiAgICAgICAgICAgIGJyZWFrO1xyXG4gICAgICAgIGRlZmF1bHQ6XHJcbiAgICAgICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IFVuZXhwZWN0ZWQgZXZlbnQgJyArIGV2ZW50O1xyXG4gICAgfVxyXG59O1xyXG5cclxuRmV0Y2hDb250ZXh0LnByb3RvdHlwZS5zZXRJc1Byb2dyZXNzaXZlID0gZnVuY3Rpb24gc2V0SXNQcm9ncmVzc2l2ZShpc1Byb2dyZXNzaXZlKSB7XHJcbiAgICB0aGlzLl9pc1Byb2dyZXNzaXZlID0gaXNQcm9ncmVzc2l2ZTtcclxuICAgIGlmICh0aGlzLl9mZXRjaENvbnRleHRBcGkgIT09IG51bGwpIHtcclxuICAgICAgICB0aGlzLl9mZXRjaENvbnRleHRBcGkuX29uRXZlbnQoJ2lzUHJvZ3Jlc3NpdmVDaGFuZ2VkJywgaXNQcm9ncmVzc2l2ZSk7XHJcbiAgICB9XHJcbn07XHJcblxyXG5GZXRjaENvbnRleHQucHJvdG90eXBlLmdldElzUHJvZ3Jlc3NpdmUgPSBmdW5jdGlvbiBnZXRJc1Byb2dyZXNzaXZlKCkge1xyXG4gICAgcmV0dXJuIHRoaXMuX2lzUHJvZ3Jlc3NpdmU7XHJcbn07XHJcblxyXG5GZXRjaENvbnRleHQucHJvdG90eXBlLl9zdGFydEZldGNoID0gZnVuY3Rpb24gc3RhcnRGZXRjaCgpIHtcclxuICAgIHZhciBwcmV2U3RhdGUgPSB0aGlzLl9zdGF0ZTtcclxuICAgIHRoaXMuX3N0YXRlID0gRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19BQ1RJVkU7XHJcblx0XHJcbiAgICBpZiAocHJldlN0YXRlID09PSBGZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX1dBSVRfRk9SX0ZFVENIX0NBTEwgfHxcclxuICAgICAgICBwcmV2U3RhdGUgPT09IEZldGNoQ29udGV4dC5GRVRDSF9TVEFUVVNfTU9WQUJMRV9XQUlUX0ZPUl9NT1ZFX0NBTEwpIHtcclxuICAgICAgICBcclxuICAgICAgICB0aGlzLl9mZXRjaGVyQ2xvc2VyLmNoYW5nZUFjdGl2ZUZldGNoZXNDb3VudCgrMSk7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGlmICh0aGlzLl9pc09ubHlXYWl0Rm9yRGF0YSkge1xyXG4gICAgICAgIHRoaXMuX2ZldGNoQ29udGV4dEFwaSA9IHRoaXMuX2V4dHJhY3RBbHJlYWR5RmV0Y2hlZERhdGEoKTtcclxuICAgIH0gZWxzZSBpZiAoIXRoaXMuX2lzTW92YWJsZSB8fCBwcmV2U3RhdGUgPT09IEZldGNoQ29udGV4dC5GRVRDSF9TVEFUVVNfV0FJVF9GT1JfRkVUQ0hfQ0FMTCkge1xyXG5cdFx0aWYgKHRoaXMuX2ZldGNoQ29udGV4dEFwaSAhPT0gbnVsbCkge1xyXG5cdFx0XHR0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBDYW5ub3Qgc3RhcnQgZmV0Y2ggb2YgYWxyZWFkeSBzdGFydGVkIGZldGNoJztcclxuXHRcdH1cclxuXHJcbiAgICAgICAgdGhpcy5fZmV0Y2hDb250ZXh0QXBpID0gbmV3IEZldGNoQ29udGV4dEFwaSh0aGlzKTtcclxuXHRcdHRoaXMuX2ZldGNoQ29udGV4dEFwaS5vbignaW50ZXJuYWxTdG9wcGVkJywgdGhpcy5fZmV0Y2hTdG9wcGVkLCB0aGlzKTtcclxuXHRcdHRoaXMuX2ZldGNoQ29udGV4dEFwaS5vbignaW50ZXJuYWxEb25lJywgdGhpcy5fZmV0Y2hEb25lLCB0aGlzKTtcclxuXHRcdFxyXG5cdFx0aWYgKHRoaXMuX2lzTW92YWJsZSkge1xyXG5cdFx0XHR0aGlzLl9mZXRjaGVyLnN0YXJ0TW92YWJsZUZldGNoKHRoaXMuX2ZldGNoQ29udGV4dEFwaSwgdGhpcy5faW1hZ2VQYXJ0UGFyYW1zKTtcclxuXHRcdH0gZWxzZSB7XHJcblx0XHRcdHRoaXMuX2ZldGNoZXIuc3RhcnRGZXRjaCh0aGlzLl9mZXRjaENvbnRleHRBcGksIHRoaXMuX2ltYWdlUGFydFBhcmFtcyk7XHJcblx0XHR9XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICAgIHRoaXMuX2ZldGNoQ29udGV4dEFwaS5fb25FdmVudCgnbW92ZScsIHRoaXMuX2ltYWdlUGFydFBhcmFtcyk7XHJcbiAgICB9XHJcbiAgICBcclxuXHRpZiAodGhpcy5fZmV0Y2hDb250ZXh0QXBpICE9PSBudWxsKSB7IC8vIE1pZ2h0IGJlIHNldCB0byBudWxsIGluIGltbWVkaWF0ZSBjYWxsIG9mIGZldGNoVGVybWluYXRlZCBvbiBwcmV2aW91cyBsaW5lXHJcblx0XHR0aGlzLl9mZXRjaENvbnRleHRBcGkuX29uRXZlbnQoJ2lzUHJvZ3Jlc3NpdmVDaGFuZ2VkJywgdGhpcy5faXNQcm9ncmVzc2l2ZSk7XHJcblx0fVxyXG59O1xyXG5cclxuRmV0Y2hDb250ZXh0LnByb3RvdHlwZS5jaGVja0lmU2hvdWxkWWllbGQgPSBmdW5jdGlvbiBjaGVja0lmU2hvdWxkWWllbGQoKSB7XHJcbiAgICB0cnkge1xyXG4gICAgICAgIGlmICghdGhpcy5fdXNlU2NoZWR1bGVyIHx8IHRoaXMuX3N0YXRlID09PSBGZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX1JFUVVFU1RfVEVSTUlOQVRFRCkge1xyXG4gICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIGlmICh0aGlzLl9yZXNvdXJjZSA9PT0gbnVsbCkge1xyXG4gICAgICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBObyByZXNvdXJjZSBhbGxvY2F0ZWQgYnV0IGZldGNoIGNhbGxiYWNrIGNhbGxlZCc7XHJcbiAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICBpZiAoIXRoaXMuX3NjaGVkdWxlckNhbGxiYWNrcy5zaG91bGRZaWVsZE9yQWJvcnQoKSkge1xyXG4gICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHRoaXMuX3N0YXRlID0gRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19SRVFVRVNUX0FCT1VUX1RPX1lJRUxEO1xyXG5cdFx0dGhpcy5fZmV0Y2hDb250ZXh0QXBpLl9vbkV2ZW50KCdzdG9wJywgLyppc0Fib3J0ZWQ9Ki9mYWxzZSk7XHJcbiAgICB9IGNhdGNoIChlKSB7XHJcbiAgICAgICAgdGhpcy5fc3RhdGUgPSBGZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX1VORVhQRUNURURfRkFJTFVSRTtcclxuICAgICAgICBmZXRjaEFib3J0ZWRCeVNjaGVkdWxlcih0aGlzKTtcclxuICAgIH1cclxufTtcclxuXHJcbkZldGNoQ29udGV4dC5wcm90b3R5cGUuX2ZldGNoRG9uZSA9IGZ1bmN0aW9uIGZldGNoRG9uZSgpIHtcclxuICAgIHN3aXRjaCAodGhpcy5fc3RhdGUpIHtcclxuICAgICAgICBjYXNlIEZldGNoQ29udGV4dC5GRVRDSF9TVEFUVVNfUkVRVUVTVF9BQk9VVF9UT19BQk9SVDpcclxuICAgICAgICBjYXNlIEZldGNoQ29udGV4dC5GRVRDSF9TVEFUVVNfQUNUSVZFOlxyXG4gICAgICAgIGNhc2UgRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19SRVFVRVNUX0FCT1VUX1RPX1lJRUxEOlxyXG4gICAgICAgICAgICBicmVhaztcclxuICAgICAgICBkZWZhdWx0OlxyXG4gICAgICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBVbmV4cGVjdGVkIHN0YXRlIG9uIGZldGNoIGRvbmU6ICcgKyB0aGlzLl9zdGF0ZTtcclxuICAgIH1cclxuXHJcbiAgICBpZiAodGhpcy5faXNNb3ZhYmxlKSB7XHJcbiAgICAgICAgdGhpcy5fc3RhdGUgPSBGZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX01PVkFCTEVfV0FJVF9GT1JfTU9WRV9DQUxMO1xyXG4gICAgfVxyXG4gICAgdGhpcy5fZmV0Y2hlckNsb3Nlci5jaGFuZ2VBY3RpdmVGZXRjaGVzQ291bnQoLTEpO1xyXG5cclxuXHRpZiAodGhpcy5fcmVzb3VyY2UgIT09IG51bGwpIHtcclxuICAgICAgICB0aGlzLl9zY2hlZHVsZWRKb2JzTGlzdC5yZW1vdmUodGhpcy5fc2NoZWR1bGVkSm9ic0xpc3RJdGVyYXRvcik7XHJcbiAgICAgICAgdGhpcy5fc2NoZWR1bGVyQ2FsbGJhY2tzLmpvYkRvbmUoKTtcclxuXHJcbiAgICAgICAgdGhpcy5fcmVzb3VyY2UgPSBudWxsO1xyXG4gICAgfSBlbHNlIGlmICh0aGlzLl91c2VTY2hlZHVsZXIpIHtcclxuICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBKb2IgZXhwZWN0ZWQgdG8gaGF2ZSByZXNvdXJjZSBvbiBzdWNjZXNzZnVsIHRlcm1pbmF0aW9uJztcclxuICAgIH1cclxuXHRcclxuXHR0aGlzLl90ZXJtaW5hdGVOb25Nb3ZhYmxlRmV0Y2goKTtcclxufTtcclxuXHJcbkZldGNoQ29udGV4dC5wcm90b3R5cGUuX2ZldGNoU3RvcHBlZCA9IGZ1bmN0aW9uIGZldGNoU3RvcHBlZChpc0Fib3J0ZWQpIHtcclxuICAgIHN3aXRjaCAodGhpcy5fc3RhdGUpIHtcclxuICAgICAgICBjYXNlIEZldGNoQ29udGV4dC5GRVRDSF9TVEFUVVNfUkVRVUVTVF9BQk9VVF9UT19BQk9SVDpcclxuXHRcdFx0aXNBYm9ydGVkID0gdHJ1ZTsgLy8gZm9yY2UgYWJvcnRlZFxyXG4gICAgICAgICAgICBicmVhaztcclxuICAgICAgICBjYXNlIEZldGNoQ29udGV4dC5GRVRDSF9TVEFUVVNfUkVRVUVTVF9BQk9VVF9UT19ZSUVMRDpcclxuXHRcdFx0dmFyIGlzWWllbGRlZCA9IHRoaXMuX3NjaGVkdWxlckNhbGxiYWNrcy50cnlZaWVsZChcclxuXHRcdFx0XHRjb250aW51ZVlpZWxkZWRSZXF1ZXN0LFxyXG5cdFx0XHRcdGZldGNoQWJvcnRlZEJ5U2NoZWR1bGVyLFxyXG5cdFx0XHRcdGZldGNoWWllbGRlZEJ5U2NoZWR1bGVyKTtcclxuXHRcdFx0XHJcblx0XHRcdGlmICghaXNZaWVsZGVkKSB7XHJcblx0XHRcdFx0aWYgKHRoaXMuX3N0YXRlICE9PSBGZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX1JFUVVFU1RfQUJPVVRfVE9fWUlFTEQpIHtcclxuXHRcdFx0XHRcdHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IFVuZXhwZWN0ZWQgc3RhdGUgb24gdHJ5WWllbGQoKSBmYWxzZTogJyArIHRoaXMuX3N0YXRlO1xyXG5cdFx0XHRcdH1cclxuXHRcdFx0XHR0aGlzLl9zdGF0ZSA9IEZldGNoQ29udGV4dC5GRVRDSF9TVEFUVVNfQUNUSVZFO1xyXG5cdFx0XHRcdHRoaXMuX2ZldGNoQ29udGV4dEFwaS5fb25FdmVudCgncmVzdW1lJyk7XHJcblx0XHRcdFx0cmV0dXJuO1xyXG5cdFx0XHR9XHJcbiAgICAgICAgICAgIGJyZWFrO1xyXG4gICAgICAgIGRlZmF1bHQ6XHJcbiAgICAgICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IFVuZXhwZWN0ZWQgc3RhdGUgb24gZmV0Y2ggc3RvcHBlZDogJyArIHRoaXMuX3N0YXRlO1xyXG4gICAgfVxyXG5cclxuICAgIFxyXG4gICAgaWYgKHRoaXMuX3Jlc291cmNlICE9PSBudWxsKSB7XHJcblx0XHR0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBVbmV4cGVjdGVkIHJlcXVlc3QgdGVybWluYXRpb24gd2l0aG91dCByZXNvdXJjZSBhbGxvY2F0ZWQnO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICB0aGlzLl9mZXRjaGVyQ2xvc2VyLmNoYW5nZUFjdGl2ZUZldGNoZXNDb3VudCgtMSk7XHJcbiAgICBpZiAodGhpcy5faXNNb3ZhYmxlKSB7XHJcbiAgICAgICAgdGhpcy5fc3RhdGUgPSBGZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX01PVkFCTEVfV0FJVF9GT1JfTU9WRV9DQUxMO1xyXG4gICAgfSBlbHNlIGlmICghaXNBYm9ydGVkKSB7XHJcblx0XHR0aGlzLl90ZXJtaW5hdGVOb25Nb3ZhYmxlRmV0Y2goKTtcclxuXHR9XHJcbn07XHJcbiAgXHJcbkZldGNoQ29udGV4dC5wcm90b3R5cGUuX3Rlcm1pbmF0ZU5vbk1vdmFibGVGZXRjaCA9IGZ1bmN0aW9uIHRlcm1pbmF0ZU5vbk1vdmFibGVGZXRjaCgpIHsgIFxyXG4gICAgaWYgKHRoaXMuX2lzTW92YWJsZSkge1xyXG5cdFx0cmV0dXJuO1xyXG5cdH1cclxuXHRcclxuXHR0aGlzLl9zdGF0ZSA9IEZldGNoQ29udGV4dC5GRVRDSF9TVEFUVVNfUkVRVUVTVF9URVJNSU5BVEVEO1xyXG5cdFxyXG5cdGZvciAodmFyIGkgPSAwOyBpIDwgdGhpcy5fdGVybWluYXRlZExpc3RlbmVycy5sZW5ndGg7ICsraSkge1xyXG5cdFx0dGhpcy5fdGVybWluYXRlZExpc3RlbmVyc1tpXSh0aGlzLl9jb250ZXh0VmFycyk7XHJcblx0fVxyXG4gICAgXHJcbiAgICBpZiAodGhpcy5fZmV0Y2hDb250ZXh0QXBpICE9PSBudWxsICYmXHJcbiAgICAgICAgdGhpcy5fc3RhdGUgIT09IEZldGNoQ29udGV4dC5GRVRDSF9TVEFUVVNfVU5FWFBFQ1RFRF9GQUlMVVJFKSB7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgIHRoaXMuX2ZldGNoQ29udGV4dEFwaS5fb25FdmVudCgndGVybWluYXRlJyk7XHJcbiAgICAgICAgdGhpcy5fZmV0Y2hDb250ZXh0QXBpID0gbnVsbDtcclxuICAgIH1cclxufTtcclxuXHJcbi8vIFByb3BlcnRpZXMgZm9yIEZydXN0dW1SZXF1ZXNldFByaW9yaXRpemVyXHJcblxyXG5PYmplY3QuZGVmaW5lUHJvcGVydHkoRmV0Y2hDb250ZXh0LnByb3RvdHlwZSwgJ2ltYWdlUGFydFBhcmFtcycsIHtcclxuICAgIGdldDogZnVuY3Rpb24gZ2V0SW1hZ2VQYXJ0UGFyYW1zKCkge1xyXG4gICAgICAgIHJldHVybiB0aGlzLl9pbWFnZVBhcnRQYXJhbXM7XHJcbiAgICB9XHJcbn0pO1xyXG5cclxuZnVuY3Rpb24gc3RhcnRSZXF1ZXN0KHJlc291cmNlLCBzZWxmLCBjYWxsYmFja3MpIHtcclxuICAgIGlmIChzZWxmLl9yZXNvdXJjZSAhPT0gbnVsbCkge1xyXG4gICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IFVuZXhwZWN0ZWQgcmVzdGFydCBvZiBhbHJlYWR5IHN0YXJ0ZWQgcmVxdWVzdCc7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGlmIChzZWxmLl9zdGF0ZSA9PT0gRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19SRVFVRVNUX0FCT1VUX1RPX0FCT1JUKSB7XHJcbiAgICAgICAgc2VsZi5fZmV0Y2hTdG9wcGVkKC8qaXNBYm9ydGVkPSovdHJ1ZSk7XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgfSBlbHNlIGlmIChzZWxmLl9zdGF0ZSAhPT0gRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19SRVFVRVNUX1dBSVRfRk9SX1NDSEVEVUxFKSB7XHJcbiAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogVW5leHBlY3RlZCBzdGF0ZSBvbiBzY2hlZHVsZTogJyArIHNlbGYuX3N0YXRlO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBzZWxmLl9yZXNvdXJjZSA9IHJlc291cmNlO1xyXG5cdHNlbGYuX3NjaGVkdWxlckNhbGxiYWNrcyA9IGNhbGxiYWNrcztcclxuXHJcbiAgICBpZiAocmVzb3VyY2UgIT09IG51bGwpIHtcclxuICAgICAgICBzZWxmLl9zY2hlZHVsZWRKb2JzTGlzdEl0ZXJhdG9yID0gc2VsZi5fc2NoZWR1bGVkSm9ic0xpc3QuYWRkKHNlbGYpO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBzZWxmLl9zdGFydEZldGNoKCk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGNvbnRpbnVlWWllbGRlZFJlcXVlc3QocmVzb3VyY2UsIHNlbGYpIHtcclxuICAgIGlmIChzZWxmLl9pc01vdmFibGUpIHtcclxuICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBVbmV4cGVjdGVkIGNhbGwgdG8gY29udGludWVZaWVsZGVkUmVxdWVzdCBvbiBtb3ZhYmxlIGZldGNoJztcclxuICAgIH1cclxuXHJcbiAgICBpZiAoc2VsZi5fc3RhdGUgPT09IEZldGNoQ29udGV4dC5GRVRDSF9TVEFUVVNfUkVRVUVTVF9BQk9VVF9UT19BQk9SVCB8fFxyXG4gICAgICAgIHNlbGYuX3N0YXRlID09PSBGZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX1VORVhQRUNURURfRkFJTFVSRSkge1xyXG4gICAgICAgIFxyXG4gICAgICAgIHNlbGYuX3NjaGVkdWxlckNhbGxiYWNrcy5qb2JEb25lKCk7XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBpZiAoc2VsZi5fc3RhdGUgIT09IEZldGNoQ29udGV4dC5GRVRDSF9TVEFUVVNfUkVRVUVTVF9ZSUVMREVEKSB7XHJcbiAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogVW5leHBlY3RlZCByZXF1ZXN0IHN0YXRlIG9uIGNvbnRpbnVlOiAnICsgc2VsZi5fc3RhdGU7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHNlbGYuX3N0YXRlID0gRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19BQ1RJVkU7XHJcbiAgICBzZWxmLl9yZXNvdXJjZSA9IHJlc291cmNlO1xyXG4gICAgXHJcbiAgICBzZWxmLl9zY2hlZHVsZWRKb2JzTGlzdEl0ZXJhdG9yID0gc2VsZi5fc2NoZWR1bGVkSm9ic0xpc3QuYWRkKHNlbGYpO1xyXG4gICAgc2VsZi5fb25FdmVudCgncmVzdW1lJyk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGZldGNoWWllbGRlZEJ5U2NoZWR1bGVyKHNlbGYpIHtcclxuICAgIHZhciBuZXh0U3RhdGU7XHJcbiAgICBzZWxmLl9yZXNvdXJjZSA9IG51bGw7XHJcbiAgICBzZWxmLl9zY2hlZHVsZWRKb2JzTGlzdC5yZW1vdmUoc2VsZi5fc2NoZWR1bGVkSm9ic0xpc3RJdGVyYXRvcik7XHJcbiAgICBpZiAoc2VsZi5zdGF0ZSA9PT0gRmV0Y2hDb250ZXh0LkZFVENIX1NUQVRVU19SRVFVRVNUX0FCT1VUX1RPX1lJRUxEKSB7XHJcbiAgICAgICAgc2VsZi5fc3RhdGUgPSBGZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX1JFUVVFU1RfWUlFTERFRDtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgICAgc2VsZi5fc3RhdGUgPSBGZXRjaENvbnRleHQuRkVUQ0hfU1RBVFVTX1VORVhQRUNURURfRkFJTFVSRTtcclxuICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBVbmV4cGVjdGVkIHJlcXVlc3Qgc3RhdGUgb24geWllbGQgcHJvY2VzczogJyArIHNlbGYuX3N0YXRlO1xyXG4gICAgfVxyXG59XHJcblxyXG5mdW5jdGlvbiBmZXRjaEFib3J0ZWRCeVNjaGVkdWxlcihzZWxmKSB7XHJcbiAgICBzZWxmLl9yZXNvdXJjZSA9IG51bGw7XHJcbiAgICBzZWxmLl9mZXRjaFN0b3BwZWQoLyppc0Fib3J0ZWQ9Ki90cnVlKTtcclxufSIsIid1c2Ugc3RyaWN0JztcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gRmV0Y2hNYW5hZ2VyO1xyXG5cclxudmFyIGltYWdlSGVscGVyRnVuY3Rpb25zID0gcmVxdWlyZSgnaW1hZ2UtaGVscGVyLWZ1bmN0aW9ucy5qcycpO1xyXG52YXIgRmV0Y2hDb250ZXh0ID0gcmVxdWlyZSgnZmV0Y2gtY29udGV4dC5qcycpO1xyXG52YXIgTGlua2VkTGlzdCA9IHJlcXVpcmUoJ2xpbmtlZC1saXN0LmpzJyk7XHJcbnZhciBGZXRjaGVyQ2xvc2VyID0gcmVxdWlyZSgnZmV0Y2hlci1jbG9zZXIuanMnKTtcclxuXHJcbi8qIGdsb2JhbCBjb25zb2xlOiBmYWxzZSAqL1xyXG4vKiBnbG9iYWwgUHJvbWlzZTogZmFsc2UgKi9cclxuXHJcbkZldGNoTWFuYWdlci5mZXRjaGVyRXhwZWN0ZWRNZXRob2RzID0gWydvcGVuJywgJ29uJywgJ2Nsb3NlJywgJ3N0YXJ0RmV0Y2gnLCAnc3RhcnRNb3ZhYmxlRmV0Y2gnXTtcclxuXHJcbmZ1bmN0aW9uIEZldGNoTWFuYWdlcihmZXRjaGVyLCBvcHRpb25zKSB7XHJcbiAgICBvcHRpb25zID0gb3B0aW9ucyB8fCB7fTtcclxuXHRcclxuICAgIHRoaXMuX2ZldGNoZXNMaW1pdCA9IG9wdGlvbnMuZmV0Y2hlc0xpbWl0IHx8IDU7XHJcbiAgICB0aGlzLl9zaG93TG9nID0gb3B0aW9ucy5zaG93TG9nO1xyXG4gICAgXHJcbiAgICBpZiAodGhpcy5fc2hvd0xvZykge1xyXG4gICAgICAgIC8vIE9sZCBJRVxyXG4gICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IHNob3dMb2cgaXMgbm90IHN1cHBvcnRlZCBvbiB0aGlzIGJyb3dzZXInO1xyXG4gICAgfVxyXG5cdFxyXG4gICAgdGhpcy5fc2NoZWR1bGVyID0gbnVsbDtcclxuXHR0aGlzLl9mZXRjaFByaW9yaXRpemVyID0gbnVsbDtcclxuXHR0aGlzLl9wcmlvcml0aXplclR5cGUgPSBudWxsO1xyXG5cdFx0XHJcbiAgICB0aGlzLl9tb3ZhYmxlSGFuZGxlQ291bnRlciA9IDA7XHJcbiAgICB0aGlzLl9tb3ZhYmxlSGFuZGxlcyA9IFtdO1xyXG4gICAgdGhpcy5fcmVxdWVzdEJ5SWQgPSBbXTtcclxuXHR0aGlzLl9pbWFnZVBhcmFtcyA9IG51bGw7XHJcbiAgICB0aGlzLl9zY2hlZHVsZWRKb2JzTGlzdCA9IG5ldyBMaW5rZWRMaXN0KCk7XHJcblx0dGhpcy5fZmV0Y2hlckNsb3NlciA9IG5ldyBGZXRjaGVyQ2xvc2VyKCk7XHJcbiAgICBcclxuICAgIHRoaXMuX2ZldGNoZXIgPSBpbWFnZUhlbHBlckZ1bmN0aW9ucy5nZXRPckNyZWF0ZUluc3RhbmNlKFxyXG4gICAgICAgIGZldGNoZXIsICdmZXRjaGVyJywgRmV0Y2hNYW5hZ2VyLmZldGNoZXJFeHBlY3RlZE1ldGhvZHMpO1xyXG59XHJcblxyXG5GZXRjaE1hbmFnZXIucHJvdG90eXBlLm9wZW4gPSBmdW5jdGlvbiBvcGVuKHVybCkge1xyXG4gICAgdmFyIGZldGNoU2NoZWR1bGVyID0gaW1hZ2VIZWxwZXJGdW5jdGlvbnMuY3JlYXRlUHJpb3JpdGl6ZXIoXHJcbiAgICAgICAgdGhpcy5fZmV0Y2hlc0xpbWl0LFxyXG4gICAgICAgIHRoaXMuX3ByaW9yaXRpemVyVHlwZSxcclxuICAgICAgICAnZmV0Y2gnLFxyXG4gICAgICAgIHRoaXMuX3Nob3dMb2cpO1xyXG4gICAgXHJcbiAgICB0aGlzLl9mZXRjaFByaW9yaXRpemVyID0gZmV0Y2hTY2hlZHVsZXIucHJpb3JpdGl6ZXI7XHJcblx0aWYgKGZldGNoU2NoZWR1bGVyLnByaW9yaXRpemVyICE9PSBudWxsKSB7XHJcblx0XHR0aGlzLl9zY2hlZHVsZXIgPSBuZXcgcmVzb3VyY2VTY2hlZHVsZXIuUHJpb3JpdHlTY2hlZHVsZXIoXHJcblx0XHRcdGNyZWF0ZUR1bW15UmVzb3VyY2UsXHJcblx0XHRcdHRoaXMuX2ZldGNoZXNMaW1pdCxcclxuXHRcdFx0ZmV0Y2hTY2hlZHVsZXIucHJpb3JpdGl6ZXIsXHJcblx0XHRcdGZldGNoU2NoZWR1bGVyLnNjaGVkdWxlck9wdGlvbnMpO1xyXG5cdH0gZWxzZSB7XHJcblx0XHR0aGlzLl9zY2hlZHVsZXIgPSBuZXcgcmVzb3VyY2VTY2hlZHVsZXIuTGlmb1NjaGVkdWxlcihcclxuXHRcdFx0Y3JlYXRlRHVtbXlSZXNvdXJjZSxcclxuXHRcdFx0dGhpcy5fZmV0Y2hlc0xpbWl0LFxyXG5cdFx0XHRmZXRjaFNjaGVkdWxlci5zY2hlZHVsZXJPcHRpb25zKTtcclxuXHR9XHJcblxyXG5cdHZhciBzZWxmID0gdGhpcztcclxuICAgIHJldHVybiB0aGlzLl9mZXRjaGVyLm9wZW4odXJsKS50aGVuKGZ1bmN0aW9uKHJlc3VsdCkge1xyXG5cdFx0c2VsZi5faW1hZ2VQYXJhbXMgPSByZXN1bHQ7XHJcblx0XHRyZXR1cm4gcmVzdWx0O1xyXG5cdH0pO1xyXG59O1xyXG5cclxuRmV0Y2hNYW5hZ2VyLnByb3RvdHlwZS5vbiA9IGZ1bmN0aW9uIG9uKGV2ZW50LCBjYWxsYmFjaywgYXJnKSB7XHJcbiAgICByZXR1cm4gdGhpcy5fZmV0Y2hlci5vbihldmVudCwgY2FsbGJhY2ssIGFyZyk7XHJcbn07XHJcblxyXG5GZXRjaE1hbmFnZXIucHJvdG90eXBlLmNsb3NlID0gZnVuY3Rpb24gY2xvc2UoKSB7XHJcbiAgICB2YXIgc2VsZiA9IHRoaXM7XHJcbiAgICB2YXIgcmVzb2x2ZV8gPSBudWxsO1xyXG4gICAgdmFyIHJlamVjdF8gPSBudWxsO1xyXG5cclxuICAgIGZ1bmN0aW9uIHdhaXRGb3JBY3RpdmVGZXRjaGVzKHJlc3VsdCkge1xyXG4gICAgICAgIHNlbGYuX2ZldGNoZXJDbG9zZXIuY2xvc2UoKVxyXG4gICAgICAgICAgICAudGhlbihmdW5jdGlvbigpIHtcclxuICAgICAgICAgICAgICAgIHJlc29sdmVfKHJlc3VsdCk7XHJcbiAgICAgICAgICAgIH0pLmNhdGNoKHJlamVjdF8pO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICByZXR1cm4gbmV3IFByb21pc2UoZnVuY3Rpb24ocmVzb2x2ZSwgcmVqZWN0KSB7XHJcbiAgICAgICAgcmVzb2x2ZV8gPSByZXNvbHZlO1xyXG4gICAgICAgIHJlamVjdF8gPSByZWplY3Q7XHJcbiAgICAgICAgc2VsZi5fZmV0Y2hlci5jbG9zZSgpXHJcbiAgICAgICAgICAgIC50aGVuKHdhaXRGb3JBY3RpdmVGZXRjaGVzKVxyXG4gICAgICAgICAgICAuY2F0Y2gocmVqZWN0KTtcclxuICAgIH0pO1xyXG59O1xyXG5cclxuRmV0Y2hNYW5hZ2VyLnByb3RvdHlwZS5zZXRQcmlvcml0aXplclR5cGUgPSBmdW5jdGlvbiBzZXRQcmlvcml0aXplclR5cGUocHJpb3JpdGl6ZXJUeXBlKSB7XHJcblx0aWYgKHRoaXMuX3NjaGVkdWxlciAhPT0gbnVsbCkge1xyXG5cdFx0dGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogY2Fubm90IHNldCBwcmlvcml0aXplciB0eXBlIGFmdGVyIEZldGNoTWFuYWdlci5vcGVuKCkgY2FsbGVkJztcclxuXHR9XHJcblx0dGhpcy5fcHJpb3JpdGl6ZXJUeXBlID0gcHJpb3JpdGl6ZXJUeXBlO1xyXG59O1xyXG5cclxuRmV0Y2hNYW5hZ2VyLnByb3RvdHlwZS5nZXRJbWFnZVBhcmFtcyA9IGZ1bmN0aW9uIGdldEltYWdlUGFyYW1zKCkge1xyXG5cdHJldHVybiB0aGlzLl9pbWFnZVBhcmFtcztcclxufTtcclxuXHJcbkZldGNoTWFuYWdlci5wcm90b3R5cGUuc2V0SXNQcm9ncmVzc2l2ZVJlcXVlc3QgPSBmdW5jdGlvbiBzZXRJc1Byb2dyZXNzaXZlUmVxdWVzdChcclxuICAgIHJlcXVlc3RJZCwgaXNQcm9ncmVzc2l2ZSkge1xyXG4gICAgXHJcbiAgICB2YXIgZmV0Y2hKb2IgPSB0aGlzLl9yZXF1ZXN0QnlJZFtyZXF1ZXN0SWRdO1xyXG4gICAgaWYgKGZldGNoSm9iID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICAvLyBUaGlzIHNpdHVhdGlvbiBtaWdodCBvY2N1ciBpZiByZXF1ZXN0IGhhcyBiZWVuIHRlcm1pbmF0ZWQsXHJcbiAgICAgICAgLy8gYnV0IHVzZXIncyB0ZXJtaW5hdGVkQ2FsbGJhY2sgaGFzIG5vdCBiZWVuIGNhbGxlZCB5ZXQuIEl0XHJcbiAgICAgICAgLy8gaGFwcGVucyBvbiBXb3JrZXJQcm94eUZldGNoTWFuYWdlciBkdWUgdG8gdGhyZWFkXHJcbiAgICAgICAgLy8gbWVzc2FnZSBkZWxheS5cclxuICAgICAgICBcclxuICAgICAgICByZXR1cm4gbnVsbDtcclxuICAgIH1cclxuICAgIFxyXG4gICAgZmV0Y2hKb2Iuc2V0SXNQcm9ncmVzc2l2ZShpc1Byb2dyZXNzaXZlKTtcclxufTtcclxuXHJcbkZldGNoTWFuYWdlci5wcm90b3R5cGUuY3JlYXRlTW92YWJsZUZldGNoID0gZnVuY3Rpb24gY3JlYXRlTW92YWJsZUZldGNoKCkge1xyXG5cdHZhciBzZWxmID0gdGhpcztcclxuICAgIHJldHVybiBuZXcgUHJvbWlzZShmdW5jdGlvbihyZXNvbHZlLCByZWplY3QpIHtcclxuICAgICAgICB2YXIgbW92YWJsZUhhbmRsZSA9ICsrc2VsZi5fbW92YWJsZUhhbmRsZUNvdW50ZXI7XHJcbiAgICAgICAgc2VsZi5fbW92YWJsZUhhbmRsZXNbbW92YWJsZUhhbmRsZV0gPSBuZXcgRmV0Y2hDb250ZXh0KFxyXG4gICAgICAgICAgICBzZWxmLl9mZXRjaGVyLFxyXG4gICAgICAgICAgICBzZWxmLl9mZXRjaGVyQ2xvc2VyLFxyXG4gICAgICAgICAgICBzZWxmLl9zY2hlZHVsZXIsXHJcbiAgICAgICAgICAgIHNlbGYuX3NjaGVkdWxlZEpvYnNMaXN0LFxyXG4gICAgICAgICAgICBGZXRjaENvbnRleHQuRkVUQ0hfVFlQRV9NT1ZBQkxFLFxyXG4gICAgICAgICAgICAvKmNvbnRleHRWYXJzPSovbnVsbCk7XHJcblxyXG4gICAgICAgIHJlc29sdmUobW92YWJsZUhhbmRsZSk7XHJcbiAgICB9KTtcclxufTtcclxuXHJcbkZldGNoTWFuYWdlci5wcm90b3R5cGUubW92ZUZldGNoID0gZnVuY3Rpb24gbW92ZUZldGNoKFxyXG4gICAgbW92YWJsZUhhbmRsZSwgaW1hZ2VQYXJ0UGFyYW1zKSB7XHJcbiAgICBcclxuICAgIHZhciBtb3ZhYmxlID0gdGhpcy5fbW92YWJsZUhhbmRsZXNbbW92YWJsZUhhbmRsZV07XHJcbiAgICBtb3ZhYmxlLmZldGNoKGltYWdlUGFydFBhcmFtcyk7XHJcbn07XHJcblxyXG5GZXRjaE1hbmFnZXIucHJvdG90eXBlLmNyZWF0ZVJlcXVlc3QgPSBmdW5jdGlvbiBjcmVhdGVSZXF1ZXN0KFxyXG4gICAgcmVxdWVzdElkLCBpbWFnZVBhcnRQYXJhbXMpIHtcclxuICAgIFxyXG4gICAgdmFyIGNvbnRleHRWYXJzID0ge1xyXG4gICAgICAgIHByb2dyZXNzaXZlU3RhZ2VzRG9uZTogMCxcclxuICAgICAgICBpc0xhc3RDYWxsYmFja0NhbGxlZFdpdGhvdXRMb3dRdWFsaXR5TGltaXQ6IGZhbHNlLFxyXG4gICAgICAgIHJlcXVlc3RJZDogcmVxdWVzdElkLFxyXG4gICAgICAgIGZldGNoSm9iOiBudWxsLFxyXG4gICAgICAgIHNlbGY6IHRoaXNcclxuICAgIH07XHJcbiAgICBcclxuICAgIHZhciBmZXRjaFR5cGUgPSAvKmlzT25seVdhaXRGb3JEYXRhID9cclxuICAgICAgICBGZXRjaENvbnRleHQuRkVUQ0hfVFlQRV9PTkxZX1dBSVRfRk9SX0RBVEEgOiAqL0ZldGNoQ29udGV4dC5GRVRDSF9UWVBFX1JFUVVFU1Q7XHJcbiAgICBcclxuICAgIHZhciBmZXRjaEpvYiA9IG5ldyBGZXRjaENvbnRleHQoXHJcbiAgICAgICAgdGhpcy5fZmV0Y2hlcixcclxuICAgICAgICB0aGlzLl9mZXRjaGVyQ2xvc2VyLFxyXG4gICAgICAgIHRoaXMuX3NjaGVkdWxlcixcclxuICAgICAgICB0aGlzLl9zY2hlZHVsZWRKb2JzTGlzdCxcclxuICAgICAgICBmZXRjaFR5cGUsXHJcbiAgICAgICAgY29udGV4dFZhcnMpO1xyXG4gICAgXHJcbiAgICBjb250ZXh0VmFycy5mZXRjaEpvYiA9IGZldGNoSm9iO1xyXG4gICAgXHJcbiAgICBpZiAodGhpcy5fcmVxdWVzdEJ5SWRbcmVxdWVzdElkXSAhPT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogRHVwbGljYXRpb24gb2YgcmVxdWVzdElkICcgKyByZXF1ZXN0SWQ7XHJcbiAgICB9IGVsc2UgaWYgKHJlcXVlc3RJZCAhPT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgdGhpcy5fcmVxdWVzdEJ5SWRbcmVxdWVzdElkXSA9IGZldGNoSm9iO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBmZXRjaEpvYi5vbigndGVybWluYXRlZCcsIGludGVybmFsVGVybWluYXRlZENhbGxiYWNrKTtcclxuICAgIFxyXG4gICAgZmV0Y2hKb2IuZmV0Y2goaW1hZ2VQYXJ0UGFyYW1zKTtcclxuICAgIFxyXG4gICAgdGhpcy5feWllbGRGZXRjaEpvYnMoKTtcclxufTtcclxuXHJcbkZldGNoTWFuYWdlci5wcm90b3R5cGUubWFudWFsQWJvcnRSZXF1ZXN0ID0gZnVuY3Rpb24gbWFudWFsQWJvcnRSZXF1ZXN0KFxyXG4gICAgcmVxdWVzdElkKSB7XHJcbiAgICBcclxuICAgIHZhciBmZXRjaEpvYiA9IHRoaXMuX3JlcXVlc3RCeUlkW3JlcXVlc3RJZF07XHJcbiAgICBcclxuICAgIGlmIChmZXRjaEpvYiA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgLy8gVGhpcyBzaXR1YXRpb24gbWlnaHQgb2NjdXIgaWYgcmVxdWVzdCBoYXMgYmVlbiB0ZXJtaW5hdGVkLFxyXG4gICAgICAgIC8vIGJ1dCB1c2VyJ3MgdGVybWluYXRlZENhbGxiYWNrIGhhcyBub3QgYmVlbiBjYWxsZWQgeWV0LiBJdFxyXG4gICAgICAgIC8vIGhhcHBlbnMgb24gV29ya2VyUHJveHlGZXRjaE1hbmFnZXIgZHVlIHRvIHdlYiB3b3JrZXJcclxuICAgICAgICAvLyBtZXNzYWdlIGRlbGF5LlxyXG4gICAgICAgIFxyXG4gICAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIFxyXG4gICAgZmV0Y2hKb2IubWFudWFsQWJvcnRSZXF1ZXN0KCk7XHJcbiAgICBkZWxldGUgdGhpcy5fcmVxdWVzdEJ5SWRbcmVxdWVzdElkXTtcclxufTtcclxuXHJcbkZldGNoTWFuYWdlci5wcm90b3R5cGUuc2V0RmV0Y2hQcmlvcml0aXplckRhdGEgPVxyXG4gICAgZnVuY3Rpb24gc2V0RmV0Y2hQcmlvcml0aXplckRhdGEocHJpb3JpdGl6ZXJEYXRhKSB7XHJcblxyXG4gICAgaWYgKHRoaXMuX2ZldGNoUHJpb3JpdGl6ZXIgPT09IG51bGwpIHtcclxuICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBObyBmZXRjaCBwcmlvcml0aXplciBoYXMgYmVlbiBzZXQnO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBpZiAodGhpcy5fc2hvd0xvZykge1xyXG4gICAgICAgIGNvbnNvbGUubG9nKCdzZXRGZXRjaFByaW9yaXRpemVyRGF0YSgnICsgcHJpb3JpdGl6ZXJEYXRhICsgJyknKTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgcHJpb3JpdGl6ZXJEYXRhLmltYWdlID0gdGhpcztcclxuICAgIHRoaXMuX2ZldGNoUHJpb3JpdGl6ZXIuc2V0UHJpb3JpdGl6ZXJEYXRhKHByaW9yaXRpemVyRGF0YSk7XHJcbiAgICB0aGlzLl95aWVsZEZldGNoSm9icygpO1xyXG59O1xyXG5cclxuRmV0Y2hNYW5hZ2VyLnByb3RvdHlwZS5feWllbGRGZXRjaEpvYnMgPSBmdW5jdGlvbiB5aWVsZEZldGNoSm9icygpIHtcclxuICAgIHZhciBpdGVyYXRvciA9IHRoaXMuX3NjaGVkdWxlZEpvYnNMaXN0LmdldEZpcnN0SXRlcmF0b3IoKTtcclxuICAgIHdoaWxlIChpdGVyYXRvciAhPT0gbnVsbCkge1xyXG4gICAgICAgIHZhciBmZXRjaEpvYiA9IHRoaXMuX3NjaGVkdWxlZEpvYnNMaXN0LmdldFZhbHVlKGl0ZXJhdG9yKTtcclxuICAgICAgICBpdGVyYXRvciA9IHRoaXMuX3NjaGVkdWxlZEpvYnNMaXN0LmdldE5leHRJdGVyYXRvcihpdGVyYXRvcik7XHJcbiAgICAgICAgXHJcbiAgICAgICAgZmV0Y2hKb2IuY2hlY2tJZlNob3VsZFlpZWxkKCk7XHJcbiAgICB9XHJcbn07XHJcblxyXG5mdW5jdGlvbiBpbnRlcm5hbFRlcm1pbmF0ZWRDYWxsYmFjayhjb250ZXh0VmFycykge1xyXG4gICAgZGVsZXRlIGNvbnRleHRWYXJzLnNlbGYuX3JlcXVlc3RCeUlkW2NvbnRleHRWYXJzLnJlcXVlc3RJZF07XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGNyZWF0ZUR1bW15UmVzb3VyY2UoKSB7XHJcblx0cmV0dXJuIHt9O1xyXG59IiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBGZXRjaGVyQ2xvc2VyO1xyXG5cclxuLyogZ2xvYmFsIFByb21pc2U6IGZhbHNlICovXHJcblxyXG5mdW5jdGlvbiBGZXRjaGVyQ2xvc2VyKCkge1xyXG5cdHRoaXMuX3Jlc29sdmVDbG9zZSA9IG51bGw7XHJcblx0dGhpcy5fYWN0aXZlRmV0Y2hlcyA9IDA7XHJcblx0dGhpcy5faXNDbG9zZWQgPSBmYWxzZTtcclxufVxyXG5cclxuRmV0Y2hlckNsb3Nlci5wcm90b3R5cGUuY2hhbmdlQWN0aXZlRmV0Y2hlc0NvdW50ID0gZnVuY3Rpb24gY2hhbmdlQWN0aXZlRmV0Y2hlc0NvdW50KGFkZFZhbHVlKSB7XHJcblx0aWYgKHRoaXMuX2lzQ2xvc2VkKSB7XHJcblx0XHR0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBVbmV4cGVjdGVkIGNoYW5nZSBvZiBhY3RpdmUgZmV0Y2hlcyBjb3VudCBhZnRlciBjbG9zZWQnO1xyXG5cdH1cclxuXHR0aGlzLl9hY3RpdmVGZXRjaGVzICs9IGFkZFZhbHVlO1xyXG5cdFxyXG5cdGlmICh0aGlzLl9hY3RpdmVGZXRjaGVzID09PSAwICYmIHRoaXMuX3Jlc29sdmVDbG9zZSkge1xyXG5cdFx0dGhpcy5faXNDbG9zZWQgPSB0cnVlO1xyXG5cdFx0dGhpcy5fcmVzb2x2ZUNsb3NlKCk7XHJcblx0fVxyXG59O1xyXG5cclxuRmV0Y2hlckNsb3Nlci5wcm90b3R5cGUuaXNDbG9zZVJlcXVlc3RlZCA9IGZ1bmN0aW9uIGlzQ2xvc2VSZXF1ZXN0ZWQoKSB7XHJcblx0cmV0dXJuIHRoaXMuX2lzQ2xvc2VkIHx8ICh0aGlzLl9yZXNvbHZlQ2xvc2UgIT09IG51bGwpO1xyXG59O1xyXG5cclxuRmV0Y2hlckNsb3Nlci5wcm90b3R5cGUuY2xvc2UgPSBmdW5jdGlvbiBjbG9zZSgpIHtcclxuXHRpZiAodGhpcy5pc0Nsb3NlUmVxdWVzdGVkKCkpIHtcclxuXHRcdHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IGNsb3NlKCkgY2FsbGVkIHR3aWNlJztcclxuXHR9XHJcblx0dmFyIHNlbGYgPSB0aGlzO1xyXG5cdHJldHVybiBuZXcgUHJvbWlzZShmdW5jdGlvbihyZXNvbHZlLCByZWplY3QpIHtcclxuXHRcdHNlbGYuX3Jlc29sdmVDbG9zZSA9IHJlc29sdmU7XHJcblx0XHRpZiAoc2VsZi5fYWN0aXZlRmV0Y2hlcyA9PT0gMCkge1xyXG5cdFx0XHRzZWxmLl9yZXNvbHZlQ2xvc2UoKTtcclxuXHRcdH1cclxuXHR9KTtcclxufTsiLCIndXNlIHN0cmljdCc7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IEZydXN0dW1SZXF1ZXN0c1ByaW9yaXRpemVyO1xyXG52YXIgUFJJT1JJVFlfQUJPUlRfTk9UX0lOX0ZSVVNUVU0gPSAtMTtcclxudmFyIFBSSU9SSVRZX0NBTENVTEFUSU9OX0ZBSUxFRCA9IDA7XHJcbnZhciBQUklPUklUWV9UT09fR09PRF9SRVNPTFVUSU9OID0gMTtcclxudmFyIFBSSU9SSVRZX05PVF9JTl9GUlVTVFVNID0gMjtcclxudmFyIFBSSU9SSVRZX0xPV0VSX1JFU09MVVRJT04gPSAzO1xyXG5cclxudmFyIFBSSU9SSVRZX01JTk9SSVRZX0lOX0ZSVVNUVU0gPSA0O1xyXG52YXIgUFJJT1JJVFlfUEFSVElBTF9JTl9GUlVTVFVNID0gNTtcclxudmFyIFBSSU9SSVRZX01BSk9SSVRZX0lOX0ZSVVNUVU0gPSA2O1xyXG52YXIgUFJJT1JJVFlfRlVMTFlfSU5fRlJVU1RVTSA9IDc7XHJcblxyXG52YXIgQUREX1BSSU9SSVRZX1RPX0xPV19RVUFMSVRZID0gNTtcclxuXHJcbnZhciBQUklPUklUWV9ISUdIRVNUID0gMTM7XHJcblxyXG52YXIgbG9nMiA9IE1hdGgubG9nKDIpO1xyXG5cclxuZnVuY3Rpb24gRnJ1c3R1bVJlcXVlc3RzUHJpb3JpdGl6ZXIoXHJcbiAgICBpc0Fib3J0UmVxdWVzdHNOb3RJbkZydXN0dW0sIGlzUHJpb3JpdGl6ZUxvd1Byb2dyZXNzaXZlU3RhZ2UpIHtcclxuICAgIFxyXG4gICAgdGhpcy5fZnJ1c3R1bURhdGEgPSBudWxsO1xyXG4gICAgdGhpcy5faXNBYm9ydFJlcXVlc3RzTm90SW5GcnVzdHVtID0gaXNBYm9ydFJlcXVlc3RzTm90SW5GcnVzdHVtO1xyXG4gICAgdGhpcy5faXNQcmlvcml0aXplTG93UHJvZ3Jlc3NpdmVTdGFnZSA9IGlzUHJpb3JpdGl6ZUxvd1Byb2dyZXNzaXZlU3RhZ2U7XHJcbn1cclxuXHJcbk9iamVjdC5kZWZpbmVQcm9wZXJ0eShcclxuICAgIEZydXN0dW1SZXF1ZXN0c1ByaW9yaXRpemVyLnByb3RvdHlwZSwgJ21pbmltYWxMb3dRdWFsaXR5UHJpb3JpdHknLCB7XHJcbiAgICAgICAgZ2V0OiBmdW5jdGlvbiBtaW5pbWFsTG93UXVhbGl0eVByaW9yaXR5KCkge1xyXG4gICAgICAgICAgICByZXR1cm4gUFJJT1JJVFlfTUlOT1JJVFlfSU5fRlJVU1RVTSArIEFERF9QUklPUklUWV9UT19MT1dfUVVBTElUWTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbik7XHJcbiAgICBcclxuRnJ1c3R1bVJlcXVlc3RzUHJpb3JpdGl6ZXIucHJvdG90eXBlLnNldFByaW9yaXRpemVyRGF0YSA9IGZ1bmN0aW9uIHNldFByaW9yaXRpemVyRGF0YShkYXRhKSB7XHJcbiAgICB0aGlzLl9mcnVzdHVtRGF0YSA9IGRhdGE7XHJcbn07XHJcblxyXG5GcnVzdHVtUmVxdWVzdHNQcmlvcml0aXplci5wcm90b3R5cGUuZ2V0UHJpb3JpdHkgPSBmdW5jdGlvbiBnZXRQcmlvcml0eShqb2JDb250ZXh0KSB7XHJcbiAgICB2YXIgaW1hZ2VQYXJ0UGFyYW1zID0gam9iQ29udGV4dC5pbWFnZVBhcnRQYXJhbXM7XHJcbiAgICBpZiAoaW1hZ2VQYXJ0UGFyYW1zLnJlcXVlc3RQcmlvcml0eURhdGEub3ZlcnJpZGVIaWdoZXN0UHJpb3JpdHkpIHtcclxuICAgICAgICByZXR1cm4gUFJJT1JJVFlfSElHSEVTVDtcclxuICAgIH1cclxuXHJcbiAgICB2YXIgcHJpb3JpdHkgPSB0aGlzLl9nZXRQcmlvcml0eUludGVybmFsKGltYWdlUGFydFBhcmFtcyk7XHJcbiAgICB2YXIgaXNJbkZydXN0dW0gPSBwcmlvcml0eSA+PSBQUklPUklUWV9NSU5PUklUWV9JTl9GUlVTVFVNO1xyXG4gICAgXHJcbiAgICBpZiAodGhpcy5faXNBYm9ydFJlcXVlc3RzTm90SW5GcnVzdHVtICYmICFpc0luRnJ1c3R1bSkge1xyXG4gICAgICAgIHJldHVybiBQUklPUklUWV9BQk9SVF9OT1RfSU5fRlJVU1RVTTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgdmFyIHByaW9yaXRpemVMb3dQcm9ncmVzc2l2ZVN0YWdlID0gMDtcclxuICAgIFxyXG4gICAgaWYgKHRoaXMuX2lzUHJpb3JpdGl6ZUxvd1Byb2dyZXNzaXZlU3RhZ2UgJiYgaXNJbkZydXN0dW0pIHtcclxuICAgICAgICBwcmlvcml0aXplTG93UHJvZ3Jlc3NpdmVTdGFnZSA9XHJcbiAgICAgICAgICAgIGpvYkNvbnRleHQucHJvZ3Jlc3NpdmVTdGFnZXNEb25lID09PSAwID8gQUREX1BSSU9SSVRZX1RPX0xPV19RVUFMSVRZIDpcclxuICAgICAgICAgICAgam9iQ29udGV4dC5wcm9ncmVzc2l2ZVN0YWdlc0RvbmUgPT09IDEgPyAxIDpcclxuICAgICAgICAgICAgMDtcclxuICAgIH1cclxuICAgIFxyXG4gICAgcmV0dXJuIHByaW9yaXR5ICsgcHJpb3JpdGl6ZUxvd1Byb2dyZXNzaXZlU3RhZ2U7XHJcbn07XHJcblxyXG5GcnVzdHVtUmVxdWVzdHNQcmlvcml0aXplci5wcm90b3R5cGUuX2dldFByaW9yaXR5SW50ZXJuYWwgPSBmdW5jdGlvbiBnZXRQcmlvcml0eUludGVybmFsKGltYWdlUGFydFBhcmFtcykge1xyXG4gICAgaWYgKHRoaXMuX2ZydXN0dW1EYXRhID09PSBudWxsKSB7XHJcbiAgICAgICAgcmV0dXJuIFBSSU9SSVRZX0NBTENVTEFUSU9OX0ZBSUxFRDtcclxuICAgIH1cclxuICAgIFxyXG4gICAgaWYgKHRoaXMuX2ZydXN0dW1EYXRhLmltYWdlUmVjdGFuZ2xlID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBObyBpbWFnZVJlY3RhbmdsZSBpbmZvcm1hdGlvbiBwYXNzZWQgaW4gc2V0UHJpb3JpdGl6ZXJEYXRhJztcclxuICAgIH1cclxuICAgIFxyXG4gICAgdmFyIGV4YWN0RnJ1c3R1bUxldmVsID0gdGhpcy5fZnJ1c3R1bURhdGEuZXhhY3RsZXZlbDtcclxuICAgIFxyXG4gICAgaWYgKHRoaXMuX2ZydXN0dW1EYXRhLmV4YWN0bGV2ZWwgPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IE5vIGV4YWN0bGV2ZWwgaW5mb3JtYXRpb24gcGFzc2VkIGluICcgK1xyXG4gICAgICAgICAgICAnc2V0UHJpb3JpdGl6ZXJEYXRhLiBVc2UgbnVsbCBpZiB1bmtub3duJztcclxuICAgIH1cclxuICAgIFxyXG4gICAgdmFyIHRpbGVXZXN0ID0gdGhpcy5fcGl4ZWxUb0NhcnRvZ3JhcGhpY1goXHJcbiAgICAgICAgaW1hZ2VQYXJ0UGFyYW1zLm1pblgsIGltYWdlUGFydFBhcmFtcyk7XHJcbiAgICB2YXIgdGlsZUVhc3QgPSB0aGlzLl9waXhlbFRvQ2FydG9ncmFwaGljWChcclxuICAgICAgICBpbWFnZVBhcnRQYXJhbXMubWF4WEV4Y2x1c2l2ZSwgaW1hZ2VQYXJ0UGFyYW1zKTtcclxuICAgIHZhciB0aWxlTm9ydGggPSB0aGlzLl9waXhlbFRvQ2FydG9ncmFwaGljWShcclxuICAgICAgICBpbWFnZVBhcnRQYXJhbXMubWluWSwgaW1hZ2VQYXJ0UGFyYW1zKTtcclxuICAgIHZhciB0aWxlU291dGggPSB0aGlzLl9waXhlbFRvQ2FydG9ncmFwaGljWShcclxuICAgICAgICBpbWFnZVBhcnRQYXJhbXMubWF4WUV4Y2x1c2l2ZSwgaW1hZ2VQYXJ0UGFyYW1zKTtcclxuICAgIFxyXG4gICAgdmFyIHRpbGVQaXhlbHNXaWR0aCA9XHJcbiAgICAgICAgaW1hZ2VQYXJ0UGFyYW1zLm1heFhFeGNsdXNpdmUgLSBpbWFnZVBhcnRQYXJhbXMubWluWDtcclxuICAgIHZhciB0aWxlUGl4ZWxzSGVpZ2h0ID1cclxuICAgICAgICBpbWFnZVBhcnRQYXJhbXMubWF4WUV4Y2x1c2l2ZSAtIGltYWdlUGFydFBhcmFtcy5taW5ZO1xyXG4gICAgXHJcbiAgICB2YXIgcmVxdWVzdFRvRnJ1c3R1bVJlc29sdXRpb25SYXRpbztcclxuICAgIHZhciB0aWxlTGV2ZWwgPSBpbWFnZVBhcnRQYXJhbXMubGV2ZWwgfHwgMDtcclxuICAgIGlmIChleGFjdEZydXN0dW1MZXZlbCA9PT0gbnVsbCkge1xyXG4gICAgICAgIHZhciB0aWxlUmVzb2x1dGlvblggPSB0aWxlUGl4ZWxzV2lkdGggLyAodGlsZUVhc3QgLSB0aWxlV2VzdCk7XHJcbiAgICAgICAgdmFyIHRpbGVSZXNvbHV0aW9uWSA9IHRpbGVQaXhlbHNIZWlnaHQgLyAodGlsZU5vcnRoIC0gdGlsZVNvdXRoKTtcclxuICAgICAgICB2YXIgdGlsZVJlc29sdXRpb24gPSBNYXRoLm1heCh0aWxlUmVzb2x1dGlvblgsIHRpbGVSZXNvbHV0aW9uWSk7XHJcbiAgICAgICAgdmFyIGZydXN0dW1SZXNvbHV0aW9uID0gdGhpcy5fZnJ1c3R1bURhdGEucmVzb2x1dGlvbjtcclxuICAgICAgICByZXF1ZXN0VG9GcnVzdHVtUmVzb2x1dGlvblJhdGlvID0gdGlsZVJlc29sdXRpb24gLyBmcnVzdHVtUmVzb2x1dGlvbjtcclxuICAgIFxyXG4gICAgICAgIGlmIChyZXF1ZXN0VG9GcnVzdHVtUmVzb2x1dGlvblJhdGlvID4gMikge1xyXG4gICAgICAgICAgICByZXR1cm4gUFJJT1JJVFlfVE9PX0dPT0RfUkVTT0xVVElPTjtcclxuICAgICAgICB9XHJcbiAgICB9IGVsc2UgaWYgKHRpbGVMZXZlbCA8IGV4YWN0RnJ1c3R1bUxldmVsKSB7XHJcbiAgICAgICAgcmV0dXJuIFBSSU9SSVRZX1RPT19HT09EX1JFU09MVVRJT047XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHZhciBmcnVzdHVtUmVjdGFuZ2xlID0gdGhpcy5fZnJ1c3R1bURhdGEucmVjdGFuZ2xlO1xyXG4gICAgdmFyIGludGVyc2VjdGlvbldlc3QgPSBNYXRoLm1heChmcnVzdHVtUmVjdGFuZ2xlLndlc3QsIHRpbGVXZXN0KTtcclxuICAgIHZhciBpbnRlcnNlY3Rpb25FYXN0ID0gTWF0aC5taW4oZnJ1c3R1bVJlY3RhbmdsZS5lYXN0LCB0aWxlRWFzdCk7XHJcbiAgICB2YXIgaW50ZXJzZWN0aW9uU291dGggPSBNYXRoLm1heChmcnVzdHVtUmVjdGFuZ2xlLnNvdXRoLCB0aWxlU291dGgpO1xyXG4gICAgdmFyIGludGVyc2VjdGlvbk5vcnRoID0gTWF0aC5taW4oZnJ1c3R1bVJlY3RhbmdsZS5ub3J0aCwgdGlsZU5vcnRoKTtcclxuICAgIFxyXG4gICAgdmFyIGludGVyc2VjdGlvbldpZHRoID0gaW50ZXJzZWN0aW9uRWFzdCAtIGludGVyc2VjdGlvbldlc3Q7XHJcbiAgICB2YXIgaW50ZXJzZWN0aW9uSGVpZ2h0ID0gaW50ZXJzZWN0aW9uTm9ydGggLSBpbnRlcnNlY3Rpb25Tb3V0aDtcclxuICAgIFxyXG4gICAgaWYgKGludGVyc2VjdGlvbldpZHRoIDwgMCB8fCBpbnRlcnNlY3Rpb25IZWlnaHQgPCAwKSB7XHJcbiAgICAgICAgcmV0dXJuIFBSSU9SSVRZX05PVF9JTl9GUlVTVFVNO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBpZiAoZXhhY3RGcnVzdHVtTGV2ZWwgIT09IG51bGwpIHtcclxuICAgICAgICBpZiAodGlsZUxldmVsID4gZXhhY3RGcnVzdHVtTGV2ZWwpIHtcclxuICAgICAgICAgICAgcmV0dXJuIFBSSU9SSVRZX0xPV0VSX1JFU09MVVRJT047XHJcbiAgICAgICAgfVxyXG4gICAgfSBlbHNlIGlmICh0aWxlTGV2ZWwgPiAwICYmIHJlcXVlc3RUb0ZydXN0dW1SZXNvbHV0aW9uUmF0aW8gPCAwLjI1KSB7XHJcbiAgICAgICAgcmV0dXJuIFBSSU9SSVRZX0xPV0VSX1JFU09MVVRJT047XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHZhciBpbnRlcnNlY3Rpb25BcmVhID0gaW50ZXJzZWN0aW9uV2lkdGggKiBpbnRlcnNlY3Rpb25IZWlnaHQ7XHJcbiAgICB2YXIgdGlsZUFyZWEgPSAodGlsZUVhc3QgLSB0aWxlV2VzdCkgKiAodGlsZU5vcnRoIC0gdGlsZVNvdXRoKTtcclxuICAgIHZhciBwYXJ0SW5GcnVzdHVtID0gaW50ZXJzZWN0aW9uQXJlYSAvIHRpbGVBcmVhO1xyXG4gICAgXHJcbiAgICBpZiAocGFydEluRnJ1c3R1bSA+IDAuOTkpIHtcclxuICAgICAgICByZXR1cm4gUFJJT1JJVFlfRlVMTFlfSU5fRlJVU1RVTTtcclxuICAgIH0gZWxzZSBpZiAocGFydEluRnJ1c3R1bSA+IDAuNykge1xyXG4gICAgICAgIHJldHVybiBQUklPUklUWV9NQUpPUklUWV9JTl9GUlVTVFVNO1xyXG4gICAgfSBlbHNlIGlmIChwYXJ0SW5GcnVzdHVtID4gMC4zKSB7XHJcbiAgICAgICAgcmV0dXJuIFBSSU9SSVRZX1BBUlRJQUxfSU5fRlJVU1RVTTtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgICAgcmV0dXJuIFBSSU9SSVRZX01JTk9SSVRZX0lOX0ZSVVNUVU07XHJcbiAgICB9XHJcbn07XHJcblxyXG5GcnVzdHVtUmVxdWVzdHNQcmlvcml0aXplci5wcm90b3R5cGUuX3BpeGVsVG9DYXJ0b2dyYXBoaWNYID0gZnVuY3Rpb24gcGl4ZWxUb0NhcnRvZ3JhcGhpY1goXHJcbiAgICB4LCBpbWFnZVBhcnRQYXJhbXMpIHtcclxuICAgIFxyXG4gICAgdmFyIHJlbGF0aXZlWCA9IHggLyBpbWFnZVBhcnRQYXJhbXMubGV2ZWxXaWR0aDtcclxuICAgIFxyXG4gICAgdmFyIGltYWdlUmVjdGFuZ2xlID0gdGhpcy5fZnJ1c3R1bURhdGEuaW1hZ2VSZWN0YW5nbGU7XHJcbiAgICB2YXIgcmVjdGFuZ2xlV2lkdGggPSBpbWFnZVJlY3RhbmdsZS5lYXN0IC0gaW1hZ2VSZWN0YW5nbGUud2VzdDtcclxuICAgIFxyXG4gICAgdmFyIHhQcm9qZWN0ZWQgPSBpbWFnZVJlY3RhbmdsZS53ZXN0ICsgcmVsYXRpdmVYICogcmVjdGFuZ2xlV2lkdGg7XHJcbiAgICByZXR1cm4geFByb2plY3RlZDtcclxufTtcclxuXHJcbkZydXN0dW1SZXF1ZXN0c1ByaW9yaXRpemVyLnByb3RvdHlwZS5fcGl4ZWxUb0NhcnRvZ3JhcGhpY1kgPSBmdW5jdGlvbiB0aWxlVG9DYXJ0b2dyYXBoaWNZKFxyXG4gICAgeSwgaW1hZ2VQYXJ0UGFyYW1zLCBpbWFnZSkge1xyXG4gICAgXHJcbiAgICB2YXIgcmVsYXRpdmVZID0geSAvIGltYWdlUGFydFBhcmFtcy5sZXZlbEhlaWdodDtcclxuICAgIFxyXG4gICAgdmFyIGltYWdlUmVjdGFuZ2xlID0gdGhpcy5fZnJ1c3R1bURhdGEuaW1hZ2VSZWN0YW5nbGU7XHJcbiAgICB2YXIgcmVjdGFuZ2xlSGVpZ2h0ID0gaW1hZ2VSZWN0YW5nbGUubm9ydGggLSBpbWFnZVJlY3RhbmdsZS5zb3V0aDtcclxuICAgIFxyXG4gICAgdmFyIHlQcm9qZWN0ZWQgPSBpbWFnZVJlY3RhbmdsZS5ub3J0aCAtIHJlbGF0aXZlWSAqIHJlY3RhbmdsZUhlaWdodDtcclxuICAgIHJldHVybiB5UHJvamVjdGVkO1xyXG59OyIsIid1c2Ugc3RyaWN0JztcclxuXHJcbnZhciBGcnVzdHVtUmVxdWVzdHNQcmlvcml0aXplciA9IHJlcXVpcmUoJ2ZydXN0dW0tcmVxdWVzdHMtcHJpb3JpdGl6ZXIuanMnKTtcclxuXHJcbm1vZHVsZS5leHBvcnRzID0ge1xyXG4gICAgY2FsY3VsYXRlRnJ1c3R1bTJERnJvbUJvdW5kczogY2FsY3VsYXRlRnJ1c3R1bTJERnJvbUJvdW5kcyxcclxuICAgIGNyZWF0ZVByaW9yaXRpemVyOiBjcmVhdGVQcmlvcml0aXplcixcclxuICAgIGZpeEJvdW5kczogZml4Qm91bmRzLFxyXG4gICAgZW5zdXJlTGV2ZWxDYWxjdWxhdG9yOiBlbnN1cmVMZXZlbENhbGN1bGF0b3IsXHJcbiAgICBhbGlnblBhcmFtc1RvVGlsZXNBbmRMZXZlbDogYWxpZ25QYXJhbXNUb1RpbGVzQW5kTGV2ZWwsXHJcbiAgICBnZXRPckNyZWF0ZUluc3RhbmNlOiBnZXRPckNyZWF0ZUluc3RhbmNlLFxyXG4gICAgaXNJbmRpcmVjdENyZWF0aW9uTmVlZGVkOiBpc0luZGlyZWN0Q3JlYXRpb25OZWVkZWRcclxufTtcclxuXHJcbi8vIEF2b2lkIGpzaGludCBlcnJvclxyXG4vKiBnbG9iYWwgc2VsZjogZmFsc2UgKi9cclxuLyogZ2xvYmFsIGdsb2JhbHM6IGZhbHNlICovXHJcbiAgICBcclxuLy92YXIgbG9nMiA9IE1hdGgubG9nKDIpO1xyXG5cclxuZnVuY3Rpb24gY2FsY3VsYXRlRnJ1c3R1bTJERnJvbUJvdW5kcyhcclxuICAgIGJvdW5kcywgc2NyZWVuU2l6ZSkge1xyXG4gICAgXHJcbiAgICB2YXIgc2NyZWVuUGl4ZWxzID1cclxuICAgICAgICBzY3JlZW5TaXplLnggKiBzY3JlZW5TaXplLnggKyBzY3JlZW5TaXplLnkgKiBzY3JlZW5TaXplLnk7XHJcbiAgICBcclxuICAgIHZhciBib3VuZHNXaWR0aCA9IGJvdW5kcy5lYXN0IC0gYm91bmRzLndlc3Q7XHJcbiAgICB2YXIgYm91bmRzSGVpZ2h0ID0gYm91bmRzLm5vcnRoIC0gYm91bmRzLnNvdXRoO1xyXG4gICAgdmFyIGJvdW5kc0Rpc3RhbmNlID1cclxuICAgICAgICBib3VuZHNXaWR0aCAqIGJvdW5kc1dpZHRoICsgYm91bmRzSGVpZ2h0ICogYm91bmRzSGVpZ2h0O1xyXG4gICAgXHJcbiAgICB2YXIgcmVzb2x1dGlvbiA9IE1hdGguc3FydChzY3JlZW5QaXhlbHMgLyBib3VuZHNEaXN0YW5jZSk7XHJcbiAgICBcclxuICAgIHZhciBmcnVzdHVtRGF0YSA9IHtcclxuICAgICAgICByZXNvbHV0aW9uOiByZXNvbHV0aW9uLFxyXG4gICAgICAgIHJlY3RhbmdsZTogYm91bmRzLFxyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIFJlZHVuZGFudCwgYnV0IGVuYWJsZXMgdG8gYXZvaWQgYWxyZWFkeS1wZXJmb3JtZWQgY2FsY3VsYXRpb25cclxuICAgICAgICBzY3JlZW5TaXplOiBzY3JlZW5TaXplXHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICByZXR1cm4gZnJ1c3R1bURhdGE7XHJcbn1cclxuICAgIFxyXG5mdW5jdGlvbiBjcmVhdGVQcmlvcml0aXplcihcclxuICAgIHJlc291cmNlTGltaXQsIHByaW9yaXRpemVyVHlwZSwgc2NoZWR1bGVyTmFtZSwgc2hvd0xvZykge1xyXG4gICAgXHJcbiAgICB2YXIgcHJpb3JpdGl6ZXI7XHJcblx0dmFyIGxpbWl0UmVzb3VyY2VCeUxvd1F1YWxpdHlQcmlvcml0eSA9IGZhbHNlO1xyXG5cdFxyXG5cdGlmIChwcmlvcml0aXplclR5cGUgPT09ICdmcnVzdHVtJykge1xyXG5cdFx0bGltaXRSZXNvdXJjZUJ5TG93UXVhbGl0eVByaW9yaXR5ID0gdHJ1ZTtcclxuXHRcdHByaW9yaXRpemVyID0gbmV3IEZydXN0dW1SZXF1ZXN0c1ByaW9yaXRpemVyKCk7XHJcblx0fSBlbHNlIGlmIChwcmlvcml0aXplclR5cGUgPT09ICdmcnVzdHVtT25seScpIHtcclxuXHRcdGxpbWl0UmVzb3VyY2VCeUxvd1F1YWxpdHlQcmlvcml0eSA9IHRydWU7XHJcblx0XHRwcmlvcml0aXplciA9IG5ldyBGcnVzdHVtUmVxdWVzdHNQcmlvcml0aXplcihcclxuXHRcdFx0Lyppc0Fib3J0UmVxdWVzdHNOb3RJbkZydXN0dW09Ki90cnVlLFxyXG5cdFx0XHQvKmlzUHJpb3JpdGl6ZUxvd1F1YWxpdHlTdGFnZT0qL3RydWUpO1xyXG5cdH0gZWxzZSBpZiAoIXByaW9yaXRpemVyVHlwZSkge1xyXG5cdFx0cHJpb3JpdGl6ZXIgPSBudWxsO1xyXG5cdH0gZWxzZSB7XHJcblx0XHRwcmlvcml0aXplciA9IHByaW9yaXRpemVyVHlwZTtcclxuXHR9XHJcblx0XHJcblx0dmFyIG9wdGlvbnMgPSB7XHJcblx0XHRzY2hlZHVsZXJOYW1lOiBzY2hlZHVsZXJOYW1lLFxyXG5cdFx0c2hvd0xvZzogc2hvd0xvZ1xyXG5cdH07XHJcblx0XHJcblx0aWYgKGxpbWl0UmVzb3VyY2VCeUxvd1F1YWxpdHlQcmlvcml0eSkge1xyXG5cdFx0b3B0aW9ucy5yZXNvdXJjZUd1YXJhbnRlZWRGb3JIaWdoUHJpb3JpdHkgPSByZXNvdXJjZUxpbWl0IC0gMjtcclxuXHRcdG9wdGlvbnMuaGlnaFByaW9yaXR5VG9HdWFyYW50ZWVSZXNvdXJjZSA9XHJcblx0XHRcdHByaW9yaXRpemVyLm1pbmltYWxMb3dRdWFsaXR5UHJpb3JpdHk7XHJcblx0fVxyXG4gICAgICAgIFxyXG4gICAgcmV0dXJuIHtcclxuICAgICAgICBwcmlvcml0aXplcjogcHJpb3JpdGl6ZXIsXHJcbiAgICAgICAgc2NoZWR1bGVyT3B0aW9uczogb3B0aW9uc1xyXG4gICAgfTtcclxufVxyXG4gICAgXHJcbmZ1bmN0aW9uIGZpeEJvdW5kcyhib3VuZHMsIGltYWdlLCBhZGFwdFByb3BvcnRpb25zKSB7XHJcbiAgICBpZiAoIWFkYXB0UHJvcG9ydGlvbnMpIHtcclxuICAgICAgICByZXR1cm47XHJcbiAgICB9XHJcblxyXG4gICAgdmFyIHJlY3RhbmdsZVdpZHRoID0gYm91bmRzLmVhc3QgLSBib3VuZHMud2VzdDtcclxuICAgIHZhciByZWN0YW5nbGVIZWlnaHQgPSBib3VuZHMubm9ydGggLSBib3VuZHMuc291dGg7XHJcblxyXG4gICAgdmFyIHBpeGVsc0FzcGVjdFJhdGlvID0gaW1hZ2UuZ2V0SW1hZ2VXaWR0aCgpIC8gaW1hZ2UuZ2V0SW1hZ2VIZWlnaHQoKTtcclxuICAgIHZhciByZWN0YW5nbGVBc3BlY3RSYXRpbyA9IHJlY3RhbmdsZVdpZHRoIC8gcmVjdGFuZ2xlSGVpZ2h0O1xyXG4gICAgXHJcbiAgICBpZiAocGl4ZWxzQXNwZWN0UmF0aW8gPCByZWN0YW5nbGVBc3BlY3RSYXRpbykge1xyXG4gICAgICAgIHZhciBvbGRXaWR0aCA9IHJlY3RhbmdsZVdpZHRoO1xyXG4gICAgICAgIHJlY3RhbmdsZVdpZHRoID0gcmVjdGFuZ2xlSGVpZ2h0ICogcGl4ZWxzQXNwZWN0UmF0aW87XHJcbiAgICAgICAgdmFyIHN1YnN0cmFjdEZyb21XaWR0aCA9IG9sZFdpZHRoIC0gcmVjdGFuZ2xlV2lkdGg7XHJcbiAgICAgICAgXHJcbiAgICAgICAgYm91bmRzLmVhc3QgLT0gc3Vic3RyYWN0RnJvbVdpZHRoIC8gMjtcclxuICAgICAgICBib3VuZHMud2VzdCArPSBzdWJzdHJhY3RGcm9tV2lkdGggLyAyO1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgICB2YXIgb2xkSGVpZ2h0ID0gcmVjdGFuZ2xlSGVpZ2h0O1xyXG4gICAgICAgIHJlY3RhbmdsZUhlaWdodCA9IHJlY3RhbmdsZVdpZHRoIC8gcGl4ZWxzQXNwZWN0UmF0aW87XHJcbiAgICAgICAgdmFyIHN1YnN0cmFjdEZyb21IZWlnaHQgPSBvbGRIZWlnaHQgLSByZWN0YW5nbGVIZWlnaHQ7XHJcbiAgICAgICAgXHJcbiAgICAgICAgYm91bmRzLm5vcnRoIC09IHN1YnN0cmFjdEZyb21IZWlnaHQgLyAyO1xyXG4gICAgICAgIGJvdW5kcy5zb3V0aCArPSBzdWJzdHJhY3RGcm9tSGVpZ2h0IC8gMjtcclxuICAgIH1cclxufVxyXG5cclxuZnVuY3Rpb24gZW5zdXJlTGV2ZWxDYWxjdWxhdG9yKGxldmVsQ2FsY3VsYXRvcikge1xyXG4gICAgaWYgKCdmdW5jdGlvbicgIT09IHR5cGVvZiBsZXZlbENhbGN1bGF0b3IuZ2V0TGV2ZWwpIHtcclxuICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBNaXNzaW5nIG1ldGhvZCBsZXZlbENhbGN1bGF0b3IuZ2V0TGV2ZWwoKSc7XHJcbiAgICB9XHJcbiAgICBpZiAoJ2Z1bmN0aW9uJyAhPT0gdHlwZW9mIGxldmVsQ2FsY3VsYXRvci5nZXRMZXZlbFdpZHRoKSB7XHJcbiAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogTWlzc2luZyBtZXRob2QgbGV2ZWxDYWxjdWxhdG9yLmdldExldmVsV2lkdGgoKSc7XHJcbiAgICB9XHJcbiAgICBpZiAoJ2Z1bmN0aW9uJyAhPT0gdHlwZW9mIGxldmVsQ2FsY3VsYXRvci5nZXRMZXZlbEhlaWdodCkge1xyXG4gICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IE1pc3NpbmcgbWV0aG9kIGxldmVsQ2FsY3VsYXRvci5nZXRMZXZlbEhlaWdodCgpJztcclxuICAgIH1cclxufVxyXG5cclxuZnVuY3Rpb24gYWxpZ25QYXJhbXNUb1RpbGVzQW5kTGV2ZWwocmVnaW9uLCBpbWFnZURlY29kZXIpIHtcclxuICAgIHZhciB0aWxlV2lkdGggPSBpbWFnZURlY29kZXIuZ2V0VGlsZVdpZHRoKCk7XHJcbiAgICB2YXIgdGlsZUhlaWdodCA9IGltYWdlRGVjb2Rlci5nZXRUaWxlSGVpZ2h0KCk7XHJcbiAgICBcclxuICAgIHZhciByZWdpb25NaW5YID0gcmVnaW9uLm1pblg7XHJcbiAgICB2YXIgcmVnaW9uTWluWSA9IHJlZ2lvbi5taW5ZO1xyXG4gICAgdmFyIHJlZ2lvbk1heFggPSByZWdpb24ubWF4WEV4Y2x1c2l2ZTtcclxuICAgIHZhciByZWdpb25NYXhZID0gcmVnaW9uLm1heFlFeGNsdXNpdmU7XHJcbiAgICB2YXIgc2NyZWVuV2lkdGggPSByZWdpb24uc2NyZWVuV2lkdGg7XHJcbiAgICB2YXIgc2NyZWVuSGVpZ2h0ID0gcmVnaW9uLnNjcmVlbkhlaWdodDtcclxuICAgIFxyXG4gICAgdmFyIGlzVmFsaWRPcmRlciA9IHJlZ2lvbk1pblggPCByZWdpb25NYXhYICYmIHJlZ2lvbk1pblkgPCByZWdpb25NYXhZO1xyXG4gICAgaWYgKCFpc1ZhbGlkT3JkZXIpIHtcclxuICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBQYXJhbWV0ZXJzIG9yZGVyIGlzIGludmFsaWQnO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICB2YXIgZGVmYXVsdExldmVsV2lkdGggPSBpbWFnZURlY29kZXIuZ2V0SW1hZ2VXaWR0aCgpO1xyXG4gICAgdmFyIGRlZmF1bHRMZXZlbEhlaWdodCA9IGltYWdlRGVjb2Rlci5nZXRJbWFnZUhlaWdodCgpO1xyXG4gICAgaWYgKHJlZ2lvbk1heFggPCAwIHx8IHJlZ2lvbk1pblggPj0gZGVmYXVsdExldmVsV2lkdGggfHxcclxuICAgICAgICByZWdpb25NYXhZIDwgMCB8fCByZWdpb25NaW5ZID49IGRlZmF1bHRMZXZlbEhlaWdodCkge1xyXG4gICAgICAgIFxyXG4gICAgICAgIHJldHVybiBudWxsO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICB2YXIgbGV2ZWxDYWxjdWxhdG9yID0gaW1hZ2VEZWNvZGVyLmdldExldmVsQ2FsY3VsYXRvcigpO1xyXG4gICAgdmFyIGxldmVsID0gbGV2ZWxDYWxjdWxhdG9yLmdldExldmVsKHJlZ2lvbik7XHJcbiAgICB2YXIgbGV2ZWxXaWR0aCA9IGxldmVsQ2FsY3VsYXRvci5nZXRMZXZlbFdpZHRoKGxldmVsKTtcclxuICAgIHZhciBsZXZlbEhlaWdodCA9IGxldmVsQ2FsY3VsYXRvci5nZXRMZXZlbEhlaWdodChsZXZlbCk7XHJcbiAgICBcclxuICAgIHZhciBzY2FsZVggPSBkZWZhdWx0TGV2ZWxXaWR0aCAvIGxldmVsV2lkdGg7XHJcbiAgICB2YXIgc2NhbGVZID0gZGVmYXVsdExldmVsSGVpZ2h0IC8gbGV2ZWxIZWlnaHQ7XHJcbiAgICBcclxuICAgIHZhciBtaW5UaWxlWCA9IE1hdGguZmxvb3IocmVnaW9uTWluWCAvIChzY2FsZVggKiB0aWxlV2lkdGggKSk7XHJcbiAgICB2YXIgbWluVGlsZVkgPSBNYXRoLmZsb29yKHJlZ2lvbk1pblkgLyAoc2NhbGVZICogdGlsZUhlaWdodCkpO1xyXG4gICAgdmFyIG1heFRpbGVYID0gTWF0aC5jZWlsIChyZWdpb25NYXhYIC8gKHNjYWxlWCAqIHRpbGVXaWR0aCApKTtcclxuICAgIHZhciBtYXhUaWxlWSA9IE1hdGguY2VpbCAocmVnaW9uTWF4WSAvIChzY2FsZVkgKiB0aWxlSGVpZ2h0KSk7XHJcbiAgICBcclxuICAgIHZhciBtaW5YID0gbWluVGlsZVggKiB0aWxlV2lkdGg7XHJcbiAgICB2YXIgbWluWSA9IG1pblRpbGVZICogdGlsZUhlaWdodDtcclxuICAgIHZhciBtYXhYID0gbWF4VGlsZVggKiB0aWxlV2lkdGg7XHJcbiAgICB2YXIgbWF4WSA9IG1heFRpbGVZICogdGlsZUhlaWdodDtcclxuICAgIFxyXG4gICAgdmFyIGNyb3BwZWRNaW5YID0gTWF0aC5tYXgoMCwgTWF0aC5taW4obGV2ZWxXaWR0aCAsIG1pblgpKTtcclxuICAgIHZhciBjcm9wcGVkTWluWSA9IE1hdGgubWF4KDAsIE1hdGgubWluKGxldmVsSGVpZ2h0LCBtaW5ZKSk7XHJcbiAgICB2YXIgY3JvcHBlZE1heFggPSBNYXRoLm1heCgwLCBNYXRoLm1pbihsZXZlbFdpZHRoICwgbWF4WCkpO1xyXG4gICAgdmFyIGNyb3BwZWRNYXhZID0gTWF0aC5tYXgoMCwgTWF0aC5taW4obGV2ZWxIZWlnaHQsIG1heFkpKTtcclxuICAgIFxyXG4gICAgdmFyIGltYWdlUGFyYW1zVG9TY3JlZW5TY2FsZVggPSBzY3JlZW5XaWR0aCAgLyAobWF4WCAtIG1pblgpO1xyXG4gICAgdmFyIGltYWdlUGFyYW1zVG9TY3JlZW5TY2FsZVkgPSBzY3JlZW5IZWlnaHQgLyAobWF4WSAtIG1pblkpO1xyXG4gICAgXHJcbiAgICB2YXIgaW1hZ2VQYXJ0UGFyYW1zID0ge1xyXG4gICAgICAgIG1pblg6IGNyb3BwZWRNaW5YLFxyXG4gICAgICAgIG1pblk6IGNyb3BwZWRNaW5ZLFxyXG4gICAgICAgIG1heFhFeGNsdXNpdmU6IGNyb3BwZWRNYXhYLFxyXG4gICAgICAgIG1heFlFeGNsdXNpdmU6IGNyb3BwZWRNYXhZLFxyXG4gICAgICAgIGxldmVsV2lkdGg6IGxldmVsV2lkdGgsXHJcbiAgICAgICAgbGV2ZWxIZWlnaHQ6IGxldmVsSGVpZ2h0LFxyXG4gICAgICAgIGxldmVsOiBsZXZlbFxyXG4gICAgfTtcclxuICAgIFxyXG4gICAgdmFyIHBvc2l0aW9uSW5JbWFnZSA9IHtcclxuICAgICAgICBtaW5YOiBjcm9wcGVkTWluWCAqIHNjYWxlWCxcclxuICAgICAgICBtaW5ZOiBjcm9wcGVkTWluWSAqIHNjYWxlWSxcclxuICAgICAgICBtYXhYRXhjbHVzaXZlOiBjcm9wcGVkTWF4WCAqIHNjYWxlWCxcclxuICAgICAgICBtYXhZRXhjbHVzaXZlOiBjcm9wcGVkTWF4WSAqIHNjYWxlWVxyXG4gICAgfTtcclxuICAgIFxyXG4gICAgdmFyIGNyb3BwZWRTY3JlZW4gPSB7XHJcbiAgICAgICAgbWluWCA6IE1hdGguZmxvb3IoKGNyb3BwZWRNaW5YIC0gbWluWCkgKiBpbWFnZVBhcmFtc1RvU2NyZWVuU2NhbGVYKSxcclxuICAgICAgICBtaW5ZIDogTWF0aC5mbG9vcigoY3JvcHBlZE1pblkgLSBtaW5ZKSAqIGltYWdlUGFyYW1zVG9TY3JlZW5TY2FsZVkpLFxyXG4gICAgICAgIG1heFhFeGNsdXNpdmUgOiBNYXRoLmNlaWwoKGNyb3BwZWRNYXhYIC0gbWluWCkgKiBpbWFnZVBhcmFtc1RvU2NyZWVuU2NhbGVYKSxcclxuICAgICAgICBtYXhZRXhjbHVzaXZlIDogTWF0aC5jZWlsKChjcm9wcGVkTWF4WSAtIG1pblkpICogaW1hZ2VQYXJhbXNUb1NjcmVlblNjYWxlWSlcclxuICAgIH07XHJcbiAgICBcclxuICAgIHJldHVybiB7XHJcbiAgICAgICAgaW1hZ2VQYXJ0UGFyYW1zOiBpbWFnZVBhcnRQYXJhbXMsXHJcbiAgICAgICAgcG9zaXRpb25JbkltYWdlOiBwb3NpdGlvbkluSW1hZ2UsXHJcbiAgICAgICAgY3JvcHBlZFNjcmVlbjogY3JvcHBlZFNjcmVlblxyXG4gICAgfTtcclxufVxyXG5cclxuZnVuY3Rpb24gZ2V0T3JDcmVhdGVJbnN0YW5jZShvYmosIG9iak5hbWUsIGV4cGVjdGVkTWV0aG9kcykge1xyXG4gICAgaWYgKCFpc0luZGlyZWN0Q3JlYXRpb25OZWVkZWQob2JqLCBvYmpOYW1lLCBleHBlY3RlZE1ldGhvZHMpKSB7XHJcbiAgICAgICAgcmV0dXJuIG9iajtcclxuICAgIH1cclxuICAgIFxyXG4gICAgdmFyIGNsYXNzVG9DcmVhdGUgPSBudWxsO1xyXG4gICAgdHJ5IHtcclxuICAgICAgICBjbGFzc1RvQ3JlYXRlID0gZ2V0Q2xhc3NJbkdsb2JhbE9iamVjdCh3aW5kb3csIG9iai5jdG9yTmFtZSk7XHJcbiAgICB9IGNhdGNoKGUpIHsgfVxyXG5cclxuICAgIGlmICghY2xhc3NUb0NyZWF0ZSkge1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGNsYXNzVG9DcmVhdGUgPSBnZXRDbGFzc0luR2xvYmFsT2JqZWN0KGdsb2JhbHMsIG9iai5jdG9yTmFtZSk7XHJcbiAgICAgICAgfSBjYXRjaChlKSB7IH1cclxuICAgIH1cclxuICAgIFxyXG4gICAgaWYgKCFjbGFzc1RvQ3JlYXRlKSB7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgY2xhc3NUb0NyZWF0ZSA9IGdldENsYXNzSW5HbG9iYWxPYmplY3Qoc2VsZiwgb2JqLmN0b3JOYW1lKTtcclxuICAgICAgICB9IGNhdGNoKGUpIHsgfVxyXG4gICAgfVxyXG4gICAgXHJcbiAgICBpZiAoIWNsYXNzVG9DcmVhdGUpIHtcclxuICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBDb3VsZCBub3QgZmluZCBjbGFzcyAnICsgb2JqLmN0b3JOYW1lICsgJyBpbiBnbG9iYWwgJyArXHJcbiAgICAgICAgICAgICcgc2NvcGUgdG8gY3JlYXRlIGFuIGluc3RhbmNlIG9mICcgKyBvYmpOYW1lO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICB2YXIgcmVzdWx0ID0gbmV3IGNsYXNzVG9DcmVhdGUoKTtcclxuICAgIFxyXG4gICAgLy8gVGhyb3cgZXhjZXB0aW9uIGlmIG1ldGhvZHMgbm90IGV4aXN0XHJcbiAgICBpc0luZGlyZWN0Q3JlYXRpb25OZWVkZWQocmVzdWx0LCBvYmpOYW1lLCBleHBlY3RlZE1ldGhvZHMsIC8qZGlzYWJsZUN0b3JOYW1lU2VhcmNoPSovdHJ1ZSk7XHJcbiAgICBcclxuICAgIHJldHVybiByZXN1bHQ7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGlzSW5kaXJlY3RDcmVhdGlvbk5lZWRlZChvYmosIG9iak5hbWUsIGV4cGVjdGVkTWV0aG9kcywgZGlzYWJsZUN0b3JOYW1lU2VhcmNoKSB7XHJcbiAgICBpZiAoIW9iaikge1xyXG4gICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IG1pc3NpbmcgYXJndW1lbnQgJyArIG9iak5hbWU7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHZhciBub25leGlzdGluZ01ldGhvZDtcclxuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgZXhwZWN0ZWRNZXRob2RzLmxlbmd0aDsgKytpKSB7XHJcbiAgICAgICAgaWYgKCdmdW5jdGlvbicgIT09IHR5cGVvZiBvYmpbZXhwZWN0ZWRNZXRob2RzW2ldXSkge1xyXG4gICAgICAgICAgICBub25leGlzdGluZ01ldGhvZCA9IGV4cGVjdGVkTWV0aG9kc1tpXTtcclxuICAgICAgICAgICAgYnJlYWs7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgXHJcbiAgICBpZiAoaSA9PT0gZXhwZWN0ZWRNZXRob2RzLmxlbmd0aCkge1xyXG4gICAgICAgIHJldHVybiBmYWxzZTtcclxuICAgIH1cclxuXHJcbiAgICBpZiAoZGlzYWJsZUN0b3JOYW1lU2VhcmNoKSB7XHJcbiAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogQ291bGQgbm90IGZpbmQgbWV0aG9kICcgK1xyXG4gICAgICAgICAgICBub25leGlzdGluZ01ldGhvZCArICcgaW4gb2JqZWN0ICcgKyBvYmpOYW1lO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBpZiAoJ3N0cmluZycgIT09IHR5cGVvZiBvYmouY3Rvck5hbWUpIHtcclxuICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBDb3VsZCBub3QgZmluZCBtZXRob2QgJyArIG5vbmV4aXN0aW5nTWV0aG9kICtcclxuICAgICAgICAgICAgJyBpbiBvYmplY3QgJyArIG9iak5hbWUgKyAnLiBFaXRoZXIgbWV0aG9kIHNob3VsZCBiZSBleGlzdCBvciB0aGUgb2JqZWN0XFwncyAnICtcclxuICAgICAgICAgICAgJ2N0b3JOYW1lIHByb3BlcnR5IHNob3VsZCBwb2ludCB0byBhIGNsYXNzIHRvIGNyZWF0ZSBpbnN0YW5jZSBmcm9tJztcclxuICAgIH1cclxuICAgIGlmICghb2JqLnNjcmlwdHNUb0ltcG9ydCkge1xyXG4gICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IENvdWxkIG5vdCBmaW5kIG1ldGhvZCAnICsgbm9uZXhpc3RpbmdNZXRob2QgK1xyXG4gICAgICAgICAgICAnIGluIG9iamVjdCAnICsgb2JqTmFtZSArICcuIEVpdGhlciBtZXRob2Qgc2hvdWxkIGJlIGV4aXN0IG9yIHRoZSBvYmplY3RcXCdzICcgK1xyXG4gICAgICAgICAgICAnc2NyaXB0c1RvSW1wb3J0IHByb3BlcnR5IHNob3VsZCBiZSBleGlzdCc7XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIHRydWU7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGdldENsYXNzSW5HbG9iYWxPYmplY3QoZ2xvYmFsT2JqZWN0LCBjbGFzc05hbWUpIHtcclxuICAgIGlmIChnbG9iYWxPYmplY3RbY2xhc3NOYW1lXSkge1xyXG4gICAgICAgIHJldHVybiBnbG9iYWxPYmplY3RbY2xhc3NOYW1lXTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgdmFyIHJlc3VsdCA9IGdsb2JhbE9iamVjdDtcclxuICAgIHZhciBwYXRoID0gY2xhc3NOYW1lLnNwbGl0KCcuJyk7XHJcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IHBhdGgubGVuZ3RoOyArK2kpIHtcclxuICAgICAgICByZXN1bHQgPSByZXN1bHRbcGF0aFtpXV07XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHJldHVybiByZXN1bHQ7XHJcbn0iLCIndXNlIHN0cmljdCc7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IExpbmtlZExpc3Q7XHJcblxyXG5mdW5jdGlvbiBMaW5rZWRMaXN0KCkge1xyXG4gICAgdGhpcy5fZmlyc3QgPSB7IF9wcmV2OiBudWxsLCBfcGFyZW50OiB0aGlzIH07XHJcbiAgICB0aGlzLl9sYXN0ID0geyBfbmV4dDogbnVsbCwgX3BhcmVudDogdGhpcyB9O1xyXG4gICAgdGhpcy5fY291bnQgPSAwO1xyXG4gICAgXHJcbiAgICB0aGlzLl9sYXN0Ll9wcmV2ID0gdGhpcy5fZmlyc3Q7XHJcbiAgICB0aGlzLl9maXJzdC5fbmV4dCA9IHRoaXMuX2xhc3Q7XHJcbn1cclxuXHJcbkxpbmtlZExpc3QucHJvdG90eXBlLmFkZCA9IGZ1bmN0aW9uIGFkZCh2YWx1ZSwgYWRkQmVmb3JlKSB7XHJcbiAgICBpZiAoYWRkQmVmb3JlID09PSBudWxsIHx8IGFkZEJlZm9yZSA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgYWRkQmVmb3JlID0gdGhpcy5fbGFzdDtcclxuICAgIH1cclxuICAgIFxyXG4gICAgdGhpcy5fdmFsaWRhdGVJdGVyYXRvck9mVGhpcyhhZGRCZWZvcmUpO1xyXG4gICAgXHJcbiAgICArK3RoaXMuX2NvdW50O1xyXG4gICAgXHJcbiAgICB2YXIgbmV3Tm9kZSA9IHtcclxuICAgICAgICBfdmFsdWU6IHZhbHVlLFxyXG4gICAgICAgIF9uZXh0OiBhZGRCZWZvcmUsXHJcbiAgICAgICAgX3ByZXY6IGFkZEJlZm9yZS5fcHJldixcclxuICAgICAgICBfcGFyZW50OiB0aGlzXHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBuZXdOb2RlLl9wcmV2Ll9uZXh0ID0gbmV3Tm9kZTtcclxuICAgIGFkZEJlZm9yZS5fcHJldiA9IG5ld05vZGU7XHJcbiAgICBcclxuICAgIHJldHVybiBuZXdOb2RlO1xyXG59O1xyXG5cclxuTGlua2VkTGlzdC5wcm90b3R5cGUucmVtb3ZlID0gZnVuY3Rpb24gcmVtb3ZlKGl0ZXJhdG9yKSB7XHJcbiAgICB0aGlzLl92YWxpZGF0ZUl0ZXJhdG9yT2ZUaGlzKGl0ZXJhdG9yKTtcclxuICAgIFxyXG4gICAgLS10aGlzLl9jb3VudDtcclxuICAgIFxyXG4gICAgaXRlcmF0b3IuX3ByZXYuX25leHQgPSBpdGVyYXRvci5fbmV4dDtcclxuICAgIGl0ZXJhdG9yLl9uZXh0Ll9wcmV2ID0gaXRlcmF0b3IuX3ByZXY7XHJcbiAgICBpdGVyYXRvci5fcGFyZW50ID0gbnVsbDtcclxufTtcclxuXHJcbkxpbmtlZExpc3QucHJvdG90eXBlLmdldFZhbHVlID0gZnVuY3Rpb24gZ2V0VmFsdWUoaXRlcmF0b3IpIHtcclxuICAgIHRoaXMuX3ZhbGlkYXRlSXRlcmF0b3JPZlRoaXMoaXRlcmF0b3IpO1xyXG4gICAgXHJcbiAgICByZXR1cm4gaXRlcmF0b3IuX3ZhbHVlO1xyXG59O1xyXG5cclxuTGlua2VkTGlzdC5wcm90b3R5cGUuZ2V0Rmlyc3RJdGVyYXRvciA9IGZ1bmN0aW9uIGdldEZpcnN0SXRlcmF0b3IoKSB7XHJcbiAgICB2YXIgaXRlcmF0b3IgPSB0aGlzLmdldE5leHRJdGVyYXRvcih0aGlzLl9maXJzdCk7XHJcbiAgICByZXR1cm4gaXRlcmF0b3I7XHJcbn07XHJcblxyXG5MaW5rZWRMaXN0LnByb3RvdHlwZS5nZXRMYXN0SXRlcmF0b3IgPSBmdW5jdGlvbiBnZXRGaXJzdEl0ZXJhdG9yKCkge1xyXG4gICAgdmFyIGl0ZXJhdG9yID0gdGhpcy5nZXRQcmV2SXRlcmF0b3IodGhpcy5fbGFzdCk7XHJcbiAgICByZXR1cm4gaXRlcmF0b3I7XHJcbn07XHJcblxyXG5MaW5rZWRMaXN0LnByb3RvdHlwZS5nZXROZXh0SXRlcmF0b3IgPSBmdW5jdGlvbiBnZXROZXh0SXRlcmF0b3IoaXRlcmF0b3IpIHtcclxuICAgIHRoaXMuX3ZhbGlkYXRlSXRlcmF0b3JPZlRoaXMoaXRlcmF0b3IpO1xyXG5cclxuICAgIGlmIChpdGVyYXRvci5fbmV4dCA9PT0gdGhpcy5fbGFzdCkge1xyXG4gICAgICAgIHJldHVybiBudWxsO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICByZXR1cm4gaXRlcmF0b3IuX25leHQ7XHJcbn07XHJcblxyXG5MaW5rZWRMaXN0LnByb3RvdHlwZS5nZXRQcmV2SXRlcmF0b3IgPSBmdW5jdGlvbiBnZXRQcmV2SXRlcmF0b3IoaXRlcmF0b3IpIHtcclxuICAgIHRoaXMuX3ZhbGlkYXRlSXRlcmF0b3JPZlRoaXMoaXRlcmF0b3IpO1xyXG5cclxuICAgIGlmIChpdGVyYXRvci5fcHJldiA9PT0gdGhpcy5fZmlyc3QpIHtcclxuICAgICAgICByZXR1cm4gbnVsbDtcclxuICAgIH1cclxuICAgIFxyXG4gICAgcmV0dXJuIGl0ZXJhdG9yLl9wcmV2O1xyXG59O1xyXG5cclxuTGlua2VkTGlzdC5wcm90b3R5cGUuZ2V0Q291bnQgPSBmdW5jdGlvbiBnZXRDb3VudCgpIHtcclxuICAgIHJldHVybiB0aGlzLl9jb3VudDtcclxufTtcclxuXHJcbkxpbmtlZExpc3QucHJvdG90eXBlLl92YWxpZGF0ZUl0ZXJhdG9yT2ZUaGlzID1cclxuICAgIGZ1bmN0aW9uIHZhbGlkYXRlSXRlcmF0b3JPZlRoaXMoaXRlcmF0b3IpIHtcclxuICAgIFxyXG4gICAgaWYgKGl0ZXJhdG9yLl9wYXJlbnQgIT09IHRoaXMpIHtcclxuICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBpdGVyYXRvciBtdXN0IGJlIG9mIHRoZSBjdXJyZW50IExpbmtlZExpc3QnO1xyXG4gICAgfVxyXG59OyIsIid1c2Ugc3RyaWN0JztcclxuXHJcbnZhciBGZXRjaENvbnRleHRBcGkgPSByZXF1aXJlKCdmZXRjaC1jb250ZXh0LWFwaS5qcycpO1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBTaW1wbGVNb3ZhYmxlRmV0Y2g7XHJcblxyXG52YXIgRkVUQ0hfU1RBVEVfV0FJVF9GT1JfTU9WRSA9IDE7XHJcbnZhciBGRVRDSF9TVEFURV9BQ1RJVkUgPSAyO1xyXG52YXIgRkVUQ0hfU1RBVEVfU1RPUFBJTkcgPSAzO1xyXG52YXIgRkVUQ0hfU1RBVEVfU1RPUFBFRCA9IDQ7XHJcbnZhciBGRVRDSF9TVEFURV9URVJNSU5BVEVEID0gNTtcclxuXHJcbmZ1bmN0aW9uIFNpbXBsZU1vdmFibGVGZXRjaChmZXRjaGVyLCBpbmRpcmVjdENsb3NlSW5kaWNhdGlvbiwgZmV0Y2hDb250ZXh0LCBtYXhBY3RpdmVGZXRjaGVzSW5Nb3ZhYmxlRmV0Y2gpIHtcclxuXHR0aGlzLl9mZXRjaGVyID0gZmV0Y2hlcjtcclxuXHR0aGlzLl9pbmRpcmVjdENsb3NlSW5kaWNhdGlvbiA9IGluZGlyZWN0Q2xvc2VJbmRpY2F0aW9uO1xyXG5cdHRoaXMuX21vdmFibGVGZXRjaENvbnRleHQgPSBmZXRjaENvbnRleHQ7XHJcblx0dGhpcy5fbWF4QWN0aXZlRmV0Y2hlc0luTW92YWJsZUZldGNoID0gbWF4QWN0aXZlRmV0Y2hlc0luTW92YWJsZUZldGNoO1xyXG5cdFxyXG5cdHRoaXMuX2xhc3RGZXRjaCA9IG51bGw7XHJcblx0dGhpcy5fYWN0aXZlRmV0Y2hlc0luTW92YWJsZUZldGNoID0gMDtcclxuXHR0aGlzLl9wZW5kaW5nSW1hZ2VQYXJ0UGFyYW1zID0gbnVsbDtcclxuXHR0aGlzLl9tb3ZhYmxlU3RhdGUgPSBGRVRDSF9TVEFURV9XQUlUX0ZPUl9NT1ZFO1xyXG5cdFxyXG5cdHRoaXMuX2lzUHJvZ3Jlc3NpdmUgPSBmYWxzZTtcclxuXHR0aGlzLl9pc1Byb2dyZXNzaXZlQ2hhbmdlZENhbGxlZCA9IGZhbHNlO1xyXG5cdFxyXG5cdGZldGNoQ29udGV4dC5vbignbW92ZScsIHRoaXMuX29uTW92ZSwgdGhpcyk7XHJcblx0ZmV0Y2hDb250ZXh0Lm9uKCd0ZXJtaW5hdGUnLCB0aGlzLl9vblRlcm1pbmF0ZWQsIHRoaXMpO1xyXG5cdGZldGNoQ29udGV4dC5vbignaXNQcm9ncmVzc2l2ZUNoYW5nZWQnLCB0aGlzLl9vbklzUHJvZ3Jlc3NpdmVDaGFuZ2VkLCB0aGlzKTtcclxuXHRmZXRjaENvbnRleHQub24oJ3N0b3AnLCB0aGlzLl9vblN0b3AsIHRoaXMpO1xyXG5cdGZldGNoQ29udGV4dC5vbigncmVzdW1lJywgdGhpcy5fb25SZXN1bWUsIHRoaXMpO1xyXG59XHJcblxyXG5TaW1wbGVNb3ZhYmxlRmV0Y2gucHJvdG90eXBlLnN0YXJ0ID0gZnVuY3Rpb24gc3RhcnQoaW1hZ2VQYXJ0UGFyYW1zKSB7XHJcblx0dGhpcy5fb25Nb3ZlKGltYWdlUGFydFBhcmFtcyk7XHJcbn07XHJcblxyXG5TaW1wbGVNb3ZhYmxlRmV0Y2gucHJvdG90eXBlLl9vbklzUHJvZ3Jlc3NpdmVDaGFuZ2VkID0gZnVuY3Rpb24gaXNQcm9ncmVzc2l2ZUNoYW5nZWQoaXNQcm9ncmVzc2l2ZSkge1xyXG5cdHRoaXMuX2lzUHJvZ3Jlc3NpdmUgPSBpc1Byb2dyZXNzaXZlO1xyXG5cdHZhciBsYXN0QWN0aXZlRmV0Y2ggPSB0aGlzLl9nZXRMYXN0RmV0Y2hBY3RpdmUoKTtcclxuXHRpZiAobGFzdEFjdGl2ZUZldGNoICE9PSBudWxsKSB7XHJcblx0XHRsYXN0QWN0aXZlRmV0Y2guX29uRXZlbnQoJ2lzUHJvZ3Jlc3NpdmVDaGFuZ2VkJywgaXNQcm9ncmVzc2l2ZSk7XHJcblx0fSBlbHNlIHtcclxuXHRcdHRoaXMuX2lzUHJvZ3Jlc3NpdmVDaGFuZ2VkQ2FsbGVkID0gdHJ1ZTtcclxuXHR9XHJcbn07XHJcblxyXG5TaW1wbGVNb3ZhYmxlRmV0Y2gucHJvdG90eXBlLl9vblN0b3AgPSBmdW5jdGlvbiBzdG9wKGlzQWJvcnRlZCkge1xyXG5cdHRoaXMuX3N3aXRjaFN0YXRlKEZFVENIX1NUQVRFX1NUT1BQSU5HLCBGRVRDSF9TVEFURV9BQ1RJVkUpO1xyXG5cdHZhciBsYXN0QWN0aXZlRmV0Y2ggPSB0aGlzLl9nZXRMYXN0RmV0Y2hBY3RpdmUoKTtcclxuXHRpZiAobGFzdEFjdGl2ZUZldGNoICE9PSBudWxsKSB7XHJcblx0XHRsYXN0QWN0aXZlRmV0Y2guX29uRXZlbnQoJ3N0b3AnLCBpc0Fib3J0ZWQpO1xyXG5cdH1cclxufTtcclxuXHJcblNpbXBsZU1vdmFibGVGZXRjaC5wcm90b3R5cGUuX29uUmVzdW1lID0gZnVuY3Rpb24gcmVzdW1lKCkge1xyXG5cdHRoaXMuX3N3aXRjaFN0YXRlKEZFVENIX1NUQVRFX0FDVElWRSwgRkVUQ0hfU1RBVEVfU1RPUFBFRCwgRkVUQ0hfU1RBVEVfU1RPUFBJTkcpO1xyXG5cclxuXHRpZiAodGhpcy5fbGFzdEZldGNoID09PSBudWxsKSB7XHJcblx0XHR0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiByZXN1bWluZyBub24gc3RvcHBlZCBmZXRjaCc7XHJcblx0fVxyXG5cdFxyXG5cdGlmICh0aGlzLl9pc1Byb2dyZXNzaXZlQ2hhbmdlZENhbGxlZCkge1xyXG5cdFx0dGhpcy5faXNQcm9ncmVzc2l2ZUNoYW5nZWRDYWxsZWQgPSBmYWxzZTtcclxuXHRcdHRoaXMuX2xhc3RGZXRjaC5fb25FdmVudCgnaXNQcm9ncmVzc2l2ZUNoYW5nZWQnLCB0aGlzLl9pc1Byb2dyZXNzaXZlKTtcclxuXHR9XHJcblx0dGhpcy5fbGFzdEZldGNoLl9vbkV2ZW50KCdyZXN1bWUnKTtcclxufTtcclxuXHJcblNpbXBsZU1vdmFibGVGZXRjaC5wcm90b3R5cGUuX29uVGVybWluYXRlZCA9IGZ1bmN0aW9uIG9uVGVybWluYXRlZChpc0Fib3J0ZWQpIHtcclxuXHR0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBVbmV4cGVjdGVkIHRlcm1pbmF0aW9uIG9mIG1vdmFibGUgZmV0Y2gnO1xyXG59O1xyXG5cclxuU2ltcGxlTW92YWJsZUZldGNoLnByb3RvdHlwZS5fb25Nb3ZlID0gZnVuY3Rpb24gbW92ZShpbWFnZVBhcnRQYXJhbXMpIHtcclxuXHR0aGlzLl9wZW5kaW5nSW1hZ2VQYXJ0UGFyYW1zID0gaW1hZ2VQYXJ0UGFyYW1zO1xyXG5cdHRoaXMuX21vdmFibGVTdGF0ZSA9IEZFVENIX1NUQVRFX0FDVElWRTtcclxuXHR0aGlzLl90cnlTdGFydFBlbmRpbmdGZXRjaCgpO1xyXG59O1xyXG5cclxuU2ltcGxlTW92YWJsZUZldGNoLnByb3RvdHlwZS5fdHJ5U3RhcnRQZW5kaW5nRmV0Y2ggPSBmdW5jdGlvbiB0cnlTdGFydFBlbmRpbmdGZXRjaCgpIHtcclxuXHRpZiAodGhpcy5faW5kaXJlY3RDbG9zZUluZGljYXRpb24uaXNDbG9zZVJlcXVlc3RlZCB8fFxyXG5cdFx0dGhpcy5fYWN0aXZlRmV0Y2hlc0luTW92YWJsZUZldGNoID49IHRoaXMuX21heEFjdGl2ZUZldGNoZXNJbk1vdmFibGVGZXRjaCB8fFxyXG5cdFx0dGhpcy5fcGVuZGluZ0ltYWdlUGFydFBhcmFtcyA9PT0gbnVsbCB8fFxyXG5cdFx0dGhpcy5fbW92YWJsZVN0YXRlICE9PSBGRVRDSF9TVEFURV9BQ1RJVkUpIHtcclxuXHJcblx0XHRcdHJldHVybjtcclxuXHR9XHJcblx0XHJcblx0dmFyIG5ld0ZldGNoID0ge1xyXG5cdFx0aW1hZ2VQYXJ0UGFyYW1zOiB0aGlzLl9wZW5kaW5nSW1hZ2VQYXJ0UGFyYW1zLFxyXG5cdFx0c3RhdGU6IEZFVENIX1NUQVRFX0FDVElWRSxcclxuXHJcblx0XHRmZXRjaENvbnRleHQ6IG51bGwsXHJcblx0XHRzZWxmOiB0aGlzXHJcblx0fTtcclxuXHRcclxuXHR0aGlzLl9wZW5kaW5nSW1hZ2VQYXJ0UGFyYW1zID0gbnVsbDtcclxuXHQrK3RoaXMuX2FjdGl2ZUZldGNoZXNJbk1vdmFibGVGZXRjaDtcclxuXHRcclxuXHRuZXdGZXRjaC5mZXRjaENvbnRleHQgPSBuZXcgRmV0Y2hDb250ZXh0QXBpKCk7XHJcblx0bmV3RmV0Y2guZmV0Y2hDb250ZXh0Lm9uKCdpbnRlcm5hbFN0b3BwZWQnLCBvblNpbmdsZUZldGNoU3RvcHBlZCwgbmV3RmV0Y2gpO1xyXG5cdG5ld0ZldGNoLmZldGNoQ29udGV4dC5vbignaW50ZXJuYWxEb25lJywgb25TaW5nbGVGZXRjaERvbmUsIG5ld0ZldGNoKTtcclxuICAgIFxyXG4gICAgdGhpcy5fZmV0Y2hlci5zdGFydEZldGNoKG5ld0ZldGNoLmZldGNoQ29udGV4dCwgbmV3RmV0Y2guaW1hZ2VQYXJ0UGFyYW1zKTtcclxufTtcclxuXHJcblNpbXBsZU1vdmFibGVGZXRjaC5wcm90b3R5cGUuX3NpbmdsZUZldGNoU3RvcHBlZCA9IGZ1bmN0aW9uIHNpbmdsZUZldGNoU3RvcHBlZChmZXRjaCwgaXNEb25lKSB7XHJcblx0LS10aGlzLl9hY3RpdmVGZXRjaGVzSW5Nb3ZhYmxlRmV0Y2g7XHJcblx0dGhpcy5fbGFzdEZldGNoID0gbnVsbDtcclxuXHRmZXRjaC5zdGF0ZSA9IEZFVENIX1NUQVRFX1RFUk1JTkFURUQ7XHJcbn07XHJcblxyXG5TaW1wbGVNb3ZhYmxlRmV0Y2gucHJvdG90eXBlLl9nZXRMYXN0RmV0Y2hBY3RpdmUgPSBmdW5jdGlvbiBnZXRMYXN0RmV0Y2hBY3RpdmUoKSB7XHJcblx0aWYgKHRoaXMuX21vdmFibGVTdGF0ZSA9PT0gRkVUQ0hfU1RBVEVfU1RPUFBFRCB8fCB0aGlzLl9sYXN0RmV0Y2ggPT09IG51bGwpIHtcclxuXHRcdHJldHVybiBudWxsO1xyXG5cdH1cclxuXHRcclxuXHRpZiAodGhpcy5fbGFzdEZldGNoLnN0YXRlID09PSBGRVRDSF9TVEFURV9BQ1RJVkUpIHtcclxuXHRcdHJldHVybiB0aGlzLl9sYXN0RmV0Y2guZmV0Y2hDb250ZXh0O1xyXG5cdH1cclxuXHRyZXR1cm4gbnVsbDtcclxufTtcclxuXHJcblNpbXBsZU1vdmFibGVGZXRjaC5wcm90b3R5cGUuX3N3aXRjaFN0YXRlID0gZnVuY3Rpb24gc3dpdGNoU3RhdGUodGFyZ2V0U3RhdGUsIGV4cGVjdGVkU3RhdGUsIGV4cGVjdGVkU3RhdGUyLCBleHBlY3RlZFN0YXRlMykge1xyXG5cdGlmICh0aGlzLl9tb3ZhYmxlU3RhdGUgIT09IGV4cGVjdGVkU3RhdGUgJiYgdGhpcy5fbW92YWJsZVN0YXRlICE9PSBleHBlY3RlZFN0YXRlMiAmJiB0aGlzLl9tb3ZhYmxlU3RhdGUgIT09IGV4cGVjdGVkU3RhdGUzKSB7XHJcblx0XHR0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBVbmV4cGVjdGVkIHN0YXRlICcgKyB0aGlzLl9tb3ZhYmxlU3RhdGUgKyAnLCBleHBlY3RlZCAnICsgZXhwZWN0ZWRTdGF0ZSArICcgb3IgJyArIGV4cGVjdGVkU3RhdGUyICsgJyBvciAnICsgZXhwZWN0ZWRTdGF0ZTM7XHJcblx0fVxyXG5cdHRoaXMuX21vdmFibGVTdGF0ZSA9IHRhcmdldFN0YXRlO1xyXG59O1xyXG5cclxuU2ltcGxlTW92YWJsZUZldGNoLnByb3RvdHlwZS5faXNMYXN0RmV0Y2ggPSBmdW5jdGlvbiBpc0xhc3RGZXRjaChmZXRjaCkge1xyXG5cdHJldHVybiB0aGlzLl9sYXN0RmV0Y2ggPT09IGZldGNoICYmIHRoaXMuX3BlbmRpbmdJbWFnZVBhcnRQYXJhbXMgPT09IG51bGw7XHJcbn07XHJcblxyXG5mdW5jdGlvbiBvblNpbmdsZUZldGNoU3RvcHBlZCgpIHtcclxuXHQvKiBqc2hpbnQgdmFsaWR0aGlzOiB0cnVlICovXHJcblx0dmFyIGZldGNoID0gdGhpcztcclxuXHR2YXIgbW92YWJsZUZldGNoID0gZmV0Y2guc2VsZjtcclxuXHRcclxuXHRpZiAoZmV0Y2guc3RhdGUgIT09IEZFVENIX1NUQVRFX1NUT1BQSU5HKSB7XHJcblx0XHR0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBVbmV4cGVjdGVkIHN0YXRlIG9mIGZldGNoICcgKyBmZXRjaC5zdGF0ZSArICcgb24gc3RvcHBlZCc7XHJcblx0fVxyXG5cdFxyXG5cdGlmIChtb3ZhYmxlRmV0Y2guX2lzTGFzdEZldGNoKGZldGNoKSkge1xyXG5cdFx0ZmV0Y2guc3RhdGUgPSBGRVRDSF9TVEFURV9TVE9QUEVEO1xyXG5cdFx0bW92YWJsZUZldGNoLl9zd2l0Y2hTdGF0ZShGRVRDSF9TVEFURV9TVE9QUEVELCBGRVRDSF9TVEFURV9TVE9QUElORyk7XHJcblx0XHRtb3ZhYmxlRmV0Y2guX21vdmFibGVGZXRjaENvbnRleHQuc3RvcHBlZCgpO1xyXG5cdH0gZWxzZSB7XHJcblx0XHRtb3ZhYmxlRmV0Y2guX3NpbmdsZUZldGNoU3RvcHBlZChmZXRjaCk7XHJcblx0fVxyXG5cclxuXHRtb3ZhYmxlRmV0Y2guX3RyeVN0YXJ0UGVuZGluZ0ZldGNoKCk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIG9uU2luZ2xlRmV0Y2hEb25lKCkge1xyXG5cdC8qIGpzaGludCB2YWxpZHRoaXM6IHRydWUgKi9cclxuXHR2YXIgZmV0Y2ggPSB0aGlzO1xyXG5cdHZhciBtb3ZhYmxlRmV0Y2ggPSBmZXRjaC5zZWxmO1xyXG5cclxuXHRpZiAoZmV0Y2guc3RhdGUgIT09IEZFVENIX1NUQVRFX0FDVElWRSAmJiBmZXRjaC5zdGF0ZSAhPT0gRkVUQ0hfU1RBVEVfU1RPUFBJTkcpIHtcclxuXHRcdHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IFVuZXhwZWN0ZWQgc3RhdGUgb2YgZmV0Y2ggJyArIGZldGNoLnN0YXRlICsgJyBvbiBkb25lJztcclxuXHR9XHJcblxyXG5cdGZldGNoLnN0YXRlID0gRkVUQ0hfU1RBVEVfVEVSTUlOQVRFRDtcclxuXHRpZiAobW92YWJsZUZldGNoLl9pc0xhc3RGZXRjaChmZXRjaCkpIHtcclxuXHRcdG1vdmFibGVGZXRjaC5fc3dpdGNoU3RhdGUoRkVUQ0hfU1RBVEVfV0FJVF9GT1JfTU9WRSwgRkVUQ0hfU1RBVEVfQUNUSVZFLCBGRVRDSF9TVEFURV9TVE9QUElORyk7XHJcblx0XHRtb3ZhYmxlRmV0Y2guX21vdmFibGVGZXRjaENvbnRleHQuZG9uZSgpO1xyXG5cdH1cclxuXHRtb3ZhYmxlRmV0Y2guX3NpbmdsZUZldGNoU3RvcHBlZChmZXRjaCk7XHJcbn0iLCIndXNlIHN0cmljdCc7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IEltYWdlRGVjb2RlclZpZXdlcjtcclxuXHJcbnZhciBpbWFnZUhlbHBlckZ1bmN0aW9ucyA9IHJlcXVpcmUoJ2ltYWdlLWhlbHBlci1mdW5jdGlvbnMuanMnKTtcclxuXHJcbnZhciBQRU5ESU5HX0NBTExfVFlQRV9QSVhFTFNfVVBEQVRFRCA9IDE7XHJcbnZhciBQRU5ESU5HX0NBTExfVFlQRV9SRVBPU0lUSU9OID0gMjtcclxuXHJcbnZhciBSRUdJT05fT1ZFUlZJRVcgPSAwO1xyXG52YXIgUkVHSU9OX0RZTkFNSUMgPSAxO1xyXG5cclxuZnVuY3Rpb24gSW1hZ2VEZWNvZGVyVmlld2VyKGltYWdlRGVjb2RlciwgY2FudmFzVXBkYXRlZENhbGxiYWNrLCBvcHRpb25zKSB7XHJcbiAgICB0aGlzLl9jYW52YXNVcGRhdGVkQ2FsbGJhY2sgPSBjYW52YXNVcGRhdGVkQ2FsbGJhY2s7XHJcbiAgICBcclxuICAgIHRoaXMuX2FkYXB0UHJvcG9ydGlvbnMgPSBvcHRpb25zLmFkYXB0UHJvcG9ydGlvbnM7XHJcbiAgICB0aGlzLl9jYXJ0b2dyYXBoaWNCb3VuZHMgPSBvcHRpb25zLmNhcnRvZ3JhcGhpY0JvdW5kcztcclxuICAgIHRoaXMuX2FsbG93TXVsdGlwbGVNb3ZhYmxlRmV0Y2hlc0luU2Vzc2lvbiA9XHJcbiAgICAgICAgb3B0aW9ucy5hbGxvd011bHRpcGxlTW92YWJsZUZldGNoZXNJblNlc3Npb247XHJcbiAgICB0aGlzLl9taW5GdW5jdGlvbkNhbGxJbnRlcnZhbE1pbGxpc2Vjb25kcyA9XHJcbiAgICAgICAgb3B0aW9ucy5taW5GdW5jdGlvbkNhbGxJbnRlcnZhbE1pbGxpc2Vjb25kcztcclxuICAgIHRoaXMuX292ZXJ2aWV3UmVzb2x1dGlvblggPSBvcHRpb25zLm92ZXJ2aWV3UmVzb2x1dGlvblggfHwgMTAwO1xyXG4gICAgdGhpcy5fb3ZlcnZpZXdSZXNvbHV0aW9uWSA9IG9wdGlvbnMub3ZlcnZpZXdSZXNvbHV0aW9uWSB8fCAxMDA7XHJcbiAgICAgICAgXHJcbiAgICB0aGlzLl9sYXN0UmVxdWVzdEluZGV4ID0gMDtcclxuICAgIHRoaXMuX3BlbmRpbmdVcGRhdGVWaWV3QXJlYSA9IG51bGw7XHJcbiAgICB0aGlzLl9yZWdpb25zID0gW107XHJcbiAgICB0aGlzLl90YXJnZXRDYW52YXMgPSBudWxsO1xyXG4gICAgXHJcbiAgICB0aGlzLl9jYWxsUGVuZGluZ0NhbGxiYWNrc0JvdW5kID0gdGhpcy5fY2FsbFBlbmRpbmdDYWxsYmFja3MuYmluZCh0aGlzKTtcclxuICAgIHRoaXMuX2NyZWF0ZWRNb3ZhYmxlRmV0Y2hCb3VuZCA9IHRoaXMuX2NyZWF0ZWRNb3ZhYmxlRmV0Y2guYmluZCh0aGlzKTtcclxuICAgIFxyXG4gICAgdGhpcy5fcGVuZGluZ0NhbGxiYWNrc0ludGVydmFsSGFuZGxlID0gMDtcclxuICAgIHRoaXMuX3BlbmRpbmdDYWxsYmFja0NhbGxzID0gW107XHJcbiAgICB0aGlzLl9jYW5TaG93RHluYW1pY1JlZ2lvbiA9IGZhbHNlO1xyXG4gICAgXHJcbiAgICBpZiAodGhpcy5fY2FydG9ncmFwaGljQm91bmRzID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICB0aGlzLl9jYXJ0b2dyYXBoaWNCb3VuZHMgPSB7XHJcbiAgICAgICAgICAgIHdlc3Q6IC0xNzUuMCxcclxuICAgICAgICAgICAgZWFzdDogMTc1LjAsXHJcbiAgICAgICAgICAgIHNvdXRoOiAtODUuMCxcclxuICAgICAgICAgICAgbm9ydGg6IDg1LjBcclxuICAgICAgICB9O1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBpZiAodGhpcy5fYWRhcHRQcm9wb3J0aW9ucyA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgdGhpcy5fYWRhcHRQcm9wb3J0aW9ucyA9IHRydWU7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHRoaXMuX2ltYWdlRGVjb2RlciA9IGltYWdlRGVjb2RlcjtcclxuXHRpbWFnZURlY29kZXIuc2V0RGVjb2RlUHJpb3JpdGl6ZXJUeXBlKCdmcnVzdHVtT25seScpO1xyXG5cdGltYWdlRGVjb2Rlci5zZXRGZXRjaFByaW9yaXRpemVyVHlwZSgnZnJ1c3R1bU9ubHknKTtcclxufVxyXG5cclxuSW1hZ2VEZWNvZGVyVmlld2VyLnByb3RvdHlwZS5zZXRFeGNlcHRpb25DYWxsYmFjayA9IGZ1bmN0aW9uIHNldEV4Y2VwdGlvbkNhbGxiYWNrKGV4Y2VwdGlvbkNhbGxiYWNrKSB7XHJcbiAgICAvLyBUT0RPOiBTdXBwb3J0IGV4Y2VwdGlvbkNhbGxiYWNrIGluIGV2ZXJ5IHBsYWNlIG5lZWRlZFxyXG5cdHRoaXMuX2V4Y2VwdGlvbkNhbGxiYWNrID0gZXhjZXB0aW9uQ2FsbGJhY2s7XHJcbn07XHJcbiAgICBcclxuSW1hZ2VEZWNvZGVyVmlld2VyLnByb3RvdHlwZS5vcGVuID0gZnVuY3Rpb24gb3Blbih1cmwpIHtcclxuICAgIHJldHVybiB0aGlzLl9pbWFnZURlY29kZXIub3Blbih1cmwpXHJcbiAgICAgICAgLnRoZW4odGhpcy5fb3BlbmVkLmJpbmQodGhpcykpXHJcbiAgICAgICAgLmNhdGNoKHRoaXMuX2V4Y2VwdGlvbkNhbGxiYWNrKTtcclxufTtcclxuXHJcbkltYWdlRGVjb2RlclZpZXdlci5wcm90b3R5cGUuY2xvc2UgPSBmdW5jdGlvbiBjbG9zZSgpIHtcclxuICAgIHZhciBwcm9taXNlID0gdGhpcy5faW1hZ2VEZWNvZGVyLmNsb3NlKCk7XHJcbiAgICBwcm9taXNlLmNhdGNoKHRoaXMuX2V4Y2VwdGlvbkNhbGxiYWNrKTtcclxuICAgIHRoaXMuX2lzUmVhZHkgPSBmYWxzZTtcclxuICAgIHRoaXMuX2NhblNob3dEeW5hbWljUmVnaW9uID0gZmFsc2U7XHJcbiAgICB0aGlzLl90YXJnZXRDYW52YXMgPSBudWxsO1xyXG5cdHJldHVybiBwcm9taXNlO1xyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVyVmlld2VyLnByb3RvdHlwZS5zZXRUYXJnZXRDYW52YXMgPSBmdW5jdGlvbiBzZXRUYXJnZXRDYW52YXMoY2FudmFzKSB7XHJcbiAgICB0aGlzLl90YXJnZXRDYW52YXMgPSBjYW52YXM7XHJcbn07XHJcblxyXG5JbWFnZURlY29kZXJWaWV3ZXIucHJvdG90eXBlLnVwZGF0ZVZpZXdBcmVhID0gZnVuY3Rpb24gdXBkYXRlVmlld0FyZWEoZnJ1c3R1bURhdGEpIHtcclxuICAgIGlmICh0aGlzLl90YXJnZXRDYW52YXMgPT09IG51bGwpIHtcclxuICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBDYW5ub3QgdXBkYXRlIGR5bmFtaWMgcmVnaW9uIGJlZm9yZSBzZXRUYXJnZXRDYW52YXMoKSc7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGlmICghdGhpcy5fY2FuU2hvd0R5bmFtaWNSZWdpb24pIHtcclxuICAgICAgICB0aGlzLl9wZW5kaW5nVXBkYXRlVmlld0FyZWEgPSBmcnVzdHVtRGF0YTtcclxuICAgICAgICBcclxuICAgICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHZhciBib3VuZHMgPSBmcnVzdHVtRGF0YS5yZWN0YW5nbGU7XHJcbiAgICB2YXIgc2NyZWVuU2l6ZSA9IGZydXN0dW1EYXRhLnNjcmVlblNpemU7XHJcbiAgICBcclxuICAgIHZhciByZWdpb25QYXJhbXMgPSB7XHJcbiAgICAgICAgbWluWDogYm91bmRzLndlc3QgKiB0aGlzLl9zY2FsZVggKyB0aGlzLl90cmFuc2xhdGVYLFxyXG4gICAgICAgIG1pblk6IGJvdW5kcy5ub3J0aCAqIHRoaXMuX3NjYWxlWSArIHRoaXMuX3RyYW5zbGF0ZVksXHJcbiAgICAgICAgbWF4WEV4Y2x1c2l2ZTogYm91bmRzLmVhc3QgKiB0aGlzLl9zY2FsZVggKyB0aGlzLl90cmFuc2xhdGVYLFxyXG4gICAgICAgIG1heFlFeGNsdXNpdmU6IGJvdW5kcy5zb3V0aCAqIHRoaXMuX3NjYWxlWSArIHRoaXMuX3RyYW5zbGF0ZVksXHJcbiAgICAgICAgc2NyZWVuV2lkdGg6IHNjcmVlblNpemUueCxcclxuICAgICAgICBzY3JlZW5IZWlnaHQ6IHNjcmVlblNpemUueVxyXG4gICAgfTtcclxuICAgIFxyXG4gICAgdmFyIGFsaWduZWRQYXJhbXMgPVxyXG4gICAgICAgIGltYWdlSGVscGVyRnVuY3Rpb25zLmFsaWduUGFyYW1zVG9UaWxlc0FuZExldmVsKFxyXG4gICAgICAgICAgICByZWdpb25QYXJhbXMsIHRoaXMuX2ltYWdlRGVjb2Rlcik7XHJcbiAgICBcclxuICAgIHZhciBpc091dHNpZGVTY3JlZW4gPSBhbGlnbmVkUGFyYW1zID09PSBudWxsO1xyXG4gICAgaWYgKGlzT3V0c2lkZVNjcmVlbikge1xyXG4gICAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIFxyXG4gICAgYWxpZ25lZFBhcmFtcy5pbWFnZVBhcnRQYXJhbXMucXVhbGl0eSA9IHRoaXMuX3F1YWxpdHk7XHJcblxyXG4gICAgdmFyIGlzU2FtZVJlZ2lvbiA9XHJcbiAgICAgICAgdGhpcy5fZHluYW1pY0ZldGNoUGFyYW1zICE9PSB1bmRlZmluZWQgJiZcclxuICAgICAgICB0aGlzLl9pc0ltYWdlUGFydHNFcXVhbChcclxuICAgICAgICAgICAgYWxpZ25lZFBhcmFtcy5pbWFnZVBhcnRQYXJhbXMsXHJcbiAgICAgICAgICAgIHRoaXMuX2R5bmFtaWNGZXRjaFBhcmFtcy5pbWFnZVBhcnRQYXJhbXMpO1xyXG4gICAgXHJcbiAgICBpZiAoaXNTYW1lUmVnaW9uKSB7XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBmcnVzdHVtRGF0YS5pbWFnZVJlY3RhbmdsZSA9IHRoaXMuX2NhcnRvZ3JhcGhpY0JvdW5kc0ZpeGVkO1xyXG4gICAgZnJ1c3R1bURhdGEuZXhhY3RsZXZlbCA9XHJcbiAgICAgICAgYWxpZ25lZFBhcmFtcy5pbWFnZVBhcnRQYXJhbXMubGV2ZWw7XHJcbiAgICBcclxuICAgIHRoaXMuX2ltYWdlRGVjb2Rlci5zZXREZWNvZGVQcmlvcml0aXplckRhdGEoZnJ1c3R1bURhdGEpO1xyXG4gICAgdGhpcy5faW1hZ2VEZWNvZGVyLnNldEZldGNoUHJpb3JpdGl6ZXJEYXRhKGZydXN0dW1EYXRhKTtcclxuXHJcbiAgICB0aGlzLl9keW5hbWljRmV0Y2hQYXJhbXMgPSBhbGlnbmVkUGFyYW1zO1xyXG4gICAgXHJcbiAgICB2YXIgc3RhcnREeW5hbWljUmVnaW9uT25UZXJtaW5hdGlvbiA9IGZhbHNlO1xyXG4gICAgdmFyIG1vdmVFeGlzdGluZ0ZldGNoID0gIXRoaXMuX2FsbG93TXVsdGlwbGVNb3ZhYmxlRmV0Y2hlc0luU2Vzc2lvbjtcclxuICAgIHRoaXMuX2ZldGNoKFxyXG4gICAgICAgIFJFR0lPTl9EWU5BTUlDLFxyXG4gICAgICAgIGFsaWduZWRQYXJhbXMsXHJcbiAgICAgICAgc3RhcnREeW5hbWljUmVnaW9uT25UZXJtaW5hdGlvbixcclxuICAgICAgICBtb3ZlRXhpc3RpbmdGZXRjaCk7XHJcbn07XHJcblxyXG5JbWFnZURlY29kZXJWaWV3ZXIucHJvdG90eXBlLmdldEJvdW5kcyA9IGZ1bmN0aW9uIGdldENhcnRvZ3JhcGhpY0JvdW5kcygpIHtcclxuICAgIGlmICghdGhpcy5faXNSZWFkeSkge1xyXG4gICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IEltYWdlRGVjb2RlclZpZXdlciBlcnJvcjogSW1hZ2UgaXMgbm90IHJlYWR5IHlldCc7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gdGhpcy5fY2FydG9ncmFwaGljQm91bmRzRml4ZWQ7XHJcbn07XHJcblxyXG5JbWFnZURlY29kZXJWaWV3ZXIucHJvdG90eXBlLl9pc0ltYWdlUGFydHNFcXVhbCA9IGZ1bmN0aW9uIGlzSW1hZ2VQYXJ0c0VxdWFsKGZpcnN0LCBzZWNvbmQpIHtcclxuICAgIHZhciBpc0VxdWFsID1cclxuICAgICAgICB0aGlzLl9keW5hbWljRmV0Y2hQYXJhbXMgIT09IHVuZGVmaW5lZCAmJlxyXG4gICAgICAgIGZpcnN0Lm1pblggPT09IHNlY29uZC5taW5YICYmXHJcbiAgICAgICAgZmlyc3QubWluWSA9PT0gc2Vjb25kLm1pblkgJiZcclxuICAgICAgICBmaXJzdC5tYXhYRXhjbHVzaXZlID09PSBzZWNvbmQubWF4WEV4Y2x1c2l2ZSAmJlxyXG4gICAgICAgIGZpcnN0Lm1heFlFeGNsdXNpdmUgPT09IHNlY29uZC5tYXhZRXhjbHVzaXZlICYmXHJcbiAgICAgICAgZmlyc3QubGV2ZWwgPT09IHNlY29uZC5sZXZlbDtcclxuICAgIFxyXG4gICAgcmV0dXJuIGlzRXF1YWw7XHJcbn07XHJcblxyXG5JbWFnZURlY29kZXJWaWV3ZXIucHJvdG90eXBlLl9mZXRjaCA9IGZ1bmN0aW9uIGZldGNoKFxyXG4gICAgcmVnaW9uSWQsXHJcbiAgICBmZXRjaFBhcmFtcyxcclxuICAgIHN0YXJ0RHluYW1pY1JlZ2lvbk9uVGVybWluYXRpb24sXHJcbiAgICBtb3ZlRXhpc3RpbmdGZXRjaCkge1xyXG4gICAgXHJcbiAgICB2YXIgcmVxdWVzdEluZGV4ID0gKyt0aGlzLl9sYXN0UmVxdWVzdEluZGV4O1xyXG4gICAgXHJcbiAgICB2YXIgaW1hZ2VQYXJ0UGFyYW1zID0gZmV0Y2hQYXJhbXMuaW1hZ2VQYXJ0UGFyYW1zO1xyXG4gICAgaW1hZ2VQYXJ0UGFyYW1zLnJlcXVlc3RQcmlvcml0eURhdGEgPVxyXG4gICAgICAgIGltYWdlUGFydFBhcmFtcy5yZXF1ZXN0UHJpb3JpdHlEYXRhIHx8IHt9O1xyXG4gICAgXHJcbiAgICBpbWFnZVBhcnRQYXJhbXMucmVxdWVzdFByaW9yaXR5RGF0YS5yZXF1ZXN0SW5kZXggPSByZXF1ZXN0SW5kZXg7XHJcblxyXG4gICAgdmFyIG1pblggPSBmZXRjaFBhcmFtcy5wb3NpdGlvbkluSW1hZ2UubWluWDtcclxuICAgIHZhciBtaW5ZID0gZmV0Y2hQYXJhbXMucG9zaXRpb25JbkltYWdlLm1pblk7XHJcbiAgICB2YXIgbWF4WCA9IGZldGNoUGFyYW1zLnBvc2l0aW9uSW5JbWFnZS5tYXhYRXhjbHVzaXZlO1xyXG4gICAgdmFyIG1heFkgPSBmZXRjaFBhcmFtcy5wb3NpdGlvbkluSW1hZ2UubWF4WUV4Y2x1c2l2ZTtcclxuICAgIFxyXG4gICAgdmFyIHdlc3QgPSAobWluWCAtIHRoaXMuX3RyYW5zbGF0ZVgpIC8gdGhpcy5fc2NhbGVYO1xyXG4gICAgdmFyIGVhc3QgPSAobWF4WCAtIHRoaXMuX3RyYW5zbGF0ZVgpIC8gdGhpcy5fc2NhbGVYO1xyXG4gICAgdmFyIG5vcnRoID0gKG1pblkgLSB0aGlzLl90cmFuc2xhdGVZKSAvIHRoaXMuX3NjYWxlWTtcclxuICAgIHZhciBzb3V0aCA9IChtYXhZIC0gdGhpcy5fdHJhbnNsYXRlWSkgLyB0aGlzLl9zY2FsZVk7XHJcbiAgICBcclxuICAgIHZhciBwb3NpdGlvbiA9IHtcclxuICAgICAgICB3ZXN0OiB3ZXN0LFxyXG4gICAgICAgIGVhc3Q6IGVhc3QsXHJcbiAgICAgICAgbm9ydGg6IG5vcnRoLFxyXG4gICAgICAgIHNvdXRoOiBzb3V0aFxyXG4gICAgfTtcclxuICAgIFxyXG4gICAgdmFyIGNhblJldXNlT2xkRGF0YSA9IGZhbHNlO1xyXG4gICAgdmFyIGZldGNoUGFyYW1zTm90TmVlZGVkO1xyXG4gICAgXHJcbiAgICB2YXIgcmVnaW9uID0gdGhpcy5fcmVnaW9uc1tyZWdpb25JZF07XHJcbiAgICBpZiAocmVnaW9uICE9PSB1bmRlZmluZWQpIHtcclxuICAgICAgICB2YXIgbmV3UmVzb2x1dGlvbiA9IGltYWdlUGFydFBhcmFtcy5sZXZlbDtcclxuICAgICAgICB2YXIgb2xkUmVzb2x1dGlvbiA9IHJlZ2lvbi5pbWFnZVBhcnRQYXJhbXMubGV2ZWw7XHJcbiAgICAgICAgXHJcbiAgICAgICAgY2FuUmV1c2VPbGREYXRhID0gbmV3UmVzb2x1dGlvbiA9PT0gb2xkUmVzb2x1dGlvbjtcclxuICAgICAgICBcclxuICAgICAgICBpZiAoY2FuUmV1c2VPbGREYXRhICYmIHJlZ2lvbi5kb25lUGFydFBhcmFtcykge1xyXG4gICAgICAgICAgICBmZXRjaFBhcmFtc05vdE5lZWRlZCA9IFsgcmVnaW9uLmRvbmVQYXJ0UGFyYW1zIF07XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBpZiAocmVnaW9uSWQgIT09IFJFR0lPTl9PVkVSVklFVykge1xyXG4gICAgICAgICAgICB2YXIgYWRkZWRQZW5kaW5nQ2FsbCA9IHRoaXMuX2NoZWNrSWZSZXBvc2l0aW9uTmVlZGVkKFxyXG4gICAgICAgICAgICAgICAgcmVnaW9uLCBpbWFnZVBhcnRQYXJhbXMsIHBvc2l0aW9uKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGlmIChhZGRlZFBlbmRpbmdDYWxsKSB7XHJcbiAgICAgICAgICAgICAgICB0aGlzLl9ub3RpZnlOZXdQZW5kaW5nQ2FsbHMoKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgIH1cclxuICAgIFxyXG4gICAgdmFyIHNlbGYgPSB0aGlzO1xyXG4gICAgXHJcbiAgICB2YXIgbW92YWJsZUhhbmRsZSA9IG1vdmVFeGlzdGluZ0ZldGNoID8gdGhpcy5fbW92YWJsZUhhbmRsZTogdW5kZWZpbmVkO1xyXG5cclxuICAgIHRoaXMuX2ltYWdlRGVjb2Rlci5yZXF1ZXN0UGl4ZWxzUHJvZ3Jlc3NpdmUoXHJcbiAgICAgICAgZmV0Y2hQYXJhbXMuaW1hZ2VQYXJ0UGFyYW1zLFxyXG4gICAgICAgIGNhbGxiYWNrLFxyXG4gICAgICAgIHRlcm1pbmF0ZWRDYWxsYmFjayxcclxuICAgICAgICBmZXRjaFBhcmFtc05vdE5lZWRlZCxcclxuICAgICAgICBtb3ZhYmxlSGFuZGxlKTtcclxuICAgIFxyXG4gICAgZnVuY3Rpb24gY2FsbGJhY2soZGVjb2RlZCkge1xyXG4gICAgICAgIHNlbGYuX3RpbGVzRGVjb2RlZENhbGxiYWNrKFxyXG4gICAgICAgICAgICByZWdpb25JZCxcclxuICAgICAgICAgICAgZmV0Y2hQYXJhbXMsXHJcbiAgICAgICAgICAgIHBvc2l0aW9uLFxyXG4gICAgICAgICAgICBkZWNvZGVkKTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgZnVuY3Rpb24gdGVybWluYXRlZENhbGxiYWNrKGlzQWJvcnRlZCkge1xyXG4gICAgICAgIGlmIChpc0Fib3J0ZWQgJiZcclxuICAgICAgICAgICAgaW1hZ2VQYXJ0UGFyYW1zLnJlcXVlc3RQcmlvcml0eURhdGEub3ZlcnJpZGVIaWdoZXN0UHJpb3JpdHkpIHtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIE5PVEU6IEJ1ZyBpbiBrZHVfc2VydmVyIGNhdXNlcyBmaXJzdCByZXF1ZXN0IHRvIGJlIHNlbnQgd3JvbmdseS5cclxuICAgICAgICAgICAgLy8gVGhlbiBDaHJvbWUgcmFpc2VzIEVSUl9JTlZBTElEX0NIVU5LRURfRU5DT0RJTkcgYW5kIHRoZSByZXF1ZXN0XHJcbiAgICAgICAgICAgIC8vIG5ldmVyIHJldHVybnMuIFRodXMgcGVyZm9ybSBzZWNvbmQgcmVxdWVzdC5cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHNlbGYuX2ltYWdlRGVjb2Rlci5yZXF1ZXN0UGl4ZWxzUHJvZ3Jlc3NpdmUoXHJcbiAgICAgICAgICAgICAgICBmZXRjaFBhcmFtcy5pbWFnZVBhcnRQYXJhbXMsXHJcbiAgICAgICAgICAgICAgICBjYWxsYmFjayxcclxuICAgICAgICAgICAgICAgIHRlcm1pbmF0ZWRDYWxsYmFjayxcclxuICAgICAgICAgICAgICAgIGZldGNoUGFyYW1zTm90TmVlZGVkKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgc2VsZi5fZmV0Y2hUZXJtaW5hdGVkQ2FsbGJhY2soXHJcbiAgICAgICAgICAgIHJlZ2lvbklkLFxyXG4gICAgICAgICAgICBmZXRjaFBhcmFtcy5pbWFnZVBhcnRQYXJhbXMucmVxdWVzdFByaW9yaXR5RGF0YSxcclxuICAgICAgICAgICAgaXNBYm9ydGVkLFxyXG4gICAgICAgICAgICBzdGFydER5bmFtaWNSZWdpb25PblRlcm1pbmF0aW9uKTtcclxuICAgIH1cclxufTtcclxuXHJcbkltYWdlRGVjb2RlclZpZXdlci5wcm90b3R5cGUuX2ZldGNoVGVybWluYXRlZENhbGxiYWNrID0gZnVuY3Rpb24gZmV0Y2hUZXJtaW5hdGVkQ2FsbGJhY2soXHJcbiAgICByZWdpb25JZCwgcHJpb3JpdHlEYXRhLCBpc0Fib3J0ZWQsIHN0YXJ0RHluYW1pY1JlZ2lvbk9uVGVybWluYXRpb24pIHtcclxuICAgIFxyXG4gICAgdmFyIHJlZ2lvbiA9IHRoaXMuX3JlZ2lvbnNbcmVnaW9uSWRdO1xyXG4gICAgaWYgKHJlZ2lvbiA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBpZiAoIXByaW9yaXR5RGF0YS5vdmVycmlkZUhpZ2hlc3RQcmlvcml0eSAmJlxyXG4gICAgICAgIHByaW9yaXR5RGF0YS5yZXF1ZXN0SW5kZXggIT09IHRoaXMuX2xhc3RSZXF1ZXN0SW5kZXgpIHtcclxuICAgIFxyXG4gICAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIFxyXG4gICAgcmVnaW9uLmlzRG9uZSA9ICFpc0Fib3J0ZWQgJiYgdGhpcy5faXNSZWFkeTtcclxuXHRpZiAocmVnaW9uLmlzRG9uZSkge1xyXG5cdFx0cmVnaW9uLmRvbmVQYXJ0UGFyYW1zID0gcmVnaW9uLmltYWdlUGFydFBhcmFtcztcclxuXHR9XHJcbiAgICBcclxuICAgIGlmIChzdGFydER5bmFtaWNSZWdpb25PblRlcm1pbmF0aW9uKSB7XHJcbiAgICAgICAgdGhpcy5faW1hZ2VEZWNvZGVyLmNyZWF0ZU1vdmFibGVGZXRjaCgpLnRoZW4odGhpcy5fY3JlYXRlZE1vdmFibGVGZXRjaEJvdW5kKTtcclxuICAgIH1cclxufTtcclxuXHJcbkltYWdlRGVjb2RlclZpZXdlci5wcm90b3R5cGUuX2NyZWF0ZWRNb3ZhYmxlRmV0Y2ggPSBmdW5jdGlvbiBjcmVhdGVkTW92YWJsZUZldGNoKG1vdmFibGVIYW5kbGUpIHtcclxuICAgIHRoaXMuX21vdmFibGVIYW5kbGUgPSBtb3ZhYmxlSGFuZGxlO1xyXG4gICAgdGhpcy5fc3RhcnRTaG93aW5nRHluYW1pY1JlZ2lvbigpO1xyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVyVmlld2VyLnByb3RvdHlwZS5fc3RhcnRTaG93aW5nRHluYW1pY1JlZ2lvbiA9IGZ1bmN0aW9uIHN0YXJ0U2hvd2luZ0R5bmFtaWNSZWdpb24oKSB7XHJcbiAgICB0aGlzLl9jYW5TaG93RHluYW1pY1JlZ2lvbiA9IHRydWU7XHJcbiAgICBcclxuICAgIGlmICh0aGlzLl9wZW5kaW5nVXBkYXRlVmlld0FyZWEgIT09IG51bGwpIHtcclxuICAgICAgICB0aGlzLnVwZGF0ZVZpZXdBcmVhKHRoaXMuX3BlbmRpbmdVcGRhdGVWaWV3QXJlYSk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgdGhpcy5fcGVuZGluZ1VwZGF0ZVZpZXdBcmVhID0gbnVsbDtcclxuICAgIH1cclxufTtcclxuXHJcbkltYWdlRGVjb2RlclZpZXdlci5wcm90b3R5cGUuX3RpbGVzRGVjb2RlZENhbGxiYWNrID0gZnVuY3Rpb24gdGlsZXNEZWNvZGVkQ2FsbGJhY2soXHJcbiAgICByZWdpb25JZCwgZmV0Y2hQYXJhbXMsIHBvc2l0aW9uLCBkZWNvZGVkKSB7XHJcbiAgICBcclxuICAgIGlmICghdGhpcy5faXNSZWFkeSkge1xyXG4gICAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIFxyXG4gICAgdmFyIHJlZ2lvbiA9IHRoaXMuX3JlZ2lvbnNbcmVnaW9uSWRdO1xyXG4gICAgaWYgKHJlZ2lvbiA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgcmVnaW9uID0ge307XHJcbiAgICAgICAgdGhpcy5fcmVnaW9uc1tyZWdpb25JZF0gPSByZWdpb247XHJcbiAgICAgICAgXHJcbiAgICAgICAgc3dpdGNoIChyZWdpb25JZCkge1xyXG4gICAgICAgICAgICBjYXNlIFJFR0lPTl9EWU5BTUlDOlxyXG4gICAgICAgICAgICAgICAgcmVnaW9uLmNhbnZhcyA9IHRoaXMuX3RhcmdldENhbnZhcztcclxuICAgICAgICAgICAgICAgIGJyZWFrO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGNhc2UgUkVHSU9OX09WRVJWSUVXOlxyXG4gICAgICAgICAgICAgICAgcmVnaW9uLmNhbnZhcyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2NhbnZhcycpO1xyXG4gICAgICAgICAgICAgICAgYnJlYWs7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBkZWZhdWx0OlxyXG4gICAgICAgICAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogVW5leHBlY3RlZCByZWdpb25JZCAnICsgcmVnaW9uSWQ7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgXHJcbiAgICB2YXIgcGFydFBhcmFtcyA9IGZldGNoUGFyYW1zLmltYWdlUGFydFBhcmFtcztcclxuICAgIGlmICghcGFydFBhcmFtcy5yZXF1ZXN0UHJpb3JpdHlEYXRhLm92ZXJyaWRlSGlnaGVzdFByaW9yaXR5ICYmXHJcbiAgICAgICAgcGFydFBhcmFtcy5yZXF1ZXN0UHJpb3JpdHlEYXRhLnJlcXVlc3RJbmRleCA8IHJlZ2lvbi5jdXJyZW50RGlzcGxheVJlcXVlc3RJbmRleCkge1xyXG4gICAgICAgIFxyXG4gICAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIFxyXG4gICAgdGhpcy5fY2hlY2tJZlJlcG9zaXRpb25OZWVkZWQocmVnaW9uLCBwYXJ0UGFyYW1zLCBwb3NpdGlvbik7XHJcbiAgICAgICAgXHJcbiAgICB0aGlzLl9wZW5kaW5nQ2FsbGJhY2tDYWxscy5wdXNoKHtcclxuICAgICAgICB0eXBlOiBQRU5ESU5HX0NBTExfVFlQRV9QSVhFTFNfVVBEQVRFRCxcclxuICAgICAgICByZWdpb246IHJlZ2lvbixcclxuICAgICAgICBkZWNvZGVkOiBkZWNvZGVkXHJcbiAgICB9KTtcclxuICAgIFxyXG4gICAgdGhpcy5fbm90aWZ5TmV3UGVuZGluZ0NhbGxzKCk7XHJcbn07XHJcblxyXG5JbWFnZURlY29kZXJWaWV3ZXIucHJvdG90eXBlLl9jaGVja0lmUmVwb3NpdGlvbk5lZWRlZCA9IGZ1bmN0aW9uIGNoZWNrSWZSZXBvc2l0aW9uTmVlZGVkKFxyXG4gICAgcmVnaW9uLCBuZXdQYXJ0UGFyYW1zLCBuZXdQb3NpdGlvbikge1xyXG4gICAgXHJcbiAgICB2YXIgb2xkUGFydFBhcmFtcyA9IHJlZ2lvbi5pbWFnZVBhcnRQYXJhbXM7XHJcblx0dmFyIG9sZERvbmVQYXJ0UGFyYW1zID0gcmVnaW9uLmRvbmVQYXJ0UGFyYW1zO1xyXG4gICAgdmFyIGxldmVsID0gbmV3UGFydFBhcmFtcy5sZXZlbDtcclxuICAgIFxyXG4gICAgdmFyIG5lZWRSZXBvc2l0aW9uID1cclxuICAgICAgICBvbGRQYXJ0UGFyYW1zID09PSB1bmRlZmluZWQgfHxcclxuICAgICAgICBvbGRQYXJ0UGFyYW1zLm1pblggIT09IG5ld1BhcnRQYXJhbXMubWluWCB8fFxyXG4gICAgICAgIG9sZFBhcnRQYXJhbXMubWluWSAhPT0gbmV3UGFydFBhcmFtcy5taW5ZIHx8XHJcbiAgICAgICAgb2xkUGFydFBhcmFtcy5tYXhYRXhjbHVzaXZlICE9PSBuZXdQYXJ0UGFyYW1zLm1heFhFeGNsdXNpdmUgfHxcclxuICAgICAgICBvbGRQYXJ0UGFyYW1zLm1heFlFeGNsdXNpdmUgIT09IG5ld1BhcnRQYXJhbXMubWF4WUV4Y2x1c2l2ZSB8fFxyXG4gICAgICAgIG9sZFBhcnRQYXJhbXMubGV2ZWwgIT09IGxldmVsO1xyXG4gICAgXHJcbiAgICBpZiAoIW5lZWRSZXBvc2l0aW9uKSB7XHJcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICB2YXIgY29weURhdGE7XHJcbiAgICB2YXIgaW50ZXJzZWN0aW9uO1xyXG5cdHZhciBuZXdEb25lUGFydFBhcmFtcztcclxuICAgIHZhciByZXVzZU9sZERhdGEgPSBmYWxzZTtcclxuICAgIHZhciBzY2FsZVg7XHJcbiAgICB2YXIgc2NhbGVZO1xyXG4gICAgaWYgKG9sZFBhcnRQYXJhbXMgIT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIHNjYWxlWCA9IG5ld1BhcnRQYXJhbXMubGV2ZWxXaWR0aCAgLyBvbGRQYXJ0UGFyYW1zLmxldmVsV2lkdGg7XHJcbiAgICAgICAgc2NhbGVZID0gbmV3UGFydFBhcmFtcy5sZXZlbEhlaWdodCAvIG9sZFBhcnRQYXJhbXMubGV2ZWxIZWlnaHQ7XHJcbiAgICAgICAgXHJcbiAgICAgICAgaW50ZXJzZWN0aW9uID0ge1xyXG4gICAgICAgICAgICBtaW5YOiBNYXRoLm1heChvbGRQYXJ0UGFyYW1zLm1pblggKiBzY2FsZVgsIG5ld1BhcnRQYXJhbXMubWluWCksXHJcbiAgICAgICAgICAgIG1pblk6IE1hdGgubWF4KG9sZFBhcnRQYXJhbXMubWluWSAqIHNjYWxlWSwgbmV3UGFydFBhcmFtcy5taW5ZKSxcclxuICAgICAgICAgICAgbWF4WDogTWF0aC5taW4ob2xkUGFydFBhcmFtcy5tYXhYRXhjbHVzaXZlICogc2NhbGVYLCBuZXdQYXJ0UGFyYW1zLm1heFhFeGNsdXNpdmUpLFxyXG4gICAgICAgICAgICBtYXhZOiBNYXRoLm1pbihvbGRQYXJ0UGFyYW1zLm1heFlFeGNsdXNpdmUgKiBzY2FsZVksIG5ld1BhcnRQYXJhbXMubWF4WUV4Y2x1c2l2ZSlcclxuICAgICAgICB9O1xyXG4gICAgICAgIHJldXNlT2xkRGF0YSA9XHJcbiAgICAgICAgICAgIGludGVyc2VjdGlvbi5tYXhYID4gaW50ZXJzZWN0aW9uLm1pblggJiZcclxuICAgICAgICAgICAgaW50ZXJzZWN0aW9uLm1heFkgPiBpbnRlcnNlY3Rpb24ubWluWTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgaWYgKHJldXNlT2xkRGF0YSkge1xyXG4gICAgICAgIGNvcHlEYXRhID0ge1xyXG4gICAgICAgICAgICBmcm9tWDogaW50ZXJzZWN0aW9uLm1pblggLyBzY2FsZVggLSBvbGRQYXJ0UGFyYW1zLm1pblgsXHJcbiAgICAgICAgICAgIGZyb21ZOiBpbnRlcnNlY3Rpb24ubWluWSAvIHNjYWxlWSAtIG9sZFBhcnRQYXJhbXMubWluWSxcclxuICAgICAgICAgICAgZnJvbVdpZHRoIDogKGludGVyc2VjdGlvbi5tYXhYIC0gaW50ZXJzZWN0aW9uLm1pblgpIC8gc2NhbGVYLFxyXG4gICAgICAgICAgICBmcm9tSGVpZ2h0OiAoaW50ZXJzZWN0aW9uLm1heFkgLSBpbnRlcnNlY3Rpb24ubWluWSkgLyBzY2FsZVksXHJcbiAgICAgICAgICAgIHRvWDogaW50ZXJzZWN0aW9uLm1pblggLSBuZXdQYXJ0UGFyYW1zLm1pblgsXHJcbiAgICAgICAgICAgIHRvWTogaW50ZXJzZWN0aW9uLm1pblkgLSBuZXdQYXJ0UGFyYW1zLm1pblksXHJcbiAgICAgICAgICAgIHRvV2lkdGggOiBpbnRlcnNlY3Rpb24ubWF4WCAtIGludGVyc2VjdGlvbi5taW5YLFxyXG4gICAgICAgICAgICB0b0hlaWdodDogaW50ZXJzZWN0aW9uLm1heFkgLSBpbnRlcnNlY3Rpb24ubWluWSxcclxuICAgICAgICB9O1xyXG5cdFxyXG5cdFx0aWYgKG9sZERvbmVQYXJ0UGFyYW1zICYmIG9sZFBhcnRQYXJhbXMubGV2ZWwgPT09IGxldmVsKSB7XHJcblx0XHRcdG5ld0RvbmVQYXJ0UGFyYW1zID0ge1xyXG5cdFx0XHRcdG1pblg6IE1hdGgubWF4KG9sZERvbmVQYXJ0UGFyYW1zLm1pblgsIG5ld1BhcnRQYXJhbXMubWluWCksXHJcblx0XHRcdFx0bWluWTogTWF0aC5tYXgob2xkRG9uZVBhcnRQYXJhbXMubWluWSwgbmV3UGFydFBhcmFtcy5taW5ZKSxcclxuXHRcdFx0XHRtYXhYRXhjbHVzaXZlOiBNYXRoLm1pbihvbGREb25lUGFydFBhcmFtcy5tYXhYRXhjbHVzaXZlLCBuZXdQYXJ0UGFyYW1zLm1heFhFeGNsdXNpdmUpLFxyXG5cdFx0XHRcdG1heFlFeGNsdXNpdmU6IE1hdGgubWluKG9sZERvbmVQYXJ0UGFyYW1zLm1heFlFeGNsdXNpdmUsIG5ld1BhcnRQYXJhbXMubWF4WUV4Y2x1c2l2ZSlcclxuXHRcdFx0fTtcclxuXHRcdH1cclxuXHR9XHJcbiAgICBcclxuICAgIHJlZ2lvbi5pbWFnZVBhcnRQYXJhbXMgPSBuZXdQYXJ0UGFyYW1zO1xyXG4gICAgcmVnaW9uLmlzRG9uZSA9IGZhbHNlO1xyXG4gICAgcmVnaW9uLmN1cnJlbnREaXNwbGF5UmVxdWVzdEluZGV4ID0gbmV3UGFydFBhcmFtcy5yZXF1ZXN0UHJpb3JpdHlEYXRhLnJlcXVlc3RJbmRleDtcclxuICAgIFxyXG4gICAgdmFyIHJlcG9zaXRpb25BcmdzID0ge1xyXG4gICAgICAgIHR5cGU6IFBFTkRJTkdfQ0FMTF9UWVBFX1JFUE9TSVRJT04sXHJcbiAgICAgICAgcmVnaW9uOiByZWdpb24sXHJcbiAgICAgICAgcG9zaXRpb246IG5ld1Bvc2l0aW9uLFxyXG5cdFx0ZG9uZVBhcnRQYXJhbXM6IG5ld0RvbmVQYXJ0UGFyYW1zLFxyXG4gICAgICAgIGNvcHlEYXRhOiBjb3B5RGF0YSxcclxuICAgICAgICBwaXhlbHNXaWR0aDogbmV3UGFydFBhcmFtcy5tYXhYRXhjbHVzaXZlIC0gbmV3UGFydFBhcmFtcy5taW5YLFxyXG4gICAgICAgIHBpeGVsc0hlaWdodDogbmV3UGFydFBhcmFtcy5tYXhZRXhjbHVzaXZlIC0gbmV3UGFydFBhcmFtcy5taW5ZXHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICB0aGlzLl9wZW5kaW5nQ2FsbGJhY2tDYWxscy5wdXNoKHJlcG9zaXRpb25BcmdzKTtcclxuICAgIFxyXG4gICAgcmV0dXJuIHRydWU7XHJcbn07XHJcblxyXG5JbWFnZURlY29kZXJWaWV3ZXIucHJvdG90eXBlLl9ub3RpZnlOZXdQZW5kaW5nQ2FsbHMgPSBmdW5jdGlvbiBub3RpZnlOZXdQZW5kaW5nQ2FsbHMoKSB7XHJcbiAgICBpZiAoIXRoaXMuX2lzTmVhckNhbGxiYWNrQ2FsbGVkKSB7XHJcbiAgICAgICAgdGhpcy5fY2FsbFBlbmRpbmdDYWxsYmFja3MoKTtcclxuICAgIH1cclxufTtcclxuXHJcbkltYWdlRGVjb2RlclZpZXdlci5wcm90b3R5cGUuX2NhbGxQZW5kaW5nQ2FsbGJhY2tzID0gZnVuY3Rpb24gY2FsbFBlbmRpbmdDYWxsYmFja3MoKSB7XHJcbiAgICBpZiAodGhpcy5fcGVuZGluZ0NhbGxiYWNrQ2FsbHMubGVuZ3RoID09PSAwIHx8ICF0aGlzLl9pc1JlYWR5KSB7XHJcbiAgICAgICAgdGhpcy5faXNOZWFyQ2FsbGJhY2tDYWxsZWQgPSBmYWxzZTtcclxuICAgICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGlmICh0aGlzLl9pc05lYXJDYWxsYmFja0NhbGxlZCkge1xyXG4gICAgICAgIGNsZWFyVGltZW91dCh0aGlzLl9wZW5kaW5nQ2FsbGJhY2tzSW50ZXJ2YWxIYW5kbGUpO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBpZiAodGhpcy5fbWluRnVuY3Rpb25DYWxsSW50ZXJ2YWxNaWxsaXNlY29uZHMgIT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIHRoaXMuX3BlbmRpbmdDYWxsYmFja3NJbnRlcnZhbEhhbmRsZSA9XHJcbiAgICAgICAgICAgIHNldFRpbWVvdXQodGhpcy5fY2FsbFBlbmRpbmdDYWxsYmFja3NCb3VuZCxcclxuICAgICAgICAgICAgdGhpcy5fbWluRnVuY3Rpb25DYWxsSW50ZXJ2YWxNaWxsaXNlY29uZHMpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICB0aGlzLl9pc05lYXJDYWxsYmFja0NhbGxlZCA9IHRydWU7XHJcbiAgICB9XHJcblxyXG4gICAgdmFyIG5ld1Bvc2l0aW9uID0gbnVsbDtcclxuICAgIFxyXG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCB0aGlzLl9wZW5kaW5nQ2FsbGJhY2tDYWxscy5sZW5ndGg7ICsraSkge1xyXG4gICAgICAgIHZhciBjYWxsQXJncyA9IHRoaXMuX3BlbmRpbmdDYWxsYmFja0NhbGxzW2ldO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGlmIChjYWxsQXJncy50eXBlID09PSBQRU5ESU5HX0NBTExfVFlQRV9SRVBPU0lUSU9OKSB7XHJcbiAgICAgICAgICAgIHRoaXMuX3JlcG9zaXRpb25DYW52YXMoY2FsbEFyZ3MpO1xyXG4gICAgICAgICAgICBuZXdQb3NpdGlvbiA9IGNhbGxBcmdzLnBvc2l0aW9uO1xyXG4gICAgICAgIH0gZWxzZSBpZiAoY2FsbEFyZ3MudHlwZSA9PT0gUEVORElOR19DQUxMX1RZUEVfUElYRUxTX1VQREFURUQpIHtcclxuICAgICAgICAgICAgdGhpcy5fcGl4ZWxzVXBkYXRlZChjYWxsQXJncyk7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogSW50ZXJuYWwgSW1hZ2VEZWNvZGVyVmlld2VyIEVycm9yOiBVbmV4cGVjdGVkIGNhbGwgdHlwZSAnICtcclxuICAgICAgICAgICAgICAgIGNhbGxBcmdzLnR5cGU7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgXHJcbiAgICB0aGlzLl9wZW5kaW5nQ2FsbGJhY2tDYWxscy5sZW5ndGggPSAwO1xyXG4gICAgXHJcbiAgICB0aGlzLl9jYW52YXNVcGRhdGVkQ2FsbGJhY2sobmV3UG9zaXRpb24pO1xyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVyVmlld2VyLnByb3RvdHlwZS5fcGl4ZWxzVXBkYXRlZCA9IGZ1bmN0aW9uIHBpeGVsc1VwZGF0ZWQocGl4ZWxzVXBkYXRlZEFyZ3MpIHtcclxuICAgIHZhciByZWdpb24gPSBwaXhlbHNVcGRhdGVkQXJncy5yZWdpb247XHJcbiAgICB2YXIgZGVjb2RlZCA9IHBpeGVsc1VwZGF0ZWRBcmdzLmRlY29kZWQ7XHJcbiAgICBpZiAoZGVjb2RlZC5pbWFnZURhdGEud2lkdGggPT09IDAgfHwgZGVjb2RlZC5pbWFnZURhdGEuaGVpZ2h0ID09PSAwKSB7XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICB2YXIgeCA9IGRlY29kZWQueEluT3JpZ2luYWxSZXF1ZXN0O1xyXG4gICAgdmFyIHkgPSBkZWNvZGVkLnlJbk9yaWdpbmFsUmVxdWVzdDtcclxuICAgIFxyXG4gICAgdmFyIGNvbnRleHQgPSByZWdpb24uY2FudmFzLmdldENvbnRleHQoJzJkJyk7XHJcbiAgICAvL3ZhciBpbWFnZURhdGEgPSBjb250ZXh0LmNyZWF0ZUltYWdlRGF0YShkZWNvZGVkLndpZHRoLCBkZWNvZGVkLmhlaWdodCk7XHJcbiAgICAvL2ltYWdlRGF0YS5kYXRhLnNldChkZWNvZGVkLnBpeGVscyk7XHJcbiAgICBcclxuICAgIGNvbnRleHQucHV0SW1hZ2VEYXRhKGRlY29kZWQuaW1hZ2VEYXRhLCB4LCB5KTtcclxufTtcclxuXHJcbkltYWdlRGVjb2RlclZpZXdlci5wcm90b3R5cGUuX3JlcG9zaXRpb25DYW52YXMgPSBmdW5jdGlvbiByZXBvc2l0aW9uQ2FudmFzKHJlcG9zaXRpb25BcmdzKSB7XHJcbiAgICB2YXIgcmVnaW9uID0gcmVwb3NpdGlvbkFyZ3MucmVnaW9uO1xyXG4gICAgdmFyIHBvc2l0aW9uID0gcmVwb3NpdGlvbkFyZ3MucG9zaXRpb247XHJcblx0dmFyIGRvbmVQYXJ0UGFyYW1zID0gcmVwb3NpdGlvbkFyZ3MuZG9uZVBhcnRQYXJhbXM7XHJcbiAgICB2YXIgY29weURhdGEgPSByZXBvc2l0aW9uQXJncy5jb3B5RGF0YTtcclxuICAgIHZhciBwaXhlbHNXaWR0aCA9IHJlcG9zaXRpb25BcmdzLnBpeGVsc1dpZHRoO1xyXG4gICAgdmFyIHBpeGVsc0hlaWdodCA9IHJlcG9zaXRpb25BcmdzLnBpeGVsc0hlaWdodDtcclxuICAgIFxyXG4gICAgdmFyIGltYWdlRGF0YVRvQ29weTtcclxuICAgIHZhciBjb250ZXh0ID0gcmVnaW9uLmNhbnZhcy5nZXRDb250ZXh0KCcyZCcpO1xyXG4gICAgXHJcbiAgICBpZiAoY29weURhdGEgIT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIGlmIChjb3B5RGF0YS5mcm9tV2lkdGggPT09IGNvcHlEYXRhLnRvV2lkdGggJiYgY29weURhdGEuZnJvbUhlaWdodCA9PT0gY29weURhdGEudG9IZWlnaHQpIHtcclxuICAgICAgICAgICAgaW1hZ2VEYXRhVG9Db3B5ID0gY29udGV4dC5nZXRJbWFnZURhdGEoXHJcbiAgICAgICAgICAgICAgICBjb3B5RGF0YS5mcm9tWCwgY29weURhdGEuZnJvbVksIGNvcHlEYXRhLmZyb21XaWR0aCwgY29weURhdGEuZnJvbUhlaWdodCk7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgaWYgKCF0aGlzLl90bXBDYW52YXMpIHtcclxuICAgICAgICAgICAgICAgIHRoaXMuX3RtcENhbnZhcyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2NhbnZhcycpO1xyXG4gICAgICAgICAgICAgICAgdGhpcy5fdG1wQ2FudmFzQ29udGV4dCA9IHRoaXMuX3RtcENhbnZhcy5nZXRDb250ZXh0KCcyZCcpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICB0aGlzLl90bXBDYW52YXMud2lkdGggID0gY29weURhdGEudG9XaWR0aDtcclxuICAgICAgICAgICAgdGhpcy5fdG1wQ2FudmFzLmhlaWdodCA9IGNvcHlEYXRhLnRvSGVpZ2h0O1xyXG4gICAgICAgICAgICB0aGlzLl90bXBDYW52YXNDb250ZXh0LmRyYXdJbWFnZShcclxuICAgICAgICAgICAgICAgIHJlZ2lvbi5jYW52YXMsXHJcbiAgICAgICAgICAgICAgICBjb3B5RGF0YS5mcm9tWCwgY29weURhdGEuZnJvbVksIGNvcHlEYXRhLmZyb21XaWR0aCwgY29weURhdGEuZnJvbUhlaWdodCxcclxuICAgICAgICAgICAgICAgIDAsIDAsIGNvcHlEYXRhLnRvV2lkdGgsIGNvcHlEYXRhLnRvSGVpZ2h0KTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGltYWdlRGF0YVRvQ29weSA9IHRoaXMuX3RtcENhbnZhc0NvbnRleHQuZ2V0SW1hZ2VEYXRhKFxyXG4gICAgICAgICAgICAgICAgMCwgMCwgY29weURhdGEudG9XaWR0aCwgY29weURhdGEudG9IZWlnaHQpO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuICAgIFxyXG4gICAgcmVnaW9uLmNhbnZhcy53aWR0aCA9IHBpeGVsc1dpZHRoO1xyXG4gICAgcmVnaW9uLmNhbnZhcy5oZWlnaHQgPSBwaXhlbHNIZWlnaHQ7XHJcbiAgICBcclxuICAgIGlmIChyZWdpb24gIT09IHRoaXMuX3JlZ2lvbnNbUkVHSU9OX09WRVJWSUVXXSkge1xyXG4gICAgICAgIHRoaXMuX2NvcHlPdmVydmlld1RvQ2FudmFzKFxyXG4gICAgICAgICAgICBjb250ZXh0LCBwb3NpdGlvbiwgcGl4ZWxzV2lkdGgsIHBpeGVsc0hlaWdodCk7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGlmIChjb3B5RGF0YSAhPT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgY29udGV4dC5wdXRJbWFnZURhdGEoaW1hZ2VEYXRhVG9Db3B5LCBjb3B5RGF0YS50b1gsIGNvcHlEYXRhLnRvWSk7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHJlZ2lvbi5wb3NpdGlvbiA9IHBvc2l0aW9uO1xyXG5cdHJlZ2lvbi5kb25lUGFydFBhcmFtcyA9IGRvbmVQYXJ0UGFyYW1zO1xyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVyVmlld2VyLnByb3RvdHlwZS5fY29weU92ZXJ2aWV3VG9DYW52YXMgPSBmdW5jdGlvbiBjb3B5T3ZlcnZpZXdUb0NhbnZhcyhcclxuICAgIGNvbnRleHQsIGNhbnZhc1Bvc2l0aW9uLCBjYW52YXNQaXhlbHNXaWR0aCwgY2FudmFzUGl4ZWxzSGVpZ2h0KSB7XHJcbiAgICBcclxuICAgIHZhciBzb3VyY2VQb3NpdGlvbiA9IHRoaXMuX3JlZ2lvbnNbUkVHSU9OX09WRVJWSUVXXS5wb3NpdGlvbjtcclxuICAgIHZhciBzb3VyY2VQaXhlbHMgPVxyXG4gICAgICAgIHRoaXMuX3JlZ2lvbnNbUkVHSU9OX09WRVJWSUVXXS5pbWFnZVBhcnRQYXJhbXM7XHJcbiAgICBcclxuICAgIHZhciBzb3VyY2VQaXhlbHNXaWR0aCA9XHJcbiAgICAgICAgc291cmNlUGl4ZWxzLm1heFhFeGNsdXNpdmUgLSBzb3VyY2VQaXhlbHMubWluWDtcclxuICAgIHZhciBzb3VyY2VQaXhlbHNIZWlnaHQgPVxyXG4gICAgICAgIHNvdXJjZVBpeGVscy5tYXhZRXhjbHVzaXZlIC0gc291cmNlUGl4ZWxzLm1pblk7XHJcbiAgICBcclxuICAgIHZhciBzb3VyY2VQb3NpdGlvbldpZHRoID1cclxuICAgICAgICBzb3VyY2VQb3NpdGlvbi5lYXN0IC0gc291cmNlUG9zaXRpb24ud2VzdDtcclxuICAgIHZhciBzb3VyY2VQb3NpdGlvbkhlaWdodCA9XHJcbiAgICAgICAgc291cmNlUG9zaXRpb24ubm9ydGggLSBzb3VyY2VQb3NpdGlvbi5zb3V0aDtcclxuICAgICAgICBcclxuICAgIHZhciBzb3VyY2VSZXNvbHV0aW9uWCA9XHJcbiAgICAgICAgc291cmNlUGl4ZWxzV2lkdGggLyBzb3VyY2VQb3NpdGlvbldpZHRoO1xyXG4gICAgdmFyIHNvdXJjZVJlc29sdXRpb25ZID1cclxuICAgICAgICBzb3VyY2VQaXhlbHNIZWlnaHQgLyBzb3VyY2VQb3NpdGlvbkhlaWdodDtcclxuICAgIFxyXG4gICAgdmFyIHRhcmdldFBvc2l0aW9uV2lkdGggPVxyXG4gICAgICAgIGNhbnZhc1Bvc2l0aW9uLmVhc3QgLSBjYW52YXNQb3NpdGlvbi53ZXN0O1xyXG4gICAgdmFyIHRhcmdldFBvc2l0aW9uSGVpZ2h0ID1cclxuICAgICAgICBjYW52YXNQb3NpdGlvbi5ub3J0aCAtIGNhbnZhc1Bvc2l0aW9uLnNvdXRoO1xyXG4gICAgICAgIFxyXG4gICAgdmFyIGNyb3BXaWR0aCA9IHRhcmdldFBvc2l0aW9uV2lkdGggKiBzb3VyY2VSZXNvbHV0aW9uWDtcclxuICAgIHZhciBjcm9wSGVpZ2h0ID0gdGFyZ2V0UG9zaXRpb25IZWlnaHQgKiBzb3VyY2VSZXNvbHV0aW9uWTtcclxuICAgIFxyXG4gICAgdmFyIGNyb3BPZmZzZXRQb3NpdGlvblggPVxyXG4gICAgICAgIGNhbnZhc1Bvc2l0aW9uLndlc3QgLSBzb3VyY2VQb3NpdGlvbi53ZXN0O1xyXG4gICAgdmFyIGNyb3BPZmZzZXRQb3NpdGlvblkgPVxyXG4gICAgICAgIHNvdXJjZVBvc2l0aW9uLm5vcnRoIC0gY2FudmFzUG9zaXRpb24ubm9ydGg7XHJcbiAgICAgICAgXHJcbiAgICB2YXIgY3JvcFBpeGVsT2Zmc2V0WCA9IGNyb3BPZmZzZXRQb3NpdGlvblggKiBzb3VyY2VSZXNvbHV0aW9uWDtcclxuICAgIHZhciBjcm9wUGl4ZWxPZmZzZXRZID0gY3JvcE9mZnNldFBvc2l0aW9uWSAqIHNvdXJjZVJlc29sdXRpb25ZO1xyXG4gICAgXHJcbiAgICBjb250ZXh0LmRyYXdJbWFnZShcclxuICAgICAgICB0aGlzLl9yZWdpb25zW1JFR0lPTl9PVkVSVklFV10uY2FudmFzLFxyXG4gICAgICAgIGNyb3BQaXhlbE9mZnNldFgsIGNyb3BQaXhlbE9mZnNldFksIGNyb3BXaWR0aCwgY3JvcEhlaWdodCxcclxuICAgICAgICAwLCAwLCBjYW52YXNQaXhlbHNXaWR0aCwgY2FudmFzUGl4ZWxzSGVpZ2h0KTtcclxufTtcclxuXHJcbkltYWdlRGVjb2RlclZpZXdlci5wcm90b3R5cGUuX29wZW5lZCA9IGZ1bmN0aW9uIG9wZW5lZCgpIHtcclxuICAgIHRoaXMuX2lzUmVhZHkgPSB0cnVlO1xyXG4gICAgXHJcbiAgICB2YXIgZml4ZWRCb3VuZHMgPSB7XHJcbiAgICAgICAgd2VzdDogdGhpcy5fY2FydG9ncmFwaGljQm91bmRzLndlc3QsXHJcbiAgICAgICAgZWFzdDogdGhpcy5fY2FydG9ncmFwaGljQm91bmRzLmVhc3QsXHJcbiAgICAgICAgc291dGg6IHRoaXMuX2NhcnRvZ3JhcGhpY0JvdW5kcy5zb3V0aCxcclxuICAgICAgICBub3J0aDogdGhpcy5fY2FydG9ncmFwaGljQm91bmRzLm5vcnRoXHJcbiAgICB9O1xyXG4gICAgaW1hZ2VIZWxwZXJGdW5jdGlvbnMuZml4Qm91bmRzKFxyXG4gICAgICAgIGZpeGVkQm91bmRzLCB0aGlzLl9pbWFnZURlY29kZXIsIHRoaXMuX2FkYXB0UHJvcG9ydGlvbnMpO1xyXG4gICAgdGhpcy5fY2FydG9ncmFwaGljQm91bmRzRml4ZWQgPSBmaXhlZEJvdW5kcztcclxuICAgIFxyXG4gICAgdmFyIGltYWdlV2lkdGggID0gdGhpcy5faW1hZ2VEZWNvZGVyLmdldEltYWdlV2lkdGggKCk7XHJcbiAgICB2YXIgaW1hZ2VIZWlnaHQgPSB0aGlzLl9pbWFnZURlY29kZXIuZ2V0SW1hZ2VIZWlnaHQoKTtcclxuICAgIHRoaXMuX3F1YWxpdHkgPSB0aGlzLl9pbWFnZURlY29kZXIuZ2V0SGlnaGVzdFF1YWxpdHkoKTtcclxuXHJcbiAgICB2YXIgcmVjdGFuZ2xlV2lkdGggPSBmaXhlZEJvdW5kcy5lYXN0IC0gZml4ZWRCb3VuZHMud2VzdDtcclxuICAgIHZhciByZWN0YW5nbGVIZWlnaHQgPSBmaXhlZEJvdW5kcy5ub3J0aCAtIGZpeGVkQm91bmRzLnNvdXRoO1xyXG4gICAgdGhpcy5fc2NhbGVYID0gaW1hZ2VXaWR0aCAvIHJlY3RhbmdsZVdpZHRoO1xyXG4gICAgdGhpcy5fc2NhbGVZID0gLWltYWdlSGVpZ2h0IC8gcmVjdGFuZ2xlSGVpZ2h0O1xyXG4gICAgXHJcbiAgICB0aGlzLl90cmFuc2xhdGVYID0gLWZpeGVkQm91bmRzLndlc3QgKiB0aGlzLl9zY2FsZVg7XHJcbiAgICB0aGlzLl90cmFuc2xhdGVZID0gLWZpeGVkQm91bmRzLm5vcnRoICogdGhpcy5fc2NhbGVZO1xyXG4gICAgXHJcbiAgICB2YXIgb3ZlcnZpZXdQYXJhbXMgPSB7XHJcbiAgICAgICAgbWluWDogMCxcclxuICAgICAgICBtaW5ZOiAwLFxyXG4gICAgICAgIG1heFhFeGNsdXNpdmU6IGltYWdlV2lkdGgsXHJcbiAgICAgICAgbWF4WUV4Y2x1c2l2ZTogaW1hZ2VIZWlnaHQsXHJcbiAgICAgICAgc2NyZWVuV2lkdGg6IHRoaXMuX292ZXJ2aWV3UmVzb2x1dGlvblgsXHJcbiAgICAgICAgc2NyZWVuSGVpZ2h0OiB0aGlzLl9vdmVydmlld1Jlc29sdXRpb25ZXHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICB2YXIgb3ZlcnZpZXdBbGlnbmVkUGFyYW1zID1cclxuICAgICAgICBpbWFnZUhlbHBlckZ1bmN0aW9ucy5hbGlnblBhcmFtc1RvVGlsZXNBbmRMZXZlbChcclxuICAgICAgICAgICAgb3ZlcnZpZXdQYXJhbXMsIHRoaXMuX2ltYWdlRGVjb2Rlcik7XHJcbiAgICAgICAgICAgIFxyXG4gICAgb3ZlcnZpZXdBbGlnbmVkUGFyYW1zLmltYWdlUGFydFBhcmFtcy5yZXF1ZXN0UHJpb3JpdHlEYXRhID1cclxuICAgICAgICBvdmVydmlld0FsaWduZWRQYXJhbXMuaW1hZ2VQYXJ0UGFyYW1zLnJlcXVlc3RQcmlvcml0eURhdGEgfHwge307XHJcbiAgICBcclxuICAgIG92ZXJ2aWV3QWxpZ25lZFBhcmFtcy5pbWFnZVBhcnRQYXJhbXMucmVxdWVzdFByaW9yaXR5RGF0YS5vdmVycmlkZUhpZ2hlc3RQcmlvcml0eSA9IHRydWU7XHJcbiAgICBvdmVydmlld0FsaWduZWRQYXJhbXMuaW1hZ2VQYXJ0UGFyYW1zLnF1YWxpdHkgPSB0aGlzLl9pbWFnZURlY29kZXIuZ2V0TG93ZXN0UXVhbGl0eSgpO1xyXG4gICAgXHJcbiAgICB2YXIgc3RhcnREeW5hbWljUmVnaW9uT25UZXJtaW5hdGlvbiA9XHJcbiAgICAgICAgIXRoaXMuX2FsbG93TXVsdGlwbGVNb3ZhYmxlRmV0Y2hlc0luU2Vzc2lvbjtcclxuICAgICAgICBcclxuICAgIHRoaXMuX2ZldGNoKFxyXG4gICAgICAgIFJFR0lPTl9PVkVSVklFVyxcclxuICAgICAgICBvdmVydmlld0FsaWduZWRQYXJhbXMsXHJcbiAgICAgICAgc3RhcnREeW5hbWljUmVnaW9uT25UZXJtaW5hdGlvbik7XHJcbiAgICBcclxuICAgIGlmICh0aGlzLl9hbGxvd011bHRpcGxlTW92YWJsZUZldGNoZXNJblNlc3Npb24pIHtcclxuICAgICAgICB0aGlzLl9zdGFydFNob3dpbmdEeW5hbWljUmVnaW9uKCk7XHJcbiAgICB9XHJcbn07IiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBJbWFnZVBhcmFtc1JldHJpZXZlclByb3h5O1xyXG5cclxuZnVuY3Rpb24gSW1hZ2VQYXJhbXNSZXRyaWV2ZXJQcm94eSgpIHtcclxuICAgIHRoaXMuX3NpemVzUGFyYW1zID0gbnVsbDtcclxufVxyXG5cclxuSW1hZ2VQYXJhbXNSZXRyaWV2ZXJQcm94eS5wcm90b3R5cGUuZ2V0SW1hZ2VMZXZlbCA9IGZ1bmN0aW9uIGdldEltYWdlTGV2ZWwoKSB7XHJcbiAgICB2YXIgc2l6ZXNQYXJhbXMgPSB0aGlzLmdldEltYWdlUGFyYW1zKCk7XHJcblxyXG4gICAgcmV0dXJuIHNpemVzUGFyYW1zLmltYWdlTGV2ZWw7XHJcbn07XHJcblxyXG5JbWFnZVBhcmFtc1JldHJpZXZlclByb3h5LnByb3RvdHlwZS5nZXRJbWFnZVdpZHRoID0gZnVuY3Rpb24gZ2V0SW1hZ2VXaWR0aCgpIHtcclxuICAgIHZhciBzaXplc1BhcmFtcyA9IHRoaXMuZ2V0SW1hZ2VQYXJhbXMoKTtcclxuXHJcbiAgICByZXR1cm4gc2l6ZXNQYXJhbXMuaW1hZ2VXaWR0aDtcclxufTtcclxuXHJcbkltYWdlUGFyYW1zUmV0cmlldmVyUHJveHkucHJvdG90eXBlLmdldEltYWdlSGVpZ2h0ID0gZnVuY3Rpb24gZ2V0SW1hZ2VIZWlnaHQoKSB7XHJcbiAgICB2YXIgc2l6ZXNQYXJhbXMgPSB0aGlzLmdldEltYWdlUGFyYW1zKCk7XHJcblxyXG4gICAgcmV0dXJuIHNpemVzUGFyYW1zLmltYWdlSGVpZ2h0O1xyXG59O1xyXG5cclxuSW1hZ2VQYXJhbXNSZXRyaWV2ZXJQcm94eS5wcm90b3R5cGUuZ2V0TnVtUmVzb2x1dGlvbkxldmVsc0ZvckxpbWl0dGVkVmlld2VyID0gZnVuY3Rpb24gZ2V0TnVtUmVzb2x1dGlvbkxldmVsc0ZvckxpbWl0dGVkVmlld2VyKCkge1xyXG4gICAgdmFyIHNpemVzUGFyYW1zID0gdGhpcy5nZXRJbWFnZVBhcmFtcygpO1xyXG5cclxuICAgIHJldHVybiBzaXplc1BhcmFtcy5udW1SZXNvbHV0aW9uTGV2ZWxzRm9yTGltaXR0ZWRWaWV3ZXI7XHJcbn07XHJcblxyXG5JbWFnZVBhcmFtc1JldHJpZXZlclByb3h5LnByb3RvdHlwZS5nZXRMb3dlc3RRdWFsaXR5ID0gZnVuY3Rpb24gZ2V0TG93ZXN0UXVhbGl0eSgpIHtcclxuICAgIHZhciBzaXplc1BhcmFtcyA9IHRoaXMuZ2V0SW1hZ2VQYXJhbXMoKTtcclxuXHJcbiAgICByZXR1cm4gc2l6ZXNQYXJhbXMubG93ZXN0UXVhbGl0eTtcclxufTtcclxuXHJcbkltYWdlUGFyYW1zUmV0cmlldmVyUHJveHkucHJvdG90eXBlLmdldEhpZ2hlc3RRdWFsaXR5ID0gZnVuY3Rpb24gZ2V0SGlnaGVzdFF1YWxpdHkoKSB7XHJcbiAgICB2YXIgc2l6ZXNQYXJhbXMgPSB0aGlzLmdldEltYWdlUGFyYW1zKCk7XHJcblxyXG4gICAgcmV0dXJuIHNpemVzUGFyYW1zLmhpZ2hlc3RRdWFsaXR5O1xyXG59O1xyXG5cclxuSW1hZ2VQYXJhbXNSZXRyaWV2ZXJQcm94eS5wcm90b3R5cGUuZ2V0SW1hZ2VQYXJhbXMgPSBmdW5jdGlvbiBnZXRJbWFnZVBhcmFtcygpIHtcclxuICAgIGlmICghdGhpcy5fc2l6ZXNQYXJhbXMpIHtcclxuICAgICAgICB0aGlzLl9zaXplc1BhcmFtcyA9IHRoaXMuX2dldEltYWdlUGFyYW1zSW50ZXJuYWwoKTtcclxuICAgICAgICBpZiAoIXRoaXMuX3NpemVzUGFyYW1zKSB7XHJcbiAgICAgICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IGdldEltYWdlUGFyYW1zSW50ZXJuYWwoKSByZXR1cm5lZCBmYWxzeSB2YWx1ZTsgTWF5YmUgaW1hZ2Ugbm90IHJlYWR5IHlldD8nO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBpZiAodGhpcy5fc2l6ZXNQYXJhbXMuaW1hZ2VMZXZlbCA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IGdldEltYWdlUGFyYW1zSW50ZXJuYWwoKSByZXN1bHQgaGFzIG5vIGltYWdlTGV2ZWwgcHJvcGVydHknO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBpZiAodGhpcy5fc2l6ZXNQYXJhbXMuaW1hZ2VXaWR0aCA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IGdldEltYWdlUGFyYW1zSW50ZXJuYWwoKSByZXN1bHQgaGFzIG5vIGltYWdlV2lkdGggcHJvcGVydHknO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBpZiAodGhpcy5fc2l6ZXNQYXJhbXMuaW1hZ2VIZWlnaHQgPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBnZXRJbWFnZVBhcmFtc0ludGVybmFsKCkgcmVzdWx0IGhhcyBubyBpbWFnZUhlaWdodCBwcm9wZXJ0eSc7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIGlmICh0aGlzLl9zaXplc1BhcmFtcy5udW1SZXNvbHV0aW9uTGV2ZWxzRm9yTGltaXR0ZWRWaWV3ZXIgPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBnZXRJbWFnZVBhcmFtc0ludGVybmFsKCkgcmVzdWx0IGhhcyBubyBudW1SZXNvbHV0aW9uTGV2ZWxzRm9yTGltaXR0ZWRWaWV3ZXIgcHJvcGVydHknO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBpZiAodGhpcy5fc2l6ZXNQYXJhbXMubG93ZXN0UXVhbGl0eSA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgICAgIHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IGdldEltYWdlUGFyYW1zSW50ZXJuYWwoKSByZXN1bHQgaGFzIG5vIGxvd2VzdFF1YWxpdHkgcHJvcGVydHknO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBpZiAodGhpcy5fc2l6ZXNQYXJhbXMuaGlnaGVzdFF1YWxpdHkgPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBnZXRJbWFnZVBhcmFtc0ludGVybmFsKCkgcmVzdWx0IGhhcyBubyBoaWdoZXN0UXVhbGl0eSBwcm9wZXJ0eSc7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgXHJcbiAgICByZXR1cm4gdGhpcy5fc2l6ZXNQYXJhbXM7XHJcbn07XHJcblxyXG5JbWFnZVBhcmFtc1JldHJpZXZlclByb3h5LnByb3RvdHlwZS5fZ2V0SW1hZ2VQYXJhbXNJbnRlcm5hbCA9IGZ1bmN0aW9uIGdldEltYWdlUGFyYW1zSW50ZXJuYWwoKSB7XHJcbiAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBJbWFnZVBhcmFtc1JldHJpZXZlclByb3h5IGluaGVyaXRvciBkaWQgbm90IGltcGxlbWVudCBfZ2V0SW1hZ2VQYXJhbXNJbnRlcm5hbCgpJztcclxufTsiLCIndXNlIHN0cmljdCc7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IFdvcmtlclByb3h5RmV0Y2hNYW5hZ2VyO1xyXG5cclxuZnVuY3Rpb24gV29ya2VyUHJveHlGZXRjaE1hbmFnZXIoZmV0Y2hlciwgb3B0aW9ucykge1xyXG5cdHRoaXMuX29wdGlvbnMgPSBvcHRpb25zIHx8IHt9O1xyXG5cdHRoaXMuX2ludGVybmFsU2l6ZXNQYXJhbXMgPSBudWxsO1xyXG5cdHRoaXMuX3RpbGVXaWR0aCA9IDA7XHJcblx0dGhpcy5fdGlsZUhlaWdodCA9IDA7XHJcblxyXG5cdGFzeW5jUHJveHkuQXN5bmNQcm94eUZhY3RvcnkuaW5pdGlhbGl6ZShcclxuICAgICAgICB0aGlzLCBmZXRjaGVyLnNjcmlwdHNUb0ltcG9ydCwgJ2ltYWdlRGVjb2RlckZyYW1ld29yay5GZXRjaE1hbmFnZXInLCBbZmV0Y2hlciwgb3B0aW9uc10pO1xyXG59XHJcblxyXG5hc3luY1Byb3h5LkFzeW5jUHJveHlGYWN0b3J5LmFkZE1ldGhvZHMoV29ya2VyUHJveHlGZXRjaE1hbmFnZXIsIHtcclxuXHRjbG9zZTogW3tpc1JldHVyblByb21pc2U6IHRydWV9XSxcclxuXHRzZXRQcmlvcml0aXplclR5cGU6IFtdLFxyXG5cdHNldEZldGNoUHJpb3JpdGl6ZXJEYXRhOiBbXSxcclxuXHRzZXRJc1Byb2dyZXNzaXZlUmVxdWVzdDogW10sXHJcblx0Y3JlYXRlTW92YWJsZUZldGNoOiBbe2lzUmV0dXJuUHJvbWlzZTogdHJ1ZX1dLFxyXG5cdG1vdmVGZXRjaDogW10sXHJcblx0Y3JlYXRlUmVxdWVzdDogW10sXHJcblx0bWFudWFsQWJvcnRSZXF1ZXN0OiBbXVxyXG59KTtcclxuXHJcbldvcmtlclByb3h5RmV0Y2hNYW5hZ2VyLnByb3RvdHlwZS5vcGVuID0gZnVuY3Rpb24gb3Blbih1cmwpIHtcclxuXHR2YXIgc2VsZiA9IHRoaXM7XHJcblx0dmFyIHdvcmtlckhlbHBlciA9IGFzeW5jUHJveHkuQXN5bmNQcm94eUZhY3RvcnkuZ2V0V29ya2VySGVscGVyKHRoaXMpO1xyXG5cclxuXHRyZXR1cm4gd29ya2VySGVscGVyLmNhbGxGdW5jdGlvbignb3BlbicsIFt1cmxdLCB7IGlzUmV0dXJuUHJvbWlzZTogdHJ1ZSB9KVxyXG5cdFx0LnRoZW4oZnVuY3Rpb24oZGF0YSkge1xyXG5cdFx0XHRzZWxmLl9pbnRlcm5hbFNpemVzUGFyYW1zID0gZGF0YTtcclxuXHRcdFx0c2VsZi5nZXRJbWFnZVBhcmFtcygpO1xyXG5cdFx0XHRyZXR1cm4gZGF0YTtcclxuXHRcdH0pO1xyXG59O1xyXG5cclxuV29ya2VyUHJveHlGZXRjaE1hbmFnZXIucHJvdG90eXBlLmdldEltYWdlUGFyYW1zID0gZnVuY3Rpb24gZ2V0SW1hZ2VQYXJhbXMoKSB7XHJcblx0aWYgKCF0aGlzLl9pbnRlcm5hbFNpemVzUGFyYW1zKSB7XHJcblx0XHR0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBub3Qgb3BlbmVkIHlldCc7XHJcblx0fVxyXG5cdHJldHVybiB0aGlzLl9pbnRlcm5hbFNpemVzUGFyYW1zO1xyXG59O1xyXG5cclxuV29ya2VyUHJveHlGZXRjaE1hbmFnZXIucHJvdG90eXBlLm9uID0gZnVuY3Rpb24gb24oZXZlbnQsIGNhbGxiYWNrKSB7XHJcbiAgICB2YXIgdHJhbnNmZXJhYmxlUGF0aHMgPSB0aGlzLl9vcHRpb25zLnRyYW5zZmVyYWJsZVBhdGhzT2ZEYXRhQ2FsbGJhY2s7XHJcblx0dmFyIHdvcmtlckhlbHBlciA9IGFzeW5jUHJveHkuQXN5bmNQcm94eUZhY3RvcnkuZ2V0V29ya2VySGVscGVyKHRoaXMpO1xyXG4gICAgXHJcbiAgICB2YXIgY2FsbGJhY2tXcmFwcGVyID0gd29ya2VySGVscGVyLndyYXBDYWxsYmFjayhcclxuICAgICAgICBjYWxsYmFjaywgZXZlbnQgKyAnLWNhbGxiYWNrJywge1xyXG4gICAgICAgICAgICBpc011bHRpcGxlVGltZUNhbGxiYWNrOiB0cnVlLFxyXG4gICAgICAgICAgICBwYXRoc1RvVHJhbnNmZXJhYmxlczogdHJhbnNmZXJhYmxlUGF0aHNcclxuICAgICAgICB9XHJcbiAgICApO1xyXG5cdFxyXG5cdHJldHVybiB3b3JrZXJIZWxwZXIuY2FsbEZ1bmN0aW9uKCdvbicsIFtldmVudCwgY2FsbGJhY2tXcmFwcGVyXSk7XHJcbn07IiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxudmFyIEltYWdlUGFyYW1zUmV0cmlldmVyUHJveHkgPSByZXF1aXJlKCdpbWFnZS1wYXJhbXMtcmV0cmlldmVyLXByb3h5LmpzJyk7XHJcbnZhciBpbWFnZUhlbHBlckZ1bmN0aW9ucyA9IHJlcXVpcmUoJ2ltYWdlLWhlbHBlci1mdW5jdGlvbnMuanMnKTtcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gV29ya2VyUHJveHlJbWFnZURlY29kZXI7XHJcblxyXG5mdW5jdGlvbiBXb3JrZXJQcm94eUltYWdlRGVjb2RlcihpbWFnZSwgb3B0aW9ucykge1xyXG5cdEltYWdlUGFyYW1zUmV0cmlldmVyUHJveHkuY2FsbCh0aGlzKTtcclxuICAgIFxyXG4gICAgaWYgKCdmdW5jdGlvbicgIT09IHR5cGVvZiBpbWFnZS5jcmVhdGVMZXZlbENhbGN1bGF0b3IpIHtcclxuICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBNaXNzaW5nIG1ldGhvZCBpbWFnZS5jcmVhdGVMZXZlbENhbGN1bGF0b3IoKSc7XHJcbiAgICB9XHJcbiAgICBcclxuXHRhc3luY1Byb3h5LkFzeW5jUHJveHlGYWN0b3J5LmluaXRpYWxpemUoXHJcbiAgICAgICAgdGhpcyxcclxuICAgICAgICBpbWFnZS5zY3JpcHRzVG9JbXBvcnQsXHJcbiAgICAgICAgJ2ltYWdlRGVjb2RlckZyYW1ld29yay5JbWFnZURlY29kZXInLFxyXG4gICAgICAgIFt7Y3Rvck5hbWU6IGltYWdlLmN0b3JOYW1lfSwgb3B0aW9uc10pO1xyXG5cdFxyXG4gICAgdGhpcy5faW1hZ2UgPSBpbWFnZTtcclxuICAgIHRoaXMuX2xldmVsQ2FsY3VsYXRvciA9IG51bGw7XHJcblx0dGhpcy5faW50ZXJuYWxTaXplc1BhcmFtcyA9IG51bGw7XHJcblx0dGhpcy5fdGlsZVdpZHRoID0gMDtcclxuXHR0aGlzLl90aWxlSGVpZ2h0ID0gMDtcclxufVxyXG5cclxuV29ya2VyUHJveHlJbWFnZURlY29kZXIucHJvdG90eXBlID0gT2JqZWN0LmNyZWF0ZShJbWFnZVBhcmFtc1JldHJpZXZlclByb3h5LnByb3RvdHlwZSk7XHJcblxyXG5hc3luY1Byb3h5LkFzeW5jUHJveHlGYWN0b3J5LmFkZE1ldGhvZHMoV29ya2VyUHJveHlJbWFnZURlY29kZXIsIHtcclxuXHRzZXRGZXRjaFByaW9yaXRpemVyRGF0YTogW10sXHJcblx0c2V0RGVjb2RlUHJpb3JpdGl6ZXJEYXRhOiBbXSxcclxuXHRzZXRGZXRjaFByaW9yaXRpemVyVHlwZTogW10sXHJcblx0c2V0RGVjb2RlUHJpb3JpdGl6ZXJUeXBlOiBbXSxcclxuXHRjbG9zZTogW3tpc1JldHVyblByb21pc2U6IHRydWV9XSxcclxuXHRjcmVhdGVNb3ZhYmxlRmV0Y2g6IFt7aXNSZXR1cm5Qcm9taXNlOiB0cnVlfV0sXHJcblx0cmVxdWVzdFBpeGVsczogW3tpc1JldHVyblByb21pc2U6IHRydWV9XVxyXG59KTtcclxuXHJcbldvcmtlclByb3h5SW1hZ2VEZWNvZGVyLnByb3RvdHlwZS5vcGVuID0gZnVuY3Rpb24gb3Blbih1cmwpIHtcclxuXHR2YXIgc2VsZiA9IHRoaXM7XHJcblx0dmFyIHdvcmtlckhlbHBlciA9IGFzeW5jUHJveHkuQXN5bmNQcm94eUZhY3RvcnkuZ2V0V29ya2VySGVscGVyKHRoaXMpO1xyXG5cdHJldHVybiB3b3JrZXJIZWxwZXIuY2FsbEZ1bmN0aW9uKCdvcGVuJywgW3VybF0sIHsgaXNSZXR1cm5Qcm9taXNlOiB0cnVlIH0pXHJcblx0XHQudGhlbihmdW5jdGlvbihkYXRhKSB7XHJcblx0XHRcdHNlbGYuX2ludGVybmFsU2l6ZXNQYXJhbXMgPSBkYXRhLnNpemVzUGFyYW1zO1xyXG5cdFx0XHRzZWxmLl90aWxlV2lkdGggPSBkYXRhLmFwcGxpY2F0aXZlVGlsZVdpZHRoO1xyXG5cdFx0XHRzZWxmLl90aWxlSGVpZ2h0ID0gZGF0YS5hcHBsaWNhdGl2ZVRpbGVIZWlnaHQ7XHJcblx0XHRcdHNlbGYuZ2V0SW1hZ2VQYXJhbXMoKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHNlbGYuX2xldmVsQ2FsY3VsYXRvciA9IHNlbGYuX2ltYWdlLmNyZWF0ZUxldmVsQ2FsY3VsYXRvcihzZWxmKTtcclxuICAgICAgICAgICAgaW1hZ2VIZWxwZXJGdW5jdGlvbnMuZW5zdXJlTGV2ZWxDYWxjdWxhdG9yKHNlbGYuX2xldmVsQ2FsY3VsYXRvcik7XHJcblx0XHRcdHJldHVybiBkYXRhO1xyXG5cdFx0fSk7XHJcbn07XHJcblxyXG5Xb3JrZXJQcm94eUltYWdlRGVjb2Rlci5wcm90b3R5cGUuX2dldEltYWdlUGFyYW1zSW50ZXJuYWwgPSBmdW5jdGlvbiBnZXRJbWFnZVBhcmFtc0ludGVybmFsKCkge1xyXG5cdGlmICghdGhpcy5faW50ZXJuYWxTaXplc1BhcmFtcykge1xyXG5cdFx0dGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogbm90IG9wZW5lZCB5ZXQnO1xyXG5cdH1cclxuXHRyZXR1cm4gdGhpcy5faW50ZXJuYWxTaXplc1BhcmFtcztcclxufTtcclxuXHJcbldvcmtlclByb3h5SW1hZ2VEZWNvZGVyLnByb3RvdHlwZS5nZXRUaWxlV2lkdGggPSBmdW5jdGlvbiBnZXRUaWxlV2lkdGgoKSB7XHJcblx0dGhpcy5fZ2V0SW1hZ2VQYXJhbXNJbnRlcm5hbCgpOyAvLyBlbnN1cmUgYWxyZWFkeSBvcGVuZWRcclxuXHRyZXR1cm4gdGhpcy5fdGlsZVdpZHRoO1xyXG59O1xyXG5cclxuV29ya2VyUHJveHlJbWFnZURlY29kZXIucHJvdG90eXBlLmdldFRpbGVIZWlnaHQgPSBmdW5jdGlvbiBnZXRUaWxlSGVpZ2h0KCkge1xyXG5cdHRoaXMuX2dldEltYWdlUGFyYW1zSW50ZXJuYWwoKTsgLy8gZW5zdXJlIGFscmVhZHkgb3BlbmVkXHJcblx0cmV0dXJuIHRoaXMuX3RpbGVIZWlnaHQ7XHJcbn07XHJcblxyXG5Xb3JrZXJQcm94eUltYWdlRGVjb2Rlci5wcm90b3R5cGUub25GZXRjaGVyRXZlbnQgPSBmdW5jdGlvbiBvbkZldGNoZXJFdmVudChldmVudCwgY2FsbGJhY2spIHtcclxuXHR2YXIgdHJhbnNmZXJhYmxlcztcclxuXHJcblx0dmFyIHdvcmtlckhlbHBlciA9IGFzeW5jUHJveHkuQXN5bmNQcm94eUZhY3RvcnkuZ2V0V29ya2VySGVscGVyKHRoaXMpO1xyXG4gICAgXHJcblx0dmFyIGludGVybmFsQ2FsbGJhY2tXcmFwcGVyID1cclxuXHRcdHdvcmtlckhlbHBlci53cmFwQ2FsbGJhY2soXHJcblx0XHRcdGNhbGxiYWNrLCAnb25GZXRjaGVyRXZlbnRDYWxsYmFjaycsIHtcclxuXHRcdFx0XHRpc011bHRpcGxlVGltZUNhbGxiYWNrOiB0cnVlLFxyXG5cdFx0XHRcdHBhdGhzVG9UcmFuc2ZlcmFibGVzOiB0cmFuc2ZlcmFibGVzXHJcblx0XHRcdH1cclxuXHRcdCk7XHJcbiAgICBcclxuICAgIHZhciBhcmdzID0gW2V2ZW50LCBjYWxsYmFja107XHJcbiAgICBcclxuICAgIHdvcmtlckhlbHBlci5jYWxsRnVuY3Rpb24oJ29uJywgYXJncyk7XHJcbn07XHJcblxyXG5Xb3JrZXJQcm94eUltYWdlRGVjb2Rlci5wcm90b3R5cGUucmVxdWVzdFBpeGVsc1Byb2dyZXNzaXZlID0gZnVuY3Rpb24gcmVxdWVzdFBpeGVsc1Byb2dyZXNzaXZlKFxyXG5cdFx0aW1hZ2VQYXJ0UGFyYW1zLFxyXG5cdFx0Y2FsbGJhY2ssXHJcblx0XHR0ZXJtaW5hdGVkQ2FsbGJhY2ssXHJcblx0XHRpbWFnZVBhcnRQYXJhbXNOb3ROZWVkZWQsXHJcblx0XHRtb3ZhYmxlSGFuZGxlKSB7XHJcblx0XHJcblx0dmFyIHRyYW5zZmVyYWJsZXM7XHJcblx0dmFyIHdvcmtlckhlbHBlciA9IGFzeW5jUHJveHkuQXN5bmNQcm94eUZhY3RvcnkuZ2V0V29ya2VySGVscGVyKHRoaXMpO1xyXG5cclxuXHQvLyBOT1RFOiBDYW5ub3QgcGFzcyBpdCBhcyB0cmFuc2ZlcmFibGVzIGJlY2F1c2UgaXQgaXMgcGFzc2VkIHRvIGFsbFxyXG5cdC8vIGxpc3RlbmVyIGNhbGxiYWNrcywgdGh1cyBhZnRlciB0aGUgZmlyc3Qgb25lIHRoZSBidWZmZXIgaXMgbm90IHZhbGlkXHJcblx0XHJcblx0Ly92YXIgcGF0aFRvUGl4ZWxzQXJyYXkgPSBbMCwgJ3BpeGVscycsICdidWZmZXInXTtcclxuXHQvL3RyYW5zZmVyYWJsZXMgPSBbcGF0aFRvUGl4ZWxzQXJyYXldO1xyXG5cdFxyXG5cdHZhciBpbnRlcm5hbENhbGxiYWNrV3JhcHBlciA9XHJcblx0XHR3b3JrZXJIZWxwZXIud3JhcENhbGxiYWNrKFxyXG5cdFx0XHRjYWxsYmFjaywgJ3JlcXVlc3RQaXhlbHNQcm9ncmVzc2l2ZUNhbGxiYWNrJywge1xyXG5cdFx0XHRcdGlzTXVsdGlwbGVUaW1lQ2FsbGJhY2s6IHRydWUsXHJcblx0XHRcdFx0cGF0aHNUb1RyYW5zZmVyYWJsZXM6IHRyYW5zZmVyYWJsZXNcclxuXHRcdFx0fVxyXG5cdFx0KTtcclxuXHRcclxuXHR2YXIgaW50ZXJuYWxUZXJtaW5hdGVkQ2FsbGJhY2tXcmFwcGVyID1cclxuXHRcdHdvcmtlckhlbHBlci53cmFwQ2FsbGJhY2soXHJcblx0XHRcdGludGVybmFsVGVybWluYXRlZENhbGxiYWNrLCAncmVxdWVzdFBpeGVsc1Byb2dyZXNzaXZlVGVybWluYXRlZENhbGxiYWNrJywge1xyXG5cdFx0XHRcdGlzTXVsdGlwbGVUaW1lQ2FsbGJhY2s6IGZhbHNlXHJcblx0XHRcdH1cclxuXHRcdCk7XHJcblx0XHRcdFxyXG5cdHZhciBhcmdzID0gW1xyXG5cdFx0aW1hZ2VQYXJ0UGFyYW1zLFxyXG5cdFx0aW50ZXJuYWxDYWxsYmFja1dyYXBwZXIsXHJcblx0XHRpbnRlcm5hbFRlcm1pbmF0ZWRDYWxsYmFja1dyYXBwZXIsXHJcblx0XHRpbWFnZVBhcnRQYXJhbXNOb3ROZWVkZWQsXHJcblx0XHRtb3ZhYmxlSGFuZGxlXTtcclxuXHRcclxuXHR3b3JrZXJIZWxwZXIuY2FsbEZ1bmN0aW9uKCdyZXF1ZXN0UGl4ZWxzUHJvZ3Jlc3NpdmUnLCBhcmdzKTtcclxuXHRcdFxyXG5cdHZhciBzZWxmID0gdGhpcztcclxuXHRcclxuXHRmdW5jdGlvbiBpbnRlcm5hbFRlcm1pbmF0ZWRDYWxsYmFjayhpc0Fib3J0ZWQpIHtcclxuXHRcdHdvcmtlckhlbHBlci5mcmVlQ2FsbGJhY2soaW50ZXJuYWxDYWxsYmFja1dyYXBwZXIpO1xyXG5cdFx0XHJcblx0XHR0ZXJtaW5hdGVkQ2FsbGJhY2soaXNBYm9ydGVkKTtcclxuXHR9XHRcdFxyXG59OyIsIid1c2Ugc3RyaWN0JztcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gSW1hZ2VEZWNvZGVyO1xyXG5cclxudmFyIGltYWdlSGVscGVyRnVuY3Rpb25zID0gcmVxdWlyZSgnaW1hZ2UtaGVscGVyLWZ1bmN0aW9ucy5qcycpO1xyXG52YXIgRGVjb2RlSm9ic1Bvb2wgPSByZXF1aXJlKCdkZWNvZGUtam9icy1wb29sLmpzJyk7XHJcbnZhciBJbWFnZVBhcmFtc1JldHJpZXZlclByb3h5ID0gcmVxdWlyZSgnaW1hZ2UtcGFyYW1zLXJldHJpZXZlci1wcm94eS5qcycpO1xyXG52YXIgRmV0Y2hNYW5hZ2VyID0gcmVxdWlyZSgnZmV0Y2gtbWFuYWdlci5qcycpO1xyXG52YXIgV29ya2VyUHJveHlGZXRjaE1hbmFnZXIgPSByZXF1aXJlKCd3b3JrZXItcHJveHktZmV0Y2gtbWFuYWdlci5qcycpO1xyXG52YXIgV29ya2VyUHJveHlJbWFnZURlY29kZXIgPSByZXF1aXJlKCd3b3JrZXItcHJveHktaW1hZ2UtZGVjb2Rlci5qcycpO1xyXG5cclxuLyogZ2xvYmFsIGNvbnNvbGU6IGZhbHNlICovXHJcbi8qIGdsb2JhbCBQcm9taXNlOiBmYWxzZSAqL1xyXG5cclxuSW1hZ2VEZWNvZGVyLmFsaWduUGFyYW1zVG9UaWxlc0FuZExldmVsID0gaW1hZ2VIZWxwZXJGdW5jdGlvbnMuYWxpZ25QYXJhbXNUb1RpbGVzQW5kTGV2ZWw7XHJcblxyXG5JbWFnZURlY29kZXIuZnJvbUltYWdlID0gZnVuY3Rpb24gZnJvbUltYWdlKGltYWdlLCBvcHRpb25zKSB7XHJcbiAgICB2YXIgaXNJbmRpcmVjdENyZWF0aW9uTmVlZGVkID0gaW1hZ2VIZWxwZXJGdW5jdGlvbnMuaXNJbmRpcmVjdENyZWF0aW9uTmVlZGVkKFxyXG4gICAgICAgIGltYWdlLCAnaW1hZ2UnLCBJbWFnZURlY29kZXIuX2ltYWdlRXhwZWN0ZWRNZXRob2RzKTtcclxuICAgIFxyXG4gICAgaWYgKCFpc0luZGlyZWN0Q3JlYXRpb25OZWVkZWQgfHwgIWltYWdlLnVzZVdvcmtlcikge1xyXG4gICAgICAgIHJldHVybiBuZXcgSW1hZ2VEZWNvZGVyKGltYWdlLCBvcHRpb25zKTtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgICAgcmV0dXJuIG5ldyBXb3JrZXJQcm94eUltYWdlRGVjb2RlcihpbWFnZSwgb3B0aW9ucyk7XHJcbiAgICB9XHJcbn07XHJcblxyXG5JbWFnZURlY29kZXIuX2ltYWdlRXhwZWN0ZWRNZXRob2RzID0gWydvcGVuZWQnLCAnZ2V0TGV2ZWxDYWxjdWxhdG9yJywgJ2dldEZldGNoZXInLCAnZ2V0RGVjb2RlcldvcmtlcnNJbnB1dFJldHJlaXZlciddO1xyXG5cclxuZnVuY3Rpb24gSW1hZ2VEZWNvZGVyKGltYWdlLCBvcHRpb25zKSB7XHJcbiAgICBJbWFnZVBhcmFtc1JldHJpZXZlclByb3h5LmNhbGwodGhpcyk7XHJcbiAgICBcclxuICAgIHRoaXMuX29wdGlvbnMgPSBvcHRpb25zIHx8IHt9O1xyXG4gICAgdGhpcy5fZGVjb2RlV29ya2Vyc0xpbWl0ID0gdGhpcy5fb3B0aW9ucy5kZWNvZGVXb3JrZXJzTGltaXQgfHwgNTtcclxuICAgIFxyXG4gICAgdGhpcy5fdGlsZVdpZHRoID0gdGhpcy5fb3B0aW9ucy50aWxlV2lkdGggfHwgMjU2O1xyXG4gICAgdGhpcy5fdGlsZUhlaWdodCA9IHRoaXMuX29wdGlvbnMudGlsZUhlaWdodCB8fCAyNTY7XHJcbiAgICB0aGlzLl9zaG93TG9nID0gISF0aGlzLl9vcHRpb25zLnNob3dMb2c7XHJcbiAgICB0aGlzLl9mZXRjaE1hbmFnZXIgPSBudWxsO1xyXG4gICAgdGhpcy5fZGVjb2RlRGVwZW5kZW5jeVdvcmtlcnMgPSBudWxsO1xyXG4gICAgdGhpcy5fcmVxdWVzdHNEZWNvZGVKb2JzUG9vbCA9IG51bGw7XHJcbiAgICB0aGlzLl9tb3ZhYmxlc0RlY29kZUpvYnNQb29sID0gbnVsbDtcclxuICAgIHRoaXMuX2xldmVsQ2FsY3VsYXRvciA9IG51bGw7XHJcblx0dGhpcy5fZmV0Y2hSZXF1ZXN0SWQgPSAwO1xyXG4gICAgXHJcbiAgICAvKmlmICh0aGlzLl9zaG93TG9nKSB7XHJcbiAgICAgICAgLy8gT2xkIElFXHJcbiAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogc2hvd0xvZyBpcyBub3Qgc3VwcG9ydGVkIG9uIHRoaXMgYnJvd3Nlcic7XHJcbiAgICB9Ki9cclxuXHJcbiAgICB0aGlzLl9tb3ZhYmxlU3RhdGVzID0gW107XHJcbiAgICB0aGlzLl9kZWNvZGVycyA9IFtdO1xyXG5cdFxyXG5cdHRoaXMuX2RlY29kZVNjaGVkdWxlciA9IG51bGw7XHJcblx0dGhpcy5fZGVjb2RlUHJpb3JpdGl6ZXIgPSBudWxsO1xyXG5cdHRoaXMuX3ByaW9yaXRpemVyVHlwZSA9IG51bGw7XHJcblxyXG4gICAgdGhpcy5faW1hZ2UgPSBpbWFnZUhlbHBlckZ1bmN0aW9ucy5nZXRPckNyZWF0ZUluc3RhbmNlKFxyXG4gICAgICAgIGltYWdlLCAnaW1hZ2UnLCBJbWFnZURlY29kZXIuX2ltYWdlRXhwZWN0ZWRNZXRob2RzKTtcclxufVxyXG5cclxuSW1hZ2VEZWNvZGVyLnByb3RvdHlwZSA9IE9iamVjdC5jcmVhdGUoSW1hZ2VQYXJhbXNSZXRyaWV2ZXJQcm94eS5wcm90b3R5cGUpO1xyXG5cclxuSW1hZ2VEZWNvZGVyLnByb3RvdHlwZS5nZXRUaWxlV2lkdGggPSBmdW5jdGlvbiBnZXRUaWxlV2lkdGgoKSB7XHJcbiAgICByZXR1cm4gdGhpcy5fdGlsZVdpZHRoO1xyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVyLnByb3RvdHlwZS5nZXRUaWxlSGVpZ2h0ID0gZnVuY3Rpb24gZ2V0VGlsZUhlaWdodCgpIHtcclxuICAgIHJldHVybiB0aGlzLl90aWxlSGVpZ2h0O1xyXG59O1xyXG4gICAgXHJcbkltYWdlRGVjb2Rlci5wcm90b3R5cGUuc2V0RmV0Y2hQcmlvcml0aXplckRhdGEgPVxyXG4gICAgZnVuY3Rpb24gc2V0RmV0Y2hQcmlvcml0aXplckRhdGEocHJpb3JpdGl6ZXJEYXRhKSB7XHJcblxyXG4gICAgdGhpcy5fdmFsaWRhdGVGZXRjaGVyKCk7XHJcbiAgICBcclxuICAgIHRoaXMuX2ZldGNoTWFuYWdlci5zZXRGZXRjaFByaW9yaXRpemVyRGF0YShcclxuICAgICAgICBwcmlvcml0aXplckRhdGEpO1xyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVyLnByb3RvdHlwZS5zZXREZWNvZGVQcmlvcml0aXplckRhdGEgPVxyXG4gICAgZnVuY3Rpb24gc2V0RGVjb2RlUHJpb3JpdGl6ZXJEYXRhKHByaW9yaXRpemVyRGF0YSkge1xyXG5cclxuICAgIHRoaXMuX3ZhbGlkYXRlRGVjb2RlcigpO1xyXG4gICAgXHJcbiAgICBpZiAodGhpcy5fZGVjb2RlUHJpb3JpdGl6ZXIgPT09IG51bGwpIHtcclxuICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBObyBkZWNvZGUgcHJpb3JpdGl6ZXIgaGFzIGJlZW4gc2V0JztcclxuICAgIH1cclxuICAgIFxyXG4gICAgaWYgKHRoaXMuX3Nob3dMb2cpIHtcclxuICAgICAgICBjb25zb2xlLmxvZygnc2V0RGVjb2RlUHJpb3JpdGl6ZXJEYXRhKCcgKyBwcmlvcml0aXplckRhdGEgKyAnKScpO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICB2YXIgcHJpb3JpdGl6ZXJEYXRhTW9kaWZpZWQgPSBPYmplY3QuY3JlYXRlKHByaW9yaXRpemVyRGF0YSk7XHJcbiAgICBwcmlvcml0aXplckRhdGFNb2RpZmllZC5pbWFnZSA9IHRoaXM7XHJcbiAgICBcclxuICAgIHRoaXMuX2RlY29kZVByaW9yaXRpemVyLnNldFByaW9yaXRpemVyRGF0YShwcmlvcml0aXplckRhdGFNb2RpZmllZCk7XHJcbn07XHJcblxyXG5JbWFnZURlY29kZXIucHJvdG90eXBlLnNldERlY29kZVByaW9yaXRpemVyVHlwZSA9IGZ1bmN0aW9uIHNldFByaW9yaXRpemVyVHlwZShwcmlvcml0aXplclR5cGUpIHtcclxuXHRpZiAodGhpcy5fZGVjb2RlU2NoZWR1bGVyICE9PSBudWxsKSB7XHJcblx0XHR0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBDYW5ub3Qgc2V0IHByaW9yaXRpemVyIHR5cGUgYXQgdGhpcyB0aW1lJztcclxuXHR9XHJcblx0XHJcblx0dGhpcy5fcHJpb3JpdGl6ZXJUeXBlID0gcHJpb3JpdGl6ZXJUeXBlO1xyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVyLnByb3RvdHlwZS5zZXRGZXRjaFByaW9yaXRpemVyVHlwZSA9IGZ1bmN0aW9uIHNldFByaW9yaXRpemVyVHlwZShwcmlvcml0aXplclR5cGUpIHtcclxuICAgIHRoaXMuX3ZhbGlkYXRlRmV0Y2hlcigpO1xyXG5cdHRoaXMuX2ZldGNoTWFuYWdlci5zZXRQcmlvcml0aXplclR5cGUocHJpb3JpdGl6ZXJUeXBlKTtcclxufTtcclxuXHJcbkltYWdlRGVjb2Rlci5wcm90b3R5cGUub3BlbiA9IGZ1bmN0aW9uIG9wZW4odXJsKSB7XHJcbiAgICB0aGlzLl92YWxpZGF0ZUZldGNoZXIoKTtcclxuXHJcbiAgICB2YXIgc2VsZiA9IHRoaXM7XHJcbiAgICB2YXIgcHJvbWlzZSA9IHRoaXMuX2ZldGNoTWFuYWdlci5vcGVuKHVybCk7XHJcbiAgICByZXR1cm4gcHJvbWlzZS50aGVuKGZ1bmN0aW9uIChzaXplc1BhcmFtcykge1xyXG4gICAgICAgIHNlbGYuX2ludGVybmFsU2l6ZXNQYXJhbXMgPSBzaXplc1BhcmFtcztcclxuICAgICAgICBzZWxmLl9pbWFnZS5vcGVuZWQoc2VsZik7XHJcbiAgICAgICAgc2VsZi5fbGV2ZWxDYWxjdWxhdG9yID0gc2VsZi5faW1hZ2UuZ2V0TGV2ZWxDYWxjdWxhdG9yKCk7XHJcbiAgICAgICAgaW1hZ2VIZWxwZXJGdW5jdGlvbnMuZW5zdXJlTGV2ZWxDYWxjdWxhdG9yKHNlbGYuX2xldmVsQ2FsY3VsYXRvcik7XHJcbiAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgICAgc2l6ZXNQYXJhbXM6IHNpemVzUGFyYW1zLFxyXG4gICAgICAgICAgICBhcHBsaWNhdGl2ZVRpbGVXaWR0aCA6IHNlbGYuZ2V0VGlsZVdpZHRoKCksXHJcbiAgICAgICAgICAgIGFwcGxpY2F0aXZlVGlsZUhlaWdodDogc2VsZi5nZXRUaWxlSGVpZ2h0KClcclxuICAgICAgICB9O1xyXG4gICAgfSk7XHJcbn07XHJcblxyXG5JbWFnZURlY29kZXIucHJvdG90eXBlLmNsb3NlID0gZnVuY3Rpb24gY2xvc2UoKSB7XHJcbiAgICB0aGlzLl92YWxpZGF0ZUZldGNoZXIoKTtcclxuICAgIHRoaXMuX3ZhbGlkYXRlRGVjb2RlcigpO1xyXG4gICAgXHJcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IHRoaXMuX2RlY29kZXJzLmxlbmd0aDsgKytpKSB7XHJcbiAgICAgICAgdGhpcy5fZGVjb2RlcnNbaV0udGVybWluYXRlKCk7XHJcbiAgICB9XHJcblxyXG5cdHZhciBzZWxmID0gdGhpcztcclxuICAgIHJldHVybiB0aGlzLl9mZXRjaE1hbmFnZXIuY2xvc2UoKS50aGVuKGZ1bmN0aW9uKCkge1xyXG5cdFx0c2VsZi5fZGVjb2RlRGVwZW5kZW5jeVdvcmtlcnMudGVybWluYXRlSW5hY3RpdmVXb3JrZXJzKCk7XHJcblx0fSk7XHJcbn07XHJcblxyXG5JbWFnZURlY29kZXIucHJvdG90eXBlLm9uRmV0Y2hlckV2ZW50ID0gZnVuY3Rpb24gb25GZXRjaGVyRXZlbnQoZXZlbnQsIGNhbGxiYWNrKSB7XHJcbiAgICB0aGlzLl92YWxpZGF0ZUZldGNoZXIoKTtcclxuICAgIHRoaXMuX2ZldGNoTWFuYWdlci5vbihldmVudCwgY2FsbGJhY2spO1xyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVyLnByb3RvdHlwZS5jcmVhdGVNb3ZhYmxlRmV0Y2ggPSBmdW5jdGlvbiBjcmVhdGVNb3ZhYmxlRmV0Y2goKSB7XHJcbiAgICB0aGlzLl92YWxpZGF0ZUZldGNoZXIoKTtcclxuICAgIHRoaXMuZ2V0SW1hZ2VQYXJhbXMoKTtcclxuICAgIFxyXG4gICAgdmFyIHNlbGYgPSB0aGlzO1xyXG4gICAgXHJcbiAgICByZXR1cm4gdGhpcy5fZmV0Y2hNYW5hZ2VyLmNyZWF0ZU1vdmFibGVGZXRjaCgpLnRoZW4oZnVuY3Rpb24obW92YWJsZUhhbmRsZSkge1xyXG4gICAgICAgIHNlbGYuX21vdmFibGVTdGF0ZXNbbW92YWJsZUhhbmRsZV0gPSB7XHJcbiAgICAgICAgICAgIGRlY29kZUpvYnNMaXN0ZW5lckhhbmRsZTogbnVsbFxyXG4gICAgICAgIH07XHJcbiAgICAgICAgXHJcbiAgICAgICAgcmV0dXJuIG1vdmFibGVIYW5kbGU7XHJcbiAgICB9KTtcclxufTtcclxuXHJcbkltYWdlRGVjb2Rlci5wcm90b3R5cGUucmVxdWVzdFBpeGVscyA9IGZ1bmN0aW9uIHJlcXVlc3RQaXhlbHMoaW1hZ2VQYXJ0UGFyYW1zKSB7XHJcbiAgICB0aGlzLl92YWxpZGF0ZURlY29kZXIoKTtcclxuICAgIHRoaXMuZ2V0SW1hZ2VQYXJhbXMoKTtcclxuICAgIFxyXG4gICAgdmFyIHJlc29sdmUsIHJlamVjdDtcclxuICAgIHZhciBhY2N1bXVsYXRlZFJlc3VsdCA9IHt9O1xyXG4gICAgXHJcbiAgICB2YXIgc2VsZiA9IHRoaXM7XHJcbiAgICB2YXIgcHJvbWlzZSA9IG5ldyBQcm9taXNlKHN0YXJ0UHJvbWlzZSk7XHJcbiAgICByZXR1cm4gcHJvbWlzZTtcclxuICAgIFxyXG4gICAgZnVuY3Rpb24gc3RhcnRQcm9taXNlKHJlc29sdmVfLCByZWplY3RfKSB7XHJcbiAgICAgICAgcmVzb2x2ZSA9IHJlc29sdmVfO1xyXG4gICAgICAgIHJlamVjdCA9IHJlamVjdF87XHJcbiAgICAgICAgXHJcbiAgICAgICAgc2VsZi5fcmVxdWVzdHNEZWNvZGVKb2JzUG9vbC5mb3JrRGVjb2RlSm9icyhcclxuICAgICAgICAgICAgaW1hZ2VQYXJ0UGFyYW1zLFxyXG4gICAgICAgICAgICBpbnRlcm5hbENhbGxiYWNrLFxyXG4gICAgICAgICAgICBpbnRlcm5hbFRlcm1pbmF0ZWRDYWxsYmFjayk7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGZ1bmN0aW9uIGludGVybmFsQ2FsbGJhY2soZGVjb2RlZERhdGEpIHtcclxuICAgICAgICBzZWxmLl9jb3B5UGl4ZWxzVG9BY2N1bXVsYXRlZFJlc3VsdChkZWNvZGVkRGF0YSwgYWNjdW11bGF0ZWRSZXN1bHQpO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBmdW5jdGlvbiBpbnRlcm5hbFRlcm1pbmF0ZWRDYWxsYmFjayhpc0Fib3J0ZWQpIHtcclxuICAgICAgICBpZiAoaXNBYm9ydGVkKSB7XHJcbiAgICAgICAgICAgIHJlamVjdCgnUmVxdWVzdCB3YXMgYWJvcnRlZCBkdWUgdG8gZmFpbHVyZSBvciBwcmlvcml0eScpO1xyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgIHJlc29sdmUoYWNjdW11bGF0ZWRSZXN1bHQpO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxufTtcclxuXHJcbkltYWdlRGVjb2Rlci5wcm90b3R5cGUucmVxdWVzdFBpeGVsc1Byb2dyZXNzaXZlID0gZnVuY3Rpb24gcmVxdWVzdFBpeGVsc1Byb2dyZXNzaXZlKFxyXG4gICAgaW1hZ2VQYXJ0UGFyYW1zLFxyXG4gICAgY2FsbGJhY2ssXHJcbiAgICB0ZXJtaW5hdGVkQ2FsbGJhY2ssXHJcbiAgICBpbWFnZVBhcnRQYXJhbXNOb3ROZWVkZWQsXHJcbiAgICBtb3ZhYmxlSGFuZGxlKSB7XHJcbiAgICBcclxuICAgIHRoaXMuX3ZhbGlkYXRlRGVjb2RlcigpO1xyXG4gICAgdGhpcy5nZXRJbWFnZVBhcmFtcygpO1xyXG4gICAgXHJcbiAgICB2YXIgbW92YWJsZVN0YXRlID0gbnVsbDtcclxuICAgIHZhciBkZWNvZGVKb2JzUG9vbDtcclxuICAgIGlmIChtb3ZhYmxlSGFuZGxlID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICBkZWNvZGVKb2JzUG9vbCA9IHRoaXMuX3JlcXVlc3RzRGVjb2RlSm9ic1Bvb2w7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICAgIGRlY29kZUpvYnNQb29sID0gdGhpcy5fbW92YWJsZXNEZWNvZGVKb2JzUG9vbDtcclxuICAgICAgICBcclxuICAgICAgICBtb3ZhYmxlU3RhdGUgPSB0aGlzLl9tb3ZhYmxlU3RhdGVzW21vdmFibGVIYW5kbGVdO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGlmIChtb3ZhYmxlU3RhdGUgPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBNb3ZhYmxlIGhhbmRsZSBkb2VzIG5vdCBleGlzdCc7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgXHJcbiAgICB2YXIgbGlzdGVuZXJIYW5kbGUgPSBkZWNvZGVKb2JzUG9vbC5mb3JrRGVjb2RlSm9icyhcclxuICAgICAgICBpbWFnZVBhcnRQYXJhbXMsXHJcbiAgICAgICAgY2FsbGJhY2ssXHJcbiAgICAgICAgdGVybWluYXRlZENhbGxiYWNrLFxyXG4gICAgICAgIGltYWdlUGFydFBhcmFtc05vdE5lZWRlZCk7XHJcbiAgICAgICAgXHJcbiAgICBpZiAobW92YWJsZUhhbmRsZSAhPT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgaWYgKG1vdmFibGVTdGF0ZS5kZWNvZGVKb2JzTGlzdGVuZXJIYW5kbGUgIT09IG51bGwpIHtcclxuICAgICAgICAgICAgLy8gVW5yZWdpc3RlciBhZnRlciBmb3JrZWQgbmV3IGpvYnMsIHNvIG5vIHRlcm1pbmF0aW9uIG9jY3VycyBtZWFud2hpbGVcclxuICAgICAgICAgICAgZGVjb2RlSm9ic1Bvb2wudW5yZWdpc3RlckZvcmtlZEpvYnMoXHJcbiAgICAgICAgICAgICAgICBtb3ZhYmxlU3RhdGUuZGVjb2RlSm9ic0xpc3RlbmVySGFuZGxlKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgbW92YWJsZVN0YXRlLmRlY29kZUpvYnNMaXN0ZW5lckhhbmRsZSA9IGxpc3RlbmVySGFuZGxlO1xyXG4gICAgICAgIHRoaXMuX2ZldGNoTWFuYWdlci5tb3ZlRmV0Y2gobW92YWJsZUhhbmRsZSwgaW1hZ2VQYXJ0UGFyYW1zKTtcclxuICAgIH0gZWxzZSB7XHJcblx0XHR0aGlzLl9mZXRjaE1hbmFnZXIuY3JlYXRlUmVxdWVzdCgrK3RoaXMuX2ZldGNoUmVxdWVzdElkLCBpbWFnZVBhcnRQYXJhbXMpO1xyXG5cdH1cclxufTtcclxuXHJcbkltYWdlRGVjb2Rlci5wcm90b3R5cGUuZ2V0TGV2ZWxDYWxjdWxhdG9yID0gZnVuY3Rpb24gZ2V0TGV2ZWxDYWxjdWxhdG9yKCkge1xyXG4gICAgcmV0dXJuIHRoaXMuX2xldmVsQ2FsY3VsYXRvcjtcclxufTtcclxuXHJcbi8vIEludGVybmFsIE1ldGhvZHNcclxuXHJcbkltYWdlRGVjb2Rlci5wcm90b3R5cGUuX3ZhbGlkYXRlRmV0Y2hlciA9IGZ1bmN0aW9uIHZhbGlkYXRlRmV0Y2hlcigpIHtcclxuICAgIGlmICh0aGlzLl9mZXRjaE1hbmFnZXIgIT09IG51bGwpIHtcclxuICAgICAgICByZXR1cm47XHJcbiAgICB9XHJcblxyXG4gICAgdmFyIGZldGNoZXIgPSB0aGlzLl9pbWFnZS5nZXRGZXRjaGVyKCk7XHJcbiAgICB2YXIgaXNJbmRpcmVjdENyZWF0aW9uTmVlZGVkID0gaW1hZ2VIZWxwZXJGdW5jdGlvbnMuaXNJbmRpcmVjdENyZWF0aW9uTmVlZGVkKFxyXG4gICAgICAgIGZldGNoZXIsICdmZXRjaGVyJywgRmV0Y2hNYW5hZ2VyLmZldGNoZXJFeHBlY3RlZE1ldGhvZHMpO1xyXG4gICAgXHJcbiAgICBpZiAoIWlzSW5kaXJlY3RDcmVhdGlvbk5lZWRlZCB8fCAhZmV0Y2hlci51c2VXb3JrZXIpIHtcclxuICAgICAgICB0aGlzLl9mZXRjaE1hbmFnZXIgPSBuZXcgRmV0Y2hNYW5hZ2VyKGZldGNoZXIsIHRoaXMuX29wdGlvbnMpO1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgICB0aGlzLl9mZXRjaE1hbmFnZXIgPSBuZXcgV29ya2VyUHJveHlGZXRjaE1hbmFnZXIoXHJcbiAgICAgICAgICAgIGZldGNoZXIsIHRoaXMuX29wdGlvbnMpO1xyXG4gICAgfVxyXG59O1xyXG5cclxuSW1hZ2VEZWNvZGVyLnByb3RvdHlwZS5fdmFsaWRhdGVEZWNvZGVyID0gZnVuY3Rpb24gdmFsaWRhdGVDb21wb25lbnRzKCkge1xyXG4gICAgaWYgKHRoaXMuX2RlY29kZURlcGVuZGVuY3lXb3JrZXJzICE9PSBudWxsKSB7XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICB2YXIgZGVjb2RlU2NoZWR1bGluZyA9IGltYWdlSGVscGVyRnVuY3Rpb25zLmNyZWF0ZVByaW9yaXRpemVyKFxyXG4gICAgICAgIHRoaXMuX2RlY29kZVdvcmtlcnNMaW1pdCxcclxuICAgICAgICB0aGlzLl9wcmlvcml0aXplclR5cGUsXHJcbiAgICAgICAgJ2RlY29kZScsXHJcbiAgICAgICAgdGhpcy5fc2hvd0xvZyk7XHJcblx0XHJcblx0aWYgKGRlY29kZVNjaGVkdWxpbmcucHJpb3JpdGl6ZXIgIT09IG51bGwpIHtcclxuXHRcdHRoaXMuX2RlY29kZVNjaGVkdWxlciA9IG5ldyBkZXBlbmRlbmN5V29ya2Vycy5EZXBlbmRlbmN5V29ya2Vyc1Rhc2tTY2hlZHVsZXIoXHJcblx0XHRcdHRoaXMuX2RlY29kZVdvcmtlcnNMaW1pdCwgZGVjb2RlU2NoZWR1bGluZy5zY2hlZHVsZXJPcHRpb25zKTtcclxuXHRcdHRoaXMuX2RlY29kZVByaW9yaXRpemVyID0gZGVjb2RlU2NoZWR1bGluZy5wcmlvcml0aXplcjtcclxuXHR9IGVsc2Uge1xyXG5cdFx0dGhpcy5fZGVjb2RlU2NoZWR1bGVyID0gbmV3IHJlc291cmNlU2NoZWR1bGVyLkxpZm9TY2hlZHVsZXIoXHJcblx0XHRcdGNyZWF0ZUR1bW15UmVzb3VyY2UsXHJcblx0XHRcdHRoaXMuX2RlY29kZVdvcmtlcnNMaW1pdCxcclxuXHRcdFx0ZGVjb2RlU2NoZWR1bGluZy5zY2hlZHVsZXJPcHRpb25zKTtcclxuXHRcdHRoaXMuX2RlY29kZVByaW9yaXRpemVyID0gbnVsbDtcclxuXHR9XHJcblxyXG5cdHZhciBpbnB1dFJldHJlaXZlciA9IHRoaXMuX2ltYWdlLmdldERlY29kZXJXb3JrZXJzSW5wdXRSZXRyZWl2ZXIoKTtcclxuXHR0aGlzLl9kZWNvZGVEZXBlbmRlbmN5V29ya2VycyA9IG5ldyBkZXBlbmRlbmN5V29ya2Vycy5TY2hlZHVsZXJEZXBlbmRlbmN5V29ya2VycyhcclxuXHRcdHRoaXMuX2RlY29kZVNjaGVkdWxlciwgaW5wdXRSZXRyZWl2ZXIpO1xyXG4gICAgXHJcbiAgICB0aGlzLl9yZXF1ZXN0c0RlY29kZUpvYnNQb29sID0gbmV3IERlY29kZUpvYnNQb29sKFxyXG4gICAgICAgIHRoaXMuX2RlY29kZURlcGVuZGVuY3lXb3JrZXJzLFxyXG5cdFx0dGhpcy5fZGVjb2RlUHJpb3JpdGl6ZXIsXHJcbiAgICAgICAgdGhpcy5fdGlsZVdpZHRoLFxyXG4gICAgICAgIHRoaXMuX3RpbGVIZWlnaHQpO1xyXG4gICAgICAgIFxyXG4gICAgdGhpcy5fbW92YWJsZXNEZWNvZGVKb2JzUG9vbCA9IG5ldyBEZWNvZGVKb2JzUG9vbChcclxuICAgICAgICB0aGlzLl9kZWNvZGVEZXBlbmRlbmN5V29ya2VycyxcclxuXHRcdHRoaXMuX2RlY29kZVByaW9yaXRpemVyLFxyXG4gICAgICAgIHRoaXMuX3RpbGVXaWR0aCxcclxuICAgICAgICB0aGlzLl90aWxlSGVpZ2h0KTtcclxufTtcclxuXHJcbkltYWdlRGVjb2Rlci5wcm90b3R5cGUuX2dldEltYWdlUGFyYW1zSW50ZXJuYWwgPSBmdW5jdGlvbiBnZXRJbWFnZVBhcmFtc0ludGVybmFsKCkge1xyXG4gICAgcmV0dXJuIHRoaXMuX2ludGVybmFsU2l6ZXNQYXJhbXM7XHJcbn07XHJcblxyXG5JbWFnZURlY29kZXIucHJvdG90eXBlLl9jb3B5UGl4ZWxzVG9BY2N1bXVsYXRlZFJlc3VsdCA9XHJcbiAgICBmdW5jdGlvbiBjb3B5UGl4ZWxzVG9BY2N1bXVsYXRlZFJlc3VsdChkZWNvZGVkRGF0YSwgYWNjdW11bGF0ZWRSZXN1bHQpIHtcclxuICAgICAgICBcclxuICAgIHZhciBieXRlc1BlclBpeGVsID0gNDtcclxuICAgIHZhciBzb3VyY2VTdHJpZGUgPSBkZWNvZGVkRGF0YS53aWR0aCAqIGJ5dGVzUGVyUGl4ZWw7XHJcbiAgICB2YXIgdGFyZ2V0U3RyaWRlID1cclxuICAgICAgICBkZWNvZGVkRGF0YS5vcmlnaW5hbFJlcXVlc3RXaWR0aCAqIGJ5dGVzUGVyUGl4ZWw7XHJcbiAgICBcclxuICAgIGlmIChhY2N1bXVsYXRlZFJlc3VsdC5waXhlbHMgPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIHZhciBzaXplID1cclxuICAgICAgICAgICAgdGFyZ2V0U3RyaWRlICogZGVjb2RlZERhdGEub3JpZ2luYWxSZXF1ZXN0SGVpZ2h0O1xyXG4gICAgICAgICAgICBcclxuICAgICAgICBhY2N1bXVsYXRlZFJlc3VsdC5waXhlbHMgPSBuZXcgVWludDhBcnJheShzaXplKTtcclxuICAgICAgICBhY2N1bXVsYXRlZFJlc3VsdC54SW5PcmlnaW5hbFJlcXVlc3QgPSAwO1xyXG4gICAgICAgIGFjY3VtdWxhdGVkUmVzdWx0LnlJbk9yaWdpbmFsUmVxdWVzdCA9IDA7XHJcbiAgICAgICAgXHJcbiAgICAgICAgdmFyIHdpZHRoID0gZGVjb2RlZERhdGEub3JpZ2luYWxSZXF1ZXN0V2lkdGg7XHJcbiAgICAgICAgYWNjdW11bGF0ZWRSZXN1bHQub3JpZ2luYWxSZXF1ZXN0V2lkdGggPSB3aWR0aDtcclxuICAgICAgICBhY2N1bXVsYXRlZFJlc3VsdC53aWR0aCA9IHdpZHRoO1xyXG5cclxuICAgICAgICB2YXIgaGVpZ2h0ID0gZGVjb2RlZERhdGEub3JpZ2luYWxSZXF1ZXN0SGVpZ2h0O1xyXG4gICAgICAgIGFjY3VtdWxhdGVkUmVzdWx0Lm9yaWdpbmFsUmVxdWVzdEhlaWdodCA9IGhlaWdodDtcclxuICAgICAgICBhY2N1bXVsYXRlZFJlc3VsdC5oZWlnaHQgPSBoZWlnaHQ7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGFjY3VtdWxhdGVkUmVzdWx0LmFsbFJlbGV2YW50Qnl0ZXNMb2FkZWQgPVxyXG4gICAgICAgIGRlY29kZWREYXRhLmFsbFJlbGV2YW50Qnl0ZXNMb2FkZWQ7XHJcblxyXG4gICAgdmFyIHNvdXJjZU9mZnNldCA9IDA7XHJcbiAgICB2YXIgdGFyZ2V0T2Zmc2V0ID1cclxuICAgICAgICBkZWNvZGVkRGF0YS54SW5PcmlnaW5hbFJlcXVlc3QgKiBieXRlc1BlclBpeGVsICsgXHJcbiAgICAgICAgZGVjb2RlZERhdGEueUluT3JpZ2luYWxSZXF1ZXN0ICogdGFyZ2V0U3RyaWRlO1xyXG4gICAgXHJcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IGRlY29kZWREYXRhLmhlaWdodDsgKytpKSB7XHJcbiAgICAgICAgdmFyIHNvdXJjZVN1YkFycmF5ID0gZGVjb2RlZERhdGEucGl4ZWxzLnN1YmFycmF5KFxyXG4gICAgICAgICAgICBzb3VyY2VPZmZzZXQsIHNvdXJjZU9mZnNldCArIHNvdXJjZVN0cmlkZSk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgYWNjdW11bGF0ZWRSZXN1bHQucGl4ZWxzLnNldChzb3VyY2VTdWJBcnJheSwgdGFyZ2V0T2Zmc2V0KTtcclxuICAgICAgICBcclxuICAgICAgICBzb3VyY2VPZmZzZXQgKz0gc291cmNlU3RyaWRlO1xyXG4gICAgICAgIHRhcmdldE9mZnNldCArPSB0YXJnZXRTdHJpZGU7XHJcbiAgICB9XHJcbn07XHJcblxyXG5mdW5jdGlvbiBjcmVhdGVEdW1teVJlc291cmNlKClcclxue1xyXG59IiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxudmFyIEltYWdlVmlld2VyID0gcmVxdWlyZSgnaW1hZ2UtZGVjb2Rlci12aWV3ZXIuanMnKTtcclxudmFyIGNhbGN1bGF0ZUxlYWZsZXRGcnVzdHVtID0gcmVxdWlyZSgnbGVhZmxldC1mcnVzdHVtLWNhbGN1bGF0b3IuanMnKTtcclxuXHJcbi8qIGdsb2JhbCBMOiBmYWxzZSAqL1xyXG4vKiBnbG9iYWwgc2VsZjogZmFsc2UgKi9cclxuXHJcbmlmIChzZWxmLkwpIHtcclxuICAgIG1vZHVsZS5leHBvcnRzID0gTC5DbGFzcy5leHRlbmQoY3JlYXRlSW1hZ2VEZWNvZGVyUmVnaW9uTGF5ZXJGdW5jdGlvbnMoKSk7XHJcbn0gZWxzZSB7XHJcbiAgICBtb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uKCkge1xyXG4gICAgICAgIHRocm93IG5ldyBFcnJvcignaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBDYW5ub3QgaW5zdGFudGlhdGUgSW1hZ2VEZWNvZGVyUmVnaW9uTGF5ZXI6IE5vIExlYWZsZXQgbmFtZXNwYWNlIGluIHNjb3BlJyk7XHJcbiAgICB9O1xyXG59XHJcblxyXG5mdW5jdGlvbiBjcmVhdGVJbWFnZURlY29kZXJSZWdpb25MYXllckZ1bmN0aW9ucygpIHtcclxuICAgIHJldHVybiB7XHJcbiAgICAgICAgaW5pdGlhbGl6ZTogZnVuY3Rpb24gaW5pdGlhbGl6ZShvcHRpb25zKSB7XHJcbiAgICAgICAgICAgIHRoaXMuX29wdGlvbnMgPSBvcHRpb25zIHx8IHt9O1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgaWYgKHRoaXMuX29wdGlvbnMubGF0TG5nQm91bmRzICE9PSB1bmRlZmluZWQpIHtcclxuICAgICAgICAgICAgICAgIHRoaXMuX29wdGlvbnMgPSB7fTtcclxuICAgICAgICAgICAgICAgIGZvciAodmFyIG1lbWJlciBpbiBvcHRpb25zKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5fb3B0aW9uc1ttZW1iZXJdID0gb3B0aW9uc1ttZW1iZXJdO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgdGhpcy5fb3B0aW9ucy5jYXJ0b2dyYXBoaWNCb3VuZHMgPSB7XHJcbiAgICAgICAgICAgICAgICAgICAgd2VzdDogb3B0aW9ucy5sYXRMbmdCb3VuZHMuZ2V0V2VzdCgpLFxyXG4gICAgICAgICAgICAgICAgICAgIGVhc3Q6IG9wdGlvbnMubGF0TG5nQm91bmRzLmdldEVhc3QoKSxcclxuICAgICAgICAgICAgICAgICAgICBzb3V0aDogb3B0aW9ucy5sYXRMbmdCb3VuZHMuZ2V0U291dGgoKSxcclxuICAgICAgICAgICAgICAgICAgICBub3J0aDogb3B0aW9ucy5sYXRMbmdCb3VuZHMuZ2V0Tm9ydGgoKVxyXG4gICAgICAgICAgICAgICAgfTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgdGhpcy5fdGFyZ2V0Q2FudmFzID0gbnVsbDtcclxuICAgICAgICAgICAgdGhpcy5fY2FudmFzUG9zaXRpb24gPSBudWxsO1xyXG4gICAgICAgICAgICB0aGlzLl9jYW52YXNVcGRhdGVkQ2FsbGJhY2tCb3VuZCA9IHRoaXMuX2NhbnZhc1VwZGF0ZWRDYWxsYmFjay5iaW5kKHRoaXMpO1xyXG4gICAgICAgICAgICB0aGlzLl9pbWFnZVZpZXdlciA9IG51bGw7XHJcbiAgICAgICAgICAgIHRoaXMuX2V4Y2VwdGlvbkNhbGxiYWNrID0gbnVsbDtcclxuICAgICAgICB9LFxyXG4gICAgICAgIFxyXG4gICAgICAgIHNldEV4Y2VwdGlvbkNhbGxiYWNrOiBmdW5jdGlvbiBzZXRFeGNlcHRpb25DYWxsYmFjayhleGNlcHRpb25DYWxsYmFjaykge1xyXG4gICAgICAgICAgICB0aGlzLl9leGNlcHRpb25DYWxsYmFjayA9IGV4Y2VwdGlvbkNhbGxiYWNrO1xyXG4gICAgICAgICAgICBpZiAodGhpcy5faW1hZ2VWaWV3ZXIgIT09IG51bGwpIHtcclxuICAgICAgICAgICAgICAgIHRoaXMuX2ltYWdlVmlld2VyLnNldEV4Y2VwdGlvbkNhbGxiYWNrKGV4Y2VwdGlvbkNhbGxiYWNrKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH0sXHJcbiAgICAgICAgXHJcbiAgICAgICAgX2NyZWF0ZUltYWdlOiBmdW5jdGlvbiBjcmVhdGVJbWFnZSgpIHtcclxuICAgICAgICAgICAgaWYgKHRoaXMuX2ltYWdlVmlld2VyID09PSBudWxsKSB7XHJcbiAgICAgICAgICAgICAgICB0aGlzLl9pbWFnZVZpZXdlciA9IG5ldyBJbWFnZVZpZXdlcihcclxuICAgICAgICAgICAgICAgICAgICB0aGlzLl9vcHRpb25zLmltYWdlRGVjb2RlcixcclxuICAgICAgICAgICAgICAgICAgICB0aGlzLl9jYW52YXNVcGRhdGVkQ2FsbGJhY2tCb3VuZCxcclxuICAgICAgICAgICAgICAgICAgICB0aGlzLl9vcHRpb25zKTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgaWYgKHRoaXMuX2V4Y2VwdGlvbkNhbGxiYWNrICE9PSBudWxsKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5faW1hZ2VWaWV3ZXIuc2V0RXhjZXB0aW9uQ2FsbGJhY2sodGhpcy5fZXhjZXB0aW9uQ2FsbGJhY2spO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICB0aGlzLl9pbWFnZVZpZXdlci5vcGVuKHRoaXMuX29wdGlvbnMudXJsKS5jYXRjaCh0aGlzLl9leGNlcHRpb25DYWxsYmFjayk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9LFxyXG5cclxuICAgICAgICBvbkFkZDogZnVuY3Rpb24gb25BZGQobWFwKSB7XHJcbiAgICAgICAgICAgIGlmICh0aGlzLl9tYXAgIT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgICAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogQ2Fubm90IGFkZCB0aGlzIGxheWVyIHRvIHR3byBtYXBzJztcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgdGhpcy5fbWFwID0gbWFwO1xyXG4gICAgICAgICAgICB0aGlzLl9jcmVhdGVJbWFnZSgpO1xyXG5cclxuICAgICAgICAgICAgLy8gY3JlYXRlIGEgRE9NIGVsZW1lbnQgYW5kIHB1dCBpdCBpbnRvIG9uZSBvZiB0aGUgbWFwIHBhbmVzXHJcbiAgICAgICAgICAgIHRoaXMuX3RhcmdldENhbnZhcyA9IEwuRG9tVXRpbC5jcmVhdGUoXHJcbiAgICAgICAgICAgICAgICAnY2FudmFzJywgJ2ltYWdlLWRlY29kZXItbGF5ZXItY2FudmFzIGxlYWZsZXQtem9vbS1hbmltYXRlZCcpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgdGhpcy5faW1hZ2VWaWV3ZXIuc2V0VGFyZ2V0Q2FudmFzKHRoaXMuX3RhcmdldENhbnZhcyk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICB0aGlzLl9jYW52YXNQb3NpdGlvbiA9IG51bGw7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgbWFwLmdldFBhbmVzKCkubWFwUGFuZS5hcHBlbmRDaGlsZCh0aGlzLl90YXJnZXRDYW52YXMpO1xyXG5cclxuICAgICAgICAgICAgLy8gYWRkIGEgdmlld3Jlc2V0IGV2ZW50IGxpc3RlbmVyIGZvciB1cGRhdGluZyBsYXllcidzIHBvc2l0aW9uLCBkbyB0aGUgbGF0dGVyXHJcbiAgICAgICAgICAgIG1hcC5vbigndmlld3Jlc2V0JywgdGhpcy5fbW92ZWQsIHRoaXMpO1xyXG4gICAgICAgICAgICBtYXAub24oJ21vdmUnLCB0aGlzLl9tb3ZlZCwgdGhpcyk7XHJcblxyXG4gICAgICAgICAgICBpZiAoTC5Ccm93c2VyLmFueTNkKSB7XHJcbiAgICAgICAgICAgICAgICBtYXAub24oJ3pvb21hbmltJywgdGhpcy5fYW5pbWF0ZVpvb20sIHRoaXMpO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICB0aGlzLl9tb3ZlZCgpO1xyXG4gICAgICAgIH0sXHJcblxyXG4gICAgICAgIG9uUmVtb3ZlOiBmdW5jdGlvbiBvblJlbW92ZShtYXApIHtcclxuICAgICAgICAgICAgaWYgKG1hcCAhPT0gdGhpcy5fbWFwKSB7XHJcbiAgICAgICAgICAgICAgICB0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBSZW1vdmVkIGZyb20gd3JvbmcgbWFwJztcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgbWFwLm9mZigndmlld3Jlc2V0JywgdGhpcy5fbW92ZWQsIHRoaXMpO1xyXG4gICAgICAgICAgICBtYXAub2ZmKCdtb3ZlJywgdGhpcy5fbW92ZWQsIHRoaXMpO1xyXG4gICAgICAgICAgICBtYXAub2ZmKCd6b29tYW5pbScsIHRoaXMuX2FuaW1hdGVab29tLCB0aGlzKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIHJlbW92ZSBsYXllcidzIERPTSBlbGVtZW50cyBhbmQgbGlzdGVuZXJzXHJcbiAgICAgICAgICAgIG1hcC5nZXRQYW5lcygpLm1hcFBhbmUucmVtb3ZlQ2hpbGQodGhpcy5fdGFyZ2V0Q2FudmFzKTtcclxuICAgICAgICAgICAgdGhpcy5fdGFyZ2V0Q2FudmFzID0gbnVsbDtcclxuICAgICAgICAgICAgdGhpcy5fY2FudmFzUG9zaXRpb24gPSBudWxsO1xyXG5cclxuICAgICAgICAgICAgdGhpcy5fbWFwID0gdW5kZWZpbmVkO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgdGhpcy5faW1hZ2VWaWV3ZXIuY2xvc2UoKTtcclxuICAgICAgICAgICAgdGhpcy5faW1hZ2VWaWV3ZXIgPSBudWxsO1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgXHJcbiAgICAgICAgX21vdmVkOiBmdW5jdGlvbiAoKSB7XHJcbiAgICAgICAgICAgIHRoaXMuX21vdmVDYW52YXNlcygpO1xyXG5cclxuICAgICAgICAgICAgdmFyIGZydXN0dW1EYXRhID0gY2FsY3VsYXRlTGVhZmxldEZydXN0dW0odGhpcy5fbWFwKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHRoaXMuX2ltYWdlVmlld2VyLnVwZGF0ZVZpZXdBcmVhKGZydXN0dW1EYXRhKTtcclxuICAgICAgICB9LFxyXG4gICAgICAgIFxyXG4gICAgICAgIF9jYW52YXNVcGRhdGVkQ2FsbGJhY2s6IGZ1bmN0aW9uIGNhbnZhc1VwZGF0ZWRDYWxsYmFjayhuZXdQb3NpdGlvbikge1xyXG4gICAgICAgICAgICBpZiAobmV3UG9zaXRpb24gIT09IG51bGwpIHtcclxuICAgICAgICAgICAgICAgIHRoaXMuX2NhbnZhc1Bvc2l0aW9uID0gbmV3UG9zaXRpb247XHJcbiAgICAgICAgICAgICAgICB0aGlzLl9tb3ZlQ2FudmFzZXMoKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH0sXHJcbiAgICAgICAgXHJcbiAgICAgICAgX21vdmVDYW52YXNlczogZnVuY3Rpb24gbW92ZUNhbnZhc2VzKCkge1xyXG4gICAgICAgICAgICBpZiAodGhpcy5fY2FudmFzUG9zaXRpb24gPT09IG51bGwpIHtcclxuICAgICAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgICAgICAvLyB1cGRhdGUgbGF5ZXIncyBwb3NpdGlvblxyXG4gICAgICAgICAgICB2YXIgd2VzdCA9IHRoaXMuX2NhbnZhc1Bvc2l0aW9uLndlc3Q7XHJcbiAgICAgICAgICAgIHZhciBlYXN0ID0gdGhpcy5fY2FudmFzUG9zaXRpb24uZWFzdDtcclxuICAgICAgICAgICAgdmFyIHNvdXRoID0gdGhpcy5fY2FudmFzUG9zaXRpb24uc291dGg7XHJcbiAgICAgICAgICAgIHZhciBub3J0aCA9IHRoaXMuX2NhbnZhc1Bvc2l0aW9uLm5vcnRoO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgdmFyIHRvcExlZnQgPSB0aGlzLl9tYXAubGF0TG5nVG9MYXllclBvaW50KFtub3J0aCwgd2VzdF0pO1xyXG4gICAgICAgICAgICB2YXIgYm90dG9tUmlnaHQgPSB0aGlzLl9tYXAubGF0TG5nVG9MYXllclBvaW50KFtzb3V0aCwgZWFzdF0pO1xyXG4gICAgICAgICAgICB2YXIgc2l6ZSA9IGJvdHRvbVJpZ2h0LnN1YnRyYWN0KHRvcExlZnQpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgTC5Eb21VdGlsLnNldFBvc2l0aW9uKHRoaXMuX3RhcmdldENhbnZhcywgdG9wTGVmdCk7XHJcbiAgICAgICAgICAgIHRoaXMuX3RhcmdldENhbnZhcy5zdHlsZS53aWR0aCA9IHNpemUueCArICdweCc7XHJcbiAgICAgICAgICAgIHRoaXMuX3RhcmdldENhbnZhcy5zdHlsZS5oZWlnaHQgPSBzaXplLnkgKyAncHgnO1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgXHJcbiAgICAgICAgX2FuaW1hdGVab29tOiBmdW5jdGlvbiBhbmltYXRlWm9vbShvcHRpb25zKSB7XHJcbiAgICAgICAgICAgIGlmICh0aGlzLl9jYW52YXNQb3NpdGlvbiA9PT0gbnVsbCkge1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIE5PVEU6IEFsbCBtZXRob2QgKGluY2x1ZGluZyB1c2luZyBvZiBwcml2YXRlIG1ldGhvZFxyXG4gICAgICAgICAgICAvLyBfbGF0TG5nVG9OZXdMYXllclBvaW50KSB3YXMgY29waWVkIGZyb20gSW1hZ2VPdmVybGF5LFxyXG4gICAgICAgICAgICAvLyBhcyBMZWFmbGV0IGRvY3VtZW50YXRpb24gcmVjb21tZW5kcy5cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHZhciB3ZXN0ID0gIHRoaXMuX2NhbnZhc1Bvc2l0aW9uLndlc3Q7XHJcbiAgICAgICAgICAgIHZhciBlYXN0ID0gIHRoaXMuX2NhbnZhc1Bvc2l0aW9uLmVhc3Q7XHJcbiAgICAgICAgICAgIHZhciBzb3V0aCA9IHRoaXMuX2NhbnZhc1Bvc2l0aW9uLnNvdXRoO1xyXG4gICAgICAgICAgICB2YXIgbm9ydGggPSB0aGlzLl9jYW52YXNQb3NpdGlvbi5ub3J0aDtcclxuXHJcbiAgICAgICAgICAgIHZhciB0b3BMZWZ0ID0gdGhpcy5fbWFwLl9sYXRMbmdUb05ld0xheWVyUG9pbnQoXHJcbiAgICAgICAgICAgICAgICBbbm9ydGgsIHdlc3RdLCBvcHRpb25zLnpvb20sIG9wdGlvbnMuY2VudGVyKTtcclxuICAgICAgICAgICAgdmFyIGJvdHRvbVJpZ2h0ID0gdGhpcy5fbWFwLl9sYXRMbmdUb05ld0xheWVyUG9pbnQoXHJcbiAgICAgICAgICAgICAgICBbc291dGgsIGVhc3RdLCBvcHRpb25zLnpvb20sIG9wdGlvbnMuY2VudGVyKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHZhciBzY2FsZSA9IHRoaXMuX21hcC5nZXRab29tU2NhbGUob3B0aW9ucy56b29tKTtcclxuICAgICAgICAgICAgdmFyIHNpemUgPSBib3R0b21SaWdodC5zdWJ0cmFjdCh0b3BMZWZ0KTtcclxuICAgICAgICAgICAgdmFyIHNpemVTY2FsZWQgPSBzaXplLm11bHRpcGx5QnkoKDEgLyAyKSAqICgxIC0gMSAvIHNjYWxlKSk7XHJcbiAgICAgICAgICAgIHZhciBvcmlnaW4gPSB0b3BMZWZ0LmFkZChzaXplU2NhbGVkKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHRoaXMuX3RhcmdldENhbnZhcy5zdHlsZVtMLkRvbVV0aWwuVFJBTlNGT1JNXSA9XHJcbiAgICAgICAgICAgICAgICBMLkRvbVV0aWwuZ2V0VHJhbnNsYXRlU3RyaW5nKG9yaWdpbikgKyAnIHNjYWxlKCcgKyBzY2FsZSArICcpICc7XHJcbiAgICAgICAgfVxyXG4gICAgfTtcclxufSIsIid1c2Ugc3RyaWN0JztcclxuXHJcbnZhciBpbWFnZUhlbHBlckZ1bmN0aW9ucyA9IHJlcXVpcmUoJ2ltYWdlLWhlbHBlci1mdW5jdGlvbnMuanMnKTtcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gY2FsY3VsYXRlTGVhZmxldEZydXN0dW0obGVhZmxldE1hcCkge1xyXG4gICAgdmFyIHNjcmVlblNpemUgPSBsZWFmbGV0TWFwLmdldFNpemUoKTtcclxuICAgIHZhciBib3VuZHMgPSBsZWFmbGV0TWFwLmdldEJvdW5kcygpO1xyXG5cclxuICAgIHZhciBjYXJ0b2dyYXBoaWNCb3VuZHMgPSB7XHJcbiAgICAgICAgd2VzdDogYm91bmRzLmdldFdlc3QoKSxcclxuICAgICAgICBlYXN0OiBib3VuZHMuZ2V0RWFzdCgpLFxyXG4gICAgICAgIHNvdXRoOiBib3VuZHMuZ2V0U291dGgoKSxcclxuICAgICAgICBub3J0aDogYm91bmRzLmdldE5vcnRoKClcclxuICAgIH07XHJcbiAgICBcclxuICAgIHZhciBmcnVzdHVtRGF0YSA9IGltYWdlSGVscGVyRnVuY3Rpb25zLmNhbGN1bGF0ZUZydXN0dW0yREZyb21Cb3VuZHMoXHJcbiAgICAgICAgY2FydG9ncmFwaGljQm91bmRzLCBzY3JlZW5TaXplKTtcclxuXHJcbiAgICByZXR1cm4gZnJ1c3R1bURhdGE7XHJcbn07IiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBHcmlkRGVjb2RlcldvcmtlckJhc2U7XHJcblxyXG4vKiBnbG9iYWwgUHJvbWlzZSA6IGZhbHNlICovXHJcbi8qIGdsb2JhbCBJbWFnZURhdGEgOiBmYWxzZSAqL1xyXG5cclxuZnVuY3Rpb24gR3JpZERlY29kZXJXb3JrZXJCYXNlKCkge1xyXG4gICAgR3JpZERlY29kZXJXb3JrZXJCYXNlLnByb3RvdHlwZS5zdGFydCA9IGZ1bmN0aW9uIGRlY29kZShkZWNvZGVySW5wdXQpIHtcclxuICAgICAgICB2YXIgaW1hZ2VQYXJ0UGFyYW1zID0gZGVjb2RlcklucHV0LmltYWdlUGFydFBhcmFtcztcclxuICAgICAgICB2YXIgd2lkdGggID0gaW1hZ2VQYXJ0UGFyYW1zLm1heFhFeGNsdXNpdmUgLSBpbWFnZVBhcnRQYXJhbXMubWluWDtcclxuICAgICAgICB2YXIgaGVpZ2h0ID0gaW1hZ2VQYXJ0UGFyYW1zLm1heFlFeGNsdXNpdmUgLSBpbWFnZVBhcnRQYXJhbXMubWluWTtcclxuICAgICAgICB2YXIgcmVzdWx0ID0gbmV3IEltYWdlRGF0YSh3aWR0aCwgaGVpZ2h0KTtcclxuICAgICAgICB2YXIgcHJvbWlzZXMgPSBbXTtcclxuXHRcdHZhciB0aWxlUG9zaXRpb24gID0ge21pblg6IDAsIG1pblk6IDAsIG1heFhFeGNsdXNpdmU6IDAsIG1heFlFeGNsdXNpdmU6IDAsIHdpZHRoOiBkZWNvZGVySW5wdXQudGlsZVdpZHRoLCBoZWlnaHQ6IGRlY29kZXJJbnB1dC50aWxlSGVpZ2h0fTtcclxuXHRcdHZhciByZWdpb25JbkltYWdlID0ge21pblg6IDAsIG1pblk6IDAsIG1heFhFeGNsdXNpdmU6IDAsIG1heFlFeGNsdXNpdmU6IDAsIHdpZHRoOiAwLCBoZWlnaHQ6IDB9OyBcclxuXHRcdHZhciBvZmZzZXQgPSB7eDogMCwgeTogMH07XHJcblx0XHR2YXIgdGlsZSA9IHt0aWxlWDogMCwgdGlsZVk6IDAsIGxldmVsOiAwLCBwb3NpdGlvbjogdGlsZVBvc2l0aW9uLCBjb250ZW50OiBudWxsfTtcclxuXHRcdGZvciAodmFyIGkgPSAwOyBpIDwgZGVjb2RlcklucHV0LnRpbGVJbmRpY2VzLmxlbmd0aDsgKytpKSB7XHJcblx0XHRcdHRpbGVQb3NpdGlvbi5taW5YICAgICAgICAgID0gZGVjb2RlcklucHV0LnRpbGVJbmRpY2VzW2ldLnRpbGVYICogZGVjb2RlcklucHV0LnRpbGVXaWR0aCA7XHJcblx0XHRcdHRpbGVQb3NpdGlvbi5taW5ZICAgICAgICAgID0gZGVjb2RlcklucHV0LnRpbGVJbmRpY2VzW2ldLnRpbGVZICogZGVjb2RlcklucHV0LnRpbGVIZWlnaHQ7XHJcblx0XHRcdHRpbGVQb3NpdGlvbi5tYXhYRXhjbHVzaXZlID0gdGlsZVBvc2l0aW9uLm1pblggKyBkZWNvZGVySW5wdXQudGlsZVdpZHRoO1xyXG5cdFx0XHR0aWxlUG9zaXRpb24ubWF4WUV4Y2x1c2l2ZSA9IHRpbGVQb3NpdGlvbi5taW5ZICsgZGVjb2RlcklucHV0LnRpbGVIZWlnaHQ7XHJcblx0XHRcdFxyXG5cdFx0XHRyZWdpb25JbkltYWdlLm1pblggICAgICAgICAgPSBNYXRoLm1heCh0aWxlUG9zaXRpb24ubWluWCwgaW1hZ2VQYXJ0UGFyYW1zLm1pblgpO1xyXG5cdFx0XHRyZWdpb25JbkltYWdlLm1pblkgICAgICAgICAgPSBNYXRoLm1heCh0aWxlUG9zaXRpb24ubWluWSwgaW1hZ2VQYXJ0UGFyYW1zLm1pblkpO1xyXG5cdFx0XHRyZWdpb25JbkltYWdlLm1heFhFeGNsdXNpdmUgPSBNYXRoLm1pbih0aWxlUG9zaXRpb24ubWF4WEV4Y2x1c2l2ZSwgaW1hZ2VQYXJ0UGFyYW1zLm1heFhFeGNsdXNpdmUpO1xyXG5cdFx0XHRyZWdpb25JbkltYWdlLm1heFlFeGNsdXNpdmUgPSBNYXRoLm1pbih0aWxlUG9zaXRpb24ubWF4WUV4Y2x1c2l2ZSwgaW1hZ2VQYXJ0UGFyYW1zLm1heFlFeGNsdXNpdmUpO1xyXG5cdFx0XHRyZWdpb25JbkltYWdlLndpZHRoICAgICAgICAgPSByZWdpb25JbkltYWdlLm1heFhFeGNsdXNpdmUgLSByZWdpb25JbkltYWdlLm1pblg7XHJcblx0XHRcdHJlZ2lvbkluSW1hZ2UuaGVpZ2h0ICAgICAgICA9IHJlZ2lvbkluSW1hZ2UubWF4WUV4Y2x1c2l2ZSAtIHJlZ2lvbkluSW1hZ2UubWluWTtcclxuXHRcdFx0XHJcblx0XHRcdG9mZnNldC54ID0gcmVnaW9uSW5JbWFnZS5taW5YIC0gaW1hZ2VQYXJ0UGFyYW1zLm1pblg7XHJcblx0XHRcdG9mZnNldC55ID0gcmVnaW9uSW5JbWFnZS5taW5ZIC0gaW1hZ2VQYXJ0UGFyYW1zLm1pblk7XHJcblx0XHRcdFxyXG5cdFx0XHR0aWxlLnRpbGVZID0gZGVjb2RlcklucHV0LnRpbGVJbmRpY2VzW2ldLnRpbGVZO1xyXG5cdFx0XHR0aWxlLnRpbGVYID0gZGVjb2RlcklucHV0LnRpbGVJbmRpY2VzW2ldLnRpbGVYO1xyXG5cdFx0XHR0aWxlLmxldmVsID0gZGVjb2RlcklucHV0LnRpbGVJbmRpY2VzW2ldLmxldmVsO1xyXG5cdFx0XHR0aWxlLmNvbnRlbnQgPSBkZWNvZGVySW5wdXQudGlsZUNvbnRlbnRzW2ldO1xyXG4gICAgICAgICAgICBwcm9taXNlcy5wdXNoKHRoaXMuZGVjb2RlUmVnaW9uKHJlc3VsdCwgb2Zmc2V0LCByZWdpb25JbkltYWdlLCB0aWxlKSk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHJldHVybiBQcm9taXNlLmFsbChwcm9taXNlcykudGhlbihmdW5jdGlvbigpIHtcclxuICAgICAgICAgICAgcmV0dXJuIHJlc3VsdDtcclxuICAgICAgICB9KTtcclxuICAgIH07XHJcbiAgICBcclxuICAgIEdyaWREZWNvZGVyV29ya2VyQmFzZS5wcm90b3R5cGUuZGVjb2RlUmVnaW9uID0gZnVuY3Rpb24gZGVjb2RlUmVnaW9uKHRhcmdldEltYWdlRGF0YSwgaW1hZ2VQYXJ0UGFyYW1zLCBrZXksIGZldGNoZWREYXRhKSB7XHJcbiAgICAgICAgdGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogZGVjb2RlUmVnaW9uIGlzIG5vdCBpbXBsZW1lbnRlZCc7XHJcbiAgICB9O1xyXG59IiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBHcmlkRmV0Y2hlckJhc2U7XHJcblxyXG52YXIgU2ltcGxlRmV0Y2hlckJhc2UgPSByZXF1aXJlKCdzaW1wbGUtZmV0Y2hlci1iYXNlLmpzJyk7XHJcbnZhciBHcmlkSW1hZ2VCYXNlID0gcmVxdWlyZSgnZ3JpZC1pbWFnZS1iYXNlLmpzJyk7XHJcbnZhciBMaW5rZWRMaXN0ID0gcmVxdWlyZSgnbGlua2VkLWxpc3QuanMnKTtcclxuXHJcbi8qIGdsb2JhbCBQcm9taXNlOiBmYWxzZSAqL1xyXG5cclxuZnVuY3Rpb24gR3JpZEZldGNoZXJCYXNlKG9wdGlvbnMpIHtcclxuXHRTaW1wbGVGZXRjaGVyQmFzZS5jYWxsKHRoaXMsIG9wdGlvbnMpO1xyXG5cdHRoaXMuX2dyaWRGZXRjaGVyQmFzZUNhY2hlID0gW107XHJcblx0dGhpcy5fZXZlbnRzID0ge1xyXG5cdFx0J2RhdGEnOiBbXSxcclxuXHRcdCd0aWxlLXRlcm1pbmF0ZWQnOiBbXVxyXG5cdH07XHJcbn1cclxuXHJcbkdyaWRGZXRjaGVyQmFzZS5wcm90b3R5cGUgPSBPYmplY3QuY3JlYXRlKFNpbXBsZUZldGNoZXJCYXNlLnByb3RvdHlwZSk7XHJcblxyXG5HcmlkRmV0Y2hlckJhc2UucHJvdG90eXBlLmZldGNoVGlsZSA9IGZ1bmN0aW9uKGxldmVsLCB0aWxlWCwgdGlsZVksIGZldGNoVGFzaykge1xyXG5cdHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IEdyaWRGZXRjaGVyQmFzZS5mZXRjaFRpbGUgaXMgbm90IGltcGxlbWVudGVkIGJ5IGluaGVyaXRvcic7XHJcbn07XHJcblxyXG5HcmlkRmV0Y2hlckJhc2UucHJvdG90eXBlLm9uID0gZnVuY3Rpb24oZXZlbnQsIGxpc3RlbmVyKSB7XHJcblx0dmFyIGxpc3RlbmVycyA9IHRoaXMuX2V2ZW50c1tldmVudF07XHJcblx0aWYgKCFsaXN0ZW5lcnMpIHtcclxuXHRcdHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IFVuZXhwZWN0ZWQgZXZlbnQgJyArIGV2ZW50ICsgJyBpbiBHcmlkRmV0Y2hlckJhc2UnO1xyXG5cdH1cclxuXHRsaXN0ZW5lcnMucHVzaChsaXN0ZW5lcik7XHJcbn07XHJcblxyXG5HcmlkRmV0Y2hlckJhc2UucHJvdG90eXBlLnN0YXJ0RmV0Y2ggPSBmdW5jdGlvbiBzdGFydEZldGNoKGZldGNoQ29udGV4dCwgaW1hZ2VQYXJ0UGFyYW1zKSB7XHJcblx0dmFyIGZldGNoRGF0YSA9IHtcclxuXHRcdGFjdGl2ZVRpbGVzQ291bnQ6IDAsXHJcblx0XHRhY3RpdmVUaWxlc0NvdW50V2l0aFNpbmdsZUxpc3RlbmVyOiAwLFxyXG5cdFx0dGlsZUxpc3RlbmVyczogW10sXHJcblx0XHRmZXRjaENvbnRleHQ6IGZldGNoQ29udGV4dCxcclxuXHRcdGlzUGVuZGluZ1N0b3A6IGZhbHNlLFxyXG5cdFx0aXNBY3RpdmU6IGZhbHNlLFxyXG5cdFx0aW1hZ2VQYXJ0UGFyYW1zOiBpbWFnZVBhcnRQYXJhbXMsXHJcblx0XHRzZWxmOiB0aGlzXHJcblx0fTtcclxuXHRcclxuXHRmZXRjaENvbnRleHQub24oJ3N0b3AnLCBvbkZldGNoU3RvcCwgZmV0Y2hEYXRhKTtcclxuXHRmZXRjaENvbnRleHQub24oJ3Jlc3VtZScsIG9uRmV0Y2hSZXN1bWUsIGZldGNoRGF0YSk7XHJcblx0ZmV0Y2hDb250ZXh0Lm9uKCd0ZXJtaW5hdGUnLCBvbkZldGNoVGVybWluYXRlLCBmZXRjaERhdGEpO1xyXG5cclxuXHR2YXIgdGlsZXNUb1N0YXJ0WCA9IFtdO1xyXG5cdHZhciB0aWxlc1RvU3RhcnRZID0gW107XHJcblx0dmFyIHRpbGVzVG9TdGFydERlcGVuZEZldGNoZXMgPSBbXTtcclxuXHRcclxuXHR2YXIgdGlsZXNSYW5nZSA9IEdyaWRJbWFnZUJhc2UuZ2V0VGlsZXNSYW5nZSh0aGlzLmdldEltYWdlUGFyYW1zKCksIGltYWdlUGFydFBhcmFtcyk7XHJcblx0ZmV0Y2hEYXRhLmFjdGl2ZVRpbGVzQ291bnQgPSAodGlsZXNSYW5nZS5tYXhUaWxlWCAtIHRpbGVzUmFuZ2UubWluVGlsZVgpICogKHRpbGVzUmFuZ2UubWF4VGlsZVkgLSB0aWxlc1JhbmdlLm1pblRpbGVZKTtcclxuXHRmb3IgKHZhciB0aWxlWCA9IHRpbGVzUmFuZ2UubWluVGlsZVg7IHRpbGVYIDwgdGlsZXNSYW5nZS5tYXhUaWxlWDsgKyt0aWxlWCkge1xyXG5cdFx0Zm9yICh2YXIgdGlsZVkgPSB0aWxlc1JhbmdlLm1pblRpbGVZOyB0aWxlWSA8IHRpbGVzUmFuZ2UubWF4VGlsZVk7ICsrdGlsZVkpIHtcclxuXHRcdFx0dmFyIGRlcGVuZEZldGNoZXMgPSB0aGlzLl9hZGRUb0NhY2hlKHRpbGVYLCB0aWxlWSwgZmV0Y2hEYXRhKTtcclxuXHRcdFx0aWYgKGRlcGVuZEZldGNoZXMgPT09IG51bGwpIHtcclxuXHRcdFx0XHRjb250aW51ZTtcclxuXHRcdFx0fVxyXG5cclxuXHRcdFx0dGlsZXNUb1N0YXJ0WC5wdXNoKHRpbGVYKTtcclxuXHRcdFx0dGlsZXNUb1N0YXJ0WS5wdXNoKHRpbGVZKTtcclxuXHRcdFx0dGlsZXNUb1N0YXJ0RGVwZW5kRmV0Y2hlcy5wdXNoKGRlcGVuZEZldGNoZXMpO1xyXG5cdFx0fVxyXG5cdH1cclxuXHRcclxuXHRvbkZldGNoUmVzdW1lLmNhbGwoZmV0Y2hEYXRhKTtcclxuXHRcclxuXHRmb3IgKHZhciBpID0gMDsgaSA8IHRpbGVzVG9TdGFydFgubGVuZ3RoOyArK2kpIHtcclxuXHRcdHRoaXMuX2xvYWRUaWxlKGZldGNoRGF0YS5pbWFnZVBhcnRQYXJhbXMubGV2ZWwsIHRpbGVzVG9TdGFydFhbaV0sIHRpbGVzVG9TdGFydFlbaV0sIHRpbGVzVG9TdGFydERlcGVuZEZldGNoZXNbaV0pO1xyXG5cdH1cclxufTtcclxuXHJcbkdyaWRGZXRjaGVyQmFzZS5wcm90b3R5cGUuX2NoZWNrSWZTaG91bGRTdG9wID0gZnVuY3Rpb24gdHJ5U3RvcEZldGNoKGZldGNoRGF0YSkge1xyXG5cdGlmICghZmV0Y2hEYXRhLmlzUGVuZGluZ1N0b3AgfHwgZmV0Y2hEYXRhLmFjdGl2ZVRpbGVzQ291bnRXaXRoU2luZ2xlTGlzdGVuZXIgPiAwKSB7XHJcblx0XHRyZXR1cm47XHJcblx0fVxyXG5cdFxyXG5cdGZldGNoRGF0YS5pc1BlbmRpbmdTdG9wID0gZmFsc2U7XHJcblx0ZmV0Y2hEYXRhLmlzQWN0aXZlID0gZmFsc2U7XHJcblx0dGhpcy5fY2hhbmdlU2luZ2xlTGlzdGVuZXJDb3VudE9mT3ZlcmxhcHBpbmdGZXRjaGVzKGZldGNoRGF0YSwgKzEpO1xyXG5cdGZldGNoRGF0YS5mZXRjaENvbnRleHQuc3RvcHBlZCgpO1xyXG59O1xyXG5cdFxyXG5HcmlkRmV0Y2hlckJhc2UucHJvdG90eXBlLl9jaGFuZ2VTaW5nbGVMaXN0ZW5lckNvdW50T2ZPdmVybGFwcGluZ0ZldGNoZXMgPVxyXG5cdFx0ZnVuY3Rpb24gY2hhbmdlU2luZ2xlTGlzdGVuZXJDb3VudE9mT3ZlcmxhcHBpbmdGZXRjaGVzKGZldGNoRGF0YSwgYWRkVmFsdWUpIHtcclxuXHRcdFx0XHJcblx0Zm9yICh2YXIgaSA9IDA7IGkgPCBmZXRjaERhdGEudGlsZUxpc3RlbmVycy5sZW5ndGg7ICsraSkge1xyXG5cdFx0dmFyIHRpbGVEZXBlbmRGZXRjaGVzID0gZmV0Y2hEYXRhLnRpbGVMaXN0ZW5lcnNbaV0uZGVwZW5kRmV0Y2hlcztcclxuXHRcdHRoaXMuX2NoYW5nZVRpbGVzQ291bnRPZlRpbGVEZXBlbmRGZXRjaGVzKHRpbGVEZXBlbmRGZXRjaGVzLCAvKnNpbmdsZUxpc3RlbmVyQWRkVmFsdWU9Ki9hZGRWYWx1ZSwgLyphY3RpdmVUaWxlc0FkZFZhbHVlPSovMCk7XHJcblx0fVxyXG59O1xyXG5cclxuR3JpZEZldGNoZXJCYXNlLnByb3RvdHlwZS5fY2hhbmdlVGlsZXNDb3VudE9mVGlsZURlcGVuZEZldGNoZXMgPSBmdW5jdGlvbih0aWxlRGVwZW5kRmV0Y2hlcywgc2luZ2xlTGlzdGVuZXJBZGRWYWx1ZSwgYWN0aXZlVGlsZXNBZGRWYWx1ZSkge1xyXG5cdHZhciBzaW5nbGVBY3RpdmVGZXRjaCA9IG51bGw7XHJcblx0dmFyIGhhc0FjdGl2ZUZldGNoZXMgPSBmYWxzZTtcclxuXHR2YXIgaXRlcmF0b3IgPSB0aWxlRGVwZW5kRmV0Y2hlcy5nZXRGaXJzdEl0ZXJhdG9yKCk7XHJcblx0d2hpbGUgKGl0ZXJhdG9yICE9PSBudWxsKSB7XHJcblx0XHR2YXIgZmV0Y2hEYXRhID0gdGlsZURlcGVuZEZldGNoZXMuZ2V0VmFsdWUoaXRlcmF0b3IpO1xyXG5cdFx0aXRlcmF0b3IgPSB0aWxlRGVwZW5kRmV0Y2hlcy5nZXROZXh0SXRlcmF0b3IoaXRlcmF0b3IpO1xyXG5cclxuXHRcdGZldGNoRGF0YS5hY3RpdmVUaWxlc0NvdW50ICs9IGFjdGl2ZVRpbGVzQWRkVmFsdWU7XHJcblx0XHRpZiAoZmV0Y2hEYXRhLmFjdGl2ZVRpbGVzQ291bnQgPT09IDApIHtcclxuXHRcdFx0ZmV0Y2hEYXRhLmlzQWN0aXZlID0gZmFsc2U7XHJcblx0XHRcdGZldGNoRGF0YS5mZXRjaENvbnRleHQuZG9uZSgpO1xyXG5cdFx0fVxyXG5cclxuXHRcdGlmICghZmV0Y2hEYXRhLmlzQWN0aXZlKSB7XHJcblx0XHRcdGNvbnRpbnVlO1xyXG5cdFx0fSBlbHNlIGlmIChzaW5nbGVBY3RpdmVGZXRjaCA9PT0gbnVsbCkge1xyXG5cdFx0XHRzaW5nbGVBY3RpdmVGZXRjaCA9IGZldGNoRGF0YTtcclxuXHRcdFx0aGFzQWN0aXZlRmV0Y2hlcyA9IHRydWU7XHJcblx0XHR9IGVsc2UgaWYgKGhhc0FjdGl2ZUZldGNoZXMpIHtcclxuXHRcdFx0Ly8gTm90IHNpbmdsZSBhbnltb3JlXHJcblx0XHRcdHNpbmdsZUFjdGl2ZUZldGNoID0gbnVsbDtcclxuXHRcdFx0aWYgKCFhY3RpdmVUaWxlc0FkZFZhbHVlKSB7XHJcblx0XHRcdFx0YnJlYWs7XHJcblx0XHRcdH1cclxuXHRcdH1cclxuXHR9XHJcblx0XHJcblx0aWYgKHNpbmdsZUFjdGl2ZUZldGNoICE9PSBudWxsKSB7XHJcblx0XHRzaW5nbGVBY3RpdmVGZXRjaC5hY3RpdmVUaWxlc0NvdW50V2l0aFNpbmdsZUxpc3RlbmVyICs9IHNpbmdsZUxpc3RlbmVyQWRkVmFsdWU7XHJcblx0XHR0aGlzLl9jaGVja0lmU2hvdWxkU3RvcChzaW5nbGVBY3RpdmVGZXRjaCk7XHJcblx0fVxyXG59O1xyXG5cclxuZnVuY3Rpb24gb25GZXRjaFN0b3AoKSB7XHJcblx0LyoganNoaW50IHZhbGlkdGhpczogdHJ1ZSAqL1xyXG5cdHZhciBmZXRjaERhdGEgPSB0aGlzO1xyXG5cclxuXHRmZXRjaERhdGEuaXNQZW5kaW5nU3RvcCA9IHRydWU7XHJcblx0ZmV0Y2hEYXRhLnNlbGYuX2NoZWNrSWZTaG91bGRTdG9wKGZldGNoRGF0YSk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIG9uRmV0Y2hSZXN1bWUoKSB7XHJcblx0LyoganNoaW50IHZhbGlkdGhpczogdHJ1ZSAqL1xyXG5cdHZhciBmZXRjaERhdGEgPSB0aGlzO1xyXG5cdGZldGNoRGF0YS5pc1BlbmRpbmdTdG9wID0gZmFsc2U7XHJcblx0XHJcblx0ZmV0Y2hEYXRhLnNlbGYuX2NoYW5nZVNpbmdsZUxpc3RlbmVyQ291bnRPZk92ZXJsYXBwaW5nRmV0Y2hlcyhmZXRjaERhdGEsIC0xKTtcclxuXHRmZXRjaERhdGEuaXNBY3RpdmUgPSB0cnVlO1xyXG59XHJcblxyXG5mdW5jdGlvbiBvbkZldGNoVGVybWluYXRlKCkge1xyXG5cdC8qIGpzaGludCB2YWxpZHRoaXM6IHRydWUgKi9cclxuXHR2YXIgZmV0Y2hEYXRhID0gdGhpcztcclxuXHRcclxuXHRpZiAoZmV0Y2hEYXRhLmlzQWN0aXZlKSB7XHJcblx0XHR0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBVbmV4cGVjdGVkIGdyaWQgZmV0Y2ggdGVybWluYXRlZCBvZiBhIHN0aWxsIGFjdGl2ZSBmZXRjaCc7XHJcblx0fVxyXG5cdFxyXG5cdGZvciAodmFyIGkgPSAwOyBpIDwgZmV0Y2hEYXRhLnRpbGVMaXN0ZW5lcnMubGVuZ3RoOyArK2kpIHtcclxuXHRcdGZldGNoRGF0YS50aWxlTGlzdGVuZXJzW2ldLmRlcGVuZEZldGNoZXMucmVtb3ZlKGZldGNoRGF0YS50aWxlTGlzdGVuZXJzW2ldLml0ZXJhdG9yKTtcclxuXHR9XHJcbn1cclxuXHJcbkdyaWRGZXRjaGVyQmFzZS5wcm90b3R5cGUuX2xvYWRUaWxlID0gZnVuY3Rpb24gbG9hZFRpbGUobGV2ZWwsIHRpbGVYLCB0aWxlWSwgZGVwZW5kRmV0Y2hlcykge1xyXG5cdHZhciBpc1Rlcm1pbmF0ZWQgPSBmYWxzZTtcclxuXHR2YXIgdGlsZUtleSA9IHtcclxuXHRcdGZldGNoV2FpdFRhc2s6IHRydWUsXHJcblx0XHR0aWxlWDogdGlsZVgsXHJcblx0XHR0aWxlWTogdGlsZVksXHJcblx0XHRsZXZlbDogbGV2ZWxcclxuXHR9O1xyXG5cdFxyXG5cdHZhciBzZWxmID0gdGhpcztcclxuXHR0aGlzLmZldGNoVGlsZShsZXZlbCwgdGlsZVgsIHRpbGVZLCB7XHJcblx0XHRvbkRhdGE6IGZ1bmN0aW9uKHJlc3VsdCkge1xyXG5cdFx0XHRpZiAoaXNUZXJtaW5hdGVkKSB7XHJcblx0XHRcdFx0dGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogYWxyZWFkeSB0ZXJtaW5hdGVkIGluIEdyaWRGZXRjaGVyQmFzZS5mZXRjaFRpbGUoKSc7XHJcblx0XHRcdH1cclxuXHRcdFx0dmFyIGRhdGEgPSB7XHJcblx0XHRcdFx0dGlsZUtleTogdGlsZUtleSxcclxuXHRcdFx0XHR0aWxlQ29udGVudDogcmVzdWx0XHJcblx0XHRcdH07XHJcblx0XHRcdGZvciAodmFyIGkgPSAwOyBpIDwgc2VsZi5fZXZlbnRzLmRhdGEubGVuZ3RoOyArK2kpIHtcclxuXHRcdFx0XHRzZWxmLl9ldmVudHMuZGF0YVtpXShkYXRhKTtcclxuXHRcdFx0fVxyXG5cdFx0fSxcclxuXHRcdFxyXG5cdFx0b25UZXJtaW5hdGVkOiBmdW5jdGlvbigpIHtcclxuXHRcdFx0aWYgKGlzVGVybWluYXRlZCkge1xyXG5cdFx0XHRcdHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IGRvdWJsZSB0ZXJtaW5hdGlvbiBpbiBHcmlkRmV0Y2hlckJhc2UuZmV0Y2hUaWxlKCknO1xyXG5cdFx0XHR9XHJcblx0XHRcdGlmIChzZWxmLl9ncmlkRmV0Y2hlckJhc2VDYWNoZVtsZXZlbF1bdGlsZVhdW3RpbGVZXSAhPT0gZGVwZW5kRmV0Y2hlcykge1xyXG5cdFx0XHRcdHRocm93ICdpbWFnZURlY29kZXJGcmFtZXdvcmsgZXJyb3I6IFVuZXhwZWN0ZWQgZmV0Y2ggaW4gR3JpZEZldGNoZXJCYXNlLmdyaWRGZXRjaGVyQmFzZUNhY2hlJztcclxuXHRcdFx0fVxyXG5cdFx0XHRpc1Rlcm1pbmF0ZWQgPSB0cnVlO1xyXG5cdFx0XHRzZWxmLl9ncmlkRmV0Y2hlckJhc2VDYWNoZVtsZXZlbF1bdGlsZVhdW3RpbGVZXSA9IG51bGw7XHJcblx0XHRcdFxyXG5cdFx0XHRmb3IgKHZhciBpID0gMDsgaSA8IHNlbGYuX2V2ZW50c1sndGlsZS10ZXJtaW5hdGVkJ10ubGVuZ3RoOyArK2kpIHtcclxuXHRcdFx0XHRzZWxmLl9ldmVudHNbJ3RpbGUtdGVybWluYXRlZCddW2ldKHRpbGVLZXkpO1xyXG5cdFx0XHR9XHJcblx0XHRcdFxyXG5cdFx0XHRzZWxmLl9jaGFuZ2VUaWxlc0NvdW50T2ZUaWxlRGVwZW5kRmV0Y2hlcyhkZXBlbmRGZXRjaGVzLCAvKnNpbmdsZUxpc3RlbmVyQWRkVmFsdWU9Ki8tMSwgLyphY3RpdmVUaWxlc0FkZFZhbHVlPSovLTEpO1xyXG5cdFx0fVxyXG5cdH0pO1xyXG59O1xyXG5cclxuR3JpZEZldGNoZXJCYXNlLnByb3RvdHlwZS5fYWRkVG9DYWNoZSA9IGZ1bmN0aW9uIGFkZFRvQ2FjaGUodGlsZVgsIHRpbGVZLCBmZXRjaERhdGEpIHtcclxuXHR2YXIgbGV2ZWxDYWNoZSA9IHRoaXMuX2dyaWRGZXRjaGVyQmFzZUNhY2hlW2ZldGNoRGF0YS5pbWFnZVBhcnRQYXJhbXMubGV2ZWxdO1xyXG5cdGlmICghbGV2ZWxDYWNoZSkge1xyXG5cdFx0bGV2ZWxDYWNoZSA9IFtdO1xyXG5cdFx0dGhpcy5fZ3JpZEZldGNoZXJCYXNlQ2FjaGVbZmV0Y2hEYXRhLmltYWdlUGFydFBhcmFtcy5sZXZlbF0gPSBsZXZlbENhY2hlO1xyXG5cdH1cclxuXHRcclxuXHR2YXIgeENhY2hlID0gbGV2ZWxDYWNoZVt0aWxlWF07XHJcblx0aWYgKCF4Q2FjaGUpIHtcclxuXHRcdHhDYWNoZSA9IFtdO1xyXG5cdFx0bGV2ZWxDYWNoZVt0aWxlWF0gPSB4Q2FjaGU7XHJcblx0fVxyXG5cdFxyXG5cdHZhciBkZXBlbmRGZXRjaGVzID0geENhY2hlW3RpbGVZXTtcclxuXHR2YXIgaXNTaW5nbGUgPSBmYWxzZTtcclxuXHRpZiAoIWRlcGVuZEZldGNoZXMpIHtcclxuXHRcdGRlcGVuZEZldGNoZXMgPSBuZXcgTGlua2VkTGlzdCgpO1xyXG5cdFx0eENhY2hlW3RpbGVZXSA9IGRlcGVuZEZldGNoZXM7XHJcblx0XHQrK2ZldGNoRGF0YS5hY3RpdmVUaWxlc0NvdW50V2l0aFNpbmdsZUxpc3RlbmVyO1xyXG5cdFx0aXNTaW5nbGUgPSB0cnVlO1xyXG5cdH1cclxuXHRcclxuXHRmZXRjaERhdGEudGlsZUxpc3RlbmVycy5wdXNoKHtcclxuXHRcdGRlcGVuZEZldGNoZXM6IGRlcGVuZEZldGNoZXMsXHJcblx0XHRpdGVyYXRvcjogZGVwZW5kRmV0Y2hlcy5hZGQoZmV0Y2hEYXRhKVxyXG5cdH0pO1xyXG5cdHJldHVybiBpc1NpbmdsZSA/IGRlcGVuZEZldGNoZXMgOiBudWxsO1xyXG59OyIsIid1c2Ugc3RyaWN0JztcclxuXHJcbnZhciBHcmlkTGV2ZWxDYWxjdWxhdG9yID0gcmVxdWlyZSgnZ3JpZC1sZXZlbC1jYWxjdWxhdG9yLmpzJyk7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IEdyaWRJbWFnZUJhc2U7XHJcblxyXG4vKiBnbG9iYWwgUHJvbWlzZTogZmFsc2UgKi9cclxuXHJcbnZhciBGRVRDSF9XQUlUX1RBU0sgPSAwO1xyXG52YXIgREVDT0RFX1RBU0sgPSAxO1xyXG5cclxuZnVuY3Rpb24gR3JpZEltYWdlQmFzZShmZXRjaGVyKSB7XHJcblx0dGhpcy5fZmV0Y2hlciA9IGZldGNoZXI7XHJcblx0dGhpcy5faW1hZ2VQYXJhbXMgPSBudWxsO1xyXG5cdHRoaXMuX3dhaXRpbmdGZXRjaGVzID0ge307XHJcbiAgICB0aGlzLl9sZXZlbENhbGN1bGF0b3IgPSBudWxsO1xyXG59XHJcblxyXG5HcmlkSW1hZ2VCYXNlLnByb3RvdHlwZS5vcGVuZWQgPSBmdW5jdGlvbiBvcGVuZWQoaW1hZ2VEZWNvZGVyKSB7XHJcbiAgICB0aGlzLl9pbWFnZVBhcmFtcyA9IGltYWdlRGVjb2Rlci5nZXRJbWFnZVBhcmFtcygpO1xyXG4gICAgaW1hZ2VEZWNvZGVyLm9uRmV0Y2hlckV2ZW50KCdkYXRhJywgdGhpcy5fb25EYXRhRmV0Y2hlZC5iaW5kKHRoaXMpKTtcclxuICAgIGltYWdlRGVjb2Rlci5vbkZldGNoZXJFdmVudCgndGlsZS10ZXJtaW5hdGVkJywgdGhpcy5fb25UaWxlVGVybWluYXRlZC5iaW5kKHRoaXMpKTtcclxufTtcclxuXHJcbkdyaWRJbWFnZUJhc2UucHJvdG90eXBlLmdldExldmVsQ2FsY3VsYXRvciA9IGZ1bmN0aW9uIGdldExldmVsQ2FsY3VsYXRvcigpIHtcclxuICAgIGlmICh0aGlzLl9sZXZlbENhbGN1bGF0b3IgPT09IG51bGwpIHtcclxuICAgICAgICB0aGlzLl9sZXZlbENhbGN1bGF0b3IgPSBuZXcgR3JpZExldmVsQ2FsY3VsYXRvcih0aGlzLl9pbWFnZVBhcmFtcyk7XHJcbiAgICB9XHJcblx0cmV0dXJuIHRoaXMuX2xldmVsQ2FsY3VsYXRvcjtcclxufTtcclxuXHJcbkdyaWRJbWFnZUJhc2UucHJvdG90eXBlLmdldERlY29kZVdvcmtlclR5cGVPcHRpb25zID0gZnVuY3Rpb24gZ2V0RGVjb2RlV29ya2VyVHlwZU9wdGlvbnMoKSB7XHJcblx0dGhyb3cgJ2ltYWdlRGVjb2RlckZyYW1ld29yayBlcnJvcjogR3JpZEltYWdlQmFzZS5nZXREZWNvZGVXb3JrZXJUeXBlT3B0aW9ucyBpcyBub3QgaW1wbGVtZW50ZWQgYnkgaW5oZXJpdG9yJztcclxufTtcclxuXHJcbkdyaWRJbWFnZUJhc2UucHJvdG90eXBlLmdldERlY29kZXJXb3JrZXJzSW5wdXRSZXRyZWl2ZXIgPSBmdW5jdGlvbiBnZXREZWNvZGVyV29ya2Vyc0lucHV0UmV0cmVpdmVyKCkge1xyXG5cdHJldHVybiB0aGlzO1xyXG59O1xyXG5cclxuR3JpZEltYWdlQmFzZS5wcm90b3R5cGUuZGVjb2RlVGFza1N0YXJ0ZWQgPSBmdW5jdGlvbiBkZWNvZGVUYXNrU3RhcnRlZCh0YXNrKSB7XHJcblx0dmFyIHNlbGYgPSB0aGlzO1xyXG5cdHRhc2sub24oJ2FsbERlcGVuZFRhc2tzVGVybWluYXRlZCcsIGZ1bmN0aW9uKCkge1xyXG5cdFx0c2VsZi5kYXRhUmVhZHlGb3JEZWNvZGUodGFzayk7XHJcblx0XHR0YXNrLnRlcm1pbmF0ZSgpO1xyXG5cdH0pO1xyXG59O1xyXG5cclxuR3JpZEltYWdlQmFzZS5wcm90b3R5cGUuZ2V0RmV0Y2hlciA9IGZ1bmN0aW9uIGdldEZldGNoZXIoKSB7XHJcblx0cmV0dXJuIHRoaXMuX2ZldGNoZXI7XHJcbn07XHJcblxyXG4vLyBEZXBlbmRlbmN5V29ya2Vyc0lucHV0UmV0cmVpdmVyIGltcGxlbWVudGF0aW9uXHJcblxyXG5HcmlkSW1hZ2VCYXNlLnByb3RvdHlwZS5nZXRXb3JrZXJUeXBlT3B0aW9ucyA9IGZ1bmN0aW9uKHRhc2tUeXBlKSB7XHJcblx0aWYgKHRhc2tUeXBlID09PSBGRVRDSF9XQUlUX1RBU0spIHtcclxuXHRcdHJldHVybiBudWxsO1xyXG5cdH0gZWxzZSBpZiAodGFza1R5cGUgPT09IERFQ09ERV9UQVNLKSB7XHJcblx0XHRyZXR1cm4gdGhpcy5nZXREZWNvZGVXb3JrZXJUeXBlT3B0aW9ucygpO1xyXG5cdH0gZWxzZSB7XHJcblx0XHR0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGludGVybmFsIGVycm9yOiBHcmlkSW1hZ2VCYXNlLmdldFRhc2tUeXBlT3B0aW9ucyBnb3QgdW5leHBlY3RlZCB0YXNrIHR5cGUgJyArIHRhc2tUeXBlO1xyXG5cdH1cclxufTtcclxuXHJcbkdyaWRJbWFnZUJhc2UucHJvdG90eXBlLmdldEtleUFzU3RyaW5nID0gZnVuY3Rpb24oa2V5KSB7XHJcblx0aWYgKGtleS5mZXRjaFdhaXRUYXNrKSB7XHJcblx0XHRyZXR1cm4gJ2ZldGNoV2FpdDonICsga2V5LnRpbGVYICsgJywnICsga2V5LnRpbGVZICsgJzonICsga2V5LmxldmVsO1xyXG5cdH1cclxuXHQvLyBPdGhlcndpc2UgaXQncyBhIGltYWdlUGFydFBhcmFtcyBrZXkgcGFzc2VkIGJ5IGltYWdlRGVjb2RlckZyYW1ld29yayBsaWIuIEp1c3QgY3JlYXRlIGEgdW5pcXVlIHN0cmluZ1xyXG5cdHJldHVybiBKU09OLnN0cmluZ2lmeShrZXkpO1xyXG59O1xyXG5cclxuR3JpZEltYWdlQmFzZS5wcm90b3R5cGUudGFza1N0YXJ0ZWQgPSBmdW5jdGlvbih0YXNrKSB7XHRcclxuXHR2YXIgc2VsZiA9IHRoaXM7XHJcblx0XHJcblx0aWYgKHRhc2sua2V5LmZldGNoV2FpdFRhc2spIHtcclxuXHRcdHZhciBzdHJLZXkgPSB0aGlzLmdldEtleUFzU3RyaW5nKHRhc2sua2V5KTtcclxuXHRcdHRoaXMuX3dhaXRpbmdGZXRjaGVzW3N0cktleV0gPSB0YXNrO1xyXG5cdFx0cmV0dXJuO1xyXG5cdH1cclxuXHJcblx0aWYgKHRoaXMuX2ltYWdlUGFyYW1zID09PSBudWxsKSB7XHJcblx0XHR0aGlzLl9pbWFnZVBhcmFtcyA9IHRoaXMuZ2V0SW1hZ2VQYXJhbXMoKTsgLy8gaW1hZ2VQYXJhbXMgdGhhdCByZXR1cm5lZCBieSBmZXRjaGVyLm9wZW4oKVxyXG5cdH1cclxuXHJcblx0dmFyIGltYWdlUGFydFBhcmFtcyA9IHRhc2sua2V5O1xyXG5cdHZhciB0aWxlc1JhbmdlID0gR3JpZEltYWdlQmFzZS5nZXRUaWxlc1JhbmdlKHRoaXMuX2ltYWdlUGFyYW1zLCBpbWFnZVBhcnRQYXJhbXMpO1xyXG5cdFxyXG5cdHZhciBpID0gMDtcclxuXHRmb3IgKHZhciB0aWxlWCA9IHRpbGVzUmFuZ2UubWluVGlsZVg7IHRpbGVYIDwgdGlsZXNSYW5nZS5tYXhUaWxlWDsgKyt0aWxlWCkge1xyXG5cdFx0Zm9yICh2YXIgdGlsZVkgPSB0aWxlc1JhbmdlLm1pblRpbGVZOyB0aWxlWSA8IHRpbGVzUmFuZ2UubWF4VGlsZVk7ICsrdGlsZVkpIHtcclxuXHRcdFx0dGFzay5yZWdpc3RlclRhc2tEZXBlbmRlbmN5KHtcclxuXHRcdFx0XHRmZXRjaFdhaXRUYXNrOiB0cnVlLFxyXG5cdFx0XHRcdHRpbGVYOiB0aWxlWCxcclxuXHRcdFx0XHR0aWxlWTogdGlsZVksXHJcblx0XHRcdFx0bGV2ZWw6IGltYWdlUGFydFBhcmFtcy5sZXZlbFxyXG5cdFx0XHR9KTtcclxuXHRcdH1cclxuXHR9XHJcblx0XHJcblx0dGhpcy5kZWNvZGVUYXNrU3RhcnRlZCh0YXNrKTtcclxufTtcclxuXHJcbkdyaWRJbWFnZUJhc2UucHJvdG90eXBlLmRhdGFSZWFkeUZvckRlY29kZSA9IGZ1bmN0aW9uIGRhdGFSZWFkeUZvckRlY29kZSh0YXNrKSB7XHJcblx0dGFzay5kYXRhUmVhZHkoe1xyXG5cdFx0dGlsZUNvbnRlbnRzOiB0YXNrLmRlcGVuZFRhc2tSZXN1bHRzLFxyXG5cdFx0dGlsZUluZGljZXM6IHRhc2suZGVwZW5kVGFza0tleXMsXHJcblx0XHRpbWFnZVBhcnRQYXJhbXM6IHRhc2sua2V5LFxyXG5cdFx0dGlsZVdpZHRoOiB0aGlzLl9pbWFnZVBhcmFtcy50aWxlV2lkdGgsXHJcblx0XHR0aWxlSGVpZ2h0OiB0aGlzLl9pbWFnZVBhcmFtcy50aWxlSGVpZ2h0XHJcblx0fSwgREVDT0RFX1RBU0spO1xyXG59O1xyXG5cclxuLy8gQXV4aWxpYXJ5IG1ldGhvZHNcclxuXHJcbkdyaWRJbWFnZUJhc2UucHJvdG90eXBlLl9vbkRhdGFGZXRjaGVkID0gZnVuY3Rpb24oZmV0Y2hlZFRpbGUpIHtcclxuXHR2YXIgc3RyS2V5ID0gdGhpcy5nZXRLZXlBc1N0cmluZyhmZXRjaGVkVGlsZS50aWxlS2V5KTtcclxuXHR2YXIgd2FpdGluZ1Rhc2sgPSB0aGlzLl93YWl0aW5nRmV0Y2hlc1tzdHJLZXldO1xyXG5cdGlmICh3YWl0aW5nVGFzaykge1xyXG5cdFx0d2FpdGluZ1Rhc2suZGF0YVJlYWR5KGZldGNoZWRUaWxlLnRpbGVDb250ZW50LCBGRVRDSF9XQUlUX1RBU0spO1xyXG5cdH1cclxufTtcclxuXHJcbkdyaWRJbWFnZUJhc2UucHJvdG90eXBlLl9vblRpbGVUZXJtaW5hdGVkID0gZnVuY3Rpb24odGlsZUtleSkge1xyXG5cdHZhciBzdHJLZXkgPSB0aGlzLmdldEtleUFzU3RyaW5nKHRpbGVLZXkpO1xyXG5cdHZhciB3YWl0aW5nVGFzayA9IHRoaXMuX3dhaXRpbmdGZXRjaGVzW3N0cktleV07XHJcblx0aWYgKHdhaXRpbmdUYXNrKSB7XHJcblx0XHR3YWl0aW5nVGFzay50ZXJtaW5hdGUoKTtcclxuXHRcdHRoaXMuX3dhaXRpbmdGZXRjaGVzW3N0cktleV0gPSBudWxsO1xyXG5cdH1cclxufTtcclxuXHJcbkdyaWRJbWFnZUJhc2UuZ2V0VGlsZXNSYW5nZSA9IGZ1bmN0aW9uKGltYWdlUGFyYW1zLCBpbWFnZVBhcnRQYXJhbXMpIHtcclxuXHR2YXIgbGV2ZWxXaWR0aCAgPSBpbWFnZVBhcmFtcy5pbWFnZVdpZHRoICAqIE1hdGgucG93KDIsIGltYWdlUGFydFBhcmFtcy5sZXZlbCAtIGltYWdlUGFyYW1zLmltYWdlTGV2ZWwpO1xyXG5cdHZhciBsZXZlbEhlaWdodCA9IGltYWdlUGFyYW1zLmltYWdlSGVpZ2h0ICogTWF0aC5wb3coMiwgaW1hZ2VQYXJ0UGFyYW1zLmxldmVsIC0gaW1hZ2VQYXJhbXMuaW1hZ2VMZXZlbCk7XHJcblx0dmFyIGxldmVsVGlsZXNYID0gTWF0aC5jZWlsKGxldmVsV2lkdGggIC8gaW1hZ2VQYXJhbXMudGlsZVdpZHRoICk7XHJcblx0dmFyIGxldmVsVGlsZXNZID0gTWF0aC5jZWlsKGxldmVsSGVpZ2h0IC8gaW1hZ2VQYXJhbXMudGlsZUhlaWdodCk7XHJcblx0cmV0dXJuIHtcclxuXHRcdG1pblRpbGVYOiBNYXRoLm1heCgwLCBNYXRoLmZsb29yKGltYWdlUGFydFBhcmFtcy5taW5YIC8gaW1hZ2VQYXJhbXMudGlsZVdpZHRoICkpLFxyXG5cdFx0bWluVGlsZVk6IE1hdGgubWF4KDAsIE1hdGguZmxvb3IoaW1hZ2VQYXJ0UGFyYW1zLm1pblkgLyBpbWFnZVBhcmFtcy50aWxlSGVpZ2h0KSksXHJcblx0XHRtYXhUaWxlWDogTWF0aC5taW4obGV2ZWxUaWxlc1gsIE1hdGguY2VpbChpbWFnZVBhcnRQYXJhbXMubWF4WEV4Y2x1c2l2ZSAvIGltYWdlUGFyYW1zLnRpbGVXaWR0aCApKSxcclxuXHRcdG1heFRpbGVZOiBNYXRoLm1pbihsZXZlbFRpbGVzWSwgTWF0aC5jZWlsKGltYWdlUGFydFBhcmFtcy5tYXhZRXhjbHVzaXZlIC8gaW1hZ2VQYXJhbXMudGlsZUhlaWdodCkpXHJcblx0fTtcclxufTtcclxuIiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBHcmlkTGV2ZWxDYWxjdWxhdG9yO1xyXG5cclxuZnVuY3Rpb24gR3JpZExldmVsQ2FsY3VsYXRvcihpbWFnZVBhcmFtcykge1xyXG5cdHRoaXMuX2ltYWdlUGFyYW1zID0gaW1hZ2VQYXJhbXM7XHJcbn1cclxuXHJcbkdyaWRMZXZlbENhbGN1bGF0b3IucHJvdG90eXBlLmdldExldmVsV2lkdGggPSBmdW5jdGlvbiBnZXRMZXZlbFdpZHRoKGxldmVsKSB7XHJcblx0dmFyIHdpZHRoID0gdGhpcy5faW1hZ2VQYXJhbXMuaW1hZ2VXaWR0aCAqIE1hdGgucG93KDIsIGxldmVsIC0gdGhpcy5faW1hZ2VQYXJhbXMuaW1hZ2VMZXZlbCk7XHJcbiAgICByZXR1cm4gd2lkdGg7XHJcbn07XHJcblxyXG5HcmlkTGV2ZWxDYWxjdWxhdG9yLnByb3RvdHlwZS5nZXRMZXZlbEhlaWdodCA9IGZ1bmN0aW9uIGdldExldmVsSGVpZ2h0KGxldmVsKSB7XHJcblx0dmFyIGhlaWdodCA9ICB0aGlzLl9pbWFnZVBhcmFtcy5pbWFnZUhlaWdodCAqIE1hdGgucG93KDIsIGxldmVsIC0gdGhpcy5faW1hZ2VQYXJhbXMuaW1hZ2VMZXZlbCk7XHJcbiAgICByZXR1cm4gaGVpZ2h0O1xyXG59O1xyXG5cclxuR3JpZExldmVsQ2FsY3VsYXRvci5wcm90b3R5cGUuZ2V0TGV2ZWwgPSBmdW5jdGlvbiBnZXRMZXZlbChyZWdpb25JbWFnZUxldmVsKSB7XHJcblx0dmFyIGxvZzIgPSBNYXRoLmxvZygyKTtcclxuXHR2YXIgbGV2ZWxYID0gTWF0aC5sb2cocmVnaW9uSW1hZ2VMZXZlbC5zY3JlZW5XaWR0aCAgLyAocmVnaW9uSW1hZ2VMZXZlbC5tYXhYRXhjbHVzaXZlIC0gcmVnaW9uSW1hZ2VMZXZlbC5taW5YKSkgLyBsb2cyO1xyXG5cdHZhciBsZXZlbFkgPSBNYXRoLmxvZyhyZWdpb25JbWFnZUxldmVsLnNjcmVlbkhlaWdodCAvIChyZWdpb25JbWFnZUxldmVsLm1heFlFeGNsdXNpdmUgLSByZWdpb25JbWFnZUxldmVsLm1pblkpKSAvIGxvZzI7XHJcblx0dmFyIGxldmVsID0gTWF0aC5jZWlsKE1hdGgubWluKGxldmVsWCwgbGV2ZWxZKSk7XHJcblx0bGV2ZWwgKz0gdGhpcy5faW1hZ2VQYXJhbXMuaW1hZ2VMZXZlbDtcclxuXHRcclxuXHRyZXR1cm4gbGV2ZWw7XHJcbn07XHJcbiIsIid1c2Ugc3RyaWN0JztcclxuXHJcbnZhciBTaW1wbGVNb3ZhYmxlRmV0Y2ggPSByZXF1aXJlKCdzaW1wbGUtbW92YWJsZS1mZXRjaC5qcycpO1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBTaW1wbGVGZXRjaGVyQmFzZTtcclxuXHJcbi8qIGdsb2JhbCBQcm9taXNlOiBmYWxzZSAqL1xyXG5cclxuZnVuY3Rpb24gU2ltcGxlRmV0Y2hlckJhc2Uob3B0aW9ucykge1xyXG4gICAgdGhpcy5fbWF4QWN0aXZlRmV0Y2hlc0luTW92YWJsZUZldGNoID0gKG9wdGlvbnMgfHwge30pLm1heEFjdGl2ZUZldGNoZXNJbk1vdmFibGVGZXRjaCB8fCAyO1xyXG5cdHRoaXMuX2luZGlyZWN0Q2xvc2VJbmRpY2F0aW9uID0geyBpc0Nsb3NlUmVxdWVzdGVkOiBmYWxzZSB9O1xyXG59XHJcblxyXG5TaW1wbGVGZXRjaGVyQmFzZS5wcm90b3R5cGUuc3RhcnRNb3ZhYmxlRmV0Y2ggPSBmdW5jdGlvbiBzdGFydE1vdmFibGVGZXRjaChmZXRjaENvbnRleHQsIGltYWdlUGFydFBhcmFtcykge1xyXG4gICAgdmFyIG1vdmFibGVGZXRjaCA9IG5ldyBTaW1wbGVNb3ZhYmxlRmV0Y2goXHJcbiAgICAgICAgdGhpcywgdGhpcy5faW5kaXJlY3RDbG9zZUluZGljYXRpb24sIGZldGNoQ29udGV4dCwgdGhpcy5fbWF4QWN0aXZlRmV0Y2hlc0luTW92YWJsZUZldGNoKTtcclxuICAgIFxyXG4gICAgbW92YWJsZUZldGNoLnN0YXJ0KGltYWdlUGFydFBhcmFtcyk7XHJcbn07XHJcblxyXG5TaW1wbGVGZXRjaGVyQmFzZS5wcm90b3R5cGUuY2xvc2UgPSBmdW5jdGlvbiBjbG9zZSgpIHtcclxuXHRpZiAodGhpcy5zdGFydE1vdmFibGVGZXRjaCAhPT0gU2ltcGxlRmV0Y2hlckJhc2UucHJvdG90eXBlLnN0YXJ0TW92YWJsZUZldGNoKSB7XHJcblx0XHR0aHJvdyAnaW1hZ2VEZWNvZGVyRnJhbWV3b3JrIGVycm9yOiBNdXN0IG92ZXJyaWRlIEZldGNoZXIuY2xvc2UoKSB3aGVuIEZldGNoZXIuc3RhcnRNb3ZhYmxlRmV0Y2goKSB3YXMgb3ZlcnJpZGVuJztcclxuXHR9XHJcbiAgICB0aGlzLl9pbmRpcmVjdENsb3NlSW5kaWNhdGlvbi5pc0Nsb3NlUmVxdWVzdGVkID0gdHJ1ZTtcclxuICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcclxufTsiXX0=
