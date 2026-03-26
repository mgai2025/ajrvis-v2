const TelegramBot = require('node-telegram-bot-api');
const normalizer = require('../normalizer/normalizer.service');
const orchestrator = require('../orchestrator/orchestrator.service');

// Initialize the Telegram bot instance
// We use polling for local dev if webhook isn't configured, but webhook is better for prod.
// Considering this is a backend server, we'll set up webhook routing.
const token = process.env.TELEGRAM_BOT_Token;

let bot = null;
if (token) {
    // For local development, we use 'polling: true' so you don't need ngrok or port forwarding.
    bot = new TelegramBot(token, { polling: true }); 
    
    // Listen for messages if we are polling
    bot.on('message', async (msg) => {
        console.log('Received Telegram message:', msg.text);
        try {
            const inputEvent = normalizer.fromTelegram(msg);
            const responseText = await orchestrator.routeMessage(inputEvent);
            if (responseText) {
                await bot.sendMessage(msg.chat.id, responseText);
            }
        } catch (error) {
            console.error('Error processing Telegram message:', error);
        }
    });

} else {
    console.warn('TELEGRAM_BOT_Token is not set in .env. Telegram integration disabled.');
}

/**
 * Handle incoming Telegram Webhook payloads
 */
const receiveMessage = async (req, res) => {
    // 1. Acknowledge immediately
    res.sendStatus(200);

    if (!bot) return;

    try {
        const update = req.body;
        
        // Let node-telegram-bot-api parse the update 
        // We can just manually process the message directly to match architecture
        if (update.message) {
            const message = update.message;
            console.log('Received Telegram message:', message.text);

            // Normalize input
            const inputEvent = normalizer.fromTelegram(message);

            // Send to Orchestrator
            const responseText = await orchestrator.routeMessage(inputEvent);

            // Send response back via Telegram
            if (responseText) {
                await bot.sendMessage(message.chat.id, responseText);
            }
        }
    } catch (error) {
        console.error('Error processing Telegram webhook payload:', error);
    }
};

/**
 * Helper to set the webhook URL for Telegram (run once during deployment)
 */
const setWebhook = async (req, res) => {
    if (!bot) return res.status(500).send('Bot not initialized');
    
    // E.g., https://your-domain.ngrok-free.app/webhook/telegram
    const url = req.body.url; 
    if (!url) return res.status(400).send('Missing url in body');

    try {
        await bot.setWebHook(url);
        res.send(`Webhook set to ${url}`);
    } catch (error) {
        res.status(500).send(error.toString());
    }
};

module.exports = {
    receiveMessage,
    setWebhook,
    bot
};
