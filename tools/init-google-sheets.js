require('dotenv').config();
const { google } = require('googleapis');

// Note: To run this, you need GOOGLE_SHEETS_SERVICE_ACCOUNT_KEY and GOOGLE_SHEETS_ID in your .env
// We parse the JSON string from the .env file

async function initSheets() {
    const serviceAccountJson = process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_KEY;
    const spreadsheetId = process.env.GOOGLE_SHEETS_ID;

    if (!serviceAccountJson || !spreadsheetId) {
        console.error('❌ Missing GOOGLE_SHEETS_SERVICE_ACCOUNT_KEY or GOOGLE_SHEETS_ID in .env');
        process.exit(1);
    }

    let credentials;
    try {
        credentials = JSON.parse(serviceAccountJson);
        if (credentials.private_key) {
            credentials.private_key = credentials.private_key.replace(/\\n/g, '\n');
        }
    } catch (err) {
        console.error('❌ Failed to parse GOOGLE_SHEETS_SERVICE_ACCOUNT_KEY. Ensure it is a valid JSON string.');
        process.exit(1);
    }

    const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });

    const sheets = google.sheets({ version: 'v4', auth });

    const tabsToCreate = [
        { name: 'personas', headers: ['id', 'name', 'description', 'is_active', 'max_providers', 'max_children', 'morning_brief_enabled', 'default_language'] },
        { name: 'categories', headers: ['id', 'persona_id', 'name', 'parent_category_id', 'priority_order', 'is_active', 'description', 'icon_emoji'] },
        { name: 'task_templates', headers: ['id', 'category_id', 'task_type', 'title_template', 'default_priority', 'reminder_days_before', 'default_subtasks', 'subtask_execution_types', 'affiliate_app', 'affiliate_deeplink_template', 'auto_notify_spouse', 'requires_google_calendar', 'requires_google_gmail', 'is_active'] },
        { name: 'heuristics_rules', headers: ['id', 'persona', 'category', 'task_type', 'trigger_keyword', 'rule_type', 'action_type', 'action_params', 'condition', 'response_template', 'priority_order', 'can_override_generic', 'source', 'is_active', 'notes'] },
        { name: 'suggestion_responses', headers: ['id', 'scenario', 'category', 'language', 'response_text', 'tone', 'is_active'] },
        { name: 'affiliate_links', headers: ['id', 'app_name', 'app_slug', 'category', 'base_deeplink', 'search_deeplink_template', 'affiliate_token', 'is_available_cities', 'priority_order', 'is_active'] }
    ];

    try {
        console.log('Fetching existing sheets...');
        const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
        const existingSheets = spreadsheet.data.sheets.map(s => s.properties.title);

        for (const tab of tabsToCreate) {
            // 1. Create tab if it doesn't exist
            if (!existingSheets.includes(tab.name)) {
                console.log(`Creating tab: ${tab.name}`);
                await sheets.spreadsheets.batchUpdate({
                    spreadsheetId,
                    resource: {
                        requests: [{
                            addSheet: { properties: { title: tab.name } }
                        }]
                    }
                });
            } else {
                console.log(`Tab ${tab.name} already exists. Skipping creation.`);
            }

            // 2. Write headers
            console.log(`Writing headers for: ${tab.name}`);
            await sheets.spreadsheets.values.update({
                spreadsheetId,
                range: `${tab.name}!A1`,
                valueInputOption: 'USER_ENTERED',
                resource: {
                    values: [tab.headers]
                }
            });

            // 3. Optional formatting (make headers bold)
            try {
                // To do formatting we need the sheetId which requires fetching properties again
                // For simplicity of this initialization script, we will skip advanced formatting.
            } catch (e) {}
        }

        console.log('✅ Google Sheets Initialization Complete!');
        
    } catch (error) {
        console.error('❌ Error initializing sheets:', error.message);
    }
}

initSheets();
