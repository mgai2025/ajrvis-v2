const { executeDbQuery, supabase } = require('../shared/db');
const outboundAdapter = require('../gateway/outbound.service');
const CONSTANTS = require('../config/constants');
const userService = require('../user/user.service');

class ReminderService {
    /**
     * Polled every 60 seconds by the cron service
     */
    async processOverdueReminders() {
        if (!supabase) {
            console.warn('[Scheduler] Skipping reminder loop. DB Not Connected.');
            return;
        }

        try {
            console.log('[Scheduler] Checking for pending reminders...');
            const { data: pendingReminders, error } = await supabase
                .from('reminders')
                .select('*, tasks(title, description, user_id, status)')
                .eq('status', 'pending')
                .lte('remind_at', new Date().toISOString());

            if (error) throw error;
            if (!pendingReminders || pendingReminders.length === 0) return;

            for (const reminder of pendingReminders) {
                 // Double check if task is already completed (in case reminders didn't cancel cleanly)
                 if (!reminder.tasks || reminder.tasks.status === 'completed') {
                     await this.markReminderStatus(reminder.id, 'cancelled');
                     continue;
                 }

                 await this._sendReminderMessage(reminder);
            }
        } catch (error) {
            console.error('[Scheduler] Error processing reminders:', error);
        }
    }

    /**
     * Prepares and pushes the reminder out
     */
    async _sendReminderMessage(reminder) {
        try {
            // Fetch User Phone Target
            const task = reminder.tasks;
            const { data: user } = await supabase.from('users').select('phone').eq('id', task.user_id).single();
            if (!user) {
                return await this.markReminderStatus(reminder.id, 'cancelled');
            }

            // Build Message
            let prefix = '⏰ Reminder';
            if (reminder.type === 'escalation') prefix = '🚨 Escalation';
            if (reminder.type === 'followup') prefix = '🔔 Follow Up';

            const messageText = `${prefix}:\n${task.title}\n${task.description ? '\\n' + task.description : ''}`;

            // Send via Output Abstraction
            await outboundAdapter.sendMessage(user.phone, messageText);

            // Update Reminder Attempt Counts
            const newAttemptCount = (reminder.attempt_count || 0) + 1;
            
            if (newAttemptCount >= CONSTANTS.SCHEDULER.MAX_FOLLOWUPS && reminder.type !== 'escalation') {
                 // S-007 / T-006 ESCALATE
                 console.log(`[Scheduler] Reminder ${reminder.id} hit max followups. Escalating...`); // We will add escalation logic later
                 await supabase.from('tasks').update({ status: 'escalated' }).eq('id', reminder.task_id);
                 await this.markReminderStatus(reminder.id, 'cancelled'); // Kill this loop since task is escalated
            } else {
                 await supabase.from('reminders').update({ 
                     status: 'sent', 
                     attempt_count: newAttemptCount 
                 }).eq('id', reminder.id);
            }

        } catch (error) {
            console.error(`[Scheduler] Error sending reminder ${reminder.id}:`, error);
        }
    }

    /**
     * Core update method for reminders 
     */
    async markReminderStatus(reminderId, status) {
        if (!supabase) return;
        return await supabase.from('reminders').update({ status }).eq('id', reminderId);
    }
}

module.exports = new ReminderService();
