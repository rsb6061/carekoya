-- Where a caregiver wants to work (private home care, assisted living, nursing home...), separate from where they've worked.
ALTER TABLE caregivers ADD COLUMN preferred_settings TEXT;
