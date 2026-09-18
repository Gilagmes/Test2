export const EVENT_LOG_VERSION: 'client-event-log-v1';
export const ACTION_STREAM_VERSION: 'client-action-stream-v1';
export const SERVER_RESULT_SOURCE: 'server-calculated-v1';
export const AUTHORITATIVE_RESULT_SOURCE: 'authoritative-sim-v1';

export type AbilitySlot = 'primary' | 'secondary' | 'ultimate';
export type Team = 'blue' | 'red';

export type SharedAbilityRule = Readonly<{
  cooldown: number;
  targetRange: number;
  mobilityBonus: number;
  offensiveWeight: number;
}>;

export type SharedHeroRule = Readonly<{
  id: 'kairo' | 'reyna' | 'teo';
  name: string;
  maxHp: number;
  damage: number;
  speed: number;
  attackCooldown: number;
  attackRange: number;
  radius: number;
  abilities: Readonly<Record<AbilitySlot, SharedAbilityRule>>;
}>;

export const MAP_RULES: Readonly<{
  width: number;
  height: number;
  playerSpawn: Readonly<{ x: number; y: number }>;
}>;

export const SIMULATION_RULES: Readonly<{
  tickMs: number;
  maxDurationSec: number;
  waveIntervalMs: number;
  respawnMs: number;
  tower: Readonly<{ hp: number; damage: number; range: number; attackCooldown: number; radius: number }>;
  core: Readonly<{ hp: number; radius: number }>;
  minion: Readonly<{ hp: number; damage: number; range: number; speed: number; attackCooldown: number; radius: number }>;
  projectileGracePx: number;
}>;

export const LANE_PATH: ReadonlyArray<Readonly<{ x: number; y: number }>>;
export const RED_LANE_PATH: ReadonlyArray<Readonly<{ x: number; y: number }>>;
export const COMBAT_HERO_RULES: Readonly<Record<'kairo' | 'reyna' | 'teo', SharedHeroRule>>;

export const ECONOMY_RULES: Readonly<{
  rewards: Readonly<Record<'hero' | 'tower' | 'core' | 'minion', Readonly<{ gold: number; xp: number }>>>;
  maxLevel: number;
  levelXpMultiplier: number;
}>;

export type SharedAction = {
  seq?: number;
  t: number;
  type: string;
  x?: number;
  y?: number;
  dx?: number;
  dy?: number;
  slot?: string;
  target?: {
    id?: string;
    team?: Team;
    kind?: string;
    controller?: string;
    heroId?: string;
    tag?: string;
  };
  targetX?: number;
  targetY?: number;
  data?: Record<string, unknown>;
};

export type AuthoritativeSimulationResult = {
  source: 'authoritative-sim-v1';
  terminal: boolean;
  victory: boolean;
  winner: Team;
  durationSec: number;
  heroName: string;
  heroId: string;
  kills: number;
  deaths: number;
  gold: number;
  level: number;
};


export type RenderCombatEvent = SharedAction & {
  seq: number;
  actor?: SharedAction['target'];
  amount?: number;
  hpAfter?: number;
  defeatedKind?: string;
  objective?: string;
  winner?: Team;
  goldAfter?: number;
  levelAfter?: number;
};

export type RenderActorSnapshot = {
  id: string;
  team: Team;
  kind: 'hero' | 'minion' | 'tower' | 'core' | string;
  controller: string;
  heroId?: string;
  tag?: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  dead: boolean;
  level: number;
  kills: number;
  deaths: number;
  gold: number;
};

export type RenderCombatSnapshot = {
  source: 'authoritative-sim-v1';
  seed: number;
  heroId: string;
  tutorial: boolean;
  timeMs: number;
  winner: Team | null;
  endedAtMs: number | null;
  kills: Record<Team, number>;
  playerId: string | null;
  stateHash: string;
  result: AuthoritativeSimulationResult;
  actors: RenderActorSnapshot[];
  projectiles: Array<{ id: string; team: Team; x: number; y: number; radius: number }>;
  zones: Array<{ id: string; team: Team; x: number; y: number; radius: number; slow: boolean }>;
  events: RenderCombatEvent[];
  stats: Record<string, number>;
  objectives: Record<string, { team: Team; kind: 'tower' | 'core'; hp: number; maxHp: number; dead: boolean }>;
};

export type CombatSimulationReport = {
  ok: boolean;
  source: 'authoritative-sim-v1';
  errors: Array<{ field: string; code: string; message: string }>;
  warnings: Array<{ code: string; message: string }>;
  result: AuthoritativeSimulationResult;
  stateHash: string;
  stats: Record<string, number>;
  objectiveState: Record<string, { team: Team; kind: 'tower' | 'core'; hp: number; maxHp: number; dead: boolean }>;
};

export function heroRuleById(heroId: string): SharedHeroRule;
export function rewardForDefeat(kind: string): Readonly<{ gold: number; xp: number }>;
export function nextLevelXp(level: number): number;
export function calculateActionBudgets(input: {
  durationSec: number;
  attackCount: number;
  totalCasts: number;
  offensiveWeight: number;
  kills: number;
  victory: boolean;
}): {
  maxKills: number;
  maxGold: number;
  earnedXpBudget: number;
  maxLevel: number;
};
export function createInitialCombatState(input?: { heroId?: string; seed?: number; tutorial?: boolean }): unknown;
export function applyCombatActions(state: unknown, actions?: SharedAction[]): RenderCombatSnapshot;
export function stepCombatState(state: unknown, actions?: SharedAction[]): RenderCombatSnapshot;
export function renderCombatSnapshot(state: unknown): RenderCombatSnapshot;
export function simulateCombat(input?: {
  heroId?: string;
  seed?: number;
  actions?: SharedAction[];
  durationSec?: number;
  maxDurationSec?: number;
  tutorial?: boolean;
}): CombatSimulationReport;
export function canonicalStringify(value: unknown): string;
export function stableHash(input: string): string;
export function clampInt(value: unknown, min: number, max: number): number;
