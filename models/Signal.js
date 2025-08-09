// models/Signal.js
const mongoose = require('mongoose');

const SignalSchema = new mongoose.Schema({
  pair: String,
  symbol: String,
  type: String,
  price: Number,
  confirmations: [String],
  indicators: Object,
  status: { type: String, default: 'candidate' }, // candidate, confirmed, executed, rejected
  createdAt: { type: Date, default: Date.now },
  executedAt: Date,
  execResult: Object
});

module.exports = mongoose.model('Signal', SignalSchema);