// bot.js
const fs = require('fs');
const path = require('path');

module.exports = (bot, io) => {
    const logFile = path.join(__dirname, 'bot.log');

    function log(message) {
        const timestamp = new Date().toISOString();
        const logMessage = `[${timestamp}] ${message}`;
        fs.appendFileSync(logFile, logMessage + '\n');
        console.log(logMessage);
        io.emit('bot-log', logMessage);
    }

    // /start Command
    bot.onText(/\/start/, (msg) => {
        bot.sendMessage(msg.chat.id, "🤖 বট চালু হয়েছে!\n\n/help লিখে সব কমান্ড দেখুন।");
        log(`/start by ${msg.from.username}`);
    });

    // /help Command
    bot.onText(/\/help/, (msg) => {
        const helpText = `
📜 *Available Commands*:
/start - বট চালু করবে
/help - সব কমান্ড দেখাবে
/status - বর্তমান স্ট্যাটাস
/scan_on - স্ক্যান চালু করবে
/scan_off - স্ক্যান বন্ধ করবে
/auto_on - Auto Trade চালু
/auto_off - Auto Trade বন্ধ
        `;
        bot.sendMessage(msg.chat.id, helpText, { parse_mode: 'Markdown' });
        log(`/help by ${msg.from.username}`);
    });

    // /status Command
    bot.onText(/\/status/, (msg) => {
        // এখানে তোমার স্ট্যাটাস ডেটা আসবে
        bot.sendMessage(msg.chat.id, "📊 *System Status:*\nRunning: ✅\nAutoTrade: ✅", { parse_mode: 'Markdown' });
        log(`/status by ${msg.from.username}`);
    });

    // /scan_on Command
    bot.onText(/\/scan_on/, (msg) => {
        io.emit('scan-toggle', { running: true });
        bot.sendMessage(msg.chat.id, "🔍 Scanner চালু হয়েছে!");
        log(`/scan_on by ${msg.from.username}`);
    });

    // /scan_off Command
    bot.onText(/\/scan_off/, (msg) => {
        io.emit('scan-toggle', { running: false });
        bot.sendMessage(msg.chat.id, "🛑 Scanner বন্ধ হয়েছে!");
        log(`/scan_off by ${msg.from.username}`);
    });

    // /auto_on Command
    bot.onText(/\/auto_on/, (msg) => {
        io.emit('auto-trade', { enabled: true });
        bot.sendMessage(msg.chat.id, "⚡ Auto Trade চালু হয়েছে!");
        log(`/auto_on by ${msg.from.username}`);
    });

    // /auto_off Command
    bot.onText(/\/auto_off/, (msg) => {
        io.emit('auto-trade', { enabled: false });
        bot.sendMessage(msg.chat.id, "⏹ Auto Trade বন্ধ হয়েছে!");
        log(`/auto_off by ${msg.from.username}`);
    });
};