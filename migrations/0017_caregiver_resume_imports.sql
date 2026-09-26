CREATE TABLE IF NOT EXISTS caregiver_resume_imports (
  id TEXT PRIMARY KEY,
  caregiver_id TEXT NOT NULL,
  source_filename TEXT,
  source_mime_type TEXT,
  source_file_size INTEGER,
  parser_version TEXT NOT NULL DEFAULT 'carejoys_resume_v1',
  detected_role TEXT,
  detected_certifications TEXT,
  detected_specialties TEXT,
  detected_email INTEGER NOT NULL DEFAULT 0,
  detected_phone INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (caregiver_id) REFERENCES caregivers(id)
);

CREATE INDEX IF NOT EXISTS idx_resume_imports_caregiver ON caregiver_resume_imports(caregiver_id,created_at DESC);
