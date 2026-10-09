-- Optional intro video on a caregiver's profile, hosted on Cloudflare Stream.
-- Employers see it only once an admin approves it.
CREATE TABLE IF NOT EXISTS caregiver_intro_videos (
  caregiver_id TEXT PRIMARY KEY,
  stream_uid TEXT,
  pending_uid TEXT,
  status TEXT NOT NULL DEFAULT 'uploading',
  duration_seconds INTEGER,
  consent_at TEXT,
  submitted_at TEXT,
  reviewed_at TEXT,
  reviewed_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (caregiver_id) REFERENCES caregivers(id)
);

CREATE INDEX IF NOT EXISTS idx_caregiver_intro_videos_status
  ON caregiver_intro_videos(status,submitted_at);
