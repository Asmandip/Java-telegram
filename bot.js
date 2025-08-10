// bot.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');

let botInstance = null;   // node-telegram-bot-api instance (if created elsewhere)
let ioInstance = null;    // socket.io instance (optional)
const LOG_PATH = path.join(__dirname, 'bot.log');
const ADMIN_CHAT = process.env.CHAT_ID || process.env.ADMIN_CHAT_ID || null; // primary chat id

function appendLog(line) {
  const ts = new Date().toISOString();
  const msg = `[${ts}] ${line}`;
  try { fs.appendFileSync(LOG_PATH, msg + '\n'); } catch(e){}
  console.log(msg);
  if (ioInstance) ioInstance.emit('bot-log', msg);
}

// send alert helper (used by scanner)
// askConfirm = true -> bot will ask user with inline buttons whether to exec auto-trade
async function sendTelegramAlert(text, askConfirm = false, candidate = null) {
  appendLog(`ALERT: ${text}`);
  if (!botInstance) {
    appendLog('Bot instance not initialized, cannot send Telegram message.');
    return null;
  }
  const chatId = ADMIN_CHAT;
  if (!chatId) {
    appendLog('ADMIN_CHAT not set in env; skipping Telegram alert.');
    return null;
  }

  if (!askConfirm) {
    try {
      await botInstance.sendMessage(chatId, text);
      return { ok: true };
    } catch (e) {
      appendLog('Telegram send error: ' + (e.message || e));
      return { ok: false, error: e };
    }
  }

  // askConfirm = true -> provide inline keyboard to confirm execute
  try {
    const opts = {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '✅ Confirm & Exec', callback_data: `autoconfirm|exec|${Date.now()}` }],
          [{ text: '❌ Reject', callback_data: `autoconfirm|reject|${Date.now()}` }]
        ]
      }
    };
    const fullText = text + '\n\n_Confirm execution?_';
    await botInstance.sendMessage(chatId, fullText, opts);
    return { ok: true };
  } catch (e) {
    appendLog('Telegram confirm send error: ' + (e.message || e));
    return { ok: false, error: e };
  }
}

// init handler used by server: botHandler(bot, io)
function botHandler(bot, io) {
  botInstance = bot;
  ioInstance = io;

  appendLog('Bot handler init');

  // register commands
  bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, '🤖 বট অন — স্বাগতম! /help লিখে কমান্ড দেখুন।');
    appendLog(`/start by ${msg.from?.username || msg.from?.id}`);
  });

  bot.onText(/\/help/, (msg) => {
    const chatId = msg.chat.id;
    const help = `
*Available commands*
/start - বট অন করো
/help - সাহায্য
/status - সিস্টেম স্ট্যাটাস
/scan_on - স্ক্যান চালু
/scan_off - স্ক্যান বন্ধ
/auto_on - Auto-trade চালু
/auto_off - Auto-trade বন্ধ
/backtests - ব্যাকটেস্ট লিস্ট (ড্যাশবোর্ড থেকে ভাল)
    `;
    bot.sendMessage(chatId, help, { parse_mode: 'Markdown' });
    appendLog(`/help by ${msg.from?.username || msg.from?.id}`);
  });

  bot.onText(/\/status/, async (msg) => {
    const chatId = msg.chat.id;
    // basic status - extend if you have more state endpoints
    const text = `📊 System Status\nServer: ✅\nScanner: ${ (global.SCANNER_RUNNING ? '✅' : '❌') }\nAutoTrade: ${ (global.AUTO_TRADE ? '✅' : '❌') }\nTime: ${new Date().toLocaleString()}`;
    bot.sendMessage(chatId, text);
    appendLog(`/status by ${msg.from?.username || msg.from?.id}`);
  });

  // scanner control
  bot.onText(/\/scan_on/, (msg) => {
    io?.emit('scan-toggle', { running: true });
    bot.sendMessage(msg.chat.id, '🔍 Scanner চালু হওয়ার অনুরোধ পাঠানো হলো।');
    appendLog(`/scan_on by ${msg.from?.username || msg.from?.id}`);
  });
  bot.onText(/\/scan_off/, (msg) => {
    io?.emit('scan-toggle', { running: false });
    bot.sendMessage(msg.chat.id, '🛑 Scanner বন্ধের অনুরোধ পাঠানো হলো।');
    appendLog(`/scan_off by ${msg.from?.username || msg.from?.id}`);
  });

  // auto trade control
  bot.onText(/\/auto_on/, (msg) => {
    io?.emit('auto-trade', { enabled: true });
    bot.sendMessage(msg.chat.id, '⚡ Auto-trade চালু করার অনুরোধ পাঠানো হলো।');
    appendLog(`/auto_on by ${msg.from?.username || msg.from?.id}`);
  });
  bot.onText(/\/auto_off/, (msg) => {
    io?.emit('auto-trade', { enabled: false });
    bot.sendMessage(msg.chat.id, '⏹ Auto-trade বন্ধ করার অনুরোধ পাঠানো হলো।');
    appendLog(`/auto_off by ${msg.from?.username || msg.from?.id}`);
  });

  // handle callback queries (confirmations from inline buttons)
  bot.on('callback_query', async (query) => {
    try {
      const data = query.data || '';
      const chatId = query.message?.chat?.id || (ADMIN_CHAT || query.from.id);
      appendLog(`callback_query from ${query.from.username || query.from.id}: ${data}`);

      if (data.startsWith('autoconfirm|')) {
        const parts = data.split('|'); // autoconfirm|exec|<id>
        const action = parts[1];
        if (action === 'exec') {
          await bot.answerCallbackQuery(query.id, { text: 'Confirmed — executing...' });
          bot.sendMessage(chatId, '✅ Execution confirmed. Auto-trade will run.');
          // notify via socket to execute order
          io?.emit('autoconfirm:exec', { by: query.from, time: Date.now() });
          appendLog(`Auto-exec confirmed by ${query.from.username || query.from.id}`);
          return;
        } else if (action === 'reject') {
          await bot.answerCallbackQuery(query.id, { text: 'Rejected' });
          bot.sendMessage(chatId, '❌ Execution rejected.');
          io?.emit('autoconfirm:reject', { by: query.from, time: Date.now() });
          appendLog(`Auto-exec rejected by ${query.from.username || query.from.id}`);
          return;
        }
      }

      // generic ack
      await bot.answerCallbackQuery(query.id, { text: 'Action received' });
    } catch (e) {
      appendLog('callback_query handler error: ' + (e.message || e));
      try { await bot.answerCallbackQuery(query.id, { text: 'Error' }); } catch (_) {}
    }
  });

  // catch other messages if needed
  bot.on('message', (msg) => {
    // optional: log all messages from admin
    appendLog(`message from ${msg.from?.username || msg.from?.id}: ${msg.text?.slice(0,200)}`);
  });

  return { bot, io };
}

// also expose the sendTelegramAlert for other modules
module.exports = {
  init: botHandler,
  sendTelegramAlert,
  _internal: { appendLog } // for debugging if needed
};