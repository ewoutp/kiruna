"use strict";

var _ = require('underscore');
var async = require('async');
var util = require('util');
var log = require('winston');
var Health = require('./Health');
var EventEmitter = require('events').EventEmitter;

var WATCH_TIMEOUT = 15000; // 15 seconds

/**
 * Wrap a single instance of a service, in other words a wrapper around a docker container.
 * service: Service
 * container: docker.getContainer(...)
 */
var Container = function(service, container) {
	var self = this;
	self.service = service;
	self.container = container;
	self.health = new Health(container, service.options.Health);
	self.state = {};
	self.watchTimeout = 250; // Set initial timeout low, so we know quickly when the container has started
}

// Setup inheritance
util.inherits(Container, EventEmitter);

/**
 * Perform an initial inspection to initial some data structures.
 */
Container.prototype.initialize = function(cb) {
	var self = this;
	self.container.inspect(function(err, data) {
		if (err) return cb(err);
		self.data = data;
		self.name = data.Name;
		return cb();
	});
}

/**
 * Start a background process watching for changes (started, stopped, not healthy) on the container.
 */
Container.prototype.startWatching = function() {
	var self = this;
	setTimeout(function() {
		// Do not check when I'm about to stop
		if (self.state.stopping) return;

		// Check my health
		self._checkHealth(function() {
			if (!self.isStopped()) {
				// Reset the timer
				self.startWatching();
			}
		});
	}, self.watchTimeout);
}

/**
 * Gets the id of this instance.
 */
Container.prototype.getId = function() {
	var self = this;
	return self.container.id;
}

/**
 * Gets the name of this instance.
 */
Container.prototype.getName = function() {
	var self = this;
	if (!self.name) throw new Error('Name has not been set yet');
	return self.name;
}

/**
 * Has this instance completed its startup and passed its first health check?
 */
Container.prototype.isStarted = function() {
	return this.state.started;
}

/**
 * Has this instance stopped.
 */
Container.prototype.isStopped = function() {
	return this.state.stopped;
}

/**
 * Was this instance ok during the last health check?
 */
Container.prototype.isRunning = function() {
	return this.state.started && !this.state.stopped;
}

/**
 * Mark that this container is about to stop.
 */
Container.prototype.setStoppingState = function() {
	this.state.stopping = true;
}

/**
 * Run the health checker for this instance.
 * Fire appropriate events when changes happen.
 * cb: function(err)
 */
Container.prototype._checkHealth = function(cb) {
	var self = this;

	// Emit the 'stopped' event if that was not emitted before.
	function emitStopped() {
		if (!self.state.stopped) {
			self.state.stopped = true;
			self.emit('stopped');
		}
	}

	// Emit the 'started' event if that was not emitted before.
	function emitStarted() {
		if (!self.state.started) {
			self.state.started = true;
			self.emit('started');
		}
	}

	// Inspect the docker container first
	self.container.inspect(function(err, data) {
		if (err) {
			// Container is gone
			if (err.noSuchContainer) {
				log.warn('Container %s is gone', self.name);
			} else {
				log.error('Cannot inspect container %s', self.name, err);
			}
			emitStopped();
			return cb();
		}
		if (!data.State || !data.State.Running) {
			// Container has stopped
			log.warn('Container %s has stopped', self.name);
			emitStopped();
			return cb();
		}
		// Perform configured health checks
		self.health.check(function(err, isHealthy) {
			if (isHealthy) {
				log.verbose('Container %s is healthy', self.name);
				self.watchTimeout = WATCH_TIMEOUT;
				emitStarted();
				return cb();
			}
			log.warn('Container %s is NOT healthy, stopping it', self.name);
			self.container.stop(function(err) {
				if (err) {
					if (err.noSuchContainer) {
						log.warn('Cannot stop container %s because it is gone', self.name);
					} else {
						log.error('Failed to stop container %s', self.name, err);
					}
				}
				emitStopped();
				return cb();
			});
		});
	});
}

// Export the class
module.exports = Container;