const { executeDbQuery, supabase } = require('../shared/db');

class UserService {
    constructor() {
        this.supabase = supabase;
    }

    /**
     * Get a user by their phone number
     */
    async getUserByPhone(phone) {
        if (!supabase) return this._mockGetUser(phone);
        
        const data = await executeDbQuery(
            supabase.from('users').select('*').eq('phone', phone).maybeSingle()
        );
        return data;
    }

    /**
     * Create a new primary user
     */
    async createUser(phone) {
        if (!supabase) return this._mockCreateUser(phone);

        const data = await executeDbQuery(
            supabase.from('users').insert([{ 
                phone, 
                role: 'primary',
                onboarding_state: 'new',
                settings: {}
            }]).select().single()
        );
        return data;
    }

    /**
     * Update user details (name, state, settings)
     */
    async updateUser(id, updates) {
        if (!supabase) return true;

        const data = await executeDbQuery(
            supabase.from('users').update(updates).eq('id', id).select().single()
        );
        return data;
    }

    /**
     * Create a secondary user (e.g., spouse)
     */
    async createSecondaryUser(primaryPhone, spouseName, spousePhone) {
        if (!supabase) return { id: 'mock-spouse-uuid' };

        // Supabase requires a phone number. If omitted, generate a pseudo one.
        const phoneToUse = spousePhone || `${primaryPhone}-spouse-${Date.now()}`;

        const data = await executeDbQuery(
            supabase.from('users').insert([{ 
                phone: phoneToUse, 
                name: spouseName,
                role: 'secondary',
                onboarding_state: 'complete' // Secondary doesn't need to onboard household
            }]).select().single()
        );
        return data;
    }

    /**
     * Add a child profile
     */
    async addChild(userId, name, age = null) {
        if (!supabase) return true;

        let dob = null;
        if (age && !isNaN(age)) {
            const date = new Date();
            date.setFullYear(date.getFullYear() - age);
            dob = date.toISOString().split('T')[0];
        }

        const data = await executeDbQuery(
            supabase.from('children').insert([{ user_id: userId, name }]).select().single()
        );
        return data;
    }

    /**
     * Mocks for local development before Supabase is connected
     */
    _mockDb = {};

    _mockGetUser(phone) {
        return this._mockDb[phone] || null;
    }

    _mockCreateUser(phone) {
        const newUser = {
            id: 'mock-uuid-' + Date.now(),
            phone,
            role: 'primary',
            onboarding_state: 'new',
            settings: {}
        };
        this._mockDb[phone] = newUser;
        return newUser;
    }
}

module.exports = new UserService();
