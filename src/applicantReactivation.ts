import { agencyReactivationEmail, withUnsubscribe, type EmailBinding } from './email';
import { unsubscribeLink } from './emailPreferences';
import { normalizePhone } from './sms';
import type { ApplicantDb } from './applicants';

// Dead-pile reactivation: a CareJoys operator emails an agency's past applicants for the agency, and each one
// answers yes or no from the email. Nothing sends on a schedule; every batch is an operator pressing Send.
// The yes page also offers the separate choice to hear about other jobs through CareJoys (pool_opt_in).

type Row=Record<string,unknown>;
export type ReactivationEnv={DB?:unknown;EMAIL?:EmailBinding};
const ORIGIN='https://carejoys.com';
const FROM_ADDRESS='hello@carejoys.com';
/** Most emails one press sends, so a batch stays well inside a Worker request. */
export const REACTIVATION_BATCH=100;

const clean=(v:unknown,max=200)=>typeof v==='string'?v.replace(/\s+/g,' ').trim().slice(0,max):'';
const esc=(v:string)=>v.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]||c));
const db=(env:ReactivationEnv)=>env.DB as ApplicantDb;
async function sha256Hex(value:string){
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash)).map(b=>b.toString(16).padStart(2,'0')).join('');
}

/** Past applicants not yet emailed: source dead-pile, an email address, still "new", and not unsubscribed from CareJoys. */
const ELIGIBLE=`employer_id=? AND source='dead-pile' AND stage='new' AND reactivation_sent_at IS NULL
  AND email IS NOT NULL AND email!='' AND NOT EXISTS (SELECT 1 FROM email_suppressions es WHERE es.email=lower(agency_applicants.email))`;

/** The display name mail clients show: the agency, marked as sent through CareJoys. Quotes and angle brackets removed. */
export const reactivationFrom=(agencyName:string)=>`${agencyName.replace(/["<>\\]/g,'').slice(0,80)} via CareJoys <${FROM_ADDRESS}>`;

export async function reactivationStatus(env:ReactivationEnv,employerId:string){
  const counts=await db(env).prepare(`SELECT
      (SELECT COUNT(*) FROM agency_applicants WHERE ${ELIGIBLE}) AS ready,
      SUM(CASE WHEN reactivation_status='sent' THEN 1 ELSE 0 END) AS sent,
      SUM(CASE WHEN reactivation_status='failed' THEN 1 ELSE 0 END) AS failed,
      SUM(CASE WHEN reactivation_response='yes' THEN 1 ELSE 0 END) AS yes,
      SUM(CASE WHEN reactivation_response='no' THEN 1 ELSE 0 END) AS no
    FROM agency_applicants WHERE employer_id=?`).bind(employerId,employerId).first<Row>();
  const last=await db(env).prepare('SELECT sender_name,pay_text,sent,failed,sent_by,created_at FROM agency_reactivation_sends WHERE employer_id=? ORDER BY created_at DESC LIMIT 1').bind(employerId).first<Row>();
  const n=(v:unknown)=>Number(v||0);
  return {ready:n(counts?.ready),sent:n(counts?.sent),failed:n(counts?.failed),yes:n(counts?.yes),no:n(counts?.no),
    lastSend:last?{senderName:clean(last.sender_name,80),payText:clean(last.pay_text,80),sent:n(last.sent),failed:n(last.failed),sentBy:clean(last.sent_by,320),at:clean(last.created_at,40)}:null};
}

type SendInput={senderName:unknown;payText:unknown};
function wording(input:SendInput){
  const senderName=clean(input.senderName,80),payText=clean(input.payText,80);
  return senderName?{senderName,payText}:null;
}
async function agencyName(env:ReactivationEnv,employerId:string){
  const row=await db(env).prepare('SELECT company_name FROM employer_leads WHERE id=?').bind(employerId).first<Row>();
  return clean(row?.company_name,120)||'Your agency';
}

/** One copy of the email to the operator, with links that go nowhere, to check the wording first. */
export async function sendReactivationTest(env:ReactivationEnv,employerId:string,input:SendInput&{to:unknown}){
  const words=wording(input);
  if(!words)return {ok:false as const,error:'Enter the name the email comes from, like Sam.'};
  const to=clean(input.to,320).toLowerCase();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to))return {ok:false as const,error:'Enter an email address for the test.'};
  if(!env.EMAIL)return {ok:false as const,error:'Email is not configured.'};
  const name=await agencyName(env,employerId);
  const preview=ORIGIN+'/still-looking?token=preview';
  const body=agencyReactivationEmail({firstName:'Ana',agencyName:name,position:'Caregiver',...words,yesLink:preview+'&answer=yes',noLink:preview+'&answer=no'});
  await env.EMAIL.send({from:reactivationFrom(name),to,subject:'[Test] '+body.subject,html:body.html,text:body.text});
  return {ok:true as const,to};
}

/** Emails the next batch of past applicants. Each one gets their own yes/no links and an unsubscribe link. */
export async function sendReactivationBatch(env:ReactivationEnv,employerId:string,input:SendInput,sentBy:string){
  const words=wording(input);
  if(!words)return {ok:false as const,error:'Enter the name the email comes from, like Sam.'};
  if(!env.EMAIL)return {ok:false as const,error:'Email is not configured.'};
  const store=db(env);
  const name=await agencyName(env,employerId);
  const rows=await store.prepare(`SELECT id,first_name,lower(trim(email)) AS email,position FROM agency_applicants WHERE ${ELIGIBLE} ORDER BY COALESCE(applied_at,received_at) DESC LIMIT ?`)
    .bind(employerId,REACTIVATION_BATCH).all<Row>();
  let sent=0,failed=0;
  for(const row of rows.results||[]){
    const token=crypto.randomUUID()+'-'+crypto.randomUUID();
    const link=ORIGIN+'/still-looking?token='+encodeURIComponent(token);
    try{
      // Claim the row first so a second press, or a retry, can't email the same person twice.
      const claim=await store.prepare("UPDATE agency_applicants SET reactivation_token_hash=?,reactivation_sent_at=CURRENT_TIMESTAMP,reactivation_status='sending',first_contact_at=COALESCE(first_contact_at,CURRENT_TIMESTAMP),updated_at=CURRENT_TIMESTAMP WHERE id=? AND reactivation_sent_at IS NULL")
        .bind(await sha256Hex(token),row.id).run();
      if(!Number(claim.meta?.changes))continue;
      const email=clean(row.email,320);
      const unsubscribe=await unsubscribeLink(store,email,'agency_reactivation');
      const body=withUnsubscribe(agencyReactivationEmail({firstName:clean(row.first_name,80),agencyName:name,position:clean(row.position,120),...words,
        yesLink:link+'&answer=yes',noLink:link+'&answer=no'}),unsubscribe.link);
      await env.EMAIL.send({from:reactivationFrom(name),to:email,subject:body.subject,html:body.html,text:body.text,headers:unsubscribe.headers});
      await store.prepare("UPDATE agency_applicants SET reactivation_status='sent',reactivation_error=NULL WHERE id=?").bind(row.id).run();
      sent++;
    }catch(error){
      failed++;
      await store.prepare("UPDATE agency_applicants SET reactivation_status='failed',reactivation_token_hash=NULL,reactivation_error=? WHERE id=?")
        .bind((error instanceof Error?error.message:'send failed').slice(0,500),row.id).run();
    }
  }
  const attempted=(rows.results||[]).length;
  await store.prepare('INSERT INTO agency_reactivation_sends(id,employer_id,sender_name,pay_text,attempted,sent,failed,sent_by) VALUES (?,?,?,?,?,?,?,?)')
    .bind(crypto.randomUUID(),employerId,words.senderName,words.payText||null,attempted,sent,failed,clean(sentBy,320)||null).run();
  return {ok:true as const,batch:{attempted,sent,failed},status:await reactivationStatus(env,employerId)};
}

// ---------- The applicant's answer: /still-looking ----------

const page=(title:string,body:string,status=200)=>new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${esc(title)}</title>
<style>body{margin:0;padding:0 16px;background:#ffffff;font-family:Arial,Helvetica,sans-serif;color:#191e49}main{max-width:480px;margin:8vh auto;padding:32px 24px;background:#f7f6fb;border:1px solid #e8e6f0;border-radius:24px}h1{font-weight:600;line-height:1.1}p,label{color:#5b5f7e;line-height:1.6}label{display:block;margin:14px 0}input[type=tel]{display:block;width:100%;box-sizing:border-box;margin-top:6px;height:46px;border:1px solid #e8e6f0;border-radius:14px;padding:0 12px;font:inherit}.check{display:flex;gap:10px;align-items:flex-start}.check input{margin-top:5px}button{background:#b8368f;color:#fff;border:0;border-radius:999px;padding:14px 22px;font-weight:700;font-size:16px;cursor:pointer;margin-top:8px}small{color:#8a849b}</style></head>
<body><main>${body}<p><small>Sent through CareJoys · carejoys.com</small></p></main></body></html>`,{status,headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-robots-tag':'noindex'}});

/**
 * GET shows the question with a button (so mail scanners that open links don't answer for people); POST records it.
 * Yes moves a "new" applicant to "contacted" and can take a better phone number and the separate CareJoys opt-in.
 */
export async function handleStillLooking(request:Request,env:ReactivationEnv){
  if(!env.DB)return page('Unavailable','<h1>Please try again later.</h1>',503);
  const url=new URL(request.url);
  const token=clean(url.searchParams.get('token'),300);
  const row=token&&token!=='preview'?await db(env).prepare(`SELECT a.id,a.first_name,a.reactivation_response,e.company_name FROM agency_applicants a
      JOIN employer_leads e ON e.id=a.employer_id WHERE a.reactivation_token_hash=? LIMIT 1`).bind(await sha256Hex(token)).first<Row>():null;
  if(!row)return page('Link not recognized',`<h1>${token==='preview'?'This is a test email.':'This link isn’t working.'}</h1><p>${token==='preview'?'In the real email, this button records the applicant’s answer.':'Reply to the email you got and the agency will get back to you.'}</p>`,token==='preview'?200:404);
  const agency=esc(clean(row.company_name,120)||'the agency');
  const action=esc('/still-looking?token='+encodeURIComponent(token));
  if(request.method!=='POST'){
    const answer=url.searchParams.get('answer')==='no'?'no':'yes';
    if(answer==='no')return page('Not looking right now?',`<h1>Not looking right now?</h1><p>We’ll let ${agency} know, and they won’t follow up about this.</p>
      <form method="post" action="${action}"><input type="hidden" name="answer" value="no"><button type="submit">Tell ${agency}</button></form>`);
    return page('Still looking',`<h1>Great. Tell ${agency} you’re still looking.</h1>
      <form method="post" action="${action}"><input type="hidden" name="answer" value="yes">
      <label>Best phone number to reach you (optional)<input type="tel" name="phone" autocomplete="tel" placeholder="410-555-0123"></label>
      <label class="check"><input type="checkbox" name="pool" value="1"><span>Also send me other caregiver jobs near me from CareJoys. (Optional. ${agency} gets your answer either way.)</span></label>
      <button type="submit">Send my answer</button></form>`);
  }
  const form=await request.formData().catch(()=>null);
  const answer=form?.get('answer')==='no'?'no':'yes';
  if(answer==='no'){
    await db(env).prepare("UPDATE agency_applicants SET reactivation_response='no',reactivation_responded_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(row.id).run();
    return page('Thanks',`<h1>Thanks for letting us know.</h1><p>${agency} won’t follow up about this.</p>`);
  }
  const phone=normalizePhone(form?.get('phone'))||null;
  const pool=form?.get('pool')==='1';
  await db(env).prepare(`UPDATE agency_applicants SET reactivation_response='yes',reactivation_responded_at=CURRENT_TIMESTAMP,
      reply_phone=COALESCE(?,reply_phone),
      stage=CASE WHEN stage='new' THEN 'contacted' ELSE stage END,first_contact_at=COALESCE(first_contact_at,CURRENT_TIMESTAMP),
      pool_opt_in=CASE WHEN ? THEN 1 ELSE pool_opt_in END,pool_opt_in_at=CASE WHEN ? THEN COALESCE(pool_opt_in_at,CURRENT_TIMESTAMP) ELSE pool_opt_in_at END,
      updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(phone,pool?1:0,pool?1:0,row.id).run();
  return page('Thanks',`<h1>Thanks${row.first_name?', '+esc(clean(row.first_name,80)):''}.</h1><p>${agency} will be in touch about open shifts.</p>`);
}
