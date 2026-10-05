-- Daily Microsoft Clarity Data Export pulls (last 24 hours per pull), one row per breakdown.
-- dimension is '' for the site-wide totals, otherwise a Clarity dimension such as URL, Source or Device.
CREATE TABLE IF NOT EXISTS clarity_insights (
  pulled_on TEXT NOT NULL,        -- UTC date of the pull; the data covers the 24 hours before pulled_at
  dimension TEXT NOT NULL,
  status TEXT NOT NULL,           -- ok, or the HTTP status / error Clarity returned
  payload TEXT,                   -- Clarity's JSON response, as returned
  pulled_at TEXT NOT NULL,
  PRIMARY KEY (pulled_on, dimension)
);
