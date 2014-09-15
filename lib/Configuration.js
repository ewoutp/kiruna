"use strict";

// Configuration.js
var fs = require('fs');
var Application = require('./Application');
var Service = require('./Service');
var _ = require('underscore');
var Utils = require('./Utils');
var util = require('util');
var log = require('winston');

// Configuration class
var Configuration = function(docker, onChanged) {
	var self = this;
	self.docker = docker;
	self.onChanged = onChanged;
	self.path = process.env.KIRUNA_CONF || 'kiruna.conf';
	self.config = {};
	log.info('Using config file %s', self.path);
}

/**
 * Read the configuration
 */
Configuration.prototype._readConfig = function(cb) {
	var self = this;
	fs.readFile(self.path, 'utf8', function(err, data) {
		if (err) {
			log.error('Failed to read configuration file because: %j', err);
			return cb(err);
		}
		var newConfig;
		try {
			newConfig = JSON.parse(data);
		} catch (err) {
			log.error('Failed to parse configuration file because: %s', err.toString());
			return cb(err);
		}
		var currentAsString = JSON.stringify(self.config);
		var newAsString = JSON.stringify(newConfig);
		if (currentAsString === newAsString) {
			// Configuration has not changed
			return cb();
		} else {
			// Configuration has changed
			self.config = newConfig;
			self.onChanged(cb);
		}
	});
}

/**
 * Start a change watcher
 */
Configuration.prototype.startWatcher = function() {
	var self = this;
	if (self.watcher) return;
	if (!fs.existsSync(self.path)) {
		console.log('Configuration ' + self.path + ' not found');
		return;
	}
	// Initial read
	self._readConfig(function() {
		// Read now, now create watcher
		log.verbose('Start configuration watcher for %s', self.path);
		self.watcher = fs.watch(self.path, {
			persistent: true
		}, function(event) {
			if (self.watcher) self.watcher.close();
			self.watcher = undefined;
			// Wait a little while
			setTimeout(function() {
				self.startWatcher();
			}, 500);
		});
	});
}

/**
 * Stop a change watcher
 */
Configuration.prototype.stopWatcher = function() {
	var self = this;
	if (self.watcher) {
		self.watcher.close();
		self.watcher = undefined;
		self.config = {};
	}
}

/**
 * Construct an Application from the current configuration.
 */
Configuration.prototype.buildApplication = function() {
	var self = this;
	var variables = self.config.Variables || {};

	function expandVariables(value) {
		if (!_.isString(value)) return value;
		return Utils.expandVariables(value, function(key) {
			var result = variables[key] || process.env[key];
			if (result) return result;
			console.log(util.inspect(process.env));
			throw new Error(util.format('Undefined variable "%s"', key));
		});
	}
	var expandedConfig = Utils.recurse(self.config, expandVariables);
	return new Application(self.docker, expandedConfig);
}

// Export the class
module.exports = Configuration;