# Public preview deploy: одна публичная ссылка для игры и API

Этот путь нужен, чтобы игра открывалась **в обычном мобильном браузере** и в **Telegram Mini App**, а не только внутри Arena live preview.

Цель:

```text
https://your-public-domain.example/       -> собранный Vite/Phaser клиент
https://your-public-domain.example/api/*  -> Fastify API
https://your-public-domain.example/health -> health check
```

Клиент уже использует относительные `/api/*` запросы, поэтому на одном домене не нужен отдельный `VITE_API_BASE`.

---

## Вариант A — самый простой Node deploy на Render/Railway/Fly/VPS

Подходит для быстрого публичного preview.

В проект добавлены готовые manifests:

```text
render.yaml
railway.json
```

Для Render есть отдельный пошаговый гайд: [`docs/render_deploy.md`](render_deploy.md).

Если платформа читает manifest автоматически, достаточно запушить репозиторий и создать Web Service. Если настраиваете вручную, используйте команды ниже.

### Build command

```bash
npm install && npm run build:web
```

`build:web` делает:

```bash
npm run build
npm run db:generate
```

### Start command

```bash
npm start
```

`npm start` запускает:

```bash
SERVE_CLIENT=true node server/app.js
```

То есть один Fastify process отдаёт и API, и собранный клиент из `dist/`.

### Обязательные env-переменные для preview

Для быстрого preview без PostgreSQL можно начать с JSON storage:

```env
NODE_ENV=production
PORT=8787
API_HOST=0.0.0.0
SERVE_CLIENT=true
CLIENT_DIST_DIR=dist
STORAGE_DRIVER=json
DEV_AUTH=true
CORS_ORIGIN=true

MATCH_REPLAY_SECRET=replace_with_64_random_chars
MATCH_AUTHORITATIVE_REPLAY_ENABLED=true
MATCH_AUTHORITATIVE_REPLAY_STRICT=false
MATCH_AUTHORITATIVE_REPLAY_SAVE=false
MATCH_CLIENT_SIM_HASH_REQUIRED=false
```

Важно: `DEV_AUTH=true` удобно для публичной browser-preview ссылки, но для реального production/Telegram auth его нужно заменить на `DEV_AUTH=false` + настоящий `BOT_TOKEN`.

### Production-like env с PostgreSQL

Когда нужен настоящий persistence:

```env
NODE_ENV=production
PORT=8787
API_HOST=0.0.0.0
SERVE_CLIENT=true
CLIENT_DIST_DIR=dist

STORAGE_DRIVER=prisma
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DB?schema=public

BOT_TOKEN=123456789:real_botfather_token
WEBAPP_URL=https://your-public-domain.example
PUBLIC_WEBAPP_URL=https://your-public-domain.example
BOT_API_SECRET=replace_with_64_char_random_secret
DEV_AUTH=false
CORS_ORIGIN=https://your-public-domain.example

MATCH_EVENT_LOG_REQUIRED=true
MATCH_ACTION_STREAM_REQUIRED=true
MATCH_REPLAY_SECRET=replace_with_64_random_chars
MATCH_AUTHORITATIVE_REPLAY_ENABLED=true
MATCH_AUTHORITATIVE_REPLAY_STRICT=true
MATCH_AUTHORITATIVE_REPLAY_SAVE=true
MATCH_CLIENT_SIM_HASH_REQUIRED=true
```

Перед стартом production-like сервиса примените миграции:

```bash
npm run db:deploy
```

---

## Вариант B — VPS Docker Compose production stack

Этот вариант уже лежит в проекте:

```text
docker-compose.prod.yml
.env.production.example
docker/Caddyfile
docker/nginx.conf
```

Он использует:

- Caddy для HTTPS;
- Nginx для static client + `/api` proxy;
- отдельный API container;
- отдельный bot container;
- PostgreSQL.

Инструкция: [`docs/deployment_telegram.md`](deployment_telegram.md)

Для этого варианта `SERVE_CLIENT=false`, потому что static files отдаёт Nginx.

---

## Проверка публичного preview

После деплоя:

```bash
scripts/deploy-check.sh https://your-public-domain.example
```

Скрипт проверит:

1. HTML shell;
2. `/health`;
3. `/api/leaderboard`;
4. static asset `/assets/ui/title_bg.png`.

Для gameplay validation после запуска API:

```bash
BASE_URL=https://your-public-domain.example npm run smoke:validation
npm run smoke:strict-shared-sim
npm run smoke:shared-tutorial
```

`smoke:validation` по умолчанию смотрит на `http://localhost:8787`; если нужен удалённый URL, используйте переменную, поддерживаемую shell-скриптом:

```bash
API_URL=https://your-public-domain.example ./scripts/smoke-validation.sh
```

---

## Подключение к Telegram Mini App

В BotFather:

1. `/mybots`
2. выбрать бота;
3. **Bot Settings**;
4. **Menu Button** или **Web App**;
5. указать:

```text
https://your-public-domain.example
```

В env бота/API:

```env
WEBAPP_URL=https://your-public-domain.example
PUBLIC_WEBAPP_URL=https://your-public-domain.example
BOT_TOKEN=<real BotFather token>
API_URL=https://your-public-domain.example
DEV_AUTH=false
```

Для production stack bot container обычно ходит в API по внутреннему адресу:

```env
API_URL=http://api:8787
```

---

## Что именно добавлено для public preview

- `server/app.js` умеет отдавать `dist/`, если `SERVE_CLIENT=true`.
- `/api/*` остаётся API namespace.
- SPA fallback отдаёт `index.html` для client routes.
- `npm start` запускает single-domain public preview server.
- `npm run build:web` собирает клиент и Prisma Client.

---

## Рекомендуемый порядок

1. Быстро поднять Node deploy с `STORAGE_DRIVER=json` и `DEV_AUTH=true`, чтобы проверить ссылку на телефоне.
2. Пройти `docs/mobile_playtest.md`.
3. Подключить PostgreSQL и `STORAGE_DRIVER=prisma`.
4. Включить `DEV_AUTH=false` и настоящий `BOT_TOKEN`.
5. Подключить BotFather WebApp URL.
6. Включить strict validation flags из `.env.production.example`.
