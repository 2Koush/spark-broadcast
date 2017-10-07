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

var convertToMinutes = function(millisec) {
    return (Math.round((millisec / 60000) * 100) / 100);
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




var getTotalSubscribers = function(bot, message) {
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


var saveSubscriberItem = function(subscriberSpaceId, publisherSpaceId, email, action, existingDbEntry = null) {
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
    storage.subscribers.save(subscriber);
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
                        saveSubscriberItem(subscribers[0].id,
                            publisher_room_id, userid, action, subscribers[0]);
                    }
                } else if (action == 'unsubscribe') {
                    saveSubscriberItem(subscribers[0].id,
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
                            saveSubscriberItem(userid.trim().toLowerCase(),
                                message.channel, userid.trim().toLowerCase(), action, null);
                        }
                    });
                }
            }
            fulfill(user_error);
        });
    });
}


var subscriptionsCommandTriggered = function(bot, message, action) {
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

/*var unsubscribeTask = function(userid) {
        var subscriberItem = ;
        storage.subscribers.find({"emails": userid.trim().toLowerCase()}, function(error, subscribers) {
            if (!utils.isEmpty(subscribers)) {
        });
}*/

//Checks if the job is complete
var jobComplete = function(broadcastStartTime, action) {
    var currentJob = job[broadcastStartTime];
    if ((currentJob.items.length === 0) && Promise.all(currentJob.pArr) && (currentJob.pArr.length >= currentJob.numItems)) {
        if (currentJob.timeout) clearInterval(currentJob.timeout)
        log.info("Completed: " + action + " " + currentJob.pArr.length + " messages in " + ((getTime() - broadcastStartTime) / 1000) + "s")
        currentJob.pArr = [];
        currentJob.callback(broadcastStartTime);
    }
}

//Delete 1 message
var deleteMessage = function(broadcastStartTime, item) {
    var currentJob = job[broadcastStartTime];
    controller.api.messages.remove(item).then(function() { //DELETE MESSAGE
        currentJob.pArr.push('S' + success++)
        jobComplete(broadcastStartTime, "Deleted")
    }).catch(function(err) {
        currentJob.pArr.push('E' + currentJob.error++)
        if (err.statusCode === 429) { //RATE-LIMT. So willTill => retry-after (plus a 2s safety == Being nice to Spark)
            log.error('%s rate limit error \n%s', item, JSON.stringify(err.headers))
            if (currentJob.waitTill > getTime()) currentJob.waitTill += (parseInt(err.headers["retry-after"]) * 1000);
            else currentJob.waitTill = (getTime() + (parseInt(err.headers["retry-after"]) * 1000) + 2000);
            currentJob.items.push(item) //RETRY
            currentJob.numItems++
        } else {
            log.error('%s had a %s error \n%s', item, err.statusCode, JSON.stringify(err))
        }
        jobComplete(broadcastStartTime, "Deleted")
    })
}

//Send 1 message
var sendMessage = function(broadcastStartTime, msg, person, isSubscribe) {
    var currentJob = job[broadcastStartTime];
    if (isSubscribe === 2) { //UNSUBSCRIBE
        saveSubscriberItem(response.roomId, currentJob.publisherId, person, 'unsubscribe');
        log.info("Remove from DB")
        currentJob.pArr.push('S' + currentJob.success++)
        jobComplete(broadcastStartTime, "Published")
    } else {
        controller.api.messages.create({ //SEND MESSAGE
            markdown: msg,
            toPersonEmail: person
        }).then(function(response) {
            currentJob.completed.push(response)
            if (isSubscribe == 1) { //SUBSCRIBE
                saveSubscriberItem(response.roomId, currentJob.publisherId, person, 'subscribe');
                log.info("Add to DB")
                currentJob.pArr.push('S' + currentJob.success++)
                jobComplete(broadcastStartTime, "Published")
            } else { //PUBLISH
                currentJob.pArr.push('S' + currentJob.success++)
                jobComplete(broadcastStartTime, "Published")
            }
        }).catch(function(err) {
            currentJob.pArr.push('E' + currentJob.error++)
            if (err.statusCode === 429) { //RATE-LIMT. So willTill => retry-after (plus a 2s safety == Being nice to Spark)
                console.log(msg + ' rate limit error \n' + JSON.stringify(err.headers))
                //log.error('%s rate limit error \n%s', msg, JSON.stringify(err.headers))
                if (currentJob.waitTill > getTime()) currentJob.waitTill += (parseInt(err.headers["retry-after"]) * 1000);
                else currentJob.waitTill = (getTime() + (parseInt(err.headers["retry-after"]) * 1000) + 2000);
                currentJob.items.push(person) //RETRY
                currentJob.numItems++
            } else {
                controller.log.error('%s had a %s error \n%s', msg, err.statusCode, JSON.stringify(err))
            }
            jobComplete(broadcastStartTime, "Sent")
        })
    }
}

var controlledBroadcast = function(broadcastStartTime, isSendMsg, isSubscribe) {
    var currentJob = job[broadcastStartTime];
    if ((currentJob.items.length > 0) && (currentJob.waitTill <= getTime())) {
        limiter.removeTokens(1, function(err, remainingRequests) {
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

    storage.publishers.find({
        "id": message.channel
    }, function(error, publishers) {
        if (!utils.isEmpty(publishers)) { //Already a publisher for some topic
            bot.reply(message, 'This room is already initialized as a publishing space for **' + publishers[0].name + '**');
        } else {
            var invalidCmdMsg = 'You need to provide a topic like  `' + message.match[0] + '/#tagname <topic>`';
            if (utils.isEmpty(messageParams.commands) ||
                utils.isEmpty(messageParams.commands[0]) ||
                utils.isEmpty(messageParams.data)) { //the command is not structured correctly

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
    log.info("SparkBroadcast: subscribe");
    subscriptionsCommandTriggered(bot, message, 'subscribe');
}

/*
Unsubscribe the user from getting future notifications.
/*/
SparkBroadcast.prototype.unsubscribe = function(bot, message, storage) {
    log.info("SparkBroadcast: unsubscribe");
    subscriptionsCommandTriggered(bot, message, 'unsubscribe');
}

/*
Checks if the user is subscribed for notifications.
/*/
SparkBroadcast.prototype.subscription_status = function(bot, message, storage) {
    log.info("SparkBroadcast: subscription_status");
    subscriptionStatus(storage, message.user).then(function(response) {
        if (response > 0) return true;
        else return false;
    });
}

/*
Publish the notifications from the requested channel to all subscribers.
/*/
SparkBroadcast.prototype.publish = function(bot, message, isTest, isSubscribe) {
    log.info("SparkBroadcast: publish");
    var content = this.cleanMessage(bot, message);
    var broadcastStartTime = 0;
    var broadcastRunTime = 0;
    var sentMessages = [];
    var totalSubscribers = 0;

    // any subscribers
    getTotalSubscribers(bot, message).then(function(users) {
        log.info("broadcast /publish getTotalSubscribers: " + users.count)
        if (users.count > 0) {
            if (isTest) bot.reply(message, "This would be published to **" + users.count + "** subscribers if the /publish command was used.<br>" + content)
            totalSubscribers = 500; //users.count
            users.internal = [];
            users.external = [];
            for (i = 0; i < totalSubscribers; i++) {
                users.internal.push('koramamu@cisco.com')
                users.external.push('koramamu@cisco.com')
            }

            var progress = function(broadcastStartTime) {
                console.log("progress: " + broadcastStartTime);
                var currentJob = job[broadcastStartTime];
                if (currentJob && !currentJob.killed) {
                    console.log("progress: " + currentJob.killed);
                    var sentCount = currentJob.completed.length;
                    console.log("progress: " + sentCount);
                    if (sentCount > 0) {
                        var currentTime = getTime();
                        var timeElapsedWaiting = 0;
                        if (currentJob.waitStartTime > 0)
                            timeElapsedWaiting = currentTime - currentJob.waitStartTime;
                        if (currentJob.waitComplete)
                            timeElapsedWaiting = process.env.bot_waitTime;
                        var timeElapsed = currentTime - broadcastStartTime - timeElapsedWaiting;
                        var hitRate = timeElapsed / sentCount;
                        timeElapsed = convertToMinutes(timeElapsed);
                        console.log(currentJob.totalNumItems)
                        var pendingPublishes = currentJob.totalNumItems - sentCount;
                        var timeLeft = convertToMinutes(hitRate * pendingPublishes);
                        var percentComplete = Math.round((sentCount / currentJob.totalNumItems) * 10000) / 100;
                        console.log(percentComplete)
                        console.log(timeElapsedWaiting)
                        if (
                            (percentComplete < 100) &&
                            (timeElapsedWaiting <= process.env.bot_progressUpdateTime)
                        ) {
                            var text = "**" + percentComplete + "%** complete: **";
                            text += sentCount + "** sent in **" + timeElapsed;
                            text += "** minutes and **" + pendingPublishes;
                            text += "** left to send in approximately **" + timeLeft + "** minutes";
                            console.log(text)
                            bot.reply(message, text);
                        } else if (percentComplete === 100)
                            delete job[broadcastStartTime]
                    }
                } else if (currentJob && currentJob.killed && ((getTime() - broadcastStartTime) > 3600000)) {
                    console.log("Ghost Progres")
                    delete job[broadcastStartTime]
                }
            }

            var finalStatus = function(broadcastStartTime) {
                if (job[broadcastStartTime].timeout_progress) clearInterval(job[broadcastStartTime].timeout_progress)
                if (!utils.isEmpty(job[broadcastStartTime]) && (job[broadcastStartTime].killed == false) && !isTest) {
                    broadcastRunTime = convertToMinutes((getTime() - broadcastStartTime) - process.env.bot_waitTime);
                    storage.notifications.save(createNotificationItem(message, content));
                    bot.reply(message, "<@personId:" + message.original_message.personId + ">, All done. I sent **" + job[broadcastStartTime].totalNumItems + "** notifications in **" + broadcastRunTime + "** minutes");
                } else if (isTest) {
                    broadcastRunTime = utils.convertToMinutes(utils.getTime() - broadcastStartTime);
                    bot.reply(message, "<@personId:" + message.original_message.personId + ">, All done. I sent **1** notifications in **" + broadcastRunTime + "** minutes");
                }
                delete job[broadcastStartTime]
            }

            var triggerExternalBroadcast = function(broadcastStartTime) {
                if (job[broadcastStartTime] && !job[broadcastStartTime].killed) {
                    job[broadcastStartTime].waitComplete = true
                    job[broadcastStartTime].timeout_progress = setInterval(progress, process.env.bot_progressUpdateTime, broadcastStartTime);
                    if (!isTest) bot.reply(message, "Continuing broadcast to external domains.");
                    job[broadcastStartTime].items = users.external.slice();
                    job[broadcastStartTime].numItems = users.external.length;
                    job[broadcastStartTime].success = 0;
                    job[broadcastStartTime].error = 0;
                    job[broadcastStartTime].callback = finalStatus;
                    job[broadcastStartTime].timeout = setInterval(controlledBroadcast, (1000 / process.env.bot_messagesPerSecond), broadcastStartTime, true, 0);
                }
            }

            var finalWarning = function(broadcastStartTime) {
                if (job[broadcastStartTime] && !job[broadcastStartTime].killed)
                    bot.reply(message, "**Final Warning**: You have " + (Math.round((process.env.bot_waitTime / 240000) * 100) / 100) + "m before the broadcast is sent to external users. You can stop the broadcast using **/kill/" + broadcastStartTime + "**");
            }

            var internalBroadcastComplete = function(broadcastStartTime) {
                if (job[broadcastStartTime].timeout_progress) clearInterval(job[broadcastStartTime].timeout_progress)
                bot.reply(message, "Internal broadcast complete. Waiting for " + convertToMinutes(users.waitTime) + "m before sending to external domains. Use **/kill/" + broadcastStartTime + "** to stop this broadcast.")
                if (users.shouldWait) {
                    job[broadcastStartTime].waitStartTime = getTime()
                    job[broadcastStartTime].timeout_warining = setTimeout(finalWarning, users.finalWarningTime, broadcastStartTime)
                    job[broadcastStartTime].timeout_external = setTimeout(triggerExternalBroadcast, users.waitTime, broadcastStartTime)
                } else {
                    finalStatus(broadcastStartTime)
                }
            }

            broadcastStartTime = getTime();
            job[broadcastStartTime] = {
                'publisherId': message.channel,
                'message': content,
                'items': users.internal.slice(),
                'numItems': users.internal.length,
                'totalNumItems': (users.internal.length + users.external.length),
                'timeout': undefined,
                'success': 0,
                'error': 0,
                'completed': [],
                'killed': false,
                'waitTill': 0,
                'pArr': [],
                'callback': internalBroadcastComplete,
                'timeout_warining': undefined,
                'timeout_external': undefined,
                'timeout_progress': undefined,
                'waitStartTime': 0,
                'waitComplete': false
            };
            if (!isTest) bot.reply(message, "Use **/kill/" + broadcastStartTime + "** to stop this broadcast.");
            console.log("Calling controlledBroadcast")
            job[broadcastStartTime].timeout = setInterval(controlledBroadcast, (1000 / process.env.bot_messagesPerSecond), broadcastStartTime, true, false);
            setTimeout(progress, 5000, broadcastStartTime); //10000
            job[broadcastStartTime].timeout_progress = setInterval(progress, process.env.bot_progressUpdateTime, broadcastStartTime);

        } else
            bot.reply(message, "There are no subscribers for this space.");
    });
}

/*
Kills the broadcast and recalls already sent announcements.
/*/
SparkBroadcast.prototype.kill = function(bot, message) {
    var finalStatus = function(broadcastStartTime) {
        if (!utils.isEmpty(job[broadcastStartTime]) && (job[broadcastStartTime].killed == true))
            bot.reply(message, "<@personId:" + message.original_message.personId + ">, All done. Recalled **" + job[broadcastStartTime].completed.length + "** notifications");
        delete job[broadcastStartTime]
    }

    var recallMessages = function(broadcastStartTime) {
        if (!utils.isEmpty(job[broadcastStartTime])) {
            for (i = 0; i < job[broadcastStartTime].completed.length; i++)
                job[broadcastStartTime].items[i] = job[broadcastStartTime].completed[i];
            job[broadcastStartTime].completed = [];
            job[broadcastStartTime].numItems = job[broadcastStartTime].items.length;
            log.info("Starting recall of %s messages", job[broadcastStartTime].numItems)
            job[broadcastStartTime].timeout = setInterval(controlledBroadcast, (1000 / process.env.bot_messagesPerSecond), broadcastStartTime, false, 0);

        }
    };

    if (!utils.isEmpty(message.match["input"])) {
        var messageParams = message.match["input"].split("/").filter(function(entry) {
            return entry.trim() != '';
        });
        if (!utils.isEmpty(messageParams) && (messageParams.length > 0)) {
            if (!utils.isEmpty(job[messageParams[1]])) {
                console.log("killed")
                var broadcastStartTime = messageParams[1];
                if (job[broadcastStartTime].killed == false) {
                    log.info("Need to recall %s messages", job[broadcastStartTime].completed.length)
                    job[broadcastStartTime].killed = true;
                    if (job[broadcastStartTime].timeout) clearInterval(job[broadcastStartTime].timeout)
                    if (job[broadcastStartTime].timeout_warning) clearInterval(job[broadcastStartTime].timeout_warning)
                    if (job[broadcastStartTime].timeout_external) clearInterval(job[broadcastStartTime].timeout_external)
                    console.log(job[broadcastStartTime].timeout_progress)
                    if (job[broadcastStartTime].timeout_progress) clearInterval(job[broadcastStartTime].timeout_progress)
                    job[broadcastStartTime].items = [];
                    job[broadcastStartTime].success = 0;
                    job[broadcastStartTime].error = 0;
                    job[broadcastStartTime].callback = finalStatus;
                    bot.reply(message, 'Attempting to stop broadcast **' + broadcastStartTime + "**");
                    //5sec delay to ensure that any in-flight messages are added to the sentMessages array
                    setTimeout(recallMessages, 5000, broadcastStartTime);
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
        return new Promise(function(fulfill, reject) {
            //Mongodb call to get all subscribers for this publisher
            storage.subscribers.find({
                "publisher_space_ids": 'Y2lzY29zcGFyazovL3VzL1JPT00vYmViYjA0MDAtYWRkNy0xMWU2LWI5YmQtY2QzZWI1OWE1YjFj' /*message.channel*/
            }, function(error, subscribers) {
                if (!utils.isEmpty(subscribers)) {
                    subscribers.map(function(subscriber) { //FOR EACH SUBSCRIBED USER
                        users_total++;
                        var domain = subscriber.emails[0].replace(/.*@/, ""); //EXTRACT THE DOMAIN
                        if (utils.isEmpty(searchDomain)) { //GENERAL STATS
                            if (!utils.isEmpty(domains[domain])) domains[domain]++;
                            else domains[domain] = 1;
                        } else { //STATS FOR A SPECIFIC DOMAIN
                            if (domain.indexOf(searchDomain) >= 0) {
                                if (!utils.isEmpty(domains[domain])) domains[domain]++;
                                else domains[domain] = 1;
                            }
                        }
                        if (domain != process.env.bot_internalDomain) num_noncisco_rooms++;
                        if (users_total === subscribers.length) {
                            if (utils.isEmpty(searchDomain)) {
                                // SORT BY VALUE - ASCENDING ORDER OF USERS (in each domain)
                                var sortable = [];
                                for (var domain in domains) {
                                    if (domain != process.env.bot_internalDomain)
                                        sortable.push([domain, domains[domain]]);
                                }

                                sortable.sort(function(a, b) {
                                    return b[1] - a[1];
                                });

                                response.users_total = users_total; //Total Users
                                response.num_cisco_users = domains[process.env.bot_internalDomain]; //Total Cisco Users
                                response.num_noncisco_users = num_noncisco_rooms; //Total Non Cisco Users
                                response.domains = sortable; //Domain Stats
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
    if (!utils.isEmpty(messageParams.data) && utils.validateEmail(messageParams.data)) { //USER SPECIFIC STATS
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
    } else { //GENERAL STATS or DOMAIN SPECIFIC STATS
        //Gather all statistics
        getStats(message, storage, messageParams.data.trim()).then(function(response) {
            //General Staistics (Pretty Print all data)
            if (utils.isEmpty(messageParams.data)) {
                text = "### Usage Statistics\n> Total Users: **" + response.users_total +
                    "**\n\n> Internal Users: **" + response.num_cisco_users +
                    "**\n\n> External Users: **" + response.num_noncisco_users +
                    "**\n\n> Unique Domains: **" + response.domains.length +
                    "**\n\n> Top Domains:";
                var topDomains = (response.domains.length > process.env.bot_topDomains) ? process.env.bot_topDomains : response.domains.length;
                var bottomDomains = 0;
                if (response.domains.length > (process.env.bot_topDomains + process.env.bot_bottomDomains)) bottomDomains = process.env.bot_bottomDomains;
                else if (response.domains.length > process.env.bot_topDomains) bottomDomains = response.domains.length - process.env.bot_topDomains;

                //PRINT TOP X DOMAINS
                for (i = 0; i < topDomains; i++) {
                    text += "\n" + (i + 1) + ". " + response.domains[i][0] + ": **" + response.domains[i][1] + "**";
                }

                //PRINT BOTTOM X DOMAINS
                if (bottomDomains > 0) {
                    text += "\n\n> Bottom Domains:";
                    for (i = 1; i <= bottomDomains; i++) {
                        text += "\n" + (i + 1) + ". " + response.domains[response.domains.length - i][0] + ": **" + response.domains[response.domains.length - i][1] + "**";
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
SparkBroadcast.prototype.importStorage = function(bot, message) {
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
        if (i == keys.length - 1) console.log("Import Complete");
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