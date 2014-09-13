"use strict";

// DockerWrapper.js
// Wrap docker to avoid synchronization issues

var async = require('async');
var log = require('winston');

var dockerQueue = async.queue(function(task, cb) {
	task(cb);
}, 1);

/**
 * Ctor
 * docker Dockerode.Docker instance
 */
function DockerWrapper(docker) {
	var self = this;
	self.docker = docker;
}

/**
 * Gets a container by its id
 */
DockerWrapper.prototype.getContainer = function(id) {
	var self = this;
	var dc = self.docker.getContainer(id);
	return new ContainerWrapper(dc);
}

/**
 * Gets an image by its id
 */
DockerWrapper.prototype.getImage = function(id) {
	var self = this;
	var di = self.docker.getImage(id);
	return new ImageWrapper(di);
}

/**
 * Create a new container
 */
DockerWrapper.prototype.createContainer = function(opts, cb) {
	var self = this;
	dockerQueue.push(function(taskDone) {
		self.docker.createContainer(opts, function(err, container) {
			taskDone();
			if (container) container = new ContainerWrapper(container, container.id);
			cb(_extendError(err), container);
		});
	});
}

/**
 * Create a new image
 */
DockerWrapper.prototype.createImage = function(opts, cb) {
	var self = this;
	dockerQueue.push(function(taskDone) {
		self.docker.createImage(opts, function(err, stream) {
			taskDone();
			cb(_extendError(err), stream);
		});
	});
}

/**
 * List all containers
 */
DockerWrapper.prototype.listContainers = function(opts, cb) {
	var self = this;
	dockerQueue.push(function(taskDone) {
		self.docker.listContainers(opts, function(err, containers) {
			taskDone();
			cb(_extendError(err), containers);
		});
	});
}

/**
 * Ctor 
 * container Dockerode.Container instance
 */
function ContainerWrapper(container, id) {
	var self = this;
	self.container = container;
	self.id = id;
}

/**
 * Inspect the state of the container
 */
ContainerWrapper.prototype.inspect = function(cb) {
	var self = this;
	dockerQueue.push(function(taskDone) {
		self.container.inspect(function(err, data) {
			if (!self.id && data && data.Id) {
				log.debug('Set container.id %s', data.Id);
				self.id = data.Id;
			}
			taskDone();
			cb(_extendError(err), data);
		});
	});
}

/**
 * Start the container
 */
ContainerWrapper.prototype.start = function(opts, cb) {
	var self = this;
	dockerQueue.push(function(taskDone) {
		self.container.start(opts, function(err, data) {
			taskDone();
			cb(_extendError(err), data);
		});
	});
}

/**
 * Stop the container
 */
ContainerWrapper.prototype.stop = function(cb) {
	var self = this;
	dockerQueue.push(function(taskDone) {
		self.container.stop(function(err, data) {
			taskDone();
			cb(_extendError(err), data);
		});
	});
}

/**
 * Remove the container
 */
ContainerWrapper.prototype.remove = function(cb) {
	var self = this;
	dockerQueue.push(function(taskDone) {
		self.container.remove(function(err, data) {
			taskDone();
			cb(_extendError(err), data);
		});
	});
}

/**
 * Ctor 
 * image Dockerode.Image instance
 */
function ImageWrapper(image) {
	var self = this;
	self.image = image;
}

/**
 * Inspect the state of the container
 */
ImageWrapper.prototype.inspect = function(cb) {
	var self = this;
	dockerQueue.push(function(taskDone) {
		self.image.inspect(function(err, data) {
			taskDone();
			cb(_extendError(err), data);
		});
	});
}

/** 
 * Extend error information with easy to use properties
 */
function _extendError(err) {
	if (!err) return err;
	if (err.statusCode === 404) err.noSuchContainer = true;
	return err;
}

module.exports = DockerWrapper;