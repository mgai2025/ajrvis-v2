-- Ajrvis V2 Knowledge Graph (Sprint F)
-- Run this in Supabase SQL Editor to append to your existing database.

-- Enable pgvector for semantic search (COLD retrieval)
CREATE EXTENSION IF NOT EXISTS vector;

-- --------------------------------------------------------
-- 1. THE CONFIGURATION TABLES (Dashboard / Code driven)
-- --------------------------------------------------------

CREATE TABLE kg_system_config (
    config_key VARCHAR PRIMARY KEY,
    config_value JSONB NOT NULL,
    description TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert default limits and thresholds
INSERT INTO kg_system_config (config_key, config_value, description) VALUES
('hot_inject_min_confidence', '0.90', 'Minimum confidence required to inject facts into HOT queries automatically'),
('direct_write_min_confidence', '0.80', 'Minimum phase 1 regex confidence to bypass Phase 2 LLM and write directly'),
('max_tokens_injected_per_prompt', '750', 'Hard limit on token footprint of injected knowledge'),
('food_fact_decay_days', '180', 'How many days before a food preference decays by 0.1 confidence'),
('behavior_fact_decay_days', '120', 'How many days before a behavioral observation decays by 0.1 confidence');

CREATE TABLE kg_trigger_config (
    intent VARCHAR PRIMARY KEY,
    domain_tables VARCHAR[] NOT NULL,
    retrieval_type VARCHAR CHECK (retrieval_type IN ('hot', 'warm', 'cold', 'none')) DEFAULT 'hot',
    entity_field VARCHAR, -- E.g. 'provider_name', 'child_name'
    max_rows INT DEFAULT 3,
    enabled BOOLEAN DEFAULT true,
    persona_scope VARCHAR DEFAULT '*'
);

-- Seed basic trigger config mapping
INSERT INTO kg_trigger_config (intent, domain_tables, retrieval_type, entity_field, max_rows) VALUES
('calculate_salary', ARRAY['kg_finance', 'kg_provider'], 'hot', 'provider_name', 3),
('provider_exception', ARRAY['kg_provider', 'kg_behavior'], 'hot', 'provider_name', 2),
('school_event', ARRAY['kg_health', 'kg_behavior'], 'hot', 'child_name', 2),
('delegate_task', ARRAY['kg_relations', 'kg_behavior'], 'hot', 'provider_name', 2),
('complex_goal', ARRAY['kg_project_context', 'kg_relations', 'kg_behavior', 'kg_food'], 'warm', NULL, 5),
('create_task', ARRAY[]::VARCHAR[], 'none', NULL, 0),
('query_memory', ARRAY['kg_general']::VARCHAR[], 'cold', NULL, 7);

CREATE TABLE kg_extraction_patterns (
    id VARCHAR PRIMARY KEY,
    pattern VARCHAR NOT NULL,
    candidate_table VARCHAR NOT NULL,
    candidate_fact_type VARCHAR NOT NULL,
    subject_group INT NOT NULL,
    detail_group INT NOT NULL,
    initial_confidence FLOAT NOT NULL,
    is_active BOOLEAN DEFAULT true
);

-- Seed Phase 1 extraction regex rules
INSERT INTO kg_extraction_patterns (id, pattern, candidate_table, candidate_fact_type, subject_group, detail_group, initial_confidence) VALUES
('HEALTH_ALLERGY_001', '(?i)(\w+)\s+(?:is allergic to|cannot eat|has allergy to|reacts to)\s+([\w\s]+)', 'kg_health', 'allergy', 1, 2, 0.85),
('FOOD_DISLIKE_001', '(?i)(\w+)\s+(?:hates|does not like|dislikes)\s+([\w\s]+)', 'kg_food', 'dislike', 1, 2, 0.70),
('FOOD_LIKE_001', '(?i)(\w+)\s+(?:loves|likes|enjoys|favorites?)\s+([\w\s]+)', 'kg_food', 'like', 1, 2, 0.70),
('BEHAVIOR_PETPEEVE_001', '(?i)(\w+)\s+(?:hates when|gets mad when|dislikes when)\s+([\w\s]+)', 'kg_behavior', 'pet_peeve', 1, 2, 0.75);

-- --------------------------------------------------------
-- 2. THE STAGING QUEUE (Phase 1 Output -> Phase 2 Input)
-- --------------------------------------------------------
CREATE TABLE kg_extraction_queue (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
    raw_snippet TEXT NOT NULL,
    candidate_table VARCHAR NOT NULL,
    candidate_fact_type VARCHAR NOT NULL,
    subject_extracted VARCHAR NOT NULL,
    detail_extracted VARCHAR NOT NULL,
    pattern_id VARCHAR REFERENCES kg_extraction_patterns(id) ON DELETE SET NULL,
    initial_confidence FLOAT NOT NULL,
    direct_write BOOLEAN DEFAULT false,
    processed_at TIMESTAMP WITH TIME ZONE NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- --------------------------------------------------------
-- 3. THE UNIFIED INDEX HUB (For 90% of Queries & Vector Search)
-- --------------------------------------------------------
CREATE TABLE kg_index (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    subject_name VARCHAR NOT NULL,
    subject_type VARCHAR CHECK (subject_type IN ('person', 'provider', 'child', 'household', 'event', 'system', 'other')) NOT NULL,
    domain_table VARCHAR NOT NULL,
    domain_row_id UUID NOT NULL, -- Logical FK to arbitrary spoke table
    fact_summary TEXT NOT NULL, -- Human-readable string injected directly into LLMs
    confidence FLOAT CHECK (confidence >= 0.0 AND confidence <= 1.0) NOT NULL,
    is_retracted BOOLEAN DEFAULT false,
    expires_at TIMESTAMP WITH TIME ZONE NULL,
    reference_count INT DEFAULT 0,
    source_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
    embedding vector(1536) NULL, -- For future Gemini/OpenAI COLD vector search
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Optimize Hot/Warm searches on the Index table
CREATE INDEX idx_kg_index_lookup ON kg_index(user_id, domain_table, subject_name) WHERE is_retracted = false;

-- --------------------------------------------------------
-- 4. THE DOMAIN SPOKE TABLES (Strictly Typed Data)
-- --------------------------------------------------------

CREATE TABLE kg_health (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    index_id UUID REFERENCES kg_index(id) ON DELETE CASCADE,
    subject_name VARCHAR NOT NULL,
    fact_type VARCHAR CHECK (fact_type IN ('allergy', 'medication', 'blood_group', 'condition')) NOT NULL,
    item VARCHAR NOT NULL, -- E.g. "Peanuts" or "O+ve"
    severity VARCHAR CHECK (severity IN ('mild', 'moderate', 'severe', 'fatal', 'unknown')) DEFAULT 'unknown',
    reaction_type VARCHAR,
    notes TEXT
);

CREATE TABLE kg_food (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    index_id UUID REFERENCES kg_index(id) ON DELETE CASCADE,
    subject_name VARCHAR NOT NULL,
    fact_type VARCHAR CHECK (fact_type IN ('like', 'dislike', 'restriction', 'staple')) NOT NULL,
    item VARCHAR NOT NULL,
    intensity VARCHAR CHECK (intensity IN ('mild', 'strong', 'always', 'never')) DEFAULT 'mild'
);

CREATE TABLE kg_finance (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    index_id UUID REFERENCES kg_index(id) ON DELETE CASCADE,
    subject_name VARCHAR NOT NULL,
    fact_type VARCHAR CHECK (fact_type IN ('budget_cap', 'advance_limit', 'salary_base', 'spend_rule')) NOT NULL,
    amount DECIMAL(10, 2) NOT NULL,
    frequency VARCHAR CHECK (frequency IN ('daily', 'weekly', 'monthly', 'yearly', 'one_time')) DEFAULT 'monthly',
    currency VARCHAR DEFAULT 'INR'
);

CREATE TABLE kg_schedule (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    index_id UUID REFERENCES kg_index(id) ON DELETE CASCADE,
    subject_name VARCHAR NOT NULL,
    fact_type VARCHAR CHECK (fact_type IN ('routine', 'availability', 'habit')) NOT NULL,
    time_window VARCHAR NOT NULL,
    frequency VARCHAR,
    day_of_week VARCHAR
);

CREATE TABLE kg_behavior (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    index_id UUID REFERENCES kg_index(id) ON DELETE CASCADE,
    subject_name VARCHAR NOT NULL,
    fact_type VARCHAR CHECK (fact_type IN ('pet_peeve', 'communication', 'quirk', 'rule')) NOT NULL,
    trigger_condition VARCHAR,
    action_or_reaction VARCHAR NOT NULL
);

CREATE TABLE kg_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    index_id UUID REFERENCES kg_index(id) ON DELETE CASCADE,
    subject_name VARCHAR NOT NULL, -- E.g., "Kynaa's 5th Birthday"
    fact_type VARCHAR CHECK (fact_type IN ('outcome', 'learning', 'template', 'guest_preference')) NOT NULL,
    historical_outcome TEXT NOT NULL,
    sentiment VARCHAR CHECK (sentiment IN ('positive', 'negative', 'neutral')) DEFAULT 'neutral'
);

CREATE TABLE kg_provider (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    index_id UUID REFERENCES kg_index(id) ON DELETE CASCADE,
    subject_name VARCHAR NOT NULL, -- E.g., "Rekha Maid"
    fact_type VARCHAR CHECK (fact_type IN ('quality_flag', 'reliability_score', 'skill', 'quirk')) NOT NULL,
    observation VARCHAR NOT NULL,
    rating INT CHECK (rating >= 1 AND rating <= 5) NULL
);

CREATE TABLE kg_relations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    index_id UUID REFERENCES kg_index(id) ON DELETE CASCADE,
    subject_name VARCHAR NOT NULL, -- E.g. "Mohit"
    fact_type VARCHAR CHECK (fact_type IN ('ownership_domain', 'delegation_target', 'caretaker')) NOT NULL,
    target_entity VARCHAR NOT NULL, -- E.g. "School Events" or "Rahul"
    relationship_context VARCHAR
);

CREATE TABLE kg_contacts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    index_id UUID REFERENCES kg_index(id) ON DELETE CASCADE,
    subject_name VARCHAR NOT NULL,
    fact_type VARCHAR CHECK (fact_type IN ('phone', 'email', 'address', 'location', 'upi_id')) NOT NULL,
    contact_value VARCHAR NOT NULL,
    best_time_to_reach VARCHAR
);

CREATE TABLE kg_project_context (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    index_id UUID REFERENCES kg_index(id) ON DELETE CASCADE,
    subject_name VARCHAR NOT NULL, -- Maps to Goal ID or Goal Title
    fact_type VARCHAR CHECK (fact_type IN ('in_flight_draft', 'temporary_rule', 'vendor_shortlist')) NOT NULL,
    payload JSONB NOT NULL
);

CREATE TABLE kg_general (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    index_id UUID REFERENCES kg_index(id) ON DELETE CASCADE,
    subject_name VARCHAR NOT NULL,
    fact_type VARCHAR NOT NULL, -- Free text catch-all
    payload JSONB NOT NULL
);
