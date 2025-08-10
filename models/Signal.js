const mongoose = require('mongoose');
const Schema = new mongoose.Schema({
  pair: String, symbol: String, type: String, price: Number,
  confirmations: [String], indicators: Object,
  status: { type:String, default:'candidate' },
  createdAt: { type: Date, default: Date.now }, executedAt: Date, execResult: Object
});
module.exports = mongoose.model('Signal', Schema);