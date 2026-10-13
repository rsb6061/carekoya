-- Opt-in auto-apply: CareJoys applies to a few of a caregiver's best matches each day (src/applyAgent.ts runAutoApply).
-- Nothing runs until the Worker's AUTO_APPLY_ENABLED is "true".
ALTER TABLE caregivers ADD COLUMN auto_apply INTEGER NOT NULL DEFAULT 0;
ALTER TABLE caregivers ADD COLUMN auto_apply_updated_at TEXT;
-- Who started an Apply for me run: the caregiver's click ('caregiver') or the daily auto-apply ('auto').
ALTER TABLE apply_agent_sessions ADD COLUMN source TEXT NOT NULL DEFAULT 'caregiver';
