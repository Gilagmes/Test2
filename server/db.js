const requestedDriver = process.env.STORAGE_DRIVER || (process.env.DATABASE_URL ? 'prisma' : 'json');

let store;
let activeDriver = 'json';

if (requestedDriver === 'prisma') {
  try {
    store = await import('./repositories/prismaStore.js');
    activeDriver = 'prisma';
  } catch (error) {
    if (process.env.STORAGE_DRIVER === 'prisma') {
      console.error('Failed to initialize Prisma storage. Check DATABASE_URL and run `npm run db:generate` / migrations.');
      throw error;
    }
    console.warn('Prisma storage unavailable, falling back to JSON storage:', error?.message ?? error);
    store = await import('./repositories/jsonStore.js');
    activeDriver = 'json';
  }
} else {
  store = await import('./repositories/jsonStore.js');
}

export function storageInfo() {
  return {
    driver: activeDriver,
    requestedDriver
  };
}

export async function getOrCreateUser(...args) {
  return store.getOrCreateUser(...args);
}

export async function createSession(...args) {
  return store.createSession(...args);
}

export async function getUserByToken(...args) {
  return store.getUserByToken(...args);
}

export async function getUserByTelegramId(...args) {
  return store.getUserByTelegramId(...args);
}

export async function getMatchById(...args) {
  return store.getMatchById(...args);
}

export async function saveMatchStart(...args) {
  return store.saveMatchStart(...args);
}

export async function saveMatchResult(...args) {
  return store.saveMatchResult(...args);
}

export async function claimDailyReward(...args) {
  return store.claimDailyReward(...args);
}

export async function completeTutorial(...args) {
  return store.completeTutorial(...args);
}

export async function leaderboard(...args) {
  return store.leaderboard(...args);
}

export async function shopForUser(...args) {
  return store.shopForUser(...args);
}

export async function buySkin(...args) {
  return store.buySkin(...args);
}

export async function equipSkin(...args) {
  return store.equipSkin(...args);
}
