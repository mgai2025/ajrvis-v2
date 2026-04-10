const db = require('../src/shared/db');
const orchestrator = require('../src/orchestrator/orchestrator.service');
const userService = require('../src/user/user.service');
const reminderService = require('../src/scheduler/reminder.service');
const llm = require('../src/llm/llm.service');

// Mocking the top-level Supabase client to prevent "Null" crashes
db.supabase = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: {} }) }) }) }) };

async function runValidation() {
    console.log('--- STARTING FIX VALIDATION SUITE ---');

    // 1. Validate BUG-024: Schema Error Interception
    console.log('\n[Test 1] Validating BUG-024: Schema Error Interception...');
    try {
        const mockSchemaErrorPromise = Promise.resolve({ 
            error: { message: 'Could not find column in schema cache', details: 'PostgREST error' } 
        });
        await db.executeDbQuery(mockSchemaErrorPromise);
    } catch (e) {
        if (e.message.includes('System database is currently synchronizing')) {
            console.log('✅ Success: Schema error was intercepted with friendly message.');
        } else {
            console.error('❌ Failure: Schema error returned raw message:', e.message);
        }
    }

    // 2. Validate BUG-020: Eager Context Loading
    console.log('\n[Test 2] Validating BUG-020: Eager Context Loading...');
    const mockUser = {
        id: 'user-020',
        name: 'Mohit',
        service_providers: [{ name: 'Geeta', role: 'maid' }],
        children: [{ name: 'Kynaa' }],
        onboarding_state: 'complete'
    };
    
    // Spy on intent classification
    const originalClassify = llm.classifyIntent;
    let capturedContext = null;
    llm.classifyIntent = async (text, ctx) => {
        capturedContext = ctx;
        return { intents: [{ intent: 'provider_exception', confidence: 1.0, entities: { provider_name: 'Geeta' } }] };
    };

    // Force userService to return our enriched mock
    userService.getUserByPhone = async () => mockUser;

    // We catch and ignore the final routing error (since we didn't mock every service), 
    // we only care about the capturedContext in the first hop.
    try { await orchestrator.routeMessage({ user_phone: '123', raw_text: 'Geeta absent' }); } catch(e) {}

    if (capturedContext && capturedContext.providers && capturedContext.providers.find(p => p.name === 'Geeta')) {
        console.log('✅ Success: "Geeta" (Maid) context injected into Hop 1 classification.');
    } else {
        console.error('❌ Failure: Providers context missing from Hop 1.');
    }

    llm.classifyIntent = originalClassify;

    console.log('\n--- VALIDATION COMPLETE ---');
    process.exit(0);
}

runValidation().catch(e => {
    console.error(e);
    process.exit(1);
});
