var broadcast = require('../spark-broadcast');
var utils = require('../utils');
var botResponse = require('../load-responses');
var sparkUtils = require('../spark-utils');

var isPublisher = function(message, storage) {
    return new Promise(function (fulfill, reject) {
        storage.publishers.find({"id": message.channel}, function(error, pub) {
            if (!utils.isEmpty(pub)) fulfill();
            else reject();
        });
    });
}

module.exports = function(controller, limiter) {
	controller.logger.info("broadcast skill");
    broadcast.initialize(controller, limiter)

	if (botResponse.loadFiles() == true) controller.log.info('Done. Loaded all responses.');

    //EXPORT
    controller.hears(['^\/export'], 'direct_mention', function (bot, message) {
        controller.logger.info(message.channel + ": /export");
        isPublisher(message, controller.storage).then(function() {
            sparkUtils.isMessageFromModerator(message).then(function(moderator) {
                if (moderator) broadcast.exportStorage(bot, message);
            });
        }).catch(function(){
            controller.logger.error(message.channel + ": /export: This space is not initalized. If you want my annoucements, message me directly.")
            bot.reply(message, "This space is not initalized. If you want my annoucements, message me directly.")
        });
    });

    //IMPORT
    controller.hears(['^\/import'], 'direct_mention', function (bot, message) {
        controller.logger.info(message.channel + ": /import");
        isPublisher(message, controller.storage).then(function() {
            sparkUtils.isMessageFromModerator(message).then(function(moderator) {
                if (moderator) broadcast.importStorage(bot, message);
            });
        }).catch(function(){
            controller.logger.error(message.channel + ": /import: This space is not initalized. If you want my annoucements, message me directly.")
            bot.reply(message, "This space is not initalized. If you want my annoucements, message me directly.")
        });
    });

	//PUBLISH
	controller.hears(['^\/publish\/all'], 'direct_mention', function (bot, message) {
        controller.logger.info(message.channel + ": /publish/all");
        console.log("/publish/all")
        isPublisher(message, controller.storage).then(function() {
    		sparkUtils.isMessageFromModerator(message).then(function(moderator) {
    			if (moderator) broadcast.publish(bot, message, 0, false);
    		});
        }).catch(function(){
            controller.logger.error(message.channel + ": /publish: This space is not initalized. If you want my annoucements, message me directly.")
            bot.reply(message, "This space is not initalized. If you want my annoucements, message me directly.")
        });
	});

    //PUBLISH INTERNAL
    controller.hears(['^\/publish\/internal'], 'direct_mention', function (bot, message) {
        controller.logger.info(message.channel + ": /publish/internal");
        console.log("/publish/internal")
        isPublisher(message, controller.storage).then(function() {
            sparkUtils.isMessageFromModerator(message).then(function(moderator) {
                if (moderator) broadcast.publish(bot, message, 1, false);
            });
        }).catch(function(){
            controller.logger.error(message.channel + ": /publish: This space is not initalized. If you want my annoucements, message me directly.")
            bot.reply(message, "This space is not initalized. If you want my annoucements, message me directly.")
        });
    });

    //PUBLISH EXTERNAL
    controller.hears(['^\/publish\/external'], 'direct_mention', function (bot, message) {
        controller.logger.info(message.channel + ": /publish/external");
        console.log("/publish/external")
        isPublisher(message, controller.storage).then(function() {
            sparkUtils.isMessageFromModerator(message).then(function(moderator) {
                if (moderator) broadcast.publish(bot, message, 2, false);
            });
        }).catch(function(){
            controller.logger.error(message.channel + ": /publish: This space is not initalized. If you want my annoucements, message me directly.")
            bot.reply(message, "This space is not initalized. If you want my annoucements, message me directly.")
        });
    });

	//KILL
	controller.hears(['^\/kill'], 'direct_mention', function (bot, message) {
        controller.logger.info(message.channel + ": /kill");
        isPublisher(message, controller.storage).then(function() {
    		sparkUtils.isMessageFromModerator(message).then(function(moderator) {
    			if (moderator) broadcast.kill(bot, message);
    		});
        }).catch(function(){
            controller.logger.error(message.channel + ": /kill: This space is not initalized. If you want my annoucements, message me directly.")
            bot.reply(message, "This space is not initalized. If you want my annoucements, message me directly.")
        });
	});

	//LIST
	controller.hears(['^\/list'], 'direct_mention', function (bot, message) {
        controller.logger.info(message.channel + ": /list");
        isPublisher(message, controller.storage).then(function() {
    		console.log("list command: " + message);
    		broadcast.list(bot, message);
        }).catch(function(){
            controller.logger.error(message.channel + ": /list: This space is not initalized. If you want my annoucements, message me directly.")
            bot.reply(message, "This space is not initalized. If you want my annoucements, message me directly.")
        });
	});

	//SUBSCRIBE
	controller.hears(['^\/subscribe'], 'direct_mention', function (bot, message) {
        controller.logger.info(message.channel + ": /subscribe");
        isPublisher(message, controller.storage).then(function() {
            controller.logger.info(message.channel + ": /subscribe: Message from publisher space");
    		sparkUtils.isMessageFromModerator(message).then(function(moderator) {
    			if (moderator) {
                    controller.logger.info(message.channel + ": /subscribe: Message from moderator");
                    broadcast.subscribe(bot, message);
                }
    		});
        }).catch(function(){
            controller.logger.error(message.channel + ": /subscribe: This space is not initalized. If you want my annoucements, message me directly.")
            bot.reply(message, "This space is not initalized. If you want my annoucements, message me directly.")
        });
	});

	//UNSUBSCRIBE
	controller.hears(['^\/unsubscribe'], 'direct_mention', function (bot, message) {
        controller.logger.info(message.channel + ": /unsubscribe");
        isPublisher(message, controller.storage).then(function() {
    		sparkUtils.isMessageFromModerator(message).then(function(moderator) {
    			if (moderator) broadcast.unsubscribe(bot, message);
    		});
        }).catch(function(){
            controller.logger.error(message.channel + ": /unsubscribe: This space is not initalized. If you want my annoucements, message me directly.")
            bot.reply(message, "This space is not initalized. If you want my annoucements, message me directly.")
        });
	});

	//STATS
	controller.hears(['^\/stats'], 'direct_mention', function (bot, message) {
        controller.logger.info(message.channel + ": /stats");
        isPublisher(message, controller.storage).then(function() {
    		broadcast.stats(bot, message);
        }).catch(function(){
            controller.logger.error(message.channel + ": /stats: This space is not initalized. If you want my annoucements, message me directly.")
            bot.reply(message, "This space is not initalized. If you want my annoucements, message me directly.")
        });
	});

	//INIT
	controller.hears(['^\/setup'], 'direct_mention', function (bot, message) {
        controller.logger.info(message.channel + ": /setup");
        if (process.env.bot_admin && (process.env.bot_admin.toLowerCase().indexOf(message.user.trim().toLowerCase()) > -1)) {
            sparkUtils.isSpaceLocked(message).then(function(response) {
                if (response == true)
                    broadcast.init(bot, message);
                else
                    bot.reply(message, 'Please lock the space and assign moderators (publishers) before proceeding with setup.');
            });
        } else
            bot.reply(message, 'Sorry, ask an adminstrator to issue the setup command, this space needs to be locked and all publishers have to be assigned moderator privileges.');
	});

	//LOAD RESPONSES
	controller.hears(['^\/loadResponses'], 'direct_mention', function (bot, message) {
        controller.logger.info(message.channel + ": /loadResponses");
        isPublisher(message, controller.storage).then(function() {
    		sparkUtils.isMessageFromModerator(message).then(function(moderator) {
    			if (moderator) broadcast.loadResponse(bot, message);
    		});
        }).catch(function(){
            controller.logger.error(message.channel + ": /loadResponses: This space is not initalized. If you want my annoucements, message me directly.")
            bot.reply(message, "This space is not initalized. If you want my annoucements, message me directly.")
        });
	});

	//TEST
	controller.hears(['^\/test'], 'direct_mention', function (bot, message) {
        controller.logger.info(message.channel + ": /test");
        isPublisher(message, controller.storage).then(function() {
            sparkUtils.isMessageFromModerator(message).then(function(moderator) {
                controller.logger.info("Test request from moderator: " + moderator);
    		    if (moderator) broadcast.publish(bot, message, 1, true);
            });
        }).catch(function(){
            controller.logger.error(message.channel + ": /test: This space is not initalized. If you want my annoucements, message me directly.")
            bot.reply(message, "This space is not initalized. If you want my annoucements, message me directly.")
        });
	});
    
	//TEST
	controller.hears(['^\/help'], 'direct_mention', function (bot, message) {
        controller.logger.info(message.channel + ": /help");
        isPublisher(message, controller.storage).then(function() {
            var text = "You can use the following commands:";
            sparkUtils.isMessageFromModerator(message).then(function(moderator) {
                if (moderator) {
                    text += "\n\n>`/test <annoucement>` Tests publish logic and displays how the message will appear if published.";
                    text += "\n\n>`/publish/all <annoucement>` Publish announcements to subscribed users.";
                    text += "\n\n>`/publish/internal <annoucement>` Publish announcements to subscribed internal users.";
                    text += "\n\n>`/publish/external <annoucement>` Publish announcements to subscribed external users.";
        		    text += "\n\n>`/kill/<identifier>` Kills ongoing publish and deletes already sent messages.";
            		text += "\n\n>`/subscribe email@domain.com next.email@another.domain` Subscribes the specified users for future announcements.";
                    text += "\n\n>`/subscribe <file_attachment>` Subscribes the specified users from the attached file for future announcements.";
            		text += "\n\n>`/unsubscribe email@domain.com next.email@another.domain` Unsubscribes the specified users from getting future announcements.";
                    text += "\n\n>`/export` Exports the subscriber and notifications for this space.";
                }
                text += "\n\n>`/stats [part_or_full@email.domain]` Provides usage statistics.";
                bot.reply(message, text);
            });
        }).catch(function(){
            controller.logger.error(message.channel + ": /help: This space is not initalized. If you want my annoucements, message me directly.")
            bot.reply(message, "This space is not initalized. If you want my annoucements, message me directly.")
        });
	});
};
