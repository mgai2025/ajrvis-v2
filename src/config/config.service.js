const { google } = require('googleapis');
const { executeDbQuery, supabase } = require('../shared/db');

class ConfigService {
    constructor() {
        this.sheets = null;
        this.spreadsheetId = process.env.GOOGLE_SHEETS_ID;
    }

    /**
     * Initialize Google Sheets Client
     */
    initClient() {
        const serviceAccountJson = process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_KEY;
        
        if (!serviceAccountJson || !this.spreadsheetId) {
            console.warn('[ConfigLoader] Missing Google Sheets credentials. Skipping sync.');
            return false;
        }

        try {
            const credentials = JSON.parse(serviceAccountJson);
            if (credentials.private_key) {
                credentials.private_key = credentials.private_key.replace(/\\n/g, '\n');
            }
            const auth = new google.auth.GoogleAuth({
                credentials,
                scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
            });
            this.sheets = google.sheets({ version: 'v4', auth });
            return true;
        } catch (error) {
            console.error('[ConfigLoader] Error parsing service account JSON:', error);
            return false;
        }
    }

    /**
     * Map sheet rows (array of strings) to JSON objects using headers
     */
    parseSheetData(rows) {
        if (!rows || rows.length === 0) return [];
        
        const headers = rows[0];
        const data = [];

        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            const obj = {};
            headers.forEach((header, index) => {
                let val = row[index] !== undefined ? row[index] : null;
                
                // Convert string representing boolean to actual boolean (for is_active)
                if (val === 'TRUE' || val === 'true') val = true;
                if (val === 'FALSE' || val === 'false') val = false;
                
                obj[header] = val;
            });
            data.push(obj);
        }
        return data;
    }

    /**
     * Pull data from Google Sheets and Upsert into Supabase
     */
    async syncAll() {
        if (!this.initClient()) {
            return { success: false, message: 'Google Sheets not configured' };
        }
        
        if (!supabase) {
            return { success: false, message: 'Supabase not configured' };
        }

        console.log('[ConfigLoader] Starting Google Sheets Sync...');
        
        const sheetsList = [
            { tabName: 'personas', tableName: 'personas' },
            { tabName: 'categories', tableName: 'categories' },
            { tabName: 'task_templates', tableName: 'task_templates' },
            { tabName: 'heuristics_rules', tableName: 'heuristics_rules' },
            { tabName: 'suggestion_responses', tableName: 'suggestion_responses' },
            { tabName: 'affiliate_links', tableName: 'affiliate_links' }
        ];

        try {
            for (const sheet of sheetsList) {
                console.log(`[ConfigLoader] Syncing ${sheet.tabName}...`);
                
                const response = await this.sheets.spreadsheets.values.get({
                    spreadsheetId: this.spreadsheetId,
                    range: `${sheet.tabName}!A1:Z1000`, // Reasonable limit for config
                });

                const parsedData = this.parseSheetData(response.data.values);
                
                if (parsedData.length > 0) {
                    // Supabase Upsert based on 'id' primary key
                    await executeDbQuery(supabase.from(sheet.tableName).upsert(parsedData, { onConflict: 'id' }));
                    console.log(`[ConfigLoader] Successfully synced ${parsedData.length} rows to ${sheet.tableName}`);
                } else {
                    console.log(`[ConfigLoader] No data found in ${sheet.tabName}`);
                }
            }
            return { success: true, message: 'Sync complete' };

        } catch (error) {
            console.error('[ConfigLoader] Sync failed:', error);
            return { success: false, message: 'Sync failed: ' + error.message };
        }
    }
}

module.exports = new ConfigService();
