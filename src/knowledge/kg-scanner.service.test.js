const kgScanner = require('./kg-scanner.service');
const { supabase } = require('../shared/db');

// Mock Supabase
jest.mock('../shared/db', () => ({
    supabase: {
        from: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        insert: jest.fn().mockReturnThis()
    }
}));

describe('KnowledgeGraphScannerService', () => {

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should extract ALLERGY facts matched against Phase 1 heuristics', async () => {
        // Mock DB returns
        require('../shared/db').supabase.eq.mockResolvedValueOnce({
            data: [{
                id: 'HEALTH_ALLERGY_001',
                pattern: '(?i)(\\w+)\\s+(?:is allergic to|cannot eat|has allergy to|reacts to)\\s+([\\w\\s]+)',
                candidate_table: 'kg_health',
                candidate_fact_type: 'allergy',
                subject_group: 1,
                detail_group: 2,
                initial_confidence: 0.85
            }],
            error: null
        });

        const insertMock = jest.fn().mockResolvedValue({ error: null });
        require('../shared/db').supabase.insert = insertMock;

        await kgScanner.scanInboundMessage('user-1', 'msg-1', 'Just FYI, Kynaa is allergic to peanuts. Make sure we remember that.');

        // Validate insert call
        expect(insertMock).toHaveBeenCalledTimes(1);
        const writtenPayload = insertMock.mock.calls[0][0][0];

        expect(writtenPayload.candidate_table).toBe('kg_health');
        expect(writtenPayload.subject_extracted).toBe('Kynaa');
        expect(writtenPayload.detail_extracted).toBe('peanuts');
        expect(writtenPayload.direct_write).toBe(true); // Confidence 0.85 > 0.80
    });

    it('should safely ignore messages missing facts entirely', async () => {
        require('../shared/db').supabase.eq.mockResolvedValueOnce({
            data: [{
                id: 'FOOD_DISLIKE_001',
                pattern: '(?i)(\\w+)\\s+(?:hates|does not like|dislikes)\\s+([\\w\\s]+)',
                candidate_table: 'kg_food',
                candidate_fact_type: 'dislike',
                subject_group: 1,
                detail_group: 2,
                initial_confidence: 0.70
            }],
            error: null
        });

        const insertMock = jest.fn().mockResolvedValue({ error: null });
        require('../shared/db').supabase.insert = insertMock;

        await kgScanner.scanInboundMessage('user-1', 'msg-2', 'Hey what time is the PTM tomorrow?');

        // Pattern shouldn't match
        expect(insertMock).not.toHaveBeenCalled();
    });
});
