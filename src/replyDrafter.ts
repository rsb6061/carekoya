// Suggested answers to email people send hello@ and rebecca@. Each new reply gets one draft in /admin Inbox, written
// in Rebecca's voice from src/emailPlaybook.ts and the conversation so far. Nothing here sends: Rebecca reads, edits and
// presses Send herself. The draft keeps its first version (draft_original) so her edits can be learned from.
// Claude writes the drafts when the Worker has an ANTHROPIC_API_KEY secret; until then Workers AI does.
import Anthropic from '@anthropic-ai/sdk';
import { credentialListLabel, parseRequiredCredentials } from './agencyApplications';
import { EMAIL_EXAMPLES, EMAIL_PLAYBOOK } from './emailPlaybook';
import { forwardTarget, type InboundEnv } from './inboundEmail';
import { DEFAULT_SUMMARY_MODEL, type AiBinding } from './jobSummary';
import { REBECCA_EMAIL, REPLY_YES_EVENT, replyYesEmail, type ReplyYesVariant } from './replyYesOutreach';
import type { EmailBinding } from './email';

type Row=Record<string,unknown>;
export type ReplyDraftEnv=InboundEnv&{AI?:AiBinding;EMAIL?:EmailBinding;ANTHROPIC_API_KEY?:string;REPLY_DRAFTS_ENABLED?:string;REPLY_DRAFT_MODEL?:string;INBOX_DIGEST_ENABLED?:string};

const clean=(v:unknown,max=500)=>typeof v==='string'?v.trim().slice(0,max):'';
const lower=(v:unknown)=>clean(v,320).toLowerCase();
export const DEFAULT_DRAFT_MODEL='claude-opus-5-5';
/** Replies older than this are left alone: by then Rebecca has seen them in Gmail. */
const DRAFT_WINDOW='-3 days';

export const replyDraftsEnabled=(env:ReplyDraftEnv)=>String(env.REPLY_DRAFTS_ENABLED||'').toLowerCase()==='true';

/** Everything the drafter knows about one reply: the message, the conversation before it, and the agency's setup. */
export async function draftContext(env:ReplyDraftEnv,inboundId:string){
  const db=env.DB!;
  const msg=await db.prepare(`SELECT id,mailbox,from_email,from_name,subject,snippet,lead_type,lead_id,lead_name,created_at FROM email_messages
    WHERE id=? AND direction='inbound' AND kind='reply'`).bind(inboundId).first<Row>();
  if(!msg)return null;
  const email=lower(msg.from_email);
  const history=((await db.prepare(`SELECT direction,subject,snippet,created_at FROM email_messages
    WHERE id<>? AND ((direction='inbound' AND kind='reply' AND lower(from_email)=?) OR (direction='outbound' AND status='sent' AND lower(to_email)=?))
    ORDER BY created_at DESC LIMIT 8`).bind(inboundId,email,email).all<Row>()).results||[]).reverse()
    .map(r=>({from:r.direction==='inbound'?'them':'Rebecca',subject:clean(r.subject,300),text:clean(r.snippet,3000).split(/\n\nOn [^\n]* wrote:\n/)[0],at:clean(r.created_at,40)}));
  let agency:Row|null=null,note:{subject:string;text:string}|null=null;
  if(msg.lead_type==='agency'&&msg.lead_id){
    agency=await db.prepare(`SELECT o.canonical_name,o.city,o.state,o.primary_contact_name,o.application_email,o.required_credentials,o.claimed_employer_id,
      (SELECT COUNT(*) FROM caregiver_jobs j WHERE j.agency_organization_id=o.id AND j.status='current' AND j.is_published=1) AS live_jobs
      FROM agency_organizations o WHERE o.id=?`).bind(msg.lead_id).first<Row>();
    const sent=await db.prepare(`SELECT payload FROM agency_outreach_events WHERE event_type=? AND (organization_id=? OR lower(recipient_email)=?) ORDER BY created_at DESC LIMIT 1`)
      .bind(REPLY_YES_EVENT,msg.lead_id,email).first<Row>();
    if(sent&&agency){
      let payload:Row={};
      try{payload=JSON.parse(String(sent.payload||'{}')) as Row}catch{/* older rows */}
      const variant:ReplyYesVariant=payload.variant==='jobs'||payload.variant==='b'?payload.variant:'a';
      note=replyYesEmail({contactName:clean(agency.primary_contact_name,120),agencyName:clean(agency.canonical_name,180),variant,unsubscribeLink:'(unsubscribe link)',
        jobCount:Number(payload.jobCount||0),city:clean(payload.city,80)});
    }
  }
  return {msg,history,agency,note};
}

type DraftContext=NonNullable<Awaited<ReturnType<typeof draftContext>>>;

/** The facts and conversation as one plain-text brief; the playbook goes in the system prompt. */
export function draftPrompt({msg,history,agency,note}:DraftContext){
  const lines:string[]=[];
  lines.push('Facts about who wrote (from CareJoys records; trust these over guesses):');
  lines.push(`- From: ${clean(msg.from_name,200)||'(no name)'} <${lower(msg.from_email)}>, written to ${clean(msg.mailbox,320)}`);
  if(msg.lead_type)lines.push(`- Matched to: ${clean(msg.lead_type,40)} "${clean(msg.lead_name,200)}"`);
  else lines.push('- Not matched to any agency, employer or caregiver on CareJoys.');
  if(agency){
    const creds=credentialListLabel(parseRequiredCredentials(agency.required_credentials));
    lines.push(`- Agency: ${clean(agency.canonical_name,200)}${agency.city?`, ${clean(agency.city,80)}`:''}${agency.state?` ${clean(agency.state,10)}`:''}; ${Number(agency.live_jobs||0)} live caregiver jobs on CareJoys`);
    lines.push(agency.application_email?`- Set up: applications already go to ${clean(agency.application_email,320)}.`:'- Not set up yet: applications do not go to their inbox yet.');
    lines.push(creds?`- License filter on: only ${creds} can apply.`:'- No license filter.');
    lines.push(agency.claimed_employer_id?'- They have a CareJoys account (sign in at carejoys.com/login with this email).':'- No CareJoys account yet.');
  }
  if(note)lines.push('','The outreach note Rebecca sent them:',`Subject: ${note.subject}`,note.text.split('\n\nNot for you?')[0]);
  if(history.length){
    lines.push('','Earlier messages in this conversation, oldest first:');
    for(const h of history)lines.push(`[${h.from}, ${h.at}] ${h.subject?h.subject+' — ':''}${h.text}`);
  }
  lines.push('','The message to answer:',`Subject: ${clean(msg.subject,300)}`,clean(msg.snippet,2000));
  lines.push('','Write Rebecca\'s reply. Output only the email body, starting with the greeting and ending with the sign-off. No subject line, no notes.');
  return lines.join('\n');
}

const SYSTEM=EMAIL_PLAYBOOK+'\n\nReplies Rebecca sent before, as examples of her voice:\n\n'+EMAIL_EXAMPLES.map(e=>`(${e.situation})\n${e.reply}`).join('\n\n---\n\n');

/** The model's text as a draft body: trimmed, without a stray subject line or quoted history. */
export function cleanDraft(raw:string){
  let text=raw.replace(/\r/g,'').trim().replace(/^subject:[^\n]*\n+/i,'').trim();
  text=text.split(/\n\nOn [^\n]* wrote:\n/)[0].trim();
  return text.length>=20?text.slice(0,4000):'';
}

async function writeWithClaude(env:ReplyDraftEnv,prompt:string){
  const client=new Anthropic({apiKey:env.ANTHROPIC_API_KEY,timeout:90_000,maxRetries:1});
  const response=await client.beta.messages.create({
    model:clean(env.REPLY_DRAFT_MODEL,80)||DEFAULT_DRAFT_MODEL,
    max_tokens:4000,
    output_config:{effort:'low'},
    betas:['server-side-fallback-2026-07-01'],
    fallbacks:'default',
    system:SYSTEM,
    messages:[{role:'user',content:prompt}]
  });
  if(response.stop_reason==='refusal')return '';
  return response.content.map(b=>b.type==='text'?b.text:'').join('');
}

async function writeWithWorkersAi(env:ReplyDraftEnv,prompt:string){
  const out=await env.AI!.run(DEFAULT_SUMMARY_MODEL,{messages:[{role:'system',content:SYSTEM},{role:'user',content:prompt}],max_tokens:600,temperature:0.4}) as {response?:string};
  return clean(out?.response,6000);
}

/** Writes one draft answer to an inbound reply and saves it for Rebecca. Returns the draft id, or null when skipped. */
export async function draftReply(env:ReplyDraftEnv,inboundId:string){
  if(!env.DB)return null;
  const useClaude=!!clean(env.ANTHROPIC_API_KEY,400);
  if(!useClaude&&!env.AI)return null;
  const ctx=await draftContext(env,inboundId);
  if(!ctx)return null;
  const prompt=draftPrompt(ctx);
  const text=cleanDraft(useClaude?await writeWithClaude(env,prompt):await writeWithWorkersAi(env,prompt));
  if(!text)return null;
  const subject=clean(ctx.msg.subject,300);
  const id=crypto.randomUUID();
  const mailbox=lower(ctx.msg.mailbox)||REBECCA_EMAIL;
  const res=await env.DB.prepare(`INSERT OR IGNORE INTO email_messages(id,direction,mailbox,from_email,from_name,to_email,subject,snippet,kind,status,reply_to_id,lead_type,lead_id,lead_name,drafted_by,draft_original)
    VALUES (?,'outbound',?,?,'Rebecca Myers',?,?,?,'reply','draft',?,?,?,?,?,?)`)
    .bind(id,mailbox,mailbox,lower(ctx.msg.from_email),/^re:/i.test(subject)?subject:'Re: '+(subject||'your email'),text,ctx.msg.id,
      ctx.msg.lead_type??null,ctx.msg.lead_id??null,ctx.msg.lead_name??null,useClaude?'claude':'workers_ai',text).run();
  return res.meta?.changes?id:null;
}

/**
 * Drafts answers for recent replies that still need one: still 'new', the latest from that person, and with no
 * draft or sent answer to them since. Runs for each message as it arrives (onlyId) and hourly, so a failed draft is retried.
 */
export async function draftWaitingReplies(env:ReplyDraftEnv,limit=3,onlyId=''){
  if(!env.DB||!replyDraftsEnabled(env))return {drafted:0};
  const rows=(await env.DB.prepare(`SELECT m.id FROM email_messages m
    WHERE m.direction='inbound' AND m.kind='reply' AND m.status='new' AND datetime(m.created_at)>=datetime('now',?) AND (?='' OR m.id=?)
      AND NOT EXISTS (SELECT 1 FROM email_messages later WHERE later.direction='inbound' AND later.kind='reply'
        AND lower(later.from_email)=lower(m.from_email) AND later.created_at>m.created_at)
      AND NOT EXISTS (SELECT 1 FROM email_messages o WHERE o.direction='outbound' AND lower(o.to_email)=lower(m.from_email)
        AND (o.reply_to_id=m.id OR (o.status IN ('draft','sent') AND o.created_at>=m.created_at)))
    ORDER BY m.created_at LIMIT ?`).bind(DRAFT_WINDOW,onlyId,onlyId,limit).all<Row>()).results||[];
  let drafted=0;
  for(const r of rows){
    try{if(await draftReply(env,String(r.id)))drafted++}
    catch(error){console.error('reply draft failed',error)}
  }
  return {drafted};
}

const DIGEST_KIND='inbox_digest';

/**
 * One morning email to Rebecca's inbox when replies are waiting for her: who wrote, what they said, and whether a
 * draft is ready. Sent at most once a day, and only when something waits.
 */
export async function sendInboxDigest(env:ReplyDraftEnv,now=new Date()){
  if(!env.DB||!env.EMAIL||String(env.INBOX_DIGEST_ENABLED||'').toLowerCase()!=='true')return {sent:false,reason:'off'};
  const day=now.toISOString().slice(0,10);
  const waiting=(await env.DB.prepare(`SELECT m.from_email,m.from_name,m.lead_name,m.subject,m.snippet,m.created_at,
      EXISTS (SELECT 1 FROM email_messages d WHERE d.direction='outbound' AND d.status='draft' AND lower(d.to_email)=lower(m.from_email)) AS has_draft
    FROM email_messages m WHERE m.direction='inbound' AND m.kind='reply' AND m.status='new'
      AND NOT EXISTS (SELECT 1 FROM email_messages later WHERE later.direction='inbound' AND later.kind='reply'
        AND lower(later.from_email)=lower(m.from_email) AND later.created_at>m.created_at)
    ORDER BY m.created_at DESC LIMIT 20`).all<Row>()).results||[];
  if(!waiting.length)return {sent:false,reason:'nothing waiting'};
  const to=await forwardTarget(env);
  if(!to)return {sent:false,reason:'no recipient'};
  const claimed=await env.DB.prepare('INSERT OR IGNORE INTO monitor_alerts(id,kind,summary,sent_to) VALUES (?,?,?,?)')
    .bind(DIGEST_KIND+':'+day,DIGEST_KIND,`${waiting.length} waiting`,to).run();
  if(!claimed.meta?.changes)return {sent:false,reason:'already sent today'};
  const drafts=waiting.filter(w=>Number(w.has_draft)).length;
  const lines=[`${waiting.length} ${waiting.length===1?'email is':'emails are'} waiting for your answer${drafts?`, ${drafts} with a draft ready`:''}.`,''];
  for(const w of waiting){
    const who=clean(w.lead_name,200)||clean(w.from_name,200)||lower(w.from_email);
    lines.push(`${who} (${lower(w.from_email)})${Number(w.has_draft)?' · draft ready':''}`);
    lines.push(`  "${clean(w.snippet,2000).replace(/\s+/g,' ').slice(0,160)}"`,'');
  }
  lines.push('Open your inbox: https://carejoys.com/admin (Inbox, Needs reply). Drafts are never sent until you press Send.');
  try{
    await env.EMAIL.send({from:'CareJoys <updates@carejoys.com>',to,subject:`${waiting.length} ${waiting.length===1?'email':'emails'} waiting for you`,text:lines.join('\n')});
  }catch(error){
    await env.DB.prepare('DELETE FROM monitor_alerts WHERE id=?').bind(DIGEST_KIND+':'+day).run().catch(()=>null);
    throw error;
  }
  return {sent:true,count:waiting.length};
}
