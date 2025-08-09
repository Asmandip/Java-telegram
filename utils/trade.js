// utils/trade.js
const { PAPER_MODE, LEVERAGE, SL_PERCENT, RR } = require('../config');
const Signal = require('../models/Signal');

// NOTE: live Bitget order functions are placeholders — implement signing+REST as needed.
async function placeSimulatedOrder(signal, accountUsd = 1000) {
  // size calculation: risk 1% of account -> SL distance = signal.price * SL_PERCENT/100
  const slAmount = signal.price * (SL_PERCENT/100);
  const sizeUsd = accountUsd * 0.01; // 1% per trade by default
  const position = {
    id: 'sim_' + Date.now(),
    symbol: signal.symbol,
    side: signal.side,
    entry: signal.price,
    sizeUsd,
    leverage: LEVERAGE,
    sl: signal.side === 'BUY' ? signal.price - slAmount : signal.price + slAmount,
    tp: signal.side === 'BUY' ? signal.price + (slAmount * RR) : signal.price - (slAmount * RR),
    status: 'open',
    createdAt: new Date()
  };

  // save execResult in Signal doc
  const s = await Signal.findByIdAndUpdate(signal._id, { status: 'executed', executedAt: new Date(), execResult: position }, { new: true });
  return position;
}

async function placeLiveOrderBitget(signal, sizeUsd) {
  // TODO: implement HMAC signed REST call to Bitget to create futures order.
  // Return placeholder for now.
  throw new Error('Live Bitget order not implemented. Implement API signing using BITGET_API_KEY / SECRET.');
}

async function openPosition(signal, accountUsd=1000) {
  if (PAPER_MODE) {
    return await placeSimulatedOrder(signal, accountUsd);
  } else {
    // compute size
    const slAmount = signal.price * (SL_PERCENT/100);
    const sizeUsd = accountUsd * 0.01;
    return await placeLiveOrderBitget(signal, sizeUsd);
  }
}

module.exports = { openPosition };
