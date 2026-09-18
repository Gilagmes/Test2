import { validateActionStream } from './deterministicReplay.js';
import { COMBAT_HERO_RULES, EVENT_LOG_VERSION, SERVER_RESULT_SOURCE } from '../shared/combatRules.js';

const HEROES = new Map(Object.values(COMBAT_HERO_RULES).map((hero) => [hero.id, { name: hero.name }]));

const VALIDATION_VERSION = 'match-result-v5';

const DEFAULTS = {
  minDurationSec: readIntEnv('MATCH_MIN_DURATION_SEC', 12),
  maxDurationSec: readIntEnv('MATCH_MAX_DURATION_SEC', 20 * 60),
  maxSubmitAgeSec: readIntEnv('MATCH_MAX_SUBMIT_AGE_SEC', 2 * 60 * 60),
  maxDurationAheadOfServerSec: readIntEnv('MATCH_MAX_DURATION_AHEAD_SEC', 45),
  authoritativeReplaySave: readBoolEnv('MATCH_AUTHORITATIVE_REPLAY_SAVE', false),
  eventLogRequired: readBoolEnv('MATCH_EVENT_LOG_REQUIRED', false),
  maxEventLogEvents: readIntEnv('MATCH_EVENT_LOG_MAX_EVENTS', 900),
  maxEventLogBytes: readIntEnv('MATCH_EVENT_LOG_MAX_BYTES', 180_000)
};

export function validateMatchResult({ user, match, payload, nowMs = Date.now() }) {
  const errors = [];
  const warnings = [];

  if (!user) {
    return fail(401, 'unauthorized', 'Пользователь не авторизован.', errors, warnings);
  }

  if (!match) {
    return fail(404, 'match_not_found', 'Матч не найден. Результат не сохранён.', errors, warnings);
  }

  if (match.userId !== user.id || String(match.telegramId) !== String(user.telegramId)) {
    return fail(403, 'match_owner_mismatch', 'Этот матч принадлежит другому игроку.', errors, warnings);
  }

  if (match.status !== 'started') {
    return fail(409, 'match_already_finished', 'Результат этого матча уже был отправлен.', errors, warnings);
  }

  if (payload?.tutorial) {
    return fail(422, 'tutorial_result_not_allowed', 'Tutorial завершается через отдельный endpoint /api/tutorial/complete.', errors, warnings);
  }

  const sanitized = sanitizePayload(payload);

  if (!HEROES.has(sanitized.heroId)) {
    errors.push(fieldError('heroId', 'unknown_hero', 'Неизвестный герой.'));
  }

  if (match.heroId !== sanitized.heroId) {
    errors.push(fieldError('heroId', 'hero_mismatch', `Матч был начат героем ${match.heroId}, но результат пришёл для ${sanitized.heroId}.`));
  }

  if (!['blue', 'red'].includes(sanitized.winner)) {
    errors.push(fieldError('winner', 'invalid_winner', 'winner должен быть blue или red.'));
  }

  if (sanitized.victory !== (sanitized.winner === 'blue')) {
    errors.push(fieldError('victory', 'winner_victory_mismatch', 'Для игрока синей команды victory должен совпадать с winner=blue.'));
  }

  if (sanitized.durationSec < DEFAULTS.minDurationSec) {
    errors.push(fieldError('durationSec', 'duration_too_short', `Матч слишком короткий: минимум ${DEFAULTS.minDurationSec} сек.`));
  }

  if (sanitized.durationSec > DEFAULTS.maxDurationSec) {
    errors.push(fieldError('durationSec', 'duration_too_long', `Матч слишком длинный: максимум ${DEFAULTS.maxDurationSec} сек.`));
  }

  const createdAtMs = readMatchCreatedAtMs(match);
  if (createdAtMs) {
    const serverElapsedSec = Math.max(0, Math.floor((nowMs - createdAtMs) / 1000));

    if (serverElapsedSec > DEFAULTS.maxSubmitAgeSec) {
      errors.push(fieldError('matchId', 'match_expired', 'Матч слишком старый, результат не принимается.'));
    }

    if (sanitized.durationSec > serverElapsedSec + DEFAULTS.maxDurationAheadOfServerSec) {
      errors.push(fieldError(
        'durationSec',
        'duration_ahead_of_server_clock',
        `Клиентская длительность (${sanitized.durationSec}с) слишком сильно превышает серверное время матча (${serverElapsedSec}с).`
      ));
    }

    if (serverElapsedSec - sanitized.durationSec > 5 * 60) {
      warnings.push({ code: 'duration_much_lower_than_server_clock', message: 'Клиентская длительность заметно меньше серверной.' });
    }
  } else {
    warnings.push({ code: 'missing_match_created_at', message: 'Не удалось проверить server clock матча.' });
  }

  const maxKills = 8 + Math.floor(sanitized.durationSec / 8);
  if (sanitized.kills > maxKills) {
    errors.push(fieldError('kills', 'kills_too_high', `Слишком много убийств для длительности матча. Максимум: ${maxKills}.`));
  }

  const maxDeaths = 2 + Math.floor(sanitized.durationSec / 5);
  if (sanitized.deaths > maxDeaths) {
    errors.push(fieldError('deaths', 'deaths_too_high', `Слишком много смертей для длительности матча. Максимум: ${maxDeaths}.`));
  }

  const maxGold = 1400 + sanitized.durationSec * 30 + sanitized.kills * 220 + (sanitized.victory ? 1200 : 0);
  if (sanitized.gold > maxGold) {
    errors.push(fieldError('gold', 'gold_too_high', `Слишком много золота для длительности матча. Максимум: ${maxGold}.`));
  }

  if (sanitized.level > 8) {
    errors.push(fieldError('level', 'level_too_high', 'В текущем MVP максимальный уровень героя — 8.'));
  }

  const minLikelyDurationForLevel = Math.max(0, (sanitized.level - 4) * 18);
  if (sanitized.durationSec < minLikelyDurationForLevel) {
    warnings.push({ code: 'level_fast_for_duration', message: 'Уровень выглядит высоким для длительности матча.' });
  }

  const eventLogValidation = validateEventLog(payload?.eventLog, sanitized, match);
  errors.push(...eventLogValidation.errors);
  warnings.push(...eventLogValidation.warnings);

  const preliminaryServerResult = deriveServerCalculatedResult(sanitized, eventLogValidation.evidence, null);
  const actionStreamValidation = validateActionStream(payload?.actionStream, preliminaryServerResult.result, match, user, payload?.eventLog);
  errors.push(...actionStreamValidation.errors);
  warnings.push(...actionStreamValidation.warnings);

  const serverResult = deriveServerCalculatedResult(sanitized, eventLogValidation.evidence, actionStreamValidation.replay);
  if (serverResult.serverCalculated) {
    pushServerAdjustmentWarnings(sanitized, serverResult.result, warnings);
  }

  if (errors.length > 0) {
    return {
      ok: false,
      statusCode: chooseStatus(errors),
      version: VALIDATION_VERSION,
      errors,
      warnings,
      sanitized: serverResult.result,
      clientResult: sanitized,
      serverCalculated: serverResult.serverCalculated,
      resultSource: serverResult.source,
      authoritativeReplay: Boolean(actionStreamValidation.replay?.authoritativeReplay),
      authoritativeStateHash: actionStreamValidation.replay?.authoritativeStateHash ?? null,
      authoritativeResult: actionStreamValidation.replay?.authoritativeResult ?? null,
      clientSimulationMatched: actionStreamValidation.replay?.clientSimulationMatched ?? null
    };
  }

  return {
    ok: true,
    statusCode: 200,
    version: VALIDATION_VERSION,
    errors: [],
    warnings,
    sanitized: serverResult.result,
    clientResult: sanitized,
    serverCalculated: serverResult.serverCalculated,
    resultSource: serverResult.source,
    authoritativeReplay: Boolean(actionStreamValidation.replay?.authoritativeReplay),
    authoritativeStateHash: actionStreamValidation.replay?.authoritativeStateHash ?? null,
    authoritativeResult: actionStreamValidation.replay?.authoritativeResult ?? null,
    clientSimulationMatched: actionStreamValidation.replay?.clientSimulationMatched ?? null
  };
}

function validateEventLog(eventLog, result, match) {
  const errors = [];
  const warnings = [];

  if (!eventLog) {
    if (DEFAULTS.eventLogRequired) {
      errors.push(fieldError('eventLog', 'event_log_required', 'Для сохранения результата требуется журнал событий матча.'));
    } else {
      warnings.push({ code: 'event_log_missing', message: 'Журнал событий не передан; применены только базовые проверки результата.' });
    }
    return { errors, warnings, evidence: null };
  }

  let encodedSize = 0;
  try {
    encodedSize = Buffer.byteLength(JSON.stringify(eventLog), 'utf8');
  } catch {
    errors.push(fieldError('eventLog', 'event_log_not_serializable', 'Журнал событий не является корректным JSON.'));
    return { errors, warnings, evidence: null };
  }

  if (encodedSize > DEFAULTS.maxEventLogBytes) {
    errors.push(fieldError('eventLog', 'event_log_too_large', `Журнал событий слишком большой: ${encodedSize} bytes.`));
  }

  if (eventLog.version !== EVENT_LOG_VERSION) {
    errors.push(fieldError('eventLog.version', 'event_log_version_mismatch', `Ожидалась версия ${EVENT_LOG_VERSION}.`));
  }

  if (eventLog.matchId && eventLog.matchId !== match.id) {
    errors.push(fieldError('eventLog.matchId', 'event_log_match_mismatch', 'matchId в журнале не совпадает с URL матча.'));
  }

  if (eventLog.heroId !== result.heroId) {
    errors.push(fieldError('eventLog.heroId', 'event_log_hero_mismatch', 'heroId в журнале не совпадает с результатом.'));
  }

  if (eventLog.seed !== null && eventLog.seed !== undefined && Number(eventLog.seed) !== Number(match.seed)) {
    errors.push(fieldError('eventLog.seed', 'event_log_seed_mismatch', 'seed в журнале не совпадает с seed матча.'));
  }

  const events = Array.isArray(eventLog.events) ? eventLog.events : null;
  if (!events) {
    errors.push(fieldError('eventLog.events', 'event_log_events_missing', 'eventLog.events должен быть массивом.'));
    return { errors, warnings, evidence: null };
  }

  if (events.length < 2) {
    errors.push(fieldError('eventLog.events', 'event_log_too_short', 'В журнале слишком мало событий.'));
  }

  if (events.length > DEFAULTS.maxEventLogEvents + 1) {
    errors.push(fieldError('eventLog.events', 'event_log_too_many_events', `Слишком много событий. Максимум: ${DEFAULTS.maxEventLogEvents}.`));
  }

  const allowedTypes = new Set([
    'match_start',
    'move',
    'attack',
    'cast',
    'damage',
    'kill',
    'objective',
    'reward',
    'level_up',
    'match_end',
    'event_log_truncated'
  ]);

  let previousT = -1;
  let matchStartCount = 0;
  let matchEndCount = 0;
  let moveCount = 0;
  let playerAttackCount = 0;
  let playerCastCount = 0;
  let playerDamageEvents = 0;
  let playerHeroKills = 0;
  let playerDeaths = 0;
  let maxGoldAfter = 0;
  let maxLevelAfter = 1;
  let blueDestroyedRedCore = false;
  let blueDestroyedRedTowers = 0;
  let truncated = false;
  let lastEventTimeMs = 0;
  let matchEndWinner = null;
  let matchEndDurationSec = null;

  const eventErrorsLimit = 12;
  const pushEventError = (field, code, message) => {
    if (errors.length < eventErrorsLimit) errors.push(fieldError(field, code, message));
  };

  for (let i = 0; i < events.length; i += 1) {
    const event = events[i];
    if (!event || typeof event !== 'object') {
      pushEventError(`eventLog.events[${i}]`, 'event_not_object', 'Событие должно быть объектом.');
      continue;
    }

    if (!allowedTypes.has(event.type)) {
      pushEventError(`eventLog.events[${i}].type`, 'event_type_unknown', `Неизвестный тип события: ${String(event.type)}.`);
    }

    const t = Number(event.t);
    if (!Number.isFinite(t) || t < 0) {
      pushEventError(`eventLog.events[${i}].t`, 'event_time_invalid', 'Время события должно быть неотрицательным числом.');
    } else {
      if (t < previousT) {
        pushEventError(`eventLog.events[${i}].t`, 'event_time_not_monotonic', 'Время событий должно быть неубывающим.');
      }
      previousT = t;
      lastEventTimeMs = Math.max(lastEventTimeMs, t);
      if (t > result.durationSec * 1000 + 5000) {
        pushEventError(`eventLog.events[${i}].t`, 'event_time_after_match_end', 'Событие находится далеко после конца матча.');
      }
    }

    if (event.type === 'match_start') matchStartCount += 1;
    if (event.type === 'match_end') {
      matchEndCount += 1;
      matchEndWinner = event.winner ?? event.data?.winner ?? matchEndWinner;
      if (event.data?.durationSec !== undefined) matchEndDurationSec = Number(event.data.durationSec);
    }
    if (event.type === 'move') moveCount += 1;
    if (event.type === 'event_log_truncated') truncated = true;

    if (event.actor?.controller === 'player') {
      if (event.type === 'attack') playerAttackCount += 1;
      if (event.type === 'cast') playerCastCount += 1;
      if (event.type === 'damage') playerDamageEvents += 1;
      if (event.type === 'kill' && event.target?.kind === 'hero') playerHeroKills += 1;
    }

    if (event.type === 'kill' && event.target?.controller === 'player') {
      playerDeaths += 1;
    }

    if (typeof event.goldAfter === 'number') maxGoldAfter = Math.max(maxGoldAfter, event.goldAfter);
    if (typeof event.levelAfter === 'number') maxLevelAfter = Math.max(maxLevelAfter, event.levelAfter);

    if (event.type === 'objective' && event.target?.team === 'red' && event.actor?.team === 'blue') {
      if (event.objective === 'core' || event.target?.kind === 'core') blueDestroyedRedCore = true;
      if (event.objective === 'tower' || event.target?.kind === 'tower') blueDestroyedRedTowers += 1;
    }
  }

  const evidence = {
    matchStartCount,
    matchEndCount,
    moveCount,
    playerAttackCount,
    playerCastCount,
    playerDamageEvents,
    playerHeroKills,
    playerDeaths,
    maxGoldAfter,
    maxLevelAfter,
    blueDestroyedRedCore,
    blueDestroyedRedTowers,
    truncated,
    lastEventTimeMs,
    matchEndWinner,
    matchEndDurationSec: Number.isFinite(matchEndDurationSec) ? matchEndDurationSec : null
  };

  if (matchStartCount !== 1) {
    errors.push(fieldError('eventLog.events', 'event_log_start_count_invalid', 'Журнал должен содержать ровно одно событие match_start.'));
  }

  if (matchEndCount !== 1) {
    errors.push(fieldError('eventLog.events', 'event_log_end_count_invalid', 'Журнал должен содержать ровно одно событие match_end.'));
  }

  if (truncated) {
    warnings.push({ code: 'event_log_truncated', message: 'Клиентский журнал был усечён из-за лимита событий.' });
  }

  if (result.durationSec > 20 && moveCount === 0) {
    warnings.push({ code: 'event_log_no_movement', message: 'В журнале нет movement samples.' });
  }

  if (result.kills > playerHeroKills) {
    errors.push(fieldError('eventLog.kills', 'event_log_kills_mismatch', `Итоговые kills=${result.kills}, но в журнале player hero kills=${playerHeroKills}.`));
  } else if (result.kills < playerHeroKills) {
    warnings.push({ code: 'client_kills_below_evidence', message: 'Клиентские kills ниже event-log evidence; будет сохранено server-calculated значение.' });
  }

  if (result.deaths < playerDeaths) {
    errors.push(fieldError('eventLog.deaths', 'event_log_deaths_mismatch', `Итоговые deaths=${result.deaths}, но в журнале player deaths=${playerDeaths}.`));
  } else if (result.deaths > playerDeaths) {
    warnings.push({ code: 'client_deaths_above_evidence', message: 'Клиентские deaths выше event-log evidence; будет сохранено server-calculated значение.' });
  }

  if (result.gold > 0 && maxGoldAfter > 0 && result.gold > maxGoldAfter) {
    errors.push(fieldError('eventLog.gold', 'event_log_gold_mismatch', `Итоговое золото ${result.gold} превышает максимум goldAfter в журнале ${maxGoldAfter}.`));
  } else if (maxGoldAfter > 0 && result.gold < maxGoldAfter) {
    warnings.push({ code: 'client_gold_below_evidence', message: 'Клиентское золото ниже event-log evidence; будет сохранено server-calculated значение.' });
  }

  if (result.level > maxLevelAfter) {
    errors.push(fieldError('eventLog.level', 'event_log_level_mismatch', `Итоговый уровень ${result.level} выше максимума levelAfter в журнале ${maxLevelAfter}.`));
  } else if (result.level < maxLevelAfter) {
    warnings.push({ code: 'client_level_below_evidence', message: 'Клиентский уровень ниже event-log evidence; будет сохранено server-calculated значение.' });
  }

  if (result.victory && !blueDestroyedRedCore) {
    errors.push(fieldError('eventLog.objective', 'event_log_missing_core_objective', 'Для победы в журнале должно быть разрушение красного ядра синей командой.'));
  }

  if (playerDamageEvents === 0 && (result.kills > 0 || result.gold > 500)) {
    warnings.push({ code: 'event_log_no_player_damage', message: 'В журнале нет событий урона игрока, хотя результат содержит kills/gold.' });
  }

  if (playerAttackCount === 0 && playerCastCount === 0 && result.gold > 500) {
    warnings.push({ code: 'event_log_no_player_actions', message: 'В журнале нет attack/cast событий игрока при заметном золоте.' });
  }

  const summary = eventLog.summary;
  if (!summary || typeof summary !== 'object') {
    errors.push(fieldError('eventLog.summary', 'event_log_summary_missing', 'eventLog.summary обязателен.'));
  } else {
    const evidenceWinner = blueDestroyedRedCore ? 'blue' : (matchEndWinner === 'blue' || matchEndWinner === 'red' ? matchEndWinner : result.winner);
    const evidenceVictory = evidenceWinner === 'blue';
    if (Boolean(summary.victory) !== evidenceVictory) errors.push(fieldError('eventLog.summary.victory', 'summary_victory_mismatch', 'summary.victory не совпадает с event evidence.'));
    if (summary.winner !== evidenceWinner) errors.push(fieldError('eventLog.summary.winner', 'summary_winner_mismatch', 'summary.winner не совпадает с event evidence.'));
    if (Math.abs(Number(summary.durationSec) - result.durationSec) > 2) errors.push(fieldError('eventLog.summary.durationSec', 'summary_duration_mismatch', 'summary.durationSec не совпадает с длительностью результата.'));
    if (Number(summary.kills) !== playerHeroKills) errors.push(fieldError('eventLog.summary.kills', 'summary_kills_mismatch', 'summary.kills не совпадает с kill events.'));
    if (Number(summary.deaths) !== playerDeaths) errors.push(fieldError('eventLog.summary.deaths', 'summary_deaths_mismatch', 'summary.deaths не совпадает с death events.'));
    if (maxGoldAfter > 0 && Number(summary.gold) !== maxGoldAfter) errors.push(fieldError('eventLog.summary.gold', 'summary_gold_mismatch', 'summary.gold не совпадает с reward/match_end evidence.'));
    if (Number(summary.level) !== maxLevelAfter) errors.push(fieldError('eventLog.summary.level', 'summary_level_mismatch', 'summary.level не совпадает с level evidence.'));
    if (Number(summary.towersDestroyed ?? 0) < blueDestroyedRedTowers) {
      warnings.push({ code: 'summary_tower_count_lower_than_events', message: 'summary.towersDestroyed меньше числа tower objective событий.' });
    }
    if (Boolean(summary.coreDestroyed) !== blueDestroyedRedCore && evidenceVictory) {
      errors.push(fieldError('eventLog.summary.coreDestroyed', 'summary_core_destroyed_mismatch', 'summary.coreDestroyed не совпадает с objective событиями.'));
    }
  }

  return { errors, warnings, evidence };
}

function deriveServerCalculatedResult(clientResult, evidence, actionReplay) {
  const configuredHero = HEROES.get(clientResult.heroId);
  const baseResult = {
    ...clientResult,
    heroName: configuredHero?.name ?? clientResult.heroName
  };

  if (!evidence) {
    return {
      result: baseResult,
      serverCalculated: false,
      source: 'client-sanitized'
    };
  }

  if (DEFAULTS.authoritativeReplaySave && actionReplay?.authoritativeResult?.terminal) {
    const authoritative = actionReplay.authoritativeResult;
    return {
      result: {
        victory: Boolean(authoritative.victory),
        winner: authoritative.winner === 'blue' ? 'blue' : 'red',
        durationSec: clampInt(authoritative.durationSec, DEFAULTS.minDurationSec, DEFAULTS.maxDurationSec),
        heroName: configuredHero?.name ?? authoritative.heroName ?? clientResult.heroName,
        heroId: clientResult.heroId,
        kills: clampInt(authoritative.kills, 0, 1000),
        deaths: clampInt(authoritative.deaths, 0, 1000),
        gold: clampInt(authoritative.gold, 0, 1_000_000),
        level: clampInt(authoritative.level, 1, 100)
      },
      serverCalculated: true,
      source: actionReplay.authoritativeSimulation?.source ?? 'authoritative-sim-v1'
    };
  }

  const actionDurationSec = actionReplay?.lastT ? Math.round(actionReplay.lastT / 1000) : null;
  const eventDurationSec = Number.isFinite(evidence.matchEndDurationSec)
    ? Math.round(evidence.matchEndDurationSec)
    : evidence.lastEventTimeMs
      ? Math.round(evidence.lastEventTimeMs / 1000)
      : null;

  let durationSec = clientResult.durationSec;
  if (actionDurationSec !== null && Math.abs(actionDurationSec - clientResult.durationSec) <= 2) {
    durationSec = actionDurationSec;
  } else if (eventDurationSec !== null && Math.abs(eventDurationSec - clientResult.durationSec) <= 2) {
    durationSec = eventDurationSec;
  }

  const winner = evidence.blueDestroyedRedCore ? 'blue' : 'red';

  return {
    result: {
      victory: winner === 'blue',
      winner,
      durationSec: clampInt(durationSec, DEFAULTS.minDurationSec, DEFAULTS.maxDurationSec),
      heroName: configuredHero?.name ?? clientResult.heroName,
      heroId: clientResult.heroId,
      kills: clampInt(evidence.playerHeroKills, 0, 1000),
      deaths: clampInt(evidence.playerDeaths, 0, 1000),
      gold: clampInt(evidence.maxGoldAfter, 0, 1_000_000),
      level: clampInt(evidence.maxLevelAfter, 1, 100)
    },
    serverCalculated: true,
    source: SERVER_RESULT_SOURCE
  };
}

function pushServerAdjustmentWarnings(clientResult, serverResult, warnings) {
  const fields = ['victory', 'winner', 'durationSec', 'kills', 'deaths', 'gold', 'level'];
  const adjusted = fields.filter((field) => clientResult[field] !== serverResult[field]);
  if (adjusted.length === 0) return;
  warnings.push({
    code: 'server_result_adjusted',
    message: `Сервер пересчитал результат из replay evidence. Изменены поля: ${adjusted.join(', ')}.`
  });
}

function sanitizePayload(payload = {}) {
  const heroId = String(payload.heroId ?? '').slice(0, 64);
  const configuredHero = HEROES.get(heroId);

  return {
    victory: Boolean(payload.victory),
    winner: payload.winner === 'red' ? 'red' : 'blue',
    durationSec: clampInt(payload.durationSec, 0, DEFAULTS.maxDurationSec + 3600),
    heroName: String(payload.heroName ?? configuredHero?.name ?? 'Unknown').slice(0, 64),
    heroId,
    kills: clampInt(payload.kills, 0, 1000),
    deaths: clampInt(payload.deaths, 0, 1000),
    gold: clampInt(payload.gold, 0, 1_000_000),
    level: clampInt(payload.level, 1, 100)
  };
}

function readMatchCreatedAtMs(match) {
  if (!match) return null;

  if (typeof match.createdAtMs === 'bigint') return Number(match.createdAtMs);
  if (typeof match.createdAtMs === 'number' && Number.isFinite(match.createdAtMs)) return match.createdAtMs;

  const createdAtMsNumber = Number(match.createdAtMs);
  if (Number.isFinite(createdAtMsNumber) && createdAtMsNumber > 0) return createdAtMsNumber;

  const startedAtMs = new Date(match.startedAt).getTime();
  if (Number.isFinite(startedAtMs)) return startedAtMs;

  return null;
}

function chooseStatus(errors) {
  if (errors.some((error) => error.code === 'match_not_found')) return 404;
  if (errors.some((error) => error.code === 'match_owner_mismatch')) return 403;
  if (errors.some((error) => error.code === 'match_already_finished')) return 409;
  return 422;
}

function fail(statusCode, code, message, errors, warnings) {
  return {
    ok: false,
    statusCode,
    version: VALIDATION_VERSION,
    errors: [...errors, fieldError('matchId', code, message)],
    warnings,
    sanitized: null
  };
}

function fieldError(field, code, message) {
  return { field, code, message };
}

function clampInt(value, min, max) {
  const n = Number.parseInt(String(value), 10);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function readIntEnv(name, fallback) {
  const value = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(value) ? value : fallback;
}

function readBoolEnv(name, fallback) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}
