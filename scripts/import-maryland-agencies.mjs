import fs from 'node:fs';
import crypto from 'node:crypto';
import XLSX from 'xlsx';

const args = Object.fromEntries(process.argv.slice(2).map((v,i,a)=>v.startsWith('--')?[v.slice(2),a[i+1]]:null).filter(Boolean));
const outputPath=args.output;
const inputs=[
  {type:'hcsa',path:args.hcsa,source:'maryland_ohcq_hcsa',providerType:'Health Care Staff Agency',sourceUrl:'https://health.maryland.gov/ohcq/docs/Provider-Listings/Excel/Health-Care-Staff-Agencies-EXCEL.xlsx'},
  {type:'hha',path:args.hha,source:'maryland_ohcq_hha',providerType:'Home Health Agency',sourceUrl:'https://health.maryland.gov/ohcq/docs/Provider-Listings/Excel/Home-Health-Agencies-EXCEL.xlsx'},
  {type:'rsa',path:args.rsa,source:'maryland_ohcq_rsa',providerType:'Residential Service Agency',sourceUrl:'https://health.maryland.gov/ohcq/docs/Provider-Listings/Excel/Residential-Service-Agencies-EXCEL.xlsx'}
];
if(!outputPath||inputs.some(x=>!x.path)){
  console.error('Usage: node scripts/import-maryland-agencies.mjs --hcsa file.xlsx --hha file.xlsx --rsa file.xlsx --output out.sql');
  process.exit(1);
}

const clean=v=>String(v??'').trim();
const normalize=v=>clean(v).toLowerCase().replace(/[^a-z0-9]+/g,'');
const sql=v=>v===null||v===undefined||v===''?'NULL':"'"+String(v).replaceAll("'","''")+"'";
const idFor=(source,key)=>'ag_'+crypto.createHash('sha256').update(source+'|'+key).digest('hex').slice(0,24);

function asOfDate(sheetName){
  const m=String(sheetName).match(/as of\s+(\d{2})-(\d{2})-(\d{2})/i);
  if(!m)return null;
  return '20'+m[3]+'-'+m[1]+'-'+m[2];
}
function classify(type,services){
  const s=clean(services).toLowerCase();
  if(type==='hha')return {score:90,eligible:1};
  if(type==='hcsa')return {score:70,eligible:1};
  if(s.includes('home health aide'))return {score:100,eligible:1};
  if(s.includes('nursing'))return {score:55,eligible:1};
  return {score:10,eligible:0};
}
function rowsFor(input){
  const wb=XLSX.readFile(input.path,{cellDates:false});
  const sheetName=wb.SheetNames[0];
  if(!sheetName)throw new Error(input.type+': workbook has no sheet');
  const rows=XLSX.utils.sheet_to_json(wb.Sheets[sheetName],{defval:'',raw:false});
  if(!rows.length)throw new Error(input.type+': workbook has no rows');
  const required=['Jurisdiction','Licensee','Street Address','City','State','Zip Code','Name of Contact Person','Business Phone Number','Business Email','License Number'];
  for(const key of required)if(!(key in rows[0]))throw new Error(input.type+': missing expected column '+key);
  const date=asOfDate(sheetName);
  return rows.map(row=>{
    const license=clean(row['License Number']);
    const name=clean(row['Licensee']);
    if(!name||!license)return null;
    const services=input.type==='rsa'?clean(row['Home Health Care Services']):'';
    const legalName=input.type==='hha'?clean(row['Legal Name']):'';
    const relevance=classify(input.type,services);
    const sourceKey='license:'+normalize(license);
    return {
      id:idFor(input.source,sourceKey),
      source:input.source,sourceKey,
      name,legalName,license,
      jurisdiction:clean(row['Jurisdiction']),
      address1:clean(row['Street Address']),
      city:clean(row['City']),state:clean(row['State'])||'MD',zip:clean(row['Zip Code']),
      contactName:clean(row['Name of Contact Person']),
      phone:clean(row['Business Phone Number']),email:clean(row['Business Email']).toLowerCase(),
      services,
      providerType:input.providerType,
      organizationKey:normalize(name),
      score:relevance.score,eligible:relevance.eligible,
      sourceUrl:input.sourceUrl,sourceAsOfDate:date
    };
  }).filter(Boolean);
}

const groups=inputs.map(input=>({input,records:rowsFor(input)}));
for(const {input,records} of groups){
  const emails=records.filter(r=>r.email).length;
  const eligible=records.filter(r=>r.eligible).length;
  console.log(input.type.toUpperCase(), 'rows=',records.length,'emails=',emails,'caregiver_match_eligible=',eligible);
}

const statements=['PRAGMA foreign_keys = ON;','BEGIN TRANSACTION;'];
for(const {input} of groups){
  statements.push(`UPDATE agencies SET is_active=0,updated_at=CURRENT_TIMESTAMP WHERE source=${sql(input.source)};`);
}
for(const {records} of groups){
  for(const r of records){
    statements.push(`INSERT INTO agencies (
      id,source,source_key,name,legal_name,license_number,license_type,license_status,
      address1,city,state,zip,phone,email,services,source_url,is_active,last_source_sync_at,updated_at,
      jurisdiction,contact_name,provider_type,organization_key,caregiver_relevance_score,caregiver_match_eligible,source_as_of_date
    ) VALUES (
      ${sql(r.id)},${sql(r.source)},${sql(r.sourceKey)},${sql(r.name)},${sql(r.legalName)},${sql(r.license)},${sql(r.providerType)},NULL,
      ${sql(r.address1)},${sql(r.city)},${sql(r.state)},${sql(r.zip)},${sql(r.phone)},${sql(r.email)},${sql(r.services)},${sql(r.sourceUrl)},1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,
      ${sql(r.jurisdiction)},${sql(r.contactName)},${sql(r.providerType)},${sql(r.organizationKey)},${r.score},${r.eligible},${sql(r.sourceAsOfDate)}
    )
    ON CONFLICT(source,source_key) DO UPDATE SET
      name=excluded.name,legal_name=excluded.legal_name,license_number=excluded.license_number,license_type=excluded.license_type,
      address1=excluded.address1,city=excluded.city,state=excluded.state,zip=excluded.zip,phone=excluded.phone,email=excluded.email,
      services=excluded.services,source_url=excluded.source_url,is_active=1,last_source_sync_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP,
      jurisdiction=excluded.jurisdiction,contact_name=excluded.contact_name,provider_type=excluded.provider_type,
      organization_key=excluded.organization_key,caregiver_relevance_score=excluded.caregiver_relevance_score,
      caregiver_match_eligible=excluded.caregiver_match_eligible,source_as_of_date=excluded.source_as_of_date;`);
  }
}
statements.push('COMMIT;');
fs.writeFileSync(outputPath,statements.join('\n'));
console.log('TOTAL rows=',groups.reduce((n,g)=>n+g.records.length,0));
console.log('SQL written=',outputPath);
