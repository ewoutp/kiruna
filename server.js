"use strict";

// Docker service orchestration and watchdog tool
var _ = require('underscore');
var async = require('async');
var Configuration = require('./lib/Configuration');
var util = require('util');
var Docker = require('dockerode');
var log = require('winston');
var pkg = require('./package.json');

// Main server
var Server = function() {
	var self = this;
	self.docker = new Docker({
		socketPath: '/var/run/docker.sock'
	});
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
		var application = self.configuration.buildApplication();
		application.up(function(err) {
			if (err) {
				log.error('Failed to up application: %s', err);
			}
			log.info('App is up');
			return cb();
		});
	} catch (err) {
		log.error('Error in _onConfigChanged', err);
		return cb(err);
	}
}

/**
 * Start listening to configuration changes
 */
Server.prototype.start = function() {
	var self = this;
	self.configuration.startWatcher();
}

//log.add(log.transports.File, { level: 'debug', filename: pkg.name + '-debug.log' });
var server = new Server();
server.start();