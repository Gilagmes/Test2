#!/usr/bin/env bash
set -euo pipefail

API_URL="${API_URL:-http://localhost:8787}"

echo "Validation smoke-test against $API_URL"

TOKEN=$(curl -fsS -X POST "$API_URL/api/auth/telegram" \
  -H 'content-type: application/json' \
  -d '{"initData":""}' \
  | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).token))")

echo "Token: ${TOKEN:0:18}..."

start_match() {
  local hero_id="${1:-kairo}"
  curl -fsS -X POST "$API_URL/api/matches/start" \
    -H "authorization: Bearer $TOKEN" \
    -H 'content-type: application/json' \
    -d "{\"heroId\":\"$hero_id\"}"
}

json_get() {
  node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const obj=JSON.parse(d); const path=process.argv[1].split('.'); let v=obj; for (const p of path) v=v?.[p]; console.log(v ?? '');})" "$1"
}

make_body() {
  local match_id="$1"
  local seed="$2"
  local validation_token="$3"
  local mode="${4:-valid}"
  MATCH_ID="$match_id" MATCH_SEED="$seed" MATCH_VALIDATION_TOKEN="$validation_token" BODY_MODE="$mode" node --input-type=module <<'NODE'
import { canonicalStringify, simulateCombat, stableHash } from './shared/combatRules.js';

const matchId = process.env.MATCH_ID;
const seed = Number(process.env.MATCH_SEED);
const validationToken = process.env.MATCH_VALIDATION_TOKEN;
const mode = process.env.BODY_MODE;

const player = { team: 'blue', kind: 'hero', controller: 'player', heroId: 'kairo' };
const enemyHero = { team: 'red', kind: 'hero', controller: 'bot', heroId: 'reyna' };
const redCore = { team: 'red', kind: 'core', controller: 'structure' };

const eventLogEvents = [
  { t: 0, type: 'match_start', actor: player, x: 320, y: 570 },
  { t: 1000, type: 'move', actor: player, x: 500, y: 570 },
  { t: 4000, type: 'move', actor: player, x: 620, y: 570 },
  { t: 4500, type: 'attack', actor: player, target: enemyHero, x: 620, y: 570, targetX: 650, targetY: 570 },
  { t: 5200, type: 'cast', actor: player, target: enemyHero, slot: 'primary', x: 620, y: 570, targetX: 700, targetY: 570 },
  { t: 7000, type: 'cast', actor: player, target: enemyHero, slot: 'secondary', x: 620, y: 570, targetX: 700, targetY: 570 },
  { t: 10000, type: 'cast', actor: player, target: redCore, slot: 'ultimate', x: 620, y: 570, targetX: 760, targetY: 600 },
  { t: 10400, type: 'damage', actor: player, target: enemyHero, amount: 450, hpAfter: 0 },
  { t: 10600, type: 'kill', actor: player, target: enemyHero, defeatedKind: 'hero' },
  { t: 10800, type: 'reward', actor: player, defeatedKind: 'hero', goldAfter: 450, levelAfter: 1, data: { goldGain: 450, xpGain: 180 } },
  { t: 11000, type: 'level_up', actor: player, goldAfter: 450, levelAfter: 2 },
  { t: 11500, type: 'objective', actor: player, target: redCore, objective: 'core', winner: 'blue', targetX: 2010, targetY: 600 },
  { t: 12000, type: 'match_end', actor: player, winner: 'blue', goldAfter: 450, levelAfter: 2, data: { durationSec: 12, kills: 1, deaths: 0, towersDestroyed: 0, coreDestroyed: true } }
];

let actionStreamActions = [
  { seq: 0, t: 0, type: 'match_start', x: 320, y: 570, data: { matchId, seed, heroId: 'kairo' } },
  { seq: 1, t: 1000, type: 'move', x: 500, y: 570, dx: 1, dy: 0, data: { hp: 980 } },
  { seq: 2, t: 4000, type: 'move', x: 620, y: 570, dx: 1, dy: 0, data: { hp: 980 } },
  { seq: 3, t: 4500, type: 'attack', target: enemyHero, x: 620, y: 570, targetX: 650, targetY: 570 },
  { seq: 4, t: 5200, type: 'cast', target: enemyHero, slot: 'primary', x: 620, y: 570, targetX: 700, targetY: 570 },
  { seq: 5, t: 7000, type: 'cast', target: enemyHero, slot: 'secondary', x: 620, y: 570, targetX: 700, targetY: 570 },
  { seq: 6, t: 10000, type: 'cast', target: redCore, slot: 'ultimate', x: 620, y: 570, targetX: 760, targetY: 600 },
  { seq: 7, t: 12000, type: 'match_end', x: 620, y: 570, data: { winner: 'blue', victory: true, durationSec: 12, kills: 1, deaths: 0, gold: 450, level: 2, truncated: false } }
];

if (mode === 'cooldown_tamper') {
  eventLogEvents.splice(4, 0, { t: 4550, type: 'attack', actor: player, target: enemyHero, x: 620, y: 570, targetX: 650, targetY: 570 });
  actionStreamActions.splice(4, 0, { seq: 4, t: 4550, type: 'attack', target: enemyHero, x: 620, y: 570, targetX: 650, targetY: 570 });
  actionStreamActions = actionStreamActions.map((action, index) => ({ ...action, seq: index }));
}

const castCounts = { primary: 0, secondary: 0, ultimate: 0 };
let moveSamples = 0;
let attackCount = 0;
for (const action of actionStreamActions) {
  if (action.type === 'move') moveSamples += 1;
  if (action.type === 'attack') attackCount += 1;
  if (action.type === 'cast') castCounts[action.slot] += 1;
}

const clientSimulationReport = simulateCombat({
  heroId: 'kairo',
  seed,
  actions: actionStreamActions,
  durationSec: 12
});

const actionUnsigned = {
  version: 'client-action-stream-v1',
  matchId,
  heroId: 'kairo',
  seed,
  validationToken,
  tickRate: 2,
  startedAtClientMs: 1780000000000,
  actions: actionStreamActions,
  summary: {
    durationSec: 12,
    lastX: 620,
    lastY: 570,
    moveSamples,
    attackCount,
    castCounts,
    truncated: false
  },
  clientSimulation: {
    source: clientSimulationReport.source,
    stateHash: clientSimulationReport.stateHash,
    result: {
      terminal: clientSimulationReport.result.terminal,
      victory: clientSimulationReport.result.victory,
      winner: clientSimulationReport.result.winner,
      durationSec: clientSimulationReport.result.durationSec,
      heroName: clientSimulationReport.result.heroName,
      heroId: clientSimulationReport.result.heroId,
      kills: clientSimulationReport.result.kills,
      deaths: clientSimulationReport.result.deaths,
      gold: clientSimulationReport.result.gold,
      level: clientSimulationReport.result.level
    }
  }
};

const body = {
  victory: true,
  winner: 'blue',
  durationSec: 12,
  heroName: 'Кайро',
  heroId: 'kairo',
  kills: mode === 'result_kills_tamper' ? 2 : 1,
  deaths: 0,
  gold: mode === 'client_underreports' ? 440 : 450,
  level: 2,
  eventLog: {
    version: 'client-event-log-v1',
    matchId,
    heroId: 'kairo',
    seed,
    startedAtClientMs: 1780000000000,
    events: eventLogEvents,
    summary: {
      victory: true,
      winner: 'blue',
      durationSec: 12,
      kills: 1,
      deaths: 0,
      gold: 450,
      level: 2,
      towersDestroyed: 0,
      coreDestroyed: true
    }
  },
  actionStream: {
    ...actionUnsigned,
    integrityHash: stableHash(canonicalStringify(actionUnsigned))
  }
};

if (mode === 'hash_tamper') {
  body.actionStream.actions[1].x = 999;
}

process.stdout.write(JSON.stringify(body));
NODE
}

MATCH_JSON=$(start_match kairo)
MATCH=$(echo "$MATCH_JSON" | json_get match.id)
SEED=$(echo "$MATCH_JSON" | json_get match.seed)
VALIDATION_TOKEN=$(echo "$MATCH_JSON" | json_get match.validationToken)

echo "Match: $MATCH seed=$SEED token=${VALIDATION_TOKEN:0:12}..."

VALID_BODY=$(make_body "$MATCH" "$SEED" "$VALIDATION_TOKEN" valid)

echo "1/6 Accepted valid result with event-log + action-stream + authoritative simulation"
VALID_RESPONSE=$(curl -fsS -X POST "$API_URL/api/matches/$MATCH/result" \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d "$VALID_BODY")
echo "$VALID_RESPONSE"
echo "$VALID_RESPONSE" | grep -q '"ok":true'
echo "$VALID_RESPONSE" | grep -q '"version":"match-result-v5"'
echo "$VALID_RESPONSE" | grep -q '"authoritativeReplay":true'
echo "$VALID_RESPONSE" | grep -q '"clientSimulationMatched":true'

echo "2/6 Rejected duplicate result"
DUP_CODE=$(curl -sS -o /tmp/shonen-rift-dup.json -w '%{http_code}' -X POST "$API_URL/api/matches/$MATCH/result" \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d "$VALID_BODY")
cat /tmp/shonen-rift-dup.json
test "$DUP_CODE" = "409"

CHEAT_MATCH_JSON=$(start_match teo)
CHEAT_MATCH=$(echo "$CHEAT_MATCH_JSON" | json_get match.id)

echo "3/6 Rejected impossible hacked result"
CHEAT_CODE=$(curl -sS -o /tmp/shonen-rift-cheat.json -w '%{http_code}' -X POST "$API_URL/api/matches/$CHEAT_MATCH/result" \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"victory":true,"winner":"blue","durationSec":999,"heroName":"Кайро","heroId":"kairo","kills":999,"deaths":0,"gold":999999,"level":99}')
cat /tmp/shonen-rift-cheat.json
test "$CHEAT_CODE" = "422"

echo "4/6 Rejected tampered event-log summary"
TAMPER_MATCH_JSON=$(start_match kairo)
TAMPER_MATCH=$(echo "$TAMPER_MATCH_JSON" | json_get match.id)
TAMPER_SEED=$(echo "$TAMPER_MATCH_JSON" | json_get match.seed)
TAMPER_TOKEN=$(echo "$TAMPER_MATCH_JSON" | json_get match.validationToken)
TAMPER_BODY=$(make_body "$TAMPER_MATCH" "$TAMPER_SEED" "$TAMPER_TOKEN" result_kills_tamper)
TAMPER_CODE=$(curl -sS -o /tmp/shonen-rift-tamper.json -w '%{http_code}' -X POST "$API_URL/api/matches/$TAMPER_MATCH/result" \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d "$TAMPER_BODY")
cat /tmp/shonen-rift-tamper.json
test "$TAMPER_CODE" = "422"

echo "5/6 Rejected deterministic replay cooldown tamper"
REPLAY_MATCH_JSON=$(start_match kairo)
REPLAY_MATCH=$(echo "$REPLAY_MATCH_JSON" | json_get match.id)
REPLAY_SEED=$(echo "$REPLAY_MATCH_JSON" | json_get match.seed)
REPLAY_TOKEN=$(echo "$REPLAY_MATCH_JSON" | json_get match.validationToken)
REPLAY_BODY=$(make_body "$REPLAY_MATCH" "$REPLAY_SEED" "$REPLAY_TOKEN" cooldown_tamper)
REPLAY_CODE=$(curl -sS -o /tmp/shonen-rift-replay.json -w '%{http_code}' -X POST "$API_URL/api/matches/$REPLAY_MATCH/result" \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d "$REPLAY_BODY")
cat /tmp/shonen-rift-replay.json
test "$REPLAY_CODE" = "422"
grep -q 'attack_cooldown_violation' /tmp/shonen-rift-replay.json


echo "6/6 Server saves server-calculated result when client underreports"
CALC_MATCH_JSON=$(start_match kairo)
CALC_MATCH=$(echo "$CALC_MATCH_JSON" | json_get match.id)
CALC_SEED=$(echo "$CALC_MATCH_JSON" | json_get match.seed)
CALC_TOKEN=$(echo "$CALC_MATCH_JSON" | json_get match.validationToken)
CALC_BODY=$(make_body "$CALC_MATCH" "$CALC_SEED" "$CALC_TOKEN" client_underreports)
CALC_RESPONSE=$(curl -fsS -X POST "$API_URL/api/matches/$CALC_MATCH/result" \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d "$CALC_BODY")
echo "$CALC_RESPONSE"
echo "$CALC_RESPONSE" | grep -q '"ok":true'
echo "$CALC_RESPONSE" | grep -q '"serverCalculated":true'
echo "$CALC_RESPONSE" | grep -q '"resultSource":"server-calculated-v1"'
echo "$CALC_RESPONSE" | grep -q '"gold":450'
echo "$CALC_RESPONSE" | grep -q 'server_result_adjusted'

echo "Validation smoke-test passed."
