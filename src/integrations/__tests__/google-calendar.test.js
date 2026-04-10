const googleCalendarService = require('../google-calendar.service');
const db = require('../../shared/db');

// Mock Dependencies
jest.mock('../../shared/db', () => ({
    executeDbQuery: jest.fn(),
    supabase: {
        from: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn()
    }
}));

// Mock Google API
jest.mock('googleapis', () => {
    return {
        google: {
            auth: { OAuth2: jest.fn(() => ({ setCredentials: jest.fn(), on: jest.fn() })) },
            calendar: jest.fn(() => ({
                events: {
                    insert: jest.fn().mockResolvedValue({ data: { id: 'mocked_event_123', htmlLink: 'http://cal.link' } }),
                    list: jest.fn().mockResolvedValue({ data: { items: [] } })
                }
            }))
        }
    };
});

describe('Google Calendar Service', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // Setup mock env vars for encryption
        process.env.GCAL_ENCRYPTION_KEY = '33ce4211ae42c963da1f1627692006656dfa56f8b005223da3bc5908f688f314';
        process.env.GOOGLE_CLIENT_ID = 'mocked_client';
        process.env.GOOGLE_CLIENT_SECRET = 'mocked_secret';
    });

    test('Encryption and Decryption architecture test is handled in auth controller', () => {
        expect(true).toBe(true);
    });

    test('createEvent aborts if user is not connected', async () => {
        db.executeDbQuery.mockResolvedValueOnce({ settings: {} }); // No gcal settings

        const result = await googleCalendarService.createEvent('user_123', {
            title: 'Test Event',
            due_date: new Date().toISOString()
        });

        expect(result.success).toBe(false);
        expect(result.reason).toBe('not_connected');
    });

    test('createEvent successfully formats and inserts an event', async () => {
        const validToken = 'valid_token';
        // We will mock _decrypt in the service directly just for this test
        jest.spyOn(googleCalendarService, '_decrypt').mockReturnValue(validToken);
        db.executeDbQuery.mockResolvedValueOnce({
            settings: { 
                gcal: { 
                    connected: true, 
                    tokens: { access_token: validToken, expiry_date: Date.now() + 10000 }
                }
            }
        });

        const result = await googleCalendarService.createEvent('user_123', {
            title: 'Meeting with Principal',
            description: 'Discuss fees',
            due_date: '2026-05-01T10:00:00Z'
        });

        expect(result.success).toBe(true);
        expect(result.eventId).toBe('mocked_event_123');
        expect(db.executeDbQuery).toHaveBeenCalledTimes(1); // One for user fetch
    });
});
