-- An agency that said "yes" to outreach gets each application emailed here, resume attached, without claiming a
-- workspace (src/agencyApplications.ts). Its jobs then take "Send my application" like a claimed agency's.
ALTER TABLE agency_organizations ADD COLUMN application_email TEXT;
-- Comma list of credentials the agency requires, e.g. 'cna,emt,ma'. Caregivers without one can't apply to its jobs.
ALTER TABLE agency_organizations ADD COLUMN required_credentials TEXT;
