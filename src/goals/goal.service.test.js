const goalService = require('./goal.service');

// Mock out the LLM waterfall so we don't hit the real Anthropic API
jest.mock('../llm/llm.service', () => ({
    _waterfall: jest.fn().mockResolvedValue(`[
      { "title": "Buy Cake", "priority": "high", "relative_due_date_iso": "2026-03-31T10:00:00.000Z" },
      { "title": "Book Venue", "priority": "medium", "relative_due_date_iso": null }
    ]`),
    _extractJson: jest.fn().mockReturnValue([
      { title: "Buy Cake", priority: "high", relative_due_date_iso: "2026-03-31T10:00:00.000Z" },
      { title: "Book Venue", priority: "medium", relative_due_date_iso: null }
    ])
}));

// Mock Database
const mockExecuteDbQuery = jest.fn();
jest.mock('../shared/db', () => ({
    supabase: {
        from: jest.fn().mockImplementation(() => ({
            insert: jest.fn().mockReturnThis(),
            update: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            select: jest.fn().mockReturnThis(),
            single: jest.fn().mockReturnThis()
        }))
    },
    executeDbQuery: (...args) => mockExecuteDbQuery(...args)
}));

describe('Goal Service (Sprint D: Agentic Engine)', () => {

    beforeEach(() => {
        mockExecuteDbQuery.mockClear();
    });

    test('decomposeAndDraftGoal parses LLM output and quarantines sub-tasks', async () => {
        // Mocking the goal insertion returning ID
        mockExecuteDbQuery.mockResolvedValueOnce({ id: 'goal-123' });
        
        // Mocking task insertions
        mockExecuteDbQuery.mockResolvedValueOnce([]); // Task 1
        mockExecuteDbQuery.mockResolvedValueOnce([]); // Task 2

        const result = await goalService.decomposeAndDraftGoal('user-1', 'Plan Aaravs birthday');

        expect(mockExecuteDbQuery).toHaveBeenCalledTimes(3); 
        expect(result.success).toBe(true);
        expect(result.message).toContain('drafted a plan');
        expect(result.message).toContain('Buy Cake');
    });

    test('approveGoalTasks cleanly updates pending statuses', async () => {
        // Mocking the update select returning two tasks updated
        mockExecuteDbQuery.mockResolvedValueOnce([{ id: 'task-1' }, { id: 'task-2' }]);

        const result = await goalService.approveGoalTasks('user-1');

        expect(mockExecuteDbQuery).toHaveBeenCalledTimes(1); 
        expect(result.success).toBe(true);
        expect(result.message).toContain('officially approved and added 2');
    });

    test('approveGoalTasks responds correctly if empty', async () => {
        // Mocking empty update payload
        mockExecuteDbQuery.mockResolvedValueOnce([]);

        const result = await goalService.approveGoalTasks('user-1');
        
        expect(result.success).toBe(false);
        expect(result.message).toContain('pending drafts');
    });

});
