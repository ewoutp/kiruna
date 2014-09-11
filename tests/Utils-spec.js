// Utils-spec.js
var Utils = require('../lib/Utils');

describe('Test expandVariables', function() {
	function getValue(key) {
		//console.log('key=' + key);
		switch (key) {
			case 'KEY': return '123';
			case 'IP': return 'myip';
			default: return '?';
		}
	}

    it('Simple', function(done) {
        expect(Utils.expandVariables('${KEY}', getValue)).toBe('123');
        expect(Utils.expandVariables('${ KEY}', getValue)).toBe('123');
        expect(Utils.expandVariables('${KEY  }', getValue)).toBe('123');
        expect(Utils.expandVariables('${  KEY }', getValue)).toBe('123');

        expect(Utils.expandVariables(' ${ KEY } ', getValue)).toBe(' 123 ');
        expect(Utils.expandVariables('${KEY}-${KEY}', getValue)).toBe('123-123');
        done();
    });

    it('Recurse', function(done) {
    	var obj = { "Port": [ '${IP}:4001']};
    	var expanded = Utils.recurse(obj, function(value) {
    		if (typeof value !== 'string') return value;
    		return Utils.expandVariables(value, getValue);
    	});

        expect(JSON.stringify(expanded)).toBe('{"Port":["myip:4001"]}');
        done();
    });
});

