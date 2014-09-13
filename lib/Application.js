"use strict";

//
// Application.js
//
// An Application is a collection of Services created from a single Configuration.
// The Application can bring all services up and cleanup obsolete containers.
//

var async = require('async');
var util = require('util');
var fs = require('fs');
var _ = require('underscore');
var log = require('winston');
require('winston-loggly');
var Service = require('./Service');
var pkg = require('../package.json');
var CONTAINER_POSTFIX = Service.CONTAINER_POSTFIX;

// Application class
var Application = function(docker, config) {
	var self = this;
	log.info('Application.ctor#1');
	self.docker = docker;
	self.config = config;
	self.state = {};
	self.services = self._buildServices();
	// Initialize logging
	log.info('Application.ctor#2');
	self.setupLogging();
	log.info('Application.ctor#3');
	// Link services
	log.info('Application.ctor#4');
	_.each(self.services, function(service) {
		service.linkDependencies();
	});
	// Listen to services
	log.info('Application.ctor#5');
	_.each(self.services, function(service) {
		service.on('allStarted', function() {
			log.info('Service %s is up', service.name);
			self._onServiceAllStarted(service);
		});
	});
	log.info('Application.ctor#6');
}

/**
 * Gets a service by it's name.
 * Throws an error if not found.
 */
Application.prototype.getService = function(name) {
	var self = this;
	var service = _.find(self.services, function(service) {
		return (service.name === name);
	});
	if (!service) throw new Error(util.format('Service not found: %s', name));
	return service;
}

/**
 * Are all of the services up?
 */
Application.prototype.isUp = function() {
	var self = this;
	return (self.services.length > 0) && _.every(self.services, function(s) {
		return s.isUp();
	});
}

/**
 * Pull images and launch services.
 */
Application.prototype.launch = function(cb) {
	var self = this;
	async.series([

			function(cb) {
				self._pullImages(function(err) {
					log.debug('#pullImages ended');
					return cb(err);
				});
			},
			function(cb) {
				self._launchServices(function(err) {
					log.debug('#_launchServices ended');
					return cb(err);
				});
			}
		],
		function(err) {
			if (err) {
				log.error('Failed reconfigure services: %s', err);
				return cb(err);
			}
			log.debug('Application.prototype.up$end');
			return cb();
		});
}

/**
 * Mark that this application is about to stop.
 */
Application.prototype.setStoppingState = function() {
	var self = this;
	self.state.stopping = true;
	_.each(self.services, function(service) {
		service.setStoppingState();
	});
}

/**
 * Stop all services that depend on the service with given name.
 */
Application.prototype.stopDependencies = function(serviceName, cb) {
	var self = this;
	var reverseServices = ([].concat(self.services)).reverse();
	async.each(reverseServices,
		function(service, cb) {
			if (service.dependsOn(serviceName)) {
				service.stop(cb);
			} else {
				cb();
			}
		},
		cb);
}

/**
 * Helper function used to stop a contained with given id and remove it.
 */
Application.prototype.stopAndRemoveContainer = function(id, cb) {
	var self = this;
	var dc = self.docker.getContainer(id);
	async.series([

		function(cb) {
			// Stop if needed
			dc.inspect(function(err, data) {
				if (err) {
					if (err.noSuchContainer) {
						log.debug('Cannot inspect container %s because it is gone.', id);
						return cb();
					}
					log.debug('Cannot inspect container %s because %s, probably there is no need to stop it.', id, err);
					return cb(err);
				}
				if (!data.State.Running) {
					log.debug('Container %s already stopped', id);
					return cb();
				}
				log.info('Stopping %s', data.Name);
				dc.stop(function(err) {
					if (err) {
						if (err.noSuchContainer) {
							log.verbose('Cannot stop %s because is is already gone', data.Name);
							return cb();
						}
						log.error('Failed to stop %s because: %s', data.Name, err);
						return cb(err);
					}
					return cb();
				})
			});
		},
		function(cb) {
			// Remove if needed
			dc.inspect(function(err, data) {
				if (err) {
					if (err.noSuchContainer) {
						log.debug('Cannot inspect container %s because it is gone.', id);
						return cb();
					}
					log.debug('Cannot inspect container %s because %s, probably there is no need to remove it.', id, err);
					return cb(err);
				}
				log.verbose('Removing %s', data.Name);
				dc.remove(function(err) {
					if (err) {
						if (err.noSuchContainer) {
							log.verbose('Cannot remove %s because is is already gone', data.Name);
							return cb();
						}
						log.error('Failed to remove %s because: %j', data.Name, err);
						return cb(err);
					}
					return cb();
				});
			});
		}
	], cb);
};

/**
 * Launch all given services, unless they are already up
 */
Application.prototype._launchServices = function(cb) {
	var self = this;
	// Pull all services
	log.info('Launching services');
	async.eachSeries(self.services,
		function(service, cb) {
			service.launch(cb);
		},
		cb);
}

/**
 * Pull all images
 */
Application.prototype._pullImages = function(cb) {
	var self = this;
	// Pull all services
	log.info('Pulling images');
	async.eachSeries(self.services,
		function(service, cb) {
			service.pullImage(cb);
		},
		cb);
}

/**
 * Remove obsolete containers
 */
Application.prototype._cleanup = function(cb) {
	var self = this;
	log.info('Cleanup obsolete services');
	var validIds = _.flatten(_.map(self.services, function(s) {
		return s.getContainerIds();
	}));
	//console.log('validIds=' + util.inspect(validIds));
	self.docker.listContainers({
		all: true
	}, function(err, containers) {
		if (err) return cb(err);
		async.each(containers,
			function(container, cb) {
				if (_.contains(validIds, container.Id)) {
					// This container is a valid one
					return cb();
				}
				if (_.every(container.Names, function(name) {
					return (name.indexOf(CONTAINER_POSTFIX) < 0);
				})) {
					// This container is not started by me, don't touch it
					return cb();
				}
				// This contain is obsolete, remove it
				log.info('Cleanup obsolete container %s', container.Names[0]);
				self.stopAndRemoveContainer(container.Id, cb);
			},
			cb);
	});
}

/**
 * Event handler for the 'allStarted' event of the given service.
 */
Application.prototype._onServiceAllStarted = function(service) {
	var self = this;
	if (self.isUp()) {
		log.info('Application is up.');
		self._cleanup(function(err) {
			if (err) {
				log.error('Cleanup failed', err);
			} else {
				log.verbose('Cleanup completed');
			}
		});
	}
}

/**
 * Construct a array of services from the configuration.
 */
Application.prototype._buildServices = function() {
	var self = this;
	var ServicesCfg = self.config.Services;
	var DefaultCfg = self.config.Defaults || {};
	var list = [];
	if (!ServicesCfg) {
		return list;
	}

	// Create Service instances
	list = _.map(_.keys(ServicesCfg), function(name) {
		var serviceConfig = _.extend({}, DefaultCfg, ServicesCfg[name]);
		var service = new Service(self, name, serviceConfig);
		return service;
	});

	// Sort list by dependencies
	var sortedList = [];
	var iterations = 0;
	var maxIterations = list.length * 2;

	function hasDependsOn(first, list) {
		return _.some(list, function(x) {
			return first.dependsOn(x.name);
		});
	}

	while (list.length > 0) {
		iterations++;
		if (iterations > maxIterations) throw new Error('Circular dependencies');
		var first = list.splice(0, 1)[0];
		if (hasDependsOn(first, list)) {
			// Move service backwards
			list.push(first);
		} else {
			// Service has no more dependencies in list
			sortedList.push(first);
		}
	}

	log.debug('Sorted service: %j', sortedList);

	return sortedList;
}

/**
 * Configure logging
 */
Application.prototype.setupLogging = function() {
	var self = this;
	var LoggingCfg = self.config.Logging || {};

	// Remove existing loggers
	log.clear();

	// Add console logger
	var ConsoleCfg = LoggingCfg.Console || {};
	var options = {
		level: ConsoleCfg.Level || 'info'
	};
	log.add(log.transports.Console, options);

	// Add loggly logger
	if (LoggingCfg.Loggly) {
		options = {
			level: LoggingCfg.Loggly.Level,
			subdomain: LoggingCfg.Loggly.SubDomain,
			inputToken: LoggingCfg.Loggly.Token,
			tags: LoggingCfg.Loggly.Tags || [pkg.name],
			json: true
		};
		log.add(log.transports.Loggly, options);
	}
}

// Export the class
module.exports = Application;