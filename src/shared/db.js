const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

let supabase = null;

if (supabaseUrl && supabaseKey) {
    // Determine whether to use service_role key or anon key. 
    // In our backend, using service_role is better as the API Gateway handles authentication.
    supabase = createClient(supabaseUrl, supabaseKey, {
        auth: {
            persistSession: false,
            autoRefreshToken: false,
        }
    });
} else {
    // For local dev when not running DB yet, we can mock it
    console.warn('Supabase URL or Key is missing. Database operations will fail unless mocked.');
}

/**
 * Universal wrapper for Supabase queries to standardize error handling
 */
const executeDbQuery = async (queryPromise) => {
    if (!supabase) {
        throw new Error('Supabase client not initialized (check ENV variables)');
    }
    const { data, error } = await queryPromise;
    if (error) {
        console.error('Database Error:', error.message, error.details);
        if (error.message && error.message.includes('schema cache')) {
            // BUG-024 FIX: Catch PostgREST Schema Cache mismatches and provide a user-friendly fallback
            throw new Error('System database is currently synchronizing updates. Please wait a minute and try again.');
        }
        throw error;
    }
    return data;
};

module.exports = {
    supabase,
    executeDbQuery
};
