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
        const timeoutMs = process.env.ORCHESTRATOR_TIMEOUT_MS ? parseInt(process.env.ORCHESTRATOR_TIMEOUT_MS, 10) : 50000;
        return Promise.race([
            this._routeMessageInternal(inputEvent),
            new Promise((_, reject) => setTimeout(() => reject(new Error(`Orchestrator Timeout: Engine took longer than ${timeoutMs}ms`)), timeoutMs))
        ]);
    }

    async _routeMessageInternal(inputEvent) {
        console.log(`[Orchestrator] Processing message from ${inputEvent.user_phone}`);

        // 1. Resolve User
        let user = await userService.getUserByPhone(inputEvent.user_phone);

        // DEV TOOL: Reset Profile and State
        const rawCommand = inputEvent.raw_text.trim();
        
        if (rawCommand.toLowerCase() === '/reset') {
            if (user && userService.supabase) {
                await userService.supabase.from('users').update({ conversation_state: null }).eq('id', user.id);
            }
            return "Got it. I've cleared my active focus and state. What do you need help with?";
        }

        if (rawCommand.toLowerCase() === '/hard-reset') {
            if (user && userService.supabase) {
                await userService.supabase.from('users').update({ conversation_state: 'awaiting_hard_reset_confirm' }).eq('id', user.id);
            }
            return "I'm about to clear my memory of everything we've built—your profile, family setup, provider logs, and all pending tasks. It will be like we're meeting for the first time. 🧹\n\nAre you absolutely sure? Type **'CONFIRM RESET'** to proceed.";
        }

        if (user && user.conversation_state === 'awaiting_hard_reset_confirm') {
            if (rawCommand.toUpperCase() === 'CONFIRM RESET') {
                if (userService.supabase) {
                    await userService.supabase.from('users').delete().eq('id', user.id);
                }
                return "Profile hard-reset! Database cleared. Please send 'Hello' to restart the flow.";
            } else {
                if (userService.supabase) {
                    await userService.supabase.from('users').update({ conversation_state: null }).eq('id', user.id);
                }
                return "Hard reset cancelled. Your data is safe! What do you want to do next?";
            }
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

        // 3. Memory Ingestion (Synapse Log) - FIRE AND FORGET
        const memoryService = require('../memory/memory.service');
        memoryService.logMessage(user.id, inputEvent.raw_text, 'inbound').catch(console.error);

        // 3b. Knowledge Graph Phase 1 Extraction - FIRE AND FORGET
        const kgScanner = require('../knowledge/kg-scanner.service');
        kgScanner.scanInboundMessage(user.id, null, inputEvent.raw_text).catch(console.error);

        // 4. Intent Classification (Hop 1: The Token Saver)
        let intentResult = await llm.classifyIntent(inputEvent.raw_text, {
            name: user.name,
            children: user.children || [],
            providers: user.service_providers || []
        });

        // 5. Context Retrieval Fallback (Hop 2: Intelligence Layer)
        if (llm.evaluateConfidence(intentResult)) {
            console.log(`[Orchestrator] ⚠️ Ambiguous Intent. Triggering Hop 2 (Context Retrieval Expansion)...`);
            const historyText = await memoryService.getShortTermContext(user.id, 5);
            // Fallback natively to Dual-Hop Context window
            intentResult = await llm.classifyIntent(inputEvent.raw_text, { name: user.name }, historyText);
        }

        // 6. EMERGENCY OUTAGE FALLBACK
        if (intentResult.intent === 'unknown' && intentResult.confidence === 0) {
            return "I've hit a bit of a mental block! 🧠 My connection is temporarily fuzzy. Could you please try that again? I want to make sure I get it right.";
        }

        console.log(`[Orchestrator] Final Intent parsed:`, JSON.stringify(intentResult, null, 2));

        // 7. State Machine Interceptor (Rule S-009: Flexible States)
        if (user.conversation_state) {
            const state = typeof user.conversation_state === 'string' ? JSON.parse(user.conversation_state) : user.conversation_state;
            const rawText = inputEvent.raw_text.toLowerCase().trim();

            if (rawText === 'cancel' || rawText === 'stop') {
                if (user && require('../shared/db').supabase) {
                    await require('../shared/db').executeDbQuery(require('../shared/db').supabase.from('users').update({ conversation_state: null }).eq('id', user.id));
                }
                return "Got it. I've cancelled that operation and cleared my focus. What do you need help with instead?";
            }

            // Determine if this is an Answer or a Pivot
            const isConfirmation = ['yes', 'no', 'done', 'yep', 'nope', 'correct', 'agree', 'please', 'anyway'].some(v => rawText.includes(v));
            const isHighConfidencePivot = (intentResult.confidence > 0.85 && intentResult.intent !== 'unknown' && !isConfirmation) || (rawCommand.startsWith('/'));
            
            if (isHighConfidencePivot) {
                console.log(`[Orchestrator] 🔀 Pivot detected! Keeping original state "${state.intent}" in background.`);
                // We proceed with intentResult as-is, skipping state reconstruction
            } else if (intentResult.intent === 'unknown' && intentResult.confidence < 0.4) {
                // If it's pure gibberish, don't force it as an answer, but don't clear the state either!
                console.log(`[Orchestrator] 🧊 Low confidence noise detected. Preserving background state.`);
                return "I'm not sure what you mean. Did you want to say Yes/No to my previous question, or something else?";
            } else {
                // Assume it's an answer to the pending state
                console.log(`[Orchestrator] 📥 Processing response for background state: ${state.intent}`);
                
                intentResult = {
                    intent: state.intent,
                    confidence: 1.0,
                    language: state.language || 'en',
                    entities: { ...state.held_payload }
                };
                
                if (state.missing_entity) {
                    intentResult.entities[state.missing_entity] = inputEvent.raw_text.trim();
                }

                // Clear the lock after successfully routing back to the original handler
                if (user && require('../shared/db').supabase) {
                    await require('../shared/db').executeDbQuery(require('../shared/db').supabase.from('users').update({ conversation_state: null }).eq('id', user.id));
                }
            }
        }

        console.log(`[Orchestrator] Final Intent parsed:`, JSON.stringify(intentResult, null, 2));

        // 6b. Knowledge Graph Context Injection (The Brain)
        const kgRetrieval = require('../knowledge/kg-retrieval.service');
        const kgContext = await kgRetrieval.getFactContextForPrompt(user.id, intentResult);
        if (kgContext) {
            console.log(`[Orchestrator] KNOWLEDGE GRAPH INJECTION ATTACHED!`);
        }

        // 7. Multi-Intent Routing Loop
        const topIntentResult = intentResult;
        const intentsToProcess = topIntentResult.intents || [topIntentResult];
        let msgArray = [];

        for (let i = 0; i < intentsToProcess.length; i++) {
            const intentResult = intentsToProcess[i];
            let msg = '';

            if (intentResult.intent === 'complex_goal' || (intentResult.entities && intentResult.entities.needs_decomposition)) {
                console.log(`[Orchestrator] Complex Goal detected! Handing over to GoalEngine Phase 1...`);
                const goalService = require('../goals/goal.service');
                const result = await goalService.decomposeAndDraftGoal(user.id, inputEvent.raw_text);
                msg = result.message;
            } else if (intentResult.intent === 'provider_exception') {
                const providerName = intentResult.entities.provider_name;
                const status = intentResult.entities.status || 'absent';
                const date = intentResult.entities.due_date ? intentResult.entities.due_date.split('T')[0] : null;

                if (!providerName) {
                    msg = "Please specify which helper you are talking about.";
                } else {
                    const result = await providerService.logAttendance(user.id, providerName, date, status);
                    msg = result.message;

                    // Fire heuristics proactively for any absence
                    if (result.success && status === 'absent' && result.providerRole) {
                        const heuristics = require('../shared/heuristics.service');
                        const language = user.settings?.language || 'hinglish';
                        const suggestion = await heuristics.getAbsenceSuggestion(user.id, result.providerRole, language);
                        
                        if (suggestion) {
                            msg += `\n\n💡 _Suggestion:_ ${suggestion}`;
                        }
                    }

                    // JIT Nudge: Month-end salary reminder
                    const currentDay = new Date().getDate();
                    if (currentDay > 25) {
                        msg += `\n\n*(Reminder: Month end is approaching. Would you like me to calculate ${providerName}'s salary?)*`;
                    }
                }
            } else if (intentResult.intent === 'provider_advance') {
                const advanceService = require('../household/advance.service');
                const providerName = intentResult.entities.provider_name;
                const amount = intentResult.entities.amount;

                if (!providerName || !amount) {
                    msg = "Please specify the helper's name and the exact advance amount in rupees.";
                } else {
                    const result = await advanceService.logAdvance(user.id, providerName, amount, intentResult.entities.reason || 'Cash advance', null);
                    msg = result.message;
                }
            } else if (intentResult.intent === 'calculate_salary') {
                const salaryService = require('../household/salary.service');
                const providerName = intentResult.entities.provider_name;

                if (!providerName) {
                    msg = "Please specify which helper's salary you'd like me to calculate.";
                } else {
                    // We default to the current month in MVP. Later we can add month parsing.
                    const result = await salaryService.calculateSalary(user.id, providerName, null);
                    msg = result.message;
                }
            } else if (intentResult.intent === 'school_event') {
                const schoolService = require('../school/school.service');
                const childName = intentResult.entities.child_name;
                const eventType = intentResult.entities.event_type || 'other';
                const title = intentResult.entities.title;
                const dateStr = intentResult.entities.due_date;

                const result = await schoolService.logEvent(user.id, childName, eventType, title, dateStr);
                msg = result.message;
            } else if (intentResult.intent === 'delegate_provider_task') {
                const providerName = intentResult.entities.provider_name;
                const taskTitle = intentResult.entities.title;

                if (!providerName || !taskTitle) {
                    msg = "I need to know both the task and who to assign it to (e.g. 'Tell cook to make pasta').";
                } else {
                    const result = await providerService.delegateTaskToProvider(user.id, providerName, taskTitle);
                    msg = result.message;
                }
            } else if (intentResult.intent === 'delegate_task') {
                const delegationService = require('../tasks/delegation.service');
                msg = await delegationService.draftDelegation(user, intentResult.entities);
            } else if (intentResult.intent === 'create_task') {
                let taskTitle = intentResult.entities.title || 'Untitled Task';
                if (intentResult.entities.amount) {
                    taskTitle += ` (Amount: ${intentResult.entities.amount})`;
                }

                const taskData = {
                    title: taskTitle,
                    due_date: intentResult.entities.due_date, // handled by TaskService if missing
                    priority: intentResult.entities.priority,
                    force_create: intentResult.entities.force_create, // from the reconstructed intent
                    channel: inputEvent.channel
                };
                const result = await taskService.createTask(user.id, taskData);

                if (result.status === 'duplicate_warning') {
                    msg = result.message;
                    // Add conversation_state logic to support Duplicate Flows with pivoting!
                    const db = require('../shared/db');
                    if (db.supabase) {
                        await db.executeDbQuery(db.supabase.from('users').update({
                            conversation_state: JSON.stringify({
                                intent: 'create_task',
                                held_payload: { ...intentResult.entities, force_create: true }
                            })
                        }).eq('id', user.id));
                    }
                } else {
                    msg = `Noted. Task "${taskData.title}" created.`;
                }
            } else if (intentResult.intent === 'query_tasks') {
                const taskQueryService = require('../tasks/task-query.service');
                msg = await taskQueryService.queryPendingTasks(user);
            } else if (intentResult.intent === 'approve_action') {
                // SPRINT A (Module A4): Task Completion
                // Handle "Mark task done" or numeric reply like "done with 2"

                let targetTaskId = null;
                let targetTitle = null;
                let completedTaskTitle = intentResult.entities.title;
                const raw = inputEvent.raw_text.toLowerCase().trim();

                const taskQueryService = require('../tasks/task-query.service');

                // Heuristic 1: Did they just type a raw number? Or "done with 2"?
                const rawNumberMatch = raw.match(/\b(\d+)\b/);
                if (rawNumberMatch) {
                    const listNum = parseInt(rawNumberMatch[1], 10);
                    const resolvedTask = await taskQueryService.resolveTaskByListNumber(user.id, listNum);
                    if (resolvedTask) {
                        targetTaskId = resolvedTask.id;
                        targetTitle = resolvedTask.title;
                    }
                }

                // Heuristic 2: They gave a text title instead of a number
                if (!targetTaskId && completedTaskTitle && typeof completedTaskTitle === 'string') {
                    const pending = await taskService.getUserTasks(user.id);
                    const match = pending.find(t => t.title.toLowerCase().includes(completedTaskTitle.toLowerCase()) && t.status !== 'completed');
                    if (match) {
                        targetTaskId = match.id;
                        targetTitle = match.title;
                    }
                }

                // Execute Completion
                if (targetTaskId) {
                    const finishResult = await taskService.markTaskCompleted(targetTaskId, user.id);
                    if (finishResult.success) {
                        msg = `✅ Marked "${targetTitle}" as completed. Good job!`;
                    } else {
                        msg = `I had trouble marking that complete. Error check.`;
                    }
                } else {
                    // Heuristic 3 (Fallback): Did they mean to approve a Goal draft?
                    const goalService = require('../goals/goal.service');
                    const result = await goalService.approveGoalTasks(user.id);
                    if (result.success || result.message !== "You don't have any pending drafts awaiting approval right now.") {
                        msg = result.message;
                    } else {
                        msg = "I couldn't figure out exactly which task you finished. Can you try saying the specific title or its exact number from your tasks list?";
                    }
                }
            } else if (intentResult.intent === 'update_settings') {
                const settingName = intentResult.entities.setting_name;
                const settingValue = intentResult.entities.setting_value;
                if (settingName && settingValue) {
                    const currentSettings = user.settings || {};
                    currentSettings[settingName] = settingValue;
                    const userService = require('../user/user.service');
                    await userService.updateUser(user.id, { settings: currentSettings });
                    msg = `✅ Settings updated: ${settingName} is now ${settingValue}.`;
                } else {
                    msg = "I couldn't quite catch the specific setting you want to change. (e.g., 'change my morning brief time to 8am')";
                }
            } else if (intentResult.intent === 'conversational' || intentResult.intent === 'out_of_scope' || intentResult.intent === 'unknown') {
                console.log(`[Orchestrator] Engaging Generative Conversational Fallback...`);
                msg = await llm.generateConversationalResponse(inputEvent.raw_text, user, kgContext);
            } else {
                msg = `I understood this as: ${intentResult.intent}. (Execution engine pending module implementations!)`;
            }

            if (msg) msgArray.push(msg);
        } // End of Multi-Intent Loop

        const finalMsg = msgArray.join('\n\n');
        console.log(`[Response -> ${inputEvent.user_phone}]:`, finalMsg);

        // 8. Store Output in Conversational Memory Buffer - FIRE AND FORGET
        memoryService.logMessage(user.id, finalMsg, 'outbound', {
            intent: topIntentResult ? (topIntentResult.intents ? JSON.stringify(topIntentResult.intents.map(i => i.intent)) : topIntentResult.intent) : 'unknown',
            confidence: topIntentResult ? topIntentResult.confidence : 0
        }).catch(console.error);

        return finalMsg;
    }
}

module.exports = new Orchestrator();
