-- Careers URLs the search took from a job title rather than the board's own address are not the agency's. Clear them
-- so the stricter match (board host or path names the agency) decides again; the lookup rows stay so the search is
-- not paid for twice.
UPDATE agency_organizations SET primary_careers_url=NULL, careers_source=NULL, updated_at=CURRENT_TIMESTAMP
 WHERE careers_source='serp_lookup' AND primary_careers_url LIKE '%/job/%';
UPDATE careers_lookups SET status='not_found', found_url=NULL
 WHERE status='found' AND found_url LIKE '%/job/%';
