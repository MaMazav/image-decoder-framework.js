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
    './src/image-decoder/image-decoder-helpers/decode-job.js',
    './src/image-decoder/image-decoder-helpers/decode-jobs-pool.js',
    './src/image-decoder/image-decoder-helpers/fetcher-base.js',
    './src/image-decoder/image-decoder-helpers/fetch-context.js',
    './src/image-decoder/image-decoder-helpers/fetch-context-api.js',
    './src/image-decoder/image-decoder-helpers/simple-movable-fetch.js',
    './src/image-decoder/image-decoder-helpers/fetcher-closer.js',
    './src/image-decoder/image-decoder-helpers/frustum-requests-prioritizer.js',
    './src/image-decoder/image-decoder-helpers/image-helper-functions.js',
    './src/image-decoder/image-decoder-helpers/linked-list.js',
    './src/image-decoder/image-decoder-workers/image-params-retriever-proxy.js',
    './src/image-decoder/image-base.js',
    './src/image-decoder/image-viewer.js',
	'./src/simple-fetcher/grid-fetcher-base.js',
	'./src/simple-fetcher/grid-image-base.js',
	'./src/simple-fetcher/grid-decoder-worker-base.js',

    './src/cesium-image-decoder/cesium-frustum-calculator.js',
    './src/cesium-image-decoder/cesium-image-decoder-layer-manager.js',
    './src/cesium-image-decoder/canvas-imagery-provider.js',
    './src/cesium-image-decoder/image-decoder-imagery-provider.js',
    
    './src/leaflet-image-decoder/image-decoder-region-layer.js',
    './src/leaflet-image-decoder/leaflet-frustum-calculator.js'
];

var vendorsProd = [
    './vendor/async-proxy.dev.js'
];

var vendorsDebug = [
    './vendor/async-proxy.dev.debug.js'
];

var scriptsDebug = vendorsDebug.concat(sources);
var scriptsProd = vendorsProd.concat(sources);

function build(isDebug) {
    var browserified = browserify({
        entries: ['./src/image-decoder-exports.js'],
        paths: [
            './src/image-decoder',
            './src/image-decoder/image-decoder-helpers',
            './src/image-decoder/image-decoder-workers',
            './src/simple-fetcher',
            './src/cesium-image-decoder',
            './src/leaflet-image-decoder'
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