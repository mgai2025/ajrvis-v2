const llmService = require('./llm.service');

describe('LLM Service - JSON Extraction & Intent Parsing', () => {
    
    test('_extractJson should reliably strip markdown and parse raw JSON objects', () => {
        const rawResponse = `Here is your result:\n\n\`\`\`json\n{\n  "intent": "create_task",\n  "confidence": 0.95\n}\n\`\`\`\n\nHope this helps!`;
        const result = llmService._extractJson(rawResponse);
        
        expect(result).toBeDefined();
        expect(result.intent).toBe("create_task");
        expect(result.confidence).toBe(0.95);
    });

    test('_extractJson should extract arrays perfectly as well', () => {
        const rawResponse = `[ {"name": "Geeta", "role": "maid"} ]`;
        const result = llmService._extractJson(rawResponse);
        
        expect(Array.isArray(result)).toBe(true);
        expect(result[0].name).toBe("Geeta");
    });

    test('_mockIntent returns valid fallback schema', () => {
        const result = llmService._mockIntent("Remind me tomorrow");
        expect(result.intent).toBe('create_task');
        expect(result.language).toBe('en');
        expect(result.entities.title).toContain("Remind me");
    });
});
