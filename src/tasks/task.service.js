const { executeDbQuery, supabase } = require('../shared/db');
const CONSTANTS = require('../config/constants');

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

        // Determine dynamic reminder schedule based on Task duration
        const nowMs = Date.now();
        const dueMs = new Date(dueDate).getTime();
        const diffHours = (dueMs - nowMs) / (1000 * 60 * 60);

        let schedule = CONSTANTS.REMINDER_SCHEDULES.LONG_TERM;
        if (diffHours < 2) schedule = CONSTANTS.REMINDER_SCHEDULES.SHORT_TERM;
        else if (diffHours <= 24) schedule = CONSTANTS.REMINDER_SCHEDULES.DAILY;
        else if (diffHours <= 168) schedule = CONSTANTS.REMINDER_SCHEDULES.MULTI_DAY;

        // Generate Reminders
        await this.generateReminders(newTask.id, new Date(dueDate), schedule);

        return {
            status: 'created',
            task: newTask
        };
    }

    /**
     * Generates reminders based on a pattern of minute offsets relative to the due date
     */
    async generateReminders(taskId, dueDateObj, minutesOffsetArray) {
        if (!supabase) return;
        
        // Safety fallback if the LLM returned a bad date string
        if (isNaN(dueDateObj.getTime())) {
            dueDateObj = new Date();
            dueDateObj.setDate(dueDateObj.getDate() + 1); // fallback to tomorrow
        }

        let reminders = [];
        const now = new Date();
        
        minutesOffsetArray.forEach(offsetMins => {
            const remindAt = new Date(dueDateObj.getTime() + (offsetMins * 60000));
            
            // Only schedule if it's strictly in the future
            if (remindAt >= now) {
                let type = 'pre';
                if (offsetMins === 0) type = 'exact';
                if (offsetMins > 0) type = 'followup';

                reminders.push({
                    task_id: taskId,
                    remind_at: remindAt.toISOString(),
                    type: type,
                    status: 'pending'
                });
            }
        });

        // Ensure at least the final exact deadline reminder exists!
        if (reminders.length === 0 && dueDateObj >= new Date()) {
            reminders.push({
                task_id: taskId,
                remind_at: dueDateObj.toISOString(),
                type: 'exact',
                status: 'pending'
            });
        } else if (reminders.length === 0) {
            // Task is already past due when created (e.g. LLM parsed weirdly or user said "remind me yesterday")
             reminders.push({
                task_id: taskId,
                remind_at: new Date(Date.now() + 60000).toISOString(), // bump to next minute
                type: 'exact',
                status: 'pending'
            });
        }

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

    /**
     * Mark a task as completed and cancel all pending reminders
     */
    async markTaskCompleted(taskId, userId) {
        if (!supabase) return { success: false, message: 'DB not connected' };

        // 1. Mark task as completed
        const { error: taskError } = await supabase
            .from('tasks')
            .update({ status: 'completed' })
            .eq('id', taskId)
            .eq('user_id', userId);

        if (taskError) {
            console.error(`[TaskService] Failed to complete task ${taskId}:`, taskError);
            return { success: false, message: 'Failed to complete task.' };
        }

        // 2. Kill pending reminders for this task
        await supabase
            .from('reminders')
            .update({ status: 'cancelled' })
            .eq('task_id', taskId)
            .eq('status', 'pending');

        return { success: true, message: '✅ Task completed and reminders cancelled.' };
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
