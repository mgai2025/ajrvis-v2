require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

(async () => {
    try {
        console.log("Checking model availability...");
        const msg = await anthropic.messages.create({
            model: "claude-3-haiku-20240307",
            max_tokens: 10,
            messages: [{ role: "user", content: "hi" }]
        });
        console.log("Haiku Success! Content:", msg.content[0].text);
    } catch (e) {
        console.log("Haiku Failed:", e.message);
    }

    try {
        const msg = await anthropic.messages.create({
            model: "claude-3-5-sonnet-20240620",
            max_tokens: 10,
            messages: [{ role: "user", content: "hi" }]
        });
        console.log("Sonnet Success!");
    } catch (e) {
        console.log("Sonnet Failed:", e.message);
    }
})();
