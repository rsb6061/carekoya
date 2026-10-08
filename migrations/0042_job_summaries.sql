-- CareJoys' own AI summary of each job; the crawled description_text is kept for matching but never shown.
ALTER TABLE caregiver_jobs ADD COLUMN summary_text TEXT;
ALTER TABLE caregiver_jobs ADD COLUMN summary_source_len INTEGER;
ALTER TABLE caregiver_jobs ADD COLUMN summary_error TEXT;
ALTER TABLE caregiver_jobs ADD COLUMN summarized_at TEXT;
