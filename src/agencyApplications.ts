import type { FeatureEnv } from './serverFeatures';
import { agencyApplicationEmail } from './email';
import { loadResume } from './resumeFile';

// Agencies that said "yes" to the outreach note without claiming a workspace: their applications are emailed to
// agency_organizations.application_email, one email per application with the resume attached. An agency can also
// require a credential (required_credentials, e.g. "cna,emt,ma"); caregivers without one can't apply to its jobs.

type Row=Record<string,unknown>;
const clean=(v:unknown,max=500)=>typeof v==='string'?v.trim().slice(0,max):'';
const asNum=(v:unknown)=>{const n=Number(v||0);return Number.isFinite(n)?n:0};

/** True when an agency gets applications through CareJoys: a claimed workspace, or applications by email. Needs the org joined as `o`. */
export const ON_CAREJOYS_SQL="(o.claimed_employer_id IS NOT NULL OR COALESCE(o.application_email,'')<>'')";

const CREDENTIAL_PATTERNS:Record<string,{label:string;re:RegExp}>={
  cna:{label:'CNA',re:/\b(cna|c\.n\.a\.?|certified nursing assistant|gna|geriatric nursing assistant)\b/},
  emt:{label:'EMT',re:/\b(emt|emt-b|emt-p|emergency medical technician|paramedic)\b/},
  ma:{label:'MA',re:/\b(ma|cma|ccma|rma|medical assistant)\b/},
  hha:{label:'HHA',re:/\b(hha|home health aide)\b/},
  cmt:{label:'CMT',re:/\b(cmt|med tech|medication technician)\b/},
  lvn:{label:'LVN',re:/\b(lvn|lpn|licensed vocational nurse|licensed practical nurse)\b/},
  lpn:{label:'LPN',re:/\b(lpn|lvn|licensed practical nurse|licensed vocational nurse)\b/},
  rn:{label:'RN',re:/\b(rn|registered nurse)\b/}
};

export function parseRequiredCredentials(v:unknown){
  return [...new Set(clean(v,200).toLowerCase().split(/[\s,]+/).filter(k=>k in CREDENTIAL_PATTERNS))];
}

/** "CNA, EMT or MA" */
export function credentialListLabel(keys:string[]){
  const labels=keys.map(k=>CREDENTIAL_PATTERNS[k]?.label||k.toUpperCase());
  return labels.length<=1?labels.join(''):labels.slice(0,-1).join(', ')+' or '+labels[labels.length-1];
}

/** Whether a caregiver's role and certifications show one of the required credentials. No requirement means yes. */
export function meetsRequiredCredentials(c:Row,required:unknown){
  const keys=parseRequiredCredentials(required);
  if(!keys.length)return true;
  const text=[clean(c.role),clean(c.certifications,1000)].join(' ').toLowerCase();
  return keys.some(k=>CREDENTIAL_PATTERNS[k].re.test(text));
}

export function credentialRequiredMessage(employerName:string,required:unknown){
  const list=credentialListLabel(parseRequiredCredentials(required));
  // Said letter by letter: "an EMT", "a CNA".
  return `${employerName||'This employer'} only hires caregivers with ${/^[AEFHILMNORSX]/.test(list)?'an':'a'} ${list} license. If you have one, add it under Certifications on your profile, then apply.`;
}

/**
 * Emails one application to an agency's application_email: the caregiver's details, availability and resume.
 * Marks the agency_interests row notified so the daily Inbox digest doesn't repeat it.
 */
export async function emailApplicationToAgency(env:FeatureEnv,input:{organizationId:string;caregiverId:string;jobId:string;jobTitle:string;availability:string}){
  if(!env.DB||!env.EMAIL)return 'skipped';
  const org=await env.DB.prepare('SELECT id,canonical_name,application_email,primary_contact_name FROM agency_organizations WHERE id=? AND is_active=1').bind(input.organizationId).first<Row>();
  const to=clean(org?.application_email,320).toLowerCase();
  if(!org||!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to))return 'skipped';
  const c=await env.DB.prepare('SELECT first_name,last_name,email,phone,city,state,zip,role,certifications,license_number,license_state,years_experience,desired_wage,start_availability FROM caregivers WHERE id=? LIMIT 1')
    .bind(input.caregiverId).first<Row>();
  if(!c)return 'skipped';
  const resume=await loadResume(env,input.caregiverId).catch(()=>null);
  const caregiverEmail=clean(c.email,320).toLowerCase();
  const body=agencyApplicationEmail({
    agencyName:clean(org.canonical_name,200),contactName:clean(org.primary_contact_name,120).split(/\s+/)[0]||'',jobTitle:input.jobTitle,
    name:[clean(c.first_name,80),clean(c.last_name,80)].filter(Boolean).join(' '),email:caregiverEmail,phone:clean(c.phone,40),
    location:[clean(c.city,80),clean(c.state,4),clean(c.zip,10)].filter(Boolean).join(', '),
    credentials:[clean(c.role,80),clean(c.certifications,300)].filter(Boolean).join(' · '),
    license:[clean(c.license_number,60),clean(c.license_state,4)].filter(Boolean).join(' · '),
    experience:asNum(c.years_experience)>0?asNum(c.years_experience)+' years':'',availability:input.availability,
    start:clean(c.start_availability,40).replace(/_/g,' '),desiredPay:clean(c.desired_wage,80),hasResume:!!resume
  });
  try{
    const result=await env.EMAIL.send({from:'CareJoys <hello@carejoys.com>',to,subject:body.subject,html:body.html,text:body.text,
      ...(/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(caregiverEmail)?{replyTo:caregiverEmail}:{}),
      ...(resume?{attachments:[{content:resume.bytes,filename:resume.name||'resume.pdf',type:resume.mimeType||'application/octet-stream',disposition:'attachment' as const}]}:{})});
    await env.DB.prepare('UPDATE agency_interests SET agency_notified_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE organization_id=? AND caregiver_id=? AND job_key=?')
      .bind(input.organizationId,input.caregiverId,input.jobId).run();
    await env.DB.prepare("INSERT INTO agency_outreach_events(id,organization_id,event_type,recipient_email,provider_message_id,payload) VALUES (?,?,'application_emailed',?,?,?)")
      .bind(crypto.randomUUID(),input.organizationId,to,result.messageId||null,JSON.stringify({caregiverId:input.caregiverId,jobId:input.jobId,resume:!!resume})).run();
    return 'sent';
  }catch(error){
    await env.DB.prepare("INSERT INTO agency_outreach_events(id,organization_id,event_type,recipient_email,payload) VALUES (?,?,'application_emailed_failed',?,?)")
      .bind(crypto.randomUUID(),input.organizationId,to,JSON.stringify({caregiverId:input.caregiverId,jobId:input.jobId,error:error instanceof Error?error.message:'send failed'})).run();
    return 'failed';
  }
}

/**
 * Sets up an agency that said yes: applications to its jobs are emailed to `email`, only from caregivers with one of
 * `credentials` when any are given, and a CareJoys account on that address is linked to the agency (unless another
 * account already has it), so a sign-in link at /login opens its workspace. Run on a plain "yes" reply and from /admin.
 */
export async function setUpYesAgency(env:FeatureEnv,input:{organizationId:string;email:string;credentials?:unknown;contactName?:string;source:string}){
  const db=env.DB!;
  const email=clean(input.email,320).toLowerCase();
  if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))throw new Error('Enter a valid email for applications.');
  const org=await db.prepare('SELECT id,canonical_name,zip,provider_kind,claimed_employer_id FROM agency_organizations WHERE id=? AND is_active=1').bind(input.organizationId).first<Row>();
  if(!org)throw new Error('That agency is not on CareJoys.');
  const credentials=parseRequiredCredentials(Array.isArray(input.credentials)?input.credentials.join(','):input.credentials).join(',');
  await db.prepare('UPDATE agency_organizations SET application_email=?,required_credentials=NULLIF(?,\'\'),updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(email,credentials,org.id).run();
  let employerId=clean(org.claimed_employer_id,120);
  let linked=false;
  if(!employerId){
    const existing=await db.prepare("SELECT id FROM employer_leads WHERE lower(email)=? AND status!='disabled' ORDER BY created_at DESC LIMIT 1").bind(email).first<{id:string}>();
    employerId=existing?.id||crypto.randomUUID();
    // Rebecca's outreach found this agency and it answered her, so the account needs no approval.
    if(!existing)await db.prepare(`INSERT INTO employer_leads(id,company_name,contact_name,email,zip,roles_needed,hiring_notes,status,employer_type,approved_at,approved_by)
      VALUES (?,?,?,?,?,'Caregiver, CNA, HHA, PCA','Said yes to outreach','active',?,CURRENT_TIMESTAMP,'agency_yes')`)
      .bind(employerId,clean(org.canonical_name,200),clean(input.contactName,120),email,clean(org.zip,10).slice(0,5),clean(org.provider_kind,40)==='facility'?'assisted_living':'home_care').run();
    else await db.prepare('UPDATE employer_leads SET approved_at=COALESCE(approved_at,CURRENT_TIMESTAMP) WHERE id=?').bind(employerId).run();
    const res=await db.prepare('UPDATE agency_organizations SET claimed_employer_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND claimed_employer_id IS NULL').bind(employerId,org.id).run();
    linked=asNum((res as {meta?:{changes?:number}}).meta?.changes)===1;
    if(linked)await db.prepare('UPDATE agencies SET claimed_employer_id=?,updated_at=CURRENT_TIMESTAMP WHERE organization_id=? AND claimed_employer_id IS NULL').bind(employerId,org.id).run();
  }
  await db.prepare("INSERT INTO agency_outreach_events(id,organization_id,event_type,recipient_email,payload) VALUES (?,?,'agency_yes_setup',?,?)")
    .bind(crypto.randomUUID(),org.id,email,JSON.stringify({source:input.source,credentials,employerId,linked})).run();
  return {applicationEmail:email,requiredCredentials:credentialListLabel(parseRequiredCredentials(credentials)),employerId,linked};
}

/** A reply that is just a yes ("Yes", "Sure, thanks!", "Yes please"): its first line and nothing else of substance. */
export function isPlainYes(text:string){
  const lines=clean(text,2000).split('\n').map(l=>l.trim()).filter(Boolean);
  // "Yes, but only CNAs" or a condition on the next line needs Rebecca: anything conditional goes to /admin instead.
  if(/\b(only|licen[cs]e|licensed|certif\w*|but|if|unless|require\w*|must|call me|question)\b/i.test(lines.join(' ')))return false;
  const first=lines[0]||'';
  return /^(yes|yes please|yes,? please|sure|ok|okay|yep|yeah|absolutely|definitely|sounds good|please do|interested|yes,? interested)[\s.!,]*(please|thanks|thank you|thx)?[\s.!]*$/i.test(first);
}
