import { agencyCandidateTeaserEmail } from './email';
import { employerSession, publicFormGuard, sendEmployerMagicLink, type FeatureEnv } from './serverFeatures';

type Row=Record<string,unknown>;
const clean=(v:unknown,max=500)=>typeof v==='string'?v.trim().slice(0,max):'';
const json=(body:unknown,init:ResponseInit={})=>new Response(JSON.stringify(body),{
  ...init,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...(init.headers||{})}
});
const asNum=(v:unknown)=>{const n=Number(v||0);return Number.isFinite(n)?n:0};
async function sha256Hex(value:string){
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash)).map(b=>b.toString(16).padStart(2,'0')).join('');
}
function freshnessLabel(workStatus:unknown,lastConfirmed:unknown){
  if(clean(workStatus,40)!=='actively_looking')return 'Availability unconfirmed';
  const t=Date.parse(clean(lastConfirmed,80));
  if(!Number.isFinite(t))return 'Availability unconfirmed';
  const days=(Date.now()-t)/86400000;
  if(days<=7)return 'Confirmed this week';
  if(days<=30)return 'Confirmed this month';
  return 'Availability unconfirmed';
}
function safeDomain(domain:string){
  const d=domain.toLowerCase().trim();
  if(!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d))return '';
  if(d==='localhost'||d.endsWith('.local'))return '';
  if(/^\d{1,3}(\.\d{1,3}){3}$/.test(d))return '';
  return d;
}
async function fetchText(url:string,ms=7000){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),ms);
  try{
    const res=await fetch(url,{redirect:'follow',headers:{'user-agent':'CareJoysBot/1.0 (+https://carejoys.com)'},signal:controller.signal});
    if(!res.ok)return null;
    const type=res.headers.get('content-type')||'';
    if(!type.includes('text/html')&&!type.includes('text/plain'))return null;
    return {url:res.url,text:(await res.text()).slice(0,750000)};
  }catch{return null}finally{clearTimeout(timer)}
}
function htmlText(html:string){
  return html.replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim();
}
function inferRoles(text:string){
  const t=text.toLowerCase();
  const roles:string[]=[];
  const rules:[string,RegExp][]=[
    ['CNA',/\b(cna|certified nursing assistant)\b/i],
    ['GNA',/\b(gna|geriatric nursing assistant)\b/i],
    ['HHA',/\b(hha|home health aide)\b/i],
    ['PCA',/\b(pca|personal care aide|personal care assistant)\b/i],
    ['Caregiver',/\bcaregiver(s)?\b/i]
  ];
  for(const [role,re] of rules)if(re.test(t))roles.push(role);
  return roles;
}
function findCareerUrl(base:string,html:string){
  const matches=[...html.matchAll(/href=["']([^"']+)["']/gi)].map(m=>m[1]);
  for(const href of matches){
    if(!/(career|jobs|employment|join[-_ ]?our[-_ ]?team|work[-_ ]?with[-_ ]?us)/i.test(href))continue;
    try{
      const u=new URL(href,base);
      if(/^https?:$/.test(u.protocol))return u.toString();
    }catch{}
  }
  return '';
}
function hiringSignal(text:string,roles:string[]){
  const t=text.toLowerCase();
  if(roles.length&&/(apply now|view jobs|open positions|join our team|we are hiring|careers|employment opportunities|current openings)/i.test(t))return 'hiring_detected';
  if(/no openings|no positions available|not currently hiring/i.test(t))return 'not_hiring_detected';
  return 'unknown';
}

export async function enrichAgencyBatch(env:FeatureEnv,limit=30){
  if(!env.DB)return {processed:0,enriched:0};
  const rows=await env.DB.prepare(`SELECT id,canonical_name,primary_domain,primary_website,primary_careers_url
    FROM agency_organizations
    WHERE is_active=1 AND primary_domain IS NOT NULL AND primary_domain!=''
      AND (last_enriched_at IS NULL OR datetime(last_enriched_at)<datetime('now','-30 days'))
    ORDER BY CASE WHEN last_enriched_at IS NULL THEN 0 ELSE 1 END, updated_at ASC
    LIMIT ?`).bind(limit).all<Row>();
  let enriched=0;
  for(const row of rows.results||[]){
    const domain=safeDomain(clean(row.primary_domain,200));
    if(!domain){
      await env.DB.prepare("UPDATE agency_organizations SET last_enriched_at=CURRENT_TIMESTAMP,website_source='invalid_email_domain',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(row.id).run();
      continue;
    }
    let home=await fetchText('https://'+domain+'/');
    if(!home)home=await fetchText('http://'+domain+'/');
    if(!home){
      await env.DB.prepare("UPDATE agency_organizations SET last_enriched_at=CURRENT_TIMESTAMP,website_source='email_domain_unreachable',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(row.id).run();
      continue;
    }
    const careerUrl=findCareerUrl(home.url,home.text);
    let career=careerUrl?await fetchText(careerUrl):null;
    if(!career){
      for(const path of ['/careers','/jobs','/employment','/join-our-team']){
        career=await fetchText(new URL(path,home.url).toString());
        if(career)break;
      }
    }
    const body=htmlText((career||home).text);
    const roles=inferRoles(body);
    const signal=hiringSignal(body,roles);
    const finalCareer=career?.url||careerUrl||'';
    await env.DB.prepare(`UPDATE agency_organizations SET
      primary_website=?,primary_careers_url=?,website_source='email_domain',
      careers_source=?,inferred_roles=?,current_hiring_signal=?,hiring_signal_source=?,
      hiring_signal_checked_at=CURRENT_TIMESTAMP,last_enriched_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
      WHERE id=?`)
      .bind(home.url,finalCareer,finalCareer?'site_careers_page':'site_homepage',roles.join(', '),signal,finalCareer?'careers_page':'website',row.id).run();
    const hp=await env.DB.prepare("SELECT employer_confirmed_at FROM agency_org_hiring_profiles WHERE organization_id=?").bind(row.id).first<Row>();
    if(!hp?.employer_confirmed_at){
      await env.DB.prepare(`INSERT INTO agency_org_hiring_profiles
        (organization_id,hiring_status,roles,roles_source,hiring_status_source,updated_at)
        VALUES (?,?,?,?,?,CURRENT_TIMESTAMP)
        ON CONFLICT(organization_id) DO UPDATE SET hiring_status=excluded.hiring_status,
          roles=CASE WHEN excluded.roles!='' THEN excluded.roles ELSE agency_org_hiring_profiles.roles END,
          roles_source=CASE WHEN excluded.roles!='' THEN excluded.roles_source ELSE agency_org_hiring_profiles.roles_source END,
          hiring_status_source=excluded.hiring_status_source,updated_at=CURRENT_TIMESTAMP`)
        .bind(row.id,signal==='hiring_detected'?'hiring':signal==='not_hiring_detected'?'not_hiring':'unknown',roles.join(', '),'inferred_from_careers_page',finalCareer?'careers_page':'website').run();
    }
    enriched++;
  }
  return {processed:(rows.results||[]).length,enriched};
}

export async function scoreAgencyMatches(env:FeatureEnv){
  if(!env.DB)return {scored:0};
  await env.DB.prepare("DELETE FROM agency_org_candidate_matches").run();
  const result=await env.DB.prepare(`WITH scored AS (
      SELECT ao.id AS organization_id,c.id AS caregiver_id,
        CASE
          WHEN lower(coalesce(ao.zip,''))=lower(coalesce(c.zip,'')) AND ao.zip!='' THEN 50
          WHEN lower(coalesce(ao.city,''))=lower(coalesce(c.city,'')) AND ao.city!='' THEN 35
          WHEN lower(coalesce(ao.state,''))=lower(coalesce(c.state,'')) AND ao.state!='' THEN 15
          WHEN upper(coalesce(c.state,''))='MD' THEN 10
          ELSE 0 END AS geography_score,
        CASE
          WHEN lower(coalesce(hp.roles,'')) LIKE '%'||lower(coalesce(c.role,''))||'%' AND c.role!='' THEN 25
          WHEN lower(coalesce(hp.roles,'')) LIKE '%caregiver%' THEN 12
          ELSE 5 END AS role_score,
        CASE
          WHEN c.last_confirmed_at IS NOT NULL AND datetime(c.last_confirmed_at)>=datetime('now','-30 days') THEN 15
          WHEN c.last_confirmed_at IS NOT NULL AND datetime(c.last_confirmed_at)>=datetime('now','-90 days') THEN 8
          ELSE 0 END AS freshness_score,
        CASE WHEN ao.caregiver_relevance_score>=90 THEN 15 WHEN ao.caregiver_relevance_score>=70 THEN 10 ELSE 5 END AS provider_score
      FROM agency_organizations ao
      LEFT JOIN agency_org_hiring_profiles hp ON hp.organization_id=ao.id
      CROSS JOIN caregivers c
      WHERE ao.is_active=1 AND c.is_active=1
        AND (c.work_status='actively_looking' OR (c.source='legacy_carekoya' AND c.work_status='unknown'))
        AND upper(coalesce(c.state,''))='MD'
    ), ranked AS (
      SELECT *,geography_score+role_score+freshness_score+provider_score AS fit_score,
        ROW_NUMBER() OVER(PARTITION BY caregiver_id ORDER BY geography_score+role_score+freshness_score+provider_score DESC,organization_id) AS rn
      FROM scored WHERE geography_score>0
    )
    INSERT INTO agency_org_candidate_matches
      (id,organization_id,caregiver_id,fit_score,geography_score,role_score,freshness_score,provider_score,match_reason,status,last_scored_at)
    SELECT organization_id||':'||caregiver_id,organization_id,caregiver_id,fit_score,geography_score,role_score,freshness_score,provider_score,
      json_object('geography',geography_score,'role',role_score,'freshness',freshness_score,'provider',provider_score),
      'matched',CURRENT_TIMESTAMP
    FROM ranked WHERE rn<=75`).run();
  return {scored:asNum(result.meta?.changes)};
}

async function teaserRecord(env:FeatureEnv,token:string){
  if(!env.DB||!token)return null;
  const hash=await sha256Hex(token);
  return env.DB.prepare(`SELECT t.id AS token_id,t.organization_id,t.recipient_email,t.claim_requested_at,t.claimed_at,
    o.canonical_name,o.city,o.state,o.provider_types,o.current_hiring_signal,o.claimed_employer_id
    FROM agency_teaser_tokens t JOIN agency_organizations o ON o.id=t.organization_id
    WHERE t.token_hash=? AND datetime(t.expires_at)>datetime('now') LIMIT 1`).bind(hash).first<Row>();
}
async function candidatePreviews(env:FeatureEnv,orgId:string,limit=5){
  if(!env.DB)return [];
  const rows=await env.DB.prepare(`SELECT m.fit_score,c.role,c.city,c.state,c.years_experience,c.work_status,c.last_confirmed_at
    FROM agency_org_candidate_matches m JOIN caregivers c ON c.id=m.caregiver_id
    WHERE m.organization_id=? AND c.is_active=1
    ORDER BY m.fit_score DESC,m.last_scored_at DESC LIMIT ?`).bind(orgId,limit).all<Row>();
  return (rows.results||[]).map(r=>({
    role:clean(r.role,80)||'Caregiver',
    area:[clean(r.city,100),clean(r.state,40)].filter(Boolean).join(', ')||'Local area',
    experience:asNum(r.years_experience)>0?asNum(r.years_experience)+' years experience':'Experience on profile',
    freshness:freshnessLabel(r.work_status,r.last_confirmed_at),
    fitScore:asNum(r.fit_score)
  }));
}

export async function getAgencyTeaser(url:URL,env:FeatureEnv){
  const token=clean(url.searchParams.get('token'),300);
  const row=await teaserRecord(env,token);
  if(!row)return json({ok:false,error:'This agency link is invalid or has expired.'},{status:404});
  await env.DB!.prepare("UPDATE agency_teaser_tokens SET opened_at=COALESCE(opened_at,CURRENT_TIMESTAMP) WHERE id=?").bind(row.token_id).run();
  const previews=await candidatePreviews(env,clean(row.organization_id,100),5);
  return json({ok:true,agency:{
    name:row.canonical_name,city:row.city,state:row.state,providerTypes:row.provider_types,
    claimed:!!row.claimed_employer_id,claimRequested:!!row.claim_requested_at
  },candidateCount:previews.length,candidates:previews});
}

export async function requestAgencyClaim(request:Request,env:FeatureEnv){
  if(!env.DB||!env.EMAIL)return json({ok:false,error:'CareJoys email is not configured'},{status:503});
  const data=await request.json().catch(()=>null) as Row|null;
  const guard=await publicFormGuard(request,env,'agency_claim',data,4,30);
  if(guard)return guard;
  const token=clean(data?.token,300);
  const row=await teaserRecord(env,token);
  if(!row)return json({ok:false,error:'This agency link is invalid or has expired.'},{status:404});
  const email=clean(row.recipient_email,320).toLowerCase();
  let employer=await env.DB.prepare("SELECT id FROM employer_leads WHERE lower(email)=? AND status!='disabled' ORDER BY created_at DESC LIMIT 1").bind(email).first<{id:string}>();
  let employerId=employer?.id||'';
  if(!employerId){
    employerId=crypto.randomUUID();
    await env.DB.prepare(`INSERT INTO employer_leads(id,company_name,contact_name,email,zip,roles_needed,hiring_notes,status)
      VALUES (?,?,?,?,?,'Caregiver, CNA, HHA, PCA','Imported from Maryland licensed provider directory','active')`)
      .bind(employerId,row.canonical_name,'',email,'').run();
  }
  await env.DB.prepare("UPDATE agency_teaser_tokens SET claim_requested_at=CURRENT_TIMESTAMP,employer_id=? WHERE id=?").bind(employerId,row.token_id).run();
  await sendEmployerMagicLink(env,employerId);
  return json({ok:true,message:'Check your agency email for a secure CareJoys sign-in link.'});
}

export async function getAgencyNetwork(request:Request,env:FeatureEnv){
  if(!env.DB)return json({ok:false,error:'Database not configured'},{status:503});
  const employer=await employerSession(request,env);
  if(!employer)return json({ok:false,error:'Sign in required'},{status:401});
  const org=await env.DB.prepare(`SELECT * FROM agency_organizations WHERE claimed_employer_id=? AND is_active=1 ORDER BY license_count DESC LIMIT 1`).bind(employer.id).first<Row>();
  if(!org)return json({ok:true,agency:null,matches:[]});
  const hp=await env.DB.prepare("SELECT * FROM agency_org_hiring_profiles WHERE organization_id=?").bind(org.id).first<Row>();
  const rows=await env.DB.prepare(`SELECT m.fit_score,m.match_reason,m.status,c.id AS caregiver_id,c.first_name,c.last_name,c.display_name,c.city,c.state,c.role,c.certifications,c.years_experience,c.desired_wage,c.shift_preferences,c.work_status,c.last_confirmed_at
    FROM agency_org_candidate_matches m JOIN caregivers c ON c.id=m.caregiver_id
    WHERE m.organization_id=? AND c.is_active=1
    ORDER BY m.fit_score DESC LIMIT 50`).bind(org.id).all<Row>();
  const matches=(rows.results||[]).map(r=>({
    caregiverId:r.caregiver_id,
    name:clean(r.first_name,80)?clean(r.first_name,80)+' '+(clean(r.last_name,80)?clean(r.last_name,80).charAt(0).toUpperCase()+'.':''):clean(r.display_name,120)||'Caregiver',
    city:r.city,state:r.state,role:r.role,certifications:r.certifications,yearsExperience:r.years_experience,
    desiredWage:r.desired_wage,shifts:r.shift_preferences,fitScore:r.fit_score,matchReason:r.match_reason,
    freshness:freshnessLabel(r.work_status,r.last_confirmed_at)
  }));
  return json({ok:true,agency:{
    id:org.id,name:org.canonical_name,city:org.city,state:org.state,zip:org.zip,
    website:org.primary_website,careersUrl:org.primary_careers_url,providerTypes:org.provider_types,
    currentHiringSignal:org.current_hiring_signal,hiringSignalSource:org.hiring_signal_source,
    inferredRoles:org.inferred_roles
  },hiringProfile:hp||null,matches});
}

export async function updateAgencyHiringProfile(request:Request,env:FeatureEnv){
  if(!env.DB)return json({ok:false,error:'Database not configured'},{status:503});
  const employer=await employerSession(request,env);
  if(!employer)return json({ok:false,error:'Sign in required'},{status:401});
  const org=await env.DB.prepare("SELECT id FROM agency_organizations WHERE claimed_employer_id=? AND is_active=1 LIMIT 1").bind(employer.id).first<{id:string}>();
  if(!org)return json({ok:false,error:'No claimed agency is linked to this workspace.'},{status:404});
  const data=await request.json().catch(()=>null) as Row|null;
  const status=clean(data?.hiringStatus,40);
  if(!['hiring','always_hiring','not_hiring','unknown'].includes(status))return json({ok:false,error:'Choose a valid hiring status.'},{status:400});
  const roles=Array.isArray(data?.roles)?(data!.roles as unknown[]).map(x=>clean(x,40)).filter(Boolean).slice(0,12).join(', '):clean(data?.roles,400);
  await env.DB.prepare(`INSERT INTO agency_org_hiring_profiles
    (organization_id,hiring_status,roles,shifts,pay_min,pay_max,service_radius_miles,service_areas,transportation_required,requirements,roles_source,geography_source,hiring_status_source,employer_confirmed_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?, 'employer_confirmed','employer_confirmed','employer_confirmed',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
    ON CONFLICT(organization_id) DO UPDATE SET
      hiring_status=excluded.hiring_status,roles=excluded.roles,shifts=excluded.shifts,pay_min=excluded.pay_min,pay_max=excluded.pay_max,
      service_radius_miles=excluded.service_radius_miles,service_areas=excluded.service_areas,transportation_required=excluded.transportation_required,
      requirements=excluded.requirements,roles_source='employer_confirmed',geography_source='employer_confirmed',
      hiring_status_source='employer_confirmed',employer_confirmed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP`)
    .bind(org.id,status,roles,clean(data?.shifts,400),asNum(data?.payMin)||null,asNum(data?.payMax)||null,asNum(data?.serviceRadiusMiles)||null,
      clean(data?.serviceAreas,500),data?.transportationRequired===true?1:0,clean(data?.requirements,1500)).run();
  await env.DB.prepare("UPDATE agency_organizations SET current_hiring_signal=?,hiring_signal_source='employer_confirmed',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(status,org.id).run();
  await scoreAgencyMatches(env);

  const orgRow=await env.DB.prepare("SELECT canonical_name,city,state,zip FROM agency_organizations WHERE id=?").bind(org.id).first<Row>();
  let opening=await env.DB.prepare("SELECT id FROM openings WHERE employer_id=? AND agency_organization_id=? AND source='agency_profile' ORDER BY created_at DESC LIMIT 1").bind(employer.id,org.id).first<{id:string}>();
  const roleList=roles.split(',').map(x=>x.trim()).filter(Boolean);
  const openingRole=roleList[0]||'Caregiver';
  const openingTitle=(roleList.length?roleList.join(' / '):'Caregiver')+' hiring';
  if(!opening){
    const openingId=crypto.randomUUID();
    await env.DB.prepare(`INSERT INTO openings
      (id,employer_id,title,role,city,state,zip,pay_min,pay_max,shift_preferences,transportation_required,requirements,status,source,agency_organization_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'agency_profile',?)`)
      .bind(openingId,employer.id,openingTitle,openingRole,orgRow?.city||'',orgRow?.state||'',orgRow?.zip||'',asNum(data?.payMin)||null,asNum(data?.payMax)||null,
        clean(data?.shifts,400),data?.transportationRequired===true?1:0,clean(data?.requirements,1500),status==='not_hiring'?'paused':'open',org.id).run();
    opening={id:openingId};
  }else{
    await env.DB.prepare(`UPDATE openings SET title=?,role=?,city=?,state=?,zip=?,pay_min=?,pay_max=?,shift_preferences=?,transportation_required=?,requirements=?,
      status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .bind(openingTitle,openingRole,orgRow?.city||'',orgRow?.state||'',orgRow?.zip||'',asNum(data?.payMin)||null,asNum(data?.payMax)||null,
        clean(data?.shifts,400),data?.transportationRequired===true?1:0,clean(data?.requirements,1500),status==='not_hiring'?'paused':'open',opening.id).run();
  }

  if(status!=='not_hiring'){
    const matches=await env.DB.prepare("SELECT caregiver_id,fit_score,match_reason FROM agency_org_candidate_matches WHERE organization_id=? ORDER BY fit_score DESC LIMIT 50").bind(org.id).all<Row>();
    for(const match of matches.results||[]){
      await env.DB.prepare(`INSERT INTO candidate_pipeline(id,opening_id,caregiver_id,stage,match_reason,match_score,source)
        VALUES (?,?,?,'matched',?,?,'agency_profile_match')
        ON CONFLICT(opening_id,caregiver_id) DO UPDATE SET
          match_reason=excluded.match_reason,match_score=excluded.match_score,
          updated_at=CURRENT_TIMESTAMP`)
        .bind(crypto.randomUUID(),opening.id,match.caregiver_id,match.match_reason,match.fit_score).run();
    }
  }
  return json({ok:true,openingId:opening.id});
}

export async function sendAgencyTeaserBatch(env:FeatureEnv,limit=5){
  if(!env.DB||!env.EMAIL)return {attempted:0,sent:0,failed:0};
  const orgs=await env.DB.prepare(`SELECT o.id,o.canonical_name,o.primary_email,o.primary_contact_name,
      COUNT(m.id) AS candidate_count,MAX(m.fit_score) AS top_score
    FROM agency_organizations o
    JOIN agency_org_candidate_matches m ON m.organization_id=o.id
    WHERE o.is_active=1 AND o.claimed_employer_id IS NULL
      AND o.primary_email IS NOT NULL AND o.primary_email!=''
      AND (o.teaser_last_sent_at IS NULL OR datetime(o.teaser_last_sent_at)<datetime('now','-30 days'))
      AND NOT EXISTS (SELECT 1 FROM agency_teaser_tokens t WHERE t.organization_id=o.id AND datetime(t.expires_at)>datetime('now'))
    GROUP BY o.id
    HAVING COUNT(m.id)>=1
    ORDER BY MAX(m.fit_score) DESC,COUNT(m.id) DESC
    LIMIT ?`).bind(limit).all<Row>();
  let sent=0,failed=0;
  for(const org of orgs.results||[]){
    const token=crypto.randomUUID()+'-'+crypto.randomUUID();
    const hash=await sha256Hex(token);
    const expires=new Date(Date.now()+14*86400000).toISOString();
    const tokenId=crypto.randomUUID();
    const email=clean(org.primary_email,320).toLowerCase();
    const previews=await candidatePreviews(env,clean(org.id,100),3);
    const body=agencyCandidateTeaserEmail({
      contactName:clean(org.primary_contact_name,120).split(/\s+/)[0]||'there',
      agencyName:clean(org.canonical_name,180),
      candidateCount:asNum(org.candidate_count),
      previews,
      claimLink:'https://carejoys.com/agency?token='+encodeURIComponent(token)
    });
    try{
      const result=await env.EMAIL.send({from:'CareJoys <updates@carejoys.com>',to:email,subject:body.subject,html:body.html,text:body.text});
      await env.DB.prepare("INSERT INTO agency_teaser_tokens(id,organization_id,token_hash,recipient_email,expires_at,sent_at) VALUES (?,?,?,?,?,CURRENT_TIMESTAMP)")
        .bind(tokenId,org.id,hash,email,expires).run();
      await env.DB.prepare("UPDATE agency_organizations SET teaser_last_sent_at=CURRENT_TIMESTAMP,teaser_send_count=teaser_send_count+1,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(org.id).run();
      await env.DB.prepare("INSERT INTO agency_outreach_events(id,organization_id,event_type,recipient_email,provider_message_id,payload) VALUES (?,?,'candidate_teaser',?,?,?)")
        .bind(crypto.randomUUID(),org.id,email,result.messageId||null,JSON.stringify({candidateCount:asNum(org.candidate_count),topScore:asNum(org.top_score)})).run();
      sent++;
    }catch(error){
      failed++;
      await env.DB.prepare("INSERT INTO agency_outreach_events(id,organization_id,event_type,recipient_email,payload) VALUES (?,?,'candidate_teaser_failed',?,?)")
        .bind(crypto.randomUUID(),org.id,email,JSON.stringify({error:error instanceof Error?error.message:'send failed'})).run();
    }
  }
  return {attempted:(orgs.results||[]).length,sent,failed};
}
