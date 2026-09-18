# Production deployment guide: Telegram Mini App + Bot

Документ описывает запуск **Shonen Rift: Telegram Arena** на VPS с Docker Compose, PostgreSQL, Prisma, HTTPS и Telegram BotFather.

---

## 0. Что входит в production deployment

Production stack:

```text
Telegram User
    │
    ▼
https://your-domain.com
    │
    ▼
Caddy HTTPS reverse proxy :443
    │
    ▼
Nginx static web container
    ├── serves Mini App static files
    ├── /assets/*
    ├── /index.html
    ├── /health ───────► API container
    └── /api/* ────────► API container
                              │
                              ▼
                         PostgreSQL

Telegram Bot container ───────► API container over Docker network
```

Почему так:

- Telegram Mini App должен открываться по публичному **HTTPS** URL.
- Клиент вызывает API через относительный путь `/api/*`, то есть браузер не обращается к `localhost`.
- Caddy автоматически получает и обновляет TLS-сертификаты.
- Nginx отдаёт статический клиент и проксирует `/api` во внутренний API.
- API работает в `STORAGE_DRIVER=prisma` и пишет данные в PostgreSQL.
- Bot работает отдельным контейнером и общается с API по `http://api:8787` внутри Docker-сети.

---

## 1. Требования к серверу

Минимально для MVP:

- Ubuntu 22.04/24.04 VPS.
- 2 vCPU.
- 2–4 GB RAM.
- 20+ GB SSD.
- Домен, например `game.example.com`.
- Открытые порты:
  - `80/tcp`
  - `443/tcp`

Рекомендуется:

- включить firewall;
- настроить swap 1–2 GB для маленьких VPS;
- делать регулярные backup PostgreSQL.

---

## 2. DNS

Создайте DNS A-record:

```text
game.example.com  A  YOUR_VPS_IPV4
```

Если есть IPv6:

```text
game.example.com  AAAA  YOUR_VPS_IPV6
```

Перед запуском Caddy убедитесь, что DNS уже резолвится на VPS:

```bash
dig game.example.com
```

---

## 3. Установка Docker на VPS

На Ubuntu:

```bash
sudo apt update
sudo apt install -y ca-certificates curl gnupg git
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

Проверка:

```bash
docker --version
docker compose version
```

Опционально разрешить текущему пользователю запускать Docker без sudo:

```bash
sudo usermod -aG docker $USER
newgrp docker
```

---

## 4. Подготовка проекта

На VPS:

```bash
git clone <your-repo-url> shonen-rift
cd shonen-rift
```

Если репозиторий пока не в git — скопируйте папку `telegram-moba-prototype` на сервер любым способом:

```bash
scp -r telegram-moba-prototype user@YOUR_VPS_IP:/home/user/shonen-rift
```

---

## 5. Production environment

Скопируйте template:

```bash
cp .env.production.example .env.production
```

Откройте файл:

```bash
nano .env.production
```

Пример:

```env
NODE_ENV=production
PUBLIC_DOMAIN=game.example.com
WEBAPP_URL=https://game.example.com
BOT_TOKEN=123456789:real_token_from_BotFather
BOT_API_SECRET=use_a_long_random_secret_here
DEV_AUTH=false
STORAGE_DRIVER=prisma
POSTGRES_DB=shonen_rift
POSTGRES_USER=shonen
POSTGRES_PASSWORD=very_strong_db_password
DATABASE_URL=postgresql://shonen:very_strong_db_password@postgres:5432/shonen_rift?schema=public
API_URL=http://api:8787
CORS_ORIGIN=https://game.example.com

MATCH_EVENT_LOG_REQUIRED=true
MATCH_ACTION_STREAM_REQUIRED=true
MATCH_REPLAY_SECRET=replace_with_64_random_chars
MATCH_AUTHORITATIVE_REPLAY_ENABLED=true
MATCH_AUTHORITATIVE_REPLAY_STRICT=true
MATCH_AUTHORITATIVE_REPLAY_SAVE=true
MATCH_CLIENT_SIM_HASH_REQUIRED=true
```

Создать секрет можно так:

```bash
openssl rand -hex 32
```

Важно:

- `PUBLIC_DOMAIN` должен быть доменом без `https://`.
- `WEBAPP_URL` должен быть полным HTTPS URL.
- `DEV_AUTH=false` обязательно для production.
- `DATABASE_URL` внутри Docker должен указывать на хост `postgres`, а не `localhost`.
- `MATCH_REPLAY_SECRET` должен быть длинным случайным секретом; можно использовать тот же способ `openssl rand -hex 32`, но лучше отдельное значение от `BOT_API_SECRET`.
- `MATCH_EVENT_LOG_REQUIRED=true` и `MATCH_ACTION_STREAM_REQUIRED=true` включают production-режим anti-cheat validation.
- `MATCH_AUTHORITATIVE_REPLAY_ENABLED=true` запускает shared deterministic simulation на сервере.
- Основной клиентский бой использует shared simulation; production template включает strict authoritative save.
- Если нужен canary/совместимость со старыми клиентами, временно поставьте `MATCH_AUTHORITATIVE_REPLAY_STRICT=false`, `MATCH_AUTHORITATIVE_REPLAY_SAVE=false`, `MATCH_CLIENT_SIM_HASH_REQUIRED=false`, затем верните strict после rollout.

---

## 6. Первый запуск

Команда:

```bash
npm run prod:up
```

Она эквивалентна:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

Что произойдёт:

1. Поднимется PostgreSQL.
2. Выполнится Prisma migration deploy.
3. Запустится API.
4. Соберётся и запустится static web client.
5. Запустится Telegram Bot.
6. Запустится Caddy и выпустит HTTPS-сертификат.

Посмотреть состояние:

```bash
npm run prod:ps
```

Логи:

```bash
npm run prod:logs
```

---

## 6.1 Проверка match validation на staging/production

После запуска API можно проверить защиту результата (`match-result-v5`: event-log + deterministic action replay):

```bash
API_URL=https://game.example.com scripts/smoke-validation.sh
```

Для production лучше запускать smoke-test на staging или на отдельном test-пользователе, потому что скрипт создаёт dev/test матч при включённом dev auth. В реальном production `DEV_AUTH=false`, поэтому smoke-test нужно адаптировать под валидный Telegram initData или запускать на staging.

Скрипт проверяет valid submit, duplicate `409`, hacked result `422`, tampered event-log `422`, deterministic replay cooldown tamper `422`, authoritative simulation shadow run, `clientSimulationMatched:true` и server-calculated result при заниженном клиентском gold.

Для production strict/save path дополнительно запускайте:

```bash
npm run smoke:strict-shared-sim
npm run smoke:shared-tutorial
```

Strict shared-sim smoke проверяет terminal `authoritative-sim-v1`, обязательный `clientSimulationMatched:true` и rejection для missing/tampered `actionStream.clientSimulation.stateHash`; tutorial smoke проверяет shared deterministic tutorial path для всех героев.

## 7. Проверка deployment

Проверить вручную:

```bash
curl https://game.example.com/health
curl https://game.example.com/api/leaderboard?limit=1
```

Или через готовый скрипт:

```bash
scripts/deploy-check.sh https://game.example.com
```

Ожидаемый `/health`:

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

## 8. Telegram BotFather setup

### 8.1 Создать бота

В Telegram откройте `@BotFather`:

```text
/newbot
```

Получите `BOT_TOKEN` и вставьте его в `.env.production`.

### 8.2 Указать команды бота

В `@BotFather`:

```text
/setcommands
```

Команды:

```text
start - открыть меню игры
play - запустить MOBA матч
tutorial - обучение
shop - магазин косметики
profile - профиль игрока
daily - ежедневная награда
leaderboard - рейтинг игроков
help - помощь и управление
```

### 8.3 Добавить кнопку Mini App в меню

В `@BotFather` используйте:

```text
/setmenubutton
```

Выберите бота и укажите:

```text
https://game.example.com
```

Если вы используете Telegram Mini App app-profile, создайте/настройте его через BotFather и используйте тот же URL.

### 8.4 Проверить запуск

1. Напишите боту `/start`.
2. Нажмите `🎮 Играть`.
3. Telegram должен открыть Mini App по `WEBAPP_URL`.
4. В главном меню игры должен появиться статус `API online · Telegram auth`.

---

## 9. Обновление production версии

На VPS:

```bash
git pull
npm run prod:up
```

Если менялась Prisma schema:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml run --rm migrate
npm run prod:up
```

---

## 10. Откат/остановка

Остановить контейнеры без удаления данных:

```bash
npm run prod:down
```

Удалить контейнеры и volumes — осторожно, это удалит PostgreSQL данные:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml down -v
```

---

## 11. Backup PostgreSQL

Создать backup:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml exec postgres \
  pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" > backup_$(date +%F).sql
```

Восстановить backup:

```bash
cat backup_YYYY-MM-DD.sql | docker compose --env-file .env.production -f docker-compose.prod.yml exec -T postgres \
  psql -U "$POSTGRES_USER" "$POSTGRES_DB"
```

На production лучше настроить cron backup и хранить копии вне VPS.

---

## 12. Security checklist

Перед запуском в Telegram:

- [ ] `DEV_AUTH=false`.
- [ ] `STORAGE_DRIVER=prisma`.
- [ ] Сильный `POSTGRES_PASSWORD`.
- [ ] Сильный `BOT_API_SECRET`.
- [ ] Домен открывается по HTTPS.
- [ ] `/health` показывает `driver=prisma`.
- [ ] `scripts/smoke-validation.sh` проходит на production/staging API.
- [ ] `CORS_ORIGIN` ограничен вашим доменом.
- [ ] Firewall открыт только на `22`, `80`, `443`.
- [ ] PostgreSQL не опубликован наружу.
- [ ] Настроены backup базы.
- [ ] Секреты не закоммичены в git.

---

## 13. Notes для масштабирования

Текущий bot использует long polling через `bot.start()`. Для MVP это нормально, но важно:

- не запускать несколько bot replicas одновременно;
- для горизонтального масштабирования позже перейти на Telegram webhook;
- API можно масштабировать отдельно, если добавить Redis/session storage;
- real-time PvP позже потребует WebSocket layer и sticky sessions или отдельный match server.
