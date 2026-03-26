/**
 * Normalizes inputs from various channels (WhatsApp, Telegram, Web) into a standard InputEvent.
 * As per PRD 4.4: InputEventSchema 
 */
class InputNormalizer {
    /**
     * Convert WhatsApp message payload to normalized InputEvent
     */
    fromWhatsApp(messagePayload) {
        const phone = messagePayload.from;
        let contentType = 'text';
        let rawText = '';

        if (messagePayload.type === 'text') {
            rawText = messagePayload.text.body;
        } else if (messagePayload.type === 'audio') {
            contentType = 'voice';
            // audio_url = messagePayload.audio.id (to be fetched)
            rawText = '[Voice Note]'; // Placeholder until V2
        } else if (messagePayload.type === 'image') {
            contentType = 'image';
            rawText = '[Image]';
        } else {
            contentType = 'unknown';
            rawText = '[Unsupported Media]';
        }

        return {
            event_id: messagePayload.id,
            user_phone: phone, // We use phone here, will be resolved to user_id by Orchestrator
            channel: 'whatsapp',
            content_type: contentType,
            raw_text: rawText,
            timestamp: new Date(messagePayload.timestamp * 1000).toISOString(),
            metadata: {}
        };
    }

    /**
     * Convert Telegram message payload to normalized InputEvent
     */
    fromTelegram(message) {
        // Telegram uses chat.id or from.id. For linking with our phone-based system, 
        // we might use the chat.id as a pseudo-phone for now, or require a one-time link.
        // For simplicity in V1 Telegram parallel channel, we'll prefix with 'TG-'
        const pseudoPhone = `TG-${message.from.id}`;
        
        let contentType = 'text';
        let rawText = '';

        if (message.text) {
            rawText = message.text;
        } else if (message.voice) {
            contentType = 'voice';
            rawText = '[Voice Note]';
        } else if (message.photo) {
            contentType = 'image';
            rawText = '[Image]';
        } else {
            contentType = 'unknown';
            rawText = '[Unsupported Media]';
        }

        return {
            event_id: String(message.message_id || Date.now()),
            user_phone: pseudoPhone, // Used as unique identifier
            channel: 'telegram',
            content_type: contentType,
            raw_text: rawText,
            timestamp: message.date ? new Date(message.date * 1000).toISOString() : new Date().toISOString(),
            metadata: { 
                chat_id: message.chat ? message.chat.id : null,
                username: message.from ? message.from.username : null 
            }
        };
    }
}

module.exports = new InputNormalizer();
