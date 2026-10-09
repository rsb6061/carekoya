-- Atria's caregiving jobs are on its frontline iCIMS portal; the community-support portal only lists hiring events.
UPDATE agency_organizations SET primary_careers_url='https://asl-frontlinewagedisplay.icims.com/jobs/search?ss=1',updated_at=CURRENT_TIMESTAMP
  WHERE id='org_chain_atria';
-- Rescan Atria and Brookdale now (iCIMS boards are read from their sitemaps) instead of waiting out the weekly retry.
DELETE FROM agency_job_scan_state WHERE organization_id IN ('org_chain_atria','org_chain_brookdale');
