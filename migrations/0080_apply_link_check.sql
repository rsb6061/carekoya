-- Apply links are re-checked on a rolling schedule (src/applyLinkCheck.ts); live jobs least recently checked go first.
ALTER TABLE caregiver_jobs ADD COLUMN link_checked_at TEXT;
CREATE INDEX IF NOT EXISTS idx_caregiver_jobs_link_check ON caregiver_jobs(is_published,status,link_checked_at);

-- Workday links were saved without the board's site name (…myworkdayjobs.com/job/…), which Workday answers with
-- "The URL you have provided is invalid". Take those pages down now; a rescan saves the corrected link onto the same
-- row (same dedupe key) and publishes it again.
UPDATE caregiver_jobs SET is_published=0,publication_reason='dead_apply_link',updated_at=CURRENT_TIMESTAMP
WHERE source_provider='workday' AND is_published=1
  AND (source_url LIKE 'https://%.myworkdayjobs.com/job/%' OR source_url LIKE 'https://%.myworkdayjobs.com/__-__/job/%');

-- Rescan every organization that has one of those links in the next few runs of the 5-minute scanner.
UPDATE agency_job_scan_state SET last_scanned_at='2000-01-01 00:00:00'
WHERE organization_id IN (SELECT DISTINCT agency_organization_id FROM caregiver_jobs
  WHERE source_provider='workday' AND status='current'
    AND (source_url LIKE 'https://%.myworkdayjobs.com/job/%' OR source_url LIKE 'https://%.myworkdayjobs.com/__-__/job/%'));
