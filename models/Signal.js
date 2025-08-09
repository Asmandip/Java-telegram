// models/Signal.js
const mongoose = require('mongoose');

const SignalSchema = new mongoose.Schema({
  symbol: { type: String, required: true },
  side: { type: String, enum: ['BUY','SELL'], required: true },
  price: Number,
  confirmations: [String],
  time: { type: Date, default: Date.now },
  status: { type: String, enum: ['candidate','confirmed','executed','rejected'], default: 'candidate' },
  executedAt: Date,
  execResult: Object
});

module.exports = mongoose.model('Signal', SignalSchema);