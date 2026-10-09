PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS employer_leads (
  id TEXT PRIMARY KEY,
  company_name TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  zip TEXT NOT NULL,
  roles_needed TEXT,
  hiring_notes TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_employer_leads_created_at ON employer_leads(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_employer_leads_zip ON employer_leads(zip);

CREATE TABLE IF NOT EXISTS caregivers (
  id TEXT PRIMARY KEY,
  legacy_floot_id TEXT UNIQUE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  display_name TEXT,
  email TEXT,
  phone TEXT,
  city TEXT,
  state TEXT,
  zip TEXT,
  role TEXT,
  certifications TEXT,
  specialties TEXT,
  languages TEXT,
  bio TEXT,
  years_experience INTEGER,
  desired_wage TEXT,
  hourly_rate_min INTEGER,
  hourly_rate_max INTEGER,
  shift_preferences TEXT,
  travel_distance_miles INTEGER,
  transportation TEXT,
  willing_to_drive INTEGER,
  profile_photo_url TEXT,
  source TEXT NOT NULL DEFAULT 'organic',
  source_detail TEXT,
  work_status TEXT NOT NULL DEFAULT 'unknown',
  last_confirmed_at TEXT,
  sms_consent INTEGER NOT NULL DEFAULT 0,
  sms_consent_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_caregivers_geo ON caregivers(state, city, zip);
CREATE INDEX IF NOT EXISTS idx_caregivers_role ON caregivers(role);
CREATE INDEX IF NOT EXISTS idx_caregivers_freshness ON caregivers(work_status, last_confirmed_at DESC);
CREATE INDEX IF NOT EXISTS idx_caregivers_email ON caregivers(email);
CREATE INDEX IF NOT EXISTS idx_caregivers_phone ON caregivers(phone);

CREATE TABLE IF NOT EXISTS school_leads (
  id TEXT PRIMARY KEY,
  organization_name TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  city TEXT,
  state TEXT,
  program_types TEXT,
  graduating_count TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS openings (
  id TEXT PRIMARY KEY,
  employer_id TEXT,
  title TEXT NOT NULL,
  role TEXT NOT NULL,
  city TEXT,
  state TEXT,
  zip TEXT,
  pay_min INTEGER,
  pay_max INTEGER,
  shift_preferences TEXT,
  transportation_required INTEGER,
  requirements TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (employer_id) REFERENCES employer_leads(id)
);

CREATE TABLE IF NOT EXISTS candidate_pipeline (
  id TEXT PRIMARY KEY,
  opening_id TEXT NOT NULL,
  caregiver_id TEXT NOT NULL,
  stage TEXT NOT NULL DEFAULT 'matched',
  match_reason TEXT,
  contacted_at TEXT,
  responded_at TEXT,
  qualified_at TEXT,
  interview_at TEXT,
  hired_at TEXT,
  rejected_reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(opening_id, caregiver_id),
  FOREIGN KEY (opening_id) REFERENCES openings(id),
  FOREIGN KEY (caregiver_id) REFERENCES caregivers(id)
);

CREATE INDEX IF NOT EXISTS idx_pipeline_opening_stage ON candidate_pipeline(opening_id, stage);
CREATE INDEX IF NOT EXISTS idx_pipeline_caregiver ON candidate_pipeline(caregiver_id);

CREATE TABLE IF NOT EXISTS availability_events (
  id TEXT PRIMARY KEY,
  caregiver_id TEXT NOT NULL,
  status TEXT NOT NULL,
  shift_preferences TEXT,
  desired_wage TEXT,
  travel_distance_miles INTEGER,
  source TEXT NOT NULL,
  confirmed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (caregiver_id) REFERENCES caregivers(id)
);

CREATE INDEX IF NOT EXISTS idx_availability_events_caregiver ON availability_events(caregiver_id, confirmed_at DESC);

CREATE TABLE IF NOT EXISTS outreach_events (
  id TEXT PRIMARY KEY,
  caregiver_id TEXT NOT NULL,
  opening_id TEXT,
  channel TEXT NOT NULL,
  direction TEXT NOT NULL,
  event_type TEXT NOT NULL,
  provider_message_id TEXT,
  payload TEXT,
  occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (caregiver_id) REFERENCES caregivers(id),
  FOREIGN KEY (opening_id) REFERENCES openings(id)
);

CREATE INDEX IF NOT EXISTS idx_outreach_caregiver_time ON outreach_events(caregiver_id, occurred_at DESC);
