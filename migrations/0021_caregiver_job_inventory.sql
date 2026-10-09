PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS caregiver_jobs (
  id TEXT PRIMARY KEY,
  agency_organization_id TEXT NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  source_provider TEXT NOT NULL,
  source_job_id TEXT,
  source_url TEXT NOT NULL,
  source_listing_url TEXT,
  title TEXT NOT NULL,
  role TEXT NOT NULL,
  employer_name TEXT NOT NULL,
  city TEXT,
  state TEXT,
  zip TEXT,
  employment_type TEXT,
  pay_min REAL,
  pay_max REAL,
  pay_currency TEXT NOT NULL DEFAULT 'USD',
  description_text TEXT,
  classifier_reason TEXT,
  confidence INTEGER NOT NULL DEFAULT 0,
  date_posted TEXT,
  valid_through TEXT,
  first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_checked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status TEXT NOT NULL DEFAULT 'current',
  is_published INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (agency_organization_id) REFERENCES agency_organizations(id)
);

CREATE INDEX IF NOT EXISTS idx_caregiver_jobs_public ON caregiver_jobs(is_published,status,state,role,last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_caregiver_jobs_org ON caregiver_jobs(agency_organization_id,status,last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_caregiver_jobs_source ON caregiver_jobs(source_provider,last_checked_at DESC);

CREATE TABLE IF NOT EXISTS agency_job_scan_state (
  organization_id TEXT PRIMARY KEY,
  source_provider TEXT,
  source_listing_url TEXT,
  last_status TEXT,
  last_error TEXT,
  jobs_seen INTEGER NOT NULL DEFAULT 0,
  jobs_published INTEGER NOT NULL DEFAULT 0,
  last_scanned_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES agency_organizations(id)
);

CREATE INDEX IF NOT EXISTS idx_agency_job_scan_status ON agency_job_scan_state(last_status,last_scanned_at);
