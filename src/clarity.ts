// Microsoft Clarity Data Export: once a day the Worker saves the last 24 hours of Clarity insights into
// `clarity_insights` (CLARITY_API_TOKEN lives in the Worker's Cloudflare settings as a secret).
// Clarity allows 10 requests per project per day and only looks back 1-3 days, so the daily pull keeps history.
type Row=Record<string,unknown>;
type Statement={bind(...values:unknown[]):Statement;run():Promise<unknown>;first<T=Row>():Promise<T|null>;all<T=Row>():Promise<{results?:T[]}>};
type DB={prepare(query:string):Statement};
export type ClarityEnv={DB?:DB;CLARITY_API_TOKEN?:string};

const ENDPOINT='https://www.clarity.ms/export-data/api/v1/project-live-insights';
/** One request each; '' is the site-wide totals. Five of the ten daily requests, leaving room for a manual pull. */
export const CLARITY_DIMENSIONS=['','URL','Source','Channel','Device'];

export async function pullClarityInsights(env:ClarityEnv,{force=false,fetcher=fetch}:{force?:boolean;fetcher?:typeof fetch}={}){
  const token=(env.CLARITY_API_TOKEN||'').trim();
  if(!token||!env.DB)return {ok:false,error:'CLARITY_API_TOKEN not set'};
  const now=new Date().toISOString(),day=now.slice(0,10);
  const results:Record<string,string>={};
  for(const dimension of CLARITY_DIMENSIONS){
    const label=dimension||'total';
    if(!force){
      const done=await env.DB.prepare("SELECT 1 AS done FROM clarity_insights WHERE pulled_on=? AND dimension=? AND status='ok'").bind(day,dimension).first();
      if(done){results[label]='already pulled';continue;}
    }
    let status='ok',payload:string|null=null;
    try{
      const url=ENDPOINT+'?numOfDays=1'+(dimension?'&dimension1='+encodeURIComponent(dimension):'');
      const res=await fetcher(url,{headers:{authorization:'Bearer '+token,'content-type':'application/json'}});
      const text=await res.text();
      if(res.ok){JSON.parse(text);payload=text;}
      else status='http_'+res.status;
      // Out of quota or a bad token: the remaining dimensions would fail the same way.
      if(res.status===401||res.status===403||res.status===429){
        await save(env.DB,day,dimension,status,payload,now);results[label]=status;break;
      }
    }catch(e){status='error: '+String((e as Error)?.message||e).slice(0,200);}
    await save(env.DB,day,dimension,status,payload,now);
    results[label]=status;
  }
  return {ok:true,day,results};
}

function save(db:DB,day:string,dimension:string,status:string,payload:string|null,now:string){
  return db.prepare(`INSERT INTO clarity_insights(pulled_on,dimension,status,payload,pulled_at) VALUES (?,?,?,?,?)
    ON CONFLICT(pulled_on,dimension) DO UPDATE SET status=excluded.status,payload=COALESCE(excluded.payload,clarity_insights.payload),pulled_at=excluded.pulled_at`)
    .bind(day,dimension,status,payload,now).run();
}

/** Admin view: the saved pulls for the last `days` days, newest first, with each payload parsed. */
export async function clarityInsights(env:ClarityEnv,days:number){
  if(!env.DB)return {configured:!!env.CLARITY_API_TOKEN,rows:[]};
  const since=new Date(Date.now()-Math.max(1,Math.min(days,366))*86400000).toISOString().slice(0,10);
  const rows=(await env.DB.prepare('SELECT pulled_on,dimension,status,payload,pulled_at FROM clarity_insights WHERE pulled_on>=? ORDER BY pulled_on DESC,dimension').bind(since).all()).results||[];
  return {configured:!!env.CLARITY_API_TOKEN,rows:rows.map(r=>({pulledOn:r.pulled_on,dimension:r.dimension||'total',status:r.status,pulledAt:r.pulled_at,
    data:typeof r.payload==='string'?safeJson(r.payload):null}))};
}
const safeJson=(text:string)=>{try{return JSON.parse(text)}catch{return null}};
