-- DataForSEO Google-listing pulls run inside the Worker (src/dataforseo.ts). The GitHub workflow inserts a row;
-- the five-minute cron advances it a few pages at a time.
CREATE TABLE IF NOT EXISTS dataforseo_import_jobs (
  id TEXT PRIMARY KEY,
  states TEXT NOT NULL,
  categories TEXT,
  mode TEXT NOT NULL DEFAULT 'estimate',
  status TEXT NOT NULL DEFAULT 'queued',
  max_cost REAL NOT NULL DEFAULT 10,
  spent REAL NOT NULL DEFAULT 0,
  last_page_cost REAL NOT NULL DEFAULT 0,
  plan_json TEXT,
  listings INTEGER NOT NULL DEFAULT 0,
  agencies INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_dataforseo_jobs_status ON dataforseo_import_jobs(status,created_at);
