ALTER TABLE caregiver_jobs ADD COLUMN normalized_title TEXT;
ALTER TABLE caregiver_jobs ADD COLUMN roles_json TEXT;
ALTER TABLE caregiver_jobs ADD COLUMN pay_period TEXT;
ALTER TABLE caregiver_jobs ADD COLUMN canonical_fingerprint TEXT;
ALTER TABLE caregiver_jobs ADD COLUMN location_source TEXT;

ALTER TABLE agency_job_scan_state ADD COLUMN job_links_seen INTEGER NOT NULL DEFAULT 0;
ALTER TABLE agency_job_scan_state ADD COLUMN jobs_rejected INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_caregiver_jobs_fingerprint
ON caregiver_jobs(canonical_fingerprint,status,is_published);

CREATE INDEX IF NOT EXISTS idx_caregiver_jobs_roles
ON caregiver_jobs(role,state,is_published,status);

CREATE INDEX IF NOT EXISTS idx_job_scan_provider_status
ON agency_job_scan_state(source_provider,last_status,last_scanned_at);
