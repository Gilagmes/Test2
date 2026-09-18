# PostgreSQL + Prisma guide

Этот проект теперь поддерживает два storage-driver режима:

1. **JSON fallback** — быстрый локальный запуск без базы.
2. **Prisma/PostgreSQL** — production-ready persistence layer.

По умолчанию используется JSON, чтобы прототип продолжал запускаться без Docker и PostgreSQL.

---

## 1. Быстрый локальный запуск с JSON

```bash
npm install
npm run dev:server
npm run dev:client
```

API health покажет:

```json
{
  "storage": {
    "driver": "json",
    "requestedDriver": "json"
  }
}
```

---

## 2. Запуск PostgreSQL через Docker Compose

```bash
npm run dev:postgres
```

Поднимается сервис:

```text
postgres://shonen:shonen_dev_password@localhost:5432/shonen_rift
```

Connection string:

```env
DATABASE_URL=postgresql://shonen:shonen_dev_password@localhost:5432/shonen_rift?schema=public
```

---

## 3. Подготовка Prisma

```bash
npm run db:generate
npm run db:validate
```

Применить уже созданную миграцию:

```bash
npm run db:deploy
```

Для разработки новой миграции:

```bash
npm run db:migrate
```

Открыть Prisma Studio:

```bash
npm run db:studio
```

---

## 4. Запуск API в Prisma mode

```bash
STORAGE_DRIVER=prisma npm run dev:server
```

или через готовый script:

```bash
npm run dev:server:prisma
```

Health-check:

```bash
curl http://localhost:8787/health
```

Ожидаемый ответ:

```json
{
  "ok": true,
  "service": "shonen-rift-api",
  "storage": {
    "driver": "prisma",
    "requestedDriver": "prisma"
  }
}
```

---

## 5. Production env пример

```env
NODE_ENV=production
STORAGE_DRIVER=prisma
DATABASE_URL=postgresql://user:password@db-host:5432/shonen_rift?schema=public
BOT_TOKEN=telegram_bot_token
WEBAPP_URL=https://game.example.com
API_URL=https://api.example.com
BOT_API_SECRET=strong_random_secret
DEV_AUTH=false
```

В production обязательно:

- `STORAGE_DRIVER=prisma`
- `DEV_AUTH=false`
- реальный `BOT_TOKEN`
- HTTPS для Mini App URL
- секретный `BOT_API_SECRET`

---

## 6. Модели базы данных

### User

Хранит Telegram-профиль и игровые агрегаты:

- `telegramId`
- `username`
- `firstName`
- `avatarUrl`
- `matches`, `wins`, `losses`
- `kills`, `deaths`, `gold`
- `rating`
- `soft`
- daily reward state
- tutorial completion state

### Session

Сессии Mini App после проверки Telegram `initData`.

### Match

Стартованные матчи:

- `heroId`
- `seed`
- `status`
- `startedAt`
- `finishedAt`

### MatchResult

Результаты матчей:

- victory/winner
- duration
- hero
- kills/deaths
- gold
- level

### SkinOwnership

Купленные косметические скины.

### SkinEquip

Экипированный скин по каждому герою.

---

## 7. Repository layer

Файл `server/db.js` теперь является фасадом:

```text
server/db.js
  ├─ repositories/jsonStore.js
  └─ repositories/prismaStore.js
```

Выбор driver:

```js
const requestedDriver = process.env.STORAGE_DRIVER || (process.env.DATABASE_URL ? 'prisma' : 'json');
```

Если указать `STORAGE_DRIVER=prisma`, API обязан стартовать через Prisma. Если Prisma недоступен — сервер упадёт с ошибкой, что правильно для production.

Если `STORAGE_DRIVER` не указан и Prisma недоступен, backend откатится на JSON fallback.

---

## 8. Smoke-test API в Prisma mode

```bash
TOKEN=$(curl -s -X POST http://localhost:8787/api/auth/telegram \
  -H 'content-type: application/json' \
  -d '{"initData":""}' \
  | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).token))")

MATCH=$(curl -s -X POST http://localhost:8787/api/matches/start \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"heroId":"kairo"}' \
  | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).match.id))")

curl -s -X POST "http://localhost:8787/api/matches/$MATCH/result" \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"victory":true,"winner":"blue","durationSec":222,"heroName":"Кайро","heroId":"kairo","kills":2,"deaths":0,"gold":600,"level":3}'

curl -s http://localhost:8787/api/leaderboard?limit=10
```

---

## 9. Что ещё нужно перед production

- Настроить managed PostgreSQL или VPS PostgreSQL.
- Включить регулярные backup базы.
- Добавить rate limiting на auth/match endpoints.
- Добавить server-side match result validation.
- Добавить audit log покупок/наград.
- Добавить миграционный pipeline в CI/CD.
