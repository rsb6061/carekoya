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
