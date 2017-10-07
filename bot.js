/*~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
           ______     ______     ______   __  __     __     ______
          /\  == \   /\  __ \   /\__  _\ /\ \/ /    /\ \   /\__  _\
          \ \  __<   \ \ \/\ \  \/_/\ \/ \ \  _"-.  \ \ \  \/_/\ \/
           \ \_____\  \ \_____\    \ \_\  \ \_\ \_\  \ \_\    \ \_\
            \/_____/   \/_____/     \/_/   \/_/\/_/   \/_/     \/_/


This is a sample Cisco Spark bot built with Botkit.

# RUN THE BOT:
  Follow the instructions here to set up your Cisco Spark bot:
    -> https://developer.ciscospark.com/bots.html
  Run your bot from the command line:
    access_token=<MY BOT ACCESS TOKEN> public_address=<MY PUBLIC HTTPS URL> node bot.js



~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~*/
var env = require('node-env-file');
env(__dirname + '/.env');

console.log("bot.js");
var logPath = (process.env.bot_logPath != undefined)?process.env.bot_logPath:"./";
var fs = require('fs')
  , Log = require('log')
  , log = new Log('debug', fs.createWriteStream(logPath + '/log'));


if (!process.env.access_token) {
    console.log('Error: Specify a Cisco Spark access_token in environment.');
    usage_tip();
    process.exit(1);
}

if (!process.env.public_address) {
    console.log('Error: Specify an SSL-enabled URL as this bot\'s public_address in environment.');
    usage_tip();
    process.exit(1);
}

console.log("env check done");
var mps = (process.env.bot_messagesPerSecond != undefined)?process.env.bot_messagesPerSecond:5;
console.log("rate limit set");
log.info("Rate Limit set to %s messages per second.", mps)
var RateLimiter = require('limiter').RateLimiter;
var limiter = new RateLimiter(mps, 'second', true)
console.log("limiter initialized");

var Botkit = require('botkit'),
    mongoStorage = require('botkit-storage-mongo')({mongoUri: process.env.mongo_url, tables: [process.env.table_publishers, process.env.table_subscribers, process.env.table_notifications]});
var debug = require('debug')('botkit:main');

console.log("about to initialize controller");
// Create the Botkit controller, which controls all instances of the bot.
var controller = Botkit.sparkbot({
    // debug: true,
    // limit_to_domain: ['mycompany.com'],
    // limit_to_org: 'my_cisco_org_id',
    public_address: process.env.public_address,
    ciscospark_access_token: process.env.access_token,
    //studio_token: process.env.studio_token, // get one from studio.botkit.ai to enable content management, stats, message console and more
    secret: process.env.secret, // this is an RECOMMENDED but optional setting that enables validation of incoming webhooks
    webhook_name: 'Cisco Spark bot created with Botkit, override me before going to production',
    storage: mongoStorage,
    //studio_command_uri: process.env.studio_command_uri,
    logger: log
});

console.log("controller initialized");

if (process.env.watson_username && process.env.watson_password &&
    process.env.watson_workspace_id && process.env.watson_minimum_confidence) {
    var watsonMiddleware = require('botkit-middleware-watson')({
      username: process.env.watson_username,
      password: process.env.watson_password,
      workspace_id: process.env.watson_workspace_id,
      version_date: '2016-09-20',
      minimum_confidence: process.env.watson_minimum_confidence, // (Optional) Default is 0.75
    });

    controller.middleware.receive.use(watsonMiddleware.receive);
    //controller.startRTM();

    console.log ("Configured Watson Middleware");
    log.info("Configured Watson Middleware")
} else {
    log.info("Watson Middleware was not configured")
    console.log("watson middleware failed");
}

// Set up an Express-powered webserver to expose oauth and webhook endpoints
var webserver = require(__dirname + '/components/express_webserver.js')(controller);

// Tell Cisco Spark to start sending events to this application
require(__dirname + '/components/subscribe_events.js')(controller);

// Enable Dashbot.io plugin
require(__dirname + '/components/plugin_dashbot.js')(controller);


var normalizedPath = require("path").join(__dirname, "skills");
fs.readdirSync(normalizedPath).forEach(function(file) {
    console.log(file);
    if (!file.startsWith("."))
        require(__dirname + '/skills/' + file)(controller, limiter);
});


function usage_tip() {
    console.log('~~~~~~~~~~');
    console.log('Botkit Studio Starter Kit');
    console.log('Execute your bot application like this:');
    console.log('access_token=<MY ACCESS TOKEN> public_address=<https://mybotapp/> node bot.js');
    console.log('Get Cisco Spark token here: https://developer.ciscospark.com/apps.html')
    console.log('Get a Botkit Studio token here: https://studio.botkit.ai/')
    console.log('~~~~~~~~~~');
}
