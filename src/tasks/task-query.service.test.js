const taskQueryService = require('./task-query.service');
const taskService = require('./task.service');

jest.mock('./task.service', () => ({
    getUserTasks: jest.fn()
}));

const mockUser = { id: 'user-uuid', name: 'Nitika' };

describe('TaskQueryService - Buckets & Morning Brief', () => {
    
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('queryPendingTasks should segment tasks into Buckets', async () => {
        const mockTasks = [
            { id: '1', title: 'My Task', user_id: 'user-uuid', assigned_to: 'user-uuid', status: 'scheduled', due_date: new Date().toISOString() },
            { id: '2', title: 'Delegated Task', user_id: 'user-uuid', assigned_to: 'other-uuid', status: 'pending_acceptance', assignee: { name: 'Mohit' } },
            { id: '3', title: 'Assigned Task', user_id: 'other-uuid', assigned_to: 'user-uuid', status: 'scheduled', owner: { name: 'Rahul' } }
        ];
        taskService.getUserTasks.mockResolvedValue(mockTasks);

        const result = await taskQueryService.queryPendingTasks(mockUser);
        
        expect(result).toContain('MY TASKS:');
        expect(result).toContain('DELEGATED');
        expect(result).toContain('ASSIGNED TO ME');
        expect(result).toMatch(/1\.\s+My Task/);
        expect(result).toMatch(/2\.\s+Delegated Task → Mohit/);
        expect(result).toMatch(/3\.\s+Assigned Task ← Rahul/);
    });

    test('buildMorningBrief should aggregate overdue and salary alerts', async () => {
        const mockTasks = [
            { id: '1', title: 'Overdue Task', user_id: 'user-uuid', status: 'scheduled', due_date: new Date(Date.now() - 3600000).toISOString() },
            { id: '2', title: 'Today Task', user_id: 'user-uuid', status: 'scheduled', due_date: new Date(Date.now() + 3600000).toISOString() }
        ];
        taskService.getUserTasks.mockResolvedValue(mockTasks);

        const result = await taskQueryService.buildMorningBrief(mockUser);
        
        expect(result).toContain('Nitika!');
        expect(result).toContain('🛑 *OVERDUE');
        expect(result).toContain('Overdue Task');
        expect(result).toContain('📅 *TODAY');
        expect(result).toContain('Today Task');
    });

    test('resolveTaskByListNumber should correctly map the flattened buckets', async () => {
        const mockTasks = [
            { id: '1', title: 'My Task', user_id: 'user-uuid', assigned_to: null, status: 'scheduled' },
            { id: '2', title: 'Delegated', user_id: 'user-uuid', assigned_to: 'other-uuid', status: 'scheduled' },
            { id: '3', title: 'Assigned', user_id: 'other-uuid', assigned_to: 'user-uuid', status: 'scheduled' }
        ];
        taskService.getUserTasks.mockResolvedValue(mockTasks);

        const task1 = await taskQueryService.resolveTaskByListNumber('user-uuid', 1);
        expect(task1.title).toBe('My Task');

        const task2 = await taskQueryService.resolveTaskByListNumber('user-uuid', 2);
        expect(task2.title).toBe('Delegated');

        const task3 = await taskQueryService.resolveTaskByListNumber('user-uuid', 3);
        expect(task3.title).toBe('Assigned');
    });
});
