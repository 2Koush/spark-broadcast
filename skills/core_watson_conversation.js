var botResponse = require('../load-responses');
var broadcast = require('../spark-broadcast'); 

module.exports = function(controller, limiter) {
	console.log("conversations skill");

    var getSysNumberEntity = function(data) {
        var responses = process.env.bot_listAnnoucements;
        var entities = data.entities;
        if (entities) {
            for (i=0; i<entities.length; i++) {
                if (entities[i].entity == 'sys-number') {
                    responses = entities[i].value;
                    return responses;
                }
            }
        } else {
            return responses;
        }
    }

	//SMALL TALK
	controller.hears(['.*'], ['direct_message'], function(bot, message) {
        //console.log(message.watsonData);
        if (message.watsonData && message.watsonData.output && (message.watsonData.output !=undefined) &&
            (message.user.toLowerCase().indexOf("@sparkbot.io")==-1) &&
            (message.user.toLowerCase().indexOf("@webex.bot")==-1)) {
            if (message.watsonData.output.text[0].indexOf('subscribe') == -1) {
                //console.log("Checking if " + message.user + " is in IMDB"); 
                broadcast.userExists(message.user).then(function(exists){
                    console.log(exists);
                    if (exists == -1) {
                        message.watsonData.output.text[0] = "";
                        controller.log.info("Calling automatic userSubscribe for %s and adding to IMDB", message.user);
                        broadcast.userSubscribe(bot, message);
                        var reply = botResponse.getResponse('welcome');
                        reply += '<br><br>';
                        controller.log.info(reply);
                        if ((reply != null) && (reply.trim().length > 0))
                            bot.reply(message, reply);
                    }
                });
            }

            controller.log.info("%s: %s", message.user, message.watsonData.output.text[0]);
            //Add business logic for some responses
            switch (message.watsonData.output.text[0]) {
                case 'subscribe':
                    controller.log.info('watson-subscribe');
                    broadcast.userSubscribe(bot, message);
                    break;
                case 'unsubscribe--yes':
                    controller.log.info('watson-unsubscribe--yes');
                    broadcast.userUnsubscribe(bot, message);
                    break;
                case 'status':
                    controller.log.info('watson-status');
                    broadcast.subscription_status(bot, message);
                    break;
                case 'list--yes':
                    controller.log.info('watson-list--yes');
                    var numListing = getSysNumberEntity(message.watsonData);
                    controller.log.info("numListing: %s", numListing)
                    //console.log(numListing);
                    broadcast.list(bot, message, true, numListing);
                    break;
                case 'bot_creator--yes':
                    controller.log.info('bot_creator--yes');
                    broadcast.addToBotCreatorSpace(bot, message);
                    break;
            }
            
            var reply = botResponse.getResponse(message.watsonData.output.text[0]);

            if ((reply != null)
                && (reply.trim().length > 0)) {
                //console.log(reply);
                bot.reply(message, reply);
            }
        }
	});
};
