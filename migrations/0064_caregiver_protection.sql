-- Caregiver protection: a caregiver can pause invitations for a while, and hide their profile from named agencies
-- (an employer workspace, e.g. their current employer). Hidden or paused caregivers are left out of that agency's
-- (or every agency's) search, profile views, matching and invitations; an agency they applied to still sees them.
ALTER TABLE caregivers ADD COLUMN invites_paused_until TEXT;
CREATE TABLE IF NOT EXISTS caregiver_hidden_employers (
  caregiver_id TEXT NOT NULL,
  employer_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (caregiver_id, employer_id)
);
CREATE INDEX IF NOT EXISTS idx_caregiver_hidden_employer ON caregiver_hidden_employers(employer_id);
-- Weekly invitation caps count a caregiver's recent invitations across all agencies.
CREATE INDEX IF NOT EXISTS idx_pipeline_caregiver_contacted ON candidate_pipeline(caregiver_id, contacted_at);
