PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS agency_organizations (
  id TEXT PRIMARY KEY,
  organization_key TEXT NOT NULL UNIQUE,
  canonical_name TEXT NOT NULL,
  primary_domain TEXT,
  primary_website TEXT,
  primary_careers_url TEXT,
  primary_email TEXT,
  primary_phone TEXT,
  primary_contact_name TEXT,
  city TEXT,
  state TEXT,
  claimed_employer_id TEXT,
  provider_types TEXT,
  license_count INTEGER NOT NULL DEFAULT 0,
  website_source TEXT,
  careers_source TEXT,
  inferred_roles TEXT,
  current_hiring_signal TEXT NOT NULL DEFAULT 'unknown',
  hiring_signal_source TEXT,
  hiring_signal_checked_at TEXT,
  last_enriched_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (claimed_employer_id) REFERENCES employer_leads(id)
);

CREATE INDEX IF NOT EXISTS idx_agency_org_domain ON agency_organizations(primary_domain);
CREATE INDEX IF NOT EXISTS idx_agency_org_claimed ON agency_organizations(claimed_employer_id);
CREATE INDEX IF NOT EXISTS idx_agency_org_enrich ON agency_organizations(last_enriched_at,current_hiring_signal,is_active);

ALTER TABLE agencies ADD COLUMN organization_id TEXT;
CREATE INDEX IF NOT EXISTS idx_agencies_org_id ON agencies(organization_id,is_active);

CREATE TABLE IF NOT EXISTS agency_org_hiring_profiles (
  organization_id TEXT PRIMARY KEY,
  hiring_status TEXT NOT NULL DEFAULT 'unknown',
  roles TEXT,
  shifts TEXT,
  pay_min REAL,
  pay_max REAL,
  service_radius_miles INTEGER,
  service_areas TEXT,
  transportation_required INTEGER NOT NULL DEFAULT 0,
  requirements TEXT,
  roles_source TEXT NOT NULL DEFAULT 'inferred',
  geography_source TEXT NOT NULL DEFAULT 'license_directory',
  hiring_status_source TEXT NOT NULL DEFAULT 'inferred',
  employer_confirmed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES agency_organizations(id)
);

CREATE TABLE IF NOT EXISTS agency_org_candidate_matches (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  caregiver_id TEXT NOT NULL,
  fit_score INTEGER NOT NULL DEFAULT 0,
  geography_score INTEGER NOT NULL DEFAULT 0,
  role_score INTEGER NOT NULL DEFAULT 0,
  freshness_score INTEGER NOT NULL DEFAULT 0,
  provider_score INTEGER NOT NULL DEFAULT 0,
  match_reason TEXT,
  caregiver_interest TEXT,
  agency_interest TEXT,
  status TEXT NOT NULL DEFAULT 'matched',
  last_scored_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id,caregiver_id),
  FOREIGN KEY (organization_id) REFERENCES agency_organizations(id),
  FOREIGN KEY (caregiver_id) REFERENCES caregivers(id)
);
CREATE INDEX IF NOT EXISTS idx_org_matches_org ON agency_org_candidate_matches(organization_id,fit_score DESC);
CREATE INDEX IF NOT EXISTS idx_org_matches_caregiver ON agency_org_candidate_matches(caregiver_id,fit_score DESC);

CREATE TABLE IF NOT EXISTS agency_teaser_tokens (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  recipient_email TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  sent_at TEXT,
  opened_at TEXT,
  claim_requested_at TEXT,
  claimed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES agency_organizations(id)
);
CREATE INDEX IF NOT EXISTS idx_agency_teaser_tokens_org ON agency_teaser_tokens(organization_id,created_at DESC);

CREATE TABLE IF NOT EXISTS agency_outreach_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'email',
  recipient_email TEXT,
  provider_message_id TEXT,
  payload TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES agency_organizations(id)
);
CREATE INDEX IF NOT EXISTS idx_agency_outreach_org ON agency_outreach_events(organization_id,created_at DESC);
