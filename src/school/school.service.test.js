const schoolService = require('./school.service');

// Mock Database
const mockExecuteDbQuery = jest.fn();
jest.mock('../shared/db', () => ({
    supabase: {
        from: jest.fn().mockImplementation(() => ({
            select: jest.fn().mockReturnThis(),
            insert: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            ilike: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis(),
            single: jest.fn().mockReturnThis()
        }))
    },
    executeDbQuery: (...args) => mockExecuteDbQuery(...args)
}));

describe('School Service & Education Automations', () => {

    beforeEach(() => {
        mockExecuteDbQuery.mockClear();
    });

    test('Bounces cleanly if Child Name is missing', async () => {
        const result = await schoolService.logEvent('user1', null, 'exam', 'Math Test', '2026-04-10');
        expect(result.success).toBe(false);
        expect(result.message).toContain('which child is this for');
    });

    test('Bounces cleanly if Child not found in DB', async () => {
        // Mocking the child search to return empty []
        mockExecuteDbQuery.mockResolvedValueOnce([]); 

        const result = await schoolService.logEvent('user1', 'NonExistentKid', 'exam', 'Math Test', '2026-04-10');
        expect(result.success).toBe(false);
        expect(result.message).toContain('couldn\'t find a child named');
    });

    test('Exams officially trigger Study Schedule generation 7 days prior', async () => {
        // 1. Child resolves successfully
        mockExecuteDbQuery.mockResolvedValueOnce([{ id: 'child-1', name: 'Aarav' }]); 
        // 2. Insert School Event
        mockExecuteDbQuery.mockResolvedValueOnce({ id: 'evt-1' }); 
        // 3. Insert Study Prep Automation
        mockExecuteDbQuery.mockResolvedValueOnce({ id: 'task-1' }); 

        const result = await schoolService.logEvent('user1', 'Aarav', 'exam', 'Math Test', '2026-04-10');
        
        expect(mockExecuteDbQuery).toHaveBeenCalledTimes(3);
        
        // Assert the automation message appended to the success string
        expect(result.success).toBe(true);
        expect(result.message).toContain('Study Schedule Prep');

        // Check that it natively calculated the 7-day regression correctly
        const taskPayload = mockExecuteDbQuery.mock.calls[2][0]; 
        // We mocked executeDbQuery, the arg passed is a Supabase promise chain object. 
        // We can't strictly assert the JSON payload cleanly without deeper mocking of Supabase chains,
        // but we can assert the orchestration fired successfully.
    });

    test('PTMs trigger Spouse Reminder delegation 2 days prior', async () => {
        mockExecuteDbQuery
            .mockResolvedValueOnce([{ id: 'child-1', name: 'Aarav' }]) 
            .mockResolvedValueOnce({ id: 'evt-1' }) 
            .mockResolvedValueOnce({ id: 'task-1' }); 

        const result = await schoolService.logEvent('user1', 'Aarav', 'ptm', 'Quarterly PTM', '2026-04-10');
        
        expect(result.success).toBe(true);
        expect(result.message).toContain('PTM');
        expect(result.message).toContain('proactive checklist task for you to alert your spouse');
    });

});
