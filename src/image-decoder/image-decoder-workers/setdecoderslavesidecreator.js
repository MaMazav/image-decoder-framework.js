'use strict';

// Suppress "Unnecessary directive 'use strict'" for the slaveScriptContent function
/*jshint -W034 */

/* global self: false */
/* global imageDecoderFramework: false */

module.exports.getScriptUrl = function getScriptUrl() {
    return decoderSlaveScriptUrl;
};

var imageHelperFunctions = require('image-helper-functions.js');

var decoderSlaveScriptBlob = new Blob(
    ['(', decoderSlaveScriptBody.toString(), ')()'],
    { type: 'application/javascript' });
var decoderSlaveScriptUrl = URL.createObjectURL(decoderSlaveScriptBlob);

//function WorkerProxyPixelsDecoder(options) {
//    this._options = options || {};
//    this._imageImplementation = imageHelperFunctions.getImageImplementation(
//        options.imageImplementationClassName);
//    
//    var scriptsToImport = (this._options.scriptsToImport || []).concat([decoderSlaveScriptUrl]);
//    var args = [this._options];
//    
//    this._workerHelper = new AsyncProxy.AsyncProxyMaster(
//        scriptsToImport,
//        'ArbitraryClassName',
//        args);
//}
//
//WorkerProxyPixelsDecoder.prototype.decode = function decode(dataForDecode) {
//    //var transferables = this._imageImplementation.getTransferableOfDecodeArguments(dataForDecode);
//    var resultTransferables = [['data', 'buffer']];
//    
//    var args = [dataForDecode];
//    var options = {
//        //transferables: transferables,
//        pathsToTransferablesInPromiseResult: resultTransferables,
//        isReturnPromise: true
//    };
//    
//    return this._workerHelper.callFunction('decode', args, options);
//};

//WorkerProxyPixelsDecoder.prototype.terminate = function terminate() {
//    this._workerHelper.terminate();
//};

function decoderSlaveScriptBody() {
    'use strict';

    AsyncProxy.AsyncProxySlave.setSlaveSideCreator(function createDecoder(options) {
        //var imageImplementation = self[options.imageImplementationClassName];
        var imageImplementation = imageDecoderFramework.Internals.imageHelperFunctions.getImageImplementation(options.imageImplementationClassName);
        return imageImplementation.createPixelsDecoder();
    });
}