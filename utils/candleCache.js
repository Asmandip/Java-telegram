// utils/candleCache.js
const fs = require('fs');
const path = require('path');
const fetch = (...args) => import('node-fetch').then(m=>m.default(...args));

const DATA_DIR = path.join(process.cwd(), 'data', 'candles');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function cachePath(symbol, timeframe, from, to) {
  const name = `${symbol}_${timeframe}_${from || '0'}_${to || '0'}.json`;
  return path.join(DATA_DIR, name);
}

async function fetchCandlesFromBitget(symbol, timeframeMinutes=3, limit=1000) {
  // Simple public endpoint pull (may require pagination by time window)
  const url = `https://api.bitget.com/api/spot/v1/market/candles?symbol=${symbol}&bar=${timeframeMinutes}m&limit=${limit}`;
  const res = await fetch(url, { timeout: 20000 });
  const txt = await res.text();
  const j = JSON.parse(txt);
  let rows = j.data||j||[];
  // normalize
  const parsed = rows.map(item => {
    if (Array.isArray(item)) return { time: item[0], open: +item[1], high:+item[2], low:+item[3], close:+item[4], vol:+(item[5]||0) };
    return { time: item.t || item.time, open:+(item.o||item.open||0), high:+(item.h||item.high||0), low:+(item.l||item.low||0), close:+(item.c||item.close||0), vol:+(item.v||item.volume||0) };
  }).reverse(); // ensure chronological
  return parsed;
}

async function loadCandles(symbol, timeframeMinutes=3, opts={force:false, from:null,to:null}) {
  const file = cachePath(symbol, timeframeMinutes, opts.from?Date.parse(opts.from):0, opts.to?Date.parse(opts.to):0);
  if (!opts.force && fs.existsSync(file)) {
    try { return JSON.parse(fs.readFileSync(file,'utf8')); } catch(e){}
  }
  const candles = await fetchCandlesFromBitget(symbol, timeframeMinutes, 1000);
  fs.writeFileSync(file, JSON.stringify(candles), 'utf8');
  return candles;
}

module.exports = { loadCandles, fetchCandlesFromBitget };
