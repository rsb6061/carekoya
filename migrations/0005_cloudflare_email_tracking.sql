ALTER TABLE caregivers ADD COLUMN activation_message_id TEXT;
ALTER TABLE caregivers ADD COLUMN activation_delivery_status TEXT;
ALTER TABLE caregivers ADD COLUMN activation_delivery_error TEXT;

CREATE INDEX IF NOT EXISTS idx_caregivers_activation_delivery
  ON caregivers(source, activation_delivery_status, activation_sent_at);
