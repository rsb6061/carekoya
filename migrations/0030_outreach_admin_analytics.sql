-- Unsubscribe support for outreach email (caregiver reactivation, agency teasers).
CREATE TABLE IF NOT EXISTS email_suppressions (
  email TEXT PRIMARY KEY,
  reason TEXT NOT NULL DEFAULT 'unsubscribe',
  source TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS email_unsubscribe_tokens (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  source TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- One row per scheduled or admin-triggered outreach batch, used for daily caps and the admin console.
CREATE TABLE IF NOT EXISTS outreach_runs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  trigger TEXT NOT NULL,
  attempted INTEGER NOT NULL DEFAULT 0,
  sent INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_outreach_runs_kind_created ON outreach_runs(kind,created_at);

-- First-party, cookie-less page view and product events.
CREATE TABLE IF NOT EXISTS analytics_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  path TEXT,
  referrer_host TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_analytics_events_created ON analytics_events(created_at,event_type);

CREATE INDEX IF NOT EXISTS idx_agency_outreach_events_type_created ON agency_outreach_events(event_type,created_at);
