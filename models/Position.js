// models/Position.js
const mongoose = require('mongoose');

const PositionSchema = new mongoose.Schema({
  signalId: { type: mongoose.Schema.Types.ObjectId, ref: 'Signal' },
  symbol: String,
  side: { type: String, enum: ['BUY','SELL'] },
  entry: Number,
  sizeUsd: Number,
  leverage: Number,
  sl: Number,
  tp: Number,
  status: { type: String, enum: ['open','closed'], default: 'open' },
  openedAt: { type: Date, default: Date.now },
  closedAt: Date,
  closePrice: Number,
  pnlUsd: Number,
  execMeta: Object // order ids, raw responses
});

module.exports = mongoose.model('Position', PositionSchema);
