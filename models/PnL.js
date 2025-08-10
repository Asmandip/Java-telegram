const mongoose = require('mongoose');
const PnlSchema = new mongoose.Schema({
  tradeId: { type: mongoose.Schema.Types.ObjectId },
  pair: String,
  entry: Number,
  exit: Number,
  pnl: Number,
  createdAt: { type: Date, default: Date.now }
});
module.exports = mongoose.model('PnL', PnlSchema);