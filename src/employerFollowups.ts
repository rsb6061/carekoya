import { caregiverInviteReminderEmail, employerInterestNudgeEmail, caregiverRoleClosedEmail } from './email';
import { lockedIntroductions } from './billing';
import { teamRecipients } from './team';

import type { FeatureEnv } from './serverFeatures';

export type FollowupEnv=FeatureEnv;

const FROM='CareJoys <hello@carejoys.com>';
const clean=(v:unknown,max=500)=>typeof v==='string'?v.trim().slice(0,max):'';
const emailValid=(v:string)=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const firstName=(first:unknown,display:unknown)=>clean(first,100)||clean(display,120).split(/\s+/)[0]||'there';
function publicName(first:unknown,last:unknown,display:unknown){
  const f=clean(first,80),l=clean(last,80);
  if(f)return l?`${f} ${l.charAt(0).toUpperCase()}.`:f;
  return clean(display,120)||'A caregiver';
}
const NOT_SUPPRESSED=`NOT EXISTS (SELECT 1 FROM email_suppressions s WHERE lower(s.email)=lower(c.email))`;

async function log(env:FollowupEnv,caregiverId:unknown,openingId:unknown,eventType:string,pipelineId:unknown,messageId?:string){
  await env.DB!.prepare("INSERT INTO outreach_events(id,caregiver_id,opening_id,channel,direction,event_type,provider_message_id,payload) VALUES (?,?,?,'email','outbound',?,?,?)")
    .bind(crypto.randomUUID(),caregiverId,openingId,eventType,messageId||null,JSON.stringify({pipelineId})).run().catch(()=>null);
}

/**
 * Hourly. Each row gets at most one of each, claimed before sending so overlapping runs never double up:
 * - a reminder to a caregiver who hasn't answered an invitation after 2 days (still open, link still valid);
 * - a nudge to an employer whose caregiver said yes 2 days ago and is still waiting.
 * The 7-day ceiling keeps a backlog from older invitations from all going out at once.
 */
export async function sendHiringFollowups(env:FollowupEnv,limit=40){
  if(!env.DB||!env.EMAIL)return {reminders:0,nudges:0};
  let reminders=0,nudges=0;
  const unanswered=await env.DB.prepare(`SELECT cp.id,cp.opening_id,c.id AS caregiver_id,c.first_name,c.display_name,c.email,o.title,e.company_name
    FROM candidate_pipeline cp JOIN caregivers c ON c.id=cp.caregiver_id JOIN openings o ON o.id=cp.opening_id JOIN employer_leads e ON e.id=o.employer_id
    WHERE cp.stage='contacted' AND cp.response_value IS NULL AND cp.caregiver_reminded_at IS NULL AND o.status='open'
      AND datetime(cp.contacted_at)<=datetime('now','-2 days') AND datetime(cp.contacted_at)>datetime('now','-7 days')
      AND (cp.response_expires_at IS NULL OR datetime(cp.response_expires_at)>datetime('now'))
      AND c.email IS NOT NULL AND c.email!='' AND ${NOT_SUPPRESSED}
    ORDER BY cp.contacted_at ASC LIMIT ?`).bind(limit).all();
  for(const r of unanswered.results||[]){
    if(!emailValid(clean(r.email,320)))continue;
    const claimed=await env.DB.prepare("UPDATE candidate_pipeline SET caregiver_reminded_at=CURRENT_TIMESTAMP WHERE id=? AND caregiver_reminded_at IS NULL").bind(r.id).run();
    if(Number(claimed.meta?.changes||0)!==1)continue;
    // The invitation link's token is stored hashed, so the reminder sends them to their dashboard, where the same invitation can be answered.
    const mail=caregiverInviteReminderEmail({firstName:firstName(r.first_name,r.display_name),company:clean(r.company_name,200),title:clean(r.title,200),link:'https://carejoys.com/dashboard'});
    try{const sent=await env.EMAIL.send({from:FROM,to:clean(r.email,320),subject:mail.subject,html:mail.html,text:mail.text});await log(env,r.caregiver_id,r.opening_id,'invite_reminder',r.id,sent.messageId);reminders++}
    catch{await log(env,r.caregiver_id,r.opening_id,'invite_reminder_failed',r.id)}
  }
  const waiting=await env.DB.prepare(`SELECT cp.id,cp.opening_id,c.id AS caregiver_id,c.first_name,c.last_name,c.display_name,o.title,o.employer_id,e.contact_name,e.email AS employer_email
    FROM candidate_pipeline cp JOIN caregivers c ON c.id=cp.caregiver_id JOIN openings o ON o.id=cp.opening_id JOIN employer_leads e ON e.id=o.employer_id
    WHERE cp.stage='interested' AND cp.response_value='interested' AND cp.employer_nudged_at IS NULL AND o.status='open'
      AND datetime(COALESCE(cp.responded_at,cp.response_at))<=datetime('now','-2 days') AND datetime(COALESCE(cp.responded_at,cp.response_at))>datetime('now','-7 days')
      AND datetime(cp.updated_at)<=datetime('now','-2 days')
    ORDER BY cp.responded_at ASC LIMIT ?`).bind(limit).all();
  const lockedBy=new Map<string,Set<string>>();
  for(const r of waiting.results||[]){
    const employerId=clean(r.employer_id,100);
    if(!emailValid(clean(r.employer_email,320)))continue;
    // Past the free introductions the employer can't reach them yet, so "reach out" would be the wrong ask.
    if(!lockedBy.has(employerId))lockedBy.set(employerId,await lockedIntroductions(env,employerId));
    if(lockedBy.get(employerId)!.has(clean(r.id,100)))continue;
    const claimed=await env.DB.prepare("UPDATE candidate_pipeline SET employer_nudged_at=CURRENT_TIMESTAMP WHERE id=? AND employer_nudged_at IS NULL").bind(r.id).run();
    if(Number(claimed.meta?.changes||0)!==1)continue;
    const mail=employerInterestNudgeEmail({recipientName:clean(r.contact_name,120).split(/\s+/)[0]||'there',caregiverName:publicName(r.first_name,r.last_name,r.display_name),title:clean(r.title,200),
      appLink:'https://carejoys.com/app?candidate='+encodeURIComponent(clean(r.id,100))});
    const to=await teamRecipients(env,employerId,clean(r.employer_email,320));
    try{const sent=await env.EMAIL.send({from:FROM,to,subject:mail.subject,html:mail.html,text:mail.text});await log(env,r.caregiver_id,r.opening_id,'employer_interest_nudge',r.id,sent.messageId);nudges++}
    catch{await log(env,r.caregiver_id,r.opening_id,'employer_interest_nudge_failed',r.id)}
  }
  return {reminders,nudges};
}

/**
 * Tells caregivers who said yes that the role is closed: every one still waiting when the opening closes,
 * or one the employer marked not a fit. Each caregiver hears it once per opening.
 */
export async function sendRoleClosedNotices(env:FollowupEnv,where:{openingId:string;pipelineId?:string},filled:boolean){
  if(!env.DB||!env.EMAIL)return 0;
  const rows=await env.DB.prepare(`SELECT cp.id,cp.opening_id,c.id AS caregiver_id,c.first_name,c.display_name,c.email,o.title,e.company_name
    FROM candidate_pipeline cp JOIN caregivers c ON c.id=cp.caregiver_id JOIN openings o ON o.id=cp.opening_id JOIN employer_leads e ON e.id=o.employer_id
    WHERE cp.opening_id=? ${where.pipelineId?'AND cp.id=?':"AND cp.stage IN ('interested','interview')"} AND cp.response_value='interested' AND cp.closed_notice_at IS NULL
      AND c.email IS NOT NULL AND c.email!='' AND ${NOT_SUPPRESSED} LIMIT 100`).bind(...(where.pipelineId?[where.openingId,where.pipelineId]:[where.openingId])).all();
  let sent=0;
  for(const r of rows.results||[]){
    if(!emailValid(clean(r.email,320)))continue;
    const claimed=await env.DB.prepare("UPDATE candidate_pipeline SET closed_notice_at=CURRENT_TIMESTAMP WHERE id=? AND closed_notice_at IS NULL").bind(r.id).run();
    if(Number(claimed.meta?.changes||0)!==1)continue;
    const mail=caregiverRoleClosedEmail({firstName:firstName(r.first_name,r.display_name),company:clean(r.company_name,200),title:clean(r.title,200),filled,jobsLink:'https://carejoys.com/dashboard'});
    try{const res=await env.EMAIL.send({from:FROM,to:clean(r.email,320),subject:mail.subject,html:mail.html,text:mail.text});await log(env,r.caregiver_id,r.opening_id,filled?'role_filled_notice':'not_selected_notice',r.id,res.messageId);sent++}
    catch{await log(env,r.caregiver_id,r.opening_id,'role_closed_notice_failed',r.id)}
  }
  return sent;
}
