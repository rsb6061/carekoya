import { employerSession, type FeatureEnv } from './serverFeatures';
import { lockedIntroductions, type BillingEnv } from './billing';
import { teamRecipients } from './team';
import { atsForwardEmail, dailyDigestEmail, monthlyResultsEmail, teamInviteEmail, type DigestPerson } from './email';

// What an agency sets up once in its workspace: teammates, the morning digest and monthly results, forwarding to its
// ATS, its own words for caregivers, and the candidate export. Also the scheduled emails those settings drive.

type Row=Record<string,unknown>;
const ORIGIN='https://carejoys.com';
const FROM='CareJoys <hello@carejoys.com>';
export const MAX_TEAMMATES=20;
const clean=(v:unknown,max=500)=>typeof v==='string'?v.trim().slice(0,max):typeof v==='number'?String(v).slice(0,max):'';
const asNum=(v:unknown)=>{const n=Number(v||0);return Number.isFinite(n)?n:0};
const emailValid=(v:string)=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const json=(body:unknown,init:ResponseInit={})=>new Response(JSON.stringify(body),{
  ...init,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...(init.headers||{})}
});
const nameOf=(r:Row)=>[clean(r.first_name,80),clean(r.last_name,80)].filter(Boolean).join(' ')||clean(r.display_name,160)||'Caregiver';
const sourceOf=(source:unknown)=>clean(source,40)==='mcp'?'AI assistant':'CareJoys job page';

async function signedIn(request:Request,env:FeatureEnv){
  const employer=await employerSession(request,env);
  return employer?{id:clean(employer.id,100),company:clean(employer.company_name,200),ownerEmail:clean(employer.email,320).toLowerCase(),
    me:clean(employer.signed_in_email,320).toLowerCase()||clean(employer.email,320).toLowerCase(),contactName:clean(employer.contact_name,120)}:null;
}

// ---------- Teammates ----------

export async function getTeam(request:Request,env:FeatureEnv){
  const e=await signedIn(request,env);
  if(!e)return json({ok:false,error:'Sign in required'},{status:401});
  const rows=await env.DB!.prepare('SELECT id,email,created_at FROM employer_members WHERE employer_id=? ORDER BY created_at ASC').bind(e.id).all<Row>();
  return json({ok:true,me:e.me,owner:{email:e.ownerEmail,name:e.contactName},
    members:(rows.results||[]).map(r=>({id:clean(r.id,100),email:clean(r.email,320),addedAt:clean(r.created_at,40)}))});
}

/** Adds a teammate by email and emails them a sign-in link. They sign in with their own address; nothing is shared. */
export async function addTeammate(request:Request,env:FeatureEnv){
  const e=await signedIn(request,env);
  if(!e)return json({ok:false,error:'Sign in required'},{status:401});
  const data=await request.json().catch(()=>null) as Row|null;
  const email=clean(data?.email,320).toLowerCase();
  if(!emailValid(email))return json({ok:false,error:'Enter a valid email address.'},{status:400});
  if(email===e.ownerEmail)return json({ok:false,error:'That’s already the workspace’s main email.'},{status:409});
  const count=asNum((await env.DB!.prepare('SELECT COUNT(*) AS count FROM employer_members WHERE employer_id=?').bind(e.id).first<Row>())?.count);
  if(count>=MAX_TEAMMATES)return json({ok:false,error:`A workspace can have up to ${MAX_TEAMMATES} teammates.`},{status:409});
  const id=crypto.randomUUID();
  const added=await env.DB!.prepare('INSERT OR IGNORE INTO employer_members(id,employer_id,email,invited_by) VALUES (?,?,?,?)').bind(id,e.id,email,e.me||null).run();
  if(Number(added.meta?.changes||0)!==1)return json({ok:false,error:'They’re already on your team.'},{status:409});
  if(env.EMAIL){
    const mail=teamInviteEmail({inviterName:e.me===e.ownerEmail?e.contactName:e.me,company:e.company,link:ORIGIN+'/login?next=%2Fapp'});
    await env.EMAIL.send({from:FROM,to:email,subject:mail.subject,html:mail.html,text:mail.text}).catch(()=>null);
  }
  return json({ok:true,member:{id,email}});
}

/** Removes a teammate and signs them out of this workspace. */
export async function removeTeammate(request:Request,env:FeatureEnv,memberId:string){
  const e=await signedIn(request,env);
  if(!e)return json({ok:false,error:'Sign in required'},{status:401});
  const row=await env.DB!.prepare('SELECT email FROM employer_members WHERE id=? AND employer_id=?').bind(memberId,e.id).first<Row>();
  if(!row)return json({ok:false,error:'Not found'},{status:404});
  await env.DB!.prepare('DELETE FROM employer_members WHERE id=?').bind(memberId).run();
  await env.DB!.prepare('DELETE FROM employer_sessions WHERE employer_id=? AND signed_in_email=?').bind(e.id,clean(row.email,320).toLowerCase()).run();
  return json({ok:true});
}

// ---------- Settings ----------

export async function getWorkspaceSettings(request:Request,env:FeatureEnv){
  const e=await signedIn(request,env);
  if(!e)return json({ok:false,error:'Sign in required'},{status:401});
  const row=await env.DB!.prepare('SELECT digest_enabled,ats_email,company_about,company_benefits FROM employer_leads WHERE id=?').bind(e.id).first<Row>();
  return json({ok:true,settings:{digest:Number(row?.digest_enabled??1)===1,atsEmail:clean(row?.ats_email,320),about:clean(row?.company_about,1000),benefits:clean(row?.company_benefits,600)}});
}

export async function saveWorkspaceSettings(request:Request,env:FeatureEnv){
  const e=await signedIn(request,env);
  if(!e)return json({ok:false,error:'Sign in required'},{status:401});
  const data=await request.json().catch(()=>null) as Row|null;
  if(!data)return json({ok:false,error:'Nothing to save'},{status:400});
  const sets:string[]=[];const args:unknown[]=[];
  if(data.digest!==undefined){sets.push('digest_enabled=?');args.push(data.digest?1:0)}
  if(data.atsEmail!==undefined){
    const ats=clean(data.atsEmail,320).toLowerCase();
    if(ats&&!emailValid(ats))return json({ok:false,error:'Enter a valid ATS email address, or leave it blank.'},{status:400});
    // Only candidates who arrive after this point are forwarded, so turning it on never floods the ATS with old ones.
    sets.push("ats_email=?","ats_email_set_at=CASE WHEN ?='' THEN NULL WHEN COALESCE(ats_email,'')=? THEN ats_email_set_at ELSE CURRENT_TIMESTAMP END");args.push(ats||null,ats,ats);
  }
  if(data.about!==undefined){sets.push('company_about=?');args.push(clean(data.about,1000)||null)}
  if(data.benefits!==undefined){sets.push('company_benefits=?');args.push(clean(data.benefits,600)||null)}
  if(!sets.length)return json({ok:false,error:'Nothing to save'},{status:400});
  await env.DB!.prepare(`UPDATE employer_leads SET ${sets.join(',')},updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(...args,e.id).run();
  return getWorkspaceSettings(request,env);
}

// ---------- License checks ----------

export const LICENSE_RESULTS=['active','not_found'] as const;

export async function getLicenseChecks(request:Request,env:FeatureEnv){
  const e=await signedIn(request,env);
  if(!e)return json({ok:false,error:'Sign in required'},{status:401});
  const rows=await env.DB!.prepare('SELECT caregiver_id,result,checked_by,checked_at FROM license_checks WHERE employer_id=?').bind(e.id).all<Row>();
  return json({ok:true,checks:Object.fromEntries((rows.results||[]).map(r=>[clean(r.caregiver_id,120),{result:clean(r.result,20),checkedBy:clean(r.checked_by,320),checkedAt:clean(r.checked_at,40)}]))});
}

/** Records the employer's own registry check for a caregiver who is in their candidates. A blank result clears it. */
export async function saveLicenseCheck(request:Request,env:FeatureEnv,caregiverId:string){
  const e=await signedIn(request,env);
  if(!e)return json({ok:false,error:'Sign in required'},{status:401});
  const known=await env.DB!.prepare(`SELECT 1 AS hit FROM candidate_pipeline cp JOIN openings o ON o.id=cp.opening_id WHERE o.employer_id=? AND cp.caregiver_id=?
    UNION SELECT 1 FROM agency_interests ai JOIN agency_organizations ao ON ao.id=ai.organization_id WHERE ao.claimed_employer_id=? AND ai.caregiver_id=? LIMIT 1`)
    .bind(e.id,caregiverId,e.id,caregiverId).first();
  if(!known)return json({ok:false,error:'This caregiver isn’t in your candidates.'},{status:404});
  const data=await request.json().catch(()=>null) as Row|null;
  const result=clean(data?.result,20);
  if(!result){
    await env.DB!.prepare('DELETE FROM license_checks WHERE employer_id=? AND caregiver_id=?').bind(e.id,caregiverId).run();
    return json({ok:true,check:null});
  }
  if(!(LICENSE_RESULTS as readonly string[]).includes(result))return json({ok:false,error:'Choose active or not found.'},{status:400});
  await env.DB!.prepare(`INSERT INTO license_checks(employer_id,caregiver_id,result,checked_by,checked_at) VALUES (?,?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(employer_id,caregiver_id) DO UPDATE SET result=excluded.result,checked_by=excluded.checked_by,checked_at=CURRENT_TIMESTAMP`).bind(e.id,caregiverId,result,e.me||null).run();
  return json({ok:true,check:{result,checkedBy:e.me,checkedAt:new Date().toISOString()}});
}

// ---------- Export ----------

const csvCell=(v:unknown)=>{
  let s=v==null?'':String(v);
  // A leading = + - @ would run as a formula in Excel or Sheets.
  if(/^[=+\-@\t\r]/.test(s))s="'"+s;
  return /[",\n\r]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;
};
const PIPELINE_STAGE:Record<string,string>={matched:'Not invited yet',contacted:'Invited',interested:'Said yes',interview:'Interviewing',hired:'Hired',rejected:'Not a fit'};
const INBOX_STAGE:Record<string,string>={new:'Applied',contacted:'Applied, reached out',interview:'Interviewing',hired:'Hired',not_fit:'Not a fit'};

/** Every candidate who applied or was invited, as a CSV for WellSky, AxisCare or a spreadsheet. Contact details only where the dashboard shows them. */
export async function exportCandidatesCsv(request:Request,env:BillingEnv){
  const e=await signedIn(request,env);
  if(!e)return json({ok:false,error:'Sign in required'},{status:401});
  const locked=await lockedIntroductions(env,e.id);
  const matches=await env.DB!.prepare(`SELECT cp.id,cp.stage,cp.response_value,cp.contacted_at,cp.responded_at,cp.hired_at,cp.employer_notes,o.title,
      c.first_name,c.last_name,c.display_name,c.email,c.phone,c.city,c.state,c.zip,c.role,c.certifications,c.years_experience
    FROM candidate_pipeline cp JOIN openings o ON o.id=cp.opening_id JOIN caregivers c ON c.id=cp.caregiver_id
    WHERE o.employer_id=? AND cp.contacted_at IS NOT NULL ORDER BY COALESCE(cp.responded_at,cp.contacted_at) DESC LIMIT 5000`).bind(e.id).all<Row>();
  const applications=await env.DB!.prepare(`SELECT ai.id,ai.agency_stage,ai.source,ai.created_at,ai.agency_notes,ai.caregiver_note,j.title,
      c.first_name,c.last_name,c.display_name,c.email,c.phone,c.city,c.state,c.zip,c.role,c.certifications,c.years_experience
    FROM agency_interests ai JOIN agency_organizations ao ON ao.id=ai.organization_id JOIN caregivers c ON c.id=ai.caregiver_id LEFT JOIN caregiver_jobs j ON j.id=ai.caregiver_job_id
    WHERE ao.claimed_employer_id=? ORDER BY ai.created_at DESC LIMIT 5000`).bind(e.id).all<Row>();
  const header=['Name','Email','Phone','City','State','ZIP','Role','Certifications','Years experience','Position','Source','Stage','Date','Their note','Your notes'];
  const lines=[header];
  for(const r of applications.results||[]){
    const hidden=locked.has(clean(r.id,120));
    lines.push([nameOf(r),hidden?'':r.email,hidden?'':r.phone,r.city,r.state,r.zip,r.role,r.certifications,r.years_experience,r.title,'Applied from '+sourceOf(r.source),
      INBOX_STAGE[clean(r.agency_stage,20)||'new']||'Applied',clean(r.created_at,10),r.caregiver_note,r.agency_notes].map(String) as string[]);
  }
  for(const r of matches.results||[]){
    const visible=r.response_value==='interested'&&!locked.has(clean(r.id,120));
    lines.push([nameOf(r),visible?r.email:'',visible?r.phone:'',r.city,r.state,r.zip,r.role,r.certifications,r.years_experience,r.title,'Matched by CareJoys',
      PIPELINE_STAGE[clean(r.stage,20)]||clean(r.stage,20),clean(r.responded_at||r.contacted_at,10),'',r.employer_notes].map(v=>v==null?'':String(v)));
  }
  const body=lines.map(l=>l.map(v=>csvCell(v==='null'||v==='undefined'?'':v)).join(',')).join('\r\n')+'\r\n';
  const day=new Date().toISOString().slice(0,10);
  return new Response(body,{headers:{'content-type':'text/csv; charset=utf-8','cache-control':'no-store',
    'content-disposition':`attachment; filename="carejoys-candidates-${day}.csv"`}});
}

// ---------- Scheduled emails ----------

/** UTC hour the morning digest goes out: 7am Eastern in summer, 6am in winter. */
export const DIGEST_UTC_HOUR=11;

/**
 * One morning email per workspace, to the owner and teammates, on days something needs them: who applied or said yes
 * since the last digest, who is still waiting on a reply after a day, and interviews today. Skipped when there's nothing.
 */
export async function sendDailyDigests(env:BillingEnv,limit=100){
  if(!env.DB||!env.EMAIL)return {sent:0};
  const due=await env.DB.prepare(`SELECT id,company_name,last_digest_at FROM employer_leads WHERE status!='disabled' AND COALESCE(digest_enabled,1)=1
    AND (last_digest_at IS NULL OR datetime(last_digest_at)<=datetime('now','-20 hours')) ORDER BY COALESCE(last_digest_at,'') ASC LIMIT ?`).bind(limit).all<Row>();
  let sent=0;
  for(const e of due.results||[]){
    const id=clean(e.id,100);
    const since=clean(e.last_digest_at,40)||new Date(Date.now()-86400000).toISOString().replace('T',' ').slice(0,19);
    const yesRows=await env.DB.prepare(`SELECT cp.id,cp.stage,cp.responded_at,o.title,c.first_name,c.last_name,c.display_name,
        CASE WHEN datetime(cp.responded_at)>datetime(?) THEN 1 ELSE 0 END AS fresh
      FROM candidate_pipeline cp JOIN openings o ON o.id=cp.opening_id JOIN caregivers c ON c.id=cp.caregiver_id
      WHERE o.employer_id=? AND cp.stage='interested' AND cp.response_value='interested' AND o.status='open'`).bind(since,id).all<Row>();
    const appRows=await env.DB.prepare(`SELECT ai.id,ai.created_at,ai.source,j.title,c.first_name,c.last_name,c.display_name,
        CASE WHEN datetime(ai.created_at)>datetime(?) THEN 1 ELSE 0 END AS fresh
      FROM agency_interests ai JOIN agency_organizations ao ON ao.id=ai.organization_id JOIN caregivers c ON c.id=ai.caregiver_id LEFT JOIN caregiver_jobs j ON j.id=ai.caregiver_job_id
      WHERE ao.claimed_employer_id=? AND ai.agency_stage IS NULL AND datetime(ai.created_at)>datetime('now','-30 days')`).bind(since,id).all<Row>();
    const interviewRows=await env.DB.prepare(`SELECT cp.interview_at,s.timezone,o.title,c.first_name,c.last_name,c.display_name FROM candidate_pipeline cp JOIN openings o ON o.id=cp.opening_id JOIN caregivers c ON c.id=cp.caregiver_id LEFT JOIN interview_slots s ON s.id=cp.interview_slot_id
      WHERE o.employer_id=? AND cp.stage='interview' AND cp.interview_at IS NOT NULL AND datetime(cp.interview_at)>=datetime('now') AND datetime(cp.interview_at)<datetime('now','+1 day') ORDER BY cp.interview_at`).bind(id).all<Row>();
    const locked=await lockedIntroductions(env,id);
    const person=(r:Row,detail:string):DigestPerson=>({name:locked.has(clean(r.id,120))?clean(r.first_name,80)||'A caregiver':nameOf(r),title:clean(r.title,200),detail});
    const daysAgo=(at:unknown)=>{const d=Math.floor((Date.now()-Date.parse(clean(at,40).replace(' ','T')+(clean(at,40).includes('T')?'':'Z')))/86400000);return d<=0?'today':d===1?'1 day ago':d+' days ago'};
    const fresh=[...(appRows.results||[]).filter(r=>Number(r.fresh)===1).map(r=>person(r,'applied from '+(sourceOf(r.source)==='AI assistant'?'an AI assistant':'your job page'))),
      ...(yesRows.results||[]).filter(r=>Number(r.fresh)===1).map(r=>person(r,'said yes to your invitation'))];
    const waiting=[...(appRows.results||[]).filter(r=>Number(r.fresh)!==1).map(r=>person(r,'applied '+daysAgo(r.created_at))),
      ...(yesRows.results||[]).filter(r=>Number(r.fresh)!==1).map(r=>person(r,'said yes '+daysAgo(r.responded_at)))];
    const interviews=(interviewRows.results||[]).map(r=>({name:nameOf(r),title:clean(r.title,200),detail:interviewTime(clean(r.interview_at,40),clean(r.timezone,80))}));
    // Claimed first, so a run that overlaps another never sends twice.
    const claimed=await env.DB.prepare("UPDATE employer_leads SET last_digest_at=CURRENT_TIMESTAMP WHERE id=? AND (last_digest_at IS NULL OR datetime(last_digest_at)<=datetime('now','-20 hours'))").bind(id).run();
    if(Number(claimed.meta?.changes||0)!==1)continue;
    if(!fresh.length&&!waiting.length&&!interviews.length)continue;
    const to=await teamRecipients(env,id,'');
    if(!to.length)continue;
    const mail=dailyDigestEmail({company:clean(e.company_name,200),fresh,waiting,interviews,link:ORIGIN+'/app?tab=candidates',settingsLink:ORIGIN+'/app?tab=settings'});
    try{await env.EMAIL.send({from:FROM,to,subject:mail.subject,html:mail.html,text:mail.text});sent++}catch{}
  }
  return {sent};
}

function interviewTime(at:string,timezone:string){
  const opts:Intl.DateTimeFormatOptions={hour:'numeric',minute:'2-digit',timeZoneName:'short'};
  try{return new Date(at).toLocaleTimeString('en-US',{...opts,timeZone:timezone||'America/New_York'})}
  catch{return new Date(at).toLocaleTimeString('en-US',{...opts,timeZone:'America/New_York'})}
}

const MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];

/** On the 1st, last month's numbers to every workspace that had any activity in it. Once per workspace per month. */
export async function sendMonthlyResults(env:FeatureEnv,now=new Date(),limit=100){
  if(!env.DB||!env.EMAIL||now.getUTCDate()!==1)return {sent:0};
  const start=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-1,1));
  const key=start.toISOString().slice(0,7);
  const from=start.toISOString().slice(0,10),to=now.toISOString().slice(0,10);
  const due=await env.DB.prepare(`SELECT id,company_name FROM employer_leads WHERE status!='disabled' AND COALESCE(last_results_month,'')!=? LIMIT ?`).bind(key,limit).all<Row>();
  let sent=0;
  for(const e of due.results||[]){
    const id=clean(e.id,100);
    const claimed=await env.DB.prepare("UPDATE employer_leads SET last_results_month=? WHERE id=? AND COALESCE(last_results_month,'')!=?").bind(key,id,key).run();
    if(Number(claimed.meta?.changes||0)!==1)continue;
    const n=async(sql:string,...args:unknown[])=>asNum((await env.DB!.prepare(sql).bind(...args).first<Row>())?.count);
    const between="BETWEEN date(?) AND date(?,'-1 day')";
    const invited=await n(`SELECT COUNT(*) AS count FROM candidate_pipeline cp JOIN openings o ON o.id=cp.opening_id WHERE o.employer_id=? AND date(cp.contacted_at) ${between}`,id,from,to);
    const yes=await n(`SELECT COUNT(*) AS count FROM candidate_pipeline cp JOIN openings o ON o.id=cp.opening_id WHERE o.employer_id=? AND cp.response_value='interested' AND date(cp.responded_at) ${between}`,id,from,to);
    const hiredMatches=await n(`SELECT COUNT(*) AS count FROM candidate_pipeline cp JOIN openings o ON o.id=cp.opening_id WHERE o.employer_id=? AND cp.stage='hired' AND date(cp.hired_at) ${between}`,id,from,to);
    const applied=await n(`SELECT COUNT(*) AS count FROM agency_interests ai JOIN agency_organizations ao ON ao.id=ai.organization_id WHERE ao.claimed_employer_id=? AND date(ai.created_at) ${between}`,id,from,to);
    const hiredApps=await n(`SELECT COUNT(*) AS count FROM agency_interests ai JOIN agency_organizations ao ON ao.id=ai.organization_id WHERE ao.claimed_employer_id=? AND ai.agency_stage='hired' AND date(ai.agency_stage_at) ${between}`,id,from,to);
    const views=await n(`SELECT COUNT(*) AS count FROM analytics_events ev WHERE ev.event_type='page_view' AND date(ev.created_at) ${between}
      AND ev.path IN (SELECT '/jobs/'||j.id FROM caregiver_jobs j JOIN agency_organizations ao ON ao.id=j.agency_organization_id WHERE ao.claimed_employer_id=?)`,from,to,id);
    const hired=hiredMatches+hiredApps;
    if(!invited&&!yes&&!applied&&!hired&&!views)continue;
    const recipients=await teamRecipients(env,id,'');
    if(!recipients.length)continue;
    const mail=monthlyResultsEmail({company:clean(e.company_name,200),month:MONTHS[start.getUTCMonth()],views,applied,invited,yes,hired,link:ORIGIN+'/app'});
    try{await env.EMAIL.send({from:FROM,to:recipients,subject:mail.subject,html:mail.html,text:mail.text});sent++}catch{}
  }
  return {sent};
}

/** Sends each new applicant and each caregiver who said yes to the workspace's ATS inbox, once. Locked introductions wait. */
export async function forwardToAts(env:BillingEnv,limit=50){
  if(!env.DB||!env.EMAIL)return {sent:0};
  const employers=await env.DB.prepare("SELECT id,company_name,ats_email,ats_email_set_at FROM employer_leads WHERE status!='disabled' AND COALESCE(ats_email,'')!='' AND ats_email_set_at IS NOT NULL").all<Row>();
  let sent=0;
  for(const e of employers.results||[]){
    if(sent>=limit)break;
    const id=clean(e.id,100),to=clean(e.ats_email,320);
    if(!emailValid(to))continue;
    const locked=await lockedIntroductions(env,id);
    const cols='c.first_name,c.last_name,c.display_name,c.email,c.phone,c.city,c.state,c.zip,c.role,c.certifications';
    const yes=await env.DB.prepare(`SELECT cp.id,o.title,'match' AS kind,NULL AS source,NULL AS note,${cols} FROM candidate_pipeline cp JOIN openings o ON o.id=cp.opening_id JOIN caregivers c ON c.id=cp.caregiver_id
      WHERE o.employer_id=? AND cp.response_value='interested' AND cp.ats_forwarded_at IS NULL AND datetime(cp.responded_at)>=datetime(?) LIMIT ?`).bind(id,e.ats_email_set_at,limit).all<Row>();
    const apps=await env.DB.prepare(`SELECT ai.id,j.title,'application' AS kind,ai.source,ai.caregiver_note AS note,${cols} FROM agency_interests ai JOIN agency_organizations ao ON ao.id=ai.organization_id JOIN caregivers c ON c.id=ai.caregiver_id LEFT JOIN caregiver_jobs j ON j.id=ai.caregiver_job_id
      WHERE ao.claimed_employer_id=? AND ai.ats_forwarded_at IS NULL AND datetime(ai.created_at)>=datetime(?) LIMIT ?`).bind(id,e.ats_email_set_at,limit).all<Row>();
    for(const r of [...(apps.results||[]),...(yes.results||[])]){
      if(sent>=limit)break;
      if(locked.has(clean(r.id,120)))continue;
      const table=r.kind==='application'?'agency_interests':'candidate_pipeline';
      const claimed=await env.DB.prepare(`UPDATE ${table} SET ats_forwarded_at=CURRENT_TIMESTAMP WHERE id=? AND ats_forwarded_at IS NULL`).bind(r.id).run();
      if(Number(claimed.meta?.changes||0)!==1)continue;
      const mail=atsForwardEmail({company:clean(e.company_name,200),title:clean(r.title,200),source:r.kind==='application'?'Applied from '+sourceOf(r.source)+' (CareJoys)':'Said yes to a CareJoys invitation',note:clean(r.note,1000),
        caregiver:{name:nameOf(r),email:clean(r.email,320),phone:clean(r.phone,40),city:clean(r.city,120),state:clean(r.state,20),zip:clean(r.zip,10),role:clean(r.role,80),certifications:clean(r.certifications,300)},
        link:ORIGIN+'/app?tab=candidates'});
      try{await env.EMAIL.send({from:FROM,to,replyTo:clean(r.email,320)||undefined,subject:mail.subject,html:mail.html,text:mail.text});sent++}
      catch{await env.DB.prepare(`UPDATE ${table} SET ats_forwarded_at=NULL WHERE id=?`).bind(r.id).run()}
    }
  }
  return {sent};
}
