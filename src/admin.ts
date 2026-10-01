import { employerSession, publicFormGuard, sendEmployerMagicLink } from './serverFeatures';
import { employerApproval } from './employerApproval';
import { outreachStatus, runOutreach, sendOutreachTest, type OutreachEnv, type OutreachKind } from './outreach';

type Row=Record<string,unknown>;
export type AdminEnv=OutreachEnv&{ADMIN_EMAILS?:string;ADMIN_TOKEN?:string};

const clean=(v:unknown,max=500)=>typeof v==='string'?v.trim().slice(0,max):'';
const asNum=(v:unknown)=>{const n=Number(v||0);return Number.isFinite(n)?n:0};
const json=(body:unknown,init:ResponseInit={})=>new Response(JSON.stringify(body),{
  ...init,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...(init.headers||{})}
});

export function adminEmails(env:AdminEnv){
  return clean(env.ADMIN_EMAILS,4000).toLowerCase().split(/[\s,;]+/).filter(e=>e.includes('@'));
}

async function digest(value:string){
  return new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));
}
/** Constant-time comparison of two secrets (compares fixed-length digests). */
export async function secretsMatch(a:string,b:string){
  if(!a||!b)return false;
  const [x,y]=await Promise.all([digest(a),digest(b)]);
  let diff=0;
  for(let i=0;i<x.length;i++)diff|=x[i]^y[i];
  return diff===0;
}

/** Admin = `Authorization: Bearer $ADMIN_TOKEN`, or an employer session whose email is in ADMIN_EMAILS. */
export async function adminFromRequest(request:Request,env:AdminEnv){
  const auth=request.headers.get('authorization')||'';
  if(env.ADMIN_TOKEN&&auth.startsWith('Bearer ')&&await secretsMatch(auth.slice(7).trim(),env.ADMIN_TOKEN))return {via:'token' as const,email:''};
  const allowed=adminEmails(env);
  if(!allowed.length)return null;
  const session=await employerSession(request,env);
  const email=clean(session?.email,320).toLowerCase();
  return session&&allowed.includes(email)?{via:'session' as const,email}:null;
}

export async function requestAdminMagicLink(request:Request,env:AdminEnv){
  if(!env.DB||!env.EMAIL)return json({ok:false,error:'Sign-in email is not configured'},{status:503});
  const data=await request.json().catch(()=>null) as Row|null;
  const guard=await publicFormGuard(request,env,'admin_magic_link',data,5,15);
  if(guard)return guard;
  const email=clean(data?.email,320).toLowerCase();
  if(adminEmails(env).includes(email)){
    let row=await env.DB.prepare("SELECT id FROM employer_leads WHERE lower(email)=? AND status!='disabled' ORDER BY created_at DESC LIMIT 1").bind(email).first<{id:string}>();
    if(!row){
      row={id:crypto.randomUUID()};
      await env.DB.prepare("INSERT INTO employer_leads(id,company_name,contact_name,email,zip,roles_needed,hiring_notes,status) VALUES (?,'CareJoys','Admin',?,'','','CareJoys admin account','active')").bind(row.id,email).run();
    }
    await sendEmployerMagicLink(env,row.id,'/admin');
  }
  return json({ok:true,message:'If that email is a CareJoys admin, a sign-in link is on the way.'});
}

const WINDOWS:Record<string,string|null>={'7':'-7 days','30':'-30 days','90':'-90 days','all':null};

/** Funnel and acquisition numbers for the admin console, all from existing tables. */
export async function adminFunnel(env:AdminEnv,windowKey:string){
  const modifier=WINDOWS[windowKey]===undefined?WINDOWS['30']:WINDOWS[windowKey];
  const since=(col:string)=>modifier?`${col} IS NOT NULL AND datetime(${col})>=datetime('now','${modifier}')`:`${col} IS NOT NULL`;
  const db=env.DB!;
  const funnel=await db.prepare(`SELECT
      (SELECT COUNT(*) FROM employer_leads WHERE ${since('created_at')} AND COALESCE(hiring_notes,'')!='CareJoys admin account') AS employers,
      (SELECT COUNT(*) FROM openings WHERE ${since('created_at')}) AS openings,
      (SELECT COUNT(*) FROM candidate_pipeline WHERE ${since('created_at')}) AS matched,
      (SELECT COUNT(*) FROM candidate_pipeline WHERE ${since('contacted_at')}) AS contacted,
      (SELECT COUNT(*) FROM candidate_pipeline WHERE response_value='interested' AND ${since('response_at')}) AS interested,
      (SELECT COUNT(*) FROM candidate_pipeline WHERE ${since('interview_booked_at')}) AS interviews,
      (SELECT COUNT(*) FROM candidate_pipeline WHERE ${since('hired_at')}) AS hired`).first<Row>();
  const caregivers=await db.prepare(`SELECT COALESCE(source,'unknown') AS source,COUNT(*) AS count FROM caregivers WHERE ${since('created_at')} AND COALESCE(work_status,'')!='merged_duplicate' GROUP BY COALESCE(source,'unknown') ORDER BY count DESC`).all<Row>();
  const activation=await db.prepare(`SELECT
      (SELECT COUNT(*) FROM caregivers WHERE source='legacy_carekoya') AS legacy_total,
      (SELECT COUNT(*) FROM caregivers WHERE source='legacy_carekoya' AND ${since('activation_sent_at')} AND activation_delivery_status='sent') AS sent,
      (SELECT COUNT(*) FROM caregivers WHERE source='legacy_carekoya' AND ${since('activation_opened_at')}) AS opened,
      (SELECT COUNT(*) FROM caregivers WHERE source='legacy_carekoya' AND ${since('activation_completed_at')}) AS completed,
      (SELECT COUNT(*) FROM caregivers WHERE source='legacy_carekoya' AND work_status='actively_looking' AND ${since('activation_completed_at')}) AS actively_looking`).first<Row>();
  const agencies=await db.prepare(`SELECT
      (SELECT COUNT(*) FROM agency_teaser_tokens WHERE ${since('sent_at')}) AS teasers_sent,
      (SELECT COUNT(*) FROM agency_teaser_tokens WHERE ${since('opened_at')}) AS teasers_opened,
      (SELECT COUNT(*) FROM agency_teaser_tokens WHERE ${since('claim_requested_at')}) AS claims_requested,
      (SELECT COUNT(*) FROM agency_teaser_tokens WHERE ${since('claimed_at')}) AS claimed`).first<Row>();
  const jobApplies=await db.prepare(`SELECT event_type,COUNT(*) AS count FROM caregiver_job_apply_events WHERE ${since('created_at')} GROUP BY event_type ORDER BY count DESC`).all<Row>();
  const pageViews=await db.prepare(`SELECT COUNT(*) AS count FROM analytics_events WHERE event_type='page_view' AND ${since('created_at')}`).first<Row>();
  const topPaths=await db.prepare(`SELECT path,COUNT(*) AS count FROM analytics_events WHERE event_type='page_view' AND ${since('created_at')} GROUP BY path ORDER BY count DESC LIMIT 12`).all<Row>();
  const topSources=await db.prepare(`SELECT COALESCE(NULLIF(utm_source,''),NULLIF(referrer_host,''),'direct') AS source,COUNT(*) AS count FROM analytics_events WHERE event_type='page_view' AND ${since('created_at')} GROUP BY 1 ORDER BY count DESC LIMIT 12`).all<Row>();
  const num=(row:Row|null,key:string)=>asNum(row?.[key]);
  return {
    window:modifier?windowKey:'all',
    employerFunnel:['employers','openings','matched','contacted','interested','interviews','hired'].map(step=>({step,count:num(funnel,step)})),
    caregiverSignups:caregivers.results||[],
    reactivation:{legacyTotal:num(activation,'legacy_total'),sent:num(activation,'sent'),opened:num(activation,'opened'),completed:num(activation,'completed'),activelyLooking:num(activation,'actively_looking')},
    agencyClaims:{teasersSent:num(agencies,'teasers_sent'),teasersOpened:num(agencies,'teasers_opened'),claimsRequested:num(agencies,'claims_requested'),claimed:num(agencies,'claimed')},
    jobApplies:jobApplies.results||[],
    traffic:{pageViews:num(pageViews,'count'),topPaths:topPaths.results||[],topSources:topSources.results||[]}
  };
}

export async function adminEmployers(env:AdminEnv){
  const rows=await env.DB!.prepare(`SELECT e.id,e.company_name,e.contact_name,e.email,e.zip,e.status,e.created_at,e.last_login_at,e.approved_at,e.approval_requested_at,
      (SELECT COUNT(*) FROM openings o WHERE o.employer_id=e.id) AS openings,
      (SELECT COUNT(*) FROM candidate_pipeline cp JOIN openings o ON o.id=cp.opening_id WHERE o.employer_id=e.id AND cp.contacted_at IS NOT NULL) AS contacted,
      (SELECT COUNT(*) FROM candidate_pipeline cp JOIN openings o ON o.id=cp.opening_id WHERE o.employer_id=e.id AND cp.interview_booked_at IS NOT NULL) AS interviews,
      (SELECT canonical_name FROM agency_organizations ao WHERE ao.claimed_employer_id=e.id LIMIT 1) AS claimed_agency
    FROM employer_leads e WHERE COALESCE(e.hiring_notes,'')!='CareJoys admin account' ORDER BY e.created_at DESC LIMIT 50`).all<Row>();
  const out=[];
  for(const row of rows.results||[])out.push({...row,approval:(await employerApproval(env,row)).reason});
  return out;
}

export async function runAdminOutreach(request:Request,env:AdminEnv){
  const data=await request.json().catch(()=>null) as Row|null;
  const kind=clean(data?.kind,40) as OutreachKind;
  if(kind!=='reactivation'&&kind!=='agency_teasers')return json({ok:false,error:'Unknown outreach kind'},{status:400});
  return json({ok:true,result:await runOutreach(env,kind,'admin'),outreach:await outreachStatus(env)});
}

/** Emails the signed-in admin a sample of one outreach email. Token callers pass `to`. */
export async function sendAdminOutreachTest(request:Request,env:AdminEnv,admin:{email:string}){
  const data=await request.json().catch(()=>null) as Row|null;
  const kind=clean(data?.kind,40) as OutreachKind;
  if(kind!=='reactivation'&&kind!=='agency_teasers')return json({ok:false,error:'Unknown outreach kind'},{status:400});
  const to=(admin.email||clean(data?.to,320)).toLowerCase();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to))return json({ok:false,error:'No admin email to send the test to'},{status:400});
  try{return json({ok:true,result:await sendOutreachTest(env,kind,to)})}
  catch(error){return json({ok:false,error:error instanceof Error?error.message:'Test send failed'},{status:502})}
}

export { outreachStatus };

const TRACKED_EVENTS=new Set(['page_view']);
const BOT_UA=/bot|crawler|spider|crawling|headless|preview|monitor|curl|wget|python|node-fetch/i;

/** First-party analytics: stores the path (never the query string), referrer host and UTM tags. No cookies, IPs or user ids. */
export async function recordAnalyticsEvent(request:Request,env:AdminEnv){
  if(!env.DB)return new Response(null,{status:204});
  if(BOT_UA.test(request.headers.get('user-agent')||''))return new Response(null,{status:204});
  const data=await request.json().catch(()=>null) as Row|null;
  const type=clean(data?.type,40);
  if(!TRACKED_EVENTS.has(type))return new Response(null,{status:204});
  const path=clean(data?.path,300).split(/[?#]/)[0]||'/';
  if(!path.startsWith('/'))return new Response(null,{status:204});
  let referrerHost='';
  try{
    const host=new URL(clean(data?.referrer,1000)).hostname.toLowerCase().replace(/^www\./,'');
    referrerHost=host==='carejoys.com'?'':host;
  }catch{}
  await env.DB.prepare('INSERT INTO analytics_events(id,event_type,path,referrer_host,utm_source,utm_medium,utm_campaign) VALUES (?,?,?,?,?,?,?)')
    .bind(crypto.randomUUID(),type,path,referrerHost||null,clean(data?.utmSource,100)||null,clean(data?.utmMedium,100)||null,clean(data?.utmCampaign,150)||null).run();
  return new Response(null,{status:204});
}
