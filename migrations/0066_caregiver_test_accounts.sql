-- Caregiver test accounts: sign in with the same typed code as the agency test accounts (0063) and walk the caregiver
-- side (Apply, resume, profile, dashboard) as often as needed. `side` says which dashboard a code sign-in opens.
ALTER TABLE test_logins ADD COLUMN side TEXT NOT NULL DEFAULT 'agency';
INSERT OR IGNORE INTO test_logins(email,code_hash,side) VALUES
  ('caregiver-test@carejoys.com','74fb57ef796a751b87e7c13eb9a3f13fd1c8f675f4ff0cd02151bdb7039d9777','caregiver'),
  ('caregiver-test2@carejoys.com','74fb57ef796a751b87e7c13eb9a3f13fd1c8f675f4ff0cd02151bdb7039d9777','caregiver');

-- A profile for a test address is marked test however it is created. Test profiles never reach a real agency: no
-- matches, no searches, no applications or interest in an agency inbox, and no "Apply for me" on a real site.
ALTER TABLE caregivers ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0;
CREATE TRIGGER IF NOT EXISTS caregivers_mark_test AFTER INSERT ON caregivers
WHEN lower(trim(NEW.email)) IN (SELECT email FROM test_logins)
BEGIN
  UPDATE caregivers SET is_test=1 WHERE id=NEW.id;
END;
UPDATE caregivers SET is_test=1 WHERE lower(trim(email)) IN (SELECT email FROM test_logins);
