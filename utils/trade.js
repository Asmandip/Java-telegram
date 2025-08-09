// utils/trade.js
require('dotenv').config();
const Position = require('../models/Position');
const Signal = require('../models/Signal');
const PnL = (() => { try { return require('../models/PnL'); } catch(e){ return null; } })();

const PAPER_MODE = (process.env.PAPER_MODE !== 'false');
const LEVERAGE = parseFloat(process.env.LEVERAGE || '5');
const SL_PERCENT = parseFloat(process.env.SL_PERCENT || '1');
const RR = parseFloat(process.env.RR || '1.3');

function computeTargets(price, side) {
  const slAmount = price * (SL_PERCENT / 100);
  const tpDistance = slAmount * RR;
  if (side === 'BUY') return { sl: +(price - slAmount), tp: +(price + tpDistance) };
  return { sl: +(price + slAmount), tp: +(price - tpDistance) };
}

async function placeSimulatedOrder(signalDoc, accountUsd = 1000) {
  const sizeUsd = Math.max(1, accountUsd * 0.01);
  const { sl, tp } = computeTargets(signalDoc.price, signalDoc.type || signalDoc.side);
  const pos = await Position.create({
    signalId: signalDoc._id,
    symbol: signalDoc.pair || signalDoc.symbol,
    side: signalDoc.type || signalDoc.side || 'BUY',
    entry: signalDoc.price,
    sizeUsd,
    leverage: LEVERAGE,
    sl,
    tp,
    status: 'open',
    openedAt: new Date(),
    execMeta: { mode: 'paper' }
  });
  await Signal.findByIdAndUpdate(signalDoc._id, { status: 'executed', executedAt: new Date(), execResult: pos._id });
  return pos;
}

async function placeLiveOrder(signalDoc) {
  // implement Bitget signed order here when ready
  throw new Error('Live order not implemented. Keep PAPER_MODE=true.');
}

async function openPosition(signalDoc, accountUsd = 1000) {
  if (PAPER_MODE) return await placeSimulatedOrder(signalDoc, accountUsd);
  return await placeLiveOrder(signalDoc, accountUsd);
}

async function closePosition(posId, closePrice, reason = 'manual') {
  const pos = await Position.findById(posId);
  if (!pos || pos.status === 'closed') return pos;
  const direction = pos.side === 'BUY' ? 1 : -1;
  const notional = pos.sizeUsd * pos.leverage;
  const move = (closePrice - pos.entry) / pos.entry;
  const pnlUsd = +(move * notional * direction).toFixed(4);

  pos.status = 'closed';
  pos.closedAt = new Date();
  pos.closePrice = closePrice;
  pos.pnlUsd = pnlUsd;
  pos.execMeta = pos.execMeta || {};
  pos.execMeta.closeReason = reason;
  await pos.save();

  if (PnL) {
    try {
      await PnL.create({ tradeId: pos._id, pair: pos.symbol, entry: pos.entry, exit: closePrice, pnl: pnlUsd });
    } catch (e) { /* ignore */ }
  }
  return pos;
}

module.exports = { openPosition, closePosition, computeTargets };