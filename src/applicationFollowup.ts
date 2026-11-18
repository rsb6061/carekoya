// One week after an application is emailed to an agency (src/agencyApplications.ts), CareJoys asks both sides one
// question: what happened? Each email has one-tap answers; the tap opens a page with a confirm button (so mail
// scanners that open links don't answer for people) and the answer is stored in application_followups.
// Off until APPLICATION_FOLLOWUP_ENABLED="true". Each application is asked about once per side.
import { applicationFollowupEmail, withUnsubscribe } from './email';
import { unsubscribeLink } from './emailPreferences';
import { friendlyAgencyName } from './agencyFeatures';
import { sha256Hex } from './agencyInbox';
import type { FeatureEnv } from './serverFeatures';

type Row=Record<string,unknown>;
export type ApplicationFollowupEnv=FeatureEnv&{APPLICATION_FOLLOWUP_ENABLED?:string};
export type FollowupAudience='agency'|'caregiver';

const FROM='CareJoys <hello@carejoys.com>';
const ORIGIN='https://carejoys.com';
const clean=(v:unknown,max=500)=>typeof v==='string'?v.trim().slice(0,max):'';
const esc=(v:string)=>v.replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]||ch));
const validEmail=(v:string)=>/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);

/** The answers each side can give, in the order the email shows them. */
export const FOLLOWUP_ANSWERS:Record<FollowupAudience,{key:string;label:string}[]>={
  agency:[
    {key:'hired',label:'We hired them'},
    {key:'interviewed',label:'We interviewed them'},
    {key:'not_a_fit',label:'We talked, not a fit'},
    {key:'no_reach',label:'We couldn’t reach them'},
    {key:'not_reviewed',label:'Haven’t looked yet'}
  ],
  caregiver:[
    {key:'hired',label:'I got the job'},
    {key:'interviewed',label:'I had an interview'},
    {key:'contacted',label:'They contacted me'},
    {key:'no_reply',label:'No reply yet'}
  ]
};
const answerLabel=(audience:FollowupAudience,key:string)=>FOLLOWUP_ANSWERS[audience].find(a=>a.key===key)?.label||'';

export async function sendApplicationFollowups(env:ApplicationFollowupEnv,limit=20){
  if(String(env.APPLICATION_FOLLOWUP_ENABLED||'').toLowerCase()!=='true'||!env.DB||!env.EMAIL)return {sent:0,failed:0};
  // Applications emailed 7 to 30 days ago that still miss a question on either side.
  const rows=(await env.DB.prepare(`SELECT i.id,i.job_key,o.canonical_name,o.application_email,o.primary_contact_name,
      c.first_name,c.last_name,c.email AS caregiver_email,j.title AS job_title,
      (SELECT COUNT(*) FROM application_followups f WHERE f.interest_id=i.id AND f.audience='agency') AS asked_agency,
      (SELECT COUNT(*) FROM application_followups f WHERE f.interest_id=i.id AND f.audience='caregiver') AS asked_caregiver
    FROM agency_interests i JOIN agency_organizations o ON o.id=i.organization_id JOIN caregivers c ON c.id=i.caregiver_id
    LEFT JOIN caregiver_jobs j ON j.id=i.job_key
    WHERE COALESCE(o.is_test,0)=0 AND COALESCE(o.application_email,'')<>'' AND i.agency_notified_at IS NOT NULL
      AND datetime(i.agency_notified_at)<=datetime('now','-7 days') AND datetime(i.agency_notified_at)>=datetime('now','-30 days')
      AND (SELECT COUNT(*) FROM application_followups f WHERE f.interest_id=i.id)<2
    ORDER BY i.agency_notified_at LIMIT ?`).bind(limit).all<Row>()).results||[];
  let sent=0,failed=0;
  for(const r of rows){
    const agencyName=friendlyAgencyName(clean(r.canonical_name,180));
    const caregiverName=[clean(r.first_name,80),clean(r.last_name,80)].filter(Boolean).join(' ');
    const jobTitle=clean(r.job_title,160);
    const sides:{audience:FollowupAudience;to:string;greeting:string;asked:boolean}[]=[
      {audience:'agency',to:clean(r.application_email,320).toLowerCase(),greeting:clean(r.primary_contact_name,120).split(/\s+/)[0]||'',asked:Number(r.asked_agency||0)>0},
      {audience:'caregiver',to:clean(r.caregiver_email,320).toLowerCase(),greeting:clean(r.first_name,80),asked:Number(r.asked_caregiver||0)>0}
    ];
    for(const side of sides){
      if(side.asked||!validEmail(side.to))continue;
      if(await env.DB.prepare('SELECT 1 FROM email_suppressions WHERE lower(email)=? LIMIT 1').bind(side.to).first())continue;
      const token=crypto.randomUUID()+'-'+crypto.randomUUID();
      const id=crypto.randomUUID();
      // The row goes in first so a crash after sending can never send the same question twice.
      const inserted=await env.DB.prepare('INSERT OR IGNORE INTO application_followups(id,interest_id,audience,recipient_email,token_hash) VALUES (?,?,?,?,?)')
        .bind(id,r.id,side.audience,side.to,await sha256Hex(token)).run();
      if(!inserted.meta?.changes)continue;
      const link=(answer:string)=>`${ORIGIN}/application-followup?token=${encodeURIComponent(token)}&answer=${answer}`;
      const unsubscribe=await unsubscribeLink(env.DB,side.to,'application_followup');
      const body=withUnsubscribe(applicationFollowupEmail({audience:side.audience,greeting:side.greeting,agencyName,caregiverName,jobTitle,
        answers:FOLLOWUP_ANSWERS[side.audience].map(a=>({label:a.label,link:link(a.key)}))}),unsubscribe.link);
      try{
        await env.EMAIL.send({from:FROM,to:side.to,subject:body.subject,html:body.html,text:body.text,headers:unsubscribe.headers});
        sent++;
      }catch(error){
        console.error('application follow-up failed',error);
        await env.DB.prepare('DELETE FROM application_followups WHERE id=?').bind(id).run();
        failed++;
      }
    }
  }
  return {sent,failed};
}

const page=(title:string,body:string,status=200)=>new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${esc(title)}</title>
<style>body{margin:0;padding:0 16px;background:#ffffff;font-family:Arial,Helvetica,sans-serif;color:#191e49}main{max-width:480px;margin:8vh auto;padding:32px 24px;background:#f7f6fb;border:1px solid #e8e6f0;border-radius:24px}h1{font-weight:600;line-height:1.15;font-size:28px}p{color:#5b5f7e;line-height:1.6}button{background:#b8368f;color:#fff;border:0;border-radius:999px;padding:14px 22px;font-weight:700;font-size:16px;cursor:pointer}a{color:#b8368f}</style></head>
<body><main>${body}<p><small>CareJoys · carejoys.com</small></p></main></body></html>`,{status,headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-robots-tag':'noindex'}});

/** GET shows the chosen answer with a confirm button; POST records it. A later answer replaces an earlier one. */
export async function handleApplicationFollowup(request:Request,env:ApplicationFollowupEnv){
  if(!env.DB)return page('Unavailable','<h1>Please try again later.</h1>',503);
  const url=new URL(request.url);
  const token=clean(url.searchParams.get('token'),300);
  const row=token?await env.DB.prepare('SELECT id,audience FROM application_followups WHERE token_hash=? LIMIT 1').bind(await sha256Hex(token)).first<Row>():null;
  const audience=row?.audience==='agency'?'agency':row?.audience==='caregiver'?'caregiver':null;
  if(!row||!audience)return page('Link not recognized','<h1>This link isn’t working.</h1><p>You can reply to the email instead and Rebecca will see it.</p>',404);
  const form=request.method==='POST'?await request.formData().catch(()=>null):null;
  const answer=clean(form?form.get('answer'):url.searchParams.get('answer'),40);
  const label=answerLabel(audience,answer);
  if(!label)return page('Link not recognized','<h1>That answer isn’t one we know.</h1><p>Please tap one of the choices in the email.</p>',400);
  if(request.method!=='POST'){
    return page('Confirm your answer',`<h1>${esc(label)}?</h1><p>Tap to confirm. If you picked the wrong one, go back to the email and tap another.</p>
      <form method="post" action="${esc('/application-followup?token='+encodeURIComponent(token))}"><input type="hidden" name="answer" value="${esc(answer)}"><button type="submit">Yes, send my answer</button></form>`);
  }
  await env.DB.prepare('UPDATE application_followups SET answer=?,answered_at=CURRENT_TIMESTAMP WHERE id=?').bind(answer,row.id).run();
  return page('Thanks',`<h1>Thanks, that helps.</h1><p>Your answer is saved. If anything changes, tap a different choice in the same email.</p><p><a href="${ORIGIN}/${audience==='agency'?'hiring':'caregiver-jobs'}">${audience==='agency'?'Open your CareJoys workspace':'See more caregiver jobs'}</a></p>`);
}
