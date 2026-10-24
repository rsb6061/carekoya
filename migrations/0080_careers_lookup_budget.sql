-- Which budget paid for a careers-page search: the daily cap (CAREERS_LOOKUP_DAILY_USD) or the one-time run through the
-- short cities (CAREERS_LOOKUP_BOOST_USD, approved 2026-10-24). The daily cap counts only its own searches.
ALTER TABLE careers_lookups ADD COLUMN budget TEXT NOT NULL DEFAULT 'daily';
