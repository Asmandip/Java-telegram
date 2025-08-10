// server.js - main server (webhook-ready)
require('dotenv').config();
const path = require('path');
const express = require('express');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');

const app = express();
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 10000;

// models
const Signal = require('./models/Signal');
const Settings = require('./models/Settings');

// modules
const botModule = require('./bot'); // exports { bot, sendCandidate }
const bot = botModule?.bot;
const scanner = require('./scanner'); // exports startScanner, stopScanner, isRunning
const monitor = require('./monitor'); // exports monitorLoop

// MongoDB connect
async function connectDB() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error('MONGO_URI missing in .env — exiting.');
    process.exit(1);
  }
  try {
    await mongoose.connect(uri);
    console.log('✅ MongoDB connected');
  } catch (err) {
    console.error('MongoDB connect error:', err);
    process.exit(1);
  }
}

// ensure one settings doc
async function ensureSettings() {
  try {
    const s = await Settings.findOne();
    if (!s) {
      const doc = new Settings();
      await doc.save();
      console.log('⚙️ Default settings created');
    }
  } catch (e) {
    console.error('ensureSettings error:', e.message || e);
  }
}

// webhook route for Telegram (if bot created)
if (bot) {
  app.post(`/bot${process.env.TELEGRAM_TOKEN}`, (req, res) => {
    try {
      bot.processUpdate(req.body);
      res.sendStatus(200);
    } catch (e) {
      console.error('bot.processUpdate error:', e);
      res.sendStatus(500);
    }
  });
}

// scanner -> server candidate route
app.post('/signal-candidate', async (req, res) => {
  try {
    const cand = req.body;
    if (!cand || !cand.symbol) return res.status(400).json({ error: 'invalid payload' });

    const doc = await Signal.create({
      pair: cand.symbol || cand.pair,
      symbol: cand.symbol || cand.pair,
      type: cand.side || cand.type || 'BUY',
      price: cand.price || cand.entry || 0,
      confirmations: cand.confirmations || cand.indicators || [],
      indicators: cand,
      status: 'candidate',
      createdAt: new Date()
    });

    if (botModule?.sendCandidate) {
      try { await botModule.sendCandidate(doc); } catch (e) { console.error('sendCandidate err:', e); }
    }
    res.json({ ok: true, id: doc._id });
  } catch (e) {
    console.error('/signal-candidate err:', e);
    res.status(500).json({ error: e.message || String(e) });
  }
});

// API endpoints (dashboard control)
app.get('/api/status', async (req, res) => {
  res.json({
    db: mongoose.connection.readyState === 1,
    scannerRunning: scanner.isRunning(),
    webhook: !!bot,
  });
});

app.get('/api/signals', async (req, res) => {
  const list = await Signal.find().sort({ createdAt: -1 }).limit(200);
  res.json(list);
});

app.get('/api/settings', async (req, res) => {
  const s = await Settings.findOne();
  res.json(s || {});
});

app.post('/api/settings', async (req, res) => {
  const updated = await Settings.findOneAndUpdate({}, req.body, { new: true, upsert: true });
  res.json(updated);
});

app.post('/api/scan-toggle', async (req, res) => {
  const action = req.body?.action;
  if (action === 'start' || (!action && !scanner.isRunning())) {
    await scanner.startScanner();
    return res.json({ ok: true, started: true });
  } else {
    await scanner.stopScanner();
    return res.json({ ok: true, stopped: true });
  }
});

// Start server
(async () => {
  await connectDB();
  await ensureSettings();

  // start monitor loop (background)
  try {
    monitor.monitorLoop().catch(e => console.error('monitorLoop error:', e));
    console.log('✅ Position monitor started');
  } catch (e) {
    console.warn('monitor start warning:', e.message || e);
  }

  // optionally auto-start scanner if env set
  if (process.env.START_SCANNER === 'true') {
    try { await scanner.startScanner(); console.log('Scanner auto-started from env'); } catch(e){}
  }

  app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`🔗 Webhook route: /bot<TOKEN>`);
  });
})();