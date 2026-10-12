-- CareJoys texts on top of the shared SMS tables (0062): quiet-hours queue, short reply links,
-- one-time markers for each automatic text, and an agency's opt-in "a caregiver said yes" alert.

-- A text that lands outside 8am-9pm recipient time waits as status='scheduled' until send_after (UTC ISO);
-- one still waiting at send_before (e.g. the interview start) is dropped as 'expired'.
ALTER TABLE sms_messages ADD COLUMN send_after TEXT;
ALTER TABLE sms_messages ADD COLUMN send_before TEXT;
ALTER TABLE sms_messages ADD COLUMN time_zone TEXT;
CREATE INDEX IF NOT EXISTS idx_sms_messages_queue ON sms_messages(status, send_after);

-- carejoys.com/r/<code>: the code works like the invitation's response token. Only its hash is stored.
CREATE TABLE IF NOT EXISTS sms_response_links (
  code_hash TEXT PRIMARY KEY,
  pipeline_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_sms_response_links_pipeline ON sms_response_links(pipeline_id);

-- Each automatic text goes once per invitation.
ALTER TABLE candidate_pipeline ADD COLUMN sms_invited_at TEXT;
ALTER TABLE candidate_pipeline ADD COLUMN sms_interview_day_at TEXT;
ALTER TABLE candidate_pipeline ADD COLUMN sms_interview_soon_at TEXT;
ALTER TABLE candidate_pipeline ADD COLUMN agency_texted_at TEXT;

-- Agencies stay on email unless someone in the workspace opts in from Settings with a mobile number.
ALTER TABLE employer_leads ADD COLUMN sms_alert_phone TEXT;
ALTER TABLE employer_leads ADD COLUMN sms_alerts_enabled INTEGER NOT NULL DEFAULT 0;

-- Nothing collected text consent before this migration, so any caregivers.sms_consent=1 came from an import
-- (CareKoya data merged in 0019). Those people never ticked a CareJoys box: clear the flag so they are never texted
-- and their profile checkbox starts unticked.
UPDATE caregivers SET sms_consent=0 WHERE sms_consent=1;
