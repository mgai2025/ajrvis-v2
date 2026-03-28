const { supabase } = require('../shared/db');

class TaskQueryService {
    /**
     * Build the morning brief text for a user
     */
    async buildMorningBrief(user) {
        if (!supabase) return "Good morning! (Offline mode)";

        const today = new Date();
        today.setHours(0,0,0,0);
        
        const tonight = new Date();
        tonight.setHours(23,59,59,999);

        // Fetch tasks
        const { data: tasks } = await supabase
            .from('tasks')
            .select('*')
            .eq('user_id', user.id)
            .in('status', ['scheduled', 'in_progress', 'missed'])
            .order('due_date', { ascending: true });

        const overdue = tasks.filter(t => new Date(t.due_date) < today && t.status !== 'completed');
        const dueToday = tasks.filter(t => new Date(t.due_date) >= today && new Date(t.due_date) <= tonight);

        if (overdue.length === 0 && dueToday.length === 0) {
            return `Good morning, ${user.name}! ✅ All clear today. Have a great day!`;
        }

        let msg = `🌅 Good morning ${user.name}! Here is your brief:\n\n`;

        if (dueToday.length > 0) {
            msg += `📅 TODAY:\n`;
            dueToday.forEach((t, i) => msg += ` ${i+1}. ${t.title}\n`);
            msg += `\n`;
        }

        if (overdue.length > 0) {
            msg += `🚨 PENDING / OVERDUE:\n`;
            overdue.forEach((t, i) => msg += ` ${dueToday.length + i + 1}. ${t.title}\n`);
            msg += `\n`;
        }

        msg += `Reply with the task number or title to mark it done.`;
        return msg;
    }

    /**
     * Formats pending tasks when user asks "what is pending?"
     */
    async queryPendingTasks(user) {
        if (!supabase) return "You have no pending tasks. (Offline mode)";

        const { data: tasks } = await supabase
            .from('tasks')
            .select('*')
            .eq('user_id', user.id)
            .in('status', ['scheduled', 'in_progress', 'missed'])
            .order('due_date', { ascending: true });

        if (!tasks || tasks.length === 0) {
            return "You have no pending tasks right now!";
        }

        let msg = `📋 Here are your pending tasks:\n`;
        tasks.forEach((t, i) => {
            const isOverdue = new Date(t.due_date) < new Date() ? ' (Overdue 🚨)' : '';
            msg += ` ${i+1}. ${t.title}${isOverdue}\n`;
        });
        
        return msg;
    }
}

module.exports = new TaskQueryService();
