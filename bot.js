// bot.js - webhook-ready (or polling if USE_POLLING=true)
require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const Signal = require('./models/Signal');
const { openPosition } = require('./utils/trade'); // openPosition returns created Position doc
const Settings = require('./models/Settings');
const scanner = require('./scanner'); // scanner এর জন্য লাগতে পারে
const mongoose = require('mongoose');

const TOKEN = process.env.TELEGRAM_TOKEN;
const URL = process.env.RENDER_EXTERNAL_URL; // for webhook
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

// build message + inline keyboard
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
    try { await bot.answerCallbackQuery(query.id, { text: 'Error' }); } catch (_) {}
  }
});

// ========================
// নতুন কমান্ড হ্যান্ডলার যোগ করা হলো নিচে
// ========================

// /start
bot.onText(/\/start/, (msg) => {
  const welcomeMsg = `🤖 বট চালু হয়েছে!\n\nHelp পেতে /help কমান্ড ব্যবহার করুন।`;
  bot.sendMessage(msg.chat.id, welcomeMsg);
});

// /help
bot.onText(/\/help/, (msg) => {
  const helpText = `
🔹 *Basic Commands*

/start - বট চালু ও ওয়েলকাম মেসেজ  
/help - সব কমান্ডের বর্ণনা  
/status - বটের বর্তমান অবস্থা

🔹 *Auto Trade Controls*

/autotradeon - অটো ট্রেড চালু করো  
/autotradeoff - অটো ট্রেড বন্ধ করো

🔹 *Scanner & Detection*

/scanneron - স্ক্যানার চালু করো  
/scanneroff - স্ক্যানার বন্ধ করো  
/scanstatus - স্ক্যানার স্ট্যাটাস দেখো

🔹 *Trade Management*

/positions - চলমান পজিশন দেখো  
/closeall - সব পজিশন বন্ধ করো  
/closetrade <symbol> - নির্দিষ্ট ট্রেড বন্ধ করো

🔹 *Manual Trading*

/buy <symbol> <qty> - ম্যানুয়ালি বাই করো  
/sell <symbol> <qty> - ম্যানুয়ালি সেল করো

🔹 *Settings & Debug*

/settings - সেটিংস দেখো ও পরিবর্তন করো  
/debugon - ডিবাগ লগ চালু করো  
/debugoff - ডিবাগ লগ বন্ধ করো
  `;
  bot.sendMessage(msg.chat.id, helpText, { parse_mode: 'Markdown' });
});

// /status
bot.onText(/\/status/, async (msg) => {
  let autoTradeStatus = 'OFF'; // TODO: তোমার লজিক অনুসারে পরিবর্তন করো
  let dashboardStatus = 'Connected'; // TODO: ড্যাশবোর্ডের কানেকশন চেক করো
  let scannerStatus = scanner.isRunning() ? 'ON' : 'OFF';
  let mongoStatus = mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected';
  let lastSignalTime = 'No signals yet';

  try {
    const latestSignal = await Signal.findOne().sort({ createdAt: -1 });
    if (latestSignal) {
      lastSignalTime = new Date(latestSignal.createdAt).toLocaleString();
    }
  } catch (e) {
    lastSignalTime = 'Error fetching';
  }

  const statusMsg = `
🟢 *Bot Status*

Auto Trade: ${autoTradeStatus}  
Dashboard: ${dashboardStatus}  
Scanner: ${scannerStatus}  
MongoDB: ${mongoStatus}  
Last Signal Time: ${lastSignalTime}
  `;

  bot.sendMessage(msg.chat.id, statusMsg, { parse_mode: 'Markdown' });
});

// /autotradeon
bot.onText(/\/autotradeon/, (msg) => {
  // TODO: অটো ট্রেড চালু করার লজিক বসাও
  bot.sendMessage(msg.chat.id, '✅ Auto trading চালু করা হলো।');
});

// /autotradeoff
bot.onText(/\/autotradeoff/, (msg) => {
  // TODO: অটো ট্রেড বন্ধ করার লজিক বসাও
  bot.sendMessage(msg.chat.id, '⛔ Auto trading বন্ধ করা হলো।');
});

// /scanneron
bot.onText(/\/scanneron/, async (msg) => {
  try {
    await scanner.startScanner();
    bot.sendMessage(msg.chat.id, '✅ Scanner চালু করা হলো।');
  } catch (e) {
    bot.sendMessage(msg.chat.id, `❌ Scanner চালু করতে সমস্যা: ${e.message || e}`);
  }
});

// /scanneroff
bot.onText(/\/scanneroff/, async (msg) => {
  try {
    await scanner.stopScanner();
    bot.sendMessage(msg.chat.id, '⛔ Scanner বন্ধ করা হলো।');
  } catch (e) {
    bot.sendMessage(msg.chat.id, `❌ Scanner বন্ধ করতে সমস্যা: ${e.message || e}`);
  }
});

// /scanstatus
bot.onText(/\/scanstatus/, async (msg) => {
  // TODO: স্ক্যানার সম্পর্কিত ডাটা রিটার্ন করো
  bot.sendMessage(msg.chat.id, 'Scanner status এবং শেষ সিগন্যাল দেখানোর ফিচার আসছে...');
});

// /positions
bot.onText(/\/positions/, async (msg) => {
  // TODO: চলমান পজিশন ফেচ করো ও দেখাও
  bot.sendMessage(msg.chat.id, 'চলমান পজিশন দেখানোর ফিচার আসছে...');
});

// /closeall
bot.onText(/\/closeall/, async (msg) => {
  // TODO: সব ওপেন পজিশন বন্ধ করো
  bot.sendMessage(msg.chat.id, 'সব পজিশন বন্ধ করার ফিচার আসছে...');
});

// /closetrade <symbol>
bot.onText(/\/closetrade (.+)/, async (msg, match) => {
  const symbol = match[1].toUpperCase();
  // TODO: নির্দিষ্ট symbol এর ট্রেড ক্লোজ করার লজিক বসাও
  bot.sendMessage(msg.chat.id, `ট্রেড বন্ধ করার চেষ্টা করা হচ্ছে: ${symbol}`);
});

// /buy <symbol> <qty>
bot.onText(/\/buy (\S+) (\d+(\.\d+)?)/, async (msg, match) => {
  const symbol = match[1].toUpperCase();
  const qty = parseFloat(match[2]);
  // TODO: ম্যানুয়ালি বাই ট্রেডের লজিক বসাও
  bot.sendMessage(msg.chat.id, `ম্যাজিক! বাই ট্রেড করা হবে: ${symbol}, পরিমাণ: ${qty}`);
});

// /sell <symbol> <qty>
bot.onText(/\/sell (\S+) (\d+(\.\d+)?)/, async (msg, match) => {
  const symbol = match[1].toUpperCase();
  const qty = parseFloat(match[2]);
  // TODO: ম্যানুয়ালি সেল ট্রেডের লজিক বসাও
  bot.sendMessage(msg.chat.id, `ম্যাজিক! সেল ট্রেড করা হবে: ${symbol}, পরিমাণ: ${qty}`);
});

// /settings
bot.onText(/\/settings/, async (msg) => {
  // TODO: সেটিংস দেখানোর ও পরিবর্তন করার লজিক
  bot.sendMessage(msg.chat.id, 'Settings দেখানোর এবং পরিবর্তন করার ফিচার আসছে...');
});

// /debugon
bot