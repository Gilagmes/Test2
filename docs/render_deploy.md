# Render deploy для Shonen Rift public preview

Эта инструкция поднимает игру на Render как **один Web Service**:

```text
https://your-render-service.onrender.com/       -> игра / MOBA preview
https://your-render-service.onrender.com/api/*  -> API
https://your-render-service.onrender.com/health -> health check
```

Такую ссылку можно открыть с телефона в обычном браузере. Для Telegram Mini App позже эту же ссылку можно указать в BotFather.

---

## Что уже подготовлено

В проекте есть:

```text
render.yaml
.node-version
package.json scripts
server/app.js static dist serving
```

`render.yaml` настроен как быстрый public preview:

- Node `20.x`;
- build: `npm install --include=dev && npm run build:web`;
- start: `npm start`;
- health check: `/health`;
- `SERVE_CLIENT=true`;
- `STORAGE_DRIVER=json`;
- `DEV_AUTH=true`, чтобы preview работал в браузере без Telegram auth.

Важно: `STORAGE_DRIVER=json` на Render подходит для демо, но filesystem у обычного Render web service может быть ephemeral. Значит прогресс может сбрасываться при redeploy/restart. Для production нужно подключить PostgreSQL и `STORAGE_DRIVER=prisma`.

---

## Шаг 1. Залить проект в GitHub

В локальном проекте:

```bash
cd telegram-moba-prototype
git init
git add .
git commit -m "Prepare Render public preview"
git branch -M main
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

Проверьте, что в GitHub **не попали секреты**. Файл `.gitignore` уже исключает:

```text
.env
.env.production
node_modules/
dist/
server/data/dev-db.json
```

---

## Шаг 2. Создать сервис на Render через Blueprint

1. Откройте Render Dashboard.
2. Нажмите **New +**.
3. Выберите **Blueprint**.
4. Подключите GitHub repository.
5. Render найдёт `render.yaml`.
6. Нажмите **Apply** / **Create Blueprint**.

Render создаст Web Service `shonen-rift-public-preview`.

---

## Шаг 3. Дождаться build/deploy

В логах должны пройти команды:

```bash
npm install --include=dev
npm run build:web
npm start
```

Успешный runtime log будет похож на:

```text
Server listening at http://0.0.0.0:<PORT>
```

Не указывайте фиксированный `API_PORT` на Render. Render сам передаёт переменную `PORT`, а сервер её использует.

---

## Шаг 4. Открыть публичную ссылку

После deploy Render даст URL вида:

```text
https://shonen-rift-public-preview.onrender.com
```

Откройте его на телефоне. Первым экраном должен появиться cinematic MOBA preview.

Проверьте:

```text
/health
/api/leaderboard?limit=1
```

---

## Шаг 5. Проверить deploy из терминала

```bash
scripts/deploy-check.sh https://shonen-rift-public-preview.onrender.com
```

Если проверяете с другого компьютера, можно выполнить те же запросы вручную:

```bash
curl https://shonen-rift-public-preview.onrender.com/health
curl https://shonen-rift-public-preview.onrender.com/api/leaderboard?limit=1
```

---

## Шаг 6. Проверить игру на телефоне

Откройте ссылку и пройдите:

1. preview screen;
2. меню;
3. выбор героя;
4. матч;
5. обучение;
6. магазин;
7. профиль;
8. daily;
9. leaderboard.

Подробный checklist:

```text
docs/mobile_playtest.md
```

---

## Если нужен не demo, а production-like persistence

Создайте Render PostgreSQL database и задайте env:

```env
STORAGE_DRIVER=prisma
DATABASE_URL=<Render Internal Database URL или External Database URL>
DEV_AUTH=false
BOT_TOKEN=<real BotFather token>
WEBAPP_URL=https://your-render-service.onrender.com
PUBLIC_WEBAPP_URL=https://your-render-service.onrender.com
CORS_ORIGIN=https://your-render-service.onrender.com
```

И включите strict validation:

```env
MATCH_EVENT_LOG_REQUIRED=true
MATCH_ACTION_STREAM_REQUIRED=true
MATCH_AUTHORITATIVE_REPLAY_ENABLED=true
MATCH_AUTHORITATIVE_REPLAY_STRICT=true
MATCH_AUTHORITATIVE_REPLAY_SAVE=true
MATCH_CLIENT_SIM_HASH_REQUIRED=true
MATCH_REPLAY_SECRET=<64+ random chars>
```

Для миграций PostgreSQL на Render можно использовать один из вариантов:

### Вариант A — manual shell/job

Выполнить перед запуском или через Render shell:

```bash
npm run db:deploy
```

### Вариант B — добавить миграцию в build command

Если база доступна на build stage:

```bash
npm install --include=dev && npm run build:web && npm run db:deploy
```

Для первого production preview лучше начать с JSON mode, убедиться что ссылка и игра работают, а затем переключать на PostgreSQL.

---

## Telegram Mini App через Render URL

Когда ссылка работает:

1. Откройте BotFather.
2. `/mybots`.
3. Выберите вашего бота.
4. **Bot Settings** → **Menu Button** или Web App settings.
5. Укажите Render URL:

```text
https://shonen-rift-public-preview.onrender.com
```

В env бота:

```env
BOT_TOKEN=<real token>
WEBAPP_URL=https://shonen-rift-public-preview.onrender.com
PUBLIC_WEBAPP_URL=https://shonen-rift-public-preview.onrender.com
API_URL=https://shonen-rift-public-preview.onrender.com
DEV_AUTH=false
```

Если бот запускается отдельным Render service, используйте тот же API URL.

---

## Частые ошибки

### Build падает: `tsc: not found` или `prisma: not found`

Убедитесь, что build command содержит:

```bash
npm install --include=dev && npm run build:web
```

### Игра открывается, но API offline

Проверьте:

```text
https://your-service.onrender.com/health
```

Если `/health` работает, но игра всё равно показывает offline, обновите страницу и проверьте browser console. Клиент должен обращаться к same-origin `/api/*`.

### `Telegram auth failed`

Для browser preview должно быть:

```env
DEV_AUTH=true
```

Для настоящего Telegram Mini App:

```env
DEV_AUTH=false
BOT_TOKEN=<real token>
```

### Данные сбрасываются

Это ожидаемо в JSON preview mode на ephemeral filesystem. Для постоянных аккаунтов подключите PostgreSQL + Prisma.

---

## Текущий рекомендуемый Render preview env

```env
NODE_ENV=production
API_HOST=0.0.0.0
SERVE_CLIENT=true
CLIENT_DIST_DIR=dist
STORAGE_DRIVER=json
DEV_AUTH=true
CORS_ORIGIN=true
MATCH_REPLAY_SECRET=<auto-generated или 64+ chars>
MATCH_AUTHORITATIVE_REPLAY_ENABLED=true
MATCH_AUTHORITATIVE_REPLAY_STRICT=false
MATCH_AUTHORITATIVE_REPLAY_SAVE=false
MATCH_CLIENT_SIM_HASH_REQUIRED=false
```
