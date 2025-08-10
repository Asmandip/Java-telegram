// server.js - webhook-ready main server (Milestone A)
require('dotenv').config();
const path = require('path');
const express = require('express');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const http = require('http');
const { Server: IOServer } = require('socket.io');

const app = express();
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = new IOServer(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 10000;

const Signal = require('./models/Signal');
const Settings = require('./models/Settings');
const botModule = require('./bot'); // exports { bot, sendCandidate }
const scanner = require('./scanner');
const monitor = require('./monitor');

// MongoDB connect
async function connectDB() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error('MONGO_URI not set. Exiting.');
    process.exit(1);
  }
  try {
    await mongoose.connect(uri);
    console.log('✅ MongoDB connected');
  } catch (e) {
    console.error('MongoDB connection error:', e);
    process.exit(1);
  }
}

// Ensure singleton settings
async function ensureSettings() {
  try {
    const s = await Settings.findOne();
    if (!s) {
      const doc = new Settings();
      await doc.save();
      console.log('⚙️ Default settings created');
    }
  } catch (e) {
    console.error('ensureSettings error:', e);
  }
}

// Webhook route (Telegram will POST updates here)
if (botModule && botModule.bot) {
  const token = process.env.TELEGRAM_TOKEN;
  if (token) {
    app.post(`/bot${token}`, (req, res) => {
      try {
        botModule.bot.processUpdate(req.body);
        res.sendStatus(200);
      } catch (e) {
        console.error('bot.processUpdate error:', e);
        res.sendStatus(500);
      }
    });
  } else {
    console.warn('TELEGRAM_TOKEN not set; webhook route not created.');
  }
}

// Signal candidate endpoint (scanner -> server)
app.post('/signal-candidate', async (req, res) => {
  try {
    const cand = req.body;
    if (!cand || !cand.symbol) return res.status(400).json({ error: 'invalid candidate' });

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

    // emit realtime event
    io.emit('signal:new', doc);

    // notify Telegram
    if (botModule?.sendCandidate) {
      try { await botModule.sendCandidate(doc); } catch (e) { console.error('sendCandidate err', e); }
    }
    res.json({ ok: true, id: doc._id });
  } catch (e) {
    console.error('/signal-candidate error', e);
    res.status(500).json({ error: e.message || String(e) });
  }
});

// API: status, signals, settings, control scanner
app.get('/api/status', async (req, res) => {
  res.json({
    db: mongoose.connection.readyState === 1,
    scannerRunning: scanner.isRunning(),
    webhook: !!(botModule && botModule.bot)
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
  io.emit('settings:updated', updated);
  res.json(updated);
});

app.post('/api/scan-toggle', async (req, res) => {
  const action = req.body?.action;
  if (action === 'start' || (!action && !scanner.isRunning())) {
    await scanner.startScanner();
    io.emit('scanner:status', { running: true });
    return res.json({ ok: true, started: true });
  } else {
    await scanner.stopScanner();
    io.emit('scanner:status', { running: false });
    return res.json({ ok: true, stopped: true });
  }
});

// socket.io connection
io.on('connection', (socket) => {
  console.log('socket connected', socket.id);
  socket.on('ping', () => socket.emit('pong'));
});

// start sequence
(async () => {
  await connectDB();
  await ensureSettings();

  // start monitor loop in background
  try {
    monitor.monitorLoop().catch(err => console.error('monitorLoop error', err));
    console.log('✅ Position monitor started');
  } catch (e) {
    console.warn('monitor start warning', e);
  }

  // optional auto-start scanner
  if (process.env.START_SCANNER === 'true') {
    await scanner.startScanner();
    console.log('Scanner auto-started by env');
  }

  server.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`🔗 Webhook route (if set): /bot<TOKEN>`);
  });
})();