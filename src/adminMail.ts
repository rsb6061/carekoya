// Rebecca's own email from the admin console: replies to recorded messages and new notes, sent by the Worker from
// rebecca@carejoys.com (or hello@ when answering mail sent there), never from a personal Gmail. Each sent message is
// recorded in email_messages as outbound and blind-copied to the owner's inbox, so Gmail still holds the whole thread.
// Drafts are outbound rows with status 'draft' until they are sent.
import { forwardTarget, matchLead, type InboundEnv } from './inboundEmail';
import { REBECCA_EMAIL, REBECCA_FROM, REPLY_YES_EVENT, replyYesEmail } from './replyYesOutreach';
import type { EmailBinding } from './email';

type Row=Record<string,unknown>;
export type AdminMailEnv=InboundEnv&{EMAIL?:EmailBinding};

const json=(body:unknown,init:ResponseInit={})=>new Response(JSON.stringify(body),{
  ...init,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...(init.headers||{})}
});
const clean=(v:unknown,max=500)=>typeof v==='string'?v.trim().slice(0,max):'';
const validEmail=(v:string)=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const HELLO='hello@carejoys.com';
const BODY_MAX=10000;

type Draft={id:string;to:string;subject:string;text:string;inReplyToId:string;updatedAt:string};
const draftOf=(r:Row):Draft=>({id:String(r.id),to:clean(r.to_email,320),subject:clean(r.subject,300),text:clean(r.snippet,BODY_MAX),inReplyToId:clean(r.reply_to_id,100),updatedAt:clean(r.created_at,40)});

/** GET /api/admin/mail: drafts waiting to be sent, and the last 50 sent. */
export async function adminMail(env:AdminMailEnv){
  if(!env.DB)return json({ok:false,error:'Database unavailable'},{status:503});
  const rows=(await env.DB.prepare(`SELECT id,to_email,subject,snippet,status,reply_to_id,lead_name,created_at FROM email_messages
    WHERE direction='outbound' AND status IN ('draft','sent') ORDER BY created_at DESC LIMIT 80`).all<Row>()).results||[];
  return json({ok:true,
    drafts:rows.filter(r=>r.status==='draft').map(draftOf),
    sent:rows.filter(r=>r.status==='sent').slice(0,50).map(r=>({...draftOf(r),leadName:clean(r.lead_name,200)}))});
}

// A sent message keeps the original quoted under it; the conversation view shows only what was written.
const ownWords=(text:string)=>text.split(/\n\nOn [^\n]* wrote:\n/)[0];
const lower=(v:unknown)=>clean(v,320).toLowerCase();
type ConversationMessage={id:string;direction:'inbound'|'outbound';mailbox:string;subject:string;text:string;status:string;createdAt:string;outreach?:boolean};

/**
 * GET /api/admin/conversations: every person who wrote to hello@ or rebecca@, or whom Rebecca wrote to, as one
 * conversation (their messages and hers, oldest first), with the reply-yes note that started it when there was one.
 * A conversation needs a reply while any of their messages is still 'new'. Unsubscribes, out-of-office replies,
 * bounces and applicant emails are handled on arrival and come back separately as `automatic`.
 */
export async function adminConversations(env:AdminMailEnv){
  if(!env.DB)return json({ok:false,error:'Database unavailable'},{status:503});
  const rows=(await env.DB.prepare(`SELECT id,direction,mailbox,from_email,from_name,to_email,subject,snippet,status,lead_type,lead_id,lead_name,created_at FROM email_messages
    WHERE (direction='inbound' AND kind='reply') OR (direction='outbound' AND status='sent') ORDER BY created_at DESC LIMIT 400`).all<Row>()).results||[];
  const people=new Map<string,{email:string;name:string;lead:{type:string;id:string;name:string}|null;messages:ConversationMessage[]}>();
  for(const r of rows){
    const inbound=r.direction==='inbound';
    const email=lower(inbound?r.from_email:r.to_email);
    if(!email)continue;
    const person=people.get(email)||{email,name:'',lead:null,messages:[]};
    if(inbound&&!person.name)person.name=clean(r.from_name,200);
    if(!person.lead&&r.lead_type)person.lead={type:String(r.lead_type),id:clean(r.lead_id,100),name:clean(r.lead_name,200)};
    person.messages.push({id:String(r.id),direction:inbound?'inbound':'outbound',mailbox:clean(r.mailbox,320),subject:clean(r.subject,300),
      text:inbound?clean(r.snippet,BODY_MAX):ownWords(clean(r.snippet,BODY_MAX)),status:clean(r.status,20),createdAt:clean(r.created_at,40)});
    people.set(email,person);
  }
  // The reply-yes note is sent by the hourly run, not from here, so it is rebuilt from its outreach record.
  const emails=[...people.keys()];
  const notes=emails.length?(await env.DB.prepare(`SELECT e.id,e.recipient_email,e.payload,e.created_at,o.canonical_name,o.primary_contact_name FROM agency_outreach_events e
    LEFT JOIN agency_organizations o ON o.id=e.organization_id WHERE e.event_type=? AND e.recipient_email IN (SELECT value FROM json_each(?))`)
    .bind(REPLY_YES_EVENT,JSON.stringify(emails)).all<Row>()).results||[]:[];
  for(const n of notes){
    const person=people.get(lower(n.recipient_email));
    if(!person)continue;
    let variant:'a'|'b'='a';
    try{if((JSON.parse(String(n.payload||'{}')) as Row).variant==='b')variant='b'}catch{/* older rows */}
    const note=replyYesEmail({contactName:clean(n.primary_contact_name,120),agencyName:clean(n.canonical_name,180),variant,unsubscribeLink:'(their unsubscribe link)'});
    person.messages.push({id:String(n.id),direction:'outbound',mailbox:REBECCA_EMAIL,subject:note.subject,text:note.text,status:'sent',createdAt:clean(n.created_at,40),outreach:true});
  }
  const conversations=[...people.values()].map(p=>{
    p.messages.sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
    const last=p.messages[p.messages.length-1];
    return {...p,needsReply:p.messages.some(m=>m.direction==='inbound'&&m.status==='new'),
      replied:p.messages.some(m=>m.direction==='outbound'&&!m.outreach),lastAt:last?.createdAt||''};
  }).sort((a,b)=>b.lastAt.localeCompare(a.lastAt));
  const automatic=(await env.DB.prepare(`SELECT id,from_email,from_name,subject,snippet,kind,bounced_email,created_at FROM email_messages
    WHERE direction='inbound' AND kind!='reply' ORDER BY created_at DESC LIMIT 50`).all<Row>()).results||[];
  const drafts=(await env.DB.prepare(`SELECT id,to_email,subject,snippet,reply_to_id,created_at FROM email_messages WHERE direction='outbound' AND status='draft' ORDER BY created_at DESC LIMIT 50`).all<Row>()).results||[];
  return json({ok:true,conversations,drafts:drafts.map(draftOf),
    automatic:automatic.map(r=>({id:String(r.id),fromEmail:clean(r.from_email,320),fromName:clean(r.from_name,200),subject:clean(r.subject,300),
      snippet:clean(r.snippet,600),kind:clean(r.kind,20),bouncedEmail:clean(r.bounced_email,320),createdAt:clean(r.created_at,40)}))});
}

/** POST /api/admin/conversations/status {email,status:'handled'|'new'}: marks someone's messages answered (Done) or not. */
export async function adminConversationStatus(request:Request,env:AdminMailEnv){
  if(!env.DB)return json({ok:false,error:'Database unavailable'},{status:503});
  const body=await request.json().catch(()=>null) as Row|null;
  const email=lower(body?.email),status=body?.status==='handled'||body?.status==='new'?body.status:'';
  if(!email||!status)return json({ok:false,error:'email and a status of handled or new are required'},{status:400});
  // "Not done" reopens only their latest message, so the conversation goes back to Needs reply without every old one.
  if(status==='new')await env.DB.prepare(`UPDATE email_messages SET status='new' WHERE id=(SELECT id FROM email_messages
    WHERE direction='inbound' AND kind='reply' AND lower(from_email)=? ORDER BY created_at DESC LIMIT 1)`).bind(email).run();
  else await env.DB.prepare("UPDATE email_messages SET status='handled' WHERE direction='inbound' AND kind='reply' AND lower(from_email)=? AND status='new'").bind(email).run();
  return json({ok:true});
}

/** POST /api/admin/mail/drafts {id?,to,subject,text,inReplyToId?}: saves a draft. {id,discard:true} throws one away. */
export async function adminSaveDraft(request:Request,env:AdminMailEnv){
  if(!env.DB)return json({ok:false,error:'Database unavailable'},{status:503});
  const body=await request.json().catch(()=>null) as Row|null;
  const id=clean(body?.id,100);
  if(id&&body?.discard){
    await env.DB.prepare("UPDATE email_messages SET status='discarded' WHERE id=? AND direction='outbound' AND status='draft'").bind(id).run();
    return json({ok:true});
  }
  const to=clean(body?.to,320).toLowerCase(),subject=clean(body?.subject,300),text=clean(body?.text,BODY_MAX),replyToId=clean(body?.inReplyToId,100);
  if(id){
    const res=await env.DB.prepare("UPDATE email_messages SET to_email=?,subject=?,snippet=?,created_at=CURRENT_TIMESTAMP WHERE id=? AND direction='outbound' AND status='draft'").bind(to,subject,text,id).run();
    return res.meta?.changes?json({ok:true,id}):json({ok:false,error:'Draft not found'},{status:404});
  }
  const newId=crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO email_messages(id,direction,mailbox,from_email,from_name,to_email,subject,snippet,kind,status,reply_to_id)
    VALUES (?,'outbound',?,?,'Rebecca Myers',?,?,?,'reply','draft',NULLIF(?,''))`).bind(newId,REBECCA_EMAIL,REBECCA_EMAIL,to,subject,text,replyToId).run();
  return json({ok:true,id:newId});
}

/**
 * POST /api/admin/mail/send {to,subject,text,inReplyToId?,draftId?}. A reply goes out from the address the message was
 * sent to (rebecca@ or hello@) with threading headers, so it lands in the same conversation in the agency's inbox.
 */
export async function adminSendMail(request:Request,env:AdminMailEnv){
  if(!env.DB||!env.EMAIL)return json({ok:false,error:'Email unavailable'},{status:503});
  const body=await request.json().catch(()=>null) as Row|null;
  const to=clean(body?.to,320).toLowerCase(),subject=clean(body?.subject,300),text=clean(body?.text,BODY_MAX);
  const draftId=clean(body?.draftId,100),replyToId=clean(body?.inReplyToId,100);
  if(!validEmail(to))return json({ok:false,error:'Add a valid email address to send to'},{status:400});
  if(!subject||!text)return json({ok:false,error:'Add a subject and a message'},{status:400});
  const original=replyToId?await env.DB.prepare("SELECT id,mailbox,message_id FROM email_messages WHERE id=? AND direction='inbound'").bind(replyToId).first<Row>():null;
  const fromAddress=clean(original?.mailbox,320)===HELLO?HELLO:REBECCA_EMAIL;
  const from=fromAddress===HELLO?'Rebecca at CareJoys <'+HELLO+'>':REBECCA_FROM;
  const messageId=clean(original?.message_id,500);
  const headers:Record<string,string>={};
  if(/^<[^<>\s]+>$/.test(messageId)){headers['In-Reply-To']=messageId;headers.References=messageId}
  const copy=await forwardTarget(env);
  try{
    await env.EMAIL.send({from,replyTo:fromAddress,to,...(copy&&copy!==to?{bcc:copy}:{}),subject,text,...(Object.keys(headers).length?{headers}:{})});
  }catch(error){
    return json({ok:false,error:error instanceof Error?error.message:'The email did not send'},{status:502});
  }
  const lead=await matchLead(env.DB,to).catch(()=>null);
  const values=[fromAddress,fromAddress,to,subject,text,original?String(original.id):replyToId,lead?.type??null,lead?.id??null,lead?.name??null];
  const updated=draftId?await env.DB.prepare(`UPDATE email_messages SET mailbox=?,from_email=?,to_email=?,subject=?,snippet=?,reply_to_id=NULLIF(?,''),lead_type=?,lead_id=?,lead_name=?,status='sent',created_at=CURRENT_TIMESTAMP
    WHERE id=? AND direction='outbound' AND status='draft'`).bind(...values,draftId).run():null;
  if(!updated?.meta?.changes)await env.DB.prepare(`INSERT INTO email_messages(id,direction,mailbox,from_email,from_name,to_email,subject,snippet,reply_to_id,lead_type,lead_id,lead_name,kind,status)
    VALUES (?,'outbound',?,?,'Rebecca Myers',?,?,?,NULLIF(?,''),?,?,?,'reply','sent')`).bind(crypto.randomUUID(),...values).run();
  // Answering someone means everything they sent is handled.
  if(original)await env.DB.prepare("UPDATE email_messages SET status='handled' WHERE id=?").bind(original.id).run();
  await env.DB.prepare("UPDATE email_messages SET status='handled' WHERE direction='inbound' AND kind='reply' AND lower(from_email)=? AND status='new'").bind(to).run();
  return json({ok:true});
}

