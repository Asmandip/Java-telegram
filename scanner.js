/**
 * scanner.js
 * Bitget Futures scanner (rate-limit safe)
 *
 * Features:
 * - caches futures symbol list (TTL configurable)
 * - uses 3m candles (configurable)
 * - calculates RSI(14), EMA(9,21), ATR(14), Volume spike
 * - requires >= CONFIRMATIONS_REQUIRED to post a candidate
 * - posts to LOCAL_SERVER /signal-candidate
 * - provides simple express endpoints: /scan-now and /latest-signal
 *
 * Usage:
 *   Set .env values (LOCAL_SERVER, TF_MINUTES, SCAN_INTERVAL_MS, etc.)
 *   node scanner.js
 */

require('dotenv').config();
const fetch = (...args) => import('node-fetch').then(m => m.default(...args));
const express = require('express');

// config
const LOCAL = process.env.LOCAL_SERVER || 'http://localhost:10000';
const TF_MINUTES = parseInt(process.env.TF_MINUTES || '3', 10);
const SCAN_INTERVAL_MS = parseInt(process.env.SCAN_INTERVAL_MS || '60000', 10); // default 60s
const CONF_REQ = parseInt(process.env.CONFIRMATIONS_REQUIRED || '3', 10);
const SYMBOL_FETCH_LIMIT = parseInt(process.env.SYMBOL_FETCH_LIMIT || '50', 10);
const SYMBOL_CACHE_TTL_MS = parseInt(process.env.SYMBOL_CACHE_TTL_MS || '60000', 10);
const PER_SYMBOL_DELAY_MS = parseInt(process.env.PER_SYMBOL_DELAY_MS || '350', 10);
const MIN_CANDLES = 100; // candles required to compute indicators

// in-memory last results
let lastScan = { time: null, candidates: [] };

// ---------- helpers: indicators ----------
function sma(arr, n) {
  if (!arr || arr.length < n) return null;
  const slice = arr.slice(-n);
  return slice.reduce((a, b) => a + b, 0) / n;
}

function emaFromArray(arr, n) {
  if (!arr || arr.length < n) return null;
  const k = 2 / (n + 1);
  let ema = arr.slice(0, n).reduce((a, b) => a + b, 0) / n;
  for (let i = n; i < arr.length; i++) {
    ema = arr[i] * k + ema * (1 - k);
  }
  return ema;
}

function rsiFromCloses(closes, period = 14) {
  if (!closes || closes.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff;
    else losses += Math.abs(diff);
  }
  if (losses === 0) return 100;
  const rs = (gains / period) / (losses / period);
  return 100 - (100 / (1 + rs));
}

function atrFromOHLC(arr, period = 14) {
  if (!arr || arr.length < period + 1) return null;
  const trs = [];
  for (let i = 1; i < arr.length; i++) {
    const high = arr[i].high, low = arr[i].low, prevClose = arr[i - 1].close;
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    trs.push(tr);
  }
  if (trs.length < period) return null;
  const slice = trs.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

// ---------- Bitget helpers (public futures endpoints) ----------
async function fetchFuturesSymbolsCached() {
  // caching to avoid rate limits
  if (fetchFuturesSymbolsCached.cache && (Date.now() - fetchFuturesSymbolsCached.cache.ts) < SYMBOL_CACHE_TTL_MS) {
    return fetchFuturesSymbolsCached.cache.list;
  }

  let list = [];
  const tryUrls = [
    'https://api.bitget.com/api/mix/v1/market/tickers',     // futures/mix
    'https://api.bitget.com/api/spot/v1/market/tickers'     // fallback
  ];

  for (const url of tryUrls) {
    try {
      const r = await fetch(url, { timeout: 15000 });
      const j = await r.json();
      if (j && j.data && Array.isArray(j.data) && j.data.length) {
        const syms = j.data.map(x => x.symbol).filter(s => !!s && s.toUpperCase().endsWith('USDT'));
        list = syms.slice(0, SYMBOL_FETCH_LIMIT);
        break;
      }
    } catch (e) {
      // continue to next url
    }
  }

  if (!list.length) {
    // fallback core pairs
    list = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT'];
  }

  fetchFuturesSymbolsCached.cache = { ts: Date.now(), list };
  return list;
}

// fetch candles - try several endpoints/formats, normalize
async function fetchCandles(symbol, limit = 300) {
  const tryUrls = [
    // futures/mix typical
    `https://api.bitget.com/api/mix/v1/market/candles?symbol=${symbol}&granularity=${TF_MINUTES * 60}&limit=${limit}`,
    // spot format fallback
    `https://api.bitget.com/api/spot/v1/market/candles?symbol=${symbol}&limit=${limit}`,
    // alternate param style
    `https://api.bitget.com/api/spot/v1/market/candles?symbol=${symbol}&bar=${TF_MINUTES}m&limit=${limit}`
  ];

  for (const url of tryUrls) {
    try {
      const res = await fetch(url, { timeout: 15000 });
      const txt = await res.text();
      const j = JSON.parse(txt);
      if (!j) continue;
      let rows = j.data || j || [];
      if (!Array.isArray(rows) || rows.length === 0) continue;

      const parsed = rows.map(item => {
        if (Array.isArray(item)) {
          // [time, open, high, low, close, volume] typical
          return { time: item[0], open: parseFloat(item[1]), high: parseFloat(item[2]), low: parseFloat(item[3]), close: parseFloat(item[4]), vol: parseFloat(item[5]) };
        }
        // object case: different keys possible
        const o = parseFloat(item.o ?? item.open ?? item[1]);
        const h = parseFloat(item.h ?? item.high ?? item[2]);
        const l = parseFloat(item.l ?? item.low ?? item[3]);
        const c = parseFloat(item.c ?? item.close ?? item[4]);
        const v = parseFloat(item.v ?? item.volume ?? item[5] ?? 0);
        return { time: item.t ?? item.time ?? item[0], open: o, high: h, low: l, close: c, vol: v };
      }).filter(Boolean);

      if (parsed.length >= MIN_CANDLES) return parsed;
      // else try next URL
    } catch (e) {
      // try next
    }
  }

  return null;
}

// ---------- analyze symbol ----------
async function analyzeSymbol(symbol) {
  try {
    const candles = await fetchCandles(symbol, 300);
    if (!candles || candles.length < MIN_CANDLES) return null;

    const closes = candles.map(c => c.close);
    const vols = candles.map(c => c.vol || 0);
    const last = candles[candles.length - 1];

    const rsi = rsiFromCloses(closes, 14);
    const ema9 = emaFromArray(closes, 9);
    const ema21 = emaFromArray(closes, 21);
    const atr = atrFromOHLC(candles, 14);
    const avgVol = sma(vols, 20);
    const volNow = vols[vols.length - 1];

    const conds = [];
    if (rsi !== null && rsi < 35) conds.push('RSI_BUY');
    if (rsi !== null && rsi > 65) conds.push('RSI_SELL');
    if (ema9 !== null && ema21 !== null && ema9 > ema21) conds.push('EMA_BULL');
    if (ema9 !== null && ema21 !== null && ema9 < ema21) conds.push('EMA_BEAR');
    if (avgVol !== null && volNow > avgVol * 1.2) conds.push('VOL_SPIKE');
    if (atr !== null && Math.abs(last.close - candles[candles.length - 2].close) > 0.5 * atr) conds.push('ATR_MOVE');

    // determine side
    let side = null;
    if (conds.includes('RSI_BUY') && conds.includes('EMA_BULL')) side = 'BUY';
    if (conds.includes('RSI_SELL') && conds.includes('EMA_BEAR')) side = 'SELL';
    if (!side && conds.length >= CONF_REQ) side = (ema9 > ema21) ? 'BUY' : 'SELL';

    if (!side) return null;

    return {
      symbol,
      side,
      price: last.close,
      rsi: rsi || 0,
      ema9: ema9 || 0,
      ema21: ema21 || 0,
      atr: atr || 0,
      volNow,
      avgVol,
      confirmations: conds,
      time: new Date().toISOString()
    };
  } catch (e) {
    console.error('analyzeSymbol err', symbol, e.message || e);
    return null;
  }
}

// post candidate to server
async function postCandidate(candidate) {
  try {
    await fetch(`${LOCAL}/signal-candidate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(candidate)
    });
    console.log(`[POST] candidate: ${candidate.symbol} ${candidate.side} (confs:${candidate.confirmations.length})`);
  } catch (e) {
    console.error('postCandidate err', e.message || e);
  }
}

// ---------- main scan loop (rate-limit safe) ----------
async function scanMarket() {
  const resultCandidates = [];
  const symbols = await fetchFuturesSymbolsCached();
  const toScan = symbols.slice(0, SYMBOL_FETCH_LIMIT);

  for (const sym of toScan) {
    try {
      const cand = await analyzeSymbol(sym);
      if (cand && cand.confirmations && cand.confirmations.length >= CONF_REQ) {
        resultCandidates.push(cand);
        // post candidate but don't wait too long
        postCandidate(cand).catch(() => {});
      }
    } catch (e) {
      console.error('scan symbol error', sym, e.message || e);
    }
    // small per-symbol delay to avoid bursts
    await new Promise(r => setTimeout(r, PER_SYMBOL_DELAY_MS));
  }

  lastScan = { time: new Date().toISOString(), candidates: resultCandidates };
  return resultCandidates;
}

// ---------- express server for manual control ----------
const app = express();
app.use(express.json());

app.get('/latest-signal', (req, res) => {
  res.json(lastScan);
});

app.get('/scan-now', async (req, res) => {
  try {
    const out = await scanMarket();
    res.json({ time: new Date().toISOString(), results: out });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

const PORT = process.env.SCAN_PORT || 3010;
app.listen(PORT, () => {
  console.log(`🔎 Scanner HTTP running on port ${PORT}`);
});

// auto-scan interval (safe)
(async function scheduler() {
  console.log('Scanner scheduler started — interval (ms):', SCAN_INTERVAL_MS);
  // initial delay to avoid immediate heavy load on start
  await new Promise(r => setTimeout(r, 3000));
  while (true) {
    try {
      await scanMarket();
    } catch (e) {
      console.error('scanMarket fatal error', e.message || e);
    }
    await new Promise(r => setTimeout(r, SCAN_INTERVAL_MS));
  }
})();