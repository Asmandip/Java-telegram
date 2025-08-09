import mongoose from 'mongoose';

const settingsSchema = new mongoose.Schema({
  leverage: { type: Number, default: 5 },
  stopLossPercent: { type: Number, default: 1 },
  riskReward: { type: Number, default: 1.3 },
  timeframe: { type: String, default: '3m' },
  autoTrade: { type: Boolean, default: false },
  indicators: {
    rsi: { type: Boolean, default: true },
    ema: { type: Boolean, default: true },
    atr: { type: Boolean, default: true },
    volume: { type: Boolean, default: true }
  }
});

export default mongoose.model('Settings', settingsSchema);