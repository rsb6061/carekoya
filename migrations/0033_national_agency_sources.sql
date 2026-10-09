-- National agency sources beyond the Maryland license lists: the NPI registry (NPPES) and Google
-- business listings pulled through DataForSEO. Rows from every source live in `agencies` and are
-- grouped into `agency_organizations` by scripts/build-agency-organizations.mjs.
ALTER TABLE agencies ADD COLUMN npi TEXT;
ALTER TABLE agencies ADD COLUMN google_place_id TEXT;
ALTER TABLE agencies ADD COLUMN google_cid TEXT;
ALTER TABLE agencies ADD COLUMN google_category TEXT;
ALTER TABLE agencies ADD COLUMN rating REAL;
ALTER TABLE agencies ADD COLUMN review_count INTEGER;
ALTER TABLE agencies ADD COLUMN latitude REAL;
ALTER TABLE agencies ADD COLUMN longitude REAL;

CREATE INDEX IF NOT EXISTS idx_agencies_npi ON agencies(npi);
CREATE INDEX IF NOT EXISTS idx_agencies_google_place ON agencies(google_place_id);
CREATE INDEX IF NOT EXISTS idx_agencies_phone ON agencies(phone);

ALTER TABLE agency_organizations ADD COLUMN npi TEXT;
ALTER TABLE agency_organizations ADD COLUMN google_place_id TEXT;
ALTER TABLE agency_organizations ADD COLUMN rating REAL;
ALTER TABLE agency_organizations ADD COLUMN review_count INTEGER;
ALTER TABLE agency_organizations ADD COLUMN sources TEXT;

CREATE INDEX IF NOT EXISTS idx_agency_org_npi ON agency_organizations(npi);
