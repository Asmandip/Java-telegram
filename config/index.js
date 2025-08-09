import dotenv from 'dotenv';
dotenv.config();

export default {
  telegramToken: process.env.TELEGRAM_TOKEN,
  chatId: process.env.CHAT_ID,
  bitgetApiKey: process.env.BITGET_API_KEY,
  bitgetSecret: process.env.BITGET_SECRET,
  bitgetPassphrase: process.env.BITGET_PASSPHRASE,
  mongoUri: process.env.MONGO_URI,
  confThreshold: parseFloat(process.env.CONF_THRESHOLD) || 0.75,
  leverage: 5,
  stopLossPercent: 1,
  riskReward: 1.3,
  timeframe: '3m'
};