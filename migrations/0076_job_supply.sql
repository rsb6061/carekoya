-- Finds the same posting saved under several agencies (chain facilities sharing one job board).
CREATE INDEX IF NOT EXISTS idx_caregiver_jobs_source_url ON caregiver_jobs(source_url,status,is_published);

-- One row a day of live job supply, so the daily monitor can tell when it drops (src/monitoring.ts).
CREATE TABLE IF NOT EXISTS job_supply_snapshots (
  day TEXT PRIMARY KEY,
  live_pages INTEGER NOT NULL,
  unique_postings INTEGER NOT NULL,
  new_postings INTEGER NOT NULL,
  sites_scanned INTEGER NOT NULL,
  by_provider_json TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
