// MongoDB Connection
const mongoose = require('mongoose');
mongoose.connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => console.log("✅ MongoDB Connected from Bot"))
  .catch(err => console.error("❌ MongoDB Error:", err));
const TelegramBot = require('node-telegram-bot-api');
const { TELEGRAM_TOKEN, CHAT_ID } = require('./config');

if (!TELEGRAM_TOKEN) {
  console.warn('TELEGRAM_TOKEN not set in env');
}

// Use long polling in development; in production you may use webhooks
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, 'বট অন: স্বাগতম! 🟢');
});

module.exports = bot;
