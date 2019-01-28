# Broadcast Bot for Cisco Spark

This repo contains everything you need to get started building a broadcast bot for Cisco Spark. It is built over the Botkit platform and also leverages the Cisco Spark Javascript SDK. This is designed to ease the process of designing and running your own broadcast bot. 

For those who are not familiar with bot, Bots are applications that can send and receive messages, and in many cases, appear alongside their human counterparts as users.

Some bots talk like people, others silently work in the background, while others present interfaces much like modern mobile applications.

Every organization has a need to reach out to a large user base individually to convey some message. Our goal here is to help you replicate and enhance you own broadcast bot that will be simple to use and open to extend new features!


### Getting Started

There are a few steps to get started on working on a Broadcast Bot:

#### Installation

Clone this repository:

`git clone https://github.com/2Koush/spark-broadcast.git`

Install dependencies:

```
cd spark-broadcast
npm install
```

Update the `.env` file with your bot details.

#### Dockerize: 

This kit includes a Dockerfile. If you have docker installed, and want to create a docker image execute:

```
docker build -t <tagname>
```

#### Execute: 

Launch your bot application by typing:

`node .`

### Watson Conversation

For this to kit to work, we need the Watson connversation working. Also, when updating the .env you would have been asked for your IBM Watson Conversation service details. Refer to the attached `watson.json` file and use it as a template for all requierd intents and entities. You can upload this json to your Watson workspace to easily get started.

### Extend This Starter Kit

This kit is designed to provide developers a robust starting point customizing and deploying your own broadcast bot. Included in the code are a set of bot "skills" that illustrate various aspects required to publish messages to a large base of users.

Feel free to enhnce the code to add more capabilities and features to this bot.


###  Need more help?

# About 
