require('dotenv').config();
const path = require('path');
const express = require('express');
const mongoose = require('mongoose');
const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');

// Models
const Signal = require('./models/Signal');
const Position = require('./models/Position');
const Settings = require('./models/Settings');
const BacktestResult = require('./models/BacktestResult');

// Modules
const strategyRegistry = require('./strategies/registry');
const scanner = require('./scanner');
const botModule = require('./bot');

const PORT = process.env.PORT || 10000;
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL || process.env.RENDER_URL || '';
const TOKENS = new Map();
const WORKERS = new Map();

// Express + middleware
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const { Server: IOServer } = require('socket.io');
const io = new IOServer(server, { cors: { origin: '*' } });

// Load strategies
strategyRegistry.autoload(path.join(__dirname, 'strategies'));

// Helpers
function createToken() { return crypto.randomBytes(24).toString('hex'); }
function requireAuth(req, res, next) {
  const token = req.headers['x-admin-token'] || req.query.token;
  if (!token || !TOKENS.has(token)) return res.status(401).json({ error: 'unauthorized' });
  next();
}
function emitSignalCreated(doc) { io.emit('signal:new', doc); }
function emitSettingsUpdated(s) { io.emit('settings:updated', s); }
function emitScannerStatus(running) { io.emit('scanner:status', { running }); }

// Mongo connect
async function connectDB() {
  const uri = process.env.MONGO_URI;
  if (!uri) { console.error('MONGO_URI missing'); process.exit(1); }
  await mongoose.connect(uri).catch(err => { console.error('MongoDB error', err); process.exit(1); });
  console.log('✅ MongoDB connected');
}

// Socket.IO init
io.on('connection', (socket) => {
  socket.on('init', async () => {
    const s = await Settings.findOne();
    const signals = await Signal.find().sort({ createdAt: -1 }).limit(100);
    const positions = await Position.find({ status: 'open' }).limit(100);
    socket.emit('init:data', {
      settings: s || {},
      signals,
      positions,
      scannerRunning: scanner.isRunning()
    });
  });
});

// Routes

// Auth
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

// Settings
app.get('/api/settings', requireAuth, async (req, res) => {
  const s = await Settings.findOne();
  res.json(s || {});
});
app.post('/api/settings', requireAuth, async (req, res) => {
  const updated = await Settings.findOneAndUpdate({}, req.body, { new: true, upsert: true });
  emitSettingsUpdated(updated);
  res.json(updated);
});

// Signals / Positions
app.get('/api/signals', requireAuth, async (req, res) => {
  const list = await Signal.find().sort({ createdAt: -1 }).limit(500);
  res.json(list);
});
app.get('/api/positions', requireAuth, async (req, res) => {
  const list = await Position.find().sort({ openedAt: -1 }).limit(200);
  res.json(list);
});

// Scanner
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

// Strategies
app.get('/api/strategies', requireAuth, async (req, res) => {
  const list = strategyRegistry.list();
  const active = (await Settings.findOne())?.activeStrategy || strategyRegistry.getActive();
  res.json({ strategies: list, active });
});
app.post('/api/strategy/activate', requireAuth, async (req, res) => {
  const name = req.body?.name;
  if (!name) return res.status(400).json({ error: 'name required' });
  await strategyRegistry.activate(name);
  const updated = await Settings.findOneAndUpdate({}, { activeStrategy: name, lastUpdated: new Date() }, { new: true, upsert: true });
  io.emit('strategy:activated', { name });
  if (scanner.isRunning()) {
    await scanner.stopScanner();
    setTimeout(() => scanner.startScanner().catch(()=>{}), 1000);
  }
  res.json({ ok: true, active: name });
});

// Signal candidate
app.post('/signal-candidate', async (req, res) => {
  const cand = req.body;
  if (!cand?.symbol) return res.status(400).json({ error: 'invalid candidate' });
  const doc = await Signal.create({
    pair: cand.symbol,
    symbol: cand.symbol,
    type: cand.side || 'BUY',
    price: cand.price || 0,
    confirmations: cand.confirmations || [],
    indicators: cand.indicators || cand,
    status: 'candidate',
    createdAt: new Date()
  });
  emitSignalCreated(doc);
  if (botModule?.sendCandidate) {
    await botModule.sendCandidate(doc).catch(e => console.error('sendCandidate err', e));
  }
  res.json({ ok: true, id: doc._id });
});

// Telegram webhook (POST only)
if (TELEGRAM_TOKEN) {
  app.post(`/bot${TELEGRAM_TOKEN}`, (req, res) => {
    if (botModule?.bot?.processUpdate) {
      try {
        botModule.bot.processUpdate(req.body);
        return res.sendStatus(200);
      } catch (e) {
        console.error('bot error', e);
        return res.sendStatus(500);
      }
    }
    return res.sendStatus(200);
  });
}

// Backtest endpoints
app.post('/api/backtest/run', requireAuth, async (req, res) => {
  const body = req.body;
  if (!body?.symbol || !body?.strategy) return res.status(400).json({ error: 'symbol & strategy required' });
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
});
app.get('/api/backtests', requireAuth, async (req, res) => {
  const list = await BacktestResult.find().sort({ createdAt: -1 }).limit(200);
  res.json(list);
});
app.get('/api/backtest/:id', requireAuth, async (req, res) => {
  const doc = await BacktestResult.findById(req.params.id);
  if (!doc) return res.status(404).json({ error: 'not found' });
  res.json(doc);
});

// Startup
(async () => {
  await connectDB();
  const s = await Settings.findOne();
  if (!s) { await new Settings().save(); emitSettingsUpdated(s); }
  try {
    if (process.env.USE_POLLING === 'true') {
      await botModule.init({ polling: true });
      console.log('Bot polling mode');
    } else {
      await botModule.init({ webHook: { port: false } });
      if (RENDER_EXTERNAL_URL && TELEGRAM_TOKEN && botModule.bot?.setWebHook) {
        await botModule.bot.setWebHook(`${RENDER_EXTERNAL_URL}/bot${TELEGRAM_TOKEN}`);
        console.log('Webhook set to', `${RENDER_EXTERNAL_URL}/bot${TELEGRAM_TOKEN}`);
      }
    }
  } catch (e) { console.warn('bot init err', e); }
  try {
    const monitor = require('./monitor');
    monitor.monitorLoop().catch(err => console.error('monitor err', err));
    console.log('Position monitor started');
  } catch {}
  if (process.env.START_SCANNER === 'true') {
    await scanner.startScanner().catch(e => console.warn('start scanner err', e));
  }
  server.listen(PORT, () => console.log('Server + Socket.IO running on port', PORT));
})();