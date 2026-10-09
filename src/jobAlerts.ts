import { caregiverForIdentity, nearbyJobsFor, type CaregiverIdentity } from './caregiverApi';
import { lookupZip } from './geo';
import { isSuppressed, unsubscribeLink } from './emailPreferences';
import { withUnsubscribe, type EmailBinding } from './email';
import { type FeatureEnv } from './serverFeatures';

type Row=Record<string,unknown>;
type AlertEnv=FeatureEnv&{WEEKLY_DIGEST_ENABLED?:string};
const clean=(v:unknown,max=500)=>typeof v==='string'?v.trim().slice(0,max):'';
const json=(body:unknown,init:ResponseInit={})=>new Response(JSON.stringify(body),{
  ...init,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...(init.headers||{})}
});
const esc=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]||c));

/** Anonymous job preview. Does not read or store visitor identity. */
export async function previewPublicJobs(url:URL,env:FeatureEnv){
  if(!env.DB)return json({ok:false,error:'Jobs are temporarily unavailable.'},{status:503});
  const zip=clean(url.searchParams.get('zip'),5);
  if(!/^\d{5}$/.test(zip))return json({ok:false,error:'Enter a five-digit ZIP code.'},{status:400});
  const geo=await lookupZip(env.DB,zip);
  if(!geo)return json({ok:true,jobs:[],total:0});
  const role=clean(url.searchParams.get('role'),30);
  const allowed=['Caregiver','CNA','GNA','HHA','PCA','DSP'];
  if(!allowed.includes(role))return json({ok:false,error:'Choose a caregiver role.'},{status:400});
  const min=Math.min(100,Math.max(0,Number(url.searchParams.get('payMin')||0)||0));
  const shift=clean(url.searchParams.get('shifts'),30).toLowerCase();
  const shifts=['days','evenings','nights','weekends'].includes(shift)?shift:'';
  const candidate:Row={role,certifications:role,zip,state:geo.state,city:geo.city,geo_lat:geo.lat,geo_lng:geo.lng,
    hourly_rate_min:min,shift_preferences:shifts,travel_distance_miles:25,employment_types:''};
  const jobs=await nearbyJobsFor(env,candidate,3);
  return json({ok:true,jobs,total:jobs.length},{headers:{'cache-control':'public,max-age=60'}});
}

/** Resume signup checkbox: never opt anyone in unless they explicitly checked it. */
export async function setInitialJobAlertOptIn(env:FeatureEnv,caregiverId:string,consented:unknown){
  if(!env.DB||consented!==true)return;
  await env.DB.prepare(`INSERT INTO caregiver_job_alert_preferences(caregiver_id,email_enabled) VALUES (?,1)
    ON CONFLICT(caregiver_id) DO UPDATE SET email_enabled=1,updated_at=CURRENT_TIMESTAMP`).bind(caregiverId).run();
}

export async function caregiverAlertSettings(request:Request,env:FeatureEnv,identity:CaregiverIdentity|null){
  if(!env.DB)return json({ok:false,error:'Database unavailable.'},{status:503});
  const id=await caregiverForIdentity(env,identity);
  if(!id)return json({ok:false,error:'Sign in to manage job emails.'},{status:401});
  if(request.method==='GET'){
    const row=await env.DB.prepare('SELECT email_enabled,last_sent_at FROM caregiver_job_alert_preferences WHERE caregiver_id=?').bind(id).first<Row>();
    return json({ok:true,emailEnabled:Number(row?.email_enabled||0)===1,lastSentAt:row?.last_sent_at||null});
  }
  const data=await request.json().catch(()=>null) as Row|null;
  if(typeof data?.emailEnabled!=='boolean')return json({ok:false,error:'Choose whether to receive job emails.'},{status:400});
  const enabled=data.emailEnabled?1:0;
  await env.DB.prepare(`INSERT INTO caregiver_job_alert_preferences(caregiver_id,email_enabled) VALUES (?,?)
    ON CONFLICT(caregiver_id) DO UPDATE SET email_enabled=excluded.email_enabled,updated_at=CURRENT_TIMESTAMP`).bind(id,enabled).run();
  return json({ok:true,emailEnabled:enabled===1});
}

function emailBody(firstName:string,jobs:Awaited<ReturnType<typeof nearbyJobsFor>>){
  const greeting=esc(firstName||'there');
  const lines=jobs.map(j=>{
    const url='https://carejoys.com/jobs/'+encodeURIComponent(String(j.id));
    const location=esc([j.city,j.state].filter(Boolean).map(String).join(', '));
    const pay=j.payMax&&j.payPeriod==='hour'?' · up to $'+j.payMax+'/hr':'';
    return '<li style="margin:0 0 20px"><a href="'+esc(url)+'" style="color:#4255ff;font-weight:bold">'+esc(String(j.title||''))+'</a><div style="color:#686078">'+esc(String(j.employerName||'Employer'))+' · '+location+esc(pay)+'</div></li>';
  }).join('');
  const html='<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#1b153c"><h1>New jobs worth a look</h1><p>Hi '+greeting+', here are caregiver opportunities that fit the location and career details in your CareJoys profile.</p><ul style="padding-left:20px">'+lines+'</ul><p><a href="https://carejoys.com/dashboard">Update your job preferences</a></p><p style="font-size:13px">Pay, schedule and openings can change. Confirm details with each employer. This email is free and optional.</p></div>';
  const text='Hi '+(firstName||'there')+',\n\nYour CareJoys job matches:\n\n'+jobs.map(j=>j.title+' — '+(j.employerName||'Employer')+' ('+[j.city,j.state].filter(Boolean).join(', ')+')\nhttps://carejoys.com/jobs/'+encodeURIComponent(String(j.id))).join('\n\n')+'\n\nUpdate preferences: https://carejoys.com/dashboard';
  return {subject:'Your weekly CareJoys caregiver job matches',html,text};
}

/** Daily small batch; each opted-in caregiver can receive at most one digest per seven days.
 * No messages to historical records, no speculative matches, and no duplicates of a prior digest.
 */
export async function sendWeeklyJobDigests(env:AlertEnv,limit=50){
  if(!env.DB||!env.EMAIL||env.WEEKLY_DIGEST_ENABLED!=='true')return {sent:0,skipped:0,disabled:true};
  const due=await env.DB.prepare(`SELECT c.*,zg.lat AS geo_lat,zg.lng AS geo_lng
    FROM caregiver_job_alert_preferences p JOIN caregivers c ON c.id=p.caregiver_id
    LEFT JOIN zip_geo zg ON zg.zip=substr(trim(COALESCE(c.zip,'')),1,5)
    WHERE p.email_enabled=1 AND c.auth0_email_verified=1 AND c.email IS NOT NULL AND c.email!=''
    AND COALESCE(c.work_status,'') NOT IN ('closed','merged_duplicate')
    AND (p.last_sent_at IS NULL OR datetime(p.last_sent_at)<=datetime('now','-7 days'))
    ORDER BY COALESCE(p.last_sent_at,'') ASC,c.created_at ASC LIMIT ?`).bind(Math.max(1,Math.min(limit,100))).all<Row>();
  let sent=0,skipped=0;
  for(const c of due.results||[]){
    const email=clean(c.email,320).toLowerCase(),id=clean(c.id,120);
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||await isSuppressed(env.DB,email)){skipped++;continue;}
    const jobs=await nearbyJobsFor(env,c,5);
    if(!jobs.length){skipped++;continue;}
    const signature=jobs.map(j=>j.id).join('|');
    const existing=await env.DB.prepare('SELECT last_jobs_signature FROM caregiver_job_alert_preferences WHERE caregiver_id=? AND email_enabled=1').bind(id).first<Row>();
    if(!existing||existing.last_jobs_signature===signature){skipped++;continue;}
    const content=emailBody(clean(c.first_name,60),jobs);
    const unsubscribe=await unsubscribeLink(env.DB,email,'weekly_job_digest');
    const body=withUnsubscribe(content,unsubscribe.link);
    try{
      await (env.EMAIL as EmailBinding).send({from:'CareJoys <updates@carejoys.com>',to:email,subject:body.subject,html:body.html,text:body.text,headers:unsubscribe.headers});
      await env.DB.prepare('UPDATE caregiver_job_alert_preferences SET last_sent_at=CURRENT_TIMESTAMP,last_jobs_signature=?,updated_at=CURRENT_TIMESTAMP WHERE caregiver_id=? AND email_enabled=1').bind(signature,id).run();
      sent++;
    }catch(error){console.error('weekly digest send failed',id,error);skipped++;}
  }
  return {sent,skipped,disabled:false};
}
