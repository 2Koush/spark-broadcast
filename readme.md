# Broadcast Bot for Cisco Spark

This repo contains everything you need to get started building a broadcast bot for Cisco Spark. It is built over the Botkit platform and also leverages the Cisco Spark Javascript SDK. This is designed to ease the process of designing and running your own broadcast bot. 

For those who are not familiar with bot, Bots are applications that can send and receive messages, and in many cases, appear alongside their human counterparts as users.

Some bots talk like people, others silently work in the background, while others present interfaces much like modern mobile applications.

Every organization has a need to reach out to a large user base individually to convey some message. Our goal here is to help you replicate and enhance you own broadcast bot that will be simple to use and open to extend new features!


### Getting Started

There are a few steps to get started on working on a Broadcast Bot:

#### Installation

Clone this repository:

`git clone https://github.com/howdyai/botkit-starter-ciscospark.git`

Install dependencies:

```
cd broadcast-ciscospark
npm install
```

#### Set up your Cisco Spark Application 
Once you have setup your Botkit developer enviroment, the next thing you will want to do is set up a new Cisco Spark application via the [Cisco Spark developer portal](https://developer.ciscospark.com/). This is a multi-step process, but only takes a few minutes. 

[Read this step-by-step guide](https://github.com/howdyai/botkit/blob/master/docs/provisioning/cisco-spark.md) to make sure everything is set up. 

Next, get a Botkit Studio token [from your Botkit developer account](https://studio.botkit.ai/) if you have decided to use Studio. 

Update the `.env` file with your newly acquired tokens.

Launch your bot application by typing:

`node .`

Cisco Spark requires your application be available at an SSL-enabled endpoint. To expose an endpoint during development, we recommend using [localtunnel.me](http://localtunnel.me) or [ngrok](http://ngrok.io), either of which can be used to temporarily expose your bot to the internet. Once stable and published to the real internet, use nginx or another web server to provide an SSL-powered front end to your bot application. 

Now comes the fun part of [making your bot!](https://github.com/howdyai/botkit/blob/master/docs/readme.md#basic-usage)


### Extend This Starter Kit

This kit is designed to provide developers a robust starting point customizing and deploying your own broadcast bot. Included in the code are a set of bot "skills" that illustrate various aspects required to publish messages to a large base of users.

Feel free to enhnce the code to add more capabilities and features to this bot.

### Customize Storage

###  Need more help?

# About 
