CREATE TABLE IF NOT EXISTS training_organizations (
  id TEXT PRIMARY KEY,
  organization_key TEXT NOT NULL UNIQUE,
  canonical_name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  primary_domain TEXT,
  website TEXT,
  provider_types TEXT,
  credential_categories TEXT NOT NULL DEFAULT 'CNA/GNA',
  location_count INTEGER NOT NULL DEFAULT 0,
  active_program_count INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE training_programs ADD COLUMN organization_id TEXT;
ALTER TABLE training_programs ADD COLUMN credential_category TEXT;

CREATE INDEX IF NOT EXISTS idx_training_org_slug ON training_organizations(slug,is_active);
CREATE INDEX IF NOT EXISTS idx_training_org_domain ON training_organizations(primary_domain,is_active);
CREATE INDEX IF NOT EXISTS idx_training_program_org ON training_programs(organization_id,is_active);
CREATE INDEX IF NOT EXISTS idx_training_program_credential ON training_programs(credential_category,is_active);
