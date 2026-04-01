const { executeDbQuery, supabase } = require('../shared/db');

class MemoryService {

    /**
     * Silently locks inbound texts and outbound AI replies into the message buffer.
     */
    async logMessage(userId, content, direction, metadata = {}) {
        if (!supabase) return; // Don't crash if DB is mocked
        if (!userId || !content) return;

        try {
            await executeDbQuery(
                supabase.from('messages').insert({
                    user_id: userId,
                    content: content,
                    direction: direction, 
                    content_type: 'text',
                    intent: metadata.intent || null,
                    intent_confidence: metadata.confidence || null
                })
            );
        } catch (e) {
            console.error('[MemoryService] Failed to log message:', e);
            // Non-critical, swallow error to keep user loop alive
        }
    }

    /**
     * Retrieves the last X messages and formats them cleanly for the Context-Hop.
     */
    async getShortTermContext(userId, limit = 5) {
        if (!supabase) return "No history available (DB mock mode).";

        try {
            const msgs = await executeDbQuery(
                supabase.from('messages')
                    .select('content, direction, created_at')
                    .eq('user_id', userId)
                    .order('created_at', { ascending: false })
                    .limit(limit)
            );

            if (!msgs || msgs.length === 0) return "No prior conversational history.";

            // Database sorts DESC so the newest is at index 0. We must reverse it so LLM reads chronologically.
            const chronological = msgs.reverse();
            
            let contextString = "";
            chronological.forEach(m => {
                const speaker = m.direction === 'inbound' ? 'User' : 'Ajrvis';
                contextString += `[${m.created_at}] ${speaker}: ${m.content}\n`;
            });

            return contextString;
        } catch (e) {
            console.error('[MemoryService] Failed to fetch history:', e);
            return "History retrieval failed.";
        }
    }

}

module.exports = new MemoryService();
