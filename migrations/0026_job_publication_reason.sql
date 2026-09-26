ALTER TABLE caregiver_jobs ADD COLUMN publication_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_caregiver_jobs_publication_reason
ON caregiver_jobs(is_published,status,publication_reason);
