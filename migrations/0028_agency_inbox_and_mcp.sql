PRAGMA foreign_keys = ON;

-- A caregiver asking to be sent to an agency (optionally for one of its jobs). This is the unit of the Agency Inbox.
-- agency_stage is the agency's own mark; NULL means it still needs a reply.
CREATE TABLE IF NOT EXISTS agency_interests (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  caregiver_id TEXT NOT NULL,
  caregiver_job_id TEXT,
  job_key TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL,
  interest_request_id TEXT,
  caregiver_note TEXT,
  agency_stage TEXT,
  agency_stage_at TEXT,
  agency_notes TEXT,
  agency_viewed_at TEXT,
  agency_notified_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id,caregiver_id,job_key),
  FOREIGN KEY (organization_id) REFERENCES agency_organizations(id),
  FOREIGN KEY (caregiver_id) REFERENCES caregivers(id),
  FOREIGN KEY (caregiver_job_id) REFERENCES caregiver_jobs(id)
);
CREATE INDEX IF NOT EXISTS idx_agency_interests_org ON agency_interests(organization_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agency_interests_caregiver ON agency_interests(caregiver_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agency_interests_request ON agency_interests(interest_request_id);

CREATE TABLE IF NOT EXISTS agency_interest_events (
  id TEXT PRIMARY KEY,
  interest_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  actor TEXT NOT NULL,
  payload TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (interest_id) REFERENCES agency_interests(id)
);
CREATE INDEX IF NOT EXISTS idx_agency_interest_events_interest ON agency_interest_events(interest_id,created_at DESC);

-- A request to send a caregiver's profile that waits for the caregiver's email confirmation.
-- AI assistants (MCP) prepare one, confirm it, and the caregiver presses Send in the email.
-- status: prepared | awaiting_email | sent
CREATE TABLE IF NOT EXISTS interest_requests (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'prepared',
  email TEXT NOT NULL,
  caregiver_id TEXT,
  payload TEXT NOT NULL,
  result TEXT,
  prepare_token_hash TEXT UNIQUE,
  prepare_expires_at TEXT,
  email_token_hash TEXT UNIQUE,
  email_expires_at TEXT,
  email_sent_at TEXT,
  status_token_hash TEXT UNIQUE,
  client_hash TEXT,
  confirmed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_interest_requests_email ON interest_requests(email,created_at DESC);
