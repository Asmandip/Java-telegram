exports.name = 'scalping_v1';
exports.info = { author: 'asman', desc: 'RSI+EMA+volume scalping (3m)' };

function sma(arr,n){ if(!arr||arr.length<n) return null; return arr.slice(-n).reduce((a,b)=>a+b,0)/n; }
function ema(arr,n){ if(!arr||arr.length<n) return null; const k=2/(n+1); let e=arr.slice(0,n).reduce((a,b)=>a+b,0)/n; for(let i=n;i<arr.length;i++) e = arr[i]*k + e*(1-k); return e; }
function rsi(closes,period=14){ if(!closes||closes.length<period+1) return null; let g=0,l=0; for(let i=closes.length-period;i<closes.length;i++){ const d=closes[i]-closes[i-1]; if(d>0) g+=d; else l+=Math.abs(d); } if(l===0) return 100; const rs=(g/period)/(l/period); return 100 - (100/(1+rs)); }

exports.evaluate = async function(symbol, candles, settings={}) {
  if (!candles || candles.length < 60) return null;
  const closes = candles.map(c=>c.close);
  const vols = candles.map(c=>c.vol||0);
  const last = candles[candles.length-1];
  const prev = candles[candles.length-2];

  const r = rsi(closes,14);
  const e9 = ema(closes,9);
  const e21 = ema(closes,21);
  const avgVol = sma(vols,20);
  const volNow = vols[vols.length-1] || 0;
  const confs = [];

  if (r !== null) { if (r < 35) confs.push('RSI_BUY'); if (r > 65) confs.push('RSI_SELL'); }
  if (e9 !== null && e21 !== null) { if (e9 > e21) confs.push('EMA_BULL'); else confs.push('EMA_BEAR'); }
  if (avgVol !== null && volNow > avgVol * 1.2) confs.push('VOL_SPIKE');
  if (Math.abs(last.close - prev.close) > (0.5 * (avgVol || 1))) confs.push('MOVE');

  let side = null;
  if (confs.includes('RSI_BUY') && confs.includes('EMA_BULL')) side = 'BUY';
  if (confs.includes('RSI_SELL') && confs.includes('EMA_BEAR')) side = 'SELL';
  if (!side && confs.length >= (settings.confirmationsRequired || 3)) side = (e9 > e21) ? 'BUY' : 'SELL';
  if (!side) return null;

  return { symbol, side, price: last.close, confirmations: confs, score: confs.length, time: new Date().toISOString(), strategy: exports.name };
};