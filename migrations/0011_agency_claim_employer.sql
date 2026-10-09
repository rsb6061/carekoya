ALTER TABLE agency_teaser_tokens ADD COLUMN employer_id TEXT;
CREATE INDEX IF NOT EXISTS idx_agency_teaser_employer ON agency_teaser_tokens(employer_id,claim_requested_at,claimed_at);
