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
    './src/imagedecoder/imagedecoderworkers/setdecoderslavesidecreator.js',
    './src/imagedecoder/imagedecoderworkers/workerproxyfetchmanager.js',
    './src/imagedecoder/imagedecoderworkers/workerproxypixelsdecoder.js',
    './src/simplefetcher/promisefetcheradapter.js',
	'./src/simplefetcher/gridimagebase.js',
	'./src/simplefetcher/gridfetcherbase.js',
	'./src/simplefetcher/griddecoderworkerbase.js',
    './src/simplefetcher/promisefetcheradapterfetchhandle.js',
    /*
    './src/simplefetcher/datapublisher.js',
    './src/simplefetcher/simpleimagedatacontext.js',
    './src/simplefetcher/simplenonprogressivefetchhandle.js',
    './src/simplefetcher/simplepixelsdecoderbase.js',
    './src/simplefetcher/simplefetcher.js',
    //*/
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
    './vendor/resource-scheduler.dev.js'
];

var vendorsDebug = [
    './vendor/resource-scheduler.dev.debug.js'
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
            './src/simplefetcher',
            './src/cesiumimagedecoder',
            './src/leafletimagedecoder'
        ],
        standalone: 'image-decoder-framework',
        debug: isDebug
    });
    
    var scripts = isDebug ? scriptsDebug : scriptsProd;
    var vendors = isDebug ? vendorsDebug : vendorsProd;
    var jshintStream = gulp.src(scripts)
        //.pipe(sourcemaps.init({ loadMaps: true }))
        .pipe(buffer())
        .pipe(jshint())
        .pipe(jshint.reporter('default'));
    
    var browserifyStream = browserified
        .bundle()
        .pipe(source('image-decoder-framework.src.js'))
        .pipe(buffer());
    
    if (!isDebug) {
        browserifyStream = browserifyStream
        .pipe(uglify())
        .on('error', gutil.log);
    }
    for (var i = 0; i < vendors.length; ++i) {
        browserifyStream = browserifyStream.pipe(addsrc(vendors[i]));
    }
    
    var outFile = isDebug ? 'image-decoder-framework.dev.debug' : 'image-decoder-framework.dev';
    
    browserifyStream = browserifyStream
        .pipe(concat('image-decoder-framework.src.js'))
        .pipe(rename(outFile + '.js'))
        //.pipe(sourcemaps.write(outFile + '.js.map'))
        .pipe(gulp.dest('./'));

    //return jshintStream;
    return mergeStream(jshintStream, browserifyStream);
}

gulp.task('debug', function () {
    return build(/*isDebug=*/true);
});

gulp.task('prod', function() {
    return build(/*isDebug=*/false);
});

gulp.task('default', ['debug', 'prod']);