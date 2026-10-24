-- One-field job alerts: a visitor leaves an email and ZIP on a job or city page, confirms by email, then gets
-- new jobs near that ZIP at most once a week. No caregiver profile needed.
CREATE TABLE IF NOT EXISTS job_alert_signups (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  zip TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'Caregiver',
  status TEXT NOT NULL DEFAULT 'pending',
  confirm_token_hash TEXT,
  source_path TEXT,
  ip_hash TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  confirm_sent_at TEXT,
  confirmed_at TEXT,
  last_sent_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(email,zip,role)
);
CREATE INDEX IF NOT EXISTS idx_job_alert_signups_due ON job_alert_signups(status,last_sent_at);
CREATE INDEX IF NOT EXISTS idx_job_alert_signups_token ON job_alert_signups(confirm_token_hash);
CREATE INDEX IF NOT EXISTS idx_job_alert_signups_ip ON job_alert_signups(ip_hash,created_at);
