-- Mail sent to hello@carejoys.com, caught by the Worker's email() handler (src/inboundEmail.ts) on its way to
-- Rebecca's Gmail. One row per message: who it came from, which lead it belongs to, and what kind of reply it is.
-- This is what follow-ups check before sending again, and what the admin Replies section lists.
CREATE TABLE IF NOT EXISTS email_messages (
  id TEXT PRIMARY KEY,
  direction TEXT NOT NULL DEFAULT 'inbound',
  -- The CareJoys address it was sent to.
  mailbox TEXT,
  from_email TEXT NOT NULL,
  from_name TEXT,
  subject TEXT,
  -- The reply's own words (quoted history cut off), at most 2,000 characters.
  snippet TEXT,
  message_id TEXT,
  in_reply_to TEXT,
  -- 'reply', 'unsubscribe', 'auto_reply' (out of office and the like) or 'bounce'
  kind TEXT NOT NULL DEFAULT 'reply',
  -- For a bounce: the address that failed, which is suppressed.
  bounced_email TEXT,
  -- 'employer', 'agency', 'school', 'training_program', 'applicant' or 'caregiver'; NULL when no lead matched.
  lead_type TEXT,
  lead_id TEXT,
  lead_name TEXT,
  -- 'new' until handled in admin.
  status TEXT NOT NULL DEFAULT 'new',
  forwarded INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- Mail servers retry; the same Message-ID is stored once.
CREATE UNIQUE INDEX IF NOT EXISTS idx_email_messages_message_id ON email_messages(message_id) WHERE message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_email_messages_created ON email_messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_messages_lead ON email_messages(lead_type,lead_id);
CREATE INDEX IF NOT EXISTS idx_email_messages_from ON email_messages(from_email);
