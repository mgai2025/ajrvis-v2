const TelegramBot = require('node-telegram-bot-api');
const normalizer = require('../normalizer/normalizer.service');
const orchestrator = require('../orchestrator/orchestrator.service');

// Initialize the Telegram bot instance
// We use polling for local dev if webhook isn't configured, but webhook is better for prod.
// Considering this is a backend server, we'll set up webhook routing.
const token = process.env.TELEGRAM_BOT_Token;

let bot = null;
if (token) {
    // Polling is completely DISABLED permanently. 
    // This bot relies 100% on the Webhook route hosted on Vercel.
    bot = new TelegramBot(token, { polling: false }); 

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
        let responseText = null;
        
        if (update.message) {
            const message = update.message;
            console.log('Received Telegram message:', message.text);

            // Normalize input
            const inputEvent = normalizer.fromTelegram(message);

            // SPRINT 2: Intercept Deep Link Delegation
            if (message.text && message.text.startsWith('/start delegate_')) {
                const taskId = message.text.split('delegate_')[1];
                console.log('[Telegram Controller] Intercepted Delegation Approval for Task:', taskId);
                
                const userService = require('../user/user.service');
                const delegationService = require('../tasks/delegation.service');
                
                // Fetch user directly to ensure we have the DB object
                let userObj = await userService.getUserByPhone(inputEvent.user_phone);
                
                if (!userObj) {
                    // Open-Loop Self Registration: Claim the task by implicitly creating the user
                    const givenName = inputEvent.metadata.username || 'Friend';
                    const { executeDbQuery, supabase } = require('../shared/db');
                    if (supabase) {
                        userObj = await executeDbQuery(
                            supabase.from('users').insert({ 
                                phone: inputEvent.user_phone, 
                                name: givenName,
                                role: 'secondary',
                                channel: 'telegram',
                                onboarding_state: 'completed',
                                settings: {}
                            }).select().single()
                        );
                    }
                }
                
                if (userObj) {
                    responseText = await delegationService.acceptDelegation(userObj, taskId);
                } else {
                    responseText = "System Error: Could not auto-register your profile.";
                }
            } else {
                // Normal Conversational Flow
                // MUST await this entirely BEFORE sending the 200 OK, otherwise Vercel freezes the function!
                responseText = await orchestrator.routeMessage(inputEvent);
            }


            // Send response back via Telegram
            if (responseText) {
                await bot.sendMessage(message.chat.id, responseText);
            }
        }
        // Acknowledge completely at the END so the Lambda stays alive
        return res.status(200).json({ status: 'SUCCESS', message: responseText });
    } catch (error) {
        console.error('Error processing Telegram webhook payload:', error);
        if (bot && req.body && req.body.message && req.body.message.chat) {
            try {
                await bot.sendMessage(req.body.message.chat.id, "⚠️ Something went wrong on my end. Please try again.");
            } catch (e) {
                console.error('Failed to send fallback error message via webhook catch:', e);
            }
        }
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
