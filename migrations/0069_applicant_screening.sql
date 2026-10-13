-- Screening and show-up tracking for an agency's own applicants (src/applicantScreening.ts).
-- Each agency has one question list (JSON: [{id,label,type:'yes_no'|'text',knockout?:'yes'|'no'}]), seeded from a
-- caregiver default the first time it's opened. Answers live on the applicant as JSON keyed by question id, so
-- changing the list never loses old answers.
CREATE TABLE IF NOT EXISTS agency_screening_questions (
  employer_id TEXT PRIMARY KEY,
  questions_json TEXT NOT NULL,
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE agency_applicants ADD COLUMN screening_answers_json TEXT;
-- Labels of the questions whose answer knocked the applicant out, separated by |; NULL when none did.
ALTER TABLE agency_applicants ADD COLUMN screening_knockouts TEXT;
ALTER TABLE agency_applicants ADD COLUMN screened_by TEXT;

-- Show-up and retention: what the "qualified applicants actually show up" promise and day-90 data rest on.
ALTER TABLE agency_applicants ADD COLUMN interview_at TEXT;
-- 'showed', 'no_show' or 'rescheduled'
ALTER TABLE agency_applicants ADD COLUMN interview_outcome TEXT;
ALTER TABLE agency_applicants ADD COLUMN start_date TEXT;
-- 'working' or 'left'
ALTER TABLE agency_applicants ADD COLUMN day30_status TEXT;
ALTER TABLE agency_applicants ADD COLUMN day90_status TEXT;
