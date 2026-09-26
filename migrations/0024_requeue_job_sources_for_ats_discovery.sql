UPDATE agency_job_scan_state
SET last_scanned_at=NULL,
    last_status='requeued_for_ats_discovery',
    updated_at=CURRENT_TIMESTAMP;

UPDATE caregiver_jobs
SET normalized_title=NULL,
    roles_json=NULL,
    canonical_fingerprint=NULL,
    updated_at=CURRENT_TIMESTAMP
WHERE status IN ('current','duplicate');
