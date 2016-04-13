/* */ 
"use strict";
var $__checkObjectCoercible_46_js__;
var checkObjectCoercible = ($__checkObjectCoercible_46_js__ = require('./checkObjectCoercible'), $__checkObjectCoercible_46_js__ && $__checkObjectCoercible_46_js__.__esModule && $__checkObjectCoercible_46_js__ || {default: $__checkObjectCoercible_46_js__}).default;
function spread() {
  var rv = [],
      j = 0,
      iterResult;
  for (var i = 0; i < arguments.length; i++) {
    var valueToSpread = checkObjectCoercible(arguments[i]);
    if (typeof valueToSpread[Symbol.iterator] !== 'function') {
      throw new TypeError('Cannot spread non-iterable object.');
    }
    var iter = valueToSpread[Symbol.iterator]();
    while (!(iterResult = iter.next()).done) {
      rv[j++] = iterResult.value;
    }
  }
  return rv;
}
$traceurRuntime.spread = spread;
