const { executeDbQuery, supabase } = require('../shared/db');

class SalaryService {
    /**
     * Mathematically Calculates Salary for a domestic provider natively without LLM hallucinations.
     * PRD Logic:
     * - Monthly Salary: Base Pay - (Unpaid Absences * Per Day Rate) - Advances
     * - Unpaid Absences = Total Absences - Allowed Leaves (min 0)
     * - Per Day Rate = Base Pay / 30
     */
    async calculateSalary(userId, providerName, targetMonthStr = null) {
        if (!supabase) return { success: false, message: 'DB not connected' };

        // 1. Resolve Provider
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
                message: `I couldn't find a helper named "${providerName}" to calculate the salary for.`
            };
        }

        const provider = providersOpt[0];

        // Currently we only support "monthly" pay_type in this MVP sprint.
        if (provider.pay_type !== 'monthly') {
            return {
                success: false,
                message: `Currently, I only support deterministic salary calculations for 'monthly' salaried providers. ${provider.name} is marked as '${provider.pay_type}'.`
            };
        }

        // 2. Validate Financial Profile
        if (!provider.base_pay || parseFloat(provider.base_pay) <= 0) {
            return {
                success: false,
                message: `I cannot calculate ${provider.name}'s salary because their base monthly pay is not configured in your settings yet. Please update their profile first.`
            };
        }

        // 3. Define Date Ranges
        const targetDate = targetMonthStr ? new Date(targetMonthStr) : new Date();
        const year = targetDate.getFullYear();
        const month = targetDate.getMonth() + 1; // 1-12
        
        const monthStrStr = `${year}-${String(month).padStart(2, '0')}`; // YYYY-MM
        const firstDayStr = `${year}-${String(month).padStart(2, '0')}-01`;
        
        // Quick way to get last day of month
        const nextMonth = new Date(year, month, 1);
        const lastDay = new Date(nextMonth - 1);
        const lastDayStr = lastDay.toISOString().split('T')[0];

        // 3. Aggregate Absences
        const absences = await executeDbQuery(
            supabase.from('provider_attendance')
                .select('*')
                .eq('provider_id', provider.id)
                .gte('date', firstDayStr)
                .lte('date', lastDayStr)
                .eq('status', 'absent')
        );

        const totalAbsences = absences ? absences.length : 0;
        const allowedLeaves = provider.allowed_leaves_per_month || 0;
        
        let unpaidAbsences = totalAbsences - allowedLeaves;
        if (unpaidAbsences < 0) unpaidAbsences = 0; // No carry forward allowed for now (Backlog feature)

        // Math: Per Day Rate (Hardcoded / 30 as requested)
        const basePay = parseFloat(provider.base_pay || 0);
        const perDayRate = basePay / 30;
        const absenceDeduction = unpaidAbsences * perDayRate;

        // 4. Aggregate Outstanding Advances
        const advancesOpts = await executeDbQuery(
            supabase.from('provider_advances')
                .select('*')
                .eq('provider_id', provider.id)
                .eq('deducted', false)
        );

        let advanceDeduction = 0;
        let advancesDesc = [];
        if (advancesOpts && advancesOpts.length > 0) {
            advancesOpts.forEach(adv => {
                advanceDeduction += parseFloat(adv.amount || 0);
                advancesDesc.push(`₹${adv.amount} (${adv.reason})`);
            });
        }

        // 5. Final Mathematical Tally
        const totalPayable = basePay - absenceDeduction - advanceDeduction;

        // Optionally, store the calculation for historical tracking:
        await executeDbQuery(
            supabase.from('provider_payments').insert({
                provider_id: provider.id,
                month: monthStrStr,
                base_pay: basePay,
                working_days_expected: 30,
                working_days_actual: 30 - totalAbsences,
                deductions: absenceDeduction,
                advance_deducted: advanceDeduction,
                total_payable: totalPayable,
                status: 'calculated'
            })
        );
        
        // If we saved it to history, we mark the advances as deducted so they don't roll over again.
        if (advancesOpts && advancesOpts.length > 0) {
            const advanceIds = advancesOpts.map(a => a.id);
            await executeDbQuery(
                supabase.from('provider_advances')
                    .update({ deducted: true })
                    .in('id', advanceIds)
            );
        }

        // 6. Build the detailed string response
        let msg = `*Salary Calculation for ${provider.name} (${monthStrStr}):*\n`;
        msg += `• Base Pay: ₹${basePay}\n`;
        msg += `• Leaves Taken: ${totalAbsences} / ${allowedLeaves} allowed\n`;
        
        if (unpaidAbsences > 0) {
            msg += `• Unpaid Absences: ${unpaidAbsences} (Deduction: -₹${absenceDeduction.toFixed(2)})\n`;
        }

        if (advanceDeduction > 0) {
            msg += `• Cash Advances Deducted: -₹${advanceDeduction} [${advancesDesc.join(', ')}]\n`;
        }
        
        msg += `\n*Total Payable = ₹${totalPayable.toFixed(2)}*`;

        return { success: true, message: msg };
    }
}

module.exports = new SalaryService();
