// scanner.js
require('dotenv').config();
const fetch = (...args) => import('node-fetch').then(m=>m.default(...args));
const Settings = require('./models/Settings');
const strategyRegistry = require('./strategies/registry');

const TF_MINUTES = parseInt(process.env.TF_MINUTES || '3');
const SCAN_INTERVAL_MS = parseInt(process.env.SCAN_INTERVAL_MS || '60000');
const SYMBOL_FETCH_LIMIT = parseInt(process.env.SYMBOL_FETCH_LIMIT || '50');
const PER_SYMBOL_DELAY_MS = parseInt(process.env.PER_SYMBOL_DELAY_MS || '350');
const MIN_CANDLES = 80;

let running = false;

function sma(arr,n){ if(!arr||arr.length<n) return null; return arr.slice(-n).reduce((a,b)=>a+b,0)/n; }

async function fetchFuturesSymbolsCached() {
  if (!fetchFuturesSymbolsCached.cache || (Date.now() - fetchFuturesSymbolsCached.cache.ts) > 60000) {
    let list = [];
    try {
      const r = await fetch('https://api.bitget.com/api/mix/v1/market/tickers');
      const j = await r.json();
      if (j && Array.isArray(j.data)) {
        list = j.data.map(x=>x.symbol).filter(s=>s && s.endsWith('USDT')).slice(0,SYMBOL_FETCH_LIMIT);
      }
    } catch(e){}
    if (!list.length) list = ['BTCUSDT','ETHUSDT','BNBUSDT'];
    fetchFuturesSymbolsCached.cache = { ts: Date.now(), list };
  }
  return fetchFuturesSymbolsCached.cache.list;
}

async function fetchCandles(symbol, limit=300) {
  const urls = [
    `https://api.bitget.com/api/mix/v1/market/candles?symbol=${symbol}&granularity=${TF_MINUTES*60}&limit=${limit}`,
    `https://api.bitget.com/api/spot/v1/market/candles?symbol=${symbol}&limit=${limit}`,
    `https://api.bitget.com/api/spot/v1/market/candles?symbol=${symbol}&bar=${TF_MINUTES}m&limit=${limit}`
  ];
  for (const url of urls) {
    try {
      const r = await fetch(url, { timeout:15000 });
      const txt = await r.text();
      const j = JSON.parse(txt);
      let rows = j.data || j || [];
      if (!Array.isArray(rows) || !rows.length) continue;
      const parsed = rows.map(item => {
        if (Array.isArray(item)) return { time:item[0], open: parseFloat(item[1]), high: parseFloat(item[2]), low: parseFloat(item[3]), close: parseFloat(item[4]), vol: parseFloat(item[5]||0) };
        const o = parseFloat(item.o ?? item.open ?? item[1]);
        const h = parseFloat(item.h ?? item.high ?? item[2]);
        const l = parseFloat(item.l ?? item.low ?? item[3]);
        const c = parseFloat(item.c ?? item.close ?? item[4]);
        const v = parseFloat(item.v ?? item.volume ?? 0);
        return { time: item.t ?? item.time ?? 0, open:o, high:h, low:l, close:c, vol:v };
      }).filter(Boolean);
      if (parsed.length >= MIN_CANDLES) return parsed;
    } catch (e) { /* try next */ }
  }
  return null;
}

async function getActiveStrategyModule() {
  try {
    const s = await Settings.findOne();
    const name = s?.activeStrategy || strategyRegistry.getActive();
    if (!name) return null;
    return strategyRegistry.getModule(name);
  } catch (e) {
    return strategyRegistry.getModule(strategyRegistry.getActive());
  }
}

async function postCandidate(candidate) {
  try {
    // server endpoint is /signal-candidate on same server
    const url = (process.env.RENDER_EXTERNAL_URL || 'http://localhost:10000') + '/signal-candidate';
    await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(candidate) });
    console.log('Posted candidate', candidate.symbol, candidate.side);
  } catch (e) { console.error('postCandidate err', e); }
}

async function scanOnce() {
  const symbols = await fetchFuturesSymbolsCached();
  const toScan = symbols.slice(0, SYMBOL_FETCH_LIMIT);
  const strategy = await getActiveStrategyModule();
  const settings = await Settings.findOne() || {};
  for (const sym of toScan) {
    try {
      const candles = await fetchCandles(sym, 300);
      if (!candles) continue;
      if (strategy && typeof strategy.evaluate === 'function') {
        const cand = await strategy.evaluate(sym, candles, settings);
        if (cand && cand.side) {
          await postCandidate({
            symbol: cand.symbol || sym,
            side: cand.side,
            price: cand.price || candles[candles.length-1].close,
            confirmations: cand.confirmations || [],
            indicators: cand,
            time: cand.time || new Date().toISOString()
          });
        }
      }
    } catch (e) { console.error('scan symbol err', sym, e); }
    await new Promise(r => setTimeout(r, PER_SYMBOL_DELAY_MS));
  }
}

// loop
async function startScanner() {
  if (running) return;
  running = true;
  console.log('Scanner started');
  (async function loop() {
    while (running) {
      try {
        await scanOnce();
      } catch (e) { console.error('scanner loop err', e); }
      await new Promise(r => setTimeout(r, SCAN_INTERVAL_MS));
    }
  })();
}
async function stopScanner() { running = false; console.log('Scanner stopped'); }
function isRunning() { return running; }

module.exports = { startScanner, stopScanner, isRunning };