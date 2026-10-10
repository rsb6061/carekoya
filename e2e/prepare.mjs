// Fresh local database for the click-through test: every migration, then the accounts and jobs in fixtures.mjs.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { ADMIN, CAREGIVER, NEW_CAREGIVER, EMPLOYER, JOBS, LINKS, TRAINING } from './fixtures.mjs';

if(!existsSync('dist/index.html')){console.error('Build the site first: npm run build');process.exit(1);}
const PERSIST='.wrangler/e2e';
rmSync(PERSIST,{recursive:true,force:true});
const wrangler=(...args)=>execFileSync('npx',['wrangler',...args,'--local','--config','e2e/wrangler.e2e.jsonc','--persist-to',PERSIST],{stdio:['ignore','ignore','inherit']});
wrangler('d1','migrations','apply','DB');

const hash=v=>createHash('sha256').update(v).digest('hex');
const q=v=>v===null?'NULL':typeof v==='number'?String(v):"'"+String(v).replace(/'/g,"''")+"'";
const later="datetime('now','+2 days')";
const sql=`
INSERT INTO agency_organizations(id,organization_key,canonical_name,primary_domain,primary_website,city,state,is_active)
  VALUES ('e2e-org','e2e-org','Harbor Home Care','harborhomecare.test','https://harborhomecare.test','Baltimore','MD',1);
INSERT INTO caregiver_jobs(id,agency_organization_id,dedupe_key,source_provider,source_url,title,role,employer_name,city,state,zip,pay_min,pay_max,pay_period,status,is_published,summary_text)
  VALUES (${q(JOBS.applyForMe)},'e2e-org',${q(JOBS.applyForMe)},'lever','https://jobs.lever.co/harborhomecare/11111111-2222-3333-4444-555555555555','CNA - Day Shift','CNA','Harbor Home Care','Baltimore','MD','21201',18,22,'hour','current',1,'Day shift CNA visits for older adults in Baltimore.'),
         (${q(JOBS.external)},'e2e-org',${q(JOBS.external)},'test','https://harborhomecare.test/careers/hha','Home Health Aide','HHA','Harbor Home Care','Baltimore','MD','21202',17,20,'hour','current',1,'Home health aide visits around downtown Baltimore.');
INSERT INTO caregivers(id,first_name,last_name,email,phone,zip,state,city,role,certifications,work_status,last_confirmed_at,source,is_active,auth0_email_verified,shift_preferences,desired_wage,travel_distance_miles)
  VALUES (${q(CAREGIVER.id)},'Casey','Tester',${q(CAREGIVER.email)},'4105550100','21201','MD','Baltimore','CNA','CNA','actively_looking',CURRENT_TIMESTAMP,'organic',1,1,'days','18',25);
INSERT INTO account_sessions(id,email,session_hash,expires_at) VALUES
  ('e2e-s1',${q(CAREGIVER.email)},${q(hash(CAREGIVER.session))},${later}),
  ('e2e-s2',${q(NEW_CAREGIVER.email)},${q(hash(NEW_CAREGIVER.session))},${later}),
  ('e2e-s3',${q(EMPLOYER.email)},${q(hash(EMPLOYER.session))},${later}),
  ('e2e-s4',${q(ADMIN.email)},${q(hash(ADMIN.session))},${later});
INSERT INTO caregivers(id,first_name,last_name,email,zip,state,city,role,work_status,source,is_active,activation_token_hash)
  VALUES ('e2e-legacy','Lee','Legacy','e2e-legacy@example.test','21204','MD','Towson','GNA','unknown','legacy_carekoya',0,${q(hash(LINKS.activation))});
UPDATE agency_organizations SET primary_email='jobs@harborhomecare.test',primary_contact_name='Morgan Owner' WHERE id='e2e-org';
INSERT INTO agency_teaser_tokens(id,organization_id,token_hash,recipient_email,expires_at,sent_at)
  VALUES ('e2e-teaser','e2e-org',${q(hash(LINKS.agencyTeaser))},'jobs@harborhomecare.test',${later},CURRENT_TIMESTAMP);
INSERT INTO training_organizations(id,organization_key,canonical_name,slug,credential_categories,is_active)
  VALUES ('e2e-torg','e2e-torg','Harbor CNA Academy',${q(TRAINING.slug)},'CNA/GNA',1);
INSERT INTO training_programs(id,source,source_key,organization_id,program_name,provider_type,city,zip,is_active)
  VALUES ('e2e-tp','test','e2e-tp','e2e-torg','Harbor CNA Academy','Freestanding Program','Baltimore','21201',1);
INSERT INTO employer_leads(id,company_name,contact_name,email,zip,roles_needed,status,approved_at)
  VALUES (${q(EMPLOYER.id)},'Harbor Home Care','Pat Tester',${q(EMPLOYER.email)},'21201','CNA','active',CURRENT_TIMESTAMP);
INSERT INTO employer_sessions(id,employer_id,session_hash,expires_at) VALUES ('e2e-es1',${q(EMPLOYER.id)},${q(hash(EMPLOYER.session))},${later});
`;
mkdirSync(PERSIST,{recursive:true});
writeFileSync(PERSIST+'/seed.sql',sql);
wrangler('d1','execute','DB','--file',PERSIST+'/seed.sql');
console.log('e2e database ready');
