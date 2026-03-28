const taskService = require('./task.service');
const CONSTANTS = require('../config/constants');

jest.mock('../shared/db', () => {
    const mockInsert = jest.fn().mockReturnValue(Promise.resolve({ data: [], error: null }));
    return {
        supabase: {
            from: jest.fn().mockReturnValue({ insert: mockInsert })
        },
        executeDbQuery: jest.fn(async (q) => q)
    };
});

describe('TaskService - Reminder Generation Engine', () => {
    let mockInsert;
    
    beforeEach(() => {
        const { supabase } = require('../shared/db');
        mockInsert = supabase.from().insert;
        mockInsert.mockClear();
    });

    test('generateReminders for SHORT_TERM (< 2hrs)', async () => {
        const taskId = 'test-id';
        const dueDateObj = new Date(Date.now() + 10 * 60000); 
        
        await taskService.generateReminders(taskId, dueDateObj, CONSTANTS.REMINDER_SCHEDULES.SHORT_TERM);
        
        const payload = mockInsert.mock.calls[0][0];
        expect(payload).toHaveLength(1);
        expect(payload[0].type).toBe('exact');
    });

    test('generateReminders for DAILY (2-24hrs) should DROP past reminders', async () => {
        const taskId = 'test-id-2';
        const dueDateObj = new Date(Date.now() + 180 * 60000); 
        
        await taskService.generateReminders(taskId, dueDateObj, CONSTANTS.REMINDER_SCHEDULES.DAILY);
        
        const payload = mockInsert.mock.calls[0][0];
        // DAILY offset is: [-60, 0, 60, 1440]
        expect(payload).toHaveLength(4);
        
        const exactReminder = payload.find(r => r.type === 'exact');
        expect(exactReminder).toBeDefined();
    });

    test('generateReminders should drop negative math gracefully', async () => {
        const taskId = 'test-id-3';
        const dueDateObj = new Date(Date.now() + 10 * 60000); // 10 mins from now
        
        // Multi_day offset: [-1440, -120, 0, 60, 1440]
        await taskService.generateReminders(taskId, dueDateObj, CONSTANTS.REMINDER_SCHEDULES.MULTI_DAY);
        
        const payload = mockInsert.mock.calls[0][0];
        
        // It must cleanly DROP the two negative dates (-1440, -120)
        expect(payload).toHaveLength(3); 
    });
});
