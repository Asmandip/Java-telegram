// bot.js - webhook-ready (or polling if USE_POLLING=true)
require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const Signal = require('./models/Signal');
const Settings = require('./models/Settings');
const { openPosition } = require('./utils/trade');

const TOKEN = process.env.TELEGRAM_TOKEN;
const URL = process.env.RENDER_EXTERNAL_URL;
const CHAT_ID = process.env.CHAT_ID;

if (!TOKEN) console.error('TELEGRAM_TOKEN missing in .env');

let bot;
if (process.env.USE_POLLING === 'true') {
  bot = new TelegramBot(TOKEN, { polling: true });
  console.log('Bot started in polling mode');
} else {
  bot = new TelegramBot(TOKEN, { webHook: { port: false } });
  if (URL) {
    try {
      bot.setWebHook(`${URL}/bot${TOKEN}`);
      console.log('Bot webhook set to', `${URL}/bot${TOKEN}`);
    } catch (e) {
      console.error('setWebHook error:', e);
    }
  } else {
    console.warn('RENDER_EXTERNAL_URL missing; webhook not set');
  }
}

// helpful keyboard builder
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
    console.error('sendCandidate err:', e.message || e);
  }
}

// callback handling: confirm_exec, confirm_noexec, reject
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

      const settings = await Settings.findOne();
      if (!openPosition) {
        await bot.sendMessage(chatId, '⚠️ Execution module not available.');
        return;
      }
      try {
        const pos = await openPosition(doc, 1000);
        const pid = pos?._id || pos?.id || `sim-${Date.now()}`;
        await bot.sendMessage(chatId, `🔔 Position opened (id:${pid})\nPair: ${pos.symbol}\nSide: ${pos.side}\nEntry: ${pos.entry}\nSL: ${pos.sl}\nTP: ${pos.tp}`);
      } catch (err) {
        console.error('openPosition error:', err);
        await bot.sendMessage(chatId, `❌ Execution failed: ${err.message || err}`);
      }
      return;
    }

    await bot.answerCallbackQuery(query.id, { text: 'Unknown action' });
  } catch (e) {
    console.error('callback_query handler error:', e);
    try { await bot.answerCallbackQuery(query.id, { text: 'Error handling action' }); } catch (_) {}
  }
});

// commands: help, status, autotrade on/off, scanner on/off, positions, closeall
bot.onText(/\/help/, async (msg) => {
  const help = `Commands:
 /start
 /help
 /status
 /autotradeon
 /autotradeoff
 /scanneron
 /scanneroff
 /scanstatus
 /positions
 /closeall
 /closetrade <symbol>
`;
  bot.sendMessage(msg.chat.id, help);
});

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, '🤖 Bot online. Use /help to see commands.');
});

bot.onText(/\/status/, async (msg) => {
  const s = await Settings.findOne();
  bot.sendMessage(msg.chat.id, `Status:
 AutoTrade: ${s?.autoTrade ? 'ON' : 'OFF'}
 Scanner: ${s?.scannerEnabled ? 'ON' : 'OFF'}`, { parse_mode: 'Markdown' });
});

bot.onText(/\/autotradeon/, async (msg) => {
  const s = await Settings.findOneAndUpdate({}, { autoTrade: true }, { new: true, upsert: true });
  bot.sendMessage(msg.chat.id, '✅ AutoTrade enabled');
});

bot.onText(/\/autotradeoff/, async (msg) => {
  const s = await Settings.findOneAndUpdate({}, { autoTrade: false }, { new: true, upsert: true });
  bot.sendMessage(msg.chat.id, '❌ AutoTrade disabled');
});

bot.onText(/\/scanneron/, async (msg) => {
  await Settings.findOneAndUpdate({}, { scannerEnabled: true }, { new: true, upsert: true });
  await require('./scanner').startScanner();
  bot.sendMessage(msg.chat.id, '🔍 Scanner started');
});

bot.onText(/\/scanneroff/, async (msg) => {
  await Settings.findOneAndUpdate({}, { scannerEnabled: false }, { new: true, upsert: true });
  await require('./scanner').stopScanner();
  bot.sendMessage(msg.chat.id, '⏹️ Scanner stopped');
});

module.exports = { bot, sendCandidate };