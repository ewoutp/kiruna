module.exports = function(grunt) {
	grunt.initConfig({
		pkg: grunt.file.readJSON('package.json'),
		jshint: {
			options: {
				//curly: true,
				eqeqeq: true,
				undef: true,
				//unused: true,
				strict: true,
				latedef: 'nofunc',
				newcap: true,
				// Relaxing options
				asi: true,
			},
			allNode: {
				options: {
					node: true
				},
				files: {
					src: [ 'server.js', 'lib/**/*.js' ]
				}
			},
		},
		jasmine_node: {
			options: {},
			all: ['tests/']
		},
		exec: {
			push: 'subliminl push <%= grunt.file.readJSON("package.json").name %>:<%= grunt.file.readJSON("package.json").version %>'
		}
	});
	grunt.loadNpmTasks('grunt-dib');
	grunt.loadNpmTasks('grunt-exec');
	grunt.loadNpmTasks('grunt-release');
	grunt.loadNpmTasks('grunt-contrib-jshint');
	grunt.loadNpmTasks('grunt-jasmine-node');

	// Lint task
	grunt.registerTask('lint', ['jshint:allNode']);

	// Build task
	grunt.registerTask('build', ['dib']);

	// Test task
	grunt.registerTask('test', ['jasmine_node']);

	// Build a release
	grunt.registerTask('release', ['lint', 'git-release', 'dib'])

	// Push image to registry
	grunt.registerTask('push', ['check-deploy', 'exec:push'])

	// Default task
	grunt.registerTask('default', ['lint', 'build']);
};