export type PlayerStats = {
  matches: number;
  wins: number;
  losses: number;
  kills: number;
  deaths: number;
  gold: number;
  bestTimeSec: number | null;
  rating: number;
};

export type PlayerProfile = {
  id: string;
  telegramId: string;
  username: string;
  firstName: string;
  avatarUrl: string;
  stats: PlayerStats;
  inventory: {
    soft: number;
    skins: string[];
    selectedSkinByHero: Record<string, string>;
  };
  daily: {
    lastClaimKey: string | null;
    streak: number;
  };
  tutorial: {
    completed: boolean;
    completedAt: string | null;
  };
};

export type ApiSession = {
  ok: boolean;
  mode: 'telegram' | 'dev' | 'offline';
  token: string;
  user: PlayerProfile;
};


export type ShopSkin = {
  id: string;
  heroId: string;
  heroName: string;
  name: string;
  rarity: 'rare' | 'epic' | string;
  price: number;
  color: number;
  accent: number;
  description: string;
  owned: boolean;
  equipped: boolean;
};

export type LeaderboardEntry = {
  telegramId: string;
  username: string;
  firstName: string;
  matches: number;
  wins: number;
  losses: number;
  kills: number;
  deaths: number;
  rating: number;
  bestTimeSec: number | null;
};

export type MatchStart = {
  id: string;
  heroId: string;
  seed: number;
  mode: string;
  map: string;
  validationToken?: string;
};

export type ClientEventActor = {
  id?: string;
  team?: 'blue' | 'red';
  kind?: string;
  controller?: string;
  heroId?: string;
  tag?: string;
};

export type ClientEventLogEntry = {
  t: number;
  type: string;
  actor?: ClientEventActor;
  target?: ClientEventActor;
  x?: number;
  y?: number;
  targetX?: number;
  targetY?: number;
  slot?: string;
  amount?: number;
  hpAfter?: number;
  defeatedKind?: string;
  objective?: string;
  winner?: 'blue' | 'red';
  goldAfter?: number;
  levelAfter?: number;
  data?: Record<string, unknown>;
};


export type ClientActionStreamEntry = {
  seq: number;
  t: number;
  type: 'match_start' | 'move' | 'attack' | 'cast' | 'match_end' | 'action_stream_truncated' | string;
  x?: number;
  y?: number;
  dx?: number;
  dy?: number;
  slot?: 'primary' | 'secondary' | 'ultimate' | string;
  target?: ClientEventActor;
  targetX?: number;
  targetY?: number;
  data?: Record<string, unknown>;
};

export type ClientActionStream = {
  version: 'client-action-stream-v1';
  matchId: string | null;
  heroId: string;
  seed: number | null;
  validationToken: string | null;
  tickRate: number;
  startedAtClientMs: number;
  actions: ClientActionStreamEntry[];
  summary: {
    durationSec: number;
    lastX: number;
    lastY: number;
    moveSamples: number;
    attackCount: number;
    castCounts: Record<'primary' | 'secondary' | 'ultimate', number>;
    truncated: boolean;
  };
  clientSimulation?: {
    source: 'authoritative-sim-v1' | string;
    stateHash: string;
    result: {
      terminal: boolean;
      victory: boolean;
      winner: 'blue' | 'red';
      durationSec: number;
      heroName: string;
      heroId: string;
      kills: number;
      deaths: number;
      gold: number;
      level: number;
    };
  };
  integrityHash: string;
};

export type ClientEventLog = {
  version: 'client-event-log-v1';
  matchId: string | null;
  heroId: string;
  seed: number | null;
  startedAtClientMs: number;
  events: ClientEventLogEntry[];
  summary: {
    victory: boolean;
    winner: 'blue' | 'red';
    durationSec: number;
    kills: number;
    deaths: number;
    gold: number;
    level: number;
    towersDestroyed: number;
    coreDestroyed: boolean;
  };
};

export type SubmitResultPayload = {
  victory: boolean;
  winner: 'blue' | 'red';
  durationSec: number;
  heroName: string;
  heroId: string;
  kills: number;
  deaths: number;
  gold: number;
  level: number;
  eventLog?: ClientEventLog;
  actionStream?: ClientActionStream;
};

export type MatchSubmitResponse = {
  ok: boolean;
  user?: PlayerProfile;
  result?: Partial<SubmitResultPayload> & { id?: string; matchId?: string | null; createdAt?: string };
  error?: string;
  validation?: {
    version?: string;
    warnings?: Array<{ code: string; message: string }>;
    errors?: Array<{ field: string; code: string; message: string }>;
    serverCalculated?: boolean;
    resultSource?: string;
    authoritativeReplay?: boolean;
    authoritativeStateHash?: string | null;
    authoritativeResult?: Partial<SubmitResultPayload> & { source?: string; terminal?: boolean } | null;
    clientSimulationMatched?: boolean | null;
  };
};

const API_BASE = import.meta.env.VITE_API_BASE || '';

export async function apiLogin(initData: string): Promise<ApiSession | null> {
  const response = await apiFetch('/api/auth/telegram', {
    method: 'POST',
    body: JSON.stringify({ initData })
  }, false);
  return response as ApiSession | null;
}

export async function apiGetProfile(token: string): Promise<PlayerProfile | null> {
  const response = await apiFetch('/api/profile', { method: 'GET' }, true, token);
  return response?.user ?? null;
}

export async function apiStartMatch(token: string, heroId: string): Promise<MatchStart | null> {
  const response = await apiFetch('/api/matches/start', {
    method: 'POST',
    body: JSON.stringify({ heroId })
  }, true, token);
  return response?.match ?? null;
}

export async function apiSubmitMatchResult(token: string, matchId: string | null, payload: SubmitResultPayload): Promise<MatchSubmitResponse | null> {
  if (!matchId) return null;
  const response = await apiFetch(`/api/matches/${encodeURIComponent(matchId)}/result`, {
    method: 'POST',
    body: JSON.stringify(payload)
  }, true, token);
  return response ?? null;
}

export async function apiClaimDaily(token: string): Promise<{ claimed: boolean; reward: number; message: string; user: PlayerProfile } | null> {
  const response = await apiFetch('/api/rewards/daily', { method: 'POST', body: JSON.stringify({}) }, true, token);
  return response ?? null;
}

export async function apiCompleteTutorial(token: string): Promise<{ completed: boolean; reward: number; message: string; user: PlayerProfile } | null> {
  const response = await apiFetch('/api/tutorial/complete', { method: 'POST', body: JSON.stringify({}) }, true, token);
  return response ?? null;
}

export async function apiGetLeaderboard(limit = 10): Promise<LeaderboardEntry[]> {
  const response = await apiFetch(`/api/leaderboard?limit=${limit}`, { method: 'GET' }, false);
  return response?.leaderboard ?? [];
}

export async function apiGetShopSkins(token: string): Promise<{ skins: ShopSkin[]; user: PlayerProfile } | null> {
  const response = await apiFetch('/api/shop/skins', { method: 'GET' }, true, token);
  if (!response?.ok) return null;
  return { skins: response.skins ?? [], user: response.user };
}

export async function apiBuySkin(token: string, skinId: string): Promise<{ ok: boolean; message?: string; error?: string; skins?: ShopSkin[]; user?: PlayerProfile } | null> {
  const response = await apiFetch('/api/shop/buy', {
    method: 'POST',
    body: JSON.stringify({ skinId })
  }, true, token);
  return response ?? null;
}

export async function apiEquipSkin(token: string, heroId: string, skinId: string | null): Promise<{ ok: boolean; message?: string; error?: string; skins?: ShopSkin[]; user?: PlayerProfile } | null> {
  const response = await apiFetch('/api/shop/equip', {
    method: 'POST',
    body: JSON.stringify({ heroId, skinId })
  }, true, token);
  return response ?? null;
}

async function apiFetch(path: string, init: RequestInit, protectedRoute: boolean, token?: string): Promise<any | null> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 2200);

  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        ...(protectedRoute && token ? { authorization: `Bearer ${token}` } : {}),
        ...(init.headers ?? {})
      }
    });

    return await response.json();
  } catch {
    return null;
  } finally {
    window.clearTimeout(timeout);
  }
}
