import TelegramBot from 'node-telegram-bot-api';
import config from './config/index.js';
import Settings from './models/Settings.js';
import { placeTrade } from './utils/trade.js';

const bot = new TelegramBot(config.telegramToken, { polling: true });

bot.onText(/\/start/, async (msg) => {
  bot.sendMessage(msg.chat.id, "🚀 Welcome to AsmanDip Algo Trading Bot!");
});

bot.onText(/\/settings/, async (msg) => {
  const settings = await Settings.findOne();
  bot.sendMessage(msg.chat.id, `⚙️ Current Settings:
Leverage: ${settings.leverage}
SL: ${settings.stopLossPercent}%
RR: ${settings.riskReward}
Timeframe: ${settings.timeframe}
Auto Trade: ${settings.autoTrade}`);
});

bot.onText(/\/trade (.+)/, async (msg, match) => {
  const [pair, side, amount] = match[1].split(" ");
  const res = await placeTrade(pair, side, amount);
  bot.sendMessage(msg.chat.id, res.success ? "✅ Trade placed" : "❌ Trade failed");
});

export default bot;
// inside bot callback handler when confirm_exec clicked
const { openPosition } = require('./utils/trade');

if (action === 'confirm_exec') {
  doc.status = 'confirmed';
  await doc.save();
  await bot.answerCallbackQuery(query.id, { text: 'Confirmed — executing...' });

  try {
    const pos = await openPosition(doc, /*accountUsd*/ 1000);
    await bot.sendMessage(CHAT_ID, `🔔 Position opened (id: ${pos._id})\nSymbol: ${pos.symbol}\nEntry: ${pos.entry}\nSL: ${pos.sl}\nTP: ${pos.tp}`);
  } catch (err) {
    await bot.sendMessage(CHAT_ID, `❌ Execution failed: ${err.message}`);
  }
}