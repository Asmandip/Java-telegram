const express = require('express');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const TelegramBot = require('node-telegram-bot-api');
const Signal = require('./models/Signal');
const PnL = require('./models/PnL');
const { TELEGRAM_TOKEN, CHAT_ID } = require('./config');

// ==== MongoDB Connection ====
mongoose.connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
})
.then(() => console.log("✅ MongoDB Connected from Bot"))
.catch(err => console.error("❌ MongoDB Error:", err));

// ==== Telegram Bot ====
if (!TELEGRAM_TOKEN) {
    console.warn('⚠ TELEGRAM_TOKEN not set in env');
}

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, 'বট অন: স্বাগতম! 🟢');
});

// ==== Functions ====
async function saveSignal(symbol, type, entry, target, sl) {
    try {
        const signal = new Signal({
            time: new Date().toLocaleString(),
            symbol,
            type,
            entry,
            target,
            sl
        });
        await signal.save();
        console.log(`📊 Signal Saved: ${symbol} - ${type}`);

        // Send to Telegram
        const message = `📢 *New Signal*\n\n` +
                        `📌 Symbol: ${symbol}\n` +
                        `📈 Type: ${type}\n` +
                        `💵 Entry: ${entry}\n` +
                        `🎯 Target: ${target}\n` +
                        `🛑 Stop Loss: ${sl}\n` +
                        `🕒 Time: ${signal.time}`;
        await bot.sendMessage(CHAT_ID, message, { parse_mode: "Markdown" });

        console.log(`✅ Telegram Message Sent for ${symbol}`);
    } catch (err) {
        console.error("❌ Error Saving Signal:", err);
    }
}

async function savePnL(date, value) {
    try {
        const pnl = new PnL({ date, value });
        await pnl.save();
        console.log(`💰 PnL Saved: ${value} on ${date}`);
    } catch (err) {
        console.error("❌ Error Saving PnL:", err);
    }
}

// ==== Express API ====
const app = express();
app.use(bodyParser.json());

// API to post new signal
app.post('/signal', async (req, res) => {
    const { symbol, type, entry, target, sl } = req.body;

    if (!symbol || !type || !entry || !target || !sl) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    await saveSignal(symbol, type, entry, target, sl);
    res.json({ success: true, message: 'Signal saved and sent to Telegram' });
});

// API to post new PnL
app.post('/pnl', async (req, res) => {
    const { date, value } = req.body;

    if (!date || value === undefined) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    await savePnL(date, value);
    res.json({ success: true, message: 'PnL saved' });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 API Server running on port ${PORT}`));

module.exports = {
    bot,
    saveSignal,
    savePnL
};