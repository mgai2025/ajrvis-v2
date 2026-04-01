const { supabase, executeDbQuery } = require('../shared/db');
const CONSTANTS = require('../config/constants');
const outboundAdapter = require('../gateway/outbound.service');
const taskService = require('./task.service');

class DelegationService {
    /**
     * SPRINT 2: Drafts a delegated task and sends a deep-link to the assignee.
     */
    async draftDelegation(primaryUser, payload) {
        if (!supabase) return "Database not connected. Cannot delegate tasks.";

        const assigneeName = payload.assignee_name;
        if (!assigneeName) {
            return "Who would you like me to assign this to? (e.g., 'Ask Mohit to...')";
        }

        // 1. Find the secondary user in family_relationships
        let relationshipsOpt = [];
        try {
            relationshipsOpt = await executeDbQuery(
                supabase.from('family_relationships')
                    .select('secondary_user_id, users!secondary_user_id(id, name, phone)')
                    .eq('primary_user_id', primaryUser.id)
                    .eq('status', 'active')
            );
        } catch (e) {
            console.warn('[Delegation] Relationship table query failed (skipping family lookup):', e.message);
            // Fallback: targetUser remains null, triggering Open-Loop logic
        }

        let targetUser = null;
        if (relationshipsOpt && relationshipsOpt.length > 0) {
            // Fuzzy match name
            const match = relationshipsOpt.find(r => 
                r.users && r.users.name && 
                r.users.name.toLowerCase().includes(assigneeName.toLowerCase())
            );
            if (match) targetUser = match.users;
        }

        // 2. Create the drafted task (allow null assignee for open-loop delegation)
        const taskData = {
            user_id: primaryUser.id,
            title: payload.title,
            type: 'delegated',
            status: 'pending_acceptance', // Not active until accepted
            priority: payload.priority || 'medium',
            due_date: payload.due_date || null,
            assigned_to: targetUser ? targetUser.id : null,
            source_channel: 'system_automation'
        };

        const newTaskArray = await executeDbQuery(
            supabase.from('tasks').insert([taskData]).select()
        );
        const newTask = newTaskArray && newTaskArray.length > 0 ? newTaskArray[0] : null;

        if (!newTask) return "Failed to create the delegation task in the database.";

        // 3. Generate Deep Link
        const deepLink = `${CONSTANTS.BOT_LINKS.TELEGRAM_BASE}delegate_${newTask.id}`;

        // 4. Notify Assignee directly or fallback to Mom
        if (targetUser && targetUser.phone) {
            const assigneeMessage = `👋 Hi ${targetUser.name}, ${primaryUser.name} has asked if you can handle a task:\n\n👉 *${newTask.title}*\n\nTap here to Accept: ${deepLink}`;
            try {
                await outboundAdapter.sendMessage(targetUser.phone, assigneeMessage);
                return `✅ Perfect. I've sent a task request to ${targetUser.name}. I'll let you know when they accept it!`;
            } catch (e) {
                console.error('[Delegation] Failed to send outbound to assignee:', e);
            }
        }
        
        // Fallback or Open-Loop: Give link to Mom to forward
        const nameToUse = targetUser ? targetUser.name : assigneeName;
        return `I've created the task for ${nameToUse}. Since they aren't fully set up in my system yet, please forward them this link to accept it:\n\n${deepLink}`;
    }

    /**
     * SPRINT 2: Handles the deep-link click when the spouse accepts the task.
     */
    async acceptDelegation(assigneeUser, taskId) {
        if (!supabase) return "Database not connected.";

        // Verify task exists and is pending
        const taskOpt = await executeDbQuery(
            supabase.from('tasks').select('*, users!user_id(name)').eq('id', taskId).single()
        );

        if (!taskOpt) return "I couldn't find that task. It may have been deleted.";
        if (taskOpt.status !== 'pending_acceptance') {
            if (taskOpt.status === 'scheduled' || taskOpt.status === 'in_progress') {
                return "You've already accepted this task!";
            }
            return `This task is no longer pending (Current status: ${taskOpt.status}).`;
        }

        // Verify authorization (allow if null for open-loop claimers)
        if (taskOpt.assigned_to !== null && taskOpt.assigned_to !== assigneeUser.id) {
            return "This task wasn't assigned to you, so you cannot accept it.";
        }

        // Update task to active and assign to the user who claimed it
        await executeDbQuery(
            supabase.from('tasks').update({ 
                status: 'scheduled',
                assigned_to: assigneeUser.id 
            }).eq('id', taskId)
        );

        // Calculate dynamic reminder schedule based on deadline
        let scheduleConfig = CONSTANTS.REMINDER_SCHEDULES.DAILY;
        
        if (taskOpt.due_date) {
            const msUntilDue = new Date(taskOpt.due_date) - new Date();
            const hoursUntilDue = msUntilDue / (1000 * 60 * 60);
            
            if (hoursUntilDue > 0 && hoursUntilDue < 24) {
                // SPRINT 2 DYNAMIC LOGIC: If < 24h, use aggressive compressed follow-ups (Rule enforced)
                scheduleConfig = CONSTANTS.DELEGATION_REMINDER_SCHEDULES.URGENT_24H;
            } else {
                scheduleConfig = CONSTANTS.DELEGATION_REMINDER_SCHEDULES.STANDARD;
            }
        }

        // Generate reminders using the dynamic schedule
        const taskService = require('./task.service'); // lazy load to prevent circular dependencies
        if (taskOpt.due_date) {
            await taskService.generateReminders(taskOpt.id, new Date(taskOpt.due_date), scheduleConfig);
        }

        // Notify primary user
        try {
            const primaryPhoneOpts = await executeDbQuery(
                supabase.from('users').select('phone').eq('id', taskOpt.user_id).single()
            );
            if (primaryPhoneOpts && primaryPhoneOpts.phone) {
                await outboundAdapter.sendMessage(
                    primaryPhoneOpts.phone, 
                    `✅ *Update:* ${assigneeUser.name} has accepted the task: "${taskOpt.title}".`
                );
            }
        } catch (e) {
            console.error('[Delegation] Failed to notify primary user:', e);
        }

        return `✅ Task Accepted: "${taskOpt.title}". I've added it to your schedule and notified ${taskOpt.users?.name || 'them'}.`;
    }
}

module.exports = new DelegationService();
