// Test for Morning Brief Generation
require('dotenv').config();
const { supabase } = require('../src/shared/db');
const taskQueryService = require('../src/tasks/task-query.service');

async function testBrief() {
    console.log("🕒 TESTING MORNING BRIEF GENERATION...");

    try {
        const { data: users } = await supabase.from('users').select('*').eq('role', 'primary').limit(1);
        if (!users || users.length === 0) {
            console.error("❌ Need a primary user in DB.");
            process.exit(1);
        }
        const user = users[0];

        const brief = await taskQueryService.buildMorningBrief(user);
        console.log("\n--- [MORNING BRIEF OUTPUT] ---");
        console.log(brief);
        console.log("-------------------------------\n");

        if (brief.includes(user.name)) {
            console.log("✅ Morning Brief generated successfully!");
        } else {
            console.log("❌ Morning Brief missing user name.");
        }
        process.exit(0);
    } catch (e) {
        console.error("❌ Brief Generation Failed:", e);
        process.exit(1);
    }
}

testBrief();
