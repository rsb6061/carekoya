-- Dead-pile reactivation: CareJoys emails an agency's past applicants for the agency ("Hi, this is Sam with
-- Harbor Home Care. Still looking for caregiver work?") and records their yes or no. Contacting them for the agency
-- needs no CareJoys opt-in; joining the CareJoys network is a separate choice, recorded in pool_opt_in.
ALTER TABLE agency_applicants ADD COLUMN reactivation_token_hash TEXT;
ALTER TABLE agency_applicants ADD COLUMN reactivation_sent_at TEXT;
-- 'sent' or 'failed'
ALTER TABLE agency_applicants ADD COLUMN reactivation_status TEXT;
ALTER TABLE agency_applicants ADD COLUMN reactivation_error TEXT;
-- 'yes' or 'no', from the links in the email
ALTER TABLE agency_applicants ADD COLUMN reactivation_response TEXT;
ALTER TABLE agency_applicants ADD COLUMN reactivation_responded_at TEXT;
-- A better number the applicant gave when answering yes (kept apart from phone, which is the dedupe key).
ALTER TABLE agency_applicants ADD COLUMN reply_phone TEXT;
ALTER TABLE agency_applicants ADD COLUMN pool_opt_in_at TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_agency_applicants_reactivation_token ON agency_applicants(reactivation_token_hash) WHERE reactivation_token_hash IS NOT NULL;

-- Each send an operator presses, with the wording used, so it's clear what went to whom and when.
CREATE TABLE IF NOT EXISTS agency_reactivation_sends (
  id TEXT PRIMARY KEY,
  employer_id TEXT NOT NULL,
  sender_name TEXT NOT NULL,
  pay_text TEXT,
  attempted INTEGER NOT NULL DEFAULT 0,
  sent INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  sent_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_agency_reactivation_sends_employer ON agency_reactivation_sends(employer_id, created_at DESC);
