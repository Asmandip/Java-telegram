const mongoose = require('mongoose');

const SignalSchema = new mongoose.Schema({
    time: String,
    symbol: String,
    type: String,
    entry: Number,
    target: Number,
    sl: Number
});

module.exports = mongoose.model('Signal', SignalSchema);
