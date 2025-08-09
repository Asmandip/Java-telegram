// monitor.js
require('dotenv').config();
const Position = require('./models/Position');
const { closePosition } = require('./utils/trade');
const fetch = (...args) => import('node-fetch').then(m=>m.default(...args));
const POLL = parseInt(process.env.POSITION_POLL_INTERVAL_MS || '5000', 10);
const TRAIL_TRIGGER_PCT = parseFloat(process.env.TRAIL_TRIGGER_PCT || '0.5'); // 50% of TP
const TRAIL_STEP_PCT = parseFloat(process.env.TRAIL_STEP_PCT || '0.5'); // 0.5 * ATR or percent

async function getMarkPrice(symbol) {
  try {
    // Try Bitget market price endpoint (public)
    const r = await fetch(`https://api.bitget.com/api/market/v1/market/ticker?symbol=${symbol}`);
    const j = await r.json();
    // endpoint format may vary — fallback to Coinbase/other is possible
    if (j && j.data && j.data.last) return parseFloat(j.data.last);
    if (j && j.ticker && j.ticker.last) return parseFloat(j.ticker.last);
    // fallback to last price from other endpoints
  } catch (e) {}
  return null;
}

async function monitorLoop() {
  console.log('Position monitor started — poll:', POLL, 'ms');
  while (true) {
    try {
      const openPositions = await Position.find({ status: 'open' });
      for (const pos of openPositions) {
        const symbol = pos.symbol;
        const mark = await getMarkPrice(symbol);
        if (!mark) continue;
        // check SL/TP
        if (pos.side === 'BUY') {
          if (mark <= pos.sl) {
            console.log('SL hit for', pos._id, pos.symbol, mark);
            await closePosition(pos._id, mark, 'SL');
            continue;
          }
          if (mark >= pos.tp) {
            console.log('TP hit for', pos._id, pos.symbol, mark);
            await closePosition(pos._id, mark, 'TP');
            continue;
          }
          // trailing logic: if price > entry + trigger then move SL up
          const profitFromEntry = (mark - pos.entry)/pos.entry; // fractional
          const tpDistance = (pos.tp - pos.entry)/pos.entry;
          if (tpDistance > 0 && profitFromEntry >= (TRAIL_TRIGGER_PCT * tpDistance)) {
            // set new SL closer to mark (e.g., entry or mark - small percent)
            const newSl = pos.entry; // simple: move to break-even
            if (pos.sl < newSl) {
              pos.sl = newSl;
              await pos.save();
              console.log('Moved SL to breakeven for', pos._id, pos.symbol);
            }
            // optionally, implement incremental trailing steps here
          }
        } else {
          // SELL side
          if (mark >= pos.sl) {
            console.log('SL hit (SELL) for', pos._id, pos.symbol, mark);
            await closePosition(pos._id, mark, 'SL');
            continue;
          }
          if (mark <= pos.tp) {
            console.log('TP hit (SELL) for', pos._id, pos.symbol, mark);
            await closePosition(pos._id, mark, 'TP');
            continue;
          }
          const profitFromEntry = (pos.entry - mark)/pos.entry;
          const tpDistance = (pos.entry - pos.tp)/pos.entry;
          if (tpDistance > 0 && profitFromEntry >= (TRAIL_TRIGGER_PCT * tpDistance)) {
            const newSl = pos.entry; // move to breakeven
            if ((pos.side==='SELL' && pos.sl > newSl) || (pos.side==='BUY' && pos.sl < newSl)) {
              pos.sl = newSl;
              await pos.save();
              console.log('Moved SL to breakeven (SELL) for', pos._id, pos.symbol);
            }
          }
        }
      }
    } catch (e) {
      console.error('monitor loop error', e);
    }
    await new Promise(r=>setTimeout(r, POLL));
  }
}

module.exports = { monitorLoop };
