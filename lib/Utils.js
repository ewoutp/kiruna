var crypto = require('crypto');

function hashObject(data) {
	var str = JSON.stringify(data);
	return hashString(str);
}

function hashString(data) {
	var hash = crypto.createHash('sha1');
	hash.update(data, 'utf8');
	return hash.digest('hex');
}

module.exports = {
	hashObject: hashObject,
	hashString: hashString
};