-- Employers on free-mail addresses wait for an admin before they can see caregiver profiles.
ALTER TABLE employer_leads ADD COLUMN approved_at TEXT;
ALTER TABLE employer_leads ADD COLUMN approved_by TEXT;
ALTER TABLE employer_leads ADD COLUMN approval_requested_at TEXT;
