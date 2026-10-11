-- Shared two-way SMS (src/sms.ts). Every row carries a brand so one Twilio account can serve several brands,
-- each through its own Messaging Service.

-- Current consent per brand and phone (E.164). Sends require status='opted_in'.
CREATE TABLE IF NOT EXISTS sms_consents (
  brand TEXT NOT NULL,
  phone TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('opted_in','opted_out')),
  source TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (brand, phone)
);

-- Append-only consent audit trail (TCPA): every opt-in with the exact wording shown, every STOP/START/HELP.
CREATE TABLE IF NOT EXISTS sms_consent_events (
  id TEXT PRIMARY KEY,
  brand TEXT NOT NULL,
  phone TEXT NOT NULL,
  event TEXT NOT NULL CHECK (event IN ('opt_in','opt_out','help')),
  source TEXT NOT NULL,
  consent_text TEXT,
  ip TEXT,
  user_agent TEXT,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_sms_consent_events_phone ON sms_consent_events(brand, phone, created_at);

-- Every text in and out. Outbound rows follow Twilio's status callbacks, so "no reply" (delivered, nothing back)
-- is distinguishable from "not delivered" (undelivered/failed, with Twilio's error code).
CREATE TABLE IF NOT EXISTS sms_messages (
  id TEXT PRIMARY KEY,
  brand TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('outbound','inbound')),
  phone TEXT NOT NULL,
  body TEXT NOT NULL,
  template TEXT,
  related_type TEXT,
  related_id TEXT,
  twilio_sid TEXT UNIQUE,
  status TEXT NOT NULL,
  error_code TEXT,
  error_message TEXT,
  intent TEXT,
  in_reply_to TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  delivered_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_sms_messages_phone ON sms_messages(brand, phone, created_at);
CREATE INDEX IF NOT EXISTS idx_sms_messages_related ON sms_messages(related_type, related_id);
CREATE INDEX IF NOT EXISTS idx_sms_messages_status ON sms_messages(brand, status, created_at);
