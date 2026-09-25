ALTER TABLE training_programs ADD COLUMN primary_domain TEXT;
ALTER TABLE training_programs ADD COLUMN website_source TEXT;
ALTER TABLE training_programs ADD COLUMN last_enriched_at TEXT;

CREATE INDEX IF NOT EXISTS idx_training_program_domain ON training_programs(primary_domain);
CREATE INDEX IF NOT EXISTS idx_training_program_enrichment ON training_programs(last_enriched_at,is_active);

ALTER TABLE caregivers ADD COLUMN source_training_program_id TEXT;
ALTER TABLE caregivers ADD COLUMN source_training_cohort_id TEXT;
ALTER TABLE caregivers ADD COLUMN source_referral_code TEXT;
CREATE INDEX IF NOT EXISTS idx_caregivers_training_program ON caregivers(source_training_program_id,created_at);
CREATE INDEX IF NOT EXISTS idx_caregivers_training_cohort ON caregivers(source_training_cohort_id,created_at);

CREATE TABLE IF NOT EXISTS training_program_cohorts (
  id TEXT PRIMARY KEY,
  training_program_id TEXT NOT NULL,
  name TEXT NOT NULL,
  referral_code TEXT NOT NULL UNIQUE,
  expected_graduation_date TEXT,
  expected_graduates INTEGER,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (training_program_id) REFERENCES training_programs(id)
);
CREATE INDEX IF NOT EXISTS idx_training_cohorts_program ON training_program_cohorts(training_program_id,status);
