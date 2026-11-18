// Tells search engines when a job page goes live or comes down, so jobs reach Google Jobs in days instead of waiting
// for Google to find them through the sitemap (as of 2026-11-18 most job pages were "Discovered - currently not indexed").
//
// - Google: the Indexing API, which Google offers for pages with JobPosting markup (every /jobs/{id} page has it,
//   see jobPostingJsonLd in src/seo.ts). Needs GOOGLE_INDEXING_KEY, a service account's JSON key kept in Cloudflare
//   Worker settings, with that service account added as an Owner of carejoys.com in Search Console. Free; Google's
//   default quota is 200 notices a day, so the daily cap stays under it.
// - IndexNow (Bing, Yandex and others): no account. The key below is public by design and is served at /{key}.txt.
//
// Only states in SEARCH_PING_STATES (Maryland first, Rebecca's focus since 2026-11-13). Each job is announced once when
// it goes live and once when it comes down; failures are retried on the next run.

type Row=Record<string,unknown>;
type Statement={
  bind(...values:unknown[]):Statement;
  run():Promise<unknown>;
  all<T=Row>():Promise<{results?:T[]}>;
  first<T=Row>():Promise<T|null>;
};
type D1Database={prepare(query:string):Statement};
export type SearchPingEnv={
  DB?:D1Database;
  GOOGLE_INDEXING_KEY?:string;
  GOOGLE_INDEXING_DAILY_CAP?:string;
  INDEXNOW_KEY?:string;
  SEARCH_PING_STATES?:string;
};
export type Engine='google'|'indexnow';
export type PingAction='updated'|'deleted';

const ORIGIN='https://carejoys.com';
const HOST='carejoys.com';
const GOOGLE_SCOPE='https://www.googleapis.com/auth/indexing';
const GOOGLE_TOKEN_URL='https://oauth2.googleapis.com/token';
const GOOGLE_PUBLISH_URL='https://indexing.googleapis.com/v3/urlNotifications:publish';
const INDEXNOW_URL='https://api.indexnow.org/indexnow';
const DEFAULT_GOOGLE_CAP=180;
const INDEXNOW_BATCH=1000;

export const jobUrl=(id:string)=>ORIGIN+'/jobs/'+encodeURIComponent(id);

/** "MD, va" -> ["MD","VA"]. Blank means no state, so nothing is sent. */
export function pingStates(value:unknown):string[]{
  return [...new Set(String(value??'').split(',').map(s=>s.trim().toUpperCase()).filter(s=>/^[A-Z]{2}$/.test(s)))];
}

/** IndexNow keys are 8 to 128 letters, digits or dashes. */
export function validIndexNowKey(value:unknown):string{
  const key=String(value??'').trim();
  return /^[A-Za-z0-9-]{8,128}$/.test(key)?key:'';
}

export function googleDailyCap(value:unknown):number{
  const n=Math.floor(Number(value));
  return Number.isFinite(n)&&n>=0?Math.min(n,200):DEFAULT_GOOGLE_CAP;
}

const b64url=(bytes:Uint8Array)=>{
  let s='';for(const b of bytes)s+=String.fromCharCode(b);
  return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
};
const b64urlText=(text:string)=>b64url(new TextEncoder().encode(text));

type ServiceAccount={client_email:string;private_key:string};
export function parseServiceAccount(raw:unknown):ServiceAccount|null{
  try{
    const json=JSON.parse(String(raw??''));
    const email=typeof json?.client_email==='string'?json.client_email.trim():'';
    const key=typeof json?.private_key==='string'?json.private_key:'';
    return email&&key.includes('PRIVATE KEY')?{client_email:email,private_key:key}:null;
  }catch{return null}
}

function pemToBytes(pem:string){
  const body=pem.replace(/-----[^-]+-----/g,'').replace(/\\n/g,'').replace(/\s+/g,'');
  const bin=atob(body);
  const out=new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i);
  return out;
}

/** A signed JWT asking Google for an Indexing API token (service account flow). */
export async function serviceAccountJwt(account:ServiceAccount,nowSeconds=Math.floor(Date.now()/1000)){
  const header=b64urlText(JSON.stringify({alg:'RS256',typ:'JWT'}));
  const claims=b64urlText(JSON.stringify({iss:account.client_email,scope:GOOGLE_SCOPE,aud:GOOGLE_TOKEN_URL,iat:nowSeconds,exp:nowSeconds+3600}));
  const key=await crypto.subtle.importKey('pkcs8',pemToBytes(account.private_key),{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
  const signature=new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,new TextEncoder().encode(header+'.'+claims)));
  return header+'.'+claims+'.'+b64url(signature);
}

async function googleToken(account:ServiceAccount,fetcher:typeof fetch){
  const assertion=await serviceAccountJwt(account);
  const res=await fetcher(GOOGLE_TOKEN_URL,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion}).toString()});
  const json=await res.json().catch(()=>null) as Row|null;
  const token=typeof json?.access_token==='string'?json.access_token:'';
  if(!res.ok||!token)throw new Error('google token '+res.status+' '+String(json?.error_description||json?.error||'').slice(0,200));
  return token;
}

/** Jobs to announce as live: published, current, in the chosen states, not yet announced to this engine. */
export async function jobsToAnnounce(db:D1Database,engine:Engine,states:string[],limit:number){
  if(!states.length||limit<=0)return [] as string[];
  const marks=states.map(()=>'?').join(',');
  const rows=await db.prepare(`SELECT j.id FROM caregiver_jobs j
    WHERE j.is_published=1 AND j.status='current' AND j.state IN (${marks})
      AND NOT EXISTS (SELECT 1 FROM search_engine_pings p WHERE p.job_id=j.id AND p.engine=? AND p.action='updated' AND p.status='ok')
    ORDER BY j.first_seen_at DESC LIMIT ?`).bind(...states,engine,limit).all<{id:string}>();
  return (rows.results||[]).map(r=>r.id).filter(Boolean);
}

/** Jobs announced as live to this engine that have since come down, and whose removal has not been announced. */
export async function jobsToWithdraw(db:D1Database,engine:Engine,limit:number){
  if(limit<=0)return [] as string[];
  const rows=await db.prepare(`SELECT p.job_id AS id FROM search_engine_pings p
    LEFT JOIN caregiver_jobs j ON j.id=p.job_id
    WHERE p.engine=? AND p.action='updated' AND p.status='ok'
      AND (j.id IS NULL OR j.is_published<>1 OR j.status<>'current')
      AND NOT EXISTS (SELECT 1 FROM search_engine_pings d WHERE d.job_id=p.job_id AND d.engine=p.engine AND d.action='deleted' AND d.status='ok')
    LIMIT ?`).bind(engine,limit).all<{id:string}>();
  return (rows.results||[]).map(r=>r.id).filter(Boolean);
}

async function record(db:D1Database,jobId:string,engine:Engine,action:PingAction,status:string,error=''){
  await db.prepare(`INSERT INTO search_engine_pings(job_id,engine,action,status,error,pinged_at) VALUES (?,?,?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(job_id,engine,action) DO UPDATE SET status=excluded.status,error=excluded.error,pinged_at=excluded.pinged_at`)
    .bind(jobId,engine,action,status,error.slice(0,300)||null).run();
}

export type PingResult={sent:number;failed:number;stopped?:string};

/** Google Indexing API: removals first (they share the daily quota), then new jobs. Stops at the first quota or permission error. */
export async function pingGoogle(env:SearchPingEnv,fetcher:typeof fetch=fetch):Promise<PingResult>{
  const result:PingResult={sent:0,failed:0};
  const db=env.DB;const account=parseServiceAccount(env.GOOGLE_INDEXING_KEY);
  const states=pingStates(env.SEARCH_PING_STATES);
  if(!db||!account||!states.length)return result;
  const cap=googleDailyCap(env.GOOGLE_INDEXING_DAILY_CAP);
  const today=await db.prepare(`SELECT COUNT(*) AS n FROM search_engine_pings WHERE engine='google' AND date(pinged_at)=date('now')`).first<{n:number}>();
  let left=cap-Number(today?.n||0);
  if(left<=0)return result;
  const withdraw=await jobsToWithdraw(db,'google',left);
  const announce=await jobsToAnnounce(db,'google',states,left-withdraw.length);
  if(!withdraw.length&&!announce.length)return result;
  let token:string;
  try{token=await googleToken(account,fetcher)}catch(error){return {...result,stopped:String((error as Error)?.message||error).slice(0,200)}}
  const work:[string,PingAction][]=[...withdraw.map((id:string)=>[id,'deleted'] as [string,PingAction]),...announce.map((id:string)=>[id,'updated'] as [string,PingAction])];
  for(const [id,action] of work){
    if(left<=0)break;
    const res=await fetcher(GOOGLE_PUBLISH_URL,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},
      body:JSON.stringify({url:jobUrl(id),type:action==='deleted'?'URL_DELETED':'URL_UPDATED'})}).catch(()=>null);
    left--;
    if(res?.ok){await record(db,id,'google',action,'ok');result.sent++;continue}
    const text=res?await res.text().catch(()=>''):'network error';
    await record(db,id,'google',action,'error',(res?.status||0)+' '+text);
    result.failed++;
    // Quota used up, or the service account is not an Owner in Search Console: every further call would fail the same way.
    if(!res||res.status===429||res.status===403||res.status===401){result.stopped=(res?.status||0)+' '+text.slice(0,200);break}
  }
  return result;
}

/** IndexNow: one request for up to 1,000 pages, removals and new jobs together (IndexNow takes both as plain URLs). */
export async function pingIndexNow(env:SearchPingEnv,fetcher:typeof fetch=fetch):Promise<PingResult>{
  const result:PingResult={sent:0,failed:0};
  const db=env.DB;const key=validIndexNowKey(env.INDEXNOW_KEY);
  const states=pingStates(env.SEARCH_PING_STATES);
  if(!db||!key||!states.length)return result;
  const withdraw=await jobsToWithdraw(db,'indexnow',INDEXNOW_BATCH);
  const announce=await jobsToAnnounce(db,'indexnow',states,INDEXNOW_BATCH-withdraw.length);
  const work:[string,PingAction][]=[...withdraw.map((id:string)=>[id,'deleted'] as [string,PingAction]),...announce.map((id:string)=>[id,'updated'] as [string,PingAction])];
  if(!work.length)return result;
  const res=await fetcher(INDEXNOW_URL,{method:'POST',headers:{'content-type':'application/json; charset=utf-8'},
    body:JSON.stringify({host:HOST,key,keyLocation:ORIGIN+'/'+key+'.txt',urlList:work.map(([id])=>jobUrl(id))})}).catch(()=>null);
  // 200 and 202 both mean received.
  const ok=!!res&&(res.status===200||res.status===202);
  const error=ok?'':(res?.status||0)+' '+(res?await res.text().catch(()=>''):'network error');
  for(const [id,action] of work)await record(db,id,'indexnow',action,ok?'ok':'error',error);
  if(ok)result.sent=work.length;else{result.failed=work.length;result.stopped=error.slice(0,200)}
  return result;
}

/** The IndexNow key file, which proves to search engines that the key belongs to carejoys.com. */
export function indexNowKeyResponse(env:SearchPingEnv,pathname:string):Response|null{
  const key=validIndexNowKey(env.INDEXNOW_KEY);
  if(!key||pathname!=='/'+key+'.txt')return null;
  return new Response(key,{headers:{'content-type':'text/plain; charset=utf-8','cache-control':'public, max-age=3600'}});
}

export async function runSearchPings(env:SearchPingEnv,fetcher:typeof fetch=fetch){
  const google=await pingGoogle(env,fetcher).catch(error=>({sent:0,failed:0,stopped:String(error)}) as PingResult);
  const indexnow=await pingIndexNow(env,fetcher).catch(error=>({sent:0,failed:0,stopped:String(error)}) as PingResult);
  if(google.stopped)console.error('google indexing stopped',google.stopped);
  if(indexnow.stopped)console.error('indexnow stopped',indexnow.stopped);
  return {google,indexnow};
}
