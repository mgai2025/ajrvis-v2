const express = require('express');
const router = express.Router();
const whatsappController = require('./whatsapp.controller');
const telegramController = require('./telegram.controller');

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

router.post('/cron/heartbeat', verifyCronSecret, async (req, res) => {
    res.status(200).json({ status: 'ok', triggered: 'heartbeat' });
    await reminderService.processOverdueReminders();
});

router.post('/cron/morning-brief', verifyCronSecret, async (req, res) => {
    res.status(200).json({ status: 'ok', triggered: 'morning-brief' });
    await morningBriefService.executeDailyBrief();
});

module.exports = router;
