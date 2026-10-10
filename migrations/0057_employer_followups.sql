-- Employer dashboard follow-ups: one reminder per unanswered invitation, one nudge per interested caregiver the
-- employer hasn't acted on, a close-out note when a role is filled, closing openings, interview location, employer type.
ALTER TABLE candidate_pipeline ADD COLUMN caregiver_reminded_at TEXT;
ALTER TABLE candidate_pipeline ADD COLUMN employer_nudged_at TEXT;
ALTER TABLE candidate_pipeline ADD COLUMN closed_notice_at TEXT;
ALTER TABLE openings ADD COLUMN closed_at TEXT;
ALTER TABLE interview_slots ADD COLUMN location TEXT;
ALTER TABLE employer_leads ADD COLUMN employer_type TEXT;
