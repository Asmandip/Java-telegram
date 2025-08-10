const mongoose = require('mongoose');
const PositionSchema = new mongoose.Schema({
  signalId: { type: mongoose.Schema.Types.ObjectId, ref: 'Signal' },
  symbol: String,
  side: String,
  entry: Number,
  sizeUsd: Number,
  leverage: Number,
  sl: Number,
  tp: Number,
  status: { type: String, enum: ['open','closed'], default: 'open' },
  openedAt: Date,
  closedAt: Date,
  closePrice: Number,
  pnlUsd: Number,
  execMeta: Object
});
module.exports = mongoose.model('Position', PositionSchema);