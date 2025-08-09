// executor.js
const fetch = (...args) => import('node-fetch').then(m => m.default(...args));
const { LEVERAGE = 5, SL_PERCENT = 1, RR = 1.3, PAPER_MODE = 'true' } = process.env;

const PAPER = (PAPER_MODE === 'true' || PAPER_MODE === '1');

async function placeSimulatedOrder(symbol, side, price, sizeUsd){
  // Simulate opening: store in memory or DB (here console)
  const position = {
    id: 'sim_' + Date.now(),
    symbol, side, entry: price, sizeUsd, leverage: LEVERAGE,
    sl: side === 'BUY' ? price*(1 - SL_PERCENT/100) : price*(1 + SL_PERCENT/100),
    tp: side === 'BUY' ? price*(1 + (SL_PERCENT/100)*RR) : price*(1 - (SL_PERCENT/100)*RR),
    status: 'open',
    createdAt: new Date().toISOString()
  };
  console.log('SIM ORDER', position);
  // TODO: save to DB
  return position;
}

// Placeholder for real Bitget order (requires signed requests)
async function placeLiveOrderBitget(symbol, side, sizeUsd){
  // TODO: implement signed API calls with API key/secret
  // return order info
  throw new Error('Live Bitget order not implemented yet.');
}

async function openPosition(symbol, side, price, accountUsd){
  const size = accountUsd * 0.01; // default 1% risk per trade (you can param)
  if(PAPER) {
    return await placeSimulatedOrder(symbol, side, price, size);
  } else {
    return await placeLiveOrderBitget(symbol, side, size);
  }
}

module.exports = { openPosition };
