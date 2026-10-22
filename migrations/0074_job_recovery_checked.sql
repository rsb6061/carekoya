-- When the rejected-job recovery last looked at a job, so each job is reviewed once (again only after it changes)
-- instead of the same newest rows every day. Adding a NULL column rewrites no rows.
ALTER TABLE caregiver_jobs ADD COLUMN recovery_checked_at TEXT;
