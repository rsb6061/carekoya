-- Canonicalize caregiver identity by normalized email without deleting historical rows.
-- Duplicate rows are archived (email cleared + inactive) so foreign-key history remains intact.
CREATE TABLE IF NOT EXISTS _caregiver_dedupe_map (
  old_id TEXT PRIMARY KEY,
  keep_id TEXT NOT NULL
);

DELETE FROM _caregiver_dedupe_map;

INSERT INTO _caregiver_dedupe_map(old_id,keep_id)
WITH ranked AS (
  SELECT
    id,
    lower(trim(email)) AS email_key,
    FIRST_VALUE(id) OVER (
      PARTITION BY lower(trim(email))
      ORDER BY
        (
          CASE WHEN work_status='actively_looking' THEN 20 ELSE 0 END +
          CASE WHEN last_confirmed_at IS NOT NULL THEN 8 ELSE 0 END +
          CASE WHEN profile_photo_url IS NOT NULL AND trim(profile_photo_url)<>'' THEN 5 ELSE 0 END +
          CASE WHEN certifications IS NOT NULL AND trim(certifications)<>'' THEN 4 ELSE 0 END +
          CASE WHEN specialties IS NOT NULL AND trim(specialties)<>'' THEN 4 ELSE 0 END +
          CASE WHEN shift_preferences IS NOT NULL AND trim(shift_preferences)<>'' THEN 3 ELSE 0 END +
          CASE WHEN desired_wage IS NOT NULL AND trim(desired_wage)<>'' THEN 3 ELSE 0 END +
          CASE WHEN source_training_program_id IS NOT NULL THEN 3 ELSE 0 END +
          CASE WHEN phone IS NOT NULL AND trim(phone)<>'' THEN 2 ELSE 0 END +
          CASE WHEN zip IS NOT NULL AND trim(zip)<>'' THEN 2 ELSE 0 END +
          CASE WHEN role IS NOT NULL AND trim(role)<>'' THEN 2 ELSE 0 END
        ) DESC,
        datetime(updated_at) DESC,
        datetime(created_at) DESC,
        id ASC
    ) AS keep_id,
    ROW_NUMBER() OVER (
      PARTITION BY lower(trim(email))
      ORDER BY
        (
          CASE WHEN work_status='actively_looking' THEN 20 ELSE 0 END +
          CASE WHEN last_confirmed_at IS NOT NULL THEN 8 ELSE 0 END +
          CASE WHEN profile_photo_url IS NOT NULL AND trim(profile_photo_url)<>'' THEN 5 ELSE 0 END +
          CASE WHEN certifications IS NOT NULL AND trim(certifications)<>'' THEN 4 ELSE 0 END +
          CASE WHEN specialties IS NOT NULL AND trim(specialties)<>'' THEN 4 ELSE 0 END +
          CASE WHEN shift_preferences IS NOT NULL AND trim(shift_preferences)<>'' THEN 3 ELSE 0 END +
          CASE WHEN desired_wage IS NOT NULL AND trim(desired_wage)<>'' THEN 3 ELSE 0 END +
          CASE WHEN source_training_program_id IS NOT NULL THEN 3 ELSE 0 END +
          CASE WHEN phone IS NOT NULL AND trim(phone)<>'' THEN 2 ELSE 0 END +
          CASE WHEN zip IS NOT NULL AND trim(zip)<>'' THEN 2 ELSE 0 END +
          CASE WHEN role IS NOT NULL AND trim(role)<>'' THEN 2 ELSE 0 END
        ) DESC,
        datetime(updated_at) DESC,
        datetime(created_at) DESC,
        id ASC
    ) AS rn
  FROM caregivers
  WHERE email IS NOT NULL AND trim(email)<>''
)
SELECT id,keep_id FROM ranked WHERE rn>1;

-- Fill important gaps on the canonical record from its archived duplicates.
UPDATE caregivers AS c SET
  phone=COALESCE(NULLIF(c.phone,''),(SELECT NULLIF(d.phone,'') FROM caregivers d JOIN _caregiver_dedupe_map m ON m.old_id=d.id WHERE m.keep_id=c.id AND NULLIF(d.phone,'') IS NOT NULL ORDER BY datetime(d.updated_at) DESC LIMIT 1)),
  city=COALESCE(NULLIF(c.city,''),(SELECT NULLIF(d.city,'') FROM caregivers d JOIN _caregiver_dedupe_map m ON m.old_id=d.id WHERE m.keep_id=c.id AND NULLIF(d.city,'') IS NOT NULL ORDER BY datetime(d.updated_at) DESC LIMIT 1)),
  state=COALESCE(NULLIF(c.state,''),(SELECT NULLIF(d.state,'') FROM caregivers d JOIN _caregiver_dedupe_map m ON m.old_id=d.id WHERE m.keep_id=c.id AND NULLIF(d.state,'') IS NOT NULL ORDER BY datetime(d.updated_at) DESC LIMIT 1)),
  zip=COALESCE(NULLIF(c.zip,''),(SELECT NULLIF(d.zip,'') FROM caregivers d JOIN _caregiver_dedupe_map m ON m.old_id=d.id WHERE m.keep_id=c.id AND NULLIF(d.zip,'') IS NOT NULL ORDER BY datetime(d.updated_at) DESC LIMIT 1)),
  role=COALESCE(NULLIF(c.role,''),(SELECT NULLIF(d.role,'') FROM caregivers d JOIN _caregiver_dedupe_map m ON m.old_id=d.id WHERE m.keep_id=c.id AND NULLIF(d.role,'') IS NOT NULL ORDER BY datetime(d.updated_at) DESC LIMIT 1)),
  certifications=COALESCE(NULLIF(c.certifications,''),(SELECT NULLIF(d.certifications,'') FROM caregivers d JOIN _caregiver_dedupe_map m ON m.old_id=d.id WHERE m.keep_id=c.id AND NULLIF(d.certifications,'') IS NOT NULL ORDER BY datetime(d.updated_at) DESC LIMIT 1)),
  specialties=COALESCE(NULLIF(c.specialties,''),(SELECT NULLIF(d.specialties,'') FROM caregivers d JOIN _caregiver_dedupe_map m ON m.old_id=d.id WHERE m.keep_id=c.id AND NULLIF(d.specialties,'') IS NOT NULL ORDER BY datetime(d.updated_at) DESC LIMIT 1)),
  languages=COALESCE(NULLIF(c.languages,''),(SELECT NULLIF(d.languages,'') FROM caregivers d JOIN _caregiver_dedupe_map m ON m.old_id=d.id WHERE m.keep_id=c.id AND NULLIF(d.languages,'') IS NOT NULL ORDER BY datetime(d.updated_at) DESC LIMIT 1)),
  bio=COALESCE(NULLIF(c.bio,''),(SELECT NULLIF(d.bio,'') FROM caregivers d JOIN _caregiver_dedupe_map m ON m.old_id=d.id WHERE m.keep_id=c.id AND NULLIF(d.bio,'') IS NOT NULL ORDER BY datetime(d.updated_at) DESC LIMIT 1)),
  desired_wage=COALESCE(NULLIF(c.desired_wage,''),(SELECT NULLIF(d.desired_wage,'') FROM caregivers d JOIN _caregiver_dedupe_map m ON m.old_id=d.id WHERE m.keep_id=c.id AND NULLIF(d.desired_wage,'') IS NOT NULL ORDER BY datetime(d.updated_at) DESC LIMIT 1)),
  shift_preferences=COALESCE(NULLIF(c.shift_preferences,''),(SELECT NULLIF(d.shift_preferences,'') FROM caregivers d JOIN _caregiver_dedupe_map m ON m.old_id=d.id WHERE m.keep_id=c.id AND NULLIF(d.shift_preferences,'') IS NOT NULL ORDER BY datetime(d.updated_at) DESC LIMIT 1)),
  transportation=COALESCE(NULLIF(c.transportation,''),(SELECT NULLIF(d.transportation,'') FROM caregivers d JOIN _caregiver_dedupe_map m ON m.old_id=d.id WHERE m.keep_id=c.id AND NULLIF(d.transportation,'') IS NOT NULL ORDER BY datetime(d.updated_at) DESC LIMIT 1)),
  profile_photo_url=COALESCE(NULLIF(c.profile_photo_url,''),(SELECT NULLIF(d.profile_photo_url,'') FROM caregivers d JOIN _caregiver_dedupe_map m ON m.old_id=d.id WHERE m.keep_id=c.id AND NULLIF(d.profile_photo_url,'') IS NOT NULL ORDER BY datetime(d.updated_at) DESC LIMIT 1)),
  source_training_program_id=COALESCE(c.source_training_program_id,(SELECT d.source_training_program_id FROM caregivers d JOIN _caregiver_dedupe_map m ON m.old_id=d.id WHERE m.keep_id=c.id AND d.source_training_program_id IS NOT NULL ORDER BY datetime(d.updated_at) DESC LIMIT 1)),
  source_training_cohort_id=COALESCE(c.source_training_cohort_id,(SELECT d.source_training_cohort_id FROM caregivers d JOIN _caregiver_dedupe_map m ON m.old_id=d.id WHERE m.keep_id=c.id AND d.source_training_cohort_id IS NOT NULL ORDER BY datetime(d.updated_at) DESC LIMIT 1)),
  source_referral_code=COALESCE(NULLIF(c.source_referral_code,''),(SELECT NULLIF(d.source_referral_code,'') FROM caregivers d JOIN _caregiver_dedupe_map m ON m.old_id=d.id WHERE m.keep_id=c.id AND NULLIF(d.source_referral_code,'') IS NOT NULL ORDER BY datetime(d.updated_at) DESC LIMIT 1)),
  last_confirmed_at=COALESCE(c.last_confirmed_at,(SELECT MAX(d.last_confirmed_at) FROM caregivers d JOIN _caregiver_dedupe_map m ON m.old_id=d.id WHERE m.keep_id=c.id)),
  sms_consent=MAX(c.sms_consent,COALESCE((SELECT MAX(d.sms_consent) FROM caregivers d JOIN _caregiver_dedupe_map m ON m.old_id=d.id WHERE m.keep_id=c.id),0)),
  is_active=1,
  updated_at=CURRENT_TIMESTAMP
WHERE c.id IN (SELECT keep_id FROM _caregiver_dedupe_map);

-- Preserve historical foreign-key records in place, but remove duplicate profiles from active identity/search.
UPDATE caregivers
SET
  email=NULL,
  is_active=0,
  work_status='merged_duplicate',
  activation_token_hash=NULL,
  source_detail='merged_into:'||(SELECT keep_id FROM _caregiver_dedupe_map m WHERE m.old_id=caregivers.id),
  updated_at=CURRENT_TIMESTAMP
WHERE id IN (SELECT old_id FROM _caregiver_dedupe_map);

CREATE UNIQUE INDEX IF NOT EXISTS idx_caregivers_email_unique_ci
  ON caregivers(lower(trim(email)))
  WHERE email IS NOT NULL AND trim(email)<>'';

DROP TABLE _caregiver_dedupe_map;
