-- Test agencies (e.g. Rebecca's walkthrough agency) are hidden from public search, MCP and outreach.
ALTER TABLE agency_organizations ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0;
