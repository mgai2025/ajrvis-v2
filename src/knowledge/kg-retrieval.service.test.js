const kgRetrieval = require('./kg-retrieval.service');
const { supabase } = require('../shared/db');

jest.mock('../shared/db', () => ({
    supabase: {
        from: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        in: jest.fn().mockReturnThis(),
        gte: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        single: jest.fn().mockReturnThis(),
    }
}));

describe('KnowledgeGraphRetrievalService', () => {

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should cleanly exit if intent is NOT explicitly configured for retrieval', async () => {
        // Intent config missing
        require('../shared/db').supabase.single.mockResolvedValueOnce({
            data: null,
            error: { code: 'NOT_FOUND' }
        });

        const ctx = await kgRetrieval.getFactContextForPrompt('user-1', { intent: 'create_task', entities: {} });
        expect(ctx).toBe("");
    });

    it('should inject HOT facts strictly based on intent and entities', async () => {
        // Mock config router
        require('../shared/db').supabase.single.mockResolvedValueOnce({
            data: {
                intent: 'school_event',
                domain_tables: ['kg_health', 'kg_behavior'],
                retrieval_type: 'hot',
                entity_field: 'child_name',
                max_rows: 2
            },
            error: null
        });

        // Mock retrieved row
        require('../shared/db').supabase.limit.mockResolvedValueOnce({
            data: [{
                fact_summary: 'Kynaa is allergic to chocolate Cake',
                confidence: 0.95
            }],
            error: null
        });

        const ctx = await kgRetrieval.getFactContextForPrompt('user-1', { 
            intent: 'school_event', 
            entities: { child_name: 'Kynaa' } 
        });
        
        expect(ctx).toContain('SYSTEM MEMORY INJECTIONS');
        expect(ctx).toContain('Kynaa is allergic to chocolate Cake');
    });
});
