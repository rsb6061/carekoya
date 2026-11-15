-- Three-step Apply with CareJoys (src/quickApply.ts): no account or resume needed. Each application keeps the
-- caregiver's answers to the agency's own questions, a grade (qualified | review) with a one-line reason, and the
-- interview they booked on the spot, or the times they said suit them for a call.
ALTER TABLE agency_interests ADD COLUMN screening_json TEXT;      -- [{"label":"Do you have a car?","answer":"yes"}]
ALTER TABLE agency_interests ADD COLUMN grade TEXT;
ALTER TABLE agency_interests ADD COLUMN grade_reason TEXT;
ALTER TABLE agency_interests ADD COLUMN interview_at TEXT;        -- ISO time the applicant booked
ALTER TABLE agency_interests ADD COLUMN interview_format TEXT;    -- phone | video | in_person
ALTER TABLE agency_interests ADD COLUMN interview_pref TEXT;      -- "Weekday mornings, Saturday" when no times were offered
ALTER TABLE agency_interests ADD COLUMN booking_token_hash TEXT;  -- sha256 of the token the apply page books with
CREATE INDEX IF NOT EXISTS idx_agency_interests_booking ON agency_interests(booking_token_hash);
CREATE INDEX IF NOT EXISTS idx_agency_interests_interview ON agency_interests(organization_id,interview_at);

-- What the caregiver said about their experience on the apply form: new, family, agency, facility.
ALTER TABLE caregivers ADD COLUMN experience_kinds TEXT;

-- When an agency takes interviews, so applicants can book one the moment they apply. One row per workspace.
CREATE TABLE IF NOT EXISTS agency_interview_hours (
  employer_id TEXT PRIMARY KEY,
  hours_json TEXT NOT NULL,          -- {"days":["tue","thu"],"start":"10:00","end":"14:00","duration":30,"format":"phone","location":"","timezone":"America/New_York"}
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
