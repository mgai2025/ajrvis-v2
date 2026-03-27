const { GoogleGenerativeAI } = require('@google/generative-ai');
const Anthropic = require('@anthropic-ai/sdk');

/**
 * Service to orchestrate interactions with LLMs (Claude & Gemini).
 * Utilizing an elite Architectural Waterfall: Claude 3.5 -> Gemini 2.5 Pro -> Gemini 1.5 Flash
 */
class LLMService {
    constructor() {
        this.provider = process.env.LLM_PROVIDER || 'mixed';

        const geminiApiKey = process.env.GEMINI_API_KEY;
        const anthropicApiKey = process.env.ANTHROPIC_API_KEY;

        // Initialize Gemini
        if (geminiApiKey) {
            this.genAI = new GoogleGenerativeAI(geminiApiKey);
            this.geminiPro = this.genAI.getGenerativeModel({ model: "gemini-1.5-pro-002" });
            this.geminiFlash = this.genAI.getGenerativeModel({ model: "gemini-1.5-flash-002" });
        } else {
            console.warn('GEMINI_API_KEY is not set in .env. Gemini Fallbacks disabled.');
        }

        // Initialize Claude
        if (anthropicApiKey && anthropicApiKey !== 'your_anthropic_key') {
            this.anthropic = new Anthropic({ apiKey: anthropicApiKey });
        } else {
            console.warn('ANTHROPIC_API_KEY is not set. Claude Primary Engine disabled.');
        }
    }

    /**
     * Unifies the prompt generation for Claude 3.5 Sonnet
     */
    async _callClaude(prompt) {
        if (!this.anthropic) throw new Error("Claude SDK not instantiated.");
        const msg = await this.anthropic.messages.create({
            model: "claude-sonnet-4-6",
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
     * The Master Architectural Waterfall. Attempts all three APIs sequentially!
     */
    async _waterfall(prompt) {
        try {
            console.log("[LLM Waterfall] Attempting Claude 3.5 Sonnet...");
            return await this._callClaude(prompt);
        } catch (e1) {
            console.error(`[LLM Waterfall] Claude Failed (${e1.message}) -> Degrading to Gemini 1.5 Pro`);
            try {
                return await this._callGemini(prompt, "gemini-1.5-pro");
            } catch (e2) {
                console.error(`[LLM Waterfall] Gemini Pro Failed (${e2.message}) -> Degrading to Gemini 1.5 Flash`);
                try {
                    return await this._callGemini(prompt, "gemini-1.5-flash");
                } catch (e3) {
                    console.error(`[LLM Waterfall] TOTAL OUTAGE. All engines failed.`);
                    throw new Error("Waterfall Depletion");
                }
            }
        }
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
Reply naturally, gracefully, and concisely (1-2 sentences maximum).

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
