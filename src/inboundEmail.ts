// Mail to hello@carejoys.com, routed to the Worker by Cloudflare Email Routing ("Send to a Worker").
// Every message is forwarded to the owner's inbox untouched, except an unsubscribe ("Stop", "remove me"): that one is
// handled here, so it never lands in her inbox. Each message is recorded in email_messages and matched to a lead, and
// unsubscribes and hard bounces are suppressed. An unsubscribe also suppresses the agency address the outreach went to,
// since a staff member often answers mail sent to a shared info@ box.
// Nothing here sends mail to anyone but the forward.
// Mail to an agency's apply+<key>@carejoys.com address is different: it is a job board's applicant notification, read
// into that agency's applicant list (src/applicantEmailIntake.ts) and forwarded only when it can't be read.
import { intakeKeyOf, receiveApplicantEmail } from './applicantEmailIntake';
import type { ApplicantDb } from './applicants';
import { isFreeMail } from './employerApproval';
import { isPlainYes, setUpYesAgency } from './agencyApplications';

type Row=Record<string,unknown>;
type Statement={bind(...values:unknown[]):Statement;run():Promise<{success:boolean;meta?:Record<string,unknown>}>;first<T=Row>():Promise<T|null>;all<T=Row>():Promise<{results?:T[]}>};
type DB={prepare(query:string):Statement};

/** The parts of Cloudflare's ForwardableEmailMessage used here. */
export type InboundEmailMessage={
  from:string;
  to:string;
  headers:Headers;
  raw:ReadableStream<Uint8Array>;
  rawSize?:number;
  forward(rcptTo:string,headers?:Headers):Promise<unknown>;
};
export type InboundEnv={DB?:DB;ADMIN_EMAILS?:string;INBOUND_FORWARD_TO?:string};

const json=(body:unknown,init:ResponseInit={})=>new Response(JSON.stringify(body),{
  ...init,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...(init.headers||{})}
});
const clean=(v:unknown,max=500)=>typeof v==='string'?v.trim().slice(0,max):'';
const OWN_DOMAIN=/@carejoys\.com$/i;
// Only the start of a message is read: enough for headers, the reply itself and a bounce report, never a big attachment.
const READ_LIMIT=256*1024;

/** Where every message is forwarded: INBOUND_FORWARD_TO, else the first admin address outside carejoys.com (so it can't loop). */
export async function forwardTarget(env:InboundEnv){
  const fromDb=env.DB?((await env.DB.prepare('SELECT email FROM admin_authorizations ORDER BY email').all<{email:string}>().catch(()=>({results:[]}))).results||[]).map(r=>String(r.email||'')):[];
  const list=[env.INBOUND_FORWARD_TO,env.ADMIN_EMAILS,...fromDb].flatMap(v=>clean(v,4000).toLowerCase().split(/[\s,;]+/)).filter(e=>e.includes('@')&&!OWN_DOMAIN.test(e));
  return list[0]||'';
}

async function readRaw(stream:ReadableStream<Uint8Array>){
  const reader=stream.getReader();
  const chunks:Uint8Array[]=[];
  let size=0;
  while(size<READ_LIMIT){
    const {done,value}=await reader.read();
    if(done||!value)break;
    chunks.push(value);size+=value.length;
  }
  await reader.cancel().catch(()=>null);
  const all=new Uint8Array(Math.min(size,READ_LIMIT));
  let at=0;
  for(const c of chunks){const part=c.subarray(0,all.length-at);all.set(part,at);at+=part.length;if(at>=all.length)break}
  return new TextDecoder('latin1').decode(all);
}

// ---- A small MIME reader: headers, the first text part, and bounce reports. ----

type Part={headers:Map<string,string>;body:string};

function splitPart(raw:string):Part{
  const at=raw.search(/\r?\n\r?\n/);
  const head=at<0?raw:raw.slice(0,at);
  const body=at<0?'':raw.slice(at).replace(/^\r?\n\r?\n/,'');
  const headers=new Map<string,string>();
  for(const line of head.replace(/\r?\n[ \t]+/g,' ').split(/\r?\n/)){
    const m=line.match(/^([!-9;-~]+):\s*(.*)$/);
    if(m&&!headers.has(m[1].toLowerCase()))headers.set(m[1].toLowerCase(),m[2].trim());
  }
  return {headers,body};
}

function param(header:string,name:string){
  const m=header.match(new RegExp(';\\s*'+name+'\\s*=\\s*(?:"([^"]*)"|([^;\\s]+))','i'));
  return m?(m[1]??m[2]??''):'';
}

function bytesToText(bytes:Uint8Array,charset:string){
  try{return new TextDecoder(charset||'utf-8').decode(bytes)}catch{return new TextDecoder('utf-8').decode(bytes)}
}
const latin1Bytes=(s:string)=>Uint8Array.from(s,c=>c.charCodeAt(0)&255);

function decodeBody(body:string,encoding:string,charset:string){
  const enc=encoding.toLowerCase();
  if(enc==='base64'){
    try{return bytesToText(latin1Bytes(atob(body.replace(/[^A-Za-z0-9+/=]/g,''))),charset)}catch{return ''}
  }
  if(enc==='quoted-printable'){
    const bin=body.replace(/=\r?\n/g,'').replace(/=([0-9A-F]{2})/gi,(_,h)=>String.fromCharCode(parseInt(h,16)));
    return bytesToText(latin1Bytes(bin),charset);
  }
  return bytesToText(latin1Bytes(body),charset);
}

/** RFC 2047 encoded words, e.g. =?UTF-8?B?...?= in a Subject or From. */
export function decodeHeader(value:string){
  return value.replace(/=\?([^?]+)\?([BQ])\?([^?]*)\?=(\s+(?==\?))?/gi,(_,charset:string,kind:string,text:string)=>{
    if(kind.toUpperCase()==='B'){try{return bytesToText(latin1Bytes(atob(text)),charset)}catch{return text}}
    return bytesToText(latin1Bytes(text.replace(/_/g,' ').replace(/=([0-9A-F]{2})/gi,(_m,h)=>String.fromCharCode(parseInt(h,16)))),charset);
  });
}

const stripHtml=(html:string)=>html.replace(/<(style|script)[\s\S]*?<\/\1>/gi,' ').replace(/<br\s*\/?>|<\/(p|div|tr|li)>/gi,'\n').replace(/<[^>]+>/g,' ')
  .replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/[ \t]+/g,' ');

/** Walks the MIME tree: the first text/plain (else text/html) body, and any delivery-status report. */
function walk(part:Part,found:{text?:string;html?:string;report?:string},depth=0){
  const type=(part.headers.get('content-type')||'text/plain').toLowerCase();
  const encoding=part.headers.get('content-transfer-encoding')||'';
  const charset=param(part.headers.get('content-type')||'','charset');
  if(type.startsWith('multipart/')&&depth<6){
    const boundary=param(part.headers.get('content-type')||'','boundary');
    if(!boundary)return;
    const pieces=part.body.split(new RegExp('\\r?\\n?--'+boundary.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?:--)?[ \\t]*\\r?\\n?'));
    for(const piece of pieces.slice(1)){if(piece.trim())walk(splitPart(piece),found,depth+1)}
    return;
  }
  if(type.startsWith('message/delivery-status')){found.report??=decodeBody(part.body,encoding,charset);return}
  if(type.startsWith('text/plain')&&found.text===undefined){found.text=decodeBody(part.body,encoding,charset);return}
  if(type.startsWith('text/html')&&found.html===undefined)found.html=decodeBody(part.body,encoding,charset);
}

export type ParsedEmail={headers:Map<string,string>;subject:string;fromName:string;fromEmail:string;messageId:string;inReplyTo:string;text:string;report:string};

export function parseEmail(raw:string):ParsedEmail{
  const root=splitPart(raw);
  const found:{text?:string;html?:string;report?:string}={};
  walk(root,found);
  const from=decodeHeader(root.headers.get('from')||'');
  const address=(from.match(/<([^>]+)>/)?.[1]||from.match(/[^\s<>"]+@[^\s<>"]+/)?.[0]||'').trim().toLowerCase();
  const name=from.replace(/<[^>]*>/,'').replace(/"/g,'').trim();
  const angle=(v:string)=>(v.match(/<[^>]+>/)?.[0]||v).trim();
  return {headers:root.headers,subject:decodeHeader(root.headers.get('subject')||'').trim(),fromName:name&&name.toLowerCase()!==address?name:'',fromEmail:address,
    messageId:angle(root.headers.get('message-id')||''),inReplyTo:angle(root.headers.get('in-reply-to')||''),
    text:(found.text??(found.html?stripHtml(found.html):'')).replace(/\r\n/g,'\n'),report:found.report||''};
}

/** The reply's own words: stops at the quoted history ("On … wrote:", "> …", a forwarded header block). */
export function replyText(text:string){
  const out:string[]=[];
  for(const line of text.split('\n')){
    if(/^\s*>/.test(line))break;
    if(/^\s*On .{4,200}wrote:\s*$/i.test(line)||/^-{2,}\s*Original Message\s*-{2,}/i.test(line)||/^_{5,}\s*$/.test(line)||/^\s*From:\s.+/i.test(line)&&out.length)break;
    out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g,'\n\n').trim();
}

export type ReplyKind='reply'|'unsubscribe'|'auto_reply'|'bounce';
const UNSUBSCRIBE=/\b(unsubscribe|remove me|take me off|opt[- ]?out|stop (e-?mailing|sending|contacting)|(do not|don'?t) (e-?mail|contact)( me| us)?\b|no more e-?mails?)\b/i;

/** What kind of message this is. Only the sender's own words count for unsubscribe, never the quoted outreach email. */
export function classifyEmail(p:ParsedEmail):{kind:ReplyKind;bouncedEmail:string;hardBounce:boolean}{
  const h=(k:string)=>(p.headers.get(k)||'').toLowerCase();
  const type=h('content-type');
  const daemon=/^(mailer-daemon|postmaster)@/i.test(p.fromEmail)||/mailer-daemon|mail delivery (subsystem|system)/i.test(p.fromName);
  if(p.report||type.includes('report-type=delivery-status')||daemon&&/undeliver|delivery (status|failure|has failed)|returned mail|failure notice/i.test(p.subject)){
    const report=p.report||p.text;
    const recipient=(report.match(/^(?:Final|Original)-Recipient:\s*rfc822;\s*<?([^\s<>]+@[^\s<>]+)>?/im)?.[1]||'').toLowerCase();
    const status=report.match(/^Status:\s*(\d)\.\d+\.\d+/im)?.[1]||'';
    // No status line: treat a mailer-daemon "undeliverable" as permanent only when it names the recipient.
    return {kind:'bounce',bouncedEmail:recipient,hardBounce:!!recipient&&(status==='5'||!status&&daemon)};
  }
  const auto=h('auto-submitted');
  if(auto&&auto!=='no'||h('x-autoreply')||h('x-autorespond')||/^(auto|bulk|junk)$/.test(h('precedence'))
    ||/^(automatic reply|auto(matic)?[- ]?reply|out of (the )?office|ooo\b|away from (the )?office|i am out of the office)/i.test(p.subject))
    return {kind:'auto_reply',bouncedEmail:'',hardBounce:false};
  const own=replyText(p.text).slice(0,400);
  if(UNSUBSCRIBE.test(own)||/^\s*stop\s*[.!]*\s*$/i.test(own.split(/\n\s*\n/)[0]||'')||/^\s*(unsubscribe|remove)\b/i.test(p.subject))return {kind:'unsubscribe',bouncedEmail:'',hardBounce:false};
  return {kind:'reply',bouncedEmail:'',hardBounce:false};
}

export type LeadMatch={type:string;id:string;name:string};

/** The lead this address belongs to, hottest kind first: employers, agencies and facilities, schools, programs, applicants, caregivers. */
export async function matchLead(db:DB,email:string):Promise<LeadMatch|null>{
  if(!email)return null;
  const lookups:Array<[string,string]>=[
    ['employer',"SELECT id,company_name AS name FROM employer_leads WHERE lower(email)=? ORDER BY created_at DESC LIMIT 1"],
    ['agency',"SELECT id,canonical_name AS name FROM agency_organizations WHERE lower(primary_email)=? LIMIT 1"],
    ['school',"SELECT id,organization_name AS name FROM school_leads WHERE lower(email)=? ORDER BY created_at DESC LIMIT 1"],
    ['training_program',"SELECT id,program_name AS name FROM training_programs WHERE lower(email)=? LIMIT 1"],
    ['applicant',"SELECT a.id,trim(coalesce(a.first_name,'')||' '||coalesce(a.last_name,''))||' · '||coalesce(e.company_name,'') AS name FROM agency_applicants a LEFT JOIN employer_leads e ON e.id=a.employer_id WHERE lower(a.email)=? ORDER BY a.created_at DESC LIMIT 1"],
    ['caregiver',"SELECT id,trim(first_name||' '||last_name) AS name FROM caregivers WHERE lower(email)=? LIMIT 1"]
  ];
  for(const [type,sql] of lookups){
    const row=await db.prepare(sql).bind(email).first<Row>().catch(()=>null);
    if(row?.id)return {type,id:String(row.id),name:clean(row.name,200)};
  }
  // A colleague answering for the agency: ranelle@agency.com replying to the note sent to info@agency.com.
  const domain=email.split('@')[1]||'';
  if(!domain||OWN_DOMAIN.test(email)||isFreeMail(email))return null;
  const like='%@'+domain.replace(/[%_\\]/g,'\\$&');
  const agency=await db.prepare(`SELECT o.id,o.canonical_name AS name FROM agency_outreach_events e JOIN agency_organizations o ON o.id=e.organization_id
    WHERE lower(e.recipient_email) LIKE ? ESCAPE '\\' ORDER BY e.created_at DESC LIMIT 1`).bind(like).first<Row>().catch(()=>null)
    ||await db.prepare("SELECT id,canonical_name AS name FROM agency_organizations WHERE lower(trim(primary_email)) LIKE ? ESCAPE '\\' LIMIT 1").bind(like).first<Row>().catch(()=>null);
  return agency?.id?{type:'agency',id:String(agency.id),name:clean(agency.name,200)}:null;
}

async function suppress(db:DB,email:string,reason:'unsubscribe'|'bounce'){
  if(!email.includes('@')||OWN_DOMAIN.test(email))return;
  await db.prepare("INSERT OR IGNORE INTO email_suppressions(email,reason,source) VALUES (?,?,'email_reply')").bind(email,reason).run();
}

/**
 * Addresses at the sender's own company domain that CareJoys emails: outreach recipients and agency primary emails.
 * "Stop" from aimee@agency.com answers outreach sent to info@agency.com, so both are suppressed. Never for Gmail-style domains.
 */
export async function sameDomainRecipients(db:DB,email:string){
  const domain=email.split('@')[1]||'';
  if(!domain||OWN_DOMAIN.test(email)||isFreeMail(email))return [];
  const like='%@'+domain.replace(/[%_\\]/g,'\\$&');
  const rows=(await db.prepare(`SELECT recipient_email AS email FROM agency_outreach_events WHERE lower(recipient_email) LIKE ? ESCAPE '\\'
    UNION SELECT lower(trim(primary_email)) FROM agency_organizations WHERE lower(trim(primary_email)) LIKE ? ESCAPE '\\'`).bind(like,like).all<{email:string}>()).results||[];
  return [...new Set(rows.map(r=>clean(r.email,320).toLowerCase()).filter(e=>e.endsWith('@'+domain)&&e!==email))];
}

/** The Worker's email() handler. A message that can't be read is still forwarded; only a read unsubscribe is held back. */
/** Returns the recorded row's id when the message is a reply someone wrote (the drafter answers those), else null. */
export async function handleInboundEmail(message:InboundEmailMessage,env:InboundEnv):Promise<string|null>{
  const intakeKey=intakeKeyOf(message.to);
  if(intakeKey){await handleApplicantEmail(message,env,intakeKey);return null}
  let parsed:ParsedEmail|null=null;
  try{parsed=parseEmail(await readRaw(message.raw))}
  catch(error){console.error('inbound email parse failed',error)}
  const fromEmail=parsed?.fromEmail||clean(message.from,320).toLowerCase();
  const own=OWN_DOMAIN.test(fromEmail);
  const classified=parsed&&!own?classifyEmail({...parsed,fromEmail}):null;
  // Unsubscribes are recorded and suppressed below and show on /admin's inbox, so they don't need to reach Gmail.
  const skipForward=classified?.kind==='unsubscribe'&&!!env.DB;
  const target=skipForward?'':await forwardTarget(env);
  let forwarded=false;
  if(target){
    try{await message.forward(target);forwarded=true}
    catch(error){console.error('inbound forward failed',error)}
  }else if(!skipForward)console.error('inbound email: no INBOUND_FORWARD_TO or admin address to forward to');
  // CareJoys' own mail (copies of outreach, alerts) is already on record where it was sent.
  if(!env.DB||!parsed||!classified)return null;
  const id=crypto.randomUUID();
  try{
    const {kind,bouncedEmail,hardBounce}=classified;
    const leadEmail=kind==='bounce'?bouncedEmail:fromEmail;
    const lead=await matchLead(env.DB,leadEmail);
    const snippet=(kind==='bounce'?parsed.report||parsed.text:replyText(parsed.text)||parsed.text).trim().slice(0,2000);
    const res=await env.DB.prepare(`INSERT OR IGNORE INTO email_messages(id,direction,mailbox,from_email,from_name,subject,snippet,message_id,in_reply_to,kind,bounced_email,lead_type,lead_id,lead_name,status,forwarded)
      VALUES (?,'inbound',?,?,?,?,?,NULLIF(?,''),NULLIF(?,''),?,NULLIF(?,''),?,?,?,?,?)`)
      .bind(id,clean(message.to,320).toLowerCase(),fromEmail,clean(parsed.fromName,200),clean(parsed.subject,300),snippet,clean(parsed.messageId,500),clean(parsed.inReplyTo,500),
        kind,bouncedEmail,lead?.type??null,lead?.id??null,lead?.name??null,kind==='reply'?'new':'handled',forwarded?1:0).run();
    if(!res.meta?.changes)return null;
    if(kind==='unsubscribe'){
      await suppress(env.DB,fromEmail,'unsubscribe');
      for(const email of await sameDomainRecipients(env.DB,fromEmail))await suppress(env.DB,email,'unsubscribe');
    }
    if(kind==='bounce'&&hardBounce)await suppress(env.DB,bouncedEmail,'bounce');
    // A plain "yes" to the outreach note sets the agency up on the spot: applications to the address that said yes.
    // Anything with a condition stays for Rebecca's Set up button in /admin. She still sends the confirmation.
    if(kind==='reply'&&lead?.type==='agency'&&isPlainYes(snippet)){
      const fresh=await env.DB.prepare("SELECT 1 AS hit FROM agency_organizations o WHERE o.id=? AND COALESCE(o.application_email,'')='' AND EXISTS (SELECT 1 FROM agency_outreach_events e WHERE e.organization_id=o.id AND e.event_type='reply_yes_invite')").bind(lead.id).first();
      if(fresh)await setUpYesAgency(env as never,{organizationId:lead.id,email:fromEmail,contactName:clean(parsed.fromName,120),source:'auto_yes'});
    }
    return kind==='reply'?id:null;
  }catch(error){console.error('inbound email record failed',error);return null}
}

/**
 * An applicant notification sent to an agency's intake address. Read ones are recorded as handled and not forwarded,
 * so the admin inbox isn't flooded; one that can't be read (a Gmail forwarding confirmation, a weekly summary) is
 * forwarded and left open, and the agency sees it on its Applicants page too.
 */
async function handleApplicantEmail(message:InboundEmailMessage,env:InboundEnv,key:string){
  if(!env.DB)return;
  let parsed:ParsedEmail;
  try{parsed=parseEmail(await readRaw(message.raw))}
  catch(error){console.error('applicant email parse failed',error);return}
  let result:Awaited<ReturnType<typeof receiveApplicantEmail>>|null=null;
  try{result=await receiveApplicantEmail(env.DB as unknown as ApplicantDb,key,parsed)}
  catch(error){console.error('applicant email intake failed',error)}
  const read=result?.status==='added'||result?.status==='duplicate';
  let forwarded=false;
  if(!read){
    const target=await forwardTarget(env);
    if(target){
      try{await message.forward(target);forwarded=true}
      catch(error){console.error('inbound forward failed',error)}
    }
  }
  try{
    await env.DB.prepare(`INSERT OR IGNORE INTO email_messages(id,direction,mailbox,from_email,from_name,subject,snippet,message_id,kind,lead_type,lead_id,lead_name,status,forwarded)
      VALUES (?,'inbound',?,?,?,?,?,NULLIF(?,''),'intake',?,?,?,?,?)`)
      .bind(crypto.randomUUID(),clean(message.to,320).toLowerCase(),parsed.fromEmail||clean(message.from,320).toLowerCase(),clean(parsed.fromName,200),clean(parsed.subject,300),
        parsed.text.trim().slice(0,2000),clean(parsed.messageId,500),
        result?.applicantId?'applicant':result?.employerId?'employer':null,result?.applicantId||result?.employerId||null,result?.name||null,read?'handled':'new',forwarded?1:0).run();
  }catch(error){console.error('applicant email record failed',error)}
}

const KINDS=['reply','unsubscribe','auto_reply','bounce','intake'];

/** GET /api/admin/inbox: the latest messages, newest first, plus how many replies still need a look. */
export async function adminInbox(env:InboundEnv,url:URL){
  if(!env.DB)return json({ok:false,error:'Database unavailable'},{status:503});
  const kind=KINDS.includes(url.searchParams.get('kind')||'')?url.searchParams.get('kind'):'';
  const rows=(await env.DB.prepare(`SELECT id,mailbox,from_email,from_name,subject,snippet,kind,bounced_email,lead_type,lead_id,lead_name,status,forwarded,created_at
    FROM email_messages WHERE direction='inbound' ${kind?'AND kind=?':''} ORDER BY created_at DESC LIMIT 100`).bind(...(kind?[kind]:[])).all<Row>()).results||[];
  const counts=(await env.DB.prepare("SELECT kind,COUNT(*) AS total,SUM(CASE WHEN status='new' THEN 1 ELSE 0 END) AS open FROM email_messages WHERE direction='inbound' GROUP BY kind").all<Row>()).results||[];
  return json({ok:true,messages:rows.map(r=>({id:r.id,mailbox:r.mailbox||'',fromEmail:r.from_email,fromName:r.from_name||'',subject:r.subject||'',snippet:r.snippet||'',kind:r.kind,
    bouncedEmail:r.bounced_email||'',lead:r.lead_type?{type:r.lead_type,id:r.lead_id,name:r.lead_name||''}:null,status:r.status,forwarded:!!r.forwarded,createdAt:r.created_at})),
    counts:Object.fromEntries(KINDS.map(k=>{const c=counts.find(r=>r.kind===k);return [k,{total:Number(c?.total||0),open:Number(c?.open||0)}]}))});
}

/** POST /api/admin/inbox/:id {status:'handled'|'new'} */
export async function adminInboxUpdate(request:Request,env:InboundEnv,id:string){
  if(!env.DB)return json({ok:false,error:'Database unavailable'},{status:503});
  const body=await request.json().catch(()=>null) as {status?:unknown}|null;
  const status=body?.status==='handled'||body?.status==='new'?body.status:'';
  if(!status)return json({ok:false,error:'status must be handled or new'},{status:400});
  const res=await env.DB.prepare('UPDATE email_messages SET status=? WHERE id=?').bind(status,id).run();
  return res.meta?.changes?json({ok:true}):json({ok:false,error:'Message not found'},{status:404});
}
