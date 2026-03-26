const userService = require('./user.service');
const llmService = require('../llm/llm.service');

/**
 * Manages the sequential onboarding flow for a new user.
 */
class OnboardingController {
    
    /**
     * Process the next step in the onboarding flow based on current state
     * @param {Object} user - The current user record
     * @param {Object} inputEvent - The normalized input event (text)
     * @returns {String} responseText - The message to send back to the user
     */
    async processState(user, inputEvent) {
        const text = inputEvent.raw_text.trim();

        switch (user.onboarding_state) {
            case 'new':
                return this.handleNewState(user);
            
            case 'name_collected':
                return await this.handleNameCollectedState(user, text);
            
            case 'family_setup':
                return await this.handleFamilySetupState(user, text);
            
            case 'providers_setup':
                return await this.handleProvidersSetupState(user, text);
            
            default:
                // If somehow called with complete state
                return "You are already onboarded! What can I help you with?";
        }
    }

    async handleNewState(user) {
        // We just created the user. Ask for their name and update state so we don't ask again.
        await userService.updateUser(user.id, { onboarding_state: 'name_collected' });
        return "Hi! I'm Ajrvis, your household Chief of Staff.\nWhat should I call you?";
    }

    async handleNameCollectedState(user, text) {
        // Use LLM to extract the exact name
        const nameData = await llmService.extractEntities(text, 'name');
        const cleanName = nameData.name || text;
        
        await userService.updateUser(user.id, { 
            name: cleanName,
            onboarding_state: 'family_setup'
        });

        return `Hi ${cleanName}! Who else is in your family?\n(e.g. "husband Rahul, son Aryan age 8")`;
    }

    async handleFamilySetupState(user, text) {
        // 1. Extract and store family members using LLM
        const family = await llmService.extractEntities(text, 'family');
        
        for (const member of family) {
            if (member.role === 'spouse') {
                await userService.createSecondaryUser(user.phone, member.name || 'Spouse', null);
            } else if (member.role === 'child') {
                await userService.addChild(user.id, member.name || 'Child', member.age);
            }
        }
        
        await userService.updateUser(user.id, { 
            onboarding_state: 'providers_setup'
        });

        return "Got it. Do you have any household help?\n(e.g. \"maid Geeta, cook Ramesh\")";
    }

    async handleProvidersSetupState(user, text) {
        // 1. Extract and store providers using LLM
        const providers = await llmService.extractEntities(text, 'provider');
        
        if (userService.supabase && providers.length > 0) {
            const validRoles = ['maid', 'cook', 'driver', 'nanny', 'tutor', 'watchman', 'gardener', 'other'];

            const providerRecords = providers.map(p => {
                let exactRole = p.role || 'other';
                let cleanRole = exactRole.toLowerCase();
                if (!validRoles.includes(cleanRole)) {
                    // special mapping
                    if (cleanRole.includes('teach') || cleanRole.includes('tuition')) cleanRole = 'tutor';
                    else if (cleanRole.includes('nanny') || cleanRole.includes('babysit')) cleanRole = 'nanny';
                    else cleanRole = 'other';
                }

                // If it's a completely custom role (e.g. Speech Doctor), we preserve it in the name so the AI never gets confused!
                const finalName = (cleanRole === 'other' && exactRole.toLowerCase() !== 'other') 
                    ? `${p.name || 'Helper'} (${exactRole})` 
                    : (p.name || 'Helper');

                return {
                    user_id: user.id,
                    name: finalName,
                    role: cleanRole,
                    is_active: true,
                    base_pay: 0 // Required NOT NULL in schema
                };
            });
            const { error } = await userService.supabase.from('service_providers').insert(providerRecords);
            if (error) console.error("Error inserting providers:", error);
        }

        await userService.updateUser(user.id, { 
            onboarding_state: 'complete',
            settings: { ...user.settings, morning_brief_time: "07:30" }
        });

        return "All set, " + user.name + "! Morning brief scheduled for 7:30 AM.\nYou can now just tell me anything — \"remind me to pay fees\", \"Geeta nahi aayegi kal\", or \"what's on today?\"";
    }
}

module.exports = new OnboardingController();
