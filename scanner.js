// scanner.js
const fetch = (...args) => import('node-fetch').then(m => m.default(...args));
const qs = require('querystring');
const LOCAL = process.env.LOCAL_SERVER || 'http://localhost:10000';
const TF_MINUTES = parseInt(process.env.TF_MINUTES || '3');
const SCAN_INTERVAL_MS = parseInt(process.env.SCAN_INTERVAL_MS || '30000'); // 30s
const CONF_REQ = parseInt(process.env.CONFIRMATIONS_REQUIRED || '3');

// helper indicators
function sma(arr, n){ if(arr.length<n) return null; return arr.slice(-n).reduce((a,b)=>a+b,0)/n; }
function emaFromArray(arr, n){
  if(arr.length < n) return null;
  let k = 2/(n+1);
  let ema = arr.slice(0,n).reduce((a,b)=>a+b,0)/n;
  for(let i=n;i<arr.length;i++) ema = arr[i]*k + ema*(1-k);
  return ema;
}
function rsiFromCloses(closes, period=14){
  if(closes.length < period+1) return null;
  let gains=0, losses=0;
  for(let i=closes.length-period;i<closes.length;i++){
    const d = closes[i] - closes[i-1];
    if(d>0) gains += d; else losses += Math.abs(d);
  }
  if(losses===0) return 100;
  const rs = (gains/period)/(losses/period);
  return 100 - (100/(1+rs));
}
function atrFromOHLC(arr, period=14){
  if(arr.length < period+1) return null;
  const trs = [];
  for(let i=1;i<arr.length;i++){
    const high = arr[i].high, low = arr[i].low, prevClose = arr[i-1].close;
    const tr = Math.max(high-low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    trs.push(tr);
  }
  // simple SMA of TRs
  if(trs.length < period) return null;
  const slice = trs.slice(-period);
  return slice.reduce((a,b)=>a+b,0)/period;
}

// Fetch list of futures symbols (basic public tickers)
async function fetchFuturesSymbols(){
  try{
    const res = await fetch('https://api.bitget.com/api/spot/v1/market/tickers'); // fallback
    const j = await res.json();
    // j.data is array with symbol fields; filter USDT margin ones
    const symbols = (j.data || []).map(x=>x.symbol).filter(s=>s.toUpperCase().endsWith('USDT'));
    // return top N
    return symbols.slice(0, 50);
  }catch(e){
    console.error('fetchSymbols err', e.message);
    return ['BTCUSDT','ETHUSDT'];
  }
}

// Fetch candles for symbol - endpoint may vary; adjust if needed
async function fetchCandles(symbol, limit=200){
  try{
    const res = await fetch(`https://api.bitget.com/api/spot/v1/market/candles?symbol=${symbol}&limit=${limit}&bar=${TF_MINUTES}m`);
    const txt = await res.text();
    const j = JSON.parse(txt);
    // data format may be array of arrays; normalize to objects
    const data = (j.data || j || []).map(item => {
      // If item is object with keys o,h,l,c,v,t
      if(item.o !== undefined) return {
        open: parseFloat(item.o), high: parseFloat(item.h), low: parseFloat(item.l), close: parseFloat(item.c), vol: parseFloat(item.v), time: item.t || item[0]
      };
      // if array
      return { time: item[0], open: parseFloat(item[1]), high: parseFloat(item[2]), low: parseFloat(item[3]), close: parseFloat(item[4]), vol: parseFloat(item[5]) };
    });
    return data;
  }catch(e){
    console.error('fetchCandles err', e.message);
    return null;
  }
}

async function analyzeAndPost(symbol){
  const candles = await fetchCandles(symbol, 200);
  if(!candles || candles.length < 50) return;
  const closes = candles.map(c=>c.close);
  const highs = candles.map(c=>c.high);
  const lows = candles.map(c=>c.low);
  const vols = candles.map(c=>c.vol);

  const rsi = rsiFromCloses(closes, 14);
  const ema9 = emaFromArray(closes, 9);
  const ema21 = emaFromArray(closes, 21);
  const atr = atrFromOHLC(candles, 14);
  const avgVol = sma(vols, 20);
  const lastClose = closes[closes.length-1];

  // conditions
  const conds = [];
  if(rsi !== null && rsi < 35) conds.push('RSI_BUY');
  if(rsi !== null && rsi > 65) conds.push('RSI_SELL');
  if(ema9 !== null && ema21 !== null && ema9 > ema21) conds.push('EMA_BULL');
  if(ema9 !== null && ema21 !== null && ema9 < ema21) conds.push('EMA_BEAR');
  if(avgVol !== null && vols[vols.length-1] > avgVol*1.2) conds.push('VOL_SPIKE');

  // decide buy/sell candidate
  let side = null;
  if(conds.includes('RSI_BUY') && conds.includes('EMA_BULL')) side = 'BUY';
  if(conds.includes('RSI_SELL') && conds.includes('EMA_BEAR')) side = 'SELL';
  // also accept if 3 confirmations present (any)
  if(side === null && conds.length >= CONF_REQ) {
    // pick side by EMA direction
    side = ema9 > ema21 ? 'BUY' : 'SELL';
  }

  if(side){
    const candidate = {
      symbol,
      side,
      price: lastClose,
      rsi: rsi || 0,
      ema9: ema9 || 0,
      ema21: ema21 || 0,
      atr: atr || 0,
      vol: vols[vols.length-1],
      confirmations: conds,
      time: new Date().toISOString()
    };
    // post to local server
    try{
      await fetch(`${LOCAL}/signal-candidate`, {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify(candidate)
      });
      console.log('Candidate sent', symbol, side, 'conds', conds.length);
    }catch(e){
      console.error('post candidate err', e.message);
    }
  }
}

async function startScanner(){
  console.log('Scanner starting...');
  const symbols = await fetchFuturesSymbols();
  while(true){
    for(const s of symbols){
      try{ await analyzeAndPost(s); } catch(e){ console.error('analyze error', s, e.message); }
      // small sleep to avoid rate limits
      await new Promise(r=>setTimeout(r, 400));
    }
    await new Promise(r=>setTimeout(r, SCAN_INTERVAL_MS));
  }
}

startScanner();
