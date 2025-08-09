// bot.js
require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const Signal = require('./models/Signal');
const Position = (() => { try { return require('./models/Position'); } catch(e){ return null; } })();
const { openPosition } = (() => { try { return require('./utils/trade'); } catch(e){ return {}; } })();

const TOKEN = process.env.TELEGRAM_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const AUTO_TRADE = (process.env.AUTO_TRADE === 'true') || false;

if (!TOKEN) {
  console.error('❌ TELEGRAM_TOKEN missing in env. Bot will not start.');
}

// Detect environment: Webhook for production (Render), polling for local
let bot;
if (process.env.USE_POLLING === 'true') {
  bot = new TelegramBot(TOKEN, { polling: true });
  console.log('🤖 Bot started in polling mode.');
} else {
  bot = new TelegramBot(TOKEN, { polling: false });
  const url = process.env.RENDER_EXTERNAL_URL || process.env.WEBHOOK_URL;
  if (!url) {
    console.error('❌ WEBHOOK_URL or RENDER_EXTERNAL_URL is required for webhook mode.');
  } else {
    bot.setWebHook(`${url}/bot${TOKEN}`);
    console.log(`🤖 Bot webhook set to ${url}/bot${TOKEN}`);
  }
}

// Build candidate message (Markdown) + inline keyboard
function buildCandidateMessage(doc) {
  const confs = (doc.confirmations && doc.confirmations.length) ? doc.confirmations.join(', ') : 'N/A';
  const price = doc.price || (doc.indicators && doc.indicators.price) || 'n/a';
  const text = `⚡️ *Signal Candidate*\n\n*${doc.pair || doc.symbol}* — _${doc.type || doc.side || 'BUY'}_\n*Price:* ${price}\n*Confs:* ${confs}\n*Time:* ${new Date(doc.createdAt || doc.time || Date.now()).toLocaleString()}\n\nExecute trade?`;
  const opts = {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '✅ Confirm & Exec', callback_data: `confirm_exec|${doc._id}` }],
        [{ text: '✅ Confirm (No Exec)', callback_data: `confirm_noexec|${doc._id}` }],
        [{ text: '❌ Reject', callback_data: `reject|${doc._id}` }]
      ]
    }
  };
  return { text, opts };
}

// Send candidate to configured chat
async function sendCandidate(doc) {
  try {
    if (!CHAT_ID) {
      console.warn('CHAT_ID not set — cannot send Telegram candidate.');
      return;
    }
    const { text, opts } = buildCandidateMessage(doc);
    await bot.sendMessage(CHAT_ID, text, opts);
    console.log('Telegram candidate sent for', doc.pair || doc.symbol);
  } catch (e) {
    console.error('sendCandidate error:', e.message || e);
  }
}

// Callback handler
bot.on('callback_query', async (query) => {
  try {
    const data = query.data || '';
    const [action, id] = data.split('|');
    if (!action || !id) {
      await bot.answerCallbackQuery(query.id, { text: 'Invalid callback' });
      return;
    }

    const chatId = query.message?.chat?.id || CHAT_ID;

    const doc = await Signal.findById(id);
    if (!doc) {
      await bot.answerCallbackQuery(query.id, { text: 'Signal not found' });
      return;
    }

    if (action === 'confirm_noexec') {
      doc.status = 'confirmed';
      await doc.save();
      await bot.answerCallbackQuery(query.id, { text: 'Confirmed (no exec)' });
      await bot.sendMessage(chatId, `✅ Signal confirmed (no auto-exec): ${doc.pair || doc.symbol} ${doc.type || doc.side}`);
      return;
    }

    if (action === 'reject') {
      doc.status = 'rejected';
      await doc.save();
      await bot.answerCallbackQuery(query.id, { text: 'Rejected' });
      await bot.sendMessage(chatId, `❌ Signal rejected: ${doc.pair || doc.symbol}`);
      return;
    }

    if (action === 'confirm_exec') {
      doc.status = 'confirmed';
      await doc.save();
      await bot.answerCallbackQuery(query.id, { text: 'Confirmed — executing...' });

      try {
        if (typeof openPosition !== 'function') {
          await bot.sendMessage(chatId, '⚠️ Execution module not available (openPosition missing). Operation aborted.');
          return;
        }
        const position = await openPosition(doc, 1000);
        const pid = position?._id || position?.id || `sim-${Date.now()}`;
        const entry = position?.entry || position?.entryPrice || doc.price;
        const sl = position?.sl;
        const tp = position?.tp;
        await bot.sendMessage(chatId, `🔔 Position opened (id: ${pid})\nSymbol: ${position.symbol || doc.pair || doc.symbol}\nSide: ${position.side || doc.type}\nEntry: ${entry}\nSL: ${sl}\nTP: ${tp}`);
      } catch (err) {
        console.error('Execution error:', err);
        await bot.sendMessage(chatId, `❌ Execution failed: ${err.message || err}`);
      }
      return;
    }

    await bot.answerCallbackQuery(query.id, { text: 'Unknown action' });
  } catch (e) {
    console.error('callback_query handler error:', e);
    try { await bot.answerCallbackQuery(query.id, { text: 'Error handling action' }); } catch(_) {}
  }
});

// Basic commands
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, '🤖 Bot online — ready for signals.');
});

bot.onText(/\/auto (on|off)/, async (msg, match) => {
  const mode = match[1];
  await bot.sendMessage(msg.chat.id, `Auto-trade toggle requested: ${mode}. To persist changes, use dashboard or update settings in DB.`);
});

module.exports = { bot, sendCandidate };