// bot.js (add or merge into existing)
const { saveSignal, savePnL } = require('./botSignalHelpers') || require('./bot'); // adjust to your exports
const TelegramBot = require('node-telegram-bot-api');
const { openPosition } = require('./executor');
const { TELEGRAM_TOKEN, CHAT_ID } = require('./config');

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

bot.on('callback_query', async (query) => {
  try {
    const data = query.data;
    const parts = data.split('|');
    const action = parts[0];

    if(action === 'confirm_noexec' || action === 'confirm_exec'){
      const symbol = parts[1];
      const side = parts[2];
      const price = parseFloat(parts[3]);

      // Save signal
      await saveSignal(symbol, side, price, null, null);

      if(action === 'confirm_exec'){
        // open position (paper or live depending on env)
        const position = await openPosition(symbol, side, price, /* accountUsd */ 1000);
        await bot.answerCallbackQuery(query.id, { text: 'Execution started (paper mode if enabled)' });
        await bot.sendMessage(CHAT_ID, `🔔 Execution result: ${JSON.stringify(position)}`);
      } else {
        await bot.answerCallbackQuery(query.id, { text: 'Signal confirmed (no exec)' });
      }
    } else if(action === 'reject'){
      const symbol = parts[1];
      await bot.answerCallbackQuery(query.id, { text: `Rejected ${symbol}` });
    } else {
      await bot.answerCallbackQuery(query.id, { text: 'Unknown action' });
    }
  } catch(err){
    console.error('callback err', err);
    try{ await bot.answerCallbackQuery(query.id, { text: 'Error processing action' }); }catch(e){}
  }
});