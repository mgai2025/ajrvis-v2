const cron = require('node-cron');
const reminderService = require('./reminder.service');
const morningBriefService = require('./morning-brief.service');
const CONSTANTS = require('../config/constants');
const taskService = require('../tasks/task.service');
const kgDistiller = require('../knowledge/kg-distiller.service');

const initScheduler = () => {
    console.log('[Scheduler] Initializing Cron Jobs...');

    // 1. Minutely Polling for Reminders (Every 1 minute)
    cron.schedule('* * * * *', async () => {
        await reminderService.processOverdueReminders();
    });

    // 2. Daily Polling for Missed Tasks (Every hour)
    cron.schedule('0 * * * *', async () => {
        await taskService.markMissedTasks();
    });

    // 3. Daily Morning Brief
    cron.schedule(CONSTANTS.SCHEDULER.MORNING_BRIEF_CRON, async () => {
         await morningBriefService.executeDailyBrief();
    }, {
         scheduled: true,
         timezone: CONSTANTS.SCHEDULER.MORNING_BRIEF_TIMEZONE
    });

    // 4. BUG-007 FIX: Nightly Knowledge Graph Distillation (2 AM IST)
    // Processes the day's staged heuristic extractions through LLM validation
    // and commits validated facts to the Knowledge Graph domain tables.
    cron.schedule('0 2 * * *', async () => {
        console.log('[Scheduler] Starting Nightly KG Distillation...');
        await kgDistiller.runNightlyDistillation();
    }, {
        scheduled: true,
        timezone: CONSTANTS.SCHEDULER.MORNING_BRIEF_TIMEZONE
    });
};

module.exports = { initScheduler };
