import 'dotenv/config';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import {
  buySkin,
  claimDailyReward,
  completeTutorial,
  createSession,
  getOrCreateUser,
  getUserByTelegramId,
  getUserByToken,
  getMatchById,
  equipSkin,
  leaderboard,
  saveMatchResult,
  saveMatchStart,
  shopForUser,
  storageInfo
} from './db.js';
import { buildMatchValidationToken } from './deterministicReplay.js';
import { validateMatchResult } from './matchValidator.js';
import { devTelegramUser, validateTelegramInitData } from './telegramAuth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

const PORT = Number(process.env.API_PORT || process.env.PORT || 8787);
const HOST = process.env.API_HOST || '0.0.0.0';
const BOT_TOKEN = process.env.BOT_TOKEN || '';
const DEV_AUTH = process.env.DEV_AUTH !== 'false';
const BOT_API_SECRET = process.env.BOT_API_SECRET || '';
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'true';
const SERVE_CLIENT = ['1', 'true', 'yes', 'on'].includes(String(process.env.SERVE_CLIENT ?? 'false').toLowerCase());
const CLIENT_DIST_DIR = path.resolve(process.env.CLIENT_DIST_DIR || path.join(PROJECT_ROOT, 'dist'));

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: resolveCorsOrigin(CORS_ORIGIN),
  credentials: true
});

app.get('/health', async () => ({ ok: true, service: 'shonen-rift-api', storage: storageInfo(), ts: new Date().toISOString() }));

app.post('/api/auth/telegram', async (request, reply) => {
  const { initData } = request.body ?? {};
  const validation = validateTelegramInitData(initData, BOT_TOKEN);

  let telegramUser;
  let mode = 'telegram';

  if (validation.ok) {
    telegramUser = validation.user;
  } else if (DEV_AUTH) {
    telegramUser = devTelegramUser();
    mode = 'dev';
  } else {
    return reply.code(401).send({ ok: false, error: validation.reason || 'Telegram auth failed' });
  }

  const user = await getOrCreateUser(telegramUser);
  const token = await createSession(user);

  return { ok: true, mode, token, user: publicUser(user) };
});

app.get('/api/profile', { preHandler: authRequired }, async (request) => ({
  ok: true,
  user: publicUser(request.user)
}));

app.get('/api/heroes', async () => ({
  ok: true,
  heroes: [
    { id: 'kairo', name: 'Кайро', role: 'fighter', title: 'Пылающий Кулак' },
    { id: 'reyna', name: 'Рэйна', role: 'assassin', title: 'Лунная Клинковая' },
    { id: 'teo', name: 'Тэо', role: 'mage', title: 'Громовой Ученик' }
  ]
}));

app.post('/api/matches/start', { preHandler: authRequired }, async (request) => {
  const { heroId } = request.body ?? {};
  const allowed = ['kairo', 'reyna', 'teo'];
  const match = await saveMatchStart(request.user, { heroId: allowed.includes(heroId) ? heroId : 'kairo' });
  return {
    ok: true,
    match: {
      id: match.id,
      heroId: match.heroId,
      seed: match.seed,
      validationToken: buildMatchValidationToken(match, request.user),
      mode: 'bot_3v3',
      map: 'single_lane_shonen_arena'
    }
  };
});

app.post('/api/matches/:matchId/result', { preHandler: authRequired }, async (request, reply) => {
  const { matchId } = request.params;
  const match = await getMatchById(matchId);
  const validation = validateMatchResult({
    user: request.user,
    match,
    payload: request.body ?? {}
  });

  if (!validation.ok) {
    return reply.code(validation.statusCode).send({
      ok: false,
      error: 'Match result rejected by server-side validation.',
      validation
    });
  }

  const saved = await saveMatchResult(request.user, matchId, validation.sanitized);
  return {
    ok: true,
    result: saved.result,
    validation: {
      version: validation.version,
      warnings: validation.warnings,
      serverCalculated: validation.serverCalculated,
      resultSource: validation.resultSource,
      authoritativeReplay: validation.authoritativeReplay,
      authoritativeStateHash: validation.authoritativeStateHash,
      authoritativeResult: validation.authoritativeResult,
      clientSimulationMatched: validation.clientSimulationMatched
    },
    user: publicUser(saved.user)
  };
});

app.post('/api/rewards/daily', { preHandler: authRequired }, async (request) => {
  const reward = await claimDailyReward(request.user);
  return { ok: true, ...reward, user: publicUser(reward.user) };
});

app.post('/api/tutorial/complete', { preHandler: authRequired }, async (request) => {
  const tutorial = await completeTutorial(request.user);
  return { ok: true, ...tutorial, user: publicUser(tutorial.user) };
});

app.get('/api/leaderboard', async (request) => {
  const limit = Number(request.query?.limit ?? 10);
  return { ok: true, leaderboard: await leaderboard(Math.max(1, Math.min(50, limit))) };
});

app.get('/api/shop/skins', { preHandler: authRequired }, async (request) => ({
  ok: true,
  skins: await shopForUser(request.user),
  user: publicUser(request.user)
}));

app.post('/api/shop/buy', { preHandler: authRequired }, async (request, reply) => {
  const { skinId } = request.body ?? {};
  const result = await buySkin(request.user, skinId);
  if (!result.ok) return reply.code(400).send({ ...result, user: publicUser(result.user) });
  return { ...result, user: publicUser(result.user), skins: await shopForUser(result.user) };
});

app.post('/api/shop/equip', { preHandler: authRequired }, async (request, reply) => {
  const { heroId, skinId } = request.body ?? {};
  const result = await equipSkin(request.user, heroId, skinId);
  if (!result.ok) return reply.code(400).send({ ...result, user: publicUser(result.user) });
  return { ...result, user: publicUser(result.user), skins: await shopForUser(result.user) };
});

app.get('/api/bot/profile/:telegramId', async (request, reply) => {
  if (!checkBotSecret(request)) return reply.code(403).send({ ok: false, error: 'Forbidden' });
  const user = await getUserByTelegramId(request.params.telegramId);
  if (!user) return { ok: false, error: 'Профиль ещё не создан. Сначала откройте игру.' };
  return { ok: true, user: publicUser(user) };
});

app.post('/api/bot/daily/:telegramId', async (request, reply) => {
  if (!checkBotSecret(request)) return reply.code(403).send({ ok: false, error: 'Forbidden' });
  const user = await getUserByTelegramId(request.params.telegramId);
  if (!user) return { ok: false, error: 'Профиль ещё не создан. Сначала откройте игру.' };
  const reward = await claimDailyReward(user);
  return { ok: true, ...reward, user: publicUser(reward.user) };
});

app.setNotFoundHandler(async (request, reply) => {
  if (!SERVE_CLIENT) {
    return reply.code(404).send({ ok: false, error: 'Not found' });
  }

  const rawUrl = request.raw.url || '/';
  if (rawUrl.startsWith('/api/') || rawUrl === '/api' || rawUrl.startsWith('/health')) {
    return reply.code(404).send({ ok: false, error: 'API route not found' });
  }

  return serveClientAsset(rawUrl, reply);
});

async function authRequired(request, reply) {
  const header = request.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
  const user = await getUserByToken(token);
  if (!user) return reply.code(401).send({ ok: false, error: 'Unauthorized' });
  request.user = user;
}

function checkBotSecret(request) {
  if (!BOT_API_SECRET) return true;
  return request.headers['x-bot-secret'] === BOT_API_SECRET;
}

async function serveClientAsset(rawUrl, reply) {
  const url = new URL(rawUrl, 'http://local.preview');
  const decodedPath = safeDecodePath(url.pathname);
  const requestedPath = decodedPath === '/' ? '/index.html' : decodedPath;
  const absolutePath = path.resolve(CLIENT_DIST_DIR, `.${requestedPath}`);

  if (!absolutePath.startsWith(`${CLIENT_DIST_DIR}${path.sep}`) && absolutePath !== CLIENT_DIST_DIR) {
    return reply.code(403).send({ ok: false, error: 'Forbidden' });
  }

  const directFile = await fileIfExists(absolutePath);
  if (directFile) return sendFile(reply, directFile, requestedPath);

  const hasExtension = path.extname(requestedPath) !== '';
  if (hasExtension) return reply.code(404).send({ ok: false, error: 'Static asset not found' });

  const indexFile = await fileIfExists(path.join(CLIENT_DIST_DIR, 'index.html'));
  if (indexFile) return sendFile(reply, indexFile, '/index.html');

  return reply.code(503).send({
    ok: false,
    error: 'Client bundle is not built yet. Run npm run build or disable SERVE_CLIENT.'
  });
}

function safeDecodePath(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return '/';
  }
}

async function fileIfExists(filePath) {
  try {
    const stats = await fsp.stat(filePath);
    return stats.isFile() ? filePath : null;
  } catch {
    return null;
  }
}

function sendFile(reply, filePath, requestPath) {
  const ext = path.extname(filePath).toLowerCase();
  const isHtml = ext === '.html';
  reply.header('content-type', contentTypeForExt(ext));
  reply.header('cache-control', isHtml ? 'no-cache' : 'public, max-age=31536000, immutable');
  reply.header('x-content-type-options', 'nosniff');
  return reply.send(fs.createReadStream(filePath));
}

function contentTypeForExt(ext) {
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav'
  };
  return types[ext] || 'application/octet-stream';
}

function resolveCorsOrigin(value) {
  if (!value || value === 'true' || value === '*') return true;
  if (value === 'false') return false;
  const allowed = value.split(',').map((origin) => origin.trim()).filter(Boolean);
  return (origin, cb) => {
    if (!origin || allowed.includes(origin)) return cb(null, true);
    return cb(new Error('Origin is not allowed by CORS'), false);
  };
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    telegramId: user.telegramId,
    username: user.username,
    firstName: user.firstName,
    avatarUrl: user.avatarUrl,
    stats: user.stats,
    inventory: user.inventory,
    daily: user.daily,
    tutorial: user.tutorial
  };
}

try {
  await app.listen({ host: HOST, port: PORT });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
