// server.js
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');
const http = require('http');
const socketIo = require('socket.io');
const requireAuth = require('./middleware/auth');
const scanner = require('./scanner');
const monitor = require('./monitor');
const botHandler = require('./bot');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 10000;
const TOKEN = process.env.BOT_TOKEN;
const WEBHOOK_URL = `${process.env.RENDER_EXTERNAL_URL}/bot${TOKEN}`;

// Middleware
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// MongoDB Connection
mongoose.connect(process.env.MONGO_URI, {
    useNewUrlParser: true, useUnifiedTopology: true
}).then(() => console.log('✅ MongoDB connected'))
.catch(err => console.error('MongoDB Error:', err));

// Telegram Bot Init
const bot = new TelegramBot(TOKEN, { webHook: true });
bot.setWebHook(WEBHOOK_URL).then(() => {
    console.log(`✅ Webhook set to ${WEBHOOK_URL}`);
}).catch(err => console.error('Webhook Error:', err));

// Webhook Route
app.post(`/bot${TOKEN}`, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
});

// botHandler(bot, io);
// তারপর সরাসরি command handler রাখো
bot.onText(/\/start/, msg => bot.sendMessage(msg.chat.id, '🤖 Bot is running!'));
bot.onText(/\/status/, msg => bot.sendMessage(msg.chat.id, '📊 Bot status: ACTIVE'));
bot.onText(/\/stop/, msg => bot.sendMessage(msg.chat.id, '⛔ Bot stopped'));

// Dashboard Routes
app.get('/', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api/logs', requireAuth, (req, res) => {
    res.json(scanner.getLogs());
});

app.post('/api/scan-toggle', requireAuth, (req, res) => {
    scanner.toggle();
    res.json({ running: scanner.isRunning() });
});

app.post('/api/auto-trade', requireAuth, (req, res) => {
    scanner.setAutoTrade(req.body.enabled);
    res.json({ autoTrade: scanner.isAutoTrade() });
});

// Socket.IO connection
io.on('connection', (socket) => {
    console.log('Client connected to Dashboard');
});

// Start Server
server.listen(PORT, () => {
    console.log(`✅ Server + Dashboard running on port ${PORT}`);
});