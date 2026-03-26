require('dotenv').config();
const llm = require('../src/llm/llm.service');

async function run() {
    console.log("Testing Converse...");
    try {
        const res = await llm.generateConversationalResponse("Do you know my name?", { name: 'Mohit' });
        console.log("SUCCESS:", res);
    } catch (e) {
        console.error("FAIL:", e);
    }
}
run();
