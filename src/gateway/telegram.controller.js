const TelegramBot = require('node-telegram-bot-api');
const normalizer = require('../normalizer/normalizer.service');
const orchestrator = require('../orchestrator/orchestrator.service');

// Initialize the Telegram bot instance
// We use polling for local dev if webhook isn't configured, but webhook is better for prod.
// Considering this is a backend server, we'll set up webhook routing.
const token = process.env.TELEGRAM_BOT_Token;

let bot = null;
if (token) {
    // Disable polling aggressively on Vercel to prevent infinite socket hanging
    const isVercel = !!process.env.VERCEL;
    bot = new TelegramBot(token, { polling: !isVercel }); 
    
    // Listen for messages if we are polling locally
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
    if (!bot) {
        return res.status(500).json({ status: 'FATAL', reason: 'bot is null', token_exists: !!process.env.TELEGRAM_BOT_Token });
    }

    try {
        const update = req.body;
        
        if (update.message) {
            const message = update.message;
            console.log('Received Telegram message:', message.text);

            // Normalize input
            const inputEvent = normalizer.fromTelegram(message);

            // MUST await this entirely BEFORE sending the 200 OK, otherwise Vercel freezes the function!
            const responseText = await orchestrator.routeMessage(inputEvent);

            // Send response back via Telegram
            if (responseText) {
                await bot.sendMessage(message.chat.id, responseText);
            }
        }
        // Acknowledge completely at the END so the Lambda stays alive
        return res.status(200).json({ status: 'SUCCESS', message: responseText });
    } catch (error) {
        console.error('Error processing Telegram webhook payload:', error);
        return res.status(500).json({ status: 'ERROR', error: error.message, stack: error.stack });
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
