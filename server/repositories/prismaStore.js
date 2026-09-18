import crypto from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { getSkinById, SKINS } from '../catalogue.js';

const prisma = new PrismaClient();

const userInclude = {
  ownedSkins: true,
  equippedSkins: true
};

export function createId(prefix) {
  return `${prefix}_${crypto.randomBytes(12).toString('hex')}`;
}

export function nowIso() {
  return new Date().toISOString();
}

export function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

export async function getOrCreateUser(telegramUser) {
  const telegramId = String(telegramUser.id);
  const data = {
    username: telegramUser.username ?? '',
    firstName: telegramUser.first_name ?? telegramUser.firstName ?? 'Player',
    avatarUrl: telegramUser.photo_url ?? ''
  };

  const user = await prisma.user.upsert({
    where: { telegramId },
    update: data,
    create: {
      telegramId,
      ...data,
      soft: 200
    },
    include: userInclude
  });

  return toPublicUser(user);
}

export async function createSession(user) {
  const token = createId('session');
  await prisma.session.create({
    data: {
      token,
      userId: user.id,
      telegramId: user.telegramId,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30)
    }
  });
  return token;
}

export async function getUserByToken(token) {
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { token },
    include: { user: { include: userInclude } }
  });

  if (!session) return null;
  if (session.expiresAt.getTime() < Date.now()) {
    await prisma.session.delete({ where: { token } }).catch(() => null);
    return null;
  }

  return toPublicUser(session.user);
}

export async function getUserByTelegramId(telegramId) {
  const user = await prisma.user.findUnique({
    where: { telegramId: String(telegramId) },
    include: userInclude
  });
  return user ? toPublicUser(user) : null;
}

export async function getMatchById(matchId) {
  const match = await prisma.match.findUnique({ where: { id: matchId } });
  if (!match) return null;
  return {
    ...match,
    createdAtMs: Number(match.createdAtMs),
    startedAt: match.startedAt.toISOString(),
    finishedAt: match.finishedAt ? match.finishedAt.toISOString() : null
  };
}

export async function saveMatchStart(user, payload) {
  return prisma.match.create({
    data: {
      id: createId('match'),
      userId: user.id,
      telegramId: user.telegramId,
      heroId: payload.heroId,
      seed: crypto.randomInt(1, 2_000_000_000),
      status: 'started',
      createdAtMs: BigInt(Date.now())
    }
  });
}

export async function saveMatchResult(user, matchId, result) {
  const safeResult = sanitizeResult(result);
  const victory = Boolean(safeResult.victory);
  const ratingDelta = victory ? 18 + Math.min(12, safeResult.kills * 2) : -8;
  const softGain = victory ? 60 : 25;

  return prisma.$transaction(async (tx) => {
    let validMatchId = null;

    if (matchId) {
      const match = await tx.match.findUnique({ where: { id: matchId } });
      if (match && match.userId === user.id) {
        validMatchId = match.id;
        await tx.match.update({
          where: { id: match.id },
          data: {
            status: 'finished',
            finishedAt: new Date()
          }
        });
      }
    }

    const dbUser = await tx.user.findUnique({ where: { id: user.id } });
    const nextBestTimeSec = victory && safeResult.durationSec > 0
      ? (!dbUser.bestTimeSec || safeResult.durationSec < dbUser.bestTimeSec ? safeResult.durationSec : dbUser.bestTimeSec)
      : dbUser.bestTimeSec;

    const storedResult = await tx.matchResult.create({
      data: {
        id: createId('result'),
        userId: user.id,
        telegramId: user.telegramId,
        username: user.username ?? '',
        firstName: user.firstName ?? 'Player',
        matchId: validMatchId,
        ...safeResult
      }
    });

    await tx.user.update({
      where: { id: user.id },
      data: {
        matches: { increment: 1 },
        wins: victory ? { increment: 1 } : undefined,
        losses: victory ? undefined : { increment: 1 },
        kills: { increment: safeResult.kills },
        deaths: { increment: safeResult.deaths },
        gold: { increment: safeResult.gold },
        rating: { increment: ratingDelta },
        soft: { increment: softGain },
        bestTimeSec: nextBestTimeSec
      }
    });

    const updatedUser = await tx.user.findUnique({
      where: { id: user.id },
      include: userInclude
    });

    return { result: toPublicResult(storedResult), user: toPublicUser(updatedUser) };
  });
}

export async function claimDailyReward(user) {
  const dbUser = await prisma.user.findUnique({ where: { id: user.id }, include: userInclude });
  const key = todayKey();

  if (dbUser.dailyLastClaimKey === key) {
    return { claimed: false, reward: 0, user: toPublicUser(dbUser), message: 'Ежедневная награда уже получена сегодня.' };
  }

  const previous = dbUser.dailyLastClaimKey ? new Date(dbUser.dailyLastClaimKey) : null;
  const today = new Date(key);
  const diffDays = previous ? Math.round((today.getTime() - previous.getTime()) / 86400000) : null;
  const streak = diffDays === 1 ? dbUser.dailyStreak + 1 : 1;
  const reward = 100 + Math.min(7, streak) * 15;

  const updatedUser = await prisma.user.update({
    where: { id: user.id },
    data: {
      dailyLastClaimKey: key,
      dailyStreak: streak,
      soft: { increment: reward }
    },
    include: userInclude
  });

  return { claimed: true, reward, user: toPublicUser(updatedUser), message: `Получено ${reward} искр. Серия: ${streak} дн.` };
}

export async function completeTutorial(user) {
  const dbUser = await prisma.user.findUnique({ where: { id: user.id }, include: userInclude });

  if (dbUser.tutorialCompleted) {
    return {
      completed: false,
      reward: 0,
      user: toPublicUser(dbUser),
      message: 'Обучение уже пройдено. Награда за tutorial выдаётся один раз.'
    };
  }

  const reward = 120;
  const updatedUser = await prisma.user.update({
    where: { id: user.id },
    data: {
      tutorialCompleted: true,
      tutorialCompletedAt: new Date(),
      soft: { increment: reward }
    },
    include: userInclude
  });

  return {
    completed: true,
    reward,
    user: toPublicUser(updatedUser),
    message: `Обучение завершено. Получено ${reward} искр.`
  };
}

export async function leaderboard(limit = 10) {
  const rows = await prisma.user.findMany({
    orderBy: [
      { rating: 'desc' },
      { wins: 'desc' },
      { bestTimeSec: 'asc' }
    ],
    take: limit
  });

  return rows.map((user) => ({
    telegramId: user.telegramId,
    username: user.username,
    firstName: user.firstName,
    matches: user.matches,
    wins: user.wins,
    losses: user.losses,
    kills: user.kills,
    deaths: user.deaths,
    rating: user.rating,
    bestTimeSec: user.bestTimeSec
  }));
}

export async function shopForUser(user) {
  const profile = await getUserByTelegramId(user.telegramId);
  return SKINS.map((skin) => ({
    ...skin,
    owned: profile.inventory.skins.includes(skin.id),
    equipped: profile.inventory.selectedSkinByHero[skin.heroId] === skin.id
  }));
}

export async function buySkin(user, skinId) {
  const skin = getSkinById(skinId);
  if (!skin) {
    const profile = await getUserByTelegramId(user.telegramId);
    return { ok: false, error: 'Скин не найден.', user: profile };
  }

  return prisma.$transaction(async (tx) => {
    const dbUser = await tx.user.findUnique({
      where: { id: user.id },
      include: userInclude
    });

    const alreadyOwned = dbUser.ownedSkins.some((item) => item.skinId === skin.id);
    if (alreadyOwned) {
      return { ok: true, alreadyOwned: true, message: 'Скин уже куплен.', skin, user: toPublicUser(dbUser) };
    }

    if (dbUser.soft < skin.price) {
      return { ok: false, error: `Недостаточно искр. Нужно ${skin.price}, у вас ${dbUser.soft}.`, skin, user: toPublicUser(dbUser) };
    }

    await tx.user.update({
      where: { id: user.id },
      data: { soft: { decrement: skin.price } }
    });

    await tx.skinOwnership.create({
      data: {
        userId: user.id,
        skinId: skin.id
      }
    });

    await tx.skinEquip.upsert({
      where: { userId_heroId: { userId: user.id, heroId: skin.heroId } },
      update: { skinId: skin.id },
      create: { userId: user.id, heroId: skin.heroId, skinId: skin.id }
    });

    const updatedUser = await tx.user.findUnique({ where: { id: user.id }, include: userInclude });
    return { ok: true, purchased: true, message: `Куплен и экипирован скин «${skin.name}».`, skin, user: toPublicUser(updatedUser) };
  });
}

export async function equipSkin(user, heroId, skinId) {
  if (!skinId || skinId === 'default') {
    await prisma.skinEquip.delete({ where: { userId_heroId: { userId: user.id, heroId } } }).catch(() => null);
    const updatedUser = await prisma.user.findUnique({ where: { id: user.id }, include: userInclude });
    return { ok: true, message: 'Экипирован стандартный образ.', user: toPublicUser(updatedUser), skin: null };
  }

  const skin = getSkinById(skinId);
  const profile = await prisma.user.findUnique({ where: { id: user.id }, include: userInclude });

  if (!skin || skin.heroId !== heroId) {
    return { ok: false, error: 'Скин не подходит этому герою.', user: toPublicUser(profile) };
  }

  if (!profile.ownedSkins.some((item) => item.skinId === skin.id)) {
    return { ok: false, error: 'Сначала купите этот скин.', skin, user: toPublicUser(profile) };
  }

  await prisma.skinEquip.upsert({
    where: { userId_heroId: { userId: user.id, heroId } },
    update: { skinId: skin.id },
    create: { userId: user.id, heroId, skinId: skin.id }
  });

  const updatedUser = await prisma.user.findUnique({ where: { id: user.id }, include: userInclude });
  return { ok: true, message: `Экипирован скин «${skin.name}».`, skin, user: toPublicUser(updatedUser) };
}

function toPublicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    telegramId: user.telegramId,
    username: user.username ?? '',
    firstName: user.firstName ?? 'Player',
    avatarUrl: user.avatarUrl ?? '',
    stats: {
      matches: user.matches ?? 0,
      wins: user.wins ?? 0,
      losses: user.losses ?? 0,
      kills: user.kills ?? 0,
      deaths: user.deaths ?? 0,
      gold: user.gold ?? 0,
      bestTimeSec: user.bestTimeSec ?? null,
      rating: user.rating ?? 1000
    },
    inventory: {
      soft: user.soft ?? 0,
      skins: user.ownedSkins?.map((item) => item.skinId) ?? [],
      selectedSkinByHero: Object.fromEntries((user.equippedSkins ?? []).map((item) => [item.heroId, item.skinId]))
    },
    daily: {
      lastClaimKey: user.dailyLastClaimKey ?? null,
      streak: user.dailyStreak ?? 0
    },
    tutorial: {
      completed: user.tutorialCompleted ?? false,
      completedAt: user.tutorialCompletedAt ? user.tutorialCompletedAt.toISOString() : null
    }
  };
}

function toPublicResult(result) {
  return {
    ...result,
    createdAt: result.createdAt?.toISOString?.() ?? result.createdAt
  };
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
