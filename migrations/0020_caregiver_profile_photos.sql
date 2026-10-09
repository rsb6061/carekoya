CREATE TABLE IF NOT EXISTS caregiver_profile_photos (
  caregiver_id TEXT PRIMARY KEY,
  image_blob BLOB NOT NULL,
  content_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (caregiver_id) REFERENCES caregivers(id)
);

CREATE TABLE IF NOT EXISTS caregiver_profile_edit_tokens (
  id TEXT PRIMARY KEY,
  caregiver_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  purpose TEXT NOT NULL DEFAULT 'photo_upload',
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (caregiver_id) REFERENCES caregivers(id)
);

CREATE INDEX IF NOT EXISTS idx_caregiver_profile_tokens
  ON caregiver_profile_edit_tokens(caregiver_id,purpose,expires_at);
