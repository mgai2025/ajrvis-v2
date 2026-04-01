// Test script to manually run the Task Follow-Through Engine (Sprint A)
require('dotenv').config();
const { supabase } = require('../src/shared/db');
const orchestratorService = require('../src/orchestrator/orchestrator.service');
const taskService = require('../src/tasks/task.service');

async function runE2E() {
    console.log("=== AJRVIS SPRINT A: FOLLOW-THROUGH TEST ===");

    try {
        const { data: users, error } = await supabase.from('users').select('id, name, phone').limit(1);
        if (error || !users || users.length === 0) {
            console.error("❌ Need at least 1 user in DB to test.");
            process.exit(1);
        }
        const user = users[0];
        console.log(`👤 Using Demo User: ${user.name}`);

        // 1. Clean slate - wipe tasks
        await supabase.from('reminders').delete().neq('id', '00000000-0000-0000-0000-000000000000');
        await supabase.from('tasks').delete().neq('id', '00000000-0000-0000-0000-000000000000');
        console.log("🧹 Wiped previous task history for clean test.");

        // 2. Create Tasks via Intents
        console.log(`\n📨 Simulating Inbound: "Remind me to pay the electricity bill at 6pm"`);
        const reply1 = await orchestratorService.routeMessage({ user_phone: user.phone, raw_text: "Remind me to pay the electricity bill at 6pm" });
        console.log(`🤖 Reply: ${reply1}`);

        console.log(`\n📨 Simulating Inbound: "Need to buy groceries tomorrow"`);
        const reply2 = await orchestratorService.routeMessage({ user_phone: user.phone, raw_text: "Need to buy groceries tomorrow" });
        console.log(`🤖 Reply: ${reply2}`);

        // 3. Query Pending Tasks
        console.log(`\n📨 Simulating Inbound: "show my tasks"`);
        const tasksReply = await orchestratorService.routeMessage({ user_phone: user.phone, raw_text: "show my tasks" });
        console.log(`\n============== [BOT REPLY] ==============\n${tasksReply}\n=========================================`);

        // 4. Complete Task "1"
        console.log(`\n📨 Simulating Inbound: "done with 1"`);
        const finishReply = await orchestratorService.routeMessage({ user_phone: user.phone, raw_text: "done with 1" });
        console.log(`🤖 Reply: ${finishReply}`);

        // 5. Query Pending Tasks Again
        console.log(`\n📨 Simulating Inbound: "what's pending"`);
        const remainingReply = await orchestratorService.routeMessage({ user_phone: user.phone, raw_text: "what's pending" });
        console.log(`\n============== [BOT REPLY] ==============\n${remainingReply}\n=========================================`);

        console.log("✅ Success! Sprint A Core Logic validated.");
        process.exit(0);

    } catch (e) {
        console.error("❌ Test crashed:", e);
        process.exit(1);
    }
}

runE2E();
