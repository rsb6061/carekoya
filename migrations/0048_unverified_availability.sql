-- Historic unsigned web submissions must not appear as actively confirmed job seekers.
-- Preserve records and availability_events; only reset unsupported visibility markers.
UPDATE caregivers SET work_status='unknown',last_confirmed_at=NULL,updated_at=CURRENT_TIMESTAMP
WHERE source IN ('organic','resume_upload') AND COALESCE(auth0_email_verified,0)!=1
  AND work_status='actively_looking' AND activation_completed_at IS NULL;
