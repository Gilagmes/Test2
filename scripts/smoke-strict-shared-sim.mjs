process.env.MATCH_EVENT_LOG_REQUIRED = process.env.MATCH_EVENT_LOG_REQUIRED ?? 'true';
process.env.MATCH_ACTION_STREAM_REQUIRED = process.env.MATCH_ACTION_STREAM_REQUIRED ?? 'true';
process.env.MATCH_AUTHORITATIVE_REPLAY_ENABLED = process.env.MATCH_AUTHORITATIVE_REPLAY_ENABLED ?? 'true';
process.env.MATCH_AUTHORITATIVE_REPLAY_STRICT = process.env.MATCH_AUTHORITATIVE_REPLAY_STRICT ?? 'true';
process.env.MATCH_AUTHORITATIVE_REPLAY_SAVE = process.env.MATCH_AUTHORITATIVE_REPLAY_SAVE ?? 'true';
process.env.MATCH_CLIENT_SIM_HASH_REQUIRED = process.env.MATCH_CLIENT_SIM_HASH_REQUIRED ?? 'true';
process.env.MATCH_REPLAY_SECRET = process.env.MATCH_REPLAY_SECRET ?? 'strict-shared-sim-test-secret-64-chars-00000000000000000000';

const {
  ACTION_STREAM_VERSION,
  SIMULATION_RULES,
  canonicalStringify,
  createInitialCombatState,
  renderCombatSnapshot,
  simulateCombat,
  stableHash,
  stepCombatState
} = await import('../shared/combatRules.js');
const { validateMatchResult } = await import('../server/matchValidator.js');
const { buildMatchValidationToken } = await import('../server/deterministicReplay.js');

const CASES = [
  { heroId: 'kairo', seed: 1 },
  { heroId: 'kairo', seed: 2 },
  { heroId: 'reyna', seed: 3 },
  { heroId: 'teo', seed: 42 }
];

function actorToEventActor(actor) {
  if (!actor) return undefined;
  return {
    id: actor.id,
    team: actor.team,
    kind: actor.kind,
    controller: actor.controller,
    heroId: actor.heroId
  };
}

function runLiveSimulation({ heroId, seed, matchId }) {
  const gameplayActions = [{
    seq: 0,
    t: SIMULATION_RULES.tickMs,
    type: 'match_start',
    data: { matchId, seed, heroId, mode: 'strict-shared-smoke' }
  }];

  const state = createInitialCombatState({ heroId, seed });
  let snapshot = renderCombatSnapshot(state);
  let actionIndex = 0;

  while (!snapshot.winner && snapshot.timeMs < SIMULATION_RULES.maxDurationSec * 1000) {
    const nextTickMs = snapshot.timeMs + SIMULATION_RULES.tickMs;
    const tickActions = [];
    while (actionIndex < gameplayActions.length && gameplayActions[actionIndex].t <= nextTickMs) {
      tickActions.push(gameplayActions[actionIndex]);
      actionIndex += 1;
    }
    snapshot = stepCombatState(state, tickActions);
  }

  if (!snapshot.result.terminal) {
    throw new Error(`${heroId}/${seed} did not reach terminal core destruction within ${SIMULATION_RULES.maxDurationSec}s`);
  }

  return { snapshot, gameplayActions };
}

function buildPayload({ user, match, snapshot, gameplayActions }) {
  const durationSec = snapshot.result.durationSec;
  const player = snapshot.actors.find((actor) => actor.id === snapshot.playerId);
  const winner = snapshot.result.winner;
  const matchEndAction = {
    seq: gameplayActions.length,
    t: snapshot.timeMs,
    type: 'match_end',
    x: player?.x,
    y: player?.y,
    data: {
      winner,
      victory: winner === 'blue',
      durationSec,
      kills: snapshot.result.kills,
      deaths: snapshot.result.deaths,
      gold: snapshot.result.gold,
      level: snapshot.result.level,
      sharedSim: true
    }
  };
  const actions = [...gameplayActions, matchEndAction].map((action, index) => ({ ...action, seq: index }));

  const clientSimulation = simulateCombat({
    heroId: match.heroId,
    seed: match.seed,
    actions,
    durationSec
  });

  if (clientSimulation.stateHash !== snapshot.stateHash) {
    throw new Error(`Local live/replay hash mismatch for ${match.heroId}/${match.seed}: ${snapshot.stateHash} != ${clientSimulation.stateHash}`);
  }

  const towerObjectives = snapshot.events.filter((event) => event.type === 'objective' && event.objective === 'tower' && event.target?.team === 'red').length;
  const redCoreDestroyed = snapshot.events.some((event) => event.type === 'objective' && event.objective === 'core' && event.target?.team === 'red');

  const matchEndEvent = {
    t: snapshot.timeMs,
    type: 'match_end',
    actor: actorToEventActor(player),
    winner,
    x: player?.x,
    y: player?.y,
    goldAfter: snapshot.result.gold,
    levelAfter: snapshot.result.level,
    data: {
      durationSec,
      kills: snapshot.result.kills,
      deaths: snapshot.result.deaths,
      gold: snapshot.result.gold,
      level: snapshot.result.level,
      towersDestroyed: towerObjectives,
      coreDestroyed: redCoreDestroyed,
      sharedSim: true
    }
  };

  const eventLog = {
    version: 'client-event-log-v1',
    matchId: match.id,
    heroId: match.heroId,
    seed: match.seed,
    startedAtClientMs: 0,
    events: [...snapshot.events, matchEndEvent],
    summary: {
      victory: winner === 'blue',
      winner,
      durationSec,
      kills: snapshot.result.kills,
      deaths: snapshot.result.deaths,
      gold: snapshot.result.gold,
      level: snapshot.result.level,
      towersDestroyed: towerObjectives,
      coreDestroyed: redCoreDestroyed
    }
  };

  const unsignedActionStream = {
    version: ACTION_STREAM_VERSION,
    matchId: match.id,
    heroId: match.heroId,
    seed: match.seed,
    validationToken: match.validationToken,
    tickRate: 10,
    startedAtClientMs: 0,
    actions,
    summary: {
      durationSec,
      lastX: Math.round(player?.x ?? 0),
      lastY: Math.round(player?.y ?? 0),
      moveSamples: 0,
      attackCount: 0,
      castCounts: { primary: 0, secondary: 0, ultimate: 0 },
      truncated: false
    },
    clientSimulation: {
      source: clientSimulation.source,
      stateHash: clientSimulation.stateHash,
      result: clientSimulation.result
    }
  };

  const actionStream = {
    ...unsignedActionStream,
    integrityHash: stableHash(canonicalStringify(unsignedActionStream))
  };

  return {
    victory: winner === 'blue',
    winner,
    durationSec,
    heroName: snapshot.result.heroName,
    heroId: match.heroId,
    kills: snapshot.result.kills,
    deaths: snapshot.result.deaths,
    gold: snapshot.result.gold,
    level: snapshot.result.level,
    eventLog,
    actionStream
  };
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function resignActionStream(actionStream) {
  const unsigned = { ...actionStream };
  delete unsigned.integrityHash;
  actionStream.integrityHash = stableHash(canonicalStringify(unsigned));
  return actionStream;
}

function assertRejectedWith(validation, expectedCode, label) {
  const codes = new Set((validation.errors ?? []).map((error) => error.code));
  if (validation.ok || !codes.has(expectedCode)) {
    console.error(`${label} expected rejection ${expectedCode}, got`, JSON.stringify(validation, null, 2));
    process.exit(1);
  }
  console.log(`✓ ${label}: rejected with ${expectedCode}`);
}

console.log('Strict shared-sim smoke: eventLog/actionStream/client hash required + authoritative strict/save');

let negativeFixture = null;

for (const testCase of CASES) {
  const user = {
    id: `user_strict_${testCase.heroId}_${testCase.seed}`,
    telegramId: `90${testCase.seed}${testCase.heroId.length}`
  };
  const createdAtMs = 1_800_000_000_000 + testCase.seed * 1000;
  const match = {
    id: `match_strict_${testCase.heroId}_${testCase.seed}`,
    userId: user.id,
    telegramId: user.telegramId,
    heroId: testCase.heroId,
    seed: testCase.seed,
    status: 'started',
    startedAt: new Date(createdAtMs).toISOString(),
    createdAtMs
  };
  match.validationToken = buildMatchValidationToken(match, user);

  const { snapshot, gameplayActions } = runLiveSimulation({ ...testCase, matchId: match.id });
  const payload = buildPayload({ user, match, snapshot, gameplayActions });
  const nowMs = createdAtMs + payload.durationSec * 1000;
  if (!negativeFixture) {
    negativeFixture = {
      user: cloneJson(user),
      match: cloneJson(match),
      payload: cloneJson(payload),
      nowMs
    };
  }
  const validation = validateMatchResult({
    user,
    match,
    payload,
    nowMs
  });

  const label = `${testCase.heroId}/${testCase.seed}`;
  if (!validation.ok) {
    console.error(`${label} rejected`, JSON.stringify(validation.errors, null, 2), JSON.stringify(validation.warnings, null, 2));
    process.exit(1);
  }
  if (validation.resultSource !== 'authoritative-sim-v1') {
    console.error(`${label} expected authoritative-sim-v1 resultSource, got ${validation.resultSource}`);
    process.exit(1);
  }
  if (validation.clientSimulationMatched !== true) {
    console.error(`${label} expected clientSimulationMatched:true, got ${validation.clientSimulationMatched}`);
    process.exit(1);
  }
  if (validation.authoritativeResult?.terminal !== true) {
    console.error(`${label} expected terminal authoritative result`, validation.authoritativeResult);
    process.exit(1);
  }
  if (validation.sanitized.winner !== validation.authoritativeResult.winner) {
    console.error(`${label} saved winner differs from authoritative winner`);
    process.exit(1);
  }

  console.log(`✓ ${label}: ${validation.authoritativeResult.winner} terminal in ${validation.authoritativeResult.durationSec}s · stateHash=${validation.authoritativeStateHash}`);
}

if (!negativeFixture) {
  console.error('Negative fixture was not created.');
  process.exit(1);
}

const missingClientSimulation = cloneJson(negativeFixture.payload);
delete missingClientSimulation.actionStream.clientSimulation;
resignActionStream(missingClientSimulation.actionStream);
assertRejectedWith(
  validateMatchResult({
    user: cloneJson(negativeFixture.user),
    match: cloneJson(negativeFixture.match),
    payload: missingClientSimulation,
    nowMs: negativeFixture.nowMs
  }),
  'client_simulation_required',
  'missing clientSimulation in strict mode'
);

const missingStateHash = cloneJson(negativeFixture.payload);
delete missingStateHash.actionStream.clientSimulation.stateHash;
resignActionStream(missingStateHash.actionStream);
assertRejectedWith(
  validateMatchResult({
    user: cloneJson(negativeFixture.user),
    match: cloneJson(negativeFixture.match),
    payload: missingStateHash,
    nowMs: negativeFixture.nowMs
  }),
  'client_simulation_hash_missing',
  'missing clientSimulation.stateHash in strict mode'
);

const tamperedStateHash = cloneJson(negativeFixture.payload);
tamperedStateHash.actionStream.clientSimulation.stateHash = 'fnv1a32:00000000';
resignActionStream(tamperedStateHash.actionStream);
assertRejectedWith(
  validateMatchResult({
    user: cloneJson(negativeFixture.user),
    match: cloneJson(negativeFixture.match),
    payload: tamperedStateHash,
    nowMs: negativeFixture.nowMs
  }),
  'client_server_sim_hash_mismatch_strict',
  'tampered clientSimulation.stateHash in strict mode'
);

console.log('Strict shared-sim smoke passed.');
