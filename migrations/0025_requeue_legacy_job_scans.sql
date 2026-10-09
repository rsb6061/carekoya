UPDATE agency_job_scan_state
SET last_scanned_at=NULL,
    last_status='requeued_for_deep_discovery',
    updated_at=CURRENT_TIMESTAMP
WHERE last_status='ok';
