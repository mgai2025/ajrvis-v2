// Set dummy env vars before anything else
process.env.SUPABASE_URL = 'http://localhost';
process.env.SUPABASE_KEY = 'dummy';

const orchestrator = require('./orchestrator.service');
const userService = require('../user/user.service');
const llm = require('../llm/llm.service');
const memoryService = require('../memory/memory.service');
const db = require('../shared/db');
const taskService = require('../tasks/task.service');

jest.mock('../user/user.service');
jest.mock('../llm/llm.service');
jest.mock('../memory/memory.service');
jest.mock('../tasks/task.service', () => ({
    createTask: jest.fn().mockResolvedValue({ status: 'success', message: 'Task created' }),
    getUserTasks: jest.fn().mockResolvedValue([]),
    markTaskCompleted: jest.fn().mockResolvedValue({ success: true })
}));

// More robust Supabase mock
jest.mock('../shared/db', () => {
    const chainable = {};
    chainable.from = jest.fn().mockReturnValue(chainable);
    chainable.update = jest.fn().mockReturnValue(chainable);
    chainable.eq = jest.fn().mockReturnValue(chainable);
    chainable.select = jest.fn().mockReturnValue(chainable);
    chainable.single = jest.fn().mockReturnValue(chainable);
    chainable.limit = jest.fn().mockReturnValue(chainable);
    chainable.in = jest.fn().mockReturnValue(chainable);
    chainable.gte = jest.fn().mockReturnValue(chainable);
    chainable.order = jest.fn().mockReturnValue(chainable);
    chainable.delete = jest.fn().mockReturnValue(chainable);
    chainable.insert = jest.fn().mockReturnValue(chainable);
    chainable.or = jest.fn().mockReturnValue(chainable);
    chainable.lt = jest.fn().mockReturnValue(chainable);
    
    return {
        supabase: chainable,
        executeDbQuery: jest.fn(async (q) => {
            // Return empty arrays or objects to avoid destructuring errors
            return []; 
        })
    };
});

jest.mock('../user/onboarding.controller', () => ({
    processState: jest.fn()
}));

describe('Orchestrator Service - Bug Fix Verification', () => {
    const mockUser = {
        id: 'user-123',
        phone: '1234567890',
        onboarding_state: 'complete',
        name: 'Mohit'
    };

    beforeEach(() => {
        jest.clearAllMocks();
        userService.getUserByPhone.mockResolvedValue(mockUser);
        llm.classifyIntent.mockResolvedValue({
            intents: [{
                intent: 'conversational',
                confidence: 1.0,
                language: 'en'
            }]
        });
        llm.evaluateConfidence.mockReturnValue(false);
        llm.generateConversationalResponse.mockResolvedValue("Hello!");
        memoryService.logMessage.mockResolvedValue({ success: true });
        memoryService.getShortTermContext.mockResolvedValue("No history");
    });

    test('Bug 2 & 3: Fire-and-forget memory logging (Non-blocking)', async () => {
        let logFinished = false;
        // Mock logMessage to take time
        memoryService.logMessage.mockImplementation(() => new Promise(resolve => {
            setTimeout(() => {
                logFinished = true;
                resolve();
            }, 50);
        }));

        const inputEvent = { user_phone: '1234567890', raw_text: 'Hello' };
        
        const startTime = Date.now();
        await orchestrator.routeMessage(inputEvent);
        const duration = Date.now() - startTime;

        // Should return almost instantly (< 50ms)
        expect(duration).toBeLessThan(50);
        expect(logFinished).toBe(false);

        // Wait for it to actually finish so promise doesn't hang
        await new Promise(r => setTimeout(r, 60));
        expect(logFinished).toBe(true);
    });
});
