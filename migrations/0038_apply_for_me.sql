-- The caregiver's own resume file, so CareJoys can attach it when it applies for them.
-- Private: only the caregiver and the apply agent read it.
CREATE TABLE IF NOT EXISTS caregiver_resume_files (
  caregiver_id TEXT PRIMARY KEY,
  file_blob BLOB NOT NULL,
  file_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (caregiver_id) REFERENCES caregivers(id)
);

-- Answers a caregiver gave to employer application questions that CareJoys may reuse next time
-- (work authorization, street address, start date...). Never demographic or legal answers.
CREATE TABLE IF NOT EXISTS caregiver_application_answers (
  caregiver_id TEXT NOT NULL,
  answer_key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (caregiver_id, answer_key)
);

-- One "Apply for me" run on an employer's own application site.
CREATE TABLE IF NOT EXISTS apply_agent_sessions (
  id TEXT PRIMARY KEY,
  caregiver_id TEXT NOT NULL,
  caregiver_job_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  status TEXT NOT NULL,
  application_url TEXT NOT NULL,
  current_url TEXT,
  browser_session_id TEXT,
  pending_questions_json TEXT,
  blocker_code TEXT,
  blocker_message TEXT,
  last_error TEXT,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_apply_agent_sessions_caregiver ON apply_agent_sessions(caregiver_id, started_at DESC);

-- Questions seen on employer forms, to learn which ones to teach CareJoys next.
CREATE TABLE IF NOT EXISTS apply_agent_questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  question_text TEXT NOT NULL,
  canonical_key TEXT,
  required INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_apply_agent_questions_provider ON apply_agent_questions(provider, canonical_key);
