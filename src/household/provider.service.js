const { executeDbQuery, supabase } = require('../shared/db');

class ProviderService {
    /**
     * Log an absence, half-day, or exception for a domestic helper
     */
    async logAttendance(userId, providerName, dateStr, status) {
        // Perform a semantic search to find either the name OR the role (e.g. 'cook')
        const providersOpt = await executeDbQuery(
            supabase.from('service_providers')
                .select('*')
                .eq('user_id', userId)
                .or(`name.ilike.%${providerName}%,role.ilike.%${providerName}%`)
                .limit(1)
        );

        if (!providersOpt || providersOpt.length === 0) {
            // Provide an incredibly graceful fallback instead of an error message
            return { 
                success: false, 
                message: `I couldn't find a domestic helper specifically named "${providerName}" in your employee directory.` 
            };
        }

        const provider = providersOpt[0];

        // Insert the actual SQL row into the Attendance Log
        await executeDbQuery(
            supabase.from('provider_attendance').insert({
                provider_id: provider.id,
                date: dateStr || new Date().toISOString().split('T')[0], // Fallback to today UTC
                status: status || 'absent',
                logged_by: 'system'
            })
        );

        return { 
            success: true, 
            message: `Noted. I've officially marked ${provider.name} as ${status} for ${dateStr || new Date().toISOString().split('T')[0]}.`,
            providerRole: provider.role
        };
    }

    /**
     * Create an actionable Micro-Task assigned strictly to an employee
     */
    async delegateTaskToProvider(userId, providerName, taskTitle) {
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
                message: `I couldn't find a helper named "${providerName}" to assign this task to.` 
            };
        }

        const provider = providersOpt[0];

        // We embed the provider metadata dynamically into the `description` column 
        // to bypass the static Users ForeignKey constraint on `assigned_to`
        const delegationPayload = JSON.stringify({
            assignedProviderId: provider.id,
            assignedProviderName: provider.name,
            delegatedDate: new Date().toISOString()
        });

        await executeDbQuery(
            supabase.from('tasks').insert({
                user_id: userId,
                title: taskTitle,
                description: delegationPayload,
                type: 'delegated',
                status: 'created',
                priority: 'medium',
                source_channel: 'telegram'
            })
        );

        return { 
            success: true, 
            message: `Done! I've assigned the task "${taskTitle}" directly to ${provider.name}.` 
        };
    }
}

module.exports = new ProviderService();
