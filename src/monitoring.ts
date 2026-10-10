// Site monitoring. Three things watch for a CareJoys flow that silently stops working:
// 1. Visitors' browsers report JavaScript crashes, failed API calls and API calls that hang (src/errorReporter.ts);
//    uncaught Worker exceptions land in the same table. New problems are emailed from the five-minute cron.
// 2. A daily funnel alarm (15:41 UTC cron) emails when a step that normally happens, given the traffic before it,
//    dropped to zero over the last 24 hours, or when Clarity saw rage clicks or clicks that hit an error.
// 3. The click-through test in e2e/ runs the real flows in a browser before every deploy.
import type { EmailBinding } from './email';

type Row=Record<string,unknown>;
type Statement={bind(...values:unknown[]):Statement;run():Promise<unknown>;first<T=Row>():Promise<T|null>;all<T=Row>():Promise<{results?:T[]}>};
type DB={prepare(query:string):Statement};
export type MonitorEnv={DB?:DB;EMAIL?:EmailBinding;ADMIN_EMAILS?:string;ALERT_EMAILS?:string;CLARITY_PROJECT_ID?:string};

const clean=(v:unknown,max:number)=>typeof v==='string'?v.trim().slice(0,max):'';
const BOT_UA=/bot|crawler|spider|crawling|headless|preview|monitor|curl|wget|python|node-fetch/i;
const KINDS=new Set(['error','rejection','react','api','api_slow','server']);
// Noise that is not CareJoys' code: browser extensions, in-app browsers, and errors the browser hides from us.
const NOISE=/^Script error\.?$|ResizeObserver loop|chrome-extension:|moz-extension:|safari(-web)?-extension:|__gCrWeb|webkit\.messageHandlers|Non-Error promise rejection captured|instantSearchSDKJSBridgeClearHighlight|Can't find variable: (gmo|_AutofillCallbackHandler)/i;
const NEW_FINGERPRINTS_PER_DAY=200;
const ERROR_EMAIL_EVERY_MINUTES=30;

async function sha(value:string){
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash)).slice(0,16).map(b=>b.toString(16).padStart(2,'0')).join('');
}
/** The same bug groups together across deploys and visitors: no build hashes, ids or numbers in the fingerprint. */
function fingerprintText(kind:string,message:string,source:string){
  const msg=message.replace(/https?:\/\/\S+/g,'<url>').replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi,'<id>').replace(/\d+/g,'<n>');
  const file=source.replace(/:\d+(:\d+)?$/,'').replace(/[?#].*$/,'').replace(/^.*\//,'').replace(/-[A-Za-z0-9_-]{8}\.js$/,'.js');
  return kind+'|'+msg+'|'+file;
}
const json=(body:unknown,init:ResponseInit={})=>new Response(JSON.stringify(body),{...init,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...(init.headers||{})}});

/** POST /api/client-errors from src/errorReporter.ts. Always 204, so a broken reporter can never break a page. */
export async function recordClientError(request:Request,env:MonitorEnv){
  const done=new Response(null,{status:204});
  if(!env.DB)return done;
  if(BOT_UA.test(request.headers.get('user-agent')||''))return done;
  const text=await request.text().catch(()=>'');
  if(!text||text.length>16000)return done;
  let data:Row;
  try{data=JSON.parse(text) as Row}catch{return done}
  const kind=clean(data.kind,20);
  if(!KINDS.has(kind)||kind==='server')return done;
  const message=clean(data.message,500);
  const source=clean(data.source,300);
  if(!message||NOISE.test(message)||NOISE.test(source))return done;
  // A crash in someone else's script (an extension, an ad, a translation widget) is not ours to chase.
  if((kind==='error'||kind==='rejection')&&source&&!sameSite(source,request.url))return done;
  await saveError(env.DB,{kind,message,source,stack:clean(data.stack,2000),path:clean(data.path,300).split(/[?#]/)[0]||'/',
    userAgent:clean(request.headers.get('user-agent'),200)});
  return done;
}
function sameSite(source:string,requestUrl:string){
  try{const s=new URL(source),r=new URL(requestUrl);return s.hostname===r.hostname||s.hostname==='carejoys.com'}catch{return true}
}

/** An exception nothing else caught while answering a request. Called from the Worker's fetch handler. */
export async function recordServerError(env:MonitorEnv,request:Request,error:unknown){
  if(!env.DB)return;
  const err=error instanceof Error?error:new Error(String(error));
  const path=new URL(request.url).pathname;
  await saveError(env.DB,{kind:'server',message:(request.method+' '+path.replace(/\/[0-9a-f-]{20,}|\/\d+/gi,'/:id')+': '+(err.message||err.name)).slice(0,500),
    source:'worker',stack:clean(err.stack,2000),path,userAgent:''}).catch(()=>null);
}

async function saveError(db:DB,e:{kind:string;message:string;source:string;stack:string;path:string;userAgent:string}){
  const fingerprint=await sha(fingerprintText(e.kind,e.message,e.source));
  const known=await db.prepare('SELECT 1 AS hit FROM client_errors WHERE fingerprint=?').bind(fingerprint).first();
  if(!known){
    // Someone flooding the endpoint with made-up errors fills a day's quota, not the database.
    const today=await db.prepare("SELECT COUNT(*) AS n FROM client_errors WHERE first_seen_at>=datetime('now','-1 day')").first<{n:number}>();
    if(Number(today?.n||0)>=NEW_FINGERPRINTS_PER_DAY)return;
  }
  await db.prepare(`INSERT INTO client_errors(fingerprint,kind,message,source,stack,first_path,last_path,user_agent) VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT(fingerprint) DO UPDATE SET count=count+1,last_seen_at=CURRENT_TIMESTAMP,last_path=excluded.last_path,user_agent=excluded.user_agent,
      stack=COALESCE(NULLIF(excluded.stack,''),client_errors.stack)`)
    .bind(fingerprint,e.kind,e.message,e.source||null,e.stack||null,e.path,e.path,e.userAgent||null).run();
}

/** Who gets alerts: ALERT_EMAILS, else ADMIN_EMAILS, else the owner accounts in admin_authorizations. */
export async function alertRecipients(env:MonitorEnv){
  const parse=(v:unknown)=>clean(v,4000).toLowerCase().split(/[\s,;]+/).filter(e=>e.includes('@'));
  const list=parse(env.ALERT_EMAILS);
  if(list.length)return list;
  const admins=parse(env.ADMIN_EMAILS);
  if(admins.length)return admins;
  if(!env.DB)return [];
  const rows=(await env.DB.prepare('SELECT email FROM admin_authorizations ORDER BY email').all<{email:string}>().catch(()=>({results:[]}))).results||[];
  return rows.map(r=>String(r.email||'').toLowerCase()).filter(e=>e.includes('@'));
}

async function sendAlert(env:MonitorEnv,kind:string,subject:string,lines:string[],summary:string){
  const to=await alertRecipients(env);
  if(!env.DB||!env.EMAIL||!to.length)return {sent:false,reason:'no email binding or recipients'};
  const esc=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]||c));
  const text=lines.join('\n');
  const html='<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#1b153c">'
    +lines.map(l=>l?'<p style="margin:0 0 10px">'+esc(l)+'</p>':'').join('')+'</div>';
  await env.EMAIL.send({from:'CareJoys alerts <updates@carejoys.com>',to,subject,html,text});
  await env.DB.prepare('INSERT INTO monitor_alerts(id,kind,summary,sent_to) VALUES (?,?,?,?)').bind(crypto.randomUUID(),kind,summary.slice(0,1000),to.join(',')).run();
  return {sent:true,to};
}

const KIND_LABEL:Record<string,string>={error:'JavaScript crash',rejection:'JavaScript crash (promise)',react:'Page crashed while drawing',
  api:'API call failed',api_slow:'API call hung for 20+ seconds',server:'Worker exception'};

/** Five-minute cron: one email listing problems not seen before (or back after a quiet day), at most every 30 minutes. */
export async function alertNewClientErrors(env:MonitorEnv){
  if(!env.DB)return {sent:false,count:0};
  const pending=(await env.DB.prepare(`SELECT fingerprint,kind,message,source,first_path,last_path,count,first_seen_at,last_seen_at,alerted_at FROM client_errors
    WHERE alerted_at IS NULL OR (datetime(last_seen_at)>datetime(alerted_at) AND datetime(alerted_at)<=datetime('now','-1 day'))
    ORDER BY last_seen_at DESC LIMIT 20`).all<Row>()).results||[];
  if(!pending.length)return {sent:false,count:0};
  const recent=await env.DB.prepare(`SELECT 1 AS hit FROM monitor_alerts WHERE kind='client_errors' AND datetime(created_at)>datetime('now',?) LIMIT 1`)
    .bind('-'+ERROR_EMAIL_EVERY_MINUTES+' minutes').first();
  if(recent)return {sent:false,count:pending.length};
  const lines=[pending.length===1?'CareJoys saw a new problem on the site:':`CareJoys saw ${pending.length} new problems on the site:`,''];
  for(const r of pending){
    const where=r.last_path&&r.last_path!==r.first_path?`${r.first_path} and ${r.last_path}`:String(r.first_path||'/');
    lines.push(`• ${KIND_LABEL[String(r.kind)]||String(r.kind)} on ${where}: ${String(r.message)}`
      +` (${Number(r.count)} time${Number(r.count)===1?'':'s'} since ${String(r.first_seen_at)} UTC${r.source&&r.source!=='worker'?', in '+String(r.source):''})`);
  }
  lines.push('','Full details, with stack traces: https://carejoys.com/api/admin/monitoring (sign in as an admin).');
  const result=await sendAlert(env,'client_errors',`CareJoys alert: ${pending.length} new site error${pending.length===1?'':'s'}`,lines,
    pending.map(r=>String(r.message)).join(' | '));
  if(result.sent){
    const marks=pending.map(()=>'?').join(',');
    await env.DB.prepare(`UPDATE client_errors SET alerted_at=CURRENT_TIMESTAMP WHERE fingerprint IN (${marks})`).bind(...pending.map(r=>r.fingerprint)).run();
  }
  return {...result,count:pending.length};
}

// ---- Daily funnel alarm ----

const NOT_TEST_EMAIL=(col:string)=>`lower(COALESCE(${col},'')) NOT LIKE '%@example.com' AND lower(COALESCE(${col},'')) NOT LIKE '%@example.test' AND lower(COALESCE(${col},'')) NOT LIKE '%.test' AND lower(COALESCE(${col},'')) NOT LIKE '%@carejoys.com'`;
type Step={key:string;label:string;table:string;time:string;where:string;after?:string};
/** Each step counts real rows in the table that step writes; `after` is the step whose traffic it depends on. */
export const FUNNEL_STEPS:Step[]=[
  {key:'page_views',label:'Page views',table:'analytics_events',time:'created_at',where:"event_type='page_view'"},
  {key:'zip_searches',label:'Job searches by ZIP',table:'worker_funnel_events',time:'created_at',where:"event_type IN ('preview_jobs','preview_empty')",after:'page_views'},
  {key:'caregiver_signups',label:'Caregiver sign-ups',table:'caregivers',time:'created_at',
    where:"COALESCE(source,'') NOT IN ('legacy_carekoya','import') AND "+NOT_TEST_EMAIL('email'),after:'page_views'},
  {key:'job_applies',label:'Apply clicks on jobs',table:'caregiver_job_apply_events',time:'created_at',
    where:"event_type IN ('external_redirect_clicked','carejoys_applied','profile_completed')",after:'page_views'},
  {key:'apply_for_me_started',label:'"Apply for me" started',table:'apply_agent_sessions',time:'started_at',where:'1=1',after:'page_views'},
  {key:'apply_for_me_finished',label:'"Apply for me" reaching the employer (submitted or handed over)',table:'apply_agent_sessions',time:'started_at',
    where:"status IN ('submitted','handoff_required','needs_answers','already_applied')",after:'apply_for_me_started'},
  {key:'workspace_visits',label:'Employer workspace visits',table:'analytics_events',time:'created_at',where:"event_type='page_view' AND (path='/app' OR path LIKE '/app/%')",after:'page_views'},
  {key:'employer_signups',label:'Employer sign-ups',table:'employer_leads',time:'created_at',
    where:"COALESCE(hiring_notes,'')!='CareJoys admin account' AND "+NOT_TEST_EMAIL('email'),after:'page_views'},
  {key:'openings_created',label:'Openings created',table:'openings',time:'created_at',where:'1=1',after:'workspace_visits'},
];
const BASELINE_DAYS=14;
// Alert only when at least this many were expected today: zero then has under a 5% chance of being bad luck.
const MIN_EXPECTED=3;
const MIN_BASELINE=5;

export type FunnelFinding={key:string;label:string;today:number;baseline:number;expected:number;because:string};

async function stepCounts(db:DB,step:Step){
  const t=`datetime(${step.time})`;
  const row=await db.prepare(`SELECT
      SUM(CASE WHEN ${t}>=datetime('now','-1 day') THEN 1 ELSE 0 END) AS today,
      SUM(CASE WHEN ${t}<datetime('now','-1 day') AND ${t}>=datetime('now','-${BASELINE_DAYS+1} days') THEN 1 ELSE 0 END) AS baseline
    FROM ${step.table} WHERE ${step.where} AND ${t}>=datetime('now','-${BASELINE_DAYS+1} days')`).first<{today:number|null;baseline:number|null}>();
  return {today:Number(row?.today||0),baseline:Number(row?.baseline||0)};
}

/** The steps that dropped to zero in the last 24 hours although the traffic before them says some were due. */
export async function evaluateFunnel(env:MonitorEnv){
  const counts:Record<string,{today:number;baseline:number}>={};
  for(const step of FUNNEL_STEPS)counts[step.key]=await stepCounts(env.DB!,step).catch(()=>({today:0,baseline:0}));
  const findings:FunnelFinding[]=[];
  for(const step of FUNNEL_STEPS){
    const c=counts[step.key];
    if(c.today>0||c.baseline<MIN_BASELINE)continue;
    if(!step.after){
      const expected=c.baseline/BASELINE_DAYS;
      if(expected>=MIN_EXPECTED)findings.push({key:step.key,label:step.label,today:0,baseline:c.baseline,expected:Math.round(expected*10)/10,
        because:`about ${Math.round(expected)} a day over the last ${BASELINE_DAYS} days`});
      continue;
    }
    const up=counts[step.after],upLabel=FUNNEL_STEPS.find(s=>s.key===step.after)!.label.toLowerCase();
    if(!up||up.today===0||up.baseline===0)continue;
    const expected=up.today*(c.baseline/up.baseline);
    if(expected>=MIN_EXPECTED)findings.push({key:step.key,label:step.label,today:0,baseline:c.baseline,expected:Math.round(expected*10)/10,
      because:`${up.today} ${upLabel} in the same 24 hours; at the last ${BASELINE_DAYS} days' rate that should have meant about ${Math.round(expected)}`});
  }
  return {counts,findings};
}

type ClarityMetric={metricName?:string;information?:Array<Record<string,unknown>>};
/** Yesterday's Clarity totals (pulled by the same cron just before): rage clicks and clicks that hit an error. */
export async function clarityClickProblems(env:MonitorEnv){
  const row=await env.DB!.prepare("SELECT pulled_on,payload FROM clarity_insights WHERE dimension='' AND status='ok' AND pulled_on>=date('now','-1 day') ORDER BY pulled_on DESC LIMIT 1")
    .first<{pulled_on:string;payload:string}>().catch(()=>null);
  if(!row?.payload)return [];
  let metrics:ClarityMetric[]=[];
  try{metrics=JSON.parse(row.payload) as ClarityMetric[]}catch{return []}
  const metric=(name:string)=>metrics.find(m=>m.metricName===name)?.information?.[0]||{};
  const out:string[]=[];
  for(const [name,label] of [['RageClickCount','rage clicks (someone clicking the same spot over and over)'],['ErrorClickCount','clicks followed by a JavaScript error']] as const){
    const m=metric(name),n=Number(m.subTotal||0);
    if(n>0)out.push(`${n} ${label}, in ${Number(m.sessionsWithMetricPercentage||0)}% of ${Number(m.sessionsCount||0)} sessions`);
  }
  // Dead clicks (a click that changed nothing) are common on plain text, so only a high share counts.
  const dead=metric('DeadClickCount');
  if(Number(dead.sessionsCount||0)>=8&&Number(dead.sessionsWithMetricPercentage||0)>=25)
    out.push(`dead clicks (a click that changed nothing) in ${Number(dead.sessionsWithMetricPercentage)}% of ${Number(dead.sessionsCount)} sessions`);
  return out;
}

/** 15:41 UTC daily: one email if any funnel step dropped to zero or Clarity saw broken clicks; nothing otherwise. */
export async function runDailyMonitor(env:MonitorEnv){
  if(!env.DB)return {sent:false,findings:[],clicks:[]};
  const {findings}=await evaluateFunnel(env);
  const clicks=await clarityClickProblems(env);
  if(!findings.length&&!clicks.length)return {sent:false,findings,clicks};
  const lines:string[]=[];
  if(findings.length){
    lines.push('These CareJoys steps had zero in the last 24 hours, though the traffic before them says some were due:','');
    for(const f of findings)lines.push(`• ${f.label}: 0 (${f.because}).`);
    lines.push('');
  }
  if(clicks.length){
    lines.push('Clarity saw visitors struggling with clicks yesterday:','');
    for(const c of clicks)lines.push('• '+c);
    lines.push('',`Recordings: https://clarity.microsoft.com/projects/view/${clean(env.CLARITY_PROJECT_ID,40)||'ysz8riafaj'}/dashboard`,'');
  }
  lines.push('Site errors reported by browsers: https://carejoys.com/api/admin/monitoring (sign in as an admin).');
  const subject=findings.length?`CareJoys alert: ${findings.map(f=>f.label.replace(/"/g,'')).join(', ')} dropped to zero`:'CareJoys alert: visitors struggling with clicks';
  const result=await sendAlert(env,'daily_funnel',subject.slice(0,180),lines,[...findings.map(f=>f.key),...clicks].join(' | '));
  return {...result,findings,clicks};
}

/** Admin JSON: recent errors with stacks, today's funnel numbers, and the alerts that went out. */
export async function monitoringReport(env:MonitorEnv){
  if(!env.DB)return json({ok:false,error:'Database unavailable'},{status:503});
  const errors=(await env.DB.prepare(`SELECT kind,message,source,stack,first_path,last_path,user_agent,count,first_seen_at,last_seen_at,alerted_at
    FROM client_errors WHERE datetime(last_seen_at)>=datetime('now','-14 days') ORDER BY last_seen_at DESC LIMIT 100`).all()).results||[];
  const alerts=(await env.DB.prepare("SELECT kind,summary,sent_to,created_at FROM monitor_alerts ORDER BY created_at DESC LIMIT 30").all()).results||[];
  const funnel=await evaluateFunnel(env);
  return json({ok:true,recipients:await alertRecipients(env),errors,funnel,clarity:await clarityClickProblems(env),alerts});
}
