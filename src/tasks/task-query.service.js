const taskService = require('./task.service');

class TaskQueryService {
    /**
     * SPRINT A (Module A2): Task Query Handler
     * Handles intents like "What's pending?" or "Show my tasks"
     */
    async queryPendingTasks(user) {
        if (!user || (!user.id && !user.user_id)) return "User ID not found.";
        const userId = user.id || user.user_id;
        const timeZone = (user.settings && user.settings.timezone) ? user.settings.timezone : 'Asia/Kolkata';

        try {
            const allTasks = await taskService.getUserTasks(userId);
            if (!allTasks || allTasks.length === 0) {
                return "🎉 You have no pending tasks right now. You're all caught up!";
            }

            const activeTasks = allTasks.filter(t => ['scheduled', 'in_progress', 'pending_acceptance'].includes(t.status));
            if (activeTasks.length === 0) {
                return "You have tasks in your history, but absolutely nothing currently pending. Enjoy your day!";
            }

            // 1. Get the unified sorted list from the helper
            const { myTasks, delegated, assigned, flattenedList } = this._buildSortedTaskList(userId, activeTasks);

            // 2. Format the display
            let msg = `📋 **Your Task Dashboard**\n\n`;
            let counter = 1;

            if (myTasks.length > 0) {
                msg += `📋 *MY TASKS:*\n`;
                myTasks.forEach(t => {
                    const dueStr = t.due_date ? ` — due ${this._formatUrgency(t.due_date, timeZone)}` : '';
                    msg += `  ${counter}. ${t.title}${dueStr}\n`;
                    counter++;
                });
                msg += `\n`;
            }

            if (delegated.length > 0) {
                msg += `📤 *DELEGATED* (waiting on others):\n`;
                delegated.forEach(t => {
                    const assigneeName = (t.assignee && t.assignee.name) ? t.assignee.name : 'Someone';
                    const statusStr = t.status === 'pending_acceptance' ? '⏳ Pending' : '✅ Accepted';
                    msg += `  ${counter}. ${t.title} → ${assigneeName} — ${statusStr}\n`;
                    counter++;
                });
                msg += `\n`;
            }

            if (assigned.length > 0) {
                msg += `📥 *ASSIGNED TO ME* (by others):\n`;
                assigned.forEach(t => {
                    const ownerName = (t.owner && t.owner.name) ? t.owner.name : 'Someone';
                    const dueStr = t.due_date ? ` — due ${this._formatUrgency(t.due_date, timeZone)}` : '';
                    msg += `  ${counter}. ${t.title} ← ${ownerName}${dueStr}\n`;
                    counter++;
                });
            }

            msg += `\n💡 Reply "done with 1" or "mark 2 complete" to check these off!`;
            return msg;

        } catch (e) {
            console.error('[Task Query Service] Failed to retrieve tasks:', e);
            return "Sorry, I ran into an error pulling up your tasks. Please try again in an hour.";
        }
    }

    /**
     * SPRINT A (Module A4): Task Completion via Numbered List
     * Resolves a numeric index (e.g. "done with 2") back to its database Task ID
     * by perfectly replicating the display sort order.
     */
    async resolveTaskByListNumber(userId, listNumber) {
        if (!userId || isNaN(listNumber) || listNumber < 1) return null;

        try {
            const allTasks = await taskService.getUserTasks(userId);
            if (!allTasks) return null;

            const activeTasks = allTasks.filter(t => ['scheduled', 'in_progress', 'pending_acceptance'].includes(t.status));
            if (activeTasks.length === 0) return null;

            // Use the exact same helper to guarantee index match
            const { flattenedList } = this._buildSortedTaskList(userId, activeTasks);

            if (listNumber <= flattenedList.length) {
                return flattenedList[listNumber - 1];
            }
            return null;
        } catch (e) {
            console.error('[Task Query Service] Failed to resolve task number:', e);
            return null;
        }
    }

    /**
     * Helper: Buckets and sorts tasks, returning both the buckets and the sequential flattened array.
     */
    _buildSortedTaskList(userId, activeTasks) {
        // Chronological sort applied natively by DB, but we maintain bucket groups
        // We limit regular 'upcoming' tasks, but keep all overdue/today.
        
        let myTasksRaw = [];
        let delegatedRaw = [];
        let assignedRaw = [];

        activeTasks.forEach(t => {
            const isOwner = t.user_id === userId;
            const isAssignee = t.assigned_to === userId;

            if (isOwner && isAssignee) {
                // Task I created for myself
                myTasksRaw.push(t);
            } else if (isOwner && t.assigned_to && !isAssignee) {
                // Task I created for someone else
                delegatedRaw.push(t);
            } else if (isAssignee && !isOwner) {
                // Task someone else created for me
                assignedRaw.push(t);
            } else if (isOwner) {
                // Fallback for owner-only tasks (older schema)
                myTasksRaw.push(t);
            }
        });

        // Simply order each bucket chronologically (already DB ordered)
        // Flatten into a single array mapping 1:1 with the rendered counter integers
        const flattenedList = [...myTasksRaw, ...delegatedRaw, ...assignedRaw];

        return {
            myTasks: myTasksRaw,
            delegated: delegatedRaw,
            assigned: assignedRaw,
            flattenedList
        };
    }

    _formatUrgency(isoString, timeZone = 'Asia/Kolkata') {
        const due = new Date(isoString);
        const now = new Date();
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const getLocaleDate = (d) => d.toLocaleDateString('en-US', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric' });

        if (due < now) return '*OVERDUE*';
        if (getLocaleDate(due) === getLocaleDate(now)) return `today at ${this._formatTime(isoString, timeZone)}`;
        if (getLocaleDate(due) === getLocaleDate(tomorrow)) return `tomorrow at ${this._formatTime(isoString, timeZone)}`;
        return this._formatDate(isoString, timeZone);
    }

    /**
     * Helper to get user-local date parts
     */
    _getUserLocalTimeParts(dateObj, timeZone) {
        const formatter = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit' });
        const parts = formatter.formatToParts(dateObj);
        const p = {};
        parts.forEach(part => p[part.type] = part.value);
        return {
            dateStr: `${p.year}-${p.month}-${p.day}`,
            hour: parseInt(p.hour, 10),
            dayOfMonth: parseInt(p.day, 10)
        };
    }

    /**
     * BUG-006 FIX: Morning Brief Builder
     * Returns a rich, concise morning message for the primary user.
     */
    async buildMorningBrief(user) {
        const userId = user.id || user.user_id;
        const name = user.name || 'there';
        const timeZone = (user.settings && user.settings.timezone) ? user.settings.timezone : 'Asia/Kolkata';
        const now = new Date();
        const localNow = this._getUserLocalTimeParts(now, timeZone);

        let sections = [];

        // 1. Greeting
        const greeting = localNow.hour < 12 ? 'Good morning' : localNow.hour < 17 ? 'Good afternoon' : 'Good evening';
        sections.push(`${greeting} ${name}! ☀️ Here's your daily brief:\n`);

        // 2. Today's tasks + overdue
        try {
            const allTasks = await taskService.getUserTasks(userId);
            const active = (allTasks || []).filter(t => t.status === 'scheduled' || t.status === 'in_progress');

            const overdue = active.filter(t => new Date(t.due_date) < now);
            const todayTasks = active.filter(t => {
                const isOverdue = new Date(t.due_date) < now;
                const taskLocal = this._getUserLocalTimeParts(new Date(t.due_date), timeZone);
                return !isOverdue && taskLocal.dateStr === localNow.dateStr;
            });

            if (overdue.length > 0) {
                sections.push(`🛑 *OVERDUE (${overdue.length} items):*`);
                overdue.slice(0, 3).forEach(t => sections.push(`  • ${t.title}`));
                if (overdue.length > 3) sections.push(`  ...and ${overdue.length - 3} more`);
            }

            if (todayTasks.length > 0) {
                sections.push(`📅 *TODAY:*`);
                todayTasks.slice(0, 5).forEach(t => sections.push(`  • ${t.title} (by ${this._formatTime(t.due_date, timeZone)})`));
            }

            if (overdue.length === 0 && todayTasks.length === 0) {
                sections.push(`✅ No tasks due today. Clear day ahead!`);
            }
        } catch (e) {
            console.error('[MorningBrief] Error fetching tasks:', e);
        }

        // 3. Month-end salary prompt (if 28th-31st of month)
        if (localNow.dayOfMonth >= 28) {
            sections.push(`\n💰 *Month-End Reminder:* Run "calculate salary" for your helpers for this month.`);
        }

        sections.push(`\nReply *"tasks"* to see the full list. Have a great day!`);

        return sections.join('\n');
    }

    _formatTime(isoString, timeZone = 'Asia/Kolkata') {
        const d = new Date(isoString);
        return d.toLocaleString('en-IN', { timeZone, hour: '2-digit', minute: '2-digit' });
    }

    _formatDate(isoString, timeZone = 'Asia/Kolkata') {
        const d = new Date(isoString);
        return d.toLocaleDateString('en-US', { timeZone, weekday: 'short', month: 'short', day: 'numeric' });
    }
}

module.exports = new TaskQueryService();
