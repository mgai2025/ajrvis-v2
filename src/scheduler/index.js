const cron = require('node-cron');
const reminderService = require('./reminder.service');
const morningBriefService = require('./morning-brief.service');
const CONSTANTS = require('../config/constants');
const taskService = require('../tasks/task.service');

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
    // e.g., '0 30 7 * * *' -> 7:30 AM
    cron.schedule(CONSTANTS.SCHEDULER.MORNING_BRIEF_CRON, async () => {
         await morningBriefService.executeDailyBrief();
    }, {
         scheduled: true,
         timezone: CONSTANTS.SCHEDULER.MORNING_BRIEF_TIMEZONE
    });
};

module.exports = { initScheduler };
