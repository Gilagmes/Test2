# Server-side validation, shared deterministic simulation и authoritative replay

Backend не доверяет результату матча, который приходит от клиента. Перед сохранением результата `/api/matches/:matchId/result` проходит через валидаторы:

```text
server/matchValidator.js
server/deterministicReplay.js
shared/combatRules.js
```

Текущая версия:

```text
match-result-v5
```

Главное изменение v5: `shared/combatRules.js` расширен до **deterministic combat simulation layer**. Сервер теперь умеет запускать tick-based simulation из `seed + actionStream` и возвращает `authoritativeResult` + `authoritativeStateHash`.

Дополнительно клиент теперь тоже запускает тот же `simulateCombat()` локально при завершении матча и отправляет `actionStream.clientSimulation.stateHash`. Сервер пересчитывает simulation у себя и возвращает `clientSimulationMatched:true/false`.

По умолчанию authoritative simulation работает в безопасном **shadow mode**:

```env
MATCH_AUTHORITATIVE_REPLAY_ENABLED=true
MATCH_AUTHORITATIVE_REPLAY_STRICT=false
MATCH_AUTHORITATIVE_REPLAY_SAVE=false
MATCH_CLIENT_SIM_HASH_REQUIRED=false
```

То есть сервер пересчитывает бой тем же module, что и основной клиентский `SharedSimScene`. Local `.env.example` остаётся shadow-friendly, а `.env.production.example` теперь включает strict authoritative save и обязательный client simulation hash.

---

## 1. Уровни защиты

Валидация состоит из пяти уровней:

1. **Basic result validation**  
   Проверяет владельца матча, статус, heroId, длительность и базовые caps.

2. **Event-log replay validation**  
   Проверяет журнал событий боя и извлекает server evidence: kills, deaths, gold, level, objectives и winner.

3. **Deterministic action replay validation**  
   Проверяет action stream игрока: порядок действий, timestamps, cooldowns, movement envelope, ranges, hash и server-issued validation token.

4. **Shared authoritative simulation**  
   Запускает deterministic tick simulation из `seed + actionStream`: боты, миньоны, башни, projectiles, zones, HP/objectives и result derivation.

5. **Server-calculated result**  
   После успешной проверки сервер сохраняет нормализованный результат, рассчитанный из replay evidence. При включённом `MATCH_AUTHORITATIVE_REPLAY_SAVE=true` и terminal authoritative simulation сервер может сохранять result из simulation.

---

## 2. Поток результата

```text
Client
  │
  │ POST /api/matches/start
  ▼
Server creates matchId + seed + validationToken
  │
  │ client plays match
  │ client records eventLog + actionStream
  ▼
Client POST /api/matches/:matchId/result
  │
  ▼
server/matchValidator.js
  ├─ basic result validation
  ├─ event-log validation
  │    └─ extracts server evidence
  ├─ deterministicReplay.js
  │    ├─ validates action stream
  │    └─ runs shared authoritative simulation
  ├─ compare clientSimulation.stateHash with server simulation stateHash
  └─ deriveServerCalculatedResult()
       └─ creates result saved to DB
  │
  ▼
Repository saves server-calculated or authoritative result and marks match finished
```

---

## 3. Shared deterministic simulation

Общие правила находятся здесь:

```text
shared/combatRules.js
shared/combatRules.d.ts
```

### Что теперь есть в shared simulation

`shared/combatRules.js` теперь содержит:

- protocol versions:
  - `EVENT_LOG_VERSION`
  - `ACTION_STREAM_VERSION`
  - `SERVER_RESULT_SOURCE`
  - `AUTHORITATIVE_RESULT_SOURCE`
- `MAP_RULES`;
- `SIMULATION_RULES`;
- `LANE_PATH` / `RED_LANE_PATH`;
- `COMBAT_HERO_RULES`;
- `ECONOMY_RULES`;
- deterministic helpers:
  - `canonicalStringify`
  - `stableHash`
  - deterministic seeded offsets;
- economy helpers:
  - `rewardForDefeat`
  - `nextLevelXp`
  - `calculateActionBudgets`;
- simulation API:
  - `createInitialCombatState()`
  - `applyCombatActions()`
  - `stepCombatState()`
  - `renderCombatSnapshot()`
  - `simulateCombat()`.

### Client migration progress

Основной playable path теперь переведён на shared loop:

```text
src/main.ts
  HeroSelectScene -> SharedSimScene
  SharedSimScene input -> actionStream.actions
  shared/combatRules.stepCombatState() -> RenderCombatSnapshot
  Phaser renderer -> actors/projectiles/zones snapshots
  actionStream.actions -> simulateCombat() -> clientSimulation.stateHash/result
  server -> simulateCombat() -> authoritativeStateHash/result
```

Обычный матч и tutorial теперь идут через `SharedSimScene`. В обоих режимах Phaser не держит отдельную combat-модель: он собирает input и рисует deterministic snapshots из `shared/combatRules.js`. Старый `MatchScene` оставлен в коде только как hidden dev fallback.

### Simulated systems

`simulateCombat()` теперь моделирует по fixed ticks:

- стартовое состояние карты;
- героев обеих команд;
- союзных и вражеских ботов;
- миньонов и wave spawn;
- движение по lane path;
- bot AI target selection;
- minion AI;
- tower targeting;
- basic attacks;
- hero abilities;
- projectiles;
- damage zones;
- delayed ability effects;
- shields/aura/slow/stun-compatible fields;
- HP всех actor-ов;
- kills/deaths;
- respawn heroes;
- tower/core destruction;
- winner detection;
- authoritative result derivation;
- deterministic state hash.

---

## 4. Match start response

`POST /api/matches/start` возвращает server-issued token:

```json
{
  "ok": true,
  "match": {
    "id": "match_xxx",
    "heroId": "kairo",
    "seed": 123456,
    "validationToken": "server_hmac_token",
    "mode": "bot_3v3",
    "map": "single_lane_shonen_arena"
  }
}
```

`validationToken` строится на сервере из:

```text
matchId | userId | telegramId | heroId | seed
```

и подписывается через `MATCH_REPLAY_SECRET`. Клиент не знает secret, но возвращает token вместе с action stream.

---

## 5. Result payload

Клиент отправляет result + два журнала:

```json
{
  "victory": true,
  "winner": "blue",
  "durationSec": 220,
  "heroName": "Кайро",
  "heroId": "kairo",
  "kills": 2,
  "deaths": 0,
  "gold": 640,
  "level": 3,
  "eventLog": {},
  "actionStream": {}
}
```

В v5 backend может принять result, но сохранить **другие значения**, если replay evidence доказывает server-calculated итог.

---

## 6. Event-log format

`eventLog` — журнал фактов боя:

```json
{
  "version": "client-event-log-v1",
  "matchId": "match_xxx",
  "heroId": "kairo",
  "seed": 123456,
  "startedAtClientMs": 1780000000000,
  "events": [],
  "summary": {
    "victory": true,
    "winner": "blue",
    "durationSec": 220,
    "kills": 2,
    "deaths": 0,
    "gold": 640,
    "level": 3,
    "towersDestroyed": 2,
    "coreDestroyed": true
  }
}
```

### Event types

```text
match_start
move
attack
cast
damage
kill
objective
reward
level_up
match_end
event_log_truncated
```

### Event-log checks

Сервер проверяет:

- `version === client-event-log-v1`;
- `matchId`, `heroId`, `seed` совпадают с серверным матчем;
- размер и количество событий в пределах лимитов;
- timestamps неотрицательные, неубывающие и не выходят далеко за `durationSec`;
- есть ровно один `match_start` и один `match_end`;
- player hero kills не меньше итоговых client kills;
- deaths игрока не скрыты клиентом;
- `result.gold` не превышает максимум `goldAfter` в журнале;
- `result.level` не превышает максимум `levelAfter` в журнале;
- для победы есть objective destruction красного core синей командой;
- `eventLog.summary` совпадает с event evidence.

### Server evidence из event-log

Сервер извлекает:

```text
playerHeroKills
playerDeaths
maxGoldAfter
maxLevelAfter
blueDestroyedRedCore
blueDestroyedRedTowers
lastEventTimeMs
matchEndWinner
matchEndDurationSec
```

---

## 7. Action stream format

`actionStream` — компактный поток действий игрока:

```json
{
  "version": "client-action-stream-v1",
  "matchId": "match_xxx",
  "heroId": "kairo",
  "seed": 123456,
  "validationToken": "server_hmac_token",
  "tickRate": 2,
  "startedAtClientMs": 1780000000000,
  "actions": [
    { "seq": 0, "t": 0, "type": "match_start", "x": 320, "y": 570 },
    { "seq": 1, "t": 500, "type": "move", "x": 410, "y": 570, "dx": 1, "dy": 0 },
    { "seq": 2, "t": 2200, "type": "attack", "x": 620, "y": 570, "targetX": 650, "targetY": 570 },
    { "seq": 3, "t": 5200, "type": "cast", "slot": "primary", "x": 620, "y": 570, "targetX": 700, "targetY": 570 },
    { "seq": 4, "t": 12000, "type": "move", "x": 900, "y": 600, "dx": 0, "dy": 0 },
    { "seq": 5, "t": 12000, "type": "match_end", "x": 900, "y": 600 }
  ],
  "summary": {
    "durationSec": 12,
    "lastX": 900,
    "lastY": 600,
    "moveSamples": 2,
    "attackCount": 1,
    "castCounts": {
      "primary": 1,
      "secondary": 0,
      "ultimate": 0
    },
    "truncated": false
  },
  "clientSimulation": {
    "source": "authoritative-sim-v1",
    "stateHash": "fnv1a32:client_hash",
    "result": {
      "terminal": false,
      "victory": false,
      "winner": "red",
      "durationSec": 12,
      "heroName": "Кайро",
      "heroId": "kairo",
      "kills": 0,
      "deaths": 1,
      "gold": 0,
      "level": 1
    }
  },
  "integrityHash": "fnv1a32:xxxxxxxx"
}
```

### Action types

```text
match_start
move
attack
cast
match_end
action_stream_truncated
```

### Action-stream checks

Сервер проверяет:

- `version === client-action-stream-v1`;
- `matchId`, `heroId`, `seed` совпадают с матчем;
- `validationToken` совпадает с server-side HMAC;
- `integrityHash` совпадает с canonical action stream body;
- `actions` — массив допустимого размера;
- `seq` строго равен индексу action;
- timestamps неубывающие;
- `match_start` первый и единственный;
- `match_end` последний и единственный;
- координаты в пределах карты;
- move vectors нормализованы;
- stop movement samples (`dx=0`, `dy=0`) поддерживаются;
- движение между samples не превышает envelope героя с учётом mobility abilities;
- суммарное sampled movement не превышает hero speed budget;
- attack cooldown не нарушен;
- attack target не слишком далеко;
- cast slot валиден;
- cast cooldown не нарушен;
- cast target не слишком далеко;
- `summary.moveSamples`, `summary.attackCount`, `summary.castCounts` совпадают с actions;
- attack/cast counts совпадают между `actionStream` и `eventLog`, если логи не были усечены;
- kills/gold/level не превышают action-derived budget;
- если передан `clientSimulation`, его `stateHash` и result сверяются с server simulation output;
- в strict mode mismatch client/server simulation hash становится rejection.

---

## 8. Authoritative simulation output

Если `MATCH_AUTHORITATIVE_REPLAY_ENABLED=true`, ответ validation содержит:

```json
{
  "authoritativeReplay": true,
  "authoritativeStateHash": "fnv1a32:0542e440",
  "clientSimulationMatched": true,
  "authoritativeResult": {
    "source": "authoritative-sim-v1",
    "terminal": false,
    "victory": false,
    "winner": "red",
    "durationSec": 12,
    "heroName": "Кайро",
    "heroId": "kairo",
    "kills": 1,
    "deaths": 1,
    "gold": 160,
    "level": 1
  }
}
```

`terminal=false` означает, что simulation дошла до конца action stream, но core destruction не произошёл. В shadow mode это warning, а не rejection. В strict mode это rejection.

---

## 9. Server-calculated result

Если event-log валиден, backend сохраняет не raw client payload, а результат:

```text
source: server-calculated-v1
```

Поля рассчитываются так:

```text
victory    = blueDestroyedRedCore
winner     = blueDestroyedRedCore ? blue : red
duration   = action match_end time или event match_end duration, если совпадает с client duration с допуском
heroName   = shared hero rules
heroId     = match/result heroId
kills      = playerHeroKills из event-log
deaths     = playerDeaths из event-log
gold       = maxGoldAfter из event-log
level      = maxLevelAfter из event-log
```

Если server-calculated поля отличаются от client result, backend возвращает warning:

```json
{
  "code": "server_result_adjusted",
  "message": "Сервер пересчитал результат из replay evidence. Изменены поля: gold."
}
```

---

## 10. Strict authoritative mode

Production strict mode включён в `.env.production.example`:

```env
MATCH_AUTHORITATIVE_REPLAY_STRICT=true
MATCH_AUTHORITATIVE_REPLAY_SAVE=true
MATCH_CLIENT_SIM_HASH_REQUIRED=true
```

В этом режиме:

- non-terminal simulation отклоняется;
- mismatch между replay evidence и authoritative simulation отклоняется;
- mismatch client/server `clientSimulation.stateHash` отклоняется;
- сохранённый result берётся из terminal `authoritative-sim-v1`.

Для локальной разработки и canary rollout можно временно держать:

```env
MATCH_AUTHORITATIVE_REPLAY_STRICT=false
MATCH_AUTHORITATIVE_REPLAY_SAVE=false
MATCH_CLIENT_SIM_HASH_REQUIRED=false
```

---

## 11. Успешный ответ

```json
{
  "ok": true,
  "result": {
    "victory": true,
    "winner": "blue",
    "durationSec": 220,
    "heroName": "Кайро",
    "heroId": "kairo",
    "kills": 2,
    "deaths": 0,
    "gold": 640,
    "level": 3
  },
  "validation": {
    "version": "match-result-v5",
    "warnings": [],
    "serverCalculated": true,
    "resultSource": "server-calculated-v1",
    "authoritativeReplay": true,
    "authoritativeStateHash": "fnv1a32:xxxxxxxx",
    "authoritativeResult": {
      "source": "authoritative-sim-v1",
      "terminal": true
    }
  },
  "user": {}
}
```

---

## 12. Пример rejection: cooldown tamper

```json
{
  "ok": false,
  "error": "Match result rejected by server-side validation.",
  "validation": {
    "ok": false,
    "statusCode": 422,
    "version": "match-result-v5",
    "errors": [
      {
        "field": "actionStream.actions[4]",
        "code": "attack_cooldown_violation",
        "message": "Базовые атаки идут быстрее cooldown героя."
      }
    ],
    "serverCalculated": true,
    "resultSource": "server-calculated-v1",
    "authoritativeReplay": true
  }
}
```

---

## 13. Env-настройки

```env
MATCH_MIN_DURATION_SEC=12
MATCH_MAX_DURATION_SEC=1200
MATCH_MAX_SUBMIT_AGE_SEC=7200
MATCH_MAX_DURATION_AHEAD_SEC=45

MATCH_EVENT_LOG_REQUIRED=false
MATCH_EVENT_LOG_MAX_EVENTS=900
MATCH_EVENT_LOG_MAX_BYTES=180000

MATCH_ACTION_STREAM_REQUIRED=false
MATCH_ACTION_STREAM_MAX_ACTIONS=2600
MATCH_ACTION_STREAM_MAX_BYTES=260000
MATCH_REPLAY_SECRET=dev-replay-secret-change-me

MATCH_AUTHORITATIVE_REPLAY_ENABLED=true
MATCH_AUTHORITATIVE_REPLAY_STRICT=false
MATCH_AUTHORITATIVE_REPLAY_SAVE=false
MATCH_CLIENT_SIM_HASH_REQUIRED=false
```

Для production сейчас рекомендуется и уже выставлено в `.env.production.example`:

```env
MATCH_EVENT_LOG_REQUIRED=true
MATCH_ACTION_STREAM_REQUIRED=true
MATCH_AUTHORITATIVE_REPLAY_ENABLED=true
MATCH_AUTHORITATIVE_REPLAY_STRICT=true
MATCH_AUTHORITATIVE_REPLAY_SAVE=true
MATCH_CLIENT_SIM_HASH_REQUIRED=true
MATCH_REPLAY_SECRET=<64+ random chars>
```

Для canary/legacy compatibility можно временно вернуть strict/save/client-hash flags в `false`, но production target — strict authoritative saves.

---

## 14. Smoke-test

Запустите API:

```bash
npm run dev:server
```

Затем:

```bash
scripts/smoke-validation.sh
# или npm run smoke:validation
```

Для production strict/save path без ожидания реального матча:

```bash
npm run smoke:strict-shared-sim
npm run smoke:shared-tutorial
```

`npm run smoke:validation` проверяет:

1. валидный результат с event-log, action-stream, authoritative simulation и `clientSimulationMatched:true` принимается;
2. повторный результат того же матча отклоняется с `409`;
3. очевидно поддельный результат отклоняется с `422`;
4. tampered event-log summary отклоняется с `422`;
5. tampered deterministic replay cooldown отклоняется с `422`;
6. если клиент занизил `gold`, сервер сохраняет server-calculated `gold` из replay evidence.

`npm run smoke:strict-shared-sim` дополнительно проверяет production strict/save path: terminal authoritative simulation сохраняется как `authoritative-sim-v1`, `clientSimulationMatched:true` обязателен, а missing/tampered `actionStream.clientSimulation.stateHash` отклоняется.

`npm run smoke:shared-tutorial` проверяет deterministic tutorial path для всех трёх героев: dummy, skills, tower gate и core completion.

---

## 15. Ограничения текущего anti-cheat

`authoritative-sim-v1` моделирует основные gameplay systems и используется `SharedSimScene` как источник физики/боёвки для обычного матча и tutorial. Public legacy `Classic` path убран из выбора героя; `MatchScene` оставлен только как hidden dev fallback. Local defaults остаются shadow-compatible, production template переведён на strict/save/client-hash.

---

## 16. Следующий этап

Рекомендуемый следующий шаг:

```text
Shared simulation playtest polish
  ├─ test SharedSimScene on mobile Telegram WebApp controls
  ├─ tune hero/bot balance for target match duration and winrate
  ├─ replace geometric placeholders with sprite/VFX atlas
  ├─ remove hidden legacy MatchScene entirely after final QA
  └─ monitor production validation warnings/clientSimulationMatched rate after rollout
```

После этого можно безопасно включить strict authoritative mode и сделать `authoritative-sim-v1` единственным источником начислений.
