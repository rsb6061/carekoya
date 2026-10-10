-- Agency buyer audit (2026-10-10).
-- Home care openings can cover a service area: caregivers living inside it (or within their commute of its edge) match.
ALTER TABLE openings ADD COLUMN service_radius_miles INTEGER;
-- Views per job on the agency's Jobs tab.
CREATE INDEX IF NOT EXISTS idx_analytics_events_path ON analytics_events(path);

-- Workspace settings: the morning digest, the monthly results email, forwarding to an ATS inbox, and the agency's
-- own words that caregivers see on invitations and job pages.
ALTER TABLE employer_leads ADD COLUMN digest_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE employer_leads ADD COLUMN last_digest_at TEXT;
ALTER TABLE employer_leads ADD COLUMN last_results_month TEXT;
ALTER TABLE employer_leads ADD COLUMN ats_email TEXT;
ALTER TABLE employer_leads ADD COLUMN ats_email_set_at TEXT;
ALTER TABLE employer_leads ADD COLUMN company_about TEXT;
ALTER TABLE employer_leads ADD COLUMN company_benefits TEXT;
ALTER TABLE candidate_pipeline ADD COLUMN ats_forwarded_at TEXT;
ALTER TABLE agency_interests ADD COLUMN ats_forwarded_at TEXT;

-- An employer's own check of a caregiver's nurse-aide registry listing. Per employer: one agency's check isn't
-- shown to another as CareJoys' verification.
CREATE TABLE IF NOT EXISTS license_checks (
  employer_id TEXT NOT NULL,
  caregiver_id TEXT NOT NULL,
  result TEXT NOT NULL,
  checked_by TEXT,
  checked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (employer_id,caregiver_id)
);
