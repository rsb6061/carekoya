-- Reply drafts written for Rebecca (src/replyDrafter.ts). The draft row keeps the AI's first version in draft_original,
-- untouched by her edits, so what she changed before sending can be compared and folded into the drafting playbook.
ALTER TABLE email_messages ADD COLUMN drafted_by TEXT;
ALTER TABLE email_messages ADD COLUMN draft_original TEXT;
-- One AI draft per inbound message, even when two runs pick it up at once.
CREATE UNIQUE INDEX IF NOT EXISTS idx_email_messages_ai_draft ON email_messages(reply_to_id) WHERE direction='outbound' AND drafted_by IS NOT NULL;
