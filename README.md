# Shonen Rift: Telegram Arena — playable Telegram MOBA prototype

Стартовый прототип Telegram Mini App MOBA в оригинальном shonen-action стиле.  
Персонажи, скины и визуал — оригинальные, без копирования существующих аниме/IP и без клонирования Jump MOBA.

## Что уже есть

### Клиент

- Vite + TypeScript + Phaser 3.
- Адаптация под Telegram Mini App WebView.
- Новый loading screen с прогресс-баром.
- Cinematic preview/showcase screen при запуске live demo: герои, mock-combat HUD, фичи и быстрые CTA.
- Главное меню с оригинальным key art фоном, портретами и glassmorphism-панелями.
- Экран профиля.
- Tutorial intro screen и guided tutorial-match.
- Магазин косметических скинов.
- Покупка и экипировка скинов.
- Улучшенный выбор героя с AI-сгенерированными оригинальными портретами.
- 3 оригинальных shonen-персонажа:
  - Кайро — огненный боец.
  - Рэйна — лунный ассасин.
  - Тэо — маг молнии.
- 6 косметических скинов:
  - Неоновое Пламя.
  - Солнечный Ронин.
  - Звёздный Падший Клинок.
  - Багровая Луна.
  - Синий Разряд.
  - Золотой Шторм.
- Скины меняют цветовую палитру героя, ауру и оружие в матче.
- Улучшенный HUD: портрет героя, команда/счёт/таймер, неоновые кнопки способностей.
- Улучшенная процедурная карта: руны на линии, кристаллы в лесу, energy rings и более выразительные базы.
- Улучшенный in-match персонаж: тень, плащ, волосы, шарф/оружие и аура вместо простого кружка.
- Пошаговое обучение: движение, атака, K/L навыки, ULT, башня, ядро.
- 3v3 арена: игрок + 2 союзных бота против 3 вражеских ботов.
- Миньоны, башни, ядра баз.
- Виртуальный джойстик для телефона.
- Управление клавиатурой для теста на ПК.
- Базовая атака, 2 способности и ультимейт.
- Cooldown-индикаторы.
- Победа/поражение и экран результата.
- Локальный fallback через `localStorage`, если API недоступен.

### Backend API

- Fastify API.
- Telegram Mini App auth через `initData`.
- Dev-auth fallback для локального запуска без реального бота.
- Профиль игрока.
- Стартовая тестовая валюта: **200 искр** для нового dev-профиля.
- Старт матча с server-side `matchId` и `seed`.
- Сохранение результата матча.
- Daily reward.
- Tutorial completion reward: 120 искр за первое прохождение.
- Leaderboard.
- Каталог скинов.
- Покупка скинов.
- Экипировка скинов.
- Dev JSON storage: `server/data/dev-db.json`.
- Production-ready storage: PostgreSQL + Prisma через `STORAGE_DRIVER=prisma`.
- Prisma schema и migration в `prisma/`.
- Production deployment через Docker Compose + Caddy HTTPS + Nginx reverse proxy.
- Server-side validation результатов матчей перед начислением рейтинга/валюты.
- Event-log replay validation: сервер сверяет итог с журналом событий боя.
- Shared deterministic gameplay loop: основной offline match и tutorial запускаются через `SharedSimScene`, где Phaser собирает input и рендерит snapshots, а весь combat state идёт из `shared/combatRules.js`.
- Mobile playtest polish для `SharedSimScene`: увеличенные skill buttons, cooldown overlay, joystick подсказка, hit/damage VFX, kill feed и objective banners из shared combat events.
- Authoritative simulation (`match-result-v5`): `shared/combatRules.js` моделирует bots/minions/projectiles/zones/HP/objectives по fixed ticks, клиент и сервер считают одинаковый stateHash, API возвращает `authoritativeResult` + `clientSimulationMatched`.

### Telegram Bot

- Бот на `grammy`.
- `/start` с кнопками Web App.
- `/play` — открыть игру.
- `/shop` — открыть магазин внутри Web App.
- `/tutorial` — открыть обучение внутри Web App.
- `/profile` — профиль игрока.
- `/daily` — daily-награда.
- `/leaderboard` — рейтинг.
- `/help` — управление.

## Production deployment

Добавлен готовый deployment-пакет:

```text
docker-compose.prod.yml
.env.production.example
render.yaml
railway.json
docker/api.Dockerfile
docker/bot.Dockerfile
docker/client.Dockerfile
docker/nginx.conf
docker/Caddyfile
scripts/deploy-check.sh
scripts/smoke-validation.sh
docs/deployment_telegram.md
docs/public_preview_deploy.md
```

Быстрый запуск на VPS после заполнения `.env.production`:

```bash
npm run prod:up
npm run prod:ps
scripts/deploy-check.sh https://your-domain.example
```

Полная инструкция по VPS, HTTPS и BotFather: [`docs/deployment_telegram.md`](docs/deployment_telegram.md)

Для быстрого публичного preview одной Node-службой без Nginx/Caddy: [`docs/public_preview_deploy.md`](docs/public_preview_deploy.md)

Render deploy пошагово: [`docs/render_deploy.md`](docs/render_deploy.md)

## Запуск локально

```bash
npm install
```

По умолчанию backend запускается в JSON fallback mode, чтобы не требовать PostgreSQL для быстрого теста. Для production/dev базы используйте Prisma mode — подробнее в `docs/postgres_prisma.md`.

### 1. Backend API

```bash
npm run dev:server
```


### 1a. Backend API через PostgreSQL + Prisma

```bash
npm run dev:postgres
npm run db:generate
npm run db:deploy
npm run dev:server:prisma
```

Connection string по умолчанию для Docker Compose:

```env
DATABASE_URL=postgresql://shonen:shonen_dev_password@localhost:5432/shonen_rift?schema=public
```

Полная инструкция: [`docs/postgres_prisma.md`](docs/postgres_prisma.md)

API стартует на:

```text
http://localhost:8787
```

Проверка:

```bash
curl http://localhost:8787/health
```

### 2. Client / Telegram Mini App shell

```bash
npm run dev:client
```

Клиент стартует на:

```text
http://localhost:5173
```

Vite настроен так, что запросы клиента на `/api/*` проксируются в backend API на `127.0.0.1:8787`. Это важно для Telegram/WebView: браузер не должен обращаться к `localhost` backend напрямую.

### 3. Telegram Bot

Скопируйте `.env.example` в `.env`:

```bash
cp .env.example .env
```

Заполните:

```env
BOT_TOKEN=token_from_BotFather
WEBAPP_URL=https://your-public-mini-app-url.example
API_URL=http://127.0.0.1:8787
BOT_API_SECRET=change_me
```

Запуск бота:

```bash
npm run dev:bot
```

Для реального Telegram Mini App нужен публичный HTTPS URL. Локальный `localhost` Telegram пользователю не подойдёт.

## Управление

### На телефоне

- Левая часть экрана — виртуальный джойстик.
- Правая часть экрана — кнопки атаки и способностей.

### На ПК

- `WASD` или стрелки — движение.
- `J` — базовая атака.
- `K` — первая способность.
- `L` — вторая способность.
- `Space` — ультимейт.

## Tutorial mode

В главном меню появилась кнопка **Обучение**. Режим запускает guided-match без опасных enemy bots:

1. игрок двигается к светящемуся маркеру;
2. атакует тренировочный манекен;
3. использует первый навык;
4. использует второй навык;
5. активирует ультимейт;
6. разрушает учебную башню;
7. разрушает красное ядро.

После первого прохождения backend сохраняет `tutorial.completed=true` и выдаёт **120 искр**. Повторять обучение можно без повторной награды.

## API endpoints

### Auth

```http
POST /api/auth/telegram
Content-Type: application/json

{
  "initData": "Telegram.WebApp.initData"
}
```

В production backend валидирует подпись Telegram через `BOT_TOKEN`. Локально при `DEV_AUTH=true` используется dev-пользователь.

### Profile

```http
GET /api/profile
Authorization: Bearer <session_token>
```

### Start match

```http
POST /api/matches/start
Authorization: Bearer <session_token>
Content-Type: application/json

{
  "heroId": "kairo"
}
```

### Submit match result

```http
POST /api/matches/:matchId/result
Authorization: Bearer <session_token>
Content-Type: application/json

{
  "victory": true,
  "winner": "blue",
  "durationSec": 321,
  "heroName": "Кайро",
  "heroId": "kairo",
  "kills": 3,
  "deaths": 1,
  "gold": 820,
  "level": 4,
  "eventLog": {
    "version": "client-event-log-v1",
    "matchId": "match_xxx",
    "heroId": "kairo",
    "seed": 123456,
    "startedAtClientMs": 1780000000000,
    "events": [],
    "summary": {
      "victory": true,
      "winner": "blue",
      "durationSec": 321,
      "kills": 3,
      "deaths": 1,
      "gold": 820,
      "level": 4,
      "towersDestroyed": 2,
      "coreDestroyed": true
    }
  },
  "actionStream": {
    "version": "client-action-stream-v1",
    "matchId": "match_xxx",
    "heroId": "kairo",
    "seed": 123456,
    "validationToken": "server_hmac_token",
    "tickRate": 2,
    "startedAtClientMs": 1780000000000,
    "actions": [],
    "summary": {
      "durationSec": 321,
      "lastX": 900,
      "lastY": 600,
      "moveSamples": 120,
      "attackCount": 8,
      "castCounts": { "primary": 3, "secondary": 2, "ultimate": 1 },
      "truncated": false
    },
    "clientSimulation": {
      "source": "authoritative-sim-v1",
      "stateHash": "fnv1a32:client_hash",
      "result": { "terminal": false, "victory": false, "winner": "red" }
    },
    "integrityHash": "fnv1a32:xxxxxxxx"
  }
}
```


Перед сохранением backend валидирует результат:

- матч существует;
- матч принадлежит текущему игроку;
- матч ещё не завершён;
- `heroId` совпадает с героем, выбранным на `/api/matches/start`;
- `winner` и `victory` согласованы;
- длительность не противоречит server clock;
- kills/deaths/gold/level не превышают MVP caps;
- если передан `eventLog`, backend проверяет version/matchId/heroId/seed, timestamps, `match_start`/`match_end`, kills/deaths/objectives/rewards/level и summary;
- если передан `actionStream`, backend проверяет version/matchId/heroId/seed, server-issued validation token, integrity hash, seq/timestamps, movement envelope, attack/cast cooldowns, ranges и action-derived budget;
- при валидном replay backend сохраняет `server-calculated-v1` result в local/shadow mode;
- `MATCH_AUTHORITATIVE_REPLAY_ENABLED=true` запускает full shared simulation и возвращает `authoritative-sim-v1` result/stateHash;
- клиент локально запускает `simulateCombat()` и отправляет `clientSimulation.stateHash`, сервер сверяет его со своим replay;
- production template включает strict authoritative save: `MATCH_EVENT_LOG_REQUIRED=true`, `MATCH_ACTION_STREAM_REQUIRED=true`, `MATCH_AUTHORITATIVE_REPLAY_STRICT=true`, `MATCH_AUTHORITATIVE_REPLAY_SAVE=true`, `MATCH_CLIENT_SIM_HASH_REQUIRED=true`.

Документация: [`docs/server_validation.md`](docs/server_validation.md) · [`docs/mobile_playtest.md`](docs/mobile_playtest.md)

### Daily reward

```http
POST /api/rewards/daily
Authorization: Bearer <session_token>
```

### Tutorial complete

```http
POST /api/tutorial/complete
Authorization: Bearer <session_token>
```

Выдаёт 120 искр только за первое прохождение обучения.

### Leaderboard

```http
GET /api/leaderboard?limit=10
```

### Shop: list skins

```http
GET /api/shop/skins
Authorization: Bearer <session_token>
```

### Shop: buy skin

```http
POST /api/shop/buy
Authorization: Bearer <session_token>
Content-Type: application/json

{
  "skinId": "kairo_neon_ember"
}
```

### Shop: equip skin

```http
POST /api/shop/equip
Authorization: Bearer <session_token>
Content-Type: application/json

{
  "heroId": "kairo",
  "skinId": "kairo_neon_ember"
}
```

Чтобы вернуть стандартный образ:

```json
{
  "heroId": "kairo",
  "skinId": null
}
```

## Структура

```text
telegram-moba-prototype/
  bot/
    bot.js                  # Telegram bot на grammy
  public/
    assets/
      portraits/             # оригинальные hero portraits
      ui/                    # title background / key art
  docker/
    api.Dockerfile          # API production image
    bot.Dockerfile          # Telegram Bot production image
    client.Dockerfile       # static Mini App image
    nginx.conf              # static hosting + /api proxy
    Caddyfile               # automatic HTTPS reverse proxy
  docs/
    postgres_prisma.md
    deployment_telegram.md
    public_preview_deploy.md
    server_validation.md
  prisma/
    schema.prisma           # PostgreSQL data model
    migrations/             # SQL migrations
  server/
    app.js                  # Fastify API
    catalogue.js            # каталог косметики
    db.js                   # storage facade: JSON or Prisma
    deterministicReplay.js  # validation token + action-stream deterministic replay checks
    repositories/
      jsonStore.js           # local fallback storage
      prismaStore.js         # PostgreSQL/Prisma storage
    telegramAuth.js         # проверка Telegram initData
    data/dev-db.json        # создаётся автоматически
  shared/
    combatRules.js          # shared deterministic simulation: bots/minions/projectiles/zones/HP/objectives
    combatRules.d.ts        # TypeScript declarations for client imports
  src/
    api.ts                  # клиентский API wrapper
    main.ts                 # игровая логика Phaser + UI scenes
    telegram.ts             # Telegram WebApp bootstrap
    style.css               # fullscreen/mobile стили
  .env.example
  .env.production.example
  docker-compose.yml        # local PostgreSQL compose
  docker-compose.prod.yml   # production stack
  scripts/deploy-check.sh
  scripts/smoke-validation.sh
  vite.config.ts            # proxy /api -> backend
```

## Проверенные команды

```bash
npm run build
node --check server/app.js
node --check server/db.js
node --check server/repositories/jsonStore.js
node --check server/repositories/prismaStore.js
node --check server/matchValidator.js
node --check server/catalogue.js
npm run db:validate
npm run db:generate
node --check bot/bot.js
```

Deployment config can be validated locally with syntax checks, but full Docker/Caddy/PostgreSQL test requires Docker on your VPS.

## Smoke-test server-side validation

```bash
npm run smoke:validation
npm run smoke:strict-shared-sim
npm run smoke:shared-tutorial
```

`smoke:validation` проверяет валидный submit с event-log + action-stream + authoritative simulation + `clientSimulationMatched:true`, duplicate `409`, hacked result `422`, tampered event-log `422`, cooldown tamper `422` и server-calculated gold при заниженном client gold.

`smoke:strict-shared-sim` проверяет production strict/save path, terminal authoritative result `authoritative-sim-v1`, обязательный `clientSimulationMatched:true` и rejection для missing/tampered `actionStream.clientSimulation.stateHash`.

`smoke:shared-tutorial` проверяет deterministic shared tutorial для Кайро/Рэйны/Тэо: dummy, skills, tower gate и core completion.

## Smoke-test магазина

```bash
TOKEN=$(curl -s -X POST http://localhost:8787/api/auth/telegram \
  -H 'content-type: application/json' \
  -d '{"initData":""}' | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).token))")

curl -s http://localhost:8787/api/shop/skins \
  -H "authorization: Bearer $TOKEN"

curl -s -X POST http://localhost:8787/api/shop/buy \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"skinId":"kairo_neon_ember"}'
```

## Важно по правам

Этот прототип специально использует оригинальных героев и оригинальные косметические образы. Если нужны реальные персонажи популярных аниме, потребуется официальная лицензия правообладателей.

## Последний visual/UI upgrade

Добавлены новые ассеты:

```text
public/assets/ui/title_bg.png
public/assets/portraits/kairo.png
public/assets/portraits/reyna.png
public/assets/portraits/teo.png
```

Эти изображения — оригинальные shonen-inspired ассеты без использования существующих аниме-персонажей. Они используются в loading screen, главном меню, выборе героя и HUD.

## Что делать дальше

1. Запустить production stack на VPS и подключить настоящий Telegram BotFather token.
2. Провести playtest обычного матча и tutorial в `SharedSimScene` по чеклисту [`docs/mobile_playtest.md`](docs/mobile_playtest.md): управление, читаемость HUD, VFX, длительность матчей.
3. Тонко настроить баланс героев/ботов под целевую длительность матча и желаемый winrate.
4. Добавить полноценные sprite-анимации персонажей и VFX atlas.
5. Добавить сезонный боевой пропуск и косметические награды.
