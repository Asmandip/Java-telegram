exports.name = 'mean_revert_v1';
exports.info = { author:'asman', desc:'Mean reversion vs 20-SMA' };
function sma(arr,n){ if(!arr||arr.length<n) return null; return arr.slice(-n).reduce((a,b)=>a+b,0)/n; }
exports.evaluate = async function(symbol, candles, settings={}) {
  if (!candles || candles.length < 60) return null;
  const closes = candles.map(c=>c.close);
  const last = closes[closes.length-1];
  const ma20 = sma(closes, 20);
  if (ma20 === null) return null;
  const dev = (last - ma20) / ma20;
  const threshold = settings.meanThresholdPct || 0.006;
  if (dev < -threshold) return { symbol, side:'BUY', price:last, reason:'below_ma', score: Math.abs(dev), time:new Date().toISOString(), strategy:exports.name };
  if (dev > threshold) return { symbol, side:'SELL', price:last, reason:'above_ma', score: Math.abs(dev), time:new Date().toISOString(), strategy:exports.name };
  return null;
};