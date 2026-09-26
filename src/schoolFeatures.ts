import { schoolMagicLinkEmail, schoolPlacementInviteEmail, type EmailBinding } from './email';
import { publicFormGuard, type FeatureEnv } from './serverFeatures';

type Row=Record<string,unknown>;
const clean=(v:unknown,max=500)=>typeof v==='string'?v.trim().slice(0,max):'';
const emailValid=(v:string)=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const json=(body:unknown,init:ResponseInit={})=>new Response(JSON.stringify(body),{
  ...init,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...(init.headers||{})}
});
async function sha256Hex(value:string){
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash)).map(b=>b.toString(16).padStart(2,'0')).join('');
}
function cookie(request:Request,name:string){
  const raw=request.headers.get('cookie')||'';
  for(const piece of raw.split(';')){
    const [key,...rest]=piece.trim().split('=');
    if(key===name)return decodeURIComponent(rest.join('='));
  }
  return '';
}
function emailDomain(email:string){
  const at=email.lastIndexOf('@');
  return at>0?email.slice(at+1).toLowerCase():'';
}
function websiteDomain(url:string){
  try{return new URL(url).hostname.toLowerCase().replace(/^www\./,'')}catch{return ''}
}

async function programBySlug(env:FeatureEnv,slug:string){
  if(!env.DB)return null;
  const direct=await env.DB.prepare(`SELECT tp.*,src.slug AS referral_slug,NULL AS cohort_id,NULL AS cohort_name
    FROM school_referral_codes src
    JOIN training_programs tp ON tp.id=src.training_program_id
    WHERE src.slug=? AND src.status='active' AND tp.is_active=1
    LIMIT 1`).bind(slug).first<Row>();
  if(direct)return direct;
  return env.DB.prepare(`SELECT tp.*,src.slug AS referral_slug,co.id AS cohort_id,co.name AS cohort_name
    FROM training_program_cohorts co
    JOIN training_programs tp ON tp.id=co.training_program_id
    LEFT JOIN school_referral_codes src ON src.training_program_id=tp.id AND src.status='active'
    WHERE co.referral_code=? AND co.status='active' AND tp.is_active=1
    ORDER BY src.created_at
    LIMIT 1`).bind(slug).first<Row>();
}

export async function listPublicTrainingPrograms(url:URL,env:FeatureEnv){
  if(!env.DB)return json({ok:false,error:'Database not configured'},{status:503});
  const providerType=clean(url.searchParams.get('providerType'),120);
  const city=clean(url.searchParams.get('city'),120);
  let rows=(await env.DB.prepare(`SELECT tp.program_name,tp.provider_type,tp.city,tp.state,tp.zip,tp.program_type,tp.credential_category,tp.renewal_due,
      tp.website,src.slug,torg.canonical_name AS organization_name,torg.slug AS organization_slug
    FROM training_programs tp
    JOIN school_referral_codes src ON src.training_program_id=tp.id AND src.status='active'
    LEFT JOIN training_organizations torg ON torg.id=tp.organization_id AND torg.is_active=1
    WHERE tp.is_active=1 AND tp.source='maryland_mbon_natp'
      AND tp.provider_type IN ('Freestanding Program','College','High School')
    ORDER BY tp.provider_type,tp.city,tp.program_name LIMIT 300`).all<Row>()).results||[];
  if(providerType)rows=rows.filter(r=>clean(r.provider_type,120).toLowerCase()===providerType.toLowerCase());
  if(city)rows=rows.filter(r=>clean(r.city,120).toLowerCase()===city.toLowerCase());
  return json({ok:true,total:rows.length,programs:rows.map(r=>({
    name:r.program_name,providerType:r.provider_type,city:r.city,state:r.state,zip:r.zip,programType:r.program_type,
    credentialCategory:r.credential_category||'CNA/GNA',renewalDue:r.renewal_due,website:r.website||null,slug:r.slug,
    organizationName:r.organization_name||r.program_name,organizationSlug:r.organization_slug||null,
    referralUrl:'https://carejoys.com/join/'+encodeURIComponent(String(r.slug||'')),
    programUrl:'https://carejoys.com/school/'+encodeURIComponent(String(r.slug||'')),
    organizationUrl:r.organization_slug?'https://carejoys.com/training-programs/'+encodeURIComponent(String(r.organization_slug)):null
  }))});
}

export async function publicSchoolProgram(slug:string,env:FeatureEnv){
  const p=await programBySlug(env,slug);
  if(!p)return json({ok:false,error:'Training program not found'},{status:404});
  const org=p.organization_id?await env.DB?.prepare("SELECT canonical_name,slug FROM training_organizations WHERE id=? AND is_active=1 LIMIT 1").bind(p.organization_id).first<Row>():null;
  return json({ok:true,program:{
    name:p.program_name,providerType:p.provider_type,address:p.address,city:p.city,state:p.state,zip:p.zip,
    programType:p.program_type,credentialCategory:p.credential_category||'CNA/GNA',currentStatus:p.current_status,dateLastApproved:p.date_last_approved,renewalDue:p.renewal_due,
    website:p.website||null,claimed:!!p.claimed_school_lead_id,cohortName:p.cohort_name||null,
    organizationName:org?.canonical_name||p.program_name,organizationSlug:org?.slug||null,
    organizationUrl:org?.slug?'https://carejoys.com/training-programs/'+encodeURIComponent(String(org.slug)):null,
    referralUrl:'https://carejoys.com/join/'+encodeURIComponent(String(p.cohort_id?slug:(p.referral_slug||'')))
  }});
}

export async function publicTrainingOrganization(slug:string,env:FeatureEnv){
  if(!env.DB)return json({ok:false,error:'Database not configured'},{status:503});
  const org=await env.DB.prepare(`SELECT id,canonical_name,slug,website,provider_types,credential_categories,location_count,active_program_count
    FROM training_organizations WHERE slug=? AND is_active=1 LIMIT 1`).bind(slug).first<Row>();
  if(!org)return json({ok:false,error:'Caregiver training program not found'},{status:404});
  const rows=await env.DB.prepare(`SELECT tp.id,tp.program_name,tp.provider_type,tp.address,tp.city,tp.state,tp.zip,tp.program_type,tp.credential_category,
      tp.current_status,tp.date_last_approved,tp.renewal_due,tp.website,src.slug AS referral_slug
    FROM training_programs tp
    LEFT JOIN school_referral_codes src ON src.training_program_id=tp.id AND src.status='active'
    WHERE tp.organization_id=? AND tp.is_active=1
    ORDER BY tp.city,tp.program_name`).bind(org.id).all<Row>();
  return json({ok:true,organization:{
    name:org.canonical_name,slug:org.slug,website:org.website||null,providerTypes:org.provider_types||null,
    credentialCategories:org.credential_categories||'CNA/GNA',locationCount:Number(org.location_count||0),
    activeProgramCount:Number(org.active_program_count||0),
    url:'https://carejoys.com/training-programs/'+encodeURIComponent(String(org.slug||''))
  },programs:(rows.results||[]).map(r=>({
    id:r.id,name:r.program_name,providerType:r.provider_type,address:r.address,city:r.city,state:r.state,zip:r.zip,
    programType:r.program_type,credentialCategory:r.credential_category||'CNA/GNA',currentStatus:r.current_status,
    dateLastApproved:r.date_last_approved,renewalDue:r.renewal_due,website:r.website||null,
    referralUrl:r.referral_slug?'https://carejoys.com/join/'+encodeURIComponent(String(r.referral_slug)):null,
    legacyProgramUrl:r.referral_slug?'https://carejoys.com/school/'+encodeURIComponent(String(r.referral_slug)):null
  }))});
}

async function sendSchoolMagic(env:FeatureEnv,lead:{id:string;contact_name?:string;email:string},program:Row){
  if(!env.DB||!env.EMAIL)throw new Error('Email service is not configured');
  const token=crypto.randomUUID()+'-'+crypto.randomUUID();
  const hash=await sha256Hex(token);
  const expires=new Date(Date.now()+15*60000).toISOString();
  await env.DB.prepare("DELETE FROM school_magic_links WHERE school_lead_id=? AND used_at IS NULL").bind(lead.id).run();
  await env.DB.prepare("INSERT INTO school_magic_links(id,school_lead_id,training_program_id,token_hash,expires_at) VALUES (?,?,?,?,?)")
    .bind(crypto.randomUUID(),lead.id,program.id,hash,expires).run();
  const link='https://carejoys.com/school-auth?token='+encodeURIComponent(token);
  const body=schoolMagicLinkEmail({
    contactName:clean(lead.contact_name,120).split(/\s+/)[0]||'there',
    programName:clean(program.program_name,200),
    link
  });
  await env.EMAIL.send({from:'CareJoys <updates@carejoys.com>',to:lead.email,subject:body.subject,html:body.html,text:body.text});
}

export async function requestSchoolAccess(request:Request,env:FeatureEnv){
  if(!env.DB||!env.EMAIL)return json({ok:false,error:'School sign-in email is not configured'},{status:503});
  const data=await request.json().catch(()=>null) as Row|null;
  const guard=await publicFormGuard(request,env,'school_claim',data,4,30);
  if(guard)return guard;
  const slug=clean(data?.slug,120);
  const email=clean(data?.email,320).toLowerCase();
  const contactName=clean(data?.contactName,160);
  const phone=clean(data?.phone,60);
  if(!slug||!emailValid(email)||!contactName)return json({ok:false,error:'Enter your name and work email.'},{status:400});
  const program=await programBySlug(env,slug);
  if(!program)return json({ok:false,error:'Training program not found.'},{status:404});

  const knownEmail=clean(program.email,320).toLowerCase();
  const knownWebsite=clean(program.website,500);
  const domain=emailDomain(email);
  const siteDomain=websiteDomain(knownWebsite);
  const affiliationVerified=(knownEmail&&knownEmail===email)||(siteDomain&&domain&&(domain===siteDomain||siteDomain.endsWith('.'+domain)||domain.endsWith('.'+siteDomain)));

  let lead=await env.DB.prepare("SELECT id,contact_name,email,status FROM school_leads WHERE lower(email)=? ORDER BY created_at DESC LIMIT 1").bind(email).first<{id:string;contact_name?:string;email:string;status?:string}>();
  if(!lead){
    const id=crypto.randomUUID();
    const status=affiliationVerified?'claim_verified_contact':'claim_pending';
    await env.DB.prepare(`INSERT INTO school_leads(id,organization_name,contact_name,email,phone,city,state,program_types,notes,status)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(id,program.program_name,contactName,email,phone,program.city,program.state,program.program_type,'Training program claim request',status).run();
    lead={id,contact_name:contactName,email,status};
  }

  if(!affiliationVerified){
    return json({ok:true,pending:true,message:'We received your access request. CareJoys will verify your affiliation with this training program before enabling the placement dashboard.'},{status:202});
  }

  await sendSchoolMagic(env,lead,program);
  return json({ok:true,pending:false,message:'Check your work email for a secure CareJoys sign-in link.'});
}

export async function verifySchoolMagic(request:Request,env:FeatureEnv){
  if(!env.DB)return json({ok:false,error:'Database not configured'},{status:503});
  const data=await request.json().catch(()=>null) as Row|null;
  const token=clean(data?.token,300);
  if(!token)return json({ok:false,error:'Sign-in link is missing.'},{status:400});
  const hash=await sha256Hex(token);
  const record=await env.DB.prepare(`SELECT id,school_lead_id,training_program_id
    FROM school_magic_links WHERE token_hash=? AND used_at IS NULL AND datetime(expires_at)>datetime('now') LIMIT 1`)
    .bind(hash).first<{id:string;school_lead_id:string;training_program_id:string}>();
  if(!record)return json({ok:false,error:'This school sign-in link is invalid or has expired.'},{status:400});

  await env.DB.prepare("UPDATE school_magic_links SET used_at=CURRENT_TIMESTAMP WHERE id=?").bind(record.id).run();
  const session=crypto.randomUUID()+'-'+crypto.randomUUID();
  const sessionHash=await sha256Hex(session);
  const expires=new Date(Date.now()+30*86400000).toISOString();
  await env.DB.prepare("INSERT INTO school_sessions(id,school_lead_id,training_program_id,session_hash,expires_at) VALUES (?,?,?,?,?)")
    .bind(crypto.randomUUID(),record.school_lead_id,record.training_program_id,sessionHash,expires).run();
  await env.DB.prepare("UPDATE training_programs SET claimed_school_lead_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND claimed_school_lead_id IS NULL")
    .bind(record.school_lead_id,record.training_program_id).run();
  await env.DB.prepare("UPDATE school_leads SET status='claimed',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(record.school_lead_id).run();
  return json({ok:true},{
    headers:{'Set-Cookie':`__Host-cj_school_session=${encodeURIComponent(session)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=2592000`}
  });
}

export async function schoolSession(request:Request,env:FeatureEnv){
  if(!env.DB)return null;
  const token=cookie(request,'__Host-cj_school_session');
  if(!token)return null;
  const hash=await sha256Hex(token);
  return env.DB.prepare(`SELECT s.school_lead_id,s.training_program_id,sl.organization_name,sl.contact_name,sl.email,
      tp.program_name,tp.provider_type,tp.city,tp.state,tp.zip
    FROM school_sessions s
    JOIN school_leads sl ON sl.id=s.school_lead_id
    JOIN training_programs tp ON tp.id=s.training_program_id
    WHERE s.session_hash=? AND datetime(s.expires_at)>datetime('now') LIMIT 1`).bind(hash).first<Row>();
}

export async function schoolDashboard(request:Request,env:FeatureEnv){
  if(!env.DB)return json({ok:false,error:'Database not configured'},{status:503});
  const session=await schoolSession(request,env);
  if(!session)return json({ok:false,error:'Sign in required'},{status:401});
  const programId=clean(session.training_program_id,100);
  const referral=await env.DB.prepare("SELECT slug FROM school_referral_codes WHERE training_program_id=? AND status='active' ORDER BY created_at LIMIT 1").bind(programId).first<{slug:string}>();
  const stats=await env.DB.prepare(`SELECT
      COUNT(DISTINCT cr.caregiver_id) AS signups,
      COUNT(DISTINCT CASE WHEN c.work_status='actively_looking' THEN cr.caregiver_id END) AS active_profiles,
      COUNT(DISTINCT CASE WHEN cp.stage IN ('interested','interview','hired') THEN cr.caregiver_id END) AS interested,
      COUNT(DISTINCT CASE WHEN cp.stage IN ('interview','hired') OR cp.interview_at IS NOT NULL THEN cr.caregiver_id END) AS interviews,
      COUNT(DISTINCT CASE WHEN cp.stage='hired' OR cp.hired_at IS NOT NULL THEN cr.caregiver_id END) AS hires
    FROM school_referral_codes src
    LEFT JOIN caregiver_referrals cr ON cr.school_referral_code_id=src.id
    LEFT JOIN caregivers c ON c.id=cr.caregiver_id
    LEFT JOIN candidate_pipeline cp ON cp.caregiver_id=cr.caregiver_id
    WHERE src.training_program_id=?`).bind(programId).first<Row>();
  const cohortRows=await env.DB.prepare(`SELECT co.id,co.name,co.referral_code,co.expected_graduation_date,co.expected_graduates,co.status,
      COUNT(DISTINCT c.id) AS signups,
      COUNT(DISTINCT CASE WHEN cp.stage IN ('interested','interview','hired') THEN c.id END) AS interested,
      COUNT(DISTINCT CASE WHEN cp.stage IN ('interview','hired') OR cp.interview_at IS NOT NULL THEN c.id END) AS interviews,
      COUNT(DISTINCT CASE WHEN cp.stage='hired' OR cp.hired_at IS NOT NULL THEN c.id END) AS hires
    FROM training_program_cohorts co
    LEFT JOIN caregivers c ON c.source_training_cohort_id=co.id
    LEFT JOIN candidate_pipeline cp ON cp.caregiver_id=c.id
    WHERE co.training_program_id=?
    GROUP BY co.id
    ORDER BY co.created_at DESC`).bind(programId).all<Row>();
  return json({ok:true,school:{
    name:session.program_name,providerType:session.provider_type,city:session.city,state:session.state,zip:session.zip,
    contactName:session.contact_name,email:session.email,
    referralUrl:referral?.slug?'https://carejoys.com/join/'+encodeURIComponent(referral.slug):null
  },stats:{
    signups:Number(stats?.signups||0),activeProfiles:Number(stats?.active_profiles||0),interested:Number(stats?.interested||0),
    interviews:Number(stats?.interviews||0),hires:Number(stats?.hires||0)
  },cohorts:(cohortRows.results||[]).map(r=>({
    id:r.id,name:r.name,status:r.status,expectedGraduationDate:r.expected_graduation_date,expectedGraduates:r.expected_graduates,
    referralUrl:'https://carejoys.com/join/'+encodeURIComponent(String(r.referral_code||'')),
    signups:Number(r.signups||0),interested:Number(r.interested||0),interviews:Number(r.interviews||0),hires:Number(r.hires||0)
  }))});
}

export async function createSchoolCohort(request:Request,env:FeatureEnv){
  if(!env.DB)return json({ok:false,error:'Database not configured'},{status:503});
  const session=await schoolSession(request,env);
  if(!session)return json({ok:false,error:'Sign in required'},{status:401});
  const data=await request.json().catch(()=>null) as Row|null;
  const name=clean(data?.name,140);
  if(!name)return json({ok:false,error:'Cohort name is required'},{status:400});
  const expectedGraduationDate=clean(data?.expectedGraduationDate,30)||null;
  const expectedGraduates=Math.max(0,Math.min(1000,Number(data?.expectedGraduates||0)||0))||null;
  const programId=clean(session.training_program_id,100);
  const base=(name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,42)||'cohort');
  const referralCode=(base+'-'+crypto.randomUUID().slice(0,8)).slice(0,64);
  const id=crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO training_program_cohorts
    (id,training_program_id,name,referral_code,expected_graduation_date,expected_graduates,status)
    VALUES (?,?,?,?,?,?,'active')`)
    .bind(id,programId,name,referralCode,expectedGraduationDate,expectedGraduates).run();
  return json({ok:true,cohort:{
    id,name,referralCode,expectedGraduationDate,expectedGraduates,
    referralUrl:'https://carejoys.com/join/'+encodeURIComponent(referralCode)
  }},{status:201});
}

export async function schoolLogout(request:Request,env:FeatureEnv){
  if(env.DB){
    const token=cookie(request,'__Host-cj_school_session');
    if(token){
      const hash=await sha256Hex(token);
      await env.DB.prepare("DELETE FROM school_sessions WHERE session_hash=?").bind(hash).run();
    }
  }
  return json({ok:true},{headers:{'Set-Cookie':'__Host-cj_school_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0'}});
}


export async function sendSchoolOutreachBatch(env:FeatureEnv,limit=3){
  if(!env.DB||!env.EMAIL)return {attempted:0,sent:0,failed:0};
  const rows=await env.DB.prepare(`SELECT tp.id,tp.program_name,tp.email,tp.claimed_school_lead_id,src.slug
    FROM training_programs tp
    JOIN school_referral_codes src ON src.training_program_id=tp.id AND src.status='active'
    WHERE tp.is_active=1
      AND tp.source='maryland_mbon_natp'
      AND tp.email IS NOT NULL AND tp.email!=''
      AND tp.claimed_school_lead_id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM training_program_outreach o
        WHERE o.training_program_id=tp.id AND o.event_type='school_intro'
      )
    ORDER BY
      CASE WHEN tp.provider_type='Freestanding Program' THEN 0
           WHEN tp.provider_type='College' THEN 1
           WHEN tp.provider_type='High School' THEN 2
           ELSE 3 END,
      tp.updated_at DESC
    LIMIT ?`).bind(Math.max(1,Math.min(10,limit))).all<Row>();
  let sent=0,failed=0;
  for(const row of rows.results||[]){
    const email=clean(row.email,320).toLowerCase();
    if(!emailValid(email)){failed++;continue}
    const claimLink='https://carejoys.com/school/'+encodeURIComponent(clean(row.slug,120));
    const body=schoolPlacementInviteEmail({
      contactName:'there',
      programName:clean(row.program_name,200),
      claimLink
    });
    try{
      const result=await env.EMAIL.send({
        from:'CareJoys <updates@carejoys.com>',to:email,subject:body.subject,html:body.html,text:body.text
      });
      await env.DB.prepare(`INSERT INTO training_program_outreach
        (id,training_program_id,event_type,channel,recipient,provider_message_id,payload)
        VALUES (?,?,'school_intro','email',?,?,?)`)
        .bind(crypto.randomUUID(),row.id,email,result.messageId||null,JSON.stringify({claimLink})).run();
      sent++;
    }catch(error){
      await env.DB.prepare(`INSERT INTO training_program_outreach
        (id,training_program_id,event_type,channel,recipient,payload)
        VALUES (?,?,'school_intro_failed','email',?,?)`)
        .bind(crypto.randomUUID(),row.id,email,JSON.stringify({error:error instanceof Error?error.message:'send failed'})).run();
      failed++;
    }
  }
  return {attempted:(rows.results||[]).length,sent,failed};
}
