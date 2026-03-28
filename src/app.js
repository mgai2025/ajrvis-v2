require('dotenv').config();
const express = require('express');
const cors = require('cors');

// Internal Microservices Modules
const gatewayRoutes = require('./gateway/routes');
// const orchestrator = require('./orchestrator'); // To be implemented

const app = express();

app.use(cors());
app.use(express.json());

// Basic health check
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', service: 'Ajrvis V2 API Gateway' });
});

// Mount modular routes (Gateway will handle WhatsApp webhook)
app.use('/webhook', gatewayRoutes);

const PORT = process.env.PORT || 3000;

const configService = require('./config/config.service');
const { initScheduler } = require('./scheduler/index');

// Prevent `app.listen` from crashing Vercel Serverless Functions
if (!process.env.VERCEL) {
    app.listen(PORT, () => {
        console.log(`Ajrvis Backend Gateway running on port ${PORT}`);
        
        // --- AUTOMATED SCHEDULER ---
        initScheduler();
        const HOURLY_MS = 60 * 60 * 1000;
        setInterval(async () => {
            console.log('[Scheduler] Running hourly Google Sheets sync...');
            await configService.syncAll();
        }, HOURLY_MS);
        
        configService.syncAll().then(res => {
            console.log('[Scheduler] Initial startup sync completed:', res.message);
        }).catch(e => console.error('[Scheduler] Initial sync failed:', e));
    });
}

// Export the native Express app for the Serverless Wrapper
module.exports = app;

