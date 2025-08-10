// scanner.js - rate-limit safe scanner, posts to /signal-candidate
require('dotenv').config();
const fetch = (...args) => import('node-fetch').then(m => m.default(...args));
const LOCAL = process.env.LOCAL_SERVER || process.env.RENDER_EXTERNAL_URL || 'http://localhost:10000';
const TF_MINUTES = parseInt(process.env.TF_MINUTES || '3', 10);
const SCAN_INTERVAL_MS = parseInt(process.env.SCAN_INTERVAL_MS || '60000', 10);
const CONF_REQ = parseInt(process.env.CONFIRMATIONS_REQUIRED || '3', 10);
const SYMBOL_FETCH_LIMIT = parseInt(process.env.SYMBOL_FETCH_LIMIT || '50', 10);
const PER_SYMBOL_DELAY_MS = parseInt(process.env.PER_SYMBOL_DELAY_MS || '350', 10);
const MIN_CANDLES = 100;

let running = false;
let symbolCache = { ts: 0, list: [] };

function sma(arr, n) {
  if (!arr || arr.length < n) return null;
  return arr.slice(-n).reduce((a, b) => a + b, 0) / n;
}
function emaFromArray(arr, n) {
  if (!arr || arr.length < n) return null;
  const k = 2 / (n + 1);
  let ema = arr.slice(0, n).reduce((a, b) => a + b, 0) / n;
  for (let i = n; i < arr.length; i++) ema = arr[i] * k + ema * (1 - k);
  return ema;
}
function rsiFromCloses(closes, period = 14) {
  if (!closes || closes.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gains += d; else losses += Math.abs(d);
  }
  if (losses === 0) return 100;
  const rs = (gains / period) / (losses / period);
  return 100 - (100 / (1 + rs));
}
function atrFromOHLC(arr, period = 14) {
  if (!arr || arr.length < period + 1) return null;
  const trs = [];
  for (let i = 1; i < arr.length; i++) {
    const high = arr[i].high, low = arr[i].low, prev = arr[i - 1].close;
    trs.push(Math.max(high - low, Math.abs(high - prev), Math.abs(low - prev)));
  }
  const slice = trs.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

async function fetchFuturesSymbolsCached() {
  if (symbolCache.list.length && (Date.now() - symbolCache.ts) < 60_000) return symbolCache.list;
  let list = [];
  const tryUrls = [
    'https://api.bitget.com/api/mix/v1/market/tickers',
    'https://api.bitget.com/api/spot/v1/market/tickers'
  ];
  for (const url of tryUrls) {
    try {
      const r = await fetch(url);
      const j = await r.json();
      if (j && j.data && Array.isArray(j.data) && j.data.length) {
        list = j.data.map(x => x.symbol).filter(s => s && s.toUpperCase().endsWith('USDT')).slice(0, SYMBOL_FETCH_LIMIT);
        break;
      }
    } catch (e) { /* continue */ }
  }
  if (!list.length) list = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT'];
  symbolCache = { ts: Date.now(), list };
  return list;
}

async function fetchCandles(symbol, limit = 300) {
  const tryUrls = [
    `https://api.bitget.com/api/mix/v1/market/candles?symbol=${symbol}&granularity=${TF_MINUTES * 60}&limit=${limit}`,
    `https://api.bitget.com/api/spot/v1/market/candles?symbol=${symbol}&limit=${limit}`,
    `https://api.bitget.com/api/spot/v1/market/candles?symbol=${symbol}&bar=${TF_MINUTES}m&limit=${limit}`
  ];
  for (const url of tryUrls) {
    try {
      const res = await fetch(url, { timeout: 15000 });
      const txt = await res.text();
      const j = JSON.parse(txt);
      if (!j) continue;
      let rows = j.data || j || [];
      if (!Array.isArray(rows) || !rows.length) continue;
      const parsed = rows.map(item => {
        if (Array.isArray(item)) return { time: item[0], open: parseFloat(item[1]), high: parseFloat(item[2]), low: parseFloat(item[3]), close: parseFloat(item[4]), vol: parseFloat(item[5]) };
        const o = parseFloat(item.o ?? item.open ?? item[1]);
        const h = parseFloat(item.h ?? item.high ?? item[2]);
        const l = parseFloat(item.l ?? item.low ?? item[3]);
        const c = parseFloat(item.c ?? item.close ?? item[4]);
        const v = parseFloat(item.v ?? item.volume ?? item[5] ?? 0);
        return { time: item.t ?? item.time ?? item[0], open: o, high: h, low: l, close: c, vol: v };
      }).filter(Boolean);
      if (parsed.length >= MIN_CANDLES) return parsed;
    } catch (e) { /* try next */ }
  }
  return null;
}

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
    console.error('analyzeSymbol err:', e.message || e);
    return null;
  }
}

async function postCandidate(candidate) {
  try {
    await fetch(`${LOCAL}/signal-candidate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(candidate)
    });
    console.log(`[POST] ${candidate.symbol} ${candidate.side}`);
  } catch (e) {
    console.error('postCandidate err:', e.message || e);
  }
}

let loopHandle = null;

async function startScanner() {
  if (running) return;
  running = true;
  console.log('Scanner started — TF:', TF_MINUTES, 'min');
  loopHandle = (async function loop() {
    while (running) {
      try {
        const symbols = await fetchFuturesSymbolsCached();
        for (const sym of symbols.slice(0, SYMBOL_FETCH_LIMIT)) {
          try {
            const cand = await analyzeSymbol(sym);
            if (cand && cand.confirmations && cand.confirmations.length >= CONF_REQ) {
              await postCandidate(cand);
            }
          } catch (inner) { /* ignore per-symbol errors */ }
          await new Promise(r => setTimeout(r, PER_SYMBOL_DELAY_MS));
        }
      } catch (e) {
        console.error('scanLoop error:', e.message || e);
      }
      await new Promise(r => setTimeout(r, SCAN_INTERVAL_MS));
    }
  })();
}

async function stopScanner() {
  running = false;
  console.log('Scanner stopping...');
}

function isRunning() { return running; }

module.exports = { startScanner, stopScanner, isRunning };