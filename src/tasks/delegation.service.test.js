const delegationService = require('./delegation.service');
const CONSTANTS = require('../config/constants');

jest.mock('../shared/db', () => {
    const mockInsert = jest.fn().mockImplementation(() => ({
        select: jest.fn().mockResolvedValue([{ id: 'test-task-uuid', title: 'Test Task' }])
    }));
    const mockUpdate = jest.fn().mockImplementation(() => ({
        eq: jest.fn().mockResolvedValue({ data: [], error: null })
    }));
    const mockSelect = jest.fn().mockImplementation(() => ({
        eq: jest.fn().mockImplementation(() => ({
            eq: jest.fn().mockResolvedValue([{ 
                secondary_user_id: 'target-user-uuid',
                users: { id: 'target-user-uuid', name: 'Mohit', phone: '1234567890' } 
            }]),
            single: jest.fn().mockResolvedValue({ 
                id: 'test-task-uuid', 
                status: 'pending_acceptance', 
                assigned_to: 'target-user-uuid',
                due_date: new Date(Date.now() + 3600000).toISOString(), 
                users: { name: 'Nitika' }
            })
        }))
    }));

    return {
        supabase: {
            from: jest.fn().mockImplementation((table) => ({
                select: mockSelect,
                insert: mockInsert,
                update: mockUpdate
            }))
        },
        executeDbQuery: jest.fn(async (q) => q)
    };
});

jest.mock('../gateway/outbound.service', () => ({
    sendMessage: jest.fn().mockResolvedValue(true)
}));

jest.mock('./task.service', () => ({
    generateReminders: jest.fn().mockResolvedValue(true)
}));

describe('DelegationService', () => {
    let mockInsert, mockUpdate, mockSelect;
    
    beforeEach(() => {
        const { supabase } = require('../shared/db');
        mockInsert = supabase.from().insert;
        mockUpdate = supabase.from().update;
        mockSelect = supabase.from().select;
        jest.clearAllMocks();
    });

    test('draftDelegation should create a task and send a deep-link', async () => {
        const primaryUser = { id: 'primary-uuid', name: 'Nitika' };
        const payload = { assignee_name: 'Mohit', title: 'Pick up Kynaa' };
        
        const result = await delegationService.draftDelegation(primaryUser, payload);
        
        expect(result).toContain('Perfect. I\'ve sent a task request to Mohit.');
        expect(mockInsert).toHaveBeenCalled();
        const insertedTask = mockInsert.mock.calls[0][0][0];
        expect(insertedTask.status).toBe('pending_acceptance');
        expect(insertedTask.assigned_to).toBe('target-user-uuid');
    });

    test('acceptDelegation should activate task and use URGENT_24H schedule if due soon', async () => {
        const assigneeUser = { id: 'target-user-uuid', name: 'Mohit' };
        const taskId = 'test-task-uuid';
        
        const result = await delegationService.acceptDelegation(assigneeUser, taskId);
        
        expect(result).toContain('Task Accepted');
        expect(mockUpdate).toHaveBeenCalledWith({ 
            status: 'scheduled',
            assigned_to: 'target-user-uuid' 
        });
        
        // Verify dynamic reminders logic
        const taskService = require('./task.service');
        expect(taskService.generateReminders).toHaveBeenCalledWith(
            expect.anything(), 
            expect.anything(), 
            CONSTANTS.DELEGATION_REMINDER_SCHEDULES.URGENT_24H
        );
    });

    test('draftDelegation should support open-loop (null assignee) if user not found', async () => {
        const primaryUser = { id: 'primary-uuid', name: 'Nitika' };
        const payload = { assignee_name: 'UnknownFriend', title: 'Pick up tickets' };
        
        // Mocking select to return no users
        mockSelect.mockImplementationOnce(() => ({
            eq: jest.fn().mockImplementation(() => ({
                eq: jest.fn().mockResolvedValue([]) 
            }))
        }));

        const result = await delegationService.draftDelegation(primaryUser, payload);
        
        expect(result).toContain('please forward them this link to accept it');
        const insertedTask = mockInsert.mock.calls[0][0][0];
        expect(insertedTask.assigned_to).toBeNull();
    });
});
