import { caregiverActivationEmail, withUnsubscribe } from './email';
import { unsubscribeLink } from './emailPreferences';
import { sendAgencyTeaserBatch } from './agencyFeatures';
import { type FeatureEnv } from './serverFeatures';

type Row=Record<string,unknown>;
export type OutreachKind='reactivation'|'agency_teasers';
export type OutreachEnv=FeatureEnv&{
  OUTREACH_ENABLED?:string;
  REACTIVATION_DAILY_CAP?:string;
  AGENCY_TEASER_DAILY_CAP?:string;
};

export const DEFAULT_DAILY_CAPS:Record<OutreachKind,number>={reactivation:50,agency_teasers:10};
const clean=(v:unknown,max=500)=>typeof v==='string'?v.trim().slice(0,max):'';
const asNum=(v:unknown)=>{const n=Number(v||0);return Number.isFinite(n)?n:0};

async function sha256Hex(value:string){
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash)).map(b=>b.toString(16).padStart(2,'0')).join('');
}

export function outreachEnabled(env:OutreachEnv){
  return clean(env.OUTREACH_ENABLED,10).toLowerCase()==='true';
}

/** Daily cap from env (0 pauses that kind), falling back to the default; never above 500. */
export function dailyCap(env:OutreachEnv,kind:OutreachKind){
  const raw=kind==='reactivation'?env.REACTIVATION_DAILY_CAP:env.AGENCY_TEASER_DAILY_CAP;
  if(raw===undefined||clean(raw)==='')return DEFAULT_DAILY_CAPS[kind];
  const n=Math.floor(Number(raw));
  return Number.isFinite(n)?Math.max(0,Math.min(500,n)):DEFAULT_DAILY_CAPS[kind];
}

/** Emails sent today (UTC) for a kind, counted from the records each sender already writes. */
export async function sentToday(env:OutreachEnv,kind:OutreachKind){
  if(!env.DB)return 0;
  const row=kind==='reactivation'
    ?await env.DB.prepare("SELECT COUNT(*) AS count FROM caregivers WHERE source='legacy_carekoya' AND activation_delivery_status='sent' AND datetime(activation_sent_at)>=datetime('now','start of day')").first<Row>()
    :await env.DB.prepare("SELECT COUNT(*) AS count FROM agency_outreach_events WHERE event_type='candidate_teaser' AND datetime(created_at)>=datetime('now','start of day')").first<Row>();
  return asNum(row?.count);
}

export function remainingToday(cap:number,sent:number){
  return Math.max(0,cap-sent);
}

/** Emails legacy CareKoya caregivers a one-time link to confirm current availability. */
export async function sendReactivationBatch(env:OutreachEnv,limit:number){
  if(!env.DB||!env.EMAIL||limit<1)return {attempted:0,sent:0,failed:0};
  const rows=await env.DB.prepare(`SELECT id,first_name,display_name,lower(trim(email)) AS email FROM caregivers c
    WHERE c.source='legacy_carekoya' AND c.activation_sent_at IS NULL AND c.activation_completed_at IS NULL
      AND c.email IS NOT NULL AND trim(c.email)!='' AND COALESCE(c.work_status,'unknown') NOT IN ('not_looking','merged_duplicate')
      AND NOT EXISTS (SELECT 1 FROM email_suppressions es WHERE es.email=lower(trim(c.email)))
    ORDER BY c.updated_at DESC LIMIT ?`).bind(limit).all<Row>();
  let sent=0,failed=0;
  for(const row of rows.results||[]){
    const email=clean(row.email,320);
    const token=crypto.randomUUID()+'-'+crypto.randomUUID();
    const firstName=clean(row.first_name,100)||clean(row.display_name,120).split(/\s+/)[0]||'there';
    try{
      await env.DB.prepare("UPDATE caregivers SET activation_token_hash=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(await sha256Hex(token),row.id).run();
      const unsubscribe=await unsubscribeLink(env.DB,email,'caregiver_reactivation');
      const body=withUnsubscribe(caregiverActivationEmail(firstName,'https://carejoys.com/activate?token='+encodeURIComponent(token)),unsubscribe.link);
      const result=await env.EMAIL.send({from:'CareJoys <updates@carejoys.com>',to:email,subject:body.subject,html:body.html,text:body.text,headers:unsubscribe.headers});
      await env.DB.prepare("UPDATE caregivers SET activation_sent_at=CURRENT_TIMESTAMP,activation_message_id=?,activation_delivery_status='sent',activation_delivery_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?")
        .bind(result.messageId||null,row.id).run();
      await env.DB.prepare("INSERT INTO outreach_events(id,caregiver_id,channel,direction,event_type,provider_message_id) VALUES (?,?,'email','outbound','reactivation_request',?)")
        .bind(crypto.randomUUID(),row.id,result.messageId||null).run();
      sent++;
    }catch(error){
      failed++;
      // Mark as attempted so a bad address isn't retried every day.
      await env.DB.prepare("UPDATE caregivers SET activation_sent_at=CURRENT_TIMESTAMP,activation_token_hash=NULL,activation_delivery_status='failed',activation_delivery_error=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
        .bind((error instanceof Error?error.message:'send failed').slice(0,500),row.id).run();
    }
  }
  return {attempted:(rows.results||[]).length,sent,failed};
}

/** Sends up to today's remaining cap for one outreach kind and records the run. */
export async function runOutreach(env:OutreachEnv,kind:OutreachKind,trigger:'cron'|'admin'){
  if(!env.DB||!env.EMAIL)return {kind,skipped:'email_not_configured',attempted:0,sent:0,failed:0};
  const cap=dailyCap(env,kind);
  const remaining=remainingToday(cap,await sentToday(env,kind));
  if(remaining<1)return {kind,skipped:'daily_cap_reached',cap,attempted:0,sent:0,failed:0};
  const result=kind==='reactivation'?await sendReactivationBatch(env,remaining):await sendAgencyTeaserBatch(env,remaining);
  await env.DB.prepare('INSERT INTO outreach_runs(id,kind,trigger,attempted,sent,failed) VALUES (?,?,?,?,?,?)')
    .bind(crypto.randomUUID(),kind,trigger,result.attempted,result.sent,result.failed).run();
  return {kind,cap,...result};
}

/** Daily cron entry point. Does nothing until OUTREACH_ENABLED=true is set on the Worker. */
export async function runScheduledOutreach(env:OutreachEnv){
  if(!outreachEnabled(env))return [];
  return [await runOutreach(env,'reactivation','cron'),await runOutreach(env,'agency_teasers','cron')];
}

export async function outreachStatus(env:OutreachEnv){
  const kinds:OutreachKind[]=['reactivation','agency_teasers'];
  const today=await Promise.all(kinds.map(async kind=>({kind,cap:dailyCap(env,kind),sentToday:await sentToday(env,kind)})));
  const remainingReactivation=await env.DB!.prepare(`SELECT COUNT(*) AS count FROM caregivers c WHERE c.source='legacy_carekoya' AND c.activation_sent_at IS NULL AND c.activation_completed_at IS NULL
    AND c.email IS NOT NULL AND trim(c.email)!='' AND COALESCE(c.work_status,'unknown') NOT IN ('not_looking','merged_duplicate')
    AND NOT EXISTS (SELECT 1 FROM email_suppressions es WHERE es.email=lower(trim(c.email)))`).first<Row>();
  const runs=await env.DB!.prepare('SELECT kind,trigger,attempted,sent,failed,created_at FROM outreach_runs ORDER BY created_at DESC LIMIT 20').all<Row>();
  const suppressions=await env.DB!.prepare('SELECT COUNT(*) AS count FROM email_suppressions').first<Row>();
  return {
    enabled:outreachEnabled(env),
    today,
    reactivationQueue:asNum(remainingReactivation?.count),
    unsubscribes:asNum(suppressions?.count),
    recentRuns:runs.results||[]
  };
}
