var fs = require('fs');
var path = require('path');
var utils = require('../utils');

var responses = [];

/*
Reload response files.
/*/
var loadFiles = function() {
	var res = false;
	try {
		var dirname = path.join(__dirname, '../responses/');
		var files = fs.readdirSync(dirname);
		for (var i in files) {
			var content = fs.readFileSync(dirname + files[i]);
			if (!utils.isEmpty(content)) {
    			responses[files[i]] = content.toString();
    		}	
		};
		res = true;
	} catch (err) {
		console.log(err);
		res = false;
	}
	return res;
}


/*
Get a response.
/*/
var getResponse = function(filename, allData=false) {
	var response = responses[filename];
	if (!utils.isEmpty(response) && allData == false) {
		var lines = response.split('\n');
		lines = lines.filter(function(entry) { return entry.trim() != ''; });
		response = lines[Math.floor(Math.random()*lines.length)];
	}
	return response;
}


module.exports.loadFiles = loadFiles;
module.exports.getResponse = getResponse;
