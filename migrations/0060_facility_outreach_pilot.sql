-- Facilities hand-picked for the outreach pilot (Rebecca, 2026-10-10). Only rows with a value here can get the
-- facility pilot email; every other facility stays a job source with no outreach.
ALTER TABLE agency_organizations ADD COLUMN outreach_pilot TEXT;
