require('dotenv').config();
const orchestrator = require('./src/orchestrator/orchestrator.service');
const normalizer = require('./src/normalizer/normalizer.service');

async function run() {
    const mockTelegramEvent = {
        message_id: 111,
        from: { id: 1234567, username: 'testuser' },
        chat: { id: 1234567 },
        date: Math.floor(Date.now() / 1000),
        text: "Remind me to check my task list in 3 minutes"
    };

    const inputEvent = normalizer.fromTelegram(mockTelegramEvent);
    console.log("Input Event:", inputEvent);

    try {
        const response = await orchestrator._routeMessageInternal(inputEvent);
        console.log("Response:", response);
    } catch (e) {
        console.error("CRASH:", e);
    }
}
run();
