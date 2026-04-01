const { supabase } = require('../shared/db');
const llmService = require('../llm/llm.service');

class KnowledgeGraphDistillerService {
    /**
     * Phase 2 (Nightly Batch): Processes the Extraction Queue.
     * High confidence -> written directly to KG.
     * Low confidence -> swept by LLM for validation.
     * To be triggered by App Scheduler cron at 2 AM.
     */
    async runNightlyDistillation() {
        if (!supabase) return;

        console.log('[KG Distiller] Starting nightly Knowledge Graph distillation...');

        try {
            // 1. Fetch un-processed queue
            const { data: queue, error } = await supabase
                .from('kg_extraction_queue')
                .select('*')
                .is('processed_at', null);

            if (error || !queue || queue.length === 0) {
                console.log('[KG Distiller] No pending items in extraction queue.');
                return;
            }

            // Split work map
            const directWrites = queue.filter(q => q.direct_write === true);
            const llmValidationQueue = queue.filter(q => q.direct_write === false);

            console.log(`[KG Distiller] Found ${directWrites.length} Direct Writes, ${llmValidationQueue.length} LLM validational items.`);

            // 2. Perform Direct Writes
            for (const item of directWrites) {
                await this._commitFactToKG(item.user_id, item.candidate_table, item.subject_extracted, item.candidate_fact_type, item.detail_extracted, item.initial_confidence, item.message_id);
                await this._markQueueProcessed(item.id);
            }

            // 3. LLM Batch Validation Sweep for lower-confidence tier
            if (llmValidationQueue.length > 0) {
                console.log(`[KG Distiller] Running LLM validation sweep on ${llmValidationQueue.length} fuzzy items...`);
                // Batch limits for prompt size management (e.g. 50 items per prompt)
                const BATCH_LIMIT = 50;
                for (let i = 0; i < llmValidationQueue.length; i += BATCH_LIMIT) {
                    const batch = llmValidationQueue.slice(i, i + BATCH_LIMIT);
                    const llmResults = await llmService.evaluateKnowledgeBatch(batch);
                    
                    if (llmResults && Array.isArray(llmResults)) {
                        for (const llmRes of llmResults) {
                            // Link result back to the original queue item
                            const originalItem = batch.find(q => q.id === llmRes.id);
                            if (!originalItem) continue;

                            if (llmRes.is_valid !== false && llmRes.confidence >= 0.50) {
                                // Commit the LLM-cleaned and verified fact to the Database
                                await this._commitFactToKG(
                                    originalItem.user_id, 
                                    originalItem.candidate_table, 
                                    originalItem.subject_extracted, 
                                    originalItem.candidate_fact_type, 
                                    llmRes.cleaned_detail || originalItem.detail_extracted, 
                                    llmRes.confidence, 
                                    originalItem.message_id
                                );
                            }
                        }
                    } else {
                        console.warn('[KG Distiller] LLM batch resulted in malformed/empty response.');
                    }
                    
                    // Always mark the entire batch as processed to avoid infinite loops on LLM failure
                    for (const item of batch) {
                        await this._markQueueProcessed(item.id);
                    }
                }
            }

            console.log('[KG Distiller] Nightly Distillation Complete!');

        } catch (e) {
            console.error('[KG Distiller] Exception during distillation:', e);
        }
    }

    async _commitFactToKG(userId, domainTable, subject, factType, payloadOrItem, confidence, messageId) {
        // Step A: Write to Domain Table (e.g. kg_health)
        const domainRow = {
            subject_name: subject,
            fact_type: factType,
            // Simple MVP mapping - more robust schema mapping would exist IRL
            [domainTable === 'kg_health' || domainTable === 'kg_food' ? 'item' : 'observation']: payloadOrItem
        };

        const { data: insertedDomain, error: domainErr } = await supabase
            .from(domainTable)
            .insert([domainRow])
            .select('id')
            .single();

        if (domainErr) {
            console.warn(`[KG Distiller] Failed to insert to domain table ${domainTable}:`, domainErr);
            return;
        }

        // Step B: Write to Index Hub
        const summary = `${subject} regarding ${factType}: ${payloadOrItem}`;
        
        // Base Subject Type logic MVP
        let subjectType = 'other';
        if (domainTable === 'kg_health' || domainTable === 'kg_food') subjectType = 'person';
        if (domainTable === 'kg_provider') subjectType = 'provider';

        const indexRow = {
            user_id: userId,
            subject_name: subject,
            subject_type: subjectType,
            domain_table: domainTable,
            domain_row_id: insertedDomain.id,
            fact_summary: summary,
            confidence: confidence,
            source_message_id: messageId
        };

        const { error: indexErr } = await supabase
            .from('kg_index')
            .insert([indexRow]);

        if (indexErr) {
            console.error(`[KG Distiller] Failed to write index row:`, indexErr);
        }
    }

    async _markQueueProcessed(queueId) {
        await supabase
            .from('kg_extraction_queue')
            .update({ processed_at: new Date().toISOString() })
            .eq('id', queueId);
    }
}

module.exports = new KnowledgeGraphDistillerService();
