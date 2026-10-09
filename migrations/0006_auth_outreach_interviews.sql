PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS employer_auth_tokens (
  id TEXT PRIMARY KEY,
  employer_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (employer_id) REFERENCES employer_leads(id)
);
CREATE INDEX IF NOT EXISTS idx_employer_auth_tokens_employer ON employer_auth_tokens(employer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_employer_auth_tokens_expiry ON employer_auth_tokens(expires_at);

CREATE TABLE IF NOT EXISTS employer_sessions (
  id TEXT PRIMARY KEY,
  employer_id TEXT NOT NULL,
  session_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (employer_id) REFERENCES employer_leads(id)
);
CREATE INDEX IF NOT EXISTS idx_employer_sessions_employer ON employer_sessions(employer_id, expires_at);

CREATE TABLE IF NOT EXISTS rate_limits (
  bucket TEXT NOT NULL,
  identity TEXT NOT NULL,
  window_start TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (bucket, identity, window_start)
);

ALTER TABLE candidate_pipeline ADD COLUMN response_token_hash TEXT;
ALTER TABLE candidate_pipeline ADD COLUMN response_sent_at TEXT;
ALTER TABLE candidate_pipeline ADD COLUMN response_value TEXT;
ALTER TABLE candidate_pipeline ADD COLUMN response_at TEXT;
ALTER TABLE candidate_pipeline ADD COLUMN interview_slot_id TEXT;
ALTER TABLE candidate_pipeline ADD COLUMN interview_booked_at TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_pipeline_response_token
  ON candidate_pipeline(response_token_hash)
  WHERE response_token_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS interview_slots (
  id TEXT PRIMARY KEY,
  opening_id TEXT NOT NULL,
  employer_id TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 30,
  timezone TEXT NOT NULL DEFAULT 'America/New_York',
  status TEXT NOT NULL DEFAULT 'available',
  booked_pipeline_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (opening_id) REFERENCES openings(id),
  FOREIGN KEY (employer_id) REFERENCES employer_leads(id)
);
CREATE INDEX IF NOT EXISTS idx_interview_slots_opening ON interview_slots(opening_id, status, starts_at);

ALTER TABLE employer_leads ADD COLUMN auth_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE employer_leads ADD COLUMN last_login_at TEXT;
