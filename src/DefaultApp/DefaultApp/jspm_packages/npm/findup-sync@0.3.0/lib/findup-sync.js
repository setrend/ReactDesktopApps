/* */ 
'use strict';
var path = require('path');
var glob = require('glob');
module.exports = function(patterns, options) {
  if (!Array.isArray(patterns)) {
    patterns = [patterns];
  }
  var globOptions = Object.create(options || {});
  globOptions.maxDepth = 1;
  globOptions.cwd = path.resolve(globOptions.cwd || '.');
  var files,
      lastpath;
  do {
    files = patterns.map(function(pattern) {
      return glob.sync(pattern, globOptions);
    }).reduce(function(a, b) {
      return a.concat(b);
    }).filter(function(entry, index, arr) {
      return index === arr.indexOf(entry);
    });
    if (files.length > 0) {
      return path.resolve(path.join(globOptions.cwd, files[0]));
    }
    lastpath = globOptions.cwd;
    globOptions.cwd = path.resolve(globOptions.cwd, '..');
  } while (globOptions.cwd !== lastpath);
  return null;
};
