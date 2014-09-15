"use strict";

// Docker service orchestration and watchdog tool
var _ = require('underscore');
var async = require('async');
var Configuration = require('./lib/Configuration');
var util = require('util');
var Docker = require('dockerode');
var DockerWrapper = require('./lib/DockerWrapper');
var log = require('winston');
var pkg = require('./package.json');
var keypress = require('keypress');

// Main server
var Server = function() {
	var self = this;
	self.docker = new DockerWrapper(new Docker({
		socketPath: '/var/run/docker.sock'
	}));
	self.workQueue = async.queue(function(task, cb) {
		var taskName = task.name;
		var handler = task.handler;
		log.info('Processing %s', taskName);
		handler(function(err) {
			if (err) {
				log.error('Task %s failed because: %j', taskName, err);
			}
			log.info('Task %s completed', taskName);
			cb();
		});
	});
	self.configuration = new Configuration(self.docker, function(cb) {
		// Configuration has changed
		self.workQueue.kill(); // Clear work queue
		self.workQueue.push({
			name: 'configuration-changed',
			handler: function(done) {
				self._onConfigChanged(done);
			}
		}, cb);
	});
}

/**
 * Called when the configuration has changed.
 */
Server.prototype._onConfigChanged = function(cb) {
	var self = this;
	try {
		log.info('**** Configuration change detected. Launching app...');

		// Build application
		var application = self.configuration.buildApplication();

		// Mark previous app as stopping
		if (self.application) {
			self.application.setStoppingState();
		}

		// Launch new application
		application.launch(function(err) {
			if (err) {
				log.error('Failed to launch application: %s', err);
			}
			log.verbose('Application launch process completed');
			self.application = application;
			return cb();
		});
	} catch (err) {
		log.error('Error in _onConfigChanged %s', util.inspect(err));
		return cb(err);
	}
}

/**
 * Start listening to configuration changes
 */
Server.prototype.start = function() {
	var self = this;
	// Watch for configuration changes
	self.configuration.startWatcher();

	// Start key listener
	keypress(process.stdin);
	process.stdin.setRawMode(true);
	process.stdin.on('keypress', function(c, key) {
		if (!key) return;
		if (key.ctrl && (key.name === 'c')) {
			process.exit(0);
		}
		switch (key.name) {
			case 'q':
				process.exit(0);
				break;
			case 'r':
				self.configuration.stopWatcher();
				self.configuration.startWatcher();
				break;
			case 's':
				// Stop all
				self.configuration.stopWatcher();
				if (!self.application) return;
				self.application.stopAll(function(err) {
					if (err) {
						console.log('Failed to stop services because: ' + err);
					} else {
						console.log('All services stopped');
						self.application = undefined;
					}
				});
				break;
			case 'h':
				console.log('Console:');
				console.log('r - Reload');
				console.log('s - Stop all services');
				console.log('q - Quit');
				break;
		}
	})
	process.stdin.resume();
}

//log.add(log.transports.File, { level: 'debug', filename: pkg.name + '-debug.log' });
var server = new Server();
server.start();