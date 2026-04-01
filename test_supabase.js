require('dotenv').config();
const { supabase } = require('./src/shared/db');

async function testConnection() {
    console.log("Testing Supabase connection...");
    
    setTimeout(() => {
        console.error("Supabase Timeout Triggered (5s)");
        process.exit(1);
    }, 5000);

    const startTime = Date.now();
    try {
        const { data, error } = await supabase.from('users').select('*').limit(1);
        if (error) {
            console.error("Error from Supabase:", error);
        } else {
            console.log("Success! Data:", data);
        }
    } catch (e) {
        console.error("Exception:", e);
    }
    console.log(`Duration: ${Date.now() - startTime}ms`);
    process.exit(0);
}

testConnection();
