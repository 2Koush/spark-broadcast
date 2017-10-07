var fs = require('fs');
var path = require('path');
var botResponse = require('../load-responses');
var utils = require('../utils');

//Default Publisher Room
var publisher_room_id = "Y2lzY29zcGFyazovL3VzL1JPT00vYTJlZmJjMTAtNDEwZC0xMWU3LTgwODItNjNiZjY3OTFlMjYy";
var job = {};

//Initialized on startup
var controller = undefined
var limiter = undefined
var log = undefined
var storage = undefined

var getTime = function() {
    return (new Date()).getTime();
}

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
                    if (lastElem && (lastElem != undefined)) 
                        response.data = lastElem.toString().replace(/,/g, " ");;
                }
            }
        }
    }
    return response;
}

var createPublisherItem = function(message, topic, tag, def) {
    return publisher = {
        id: message.channel,
        name: topic,
        owner: message.user,
        timestamp: utils.getTime(),
        tags: tag,
        is_default: def
    };
}

var deleteJob = function(broadcastStartTime) {
    if (job.hasOwnProperty(broadcastStartTime))
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
    var users = {
        'count': 0,
        'shouldWait': false
    };
    return new Promise(function(fulfill, reject) {
        var subscriberQuery = {
            $and: [{
                "publisher_space_ids": message.channel
            }, {
                "emails": {
                    $regex: "(.*@)(?!(" + process.env.bot_internalDomain + "))"
                }
            }]
        };
        var p1 = storage.subscribers.find(subscriberQuery, function(error, subscribers) {
            users.external = extractEmailOfSubscribers(subscribers).filter(function(entry) {
                return entry.trim() != '';
            });
        });
        subscriberQuery = {
            $and: [{
                "publisher_space_ids": message.channel
            }, {
                "emails": {
                    $regex: ".*@" + process.env.bot_internalDomain
                }
            }]
        };
        var p2 = storage.subscribers.find(subscriberQuery, function(error, subscribers) {
            users.internal = extractEmailOfSubscribers(subscribers).filter(function(entry) {
                return entry.trim() != '';
            });
        });
        Promise.all([p1, p2]).then(function() {
            users.count = users.internal.length + users.external.length;
            users.waitTime = 1;
            if ((users.internal.length > 0) && (users.external.length > 0)) {
                users.shouldWait = true;
                users.finalWarningTime = (process.env.bot_waitTime - (process.env.bot_waitTime / 4));
                users.waitTime = process.env.bot_waitTime;
            }
            fulfill(users);
        });
    });
}

var retrieveFile = function(bot, message) {
    return new Promise(function(fulfill, reject) {
        if (!utils.isEmpty(message.original_message.files)) {
            bot.retrieveFile(message.original_message.files[0], function(err, body) {
                if (!err) fulfill(body.split('\n'));
                else fulfill([]);
            });
        } else fulfill([]);
    });
}


var saveSubscriberItem = function(storage, subscriberSpaceId, publisherSpaceId, email, action, existingDbEntry = null) {
    email = email.trim().toLowerCase();
    var mailids = [];
    var publisherSpaces = [];
    if (existingDbEntry) {
        if (existingDbEntry.publisher_space_ids) publisherSpaces = existingDbEntry.publisher_space_ids;
        if (existingDbEntry.emails) mailids = existingDbEntry.emails;
    }
    if (action == 'subscribe') publisherSpaces.push(publisherSpaceId);
    else publisherSpaces.splice(publisherSpaces.indexOf(publisherSpaceId), 1);

    if (mailids.indexOf(email) < 0) mailids.push(email); //Safety Check

    var subscriber = {
        id: subscriberSpaceId,
        publisher_space_ids: publisherSpaces,
        emails: mailids
    };
    console.log(subscriber)
    storage.subscribers.save(subscriber).then(function(err) {
        console.log(err);
    });
}


var handleSubscription = function(bot, message, storage, userid, action, welcomeTxt) {
    var user_error = "";
    return new Promise(function(fulfill, reject) {
        if (utils.isEmpty(userid)) {
            fulfill();
            return;
        }
        var subscriberItem = {
            "emails": userid.trim().toLowerCase()
        };
        storage.subscribers.find(subscriberItem, function(error, subscribers) {
            if (!utils.isEmpty(subscribers)) {
                var _id = {
                    id: subscribers[0].id
                };
                if (action == 'subscribe') {
                    var currentSubscriptions = subscribers[0].publisher_space_ids;
                    if (currentSubscriptions.indexOf(publisher_room_id) > -1) {
                        user_error = userid.trim() + ' is already subscribed.';
                    } else {
                        saveSubscriberItem(storage, subscribers[0].id, 
                            publisher_room_id, userid, action, subscribers[0]);
                    }
                } else if (action == 'unsubscribe') {
                    saveSubscriberItem(storage, subscribers[0].id, 
                        publisher_room_id, userid, action, subscribers[0]);
                }
            } else {
                if (action == 'subscribe') {
                    //bot.say({toPersonEmail: userid.trim(), text: botResponse.getResponse('welcome')}, function(err, resp) {
                    bot.say({
                        toPersonEmail: 'koramamu@cisco.com',
                        text: welcomeTxt
                    }, function(err, resp) {
                        if (err !== null) {
                            console.error('**** Fabian: Could not send welcome message directly: ' + userid.trim() + "\n\n", err);
                            //user_error = userid.trim() +  "Could not send welcome message directly.";
                            if (err.name == "BadRequest") user_error = "429-" + userid.trim();
                            else user_error = userid.trim() + "Could not send welcome message directly.";
                        } else {
                            if (typeof(resp.id) == 'undefined') {
                                console.error('Fabian: Could not send welcome message directly: ', resp);
                                user_error = userid.trim() + "Could not send welcome message directly.";
                            }
                            saveSubscriberItem(storage, userid.trim().toLowerCase(), 
                                message.channel, userid.trim().toLowerCase(), action, null);
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
        return new Promise(function(fulfill, reject) {
            if (admin_command) {
                if (utils.isEmpty(message.original_message.files) && utils.isEmpty(messageParams.data)) {
                    bot.reply(message, 'You need provide the command like `' + message.match[0] + ' user1@domain.com [user2@domain.com ...]` or attach a file with user information.');
                    fulfill(userList);
                    return;
                } else
                    retrieveFile(bot, message).then(function(fileUserList) {
                        if (!utils.isEmpty(messageParams.data)) userList = messageParams.data.trim().split(" ");
                        if (!utils.isEmpty(fileUserList)) userList = userList.concat(fileUserList);
                        userList = userList.filter(function(entry) {
                            return entry.trim() != '';
                        });
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
        return new Promise(function(fulfill, reject) {
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
                        } else user_errors.push(user_error);
                    }
                    if (users_total === userList.length) fulfill(user_errors);
                    setTimeout(bulkSubscribe, (1000 / messagesPerSecond));
                });
            }
            bulkSubscribe();
        });
    }

    if (action === 'subscribe') welcomeTxt = botResponse.getResponse('welcome');
        /*botResponse.getResponse('welcome').then(function(welcomeMsg) {
            welcomeTxt = welcomeMsg;
        });*/

    buildUserList().then(function(userList) {
        if (!utils.isEmpty(userList)) {
            handleSubscriptions(bot, message, storage, userList, action).then(function(user_errors) {
                console.log("SparkBroadcast: subscriptionsCommandTriggered: Handled all subscriptions");
                var text = "Done. I handled " + userList.length + " user requests";
                console.log(Object.keys(user_errors).length);
                if (Object.keys(user_errors).length > 0) {
                    text += " and encountered " + Object.keys(user_errors).length + " error(s).";
                    if (Object.keys(user_errors).length <= 25) {
                        text += "\n\n";
                        user_errors.map(function(user_error) {
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
    var response = -1; //-1 => NOT_IN_DB; 0 => IN_DB_UNSUBSCRIBED; 1 => IN_DB_SUBSCRIBED

    var subscriberItem = {
        "emails": userid.trim().toLowerCase()
    };
    return new Promise(function(fulfill, reject) {
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
    var mention = '<spark-mention data-object-type="person" data-object-id="' + bot.botkit.identity.id + '">.+</spark-mention>';

    var removeRegex = new RegExp('^\\s*(</?[^>]+>\\s*)*(' + mention + '\\s*)?(</?[^>]+>\\s*)*' + message.match[0] + '(\\s*</p>\\s*<p>)?\\s*(<br/?>\\s*)*');
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
        timestamp: utils.getTime(),
        hide: false,
        publisher_space_id: message.channel
    };
}





//////////////// CORE BROADCAST /////////////////////

//Checks if the job is complete
var jobComplete = function(broadcastStartTime, action) {
    var currentJob = job[broadcastStartTime];
    if ((currentJob.items.length === 0) && Promise.all(currentJob.pArr) && (currentJob.pArr.length >= currentJob.numItems)) {
        if (currentJob.timeout) clearInterval(currentJob.timeout)
        log.info("Completed: " + action + " " + currentJob.pArr.length + " messages in " + ((getTime() - startTime) / 1000) + "s")
        currentJob.pArr = [];
    }
}

//Delete 1 message
var deleteMessage = function(broadcastStartTime, msg) {
    var currentJob = job[broadcastStartTime];
    controller.api.messagesremove(msg).then(function(){
        currentJob.pArr.push('S' + success++)
        jobComplete("Deleted")
    }).catch(function(err){
        /////max_messages++
        currentJob.pArr.push('E' + error++) 
        if (err.statusCode === 429) {
            elog.error('%s rate limit error \n%s', msg, JSON.stringify(err.headers))
            currentJob.waitTill = getTime() + (parseInt(err.headers["retry-after"])*1000) + 2000;
            currentJob.items.push(msg)
        } else {
            elog.error('%s had a %s error \n%s', msg, err.statusCode, JSON.stringify(err))
        }
        jobComplete(broadcastStartTime, "Deleted")
    })
}

//Send 1 message
var sendMessage = function(broadcastStartTime, msg, person, isSubscribe) {
    var currentJob = job[broadcastStartTime];
    controller.api.messages.create({
        markdown: msg,
        toPersonEmail: person
    }).then(function(response){
        if (isSubscribe) {              //Send Welcome Message and add user to DB
            log.info("Add to DB")
            currentJob.pArr.push('S' + currentJob.success++)
        } else {                        //Send Broadcast Message
            currentJob.pArr.push('S' + currentJob.success++)
            currentJob.completed.push(response)
        }

        jobComplete(broadcastStartTime, "Sent")
    }).catch(function(err){
        currentJob.numItems++
        console.log(err)
        currentJob.pArr.push('E' + currentJob.error++) 
        if (err.statusCode === 429) {
            controller.log.error('%s rate limit error \n%s', msg, JSON.stringify(err.headers))
            currentJob.waitTill = getTime() + (parseInt(err.headers["retry-after"])*1000) + 2000;
            currentJob.items.push(person)
        } else {
            controller.log.error('%s had a %s error \n%s', msg, err.statusCode, JSON.stringify(err))
        }
        jobComplete(broadcastStartTime, "Sent")
    })
}

var controlledBroadcast = function(broadcastStartTime, isSendMsg, isSubscribe) {
    var currentJob = job[broadcastStartTime];
    if ((!currentJob.killed) && (currentJob.items.length > 0) && (currentJob.waitTill <= getTime())) {
        limiter.removeTokens(1, function(err, remainingRequests) {
            console.log(remainingRequests)
            if (remainingRequests >= 1)
                if (isSendMsg)
                    sendMessage(broadcastStartTime, currentJob.message, currentJob.items.shift(), isSubscribe)
                else
                    deleteMessage(broadcastStartTime, currentJob.items.shift())
        });
    }
}
//////////////// END CORE BROADCAST /////////////////////




/*
Reload response files.
/*/
SparkBroadcast.prototype.loadResponse = function(bot, message) {
    if (botResponse.loadFiles() == true) {
        bot.reply(message, 'Done. Loaded all responses.');
    }
}

/*
Initialize the requested space to be a Publisher space.
/*/
SparkBroadcast.prototype.init = function(bot, message, storage) {
    console.log("SparkBroadcast: init");
    //Extract information from the admin command
    var messageParams = cleanCommand(message);

    storage.publishers.find({"id": message.channel}, function(error, publishers) {
        if (!utils.isEmpty(publishers)) {   //Already a publisher for some topic
            bot.reply(message, 'This room is already initialized as a publishing space for **' + publishers[0].name + '**');
        } else {
            var invalidCmdMsg = 'You need to provide a topic like  `' + message.match[0] + '/#tagname <topic>`';
            if (utils.isEmpty(messageParams.commands) || 
                utils.isEmpty(messageParams.commands[0]) || 
                utils.isEmpty(messageParams.data)) {    //the command is not structured correctly

                bot.reply(message, invalidCmdMsg);
            } else {
                var def = false;
                if (messageParams.commands[1]) defaultPublisher = (messageParams.commands[1] == 'true');
                //Everything's fine. Save it to DB.
                storage.publishers.save({
                    id: message.channel,
                    name: messageParams.data,
                    owner: message.user,
                    timestamp: utils.getTime(),
                    tags: messageParams.commands[0],
                    is_default: defaultPublisher
                }).then(function() {
                    bot.reply(message, "I've set everything up for **" + messageParams.data + "**.");
                }).catch(function() {
                    console.log(message, "Error Saving Publisher to DB");
                });
            }
        }
    });
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
SparkBroadcast.prototype.publish = function(bot, message, isTest, isSubscribe) {
    console.log("broadcast /publish")
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
        return new Promise(function(fulfill, reject) {
            if (!utils.isEmpty(userList)) {
                var n = 0;
                var max_messages = 20; //userList.length;
                var messagesPerSecond = process.env.bot_messagesPerSecond; // Spark can handle ~180 messages per minute per access token.
                if (isTest) messagesPerSecond = 200;
                var timeout = null;
                var requestsInProgress = 0;
                var blockBroadcast = function() {
                    if ((n >= max_messages) || (job[broadcastStartTime].killed)) {
                        if (timeout != null) clearInterval(timeout);
                        fulfill();
                        return;
                    }

                    if (
                        ((utils.getTime() - err429Time) > process.env.bot_waitTimeOn429) &&
                        (requestsInProgress < messagesPerSecond)
                    ) {
                        if (!isTest) {
                            requestsInProgress++;
                            var msg = controller.api.messages.create({
                                toPersonEmail: '2Koush@gmail.com',
                                text: n + ": " + content
                            }).then(function(resp) {
                                if (resp != undefined)
                                    sentMessages.push(resp);
                                requestsInProgress--;
                            }).catch(function(err) {
                                console.log(err);
                                console.log(msg);
                                requestsInProgress--;
                                err429Time = utils.getTime();
                            });
                        }
                        n++;
                    }
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
                var currentTime = utils.getTime();
                var timeElapsedWaiting = 0;
                if (waitStartTime > 0)
                    timeElapsedWaiting = currentTime - waitStartTime;
                if (waitComplete)
                    timeElapsedWaiting = process.env.bot_waitTime;
                var timeElapsed = currentTime - broadcastStartTime - timeElapsedWaiting;
                var hitRate = timeElapsed / sentCount;
                timeElapsed = utils.convertToMinutes(timeElapsed);
                var pendingPublishes = totalSubscribers - sentCount;
                var timeLeft = utils.convertToMinutes(hitRate * pendingPublishes);
                var percentComplete = Math.round((sentCount / totalSubscribers) * 10000) / 100;
                if (
                    (percentComplete < 100) && 
                    (waitComplete || (timeElapsedWaiting <= process.env.bot_progressUpdateTime))
                ) {
                    var text = "**" + percentComplete + "%** complete: **";
                    text += sentCount + "** sent in **" + timeElapsed;
                    text += "** minutes and **" + pendingPublishes;
                    text += "** left to send in approximately **" + timeLeft + "** minutes";
                    bot.reply(message, text);
                }
            }
        } else
            return;
    }

    var finalWarning = function() {
        if (publishInProgress && !job[broadcastStartTime].killed)
            bot.reply(message, "**Final Warning**: You have " + (Math.round((process.env.bot_waitTime / 240000) * 100) / 100) + "m before the broadcast is sent to external users. You can stop the broadcast using **/kill/" + broadcastStartTime + "**");
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
            var subscriberQuery = {
                $and: [{
                    "publisher_space_ids": message.channel
                }, {
                    "emails": {
                        $regex: "(.*@)(?!(" + process.env.bot_internalDomain + "))"
                    }
                }]
            };
            triggerBroadcast(externalUserList).then(function() {
                clearInterval(timout_progress);
                if (job.hasOwnProperty(broadcastStartTime)) setTimeout(deleteJob, process.env.bot_waitTime, broadcastStartTime);
                if (!isTest) {
                    broadcastRunTime = utils.convertToMinutes((utils.getTime() - broadcastStartTime) - process.env.bot_waitTime);
                    storage.notifications.save(createNotificationItem(message, content));
                } else
                    broadcastRunTime = utils.convertToMinutes(utils.getTime() - broadcastStartTime);
                waitComplete = false;
                publishInProgress = false;
                if ((!isTest) && (totalSubscribers > sentMessages.length))
                    setTimeout(finalStatus, 10000);
                else
                    finalStatus();
            });
        }
    }


    // any subscribers
    getTotalSubscribers(bot, message).then(function(users) {
        if (users.count > 0) {
            if (isTest) bot.reply(message, "This would be published to **" + users.count + "** subscribers if the /publish command was used.<br>" + content)
            totalSubscribers = 10; //users.count
            users.internal = [];
            for (i=0; i<totalSubscribers; i++) users.internal.push('koramamu@cisco.com')
            // validate message                    
            broadcastStartTime = getTime();
            job[broadcastStartTime] = {
                'message': content,
                'items': users.internal.slice(),
                'numItems': users.internal.length,
                'timeout': undefined,
                'completed': [],
                'success': 0,
                'error': 0,
                'killed': false,
                'hasMoreItems': true,
                'waitTill': 0,
                'pArr': []
            };
            ///////sentMessages = job[broadcastStartTime].sentMessages; //?????
            if (!isTest) bot.reply(message, "Use **/kill/" + broadcastStartTime + "** to stop this broadcast.");
            //////setTimeout(progress, 10000); //10000
            //////timout_progress = setInterval(progress, process.env.bot_progressUpdateTime);
            console.log("Calling controlledBroadcast")
            job[broadcastStartTime].timeout = setInterval(controlledBroadcast, (1000 / process.env.bot_messagesPerSecond), broadcastStartTime, true, false);
            /*triggerBroadcast(users.internal).then(function() {
                if ((!isTest) && (users.shouldWait == true)) {
                    waitStartTime = utils.getTime();
                    if (!job[broadcastStartTime].killed) {
                        bot.reply(message, "Internal broadcast complete. Waiting for " + utils.convertToMinutes(users.waitTime) + "m before sending to external domains. Use ** /kill/" + broadcastStartTime + "** to stop this broadcast.");
                        setTimeout(finalWarning, users.finalWarningTime);
                        setTimeout(triggerExternalBroadcast, users.waitTime);
                    }
                } else
                    triggerExternalBroadcast();
            });*/
        } else
            bot.reply(message, "There are no subscribers for this space.");
    });
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


        var triggerDelete = function() {
            if (!utils.isEmpty(sentMessages)) {
                var delete_count = 0;
                var messagesPerSecond = process.env.bot_messagesPerSecond; // Spark can handle ~180 messages per minute per access token.
                var timeout = null;
                var requestsInProgress = 0;
                var err429Time = 1;
                var blockBroadcast = function() {
                    if (delete_count >= sentMessages.length) {
                        if (timeout != null) clearInterval(timeout);
                        bot.reply(message, "Deleted **" + delete_count + "** sent messages successfully.");
                        return;
                    }

                    if (
                        ((utils.getTime() - err429Time) > process.env.bot_waitTimeOn429) &&
                        (requestsInProgress < messagesPerSecond)
                    ) {
                        requestsInProgress++;
                        var msg = controller.api.messages.remove(message).then(function(resp) {
                            requestsInProgress--;
                        }).catch(function(err) {
                            sentMessages.push(message);
                            console.log(err.headers);
                            console.log(msg);
                            requestsInProgress--;
                            err429Time = utils.getTime();
                        });
                        delete_count++;
                    }
                }
                timeout = setInterval(blockBroadcast, (1000 / messagesPerSecond));
            }
        }

        triggerDelete();








        /*var deleteMessage = function(message) {
            controller.api.messages.remove(message).then(function(resp) {
                delete_count++;
            }).catch(function(err) {
                console.log(err);
            });
        }
        for (var i = 0; i < sentMessages.length; i++) {
            if (sentMessages[i] != undefined)
                setInterval(deleteMessage, 180, sentMessages[i]);
            if (i === sentMessages.length) {
                console.log("Deleted " + delete_count + " messages.");
                bot.reply(message, "Deleted **" + delete_count + "** sent messages successfully.");
            }
        }*/
    };

    if (!utils.isEmpty(message.match["input"])) {
        var messageParams = message.match["input"].split("/").filter(function(entry) {
            return entry.trim() != '';
        });
        if (!utils.isEmpty(messageParams) && (messageParams.length > 0)) {
            if (!utils.isEmpty(job[messageParams[1]])) {
                if (job[messageParams[1]].killed == false) {
                    job[messageParams[1]].killed = true;
                    bot.reply(message, 'Attempting to stop broadcast **' + messageParams[1] + "**");
                    //5sec delay to ensure that any in-flight messages are added to the sentMessages array
                    setTimeout(recallMessages, 5000, messageParams[1]);
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
List the last N notifications from the requested publisher.

.env settings:
bot_listAnnoucements=3      //List up to 3 notifications
/*/
SparkBroadcast.prototype.list = function(bot, message, storage) {
    var response = "";
    // find notification into db
    var notificationItem = {
        $and: [{
            "hide": false
        }, {
            "publisher_space_id": publisher_room_id
        }]
    };
    storage.notifications.find(notificationItem, function(error, notifications) {
        notifications.sort(function(a, b) {
            return parseFloat(b.timestamp) - parseFloat(a.timestamp);
        });
        var numItems = (Object.keys(notifications).length >= process.env.bot_listAnnoucements) ? process.env.bot_listAnnoucements : Object.keys(notifications).length;
        for (i = 0; i < numItems; i++) response += "\n\n- - -\n\n<br>" + notifications[i].content + "<br>";
        if (numItems == 0) response = "Looks like no notifications were sent";
        else response = "Here are the last " + numItems + " notifications I sent<br><br>" + response + "\n\n<br>";
        bot.reply(message, response);
    });
}


/*
Statistics for the requested Publishing Space.
1. User is subscribed or not
2. How many users are in a given domain
3. General Staistics (total users, top domins, bottom domains etc.)

.env settings:
bot_internalDomain=cisco.com    //Your domain (for internal stats)
bot_topDomains=10               //Who are the top users
bot_bottomDomains=5             //Which org uses the bot the least
/*/
SparkBroadcast.prototype.stats = function(bot, message, storage) {
    var getStats = function(message, storage, searchDomain = null) {
        var response = {};
        var domains = new Object();
        var users_total = 0;
        var num_noncisco_rooms = 0;
        return new Promise(function (fulfill, reject) {
            //Mongodb call to get all subscribers for this publisher
            storage.subscribers.find({"publisher_space_ids": 'Y2lzY29zcGFyazovL3VzL1JPT00vYmViYjA0MDAtYWRkNy0xMWU2LWI5YmQtY2QzZWI1OWE1YjFj' /*message.channel*/}, function(error, subscribers){
                if (!utils.isEmpty(subscribers)) {
                    subscribers.map(function (subscriber) {
                        users_total++;
                        var domain = subscriber.emails[0].replace(/.*@/, "");
                        if (utils.isEmpty(searchDomain)) {
                            if (!utils.isEmpty(domains[domain])) domains[domain]++;
                            else domains[domain] = 1;
                        } else {
                            if (domain.indexOf(searchDomain) >= 0) {
                                if (!utils.isEmpty(domains[domain])) domains[domain]++;
                                else domains[domain] = 1;
                            }
                        }
                        if (domain != process.env.bot_internalDomain) num_noncisco_rooms++;
                        if(users_total === subscribers.length) {
                            if (utils.isEmpty(searchDomain)) {
                                // sort by value
                                var sortable = [];
                                for (var domain in domains) {
                                    if (domain != process.env.bot_internalDomain)
                                        sortable.push([domain, domains[domain]]);
                                }

                                sortable.sort(function(a, b) {
                                    return b[1] - a[1];
                                });

                                response.users_total = users_total;                                 //Total Users
                                response.num_cisco_users = domains[process.env.bot_internalDomain]; //Total Cisco Users
                                response.num_noncisco_users = num_noncisco_rooms;                   //Total Non Cisco Users
                                response.domains = sortable;                                        //Domain Stats
                            } else {
                                response.users_total = users_total;
                                response.domains = domains;
                            }
                            fulfill(response);
                        }
                    });
                } //else no subscribers for this publisher
            });
        });
    }


    var num_subscriber_rooms = 0;
    var num_noncisco_rooms = 0;
    var domains = [];
    var text = '';

    var messageParams = cleanCommand(message);
    //Statistics about a specific user
    if (!utils.isEmpty(messageParams.data) && utils.validateEmail(messageParams.data)) {
        console.log("User Stats");
        text = messageParams.data + ' has ';
        subscriptionStatus(storage, messageParams.data).then(function(response) {
            if (response == -1) text += '**not** ';
            text += 'interacted with ' + process.env.bot_name + ' and is ';
            if (response <= 0) text += '**not** ';
            text += 'subscribed to get notifications from this room. ';
            bot.reply(message, text);
            return;
        });
    } else {
        //Gather all statistics
        getStats(message, storage, messageParams.data.trim()).then(function(response) {
            //General Staistics (Pretty Print all data)
            if (utils.isEmpty(messageParams.data)) {
                text = "### Usage Statistics\n> Total Users: **" +  response.users_total +
                    "**\n\n> Internal Users: **" + response.num_cisco_users +
                    "**\n\n> External Users: **" + response.num_noncisco_users + 
                    "**\n\n> Unique Domains: **" + response.domains.length +
                    "**\n\n> Top Domains:";
                var topDomains = (response.domains.length > process.env.bot_topDomains)?process.env.bot_topDomains:response.domains.length;
                var bottomDomains = 0;
                if (response.domains.length > (process.env.bot_topDomains + process.env.bot_bottomDomains)) bottomDomains = process.env.bot_bottomDomains;
                else if (response.domains.length > process.env.bot_topDomains) bottomDomains = response.domains.length - process.env.bot_topDomains;
                for (i=0; i<topDomains; i++) {
                    text += "\n" + (i+1) + ". " + response.domains[i][0] + ": **" + response.domains[i][1] + "**";
                }

                if (bottomDomains > 0) {
                    text += "\n\n> Bottom Domains:";
                    for (i=1; i<=bottomDomains; i++) {
                        text += "\n" + (i+1) + ". " + response.domains[response.domains.length - i][0] + ": **" + response.domains[response.domains.length - i][1] + "**";
                    }
                }
                bot.reply(message, text)
            //Domain Specific Statistics
            } else {
                var keys = Object.keys(response.domains);
                for (var i = 0; i < keys.length; i++) text += "\n\n* " + keys[i] + ": **" + response.domains[keys[i]] + "**";
                bot.reply(message, text)
            }
        });
    }
}


/*
Reload responses from disk to memory.
/*/
SparkBroadcast.prototype.loadFiles = function() {
    if (botResponse.loadFiles() == true) console.log('Done. Loaded all responses.');
}

/*
Import Database from JSON format to mongodb.
/*/
SparkBroadcast.prototype.importStorage = function(bot, message, storage) {
    console.log("SparkBroadcast: Import Storage");
    //Read Storage JSON
    var obj = JSON.parse(fs.readFileSync('./storage_data.json', 'utf8'));
    var subscribers = obj.app.subscribers;
    var keys = Object.keys(subscribers);
    console.log("Importing: " + keys.length + " subscribers.")
    for (var i = 0; i < keys.length; i++) {
        
        var subscriber = {
            id: keys[i],
            publisher_space_ids: subscribers[keys[i]].publisher_room_ids,
            emails: subscribers[keys[i]].emails
        };
        storage.subscribers.save(subscriber);
        if (i == keys.length-1) console.log("Import Complete");
    }
}

SparkBroadcast.prototype.initialize = function(ctrl, lmtr) {
    controller = ctrl;
    limiter = lmtr;
    log = controller.log;
    storage = controller.storage;
}

SparkBroadcast.prototype.test = function(controller, bot, message, storage) {}

module.exports = new SparkBroadcast();