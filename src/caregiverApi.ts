import { hourlyPayFloor } from './payPreferences';
import { listText } from './listField';
import { type FeatureEnv, respondToInviteForCaregiver, bookInterviewForCaregiver } from './serverFeatures';
import { freshnessLabel, commuteRadiusMiles } from './matching';
import { boundingBox, haversineMiles, lookupZip, normalizeZip, rowGeo, stateForZip, zipGeoJoin } from './geo';
import { REACHABLE_AGENCY_SQL, createAgencyInterests } from './agencyInbox';
import { caregiverApplicationEmail } from './email';
import { normalizeTitle } from './jobDiscovery';

type Row=Record<string,unknown>;
export type CaregiverIdentity={sub:string;email:string;emailVerified:boolean;name:string};
/** Email sign-ins carry this subject prefix; only real Auth0 subjects are stored on a caregiver. */
export const EMAIL_SUB_PREFIX='email|';
export const auth0SubOf=(identity:CaregiverIdentity|null|undefined)=>identity?.sub&&!identity.sub.startsWith(EMAIL_SUB_PREFIX)?identity.sub:null;

const clean=(v:unknown,max=500)=>typeof v==='string'?v.trim().slice(0,max):'';
const asNum=(v:unknown)=>{const n=Number(v||0);return Number.isFinite(n)?n:0};
const json=(body:unknown,init:ResponseInit={})=>new Response(JSON.stringify(body),{
  ...init,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...(init.headers||{})}
});
const unauthorized=()=>json({ok:false,error:'Sign in required'},{status:401});

/** The caregiver behind an Auth0 identity: by Auth0 subject, or by email only when Auth0 verified it. */
export async function caregiverForIdentity(env:FeatureEnv,identity:CaregiverIdentity|null){
  if(!env.DB||!identity?.sub)return null;
  const bySub=await env.DB.prepare("SELECT id FROM caregivers WHERE auth0_sub=? AND COALESCE(work_status,'') NOT IN ('merged_duplicate','closed') LIMIT 1").bind(identity.sub).first<{id:string}>();
  if(bySub)return bySub.id;
  if(!identity.emailVerified||!identity.email)return null;
  const byEmail=await env.DB.prepare("SELECT id FROM caregivers WHERE lower(trim(email))=? AND COALESCE(work_status,'') NOT IN ('merged_duplicate','closed') LIMIT 1").bind(identity.email).first<{id:string}>();
  if(!byEmail)return null;
  await env.DB.prepare("UPDATE caregivers SET auth0_sub=COALESCE(auth0_sub,?),auth0_email_verified=1,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(auth0SubOf(identity),byEmail.id).run();
  return byEmail.id;
}

const CREDENTIALS=['cna','gna','hha','pca','dsp','cmt','lpn','rn'];
const KEY_LICENSES=new Set(['cna','gna','cmt','lpn','rn']);
const cleanShift=(v:string)=>v.toLowerCase().replace(/[^a-z]+/g,' ');
/** Explicit hard conflicts, never inferred from an unlisted pay/schedule/qualification. */
export function jobConflict(c:Row,j:Row):string|null{
  const mine=credentialsIn([clean(c.role),clean(c.certifications)].join(' ').toLowerCase());
  const titleText=[clean(j.role),clean(j.title)].join(' ').toLowerCase();
  const requirements=credentialsIn(titleText);
  // Mixed-role jobs are acceptable if at least one advertised role matches the candidate.
  const licensed=[...requirements].filter(k=>KEY_LICENSES.has(k));
  if(licensed.length&&!licensed.some(k=>mine.has(k))){
    // For an explicit licensed-only title, never suggest an unqualified candidate.
    const advertised=[...requirements].filter(k=>['cna','gna','hha','pca','dsp','cmt','lpn','rn'].includes(k));
    if(!advertised.some(k=>mine.has(k)))return 'required credential missing';
  }
  const min=Number(c.hourly_rate_min||hourlyPayFloor(c.desired_wage)||0);
  const advertisedMax=Number(j.pay_max||j.pay_min||0);
  if(min>0&&advertisedMax>0&&(!j.pay_period||/hour|hr/i.test(clean(j.pay_period)))&&advertisedMax<min)return 'below minimum hourly pay';
  const wants=clean(c.employment_types).split(',').map(x=>x.trim()).filter(Boolean);
  const offered=clean(j.employment_type).toLowerCase().replace(/[^a-z,]+/g,'_');
  if(wants.length&&offered&&['full_time','part_time','per_diem','temporary','contract'].some(v=>offered.includes(v))&&!wants.some(v=>offered.includes(v)))return 'employment type conflict';
  const shift=cleanShift(clean(c.shift_preferences));
  const jobShift=cleanShift([clean(j.title),clean(j.shift_preferences)].join(' '));
  const labels:{name:string;re:RegExp}[]=[
    {name:'day',re:/\b(day|days|morning|mornings)\b/},
    {name:'evening',re:/\b(evening|evenings|afternoon|afternoons)\b/},
    {name:'night',re:/\b(night|nights|overnight|overnights)\b/}
  ];
  const candidate=labels.filter(x=>x.re.test(shift)).map(x=>x.name);
  const advertised=labels.filter(x=>x.re.test(jobShift)).map(x=>x.name);
  if(candidate.length&&advertised.length&&!candidate.some(v=>advertised.includes(v)))return 'shift conflict';
  const weekendsOnly=/\bweekends? only\b/.test(shift);
  const jobWeekdaysOnly=/\bweekdays? only\b/.test(jobShift)||/\bmonday (through|to|-) friday\b/.test(jobShift);
  if(weekendsOnly&&jobWeekdaysOnly)return 'schedule conflict';
  return null;
}
const LICENSED=['cna','gna','cmt','lpn','rn'];
const credentialsIn=(text:string)=>new Set(CREDENTIALS.filter(k=>new RegExp('\\b'+k+'\\b').test(text)));

/** How well a job fits a caregiver (higher is better): credentials first, then pay, distance, hours and freshness. */
export function jobFit(c:Row,j:Row,distanceMiles:number|null,radius:number,now=Date.now()){
  if(jobConflict(c,j))return -100000;
  let score=0;
  const mine=credentialsIn([clean(c.role),clean(c.certifications)].join(' ').toLowerCase());
  const jobText=[clean(j.role),clean(j.title)].join(' ').toLowerCase();
  const needs=credentialsIn(jobText);
  if([...needs].some(k=>mine.has(k)))score+=40;
  else if([...needs].some(k=>LICENSED.includes(k)))score-=30;
  else score+=20;
  const myMin=Number(c.hourly_rate_min||hourlyPayFloor(c.desired_wage)||0);
  const jobTop=Number(j.pay_max||j.pay_min||0);
  const hourly=!clean(j.pay_period)||/hour/i.test(clean(j.pay_period));
  if(myMin>0&&jobTop>0&&hourly)score+=jobTop>=myMin?15:-15;
  if(distanceMiles!==null)score+=Math.round(25*Math.max(0,1-distanceMiles/Math.max(radius,1)));
  const wantHours=clean(c.employment_types).split(',').filter(Boolean);
  const jobHours=clean(j.employment_type).toLowerCase().replace(/[^a-z]+/g,'_');
  if(wantHours.length&&jobHours&&wantHours.some(h=>jobHours.includes(h)))score+=5;
  const posted=Date.parse(clean(j.date_posted)||clean(j.last_seen_at));
  if(Number.isFinite(posted)){const days=(now-posted)/86400000;score+=days<=7?10:days<=30?5:0}
  return score;
}

/** Current published jobs within the caregiver's commute radius (or their state when the ZIP has no centroid), best fit first. */
export async function nearbyJobsFor(env:FeatureEnv,c:Row,limit:number){
  if(!env.DB)return [];
  const geo=rowGeo(c);
  const radius=commuteRadiusMiles(c);
  let jobsSql=`SELECT j.id,j.title,j.role,j.employer_name,j.city,j.state,j.pay_min,j.pay_max,j.pay_period,j.employment_type,j.date_posted,j.last_seen_at,o.claimed_employer_id,zg.lat AS geo_lat,zg.lng AS geo_lng
    FROM caregiver_jobs j LEFT JOIN agency_organizations o ON o.id=j.agency_organization_id AND o.is_active=1 AND COALESCE(o.is_test,0)=0 ${zipGeoJoin('j')} WHERE j.is_published=1 AND j.status='current'`;
  const jobArgs:unknown[]=[];
  if(geo){
    const box=boundingBox(geo,radius);
    jobsSql+=' AND zg.lat BETWEEN ? AND ? AND zg.lng BETWEEN ? AND ?';jobArgs.push(box.minLat,box.maxLat,box.minLng,box.maxLng);
  }else if(clean(c.state)){jobsSql+=' AND j.state=?';jobArgs.push(clean(c.state))}
  jobsSql+=" ORDER BY CASE WHEN j.date_posted IS NULL OR j.date_posted='' THEN 1 ELSE 0 END,j.date_posted DESC,j.last_seen_at DESC LIMIT 200";
  const jobRows=await env.DB.prepare(jobsSql).bind(...jobArgs).all<Row>();
  return (jobRows.results||[]).filter(j=>!jobConflict(c,j)).map((j,i)=>{const g=rowGeo(j);const d=geo&&g?haversineMiles(geo,g):null;return {j,d,i,fit:jobFit(c,j,d,radius)}})
    .filter(x=>!geo||(x.d!==null&&x.d<=radius))
    .sort((a,b)=>b.fit-a.fit||a.i-b.i).slice(0,limit)
    .map(({j,d})=>({id:j.id,title:normalizeTitle(j.title),employerName:j.employer_name,city:j.city,state:j.state,payMin:j.pay_min,payMax:j.pay_max,payPeriod:j.pay_period,datePosted:j.date_posted,employerOnCareJoys:!!clean(j.claimed_employer_id),distanceMiles:d===null?null:Math.round(d*10)/10}));
}

export async function getCaregiverDashboard(env:FeatureEnv,identity:CaregiverIdentity|null){
  if(!identity)return unauthorized();
  if(!env.DB)return json({ok:false,error:'Database not configured'},{status:503});
  const caregiverId=await caregiverForIdentity(env,identity);
  if(!caregiverId)return json({ok:true,caregiver:null});
  const c=await env.DB.prepare(`SELECT c.*,zg.lat AS geo_lat,zg.lng AS geo_lng FROM caregivers c ${zipGeoJoin('c')} WHERE c.id=? LIMIT 1`).bind(caregiverId).first<Row>();
  if(!c)return json({ok:true,caregiver:null});
  // Viewing a dashboard is not an availability confirmation.

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

  const nearbyJobs=await nearbyJobsFor(env,c,12);

  // One row per job: whether they applied with their CareJoys profile, and whether that employer reads CareJoys.
  const applications=await env.DB.prepare(`SELECT j.id AS job_id,j.title,j.employer_name,j.source_url,MAX(a.created_at) AS created_at,
      MAX(CASE WHEN a.event_type='carejoys_applied' THEN 1 ELSE 0 END) AS applied_on_carejoys,
      MAX(CASE WHEN a.event_type='external_redirect_clicked' THEN 1 ELSE 0 END) AS opened_employer_site,
      MAX(CASE WHEN a.event_type='agent_submitted' THEN 1 ELSE 0 END) AS submitted_on_employer_site,
      MAX(CASE WHEN o.claimed_employer_id IS NOT NULL THEN 1 ELSE 0 END) AS employer_on_carejoys
    FROM caregiver_job_apply_events a JOIN caregiver_jobs j ON j.id=a.caregiver_job_id
    LEFT JOIN agency_organizations o ON o.id=j.agency_organization_id
    WHERE a.caregiver_id=? GROUP BY j.id ORDER BY MAX(a.created_at) DESC LIMIT 20`).bind(caregiverId).all<Row>();

  const resumeFile=await env.DB.prepare('SELECT file_name,byte_size,updated_at FROM caregiver_resume_files WHERE caregiver_id=? LIMIT 1').bind(caregiverId).first<Row>();

  return json({ok:true,resume:resumeFile?{fileName:resumeFile.file_name,byteSize:resumeFile.byte_size,updatedAt:resumeFile.updated_at}:null,caregiver:{
    id:c.id,firstName:c.first_name,lastName:c.last_name,email:c.email,city:c.city,state:c.state,zip:c.zip,role:c.role,
    certifications:listText(c.certifications),specialties:listText(c.specialties),languages:listText(c.languages),yearsExperience:c.years_experience,phone:c.phone,
    shifts:c.shift_preferences,desiredWage:c.desired_wage,transportation:c.transportation,travelMiles:c.travel_distance_miles,
    profilePhotoUrl:c.profile_photo_url,workStatus:c.work_status,lastConfirmedAt:c.last_confirmed_at,
    freshness:freshnessLabel(c.work_status,c.last_confirmed_at),bio:c.bio,
    availability:parseAvailability(c.availability_json),employmentTypes:listOf(c.employment_types),startAvailability:c.start_availability,
    careSettings:listOf(c.care_settings),preferredSettings:listOf(c.preferred_settings),workConditions:listOf(c.work_conditions),licenseNumber:c.license_number,licenseState:c.license_state
  },
  invites:(invites.results||[]).map(r=>({
    id:r.id,stage:r.stage,response:r.response_value,contactedAt:r.contacted_at,interviewAt:r.interview_at,interviewBooked:!!r.interview_booked_at,
    company:r.company_name,title:r.title,role:r.role,city:r.city,state:r.state,payMin:r.pay_min,payMax:r.pay_max,shifts:r.shift_preferences,requirements:r.requirements,
    slots:(slotsByOpening[clean(r.opening_id,100)]||[]).map(s=>({id:s.id,startsAt:s.starts_at,durationMinutes:s.duration_minutes,timezone:s.timezone}))
  })),
  nearbyJobs,
  applications:(applications.results||[]).map(a=>({jobId:a.job_id,title:a.title,employerName:a.employer_name,at:a.created_at,applicationUrl:a.source_url,
    appliedOnCareJoys:asNum(a.applied_on_carejoys)===1,openedEmployerSite:asNum(a.opened_employer_site)===1,submittedOnEmployerSite:asNum(a.submitted_on_employer_site)===1,employerOnCareJoys:asNum(a.employer_on_carejoys)===1}))});
}

/**
 * One-click Apply for a signed-in caregiver: records the application on CareJoys, puts their profile in the
 * employer's CareJoys Inbox when the employer can receive it, and emails the caregiver a receipt. Employers that
 * haven't claimed their CareJoys listing only hear about it once outreach is on, so the caregiver is also given
 * the employer's own application link.
 */
export async function applyWithProfile(env:FeatureEnv,identity:CaregiverIdentity|null,jobId:string){
  if(!identity)return unauthorized();
  if(!env.DB)return json({ok:false,error:'Database not configured'},{status:503});
  const caregiverId=await caregiverForIdentity(env,identity);
  if(!caregiverId)return json({ok:false,error:'Add your resume first.',needsProfile:true},{status:404});
  const result=await recordCareJoysApplication(env,caregiverId,jobId,{submittedOnEmployerSite:false});
  if(!result)return json({ok:false,error:'This job is no longer open.'},{status:404});
  return json({ok:true,...result},{status:result.status==='applied'?201:200});
}

/**
 * Records a caregiver's application once per job: the dashboard row, the employer's CareJoys Inbox when the
 * employer can receive it, and an email receipt. Also used after "Apply for me" submits on the employer's site.
 */
export async function recordCareJoysApplication(env:FeatureEnv,caregiverId:string,jobId:string,opts:{submittedOnEmployerSite:boolean}){
  const job=await env.DB!.prepare(`SELECT j.id,j.title AS title,j.employer_name,j.source_url,j.agency_organization_id,
      o.claimed_employer_id,${REACHABLE_AGENCY_SQL} AS reachable
    FROM caregiver_jobs j LEFT JOIN agency_organizations o ON o.id=j.agency_organization_id AND o.is_active=1 AND COALESCE(o.is_test,0)=0
    WHERE j.id=? AND j.is_published=1 AND j.status='current' LIMIT 1`).bind(jobId).first<Row>();
  if(!job)return null;
  const employerOnCareJoys=!!clean(job.claimed_employer_id,120);
  const applicationUrl=clean(job.source_url,1000);
  if(opts.submittedOnEmployerSite){
    await env.DB!.prepare("INSERT INTO caregiver_job_apply_events(id,caregiver_job_id,caregiver_id,event_type,source) VALUES (?,?,?,'agent_submitted','apply_for_me')")
      .bind(crypto.randomUUID(),jobId,caregiverId).run();
  }
  const already=await env.DB!.prepare("SELECT 1 AS hit FROM caregiver_job_apply_events WHERE caregiver_id=? AND caregiver_job_id=? AND event_type='carejoys_applied' LIMIT 1")
    .bind(caregiverId,jobId).first();
  const result={status:(already?'already_applied':'applied') as 'applied'|'already_applied',employerOnCareJoys,employerName:clean(job.employer_name,200),applicationUrl};
  if(already&&!opts.submittedOnEmployerSite)return result;

  if(!already){
    await env.DB!.prepare("INSERT INTO caregiver_job_apply_events(id,caregiver_job_id,caregiver_id,event_type,source) VALUES (?,?,?,'carejoys_applied','carejoys_profile')")
      .bind(crypto.randomUUID(),jobId,caregiverId).run();
    const orgId=clean(job.agency_organization_id,120);
    if(orgId&&asNum(job.reachable)){
      await createAgencyInterests(env,{caregiverId,source:'job_apply',targets:[{organizationId:orgId,agencyName:clean(job.employer_name,200),city:'',state:'',jobId,jobTitle:clean(job.title,200)}]});
    }
  }
  const c=await env.DB!.prepare('SELECT first_name,email FROM caregivers WHERE id=? LIMIT 1').bind(caregiverId).first<Row>();
  const to=clean(c?.email,320).toLowerCase();
  if(env.EMAIL&&/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)){
    const body=caregiverApplicationEmail({firstName:clean(c?.first_name,80),jobTitle:clean(job.title,200),employerName:clean(job.employer_name,200),
      employerOnCareJoys,applicationUrl,dashboardLink:'https://carejoys.com/dashboard',submittedOnEmployerSite:opts.submittedOnEmployerSite});
    await env.EMAIL.send({from:'CareJoys <hello@carejoys.com>',to,subject:body.subject,html:body.html,text:body.text}).catch(()=>null);
  }
  return result;
}

const WORK_STATUSES=['actively_looking','maybe_later','not_looking'];

// The weekly availability grid: which blocks of which days a caregiver can work, plus live-in.
export const DAYS=['mon','tue','wed','thu','fri','sat','sun'] as const;
export const BLOCKS=['morning','afternoon','evening','overnight'] as const;
type Availability={days:Record<string,string[]>;liveIn:boolean};
const listOf=(v:unknown)=>clean(v,2000).split(',').map(x=>x.trim()).filter(Boolean);
function parseAvailability(v:unknown):Availability{
  let raw:any=null;
  try{raw=JSON.parse(clean(v,4000)||'null')}catch{raw=null}
  const days:Record<string,string[]>={};
  for(const d of DAYS){const blocks=Array.isArray(raw?.days?.[d])?raw.days[d]:[];days[d]=BLOCKS.filter(b=>blocks.includes(b))}
  return {days,liveIn:raw?.liveIn===true};
}
/** Plain-words summary of the grid, kept in shift_preferences so matching and employers read it as before. */
export function availabilitySummary(a:Availability){
  const label:Record<string,string>={morning:'Mornings',afternoon:'Afternoons',evening:'Evenings',overnight:'Overnights'};
  const parts=BLOCKS.filter(b=>DAYS.some(d=>a.days[d].includes(b))).map(b=>label[b]);
  const weekdays=DAYS.slice(0,5).some(d=>a.days[d].length),weekends=a.days.sat.length>0||a.days.sun.length>0;
  if(weekends&&!weekdays)parts.push('Weekends only');else if(weekends)parts.push('Weekends');
  if(a.liveIn)parts.push('Live-in');
  return parts.join(', ');
}

/** The full caregiver profile editor at /dashboard/profile. Saving also counts as confirming they're available. */
export async function updateCaregiverProfile(request:Request,env:FeatureEnv,identity:CaregiverIdentity|null,rematch:(caregiverId:string)=>Promise<number>){
  if(!identity)return unauthorized();
  if(!env.DB)return json({ok:false,error:'Database not configured'},{status:503});
  const caregiverId=await caregiverForIdentity(env,identity);
  if(!caregiverId)return unauthorized();
  const d=await request.json().catch(()=>null) as Row|null;
  const first=clean(d?.firstName,120),last=clean(d?.lastName,120);
  if(!first||!last)return json({ok:false,error:'Enter your first and last name'},{status:400});
  const phoneDigits=clean(d?.phone,40).replace(/\D/g,'');
  if(phoneDigits&&!(phoneDigits.length===10||(phoneDigits.length===11&&phoneDigits.startsWith('1'))))return json({ok:false,error:'Enter a 10-digit mobile phone number'},{status:400});
  const zip=normalizeZip(d?.zip);
  if(!zip)return json({ok:false,error:'Enter a valid 5-digit ZIP code'},{status:400});
  const zipInfo=await lookupZip(env.DB,zip);
  const state=zipInfo?.state||await stateForZip(env.DB,zip);
  const pick=(v:unknown,allowed:readonly string[])=>(Array.isArray(v)?v:[]).map(x=>clean(x,60)).filter(x=>allowed.includes(x));
  const freeList=(v:unknown,max=40)=>[...new Set((Array.isArray(v)?v:[]).map(x=>clean(x,80)).filter(Boolean))].slice(0,max).join(', ');
  const availability=parseAvailability(JSON.stringify(d?.availability||{}));
  const workStatus=WORK_STATUSES.includes(clean(d?.workStatus,40))?clean(d?.workStatus,40):'actively_looking';
  const years=Math.max(0,Math.min(60,asNum(d?.yearsExperience)));
  const travel=Math.max(0,Math.min(100,asNum(d?.travelMiles)));
  const payMin=Math.max(0,Math.min(200,asNum(d?.payMin)));
  await env.DB.prepare(`UPDATE caregivers SET first_name=?,last_name=?,display_name=?,phone=COALESCE(NULLIF(?,''),phone),zip=?,city=COALESCE(NULLIF(?,''),city),state=COALESCE(NULLIF(?,''),state),
      role=?,certifications=?,license_number=?,license_state=?,years_experience=?,specialties=?,care_settings=?,preferred_settings=?,languages=?,bio=?,
      availability_json=?,shift_preferences=?,employment_types=?,start_availability=?,work_conditions=?,
      hourly_rate_min=?,desired_wage=?,transportation=?,travel_distance_miles=?,
      work_status=?,is_active=?,last_confirmed_at=CURRENT_TIMESTAMP,profile_updated_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .bind(first,last,(first+' '+last).trim(),clean(d?.phone,40),zip,zipInfo?.city||'',state||'',
      clean(d?.role,80)||'Caregiver',freeList(d?.certifications),clean(d?.licenseNumber,60),clean(d?.licenseState,2).toUpperCase(),years||null,
      freeList(d?.specialties),freeList(d?.careSettings),freeList(d?.preferredSettings),freeList(d?.languages),clean(d?.bio,1200),
      JSON.stringify(availability),availabilitySummary(availability),pick(d?.employmentTypes,['full_time','part_time','per_diem']).join(','),
      ['now','2_weeks','1_month','later'].includes(clean(d?.startAvailability,20))?clean(d?.startAvailability,20):null,
      pick(d?.workConditions,['pets','smokers']).join(','),
      payMin||null,payMin?'$'+payMin+'+/hr':'',clean(d?.transportation,80),travel||null,
      workStatus,workStatus==='actively_looking'?1:0,caregiverId).run();
  {
    await env.DB.prepare("INSERT INTO availability_events(id,caregiver_id,status,source,confirmed_at) VALUES (?,?,?,'caregiver_profile',CURRENT_TIMESTAMP)")
      .bind(crypto.randomUUID(),caregiverId,workStatus).run();
  }
  const matchedOpenings=await rematch(caregiverId);
  return json({ok:true,matchedOpenings});
}

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
  const floor=hourlyPayFloor(data?.payMin??data?.desiredWage);
  if(clean(data?.desiredWage)&&floor===null)return json({ok:false,error:'Enter a valid hourly pay minimum.'},{status:400});
  await env.DB.prepare(`UPDATE caregivers SET zip=?,city=COALESCE(NULLIF(?,''),city),state=COALESCE(NULLIF(?,''),state),shift_preferences=?,desired_wage=?,hourly_rate_min=?,travel_distance_miles=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .bind(zip,zipInfo?.city||'',state,clean(data?.shifts,500),floor?'$'+floor+'+/hr':'',floor||null,travel||null,caregiverId).run();
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
