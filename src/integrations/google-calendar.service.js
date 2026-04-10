const { google } = require('googleapis');
const crypto = require('crypto');
const db = require('../shared/db');

const ENCRYPTION_KEY = Buffer.from(process.env.GCAL_ENCRYPTION_KEY || '', 'hex');
const IV_LENGTH = 16;

class GoogleCalendarService {
    constructor() {
        this.oauth2Client = new google.auth.OAuth2(
            process.env.GOOGLE_CLIENT_ID,
            process.env.GOOGLE_CLIENT_SECRET,
            process.env.GOOGLE_REDIRECT_URL
        );
    }

    _decrypt(text) {
        if (!text) return null;
        try {
            let textParts = text.split(':');
            let iv = Buffer.from(textParts.shift(), 'hex');
            let encryptedText = Buffer.from(textParts.join(':'), 'hex');
            let decipher = crypto.createDecipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
            let decrypted = decipher.update(encryptedText);
            decrypted = Buffer.concat([decrypted, decipher.final()]);
            return decrypted.toString();
        } catch (e) {
            console.error('[GCal] Decryption failed:', e.message);
            return null;
        }
    }

    async _getAuthenticatedClient(userId) {
        const userParams = await db.executeDbQuery(
            db.supabase.from('users').select('settings').eq('id', userId).single()
        );

        if (!userParams || !userParams.settings || !userParams.settings.gcal || !userParams.settings.gcal.connected) {
            return null;
        }

        const gcalSettings = userParams.settings.gcal;
        const tokens = gcalSettings.tokens;

        if (!tokens || !tokens.access_token) return null;

        const decryptedAccessToken = this._decrypt(tokens.access_token);
        const decryptedRefreshToken = tokens.refresh_token ? this._decrypt(tokens.refresh_token) : null;

        this.oauth2Client.setCredentials({
            access_token: decryptedAccessToken,
            refresh_token: decryptedRefreshToken,
            expiry_date: tokens.expiry_date
        });

        // Automatically trigger refresh logic when executing calls via this client.
        // Google APIs node client handles refreshing internally if refresh_token is set.
        // We capture new tokens and save them.
        this.oauth2Client.on('tokens', async (newTokens) => {
            const encryptedAccess = this._encryptSync(newTokens.access_token);
            let gcalUpdate = { ...gcalSettings };
            gcalUpdate.tokens.access_token = encryptedAccess;
            if (newTokens.expiry_date) {
               gcalUpdate.tokens.expiry_date = newTokens.expiry_date;
            }
            if (newTokens.refresh_token) {
               gcalUpdate.tokens.refresh_token = this._encryptSync(newTokens.refresh_token);
            }
            
            let updatedSettings = { ...userParams.settings, gcal: gcalUpdate };
            await db.executeDbQuery(
                db.supabase.from('users').update({ settings: updatedSettings }).eq('id', userId)
            );
        });

        return google.calendar({ version: 'v3', auth: this.oauth2Client });
    }

    _encryptSync(text) {
        if (!text) return text;
        const iv = crypto.randomBytes(IV_LENGTH);
        const cipher = crypto.createCipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
        let encrypted = cipher.update(text);
        encrypted = Buffer.concat([encrypted, cipher.final()]);
        return iv.toString('hex') + ':' + encrypted.toString('hex');
    }

    /**
     * Creates an event in the user's primary calendar
     */
    async createEvent(userId, taskData) {
        const calendar = await this._getAuthenticatedClient(userId);
        if (!calendar) return { success: false, reason: 'not_connected' };

        try {
            // Build the event
            const eventStartTime = taskData.due_date ? new Date(taskData.due_date) : new Date();
            // Default 1 hour duration
            const eventEndTime = new Date(eventStartTime.getTime() + 60 * 60 * 1000); 

            const resource = {
                summary: `Ajrvis: ${taskData.title}`,
                description: taskData.description || 'Added systematically by Ajrvis Household Bot.',
                start: {
                    dateTime: eventStartTime.toISOString()
                },
                end: {
                    dateTime: eventEndTime.toISOString()
                }
            };

            const response = await calendar.events.insert({
                calendarId: 'primary',
                resource: resource,
            });

            return { success: true, eventId: response.data.id, link: response.data.htmlLink };
        } catch (error) {
            console.error('[GCal] Create Event Failed:', error.message);
            if (error.code === 401 || error.code === 403) {
                 await this._revokeConnection(userId);
            }
            return { success: false, error: error.message };
        }
    }

    /**
     * Checks conflict blocks around a given date
     */
    async getConflicts(userId, targetDateIso) {
        const calendar = await this._getAuthenticatedClient(userId);
        if (!calendar) return null;

        try {
            const targetTime = new Date(targetDateIso);
            const startWindow = new Date(targetTime.getTime() - 2 * 60 * 60 * 1000); // 2 hours before
            const endWindow = new Date(targetTime.getTime() + 2 * 60 * 60 * 1000); // 2 hours after

            const response = await calendar.events.list({
                calendarId: 'primary',
                timeMin: startWindow.toISOString(),
                timeMax: endWindow.toISOString(),
                singleEvents: true,
                orderBy: 'startTime'
            });

            const events = response.data.items;
            return events.length > 0 ? events : [];
        } catch (error) {
            console.error('[GCal] Get Conflicts Failed:', error.message);
            return null;
        }
    }

    /**
     * Deletes an event
     */
    async deleteEvent(userId, eventId) {
        const calendar = await this._getAuthenticatedClient(userId);
        if (!calendar || !eventId) return;

        try {
            await calendar.events.delete({
                calendarId: 'primary',
                eventId: eventId
            });
        } catch (error) {
            console.error('[GCal] Delete Event Failed:', error.message);
        }
    }

    async _revokeConnection(userId) {
        const userParams = await db.executeDbQuery(
            db.supabase.from('users').select('settings').eq('id', userId).single()
        );
        if (userParams?.settings) {
            let settings = userParams.settings;
            settings.gcal = {
                connected: false,
                revoked_at: new Date().toISOString()
            };
            await db.executeDbQuery(db.supabase.from('users').update({ settings }).eq('id', userId));
        }
    }
}

module.exports = new GoogleCalendarService();
