// config/index.js
require('dotenv').config();

module.exports = {
  TELEGRAM_TOKEN: process.env.TELEGRAM_TOKEN || '',
  CHAT_ID: process.env.CHAT_ID || '',
  MONGO_URI: process.env.MONGO_URI || '',
  LOCAL_SERVER: process.env.LOCAL_SERVER || 'http://localhost:10000',
  SCAN_PORT: process.env.SCAN_PORT || 3010,
  TF_MINUTES: parseInt(process.env.TF_MINUTES || '3'),
  SCAN_INTERVAL_MS: parseInt(process.env.SCAN_INTERVAL_MS || '60000'),
  CONFIRMATIONS_REQUIRED: parseInt(process.env.CONFIRMATIONS_REQUIRED || '3'),
  SYMBOL_FETCH_LIMIT: parseInt(process.env.SYMBOL_FETCH_LIMIT || '50'),
  SYMBOL_CACHE_TTL_MS: parseInt(process.env.SYMBOL_CACHE_TTL_MS || '60000'),
  PER_SYMBOL_DELAY_MS: parseInt(process.env.PER_SYMBOL_DELAY_MS || '350'),
  PAPER_MODE: (process.env.PAPER_MODE || 'true') === 'true',
  AUTO_TRADE: (process.env.AUTO_TRADE || 'false') === 'true',
  LEVERAGE: parseFloat(process.env.LEVERAGE || '5'),
  SL_PERCENT: parseFloat(process.env.SL_PERCENT || '1'),
  RR: parseFloat(process.env.RR || '1.3'),
};
