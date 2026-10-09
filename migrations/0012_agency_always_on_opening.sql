ALTER TABLE openings ADD COLUMN source TEXT NOT NULL DEFAULT 'employer_opening';
ALTER TABLE openings ADD COLUMN agency_organization_id TEXT;
CREATE INDEX IF NOT EXISTS idx_openings_agency_org ON openings(agency_organization_id,status,updated_at);
