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

function WorkerProxyPixelsDecoder(imageImplementationClassName) {
    this._imageImplementation = imageHelperFunctions.getImageImplementation(
        imageImplementationClassName);
    
    var scriptsToImport = imageHelperFunctions.getScriptsForWorkerImport(
        this._imageImplementation);
    scriptsToImport = scriptsToImport.concat([decoderSlaveScriptUrl]);
    
    var args = [imageImplementationClassName];
    
    this._workerHelper = new AsyncProxy.AsyncProxyMaster(
        scriptsToImport,
        'ArbitraryClassName',
        args);
}

WorkerProxyPixelsDecoder.prototype.decode = function decode(dataForDecode) {
    var transferables = this._imageImplementation.getTransferablesOfRequestCallback(dataForDecode);
    var resultTransferables = [0, 'pixels', 'buffer'];
    
    var args = [dataForDecode];
    var options = {
        transferables: transferables,
        pathsToTransferablesInPromiseResult: resultTransferables,
        isReturnPromise: true
    };
    
    return this._workerHelper.callFunction('decode', args, options);
};

function decoderSlaveScriptBody() {
    'use strict';

    AsyncProxy.AsyncProxySlave.setSlaveSideCreator(createDecoder);

    function createDecoder(imageImplementationClassName) {
        var imageImplementation = self[imageImplementationClassName];
        return imageImplementation.createDecoder();
    }
}