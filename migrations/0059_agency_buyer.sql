-- Agency buyer audit (2026-10-10).
-- Home care openings can cover a service area: caregivers living inside it (or within their commute of its edge) match.
ALTER TABLE openings ADD COLUMN service_radius_miles INTEGER;
-- Views per job on the agency's Jobs tab.
CREATE INDEX IF NOT EXISTS idx_analytics_events_path ON analytics_events(path);
