// "Apply for me": CareJoys fills in an employer's own application form for a signed-in caregiver who clicked
// the button, using their profile and resume file. The browser engine lives in applyAgentBrowser.ts and is
// imported lazily, so the rest of the Worker (and the tests) never load Playwright.
import type { FeatureEnv } from './serverFeatures';
import { caregiverForIdentity, recordCareJoysApplication, type CaregiverIdentity } from './caregiverApi';
import {
  REMEMBERABLE_KEYS, applyProfileFromCaregiver, applyStartUrl, detectApplyProvider, jobSiteName,
  type ApplyAnswerKey, type ApplyProfile, type ApplyProvider
} from './applyAgentRules';
import type { ApplicationAgentRunResult, ObservedQuestion, PendingQuestion } from './applyAgentBrowser';
import { loadResume, resumeDownload } from './resumeFile';

type Row=Record<string,unknown>;
export type ApplyEnv=FeatureEnv&{BROWSER?:unknown};

const clean=(v:unknown,max=500)=>typeof v==='string'?v.trim().slice(0,max):'';
const json=(body:unknown,init:ResponseInit={})=>new Response(JSON.stringify(body),{
  ...init,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...(init.headers||{})}
});

// D1 keeps a value up to 2 MB; caregiver resumes are far smaller.
export const MAX_RESUME_BYTES=1_900_000;
const RESUME_TYPES:Record<string,string>={
  'application/pdf':'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':'docx',
  'application/msword':'doc',
  'text/plain':'txt'
};

function looksLike(type:string,bytes:Uint8Array){
  if(type==='application/pdf')return bytes.length>4&&String.fromCharCode(...bytes.slice(0,4))==='%PDF';
  if(type.includes('openxmlformats'))return bytes.length>2&&bytes[0]===0x50&&bytes[1]===0x4b;
  if(type==='application/msword')return bytes.length>4&&bytes[0]===0xd0&&bytes[1]===0xcf;
  return true;
}

/** Stores a caregiver's resume file from a raw request body (filename in x-file-name). */
export async function saveResumeFile(request:Request,env:FeatureEnv,caregiverId:string){
  const type=(request.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
  if(!RESUME_TYPES[type])return json({ok:false,error:'Upload a PDF, Word or text resume.'},{status:400});
  const body=await request.arrayBuffer();
  if(body.byteLength<20)return json({ok:false,error:'That resume file is empty.'},{status:400});
  if(body.byteLength>MAX_RESUME_BYTES)return json({ok:false,error:'Resumes must be under 1.9 MB. Try saving it as a smaller PDF.'},{status:400});
  if(!looksLike(type,new Uint8Array(body)))return json({ok:false,error:'That file does not look like a valid resume.'},{status:400});
  let name='';
  try{name=decodeURIComponent(request.headers.get('x-file-name')||'')}catch{}
  name=name.replace(/[^\w .()-]+/g,'').trim().slice(0,120)||'resume.'+RESUME_TYPES[type];
  await env.DB!.prepare(`INSERT INTO caregiver_resume_files(caregiver_id,file_blob,file_name,content_type,byte_size) VALUES (?,?,?,?,?)
    ON CONFLICT(caregiver_id) DO UPDATE SET file_blob=excluded.file_blob,file_name=excluded.file_name,content_type=excluded.content_type,byte_size=excluded.byte_size,updated_at=CURRENT_TIMESTAMP`)
    .bind(caregiverId,body,name,type,body.byteLength).run();
  return json({ok:true,resume:{fileName:name,byteSize:body.byteLength}});
}

/** Signed-in caregiver's own resume: GET downloads it, POST replaces it. */
export async function handleMyResume(request:Request,env:FeatureEnv,identity:CaregiverIdentity|null){
  if(!identity)return json({ok:false,error:'Sign in required'},{status:401});
  if(!env.DB)return json({ok:false,error:'Database not configured'},{status:503});
  const caregiverId=await caregiverForIdentity(env,identity);
  if(!caregiverId)return json({ok:false,error:'Add your resume on CareJoys first.',needsProfile:true},{status:404});
  if(request.method==='POST')return saveResumeFile(request,env,caregiverId);
  return resumeDownload(env,caregiverId);
}


async function rememberedAnswers(env:FeatureEnv,caregiverId:string){
  const rows=await env.DB!.prepare('SELECT answer_key,value FROM caregiver_application_answers WHERE caregiver_id=?').bind(caregiverId).all<Row>();
  const out:Record<string,string>={};
  for(const r of rows.results||[])out[clean(r.answer_key,60)]=clean(r.value,1000);
  return out;
}

async function profileFor(env:FeatureEnv,caregiverId:string){
  const c=await env.DB!.prepare('SELECT * FROM caregivers WHERE id=? LIMIT 1').bind(caregiverId).first<Row>();
  return c?applyProfileFromCaregiver(c,await rememberedAnswers(env,caregiverId)):null;
}

type AgentJob={id:string;title:string;employerName:string;sourceUrl:string};
async function agentJob(env:FeatureEnv,jobId:string):Promise<AgentJob|null>{
  const row=await env.DB!.prepare("SELECT id,title,employer_name,source_url FROM caregiver_jobs WHERE id=? AND is_published=1 AND status='current' LIMIT 1").bind(jobId).first<Row>();
  return row?{id:clean(row.id,120),title:clean(row.title,200),employerName:clean(row.employer_name,200),sourceUrl:clean(row.source_url,1000)}:null;
}

async function recordQuestions(env:FeatureEnv,sessionId:string,provider:string,questions:ObservedQuestion[]){
  const seen=new Set<string>();
  for(const q of questions.slice(0,60)){
    const text=String(q.text||'').replace(/\s+/g,' ').trim().slice(0,1000);
    if(!text||seen.has(text))continue;
    seen.add(text);
    await env.DB!.prepare('INSERT INTO apply_agent_questions(session_id,provider,question_text,canonical_key,required) VALUES (?,?,?,?,?)')
      .bind(sessionId,provider,text,q.canonicalKey,q.required?1:0).run();
  }
}

async function handleResult(env:ApplyEnv,ctx:{result:ApplicationAgentRunResult;sessionId:string;caregiverId:string;job:AgentJob;provider:ApplyProvider}){
  const {result,sessionId,caregiverId,job,provider}=ctx;
  await recordQuestions(env,sessionId,provider,result.observedQuestions);
  const db=env.DB!;
  if(result.status==='submitted'){
    await db.prepare("UPDATE apply_agent_sessions SET status='submitted',current_url=?,pending_questions_json=NULL,updated_at=CURRENT_TIMESTAMP,completed_at=CURRENT_TIMESTAMP WHERE id=?")
      .bind(result.currentUrl,sessionId).run();
    await recordCareJoysApplication(env,caregiverId,job.id,{submittedOnEmployerSite:true});
    return json({ok:true,status:'submitted',sessionId});
  }
  if(result.status==='needs_answers'){
    await db.prepare("UPDATE apply_agent_sessions SET status='needs_answers',current_url=?,browser_session_id=?,pending_questions_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .bind(result.currentUrl,result.browserSessionId,JSON.stringify(result.questions),sessionId).run();
    return json({ok:true,status:'needs_answers',sessionId,questions:result.questions});
  }
  if(result.status==='handoff_required'){
    await db.prepare("UPDATE apply_agent_sessions SET status='handoff_required',current_url=?,blocker_code=?,blocker_message=?,pending_questions_json=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .bind(result.currentUrl,result.blockerCode,result.blockerMessage,sessionId).run();
    return json({ok:true,status:'handoff_required',sessionId,liveViewUrl:result.liveViewUrl,blockerMessage:result.blockerMessage,fallbackUrl:job.sourceUrl});
  }
  await db.prepare("UPDATE apply_agent_sessions SET status='failed',current_url=?,last_error=?,pending_questions_json=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?")
    .bind(result.currentUrl,result.error.slice(0,1500),sessionId).run();
  return json({ok:false,status:'failed',sessionId,error:'CareJoys could not finish this application by itself.',fallbackUrl:job.sourceUrl},{status:502});
}

const browserModule=()=>import('./applyAgentBrowser');

/** Starts "Apply for me" on one job. Runs while the caregiver waits (usually under a minute). */
export async function startApplyAgent(env:ApplyEnv,identity:CaregiverIdentity|null,jobId:string){
  if(!identity)return json({ok:false,error:'Sign in required'},{status:401});
  if(!env.DB)return json({ok:false,error:'Database not configured'},{status:503});
  const caregiverId=await caregiverForIdentity(env,identity);
  if(!caregiverId)return json({ok:false,error:'Add your resume on CareJoys first.',needsProfile:true},{status:404});
  const job=await agentJob(env,jobId);
  if(!job)return json({ok:false,error:'This job is no longer open.'},{status:404});
  const provider=detectApplyProvider(job.sourceUrl);
  if(!provider)return json({ok:false,error:'CareJoys can’t fill in this employer’s application yet.',fallbackUrl:job.sourceUrl},{status:422});
  if(!env.BROWSER)return json({ok:false,error:'Apply for me isn’t switched on yet.',fallbackUrl:job.sourceUrl},{status:503});
  const done=await env.DB.prepare("SELECT 1 AS hit FROM apply_agent_sessions WHERE caregiver_id=? AND caregiver_job_id=? AND status='submitted' LIMIT 1").bind(caregiverId,jobId).first();
  if(done)return json({ok:true,status:'already_applied'});
  const profile=await profileFor(env,caregiverId);
  const missing=(['firstName','lastName','email','phone'] as ApplyAnswerKey[]).filter(k=>!profile?.[k]);
  if(!profile||missing.length)return json({ok:false,error:'Add your name, email and phone to your profile first.',profileRequired:true,missing},{status:409});
  const resume=await loadResume(env,caregiverId);
  if(!resume)return json({ok:false,error:'Add your resume file first so CareJoys can attach it.',resumeRequired:true},{status:409});

  const startUrl=applyStartUrl(provider,job.sourceUrl);
  const sessionId=crypto.randomUUID();
  await env.DB.prepare("INSERT INTO apply_agent_sessions(id,caregiver_id,caregiver_job_id,provider,status,application_url) VALUES (?,?,?,?,'running',?)")
    .bind(sessionId,caregiverId,jobId,provider,startUrl).run();
  const {runApplicationAgent}=await browserModule();
  const result=await runApplicationAgent(env.BROWSER as any,{provider,applicationUrl:startUrl,profile,resume});
  return handleResult(env,{result,sessionId,caregiverId,job,provider});
}

/** The caregiver answered the questions a paused run needs; remember the reusable ones and carry on. */
export async function continueApplyAgent(request:Request,env:ApplyEnv,identity:CaregiverIdentity|null){
  if(!identity)return json({ok:false,error:'Sign in required'},{status:401});
  if(!env.DB||!env.BROWSER)return json({ok:false,error:'Apply for me isn’t available right now.'},{status:503});
  const caregiverId=await caregiverForIdentity(env,identity);
  if(!caregiverId)return json({ok:false,error:'Sign in required'},{status:401});
  const body=await request.json().catch(()=>({})) as Row;
  const session=await env.DB.prepare("SELECT id,caregiver_job_id,provider,status,application_url,browser_session_id,pending_questions_json FROM apply_agent_sessions WHERE id=? AND caregiver_id=? LIMIT 1")
    .bind(clean(body.sessionId,120),caregiverId).first<Row>();
  if(!session||session.status!=='needs_answers'||!clean(session.browser_session_id,300))return json({ok:false,error:'This application is no longer waiting for answers.'},{status:409});
  let pending:PendingQuestion[]=[];
  try{pending=JSON.parse(clean(session.pending_questions_json,100000)||'[]')}catch{}
  const given=new Map<string,{value:string|boolean;remember:boolean}>();
  for(const a of Array.isArray(body.answers)?body.answers as Row[]:[]){
    const id=clean(a?.id,60);
    const value=typeof a?.value==='boolean'?a.value:String(a?.value??'').trim().slice(0,1000);
    if(id&&value!=='')given.set(id,{value,remember:a?.remember!==false});
  }
  const missing=pending.filter(q=>q.required&&!given.has(q.id)).map(q=>q.id);
  if(missing.length)return json({ok:false,error:'Please answer every required question.',missing},{status:400});
  const oneTimeAnswers:Record<string,string|boolean>={};
  for(const q of pending){
    const answer=given.get(q.id);
    if(!answer)continue;
    oneTimeAnswers[q.id]=answer.value;
    // Only plain, reusable facts are remembered; demographic answers never are.
    if(!q.eeoCategory&&q.canonicalKey&&REMEMBERABLE_KEYS.includes(q.canonicalKey)&&answer.remember){
      await env.DB.prepare(`INSERT INTO caregiver_application_answers(caregiver_id,answer_key,value) VALUES (?,?,?)
        ON CONFLICT(caregiver_id,answer_key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP`).bind(caregiverId,q.canonicalKey,String(answer.value)).run();
    }
  }
  const job=await agentJob(env,clean(session.caregiver_job_id,120));
  const profile=await profileFor(env,caregiverId);
  const resume=await loadResume(env,caregiverId);
  if(!job||!profile||!resume)return json({ok:false,error:'This application can no longer continue.'},{status:409});
  await env.DB.prepare("UPDATE apply_agent_sessions SET status='running',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(session.id).run();
  const provider=clean(session.provider,40) as ApplyProvider;
  const {continueApplicationAgent}=await browserModule();
  const result=await continueApplicationAgent(env.BROWSER as any,clean(session.browser_session_id,300),{
    provider,applicationUrl:clean(session.application_url,1000),profile,resume,oneTimeAnswers
  });
  if(result.status==='expired'){
    await env.DB.prepare("UPDATE apply_agent_sessions SET status='expired',pending_questions_json=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(session.id).run();
    return json({ok:false,status:'expired',error:'That took too long and the employer’s form closed. Your answers are saved, so try Apply for me again.'},{status:410});
  }
  return handleResult(env,{result,sessionId:clean(session.id,120),caregiverId,job,provider});
}

/** Admin: how many current jobs sit on each job site, and which ones Apply for me supports. */
export async function adminJobSites(env:FeatureEnv){
  const rows=await env.DB!.prepare("SELECT id,source_url FROM caregiver_jobs WHERE is_published=1 AND status='current'").all<Row>();
  const sites=new Map<string,{site:string;jobs:number;supported:boolean;sampleJobId:string}>();
  for(const r of rows.results||[]){
    const url=clean(r.source_url,1000);
    const site=jobSiteName(url);
    const entry=sites.get(site)||{site,jobs:0,supported:!!detectApplyProvider(url),sampleJobId:''};
    entry.jobs++;
    if(detectApplyProvider(url)&&!entry.sampleJobId)entry.sampleJobId=clean(r.id,120);
    sites.set(site,entry);
  }
  const list=[...sites.values()].sort((a,b)=>b.jobs-a.jobs);
  return json({ok:true,total:(rows.results||[]).length,supportedJobs:list.filter(s=>s.supported).reduce((n,s)=>n+s.jobs,0),sites:list});
}

// A made-up caregiver for fill-only tests: never a real person's data.
const TEST_PROFILE:ApplyProfile={firstName:'Test',lastName:'Caregiver',email:'apply-test@carejoys.com',phone:'(410) 555-0199',
  city:'Baltimore',state:'MD',postalCode:'21201',yearsExperience:3,certifications:'CNA, CPR',cnaCertified:true,cprCertified:true,
  reliableTransportation:true,workAuthorizationUs:true,requiresSponsorship:false,over18:true};

/** Admin: fills page one of a real job's application with the test caregiver and stops. Never clicks Next or Submit. */
export async function adminApplyTest(request:Request,env:ApplyEnv){
  if(!env.BROWSER)return json({ok:false,error:'Browser Rendering is not bound to this Worker.'},{status:503});
  const body=await request.json().catch(()=>({})) as Row;
  const job=await agentJob(env,clean(body.jobId,120));
  const provider=detectApplyProvider(job?.sourceUrl);
  if(!job||!provider)return json({ok:false,error:'That job isn’t on a job site Apply for me supports.'},{status:422});
  const {testFillApplication}=await browserModule();
  const result=await testFillApplication(env.BROWSER as any,{provider,applicationUrl:applyStartUrl(provider,job.sourceUrl),profile:TEST_PROFILE,
    resume:{name:'test.pdf',mimeType:'application/pdf',bytes:new Uint8Array()},skipFileUpload:true});
  return json({...result,provider,job:{id:job.id,title:job.title,employerName:job.employerName}});
}
