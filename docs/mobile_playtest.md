# Mobile / Telegram Mini App playtest checklist

Цель: проверить основной `SharedSimScene`, где Phaser только собирает input/рендерит snapshots, а combat state идёт из `shared/combatRules.js`.

## Перед тестом

1. Backend API запущен и доступен через `/api`.
2. Mini App открыт из Telegram bot-кнопки `/play`.
3. В production/canary окружении заданы реальные секреты:

```env
MATCH_EVENT_LOG_REQUIRED=true
MATCH_ACTION_STREAM_REQUIRED=true
MATCH_AUTHORITATIVE_REPLAY_ENABLED=true
MATCH_AUTHORITATIVE_REPLAY_STRICT=true
MATCH_AUTHORITATIVE_REPLAY_SAVE=true
MATCH_CLIENT_SIM_HASH_REQUIRED=true
```

Для canary можно временно ослабить strict flags, но финальная production-цель — strict authoritative saves.

## Контрольный сценарий

1. Открыть игру в Telegram.
2. Нажать **Играть**.
3. Выбрать каждого героя по очереди: Кайро, Рэйна, Тэо.
4. Нажать **Начать матч**.
5. Проверить, что обычный матч и tutorial запускают `SharedSimScene`, а не legacy Classic.
6. Левым пальцем проверить joystick:
   - быстрый drag;
   - короткие taps;
   - release возвращает ручку в центр;
   - персонаж перестаёт двигаться после release.
7. Правым пальцем проверить кнопки:
   - `АТК`;
   - primary ability;
   - secondary ability;
   - `ULT`;
   - cooldown overlay показывает секунды и не даёт spam-click reject.
8. Проверить читаемость HUD:
   - счёт blue/red;
   - таймер;
   - герой/level/gold;
   - `stateHash` debug text;
   - нижняя подсказка не перекрывает Telegram safe area.
9. Проверить VFX/readability:
   - hit bursts;
   - damage numbers;
   - ability rings;
   - kill feed;
   - objective banner `TOWER/CORE DOWN`;
   - victory/defeat banner.
10. Дождаться конца матча или сыграть до destruction core.
11. На Result screen проверить sync message:
   - ожидаемо: `Shared sim подтверждён: client/server stateHash совпал`;
   - в API response должно быть `clientSimulationMatched:true`.

## Acceptance criteria

- Матч и tutorial запускаются через `SharedSimScene` без доступа к Classic path.
- Управление удобно на одной руке: joystick слева, skills справа.
- После release joystick отправляет stop movement и герой перестаёт двигаться.
- Cooldown UI предотвращает spam действий.
- VFX помогают понять damage/kills/objectives, но не закрывают карту.
- Result submit принимается сервером.
- `clientSimulationMatched:true` на валидном матче.
- В strict production mode terminal authoritative match сохраняется с `resultSource: authoritative-sim-v1`.

## Что записывать во время playtest

| Поле | Пример |
| --- | --- |
| Устройство | iPhone 15 / Android Pixel |
| Telegram версия | 11.x |
| Герой | Кайро |
| Seed/matchId | из debug/API logs |
| FPS/lag субъективно | OK / просадки |
| Длительность | 03:35 |
| Winner | blue/red |
| clientSimulationMatched | true/false |
| Проблема | кнопка ULT слишком близко к краю |

## Следующие баланс-ручки

Файл: `shared/combatRules.js`

- `SIMULATION_RULES.waveIntervalMs`
- `SIMULATION_RULES.respawnMs`
- `SIMULATION_RULES.tower.hp/damage/range`
- `SIMULATION_RULES.core.hp`
- `SIMULATION_RULES.minion.hp/damage/speed`
- `COMBAT_HERO_RULES.*.damage/speed/attackCooldown/abilities`

После любого изменения баланса запускать:

```bash
npm run build
npm run smoke:strict-shared-sim
npm run smoke:shared-tutorial
npm run smoke:validation
```
