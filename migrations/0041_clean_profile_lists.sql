-- Legacy CareKoya caregivers have JSON arrays in comma-text list fields ('["CPR/First Aid", "Driver''s License"]'),
-- sometimes followed by later edits ('[...], CNA'). Rewrite both shapes as plain comma text.
UPDATE caregivers SET certifications=COALESCE((SELECT group_concat(value,', ') FROM json_each(caregivers.certifications)),'') WHERE certifications LIKE '[%' AND json_valid(certifications);
UPDATE caregivers SET specialties=COALESCE((SELECT group_concat(value,', ') FROM json_each(caregivers.specialties)),'') WHERE specialties LIKE '[%' AND json_valid(specialties);
UPDATE caregivers SET languages=COALESCE((SELECT group_concat(value,', ') FROM json_each(caregivers.languages)),'') WHERE languages LIKE '[%' AND json_valid(languages);

UPDATE caregivers SET certifications=trim(COALESCE((SELECT group_concat(value,', ') FROM json_each(substr(caregivers.certifications,1,instr(caregivers.certifications,']')))),'')||', '||trim(substr(certifications,instr(certifications,']')+1),' ,'),' ,')
  WHERE certifications LIKE '[%],%' AND json_valid(substr(certifications,1,instr(certifications,']')));
UPDATE caregivers SET specialties=trim(COALESCE((SELECT group_concat(value,', ') FROM json_each(substr(caregivers.specialties,1,instr(caregivers.specialties,']')))),'')||', '||trim(substr(specialties,instr(specialties,']')+1),' ,'),' ,')
  WHERE specialties LIKE '[%],%' AND json_valid(substr(specialties,1,instr(specialties,']')));
UPDATE caregivers SET languages=trim(COALESCE((SELECT group_concat(value,', ') FROM json_each(substr(caregivers.languages,1,instr(caregivers.languages,']')))),'')||', '||trim(substr(languages,instr(languages,']')+1),' ,'),' ,')
  WHERE languages LIKE '[%],%' AND json_valid(substr(languages,1,instr(languages,']')));
