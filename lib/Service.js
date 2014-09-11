"use strict";

var _ = require('underscore');
var async = require('async');
var util = require('util');
var Utils = require('./Utils');
var log = require('winston');

var CONTAINER_PREFIX = 'kiruna_';
var CONTAINER_NAME_REGEX = /[-:\/\.]/g;

/**
 * Wrap a single service in the form of a named docker image
 */
var Service = function(application, name, options) {
	var self = this;
	self.application = application;
	self.docker = application.docker;
	self.options = options || {};
	self.name = name;
	self.imageName = self.options.Image + ':' + self.options.Tag;
	if (!self.name) {
		throw new Error('Specify a name');
	}
}

/**
 * Does this service depend on another service with given name?
 */
Service.prototype.dependsOn = function(otherServiceName) {
	var self = this;
	var dependencies = self.options.Dependencies || [];
	return _.contains(dependencies, otherServiceName);
}

/**
 * Gets the id of the first container running this service.
 * Throws an error if there are no containers.
 */
Service.prototype.getFirstContainerId = function() {
	var self = this;
	var containers = self.containers || [];
	if (containers.length === 0) throw new Error(util.format('No containers exist in service: %s', self.name));
	return self._createContainerName(0, true);
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
	var prefix = CONTAINER_PREFIX + (self.name + '-' + hash).replace(CONTAINER_NAME_REGEX, '_') + '__';
	if (includeIndex) return prefix + index;
	return prefix;
}

/**
 * Launch this service (if needed)
 */
Service.prototype.launch = function(cb) {
	var self = this;
	self.containers = [];
	log.verbose('Launching %s...', self.name);
	async.series([

		function(cb) {
			// Stop first in case of hard deploy
			if (self.options.HardDeploy) {
				log.info('Hard deploy: %s', self.name);
				self.stop(cb);
			} else {
				cb();
			}
		},
		function(cb) {
			// Start container
			self._startContainers(cb);
		},
		function(cb) {
			// Stop old containers
			if (!self.options.HardDeploy) {
				self._stopOldContainers(cb);
			} else {
				cb();
			}
		}
	], cb);
}

/**
 * Stop all containers
 */
Service.prototype.stop = function(cb) {
	var self = this;
	self.containers = [];
	self.application.stopDependencies(self.name);
	self._stopOldContainers(cb);
}

/**
 * Start the right number of containers
 */
Service.prototype._startContainers = function(cb) {
	var self = this;
	var indexes = _.range(self.options.Scale || 1);
	async.eachSeries(indexes,
		function(index, cb) {
			self._startContainer(index, cb);
		},
		cb);
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
				var containerId = service.getFirstContainerId();
				startOpts.Links.push(containerId + ':' + link.InternalName);
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
		log.verbose('Create options: %j', createOpts);
		self.docker.createContainer(createOpts, function(err, container) {
			if (err) return cb(new Error(util.format('Failed to create container for: %s because: %s', self.name, err)));
			self.containers.push(container.id);
			// Container created, now start it
			log.verbose('Start options: %j', startOpts);
			container.start(startOpts, cb);
		});		
	}

	log.info('Starting container for %s#%d', self.name, index);
	var container = self.docker.getContainer(name);
	container.inspect(function(err, data) {
		if (!err) {
			// Container already found, is it running?
			if (data.State && data.State.Running) {
				// Yes it is running
				self.containers.push(data.Id);
				return cb();
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
Service.prototype._stopOldContainers = function(cb) {
	var self = this;
	var curPrefix = self._createContainerName(0, false);
	var oldPrefix = CONTAINER_PREFIX + (self.name + '-').replace(CONTAINER_NAME_REGEX, '_');

	function isOldContainer(container) {
		return _.some(container.Names, function(name) {
			if (name.indexOf(curPrefix) >= 0) return false;
			return (name.indexOf(oldPrefix) >= 0);
		});
	}

	self.docker.listContainers({
		all: true
	}, function(err, containers) {
		if (err) return cb(err);
		async.each(containers,
			function(container, cb) {
				if (!isOldContainer(container)) {
					return cb();
				}
				return self.application.stopAndRemoveContainer(container.Id, cb);
			}, cb);
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
module.exports.CONTAINER_PREFIX = CONTAINER_PREFIX;