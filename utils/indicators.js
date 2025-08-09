// utils/indicators.js
function sma(arr, n) {
  if (!arr || arr.length < n) return null;
  const slice = arr.slice(-n);
  return slice.reduce((a,b)=>a+b,0)/n;
}

function emaFromArray(arr, n) {
  if (!arr || arr.length < n) return null;
  const k = 2/(n+1);
  let ema = arr.slice(0,n).reduce((a,b)=>a+b,0)/n;
  for (let i=n;i<arr.length;i++){
    ema = arr[i]*k + ema*(1-k);
  }
  return ema;
}

function rsiFromCloses(closes, period=14) {
  if (!closes || closes.length < period+1) return null;
  let gains=0, losses=0;
  for (let i=closes.length-period;i<closes.length;i++){
    const d = closes[i] - closes[i-1];
    if (d>0) gains += d; else losses += Math.abs(d);
  }
  if (losses === 0) return 100;
  const rs = (gains/period)/(losses/period);
  return 100 - (100/(1+rs));
}

function atrFromOHLC(arr, period=14) {
  if (!arr || arr.length < period+1) return null;
  const trs = [];
  for (let i=1;i<arr.length;i++){
    const high = arr[i].high, low = arr[i].low, prev = arr[i-1].close;
    trs.push(Math.max(high-low, Math.abs(high-prev), Math.abs(low-prev)));
  }
  const slice = trs.slice(-period);
  return slice.reduce((a,b)=>a+b,0)/slice.length;
}

module.exports = { sma, emaFromArray, rsiFromCloses, atrFromOHLC };
