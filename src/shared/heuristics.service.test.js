const heuristicsService = require('./heuristics.service');

describe('Heuristics Engine (Absence Suggestions)', () => {
    test('Suggests Urban Company for maids/cleaners', async () => {
        const result = await heuristicsService.getAbsenceSuggestion('user-1', 'maid', 'en');
        expect(result).toContain('urbancompany://');
        expect(result).toContain('1-time cleaning');
    });

    test('Suggests Swiggy/Zomato for cooks', async () => {
        const result = await heuristicsService.getAbsenceSuggestion('user-1', 'cook', 'hi');
        expect(result).toContain('zomato://');
        expect(result).toContain('swiggy://');
        expect(result).toContain('order food');
    });

    test('Suggests spouse coverage for nannies', async () => {
        const result = await heuristicsService.getAbsenceSuggestion('user-1', 'nanny', 'hinglish');
        expect(result).toContain('calendar');
        expect(result).toContain('spouse');
    });

    test('Returns empty for unknown roles safely', async () => {
        const result = await heuristicsService.getAbsenceSuggestion('user-1', 'plumber', 'hinglish');
        expect(result).toBe('');
    });
});
