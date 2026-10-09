ALTER TABLE agency_organizations ADD COLUMN zip TEXT;
ALTER TABLE agency_organizations ADD COLUMN caregiver_relevance_score INTEGER NOT NULL DEFAULT 0;
ALTER TABLE agency_organizations ADD COLUMN teaser_last_sent_at TEXT;
ALTER TABLE agency_organizations ADD COLUMN teaser_send_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_agency_org_geo ON agency_organizations(state,city,zip,is_active);
CREATE INDEX IF NOT EXISTS idx_agency_org_relevance ON agency_organizations(caregiver_relevance_score DESC,current_hiring_signal,is_active);
