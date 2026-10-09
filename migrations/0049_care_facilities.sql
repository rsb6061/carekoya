-- Senior living and assisted living facilities live in the same `agencies` / `agency_organizations` tables as
-- home care agencies, told apart by provider_kind. Facilities feed caregiver job search but never agency outreach
-- (teasers and hiring-needs invites only go to provider_kind='home_care').
ALTER TABLE agencies ADD COLUMN provider_kind TEXT NOT NULL DEFAULT 'home_care';
ALTER TABLE agencies ADD COLUMN bed_count INTEGER;
ALTER TABLE agencies ADD COLUMN ccn TEXT;
-- The DataForSEO category a Google row was pulled under, so a pull only retires rows from the categories it covered.
ALTER TABLE agencies ADD COLUMN google_pull_category TEXT;
CREATE INDEX IF NOT EXISTS idx_agencies_kind ON agencies(provider_kind,state,is_active);
CREATE INDEX IF NOT EXISTS idx_agencies_ccn ON agencies(ccn);

ALTER TABLE agency_organizations ADD COLUMN provider_kind TEXT NOT NULL DEFAULT 'home_care';
ALTER TABLE agency_organizations ADD COLUMN bed_count INTEGER;
-- A national chain's corporate job board (one row per brand, seeded by hand, not rebuilt from `agencies`).
ALTER TABLE agency_organizations ADD COLUMN is_chain INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_agency_org_kind ON agency_organizations(provider_kind,state,is_active);

-- Google listings already pulled under home care categories that Google itself files as a facility.
UPDATE agencies SET provider_kind='facility'
  WHERE source='google_business'
    AND lower(coalesce(google_category,'')) IN ('assisted living facility','aged care','retirement community','retirement home','nursing home','memory care facility','senior living community','skilled nursing facility');

UPDATE agency_organizations SET provider_kind='facility'
  WHERE id IN (SELECT organization_id FROM agencies WHERE provider_kind='facility' AND organization_id IS NOT NULL);
