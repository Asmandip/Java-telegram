const { request } = require('undici');

// Simple public endpoints to fetch tickers.
// Note: Bitget public API paths may change; adjust if needed.
const BITGET_BASE = 'https://api.bitget.com';

async function fetchSymbolTicker(symbol) {
  // normalize: BTC/USDT -> BTCUSDT or btc_usdt depending on API; we'll try common endpoints
  const normalized = symbol.replace('/', '').toLowerCase();
  try {
    const res = await request(`${BITGET_BASE}/api/spot/v1/market/ticker?symbol=${normalized}`);
    const body = await res.body.text();
    try { return JSON.parse(body); } catch(e){ return body; }
  } catch (err) {
    // fallback: try another endpoint
    const res2 = await request(`${BITGET_BASE}/api/spot/v1/market/tickers`);
    const body2 = await res2.body.text();
    try { return JSON.parse(body2); } catch(e){ return body2; }
  }
}

async function fetchAllTickers() {
  try {
    const res = await request(`${BITGET_BASE}/api/spot/v1/market/tickers`);
    const body = await res.body.text();
    return JSON.parse(body);
  } catch (err) {
    throw err;
  }
}

module.exports = { fetchSymbolTicker, fetchAllTickers };
