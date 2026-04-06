-- Ajrvis V2 Core Supabase Schema (PostgreSQL)
-- Run this in the Supabase SQL Editor to create your tables.

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Core Tables
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    phone VARCHAR UNIQUE NOT NULL,
    name VARCHAR,
    role VARCHAR CHECK (role IN ('primary', 'secondary')) DEFAULT 'primary',
    onboarding_state VARCHAR CHECK (onboarding_state IN ('new', 'name_collected', 'family_setup', 'providers_setup', 'complete')) DEFAULT 'new',
    settings JSONB DEFAULT '{}',
    conversation_state JSONB DEFAULT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE family_relationships (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    primary_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    secondary_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    relationship_type VARCHAR CHECK (relationship_type IN ('spouse', 'parent', 'other')) DEFAULT 'spouse',
    status VARCHAR CHECK (status IN ('pending', 'active', 'revoked')) DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE goals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR NOT NULL,
    status VARCHAR CHECK (status IN ('active', 'completed', 'cancelled')) DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE tasks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    goal_id UUID REFERENCES goals(id) ON DELETE SET NULL,
    title VARCHAR NOT NULL,
    description TEXT,
    type VARCHAR CHECK (type IN ('simple', 'scheduled', 'recurring', 'delegated', 'approval_pending')) DEFAULT 'simple',
    status VARCHAR CHECK (status IN ('created', 'scheduled', 'in_progress', 'pending_approval', 'pending_acceptance', 'completed', 'missed', 'escalated')) DEFAULT 'created',
    priority VARCHAR CHECK (priority IN ('low', 'medium', 'high')) DEFAULT 'medium',
    due_date TIMESTAMP WITH TIME ZONE,
    recurrence_rule VARCHAR,
    assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
    parent_task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
    requires_approval BOOLEAN DEFAULT false,
    approval_action JSONB,
    source_channel VARCHAR DEFAULT 'whatsapp',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE subtasks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
    title VARCHAR NOT NULL,
    status VARCHAR CHECK (status IN ('pending', 'completed')) DEFAULT 'pending',
    execution_type VARCHAR CHECK (execution_type IN ('autonomous', 'approval_required')) DEFAULT 'autonomous',
    order_index INT DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    content_type VARCHAR CHECK (content_type IN ('text', 'voice', 'image')) DEFAULT 'text',
    raw_payload JSONB,
    intent VARCHAR,
    intent_confidence FLOAT,
    parsed BOOLEAN DEFAULT false,
    direction VARCHAR CHECK (direction IN ('inbound', 'outbound')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE reminders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
    remind_at TIMESTAMP WITH TIME ZONE NOT NULL,
    type VARCHAR CHECK (type IN ('pre', 'exact', 'followup', 'escalation')) DEFAULT 'pre',
    status VARCHAR CHECK (status IN ('pending', 'processing', 'sent', 'cancelled')) DEFAULT 'pending',
    attempt_count INT DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE activity_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    entity_type VARCHAR CHECK (entity_type IN ('task', 'goal', 'reminder', 'provider', 'user', 'system')),
    entity_id UUID,
    action VARCHAR NOT NULL,
    actor VARCHAR CHECK (actor IN ('user', 'system')),
    metadata JSONB,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Household & Provider Tables
CREATE TABLE service_providers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR NOT NULL,
    role VARCHAR CHECK (role IN ('maid', 'cook', 'driver', 'nanny', 'tutor', 'watchman', 'gardener', 'other')) NOT NULL,
    work_days VARCHAR[], -- Array of days e.g., ['Mon', 'Tue']
    visits_per_day INT DEFAULT 1,
    time_slots VARCHAR CHECK (time_slots IN ('morning', 'evening', 'both')),
    pay_type VARCHAR CHECK (pay_type IN ('monthly', 'per_visit', 'per_hour')) DEFAULT 'monthly',
    base_pay DECIMAL(10, 2) NOT NULL,
    allowed_leaves_per_month INT DEFAULT 2,
    contact_phone VARCHAR,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE provider_attendance (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    provider_id UUID REFERENCES service_providers(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    status VARCHAR CHECK (status IN ('present', 'absent', 'half_day', 'extra_day')) DEFAULT 'present',
    note VARCHAR,
    logged_by VARCHAR CHECK (logged_by IN ('user', 'system')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE provider_advances (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    provider_id UUID REFERENCES service_providers(id) ON DELETE CASCADE,
    amount DECIMAL(10, 2) NOT NULL,
    reason VARCHAR,
    date DATE NOT NULL,
    deducted BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE provider_payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    provider_id UUID REFERENCES service_providers(id) ON DELETE CASCADE,
    month VARCHAR NOT NULL, -- Format: YYYY-MM
    base_pay DECIMAL(10, 2) NOT NULL,
    working_days_expected INT NOT NULL,
    working_days_actual INT NOT NULL,
    deductions DECIMAL(10, 2) DEFAULT 0,
    advance_deducted DECIMAL(10, 2) DEFAULT 0,
    bonus DECIMAL(10, 2) DEFAULT 0,
    total_payable DECIMAL(10, 2) NOT NULL,
    status VARCHAR CHECK (status IN ('calculated', 'paid')) DEFAULT 'calculated',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. School & Kids Tables
CREATE TABLE children (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR NOT NULL,
    school_name VARCHAR,
    grade VARCHAR,
    section VARCHAR,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE school_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    child_id UUID REFERENCES children(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR NOT NULL,
    type VARCHAR CHECK (type IN ('ptm', 'exam', 'fee', 'uniform', 'holiday', 'activity', 'other')),
    event_date DATE NOT NULL,
    reminder_days INT[] DEFAULT '{7,3,1}',
    notes TEXT,
    linked_task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. Config / Rules Tables
CREATE TABLE personas (
    id VARCHAR PRIMARY KEY,
    name VARCHAR NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    max_providers INT DEFAULT 10,
    max_children INT DEFAULT 5,
    morning_brief_enabled BOOLEAN DEFAULT true,
    default_language VARCHAR DEFAULT 'hinglish'
);

CREATE TABLE categories (
    id VARCHAR PRIMARY KEY,
    persona_id VARCHAR REFERENCES personas(id) ON DELETE CASCADE,
    name VARCHAR NOT NULL,
    parent_category_id VARCHAR REFERENCES categories(id),
    priority_order INT NOT NULL,
    is_active BOOLEAN DEFAULT true,
    description TEXT,
    icon_emoji VARCHAR
);

CREATE TABLE task_templates (
    id VARCHAR PRIMARY KEY,
    category_id VARCHAR REFERENCES categories(id) ON DELETE CASCADE,
    task_type VARCHAR NOT NULL,
    title_template VARCHAR NOT NULL,
    default_priority VARCHAR CHECK (default_priority IN ('low', 'medium', 'high')) DEFAULT 'medium',
    reminder_days_before VARCHAR NOT NULL,
    default_subtasks JSONB,
    subtask_execution_types VARCHAR,
    affiliate_app VARCHAR,
    affiliate_deeplink_template VARCHAR,
    auto_notify_spouse BOOLEAN DEFAULT false,
    requires_google_calendar BOOLEAN DEFAULT false,
    requires_google_gmail BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true
);

CREATE TABLE heuristics_rules (
    id VARCHAR PRIMARY KEY,
    persona VARCHAR NOT NULL, -- Can be '*'
    category VARCHAR NOT NULL, -- Can be '*'
    task_type VARCHAR,
    trigger_keyword VARCHAR,
    rule_type VARCHAR CHECK (rule_type IN ('action', 'safety', 'suggestion', 'guardrail', 'bonus')) NOT NULL,
    action_type VARCHAR NOT NULL,
    action_params JSONB,
    condition VARCHAR,
    response_template TEXT,
    priority_order INT NOT NULL,
    can_override_generic BOOLEAN DEFAULT false,
    source VARCHAR CHECK (source IN ('spreadsheet', 'hardcoded')) DEFAULT 'spreadsheet',
    is_active BOOLEAN DEFAULT true,
    notes TEXT
);

CREATE TABLE suggestion_responses (
    id VARCHAR PRIMARY KEY,
    scenario VARCHAR NOT NULL,
    category VARCHAR REFERENCES categories(id) ON DELETE CASCADE,
    language VARCHAR CHECK (language IN ('en', 'hi', 'hinglish', 'all')) NOT NULL,
    response_text TEXT NOT NULL,
    tone VARCHAR CHECK (tone IN ('decisive', 'empathetic', 'urgent', 'neutral')) NOT NULL,
    is_active BOOLEAN DEFAULT true
);

CREATE TABLE affiliate_links (
    id VARCHAR PRIMARY KEY,
    app_name VARCHAR NOT NULL,
    app_slug VARCHAR NOT NULL,
    category VARCHAR CHECK (category IN ('grocery', 'food', 'home_services', 'pharmacy', 'other')),
    base_deeplink VARCHAR NOT NULL,
    search_deeplink_template VARCHAR,
    affiliate_token VARCHAR,
    is_available_cities VARCHAR,
    priority_order INT NOT NULL,
    is_active BOOLEAN DEFAULT true
);
