import { type FeatureEnv, respondToInviteForCaregiver, bookInterviewForCaregiver } from './serverFeatures';
import { freshnessLabel, commuteRadiusMiles } from './matching';
import { boundingBox, haversineMiles, lookupZip, normalizeZip, rowGeo, stateForZip, zipGeoJoin } from './geo';

type Row=Record<string,unknown>;
export type CaregiverIdentity={sub:string;email:string;emailVerified:boolean;name:string};

const clean=(v:unknown,max=500)=>typeof v==='string'?v.trim().slice(0,max):'';
const asNum=(v:unknown)=>{const n=Number(v||0);return Number.isFinite(n)?n:0};
const json=(body:unknown,init:ResponseInit={})=>new Response(JSON.stringify(body),{
  ...init,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...(init.headers||{})}
});
const unauthorized=()=>json({ok:false,error:'Sign in required'},{status:401});

/** The caregiver behind an Auth0 identity: by Auth0 subject, or by email only when Auth0 verified it. */
export async function caregiverForIdentity(env:FeatureEnv,identity:CaregiverIdentity|null){
  if(!env.DB||!identity?.sub)return null;
  const bySub=await env.DB.prepare("SELECT id FROM caregivers WHERE auth0_sub=? AND COALESCE(work_status,'')!='merged_duplicate' LIMIT 1").bind(identity.sub).first<{id:string}>();
  if(bySub)return bySub.id;
  if(!identity.emailVerified||!identity.email)return null;
  const byEmail=await env.DB.prepare("SELECT id FROM caregivers WHERE lower(trim(email))=? LIMIT 1").bind(identity.email).first<{id:string}>();
  if(!byEmail)return null;
  await env.DB.prepare("UPDATE caregivers SET auth0_sub=COALESCE(auth0_sub,?),auth0_email_verified=1,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(identity.sub,byEmail.id).run();
  return byEmail.id;
}

export async function getCaregiverDashboard(env:FeatureEnv,identity:CaregiverIdentity|null){
  if(!identity)return unauthorized();
  if(!env.DB)return json({ok:false,error:'Database not configured'},{status:503});
  const caregiverId=await caregiverForIdentity(env,identity);
  if(!caregiverId)return json({ok:true,caregiver:null});
  const c=await env.DB.prepare(`SELECT c.*,zg.lat AS geo_lat,zg.lng AS geo_lng FROM caregivers c ${zipGeoJoin('c')} WHERE c.id=? LIMIT 1`).bind(caregiverId).first<Row>();
  if(!c)return json({ok:true,caregiver:null});

  const invites=await env.DB.prepare(`SELECT cp.id,cp.stage,cp.response_value,cp.contacted_at,cp.interview_at,cp.interview_booked_at,cp.opening_id,
      o.title,o.role,o.city,o.state,o.pay_min,o.pay_max,o.shift_preferences,o.requirements,e.company_name
    FROM candidate_pipeline cp JOIN openings o ON o.id=cp.opening_id JOIN employer_leads e ON e.id=o.employer_id
    WHERE cp.caregiver_id=? AND cp.contacted_at IS NOT NULL
    ORDER BY COALESCE(cp.interview_at,cp.contacted_at) DESC LIMIT 50`).bind(caregiverId).all<Row>();
  const needsSlots=(invites.results||[]).filter(r=>r.response_value==='interested'&&!r.interview_booked_at).map(r=>clean(r.opening_id,100));
  const slotsByOpening:Record<string,Row[]>={};
  for(const openingId of [...new Set(needsSlots)]){
    const slots=await env.DB.prepare("SELECT id,starts_at,duration_minutes,timezone FROM interview_slots WHERE opening_id=? AND status='available' AND datetime(starts_at)>datetime('now') ORDER BY starts_at LIMIT 10").bind(openingId).all<Row>();
    slotsByOpening[openingId]=slots.results||[];
  }

  const geo=rowGeo(c);
  const radius=commuteRadiusMiles(c);
  let jobsSql=`SELECT j.id,j.title,j.employer_name,j.city,j.state,j.pay_min,j.pay_max,j.pay_period,j.date_posted,zg.lat AS geo_lat,zg.lng AS geo_lng
    FROM caregiver_jobs j ${zipGeoJoin('j')} WHERE j.is_published=1 AND j.status='current'`;
  const jobArgs:unknown[]=[];
  if(geo){
    const box=boundingBox(geo,radius);
    jobsSql+=' AND zg.lat BETWEEN ? AND ? AND zg.lng BETWEEN ? AND ?';jobArgs.push(box.minLat,box.maxLat,box.minLng,box.maxLng);
  }else if(clean(c.state)){jobsSql+=' AND j.state=?';jobArgs.push(clean(c.state))}
  jobsSql+=" ORDER BY CASE WHEN j.date_posted IS NULL OR j.date_posted='' THEN 1 ELSE 0 END,j.date_posted DESC,j.last_seen_at DESC LIMIT 60";
  const jobRows=await env.DB.prepare(jobsSql).bind(...jobArgs).all<Row>();
  const nearbyJobs=(jobRows.results||[]).map(j=>{const g=rowGeo(j);return {j,d:geo&&g?haversineMiles(geo,g):null}})
    .filter(x=>!geo||(x.d!==null&&x.d<=radius)).slice(0,12)
    .map(({j,d})=>({id:j.id,title:j.title,employerName:j.employer_name,city:j.city,state:j.state,payMin:j.pay_min,payMax:j.pay_max,payPeriod:j.pay_period,datePosted:j.date_posted,distanceMiles:d===null?null:Math.round(d*10)/10}));

  const applications=await env.DB.prepare(`SELECT a.event_type,a.created_at,j.id AS job_id,j.title,j.employer_name,j.source_url
    FROM caregiver_job_apply_events a JOIN caregiver_jobs j ON j.id=a.caregiver_job_id
    WHERE a.caregiver_id=? ORDER BY a.created_at DESC LIMIT 20`).bind(caregiverId).all<Row>();

  return json({ok:true,caregiver:{
    id:c.id,firstName:c.first_name,lastName:c.last_name,email:c.email,city:c.city,state:c.state,zip:c.zip,role:c.role,
    certifications:c.certifications,shifts:c.shift_preferences,desiredWage:c.desired_wage,travelMiles:c.travel_distance_miles,
    profilePhotoUrl:c.profile_photo_url,workStatus:c.work_status,lastConfirmedAt:c.last_confirmed_at,
    freshness:freshnessLabel(c.work_status,c.last_confirmed_at)
  },
  invites:(invites.results||[]).map(r=>({
    id:r.id,stage:r.stage,response:r.response_value,contactedAt:r.contacted_at,interviewAt:r.interview_at,interviewBooked:!!r.interview_booked_at,
    company:r.company_name,title:r.title,role:r.role,city:r.city,state:r.state,payMin:r.pay_min,payMax:r.pay_max,shifts:r.shift_preferences,requirements:r.requirements,
    slots:(slotsByOpening[clean(r.opening_id,100)]||[]).map(s=>({id:s.id,startsAt:s.starts_at,durationMinutes:s.duration_minutes,timezone:s.timezone}))
  })),
  nearbyJobs,
  applications:(applications.results||[]).map(a=>({jobId:a.job_id,title:a.title,employerName:a.employer_name,event:a.event_type,at:a.created_at,applicationUrl:a.source_url}))});
}

const WORK_STATUSES=['actively_looking','maybe_later','not_looking'];

export async function updateCaregiverAvailability(request:Request,env:FeatureEnv,identity:CaregiverIdentity|null){
  if(!identity)return unauthorized();
  if(!env.DB)return json({ok:false,error:'Database not configured'},{status:503});
  const caregiverId=await caregiverForIdentity(env,identity);
  if(!caregiverId)return unauthorized();
  const data=await request.json().catch(()=>null) as Row|null;
  const workStatus=clean(data?.workStatus,40);
  if(!WORK_STATUSES.includes(workStatus))return json({ok:false,error:'Choose your current work status'},{status:400});
  await env.DB.prepare("UPDATE caregivers SET work_status=?,last_confirmed_at=CURRENT_TIMESTAMP,is_active=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
    .bind(workStatus,workStatus==='actively_looking'?1:0,caregiverId).run();
  await env.DB.prepare("INSERT INTO availability_events(id,caregiver_id,status,source,confirmed_at) VALUES (?,?,?,'caregiver_dashboard',CURRENT_TIMESTAMP)")
    .bind(crypto.randomUUID(),caregiverId,workStatus).run();
  return json({ok:true,workStatus,freshness:freshnessLabel(workStatus,new Date().toISOString())});
}

export async function updateCaregiverPreferences(request:Request,env:FeatureEnv,identity:CaregiverIdentity|null,rematch:(caregiverId:string)=>Promise<number>){
  if(!identity)return unauthorized();
  if(!env.DB)return json({ok:false,error:'Database not configured'},{status:503});
  const caregiverId=await caregiverForIdentity(env,identity);
  if(!caregiverId)return unauthorized();
  const data=await request.json().catch(()=>null) as Row|null;
  const zip=normalizeZip(data?.zip);
  if(!zip)return json({ok:false,error:'Enter a valid 5-digit ZIP code'},{status:400});
  const zipInfo=await lookupZip(env.DB,zip);
  const state=zipInfo?.state||await stateForZip(env.DB,zip);
  const travel=Math.max(0,Math.min(100,asNum(data?.travelMiles)));
  await env.DB.prepare(`UPDATE caregivers SET zip=?,city=COALESCE(NULLIF(?,''),city),state=COALESCE(NULLIF(?,''),state),shift_preferences=?,desired_wage=?,travel_distance_miles=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .bind(zip,zipInfo?.city||'',state,clean(data?.shifts,500),clean(data?.desiredWage,80),travel||null,caregiverId).run();
  const matchedOpenings=await rematch(caregiverId);
  return json({ok:true,matchedOpenings});
}

export async function respondToInvite(request:Request,env:FeatureEnv,identity:CaregiverIdentity|null,pipelineId:string){
  const caregiverId=await caregiverForIdentity(env,identity);
  if(!caregiverId)return unauthorized();
  const data=await request.json().catch(()=>null) as Row|null;
  return respondToInviteForCaregiver(env,caregiverId,pipelineId,data?.choice);
}

export async function bookInviteInterview(request:Request,env:FeatureEnv,identity:CaregiverIdentity|null,pipelineId:string){
  const caregiverId=await caregiverForIdentity(env,identity);
  if(!caregiverId)return unauthorized();
  const data=await request.json().catch(()=>null) as Row|null;
  return bookInterviewForCaregiver(env,caregiverId,pipelineId,data?.slotId);
}
