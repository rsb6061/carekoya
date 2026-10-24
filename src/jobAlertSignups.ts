// One-field job alerts: "Email me new CNA jobs near 21030" on job and city pages. A visitor leaves only an email
// and a ZIP; the first email shows today's jobs and asks them to confirm, and only confirmed addresses get the weekly
// email of jobs first seen since the last one. Rebecca approved sending these 2026-10-23.
import { boundingBox, haversineMiles, lookupZip, rowGeo, zipGeoJoin, DEFAULT_COMMUTE_MILES } from './geo';
import { isSuppressed, unsubscribeLink } from './emailPreferences';
import { jobAlertConfirmEmail, jobAlertEmail, withUnsubscribe, type EmailBinding } from './email';
import { sha256Hex } from './agencyInbox';
import { CNA_JOB_SQL } from './seo';
import { normalizeTitle } from './jobDiscovery';
import { payLabel } from './jobFormat';
import { type FeatureEnv } from './serverFeatures';

type Row=Record<string,unknown>;
export type JobAlertEnv=FeatureEnv&{JOB_ALERTS_ENABLED?:string};
const ORIGIN='https://carejoys.com';
const FROM='CareJoys <hello@carejoys.com>';
const ROLES=['CNA','Caregiver'] as const;
type AlertRole=typeof ROLES[number];
const clean=(v:unknown,max=500)=>typeof v==='string'?v.trim().slice(0,max):'';
const json=(body:unknown,init:ResponseInit={})=>new Response(JSON.stringify(body),{
  ...init,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...(init.headers||{})}
});
const nounFor=(role:AlertRole)=>role==='CNA'?'CNA jobs':'caregiver jobs';
const moreLinkFor=(role:AlertRole,zip:string)=>ORIGIN+(role==='CNA'?'/cna-jobs':'/caregiver-jobs')+'?q='+zip+'#search-results';

/** Published jobs within commuting distance of the ZIP, newest first; `since` keeps only jobs first seen after it. */
async function jobsNear(env:FeatureEnv,zip:string,role:AlertRole,since:string|null,limit:number){
  const geo=await lookupZip(env.DB,zip);
  if(!geo)return {jobs:[],total:0};
  const box=boundingBox(geo,DEFAULT_COMMUTE_MILES);
  const args:unknown[]=[box.minLat,box.maxLat,box.minLng,box.maxLng];
  let sql=`SELECT j.id,j.title,j.employer_name,j.city,j.state,j.pay_min,j.pay_max,j.pay_period,zg.lat AS geo_lat,zg.lng AS geo_lng
    FROM caregiver_jobs j ${zipGeoJoin('j')} WHERE j.is_published=1 AND j.status='current'
    AND zg.lat BETWEEN ? AND ? AND zg.lng BETWEEN ? AND ?`;
  if(role==='CNA')sql+=' AND '+CNA_JOB_SQL.replace(/\b(role|roles_json)\b/g,'j.$1');
  if(since){sql+=' AND datetime(j.first_seen_at)>datetime(?)';args.push(since)}
  sql+=" ORDER BY j.first_seen_at DESC LIMIT 200";
  const rows=((await env.DB!.prepare(sql).bind(...args).all<Row>()).results||[])
    .filter(j=>{const g=rowGeo(j);return !!g&&haversineMiles(geo,g)<=DEFAULT_COMMUTE_MILES});
  return {
    total:rows.length,
    jobs:rows.slice(0,limit).map(j=>({
      title:normalizeTitle(clean(j.title,200)),employerName:clean(j.employer_name,200),
      place:[clean(j.city,80),clean(j.state,2)].filter(Boolean).join(', '),
      pay:payLabel({payMin:j.pay_min,payMax:j.pay_max,payPeriod:j.pay_period})||'',
      url:ORIGIN+'/jobs/'+encodeURIComponent(clean(j.id,120))
    }))
  };
}

/** POST /api/public/job-alerts {email,zip,role,source}: saves the signup and sends the confirm email. */
export async function handleJobAlertSignup(request:Request,env:JobAlertEnv){
  if(!env.DB)return json({ok:false,error:'Job alerts are temporarily unavailable.'},{status:503});
  const data=await request.json().catch(()=>null) as Row|null;
  const email=clean(data?.email,320).toLowerCase();
  const zip=(clean(data?.zip,10).match(/^(\d{5})(?:-\d{4})?$/)||[])[1]||'';
  const role:AlertRole=data?.role==='CNA'?'CNA':'Caregiver';
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return json({ok:false,error:'Enter your email address.'},{status:400});
  if(!zip)return json({ok:false,error:'Enter a five-digit ZIP code.'},{status:400});
  if(!await lookupZip(env.DB,zip))return json({ok:false,error:'We don’t recognize that ZIP code.'},{status:400});
  const ipHash=await sha256Hex('job-alerts:'+(request.headers.get('CF-Connecting-IP')||''));
  // A handful of signups an hour per connection is plenty for a person; more is someone signing up other people.
  const recent=await env.DB.prepare("SELECT COUNT(*) AS n FROM job_alert_signups WHERE ip_hash=? AND datetime(updated_at)>datetime('now','-1 hour')").bind(ipHash).first<{n:number}>();
  if(Number(recent?.n||0)>=5)return json({ok:false,error:'Too many sign-ups from here. Try again in an hour.'},{status:429});

  const existing=await env.DB.prepare('SELECT id,status,confirm_sent_at FROM job_alert_signups WHERE email=? AND zip=? AND role=?').bind(email,zip,role).first<Row>();
  if(existing?.status==='active')return json({ok:true,status:'active'});
  // One confirm email a day per address and ZIP, however often the form is sent.
  const sentToday=existing?.confirm_sent_at&&await env.DB.prepare("SELECT 1 AS hit FROM job_alert_signups WHERE id=? AND datetime(confirm_sent_at)>datetime('now','-1 day')").bind(existing.id).first();
  if(sentToday)return json({ok:true,status:'pending'});
  if(await isSuppressed(env.DB,email))return json({ok:true,status:'pending'});

  const token=crypto.randomUUID()+'-'+crypto.randomUUID();
  const id=clean(existing?.id,120)||crypto.randomUUID();
  const source=clean(data?.source,300);
  await env.DB.prepare(`INSERT INTO job_alert_signups(id,email,zip,role,status,confirm_token_hash,source_path,ip_hash) VALUES (?,?,?,?,'pending',?,?,?)
    ON CONFLICT(email,zip,role) DO UPDATE SET status='pending',confirm_token_hash=excluded.confirm_token_hash,source_path=excluded.source_path,ip_hash=excluded.ip_hash,updated_at=CURRENT_TIMESTAMP`)
    .bind(id,email,zip,role,await sha256Hex(token),source||null,ipHash).run();
  if(!env.EMAIL)return json({ok:true,status:'pending'});
  const {jobs}=await jobsNear(env,zip,role,null,5);
  const unsubscribe=await unsubscribeLink(env.DB,email,'job_alerts');
  const body=withUnsubscribe(jobAlertConfirmEmail({noun:nounFor(role),zip,jobs,confirmLink:ORIGIN+'/api/public/job-alerts/confirm?token='+encodeURIComponent(token),moreLink:moreLinkFor(role,zip)}),unsubscribe.link);
  try{
    await env.EMAIL.send({from:FROM,to:email,subject:body.subject,html:body.html,text:body.text,headers:unsubscribe.headers});
    await env.DB.prepare('UPDATE job_alert_signups SET confirm_sent_at=CURRENT_TIMESTAMP WHERE id=?').bind(id).run();
  }catch(error){
    console.error('job alert confirm send failed',error);
    return json({ok:false,error:'We couldn’t send the email. Try again in a minute.'},{status:502});
  }
  return json({ok:true,status:'pending'});
}

/** GET /api/public/job-alerts/confirm?token=…: turns the alert on and lands on the jobs near that ZIP. */
export async function handleJobAlertConfirm(url:URL,env:JobAlertEnv){
  const token=clean(url.searchParams.get('token'),300);
  const row=token&&env.DB?await env.DB.prepare('SELECT id,zip,role FROM job_alert_signups WHERE confirm_token_hash=? LIMIT 1').bind(await sha256Hex(token)).first<Row>():null;
  if(!row)return Response.redirect(ORIGIN+'/caregiver-jobs?alert=invalid',302);
  await env.DB!.prepare("UPDATE job_alert_signups SET status='active',confirmed_at=COALESCE(confirmed_at,CURRENT_TIMESTAMP),updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(row.id).run();
  const role:AlertRole=row.role==='CNA'?'CNA':'Caregiver';
  return Response.redirect(moreLinkFor(role,clean(row.zip,5)).replace('?q=','?alert=on&q='),302);
}

/** Daily: each confirmed signup gets at most one email a week, and only when new jobs were posted near its ZIP. */
export async function sendJobAlerts(env:JobAlertEnv,limit=100){
  if(!env.DB||!env.EMAIL||env.JOB_ALERTS_ENABLED!=='true')return {sent:0,skipped:0,disabled:true};
  const due=await env.DB.prepare(`SELECT s.id,s.email,s.zip,s.role,COALESCE(s.last_sent_at,s.confirmed_at,s.created_at) AS since FROM job_alert_signups s
    WHERE s.status='active' AND (s.last_sent_at IS NULL OR datetime(s.last_sent_at)<=datetime('now','-7 days'))
    -- A caregiver who already gets the weekly profile digest isn't sent a second weekly email.
    AND NOT EXISTS (SELECT 1 FROM caregivers c JOIN caregiver_job_alert_preferences p ON p.caregiver_id=c.id WHERE lower(trim(c.email))=s.email AND p.email_enabled=1)
    ORDER BY COALESCE(s.last_sent_at,'') ASC LIMIT ?`).bind(Math.max(1,Math.min(limit,200))).all<Row>();
  let sent=0,skipped=0;
  for(const s of due.results||[]){
    const email=clean(s.email,320),zip=clean(s.zip,5),id=clean(s.id,120);
    const role:AlertRole=s.role==='CNA'?'CNA':'Caregiver';
    if(await isSuppressed(env.DB,email)){
      await env.DB.prepare("UPDATE job_alert_signups SET status='unsubscribed',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(id).run();
      skipped++;continue;
    }
    const {jobs,total}=await jobsNear(env,zip,role,clean(s.since,40)||null,6);
    if(!jobs.length){skipped++;continue}
    const unsubscribe=await unsubscribeLink(env.DB,email,'job_alerts');
    const body=withUnsubscribe(jobAlertEmail({noun:nounFor(role),zip,jobs,total,moreLink:moreLinkFor(role,zip),profileLink:ORIGIN+'/signup'}),unsubscribe.link);
    try{
      await (env.EMAIL as EmailBinding).send({from:FROM,to:email,subject:body.subject,html:body.html,text:body.text,headers:unsubscribe.headers});
      await env.DB.prepare('UPDATE job_alert_signups SET last_sent_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(id).run();
      sent++;
    }catch(error){console.error('job alert send failed',id,error);skipped++}
  }
  return {sent,skipped,disabled:false};
}
