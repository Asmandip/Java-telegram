require('dotenv').config();
const path = require('path');
const express = require('express');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');

const BacktestResult = require('./models/BacktestResult');
const Signal = require('./models/Signal');
const Position = require('./models/Position');
const Settings = require('./models/Settings');

const strategyRegistry = require('./strategies/registry');
const scanner = require('./scanner');
const botModule = require('./bot');

const PORT = process.env.PORT || 10000;
const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL || process.env.RENDER_URL || '';
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const WORKERS = new Map();
const TOKENS = new Map();

// =======================
// INIT APP + MIDDLEWARE
// =======================
const app = express();
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const { Server: IOServer } = require('socket.io');
const io = new IOServer(server, { cors: { origin: '*' } });

strategyRegistry.autoload(path.join(__dirname, 'strategies'));

// =======================
// HELPERS
// =======================
function createToken() { return crypto.randomBytes(24).toString('hex'); }
function requireAuth(req, res, next) {
  const token = req.headers['x-admin-token'] || req.query.token;
  if (!token || !TOKENS.has(token)) return res.status(401).json({ error: 'unauthorized' });
  next();
}

function emitSignalCreated(doc) { io.emit('signal:new', doc); }
function emitSettingsUpdated(s) { io.emit('settings:updated', s); }
function emitScannerStatus(running) { io.emit('scanner:status', { running }); }
function emitPositionUpdated(p) { io.emit('position:updated', p); }

async function connectDB() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error('MONGO_URI not set. Exiting.');
    process.exit(1);
  }
  await mongoose.connect(uri).catch(err => { console.error('Mongo connect err', err); process.exit(1); });
  console.log('✅ MongoDB connected');
}

// =======================
// SOCKET.IO EVENTS
// =======================
io.on('connection', (socket) => {
  console.log('socket connected', socket.id);
  socket.on('init', async () => {
    try {
      const s = await Settings.findOne();
      const latestSignals = await Signal.find().sort({ createdAt: -1 }).limit(100);
      const openPositions = await Position.find({ status: 'open' }).limit(100);
      socket.emit('init:data', { settings: s || {}, signals: latestSignals, positions: openPositions, scannerRunning: scanner.isRunning() });
    } catch (e) { console.error('socket init err', e); }
  });
});

// =======================
// ROUTES
// =======================

// --- Auth ---
app.post('/api/auth', (req, res) => {
  const pwd = req.body?.password;
  if (!pwd) return res.status(400).json({ error: 'password required' });
  if (pwd === process.env.ADMIN_PASSWORD) {
    const token = createToken();
    TOKENS.set(token, { createdAt: Date.now() });
    return res.json({ ok: true, token });
  }
  return res.status(403).json({ ok: false, error: 'invalid password' });
});

// --- Settings ---
app.get('/api/settings', requireAuth, async (req, res) => {
  const s = await Settings.findOne();
  res.json(s || {});
});
app.post('/api/settings', requireAuth, async (req, res) => {
  const updated = await Settings.findOneAndUpdate({}, req.body, { new: true, upsert: true });
  emitSettingsUpdated(updated);
  res.json(updated);
});

// --- Signals & Positions ---
app.get('/api/signals', requireAuth, async (req, res) => {
  const list = await Signal.find().sort({ createdAt: -1 }).limit(500);
  res.json(list);
});
app.get('/api/positions', requireAuth, async (req, res) => {
  const list = await Position.find().sort({ openedAt: -1 }).limit(200);
  res.json(list);
});

// --- Scanner control ---
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

// --- Strategies ---
app.get('/api/strategies', requireAuth, async (req, res) => {
  try {
    const list = strategyRegistry.list();
    const active = (await Settings.findOne())?.activeStrategy || strategyRegistry.getActive();
    res.json({ strategies: list, active });
  } catch (e) { res.status(500).json({ error: e.message || String(e) }); }
});
app.post('/api/strategy/activate', requireAuth, async (req, res) => {
  try {
    const name = req.body?.name;
    if (!name) return res.status(400).json({ error: 'name required' });
    await strategyRegistry.activate(name);
    const s = await Settings.findOneAndUpdate({}, { activeStrategy: name, lastUpdated: new Date() }, { new: true, upsert: true });
    io.emit('strategy:activated', { name });
    if (scanner.isRunning()) {
      await scanner.stopScanner();
      setTimeout(() => scanner.startScanner().catch(()=>{}), 1000);
    }
    res.json({ ok: true, active: name });
  } catch (e) { res.status(500).json({ error: e.message || String(e) }); }
});

// --- Signal candidate ---
app.post('/signal-candidate', async (req, res) => {
  try {
    const cand = req.body;
    if (!cand || !cand.symbol) return res.status(400).json({ error: 'invalid candidate' });

    const doc = await Signal.create({
      pair: cand.symbol || cand.pair,
      symbol: cand.symbol || cand.pair,
      type: cand.side || cand.type || 'BUY',
      price: cand.price || cand.entry || 0,
      confirmations: cand.confirmations || [],
      indicators: cand.indicators || cand,
      status: 'candidate',
      createdAt: new Date()
    });

    emitSignalCreated(doc);
    if (botModule?.sendCandidate) {
      try { await botModule.sendCandidate(doc); } catch (e) { console.error('sendCandidate err', e); }
    }
    res.json({ ok: true, id: doc._id });
  } catch (e) {
    console.error('/signal-candidate err', e);
    res.status(500).json({ error: e.message || String(e) });
  }
});

// --- Telegram webhook ---
if (TELEGRAM_TOKEN) {
  app.post(`/bot${TELEGRAM_TOKEN}`, (req, res) => {
    if (botModule && botModule.bot && typeof botModule.bot.processUpdate === 'function') {
      try {
        botModule.bot.processUpdate(req.body);
        return res.sendStatus(200);
      } catch (e) {
        console.error('bot.processUpdate error', e);
        return res.sendStatus(500);
      }
    }
    return res.sendStatus(200);
  });
}

// --- Backtest ---
app.post('/api/backtest/run', requireAuth, async (req, res) => {
  try {
    const body = req.body;
    if (!body || !body.symbol || !body.strategy) return res.status(400).json({ error: 'symbol & strategy required' });
    const job = {
      jobName: body.jobName || `bt_${Date.now()}`,
      symbol: body.symbol,
      timeframe: body.timeframe || '3',
      from: body.from || null,
      to: body.to || null,
      strategy: body.strategy,
      params: body.params || {},
      initialCapital: body.initialCapital || 1000,
      force: !!body.force
    };

    const worker = spawn(process.execPath, [path.join(__dirname, 'workers', 'backtestWorker.js')], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe', 'ipc']
    });

    worker.on('message', m => {
      if (!m) return;
      if (m.type === 'started') WORKERS.set(String(m.id), worker);
      if (m.type === 'progress') io.emit('backtest:progress', { id: m.id || null, pct: m.pct, message: m.message });
      if (m.type === 'done') io.emit('backtest:done', { id: m.id, summary: m.summary });
      if (m.type === 'error') io.emit('backtest:error', { message: m.message });
    });

    worker.on('exit', () => { /* cleanup */ });

    worker.send({ cmd: 'run', job });

    const doc = await BacktestResult.create({
      jobName: job.jobName,
      symbol: job.symbol,
      timeframe: job.timeframe,
      strategy: job.strategy,
      params: job.params,
      initialCapital: job.initialCapital,
      status: 'running'
    });

    res.json({ ok: true, id: doc._id });
  } catch (e) {
    console.error('start backtest err', e);
    res.status(500).json({ error: e.message || String(e) });
  }
});

app.get('/api/backtests', requireAuth, async (req, res) => {
  const list = await BacktestResult.find().sort({ createdAt: -1 }).limit(200);
  res.json(list);
});
app.get('/api/backtest/:id', requireAuth, async (req, res) => {
  const id = req.params.id;
  const doc = await BacktestResult.findById(id);
  if (!doc) return res.status(404).json({ error: 'not found' });
  res.json(doc);
});

// =======================
// STARTUP SEQUENCE
// =======================
(async () => {
  await connectDB();

  try {
    const s = await Settings.findOne();
    if (!s) { const ns = new Settings(); await ns.save(); emitSettingsUpdated(ns); }
  } catch (e) {}

  try {
    if (process.env.USE_POLLING === 'true') {
      await botModule.init({ polling: true });
      console.log('Bot started in polling mode');
    } else {
      await botModule.init({ webHook: { port: false } });
      if (RENDER_EXTERNAL_URL && TELEGRAM_TOKEN) {
        try {
          if (botModule.bot?.setWebHook) {
            await botModule.bot.setWebHook(`${RENDER_EXTERNAL_URL}/bot${TELEGRAM_TOKEN}`);
            console.log('Webhook set to', `${RENDER_EXTERNAL_URL}/bot${TELEGRAM_TOKEN}`);
          }
        } catch (e) { console.warn('setWebHook err', e); }
      }
    }
  } catch (e) { console.warn('bot init error', e); }

  try {
    const monitor = require('./monitor');
    monitor.monitorLoop().catch(err => console.error('monitor err', err));
    console.log('Position monitor started');
  } catch (e) {}

  if (process.env.START_SCANNER === 'true') {
    try { await scanner.startScanner(); console.log('Scanner auto-started'); } catch (e) { console.warn('start scanner err', e); }
  }

  server.listen(PORT, () => {
    console.log('✅ Server + Socket.IO running on port', PORT);
  });
})();