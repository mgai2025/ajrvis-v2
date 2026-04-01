const { supabase } = require('../shared/db');

class KnowledgeGraphScannerService {
    /**
     * Phase 1 (Real-time): Scans inbound text against heuristics
     * Runs completely off the critical path (fire-and-forget).
     */
    async scanInboundMessage(userId, messageId, rawText) {
        if (!supabase) return; // Silent skip if DB not connected
        
        try {
            // 1. Fetch active extraction patterns
            // In a production app, this would be heavily cached in memory via ConfigLoader
            const { data: patterns, error } = await supabase
                .from('kg_extraction_patterns')
                .select('*')
                .eq('is_active', true);

            if (error || !patterns) return;

            // 2. Evaluate patterns
            const queueWrites = [];

            for (const rule of patterns) {
                // Safely convert SQL string regex to JS regex
                // e.g. '(?i)(\w+)\s+is allergic to\s+([\w\s]+)'
                let patternString = rule.pattern;
                let flags = '';
                
                // Extremely simple parser for basic inline flags like (?i)
                if (patternString.startsWith('(?i)')) {
                    flags = 'i';
                    patternString = patternString.substring(4);
                }
                
                const regex = new RegExp(patternString, flags);
                const match = rawText.match(regex);

                if (match) {
                    // match[0] is the full matched string
                    // match[rule.subject_group] is the subject (e.g., 'Kynaa')
                    // match[rule.detail_group] is the detail (e.g., 'peanuts')
                    
                    if (match.length > Math.max(rule.subject_group, rule.detail_group)) {
                        const subject = match[rule.subject_group].trim();
                        const detail = match[rule.detail_group].trim();
                        
                        // Check if direct write applies
                        // (Assuming direct_write_min_confidence is 0.80 from config)
                        const directWrite = rule.initial_confidence >= 0.80;

                        queueWrites.push({
                            user_id: userId,
                            message_id: messageId,
                            raw_snippet: match[0],
                            candidate_table: rule.candidate_table,
                            candidate_fact_type: rule.candidate_fact_type,
                            subject_extracted: subject,
                            detail_extracted: detail,
                            pattern_id: rule.id,
                            initial_confidence: rule.initial_confidence,
                            direct_write: directWrite
                        });
                    }
                }
            }

            // 3. Write to tracking queue
            if (queueWrites.length > 0) {
                const { error: insertError } = await supabase
                    .from('kg_extraction_queue')
                    .insert(queueWrites);
                
                if (insertError) {
                    console.error('[KG Scanner] Phase 1 ingest failed:', insertError);
                } else {
                    console.log(`[KG Scanner] Flagged ${queueWrites.length} facts to extraction queue for User ${userId}`);
                }
            }

        } catch (e) {
            // Must never crash the orchestrator
            console.error('[KG Scanner] Deep exception during scan:', e);
        }
    }
}

module.exports = new KnowledgeGraphScannerService();
