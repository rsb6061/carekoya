import { type EmailBinding } from './email';
import { publicFormGuard, sendEmployerMagicLink, requestEmployerMagicLink, verifyEmployerMagicLink, sessionResponse, logoutEmployer, employerSession, employerOwnsWorkspace, publicConfig, contactMatches, interviewSlots, getCandidateResponse, submitCandidateResponse, bookCandidateInterview } from './serverFeatures';
import { enrichAgencyBatch, scoreAgencyMatches, scoreCaregiverAgainstAgencies, getAgencyTeaser, requestAgencyClaim, getAgencyNetwork, updateAgencyHiringProfile, sendAgencyTeaserBatch } from './agencyFeatures';
import { discoverAgencyJobsBatch, getPublicCaregiverJobs, getPublicCaregiverJob } from './jobDiscovery';
import { listPublicTrainingPrograms, publicSchoolProgram, publicTrainingOrganization, requestSchoolAccess, verifySchoolMagic, schoolDashboard, createSchoolCohort, schoolLogout } from './schoolFeatures';
interface D1Result<T = unknown> {
  results?: T[];
  success?: boolean;
  meta?: Record<string, unknown>;
}
interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  run(): Promise<{ success: boolean; meta?: Record<string, unknown> }>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
}
interface D1Database { prepare(query: string): D1PreparedStatement; }
interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  DB?: D1Database;
  EMAIL?: EmailBinding;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  AUTH0_DOMAIN?: string;
  AUTH0_CLIENT_ID?: string;
}
function sameOriginWrite(request:Request){
  const origin=request.headers.get("origin");
  if(!origin)return true;
  try{
    const host=new URL(origin).hostname.toLowerCase();
    return host==="carejoys.com"||host==="www.carejoys.com"||host.endsWith(".workers.dev")||host==="localhost"||host==="127.0.0.1";
  }catch{return false}
}
function rejectCrossSiteWrite(request:Request){
  return sameOriginWrite(request)?null:json({ok:false,error:"Cross-site request blocked"},{status:403});
}

function base64UrlBytes(value:string){
  const normalized=value.replace(/-/g,'+').replace(/_/g,'/');
  const padded=normalized+'='.repeat((4-normalized.length%4)%4);
  const raw=atob(padded);
  return Uint8Array.from(raw,ch=>ch.charCodeAt(0));
}
function base64UrlJson(value:string){
  try{return JSON.parse(new TextDecoder().decode(base64UrlBytes(value))) as Record<string,unknown>}catch{return null}
}
async function caregiverAuthIdentity(request:Request,env:Env){
  if(!env.AUTH0_DOMAIN||!env.AUTH0_CLIENT_ID)return null;
  const auth=request.headers.get('authorization')||'';
  const token=auth.startsWith('Bearer ')?auth.slice(7).trim():'';
  if(!token)return null;
  const parts=token.split('.');
  if(parts.length!==3)return null;
  const header=base64UrlJson(parts[0]);
  const payload=base64UrlJson(parts[1]);
  if(!header||!payload||header.alg!=='RS256'||!header.kid)return null;
  const issuer='https://'+env.AUTH0_DOMAIN.replace(/^https?:\/\//,'').replace(/\/$/,'')+'/';
  const aud=payload.aud;
  const audOk=Array.isArray(aud)?aud.includes(env.AUTH0_CLIENT_ID):aud===env.AUTH0_CLIENT_ID;
  if(payload.iss!==issuer||!audOk||Number(payload.exp||0)*1000<Date.now())return null;
  try{
    const res=await fetch(issuer+'.well-known/jwks.json',{headers:{accept:'application/json'}});
    if(!res.ok)return null;
    const jwks=await res.json() as {keys?:JsonWebKey[]};
    const jwk=(jwks.keys||[]).find((k:any)=>k.kid===header.kid);
    if(!jwk)return null;
    const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
    const signed=new TextEncoder().encode(parts[0]+'.'+parts[1]);
    const valid=await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,base64UrlBytes(parts[2]),signed);
    if(!valid)return null;
    return {
      sub:clean(payload.sub,255),
      email:clean(payload.email,320).toLowerCase(),
      emailVerified:payload.email_verified===true,
      name:clean(payload.name,200)
    };
  }catch{return null}
}

function json(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...(init.headers || {})
    }
  });
}

const SEO_ORIGIN="https://carejoys.com";
const htmlEscape=(value:unknown)=>String(value??"").replace(/[&<>"']/g,(ch)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]||ch));
const htmlEntityDecode=(value:unknown)=>String(value??"")
  .replace(/&#x([0-9a-f]+);/gi,(_,hex)=>String.fromCodePoint(parseInt(hex,16)))
  .replace(/&#(\d+);/g,(_,num)=>String.fromCodePoint(parseInt(num,10)))
  .replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&nbsp;/g," ");
const xmlEscape=(value:unknown)=>htmlEscape(value);

async function careJoysSitemap(env:Env){
  const entries:{url:string;lastmod?:string|null}[]=[
    {url:SEO_ORIGIN+"/"},
    {url:SEO_ORIGIN+"/about"},
    {url:SEO_ORIGIN+"/hire-caregivers/maryland"},
    {url:SEO_ORIGIN+"/caregiver-jobs/maryland"},
    {url:SEO_ORIGIN+"/caregiver-resume"},
    {url:SEO_ORIGIN+"/resources/how-to-become-a-caregiver-in-maryland"},
    {url:SEO_ORIGIN+"/training-programs/maryland"}
  ];
  if(env.DB){
    const orgs=await env.DB.prepare(`SELECT DISTINCT torg.slug,torg.updated_at
      FROM training_organizations torg
      JOIN training_programs tp ON tp.organization_id=torg.id
      WHERE torg.is_active=1 AND tp.is_active=1
        AND tp.provider_type IN ('Freestanding Program','College','High School')
      ORDER BY torg.slug`).all<{slug:string;updated_at?:string|null}>();
    for(const row of orgs.results||[])if(row.slug)entries.push({
      url:SEO_ORIGIN+"/training-programs/"+encodeURIComponent(row.slug),
      lastmod:row.updated_at||null
    });
    const jobs=await env.DB.prepare("SELECT id,last_seen_at FROM caregiver_jobs WHERE is_published=1 AND status='current' ORDER BY last_seen_at DESC LIMIT 5000").all<{id:string;last_seen_at?:string|null}>();
    for(const row of jobs.results||[])if(row.id)entries.push({
      url:SEO_ORIGIN+"/jobs/"+encodeURIComponent(row.id),
      lastmod:row.last_seen_at||null
    });
  }
  const xml=entries.map(entry=>"<url><loc>"+xmlEscape(entry.url)+"</loc>"+(entry.lastmod?"<lastmod>"+xmlEscape(String(entry.lastmod).slice(0,10))+"</lastmod>":"")+"</url>").join("");
  return new Response('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+xml+"</urlset>",{
    headers:{"content-type":"application/xml; charset=utf-8","cache-control":"public,max-age=900"}
  });
}

function careJoysRobots(){
  return new Response(`User-agent: OAI-SearchBot
Allow: /
Disallow: /api/
Disallow: /app
Disallow: /auth
Disallow: /activate
Disallow: /respond
Disallow: /school-auth
Disallow: /school-dashboard

User-agent: GPTBot
Allow: /
Disallow: /api/
Disallow: /app
Disallow: /auth
Disallow: /activate
Disallow: /respond
Disallow: /school-auth
Disallow: /school-dashboard

User-agent: *
Allow: /
Disallow: /api/

Sitemap: https://carejoys.com/sitemap.xml
`,{headers:{"content-type":"text/plain; charset=utf-8","cache-control":"public,max-age=3600"}});
}

function careJoysLlms(){
  return new Response(`# CareJoys

CareJoys is a Maryland caregiver recruiting and placement network for home-care, senior-care, and direct-care hiring.

## What CareJoys does
- Helps Maryland care employers identify local caregivers by role, geography, shift, pay preference, transportation, credentials, experience, and current availability.
- Helps employers confirm caregiver interest and move qualified matches toward interviews and hires.
- Helps caregivers create one reusable work profile and choose which relevant opportunities they want to pursue.
- Helps CNA/GNA and other caregiver training programs give graduates tracked referral links and measure downstream profiles, matches, employer interest, interviews, and recorded hires.

## What CareJoys is not
- CareJoys is not a state regulator or credentialing body.
- Regulatory and training-program approval information remains attributed to the relevant state or training source.
- A caregiver profile is not treated as currently available unless availability is separately confirmed.

## Roles
CareJoys supports CNA, GNA, HHA, PCA, caregiver and related direct-care roles.

## Canonical public pages
- Home: https://carejoys.com/
- About CareJoys: https://carejoys.com/about
- Hire caregivers in Maryland: https://carejoys.com/hire-caregivers/maryland
- Maryland caregiver network: https://carejoys.com/caregiver-jobs/maryland
- Caregiver resume builder and job matching: https://carejoys.com/caregiver-resume
- How to become a caregiver in Maryland: https://carejoys.com/resources/how-to-become-a-caregiver-in-maryland
- Maryland caregiver training programs: https://carejoys.com/training-programs/maryland
- Individual training organizations: https://carejoys.com/training-programs/{slug}
- Sitemap: https://carejoys.com/sitemap.xml

CareJoys distinguishes regulatory training-program data from employer hiring signals and caregiver-provided profile information.
`,{headers:{"content-type":"text/plain; charset=utf-8","cache-control":"public,max-age=3600"}});
}

async function seoAsset(request:Request,env:Env,meta:{title:string;description:string;canonical:string;robots?:string;snapshot?:string;jsonLd?:unknown}){
  const asset=await env.ASSETS.fetch(request);
  const type=asset.headers.get("content-type")||"";
  if(!type.includes("text/html"))return asset;
  let body=await asset.text();
  const canonical=meta.canonical.startsWith("http")?meta.canonical:SEO_ORIGIN+meta.canonical;
  body=body.replace(/<title>[\s\S]*?<\/title>/i,"<title>"+htmlEscape(meta.title)+"</title>");
  body=body.replace(/<meta\s+name=["']description["'][^>]*>/i,'<meta name="description" content="'+htmlEscape(meta.description)+'" />');
  body=body.replace(/<link\s+rel=["']canonical["'][^>]*>/i,'<link rel="canonical" href="'+htmlEscape(canonical)+'" />');
  const extra=[
    '<meta name="robots" content="'+htmlEscape(meta.robots||"index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1")+'" />',
    '<meta property="og:site_name" content="CareJoys" />',
    '<meta property="og:title" content="'+htmlEscape(meta.title)+'" />',
    '<meta property="og:description" content="'+htmlEscape(meta.description)+'" />',
    '<meta property="og:url" content="'+htmlEscape(canonical)+'" />',
    '<meta property="og:type" content="website" />',
    '<meta name="twitter:card" content="summary" />',
    meta.jsonLd?'<script type="application/ld+json">'+JSON.stringify(meta.jsonLd).replace(/</g,"\\u003c")+"</script>":""
  ].join("");
  body=body.replace("</head>",extra+"</head>");
  if(meta.snapshot)body=body.replace('<div id="root"></div>','<div id="root">'+meta.snapshot+"</div>");
  const headers=new Headers(asset.headers);
  headers.set("content-type","text/html; charset=utf-8");
  headers.set("cache-control","public,max-age=300");
  return new Response(body,{status:asset.status,headers});
}

async function publicSeoPage(request:Request,url:URL,env:Env){
  if(request.method!=="GET")return null;
  if(url.pathname==="/"){
    return seoAsset(request,env,{
      title:"CareJoys | Maryland Caregiver Recruiting & Job Matching",
      description:"CareJoys helps Maryland home-care agencies and employers match with local caregivers ready to work.",
      canonical:"/",
      snapshot:'<main><h1>Maryland caregiver recruiting and job matching</h1><p>CareJoys helps Maryland home-care agencies and employers match with local caregivers ready to work.</p><p><a href="/hire-caregivers/maryland">For employers</a> · <a href="/caregiver-jobs/maryland">For caregivers</a> · <a href="/training-programs/maryland">Caregiver training programs</a> · <a href="/about">About CareJoys</a></p></main>',
      jsonLd:{"@context":"https://schema.org","@graph":[
        {"@type":"WebSite","@id":SEO_ORIGIN+"/#website","url":SEO_ORIGIN+"/","name":"CareJoys","publisher":{"@id":SEO_ORIGIN+"/#organization"}},
        {"@type":"Organization","@id":SEO_ORIGIN+"/#organization","name":"CareJoys","url":SEO_ORIGIN+"/","description":"A Maryland caregiver recruiting and placement network connecting home-care and senior-care employers, caregivers, and caregiver training programs.","areaServed":{"@type":"State","name":"Maryland"},"knowsAbout":["caregiver recruiting","CNA hiring","GNA hiring","HHA hiring","PCA hiring","home care staffing","caregiver training program placement"]}
      ]}
    });
  }
  if(url.pathname==="/caregiver-recruiting/maryland") return Response.redirect(SEO_ORIGIN+"/hire-caregivers/maryland",301);
  if(url.pathname==="/hire-caregivers/maryland"){
    return seoAsset(request,env,{
      title:"Hire Caregivers in Maryland | CareJoys",
      description:"Find CNAs, GNAs, HHAs, PCAs and caregivers in Maryland. CareJoys matches local candidates, confirms interest and helps move qualified caregivers to interview.",
      canonical:"/hire-caregivers/maryland",
      snapshot:'<main><h1>Hire caregivers in Maryland</h1><p>Find local CNAs, GNAs, HHAs, PCAs and caregivers who are actually interested in your opening.</p><p><a href="/?hire=1">Find caregivers</a> · <a href="/about">How CareJoys works</a></p><h2>Caregiver hiring with current interest</h2><p>CareJoys helps Maryland home-care, senior-care and direct-care employers match local candidates by role, geography, shifts, pay preferences, transportation, experience and current availability, then confirm interest before interview.</p><p><a href="/caregiver-jobs/maryland">Maryland caregiver jobs</a> · <a href="/training-programs/maryland">Caregiver training programs</a></p></main>',
      jsonLd:{"@context":"https://schema.org","@graph":[
        {"@type":"WebPage","@id":SEO_ORIGIN+"/hire-caregivers/maryland#webpage","url":SEO_ORIGIN+"/hire-caregivers/maryland","name":"Hire caregivers in Maryland","isPartOf":{"@id":SEO_ORIGIN+"/#website"},"about":{"@id":SEO_ORIGIN+"/#organization"}},
        {"@type":"Service","@id":SEO_ORIGIN+"/hire-caregivers/maryland#service","name":"Hire caregivers in Maryland","provider":{"@id":SEO_ORIGIN+"/#organization"},"areaServed":{"@type":"State","name":"Maryland"},"serviceType":"Caregiver recruiting and placement","audience":{"@type":"BusinessAudience","audienceType":"Home-care, senior-care, and direct-care employers"}}
      ]}
    });
  }
  if(url.pathname==="/about"){
    return seoAsset(request,env,{
      title:"About CareJoys | Maryland Caregiver Recruiting Network",
      description:"CareJoys connects Maryland care employers, caregivers, and training programs through current availability, interest confirmation, interviews, and hires.",
      canonical:"/about",
      snapshot:'<main><h1>About CareJoys</h1><p><strong>CareJoys is a Maryland caregiver recruiting and placement network.</strong> It connects care employers, caregivers, and caregiver training programs so hiring can move from relevant local match to confirmed interest to interview with less manual chasing.</p><h2>Who CareJoys is for</h2><ul><li>Care employers hiring CNAs, GNAs, HHAs, PCAs, caregivers and related direct-care workers.</li><li>Caregivers who want one reusable work profile and relevant local opportunities.</li><li>Caregiver training programs that want tracked graduate placement outcomes.</li></ul><h2>What CareJoys is not</h2><p>CareJoys is not a state regulator or credentialing body. Regulatory approval, training status, employer hiring signals, and caregiver-provided information are maintained as separate sources.</p></main>',
      jsonLd:{"@context":"https://schema.org","@type":"AboutPage","url":SEO_ORIGIN+"/about","name":"About CareJoys","about":{"@id":SEO_ORIGIN+"/#organization"},"isPartOf":{"@id":SEO_ORIGIN+"/#website"}}
    });
  }
  if(url.pathname==="/caregiver-jobs/maryland"){
    let currentJobsHtml="";
    const itemList:any[]=[];
    if(env.DB){
      const currentJobs=await env.DB.prepare(`SELECT id,title,role,employer_name,city,state,zip,source_url
        FROM caregiver_jobs WHERE is_published=1 AND status='current' AND state='MD'
        ORDER BY CASE WHEN date_posted IS NULL OR date_posted='' THEN 1 ELSE 0 END,date_posted DESC,last_seen_at DESC LIMIT 20`).all<Record<string,unknown>>();
      currentJobsHtml=(currentJobs.results||[]).map((job,index)=>{
        const label=[job.employer_name,[job.city,job.state].filter(Boolean).join(", ")||job.zip].filter(Boolean).join(" · ");
        const internalUrl=SEO_ORIGIN+"/jobs/"+encodeURIComponent(String(job.id||""));
        const title=htmlEntityDecode(job.title||"Caregiver job");
        itemList.push({"@type":"ListItem","position":index+1,"name":title,"url":internalUrl});
        return '<li><a href="/jobs/'+encodeURIComponent(String(job.id||""))+'">'+htmlEscape(title)+'</a> — '+htmlEscape(label)+' · '+htmlEscape(job.role)+'</li>';
      }).join("");
    }
    return seoAsset(request,env,{
      title:"Caregiver Jobs in Maryland: CNA, GNA, HHA & PCA | CareJoys",
      description:"Find current caregiver jobs in Maryland from care-employer career pages, including CNA, GNA, HHA, PCA, DSP and caregiver roles, then create one profile for matching.",
      canonical:"/caregiver-jobs/maryland",
      snapshot:'<main><h1>Caregiver jobs in Maryland</h1><p>Find CNA, GNA, HHA, PCA, DSP, private-duty and home-care jobs near you. Create one CareJoys profile and get matched with relevant local employers.</p><p><a href="/caregiver-resume">Upload your caregiver resume and get matched</a></p><h2>Current caregiver jobs in Maryland</h2>'+(currentJobsHtml?'<ul>'+currentJobsHtml+'</ul>':'<p>CareJoys is adding verified Maryland caregiver jobs from employer career pages now.</p>')+'<h2>One profile. Relevant jobs. Your choice.</h2><ol><li>Create your caregiver work profile once.</li><li>Keep your location, shifts, pay preferences and availability current.</li><li>Choose which relevant employer opportunities interest you.</li></ol><p><a href="/resources/how-to-become-a-caregiver-in-maryland">How to become a caregiver in Maryland</a> · <a href="/training-programs/maryland">Maryland caregiver training programs</a></p></main>',
      jsonLd:{"@context":"https://schema.org","@graph":[
        {"@type":"WebPage","url":SEO_ORIGIN+"/caregiver-jobs/maryland","name":"Caregiver jobs and job matching in Maryland","about":{"@type":"Thing","name":"Maryland caregiver jobs"},"isPartOf":{"@id":SEO_ORIGIN+"/#website"}},
        ...(itemList.length?[{"@type":"ItemList","name":"Current Maryland caregiver jobs","itemListElement":itemList}]:[])
      ]}
    });
  }
  const publicJobMatch=url.pathname.match(/^\/jobs\/([^/]+)$/);
  if(publicJobMatch&&env.DB){
    const id=decodeURIComponent(publicJobMatch[1]);
    const job=await env.DB.prepare("SELECT id,title,role,employer_name,city,state,zip,employment_type,pay_min,pay_max,description_text,source_url,date_posted,last_seen_at,last_checked_at FROM caregiver_jobs WHERE id=? AND is_published=1 AND status='current' LIMIT 1").bind(id).first<Record<string,unknown>>();
    if(job){
      const title=htmlEntityDecode(job.title||"Caregiver job");
      const employer=String(job.employer_name||"Maryland care employer");
      const location=[job.city,job.state,job.zip].filter(Boolean).join(", ");
      const description=String(job.description_text||"").replace(/\s+/g," ").trim().slice(0,1200);
      const metaDescription=(title+" at "+employer+(location?" in "+location:"")+". Apply through CareJoys and reuse one caregiver profile for relevant jobs.").slice(0,165);
      const pay=(job.pay_min||job.pay_max)?("$"+String(job.pay_min||"—")+"–$"+String(job.pay_max||"—")+"/hr"):"";
      return seoAsset(request,env,{
        title:(title+" | "+employer+" | CareJoys").slice(0,70),
        description:metaDescription,
        canonical:"/jobs/"+encodeURIComponent(id),
        snapshot:'<main><p><a href="/caregiver-jobs/maryland">Maryland caregiver jobs</a></p><h1>'+htmlEscape(title)+'</h1><p>'+htmlEscape(employer)+(location?" · "+htmlEscape(location):"")+(pay?" · "+htmlEscape(pay):"")+'</p><p><a href="/jobs/'+encodeURIComponent(id)+'#apply">Apply</a></p>'+(description?'<h2>About this job</h2><p>'+htmlEscape(description)+'</p>':'')+'<p>Source: <a href="'+htmlEscape(job.source_url)+'">original employer listing</a></p></main>',
        jsonLd:{"@context":"https://schema.org","@type":"WebPage","url":SEO_ORIGIN+"/jobs/"+encodeURIComponent(id),"name":title+" at "+employer,"isPartOf":{"@id":SEO_ORIGIN+"/#website"},"about":{"@type":"Thing","name":"Caregiver job in Maryland"}}
      });
    }
    return seoAsset(request,env,{title:"Job no longer available | CareJoys",description:"This caregiver job is no longer available. Browse current Maryland caregiver jobs.",canonical:"/jobs/"+encodeURIComponent(id),robots:"noindex,follow",snapshot:'<main><h1>This job is no longer available.</h1><p><a href="/caregiver-jobs/maryland">Browse current caregiver jobs</a></p></main>'});
  }
  if(url.pathname==="/caregiver-resume"){
    return seoAsset(request,env,{
      title:"Caregiver Resume: Builder, Example & Job Matching | CareJoys",
      description:"Build or upload a caregiver resume, review your CNA/HHA/PCA skills and certifications, create one CareJoys profile, and get matched with relevant care employers.",
      canonical:"/caregiver-resume",
      snapshot:'<main><h1>Add your resume, get matched to the best caregiver jobs near you.</h1><p>Upload your resume or start from scratch below. CareJoys matches you with the best caregiver employers and agencies.</p><h2>Caregiver resume example</h2><p><strong>Professional summary:</strong> Compassionate caregiver with experience supporting older adults with activities of daily living, mobility, meal preparation and companionship. Reliable, patient and comfortable working in private homes.</p><h2>Caregiver resume skills</h2><p>Include skills only when they are true for you: ADLs, dementia care, bathing and dressing, transfers, Hoyer lift, gait belt, vital signs, hospice, companionship, meal preparation, medication reminders, housekeeping, transportation, CPR, BLS and First Aid.</p><h2>Caregiver resume with no experience</h2><p>Do not invent paid experience. Relevant family caregiving, volunteer work, training, certifications, dependable transportation and transferable responsibilities can be included when described accurately.</p><p><a href="/caregiver-jobs/maryland">Find caregiver jobs in Maryland</a> · <a href="/training-programs/maryland">Find caregiver training programs</a></p></main>',
      jsonLd:{"@context":"https://schema.org","@graph":[
        {"@type":"WebPage","url":SEO_ORIGIN+"/caregiver-resume","name":"Caregiver Resume Builder, Example and Job Matching","isPartOf":{"@id":SEO_ORIGIN+"/#website"},"about":{"@type":"Thing","name":"Caregiver resume"}},
        {"@type":"WebApplication","name":"CareJoys Caregiver Resume Builder","url":SEO_ORIGIN+"/caregiver-resume","applicationCategory":"BusinessApplication","operatingSystem":"Web","offers":{"@type":"Offer","price":"0","priceCurrency":"USD"}}
      ]}
    });
  }
  if(url.pathname==="/resources/how-to-become-a-caregiver-in-maryland"){
    return seoAsset(request,env,{
      title:"How to Become a Caregiver in Maryland | CareJoys",
      description:"Learn the main paths into caregiver work in Maryland, including PCA and caregiver roles, CNA-I training, current certification rules, training programs and jobs.",
      canonical:"/resources/how-to-become-a-caregiver-in-maryland",
      snapshot:'<main><h1>How to become a caregiver in Maryland</h1><p>There is more than one path into caregiving. Personal-care and companion roles may use employer-based training, while certified nursing-assistant work follows Maryland Board of Nursing requirements.</p><h2>Do you need caregiver certification in Maryland?</h2><p>Not for every caregiver job. Maryland Residential Service Agencies may train staff directly or use approved outside trainers. Maryland changed its nursing-assistant framework effective April 1, 2026; new nursing-assistant applicants generally enter through the CNA-I pathway.</p><p><a href="/training-programs/maryland">Find Maryland caregiver training programs</a> · <a href="/caregiver-jobs/maryland">Find caregiver jobs</a></p></main>',
      jsonLd:{"@context":"https://schema.org","@type":"Article","headline":"How to Become a Caregiver in Maryland","mainEntityOfPage":SEO_ORIGIN+"/resources/how-to-become-a-caregiver-in-maryland","publisher":{"@id":SEO_ORIGIN+"/#organization"},"about":[{"@type":"Thing","name":"Caregiver careers in Maryland"},{"@type":"Thing","name":"CNA-I training"}]}
    });
  }
  if(url.pathname==="/training-programs/maryland"){
    let links="";
    if(env.DB){
      const rows=await env.DB.prepare(`SELECT DISTINCT torg.canonical_name,torg.slug,torg.credential_categories
        FROM training_organizations torg
        JOIN training_programs tp ON tp.organization_id=torg.id
        WHERE torg.is_active=1 AND tp.is_active=1
          AND tp.provider_type IN ('Freestanding Program','College','High School')
        ORDER BY torg.canonical_name LIMIT 250`).all<Record<string,unknown>>();
      links=(rows.results||[]).map(r=>'<li><a href="/training-programs/'+encodeURIComponent(String(r.slug||""))+'">'+htmlEscape(r.canonical_name)+'</a> · '+htmlEscape(r.credential_categories||"CNA/GNA")+"</li>").join("");
    }
    return seoAsset(request,env,{
      title:"Maryland CNA & GNA Caregiver Training Programs | CareJoys",
      description:"Browse Maryland caregiver training programs for CNA and GNA pathways. CareJoys connects graduates with local care employers and tracks placement outcomes.",
      canonical:"/training-programs/maryland",
      snapshot:'<main><h1>Maryland caregiver training programs</h1><p>Browse Maryland CNA/GNA caregiver training organizations and their approved program locations. CareJoys gives participating programs tracked graduate referral links and placement outcome reporting.</p><ul>'+links+"</ul></main>",
      jsonLd:{"@context":"https://schema.org","@type":"CollectionPage","url":SEO_ORIGIN+"/training-programs/maryland","name":"Maryland caregiver training programs","isPartOf":{"@id":SEO_ORIGIN+"/#website"}}
    });
  }
  const orgMatch=url.pathname.match(/^\/training-programs\/([^/]+)$/);
  if(orgMatch&&env.DB){
    const slug=decodeURIComponent(orgMatch[1]);
    const org=await env.DB.prepare("SELECT id,canonical_name,credential_categories,location_count FROM training_organizations WHERE slug=? AND is_active=1 LIMIT 1").bind(slug).first<Record<string,unknown>>();
    if(org){
      const rows=await env.DB.prepare("SELECT program_name,provider_type,city,state,zip,current_status,program_type FROM training_programs WHERE organization_id=? AND is_active=1 ORDER BY city,program_name").bind(org.id).all<Record<string,unknown>>();
      const locations=(rows.results||[]).map(r=>"<li>"+htmlEscape(r.program_name)+" — "+htmlEscape([r.city,r.state,r.zip].filter(Boolean).join(", "))+" · "+htmlEscape(r.program_type)+"</li>").join("");
      const name=String(org.canonical_name||"Caregiver Training Program");
      const credentials=String(org.credential_categories||"CNA/GNA");
      return seoAsset(request,env,{
        title:(name+" CNA/GNA Training | CareJoys").slice(0,68),
        description:(name+" is a Maryland caregiver training organization with "+Number(org.location_count||rows.results?.length||1)+" active program location"+(Number(org.location_count||1)===1?"":"s")+". View "+credentials+" training and CareJoys graduate placement.").slice(0,165),
        canonical:"/training-programs/"+encodeURIComponent(slug),
        snapshot:'<main><h1>'+htmlEscape(name)+"</h1><p>Maryland caregiver training program · "+htmlEscape(credentials)+'</p><ul>'+locations+'</ul><p><a href="/training-programs/maryland">Browse all Maryland caregiver training programs</a></p></main>',
        jsonLd:{"@context":"https://schema.org","@graph":[
          {"@type":"WebPage","url":SEO_ORIGIN+"/training-programs/"+encodeURIComponent(slug),"name":name+" caregiver training","isPartOf":{"@id":SEO_ORIGIN+"/#website"}},
          {"@type":"EducationalOrganization","name":name,"url":SEO_ORIGIN+"/training-programs/"+encodeURIComponent(slug),"areaServed":{"@type":"State","name":"Maryland"}}
        ]}
      });
    }
  }
  if(url.pathname==="/privacy-policy"){
    return seoAsset(request,env,{title:"Privacy Policy | CareJoys",description:"CareJoys privacy policy.",canonical:"/privacy-policy",robots:"noindex,follow"});
  }
  if(url.pathname==="/terms-of-service"){
    return seoAsset(request,env,{title:"Terms of Service | CareJoys",description:"CareJoys terms of service.",canonical:"/terms-of-service",robots:"noindex,follow"});
  }
  if(url.pathname.startsWith("/app")||url.pathname.startsWith("/auth")||url.pathname.startsWith("/activate")||url.pathname.startsWith("/respond")||url.pathname.startsWith("/agency")||url.pathname.startsWith("/school-auth")||url.pathname.startsWith("/school-dashboard")){
    return seoAsset(request,env,{title:"CareJoys",description:"CareJoys caregiver recruiting and placement workflow.",canonical:url.pathname,robots:"noindex,nofollow"});
  }
  if(url.pathname==="/schools/maryland")return Response.redirect(SEO_ORIGIN+"/training-programs/maryland",301);
  if(url.pathname.startsWith("/school/")||url.pathname.startsWith("/join/")){
    return seoAsset(request,env,{
      title:"CareJoys",
      description:"CareJoys caregiver placement and graduate referral network.",
      canonical:url.pathname,
      robots:"noindex,follow",
      snapshot:""
    });
  }
  return null;
}
async function readJson(request: Request) {
  try { return await request.json() as Record<string, unknown>; } catch { return null; }
}
const clean = (value: unknown, max = 500) => typeof value === "string" ? value.trim().slice(0, max) : "";
const emailLooksValid = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const rejectBot = (data: Record<string, unknown> | null) => !!clean(data?.website);
function requireFields(data: Record<string, unknown> | null, fields: string[]) {
  if (!data) return "Invalid JSON body";
  const missing = fields.filter((field) => !clean(data[field]));
  return missing.length ? `Missing required fields: ${missing.join(", ")}` : null;
}
function publicName(first: unknown, last: unknown, display: unknown) {
  const f = clean(first, 80);
  const l = clean(last, 80);
  if (f) return l ? `${f} ${l.charAt(0).toUpperCase()}.` : f;
  const d = clean(display, 120);
  const parts = d.split(/\s+/).filter(Boolean);
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1].charAt(0).toUpperCase()}.` : (d || "Caregiver");
}
function ageDays(timestamp: unknown) {
  const value = clean(timestamp, 80);
  if (!value) return null;
  const ms = Date.now() - new Date(value).getTime();
  return Number.isFinite(ms) ? Math.max(0, ms / 86400000) : null;
}
function freshnessLabel(status: unknown, confirmedAt: unknown) {
  const s = clean(status, 80);
  const days = ageDays(confirmedAt);
  if (s === "actively_looking" && days !== null) {
    if (days < 1) return "Confirmed today";
    if (days <= 7) return `Confirmed ${Math.floor(days)}d ago`;
    if (days <= 30) return "Confirmed this month";
  }
  if (s === "not_looking") return "Not currently looking";
  return "Availability unconfirmed";
}
function splitTerms(value: string) {
  return value.toLowerCase().split(/[^a-z0-9]+/).filter((x) => x.length > 2);
}
function scoreCandidate(opening: Record<string, unknown>, c: Record<string, unknown>) {
  let score = 0;
  const reasons: string[] = [];
  const targetRole = clean(opening.role).toLowerCase();
  const roleText = [clean(c.role), clean(c.certifications), clean(c.specialties)].join(" ").toLowerCase();
  if (targetRole && roleText.includes(targetRole)) { score += 40; reasons.push("role match"); }
  else if (targetRole) {
    const aliases: Record<string, string[]> = {
      cna: ["cna", "certified nursing assistant", "nursing assistant"],
      gna: ["gna", "geriatric nursing assistant", "nursing assistant"],
      hha: ["hha", "home health aide"],
      pca: ["pca", "personal care aide"],
      caregiver: ["caregiver", "personal care", "home health", "cna", "hha", "pca"]
    };
    const terms = aliases[targetRole] || [targetRole];
    if (terms.some((term) => roleText.includes(term))) { score += 35; reasons.push("related credential"); }
  }
  const openingZip = clean(opening.zip);
  const caregiverZip = clean(c.zip);
  const openingState = clean(opening.state).toLowerCase();
  const caregiverState = clean(c.state).toLowerCase();
  const openingCity = clean(opening.city).toLowerCase();
  const caregiverCity = clean(c.city).toLowerCase();
  if (openingZip && caregiverZip && openingZip === caregiverZip) { score += 25; reasons.push("same ZIP"); }
  else if (openingCity && caregiverCity && openingCity === caregiverCity && openingState === caregiverState) { score += 20; reasons.push("same city"); }
  else if (openingState && caregiverState && openingState === caregiverState) { score += 10; reasons.push("same state"); }
  const days = ageDays(c.last_confirmed_at);
  const status = clean(c.work_status);
  if (status === "actively_looking" && days !== null) {
    if (days <= 7) { score += 25; reasons.push("recently confirmed"); }
    else if (days <= 30) { score += 18; reasons.push("confirmed this month"); }
    else if (days <= 90) { score += 8; reasons.push("older availability"); }
  }
  const targetShift = clean(opening.shift_preferences);
  const candidateShift = clean(c.shift_preferences);
  if (targetShift && candidateShift) {
    const targetTerms = splitTerms(targetShift);
    if (targetTerms.some((term) => candidateShift.toLowerCase().includes(term))) { score += 10; reasons.push("shift overlap"); }
  }
  if (Number(opening.transportation_required || 0) === 1) {
    if (clean(c.transportation) || Number(c.willing_to_drive || 0) === 1) { score += 5; reasons.push("transportation"); }
  }
  return { score: Math.min(100, score), reasons };
}
async function requireWorkspace(env: Env, id: string) {
  if (!env.DB || !id) return null;
  return env.DB.prepare("SELECT id, company_name, contact_name, email, phone, zip, roles_needed, status, created_at FROM employer_leads WHERE id = ?").bind(id).first();
}
async function handleAgencyDemandSummary(env: Env) {
  if (!env.DB) return json({ ok:false, error:"Database not configured" }, { status:503 });
  const jurisdictions = await env.DB.prepare(`
    SELECT
      COALESCE(NULLIF(TRIM(a.jurisdiction),''),'Unknown') AS jurisdiction,
      COUNT(*) AS licensed_records,
      COUNT(DISTINCT COALESCE(NULLIF(a.organization_id,''),a.id)) AS organizations,
      SUM(CASE WHEN a.caregiver_match_eligible=1 THEN 1 ELSE 0 END) AS match_eligible_records,
      COUNT(DISTINCT CASE WHEN a.caregiver_match_eligible=1 THEN COALESCE(NULLIF(a.organization_id,''),a.id) END) AS match_eligible_organizations,
      COUNT(DISTINCT CASE WHEN ao.last_enriched_at IS NOT NULL THEN ao.id END) AS enriched_organizations,
      COUNT(DISTINCT CASE WHEN ao.current_hiring_signal='hiring_detected' THEN ao.id END) AS hiring_detected_organizations
    FROM agencies a
    LEFT JOIN agency_organizations ao ON ao.id=a.organization_id
    WHERE a.is_active=1 AND a.source LIKE 'maryland_ohcq_%'
    GROUP BY COALESCE(NULLIF(TRIM(a.jurisdiction),''),'Unknown')
    ORDER BY match_eligible_organizations DESC, organizations DESC, jurisdiction
  `).all<Record<string,unknown>>();
  const cities = await env.DB.prepare(`
    SELECT
      COALESCE(NULLIF(TRIM(a.city),''),'Unknown') AS city,
      COALESCE(NULLIF(TRIM(a.state),''),'MD') AS state,
      COUNT(DISTINCT CASE WHEN a.caregiver_match_eligible=1 THEN COALESCE(NULLIF(a.organization_id,''),a.id) END) AS match_eligible_organizations,
      COUNT(DISTINCT CASE WHEN ao.last_enriched_at IS NOT NULL THEN ao.id END) AS enriched_organizations,
      COUNT(DISTINCT CASE WHEN ao.current_hiring_signal='hiring_detected' THEN ao.id END) AS hiring_detected_organizations
    FROM agencies a
    LEFT JOIN agency_organizations ao ON ao.id=a.organization_id
    WHERE a.is_active=1 AND a.source LIKE 'maryland_ohcq_%'
    GROUP BY COALESCE(NULLIF(TRIM(a.city),''),'Unknown'), COALESCE(NULLIF(TRIM(a.state),''),'MD')
    HAVING COUNT(DISTINCT CASE WHEN a.caregiver_match_eligible=1 THEN COALESCE(NULLIF(a.organization_id,''),a.id) END) > 0
    ORDER BY match_eligible_organizations DESC, city
  `).all<Record<string,unknown>>();
  return json({
    ok:true,
    source:"CareJoys Maryland OHCQ agency network",
    generatedAt:new Date().toISOString(),
    jurisdictions:jurisdictions.results||[],
    cities:cities.results||[]
  });
}

async function handleHealth(env: Env) {
  if (!env.DB) return json({ ok:false, service:"carejoys", database:"not_configured" }, { status:503 });
  try {
    const tables = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name").all<{name:string}>();
    const caregiverCount = await env.DB.prepare("SELECT COUNT(*) AS count FROM caregivers").first<{count:number}>();
    const duplicateCaregiverEmails = await env.DB.prepare("SELECT COUNT(*) AS count FROM (SELECT lower(trim(email)) AS email_key FROM caregivers WHERE email IS NOT NULL AND trim(email)!='' GROUP BY lower(trim(email)) HAVING COUNT(*)>1)").first<{count:number}>();
    const profilePhotoCount = await env.DB.prepare("SELECT COUNT(*) AS count FROM caregiver_profile_photos").first<{count:number}>();
    const employerCount = await env.DB.prepare("SELECT COUNT(*) AS count FROM employer_leads").first<{count:number}>();
    const schoolCount = await env.DB.prepare("SELECT COUNT(*) AS count FROM school_leads").first<{count:number}>();
    const agencyCount = await env.DB.prepare("SELECT COUNT(*) AS count FROM agencies WHERE is_active=1").first<{count:number}>();
    const matchableAgencyCount = await env.DB.prepare("SELECT COUNT(*) AS count FROM agencies WHERE is_active=1 AND caregiver_match_eligible=1").first<{count:number}>();
    const agencyOrgCount = await env.DB.prepare("SELECT COUNT(*) AS count FROM agency_organizations WHERE is_active=1").first<{count:number}>();
    const agencyMatchCount = await env.DB.prepare("SELECT COUNT(*) AS count FROM agency_org_candidate_matches").first<{count:number}>();
    const agencyDomainCount = await env.DB.prepare("SELECT COUNT(*) AS count FROM agency_organizations WHERE is_active=1 AND primary_domain IS NOT NULL AND primary_domain!=''").first<{count:number}>();
    const enrichedAgencyCount = await env.DB.prepare("SELECT COUNT(*) AS count FROM agency_organizations WHERE is_active=1 AND last_enriched_at IS NOT NULL").first<{count:number}>();
    const trainingProgramCount = await env.DB.prepare("SELECT COUNT(*) AS count FROM training_programs WHERE is_active=1").first<{count:number}>();
    const trainingOrgCount = await env.DB.prepare("SELECT COUNT(*) AS count FROM training_organizations WHERE is_active=1").first<{count:number}>();
    const referralLinkCount = await env.DB.prepare("SELECT COUNT(*) AS count FROM school_referral_codes WHERE status='active'").first<{count:number}>();
    const schoolOutreachCount = await env.DB.prepare("SELECT COUNT(*) AS count FROM training_program_outreach WHERE event_type='school_intro'").first<{count:number}>();
    const claimedProgramCount = await env.DB.prepare("SELECT COUNT(*) AS count FROM training_programs WHERE claimed_school_lead_id IS NOT NULL").first<{count:number}>();
    const caregiverJobCount = await env.DB.prepare("SELECT COUNT(*) AS count FROM caregiver_jobs WHERE is_published=1 AND status='current'").first<{count:number}>();
    const scannedJobSourceCount = await env.DB.prepare("SELECT COUNT(*) AS count FROM agency_job_scan_state WHERE last_scanned_at IS NOT NULL").first<{count:number}>();
    const jobScanRows = await env.DB.prepare(`SELECT s.source_provider,s.last_status,COUNT(*) AS sources,SUM(s.jobs_seen) AS jobs_seen,SUM(s.jobs_published) AS jobs_published
      FROM agency_job_scan_state s WHERE s.last_scanned_at IS NOT NULL
      GROUP BY s.source_provider,s.last_status ORDER BY sources DESC`).all<Record<string,unknown>>();
    const jobScanSamples = await env.DB.prepare(`SELECT ao.canonical_name,ao.primary_careers_url,s.source_provider,s.last_status,s.jobs_seen,s.jobs_published,s.last_error
      FROM agency_job_scan_state s JOIN agency_organizations ao ON ao.id=s.organization_id
      WHERE s.last_scanned_at IS NOT NULL ORDER BY s.last_scanned_at DESC LIMIT 20`).all<Record<string,unknown>>();
    return json({ ok:true, service:"carejoys", database:"ready", tables:(tables.results||[]).map(r=>r.name), counts:{caregivers:Number(caregiverCount?.count||0), duplicateCaregiverEmails:Number(duplicateCaregiverEmails?.count||0), profilePhotos:Number(profilePhotoCount?.count||0), employers:Number(employerCount?.count||0), schools:Number(schoolCount?.count||0), agencies:Number(agencyCount?.count||0), matchableAgencies:Number(matchableAgencyCount?.count||0), agencyOrganizations:Number(agencyOrgCount?.count||0), agencyMatches:Number(agencyMatchCount?.count||0), agencyDomains:Number(agencyDomainCount?.count||0), enrichedAgencies:Number(enrichedAgencyCount?.count||0), publishedCaregiverJobs:Number(caregiverJobCount?.count||0), scannedJobSources:Number(scannedJobSourceCount?.count||0), trainingPrograms:Number(trainingProgramCount?.count||0), schoolReferralLinks:Number(referralLinkCount?.count||0), schoolOutreachSent:Number(schoolOutreachCount?.count||0), claimedTrainingPrograms:Number(claimedProgramCount?.count||0)}, jobScanSummary:jobScanRows.results||[], jobScanSamples:jobScanSamples.results||[], timestamp:new Date().toISOString() });
  } catch (error) {
    return json({ ok:false, service:"carejoys", database:"error", error:error instanceof Error?error.message:"Database check failed" }, { status:500 });
  }
}
async function handleEmployer(request: Request, env: Env) {
  if (!env.DB || !env.EMAIL) return json({ok:false,error:"CareJoys sign-in email is not configured"},{status:503});
  const data=await readJson(request);
  if (rejectBot(data)) return json({ok:true},{status:201});
  const guard=await publicFormGuard(request,env,"employer_signup",data,8,60);
  if(guard) return guard;
  const error=requireFields(data,["companyName","contactName","email","zip","rolesNeeded"]);
  if(error) return json({ok:false,error},{status:400});
  const email=clean(data!.email,320).toLowerCase();
  if(!emailLooksValid(email)) return json({ok:false,error:"Enter a valid email address"},{status:400});
  const zip=clean(data!.zip,20);
  const rolesNeeded=clean(data!.rolesNeeded,500);
  const hiringNotes=clean(data!.hiringNotes,1500);
  const shifts=clean(data!.shifts,300);
  const payMin=Math.max(0,Number(data!.payMin||0)||0)||null;
  const payMax=Math.max(0,Number(data!.payMax||0)||0)||null;
  const transportationRequired=clean(data!.transportationRequired,20)==="yes"?1:0;
  const existing=await env.DB.prepare("SELECT id FROM employer_leads WHERE lower(email)=? AND status!='disabled' ORDER BY created_at DESC LIMIT 1").bind(email).first<{id:string}>();
  const id=existing?.id||crypto.randomUUID();
  if(existing){
    await env.DB.prepare("UPDATE employer_leads SET company_name=?,contact_name=?,phone=?,zip=?,roles_needed=?,hiring_notes=?,status='active',updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .bind(clean(data!.companyName,200),clean(data!.contactName,200),clean(data!.phone,40),zip,rolesNeeded,hiringNotes,id).run();
  }else{
    await env.DB.prepare("INSERT INTO employer_leads (id,company_name,contact_name,email,phone,zip,roles_needed,hiring_notes,status) VALUES (?,?,?,?,?,?,?,?,'active')")
      .bind(id,clean(data!.companyName,200),clean(data!.contactName,200),email,clean(data!.phone,40),zip,rolesNeeded,hiringNotes).run();
  }

  const primaryRole=(rolesNeeded.split(/[,/;|]+/).map(v=>v.trim()).find(Boolean)||"Caregiver").slice(0,80);
  const inferredState=/^2(?:0[6-9]|1\d)/.test(zip)?"MD":"";
  let opening=await env.DB.prepare(`SELECT id FROM openings
    WHERE employer_id=? AND source='employer_intake' AND role=? AND zip=? AND status='open'
      AND datetime(created_at)>datetime('now','-30 minutes')
    ORDER BY created_at DESC LIMIT 1`).bind(id,primaryRole,zip).first<{id:string}>();
  const openingId=opening?.id||crypto.randomUUID();
  if(opening){
    await env.DB.prepare("UPDATE openings SET title=?,state=?,shift_preferences=?,pay_min=?,pay_max=?,transportation_required=?,requirements=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .bind(primaryRole+" opening",inferredState,shifts,payMin,payMax,transportationRequired,hiringNotes,openingId).run();
  }else{
    await env.DB.prepare(`INSERT INTO openings
      (id,employer_id,title,role,state,zip,pay_min,pay_max,shift_preferences,transportation_required,requirements,status,source)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,'open','employer_intake')`)
      .bind(openingId,id,primaryRole+" opening",primaryRole,inferredState,zip,payMin,payMax,shifts,transportationRequired,hiringNotes).run();
  }

  const redirectPath="/app?opening="+encodeURIComponent(openingId)+"&match=1";
  await sendEmployerMagicLink(env,id,redirectPath);
  return json({ok:true,checkEmail:true,email,openingId},{status:201});
}
async function getPublicTrainingProgram(slug:string,env:Env){
  if(!env.DB)return json({ok:false,error:"Database not configured"},{status:503});
  const row=await env.DB.prepare(`SELECT tp.program_name,tp.provider_type,tp.city,tp.state,tp.zip,tp.program_type,tp.current_status,src.slug
    FROM school_referral_codes src
    JOIN training_programs tp ON tp.id=src.training_program_id
    WHERE src.slug=? AND src.status='active' AND tp.is_active=1
    LIMIT 1`).bind(slug).first<Record<string,unknown>>();
  if(!row)return json({ok:false,error:"Training program not found"},{status:404});
  return json({ok:true,program:{
    name:row.program_name,providerType:row.provider_type,city:row.city,state:row.state,zip:row.zip,
    programType:row.program_type,slug:row.slug
  }});
}

async function issueCaregiverProfilePhotoToken(env:Env,caregiverId:string){
  if(!env.DB)return null;
  const token=crypto.randomUUID()+"-"+crypto.randomUUID();
  const tokenHash=await sha256Hex(token);
  const expiresAt=new Date(Date.now()+30*60*1000).toISOString();
  await env.DB.prepare("DELETE FROM caregiver_profile_edit_tokens WHERE caregiver_id=? AND purpose='photo_upload' AND used_at IS NULL").bind(caregiverId).run();
  await env.DB.prepare("INSERT INTO caregiver_profile_edit_tokens(id,caregiver_id,token_hash,purpose,expires_at) VALUES (?,?,?,'photo_upload',?)")
    .bind(crypto.randomUUID(),caregiverId,tokenHash,expiresAt).run();
  return token;
}

function validProfileImage(type:string,bytes:Uint8Array){
  if(type==="image/jpeg")return bytes.length>=3&&bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff;
  if(type==="image/png")return bytes.length>=8&&bytes[0]===0x89&&bytes[1]===0x50&&bytes[2]===0x4e&&bytes[3]===0x47;
  if(type==="image/webp")return bytes.length>=12&&String.fromCharCode(...bytes.slice(0,4))==="RIFF"&&String.fromCharCode(...bytes.slice(8,12))==="WEBP";
  return false;
}

async function handleCaregiverProfilePhoto(request:Request,env:Env,caregiverId:string){
  if(!env.DB)return json({ok:false,error:"Database not configured"},{status:503});
  if(request.method==="GET"){
    const employer=await employerSession(request,env);
    if(!employer)return json({ok:false,error:"Sign in required"},{status:401});
    const row=await env.DB.prepare("SELECT image_blob,content_type FROM caregiver_profile_photos WHERE caregiver_id=? LIMIT 1")
      .bind(caregiverId).first<{image_blob:ArrayBuffer;content_type:string}>();
    if(!row)return json({ok:false,error:"Profile photo not found"},{status:404});
    return new Response(row.image_blob,{headers:{
      "content-type":row.content_type||"image/webp",
      "cache-control":"private,max-age=300",
      "x-content-type-options":"nosniff"
    }});
  }
  if(request.method!=="POST")return json({ok:false,error:"Method not allowed"},{status:405});
  const token=clean(request.headers.get("x-carejoys-profile-token"),300);
  if(!token)return json({ok:false,error:"Profile upload session expired"},{status:401});
  const tokenHash=await sha256Hex(token);
  const grant=await env.DB.prepare("SELECT id FROM caregiver_profile_edit_tokens WHERE caregiver_id=? AND purpose='photo_upload' AND token_hash=? AND used_at IS NULL AND datetime(expires_at)>datetime('now') LIMIT 1")
    .bind(caregiverId,tokenHash).first<{id:string}>();
  if(!grant)return json({ok:false,error:"Profile upload session expired. Submit your profile again to get a new upload session."},{status:401});
  const type=(request.headers.get("content-type")||"").split(";")[0].trim().toLowerCase();
  if(!["image/jpeg","image/png","image/webp"].includes(type))return json({ok:false,error:"Use a JPG, PNG, or WebP photo."},{status:400});
  const body=await request.arrayBuffer();
  if(body.byteLength<100||body.byteLength>180000)return json({ok:false,error:"Profile photo must be under 180 KB after resizing."},{status:400});
  const bytes=new Uint8Array(body);
  if(!validProfileImage(type,bytes))return json({ok:false,error:"That file does not look like a valid image."},{status:400});
  await env.DB.prepare(`INSERT INTO caregiver_profile_photos(caregiver_id,image_blob,content_type,byte_size)
    VALUES (?,?,?,?)
    ON CONFLICT(caregiver_id) DO UPDATE SET image_blob=excluded.image_blob,content_type=excluded.content_type,byte_size=excluded.byte_size,updated_at=CURRENT_TIMESTAMP`)
    .bind(caregiverId,body,type,body.byteLength).run();
  const photoUrl="/api/caregivers/"+encodeURIComponent(caregiverId)+"/photo";
  await env.DB.prepare("UPDATE caregivers SET profile_photo_url=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(photoUrl,caregiverId).run();
  await env.DB.prepare("UPDATE caregiver_profile_edit_tokens SET used_at=CURRENT_TIMESTAMP WHERE id=? AND used_at IS NULL").bind(grant.id).run();
  return json({ok:true,photoUrl});
}

async function handleCaregiver(request: Request, env: Env) {
  if (!env.DB) return json({ok:false,error:"Database not configured yet"},{status:503});
  const data=await readJson(request);
  if(rejectBot(data)) return json({ok:true},{status:201});
  const guard=await publicFormGuard(request,env,"caregiver_signup",data,10,60);
  if(guard) return guard;
  const error=requireFields(data,["firstName","lastName","email","phone","zip","role"]);
  if(error) return json({ok:false,error},{status:400});
  const email=clean(data!.email,320).toLowerCase();
  if(!emailLooksValid(email)) return json({ok:false,error:"Enter a valid email address"},{status:400});
  const zip=clean(data!.zip,20);
  const state=/^2(?:0[6-9]|1\d)/.test(zip)?"MD":"";
  const first=clean(data!.firstName,120);
  const last=clean(data!.lastName,120);
  const smsConsent=data!.smsConsent===true?1:0;
  const smsAt=smsConsent?new Date().toISOString():null;
  const initiallyExisting=await env.DB.prepare("SELECT id FROM caregivers WHERE lower(trim(email))=? LIMIT 1").bind(email).first<{id:string}>();
  const proposedId=initiallyExisting?.id||crypto.randomUUID();

  if(!initiallyExisting){
    await env.DB.prepare(`INSERT OR IGNORE INTO caregivers
      (id,first_name,last_name,display_name,email,phone,zip,state,role,shift_preferences,desired_wage,transportation,source,work_status,last_confirmed_at,sms_consent,sms_consent_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'organic','actively_looking',CURRENT_TIMESTAMP,?,?)`)
      .bind(proposedId,first,last,(first+" "+last).trim(),email,clean(data!.phone,40),zip,state,clean(data!.role,80),
        clean(data!.shifts,500),clean(data!.desiredWage,80),clean(data!.transportation,80),smsConsent,smsAt).run();
  }
  const canonical=await env.DB.prepare("SELECT id FROM caregivers WHERE lower(trim(email))=? LIMIT 1").bind(email).first<{id:string}>();
  const id=canonical?.id||proposedId;
  const existedBefore=!!initiallyExisting||id!==proposedId;
  await env.DB.prepare(`UPDATE caregivers SET first_name=?,last_name=?,display_name=?,phone=?,zip=?,state=CASE WHEN ?!='' THEN ? ELSE state END,
    role=?,shift_preferences=?,desired_wage=?,transportation=?,work_status='actively_looking',last_confirmed_at=CURRENT_TIMESTAMP,
    sms_consent=CASE WHEN ?=1 THEN 1 ELSE sms_consent END,
    sms_consent_at=CASE WHEN ?=1 THEN COALESCE(sms_consent_at,?) ELSE sms_consent_at END,
    is_active=1,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .bind(first,last,(first+" "+last).trim(),clean(data!.phone,40),zip,state,state,clean(data!.role,80),
      clean(data!.shifts,500),clean(data!.desiredWage,80),clean(data!.transportation,80),
      smsConsent,smsConsent,smsAt,id).run();

  const referralSlug=clean(data!.referralSlug,120);
  if(referralSlug){
    let referral=await env.DB.prepare(`SELECT src.id AS referral_id,src.training_program_id,NULL AS cohort_id
      FROM school_referral_codes src
      WHERE src.slug=? AND src.status='active' LIMIT 1`).bind(referralSlug).first<{referral_id:string;training_program_id:string;cohort_id:string|null}>();
    if(!referral){
      referral=await env.DB.prepare(`SELECT src.id AS referral_id,co.training_program_id,co.id AS cohort_id
        FROM training_program_cohorts co
        LEFT JOIN school_referral_codes src ON src.training_program_id=co.training_program_id AND src.status='active'
        WHERE co.referral_code=? AND co.status='active'
        ORDER BY src.created_at LIMIT 1`).bind(referralSlug).first<{referral_id:string;training_program_id:string;cohort_id:string|null}>();
    }
    if(referral?.referral_id){
      await env.DB.prepare("INSERT OR IGNORE INTO caregiver_referrals(id,caregiver_id,school_referral_code_id,source) VALUES (?,?,?,'school_referral')")
        .bind(crypto.randomUUID(),id,referral.referral_id).run();
      await env.DB.prepare("UPDATE caregivers SET source_training_program_id=?,source_training_cohort_id=?,source_referral_code=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
        .bind(referral.training_program_id,referral.cohort_id||null,referralSlug,id).run();
    }
  }

  const agencyResult=await scoreCaregiverAgainstAgencies(env,id);
  const caregiver=await env.DB.prepare("SELECT * FROM caregivers WHERE id=? LIMIT 1").bind(id).first<Record<string,unknown>>();
  let openingMatches=0;
  if(caregiver){
    const openings=await env.DB.prepare("SELECT * FROM openings WHERE status='open' ORDER BY updated_at DESC LIMIT 500").all<Record<string,unknown>>();
    for(const opening of openings.results||[]){
      const scored=scoreCandidate(opening,caregiver);
      if(scored.score<=0)continue;
      await env.DB.prepare(`INSERT INTO candidate_pipeline(id,opening_id,caregiver_id,stage,match_reason,match_score,source)
        VALUES (?,?,?,'matched',?,?,'caregiver_signup')
        ON CONFLICT(opening_id,caregiver_id) DO UPDATE SET
          match_reason=excluded.match_reason,match_score=excluded.match_score,updated_at=CURRENT_TIMESTAMP`)
        .bind(crypto.randomUUID(),opening.id,id,JSON.stringify(scored.reasons),scored.score).run();
      openingMatches++;
    }
  }
  const relevant=await env.DB.prepare("SELECT COUNT(*) AS count FROM agency_org_candidate_matches WHERE caregiver_id=? AND fit_score>=40")
    .bind(id).first<{count:number}>();
  const profilePhotoToken=await issueCaregiverProfilePhotoToken(env,id);
  return json({
    ok:true,id,
    matchedOrganizations:Number(relevant?.count||agencyResult.scored||0),
    matchedOpenings:openingMatches,
    marylandMatching:state==="MD",
    existing:existedBefore,
    profilePhotoToken,
    profilePhotoUrl:clean(caregiver?.profile_photo_url,500)||null
  },{status:existedBefore?200:201});
}

async function handleCaregiverResume(request:Request,env:Env){
  if(!env.DB)return json({ok:false,error:"Database not configured yet"},{status:503});
  const data=await readJson(request);
  if(rejectBot(data))return json({ok:true},{status:201});
  const authIdentity=await caregiverAuthIdentity(request,env);
  if(env.AUTH0_DOMAIN&&env.AUTH0_CLIENT_ID&&!authIdentity){
    return json({ok:false,error:"Sign in to save your CareJoys profile"},{status:401});
  }
  const guard=await publicFormGuard(request,env,"caregiver_resume",data,8,60);
  if(guard)return guard;
  const error=requireFields(data,["firstName","lastName","email","phone","zip","state","role"]);
  if(error)return json({ok:false,error},{status:400});

  const email=(authIdentity?.email||clean(data!.email,320)).toLowerCase();
  if(!emailLooksValid(email))return json({ok:false,error:"Enter a valid email address"},{status:400});
  const state=clean(data!.state,2).toUpperCase();
  if(!/^[A-Z]{2}$/.test(state))return json({ok:false,error:"Enter a valid two-letter state"},{status:400});
  const zip=clean(data!.zip,10);
  if(!/^\d{5}$/.test(zip))return json({ok:false,error:"Enter a valid 5-digit ZIP code"},{status:400});

  const authExisting=authIdentity?.sub
    ?await env.DB.prepare("SELECT id FROM caregivers WHERE auth0_sub=? LIMIT 1").bind(authIdentity.sub).first<{id:string}>()
    :null;
  const emailExisting=await env.DB.prepare("SELECT id FROM caregivers WHERE lower(trim(email))=? LIMIT 1").bind(email).first<{id:string}>();
  const initiallyExisting=authExisting||emailExisting;
  const proposedId=initiallyExisting?.id||crypto.randomUUID();

  const first=clean(data!.firstName,120);
  const last=clean(data!.lastName,120);
  const role=clean(data!.role,80)||"Caregiver";
  const certifications=clean(data!.certifications,1500);
  const specialties=clean(data!.specialties,2000);
  const languages=clean(data!.languages,1000);
  const years=Math.max(0,Math.min(60,Number(data!.yearsExperience||0)||0));
  const shifts=clean(data!.shifts,500);
  const desiredWage=clean(data!.desiredWage,80);
  const transportation=clean(data!.transportation,80);
  const travel=Math.max(0,Math.min(100,Number(data!.travelMiles||0)||0));
  const smsConsent=data!.smsConsent===true?1:0;
  const smsAt=smsConsent?new Date().toISOString():null;

  if(!initiallyExisting){
    await env.DB.prepare("INSERT OR IGNORE INTO caregivers (id,first_name,last_name,display_name,email,phone,zip,state,role,certifications,specialties,languages,years_experience,shift_preferences,desired_wage,transportation,travel_distance_miles,source,source_detail,work_status,last_confirmed_at,sms_consent,sms_consent_at,auth0_sub,auth0_email_verified) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'resume_upload','caregiver_resume','actively_looking',CURRENT_TIMESTAMP,?,?,?,?)")
      .bind(proposedId,first,last,(first+" "+last).trim(),email,clean(data!.phone,40),zip,state,role,certifications,specialties,languages,years||null,
        shifts,desiredWage,transportation,travel||null,smsConsent,smsAt,authIdentity?.sub||null,authIdentity?.emailVerified?1:0).run();
  }

  const canonical=authIdentity?.sub
    ?await env.DB.prepare("SELECT id FROM caregivers WHERE auth0_sub=? OR lower(trim(email))=? ORDER BY CASE WHEN auth0_sub=? THEN 0 ELSE 1 END LIMIT 1")
      .bind(authIdentity.sub,email,authIdentity.sub).first<{id:string}>()
    :await env.DB.prepare("SELECT id FROM caregivers WHERE lower(trim(email))=? LIMIT 1").bind(email).first<{id:string}>();
  const id=canonical?.id||proposedId;
  const existedBefore=!!initiallyExisting||id!==proposedId;

  await env.DB.prepare("UPDATE caregivers SET first_name=?,last_name=?,display_name=?,email=?,phone=?,zip=?,state=?,role=?,certifications=?,specialties=?,languages=?,years_experience=?,shift_preferences=?,desired_wage=?,transportation=?,travel_distance_miles=?,work_status='actively_looking',last_confirmed_at=CURRENT_TIMESTAMP,sms_consent=CASE WHEN ?=1 THEN 1 ELSE sms_consent END,sms_consent_at=CASE WHEN ?=1 THEN COALESCE(sms_consent_at,?) ELSE sms_consent_at END,source_detail='caregiver_resume',auth0_sub=COALESCE(?,auth0_sub),auth0_email_verified=CASE WHEN ?=1 THEN 1 ELSE auth0_email_verified END,is_active=1,updated_at=CURRENT_TIMESTAMP WHERE id=?")
    .bind(first,last,(first+" "+last).trim(),email,clean(data!.phone,40),zip,state,role,certifications,specialties,languages,years||null,
      shifts,desiredWage,transportation,travel||null,smsConsent,smsConsent,smsAt,authIdentity?.sub||null,authIdentity?.emailVerified?1:0,id).run();

  const referralSlug=clean(data!.referralSlug,120);
  if(referralSlug){
    let referral=await env.DB.prepare("SELECT src.id AS referral_id,src.training_program_id,NULL AS cohort_id FROM school_referral_codes src WHERE src.slug=? AND src.status='active' LIMIT 1")
      .bind(referralSlug).first<{referral_id:string;training_program_id:string;cohort_id:string|null}>();
    if(!referral){
      referral=await env.DB.prepare("SELECT src.id AS referral_id,co.training_program_id,co.id AS cohort_id FROM training_program_cohorts co LEFT JOIN school_referral_codes src ON src.training_program_id=co.training_program_id AND src.status='active' WHERE co.referral_code=? AND co.status='active' ORDER BY src.created_at LIMIT 1")
        .bind(referralSlug).first<{referral_id:string;training_program_id:string;cohort_id:string|null}>();
    }
    if(referral?.referral_id){
      await env.DB.prepare("INSERT OR IGNORE INTO caregiver_referrals(id,caregiver_id,school_referral_code_id,source) VALUES (?,?,?,'school_referral')")
        .bind(crypto.randomUUID(),id,referral.referral_id).run();
      await env.DB.prepare("UPDATE caregivers SET source_training_program_id=?,source_training_cohort_id=?,source_referral_code=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
        .bind(referral.training_program_id,referral.cohort_id||null,referralSlug,id).run();
    }
  }

  const agencyResult=await scoreCaregiverAgainstAgencies(env,id);
  const caregiver=await env.DB.prepare("SELECT * FROM caregivers WHERE id=? LIMIT 1").bind(id).first<Record<string,unknown>>();
  let openingMatches=0;
  if(caregiver){
    const openings=await env.DB.prepare("SELECT * FROM openings WHERE status='open' ORDER BY updated_at DESC LIMIT 500").all<Record<string,unknown>>();
    for(const opening of openings.results||[]){
      const scored=scoreCandidate(opening,caregiver);
      if(scored.score<=0)continue;
      await env.DB.prepare("INSERT INTO candidate_pipeline(id,opening_id,caregiver_id,stage,match_reason,match_score,source) VALUES (?,?,?,'matched',?,?,'resume_match') ON CONFLICT(opening_id,caregiver_id) DO UPDATE SET match_reason=excluded.match_reason,match_score=excluded.match_score,updated_at=CURRENT_TIMESTAMP")
        .bind(crypto.randomUUID(),opening.id,id,JSON.stringify(scored.reasons),scored.score).run();
      openingMatches++;
    }
  }

  await env.DB.prepare("INSERT INTO caregiver_resume_imports (id,caregiver_id,source_filename,source_mime_type,source_file_size,parser_version,detected_role,detected_certifications,detected_specialties,detected_email,detected_phone) VALUES (?,?,?,?,?,'carejoys_resume_v2',?,?,?,?,?)")
    .bind(crypto.randomUUID(),id,clean(data!.sourceFilename,240),clean(data!.sourceMimeType,120),Number(data!.sourceFileSize||0)||null,
      role,certifications,specialties,email?1:0,clean(data!.phone,40)?1:0).run();

  let targetJob:null|Record<string,unknown>=null;
  const targetJobId=clean(data!.targetJobId,120);
  if(targetJobId){
    targetJob=await env.DB.prepare("SELECT id,title,employer_name,source_url FROM caregiver_jobs WHERE id=? AND is_published=1 AND status='current' LIMIT 1")
      .bind(targetJobId).first<Record<string,unknown>>();
    if(targetJob){
      await env.DB.prepare("INSERT INTO caregiver_job_apply_events(id,caregiver_job_id,caregiver_id,event_type) VALUES (?,?,?,'profile_completed')")
        .bind(crypto.randomUUID(),targetJobId,id).run();
    }
  }

  const relevant=await env.DB.prepare("SELECT COUNT(*) AS count FROM agency_org_candidate_matches WHERE caregiver_id=? AND fit_score>=40")
    .bind(id).first<{count:number}>();
  const marylandMatching=state==="MD"||(Number(zip.slice(0,3))>=206&&Number(zip.slice(0,3))<=219);
  const profilePhotoToken=await issueCaregiverProfilePhotoToken(env,id);

  return json({
    ok:true,id,matchedOrganizations:Number(relevant?.count||agencyResult.scored||0),matchedOpenings:openingMatches,
    marylandMatching,existing:existedBefore,profilePhotoToken,profilePhotoUrl:clean(caregiver?.profile_photo_url,500)||null,
    authenticated:!!authIdentity,
    targetJob:targetJob?{id:targetJob.id,title:targetJob.title,employerName:targetJob.employer_name,applicationUrl:targetJob.source_url}:null
  },{status:existedBefore?200:201});
}

async function handlePublicJobApply(request:Request,env:Env,jobId:string){
  if(!env.DB)return json({ok:false,error:"Database not configured"},{status:503});
  const cross=rejectCrossSiteWrite(request);if(cross)return cross;
  const data=await readJson(request);
  const job=await env.DB.prepare("SELECT id,source_url FROM caregiver_jobs WHERE id=? AND is_published=1 AND status='current' LIMIT 1")
    .bind(jobId).first<Record<string,unknown>>();
  if(!job)return json({ok:false,error:"Job not found"},{status:404});
  const identity=await caregiverAuthIdentity(request,env);
  let caregiverId=clean(data?.caregiverId,120);
  if(identity?.sub){
    const row=await env.DB.prepare("SELECT id FROM caregivers WHERE auth0_sub=? OR lower(trim(email))=? ORDER BY CASE WHEN auth0_sub=? THEN 0 ELSE 1 END LIMIT 1")
      .bind(identity.sub,identity.email,identity.sub).first<{id:string}>();
    caregiverId=row?.id||caregiverId;
  }
  await env.DB.prepare("INSERT INTO caregiver_job_apply_events(id,caregiver_job_id,caregiver_id,event_type) VALUES (?,?,?,'external_redirect_clicked')")
    .bind(crypto.randomUUID(),jobId,caregiverId||null).run();
  return json({ok:true,applicationUrl:clean(job.source_url,1000)});
}

async function handleSchool(request: Request, env: Env) {
  if(!env.DB) return json({ok:false,error:"Database not configured yet"},{status:503});
  const data=await readJson(request);
  if(rejectBot(data)) return json({ok:true},{status:201});
  const guard=await publicFormGuard(request,env,"school_signup",data,8,60);
  if(guard) return guard;
  const error=requireFields(data,["organizationName","contactName","email"]);
  if(error) return json({ok:false,error},{status:400});
  const email=clean(data!.email,320).toLowerCase();
  if(!emailLooksValid(email)) return json({ok:false,error:"Enter a valid email address"},{status:400});
  const id=crypto.randomUUID();
  await env.DB.prepare("INSERT INTO school_leads (id,organization_name,contact_name,email,phone,city,state,program_types,graduating_count,notes,status) VALUES (?,?,?,?,?,?,?,?,?,?,'new')")
    .bind(id,clean(data!.organizationName,250),clean(data!.contactName,200),email,clean(data!.phone,40),clean(data!.city,120),clean(data!.state,80),clean(data!.programTypes,500),clean(data!.graduatingCount,50),clean(data!.notes,1500)).run();
  return json({ok:true,id},{status:201});
}
async function searchCandidates(url: URL, env: Env) {
  if(!env.DB) return json({ok:false,error:"Database not configured yet"},{status:503});
  const role=clean(url.searchParams.get("role"),80).toLowerCase();
  const zip=clean(url.searchParams.get("zip"),20);
  const state=clean(url.searchParams.get("state"),40).toLowerCase();
  const shift=clean(url.searchParams.get("shift"),120).toLowerCase();
  const freshness=clean(url.searchParams.get("freshness"),30);
  const result=await env.DB.prepare("SELECT id,first_name,last_name,display_name,city,state,zip,role,certifications,specialties,languages,years_experience,desired_wage,hourly_rate_min,hourly_rate_max,shift_preferences,travel_distance_miles,transportation,willing_to_drive,work_status,last_confirmed_at,source,profile_photo_url FROM caregivers WHERE is_active=1 AND (work_status='actively_looking' OR (source='legacy_carekoya' AND work_status='unknown')) ORDER BY CASE WHEN last_confirmed_at IS NULL THEN 1 ELSE 0 END, last_confirmed_at DESC LIMIT 250").all<Record<string,unknown>>();
  let rows=result.results||[];
  if(role) rows=rows.filter(c=>[clean(c.role),clean(c.certifications),clean(c.specialties)].join(" ").toLowerCase().includes(role));
  if(zip) rows=rows.filter(c=>clean(c.zip)===zip);
  if(state) rows=rows.filter(c=>clean(c.state).toLowerCase()===state);
  if(shift) rows=rows.filter(c=>clean(c.shift_preferences).toLowerCase().includes(shift));
  if(freshness==="confirmed") rows=rows.filter(c=>clean(c.work_status)==="actively_looking" && (ageDays(c.last_confirmed_at)??999)<=30);
  return json({ok:true,total:rows.length,candidates:rows.slice(0,100).map(c=>({
    id:c.id,
    name:publicName(c.first_name,c.last_name,c.display_name),
    city:c.city,state:c.state,zip:c.zip,role:c.role,certifications:c.certifications,specialties:c.specialties,languages:c.languages,
    yearsExperience:c.years_experience,desiredWage:c.desired_wage,rateMin:c.hourly_rate_min,rateMax:c.hourly_rate_max,
    shifts:c.shift_preferences,travelMiles:c.travel_distance_miles,transportation:c.transportation,willingToDrive:!!c.willing_to_drive,
    workStatus:c.work_status,lastConfirmedAt:c.last_confirmed_at,freshness:freshnessLabel(c.work_status,c.last_confirmed_at),source:c.source,profilePhotoUrl:c.profile_photo_url
  }))});
}
async function getWorkspace(id:string, env:Env) {
  const workspace=await requireWorkspace(env,id);
  if(!workspace) return json({ok:false,error:"Workspace not found"},{status:404});
  const openings=await env.DB!.prepare(`SELECT o.*,
    (SELECT COUNT(*) FROM interview_slots s WHERE s.opening_id=o.id AND s.status='available' AND datetime(s.starts_at)>datetime('now')) AS available_interview_slots
    FROM openings o WHERE o.employer_id=? ORDER BY o.created_at DESC`).bind(id).all();
  const pipelineCount=await env.DB!.prepare("SELECT COUNT(*) AS count FROM candidate_pipeline cp JOIN openings o ON o.id=cp.opening_id WHERE o.employer_id=?").bind(id).first<{count:number}>();
  return json({ok:true,workspace,openings:openings.results||[],pipelineCount:Number(pipelineCount?.count||0)});
}
async function createOpening(id:string,request:Request,env:Env) {
  const workspace=await requireWorkspace(env,id);
  if(!workspace) return json({ok:false,error:"Workspace not found"},{status:404});
  const data=await readJson(request);
  const error=requireFields(data,["title","role"]);
  if(error) return json({ok:false,error},{status:400});
  const openingId=crypto.randomUUID();
  await env.DB!.prepare("INSERT INTO openings (id,employer_id,title,role,city,state,zip,pay_min,pay_max,shift_preferences,transportation_required,requirements,status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'open')")
    .bind(openingId,id,clean(data!.title,200),clean(data!.role,80),clean(data!.city,120),clean(data!.state,80),clean(data!.zip,20),Number(data!.payMin||0)||null,Number(data!.payMax||0)||null,clean(data!.shifts,300),data!.transportationRequired===true?1:0,clean(data!.requirements,1200)).run();
  return json({ok:true,id:openingId},{status:201});
}
async function matchOpening(workspaceId:string,openingId:string,env:Env) {
  const workspace=await requireWorkspace(env,workspaceId);
  if(!workspace) return json({ok:false,error:"Workspace not found"},{status:404});
  const opening=await env.DB!.prepare("SELECT * FROM openings WHERE id=? AND employer_id=?").bind(openingId,workspaceId).first<Record<string,unknown>>();
  if(!opening) return json({ok:false,error:"Opening not found"},{status:404});
  const result=await env.DB!.prepare("SELECT * FROM caregivers WHERE is_active=1 AND (work_status='actively_looking' OR (source='legacy_carekoya' AND work_status='unknown'))").all<Record<string,unknown>>();
  const scored=(result.results||[]).map(c=>({c,...scoreCandidate(opening,c)})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score).slice(0,50);
  for(const item of scored){
    const pipelineId=crypto.randomUUID();
    await env.DB!.prepare("INSERT OR IGNORE INTO candidate_pipeline (id,opening_id,caregiver_id,stage,match_reason,match_score,source) VALUES (?,?,?,'matched',?,?, 'carejoys_match')")
      .bind(pipelineId,openingId,item.c.id,JSON.stringify(item.reasons),item.score).run();
  }
  return json({ok:true,matched:scored.length,top:scored.slice(0,10).map(x=>({id:x.c.id,name:publicName(x.c.first_name,x.c.last_name,x.c.display_name),score:x.score,reasons:x.reasons,freshness:freshnessLabel(x.c.work_status,x.c.last_confirmed_at),city:x.c.city,state:x.c.state,role:x.c.role}))});
}
async function getPipeline(workspaceId:string,url:URL,env:Env) {
  const workspace=await requireWorkspace(env,workspaceId);
  if(!workspace) return json({ok:false,error:"Workspace not found"},{status:404});
  const openingId=clean(url.searchParams.get("openingId"),80);
  let sql="SELECT cp.id,cp.opening_id,cp.stage,cp.match_score,cp.match_reason,cp.contacted_at,cp.responded_at,cp.qualified_at,cp.interview_at,cp.hired_at,o.title,o.role AS opening_role,c.id AS caregiver_id,c.first_name,c.last_name,c.display_name,c.city,c.state,c.zip,c.role,c.certifications,c.specialties,c.years_experience,c.desired_wage,c.shift_preferences,c.work_status,c.last_confirmed_at,c.profile_photo_url FROM candidate_pipeline cp JOIN openings o ON o.id=cp.opening_id JOIN caregivers c ON c.id=cp.caregiver_id WHERE o.employer_id=?";
  const args:unknown[]=[workspaceId];
  if(openingId){ sql+=" AND cp.opening_id=?"; args.push(openingId); }
  sql+=" ORDER BY cp.match_score DESC, cp.created_at DESC LIMIT 250";
  const rows=await env.DB!.prepare(sql).bind(...args).all<Record<string,unknown>>();
  return json({ok:true,pipeline:(rows.results||[]).map(r=>({...r,name:publicName(r.first_name,r.last_name,r.display_name),freshness:freshnessLabel(r.work_status,r.last_confirmed_at),profilePhotoUrl:r.profile_photo_url,first_name:undefined,last_name:undefined,display_name:undefined,profile_photo_url:undefined}))});
}
async function updatePipeline(workspaceId:string,pipelineId:string,request:Request,env:Env) {
  const workspace=await requireWorkspace(env,workspaceId);
  if(!workspace) return json({ok:false,error:"Workspace not found"},{status:404});
  const data=await readJson(request);
  const stage=clean(data?.stage,40);
  const allowed=["matched","contacted","interested","qualified","interview","hired","rejected"];
  if(!allowed.includes(stage)) return json({ok:false,error:"Invalid stage"},{status:400});
  const owned=await env.DB!.prepare("SELECT cp.id FROM candidate_pipeline cp JOIN openings o ON o.id=cp.opening_id WHERE cp.id=? AND o.employer_id=?").bind(pipelineId,workspaceId).first();
  if(!owned) return json({ok:false,error:"Pipeline record not found"},{status:404});
  const timestampColumn:Record<string,string>={contacted:"contacted_at",interested:"responded_at",qualified:"qualified_at",interview:"interview_at",hired:"hired_at"};
  const col=timestampColumn[stage];
  if(col) await env.DB!.prepare(`UPDATE candidate_pipeline SET stage=?, ${col}=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(stage,pipelineId).run();
  else await env.DB!.prepare("UPDATE candidate_pipeline SET stage=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(stage,pipelineId).run();
  return json({ok:true});
}



async function sha256Hex(value:string){
  const bytes=new TextEncoder().encode(value);
  const hash=await crypto.subtle.digest("SHA-256",bytes);
  return Array.from(new Uint8Array(hash)).map((b)=>b.toString(16).padStart(2,"0")).join("");
}

async function activationStats(env:Env){
  if(!env.DB) return json({ok:false,error:"Database not configured"},{status:503});
  const row=await env.DB.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN email IS NOT NULL AND email != '' THEN 1 ELSE 0 END) AS with_email, SUM(CASE WHEN phone IS NOT NULL AND phone != '' THEN 1 ELSE 0 END) AS with_phone, SUM(CASE WHEN activation_sent_at IS NOT NULL THEN 1 ELSE 0 END) AS sent, SUM(CASE WHEN activation_opened_at IS NOT NULL THEN 1 ELSE 0 END) AS opened, SUM(CASE WHEN activation_completed_at IS NOT NULL THEN 1 ELSE 0 END) AS completed, SUM(CASE WHEN work_status='actively_looking' THEN 1 ELSE 0 END) AS actively_looking, SUM(CASE WHEN work_status='not_looking' THEN 1 ELSE 0 END) AS not_looking, SUM(CASE WHEN work_status='maybe_later' THEN 1 ELSE 0 END) AS maybe_later FROM caregivers WHERE source='legacy_carekoya'").first<Record<string,unknown>>();
  return json({ok:true,stats:{
    total:Number(row?.total||0),withEmail:Number(row?.with_email||0),withPhone:Number(row?.with_phone||0),
    sent:Number(row?.sent||0),opened:Number(row?.opened||0),completed:Number(row?.completed||0),
    activelyLooking:Number(row?.actively_looking||0),notLooking:Number(row?.not_looking||0),maybeLater:Number(row?.maybe_later||0)
  }});
}

async function getActivation(url:URL,env:Env){
  if(!env.DB) return json({ok:false,error:"Database not configured"},{status:503});
  const token=clean(url.searchParams.get("token"),200);
  if(!token) return json({ok:false,error:"Activation link is missing"},{status:400});
  const tokenHash=await sha256Hex(token);
  const caregiver=await env.DB.prepare("SELECT id,first_name,display_name,city,state,zip,role,shift_preferences,desired_wage,travel_distance_miles,transportation,willing_to_drive,work_status FROM caregivers WHERE activation_token_hash=? AND source='legacy_carekoya' LIMIT 1").bind(tokenHash).first<Record<string,unknown>>();
  if(!caregiver) return json({ok:false,error:"This activation link is invalid or has already been used"},{status:404});
  await env.DB.prepare("UPDATE caregivers SET activation_opened_at=COALESCE(activation_opened_at,CURRENT_TIMESTAMP),updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(caregiver.id).run();
  return json({ok:true,caregiver:{
    firstName:caregiver.first_name||clean(caregiver.display_name).split(/\s+/)[0]||"there",
    city:caregiver.city,state:caregiver.state,zip:caregiver.zip,role:caregiver.role,
    shifts:caregiver.shift_preferences,desiredWage:caregiver.desired_wage,
    travelMiles:caregiver.travel_distance_miles,transportation:caregiver.transportation,
    willingToDrive:!!caregiver.willing_to_drive,workStatus:caregiver.work_status
  }});
}

async function completeActivation(request:Request,env:Env){
  if(!env.DB) return json({ok:false,error:"Database not configured"},{status:503});
  const data=await readJson(request);
  const token=clean(data?.token,200);
  const workStatus=clean(data?.workStatus,40);
  const allowed=["actively_looking","not_looking","maybe_later"];
  if(!token||!allowed.includes(workStatus)) return json({ok:false,error:"Choose your current work status"},{status:400});
  const tokenHash=await sha256Hex(token);
  const caregiver=await env.DB.prepare("SELECT id FROM caregivers WHERE activation_token_hash=? AND source='legacy_carekoya' LIMIT 1").bind(tokenHash).first<{id:string}>();
  if(!caregiver) return json({ok:false,error:"This activation link is invalid or has already been used"},{status:404});
  const role=clean(data?.role,80)||"Caregiver";
  const city=clean(data?.city,120)||null;
  const state=clean(data?.state,80)||null;
  const zip=clean(data?.zip,20)||null;
  const shifts=clean(data?.shifts,500)||null;
  const desiredWage=clean(data?.desiredWage,80)||null;
  const transportation=clean(data?.transportation,80)||null;
  const travelMiles=Number(data?.travelMiles||0)||null;
  const smsConsent=data?.smsConsent===true?1:0;
  const active=workStatus==="actively_looking"?1:0;
  await env.DB.prepare("UPDATE caregivers SET role=?,city=?,state=?,zip=?,shift_preferences=?,desired_wage=?,transportation=?,travel_distance_miles=?,work_status=?,last_confirmed_at=CURRENT_TIMESTAMP,sms_consent=?,sms_consent_at=?,activation_completed_at=CURRENT_TIMESTAMP,activation_token_hash=NULL,is_active=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
    .bind(role,city,state,zip,shifts,desiredWage,transportation,travelMiles,workStatus,smsConsent,smsConsent?new Date().toISOString():null,active,caregiver.id).run();
  await env.DB.prepare("INSERT INTO availability_events (id,caregiver_id,status,shift_preferences,desired_wage,travel_distance_miles,source,confirmed_at) VALUES (?,?,?,?,?,?,'caregiver_reactivation',CURRENT_TIMESTAMP)")
    .bind(crypto.randomUUID(),caregiver.id,workStatus,shifts,desiredWage,travelMiles).run();
  return json({ok:true,status:workStatus});
}


export default {
  async fetch(request:Request,env:Env):Promise<Response>{
    const url=new URL(request.url);
    if(request.method==="GET"&&url.pathname==="/sitemap.xml") return careJoysSitemap(env);
    if(request.method==="GET"&&url.pathname==="/robots.txt") return careJoysRobots();
    if(request.method==="GET"&&url.pathname==="/llms.txt") return careJoysLlms();
    const seoResponse=await publicSeoPage(request,url,env);
    if(seoResponse)return seoResponse;
    if(url.pathname==="/api/health") return handleHealth(env);
    if(request.method==="GET"&&url.pathname==="/api/public/agency-demand-summary") return handleAgencyDemandSummary(env);
    if(request.method==="GET"&&url.pathname==="/api/config") return publicConfig(env);
    if(request.method==="POST"&&url.pathname==="/api/auth/request") return requestEmployerMagicLink(request,env);
    if(request.method==="POST"&&url.pathname==="/api/auth/verify") return verifyEmployerMagicLink(request,env);
    if(request.method==="GET"&&url.pathname==="/api/session") return sessionResponse(request,env);
    if(request.method==="POST"&&url.pathname==="/api/auth/logout"){ const cross=rejectCrossSiteWrite(request);if(cross)return cross;return logoutEmployer(request,env); }
    if(request.method==="POST"&&url.pathname==="/api/employers") return handleEmployer(request,env);
    if(request.method==="POST"&&url.pathname==="/api/caregivers") return handleCaregiver(request,env);
    if(request.method==="POST"&&url.pathname==="/api/caregiver-resume") return handleCaregiverResume(request,env);
    if(request.method==="GET"&&url.pathname==="/api/public/caregiver-jobs") return getPublicCaregiverJobs(url,env);
    let publicJob=url.pathname.match(/^\/api\/public\/caregiver-jobs\/([^/]+)$/);
    if(request.method==="GET"&&publicJob) return getPublicCaregiverJob(decodeURIComponent(publicJob[1]),env);
    let publicJobApply=url.pathname.match(/^\/api\/public\/caregiver-jobs\/([^/]+)\/apply$/);
    if(request.method==="POST"&&publicJobApply) return handlePublicJobApply(request,env,decodeURIComponent(publicJobApply[1]));
    let caregiverPhoto=url.pathname.match(/^\/api\/caregivers\/([^/]+)\/photo$/);
    if((request.method==="GET"||request.method==="POST")&&caregiverPhoto){
      if(request.method==="POST"){const cross=rejectCrossSiteWrite(request);if(cross)return cross;}
      return handleCaregiverProfilePhoto(request,env,decodeURIComponent(caregiverPhoto[1]));
    }
    if(request.method==="POST"&&url.pathname==="/api/schools") return handleSchool(request,env);
    if(request.method==="GET"&&url.pathname==="/api/public/training-programs") return listPublicTrainingPrograms(url,env);
    let trainingOrg=url.pathname.match(/^\/api\/public\/training-organization\/([^/]+)$/);
    if(request.method==="GET"&&trainingOrg) return publicTrainingOrganization(decodeURIComponent(trainingOrg[1]),env);
    let schoolProgram=url.pathname.match(/^\/api\/school\/program\/([^/]+)$/);
    if(request.method==="GET"&&schoolProgram) return publicSchoolProgram(decodeURIComponent(schoolProgram[1]),env);
    if(request.method==="POST"&&url.pathname==="/api/school/claim/request"){ const cross=rejectCrossSiteWrite(request);if(cross)return cross;return requestSchoolAccess(request,env); }
    if(request.method==="POST"&&url.pathname==="/api/school/auth/verify"){ const cross=rejectCrossSiteWrite(request);if(cross)return cross;return verifySchoolMagic(request,env); }
    if(request.method==="GET"&&url.pathname==="/api/school/dashboard") return schoolDashboard(request,env);
    if(request.method==="POST"&&url.pathname==="/api/school/cohorts"){ const cross=rejectCrossSiteWrite(request);if(cross)return cross;return createSchoolCohort(request,env); }
    if(request.method==="POST"&&url.pathname==="/api/school/logout"){ const cross=rejectCrossSiteWrite(request);if(cross)return cross;return schoolLogout(request,env); }
    let publicProgram=url.pathname.match(/^\/api\/public\/training-program\/([^/]+)$/);
    if(request.method==="GET"&&publicProgram) return getPublicTrainingProgram(decodeURIComponent(publicProgram[1]),env);
    if(request.method==="GET"&&url.pathname==="/api/candidates"){
      if(!(await employerSession(request,env))) return json({ok:false,error:"Sign in required"},{status:401});
      return searchCandidates(url,env);
    }
    if(request.method==="GET"&&url.pathname==="/api/activation-stats") return activationStats(env);
    if(request.method==="GET"&&url.pathname==="/api/activate") return getActivation(url,env);
    if(request.method==="POST"&&url.pathname==="/api/activate") return completeActivation(request,env);
    if(request.method==="GET"&&url.pathname==="/api/respond") return getCandidateResponse(url,env);
    if(request.method==="POST"&&url.pathname==="/api/respond"){ const cross=rejectCrossSiteWrite(request);if(cross)return cross;return submitCandidateResponse(request,env); }
    if(request.method==="GET"&&url.pathname==="/api/agency/teaser") return getAgencyTeaser(url,env);
    if(request.method==="POST"&&url.pathname==="/api/agency/claim/request"){ const cross=rejectCrossSiteWrite(request);if(cross)return cross;return requestAgencyClaim(request,env); }
    if(request.method==="GET"&&url.pathname==="/api/agency/network") return getAgencyNetwork(request,env);
    if(request.method==="POST"&&url.pathname==="/api/agency/hiring-profile"){ const cross=rejectCrossSiteWrite(request);if(cross)return cross;return updateAgencyHiringProfile(request,env); }
    if(request.method==="POST"&&url.pathname==="/api/respond/interview"){ const cross=rejectCrossSiteWrite(request);if(cross)return cross;return bookCandidateInterview(request,env); }

    if(request.method==="GET"&&url.pathname==="/api/workspace"){
      const employer=await employerSession(request,env);
      if(!employer)return json({ok:false,error:"Sign in required"},{status:401});
      return getWorkspace(String(employer.id),env);
    }
    if(request.method==="POST"&&url.pathname==="/api/openings"){
      const cross=rejectCrossSiteWrite(request);if(cross)return cross;
      const employer=await employerSession(request,env);
      if(!employer)return json({ok:false,error:"Sign in required"},{status:401});
      return createOpening(String(employer.id),request,env);
    }
    let m=url.pathname.match(/^\/api\/openings\/([^/]+)\/match$/);
    if(request.method==="POST"&&m){
      const cross=rejectCrossSiteWrite(request);if(cross)return cross;
      const employer=await employerSession(request,env);
      if(!employer)return json({ok:false,error:"Sign in required"},{status:401});
      return matchOpening(String(employer.id),m[1],env);
    }
    m=url.pathname.match(/^\/api\/openings\/([^/]+)\/contact$/);
    if(request.method==="POST"&&m){
      const cross=rejectCrossSiteWrite(request);if(cross)return cross;
      const employer=await employerSession(request,env);
      if(!employer)return json({ok:false,error:"Sign in required"},{status:401});
      return contactMatches(request,env,String(employer.id),m[1]);
    }
    m=url.pathname.match(/^\/api\/openings\/([^/]+)\/interview-slots$/);
    if((request.method==="GET"||request.method==="POST")&&m){
      if(request.method==="POST"){const cross=rejectCrossSiteWrite(request);if(cross)return cross;}
      const employer=await employerSession(request,env);
      if(!employer)return json({ok:false,error:"Sign in required"},{status:401});
      return interviewSlots(request,env,String(employer.id),m[1]);
    }
    if(request.method==="GET"&&url.pathname==="/api/pipeline"){
      const employer=await employerSession(request,env);
      if(!employer)return json({ok:false,error:"Sign in required"},{status:401});
      return getPipeline(String(employer.id),url,env);
    }
    m=url.pathname.match(/^\/api\/pipeline\/([^/]+)$/);
    if(request.method==="PATCH"&&m){
      const cross=rejectCrossSiteWrite(request);if(cross)return cross;
      const employer=await employerSession(request,env);
      if(!employer)return json({ok:false,error:"Sign in required"},{status:401});
      return updatePipeline(String(employer.id),m[1],request,env);
    }

    if(url.pathname.startsWith("/api/")) return json({ok:false,error:"Not found"},{status:404});
    return env.ASSETS.fetch(request);
  },
  async scheduled(event:{cron?:string},env:Env,ctx:{waitUntil(promise:Promise<unknown>):void}){
    ctx.waitUntil((async()=>{
      if(event.cron==="*/5 * * * *"){
        await discoverAgencyJobsBatch(env,12);
        return;
      }
      if(event.cron==="17 * * * *"){
        await enrichAgencyBatch(env,30);
        await scoreAgencyMatches(env);
        return;
      }
      // School outreach is intentionally manual-only. No scheduled email sends.
    })());
  }
};