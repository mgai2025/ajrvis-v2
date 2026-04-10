const { google } = require('googleapis');
const crypto = require('crypto');
const db = require('../shared/db');
const botService = require('./telegram.controller'); // to send success messages

const ENCRYPTION_KEY = Buffer.from(process.env.GCAL_ENCRYPTION_KEY || '', 'hex');
const IV_LENGTH = 16;

class GoogleAuthController {
    constructor() {
        this.oauth2Client = new google.auth.OAuth2(
            process.env.GOOGLE_CLIENT_ID,
            process.env.GOOGLE_CLIENT_SECRET,
            process.env.GOOGLE_REDIRECT_URL // Changed from _URI to _URL per previous environment variables
        );

        this.SCOPES = [
            'https://www.googleapis.com/auth/calendar.events',
            'https://www.googleapis.com/auth/gmail.readonly'
            // Skipped contacts.readonly per user feedback
        ];
    }

    /**
     * Helper: Encrypt tokens
     */
    _encrypt(text) {
        if (!text) return text;
        const iv = crypto.randomBytes(IV_LENGTH);
        const cipher = crypto.createCipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
        let encrypted = cipher.update(text);
        encrypted = Buffer.concat([encrypted, cipher.final()]);
        return iv.toString('hex') + ':' + encrypted.toString('hex');
    }

    /**
     * Generates a Google Auth Link for a specific user ID
     */
    generateAuthUrl(userId) {
        return this.oauth2Client.generateAuthUrl({
            access_type: 'offline', // Crucial to get refresh_token
            scope: this.SCOPES,
            state: userId, // We'll receive this back in callback to identify the user
            prompt: 'consent' // Forces consent screen to ensure refresh token is returned
        });
    }

    /**
     * Start the auth flow - redirects user to Google
     */
    async startAuthFlow(req, res) {
        try {
            const userId = req.query.user_id;
            if (!userId) {
                return res.status(400).send('Missing user_id parameter');
            }
            const url = this.generateAuthUrl(userId);
            res.redirect(url);
        } catch (error) {
            console.error('[Google Auth] Start Error:', error);
            res.status(500).send('Failed to start authentication flow.');
        }
    }

    /**
     * Handle Google Callback
     */
    async handleCallback(req, res) {
        try {
            const code = req.query.code;
            const userId = req.query.state; // Passed via state
            const error = req.query.error;

            if (error) {
                console.error('[Google Auth] User explicitly rejected/error:', error);
                return res.status(400).send('Authentication was cancelled or failed.');
            }

            if (!code || !userId) {
                return res.status(400).send('Invalid callback parameters');
            }

            // Exhange code for tokens
            const { tokens } = await this.oauth2Client.getToken(code);
            
            // Encrypt sensitive tokens securely
            const encryptedTokens = {
                access_token: this._encrypt(tokens.access_token),
                refresh_token: tokens.refresh_token ? this._encrypt(tokens.refresh_token) : null, // Not always returned if not prompt=consent
                expiry_date: tokens.expiry_date
            };

            // Fetch user to merge data
            const userParams = await db.executeDbQuery(
                db.supabase.from('users').select('settings, phone').eq('id', userId).single()
            );

            if (!userParams) {
                return res.status(404).send('User not found.');
            }

            let settings = userParams.settings || {};
            const existingGcal = settings.gcal || {};

            // If refresh_token is missing but we already had one, preserve the existing one.
            if (!encryptedTokens.refresh_token && existingGcal.tokens?.refresh_token) {
                encryptedTokens.refresh_token = existingGcal.tokens.refresh_token;
            }

            settings.gcal = {
                connected: true,
                connected_at: new Date().toISOString(),
                calendar_id: 'primary', // Defaulting to primary calendar for MVP
                tokens: encryptedTokens
            };

            // Save to DB
            await db.executeDbQuery(
                db.supabase.from('users').update({ settings }).eq('id', userId)
            );

            // Send polite native app confirmation to user via Telegram
            // We use userParams.phone since phone handles user ID mapping in our bot logic.
            // But if we have Telegram chat IDs, we typically send via phone matching
            try {
                if (botService.bot) {
                     // Get user chat id. For MVP phone is sometimes the chat ID locally, or we find it
                     await botService.bot.sendMessage(userParams.phone, '✅ Google Account connected successfully! I will now sync important tasks and school events to your calendar.');
                }
            } catch (notifyErr) {
                console.error('[Google Auth] Could not notify user via Telegram:', notifyErr.message);
            }

            // Show success page
            res.status(200).send(`
                <html>
                    <body style="font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; background: #f0fdf4;">
                        <h1 style="color: #166534;">✅ Safely Connected</h1>
                        <p style="color: #15803d;">Ajrvis is now synced with your Google Calendar.</p>
                        <p style="color: #15803d;">You can close this window and return to Telegram.</p>
                    </body>
                </html>
            `);

        } catch (error) {
            console.error('[Google Auth] Callback Error:', error);
            res.status(500).send('Authentication processing failed. Please try again later.');
        }
    }
}

module.exports = new GoogleAuthController();
