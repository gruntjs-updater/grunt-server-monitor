/**
 * grunt-server-monitor
 * https://github.com/sparkida/grunt-server-monitor
 *
 * Copyright (c) 2015 Nicholas Riley
 * Licensed under the MIT license.
 */

'use strict';
var path = require('path'),
	Monitor = require('./lib/monitor'),
	spawn = require('child_process').spawn,
	reboots = 0,
	options = {},
	servers = {},
	server = null,
	grunt,
	monitor,
	control,
	Control = function (gruntMod) {
		grunt = gruntMod;
		control = this;
		//circular
		monitor = control.monitor = Monitor.open(control);
		grunt.registerMultiTask('monitor', 'Reload an express web server', control.load);
	};

Control.start = function (gruntInstance) {
	return new Control(gruntInstance);
};

process.on('uncaughtException', function (err) {
    console.log(err.stack.red);
});

Control.prototype.load = function () {
	control.config = this;
	control.done = control.config.async();
	server = servers[control.config.target];
	control.monitor = monitor;
	//this fires the next event connected|started
	monitor.load();
	//this is handled by the client
	monitor.once('connected', control.connected);
	//this is handled by the server and fired by the cl
	monitor.once('started', control.start);
};

Control.prototype.error = function () {
	monitor.serverError = true;
	//console.log('error is called', monitor.type);
	monitor.removeListener('restarted', control.restarted);
	control.done();
};

Control.prototype.restarted = function () {
	//console.log('restarted'.green);
    monitor.serverError = false;
	control.done();
};

Control.prototype.reboot = function () {
	console.log(('rebooting ' + monitor.type).grey, ++reboots);
	monitor.removeListener('kill', control.kill);
	control.start();
};

Control.prototype.connected = function () {
	console.log('requesting restart'.grey);
	monitor.once('restarted', control.restarted);
	monitor.once('error', control.error);
	//kill the server and restart
	monitor.tellServer('restart');
};

Control.prototype.kill = function () {
	//monitor.removeListener('forcekill', forcekill);
	console.log('killing the server'.grey);
	server = servers[control.config.target];
	if (monitor.connected) {
		server.once('close', function () {
			monitor.removeListener('reboot', control.reboot);
			console.log('server killed'.green);
			control.start();
		});
		server.kill('SIGTERM');
	} else {
		console.log('restarting server'.green, monitor.type);
		monitor.tellClient('error');
	}
};

Control.prototype.start = function () {
	var fh = {},
		connectData = '',
		logCount = 0,
		timeout = null,
		mark = Date.now(),
		connected = 0;
	console.log('Starting server on process: '.grey + process.pid);
	fh.stdout = function (buffer) {
		var data = buffer.toString().trim();
		if (data.search(/error/i) > -1) {
			console.log(data.yellow);
		} else {
			logCount += 1;
			if (logCount % options.logsPerConnect === 0) {
				connected += 1;
				console.log(('node ' + connected + ' connected : ' 
							+ ((Date.now() - mark) / 1000) + '(seconds)').cyan);
			}
			if (options.logsPerConnect > 1 || options.nodes > 1) {
				connectData += data + '\n';
			}
			if (options.nodes === connected) {
				server.stdout.removeListener('data', fh.stdout);
				console.log(('Server Activated in ' + ((Date.now() - mark) / 1000) + ' seconds by the following output:').green);
				console.log(('------\n' + connectData + '------')
						.split('\n')
						.map(function (line) {
							return line.grey
						})
						.join('\n'));
				console.log('Waiting...');
				if (null !== timeout) {
					clearTimeout(timeout);
				}
				monitor.connected = true;
				if (monitor.serverError) {
					monitor.serverError = false;
				}
				if (monitor.socket) {
					monitor.tellClient('restarted');
				}
				server.stdout.on('data', function (buffer) {
					console.log(buffer.toString().trim().grey);
				});
			}
		}
	};
	fh.stderr = function (buffer) {
		console.log(buffer.toString().trim().yellow);
        //console.log('warning'.yellow);
	};

	//servers[control.target] = requir(options.script);
	options = control.config.options({
		script: 'index.js',
		nodes: 1,
		logsPerConnect: 1,
		timeout: 0,
		watchfile: null		
	});

	options.script = path.resolve(options.script);
	control.options = options;

	if (options.timeout > 0) {
		timeout = setTimeout(function () {
			console.log('Server timed out'.red);
			server.kill('SIGTERM');
		}, options.timeout * 1000);
	}
	
	server = servers[control.config.target] = spawn(
			process.execPath,
			[options.script], {
				stdio: [ 'pipe', 'pipe', 'pipe' ]
			});

	server.once('close', function () {
		//monitor.server.lastExitStatus = monitor.connected ? 'success' : 'fail';
		//console.log('server closing '.cyan, monitor.connected, monitor.serverError);
        //console.log('last status', monitor.server.lastExitStatus);
		//there was an error in the client
		if(!monitor.connected) {
            //console.log('error not connected'.red);
            monitor.serverError = true;
			monitor.tellClient('error');
		} else {
			monitor.connected = false;
		}
		//console.log('exiting'.red);
	});
	/*
	   setInterval(function () {
	   console.log(monitor.connected);
	   }, 1000);*/
	server.stderr.on('data', fh.stderr);
	server.stdout.on('data', fh.stdout);
	//TODO
	//monitor.on('error', kill);
	monitor.once('kill', control.kill);
	monitor.once('reboot', control.reboot);
};

module.exports = Control.start;

