// Pulls Google business listings for home care categories in one or more states through the DataForSEO
// Business Listings API, and writes a D1 upsert for the `agencies` table.
//
//   DATAFORSEO_LOGIN=… DATAFORSEO_PASSWORD=… node scripts/import-dataforseo-agencies.mjs \
//     --states VA --output /tmp/google-agencies.sql --raw /tmp/google-agencies.json --max-cost 10
//
// --estimate only runs the one-result probes (about a cent each) and prints how many listings a full pull returns.
// The pull stops before any request that would take total spend past --max-cost (USD, default 10).
import fs from 'node:fs';
import { GOOGLE_CATEGORIES, STATES, agencyUpsertSql, googleRecord, parseStates, sql } from './lib/agency-sources.mjs';

const argv=process.argv.slice(2);
const args=Object.fromEntries(argv.map((v,i,a)=>v.startsWith('--')?[v.slice(2),a[i+1]&&!a[i+1].startsWith('--')?a[i+1]:'true']:null).filter(Boolean));
const estimateOnly=args.estimate==='true';
if(!args.states||(!estimateOnly&&!args.output)){
  console.error('Usage: node scripts/import-dataforseo-agencies.mjs --states VA[,DC] (--estimate | --output out.sql [--raw out.json]) [--max-cost 10] [--categories a,b]');
  process.exit(1);
}
const login=process.env.DATAFORSEO_LOGIN,password=process.env.DATAFORSEO_PASSWORD;
if(!login||!password){console.error('DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD must be set');process.exit(1)}

const states=parseStates(args.states);
const categories=(args.categories?args.categories.split(','):Object.keys(GOOGLE_CATEGORIES)).map(c=>c.trim()).filter(Boolean);
const maxCost=Number(args['max-cost']||10);
const PAGE=1000;
const ENDPOINT='https://api.dataforseo.com/v3/business_data/business_listings/search/live';
const auth='Basic '+Buffer.from(login+':'+password).toString('base64');
let spent=0;

async function search(task){
  for(let attempt=1;;attempt++){
    const res=await fetch(ENDPOINT,{method:'POST',headers:{authorization:auth,'content-type':'application/json'},body:JSON.stringify([task])});
    const body=await res.json().catch(()=>null);
    if(body&&Number.isFinite(Number(body.cost)))spent+=Number(body.cost);
    const t=body?.tasks?.[0];
    if(res.ok&&body?.status_code===20000&&t?.status_code===20000)return t.result?.[0]||{total_count:0,items:[]};
    const message=t?.status_message||body?.status_message||('HTTP '+res.status);
    // 40xxx are request errors (bad category, bad filter); retrying won't help.
    if(String(t?.status_code||body?.status_code).startsWith('40')||attempt>=4)throw new Error(message);
    await new Promise(r=>setTimeout(r,2000*2**(attempt-1)));
  }
}

/** Finds which spelling of the state DataForSEO stores in address_info.region, and how many listings match. */
async function probe(state,category){
  let best={filterValue:'',total:0,unitCost:0};
  for(const value of [STATES[state],state]){
    const before=spent;
    let result;
    try{result=await search({categories:[category],filters:[['address_info.region','=',value]],limit:1})}
    catch(e){console.warn(`  probe ${category} region=${value}: ${e.message}`);continue}
    const total=Number(result.total_count||0);
    if(total>best.total)best={filterValue:value,total,unitCost:spent-before};
  }
  return best;
}

const plan=[];
for(const state of states){
  for(const category of categories){
    const p=await probe(state,category);
    console.log(`${state} ${category}: ${p.total} listings`+(p.filterValue?` (region="${p.filterValue}")`:''));
    if(p.total>0)plan.push({state,category,...p});
  }
}
const totalListings=plan.reduce((n,p)=>n+p.total,0);
console.log(JSON.stringify({states,categories,listings:totalListings,requests:plan.reduce((n,p)=>n+Math.ceil(p.total/PAGE),0),probeSpendUsd:+spent.toFixed(4)}));
if(estimateOnly)process.exit(0);

const raw=[],records=new Map();
let stoppedEarly=false,lastPageCost=0;
outer:for(const p of plan){
  let offset=0,offsetToken='';
  while(offset<p.total){
    if(spent+lastPageCost>maxCost){stoppedEarly=true;console.warn(`Stopping: next page would pass --max-cost $${maxCost} (spent $${spent.toFixed(2)})`);break outer}
    const before=spent;
    const task={categories:[p.category],filters:[['address_info.region','=',p.filterValue]],limit:PAGE};
    if(offsetToken)task.offset_token=offsetToken;else task.offset=offset;
    const result=await search(task);
    lastPageCost=spent-before;
    const items=result.items||[];
    for(const item of items){
      raw.push({state:p.state,category:p.category,item});
      const r=googleRecord(item,p.state,p.category);
      if(r&&!records.has(r.id))records.set(r.id,r);
    }
    console.log(`  ${p.state} ${p.category}: ${offset+items.length}/${p.total} ($${spent.toFixed(2)} spent)`);
    if(!items.length)break;
    offset+=items.length;
    offsetToken=clean(result.offset_token);
  }
}
function clean(v){return String(v??'').trim()}

if(args.raw)fs.writeFileSync(args.raw,JSON.stringify(raw));
if(!records.size)throw new Error('No listings returned; nothing to import');
const statements=['PRAGMA foreign_keys = ON;'];
// A partial pull must not retire listings it never got to.
if(!stoppedEarly)statements.push(`UPDATE agencies SET is_active=0,updated_at=CURRENT_TIMESTAMP WHERE source='google_business' AND state IN (${states.map(sql).join(',')});`);
for(const r of records.values())statements.push(agencyUpsertSql(r));
fs.writeFileSync(args.output,statements.join('\n'));
const withWebsite=[...records.values()].filter(r=>r.website).length;
const eligible=[...records.values()].filter(r=>r.eligible).length;
console.log(JSON.stringify({listingsReturned:raw.length,agencies:records.size,withWebsite,caregiverMatchEligible:eligible,stoppedEarly,spentUsd:+spent.toFixed(4),output:args.output}));
