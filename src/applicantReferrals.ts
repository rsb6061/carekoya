import { normalizePhone } from './sms';
import { REFERRAL_REWARD_CENTS, type ApplicantDb } from './applicants';
import { publicFormGuard, type FeatureEnv } from './serverFeatures';

// Referral links for an agency's own applicants. The agency adds a referrer (usually one of its caregivers) and
// shares their link, carejoys.com/refer/<code>. Whoever applies there lands on the agency's applicant list with
// source 'referral'. The referrer earns REFERRAL_REWARD_CENTS once that person is screened with no knockout answer,
// and a CareJoys operator approves each reward and marks it paid by hand. Applying with the referrer's own phone or
// email, or as someone already on the list, earns nothing.

type Row=Record<string,unknown>;
type Db=ApplicantDb;
const ORIGIN='https://carejoys.com';
type RewardStatus='earned'|'approved'|'paid'|'denied';

const clean=(v:unknown,max=200)=>typeof v==='string'?v.replace(/\s+/g,' ').trim().slice(0,max):'';
const esc=(v:string)=>v.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]||c));
const emailOf=(v:unknown)=>{const e=clean(v,320).toLowerCase();return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)?e:''};
export const referralLink=(code:string)=>`${ORIGIN}/refer/${code}`;

// Ten characters without look-alikes (0/o, 1/l), so a link read aloud or retyped still works.
const ALPHABET='abcdefghjkmnpqrstuvwxyz23456789';
function newCode(){
  const bytes=crypto.getRandomValues(new Uint8Array(10));
  return Array.from(bytes,b=>ALPHABET[b%ALPHABET.length]).join('');
}

export type ReferrerView={id:string;name:string;email:string;phone:string;link:string;addedBy:string;createdAt:string;
  referred:number;screened:number;earnedCents:number;paidCents:number};
export type RewardView={applicantId:string;applicantName:string;referrerId:string;referrerName:string;amountCents:number;status:RewardStatus;
  earnedAt:string;approvedAt:string;approvedBy:string;paidAt:string;paidBy:string};

export async function listReferrers(db:Db,employerId:string){
  const referrers=await db.prepare(`SELECT r.*,
      (SELECT COUNT(*) FROM agency_applicants a WHERE a.referrer_id=r.id) AS referred,
      (SELECT COUNT(*) FROM agency_referral_rewards w WHERE w.referrer_id=r.id AND w.status!='denied') AS screened,
      (SELECT COALESCE(SUM(amount_cents),0) FROM agency_referral_rewards w WHERE w.referrer_id=r.id AND w.status IN ('earned','approved','paid')) AS earned_cents,
      (SELECT COALESCE(SUM(amount_cents),0) FROM agency_referral_rewards w WHERE w.referrer_id=r.id AND w.status='paid') AS paid_cents
    FROM agency_referrers r WHERE r.employer_id=? ORDER BY r.created_at DESC LIMIT 500`).bind(employerId).all<Row>();
  const rewards=await db.prepare(`SELECT w.*,r.name AS referrer_name,a.first_name,a.last_name,a.email,a.phone FROM agency_referral_rewards w
      JOIN agency_referrers r ON r.id=w.referrer_id JOIN agency_applicants a ON a.id=w.applicant_id
    WHERE w.employer_id=? ORDER BY CASE w.status WHEN 'earned' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END,w.earned_at DESC LIMIT 500`).bind(employerId).all<Row>();
  return {
    rewardCents:REFERRAL_REWARD_CENTS,
    referrers:(referrers.results||[]).map(r=>({id:clean(r.id,100),name:clean(r.name,120),email:clean(r.email,320),phone:clean(r.phone,20),link:referralLink(clean(r.code,40)),
      addedBy:clean(r.added_by,320),createdAt:clean(r.created_at,40),referred:Number(r.referred||0),screened:Number(r.screened||0),
      earnedCents:Number(r.earned_cents||0),paidCents:Number(r.paid_cents||0)}) as ReferrerView),
    rewards:(rewards.results||[]).map(r=>({applicantId:clean(r.applicant_id,100),
      applicantName:[clean(r.first_name,80),clean(r.last_name,80)].filter(Boolean).join(' ')||clean(r.email,320)||clean(r.phone,20),
      referrerId:clean(r.referrer_id,100),referrerName:clean(r.referrer_name,120),amountCents:Number(r.amount_cents||0),status:clean(r.status,20) as RewardStatus,
      earnedAt:clean(r.earned_at,40),approvedAt:clean(r.approved_at,40),approvedBy:clean(r.approved_by,320),paidAt:clean(r.paid_at,40),paidBy:clean(r.paid_by,320)}) as RewardView)
  };
}

/** Adds a referrer and their link. A phone or email is needed, to pay them and to spot them referring themselves. */
export async function addReferrer(db:Db,employerId:string,input:Row,addedBy:string){
  const name=clean(input.name,120);
  const phone=normalizePhone(clean(input.phone,40))||'';
  const email=emailOf(input.email);
  if(!name)return {ok:false as const,error:'Enter the referrer’s name.'};
  if(!phone&&!email)return {ok:false as const,error:'Enter the referrer’s phone or email, so they can be paid.'};
  const existing=await db.prepare('SELECT id FROM agency_referrers WHERE employer_id=? AND ((phone IS NOT NULL AND phone=?) OR (email IS NOT NULL AND email=?)) LIMIT 1')
    .bind(employerId,phone||null,email||null).first<Row>();
  if(existing)return {ok:false as const,error:'That person already has a referral link. It’s in the list below.'};
  await db.prepare('INSERT INTO agency_referrers(id,employer_id,code,name,email,phone,added_by) VALUES (?,?,?,?,?,?,?)')
    .bind(crypto.randomUUID(),employerId,newCode(),name,email||null,phone||null,clean(addedBy,320)||null).run();
  return {ok:true as const,...await listReferrers(db,employerId)};
}

// What an operator can do next with a reward: approve or deny an earned one, mark an approved one paid (or deny it).
const NEXT:Record<string,RewardStatus[]>={earned:['approved','denied'],approved:['paid','denied'],denied:['approved'],paid:[]};

/** CareJoys operator only. */
export async function setRewardStatus(db:Db,employerId:string,applicantId:string,status:unknown,by:string){
  const next=clean(status,20) as RewardStatus;
  const row=await db.prepare('SELECT status FROM agency_referral_rewards WHERE applicant_id=? AND employer_id=?').bind(applicantId,employerId).first<Row>();
  if(!row)return {ok:false as const,error:'Reward not found.'};
  if(!(NEXT[clean(row.status,20)]||[]).includes(next))return {ok:false as const,error:`A reward that is ${clean(row.status,20)} can’t be marked ${next||'that'}.`};
  const who=clean(by,320)||null;
  const stamp=next==='approved'?',approved_at=CURRENT_TIMESTAMP,approved_by=?':next==='paid'?',paid_at=CURRENT_TIMESTAMP,paid_by=?':'';
  await db.prepare(`UPDATE agency_referral_rewards SET status=?${stamp},updated_at=CURRENT_TIMESTAMP WHERE applicant_id=? AND employer_id=?`)
    .bind(...(stamp?[next,who,applicantId,employerId]:[next,applicantId,employerId])).run();
  return {ok:true as const,...await listReferrers(db,employerId)};
}

// ---------- The public page: /refer/<code> ----------

const page=(title:string,body:string,status=200,siteKey='')=>new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${esc(title)}</title>
<style>body{margin:0;padding:0 16px;background:#ffffff;font-family:Arial,Helvetica,sans-serif;color:#191e49}main{max-width:480px;margin:6vh auto;padding:32px 24px;background:#f7f6fb;border:1px solid #e8e6f0;border-radius:24px}h1{font-weight:600;line-height:1.15}p,label{color:#5b5f7e;line-height:1.6}label{display:block;margin:14px 0}input[type=text],input[type=tel],input[type=email]{display:block;width:100%;box-sizing:border-box;margin-top:6px;height:46px;border:1px solid #e8e6f0;border-radius:14px;padding:0 12px;font:inherit;color:#191e49}.row{display:grid;grid-template-columns:1fr 1fr;gap:12px}.row label{margin:14px 0 0}.hp{position:absolute;left:-9999px}.error{color:#b42318;font-weight:600}button{background:#b8368f;color:#fff;border:0;border-radius:999px;padding:14px 22px;font-weight:700;font-size:16px;cursor:pointer;margin-top:12px}small{color:#8a849b}</style>
${siteKey?'<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>':''}</head>
<body><main>${body}<p><small>Sent through CareJoys · carejoys.com</small></p></main></body></html>`,{status,headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-robots-tag':'noindex'}});

type Form={first:string;last:string;phone:string;email:string;zip:string};
function applyForm(agency:string,referrer:string,action:string,siteKey:string,values:Form,error=''){
  const v=(k:keyof Form)=>esc(values[k]);
  return `<h1>${referrer?esc(referrer)+' thinks you’d be a great fit at ':'Apply to '}${agency}.</h1>
    <p>Send your name and number and ${agency} will reach out about caregiver openings.</p>
    ${error?`<p class="error" role="alert">${esc(error)}</p>`:''}
    <form method="post" action="${action}">
      <div class="row"><label>First name<input type="text" name="first" autocomplete="given-name" required maxlength="80" value="${v('first')}"></label>
      <label>Last name<input type="text" name="last" autocomplete="family-name" maxlength="80" value="${v('last')}"></label></div>
      <label>Mobile phone<input type="tel" name="phone" autocomplete="tel" required placeholder="410-555-0123" value="${v('phone')}"></label>
      <label>Email (optional)<input type="email" name="email" autocomplete="email" maxlength="320" value="${v('email')}"></label>
      <label>ZIP code<input type="text" name="zip" inputmode="numeric" autocomplete="postal-code" maxlength="10" value="${v('zip')}"></label>
      <label class="hp" aria-hidden="true">Website<input type="text" name="website" tabindex="-1" autocomplete="off"></label>
      ${siteKey?`<div class="cf-turnstile" data-sitekey="${esc(siteKey)}"></div>`:''}
      <button type="submit">Send to ${agency}</button>
      <p><small>By sending, you agree that ${agency}, and CareJoys on its behalf, may call, text or email you about this job. Message and data rates may apply. Reply STOP to stop texts.</small></p>
    </form>`;
}

/** GET shows the form; POST adds the person to the agency's applicant list. */
export async function handleReferral(request:Request,env:FeatureEnv,code:string){
  if(!env.DB)return page('Unavailable','<h1>Please try again later.</h1>',503);
  const db=env.DB as unknown as Db;
  const ref=await db.prepare(`SELECT r.id,r.employer_id,r.name,r.email,r.phone,e.company_name FROM agency_referrers r
      JOIN employer_leads e ON e.id=r.employer_id WHERE r.code=? LIMIT 1`).bind(clean(code,40).toLowerCase()).first<Row>();
  if(!ref)return page('Link not recognized','<h1>This referral link isn’t working.</h1><p>Ask the person who sent it for a new one.</p>',404);
  const agency=esc(clean(ref.company_name,120)||'the agency');
  const referrerFirst=clean(ref.name,120).split(' ')[0]||'';
  const action=esc('/refer/'+encodeURIComponent(clean(code,40).toLowerCase()));
  const siteKey=clean(env.TURNSTILE_SITE_KEY,200);
  const empty:Form={first:'',last:'',phone:'',email:'',zip:''};
  if(request.method!=='POST')return page('Apply to '+clean(ref.company_name,120),applyForm(agency,referrerFirst,action,siteKey,empty),200,siteKey);

  const form=await request.formData().catch(()=>null);
  const data=form?Object.fromEntries([...form.entries()].map(([k,v])=>[k,typeof v==='string'?v:''])):{};
  const values:Form={first:clean(data.first,80),last:clean(data.last,80),phone:clean(data.phone,40),email:clean(data.email,320),zip:clean(data.zip,10)};
  const retry=(error:string,status=400)=>page('Apply to '+clean(ref.company_name,120),applyForm(agency,referrerFirst,action,siteKey,values,error),status,siteKey);
  // A filled-in hidden field is a bot; act as if it worked.
  if(clean(data.website,200))return page('Thanks','<h1>Thanks.</h1><p>'+agency+' will be in touch.</p>');
  const guard=await publicFormGuard(request,env,'referral_apply',data,10,60);
  if(guard)return retry(guard.status===429?'Too many tries. Please try again later.':'Please complete the security check and try again.',guard.status);
  const phone=normalizePhone(values.phone)||'';
  const email=emailOf(values.email);
  if(!values.first)return retry('Enter your first name.');
  if(!phone)return retry('Enter a mobile phone number, like 410-555-0123.');
  if(values.email&&!email)return retry('Check your email address, or leave it blank.');
  const zip=values.zip.match(/\d{5}/)?.[0]||null;

  const employerId=clean(ref.employer_id,100);
  const onList=await db.prepare(`SELECT id FROM agency_applicants WHERE employer_id=? AND (dedupe_key=? OR phone=? OR (?!='' AND (dedupe_key=? OR lower(email)=?))) LIMIT 1`)
    .bind(employerId,phone,phone,email,email,email).first<Row>();
  if(onList)return page('Thanks',`<h1>You’re already on ${agency}’s list.</h1><p>They have your details and will be in touch.</p>`);
  // Applying through your own link is fine, but it doesn't earn a referral.
  const self=(phone&&phone===clean(ref.phone,20))||(email&&email===clean(ref.email,320).toLowerCase());
  const referrerName=clean(ref.name,120);
  await db.prepare(`INSERT INTO agency_applicants(id,employer_id,dedupe_key,first_name,last_name,email,phone,zip,source,source_detail,applied_at,referrer_id)
      VALUES (?,?,?,?,?,?,?,?,'referral',?,CURRENT_TIMESTAMP,?) ON CONFLICT(employer_id,dedupe_key) DO NOTHING`)
    .bind(crypto.randomUUID(),employerId,phone,values.first,values.last||null,email||null,phone,zip,
      self?`Used their own referral link (${referrerName})`:`Referred by ${referrerName}`,self?null:clean(ref.id,100)).run();
  return page('Thanks',`<h1>Thanks, ${esc(values.first)}.</h1><p>${agency} has your details and will reach out about open shifts.</p>`);
}
