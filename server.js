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

// models
const Signal = require('./models/Signal');
const PnL = require('./models/PnL');
const Position = (() => { try { return require('./models/Position'); } catch (e) { return null; } })();
const Settings = require('./models/Settings'); // ✅ Only one definition

// bot module
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

// scanner process
let scannerProc = null;
let scannerRunning = false;

// Environment
const PORT = process.env.PORT || 10000;
const START_SCANNER_AS_CHILD = (process.env.START_SCANNER_AS_CHILD === 'true');
const SCANNER_SCRIPT = process.env.SCANNER_SCRIPT || path.join(__dirname, 'scanner.js');

// ----------------- MongoDB Connect -----------------
async function connectDB() {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    console.error('❌ MONGO_URI not set in env. Exiting.');
    process.exit(1);
  }
  try {
    await mongoose.connect(mongoUri);
    console.log('✅ MongoDB connected');
  } catch (err) {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
  }
}

// ----------------- Ensure settings doc -----------------
async function ensureSettings() {
  try {
    const one = await Settings.findOne();
    if (!one) {
      const s = new Settings(); // uses defaults
      await s.save();
      console.log('⚙️ Settings document created with defaults');
    }
  } catch (err) {
    console.error('⚠️ Failed to ensure settings:', err.message);
  }
}

// ----------------- Signal candidate route -----------------
app.post('/signal-candidate', async (req, res) => {
  try {
    const cand = req.body;
    if (!cand || !cand.symbol || !cand.side) {
      return res.status(400).json({ error: 'Invalid candidate payload' });
    }

    const doc = await Signal.create({
      pair: cand.symbol || cand.pair,
      symbol: cand.symbol || cand.pair,
      type: cand.side || 'BUY',
      price: cand.price || cand.entry || 0,
      confirmations: cand.confirmations || cand.indicators || [],
      indicators: cand,
      status: 'candidate',
      createdAt: new Date()
    });

    if (botModule?.sendCandidate) {
      try {
        await botModule.sendCandidate(doc);
      } catch (e) {
        console.error('bot.sendCandidate error:', e.message);
      }
    } else {
      console.log('Candidate received but bot.sendCandidate not available. ID:', doc._id);
    }

    res.json({ ok: true, id: doc._id });
  } catch (e) {
    console.error('/signal-candidate error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ----------------- API endpoints -----------------
app.get('/api/signals', async (req, res) => {
  try {
    const list = await Signal.find().sort({ createdAt: -1 }).limit(100);
    res.json(list);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/latest-scan', async (req, res) => {
  try {
    const list = await Signal.find({ status: { $in: ['candidate', 'confirmed'] } })
      .sort({ createdAt: -1 })
      .limit(50);
    res.json(list);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/settings', async (req, res) => {
  try {
    const s = await Settings.findOne();
    res.json(s || {});
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/settings', async (req, res) => {
  try {
    const updated = await Settings.findOneAndUpdate({}, req.body, { new: true, upsert: true });
    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ----------------- Scan toggle -----------------
app.post('/api/scan-toggle', (req, res) => {
  const action = req.body?.action?.toLowerCase();
  if (action === 'start' || (!action && !scannerRunning)) {
    const started = startScannerChild();
    return res.json({ ok: true, started: !!started });
  } else {
    const stopped = stopScannerChild();
    return res.json({ ok: true, stopped: !!stopped });
  }
});

// ----------------- Start/Stop scanner -----------------
function startScannerChild() {
  if (scannerRunning) {
    console.log('Scanner already running.');
    return false;
  }
  if (!require('fs').existsSync(SCANNER_SCRIPT)) {
    console.warn('Scanner script not found:', SCANNER_SCRIPT);
    return false;
  }

  console.log('Starting scanner:', SCANNER_SCRIPT);
  scannerProc = spawn(process.execPath, [SCANNER_SCRIPT], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ['ignore', 'inherit', 'inherit']
  });

  scannerProc.on('exit', (code, signal) => {
    console.log(`Scanner exited (code=${code}, signal=${signal})`);
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
    console.error('Failed to stop scanner:', e);
    return false;
  }
}

// ----------------- Health endpoint -----------------
app.get('/api/status', (req, res) => {
  const dbState = mongoose.connection.readyState; // 1 = connected
  res.json({
    dbConnected: dbState === 1,
    scannerRunning,
    botLoaded: !!botModule,
    monitorLoaded: !!monitor
  });
});

// ----------------- Start server -----------------
(async () => {
  await connectDB();
  await ensureSettings();

  if (monitor?.monitorLoop) {
    try {
      monitor.monitorLoop().catch(err => console.error('monitor error:', err));
      console.log('✅ Position monitor started.');
    } catch (e) {
      console.warn('Monitor start failed:', e.message);
    }
  }

  if (START_SCANNER_AS_CHILD) {
    const ok = startScannerChild();
    console.log('Scanner auto-started?:', ok);
  } else {
    console.log('Scanner not auto-started. Use /api/scan-toggle.');
  }

  app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`🔗 Dashboard at /`);
  });
})();

// ----------------- Graceful shutdown -----------------
async function shutdown() {
  console.log('Shutting down...');
  try {
    if (scannerProc) {
      scannerProc.kill('SIGTERM');
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