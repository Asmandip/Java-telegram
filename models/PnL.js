// models/PnL.js
const mongoose = require('mongoose');

const PnLSchema = new mongoose.Schema({
  date: { type: String }, // YYYY-MM-DD
  value: Number
});

module.exports = mongoose.model('PnL', PnLSchema);