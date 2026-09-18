export const EVENT_LOG_VERSION = 'client-event-log-v1';
export const ACTION_STREAM_VERSION = 'client-action-stream-v1';
export const SERVER_RESULT_SOURCE = 'server-calculated-v1';
export const AUTHORITATIVE_RESULT_SOURCE = 'authoritative-sim-v1';

export const MAP_RULES = Object.freeze({
  width: 2200,
  height: 1200,
  playerSpawn: Object.freeze({ x: 320, y: 570 })
});

export const SIMULATION_RULES = Object.freeze({
  tickMs: 100,
  maxDurationSec: 20 * 60,
  waveIntervalMs: 18_000,
  respawnMs: 8_000,
  tower: Object.freeze({ hp: 1350, damage: 92, range: 340, attackCooldown: 1180, radius: 43 }),
  core: Object.freeze({ hp: 3300, radius: 70 }),
  minion: Object.freeze({ hp: 235, damage: 24, range: 70, speed: 118, attackCooldown: 930, radius: 17 }),
  projectileGracePx: 50
});

export const LANE_PATH = Object.freeze([
  Object.freeze({ x: 250, y: 610 }),
  Object.freeze({ x: 560, y: 610 }),
  Object.freeze({ x: 900, y: 550 }),
  Object.freeze({ x: 1110, y: 600 }),
  Object.freeze({ x: 1370, y: 650 }),
  Object.freeze({ x: 1680, y: 610 }),
  Object.freeze({ x: 1980, y: 600 })
]);

export const RED_LANE_PATH = Object.freeze([...LANE_PATH].reverse().map((point) => Object.freeze({ ...point })));

export const COMBAT_HERO_RULES = Object.freeze({
  kairo: Object.freeze({
    id: 'kairo',
    name: 'Кайро',
    maxHp: 980,
    damage: 64,
    speed: 242,
    attackCooldown: 620,
    attackRange: 92,
    radius: 28,
    abilities: Object.freeze({
      primary: Object.freeze({ cooldown: 4200, targetRange: 360, mobilityBonus: 240, offensiveWeight: 1.35 }),
      secondary: Object.freeze({ cooldown: 6200, targetRange: 220, mobilityBonus: 0, offensiveWeight: 1.75 }),
      ultimate: Object.freeze({ cooldown: 18500, targetRange: 220, mobilityBonus: 0, offensiveWeight: 2.1 })
    })
  }),
  reyna: Object.freeze({
    id: 'reyna',
    name: 'Рэйна',
    maxHp: 720,
    damage: 82,
    speed: 282,
    attackCooldown: 560,
    attackRange: 105,
    radius: 28,
    abilities: Object.freeze({
      primary: Object.freeze({ cooldown: 3600, targetRange: 300, mobilityBonus: 0, offensiveWeight: 1.55 }),
      secondary: Object.freeze({ cooldown: 5600, targetRange: 340, mobilityBonus: 250, offensiveWeight: 1.15 }),
      ultimate: Object.freeze({ cooldown: 17000, targetRange: 360, mobilityBonus: 0, offensiveWeight: 2.8 })
    })
  }),
  teo: Object.freeze({
    id: 'teo',
    name: 'Тэо',
    maxHp: 650,
    damage: 58,
    speed: 236,
    attackCooldown: 760,
    attackRange: 270,
    radius: 28,
    abilities: Object.freeze({
      primary: Object.freeze({ cooldown: 3300, targetRange: 540, mobilityBonus: 0, offensiveWeight: 1.35 }),
      secondary: Object.freeze({ cooldown: 7200, targetRange: 500, mobilityBonus: 0, offensiveWeight: 1.75 }),
      ultimate: Object.freeze({ cooldown: 20500, targetRange: 620, mobilityBonus: 0, offensiveWeight: 2.4 })
    })
  })
});

export const ECONOMY_RULES = Object.freeze({
  rewards: Object.freeze({
    hero: Object.freeze({ gold: 160, xp: 110 }),
    tower: Object.freeze({ gold: 260, xp: 150 }),
    core: Object.freeze({ gold: 500, xp: 250 }),
    minion: Object.freeze({ gold: 34, xp: 28 })
  }),
  maxLevel: 8,
  levelXpMultiplier: 150
});

export function heroRuleById(heroId) {
  return COMBAT_HERO_RULES[heroId] ?? COMBAT_HERO_RULES.kairo;
}

export function rewardForDefeat(kind) {
  return ECONOMY_RULES.rewards[kind] ?? ECONOMY_RULES.rewards.minion;
}

export function nextLevelXp(level) {
  return Math.max(1, Math.floor(Number(level) || 1)) * ECONOMY_RULES.levelXpMultiplier;
}

export function calculateActionBudgets({ durationSec, attackCount, totalCasts, offensiveWeight, kills, victory }) {
  const duration = Math.max(0, Number(durationSec) || 0);
  const attacks = Math.max(0, Number(attackCount) || 0);
  const casts = Math.max(0, Number(totalCasts) || 0);
  const weight = Math.max(0, Number(offensiveWeight) || 0);
  const killCount = Math.max(0, Number(kills) || 0);

  const maxKills = Math.floor(weight * 1.45) + Math.floor(duration / 45) + 1;
  const maxGold = 520 + duration * 24 + attacks * 90 + casts * 170 + killCount * 240 + (victory ? 900 : 0);
  const earnedXpBudget = attacks * 24 + casts * 70 + killCount * 130 + maxGold * 0.18 + (victory ? 250 : 0);
  const maxLevel = Math.min(ECONOMY_RULES.maxLevel, 1 + Math.floor(earnedXpBudget / 170));

  return {
    maxKills,
    maxGold,
    earnedXpBudget,
    maxLevel
  };
}

export function createInitialCombatState({ heroId = 'kairo', seed = 1, tutorial = false } = {}) {
  const state = {
    seed: normalizeSeed(seed),
    heroId,
    tutorial: Boolean(tutorial),
    rng: createRng(seed),
    timeMs: 0,
    actorSeq: 0,
    projectileSeq: 0,
    zoneSeq: 0,
    delayedSeq: 0,
    combatEventSeq: 0,
    actors: [],
    projectiles: [],
    zones: [],
    delayed: [],
    combatEvents: [],
    kills: { blue: 0, red: 0 },
    winner: null,
    endedAtMs: null,
    nextWaveAt: 0,
    playerId: null,
    playerInput: { dx: 0, dy: 0 },
    stats: {
      wavesSpawned: 0,
      projectilesSpawned: 0,
      zonesCreated: 0,
      damageEvents: 0,
      objectiveEvents: 0,
      actionsApplied: 0,
      botActions: 0,
      minionActions: 0,
      towerActions: 0
    }
  };

  if (state.tutorial) {
    createTutorialStructures(state);
    createTutorialTeam(state, heroId);
    state.nextWaveAt = Number.POSITIVE_INFINITY;
  } else {
    createStructures(state);
    createTeams(state, heroId);
    spawnWave(state);
    state.nextWaveAt = SIMULATION_RULES.waveIntervalMs;
  }
  return state;
}

export function applyCombatActions(state, actions = []) {
  for (const action of normalizeActions(actions)) applyPlayerAction(state, action);
  return renderCombatSnapshot(state);
}

export function stepCombatState(state, actions = []) {
  if (!state.winner) state.timeMs += SIMULATION_RULES.tickMs;
  runCombatTick(state, actions);
  return renderCombatSnapshot(state);
}

export function renderCombatSnapshot(state) {
  return {
    source: AUTHORITATIVE_RESULT_SOURCE,
    seed: state.seed,
    heroId: state.heroId,
    tutorial: Boolean(state.tutorial),
    timeMs: state.timeMs,
    winner: state.winner,
    endedAtMs: state.endedAtMs,
    kills: { ...state.kills },
    playerId: state.playerId,
    stateHash: stableHash(canonicalStringify(snapshotCombatState(state))),
    result: deriveSimulationResult(state, state.heroId, Math.max(0, Math.floor(state.timeMs / 1000))),
    actors: state.actors.map(publicActorSnapshot).sort((a, b) => a.id.localeCompare(b.id)),
    projectiles: state.projectiles.map((projectile) => ({
      id: projectile.id,
      team: projectile.team,
      x: Math.round(projectile.x),
      y: Math.round(projectile.y),
      radius: projectile.radius
    })).sort((a, b) => a.id.localeCompare(b.id)),
    zones: state.zones.map((zone) => ({
      id: zone.id,
      team: zone.team,
      x: Math.round(zone.x),
      y: Math.round(zone.y),
      radius: zone.radius,
      slow: zone.slow
    })).sort((a, b) => a.id.localeCompare(b.id)),
    events: state.combatEvents.slice(),
    stats: { ...state.stats },
    objectives: objectiveSnapshot(state)
  };
}

export function simulateCombat({ heroId = 'kairo', seed = 1, actions = [], durationSec = 0, maxDurationSec = SIMULATION_RULES.maxDurationSec, tutorial = false } = {}) {
  const state = createInitialCombatState({ heroId, seed, tutorial });
  const normalizedActions = normalizeActions(actions);
  const requestedDurationSec = clampInt(durationSec, 0, maxDurationSec);
  const actionEndMs = normalizedActions.length > 0 ? Math.max(...normalizedActions.map((action) => finiteNumber(action.t, 0))) : 0;
  const durationMs = Math.min(maxDurationSec * 1000, Math.max(requestedDurationSec * 1000, actionEndMs));
  const warnings = [];
  const errors = [];

  const replayEndMs = Math.min(
    maxDurationSec * 1000,
    Math.ceil(durationMs / SIMULATION_RULES.tickMs) * SIMULATION_RULES.tickMs
  );
  let actionIndex = 0;
  while (state.timeMs < replayEndMs) {
    const nextTickMs = state.timeMs + SIMULATION_RULES.tickMs;
    const tickActions = [];
    while (actionIndex < normalizedActions.length && normalizedActions[actionIndex].t <= nextTickMs) {
      tickActions.push(normalizedActions[actionIndex]);
      actionIndex += 1;
    }
    stepCombatState(state, tickActions);
    if (state.winner) break;
  }

  const result = deriveSimulationResult(state, heroId, requestedDurationSec);
  const stateHash = stableHash(canonicalStringify(snapshotCombatState(state)));

  if (!result.terminal) {
    warnings.push({
      code: 'authoritative_sim_not_terminal',
      message: 'Deterministic simulation completed without core destruction; result derived from objective HP snapshot.'
    });
  }

  return {
    ok: errors.length === 0,
    source: AUTHORITATIVE_RESULT_SOURCE,
    errors,
    warnings,
    result,
    stateHash,
    stats: { ...state.stats },
    objectiveState: objectiveSnapshot(state)
  };
}

function runCombatTick(state, actions = []) {
  if (state.winner) return;

  for (const action of normalizeActions(actions)) applyPlayerAction(state, action);

  if (!state.tutorial && state.timeMs >= state.nextWaveAt) {
    spawnWave(state);
    state.nextWaveAt = state.timeMs + SIMULATION_RULES.waveIntervalMs;
  }

  processDelayed(state);
  updateRespawns(state);
  updatePlayerMovement(state, SIMULATION_RULES.tickMs / 1000);

  for (const actor of [...state.actors]) {
    if (state.winner) break;
    if (actor.dead) continue;
    if (actor.controller === 'bot') updateBotHero(state, actor, SIMULATION_RULES.tickMs / 1000);
    if (actor.controller === 'minion') updateMinion(state, actor, SIMULATION_RULES.tickMs / 1000);
    if (actor.controller === 'tower') updateTower(state, actor);
  }

  updateProjectiles(state, SIMULATION_RULES.tickMs / 1000);
  updateZones(state);
  cleanupCombatObjects(state);
}

function createStructures(state) {
  createStructure(state, 'blue', 'core', 'Синее ядро', 190, 600, SIMULATION_RULES.core.radius, SIMULATION_RULES.core.hp, 0, 0, 0, 0);
  createStructure(state, 'red', 'core', 'Красное ядро', 2010, 600, SIMULATION_RULES.core.radius, SIMULATION_RULES.core.hp, 0, 0, 0, 0);
  createStructure(state, 'blue', 'tower', 'Башня B1', 560, 610, SIMULATION_RULES.tower.radius, SIMULATION_RULES.tower.hp, SIMULATION_RULES.tower.damage, SIMULATION_RULES.tower.range, 0, SIMULATION_RULES.tower.attackCooldown);
  createStructure(state, 'blue', 'tower', 'Башня B2', 850, 558, SIMULATION_RULES.tower.radius, SIMULATION_RULES.tower.hp, SIMULATION_RULES.tower.damage, SIMULATION_RULES.tower.range, 0, SIMULATION_RULES.tower.attackCooldown);
  createStructure(state, 'red', 'tower', 'Башня R1', 1640, 610, SIMULATION_RULES.tower.radius, SIMULATION_RULES.tower.hp, SIMULATION_RULES.tower.damage, SIMULATION_RULES.tower.range, 0, SIMULATION_RULES.tower.attackCooldown);
  createStructure(state, 'red', 'tower', 'Башня R2', 1350, 642, SIMULATION_RULES.tower.radius, SIMULATION_RULES.tower.hp, SIMULATION_RULES.tower.damage, SIMULATION_RULES.tower.range, 0, SIMULATION_RULES.tower.attackCooldown);
}

function createTutorialStructures(state) {
  const blueCore = createStructure(state, 'blue', 'core', 'Учебное синее ядро', 190, 600, SIMULATION_RULES.core.radius, 9999, 0, 0, 0, 0);
  blueCore.tutorialTag = 'safe-core';

  const redCore = createStructure(state, 'red', 'core', 'Учебное красное ядро', 1540, 600, SIMULATION_RULES.core.radius, 420, 0, 0, 0, 0);
  redCore.tutorialTag = 'core';

  const tower = createStructure(state, 'red', 'tower', 'Учебная башня', 1120, 642, SIMULATION_RULES.tower.radius, 320, 0, 0, 0, SIMULATION_RULES.tower.attackCooldown);
  tower.tutorialTag = 'tower';
}

function createTutorialTeam(state, selectedHeroId) {
  const selectedHero = heroRuleById(selectedHeroId);
  const player = createHero(state, selectedHero, 'blue', MAP_RULES.playerSpawn.x, MAP_RULES.playerSpawn.y, 'player');
  state.playerId = player.id;
  player.tutorialTag = 'player';
  player.maxHp += 420;
  player.hp = player.maxHp;
  player.damage += 18;

  const dummy = createHero(state, COMBAT_HERO_RULES.reyna, 'red', 650, 570, 'structure');
  dummy.name = 'Манекен';
  dummy.tutorialTag = 'dummy';
  dummy.maxHp = 420;
  dummy.hp = 420;
  dummy.damage = 0;
  dummy.speed = 0;
  dummy.range = 0;
  dummy.attackCooldown = 999999;
  dummy.abilityReadyAt = { primary: Number.POSITIVE_INFINITY, secondary: Number.POSITIVE_INFINITY, ultimate: Number.POSITIVE_INFINITY };
}

function createTeams(state, selectedHeroId) {
  const selectedHero = heroRuleById(selectedHeroId);
  const player = createHero(state, selectedHero, 'blue', MAP_RULES.playerSpawn.x, MAP_RULES.playerSpawn.y, 'player');
  state.playerId = player.id;

  const allyPool = Object.values(COMBAT_HERO_RULES).filter((hero) => hero.id !== selectedHero.id);
  createHero(state, allyPool[0] ?? COMBAT_HERO_RULES.reyna, 'blue', 270, 660, 'bot');
  createHero(state, allyPool[1] ?? COMBAT_HERO_RULES.teo, 'blue', 300, 500, 'bot');

  createHero(state, COMBAT_HERO_RULES.kairo, 'red', 1880, 570, 'bot');
  createHero(state, COMBAT_HERO_RULES.reyna, 'red', 1930, 660, 'bot');
  createHero(state, COMBAT_HERO_RULES.teo, 'red', 1900, 500, 'bot');
}

function createStructure(state, team, kind, name, x, y, radius, hp, damage, range, speed, attackCooldown) {
  const actor = {
    id: `${kind}-${team}-${state.actorSeq++}`,
    team,
    kind,
    controller: kind === 'tower' ? 'tower' : 'structure',
    name,
    heroId: undefined,
    x,
    y,
    spawnX: x,
    spawnY: y,
    radius,
    maxHp: hp,
    hp,
    damage,
    range,
    speed,
    attackCooldown,
    lastAttack: -999999,
    abilityReadyAt: undefined,
    dead: false,
    level: 1,
    xp: 0,
    gold: 0,
    kills: 0,
    deaths: 0,
    respawnAt: null,
    pathIndex: 0,
    nextThinkAt: 0,
    stunnedUntil: 0,
    auraUntil: 0,
    shield: 0,
    slowUntil: 0,
    tutorialTag: undefined
  };
  state.actors.push(actor);
  return actor;
}

function createHero(state, hero, team, x, y, controller) {
  const actor = {
    id: `hero-${team}-${hero.id}-${state.actorSeq++}`,
    team,
    kind: 'hero',
    controller,
    name: hero.name,
    heroId: hero.id,
    x,
    y,
    spawnX: x,
    spawnY: y,
    radius: hero.radius,
    maxHp: hero.maxHp,
    hp: hero.maxHp,
    damage: hero.damage,
    range: hero.attackRange,
    speed: hero.speed,
    attackCooldown: hero.attackCooldown,
    lastAttack: -999999,
    abilityReadyAt: { primary: 0, secondary: 0, ultimate: 0 },
    dead: false,
    level: 1,
    xp: 0,
    gold: 0,
    kills: 0,
    deaths: 0,
    respawnAt: null,
    pathIndex: team === 'blue' ? 1 : 1,
    nextThinkAt: seededOffset(state, `${team}:${hero.id}:${controller}`, 340, 760),
    stunnedUntil: 0,
    auraUntil: 0,
    shield: 0,
    slowUntil: 0,
    targetId: null,
    tutorialTag: undefined
  };
  state.actors.push(actor);
  return actor;
}

function createMinion(state, team, x, y, waveOffset) {
  const actor = {
    id: `minion-${team}-${state.actorSeq++}`,
    team,
    kind: 'minion',
    controller: 'minion',
    name: `${team === 'blue' ? 'Синий' : 'Красный'} миньон`,
    heroId: undefined,
    x,
    y: y + waveOffset,
    spawnX: x,
    spawnY: y + waveOffset,
    radius: SIMULATION_RULES.minion.radius,
    maxHp: SIMULATION_RULES.minion.hp,
    hp: SIMULATION_RULES.minion.hp,
    damage: SIMULATION_RULES.minion.damage,
    range: SIMULATION_RULES.minion.range,
    speed: SIMULATION_RULES.minion.speed,
    attackCooldown: SIMULATION_RULES.minion.attackCooldown,
    lastAttack: -999999,
    abilityReadyAt: undefined,
    dead: false,
    level: 1,
    xp: 0,
    gold: 0,
    kills: 0,
    deaths: 0,
    respawnAt: null,
    pathIndex: 1,
    nextThinkAt: 0,
    stunnedUntil: 0,
    auraUntil: 0,
    shield: 0,
    slowUntil: 0,
    tutorialTag: undefined
  };
  state.actors.push(actor);
  return actor;
}

function spawnWave(state) {
  for (let i = 0; i < 4; i += 1) {
    createMinion(state, 'blue', 260 - i * 22, 610, (i - 1.5) * 20);
    createMinion(state, 'red', 1940 + i * 22, 600, (i - 1.5) * 20);
  }
  state.stats.wavesSpawned += 1;
}

function applyPlayerAction(state, action) {
  const player = getPlayer(state);
  if (!player || player.dead) return;

  if (action.type === 'match_end') {
    emitCombatEvent(state, 'match_end', {
      actor: actorEventSnapshot(player),
      x: Math.round(player.x),
      y: Math.round(player.y),
      data: action.data ?? {}
    });
    return;
  }

  state.stats.actionsApplied += 1;

  if (action.type === 'match_start') {
    state.playerInput = { dx: 0, dy: 0 };
    emitCombatEvent(state, 'match_start', {
      actor: actorEventSnapshot(player),
      x: Math.round(player.x),
      y: Math.round(player.y),
      data: action.data ?? {}
    });
    return;
  }

  if (action.type === 'move') {
    const dx = finiteNumber(action.dx, 0);
    const dy = finiteNumber(action.dy, 0);
    const len = Math.hypot(dx, dy);
    if (len <= 0.05) {
      state.playerInput = { dx: 0, dy: 0 };
    } else {
      state.playerInput = { dx: dx / len, dy: dy / len };
    }
    emitCombatEvent(state, 'move', {
      actor: actorEventSnapshot(player),
      x: Math.round(player.x),
      y: Math.round(player.y),
      data: { dx: Math.round(state.playerInput.dx * 1000) / 1000, dy: Math.round(state.playerInput.dy * 1000) / 1000 }
    });
    return;
  }

  if (action.type === 'attack') {
    const target = resolveActionTarget(state, player, action, player.range + 90, true);
    emitCombatEvent(state, 'attack', {
      actor: actorEventSnapshot(player),
      target: target ? actorEventSnapshot(target) : undefined,
      x: Math.round(player.x),
      y: Math.round(player.y),
      targetX: target ? Math.round(target.x) : undefined,
      targetY: target ? Math.round(target.y) : undefined
    });
    if (target) basicAttack(state, player, target);
    return;
  }

  if (action.type === 'cast') {
    const target = resolveActionTarget(state, player, action, 620, true);
    emitCombatEvent(state, 'cast', {
      actor: actorEventSnapshot(player),
      target: target ? actorEventSnapshot(target) : undefined,
      slot: String(action.slot ?? ''),
      x: Math.round(player.x),
      y: Math.round(player.y),
      targetX: target ? Math.round(target.x) : undefined,
      targetY: target ? Math.round(target.y) : undefined
    });
    castAbility(state, player, String(action.slot ?? ''), action, true);
  }
}

function updatePlayerMovement(state, dt) {
  const player = getPlayer(state);
  if (!player || player.dead) return;
  if (player.stunnedUntil > state.timeMs) return;
  const { dx, dy } = state.playerInput;
  if (Math.hypot(dx, dy) <= 0.05) return;
  moveActor(state, player, dx, dy, dt);
}

function updateBotHero(state, actor, dt) {
  if (actor.stunnedUntil > state.timeMs) return;
  const lowHp = actor.hp / actor.maxHp < 0.28;
  const nearestDanger = getNearestEnemy(state, actor, 520, true);

  if (lowHp && nearestDanger) {
    const retreatPoint = actor.team === 'blue' ? LANE_PATH[0] : RED_LANE_PATH[0];
    moveToward(state, actor, retreatPoint.x, retreatPoint.y, dt);
    if (distanceActors(actor, nearestDanger) < actor.range) basicAttack(state, actor, nearestDanger);
    state.stats.botActions += 1;
    return;
  }

  const target = chooseBestTarget(state, actor, 520);
  if (target) {
    const dist = distanceActors(actor, target);
    if (dist > actor.range * 0.82) moveToward(state, actor, target.x, target.y, dt);
    else basicAttack(state, actor, target);

    if (actor.nextThinkAt <= state.timeMs) {
      tryBotCast(state, actor, target);
      actor.nextThinkAt = state.timeMs + seededOffset(state, actor.id, 520, 980);
    }
    state.stats.botActions += 1;
    return;
  }

  const point = actor.team === 'blue' ? { x: 1900, y: 600 } : { x: 300, y: 600 };
  const laneOffset = seededOffset(state, actor.id, -30, 30);
  moveToward(state, actor, point.x, point.y + laneOffset, dt);
  state.stats.botActions += 1;
}

function tryBotCast(state, actor, target) {
  const dist = distanceActors(actor, target);
  const hpPct = target.hp / target.maxHp;
  if (actor.abilityReadyAt?.ultimate !== undefined && actor.abilityReadyAt.ultimate <= state.timeMs) {
    if (hpPct < 0.48 || countEnemiesNear(state, actor.team, actor.x, actor.y, 270) >= 2) {
      castAbility(state, actor, 'ultimate', undefined, false);
      return;
    }
  }
  if (actor.abilityReadyAt?.secondary !== undefined && actor.abilityReadyAt.secondary <= state.timeMs && dist < 330) {
    castAbility(state, actor, 'secondary', undefined, false);
    return;
  }
  if (actor.abilityReadyAt?.primary !== undefined && actor.abilityReadyAt.primary <= state.timeMs && dist < 360) {
    castAbility(state, actor, 'primary', undefined, false);
  }
}

function updateMinion(state, actor, dt) {
  const target = chooseBestTarget(state, actor, 260);
  if (target) {
    const dist = distanceActors(actor, target);
    if (dist > actor.range * 0.88) moveToward(state, actor, target.x, target.y, dt);
    else basicAttack(state, actor, target);
    state.stats.minionActions += 1;
    return;
  }

  const path = actor.team === 'blue' ? LANE_PATH : RED_LANE_PATH;
  const idx = Math.min(actor.pathIndex ?? 1, path.length - 1);
  const waypoint = path[idx];
  moveToward(state, actor, waypoint.x, waypoint.y, dt);
  if (distance(actor.x, actor.y, waypoint.x, waypoint.y) < 36) actor.pathIndex = Math.min(idx + 1, path.length - 1);

  const enemyCore = state.actors.find((candidate) => candidate.kind === 'core' && candidate.team !== actor.team && !candidate.dead);
  if (enemyCore && distanceActors(actor, enemyCore) < actor.range + enemyCore.radius) basicAttack(state, actor, enemyCore);
  state.stats.minionActions += 1;
}

function updateTower(state, actor) {
  const target = chooseBestTarget(state, actor, actor.range);
  if (!target) return;
  if (state.timeMs < actor.lastAttack + actor.attackCooldown) return;
  actor.lastAttack = state.timeMs;
  spawnProjectile(state, actor, target.x, target.y, actor.damage, 560, 9, 1300);
  state.stats.towerActions += 1;
}

function basicAttack(state, source, target) {
  if (source.dead || target.dead) return false;
  if (state.timeMs < source.lastAttack + source.attackCooldown) return false;
  if (distanceActors(source, target) > source.range + source.radius + target.radius + 12) return false;

  source.lastAttack = state.timeMs;
  const auraBonus = source.auraUntil > state.timeMs ? 1.35 : 1;
  const levelBonus = 1 + (source.level - 1) * 0.06;
  const damageAmount = Math.round(source.damage * auraBonus * levelBonus);

  if (source.range > 150 || source.kind === 'tower') {
    spawnProjectile(state, source, target.x, target.y, damageAmount, source.kind === 'tower' ? 560 : 470, 8);
  } else {
    dealDamage(state, source, target, damageAmount);
  }
  return true;
}

function castAbility(state, actor, slot, action, manual) {
  if (actor.dead || actor.kind !== 'hero' || !actor.heroId || !actor.abilityReadyAt) return false;
  if (!['primary', 'secondary', 'ultimate'].includes(slot)) return false;
  const hero = heroRuleById(actor.heroId);
  const ability = hero.abilities[slot];
  if (!ability || actor.abilityReadyAt[slot] > state.timeMs) return false;

  actor.abilityReadyAt[slot] = state.timeMs + ability.cooldown;

  if (hero.id === 'kairo') castKairo(state, actor, slot, action);
  if (hero.id === 'reyna') castReyna(state, actor, slot, action);
  if (hero.id === 'teo') castTeo(state, actor, slot, action);
  if (manual) state.stats.actionsApplied += 0;
  return true;
}

function castKairo(state, actor, slot, action) {
  if (slot === 'primary') {
    const dir = directionForAbility(state, actor, 320, action);
    const start = { x: actor.x, y: actor.y };
    placeActor(state, actor, actor.x + dir.x * 210, actor.y + dir.y * 210);
    damageEnemiesInLine(state, actor, start, { x: actor.x, y: actor.y }, 62 + actor.damage * 0.75, 62);
  }

  if (slot === 'secondary') {
    damageEnemiesInRadius(state, actor, actor.x, actor.y, 122, 96 + actor.damage * 0.9);
  }

  if (slot === 'ultimate') {
    actor.auraUntil = state.timeMs + 6000;
  }
}

function castReyna(state, actor, slot, action) {
  if (slot === 'primary') {
    const dir = directionForAbility(state, actor, 260, action);
    const origin = { x: actor.x, y: actor.y };
    const end = { x: origin.x + dir.x * 150, y: origin.y + dir.y * 150 };
    damageEnemiesInLine(state, actor, origin, end, 92 + actor.damage * 0.72, 74);
  }

  if (slot === 'secondary') {
    const target = resolveActionTarget(state, actor, action, 280, true) ?? getNearestEnemy(state, actor, 280, true);
    if (target) {
      const dir = normalizedVector(target.x - actor.x, target.y - actor.y, actor.team === 'blue' ? 1 : -1, 0);
      placeActor(state, actor, target.x - dir.x * 46, target.y - dir.y * 46);
      dealDamage(state, actor, target, 62 + actor.damage * 0.58);
    } else {
      const dir = directionForAbility(state, actor, 260, action);
      placeActor(state, actor, actor.x + dir.x * 190, actor.y + dir.y * 190);
    }
  }

  if (slot === 'ultimate') {
    const enemies = getEnemiesInRadius(state, actor.team, actor.x, actor.y, 295)
      .filter((enemy) => enemy.kind !== 'core')
      .slice(0, 5);
    enemies.forEach((enemy, index) => {
      scheduleDelayed(state, state.timeMs + index * 120, 'damage', {
        sourceId: actor.id,
        targetId: enemy.id,
        amount: 106 + actor.damage * 0.5
      });
    });
  }
}

function castTeo(state, actor, slot, action) {
  if (slot === 'primary') {
    const target = resolveActionTarget(state, actor, action, 420, true) ?? getNearestEnemy(state, actor, 420, true);
    const dir = target
      ? normalizedVector(target.x - actor.x, target.y - actor.y, actor.team === 'blue' ? 1 : -1, 0)
      : directionForAbility(state, actor, 320, action);
    spawnProjectile(state, actor, actor.x + dir.x * 420, actor.y + dir.y * 420, 118 + actor.damage * 0.55, 620, 12, 1050);
  }

  if (slot === 'secondary') {
    const target = resolveActionTarget(state, actor, action, 380, true) ?? getNearestEnemy(state, actor, 380, true);
    const fallback = directionForAbility(state, actor, 300, action);
    const x = target ? target.x : actor.x + fallback.x * 250;
    const y = target ? target.y : actor.y + fallback.y * 250;
    createZone(state, actor, x, y, 125, 38 + actor.damage * 0.18, 4700, 650, true);
  }

  if (slot === 'ultimate') {
    const target = resolveActionTarget(state, actor, action, 520, true) ?? getNearestEnemy(state, actor, 520, true);
    const fallback = directionForAbility(state, actor, 420, action);
    const x = target ? target.x : actor.x + fallback.x * 320;
    const y = target ? target.y : actor.y + fallback.y * 320;
    scheduleDelayed(state, state.timeMs + 780, 'radiusDamage', {
      sourceId: actor.id,
      x,
      y,
      radius: 186,
      amount: 176 + actor.damage * 0.96
    });
  }
}

function directionForAbility(state, actor, searchRange, action) {
  if (action && Number.isFinite(Number(action.targetX)) && Number.isFinite(Number(action.targetY))) {
    return normalizedVector(Number(action.targetX) - actor.x, Number(action.targetY) - actor.y, actor.team === 'blue' ? 1 : -1, 0);
  }

  const target = getNearestEnemy(state, actor, searchRange, true);
  if (target) return normalizedVector(target.x - actor.x, target.y - actor.y, actor.team === 'blue' ? 1 : -1, 0);
  if (actor.controller === 'player' && Math.hypot(state.playerInput.dx, state.playerInput.dy) > 0.01) return { ...state.playerInput };
  return { x: actor.team === 'blue' ? 1 : -1, y: 0 };
}

function moveActor(state, actor, dx, dy, dt) {
  if (actor.stunnedUntil > state.timeMs) return;
  const slow = actor.slowUntil > state.timeMs ? 0.62 : 1;
  const speed = actor.speed * slow;
  placeActor(state, actor, actor.x + dx * speed * dt, actor.y + dy * speed * dt);
}

function moveToward(state, actor, x, y, dt) {
  const dir = normalizedVector(x - actor.x, y - actor.y, 0, 0);
  if (Math.hypot(dir.x, dir.y) <= 0.01) return;
  moveActor(state, actor, dir.x, dir.y, dt);
}

function placeActor(state, actor, x, y) {
  actor.x = clampNumber(x, actor.radius, MAP_RULES.width - actor.radius);
  actor.y = clampNumber(y, actor.radius, MAP_RULES.height - actor.radius);
}

function chooseBestTarget(state, actor, range) {
  const enemies = state.actors.filter((candidate) => {
    if (candidate.dead || candidate.team === actor.team) return false;
    if (candidate.kind === 'core') {
      const enemyTowersAlive = state.actors.some((a) => a.team === candidate.team && a.kind === 'tower' && !a.dead);
      if (enemyTowersAlive) return false;
    }
    return distanceActors(actor, candidate) <= range + candidate.radius;
  });

  if (enemies.length === 0) return undefined;
  return enemies.sort((a, b) => targetPriority(state, actor, b) - targetPriority(state, actor, a) || a.id.localeCompare(b.id))[0];
}

function targetPriority(state, actor, target) {
  let value = 0;
  if (target.kind === 'hero') value += 1200;
  if (target.kind === 'minion') value += 700;
  if (target.kind === 'tower') value += 420;
  if (target.kind === 'core') value += 300;
  value += (1 - target.hp / target.maxHp) * 350;
  value -= distanceActors(actor, target) * 0.5;
  value += seededOffset(state, `${actor.id}->${target.id}`, 0, 100) / 1000;
  return value;
}

function getNearestEnemy(state, actor, range, includeStructures = false) {
  let best;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of state.actors) {
    if (candidate.dead || candidate.team === actor.team) continue;
    if (state.tutorial && candidate.tutorialTag === 'core' && tutorialTowerAlive(state)) continue;
    if (!includeStructures && candidate.kind !== 'hero' && candidate.kind !== 'minion') continue;
    const dist = distanceActors(actor, candidate);
    if (dist <= range && dist < bestDistance) {
      best = candidate;
      bestDistance = dist;
    }
  }
  return best;
}

function resolveActionTarget(state, actor, action, range, includeStructures = false) {
  if (!action) return undefined;

  const targetId = action.target?.id;
  if (targetId) {
    const byId = state.actors.find((candidate) => candidate.id === targetId && !candidate.dead && candidate.team !== actor.team);
    if (byId && distanceActors(actor, byId) <= range + byId.radius + 90) return byId;
  }

  const targetTeam = action.target?.team;
  const targetKind = action.target?.kind;
  const targetHeroId = action.target?.heroId;
  const hasTargetPoint = Number.isFinite(Number(action.targetX)) && Number.isFinite(Number(action.targetY));
  const tx = hasTargetPoint ? Number(action.targetX) : actor.x;
  const ty = hasTargetPoint ? Number(action.targetY) : actor.y;

  let candidates = state.actors.filter((candidate) => {
    if (candidate.dead || candidate.team === actor.team) return false;
    if (state.tutorial && candidate.tutorialTag === 'core' && tutorialTowerAlive(state)) return false;
    if (targetTeam && candidate.team !== targetTeam) return false;
    if (targetKind && candidate.kind !== targetKind) return false;
    if (targetHeroId && candidate.heroId !== targetHeroId) return false;
    if (!includeStructures && candidate.kind !== 'hero' && candidate.kind !== 'minion') return false;
    return distanceActors(actor, candidate) <= range + candidate.radius + 120;
  });

  if (candidates.length === 0 && hasTargetPoint) {
    candidates = state.actors.filter((candidate) => {
      if (candidate.dead || candidate.team === actor.team) return false;
      if (state.tutorial && candidate.tutorialTag === 'core' && tutorialTowerAlive(state)) return false;
      if (!includeStructures && candidate.kind !== 'hero' && candidate.kind !== 'minion') return false;
      return distance(candidate.x, candidate.y, tx, ty) <= Math.max(160, candidate.radius + 120);
    });
  }

  if (candidates.length === 0) return getNearestEnemy(state, actor, range, includeStructures);
  return candidates.sort((a, b) => distance(a.x, a.y, tx, ty) - distance(b.x, b.y, tx, ty) || a.id.localeCompare(b.id))[0];
}

function countEnemiesNear(state, team, x, y, radius) {
  return state.actors.filter((candidate) =>
    !candidate.dead &&
    candidate.team !== team &&
    candidate.kind !== 'core' &&
    distance(x, y, candidate.x, candidate.y) <= radius
  ).length;
}

function getEnemiesInRadius(state, team, x, y, radius) {
  return state.actors.filter((candidate) =>
    !candidate.dead &&
    candidate.team !== team &&
    distance(x, y, candidate.x, candidate.y) <= radius + candidate.radius
  );
}

function damageEnemiesInRadius(state, source, x, y, radius, amount) {
  for (const enemy of getEnemiesInRadius(state, source.team, x, y, radius)) {
    dealDamage(state, source, enemy, amount);
  }
}

function damageEnemiesInLine(state, source, start, end, amount, width) {
  for (const enemy of state.actors) {
    if (enemy.dead || enemy.team === source.team) continue;
    const dist = distancePointToSegment(enemy.x, enemy.y, start.x, start.y, end.x, end.y);
    if (dist <= width + enemy.radius) dealDamage(state, source, enemy, amount);
  }
}

function tutorialTowerAlive(state) {
  return Boolean(state.actors.some((actor) => actor.tutorialTag === 'tower' && !actor.dead));
}


function dealDamage(state, source, target, rawAmount) {
  if (!source || !target || target.dead) return;
  if (state.tutorial && target.tutorialTag === 'core' && tutorialTowerAlive(state)) return;
  let amount = Math.max(1, Math.round(rawAmount));
  if (target.shield > 0) {
    const blocked = Math.min(target.shield, amount);
    target.shield -= blocked;
    amount -= blocked;
  }
  if (amount <= 0) return;

  target.hp = Math.max(0, target.hp - amount);
  state.stats.damageEvents += 1;
  if (source.controller === 'player' || target.controller === 'player') {
    emitCombatEvent(state, 'damage', {
      actor: actorEventSnapshot(source),
      target: actorEventSnapshot(target),
      amount,
      hpAfter: Math.round(target.hp),
      x: Math.round(source.x),
      y: Math.round(source.y),
      targetX: Math.round(target.x),
      targetY: Math.round(target.y)
    });
  }
  if (target.hp <= 0) killActor(state, target, source);
}

function killActor(state, target, source) {
  if (target.dead) return;
  target.dead = true;
  target.hp = 0;
  target.targetId = null;

  if (source.controller === 'player' || target.controller === 'player') {
    emitCombatEvent(state, 'kill', {
      actor: actorEventSnapshot(source),
      target: actorEventSnapshot(target),
      defeatedKind: target.kind,
      x: Math.round(source.x),
      y: Math.round(source.y),
      targetX: Math.round(target.x),
      targetY: Math.round(target.y)
    });
  }

  if ((target.kind === 'tower' || target.kind === 'core') && target.team === 'red' && source.team === 'blue') {
    state.stats.objectiveEvents += 1;
    emitCombatEvent(state, 'objective', {
      actor: actorEventSnapshot(source),
      target: actorEventSnapshot(target),
      objective: target.kind,
      winner: target.kind === 'core' ? source.team : undefined,
      x: Math.round(source.x),
      y: Math.round(source.y),
      targetX: Math.round(target.x),
      targetY: Math.round(target.y)
    });
  }

  if (target.kind === 'hero') {
    target.deaths += 1;
    target.respawnAt = state.tutorial && target.tutorialTag ? null : state.timeMs + SIMULATION_RULES.respawnMs;
    state.kills[source.team] += 1;
    if (source.kind === 'hero') {
      source.kills += 1;
      grantReward(state, source, target.kind);
    }
    return;
  }

  if (source.kind === 'hero') grantReward(state, source, target.kind);
  if (target.kind === 'core') {
    state.winner = source.team;
    state.endedAtMs = state.timeMs;
  }
}

function grantReward(state, actor, defeatedKind) {
  const reward = rewardForDefeat(defeatedKind);
  actor.gold += reward.gold;
  actor.xp += reward.xp;

  if (actor.controller === 'player') {
    emitCombatEvent(state, 'reward', {
      actor: actorEventSnapshot(actor),
      defeatedKind,
      goldAfter: Math.round(actor.gold),
      levelAfter: actor.level,
      data: { goldGain: reward.gold, xpGain: reward.xp }
    });
  }

  while (actor.xp >= nextLevelXp(actor.level) && actor.level < ECONOMY_RULES.maxLevel) {
    actor.xp -= nextLevelXp(actor.level);
    actor.level += 1;
    actor.maxHp += 76;
    actor.hp = Math.min(actor.maxHp, actor.hp + 150);
    actor.damage += 7;
    if (actor.controller === 'player') {
      emitCombatEvent(state, 'level_up', {
        actor: actorEventSnapshot(actor),
        goldAfter: Math.round(actor.gold),
        levelAfter: actor.level,
        x: Math.round(actor.x),
        y: Math.round(actor.y)
      });
    }
  }
}

function updateRespawns(state) {
  for (const actor of state.actors) {
    if (actor.kind !== 'hero' || !actor.dead || !actor.respawnAt || actor.respawnAt > state.timeMs) continue;
    actor.dead = false;
    actor.hp = actor.maxHp;
    actor.respawnAt = null;
    placeActor(state, actor, actor.spawnX, actor.spawnY);
  }
}

function spawnProjectile(state, source, targetX, targetY, amount, speed, radius, lifeMs = 1600) {
  const dir = normalizedVector(targetX - source.x, targetY - source.y, source.team === 'blue' ? 1 : -1, 0);
  state.projectiles.push({
    id: `projectile-${state.projectileSeq++}`,
    team: source.team,
    ownerId: source.id,
    x: source.x,
    y: source.y,
    vx: dir.x * speed,
    vy: dir.y * speed,
    damage: amount,
    radius,
    expiresAt: state.timeMs + lifeMs,
    hit: new Set()
  });
  state.stats.projectilesSpawned += 1;
}

function updateProjectiles(state, dt) {
  for (const projectile of state.projectiles) {
    projectile.x += projectile.vx * dt;
    projectile.y += projectile.vy * dt;

    for (const enemy of state.actors) {
      if (enemy.dead || enemy.team === projectile.team || projectile.hit.has(enemy.id)) continue;
      if (distance(projectile.x, projectile.y, enemy.x, enemy.y) <= enemy.radius + projectile.radius) {
        projectile.hit.add(enemy.id);
        dealDamage(state, actorById(state, projectile.ownerId), enemy, projectile.damage);
        projectile.expiresAt = Math.min(projectile.expiresAt, state.timeMs + 24);
        break;
      }
    }
  }

  state.projectiles = state.projectiles.filter((projectile) =>
    projectile.expiresAt > state.timeMs &&
    projectile.x > -SIMULATION_RULES.projectileGracePx &&
    projectile.x < MAP_RULES.width + SIMULATION_RULES.projectileGracePx &&
    projectile.y > -SIMULATION_RULES.projectileGracePx &&
    projectile.y < MAP_RULES.height + SIMULATION_RULES.projectileGracePx
  );
}

function createZone(state, owner, x, y, radius, amount, durationMs, tickMs, slow) {
  state.zones.push({
    id: `zone-${state.zoneSeq++}`,
    team: owner.team,
    ownerId: owner.id,
    x,
    y,
    radius,
    damage: amount,
    tickMs,
    nextTickAt: state.timeMs + 160,
    expiresAt: state.timeMs + durationMs,
    slow
  });
  state.stats.zonesCreated += 1;
}

function updateZones(state) {
  for (const zone of state.zones) {
    if (state.timeMs < zone.nextTickAt) continue;
    zone.nextTickAt = state.timeMs + zone.tickMs;
    const owner = actorById(state, zone.ownerId);
    if (!owner || owner.dead) continue;
    for (const enemy of getEnemiesInRadius(state, zone.team, zone.x, zone.y, zone.radius)) {
      dealDamage(state, owner, enemy, zone.damage);
      if (zone.slow) enemy.slowUntil = state.timeMs + zone.tickMs + 200;
    }
  }
  state.zones = state.zones.filter((zone) => zone.expiresAt > state.timeMs);
}

function scheduleDelayed(state, dueAt, type, payload) {
  state.delayed.push({ id: `delayed-${state.delayedSeq++}`, dueAt, type, payload });
}

function processDelayed(state) {
  const ready = state.delayed.filter((item) => item.dueAt <= state.timeMs);
  state.delayed = state.delayed.filter((item) => item.dueAt > state.timeMs);

  for (const item of ready) {
    if (item.type === 'damage') {
      const source = actorById(state, item.payload.sourceId);
      const target = actorById(state, item.payload.targetId);
      if (source && target && !source.dead) dealDamage(state, source, target, item.payload.amount);
    }
    if (item.type === 'radiusDamage') {
      const source = actorById(state, item.payload.sourceId);
      if (source && !source.dead) damageEnemiesInRadius(state, source, item.payload.x, item.payload.y, item.payload.radius, item.payload.amount);
    }
  }
}

function cleanupCombatObjects(state) {
  state.actors = state.actors.filter((actor) => actor.kind === 'hero' || actor.kind === 'tower' || actor.kind === 'core' || !actor.dead);
}

function emitCombatEvent(state, type, payload = {}) {
  if (!state.combatEvents) state.combatEvents = [];
  if (state.combatEvents.length >= 1200) return;
  const event = {
    ...payload,
    seq: state.combatEventSeq++,
    t: Math.max(0, Math.floor(state.timeMs)),
    type
  };
  state.combatEvents.push(event);
}

function actorEventSnapshot(actor) {
  if (!actor) return undefined;
  return {
    id: actor.id,
    team: actor.team,
    kind: actor.kind,
    controller: actor.controller,
    heroId: actor.heroId,
    tag: actor.tutorialTag
  };
}

function deriveSimulationResult(state, heroId, requestedDurationSec) {
  const player = getPlayer(state);
  const blueCore = state.actors.find((actor) => actor.kind === 'core' && actor.team === 'blue');
  const redCore = state.actors.find((actor) => actor.kind === 'core' && actor.team === 'red');
  const terminal = Boolean(state.winner);
  const fallbackWinner = redCore && blueCore && redCore.hp < blueCore.hp ? 'blue' : 'red';
  const winner = state.winner ?? fallbackWinner;
  const hero = heroRuleById(heroId);

  return {
    source: AUTHORITATIVE_RESULT_SOURCE,
    terminal,
    victory: winner === 'blue',
    winner,
    durationSec: Math.max(0, Math.floor((state.endedAtMs ?? requestedDurationSec * 1000) / 1000)),
    heroName: hero.name,
    heroId: hero.id,
    kills: clampInt(player?.kills ?? 0, 0, 1000),
    deaths: clampInt(player?.deaths ?? 0, 0, 1000),
    gold: clampInt(player?.gold ?? 0, 0, 1_000_000),
    level: clampInt(player?.level ?? 1, 1, ECONOMY_RULES.maxLevel)
  };
}

function objectiveSnapshot(state) {
  return Object.fromEntries(state.actors
    .filter((actor) => actor.kind === 'tower' || actor.kind === 'core')
    .map((actor) => [actor.id, {
      team: actor.team,
      kind: actor.kind,
      hp: Math.round(actor.hp),
      maxHp: actor.maxHp,
      dead: actor.dead
    }]));
}

function snapshotCombatState(state) {
  return {
    seed: state.seed,
    tutorial: Boolean(state.tutorial),
    timeMs: state.timeMs,
    winner: state.winner,
    kills: state.kills,
    player: publicActorSnapshot(getPlayer(state)),
    objectives: objectiveSnapshot(state),
    actors: state.actors
      .filter((actor) => actor.kind === 'hero')
      .map(publicActorSnapshot)
      .sort((a, b) => a.id.localeCompare(b.id)),
    projectileCount: state.projectiles.length,
    zoneCount: state.zones.length,
    stats: state.stats
  };
}

function publicActorSnapshot(actor) {
  if (!actor) return null;
  return {
    id: actor.id,
    team: actor.team,
    kind: actor.kind,
    controller: actor.controller,
    heroId: actor.heroId,
    tag: actor.tutorialTag,
    x: Math.round(actor.x),
    y: Math.round(actor.y),
    hp: Math.round(actor.hp),
    maxHp: Math.round(actor.maxHp),
    dead: actor.dead,
    level: actor.level,
    kills: actor.kills,
    deaths: actor.deaths,
    gold: actor.gold
  };
}

function normalizeActions(actions) {
  if (!Array.isArray(actions)) return [];
  return actions
    .filter((action) => action && typeof action === 'object')
    .map((action, index) => ({
      ...action,
      seq: Number.isFinite(Number(action.seq)) ? Number(action.seq) : index,
      t: Math.max(0, finiteNumber(action.t, 0))
    }))
    .sort((a, b) => a.t - b.t || a.seq - b.seq);
}

function getPlayer(state) {
  return actorById(state, state.playerId);
}

function actorById(state, id) {
  if (!id) return undefined;
  return state.actors.find((actor) => actor.id === id);
}

function normalizedVector(dx, dy, fallbackX, fallbackY) {
  const x = finiteNumber(dx, fallbackX);
  const y = finiteNumber(dy, fallbackY);
  const len = Math.hypot(x, y);
  if (len <= 0.0001) return { x: fallbackX, y: fallbackY };
  return { x: x / len, y: y / len };
}

function distanceActors(a, b) {
  return distance(a.x, a.y, b.x, b.y);
}

function distance(x1, y1, x2, y2) {
  return Math.hypot(x2 - x1, y2 - y1);
}

function distancePointToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 && dy === 0) return distance(px, py, x1, y1);
  const t = clampNumber(((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy), 0, 1);
  return distance(px, py, x1 + t * dx, y1 + t * dy);
}

function finiteNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clampNumber(value, min, max) {
  const n = finiteNumber(value, min);
  return Math.max(min, Math.min(max, n));
}

function createRng(seed) {
  let state = normalizeSeed(seed) || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) / 0x100000000);
  };
}

function normalizeSeed(seed) {
  const n = Number(seed);
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.floor(Math.abs(n)) % 2_000_000_000);
}

function seededOffset(state, salt, min, max) {
  const hashInput = `${state.seed}:${salt}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < hashInput.length; i += 1) {
    hash ^= hashInput.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  const t = hash / 0xffffffff;
  return Math.round(min + (max - min) * t);
}

export function canonicalStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalStringify(item)).join(',')}]`;

  const keys = Object.keys(value).filter((key) => value[key] !== undefined).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalStringify(value[key])}`).join(',')}}`;
}

export function stableHash(input) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a32:${hash.toString(16).padStart(8, '0')}`;
}

export function clampInt(value, min, max) {
  const n = Number.parseInt(String(value), 10);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}
