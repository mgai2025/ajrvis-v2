const { executeDbQuery, supabase } = require('../shared/db');
const llm = require('../llm/llm.service');

class GoalService {

    /**
     * Phase 1 & 2: Parse raw text into sub-tasks and hold them in quarantine (pending_approval).
     */
    async decomposeAndDraftGoal(userId, rawText) {
        if (!supabase) return { success: false, message: 'DB not connected' };

        // 1. Fire strict explicit extraction to Haiku/Gemini
        const prompt = `
        You are an elite operational Chief of Staff.
        Break down the following complex project into a strict JSON array of 3 to 7 actionable, distinct sub-tasks.
        
        USER PROJECT: "${rawText}"
        CURRENT UTC TIME: ${new Date().toISOString()}

        EXPECTED JSON OUTPUT (No markdown formatting, just the raw array):
        [
          {
            "title": "Clear actionable task",
            "priority": "low|medium|high",
            "relative_due_date_iso": "Optional ISO8601 strictly calculated. E.g. If the party is this weekend, tasks should be due Thursday/Friday. Leave null if not strictly bound to a date."
          }
        ]
        `;

        let plan = [];
        try {
            const rawOutput = await llm._waterfall(prompt);
            const cleanJson = llm._extractJson(rawOutput);
            plan = Array.isArray(cleanJson) ? cleanJson : (cleanJson.tasks || []);
        } catch (e) {
            console.error('[GoalService] Decomposition Failed:', e);
            return { success: false, message: 'I struggled to break that down due to an AI generation error.' };
        }

        if (plan.length === 0) {
            return { success: false, message: 'I couldn\'t extract any meaningful sub-tasks from that.' };
        }

        try {
            // 2. Insert Master Goal Row
            const goalRes = await executeDbQuery(
                supabase.from('goals').insert({
                    user_id: userId,
                    title: rawText,
                    status: 'active'
                }).select('id').single()
            );

            const goalId = goalRes.id;
            let presentationList = '';

            // 3. Quarantine Tasks (pending_approval)
            for (let i = 0; i < plan.length; i++) {
                const step = plan[i];
                await executeDbQuery(
                    supabase.from('tasks').insert({
                        user_id: userId,
                        goal_id: goalId,
                        title: step.title,
                        type: 'simple',
                        status: 'pending_approval',
                        priority: step.priority || 'medium',
                        due_date: step.relative_due_date_iso || null,
                        source_channel: 'system_automation'
                    })
                );
                presentationList += `\n${i + 1}. ${step.title}`;
            }

            return {
                success: true,
                message: `I've drafted a plan for this project. Should I lock these in, or do you want to delete any? Type 'Approve' to confirm.${presentationList}`
            };

        } catch (e) {
            console.error('[GoalService] DB Insertion Error:', e);
            return { success: false, message: 'A database error occurred while staging your drafted goal.' };
        }
    }

    /**
     * Phase 3: Human-in-the-Loop Release
     * Sweeps the user's tasks for 'pending_approval' and upgrades them to active.
     */
    async approveGoalTasks(userId) {
        if (!supabase) return { success: false, message: 'DB not connected' };

        try {
            // Upgrade ALL pending tasks for the user from 'pending_approval' -> 'created'
            const result = await executeDbQuery(
                supabase.from('tasks')
                    .update({ status: 'created' })
                    .eq('user_id', userId)
                    .eq('status', 'pending_approval')
                    .select('id')
            );

            if (!result || result.length === 0) {
                return { success: false, message: `You don't have any pending drafts awaiting approval right now.` };
            }

            return {
                success: true,
                message: `✅ Perfect. I've officially approved and added ${result.length} drafted tasks to your live checklist!`
            };
        } catch (e) {
            console.error('[GoalService] Approval Error:', e);
            return { success: false, message: 'There was an issue approving your draft.' };
        }
    }

}

module.exports = new GoalService();
