const { supabase } = require('../shared/db');
const outboundAdapter = require('../gateway/outbound.service');
const taskQueryService = require('../tasks/task-query.service');

class MorningBriefService {
    /**
     * Executes the daily morning brief sequence
     */
    async executeDailyBrief() {
        if (!supabase) {
            console.warn('[Scheduler] Skipping Morning Brief. DB Not Connected.');
            return;
        }

        console.log('[Scheduler] Executing Daily Morning Brief for all users...');
        try {
            // In a fully scaled V1, we would query `users` table where `settings.morning_brief_enabled = true`
            // and maybe filter by `settings.morning_brief_time` matching the current hour
            const { data: users, error } = await supabase.from('users').select('*');

            if (error) throw error;
            if (!users || users.length === 0) return;

            for (const user of users) {
                // If it's a secondary user without tracking enabled, skip.
                if (user.role === 'secondary') continue;

                const briefMsg = await taskQueryService.buildMorningBrief(user);
                await outboundAdapter.sendMessage(user.phone, briefMsg);
            }
        } catch (error) {
            console.error('[Scheduler] Error executing Daily Brief:', error);
        }
    }
}

module.exports = new MorningBriefService();
