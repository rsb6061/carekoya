-- When an agency's own site was last searched for an email, Contact and About pages included (src/agencyFeatures.ts).
-- Agencies crawled before those pages were read have none, so recheckAgencyEmailBatch looks at each of them once.
ALTER TABLE agency_organizations ADD COLUMN email_checked_at TEXT;
-- Only the agencies still waiting for that look, so the hourly pick reads them alone rather than every organization.
CREATE INDEX idx_agency_orgs_email_recheck ON agency_organizations(state,city)
  WHERE email_checked_at IS NULL AND COALESCE(primary_email,'')='' AND last_enriched_at IS NOT NULL;
