/**
 * Centralized Configuration Constants (The "Input Tab")
 * All hardcoded AI behavior inputs should be placed here.
 */

const CONFIG = {
    SCHEDULER: {
        REMINDER_CHECK_INTERVAL_MS: 60 * 1000, // Check reminders every 60 seconds
        MORNING_BRIEF_CRON: '0 30 7 * * *', // Run at 7:30 AM every day
        MORNING_BRIEF_TIMEZONE: 'Asia/Kolkata', // IST Timezone
        MAX_FOLLOWUPS: 3, // Max reminders for a task before escalation
    },
    
    LIMITS: {
        MAX_DAILY_PINGS: 10, // S-006: Max outbound WA/TG pings per user a day
        MAX_GOAL_TASKS: 5, // G-002: Max 5 tasks per goal
    },

    DEFAULTS: {
        LANGUAGE: 'hinglish',
        GROCERY_APP: 'blinkit',
        TIMEZONE: 'Asia/Kolkata',
    },
    
    WORK_HOURS: {
        START: 9, // 9 AM
        END: 19 // 7 PM
    },

    REMINDER_SCHEDULES: {
        // Arrays represent offsets in minutes relative to the deadline
        // Native array order: [Pre-warnings..., Exact, Post-warnings...]
        SHORT_TERM: [0], // < 2 hrs
        DAILY: [-60, 0, 60, 1440], // 2-24 hrs
        MULTI_DAY: [-1440, -120, 0, 60, 1440], // 1-7 days
        LONG_TERM: [-4320, -1440, 0, 60, 1440] // > 7 days
    },

    DELEGATION_REMINDER_SCHEDULES: {
        // Dynamic schedules specifically for peer-to-peer delegation
        // If deadline < 24h: aggressive follow-up
        URGENT_24H: [-90, -60, -30], 
        // If > 24h: normal follow-up
        STANDARD: [-1440, -120, -60]
    },

    BOT_LINKS: {
        TELEGRAM_BASE: process.env.TELEGRAM_BOT_USERNAME 
            ? `https://t.me/${process.env.TELEGRAM_BOT_USERNAME}?start=`
            : 'https://t.me/PROVIDE_BOT_USERNAME_IN_ENV?start='
    }
};

module.exports = CONFIG;
