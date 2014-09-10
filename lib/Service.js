var _ = require('underscore');
var async = require('async');
var util = require('util');
var Utils = require('./Utils');

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
	if (containers.length === 0) throw new Error('No containers exist in service: ' + self.name);
	return self.createContainerName(0, true);
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
			console.log('Image found locally: ' + self.imageName);
			return cb();
		}
		console.log('img.inspect failed: ' + err + ', ' + self.imageName);
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
Service.prototype.createContainerName = function(index, includeIndex) {
	var self = this;
	var hash = Utils.hashObject(self.options);
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
	async.series([

		function(cb) {
			// Stop first in case of hard deploy
			if (self.options.HardDeploy) {
				console.log('Hard deploy: ' + self.name);
				self.stopOldContainers(cb);
			} else {
				cb();
			}
		},
		function(cb) {
			self.startContainers(cb);
		},
		function(cb) {
			if (!self.options.HardDeploy) {
				self.stopOldContainers(cb);
			} else {
				cb();
			}
		}
	], cb);
}

/**
 * Start the right number of containers
 */
Service.prototype.startContainers = function(cb) {
	var self = this;
	var indexes = _.range(self.options.Scale || 1);
	async.eachSeries(indexes,
		function(index, cb) {
			self.startContainer(index, cb);
		},
		cb);
}

/**
 * Start a new containers that runs the current version of this service.
 * If a contain with the right name already exists, do nothing
 */
Service.prototype.startContainer = function(index, cb) {
	var self = this;
	var name = self.createContainerName(index, true);

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
				startOpts.PortBindings[port] = [SplitHostPort(self.options.Ports[port])]
			});
		}
		// Setup container links
		if (self.options.Dependencies) {
			startOpts.Links = [];
			_.each(self.options.Dependencies, function(dependency) {
				var link = SplitDependencyIntoLink(dependency);
				var service = self.application.getService(link.Name);
				var containerId = service.getFirstContainerId();
				startOpts.Links.push(containerId + ':' + link.InternalName);
			});
		}
		console.log('Creating container: ' + name + ': ' + util.inspect(createOpts));
		self.docker.createContainer(createOpts, function(err, container) {
			if (err) return cb(new Error('Failed to create container for: ' + self.name + ' because: ' + err));
			self.containers.push(container.id);
			// Container created, now start it
			console.log('Starting container: ' + name + ': ' + util.inspect(startOpts));
			container.start(startOpts, cb);
		});		
	}

	console.log('Starting container for ' + self.name + '#' + index);
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
				console.log('Removing stopped old container: ' + name);
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
Service.prototype.stopOldContainers = function(cb) {
	var self = this;
	var curPrefix = self.createContainerName(0, false);
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
function SplitHostPort(value) {
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
	console.log('Split: ' + value + ' -> ' + util.inspect(result));
	return result;
}

/**
 * Split a dependency string "name[:internal-name]" into { Name: name, InternalName: internal-name }
 */
function SplitDependencyIntoLink(value) {
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
	console.log('Split: ' + value + ' -> ' + util.inspect(result));
	return result;
}

// Export the class
module.exports = Service;
module.exports.CONTAINER_PREFIX = CONTAINER_PREFIX;