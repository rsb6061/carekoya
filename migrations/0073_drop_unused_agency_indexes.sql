-- D1 bills every index entry an insert or update touches as another row written. agencies had 13 indexes, so an
-- import that rewrote its ~296k rows was billed many times over (Oct 2026: $154 of rows written). The app only looks
-- agencies up by id, (source,source_key), source and organization_id; these were never queried.
DROP INDEX IF EXISTS idx_agencies_geo;
DROP INDEX IF EXISTS idx_agencies_license;
DROP INDEX IF EXISTS idx_agencies_org_key;
DROP INDEX IF EXISTS idx_agencies_caregiver_relevance;
DROP INDEX IF EXISTS idx_agencies_provider_type;
DROP INDEX IF EXISTS idx_agencies_npi;
DROP INDEX IF EXISTS idx_agencies_google_place;
DROP INDEX IF EXISTS idx_agencies_phone;
DROP INDEX IF EXISTS idx_agencies_kind;
DROP INDEX IF EXISTS idx_agencies_ccn;
