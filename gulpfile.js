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
    './src/imagedecoder/imagedecoderworkers/sendimageparameterstomaster.js',
    './src/imagedecoder/imagedecoderworkers/workerproxyfetchmanager.js',
    './src/imagedecoder/imagedecoderworkers/workerproxyimagedecoder.js',
    './src/imagedecoder/imagedecoderworkers/workerproxypixelsdecoder.js',
    './src/imagedecoder/fetchclientbase/datapublisher.js',
    './src/imagedecoder/fetchclientbase/simplefetchcontext.js',
    './src/imagedecoder/fetchclientbase/simplefetcher.js',
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

var vendors = [
    './vendor/asyncproxy.js',
    './vendor/resourcescheduler.js'
];

var scripts = vendors.concat(sources);

gulp.task('default', function () {
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
        standalone: 'image-decoder',
        debug: true
    });
    
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
            //.on('error', gutil.log)
        .pipe(addsrc('./vendor/asyncproxy.js'))
        .pipe(addsrc('./vendor/resourcescheduler.js'))
        .pipe(concat('imagedecoderframework-src.js'))
        .pipe(rename('imagedecoderframework-debug.js'))
        .pipe(sourcemaps.write('./'))
        .pipe(gulp.dest('./'));

    return jshintStream;
    return mergeStream(jshintStream, browserifyStream);
});