UPDATE caregivers
SET activation_token_hash = NULL,
    activation_sent_at = NULL,
    activation_opened_at = NULL,
    activation_completed_at = NULL,
    updated_at = CURRENT_TIMESTAMP
WHERE source = 'legacy_carekoya'
  AND activation_completed_at IS NULL;
