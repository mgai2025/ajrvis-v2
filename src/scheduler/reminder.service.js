const { executeDbQuery, supabase } = require('../shared/db');
const outboundAdapter = require('../gateway/outbound.service');
const CONSTANTS = require('../config/constants');
const userService = require('../user/user.service');
const taskService = require('../tasks/task.service');

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
            const nowISO = new Date().toISOString();
            
            // Step 1: Find Active or Zombie Reminders
            const pendingReminders = await executeDbQuery(supabase
                .from('reminders')
                .select('*, tasks(title, description, user_id, status)')
                .or(`status.eq.pending,and(status.eq.processing,locked_until.lt.${nowISO})`)
                .lte('remind_at', nowISO));

            if (!pendingReminders || pendingReminders.length === 0) return;

            // BUG-014 FIX: Deduplicate redundant backlog reminders
            const latestRemindersMap = new Map();
            const redundantReminderIds = [];

            for (const reminder of pendingReminders) {
                const existing = latestRemindersMap.get(reminder.task_id);
                if (!existing) {
                    latestRemindersMap.set(reminder.task_id, reminder);
                } else {
                    const existingTime = new Date(existing.remind_at).getTime();
                    const currentTime = new Date(reminder.remind_at).getTime();

                    if (currentTime > existingTime) {
                        redundantReminderIds.push(existing.id);
                        latestRemindersMap.set(reminder.task_id, reminder);
                    } else {
                        redundantReminderIds.push(reminder.id);
                    }
                }
            }

            const activeReminders = Array.from(latestRemindersMap.values());

            // Auto-Cancel Redundant Reminders & Log Analytics
            if (redundantReminderIds.length > 0) {
                await executeDbQuery(supabase.from('reminders').update({ status: 'cancelled', locked_until: null }).in('id', redundantReminderIds));
                const logEntries = redundantReminderIds.map(id => ({
                    entity_type: 'reminder',
                    entity_id: id,
                    action: 'superseded_by_backlog',
                    actor: 'system',
                    metadata: { reason: "superseded due to redundancy which happened due to reminders not sent earlier and pending many tasks together" }
                }));
                await executeDbQuery(supabase.from('activity_log').insert(logEntries));
            }

            if (activeReminders.length === 0) return;

            // Step 2: Atomic Lease Locking (Self-Healing)
            const reminderIds = activeReminders.map(r => r.id);
            const lockExpirationDate = new Date(Date.now() + 120000).toISOString(); // +2 minutes
            
            const grabbedReminders = await executeDbQuery(supabase
                .from('reminders')
                .update({ 
                    status: 'processing', 
                    locked_until: lockExpirationDate 
                })
                .in('id', reminderIds)
                .or(`status.eq.pending,locked_until.lt.${nowISO}`)
                .select('*, tasks(title, description, user_id, status)')); // return successfully locked rows

            if (!grabbedReminders || grabbedReminders.length === 0) return; // Another worker stole all of them

            for (const reminder of grabbedReminders) {
                // Double check if task is already completed
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
            const user = await executeDbQuery(supabase.from('users').select('phone').eq('id', task.user_id).single());
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

            // Trigger Recurrence Rules
            if (reminder.type === 'exact') {
                await taskService.spawnNextRecurrence(reminder.task_id);
            }

            // Update Reminder Attempt Counts
            const newAttemptCount = (reminder.attempt_count || 0) + 1;

            if (newAttemptCount >= CONSTANTS.SCHEDULER.MAX_FOLLOWUPS && reminder.type !== 'escalation') {
                // S-007 / T-006 ESCALATE
                console.log(`[Scheduler] Reminder ${reminder.id} hit max followups. Escalating...`); // We will add escalation logic later
                await executeDbQuery(supabase.from('tasks').update({ status: 'escalated' }).eq('id', reminder.task_id));
                await this.markReminderStatus(reminder.id, 'cancelled'); // Kill this loop since task is escalated
            } else {
                await executeDbQuery(supabase.from('reminders').update({
                    status: 'sent',
                    locked_until: null,
                    attempt_count: newAttemptCount
                }).eq('id', reminder.id));
            }

        } catch (error) {
            console.error(`[Scheduler] Error sending reminder ${reminder.id}:`, error);
            // Revert the lock so the next heartbeat can try again
            await this.markReminderStatus(reminder.id, 'pending');
        }
    }

    /**
     * Core update method for reminders 
     */
    async markReminderStatus(reminderId, status) {
        if (!supabase) return;
        return await executeDbQuery(supabase.from('reminders').update({ status, locked_until: null }).eq('id', reminderId));
    }
}

module.exports = new ReminderService();
