// E2E Simulation for MVP Sprints 1, 2, and 3
require('dotenv').config();
const { supabase, executeDbQuery } = require('../src/shared/db');
const orchestrator = require('../src/orchestrator/orchestrator.service');
const delegationService = require('../src/tasks/delegation.service');
const taskService = require('../src/tasks/task.service');

async function runMVPTest() {
    console.log("🚀 STARTING MVP FEATURES E2E VERIFICATION...");

    try {
        // 1. Get/Create a test primary user (Mom)
        let { data: mom } = await supabase.from('users').select('*').eq('phone', '9999999999').maybeSingle();
        if (!mom) {
            console.log("📝 Creating Test Primary User (Mom)...");
            mom = await executeDbQuery(supabase.from('users').insert([{ 
                phone: '9999999999', name: 'Nitika', role: 'primary', onboarding_state: 'complete' 
            }]).select().single());
        }

        // Clean up any old test tasks
        await supabase.from('tasks').delete().eq('user_id', mom.id);
        console.log("🧹 Cleaned up old test data.");

        // --- TEST A: MULTI-TASK PARSING ---
        console.log("\n🧪 TEST A: Multi-Task Parsing");
        console.log("📨 Input: 'Remind me to buy milk and call the cook at 5pm'");
        const multiTaskStart = Date.now();
        const multiReply = await orchestrator.routeMessage({ user_phone: mom.phone, raw_text: "Remind me to buy milk and call the cook at 5pm" });
        const multiDuration = Date.now() - multiTaskStart;
        console.log(`🤖 Bot Reply: ${multiReply}`);
        console.log(`⏱️ Multi-Task Latency: ${multiDuration}ms`);

        const { data: tasksAfterMulti } = await supabase.from('tasks').select('*').eq('user_id', mom.id);
        console.log(`📊 Tasks Created: ${tasksAfterMulti.length} (Expected: 2)`);
        if (tasksAfterMulti.length >= 2) console.log("✅ Multi-task success!");

        // --- TEST B: OPEN-LOOP DELEGATION ---
        console.log("\n🧪 TEST B: Open-Loop Delegation (Assign to non-existent user)");
        console.log("📨 Input: 'Ask Ananya to pick up tickets tomorrow'");
        const delegReply = await orchestrator.routeMessage({ user_phone: mom.phone, raw_text: "Ask Ananya to pick up tickets tomorrow" });
        console.log(`🤖 Bot Reply: ${delegReply}`);

        const { data: delegTask } = await supabase.from('tasks').select('*').eq('user_id', mom.id).eq('title', 'Pick up tickets').maybeSingle();
        console.log(`📊 Task Assigned To: ${delegTask.assigned_to || 'NULL (Expected for open-loop)'}`);
        if (delegTask && delegTask.assigned_to === null) console.log("✅ Open-loop draft success!");

        // --- TEST C: GUEST SELF-REGISTRATION & CLAIMING ---
        console.log("\n🧪 TEST C: Guest Self-Registration & Claiming");
        const guestPseudoPhone = "TG-GUEST-" + Date.now();
        console.log(`👤 Simulating Guest (ID: ${guestPseudoPhone}) clicking deep-link for task: ${delegTask.id}`);

        // We simulate the controller logic for acceptance
        let guestUser = await executeDbQuery(supabase.from('users').insert({ 
            phone: guestPseudoPhone, 
            name: 'Ananya',
            role: 'secondary',
            onboarding_state: 'complete'
        }).select().single());

        const acceptReply = await delegationService.acceptDelegation(guestUser, delegTask.id);
        console.log(`🤖 Bot Reply to Guest: ${acceptReply}`);

        const { data: updatedTask } = await supabase.from('tasks').select('*').eq('id', delegTask.id).single();
        console.log(`📊 Task Status: ${updatedTask.status} (Expected: scheduled)`);
        console.log(`📊 Task Assigned To: ${updatedTask.assigned_to} (Expected: ${guestUser.id})`);
        
        if (updatedTask.status === 'scheduled' && updatedTask.assigned_to === guestUser.id) {
            console.log("✅ Guest Self-Registration & Claiming success!");
        }

        // --- TEST D: UNIFIED BUCKET VIEW ---
        console.log("\n🧪 TEST D: Unified Bucket View");
        const momDashboard = await orchestrator.routeMessage({ user_phone: mom.phone, raw_text: "show my tasks" });
        console.log("📋 --- MOM's DASHBOARD ---");
        console.log(momDashboard);
        console.log("📋 -----------------------");

        const guestDashboard = await orchestrator.routeMessage({ user_phone: guestUser.phone, raw_text: "what is pending" });
        console.log("📋 --- GUEST'S DASHBOARD ---");
        console.log(guestDashboard);
        console.log("📋 -------------------------");

        console.log("\n🏁 MVP VERIFICATION COMPLETE!");
        process.exit(0);

    } catch (e) {
        console.error("❌ MVP TEST CRASHED:", e);
        process.exit(1);
    }
}

runMVPTest();
