UPDATE training_programs SET
  website='https://caroline-center.org/',
  email='carolinecenter@caroline-center.org',
  phone='410-563-1303',
  contact_source_url='https://caroline-center.org/contact/',
  contact_checked_at=CURRENT_TIMESTAMP,
  updated_at=CURRENT_TIMESTAMP
WHERE source='maryland_mbon_natp' AND lower(program_name)='caroline center';

UPDATE training_programs SET
  website='https://www.compassionateacademy.com/',
  email='info@compassionateacademy.com',
  phone='301-332-9699',
  contact_source_url='https://www.compassionateacademy.com/healthcare-training-contact-us',
  contact_checked_at=CURRENT_TIMESTAMP,
  updated_at=CURRENT_TIMESTAMP
WHERE source='maryland_mbon_natp' AND lower(program_name) LIKE 'compassionate academy%';

UPDATE training_programs SET
  website='https://www.fomennursingassistant.com/',
  email='fomennursing@gmail.com',
  phone=CASE WHEN lower(program_name) LIKE '%glen burnie%' THEN '410-553-4068' ELSE '301-328-0423' END,
  contact_source_url='https://www.fomennursingassistant.com/healthcare-training-scholarship',
  contact_checked_at=CURRENT_TIMESTAMP,
  updated_at=CURRENT_TIMESTAMP
WHERE source='maryland_mbon_natp' AND lower(program_name) LIKE 'fomen nursing assistant training academy%';

UPDATE training_programs SET
  website='https://newdestinyhcc.com/',
  email='newdestinyhcc@gmail.com',
  phone='410-296-5070',
  contact_source_url='https://dhs.maryland.gov/documents/SNAP/FFY%2024-26%20E%26T%20Partner%20Database%20Public.pdf',
  contact_checked_at=CURRENT_TIMESTAMP,
  updated_at=CURRENT_TIMESTAMP
WHERE source='maryland_mbon_natp' AND lower(program_name) LIKE 'new destiny health career center%';

UPDATE training_programs SET
  website='https://www.visionalliedinstitute.org/',
  phone='443-520-0801',
  contact_source_url='https://www.visionalliedinstitute.org/contact-us',
  contact_checked_at=CURRENT_TIMESTAMP,
  updated_at=CURRENT_TIMESTAMP
WHERE source='maryland_mbon_natp' AND lower(program_name) LIKE 'vision allied health institute%';

UPDATE training_programs SET
  website='https://www.mstarna.com/',
  phone='301-977-7393',
  contact_source_url='https://www.mstarna.com/contact-us',
  contact_checked_at=CURRENT_TIMESTAMP,
  updated_at=CURRENT_TIMESTAMP
WHERE source='maryland_mbon_natp' AND lower(program_name) LIKE 'morning star academy%';

UPDATE training_programs SET
  website='https://tkhci.com/',
  email='info@tkhci.com',
  phone='410-528-1600',
  contact_source_url='https://tkhci.com/contact/',
  contact_checked_at=CURRENT_TIMESTAMP,
  updated_at=CURRENT_TIMESTAMP
WHERE source='maryland_mbon_natp' AND lower(program_name) LIKE 'top knowledge healthcare institute%';

UPDATE training_programs SET
  email='elhnursing@gmail.com',
  phone='667-383-9309',
  contact_source_url='https://voyagebaltimore.com/interview/community-highlights-meet-dr-ericka-of-elh-nursing-solutions/',
  contact_checked_at=CURRENT_TIMESTAMP,
  updated_at=CURRENT_TIMESTAMP
WHERE source='maryland_mbon_natp' AND lower(program_name) LIKE 'elh nursing solutions%';


UPDATE training_programs SET
  website='https://www.jirehhcinstitute.com/',
  email='info@jirehhcinstitute.com',
  phone='240-730-4816',
  contact_source_url='https://www.jirehhcinstitute.com/contact',
  contact_checked_at=CURRENT_TIMESTAMP,
  updated_at=CURRENT_TIMESTAMP
WHERE source='maryland_mbon_natp' AND lower(program_name) LIKE 'jireh healthcare institute%';

UPDATE training_programs SET
  website='https://www.bethelhcinstitute.com/',
  email='bethelhealthcare@aol.com',
  phone='301-559-0200',
  contact_source_url='https://www.bethelhcinstitute.com/healthcare-training-contact-us',
  contact_checked_at=CURRENT_TIMESTAMP,
  updated_at=CURRENT_TIMESTAMP
WHERE source='maryland_mbon_natp' AND lower(program_name) LIKE 'bethel healthcare institute%';

UPDATE training_programs SET
  website='https://cambridgegna.com/',
  email='info@cambridgegna.com',
  phone=CASE
    WHEN lower(program_name) LIKE '%gaithersburg%' THEN '301-990-8311'
    WHEN lower(program_name) LIKE '%hyattsville%' THEN '301-853-9100'
    ELSE phone END,
  contact_source_url='https://cambridgegna.com/contact-us/',
  contact_checked_at=CURRENT_TIMESTAMP,
  updated_at=CURRENT_TIMESTAMP
WHERE source='maryland_mbon_natp' AND lower(program_name) LIKE 'cambridge nursing assistant academy%';

UPDATE training_programs SET
  website='https://www.dominionahs.com/',
  email='dominionacademy@hotmail.com',
  phone='240-770-7774',
  contact_source_url='https://www.dominionahs.com/',
  contact_checked_at=CURRENT_TIMESTAMP,
  updated_at=CURRENT_TIMESTAMP
WHERE source='maryland_mbon_natp' AND lower(program_name) LIKE 'dominion academy%';


UPDATE training_programs SET
  website='https://amc-careerinstitute.com/',
  email='info@amc-careerinstitute.com',
  phone='240-413-9916',
  contact_source_url='https://amc-careerinstitute.com/contact-us/',
  contact_checked_at=CURRENT_TIMESTAMP,
  updated_at=CURRENT_TIMESTAMP
WHERE source='maryland_mbon_natp' AND lower(program_name) LIKE 'amc career institute%';

UPDATE training_programs SET
  website='https://gandhihealthcare.com/',
  email='Gandhihealthcareer@gmail.com',
  phone='443-352-8030',
  contact_source_url='https://gandhihealthcare.com/contact-gandhi-health-care/',
  contact_checked_at=CURRENT_TIMESTAMP,
  updated_at=CURRENT_TIMESTAMP
WHERE source='maryland_mbon_natp' AND lower(program_name) LIKE 'gandhi health care%';

UPDATE training_programs SET
  website='https://knowledgefirstinstitute.com/',
  email='info@knowledgefirstinstitute.com',
  phone='301-933-7474',
  contact_source_url='https://knowledgefirstinstitute.com/admission/',
  contact_checked_at=CURRENT_TIMESTAMP,
  updated_at=CURRENT_TIMESTAMP
WHERE source='maryland_mbon_natp' AND lower(program_name) LIKE 'knowledge first institute%';

UPDATE training_programs SET
  website='https://www.heritagecare.org/',
  email='info@heritagecare.org',
  phone='301-237-6677',
  contact_source_url='https://www.heritagecare.org/copy-of-contact-us',
  contact_checked_at=CURRENT_TIMESTAMP,
  updated_at=CURRENT_TIMESTAMP
WHERE source='maryland_mbon_natp' AND lower(program_name) LIKE 'heritage care inc.%';

UPDATE training_programs SET
  website='https://www.psona.net/',
  email='menda41@aol.com',
  phone='301-434-8636',
  contact_source_url='https://www.psona.net/',
  contact_checked_at=CURRENT_TIMESTAMP,
  updated_at=CURRENT_TIMESTAMP
WHERE source='maryland_mbon_natp' AND lower(program_name) LIKE 'perpetual school of nursing assistant%';

UPDATE training_programs SET
  website='https://demasacademyllc.com/',
  email='info@demasacademyllc.com',
  phone='301-213-1812',
  contact_source_url='https://demasacademyllc.com/',
  contact_checked_at=CURRENT_TIMESTAMP,
  updated_at=CURRENT_TIMESTAMP
WHERE source='maryland_mbon_natp' AND lower(program_name) LIKE 'dema''s academy%';
