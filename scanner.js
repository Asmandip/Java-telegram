// scanner.js — Bitget Scanner & Auto Trader
const axios = require('axios');
const crypto = require('crypto');
const { sendTelegramAlert } = require('./bot'); // Alert function from bot.js
const Settings = require('./models/Settings');

const BITGET_API = "https://api.bitget.com";

let autoTradeEnabled = false; // Controlled via dashboard/telegram

// Signature function for Bitget API
function signRequest(timestamp, method, requestPath, body, secretKey) {
    const preSign = timestamp + method.toUpperCase() + requestPath + (body || '');
    return crypto.createHmac('sha256', secretKey).update(preSign).digest('base64');
}

// Get live price from Bitget
async function getPrice(symbol = 'BTCUSDT') {
    const res = await axios.get(`${BITGET_API}/api/mix/v1/market/ticker?symbol=${symbol}`);
    return parseFloat(res.data.data.last);
}

// Place order on Bitget
async function placeOrder(symbol, side, size, price = null) {
    const apiKey = process.env.BITGET_API_KEY;
    const secretKey = process.env.BITGET_SECRET_KEY;
    const passphrase = process.env.BITGET_PASSPHRASE;

    const timestamp = Date.now().toString();
    const requestPath = '/api/mix/v1/order/placeOrder';

    const body = JSON.stringify({
        symbol: symbol,
        marginCoin: 'USDT',
        side: side,
        orderType: 'market',
        size: size
    });

    const sign = signRequest(timestamp, 'POST', requestPath, body, secretKey);

    const headers = {
        'ACCESS-KEY': apiKey,
        'ACCESS-SIGN': sign,
        'ACCESS-TIMESTAMP': timestamp,
        'ACCESS-PASSPHRASE': passphrase,
        'Content-Type': 'application/json'
    };

    const res = await axios.post(`${BITGET_API}${requestPath}`, body, { headers });
    return res.data;
}

// Scanner logic
async function runScanner() {
    const settings = await Settings.findOne();
    const symbol = settings.symbol || 'BTCUSDT';
    const strategy = settings.strategy || 'mean_revert_v1';

    const price = await getPrice(symbol);

    // Example strategy check (you can add more strategies here)
    if (strategy === 'mean_revert_v1') {
        const triggerPrice = settings.triggerPrice || 30000; // Example
        if (price <= triggerPrice) {
            const alertMsg = `📢 [Scanner] ${symbol} price dropped to ${price} — Strategy: ${strategy}`;
            sendTelegramAlert(alertMsg, true); // true => ask for auto trade
            if (autoTradeEnabled) {
                await placeOrder(symbol, 'open_long', '0.001');
            }
        }
    }
}

// External controls
function enableAutoTrade(state) {
    autoTradeEnabled = state;
}

module.exports = { runScanner, enableAutoTrade };