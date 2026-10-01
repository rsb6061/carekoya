-- Stripe subscription state per employer. Billing gates outreach only when STRIPE_SECRET_KEY and STRIPE_PRICE_ID are set.
CREATE TABLE IF NOT EXISTS employer_billing (
  employer_id TEXT PRIMARY KEY,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  status TEXT NOT NULL DEFAULT 'none',
  current_period_end TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_employer_billing_customer ON employer_billing(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_employer_billing_subscription ON employer_billing(stripe_subscription_id);
