-- One question to the agency and one to the caregiver, a week after CareJoys emailed an application to the agency:
-- what happened? The answers are the outcome data (answered, interviewed, hired) that job listings alone never show.
CREATE TABLE IF NOT EXISTS application_followups (
  id TEXT PRIMARY KEY,
  interest_id TEXT NOT NULL,
  audience TEXT NOT NULL CHECK (audience IN ('agency','caregiver')),
  recipient_email TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  sent_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  answer TEXT,
  answered_at TEXT,
  UNIQUE(interest_id,audience)
);
CREATE INDEX IF NOT EXISTS idx_application_followups_answer ON application_followups(audience,answer);
