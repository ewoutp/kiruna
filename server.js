// Docker service orchestration and watchdog tool
var _ = require('underscore');
var async = require('async');
var Configuration = require('./lib/Configuration');
var util = require('util');
var Docker = require('dockerode');

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
			application = self.configuration.buildApplication();
			application.up(function(err) {
				if (err) return console.log('Failed to up application: ' + err);
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

var server = new Server();
server.start();