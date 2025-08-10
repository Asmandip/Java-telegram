const mongoose = require('mongoose');
const Schema = new mongoose.Schema({
  tradeId: mongoose.Schema.Types.ObjectId, pair: String, entry: Number, exit: Number, pnl: Number, createdAt: { type:Date, default: Date.now }
});
module.exports = mongoose.model('PnL', Schema);