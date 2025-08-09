// monitor.js
require('dotenv').config();
const fetch = (...args) => import('node-fetch').then(m=>m.default(...args));
const Position = require('./models/Position');
const { closePosition } = (() => { try { return require('./utils/trade'); } catch(e){ return {}; } })();

const POLL = parseInt(process.env.POSITION_POLL_INTERVAL_MS || '5000', 10);
const TRAIL_TRIGGER_PCT = parseFloat(process.env.TRAIL_TRIGGER_PCT || '0.5'); // fraction of TP distance
const MIN_SLEEP = 500;

async function getMarkPrice(symbol) {
  // Try several public endpoints — Bitget naming may require symbol like BTCUSDT
  const tryUrls = [
    `https://api.bitget.com/api/spot/v1/market/ticker?symbol=${symbol}`,
    `https://api.bitget.com/api/mix/v1/market/ticker?symbol=${symbol}`,
    `https://api.bitget.com/api/market/v1/market/ticker?symbol=${symbol}`,
  ];
  for (const url of tryUrls) {
    try {
      const r = await fetch(url, { timeout: 10000 });
      const j = await r.json();
      // try various shapes
      if (j && j.data && j.data.last) return parseFloat(j.data.last);
      if (j && j.ticker && j.ticker.last) return parseFloat(j.ticker.last);
      if (j && j.data && j.data.length && Array.isArray(j.data) && j.data[0].last) return parseFloat(j.data[0].last);
    } catch (e) { /* try next */ }
  }
  return null;
}

async function monitorLoop() {
  console.log('Position monitor started — poll interval', POLL, 'ms');
  while (true) {
    try {
      const openPositions = await Position.find({ status: 'open' });
      for (const pos of openPositions) {
        try {
          const mark = await getMarkPrice(pos.symbol);
          if (!mark) {
            // skip if no price available
            continue;
          }

          // BUY logic
          if (pos.side === 'BUY') {
            // SL hit
            if (mark <= pos.sl) {
              console.log('SL hit (BUY) for', pos._id, pos.symbol, 'mark', mark);
              await closePosition(pos._id, mark, 'SL');
              continue;
            }
            // TP hit
            if (mark >= pos.tp) {
              console.log('TP hit (BUY) for', pos._id, pos.symbol, 'mark', mark);
              await closePosition(pos._id, mark, 'TP');
              continue;
            }
            // trailing: if profit progressed sufficiently, move SL to breakeven (or trail)
            const profitFromEntry = (mark - pos.entry) / pos.entry; // fraction
            const tpDistance = (pos.tp - pos.entry) / pos.entry;
            if (tpDistance > 0 && profitFromEntry >= (TRAIL_TRIGGER_PCT * tpDistance)) {
              const newSl = pos.entry; // breakeven as first step
              if (pos.sl < newSl) {
                pos.sl = newSl;
                await pos.save();
                console.log('Moved SL to breakeven (BUY) for', pos._id);
              }
            }
          } else { // SELL logic
            if (mark >= pos.sl) {
              console.log('SL hit (SELL) for', pos._id, pos.symbol, 'mark', mark);
              await closePosition(pos._id, mark, 'SL');
              continue;
            }
            if (mark <= pos.tp) {
              console.log('TP hit (SELL) for', pos._id, pos.symbol, 'mark', mark);
              await closePosition(pos._id, mark, 'TP');
              continue;
            }
            const profitFromEntry = (pos.entry - mark) / pos.entry;
            const tpDistance = (pos.entry - pos.tp) / pos.entry;
            if (tpDistance > 0 && profitFromEntry >= (TRAIL_TRIGGER_PCT * tpDistance)) {
              const newSl = pos.entry;
              // for SELL pos.sl should be greater than entry initially; adjust if needed
              if (pos.sl > newSl) {
                pos.sl = newSl;
                await pos.save();
                console.log('Moved SL to breakeven (SELL) for', pos._id);
              }
            }
          }
        } catch (innerErr) {
          console.error('monitor loop inner error for pos', pos._id, innerErr.message || innerErr);
        }
        // small sleep per position to avoid bursting
        await new Promise(r => setTimeout(r, MIN_SLEEP));
      }
    } catch (err) {
      console.error('monitor loop error', err.message || err);
    }
    await new Promise(r => setTimeout(r, POLL));
  }
}

module.exports = { monitorLoop };