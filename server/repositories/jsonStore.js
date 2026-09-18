import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { getSkinById, SKINS } from '../catalogue.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'dev-db.json');

const DEFAULT_DB = {
  users: {},
  sessions: {},
  matches: {},
  results: []
};

function ensureDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify(DEFAULT_DB, null, 2));
  }
}

export function readDb() {
  ensureDb();
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch {
    return structuredClone(DEFAULT_DB);
  }
}

export function writeDb(db) {
  ensureDb();
  const tmp = `${DB_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_PATH);
}

export function createId(prefix) {
  return `${prefix}_${crypto.randomBytes(12).toString('hex')}`;
}

export function nowIso() {
  return new Date().toISOString();
}

export function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

export function getOrCreateUser(telegramUser) {
  const db = readDb();
  const telegramId = String(telegramUser.id);
  let user = db.users[telegramId];

  if (!user) {
    user = {
      id: createId('user'),
      telegramId,
      username: telegramUser.username ?? '',
      firstName: telegramUser.first_name ?? telegramUser.firstName ?? 'Player',
      avatarUrl: telegramUser.photo_url ?? '',
      createdAt: nowIso(),
      updatedAt: nowIso(),
      stats: {
        matches: 0,
        wins: 0,
        losses: 0,
        kills: 0,
        deaths: 0,
        gold: 0,
        bestTimeSec: null,
        rating: 1000
      },
      inventory: {
        soft: 200,
        skins: [],
        selectedSkinByHero: {}
      },
      daily: {
        lastClaimKey: null,
        streak: 0
      },
      tutorial: {
        completed: false,
        completedAt: null
      }
    };
  } else {
    user = normalizeUser(user);
    user.username = telegramUser.username ?? user.username;
    user.firstName = telegramUser.first_name ?? telegramUser.firstName ?? user.firstName;
    user.avatarUrl = telegramUser.photo_url ?? user.avatarUrl;
    user.updatedAt = nowIso();
  }

  db.users[telegramId] = user;
  writeDb(db);
  return user;
}

export function createSession(user) {
  const db = readDb();
  const token = createId('session');
  db.sessions[token] = {
    token,
    telegramId: user.telegramId,
    userId: user.id,
    createdAt: nowIso(),
    expiresAt: Date.now() + 1000 * 60 * 60 * 24 * 30
  };
  writeDb(db);
  return token;
}

export function getUserByToken(token) {
  if (!token) return null;
  const db = readDb();
  const session = db.sessions[token];
  if (!session || session.expiresAt < Date.now()) return null;
  const user = db.users[session.telegramId] ?? null;
  return user ? normalizeUser(user) : null;
}

export function getUserByTelegramId(telegramId) {
  const db = readDb();
  const user = db.users[String(telegramId)] ?? null;
  return user ? normalizeUser(user) : null;
}

export function getMatchById(matchId) {
  const db = readDb();
  return db.matches[matchId] ?? null;
}

export function saveMatchStart(user, payload) {
  const db = readDb();
  const matchId = createId('match');
  const seed = crypto.randomInt(1, 2_000_000_000);
  db.matches[matchId] = {
    id: matchId,
    userId: user.id,
    telegramId: user.telegramId,
    heroId: payload.heroId,
    seed,
    status: 'started',
    startedAt: nowIso(),
    createdAtMs: Date.now()
  };
  writeDb(db);
  return db.matches[matchId];
}

export function saveMatchResult(user, matchId, result) {
  const db = readDb();
  const match = db.matches[matchId];
  const safeResult = sanitizeResult(result);
  const victory = Boolean(safeResult.victory);

  if (match && match.userId === user.id) {
    match.status = 'finished';
    match.finishedAt = nowIso();
    match.result = safeResult;
  }

  const storedResult = {
    id: createId('result'),
    userId: user.id,
    telegramId: user.telegramId,
    username: user.username,
    firstName: user.firstName,
    matchId: matchId ?? null,
    createdAt: nowIso(),
    ...safeResult
  };

  db.results.unshift(storedResult);
  db.results = db.results.slice(0, 1000);

  const dbUser = normalizeUser(db.users[user.telegramId]);
  dbUser.stats.matches += 1;
  if (victory) dbUser.stats.wins += 1;
  else dbUser.stats.losses += 1;
  dbUser.stats.kills += safeResult.kills;
  dbUser.stats.deaths += safeResult.deaths;
  dbUser.stats.gold += safeResult.gold;
  dbUser.stats.rating += victory ? 18 + Math.min(12, safeResult.kills * 2) : -8;

  if (victory && safeResult.durationSec > 0) {
    if (!dbUser.stats.bestTimeSec || safeResult.durationSec < dbUser.stats.bestTimeSec) {
      dbUser.stats.bestTimeSec = safeResult.durationSec;
    }
  }

  dbUser.inventory.soft += victory ? 60 : 25;
  dbUser.updatedAt = nowIso();

  writeDb(db);
  return { result: storedResult, user: dbUser };
}

export function claimDailyReward(user) {
  const db = readDb();
  const dbUser = normalizeUser(db.users[user.telegramId]);
  const key = todayKey();

  if (dbUser.daily.lastClaimKey === key) {
    return { claimed: false, reward: 0, user: dbUser, message: 'Ежедневная награда уже получена сегодня.' };
  }

  const previous = dbUser.daily.lastClaimKey ? new Date(dbUser.daily.lastClaimKey) : null;
  const today = new Date(key);
  const diffDays = previous ? Math.round((today.getTime() - previous.getTime()) / 86400000) : null;
  dbUser.daily.streak = diffDays === 1 ? dbUser.daily.streak + 1 : 1;
  dbUser.daily.lastClaimKey = key;

  const reward = 100 + Math.min(7, dbUser.daily.streak) * 15;
  dbUser.inventory.soft += reward;
  dbUser.updatedAt = nowIso();
  writeDb(db);

  return { claimed: true, reward, user: dbUser, message: `Получено ${reward} искр. Серия: ${dbUser.daily.streak} дн.` };
}

export function completeTutorial(user) {
  const db = readDb();
  const dbUser = normalizeUser(db.users[user.telegramId]);

  if (dbUser.tutorial.completed) {
    return {
      completed: false,
      reward: 0,
      user: dbUser,
      message: 'Обучение уже пройдено. Награда за tutorial выдаётся один раз.'
    };
  }

  const reward = 120;
  dbUser.tutorial.completed = true;
  dbUser.tutorial.completedAt = nowIso();
  dbUser.inventory.soft += reward;
  dbUser.updatedAt = nowIso();
  db.users[user.telegramId] = dbUser;
  writeDb(db);

  return {
    completed: true,
    reward,
    user: dbUser,
    message: `Обучение завершено. Получено ${reward} искр.`
  };
}

export function leaderboard(limit = 10) {
  const db = readDb();
  return Object.values(db.users)
    .map((user) => ({
      telegramId: user.telegramId,
      username: user.username,
      firstName: user.firstName,
      matches: user.stats.matches,
      wins: user.stats.wins,
      losses: user.stats.losses,
      kills: user.stats.kills,
      deaths: user.stats.deaths,
      rating: user.stats.rating,
      bestTimeSec: user.stats.bestTimeSec
    }))
    .sort((a, b) => b.rating - a.rating || b.wins - a.wins || a.bestTimeSec - b.bestTimeSec)
    .slice(0, limit);
}

export function shopForUser(user) {
  const normalized = normalizeUser(user);
  return SKINS.map((skin) => ({
    ...skin,
    owned: normalized.inventory.skins.includes(skin.id),
    equipped: normalized.inventory.selectedSkinByHero[skin.heroId] === skin.id
  }));
}

export function buySkin(user, skinId) {
  const db = readDb();
  const dbUser = normalizeUser(db.users[user.telegramId]);
  const skin = getSkinById(skinId);

  if (!skin) {
    return { ok: false, error: 'Скин не найден.', user: dbUser };
  }

  if (dbUser.inventory.skins.includes(skin.id)) {
    return { ok: true, alreadyOwned: true, message: 'Скин уже куплен.', skin, user: dbUser };
  }

  if (dbUser.inventory.soft < skin.price) {
    return { ok: false, error: `Недостаточно искр. Нужно ${skin.price}, у вас ${dbUser.inventory.soft}.`, skin, user: dbUser };
  }

  dbUser.inventory.soft -= skin.price;
  dbUser.inventory.skins.push(skin.id);
  dbUser.inventory.selectedSkinByHero[skin.heroId] = skin.id;
  dbUser.updatedAt = nowIso();
  db.users[user.telegramId] = dbUser;
  writeDb(db);

  return { ok: true, purchased: true, message: `Куплен и экипирован скин «${skin.name}».`, skin, user: dbUser };
}

export function equipSkin(user, heroId, skinId) {
  const db = readDb();
  const dbUser = normalizeUser(db.users[user.telegramId]);

  if (!skinId || skinId === 'default') {
    delete dbUser.inventory.selectedSkinByHero[heroId];
    dbUser.updatedAt = nowIso();
    db.users[user.telegramId] = dbUser;
    writeDb(db);
    return { ok: true, message: 'Экипирован стандартный образ.', user: dbUser, skin: null };
  }

  const skin = getSkinById(skinId);
  if (!skin || skin.heroId !== heroId) {
    return { ok: false, error: 'Скин не подходит этому герою.', user: dbUser };
  }

  if (!dbUser.inventory.skins.includes(skin.id)) {
    return { ok: false, error: 'Сначала купите этот скин.', skin, user: dbUser };
  }

  dbUser.inventory.selectedSkinByHero[heroId] = skin.id;
  dbUser.updatedAt = nowIso();
  db.users[user.telegramId] = dbUser;
  writeDb(db);

  return { ok: true, message: `Экипирован скин «${skin.name}».`, skin, user: dbUser };
}

function normalizeUser(user) {
  if (!user) return user;
  user.stats ??= {};
  user.stats.matches ??= 0;
  user.stats.wins ??= 0;
  user.stats.losses ??= 0;
  user.stats.kills ??= 0;
  user.stats.deaths ??= 0;
  user.stats.gold ??= 0;
  user.stats.bestTimeSec ??= null;
  user.stats.rating ??= 1000;
  user.inventory ??= {};
  user.inventory.soft ??= 0;
  user.inventory.skins ??= [];
  user.inventory.selectedSkinByHero ??= {};
  user.daily ??= {};
  user.daily.lastClaimKey ??= null;
  user.daily.streak ??= 0;
  user.tutorial ??= {};
  user.tutorial.completed ??= false;
  user.tutorial.completedAt ??= null;
  return user;
}

function sanitizeResult(result = {}) {
  return {
    victory: Boolean(result.victory),
    winner: result.winner === 'red' ? 'red' : 'blue',
    durationSec: clampInt(result.durationSec, 0, 60 * 60),
    heroName: String(result.heroName ?? 'Unknown').slice(0, 64),
    heroId: String(result.heroId ?? '').slice(0, 64),
    kills: clampInt(result.kills, 0, 200),
    deaths: clampInt(result.deaths, 0, 200),
    gold: clampInt(result.gold, 0, 100000),
    level: clampInt(result.level, 1, 30)
  };
}

function clampInt(value, min, max) {
  const n = Number.parseInt(String(value), 10);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}
