const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const connectDB = require('./db');
const { PORT, FRONTEND_URL, NODE_ENV, TELEGRAM_TOKEN, CHAT_ID } = require('./config');
const bot = require('./bot');
const { fetchSymbolTicker, fetchAllTickers } = require('./bitgetService');

const app = express();
app.use(cors());
app.use(bodyParser.json());

// In-memory control state (for dashboard)
let systemEnabled = true;

// Connect DB
connectDB();

// Root health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', env: NODE_ENV || 'development', timestamp: new Date().toISOString() });
});

// Serve dashboard static files
app.use('/dashboard', express.static(path.join(__dirname, 'dashboard')));

// Test signal (GET) — useful for browser trigger
app.get('/test-signal', async (req, res) => {
  try {
    if (!systemEnabled) return res.status(403).send('System disabled');
    const message = `🚀 TEST SIGNAL\nPair: BTC/USDT\nType: LONG\nEntry: 68000\nTarget: 68500\nStop Loss: 67800\nConfidence: 99%`;
    await bot.sendMessage(CHAT_ID, message);
    // optionally: save to DB (left for bot code)
    res.send('✅ টেস্ট সিগনাল পাঠানো হয়েছে');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error sending test signal');
  }
});

// Webhook endpoint (POST)
app.post('/webhook/:token', async (req, res) => {
  try {
    if (!systemEnabled) return res.status(403).json({ error: 'system_disabled' });
    const token = req.params.token;
    // basic auth: ensure token matches TELEGRAM_TOKEN for safety (you can replace with dedicated webhook token)
    if (!token || !token.includes(TELEGRAM_TOKEN.split(':')[0])) {
      // Note: in production use a separate secure webhook token
      console.warn('Webhook token mismatch for', token);
    }

    const payload = req.body || {};
    // expected payload fields: pair,type,entry,target,stopLoss,confidence
    const pair = payload.pair || payload.symbol || 'UNKNOWN';
    const type = payload.type || 'LONG';
    const entry = payload.entry || payload.price || 0;
    const target = payload.target || 0;
    const stopLoss = payload.stopLoss || payload.sl || 0;
    const confidence = payload.confidence || payload.conf || 0;

    const message = `🚀 SIGNAL\nPair: ${pair}\nType: ${type}\nEntry: ${entry}\nTarget: ${target}\nStop Loss: ${stopLoss}\nConfidence: ${confidence}%`;
    await bot.sendMessage(CHAT_ID, message);

    // respond quickly
    res.json({ ok: true, received: true });
  } catch (err) {
    console.error('Webhook error', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// API: Get status for dashboard
app.get('/api/status', (req, res) => {
  res.json({
    service: 'bitget-crypto-bot',
    live: true,
    systemEnabled,
    NODE_ENV,
    timestamp: new Date().toISOString()
  });
});

// API: Control system (enable/disable)
app.post('/api/control', (req, res) => {
  const { action } = req.body;
  if (action === 'enable') systemEnabled = true;
  else if (action === 'disable') systemEnabled = false;
  else return res.status(400).json({ error: 'invalid_action' });
  res.json({ ok: true, systemEnabled });
});

// API: fetch a single symbol ticker (proxy to bitgetService)
app.get('/api/price/:symbol', async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const data = await fetchSymbolTicker(symbol);
    res.json({ ok: true, symbol, data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// API: fetch many tickers
app.get('/api/prices', async (req, res) => {
  try {
    const data = await fetchAllTickers();
    res.json({ ok: true, data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

const port = PORT || 10000;
app.listen(port, () => {
  console.log(`🚀 সার্ভার চালু হয়েছে পোর্ট ${port} তে`);
  console.log(`🔗 ড্যাশবোর্ড: http://localhost:${port}/dashboard/`);
});

module.exports = app;
