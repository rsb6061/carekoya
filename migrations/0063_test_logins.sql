-- CareJoys' own test accounts: these addresses sign in with a typed code instead of an emailed link, so the
-- agency sign-up, sign-in and hiring flow can be walked end to end and repeated. No other address can use a code.
-- The code is stored hashed (SHA-256 of the code in upper case without dashes or spaces).
CREATE TABLE IF NOT EXISTS test_logins (
  email TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT OR IGNORE INTO test_logins(email,code_hash) VALUES
  ('agency-test@carejoys.com','74fb57ef796a751b87e7c13eb9a3f13fd1c8f675f4ff0cd02151bdb7039d9777'),
  ('agency-test2@carejoys.com','74fb57ef796a751b87e7c13eb9a3f13fd1c8f675f4ff0cd02151bdb7039d9777'),
  ('agency-test3@carejoys.com','74fb57ef796a751b87e7c13eb9a3f13fd1c8f675f4ff0cd02151bdb7039d9777');

-- A workspace for a test address, however it is created (sign-up, claim, admin), is marked test and needs no approval.
-- Test workspaces stay out of admin numbers, caregiver dashboards and reminders, and never email caregivers or agencies.
ALTER TABLE employer_leads ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0;
CREATE TRIGGER IF NOT EXISTS employer_leads_mark_test AFTER INSERT ON employer_leads
WHEN lower(NEW.email) IN (SELECT email FROM test_logins)
BEGIN
  UPDATE employer_leads SET is_test=1,approved_at=COALESCE(approved_at,CURRENT_TIMESTAMP),approved_by=COALESCE(approved_by,'test_account') WHERE id=NEW.id;
END;
UPDATE employer_leads SET is_test=1,approved_at=COALESCE(approved_at,CURRENT_TIMESTAMP),approved_by=COALESCE(approved_by,'test_account')
  WHERE lower(email) IN (SELECT email FROM test_logins);
