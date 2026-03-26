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

module.exports = router;
