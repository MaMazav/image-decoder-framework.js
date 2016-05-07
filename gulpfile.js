'use strict';

var browserify = require('browserify');
var gulp = require('gulp');
var source = require('vinyl-source-stream');
var buffer = require('vinyl-buffer');
var uglify = require('gulp-uglify');
var sourcemaps = require('gulp-sourcemaps');
var gutil = require('gulp-util');
var rename = require('gulp-rename');
var addsrc = require('gulp-add-src');
var concat = require('gulp-concat');
var jshint = require('gulp-jshint');
var filter = require('gulp-filter');
var mergeStream = require('merge-stream');

var sources = [
    './src/imagedecoder/imagedecoderhelpers/decodejob.js',
    './src/imagedecoder/imagedecoderhelpers/decodejobspool.js',
    './src/imagedecoder/imagedecoderhelpers/fetchmanager.js',
    './src/imagedecoder/imagedecoderhelpers/frustumrequestsprioritizer.js',
    './src/imagedecoder/imagedecoderhelpers/imagehelperfunctions.js',
    './src/imagedecoder/imagedecoderhelpers/linkedlist.js',
    './src/imagedecoder/imagedecoderhelpers/fetchjob.js',
    './src/imagedecoder/imagedecoderhelpers/imageparamsretrieverproxy.js',
    './src/imagedecoder/imagedecoderworkers/sendimageparameterstomaster.js',
    './src/imagedecoder/imagedecoderworkers/workerproxyfetchmanager.js',
    './src/imagedecoder/imagedecoderworkers/workerproxyimagedecoder.js',
    './src/imagedecoder/imagedecoderworkers/workerproxypixelsdecoder.js',
    './src/imagedecoder/fetchclientbase/datapublisher.js',
    './src/imagedecoder/fetchclientbase/simpleimagedatacontext.js',
    './src/imagedecoder/fetchclientbase/simplefetcher.js',
    './src/imagedecoder/fetchclientbase/simplepixelsdecoderbase.js',
    './src/imagedecoder/fetchclientbase/fetchclientbase.js',
    './src/imagedecoder/imagedecoder.js',
    './src/imagedecoder/viewerimagedecoder.js',

    './src/cesiumimagedecoder/_cesiumfrustumcalculator.js',
    './src/cesiumimagedecoder/_cesiumimagedecoderlayermanager.js',
    './src/cesiumimagedecoder/canvasimageryprovider.js',
    './src/cesiumimagedecoder/imagedecoderimageryprovider.js',
    
    './src/leafletimagedecoder/imagedecoderregionlayer.js',
    './src/leafletimagedecoder/imagedecodertilelayer.js',
    './src/leafletimagedecoder/leafletfrustumcalculator.js'
];

var vendorsProd = [
    //'./vendor/asyncproxy.js',
    //'./vendor/resourcescheduler.js'
];

var vendorsDebug = [
    './vendor/asyncproxy.debug.js',
    './vendor/resourcescheduler.debug.js'
];

var scriptsDebug = vendorsDebug.concat(sources);
var scriptsProd = vendorsProd.concat(sources);

function build(isDebug) {
    var browserified = browserify({
        entries: ['./src/imagedecoderexports.js'],
        paths: [
            './src/imagedecoder',
            './src/imagedecoder/imagedecoderhelpers',
            './src/imagedecoder/imagedecoderworkers',
            './src/imagedecoder/fetchclientbase',
            './src/cesiumimagedecoder',
            './src/leafletimagedecoder'
        ],
        standalone: 'image-decoder-framework',
        debug: isDebug
    });
    
    var scripts = isDebug ? scriptsDebug : scriptsProd;
    var vendors = isDebug ? vendorsDebug : vendorsProd;
    var jshintStream = gulp.src(scripts)
        .pipe(buffer())
        .pipe(jshint())
        .pipe(jshint.reporter('default'));
    
    var browserifyStream = browserified
        .bundle()
        .pipe(source('imagedecoderframework-src.js'))
        .pipe(buffer())
        .pipe(sourcemaps.init({ loadMaps: true }))
            // NOTE: Add it in production
            //// Add transformation tasks to the pipeline here.
            //.pipe(uglify(/* { compress: { unused: false } } */))
            //.on('error', gutil.log);
    for (var i = 0; i < vendors.length; ++i) {
        browserifyStream = browserifyStream.pipe(addsrc(vendors[i]));
    }
    
    browserifyStream = browserifyStream
        .pipe(addsrc('./vendor/resourcescheduler.js'))
        .pipe(concat('imagedecoderframework-src.js'))
        .pipe(rename('imagedecoderframework-debug.js'))
        .pipe(sourcemaps.write('./'))
        .pipe(gulp.dest('./'));

    //return jshintStream;
    return mergeStream(jshintStream, browserifyStream);
}

gulp.task('default', function () {
    return build(/*isDebug=*/true);
});