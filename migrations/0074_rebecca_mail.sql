-- Rebecca's mail from the admin console (src/adminMail.ts): sent messages and drafts are outbound email_messages rows.
ALTER TABLE email_messages ADD COLUMN to_email TEXT;
-- The recorded message an outbound reply answers.
ALTER TABLE email_messages ADD COLUMN reply_to_id TEXT;
-- Reply-yes outreach (src/replyYesOutreach.ts) never emails an address twice, so it looks events up by recipient.
CREATE INDEX IF NOT EXISTS idx_agency_outreach_recipient ON agency_outreach_events(recipient_email,event_type);
