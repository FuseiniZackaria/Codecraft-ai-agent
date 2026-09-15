const https = require('https');
const config = require('../config');

/**
 * telegramProvider.js - direct Telegram Bot API, no Composio, no OAuth.
 * A bot token from @BotFather is all that's needed - genuinely simpler
 * setup than WhatsApp's Twilio/Meta options.
 */

function callTelegramApi(method, body) {
  return new Promise((resolve, reject) => {
    if (!config.telegram.botToken) {
      return reject(new Error('Telegram not configured - set TELEGRAM_BOT_TOKEN (get one from @BotFather on Telegram)'));
    }

    const payload = JSON.stringify(body);
    const req = https.request(
      {
        hostname: 'api.telegram.org',
        path: `/bot${config.telegram.botToken}/${method}`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (!parsed.ok) return reject(new Error(`Telegram API error: ${parsed.description || 'unknown error'}`));
            resolve(parsed.result);
          } catch (err) {
            reject(new Error(`Telegram API returned unparseable response: ${err.message}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function sendMessage(chatId, text) {
  const result = await callTelegramApi('sendMessage', { chat_id: chatId, text });
  return { messageId: result.message_id };
}

async function checkStatus() {
  // getMe is a free, side-effect-free call - confirms the bot token is
  // actually valid without sending anything.
  const bot = await callTelegramApi('getMe', {});
  return { connected: true, botUsername: bot.username };
}

module.exports = { sendMessage, checkStatus };