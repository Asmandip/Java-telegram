// botHandler.js
module.exports = function botHandler(bot, io) {
  bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, '🤖 Bot is running!');
  });

  bot.onText(/\/status/, (msg) => {
    bot.sendMessage(msg.chat.id, '📊 Bot status: ACTIVE');
  });

  io.emit('log', 'Bot handler initialized');
};
