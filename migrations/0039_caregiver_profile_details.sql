-- What agencies match on beyond the resume: when a caregiver can work, what kind of work, and their license.
ALTER TABLE caregivers ADD COLUMN availability_json TEXT;   -- {"mon":["morning","evening"],...,"liveIn":true}
ALTER TABLE caregivers ADD COLUMN employment_types TEXT;    -- comma list: full_time, part_time, per_diem
ALTER TABLE caregivers ADD COLUMN start_availability TEXT;  -- now, 2_weeks, 1_month, later
ALTER TABLE caregivers ADD COLUMN care_settings TEXT;       -- comma list: home care, assisted living, nursing home...
ALTER TABLE caregivers ADD COLUMN work_conditions TEXT;     -- comma list: pets, smokers
ALTER TABLE caregivers ADD COLUMN license_number TEXT;
ALTER TABLE caregivers ADD COLUMN license_state TEXT;
ALTER TABLE caregivers ADD COLUMN profile_updated_at TEXT;
