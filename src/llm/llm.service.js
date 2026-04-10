const { GoogleGenerativeAI } = require('@google/generative-ai');
const Anthropic = require('@anthropic-ai/sdk');

/**
 * Service to orchestrate interactions with LLMs (Claude & Gemini).
 * Utilizing an elite Architectural Waterfall: Claude 3.5 -> Gemini 2.5 Pro -> Gemini 1.5 Flash
 */
class LLMService {
    constructor() {
        this.provider = process.env.LLM_PROVIDER || 'mixed';
        this.isDevMode = process.env.DEVELOPMENT_MODE === 'true';

        const geminiApiKey = process.env.GEMINI_API_KEY;
        const anthropicApiKey = process.env.ANTHROPIC_API_KEY;

        // Initialize Gemini
        if (geminiApiKey) {
            this.genAI = new GoogleGenerativeAI(geminiApiKey);
            this.geminiPro = this.genAI.getGenerativeModel({ model: "gemini-1.5-pro" });
            this.geminiFlash = this.genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        } else {
            console.warn('GEMINI_API_KEY is not set in .env. Gemini Fallbacks disabled.');
        }

        // Initialize Claude
        if (anthropicApiKey && anthropicApiKey !== 'your_anthropic_key') {
            this.anthropic = new Anthropic({ apiKey: anthropicApiKey });
            this.claudeSonnet = "claude-3-5-sonnet-20241022";
            this.claudeHaiku = process.env.CLAUDE_HAIKU_ID || "claude-3-haiku-20240307";
        } else {
            console.warn('ANTHROPIC_API_KEY is not set. Claude Engine disabled.');
        }
    }

    /**
     * Unifies the prompt generation for Claude models
     */
    async _callClaude(prompt, modelId) {
        if (!this.anthropic) throw new Error("Claude SDK not instantiated.");
        const msg = await this.anthropic.messages.create({
            model: modelId,
            max_tokens: 1024,
            messages: [{ role: "user", content: prompt }]
        });
        return msg.content[0].text.trim();
    }

    /**
     * Unifies the prompt generation for Google Gemini models
     */
    async _callGemini(prompt, modelType) {
        if (!this.genAI) throw new Error("Gemini SDK not instantiated.");
        const targetModel = modelType === 'gemini-1.5-flash' ? this.geminiFlash : this.geminiPro;
        const result = await targetModel.generateContent(prompt);
        return result.response.text().trim();
    }

    /**
     * The Master Architectural Waterfall.
     * In Dev Mode: Haiku -> Flash -> Pro -> Sonnet (Fastest/Cheapest First)
     * In Prod Mode: Sonnet -> Pro -> Flash (Smartest First)
     */
    async _waterfall(prompt) {
        const queue = this.isDevMode 
            ? [
                { id: 'haiku', type: 'claude', name: this.claudeHaiku },
                { id: 'flash', type: 'gemini', name: 'gemini-1.5-flash' },
                { id: 'pro', type: 'gemini', name: 'gemini-1.5-pro' },
                { id: 'sonnet', type: 'claude', name: this.claudeSonnet }
              ]
            : [
                { id: 'sonnet', type: 'claude', name: this.claudeSonnet },
                { id: 'pro', type: 'gemini', name: 'gemini-1.5-pro' },
                { id: 'flash', type: 'gemini', name: 'gemini-1.5-flash' }
              ];

        for (const model of queue) {
            const startTime = Date.now();
            try {
                console.log(`[LLM Waterfall] Attempting ${model.id} (${model.name})...`);
                
                const timeoutPromise = new Promise((_, reject) =>
                    setTimeout(() => reject(new Error(`${model.id} model-level timeout (15s)`)), 15000)
                );
                
                let actualCall;
                if (model.type === 'claude') actualCall = this._callClaude(prompt, model.name);
                if (model.type === 'gemini') actualCall = this._callGemini(prompt, model.name);
                
                const result = await Promise.race([actualCall, timeoutPromise]);
                
                this._logTelemetry(model.id, model.name, Date.now() - startTime, true);
                return result;
            } catch (e) {
                this._logTelemetry(model.id, model.name, Date.now() - startTime, false, e.message);
                console.warn(`[LLM Waterfall] ${model.id} Request Failed (${e.message}). Falling back...`);
            }
        }

        console.error("[LLM Waterfall] TOTAL OUTAGE. All engines in the queue failed.");
        throw new Error("Waterfall Depletion");
    }

    /**
     * The unified intent classification model
     */
    async classifyIntent(text, userContext = {}, historyContext = null) {
        if (!this.genAI && !this.anthropic) {
            return this._mockIntent(text);
        }

        const historyBlock = historyContext ? `\nCONVERSATIONAL HISTORY:\n${historyContext}\nCRITICAL: Use the history above to resolve ambiguous pronouns ('it', 'that') in the User Message.` : '';

        const prompt = `SYSTEM: You are Ajrvis, a highly intelligent Chief of Staff AI managing an Indian household...
CURRENT UTC TIME: ${new Date().toISOString()}
USER TIMEZONE: ${userContext.settings?.timezone || 'Asia/Kolkata'}
${historyBlock}

VALID INTENTS: create_task | create_event | add_provider | provider_exception | delegate_provider_task | delegate_task | provider_advance | calculate_salary | school_event | complex_goal | query_tasks | query_providers | approve_action | reject_action | cancel_task | update_settings | calendar_link | calendar_sync | conversational | out_of_scope

INTENT MAPPING RULES:
- 'calendar_link': Use when user asks to connect, link, or sync their google calendar.
- 'calendar_sync': Use when user asks to push or sync existing tasks to their calendar.
- 'delegate_provider_task': Use when telling a domestic worker to do something (e.g. "Tell cook to make pasta").
- 'delegate_task': Use strictly when assigning a personal task to a family member or spouse (e.g. "Ask Mohit to pick up Kynaa", "Tell Rahul to pay rent").
- 'school_event': Strictly for administrative school tracking (e.g. exams, parent-teacher meetings, school fees). DO NOT use for birthdays or parties.
- 'complex_goal': For broad, multi-step ambiguous projects (e.g. "Plan a birthday party", "Organize a trip"). These require breaking down into actionable tasks.
- 'approve_action': Strictly use this when the user says they have COMPLETED a task, e.g., "done with 1", "marked X complete", "finished the rent". Do NOT use cancel_task for completed tasks.
- 'update_settings': Use when the user explicitly wants to change a preference, like "Change my morning brief to 8 AM" or "Switch my language to English".
- MULTI-TASKING: Users often send multiple tasks in a single message (e.g. "Remind me to call mom, and also tell the cook to make dal"). Output ALL detected intents as an array.
- CONFIDENCE PENALTY: If the user uses an ambiguous contextual pronoun ("make that 5pm", "call him") and you CANNOT resolve the noun naturally, you MUST purposefully downgrade your 'confidence' score below 0.60.

INJECTED CONTEXT: 
User Name: ${userContext.name || 'Unknown'}
Children: ${JSON.stringify(userContext.children || [])}
Domestic Providers: ${JSON.stringify(userContext.providers || [])}

Given the following message from the user, output exactly a JSON object defining an array of intents.
DO NOT use markdown backticks in the final output. Pure raw JSON exclusively.

USER MESSAGE: "${text}"

EXPECTED FORMAT:
{
  "intents": [
    {
      "intent": "...",
      "confidence": 0.0,
      "language": "...",
      "entities": {
        "title": "Clear actionable task title (e.g., 'Call Nitika')",
        "due_date": "ISO8601 timestamp STRICTLY CALCULATED from 'CURRENT UTC TIME' if relative time given (e.g., 'in 2 minutes')",
        "priority": "low|medium|high",
        "provider_name": "...",
        "assignee_name": "Name of the family member to assign task to (e.g., 'Mohit')",
        "amount": 0,
        "child_name": "...",
        "event_type": "ptm|exam|fee|holiday|activity|other",
        "setting_name": "morning_brief_time|language|timezone",
        "setting_value": "..."
      }
    }
  ]
}
CRITICAL INSTRUCTION: If user specifies relative time (e.g., "in 2 minutes", "tomorrow at 9 PM"), you MUST calculate the exact ISO8601 timestamp factoring in the USER TIMEZONE and the CURRENT UTC TIME. Do NOT output relative phrases. If no time/date is specified, leave due_date as null.`;

        try {
            const rawOutput = await this._waterfall(prompt);
            return this._extractJson(rawOutput);
        } catch (e) {
            console.error("LLM Intent Classification Exception:", e);
            return { intents: [{ intent: 'unknown', confidence: 0, language: 'en', entities: {} }] };
        }
    }

    /**
     * Goal Decomposition (Sprint 2 - Complex Task Planning)
     */
    async breakDownGoal(goalText) {
        if (!this.genAI && !this.anthropic) return [];

        const prompt = `SYSTEM: You break down complex household or parenting goals into a sequence of 3 to 7 specific, actionable sub-tasks.
Return exactly a RAW JSON array of objects. No markdown ticks.
Format: [{"title": "task title", "deadline_offset_days": number_or_null, "priority": "high|medium|low", "assignee_type": "user|provider"}]

GOAL: "${goalText}"`;

        try {
            const rawOutput = await this._waterfall(prompt);
            return this._extractJson(rawOutput);
        } catch (e) {
            console.error("LLM Goal Breakdown Error:", e);
            return [];
        }
    }

    /**
     * Extracts Family or Provider profiles during Onboarding
     */
    async extractEntities(text, type) {
        if (!this.genAI && !this.anthropic) return [];

        let prompt = '';
        if (type === 'family') {
            prompt = `SYSTEM: You extract family members from text. Output STRICTLY a RAW JSON array of objects. No markdown formatting. [{"name": "name", "role": "spouse|child|parent", "age": null_or_number}]\nUSER: "${text}"`;
        } else if (type === 'provider') {
            prompt = `SYSTEM: You extract household helpers and service providers from text. Output STRICTLY a RAW JSON array of objects. No markdown formatting. [{"name": "name", "role": "exact_role_mentioned_like_cook_nanny_doctor_teacher"}]\nUSER: "${text}"`;
        } else if (type === 'name') {
            prompt = `SYSTEM: You extract the user's explicit real name from text. Output STRICTLY a RAW JSON object. No markdown formatting. {"name": "Cleaned First & Last Name"}\nUSER: "${text}"`;
        }

        try {
            const rawOutput = await this._waterfall(prompt);
            return this._extractJson(rawOutput);
        } catch (e) {
            console.error(`LLM Entity Extraction Error (${type}):`, e);
            return type === 'name' ? { name: text } : [];
        }
    }

    /**
     * Sprint F (Phase 2): Knowledge Graph Nightly Distillation
     * Evaluates a batch of fuzzy low-confidence regex extractions.
     * Returns a JSON array of validated facts with their corrected confidence.
     */
    async evaluateKnowledgeBatch(factBatch) {
        if (!this.genAI && !this.anthropic) return [];
        if (!factBatch || factBatch.length === 0) return [];

        // Compile batch string for prompt
        const batchString = factBatch.map(f => 
            `[ID: ${f.id}] text: "${f.raw_snippet}", subject: "${f.subject_extracted}", detail: "${f.detail_extracted}", candidate_table: ${f.candidate_table}`
        ).join('\n');

        const prompt = `SYSTEM: You are an analytical engine for a Knowledge Graph.
I am passing you a batch of raw sentences flagged by basic heuristics. Your job is to read the sentence, evaluate the semantic truth, and assign a firm confidence score (0.0 to 1.0).

RULES:
1. If the user states a fact definitively (e.g. "Kynaa hates broccoli"), confidence > 0.90.
2. If the user states a temporal/situational observation (e.g. "Kynaa didn't eat broccoli today"), confidence < 0.60.
3. You may re-write the "detail" to be cleaner and more standardized.
4. Output EXACTLY a RAW JSON array of objects. No markdown ticks \`\`\`.

FORMAT OUTPUT:
[{"id": "the-uuid", "confidence": 0.95, "cleaned_detail": "standardized detail text", "is_valid": true}]

BATCH TO EVALUATE:
${batchString}`;

        try {
            const rawOutput = await this._waterfall(prompt);
            return this._extractJson(rawOutput);
        } catch (e) {
            console.error("LLM Knowledge Distillation Error:", e);
            return []; // Fail closed mathematically
        }
    }

    /**
     * Generates a conversational, empathetic response gracefully.
     * Prevents the structural LLM from throwing "Out of Scope" on small talk.
     */
    async generateConversationalResponse(text, userContext = {}, injectedContext = '') {
        if (!this.genAI && !this.anthropic) return "I am currently offline, but how can I help you today?";

        const prompt = `SYSTEM: You are Ajrvis, the elite AI Chief of Staff strictly managing an Indian household. 
The user just sent a message that is conversational small-talk or a general question (not a specific operational task like delegating to a maid).
Reply naturally, gracefully, and EXTREMELY CONCISELY (Strictly less than 15 words).

USER CONTEXT:
Name: ${userContext.name || 'Unknown'}
Children: ${JSON.stringify(userContext.children || [])}
Domestic Staff: ${JSON.stringify(userContext.providers || [])}
${injectedContext}

USER MESSAGE: "${text}"

Reply directly to the user respectfully:`;

        try {
            return await this._waterfall(prompt);
        } catch (e) {
            console.error("Conversational LLM Error:", e);
            return "I apologize, I'm processing a lot of tasks right now. Can I help you with anything specific?";
        }
    }

    _mockIntent(text) {
        return { 
            intents: [
                { intent: 'create_task', confidence: 0.9, language: 'en', entities: { title: "Mock task: " + text, due_date: null } }
            ]
        };
    }

    /**
     * Robustly extracts JSON from an LLM response even if it hallucinates markdown or text around it.
     */
    _extractJson(rawOutput) {
        let pureJson = rawOutput;
        const match = rawOutput.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
        if (match) {
            pureJson = match[0];
        } else {
            pureJson = rawOutput.replace(/```json\n?/gi, '').replace(/```\n?/gi, '').trim();
        }
        return JSON.parse(pureJson);
    }

    /**
     * TELEMETRY ENGINE
     * Low-impact logging for monitoring waterfall performance.
     */
    _logTelemetry(modelId, modelName, duration, success, error = null) {
        if (!this.isDevMode && success) return; // Only log failures in Production; log everything in Dev
        const status = success ? '✅ SUCCESS' : '❌ FAILED';
        console.log(`[LLM Telemetry] ${status} | ${modelId} (${modelName}) | Latency: ${duration}ms${error ? ' | Error: ' + error : ''}`);
    }

    /**
     * V1 Confidence Evaluator: Triggers Secondary History Hop if the LLM struggled.
     * Moved to distinct function to allow complex Advanced Regex heuristics in V2 Backlog.
     */
    evaluateConfidence(intentResult) {
        if (!intentResult) return true; // Force lookup if parsing crashed
        if (intentResult.intent === 'conversational') return true; // Casual chit-chat implies high continuity
        if (intentResult.confidence < 0.60) return true; // AI mathematically panicked
        return false;
    }
}

module.exports = new LLMService();
