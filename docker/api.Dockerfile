FROM node:20-alpine AS api

WORKDIR /app

# Prisma needs OpenSSL on Alpine.
RUN apk add --no-cache openssl

COPY package*.json ./
RUN npm ci

COPY prisma ./prisma
COPY server ./server

# Generate Prisma Client during image build. This does not connect to the DB.
RUN npm run db:generate

ENV NODE_ENV=production
ENV API_HOST=0.0.0.0
ENV API_PORT=8787
ENV STORAGE_DRIVER=prisma
ENV DEV_AUTH=false

EXPOSE 8787

CMD ["node", "server/app.js"]
