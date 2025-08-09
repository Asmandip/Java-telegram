require('dotenv').config();

module.exports = {
  PORT: process.env.PORT || 10000,
  FRONTEND_URL: process.env.FRONTEND_URL || '',
  NODE_ENV: process.env.NODE_ENV || 'development',
  TELEGRAM_TOKEN: process.env.TELEGRAM_TOKEN || '',
  CHAT_ID: process.env.CHAT_ID || '',
  MONGO_URI: process.env.MONGO_URI || ''
};
