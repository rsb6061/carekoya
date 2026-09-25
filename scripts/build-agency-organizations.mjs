import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';

const OUT=process.argv[2]||'/tmp/agency-organizations.sql';
const run=(sql)=>JSON.parse(execFileSync('npx',['wrangler','d1','execute','DB','--remote','--json','--command',sql],{encoding:'utf8'}));
const rows=((run("SELECT id,name,legal_name,email,phone,contact_name,city,state,provider_type,organization_key,caregiver_match_eligible FROM agencies WHERE is_active=1 AND source LIKE 'maryland_ohcq_%' ORDER BY name;")[0]||{}).results)||[];

const free=new Set(['gmail.com','yahoo.com','hotmail.com','outlook.com','aol.com','icloud.com','comcast.net','verizon.net','msn.com','live.com']);
const clean=v=>String(v||'').trim();
const norm=v=>clean(v).toLowerCase().replace(/[^a-z0-9]/g,'');
const domain=e=>{const s=clean(e).toLowerCase();const i=s.lastIndexOf('@');return i>0?s.slice(i+1):''};
const brand=n=>clean(n).toLowerCase()
  .replace(/&/g,' and ')
  .replace(/\b(llc|inc|incorporated|corp|corporation|company|limited|ltd|pllc)\b/g,' ')
  .replace(/[^a-z0-9]+/g,' ')
  .replace(/\s+/g,' ')
  .trim();

function key(r){
  const d=domain(r.email);
  if(d&&!free.has(d))return 'domain:'+d;
  const b=norm(brand(r.name));
  return 'name:'+b+'|state:'+norm(r.state||'MD')+'|city:'+norm(r.city);
}
function esc(v){return v===null||v===undefined||v===''?'NULL':"'"+String(v).replaceAll("'","''")+"'"}
function idFor(k){return 'org_'+crypto.createHash('sha256').update(k).digest('hex').slice(0,24)}

const groups=new Map();
for(const r of rows){
  const k=key(r),id=idFor(k);
  if(!groups.has(k))groups.set(k,{id,key:k,rows:[],domains:new Set(),types:new Set()});
  const g=groups.get(k);g.rows.push(r);
  const d=domain(r.email);if(d&&!free.has(d))g.domains.add(d);
  if(r.provider_type)g.types.add(r.provider_type);
}
const sql=[];
sql.push("UPDATE agency_organizations SET is_active=0,updated_at=CURRENT_TIMESTAMP;");
for(const g of groups.values()){
  const rs=g.rows;
  const pick=field=>rs.map(r=>clean(r[field])).find(Boolean)||'';
  const name=pick('name');
  const primaryDomain=[...g.domains][0]||'';
  const primaryEmail=rs.map(r=>clean(r.email).toLowerCase()).find(e=>e&&(!primaryDomain||e.endsWith('@'+primaryDomain)))||pick('email').toLowerCase();
  const providerTypes=[...g.types].sort().join(', ');
  sql.push(`INSERT INTO agency_organizations
    (id,organization_key,canonical_name,primary_domain,primary_email,primary_phone,primary_contact_name,city,state,provider_types,license_count,is_active,updated_at)
    VALUES (${esc(g.id)},${esc(g.key)},${esc(name)},${esc(primaryDomain)},${esc(primaryEmail)},${esc(pick('phone'))},${esc(pick('contact_name'))},${esc(pick('city'))},${esc(pick('state')||'MD')},${esc(providerTypes)},${rs.length},1,CURRENT_TIMESTAMP)
    ON CONFLICT(organization_key) DO UPDATE SET canonical_name=excluded.canonical_name,primary_domain=excluded.primary_domain,
      primary_email=excluded.primary_email,primary_phone=excluded.primary_phone,primary_contact_name=excluded.primary_contact_name,
      city=excluded.city,state=excluded.state,provider_types=excluded.provider_types,license_count=excluded.license_count,is_active=1,updated_at=CURRENT_TIMESTAMP;`);
  for(const r of rs)sql.push(`UPDATE agencies SET organization_id=${esc(g.id)},organization_key=${esc(g.key)},updated_at=CURRENT_TIMESTAMP WHERE id=${esc(r.id)};`);
  const roles=new Set();
  if(providerTypes.includes('Home Health Agency'))roles.add('HHA');
  if(providerTypes.includes('Residential Service Agency')){roles.add('Caregiver');roles.add('PCA');}
  if(providerTypes.includes('Health Care Staff Agency')){roles.add('CNA');roles.add('GNA');roles.add('HHA');}
  sql.push(`INSERT INTO agency_org_hiring_profiles(organization_id,hiring_status,roles,service_areas,roles_source,geography_source,hiring_status_source,updated_at)
    VALUES (${esc(g.id)},'unknown',${esc([...roles].join(', '))},${esc([pick('city'),pick('state')].filter(Boolean).join(', '))},'inferred_from_provider_type','license_directory','inferred',CURRENT_TIMESTAMP)
    ON CONFLICT(organization_id) DO UPDATE SET
      roles=CASE WHEN agency_org_hiring_profiles.employer_confirmed_at IS NULL THEN excluded.roles ELSE agency_org_hiring_profiles.roles END,
      service_areas=CASE WHEN agency_org_hiring_profiles.employer_confirmed_at IS NULL THEN excluded.service_areas ELSE agency_org_hiring_profiles.service_areas END,
      roles_source=CASE WHEN agency_org_hiring_profiles.employer_confirmed_at IS NULL THEN excluded.roles_source ELSE agency_org_hiring_profiles.roles_source END,
      geography_source=CASE WHEN agency_org_hiring_profiles.employer_confirmed_at IS NULL THEN excluded.geography_source ELSE agency_org_hiring_profiles.geography_source END,
      updated_at=CURRENT_TIMESTAMP;`);
}
fs.writeFileSync(OUT,sql.join('\n'));
console.log(JSON.stringify({licensedRecords:rows.length,organizations:groups.size,sqlStatements:sql.length,output:OUT}));
