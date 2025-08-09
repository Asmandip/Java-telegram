import mongoose from 'mongoose';

const pnlSchema = new mongoose.Schema({
  tradeId: String,
  pair: String,
  entry: Number,
  exit: Number,
  pnl: Number,
  createdAt: { type: Date, default: Date.now }
});

export default mongoose.model('PnL', pnlSchema);