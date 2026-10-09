-- Pseudonymous worker acquisition events: no email, phone, IP or ZIP in analytics.
CREATE TABLE IF NOT EXISTS worker_funnel_events (
 id TEXT PRIMARY KEY, visitor_id TEXT, caregiver_id TEXT,
 event_type TEXT NOT NULL CHECK(event_type IN ('preview_jobs','preview_empty','job_view')),
 job_id TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_worker_funnel_visitor ON worker_funnel_events(visitor_id,event_type,created_at);
CREATE INDEX IF NOT EXISTS idx_worker_funnel_return ON worker_funnel_events(caregiver_id,event_type,created_at);
CREATE TABLE IF NOT EXISTS worker_funnel_links (
 caregiver_id TEXT PRIMARY KEY, visitor_id TEXT NOT NULL UNIQUE,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_worker_funnel_link_visitor ON worker_funnel_links(visitor_id);
