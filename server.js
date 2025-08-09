const express = require('express');
const mongoose = require('mongoose');
const fetch = require('node-fetch');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// MongoDB Connect
mongoose.connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => console.log("✅ MongoDB Connected"))
  .catch(err => console.error("❌ MongoDB Error:", err));

// Mongo Schemas
const SignalSchema = new mongoose.Schema({
    time: String,
    symbol: String,
    type: String,
    entry: Number,
    target: Number,
    sl: Number
});
const PnLSchema = new mongoose.Schema({
    date: String,
    value: Number
});

const Signal = mongoose.model('Signal', SignalSchema);
const PnL = mongoose.model('PnL', PnLSchema);

// Middleware
app.use(express.static('public'));

// 1. Bot Status API
app.get('/api/bot-status', (req, res) => {
    // এখানে তোমার বটের লাইভ স্ট্যাটাস ডেটা চেক করবে
    // ধরলাম বট সবসময় চলছে
    res.json({ status: 'Running' });
});

// 2. Live Crypto Prices API
app.get('/api/prices', async (req, res) => {
    try {
        let coins = ['BTCUSDT', 'ETHUSDT', 'PIUSDT', 'VERTUSDT'];
        let prices = [];
        for (let coin of coins) {
            let r = await fetch(`https://api.bitget.com/api/v2/market/ticker?symbol=${coin}`);
            let d = await r.json();
            prices.push({
                symbol: coin,
                price: parseFloat(d.data.last).toFixed(2)
            });
        }
        res.json(prices);
    } catch (err) {
        console.error(err);
        res.json([]);
    }
});

// 3. Signal History API
app.get('/api/signals', async (req, res) => {
    let data = await Signal.find().sort({ _id: -1 }).limit(20);
    res.json(data);
});

// 4. PnL Data API
app.get('/api/pnl', async (req, res) => {
    let data = await PnL.find().sort({ date: 1 });
    res.json({
        dates: data.map(d => d.date),
        values: data.map(d => d.value)
    });
});

// Start Server
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));