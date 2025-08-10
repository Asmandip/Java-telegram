require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const TelegramBot = require('node-telegram-bot-api');

const { sendCandidate } = require('./bot'); // তোমার bot.js

const app = express();
app.use(bodyParser.json());

// =====================
// MongoDB Connection
// =====================
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => {
  console.log('✅ MongoDB connected');
}).catch(err => {
  console.error('❌ MongoDB connection error:', err);
});

// =====================
// Telegram Bot Config
// =====================
const TOKEN = process.env.TELEGRAM_TOKEN;
const RENDER_URL = process.env.RENDER_URL || 'https://java-telegram-ngcm.onrender.com';

let bot;

// লোকাল হলে পোলিং, Render হলে ওয়েবহুক
if (process.env.NODE_ENV === 'production') {
  bot = new TelegramBot(TOKEN, { webHook: { port: process.env.PORT || 10000 } });
  bot.setWebHook(`${RENDER_URL}/bot${TOKEN}`);

  // Webhook route for Telegram
  app.post(`/bot${TOKEN}`, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
  });

  console.log(`Bot webhook set to ${RENDER_URL}/bot${TOKEN}`);
} else {
  bot = new TelegramBot(TOKEN, { polling: true });
  console.log('🤖 Bot running in polling mode (local)');
}

// =====================
// Test Route
// =====================
app.get('/', (req, res) => {
  res.send('🚀 Bot Server is Running');
});

// =====================
// Example API for sending test message
// =====================
app.post('/send-signal', async (req, res) => {
  const data = req.body;
  try {
    await sendCandidate(data);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// =====================
// Start Server
// =====================
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});