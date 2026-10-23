// Careers pages the scanner could not find. For agencies whose site had no job board, or would not load, one Google
// search through DataForSEO ("<agency> <city> <state> careers jobs") often turns up the agency's job board on an ATS
// (CareerPlug, Paylocity, iCIMS and the like), which loads even when the agency's own site blocks the Worker. A
// result found becomes the agency's careers URL and the agency is scanned again within the hour.
//
// Paid: DataForSEO reports each search's cost, and the hourly run stops for the day at CAREERS_LOOKUP_DAILY_USD
// (0 or unset turns it off). Each agency is searched once. Agencies in the priority cities go first.
import { agencyCareersResult } from './jobDiscovery';
import { sourcingRankSql } from './sourcingPriorities';

type Row=Record<string,unknown>;
type Statement={bind(...values:unknown[]):Statement;run():Promise<unknown>;first<T=Row>():Promise<T|null>;all<T=Row>():Promise<{results?:T[]}>};
type DB={prepare(query:string):Statement};
export type CareersLookupEnv={DB?:DB;DATAFORSEO_LOGIN?:string;DATAFORSEO_PASSWORD?:string;CAREERS_LOOKUP_DAILY_USD?:string};

const clean=(v:unknown,max=500)=>typeof v==='string'?v.trim().slice(0,max):'';
const ENDPOINT='https://api.dataforseo.com/v3/serp/google/organic/live/regular';
const PER_RUN=20;
// Google listings that are a store, pharmacy or hospital rather than a caregiver employer with its own job board.
const NOT_AN_AGENCY=/\b(walmart|kroger|king soopers|fred meyer|qfc|cvs|walgreens|rite aid|pharmacy|hospital|va medical|veterans affairs)\b/i;

export function careersQuery(org:Row){
  return [clean(org.canonical_name,160),clean(org.city,80),clean(org.state,20),'careers jobs'].filter(Boolean).join(' ');
}
/** The first organic result that is the agency's own careers page or its job board. */
export function careersUrlFromResults(items:Row[],org:Row){
  for(const item of items){
    if(clean(item.type,20)!=='organic')continue;
    const url=clean(item.url,1000);
    if(url&&agencyCareersResult(url,clean(item.title,300),org))return url;
  }
  return '';
}

export async function lookupCareersPagesBatch(env:CareersLookupEnv,limit=PER_RUN){
  const cap=Number(env.CAREERS_LOOKUP_DAILY_USD||0);
  if(!env.DB||!(cap>0)||!clean(env.DATAFORSEO_LOGIN)||!clean(env.DATAFORSEO_PASSWORD))return {searched:0,found:0,spent:0};
  const today=await env.DB.prepare("SELECT COALESCE(SUM(cost),0) AS spent FROM careers_lookups WHERE looked_up_at>=date('now')").first<{spent:number}>();
  let spent=Number(today?.spent||0);
  if(spent>=cap)return {searched:0,found:0,spent};
  const orgs=(await env.DB.prepare(`SELECT ao.id,ao.canonical_name,ao.city,ao.state,ao.primary_website,ao.primary_domain
    FROM agency_job_scan_state scan JOIN agency_organizations ao ON ao.id=scan.organization_id
    LEFT JOIN careers_lookups cl ON cl.organization_id=ao.id
    WHERE scan.last_status IN ('no_job_board_found','fetch_failed') AND cl.organization_id IS NULL
      AND ao.is_active=1 AND COALESCE(ao.is_test,0)=0 AND COALESCE(ao.primary_careers_url,'')=''
    ORDER BY ${sourcingRankSql('ao.state','ao.city')},ao.id LIMIT ?`).bind(limit).all<Row>()).results||[];
  const auth='Basic '+btoa(clean(env.DATAFORSEO_LOGIN,320)+':'+clean(env.DATAFORSEO_PASSWORD,320));
  let searched=0,found=0;
  for(const org of orgs){
    if(spent>=cap)break;
    const id=clean(org.id,100),query=careersQuery(org);
    if(NOT_AN_AGENCY.test(clean(org.canonical_name,220))){
      await env.DB.prepare("INSERT OR REPLACE INTO careers_lookups(organization_id,status,query,cost) VALUES (?,'skipped',?,0)").bind(id,query).run();
      continue;
    }
    const res=await fetch(ENDPOINT,{method:'POST',headers:{authorization:auth,'content-type':'application/json'},
      body:JSON.stringify([{keyword:query,location_code:2840,language_code:'en',depth:10}])}).catch(()=>null);
    const body=await res?.json().catch(()=>null) as any;
    const task=body?.tasks?.[0];
    const cost=Number(task?.cost??body?.cost)||0;
    spent+=cost;
    if(!res?.ok||task?.status_code!==20000){
      // Credentials or balance: stop for this run, and leave the agency to be searched again.
      console.error('careers lookup failed',task?.status_message||body?.status_message||res?.status);
      break;
    }
    searched++;
    const url=careersUrlFromResults(task.result?.[0]?.items||[],org);
    await env.DB.prepare('INSERT OR REPLACE INTO careers_lookups(organization_id,status,query,found_url,cost) VALUES (?,?,?,?,?)')
      .bind(id,url?'found':'not_found',query,url||null,cost).run();
    if(!url)continue;
    found++;
    await env.DB.prepare('UPDATE agency_organizations SET primary_careers_url=?,careers_source="serp_lookup",updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(url,id).run();
    // With no scan on record, the hourly scan takes it with the never-scanned sites, which go first.
    await env.DB.prepare('DELETE FROM agency_job_scan_state WHERE organization_id=?').bind(id).run();
  }
  return {searched,found,spent};
}
