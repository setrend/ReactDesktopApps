/* */ 
var rollup = require('rollup');
var traverseTree = require('./arithmetic').traverseTree;
var getConditionModule = require('./trace').getConditionModule;
var extend = require('./utils').extend;
var getAlias = require('./utils').getAlias;
exports.rollupTree = function(loader, tree, entryPoints, traceOpts, compileOpts) {
  entryPoints = entryPoints.concat([]);
  var optimizationPoints = [];
  var entryMap = {};
  function isESM(moduleName) {
    return tree[moduleName] && tree[moduleName].metadata && tree[moduleName].metadata.format == 'esm' && !tree[moduleName].metadata.originalSource;
  }
  Object.keys(tree).forEach(function(entryPoint) {
    traverseTree(tree, entryPoint, function(depName, parentName) {
      if (parentName && isESM(depName) && !isESM(parentName) && optimizationPoints.indexOf(depName) == -1)
        optimizationPoints.push(depName);
      if (entryMap[depName])
        return false;
      if (parentName)
        entryMap[depName] = entryPoint;
    }, traceOpts);
  });
  Object.keys(tree).forEach(function(entryPoint) {
    if (!entryMap[entryPoint] && tree[entryPoint] && entryPoints.indexOf(entryPoint) == -1)
      entryPoints.push(entryPoint);
  });
  var esmEntryPoints = 0;
  entryPoints.forEach(function(entryPoint) {
    if (tree[entryPoint].metadata && tree[entryPoint].metadata.format == 'esm')
      esmEntryPoints++;
  });
  if (esmEntryPoints > 1 && esmEntryPoints == entryPoints.length) {
    var dummySource = 'export * from "' + entryPoints[0] + '";\n';
    var dummyDepMap = {};
    entryPoints.forEach(function(entryPoint) {
      dummyDepMap[entryPoint] = entryPoint;
      dummySource += 'import "' + entryPoint + '";';
    });
    tree['@dummy-entry-point'] = {
      name: '@dummy-entry-point',
      path: null,
      metadata: {format: 'esm'},
      deps: entryPoints,
      depMap: dummyDepMap,
      source: dummySource
    };
    entryPoints = ['@dummy-entry-point'];
  }
  entryPoints.forEach(function(entryPoint) {
    if (isESM(entryPoint) && optimizationPoints.indexOf(entryPoint) == -1)
      optimizationPoints.push(entryPoint);
  });
  var optimizationParentMap = {};
  for (var i = 0; i < optimizationPoints.length; i++) {
    var entryPoint = optimizationPoints[i];
    traverseTree(tree, entryPoint, function(depName, parentName) {
      if (!isESM(depName))
        return false;
      if (depName == entryPoint)
        return;
      if (optimizationPoints.indexOf(depName) != -1)
        return false;
      if (!optimizationParentMap[depName]) {
        optimizationParentMap[depName] = entryPoint;
        return;
      }
      if (optimizationParentMap[depName] != entryPoint) {
        optimizationParentMap[depName] = undefined;
        optimizationPoints.push(depName);
      }
    }, traceOpts);
  }
  var inlinedModules = [];
  var optimizationGraphExternals = {};
  optimizationPoints.forEach(function(entryPoint) {
    var externals = [];
    traverseTree(tree, entryPoint, function(depName, parentName) {
      if (!isESM(depName) || (depName != entryPoint && optimizationPoints.indexOf(depName) != -1))
        return false;
      var depLoad = tree[depName];
      depLoad.deps && depLoad.deps.forEach(function(depName) {
        depName = depLoad.depMap[depName];
        if (depName == entryPoint)
          return;
        if (!isESM(depName) || optimizationPoints.indexOf(depName) != -1) {
          if (externals.indexOf(depName) == -1)
            externals.push(depName);
        } else {
          if (inlinedModules.indexOf(depName) == -1)
            inlinedModules.push(depName);
        }
      }, traceOpts);
    });
    optimizationGraphExternals[entryPoint] = externals;
  });
  var rolledUpTree = {};
  Object.keys(tree).forEach(function(moduleName) {
    if (inlinedModules.indexOf(moduleName) == -1)
      rolledUpTree[moduleName] = tree[moduleName];
  });
  var inlineMap = {};
  inlinedModules.forEach(function(moduleName) {
    var optimizationParent = optimizationParentMap[moduleName];
    (inlineMap[optimizationParent] = inlineMap[optimizationParent] || []).push(moduleName);
  });
  var fullTreeRollup = entryPoints.length == 1 && optimizationPoints.length == 1 && Object.keys(optimizationGraphExternals).length == 1;
  return Promise.all(Object.keys(optimizationGraphExternals).map(function(entryPoint) {
    var externals = optimizationGraphExternals[entryPoint];
    if (fullTreeRollup)
      externals.forEach(function(external) {
        if (tree[external])
          fullTreeRollup = false;
      });
    var aliasedExternals = externals.map(function(external) {
      var alias = getAlias(loader, external) || externals;
      if (alias.indexOf('#:') != -1)
        alias = alias.replace('#:', '/');
      return alias;
    });
    return rollup.rollup({
      entry: entryPoint,
      external: aliasedExternals,
      plugins: [{
        resolveId: function(id, importer, options) {
          var resolved = importer ? tree[importer].depMap[id] : id;
          var externalIndex = externals.indexOf(resolved);
          if (externalIndex != -1)
            return aliasedExternals[externalIndex];
          return resolved;
        },
        load: function(id, options) {
          return tree[id].metadata.originalSource || tree[id].source;
        }
      }],
      onwarn: function(message) {}
    }).then(function(bundle) {
      var entryPointLoad = tree[entryPoint];
      var generateOptions = {
        sourceMap: compileOpts.sourceMaps,
        sourceMapFile: entryPointLoad.path
      };
      if (fullTreeRollup) {
        generateOptions.format = compileOpts.format;
        if (generateOptions.format == 'global')
          generateOptions.format = 'iife';
        if (generateOptions.format == 'esm')
          generateOptions.format = 'es6';
        if ((generateOptions.format == 'iife' || generateOptions.format == 'umd') && !compileOpts.globalName)
          throw new Error('The globalName option must be set for full-tree rollup global and UMD builds.');
        if (compileOpts.globalName)
          generateOptions.moduleName = compileOpts.globalName;
        if (compileOpts.globalDeps)
          generateOptions.globals = compileOpts.globalDeps;
      }
      var output = bundle.generate(generateOptions);
      if (fullTreeRollup)
        return {
          source: output.code,
          sourceMap: output.map
        };
      var curInlined = inlineMap[entryPoint] || [];
      var mergedDepMap = extend({}, entryPointLoad.depMap);
      var mergedDeps = [].concat(entryPointLoad.deps.filter(function(dep) {
        return externals.indexOf(entryPointLoad.depMap[dep]) != -1;
      }));
      curInlined.forEach(function(inlinedModule) {
        var inlinedLoad = tree[inlinedModule];
        mergedDeps = mergedDeps.concat(inlinedLoad.deps.filter(function(dep) {
          if (externals.indexOf(inlinedLoad.depMap[dep]) != -1) {
            if (mergedDeps.indexOf(dep) == -1)
              return true;
            if (inlinedLoad.depMap[dep] != mergedDepMap[dep])
              throw new Error('Duplicate dependency "' + dep + '" while using Rollup on "' + inlinedModule + '". Rename the dependency, or post to https://github.com/rollup/rollup/issues/424.');
          }
        }));
        extend(mergedDepMap, inlinedLoad.depMap);
      });
      rolledUpTree[entryPoint] = extend(extend({}, entryPointLoad), {
        deps: mergedDeps,
        depMap: mergedDepMap,
        metadata: extend(extend({}, entryPointLoad.metadata), {
          originalSource: undefined,
          sourceMap: output.map
        }),
        source: output.code
      });
    });
  })).then(function(outputs) {
    if (fullTreeRollup)
      return {outputs: outputs};
    return {
      tree: rolledUpTree,
      inlineMap: inlineMap
    };
  });
};
