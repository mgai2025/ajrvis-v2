const { executeDbQuery, supabase } = require('../shared/db');

class TaskService {
    
    /**
     * Creates a new simple task
     * Applies Rule T-001 (default to 6pm or tomorrow 9am if no due date)
     */
    async createTask(userId, taskData) {
        if (!supabase) return this._mockCreateTask(userId, taskData);

        // Apply Generic Rule T-001
        let dueDate = taskData.due_date;
        if (!dueDate) {
            const now = new Date();
            const sixPM = new Date(now);
            sixPM.setHours(18, 0, 0, 0);

            if (now > sixPM) {
                // Next morning 9am
                const tomorrow9AM = new Date(now);
                tomorrow9AM.setDate(tomorrow9AM.getDate() + 1);
                tomorrow9AM.setHours(9, 0, 0, 0);
                dueDate = tomorrow9AM.toISOString();
            } else {
                // Same day 6pm
                dueDate = sixPM.toISOString();
            }
        }

        // Apply Generic Rule T-002: Check for duplicates within 24h
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        
        const duplicateCheck = await executeDbQuery(
            supabase.from('tasks')
                .select('*')
                .eq('user_id', userId)
                .eq('title', taskData.title)
                .gte('created_at', yesterday.toISOString())
        );

        if (duplicateCheck && duplicateCheck.length > 0 && !taskData.force_create) {
            return {
                status: 'duplicate_warning',
                taskId: duplicateCheck[0].id,
                message: `This looks like a duplicate of a recent task ("${taskData.title}"). Create anyway?`
            };
        }

        // Insert new task
        const newTask = await executeDbQuery(
            supabase.from('tasks').insert([{
                user_id: userId,
                title: taskData.title,
                priority: taskData.priority || 'medium',
                due_date: dueDate,
                type: 'simple',
                status: 'scheduled'
            }]).select().single()
        );

        // Generate Reminders
        await this.generateReminders(newTask.id, new Date(dueDate), taskData.reminder_pattern || [1, 0]);

        return {
            status: 'created',
            task: newTask
        };
    }

    /**
     * Generates reminders based on a pattern of days before the due date
     */
    async generateReminders(taskId, dueDateObj, daysBeforeArray) {
        if (!supabase) return;
        
        // Safety fallback if the LLM returned a bad date string
        if (isNaN(dueDateObj.getTime())) {
            dueDateObj = new Date();
            dueDateObj.setDate(dueDateObj.getDate() + 1); // fallback to tomorrow
        }

        const reminders = daysBeforeArray.map(days => {
            const remindAt = new Date(dueDateObj);
            remindAt.setDate(remindAt.getDate() - days);
            
            // If the reminder date is in the past, default to now + 5 mins
            if (remindAt < new Date()) {
                remindAt.setTime(new Date().getTime() + 5 * 60000);
            }

            return {
                task_id: taskId,
                remind_at: remindAt.toISOString(),
                type: 'pre',
                status: 'pending'
            };
        });

        await executeDbQuery(supabase.from('reminders').insert(reminders));
    }

    /**
     * Retrieve tasks for user
     */
    async getUserTasks(userId, dateFilter = null) {
        if (!supabase) return [];

        let query = supabase.from('tasks').select('*').eq('user_id', userId).order('due_date', { ascending: true });
        
        if (dateFilter) {
            // E.g., filter for 'today'
            const startOfDay = new Date(dateFilter);
            startOfDay.setHours(0,0,0,0);
            const endOfDay = new Date(dateFilter);
            endOfDay.setHours(23,59,59,999);
            
            query = query.gte('due_date', startOfDay.toISOString()).lte('due_date', endOfDay.toISOString());
        }

        return await executeDbQuery(query);
    }

    /**
     * Check and isolate overdue tasks (T-003)
     */
    async markMissedTasks() {
        if (!supabase) return;

        // Implementation for the Scheduler to call. Tasks older than 2x due_date window.
        // Simplification for V1 milestone: marking anything past due by 2 days as missed.
        const twoDaysAgo = new Date();
        twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

        const overdue = await executeDbQuery(
            supabase.from('tasks')
                .update({ status: 'missed' })
                .lt('due_date', twoDaysAgo.toISOString())
                .in('status', ['scheduled', 'in_progress'])
                .select()
        );

        if (overdue && overdue.length > 0) {
            console.log(`Marked ${overdue.length} tasks as missed.`);
            // In a full implementation, we log this to activity_log
        }
    }

    _mockCreateTask(userId, taskData) {
        console.log(`[Mock DB] Created Task for ${userId}: ${taskData.title}`);
        return {
            status: 'created',
            task: {
                id: 'mock-task-' + Date.now(),
                title: taskData.title,
                due_date: new Date().toISOString()
            }
        };
    }
}

module.exports = new TaskService();
