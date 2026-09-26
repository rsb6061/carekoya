ALTER TABLE caregivers ADD COLUMN auth0_sub TEXT;
ALTER TABLE caregivers ADD COLUMN auth0_email_verified INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS idx_caregivers_auth0_sub
ON caregivers(auth0_sub)
WHERE auth0_sub IS NOT NULL AND trim(auth0_sub)!='';

CREATE TABLE IF NOT EXISTS caregiver_job_apply_events (
  id TEXT PRIMARY KEY,
  caregiver_job_id TEXT NOT NULL,
  caregiver_id TEXT,
  event_type TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'carejoys_job_page',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (caregiver_job_id) REFERENCES caregiver_jobs(id),
  FOREIGN KEY (caregiver_id) REFERENCES caregivers(id)
);

CREATE INDEX IF NOT EXISTS idx_job_apply_events_job
ON caregiver_job_apply_events(caregiver_job_id,created_at DESC);

CREATE INDEX IF NOT EXISTS idx_job_apply_events_caregiver
ON caregiver_job_apply_events(caregiver_id,created_at DESC);
