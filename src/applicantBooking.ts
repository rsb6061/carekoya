// An interview booking link for one of the agency's own applicants (Indeed, CareerPlug, a referral), who has no
// CareJoys account. The agency texts or emails carejoys.com/book/<token>; the applicant picks one of the agency's open
// interview times, and both get the calendar invite. Only a hash of the token is kept, so making a new link replaces
// the old one.
import { interviewIcs, safeTimeZone, startsLabel, type FeatureEnv } from './serverFeatures';
import { applicantBookingInviteEmail, interviewConfirmedEmail } from './email';
import type { ApplicantDb } from './applicants';

type Row=Record<string,unknown>;
const clean=(v:unknown,max=200)=>typeof v==='string'?v.trim().slice(0,max):'';
const emailValid=(v:string)=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const json=(body:unknown,init:ResponseInit={})=>new Response(JSON.stringify(body),{
  ...init,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...(init.headers||{})}
});
const ORIGIN='https://carejoys.com';
const FROM='CareJoys <hello@carejoys.com>';
type MailEnv=FeatureEnv&{EMAIL?:{send(m:Record<string,unknown>):Promise<unknown>}};

async function sha256Hex(value:string){
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash)).map(b=>b.toString(16).padStart(2,'0')).join('');
}
const newToken=()=>btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(24)))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
export const bookingUrl=(token:string)=>`${ORIGIN}/book/${token}`;

/** "2026-10-20T15:00:00.000Z" in America/New_York → "2026-10-20T11:00", the agency's local time, as entered by hand. */
export function localStamp(iso:string,timeZone:string){
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:safeTimeZone(timeZone),year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'})
    .formatToParts(new Date(iso)).map(p=>[p.type,p.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

async function openSlots(db:ApplicantDb,employerId:string){
  const rows=await db.prepare(`SELECT s.id,s.starts_at,s.duration_minutes,s.timezone,s.location,o.title FROM interview_slots s JOIN openings o ON o.id=s.opening_id
      WHERE s.employer_id=? AND s.status='available' AND datetime(s.starts_at)>datetime('now','+30 minutes') ORDER BY s.starts_at ASC LIMIT 40`).bind(employerId).all<Row>();
  return rows.results||[];
}

/**
 * POST /api/workspace|admin/applicants/:id/booking-link {send?:boolean}: a fresh link for the applicant, and how many
 * interview times it offers. With `send`, CareJoys also emails it to them for the agency, which counts as first contact.
 */
export async function createBookingLink(env:MailEnv,employerId:string,applicantId:string,send:boolean){
  const db=env.DB as unknown as ApplicantDb;
  const a=await db.prepare(`SELECT a.id,a.first_name,a.email,a.position,e.company_name FROM agency_applicants a JOIN employer_leads e ON e.id=a.employer_id
      WHERE a.id=? AND a.employer_id=?`).bind(applicantId,employerId).first<Row>();
  if(!a)return {ok:false as const,status:404,error:'Applicant not found.'};
  const slots=(await openSlots(db,employerId)).length;
  const to=clean(a.email,320).toLowerCase();
  if(send&&!emailValid(to))return {ok:false as const,status:400,error:'This applicant has no email address. Copy the link and text it instead.'};
  if(send&&!env.EMAIL)return {ok:false as const,status:503,error:'Email is not set up.'};
  const token=newToken();
  await db.prepare('UPDATE agency_applicants SET booking_token_hash=?,booking_sent_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND employer_id=?')
    .bind(await sha256Hex(token),applicantId,employerId).run();
  const url=bookingUrl(token);
  let emailed=false;
  if(send){
    const mail=applicantBookingInviteEmail({firstName:clean(a.first_name,80),company:clean(a.company_name,200),position:clean(a.position,200),link:url});
    try{await env.EMAIL!.send({from:FROM,to,subject:mail.subject,html:mail.html,text:mail.text});emailed=true}
    catch(error){console.error('booking link email failed',error);return {ok:false as const,status:502,error:'The email didn’t send. Copy the link and send it yourself.',url,slots}}
    await db.prepare(`UPDATE agency_applicants SET first_contact_at=COALESCE(first_contact_at,CURRENT_TIMESTAMP),stage=CASE WHEN stage='new' THEN 'contacted' ELSE stage END WHERE id=?`).bind(applicantId).run();
  }
  return {ok:true as const,url,slots,emailed};
}

async function applicantByToken(db:ApplicantDb,token:string){
  if(!/^[A-Za-z0-9_-]{20,64}$/.test(token))return null;
  return db.prepare(`SELECT a.id,a.employer_id,a.first_name,a.last_name,a.email,a.position,a.stage,a.interview_slot_id,a.interview_at,e.company_name,e.contact_name,e.email AS employer_email,
      s.starts_at AS slot_starts_at,s.timezone AS slot_timezone,s.location AS slot_location,s.duration_minutes AS slot_duration
    FROM agency_applicants a JOIN employer_leads e ON e.id=a.employer_id LEFT JOIN interview_slots s ON s.id=a.interview_slot_id AND s.booked_applicant_id=a.id
    WHERE a.booking_token_hash=? AND e.status!='disabled' LIMIT 1`).bind(await sha256Hex(token)).first<Row>();
}

const slotView=(s:Row,many:boolean)=>({id:clean(s.id,100),startsAt:clean(s.starts_at,40),label:startsLabel(clean(s.starts_at,40),clean(s.timezone,80)),
  durationMinutes:Number(s.duration_minutes)||30,where:clean(s.location,300),title:many?clean(s.title,200):''});

/** GET /api/applicant-booking?token=: the agency, the applicant's booked time if any, and the open times. */
export async function applicantBookingView(env:FeatureEnv,url:URL){
  if(!env.DB)return json({ok:false,error:'Database unavailable'},{status:503});
  const db=env.DB as unknown as ApplicantDb;
  const a=await applicantByToken(db,clean(url.searchParams.get('token'),100));
  if(!a)return json({ok:false,error:'This booking link has expired. Ask the agency for a new one.'},{status:404});
  const slots=await openSlots(db,clean(a.employer_id,100));
  const many=new Set(slots.map(s=>clean(s.title,200))).size>1;
  const booked=a.slot_starts_at&&Date.parse(clean(a.slot_starts_at,40))>Date.now()
    ?{label:startsLabel(clean(a.slot_starts_at,40),clean(a.slot_timezone,80)),where:clean(a.slot_location,300)}:null;
  return json({ok:true,company:clean(a.company_name,200),firstName:clean(a.first_name,80),position:clean(a.position,200),booked,slots:slots.map(s=>slotView(s,many))});
}

/** POST /api/applicant-booking {token,slotId} books or moves the interview; {token,action:'cancel'} cancels it. */
export async function applicantBookingSubmit(request:Request,env:MailEnv){
  if(!env.DB)return json({ok:false,error:'Database unavailable'},{status:503});
  const db=env.DB as unknown as ApplicantDb;
  const data=await request.json().catch(()=>null) as Row|null;
  const a=await applicantByToken(db,clean(data?.token,100));
  if(!a)return json({ok:false,error:'This booking link has expired. Ask the agency for a new one.'},{status:404});
  const applicantId=clean(a.id,100),employerId=clean(a.employer_id,100),previous=a.slot_starts_at?clean(a.interview_slot_id,100):'';
  const release=()=>previous?db.prepare("UPDATE interview_slots SET status='available',booked_applicant_id=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND booked_applicant_id=? AND datetime(starts_at)>datetime('now')").bind(previous,applicantId).run():null;
  if(data?.action==='cancel'){
    if(!previous)return json({ok:false,error:'There is no interview to cancel.'},{status:400});
    await release();
    await db.prepare("UPDATE agency_applicants SET interview_slot_id=NULL,interview_at=NULL,interview_booked_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(applicantId).run();
    return json({ok:true,cancelled:true});
  }
  const slotId=clean(data?.slotId,100);
  if(slotId&&slotId===previous)return json({ok:true,unchanged:true});
  const slot=await db.prepare("SELECT s.id,s.starts_at,s.duration_minutes,s.timezone,s.location FROM interview_slots s WHERE s.id=? AND s.employer_id=? LIMIT 1").bind(slotId,employerId).first<Row>();
  if(!slot)return json({ok:false,error:'Choose an interview time.'},{status:400});
  const claimed=await db.prepare("UPDATE interview_slots SET status='booked',booked_applicant_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='available' AND datetime(starts_at)>datetime('now')").bind(applicantId,slotId).run();
  if(Number(claimed.meta?.changes||0)!==1)return json({ok:false,error:'That time was just taken. Choose another.'},{status:409});
  await release();
  const startsAt=clean(slot.starts_at,40),timezone=clean(slot.timezone,80);
  await db.prepare(`UPDATE agency_applicants SET interview_slot_id=?,interview_at=?,interview_booked_at=COALESCE(interview_booked_at,CURRENT_TIMESTAMP),interview_outcome=NULL,
      first_contact_at=COALESCE(first_contact_at,CURRENT_TIMESTAMP),stage=CASE WHEN stage IN ('new','contacted','screened') THEN 'interview' ELSE stage END,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .bind(slotId,localStamp(startsAt,timezone),applicantId).run();

  const name=[clean(a.first_name,80),clean(a.last_name,80)].filter(Boolean).join(' ')||'Applicant';
  const title=clean(a.position,200)||'Caregiver interview';
  const label=startsLabel(startsAt,timezone),where=clean(slot.location,300),company=clean(a.company_name,200);
  const applicantEmail=clean(a.email,320).toLowerCase(),employerEmail=clean(a.employer_email,320).toLowerCase();
  if(env.EMAIL){
    const ics=interviewIcs({uid:'applicant-'+applicantId,title,company,caregiver:name,caregiverEmail:applicantEmail||employerEmail,employerEmail,startsAt,duration:Number(slot.duration_minutes)||30,where});
    const attachment={content:new TextEncoder().encode(ics),filename:'carejoys-interview.ics',type:'text/calendar; charset=utf-8; method=REQUEST',disposition:'attachment'};
    const sends:Promise<unknown>[]=[];
    if(emailValid(applicantEmail)){
      const mail=interviewConfirmedEmail({recipientName:clean(a.first_name,80)||'there',company,caregiverName:name,title,startsLabel:label,where});
      sends.push(env.EMAIL.send({from:FROM,to:applicantEmail,subject:mail.subject,html:mail.html,text:mail.text,attachments:[attachment]}));
    }
    if(emailValid(employerEmail)){
      const mail=interviewConfirmedEmail({recipientName:clean(a.contact_name,120).split(/\s+/)[0]||'there',company,caregiverName:name,title,startsLabel:label,where});
      sends.push(env.EMAIL.send({from:FROM,to:employerEmail,subject:(previous?'Interview moved: ':'')+mail.subject,html:mail.html,text:mail.text,attachments:[attachment]}));
    }
    await Promise.allSettled(sends);
  }
  return json({ok:true,label,where,moved:!!previous});
}
