CREATE TABLE IF NOT EXISTS training_programs (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  source_key TEXT NOT NULL,
  program_name TEXT NOT NULL,
  provider_type TEXT,
  address TEXT,
  city TEXT,
  state TEXT,
  zip TEXT,
  current_status TEXT,
  program_type TEXT,
  date_last_approved TEXT,
  renewal_due TEXT,
  date_closed TEXT,
  date_withdrawn TEXT,
  source_url TEXT,
  source_updated_at TEXT,
  website TEXT,
  email TEXT,
  phone TEXT,
  claimed_school_lead_id TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  last_source_sync_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(source, source_key)
);

CREATE INDEX IF NOT EXISTS idx_training_programs_geo ON training_programs(state, city, zip, is_active);
CREATE INDEX IF NOT EXISTS idx_training_programs_provider ON training_programs(provider_type, current_status, is_active);
CREATE INDEX IF NOT EXISTS idx_training_programs_source ON training_programs(source, is_active);

CREATE TABLE IF NOT EXISTS school_referral_codes (
  id TEXT PRIMARY KEY,
  training_program_id TEXT,
  school_lead_id TEXT,
  slug TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_school_referrals_program ON school_referral_codes(training_program_id, status);

CREATE TABLE IF NOT EXISTS caregiver_referrals (
  id TEXT PRIMARY KEY,
  caregiver_id TEXT NOT NULL UNIQUE,
  school_referral_code_id TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'school_referral',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_caregiver_referrals_code ON caregiver_referrals(school_referral_code_id, created_at);

CREATE TABLE IF NOT EXISTS training_program_outreach (
  id TEXT PRIMARY KEY,
  training_program_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'email',
  recipient TEXT,
  provider_message_id TEXT,
  payload TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_training_outreach_program ON training_program_outreach(training_program_id, created_at DESC);
