module.exports = function (grunt) {
    "use strict";

    require('load-grunt-tasks')(grunt);
    let http = require('http'),
        https = require('https');

    // For local development purpose only
    var devProfileName = 'dev';
    // Regular production profile
    var prodProfileName = 'prod';

    var isProductionMode = function(mode) {
        return mode === prodProfileName;
    };

    var mode = grunt.option('mode') || 'dev';
    var assets = require('./build.config');

    function sanitizeDistFilename (filename) {
        return filename.replace(/^dist\//, '').replace(/^node_modules\//, 'assets/libs/');
    }

    function sanitizeDevFilename (filename) {
        return filename.replace(/^src\//, '').replace(/^tmp\//, '../tmp/').replace(/^node_modules\//, '../node_modules/');
    }

    function withHeader(from, to, headerName, defaultValue) {
        if(!to.headers) {
            to.headers = {};
        }
        if(from.headers && from.headers[headerName]) {
            to.headers[headerName] = from.headers[headerName];
        }
        else if(defaultValue) {
            to.headers[headerName] = defaultValue;
        }
        return to;
    }

    var getTemplateVariables = function () {
        return function () {
            var vars = null,
                cssCommon = [],
                cssApp = [],
                jsCommon = grunt.config('concat.common.dest'),
                jsApp = [],
                config = [];

            if (isProductionMode(mode)) {
                assets.common.css.forEach(function(e) {
                    cssCommon.push(sanitizeDistFilename(e));
                });

                vars = {
                    js: {
                        common: sanitizeDistFilename(jsCommon),
                        app: [sanitizeDistFilename(grunt.config('uglify.dist.dest'))]
                    },
                    css: {
                        app: ['assets/css/main.min.css'],
                        common: cssCommon
                    },
                    config: config
                };
            }
            else {
                assets.common.css.forEach(function(e) {
                    cssCommon.push(sanitizeDevFilename(e));
                });
                grunt.file.expand(assets.src.css).forEach(function(e) {
                    cssApp.push(sanitizeDevFilename(e));
                });

                grunt.file.expand(
                    assets.src.js
                    .concat([
                        grunt.config.process('<%= html2js.app.dest %>'),
                        grunt.config.process('<%= ngconstant.version.options.dest %>')
                    ])
                )
                .forEach(function(e) {
                    jsApp.push(sanitizeDevFilename(e));
                });

                grunt.file.expand(assets.src.config)
                .forEach(function(e) {
                    config.push(sanitizeDevFilename(e));
                });

                vars = {
                    js: {
                        common: sanitizeDevFilename(jsCommon),
                        app: jsApp
                    },
                    css: {
                        app: cssApp,
                        common: cssCommon
                    },
                    config: config
                };
            }
            return vars;
        }
    };

    grunt.initConfig({
        pkg: grunt.file.readJSON('package.json'),
        clean : {
            files : [
                'src/index.html', 'tmp/'
            ]
        },
        concat : {
            common: {
                src: assets.common.js,
                dest: (isProductionMode(mode) ? 'dist' : 'tmp') + '/js/common.js'
            },
            app: {
                src: assets.src.js.concat([
                    '<%= html2js.app.dest %>',
                    '<%= ngconstant.version.options.dest %>',
                    assets.src.config
                ]),
                dest: 'tmp/js/App.js'
            }
        },
        concurrent: {
            target: {
                tasks: ['connect', 'watch'],
                options: {
                    logConcurrentOutput: true
                }
            }
        },
        connect: {
            server: {
                options: {
                    keepalive: true,
                    port: 9000,
                    middleware: function(connect, options, middlewares) {
                        middlewares.unshift(function (req, res, next) {
                            let baseUriPattern = new RegExp('^/(api)/(.*)?'),
                                baseUriMatcher = req.url.match(baseUriPattern);
                            if(baseUriPattern.test(req.url)) {
                                let body = [];
                                req.on('data', function(chunk) {
                                    body.push(chunk);
                                }).on('end', function() {
                                    let defaultUrl = process.env['API_URL'],
                                        urlPattern = new RegExp('^(https?:)//([^/:]+)(?::(\\d+))?(/.*)?$'),
                                        matcher;

                                    if(!defaultUrl) {
                                        grunt.log.writeln('Missing API_URL environment variable pointing to the iot-admin-api backend');
                                    }

                                    if(baseUriMatcher[1] === 'api') {
                                        matcher = defaultUrl.match(urlPattern);
                                    }
                                    let destPath = matcher[4] + (baseUriMatcher[2] || '');
                                    

                                    grunt.log.writeln(`Proxy request from [${req.method} ${req.url}] to [${req.method} ${matcher[1]}//${matcher[2] + (matcher[3] ? ':' + matcher[3] : '') + destPath}]`);

                                    let reqParams = {
                                        protocol: matcher[1],
                                        host: matcher[2],
                                        method: req.method,
                                        path: destPath,
                                        headers: {}
                                    };
                                    reqParams = withHeader(req, reqParams, 'content-type');
                                    reqParams = withHeader(req, reqParams, 'accept', 'application/json');

                                    let caller;
                                    if(matcher[1] === 'http:') {
                                        caller = http;
                                    } else if(matcher[1] === 'https:') {
                                        caller = https;
                                    } else {
                                        grunt.log.writeln(`Unsupported protocol ${matcher[1]}`);
                                    }

                                    if(matcher[3]) {
                                        reqParams.port = matcher[3];
                                    }
                                    
                                    let proxyfiedRequest = caller.request(reqParams, function(proxyfiedResponse) {
                                        let proxyfiedResponseBody = [];
                                        proxyfiedResponse.on('data', function(chunk) {
                                            proxyfiedResponseBody.push(chunk);
                                        }).on('end', function() {
                                            res.statusCode = proxyfiedResponse.statusCode;
                                            res = withHeader(proxyfiedResponse, res, 'content-type');
                                            res = withHeader(proxyfiedResponse, res, 'content-disposition');
                                            res.end(Buffer.concat(proxyfiedResponseBody));
                                        });
                                    });
                                    proxyfiedRequest.write(Buffer.concat(body));
                                    proxyfiedRequest.end();
                                });
                            }
                            else {
                                next();
                            }
                        });
                        return middlewares;
                    }
                }
            }
        },
        copy: {
            common: {
                files: [
                    {
                        expand: true,
                        src: [assets.common.assets],
                        dest: (isProductionMode(mode) ? 'dist' : 'src') + '/assets/libs/',
                        rename: function(dest, src) {
                            return dest + src.replace(/^node_modules\//, '');
                        }
                    }
                ]
            },
            prod: {
                files: [
                    {expand: true, cwd: 'src/app/', src: ['**/*.html'], dest: 'tmp/app/'},
                    {expand: true, cwd: 'src/assets/', src: ['**/*.html'], dest: 'dist/assets/'},
                    {
                        expand: true,
                        src: [assets.common.css],
                        dest: 'dist/assets/libs/',
                        rename: function(dest, src) {
                            return dest + src.replace(/^node_modules\//, '');
                        }
                    },
                    {expand: true, cwd: 'src/assets/images/', src: ['**/*'], dest: 'dist/assets/images/'},
                    {expand: true, cwd: 'src/assets/i18n/', src: ['**/*'], dest: 'dist/assets/i18n/'},
                    {expand: true, cwd: 'src/assets/fonts/', src: ['**/*'], dest: 'dist/assets/fonts/'}
                ]
            }
        },
        cssmin: {
            dist : {
                files : {
                    'dist/assets/css/main.min.css' : assets.src.css
                }
            }
        },
        filerev: {
            dist: {
                src: ['dist/js/{,*/}*.js', 'dist/assets/css/{,*/}*.css']
            }
        },
        html2js: {
            options: {
                base: 'tmp'
            },
            app: {
                src: ['tmp/app/**/*.html'],
                dest: 'tmp/js/templates.js'
            }
        },
        htmlangular: {
            options: {
                reportpath: null,
                reportCheckstylePath: null,
                customtags: [
                    'loyalty-header',
                    'loyalty-nav-bar',
                    'loyalty-nav-bar-item',
                    'uib-tabset',
                    'isteven-multi-select',
                    'field-validation',
                    'maintenance-handler',
                    'translate-default',
                    'wait-frame'
                ],
                relaxerror: [
                    'Start tag seen without seeing a doctype first. Expected e.g. “<!DOCTYPE html>”.',
                    'Non-space characters found without seeing a doctype first. Expected e.g. “<!DOCTYPE html>”.',
                    'Element “head” is missing a required instance of child element “title”.',
                    'Element “title” must not be empty.',
                    'Empty heading.',
                    'This document appears to be written in English. Consider adding “lang="en"” (or variant) to the “html” start tag.',
                    'Consider adding a “lang” attribute to the “html” start tag to declare the language of this document.',
                    '“--!>” found at end of comment (should just be “-->”).'
                ]
            },
            files: {
                src: [
                    'src/**/*.html',
                    '<%= template.index.dest %>'
                ]
            }
        },
        htmlmin: {
            options: {
                removeComments: true,
                collapseWhitespace: true
            },
            index: {
                files: [
                    {expand: true, cwd: 'dist/', src: '*.html', dest: 'dist/'},
                ]
            },
            templates: {
                files: [
                    {expand: true, cwd: 'tmp/', src: '**/*.html', dest: 'tmp/'}
                ]
            }
        },
        jshint: {
            all: assets.src.js,
            config: assets.src.config,
            options : {
                jshintrc: '.jshintrc'
            }
        },
        ngAnnotate: {
            options: {
                singleQuotes: true
            },
            dist: {
                files: {
                    '<%= concat.app.dest %>': ['<%= concat.app.dest %>']
                }
            }
        },
        ngconstant: {
            version: {
                options: {
                    dest: 'tmp/js/version.js',
                    name: 'configVersion'
                },
                constants: {
                    VERSION: '<%= pkg.version %>'
                }
            }
        },
        template: {
            index: {
                src: 'src/index.ejs',
                dest: (isProductionMode(mode) ? 'dist' : 'src') + '/index.html',
                variables: getTemplateVariables()
            }
        },
        uglify: {
            dist: {
                src: [ '<%= concat.app.dest %>'],
                dest: 'dist/js/App.min.js'
            }
        },
        usemin: {
            html: ['dist/*.html', 'dist/**/*.html']
        },
        watch : {
            js: {
                files : ['<%= jshint.all %>'],
                tasks : ['jshint', 'template']
            },
            template: {
                files : ['<%= template.index.src %>'],
                tasks : ['template', 'htmlangular']
            },
            html: {
                files : ['src/**/*.html'],
                tasks : ['htmlangular']
            },
            config: {
                files : [ '<%= jshint.config %>'],
                tasks : ['jshint', 'template']
            }
        }
    });

    grunt.registerTask('buildDev', [
        'clean',
        'jshint',
        'htmlangular',
        'copy:common',
        'html2js',
        'ngconstant',
        'concat:common',
        'template'
    ]);

    grunt.registerTask('buildProd', [
        'clean',
        'jshint',
        'copy:common',
        'copy:prod',
        'template',
        'htmlangular',
        'htmlmin:templates',
        'html2js',
        'ngconstant',
        'cssmin',
        'concat',
        'ngAnnotate',
        'uglify',
        'filerev',
        'usemin',
        'htmlmin:index'
    ]);

    /*
     * --mode=prod
     * --mode=dev
     */
    grunt.registerTask('build', 'Build', function () {
        grunt.log.subhead('Build in mode ' + mode);
        switch (mode) {
            case 'dev':
                grunt.task.run('buildDev');
                break;
            case 'prod':
                grunt.task.run('buildProd');
                break;
            default:
                grunt.verbose.or.write('Incorrect build mode [' + mode + ']').error();
                grunt.fail.warn('Please retry with --mode=dev|prod');
        }
    });

    grunt.registerTask('serve', 'Dev Build', function () {
        grunt.task.run(['build', 'concurrent:target']);
    });

    grunt.registerTask('buildAndWatch', 'dev build and watch files', function () {
        grunt.task.run(['build', 'watch']);
    });

    grunt.registerTask('default', 'serve');

};
