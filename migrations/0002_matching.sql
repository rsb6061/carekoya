ALTER TABLE candidate_pipeline ADD COLUMN match_score INTEGER NOT NULL DEFAULT 0;
ALTER TABLE candidate_pipeline ADD COLUMN source TEXT NOT NULL DEFAULT 'carejoys_match';
CREATE INDEX IF NOT EXISTS idx_candidate_pipeline_score ON candidate_pipeline(opening_id, match_score DESC);