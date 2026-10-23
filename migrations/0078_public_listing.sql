-- Public caregiver directory (/caregivers/{state}/{city}). A caregiver appears only after ticking "List my profile";
-- legacy rows stay at 0 until the person opts in from their dashboard. public_photo is a second, separate yes.
ALTER TABLE caregivers ADD COLUMN public_listing INTEGER NOT NULL DEFAULT 0;
ALTER TABLE caregivers ADD COLUMN public_listing_at TEXT;
ALTER TABLE caregivers ADD COLUMN public_listing_source TEXT;
ALTER TABLE caregivers ADD COLUMN public_photo INTEGER NOT NULL DEFAULT 0;
-- "Still looking?" email: one per confirmation cycle, answered with a one-tap link.
ALTER TABLE caregivers ADD COLUMN still_looking_sent_at TEXT;
ALTER TABLE caregivers ADD COLUMN still_looking_token_hash TEXT;
CREATE INDEX IF NOT EXISTS idx_caregivers_public_listing ON caregivers(public_listing,work_status,last_confirmed_at);
