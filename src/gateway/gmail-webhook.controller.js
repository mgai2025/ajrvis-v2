// Receives pings from Google's Pub/Sub system
const gmailIntelligence = require('../integrations/gmail-intelligence.service');

// Warning: In production, you must verify the token sent by Google to ensure the webhook isn't spoofed.
const receiveWebhook = async (req, res) => {
    try {
        const message = req.body.message;
        if (!message || !message.data) {
            return res.status(400).send('Bad Request');
        }

        // Google payload is Base64 encoded
        const payloadStr = Buffer.from(message.data, 'base64').toString('utf-8');
        const payload = JSON.parse(payloadStr);

        console.log(`[Gmail Webhook] Received notification for ${payload.emailAddress}`);

        // In a true multi-tenant app, you look up userId by emailAddress
        // For MVP, if we only have one user, we can fetch the first user, or match by email.
        const db = require('../shared/db');
        const userOpt = await db.executeDbQuery(
            db.supabase.from('users').select('id, settings').contains('settings', { gcal: { email: payload.emailAddress } }).limit(1)
        );

        if (userOpt && userOpt.length > 0) {
            const userId = userOpt[0].id;
            // Kick off processing in the background (fire and forget!)
            gmailIntelligence.processNewEmail(userId, payload.historyId).catch(console.error);
        }

        res.status(200).send('OK');
    } catch (e) {
        console.error('[Gmail Webhook] Error:', e.message);
        res.status(500).send('Internal Error');
    }
};

module.exports = {
    receiveWebhook
};
