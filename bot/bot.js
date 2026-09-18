import 'dotenv/config';
import { Bot, InlineKeyboard } from 'grammy';

const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBAPP_URL = process.env.WEBAPP_URL || process.env.PUBLIC_WEBAPP_URL || 'https://example.com';
const API_URL = process.env.API_URL || 'http://127.0.0.1:8787';
const BOT_API_SECRET = process.env.BOT_API_SECRET || '';

if (!BOT_TOKEN) {
  console.error('BOT_TOKEN is required. Create .env from .env.example and set BOT_TOKEN.');
  process.exit(1);
}

const bot = new Bot(BOT_TOKEN);

function mainKeyboard() {
  return new InlineKeyboard()
    .webApp('🎮 Играть', WEBAPP_URL)
    .webApp('🛒 Магазин', WEBAPP_URL)
    .row()
    .text('👤 Профиль', 'profile')
    .text('🎁 Daily', 'daily')
    .row()
    .text('🏆 Лидерборд', 'leaderboard')
    .text('❓ Помощь', 'help');
}

bot.command('start', async (ctx) => {
  await ctx.reply(
    'Добро пожаловать в Shonen Rift: Telegram Arena. Запускайте MOBA-матч прямо внутри Telegram.',
    { reply_markup: mainKeyboard() }
  );
});

bot.command('play', async (ctx) => {
  await ctx.reply('Нажмите кнопку, чтобы открыть игру:', {
    reply_markup: new InlineKeyboard().webApp('🎮 Открыть Shonen Rift', WEBAPP_URL)
  });
});

bot.command('shop', async (ctx) => {
  await ctx.reply('Откройте магазин косметики внутри Mini App:', {
    reply_markup: new InlineKeyboard().webApp('🛒 Открыть магазин', WEBAPP_URL)
  });
});

bot.command('tutorial', async (ctx) => {
  await ctx.reply('Откройте Mini App и нажмите «Обучение», чтобы пройти короткую тренировку и получить награду за первое прохождение.', {
    reply_markup: new InlineKeyboard().webApp('🎓 Открыть обучение', WEBAPP_URL)
  });
});

bot.command('profile', async (ctx) => sendProfile(ctx));
bot.callbackQuery('profile', async (ctx) => {
  await ctx.answerCallbackQuery();
  await sendProfile(ctx);
});

bot.command('daily', async (ctx) => sendDaily(ctx));
bot.callbackQuery('daily', async (ctx) => {
  await ctx.answerCallbackQuery();
  await sendDaily(ctx);
});

bot.command('leaderboard', async (ctx) => sendLeaderboard(ctx));
bot.callbackQuery('leaderboard', async (ctx) => {
  await ctx.answerCallbackQuery();
  await sendLeaderboard(ctx);
});

bot.callbackQuery('help', async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply(helpText(), { reply_markup: mainKeyboard() });
});
bot.command('help', async (ctx) => ctx.reply(helpText(), { reply_markup: mainKeyboard() }));

async function sendProfile(ctx) {
  const telegramId = ctx.from?.id;
  if (!telegramId) return ctx.reply('Не удалось определить Telegram ID.');

  const data = await apiGet(`/api/bot/profile/${telegramId}`);
  if (!data?.ok) {
    return ctx.reply(data?.error || 'Профиль не найден. Сначала откройте игру.', { reply_markup: mainKeyboard() });
  }

  const user = data.user;
  const s = user.stats;
  await ctx.reply(
    `👤 ${user.firstName}\n` +
    `Рейтинг: ${s.rating}\n` +
    `Матчи: ${s.matches}\n` +
    `Победы: ${s.wins}\n` +
    `K/D: ${s.kills}/${s.deaths}\n` +
    `Искры: ${user.inventory.soft}`,
    { reply_markup: mainKeyboard() }
  );
}

async function sendDaily(ctx) {
  const telegramId = ctx.from?.id;
  if (!telegramId) return ctx.reply('Не удалось определить Telegram ID.');

  const data = await apiPost(`/api/bot/daily/${telegramId}`, {});
  if (!data?.ok) {
    return ctx.reply(data?.error || 'Награда недоступна. Сначала откройте игру.', { reply_markup: mainKeyboard() });
  }

  await ctx.reply(`🎁 ${data.message}\nБаланс: ${data.user.inventory.soft} искр`, { reply_markup: mainKeyboard() });
}

async function sendLeaderboard(ctx) {
  const data = await apiGet('/api/leaderboard?limit=10');
  if (!data?.ok || !data.leaderboard?.length) {
    return ctx.reply('Лидерборд пока пуст. Сыграйте первый матч!', { reply_markup: mainKeyboard() });
  }

  const lines = data.leaderboard.map((row, index) => {
    const name = row.username ? `@${row.username}` : row.firstName;
    return `${index + 1}. ${name} — ${row.rating} рейтинга, побед: ${row.wins}`;
  });
  await ctx.reply(`🏆 Лидерборд\n\n${lines.join('\n')}`, { reply_markup: mainKeyboard() });
}

function helpText() {
  return 'Управление: джойстик слева, атака и способности справа. Цель — уничтожить красное ядро. Новичкам: нажмите «Обучение» в Mini App. На ПК: WASD, J, K, L, Space.';
}

async function apiGet(path) {
  return apiFetch(path, { method: 'GET' });
}

async function apiPost(path, body) {
  return apiFetch(path, { method: 'POST', body: JSON.stringify(body) });
}

async function apiFetch(path, options) {
  try {
    const response = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: {
        'content-type': 'application/json',
        'x-bot-secret': BOT_API_SECRET,
        ...(options.headers || {})
      }
    });
    return await response.json();
  } catch (error) {
    console.error(error);
    return null;
  }
}

bot.start({
  onStart: (botInfo) => {
    console.log(`Bot @${botInfo.username} started. WebApp URL: ${WEBAPP_URL}`);
  }
});
