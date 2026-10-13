-- An agency's own applicants (Indeed, CareerPlug, old applicants), worked by CareJoys on the agency's behalf.
-- They belong to that agency: they are not caregivers in the CareJoys pool, never matched or shown to another
-- agency, and only join the pool if they opt in (pool_opt_in). `source` says which channel brought each one in,
-- from day one, so cost per channel can be worked out later.
CREATE TABLE IF NOT EXISTS agency_applicants (
  id TEXT PRIMARY KEY,
  employer_id TEXT NOT NULL,
  -- One row per person per agency: their phone (E.164), else their email.
  dedupe_key TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  email TEXT,
  phone TEXT,
  city TEXT,
  state TEXT,
  zip TEXT,
  position TEXT,
  source TEXT NOT NULL CHECK (source IN ('indeed-forward','csv','dead-pile','referral','school','ad')),
  -- Free text: the file name, the campaign, who referred them.
  source_detail TEXT,
  stage TEXT NOT NULL DEFAULT 'new' CHECK (stage IN ('new','contacted','screened','interview','hired','not_fit')),
  notes TEXT,
  -- When they applied, as the agency's file says; received_at is when CareJoys got them (the 30-minute clock).
  applied_at TEXT,
  received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  first_contact_at TEXT,
  screened_at TEXT,
  pool_opt_in INTEGER NOT NULL DEFAULT 0,
  import_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_agency_applicants_person ON agency_applicants(employer_id, dedupe_key);
CREATE INDEX IF NOT EXISTS idx_agency_applicants_list ON agency_applicants(employer_id, received_at DESC);

-- Each upload, so the operator can see what came in from which file and who added it.
CREATE TABLE IF NOT EXISTS agency_applicant_imports (
  id TEXT PRIMARY KEY,
  employer_id TEXT NOT NULL,
  source TEXT NOT NULL,
  filename TEXT,
  rows_total INTEGER NOT NULL DEFAULT 0,
  rows_added INTEGER NOT NULL DEFAULT 0,
  rows_duplicate INTEGER NOT NULL DEFAULT 0,
  rows_skipped INTEGER NOT NULL DEFAULT 0,
  imported_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_agency_applicant_imports_employer ON agency_applicant_imports(employer_id, created_at DESC);
