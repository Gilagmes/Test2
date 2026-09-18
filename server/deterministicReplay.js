import crypto from 'node:crypto';
import {
  ACTION_STREAM_VERSION,
  MAP_RULES,
  calculateActionBudgets,
  canonicalStringify,
  heroRuleById,
  simulateCombat,
  stableHash
} from '../shared/combatRules.js';

const DEV_REPLAY_SECRET = 'dev-replay-secret-change-me';

const DEFAULTS = {
  actionStreamRequired: readBoolEnv('MATCH_ACTION_STREAM_REQUIRED', false),
  maxActionStreamActions: readIntEnv('MATCH_ACTION_STREAM_MAX_ACTIONS', 2600),
  maxActionStreamBytes: readIntEnv('MATCH_ACTION_STREAM_MAX_BYTES', 260_000),
  authoritativeReplayEnabled: readBoolEnv('MATCH_AUTHORITATIVE_REPLAY_ENABLED', true),
  authoritativeReplayStrict: readBoolEnv('MATCH_AUTHORITATIVE_REPLAY_STRICT', false),
  authoritativeReplaySave: readBoolEnv('MATCH_AUTHORITATIVE_REPLAY_SAVE', false),
  clientSimulationHashRequired: readBoolEnv('MATCH_CLIENT_SIM_HASH_REQUIRED', false)
};

export function buildMatchValidationToken(match, user) {
  if (!match || !user) return null;
  const input = [
    String(match.id),
    String(user.id),
    String(user.telegramId),
    String(match.heroId),
    String(match.seed)
  ].join('|');

  return crypto.createHmac('sha256', replaySecret()).update(input).digest('hex').slice(0, 48);
}

export function validateActionStream(actionStream, result, match, user, eventLog) {
  const errors = [];
  const warnings = [];

  if (!actionStream) {
    if (DEFAULTS.actionStreamRequired) {
      errors.push(fieldError('actionStream', 'action_stream_required', 'Для сохранения результата требуется action stream для deterministic replay.'));
    } else {
      warnings.push({ code: 'action_stream_missing', message: 'Action stream не передан; deterministic replay не выполнялся.' });
    }
    return { errors, warnings, replay: null };
  }

  let encodedSize = 0;
  try {
    encodedSize = Buffer.byteLength(JSON.stringify(actionStream), 'utf8');
  } catch {
    errors.push(fieldError('actionStream', 'action_stream_not_serializable', 'Action stream не является корректным JSON.'));
    return { errors, warnings, replay: null };
  }

  if (encodedSize > DEFAULTS.maxActionStreamBytes) {
    errors.push(fieldError('actionStream', 'action_stream_too_large', `Action stream слишком большой: ${encodedSize} bytes.`));
  }

  if (actionStream.version !== ACTION_STREAM_VERSION) {
    errors.push(fieldError('actionStream.version', 'action_stream_version_mismatch', `Ожидалась версия ${ACTION_STREAM_VERSION}.`));
  }

  if (!actionStream.matchId || actionStream.matchId !== match.id) {
    errors.push(fieldError('actionStream.matchId', 'action_stream_match_mismatch', 'matchId в action stream должен совпадать с URL матча.'));
  }

  if (actionStream.heroId !== result.heroId) {
    errors.push(fieldError('actionStream.heroId', 'action_stream_hero_mismatch', 'heroId в action stream не совпадает с результатом.'));
  }

  if (actionStream.seed === null || actionStream.seed === undefined || Number(actionStream.seed) !== Number(match.seed)) {
    errors.push(fieldError('actionStream.seed', 'action_stream_seed_mismatch', 'seed в action stream не совпадает с seed матча.'));
  }

  const expectedToken = buildMatchValidationToken(match, user);
  if (!actionStream.validationToken) {
    errors.push(fieldError('actionStream.validationToken', 'action_stream_token_missing', 'Отсутствует server-issued validation token матча.'));
  } else if (!safeEqualString(String(actionStream.validationToken), String(expectedToken))) {
    errors.push(fieldError('actionStream.validationToken', 'action_stream_token_invalid', 'Validation token не совпадает с server-side подписью матча.'));
  }

  if (replaySecret() === DEV_REPLAY_SECRET && process.env.NODE_ENV === 'production') {
    warnings.push({ code: 'default_replay_secret', message: 'MATCH_REPLAY_SECRET использует dev значение; задайте сильный production secret.' });
  }

  const integrityHash = String(actionStream.integrityHash ?? '');
  if (!integrityHash) {
    errors.push(fieldError('actionStream.integrityHash', 'action_stream_hash_missing', 'Отсутствует integrityHash action stream.'));
  } else {
    const unsigned = { ...actionStream };
    delete unsigned.integrityHash;
    const expectedHash = stableHash(canonicalStringify(unsigned));
    if (integrityHash !== expectedHash) {
      errors.push(fieldError('actionStream.integrityHash', 'action_stream_hash_mismatch', 'integrityHash не совпадает с содержимым action stream.'));
    }
  }

  const actions = Array.isArray(actionStream.actions) ? actionStream.actions : null;
  if (!actions) {
    errors.push(fieldError('actionStream.actions', 'action_stream_actions_missing', 'actionStream.actions должен быть массивом.'));
    return { errors, warnings, replay: null };
  }

  if (actions.length < 2) {
    errors.push(fieldError('actionStream.actions', 'action_stream_too_short', 'Action stream должен содержать минимум match_start и match_end.'));
  }

  if (actions.length > DEFAULTS.maxActionStreamActions) {
    errors.push(fieldError('actionStream.actions', 'action_stream_too_many_actions', `Слишком много actions. Максимум: ${DEFAULTS.maxActionStreamActions}.`));
  }

  const hero = heroRuleById(result.heroId);
  const replay = replayActions(actions, result, hero, errors, warnings);
  validateActionSummary(actionStream.summary, result, replay, errors, warnings);
  validateEventLogBridge(eventLog, replay, errors, warnings);

  if (DEFAULTS.authoritativeReplayEnabled) {
    attachAuthoritativeSimulation({ replay, result, match, actions, actionStream, errors, warnings });
  }

  return { errors, warnings, replay };
}

function attachAuthoritativeSimulation({ replay, result, match, actions, actionStream, errors, warnings }) {
  const simulation = simulateCombat({
    heroId: result.heroId,
    seed: match.seed,
    actions,
    durationSec: result.durationSec
  });

  replay.authoritativeReplay = true;
  replay.authoritativeSimulation = {
    source: simulation.source,
    stateHash: simulation.stateHash,
    stats: simulation.stats,
    objectiveState: simulation.objectiveState,
    warnings: simulation.warnings,
    result: simulation.result
  };
  replay.authoritativeResult = simulation.result;
  replay.authoritativeStateHash = simulation.stateHash;
  replay.authoritativeReplayStrict = DEFAULTS.authoritativeReplayStrict;
  replay.authoritativeReplaySave = DEFAULTS.authoritativeReplaySave;

  const clientSimulation = actionStream?.clientSimulation;
  if (!clientSimulation) {
    replay.clientSimulationMatched = null;
    if (DEFAULTS.clientSimulationHashRequired) {
      errors.push(fieldError('actionStream.clientSimulation', 'client_simulation_required', 'Client-side shared simulation hash обязателен.'));
    } else {
      warnings.push({ code: 'client_simulation_missing', message: 'Client-side shared simulation hash не передан; сверка client/server stateHash пропущена.' });
    }
  } else {
    validateClientSimulationEcho(clientSimulation, simulation, replay, errors, warnings);
  }

  for (const warning of simulation.warnings) {
    warnings.push({ code: warning.code, message: warning.message });
  }

  const mismatches = simulation.result.terminal ? compareAuthoritativeResult(result, simulation.result) : [];
  replay.authoritativeMismatches = mismatches;

  if (mismatches.length > 0) {
    warnings.push({
      code: 'authoritative_replay_mismatch',
      message: `Authoritative simulation differs from replay evidence: ${mismatches.join(', ')}.`
    });
  }

  if (!DEFAULTS.authoritativeReplayStrict) return;

  if (!simulation.result.terminal) {
    errors.push(fieldError('actionStream.authoritativeReplay', 'authoritative_sim_not_terminal_strict', 'Authoritative simulation did not reach core destruction in strict mode.'));
    return;
  }

  for (const field of mismatches) {
    errors.push(fieldError(`actionStream.authoritativeReplay.${field}`, 'authoritative_result_mismatch_strict', `Strict authoritative replay mismatch for ${field}.`));
  }
}

function validateClientSimulationEcho(clientSimulation, serverSimulation, replay, errors, warnings) {
  const clientHash = String(clientSimulation.stateHash ?? '');
  const serverHash = String(serverSimulation.stateHash ?? '');
  const result = clientSimulation.result;

  if (!clientHash) {
    replay.clientSimulationMatched = false;
    errors.push(fieldError('actionStream.clientSimulation.stateHash', 'client_simulation_hash_missing', 'clientSimulation.stateHash обязателен.'));
    return;
  }

  replay.clientSimulationStateHash = clientHash;
  replay.clientSimulationMatched = clientHash === serverHash;

  if (clientHash !== serverHash) {
    warnings.push({
      code: 'client_server_sim_hash_mismatch',
      message: 'Client shared simulation stateHash не совпадает с server authoritative simulation stateHash.'
    });
    if (DEFAULTS.authoritativeReplayStrict) {
      errors.push(fieldError('actionStream.clientSimulation.stateHash', 'client_server_sim_hash_mismatch_strict', 'Client/server simulation hash mismatch in strict mode.'));
    }
  }

  if (!result || typeof result !== 'object') {
    warnings.push({ code: 'client_simulation_result_missing', message: 'clientSimulation.result не передан.' });
    return;
  }

  const mismatches = [];
  for (const field of ['terminal', 'victory', 'winner', 'durationSec', 'heroId', 'kills', 'deaths', 'gold', 'level']) {
    if (String(result[field]) !== String(serverSimulation.result[field])) mismatches.push(field);
  }

  replay.clientSimulationResultMismatches = mismatches;
  if (mismatches.length > 0) {
    warnings.push({
      code: 'client_server_sim_result_mismatch',
      message: `Client/server simulation result differs: ${mismatches.join(', ')}.`
    });
    if (DEFAULTS.authoritativeReplayStrict) {
      errors.push(fieldError('actionStream.clientSimulation.result', 'client_server_sim_result_mismatch_strict', 'Client/server simulation result mismatch in strict mode.'));
    }
  }
}

function compareAuthoritativeResult(result, authoritative) {
  const mismatches = [];
  if (!authoritative) return mismatches;
  if (result.winner !== authoritative.winner) mismatches.push('winner');
  if (Boolean(result.victory) !== Boolean(authoritative.victory)) mismatches.push('victory');
  if (Number(result.kills) > Number(authoritative.kills) + 1) mismatches.push('kills');
  if (Number(result.deaths) < Number(authoritative.deaths) - 1) mismatches.push('deaths');
  if (Number(result.gold) > Number(authoritative.gold) + 260) mismatches.push('gold');
  if (Number(result.level) > Number(authoritative.level) + 1) mismatches.push('level');
  return mismatches;
}

function replayActions(actions, result, hero, errors, warnings) {
  const allowedTypes = new Set(['match_start', 'move', 'attack', 'cast', 'match_end', 'action_stream_truncated']);
  const allowedSlots = new Set(['primary', 'secondary', 'ultimate']);
  const eventErrorsLimit = 16;
  const pushEventError = (field, code, message) => {
    if (errors.length < eventErrorsLimit) errors.push(fieldError(field, code, message));
  };

  const replay = {
    matchStartCount: 0,
    matchEndCount: 0,
    moveSamples: 0,
    attackCount: 0,
    castCounts: { primary: 0, secondary: 0, ultimate: 0 },
    totalCasts: 0,
    offensiveWeight: 0,
    sampledDistance: 0,
    mobilityBudgetSpent: 0,
    lastX: null,
    lastY: null,
    lastT: 0,
    truncated: false
  };

  let previousT = -1;
  let previousMove = null;
  let mobilityBonusPending = 0;
  let lastAttackT = -Infinity;
  const lastCastT = { primary: -Infinity, secondary: -Infinity, ultimate: -Infinity };

  for (let i = 0; i < actions.length; i += 1) {
    const action = actions[i];
    if (!action || typeof action !== 'object') {
      pushEventError(`actionStream.actions[${i}]`, 'action_not_object', 'Action должен быть объектом.');
      continue;
    }

    if (!allowedTypes.has(action.type)) {
      pushEventError(`actionStream.actions[${i}].type`, 'action_type_unknown', `Неизвестный тип action: ${String(action.type)}.`);
    }

    if (Number(action.seq) !== i) {
      pushEventError(`actionStream.actions[${i}].seq`, 'action_seq_invalid', `seq должен быть равен индексу action (${i}).`);
    }

    const t = Number(action.t);
    if (!Number.isFinite(t) || t < 0) {
      pushEventError(`actionStream.actions[${i}].t`, 'action_time_invalid', 'Время action должно быть неотрицательным числом.');
    } else {
      if (t < previousT) {
        pushEventError(`actionStream.actions[${i}].t`, 'action_time_not_monotonic', 'Время actions должно быть неубывающим.');
      }
      previousT = t;
      replay.lastT = t;
      if (t > result.durationSec * 1000 + 5000) {
        pushEventError(`actionStream.actions[${i}].t`, 'action_time_after_match_end', 'Action находится далеко после конца матча.');
      }
    }

    validateCoordinates(action, i, pushEventError);

    if (action.type === 'match_start') {
      replay.matchStartCount += 1;
      if (i !== 0) pushEventError(`actionStream.actions[${i}]`, 'action_start_not_first', 'match_start должен быть первым action.');
      if (hasPoint(action)) {
        previousMove = { x: Number(action.x), y: Number(action.y), t };
        replay.lastX = Number(action.x);
        replay.lastY = Number(action.y);
      }
    }

    if (action.type === 'match_end') {
      replay.matchEndCount += 1;
      if (i !== actions.length - 1) pushEventError(`actionStream.actions[${i}]`, 'action_end_not_last', 'match_end должен быть последним action.');
      const data = action.data && typeof action.data === 'object' ? action.data : {};
      if (data.winner && data.winner !== result.winner) pushEventError(`actionStream.actions[${i}].data.winner`, 'action_end_winner_mismatch', 'winner в match_end не совпадает с результатом.');
      if (data.victory !== undefined && Boolean(data.victory) !== result.victory) pushEventError(`actionStream.actions[${i}].data.victory`, 'action_end_victory_mismatch', 'victory в match_end не совпадает с результатом.');
      if (data.durationSec !== undefined && Math.abs(Number(data.durationSec) - result.durationSec) > 2) pushEventError(`actionStream.actions[${i}].data.durationSec`, 'action_end_duration_mismatch', 'durationSec в match_end не совпадает с результатом.');
      if (hasPoint(action)) {
        replay.lastX = Number(action.x);
        replay.lastY = Number(action.y);
      }
    }

    if (action.type === 'action_stream_truncated') {
      replay.truncated = true;
      warnings.push({ code: 'action_stream_truncated', message: 'Клиентский action stream был усечён из-за лимита actions.' });
    }

    if (action.type === 'move') {
      replay.moveSamples += 1;
      const dx = Number(action.dx ?? 0);
      const dy = Number(action.dy ?? 0);
      const len = Math.hypot(dx, dy);
      if (!Number.isFinite(len) || len > 1.18) {
        pushEventError(`actionStream.actions[${i}].dx`, 'move_vector_invalid', 'Вектор движения должен быть нормализован.');
      }

      if (hasPoint(action)) {
        if (previousMove && Number.isFinite(t)) {
          const dtSec = Math.max(0.001, (t - previousMove.t) / 1000);
          const dist = distance(previousMove.x, previousMove.y, Number(action.x), Number(action.y));
          replay.sampledDistance += dist;
          const maxSegment = hero.speed * dtSec * 2.45 + 145 + mobilityBonusPending;
          if (dist > maxSegment) {
            pushEventError(
              `actionStream.actions[${i}]`,
              'move_segment_too_fast',
              `Перемещение между samples слишком быстрое: ${Math.round(dist)}px за ${Math.round(dtSec * 1000)}ms.`
            );
          }
          if (mobilityBonusPending > 0) replay.mobilityBudgetSpent += Math.min(mobilityBonusPending, Math.max(0, dist - hero.speed * dtSec));
          mobilityBonusPending = 0;
        }
        previousMove = { x: Number(action.x), y: Number(action.y), t };
        replay.lastX = Number(action.x);
        replay.lastY = Number(action.y);
      }
    }

    if (action.type === 'attack') {
      replay.attackCount += 1;
      replay.offensiveWeight += 1;
      if (Number.isFinite(t) && t - lastAttackT < hero.attackCooldown - 150) {
        pushEventError(`actionStream.actions[${i}]`, 'attack_cooldown_violation', 'Базовые атаки идут быстрее cooldown героя.');
      }
      lastAttackT = t;

      if (hasPoint(action) && hasTargetPoint(action)) {
        const dist = distance(Number(action.x), Number(action.y), Number(action.targetX), Number(action.targetY));
        if (dist > hero.attackRange + 210) {
          pushEventError(`actionStream.actions[${i}]`, 'attack_range_violation', `Цель атаки слишком далеко: ${Math.round(dist)}px.`);
        }
      }
    }

    if (action.type === 'cast') {
      const slot = String(action.slot ?? '');
      if (!allowedSlots.has(slot)) {
        pushEventError(`actionStream.actions[${i}].slot`, 'cast_slot_invalid', 'slot должен быть primary, secondary или ultimate.');
        continue;
      }

      const ability = hero.abilities[slot];
      replay.castCounts[slot] += 1;
      replay.totalCasts += 1;
      replay.offensiveWeight += ability.offensiveWeight;
      mobilityBonusPending += ability.mobilityBonus;

      if (Number.isFinite(t) && t - lastCastT[slot] < ability.cooldown - 220) {
        pushEventError(`actionStream.actions[${i}]`, 'cast_cooldown_violation', `${slot} используется быстрее cooldown героя.`);
      }
      lastCastT[slot] = t;

      if (hasPoint(action) && hasTargetPoint(action)) {
        const dist = distance(Number(action.x), Number(action.y), Number(action.targetX), Number(action.targetY));
        if (dist > ability.targetRange + 260) {
          pushEventError(`actionStream.actions[${i}]`, 'cast_range_violation', `Цель ${slot} слишком далеко: ${Math.round(dist)}px.`);
        }
      }
    }
  }

  if (replay.matchStartCount !== 1) {
    errors.push(fieldError('actionStream.actions', 'action_stream_start_count_invalid', 'Action stream должен содержать ровно один match_start.'));
  }

  if (replay.matchEndCount !== 1) {
    errors.push(fieldError('actionStream.actions', 'action_stream_end_count_invalid', 'Action stream должен содержать ровно один match_end.'));
  }

  const maxTotalDistance = hero.speed * result.durationSec * 1.9 + replay.totalCasts * 280 + 2200;
  if (replay.sampledDistance > maxTotalDistance) {
    errors.push(fieldError('actionStream.move', 'total_movement_too_high', `Суммарное перемещение по samples слишком большое: ${Math.round(replay.sampledDistance)}px.`));
  }

  if (result.durationSec > 20 && replay.moveSamples === 0) {
    warnings.push({ code: 'action_stream_no_movement', message: 'В action stream нет movement samples.' });
  }

  replay.budgets = calculateActionBudgets({
    durationSec: result.durationSec,
    attackCount: replay.attackCount,
    totalCasts: replay.totalCasts,
    offensiveWeight: replay.offensiveWeight,
    kills: result.kills,
    victory: result.victory
  });

  if (result.kills > replay.budgets.maxKills) {
    errors.push(fieldError('actionStream.kills', 'replay_kills_too_high_for_actions', `Kills=${result.kills} слишком много для ${replay.attackCount} атак и ${replay.totalCasts} cast actions.`));
  }

  if (result.gold > replay.budgets.maxGold) {
    errors.push(fieldError('actionStream.gold', 'replay_gold_too_high_for_actions', `Gold=${result.gold} слишком много для action replay budget (${Math.round(replay.budgets.maxGold)}).`));
  }

  if (result.level > Math.max(2, replay.budgets.maxLevel + 1)) {
    errors.push(fieldError('actionStream.level', 'replay_level_too_high_for_actions', `Level=${result.level} не подтверждается action replay budget.`));
  }

  return replay;
}

function validateActionSummary(summary, result, replay, errors, warnings) {
  if (!summary || typeof summary !== 'object') {
    errors.push(fieldError('actionStream.summary', 'action_stream_summary_missing', 'actionStream.summary обязателен.'));
    return;
  }

  if (Math.abs(Number(summary.durationSec) - result.durationSec) > 2) {
    errors.push(fieldError('actionStream.summary.durationSec', 'action_summary_duration_mismatch', 'summary.durationSec не совпадает с результатом.'));
  }

  if (Number(summary.moveSamples) !== replay.moveSamples) {
    errors.push(fieldError('actionStream.summary.moveSamples', 'action_summary_move_count_mismatch', 'summary.moveSamples не совпадает с количеством move actions.'));
  }

  if (Number(summary.attackCount) !== replay.attackCount) {
    errors.push(fieldError('actionStream.summary.attackCount', 'action_summary_attack_count_mismatch', 'summary.attackCount не совпадает с количеством attack actions.'));
  }

  const summaryCastCounts = summary.castCounts && typeof summary.castCounts === 'object' ? summary.castCounts : {};
  for (const slot of ['primary', 'secondary', 'ultimate']) {
    if (Number(summaryCastCounts[slot] ?? 0) !== replay.castCounts[slot]) {
      errors.push(fieldError(`actionStream.summary.castCounts.${slot}`, 'action_summary_cast_count_mismatch', `summary.castCounts.${slot} не совпадает с action stream.`));
    }
  }

  if (Boolean(summary.truncated) !== replay.truncated) {
    warnings.push({ code: 'action_summary_truncated_mismatch', message: 'summary.truncated не совпадает с наличием action_stream_truncated.' });
  }

  if (replay.lastX !== null && Number.isFinite(Number(summary.lastX))) {
    const endDist = distance(Number(summary.lastX), Number(summary.lastY), replay.lastX, replay.lastY);
    if (endDist > 8) {
      errors.push(fieldError('actionStream.summary.lastX', 'action_summary_position_mismatch', 'summary.lastX/lastY не совпадают с последним action position.'));
    }
  }
}

function validateEventLogBridge(eventLog, replay, errors, warnings) {
  if (!eventLog || !Array.isArray(eventLog.events)) return;

  const truncated = eventLog.events.some((event) => event?.type === 'event_log_truncated') || replay.truncated;
  if (truncated) {
    warnings.push({ code: 'replay_bridge_skipped_for_truncated_log', message: 'Строгая сверка event-log/action-stream пропущена из-за усечения.' });
    return;
  }

  let eventAttackCount = 0;
  const eventCastCounts = { primary: 0, secondary: 0, ultimate: 0 };

  for (const event of eventLog.events) {
    if (event?.actor?.controller !== 'player') continue;
    if (event.type === 'attack') eventAttackCount += 1;
    if (event.type === 'cast' && event.slot in eventCastCounts) eventCastCounts[event.slot] += 1;
  }

  if (eventAttackCount !== replay.attackCount) {
    errors.push(fieldError('actionStream.attackCount', 'action_event_attack_count_mismatch', 'Количество attack actions не совпадает с event-log attack events.'));
  }

  for (const slot of ['primary', 'secondary', 'ultimate']) {
    if (eventCastCounts[slot] !== replay.castCounts[slot]) {
      errors.push(fieldError(`actionStream.castCounts.${slot}`, 'action_event_cast_count_mismatch', `Количество ${slot} casts не совпадает с event-log.`));
    }
  }
}

function validateCoordinates(action, index, pushEventError) {
  for (const [field, limit] of [['x', MAP_RULES.width], ['targetX', MAP_RULES.width]]) {
    if (action[field] === undefined) continue;
    const value = Number(action[field]);
    if (!Number.isFinite(value) || value < -80 || value > limit + 80) {
      pushEventError(`actionStream.actions[${index}].${field}`, 'coordinate_x_invalid', `${field} вне карты.`);
    }
  }

  for (const [field, limit] of [['y', MAP_RULES.height], ['targetY', MAP_RULES.height]]) {
    if (action[field] === undefined) continue;
    const value = Number(action[field]);
    if (!Number.isFinite(value) || value < -80 || value > limit + 80) {
      pushEventError(`actionStream.actions[${index}].${field}`, 'coordinate_y_invalid', `${field} вне карты.`);
    }
  }
}

function hasPoint(action) {
  return Number.isFinite(Number(action.x)) && Number.isFinite(Number(action.y));
}

function hasTargetPoint(action) {
  return Number.isFinite(Number(action.targetX)) && Number.isFinite(Number(action.targetY));
}

function distance(x1, y1, x2, y2) {
  return Math.hypot(x2 - x1, y2 - y1);
}

function replaySecret() {
  return process.env.MATCH_REPLAY_SECRET || DEV_REPLAY_SECRET;
}

function safeEqualString(a, b) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function fieldError(field, code, message) {
  return { field, code, message };
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
