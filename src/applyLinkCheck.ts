import { type FeatureEnv } from './serverFeatures';

type Row=Record<string,unknown>;
const clean=(v:unknown,max=1000)=>typeof v==='string'?v.trim().slice(0,max):'';

/** Why an apply link can't work, judged from the URL alone, or '' when it looks fine. Checked before a job is published. */
export function applyUrlProblem(rawUrl:string){
  let url:URL;
  try{url=new URL(rawUrl)}catch{return 'bad_url'}
  if(url.protocol!=='https:'&&url.protocol!=='http:')return 'bad_url';
  const host=url.hostname.toLowerCase();
  // Workday's own error page, wherever a link ended up pointing at it.
  if(host==='community.workday.com'||/\/invalid-url\b/i.test(url.pathname))return 'invalid_page';
  // A Workday posting needs the board's site name before /job/ (…myworkdayjobs.com/Careers/job/…); without it Workday
  // answers "The URL you have provided is invalid".
  if(host.endsWith('.myworkdayjobs.com')&&/^\/(?:[a-z]{2}(?:-[A-Z]{2})?\/)?job\//.test(url.pathname))return 'workday_missing_site';
  return '';
}

/** Workday's job API for a posting page, which answers 404 once the posting closes (the page itself always says 200). */
export function workdayPostingApi(rawUrl:string){
  try{
    const url=new URL(rawUrl);
    const host=url.hostname.toLowerCase();
    if(!host.endsWith('.myworkdayjobs.com'))return null;
    const m=url.pathname.match(/^\/(?:[a-z]{2}(?:-[A-Z]{2})?\/)?([^/]+)(\/job\/.+)$/);
    if(!m||m[1]==='job')return null;
    return 'https://'+url.hostname+'/wday/cxs/'+host.split('.')[0]+'/'+m[1]+m[2];
  }catch{return null}
}

const DEAD_STATUSES=new Set([404,410]);
/** 'dead' only on a clear answer (404/410, Workday's invalid page); timeouts, blocks and 5xx are 'unknown', never taken down. */
export async function probeApplyLink(rawUrl:string,ms=8000):Promise<'ok'|'dead'|'unknown'>{
  if(applyUrlProblem(rawUrl))return 'dead';
  const api=workdayPostingApi(rawUrl);
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),ms);
  try{
    const res=await fetch(api||rawUrl,{redirect:'follow',signal:controller.signal,headers:{
      'user-agent':'Mozilla/5.0 (compatible; CareJoysBot/1.1; +https://carejoys.com)',
      accept:api?'application/json':'text/html,application/xhtml+xml,*/*;q=0.8'
    }});
    try{await res.body?.cancel()}catch{}
    if(applyUrlProblem(res.url||''))return 'dead';
    if(DEAD_STATUSES.has(res.status))return 'dead';
    return res.ok?'ok':'unknown';
  }catch{return 'unknown'}
  finally{clearTimeout(timer)}
}

const CHECK_CONCURRENCY=5;
/**
 * Re-checks the apply links of live jobs, least recently checked first, and takes down every page whose link is dead.
 * Chains share one posting across many pages, so each link is fetched once and the verdict applies to all of them.
 * Reads through idx_caregiver_jobs_link_check, so a run costs about `limit` rows.
 */
export async function checkApplyLinksBatch(env:FeatureEnv,limit=40){
  if(!env.DB)return {checked:0,dead:0};
  // Links whose shape alone says they can't work come down at once, without waiting their turn in the queue
  // (e.g. rows a scan from an older deploy wrote). Same patterns as applyUrlProblem.
  await env.DB.prepare(`UPDATE caregiver_jobs SET is_published=0,publication_reason='dead_apply_link',link_checked_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
    WHERE is_published=1 AND status='current' AND (source_url LIKE 'https://%.myworkdayjobs.com/job/%' OR source_url LIKE 'https://%.myworkdayjobs.com/__-__/job/%'
      OR source_url LIKE '%community.workday.com%' OR source_url LIKE '%/invalid-url%')`).run();
  const rows=(await env.DB.prepare(`SELECT id,source_url FROM caregiver_jobs
    WHERE is_published=1 AND status='current' AND source_provider!='carejoys'
    ORDER BY link_checked_at ASC LIMIT ?`).bind(limit).all<Row>()).results||[];
  const urls=[...new Set(rows.map(r=>clean(r.source_url)).filter(Boolean))];
  let dead=0;
  async function checkOne(url:string){
    const verdict=await probeApplyLink(url);
    if(verdict==='dead'){
      dead++;
      await env.DB!.prepare(`UPDATE caregiver_jobs SET is_published=0,publication_reason='dead_apply_link',link_checked_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
        WHERE source_url=? AND is_published=1`).bind(url).run();
    }else{
      await env.DB!.prepare('UPDATE caregiver_jobs SET link_checked_at=CURRENT_TIMESTAMP WHERE source_url=? AND is_published=1').bind(url).run();
    }
  }
  for(let i=0;i<urls.length;i+=CHECK_CONCURRENCY)await Promise.all(urls.slice(i,i+CHECK_CONCURRENCY).map(checkOne));
  // A row with no link at all still gets a timestamp, so it doesn't sit at the front of the queue.
  const blank=rows.filter(r=>!clean(r.source_url)).map(r=>r.id);
  for(const id of blank)await env.DB.prepare('UPDATE caregiver_jobs SET link_checked_at=CURRENT_TIMESTAMP WHERE id=?').bind(id).run();
  return {checked:urls.length,dead};
}
