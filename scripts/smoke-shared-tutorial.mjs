import {
  COMBAT_HERO_RULES,
  SIMULATION_RULES,
  createInitialCombatState,
  renderCombatSnapshot,
  stepCombatState
} from '../shared/combatRules.js';

const HERO_IDS = ['kairo', 'reyna', 'teo'];

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function vectorTo(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return {
    dx: Number((dx / len).toFixed(3)),
    dy: Number((dy / len).toFixed(3))
  };
}

function eventTarget(actor) {
  if (!actor) return undefined;
  return {
    id: actor.id,
    team: actor.team,
    kind: actor.kind,
    controller: actor.controller,
    heroId: actor.heroId,
    tag: actor.tag
  };
}

function runSharedTutorial(heroId) {
  const hero = COMBAT_HERO_RULES[heroId];
  const state = createInitialCombatState({ heroId, seed: 777, tutorial: true });
  let snapshot = renderCombatSnapshot(state);
  let seq = 0;
  let step = 0;
  let lastMoveAt = -999999;
  let lastMove = { dx: 999, dy: 999 };
  let lastAttackAt = -999999;
  const lastCastAt = { primary: -999999, secondary: -999999, ultimate: -999999 };
  const used = { attack: false, primary: false, secondary: false, ultimate: false };

  while (!snapshot.winner && snapshot.timeMs < 120_000) {
    const player = snapshot.actors.find((actor) => actor.id === snapshot.playerId);
    const dummy = snapshot.actors.find((actor) => actor.tag === 'dummy' && !actor.dead);
    const tower = snapshot.actors.find((actor) => actor.tag === 'tower' && !actor.dead);
    const core = snapshot.actors.find((actor) => actor.tag === 'core' && !actor.dead);
    const nextTickMs = snapshot.timeMs + SIMULATION_RULES.tickMs;
    const actions = [];

    if (seq === 0) actions.push({ seq: seq++, t: nextTickMs, type: 'match_start' });
    if (!player) throw new Error(`${heroId}: player missing from tutorial snapshot`);

    const pushMove = (dx, dy) => {
      if (nextTickMs - lastMoveAt >= 500 || Math.abs(dx - lastMove.dx) > 0.05 || Math.abs(dy - lastMove.dy) > 0.05) {
        actions.push({ seq: seq++, t: nextTickMs, type: 'move', dx, dy });
        lastMoveAt = nextTickMs;
        lastMove = { dx, dy };
      }
    };
    const pushStop = () => pushMove(0, 0);
    const moveNear = (target, desiredDistance) => {
      if (!target) return false;
      if (distance(player, target) > desiredDistance) {
        const vector = vectorTo(player, target);
        pushMove(vector.dx, vector.dy);
        return false;
      }
      pushStop();
      return true;
    };
    const attack = (target) => {
      if (!target || nextTickMs - lastAttackAt < hero.attackCooldown) return false;
      actions.push({
        seq: seq++,
        t: nextTickMs,
        type: 'attack',
        x: player.x,
        y: player.y,
        target: eventTarget(target),
        targetX: target.x,
        targetY: target.y
      });
      lastAttackAt = nextTickMs;
      used.attack = true;
      return true;
    };
    const cast = (slot, target) => {
      if (nextTickMs - lastCastAt[slot] < hero.abilities[slot].cooldown) return false;
      actions.push({
        seq: seq++,
        t: nextTickMs,
        type: 'cast',
        slot,
        x: player.x,
        y: player.y,
        target: eventTarget(target),
        targetX: target?.x,
        targetY: target?.y
      });
      lastCastAt[slot] = nextTickMs;
      used[slot] = true;
      return true;
    };

    if (step === 0) {
      const marker = { x: 500, y: 570 };
      if (distance(player, marker) > 70) {
        const vector = vectorTo(player, marker);
        pushMove(vector.dx, vector.dy);
      } else {
        pushStop();
        step = 1;
      }
    } else if (step === 1) {
      const target = dummy ?? tower;
      if (moveNear(target, Math.max(120, hero.attackRange + 45)) && attack(target)) step = 2;
    } else if (step === 2) {
      const target = dummy ?? tower;
      if (moveNear(target, Math.max(150, hero.abilities.primary.targetRange * 0.45)) && cast('primary', target)) step = 3;
    } else if (step === 3) {
      const target = dummy ?? tower;
      if (moveNear(target, Math.max(120, hero.abilities.secondary.targetRange * 0.38)) && cast('secondary', target)) step = 4;
    } else if (step === 4) {
      const target = dummy ?? tower;
      if (moveNear(target, Math.max(135, Math.min(220, hero.abilities.ultimate.targetRange * 0.5))) && cast('ultimate', target)) step = 5;
    } else if (step === 5) {
      if (!tower) {
        step = 6;
      } else if (moveNear(tower, Math.max(120, hero.attackRange + 45))) {
        attack(tower);
        cast('primary', tower);
        cast('secondary', tower);
        cast('ultimate', tower);
      }
    } else if (step === 6 && core && moveNear(core, Math.max(120, hero.attackRange + 45))) {
      attack(core);
      cast('primary', core);
      cast('secondary', core);
      cast('ultimate', core);
    }

    snapshot = stepCombatState(state, actions);
    if (step === 5 && snapshot.events.some((event) => event.type === 'objective' && event.target?.tag === 'tower')) step = 6;
  }

  const objectives = snapshot.events
    .filter((event) => event.type === 'objective')
    .map((event) => event.target?.tag ?? event.objective);

  return { snapshot, used, objectives };
}

console.log('Shared tutorial smoke: all heroes complete deterministic tutorial path');

for (const heroId of HERO_IDS) {
  const { snapshot, used, objectives } = runSharedTutorial(heroId);
  if (snapshot.winner !== 'blue' || !snapshot.result.terminal) {
    console.error(`${heroId}: expected blue terminal tutorial victory`, snapshot.result);
    process.exit(1);
  }
  for (const action of ['attack', 'primary', 'secondary', 'ultimate']) {
    if (!used[action]) {
      console.error(`${heroId}: tutorial did not use ${action}`);
      process.exit(1);
    }
  }
  if (!objectives.includes('tower') || !objectives.includes('core')) {
    console.error(`${heroId}: tutorial did not destroy tower and core`, objectives);
    process.exit(1);
  }

  console.log(`✓ ${heroId}: tutorial ${snapshot.result.winner} win in ${snapshot.result.durationSec}s · gold=${snapshot.result.gold} · level=${snapshot.result.level}`);
}

console.log('Shared tutorial smoke passed.');
