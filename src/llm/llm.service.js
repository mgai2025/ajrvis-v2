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
            this.geminiPro = this.genAI.getGenerativeModel({ model: "gemini-2.5-pro" });
            this.geminiFlash = this.genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        } else {
            console.warn('GEMINI_API_KEY is not set in .env. Gemini Fallbacks disabled.');
        }

        // Initialize Claude
        if (anthropicApiKey && anthropicApiKey !== 'your_anthropic_key') {
            this.anthropic = new Anthropic({ apiKey: anthropicApiKey });
            this.claudeSonnet = "claude-sonnet-4-6";
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
                { id: 'flash', type: 'gemini', name: 'gemini-2.5-flash' },
                { id: 'pro', type: 'gemini', name: 'gemini-2.5-pro' },
                { id: 'sonnet', type: 'claude', name: this.claudeSonnet }
              ]
            : [
                { id: 'sonnet', type: 'claude', name: this.claudeSonnet },
                { id: 'pro', type: 'gemini', name: 'gemini-2.5-pro' },
                { id: 'flash', type: 'gemini', name: 'gemini-2.5-flash' }
              ];

        for (const model of queue) {
            try {
                console.log(`[LLM Waterfall] Attempting ${model.id} (${model.name})...`);
                if (model.type === 'claude') return await this._callClaude(prompt, model.name);
                if (model.type === 'gemini') return await this._callGemini(prompt, model.name);
            } catch (e) {
                console.warn(`[LLM Waterfall] ${model.id} Request Failed (${e.message}). Falling back...`);
            }
        }

        console.error("[LLM Waterfall] TOTAL OUTAGE. All engines in the queue failed.");
        throw new Error("Waterfall Depletion");
    }

    /**
     * The unified intent classification model
     */
    async classifyIntent(text, userContext = {}) {
        if (!this.genAI && !this.anthropic) {
            return this._mockIntent(text);
        }

        const prompt = `SYSTEM: You are Ajrvis, a highly intelligent Chief of Staff AI managing an Indian household...
CURRENT UTC TIME: ${new Date().toISOString()}

VALID INTENTS: create_task | create_event | add_provider | provider_exception | delegate_provider_task | school_event | complex_goal | query_tasks | query_providers | approve_action | reject_action | cancel_task | conversational | out_of_scope

INJECTED CONTEXT: 
User Name: ${userContext.name || 'Unknown'}
Children: ${JSON.stringify(userContext.children || [])}
Domestic Providers: ${JSON.stringify(userContext.providers || [])}

Given the following message from the user, output exactly a JSON object defining the intent, confidence (0.0 - 1.0), detected language (e.g. 'en', 'hi'), and extracted entities natively.
DO NOT use markdown backticks in the final output. Pure raw JSON exclusively.

USER MESSAGE: "${text}"

EXPECTED FORMAT:
{"intent": "...", "confidence": 0.0, "language": "...", "entities": {}}`;

        try {
            const rawOutput = await this._waterfall(prompt);
            const pureJson = rawOutput.replace(/```json\n?/gi, '').replace(/```\n?/gi, '').trim();
            return JSON.parse(pureJson);
        } catch (e) {
            console.error("LLM Intent Classification Exception:", e);
            return { intent: 'unknown', confidence: 0, language: 'en', entities: {} };
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
            const pureJson = rawOutput.replace(/```json\n?/gi, '').replace(/```\n?/gi, '').trim();
            return JSON.parse(pureJson);
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
            const pureJson = rawOutput.replace(/```json\n?/gi, '').replace(/```\n?/gi, '').trim();
            return JSON.parse(pureJson);
        } catch (e) {
            console.error(`LLM Entity Extraction Error (${type}):`, e);
            return type === 'name' ? { name: text } : [];
        }
    }

    /**
     * Generates a conversational, empathetic response gracefully.
     * Prevents the structural LLM from throwing "Out of Scope" on small talk.
     */
    async generateConversationalResponse(text, userContext = {}) {
        if (!this.genAI && !this.anthropic) return "I am currently offline, but how can I help you today?";

        const prompt = `SYSTEM: You are Ajrvis, the elite AI Chief of Staff strictly managing an Indian household. 
The user just sent a message that is conversational small-talk or a general question (not a specific operational task like delegating to a maid).
Reply naturally, gracefully, and EXTREMELY CONCISELY (Maximum 20 words).

USER CONTEXT:
Name: ${userContext.name || 'Unknown'}
Children: ${JSON.stringify(userContext.children || [])}
Domestic Staff: ${JSON.stringify(userContext.providers || [])}

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
        return { intent: 'create_task', confidence: 0.9, language: 'en', entities: { title: "Mock task: " + text, due_date: null } };
    }
}

module.exports = new LLMService();
