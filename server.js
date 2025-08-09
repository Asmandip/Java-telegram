// server.js (CommonJS) - integrated server + bot + monitor + scanner launcher
require('dotenv').config();
const path = require('path');
const express = require('express');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const { spawn } = require('child_process');

const app = express();
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// models (adjust paths if your models are elsewhere)
const Signal = require('./models/Signal');
const PnL = require('./models/PnL');
const Position = (() => { try { return require('./models/Position'); } catch(e){ return null; } })();
const Settings = (() => { try { return require('./models/Settings'); } catch(e){ return null; } })();

// bot module (should export sendCandidate or sendCandidate function)
let botModule = null;
try {
  botModule = require('./bot');
} catch (e) {
  console.warn('Warning: bot module not found or failed to load:', e.message);
}

// monitor
let monitor = null;
try {
  monitor = require('./monitor');
} catch (e) {
  console.warn('Warning: monitor module not found or failed to load:', e.message);
}

// scanner process handle (if launched by server)
let scannerProc = null;
let scannerRunning = false;

// Environment / defaults
const PORT = process.env.PORT || 10000;
const START_SCANNER = (process.env.START_SCANNER === 'true') || false;
const START_SCANNER_AS_CHILD = (process.env.START_SCANNER_AS_CHILD === 'true') || START_SCANNER;
const SCANNER_SCRIPT = process.env.SCANNER_SCRIPT || path.join(__dirname, 'scanner.js');

// ----------------- MongoDB Connect -----------------
async function connectDB() {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    console.error('❌ MONGO_URI not set in env. Exiting.');
    process.exit(1);
  }
  try {
    await mongoose.connect(mongoUri, { /* mongoose v7 uses unified defaults */ });
    console.log('✅ MongoDB connected');
  } catch (err) {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
  }
}

// ----------------- Helper: ensure settings doc -----------------
async function ensureSettings() {
  if (!Settings) return;
  const one = await Settings.findOne();
  if (!one) {
    const s = new Settings(); // uses defaults from schema
    await s.save();
    console.log('⚙️ Settings document created with defaults');
  }
}

// ----------------- Signal candidate route (scanner -> server) -----------------
app.post('/signal-candidate', async (req, res) => {
  try {
    const cand = req.body;
    if (!cand || !cand.symbol || !cand.side) {
      return res.status(400).json({ error: 'Invalid candidate payload' });
    }

    // Save to DB (shape tolerant for older/newer models)
    const doc = await Signal.create({
      pair: cand.symbol || cand.pair || cand.symbol,
      symbol: cand.symbol || cand.pair || cand.symbol,
      type: cand.side || cand.type || 'BUY',
      price: cand.price || cand.entry || 0,
      confirmations: cand.confirmations || cand.confirmations || cand.indicators || [],
      indicators: cand, // store full payload for later analysis
      status: 'candidate',
      createdAt: new Date()
    });

    // Notify via Telegram bot if available
    if (botModule && typeof botModule.sendCandidate === 'function') {
      try {
        await botModule.sendCandidate(doc);
      } catch (e) {
        console.error('bot.sendCandidate error:', e.message || e);
      }
    } else {
      console.log('Candidate received but bot.sendCandidate not available. Candidate id:', doc._id);
    }

    return res.json({ ok: true, id: doc._id });
  } catch (e) {
    console.error('/signal-candidate error:', e.message || e);
    return res.status(500).json({ error: (e.message || String(e)) });
  }
});

// ----------------- API: signals, latest-scan (from DB), settings -----------------
app.get('/api/signals', async (req, res) => {
  try {
    const list = await Signal.find().sort({ createdAt: -1 }).limit(100);
    res.json(list);
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

app.get('/api/latest-scan', async (req, res) => {
  try {
    // return most recent candidates (status candidate or confirmed)
    const list = await Signal.find({ status: { $in: ['candidate','confirmed'] } }).sort({ createdAt: -1 }).limit(50);
    res.json(list);
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

app.get('/api/settings', async (req, res) => {
  try {
    if (!Settings) return res.json({ message: 'Settings model not present' });
    const s = await Settings.findOne();
    res.json(s || {});
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

app.post('/api/settings', async (req, res) => {
  try {
    if (!Settings) return res.status(400).json({ error: 'Settings model not present' });
    const newVals = req.body;
    const updated = await Settings.findOneAndUpdate({}, newVals, { new: true, upsert: true });
    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

// ----------------- API: scan toggle (start/stop child scanner) -----------------
app.post('/api/scan-toggle', async (req, res) => {
  try {
    const action = req.body && req.body.action ? req.body.action.toLowerCase() : null;
    if (action === 'start' || (!action && !scannerRunning)) {
      const started = startScannerChild();
      return res.json({ ok: true, started: !!started });
    } else {
      const stopped = stopScannerChild();
      return res.json({ ok: true, stopped: !!stopped });
    }
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
});

// ----------------- Utility: start/stop scanner as child process -----------------
function startScannerChild() {
  if (scannerRunning) {
    console.log('Scanner already running as child process.');
    return false;
  }
  if (!require('fs').existsSync(SCANNER_SCRIPT)) {
    console.warn('Scanner script not found:', SCANNER_SCRIPT);
    return false;
  }

  console.log('Starting scanner child process:', SCANNER_SCRIPT);
  scannerProc = spawn(process.execPath, [SCANNER_SCRIPT], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ['ignore', 'inherit', 'inherit']
  });

  scannerProc.on('exit', (code, signal) => {
    console.log(`Scanner process exited (code=${code}, signal=${signal})`);
    scannerRunning = false;
    scannerProc = null;
  });

  scannerProc.on('error', (err) => {
    console.error('Scanner process error:', err);
    scannerRunning = false;
    scannerProc = null;
  });

  scannerRunning = true;
  return true;
}

function stopScannerChild() {
  if (!scannerRunning || !scannerProc) return false;
  try {
    scannerProc.kill('SIGTERM');
    scannerRunning = false;
    scannerProc = null;
    return true;
  } catch (e) {
    console.error('Failed to stop scanner process:', e);
    return false;
  }
}

// ----------------- Health endpoint -----------------
app.get('/api/status', async (req, res) => {
  try {
    const dbState = mongoose.connection.readyState; // 1 = connected
    const status = {
      dbConnected: dbState === 1,
      scannerRunning,
      botLoaded: !!botModule,
      monitorLoaded: !!monitor
    };
    res.json(status);
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

// ----------------- Start server & services -----------------
(async () => {
  await connectDB();
  await ensureSettings();

  // start monitor if available
  if (monitor && typeof monitor.monitorLoop === 'function') {
    try {
      monitor.monitorLoop().catch(err => console.error('monitor error:', err));
      console.log('✅ Position monitor started (monitor.monitorLoop)');
    } catch (e) {
      console.warn('monitor start failed:', e.message || e);
    }
  } else if (monitor && typeof monitor === 'function') {
    // older export style
    try {
      monitor().catch(e=>console.error('monitor func err', e));
    } catch(e){}
  }

  // optionally start scanner as child process (controlled by env var)
  if (START_SCANNER_AS_CHILD) {
    const ok = startScannerChild();
    console.log('Scanner started by server?:', ok);
  } else {
    console.log('Scanner not auto-started. Use /api/scan-toggle or run scanner.js separately.');
  }

  app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`🔗 Dashboard available at / (serve public/dashboard.html)`);
  });
})();

// ----------------- Graceful shutdown -----------------
async function shutdown() {
  console.log('Shutting down...');
  try {
    if (scannerProc) {
      try { scannerProc.kill('SIGTERM'); } catch (e) {}
      scannerProc = null;
    }
    await mongoose.disconnect();
    console.log('Mongo disconnected.');
    process.exit(0);
  } catch (e) {
    console.error('Shutdown error:', e);
    process.exit(1);
  }
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);