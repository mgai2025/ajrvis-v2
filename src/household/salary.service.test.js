const salaryService = require('./salary.service');

// Mock out the database to force deterministic scenarios
const mockExecuteDbQuery = jest.fn();
jest.mock('../shared/db', () => {
    return {
        supabase: {
            from: jest.fn().mockImplementation(() => ({
                select: jest.fn().mockReturnThis(),
                insert: jest.fn().mockReturnThis(),
                update: jest.fn().mockReturnThis(),
                eq: jest.fn().mockReturnThis(),
                or: jest.fn().mockReturnThis(),
                gte: jest.fn().mockReturnThis(),
                lte: jest.fn().mockReturnThis(),
                in: jest.fn().mockReturnThis(),
                limit: jest.fn().mockReturnThis()
            }))
        },
        executeDbQuery: (...args) => mockExecuteDbQuery(...args)
    };
});

describe('SalaryService - Deterministic Calculator', () => {

    beforeEach(() => {
        mockExecuteDbQuery.mockClear();
    });

    test('calculateSalary mathematically processes Absences and Advances correctly', async () => {
        
        // Mocking the sequence of DB calls inside calculateSalary()
        // 1. fetch provider
        // 2. fetch absences
        // 3. fetch advances
        // 4. insert history log
        // 5. update advances to deducted = true

        mockExecuteDbQuery
            .mockResolvedValueOnce([{
                id: 'provider-1',
                name: 'Geeta',
                pay_type: 'monthly',
                base_pay: 3000.0,
                allowed_leaves_per_month: 2
            }]) // 1. Provider
            .mockResolvedValueOnce([
                { status: 'absent' }, { status: 'absent' }, { status: 'absent' }, { status: 'absent' }
            ]) // 2. Absences (Total 4, Allowed 2 -> 2 Unpaid = -200)
            .mockResolvedValueOnce([
                { id: 'adv-1', amount: 500, reason: 'Festival advance' }
            ]) // 3. Advances (Total 500 = -500)
            .mockResolvedValueOnce([]) // 4. Insert log
            .mockResolvedValueOnce([]); // 5. Update advances

        const result = await salaryService.calculateSalary('user-1', 'Geeta', '2026-03-01');

        // Total 4 absences - 2 allowed = 2 unpaid absences.
        // Base Pay / 30 = 3000 / 30 = 100 per day. -> 2 * 100 = 200 absence deduction.
        // Total Payable = 3000 - 200 (absences) - 500 (advance) = 2300!
        
        expect(result.success).toBe(true);
        expect(result.message).toContain('Total Payable = ₹2300.00');
        expect(result.message).toContain('-₹200.00'); // the absence deduction
        expect(result.message).toContain('-₹500'); // the cash advance deduction
    });
});
