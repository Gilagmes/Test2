import crypto from 'node:crypto';

export function parseInitData(initData) {
  const params = new URLSearchParams(initData || '');
  const data = {};
  for (const [key, value] of params.entries()) {
    if (key === 'user') {
      try {
        data.user = JSON.parse(value);
      } catch {
        data.user = null;
      }
    } else {
      data[key] = value;
    }
  }
  return data;
}

export function validateTelegramInitData(initData, botToken) {
  if (!initData || !botToken) {
    return { ok: false, reason: 'Missing initData or BOT_TOKEN' };
  }

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return { ok: false, reason: 'Missing hash' };

  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  const hashBuffer = Buffer.from(hash, 'hex');
  const calculatedBuffer = Buffer.from(calculatedHash, 'hex');
  const safeEqual = hashBuffer.length === calculatedBuffer.length && crypto.timingSafeEqual(hashBuffer, calculatedBuffer);

  if (!safeEqual) return { ok: false, reason: 'Invalid hash' };

  const parsed = parseInitData(initData);
  if (!parsed.user?.id) return { ok: false, reason: 'Missing Telegram user' };

  const authDate = Number(parsed.auth_date ?? 0);
  const maxAgeSec = 60 * 60 * 24;
  if (authDate && Math.floor(Date.now() / 1000) - authDate > maxAgeSec) {
    return { ok: false, reason: 'initData expired' };
  }

  return { ok: true, user: parsed.user };
}

export function devTelegramUser() {
  return {
    id: process.env.DEV_TELEGRAM_ID || 100001,
    first_name: process.env.DEV_FIRST_NAME || 'Dev Player',
    username: process.env.DEV_USERNAME || 'dev_player',
    language_code: 'ru'
  };
}
