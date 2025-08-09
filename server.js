// server.js
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const fetch = require('node-fetch');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
app.use(express.json());
app.use(cors());

// Telegram Bot Init
const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: false });

// MongoDB Connection
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ MongoDB সংযুক্ত হয়েছে'))
  .catch(err => console.error('❌ MongoDB তে সমস্যা:', err));

// Home Route (Fix "Cannot GET /")
app.get('/', (req, res) => {
  res.send(`
    <h1>🚀 Bitget Crypto Bot চলছে</h1>
    <p>ড্যাশবোর্ড দেখতে যান: <a href="/dashboard">Dashboard</a></p>
  `);
});

// Dashboard Route
app.get('/dashboard', (req, res) => {
  res.send(`
    <h1>📊 Bot Dashboard</h1>
    <ul>
      <li>Bot Status: ✅ Running</li>
      <li>MongoDB: ✅ Connected</li>
      <li>Telegram Chat ID: ${process.env.CHAT_ID}</li>
      <li>Frontend URL: ${process.env.FRONTEND_URL}</li>
    </ul>
  `);
});

// Webhook Route
app.post(`/webhook/${process.env.TELEGRAM_TOKEN}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// Test Send Message Route
app.get('/send-test', async (req, res) => {
  try {
    await bot.sendMessage(process.env.CHAT_ID, "✅ টেস্ট মেসেজ পাঠানো হয়েছে!");
    res.send("✅ টেস্ট মেসেজ পাঠানো হয়েছে");
  } catch (err) {
    res.status(500).send("❌ মেসেজ পাঠানো যায়নি");
  }
});

// All Crypto Prices Route
app.get('/crypto-prices', async (req, res) => {
  try {
    const response = await fetch('https://api.bitget.com/api/v2/market/tickers?productType=umcbl');
    const data = await response.json();
    res.json(data.data);
  } catch (err) {
    res.status(500).json({ error: '❌ প্রাইস লোড করতে সমস্যা' });
  }
});

// Start Server
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 সার্ভার চালু হয়েছে পোর্ট ${PORT} তে`);
  console.log(`🔗 ড্যাশবোর্ড: http://localhost:${PORT}/dashboard`);
});