-- Explicit owner grant. Sign-in must still prove ownership of the email address.
-- ADMIN_EMAILS env whitelist continues to work for all previously authorized administrators.
CREATE TABLE IF NOT EXISTS admin_authorizations(
  email TEXT PRIMARY KEY COLLATE NOCASE,
  granted_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT OR IGNORE INTO admin_authorizations(email,granted_by)
  VALUES ('myersrebeccal@gmail.com','owner-request-2026-10-09');
