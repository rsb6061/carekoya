// Applicants who arrive by email. Each agency gets its own address, apply+<key>@carejoys.com, and points its Indeed,
// CareerPlug or other job-board "new applicant" notifications at it (directly, or with a mail filter that forwards
// them). Every message is read here into that agency's applicant list, which starts the 30-minute clock.
// Like a CSV upload, the people stay the agency's (src/applicants.ts).
import { normalizePhone } from './sms';
import { splitLocation, type ApplicantDb } from './applicants';
import type { ParsedEmail } from './inboundEmail';

type Row=Record<string,unknown>;

const clean=(v:unknown,max=200)=>typeof v==='string'?v.replace(/\s+/g,' ').trim().slice(0,max):'';
const INTAKE_DOMAIN='carejoys.com';
const KEY_ALPHABET='abcdefghijkmnpqrstuvwxyz23456789';

export const intakeAddress=(key:string)=>key?`apply+${key}@${INTAKE_DOMAIN}`:'';

/** The agency key in an apply+<key>@carejoys.com address, or '' for any other address. */
export function intakeKeyOf(to:string){
  return clean(to,320).toLowerCase().match(/^apply\+([a-z0-9]{6,32})@carejoys\.com$/)?.[1]||'';
}

/** The agency's key, made the first time it's asked for. */
export async function ensureIntakeKey(db:ApplicantDb,employerId:string){
  const row=await db.prepare('SELECT intake_key FROM employer_leads WHERE id=?').bind(employerId).first<Row>();
  if(!row)return '';
  if(clean(row.intake_key,40))return clean(row.intake_key,40);
  const bytes=crypto.getRandomValues(new Uint8Array(10));
  const key=Array.from(bytes,b=>KEY_ALPHABET[b%KEY_ALPHABET.length]).join('');
  await db.prepare('UPDATE employer_leads SET intake_key=? WHERE id=? AND intake_key IS NULL').bind(key,employerId).run();
  // Two first requests at once: whichever key was saved is the one.
  const saved=await db.prepare('SELECT intake_key FROM employer_leads WHERE id=?').bind(employerId).first<Row>();
  return clean(saved?.intake_key,40);
}

export type EmailApplicant={board:string;firstName:string;lastName:string;email:string;phone:string;city:string;state:string;zip:string;position:string;appliedAt:string|null};

// Senders and relays whose addresses are never the applicant's own.
const SYSTEM_ADDRESS=/(^|[.@])(no-?reply|do-?not-?reply|notifications?|alerts?|mailer-daemon|postmaster)[^@]*@|@(?:[a-z0-9-]+\.)*(indeed\.com|careerplug\.com|ziprecruiter\.com|mycnajobs\.com|carejoys\.com|google\.com|gmail-smtp-in\.l\.google\.com)$/i;
const BOARDS:Array<[RegExp,string]>=[[/indeed/i,'Indeed'],[/careerplug/i,'CareerPlug'],[/ziprecruiter/i,'ZipRecruiter'],[/mycnajobs/i,'myCNAjobs'],[/apploi/i,'Apploi'],[/workstream/i,'Workstream']];
// Words in a job title, never in a person's name. Used to tell "Caregiver - Jane Doe" apart.
const JOB_WORDS=/\b(care ?giver|aide|cna|gna|hha|pca|nurse|nursing|companion|home|health|care|job|position|opening|staff|assistant|part[- ]time|full[- ]time|shift|weekend|overnight|live[- ]in|med tech|caretaker|attendant|technician|associate|coordinator|\$)/i;
const EMAIL_RE=/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE_RE=/(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g;

const looksLikeName=(v:string)=>{
  const s=clean(v,120);
  return /^[A-Za-zÀ-ÿ'’.-]+(?: [A-Za-zÀ-ÿ'’.-]+){0,3}$/.test(s)&&!JOB_WORDS.test(s);
};

/** "Label: value" lines, and a label alone on its line with the value on the next one (tables turned into text). */
function labeled(lines:string[],labels:RegExp){
  for(let i=0;i<lines.length;i++){
    const line=lines[i].trim();
    const m=line.match(new RegExp('^(?:'+labels.source+')\\s*[:：]\\s*(.+)$','i'));
    if(m&&m[1].trim())return m[1].trim();
    if(new RegExp('^(?:'+labels.source+')\\s*:?$','i').test(line)){
      const next=lines.slice(i+1).find(l=>l.trim());
      if(next)return next.trim();
    }
  }
  return '';
}

/** A message the agency forwarded by hand carries the original's From, Reply-To and Subject in its body. */
function forwardedHeaders(text:string){
  const at=text.search(/-{3,}\s*Forwarded message\s*-{3,}|Begin forwarded message:|^-{2,}\s*Original Message\s*-{2,}/im);
  if(at<0)return {from:'',replyTo:'',subject:''};
  const block=text.slice(at,at+2000).split('\n').slice(0,12);
  const get=(name:string)=>block.map(l=>l.trim().match(new RegExp('^\\*?'+name+':\\*?\\s*(.+)$','i'))?.[1]||'').find(Boolean)||'';
  return {from:get('From'),replyTo:get('Reply-To'),subject:get('Subject')};
}

/** Name and job from subjects such as "Jane Doe applied to your Caregiver job" or "New applicant: Jane Doe - Caregiver". */
export function nameAndJobFromSubject(subject:string){
  const s=clean(subject,300).replace(/^(?:(?:re|fwd?|fw)\s*:\s*)+/i,'');
  const applied=s.match(/^(.+?) (?:has )?(?:just )?applied (?:to|for) (?:your |the |a )?(.+?)(?: (?:job|position|opening|role))?(?: (?:at|with|in) .+)?[.!]?$/i);
  if(applied&&looksLikeName(applied[1]))return {name:clean(applied[1],120),job:clean(applied[2],200)};
  const fresh=s.match(/^new (?:job )?(?:application|applicant|candidate)s?(?: received)?(?: for (.+?))?\s*[:\-–—]\s*(.+)$/i);
  if(fresh){
    const parts=fresh[2].split(/\s+[-–—|]\s+|\s+for\s+/i).map(p=>clean(p,200)).filter(Boolean);
    const name=parts.find(looksLikeName)||'';
    const job=clean(fresh[1],200)||parts.find(p=>p!==name)||'';
    return {name,job};
  }
  return {name:'',job:''};
}

/** The applicant in a job board's notification, or in a message forwarded by hand. Missing fields are left blank. */
export function applicantFromEmail(p:ParsedEmail,replyTo=''):EmailApplicant{
  const text=p.text||'';
  const lines=text.split('\n').map(l=>l.replace(/\*/g,'').trim()).filter(Boolean);
  const fwd=forwardedHeaders(text);
  const subject=fwd.subject||p.subject;
  const haystack=[p.fromEmail,p.fromName,fwd.from,subject,text.slice(0,4000)].join(' ');
  const board=BOARDS.find(([re])=>re.test(haystack))?.[1]||'Email';

  const fromSubject=nameAndJobFromSubject(subject);
  let name=clean(labeled(lines,/(?:candidate|applicant)(?:'s)? name|full name|name|candidate|applicant/),120);
  if(!looksLikeName(name))name=fromSubject.name;
  const position=clean(labeled(lines,/job title|job applied(?: to| for)?|applied (?:to|for)|position(?: applied for)?|job|opening/),200)||fromSubject.job;

  const own=(e:string)=>!SYSTEM_ADDRESS.test(e)&&e.toLowerCase()!==p.fromEmail;
  const addressOf=(v:string)=>(v.match(EMAIL_RE)||[]).map(e=>e.toLowerCase()).find(own)||'';
  const email=addressOf(labeled(lines,/e-?mail(?: address)?|candidate e-?mail|applicant e-?mail/))||addressOf(fwd.replyTo)||addressOf(replyTo)
    // A forwarded message's own sender is the agency, so the body is only searched outside the forwarding header.
    ||addressOf(text.replace(/^(?:From|To|Cc|Reply-To|Sent|Date):.*$/gim,''));

  const phoneOf=(v:string)=>(v.match(PHONE_RE)||[]).map(x=>normalizePhone(x)||'').find(Boolean)||'';
  const phone=phoneOf(labeled(lines,/phone(?: number)?|mobile(?: phone)?|cell(?: phone)?|tel(?:ephone)?/))||phoneOf(text);

  const location=splitLocation(labeled(lines,/location|city(?:, state)?|address|lives in/));
  const parts=(name||'').split(' ').filter(Boolean);
  const dateHeader=Date.parse(p.headers.get('date')||'');
  return {board,firstName:clean(parts.shift(),80),lastName:clean(parts.join(' '),80),email,phone,city:location.city,state:location.state,zip:location.zip,position,
    appliedAt:Number.isFinite(dateHeader)?new Date(dateHeader).toISOString():null};
}

export type IntakeResult={status:'added'|'duplicate'|'unreadable'|'unknown_agency';employerId:string;applicantId:string;name:string};

/**
 * Reads one message sent to apply+<key>@carejoys.com into that agency's list. A message with neither a phone nor an
 * email (a Gmail forwarding confirmation, a board's weekly summary) is left for an operator in the inbox instead.
 */
export async function receiveApplicantEmail(db:ApplicantDb,key:string,p:ParsedEmail):Promise<IntakeResult>{
  const employer=await db.prepare("SELECT id FROM employer_leads WHERE intake_key=? AND status!='disabled' LIMIT 1").bind(key).first<Row>();
  if(!employer)return {status:'unknown_agency',employerId:'',applicantId:'',name:''};
  const employerId=clean(employer.id,100);
  const a=applicantFromEmail(p,p.headers.get('reply-to')||'');
  const name=[a.firstName,a.lastName].filter(Boolean).join(' ');
  const dedupeKey=a.phone||a.email;
  if(!dedupeKey)return {status:'unreadable',employerId,applicantId:'',name};
  const id=crypto.randomUUID();
  const res=await db.prepare(`INSERT INTO agency_applicants(id,employer_id,dedupe_key,first_name,last_name,email,phone,city,state,zip,position,source,source_detail,applied_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,'indeed-forward',?,?) ON CONFLICT(employer_id,dedupe_key) DO NOTHING`)
    .bind(id,employerId,dedupeKey,a.firstName||null,a.lastName||null,a.email||null,a.phone||null,a.city||null,a.state||null,a.zip||null,a.position||null,
      a.board+' email',a.appliedAt).run();
  if(!Number(res.meta?.changes||0)){
    const existing=await db.prepare('SELECT id FROM agency_applicants WHERE employer_id=? AND dedupe_key=?').bind(employerId,dedupeKey).first<Row>();
    return {status:'duplicate',employerId,applicantId:clean(existing?.id,100),name};
  }
  return {status:'added',employerId,applicantId:id,name};
}
