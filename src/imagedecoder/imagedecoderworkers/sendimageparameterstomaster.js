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