/* */ 
(function(process) {
  'use strict';
  function lazyCache(fn) {
    var cache = {};
    var proxy = function(mod, name) {
      name = name || camelcase(mod);
      if (process.env.UNLAZY === 'true' || process.env.UNLAZY === true || process.env.TRAVIS) {
        cache[name] = fn(mod);
      }
      Object.defineProperty(proxy, name, {
        enumerable: true,
        configurable: true,
        get: getter
      });
      function getter() {
        if (cache.hasOwnProperty(name)) {
          return cache[name];
        }
        return (cache[name] = fn(mod));
      }
      return getter;
    };
    return proxy;
  }
  function camelcase(str) {
    if (str.length === 1) {
      return str.toLowerCase();
    }
    str = str.replace(/^[\W_]+|[\W_]+$/g, '').toLowerCase();
    return str.replace(/[\W_]+(\w|$)/g, function(_, ch) {
      return ch.toUpperCase();
    });
  }
  module.exports = lazyCache;
})(require('process'));
