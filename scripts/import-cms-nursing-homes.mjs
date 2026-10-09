// Builds a D1 upsert of nursing homes from CMS Care Compare's "Provider Information" dataset (free, national,
// one row per certified facility with its CCN and bed count), read through the CMS datastore API.
//
//   node scripts/import-cms-nursing-homes.mjs --states MD,VA --output /tmp/cms-nursing-homes.sql
//
// Nursing homes are facilities (provider_kind='facility'): they feed caregiver job search, never agency outreach.
import fs from 'node:fs';
import { CMS_NURSING_HOME_DATASET, agencyUpsertSql, cmsNursingHomeRecord, parseStates, sql } from './lib/agency-sources.mjs';

const args=Object.fromEntries(process.argv.slice(2).map((v,i,a)=>v.startsWith('--')?[v.slice(2),a[i+1]]:null).filter(Boolean));
if(!args.output||!args.states){
  console.error('Usage: node scripts/import-cms-nursing-homes.mjs --states MD[,VA] --output out.sql');
  process.exit(1);
}
const states=parseStates(args.states);
const PAGE=500;
const API='https://data.cms.gov/provider-data/api/1/datastore/query/'+CMS_NURSING_HOME_DATASET+'/0';

async function page(state,offset){
  const url=new URL(API);
  url.searchParams.set('limit',String(PAGE));
  url.searchParams.set('offset',String(offset));
  url.searchParams.set('conditions[0][property]','state');
  url.searchParams.set('conditions[0][value]',state);
  url.searchParams.set('conditions[0][operator]','=');
  for(let attempt=1;;attempt++){
    const res=await fetch(url,{headers:{accept:'application/json','user-agent':'CareJoys/1.0 (+https://carejoys.com)'}});
    if(res.ok)return (await res.json()).results||[];
    if(attempt>=4)throw new Error('CMS datastore '+res.status+' for '+state+' offset '+offset);
    await new Promise(r=>setTimeout(r,attempt*2000));
  }
}

const records=new Map(),byState={};
for(const state of states){
  for(let offset=0;;offset+=PAGE){
    const rows=await page(state,offset);
    for(const row of rows){
      const r=cmsNursingHomeRecord(row,states);
      if(r){records.set(r.id,r);byState[r.state]=(byState[r.state]||0)+1}
    }
    if(rows.length<PAGE)break;
  }
}
if(!records.size)throw new Error('No CMS nursing homes found for '+states.join(',')+'; refusing to write an import that would deactivate every existing row');

const statements=['PRAGMA foreign_keys = ON;'];
// Facilities for these states that left the dataset drop out; other states are untouched.
statements.push(`UPDATE agencies SET is_active=0,updated_at=CURRENT_TIMESTAMP WHERE source='cms_nursing_home' AND state IN (${states.map(sql).join(',')});`);
for(const r of records.values())statements.push(agencyUpsertSql(r));
fs.writeFileSync(args.output,statements.join('\n'));
console.log(JSON.stringify({states,nursingHomes:records.size,byState,output:args.output}));
