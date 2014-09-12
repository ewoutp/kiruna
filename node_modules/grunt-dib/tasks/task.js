// grunt-dib
// =========

"use strict";
var path = require('path');

module.exports = function(grunt) {

  grunt.registerTask('dib', 'Run dib in the project folder', function() {
    var done = this.async();
    grunt.util.spawn({
      cmd: path.join(__dirname, '../node_modules/.bin/dib'),
      opts: {
        stdio: 'inherit'
      }
    }, done);
  });
};
