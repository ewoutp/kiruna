"use strict";

var _ = require('underscore');
var async = require('async');
var util = require('util');
var Utils = require('./Utils');
var log = require('winston');
var Container = require('./Container');
var EventEmitter = require('events').EventEmitter;

var CONTAINER_POSTFIX = '_kir';
var CONTAINER_NAME_REGEX = /[-:\/\.]/g;
var MAX_FAILURES = 20;

/**
 * Wrap a single service in the form of a named docker image
 * Events:
 * 'started': The first container running this service has started and is healthy.
 * 'allStarted': All containers running this service have been started and are healthy.
 */
var Service = function(application, name, options) {
	var self = this;
	self.application = application;
	self.docker = application.docker;
	self.options = _.extend({
		Enabled: true,
		Scale: 1
	}, options || {});
	self.name = name;
	self.imageName = self.options.Image + ':' + self.options.Tag;
	self.containers = [];
	if (!self.name) {
		throw new Error('Specify a name');
	}
	if (!self.options.Image) {
		throw new Error(util.format('Specify an Image in %s', self.name));
	}
	if (!self.options.Tag) {
		throw new Error(util.format('Specify a Tag in %s', self.name));
	}
	self.recentFailures = 0;
	self.workQueue = async.queue(function(task, cb) {
		task(cb);
	});
}

// Setup inheritance
util.inherits(Service, EventEmitter);

/**
 * Does this service depend on another service with given name?
 */
Service.prototype.dependsOn = function(otherServiceName) {
	var self = this;
	var dependencyNames = self.options.Dependencies || [];
	return _.contains(dependencyNames, otherServiceName);
}

/**
 * Link myself to all services I depend on.
 * This function must be called after all services this service depends on have already be linked.
 */
Service.prototype.linkDependencies = function() {
	var self = this;
	// Build list of services I depend on (directly or indirectly)
	self.dependencies = [];
	var dependencyNames = self.options.Dependencies || [];
	_.each(dependencyNames, function(name) {
		var service = self.application.getService(name);
		self.dependencies.push(service);
		self.dependencies = _.union(self.dependencies, service.dependencies);
	});
	// Listen to dependency service events
	_.each(self.dependencies, function(service) {
		service.on('started', function() {
			self._onDependentServiceStarted();
		});
		service.on('stopped', function() {
			self._onDependentServiceStopped();
		});
	});
	log.verbose('Dependencies of %s are %s', self.name, _.map(self.dependencies, function(s) {
		return s.name;
	}));
}

/**
 * Gets the id of the first container running this service.
 * Throws an error if there are no containers.
 */
Service.prototype._getFirstContainerName = function() {
	var self = this;
	if (self.containers.length === 0) throw new Error(util.format('No containers exist in service: %s', self.name));
	return self.containers[0].getName();
}

/**
 * Gets the id's of the containers running this service.
 */
Service.prototype.getContainerIds = function() {
	var self = this;
	return _.map(self.containers, function(c) {
		return c.getId();
	});
}

/**
 * Is at least one of containers running this service in the running state?
 */
Service.prototype.isRunning = function() {
	var self = this;
	return (self.containers.length > 0) && _.some(self.containers, function(c) {
		return c.isRunning();
	});
}

/**
 * Are all of the containers running this service in the running state?
 */
Service.prototype.isUp = function() {
	var self = this;
	return (self.containers.length > 0) && _.every(self.containers, function(c) {
		return c.isRunning();
	});
}

/**
 * Gets the names of all services that I depend on that are not running with at least 1 container.
 */
Service.prototype._getNonRunningDependencies = function() {
	var self = this;
	if (!self.dependencies) throw new Error('Dependencies not yet linked');
	return _.map(_.filter(self.dependencies, function(s) {
		return !s.isRunning();
	}), function(s) {
		return s.name;
	});
}

/**
 * Pull the image from the registry.
 * If the image is already available locally, the callback will be called right away.
 */
Service.prototype.pullImage = function(cb) {
	var self = this;
	var docker = self.docker;
	// See if the image exists locally
	var img = docker.getImage(self.imageName);
	img.inspect(function(err, data) {
		if (!err) {
			// Image found
			log.verbose('Image found locally: %s', self.imageName);
			return cb();
		}
		log.debug('img.inspect[%s] failed: %s', self.imageName, err);
		// Image not yet found, pull it
		var opts = {
			fromImage: self.options.Image,
			tag: self.options.Tag
		};
		if (self.options.Registry) opts.registry = self.options.Registry;
		console.log(opts);
		docker.createImage(opts, function(err, stream) {
			if (err) return cb(err);
			stream.on('error', function(err) {
				cb(err);
			});
			stream.once('end', function() {
				// Inspect again
				img.inspect(cb);
			});
			stream.pipe(process.stdout);
		});
	});
}

/**
 * Create the name of the containers for this service
 */
Service.prototype._createContainerName = function(index, includeIndex) {
	var self = this;
	var hash = Utils.hashObject(self.options, true);
	if (hash.length > 16) hash = hash.slice(0, 16);
	var prefix = (self.name + '-' + hash).replace(CONTAINER_NAME_REGEX, '_') + '__';
	if (includeIndex) return prefix + index + CONTAINER_POSTFIX;
	return prefix;
}

/**
 * Launch this service (if needed)
 */
Service.prototype.launch = function(cb) {
	var self = this;
	log.verbose('Launching %s...', self.name);
	async.series([

		function(cb) {
			// Query which containers are already running 
			self._collectRunningContainers(cb);
		},
		function(cb) {
			// Stop first in case of hard deploy (and no containers are already running)			
			if ((self.containers.length === 0) && self.options.HardDeploy) {
				log.info('Hard deploy: %s', self.name);
				self.stop(function(err) {
					log.verbose('Done stop %s', self.name);
					return cb(err);
				});
			} else {
				cb();
			}
		},
		function(cb) {
			// Start container
			self.launched = true;
			self._startContainers(cb);
		}
	], cb);
}

/**
 * Stop all containers
 */
Service.prototype.stop = function(cb) {
	var self = this;
	_.each(self.containers, function(container) {
		container.setStoppingState();
	});
	self.containers = [];
	async.series([

		function(cb) {
			self.application.stopDependencies(self.name, cb);
		},
		function(cb) {
			self._stopOldContainers(true, cb);
		}
	], cb);
}

/**
 * Query a list of properly configured and running containers for this service.
 * Store the ids of those containers in self.containers.
 */
Service.prototype._collectRunningContainers = function(cb) {
	var self = this;

	function worker(cb) {
		log.info('Collecting running container info for %s', self.name);
		var indexes = _.range(self.options.Scale);
		async.eachSeries(indexes,
			function(index, cb) {
				self._collectRunningContainer(index, cb);
			}, cb);
	}

	self._pushWork(worker, cb);
}

/**
 * Query a list of properly configured and running containers for this service.
 * Store the ids of those containers in self.containers.
 */
Service.prototype._collectRunningContainer = function(index, cb) {
	var self = this;
	var name = self._createContainerName(index, true);

	var container = self.docker.getContainer(name);
	container.inspect(function(err, data) {
		if (!err) {
			// Container already found, is it running?
			if (data.State && data.State.Running) {
				// Yes it is running
				log.verbose('Container %s already running %s', name, container.id);
				return self._registerContainer(container, cb);
			}
		}
		return cb();
	});
}

/**
 * Start the right number of containers
 */
Service.prototype._startContainers = function(cb) {
	var self = this;

	function worker(cb) {
		var nonRunningServices = self._getNonRunningDependencies();
		if (nonRunningServices.length > 0) {
			log.verbose('Delaying startup of %s, waiting for %s', self.name, nonRunningServices);
			return cb();
		}
		var indexes = _.range(self.options.Scale);
		async.eachSeries(indexes,
			function(index, cb) {
				self._startContainer(index, cb);
			},
			function(err) {
				cb(err);
			});
	}

	self._pushWork(worker, cb);
}

/**
 * Start a new containers that runs the current version of this service.
 * If a contain with the right name already exists, do nothing
 */
Service.prototype._startContainer = function(index, cb) {
	var self = this;
	var name = self._createContainerName(index, true);

	function createAndStartContainer(cb) {
		// Create and start container
		var createOpts = {
			name: name,
			Image: self.imageName
		};
		var startOpts = {};
		// Setup port mappings
		if (self.options.Ports) {
			startOpts.PortBindings = {};
			_.each(_.keys(self.options.Ports), function(port) {
				startOpts.PortBindings[port] = [self._SplitHostPort(self.options.Ports[port])]
			});
		}
		if (self.options.PublishAllPorts) {
			startOpts.PublishAllPorts = true;
		}
		if (self.options.Expose) {
			createOpts.ExposedPorts = {};
			_.each(self.options.Expose, function(x) {
				createOpts.ExposedPorts[x] = {};
			});
		}
		// Setup container links
		if (self.options.Dependencies) {
			startOpts.Links = [];
			_.each(self.options.Dependencies, function(dependency) {
				var link = self._SplitDependencyIntoLink(dependency);
				var service = self.application.getService(link.Name);
				log.debug('Found dependency %s -> %s for %s', link.Name, service.name, self.name);
				var containerName = service._getFirstContainerName();
				startOpts.Links.push(containerName + ':' + link.InternalName);
			});
		}
		// Setup container volumes 
		if (self.options.Volumes) {
			startOpts.Binds = [];
			_.each(_.keys(self.options.Volumes), function(directory) {
				var hostDirectory = self.options.Volumes[directory];
				startOpts.Binds.push(hostDirectory + ':' + directory);
			});
		}
		// Setup container environment
		if (self.options.Environment) {
			createOpts.Env = [];
			_.each(_.keys(self.options.Environment), function(key) {
				var value = self.options.Environment[key];
				createOpts.Env.push(key + '=' + value);
			});
		}
		// Setup command
		if (self.options.Cmd) {
			createOpts.Cmd = self.options.Cmd;
		}
		log.verbose('Creating container %s', name);
		log.verbose('Create options: %j', createOpts);
		self.docker.createContainer(createOpts, function(err, container) {
			if (err) {
				log.error('Failed to create container for: %s because: %j', self.name, err);
				return cb(err);
			}
			// Container created, now start it
			log.info('Starting container %s', name);
			log.verbose('Start options: %j', startOpts);
			container.start(startOpts, function(err) {
				if (err) {
					log.error('Failed to start container %s because: %j', name, err);
					return cb(err);
				}
				// It is running, register it
				self._registerContainer(container, cb);
			});
		});
	}

	log.verbose('Starting container for %s#%d if needed', self.name, index);
	var container = self.docker.getContainer(name);
	container.inspect(function(err, data) {
		if (!err) {
			// Container already found, is it running?
			if (data.State && data.State.Running) {
				// Yes it is running
				log.verbose('Container %s already running', name);
				if (!_.some(self.containers, function(c) {
					return c.getId() === data.Id;
				})) {
					return self._registerContainer(container, cb);
				} else {
					return cb();
				}
			} else {
				// Remove container and then restart.
				log.info('Removing stopped old container: %s', name);
				container.remove(function(err) {
					if (err) return cb(err);
					return createAndStartContainer(cb);
				});
			}
		} else {
			return createAndStartContainer(cb);
		}
	});
}

/**
 * Stop all containers that run an old version of this service.
 */
Service.prototype._stopOldContainers = function(force, cb) {
	var self = this;

	function worker(cb) {
		var curPrefix = self._createContainerName(0, false);
		var oldPrefix = (self.name + '-').replace(CONTAINER_NAME_REGEX, '_');
		log.debug('oldPrefix: %s, curPrefix: %s', oldPrefix, curPrefix);

		function getNameFromContainerInfo(containerInfo) {
			return (containerInfo.Names ? containerInfo.Names[0] : '?');
		}

		function isOldContainer(containerInfo) {
			var name = getNameFromContainerInfo(containerInfo);
			// Name must match old prefix
			if (name.indexOf(oldPrefix) < 0) return false;
			// Name must match generic container postfix
			if (name.indexOf(CONTAINER_POSTFIX) < 0) return false;
			// Name must not have more than 1 '/'
			var firstSlash = name.indexOf('/');
			var lastSlash = name.lastIndexOf('/');
			if (firstSlash !== lastSlash) return false;
			// If force, we do not care about current containers
			if (force) return true;
			// Name must not match current prefix
			return (name.indexOf(curPrefix) < 0);
		}

		self.docker.listContainers({
			all: true
		}, function(err, containers) {
			if (err) return cb(err);
			var oldContainers = _.filter(containers, isOldContainer);
			var oldContainerIds = _.map(oldContainers, function(c) {
				return c.Id;
			});
			log.verbose('Old containers for %s: %j', self.name, _.map(oldContainers, getNameFromContainerInfo));
			async.each(oldContainerIds,
				function(id, cb) {
					return self.application.stopAndRemoveContainer(id, function(err) {
						log.debug('Done stopAndRemove %s', id);
						return cb(err);
					});
				}, cb);
		});
	};

	self._pushWork(worker, cb);
}

/** 
 * Event listener for dependent Service 'started' events.
 */
Service.prototype._onDependentServiceStarted = function() {
	var self = this;
	if (!self.launched) return;
	self._startContainers(function(err) {
		if (err) {
			log.error('Failed to start containers for %s', self.name, err);
		}
	});
}

/** 
 * Event listener for dependent Service 'stopped' events.
 */
Service.prototype._onDependentServiceStopped = function() {
	var self = this;
	// Stop myself
	log.warn('Dependent service has stopped, now stopping %s', self.name);
	self.stop(function(err) {
		if (err) {
			log.error('Failed to stop %s', self.name, err);
		}
	});
}

/**
 * Register a container that runs this service.
 * container: docker.getContainer(...)
 */
Service.prototype._registerContainer = function(container, cb) {
	var self = this;
	var c = new Container(self, container);
	c.once('started', function() {
		self._onContainerStarted(c);
	});
	c.once('stopped', function() {
		self._onContainerStopped(c);
	});
	c.initialize(function(err) {
		if (!err) {
			self.containers.push(c);
			c.startWatching();
		}
		return cb(err);
	});
}

/** 
 * Event listener for Container 'started' events.
 */
Service.prototype._onContainerStarted = function(container) {
	var self = this;
	log.info('Container %s has started', container.getName());
	// Decrease failure count
	if (self.recentFailures > 0) self.recentFailures--;
	// Count the number of running containers
	var runningCount = _.filter(self.containers, function(x) {
		return x.isRunning();
	}).length;
	if (runningCount === 1) {
		// We're the first that was started
		self.emit('started');
	}
	if (runningCount === self.options.Scale) {
		// All containers are now running
		self.emit('allStarted');
		// Stop old container
		// TODO there should be a timeout to let the load-balancer settle.
		self._stopOldContainers(false, function() {});
	}
}

/** 
 * Event listener for Container 'stopped' events.
 */
Service.prototype._onContainerStopped = function(container) {
	var self = this;
	// Remove container from my list of containers
	self.recentFailures++;
	self.containers = _.without(self.containers, container);
	// Notify listeners if all containers are now stopped
	if (!self.isRunning()) {
		self.emit('stopped');
		if (self.recentFailures > MAX_FAILURES) {
			// Too many failures
			log.error('Too many failures, %s is stopped permantly.', self.name);
			return;
		}
	}
	// Try to restart 
	self._startContainers(function() {});
}

/**
 * Push work onto the work queue
 * worker: function(cb)
 * cb: function(err)
 */
Service.prototype._pushWork = function(worker, cb) {
	var self = this;
	self.workQueue.push(function(done) {
		worker(function(err) {
			done();
			return cb(err);
		})
	});
}

/**
 * Split a host port string "[ip:]port" into { HostIp: ip, HostPort: port }
 */
Service.prototype._SplitHostPort = function(value) {
	var result;
	if (typeof value === 'number') {
		result = {
			HostPort: value.toString()
		};
	} else if (typeof value === 'string') {
		var index = value.indexOf(':');
		result = {};
		if (index > 0) {
			result.HostIp = value.slice(0, index);
			result.HostPort = value.slice(index + 1);
		} else {
			result.HostIp = '0.0.0.0';
			result.HostPort = value;
		}
	} else {
		result = value;
	}
	log.debug('SplitHostPort: %s -> %s', value, result);
	return result;
};

/**
 * Split a dependency string "name[:internal-name]" into { Name: name, InternalName: internal-name }
 */
Service.prototype._SplitDependencyIntoLink = function(value) {
	var result;
	var index = value.indexOf(':');
	result = {};
	if (index > 0) {
		result.Name = value.slice(0, index);
		result.InternalName = value.slice(index + 1);
	} else {
		result.Name = value;
		result.InternalName = value;
	}
	log.debug('SplitDependencyIntoLink: %s -> %s', value, result);
	return result;
};

// Export the class
module.exports = Service;
module.exports.CONTAINER_POSTFIX = CONTAINER_POSTFIX;