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