/*
Helper function: Removes unwanted elements from Array.
/*/
var cleanArray = function(array, deleteValue) {
  for (var i = 0; i < array.length; i++) {
    if (array[i] == deleteValue) {         
      array.splice(i, 1);
      i--;
    }
  }
  return this;
};


/*
Helper Function: Convert Milliseconds to Minutes.
*/
var convertToMinutes = function(millisec) {
    return (Math.round((millisec / 60000) * 100) / 100);
}


/*
Helper Function: Convert Seconds to Milliseconds.
*/
var convertSecToMillis = function(seconds) {
    return (seconds * 1000);
}


/*
Helper Function: Get email ids from array of string.
*/
var extractEmailOfSubscribers = function(subscribers) {
    return new Promise(function(fulfill, reject) {
        var userList = [];
        if (!utils.isEmpty(subscribers)) {
            for (i = 0; i < subscribers.length; i++) {
                userList.push(subscribers[i].emails[0]);
                if (i == subscribers.length-1) {
                    userList = userList.filter(function(entry) {
                        return entry.trim() != '';
                    });
                    fulfill(userList);
                }
            }
        }
    });
}


/*
Helper function: Removes duplicate elements from Array.
/*/
var getUniqueArray = function(array) {
    var response = [];
    return new Promise(function(fulfill, reject) {
        if (!isEmpty(array)) {
            for(i=0; i<array.length; i++) {
                if(response.indexOf(array[i]) === -1) {
                    response.push(array[i]);
                }
                if (i == (array.length-1)) fulfill(response);
            }
        } else
            fulfill(response);
    });
};


var getTime = function() {
    return (new Date()).getTime();
}


var isEmpty = function(object) {
	if ((object == null)
		|| (object == 'undefined')) return true;
	if ((typeof(object) == "string") &&  (object.trim() == '')) return true;
	if ((object instanceof Array) &&  (Object.keys(object).length  <= 0)) return true; 
	return false;
};


var validateEmail = function(email) {	
    var re = /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
    var response = re.test(email.trim());
    return re.test(email.trim());
}


module.exports.cleanArray = cleanArray;
module.exports.convertToMinutes = convertToMinutes;
module.exports.convertSecToMillis = convertSecToMillis;
module.exports.extractEmailOfSubscribers = extractEmailOfSubscribers;
module.exports.getUniqueArray = getUniqueArray;
module.exports.getTime = getTime;
module.exports.isEmpty = isEmpty;
module.exports.validateEmail = validateEmail;