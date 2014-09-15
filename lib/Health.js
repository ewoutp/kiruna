"use strict";

//
// Health.js
// Container health checker
//

var _ = require('underscore');
var async = require('async');
var util = require('util');
var Utils = require('./Utils');
var log = require('winston');
var request = require('request');

/**
 * Health checker ctor
 * container: docker.getContainer(..)
 * tests: [ { "Http": { "Port": port, "Ip": "ip-address" } }]
 * onFailure: function()
 */
function Health(container, tests) {
	var self = this;
	self.container = container;
	self.name = container.id;
	self.tests = tests || [];
}

/**
 * Perform a health check now.
 * data: Container.inspect data
 * cb: function(err, isHealthy)
 */
Health.prototype.check = function(data, cb) {
	var self = this;
	// Inspect container first	
	log.verbose('Inspecting container %s', self.name);
	var healthy = true;
	async.each(self.tests,
		function(test, cb) {
			if (test.Http) {
				self._checkHttp(test.Http, data, function(err, isHealthy) {
					if (!isHealthy) healthy = false;
					return cb(err);
				});
			} else {
				log.warn('Unknown health test %j', test);
				cb();
			}
		},
		function(err) {
			if (err) return cb(err, false);
			return cb(null, healthy);
		});
}

/**
 * Perform a HTTP check now.
 * test: { Port: container-port, Ip: ip, Path: local-path (default: '/'), Protocol: protocol || 'http' }
 * data: Container.inspect data
 * cb: function(err, isHealthy)
 */
Health.prototype._checkHttp = function(test, data, cb) {
	var self = this;
	var containerPort = test.Port || 80;
	var ip = test.Ip;
	var path = test.Path || '/';
	var protocol = test.Protocol || 'http';

	var hostPort = Utils.getHostPort(containerPort, data);
	if (!hostPort) {
		log.error('Cannot find host port in container data for port %s in %s', containerPort, self.name);
		return cb(null, false);
	}
	var url = protocol + '://' + ip + ':' + hostPort + path;

	log.verbose('Testing HTTP: %s', url);
	var options = {
		url: url,
		strictSSL: false
	};
	request(options, function(err, response, body) {
		if (err) return cb(err, false);
		if (response.statusCode !== 200) {
			log.warn('HTTP test failed for %s: status code %d', self.name, response.statusCode);
			return cb(null, false);
		}
		log.verbose('HTTP test succeeded for %s', self.name);
		return cb(null, true);
	})
}

module.exports = Health;