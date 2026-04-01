require('dotenv').config();
const orchestrator = require('./src/orchestrator/orchestrator.service');
const normalizer = require('./src/normalizer/normalizer.service');

async function testOrchestrator() {
    console.log("Testing Orchestrator...");
    
    // Simulate incoming msg
    const msg = {
        chat: { id: 420240189 },
        from: { id: 420240189, first_name: 'Mohit' },
        text: 'hello',
        date: Date.now()
    };
    
    const inputEvent = normalizer.fromTelegram(msg);
    console.log("InputEvent:", inputEvent);

    try {
        const responseText = await orchestrator.routeMessage(inputEvent);
        console.log("Response text:", responseText);
    } catch (e) {
        console.error("Exception:", e);
    }
    process.exit(0);
}

testOrchestrator();
