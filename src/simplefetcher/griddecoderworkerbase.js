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
		var tilePosition  = {minX: 0, minY: 0, maxXExclusive: 0, maxYExclusive: 0};
		var regionInImage = {minX: 0, minY: 0, maxXExclusive: 0, maxYExclusive: 0}; 
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
        throw 'SimplePixelsDecoderBase error: decodeRegion is not implemented';
    };
}