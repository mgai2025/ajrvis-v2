// Set mock token before requiring controller
process.env.TELEGRAM_BOT_Token = 'dummy-token';

// Mock node-telegram-bot-api FIRST
const mockSendMessage = jest.fn().mockResolvedValue({});
const mockOn = jest.fn();
jest.mock('node-telegram-bot-api', () => {
    return jest.fn().mockImplementation(() => ({
        sendMessage: mockSendMessage,
        on: mockOn,
        setWebHook: jest.fn()
    }));
});

// Mock orchestrator
jest.mock('../orchestrator/orchestrator.service', () => ({
    routeMessage: jest.fn()
}));

const telegramController = require('./telegram.controller');
const orchestrator = require('../orchestrator/orchestrator.service');

describe('Telegram Controller - Bug 4 Fallback Verification', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('Bug 4: Sends fallback message on Webhook failure', async () => {
        orchestrator.routeMessage.mockRejectedValue(new Error('Simulated Crash'));

        const req = { 
            body: { 
                message: { 
                    chat: { id: 456 }, 
                    from: { id: 789, first_name: 'Test' },
                    text: 'Hello',
                    date: Date.now()
                } 
            } 
        };
        const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

        await telegramController.receiveMessage(req, res);

        expect(mockSendMessage).toHaveBeenCalledWith(456, expect.stringContaining('⚠️ System Error'));
        expect(res.status).toHaveBeenCalledWith(200);
    });
});
