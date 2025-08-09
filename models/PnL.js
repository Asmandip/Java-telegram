const mongoose = require('mongoose');

const PnLSchema = new mongoose.Schema({
    date: String,
    value: Number
});

module.exports = mongoose.model('PnL', PnLSchema);
