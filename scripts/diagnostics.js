require('dotenv').config();
const llm = require('../src/llm/llm.service.js');

async function runDiagnostics() {
    console.log('\n=============================================');
    console.log('       AJRVIS V2 - MASTER AI DIAGNOSTICS      ');
    console.log('=============================================');
    console.log(`Development Mode (ENV): ${process.env.DEVELOPMENT_MODE}`);
    console.log(`Haiku Model (ENV): ${process.env.CLAUDE_HAIKU_ID}`);
    console.log('---------------------------------------------\n');

    // 1. Test Haiku (The Daily Driver)
    console.log('[TEST 1] Testing HAIKU (The Daily Driver)...');
    try {
        const res = await llm._callClaude('Reply in 3 words: Haiku is active.', process.env.CLAUDE_HAIKU_ID);
        console.log('RESULT:', res);
    } catch (e) {
        console.error('FAILED:', e.message);
    }

    // 2. Test Sonnet (The Strategic Brain)
    console.log('\n[TEST 2] Testing SONNET (The Strategic Brain)...');
    try {
        const res = await llm._callClaude('Reply in 3 words: Sonnet is active.', 'claude-sonnet-4-6');
        console.log('RESULT:', res);
    } catch (e) {
        console.error('FAILED:', e.message);
    }

    // 3. Test Gemini 2.5 Flash (The Safety Net)
    console.log('\n[TEST 3] Testing GEMINI 2.5 FLASH (The Safety Net)...');
    try {
        const res = await llm._callGemini('Reply in 3 words: Flash is active.', 'gemini-2.5-flash');
        console.log('RESULT:', res);
    } catch (e) {
        console.error('FAILED:', e.message);
    }

    // 4. Test Waterfall Failover (Intentional Break)
    console.log('\n[TEST 4] Testing WATERFALL FAILOVER (Simulated Outage)...');
    const originalSonnet = llm.claudeSonnet;
    const originalHaiku = llm.claudeHaiku;
    llm.claudeSonnet = 'BROKEN_ID';
    llm.claudeHaiku = 'BROKEN_ID';

    try {
        const res = await llm.generateConversationalResponse('Say SUCCESS if failover worked.');
        console.log('RESULT:', res);
    } catch (e) {
        console.error('FAILED:', e.message);
    } finally {
        llm.claudeSonnet = originalSonnet;
        llm.claudeHaiku = originalHaiku;
    }

    // 5. Test Rule #25 (Conciseness Guard)
    console.log('\n[TEST 5] Testing RULE #25 (Conciseness Guard)...');
    try {
        const res = await llm.generateConversationalResponse('Tell me a very long story about a cat, but stay under 20 words.');
        console.log('RESULT:', res);
        const count = res.split(' ').length;
        console.log(`WORD COUNT: ${count} / 20`);
    } catch (e) {
        console.error('FAILED:', e.message);
    }

    console.log('\n=============================================');
    console.log('           DIAGNOSTICS COMPLETE              ');
    console.log('=============================================');
}

runDiagnostics();
