-- Employer form submissions for an existing account wait here until the emailed link is clicked.
ALTER TABLE employer_auth_tokens ADD COLUMN pending_intake TEXT;
