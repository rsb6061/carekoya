// Groups every active `agencies` row (state licence lists, NPI registry, CMS nursing homes, Google listings) into
// `agency_organizations`, and writes the SQL as parts next to /tmp/agency-organizations.sql (or argv[2]):
// agency-organizations.part-001.sql, part-002.sql, … — run them in order. One file outgrew Node's string limit.
// Grouping rules live in scripts/lib/agency-sources.mjs; Maryland-only data produces the same keys as before.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { UNREACHABLE_SOURCES, groupAgencies, inferredRoles, organizationFields, sql as esc } from './lib/agency-sources.mjs';

const OUT=process.argv[2]||'/tmp/agency-organizations.sql';
const run=(sql)=>JSON.parse(execFileSync('npx',['wrangler','d1','execute','DB','--remote','--json','--command',sql],{encoding:'utf8',maxBuffer:200*1024*1024}));
// Read in pages by id, then order by name as the single query did, so grouping is unchanged.
const PAGE=50000;
const rows=[];
for(let after='';;){
  const page=((run(`SELECT id,source,name,legal_name,email,phone,website,contact_name,address1,city,state,zip,provider_type,
    caregiver_match_eligible,caregiver_relevance_score,npi,google_place_id,rating,review_count,provider_kind,bed_count
    FROM agencies WHERE is_active=1 AND id>'${after.replaceAll("'","''")}' ORDER BY id LIMIT ${PAGE};`)[0]||{}).results)||[];
  rows.push(...page);
  if(page.length<PAGE)break;
  after=page[page.length-1].id;
}
// An empty read must never reach the deactivate-everything statement below.
if(!rows.length)throw new Error('Read no active agencies; refusing to write a rebuild that would deactivate every organization');
rows.sort((a,b)=>String(a.name??'')<String(b.name??'')?-1:String(a.name??'')>String(b.name??'')?1:0);

const groups=groupAgencies(rows);
// Parts left by an earlier run would otherwise be executed too.
const PREFIX=path.basename(OUT).replace(/\.sql$/,'')+'.part-';
for(const f of fs.readdirSync(path.dirname(OUT)))if(f.startsWith(PREFIX))fs.rmSync(path.join(path.dirname(OUT),f));
const PART_BYTES=40*1024*1024;
const parts=[];
let part=[],partBytes=0,statements=0;
const flush=()=>{
  if(!part.length)return;
  const file=path.join(path.dirname(OUT),PREFIX+String(parts.length+1).padStart(3,'0')+'.sql');
  fs.writeFileSync(file,part.join('\n'));
  parts.push(file);part=[];partBytes=0;
};
const out={push(statement){
  part.push(statement);partBytes+=statement.length+1;statements++;
  if(partBytes>=PART_BYTES)flush();
}};
// Chain job boards are seeded by hand (migrations), not grouped from `agencies`, so they stay as they are.
out.push("UPDATE agency_organizations SET is_active=0,updated_at=CURRENT_TIMESTAMP WHERE COALESCE(is_chain,0)=0;");
for(const g of groups){
  const f=organizationFields(g);
  // An agency known only from the NPI registry or CMS has no website or email to reach it by, so it stays
  // inactive (out of counts, matching and outreach) unless it has been claimed or an email was found for it.
  const npiOnly=f.sources.split(', ').every(s=>UNREACHABLE_SOURCES.has(s));
  const active=npiOnly?"CASE WHEN agency_organizations.claimed_employer_id IS NOT NULL OR coalesce(agency_organizations.primary_email,'')!='' THEN 1 ELSE 0 END":'1';
  out.push(`INSERT INTO agency_organizations
    (id,organization_key,canonical_name,primary_domain,primary_email,primary_website,website_source,primary_phone,primary_contact_name,city,state,zip,
     provider_types,license_count,caregiver_relevance_score,npi,google_place_id,rating,review_count,sources,provider_kind,bed_count,is_active,updated_at)
    VALUES (${esc(g.id)},${esc(g.key)},${esc(f.name)},${esc(f.primaryDomain)},${esc(f.primaryEmail)},${esc(f.primaryWebsite)},${esc(f.primaryWebsite?'google_business':null)},
      ${esc(f.phone)},${esc(f.contactName)},${esc(f.city)},${esc(f.state)},${esc(f.zip)},${esc(f.providerTypes)},${f.licenseCount},${f.relevance},
      ${esc(f.npi)},${esc(f.googlePlaceId)},${esc(f.rating)},${esc(f.reviewCount)},${esc(f.sources)},${esc(f.providerKind)},${esc(f.bedCount)},${npiOnly?0:1},CURRENT_TIMESTAMP)
    ON CONFLICT(organization_key) DO UPDATE SET canonical_name=excluded.canonical_name,
      primary_domain=COALESCE(excluded.primary_domain,agency_organizations.primary_domain),
      primary_email=COALESCE(excluded.primary_email,agency_organizations.primary_email),
      primary_website=COALESCE(excluded.primary_website,agency_organizations.primary_website),
      website_source=COALESCE(excluded.website_source,agency_organizations.website_source),
      primary_phone=excluded.primary_phone,primary_contact_name=excluded.primary_contact_name,
      city=excluded.city,state=excluded.state,zip=excluded.zip,provider_types=excluded.provider_types,license_count=excluded.license_count,
      caregiver_relevance_score=excluded.caregiver_relevance_score,npi=excluded.npi,google_place_id=excluded.google_place_id,
      rating=excluded.rating,review_count=excluded.review_count,sources=excluded.sources,provider_kind=excluded.provider_kind,bed_count=excluded.bed_count,is_active=${active},updated_at=CURRENT_TIMESTAMP;`);
  for(let i=0;i<g.rows.length;i+=500)out.push(`UPDATE agencies SET organization_id=${esc(g.id)},organization_key=${esc(g.key)},updated_at=CURRENT_TIMESTAMP WHERE id IN (${g.rows.slice(i,i+500).map(r=>esc(r.id)).join(',')});`);
  const geographySource=g.rows[0].source==='nppes'?'npi_registry':g.rows[0].source==='cms_nursing_home'?'cms_care_compare':g.rows[0].source==='google_business'?'google_business':'license_directory';
  out.push(`INSERT INTO agency_org_hiring_profiles(organization_id,hiring_status,roles,service_areas,roles_source,geography_source,hiring_status_source,updated_at)
    VALUES (${esc(g.id)},'unknown',${esc(inferredRoles(f.providerTypes).join(', '))},${esc([f.city,f.state].filter(Boolean).join(', '))},'inferred_from_provider_type',${esc(geographySource)},'inferred',CURRENT_TIMESTAMP)
    ON CONFLICT(organization_id) DO UPDATE SET
      roles=CASE WHEN agency_org_hiring_profiles.employer_confirmed_at IS NULL THEN excluded.roles ELSE agency_org_hiring_profiles.roles END,
      service_areas=CASE WHEN agency_org_hiring_profiles.employer_confirmed_at IS NULL THEN excluded.service_areas ELSE agency_org_hiring_profiles.service_areas END,
      roles_source=CASE WHEN agency_org_hiring_profiles.employer_confirmed_at IS NULL THEN excluded.roles_source ELSE agency_org_hiring_profiles.roles_source END,
      geography_source=CASE WHEN agency_org_hiring_profiles.employer_confirmed_at IS NULL THEN excluded.geography_source ELSE agency_org_hiring_profiles.geography_source END,
      updated_at=CURRENT_TIMESTAMP;`);
}
flush();
const bySource={};
for(const r of rows)bySource[r.source]=(bySource[r.source]||0)+1;
console.log(JSON.stringify({agencyRecords:rows.length,bySource,organizations:groups.length,sqlStatements:statements,parts}));
