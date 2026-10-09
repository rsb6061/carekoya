ALTER TABLE caregivers ADD COLUMN activation_token_hash TEXT;
ALTER TABLE caregivers ADD COLUMN activation_sent_at TEXT;
ALTER TABLE caregivers ADD COLUMN activation_opened_at TEXT;
ALTER TABLE caregivers ADD COLUMN activation_completed_at TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_caregivers_activation_token
  ON caregivers(activation_token_hash)
  WHERE activation_token_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_caregivers_activation_status
  ON caregivers(source, activation_sent_at, activation_completed_at, work_status);
