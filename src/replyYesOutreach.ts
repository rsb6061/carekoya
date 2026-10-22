// Agency outreach as a plain-text note from Rebecca that asks for a one-word reply (Rebecca chose this 2026-10-22,
// for every state, agencies listing the most jobs on CareJoys first). It replaces the styled hiring invite while
// AGENCY_OUTREACH_EMAIL is "reply_yes", shares that invite's daily cap, and sends nothing until a message to
// rebecca@carejoys.com has reached the Worker: proof the Email Routing rule exists, so replies are recorded.
import { unsubscribeLink } from './emailPreferences';
import type { EmailBinding } from './email';

type Row=Record<string,unknown>;
type Statement={bind(...values:unknown[]):Statement;run():Promise<{success:boolean;meta?:Record<string,unknown>}>;first<T=Row>():Promise<T|null>;all<T=Row>():Promise<{results?:T[]}>};
type DB={prepare(query:string):Statement};
export type ReplyYesEnv={DB?:DB;EMAIL?:EmailBinding};

export const REBECCA_EMAIL='rebecca@carejoys.com';
export const REBECCA_FROM='Rebecca Myers <'+REBECCA_EMAIL+'>';
export const REPLY_YES_EVENT='reply_yes_invite';

const clean=(v:unknown,max=500)=>typeof v==='string'?v.trim().slice(0,max):'';
const asNum=(v:unknown)=>{const n=Number(v||0);return Number.isFinite(n)?n:0};

/** "Village Caregiving, LLC" reads as "Village Caregiving"; "ACME HOME CARE INC" as "Acme Home Care". */
export function agencyNameForEmail(name:string){
  let n=name.replace(/\s*[|(].*$/,'').replace(/[,\s]+(llc|l\.l\.c\.|inc\.?|incorporated|corp\.?|corporation|co\.|ltd\.?|pllc|pc)$/i,'').trim()||name.trim();
  if(n===n.toUpperCase()&&/[A-Z]{3}/.test(n))n=n.toLowerCase().replace(/\b[a-z]/g,c=>c.toUpperCase());
  return n;
}

/** Two subject lines tested against each other; an agency always gets the same one. */
export function replyYesVariant(orgId:string):'a'|'b'{
  let h=0;for(const c of orgId)h=(h*31+c.charCodeAt(0))>>>0;
  return h%2?'b':'a';
}

export function replyYesEmail(input:{contactName:string;agencyName:string;variant:'a'|'b';unsubscribeLink:string}){
  const first=clean(input.contactName,120).split(/\s+/)[0]||'';
  const agency=agencyNameForEmail(clean(input.agencyName,180))||'your agency';
  return {
    subject:input.variant==='a'?`Quick question about ${agency}`:'Your caregiver applicants',
    text:[
      `Hi ${first||'there'},`,
      `Quick question: do caregiver applicants go quiet before ${agency} can call them back?`,
      `I run CareJoys. We answer every new applicant within 30 minutes, ask your screening questions, and book the ones who fit into your interview times. Every Monday you get a list of who applied and who showed up.`,
      `If that would help, reply "yes" and I'll set it up for you. The first month is free.`,
      `Rebecca Myers\nCareJoys · carejoys.com`,
      `Not for you? Reply "stop", or unsubscribe: ${input.unsubscribeLink}`
    ].join('\n\n')
  };
}

/** True once any message to rebecca@ has been recorded: the Email Routing rule sends that address to the Worker. */
export async function rebeccaRoutingLive(db:DB){
  const row=await db.prepare("SELECT 1 AS hit FROM email_messages WHERE direction='inbound' AND mailbox=? LIMIT 1").bind(REBECCA_EMAIL).first<Row>().catch(()=>null);
  return !!row;
}

// Licensed or NPI-registered home care agencies, any agency with jobs on CareJoys, and Google listings only when they
// are "Home health care service" with a care word in the name (the rest of Google's tags include roofers and lawyers).
// Jobs are counted in one grouped pass: a count per agency runs past D1's CPU limit at this size.
const JOB_COUNTS="SELECT agency_organization_id AS id,COUNT(*) AS jobs FROM caregiver_jobs WHERE status='current' AND is_published=1 AND agency_organization_id IS NOT NULL GROUP BY agency_organization_id";
const CARE_NAME=['care','home','senior','nurs','health','angel','staff'].map(w=>`lower(o.canonical_name) LIKE '%${w}%'`).join(' OR ');
const REPLY_YES_ELIGIBLE_SQL=`SELECT o.id,o.canonical_name,o.primary_email,o.primary_contact_name,o.state,COALESCE(j.jobs,0) AS job_count
    FROM agency_organizations o
    LEFT JOIN (${JOB_COUNTS}) j ON j.id=o.id
    WHERE o.is_active=1 AND COALESCE(o.is_test,0)=0 AND o.claimed_employer_id IS NULL
      AND COALESCE(o.provider_kind,'home_care')='home_care' AND COALESCE(o.is_chain,0)=0
      AND o.primary_email IS NOT NULL AND o.primary_email!=''
      AND (o.sources LIKE '%license%' OR o.npi IS NOT NULL OR j.jobs>0 OR (o.provider_types LIKE '%Home health care service%' AND (${CARE_NAME})))
      AND NOT EXISTS (SELECT 1 FROM email_suppressions es WHERE es.email=lower(trim(o.primary_email)))
      -- Once per agency and per address, and never within two weeks of any other CareJoys email to the agency.
      AND NOT EXISTS (SELECT 1 FROM agency_outreach_events e WHERE e.organization_id=o.id AND (e.event_type IN ('${REPLY_YES_EVENT}','${REPLY_YES_EVENT}_failed') OR e.created_at>datetime('now','-14 days')))
      AND NOT EXISTS (SELECT 1 FROM agency_outreach_events e WHERE e.recipient_email=lower(trim(o.primary_email)) AND e.event_type IN ('${REPLY_YES_EVENT}','${REPLY_YES_EVENT}_failed'))
    ORDER BY job_count DESC,o.caregiver_relevance_score DESC,o.id
    LIMIT ?`;

/** Sends the reply-yes note to up to `limit` agencies. Sends nothing until rebecca@ is routed to the Worker. */
export async function sendReplyYesBatch(env:ReplyYesEnv,limit:number){
  if(!env.DB||!env.EMAIL||limit<=0)return {attempted:0,sent:0,failed:0,waitingForRouting:false};
  if(!await rebeccaRoutingLive(env.DB))return {attempted:0,sent:0,failed:0,waitingForRouting:true};
  const orgs=(await env.DB.prepare(REPLY_YES_ELIGIBLE_SQL).bind(limit).all<Row>()).results||[];
  const seen=new Set<string>();
  let sent=0,failed=0;
  for(const org of orgs){
    const email=clean(org.primary_email,320).toLowerCase();
    if(seen.has(email))continue;
    seen.add(email);
    const variant=replyYesVariant(String(org.id));
    const unsubscribe=await unsubscribeLink(env.DB,email,'agency_reply_yes');
    const body=replyYesEmail({contactName:clean(org.primary_contact_name,120),agencyName:clean(org.canonical_name,180),variant,unsubscribeLink:unsubscribe.link});
    try{
      const result=await env.EMAIL.send({from:REBECCA_FROM,replyTo:REBECCA_EMAIL,to:email,subject:body.subject,text:body.text,headers:unsubscribe.headers});
      await env.DB.prepare("INSERT INTO agency_outreach_events(id,organization_id,event_type,recipient_email,provider_message_id,payload) VALUES (?,?,?,?,?,?)")
        .bind(crypto.randomUUID(),org.id,REPLY_YES_EVENT,email,result.messageId||null,JSON.stringify({variant,subject:body.subject,jobCount:asNum(org.job_count),state:clean(org.state,4)})).run();
      sent++;
    }catch(error){
      // A sending limit is the account's, not this agency's: stop and leave everyone queued for a later run.
      const code=String((error as {code?:unknown})?.code||'');
      const message=error instanceof Error?error.message:'';
      if(/LIMIT_EXCEEDED/.test(code)||/quota|limit exceeded/i.test(message))break;
      await env.DB.prepare("INSERT INTO agency_outreach_events(id,organization_id,event_type,recipient_email,payload) VALUES (?,?,?,?,?)")
        .bind(crypto.randomUUID(),org.id,REPLY_YES_EVENT+'_failed',email,JSON.stringify({error:message||'send failed'})).run();
      failed++;
    }
  }
  return {attempted:orgs.length,sent,failed,waitingForRouting:false};
}

/** Reply-yes notes sent today (UTC) and ever, the replies they got, and whether rebecca@ is routed yet. */
export async function replyYesCounts(env:ReplyYesEnv){
  if(!env.DB)return {today:0,total:0,replies:0,routingLive:false};
  const row=await env.DB.prepare(`SELECT COUNT(*) AS total,COALESCE(SUM(CASE WHEN datetime(created_at)>=datetime('now','start of day') THEN 1 ELSE 0 END),0) AS today
    FROM agency_outreach_events WHERE event_type='${REPLY_YES_EVENT}'`).first<Row>();
  const replies=await env.DB.prepare(`SELECT COUNT(DISTINCT m.from_email) AS n FROM email_messages m
    WHERE m.direction='inbound' AND m.kind IN ('reply','unsubscribe') AND EXISTS (SELECT 1 FROM agency_outreach_events e WHERE e.event_type='${REPLY_YES_EVENT}' AND e.recipient_email=m.from_email)`).first<Row>();
  return {today:asNum(row?.today),total:asNum(row?.total),replies:asNum(replies?.n),routingLive:await rebeccaRoutingLive(env.DB)};
}

/** The note as an agency would get it, to `to`, marked [Test]. Replying to it is how rebecca@'s routing gets proven. */
export async function sendReplyYesTest(env:ReplyYesEnv,to:string){
  if(!env.EMAIL)throw new Error('Email is not configured');
  const body=replyYesEmail({contactName:'Dana',agencyName:'Brightway Home Care, LLC',variant:'a',unsubscribeLink:'https://carejoys.com/api/unsubscribe'});
  await env.EMAIL.send({from:REBECCA_FROM,replyTo:REBECCA_EMAIL,to,subject:'[Test] '+body.subject,text:body.text});
  return {to,subject:'[Test] '+body.subject};
}
