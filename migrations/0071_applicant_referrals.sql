-- Referral links for an agency's own applicants (src/applicantReferrals.ts). The agency (or a CareJoys operator) adds
-- a referrer, usually one of its caregivers, and gets a link to share. Anyone who applies through the link lands on
-- that agency's applicant list with source 'referral'. The referrer earns $25 when the person they referred is
-- screened with no knockout answer; a CareJoys operator approves each reward and marks it paid by hand.
CREATE TABLE IF NOT EXISTS agency_referrers (
  id TEXT PRIMARY KEY,
  employer_id TEXT NOT NULL,
  -- The part after carejoys.com/refer/.
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  added_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_agency_referrers_employer ON agency_referrers(employer_id, created_at DESC);

-- Who referred this applicant, when they came in through a referral link and weren't the referrer themselves.
ALTER TABLE agency_applicants ADD COLUMN referrer_id TEXT;
CREATE INDEX IF NOT EXISTS idx_agency_applicants_referrer ON agency_applicants(referrer_id);

-- One reward per referred applicant. 'earned' when screened with no knockout; an operator moves it to 'approved'
-- (or 'denied'), then 'paid' once the money is sent.
CREATE TABLE IF NOT EXISTS agency_referral_rewards (
  applicant_id TEXT PRIMARY KEY,
  employer_id TEXT NOT NULL,
  referrer_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'earned' CHECK (status IN ('earned','approved','paid','denied')),
  earned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  approved_at TEXT,
  approved_by TEXT,
  paid_at TEXT,
  paid_by TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_agency_referral_rewards_employer ON agency_referral_rewards(employer_id, status);
