const memoryService = require('./memory.service');

// Mock Database
const mockExecuteDbQuery = jest.fn();
jest.mock('../shared/db', () => ({
    supabase: {
        from: jest.fn().mockImplementation(() => ({
            insert: jest.fn().mockReturnThis(),
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            order: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis()
        }))
    },
    executeDbQuery: (...args) => mockExecuteDbQuery(...args)
}));

describe('Memory Service (Sprint E) - Context Cache', () => {

    beforeEach(() => {
        mockExecuteDbQuery.mockClear();
    });

    test('logMessage silently fires fire-and-forget inserts', async () => {
        mockExecuteDbQuery.mockResolvedValueOnce(true);

        // We don't await strictly to test its async robustness, but for Jest we wait.
        await memoryService.logMessage('user-1', 'Hello Ajrvis', 'inbound', { intent: 'conversational' });
        
        expect(mockExecuteDbQuery).toHaveBeenCalledTimes(1);
    });

    test('getShortTermContext fetches and chronologically reverses history', async () => {
        // Mock DB returns history DESC (newest first)
        const mockDbHistory = [
            { content: "Ok logged.", direction: "outbound", created_at: "2026-03-28T10:05Z" },
            { content: "Call Amit", direction: "inbound", created_at: "2026-03-28T10:04Z" }
        ];
        
        mockExecuteDbQuery.mockResolvedValueOnce(mockDbHistory);

        const contextString = await memoryService.getShortTermContext('user-1', 5);
        
        expect(mockExecuteDbQuery).toHaveBeenCalledTimes(1);
        
        // Assert reversal logic (User should speak BEFORE Ajrvis in the string output linearly)
        const userPoint = contextString.indexOf('User: Call Amit');
        const ajrvisPoint = contextString.indexOf('Ajrvis: Ok logged.');
        
        expect(userPoint).toBeLessThan(ajrvisPoint); // Chronological flow successfully restored!
    });

    test('Safely handles empty context windows', async () => {
        mockExecuteDbQuery.mockResolvedValueOnce([]); // No history

        const contextString = await memoryService.getShortTermContext('user-1', 5);
        
        expect(contextString).toContain('No prior');
    });

});
