// models/Settings.js
const mongoose = require("mongoose");

const settingsSchema = new mongoose.Schema({
  autoTrade: { type: Boolean, default: false },
  riskPercentage: { type: Number, default: 1 },
  leverage: { type: Number, default: 5 },
  takeProfit: { type: Number, default: 3 },
  stopLoss: { type: Number, default: 1 },
  pairs: { type: [String], default: [] },
  lastUpdated: { type: Date, default: Date.now }
});

module.exports = mongoose.model("Settings", settingsSchema);