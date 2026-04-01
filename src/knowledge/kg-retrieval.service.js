const { supabase } = require('../shared/db');

class KnowledgeGraphRetrievalService {
    /**
     * Executes the Multi-Tier Retrieval Strategy.
     * Returns a string of compiled facts to inject into the LLM context.
     * 
     * @param {String} userId - The active user
     * @param {Object} intentResult - Classified intent { intent, entities }
     */
    async getFactContextForPrompt(userId, intentResult) {
        if (!supabase) return "";

        const intent = intentResult.intent;
        const confidenceThreshold = 0.70; // Hardcoded default, IRL read from kg_system_config

        try {
            // 1. Check GATE: Do we even need KG for this intent?
            const { data: config, error } = await supabase
                .from('kg_trigger_config')
                .select('*')
                .eq('intent', intent)
                .eq('enabled', true)
                .single();

            // Zero queries wasted if no config or retrieval_type == 'none'
            if (error || !config || config.retrieval_type === 'none') {
                return "";
            }

            let facts = [];

            // 2. 🔴 HOT Retrieval: Entity-Scoped
            if (config.retrieval_type === 'hot' || config.retrieval_type === 'warm') {
                // Determine the entity name to scope to
                const entityName = config.entity_field ? intentResult.entities[config.entity_field] : null;

                if (entityName) {
                    const { data: hotRows, error: hotErr } = await supabase
                        .from('kg_index')
                        .select('fact_summary, confidence')
                        .eq('user_id', userId)
                        .eq('subject_name', entityName)
                        .in('domain_table', config.domain_tables)
                        .eq('is_retracted', false)
                        .gte('confidence', confidenceThreshold)
                        .order('reference_count', { ascending: false })
                        .limit(config.max_rows || 3);

                    if (!hotErr && hotRows) {
                        facts.push(...hotRows.map(r => r.fact_summary));
                    }
                }
            }

            // 3. 🟡 WARM Retrieval: Domain-Scoped (No specific entity)
            if (config.retrieval_type === 'warm' && facts.length < (config.max_rows || 5)) {
                const { data: warmRows, error: warmErr } = await supabase
                    .from('kg_index')
                    .select('fact_summary, confidence')
                    .eq('user_id', userId)
                    .in('domain_table', config.domain_tables)
                    .eq('is_retracted', false)
                    .gte('confidence', Math.max(0.50, confidenceThreshold - 0.15)) // Less rigorous
                    .order('reference_count', { ascending: false })
                    .limit(config.max_rows - facts.length);

                if (!warmErr && warmRows) {
                    // Filter out dupes
                    warmRows.forEach(r => {
                        if (!facts.includes(r.fact_summary)) facts.push(r.fact_summary);
                    });
                }
            }

            // 4. Return formatted string map
            if (facts.length === 0) return "";
            
            return `\n\nSYSTEM MEMORY INJECTIONS (Must adhere):\n- ${facts.join('\n- ')}`;

        } catch (e) {
            console.error('[KG Retrieval] Retrieval engine failure:', e);
            return ""; // Fallback gracefully if database fails
        }
    }
}

module.exports = new KnowledgeGraphRetrievalService();
