"use strict";

var crypto = require('crypto');
var pkg = require('../package.json');
var _ = require('underscore');

var variableRegEx = /(\$\{\s*)([a-z0-9_]+)(\s*\})/ig;

function hashObject(data, includePackageVersion) {
	var str = JSON.stringify(data);
	if (includePackageVersion) {
		str = str + '/' + pkg.version;
	}
	return hashString(str);
}

function hashString(data) {
	var hash = crypto.createHash('sha1');
	hash.update(data, 'utf8');
	return hash.digest('hex');
}

// Recurse through objects and arrays, executing fn for each non-object.
function recurse(value, fn, fnContinue) {
	function _recurse(value, fn, fnContinue, state) {
		var error;
		if (state.objs.indexOf(value) !== -1) {
			error = new Error('Circular reference detected (' + state.path + ')');
			error.path = state.path;
			throw error;
		}
		var obj, key;
		if (fnContinue && fnContinue(value) === false) {
			// Skip value if necessary.
			return value;
		} else if (_.isArray(value)) {
			// If value is an array, recurse.
			return value.map(function(item, index) {
				return _recurse(item, fn, fnContinue, {
					objs: state.objs.concat([value]),
					path: state.path + '[' + index + ']',
				});
			});
		} else if (_.isObject(value) && !Buffer.isBuffer(value)) {
			// If value is an object, recurse.
			obj = {};
			for (key in value) {
				obj[key] = recurse(value[key], fn, fnContinue, {
					objs: state.objs.concat([value]),
					path: state.path + (/\W/.test(key) ? '["' + key + '"]' : '.' + key),
				});
			}
			return obj;
		} else {
			// Otherwise pass value into fn and return.
			return fn(value);
		}
	}
	return _recurse(value, fn, fnContinue, {
		objs: [],
		path: ''
	});
}

/**
 * Expand all ${key} style variables in the given value with the result of getValue(key).
 */
function expandVariables(value, getValue) {
	if (!_.isString(value)) return value;
	var match;
	while ((match = variableRegEx.exec(value)) !== null) {		
		//console.log('value #1="' + value + '", -> ' + match);
		var key = match[2];
		var index = match.index;
		var end = match.index + match[0].length;
		var v = getValue(key);
		value = value.slice(0, index) + v + value.slice(end);
		variableRegEx.lastIndex = 0;
	}
	return value;
}

/**
 * Gets the host port for a given port inside a docker container.
 * containerPort: "1234/tcp"
 * inspectData: Container.inspect data
 */
function getHostPort(containerPort, inspectData) {
	var NetworkSettings = inspectData.NetworkSettings || {};
	var ports = NetworkSettings.Ports || {};
	var portData = ports[containerPort];
	if (!portData || (portData.length < 1)) return;
	var hostPort = portData[0].HostPort;
	return hostPort;
}

module.exports = {
	hashObject: hashObject,
	hashString: hashString,
	recurse: recurse,
	expandVariables: expandVariables,
	getHostPort: getHostPort
};
