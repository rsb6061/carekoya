ALTER TABLE agencies ADD COLUMN jurisdiction TEXT;
ALTER TABLE agencies ADD COLUMN contact_name TEXT;
ALTER TABLE agencies ADD COLUMN provider_type TEXT;
ALTER TABLE agencies ADD COLUMN organization_key TEXT;
ALTER TABLE agencies ADD COLUMN caregiver_relevance_score INTEGER NOT NULL DEFAULT 0;
ALTER TABLE agencies ADD COLUMN caregiver_match_eligible INTEGER NOT NULL DEFAULT 0;
ALTER TABLE agencies ADD COLUMN source_as_of_date TEXT;

CREATE INDEX IF NOT EXISTS idx_agencies_org_key ON agencies(organization_key, is_active);
CREATE INDEX IF NOT EXISTS idx_agencies_caregiver_relevance ON agencies(caregiver_match_eligible, caregiver_relevance_score DESC, state, city);
CREATE INDEX IF NOT EXISTS idx_agencies_provider_type ON agencies(provider_type, is_active);
