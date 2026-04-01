const { executeDbQuery, supabase } = require('../shared/db');

class AdvanceService {
    /**
     * Log a cash advance or loan to a domestic helper.
     */
    async logAdvance(userId, providerName, amount, reason, dateStr) {
        if (!supabase) return { success: false, message: 'DB not connected' };

        // Semantic search to find the correct provider
        const providersOpt = await executeDbQuery(
            supabase.from('service_providers')
                .select('*')
                .eq('user_id', userId)
                .or(`name.ilike.%${providerName}%,role.ilike.%${providerName}%`)
                .limit(1)
        );

        if (!providersOpt || providersOpt.length === 0) {
            return { 
                success: false, 
                message: `I couldn't find a helper named "${providerName}" to log the advance against.` 
            };
        }

        const provider = providersOpt[0];

        // Ensure amount is actually numeric
        const numericAmount = parseFloat(amount);
        if (isNaN(numericAmount) || numericAmount <= 0) {
            return { 
                success: false, 
                message: `I couldn't understand the advance amount. Please specify a number.` 
            };
        }

        const dateToLog = dateStr ? dateStr.split('T')[0] : new Date().toISOString().split('T')[0];

        await executeDbQuery(
            supabase.from('provider_advances').insert({
                provider_id: provider.id,
                amount: numericAmount,
                reason: reason || 'Cash advance',
                date: dateToLog,
                deducted: false
            })
        );

        return { 
            success: true, 
            message: `Noted! ₹${numericAmount} advance recorded for ${provider.name}. This will be dynamically deducted from their next month's salary calculation.` 
        };
    }
}

module.exports = new AdvanceService();
