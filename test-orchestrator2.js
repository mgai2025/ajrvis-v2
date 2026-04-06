require('dotenv').config();
const orchestrator = require('./src/orchestrator/orchestrator.service');
const normalizer = require('./src/normalizer/normalizer.service');
const userService = require('./src/user/user.service');

async function run() {
    const mockTelegramEvent = {
        message_id: 111,
        from: { id: 9999999, username: 'testuser_real' },
        chat: { id: 9999999 },
        date: Math.floor(Date.now() / 1000),
        text: "Remind me to check my task list in 3 minutes"
    };

    const inputEvent = normalizer.fromTelegram(mockTelegramEvent);
    console.log("Input Event:", inputEvent);

    try {
        let user = await userService.getUserByPhone(inputEvent.user_phone);
        if(!user) {
            user = await userService.createUser(inputEvent.user_phone);
            await userService.updateUser(user.id, { onboarding_state: 'complete', name: 'Tester' });
        }
        const response = await orchestrator._routeMessageInternal(inputEvent);
        console.log("Response:", response);
    } catch (e) {
        console.error("CRASH:", e);
    }
}
run();
