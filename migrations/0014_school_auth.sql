CREATE TABLE IF NOT EXISTS school_magic_links (
  id TEXT PRIMARY KEY,
  school_lead_id TEXT NOT NULL,
  training_program_id TEXT,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_school_magic_links_lead ON school_magic_links(school_lead_id,expires_at);

CREATE TABLE IF NOT EXISTS school_sessions (
  id TEXT PRIMARY KEY,
  school_lead_id TEXT NOT NULL,
  training_program_id TEXT,
  session_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_school_sessions_lead ON school_sessions(school_lead_id,expires_at);
CREATE INDEX IF NOT EXISTS idx_school_sessions_program ON school_sessions(training_program_id,expires_at);
