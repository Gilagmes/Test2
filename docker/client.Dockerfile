FROM node:20-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY index.html ./index.html
COPY tsconfig.json ./tsconfig.json
COPY vite.config.ts ./vite.config.ts
COPY public ./public
COPY src ./src

# Client uses relative /api by default, so the same domain can serve app + API.
RUN npm run build

FROM nginx:1.27-alpine AS client

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
