import { schoolPlacementInviteEmail } from './email';
import { unsubscribeLink, isSuppressed } from './emailPreferences';
import { withUnsubscribe } from './email';
import type { FeatureEnv } from './serverFeatures';

type Row=Record<string,unknown>;
const clean=(v:unknown,max=500)=>typeof v==='string'?v.trim().slice(0,max):'';
const n=(v:unknown)=>Number(v||0)||0;

export type SchoolOutreachEnv=FeatureEnv&{SCHOOL_OUTREACH_ENABLED?:string;SCHOOL_OUTREACH_DAILY_CAP?:string};
export async function schoolOutreachCounts(env:SchoolOutreachEnv){
 if(!env.DB)return {today:0,total:0,eligible:0};
 const counts=await env.DB.prepare("SELECT COUNT(*) AS total,SUM(datetime(created_at)>=datetime('now','start of day')) AS today FROM training_program_outreach WHERE event_type='school_intro'").first<Row>();
 const eligible=await env.DB.prepare(`SELECT COUNT(*) AS count FROM training_programs p WHERE p.is_active=1 AND upper(coalesce(p.state,''))='MD'
 AND p.claimed_school_lead_id IS NULL AND p.email IS NOT NULL AND trim(p.email)!=''
 AND EXISTS(SELECT 1 FROM school_referral_codes rc WHERE rc.training_program_id=p.id AND rc.status='active')
 AND NOT EXISTS(SELECT 1 FROM email_suppressions s WHERE s.email=lower(trim(p.email)))
 AND NOT EXISTS(SELECT 1 FROM training_program_outreach o WHERE o.training_program_id=p.id AND o.event_type IN ('school_intro','school_intro_failed'))`).first<Row>();
 return {today:n(counts?.today),total:n(counts?.total),eligible:n(eligible?.count)};
}

/** Independently capped, opt-out-respecting invitations. Each school receives at most one attempt. */
export async function sendSchoolPlacementInvites(env:SchoolOutreachEnv){
 if(!env.DB||!env.EMAIL||env.SCHOOL_OUTREACH_ENABLED!=='true')return {disabled:true,sent:0,failed:0};
 const cap=Math.max(0,Math.min(100,Math.floor(Number(env.SCHOOL_OUTREACH_DAILY_CAP??15)||0)));
 const counts=await schoolOutreachCounts(env);
 const remaining=Math.max(0,Math.min(5,cap-counts.today));
 if(!remaining)return {disabled:false,sent:0,failed:0};
 const rows=await env.DB.prepare(`SELECT p.id,p.program_name,p.email,p.provider_type,
 (SELECT rc.slug FROM school_referral_codes rc WHERE rc.training_program_id=p.id AND rc.status='active' ORDER BY rc.created_at LIMIT 1) AS slug
 FROM training_programs p WHERE p.is_active=1 AND upper(coalesce(p.state,''))='MD'
 AND p.claimed_school_lead_id IS NULL AND p.email IS NOT NULL AND trim(p.email)!=''
 AND EXISTS(SELECT 1 FROM school_referral_codes rc WHERE rc.training_program_id=p.id AND rc.status='active')
 AND NOT EXISTS(SELECT 1 FROM email_suppressions s WHERE s.email=lower(trim(p.email)))
 AND NOT EXISTS(SELECT 1 FROM training_program_outreach o WHERE o.training_program_id=p.id AND o.event_type IN ('school_intro','school_intro_failed'))
 ORDER BY CASE WHEN p.provider_type IN ('Freestanding Program','College') THEN 0 ELSE 1 END,p.created_at LIMIT ?`).bind(remaining).all<Row>();
 let sent=0,failed=0;
 for(const p of rows.results||[]){
  const email=clean(p.email,320).toLowerCase();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||await isSuppressed(env.DB,email))continue;
  const link='https://carejoys.com/school/'+encodeURIComponent(clean(p.slug,200));
  const content=schoolPlacementInviteEmail({contactName:'',programName:clean(p.program_name,200),claimLink:link});
  try{
   const unsubscribe=await unsubscribeLink(env.DB,email,'school_intro');
   const body=withUnsubscribe(content,unsubscribe.link);
   const result=await env.EMAIL.send({from:'CareJoys <hello@carejoys.com>',to:email,subject:body.subject,html:body.html,text:body.text,headers:unsubscribe.headers});
   await env.DB.prepare("INSERT INTO training_program_outreach(id,training_program_id,event_type,recipient,provider_message_id) VALUES (?,?,'school_intro',?,?)").bind(crypto.randomUUID(),p.id,email,result.messageId||null).run();
   sent++;
  }catch(error){
   await env.DB.prepare("INSERT INTO training_program_outreach(id,training_program_id,event_type,recipient,payload) VALUES (?,?,'school_intro_failed',?,?)").bind(crypto.randomUUID(),p.id,email,JSON.stringify({error:error instanceof Error?error.message:'send failed'})).run();
   failed++;
  }
 }
 return {disabled:false,sent,failed};
}
