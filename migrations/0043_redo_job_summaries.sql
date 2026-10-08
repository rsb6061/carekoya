-- The first summaries padded empty postings with invented duties; redo them with the stricter prompt.
UPDATE caregiver_jobs SET summary_text=NULL,summary_source_len=NULL,summary_error=NULL,summarized_at=NULL WHERE summary_text IS NOT NULL OR summary_error IS NOT NULL;
