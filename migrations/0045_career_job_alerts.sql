-- Digests are OPT-IN only: no historical caregiver can be emailed by default.
CREATE TABLE IF NOT EXISTS caregiver_job_alert_preferences (
  caregiver_id TEXT PRIMARY KEY REFERENCES caregivers(id),
  email_enabled INTEGER NOT NULL DEFAULT 0,
  last_sent_at TEXT,
  last_jobs_signature TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_career_job_alert_due ON caregiver_job_alert_preferences(email_enabled,last_sent_at);
