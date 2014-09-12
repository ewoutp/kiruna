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
			tasks: {
				options: {
					node: true
				},
				files: {
					src: [ 'tasks/*.js' ]
				}
			},
		}
	});
	grunt.loadNpmTasks('grunt-contrib-jshint');
	grunt.loadTasks('tasks'); // Load just as a test

	// Lint task
	var lintTasks = ['jshint:tasks'];
	grunt.registerTask('lint', lintTasks);

	// Setup default task
	grunt.registerTask('default', ['lint']);
};