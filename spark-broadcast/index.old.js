var fs = require('fs');
var path = require('path');
var botResponse = require('../load-responses');
var utils = require('../utils');
var EventEmitter = require('events').EventEmitter;

//Default Publisher Room
var publisher_room_id = "Y2lzY29zcGFyazovL3VzL1JPT00vYTJlZmJjMTAtNDEwZC0xMWU3LTgwODItNjNiZjY3OTFlMjYy";
var job = {};

var cleanCommand = function(message) {
	var response = {};
	var msgArray = message.text.split(message.match[0]);
	if (msgArray[1].indexOf("/") == -1) response.data = msgArray[1];
	else {
		var commands = msgArray[1].split("/");
		if (commands && (commands != 'undefined')) {
			if (commands[0] == "") commands.splice(0, 1);
			if (Object.keys(commands).length > 1) {
				var lastElem = commands[Object.keys(commands).length - 1].split(" ");
				if (lastElem && (lastElem != 'undefined')) {
					commands[Object.keys(commands).length - 1] = lastElem[0];
					response.commands = commands;
					lastElem.splice(0, 1);
					if (lastElem && (lastElem != undefined)) response.data = lastElem.toString().replace(/,/g, " ");;
				}
			}
		}
	}
	return response;
}

var cTime = function() {
    return (new Date()).getTime();
}

var createPublisherItem = function(message, topic, tag, def) {
	return publisher = {
			id: message.channel,
			name: topic,
			owner: message.user,
			timestamp: cTime(),
			tags: tag,
			is_default: def 
		};
}

var deleteJob = function(broadcastStartTime) {
	if(job.hasOwnProperty(broadcastStartTime)) 
		delete job[broadcastStartTime];
};

var extractEmailOfSubscribers = function(subscribers) {
    var userList = [];
    if (!utils.isEmpty(subscribers))
		for (i = 0; i < subscribers.length; i++)
            userList.push(subscribers[i].emails[0]);
    return userList;
}




var getTotalSubscribers = function(bot, message, storage) {
	var users = {'count': 0, 'shouldWait': false};
	return new Promise(function (fulfill, reject) {
		var subscriberQuery = {$and: [{"publisher_space_ids": message.channel}, {"emails": {$regex : "(.*@)(?!(" + bot.botkit.config.env.fabian_internalDomain + "))"}}]};
		var p1 = storage.subscribers.find(subscriberQuery, function(error, subscribers) {
			users.external = extractEmailOfSubscribers(subscribers).filter(function(entry) { return entry.trim() != ''; });
		});
		subscriberQuery = {$and: [{"publisher_space_ids": message.channel}, {"emails":{$regex : ".*@" + bot.botkit.config.env.fabian_internalDomain}}]};
		var p2 = storage.subscribers.find(subscriberQuery, function(error, subscribers) {
			users.internal = extractEmailOfSubscribers(subscribers).filter(function(entry) { return entry.trim() != ''; });
		});
		Promise.all([p1, p2]).then(function() {
	        users.count = users.internal.length + users.external.length;
	        users.waitTime = 1;
	        if ((users.internal.length > 0) && (users.external.length > 0)) {
	            users.shouldWait = true;
	            users.finalWarningTime = (bot.botkit.config.env.fabian_waitTime - (bot.botkit.config.env.fabian_waitTime / 4));
	            users.waitTime = bot.botkit.config.env.fabian_waitTime;
	        }
			fulfill(users);
		});
	});
}

var retrieveFile = function(bot, message) {
	return new Promise(function (fulfill, reject) {
		if (!utils.isEmpty(message.original_message.files)) {
			bot.retrieveFile(message.original_message.files[0], function(err, body) {
				if (!err) fulfill(body.split('\n'));
				else fulfill([]);
			});
		} else fulfill([]);
	});
}


var saveSubscriberItem = function(storage, subscriberSpaceId, publisherSpaceId, email, action, existingDbEntry=null) {
	email = email.trim().toLowerCase();
	var mailids = [];
	var publisherSpaces = [];
	if (existingDbEntry) {
		if(existingDbEntry.publisher_space_ids) publisherSpaces = existingDbEntry.publisher_space_ids;
		if(existingDbEntry.emails) mailids = existingDbEntry.emails;
	}
	if (action == 'subscribe') publisherSpaces.push(publisherSpaceId);
	else publisherSpaces.splice(publisherSpaces.indexOf(publisherSpaceId), 1);
	
	if (mailids.indexOf(email) < 0) mailids.push(email);	//Safety Check
	
	var subscriber = {
			id: subscriberSpaceId,
			publisher_space_ids: publisherSpaces,
			emails: mailids
		};
	
	storage.subscribers.save(subscriber);
}


var handleSubscription = function(bot, message, storage, userid, action, welcomeTxt) {
	var user_error = "";
	return new Promise(function (fulfill, reject) {
		if (utils.isEmpty(userid)) {
			fulfill();
			return;
		}
		var subscriberItem = {"emails": userid.trim().toLowerCase()};
		storage.subscribers.find(subscriberItem, function(error, subscribers) {
			if (!utils.isEmpty(subscribers)) {
				var _id = { id: subscribers[0].id };
				if (action == 'subscribe') {
					var currentSubscriptions = subscribers[0].publisher_space_ids;
					if (currentSubscriptions.indexOf(publisher_room_id) > -1) {
						user_error = userid.trim() + ' is already subscribed.';
					} else {
						saveSubscriberItem(storage, subscribers[0].id, publisher_room_id, userid, action, subscribers[0]);
					}
				} else if (action == 'unsubscribe') {
					saveSubscriberItem(storage, subscribers[0].id, publisher_room_id, userid, action, subscribers[0]);
				}
			} else {
				if (action == 'subscribe') {
					//bot.say({toPersonEmail: userid.trim(), text: botResponse.getResponse('welcome')}, function(err, resp) {
					bot.say({toPersonEmail: 'koramamu@cisco.com', text: welcomeTxt}, function(err, resp) {
						if (err !== null) {
        					console.error('**** Fabian: Could not send welcome message directly: ' + userid.trim() + "\n\n", err);
        					//user_error = userid.trim() +  "Could not send welcome message directly.";
        					if (err.name == "BadRequest") user_error = "429-" + userid.trim();
        					else user_error = userid.trim() +  "Could not send welcome message directly.";
		  				} else {
							if (typeof(resp.id) == 'undefined') { 
   								console.error('Fabian: Could not send welcome message directly: ', resp);
   								user_error = userid.trim() + "Could not send welcome message directly.";
    	    				}
							//saveSubscriberItem(storage, resp.roomId, message.channel, userid.trim().toLowerCase(), action, null);
							saveSubscriberItem(storage, userid.trim().toLowerCase(), message.channel, userid.trim().toLowerCase(), action, null);
						}
  					});
  				}
			}
			fulfill(user_error);
		});
	});
}


var subscriptionsCommandTriggered = function(bot, message, storage, action) {
	var userList = [];
	var welcomeTxt = "";
	var admin_command = false;
	if (message.match[0].startsWith("/")) admin_command = true;
	
	var buildUserList = function() {
		var messageParams = cleanCommand(message);
		return new Promise(function (fulfill, reject) {
			if (admin_command) {
				if (utils.isEmpty(message.original_message.files) && utils.isEmpty(messageParams.data)) {
					bot.reply(message,'You need provide the command like `' + message.match[0] + ' user1@domain.com [user2@domain.com ...]` or attach a file with user information.');
					fulfill(userList);
					return;
				} else
					retrieveFile(bot, message).then(function(fileUserList) {
						if (!utils.isEmpty(messageParams.data)) userList = messageParams.data.trim().split(" ");
						if (!utils.isEmpty(fileUserList)) userList = userList.concat(fileUserList);
						userList = userList.filter(function(entry) { return entry.trim() != ''; });
						fulfill(userList);
					});
			} else {
				userList.push(message.user);
				fulfill(userList);
			}
		});
	}
	
	var handleSubscriptions = function() {
		var user_errors = [];
		//console.log("SparkBroadcast: handleSubscriptions");
		var users_total = 0;
		return new Promise(function (fulfill, reject) {
			if (utils.isEmpty(welcomeTxt) || utils.isEmpty(userList)) {
				fulfill(null);
				return;
			}
			var success = 0;
			var max_messages = userList.length;
			var messagesPerSecond = 4; // 7 causes 429, 6 does not
			var bulkSubscribe = function() {
				if (users_total >= max_messages) {
					console.log('complete. success: ', success);
					fulfill(user_errors);
					return;
				}
				handleSubscription(bot, message, storage, userList[users_total], action, welcomeTxt).then(function(user_error) {
					users_total++;
					if (!utils.isEmpty(user_error)) {
						if (user_error.startsWith("429-")) {
							userList.push(user_error.split("429-1")[1]);
						}
						else user_errors.push(user_error);
					}
					if(users_total === userList.length) fulfill(user_errors);
					setTimeout(bulkSubscribe, (1000 / messagesPerSecond));
				});
			}
			bulkSubscribe();
		});
	}

	if (action === 'subscribe')
		botResponse.getResponse('welcome').then(function(welcomeMsg) {
			welcomeTxt = welcomeMsg;
		});
	
	buildUserList().then(function(userList) {
		if (!utils.isEmpty(userList)) {
			handleSubscriptions(bot, message, storage, userList, action).then(function(user_errors) {
				console.log("SparkBroadcast: subscriptionsCommandTriggered: Handled all subscriptions");
				var text = "Done. I handled " + userList.length + " user requests";
				console.log(Object.keys(user_errors).length);
				if (Object.keys(user_errors).length  > 0) {
					text += " and encountered " + Object.keys(user_errors).length + " error(s).";
					if (Object.keys(user_errors).length <= 25) {
						text += "\n\n";
						user_errors.map(function (user_error) {
							text += user_error + "\n\n";
						});
					}
				}
				if (admin_command) bot.reply(message, text);
			});
		}
	});
}


var subscriptionStatus = function(storage, userid) {
	var response = -1;			//-1 => NOT_IN_DB; 0 => IN_DB_UNSUBSCRIBED; 1 => IN_DB_SUBSCRIBED

	var subscriberItem = {"emails": userid.trim().toLowerCase()};
	return new Promise(function (fulfill, reject) {
		storage.subscribers.find(subscriberItem, function(error, subscribers) {
			if (!utils.isEmpty(subscribers)) {
				var currentSubscriptions = subscribers[0].publisher_space_ids;
				if (currentSubscriptions.indexOf(publisher_room_id) > -1) response = 1;
				else response = 0;
			}
			fulfill(response);
		});
	});
}

var SparkBroadcast = function() {};

SparkBroadcast.prototype.cleanMessage = function(bot, message) {
	var mention = '<spark-mention data-object-type="person" data-object-id="'+bot.botkit.identity.id+'">.+</spark-mention>';

	var removeRegex = new RegExp('^\\s*(</?[^>]+>\\s*)*('+mention+'\\s*)?(</?[^>]+>\\s*)*'+message.match[0]+'(\\s*</p>\\s*<p>)?\\s*(<br/?>\\s*)*');
	//var removeRegex = new RegExp('^\\s*(</?[^>]+>\\s*)*('+mention+'\\s*)?(</?[^>]+>\\s*)*'+message.match[0]+'(/[^/\\s]+)*(\\s*</p>\\s*<p>)?\\s*(<br/?>\\s*)*');
	
	var content = message.text;
	if (typeof(message.original_message.html) !== 'undefined')
		content = message.original_message.html;
		
	return content.replace(removeRegex, "$1$3");
}


var createNotificationItem = function(message, content) {
	return notification = {
			id: message.original_message.id,
			content: content,
			sender: message.user,
			timestamp: cTime(),
			hide: false,
			publisher_space_id: message.channel
		};
}


/*
Reload response files.
/*/
SparkBroadcast.prototype.loadResponse = function(bot, message) {
	if (botResponse.loadFiles() == true) {
		bot.reply(message, 'Done. Loaded all responses.');
	}
}

/*
Initialize the requested channel to be a Publisher space.
/*/
SparkBroadcast.prototype.init = function(bot, message, storage) {
	console.log("SparkBroadcast: init");
	var messageParams = cleanCommand(message);	
	
	//If the room is already a PUBLISHER, bail out.
	var publisherItem = {"id": message.channel};
	if (storage.publishers.find(publisherItem, function(error, publishers){
		if ((publishers != null) && (Object.keys(publishers).length > 0)) {
			bot.reply(message, 'This room is already initialized as a publishing space for **' + publishers[0].name + '**');
			return;
		} else {
			if (!messageParams.commands) {
				bot.reply(message, 'You need provide the command like `' + message.match[0] + '/#tagname <topic>`');
				return;
			}
			//Must have a tag
			if (!messageParams.commands[0]) {
				bot.reply(message, 'You need to provide a tag like  `' + message.match[0] + '/#tagname <topic>`');
				return;
    		} 
    		if (!messageParams.data) {
    			bot.reply(message, 'You need to provide a topic like  `' + message.match[0] + '/#tagname <topic>`');
    			return;
    		}

		    var def = false;
    		if (messageParams.commands[1]) def = (messageParams.commands[1] == 'true');
			storage.publishers.save(createPublisherItem(message, messageParams.data, messageParams.commands[0], def));
			bot.reply(message, "I've set everything up for **" + topic + "**.");
		}
	}));
}

/*
Subscribe the user to get future notifications.
/*/
SparkBroadcast.prototype.subscribe = function(bot, message, storage) {
	console.log("SparkBroadcast: subscribe");
	subscriptionsCommandTriggered(bot, message, storage, 'subscribe');
}

/*
Unsubscribe the user from getting future notifications.
/*/
SparkBroadcast.prototype.unsubscribe = function(bot, message, storage) {
	subscriptionsCommandTriggered(bot, message, storage, 'unsubscribe');
}

/*
Checks if the user is subscribed for notifications.
/*/
SparkBroadcast.prototype.subscription_status = function(bot, message, storage) {
	subscriptionStatus(storage, message.user).then(function(response) {
		if (response > 0) return true;
		else return false;
	});
}

/*
Publish the notifications from the requested channel to all subscribers.
/*/
SparkBroadcast.prototype.publish = function(controller, bot, message, storage, isTest) {
	var content = this.cleanMessage(bot, message);
	var waitComplete = false;
	var publishInProgress = true;
	var broadcastStartTime = 0;
	var broadcastRunTime = 0;
	var sentMessages = [];
	var waitStartTime = 0;
	var totalSubscribers = 0;
	var internalUserList = [];
	var externalUserList = [];
	var err429Time = 1;
    var timout_progress = null;

	var triggerBroadcast = function(userList) {
		return new Promise(function (fulfill, reject) {
			if (!utils.isEmpty(userList)) {
	            var n = 0;
	            var max_messages = 500; //userList.length;
	            var messagesPerSecond = bot.botkit.config.env.fabian_messagesPerSecond; // Spark can handle ~180 messages per minute per access token.
                if (isTest) messagesPerSecond = 200;
	            var timeout = null;
                var requestsInProgress = 0;
                //var highWaterMark = 150;
                //var highWaterMarkStartTime = cTime();
	            var blockBroadcast = function() {
	                if ((n >= max_messages) || (job[broadcastStartTime].killed)) {
	                    if (timeout != null) clearInterval(timeout);
	                    fulfill();
	                    return;
	                }

                    /*var highWaterMarkRemainder = n%highWaterMark; 
                    if ((highWaterMarkRemainder == 0) &&
                        ((cTime() - highWaterMarkStartTime) > 60000)) {
                        highWaterMarkStartTime = cTime();
                        if (n > 0) return;
                    }
                    if ((n == 0) || 
                        (highWaterMarkRemainder != 0) || 
                        ((highWaterMarkRemainder == 0) && 
                            ((cTime() - highWaterMarkStartTime) > 60000))) {*/
                            	            
    	                if (((cTime() - err429Time) > bot.botkit.config.env.fabian_waitTimeOn429) &&
                            (requestsInProgress < messagesPerSecond)) {
                            if (!isTest) {
                                requestsInProgress++;
    	                        var msg = controller.api.messages.create({toPersonEmail: '2Koush@gmail.com', text: n + ": " + content}).then(function(resp) {
    	                            sentMessages.push(resp);
                                    requestsInProgress--;
    	                        }).catch(function(err) {
        	                        console.log(err);
        	                        console.log(msg);
                                    requestsInProgress--;
        	                        err429Time = cTime();
        	                    });
                            }
    	                    n++;
    	                }
                    //}
	            }
	            timeout = setInterval(blockBroadcast, (1000 / messagesPerSecond));
			} else
				fulfill();
		});
	}
	
	var progress = function() {
		console.log("progress: " + publishInProgress + " / " + broadcastStartTime + " / " + job[broadcastStartTime].killed);
		if (publishInProgress && !job[broadcastStartTime].killed) {
			var sentCount = sentMessages.length;
			console.log("progress: " + sentCount);
			if (sentCount > 0) {
				var currentTime = cTime();
				var timeElapsedWaiting = 0;
				if (waitStartTime > 0)
					timeElapsedWaiting = currentTime - waitStartTime;
				if (waitComplete)
					timeElapsedWaiting = bot.botkit.config.env.fabian_waitTime; 
				var timeElapsed = currentTime - broadcastStartTime - timeElapsedWaiting;
				var hitRate = timeElapsed / sentCount;
				timeElapsed = Math.round((timeElapsed/60000)*100)/100;
				var pendingPublishes = totalSubscribers - sentCount;
				var timeLeft = Math.round(((hitRate * pendingPublishes)/60000)*100)/100;
				var percentComplete = Math.round((sentCount / totalSubscribers)*10000)/100;
 				if ((percentComplete < 100) && (waitComplete || (timeElapsedWaiting <= bot.botkit.config.env.fabian_progressUpdateTime))) {
					bot.reply(message, "**" + percentComplete + "%** complete: **" + sentCount + "** sent in **" + timeElapsed + "** minutes and **" + pendingPublishes + "** left to send in approximately **" + timeLeft + "** minutes");
				}
			}
		} else
			return;
	}
	
	var finalWarning = function() {
		if (publishInProgress && !job[broadcastStartTime].killed)
			bot.reply(message, "**Final Warning**: You have " + (Math.round((bot.botkit.config.env.fabian_waitTime/240000)*100)/100) + "m before the broadcast is sent to external users. You can stop the broadcast using **/kill/" + broadcastStartTime + "**");
	}
	
	var finalStatus = function() {
		if (!utils.isEmpty(job[broadcastStartTime]) && (job[broadcastStartTime].killed == false) && !isTest)
			bot.reply(message, "<@personId:" + message.original_message.personId + ">, All done. I sent **" + sentMessages.length + "** notifications in **" + broadcastRunTime + "** minutes");
        else if (isTest)
            bot.reply(message, "<@personId:" + message.original_message.personId + ">, All done. I sent **1** notifications in **" + broadcastRunTime + "** minutes");
	}
	
	var triggerExternalBroadcast = function() {
		waitComplete = true;
		waitStartTime = 0;
		if (publishInProgress && !utils.isEmpty(job[broadcastStartTime]) && !job[broadcastStartTime].killed) {
            if (!isTest)
			    bot.reply(message, "Continuing broadcast to external domains.");
			var subscriberQuery = {$and: [{"publisher_space_ids": message.channel}, {"emails": {$regex : "(.*@)(?!(" + bot.botkit.config.env.fabian_internalDomain + "))"}}]};
			triggerBroadcast(externalUserList).then(function() {
                clearInterval(timout_progress);
				if(job.hasOwnProperty(broadcastStartTime)) setTimeout(deleteJob, bot.botkit.config.env.fabian_waitTime, broadcastStartTime);
                if (!isTest) {
                    broadcastRunTime = Math.round((((cTime() - broadcastStartTime) - bot.botkit.config.env.fabian_waitTime) / 60000) * 100) / 100;
                    storage.notifications.save(createNotificationItem(message, content));
                } else 
				    broadcastRunTime = Math.round(((cTime() - broadcastStartTime) / 60000) * 100) / 100;
				waitComplete = false;
				publishInProgress = false;
				if ((!isTest) && (totalSubscribers > sentMessages.length))
					setTimeout(finalStatus, 10000);
				else
					finalStatus();
			});
		}
	}

	// authorize user - middleware

	// is publisher
    try{
	    var publisherItem = {"id": message.channel};
    	storage.publishers.find(publisherItem, function(error, publishers) {
    		if (!utils.isEmpty(publishers)) {
    			// any subscribers
    			getTotalSubscribers(bot, message, storage).then(function(users) {
    				if (users.count > 0) {
                        if (isTest) bot.reply(message, "This would be published to **" + users.count + "** subscribers if the /publish command was used.<br>" + content)
                        totalSubscribers = 500;     //users.count
    					// validate message					
    					broadcastStartTime = cTime();
    					job[broadcastStartTime] = {'killed': false, 'sentMessages': []};
    					sentMessages = job[broadcastStartTime].sentMessages;        //?????
    					if (!isTest) bot.reply(message, "Use **/kill/" + broadcastStartTime + "** to stop this broadcast.");
                        setTimeout(progress, 10000); //10000
    					timout_progress = setInterval(progress, bot.botkit.config.env.fabian_progressUpdateTime);
    					triggerBroadcast(users.internal).then(function() {
    						if ((!isTest) && (users.shouldWait == true)) {
    							waitStartTime = cTime();
    							if (!job[broadcastStartTime].killed) {
    								bot.reply(message, "Internal broadcast complete. Waiting for " + (Math.round((users.waitTime / 60000)*100)/100) + "m before sending to external domains. Use **/kill/" + broadcastStartTime + "** to stop this broadcast.");
    								setTimeout(finalWarning, users.finalWarningTime);
    								setTimeout(triggerExternalBroadcast, users.waitTime);
    							}
    						} else
    							triggerExternalBroadcast();
    					});
    				} else
    					bot.reply(message, "There are no subscribers for this space.");
    			});
    		} else
    			bot.reply(message, "This space is not initialized to publish announcements.");
    	});
    }catch(error){
        console.log(error);
    }
}

/*
Kills the broadcast and recalls already sent announcements.
/*/
SparkBroadcast.prototype.kill = function(controller, bot, message, storage) {	
	var recallMessages = function(broadcastStartTime) {
		var sentMessages = [];
		if (!utils.isEmpty(job[broadcastStartTime]) && !utils.isEmpty(job[broadcastStartTime].sentMessages))
		sentMessages = job[broadcastStartTime].sentMessages;
		var delete_count = 0;
		
		var deleteMessage = function(message) {
			controller.api.messages.remove(sentMessages[i]).then(function(resp) {
				delete_count++;
			}).catch(function(err) {
				console.log(err);
			});
		}
		for (var i=0; i<sentMessages.length; i++) {
            if (sentMessages[i] != undefined)
			setInterval(deleteMessage, 180, sentMessages[i]);
			if(i === sentMessages.length) {
				console.log("Deleted " + delete_count + " messages.");
				bot.reply(message, "Deleted **" + delete_count + "** sent messages successfully.");
			}
		}
	};
	
	if (!utils.isEmpty(message.match["input"])) {
		var messageParams = message.match["input"].split("/").filter(function(entry) { return entry.trim() != ''; });
		if (!utils.isEmpty(messageParams) && (messageParams.length > 0)) {
			if (!utils.isEmpty(job[messageParams[1]])) {
				if (job[messageParams[1]].killed == false) {
					job[messageParams[1]].killed = true;
					setTimeout(recallMessages, 5000, messageParams[1]);
					bot.reply(message, 'Attempting to stop broadcast **' + messageParams[1] + "**");
					//console.log(job[messageParams[1]].sentMessages);
				} else {
					bot.reply(message, 'Already stopping that broadcast.');
				}
			} else {
				bot.reply(message, 'That broadcast ID is invalid or the broadcast has completed.');
			}
		}
	}
}

/*
List the last 3 notifications from the requested publisher.
/*/
SparkBroadcast.prototype.list = function(bot, message, storage) {
	var response = "";
	// find notification into db
	var notificationItem = {$and: [{"hide": false}, {"publisher_space_id": publisher_room_id}]};
	storage.notifications.find(notificationItem, function(error, notifications){
    	notifications.sort(function(a, b) {
    		return parseFloat(b.timestamp) - parseFloat(a.timestamp);
		});
		var numItemsToList = 3;
		var numItems = (Object.keys(notifications).length >= numItemsToList)?numItemsToList:Object.keys(notifications).length;
		for (i=0; i < numItems; i++) {
			response += "\n\n- - -\n\n<br>" + notifications[i].content + "<br>";
    	} 
		if (numItems == 0) response = "Looks like no notifications were sent";
		else response = "Here are the last " + numItems + " notifications I sent<br><br>" + response + "\n\n<br>";
    	bot.reply(message, response);
	});
}


/*
Statistics for the requested channel.
/*/
SparkBroadcast.prototype.stats = function(bot, message, storage) {	
	var getStats = function(message, storage, searchDomain=null) {
		var domains = [];
		var users_total = 0;
		var num_noncisco_rooms = 0;
		return new Promise(function (fulfill, reject) {
			var searchItem = {"publisher_space_ids": message.channel};
			storage.subscribers.find(searchItem, function(error, subscribers){
				if (!utils.isEmpty(subscribers)) {
					subscribers.map(function (subscriber) {
						users_total++;
						var domain = subscriber.emails[0].replace(/.*@/, "");
						if (utils.isEmpty(searchDomain)) {
							if (!utils.isEmpty(domains[domain])) domains[domain] = domains[domain] + 1;
							else domains[domain] = 1;
						} else {
							if (domain.indexOf(searchDomain) >= 0) {
								if (!utils.isEmpty(domains[domain])) domains[domain] = domains[domain] + 1;
								else domains[domain] = 1;
							}
						}
						if (domain != bot.botkit.config.env.fabian_internalDomain) num_noncisco_rooms++;
						if(users_total === subscribers.length) fulfill(domains);
					});
				}
			});
		});
	}

	var publisherItem = {"id": message.channel};
	storage.publishers.find(publisherItem, function(error, publishers) {
		if (!utils.isEmpty(publishers)) {
			var num_subscriber_rooms = 0;
			var num_noncisco_rooms = 0;
			var domains = [];
			var text = '';
	
			var messageParams = cleanCommand(message);
			var admin_command = false;
			if (message.match[0].startsWith("/")) admin_command = true;
	
			if (admin_command) {
				if (!utils.isEmpty(messageParams.data) && utils.validateEmail(messageParams.data)) {
					console.log("User Stats");
					text = messageParams.data + ' has ';
					subscriptionStatus(storage, messageParams.data).then(function(response) {
						if (response == -1) text += '**not** ';
						text += 'interacted with Fabian and is ';
						if (response == 0) text += '**not** ';
						text += 'subscribed to get notifications from this room. ';
						bot.reply(message, text);
						return;
					});
				} else {
					getStats(message, storage, messageParams.data.trim()).then(function(domains) {
						if (utils.isEmpty(messageParams.data)) {
							if (utils.isEmpty(domains[bot.botkit.config.env.fabian_internalDomain])) domains[bot.botkit.config.env.fabian_internalDomain] = 0;
							//text = "### Usage Statistics\n> Total Users: **".$num_subscriber_rooms."**\n\n> Cisco Users: **".$domains[bot.botkit.config.env.fabian_internalDomain]."**\n\n> Non-Cisco Users: **".$num_noncisco_rooms."**\n\n > Unique Domains: **".count($domains)."**\n\n";
							domains.sort(function(a, b) {
								console.log(a);
								console.log(b);
								return parseFloat(domains[a]) - parseFloat(domains[b]);
							});							
						}
						//domains.sort(function(a, b){console.log(a); console.log(b)});
						console.log(domains);
					});
				}
			}
		} else {
			console.error('No publisher_room_id set for room ' + message.channel);
		}
	});	
}


SparkBroadcast.prototype.loadFiles = function() {
	if (botResponse.loadFiles() == true) console.log('Done. Loaded all responses.');
}

var findSubscribers = function(storage, searchQry) {
	console.log(searchQry);
	var e = new EventEmitter();
	process.nextTick(function() {
		e.emit('start');
		console.log('Triggered search');
		storage.subscribers.find(searchQry, function(error, subscribers) {
			for(i=0; i<subscribers.length; i++) {
				e.emit('data', subscribers[i]);
				if (i == subscribers.length) e.emit('end');
			}
		});
	});
	return e;
}

SparkBroadcast.prototype.test = function(controller, bot, message, storage) {
}

module.exports = new SparkBroadcast();
