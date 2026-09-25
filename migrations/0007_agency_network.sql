PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS agencies (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  source_key TEXT NOT NULL,
  name TEXT NOT NULL,
  legal_name TEXT,
  license_number TEXT,
  license_type TEXT,
  license_status TEXT,
  address1 TEXT,
  address2 TEXT,
  city TEXT,
  state TEXT,
  zip TEXT,
  county TEXT,
  phone TEXT,
  email TEXT,
  website TEXT,
  services TEXT,
  source_url TEXT,
  source_row_json TEXT,
  claimed_employer_id TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  last_source_sync_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(source, source_key),
  FOREIGN KEY (claimed_employer_id) REFERENCES employer_leads(id)
);

CREATE INDEX IF NOT EXISTS idx_agencies_geo ON agencies(state, city, zip, is_active);
CREATE INDEX IF NOT EXISTS idx_agencies_source ON agencies(source, is_active);
CREATE INDEX IF NOT EXISTS idx_agencies_license ON agencies(license_number);

CREATE TABLE IF NOT EXISTS agency_hiring_profiles (
  agency_id TEXT PRIMARY KEY,
  hiring_status TEXT NOT NULL DEFAULT 'unknown',
  roles TEXT,
  shifts TEXT,
  pay_min REAL,
  pay_max REAL,
  service_radius_miles INTEGER,
  service_areas TEXT,
  transportation_required INTEGER NOT NULL DEFAULT 0,
  requirements TEXT,
  source TEXT NOT NULL DEFAULT 'unconfirmed',
  last_confirmed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (agency_id) REFERENCES agencies(id)
);

CREATE TABLE IF NOT EXISTS agency_candidate_matches (
  id TEXT PRIMARY KEY,
  agency_id TEXT NOT NULL,
  caregiver_id TEXT NOT NULL,
  fit_score INTEGER NOT NULL DEFAULT 0,
  match_reason TEXT,
  caregiver_interest TEXT,
  agency_interest TEXT,
  status TEXT NOT NULL DEFAULT 'matched',
  last_scored_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(agency_id, caregiver_id),
  FOREIGN KEY (agency_id) REFERENCES agencies(id),
  FOREIGN KEY (caregiver_id) REFERENCES caregivers(id)
);

CREATE INDEX IF NOT EXISTS idx_agency_matches_agency ON agency_candidate_matches(agency_id, fit_score DESC);
CREATE INDEX IF NOT EXISTS idx_agency_matches_caregiver ON agency_candidate_matches(caregiver_id, fit_score DESC);
