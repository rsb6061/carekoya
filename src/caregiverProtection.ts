// Caregiver protection on the server: who an agency may see or invite (unsubscribes, pauses, hidden-from lists),
// the per-caregiver and per-workspace invitation caps, and the daily browsing limits.
import type { FeatureEnv } from './serverFeatures';
import { contactAllowance, type BillingEnv } from './billing';
import { CAREGIVER_WEEKLY_INVITES, FREE_WEEKLY_INVITES, PAID_WEEKLY_INVITES } from './caregiverProtectionRules';

type Row=Record<string,unknown>;
const asNum=(v:unknown)=>{const n=Number(v||0);return Number.isFinite(n)?n:0};

/** The caregiver (c) unsubscribed from CareJoys email. */
export const SUPPRESSED_SQL=`EXISTS (SELECT 1 FROM email_suppressions s WHERE lower(s.email)=lower(c.email))`;
/** The caregiver (c) paused invitations. */
export const INVITES_PAUSED_SQL=`(c.invites_paused_until IS NOT NULL AND datetime(c.invites_paused_until)>datetime('now'))`;
/** The caregiver (c) hid their profile from the employer; bind the employer id. */
export const HIDDEN_FROM_EMPLOYER_SQL=`EXISTS (SELECT 1 FROM caregiver_hidden_employers h WHERE h.employer_id=? AND h.caregiver_id=c.id)`;
/** Neither paused nor hidden from the employer; bind the employer id. */
export const OPEN_TO_EMPLOYER_SQL=`(NOT ${INVITES_PAUSED_SQL} AND NOT ${HIDDEN_FROM_EMPLOYER_SQL})`;

const RECENT=`cp.contacted_at IS NOT NULL AND datetime(cp.contacted_at)>datetime('now','-7 days')`;
const PENDING=`cp.stage='contacted' AND cp.response_value IS NULL AND (cp.response_expires_at IS NULL OR datetime(cp.response_expires_at)>datetime('now'))`;

/** Invitations the workspace sent in the last 7 days, and how many it may send: 75 on the paid plan, 15 otherwise. */
export async function inviteAllowance(env:BillingEnv,employerId:string,subscribed?:boolean){
  const paid=subscribed??(await contactAllowance(env,employerId)).subscribed;
  const row=await env.DB!.prepare(`SELECT COUNT(*) AS n FROM candidate_pipeline cp JOIN openings o ON o.id=cp.opening_id WHERE o.employer_id=? AND ${RECENT}`).bind(employerId).first<Row>();
  return {used:asNum(row?.n),limit:paid?PAID_WEEKLY_INVITES:FREE_WEEKLY_INVITES};
}

/** Invitations from the workspace still waiting for an answer. */
export async function pendingInvites(env:FeatureEnv,employerId:string){
  const row=await env.DB!.prepare(`SELECT COUNT(*) AS n FROM candidate_pipeline cp JOIN openings o ON o.id=cp.opening_id WHERE o.employer_id=? AND ${PENDING}`).bind(employerId).first<Row>();
  return asNum(row?.n);
}

/** Why one caregiver can't get a new invitation from this workspace now, or null. Test workspaces' invitations never reach anyone, so they don't count. */
export async function caregiverInviteBlock(env:FeatureEnv,employerId:string,caregiverId:string):Promise<'pendingFromYou'|'caregiverWeekly'|null>{
  const pending=await env.DB!.prepare(`SELECT 1 FROM candidate_pipeline cp JOIN openings o ON o.id=cp.opening_id WHERE o.employer_id=? AND cp.caregiver_id=? AND ${PENDING} LIMIT 1`).bind(employerId,caregiverId).first();
  if(pending)return 'pendingFromYou';
  const week=await env.DB!.prepare(`SELECT COUNT(*) AS n FROM candidate_pipeline cp JOIN openings o ON o.id=cp.opening_id JOIN employer_leads e ON e.id=o.employer_id
    WHERE cp.caregiver_id=? AND COALESCE(e.is_test,0)=0 AND ${RECENT}`).bind(caregiverId).first<Row>();
  return asNum(week?.n)>=CAREGIVER_WEEKLY_INVITES?'caregiverWeekly':null;
}

/** Counts one search or profile view; a 429 once the workspace is past its daily limit (a UTC day). */
export async function browseLimit(env:FeatureEnv,employerId:string,bucket:'talent_search'|'talent_view',limit:number){
  if(!env.DB)return null;
  const start=new Date().toISOString().slice(0,10);
  await env.DB.prepare("INSERT INTO rate_limits(bucket,identity,window_start,count) VALUES (?,?,?,1) ON CONFLICT(bucket,identity,window_start) DO UPDATE SET count=count+1,updated_at=CURRENT_TIMESTAMP").bind(bucket,employerId,start).run();
  const row=await env.DB.prepare('SELECT count FROM rate_limits WHERE bucket=? AND identity=? AND window_start=?').bind(bucket,employerId,start).first<Row>();
  if(asNum(row?.count)<=limit)return null;
  const error=bucket==='talent_search'?`You've reached today's limit of ${limit} caregiver searches. Try again tomorrow.`:`You've reached today's limit of ${limit} caregiver profile views. Try again tomorrow.`;
  return new Response(JSON.stringify({ok:false,error}),{status:429,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
}
