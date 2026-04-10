const { google } = require('googleapis');
const db = require('../shared/db');
const googleCalendarService = require('./google-calendar.service');
const llmService = require('../llm/llm.service');

class GmailIntelligenceService {
    
    async _getGmailClient(userId) {
        const userParams = await db.executeDbQuery(
            db.supabase.from('users').select('settings').eq('id', userId).single()
        );

        if (!userParams || !userParams.settings || !userParams.settings.gcal || !userParams.settings.gcal.connected) {
            return null;
        }

        const gcalSettings = userParams.settings.gcal;
        if (!gcalSettings.tokens || !gcalSettings.tokens.access_token) return null;

        const decryptedAccessToken = googleCalendarService._decrypt(gcalSettings.tokens.access_token);
        const decryptedRefreshToken = gcalSettings.tokens.refresh_token ? googleCalendarService._decrypt(gcalSettings.tokens.refresh_token) : null;

        const oauth2Client = new google.auth.OAuth2(
            process.env.GOOGLE_CLIENT_ID,
            process.env.GOOGLE_CLIENT_SECRET,
            process.env.GOOGLE_REDIRECT_URL
        );

        oauth2Client.setCredentials({
            access_token: decryptedAccessToken,
            refresh_token: decryptedRefreshToken,
            expiry_date: gcalSettings.tokens.expiry_date
        });

        return google.gmail({ version: 'v1', auth: oauth2Client });
    }

    /**
     * Set up Gmail Push Notifications for the user
     */
    async setupGmailWatch(userId) {
        const gmail = await this._getGmailClient(userId);
        if (!gmail) return { success: false, reason: 'not_connected' };

        try {
            const res = await gmail.users.watch({
                userId: 'me',
                requestBody: {
                    labelIds: ['INBOX'], // Only primary inbox
                    labelFilterAction: 'include',
                    topicName: 'projects/ajrvis/topics/gmail-notifications' // Needs actual GCP Pub/Sub Topic!
                }
            });
            return { success: true, historyId: res.data.historyId };
        } catch (error) {
            console.error(`[Gmail] Watch Setup Failed for ${userId}:`, error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * Triggered by Webhook when a new email arrives
     */
    async processNewEmail(userId, historyId) {
        const gmail = await this._getGmailClient(userId);
        if (!gmail) return;

        try {
            // Get user's whitelist settings
            const userParams = await db.executeDbQuery(
                db.supabase.from('users').select('settings').eq('id', userId).single()
            );
            const whitelist = userParams?.settings?.gmail_whitelist || [];

            if (whitelist.length === 0) return; // Silent abort if no whitelist

            // Since this API expects history scanning, for MVP we'll just check "latest unread from whitelist"
            // A perfect implementation queries historyId changes, but a simple list is more robust for MVP
            for (const domain of whitelist) {
                const query = `from:${domain} is:unread`;
                const res = await gmail.users.messages.list({
                    userId: 'me',
                    q: query,
                    maxResults: 5 // Only look at last 5 unread
                });

                const messages = res.data.messages || [];
                for (const msg of messages) {
                    await this._extractAndAct(userId, gmail, msg.id, domain);
                }
            }

        } catch (error) {
           console.error('[Gmail] Email Processing Failed:', error.message);
        }
    }

    async _extractAndAct(userId, gmail, messageId, matchedDomain) {
        try {
            const emailFull = await gmail.users.messages.get({
                userId: 'me',
                id: messageId,
                format: 'full'
            });

            const headers = emailFull.data.payload.headers;
            const subject = headers.find(h => h.name.toLowerCase() === 'subject')?.value || 'No Subject';
            
            // Mark as read so we don't process it repeatedly
            await gmail.users.messages.modify({
                userId: 'me',
                id: messageId,
                requestBody: { removeLabelIds: ['UNREAD'] }
            });

            // 1. LLM Extraction Layer! We use Flash explicitly here (via intent parsing or custom prompt).
            let emailText = "Email content snippet..."; 
            // In a real payload we parse parts.body.data from base64
            
            // Note: Full implementation of Flash extraction will happen in Document Intelligence (Sprint II-A).
            // This is the skeleton for Sprint II-C.
            console.log(`[Gmail] Processed trusted email from ${matchedDomain}: ${subject}`);

        } catch (error) {
            console.error(`[Gmail] Processing Message ${messageId} Failed:`, error.message);
        }
    }
}

module.exports = new GmailIntelligenceService();
