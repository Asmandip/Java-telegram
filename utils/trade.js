// utils/trade.js
const fetch = (...args) => import('node-fetch').then(m=>m.default(...args));
const Position = require('../models/Position');
const Signal = require('../models/Signal');
const { PAPER_MODE, LEVERAGE, SL_PERCENT, RR } = require('../config'); // if config CommonJS

// helper to compute TP/SL
function computeTargets(price, side) {
  const slAmount = price * (SL_PERCENT/100);
  const tpDistance = slAmount * RR;
  if (side === 'BUY') {
    return { sl: price - slAmount, tp: price + tpDistance };
  } else {
    return { sl: price + slAmount, tp: price - tpDistance };
  }
}

// Simulated order placement (paper-mode)
async function placeSimulatedOrder(signalDoc, accountUsd = 1000) {
  const sizeUsd = accountUsd * 0.01; // 1% risk -> size fixed; you may change
  const { sl, tp } = computeTargets(signalDoc.price, signalDoc.side);
  const position = await Position.create({
    signalId: signalDoc._id,
    symbol: signalDoc.symbol || signalDoc.pair || signalDoc.symbol,
    side: signalDoc.side || signalDoc.type,
    entry: signalDoc.price,
    sizeUsd,
    leverage: LEVERAGE,
    sl, tp,
    status: 'open',
    execMeta: { mode: 'paper' }
  });
  // update signal status
  await Signal.findByIdAndUpdate(signalDoc._id, { status: 'executed', executedAt: new Date(), execResult: position });
  return position;
}

// Placeholder live order (to be implemented with signing)
async function placeLiveOrder(signalDoc, accountUsd = 1000) {
  // TODO: implement Bitget signed REST call here.
  // For now, throw error or return placeholder
  throw new Error('Live order not implemented. Provide keys and request live module.');
}

// Public openPosition
async function openPosition(signalDoc, accountUsd = 1000) {
  if (PAPER_MODE) {
    return await placeSimulatedOrder(signalDoc, accountUsd);
  } else {
    return await placeLiveOrder(signalDoc, accountUsd);
  }
}

// Close a position (simulated close or live cancel/close)
async function closePosition(posId, closePrice, reason = 'manual/target') {
  const pos = await Position.findById(posId);
  if (!pos || pos.status === 'closed') return pos;
  // compute pnl (simplified): for futures USD per side (approx)
  const direction = pos.side === 'BUY' ? 1 : -1;
  // assumed notional: sizeUsd * leverage -> approximate position size in USD
  const notional = pos.sizeUsd * pos.leverage;
  // price move fraction
  const move = (closePrice - pos.entry) / pos.entry;
  const pnlUsd = move * notional * direction;

  pos.status = 'closed';
  pos.closedAt = new Date();
  pos.closePrice = closePrice;
  pos.pnlUsd = pnlUsd;
  pos.execMeta = pos.execMeta || {};
  pos.execMeta.closeReason = reason;
  await pos.save();

  // update Signal or PnL collections as needed
  return pos;
}

module.exports = { openPosition, closePosition, computeTargets };