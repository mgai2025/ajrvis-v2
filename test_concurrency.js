require('dotenv').config();
const orchestrator = require('./src/orchestrator/orchestrator.service');
const normalizer = require('./src/normalizer/normalizer.service');

async function testConcurrency() {
    console.log("Testing Concurrency...");
    
    const messages = ['hello', 'pay mobile bill by april 5', 'math exam on friday'];
    
    // Simulate what telegram polling does: concurrent async calls
    messages.forEach(async (text) => {
        const msg = {
            chat: { id: 420240189 },
            from: { id: 420240189, first_name: 'Test' },
            text: text,
            date: Date.now()
        };
        const inputEvent = normalizer.fromTelegram(msg);
        console.log(`[Test] Launching message: ${text}`);
        try {
            const resp = await orchestrator.routeMessage(inputEvent);
            console.log(`[Test] Finished message: ${text} -> ${resp.substring(0, 15)}...`);
        } catch(e) {
            console.error(`[Test] Exception for ${text}:`, e);
        }
    });

    setTimeout(() => {
        console.log("Finished test window");
        process.exit(0);
    }, 10000);
}

testConcurrency();
