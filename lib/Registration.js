"use strict";

//
// Registration.js
//
// Support class for adding values to the distributed registration store (etcd).
//

var log = require('winston');
var Etcd = require('node-etcd');

/**
 * Setup a link to the registration store
 */
var Registration = function(config) {
	var self = this;
	config = config || {};
	self.config = config;
	self.ttl = config.Ttl || 60;
	self.prefix = config.Prefix || '/';
	self.ip = config.Ip;
	if (!config.Ip) throw new Error('No Ip found in registration config');
	var host = config.Host || 'etcd';
	var port = config.Port || 4001;
	log.info('Using %s:%d for registration', host, port);
	self.etcd = new Etcd(host, port);
}

/**
 * Register a port in a container
 */
Registration.prototype.registerContainer = function(serviceName, containerIndex, containerPort, hostPort, cb) {
	var self = this;
	var key = self.prefix + serviceName + '/' + self.ip + ':' + containerIndex + ':' + containerPort;
	var value = self.ip + ':' + hostPort;
	var options = { ttl: self.ttl };
	self._set(key, value, options, cb);
}

/**
 * Setup a link to the registration store
 * key: Key where to store
 * value: Value to put in the store
 * options: { ttl: number }
 * cb: function(err)
 */
Registration.prototype._set = function(key, value, options, cb) {
	var self = this;
	self.etcd.set(key, value, options, function(err) {
		if (err) {
			log.error('Cannot set %s into etcd', key, err);			
		}
		return cb(err);
	});
}

// Export the class
module.exports = Registration;
