// Groups every active `agencies` row (state licence lists, NPI registry, Google listings) into
// `agency_organizations`, and writes the SQL to /tmp/agency-organizations.sql (or argv[2]).
// Grouping rules live in scripts/lib/agency-sources.mjs; Maryland-only data produces the same keys as before.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { groupAgencies, inferredRoles, organizationFields, sql as esc } from './lib/agency-sources.mjs';

const OUT=process.argv[2]||'/tmp/agency-organizations.sql';
const run=(sql)=>JSON.parse(execFileSync('npx',['wrangler','d1','execute','DB','--remote','--json','--command',sql],{encoding:'utf8',maxBuffer:200*1024*1024}));
const rows=((run(`SELECT id,source,name,legal_name,email,phone,website,contact_name,address1,city,state,zip,provider_type,
  caregiver_match_eligible,caregiver_relevance_score,npi,google_place_id,rating,review_count
  FROM agencies WHERE is_active=1 ORDER BY name;`)[0]||{}).results)||[];

const groups=groupAgencies(rows);
const out=[];
out.push("UPDATE agency_organizations SET is_active=0,updated_at=CURRENT_TIMESTAMP;");
for(const g of groups){
  const f=organizationFields(g);
  out.push(`INSERT INTO agency_organizations
    (id,organization_key,canonical_name,primary_domain,primary_email,primary_website,website_source,primary_phone,primary_contact_name,city,state,zip,
     provider_types,license_count,caregiver_relevance_score,npi,google_place_id,rating,review_count,sources,is_active,updated_at)
    VALUES (${esc(g.id)},${esc(g.key)},${esc(f.name)},${esc(f.primaryDomain)},${esc(f.primaryEmail)},${esc(f.primaryWebsite)},${esc(f.primaryWebsite?'google_business':null)},
      ${esc(f.phone)},${esc(f.contactName)},${esc(f.city)},${esc(f.state)},${esc(f.zip)},${esc(f.providerTypes)},${f.licenseCount},${f.relevance},
      ${esc(f.npi)},${esc(f.googlePlaceId)},${esc(f.rating)},${esc(f.reviewCount)},${esc(f.sources)},1,CURRENT_TIMESTAMP)
    ON CONFLICT(organization_key) DO UPDATE SET canonical_name=excluded.canonical_name,
      primary_domain=COALESCE(excluded.primary_domain,agency_organizations.primary_domain),
      primary_email=COALESCE(excluded.primary_email,agency_organizations.primary_email),
      primary_website=COALESCE(excluded.primary_website,agency_organizations.primary_website),
      website_source=COALESCE(excluded.website_source,agency_organizations.website_source),
      primary_phone=excluded.primary_phone,primary_contact_name=excluded.primary_contact_name,
      city=excluded.city,state=excluded.state,zip=excluded.zip,provider_types=excluded.provider_types,license_count=excluded.license_count,
      caregiver_relevance_score=excluded.caregiver_relevance_score,npi=excluded.npi,google_place_id=excluded.google_place_id,
      rating=excluded.rating,review_count=excluded.review_count,sources=excluded.sources,is_active=1,updated_at=CURRENT_TIMESTAMP;`);
  for(const r of g.rows)out.push(`UPDATE agencies SET organization_id=${esc(g.id)},organization_key=${esc(g.key)},updated_at=CURRENT_TIMESTAMP WHERE id=${esc(r.id)};`);
  const geographySource=g.rows[0].source==='nppes'?'npi_registry':g.rows[0].source==='google_business'?'google_business':'license_directory';
  out.push(`INSERT INTO agency_org_hiring_profiles(organization_id,hiring_status,roles,service_areas,roles_source,geography_source,hiring_status_source,updated_at)
    VALUES (${esc(g.id)},'unknown',${esc(inferredRoles(f.providerTypes).join(', '))},${esc([f.city,f.state].filter(Boolean).join(', '))},'inferred_from_provider_type',${esc(geographySource)},'inferred',CURRENT_TIMESTAMP)
    ON CONFLICT(organization_id) DO UPDATE SET
      roles=CASE WHEN agency_org_hiring_profiles.employer_confirmed_at IS NULL THEN excluded.roles ELSE agency_org_hiring_profiles.roles END,
      service_areas=CASE WHEN agency_org_hiring_profiles.employer_confirmed_at IS NULL THEN excluded.service_areas ELSE agency_org_hiring_profiles.service_areas END,
      roles_source=CASE WHEN agency_org_hiring_profiles.employer_confirmed_at IS NULL THEN excluded.roles_source ELSE agency_org_hiring_profiles.roles_source END,
      geography_source=CASE WHEN agency_org_hiring_profiles.employer_confirmed_at IS NULL THEN excluded.geography_source ELSE agency_org_hiring_profiles.geography_source END,
      updated_at=CURRENT_TIMESTAMP;`);
}
fs.writeFileSync(OUT,out.join('\n'));
const bySource={};
for(const r of rows)bySource[r.source]=(bySource[r.source]||0)+1;
console.log(JSON.stringify({agencyRecords:rows.length,bySource,organizations:groups.length,sqlStatements:out.length,output:OUT}));
