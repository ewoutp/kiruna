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
	self.configuration = new Configuration(self.docker, function() {
		// Configuration has changed
		var application;
		try {
			log.info('**** Configuration change detected. Launching app...');
			application = self.configuration.buildApplication();
			application.up(function(err) {
				if (err) return log.error('Failed to up application: %s', err);
			});
		} catch (err) {
			console.log(err);
			return;
		}
	});
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