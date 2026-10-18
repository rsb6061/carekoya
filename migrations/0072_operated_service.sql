-- The operated service: applicants arrive by email, the owner gets a weekly report, outside applicants book their
-- own interview, and the plan is billed separately.

-- Each agency's forwarding address is apply+<intake_key>@carejoys.com (src/applicantEmailIntake.ts).
ALTER TABLE employer_leads ADD COLUMN intake_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_employer_leads_intake_key ON employer_leads(intake_key) WHERE intake_key IS NOT NULL;
-- When the Monday applicant report last went out (src/applicantReport.ts).
ALTER TABLE employer_leads ADD COLUMN last_applicant_report_at TEXT;

-- A booking link for an applicant who isn't a CareJoys caregiver (src/applicantBooking.ts). Only the hash is kept.
ALTER TABLE agency_applicants ADD COLUMN booking_token_hash TEXT;
ALTER TABLE agency_applicants ADD COLUMN booking_sent_at TEXT;
ALTER TABLE agency_applicants ADD COLUMN interview_slot_id TEXT;
-- When the interview was booked, set by the booking link or by entering an interview time; the weekly report counts it.
ALTER TABLE agency_applicants ADD COLUMN interview_booked_at TEXT;
CREATE INDEX IF NOT EXISTS idx_agency_applicants_booking ON agency_applicants(booking_token_hash) WHERE booking_token_hash IS NOT NULL;
ALTER TABLE interview_slots ADD COLUMN booked_applicant_id TEXT;

-- 'operated' for applicant follow-up, else the introductions plan.
ALTER TABLE employer_billing ADD COLUMN plan TEXT;
