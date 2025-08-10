// utils/backtestEngine.js
const { computeTargets } = require('./trade'); // reuse computeTargets (sl/tp calc)
const PositionModel = require('../models/Position'); // not used to persist; trades kept in result

/**
 * runBacktest(options)
 * options: { symbol, timeframe, candles (array), strategyModule, params, initialCapital }
 * returns: { summary, trades, equitySeries, logs }
 */
async function runBacktest(opts = {}) {
  const { candles = [], strategyModule, params = {}, initialCapital = 1000 } = opts;
  const logs = [];
  const trades = [];
  const equitySeries = [];
  let cash = initialCapital;
  let eq = initialCapital;
  let position = null; // { side, entryPrice, sizeUsd, entryIndex, sl, tp }

  function log(s) { logs.push(`${new Date().toISOString()} ${s}`); }

  // warmup start index (allow strategy to use history)
  const warmup = 30;
  for (let i = warmup; i < candles.length - 1; i++) {
    const slice = candles.slice(0, i + 1); // include current candle
    let signal = null;
    try {
      if (strategyModule && typeof strategyModule.evaluate === 'function') {
        signal = await strategyModule.evaluate(opts.symbol, slice, params);
      }
    } catch (e) {
      log(`strategy error at index ${i}: ${e.message}`);
    }

    // if no open position and strategy returns a side -> open at next candle open
    if (!position && signal && signal.side) {
      const nextBar = candles[i + 1];
      if (!nextBar) continue;
      const entryPrice = nextBar.open || nextBar.close;
      const sizeUsd = Math.max(1, initialCapital * 0.01); // 1% default
      const t = computeTargets(entryPrice, signal.side);
      position = {
        side: signal.side,
        entryPrice,
        entryIndex: i + 1,
        sl: t.sl,
        tp: t.tp,
        sizeUsd,
        meta: { strategy: signal.strategy || opts.strategy }
      };
      log(`OPEN ${signal.side} @ ${entryPrice} idx ${i + 1}`);
      continue;
    }

    // if position open, check exit conditions on current candle (i)
    if (position) {
      const c = candles[i];
      // check SL/TP hit intra-bar (high/low)
      let exitPrice = null;
      let reason = null;
      if (position.side === 'BUY') {
        if (c.low <= position.sl) { exitPrice = position.sl; reason = 'SL'; }
        else if (c.high >= position.tp) { exitPrice = position.tp; reason = 'TP'; }
      } else {
        if (c.high >= position.sl) { exitPrice = position.sl; reason = 'SL'; }
        else if (c.low <= position.tp) { exitPrice = position.tp; reason = 'TP'; }
      }
      // also optional strategy-based exit: if strategy returns opposite side or null? (simple)
      if (!exitPrice && signal && signal.side && signal.side !== position.side) {
        // exit at next open
        const nextBar = candles[i + 1];
        if (nextBar) { exitPrice = nextBar.open; reason = 'rev_signal'; }
      }

      if (exitPrice !== null) {
        // compute pnl: direction aware
        const dir = position.side === 'BUY' ? 1 : -1;
        const notional = position.sizeUsd; // simplified
        const move = (exitPrice - position.entryPrice) / position.entryPrice;
        const pnlUsd = +(move * notional * dir).toFixed(6);
        trades.push({
          entryIndex: position.entryIndex, entryTime: new Date(candles[position.entryIndex].time), entryPrice: position.entryPrice,
          exitIndex: i, exitTime: new Date(c.time), exitPrice, side: position.side,
          sizeUsd: position.sizeUsd, pnlUsd, meta: position.meta, reason
        });
        cash += pnlUsd;
        eq = cash;
        equitySeries.push({ t: new Date(c.time), equity: eq });
        log(`CLOSE ${position.side} @ ${exitPrice} idx ${i} reason:${reason} pnl:${pnlUsd}`);
        position = null;
      }
    }

    // push equity snapshot every N bars
    if ((i % 20) === 0) {
      const t = new Date(candles[i].time);
      equitySeries.push({ t, equity: eq });
    }
  }

  // if still position open at the end -> close at last close
  if (position) {
    const last = candles[candles.length - 1];
    const exitPrice = last.close;
    const dir = position.side === 'BUY' ? 1 : -1;
    const move = (exitPrice - position.entryPrice) / position.entryPrice;
    const pnlUsd = +(move * position.sizeUsd * dir).toFixed(6);
    trades.push({
      entryIndex: position.entryIndex, entryTime: new Date(candles[position.entryIndex].time), entryPrice: position.entryPrice,
      exitIndex: candles.length - 1, exitTime: new Date(last.time), exitPrice, side: position.side,
      sizeUsd: position.sizeUsd, pnlUsd, meta: position.meta, reason: 'end_close'
    });
    cash += pnlUsd;
    eq = cash;
    equitySeries.push({ t: new Date(last.time), equity: eq });
    log(`CLOSE (EOD) ${position.side} @ ${exitPrice} pnl:${pnlUsd}`);
    position = null;
  }

  // compute summary metrics
  const totalPnl = eq - initialCapital;
  const wins = trades.filter(t=>t.pnlUsd>0).length;
  const losses = trades.filter(t=>t.pnlUsd<=0).length;
  const winrate = trades.length ? (wins / trades.length) : 0;
  const maxDrawdown = computeMaxDrawdown(equitySeries, initialCapital);

  const summary = {
    initialCapital,
    finalEquity: eq,
    totalPnl,
    tradesCount: trades.length,
    wins,
    losses,
    winrate,
    maxDrawdown
  };

  return { summary, trades, equitySeries, logs };
}

function computeMaxDrawdown(equitySeries = [], startVal = 1000) {
  if (!equitySeries.length) return 0;
  let peak = startVal;
  let maxDd = 0;
  for (const p of equitySeries) {
    if (p.equity > peak) peak = p.equity;
    const dd = (peak - p.equity) / peak;
    if (dd > maxDd) maxDd = dd;
  }
  return maxDd;
}

module.exports = { runBacktest };