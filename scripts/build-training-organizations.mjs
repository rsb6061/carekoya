import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';

const OUT=process.argv[2]||'/tmp/training-organizations.sql';
const run=(sql)=>JSON.parse(execFileSync('npx',['wrangler','d1','execute','DB','--remote','--json','--command',sql],{encoding:'utf8',maxBuffer:50*1024*1024}));
const query="SELECT tp.id,tp.program_name,tp.provider_type,tp.city,tp.state,tp.zip,tp.website,tp.email,tp.primary_domain,tp.program_type,src.slug AS referral_slug FROM training_programs tp LEFT JOIN school_referral_codes src ON src.training_program_id=tp.id AND src.status='active' WHERE tp.is_active=1 AND tp.source='maryland_mbon_natp' ORDER BY tp.program_name,tp.city,tp.zip;";
const rows=((run(query)[0]||{}).results)||[];
const existing=((run("SELECT organization_key,slug FROM training_organizations;")[0]||{}).results)||[];

const free=new Set(['gmail.com','yahoo.com','hotmail.com','outlook.com','aol.com','icloud.com','comcast.net','verizon.net','msn.com','live.com']);
const clean=v=>String(v||'').trim();
const existingByKey=new Map(existing.map(r=>[clean(r.organization_key),clean(r.slug)]));
const existingSlugKey=new Map(existing.map(r=>[clean(r.slug),clean(r.organization_key)]));
const norm=v=>clean(v).toLowerCase().replace(/[^a-z0-9]+/g,'');
const slugify=v=>clean(v).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/&/g,' and ').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,78)||'training-program';
const emailDomain=e=>{const s=clean(e).toLowerCase();const i=s.lastIndexOf('@');return i>0?s.slice(i+1):''};
const websiteDomain=u=>{try{return new URL(clean(u)).hostname.toLowerCase().replace(/^www\./,'')}catch{return ''}};
const esc=v=>v===null||v===undefined||v===''?'NULL':"'"+String(v).replaceAll("'","''")+"'";
const idFor=k=>'torg_'+crypto.createHash('sha256').update(k).digest('hex').slice(0,24);

function cleanName(row){
  let name=clean(row.program_name).replace(/\s+/g,' ').replace(/,?\s+(?:incorporated|inc\.?|llc|l\.l\.c\.?|corp\.?|corporation)\s*$/i,'').trim();
  const city=clean(row.city);
  if(city){
    const c=city.replace(/[.*+?^$(){}|[\]\\]/g,'\\$&');
    name=name.replace(new RegExp('\\s*[-–—]\\s*'+c+'\\s*$','i'),'').replace(new RegExp('\\s*\\('+c+'\\)\\s*$','i'),'').trim();
  }
  const lower=name.toLowerCase();
  const aliases=[
    ['cambridge nursing assistant academy','Cambridge Nursing Assistant Academy'],
    ['heritage care inc','Heritage Care'],
    ['fomen nursing assistant training academy','Fomen Nursing Assistant Training Academy'],
    ['community college of baltimore county','Community College of Baltimore County'],
    ['the community college of baltimore county','Community College of Baltimore County'],
    ['ccbc ','Community College of Baltimore County']
  ];
  for(const [prefix,canonical] of aliases) if(lower.startsWith(prefix)) return canonical;
  return name;
}

function domainFor(row){
  const d=(clean(row.primary_domain).toLowerCase().replace(/^www\./,'')||websiteDomain(row.website)||emailDomain(row.email));
  return d&&!free.has(d)?d:'';
}

function groupKey(row){
  const provider=clean(row.provider_type);
  const d=domainFor(row);
  if(provider!=='High School'&&d)return 'domain:'+d;
  return 'name:'+norm(cleanName(row))+'|type:'+norm(provider);
}

function credentialFor(row){
  const t=clean(row.program_type).toLowerCase();
  if(t.includes('nursing assistant'))return 'CNA/GNA';
  return 'Direct Care';
}

const groups=new Map();
for(const row of rows){
  const key=groupKey(row);
  if(!groups.has(key))groups.set(key,{key,rows:[]});
  groups.get(key).rows.push(row);
}

const usedSlugs=new Map();
const legacySlugRenames=new Map([
  ['it-works-learning-center-inc','it-works-learning-center'],
  ['care-xpert-academy-llc','care-xpert-academy'],
  ['dominion-academy-inc','dominion-academy']
]);
const statements=["UPDATE training_organizations SET is_active=0,updated_at=CURRENT_TIMESTAMP;"];
for(const g of groups.values()){
  const rs=g.rows;
  const names=rs.map(cleanName).filter(Boolean).sort((a,b)=>a.length-b.length||a.localeCompare(b));
  const canonical=names[0]||clean(rs[0]?.program_name)||'Caregiver Training Program';
  const domain=rs.map(domainFor).find(Boolean)||'';
  const website=rs.map(r=>clean(r.website)).find(Boolean)||'';
  const types=[...new Set(rs.map(r=>clean(r.provider_type)).filter(Boolean))].sort();
  const credentials=[...new Set(rs.map(credentialFor).filter(Boolean))].sort();
  let slug=existingByKey.get(g.key)||slugify(canonical);
  slug=legacySlugRenames.get(slug)||slug;
  const existingOwner=existingSlugKey.get(slug);
  if((existingOwner&&existingOwner!==g.key)||(usedSlugs.has(slug)&&usedSlugs.get(slug)!==g.key)) slug=(slug+'-'+crypto.createHash('sha1').update(g.key).digest('hex').slice(0,6)).slice(0,90);
  usedSlugs.set(slug,g.key);
  const id=idFor(g.key);
  const locations=new Set(rs.map(r=>[clean(r.city).toLowerCase(),clean(r.state).toLowerCase(),clean(r.zip)].join('|')));
  statements.push("INSERT INTO training_organizations (id,organization_key,canonical_name,slug,primary_domain,website,provider_types,credential_categories,location_count,active_program_count,is_active,updated_at) VALUES ("+[esc(id),esc(g.key),esc(canonical),esc(slug),esc(domain),esc(website),esc(types.join(', ')),esc(credentials.join(', ')||'CNA/GNA'),locations.size,rs.length,"1","CURRENT_TIMESTAMP"].join(',')+") ON CONFLICT(organization_key) DO UPDATE SET canonical_name=excluded.canonical_name,slug=excluded.slug,primary_domain=excluded.primary_domain,website=excluded.website,provider_types=excluded.provider_types,credential_categories=excluded.credential_categories,location_count=excluded.location_count,active_program_count=excluded.active_program_count,is_active=1,updated_at=CURRENT_TIMESTAMP;");
  for(const row of rs){
    statements.push("UPDATE training_programs SET organization_id="+esc(id)+",credential_category="+esc(credentialFor(row))+",updated_at=CURRENT_TIMESTAMP WHERE id="+esc(row.id)+";");
  }
}

fs.writeFileSync(OUT,statements.join('\n'));
console.log(JSON.stringify({activePrograms:rows.length,organizations:groups.size,output:OUT}));
