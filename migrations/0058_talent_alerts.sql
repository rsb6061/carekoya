-- Saved Find caregivers searches. A daily job emails the employer when caregivers who joined since last_checked_at match.
-- off_token is the one-click "turn off this alert" link in those emails.
CREATE TABLE IF NOT EXISTS talent_alerts (
  id TEXT PRIMARY KEY,
  employer_id TEXT NOT NULL,
  query TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  off_token TEXT NOT NULL,
  last_checked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_talent_alerts_employer ON talent_alerts(employer_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_talent_alerts_off_token ON talent_alerts(off_token);
