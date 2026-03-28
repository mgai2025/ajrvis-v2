require('dotenv').config();
const llm = require('./src/llm/llm.service');

async function testV2() {
    process.env.DEVELOPMENT_MODE = 'true';
    console.log("--- Testing Conversational Response (Conciseness < 15 words) ---");
    try {
        const response = await llm.generateConversationalResponse("How's the weather today, Ajrvis?", { name: "Mohit" });
        console.log("Ajrvis Response:", response);
        const wordCount = response.split(' ').length;
        console.log("Word Count:", wordCount);
        if (wordCount < 15) {
            console.log("✅ Conciseness Check Passed!");
        } else {
            console.log("❌ Conciseness Check Failed (Too long)!");
        }
    } catch (e) {
        console.error("Test Failed:", e.message);
    }
}

testV2();
