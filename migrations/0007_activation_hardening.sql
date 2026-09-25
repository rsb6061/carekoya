PRAGMA foreign_keys = ON;

ALTER TABLE candidate_pipeline ADD COLUMN response_expires_at TEXT;
ALTER TABLE candidate_pipeline ADD COLUMN employer_notified_interest_at TEXT;

CREATE INDEX IF NOT EXISTS idx_pipeline_response_expiry
  ON candidate_pipeline(response_expires_at)
  WHERE response_expires_at IS NOT NULL;
