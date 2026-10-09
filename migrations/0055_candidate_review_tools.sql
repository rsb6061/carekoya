-- The caregiver's yes/no answers to what home-care and assisted-living employers ask first (comma-separated keys from src/checklist.ts).
ALTER TABLE caregivers ADD COLUMN checklist TEXT;

-- An employer's "follow up later" star on a matched caregiver.
ALTER TABLE candidate_pipeline ADD COLUMN favorited_at TEXT;

-- Emails an employer saves for inviting and following up with caregivers; placeholders are filled in the browser.
CREATE TABLE IF NOT EXISTS employer_email_templates (
  id TEXT PRIMARY KEY,
  employer_id TEXT NOT NULL,
  name TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_employer_email_templates_employer ON employer_email_templates(employer_id);
