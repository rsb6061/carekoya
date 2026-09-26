UPDATE agency_job_scan_state
SET last_scanned_at=NULL,
    last_status='requeued_after_fetch_fallback',
    updated_at=CURRENT_TIMESTAMP
WHERE last_status='fetch_failed';
