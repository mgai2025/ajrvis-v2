const express = require('express');
const router = express.Router();
const whatsappController = require('./whatsapp.controller');
const telegramController = require('./telegram.controller');
const googleAuthController = require('./google-auth.controller');
const gmailWebhookController = require('./gmail-webhook.controller');

// Meta Webhook Verification
router.get('/whatsapp', whatsappController.verifyWebhook);

// Receive Messages from Meta
router.post(
    '/whatsapp', 
    // whatsappController.verifySignature, // Uncomment to enforce verification
    whatsappController.receiveMessage
);

// Telegram Webhook
router.post('/telegram', telegramController.receiveMessage);
router.post('/telegram/set-webhook', telegramController.setWebhook);

// Google OAuth Webhook
router.get('/auth/google', (req, res) => googleAuthController.startAuthFlow(req, res));
router.get('/auth/google/callback', (req, res) => googleAuthController.handleCallback(req, res));

// Gmail Push Webhook
router.post('/gmail-webhook', gmailWebhookController.receiveWebhook);

// Config API
const configService = require('../config/config.service');
router.post('/config/reload', async (req, res) => {
    // Basic API Key protection (assuming admin only)
    const apiKey = req.headers['x-api-key'];
    // For now we'll just allow it for local dev simplicity
    const result = await configService.syncAll();
    if (result.success) {
        res.status(200).json(result);
    } else {
        res.status(500).json(result);
    }
});

// --- Vercel Cron Job Endpoints ---
const morningBriefService = require('../scheduler/morning-brief.service');
const reminderService = require('../scheduler/reminder.service');

const CRON_SECRET = process.env.CRON_SECRET;

const verifyCronSecret = (req, res, next) => {
    if (!CRON_SECRET) {
        console.warn('[Cron] WARNING: CRON_SECRET not set. Endpoint is unprotected.');
        return next();
    }
    const authHeader = req.headers['authorization'];
    if (authHeader !== `Bearer ${CRON_SECRET}`) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
};

router.all('/cron/heartbeat', verifyCronSecret, async (req, res) => {
    try {
        await morningBriefService.processGlobalMorningBriefs();
        await reminderService.processOverdueReminders();
        res.status(200).json({ status: 'ok', triggered: 'heartbeat' });
    } catch (error) {
        console.error('[Cron Error] Heartbeat failed:', error);
        res.status(500).json({ status: 'failed', error: error.message });
    }
});

module.exports = router;
