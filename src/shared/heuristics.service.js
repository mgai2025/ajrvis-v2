const { executeDbQuery, supabase } = require('./db');

class HeuristicsService {
    /**
     * Finds the best contextual suggestion for a domestic situation
     * e.g. "cook_absent" -> suggests Zomato/Swiggy
     * e.g. "maid_absent" -> suggests Urban Company cleaning
     */
    async getAbsenceSuggestion(userId, providerRole, language = 'hinglish') {
        const role = providerRole ? providerRole.toLowerCase() : 'unknown';
        
        let suggestion = '';
        
        // MVP Hardcoded deterministic heuristics. 
        // In V2, this will fully pull from heuristics_rules / suggestion_responses tables
        if (role.includes('cook') || role.includes('chef')) {
            suggestion = "Since your cook is absent today, would you like me to order food? 🍕\n" +
                         "• [Order on Zomato](zomato://)\n" +
                         "• [Order on Swiggy](swiggy://)";
        } else if (role.includes('maid') || role.includes('cleaner') || role.includes('sweeper')) {
            suggestion = "Since the maid is absent, do you want to book a 1-time cleaning service? 🧹\n" +
                         "• [Book Urban Company](urbancompany://)";
        } else if (role.includes('nanny') || role.includes('babysitter')) {
            suggestion = "Nanny is absent! Remember to block your calendar or ask your spouse to cover afternoon shifts. 👶";
        } else if (role.includes('driver')) {
            suggestion = "Driver is out today. Don't forget to book an Uber/Ola if you have meetings scheduled! 🚗";
        }

        return suggestion;
    }
}

module.exports = new HeuristicsService();
