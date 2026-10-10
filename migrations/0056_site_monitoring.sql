-- Site monitoring (src/monitoring.ts): JavaScript crashes and failed API calls reported by visitors' browsers,
-- uncaught Worker exceptions, and a record of every alert email sent. No IP, email or form contents are stored.
CREATE TABLE IF NOT EXISTS client_errors (
  fingerprint TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  source TEXT,
  stack TEXT,
  first_path TEXT,
  last_path TEXT,
  user_agent TEXT,
  count INTEGER NOT NULL DEFAULT 1,
  first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  alerted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_client_errors_seen ON client_errors(last_seen_at);

CREATE TABLE IF NOT EXISTS monitor_alerts (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  summary TEXT NOT NULL,
  sent_to TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_monitor_alerts_kind ON monitor_alerts(kind,created_at);
