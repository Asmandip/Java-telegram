// monitor.js
require('dotenv').config();
const fetch = (...args) => import('node-fetch').then(m=>m.default(...args));
const Position = require('./models/Position');
const { closePosition } = require('./utils/trade');

const POLL = parseInt(process.env.POSITION_POLL_INTERVAL_MS || '5000', 10);
const TRAIL_TRIGGER_PCT = parseFloat(process.env.TRAIL_TRIGGER_PCT || '0.5'); // 50% of TP distance

async function getMarkPrice(symbol) {
  const tryUrls = [
    `https://api.bitget.com/api/spot/v1/market/ticker?symbol=${symbol}`,
    `https://api.bitget.com/api/mix/v1/market/ticker?symbol=${symbol}`,
    `https://api.bitget.com/api/market/v1/market/ticker?symbol=${symbol}`
  ];
  for (const url of tryUrls) {
    try {
      const r = await fetch(url, { timeout: 10000 });
      const j = await r.json();
      if (j?.data?.last) return parseFloat(j.data.last);
      if (j?.ticker?.last) return parseFloat(j.ticker.last);
      if (Array.isArray(j?.data) && j.data[0]?.last) return parseFloat(j.data[0].last);
    } catch (e) { /* try next */ }
  }
  return null;
}

async function monitorLoop() {
  console.log('Position monitor started — poll', POLL, 'ms');
  while (true) {
    try {
      const openPos = await Position.find({ status: 'open' });
      for (const pos of openPos) {
        try {
          const mark = await getMarkPrice(pos.symbol);
          if (!mark) continue;
          if (pos.side === 'BUY') {
            if (mark <= pos.sl) {
              console.log('SL hit (BUY) for', pos.symbol, mark);
              await closePosition(pos._id, mark, 'SL');
              continue;
            }
            if (mark >= pos.tp) {
              console.log('TP hit (BUY) for', pos.symbol, mark);
              await closePosition(pos._id, mark, 'TP');
              continue;
            }
            const profitFromEntry = (mark - pos.entry) / pos.entry;
            const tpDistance = (pos.tp - pos.entry) / pos.entry;
            if (tpDistance > 0 && profitFromEntry >= (TRAIL_TRIGGER_PCT * tpDistance)) {
              const newSl = pos.entry;
              if (pos.sl < newSl) { pos.sl = newSl; await pos.save(); console.log('Moved SL to breakeven:', pos._id); }
            }
          } else {
            if (mark >= pos.sl) {
              console.log('SL hit (SELL) for', pos.symbol, mark);
              await closePosition(pos._id, mark, 'SL');
              continue;
            }
            if (mark <= pos.tp) {
              console.log('TP hit (SELL) for', pos.symbol, mark);
              await closePosition(pos._id, mark, 'TP');
              continue;
            }
            const profitFromEntry = (pos.entry - mark) / pos.entry;
            const tpDistance = (pos.entry - pos.tp) / pos.entry;
            if (tpDistance > 0 && profitFromEntry >= (TRAIL_TRIGGER_PCT * tpDistance)) {
              const newSl = pos.entry;
              if (pos.sl > newSl) { pos.sl = newSl; await pos.save(); console.log('Moved SL to breakeven (SELL):', pos._id); }
            }
          }
        } catch (inner) { console.error('monitor inner err:', inner); }
      }
    } catch (e) {
      console.error('monitorLoop error:', e);
    }
    await new Promise(r => setTimeout(r, POLL));
  }
}

module.exports = { monitorLoop };