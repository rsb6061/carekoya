-- Per-account memory that follows a person across devices: the dashboard they used last, so a sign-in on a new
-- phone or computer opens the same side of CareJoys (caregiver or hiring) as last time.
CREATE TABLE IF NOT EXISTS account_preferences (
  email TEXT PRIMARY KEY,
  last_dashboard TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
