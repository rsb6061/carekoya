import { hourlyPayFloor } from './payPreferences';
import { accountSession, accountStatus, closeAccountSide, signedInHome, employerAccountCookie, finishGoogleSignIn, googleSignInConfigured, hiringSession, logoutEverywhere, requestLogin, saveLastDashboard, startGoogleSignIn, verifyLogin } from './accountAuth';
import { type EmailBinding } from './email';
import { homeStats, homeStatsResponse } from './homeStats';
import { previewPublicJobs, caregiverAlertSettings, setInitialJobAlertOptIn, sendWeeklyJobDigests } from './jobAlerts';
import { sendSchoolPlacementInvites } from './schoolOutreach';
import { linkWorkerSignup, recordWorkerJobActivity } from './workerFunnel';
import { cnaClasses, gnaJobs, localArea, CITY_PAGE_MIN_JOBS, CNA_PAGE_MIN_JOBS, JOBS_PER_PAGE, STATE_PAGE_MIN_JOBS, SUPPLY_MIN_SHOWN, localCaregiverSupply, fitTitle, metroJobStats, metroJobStatsHtml, metroOfPlace, metroTotals, jobsNearTrainingProgram, stateHiringHtml, stateHiringStats, hubLocations, jobPageContext, jobPageTitle, jobPostingJsonLd, jobsHub, nationalJobsHub, payText, resolveJobsSearch, trimAtWord } from './seo';
import { jobsHubPath, parseJobsHubPath, slugify, usState } from './usStates';
import { NURSE_AIDE_REGISTRIES, REGISTRIES_CHECKED, REGISTRY_PATH } from './nurseAideRegistries';
import { agencyJobs, agencyJobsFeed, agencySuggestions, searchAgencies, startAgencyClaim, updateAgencyJob } from './agencySelfServe';
import { publicFormGuard, sendEmployerMagicLink, requestEmployerMagicLink, verifyEmployerMagicLink, startEmployerSession, employerSessionCookie, employerSession, employerOwnsWorkspace, publicConfig, contactMatches, interviewSlots, getCandidateResponse, submitCandidateResponse, bookCandidateInterview } from './serverFeatures';
import { enrichAgencyBatch, scoreAgencyMatches, scoreCaregiverAgainstAgencies, getAgencyTeaser, requestAgencyClaim, getAgencyNetwork, updateAgencyHiringProfile, sendAgencyTeaserBatch, sendAgencyHiringInvites, hiringInviteCounts } from './agencyFeatures';
import { discoverAgencyJobsBatch, getPublicCaregiverJobs, getPublicCaregiverJob, normalizeTitle, normalizeExistingJobsBatch, repairJobCityBatch, repairJobPayBatch, unpublishNonJobsBatch, SUSPECT_PAY_SQL, recoverRejectedJobsBatch, retryFailedAgencyJobSourcesBatch } from './jobDiscovery';
import { agencyInterestResume, getAgencyInbox, updateAgencyInterest, sendProfileFromJobPage, getInterestConfirmation, confirmInterestRequest, notifyAgenciesOfInterestsBatch } from './agencyInbox';
import { handleMcp, mcpServerCard, MCP_PATH } from './mcp';
import { ageDays, freshnessLabel, scoreCandidate, commuteRadiusMiles } from './matching';
import { boundingBox, haversineMiles, lookupZip, normalizeZip, rowGeo, stateForZip, zipGeoJoin, MAX_SEARCH_MILES } from './geo';
import { approvalFor, approveEmployer, pendingApprovalResponse } from './employerApproval';
import { hasSchedule, parseOpeningSchedule, scheduleSummary } from './schedule';
import { adminEmployers, adminFromRequest, adminFunnel, outreachStatus, recordAnalyticsEvent, requestAdminMagicLink, runAdminOutreach, adminAgencySearch, sendAdminAgencyTest, sendAdminOutreachTest } from './admin';
import { runReactivationReminders, runScheduledOutreach } from './outreach';
import { listText } from './listField';
import { summarizeJobsBatch, type AiBinding } from './jobSummary';
import { descriptionBlocks } from './jobFormat';
import { runDataForSeoJobs } from './dataforseo';
import { clarityInsights, pullClarityInsights } from './clarity';
import { billingStatus, createCheckout, createPortal, freeContacts, handleStripeWebhook, lockedIntroductions } from './billing';
import { handleUnsubscribe } from './emailPreferences';
import { HAS_INTRO_VIDEO_SQL, adminIntroVideos, employerIntroVideo, handleMyVideo, reviewIntroVideo, type StreamBinding } from './introVideo';
import { adminApplyTest, adminJobSites, continueApplyAgent, handleMyResume, saveResumeFile, startApplyAgent } from './applyAgent';
import { resumeDownload } from './resumeFile';
import { parseChecklist } from './checklist';
import { handleEmailTemplates } from './emailTemplates';
import { EMAIL_SUB_PREFIX, applyWithProfile, parseAvailability, auth0SubOf, availabilityByDay, bookInviteInterview, caregiverForIdentity, getCaregiverDashboard, nearbyJobsFor, respondToInvite, updateCaregiverAvailability, updateCaregiverPreferences, updateCaregiverProfile } from './caregiverApi';
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
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  ADMIN_EMAILS?: string;
  ADMIN_TOKEN?: string;
  OUTREACH_ENABLED?: string;
  REACTIVATION_DAILY_CAP?: string;
  REACTIVATION_REMINDER_ENABLED?: string;
  WEEKLY_DIGEST_ENABLED?: string;
  AGENCY_TEASER_DAILY_CAP?: string;
  AGENCY_HIRING_INVITES_ENABLED?: string;
  AGENCY_HIRING_INVITE_DAILY_CAP?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_PRICE_ID?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  FREE_CONTACTS?: string;
  DATAFORSEO_LOGIN?: string;
  DATAFORSEO_PASSWORD?: string;
  CLARITY_PROJECT_ID?: string;
  CLARITY_API_TOKEN?: string;
  GOOGLE_SITE_VERIFICATION?: string;
  BING_SITE_VERIFICATION?: string;
  BROWSER?: unknown;
  AI?: AiBinding;
  JOB_SUMMARY_MODEL?: string;
  STREAM?: StreamBinding;
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

/** The signed-in caregiver identity: the CareJoys account session (email link or Google). */
async function caregiverAuthIdentity(request:Request,env:Env){
  const account=await accountSession(request,env);
  return account?{sub:EMAIL_SUB_PREFIX+account.email,email:account.email,emailVerified:true,name:""}:null;
}

type WorkerCtx={waitUntil(promise:Promise<unknown>):void};
/** Background work when the runtime gives us a context; awaited inline otherwise (tests, local scripts). */
async function runAfterResponse(ctx:WorkerCtx|undefined,work:Promise<unknown>){
  const guarded=work.catch(error=>console.error("background task failed",error));
  if(ctx)ctx.waitUntil(guarded);else await guarded;
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
const DEFAULT_OG_IMAGE="/og/carejoys.png";
const htmlEscape=(value:unknown)=>String(value??"").replace(/[&<>"']/g,(ch)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]||ch));
const htmlEntityDecode=(value:unknown)=>String(value??"")
  .replace(/&#x([0-9a-f]+);/gi,(_,hex)=>String.fromCodePoint(parseInt(hex,16)))
  .replace(/&#(\d+);/g,(_,num)=>String.fromCodePoint(parseInt(num,10)))
  .replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&nbsp;/g," ");
const xmlEscape=(value:unknown)=>htmlEscape(value);

// Bump when the static marketing pages change so crawlers see a fresh lastmod.
const STATIC_CONTENT_UPDATED="2026-10-02";
const SITEMAP_JOBS_PER_FILE=5000;
type SitemapEntry={url:string;lastmod?:string|null};

function sitemapXml(entries:SitemapEntry[]){
  const xml=entries.map(entry=>"<url><loc>"+xmlEscape(entry.url)+"</loc>"+(entry.lastmod?"<lastmod>"+xmlEscape(String(entry.lastmod).slice(0,10))+"</lastmod>":"")+"</url>").join("");
  return new Response('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+xml+"</urlset>",{
    headers:{"content-type":"application/xml; charset=utf-8","cache-control":"public,max-age=900"}
  });
}

/** `/sitemap.xml` is an index; each child file covers one kind of page so job growth never pushes past the 50k-URL limit. */
async function careJoysSitemap(env:Env){
  const children=["/sitemaps/pages.xml","/sitemaps/locations.xml","/sitemaps/training.xml"];
  if(env.DB){
    const count=Number((await env.DB.prepare("SELECT COUNT(*) AS count FROM caregiver_jobs WHERE is_published=1 AND status='current'").first<{count:number}>())?.count||0);
    for(let i=1;i<=Math.max(1,Math.ceil(count/SITEMAP_JOBS_PER_FILE));i++)children.push("/sitemaps/jobs-"+i+".xml");
  }
  const xml=children.map(path=>"<sitemap><loc>"+xmlEscape(SEO_ORIGIN+path)+"</loc></sitemap>").join("");
  return new Response('<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+xml+"</sitemapindex>",{
    headers:{"content-type":"application/xml; charset=utf-8","cache-control":"public,max-age=900"}
  });
}

async function careJoysChildSitemap(env:Env,name:string){
  if(name==="pages"){
    const entries:SitemapEntry[]=[
      {url:SEO_ORIGIN+"/"},
      {url:SEO_ORIGIN+"/about"},
      {url:SEO_ORIGIN+"/pricing"},
      {url:SEO_ORIGIN+"/hire-caregivers"},
      {url:SEO_ORIGIN+"/hire-caregivers/maryland"},
      {url:SEO_ORIGIN+"/caregiver-resume"},
      {url:SEO_ORIGIN+"/resources/how-to-become-a-caregiver-in-maryland"},
      {url:SEO_ORIGIN+REGISTRY_PATH,lastmod:REGISTRIES_CHECKED},
      {url:SEO_ORIGIN+"/agent"},
      {url:SEO_ORIGIN+"/training-programs/maryland"},
      {url:SEO_ORIGIN+"/cna-classes/baltimore"},
      {url:SEO_ORIGIN+"/gna-jobs/maryland"},
      {url:SEO_ORIGIN+"/gna-jobs/maryland/baltimore"}
    ];
    return sitemapXml(entries.map(e=>({...e,lastmod:e.lastmod||STATIC_CONTENT_UPDATED})));
  }
  if(name==="locations"){
    const {states,cities,cnaStates,cnaCities}=await hubLocations(env);
    const newest=states.map(s=>s.lastmod).filter(Boolean).sort().pop()||null;
    const entries:SitemapEntry[]=[{url:SEO_ORIGIN+"/caregiver-jobs",lastmod:newest}];
    for(const s of states){
      entries.push({url:SEO_ORIGIN+jobsHubPath(s.state),lastmod:s.lastmod});
      // /hire-caregivers/maryland is listed with the static pages.
      if(s.state.code!=="MD")entries.push({url:SEO_ORIGIN+"/hire-caregivers/"+s.state.slug,lastmod:s.lastmod});
    }
    for(const c of cities)entries.push({url:SEO_ORIGIN+jobsHubPath(c.state,c.slug),lastmod:c.lastmod});
    for(const s of cnaStates)entries.push({url:SEO_ORIGIN+jobsHubPath(s.state,'',true),lastmod:s.lastmod});
    for(const c of cnaCities)entries.push({url:SEO_ORIGIN+jobsHubPath(c.state,c.slug,true),lastmod:c.lastmod});
    return sitemapXml(entries);
  }
  if(name==="training"){
    const entries:SitemapEntry[]=[];
    if(env.DB){
      const orgs=await env.DB.prepare(`SELECT DISTINCT torg.slug,torg.updated_at
        FROM training_organizations torg
        JOIN training_programs tp ON tp.organization_id=torg.id
        WHERE torg.is_active=1 AND tp.is_active=1
          AND tp.provider_type IN ('Freestanding Program','College','High School')
        ORDER BY torg.slug`).all<{slug:string;updated_at?:string|null}>();
      for(const row of orgs.results||[])if(row.slug)entries.push({url:SEO_ORIGIN+"/training-programs/"+encodeURIComponent(row.slug),lastmod:row.updated_at||null});
    }
    return sitemapXml(entries);
  }
  const jobsPage=name.match(/^jobs-(\d+)$/);
  if(jobsPage){
    const page=Math.max(1,Number(jobsPage[1]));
    const entries:SitemapEntry[]=[];
    if(env.DB){
      const jobs=await env.DB.prepare("SELECT id,last_seen_at FROM caregiver_jobs WHERE is_published=1 AND status='current' ORDER BY id LIMIT ? OFFSET ?")
        .bind(SITEMAP_JOBS_PER_FILE,(page-1)*SITEMAP_JOBS_PER_FILE).all<{id:string;last_seen_at?:string|null}>();
      for(const row of jobs.results||[])if(row.id)entries.push({url:SEO_ORIGIN+"/jobs/"+encodeURIComponent(row.id),lastmod:row.last_seen_at||null});
    }
    return sitemapXml(entries);
  }
  return null;
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

CareJoys is a free job-matching service for caregivers, CNAs, GNAs, HHAs and PCAs in the United States. Caregivers find nearby jobs that fit their pay, shift and commute; training programs share it free with graduates; care employers pay to be introduced to caregivers who are verified and interested. It started in Maryland and now lists caregiver jobs in more states.

## What CareJoys does
- For caregivers (always free): preview nearby caregiver jobs without a resume or contact details, create one profile, get matched by pay, shift and distance, and opt in to a weekly job email. Caregivers choose which employers see their profile.
- For caregiver training programs (free): give graduates a CareJoys link to local jobs and see how many create profiles, get matched and get hired.
- For care employers (home-care agencies, assisted living, senior-care communities): get introduced to local caregivers who verified their email and confirmed interest. The first introductions are free, then $35/month per location; no placement fees. Pricing: https://carejoys.com/pricing

## What CareJoys is not
- CareJoys is not a state regulator or credentialing body.
- Regulatory and training-program approval information remains attributed to the relevant state or training source.
- CareJoys is not a staffing agency; employers hire caregivers directly.
- A caregiver profile is not treated as currently available unless the caregiver verified their email and confirmed they are looking.

## Roles
CareJoys supports CNA, GNA, HHA, PCA, caregiver and related direct-care roles.

## Canonical public pages
- Home (caregiver job search): https://carejoys.com/
- Pricing for employers: https://carejoys.com/pricing
- About CareJoys: https://carejoys.com/about
- Hire caregivers in Maryland: https://carejoys.com/hire-caregivers/maryland
- Caregiver jobs (search by city, state or ZIP): https://carejoys.com/caregiver-jobs
- Caregiver jobs by state and city: https://carejoys.com/caregiver-jobs/{state} and https://carejoys.com/caregiver-jobs/{state}/{city} (for example /caregiver-jobs/virginia)
- Hire caregivers by state: https://carejoys.com/hire-caregivers/{state}
- Individual caregiver jobs: https://carejoys.com/jobs/{job-id}
- Caregiver resume builder and job matching: https://carejoys.com/caregiver-resume
- How to become a caregiver in Maryland: https://carejoys.com/resources/how-to-become-a-caregiver-in-maryland
- Nurse aide (CNA) registry by state, with official lookups and phone numbers: https://carejoys.com/resources/nurse-aide-registry-by-state
- Maryland caregiver training programs: https://carejoys.com/training-programs/maryland
- Individual training organizations: https://carejoys.com/training-programs/{slug}
- Sitemap: https://carejoys.com/sitemap.xml

CareJoys distinguishes regulatory training-program data from employer hiring signals and caregiver-provided profile information.

## For AI assistants (MCP)
- MCP server (Streamable HTTP, no sign-in): https://carejoys.com/api/mcp
- Setup for Claude and ChatGPT: https://carejoys.com/agent
- Server card: https://carejoys.com/.well-known/mcp/server-card.json
- Tools: search_caregiver_jobs, get_caregiver_job, find_hiring_agencies, prepare_job_interest, confirm_job_interest, get_interest_status.
- An assistant can prepare to send a caregiver's profile to agencies, but nothing is sent until the caregiver presses Send in the confirmation email CareJoys sends them.
`,{headers:{"content-type":"text/plain; charset=utf-8","cache-control":"public,max-age=3600"}});
}

// Site-owner tags, each added only when its setting is present. Clarity skips signed-in pages
// (their robots meta is "noindex,nofollow") so dashboards, inboxes and admin are never recorded.
function siteOwnerTags(env:Env,meta:SeoMeta){
  const tags:string[]=[];
  const token=(v?:string)=>(v||"").trim().replace(/[^A-Za-z0-9_-]/g,"");
  const google=token(env.GOOGLE_SITE_VERIFICATION),bing=token(env.BING_SITE_VERIFICATION),clarity=token(env.CLARITY_PROJECT_ID);
  if(google)tags.push('<meta name="google-site-verification" content="'+google+'" />');
  if(bing)tags.push('<meta name="msvalidate.01" content="'+bing+'" />');
  if(clarity&&!/nofollow/i.test(meta.robots||""))
    tags.push('<script>(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);})(window,document,"clarity","script","'+clarity+'");</script>');
  return tags.join("");
}

type SeoMeta={title:string;description:string;canonical:string;robots?:string;snapshot?:string;jsonLd?:unknown;status?:number;ogImage?:string};

async function seoAsset(request:Request,env:Env,meta:SeoMeta){
  // Error pages fetch the app shell from "/" so the status we choose is never masked by the asset layer.
  const asset=await env.ASSETS.fetch(meta.status&&meta.status>=400?new Request(new URL("/",request.url).toString(),{headers:request.headers}):request);
  const type=asset.headers.get("content-type")||"";
  if(!type.includes("text/html"))return asset;
  let body=await asset.text();
  const canonical=meta.canonical.startsWith("http")?meta.canonical:SEO_ORIGIN+meta.canonical;
  const ogImage=SEO_ORIGIN+(meta.ogImage||DEFAULT_OG_IMAGE);
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
    '<meta property="og:image" content="'+htmlEscape(ogImage)+'" />',
    '<meta property="og:image:width" content="1200" />',
    '<meta property="og:image:height" content="630" />',
    '<meta property="og:image:alt" content="CareJoys: caregivers ready to work" />',
    '<meta name="twitter:card" content="summary_large_image" />',
    '<meta name="twitter:image" content="'+htmlEscape(ogImage)+'" />',
    meta.jsonLd?'<script type="application/ld+json">'+JSON.stringify(meta.jsonLd).replace(/</g,"\\u003c")+"</script>":"",
    siteOwnerTags(env,meta)
  ].join("");
  body=body.replace("</head>",extra+"</head>");
  if(meta.snapshot)body=body.replace('<div id="root"></div>','<div id="root">'+meta.snapshot+"</div>");
  const headers=new Headers(asset.headers);
  headers.set("content-type","text/html; charset=utf-8");
  headers.set("cache-control",meta.status&&meta.status>=400?"public,max-age=60":"public,max-age=300");
  return new Response(body,{status:meta.status||asset.status,headers});
}

function pricingHtml(env:Env){
  const free=freeContacts(env);
  return '<h2>Pricing</h2><p>Searching and matching caregivers is free.'+(free?' Your first '+free+' caregiver contact'+(free===1?' is':'s are')+' free.':'')+' Contacting more caregivers after that needs a monthly CareJoys subscription.</p>';
}

async function publicSeoPage(request:Request,url:URL,env:Env){
  if(request.method!=="GET"&&request.method!=="HEAD")return null;
  // The employer form used to open as a pop-up on the homepage; old links go to its page.
  if(url.pathname==="/"&&url.searchParams.get("hire")==="1")return Response.redirect(new URL("/hire-caregivers",url).toString(),301);
  if(url.pathname==="/"){
    // The home page is for caregivers looking for work; anyone signed in goes to their own dashboard instead.
    const home=await signedInHome(request,env);
    if(home)return new Response(null,{status:302,headers:{location:home,"cache-control":"no-store"}});
    const {states:jobStates}=await hubLocations(env);
    const jobTotal=jobStates.reduce((sum,s)=>sum+s.count,0);
    const topStates=[...jobStates].sort((a,b)=>b.count-a.count).slice(0,12);
    const stats=await homeStats(env).catch(()=>null);
    const watched=stats&&stats.employersWatched>=1000?Math.floor(stats.employersWatched/1000)+'k+ ':'';
    const homeMore='<h2>How CareJoys works for caregivers</h2><ol><li>Search caregiver, CNA, HHA and PCA jobs near your ZIP code and see pay, shifts and distance first.</li>'+
      '<li>Create one free profile with your pay, shift and commute preferences. A resume is optional.</li>'+
      '<li>Get matched to better jobs and choose which employers see your profile. Optional weekly job emails.</li></ol>'+
      (jobTotal?'<h2>Caregiver jobs by state</h2><p>'+jobTotal.toLocaleString("en-US")+' current caregiver jobs from home-care agencies and senior-care employers in '+jobStates.length+' states.</p><ul>'+
        topStates.map(s=>'<li><a href="'+jobsHubPath(s.state)+'">Caregiver jobs in '+htmlEscape(s.state.name)+'</a> ('+s.count+')</li>').join("")+'</ul>':'')+
      '<h2>For caregiver training programs</h2><p>CNA/GNA programs share CareJoys free with graduates so they can find nearby jobs. <a href="/training-programs/maryland">Find your Maryland program</a></p>'+
      '<h2>For care employers</h2><p>Home-care agencies, assisted living and senior-care communities use CareJoys to meet local caregivers who verified their email and want the work. <a href="/pricing">See how it works</a></p>';
    return seoAsset(request,env,{
      title:"CNA & Caregiver Jobs Near You, Free to Apply | CareJoys",
      description:"Be first to better-paying CNA and caregiver jobs near you. CareJoys AI checks employer job pages every week and helps you apply. Free.",
      canonical:"/",
      snapshot:'<main><h1>Be first to every better-paying CNA and caregiver job near you. Let AI do the legwork.</h1><p>CareJoys finds jobs from '+watched+'home-care agencies and assisted living facilities and matches you with the best ones, automatically. Preview nearby jobs before sharing contact details or uploading a resume.</p><p>Also available in <a href="/agent">Claude and ChatGPT</a>, and as a free weekly job email.</p>'+homeMore+'<p><a href="/hire-caregivers">Hire caregivers</a> · <a href="/pricing">Pricing for employers</a> · <a href="/caregiver-jobs">Caregiver jobs by city and state</a> · <a href="/training-programs/maryland">Maryland caregiver training programs</a> · <a href="/about">About CareJoys</a></p></main>',
      jsonLd:{"@context":"https://schema.org","@graph":[
        {"@type":"WebSite","@id":SEO_ORIGIN+"/#website","url":SEO_ORIGIN+"/","name":"CareJoys","publisher":{"@id":SEO_ORIGIN+"/#organization"}},
        {"@type":"Organization","@id":SEO_ORIGIN+"/#organization","name":"CareJoys","url":SEO_ORIGIN+"/","description":"A caregiver recruiting and placement network connecting home-care and senior-care employers, caregivers, and caregiver training programs.","areaServed":{"@type":"Country","name":"United States"},"knowsAbout":["caregiver recruiting","CNA hiring","GNA hiring","HHA hiring","PCA hiring","home care staffing","caregiver training program placement"]}
      ]}
    });
  }
  if(url.pathname==="/caregiver-recruiting/maryland") return Response.redirect(SEO_ORIGIN+"/hire-caregivers/maryland",301);
  if(url.pathname==="/hire-caregivers/maryland"){
    const maryland=usState("MD")!;
    return seoAsset(request,env,{
      title:"Hire CNAs, GNAs & Caregivers in Maryland | CareJoys",
      description:"Find CNAs, GNAs, HHAs, PCAs and caregivers in Maryland. CareJoys matches local candidates, confirms interest and helps move qualified caregivers to interview.",
      canonical:"/hire-caregivers/maryland",
      snapshot:'<main><h1>Hire CNAs, GNAs and caregivers in Maryland</h1><p>Find local CNAs, GNAs, HHAs, PCAs and caregivers who are actually interested in your opening.</p><p><a href="/hire-caregivers">Hire caregivers</a> · <a href="/pricing">Pricing</a></p><h2>Caregiver hiring with current interest</h2><p>CareJoys helps Maryland home-care, senior-care and direct-care employers match local candidates by role, geography, shifts, pay preferences, transportation, experience and current availability, then confirm interest before interview.</p>'+stateHiringHtml(maryland,await stateHiringStats(env,maryland))+pricingHtml(env)+'<p><a href="/caregiver-jobs/maryland">Maryland caregiver jobs</a> · <a href="/training-programs/maryland">Maryland caregiver training programs</a> · <a href="/caregiver-jobs">Caregiver jobs in other states</a></p></main>',
      jsonLd:{"@context":"https://schema.org","@graph":[
        {"@type":"WebPage","@id":SEO_ORIGIN+"/hire-caregivers/maryland#webpage","url":SEO_ORIGIN+"/hire-caregivers/maryland","name":"Hire caregivers in Maryland","isPartOf":{"@id":SEO_ORIGIN+"/#website"},"about":{"@id":SEO_ORIGIN+"/#organization"}},
        {"@type":"Service","@id":SEO_ORIGIN+"/hire-caregivers/maryland#service","name":"Hire caregivers in Maryland","provider":{"@id":SEO_ORIGIN+"/#organization"},"areaServed":{"@type":"State","name":"Maryland"},"serviceType":"Caregiver recruiting and placement","audience":{"@type":"BusinessAudience","audienceType":"Home-care, senior-care, and direct-care employers"}}
      ]}
    });
  }
  const hireMatch=url.pathname.match(/^\/hire-caregivers\/([^/]+)\/?$/);
  const hireState=hireMatch?usState(decodeURIComponent(hireMatch[1])):null;
  if(hireMatch&&hireState&&slugify(decodeURIComponent(hireMatch[1]))===hireState.slug&&hireState.code!=="MD"){
    const stats=await stateHiringStats(env,hireState);
    const {caregivers,jobs}=stats;
    const path="/hire-caregivers/"+hireState.slug;
    return seoAsset(request,env,{
      title:"Hire Caregivers in "+hireState.name+" | CareJoys",
      description:trimAtWord("Find CNAs, HHAs, PCAs and caregivers in "+hireState.name+". CareJoys matches local candidates, confirms interest and helps move qualified caregivers to interview.",160),
      canonical:path,
      robots:caregivers>=10||jobs>=STATE_PAGE_MIN_JOBS?undefined:"noindex,follow",
      ogImage:"/og/hire-caregivers.png",
      snapshot:'<main><h1>Hire caregivers in '+htmlEscape(hireState.name)+'</h1><p>Find local CNAs, HHAs, PCAs and caregivers who are actually interested in your opening.</p><p><a href="/hire-caregivers">Hire caregivers</a> · <a href="/pricing">Pricing</a></p><h2>Caregiver hiring with current interest</h2><p>CareJoys matches local candidates by role, distance, shifts, pay preferences, transportation, experience and current availability, then confirms interest before interview.</p>'+stateHiringHtml(hireState,stats)+pricingHtml(env)+'<p>'+(jobs?'<a href="'+jobsHubPath(hireState)+'">Caregiver jobs in '+htmlEscape(hireState.name)+'</a> · ':'')+'<a href="/hire-caregivers">Post your caregiver opening</a> · <a href="/caregiver-jobs">Caregiver jobs in other states</a></p></main>',
      jsonLd:{"@context":"https://schema.org","@graph":[
        {"@type":"WebPage","url":SEO_ORIGIN+path,"name":"Hire caregivers in "+hireState.name,"isPartOf":{"@id":SEO_ORIGIN+"/#website"},"about":{"@id":SEO_ORIGIN+"/#organization"}},
        {"@type":"Service","name":"Hire caregivers in "+hireState.name,"provider":{"@id":SEO_ORIGIN+"/#organization"},"areaServed":{"@type":"State","name":hireState.name},"serviceType":"Caregiver recruiting and placement"}
      ]}
    });
  }
  if(url.pathname==="/agent"){
    return seoAsset(request,env,{
      title:"CareJoys for Claude and ChatGPT | Caregiver Jobs MCP",
      description:"Connect Claude or ChatGPT to CareJoys to search current caregiver, CNA, GNA, HHA and PCA jobs and send a caregiver's profile to home-care agencies after email confirmation.",
      canonical:"/agent",
      snapshot:'<main><h1>Use CareJoys from Claude or ChatGPT</h1><p>Add the CareJoys MCP server to your AI assistant to search current caregiver jobs at home-care agencies and send your profile to the ones you pick.</p><p>Server URL: <code>https://carejoys.com/api/mcp</code></p><p>Nothing is sent to an agency until you press Send in the email CareJoys sends you.</p></main>',
      jsonLd:{"@context":"https://schema.org","@type":"WebPage","url":SEO_ORIGIN+"/agent","name":"CareJoys for Claude and ChatGPT","isPartOf":{"@id":SEO_ORIGIN+"/#website"}}
    });
  }
  if(url.pathname==="/pricing"){
    return seoAsset(request,env,{
      title:freeContacts(env)?"Hire Caregivers: First "+freeContacts(env)+" Introductions Free | CareJoys":"Hire Caregivers for $35/Month Per Location | CareJoys",
      description:"Meet local caregivers who verified their email and want the work. For home-care agencies and assisted living: $35/month per location, no placement fees.",
      canonical:"/pricing",
      snapshot:'<main><h1>Hire caregivers who already want to work near you.</h1><p>For home-care agencies, assisted living and senior-care communities. CareJoys introduces you to local CNAs, GNAs, HHAs, PCAs and caregivers who verified their email and said they are looking. Caregivers join free through job search and Maryland CNA/GNA training programs.</p><h2>How it works</h2><ol><li>Post an opening, or claim your agency if it is already listed.</li><li>CareJoys matches caregivers by distance, shift and pay, and each one confirms interest.</li><li>You get their contact and hire directly. Interview booking is optional.</li></ol><h2>Hiring: $35/month per location</h2><p>Or $350/year.'+(freeContacts(env)?' Your first '+freeContacts(env)+' caregiver introductions are free.':'')+' No placement fees and no per-hire charges.</p><p><a href="/hire-caregivers">Start free</a> · <a href="/hire-caregivers/maryland#claim-agency">Claim your agency free</a></p></main>'
    });
  }
  if(url.pathname==="/about"){
    return seoAsset(request,env,{
      title:"About CareJoys | Free Caregiver Job Matching",
      description:"CareJoys is free job matching for caregivers, CNAs and GNAs. Training programs share it with graduates; care employers pay to meet interested local caregivers.",
      canonical:"/about",
      snapshot:'<main><h1>About CareJoys</h1><p><strong>CareJoys is a free job-matching service for caregivers, CNAs and GNAs.</strong> Caregivers find nearby jobs that fit their pay and schedule. Training programs share it free with graduates. Home-care agencies, assisted living and senior-care communities pay to be introduced to caregivers who verified their email and said they are interested.</p><h2>Who CareJoys is for</h2><ul><li>Caregivers, CNAs, GNAs, HHAs and PCAs looking for better local jobs, always free.</li><li>Caregiver training programs that want a free job resource for graduates and placement results.</li><li>Care employers hiring direct-care workers: first introductions free, then $35 a month per location, no placement fees.</li></ul><h2>What CareJoys is not</h2><p>CareJoys is not a state regulator or credentialing body. Regulatory approval, training status, employer hiring signals, and caregiver-provided information are maintained as separate sources.</p><p><a href="/caregiver-jobs">Caregiver jobs</a> · <a href="/find-caregivers">Hire caregivers</a> · <a href="/pricing">Pricing</a> · <a href="/training-programs/maryland">Maryland training programs</a> · <a href="/">CareJoys home</a></p></main>',
      jsonLd:{"@context":"https://schema.org","@type":"AboutPage","url":SEO_ORIGIN+"/about","name":"About CareJoys","about":{"@id":SEO_ORIGIN+"/#organization"},"isPartOf":{"@id":SEO_ORIGIN+"/#website"}}
    });
  }
  if(url.pathname==="/caregiver-jobs"||url.pathname==="/caregiver-jobs/"){
    const q=clean(url.searchParams.get("q"),120);
    if(q){
      // The search box: a state or city opens its page; a ZIP (or no match) stays here and the page lists what it can.
      const found=await resolveJobsSearch(env,q);
      if(found&&"path" in found)return Response.redirect(SEO_ORIGIN+found.path,302);
    }
    const page=Math.max(1,Math.floor(Number(url.searchParams.get("page")||1))||1);
    const role=clean(url.searchParams.get("role"),40);
    const data=await nationalJobsHub(env,{role,page});
    const canonical="/caregiver-jobs"+(data.page>1&&!role&&!q?"?page="+data.page:"");
    const itemList:any[]=[];
    const jobsHtml=data.jobs.map((job,index)=>{
      const title=normalizeTitle(job.title)||"Caregiver job";
      const jobUrl="/jobs/"+encodeURIComponent(String(job.id||""));
      itemList.push({"@type":"ListItem","position":(data.page-1)*JOBS_PER_PAGE+index+1,"name":title,"url":SEO_ORIGIN+jobUrl});
      const label=[job.employer_name,[job.city,job.state].filter(Boolean).join(", ")||job.zip,payText(job.pay_min,job.pay_max,job.pay_period)].filter(Boolean).join(" · ");
      return '<li><a href="'+jobUrl+'">'+htmlEscape(title)+'</a> — '+htmlEscape(label)+'</li>';
    }).join("");
    const pager=data.pages>1?'<nav aria-label="Pages">'+(data.page>1?'<a href="/caregiver-jobs'+(data.page>2?"?page="+(data.page-1):"")+'">Previous</a> ':'')+'Page '+data.page+' of '+data.pages+(data.page<data.pages?' <a href="/caregiver-jobs?page='+(data.page+1)+'">Next</a>':'')+'</nav>':'';
    const stateLinks=data.states.map(s=>'<li><a href="'+jobsHubPath(s.state)+'">Caregiver jobs in '+htmlEscape(s.state.name)+'</a> ('+s.count+')</li>').join("");
    const cityLinks=data.cities.map(c=>'<li><a href="'+jobsHubPath(c.state,c.slug)+'">Caregiver jobs in '+htmlEscape(c.city)+', '+c.state.code+'</a> ('+c.count+')</li>').join("");
    return seoAsset(request,env,{
      title:data.page>1?fitTitle("Caregiver Jobs by State and City, Page "+data.page):"Caregiver Jobs by State and City: CNA, HHA & PCA | CareJoys",
      description:trimAtWord((data.page>1?"Page "+data.page+" of "+data.pages+". ":"")+(data.total?data.total+" current caregiver jobs":"Caregiver jobs")+(data.states.length>1?" in "+data.states.length+" states":"")+". Search by city, state or ZIP, upload one resume, and apply to CNA, HHA, PCA, DSP and caregiver openings.",160),
      canonical,
      // Searches and role filters are views of this page, not pages of their own.
      robots:data.total>0&&!role&&!q?undefined:"noindex,follow",
      ogImage:"/og/caregiver-jobs.png",
      snapshot:'<main><p><a href="/">CareJoys</a> › Caregiver jobs</p><h1>Caregiver and CNA jobs near you</h1><p>Search by city, state or ZIP. Create one free profile, resume optional, and CareJoys matches you with caregiver jobs and employers near you.</p><form action="/caregiver-jobs" method="get"><input name="q" aria-label="City, state or ZIP" placeholder="City, state or ZIP"><button type="submit">Search jobs</button></form>'+(stateLinks?'<h2>Caregiver jobs by state</h2><ul>'+stateLinks+'</ul>':'')+(cityLinks?'<h2>Popular cities</h2><ul>'+cityLinks+'</ul>':'')+'<h2>Newest caregiver jobs</h2>'+(jobsHtml?'<p>'+data.total+' current opening'+(data.total===1?'':'s')+', verified from employer career pages.</p><ul>'+jobsHtml+'</ul>'+pager:'<p>CareJoys is adding verified caregiver jobs from employer career pages now. Create your free profile and we will match you as openings are confirmed.</p>')+'<p><a href="/caregiver-resume">Upload your caregiver resume</a></p></main>',
      jsonLd:{"@context":"https://schema.org","@graph":[
        {"@type":"CollectionPage","url":SEO_ORIGIN+canonical,"name":"Caregiver jobs by state and city","isPartOf":{"@id":SEO_ORIGIN+"/#website"}},
        {"@type":"BreadcrumbList","itemListElement":[
          {"@type":"ListItem","position":1,"name":"CareJoys","item":SEO_ORIGIN+"/"},
          {"@type":"ListItem","position":2,"name":"Caregiver jobs","item":SEO_ORIGIN+"/caregiver-jobs"}
        ]},
        ...(itemList.length?[{"@type":"ItemList","name":"Newest caregiver jobs","itemListElement":itemList}]:[])
      ]}
    });
  }
  const hub=parseJobsHubPath(url.pathname);
  if(hub){
    // /caregiver-jobs/... lists every caregiver job; /cna-jobs/... only jobs a CNA or GNA can apply to.
    const cna=hub.cna;
    const page=Math.max(1,Math.floor(Number(url.searchParams.get("page")||1))||1);
    const role=clean(url.searchParams.get("role"),40);
    const data=await jobsHub(env,{state:hub.state,citySlug:hub.citySlug,role,page,cna});
    if(hub.citySlug&&!data.city){
      // A town with caregiver jobs but no CNA jobs sends CNA searchers to its caregiver page.
      if(cna&&(await jobsHub(env,{state:hub.state,citySlug:hub.citySlug})).city)return Response.redirect(SEO_ORIGIN+jobsHubPath(hub.state,hub.citySlug),302);
      return seoAsset(request,env,{status:404,title:"Page not found | CareJoys",description:"This page does not exist.",canonical:jobsHubPath(hub.state),robots:"noindex,follow",
        snapshot:'<main><h1>No current caregiver jobs here.</h1><p><a href="'+jobsHubPath(hub.state)+'">Browse caregiver jobs in '+htmlEscape(hub.state.name)+'</a></p></main>'});
    }
    const isMaryland=hub.state.code==="MD";
    const metro=data.metro;
    const place=data.city?data.city+", "+hub.state.code:hub.state.name;
    const area=metro?"the "+metro.name+" area":place;
    const noun=cna?(isMaryland?"CNA and GNA jobs":"CNA jobs"):"caregiver jobs";
    const pathFor=(slug="")=>jobsHubPath(hub.state,slug,cna);
    const linkMin=cna?CNA_PAGE_MIN_JOBS:CITY_PAGE_MIN_JOBS;
    const basePath=pathFor(hub.citySlug);
    const canonical=basePath+(page>1&&!role?"?page="+page:"");
    const itemList:any[]=[];
    const jobsHtml=data.jobs.map((job,index)=>{
      const title=normalizeTitle(job.title)||"Caregiver job";
      const jobUrl="/jobs/"+encodeURIComponent(String(job.id||""));
      itemList.push({"@type":"ListItem","position":(data.page-1)*JOBS_PER_PAGE+index+1,"name":title,"url":SEO_ORIGIN+jobUrl});
      const label=[job.employer_name,[job.city,job.state].filter(Boolean).join(", ")||job.zip,payText(job.pay_min,job.pay_max,job.pay_period)].filter(Boolean).join(" · ");
      return '<li><a href="'+jobUrl+'">'+htmlEscape(title)+'</a> — '+htmlEscape(label)+'</li>';
    }).join("");
    const pager=data.pages>1?'<nav aria-label="Pages">'+(data.page>1?'<a href="'+basePath+(data.page>2?"?page="+(data.page-1):"")+'">Previous</a> ':'')+'Page '+data.page+' of '+data.pages+(data.page<data.pages?' <a href="'+basePath+'?page='+(data.page+1)+'">Next</a>':'')+'</nav>':'';
    const cityLinks=!data.city?data.cities.filter(c=>c.count>=linkMin).slice(0,40).map(c=>'<li><a href="'+pathFor(c.slug)+'">'+(cna?'CNA':'Caregiver')+' jobs in '+htmlEscape(c.city)+'</a> ('+c.count+')</li>').join(""):"";
    // Metro pages (Baltimore, Detroit, Boston) roll up suburb jobs; suburb pages link back up to them.
    // Maryland retired the GNA title on April 1, 2026; new geriatric nursing assistants are certified CNA-I.
    const gnaNote=cna&&isMaryland?'<p>GNA (now CNA-I) openings are included.</p>':'';
    const metroIntro=metro?'<p>'+(cna?(isMaryland?'Certified and geriatric nursing assistant jobs':'Certified nursing assistant jobs'):'Caregiver, CNA'+(isMaryland?', GNA':'')+', home health aide and personal care jobs')+' across '+htmlEscape(metro.area)+(data.places.length>1?', including '+data.places.filter(p=>p.slug!==metro.slug).slice(0,6).map(p=>htmlEscape(p.city)).join(', '):'')+'.</p>':'';
    const placeLinks=metro?data.places.map(p=>'<li>'+(p.count>=linkMin&&p.slug!==metro.slug?'<a href="'+pathFor(p.slug)+'">'+htmlEscape(p.city)+'</a>':htmlEscape(p.city))+': '+p.count+' job'+(p.count===1?'':'s')+'</li>').join(""):"";
    const metroStats=metro&&!role&&data.page===1?metroJobStatsHtml(metro,await metroJobStats(env,metro,cna),cna?'CNA':'Caregiver'):"";
    const parentMetro=data.city&&!metro?metroOfPlace(hub.state.code,data.city):null;
    const parentCount=parentMetro?(await metroTotals(env,hub.state.code,cna)).find(t=>t.metro===parentMetro)?.count||0:0;
    const metroUp=parentMetro&&parentCount>=linkMin?'<p><a href="'+pathFor(parentMetro.slug)+'">See all '+parentCount+' '+noun+' in the '+htmlEscape(parentMetro.name)+' area</a></p>':"";
    // Each caregiver page links to its CNA page and back. A caregiver page whose place has a CNA page leaves "CNA" to it.
    const sibling=!role?(await jobsHub(env,{state:hub.state,citySlug:hub.citySlug,cna:!cna})).total:0;
    const hasCnaPage=!cna&&sibling>=CNA_PAGE_MIN_JOBS;
    const siblingLink=cna?(sibling?'<p><a href="'+jobsHubPath(hub.state,hub.citySlug)+'">See all '+sibling+' caregiver jobs in '+htmlEscape(area)+'</a>, including home care, HHA and PCA roles.</p>':'')
      :hasCnaPage?'<p><a href="'+jobsHubPath(hub.state,hub.citySlug,true)+'">See '+sibling+' CNA'+(isMaryland?' and GNA':'')+' jobs in '+htmlEscape(area)+'</a></p>':'';
    const resources=isMaryland?'<p><a href="/gna-jobs/maryland">GNA jobs in Maryland</a> · <a href="/cna-classes/baltimore">CNA classes in Baltimore</a> · <a href="/resources/how-to-become-a-caregiver-in-maryland">How to become a caregiver in Maryland</a> · <a href="/training-programs/maryland">Maryland caregiver training programs</a></p>':'';
    // Thin pages (no jobs, filtered views, small cities) stay out of the index but still help the people who land on them.
    const indexable=!role&&data.total>=(cna?CNA_PAGE_MIN_JOBS:data.city?CITY_PAGE_MIN_JOBS:STATE_PAGE_MIN_JOBS);
    const where=metro?place+" Area":place;
    const title=data.page>1?fitTitle((cna?"CNA":"Caregiver")+" Jobs in "+place+", Page "+data.page)
      :cna?fitTitle("CNA Jobs in "+where+(isMaryland?": GNA & Nursing Assistant":": Nursing Assistant"))
      :hasCnaPage?fitTitle("Caregiver Jobs in "+where+": Home Care, HHA & PCA")
      :metro?fitTitle("CNA & Caregiver Jobs in "+where):isMaryland?fitTitle("CNA, GNA & Caregiver Jobs in "+place):fitTitle("CNA & Caregiver Jobs in "+place+": HHA & PCA");
    const h1=cna?(isMaryland?'CNA and GNA jobs in ':'CNA jobs in ')+htmlEscape(area)
      :hasCnaPage?'Caregiver jobs in '+htmlEscape(area)
      :metro?'CNA and caregiver jobs in the '+htmlEscape(metro.name)+' area':(isMaryland?'CNA, GNA and caregiver jobs in ':'CNA and caregiver jobs in ')+htmlEscape(place);
    const stateCrumb=cna?'CNA jobs in '+hub.state.name:'Caregiver jobs in '+hub.state.name;
    return seoAsset(request,env,{
      title,
      description:trimAtWord((data.page>1?"Page "+data.page+" of "+data.pages+". ":"")+(data.total?data.total+" current "+(cna?noun:"caregiver and CNA jobs")+" in "+(metro?"the "+metro.name+" area ("+metro.area+")":place)+". ":(cna?"CNA":"Caregiver")+" jobs in "+place+". ")+(cna?"Create one free profile and apply to certified nursing assistant openings at home care agencies, nursing homes and assisted living.":"Upload one resume, let CareJoys build your profile, and apply to CNA, GNA, HHA, PCA, DSP and caregiver openings."),160),
      canonical,
      robots:indexable?undefined:"noindex,follow",
      ogImage:"/og/caregiver-jobs.png",
      snapshot:'<main><p><a href="/">CareJoys</a> › <a href="/caregiver-jobs">Caregiver jobs</a> › '+(data.city?'<a href="'+pathFor()+'">'+htmlEscape(cna?stateCrumb:hub.state.name)+'</a> › '+htmlEscape(data.city):htmlEscape(cna?stateCrumb:hub.state.name))+'</p><h1>'+h1+'</h1>'+metroIntro+gnaNote+metroUp+siblingLink+'<p>Create one free profile, resume optional. CareJoys matches you with '+(cna?'CNA':'caregiver')+' jobs and employers near you.</p><p><a href="/caregiver-resume">Upload your '+(cna?'CNA':'caregiver')+' resume</a></p><h2>Current '+noun+' in '+htmlEscape(area)+'</h2>'+(jobsHtml?'<p>'+data.total+' current opening'+(data.total===1?'':'s')+', verified from employer career pages.</p><ul>'+jobsHtml+'</ul>'+pager:'<p>CareJoys is adding verified '+noun+' from employer career pages in '+htmlEscape(place)+' now. Create your free profile and we will match you as openings are confirmed.</p>')+metroStats+(placeLinks?'<h2>'+(cna?'CNA':'Caregiver')+' jobs by town in the '+htmlEscape(metro!.name)+' area</h2><ul>'+placeLinks+'</ul>':'')+(cityLinks?'<h2>'+(cna?'CNA':'Caregiver')+' jobs by city</h2><ul>'+cityLinks+'</ul>':'')+'<h2>One profile. Relevant jobs. Your choice.</h2><ol><li>Create your caregiver work profile once.</li><li>Keep your location, shifts, pay preferences and availability current.</li><li>Choose which relevant employer opportunities interest you.</li></ol>'+resources+'</main>',
      jsonLd:{"@context":"https://schema.org","@graph":[
        {"@type":"CollectionPage","url":SEO_ORIGIN+canonical,"name":(cna?"CNA":"Caregiver")+" jobs in "+place,"isPartOf":{"@id":SEO_ORIGIN+"/#website"}},
        {"@type":"BreadcrumbList","itemListElement":[
          {"@type":"ListItem","position":1,"name":"CareJoys","item":SEO_ORIGIN+"/"},
          {"@type":"ListItem","position":2,"name":"Caregiver jobs","item":SEO_ORIGIN+"/caregiver-jobs"},
          {"@type":"ListItem","position":3,"name":stateCrumb,"item":SEO_ORIGIN+pathFor()},
          ...(data.city?[{"@type":"ListItem","position":4,"name":(cna?"CNA":"Caregiver")+" jobs in "+place,"item":SEO_ORIGIN+basePath}]:[])
        ]},
        ...(itemList.length?[{"@type":"ItemList","name":"Current "+noun+" in "+place,"itemListElement":itemList}]:[])
      ]}
    });
  }
  const publicJobMatch=url.pathname.match(/^\/jobs\/([^/]+)$/);
  if(publicJobMatch&&env.DB){
    const id=decodeURIComponent(publicJobMatch[1]);
    const job=await env.DB.prepare("SELECT id,agency_organization_id,title,role,employer_name,city,state,zip,employment_type,pay_min,pay_max,pay_period,pay_currency,summary_text,source_url,date_posted,valid_through,first_seen_at,last_seen_at,last_checked_at FROM caregiver_jobs WHERE id=? AND is_published=1 AND status='current' LIMIT 1").bind(id).first<Record<string,unknown>>();
    if(job){
      const title=normalizeTitle(job.title)||"Caregiver job";
      const employer=String(job.employer_name||"Care employer");
      const location=[job.city,job.state,job.zip].filter(Boolean).join(", ");
      const summary=descriptionBlocks(String(job.summary_text||""));
      const pay=payText(job.pay_min,job.pay_max,job.pay_period);
      const state=usState(String(job.state||""));
      const hubLink=state?'<a href="'+jobsHubPath(state)+'">Caregiver jobs in '+htmlEscape(state.name)+'</a>':'<a href="/caregiver-jobs">Caregiver jobs</a>';
      const context=await jobPageContext(env,job);
      const employerHtml=context.employer?'<h2>About '+htmlEscape(context.employer.name)+'</h2><p>'+htmlEscape([context.employer.providerTypes,[context.employer.city,context.employer.state].filter(Boolean).join(", ")].filter(Boolean).join(" · "))+'</p>'+(context.employer.otherOpenJobs?'<p>'+context.employer.otherOpenJobs+' other current opening'+(context.employer.otherOpenJobs===1?'':'s')+' at this employer on CareJoys.</p>':''):'';
      const payHtml=context.payContext?'<h2>Pay for '+htmlEscape(context.payContext.role)+' jobs in '+htmlEscape(context.payContext.state)+'</h2><p>The median advertised pay across '+context.payContext.count+' current '+htmlEscape(context.payContext.role)+' jobs in '+htmlEscape(context.payContext.state)+' is $'+context.payContext.median.toFixed(2)+'/hr'+(context.payContext.position?'; this job is '+context.payContext.position+' that median.':'.')+'</p>':'';
      const similarHtml=context.similar.length?'<h2>Similar caregiver jobs nearby</h2><ul>'+context.similar.map(j=>'<li><a href="/jobs/'+encodeURIComponent(j.id)+'">'+htmlEscape(j.title)+'</a> — '+htmlEscape([j.employerName,[j.city,j.state].filter(Boolean).join(", "),j.pay,j.distanceMiles!==null?j.distanceMiles+' mi':''].filter(Boolean).join(" · "))+'</li>').join("")+'</ul>':'';
      return seoAsset(request,env,{
        title:jobPageTitle(title,employer),
        description:trimAtWord(title+" at "+employer+(location?" in "+location:"")+(pay?", "+pay:"")+". Apply through CareJoys and reuse one caregiver profile for relevant jobs.",160),
        canonical:"/jobs/"+encodeURIComponent(id),
        ogImage:"/og/caregiver-jobs.png",
        snapshot:'<main><p><a href="/">CareJoys</a> › '+hubLink+'</p><h1>'+htmlEscape(title)+'</h1><p>'+htmlEscape(employer)+(location?" · "+htmlEscape(location):"")+(pay?" · "+htmlEscape(pay):"")+'</p><p><a href="/jobs/'+encodeURIComponent(id)+'#apply">Apply</a></p>'+(summary.lead?'<h2>About this job</h2><p>'+htmlEscape(summary.lead)+'</p>'+(summary.bullets.length?'<ul>'+summary.bullets.map(b=>'<li>'+htmlEscape(b)+'</li>').join('')+'</ul>':''):'')+payHtml+employerHtml+similarHtml+'<p>Source: <a href="'+htmlEscape(job.source_url)+'" rel="nofollow">original employer listing</a></p></main>',
        jsonLd:[
          jobPostingJsonLd(job,context.employer?{primary_website:context.employer.website}:null),
          {"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[
            {"@type":"ListItem","position":1,"name":"CareJoys","item":SEO_ORIGIN+"/"},
            ...(state?[{"@type":"ListItem","position":2,"name":"Caregiver jobs in "+state.name,"item":SEO_ORIGIN+jobsHubPath(state)}]:[]),
            {"@type":"ListItem","position":state?3:2,"name":title,"item":SEO_ORIGIN+"/jobs/"+encodeURIComponent(id)}
          ]}
        ]
      });
    }
    // 410 tells search engines the listing is gone for good, so it drops out of the index quickly.
    return seoAsset(request,env,{status:410,title:"Job no longer available | CareJoys",description:"This caregiver job is no longer available. Browse current caregiver jobs.",canonical:"/jobs/"+encodeURIComponent(id),robots:"noindex,follow",snapshot:'<main><h1>This job is no longer available.</h1><p><a href="/caregiver-jobs">Browse current caregiver jobs</a></p></main>'});
  }
  // Maryland landing pages for the searches myCNAjobs doesn't rank on (see the GTM plan): GNA jobs and Baltimore CNA classes.
  if(url.pathname==="/gna-jobs"||url.pathname==="/gna-jobs/")return Response.redirect(new URL("/gna-jobs/maryland",url).toString(),301);
  if(url.pathname==="/cna-classes"||url.pathname==="/cna-classes/"||url.pathname==="/cna-classes/maryland")return Response.redirect(new URL("/training-programs/maryland",url).toString(),301);
  // Same shape as the /cna-jobs/{state}/{city} pages: /gna-jobs/maryland and /gna-jobs/maryland/{city}.
  const gnaMatch=url.pathname.match(/^\/gna-jobs\/([a-z-]+)(?:\/([a-z-]+))?\/?$/);
  if(gnaMatch){
    const area=gnaMatch[1]==="maryland"&&gnaMatch[2]!=="maryland"?localArea(gnaMatch[2]||"maryland"):null;
    const gnaPath=(slug:string)=>"/gna-jobs/maryland"+(slug==="maryland"?"":"/"+slug);
    if(!area)return seoAsset(request,env,{status:404,title:"Page not found | CareJoys",description:"This page does not exist.",canonical:"/gna-jobs/maryland",robots:"noindex,follow",snapshot:'<main><h1>Page not found.</h1><p><a href="/gna-jobs/maryland">Browse GNA jobs in Maryland</a></p></main>'});
    const data=await gnaJobs(env,area);
    const where=area.slug==="maryland"?"Maryland":"the Baltimore area";
    const jobsHtml=data.jobs.map(job=>'<li><a href="/jobs/'+encodeURIComponent(String(job.id||""))+'">'+htmlEscape(normalizeTitle(job.title)||"GNA job")+'</a> — '+htmlEscape([job.employer_name,[job.city,job.state].filter(Boolean).join(", ")||job.zip,payText(job.pay_min,job.pay_max,job.pay_period)].filter(Boolean).join(" · "))+"</li>").join("");
    const other=area.slug==="maryland"?'<a href="/gna-jobs/maryland/baltimore">GNA jobs in Baltimore</a>':'<a href="/gna-jobs/maryland">GNA jobs across Maryland</a>';
    return seoAsset(request,env,{
      title:fitTitle(area.slug==="maryland"?"GNA Jobs in Maryland: Hiring Near You":"GNA Jobs in Baltimore, MD: Hiring Now"),
      description:trimAtWord((data.total?data.total+" current GNA and CNA jobs in "+where+", checked on employer career pages, with pay shown. ":"GNA and CNA jobs in "+where+". ")+"Free profile, resume optional. Only the employers you pick see it.",160),
      canonical:gnaPath(area.slug),
      snapshot:'<main><p><a href="/">CareJoys</a> › <a href="/caregiver-jobs/maryland">Maryland caregiver jobs</a> › GNA jobs</p><h1>GNA jobs in '+htmlEscape(area.slug==="maryland"?"Maryland":"Baltimore")+'</h1><p>GNA (now CNA-I) and CNA jobs in '+where+', checked on each employer\'s own careers page, with pay shown when the employer lists it. Maryland now calls this credential CNA-I, and CNA-I holders can apply to the CNA jobs below too.</p>'+
        (jobsHtml?'<h2>Current GNA and CNA jobs in '+where+'</h2><p>'+data.total+' current opening'+(data.total===1?'':'s')+(data.gna?', '+data.gna+' listed as GNA':'')+'.</p><ul>'+jobsHtml+'</ul>':'<p>CareJoys is adding GNA jobs in '+where+' now. Create your free profile and we will email you when one is confirmed.</p>')+
        '<h2>Is GNA still a Maryland certification?</h2><p>Not as a separate title. On April 1, 2026 the Maryland Board of Nursing replaced CNA/GNA with CNA-I. If you were a GNA, your certificate became CNA-I with the same number, and you can keep working in any setting, including nursing homes. Many employers still post these jobs as GNA. Check a certification with the license verification lookup on the Maryland Board of Nursing website.</p>'+
        '<h2>Get GNA jobs by email</h2><p>Create one free CareJoys profile, resume optional. CareJoys emails you new GNA jobs near you each week, and no employer sees your profile unless you pick them. No calls, no texts.</p><p><a href="/caregiver-resume">Create your free profile</a> · '+other+' · <a href="/cna-classes/baltimore">CNA and GNA classes in Baltimore</a> · <a href="/resources/how-to-become-a-caregiver-in-maryland">How to become a CNA or GNA in Maryland</a></p></main>',
      jsonLd:{"@context":"https://schema.org","@graph":[
        {"@type":"CollectionPage","url":SEO_ORIGIN+gnaPath(area.slug),"name":"GNA jobs in "+(area.slug==="maryland"?"Maryland":"Baltimore, MD"),"isPartOf":{"@id":SEO_ORIGIN+"/#website"}},
        {"@type":"BreadcrumbList","itemListElement":[
          {"@type":"ListItem","position":1,"name":"CareJoys","item":SEO_ORIGIN+"/"},
          {"@type":"ListItem","position":2,"name":"Caregiver jobs in Maryland","item":SEO_ORIGIN+"/caregiver-jobs/maryland"},
          {"@type":"ListItem","position":3,"name":"GNA jobs","item":SEO_ORIGIN+gnaPath(area.slug)}]}
      ]}
    });
  }
  if(url.pathname==="/cna-classes/baltimore"){
    const data=await cnaClasses(env,localArea("baltimore")!);
    const list=data.programs.map(p=>'<li><a href="/training-programs/'+encodeURIComponent(p.slug)+'">'+htmlEscape(p.name)+'</a>'+(p.town?' — '+htmlEscape(p.town):'')+' · '+htmlEscape(p.credentials)+"</li>").join("");
    return seoAsset(request,env,{
      title:fitTitle("CNA Classes in Baltimore, MD: GNA Training"),
      description:trimAtWord((data.programs.length?data.programs.length+" Maryland Board-approved CNA and GNA training programs in the Baltimore area. ":"CNA and GNA training programs in the Baltimore area. ")+"Compare programs, then find caregiver jobs near you after you finish.",160),
      canonical:"/cna-classes/baltimore",
      snapshot:'<main><p><a href="/">CareJoys</a> › <a href="/training-programs/maryland">Maryland training programs</a> › Baltimore</p><h1>CNA classes in Baltimore, MD</h1><p>CNA and GNA training programs with a location in Baltimore City and the surrounding counties, from the Maryland Board of Nursing list of approved programs.</p>'+
        (list?'<h2>'+data.programs.length+' CNA and GNA training programs in the Baltimore area</h2><ul>'+list+'</ul>':'<p>CareJoys is adding Baltimore training programs now. <a href="/training-programs/maryland">Browse all Maryland programs</a>.</p>')+
        '<h2>How to choose a CNA class</h2><ol><li>Confirm the program is approved by the Maryland Board of Nursing. Since April 1, 2026, new nursing assistants certify as CNA-I, which replaced CNA/GNA and covers nursing homes too.</li><li>Ask about total cost, schedule (days, evenings, weekends) and when clinical hours happen.</li><li>Ask how many graduates pass the competency exam and where they get hired.</li></ol>'+
        '<h2>After you finish</h2><p>'+(data.jobs?'There are '+data.jobs+' current caregiver jobs in the Baltimore area on CareJoys right now. ':'')+'Create a free profile, resume optional, and CareJoys emails you new jobs near you each week.</p><p><a href="/gna-jobs/maryland/baltimore">GNA jobs in Baltimore</a> · <a href="/caregiver-jobs/maryland/baltimore">All caregiver jobs in the Baltimore area</a> · <a href="/resources/how-to-become-a-caregiver-in-maryland">How to become a CNA or GNA in Maryland</a> · <a href="/training-programs/maryland">All Maryland training programs</a></p></main>',
      jsonLd:{"@context":"https://schema.org","@graph":[
        {"@type":"CollectionPage","url":SEO_ORIGIN+"/cna-classes/baltimore","name":"CNA classes in Baltimore, MD","isPartOf":{"@id":SEO_ORIGIN+"/#website"}},
        {"@type":"ItemList","itemListElement":data.programs.slice(0,50).map((p,i)=>({"@type":"ListItem","position":i+1,"name":p.name,"url":SEO_ORIGIN+"/training-programs/"+encodeURIComponent(p.slug)}))}
      ]}
    });
  }
  if(url.pathname==="/caregiver-resume"){
    return seoAsset(request,env,{
      title:"Caregiver & CNA Resume: Example and Builder | CareJoys",
      description:"Upload your caregiver resume once. CareJoys builds your profile, asks only for missing information, and matches you with relevant caregiver jobs and employers.",
      canonical:"/caregiver-resume",
      snapshot:'<main><h1>Caregiver and CNA resume: add yours, get matched to jobs near you.</h1><p>Upload your resume once. CareJoys builds your caregiver profile, asks only for anything missing, and matches you with caregiver employers and agencies.</p><h2>Caregiver resume example</h2><p><strong>Professional summary:</strong> Compassionate caregiver with experience supporting older adults with activities of daily living, mobility, meal preparation and companionship. Reliable, patient and comfortable working in private homes.</p><h2>Caregiver resume skills</h2><p>Include skills only when they are true for you: ADLs, dementia care, bathing and dressing, transfers, Hoyer lift, gait belt, vital signs, hospice, companionship, meal preparation, medication reminders, housekeeping, transportation, CPR, BLS and First Aid.</p><h2>Caregiver resume with no experience</h2><p>Do not invent paid experience. Relevant family caregiving, volunteer work, training, certifications, dependable transportation and transferable responsibilities can be included when described accurately.</p><p><a href="/caregiver-jobs">Find caregiver jobs by city and state</a> · <a href="/training-programs/maryland">Find Maryland caregiver training programs</a></p></main>',
      jsonLd:{"@context":"https://schema.org","@graph":[
        {"@type":"WebPage","url":SEO_ORIGIN+"/caregiver-resume","name":"Caregiver Resume Builder, Example and Job Matching","isPartOf":{"@id":SEO_ORIGIN+"/#website"},"about":{"@type":"Thing","name":"Caregiver resume"}},
        {"@type":"WebApplication","name":"CareJoys Caregiver Resume Builder","url":SEO_ORIGIN+"/caregiver-resume","applicationCategory":"BusinessApplication","operatingSystem":"Web","offers":{"@type":"Offer","price":"0","priceCurrency":"USD"}}
      ]}
    });
  }
  if(url.pathname==="/resources/how-to-become-a-caregiver-in-maryland"){
    return seoAsset(request,env,{
      title:"How to Become a CNA or Caregiver in Maryland | CareJoys",
      description:"Learn the main paths into caregiver work in Maryland, including PCA and caregiver roles, CNA-I training, current certification rules, training programs and jobs.",
      canonical:"/resources/how-to-become-a-caregiver-in-maryland",
      snapshot:'<main><h1>How to become a CNA or caregiver in Maryland</h1><p>There is more than one path into caregiving. Personal-care and companion roles may use employer-based training, while certified nursing-assistant work follows Maryland Board of Nursing requirements.</p><h2>Do you need caregiver certification in Maryland?</h2><p>Not for every caregiver job. Maryland Residential Service Agencies may train staff directly or use approved outside trainers. Maryland changed its nursing-assistant framework effective April 1, 2026; new nursing-assistant applicants generally enter through the CNA-I pathway.</p><h2>Check a Maryland CNA or GNA certification</h2><p>Employers and caregivers can confirm a CNA or GNA certification with the license verification lookup on the Maryland Board of Nursing website.</p><p><a href="/training-programs/maryland">Find Maryland caregiver training programs</a> · <a href="/caregiver-jobs/maryland">Find caregiver jobs in Maryland</a></p></main>',
      jsonLd:{"@context":"https://schema.org","@type":"Article","headline":"How to Become a Caregiver in Maryland","mainEntityOfPage":SEO_ORIGIN+"/resources/how-to-become-a-caregiver-in-maryland","publisher":{"@id":SEO_ORIGIN+"/#organization"},"about":[{"@type":"Thing","name":"Caregiver careers in Maryland"},{"@type":"Thing","name":"CNA-I training"}]}
    });
  }
  if(url.pathname===REGISTRY_PATH){
    const rows=NURSE_AIDE_REGISTRIES.map(r=>{
      const contacts=r.also?[r,r.also]:[r];
      const cells=(f:(c:typeof contacts[number])=>string)=>'<td>'+contacts.map(f).join("<br>")+'</td>';
      return '<tr id="'+r.slug+'"><th scope="row">'+htmlEscape(r.name)+'</th>'
        +cells(c=>'<a href="'+htmlEscape(c.registryUrl)+'">'+htmlEscape(c.agency)+'</a>'+(c===r&&r.note?'<br>'+htmlEscape(r.note):''))
        +cells(c=>c.lookupUrl?'<a href="'+htmlEscape(c.lookupUrl)+'">'+htmlEscape(c.lookupLabel||'Lookup')+'</a>':'Contact the registry')
        +cells(c=>htmlEscape(c.phone||'See registry site'))+'</tr>';
    }).join("");
    return seoAsset(request,env,{
      title:"Nurse Aide (CNA) Registry by State: Lookups and Phone Numbers | CareJoys",
      description:"Official nurse aide registry for all 50 states and DC, with each state's CNA certification lookup and phone number. Check, renew or transfer a CNA certification.",
      canonical:REGISTRY_PATH,
      snapshot:'<main><h1>Nurse aide registry by state</h1><p>Every state keeps a registry of certified nurse aides. Use it to check a CNA certification, renew, update your name or address, or transfer your certification from another state. Below is the official registry for all 50 states and DC, with each state\'s online lookup and phone number. Links last checked '+REGISTRIES_CHECKED+'. CareJoys is not a registry or credentialing body; confirm requirements with the state.</p><table><thead><tr><th>State</th><th>Registry</th><th>Look up a certification</th><th>Phone</th></tr></thead><tbody>'+rows+'</tbody></table><h2>Transferring your CNA to another state</h2><p>Most states let a nurse aide who is active and in good standing on another state\'s registry apply to join theirs, often called reciprocity or endorsement. Apply to the registry in the state you are moving to. Rules, forms and fees differ by state.</p><p><a href="/caregiver-jobs">Find CNA and caregiver jobs near you</a> · <a href="/resources/how-to-become-a-caregiver-in-maryland">How to become a CNA in Maryland</a></p></main>',
      jsonLd:{"@context":"https://schema.org","@type":"WebPage","name":"Nurse aide registry by state","url":SEO_ORIGIN+REGISTRY_PATH,"dateModified":REGISTRIES_CHECKED,"isPartOf":{"@id":SEO_ORIGIN+"/#website"},"publisher":{"@id":SEO_ORIGIN+"/#organization"},"about":{"@type":"Thing","name":"Nurse aide registry"}}
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
      title:"CNA Classes & GNA Training in Maryland | CareJoys",
      description:"Browse Maryland caregiver training programs for CNA and GNA pathways. CareJoys connects graduates with local care employers and tracks placement outcomes.",
      canonical:"/training-programs/maryland",
      snapshot:'<main><h1>CNA classes and GNA training programs in Maryland</h1><p>Browse Maryland CNA/GNA caregiver training organizations and their approved program locations. CareJoys gives participating programs tracked graduate referral links and placement outcome reporting.</p><ul>'+links+"</ul></main>",
      jsonLd:{"@context":"https://schema.org","@type":"CollectionPage","url":SEO_ORIGIN+"/training-programs/maryland","name":"Maryland caregiver training programs","isPartOf":{"@id":SEO_ORIGIN+"/#website"}}
    });
  }
  const orgMatch=url.pathname.match(/^\/training-programs\/([^/]+)$/);
  if(orgMatch&&env.DB){
    const slug=decodeURIComponent(orgMatch[1]);
    const org=await env.DB.prepare("SELECT id,canonical_name,credential_categories,location_count FROM training_organizations WHERE slug=? AND is_active=1 LIMIT 1").bind(slug).first<Record<string,unknown>>();
    if(org){
      const rows=await env.DB.prepare("SELECT program_name,provider_type,city,state,zip,current_status,program_type FROM training_programs WHERE organization_id=? AND is_active=1 ORDER BY city,program_name").bind(org.id).all<Record<string,unknown>>();
      const programs=rows.results||[];
      const locations=programs.map(r=>"<li>"+htmlEscape(r.program_name)+" — "+htmlEscape([r.city,r.state,r.zip].filter(Boolean).join(", "))+" · "+htmlEscape(r.program_type)+
        (r.provider_type?" · "+htmlEscape(r.provider_type):"")+(r.current_status?" · "+htmlEscape(r.current_status):"")+"</li>").join("");
      const name=String(org.canonical_name||"Caregiver Training Program");
      const credentials=String(org.credential_categories||"CNA/GNA");
      // Graduates' next step: the caregiver jobs open near the program right now.
      const nearby=await jobsNearTrainingProgram(env,programs.map(r=>String(r.zip||"")));
      const near=nearby.town?" near "+htmlEscape(nearby.town):"";
      const jobsHtml=nearby.total?'<h2>Caregiver jobs'+near+' for graduates</h2><p>'+nearby.total+' current caregiver job'+(nearby.total===1?' is':'s are')+' open within 15 miles of '+htmlEscape(name)+'.</p><ul>'+
        nearby.jobs.map(j=>'<li><a href="/jobs/'+encodeURIComponent(j.id)+'">'+htmlEscape(j.title)+'</a> — '+htmlEscape([j.employerName,j.city].filter(Boolean).join(", "))+(j.pay?" · "+htmlEscape(j.pay):"")+" · "+j.miles+" mi</li>").join("")+'</ul>'
        :'<h2>Caregiver jobs for graduates</h2><p>CareJoys has no current caregiver jobs listed within 15 miles of this program yet. Graduates can browse <a href="/caregiver-jobs/maryland">all Maryland caregiver jobs</a>.</p>';
      return seoAsset(request,env,{
        title:fitTitle(name+": CNA/GNA Classes"+(nearby.town?" in "+nearby.town+", MD":"")),
        description:(name+" is a Maryland caregiver training organization with "+Number(org.location_count||rows.results?.length||1)+" active program location"+(Number(org.location_count||1)===1?"":"s")+". View "+credentials+" training and CareJoys graduate placement.").slice(0,165),
        canonical:"/training-programs/"+encodeURIComponent(slug),
        snapshot:'<main><h1>'+htmlEscape(name)+"</h1><p>Maryland caregiver training program · "+htmlEscape(credentials)+'</p><h2>Program locations</h2><ul>'+locations+'</ul>'+jobsHtml+'<p>Graduates can <a href="/caregiver-resume">upload a resume to CareJoys</a> to be matched with local employers, and read <a href="/resources/how-to-become-a-caregiver-in-maryland">how to become a caregiver in Maryland</a>.</p><p><a href="/training-programs/maryland">Browse all Maryland caregiver training programs</a></p></main>',
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
  // Renamed from /find-caregivers; old links (and their ?role=&zip= prefill) keep working.
  if(url.pathname==="/find-caregivers")return Response.redirect(new URL("/hire-caregivers"+url.search,url).toString(),301);
  if(url.pathname==="/hire-caregivers"){
    // The employer sign-up form is the main "Hire caregivers" destination, so it is a real landing page.
    return seoAsset(request,env,{title:"Hire Caregivers Near You: CNA, HHA & PCA | CareJoys",
      description:"Hire caregivers near you. Tell CareJoys who you're hiring and where, see local CNA, HHA, PCA and caregiver matches, confirm who is interested, and book interviews.",
      canonical:"/hire-caregivers",ogImage:"/og/hire-caregivers.png",
      snapshot:'<main><h1>Hire caregivers</h1><p>Tell CareJoys who you are hiring and where. CareJoys matches local CNAs, HHAs, PCAs and caregivers, confirms who is interested, and books interviews.</p><p><a href="/pricing">Pricing</a> · <a href="/caregiver-jobs">Caregiver jobs</a></p></main>'});
  }
  if(url.pathname==="/login"||url.pathname==="/signup"){
    return seoAsset(request,env,{title:(url.pathname==="/login"?"Sign in":"Create your account")+" | CareJoys",description:"Sign in to CareJoys with an email link or Google.",canonical:url.pathname,robots:"noindex,follow"});
  }
  if(url.pathname.startsWith("/app")||url.pathname.startsWith("/auth")||url.pathname.startsWith("/activate")||url.pathname.startsWith("/respond")||url.pathname.startsWith("/agency")||url.pathname.startsWith("/school-auth")||url.pathname.startsWith("/school-dashboard")||url.pathname==="/dashboard"||url.pathname.startsWith("/dashboard/")||url.pathname==="/signin"||url.pathname==="/welcome"||url.pathname==="/add-training-program"||url.pathname.startsWith("/admin")||url.pathname.startsWith("/confirm-interest")){
    return seoAsset(request,env,{title:"CareJoys",description:"CareJoys caregiver recruiting and placement workflow.",canonical:url.pathname,robots:"noindex,nofollow"});
  }
  if(url.pathname==="/schools/maryland")return Response.redirect(SEO_ORIGIN+"/training-programs/maryland",301);
  // The caregiver dashboard moved from /me; old links and emails keep working.
  if(url.pathname==="/me"||url.pathname.startsWith("/me/"))return Response.redirect(new URL("/dashboard"+url.pathname.slice(3)+url.search,url).toString(),301);
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
const phoneLooksValid = (value: string) => { const digits=value.replace(/\D/g,""); return digits.length===10||(digits.length===11&&digits.startsWith("1")); };
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
/** Signed-in employer who may see caregiver profiles, or the 401/403 to return instead. */
async function approvedEmployer(request:Request,env:Env):Promise<Record<string,unknown>|Response>{
  const employer=await employerSession(request,env);
  if(!employer)return json({ok:false,error:"Sign in required"},{status:401});
  if(!(await approvalFor(env,String(employer.id))).approved)return pendingApprovalResponse(env,String(employer.id));
  return employer;
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

/** Public liveness check: aggregate counts the deploy smoke test needs, nothing else. Details live at /api/admin/health. */
async function handlePublicHealth(env: Env) {
  if (!env.DB) return json({ ok:false, service:"carejoys", database:"not_configured" }, { status:503 });
  try {
    const row = await env.DB.prepare(`SELECT
      (SELECT COUNT(*) FROM (SELECT lower(trim(email)) FROM caregivers WHERE email IS NOT NULL AND trim(email)!='' GROUP BY lower(trim(email)) HAVING COUNT(*)>1)) AS duplicate_emails,
      (SELECT COUNT(*) FROM caregiver_jobs WHERE is_published=1 AND status='current') AS published_jobs,
      (SELECT COUNT(*) FROM agency_job_scan_state WHERE last_scanned_at IS NOT NULL) AS scanned_sources`).first<Record<string,unknown>>();
    return json({ ok:true, service:"carejoys", database:"ready", counts:{ duplicateCaregiverEmails:Number(row?.duplicate_emails||0), publishedCaregiverJobs:Number(row?.published_jobs||0), scannedJobSources:Number(row?.scanned_sources||0) }, timestamp:new Date().toISOString() });
  } catch {
    return json({ ok:false, service:"carejoys", database:"error" }, { status:500 });
  }
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
    const rejectedJobCount = await env.DB.prepare("SELECT COUNT(*) AS count FROM caregiver_jobs WHERE is_published=0 AND status='current'").first<{count:number}>();
    const missingMarylandJobCount = await env.DB.prepare("SELECT COUNT(*) AS count FROM caregiver_jobs WHERE is_published=0 AND status='current' AND publication_reason IN ('missing_maryland_evidence','missing_state_evidence')").first<{count:number}>();
    const eligibleJobSourceCount = await env.DB.prepare("SELECT COUNT(*) AS count FROM agency_organizations WHERE is_active=1 AND ((primary_careers_url IS NOT NULL AND primary_careers_url!='') OR (primary_website IS NOT NULL AND primary_website!='') OR (primary_domain IS NOT NULL AND primary_domain!=''))").first<{count:number}>();
    const unscannedJobSourceCount = await env.DB.prepare("SELECT COUNT(*) AS count FROM agency_organizations ao LEFT JOIN agency_job_scan_state s ON s.organization_id=ao.id WHERE ao.is_active=1 AND ((ao.primary_careers_url IS NOT NULL AND ao.primary_careers_url!='') OR (ao.primary_website IS NOT NULL AND ao.primary_website!='') OR (ao.primary_domain IS NOT NULL AND ao.primary_domain!='')) AND s.last_scanned_at IS NULL").first<{count:number}>();
    const discoveredCareersUrlCount = await env.DB.prepare("SELECT COUNT(*) AS count FROM agency_organizations WHERE is_active=1 AND careers_source='job_discovery' AND primary_careers_url IS NOT NULL AND primary_careers_url!=''").first<{count:number}>();
    const jobPublicationReasons = await env.DB.prepare("SELECT COALESCE(publication_reason,'legacy_unknown') AS reason,is_published,COUNT(*) AS jobs FROM caregiver_jobs WHERE status='current' GROUP BY COALESCE(publication_reason,'legacy_unknown'),is_published ORDER BY jobs DESC").all<Record<string,unknown>>();
    const jobScanRows = await env.DB.prepare(`SELECT s.source_provider,s.last_status,COUNT(*) AS sources,
        SUM(s.job_links_seen) AS job_links_seen,SUM(s.jobs_seen) AS jobs_seen,SUM(s.jobs_rejected) AS jobs_rejected,SUM(s.jobs_published) AS jobs_published
      FROM agency_job_scan_state s WHERE s.last_scanned_at IS NOT NULL
      GROUP BY s.source_provider,s.last_status ORDER BY sources DESC`).all<Record<string,unknown>>();
    const jobScanSamples = await env.DB.prepare(`SELECT ao.canonical_name,ao.primary_careers_url,s.source_provider,s.last_status,s.job_links_seen,s.jobs_seen,s.jobs_rejected,s.jobs_published,s.last_error
      FROM agency_job_scan_state s JOIN agency_organizations ao ON ao.id=s.organization_id
      WHERE s.last_scanned_at IS NOT NULL ORDER BY s.last_scanned_at DESC LIMIT 20`).all<Record<string,unknown>>();
    const jobSourceProviderCandidates = await env.DB.prepare(`SELECT provider,COUNT(*) AS sources FROM (
        SELECT CASE
          WHEN lower(primary_careers_url) LIKE '%workday%' THEN 'workday'
          WHEN lower(primary_careers_url) LIKE '%icims%' THEN 'icims'
          WHEN lower(primary_careers_url) LIKE '%paylocity%' THEN 'paylocity'
          WHEN lower(primary_careers_url) LIKE '%greenhouse%' THEN 'greenhouse'
          WHEN lower(primary_careers_url) LIKE '%lever.co%' THEN 'lever'
          WHEN lower(primary_careers_url) LIKE '%ashby%' THEN 'ashby'
          WHEN lower(primary_careers_url) LIKE '%bamboohr%' THEN 'bamboohr'
          WHEN lower(primary_careers_url) LIKE '%paycom%' THEN 'paycom'
          WHEN lower(primary_careers_url) LIKE '%ultipro%' OR lower(primary_careers_url) LIKE '%ukg%' THEN 'ukg'
          ELSE 'generic'
        END AS provider
        FROM agency_organizations
        WHERE is_active=1 AND primary_careers_url IS NOT NULL AND primary_careers_url!=''
      ) GROUP BY provider ORDER BY sources DESC`).all<Record<string,unknown>>();
    const LIVE="FROM caregiver_jobs WHERE is_published=1 AND status='current'";
    const jobQuality = await env.DB.prepare(`SELECT
        (SELECT COUNT(*) ${LIVE} AND ${SUSPECT_PAY_SQL}) AS suspect_pay_waiting_for_repair,
        (SELECT COUNT(*) ${LIVE} AND pay_min IS NULL AND pay_max IS NULL) AS no_pay,
        (SELECT COUNT(*) ${LIVE} AND COALESCE(city,'')='' AND COALESCE(zip,'')='') AS no_city_or_zip,
        (SELECT COUNT(*) ${LIVE} AND COALESCE(zip,'')!='' AND zip NOT IN (SELECT zip FROM zip_geo)) AS zip_not_mappable,
        (SELECT COUNT(*) ${LIVE} AND last_seen_at<datetime('now','-14 days')) AS not_seen_14_days,
        (SELECT COUNT(*) ${LIVE} AND valid_through IS NOT NULL AND valid_through!='' AND valid_through<date('now')) AS past_valid_through,
        (SELECT COALESCE(SUM(c-1),0) FROM (SELECT COUNT(*) AS c ${LIVE} GROUP BY agency_organization_id,lower(title),lower(COALESCE(city,'')) HAVING c>1)) AS duplicate_listings,
        (SELECT COUNT(*) ${LIVE} AND (description_text LIKE '%<p>%' OR description_text LIKE '%<br%' OR description_text LIKE '%&amp;%' OR description_text LIKE '%&#%')) AS html_in_description,
        (SELECT COUNT(*) ${LIVE} AND COALESCE(length(description_text),0)<80) AS short_description`).first<Record<string,unknown>>();
    return json({ ok:true, service:"carejoys", database:"ready", tables:(tables.results||[]).map(r=>r.name), jobQuality, counts:{caregivers:Number(caregiverCount?.count||0), duplicateCaregiverEmails:Number(duplicateCaregiverEmails?.count||0), profilePhotos:Number(profilePhotoCount?.count||0), employers:Number(employerCount?.count||0), schools:Number(schoolCount?.count||0), agencies:Number(agencyCount?.count||0), matchableAgencies:Number(matchableAgencyCount?.count||0), agencyOrganizations:Number(agencyOrgCount?.count||0), agencyMatches:Number(agencyMatchCount?.count||0), agencyDomains:Number(agencyDomainCount?.count||0), enrichedAgencies:Number(enrichedAgencyCount?.count||0), publishedCaregiverJobs:Number(caregiverJobCount?.count||0), rejectedCaregiverJobs:Number(rejectedJobCount?.count||0), missingMarylandCaregiverJobs:Number(missingMarylandJobCount?.count||0), scannedJobSources:Number(scannedJobSourceCount?.count||0), eligibleJobSources:Number(eligibleJobSourceCount?.count||0), unscannedJobSources:Number(unscannedJobSourceCount?.count||0), discoveredCareersUrls:Number(discoveredCareersUrlCount?.count||0), trainingPrograms:Number(trainingProgramCount?.count||0), schoolReferralLinks:Number(referralLinkCount?.count||0), schoolOutreachSent:Number(schoolOutreachCount?.count||0), claimedTrainingPrograms:Number(claimedProgramCount?.count||0)}, jobScanSummary:jobScanRows.results||[], jobScanSamples:jobScanSamples.results||[], jobSourceProviderCandidates:jobSourceProviderCandidates.results||[], jobPublicationReasons:jobPublicationReasons.results||[], timestamp:new Date().toISOString() });
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
  const intake:EmployerIntake={
    companyName:clean(data!.companyName,200),contactName:clean(data!.contactName,200),phone:clean(data!.phone,40),
    zip:clean(data!.zip,20),rolesNeeded:clean(data!.rolesNeeded,500),hiringNotes:clean(data!.hiringNotes,1500),shifts:clean(data!.shifts,300),schedule:clean(data!.schedule,4000),
    payMin:Math.max(0,Number(data!.payMin||0)||0)||null,payMax:Math.max(0,Number(data!.payMax||0)||0)||null,
    transportationRequired:clean(data!.transportationRequired,20)==="yes"
  };
  const existing=await env.DB.prepare("SELECT id FROM employer_leads WHERE lower(email)=? AND status!='disabled' ORDER BY created_at DESC LIMIT 1").bind(email).first<{id:string}>();
  const state=await stateForZip(env.DB,intake.zip);
  // Few or no caregivers in this state yet: set expectations in the confirmation.
  const outOfArea=!!state&&!(await env.DB.prepare(`SELECT 1 FROM caregivers c WHERE c.state=? AND ${SEARCHABLE_CAREGIVER} LIMIT 1`).bind(state).first());
  // Already signed in with this email (e.g. setting up hiring from a dashboard): the email is proven, so open the workspace now instead of emailing a link.
  const account=await accountSession(request,env);
  if(account&&account.email===email){
    let employerId=existing?.id;
    let redirect:string|null;
    if(employerId){
      redirect=await applyPendingEmployerIntake(env,employerId,{kind:"employer_intake",...intake});
    }else{
      employerId=crypto.randomUUID();
      await env.DB.prepare("INSERT INTO employer_leads (id,company_name,contact_name,email,phone,zip,roles_needed,hiring_notes,status) VALUES (?,?,?,?,?,?,?,?,'active')")
        .bind(employerId,intake.companyName,intake.contactName,email,intake.phone,intake.zip,intake.rolesNeeded,intake.hiringNotes).run();
      redirect="/app?opening="+encodeURIComponent(await createIntakeOpening(env,employerId,intake))+"&match=1";
    }
    const session=await startEmployerSession(env,employerId);
    return json({ok:true,email,outOfArea,redirect:redirect||"/app"},{status:201,headers:{"Set-Cookie":employerSessionCookie(session)}});
  }
  if(existing){
    // Anyone can type an existing employer's email, so nothing changes on that account until the emailed link is clicked.
    await sendEmployerMagicLink(env,existing.id,"/app",{kind:"employer_intake",...intake});
    return json({ok:true,checkEmail:true,email,outOfArea},{status:201});
  }
  const id=crypto.randomUUID();
  await env.DB.prepare("INSERT INTO employer_leads (id,company_name,contact_name,email,phone,zip,roles_needed,hiring_notes,status) VALUES (?,?,?,?,?,?,?,?,'active')")
    .bind(id,intake.companyName,intake.contactName,email,intake.phone,intake.zip,intake.rolesNeeded,intake.hiringNotes).run();
  const openingId=await createIntakeOpening(env,id,intake);
  await sendEmployerMagicLink(env,id,"/app?opening="+encodeURIComponent(openingId)+"&match=1");
  return json({ok:true,checkEmail:true,email,openingId,outOfArea},{status:201});
}

type EmployerIntake={companyName:string;contactName:string;phone:string;zip:string;rolesNeeded:string;hiringNotes:string;shifts:string;schedule:string;payMin:number|null;payMax:number|null;transportationRequired:boolean};

/** The schedule JSON to store and the shift words to show. A day-by-day schedule replaces typed shift words. */
function openingShift(scheduleValue:unknown,typedShifts:string){
  const schedule=parseOpeningSchedule(scheduleValue);
  if(!hasSchedule(schedule))return {scheduleJson:null,shifts:typedShifts};
  return {scheduleJson:JSON.stringify(schedule),shifts:scheduleSummary(schedule).slice(0,300)};
}

/** Creates (or refreshes, within 30 minutes) the opening an employer described in the intake form. */
async function createIntakeOpening(env:Env,employerId:string,intake:EmployerIntake){
  const primaryRole=(intake.rolesNeeded.split(/[,/;|]+/).map(v=>v.trim()).find(Boolean)||"Caregiver").slice(0,80);
  const zipInfo=await lookupZip(env.DB,intake.zip);
  const inferredState=zipInfo?.state||await stateForZip(env.DB,intake.zip);
  const inferredCity=zipInfo?.city||"";
  const opening=await env.DB!.prepare(`SELECT id FROM openings
    WHERE employer_id=? AND source='employer_intake' AND role=? AND zip=? AND status='open'
      AND datetime(created_at)>datetime('now','-30 minutes')
    ORDER BY created_at DESC LIMIT 1`).bind(employerId,primaryRole,intake.zip).first<{id:string}>();
  const openingId=opening?.id||crypto.randomUUID();
  const shift=openingShift(intake.schedule,intake.shifts);
  if(opening){
    await env.DB!.prepare("UPDATE openings SET title=?,city=COALESCE(NULLIF(?,''),city),state=?,shift_preferences=?,schedule_json=?,pay_min=?,pay_max=?,transportation_required=?,requirements=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .bind(primaryRole+" opening",inferredCity,inferredState,shift.shifts,shift.scheduleJson,intake.payMin,intake.payMax,intake.transportationRequired?1:0,intake.hiringNotes,openingId).run();
  }else{
    await env.DB!.prepare(`INSERT INTO openings
      (id,employer_id,title,role,city,state,zip,pay_min,pay_max,shift_preferences,schedule_json,transportation_required,requirements,status,source)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'open','employer_intake')`)
      .bind(openingId,employerId,primaryRole+" opening",primaryRole,inferredCity,inferredState,intake.zip,intake.payMin,intake.payMax,shift.shifts,shift.scheduleJson,intake.transportationRequired?1:0,intake.hiringNotes).run();
  }
  return openingId;
}

/** Runs when an employer clicks a link that carried a form submission: apply it now that the email is proven. */
async function applyPendingEmployerIntake(env:Env,employerId:string,raw:Record<string,unknown>){
  if(raw.kind!=="employer_intake"||!env.DB)return null;
  const intake:EmployerIntake={
    companyName:clean(raw.companyName,200),contactName:clean(raw.contactName,200),phone:clean(raw.phone,40),zip:clean(raw.zip,20),
    rolesNeeded:clean(raw.rolesNeeded,500),hiringNotes:clean(raw.hiringNotes,1500),shifts:clean(raw.shifts,300),schedule:clean(raw.schedule,4000),
    payMin:Number(raw.payMin)||null,payMax:Number(raw.payMax)||null,transportationRequired:raw.transportationRequired===true
  };
  await env.DB.prepare("UPDATE employer_leads SET company_name=COALESCE(NULLIF(?,''),company_name),contact_name=COALESCE(NULLIF(?,''),contact_name),phone=COALESCE(NULLIF(?,''),phone),zip=COALESCE(NULLIF(?,''),zip),roles_needed=COALESCE(NULLIF(?,''),roles_needed),hiring_notes=?,status='active',updated_at=CURRENT_TIMESTAMP WHERE id=?")
    .bind(intake.companyName,intake.contactName,intake.phone,intake.zip,intake.rolesNeeded,intake.hiringNotes,employerId).run();
  const openingId=await createIntakeOpening(env,employerId,intake);
  return "/app?opening="+encodeURIComponent(openingId)+"&match=1";
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

async function issueCaregiverProfilePhotoToken(env:Env,caregiverId:string,purpose:'photo_upload'|'resume_upload'='photo_upload'){
  if(!env.DB)return null;
  const token=crypto.randomUUID()+"-"+crypto.randomUUID();
  const tokenHash=await sha256Hex(token);
  const expiresAt=new Date(Date.now()+30*60*1000).toISOString();
  await env.DB.prepare("DELETE FROM caregiver_profile_edit_tokens WHERE caregiver_id=? AND purpose=? AND used_at IS NULL").bind(caregiverId,purpose).run();
  await env.DB.prepare("INSERT INTO caregiver_profile_edit_tokens(id,caregiver_id,token_hash,purpose,expires_at) VALUES (?,?,?,?,?)")
    .bind(crypto.randomUUID(),caregiverId,tokenHash,purpose,expiresAt).run();
  return token;
}

/** The resume file right after a caregiver saves their profile, authorized by the one-time upload token. */
async function handleCaregiverResumeFile(request:Request,env:Env,caregiverId:string){
  if(!env.DB)return json({ok:false,error:"Database not configured"},{status:503});
  const token=clean(request.headers.get("x-carejoys-profile-token"),300);
  const grant=token?await env.DB.prepare("SELECT id FROM caregiver_profile_edit_tokens WHERE caregiver_id=? AND purpose='resume_upload' AND token_hash=? AND used_at IS NULL AND datetime(expires_at)>datetime('now') LIMIT 1")
    .bind(caregiverId,await sha256Hex(token)).first<{id:string}>():null;
  if(!grant)return json({ok:false,error:"Resume upload session expired."},{status:401});
  const res=await saveResumeFile(request,env,caregiverId);
  if(res.ok)await env.DB.prepare("UPDATE caregiver_profile_edit_tokens SET used_at=CURRENT_TIMESTAMP WHERE id=?").bind(grant.id).run();
  return res;
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
    const employer=await approvedEmployer(request,env);
    if(employer instanceof Response)return employer;
    const row=await env.DB.prepare("SELECT image_blob,content_type FROM caregiver_profile_photos WHERE caregiver_id=? LIMIT 1")
      .bind(caregiverId).first<{image_blob:ArrayBuffer|number[];content_type:string}>();
    if(!row)return json({ok:false,error:"Profile photo not found"},{status:404});
    return new Response(new Uint8Array(row.image_blob),{headers:{
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
  const saved=await saveCaregiverPhoto(request,env,caregiverId);
  if(saved.ok)await env.DB.prepare("UPDATE caregiver_profile_edit_tokens SET used_at=CURRENT_TIMESTAMP WHERE id=? AND used_at IS NULL").bind(grant.id).run();
  return json(saved,{status:saved.ok?200:400});
}

/** Stores an already square, resized photo (the browser crops it) for a caregiver. */
async function saveCaregiverPhoto(request:Request,env:Env,caregiverId:string):Promise<{ok:true;photoUrl:string}|{ok:false;error:string}>{
  const type=(request.headers.get("content-type")||"").split(";")[0].trim().toLowerCase();
  if(!["image/jpeg","image/png","image/webp"].includes(type))return {ok:false,error:"Use a JPG, PNG, or WebP photo."};
  const body=await request.arrayBuffer();
  if(body.byteLength<100||body.byteLength>180000)return {ok:false,error:"Profile photo must be under 180 KB after resizing."};
  const bytes=new Uint8Array(body);
  if(!validProfileImage(type,bytes))return {ok:false,error:"That file does not look like a valid image."};
  await env.DB!.prepare(`INSERT INTO caregiver_profile_photos(caregiver_id,image_blob,content_type,byte_size)
    VALUES (?,?,?,?)
    ON CONFLICT(caregiver_id) DO UPDATE SET image_blob=excluded.image_blob,content_type=excluded.content_type,byte_size=excluded.byte_size,updated_at=CURRENT_TIMESTAMP`)
    .bind(caregiverId,body,type,body.byteLength).run();
  const photoUrl="/api/caregivers/"+encodeURIComponent(caregiverId)+"/photo";
  await env.DB!.prepare("UPDATE caregivers SET profile_photo_url=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(photoUrl,caregiverId).run();
  return {ok:true,photoUrl};
}

/** The signed-in caregiver's own photo: view it, or replace it from /dashboard/profile. */
async function handleMyPhoto(request:Request,env:Env,identity:Parameters<typeof caregiverForIdentity>[1]){
  if(!identity)return json({ok:false,error:"Sign in required"},{status:401});
  if(!env.DB)return json({ok:false,error:"Database not configured"},{status:503});
  const caregiverId=await caregiverForIdentity(env,identity);
  if(!caregiverId)return json({ok:false,error:"No caregiver profile yet"},{status:404});
  if(request.method==="POST"){
    const saved=await saveCaregiverPhoto(request,env,caregiverId);
    return json(saved,{status:saved.ok?200:400});
  }
  if(request.method!=="GET")return json({ok:false,error:"Method not allowed"},{status:405});
  const row=await env.DB.prepare("SELECT image_blob,content_type FROM caregiver_profile_photos WHERE caregiver_id=? LIMIT 1")
    .bind(caregiverId).first<{image_blob:ArrayBuffer|number[];content_type:string}>();
  if(!row)return json({ok:false,error:"Profile photo not found"},{status:404});
  return new Response(new Uint8Array(row.image_blob),{headers:{"content-type":row.content_type||"image/webp","cache-control":"private,no-store","x-content-type-options":"nosniff"}});
}

async function handleCaregiver(request: Request, env: Env) {
  if (!env.DB) return json({ok:false,error:"Database not configured yet"},{status:503});
  const data=await readJson(request);
  if(rejectBot(data)) return json({ok:true},{status:201});
  const guard=await publicFormGuard(request,env,"caregiver_signup",data,10,60);
  if(guard) return guard;
  const error=requireFields(data,["firstName","lastName","email","zip","role"]);
  if(error) return json({ok:false,error},{status:400});
  const email=clean(data!.email,320).toLowerCase();
  if(!emailLooksValid(email)) return json({ok:false,error:"Enter a valid email address"},{status:400});
  const zip=clean(data!.zip,20);
  const zipInfo=await lookupZip(env.DB,zip);
  const state=zipInfo?.state||await stateForZip(env.DB,zip);
  const city=zipInfo?.city||"";
  const first=clean(data!.firstName,120);
  const last=clean(data!.lastName,120);
  const floor=hourlyPayFloor(data!.payMin??data!.desiredWage);
  if((data!.payMin!==undefined&&data!.payMin!==null&&data!.payMin!==''||!!clean(data!.desiredWage))&&floor===null)return json({ok:false,error:"Enter a minimum hourly pay between $0 and $200"},{status:400});
  const desiredWage=floor?'$'+floor+'+/hr':'';
  const initiallyExisting=await env.DB.prepare("SELECT id FROM caregivers WHERE lower(trim(email))=? LIMIT 1").bind(email).first<{id:string}>();
  // This form has no sign-in, so it may create a profile but never change one that already exists.
  if(initiallyExisting)return json({ok:false,needsVerifiedSignIn:true,error:"This email already has a CareJoys profile. Sign in at carejoys.com/login to update it."},{status:409});
  const proposedId=crypto.randomUUID();

  if(!initiallyExisting){
    await env.DB.prepare(`INSERT OR IGNORE INTO caregivers
      (id,first_name,last_name,display_name,email,phone,city,zip,state,role,shift_preferences,desired_wage,hourly_rate_min,transportation,source,work_status,last_confirmed_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'organic','unknown',NULL)`)
      .bind(proposedId,first,last,(first+" "+last).trim(),email,clean(data!.phone,40),city||null,zip,state,clean(data!.role,80),
        clean(data!.shifts,500),desiredWage,floor||null,clean(data!.transportation,80)).run();
  }
  const canonical=await env.DB.prepare("SELECT id FROM caregivers WHERE lower(trim(email))=? LIMIT 1").bind(email).first<{id:string}>();
  const id=canonical?.id||proposedId;
  const existedBefore=!!initiallyExisting||id!==proposedId;
  await env.DB.prepare(`UPDATE caregivers SET first_name=?,last_name=?,display_name=?,phone=?,zip=?,city=COALESCE(NULLIF(?,''),city),state=CASE WHEN ?!='' THEN ? ELSE state END,
    role=?,shift_preferences=?,desired_wage=?,hourly_rate_min=?,transportation=?,
    is_active=1,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .bind(first,last,(first+" "+last).trim(),clean(data!.phone,40),zip,city,state,state,clean(data!.role,80),
      clean(data!.shifts,500),desiredWage,floor||null,clean(data!.transportation,80),id).run();

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

  await setInitialJobAlertOptIn(env,id,data!.jobAlertsEmailOptIn);
  if(!existedBefore)await linkWorkerSignup(env,id,data!.funnelVisitorId);
  const agencyResult=await scoreCaregiverAgainstAgencies(env,id);
  const caregiver=await env.DB.prepare("SELECT * FROM caregivers WHERE id=? LIMIT 1").bind(id).first<Record<string,unknown>>();
  const openingMatches=caregiver?await matchCaregiverToOpenings(env,id,"caregiver_signup"):0;
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

async function handleCaregiverResume(request:Request,env:Env,ctx?:WorkerCtx){
  if(!env.DB)return json({ok:false,error:"Database not configured yet"},{status:503});
  const data=await readJson(request);
  if(rejectBot(data))return json({ok:true},{status:201});
  // Sign-in is optional for a new profile; it is only required to change a profile that already exists (below).
  const authIdentity=await caregiverAuthIdentity(request,env);
  const guard=await publicFormGuard(request,env,"caregiver_resume",data,8,60);
  if(guard)return guard;
  const error=requireFields(data,["firstName","lastName","email","zip","role"]);
  if(error)return json({ok:false,error},{status:400});

  const email=(authIdentity?.email||clean(data!.email,320)).toLowerCase();
  if(!emailLooksValid(email))return json({ok:false,error:"Enter a valid email address"},{status:400});
  const zip=clean(data!.zip,10);
  if(!/^\d{5}$/.test(zip))return json({ok:false,error:"Enter a valid 5-digit ZIP code"},{status:400});
  const state=(clean(data!.state,2).toUpperCase()||await stateForZip(env.DB,zip)||"").slice(0,2);
  if(!/^[A-Z]{2}$/.test(state))return json({ok:false,error:"Enter a valid two-letter state"},{status:400});

  const auth0Sub=auth0SubOf(authIdentity);
  const authExisting=auth0Sub
    ?await env.DB.prepare("SELECT id FROM caregivers WHERE auth0_sub=? LIMIT 1").bind(auth0Sub).first<{id:string}>()
    :null;
  const emailExisting=await env.DB.prepare("SELECT id FROM caregivers WHERE lower(trim(email))=? LIMIT 1").bind(email).first<{id:string}>();
  const initiallyExisting=authExisting||emailExisting;
  // An email match alone proves nothing: only the profile's own login, or a login whose email Auth0 verified, may change it.
  if(emailExisting&&!authExisting&&!authIdentity?.emailVerified){
    return json({ok:false,needsVerifiedSignIn:true,error:"This email already has a CareJoys profile. Sign in with Google or a verified email to update it."},{status:409});
  }
  const proposedId=initiallyExisting?.id||crypto.randomUUID();
  // Only attach this Auth0 login to an existing email-matched profile when Auth0 verified the email; the sub unlocks /me.
  const linkSub=auth0Sub&&(authExisting||!emailExisting||authIdentity?.emailVerified)?auth0Sub:null;

  const first=clean(data!.firstName,120);
  const last=clean(data!.lastName,120);
  const role=clean(data!.role,80)||"Caregiver";
  const certifications=clean(data!.certifications,1500);
  const specialties=clean(data!.specialties,2000);
  const languages=clean(data!.languages,1000);
  const years=Math.max(0,Math.min(60,Number(data!.yearsExperience||0)||0));
  const shifts=clean(data!.shifts,500);
  const floor=hourlyPayFloor(data!.payMin??data!.desiredWage);
  if((data!.payMin!==undefined&&data!.payMin!==null&&data!.payMin!==''||!!clean(data!.desiredWage))&&floor===null)return json({ok:false,error:"Enter a minimum hourly pay between $0 and $200"},{status:400});
  const desiredWage=floor?'$'+floor+'+/hr':'';
  const transportation=clean(data!.transportation,80);
  const travel=Math.max(0,Math.min(100,Number(data!.travelMiles||0)||0));

  if(!initiallyExisting){
    await env.DB.prepare("INSERT OR IGNORE INTO caregivers (id,first_name,last_name,display_name,email,phone,zip,state,role,certifications,specialties,languages,years_experience,shift_preferences,desired_wage,hourly_rate_min,transportation,travel_distance_miles,source,source_detail,work_status,last_confirmed_at,auth0_sub,auth0_email_verified) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'resume_upload','caregiver_resume','unknown',NULL,?,?)")
      .bind(proposedId,first,last,(first+" "+last).trim(),email,clean(data!.phone,40),zip,state,role,certifications,specialties,languages,years||null,
        shifts,desiredWage,floor||null,transportation,travel||null,auth0Sub,authIdentity?.emailVerified?1:0).run();
  }

  const canonical=auth0Sub
    ?await env.DB.prepare("SELECT id FROM caregivers WHERE auth0_sub=? OR lower(trim(email))=? ORDER BY CASE WHEN auth0_sub=? THEN 0 ELSE 1 END LIMIT 1")
      .bind(auth0Sub,email,auth0Sub).first<{id:string}>()
    :await env.DB.prepare("SELECT id FROM caregivers WHERE lower(trim(email))=? LIMIT 1").bind(email).first<{id:string}>();
  const id=canonical?.id||proposedId;
  const existedBefore=!!initiallyExisting||id!==proposedId;

  await env.DB.prepare("UPDATE caregivers SET first_name=?,last_name=?,display_name=?,email=?,phone=COALESCE(NULLIF(?,''),phone),zip=?,state=?,role=?,certifications=?,specialties=?,languages=?,years_experience=?,shift_preferences=?,desired_wage=?,hourly_rate_min=?,transportation=?,travel_distance_miles=?,work_status=CASE WHEN work_status='closed' THEN 'unknown' ELSE work_status END,last_confirmed_at=CASE WHEN work_status='closed' THEN NULL ELSE last_confirmed_at END,source_detail='caregiver_resume',auth0_sub=COALESCE(?,auth0_sub),auth0_email_verified=CASE WHEN ?=1 THEN 1 ELSE auth0_email_verified END,is_active=1,updated_at=CURRENT_TIMESTAMP WHERE id=?")
    .bind(first,last,(first+" "+last).trim(),email,clean(data!.phone,40),zip,state,role,certifications,specialties,languages,years||null,
      shifts,desiredWage,floor||null,transportation,travel||null,linkSub,linkSub&&authIdentity?.emailVerified?1:0,id).run();

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

  await setInitialJobAlertOptIn(env,id,data!.jobAlertsEmailOptIn);
  if(!existedBefore)await linkWorkerSignup(env,id,data!.funnelVisitorId);
  const agencyResult=await scoreCaregiverAgainstAgencies(env,id);
  const caregiver=await env.DB.prepare(`SELECT c.*,zg.lat AS geo_lat,zg.lng AS geo_lng FROM caregivers c ${zipGeoJoin("c")} WHERE c.id=? LIMIT 1`).bind(id).first<Record<string,unknown>>();
  // Employer openings are scored after the response goes out so the caregiver is not kept waiting.
  if(caregiver)await runAfterResponse(ctx,matchCaregiverToOpenings(env,id,"resume_match"));
  const nearbyJobs=caregiver?await nearbyJobsFor(env,caregiver,60):[];

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
  const marylandMatching=state==="MD";
  const profilePhotoToken=await issueCaregiverProfilePhotoToken(env,id);
  const resumeUploadToken=await issueCaregiverProfilePhotoToken(env,id,'resume_upload');

  return json({
    ok:true,id,matchedOrganizations:Number(relevant?.count||agencyResult.scored||0),matchedOpenings:nearbyJobs.length,topJobs:nearbyJobs.slice(0,3),
    marylandMatching,existing:existedBefore,profilePhotoToken,resumeUploadToken,profilePhotoUrl:clean(caregiver?.profile_photo_url,500)||null,
    authenticated:!!authIdentity,
    targetJob:targetJob?{id:targetJob.id,title:targetJob.title,employerName:targetJob.employer_name,applicationUrl:targetJob.source_url}:null
  },{status:existedBefore?200:201});
}

// /pricing's "who is near you" line. Small counts are reported as "fewer than SUPPLY_MIN_SHOWN" so nobody can be singled out.
async function getCaregiverSupply(url:URL,env:Env){
  const zip=clean(url.searchParams.get("zip"),5);
  if(!/^\d{5}$/.test(zip))return json({ok:false,error:"Enter a five-digit ZIP code."},{status:400});
  const geo=await lookupZip(env.DB,zip);
  if(!geo)return json({ok:true,zip,found:false});
  const s=await localCaregiverSupply(env,geo);
  return json({ok:true,zip,found:true,city:geo.city,state:geo.state,miles:s.miles,jobs:s.jobs,
    caregivers:s.caregivers>=SUPPLY_MIN_SHOWN?s.caregivers:null,caregiversBelow:s.caregivers>=SUPPLY_MIN_SHOWN?null:SUPPLY_MIN_SHOWN
  },{headers:{"cache-control":"public,max-age=900"}});
}

async function getJobsHub(url:URL,env:Env){
  const state=usState(url.searchParams.get("state"));
  if(!state)return json({ok:false,error:"Unknown state"},{status:400});
  const cna=url.searchParams.get("cna")==="1";
  const citySlug=slugify(clean(url.searchParams.get("city"),120));
  const data=await jobsHub(env,{state,citySlug,role:clean(url.searchParams.get("role"),40),page:Number(url.searchParams.get("page")||1),cna});
  // The matching caregiver or CNA page for the same place, so each can link to the other.
  const sibling=(await jobsHub(env,{state,citySlug,cna:!cna})).total;
  return json({ok:true,state,city:data.city,total:data.total,page:data.page,pages:data.pages,
    cities:data.cities.filter(c=>c.count>=(cna?CNA_PAGE_MIN_JOBS:CITY_PAGE_MIN_JOBS)).slice(0,40),
    metro:data.metro?{name:data.metro.name,area:data.metro.area}:null,
    cna,sibling,cnaPageMinJobs:CNA_PAGE_MIN_JOBS,
    jobs:data.jobs.map(publicHubJob)
  },{headers:{"cache-control":"public,max-age=300"}});
}

const publicHubJob=(j:Record<string,unknown>)=>({id:j.id,title:normalizeTitle(j.title),role:j.role,employerName:j.employer_name,city:j.city,state:j.state,zip:j.zip,
  employmentType:j.employment_type,payMin:j.pay_min,payMax:j.pay_max,payPeriod:j.pay_period});

async function getGnaJobs(url:URL,env:Env){
  const area=localArea(clean(url.searchParams.get("area"),40)||"maryland");
  if(!area)return json({ok:false,error:"Unknown area"},{status:400});
  const data=await gnaJobs(env,area);
  return json({ok:true,area:area.slug,total:data.total,gna:data.gna,jobs:data.jobs.map(publicHubJob)},{headers:{"cache-control":"public,max-age=300"}});
}

async function getCnaClasses(url:URL,env:Env){
  const area=localArea(clean(url.searchParams.get("area"),40)||"baltimore");
  if(!area)return json({ok:false,error:"Unknown area"},{status:400});
  const data=await cnaClasses(env,area);
  return json({ok:true,area:area.slug,programs:data.programs,jobs:data.jobs},{headers:{"cache-control":"public,max-age=300"}});
}

async function getNationalJobs(url:URL,env:Env){
  const data=await nationalJobsHub(env,{role:clean(url.searchParams.get("role"),40),page:Number(url.searchParams.get("page")||1)});
  return json({ok:true,total:data.total,page:data.page,pages:data.pages,
    states:data.states.map(s=>({code:s.state.code,name:s.state.name,slug:s.state.slug,count:s.count})),
    cities:data.cities.map(c=>({city:c.city,slug:c.slug,state:c.state.code,stateSlug:c.state.slug,count:c.count})),
    jobs:data.jobs.map(publicHubJob)
  },{headers:{"cache-control":"public,max-age=300"}});
}

async function getPublicJobContext(id:string,env:Env){
  if(!env.DB)return json({ok:false,error:"Database not configured"},{status:503});
  const job=await env.DB.prepare("SELECT id,agency_organization_id,role,state,pay_min,pay_max,pay_period FROM caregiver_jobs WHERE id=? AND is_published=1 AND status='current' LIMIT 1").bind(id).first<Record<string,unknown>>();
  if(!job)return json({ok:false,error:"Job not found"},{status:404});
  return json({ok:true,...await jobPageContext(env,job)},{headers:{"cache-control":"public,max-age=300"}});
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

/** Scores one caregiver against open openings within reach and upserts `matched` pipeline rows. */
async function matchCaregiverToOpenings(env:Env,caregiverId:string,source:string){
  const caregiver=await env.DB!.prepare(`SELECT c.*,zg.lat AS geo_lat,zg.lng AS geo_lng FROM caregivers c ${zipGeoJoin("c")} WHERE c.id=? LIMIT 1`).bind(caregiverId).first<Record<string,unknown>>();
  if(!caregiver)return 0;
  const geo=rowGeo(caregiver);
  let sql=`SELECT o.*,zg.lat AS geo_lat,zg.lng AS geo_lng FROM openings o ${zipGeoJoin("o")} WHERE o.status='open'`;
  const args:unknown[]=[];
  if(geo){
    const box=boundingBox(geo,commuteRadiusMiles(caregiver));
    sql+=" AND (zg.lat IS NULL OR (zg.lat BETWEEN ? AND ? AND zg.lng BETWEEN ? AND ?))";
    args.push(box.minLat,box.maxLat,box.minLng,box.maxLng);
  }
  sql+=" ORDER BY o.updated_at DESC LIMIT 500";
  const openings=await env.DB!.prepare(sql).bind(...args).all<Record<string,unknown>>();
  let matched=0;
  for(const opening of openings.results||[]){
    const scored=scoreCandidate(opening,caregiver);
    if(scored.score<=0)continue;
    await env.DB!.prepare(`INSERT INTO candidate_pipeline(id,opening_id,caregiver_id,stage,match_reason,match_score,source)
      VALUES (?,?,?,'matched',?,?,?)
      ON CONFLICT(opening_id,caregiver_id) DO UPDATE SET
        match_reason=excluded.match_reason,match_score=excluded.match_score,updated_at=CURRENT_TIMESTAMP`)
      .bind(crypto.randomUUID(),opening.id,caregiverId,JSON.stringify(scored.reasons),scored.score,source).run();
    matched++;
  }
  return matched;
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
const SEARCHABLE_CAREGIVER="c.is_active=1 AND c.work_status='actively_looking' AND (c.auth0_email_verified=1 OR (c.source='legacy_carekoya' AND c.activation_completed_at IS NOT NULL))";
async function searchCandidates(url: URL, env: Env) {
  if(!env.DB) return json({ok:false,error:"Database not configured yet"},{status:503});
  const role=clean(url.searchParams.get("role"),80).toLowerCase();
  const preferredRole=clean(url.searchParams.get("preferredRole"),80).toLowerCase();
  const zip=normalizeZip(url.searchParams.get("zip"));
  const state=clean(url.searchParams.get("state"),40).toLowerCase();
  const shift=clean(url.searchParams.get("shift"),120).toLowerCase();
  const freshness=clean(url.searchParams.get("freshness"),30);
  const allDistances=url.searchParams.get("radius")==='all';
  const radius=Math.max(1,Math.min(MAX_SEARCH_MILES,Number(url.searchParams.get("radius")||0)||25));
  const center=zip?await lookupZip(env.DB,zip):null;
  let sql=`SELECT c.id,c.first_name,c.last_name,c.display_name,c.city,c.state,c.zip,c.role,c.certifications,c.specialties,c.languages,c.years_experience,c.desired_wage,c.hourly_rate_min,c.hourly_rate_max,c.shift_preferences,c.travel_distance_miles,c.transportation,c.willing_to_drive,c.work_status,c.last_confirmed_at,c.source,c.profile_photo_url,c.bio,c.care_settings,c.preferred_settings,c.employment_types,c.start_availability,c.availability_json,c.license_number,c.license_state,c.checklist,EXISTS(SELECT 1 FROM caregiver_resume_files rf WHERE rf.caregiver_id=c.id) AS has_resume,${HAS_INTRO_VIDEO_SQL},zg.lat AS geo_lat,zg.lng AS geo_lng
    FROM caregivers c ${zipGeoJoin("c")} WHERE ${SEARCHABLE_CAREGIVER}`;
  const args:unknown[]=[];
  if(role){ sql+=" AND lower(COALESCE(c.role,'')||' '||COALESCE(c.certifications,'')||' '||COALESCE(c.specialties,'')) LIKE ?"; args.push("%"+role+"%"); }
  if(center&&!allDistances){
    const box=boundingBox(center,radius);
    sql+=" AND zg.lat BETWEEN ? AND ? AND zg.lng BETWEEN ? AND ?"; args.push(box.minLat,box.maxLat,box.minLng,box.maxLng);
  }else if(zip&&!center){ sql+=" AND substr(trim(COALESCE(c.zip,'')),1,5)=?"; args.push(zip); }
  if(state){ sql+=" AND lower(COALESCE(c.state,''))=?"; args.push(state); }
  if(shift){ sql+=" AND lower(COALESCE(c.shift_preferences,'')) LIKE ?"; args.push("%"+shift+"%"); }
  if(freshness==="confirmed"){ sql+=" AND c.work_status='actively_looking' AND datetime(c.last_confirmed_at)>=datetime('now','-30 days')"; }
  sql+=" ORDER BY CASE WHEN c.last_confirmed_at IS NULL THEN 1 ELSE 0 END, c.last_confirmed_at DESC LIMIT 1000";
  const result=await env.DB.prepare(sql).bind(...args).all<Record<string,unknown>>();
  let rows=(result.results||[]).map(c=>{
    const geo=rowGeo(c);
    return {c,distanceMiles:center&&geo?haversineMiles(center,geo):null};
  });
  if(center){
    if(!allDistances)rows=rows.filter(r=>r.distanceMiles!==null&&r.distanceMiles<=radius);
    // Prioritize caregivers likely to accept the commute, then fresh availability, then
    // distance. A default unbounded browse still includes everyone eligible afterwards.
    rows.sort((a,b)=>{
      const aCommute=a.distanceMiles!==null&&a.distanceMiles<=commuteRadiusMiles(a.c)?0:1;
      const bCommute=b.distanceMiles!==null&&b.distanceMiles<=commuteRadiusMiles(b.c)?0:1;
      const aAge=ageDays(a.c.last_confirmed_at)??9999,bAge=ageDays(b.c.last_confirmed_at)??9999;
      const roleText=(c:Record<string,unknown>)=>[c.role,c.certifications,c.specialties].map(v=>clean(v,500).toLowerCase()).join(' ');
      const aRole=preferredRole&&!roleText(a.c).includes(preferredRole)?1:0;
      const bRole=preferredRole&&!roleText(b.c).includes(preferredRole)?1:0;
      return aCommute-bCommute||aRole-bRole||(aAge<=30?0:1)-(bAge<=30?0:1)||
        (a.distanceMiles??9999)-(b.distanceMiles??9999)||aAge-bAge;
    });
  }
  return json({ok:true,total:rows.length,radiusMiles:center&&!allDistances?radius:null,candidates:rows.slice(0,100).map(({c,distanceMiles})=>talentCandidate(c,distanceMiles))});
}
/** One caregiver as employers see them in Talent network search. The caregiver's own preview uses the same shape. */
function talentCandidate(c:Record<string,unknown>,distanceMiles:number|null){
  return {
    id:c.id,
    name:publicName(c.first_name,c.last_name,c.display_name),
    city:c.city,state:c.state,zip:c.zip,role:c.role,certifications:listText(c.certifications),specialties:listText(c.specialties),languages:listText(c.languages),
    careSettings:listText(c.care_settings),preferredSettings:listText(c.preferred_settings),bio:c.bio,employmentTypes:listText(c.employment_types),startAvailability:c.start_availability,
    licensed:!!c.license_number,licenseState:c.license_state,hasResume:Number(c.has_resume)===1,checklist:parseChecklist(c.checklist),
    yearsExperience:c.years_experience,desiredWage:c.desired_wage,rateMin:c.hourly_rate_min,rateMax:c.hourly_rate_max,
    shifts:c.shift_preferences,schedule:availabilityByDay(parseAvailability(c.availability_json)),travelMiles:c.travel_distance_miles,transportation:c.transportation,willingToDrive:!!c.willing_to_drive,
    workStatus:c.work_status,lastConfirmedAt:c.last_confirmed_at,freshness:freshnessLabel(c.work_status,c.last_confirmed_at),source:c.source,profilePhotoUrl:c.profile_photo_url,
    introVideoUrl:Number(c.has_intro_video)===1?"/api/caregivers/"+encodeURIComponent(String(c.id))+"/video":undefined,
    distanceMiles:distanceMiles===null?null:Math.round(distanceMiles*10)/10
  };
}
/** The signed-in caregiver's own card exactly as employers see it, and whether search shows it at all. */
async function myEmployerView(env:Env,identity:Parameters<typeof caregiverForIdentity>[1]){
  if(!identity)return json({ok:false,error:"Sign in required"},{status:401});
  const caregiverId=await caregiverForIdentity(env,identity);
  if(!caregiverId)return json({ok:false,error:"No caregiver profile yet"},{status:404});
  const c=await env.DB!.prepare(`SELECT c.*,(${SEARCHABLE_CAREGIVER}) AS searchable,EXISTS(SELECT 1 FROM caregiver_resume_files rf WHERE rf.caregiver_id=c.id) AS has_resume,${HAS_INTRO_VIDEO_SQL} FROM caregivers c WHERE c.id=?`).bind(caregiverId).first<Record<string,unknown>>();
  if(!c)return json({ok:false,error:"No caregiver profile yet"},{status:404});
  const candidate=talentCandidate(c,null);
  // The employer photo and video URLs need an employer session; the caregiver previews their own copies.
  return json({ok:true,visible:Number(c.searchable)===1,candidate:{...candidate,profilePhotoUrl:c.profile_photo_url?"/api/me/photo?v="+encodeURIComponent(String(c.updated_at||"")):candidate.profilePhotoUrl,
    introVideoUrl:candidate.introVideoUrl?"/api/me/video":undefined}});
}
async function getWorkspace(id:string, env:Env) {
  const workspace=await requireWorkspace(env,id);
  if(!workspace) return json({ok:false,error:"Workspace not found"},{status:404});
  const openings=await env.DB!.prepare(`SELECT o.*,
    (SELECT COUNT(*) FROM interview_slots s WHERE s.opening_id=o.id AND s.status='available' AND datetime(s.starts_at)>datetime('now')) AS available_interview_slots
    FROM openings o WHERE o.employer_id=? ORDER BY o.created_at DESC`).bind(id).all();
  const pipelineCount=await env.DB!.prepare("SELECT COUNT(*) AS count FROM candidate_pipeline cp JOIN openings o ON o.id=cp.opening_id WHERE o.employer_id=?").bind(id).first<{count:number}>();
  const approval=await approvalFor(env,id);
  // Send a one-time admin review notification even when pending accounts no longer call match/search APIs.
  if(!approval.approved)await pendingApprovalResponse(env,id);
  return json({ok:true,workspace,approval,openings:openings.results||[],pipelineCount:Number(pipelineCount?.count||0)});
}
async function createOpening(id:string,request:Request,env:Env) {
  const workspace=await requireWorkspace(env,id);
  if(!workspace) return json({ok:false,error:"Workspace not found"},{status:404});
  const data=await readJson(request);
  const error=requireFields(data,["title","role"]);
  if(error) return json({ok:false,error},{status:400});
  const openingId=crypto.randomUUID();
  const zipInfo=await lookupZip(env.DB,data!.zip);
  const shift=openingShift(data!.schedule,clean(data!.shifts,300));
  await env.DB!.prepare("INSERT INTO openings (id,employer_id,title,role,city,state,zip,pay_min,pay_max,shift_preferences,schedule_json,transportation_required,requirements,status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, 'open')")
    .bind(openingId,id,clean(data!.title,200),clean(data!.role,80),clean(data!.city,120)||zipInfo?.city||"",clean(data!.state,80)||zipInfo?.state||"",clean(data!.zip,20),Number(data!.payMin||0)||null,Number(data!.payMax||0)||null,shift.shifts,shift.scheduleJson,data!.transportationRequired===true?1:0,clean(data!.requirements,1200)).run();
  return json({ok:true,id:openingId},{status:201});
}
async function matchOpening(workspaceId:string,openingId:string,env:Env) {
  const workspace=await requireWorkspace(env,workspaceId);
  if(!workspace) return json({ok:false,error:"Workspace not found"},{status:404});
  const opening=await env.DB!.prepare(`SELECT o.*,zg.lat AS geo_lat,zg.lng AS geo_lng FROM openings o ${zipGeoJoin("o")} WHERE o.id=? AND o.employer_id=?`).bind(openingId,workspaceId).first<Record<string,unknown>>();
  if(!opening) return json({ok:false,error:"Opening not found"},{status:404});
  // Prefilter in SQL: within the widest allowed commute of the opening, or the same state when the opening has no known ZIP.
  const openingGeo=rowGeo(opening);
  let candidateSql=`SELECT c.*,zg.lat AS geo_lat,zg.lng AS geo_lng FROM caregivers c ${zipGeoJoin("c")} WHERE ${SEARCHABLE_CAREGIVER}`;
  const candidateArgs:unknown[]=[];
  if(openingGeo){
    const box=boundingBox(openingGeo,MAX_SEARCH_MILES);
    candidateSql+=" AND (zg.lat IS NULL OR (zg.lat BETWEEN ? AND ? AND zg.lng BETWEEN ? AND ?))";
    candidateArgs.push(box.minLat,box.maxLat,box.minLng,box.maxLng);
  }else if(clean(opening.state)){
    candidateSql+=" AND (COALESCE(c.state,'')='' OR upper(c.state)=upper(?))";
    candidateArgs.push(clean(opening.state));
  }
  const result=await env.DB!.prepare(candidateSql).bind(...candidateArgs).all<Record<string,unknown>>();
  const scored=(result.results||[]).map(c=>({c,...scoreCandidate(opening,c)})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score).slice(0,50);
  for(const item of scored){
    const pipelineId=crypto.randomUUID();
    await env.DB!.prepare("INSERT OR IGNORE INTO candidate_pipeline (id,opening_id,caregiver_id,stage,match_reason,match_score,source) VALUES (?,?,?,'matched',?,?, 'carejoys_match')")
      .bind(pipelineId,openingId,item.c.id,JSON.stringify(item.reasons),item.score).run();
  }
  return json({ok:true,matched:scored.length,top:scored.slice(0,10).map(x=>({id:x.c.id,name:publicName(x.c.first_name,x.c.last_name,x.c.display_name),score:x.score,reasons:x.reasons,distanceMiles:x.distanceMiles===null?null:Math.round(x.distanceMiles*10)/10,freshness:freshnessLabel(x.c.work_status,x.c.last_confirmed_at),city:x.c.city,state:x.c.state,role:x.c.role}))});
}
async function getPipeline(workspaceId:string,url:URL,env:Env) {
  const workspace=await requireWorkspace(env,workspaceId);
  if(!workspace) return json({ok:false,error:"Workspace not found"},{status:404});
  const openingId=clean(url.searchParams.get("openingId"),80);
  let sql=`SELECT cp.id,cp.opening_id,cp.stage,cp.match_score,cp.match_reason,cp.contacted_at,cp.responded_at,cp.qualified_at,cp.interview_at,cp.hired_at,cp.response_value,cp.rejected_reason,cp.employer_notes,cp.favorited_at,o.title,o.role AS opening_role,c.id AS caregiver_id,c.first_name,c.last_name,c.display_name,c.city,c.state,c.zip,c.role,c.certifications,c.specialties,c.languages,c.years_experience,c.desired_wage,c.hourly_rate_min,c.hourly_rate_max,c.shift_preferences,c.travel_distance_miles,c.transportation,c.willing_to_drive,c.work_status,c.last_confirmed_at,c.source,c.profile_photo_url,c.bio,c.care_settings,c.preferred_settings,c.employment_types,c.start_availability,c.availability_json,c.license_number,c.license_state,c.checklist,EXISTS(SELECT 1 FROM caregiver_resume_files rf WHERE rf.caregiver_id=c.id) AS has_resume,${HAS_INTRO_VIDEO_SQL},
    CASE WHEN cp.response_value='interested' THEN c.email ELSE NULL END AS contact_email,
    CASE WHEN cp.response_value='interested' THEN c.phone ELSE NULL END AS contact_phone
    FROM candidate_pipeline cp JOIN openings o ON o.id=cp.opening_id JOIN caregivers c ON c.id=cp.caregiver_id WHERE o.employer_id=?
      AND (cp.stage!='matched' OR (c.is_active=1 AND c.work_status='actively_looking'
       AND (c.auth0_email_verified=1 OR (c.source='legacy_carekoya' AND c.activation_completed_at IS NOT NULL))))`;
  const args:unknown[]=[workspaceId];
  if(openingId){ sql+=" AND cp.opening_id=?"; args.push(openingId); }
  sql+=" ORDER BY cp.match_score DESC, cp.created_at DESC LIMIT 250";
  const rows=await env.DB!.prepare(sql).bind(...args).all<Record<string,unknown>>();
  const locked=await lockedIntroductions(env,workspaceId);
  // Each row carries the caregiver's full employer-facing profile, the same card the Talent network shows.
  return json({ok:true,pipeline:(rows.results||[]).map(r=>{
    const profile=talentCandidate({...r,id:r.caregiver_id},null);
    let reasons:string[]=[];
    try{const parsed=JSON.parse(clean(r.match_reason,2000)||"[]");if(Array.isArray(parsed))reasons=parsed.filter(x=>typeof x==="string")}catch{}
    return {id:r.id,opening_id:r.opening_id,stage:r.stage,match_score:r.match_score,match_reasons:reasons,contacted_at:r.contacted_at,responded_at:r.responded_at,
      interview_at:r.interview_at,hired_at:r.hired_at,response_value:r.response_value,rejected_reason:r.rejected_reason,title:r.title,opening_role:r.opening_role,
      caregiver_id:r.caregiver_id,name:profile.name,city:r.city,state:r.state,role:r.role,certifications:r.certifications,freshness:profile.freshness,
      profilePhotoUrl:r.profile_photo_url,contact_email:locked.has(clean(r.id,100))?null:r.contact_email,contact_phone:locked.has(clean(r.id,100))?null:r.contact_phone||null,contact_locked:locked.has(clean(r.id,100)),employer_notes:r.employer_notes||'',favorite:!!r.favorited_at,
      resume_url:Number(r.has_resume)===1&&r.contact_email&&!locked.has(clean(r.id,100))?'/api/pipeline/'+encodeURIComponent(clean(r.id,100))+'/resume':null,profile};
  })});
}
/** A caregiver's resume file, for an employer they said yes to (and whose introduction isn't locked behind billing). */
async function pipelineResume(workspaceId:string,pipelineId:string,env:Env){
  const row=await env.DB!.prepare("SELECT cp.id,cp.caregiver_id,cp.response_value FROM candidate_pipeline cp JOIN openings o ON o.id=cp.opening_id WHERE cp.id=? AND o.employer_id=?").bind(pipelineId,workspaceId).first<Record<string,unknown>>();
  if(!row) return json({ok:false,error:"Pipeline record not found"},{status:404});
  if(row.response_value!=="interested") return json({ok:false,error:"The resume is shared once the caregiver says they’re interested."},{status:403});
  if((await lockedIntroductions(env,workspaceId)).has(clean(row.id,100))) return json({ok:false,error:"Upgrade to see this caregiver’s contact details and resume."},{status:402});
  return resumeDownload(env,clean(row.caregiver_id,120));
}
async function updatePipeline(workspaceId:string,pipelineId:string,request:Request,env:Env) {
  const workspace=await requireWorkspace(env,workspaceId);
  if(!workspace) return json({ok:false,error:"Workspace not found"},{status:404});
  const data=await readJson(request);
  const owned=await env.DB!.prepare("SELECT cp.id,cp.stage,cp.rejected_reason,cp.contacted_at,cp.response_value,cp.interview_at FROM candidate_pipeline cp JOIN openings o ON o.id=cp.opening_id WHERE cp.id=? AND o.employer_id=?").bind(pipelineId,workspaceId).first<Record<string,unknown>>();
  if(!owned) return json({ok:false,error:"Pipeline record not found"},{status:404});
  if(data?.stage===undefined&&(data?.notes!==undefined||data?.favorite!==undefined)){
    if(data.notes!==undefined)await env.DB!.prepare("UPDATE candidate_pipeline SET employer_notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(clean(data.notes,4000),pipelineId).run();
    if(data.favorite!==undefined)await env.DB!.prepare("UPDATE candidate_pipeline SET favorited_at=CASE WHEN ? THEN COALESCE(favorited_at,CURRENT_TIMESTAMP) ELSE NULL END,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(data.favorite===true?1:0,pipelineId).run();
    return json({ok:true});
  }
  const stage=clean(data?.stage,40);
  if(stage==="restore"){
    // Only the employer's own "Not a fit" can be undone; a caregiver's "not interested" stays.
    if(owned.stage!=="rejected"||owned.rejected_reason!=="employer_not_a_fit") return json({ok:false,error:"Only caregivers you marked not a fit can be restored"},{status:409});
    const back=owned.interview_at?"interview":owned.response_value==="interested"?"interested":owned.contacted_at?"contacted":"matched";
    await env.DB!.prepare("UPDATE candidate_pipeline SET stage=?,rejected_reason=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(back,pipelineId).run();
    return json({ok:true,stage:back});
  }
  // Invited, interested and interview booked come only from real invitations and the caregiver's own answers.
  const allowed=["hired","rejected"];
  if(!allowed.includes(stage)) return json({ok:false,error:"Invalid stage"},{status:400});
  if(stage==="hired") await env.DB!.prepare("UPDATE candidate_pipeline SET stage='hired',hired_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(pipelineId).run();
  else await env.DB!.prepare("UPDATE candidate_pipeline SET stage='rejected',rejected_reason='employer_not_a_fit',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(pipelineId).run();
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
  const active=workStatus==="actively_looking"?1:0;
  await env.DB.prepare("UPDATE caregivers SET role=?,city=?,state=?,zip=?,shift_preferences=?,desired_wage=?,transportation=?,travel_distance_miles=?,work_status=?,last_confirmed_at=CURRENT_TIMESTAMP,activation_completed_at=CURRENT_TIMESTAMP,activation_token_hash=NULL,is_active=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
    .bind(role,city,state,zip,shifts,desiredWage,transportation,travelMiles,workStatus,active,caregiver.id).run();
  await env.DB.prepare("INSERT INTO availability_events (id,caregiver_id,status,shift_preferences,desired_wage,travel_distance_miles,source,confirmed_at) VALUES (?,?,?,?,?,?,'caregiver_reactivation',CURRENT_TIMESTAMP)")
    .bind(crypto.randomUUID(),caregiver.id,workStatus,shifts,desiredWage,travelMiles).run();
  return json({ok:true,status:workStatus});
}


/** Each summary run leaves a row in outreach_runs (kind job_summaries), so a run that stalls or fails is visible. */
async function recordedSummaryRun(env:Env,cron:string|undefined){
  if(!env.DB)return;
  const id=crypto.randomUUID();
  await env.DB.prepare("INSERT INTO outreach_runs(id,kind,trigger,note) VALUES (?,'job_summaries',?,'started')").bind(id,String(cron||'')).run().catch(()=>null);
  try{
    const r=await summarizeJobsBatch(env,100);
    await env.DB.prepare("UPDATE outreach_runs SET attempted=?,sent=?,failed=?,note='finished' WHERE id=?").bind(r.attempted,r.summarized,r.failed,id).run();
  }catch(error){
    await env.DB.prepare("UPDATE outreach_runs SET note=? WHERE id=?").bind(('error: '+(error instanceof Error?error.message:String(error))).slice(0,300),id).run().catch(()=>null);
  }
}

export default {
  async fetch(request:Request,env:Env,ctx?:WorkerCtx):Promise<Response>{
    const url=new URL(request.url);
    // One canonical host: www and any other alias get a permanent redirect for reads.
    if(url.hostname==="www.carejoys.com"&&(request.method==="GET"||request.method==="HEAD")){
      url.hostname="carejoys.com";
      return Response.redirect(url.toString(),301);
    }
    if(request.method==="GET"&&url.pathname==="/sitemap.xml") return careJoysSitemap(env);
    const childSitemap=request.method==="GET"?url.pathname.match(/^\/sitemaps\/([a-z0-9-]+)\.xml$/):null;
    if(childSitemap){const res=await careJoysChildSitemap(env,childSitemap[1]);if(res)return res;}
    if(request.method==="GET"&&url.pathname==="/robots.txt") return careJoysRobots();
    if(request.method==="GET"&&url.pathname==="/llms.txt") return careJoysLlms();
    if(url.pathname===MCP_PATH) return handleMcp(request,env);
    if(request.method==="GET"&&(url.pathname==="/.well-known/mcp/server-card.json"||url.pathname==="/.well-known/mcp.json"))
      return json(mcpServerCard(),{headers:{"cache-control":"public,max-age=3600","access-control-allow-origin":"*"}});
    const seoResponse=await publicSeoPage(request,url,env);
    if(seoResponse)return seoResponse;
    if(url.pathname==="/api/health") return handlePublicHealth(env);
    if(request.method==="GET"&&url.pathname==="/api/public/home-stats") return homeStatsResponse(env);
    if(request.method==="GET"&&url.pathname==="/api/public/job-preview") return previewPublicJobs(url,env,request);
    if(url.pathname==="/api/unsubscribe"&&(request.method==="GET"||request.method==="POST")) return handleUnsubscribe(request,env.DB);
    if(request.method==="POST"&&url.pathname==="/api/events"){ const cross=rejectCrossSiteWrite(request);if(cross)return cross;return recordAnalyticsEvent(request,env); }

    if(url.pathname==="/api/me"||url.pathname.startsWith("/api/me/")){
      if(request.method==="POST"){const cross=rejectCrossSiteWrite(request);if(cross)return cross;}
      const identity=await caregiverAuthIdentity(request,env);
      if(request.method==="GET"&&url.pathname==="/api/me") return getCaregiverDashboard(env,identity);
      if(request.method==="POST"&&url.pathname==="/api/me/worker-activity")return recordWorkerJobActivity(request,env,identity);
      if(url.pathname==="/api/me/job-alerts"&&(request.method==="GET"||request.method==="POST")) return caregiverAlertSettings(request,env,identity);
      if(request.method==="POST"&&url.pathname==="/api/me/availability") return updateCaregiverAvailability(request,env,identity);
      if(url.pathname==="/api/me/resume") return handleMyResume(request,env,identity);
      if(url.pathname==="/api/me/photo") return handleMyPhoto(request,env,identity);
      const meVideo=url.pathname.match(/^\/api\/me\/video(?:\/(upload|complete|delete))?$/);
      if(meVideo){
        if(!identity)return json({ok:false,error:"Sign in required"},{status:401});
        if(!env.DB)return json({ok:false,error:"Database not configured"},{status:503});
        const caregiverId=await caregiverForIdentity(env,identity);
        if(!caregiverId)return json({ok:false,error:"No caregiver profile yet"},{status:404});
        return handleMyVideo(request,env,caregiverId,meVideo[1]||"");
      }
      if(request.method==="POST"&&url.pathname==="/api/me/apply-agent/continue") return continueApplyAgent(request,env,identity);
      const meAgent=url.pathname.match(/^\/api\/me\/apply-agent\/([^/]+)$/);
      if(request.method==="POST"&&meAgent) return startApplyAgent(env,identity,decodeURIComponent(meAgent[1]));
      const meApply=url.pathname.match(/^\/api\/me\/apply\/([^/]+)$/);
      if(request.method==="POST"&&meApply) return applyWithProfile(env,identity,decodeURIComponent(meApply[1]));
      if(request.method==="GET"&&url.pathname==="/api/me/employer-view") return myEmployerView(env,identity);
      if(request.method==="POST"&&url.pathname==="/api/me/profile") return updateCaregiverProfile(request,env,identity,(id)=>matchCaregiverToOpenings(env,id,"caregiver_profile"));
      if(request.method==="POST"&&url.pathname==="/api/me/preferences") return updateCaregiverPreferences(request,env,identity,(id)=>matchCaregiverToOpenings(env,id,"caregiver_dashboard"));
      const invite=url.pathname.match(/^\/api\/me\/invites\/([^/]+)\/(respond|book)$/);
      if(request.method==="POST"&&invite) return invite[2]==="respond"?respondToInvite(request,env,identity,decodeURIComponent(invite[1])):bookInviteInterview(request,env,identity,decodeURIComponent(invite[1]));
      return json({ok:false,error:"Not found"},{status:404});
    }

    if(request.method==="POST"&&url.pathname==="/api/stripe/webhook") return handleStripeWebhook(request,env);
    if(request.method==="GET"&&url.pathname==="/api/billing") return billingStatus(request,env);
    if(request.method==="POST"&&(url.pathname==="/api/billing/checkout"||url.pathname==="/api/billing/portal")){
      const cross=rejectCrossSiteWrite(request);if(cross)return cross;
      return url.pathname.endsWith("/checkout")?createCheckout(request,env):createPortal(request,env);
    }
    if(request.method==="POST"&&url.pathname==="/api/admin/auth/request"){ const cross=rejectCrossSiteWrite(request);if(cross)return cross;return requestAdminMagicLink(request,env); }
    if(url.pathname.startsWith("/api/admin/")||url.pathname==="/api/activation-stats"){
      if(request.method==="POST"){const cross=rejectCrossSiteWrite(request);if(cross)return cross;}
      const admin=await adminFromRequest(request,env);
      if(!admin) return json({ok:false,error:"Admin sign-in required"},{status:401});
      if(!env.DB) return json({ok:false,error:"Database not configured"},{status:503});
      if(request.method==="GET"&&url.pathname==="/api/admin/session") return json({ok:true,admin});
      if(request.method==="GET"&&url.pathname==="/api/admin/health") return handleHealth(env);
      if(request.method==="GET"&&url.pathname==="/api/admin/clarity") return json({ok:true,...await clarityInsights(env,Number(url.searchParams.get("days"))||30)});
      if(request.method==="POST"&&url.pathname==="/api/admin/clarity/pull") return json(await pullClarityInsights(env,{force:true}));
      if(request.method==="GET"&&url.pathname==="/api/activation-stats") return activationStats(env);
      if(request.method==="GET"&&url.pathname==="/api/admin/overview"){
        const [funnel,outreach,employers]=await Promise.all([adminFunnel(env,clean(url.searchParams.get("window"),10)||"30"),outreachStatus(env),adminEmployers(env)]);
        return json({ok:true,admin,funnel,outreach,employers});
      }
      const approve=url.pathname.match(/^\/api\/admin\/employers\/([^/]+)\/approve$/);
      if(request.method==="POST"&&approve) return approveEmployer(env,decodeURIComponent(approve[1]),admin.email||"admin_token");
      if(request.method==="POST"&&url.pathname==="/api/admin/outreach/run") return runAdminOutreach(request,env);
      if(request.method==="POST"&&url.pathname==="/api/admin/outreach/test") return sendAdminOutreachTest(request,env,admin);
      if(request.method==="POST"&&url.pathname==="/api/admin/agency-test") return sendAdminAgencyTest(request,env,admin);
      if(request.method==="GET"&&url.pathname==="/api/admin/job-sites") return adminJobSites(env);
      if(request.method==="POST"&&url.pathname==="/api/admin/apply-test") return adminApplyTest(request,env);
      if(request.method==="GET"&&url.pathname==="/api/admin/agencies") return adminAgencySearch(env,url.searchParams.get("q")||"");
      if(request.method==="GET"&&url.pathname==="/api/admin/videos") return adminIntroVideos(env);
      const videoReview=url.pathname.match(/^\/api\/admin\/videos\/([^/]+)\/(approve|reject)$/);
      if(request.method==="POST"&&videoReview) return reviewIntroVideo(env,decodeURIComponent(videoReview[1]),videoReview[2] as "approve"|"reject",admin.email||"admin_token");
      return json({ok:false,error:"Not found"},{status:404});
    }
    if(request.method==="GET"&&url.pathname==="/api/public/agency-demand-summary") return handleAgencyDemandSummary(env);
    if(request.method==="GET"&&url.pathname==="/api/config") return publicConfig(env,googleSignInConfigured(env));
    if(request.method==="POST"&&url.pathname==="/api/auth/request") return requestEmployerMagicLink(request,env);
    if(request.method==="POST"&&url.pathname==="/api/auth/verify") return verifyEmployerMagicLink(request,env,(employerId,intake)=>applyPendingEmployerIntake(env,employerId,intake),employerId=>employerAccountCookie(env,employerId));
    if(request.method==="GET"&&url.pathname==="/api/session") return hiringSession(request,env);
    if(request.method==="POST"&&url.pathname==="/api/login/request"){ const cross=rejectCrossSiteWrite(request);if(cross)return cross;return requestLogin(request,env); }
    if(request.method==="POST"&&url.pathname==="/api/login/verify"){ const cross=rejectCrossSiteWrite(request);if(cross)return cross;return verifyLogin(request,env); }
    if(request.method==="GET"&&url.pathname==="/api/account") return accountStatus(request,env);
    if(request.method==="POST"&&url.pathname==="/api/account/last-dashboard"){ const cross=rejectCrossSiteWrite(request);if(cross)return cross;return saveLastDashboard(request,env); }
    if(request.method==="POST"&&url.pathname==="/api/account/close"){ const cross=rejectCrossSiteWrite(request);if(cross)return cross;return closeAccountSide(request,env); }
    if(request.method==="GET"&&url.pathname==="/api/auth/google/start") return startGoogleSignIn(request,env);
    if(request.method==="GET"&&url.pathname==="/api/auth/google/callback") return finishGoogleSignIn(request,env);
    // Signing out anywhere signs this browser out of CareJoys entirely, whichever dashboard it was on.
    if(request.method==="POST"&&(url.pathname==="/api/logout"||url.pathname==="/api/auth/logout")){ const cross=rejectCrossSiteWrite(request);if(cross)return cross;return logoutEverywhere(request,env); }
    if(request.method==="POST"&&url.pathname==="/api/employers") return handleEmployer(request,env);
    if(request.method==="POST"&&url.pathname==="/api/caregivers") return handleCaregiver(request,env);
    if(request.method==="POST"&&url.pathname==="/api/caregiver-resume") return handleCaregiverResume(request,env,ctx);
    if(request.method==="GET"&&url.pathname==="/api/public/caregiver-jobs") return getPublicCaregiverJobs(url,env);
    if(request.method==="GET"&&url.pathname==="/api/public/jobs-hub") return getJobsHub(url,env);
    if(request.method==="GET"&&url.pathname==="/api/public/jobs-national") return getNationalJobs(url,env);
    let publicJobContext=url.pathname.match(/^\/api\/public\/caregiver-jobs\/([^/]+)\/context$/);
    if(request.method==="GET"&&publicJobContext) return getPublicJobContext(decodeURIComponent(publicJobContext[1]),env);
    let publicJob=url.pathname.match(/^\/api\/public\/caregiver-jobs\/([^/]+)$/);
    if(request.method==="GET"&&publicJob) return getPublicCaregiverJob(decodeURIComponent(publicJob[1]),env);
    let publicJobApply=url.pathname.match(/^\/api\/public\/caregiver-jobs\/([^/]+)\/apply$/);
    if(request.method==="POST"&&publicJobApply) return handlePublicJobApply(request,env,decodeURIComponent(publicJobApply[1]));
    let publicJobInterest=url.pathname.match(/^\/api\/public\/caregiver-jobs\/([^/]+)\/interest$/);
    if(request.method==="POST"&&publicJobInterest){
      const cross=rejectCrossSiteWrite(request);if(cross)return cross;
      return sendProfileFromJobPage(request,env,decodeURIComponent(publicJobInterest[1]),await caregiverAuthIdentity(request,env));
    }
    if(request.method==="GET"&&url.pathname==="/api/interest-confirm") return getInterestConfirmation(url,env);
    if(request.method==="POST"&&url.pathname==="/api/interest-confirm"){ const cross=rejectCrossSiteWrite(request);if(cross)return cross;return confirmInterestRequest(request,env); }
    const caregiverResumeFile=url.pathname.match(/^\/api\/caregivers\/([^/]+)\/resume-file$/);
    if(request.method==="POST"&&caregiverResumeFile){ const cross=rejectCrossSiteWrite(request);if(cross)return cross;return handleCaregiverResumeFile(request,env,decodeURIComponent(caregiverResumeFile[1])); }
    const caregiverVideo=url.pathname.match(/^\/api\/caregivers\/([^/]+)\/video$/);
    if(request.method==="GET"&&caregiverVideo){
      if(!env.DB)return json({ok:false,error:"Database not configured"},{status:503});
      const employer=await approvedEmployer(request,env);
      if(employer instanceof Response)return employer;
      return employerIntroVideo(env,decodeURIComponent(caregiverVideo[1]));
    }
    let caregiverPhoto=url.pathname.match(/^\/api\/caregivers\/([^/]+)\/photo$/);
    if((request.method==="GET"||request.method==="POST")&&caregiverPhoto){
      if(request.method==="POST"){const cross=rejectCrossSiteWrite(request);if(cross)return cross;}
      return handleCaregiverProfilePhoto(request,env,decodeURIComponent(caregiverPhoto[1]));
    }
    if(request.method==="POST"&&url.pathname==="/api/schools") return handleSchool(request,env);
    const widgetFeed=url.pathname.match(/^\/api\/public\/agency-jobs\/([^/]+)$/);
    if(widgetFeed&&(request.method==="GET"||request.method==="OPTIONS")) return agencyJobsFeed(request,env,decodeURIComponent(widgetFeed[1]));
    if(request.method==="GET"&&url.pathname==="/api/public/training-programs") return listPublicTrainingPrograms(url,env);
    if(request.method==="GET"&&url.pathname==="/api/public/gna-jobs") return getGnaJobs(url,env);
    if(request.method==="GET"&&url.pathname==="/api/public/cna-classes") return getCnaClasses(url,env);
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
      const employer=await approvedEmployer(request,env);
      if(employer instanceof Response)return employer;
      return searchCandidates(url,env);
    }
    if(request.method==="GET"&&url.pathname==="/api/activate") return getActivation(url,env);
    if(request.method==="POST"&&url.pathname==="/api/activate") return completeActivation(request,env);
    if(request.method==="GET"&&url.pathname==="/api/respond") return getCandidateResponse(url,env);
    if(request.method==="POST"&&url.pathname==="/api/respond"){ const cross=rejectCrossSiteWrite(request);if(cross)return cross;return submitCandidateResponse(request,env); }
    if(request.method==="GET"&&url.pathname==="/api/agency/teaser") return getAgencyTeaser(url,env);
    if(request.method==="GET"&&url.pathname==="/api/agency/search") return searchAgencies(url,env);
    if(request.method==="POST"&&url.pathname==="/api/agency/claim/start"){ const cross=rejectCrossSiteWrite(request);if(cross)return cross;return startAgencyClaim(request,env); }
    if(request.method==="GET"&&url.pathname==="/api/agency/suggestions") return agencySuggestions(request,env);
    if(request.method==="GET"&&url.pathname==="/api/agency/jobs") return agencyJobs(request,env);
    let agencyJob=url.pathname.match(/^\/api\/agency\/jobs\/([^/]+)$/);
    if(request.method==="POST"&&agencyJob){ const cross=rejectCrossSiteWrite(request);if(cross)return cross;return updateAgencyJob(request,env,decodeURIComponent(agencyJob[1])); }
    if(request.method==="GET"&&url.pathname==="/api/public/pricing") return json({ok:true,freeContacts:freeContacts(env)},{headers:{"cache-control":"public,max-age=3600"}});
    if(request.method==="GET"&&url.pathname==="/api/public/caregiver-supply") return getCaregiverSupply(url,env);
    if(request.method==="POST"&&url.pathname==="/api/agency/claim/request"){ const cross=rejectCrossSiteWrite(request);if(cross)return cross;return requestAgencyClaim(request,env); }
    if(request.method==="GET"&&url.pathname==="/api/agency/network") return getAgencyNetwork(request,env);
    if(request.method==="GET"&&url.pathname==="/api/agency/inbox") return getAgencyInbox(request,env);
    const inboxResume=url.pathname.match(/^\/api\/agency\/inbox\/([^/]+)\/resume$/);
    if(request.method==="GET"&&inboxResume) return agencyInterestResume(request,env,decodeURIComponent(inboxResume[1]));
    let inboxItem=url.pathname.match(/^\/api\/agency\/inbox\/([^/]+)$/);
    if(request.method==="POST"&&inboxItem){ const cross=rejectCrossSiteWrite(request);if(cross)return cross;return updateAgencyInterest(request,env,decodeURIComponent(inboxItem[1])); }
    if(request.method==="POST"&&url.pathname==="/api/agency/hiring-profile"){ const cross=rejectCrossSiteWrite(request);if(cross)return cross;return updateAgencyHiringProfile(request,env,(employerId,openingId)=>matchOpening(employerId,openingId,env)); }
    if(request.method==="POST"&&url.pathname==="/api/respond/interview"){ const cross=rejectCrossSiteWrite(request);if(cross)return cross;return bookCandidateInterview(request,env); }

    if(url.pathname==="/api/email-templates"&&(request.method==="GET"||request.method==="POST")){
      if(request.method==="POST"){const cross=rejectCrossSiteWrite(request);if(cross)return cross;}
      return handleEmailTemplates(request,env);
    }
    const emailTemplate=url.pathname.match(/^\/api\/email-templates\/([^/]+)$/);
    if(request.method==="DELETE"&&emailTemplate){ const cross=rejectCrossSiteWrite(request);if(cross)return cross;return handleEmailTemplates(request,env,decodeURIComponent(emailTemplate[1])); }
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
      const employer=await approvedEmployer(request,env);
      if(employer instanceof Response)return employer;
      return matchOpening(String(employer.id),m[1],env);
    }
    m=url.pathname.match(/^\/api\/openings\/([^/]+)\/contact$/);
    if(request.method==="POST"&&m){
      const cross=rejectCrossSiteWrite(request);if(cross)return cross;
      const employer=await approvedEmployer(request,env);
      if(employer instanceof Response)return employer;
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
      const employer=await approvedEmployer(request,env);
      if(employer instanceof Response)return employer;
      return getPipeline(String(employer.id),url,env);
    }
    m=url.pathname.match(/^\/api\/pipeline\/([^/]+)\/resume$/);
    if(request.method==="GET"&&m){
      const employer=await approvedEmployer(request,env);
      if(employer instanceof Response)return employer;
      return pipelineResume(String(employer.id),decodeURIComponent(m[1]),env);
    }
    m=url.pathname.match(/^\/api\/pipeline\/([^/]+)$/);
    if(request.method==="PATCH"&&m){
      const cross=rejectCrossSiteWrite(request);if(cross)return cross;
      const employer=await approvedEmployer(request,env);
      if(employer instanceof Response)return employer;
      return updatePipeline(String(employer.id),m[1],request,env);
    }

    if(url.pathname.startsWith("/api/")) return json({ok:false,error:"Not found"},{status:404});
    // Built files (/assets, /og, favicon) skip the Worker via wrangler.jsonc; anything else with an extension is a file request.
    if(/\.[a-z0-9]{2,5}$/i.test(url.pathname)) return env.ASSETS.fetch(request);
    // Every page route is handled above, so what is left is a real 404 rather than the homepage with a 200.
    return seoAsset(request,env,{status:404,title:"Page not found | CareJoys",description:"This page does not exist on CareJoys.",canonical:url.pathname,robots:"noindex,follow",
      snapshot:'<main><h1>Page not found</h1><p><a href="/">CareJoys home</a> · <a href="/caregiver-jobs">Caregiver jobs</a> · <a href="/hire-caregivers">Hire caregivers</a></p></main>'});
  },
  async scheduled(event:{cron?:string;scheduledTime?:number},env:Env,ctx:{waitUntil(promise:Promise<unknown>):void}){
    // Awaiting the work keeps the run alive for the cron's full 15 minutes; waitUntil records its outcome.
    const work=(async()=>{
      if(event.cron==="*/5 * * * *"){
        // Its own failures are recorded on the job row, so they never block the job crawler below.
        await runDataForSeoJobs(env).catch(()=>null);
        await normalizeExistingJobsBatch(env,100).catch(()=>null);
        await repairJobPayBatch(env,500).catch(()=>null);
        await repairJobCityBatch(env,100).catch(()=>null);
        await unpublishNonJobsBatch(env,2000).catch(()=>null);
        // New sites before retries, and one step failing never skips the rest.
        await discoverAgencyJobsBatch(env,24).catch(()=>null);
        await recoverRejectedJobsBatch(env,180).catch(()=>null);
        await retryFailedAgencyJobSourcesBatch(env,6).catch(()=>null);
        return;
      }
      if(event.cron==="2,7,12,17,22,27,32,37,42,47,52,57 * * * *"){
        // CareJoys' own summary for each live job; the page shows nothing from the posting until one exists.
        // A run gets cut off after a few dozen jobs, so summaries run every five minutes.
        await recordedSummaryRun(env,event.cron);
        // Together with the :17 run below, agency websites are checked 120 an hour, 30 per invocation.
        if([2,32,47].includes(new Date(event.scheduledTime??Date.now()).getUTCMinutes()))await enrichAgencyBatch(env,30);
        return;
      }
      if(event.cron==="17 * * * *"){
        await enrichAgencyBatch(env,30);
        await scoreAgencyMatches(env);
        await notifyAgenciesOfInterestsBatch(env,20);
        await sendSchoolPlacementInvites(env).catch(error=>console.error('school outreach failed',error));
        // "Verify your agency needs" email to agencies whose jobs CareJoys lists (Rebecca approved 2026-10-06).
        // The daily cap is spread across the hourly runs so outreach never bursts past the shared email limit.
        if(String(env.AGENCY_HIRING_INVITES_ENABLED||'').toLowerCase()==='true'){
          const cap=Math.max(0,Math.min(500,Number(env.AGENCY_HIRING_INVITE_DAILY_CAP||60)||0));
          const counts=await hiringInviteCounts(env);
          await sendAgencyHiringInvites(env,Math.min(Math.max(1,Math.ceil(cap/24)),cap-counts.today),counts.total===0?'hello@carejoys.com':'').catch(()=>null);
        }
        return;
      }
      if(event.cron==="41 15 * * *"){
        // The last 24 hours of Clarity insights into D1. No-op until CLARITY_API_TOKEN is set.
        await pullClarityInsights(env).catch(()=>null);
        // Caregiver reactivation + agency teasers, capped per day. No-op unless OUTREACH_ENABLED=true.
        // School introductions have a separate enabled flag and cap on the hourly cron.
        await runScheduledOutreach(env);
        // One reminder to legacy caregivers who never confirmed (Rebecca approved 2026-10-08). Each person gets it once.
        await runReactivationReminders(env).catch(()=>null);
        await sendWeeklyJobDigests(env,50).catch(error=>console.error("job digest failed",error));
        return;
      }
      // A schedule none of the branches above recognised: note the exact string so a mismatch shows up in D1.
      await env.DB?.prepare("INSERT INTO outreach_runs(id,kind,trigger,note) VALUES (?,'unmatched_cron',?,NULL)")
        .bind(crypto.randomUUID(),String(event.cron||'')).run().catch(()=>null);
      if(new Date(event.scheduledTime??Date.now()).getUTCMinutes()%5===2)await recordedSummaryRun(env,event.cron);
    })();
    ctx.waitUntil(work);
    await work.catch(()=>null);
  }
};
