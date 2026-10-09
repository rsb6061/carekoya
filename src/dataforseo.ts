// Google business listings for home care agencies and care facilities, pulled from the DataForSEO Business Listings API inside the
// Worker (DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD live in the Worker's Cloudflare settings).
//
// A pull is a row in `dataforseo_import_jobs`, queued by the "DataForSEO Agency Import" GitHub workflow. The
// five-minute cron advances the oldest open job a few pages at a time so each run stays well inside Worker limits:
//   1. probes every state × category with a one-result request (≈ a cent each) to learn totals → "estimated"
//      for estimate jobs, otherwise
//   2. pages through the listings, upserting `agencies` rows as source 'google_business', and
//   3. retires that state's Google rows this pull didn't see, then marks the job "done".
// Spend is tracked from DataForSEO's own reported cost; a job stops ("stopped") before passing max_cost.
import { US_STATES, usState } from './usStates';

type Row=Record<string,unknown>;
type Statement={bind(...values:unknown[]):Statement;run():Promise<unknown>;first<T=Row>():Promise<T|null>};
type DB={prepare(query:string):Statement;batch?(statements:Statement[]):Promise<unknown>};
export type DataForSeoEnv={DB?:DB;DATAFORSEO_LOGIN?:string;DATAFORSEO_PASSWORD?:string};

const clean=(v:unknown,max=500)=>typeof v==='string'?v.trim().slice(0,max):typeof v==='number'?String(v):'';
const ENDPOINT='https://api.dataforseo.com/v3/business_data/business_listings/search/live';
const PAGE=1000;
const PAGES_PER_RUN=3;
const MAX_ATTEMPTS=3;

/** Google categories pulled, with how directly each kind of business employs caregivers. */
export const GOOGLE_CATEGORIES:Record<string,{label:string;score:number;kind:'home_care'|'facility'}>={
  home_help_service_agency:{label:'Home help service agency',score:85,kind:'home_care'},
  home_health_care_service:{label:'Home health care service',score:80,kind:'home_care'},
  senior_citizens_care_service:{label:'Senior citizens care service',score:75,kind:'home_care'},
  nursing_agency:{label:'Nursing agency',score:65,kind:'home_care'},
  assisted_living_facility:{label:'Assisted living facility',score:90,kind:'facility'},
  nursing_home:{label:'Nursing home',score:85,kind:'facility'},
  retirement_home:{label:'Retirement home',score:60,kind:'facility'}
};
/** What a job with no categories pulls: home care only, so facilities are always an explicit choice. */
export const DEFAULT_CATEGORIES=Object.keys(GOOGLE_CATEGORIES).filter(c=>GOOGLE_CATEGORIES[c].kind==='home_care');
// Google's own category for a listing wins over the one it was searched under: a community that turns up under
// "Home health care service" is still a facility.
const FACILITY_CATEGORY=/\b(assisted living|aged care|retirement (community|home)|nursing home|memory care|senior living|skilled nursing)\b/i;
const NOT_AN_EMPLOYER=/\b(hospital|pharmacy|medical supply|medical equipment|dme|oxygen|clinic|urgent care|insurance|school|academy|training center|institute)\b/i;

type PlanEntry={state:string;category:string;filterValue:string;total:number;fetched:number;offsetToken:string;done:boolean};
export type GoogleAgency={
  id:string;sourceKey:string;placeId:string;cid:string;category:string;name:string;address1:string;city:string;state:string;zip:string;
  phone:string;website:string;rating:number|null;reviewCount:number|null;latitude:number|null;longitude:number|null;
  score:number;eligible:number;sourceUrl:string;asOf:string|null;kind:'home_care'|'facility';pullCategory:string
};

const num=(v:unknown)=>v===null||v===undefined||v===''?null:Number.isFinite(Number(v))?Number(v):null;
function phoneText(value:unknown){
  const d=clean(value,40).replace(/\D/g,'');
  const p=d.length===11&&d.startsWith('1')?d.slice(1):d;
  return p.length===10?`(${p.slice(0,3)}) ${p.slice(3,6)}-${p.slice(6)}`:clean(value,40);
}
async function agencyId(key:string){
  const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('google_business|'+key)));
  // Same id scheme as scripts/lib/agency-sources.mjs, so a row keeps its id whichever importer wrote it.
  return 'ag_'+Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('').slice(0,24);
}

/** One Business Listings item → an agency row, or null when it is outside the state, closed, or unusable. */
export async function googleAgency(item:any,state:string,categoryId:string):Promise<GoogleAgency|null>{
  const addr=item?.address_info||{};
  const itemState=usState(clean(addr.region,60))?.code||usState(clean(item?.address,300).match(/,\s*([A-Z]{2})\s+\d{5}/)?.[1]||'')?.code||'';
  if(itemState!==state)return null;
  const placeId=clean(item?.place_id,200),cid=clean(item?.cid,60);
  const key=placeId?'place:'+placeId:cid?'cid:'+cid:'';
  const name=clean(item?.title,220);
  if(!key||!name)return null;
  if(item?.is_permanently_closed===true||/closed_forever|permanently_closed/i.test(JSON.stringify(item?.work_time?.work_hours?.current_status||'')))return null;
  const cat=GOOGLE_CATEGORIES[categoryId];
  const category=clean(item?.category,120)||cat?.label||categoryId;
  const noise=NOT_AN_EMPLOYER.test(name+' '+category);
  return {
    id:await agencyId(key),sourceKey:key,placeId,cid,category,name,
    address1:clean(addr.address,240)||clean(item?.address,300).split(',')[0]||'',
    city:clean(addr.city,120),state:itemState,zip:clean(addr.zip,20).match(/^\d{5}/)?.[0]||'',
    phone:phoneText(item?.phone),website:clean(item?.url,1000),
    rating:num(item?.rating?.value),reviewCount:num(item?.rating?.votes_count),
    latitude:num(item?.latitude),longitude:num(item?.longitude),
    score:noise?20:(cat?.score??60),eligible:noise?0:1,
    sourceUrl:clean(item?.check_url,1000)||(cid?'https://maps.google.com/?cid='+cid:''),
    asOf:clean(item?.last_updated_time,40).slice(0,10)||null,
    kind:FACILITY_CATEGORY.test(category)?'facility':(cat?.kind||'home_care'),
    pullCategory:categoryId
  };
}

const UPSERT=`INSERT INTO agencies (
    id,source,source_key,name,license_type,address1,city,state,zip,phone,website,source_url,is_active,last_source_sync_at,updated_at,
    provider_type,organization_key,caregiver_relevance_score,caregiver_match_eligible,source_as_of_date,
    google_place_id,google_cid,google_category,rating,review_count,latitude,longitude,provider_kind,google_pull_category
  ) VALUES (?,'google_business',?,?,NULL,?,?,?,?,?,?,?,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  ON CONFLICT(source,source_key) DO UPDATE SET
    name=excluded.name,address1=excluded.address1,city=excluded.city,state=excluded.state,zip=excluded.zip,phone=excluded.phone,
    website=excluded.website,source_url=excluded.source_url,is_active=1,last_source_sync_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP,
    provider_type=excluded.provider_type,organization_key=excluded.organization_key,caregiver_relevance_score=excluded.caregiver_relevance_score,
    caregiver_match_eligible=excluded.caregiver_match_eligible,source_as_of_date=excluded.source_as_of_date,google_place_id=excluded.google_place_id,
    google_cid=excluded.google_cid,google_category=excluded.google_category,rating=excluded.rating,review_count=excluded.review_count,
    latitude=excluded.latitude,longitude=excluded.longitude,provider_kind=excluded.provider_kind,google_pull_category=excluded.google_pull_category`;

async function saveAgencies(db:DB,rows:GoogleAgency[]){
  const statements=rows.map(r=>db.prepare(UPSERT).bind(
    r.id,r.sourceKey,r.name,r.address1,r.city,r.state,r.zip,r.phone,r.website||null,r.sourceUrl,
    'Google listing: '+r.category,r.name.toLowerCase().replace(/[^a-z0-9]+/g,''),r.score,r.eligible,r.asOf,
    r.placeId||null,r.cid||null,r.category,r.rating,r.reviewCount,r.latitude,r.longitude,r.kind,r.pullCategory));
  if(db.batch){for(let i=0;i<statements.length;i+=100)await db.batch(statements.slice(i,i+100))}
  else for(const s of statements)await s.run();
}

class DataForSeoError extends Error{
  constructor(message:string,readonly code:string){super(message)}
  /** Credentials or balance: nothing about the request can fix it. */
  get account(){return /^(401|402)/.test(this.code)}
  /** Any 4xx/40xxx is a request or account error, so retrying won't help. */
  get permanent(){return this.code.startsWith('4')}
}

async function search(env:DataForSeoEnv,task:Row){
  const auth='Basic '+btoa(clean(env.DATAFORSEO_LOGIN,320)+':'+clean(env.DATAFORSEO_PASSWORD,320));
  const res=await fetch(ENDPOINT,{method:'POST',headers:{authorization:auth,'content-type':'application/json'},body:JSON.stringify([task])});
  const body=await res.json().catch(()=>null) as any;
  const cost=Number(body?.cost)||0;
  const t=body?.tasks?.[0];
  if(res.ok&&body?.status_code===20000&&t?.status_code===20000)return {cost,result:(t.result?.[0]||{total_count:0,items:[]}) as any};
  const code=String(t?.status_code||body?.status_code||res.status);
  throw new DataForSeoError((t?.status_message||body?.status_message||'HTTP '+res.status)+' ('+code+')',res.status===401||res.status===402?String(res.status):code);
}

async function updateJob(db:DB,id:string,fields:Row){
  const keys=Object.keys(fields);
  await db.prepare(`UPDATE dataforseo_import_jobs SET ${keys.map(k=>k+'=?').join(',')},updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .bind(...keys.map(k=>fields[k]),id).run();
}

/** Learns each state × category total (and which spelling of the state the region filter wants). */
async function probe(env:DataForSeoEnv,states:string[],categories:string[]){
  const plan:PlanEntry[]=[];let spent=0;
  for(const state of states){
    const name=US_STATES.find(([code])=>code===state)?.[1]||state;
    for(const category of categories){
      let best={filterValue:'',total:0};
      for(const value of [name,state]){
        try{
          const {cost,result}=await search(env,{categories:[category],filters:[['address_info.region','=',value]],limit:1});
          spent+=cost;
          const total=Number(result.total_count||0);
          if(total>best.total)best={filterValue:value,total};
        }catch(e){
          if(!(e instanceof DataForSeoError)||e.account||!e.permanent)throw e;
          // A category DataForSEO doesn't know is skipped rather than failing the whole pull.
        }
      }
      if(best.total>0)plan.push({state,category,...best,fetched:0,offsetToken:'',done:false});
    }
  }
  return {plan,spent};
}

/** Advances the oldest open DataForSEO job by a few requests. Called from the five-minute cron. */
export async function runDataForSeoJobs(env:DataForSeoEnv){
  if(!env.DB)return {ran:false};
  const job=await env.DB.prepare("SELECT * FROM dataforseo_import_jobs WHERE status IN ('queued','running') ORDER BY created_at LIMIT 1").first<Row>();
  if(!job)return {ran:false};
  const id=clean(job.id,100);
  if(!clean(env.DATAFORSEO_LOGIN)||!clean(env.DATAFORSEO_PASSWORD)){
    await updateJob(env.DB,id,{status:'failed',error:'DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD are not set on the Worker',finished_at:new Date().toISOString()});
    return {ran:true,status:'failed'};
  }
  const states=clean(job.states,400).split(',').map(s=>usState(s)?.code||'').filter(Boolean);
  const categories=(clean(job.categories,800)||DEFAULT_CATEGORIES.join(',')).split(',').map(c=>c.trim()).filter(Boolean);
  const maxCost=Number(job.max_cost)||10;
  let spent=Number(job.spent)||0;
  try{
    if(!job.plan_json){
      const {plan,spent:probeCost}=await probe(env,states,categories);
      spent+=probeCost;
      const listings=plan.reduce((n,p)=>n+p.total,0);
      const estimate=clean(job.mode,20)==='estimate';
      await updateJob(env.DB,id,{plan_json:JSON.stringify(plan),spent,listings,attempts:0,error:null,
        status:estimate||!plan.length?(estimate?'estimated':'done'):'running',finished_at:estimate||!plan.length?new Date().toISOString():null});
      return {ran:true,status:estimate?'estimated':'running'};
    }
    const plan=JSON.parse(clean(job.plan_json,200000)) as PlanEntry[];
    let saved=Number(job.agencies)||0,lastPageCost=Number(job.last_page_cost)||0;
    for(let page=0;page<PAGES_PER_RUN;page++){
      const entry=plan.find(p=>!p.done);
      if(!entry)break;
      if(spent+lastPageCost>maxCost){
        await updateJob(env.DB,id,{status:'stopped',spent,agencies:saved,plan_json:JSON.stringify(plan),error:`Stopped before passing the $${maxCost} cap`,finished_at:new Date().toISOString()});
        return {ran:true,status:'stopped'};
      }
      const task:Row={categories:[entry.category],filters:[['address_info.region','=',entry.filterValue]],limit:PAGE};
      if(entry.offsetToken)task.offset_token=entry.offsetToken;else task.offset=entry.fetched;
      const {cost,result}=await search(env,task);
      spent+=cost;lastPageCost=cost;
      const items:any[]=Array.isArray(result.items)?result.items:[];
      const rows=(await Promise.all(items.map(item=>googleAgency(item,entry.state,entry.category)))).filter(Boolean) as GoogleAgency[];
      await saveAgencies(env.DB,rows);
      saved+=rows.length;
      entry.fetched+=items.length;
      entry.offsetToken=clean(result.offset_token,2000);
      entry.done=!items.length||entry.fetched>=entry.total;
      await updateJob(env.DB,id,{plan_json:JSON.stringify(plan),spent,agencies:saved,last_page_cost:lastPageCost,attempts:0,error:null});
    }
    if(plan.every(p=>p.done)){
      // Google rows in these states and categories that this pull never saw have closed or changed category.
      // Rows saved before categories were recorded count as home care, so a facility-only pull leaves them alone.
      const retire=[...categories,...(categories.some(c=>DEFAULT_CATEGORIES.includes(c))?['legacy_home_care']:[])];
      await env.DB.prepare(`UPDATE agencies SET is_active=0,updated_at=CURRENT_TIMESTAMP WHERE source='google_business' AND state IN (${states.map(()=>'?').join(',')})
        AND COALESCE(google_pull_category,'legacy_home_care') IN (${retire.map(()=>'?').join(',')})
        AND (last_source_sync_at IS NULL OR datetime(last_source_sync_at)<datetime(?))`).bind(...states,...retire,clean(job.created_at,40)).run();
      await updateJob(env.DB,id,{status:'done',finished_at:new Date().toISOString()});
      return {ran:true,status:'done'};
    }
    return {ran:true,status:'running'};
  }catch(e){
    const attempts=(Number(job.attempts)||0)+1;
    const permanent=e instanceof DataForSeoError&&e.permanent;
    const failed=permanent||attempts>=MAX_ATTEMPTS;
    await updateJob(env.DB,id,{attempts,spent,error:String((e as Error)?.message||e).slice(0,500),
      status:failed?'failed':clean(job.status,20),finished_at:failed?new Date().toISOString():null});
    return {ran:true,status:failed?'failed':'retrying'};
  }
}
