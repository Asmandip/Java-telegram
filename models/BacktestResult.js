// models/BacktestResult.js
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const TradeSchema = new Schema({
  entryIndex: Number,
  entryTime: Date,
  entryPrice: Number,
  exitIndex: Number,
  exitTime: Date,
  exitPrice: Number,
  side: String,
  sizeUsd: Number,
  pnlUsd: Number,
  meta: Object
}, { _id: false });

const BacktestSchema = new Schema({
  jobName: String,
  symbol: String,
  timeframe: String,
  from: Date,
  to: Date,
  strategy: String,
  params: Object,
  initialCapital: { type: Number, default: 1000 },
  summary: Object,
  trades: [TradeSchema],
  equity: [{ t: Date, equity: Number }],
  status: { type: String, enum: ['queued','running','done','failed'], default: 'queued' },
  logs: [String],
  createdAt: { type: Date, default: Date.now },
  finishedAt: Date
}, { strict: false });

module.exports = mongoose.model('BacktestResult', BacktestSchema);
