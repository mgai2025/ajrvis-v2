const userService = require('../user/user.service');
const onboardingController = require('../user/onboarding.controller');
const llm = require('../llm/llm.service');
const taskService = require('../tasks/task.service');
const providerService = require('../household/provider.service');

class Orchestrator {
    
    /**
     * Primary entry point for all normalized messages
     */
    async routeMessage(inputEvent) {
        console.log(`[Orchestrator] Processing message from ${inputEvent.user_phone}`);

        // 1. Resolve User
        let user = await userService.getUserByPhone(inputEvent.user_phone);

        // DEV TOOL: Reset Profile
        if (inputEvent.raw_text.trim().toLowerCase() === '/reset') {
            if (user && userService.supabase) {
                await userService.supabase.from('users').delete().eq('id', user.id);
            }
            return "Profile hard-reset! Database cleared. Please send 'Hello' to restart the flow.";
        }

        // 2. Check Onboarding State
        if (!user) {
            user = await userService.createUser(inputEvent.user_phone);
            user.onboarding_state = 'new';
        }

        if (user.onboarding_state !== 'complete') {
            const responseText = await onboardingController.processState(user, inputEvent);
            console.log(`[Response -> ${inputEvent.user_phone}]:`, responseText);
            return responseText;
        }

        // 3. User is fully onboarded -> Intent Classification
        const intentResult = await llm.classifyIntent(inputEvent.raw_text, {
            name: user.name
        });

        console.log(`[Orchestrator] Intent parsed:`, JSON.stringify(intentResult, null, 2));

        // Stub routing logic for now
        let msg = '';
        if (intentResult.entities && intentResult.entities.needs_decomposition) {
            console.log(`[Orchestrator] Complex Goal detected. Sending to Decomposition Engine...`);
            const plan = await llm.decomposeGoal(inputEvent.raw_text);
            msg = `Working on it! I've broken this down into ${plan.tasks.length} tasks and will start planning.`;
        } else if (intentResult.intent === 'provider_exception') {
            const providerName = intentResult.entities.provider_name;
            const status = intentResult.entities.status || 'absent';
            const date = intentResult.entities.due_date ? intentResult.entities.due_date.split('T')[0] : null;
            
            if (!providerName) {
                msg = "Please specify which helper you are talking about.";
            } else {
                const result = await providerService.logAttendance(user.id, providerName, date, status);
                msg = result.message;
            }
        } else if (intentResult.intent === 'delegate_provider_task') {
            const providerName = intentResult.entities.provider_name;
            const taskTitle = intentResult.entities.title;
            
            if (!providerName || !taskTitle) {
                msg = "I need to know both the task and who to assign it to (e.g. 'Tell cook to make pasta').";
            } else {
                const result = await providerService.delegateTaskToProvider(user.id, providerName, taskTitle);
                msg = result.message;
            }
        } else if (intentResult.intent === 'create_task') {
            let taskTitle = intentResult.entities.title || 'Untitled Task';
            if (intentResult.entities.amount) {
                taskTitle += ` (Amount: ${intentResult.entities.amount})`;
            }

            const taskData = {
                title: taskTitle,
                due_date: intentResult.entities.due_date, // handled by TaskService if missing
                priority: intentResult.entities.priority
            };
            const result = await taskService.createTask(user.id, taskData);
            
            if (result.status === 'duplicate_warning') {
                msg = result.message;
            } else {
                msg = `Noted. Task "${taskData.title}" created.`;
            }
        } else if (intentResult.intent === 'query_tasks') {
            const taskQueryService = require('../tasks/task-query.service');
            msg = await taskQueryService.queryPendingTasks(user);
        } else if (intentResult.intent === 'approve_action') {
            // "Mark task done" or "Done with XYZ"
            // For now, if they just say "done", we might try to figure out which task
            // V1 simplistic approach: If they say "done with rent", we need the ID. 
            // The LLM extractor should probably fetch tasks too to link them, or we prompt for ID.
            // If they replied to the list, they give a number. 
            const completedTaskTitle = intentResult.entities.title;
            if (completedTaskTitle && typeof completedTaskTitle === 'string') {
                // Fuzzy match task by title
                const pending = await taskService.getUserTasks(user.id);
                const match = pending.find(t => t.title.toLowerCase().includes(completedTaskTitle.toLowerCase()) && t.status !== 'completed');
                if (match) {
                    await taskService.markTaskCompleted(match.id, user.id);
                    msg = `✅ Marked "${match.title}" as completed. Good job!`;
                } else {
                    msg = `I couldn't find a pending task matching "${completedTaskTitle}". Reply "tasks" to see your list.`;
                }
            } else {
                msg = "Please tell me which task you finished (e.g. 'Done with electricity bill').";
            }
        } else if (intentResult.intent === 'conversational' || intentResult.intent === 'out_of_scope' || intentResult.intent === 'unknown') {
            console.log(`[Orchestrator] Engaging Generative Conversational Fallback...`);
            msg = await llm.generateConversationalResponse(inputEvent.raw_text, user);
        } else {
            msg = `I understood this as: ${intentResult.intent}. (Execution engine pending module implementations!)`;
        }

        console.log(`[Response -> ${inputEvent.user_phone}]:`, msg);
        return msg;
    }
}

module.exports = new Orchestrator();
