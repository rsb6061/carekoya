import { agencyInterestActivationEmail, agencyInterestNotifyEmail, caregiverInterestConfirmEmail } from './email';
import { employerSession, type FeatureEnv } from './serverFeatures';
import { scoreCaregiverAgainstAgencies } from './agencyFeatures';
import { outreachEnabled, type OutreachEnv } from './outreach';
import { isSuppressed, unsubscribeLink } from './emailPreferences';
import { withUnsubscribe } from './email';
import { lockedIntroductions, type BillingEnv } from './billing';
import { resumeDownload } from './resumeFile';

// The Agency Inbox: every caregiver who asked to be sent to an agency, in five stages.
//
// A caregiver's interest is created only by the caregiver: from a CareJoys job page while signed in with a
// verified email, or by pressing Send on the confirmation email (job page without a verified sign-in, and every
// AI-assistant request). Agencies that haven't claimed their listing get a de-identified activation email; once
// claimed, the Inbox shows full contact details, because the caregiver asked to be sent. Each one counts as an
// introduction (src/billing.ts), so past the free ones the details wait for a subscription.
// The stage is the agency's own mark; with no mark the interest still needs a reply.

type Row=Record<string,unknown>;
const ORIGIN='https://carejoys.com';
const clean=(v:unknown,max=500)=>typeof v==='string'?v.trim().slice(0,max):typeof v==='number'?String(v).slice(0,max):'';
const asNum=(v:unknown)=>{const n=Number(v||0);return Number.isFinite(n)?n:0};
const json=(body:unknown,init:ResponseInit={})=>new Response(JSON.stringify(body),{
  ...init,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...(init.headers||{})}
});
export const emailLooksValid=(v:string)=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
export async function sha256Hex(value:string){
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash)).map(b=>b.toString(16).padStart(2,'0')).join('');
}
const newToken=()=>crypto.randomUUID()+'-'+crypto.randomUUID();

export const INBOX_STAGES=['new','contacted','interview','hired','not_fit'] as const;
export type InboxStage=typeof INBOX_STAGES[number];
export const STAGE_LABELS:Record<InboxStage,string>={new:'Needs reply',contacted:'Contacted',interview:'Interview',hired:'Hired',not_fit:'Not a fit'};
// What a caregiver (or their assistant) is told about the same stage.
export const CAREGIVER_STAGE_LABELS:Record<InboxStage,string>={
  new:'Sent; waiting for the agency',contacted:'The agency has reached out',interview:'Interview stage',hired:'Hired',not_fit:'The agency is not moving forward'
};
export const MAX_TARGETS=5;
export const PREPARE_TTL_MS=15*60000;
export const EMAIL_TTL_MS=48*3600000;
// Agency emails: one per agency per day, and a ceiling across all agencies.
export const AGENCY_EMAILS_PER_DAY=60;

export function interestStage(row:{agency_stage?:unknown}):InboxStage{
  const s=clean(row.agency_stage,20);
  return s!=='new'&&(INBOX_STAGES as readonly string[]).includes(s)?s as InboxStage:'new';
}
export function maskEmail(email:string){
  const [user,domain]=email.split('@');
  if(!domain)return '';
  return (user.slice(0,1)||'')+'***@'+domain;
}
function freshnessLabel(workStatus:unknown,lastConfirmed:unknown){
  if(clean(workStatus,40)!=='actively_looking')return 'Availability unconfirmed';
  const t=Date.parse(clean(lastConfirmed,80).replace(' ','T')+(clean(lastConfirmed,80).includes('T')?'':'Z'));
  if(!Number.isFinite(t))return 'Availability unconfirmed';
  const days=(Date.now()-t)/86400000;
  if(days<=7)return 'Confirmed this week';
  if(days<=30)return 'Confirmed this month';
  return 'Availability unconfirmed';
}

// Counts one hit and reports whether the bucket is now over its limit.
export async function overRateLimit(env:FeatureEnv,bucket:string,identity:string,limit:number,minutes:number){
  if(!env.DB)return true;
  const windowMs=minutes*60000;
  const start=new Date(Math.floor(Date.now()/windowMs)*windowMs).toISOString();
  const id=await sha256Hex(identity);
  await env.DB.prepare("INSERT INTO rate_limits(bucket,identity,window_start,count) VALUES (?,?,?,1) ON CONFLICT(bucket,identity,window_start) DO UPDATE SET count=count+1,updated_at=CURRENT_TIMESTAMP")
    .bind(bucket,id,start).run();
  const row=await env.DB.prepare('SELECT count FROM rate_limits WHERE bucket=? AND identity=? AND window_start=?').bind(bucket,id,start).first<{count:number}>();
  return asNum(row?.count)>limit;
}

// An agency can receive profiles once it has claimed its listing or has an address to send the activation email to.
export const REACHABLE_AGENCY_SQL="(o.claimed_employer_id IS NOT NULL OR o.primary_email LIKE '%_@_%._%')";

export type ResolvedTarget={organizationId:string;agencyName:string;city:string;state:string;jobId:string|null;jobTitle:string|null};

// Jobs and agencies a caregiver may be sent to: published, current jobs and active agencies only.
export async function resolveTargets(env:FeatureEnv,input:{jobIds?:unknown;agencyIds?:unknown}):Promise<ResolvedTarget[]>{
  if(!env.DB)throw new Error('CareJoys is not available right now.');
  const list=(v:unknown)=>Array.isArray(v)?v.map(x=>clean(x,120)).filter(Boolean):[];
  const jobIds=[...new Set(list(input.jobIds))],agencyIds=[...new Set(list(input.agencyIds))];
  if(jobIds.length+agencyIds.length<1)throw new Error('Choose at least one job or agency.');
  if(jobIds.length+agencyIds.length>MAX_TARGETS)throw new Error(`Choose at most ${MAX_TARGETS} jobs or agencies at once.`);
  const out:ResolvedTarget[]=[];
  for(const id of jobIds){
    const row=await env.DB.prepare(`SELECT j.id,j.title AS title,j.agency_organization_id,o.canonical_name,o.city,o.state,
        ${REACHABLE_AGENCY_SQL} AS reachable
      FROM caregiver_jobs j JOIN agency_organizations o ON o.id=j.agency_organization_id
      WHERE j.id=? AND j.is_published=1 AND j.status='current' AND o.is_active=1 LIMIT 1`).bind(id).first<Row>();
    if(!row)throw new Error(`Job ${id} is not open on CareJoys. Search again for current jobs.`);
    if(!asNum(row.reachable))throw new Error(`${clean(row.canonical_name,200)} can't receive profiles through CareJoys yet. Use the job's application link to apply directly.`);
    out.push({organizationId:clean(row.agency_organization_id,120),agencyName:clean(row.canonical_name,200),city:clean(row.city,120),state:clean(row.state,20),jobId:id,jobTitle:clean(row.title,200)});
  }
  for(const id of agencyIds){
    const row=await env.DB.prepare(`SELECT o.id,o.canonical_name,o.city,o.state,${REACHABLE_AGENCY_SQL} AS reachable FROM agency_organizations o WHERE o.id=? AND o.is_active=1 AND COALESCE(o.is_test,0)=0 LIMIT 1`).bind(id).first<Row>();
    if(!row)throw new Error(`Agency ${id} is not on CareJoys. Search again for hiring agencies.`);
    if(!asNum(row.reachable))throw new Error(`${clean(row.canonical_name,200)} can't receive profiles through CareJoys yet.`);
    if(out.some(t=>t.organizationId===id&&!t.jobId))continue;
    out.push({organizationId:id,agencyName:clean(row.canonical_name,200),city:clean(row.city,120),state:clean(row.state,20),jobId:null,jobTitle:null});
  }
  return out;
}
const targetPreview=(t:ResolvedTarget)=>({label:t.agencyName,detail:[t.jobTitle,[t.city,t.state].filter(Boolean).join(', ')].filter(Boolean).join(' · ')||'Any open caregiver role'});

export type InterestResult={interestId:string;organizationId:string;agencyName:string;jobId:string|null;jobTitle:string|null;status:'sent'|'already_sent'};

export async function createAgencyInterests(env:FeatureEnv,input:{caregiverId:string;targets:ResolvedTarget[];source:string;requestId?:string|null;note?:string}){
  if(!env.DB)throw new Error('CareJoys is not available right now.');
  const results:InterestResult[]=[];
  const touched=new Set<string>();
  for(const t of input.targets){
    const jobKey=t.jobId||'';
    const id=crypto.randomUUID();
    const inserted=await env.DB.prepare(`INSERT INTO agency_interests(id,organization_id,caregiver_id,caregiver_job_id,job_key,source,interest_request_id,caregiver_note)
      VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(organization_id,caregiver_id,job_key) DO NOTHING`)
      .bind(id,t.organizationId,input.caregiverId,t.jobId,jobKey,input.source,input.requestId||null,clean(input.note,1000)||null).run();
    const isNew=asNum(inserted.meta?.changes)===1;
    const row=isNew?{id}:await env.DB.prepare('SELECT id FROM agency_interests WHERE organization_id=? AND caregiver_id=? AND job_key=?').bind(t.organizationId,input.caregiverId,jobKey).first<{id:string}>();
    const interestId=clean(row?.id,120)||id;
    if(isNew){
      await env.DB.prepare("INSERT INTO agency_interest_events(id,interest_id,event_type,actor,payload) VALUES (?,?,'created','caregiver',?)")
        .bind(crypto.randomUUID(),interestId,JSON.stringify({source:input.source,requestId:input.requestId||null})).run();
      await env.DB.prepare("UPDATE agency_org_candidate_matches SET caregiver_interest='interested',updated_at=CURRENT_TIMESTAMP WHERE organization_id=? AND caregiver_id=?")
        .bind(t.organizationId,input.caregiverId).run();
      touched.add(t.organizationId);
    }
    results.push({interestId,organizationId:t.organizationId,agencyName:t.agencyName,jobId:t.jobId,jobTitle:t.jobTitle,status:isNew?'sent':'already_sent'});
  }
  for(const orgId of touched)await notifyAgency(env,orgId);
  return results;
}

async function interestPreviews(env:FeatureEnv,orgId:string,identified:boolean){
  const rows=await env.DB!.prepare(`SELECT c.first_name,c.role,c.city,c.state,c.years_experience,j.title AS job_title
    FROM agency_interests ai JOIN caregivers c ON c.id=ai.caregiver_id LEFT JOIN caregiver_jobs j ON j.id=ai.caregiver_job_id
    WHERE ai.organization_id=? AND ai.agency_notified_at IS NULL ORDER BY ai.created_at DESC LIMIT 20`).bind(orgId).all<Row>();
  return (rows.results||[]).map(r=>{
    const role=clean(r.role,80)||'Caregiver';
    const area=[clean(r.city,100),clean(r.state,40)].filter(Boolean).join(', ');
    const years=asNum(r.years_experience);
    return {
      label:identified&&clean(r.first_name,80)?`${clean(r.first_name,80)} · ${role}`:role,
      detail:[clean(r.job_title,200)?'For '+clean(r.job_title,200):'',area,years>0?years+' years experience':''].filter(Boolean).join(' · ')
    };
  });
}

// Tells an agency about caregivers waiting in its Inbox: at most one email per agency per day, so a busy day
// becomes one email. Unclaimed agencies get the activation email at their listed address.
export async function notifyAgency(env:OutreachEnv,orgId:string):Promise<'sent'|'skipped'|'failed'>{
  if(!env.DB||!env.EMAIL)return 'skipped';
  const org=await env.DB.prepare('SELECT id,canonical_name,primary_email,primary_contact_name,claimed_employer_id FROM agency_organizations WHERE id=? AND is_active=1').bind(orgId).first<Row>();
  if(!org)return 'skipped';
  const recent=await env.DB.prepare("SELECT 1 AS hit FROM agency_interests WHERE organization_id=? AND agency_notified_at IS NOT NULL AND datetime(agency_notified_at)>datetime('now','-1 day') LIMIT 1").bind(orgId).first();
  if(recent)return 'skipped';
  const sentToday=await env.DB.prepare("SELECT COUNT(*) AS count FROM agency_outreach_events WHERE event_type IN ('interest_activation','interest_notify') AND datetime(created_at)>datetime('now','-1 day')").first<{count:number}>();
  if(asNum(sentToday?.count)>=AGENCY_EMAILS_PER_DAY)return 'skipped';
  const claimedBy=clean(org.claimed_employer_id,120);
  // An unclaimed agency never asked to hear from CareJoys, so its email is outreach: it waits for OUTREACH_ENABLED and honors unsubscribes.
  if(!claimedBy&&(!outreachEnabled(env)||await isSuppressed(env.DB,clean(org.primary_email,320))))return 'skipped';
  const previews=await interestPreviews(env,orgId,!!claimedBy);
  if(!previews.length)return 'skipped';
  const agencyName=clean(org.canonical_name,200);
  let to='',body:{subject:string;html:string;text:string},eventType='',headers:Record<string,string>|undefined;
  if(claimedBy){
    const employer=await env.DB.prepare("SELECT email,contact_name FROM employer_leads WHERE id=? AND status!='disabled'").bind(claimedBy).first<Row>();
    to=clean(employer?.email,320).toLowerCase();
    eventType='interest_notify';
    body=agencyInterestNotifyEmail({recipientName:clean(employer?.contact_name,120).split(/\s+/)[0]||'',agencyName,items:previews,count:previews.length,link:ORIGIN+'/app?tab=inbox'});
  }else{
    to=clean(org.primary_email,320).toLowerCase();
    if(!emailLooksValid(to))return 'skipped';
    const token=newToken();
    await env.DB.prepare("INSERT INTO agency_teaser_tokens(id,organization_id,token_hash,recipient_email,expires_at,sent_at) VALUES (?,?,?,?,?,CURRENT_TIMESTAMP)")
      .bind(crypto.randomUUID(),orgId,await sha256Hex(token),to,new Date(Date.now()+14*86400000).toISOString()).run();
    eventType='interest_activation';
    const unsubscribe=await unsubscribeLink(env.DB,to,'agency_interest');
    headers=unsubscribe.headers;
    body=withUnsubscribe(agencyInterestActivationEmail({contactName:clean(org.primary_contact_name,120).split(/\s+/)[0]||'',agencyName,items:previews,count:previews.length,link:ORIGIN+'/agency?token='+encodeURIComponent(token)}),unsubscribe.link);
  }
  if(!emailLooksValid(to))return 'skipped';
  try{
    const result=await env.EMAIL.send({from:'CareJoys <hello@carejoys.com>',to,subject:body.subject,html:body.html,text:body.text,...(headers?{headers}:{})});
    await env.DB.prepare("UPDATE agency_interests SET agency_notified_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE organization_id=? AND agency_notified_at IS NULL").bind(orgId).run();
    await env.DB.prepare('INSERT INTO agency_outreach_events(id,organization_id,event_type,recipient_email,provider_message_id,payload) VALUES (?,?,?,?,?,?)')
      .bind(crypto.randomUUID(),orgId,eventType,to,result.messageId||null,JSON.stringify({count:previews.length})).run();
    if(!claimedBy)await env.DB.prepare('UPDATE agency_organizations SET teaser_last_sent_at=CURRENT_TIMESTAMP,teaser_send_count=teaser_send_count+1,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(orgId).run();
    return 'sent';
  }catch(error){
    await env.DB.prepare('INSERT INTO agency_outreach_events(id,organization_id,event_type,recipient_email,payload) VALUES (?,?,?,?,?)')
      .bind(crypto.randomUUID(),orgId,eventType+'_failed',to,JSON.stringify({error:error instanceof Error?error.message:'send failed'})).run();
    return 'failed';
  }
}

// Hourly: agencies whose daily email was already used get the rest of their waiting caregivers here.
export async function notifyAgenciesOfInterestsBatch(env:OutreachEnv,limit=20){
  if(!env.DB)return {attempted:0,sent:0};
  const rows=await env.DB.prepare(`SELECT ai.organization_id FROM agency_interests ai JOIN agency_organizations o ON o.id=ai.organization_id
    WHERE ai.agency_notified_at IS NULL AND o.is_active=1 AND ${REACHABLE_AGENCY_SQL}
      AND (o.claimed_employer_id IS NOT NULL OR (?=1 AND NOT EXISTS (SELECT 1 FROM email_suppressions es WHERE es.email=lower(trim(o.primary_email)))))
      AND NOT EXISTS (SELECT 1 FROM agency_interests x WHERE x.organization_id=ai.organization_id AND x.agency_notified_at IS NOT NULL AND datetime(x.agency_notified_at)>datetime('now','-1 day'))
    GROUP BY ai.organization_id ORDER BY MIN(ai.created_at) LIMIT ?`).bind(outreachEnabled(env)?1:0,limit).all<{organization_id:string}>();
  let sent=0;
  for(const row of rows.results||[])if(await notifyAgency(env,row.organization_id)==='sent')sent++;
  return {attempted:(rows.results||[]).length,sent};
}

// ---------- Caregiver profile from an assistant's request ----------

export type InterestProfile={
  firstName:string;lastName:string;email:string;phone:string;zip:string;state:string;role:string;
  certifications:string;yearsExperience:number|null;shifts:string;desiredWage:string;
};

export function validateProfile(input:Row):InterestProfile{
  const name=clean(input.full_name??input.fullName,200).split(/\s+/).filter(Boolean);
  if(name.length<2)throw new Error("full_name needs the caregiver's first and last name.");
  const email=clean(input.email,320).toLowerCase();
  if(!emailLooksValid(email))throw new Error('A valid email is required. CareJoys emails the caregiver to confirm before anything is sent.');
  const zip=clean(input.zip,10);
  if(!/^\d{5}$/.test(zip))throw new Error('zip must be a 5-digit US ZIP code.');
  const role=clean(input.role,80);
  if(!role)throw new Error('role is required, for example CNA, GNA, HHA, PCA or Caregiver.');
  const prefix=Number(zip.slice(0,3));
  const state=(clean(input.state,2)||(prefix>=206&&prefix<=219?'MD':'')).toUpperCase();
  const years=input.years_experience==null||input.years_experience===''?null:Math.max(0,Math.min(60,Math.round(asNum(input.years_experience))));
  return {
    firstName:name[0],lastName:name.slice(1).join(' '),email,phone:clean(input.phone,40),zip,state,role,
    certifications:Array.isArray(input.certifications)?input.certifications.map(x=>clean(x,80)).filter(Boolean).join(', '):clean(input.certifications,500),
    yearsExperience:years,shifts:clean(input.shifts,300),desiredWage:clean(input.desired_pay??input.desiredPay,80)
  };
}

// The caregiver proved the address by pressing Send, so an existing profile with that email is theirs.
// Existing details are kept; only empty fields are filled, and availability is confirmed as of now.
export async function upsertCaregiverFromProfile(env:FeatureEnv,p:InterestProfile){
  const db=env.DB!;
  const existing=await db.prepare('SELECT id FROM caregivers WHERE lower(trim(email))=? LIMIT 1').bind(p.email).first<{id:string}>();
  let id=existing?.id||'';
  if(!id){
    id=crypto.randomUUID();
    await db.prepare(`INSERT OR IGNORE INTO caregivers (id,first_name,last_name,display_name,email,phone,zip,state,role,certifications,years_experience,shift_preferences,desired_wage,source,source_detail,work_status,last_confirmed_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'ai_assistant','mcp','actively_looking',NULL)`)
      .bind(id,p.firstName,p.lastName,(p.firstName+' '+p.lastName).trim(),p.email,p.phone,p.zip,p.state,p.role,p.certifications,p.yearsExperience,p.shifts,p.desiredWage).run();
    const canonical=await db.prepare('SELECT id FROM caregivers WHERE lower(trim(email))=? LIMIT 1').bind(p.email).first<{id:string}>();
    id=canonical?.id||id;
  }else{
    await db.prepare(`UPDATE caregivers SET
      first_name=COALESCE(NULLIF(first_name,''),?),last_name=COALESCE(NULLIF(last_name,''),?),phone=COALESCE(NULLIF(phone,''),?),
      zip=COALESCE(NULLIF(zip,''),?),state=COALESCE(NULLIF(state,''),?),role=COALESCE(NULLIF(role,''),?),
      certifications=COALESCE(NULLIF(certifications,''),?),years_experience=COALESCE(years_experience,?),
      shift_preferences=COALESCE(NULLIF(shift_preferences,''),?),desired_wage=COALESCE(NULLIF(desired_wage,''),?),
      work_status='actively_looking',last_confirmed_at=CASE WHEN auth0_email_verified=1 THEN CURRENT_TIMESTAMP ELSE NULL END,is_active=1,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .bind(p.firstName,p.lastName,p.phone,p.zip,p.state,p.role,p.certifications,p.yearsExperience,p.shifts,p.desiredWage,id).run();
  }
  await scoreCaregiverAgainstAgencies(env,id);
  return id;
}

// ---------- Requests that wait for the caregiver's email ----------

type RequestPayload={profile?:InterestProfile;targets:ResolvedTarget[];note?:string};

async function sendConfirmationEmail(env:FeatureEnv,requestId:string,email:string,firstName:string,payload:RequestPayload,viaAssistant:boolean){
  if(!env.EMAIL)throw new Error('CareJoys email is not available right now. Try again later.');
  const token=newToken();
  const expires=new Date(Date.now()+EMAIL_TTL_MS).toISOString();
  await env.DB!.prepare("UPDATE interest_requests SET status='awaiting_email',email_token_hash=?,email_expires_at=?,email_sent_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?")
    .bind(await sha256Hex(token),expires,requestId).run();
  const body=caregiverInterestConfirmEmail({firstName,targets:payload.targets.map(targetPreview),link:ORIGIN+'/confirm-interest?token='+encodeURIComponent(token),viaAssistant});
  await env.EMAIL.send({from:'CareJoys <hello@carejoys.com>',to:email,subject:body.subject,html:body.html,text:body.text});
}

// Assistant step 1: check everything and hold it, contacting nobody. The returned token confirms it and then
// tracks it.
export async function prepareInterestRequest(env:FeatureEnv,input:{profile:InterestProfile;targets:ResolvedTarget[];note?:string;clientKey:string}){
  if(!env.DB)throw new Error('CareJoys is not available right now.');
  if(await overRateLimit(env,'mcp_prepare_client',input.clientKey,30,60))throw new Error('Too many requests from this assistant right now. Try again in an hour.');
  if(await overRateLimit(env,'mcp_prepare_all','all',100,60))throw new Error('CareJoys is receiving too many assistant requests right now. Try again later.');
  if(await overRateLimit(env,'mcp_prepare_email',input.profile.email,5,60))throw new Error('Too many requests for this email address. Try again in an hour.');
  const token=newToken(),hash=await sha256Hex(token);
  const id=crypto.randomUUID();
  const payload:RequestPayload={profile:input.profile,targets:input.targets,note:clean(input.note,1000)||undefined};
  await env.DB.prepare(`INSERT INTO interest_requests(id,source,status,email,payload,prepare_token_hash,prepare_expires_at,status_token_hash,client_hash)
    VALUES (?,'mcp','prepared',?,?,?,?,?,?)`)
    .bind(id,input.profile.email,JSON.stringify(payload),hash,new Date(Date.now()+PREPARE_TTL_MS).toISOString(),hash,await sha256Hex(input.clientKey)).run();
  return {
    confirmationToken:token,
    expiresInMinutes:PREPARE_TTL_MS/60000,
    summary:{
      caregiver:{name:(input.profile.firstName+' '+input.profile.lastName).trim(),email:input.profile.email,phone:input.profile.phone||null,zip:input.profile.zip,role:input.profile.role,
        certifications:input.profile.certifications||null,yearsExperience:input.profile.yearsExperience,shifts:input.profile.shifts||null,desiredPay:input.profile.desiredWage||null},
      sendTo:input.targets.map(t=>({agency:t.agencyName,job:t.jobTitle,location:[t.city,t.state].filter(Boolean).join(', ')||null})),
      note:payload.note||null
    }
  };
}

// Assistant step 2: after the caregiver agrees, email them the Send link. Nothing reaches an agency yet.
export async function confirmPreparedRequest(env:FeatureEnv,token:string){
  if(!env.DB)throw new Error('CareJoys is not available right now.');
  const t=clean(token,300);
  if(t.length<20)throw new Error('A valid confirmation_token from prepare_job_interest is required.');
  const row=await env.DB.prepare('SELECT id,status,email,payload,prepare_expires_at FROM interest_requests WHERE prepare_token_hash=? LIMIT 1').bind(await sha256Hex(t)).first<Row>();
  if(!row)throw new Error('That confirmation_token was not found. Call prepare_job_interest again.');
  const status=clean(row.status,40);
  if(status==='prepared'){
    if(Date.parse(clean(row.prepare_expires_at,40))<Date.now())throw new Error('That confirmation_token expired after 15 minutes. Call prepare_job_interest again.');
    const payload=JSON.parse(clean(row.payload,20000)||'{}') as RequestPayload;
    await sendConfirmationEmail(env,clean(row.id,120),clean(row.email,320),payload.profile?.firstName||'',payload,true);
  }
  return {
    status:status==='sent'?'sent':'awaiting_caregiver_email_confirmation',
    emailedTo:maskEmail(clean(row.email,320)),
    message:status==='sent'?'The caregiver already sent this.':'CareJoys emailed the caregiver a link. Nothing is sent to any agency until they open it and press Send (within 48 hours).',
    requestToken:t
  };
}

export async function interestRequestStatus(env:FeatureEnv,token:string){
  if(!env.DB)throw new Error('CareJoys is not available right now.');
  const t=clean(token,300);
  if(t.length<20)throw new Error('A valid request_token is required (the token returned by confirm_job_interest).');
  const row=await env.DB.prepare('SELECT id,status,email,payload,result,email_expires_at FROM interest_requests WHERE status_token_hash=? LIMIT 1').bind(await sha256Hex(t)).first<Row>();
  if(!row)throw new Error('Request not found. Use the request_token returned by confirm_job_interest.');
  const status=clean(row.status,40);
  if(status==='prepared')return {status:'prepared_not_sent',message:'Prepared but not confirmed. Call confirm_job_interest once the caregiver agrees.'};
  if(status==='awaiting_email'){
    const expired=Date.parse(clean(row.email_expires_at,40))<Date.now();
    return {status:expired?'expired':'awaiting_caregiver_email_confirmation',emailedTo:maskEmail(clean(row.email,320)),
      message:expired?'The caregiver did not press Send within 48 hours. Nothing was sent. Prepare a new request if they still want to.':"The caregiver hasn't pressed Send in the email yet. No agency has been contacted."};
  }
  const ids=(JSON.parse(clean(row.result,20000)||'[]') as InterestResult[]).map(r=>r.interestId);
  const agencies=[];
  for(const id of ids){
    const r=await env.DB.prepare(`SELECT ai.agency_stage,ai.created_at,o.canonical_name,j.title AS job_title
      FROM agency_interests ai JOIN agency_organizations o ON o.id=ai.organization_id LEFT JOIN caregiver_jobs j ON j.id=ai.caregiver_job_id WHERE ai.id=?`).bind(id).first<Row>();
    if(r)agencies.push({agency:clean(r.canonical_name,200),job:clean(r.job_title,200)||null,status:CAREGIVER_STAGE_LABELS[interestStage(r)],sentAt:clean(r.created_at,40)});
  }
  return {status:'sent',agencies};
}

// Job page: a caregiver signed in with a verified email sends at once; otherwise the profile's own email gets
// the Send link, so nobody can send someone else's profile.
export async function sendProfileFromJobPage(request:Request,env:FeatureEnv,jobId:string,identity:{sub:string;email:string;emailVerified:boolean}|null){
  if(!env.DB)return json({ok:false,error:'Database not configured'},{status:503});
  const data=await request.json().catch(()=>({})) as Row;
  let targets:ResolvedTarget[];
  try{targets=await resolveTargets(env,{jobIds:[jobId]})}catch(error){return json({ok:false,error:error instanceof Error?error.message:'Job not found'},{status:404})}
  let caregiver:Row|null=null;
  if(identity?.sub){
    caregiver=await env.DB.prepare("SELECT id,first_name,email FROM caregivers WHERE auth0_sub=? OR lower(trim(email))=? ORDER BY CASE WHEN auth0_sub=? THEN 0 ELSE 1 END LIMIT 1")
      .bind(identity.sub,identity.email,identity.sub).first<Row>();
  }
  if(!caregiver&&clean(data.caregiverId,120)){
    caregiver=await env.DB.prepare('SELECT id,first_name,email FROM caregivers WHERE id=? LIMIT 1').bind(clean(data.caregiverId,120)).first<Row>();
  }
  if(!caregiver)return json({ok:false,error:'Save your CareJoys profile first.'},{status:404});
  const caregiverId=clean(caregiver.id,120);
  const verified=!!identity?.emailVerified&&clean(caregiver.email,320).toLowerCase()===identity.email;
  if(verified){
    const results=await createAgencyInterests(env,{caregiverId,targets,source:'job_page',note:clean(data.note,1000)});
    return json({ok:true,status:'sent',results});
  }
  const email=clean(caregiver.email,320).toLowerCase();
  if(!emailLooksValid(email))return json({ok:false,error:'Your profile needs an email address first.'},{status:400});
  if(await overRateLimit(env,'job_page_interest',caregiverId,5,60))return json({ok:false,error:'Too many requests. Please try again later.'},{status:429});
  const id=crypto.randomUUID();
  const payload:RequestPayload={targets,note:clean(data.note,1000)||undefined};
  await env.DB.prepare("INSERT INTO interest_requests(id,source,status,email,caregiver_id,payload) VALUES (?,'job_page','prepared',?,?,?)")
    .bind(id,email,caregiverId,JSON.stringify(payload)).run();
  try{await sendConfirmationEmail(env,id,email,clean(caregiver.first_name,80),payload,false)}
  catch{return json({ok:false,error:'We could not email you a confirmation link. Try again later.'},{status:503})}
  return json({ok:true,status:'check_email',emailedTo:maskEmail(email)});
}

async function emailRequest(env:FeatureEnv,token:string){
  const t=clean(token,300);
  if(!env.DB||t.length<20)return null;
  return env.DB.prepare("SELECT * FROM interest_requests WHERE email_token_hash=? LIMIT 1").bind(await sha256Hex(t)).first<Row>();
}

export async function getInterestConfirmation(url:URL,env:FeatureEnv){
  const row=await emailRequest(env,url.searchParams.get('token')||'');
  if(!row)return json({ok:false,error:'This link is invalid.'},{status:404});
  const payload=JSON.parse(clean(row.payload,20000)||'{}') as RequestPayload;
  const sent=clean(row.status,40)==='sent';
  if(!sent&&Date.parse(clean(row.email_expires_at,40))<Date.now())return json({ok:false,error:'This link expired after 48 hours. Nothing was sent.'},{status:410});
  let firstName=payload.profile?.firstName||'';
  if(!firstName&&row.caregiver_id){
    const c=await env.DB!.prepare('SELECT first_name FROM caregivers WHERE id=?').bind(clean(row.caregiver_id,120)).first<Row>();
    firstName=clean(c?.first_name,80);
  }
  return json({ok:true,status:sent?'sent':'ready',firstName,email:maskEmail(clean(row.email,320)),viaAssistant:clean(row.source,40)==='mcp',
    profile:payload.profile?{role:payload.profile.role,zip:payload.profile.zip,certifications:payload.profile.certifications,phone:payload.profile.phone}:null,
    targets:payload.targets.map(targetPreview),note:payload.note||null});
}

// The caregiver pressed Send. POST only, so link scanners that open emails can't send anything.
export async function confirmInterestRequest(request:Request,env:FeatureEnv){
  const data=await request.json().catch(()=>({})) as Row;
  const row=await emailRequest(env,clean(data.token,300));
  if(!row)return json({ok:false,error:'This link is invalid.'},{status:404});
  if(clean(row.status,40)==='sent')return json({ok:true,status:'sent',results:JSON.parse(clean(row.result,20000)||'[]')});
  if(Date.parse(clean(row.email_expires_at,40))<Date.now())return json({ok:false,error:'This link expired after 48 hours. Nothing was sent.'},{status:410});
  const payload=JSON.parse(clean(row.payload,20000)||'{}') as RequestPayload;
  let caregiverId=clean(row.caregiver_id,120);
  if(!caregiverId){
    if(!payload.profile)return json({ok:false,error:'This request is missing its profile.'},{status:400});
    caregiverId=await upsertCaregiverFromProfile(env,payload.profile);
  }
  let targets:ResolvedTarget[];
  try{targets=await resolveTargets(env,{jobIds:payload.targets.filter(t=>t.jobId).map(t=>t.jobId),agencyIds:payload.targets.filter(t=>!t.jobId).map(t=>t.organizationId)})}
  catch(error){
    // A job closed since the request was made: send to the rest, and to the agency itself for a closed job.
    targets=[];
    for(const t of payload.targets){
      try{targets.push(...await resolveTargets(env,t.jobId?{jobIds:[t.jobId]}:{agencyIds:[t.organizationId]}))}
      catch{try{targets.push(...await resolveTargets(env,{agencyIds:[t.organizationId]}))}catch{}}
    }
    if(!targets.length)return json({ok:false,error:error instanceof Error?error.message:'These jobs are no longer open.'},{status:410});
  }
  const results=await createAgencyInterests(env,{caregiverId,targets,source:clean(row.source,40)||'mcp',requestId:clean(row.id,120),note:payload.note});
  await env.DB!.prepare("UPDATE interest_requests SET status='sent',caregiver_id=?,result=?,confirmed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?")
    .bind(caregiverId,JSON.stringify(results),clean(row.id,120)).run();
  return json({ok:true,status:'sent',results});
}

// ---------- The agency's side ----------

async function claimedOrg(request:Request,env:FeatureEnv){
  const employer=await employerSession(request,env);
  if(!employer)return {error:json({ok:false,error:'Sign in required'},{status:401})};
  const org=await env.DB!.prepare('SELECT id,canonical_name FROM agency_organizations WHERE claimed_employer_id=? AND is_active=1 ORDER BY license_count DESC LIMIT 1').bind(employer.id).first<Row>();
  return {org,employerId:clean(employer.id,100)};
}

export function inboxItem(r:Row,locked=false){
  const id=clean(r.id,120);
  return {
    contactLocked:locked,
    resumeUrl:!locked&&Number(r.has_resume)===1?'/api/agency/inbox/'+encodeURIComponent(id)+'/resume':null,
    id:clean(r.id,120),stage:interestStage(r),createdAt:clean(r.created_at,40),viewed:!!r.agency_viewed_at,
    source:clean(r.source,40)==='mcp'?'AI assistant':'CareJoys job page',
    note:clean(r.caregiver_note,1000)||null,notes:clean(r.agency_notes,4000),
    job:r.caregiver_job_id?{id:clean(r.caregiver_job_id,120),title:clean(r.job_title,200),url:ORIGIN+'/jobs/'+encodeURIComponent(clean(r.caregiver_job_id,120))}:null,
    caregiver:{
      name:[clean(r.first_name,80),clean(r.last_name,80)].filter(Boolean).join(' ')||clean(r.display_name,160)||'Caregiver',
      email:locked?'':clean(r.email,320),phone:locked?'':clean(r.phone,40),city:clean(r.city,120),state:clean(r.state,20),zip:clean(r.zip,10),
      role:clean(r.role,80),certifications:clean(r.certifications,500),yearsExperience:r.years_experience==null?null:asNum(r.years_experience),
      shifts:clean(r.shift_preferences,300),desiredWage:clean(r.desired_wage,80),transportation:clean(r.transportation,80),
      freshness:freshnessLabel(r.work_status,r.last_confirmed_at),photoUrl:clean(r.profile_photo_url,500)||null
    }
  };
}

export async function getAgencyInbox(request:Request,env:BillingEnv){
  if(!env.DB)return json({ok:false,error:'Database not configured'},{status:503});
  const {org,employerId,error}=await claimedOrg(request,env);
  if(error)return error;
  if(!org)return json({ok:true,agency:null,items:[],stages:STAGE_LABELS});
  const rows=await env.DB.prepare(`SELECT ai.*,c.first_name,c.last_name,c.display_name,c.email,c.phone,c.city,c.state,c.zip,c.role,c.certifications,c.years_experience,
      c.shift_preferences,c.desired_wage,c.transportation,c.work_status,c.last_confirmed_at,c.profile_photo_url,
      EXISTS(SELECT 1 FROM caregiver_resume_files rf WHERE rf.caregiver_id=c.id) AS has_resume,j.title AS job_title
    FROM agency_interests ai JOIN caregivers c ON c.id=ai.caregiver_id LEFT JOIN caregiver_jobs j ON j.id=ai.caregiver_job_id
    WHERE ai.organization_id=? ORDER BY ai.created_at DESC LIMIT 300`).bind(org.id).all<Row>();
  const locked=await lockedIntroductions(env,employerId!);
  const items=(rows.results||[]).map(r=>inboxItem(r,locked.has(clean(r.id,120))));
  await env.DB.prepare('UPDATE agency_interests SET agency_viewed_at=CURRENT_TIMESTAMP WHERE organization_id=? AND agency_viewed_at IS NULL').bind(org.id).run();
  return json({ok:true,agency:{id:org.id,name:org.canonical_name},stages:STAGE_LABELS,items});
}

/** The resume of a caregiver who sent their profile to this agency, unless that introduction waits on billing. */
export async function agencyInterestResume(request:Request,env:BillingEnv,interestId:string){
  if(!env.DB)return json({ok:false,error:'Database not configured'},{status:503});
  const {org,employerId,error}=await claimedOrg(request,env);
  if(error)return error;
  if(!org)return json({ok:false,error:'No claimed agency is linked to this workspace.'},{status:404});
  const row=await env.DB.prepare('SELECT id,caregiver_id FROM agency_interests WHERE id=? AND organization_id=?').bind(interestId,org.id).first<Row>();
  if(!row)return json({ok:false,error:'Not found'},{status:404});
  if((await lockedIntroductions(env,employerId!)).has(clean(row.id,120)))return json({ok:false,error:'Upgrade to see this caregiver’s contact details and resume.'},{status:402});
  return resumeDownload(env,clean(row.caregiver_id,120));
}

export async function updateAgencyInterest(request:Request,env:FeatureEnv,interestId:string){
  if(!env.DB)return json({ok:false,error:'Database not configured'},{status:503});
  const {org,error}=await claimedOrg(request,env);
  if(error)return error;
  if(!org)return json({ok:false,error:'No claimed agency is linked to this workspace.'},{status:404});
  const row=await env.DB.prepare('SELECT id,agency_stage FROM agency_interests WHERE id=? AND organization_id=?').bind(interestId,org.id).first<Row>();
  if(!row)return json({ok:false,error:'Not found'},{status:404});
  const data=await request.json().catch(()=>({})) as Row;
  if(data.stage!==undefined){
    const stage=clean(data.stage,20);
    if(!(INBOX_STAGES as readonly string[]).includes(stage))return json({ok:false,error:'Choose a valid stage.'},{status:400});
    const stored=stage==='new'?null:stage;
    if(stored!==(row.agency_stage??null)){
      await env.DB.prepare('UPDATE agency_interests SET agency_stage=?,agency_stage_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(stored,interestId).run();
      await env.DB.prepare("INSERT INTO agency_interest_events(id,interest_id,event_type,actor,payload) VALUES (?,?,'stage_changed','agency',?)")
        .bind(crypto.randomUUID(),interestId,JSON.stringify({from:interestStage(row),to:stage})).run();
    }
  }
  if(data.notes!==undefined){
    await env.DB.prepare('UPDATE agency_interests SET agency_notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(clean(data.notes,4000),interestId).run();
  }
  const updated=await env.DB.prepare('SELECT agency_stage,agency_notes FROM agency_interests WHERE id=?').bind(interestId).first<Row>();
  return json({ok:true,stage:interestStage(updated||{}),notes:clean(updated?.agency_notes,4000)});
}

// De-identified waiting caregivers for the claim page an activation email links to.
export async function waitingInterestPreviews(env:FeatureEnv,orgId:string){
  if(!env.DB)return [];
  const rows=await env.DB.prepare(`SELECT c.role,c.city,c.state,c.years_experience,j.title AS job_title
    FROM agency_interests ai JOIN caregivers c ON c.id=ai.caregiver_id LEFT JOIN caregiver_jobs j ON j.id=ai.caregiver_job_id
    WHERE ai.organization_id=? ORDER BY ai.created_at DESC LIMIT 10`).bind(orgId).all<Row>();
  return (rows.results||[]).map(r=>({
    role:clean(r.role,80)||'Caregiver',area:[clean(r.city,100),clean(r.state,40)].filter(Boolean).join(', '),
    jobTitle:clean(r.job_title,200)||null,experience:asNum(r.years_experience)>0?asNum(r.years_experience)+' years experience':''
  }));
}
