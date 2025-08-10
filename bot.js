// bot.js - webhook-ready; supports USE_POLLING=true for local dev
require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const Signal = require('./models/Signal');
const Settings = require('./models/Settings');
const { openPosition } = require('./utils/trade');

const TOKEN = process.env.TELEGRAM_TOKEN;
const URL = process.env.RENDER_EXTERNAL_URL;
const CHAT_ID = process.env.CHAT_ID;

if (!TOKEN) console.warn('TELEGRAM_TOKEN not set - bot will not operate properly.');

// decide polling vs webhook
let bot;
if (process.env.USE_POLLING === 'true') {
  bot = new TelegramBot(TOKEN, { polling: true });
  console.log('Bot started in polling mode (local dev).');
} else {
  bot = new TelegramBot(TOKEN, { webHook: { port: false } });
  if (URL && TOKEN) {
    try {
      bot.setWebHook(`${URL}/bot${TOKEN}`);
      console.log('Bot webhook set to', `${URL}/bot${TOKEN}`);
    } catch (e) {
      console.error('setWebHook error', e);
    }
  } else {
    console.warn('RENDER_EXTERNAL_URL or TELEGRAM_TOKEN missing; webhook not set.');
  }
}

// helper: build message with inline keyboard
function buildCandidateMessage(doc) {
  const confs = Array.isArray(doc.confirmations) ? doc.confirmations.join(', ') : JSON.stringify(doc.confirmations || {});
  const price = doc.price ?? doc.indicators?.price ?? 'n/a';
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

// send candidate to CHAT_ID
async function sendCandidate(doc) {
  if (!CHAT_ID) {
    console.warn('CHAT_ID not set — cannot send Telegram candidate.');
    return;
  }
  try {
    const { text, opts } = buildCandidateMessage(doc);
    await bot.sendMessage(CHAT_ID, text, opts);
    console.log('Telegram candidate sent for', doc.pair || doc.symbol);
  } catch (e) {
    console.error('sendCandidate error', e);
  }
}

// callback handler
bot.on('callback_query', async (query) => {
  try {
    const data = query.data || '';
    const [action, id] = data.split('|');
    const chatId = query.message?.chat?.id ?? CHAT_ID;
    if (!action || !id) {
      await bot.answerCallbackQuery(query.id, { text: 'Invalid callback' });
      return;
    }
    const doc = await Signal.findById(id);
    if (!doc) {
      await bot.answerCallbackQuery(query.id, { text: 'Signal not found' });
      return;
    }

    if (action === 'confirm_noexec') {
      doc.status = 'confirmed';
      await doc.save();
      await bot.answerCallbackQuery(query.id, { text: 'Confirmed (no exec)' });
      await bot.sendMessage(chatId, `✅ Signal confirmed (no exec): ${doc.pair || doc.symbol}`);
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

      // run execution (paper or live depending on env)
      try {
        if (typeof openPosition !== 'function') {
          await bot.sendMessage(chatId, '⚠️ Execution module not available.');
          return;
        }
        const pos = await openPosition(doc, 1000);
        const pid = pos?._id || pos?.id || `sim-${Date.now()}`;
        await bot.sendMessage(chatId, `🔔 Position opened (id:${pid})\nPair: ${pos.symbol}\nSide: ${pos.side}\nEntry: ${pos.entry}\nSL: ${pos.sl}\nTP: ${pos.tp}`);
      } catch (err) {
        console.error('openPosition error', err);
        await bot.sendMessage(chatId, `❌ Execution failed: ${err.message || err}`);
      }
      return;
    }

    await bot.answerCallbackQuery(query.id, { text: 'Unknown action' });
  } catch (e) {
    console.error('callback_query handler error', e);
    try { await bot.answerCallbackQuery(query.id, { text: 'Error handling action' }); } catch (_) {}
  }
});

// commands (a subset; rest will be added in Milestone B UI wiring)
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, '🤖 Bot online. Use dashboard for full control.');
});

module.exports = { bot, sendCandidate };