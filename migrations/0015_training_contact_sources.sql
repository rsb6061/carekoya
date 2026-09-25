ALTER TABLE training_programs ADD COLUMN contact_source_url TEXT;
ALTER TABLE training_programs ADD COLUMN contact_checked_at TEXT;
CREATE INDEX IF NOT EXISTS idx_training_programs_contact ON training_programs(email,website,is_active);
