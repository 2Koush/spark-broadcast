var fs = require('fs');
var botResponse = require('../load-responses');
var utils = require('../utils');

var job = {};

//Initialized on startup
var controller = undefined;
var limiter = undefined;
var log = undefined;
var storage = undefined;
var allSubscriberEmails = [];

const NOT_IN_DB = -1;
const IN_DB_NOT_SUBSCRIBED = 0;     //In the DB, but is not subscribed to the specified channel
const IN_DB_SUBSCRIBED = 1;

const BROADCAST_ALL = 0;
const BROADCAST_INTERNAL = 1;
const BROADCAST_EXTERNAL = 2;

/*
Helper Function: Takes an admin command and extracts sub-commands and data.
Example: cleanCommand(message) where message constains "/init/#tag Some Text"
Result will have commands=[#tag] data="Some Text"
/*/
var cleanCommand = function(message) {
    var response = {};
    var msgArray = message.text.split(message.match[0]);
    if (msgArray[1].indexOf("/") == -1) response.data = msgArray[1];
    else {
        var commands = msgArray[1].split("/");
        if (commands && (commands != 'undefined')) {
            if (commands[0] == "") commands.splice(0, 1);
            if (Object.keys(commands).length > 0) {
                var lastElem = commands[Object.keys(commands).length - 1].split(" ");
                if (lastElem && (lastElem != 'undefined')) {
                    commands[Object.keys(commands).length - 1] = lastElem[0];
                    response.commands = commands;
                    lastElem.splice(0, 1);
                    if (lastElem && (lastElem != undefined))
                        response.data = lastElem.toString().replace(/,/g, " ");
                }
            }
        }
    }
    return response;
}

/*
Helper Function: Prepare a notification object ready for mongoDB.
*/
var createNotificationItem = function(message, content, isHide) {
    return notification = {
        id: message.original_message.id,
        content: content,
        sender: message.user,
        timestamp: utils.getTime(),
        hide: isHide,
        publisher_space_id: message.channel
    };
}

/*
Helper Function: Remove the job from the job queue.
*/
var deleteJob = function(broadcastStartTime) {
    if (job.hasOwnProperty(broadcastStartTime))
        delete job[broadcastStartTime];
};


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

var getAllDefaultPublishers = function(bot, message) {
    return new Promise(function(fulfill, reject) {
        storage.publishers.find({"is_default": true}, function(error, publishers) {
        });
    });
}


var getTotalSubscribers = function(bot, message) {
    console.log("getTotalSubscribers");
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
        storage.subscribers.find(subscriberQuery, function(error, subscribers) {
            //console.log(subscribers);
            extractEmailOfSubscribers(subscribers).then(function(userList) {
                users.external = userList;
            });
            console.log("getTotalSubscribers: External Complete");

            subscriberQuery = {
                $and: [{
                    "publisher_space_ids": message.channel
                }, {
                    "emails": {
                        $regex: ".*@(" + process.env.bot_internalDomain + ")"
                    }
                }]
            };
            storage.subscribers.find(subscriberQuery, function(error, subscribers) {
                //console.log(subscribers);
                extractEmailOfSubscribers(subscribers).then(function(userList) {
                    users.internal = userList;
                    console.log(users);
                    users.count = 0;
                    if (users.internal) users.count = users.internal.length;
                    else users.internal = [];
                    if (users.external) users.count += users.external.length;
                    else users.external = [];
                    if ((users.internal.length > 0) && (users.external.length > 0)) {
                        users.shouldWait = true;
                        var bot_waitTime = utils.convertSecToMillis(process.env.bot_waitTime)
                        users.finalWarningTime = bot_waitTime - (bot_waitTime / 4);
                        users.waitTime = bot_waitTime;
                    } else {
                        users.waitTime = 1;                   
                    }
                    fulfill(users);
                });
                console.log("getTotalSubscribers: Internal");
            });
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

var saveSubscriberItem = function(subscriberSpaceId, publisherSpaceId, email, action, existingDbEntry) {
    email = email.trim().toLowerCase();
    var mailids = [];
    var publisherSpaces = [];
    if (!utils.isEmpty(existingDbEntry)) {
        if (existingDbEntry.publisher_space_ids) publisherSpaces = existingDbEntry.publisher_space_ids;
        if (existingDbEntry.emails) mailids = existingDbEntry.emails;
    }
    if ((action == 'subscribe') && (typeof publisherSpaceId != 'string')) publisherSpaces = publisherSpaces.concat(publisherSpaceId);
    else if (action == 'subscribe') publisherSpaces.push(publisherSpaceId);
    else publisherSpaces.splice(publisherSpaces.indexOf(publisherSpaceId), 1);

    if (mailids.indexOf(email) < 0) mailids.push(email); //Safety Check
    utils.getUniqueArray(publisherSpaces).then(function(pubSpaces) {
        var subscriber = {
            id: subscriberSpaceId,
            publisher_space_ids: pubSpaces,
            emails: mailids
        };
        log.info(subscriber);
        storage.subscribers.save(subscriber);
    });
}

var updatePublisher = function(email, publisherSpaceId) {
    storage.subscribers.find({"emails": email.trim().toLowerCase()}, function(error, subscribers) {
        if (!utils.isEmpty(subscribers)) {
            log.debug("subscriptionStatus: %s", JSON.stringify(subscribers));
            var publisherSpaces = subscribers[0].publisher_space_ids;
            publisherSpaces.push(publisherSpaceId);
            var subscriber = {
                id: subscribers[0].id,
                publisher_space_ids: publisherSpaces,
                emails: subscribers[0].emails
            };
            log.info(subscriber);
            storage.subscribers.save(subscriber);
        }
    });
}

//////////////// CORE BROADCAST /////////////////////

//Check if a User is already in DB && subscribed to the specified channel
var subscriptionStatus = function(channel, userid) {
    var response = {"status": NOT_IN_DB, "subscriberRecord": undefined}; 

    return new Promise(function(fulfill, reject) {
        log.info("subscriptionStatus: %s", userid.trim().toLowerCase())
        storage.subscribers.find({"emails": userid.trim().toLowerCase()}, function(error, subscribers) {
            if (!utils.isEmpty(subscribers)) {
                log.debug("subscriptionStatus: %s", JSON.stringify(subscribers));
                if (subscribers[0].publisher_space_ids.indexOf(channel) > -1) 
                    response = {"status": IN_DB_SUBSCRIBED, "subscriberRecord": subscribers[0]};
                else 
                    response = {"status": IN_DB_NOT_SUBSCRIBED, "subscriberRecord": subscribers[0]};
            }
            log.info("subscriptionStatus: %s", JSON.stringify(response));
            fulfill(response);
        });
    });
}

//Checks if the job is complete
var jobComplete = function(broadcastStartTime, action) {
    log.info("%s: jobComplete - %s", broadcastStartTime, action)
    var currentJob = job[broadcastStartTime];
    if ((currentJob.items.length === 0) && Promise.all(currentJob.pArr) && (currentJob.pArr.length >= currentJob.numItems)) {
        if (currentJob.timeout) {
            clearInterval(currentJob.timeout);
        }
        log.info("%s: Completed: %s %s messages in %ss", broadcastStartTime, action, currentJob.pArr.length, ((utils.getTime() - broadcastStartTime) / 1000));
        console.log("%s: Completed: %s %s messages in %ss", broadcastStartTime, action, currentJob.pArr.length, ((utils.getTime() - broadcastStartTime) / 1000));
        currentJob.pArr = [];
        currentJob.callback(broadcastStartTime, action);
    }
}

//Delete 1 message
var deleteMessage = function(broadcastStartTime, item) {
    log.info("%s: deleteMessage - %s", broadcastStartTime, item);
    console.log("%s: deleteMessage - %s", broadcastStartTime, item);
    var currentJob = job[broadcastStartTime];
    controller.api.messages.remove(item).then(function() { //DELETE MESSAGE
        currentJob.completed.push(item.toPersonEmail);
        currentJob.pArr.push('S' + currentJob.success++);
        jobComplete(broadcastStartTime, "Deleted");
    }).catch(function(err) {
        console.log(err);
        currentJob.pArr.push('E' + currentJob.error++);
        if (err.statusCode === 429) { //RATE-LIMT. So willTill => retry-after (plus a 2s safety == Being nice to Spark)
            log.error('%s rate limit error \n%s', item, JSON.stringify(err.headers));
            if (currentJob.waitTill > utils.getTime()) currentJob.waitTill += (parseInt(err.headers["retry-after"]) * 1000);
            else currentJob.waitTill = (utils.getTime() + (parseInt(err.headers["retry-after"]) * 1000) + 2000);
            currentJob.items.push(item); //RETRY
            currentJob.numItems++;
        } else {
            log.error('%s had a %s error \n%s', item, err.statusCode, JSON.stringify(err));
        }
        jobComplete(broadcastStartTime, "Deleted");
    })
}

//Send 1 message
var sendMessage = function(broadcastStartTime, msg, person, isSubscribe, subscriberRecord=undefined) {
    //log.info("%s: sendMessage - %s", broadcastStartTime, person)
    var currentJob = job[broadcastStartTime];
    controller.api.messages.create({ //SEND MESSAGE
        markdown: msg,
        toPersonEmail: person
    }).then(function(response) {
        currentJob.completed.push(response);
        if (isSubscribe) { //SUBSCRIBE
            saveSubscriberItem(response.roomId, currentJob.publisherId, person, 'subscribe', subscriberRecord);
            log.info("%s: Subscribe %s to DB, Publisher = %s", broadcastStartTime, person, currentJob.publisherId)
            currentJob.pArr.push('S' + currentJob.success++)
            jobComplete(broadcastStartTime, "Subscribed")
        } else { //PUBLISH
            currentJob.pArr.push('S' + currentJob.success++)
            jobComplete(broadcastStartTime, "Published")
        }
    }).catch(function(err) {
        currentJob.pArr.push('E' + currentJob.error++)
        if (err.statusCode === 429) { //RATE-LIMT. So willTill => retry-after (plus a 2s safety == Being nice to Spark)
            //console.log(msg + ' rate limit error \n' + JSON.stringify(err.headers))
            log.error('%s: sendMessage - %s rate limit error %s', broadcastStartTime, msg, JSON.stringify(err.headers));
            if (currentJob.waitTill > utils.getTime()) currentJob.waitTill += (parseInt(err.headers["retry-after"]) * 1000);
            else currentJob.waitTill = (utils.getTime() + (parseInt(err.headers["retry-after"]) * 1000) + 2000);
            currentJob.items.push(person) //RETRY
            currentJob.numItems++
            currentJob.completed.push("")
        } else {
            log.error('%s had a %s error \n%s', msg, err.statusCode, JSON.stringify(err));
            if (err.statusCode === 404) { 
                currentJob.completed.push("Unable to find " + person);
            } else {
                currentJob.completed.push(err.statusCode + ": Error sending message to " + person);
            }
        }

        jobComplete(broadcastStartTime, "Sent")
    })
}

//Handle 1 subscribe or unsubscribe
var manageSubscription = function(broadcastStartTime, msg, person, isSubscribe) {
    console.log("%s: manageSubscription - %s", broadcastStartTime, person)
    var currentJob = job[broadcastStartTime];
    subscriptionStatus(currentJob.publisherId, person).then(function(response){
        if (isSubscribe) {     //ACTION TO SUBSCRIBE
            if (response.status<IN_DB_SUBSCRIBED) {
                if (response.status == NOT_IN_DB)
                    allSubscriberEmails.push(person);
                //console.log("manageSubscription: " + JSON.stringify(response.subscriberRecord))
                sendMessage(broadcastStartTime, msg, person, isSubscribe, response.subscriberRecord);
            } else {
                currentJob.completed.push(person + " is already subscribed")
                log.info("%s: %s is already subscribed to this publisher", broadcastStartTime, person)
                currentJob.pArr.push('E' + currentJob.error++)
                jobComplete(broadcastStartTime, "Subscribed")
            }
        } else {                    //ACTION TO UNSUBSCRIBE
            if (response.status == IN_DB_SUBSCRIBED) {
                saveSubscriberItem(response.subscriberRecord.id, currentJob.publisherId, person, 'unsubscribe', response.subscriberRecord);
                log.info("%s: Unsubscribe %s from DB, Publisher = %s", broadcastStartTime, person, currentJob.publisherId)
                currentJob.pArr.push('S' + currentJob.success++)
                currentJob.completed.push("")
                jobComplete(broadcastStartTime, "Unsubscribed")                
            } else {
                currentJob.pArr.push('S' + currentJob.error++)
                log.info("%s: %s is not subscribed to this publisher", broadcastStartTime, person)
                currentJob.completed.push(person + " is not subscribed to this publisher")
                jobComplete(broadcastStartTime, "Unsubscribed")  
            }
        }
    })
}

//Call worker function to send a message, delete a message, subscribe or unsubscribe a user
var controlledBroadcast = function(broadcastStartTime, action) {
    console.log("controlledBroadcast: " + action);
    var currentJob = job[broadcastStartTime];
    //console.log(currentJob);
    if ((currentJob.items.length > 0) && (currentJob.waitTill <= utils.getTime())) {
        console.log(currentJob.items.length);
        limiter.removeTokens(1, function(err, remainingRequests) {
            if (remainingRequests >= 1) {
                if (action == "publish") {
                    sendMessage(broadcastStartTime, currentJob.message, currentJob.items.shift(), false);
                } else if (action == "subscribe") {
                    console.log("controlledBroadcast: manageSubscription");
                    manageSubscription(broadcastStartTime, currentJob.message, currentJob.items.shift(), true);
                } else if (action == "unsubscribe") {
                    manageSubscription(broadcastStartTime, currentJob.message, currentJob.items.shift(), false);
                } else if (action == "kill") {
                    console.log(currentJob.items);
                    deleteMessage(broadcastStartTime, currentJob.items.shift());
                }
            }
        });
    }
}
//////////////// END CORE BROADCAST /////////////////////

var subscriptionsCommandTriggered = function(bot, message, action) {
    var userList = [];
    var welcomeTxt = "";
    var admin_command = false;
    console.log(message.match[0]);
    if (message.match[0].startsWith("/")) admin_command = true;
    console.log(admin_command);

    var buildUserList = function() {
        var messageParams = cleanCommand(message);
        console.log(messageParams);
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
                        log.info("User List before Cleanup: \n%s", userList)
                        userList = userList.map(function(x){if(utils.validateEmail(x)) return x.toLowerCase().trim()});
                        //userList.clean(undefined)
                        utils.cleanArray(userList, undefined);
                        log.info("User List after Cleanup: \n%s", userList);
                        fulfill(userList);
                    });
            } else {
                if (utils.validateEmail(message.user));
                    userList.push(message.user.toLowerCase().trim());
                fulfill(userList);
            }
        });
    }

    if (action === 'subscribe') welcomeTxt = botResponse.getResponse('welcome');

    var broadcastStartTime = 0;
    buildUserList().then(function(userList) {
        console.log(userList);
        if (!utils.isEmpty(userList)) {
            broadcastStartTime = utils.getTime();
            var taskComplete = function(broadcastStartTime, action) {
                var currentJob = job[broadcastStartTime];
                console.log("%s: Subscriptions taskComplete", broadcastStartTime);
                console.log(currentJob);
                var text = "Done. I " + action + " " + currentJob.numItems + " users";
                //if (currentJob.error > 0) text += " with " + currentJob.error + " errors<br>" + currentJob.completed.clean('')
                if (currentJob.error > 0) {
                    var errors = "";
                    utils.cleanArray(currentJob.completed, '').forEach(function(element) {
                        errors += element + "<br>";
                    });
                    text += " with " + currentJob.error + " errors<br>" + errors;
                }
                bot.reply(message, text);
            }

            console.log(userList);
            job[broadcastStartTime] = {
                'publisherId': message.channel,
                'message': welcomeTxt,
                'items': userList.slice(),
                'numItems': userList.length,
                'totalNumItems': userList.length,
                'timeout': undefined,
                'success': 0,
                'error': 0,
                'completed': [],
                'killed': false,
                'waitTill': 0,
                'pArr': [],
                'callback': taskComplete,
                'timeout_warining': undefined,
                'timeout_external': undefined,
                'timeout_progress': undefined,
                'waitStartTime': 0,
                'waitComplete': false,
                'isTest': false
            };
            console.log("%s: Starting Subscribe", broadcastStartTime);
            job[broadcastStartTime].timeout = setInterval(controlledBroadcast, (1000 / process.env.bot_messagesPerSecond), broadcastStartTime, action);
        }
    });
}


var SparkBroadcast = function() {};

SparkBroadcast.prototype.cleanMessage = function(bot, message) {
    console.log(message.text);
    var mention = '<spark-mention data-object-type="person" data-object-id="' + bot.botkit.identity.id + '">.+</spark-mention>';

    var removeRegex = new RegExp('^\\s*(</?[^>]+>\\s*)*(' + mention + '\\s*)?(</?[^>]+>\\s*)*' + message.match[0] + '(\\s*</p>\\s*<p>)?\\s*(<br/?>\\s*)*');
    //var removeRegex = new RegExp('^\\s*(</?[^>]+>\\s*)*('+mention+'\\s*)?(</?[^>]+>\\s*)*'+message.match[0]+'(/[^/\\s]+)*(\\s*</p>\\s*<p>)?\\s*(<br/?>\\s*)*');

    var content = message.text;
    if (typeof(message.original_message.html) !== 'undefined')
        content = message.original_message.html;

    return content.replace(removeRegex, "$1$3");
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
Initialize the requested space to be a Publisher space.
/*/
SparkBroadcast.prototype.init = function(bot, message) {
    log.info("%s: SparkBroadcast: init", message.channel);
    //Extract information from the admin command
    var messageParams = cleanCommand(message);

    storage.publishers.find({"id": message.channel}, function(error, publishers) {
        if (!utils.isEmpty(publishers)) { //Already a publisher for some topic
            bot.reply(message, 'This room is already initialized as a publishing space');
        } else {
            var def = true;
            log.info("init: Parsed Command: %s", messageParams);
            if (!utils.isEmpty(messageParams.commands) && (messageParams.commands[0] == 'false')) def = false;
            //Everything's fine. Save it to DB.
            storage.publishers.save({
                id: message.channel,
                owner: message.user,
                timestamp: utils.getTime(),
                is_default: def
            }).then(function() {
                log.info("init: isDefault: %s", def);
                if (def === true) {
                    //For each subscribe add this publisher as subscribed
                    storage.subscribers.find({}, function(error, subscribers) {
                        for (i=0; i<subscribers.length; i++) {
                            var publisherSpaces = subscribers[i].publisher_space_ids;
                            publisherSpaces.push(message.channel);
                            var subscriber = {
                                id: subscribers[i].id,
                                publisher_space_ids: publisherSpaces,
                                emails: subscribers[i].emails
                            };
                            log.info(subscriber);
                            storage.subscribers.save(subscriber);
                        }
                    });
                }
                bot.reply(message, "You're all set.");
            }).catch(function() {
                log.info("%s: Error Saving Publisher to DB", message.channel);
            });
        }
    });
}


/*
Subscribe the user to all default channels to get future notifications.
/*/
SparkBroadcast.prototype.userSubscribe = function(bot, message) {
    log.info("%s: SparkBroadcast: userSubscribe", message.user);
    storage.publishers.find({"is_default": true}, function(error, publishers) {
        console.log(publishers);
        if (!utils.isEmpty(publishers)) {
            subscriptionStatus("", message.user).then(function(userStatus) {
                console.log(userStatus);
                if (userStatus.status == IN_DB_SUBSCRIBED) {
                    for (i=0; i<publishers.length; i++) {
                        saveSubscriberItem(message.channel, publishers[0].id, message.user, 'subscribe', userStatus.subscriberRecord);
                    }
                } else {
                    var pubIds = [];
                    for (i=0; i<publishers.length; i++) {
                        pubIds.push(publishers[i].id);
                    }
                    saveSubscriberItem(message.channel, pubIds, message.user, 'subscribe');
                    allSubscriberEmails.push(message.user);
                }
            });
        }
    });
}


/*
Subscribe the user to get future notifications.
/*/
SparkBroadcast.prototype.subscribe = function(bot, message) {
    console.log("SparkBroadcast: subscribe");
    log.info("SparkBroadcast: subscribe");
    subscriptionsCommandTriggered(bot, message, 'subscribe');
}


/*
Unsubscribe the user to all channels to prevent getting future notifications.
/*/
SparkBroadcast.prototype.userUnsubscribe = function(bot, message) {
    log.info("%s: SparkBroadcast: userUnsubscribe", message.user);
    subscriptionStatus("", message.user).then(function(userStatus) {
        console.log(userStatus);
        if (userStatus.status != NOT_IN_DB) {
            var subscriber = {
                id: message.channel,
                publisher_space_ids: [],
                emails: userStatus.subscriberRecord.emails
            };
            log.info(subscriber);
            storage.subscribers.save(subscriber);
        }
    });
}


/*
Unsubscribe the user from getting future notifications.
/*/
SparkBroadcast.prototype.unsubscribe = function(bot, message) {
    log.info("SparkBroadcast: unsubscribe");
    subscriptionsCommandTriggered(bot, message, 'unsubscribe');
}

/*
Publish the notifications from the requested channel to all subscribers.
/*/
SparkBroadcast.prototype.publish = function(bot, message, broadcastTo, isTest) {
    log.info("%s: SparkBroadcast: publish", message.channel);
    console.log("publish")
    var content = this.cleanMessage(bot, message);
    console.log(content);
    var broadcastStartTime = 0;
    var broadcastRunTime = 0;
    var sentMessages = [];
    var totalSubscribers = 0;
    console.log(broadcastTo);

    // any subscribers
    getTotalSubscribers(bot, message).then(function(users) {
        //console.log(users);
        log.info("broadcast /publish getTotalSubscribers: " + users.count)
        if (users.count > 0) {
            if (isTest) {
                //For a test run, we will publish the message in the publisher space and to the sender
                bot.reply(message, "This would be published to **" + users.count + "** subscribers if the /publish command was used.<br>" + content)
                content = "**Test:** This would be published to **" + users.count + "** subscribers if the /publish command was used.<br>" + content;
                users.count = 1
                users.internal = [message.user];
                users.external = [];
                users.shouldWait = false;
            } else if (process.env.bot_loadTest === 'true') {
                //FOR TESTING PURPOSE ONLY. COMMENT DURING PRODUCTION
                totalSubscribers = process.env.bot_loadTestCount; //users.count
                users.count = totalSubscribers * 2;
                users.internal = [];
                users.external = [];
                for (i = 0; i < totalSubscribers; i++) {
                    users.internal.push(message.user)
                    users.external.push(message.user)
                }
                users.shouldWait = true;
                var bot_waitTime = utils.convertSecToMillis(process.env.bot_waitTime);
                users.finalWarningTime = bot_waitTime - (bot_waitTime / 4);
                users.waitTime = bot_waitTime;
            } else if (broadcastTo == BROADCAST_INTERNAL) {
                users.count = users.internal.length;
                users.external = [];
                users.shouldWait = false;
            } else if (broadcastTo == BROADCAST_EXTERNAL) {
                users.count = users.external.length;
                users.internal = [];
                users.internal = Array.from(users.external);
                users.external = [];
                users.shouldWait = false;
            }
            console.log(users);

            var progress = function(broadcastStartTime) {
                log.info("%s: progress: ", broadcastStartTime);
                var currentJob = job[broadcastStartTime];
                if (currentJob && !currentJob.killed) {
                    var sentCount = currentJob.completed.length;
                    log.info("%s: progress: Sent=%s",broadcastStartTime, sentCount);
                    if (sentCount > 0) {
                        var currentTime = utils.getTime();
                        var timeElapsedWaiting = 0;
                        if (currentJob.waitStartTime > 0)
                            timeElapsedWaiting = currentTime - currentJob.waitStartTime;
                        if (currentJob.waitComplete)
                            timeElapsedWaiting = utils.convertSecToMillis(process.env.bot_waitTime)
                        var timeElapsed = currentTime - broadcastStartTime - timeElapsedWaiting;
                        var hitRate = timeElapsed / sentCount;
                        timeElapsed = utils.convertToMinutes(timeElapsed);
                        log.info("%s: progress: Total=%s",broadcastStartTime, currentJob.totalNumItems);
                        var pendingPublishes = currentJob.totalNumItems - sentCount;
                        var timeLeft = utils.convertToMinutes(hitRate * pendingPublishes);
                        var percentComplete = Math.round((sentCount / currentJob.totalNumItems) * 10000) / 100;
                        log.info("%s: progress: Percent Complete=%s",broadcastStartTime, percentComplete);
                        log.info("%s: progress: Time timeElapsedWaiting=%s",broadcastStartTime, timeElapsedWaiting);
                        //if ((percentComplete < 100) && (!currentJob.isTest)) {
                        if (percentComplete < 100) {
                            var text = "**" + percentComplete + "%** complete: **";
                            text += sentCount + "** sent in **" + timeElapsed;
                            text += "** minutes and **" + pendingPublishes;
                            text += "** left to send in approximately **" + timeLeft + "** minutes";
                            log.info("%s: progress: %s", broadcastStartTime, text)
                            bot.reply(message, text);
                        } else if (percentComplete === 100)
                            deleteJob(broadcastStartTime)
                    }
                } else if (currentJob && currentJob.killed && ((utils.getTime() - broadcastStartTime) > 3600000)) {
                    log.info("%s: progress: Ghost Progress ... Job is already killed but not deleted.", broadcastStartTime)
                    deleteJob(broadcastStartTime)
                }
            }

            var finalStatus = function(broadcastStartTime) {
                log.info("%s: finalStatus", broadcastStartTime)
                if (job[broadcastStartTime].timeout_progress) clearInterval(job[broadcastStartTime].timeout_progress)
                if (!utils.isEmpty(job[broadcastStartTime]) && (job[broadcastStartTime].killed == false)) {
                    broadcastRunTime = utils.getTime() - broadcastStartTime;
                    if (users.shouldWait) 
                        broadcastRunTime -= utils.convertSecToMillis(process.env.bot_waitTime);
                    if (!isTest)
                        storage.notifications.save(createNotificationItem(message, content, false));
                    bot.reply(message, "<@personId:" + message.original_message.personId + ">, All done. I sent **" + job[broadcastStartTime].totalNumItems + "** notifications in **" + utils.convertToMinutes(broadcastRunTime) + "** minutes");
                }
                deleteJob(broadcastStartTime)
                log.info(job)
            }

            var triggerExternalBroadcast = function(broadcastStartTime) {
                log.info("%s: triggerExternalBroadcast", broadcastStartTime)
                if (job[broadcastStartTime] && !job[broadcastStartTime].killed) {
                    job[broadcastStartTime].waitComplete = true;
                    job[broadcastStartTime].timeout_progress = setInterval(progress, (process.env.bot_progressUpdateTime * 1000), broadcastStartTime);
                    log.info("%s: Continuing broadcast to external domains.", broadcastStartTime)
                    bot.reply(message, "Continuing broadcast to external domains.");
                    job[broadcastStartTime].items = users.external.slice();
                    log.info("%s: Total External Users: %s", broadcastStartTime, job[broadcastStartTime].items.length);
                    job[broadcastStartTime].numItems = users.external.length;
                    job[broadcastStartTime].success = 0;
                    job[broadcastStartTime].error = 0;
                    job[broadcastStartTime].callback = finalStatus;
                    job[broadcastStartTime].timeout = setInterval(controlledBroadcast, (1000 / process.env.bot_messagesPerSecond), broadcastStartTime, "publish");
                }
            }

            var finalWarning = function(broadcastStartTime) {
                log.info("%s: finalWarning", broadcastStartTime);
                if (job[broadcastStartTime] && !job[broadcastStartTime].killed) {
                    var text = "**Final Warning**: You have " + 
                        (Math.round((process.env.bot_waitTime / 240) * 100) / 100) + 
                        "m before the broadcast is sent to external users. You can stop the broadcast using **/kill/" + 
                        broadcastStartTime + "**";
                    log.info("%s: %s", broadcastStartTime, text);
                    bot.reply(message, text);
                }
            }

            var internalBroadcastComplete = function(broadcastStartTime) {
                log.info("%s: internalBroadcastComplete", broadcastStartTime);
                if (job[broadcastStartTime].timeout_progress) clearInterval(job[broadcastStartTime].timeout_progress);
                if (job[broadcastStartTime].numItems != job[broadcastStartTime].totalNumItems) {
                    var text = "Internal broadcast complete. Waiting for " + 
                        utils.convertToMinutes(users.waitTime) + 
                        "m before sending to external domains. Use **/kill/" + 
                        broadcastStartTime + "** to stop this broadcast.";
                    log.info("%s: %s", broadcastStartTime, text);
                    bot.reply(message, text);
                }
                if (users.shouldWait) {
                    job[broadcastStartTime].waitStartTime = utils.getTime();
                    job[broadcastStartTime].timeout_warining = setTimeout(finalWarning, users.finalWarningTime, broadcastStartTime);
                    job[broadcastStartTime].timeout_external = setTimeout(triggerExternalBroadcast, users.waitTime, broadcastStartTime);
                } else {
                    log.info(broadcastStartTime + ": No external users ... calling finalStatus");
                    finalStatus(broadcastStartTime);
                }
            }

            console.log("setting up the job");
            broadcastStartTime = utils.getTime();
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
                'waitComplete': false,
                'isTest': isTest
            };
            console.log(job[broadcastStartTime]);
            if (!isTest) bot.reply(message, "Use **/kill/" + broadcastStartTime + "** to stop this broadcast.");
            log.info("%s: Starting Internal Broadcast", broadcastStartTime)
            job[broadcastStartTime].timeout = setInterval(controlledBroadcast, (1000 / process.env.bot_messagesPerSecond), broadcastStartTime, "publish");
            setTimeout(progress, 5000, broadcastStartTime); //10000
            job[broadcastStartTime].timeout_progress = setInterval(progress, utils.convertSecToMillis(process.env.bot_progressUpdateTime), broadcastStartTime);

        } else
            bot.reply(message, "There are no subscribers for this space.");
    });
}

/*
Kills the broadcast and recalls already sent announcements.
/*/
SparkBroadcast.prototype.kill = function(bot, message) {
    console.log("Kill");
    var finalStatus = function(broadcastStartTime) {
        storage.notifications.save(createNotificationItem(message, job[broadcastStartTime].message, true));
        log.info("%s: Kill Complete.", broadcastStartTime);
        console.log("%s: Kill Complete.", broadcastStartTime);
        log.info(job);
        //console.log(job);
        if (!utils.isEmpty(job[broadcastStartTime]) && (job[broadcastStartTime].killed == true)) {
            bot.reply(message, "<@personId:" + message.original_message.personId + ">, All done. Recalled **" + job[broadcastStartTime].completed.length + "** notifications");
        }
        deleteJob(broadcastStartTime);
    }

    var recallMessages = function(broadcastStartTime) {
        if (!utils.isEmpty(job[broadcastStartTime])) {
            console.log(job[broadcastStartTime].items);
            console.log(job[broadcastStartTime].completed);
            for (i = 0; i < job[broadcastStartTime].completed.length; i++)
                job[broadcastStartTime].items[i] = job[broadcastStartTime].completed[i];
            job[broadcastStartTime].completed = [];
            job[broadcastStartTime].numItems = job[broadcastStartTime].items.length;
            job[broadcastStartTime].totalNumItems = job[broadcastStartTime].items.length;
            log.info("Starting recall of %s messages", job[broadcastStartTime].numItems);
            console.log("Starting recall of %s messages", job[broadcastStartTime].numItems);
            job[broadcastStartTime].timeout = setInterval(controlledBroadcast, (1000 / process.env.bot_messagesPerSecond), broadcastStartTime, "kill");

        }
    };

    if (!utils.isEmpty(message.match["input"])) {
        var messageParams = message.match["input"].split("/").filter(function(entry) {
            return entry.trim() != '';
        });
        if (!utils.isEmpty(messageParams) && (messageParams.length > 0)) {
            if (!utils.isEmpty(job[messageParams[1]])) {
                log.info("%s is already killed.", messageParams[1]);
                var broadcastStartTime = messageParams[1];
                if (job[broadcastStartTime].killed == false) {
                    log.info("Need to recall %s messages", job[broadcastStartTime].completed.length);
                    job[broadcastStartTime].killed = true;
                    if (job[broadcastStartTime].timeout) clearInterval(job[broadcastStartTime].timeout);
                    if (job[broadcastStartTime].timeout_warning) clearInterval(job[broadcastStartTime].timeout_warning);
                    if (job[broadcastStartTime].timeout_external) clearInterval(job[broadcastStartTime].timeout_external);
                    log.info(job[broadcastStartTime].timeout_progress);
                    if (job[broadcastStartTime].timeout_progress) clearInterval(job[broadcastStartTime].timeout_progress);
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
SparkBroadcast.prototype.list = function(bot, message, isDirect=false, numListing=process.env.bot_listAnnoucements) {
    var response = "";

    var printNotification = function(publishers) {
        console.log(publishers);
        // find notification into db
        var notificationItem = {
            $and: [{
                "hide": false
            }, {
                "publisher_space_id": { $in: publishers }
            }]
        };
        storage.notifications.find(notificationItem, function(error, notifications) {
            var numItems = (Object.keys(notifications).length >= numListing) ? numListing : Object.keys(notifications).length;
            notifications.sort(function(a, b) {
                return parseFloat(b.timestamp) - parseFloat(a.timestamp);
            });
            if (numItems == 0) response = "Looks like no notifications were sent";
            else {
                response = "Here are the last " + numItems + " notifications I sent<br><br>";
                bot.reply(message, response);
                var sendNotifications = function() {
                    for (i = 0; i < numItems; i++) bot.reply(message, "\n\n- - -\n\n<br>" + notifications[i].content + "<br>");
                }
                setTimeout(sendNotifications, 1000);
            }
        });
    }

    if (isDirect) {
        subscriptionStatus("", message.user).then(function(userStatus) {
            if ((userStatus.status != NOT_IN_DB) && (userStatus.subscriberRecord.publisher_space_ids.length > 0)) {
                printNotification(userStatus.subscriberRecord.publisher_space_ids);
            } else {
                bot.reply(message, botResponse.getResponse('status--notsubscribed'));
            }
        });
    } else {
        printNotification([message.channel]);
    }
}


/*
Is the user subscribed?
/*/
SparkBroadcast.prototype.subscription_status = function(bot, message) {
    subscriptionStatus("", message.user).then(function(response) {
        console.log(response);
        var result = 'status--notsubscribed';
        if ((response.status != NOT_IN_DB) && (response.subscriberRecord.publisher_space_ids.length > 0))
            result='status--subscribed';
        console.log(result);
        var reply = botResponse.getResponse(result);
        console.log(reply);
        if ((reply != null)
            && (reply.trim().length > 0)) {
            //console.log(reply);
            bot.reply(message, reply);
        }
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
SparkBroadcast.prototype.stats = function(bot, message) {
    var getStats = function(message, searchDomain = null) {
        var response = {};
        var domains = new Object();
        var users_total = 0;
        var num_noncisco_rooms = 0;
        return new Promise(function(fulfill, reject) {
            //Mongodb call to get all subscribers for this publisher
            storage.subscribers.find({
                "publisher_space_ids": message.channel
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
                                response.num_cisco_users = domains[process.env.bot_internalDomain]; //Total Internal Users
                                response.num_noncisco_users = num_noncisco_rooms; //Total External Users
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
        log.info("%s: User Stats", message.channel);
        text = messageParams.data + ' has ';
        subscriptionStatus(message.channel, messageParams.data).then(function(response) {
            if (response.status == NOT_IN_DB) text += '**not** ';
            text += 'interacted with ' + process.env.bot_name + ' and is ';
            if (response.status <= IN_DB_NOT_SUBSCRIBED) text += '**not** ';
            text += 'subscribed to get notifications from this room. ';
            bot.reply(message, text);
            return;
        });
    } else { //GENERAL STATS or DOMAIN SPECIFIC STATS
        //Gather all statistics
        getStats(message, messageParams.data.trim()).then(function(response) {
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
    if (botResponse.loadFiles() == true) log.info('Done. Loaded all responses.');
}

/*
Import Database from JSON format to mongodb.
???Delete it before going PRODUCTION
/*/
SparkBroadcast.prototype.importStorage = function(bot, message) {
    log.info("%s: SparkBroadcast: Import Storage", message.channel);
    //Read Storage JSON
    var obj = JSON.parse(fs.readFileSync('./storage_data.json', 'utf8'));
    var subscribers = obj.app.subscribers;
    var keys = Object.keys(subscribers);
    log.info("%s: Importing: %s subscribers", message.channel, keys.length);
    for (var i = 0; i < keys.length; i++) {

        var subscriber = {
            id: keys[i],
            publisher_space_ids: subscribers[keys[i]].publisher_room_ids,
            emails: subscribers[keys[i]].emails
        };
        storage.subscribers.save(subscriber);
        if (i == keys.length - 1) log.info("%s: Import Complete", message.channel);
    }
}


/*
Export Database from mongodb to subscribers and notifications
???Delete it before going PRODUCTION
/*/
SparkBroadcast.prototype.exportStorage = function(bot, message) {
    log.info("%s: SparkBroadcast: Export Storage", message.channel);
    getTotalSubscribers(bot, message).then(function(users) {
        var subscriberArray = users.internal.concat(users.external);
        var sstream = fs.createWriteStream('./subscribers-' + message.channel + '.txt');
        sstream.on('finish', function () {
            bot.reply(message,{text: 'Here are the emails of subscribers for this space.', files:[fs.createReadStream('./subscribers-' + message.channel + '.txt')]});
        });
        for (i = 0; i < subscriberArray.length; i++) sstream.write(subscriberArray[i] + '\n');
        sstream.end();
    });

    // find notification into db
    var notificationItem = {
        $and: [{
            "hide": false
        }, {
            "publisher_space_id": message.channel           ////publisher_room_id
        }]
    };
    storage.notifications.find(notificationItem, function(error, notifications) {
        notifications.sort(function(a, b) {
            return parseFloat(b.timestamp) - parseFloat(a.timestamp);
        });
        var numItems = Object.keys(notifications).length;
        var nstream = fs.createWriteStream('./notifications-' + message.channel + '.txt');
        nstream.on('finish', function () {
            bot.reply(message,{text: 'Here are the notifications sent from this space.', files:[fs.createReadStream('./notifications-' + message.channel + '.txt')]});
        });
        var date, formattedDate;
        for (j = 0; j < numItems; j++) {
            date = new Date(notifications[j].timestamp);
            formattedDate = date.getFullYear() + "-" + date.getMonth()+1 + "-" + date.getDate() + " " + date.getHours() + ":" + date.getMinutes();
            nstream.write("\n\n On " + formattedDate + ", " + notifications[j].sender + " published: " + notifications[j].content);
        }
        nstream.end();
    });
}


/*
Sets the controller, storage, logger and rate limter global object.
This helps in not passing the above objects for every operation.
*/
SparkBroadcast.prototype.addToBotCreatorSpace = function(bot, message) {
    log.info('Adding %s into Meet the Makers Space', message.user);
    if (process.env.bot_creatorSpaceId) {
        controller.api.memberships.create({ //SEND MESSAGE
            roomId: process.env.bot_creatorSpaceId,
            personEmail: message.user
        }).then(function(response){
        }).catch(function(error){
            log.error('Failed to add %s into Meet the Makers Space', message.user);
            log.error(error);
        });
    }
}


/*
Helper function to see if the user is already in in-memory user DB (allSubscriberEmails) or not.
*/
SparkBroadcast.prototype.userExists = function(email) {
    var response = -1;
    return new Promise(function(fulfill, reject) {
        response = allSubscriberEmails.indexOf(email);
        if (response == -1) {
            storage.subscribers.find({emails: email.trim().toLowerCase()}, function(error, subscribers) {
                if (!utils.isEmpty(subscribers)) response = 0;
                fulfill(response);
            });
        } else
            fulfill(response);
    });
}

/*
CALL THIS ON BOT STARTUP.
Sets the controller, storage, logger and rate limter global object.
This helps in not passing the above objects for every operation.
*/
SparkBroadcast.prototype.initialize = function(ctrl, lmtr) {
    controller = ctrl;
    limiter = lmtr;
    log = controller.logger;
    storage = controller.storage;

    //Load all subscribers from DB
    storage.subscribers.find({}, function(error, subscribers) {
        if (!utils.isEmpty(subscribers)) {
            for (i=0; i<subscribers.length; subscribers++) {
                allSubscriberEmails.push(subscribers[i].emails[0]);
            }
        }
    });
}

SparkBroadcast.prototype.test = function(controller, bot, message, storage) {}

module.exports = new SparkBroadcast();