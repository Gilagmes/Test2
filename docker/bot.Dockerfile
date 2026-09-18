FROM node:20-alpine AS bot

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY bot ./bot

ENV NODE_ENV=production

CMD ["node", "bot/bot.js"]
