// server.js (Milestone B - integrated with dashboard + socket.io)
require('dotenv').config();
const path = require('path');
const express = require('express');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const http = require('http');
const { Server: IOServer } = require('socket.io');
const crypto = require('crypto');

const app = express();
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public'))); // serve dashboard static files

const server = http.createServer(app);
const io = new IOServer(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 10000;

// Models (assume these exist)
const Signal = require('./models/Signal');
const Position = require('./models/Position');
const Settings = require('./models/Settings');

// scanner & bot modules (must export start/stop and sendCandidate)
const scanner = require('./scanner');
const botModule = require('./bot'); // should export sendCandidate or initBot as earlier

// in-memory auth tokens (simple)
const TOKENS = new Map();
function createToken() {
  return crypto.randomBytes(24).toString('hex');
}

// ---------------- DB ----------------
async function connectDB() {
  try {
    if (!process.env.MONGO_URI) {
      console.error('MONGO_URI not set in env');
      process.exit(1);
    }
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ MongoDB connected');
  } catch (e) {
    console.error('MongoDB connect error', e);
    process.exit(1);
  }
}

// ---------------- Socket.IO ----------------
io.on('connection', (socket) => {
  console.log('socket connected', socket.id);

  // client can request initial data
  socket.on('init', async () => {
    try {
      const s = await Settings.findOne();
      const latestSignals = await Signal.find().sort({ createdAt: -1 }).limit(50);
      const openPositions = await Position.find({ status: 'open' }).limit(50);
      socket.emit('init:data', { settings: s || {}, signals: latestSignals, positions: openPositions, scannerRunning: scanner.isRunning() });
    } catch (e) {
      console.error('init error', e);
    }
  });

  socket.on('ping', () => socket.emit('pong'));
});

// helper to emit updates to all dashboard clients
async function emitSignalCreated(doc) {
  io.emit('signal:new', doc);
}
async function emitSettingsUpdated(s) {
  io.emit('settings:updated', s);
}
async function emitScannerStatus(running) {
  io.emit('scanner:status', { running });
}
async function emitPositionUpdated(pos) {
  io.emit('position:updated', pos);
}

// ---------------- API: Auth ----------------
app.post('/api/auth', (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'password required' });
  if (password === process.env.ADMIN_PASSWORD) {
    const token = createToken();
    TOKENS.set(token, { createdAt: Date.now() });
    return res.json({ ok: true, token });
  }
  return res.status(403).json({ ok: false, error: 'invalid password' });
});

function requireAuth(req, res, next) {
  const token = req.headers['x-admin-token'] || req.query.token;
  if (!token || !TOKENS.has(token)) return res.status(401).json({ error: 'unauthorized' });
  next();
}

// ---------------- API: Settings ----------------
app.get('/api/settings', requireAuth, async (req, res) => {
  const s = await Settings.findOne();
  res.json(s || {});
});

app.post('/api/settings', requireAuth, async (req, res) => {
  const updated = await Settings.findOneAndUpdate({}, req.body, { new: true, upsert: true });
  emitSettingsUpdated(updated);
  res.json(updated);
});

// ---------------- API: Signals / Positions ----------------
app.get('/api/signals', requireAuth, async (req, res) => {
  const list = await Signal.find().sort({ createdAt: -1 }).limit(500);
  res.json(list);
});

app.get('/api/positions', requireAuth, async (req, res) => {
  const list = await Position.find().sort({ openedAt: -1 }).limit(200);
  res.json(list);
});

// ---------------- API: Scanner control ----------------
app.post('/api/scan-toggle', requireAuth, async (req, res) => {
  const action = req.body?.action;
  if (action === 'start' || (!action && !scanner.isRunning())) {
    await scanner.startScanner();
    emitScannerStatus(true);
    return res.json({ ok: true, started: true });
  } else {
    await scanner.stopScanner();
    emitScannerStatus(false);
    return res.json({ ok: true, stopped: true });
  }
});

// ---------------- Webhook route for telegram (ensure bot sets webhook to /bot<TOKEN>) ----------------
// If your bot module uses its own processUpdate, scanner will still post to /signal-candidate
const TOKEN = process.env.TELEGRAM_TOKEN;
if (TOKEN) {
  app.post(`/bot${TOKEN}`, (req, res) => {
    // if bot module exposes processUpdate function, use that
    if (botModule && typeof botModule.bot !== 'undefined' && typeof botModule.bot.processUpdate === 'function') {
      try {
        botModule.bot.processUpdate(req.body);
        res.sendStatus(200);
      } catch (e) {
        console.error('bot processUpdate error', e);
        res.sendStatus(500);
      }
    } else {
      // fallback: just return OK
      res.sendStatus(200);
    }
  });
}

// ---------------- Endpoint scanner -> server (signal candidate) ----------------
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

    // notify: socket + telegram
    emitSignalCreated(doc);
    if (botModule?.sendCandidate) {
      try { await botModule.sendCandidate(doc); } catch (e) { console.error('sendCandidate err', e); }
    }
    res.json({ ok: true, id: doc._id });
  } catch (e) {
    console.error('/signal-candidate error', e);
    res.status(500).json({ error: e.message || String(e) });
  }
});

// ---------------- Start server ----------------
(async () => {
  await connectDB();
  // ensure settings document exists
  try {
    const s = await Settings.findOne();
    if (!s) {
      const ns = new Settings();
      await ns.save();
      emitSettingsUpdated(ns);
    }
  } catch (e) { /* ignore */ }

  // start monitor in background (if exists)
  try {
    const monitor = require('./monitor');
    monitor.monitorLoop().catch(err => console.error('monitor error', err));
  } catch (e) { /* ignore */ }

  server.listen(PORT, () => {
    console.log('✅ Server + Socket.IO running on port', PORT);
  });
})();