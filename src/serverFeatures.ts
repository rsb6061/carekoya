import { type EmailBinding, employerMagicLinkEmail, caregiverJobInviteEmail, employerCandidateInterestedEmail, interviewConfirmedEmail } from './email';

type D1Result<T=unknown>={results?:T[];success?:boolean;meta?:Record<string,unknown>};
type Statement={
  bind(...values:unknown[]):Statement;
  run():Promise<{success:boolean;meta?:Record<string,unknown>}>;
  all<T=Record<string,unknown>>():Promise<D1Result<T>>;
  first<T=Record<string,unknown>>():Promise<T|null>;
};
type DB={prepare(query:string):Statement};
export type FeatureEnv={
  DB?:DB;
  EMAIL?:EmailBinding;
  TURNSTILE_SITE_KEY?:string;
  TURNSTILE_SECRET_KEY?:string;
};

const clean=(v:unknown,max=500)=>typeof v==='string'?v.trim().slice(0,max):'';
const emailValid=(v:string)=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const json=(body:unknown,init:ResponseInit={})=>new Response(JSON.stringify(body),{
  ...init,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...(init.headers||{})}
});
async function sha256Hex(value:string){
  const bytes=new TextEncoder().encode(value);
  const hash=await crypto.subtle.digest('SHA-256',bytes);
  return Array.from(new Uint8Array(hash)).map(b=>b.toString(16).padStart(2,'0')).join('');
}
function cookie(request:Request,name:string){
  const raw=request.headers.get('cookie')||'';
  for(const piece of raw.split(';')){
    const [key,...rest]=piece.trim().split('=');
    if(key===name)return decodeURIComponent(rest.join('='));
  }
  return '';
}
function publicName(first:unknown,last:unknown,display:unknown){
  const f=clean(first,80),l=clean(last,80);
  if(f)return l?`${f} ${l.charAt(0).toUpperCase()}.`:f;
  const d=clean(display,120),parts=d.split(/\s+/).filter(Boolean);
  return parts.length>1?`${parts[0]} ${parts[parts.length-1].charAt(0).toUpperCase()}.`:(d||'Caregiver');
}
function asNumber(v:unknown){const n=Number(v||0);return Number.isFinite(n)?n:0;}
function safeTimeZone(value:string){try{new Intl.DateTimeFormat('en-US',{timeZone:value});return value}catch{return 'UTC'}}
function startsLabel(startsAt:string,timeZone:string){
  const d=new Date(startsAt);
  return d.toLocaleString('en-US',{timeZone:safeTimeZone(timeZone),weekday:'short',month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'});
}
function icsStamp(date:Date){return date.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z')}
function icsEscape(value:string){return value.replace(/\\/g,'\\\\').replace(/,/g,'\\,').replace(/;/g,'\\;').replace(/\n/g,'\\n')}
function interviewIcs(input:{uid:string;title:string;company:string;caregiver:string;caregiverEmail:string;employerEmail:string;startsAt:string;duration:number}){
  const start=new Date(input.startsAt);
  const end=new Date(start.getTime()+input.duration*60000);
  return [
    'BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//CareJoys//Interview//EN','CALSCALE:GREGORIAN','METHOD:REQUEST',
    'BEGIN:VEVENT',`UID:${icsEscape(input.uid)}@carejoys.com`,`DTSTAMP:${icsStamp(new Date())}`,`DTSTART:${icsStamp(start)}`,`DTEND:${icsStamp(end)}`,
    `SUMMARY:${icsEscape('CareJoys interview — '+input.title)}`,
    `DESCRIPTION:${icsEscape('Interview between '+input.company+' and '+input.caregiver+'. Employer will provide meeting format or location.')}`,
    `ORGANIZER;CN=${icsEscape(input.company)}:mailto:${icsEscape(input.employerEmail)}`,
    `ATTENDEE;CN=${icsEscape(input.caregiver)};ROLE=REQ-PARTICIPANT;RSVP=TRUE:mailto:${icsEscape(input.caregiverEmail)}`,
    `ATTENDEE;CN=${icsEscape(input.company)};ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED:mailto:${icsEscape(input.employerEmail)}`,
    'STATUS:CONFIRMED','SEQUENCE:0','END:VEVENT','END:VCALENDAR'
  ].join('\r\n');
}

export async function validateTurnstile(request:Request,env:FeatureEnv,token:string){
  if(!env.TURNSTILE_SECRET_KEY)return true;
  if(!token)return false;
  const form=new FormData();
  form.set('secret',env.TURNSTILE_SECRET_KEY);
  form.set('response',token);
  const ip=request.headers.get('CF-Connecting-IP');
  if(ip)form.set('remoteip',ip);
  try{
    const res=await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',body:form});
    const data=await res.json() as {success?:boolean};
    return data.success===true;
  }catch{return false}
}

export async function publicFormGuard(request:Request,env:FeatureEnv,bucket:string,data:Record<string,unknown>|null,limit=10,minutes=60){
  if(!env.DB)return json({ok:false,error:'Database not configured'},{status:503});
  const turnstile=clean(data?.turnstileToken||data?.['cf-turnstile-response'],2048);
  if(!(await validateTurnstile(request,env,turnstile)))return json({ok:false,error:'Please complete the security check and try again.'},{status:400});
  const ip=request.headers.get('CF-Connecting-IP')||'unknown';
  const email=clean(data?.email,320).toLowerCase();
  const identity=await sha256Hex(ip+'|'+email);
  const now=Date.now(),windowMs=minutes*60000;
  const start=new Date(Math.floor(now/windowMs)*windowMs).toISOString();
  const row=await env.DB.prepare('SELECT count FROM rate_limits WHERE bucket=? AND identity=? AND window_start=?').bind(bucket,identity,start).first<{count:number}>();
  if(Number(row?.count||0)>=limit)return json({ok:false,error:'Too many requests. Please try again later.'},{status:429});
  await env.DB.prepare("INSERT INTO rate_limits(bucket,identity,window_start,count) VALUES (?,?,?,1) ON CONFLICT(bucket,identity,window_start) DO UPDATE SET count=count+1,updated_at=CURRENT_TIMESTAMP").bind(bucket,identity,start).run();
  return null;
}

async function sendMagic(env:FeatureEnv,employer:{id:string;contact_name?:string;email:string}){
  if(!env.DB||!env.EMAIL)throw new Error('Email service is not configured');
  const token=crypto.randomUUID()+'-'+crypto.randomUUID();
  const hash=await sha256Hex(token);
  const expires=new Date(Date.now()+15*60000).toISOString();
  await env.DB.prepare('DELETE FROM employer_auth_tokens WHERE employer_id=? AND used_at IS NULL').bind(employer.id).run();
  await env.DB.prepare('INSERT INTO employer_auth_tokens(id,employer_id,token_hash,expires_at) VALUES (?,?,?,?)').bind(crypto.randomUUID(),employer.id,hash,expires).run();
  const link='https://carejoys.com/auth?token='+encodeURIComponent(token);
  const body=employerMagicLinkEmail(clean(employer.contact_name,120).split(/\s+/)[0]||'there',link);
  await env.EMAIL.send({from:'CareJoys <updates@carejoys.com>',to:employer.email,subject:body.subject,html:body.html,text:body.text});
}

export async function sendEmployerMagicLink(env:FeatureEnv,employerId:string){
  if(!env.DB)return;
  const employer=await env.DB.prepare('SELECT id,contact_name,email FROM employer_leads WHERE id=? LIMIT 1').bind(employerId).first<{id:string;contact_name?:string;email:string}>();
  if(employer)await sendMagic(env,employer);
}

export async function requestEmployerMagicLink(request:Request,env:FeatureEnv){
  if(!env.DB||!env.EMAIL)return json({ok:false,error:'Sign-in email is not configured'},{status:503});
  const data=await request.json().catch(()=>null) as Record<string,unknown>|null;
  const guard=await publicFormGuard(request,env,'employer_magic_link',data,5,15);
  if(guard)return guard;
  const email=clean(data?.email,320).toLowerCase();
  if(!emailValid(email))return json({ok:false,error:'Enter a valid email address'},{status:400});
  const employer=await env.DB.prepare("SELECT id,contact_name,email FROM employer_leads WHERE lower(email)=? AND status!='disabled' ORDER BY created_at DESC LIMIT 1").bind(email).first<{id:string;contact_name?:string;email:string}>();
  if(employer)await sendMagic(env,employer);
  return json({ok:true,message:'If that email has a CareJoys workspace, a sign-in link is on the way.'});
}

export async function verifyEmployerMagicLink(request:Request,env:FeatureEnv){
  if(!env.DB)return json({ok:false,error:'Database not configured'},{status:503});
  const data=await request.json().catch(()=>null) as Record<string,unknown>|null;
  const token=clean(data?.token,300);
  if(!token)return json({ok:false,error:'Sign-in link is missing'},{status:400});
  const hash=await sha256Hex(token);
  const record=await env.DB.prepare("SELECT id,employer_id FROM employer_auth_tokens WHERE token_hash=? AND used_at IS NULL AND datetime(expires_at)>datetime('now') LIMIT 1").bind(hash).first<{id:string;employer_id:string}>();
  if(!record)return json({ok:false,error:'This sign-in link is invalid or has expired.'},{status:400});
  const used=await env.DB.prepare("UPDATE employer_auth_tokens SET used_at=CURRENT_TIMESTAMP WHERE id=? AND used_at IS NULL").bind(record.id).run();
  if(asNumber(used.meta?.changes)!==1)return json({ok:false,error:'This sign-in link has already been used.'},{status:400});
  const session=crypto.randomUUID()+'-'+crypto.randomUUID();
  const sessionHash=await sha256Hex(session);
  const expires=new Date(Date.now()+30*86400000).toISOString();
  await env.DB.prepare('INSERT INTO employer_sessions(id,employer_id,session_hash,expires_at) VALUES (?,?,?,?)').bind(crypto.randomUUID(),record.employer_id,sessionHash,expires).run();
  await env.DB.prepare('UPDATE employer_leads SET last_login_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(record.employer_id).run();
  return json({ok:true},{
    status:200,
    headers:{'Set-Cookie':`__Host-cj_session=${encodeURIComponent(session)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=2592000`}
  });
}

export async function employerSession(request:Request,env:FeatureEnv){
  if(!env.DB)return null;
  const token=cookie(request,'__Host-cj_session')||cookie(request,'cj_session');
  if(!token)return null;
  const hash=await sha256Hex(token);
  const row=await env.DB.prepare("SELECT e.id,e.company_name,e.contact_name,e.email,e.phone,e.zip,e.roles_needed,e.status,s.id AS session_id FROM employer_sessions s JOIN employer_leads e ON e.id=s.employer_id WHERE s.session_hash=? AND datetime(s.expires_at)>datetime('now') AND e.status!='disabled' LIMIT 1").bind(hash).first<Record<string,unknown>>();
  if(!row)return null;
  await env.DB.prepare('UPDATE employer_sessions SET last_seen_at=CURRENT_TIMESTAMP WHERE id=?').bind(row.session_id).run();
  return row;
}

export async function sessionResponse(request:Request,env:FeatureEnv){
  const employer=await employerSession(request,env);
  if(!employer)return json({ok:false,error:'Sign in required'},{status:401});
  return json({ok:true,employer:{
    id:employer.id,companyName:employer.company_name,contactName:employer.contact_name,email:employer.email,zip:employer.zip
  }});
}

export async function logoutEmployer(request:Request,env:FeatureEnv){
  if(env.DB){
    const token=cookie(request,'__Host-cj_session')||cookie(request,'cj_session');
    if(token){
      const hash=await sha256Hex(token);
      await env.DB.prepare('DELETE FROM employer_sessions WHERE session_hash=?').bind(hash).run();
    }
  }
  return json({ok:true},{headers:{'Set-Cookie':'__Host-cj_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0'}});
}

export async function employerOwnsWorkspace(request:Request,env:FeatureEnv,workspaceId:string){
  const employer=await employerSession(request,env);
  return employer&&clean(employer.id,100)===workspaceId?employer:null;
}

export function publicConfig(env:FeatureEnv){
  return json({ok:true,turnstileSiteKey:env.TURNSTILE_SITE_KEY||null});
}

export async function contactMatches(request:Request,env:FeatureEnv,workspaceId:string,openingId:string){
  if(!env.DB||!env.EMAIL)return json({ok:false,error:'Email service is not configured'},{status:503});
  const employer=await employerOwnsWorkspace(request,env,workspaceId);
  if(!employer)return json({ok:false,error:'Sign in required'},{status:401});
  const opening=await env.DB.prepare('SELECT * FROM openings WHERE id=? AND employer_id=? LIMIT 1').bind(openingId,workspaceId).first<Record<string,unknown>>();
  if(!opening)return json({ok:false,error:'Opening not found'},{status:404});
  const body=await request.json().catch(()=>({})) as Record<string,unknown>;
  const limit=Math.max(1,Math.min(20,asNumber(body.limit)||5));
  const rows=await env.DB.prepare("SELECT cp.id AS pipeline_id,cp.match_score,c.id AS caregiver_id,c.first_name,c.last_name,c.display_name,c.email FROM candidate_pipeline cp JOIN caregivers c ON c.id=cp.caregiver_id WHERE cp.opening_id=? AND cp.stage='matched' AND c.email IS NOT NULL AND c.email!='' ORDER BY cp.match_score DESC,cp.created_at ASC LIMIT ?").bind(openingId,limit).all<Record<string,unknown>>();
  let sent=0,failed=0;
  for(const row of rows.results||[]){
    const token=crypto.randomUUID()+'-'+crypto.randomUUID();
    const hash=await sha256Hex(token);
    const link='https://carejoys.com/respond?token='+encodeURIComponent(token);
    const location=[clean(opening.city,120),clean(opening.state,80),clean(opening.zip,20)].filter(Boolean).join(', ');
    const pay=opening.pay_min||opening.pay_max?`$${opening.pay_min||'—'}–$${opening.pay_max||'—'}/hr`:'';
    const emailBody=caregiverJobInviteEmail({
      firstName:clean(row.first_name,100)||clean(row.display_name,120).split(/\s+/)[0]||'there',
      company:clean(employer.company_name,200),
      title:clean(opening.title,200),
      role:clean(opening.role,80),
      location,pay,shift:clean(opening.shift_preferences,300),link
    });
    try{
      const result=await env.EMAIL.send({from:'CareJoys <updates@carejoys.com>',to:clean(row.email,320),subject:emailBody.subject,html:emailBody.html,text:emailBody.text});
      const responseExpiresAt=new Date(Date.now()+14*86400000).toISOString();
      await env.DB.prepare("UPDATE candidate_pipeline SET stage='contacted',contacted_at=CURRENT_TIMESTAMP,response_token_hash=?,response_sent_at=CURRENT_TIMESTAMP,response_expires_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(hash,responseExpiresAt,row.pipeline_id).run();
      await env.DB.prepare("INSERT INTO outreach_events(id,caregiver_id,opening_id,channel,direction,event_type,provider_message_id,payload) VALUES (?,?,?,'email','outbound','job_interest_request',?,?)")
        .bind(crypto.randomUUID(),row.caregiver_id,openingId,result.messageId||null,JSON.stringify({pipelineId:row.pipeline_id})).run();
      sent++;
    }catch(error){
      failed++;
      await env.DB.prepare("INSERT INTO outreach_events(id,caregiver_id,opening_id,channel,direction,event_type,payload) VALUES (?,?,?,'email','outbound','job_interest_failed',?)")
        .bind(crypto.randomUUID(),row.caregiver_id,openingId,JSON.stringify({error:error instanceof Error?error.message:'send failed'})).run();
    }
  }
  return json({ok:true,attempted:(rows.results||[]).length,sent,failed});
}

export async function interviewSlots(request:Request,env:FeatureEnv,workspaceId:string,openingId:string){
  if(!env.DB)return json({ok:false,error:'Database not configured'},{status:503});
  const employer=await employerOwnsWorkspace(request,env,workspaceId);
  if(!employer)return json({ok:false,error:'Sign in required'},{status:401});
  const opening=await env.DB.prepare('SELECT id FROM openings WHERE id=? AND employer_id=?').bind(openingId,workspaceId).first();
  if(!opening)return json({ok:false,error:'Opening not found'},{status:404});
  if(request.method==='GET'){
    const rows=await env.DB.prepare('SELECT id,starts_at,duration_minutes,timezone,status,booked_pipeline_id FROM interview_slots WHERE opening_id=? ORDER BY starts_at ASC').bind(openingId).all();
    return json({ok:true,slots:rows.results||[]});
  }
  const data=await request.json().catch(()=>null) as Record<string,unknown>|null;
  const raw=Array.isArray(data?.slots)?data!.slots as Record<string,unknown>[]:[];
  if(raw.length<1||raw.length>10)return json({ok:false,error:'Add 1–10 interview times.'},{status:400});
  let added=0;
  for(const item of raw){
    const startsAt=clean(item.startsAt,80),timezone=safeTimeZone(clean(item.timezone,80)||'UTC');
    const duration=Math.max(15,Math.min(120,asNumber(item.durationMinutes)||30));
    const d=new Date(startsAt);
    if(!startsAt||!Number.isFinite(d.getTime())||d.getTime()<Date.now()+5*60000)continue;
    await env.DB.prepare('INSERT INTO interview_slots(id,opening_id,employer_id,starts_at,duration_minutes,timezone) VALUES (?,?,?,?,?,?)')
      .bind(crypto.randomUUID(),openingId,workspaceId,d.toISOString(),duration,timezone).run();
    added++;
  }
  if(!added)return json({ok:false,error:'Add at least one future interview time.'},{status:400});
  return json({ok:true,added});
}

async function responseRecord(env:FeatureEnv,token:string){
  if(!env.DB||!token)return null;
  const hash=await sha256Hex(token);
  return env.DB.prepare(`SELECT cp.id AS pipeline_id,cp.stage,cp.response_value,cp.interview_booked_at,cp.opening_id,
    c.id AS caregiver_id,c.first_name,c.last_name,c.display_name,c.email,c.work_status,
    cp.employer_notified_interest_at,
    o.title,o.role,o.city,o.state,o.zip,o.pay_min,o.pay_max,o.shift_preferences,o.requirements,
    e.id AS employer_id,e.company_name,e.contact_name,e.email AS employer_email
    FROM candidate_pipeline cp
    JOIN caregivers c ON c.id=cp.caregiver_id
    JOIN openings o ON o.id=cp.opening_id
    JOIN employer_leads e ON e.id=o.employer_id
    WHERE cp.response_token_hash=? AND (cp.response_expires_at IS NULL OR datetime(cp.response_expires_at)>datetime('now')) LIMIT 1`).bind(hash).first<Record<string,unknown>>();
}

export async function getCandidateResponse(url:URL,env:FeatureEnv){
  if(!env.DB)return json({ok:false,error:'Database not configured'},{status:503});
  const token=clean(url.searchParams.get('token'),300);
  const row=await responseRecord(env,token);
  if(!row)return json({ok:false,error:'This job-response link is invalid.'},{status:404});
  const slots=await env.DB.prepare("SELECT id,starts_at,duration_minutes,timezone,status FROM interview_slots WHERE opening_id=? AND status='available' AND datetime(starts_at)>datetime('now') ORDER BY starts_at ASC LIMIT 20").bind(row.opening_id).all<Record<string,unknown>>();
  return json({ok:true,opportunity:{
    company:row.company_name,title:row.title,role:row.role,city:row.city,state:row.state,zip:row.zip,
    payMin:row.pay_min,payMax:row.pay_max,shift:row.shift_preferences,requirements:row.requirements,
    stage:row.stage,response:row.response_value,interviewBookedAt:row.interview_booked_at,
    slots:(slots.results||[]).map(s=>({id:s.id,startsAt:s.starts_at,durationMinutes:s.duration_minutes,timezone:s.timezone}))
  }});
}

export async function submitCandidateResponse(request:Request,env:FeatureEnv){
  if(!env.DB)return json({ok:false,error:'Database not configured'},{status:503});
  const data=await request.json().catch(()=>null) as Record<string,unknown>|null;
  const token=clean(data?.token,300),choice=clean(data?.choice,40);
  if(!['interested','not_interested'].includes(choice))return json({ok:false,error:'Choose interested or not interested.'},{status:400});
  const row=await responseRecord(env,token);
  if(!row)return json({ok:false,error:'This job-response link is invalid.'},{status:404});
  if(choice==='interested'){
    await env.DB.prepare("UPDATE candidate_pipeline SET stage='interested',response_value='interested',response_at=CURRENT_TIMESTAMP,responded_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(row.pipeline_id).run();
    await env.DB.prepare("UPDATE caregivers SET work_status='actively_looking',last_confirmed_at=CURRENT_TIMESTAMP,is_active=1,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(row.caregiver_id).run();
    await env.DB.prepare("INSERT INTO availability_events(id,caregiver_id,status,source,confirmed_at) VALUES (?,?,'actively_looking','job_interest',CURRENT_TIMESTAMP)")
      .bind(crypto.randomUUID(),row.caregiver_id).run();
    if(env.EMAIL&&!row.employer_notified_interest_at&&emailValid(clean(row.employer_email,320))){
      const slotCount=await env.DB.prepare("SELECT COUNT(*) AS count FROM interview_slots WHERE opening_id=? AND status='available' AND datetime(starts_at)>datetime('now')").bind(row.opening_id).first<{count:number}>();
      const caregiverName=publicName(row.first_name,row.last_name,row.display_name);
      const location=[clean(row.city,120),clean(row.state,80),clean(row.zip,20)].filter(Boolean).join(', ');
      const notice=employerCandidateInterestedEmail({
        recipientName:clean(row.contact_name,120).split(/\s+/)[0]||'there',
        caregiverName,
        title:clean(row.title,200),
        location,
        appLink:'https://carejoys.com/app',
        hasInterviewSlots:asNumber(slotCount?.count)>0
      });
      try{
        const sent=await env.EMAIL.send({from:'CareJoys <updates@carejoys.com>',to:clean(row.employer_email,320),subject:notice.subject,html:notice.html,text:notice.text});
        await env.DB.prepare("UPDATE candidate_pipeline SET employer_notified_interest_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(row.pipeline_id).run();
        await env.DB.prepare("INSERT INTO outreach_events(id,caregiver_id,opening_id,channel,direction,event_type,provider_message_id,payload) VALUES (?,?,?,'email','outbound','employer_interest_notice',?,?)")
          .bind(crypto.randomUUID(),row.caregiver_id,row.opening_id,sent.messageId||null,JSON.stringify({pipelineId:row.pipeline_id})).run();
      }catch{}
    }
  }else{
    await env.DB.prepare("UPDATE candidate_pipeline SET stage='rejected',response_value='not_interested',response_at=CURRENT_TIMESTAMP,responded_at=CURRENT_TIMESTAMP,rejected_reason='caregiver_not_interested',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(row.pipeline_id).run();
  }
  await env.DB.prepare("INSERT INTO outreach_events(id,caregiver_id,opening_id,channel,direction,event_type,payload) VALUES (?,?,?,'web','inbound','job_interest_response',?)")
    .bind(crypto.randomUUID(),row.caregiver_id,row.opening_id,JSON.stringify({choice})).run();
  return json({ok:true,choice});
}

export async function bookCandidateInterview(request:Request,env:FeatureEnv){
  if(!env.DB||!env.EMAIL)return json({ok:false,error:'Email service is not configured'},{status:503});
  const data=await request.json().catch(()=>null) as Record<string,unknown>|null;
  const token=clean(data?.token,300),slotId=clean(data?.slotId,100);
  const row=await responseRecord(env,token);
  if(!row||row.response_value!=='interested')return json({ok:false,error:'Confirm interest before booking an interview.'},{status:400});
  const slot=await env.DB.prepare("SELECT id,starts_at,duration_minutes,timezone,status FROM interview_slots WHERE id=? AND opening_id=? LIMIT 1").bind(slotId,row.opening_id).first<Record<string,unknown>>();
  if(!slot||slot.status!=='available')return json({ok:false,error:'That interview time is no longer available.'},{status:409});
  const claimed=await env.DB.prepare("UPDATE interview_slots SET status='booked',booked_pipeline_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='available'").bind(row.pipeline_id,slotId).run();
  if(asNumber(claimed.meta?.changes)!==1)return json({ok:false,error:'That interview time was just booked. Choose another time.'},{status:409});
  await env.DB.prepare("UPDATE candidate_pipeline SET stage='interview',interview_slot_id=?,interview_at=?,interview_booked_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?")
    .bind(slotId,slot.starts_at,row.pipeline_id).run();

  const caregiverName=publicName(row.first_name,row.last_name,row.display_name);
  const label=startsLabel(clean(slot.starts_at,80),clean(slot.timezone,80));
  const ics=interviewIcs({uid:String(row.pipeline_id),title:clean(row.title,200),company:clean(row.company_name,200),caregiver:caregiverName,caregiverEmail:clean(row.email,320),employerEmail:clean(row.employer_email,320),startsAt:clean(slot.starts_at,80),duration:asNumber(slot.duration_minutes)||30});
  const attachment={content:new TextEncoder().encode(ics),filename:'carejoys-interview.ics',type:'text/calendar; charset=utf-8; method=REQUEST',disposition:'attachment' as const};
  const caregiverEmail=interviewConfirmedEmail({recipientName:clean(row.first_name,100)||'there',company:clean(row.company_name,200),caregiverName,title:clean(row.title,200),startsLabel:label});
  const employerEmail=interviewConfirmedEmail({recipientName:clean(row.contact_name,120).split(/\s+/)[0]||'there',company:clean(row.company_name,200),caregiverName,title:clean(row.title,200),startsLabel:label});
  const sends:Promise<unknown>[]=[];
  if(emailValid(clean(row.email,320)))sends.push(env.EMAIL.send({from:'CareJoys <updates@carejoys.com>',to:clean(row.email,320),subject:caregiverEmail.subject,html:caregiverEmail.html,text:caregiverEmail.text,attachments:[attachment]}));
  if(emailValid(clean(row.employer_email,320)))sends.push(env.EMAIL.send({from:'CareJoys <updates@carejoys.com>',to:clean(row.employer_email,320),subject:employerEmail.subject,html:employerEmail.html,text:employerEmail.text,attachments:[attachment]}));
  await Promise.allSettled(sends);
  return json({ok:true,startsAt:slot.starts_at,label});
}
