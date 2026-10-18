import { employerSession, type FeatureEnv } from './serverFeatures';
import { importApplicants, listApplicants, updateApplicant, type ApplicantDb } from './applicants';
import { saveScreeningQuestions, screeningQuestions } from './applicantScreening';
import { reactivationStatus, sendReactivationBatch, sendReactivationTest } from './applicantReactivation';
import { addReferrer, listReferrers, setRewardStatus } from './applicantReferrals';
import { ensureIntakeKey, intakeAddress } from './applicantEmailIntake';
import { applicantWeek } from './applicantReport';
import { createBookingLink } from './applicantBooking';

// The applicant list over HTTP: an agency works its own list from its workspace, and a CareJoys admin works any
// agency's list from the admin console (the operated service). Same storage, same rules.

type Row=Record<string,unknown>;
const json=(body:unknown,init:ResponseInit={})=>new Response(JSON.stringify(body),{
  ...init,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...(init.headers||{})}
});
const db=(env:FeatureEnv)=>env.DB as unknown as ApplicantDb;
const clean=(v:unknown,max=200)=>typeof v==='string'?v.trim().slice(0,max):'';

async function respond(env:FeatureEnv,employerId:string,request:Request,id:string,actor:string){
  const store=db(env);
  if(request.method==='GET'){
    // The forwarding address, the last message there that couldn't be read (a Gmail confirmation code lands here),
    // this week's numbers, and whether there are interview times for a booking link to offer.
    const address=intakeAddress(await ensureIntakeKey(store,employerId));
    const unread=address?await store.prepare("SELECT subject,snippet,created_at FROM email_messages WHERE mailbox=? AND kind='intake' AND status='new' ORDER BY created_at DESC LIMIT 1").bind(address).first<Row>():null;
    const lastRead=address?await store.prepare("SELECT created_at FROM email_messages WHERE mailbox=? AND kind='intake' AND status='handled' ORDER BY created_at DESC LIMIT 1").bind(address).first<Row>():null;
    const slots=await store.prepare("SELECT COUNT(*) AS n FROM interview_slots WHERE employer_id=? AND status='available' AND datetime(starts_at)>datetime('now','+30 minutes')").bind(employerId).first<Row>();
    return json({ok:true,...await listApplicants(store,employerId),
      intake:{address,lastReceivedAt:clean(lastRead?.created_at,40),unread:unread?{subject:clean(unread.subject,300),snippet:clean(unread.snippet,600),receivedAt:clean(unread.created_at,40)}:null},
      week:await applicantWeek(store,employerId),openInterviewTimes:Number(slots?.n||0)});
  }
  const data=await request.json().catch(()=>null) as Row|null;
  if(!data)return json({ok:false,error:'Nothing to save.'},{status:400});
  const result=id?await updateApplicant(store,employerId,id,data,actor):await importApplicants(store,employerId,{csv:data.csv,source:data.source,filename:data.filename,sourceDetail:data.sourceDetail},actor);
  return json(result,{status:result.ok?200:(result.error==='Applicant not found.'?404:400)});
}

async function bookingLink(env:FeatureEnv,employerId:string,request:Request,applicantId:string){
  const data=await request.json().catch(()=>({})) as Row;
  const result=await createBookingLink(env,employerId,applicantId,data?.send===true);
  return json(result,{status:result.ok?200:result.status});
}

/** POST /api/workspace/applicants/:id/booking-link {send?} for the signed-in agency. */
export async function workspaceBookingLink(request:Request,env:FeatureEnv,applicantId:string){
  const employer=await employerSession(request,env);
  if(!employer)return json({ok:false,error:'Sign in required'},{status:401});
  return bookingLink(env,clean(employer.id,100),request,applicantId);
}

/** POST /api/admin/applicants/:id/booking-link?employer=<id> {send?} for a CareJoys operator. */
export async function adminBookingLink(request:Request,env:FeatureEnv,applicantId:string){
  const found=await adminEmployer(request,env);
  if(found.error)return found.error;
  return bookingLink(env,found.employerId,request,applicantId);
}

/** /api/workspace/applicants[/:id] for the signed-in agency. */
export async function workspaceApplicants(request:Request,env:FeatureEnv,id=''){
  const employer=await employerSession(request,env);
  if(!employer)return json({ok:false,error:'Sign in required'},{status:401});
  return respond(env,clean(employer.id,100),request,id,clean(employer.email,320));
}

async function adminEmployer(request:Request,env:FeatureEnv){
  const employerId=clean(new URL(request.url).searchParams.get('employer'),100);
  if(!employerId)return {error:json({ok:false,error:'Choose an employer.'},{status:400})};
  const employer=await env.DB!.prepare('SELECT id FROM employer_leads WHERE id=? LIMIT 1').bind(employerId).first<Row>();
  return employer?{employerId}:{error:json({ok:false,error:'Employer not found.'},{status:404})};
}

/** /api/admin/applicants[/:id]?employer=<id> for a CareJoys operator. The caller has already checked admin access. */
export async function adminApplicants(request:Request,env:FeatureEnv,adminEmail:string,id=''){
  const found=await adminEmployer(request,env);
  if(found.error)return found.error;
  return respond(env,found.employerId,request,id,adminEmail||'admin');
}

/**
 * /api/admin/applicant-reactivation?employer=<id>: GET counts what's ready and what came back; POST sends the next
 * batch of "still looking?" emails, or with `testTo` one test copy. Admin only: an operator presses Send each time.
 */
export async function adminApplicantReactivation(request:Request,env:FeatureEnv&{EMAIL?:unknown},adminEmail:string){
  const found=await adminEmployer(request,env);
  if(found.error)return found.error;
  const renv=env as Parameters<typeof reactivationStatus>[0];
  if(request.method==='GET')return json({ok:true,...await reactivationStatus(renv,found.employerId)});
  const data=await request.json().catch(()=>null) as Row|null;
  if(!data)return json({ok:false,error:'Nothing to send.'},{status:400});
  const result=data.testTo!==undefined
    ?await sendReactivationTest(renv,found.employerId,{senderName:data.senderName,payText:data.payText,to:data.testTo})
    :await sendReactivationBatch(renv,found.employerId,{senderName:data.senderName,payText:data.payText},adminEmail||'admin');
  return json(result,{status:result.ok?200:400});
}

/** The agency's screening question list: GET reads it (the caregiver default until saved), POST {questions} replaces it. */
async function screening(request:Request,env:FeatureEnv,employerId:string,actor:string){
  const store=db(env);
  if(request.method==='GET')return json({ok:true,...await screeningQuestions(store,employerId)});
  const data=await request.json().catch(()=>null) as Row|null;
  const result=await saveScreeningQuestions(store,employerId,data?.questions,actor);
  return json(result,{status:result.ok?200:400});
}

/** /api/workspace/applicant-screening for the signed-in agency. */
export async function workspaceScreening(request:Request,env:FeatureEnv){
  const employer=await employerSession(request,env);
  if(!employer)return json({ok:false,error:'Sign in required'},{status:401});
  return screening(request,env,clean(employer.id,100),clean(employer.email,320));
}

/** /api/admin/applicant-screening?employer=<id> for a CareJoys operator. */
export async function adminScreening(request:Request,env:FeatureEnv,adminEmail:string){
  const found=await adminEmployer(request,env);
  if(found.error)return found.error;
  return screening(request,env,found.employerId,adminEmail||'admin');
}

/** Referrers and their links: GET lists them with what each has earned, POST {name,phone,email} adds one. */
async function referrers(request:Request,env:FeatureEnv,employerId:string,actor:string){
  const store=db(env);
  if(request.method==='GET')return json({ok:true,...await listReferrers(store,employerId)});
  const data=await request.json().catch(()=>null) as Row|null;
  const result=await addReferrer(store,employerId,data||{},actor);
  return json(result,{status:result.ok?200:400});
}

/** /api/workspace/applicant-referrers for the signed-in agency. */
export async function workspaceReferrers(request:Request,env:FeatureEnv){
  const employer=await employerSession(request,env);
  if(!employer)return json({ok:false,error:'Sign in required'},{status:401});
  return referrers(request,env,clean(employer.id,100),clean(employer.email,320));
}

/** /api/admin/applicant-referrers?employer=<id> for a CareJoys operator. */
export async function adminReferrers(request:Request,env:FeatureEnv,adminEmail:string){
  const found=await adminEmployer(request,env);
  if(found.error)return found.error;
  return referrers(request,env,found.employerId,adminEmail||'admin');
}

/** POST /api/admin/applicant-referral-rewards/:applicantId?employer=<id> {status}: a CareJoys operator approves, denies or marks paid. */
export async function adminReferralReward(request:Request,env:FeatureEnv,adminEmail:string,applicantId:string){
  const found=await adminEmployer(request,env);
  if(found.error)return found.error;
  const data=await request.json().catch(()=>null) as Row|null;
  const result=await setRewardStatus(db(env),found.employerId,applicantId,data?.status,adminEmail||'admin');
  return json(result,{status:result.ok?200:(result.error==='Reward not found.'?404:400)});
}
