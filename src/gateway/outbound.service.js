const telegramController = require('./telegram.controller');

class OutboundAdapter {
    /**
     * Abstracted send message to handle routing between WhatsApp / Telegram
     * @param {string} userPhone - e.g., 'TG-12345' or '+919999999999'
     * @param {string} text - Message body
     */
    async sendMessage(userPhone, text) {
        if (!text) return;

        try {
            if (userPhone && userPhone.startsWith('TG-')) {
                // Route to Telegram
                const chatId = userPhone.replace('TG-', '');
                if (telegramController.bot) {
                    try {
                        await telegramController.bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
                        console.log(`[Outbound] Sent Telegram to ${userPhone}: ${text.substring(0, 30)}...`);
                    } catch (sendError) {
                        console.error('[Outbound] Markdown send failed, falling back to plain text:', sendError.message);
                        await telegramController.bot.sendMessage(chatId, text);
                        console.log(`[Outbound] Sent Plain Text Telegram to ${userPhone}: ${text.substring(0, 30)}...`);
                    }
                } else {
                    console.warn('[Outbound] Telegram bot is not initialized. Message dropped.');
                }
            } else {
                // Route to WhatsApp (To be built in Sprint F) // TODO: Call whatsapp.controller
                console.log(`[Outbound] Sending WhatsApp to ${userPhone}: ${text.substring(0, 30)}...`);
            }
        } catch (e) {
            console.error(`[Outbound Error] Failed to send message to ${userPhone}:`, e);
            throw e; // Let scheduler handle retries
        }
    }
}

module.exports = new OutboundAdapter();
