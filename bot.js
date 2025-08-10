// bot.js
require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const Signal = require('./models/Signal');
const { openPosition } = require('./utils/trade');

const TOKEN = process.env.TELEGRAM_TOKEN;
const CHAT_ID = process.env.CHAT_ID || null;

let botInstance = null;

async function init(options = {}) {
  if (!TOKEN) throw new Error('TELEGRAM_TOKEN missing');
  if (options.polling) {
    botInstance = new TelegramBot(TOKEN, { polling: true });
    console.log('Bot in polling mode');
  } else {
    // webhook mode: create with webHook: {port:false} so it won't bind its own express
    botInstance = new TelegramBot(TOKEN, { webHook: { port: false } });
    console.log('Bot initialized for webhook mode');
  }

  // handlers
  botInstance.on('callback_query', async (query) => {
    try {
      const [action, id] = (query.data || '').split('|');
      const chatId = query.message?.chat?.id || CHAT_ID;
      if (!action || !id) {
        await botInstance.answerCallbackQuery(query.id, { text: 'Invalid callback' });
        return;
      }
      const doc = await Signal.findById(id);
      if (!doc) { await botInstance.answerCallbackQuery(query.id, { text: 'Signal not found' }); return; }

      if (action === 'confirm_noexec') {
        doc.status = 'confirmed'; await doc.save();
        await botInstance.answerCallbackQuery(query.id, { text: 'Confirmed (no exec)' });
        await botInstance.sendMessage(chatId, `✅ Signal confirmed (no exec): ${doc.pair}`);
        return;
      }
      if (action === 'reject') {
        doc.status = 'rejected'; await doc.save();
        await botInstance.answerCallbackQuery(query.id, { text: 'Rejected' });
        await botInstance.sendMessage(chatId, `❌ Signal rejected: ${doc.pair}`);
        return;
      }
      if (action === 'confirm_exec') {
        doc.status = 'confirmed'; await doc.save();
        await botInstance.answerCallbackQuery(query.id, { text: 'Confirmed — executing...' });
        try {
          const pos = await openPosition(doc, 1000);
          const pid = pos._id || pos.id || 'sim-' + Date.now();
          await botInstance.sendMessage(chatId, `🔔 Position opened (id:${pid})\nPair:${pos.symbol}\nSide:${pos.side}\nEntry:${pos.entry}\nSL:${pos.sl}\nTP:${pos.tp}`);
        } catch (err) {
          console.error('exec err', err);
          await botInstance.sendMessage(chatId, `❌ Execution failed: ${err.message || err}`);
        }
        return;
      }
      await botInstance.answerCallbackQuery(query.id, { text: 'Unknown action' });
    } catch (e) {
      console.error('callback error', e);
      try { await botInstance.answerCallbackQuery(query.id, { text: 'Error handling action' }); } catch(_) {}
    }
  });

  botInstance.onText(/\/start/, (msg) => {
    botInstance.sendMessage(msg.chat.id, '🤖 Bot online. Use dashboard for full control.');
  });

  return { bot: botInstance, sendCandidate };
}

function buildCandidateMessage(doc) {
  const confs = Array.isArray(doc.confirmations) ? doc.confirmations.join(', ') : JSON.stringify(doc.confirmations||{});
  const price = doc.price ?? doc.indicators?.price ?? 'n/a';
  const text = `⚡️ *Signal Candidate*\n\n*${doc.pair || doc.symbol}* — _${doc.type || 'BUY'}_\n*Price:* ${price}\n*Confs:* ${confs}\n*Time:* ${new Date(doc.createdAt||Date.now()).toLocaleString()}\n\nExecute trade?`;
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
  if (!botInstance) {
    console.warn('Bot instance not initialized; cannot send candidate');
    return;
  }
  if (!CHAT_ID) {
    console.warn('CHAT_ID not set; cannot send candidate');
    return;
  }
  const { text, opts } = buildCandidateMessage(doc);
  try {
    await botInstance.sendMessage(CHAT_ID, text, opts);
    console.log('Candidate sent to Telegram:', doc.symbol);
  } catch (e) { console.error('sendCandidate err', e); }
}

module.exports = { init, sendCandidate, get bot() { return botInstance; } };