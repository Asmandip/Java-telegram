const mongoose = require('mongoose');
const Schema = new mongoose.Schema({
  autoTrade: { type:Boolean, default: (process.env.AUTO_TRADE === 'true') },
  scannerEnabled: { type:Boolean, default:false },
  leverage: { type:Number, default: parseFloat(process.env.LEVERAGE || '5') },
  slPercent: { type:Number, default: parseFloat(process.env.SL_PERCENT || '1') },
  rr: { type:Number, default: parseFloat(process.env.RR || '1.3') },
  activeStrategy: { type:String, default: 'scalping_v1' },
  lastUpdated: { type:Date, default: Date.now }
});
module.exports = mongoose.model('Settings', Schema);