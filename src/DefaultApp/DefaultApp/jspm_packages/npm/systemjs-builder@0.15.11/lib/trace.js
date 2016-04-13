/* */ 
var getCanonicalName = require('./utils').getCanonicalName;
var glob = require('glob');
var toFileURL = require('./utils').toFileURL;
var fromFileURL = require('./utils').fromFileURL;
var asp = require('bluebird').promisify;
var fs = require('fs');
var path = require('path');
var extend = require('./utils').extend;
var Promise = require('bluebird');
var getPackage = require('./utils').getPackage;
var getPackageConfigPath = require('./utils').getPackageConfigPath;
var isPackageConfig = require('./utils').isPackageConfig;
module.exports = Trace;
function Trace(loader, traceCache) {
  Object.keys(traceCache).forEach(function(canonical) {
    var load = traceCache[canonical];
    if (load && !load.conditional)
      load.fresh = false;
  });
  this.loader = loader;
  this.loads = traceCache || {};
  this.tracing = {};
}
var namedRegisterRegEx = /(System\.register(Dynamic)?|define)\(('[^']+'|"[^"]+")/g;
Trace.prototype.traceModule = function(moduleName, traceOpts) {
  var loader = this.loader;
  return Promise.resolve(loader.normalize(moduleName)).then(function(normalized) {
    return traceCanonical(getCanonicalName(loader, normalized), traceOpts);
  });
};
Trace.prototype.traceCanonical = function(canonical, traceOpts) {
  var self = this;
  return toCanonicalConditionalEnv.call(self, traceOpts.conditions).then(function(canonicalConditionalEnv) {
    if (!traceOpts.traceConditionsOnly)
      return self.getAllLoadRecords(canonical, traceOpts.excludeURLs, traceOpts.tracePackageConfig, traceOpts.traceAllConditionals, canonicalConditionalEnv, {}, []);
    else
      return self.getConditionLoadRecords(canonical, traceOpts.excludeURLs, traceOpts.tracePackageConfig, canonicalConditionalEnv, false, {}, []);
  }).then(function(loads) {
    var thisLoad = loads[canonical];
    if (thisLoad && !thisLoad.conditional && thisLoad.metadata.bundle) {
      namedRegisterRegEx.lastIndex = 0;
      var curMatch;
      while ((curMatch = namedRegisterRegEx.exec(thisLoad.source)))
        loads[curMatch[3].substr(1, curMatch[3].length - 2)] = true;
    }
    return {
      moduleName: canonical,
      tree: loads
    };
  });
};
function isLoadFresh(load, loader, loads) {
  if (load === undefined)
    return false;
  if (load === false)
    return true;
  if (load.configHash != loader.configHash)
    return false;
  if (load.fresh)
    return true;
  if (load.conditional)
    return false;
  if (load.plugin) {
    var plugin = loads[load.plugin];
    if (!isLoadFresh(plugin, loader, loads))
      return false;
  }
  try {
    var timestamp = fs.statSync(path.resolve(fromFileURL(loader.baseURL), load.path)).mtime.getTime();
  } catch (e) {}
  return load.fresh = timestamp == load.timestamp;
}
Trace.prototype.getLoadRecord = function(canonical, excludeURLs, parentStack) {
  var loader = this.loader;
  var loads = this.loads;
  if (isLoadFresh(loads[canonical], loader, loads))
    return Promise.resolve(loads[canonical]);
  if (this.tracing[canonical])
    return this.tracing[canonical];
  var self = this;
  var isPackageConditional = canonical.indexOf('/#:') != -1;
  return this.tracing[canonical] = Promise.resolve(loader.decanonicalize(canonical)).then(function(normalized) {
    if (loader.has(normalized))
      return false;
    if (!isPackageConditional)
      normalized = normalized.replace('/#:', '/');
    var booleanIndex = canonical.lastIndexOf('#?');
    if (booleanIndex != -1) {
      var condition = canonical.substr(booleanIndex + 2);
      if (condition.indexOf('|') == -1)
        condition += '|default';
      return {
        name: canonical,
        fresh: true,
        conditional: {
          condition: condition,
          branch: canonical.substr(0, booleanIndex)
        }
      };
    }
    var pkgEnvIndex = canonical.indexOf('/#:');
    if (pkgEnvIndex != -1) {
      if (canonical.indexOf('!') != -1)
        throw new Error('Unable to trace ' + canonical + ' - building package environment mappings of plugins is not currently supported.');
      var pkgName = canonical.substr(0, pkgEnvIndex);
      var subPath = canonical.substr(pkgEnvIndex + 3);
      var normalizedPkgName = loader.decanonicalize(pkgName);
      var pkg = loader.packages[normalizedPkgName];
      var loadPackageConfig;
      var packageConfigPath = getPackageConfigPath(loader.packageConfigPaths, normalizedPkgName);
      if (packageConfigPath) {
        loadPackageConfig = getCanonicalName(loader, packageConfigPath);
        (loader.meta[packageConfigPath] = loader.meta[packageConfigPath] || {}).format = 'json';
      }
      var absURLRegEx = /^[^\/]+:\/\//;
      function isPlain(name) {
        return name[0] != '.' && name[0] != '/' && !name.match(absURLRegEx);
      }
      function getMapMatch(map, name) {
        var bestMatch,
            bestMatchLength = 0;
        for (var p in map) {
          if (name.substr(0, p.length) == p && (name.length == p.length || name[p.length] == '/')) {
            var curMatchLength = p.split('/').length;
            if (curMatchLength <= bestMatchLength)
              continue;
            bestMatch = p;
            bestMatchLength = curMatchLength;
          }
        }
        return bestMatch;
      }
      function toPackagePath(subPath) {
        if (isPlain(subPath)) {
          return loader.normalize(subPath, normalizedPkgName + '/');
        } else if (subPath == '.') {
          return Promise.resolve(normalizedPkgName);
        } else if (subPath.substr(0, 2) == './') {
          var pkgMap = pkg.map;
          pkg.map = {};
          var normalized = loader.normalizeSync(pkgName + '/' + subPath.substr(2));
          pkg.map = pkgMap;
          return Promise.resolve(normalized);
        } else {
          return Promise.resolve(normalized);
        }
      }
      var envMap = pkg.map[subPath];
      var metadata = {};
      return toPackagePath(subPath).then(function(resolvedPath) {
        if (resolvedPath.match(/\#[\:\?\{]/))
          return getCanonicalName(loader, resolvedPath);
        return loader.locate({
          name: resolvedPath,
          metadata: metadata
        }).then(function(address) {
          if (metadata.build === false)
            return false;
          return new Promise(function(resolve) {
            fs.exists(fromFileURL(address), resolve);
          }).then(function(fallbackExists) {
            if (fallbackExists)
              return getCanonicalName(loader, resolvedPath);
          });
        });
      }).then(function(fallback) {
        return loader.normalize(pkg.map['@env'] || '@system-env').then(function(normalizedCondition) {
          var conditionModule = getCanonicalName(loader, normalizedCondition);
          return Promise.all(Object.keys(envMap).map(function(envCondition) {
            var mapping = envMap[envCondition];
            var negate = envCondition[0] == '~';
            return toPackagePath(mapping).then(function(normalizedMapping) {
              return {
                condition: (negate ? '~' : '') + conditionModule + '|' + (negate ? envCondition.substr(1) : envCondition),
                branch: getCanonicalName(loader, normalizedMapping)
              };
            });
          }));
        }).then(function(envs) {
          return {
            name: canonical,
            fresh: true,
            packageConfig: loadPackageConfig,
            conditional: {
              envs: envs,
              fallback: fallback
            }
          };
        });
      });
    }
    var interpolationRegEx = /#\{[^\}]+\}/;
    var interpolationMatch = canonical.match(interpolationRegEx);
    if (interpolationMatch) {
      var condition = interpolationMatch[0].substr(2, interpolationMatch[0].length - 3);
      if (condition.indexOf('|') == -1)
        condition += '|default';
      var metadata = {};
      return Promise.resolve(loader.locate({
        name: normalized.replace(interpolationRegEx, '*'),
        metadata: metadata
      })).then(function(address) {
        if (address.substr(0, 8) != 'file:///')
          metadata.build = false;
        if (metadata.build === false)
          return false;
        var globIndex = address.indexOf('*');
        return asp(glob)(fromFileURL(address), {
          dot: true,
          nobrace: true,
          noglobstar: true,
          noext: true,
          nodir: true
        }).then(function(paths) {
          var branches = {};
          paths.forEach(function(path) {
            path = toFileURL(path);
            var pathCanonical = getCanonicalName(loader, path);
            var interpolate = pathCanonical.substr(interpolationMatch.index, path.length - address.length + 1);
            if (metadata.loader) {
              if (loader.pluginFirst)
                pathCanonical = getCanonicalName(loader, metadata.loader) + '!' + pathCanonical;
              else
                pathCanonical = pathCanonical + '!' + getCanonicalName(loader, metadata.loader);
            }
            branches[interpolate] = pathCanonical;
          });
          return {
            name: canonical,
            fresh: false,
            conditional: {
              condition: condition,
              branches: branches
            }
          };
        });
      });
    }
    var load = {
      name: canonical,
      path: null,
      metadata: {},
      deps: [],
      depMap: {},
      source: null,
      fresh: true,
      timestamp: null,
      configHash: loader.configHash,
      plugin: null,
      runtimePlugin: false,
      pluginConfig: null,
      packageConfig: null,
      isPackageConfig: isPackageConfig(loader, canonical),
      deferredImports: null
    };
    var curHook = 'locate';
    var originalSource;
    return Promise.resolve(loader.locate({
      name: normalized,
      metadata: load.metadata
    })).then(function(address) {
      curHook = '';
      if (address.substr(0, 8) != 'file:///')
        load.metadata.build = false;
      if (load.metadata.build === false)
        return false;
      if (address.substr(0, 8) == 'file:///')
        load.path = path.relative(fromFileURL(loader.baseURL), fromFileURL(address));
      return Promise.resolve().then(function() {
        if (load.metadata.loaderModule)
          return Promise.resolve(loader.normalize(load.metadata.loader, normalized)).then(function(pluginNormalized) {
            load.plugin = getCanonicalName(loader, pluginNormalized);
            if (pluginNormalized.indexOf('!') == -1 && load.metadata.loaderModule.build !== false && getPackage(loader.packages, pluginNormalized)) {
              var packageConfigPath = getPackageConfigPath(loader.packageConfigPaths, pluginNormalized);
              if (packageConfigPath) {
                load.pluginConfig = getCanonicalName(loader, packageConfigPath);
                (loader.meta[packageConfigPath] = loader.meta[packageConfigPath] || {}).format = 'json';
              }
            }
          });
      }).then(function() {
        if (load.metadata.loaderModule && load.metadata.loaderModule.build === false) {
          load.runtimePlugin = true;
          return load;
        }
        curHook = 'fetch';
        return loader.fetch({
          name: normalized,
          metadata: load.metadata,
          address: address
        }).then(function(source) {
          if (typeof source != 'string')
            throw new TypeError('Loader fetch hook did not return a source string');
          originalSource = source;
          curHook = 'translate';
          if (load.metadata.timestamp) {
            load.timestamp = load.metadata.timestamp;
            load.metadata.timestamp = undefined;
          }
          return loader.translate({
            name: normalized,
            metadata: load.metadata,
            address: address,
            source: source
          });
        }).then(function(source) {
          load.source = source;
          curHook = 'instantiate';
          if (load.metadata.format == 'esm' && !load.metadata.originalSource) {
            curHook = 'es module parsing';
            var esmCompiler = require('../compilers/esm');
            load.metadata.parseTree = esmCompiler.parse(source);
            return Promise.resolve({deps: esmCompiler.getDeps(load.metadata.parseTree)});
          }
          return loader.instantiate({
            name: normalized,
            metadata: load.metadata,
            address: address,
            source: source
          });
        }).then(function(result) {
          curHook = '';
          if (!result)
            throw new TypeError('Native ES Module builds not supported. Ensure transpilation is included in the loader pipeline.');
          load.deps = result.deps;
          if (load.metadata.format == 'esm' && load.metadata.originalSource)
            load.source = originalSource;
          if (getPackage(loader.packages, normalized) && !load.isPackageConfig) {
            var packageConfigPath = getPackageConfigPath(loader.packageConfigPaths, normalized);
            if (packageConfigPath) {
              load.packageConfig = getCanonicalName(loader, packageConfigPath);
              (loader.meta[packageConfigPath] = loader.meta[packageConfigPath] || {}).format = 'json';
            }
          }
          var sourceMap = load.metadata.sourceMap;
          if (sourceMap) {
            if (typeof sourceMap == 'string')
              sourceMap = load.metadata.sourceMap = JSON.parse(sourceMap);
            var originalName = load.name.split('!')[0];
            sourceMap.file = originalName + '!transpiled';
            if (!sourceMap.sources || sourceMap.sources.length <= 1)
              sourceMap.sources = [originalName];
          }
          return Promise.all(result.deps.map(function(dep) {
            return loader.normalize(dep, normalized, address).then(function(normalized) {
              try {
                load.depMap[dep] = getCanonicalName(loader, normalized);
              } catch (e) {
                if (!excludeURLs || normalized.substr(0, 7) == 'file://')
                  throw e;
                (loader.meta[normalized] = loader.meta[normalized] || {}).build = false;
                load.depMap[dep] = normalized;
              }
            });
          }));
        });
      }).catch(function(err) {
        var msg = (curHook ? ('Error on ' + curHook + ' for ') : 'Error tracing ') + canonical + ' at ' + normalized;
        if (parentStack)
          parentStack.reverse().forEach(function(parent) {
            msg += '\n\tLoading ' + parent;
          });
        var newMsg = msg + '\n\t' + (err.message || err);
        var newErr = new Error(newMsg, err.fileName, err.lineNumber);
        newErr.originalErr = err.originalErr || err;
        newErr.stack = msg + '\n\t' + (err.stack || err);
        throw newErr;
      }).then(function() {
        load.metadata.entry = undefined;
        load.metadata.builderExecute = undefined;
        load.metadata.parseTree = undefined;
        return load;
      });
    });
  }).then(function(load) {
    self.tracing[canonical] = undefined;
    return loads[canonical] = load;
  }).catch(function(err) {
    self.tracing[canonical] = undefined;
    throw err;
  });
};
var systemModules = ['@empty', '@system-env', '@@amd-helpers', '@@global-helpers'];
Trace.prototype.getAllLoadRecords = function(canonical, excludeURLs, tracePackageConfig, traceAllConditionals, canonicalConditionalEnv, curLoads, parentStack) {
  var loader = this.loader;
  curLoads = curLoads || {};
  if (canonical in curLoads)
    return curLoads;
  var self = this;
  return this.getLoadRecord(canonical, excludeURLs, parentStack).then(function(load) {
    if (systemModules.indexOf(canonical) == -1)
      curLoads[canonical] = load;
    if (load) {
      parentStack = parentStack.concat([canonical]);
      return Promise.all(Trace.getLoadDependencies(load, tracePackageConfig, true, traceAllConditionals, canonicalConditionalEnv).map(function(dep) {
        return self.getAllLoadRecords(dep, excludeURLs, tracePackageConfig, traceAllConditionals, canonicalConditionalEnv, curLoads, parentStack);
      }));
    }
  }).then(function() {
    return curLoads;
  });
};
Trace.prototype.getConditionLoadRecords = function(canonical, excludeURLs, tracePackageConfig, canonicalConditionalEnv, inConditionTree, curLoads, parentStack) {
  var loader = this.loader;
  if (canonical in curLoads)
    return curLoads;
  var self = this;
  return this.getLoadRecord(canonical, excludeURLs, parentStack).then(function(load) {
    if (inConditionTree && systemModules.indexOf(canonical) == -1)
      curLoads[canonical] = load;
    if (load) {
      parentStack = parentStack.concat([canonical]);
      return Promise.all(Trace.getLoadDependencies(load, tracePackageConfig, true, true, canonicalConditionalEnv, true).map(function(dep) {
        return self.getConditionLoadRecords(dep, excludeURLs, tracePackageConfig, canonicalConditionalEnv, true, curLoads, parentStack);
      })).then(function() {
        return Promise.all(Trace.getLoadDependencies(load, tracePackageConfig, true, true, canonicalConditionalEnv).map(function(dep) {
          return self.getConditionLoadRecords(dep, excludeURLs, tracePackageConfig, canonicalConditionalEnv, inConditionTree, curLoads, parentStack);
        }));
      });
    }
  }).then(function() {
    return curLoads;
  });
};
function conditionalComplement(condition) {
  var negative = condition[0] == '~';
  return (negative ? '' : '~') + condition.substr(negative);
}
function toCanonicalConditionalEnv(conditionalEnv) {
  var loader = this.loader;
  var canonicalConditionalEnv = {};
  return Promise.all(Object.keys(conditionalEnv).map(function(m) {
    var negate = m[0] == '~';
    var exportIndex = m.lastIndexOf('|');
    var moduleName = m.substring(negate, exportIndex != -1 ? exportIndex : m.length);
    return loader.normalize(moduleName).then(function(normalized) {
      var canonicalCondition = (negate ? '~' : '') + getCanonicalName(loader, normalized) + (exportIndex != -1 ? m.substr(exportIndex) : '|default');
      canonicalConditionalEnv[canonicalCondition] = conditionalEnv[m];
    });
  })).then(function() {
    return canonicalConditionalEnv;
  });
}
Trace.prototype.inlineConditions = function(tree, loader, conditionalEnv) {
  var self = this;
  return toCanonicalConditionalEnv.call(this, conditionalEnv).then(function(canonicalConditionalEnv) {
    var inconsistencyErrorMsg = 'For static condition inlining only an exact environment resolution can be built, pending https://github.com/systemjs/builder/issues/311.';
    for (var c in conditionalEnv) {
      var val = conditionalEnv[c];
      if (typeof val == 'string')
        continue;
      var complement = conditionalComplement(c);
      if (val instanceof Array || complement in conditionalEnv && conditionalEnv[complement] != !conditionalEnv[c])
        throw new TypeError('Error building condition ' + c + '. ' + inconsistencyErrorMsg);
    }
    var conditionalResolutions = {};
    var importsSystemEnv = false;
    Object.keys(tree).filter(function(m) {
      return tree[m] && tree[m].conditional;
    }).forEach(function(c) {
      var resolution = Trace.getConditionalResolutions(tree[c].conditional, false, conditionalEnv);
      var branches = resolution.branches;
      if (branches.length > 1)
        throw new TypeError('Error building condition ' + c + '. ' + inconsistencyErrorMsg);
      if (branches.length == 0)
        throw new TypeError('No resolution found at all for condition ' + c + '.');
      conditionalResolutions[c] = branches[0];
    });
    Object.keys(conditionalResolutions).forEach(function(c) {
      var resolution = conditionalResolutions[c];
      while (conditionalResolutions[resolution]) {
        resolution = conditionalResolutions[resolution];
        conditionalResolutions[c] = resolution;
      }
    });
    var inlinedTree = {};
    Object.keys(tree).forEach(function(m) {
      var load = tree[m];
      if (typeof load == 'boolean') {
        inlinedTree[m] = load;
        return;
      }
      if (load.conditional)
        return;
      var clonedLoad = extend({}, load);
      clonedLoad.depMap = {};
      Object.keys(load.depMap).forEach(function(d) {
        var normalizedDep = load.depMap[d];
        normalizedDep = conditionalResolutions[normalizedDep] || normalizedDep;
        if (normalizedDep == '@system-env')
          importsSystemEnv = true;
        if (normalizedDep.indexOf(/#[\:\?\{]/) != -1)
          throw new Error('Unable to inline conditional dependency ' + normalizedDep + '. Try including the ' + d + ' dependency of ' + load.name + ' in the build.');
        clonedLoad.depMap[d] = normalizedDep;
      });
      inlinedTree[m] = clonedLoad;
    });
    if (importsSystemEnv) {
      inlinedTree['@system-env'] = {
        name: '@system-env',
        path: null,
        metadata: {format: 'json'},
        deps: [],
        depMap: {},
        source: JSON.stringify({
          production: conditionalEnv['@system-env|production'],
          browser: conditionalEnv['@system-env|browser'],
          node: conditionalEnv['@system-env|node']
        }),
        fresh: true,
        timestamp: null,
        configHash: loader.configHash
      };
    }
    return inlinedTree;
  });
};
Trace.getConditionalResolutions = function(conditional, traceAllConditionals, conditionalEnv) {
  if (traceAllConditionals !== false)
    traceAllConditionals = true;
  conditionalEnv = conditionalEnv || {};
  var resolution = {
    condition: null,
    branches: []
  };
  function envTrace(condition) {
    var negate = condition[0] == '~';
    resolution.condition = condition.substr(negate, condition.lastIndexOf('|') - negate);
    var envTrace = conditionalEnv[condition];
    return envTrace === undefined ? traceAllConditionals : envTrace;
  }
  var deps = [];
  if (conditional.branch) {
    if (envTrace(conditional.condition))
      resolution.branches.push(conditional.branch);
    else
      resolution.branches.push('@empty');
  } else if (conditional.envs) {
    var doFallback = true;
    conditional.envs.forEach(function(env) {
      if (envTrace(env.condition))
        resolution.branches.push(env.branch);
      if (!envTrace(conditionalComplement(env.condition)))
        doFallback = false;
    });
    var resolutionCondition = resolution.condition;
    if (doFallback && conditional.fallback)
      resolution.branches.push(conditional.fallback);
  } else if (conditional.branches) {
    var et = envTrace(conditional.condition);
    if (et !== undefined && et !== false) {
      Object.keys(conditional.branches).forEach(function(branch) {
        var dep = conditional.branches[branch];
        if (et === true)
          resolution.branches.push(dep);
        else if (et.indexOf(branch) != -1)
          resolution.branches.push(dep);
      });
    }
  }
  return resolution;
};
Trace.getLoadDependencies = function(load, tracePackageConfig, traceRuntimePlugin, traceAllConditionals, canonicalConditionalEnv, conditionsOnly) {
  if (traceAllConditionals !== false)
    traceAllConditionals = true;
  canonicalConditionalEnv = canonicalConditionalEnv || {};
  var deps = [];
  if (!load.conditional && conditionsOnly)
    return deps;
  if (load.conditional) {
    var resolution = Trace.getConditionalResolutions(load.conditional, traceAllConditionals, canonicalConditionalEnv);
    if (tracePackageConfig && load.packageConfig)
      deps.push(load.packageConfig);
    deps.push(resolution.condition);
    if (conditionsOnly)
      return deps;
    else
      return deps.concat(resolution.branches);
  }
  if (traceRuntimePlugin && load.runtimePlugin)
    deps.push(load.plugin);
  if (tracePackageConfig && load.pluginConfig)
    deps.push(load.pluginConfig);
  load.deps.forEach(function(dep) {
    deps.push(load.depMap[dep]);
  });
  if (tracePackageConfig && load.packageConfig)
    deps.push(load.packageConfig);
  return deps;
};
