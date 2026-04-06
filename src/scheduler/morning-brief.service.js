const { supabase } = require('../shared/db');
const outboundAdapter = require('../gateway/outbound.service');
const taskQueryService = require('../tasks/task-query.service');

class MorningBriefService {
    /**
     * Executes the daily morning brief sequence
     */
    async processGlobalMorningBriefs() {
        if (!supabase) return;

        try {
            const { data: users, error } = await supabase.from('users').select('*');
            if (error) throw error;
            if (!users || users.length === 0) return;

            const now = new Date();

            for (const user of users) {
                if (user.role === 'secondary') continue; // Secondary users don't get the brief

                const settings = user.settings || {};
                const timeZone = settings.timezone || 'Asia/Kolkata';
                const briefHour = parseInt(settings.morning_brief_time || '7', 10);

                // Safely extract the user's localized date and hour
                const formatter = new Intl.DateTimeFormat('en-US', { timeZone, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit' });
                const parts = formatter.formatToParts(now);
                const p = {};
                parts.forEach(part => p[part.type] = part.value);
                
                const localDateStr = `${p.year}-${p.month}-${p.day}`; // "YYYY-MM-DD"
                const userLocalHour = parseInt(p.hour, 10);

                if (userLocalHour >= briefHour) {
                    if (settings.last_morning_brief_date !== localDateStr) {
                        console.log(`[MorningBrief] Sending brief to user ${user.id} in timezone ${timeZone} for ${localDateStr}`);

                        const briefMsg = await taskQueryService.buildMorningBrief(user);
                        if (briefMsg) {
                            await outboundAdapter.sendMessage(user.phone, briefMsg);
                        }

                        settings.last_morning_brief_date = localDateStr;
                        await supabase.from('users').update({ settings }).eq('id', user.id);
                    }
                }
            }
        } catch (error) {
            console.error('[Scheduler] Error processing global briefs:', error);
        }
    }
}

module.exports = new MorningBriefService();
