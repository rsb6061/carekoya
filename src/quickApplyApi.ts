// Apply with CareJoys in three steps, with no account or resume (the Augusta pattern): contact details and ZIP, then
// tap-to-answer questions (ours plus the agency's own), then the result. An agency on CareJoys gets the application at
// once with a grade and the answers, and the applicant can book one of the agency's interview times on the spot. An
// employer that isn't on CareJoys gets nothing from us; the applicant's profile is saved and they finish on its site.
//
// A new email builds a new profile. An email that already has a profile can't be changed or applied with from here
// without signing in, so it gets a sign-in link that comes back to the job.
import { employerSession, publicFormGuard, interviewIcs, type FeatureEnv } from './serverFeatures';
import { recordCareJoysApplication, type CaregiverIdentity } from './caregiverApi';
import { ON_CAREJOYS_SQL } from './agencyApplications';
import { sha256Hex } from './agencyInbox';
import { screeningQuestions, type ScreeningQuestion } from './applicantScreening';
import { haversineMiles, lookupZip } from './geo';
import { sendLoginLink } from './accountAuth';
import { parseChecklist, CHECKLIST } from './checklist';
import { interviewConfirmedEmail } from './email';
import {
  CALL_TIME_OPTIONS, EXPERIENCE_OPTIONS, INTERVIEW_FORMATS, ROLE_OPTIONS, TRANSPORT_OPTIONS, cleanInterviewHours, cleanQuickAnswers,
  employmentTypesFor, gradeApplication, interviewTimeLabel, labelOf, shiftsText, upcomingInterviewTimes, type InterviewHours
} from './quickApplyShared';

type Row=Record<string,unknown>;
const clean=(v:unknown,max=500)=>typeof v==='string'?v.replace(/\s+/g,' ').trim().slice(0,max):'';
const asNum=(v:unknown)=>{const n=Number(v||0);return Number.isFinite(n)?n:0};
const emailValid=(v:string)=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const json=(body:unknown,init:ResponseInit={})=>new Response(JSON.stringify(body),{
  ...init,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...(init.headers||{})}
});
const digits=(v:unknown)=>clean(v,40).replace(/\D/g,'').replace(/^1(?=\d{10}$)/,'');
const phoneLabel=(d:string)=>d.length===10?`${d.slice(0,3)}-${d.slice(3,6)}-${d.slice(6)}`:d;

async function jobFor(env:FeatureEnv,jobId:string){
  return env.DB!.prepare(`SELECT j.id,j.title,j.employer_name,j.zip AS job_zip,j.city,j.state,j.source_url,j.agency_organization_id,
      o.claimed_employer_id,o.application_email,o.zip AS org_zip,${ON_CAREJOYS_SQL} AS on_carejoys
    FROM caregiver_jobs j LEFT JOIN agency_organizations o ON o.id=j.agency_organization_id AND o.is_active=1 AND COALESCE(o.is_test,0)=0
    WHERE j.id=? AND j.is_published=1 AND j.status='current' LIMIT 1`).bind(jobId).first<Row>();
}

/** The agency's own questions, only once it has saved a list (the starter list is a template for calls, not this form). */
async function agencyQuestions(env:FeatureEnv,job:Row):Promise<ScreeningQuestion[]>{
  const employerId=clean(job.claimed_employer_id,100);
  if(!employerId||asNum(job.on_carejoys)!==1)return [];
  const saved=await screeningQuestions(env.DB!,employerId);
  return saved.isDefault?[]:saved.questions;
}

/** Miles from the caregiver's ZIP to the job (or, without a job ZIP, the agency's). */
async function milesFor(env:FeatureEnv,job:Row,zip:string){
  const from=await lookupZip(env.DB,zip);
  const to=await lookupZip(env.DB,clean(job.job_zip,10)||clean(job.org_zip,10));
  return from&&to?Math.round(haversineMiles(from,to)*10)/10:null;
}

/** GET /api/public/caregiver-jobs/:id/apply-form?zip=: the agency's questions and, with a ZIP, how far the job is. */
export async function getApplyForm(url:URL,env:FeatureEnv,jobId:string){
  if(!env.DB)return json({ok:false,error:'Database not configured'},{status:503});
  const job=await jobFor(env,jobId);
  if(!job)return json({ok:false,error:'This job is no longer open.'},{status:404});
  const zip=clean(url.searchParams.get('zip'),5);
  const miles=/^\d{5}$/.test(zip)?await milesFor(env,job,zip):null;
  const questions=await agencyQuestions(env,job);
  return json({ok:true,onCareJoys:asNum(job.on_carejoys)===1,questions,miles});
}

async function interviewHoursFor(env:FeatureEnv,employerId:string):Promise<InterviewHours|null>{
  if(!employerId)return null;
  const row=await env.DB!.prepare('SELECT hours_json FROM agency_interview_hours WHERE employer_id=?').bind(employerId).first<Row>();
  try{return row?cleanInterviewHours(JSON.parse(clean(row.hours_json,2000))):null}catch{return null}
}
async function bookedTimes(env:FeatureEnv,orgId:string){
  const rows=await env.DB!.prepare("SELECT interview_at FROM agency_interests WHERE organization_id=? AND interview_at IS NOT NULL AND datetime(interview_at)>datetime('now')").bind(orgId).all<Row>();
  return new Set((rows.results||[]).map(r=>clean(r.interview_at,40)));
}

export type QuickApplyHooks={
  /** Runs for a brand-new profile: funnel link and agency scoring, the same as the resume signup. */
  newProfile:(caregiverId:string,data:Row)=>Promise<void>;
  issueTokens:(caregiverId:string)=>Promise<{profilePhotoToken:string|null;resumeUploadToken:string|null}>;
};

/** POST /api/apply/:jobId */
export async function quickApply(request:Request,env:FeatureEnv,jobId:string,identity:CaregiverIdentity|null,hooks:QuickApplyHooks){
  if(!env.DB)return json({ok:false,error:'Database not configured'},{status:503});
  const data=await request.json().catch(()=>null) as Row|null;
  if(!data)return json({ok:false,error:'Send the form again.'},{status:400});
  const signedIn=!!identity?.emailVerified;
  const guard=await publicFormGuard(request,env,'quick_apply',data,8,60,signedIn);
  if(guard)return guard;

  const job=await jobFor(env,jobId);
  if(!job)return json({ok:false,error:'This job is no longer open.'},{status:404});
  const first=clean(data.firstName,120),last=clean(data.lastName,120);
  const email=(signedIn?identity!.email:clean(data.email,320)).toLowerCase();
  const phone=digits(data.phone);
  const zip=clean(data.zip,5);
  const role=(ROLE_OPTIONS as readonly string[]).includes(clean(data.role,40))?clean(data.role,40):'';
  const answers=cleanQuickAnswers(data);
  const errors:string[]=[];
  if(!first||!last)errors.push('your first and last name');
  if(!emailValid(email))errors.push('a valid email');
  if(phone.length!==10)errors.push('a 10-digit phone number');
  if(!/^\d{5}$/.test(zip))errors.push('a 5-digit ZIP code');
  if(!role)errors.push('your role');
  if(!answers.workType||!answers.shifts.length||!answers.experience.length||!answers.transportation)errors.push('the quick questions');
  if(errors.length)return json({ok:false,error:'Add '+errors.join(', ')+'.'},{status:400});

  const zipInfo=await lookupZip(env.DB,zip);
  const state=zipInfo?.state||'';
  const existing=await env.DB.prepare('SELECT id,email,auth0_sub FROM caregivers WHERE lower(trim(email))=? LIMIT 1').bind(email).first<Row>();
  // An email with a profile is only applied with by whoever can open that inbox.
  if(existing&&!signedIn){
    await sendLoginLink(env,email,'/apply/'+encodeURIComponent(jobId)).catch(()=>null);
    return json({ok:false,needsSignIn:true,error:'You already have a CareJoys profile. We emailed you a sign-in link: open it and you’ll come back here to apply in one tap.'},{status:409});
  }
  const checklist=parseChecklist(data.checklist);
  const shifts=shiftsText(answers.shifts);
  const experience=answers.experience.join(',');
  // "New and ready to start" with nothing else is no experience; family or work experience counts as some.
  const id=clean(existing?.id,120)||crypto.randomUUID();
  if(!existing){
    await env.DB.prepare(`INSERT INTO caregivers (id,first_name,last_name,display_name,email,phone,zip,city,state,role,shift_preferences,employment_types,transportation,
        checklist,experience_kinds,source,source_detail,work_status,last_confirmed_at,auth0_email_verified)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'quick_apply',?,'actively_looking',CURRENT_TIMESTAMP,?)`)
      .bind(id,first,last,(first+' '+last).trim(),email,phoneLabel(phone),zip,zipInfo?.city||null,state||null,role,shifts,employmentTypesFor(answers.workType),
        answers.transportation,checklist.join(',')||null,experience,'job:'+jobId,signedIn?1:0).run();
    await hooks.newProfile(id,data);
  }else{
    // Signed in with a verified email: the answers refresh their profile.
    await env.DB.prepare(`UPDATE caregivers SET first_name=?,last_name=?,display_name=?,phone=?,zip=?,city=COALESCE(?,city),state=COALESCE(?,state),role=?,
        shift_preferences=?,employment_types=?,transportation=?,checklist=COALESCE(?,checklist),experience_kinds=?,work_status='actively_looking',
        last_confirmed_at=CURRENT_TIMESTAMP,is_active=1,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .bind(first,last,(first+' '+last).trim(),phoneLabel(phone),zip,zipInfo?.city||null,state||null,role,shifts,employmentTypesFor(answers.workType),
        answers.transportation,checklist.join(',')||null,experience,id).run();
  }
  await env.DB.prepare("INSERT INTO caregiver_job_apply_events(id,caregiver_job_id,caregiver_id,event_type,source) VALUES (?,?,?,'quick_apply_submitted','quick_apply')")
    .bind(crypto.randomUUID(),jobId,id).run();
  const tokens=await hooks.issueTokens(id);
  // A new profile's sign-in link: the way back to their dashboard, and it confirms the email.
  if(!existing&&!signedIn)await sendLoginLink(env,email,'/dashboard').catch(()=>null);

  const onCareJoys=asNum(job.on_carejoys)===1;
  const base={ok:true,caregiverId:id,...tokens,employerName:clean(job.employer_name,200),applicationUrl:clean(job.source_url,1000)};
  if(!onCareJoys)return json({...base,status:'not_sent'});

  // The agency's own questions: a knockout answer means the application isn't sent, and the caregiver is told why.
  const questions=await agencyQuestions(env,job);
  const raw=(data.screening&&typeof data.screening==='object'?data.screening:{}) as Row;
  const screening=questions.map(q=>({q,answer:clean(raw[q.id],300)})).map(({q,answer})=>({q,answer:q.type==='yes_no'?(answer==='yes'||answer==='no'?answer:''):answer}));
  const knockouts=screening.filter(s=>s.q.knockout&&s.answer===s.q.knockout).map(s=>s.q.label);
  if(knockouts.length){
    await env.DB.prepare("INSERT INTO caregiver_job_apply_events(id,caregiver_job_id,caregiver_id,event_type,source) VALUES (?,?,?,'quick_apply_knocked_out','quick_apply')")
      .bind(crypto.randomUUID(),jobId,id).run();
    return json({...base,status:'not_a_fit',knockouts});
  }
  const miles=await milesFor(env,job,zip);
  const answered=screening.filter(s=>s.answer).map(s=>({label:s.q.label,answer:s.answer}));
  const graded=gradeApplication({miles,unanswered:screening.filter(s=>s.q.type==='yes_no'&&!s.answer).length,role,transportation:answers.transportation,shifts:answers.shifts,answers:answered});
  const details:[string,string][]=[
    ['Fit',(graded.grade==='qualified'?'Qualified':'Review')+' · '+graded.reason],
    ['Wants',[labelOf([['full_time','Full-time'],['part_time','Part-time'],['either','Full or part-time']],answers.workType||''),shifts].filter(Boolean).join(' · ')],
    ['Experience',answers.experience.map(k=>labelOf(EXPERIENCE_OPTIONS,k)).join('; ')],
    ['Transportation',labelOf(TRANSPORT_OPTIONS,answers.transportation||'')],
    ['Says yes to',checklist.map(k=>CHECKLIST.find(([c])=>c===k)?.[1]||k).join(', ')],
    ...answered.map(a=>[a.label,a.answer] as [string,string])
  ].filter(r=>r[1]) as [string,string][];
  const result=await recordCareJoysApplication(env,id,jobId,{submittedOnEmployerSite:false,application:{screeningJson:JSON.stringify(answered),grade:graded.grade,gradeReason:graded.reason,details}});
  if(!result)return json({ok:false,error:'This job is no longer open.'},{status:404});
  if(result.status==='needs_credential')return json({...base,status:'not_a_fit',knockouts:[],error:result.error});

  // A token the apply page books the interview (or says when suits them) with; kept only as a hash.
  const orgId=clean(job.agency_organization_id,120);
  const token=crypto.randomUUID()+'-'+crypto.randomUUID();
  await env.DB.prepare("UPDATE agency_interests SET booking_token_hash=?,updated_at=CURRENT_TIMESTAMP WHERE organization_id=? AND caregiver_id=? AND job_key=?")
    .bind(await sha256Hex(token),orgId,id,jobId).run();
  const hours=await interviewHoursFor(env,clean(job.claimed_employer_id,100));
  const times=hours?upcomingInterviewTimes(hours,Date.now(),await bookedTimes(env,orgId)):[];
  return json({...base,status:result.status,grade:graded.grade,bookingToken:token,
    interview:hours&&times.length
      ?{mode:'book',format:hours.format,formatLabel:labelOf(INTERVIEW_FORMATS,hours.format),location:hours.location,times:times.map(at=>({at,label:interviewTimeLabel(at,hours.timezone)}))}
      :{mode:'prefer',options:CALL_TIME_OPTIONS.map(([key,label])=>({key,label}))}});
}

/** Where the agency hears about a booking: its workspace login and its applications address. */
async function agencyRecipients(env:FeatureEnv,orgId:string){
  const row=await env.DB!.prepare(`SELECT o.canonical_name,o.application_email,o.primary_contact_name,e.email AS employer_email,e.contact_name
    FROM agency_organizations o LEFT JOIN employer_leads e ON e.id=o.claimed_employer_id WHERE o.id=?`).bind(orgId).first<Row>();
  const to=[...new Set([clean(row?.employer_email,320).toLowerCase(),clean(row?.application_email,320).toLowerCase()].filter(emailValid))];
  return {to,name:clean(row?.canonical_name,200),contact:(clean(row?.contact_name,120)||clean(row?.primary_contact_name,120)).split(/\s+/)[0]||''};
}

/** POST /api/apply-interview: right after applying, book one of the offered times, or say which times suit a call. */
export async function bookApplyInterview(request:Request,env:FeatureEnv){
  if(!env.DB)return json({ok:false,error:'Database not configured'},{status:503});
  const data=await request.json().catch(()=>({})) as Row;
  const token=clean(data.token,200);
  if(token.length<40)return json({ok:false,error:'This link is no longer valid.'},{status:404});
  const row=await env.DB.prepare(`SELECT ai.id,ai.organization_id,ai.interview_at,ai.caregiver_job_id,o.claimed_employer_id,j.title,c.first_name,c.last_name,c.email,c.phone
    FROM agency_interests ai JOIN agency_organizations o ON o.id=ai.organization_id JOIN caregivers c ON c.id=ai.caregiver_id
    LEFT JOIN caregiver_jobs j ON j.id=ai.caregiver_job_id WHERE ai.booking_token_hash=? LIMIT 1`).bind(await sha256Hex(token)).first<Row>();
  if(!row)return json({ok:false,error:'This link is no longer valid.'},{status:404});
  if(row.interview_at)return json({ok:false,error:'Your interview is already booked.'},{status:409});
  const orgId=clean(row.organization_id,120);
  const agency=await agencyRecipients(env,orgId);
  const caregiverName=[clean(row.first_name,80),clean(row.last_name,80)].filter(Boolean).join(' ')||'A caregiver';
  const title=clean(row.title,200)||'Caregiver job';
  const caregiverEmail=clean(row.email,320).toLowerCase();

  const prefs=(Array.isArray(data.callTimes)?data.callTimes:[]).filter(k=>CALL_TIME_OPTIONS.some(([o])=>o===k)).map(k=>labelOf(CALL_TIME_OPTIONS,String(k)));
  if(!data.at){
    if(!prefs.length)return json({ok:false,error:'Pick at least one time that suits you.'},{status:400});
    await env.DB.prepare('UPDATE agency_interests SET interview_pref=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(prefs.join(', '),row.id).run();
    if(env.EMAIL&&agency.to.length){
      const text=`Hi ${agency.contact||'there'},\n\n${caregiverName} applied to ${title} on CareJoys and says the best times to call are: ${prefs.join(', ')}.\nPhone: ${clean(row.phone,40)}\nEmail: ${caregiverEmail}\n\nTo let applicants book an interview themselves, add your interview times under Settings at https://carejoys.com/hiring?tab=settings\n\nCareJoys · carejoys.com`;
      await env.EMAIL.send({from:'CareJoys <hello@carejoys.com>',to:agency.to,subject:`Best times to call ${caregiverName}`,text,
        html:'<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#191e49">'+text.split('\n').map(l=>l.replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]!))).join('<br>')+'</div>',
        ...(emailValid(caregiverEmail)?{replyTo:caregiverEmail}:{})}).catch(()=>null);
    }
    return json({ok:true,status:'preferences_saved',callTimes:prefs});
  }

  const hours=await interviewHoursFor(env,clean(row.claimed_employer_id,100));
  if(!hours)return json({ok:false,error:'This agency isn’t taking bookings right now. They’ll contact you.'},{status:409});
  const at=clean(data.at,40);
  const open=upcomingInterviewTimes(hours,Date.now(),await bookedTimes(env,orgId),40);
  if(!open.includes(at))return json({ok:false,error:'That time was just taken. Pick another.',times:open.slice(0,8).map(t=>({at:t,label:interviewTimeLabel(t,hours.timezone)}))},{status:409});
  // The guard on interview_at keeps a double click from booking twice.
  const saved=await env.DB.prepare("UPDATE agency_interests SET interview_at=?,interview_format=?,agency_stage='interview',agency_stage_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND interview_at IS NULL")
    .bind(at,hours.format,row.id).run();
  if(asNum(saved.meta?.changes)!==1)return json({ok:false,error:'Your interview is already booked.'},{status:409});
  await env.DB.prepare("INSERT INTO agency_interest_events(id,interest_id,event_type,actor,payload) VALUES (?,?,'interview_booked','caregiver',?)")
    .bind(crypto.randomUUID(),row.id,JSON.stringify({at,format:hours.format})).run();
  const label=interviewTimeLabel(at,hours.timezone)+' ('+hours.timezone.replace(/^America\//,'').replace(/_/g,' ')+' time)';
  const how=labelOf(INTERVIEW_FORMATS,hours.format)+(hours.location?': '+hours.location:hours.format==='phone'?': they’ll call '+clean(row.phone,40):'');
  if(env.EMAIL){
    const ics=interviewIcs({uid:clean(row.id,120),title,company:agency.name,caregiver:caregiverName,caregiverEmail,employerEmail:agency.to[0]||'hello@carejoys.com',startsAt:at,duration:hours.duration,where:how});
    const attachment={content:new TextEncoder().encode(ics),filename:'carejoys-interview.ics',type:'text/calendar; charset=utf-8; method=REQUEST',disposition:'attachment' as const};
    const sends:Promise<unknown>[]=[];
    if(emailValid(caregiverEmail)){
      const m=interviewConfirmedEmail({recipientName:clean(row.first_name,80),company:agency.name,caregiverName,title,startsLabel:label,where:how});
      sends.push(env.EMAIL.send({from:'CareJoys <hello@carejoys.com>',to:caregiverEmail,subject:m.subject,html:m.html,text:m.text,attachments:[attachment]}));
    }
    if(agency.to.length){
      const m=interviewConfirmedEmail({recipientName:agency.contact,company:agency.name,caregiverName,title,startsLabel:label,where:how});
      sends.push(env.EMAIL.send({from:'CareJoys <hello@carejoys.com>',to:agency.to,subject:m.subject,html:m.html,text:m.text,attachments:[attachment],...(emailValid(caregiverEmail)?{replyTo:caregiverEmail}:{})}));
    }
    await Promise.allSettled(sends);
  }
  return json({ok:true,status:'booked',at,label,how});
}

/** GET/PUT /api/agency/interview-hours: the workspace's interview times. */
export async function handleInterviewHours(request:Request,env:FeatureEnv){
  if(!env.DB)return json({ok:false,error:'Database not configured'},{status:503});
  const employer=await employerSession(request,env);
  if(!employer)return json({ok:false,error:'Sign in required'},{status:401});
  const employerId=clean(employer.id,100);
  if(request.method==='PUT'){
    const data=await request.json().catch(()=>null) as Row|null;
    if(data?.off===true){
      await env.DB.prepare('DELETE FROM agency_interview_hours WHERE employer_id=?').bind(employerId).run();
      return json({ok:true,hours:null,preview:[]});
    }
    const hours=cleanInterviewHours(data);
    if(!hours)return json({ok:false,error:'Pick at least one day, and an end time after the start.'},{status:400});
    await env.DB.prepare(`INSERT INTO agency_interview_hours(employer_id,hours_json,updated_at) VALUES (?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(employer_id) DO UPDATE SET hours_json=excluded.hours_json,updated_at=CURRENT_TIMESTAMP`).bind(employerId,JSON.stringify(hours)).run();
  }
  const hours=await interviewHoursFor(env,employerId);
  const preview=hours?upcomingInterviewTimes(hours,Date.now(),new Set(),4).map(at=>interviewTimeLabel(at,hours.timezone)):[];
  return json({ok:true,hours,preview});
}
