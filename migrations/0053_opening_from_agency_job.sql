-- An opening an agency started from one of its own job listings ("Find caregivers for this job").
ALTER TABLE openings ADD COLUMN caregiver_job_id TEXT;
CREATE INDEX IF NOT EXISTS idx_openings_caregiver_job ON openings(caregiver_job_id);
