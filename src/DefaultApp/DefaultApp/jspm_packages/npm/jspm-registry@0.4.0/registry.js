/* */ 
(function(process) {
  var Promise = require('rsvp').Promise;
  var asp = require('rsvp').denodeify;
  var fs = require('graceful-fs');
  var exec = require('child_process').exec;
  var semver = require('semver');
  var path = require('path');
  var rimraf = require('rimraf');
  function extend(a, b) {
    for (var p in b)
      a[p] = b[p];
    return a;
  }
  var defaultRepo = 'https://github.com/jspm/registry.git';
  var registry = module.exports = function registry(options, ui) {
    this.ui = ui;
    this.registryPath = options.tmpDir;
    this.registryUpdated = false;
    this.repo = options.repo || defaultRepo;
    this.execOptions = {
      cwd: options.tmpDir,
      timeout: options.timeout * 1000,
      killSignal: 'SIGKILL'
    };
    this.username = options.username;
    this.password = options.password;
  };
  registry.configure = function(config, ui) {
    return ui.input('Enter the registry repo path', config.repo || defaultRepo).then(function(repo) {
      if (repo.substr(0, 2) == '~/')
        repo = path.resolve(process.env.HOME || process.env.USERPROFILE || process.env.HOMEPATH, repo.substr(2));
      else if (repo.substr(0, 1) == '.')
        repo = path.resolve(repo);
      config.repo = repo;
      return config;
    });
  };
  registry.prototype.parse = function(name) {
    var parts = name.split('/');
    return {
      package: parts[0],
      path: parts.splice(1).join('/')
    };
  };
  registry.prototype.locate = function(repo) {
    return this.updateRegistry().then(function(registry) {
      var registryEntry = registry[repo];
      if (!registryEntry)
        return {notfound: true};
      return {redirect: registryEntry};
    });
  };
  registry.prototype.getOverride = function(endpoint, repo, version, givenOverride) {
    var packageParts = repo.split('/');
    var overrideName = packageParts.pop();
    var overrideDir = path.resolve(this.registryPath, 'package-overrides', endpoint, packageParts.join('/'));
    var ui = this.ui;
    return this.updateRegistry().then(function() {
      return asp(fs.readdir)(overrideDir);
    }).then(function(files) {
      var overrideFile = files.filter(function(file) {
        return file.substr(0, overrideName.length) == overrideName && file.substr(overrideName.length, 1) == '@';
      }).map(function(file) {
        return {
          version: file.substr(overrideName.length + 1, file.length - overrideName.length - 6),
          file: file
        };
      }).filter(function(item) {
        if (semver.valid(version))
          return semver.satisfies(version, '^' + item.version);
        else
          return version == item.version;
      }).sort(function(a, b) {
        return semver.compare(a.version, b.version);
      }).map(function(item) {
        return item.file;
      }).pop();
      if (!overrideFile)
        return;
      return asp(fs.readFile)(path.resolve(overrideDir, overrideFile)).then(function(pjson) {
        try {
          return JSON.parse(pjson);
        } catch (e) {
          return;
        }
      }, function(err) {
        if (err.code === 'ENOENT')
          return;
        ui.log('warn', 'Override file `' + overrideFile + '` found, but JSON is invalid');
      });
    }, function(err) {
      if (err.code === 'ENOENT')
        return;
      throw err;
    }).then(function(override) {
      if (givenOverride)
        extend(override = (override || {}), givenOverride);
      return override;
    });
  };
  registry.prototype.createRegistry = function() {
    var ui = this.ui;
    ui.log('info', 'Creating registry cache...');
    var self = this;
    return asp(rimraf)(path.resolve(this.registryPath)).then(function() {
      return asp(fs.mkdir)(path.resolve(self.registryPath));
    }).then(function() {
      return asp(exec)('git clone --depth=1 ' + self.repo + ' .', self.execOptions);
    }).catch(function(err) {
      ui.log('err', 'Error creating registry file\n' + (err.stack || err));
    });
  };
  registry.prototype.updateRegistry = function() {
    if (this.updatePromise_)
      return Promise.resolve(this.updatePromise_);
    var ui = this.ui;
    var registryPath = this.registryPath;
    var remoteString = this.repo;
    var execOptions = this.execOptions;
    var self = this;
    return this.updatePromise_ = asp(exec)('git remote show origin -n', execOptions).then(function(output) {
      output = output.toString();
      var curRepoMatch = output.match(/Fetch URL: ([^\n]+)/m);
      if (!curRepoMatch || curRepoMatch[1] != self.repo)
        return self.createRegistry();
      ui.log('info', 'Updating registry cache...');
      return asp(exec)('git fetch --all && git reset --hard origin/master', execOptions).then(function(stdout, stderr) {
        if (stderr)
          throw stderr;
      });
    }, function(err) {
      err = err.toString();
      if (err.indexOf('Not a git repo') != -1)
        return self.createRegistry();
    }).then(function() {
      return asp(fs.readFile)(path.resolve(registryPath, 'registry.json')).then(function(pjson) {
        try {
          return JSON.parse(pjson);
        } catch (e) {
          return {};
        }
      }, function(err) {
        if (err.code === 'ENOENT')
          return {};
        ui.log('warn', 'Registry file is invalid.');
      });
    }).then(function(json) {
      return json;
    });
  };
})(require('process'));
