// Test script to manually run the Knowledge Graph flow End-to-End
require('dotenv').config();
const { supabase } = require('../src/shared/db');
const kgScanner = require('../src/knowledge/kg-scanner.service');
const kgDistiller = require('../src/knowledge/kg-distiller.service');
const kgRetrieval = require('../src/knowledge/kg-retrieval.service');

async function runE2ETest() {
    console.log("=== AJRVIS KNOWLEDGE GRAPH E2E TEST ===");
    console.log("Note: You must have run db.knowledge_graph.sql in Supabase first.\n");

    try {
        // 1. Fetch a demo user
        const { data: users, error } = await supabase.from('users').select('id, name, phone').limit(1);
        if (error || !users || users.length === 0) {
            console.error("❌ Need at least 1 user in the DB to run test.");
            process.exit(1);
        }
        const user = users[0];
        console.log(`👤 Using Demo User: ${user.name} (${user.id})`);

        // 2. Mock an inbound message hitting the scanner (Phase 1)
        const msg = "Hey, Kynaa is allergic to peanuts.";
        console.log(`\n📨 Simulating Inbound Message: "${msg}"`);

        await kgScanner.scanInboundMessage(user.id, null, msg);
        console.log(`✅ Phase 1: Scanner executed.`);

        // 3. Verify it hit the queue
        const { data: queue } = await supabase.from('kg_extraction_queue').select('*').eq('user_id', user.id).is('processed_at', null);
        console.log(`📋 Checked Queue: Found ${queue ? queue.length : 0} pending items.`);

        // 4. Force run the Nightly Distiller (Phase 2)
        console.log(`\n🌙 Forcing Nightly Distiller Run...`);
        await kgDistiller.runNightlyDistillation();

        // 5. Test Retrieval for a Task Context (HOT Query)
        console.log(`\n🔍 Simulating 'Cook Pasta for Kynaa' (intent=school_event context demo)...`);

        const intentResult = {
            intent: "school_event", // Leveraging this mapped intent for testing entity scoping
            entities: { child_name: "Kynaa" }
        };

        const injectedContext = await kgRetrieval.getFactContextForPrompt(user.id, intentResult);

        console.log("\n=== 🧠 INJECTED CONTEXT RESULT ===");
        if (injectedContext) {
            console.log(injectedContext);
        } else {
            console.log("No facts retrieved (Are tables empty or trigger config disabled?)");
        }
        console.log("==================================\n");

        console.log("✅ E2E Knowledge Graph test completed gracefully.");
        process.exit(0);

    } catch (e) {
        console.error("❌ Test crashed:", e);
        process.exit(1);
    }
}

runE2ETest();
