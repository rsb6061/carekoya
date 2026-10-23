-- One paid web search per agency for its careers page, when the scanner found no job board or the site would not load (src/careersLookup.ts).
CREATE TABLE IF NOT EXISTS careers_lookups (
  organization_id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  query TEXT,
  found_url TEXT,
  cost REAL NOT NULL DEFAULT 0,
  looked_up_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_careers_lookups_day ON careers_lookups(looked_up_at);
