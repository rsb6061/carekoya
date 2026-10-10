import { FREE_MAIL } from './employerApproval';
import { adminRecipients } from './monitoring';
import { employerSession, publicFormGuard, sendEmployerMagicLink, type FeatureEnv } from './serverFeatures';
import { TEST_JOB_REASON } from './agencyFeatures';
import { payLabel } from './jobFormat';
import { normalizeTitle, notAJobPosting } from './jobDiscovery';

// Self-serve agency claiming: find your agency, prove you work there, and link it to a CareJoys workspace.
type Row=Record<string,unknown>;
export type AgencyClaimEnv=FeatureEnv&{ADMIN_EMAILS?:string};

const clean=(v:unknown,max=500)=>typeof v==='string'?v.trim().slice(0,max):'';
const asNum=(v:unknown)=>{const n=Number(v||0);return Number.isFinite(n)?n:0};
const json=(body:unknown,init:ResponseInit={})=>new Response(JSON.stringify(body),{
  ...init,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...(init.headers||{})}
});
const emailValid=(v:string)=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

export function normalizeDomain(value:unknown){
  let v=clean(value,300).toLowerCase();
  if(!v)return '';
  if(v.includes('@'))v=v.split('@').pop()||'';
  v=v.replace(/^[a-z]+:\/\//,'').split(/[/?#:]/)[0].replace(/^www\./,'').replace(/\.$/,'');
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(v)?v:'';
}

/** True when the email is at the agency's own website domain (or a subdomain of it), never a free-mail provider. */
export function emailMatchesAgencyDomain(email:string,org:Row){
  const emailDomain=normalizeDomain(email);
  const orgDomain=normalizeDomain(org.primary_domain)||normalizeDomain(org.primary_website);
  if(!emailDomain||!orgDomain||FREE_MAIL.has(emailDomain)||FREE_MAIL.has(orgDomain))return false;
  return emailDomain===orgDomain||emailDomain.endsWith('.'+orgDomain);
}

/** "jane@agency.com" → "j***@agency.com", enough for the person to recognise the inbox without exposing it. */
export function maskEmail(email:string){
  const [user,domain]=email.split('@');
  if(!user||!domain)return '';
  return user.charAt(0)+'***@'+domain;
}

function publicAgency(org:Row){
  const email=clean(org.primary_email,320).toLowerCase();
  return {
    id:clean(org.id,100),name:clean(org.canonical_name,200),city:clean(org.city,120),state:clean(org.state,20),zip:clean(org.zip,10),
    providerTypes:clean(org.provider_types,300),website:clean(org.primary_website,500),domain:normalizeDomain(org.primary_domain)||normalizeDomain(org.primary_website),
    claimed:!!org.claimed_employer_id,emailOnFile:emailValid(email)?maskEmail(email):null
  };
}

export async function searchAgencies(url:URL,env:FeatureEnv){
  if(!env.DB)return json({ok:false,error:'Database not configured'},{status:503});
  const q=clean(url.searchParams.get('q'),120);
  const zip=clean(url.searchParams.get('zip'),10).replace(/\D/g,'').slice(0,5);
  const state=clean(url.searchParams.get('state'),2).toUpperCase();
  if(q.length<2&&zip.length<5)return json({ok:true,agencies:[]});
  let sql="SELECT id,canonical_name,city,state,zip,provider_types,primary_website,primary_domain,primary_email,claimed_employer_id FROM agency_organizations WHERE is_active=1 AND COALESCE(is_test,0)=0";
  const args:unknown[]=[];
  if(q.length>=2){
    const like='%'+q.toLowerCase().replace(/[%_]/g,'')+'%';
    sql+=" AND (lower(canonical_name) LIKE ? OR lower(COALESCE(primary_domain,'')) LIKE ?)";args.push(like,like);
  }
  if(zip.length===5){sql+=" AND (zip=? OR substr(COALESCE(zip,''),1,3)=?)";args.push(zip,zip.slice(0,3))}
  // A ZIP already pins the area, so an agency on the wrong state's page still finds itself by ZIP.
  if(/^[A-Z]{2}$/.test(state)&&zip.length!==5){sql+=' AND upper(state)=?';args.push(state)}
  sql+=' ORDER BY CASE WHEN zip=? THEN 0 ELSE 1 END,license_count DESC,canonical_name LIMIT 10';args.push(zip);
  const rows=await env.DB.prepare(sql).bind(...args).all<Row>();
  return json({ok:true,agencies:(rows.results||[]).map(publicAgency)});
}

async function employerForEmail(env:FeatureEnv,email:string,companyName:string){
  const existing=await env.DB!.prepare("SELECT id FROM employer_leads WHERE lower(email)=? AND status!='disabled' ORDER BY created_at DESC LIMIT 1").bind(email).first<{id:string}>();
  if(existing)return existing.id;
  const id=crypto.randomUUID();
  await env.DB!.prepare("INSERT INTO employer_leads(id,company_name,contact_name,email,zip,roles_needed,hiring_notes,status) VALUES (?,?,?,?,?,'Caregiver, CNA, HHA, PCA','Self-serve agency claim','active')")
    .bind(id,companyName,'',email,'').run();
  return id;
}

/** Records a pending claim on a claim token; verifying the magic link (serverFeatures) links the agency. */
async function recordPendingClaim(env:FeatureEnv,orgId:string,email:string,employerId:string,source:string){
  const tokenHash=crypto.randomUUID()+crypto.randomUUID();
  const expires=new Date(Date.now()+7*86400000).toISOString();
  await env.DB!.prepare("INSERT INTO agency_teaser_tokens(id,organization_id,token_hash,recipient_email,expires_at,sent_at,claim_requested_at,employer_id) VALUES (?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,?)")
    .bind(crypto.randomUUID(),orgId,tokenHash,email,expires,employerId).run();
  await env.DB!.prepare("INSERT INTO agency_outreach_events(id,organization_id,event_type,recipient_email,payload) VALUES (?,?,'agency_claim_started',?,?)")
    .bind(crypto.randomUUID(),orgId,email,JSON.stringify({source,employerId})).run();
}

async function linkAgency(env:FeatureEnv,orgId:string,employerId:string,source:string){
  const res=await env.DB!.prepare("UPDATE agency_organizations SET claimed_employer_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND claimed_employer_id IS NULL").bind(employerId,orgId).run();
  if(asNum(res.meta?.changes)!==1)return false;
  await env.DB!.prepare("UPDATE agencies SET claimed_employer_id=?,updated_at=CURRENT_TIMESTAMP WHERE organization_id=? AND claimed_employer_id IS NULL").bind(employerId,orgId).run();
  await env.DB!.prepare("INSERT INTO agency_outreach_events(id,organization_id,event_type,payload) VALUES (?,?,'agency_claim_verified',?)")
    .bind(crypto.randomUUID(),orgId,JSON.stringify({employerId,source})).run();
  return true;
}

/**
 * Starts a claim. Three ways to prove you belong to the agency, strongest first:
 * 1. Signed in with an email at the agency's website domain: linked immediately.
 * 2. A work email at the agency's domain: a sign-in link goes to that address.
 * 3. Otherwise a sign-in link goes to the email on the agency's public record; with no email on file
 *    the request goes to CareJoys for manual review.
 */
export async function startAgencyClaim(request:Request,env:AgencyClaimEnv){
  if(!env.DB||!env.EMAIL)return json({ok:false,error:'CareJoys email is not configured'},{status:503});
  const data=await request.json().catch(()=>null) as Row|null;
  const session=await employerSession(request,env);
  const org=await env.DB.prepare("SELECT * FROM agency_organizations WHERE id=? AND is_active=1 LIMIT 1").bind(clean(data?.organizationId,100)).first<Row>();
  if(!org)return json({ok:false,error:'Agency not found'},{status:404});
  if(org.claimed_employer_id){
    if(session&&clean(org.claimed_employer_id,100)===clean(session.id,100))return json({ok:true,claimed:true,message:'This agency is already linked to your workspace.'});
    return json({ok:false,error:'This agency is already linked to a CareJoys workspace. Sign in with that account, or contact hello@carejoys.com.'},{status:409});
  }
  const orgId=clean(org.id,100);
  const orgName=clean(org.canonical_name,200);

  const sessionEmail=clean(session?.email,320).toLowerCase();
  if(session&&emailMatchesAgencyDomain(sessionEmail,org)){
    await linkAgency(env,orgId,clean(session.id,100),'session_domain_match');
    return json({ok:true,claimed:true,message:orgName+' is now linked to your workspace.'});
  }

  // Everything below sends email, so it gets the public form guard (Turnstile + rate limit).
  const guard=await publicFormGuard(request,env,'agency_claim_start',data,5,30);
  if(guard)return guard;

  const workEmail=clean(data?.email,320).toLowerCase();
  if(workEmail&&!emailValid(workEmail))return json({ok:false,error:'Enter a valid work email address'},{status:400});
  if(workEmail&&emailMatchesAgencyDomain(workEmail,org)){
    const employerId=await employerForEmail(env,workEmail,orgName);
    await recordPendingClaim(env,orgId,workEmail,employerId,'work_email_domain');
    await sendEmployerMagicLink(env,employerId,'/app?tab=hiring');
    return json({ok:true,sentTo:maskEmail(workEmail),message:'Check '+maskEmail(workEmail)+' for a secure link. Clicking it links '+orgName+' to your workspace.'});
  }

  const onFile=clean(org.primary_email,320).toLowerCase();
  if(emailValid(onFile)){
    const employerId=await employerForEmail(env,onFile,orgName);
    await recordPendingClaim(env,orgId,onFile,employerId,'email_on_file');
    await sendEmployerMagicLink(env,employerId,'/app?tab=hiring');
    return json({ok:true,sentTo:maskEmail(onFile),message:'We sent a secure link to the email on '+orgName+'’s public record ('+maskEmail(onFile)+'). Whoever opens it can manage the agency on CareJoys.'});
  }

  if(!workEmail)return json({ok:false,needsEmail:true,error:'We have no email on file for this agency. Enter your work email and CareJoys will verify you by hand.'},{status:400});
  await env.DB.prepare("INSERT INTO agency_outreach_events(id,organization_id,event_type,recipient_email,payload) VALUES (?,?,'manual_claim_requested',?,?)")
    .bind(crypto.randomUUID(),orgId,workEmail,JSON.stringify({name:clean(data?.name,200),phone:clean(data?.phone,40)})).run();
  const admins=await adminRecipients(env);
  for(const to of admins.slice(0,5)){
    await env.EMAIL.send({from:'CareJoys <hello@carejoys.com>',to,replyTo:workEmail,subject:'Manual agency claim: '+orgName,
      text:workEmail+' asked to manage '+orgName+' ('+[org.city,org.state].filter(Boolean).join(', ')+') on CareJoys. Agency id: '+orgId+'. Reply to them after checking they work there.',
      html:'<p>'+escapeHtml(workEmail)+' asked to manage <strong>'+escapeHtml(orgName)+'</strong> ('+escapeHtml([org.city,org.state].filter(Boolean).join(', '))+') on CareJoys.</p><p>Agency id: '+escapeHtml(orgId)+'</p><p>Reply to them after checking they work there.</p>'}).catch(()=>null);
  }
  return json({ok:true,manual:true,message:'Thanks. CareJoys will confirm you work at '+orgName+' and email '+workEmail+'.'});
}

const escapeHtml=(v:unknown)=>String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]||ch));

/** For a signed-in employer with no linked agency: the agencies that most likely belong to them. */
export async function agencySuggestions(request:Request,env:FeatureEnv){
  if(!env.DB)return json({ok:false,error:'Database not configured'},{status:503});
  const employer=await employerSession(request,env);
  if(!employer)return json({ok:false,error:'Sign in required'},{status:401});
  const linked=await env.DB.prepare("SELECT id FROM agency_organizations WHERE claimed_employer_id=? LIMIT 1").bind(employer.id).first();
  if(linked)return json({ok:true,linked:true,agencies:[]});
  const domain=normalizeDomain(employer.email);
  const results=new Map<string,Row>();
  if(domain&&!FREE_MAIL.has(domain)){
    const rows=await env.DB.prepare("SELECT * FROM agency_organizations WHERE is_active=1 AND COALESCE(is_test,0)=0 AND (lower(primary_domain)=? OR lower(primary_website) LIKE ?) LIMIT 5").bind(domain,'%'+domain+'%').all<Row>();
    for(const r of rows.results||[])results.set(clean(r.id,100),r);
  }
  const company=clean(employer.company_name,200).toLowerCase().replace(/\b(llc|inc|corp|co|ltd|the)\b\.?/g,'').replace(/[^a-z0-9 ]+/g,' ').trim();
  if(company.length>=3){
    const zip=clean(employer.zip,10).slice(0,3);
    const rows=await env.DB.prepare("SELECT * FROM agency_organizations WHERE is_active=1 AND COALESCE(is_test,0)=0 AND lower(canonical_name) LIKE ? ORDER BY CASE WHEN substr(COALESCE(zip,''),1,3)=? THEN 0 ELSE 1 END,license_count DESC LIMIT 5")
      .bind('%'+company.split(/\s+/).slice(0,3).join('%')+'%',zip).all<Row>();
    for(const r of rows.results||[])results.set(clean(r.id,100),r);
  }
  const agencies=[...results.values()].slice(0,5).map(org=>({...publicAgency(org),domainMatch:emailMatchesAgencyDomain(clean(employer.email,320),org)}));
  return json({ok:true,linked:false,agencies});
}

/** The jobs CareJoys found on the claimed agency's careers page, including any the agency hid. */
export async function agencyJobs(request:Request,env:FeatureEnv){
  if(!env.DB)return json({ok:false,error:'Database not configured'},{status:503});
  const employer=await employerSession(request,env);
  if(!employer)return json({ok:false,error:'Sign in required'},{status:401});
  const org=await env.DB.prepare("SELECT id FROM agency_organizations WHERE claimed_employer_id=? AND is_active=1 LIMIT 1").bind(employer.id).first<Row>();
  if(!org)return json({ok:true,jobs:[]});
  const rows=await env.DB.prepare(`SELECT j.id,j.title,j.role,j.city,j.state,j.pay_min,j.pay_max,j.pay_period,j.source_url,j.is_published,j.publication_reason,j.last_seen_at,
      (SELECT COUNT(*) FROM caregiver_job_apply_events a WHERE a.caregiver_job_id=j.id) AS apply_clicks
    FROM caregiver_jobs j WHERE j.agency_organization_id=? AND j.status='current' AND (j.is_published=1 OR j.publication_reason IN ('hidden_by_employer',?))
    ORDER BY j.is_published DESC,j.last_seen_at DESC LIMIT 200`).bind(org.id,TEST_JOB_REASON).all<Row>();
  return json({ok:true,jobs:(rows.results||[]).map(r=>({id:r.id,title:r.title,role:r.role,city:r.city,state:r.state,payMin:r.pay_min,payMax:r.pay_max,payPeriod:r.pay_period,
    sourceUrl:r.source_url,published:asNum(r.is_published)===1||r.publication_reason===TEST_JOB_REASON,hidden:r.publication_reason==='hidden_by_employer',lastSeenAt:r.last_seen_at,applyClicks:asNum(r.apply_clicks)}))});
}

/** Hide or re-show one of the agency's jobs on CareJoys. Edits belong on the agency's own careers page, which CareJoys re-reads. */
export async function updateAgencyJob(request:Request,env:FeatureEnv,jobId:string){
  if(!env.DB)return json({ok:false,error:'Database not configured'},{status:503});
  const employer=await employerSession(request,env);
  if(!employer)return json({ok:false,error:'Sign in required'},{status:401});
  const job=await env.DB.prepare(`SELECT j.id,j.title,j.role,j.city,j.state,j.zip,j.pay_min,j.pay_max,j.pay_period,j.publication_reason,j.agency_organization_id,COALESCE(ao.is_test,0) AS is_test
    FROM caregiver_jobs j JOIN agency_organizations ao ON ao.id=j.agency_organization_id
    WHERE j.id=? AND ao.claimed_employer_id=? AND j.status='current' LIMIT 1`).bind(jobId,employer.id).first<Row>();
  if(!job)return json({ok:false,error:'Job not found'},{status:404});
  const data=await request.json().catch(()=>null) as Row|null;
  const action=clean(data?.action,10);
  if(action==='recruit')return json({ok:true,openingId:await openingForJob(env,clean(employer.id,100),job)});
  if(action==='hide'){
    await env.DB.prepare("UPDATE caregiver_jobs SET is_published=0,publication_reason='hidden_by_employer',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(jobId).run();
  }else if(action==='show'){
    if(job.publication_reason!=='hidden_by_employer')return json({ok:true});
    // A test agency's copied jobs go back to looking live in its panel but are never published.
    if(asNum(job.is_test)===1)await env.DB.prepare("UPDATE caregiver_jobs SET publication_reason=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(TEST_JOB_REASON,jobId).run();
    else await env.DB.prepare("UPDATE caregiver_jobs SET is_published=1,publication_reason='employer_restored',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(jobId).run();
  }else return json({ok:false,error:'Choose hide, show or recruit'},{status:400});
  return json({ok:true});
}

const OPENING_ROLES=['CNA','GNA','HHA','PCA','DSP','Caregiver'];

/** The opening that recruits for one of the agency's own job listings, created from the listing the first time. */
async function openingForJob(env:FeatureEnv,employerId:string,job:Row){
  const existing=await env.DB!.prepare("SELECT id FROM openings WHERE employer_id=? AND caregiver_job_id=? AND status='open' ORDER BY created_at DESC LIMIT 1").bind(employerId,job.id).first<{id:string}>();
  if(existing)return existing.id;
  const roleText=(clean(job.role,80)+' '+clean(job.title,200)).toUpperCase();
  const role=OPENING_ROLES.find(r=>new RegExp('\\b'+r.toUpperCase()+'\\b').test(roleText))||'Caregiver';
  const hourly=!clean(job.pay_period,20)||clean(job.pay_period,20)==='hour';
  const id=crypto.randomUUID();
  await env.DB!.prepare(`INSERT INTO openings(id,employer_id,title,role,city,state,zip,pay_min,pay_max,status,source,agency_organization_id,caregiver_job_id)
    VALUES (?,?,?,?,?,?,?,?,?,'open','agency_job',?,?)`)
    .bind(id,employerId,clean(job.title,200)||role+' opening',role,clean(job.city,120),clean(job.state,80),clean(job.zip,20).slice(0,5),
      hourly?asNum(job.pay_min)||null:null,hourly?asNum(job.pay_max)||null:null,clean(job.agency_organization_id,100),clean(job.id,100)).run();
  return id;
}

const WIDGET_CORS={'access-control-allow-origin':'*','access-control-allow-methods':'GET, OPTIONS','access-control-allow-headers':'content-type'};

/** Public feed behind the embeddable jobs widget (/widget.js) on a claimed agency's own website. */
export async function agencyJobsFeed(request:Request,env:FeatureEnv,orgId:string){
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:WIDGET_CORS});
  if(!env.DB)return json({ok:false,error:'Database not configured'},{status:503,headers:WIDGET_CORS});
  // Only agencies that claimed their CareJoys profile get a widget, so applications reach someone.
  const org=await env.DB.prepare("SELECT id,canonical_name FROM agency_organizations WHERE id=? AND is_active=1 AND COALESCE(is_test,0)=0 AND claimed_employer_id IS NOT NULL LIMIT 1").bind(orgId).first<Row>();
  if(!org)return json({ok:false,error:'Agency not found'},{status:404,headers:WIDGET_CORS});
  const rows=await env.DB.prepare(`SELECT id,title,role,city,state,pay_min,pay_max,pay_period,employment_type,source_url,source_provider,publication_reason FROM caregiver_jobs
    WHERE agency_organization_id=? AND is_published=1 AND status='current' ORDER BY last_seen_at DESC LIMIT 50`).bind(org.id).all<Row>();
  // Same junk check as the jobs list, unless the agency chose to show the job again.
  const jobs=(rows.results||[]).filter(r=>r.publication_reason==='employer_restored'||!notAJobPosting(String(r.title||''),String(r.source_url||''),String(r.source_provider||''))).map(r=>({id:clean(r.id,120),title:normalizeTitle(r.title),role:clean(r.role,40),city:clean(r.city,120),state:clean(r.state,20),
    pay:payLabel({payMin:r.pay_min,payMax:r.pay_max,payPeriod:r.pay_period})||'',employmentType:clean(r.employment_type,60),
    url:'https://carejoys.com/jobs/'+encodeURIComponent(clean(r.id,120))+'?ref=widget'}));
  return json({ok:true,agency:{id:clean(org.id,100),name:clean(org.canonical_name,200)},jobs},{headers:{...WIDGET_CORS,'cache-control':'public,max-age=300'}});
}
