FROM library/node:6.11.3

COPY . /app

RUN cd /app \
  && npm install --production

WORKDIR /app

CMD ["node", "bot.js"]
