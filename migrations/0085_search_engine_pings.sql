-- Each time CareJoys told a search engine that a job page was added or taken down (src/searchPings.ts).
-- Google's Indexing API ("google") and IndexNow for Bing and others ("indexnow"). One row per job, engine and action,
-- so each job is announced once when it goes live and once when it comes down.
CREATE TABLE IF NOT EXISTS search_engine_pings (
  job_id TEXT NOT NULL,
  engine TEXT NOT NULL CHECK (engine IN ('google','indexnow')),
  action TEXT NOT NULL CHECK (action IN ('updated','deleted')),
  status TEXT NOT NULL,
  error TEXT,
  pinged_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (job_id,engine,action)
);
CREATE INDEX IF NOT EXISTS idx_search_engine_pings_engine ON search_engine_pings(engine,action,status);
