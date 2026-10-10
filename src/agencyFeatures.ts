import { agencyCandidateTeaserEmail, agencyHiringNeedsEmail, withUnsubscribe } from './email';
import { unsubscribeLink } from './emailPreferences';
import { employerSession, employerSessionCookie, publicFormGuard, startEmployerSession, type FeatureEnv } from './serverFeatures';
import { waitingInterestPreviews } from './agencyInbox';
import { DEFAULT_COMMUTE_MILES } from './geo';

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
/** A contact address on the agency's own domain; third-party addresses (widgets, builders) are ignored. */
export function siteEmail(html:string,domain:string){
  for(const m of html.matchAll(/(?:mailto:)?([a-z0-9._%+-]+@([a-z0-9-]+(?:\.[a-z0-9-]+)+))/gi)){
    const email=m[1].toLowerCase(),host=m[2].toLowerCase();
    if(host===domain||host.endsWith('.'+domain))return email;
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
  const rows=await env.DB.prepare(`SELECT id,canonical_name,primary_domain,primary_website,primary_careers_url,primary_email
    FROM agency_organizations
    WHERE is_active=1 AND COALESCE(is_test,0)=0 AND primary_domain IS NOT NULL AND primary_domain!=''
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
    // Agencies found through NPI or Google listings have no email yet; take one from their own site.
    const email=clean(row.primary_email,320)?'':siteEmail(home.text,domain)||(career?siteEmail(career.text,domain):'');
    await env.DB.prepare(`UPDATE agency_organizations SET
      primary_email=CASE WHEN coalesce(primary_email,'')='' AND ?!='' THEN ? ELSE primary_email END,
      primary_website=?,primary_careers_url=?,website_source=CASE WHEN website_source='google_business' THEN website_source ELSE 'email_domain' END,
      careers_source=?,inferred_roles=?,current_hiring_signal=?,hiring_signal_source=?,
      hiring_signal_checked_at=CURRENT_TIMESTAMP,last_enriched_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
      WHERE id=?`)
      .bind(email,email,home.url,finalCareer,finalCareer?'site_careers_page':'site_homepage',roles.join(', '),signal,finalCareer?'careers_page':'website',row.id).run();
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

// Agency matches use real distance: the caregiver must live within reach of the agency's ZIP, where reach is the
// larger of their own commute radius and the agency's service radius (home-care aides travel to clients' homes).
// Miles use a flat-earth approximation with cos(39°)≈0.78 for longitude, close enough across the mid-Atlantic and
// cheap in SQL. With no coordinates, only the same ZIP or the same city counts; the rest of the state never does.
// A caregiver must also hold a role the agency hires for (or any direct-care role when it hasn't said).
const AGENCY_DIST2=`((zo.lat-zc.lat)*69.0)*((zo.lat-zc.lat)*69.0)+((zo.lng-zc.lng)*53.8)*((zo.lng-zc.lng)*53.8)`;
const AGENCY_REACH=`MAX(MAX(5,MIN(100,CASE WHEN COALESCE(c.travel_distance_miles,0)>0 THEN c.travel_distance_miles ELSE ${DEFAULT_COMMUTE_MILES} END)),COALESCE(hp.service_radius_miles,0))`;
const AGENCY_SCORES=`
        CASE
          WHEN zo.lat IS NOT NULL AND zc.lat IS NOT NULL THEN
            CASE WHEN ${AGENCY_DIST2}<=25 THEN 50 WHEN ${AGENCY_DIST2}<=100 THEN 42 WHEN ${AGENCY_DIST2}<=400 THEN 32
              WHEN ${AGENCY_DIST2}<=${AGENCY_REACH}*${AGENCY_REACH} THEN 20 ELSE 0 END
          WHEN coalesce(ao.zip,'')!='' AND substr(ao.zip,1,5)=substr(coalesce(c.zip,''),1,5) THEN 50
          WHEN coalesce(ao.city,'')!='' AND lower(ao.city)=lower(coalesce(c.city,'')) AND upper(coalesce(ao.state,''))=upper(coalesce(c.state,'')) THEN 35
          ELSE 0 END AS geography_score,
        CASE
          WHEN trim(coalesce(hp.roles,''))='' THEN CASE WHEN trim(coalesce(c.role,'')||coalesce(c.certifications,''))!='' THEN 15 ELSE 0 END
          WHEN c.role!='' AND lower(hp.roles) LIKE '%'||lower(c.role)||'%' THEN 25
          WHEN lower(hp.roles) LIKE '%caregiver%' THEN 12
          ELSE 0 END AS role_score,
        CASE
          WHEN c.last_confirmed_at IS NOT NULL AND datetime(c.last_confirmed_at)>=datetime('now','-30 days') THEN 15
          WHEN c.last_confirmed_at IS NOT NULL AND datetime(c.last_confirmed_at)>=datetime('now','-90 days') THEN 8
          ELSE 0 END AS freshness_score,
        CASE WHEN ao.caregiver_relevance_score>=90 THEN 15 WHEN ao.caregiver_relevance_score>=70 THEN 10 ELSE 5 END AS provider_score`;
const AGENCY_GEO_JOINS=`LEFT JOIN zip_geo zo ON zo.zip=substr(trim(COALESCE(ao.zip,'')),1,5) LEFT JOIN zip_geo zc ON zc.zip=substr(trim(COALESCE(c.zip,'')),1,5)`;

export async function scoreCaregiverAgainstAgencies(env:FeatureEnv,caregiverId:string){
  if(!env.DB)return {scored:0};
  const caregiver=await env.DB.prepare("SELECT id,state FROM caregivers WHERE id=? AND is_active=1 AND work_status='actively_looking' AND (auth0_email_verified=1 OR (source='legacy_carekoya' AND activation_completed_at IS NOT NULL)) LIMIT 1").bind(caregiverId).first<Row>();
  if(!caregiver||!/^[A-Z]{2}$/.test(clean(caregiver.state,20).toUpperCase()))return {scored:0};
  await env.DB.prepare("DELETE FROM agency_org_candidate_matches WHERE caregiver_id=? AND status='matched' AND caregiver_interest IS NULL AND agency_interest IS NULL").bind(caregiverId).run();
  const result=await env.DB.prepare(`WITH scored AS (
      SELECT ao.id AS organization_id,c.id AS caregiver_id,${AGENCY_SCORES}
      FROM caregivers c
      CROSS JOIN agency_organizations ao
      LEFT JOIN agency_org_hiring_profiles hp ON hp.organization_id=ao.id
      ${AGENCY_GEO_JOINS}
      WHERE c.id=? AND c.is_active=1 AND c.work_status='actively_looking' AND (c.auth0_email_verified=1 OR (c.source='legacy_carekoya' AND c.activation_completed_at IS NOT NULL)) AND ao.is_active=1 AND COALESCE(ao.is_chain,0)=0 AND upper(coalesce(ao.state,''))=upper(c.state)
    ), ranked AS (
      SELECT *,geography_score+role_score+freshness_score+provider_score AS fit_score,
        ROW_NUMBER() OVER(ORDER BY geography_score+role_score+freshness_score+provider_score DESC,organization_id) AS rn
      FROM scored WHERE geography_score>0 AND role_score>0
    )
    INSERT INTO agency_org_candidate_matches
      (id,organization_id,caregiver_id,fit_score,geography_score,role_score,freshness_score,provider_score,match_reason,status,last_scored_at)
    SELECT organization_id||':'||caregiver_id,organization_id,caregiver_id,fit_score,geography_score,role_score,freshness_score,provider_score,
      json_object('geography',geography_score,'role',role_score,'freshness',freshness_score,'provider',provider_score),
      'matched',CURRENT_TIMESTAMP
    FROM ranked WHERE rn<=75
    ON CONFLICT(organization_id,caregiver_id) DO UPDATE SET
      fit_score=excluded.fit_score,geography_score=excluded.geography_score,role_score=excluded.role_score,
      freshness_score=excluded.freshness_score,provider_score=excluded.provider_score,match_reason=excluded.match_reason,
      last_scored_at=excluded.last_scored_at,updated_at=CURRENT_TIMESTAMP`).bind(caregiverId).run();
  const row=await env.DB.prepare("SELECT COUNT(*) AS count FROM agency_org_candidate_matches WHERE caregiver_id=?").bind(caregiverId).first<{count:number}>();
  return {scored:asNum(row?.count)};
}

export async function scoreAgencyMatches(env:FeatureEnv){
  if(!env.DB)return {scored:0};
  // Rescore in place: only plain 'matched' rows are cleared, so any row someone acted on keeps its state.
  await env.DB.prepare("DELETE FROM agency_org_candidate_matches WHERE status='matched' AND caregiver_interest IS NULL AND agency_interest IS NULL").run();
  const result=await env.DB.prepare(`WITH scored AS (
      SELECT ao.id AS organization_id,c.id AS caregiver_id,${AGENCY_SCORES}
      FROM agency_organizations ao
      LEFT JOIN agency_org_hiring_profiles hp ON hp.organization_id=ao.id
      CROSS JOIN caregivers c
      ${AGENCY_GEO_JOINS}
      WHERE ao.is_active=1 AND COALESCE(ao.is_chain,0)=0 AND c.is_active=1
        AND c.work_status='actively_looking' AND (c.auth0_email_verified=1 OR (c.source='legacy_carekoya' AND c.activation_completed_at IS NOT NULL))
        -- Agencies only match caregivers in their own state; a caregiver with no state but a Maryland ZIP counts as Maryland.
        AND upper(coalesce(ao.state,''))=upper(CASE WHEN coalesce(c.state,'')!='' THEN c.state
          WHEN CAST(substr(coalesce(c.zip,''),1,3) AS INTEGER) BETWEEN 206 AND 219 THEN 'MD' ELSE '' END)
        AND coalesce(ao.state,'')!=''
    ), ranked AS (
      SELECT *,geography_score+role_score+freshness_score+provider_score AS fit_score,
        ROW_NUMBER() OVER(PARTITION BY caregiver_id ORDER BY geography_score+role_score+freshness_score+provider_score DESC,organization_id) AS rn
      FROM scored WHERE geography_score>0 AND role_score>0
    )
    INSERT INTO agency_org_candidate_matches
      (id,organization_id,caregiver_id,fit_score,geography_score,role_score,freshness_score,provider_score,match_reason,status,last_scored_at)
    SELECT organization_id||':'||caregiver_id,organization_id,caregiver_id,fit_score,geography_score,role_score,freshness_score,provider_score,
      json_object('geography',geography_score,'role',role_score,'freshness',freshness_score,'provider',provider_score),
      'matched',CURRENT_TIMESTAMP
    FROM ranked WHERE rn<=75
    ON CONFLICT(organization_id,caregiver_id) DO UPDATE SET
      fit_score=excluded.fit_score,geography_score=excluded.geography_score,role_score=excluded.role_score,
      freshness_score=excluded.freshness_score,provider_score=excluded.provider_score,match_reason=excluded.match_reason,
      last_scored_at=excluded.last_scored_at,updated_at=CURRENT_TIMESTAMP`).run();
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
    WHERE m.organization_id=? AND c.is_active=1 AND c.work_status='actively_looking' AND (c.auth0_email_verified=1 OR (c.source='legacy_carekoya' AND c.activation_completed_at IS NOT NULL))
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
  const interests=await waitingInterestPreviews(env,clean(row.organization_id,100));
  // The agency's own openings we already list, so the page is never empty even before any caregiver matches.
  const jobRows=await env.DB!.prepare("SELECT title,city,state FROM caregiver_jobs WHERE agency_organization_id=? AND status='current' AND (is_published=1 OR publication_reason=?) ORDER BY last_seen_at DESC LIMIT 50").bind(row.organization_id,TEST_JOB_REASON).all<Row>();
  const jobs=(jobRows.results||[]).map(j=>({title:clean(j.title,160),area:[clean(j.city,100),clean(j.state,40)].filter(Boolean).join(', ')}));
  return json({ok:true,agency:{
    name:row.canonical_name,city:row.city,state:row.state,providerTypes:row.provider_types,
    claimed:!!row.claimed_employer_id,claimRequested:!!row.claim_requested_at
  },candidateCount:previews.length,candidates:previews,interests,jobCount:jobs.length,jobs:jobs.slice(0,5)});
}

/**
 * The agency clicked the link we emailed to its own address, which proves that inbox, so one click on the page signs
 * it in: no second email. The click is a POST from the page, never the GET, so link scanners can't claim an agency.
 * A link claims once; after that the page asks the agency to sign in like anyone else.
 */
export async function requestAgencyClaim(request:Request,env:FeatureEnv,accountCookie?:(employerId:string)=>Promise<string|null>){
  if(!env.DB)return json({ok:false,error:'Database not configured'},{status:503});
  const data=await request.json().catch(()=>null) as Row|null;
  const guard=await publicFormGuard(request,env,'agency_claim',data,4,30);
  if(guard)return guard;
  const token=clean(data?.token,300);
  const row=await teaserRecord(env,token);
  if(!row)return json({ok:false,error:'This agency link is invalid or has expired.'},{status:404});
  if(row.claimed_employer_id||row.claimed_at)return json({ok:false,error:'This agency is already linked to a CareJoys workspace. Sign in to continue.'},{status:409});
  const email=clean(row.recipient_email,320).toLowerCase();
  const org=await env.DB.prepare('SELECT zip,primary_contact_name,provider_kind FROM agency_organizations WHERE id=?').bind(row.organization_id).first<Row>();
  let employer=await env.DB.prepare("SELECT id FROM employer_leads WHERE lower(email)=? AND status!='disabled' ORDER BY created_at DESC LIMIT 1").bind(email).first<{id:string}>();
  let employerId=employer?.id||'';
  if(!employerId){
    employerId=crypto.randomUUID();
    await env.DB.prepare(`INSERT INTO employer_leads(id,company_name,contact_name,email,zip,roles_needed,hiring_notes,status,employer_type)
      VALUES (?,?,?,?,?,'Caregiver, CNA, HHA, PCA','Imported from licensed provider directory','active',?)`)
      .bind(employerId,row.canonical_name,clean(org?.primary_contact_name,120),email,clean(org?.zip,10).slice(0,5),clean(org?.provider_kind,40)==='facility'?'assisted_living':'home_care').run();
  }
  await env.DB.prepare("UPDATE agency_teaser_tokens SET claim_requested_at=CURRENT_TIMESTAMP,employer_id=? WHERE id=?").bind(employerId,row.token_id).run();
  // Starting the session finishes the claim (see startEmployerSession).
  const session=await startEmployerSession(env,employerId,email);
  const waiting=await env.DB.prepare("SELECT 1 AS hit FROM agency_interests WHERE organization_id=? LIMIT 1").bind(row.organization_id).first();
  const headers=new Headers({'content-type':'application/json; charset=utf-8','cache-control':'no-store','Set-Cookie':employerSessionCookie(session)});
  const account=accountCookie?await accountCookie(employerId):null;
  if(account)headers.append('Set-Cookie',account);
  // Caregivers already waiting open Candidates; otherwise the jobs and widget, which work before any caregiver matches.
  return new Response(JSON.stringify({ok:true,redirect:waiting?'/app?tab=candidates':'/app?tab=jobs'}),{status:200,headers});
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
    WHERE m.organization_id=? AND c.is_active=1 AND c.work_status='actively_looking' AND (c.auth0_email_verified=1 OR (c.source='legacy_carekoya' AND c.activation_completed_at IS NOT NULL))
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

/** Saves an agency's always-on hiring needs into its Always-on opening, then `rematch` scores that opening like any other. */
export async function updateAgencyHiringProfile(request:Request,env:FeatureEnv,rematch?:(employerId:string,openingId:string)=>Promise<unknown>){
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
      (id,employer_id,title,role,city,state,zip,pay_min,pay_max,shift_preferences,transportation_required,requirements,status,source,agency_organization_id,service_radius_miles)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'agency_profile',?,?)`)
      .bind(openingId,employer.id,openingTitle,openingRole,orgRow?.city||'',orgRow?.state||'',orgRow?.zip||'',asNum(data?.payMin)||null,asNum(data?.payMax)||null,
        clean(data?.shifts,400),data?.transportationRequired===true?1:0,clean(data?.requirements,1500),status==='not_hiring'?'paused':'open',org.id,Math.min(50,asNum(data?.serviceRadiusMiles))||null).run();
    opening={id:openingId};
  }else{
    await env.DB.prepare(`UPDATE openings SET title=?,role=?,city=?,state=?,zip=?,pay_min=?,pay_max=?,shift_preferences=?,transportation_required=?,requirements=?,
      status=?,service_radius_miles=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .bind(openingTitle,openingRole,orgRow?.city||'',orgRow?.state||'',orgRow?.zip||'',asNum(data?.payMin)||null,asNum(data?.payMax)||null,
        clean(data?.shifts,400),data?.transportationRequired===true?1:0,clean(data?.requirements,1500),status==='not_hiring'?'paused':'open',Math.min(50,asNum(data?.serviceRadiusMiles))||null,opening.id).run();
  }

  // The opening goes through the same matcher as every other opening: commute distance, role and schedule.
  if(status!=='not_hiring'&&rematch)await rematch(clean(employer.id,100),opening.id);
  return json({ok:true,openingId:opening.id});
}

/** Home care agencies due a teaser: unclaimed, emailable, not suppressed, not teased in 30 days, with real matches. */
const TEASER_ELIGIBLE_SQL=`SELECT o.id,o.canonical_name,o.primary_email,o.primary_contact_name,
      COUNT(m.id) AS candidate_count,MAX(m.fit_score) AS top_score
    FROM agency_organizations o
    JOIN agency_org_candidate_matches m ON m.organization_id=o.id
    JOIN caregivers c ON c.id=m.caregiver_id AND c.is_active=1 AND c.work_status='actively_looking'
      AND (c.auth0_email_verified=1 OR (c.source='legacy_carekoya' AND c.activation_completed_at IS NOT NULL))
    WHERE o.is_active=1 AND COALESCE(o.is_test,0)=0 AND o.claimed_employer_id IS NULL
      -- Senior living and nursing facilities feed job search only; agency outreach is for home care agencies.
      AND COALESCE(o.provider_kind,'home_care')='home_care' AND COALESCE(o.is_chain,0)=0
      AND o.primary_email IS NOT NULL AND o.primary_email!=''
      AND NOT EXISTS (SELECT 1 FROM email_suppressions es WHERE es.email=lower(trim(o.primary_email)))
      AND (o.teaser_last_sent_at IS NULL OR datetime(o.teaser_last_sent_at)<datetime('now','-30 days'))
      AND NOT EXISTS (SELECT 1 FROM agency_teaser_tokens t WHERE t.organization_id=o.id AND datetime(t.expires_at)>datetime('now'))
    GROUP BY o.id
    HAVING SUM(CASE WHEN c.work_status='actively_looking' THEN 1 ELSE 0 END)>=1 OR COUNT(m.id)>=2
    ORDER BY MAX(m.fit_score) DESC,COUNT(m.id) DESC
    LIMIT ?`;

/** The teaser the next eligible agency would get, with an inert claim link, for admin test sends. */
export async function agencyTeaserTestEmail(env:FeatureEnv){
  const org=env.DB?await env.DB.prepare(TEASER_ELIGIBLE_SQL).bind(1).first<Row>():null;
  const previews=org?await candidatePreviews(env,clean(org.id,100),3):[
    {role:'Certified Nursing Assistant',area:'Baltimore, MD',experience:'4 years experience',freshness:'Confirmed 2d ago'},
    {role:'Home Health Aide',area:'Towson, MD',experience:'Experience on profile',freshness:'Confirmed 5d ago'}
  ];
  return agencyCandidateTeaserEmail({
    contactName:clean(org?.primary_contact_name,120).split(/\s+/)[0]||'there',
    agencyName:clean(org?.canonical_name,180)||'Sample Home Care Agency',
    candidateCount:org?asNum(org.candidate_count):previews.length,
    previews,
    claimLink:'https://carejoys.com/agency'
  });
}

/** Emails one agency its teaser with a live 14-day claim link. Test sends are marked and don't count toward caps or stats. */
async function deliverTeaser(env:FeatureEnv,org:Row,test=false){
  const token=crypto.randomUUID()+'-'+crypto.randomUUID();
  const hash=await sha256Hex(token);
  const expires=new Date(Date.now()+14*86400000).toISOString();
  const email=clean(org.primary_email,320).toLowerCase();
  const previews=await candidatePreviews(env,clean(org.id,100),3);
  const unsubscribe=await unsubscribeLink(env.DB!,email,'agency_teaser');
  const body=withUnsubscribe(agencyCandidateTeaserEmail({
    contactName:clean(org.primary_contact_name,120).split(/\s+/)[0]||'there',
    agencyName:clean(org.canonical_name,180),
    candidateCount:asNum(org.candidate_count),
    previews,
    claimLink:'https://carejoys.com/agency?token='+encodeURIComponent(token)
  }),unsubscribe.link);
  try{
    const result=await env.EMAIL!.send({from:'CareJoys <hello@carejoys.com>',to:email,subject:(test?'[Test] ':'')+body.subject,html:body.html,text:body.text,headers:unsubscribe.headers});
    await env.DB!.prepare("INSERT INTO agency_teaser_tokens(id,organization_id,token_hash,recipient_email,expires_at,sent_at) VALUES (?,?,?,?,?,CURRENT_TIMESTAMP)")
      .bind(crypto.randomUUID(),org.id,hash,email,expires).run();
    await env.DB!.prepare("UPDATE agency_organizations SET teaser_last_sent_at=CURRENT_TIMESTAMP,teaser_send_count=teaser_send_count+1,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(org.id).run();
    await env.DB!.prepare("INSERT INTO agency_outreach_events(id,organization_id,event_type,recipient_email,provider_message_id,payload) VALUES (?,?,?,?,?,?)")
      .bind(crypto.randomUUID(),org.id,test?'candidate_teaser_test':'candidate_teaser',email,result.messageId||null,JSON.stringify({candidateCount:asNum(org.candidate_count),topScore:asNum(org.top_score)})).run();
    return true;
  }catch(error){
    await env.DB!.prepare("INSERT INTO agency_outreach_events(id,organization_id,event_type,recipient_email,payload) VALUES (?,?,'candidate_teaser_failed',?,?)")
      .bind(crypto.randomUUID(),org.id,email,JSON.stringify({error:error instanceof Error?error.message:'send failed'})).run();
    if(test)throw error;
    return false;
  }
}

export async function sendAgencyTeaserBatch(env:FeatureEnv,limit=5){
  if(!env.DB||!env.EMAIL)return {attempted:0,sent:0,failed:0};
  const orgs=await env.DB.prepare(TEASER_ELIGIBLE_SQL).bind(limit).all<Row>();
  let sent=0,failed=0;
  for(const org of orgs.results||[])(await deliverTeaser(env,org))?sent++:failed++;
  return {attempted:(orgs.results||[]).length,sent,failed};
}

/** Unclaimed agencies with openings live on CareJoys and an email, never sent the hiring-needs invite. */
const HIRING_INVITE_ELIGIBLE_SQL=`SELECT o.id,o.canonical_name,o.primary_email,o.primary_contact_name,o.city,COUNT(j.id) AS job_count
    FROM agency_organizations o
    JOIN caregiver_jobs j ON j.agency_organization_id=o.id AND j.is_published=1 AND j.status='current'
    WHERE o.is_active=1 AND COALESCE(o.is_test,0)=0 AND o.claimed_employer_id IS NULL
      -- Senior living and nursing facilities feed job search only; agency outreach is for home care agencies.
      AND COALESCE(o.provider_kind,'home_care')='home_care' AND COALESCE(o.is_chain,0)=0
      AND o.primary_email IS NOT NULL AND o.primary_email!=''
      AND NOT EXISTS (SELECT 1 FROM email_suppressions es WHERE es.email=lower(trim(o.primary_email)))
      AND NOT EXISTS (SELECT 1 FROM agency_outreach_events e WHERE (e.organization_id=o.id OR lower(trim(e.recipient_email))=lower(trim(o.primary_email))) AND e.event_type IN ('hiring_needs_invite','hiring_needs_invite_failed','candidate_teaser'))
    GROUP BY o.id
    ORDER BY COUNT(j.id) DESC
    LIMIT ?`;

/** "Village Caregiving, LLC" reads as "Village Caregiving" in an email. */
export function friendlyAgencyName(name:string){
  return name.replace(/[,\s]+(llc|l\.l\.c\.|inc\.?|incorporated|corp\.?|co\.|ltd\.?|pllc|pc)$/i,'').trim()||name;
}

function hiringInviteFor(org:Row,link:string){
  return agencyHiringNeedsEmail({
    contactName:clean(org.primary_contact_name,120).split(/\s+/)[0]||'',
    agencyName:friendlyAgencyName(clean(org.canonical_name,180)),
    jobCount:asNum(org.job_count),city:clean(org.city,100),link
  });
}

/** Sends the hiring-needs invite to up to `limit` agencies, each with a 14-day claim link that lands on hiring preferences. */
export async function sendAgencyHiringInvites(env:FeatureEnv,limit:number,copyTo=''){
  if(!env.DB||!env.EMAIL||limit<=0)return {attempted:0,sent:0,failed:0};
  const orgs=await env.DB.prepare(HIRING_INVITE_ELIGIBLE_SQL).bind(limit).all<Row>();
  let sent=0,failed=0;
  for(const org of orgs.results||[]){
    const token=crypto.randomUUID()+'-'+crypto.randomUUID();
    const email=clean(org.primary_email,320).toLowerCase();
    const unsubscribe=await unsubscribeLink(env.DB,email,'agency_hiring_invite');
    const body=withUnsubscribe(hiringInviteFor(org,'https://carejoys.com/agency?token='+encodeURIComponent(token)),unsubscribe.link);
    try{
      const result=await env.EMAIL.send({from:'CareJoys <hello@carejoys.com>',to:email,subject:body.subject,html:body.html,text:body.text,headers:unsubscribe.headers});
      await env.DB.prepare("INSERT INTO agency_teaser_tokens(id,organization_id,token_hash,recipient_email,expires_at,sent_at) VALUES (?,?,?,?,?,CURRENT_TIMESTAMP)")
        .bind(crypto.randomUUID(),org.id,await sha256Hex(token),email,new Date(Date.now()+14*86400000).toISOString()).run();
      await env.DB.prepare("UPDATE agency_organizations SET teaser_last_sent_at=CURRENT_TIMESTAMP,teaser_send_count=teaser_send_count+1,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(org.id).run();
      await env.DB.prepare("INSERT INTO agency_outreach_events(id,organization_id,event_type,recipient_email,provider_message_id,payload) VALUES (?,?,'hiring_needs_invite',?,?,?)")
        .bind(crypto.randomUUID(),org.id,email,result.messageId||null,JSON.stringify({jobCount:asNum(org.job_count)})).run();
      // The campaign's first send also goes to CareJoys, with an inert link, so Rebecca sees exactly what agencies get.
      if(copyTo){
        const copy=hiringInviteFor(org,'https://carejoys.com/agency');
        await env.EMAIL.send({from:'CareJoys <hello@carejoys.com>',to:copyTo,subject:'[Copy of email sent to '+email+'] '+copy.subject,html:copy.html,text:copy.text}).catch(()=>null);
        copyTo='';
      }
      sent++;
    }catch(error){
      // A sending limit is the account's, not this agency's: stop the batch and leave everyone queued for a later run.
      const code=String((error as {code?:unknown})?.code||'');
      const message=error instanceof Error?error.message:'';
      if(/LIMIT_EXCEEDED/.test(code)||/quota|limit exceeded/i.test(message))break;
      await env.DB.prepare("INSERT INTO agency_outreach_events(id,organization_id,event_type,recipient_email,payload) VALUES (?,?,'hiring_needs_invite_failed',?,?)")
        .bind(crypto.randomUUID(),org.id,email,JSON.stringify({error:error instanceof Error?error.message:'send failed'})).run();
      failed++;
    }
  }
  return {attempted:(orgs.results||[]).length,sent,failed};
}

/** Hiring-needs invites sent so far: today (UTC) and ever. */
export async function hiringInviteCounts(env:FeatureEnv){
  if(!env.DB)return {today:0,total:0};
  const row=await env.DB.prepare("SELECT COUNT(*) AS total,SUM(datetime(created_at)>=datetime('now','start of day')) AS today FROM agency_outreach_events WHERE event_type='hiring_needs_invite'").first<Row>();
  return {today:asNum(row?.today),total:asNum(row?.total)};
}

export const TEST_AGENCY_ID='carejoys-test-agency';

/** Removes the test agency's claim, tokens, matches, hiring profile and openings so the walkthrough can start over. */
export async function resetTestAgency(env:FeatureEnv){
  const db=env.DB!;
  const openings=await db.prepare('SELECT id FROM openings WHERE agency_organization_id=?').bind(TEST_AGENCY_ID).all<Row>();
  for(const o of openings.results||[]){
    await db.prepare('UPDATE outreach_events SET opening_id=NULL WHERE opening_id=?').bind(o.id).run();
    await db.prepare('DELETE FROM interview_slots WHERE opening_id=?').bind(o.id).run();
    await db.prepare('DELETE FROM candidate_pipeline WHERE opening_id=?').bind(o.id).run();
    await db.prepare('DELETE FROM openings WHERE id=?').bind(o.id).run();
  }
  for(const table of ['agency_teaser_tokens','agency_org_candidate_matches','agency_org_hiring_profiles','agency_outreach_events'])
    await db.prepare(`DELETE FROM ${table} WHERE organization_id=?`).bind(TEST_AGENCY_ID).run();
  // Jobs copied from a real agency for the walkthrough (never published).
  await db.prepare('DELETE FROM caregiver_job_apply_events WHERE caregiver_job_id IN (SELECT id FROM caregiver_jobs WHERE agency_organization_id=?)').bind(TEST_AGENCY_ID).run();
  await db.prepare('DELETE FROM caregiver_jobs WHERE agency_organization_id=?').bind(TEST_AGENCY_ID).run();
  await db.prepare('UPDATE agency_organizations SET claimed_employer_id=NULL,teaser_last_sent_at=NULL,teaser_send_count=0 WHERE id=?').bind(TEST_AGENCY_ID).run();
}

/** Copies of real jobs on the test agency carry this reason; they stay unpublished but show as live in its jobs panel. */
export const TEST_JOB_REASON='test_agency_copy';
const ORG_PROFILE_COLUMNS=['primary_domain','primary_website','primary_careers_url','primary_phone','primary_contact_name','city','state','zip','provider_types','license_count',
  'website_source','careers_source','inferred_roles','current_hiring_signal','hiring_signal_source','caregiver_relevance_score','npi','google_place_id','rating','review_count','sources'];

/**
 * Admin walkthrough: a hidden test agency whose live teaser goes to `email`. With `sourceId` it is a copy of that real
 * agency (profile, caregiver matches, current jobs) so the walkthrough shows real data; otherwise a generic Baltimore
 * agency matched to Maryland caregivers. It never appears in agency search, the MCP, job pages, scans or real outreach.
 */
export async function startTestAgency(env:FeatureEnv,email:string,sourceId=''){
  if(!env.DB||!env.EMAIL)throw new Error('Email is not configured');
  const source=sourceId?await env.DB.prepare('SELECT * FROM agency_organizations WHERE id=? AND COALESCE(is_test,0)=0 LIMIT 1').bind(sourceId).first<Row>():null;
  if(sourceId&&!source)throw new Error('Agency not found');
  await resetTestAgency(env);
  await env.DB.prepare(`INSERT INTO agency_organizations(id,organization_key,canonical_name,primary_email,city,state,zip,provider_types,caregiver_relevance_score,current_hiring_signal,is_active,is_test)
    VALUES (?,?,'CareJoys Test Agency',?,'Baltimore','MD','21201','Residential Service Agency',90,'unknown',1,1)
    ON CONFLICT(id) DO UPDATE SET canonical_name='CareJoys Test Agency',primary_email=excluded.primary_email,is_active=1,is_test=1,updated_at=CURRENT_TIMESTAMP`)
    .bind(TEST_AGENCY_ID,TEST_AGENCY_ID,email).run();
  // Every profile column is reset, so a generic run after a copy does not keep the copied agency's details.
  await env.DB.prepare(`UPDATE agency_organizations SET ${ORG_PROFILE_COLUMNS.map(c=>c+'=?').join(',')},canonical_name=? WHERE id=?`)
    .bind(...ORG_PROFILE_COLUMNS.map(c=>source?source[c]??null:({city:'Baltimore',state:'MD',zip:'21201',provider_types:'Residential Service Agency',license_count:0,caregiver_relevance_score:90,current_hiring_signal:'unknown'} as Row)[c]??null),
      source?clean(source.canonical_name,170)+' (test copy)':'CareJoys Test Agency',TEST_AGENCY_ID).run();
  if(source){
    await env.DB.prepare(`INSERT INTO agency_org_candidate_matches(id,organization_id,caregiver_id,fit_score,geography_score,role_score,freshness_score,provider_score,match_reason,status,last_scored_at)
      SELECT ?||':'||caregiver_id,?,caregiver_id,fit_score,geography_score,role_score,freshness_score,provider_score,match_reason,'matched',CURRENT_TIMESTAMP
      FROM agency_org_candidate_matches WHERE organization_id=?`).bind(TEST_AGENCY_ID,TEST_AGENCY_ID,source.id).run();
    const profile=await env.DB.prepare('SELECT * FROM agency_org_hiring_profiles WHERE organization_id=?').bind(source.id).first<Row>();
    if(profile){
      const cols=Object.keys(profile).filter(c=>c!=='organization_id'&&c!=='employer_confirmed_at');
      await env.DB.prepare(`INSERT INTO agency_org_hiring_profiles(organization_id,${cols.join(',')}) VALUES (?,${cols.map(()=>'?').join(',')})`)
        .bind(TEST_AGENCY_ID,...cols.map(c=>profile[c]??null)).run();
    }
    const jobCols=['source_provider','source_job_id','source_url','source_listing_url','title','role','employer_name','city','state','zip','employment_type','pay_min','pay_max','pay_currency',
      'description_text','classifier_reason','confidence','date_posted','valid_through','first_seen_at','last_seen_at','last_checked_at','normalized_title','roles_json','pay_period','location_source'];
    await env.DB.prepare(`INSERT INTO caregiver_jobs(id,agency_organization_id,dedupe_key,status,is_published,publication_reason,${jobCols.join(',')})
      SELECT 'test-'||id,?,'test-copy:'||dedupe_key,'current',0,?,${jobCols.join(',')} FROM caregiver_jobs
      WHERE agency_organization_id=? AND status='current' AND is_published=1 LIMIT 200`).bind(TEST_AGENCY_ID,TEST_JOB_REASON,source.id).run();
  }else{
    await env.DB.prepare(`INSERT INTO agency_org_candidate_matches(id,organization_id,caregiver_id,fit_score,geography_score,role_score,freshness_score,provider_score,match_reason,status,last_scored_at)
      SELECT ?||':'||c.id,?,c.id,g+f+20,g,5,f,15,json_object('geography',g,'role',5,'freshness',f,'provider',15),'matched',CURRENT_TIMESTAMP FROM (
        SELECT c.id,
          CASE WHEN c.zip='21201' THEN 50 WHEN lower(coalesce(c.city,''))='baltimore' THEN 35 ELSE 15 END AS g,
          CASE WHEN c.last_confirmed_at IS NOT NULL AND datetime(c.last_confirmed_at)>=datetime('now','-30 days') THEN 15
            WHEN c.last_confirmed_at IS NOT NULL AND datetime(c.last_confirmed_at)>=datetime('now','-90 days') THEN 8 ELSE 0 END AS f
        FROM caregivers c
        WHERE c.is_active=1 AND c.work_status='actively_looking' AND (c.auth0_email_verified=1 OR (c.source='legacy_carekoya' AND c.activation_completed_at IS NOT NULL))
          AND (upper(coalesce(c.state,''))='MD' OR CAST(substr(coalesce(c.zip,''),1,3) AS INTEGER) BETWEEN 206 AND 219)
        ORDER BY g DESC,f DESC LIMIT 75) c`).bind(TEST_AGENCY_ID,TEST_AGENCY_ID).run();
  }
  const org=await env.DB.prepare(`SELECT o.id,o.canonical_name,o.primary_email,o.primary_contact_name,COUNT(m.id) AS candidate_count,MAX(m.fit_score) AS top_score
    FROM agency_organizations o LEFT JOIN agency_org_candidate_matches m ON m.organization_id=o.id WHERE o.id=? GROUP BY o.id`).bind(TEST_AGENCY_ID).first<Row>();
  await deliverTeaser(env,org!,true);
  const jobs=await env.DB.prepare('SELECT COUNT(*) AS n FROM caregiver_jobs WHERE agency_organization_id=?').bind(TEST_AGENCY_ID).first<Row>();
  return {email,agencyName:clean(org?.canonical_name,200),candidateCount:asNum(org?.candidate_count),jobCount:asNum(jobs?.n)};
}
