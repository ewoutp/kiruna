"use strict";

//
// Health.js
// Container health checker
//

var _ = require('underscore');
var async = require('async');
var util = require('util');
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
 * cb: function(err, isHealthy)
 */
Health.prototype.check = function(cb) {
	var self = this;
	// Inspect container first
	log.verbose('Inspecting container %s', self.name);
	self.container.inspect(function(err, data) {
		if (err) {
			log.error('Container %s not found', self.name, err);
			return cb(err, false);
		}
		if (!data.State || !data.State.Running) {
			log.error('Container %s is no longer running', self.name);
			return cb(null, false);
		}
		return cb(null, true);
	});
}

module.exports = Health;