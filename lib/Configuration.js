"use strict";

// Configuration.js
var fs = require('fs');
var Application = require('./Application');
var Service = require('./Service');
var _ = require('underscore');
var Utils = require('./Utils');

// Configuration class
var Configuration = function(docker, onChanged) {
	var self = this;
	self.docker = docker;
	self.onChanged = onChanged;
	self.path = process.env.KIRUNA_CONF || 'kiruna.conf';
	self.config = {};
}

/**
 * Read the configuration
 */
Configuration.prototype.readConfig = function() {
	var self = this;
	fs.readFile(self.path, 'utf8', function(err, data) {
		if (err) {
			console.log('Failed to read configuration file because: ' + err);
			return;
		}
		var newConfig;
		try {
			newConfig = JSON.parse(data);
		} catch (err) {
			console.log('Failed to parse configuration file because: ' + err);
			return;
		}
		var currentAsString = JSON.stringify(self.config);
		var newAsString = JSON.stringify(newConfig);
		if (currentAsString !== newAsString) {
			// Configuration has changed
			self.config = newConfig;
			self.onChanged();
		}
	});
}

/**
 * Start a change watcher
 */
Configuration.prototype.startWatcher = function() {
	var self = this;
	if (!self.watcher) {
		if (!fs.existsSync(self.path)) {
			console.log('Configuration ' + self.path + ' not found');
			return;
		}
		self.watcher = fs.watch(self.path, {
			persistent: true
		}, function(event) {
			// Wait a little while
			setTimeout(function() {
				self.watcher = undefined;
				self.readConfig();
				self.startWatcher();
			}, 500);
		});
		// Initial read
		self.readConfig();
	}
}

/**
 * Stop a change watcher
 */
Configuration.prototype.stopWatcher = function() {
	var self = this;
	if (self.watcher) {
		self.watcher.close();
		self.watcher = undefined;
	}
}

/**
 * Construct an Application from the current configuration.
 */
Configuration.prototype.buildApplication = function() {
	var self = this;

	function expandVariables(value) {
		if (!_.isString(value)) return value;
		return Utils.expandVariables(value, function(key) {
			var result = process.env[key];
			if (result) return result;
			return '';
		});
	}

	var expandedConfig = Utils.recurse(self.config, expandVariables);
	return new Application(self.docker, expandedConfig);
}

// Export the class
module.exports = Configuration;