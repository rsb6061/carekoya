-- National senior living chains post every community's openings on one corporate job board, so each brand is one
-- organization pointed at that board instead of hundreds of community websites. The job scan searches these boards
-- for caregiving roles (src/jobDiscovery.ts, CHAIN_SEARCH_TERMS); jobs carry each community's own location.
-- Chains are facilities and is_chain=1: no agency outreach, no candidate matching, and the organization rebuild
-- (scripts/build-agency-organizations.mjs) leaves them alone.
-- Boards confirmed 2026-10-09: Brookdale, Atria and Aegis on iCIMS, Erickson on Workday. Five Star, Enlivant, Thrive,
-- Elmcroft and Senior Lifestyle were not confirmed and come in through their community listings instead.
INSERT INTO agency_organizations
  (id,organization_key,canonical_name,primary_domain,primary_website,primary_careers_url,careers_source,city,state,provider_types,
   caregiver_relevance_score,current_hiring_signal,provider_kind,is_chain,is_active,sources)
VALUES
  ('org_chain_brookdale','chain:brookdale','Brookdale Senior Living','brookdale.com','https://www.brookdale.com/',
   'https://jobs-brookdale.icims.com/jobs/search?ss=1','chain_board','Brentwood','TN','Senior living chain',90,'unknown','facility',1,1,'chain_board'),
  ('org_chain_atria','chain:atria','Atria Senior Living','atriaseniorliving.com','https://www.atriaseniorliving.com/',
   'https://communitysupport-atria.icims.com/jobs/search?ss=1','chain_board','Louisville','KY','Senior living chain',90,'unknown','facility',1,1,'chain_board'),
  ('org_chain_aegis','chain:aegis','Aegis Living','aegisliving.com','https://www.aegisliving.com/',
   'https://careers2-aegisliving.icims.com/jobs/search?ss=1','chain_board','Bellevue','WA','Senior living chain',90,'unknown','facility',1,1,'chain_board'),
  ('org_chain_erickson','chain:erickson','Erickson Senior Living','ericksonseniorliving.com','https://www.ericksonseniorliving.com/',
   'https://erickson.wd108.myworkdayjobs.com/en-US/External','chain_board','Catonsville','MD','Senior living chain',90,'unknown','facility',1,1,'chain_board')
ON CONFLICT(organization_key) DO UPDATE SET
  primary_careers_url=excluded.primary_careers_url,careers_source=excluded.careers_source,provider_kind='facility',is_chain=1,is_active=1,
  updated_at=CURRENT_TIMESTAMP;
