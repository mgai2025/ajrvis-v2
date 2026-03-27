const { GoogleGenerativeAI } = require('@google/generative-ai');

/**
 * Handles communication with the LLM APIs (Gemini/Claude).
 * Currently hardcoded to Gemini for dev per PRD.
 */
class LLMService {
    constructor() {
        this.provider = process.env.LLM_PROVIDER || 'gemini';
        
        if (this.provider === 'gemini') {
            const apiKey = process.env.GEMINI_API_KEY;
            if (!apiKey) {
                console.warn('GEMINI_API_KEY is not set in .env. LLM calls will fail.');
            }
            this.genAI = new GoogleGenerativeAI(apiKey || 'uninitialized');
            // Initialize model with 1.5-flash for massive 1500/day free-tier quota (2.5 is aggressively rate limited)
            this.intentModel = this.genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
            // Gemini Pro was throwing strict Quota Failures on free keys, so we'll route planning to Flash as well for testing!
            this.planningModel = this.genAI.getGenerativeModel({ model: "gemini-2.5-flash" }); 
        }
    }

    /**
     * Parse raw WhatsApp text into structured intent
     * PRD 7.2 Intent Classification
     */
    async classifyIntent(text, userContext = {}) {
        if (!this.genAI) return this._mockIntent(text);

        const prompt = `SYSTEM: You are a strict JSON intent classifier for an Indian household AI assistant. 
Extract intent and entities. Output ONLY valid JSON. No explanation. No preamble.

CURRENT UTC TIME: ${new Date().toISOString()}

VALID INTENTS: create_task | create_event | add_provider | provider_exception | delegate_provider_task | school_event | complex_goal | query_tasks | query_providers | approve_action | reject_action | cancel_task | conversational | out_of_scope

INJECTED CONTEXT: 
User Name: ${userContext.name || 'Unknown'}
Providers: ${JSON.stringify(userContext.providers || [])}
Children: ${JSON.stringify(userContext.children || [])}

EXTRACTION RULES:
1. If a monetary amount is mentioned in a task (e.g. "105" or "Rs 3000"), extract it strictly into the "amount" integer field, and REMOVE it from the "title".
2. Any message implying a chore, bill payment, reminder, or pending action (e.g., "Mobile bill payment", "Car service next week") MUST be classified as the intent "create_task" even if it lacks explicit verbs like "Pay" or "Remind".
3. Any message requesting to assign a task to a helper (e.g. "Tell cook to make pasta") MUST be classified as "delegate_provider_task".
4. Any message reporting a helper's absence (e.g. "Maid took half day") MUST be classified as "provider_exception".

USER MESSAGE: "${text}"

OUTPUT SCHEMA:
{ 
  "intent": "string", 
  "confidence": 0.0, 
  "language": "hi|en|hinglish", 
  "entities": { 
      "title": "string", 
      "due_date": "ISO8601 UTC date string only string e.g. 2026-03-26T10:00:00Z. DO NOT USE WORDS LIKE TOMORROW", 
      "priority": "low|medium|high", 
      "provider_name": "string", 
      "status": "absent|half_day|extra_day", 
      "amount": number, 
      "needs_decomposition": boolean, 
      "assigned_to": "string" 
  } 
}`;

        try {
            const result = await this.intentModel.generateContent(prompt);
            const responseText = result.response.text();
            
            // Clean up backticks if model generated them
            const cleanJson = responseText.replace(/```json\n/g, '').replace(/```\n?/g, '').trim();
            
            return JSON.parse(cleanJson);
        } catch (error) {
            console.error('LLM Intent Classification Error:', error);
            // Fallback for safety
            return {
                intent: 'unknown',
                confidence: 0,
                language: 'en',
                entities: {}
            };
        }
    }

    /**
     * Decomposes complex mandates (Goal Engine)
     * PRD 7.3 Goal Decomposition
     */
    async decomposeGoal(text) {
        if (!this.genAI) return this._mockDecomposition(text);

        const prompt = `SYSTEM: You are a task decomposition engine. Break complex household mandates into structured execution plans. Output ONLY valid JSON.

RULES: Max 5 tasks. Max 5 subtasks per task. Classify each subtask as autonomous (safe to do immediately) or approval_required (needs user yes before execution). 
Autonomous = drafting text, setting reminders, creating calendar events, web search. 
Approval_required = sending messages to others, spending money, placing orders.

USER MESSAGE: "${text}"

OUTPUT SCHEMA: 
{ 
  "goal_title": "string", 
  "tasks": [{ 
      "title": "string", 
      "type": "string", 
      "subtasks": [{ 
          "title": "string", 
          "execution_type": "autonomous|approval_required", 
          "action_type": "string", 
          "action_params": {} 
      }] 
  }] 
}`;
        
        try {
            const result = await this.planningModel.generateContent(prompt);
            const jsonText = result.response.text().replace(/```json\n/g, '').replace(/```\n?/g, '').trim();
            return JSON.parse(jsonText);
        } catch (error) {
            console.error('LLM Decomposition Error:', error);
            return { goal_title: text, tasks: [] };
        }
    }

    /**
     * Extracts Family or Provider profiles during Onboarding
     */
    async extractEntities(text, type) {
        if (!this.genAI) return [];
        
        let prompt = '';
        if (type === 'family') {
            prompt = `SYSTEM: You extract family members from text. Output STRICTLY a RAW JSON array of objects. No markdown formatting. [{"name": "name", "role": "spouse|child|parent", "age": null_or_number}]\nUSER: "${text}"`;
        } else if (type === 'provider') {
            prompt = `SYSTEM: You extract household helpers and service providers from text. Output STRICTLY a RAW JSON array of objects. No markdown formatting. [{"name": "name", "role": "exact_role_mentioned_like_cook_nanny_doctor_teacher"}]\nUSER: "${text}"`;
        } else if (type === 'name') {
            prompt = `SYSTEM: You extract the user's explicit real name from text. Output STRICTLY a RAW JSON object. No markdown formatting. {"name": "Cleaned First & Last Name"}\nUSER: "${text}"`;
        }
        
        try {
            const result = await this.intentModel.generateContent(prompt);
            const rawOutput = result.response.text().replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
            return JSON.parse(rawOutput);
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
        if (!this.genAI) return "I am currently offline, but how can I help you today?";

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
            const result = await this.intentModel.generateContent(prompt);
            return result.response.text().trim();
        } catch (e) {
            console.error("Conversational LLM Error:", e);
            return "I apologize, I'm processing a lot of tasks right now. Can I help you with anything specific?";
        }
    }

    _mockIntent(text) {
        return {
            intent: 'create_task',
            confidence: 0.99,
            language: 'en',
            entities: { title: 'Mock Task', due_date: 'tomorrow' }
        };
    }

    _mockDecomposition(text) {
        return {
            goal_title: 'Mock Goal',
            tasks: []
        };
    }
}

module.exports = new LLMService();
