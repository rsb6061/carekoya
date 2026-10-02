import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPlatformProxy } from 'wrangler';
import worker from '../src/worker';
import { unsubscribeLink } from '../src/emailPreferences';
import { runOutreach } from '../src/outreach';
import { runDataForSeoJobs } from '../src/dataforseo';

// Runs the Worker against a local D1 with every migration applied (see `pretest` in package.json).
type DB=any;
let proxy:Awaited<ReturnType<typeof getPlatformProxy>>;
let DB:DB;
const sent:Array<{to:string;subject:string;headers?:Record<string,string>;html?:string}>=[];
const EMAIL={send:async(m:any)=>{sent.push(m);return {messageId:'test-'+sent.length}}};
const ASSETS={fetch:async()=>new Response('asset')};
const env=(extra:Record<string,unknown>={})=>({DB,EMAIL,ASSETS,...extra}) as any;
const call=(path:string,init:RequestInit={},extra:Record<string,unknown>={})=>worker.fetch(new Request('https://carejoys.com'+path,init),env(extra));

async function sha256Hex(value:string){
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash)).map(b=>b.toString(16).padStart(2,'0')).join('');
}
const SESSION='test-session-token';
const recent=new Date(Date.now()-86400000).toISOString();

async function addCaregiver(id:string,zip:string,extra:Record<string,unknown>={}){
  const row={id,first_name:id,last_name:'Test',email:id+'@example.com',zip,state:'',role:'CNA',work_status:'actively_looking',last_confirmed_at:recent,source:'organic',is_active:1,...extra};
  const keys=Object.keys(row);
  await DB.prepare(`INSERT INTO caregivers(${keys.join(',')}) VALUES (${keys.map(()=>'?').join(',')})`).bind(...Object.values(row)).run();
}

beforeAll(async()=>{
  proxy=await getPlatformProxy({configPath:'tests/wrangler.test.jsonc',persist:{path:'.wrangler/test/v3'}});
  DB=(proxy.env as any).DB;
  for(const t of ['candidate_pipeline','interview_slots','openings','employer_sessions','employer_auth_tokens','availability_events','outreach_events','caregiver_resume_imports','caregiver_referrals','agency_org_candidate_matches','caregivers','employer_leads','email_suppressions','email_unsubscribe_tokens','outreach_runs','analytics_events','rate_limits','employer_billing','login_tokens','account_sessions']){
    await DB.prepare(`DELETE FROM ${t}`).run();
  }
  await addCaregiver('baltimore','21201');
  await addCaregiver('towson','21204');
  await addCaregiver('dc','20001');
  await addCaregiver('la','90001');
  await DB.prepare("INSERT INTO employer_leads(id,company_name,contact_name,email,zip,roles_needed,status) VALUES ('emp1','Acme Care','Pat','pat@acme.test','21201','CNA','active')").run();
  await DB.prepare("INSERT INTO employer_sessions(id,employer_id,session_hash,expires_at) VALUES ('s1','emp1',?,?)").bind(await sha256Hex(SESSION),new Date(Date.now()+86400000).toISOString()).run();
},120000);
afterAll(async()=>{await proxy?.dispose()});

describe('auth boundaries', ()=>{
  it('public health exposes only aggregate counts', async()=>{
    const body=await (await call('/api/health')).json() as any;
    expect(body.ok).toBe(true);
    expect(Object.keys(body.counts).sort()).toEqual(['duplicateCaregiverEmails','publishedCaregiverJobs','scannedJobSources']);
    expect(body.tables).toBeUndefined();
    expect(body.jobScanSamples).toBeUndefined();
  });
  it('admin and stats endpoints require an admin', async()=>{
    for(const path of ['/api/admin/overview','/api/admin/health','/api/activation-stats'])expect((await call(path)).status).toBe(401);
    // A normal employer session is not an admin.
    expect((await call('/api/admin/overview',{headers:{cookie:'cj_session='+SESSION}},{ADMIN_EMAILS:'boss@carejoys.com'})).status).toBe(401);
  });
  it('admin access works by token or by allowlisted employer session', async()=>{
    const byToken=await call('/api/admin/overview?window=all',{headers:{authorization:'Bearer t0ken'}},{ADMIN_TOKEN:'t0ken'});
    expect(byToken.status).toBe(200);
    const body=await byToken.json() as any;
    expect(body.funnel.employerFunnel.map((s:any)=>s.step)).toEqual(['employers','openings','matched','contacted','interested','interviews','hired']);
    expect(body.outreach.enabled).toBe(false);
    expect((await call('/api/admin/health',{headers:{cookie:'cj_session='+SESSION}},{ADMIN_EMAILS:'pat@acme.test'})).status).toBe(200);
  });
  it('caregiver dashboard requires sign-in', async()=>{
    expect((await call('/api/me')).status).toBe(401);
    expect((await call('/api/me/availability',{method:'POST',body:'{}'})).status).toBe(401);
  });
});

describe('employer approval', ()=>{
  it('free-mail employers wait for an admin before seeing caregivers; company emails do not', async()=>{
    await DB.prepare("INSERT INTO employer_leads(id,company_name,contact_name,email,zip,roles_needed,status) VALUES ('empfree','Solo Care','Sam','sam@gmail.com','21201','CNA','active')").run();
    await DB.prepare("INSERT INTO employer_sessions(id,employer_id,session_hash,expires_at) VALUES ('s2','empfree',?,?)").bind(await sha256Hex('free-session'),new Date(Date.now()+86400000).toISOString()).run();
    sent.length=0;
    const asFree=(extra:Record<string,unknown>={})=>call('/api/candidates?zip=21201',{headers:{cookie:'cj_session=free-session'}},{ADMIN_EMAILS:'boss@carejoys.com',...extra});
    const blocked=await asFree();
    expect(blocked.status).toBe(403);
    expect(((await blocked.json()) as any).pendingApproval).toBe(true);
    expect(sent.map(m=>m.to)).toEqual([['boss@carejoys.com']]);
    await asFree();
    expect(sent).toHaveLength(1);
    expect((await call('/api/candidates?zip=21201',{headers:{cookie:'cj_session='+SESSION}})).status).toBe(200);
    const ws=await (await call('/api/workspace',{headers:{cookie:'cj_session=free-session'}})).json() as any;
    expect(ws.approval).toEqual({approved:false,reason:'pending'});
    const approved=await call('/api/admin/employers/empfree/approve',{method:'POST',headers:{authorization:'Bearer t0ken','content-type':'application/json'},body:'{}'},{ADMIN_TOKEN:'t0ken'});
    expect(approved.status).toBe(200);
    expect((await asFree()).status).toBe(200);
  });
});

describe('distance matching', ()=>{
  it('talent search returns caregivers within the radius, nearest-first among equally fresh', async()=>{
    const res=await call('/api/candidates?zip=21201&radius=25',{headers:{cookie:'cj_session='+SESSION}});
    const body=await res.json() as any;
    expect(body.candidates.map((c:any)=>c.id).sort()).toEqual(['baltimore','towson']);
    expect(body.candidates.find((c:any)=>c.id==='towson').distanceMiles).toBeGreaterThan(5);
    const wide=await (await call('/api/candidates?zip=21201&radius=50',{headers:{cookie:'cj_session='+SESSION}})).json() as any;
    expect(wide.candidates.map((c:any)=>c.id).sort()).toEqual(['baltimore','dc','towson']);
  });
  it('opening match uses commute radius and infers location from ZIP', async()=>{
    const created=await call('/api/openings',{method:'POST',headers:{cookie:'cj_session='+SESSION,'content-type':'application/json'},body:JSON.stringify({title:'CNA days',role:'CNA',zip:'21201'})});
    const {id}=await created.json() as any;
    const opening=await DB.prepare('SELECT city,state FROM openings WHERE id=?').bind(id).first();
    expect(opening).toEqual({city:'Baltimore',state:'MD'});
    const match=await (await call(`/api/openings/${id}/match`,{method:'POST',headers:{cookie:'cj_session='+SESSION}})).json() as any;
    expect(match.top.map((c:any)=>c.id).sort()).toEqual(['baltimore','towson']);
  });
  it('caregiver signup infers state and city outside Maryland', async()=>{
    const res=await call('/api/caregivers',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({firstName:'Nia',lastName:'York',email:'nia@example.com',phone:'5550100',zip:'10001',role:'HHA'})});
    expect(res.status).toBe(201);
    const row=await DB.prepare("SELECT city,state FROM caregivers WHERE email='nia@example.com'").first();
    expect(row).toEqual({city:'New York',state:'NY'});
  });
});

describe('outreach', ()=>{
  it('unsubscribe needs a POST and then suppresses the address', async()=>{
    const {link,headers}=await unsubscribeLink(DB,'Optout@Example.com','test');
    expect(headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    const path=link.replace('https://carejoys.com','');
    expect(await (await call(path)).text()).toContain('<form method="post">');
    expect(await DB.prepare("SELECT email FROM email_suppressions").first()).toBeNull();
    await call(path,{method:'POST'});
    expect(await DB.prepare("SELECT email FROM email_suppressions").first()).toEqual({email:'optout@example.com'});
  });
  it('reactivation skips unsubscribed addresses and stops at the daily cap', async()=>{
    await addCaregiver('legacy1','21201',{source:'legacy_carekoya',work_status:'unknown',last_confirmed_at:null});
    await addCaregiver('legacy2','21204',{source:'legacy_carekoya',work_status:'unknown',last_confirmed_at:null});
    await addCaregiver('optout','21204',{source:'legacy_carekoya',work_status:'unknown',last_confirmed_at:null,email:'optout@example.com'});
    sent.length=0;
    const first=await runOutreach(env({REACTIVATION_DAILY_CAP:'1'}),'reactivation','admin') as any;
    expect(first.sent).toBe(1);
    const second=await runOutreach(env({REACTIVATION_DAILY_CAP:'1'}),'reactivation','admin') as any;
    expect(second.skipped).toBe('daily_cap_reached');
    const third=await runOutreach(env({REACTIVATION_DAILY_CAP:'5'}),'reactivation','admin') as any;
    expect(third.sent).toBe(1);
    expect(sent.map(m=>m.to)).not.toContain('optout@example.com');
    expect(sent[0].headers?.['List-Unsubscribe']).toMatch(/^<https:\/\/carejoys\.com\/api\/unsubscribe\?token=/);
    expect(sent[0].html).toContain('/activate?token=');
    // The emailed activation link works.
    const token=decodeURIComponent(sent[0].html!.match(/activate\?token=([^"&]+)/)![1]);
    expect((await call('/api/activate?token='+encodeURIComponent(token))).status).toBe(200);
  });
  it('admin test send emails only the signed-in admin and counts toward nothing', async()=>{
    sent.length=0;
    const runCount=async()=>((await DB.prepare("SELECT COUNT(*) AS n FROM outreach_runs").first()) as {n:number}).n;
    const before=await runCount();
    const post=(kind:string)=>call('/api/admin/outreach/test',{method:'POST',headers:{cookie:'cj_session='+SESSION,origin:'https://carejoys.com','content-type':'application/json'},body:JSON.stringify({kind})},{ADMIN_EMAILS:'pat@acme.test'});
    expect((await post('reactivation')).status).toBe(200);
    expect((await post('agency_teasers')).status).toBe(200);
    expect(sent.map(m=>m.to)).toEqual(['pat@acme.test','pat@acme.test']);
    expect(sent.every(m=>m.subject.startsWith('[Test] '))).toBe(true);
    expect(await runCount()).toBe(before);
  });
  it('admin agency walkthrough sends a live teaser for a hidden test agency', async()=>{
    sent.length=0;
    const post=(body:object)=>call('/api/admin/agency-test',{method:'POST',headers:{cookie:'cj_session='+SESSION,origin:'https://carejoys.com','content-type':'application/json'},body:JSON.stringify(body)},{ADMIN_EMAILS:'pat@acme.test'});
    const res=await post({});
    expect(res.status).toBe(200);
    expect((await res.json() as any).result.candidateCount).toBeGreaterThan(0);
    expect(sent.map(m=>m.to)).toEqual(['pat@acme.test']);
    expect(sent[0].subject.startsWith('[Test] ')).toBe(true);
    const token=decodeURIComponent((sent[0].html||'').match(/agency\?token=([^"&\s]+)/)![1]);
    const teaser=await (await call('/api/agency/teaser?token='+encodeURIComponent(token))).json() as any;
    expect(teaser.agency.name).toBe('CareJoys Test Agency');
    expect(teaser.candidateCount).toBeGreaterThan(0);
    // Hidden from public search and not counted as real outreach.
    expect((await (await call('/api/agency/search?q=carejoys')).json() as any).agencies).toEqual([]);
    expect(await DB.prepare("SELECT COUNT(*) AS n FROM agency_outreach_events WHERE event_type='candidate_teaser'").first()).toEqual({n:0});
    expect((await post({reset:true})).status).toBe(200);
    expect((await call('/api/agency/teaser?token='+encodeURIComponent(token))).status).toBe(404);
  });
  it('scheduled outreach does nothing until enabled', async()=>{
    sent.length=0;
    const waits:Promise<unknown>[]=[];
    await worker.scheduled({cron:'41 15 * * *'},env(),{waitUntil:(p)=>{waits.push(p)}});
    await Promise.all(waits);
    expect(sent).toHaveLength(0);
  });
});

describe('billing gate', ()=>{
  it('blocks contacting past the free allowance only when Stripe is configured', async()=>{
    const stripe={STRIPE_SECRET_KEY:'sk_test',STRIPE_PRICE_ID:'price_test',FREE_CONTACTS:'0'};
    const {id}=await (await call('/api/openings',{method:'POST',headers:{cookie:'cj_session='+SESSION,'content-type':'application/json'},body:JSON.stringify({title:'HHA',role:'CNA',zip:'21201'})})).json() as any;
    await call(`/api/openings/${id}/match`,{method:'POST',headers:{cookie:'cj_session='+SESSION}});
    await DB.prepare("INSERT INTO interview_slots(id,opening_id,employer_id,starts_at,duration_minutes,timezone) VALUES ('slot1',?,'emp1',?,30,'UTC')").bind(id,new Date(Date.now()+86400000).toISOString()).run();
    const blocked=await call(`/api/openings/${id}/contact`,{method:'POST',headers:{cookie:'cj_session='+SESSION},body:'{}'},stripe);
    expect(blocked.status).toBe(402);
    const status=await (await call('/api/billing',{headers:{cookie:'cj_session='+SESSION}},stripe)).json() as any;
    expect(status).toMatchObject({enabled:true,subscribed:false,freeContactsRemaining:0});
    await DB.prepare("INSERT INTO employer_billing(employer_id,status) VALUES ('emp1','active')").run();
    const allowed=await (await call(`/api/openings/${id}/contact`,{method:'POST',headers:{cookie:'cj_session='+SESSION},body:'{}'},stripe)).json() as any;
    expect(allowed.sent).toBeGreaterThan(0);
    expect((await (await call('/api/billing',{headers:{cookie:'cj_session='+SESSION}})).json() as any).enabled).toBe(false);
  });
});

describe('analytics', ()=>{
  it('stores page views without query strings', async()=>{
    await call('/api/events',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'page_view',path:'/activate?token=secret',referrer:'https://www.google.com/search?q=x',utmSource:'newsletter'})});
    const row=await DB.prepare('SELECT path,referrer_host,utm_source FROM analytics_events').first();
    expect(row).toEqual({path:'/activate',referrer_host:'google.com',utm_source:'newsletter'});
  });
});

const HTML_SHELL='<!doctype html><html><head><title>CareJoys</title><meta name="description" content="x" /><link rel="canonical" href="https://carejoys.com/" /></head><body><div id="root"></div></body></html>';
const htmlAssets={ASSETS:{fetch:async()=>new Response(HTML_SHELL,{headers:{'content-type':'text/html; charset=utf-8'}})}};
const post=(path:string,body:unknown,headers:Record<string,string>={},extra:Record<string,unknown>={})=>call(path,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)},extra);

describe('audit fixes: onboarding', ()=>{
  const profile={firstName:'Ada',lastName:'Lane',phone:'4105550100',zip:'21201',role:'CNA'};
  it('caregiver resume creates a new profile without sign-in, but will not overwrite an existing one', async()=>{
    const created=await post('/api/caregiver-resume',{...profile,email:'ada.new@example.com'});
    expect(created.status).toBe(201);
    const body=await created.json() as any;
    expect(Array.isArray(body.topJobs)).toBe(true);
    const takeover=await post('/api/caregiver-resume',{...profile,firstName:'Mallory',email:'baltimore@example.com'});
    expect(takeover.status).toBe(409);
    expect((await takeover.json() as any).needsVerifiedSignIn).toBe(true);
    expect(await DB.prepare("SELECT first_name FROM caregivers WHERE id='baltimore'").first()).toEqual({first_name:'baltimore'});
  });
  it('employer intake for an existing email changes nothing until the emailed link is used', async()=>{
    sent.length=0;
    const res=await post('/api/employers',{companyName:'Evil Co',contactName:'Eve',email:'pat@acme.test',zip:'21201',rolesNeeded:'HHA'});
    expect(res.status).toBe(201);
    expect(await DB.prepare("SELECT company_name FROM employer_leads WHERE id='emp1'").first()).toEqual({company_name:'Acme Care'});
    expect(await DB.prepare("SELECT count(*) AS n FROM openings WHERE employer_id='emp1' AND source='employer_intake'").first()).toEqual({n:0});
    const token=decodeURIComponent(sent[0].html!.match(/token=([^"&]+)/)![1]);
    const verified=await post('/api/auth/verify',{token});
    expect(verified.status).toBe(200);
    expect((await verified.json() as any).redirect).toContain('opening=');
    expect(await DB.prepare("SELECT count(*) AS n FROM openings WHERE employer_id='emp1' AND source='employer_intake'").first()).toEqual({n:1});
  });
});

describe('audit fixes: SEO responses', ()=>{
  beforeAll(async()=>{
    await DB.prepare("DELETE FROM agency_teaser_tokens WHERE organization_id='org-test'").run();
    await DB.prepare("DELETE FROM agency_outreach_events WHERE organization_id='org-test'").run();
    await DB.prepare("DELETE FROM caregiver_jobs WHERE agency_organization_id='org-test'").run();
    await DB.prepare("DELETE FROM agency_organizations WHERE id='org-test'").run();
    await DB.prepare("INSERT INTO agency_organizations(id,organization_key,canonical_name,primary_domain,primary_website,city,state,is_active) VALUES ('org-test','org-test','Sunrise Home Care','sunrisecare.test','https://sunrisecare.test','Baltimore','MD',1)").run();
    await DB.prepare("INSERT INTO caregiver_jobs(id,agency_organization_id,dedupe_key,source_provider,source_url,title,role,employer_name,city,state,zip,pay_min,pay_max,pay_period,status,is_published) VALUES ('job-test','org-test','job-test','test','https://sunrisecare.test/jobs/1','CNA - Day Shift','CNA','Sunrise Home Care','Baltimore','MD','21201',18,22,'hour','current',1)").run();
  });
  it('job pages carry JobPosting data and missing jobs are gone', async()=>{
    const page=await call('/jobs/job-test',{},htmlAssets);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('"@type":"JobPosting"');
    expect((await call('/jobs/does-not-exist',{},htmlAssets)).status).toBe(410);
  });
  it('unknown pages are a real 404 and www redirects to the apex', async()=>{
    expect((await call('/definitely-not-a-page',{},htmlAssets)).status).toBe(404);
    const www=await worker.fetch(new Request('https://www.carejoys.com/about'),env(htmlAssets));
    expect(www.status).toBe(301);
    expect(www.headers.get('location')).toBe('https://carejoys.com/about');
  });
  it('sitemap is an index of child sitemaps', async()=>{
    const index=await (await call('/sitemap.xml')).text();
    expect(index).toContain('<sitemapindex');
    expect(index).toContain('/sitemaps/pages.xml');
    expect(await (await call('/sitemaps/jobs-1.xml')).text()).toContain('/jobs/job-test');
  });
  it('state hubs render for any state', async()=>{
    const md=await call('/caregiver-jobs/maryland',{},htmlAssets);
    expect(md.status).toBe(200);
    expect(await md.text()).toContain('CNA - Day Shift');
    const hub=await (await call('/api/public/jobs-hub?state=MD')).json() as any;
    expect(hub.total).toBeGreaterThan(0);
  });
});

describe('audit fixes: agency self-serve', ()=>{
  it('a work email at the agency domain gets a link that claims the agency', async()=>{
    sent.length=0;
    const start=await post('/api/agency/claim/start',{organizationId:'org-test',email:'owner@sunrisecare.test'});
    expect(start.status).toBe(200);
    expect(sent.map(m=>m.to)).toEqual(['owner@sunrisecare.test']);
    const token=decodeURIComponent(sent[0].html!.match(/token=([^"&]+)/)![1]);
    const verified=await post('/api/auth/verify',{token});
    const cookieHeader=verified.headers.get('set-cookie')!;
    const session=decodeURIComponent(cookieHeader.match(/cj_session=([^;]+)/)![1]);
    const org=await DB.prepare("SELECT claimed_employer_id FROM agency_organizations WHERE id='org-test'").first() as any;
    expect(org.claimed_employer_id).toBeTruthy();
    // The new owner can hide a scraped job, and it drops off public pages.
    const auth={cookie:'cj_session='+session};
    expect((await (await call('/api/agency/jobs',{headers:auth})).json() as any).jobs.map((j:any)=>j.id)).toEqual(['job-test']);
    expect((await post('/api/agency/jobs/job-test',{action:'hide'},auth)).status).toBe(200);
    expect(await DB.prepare("SELECT is_published FROM caregiver_jobs WHERE id='job-test'").first()).toEqual({is_published:0});
    expect((await call('/jobs/job-test',{},htmlAssets)).status).toBe(410);
  });
  it('an email outside the agency domain cannot claim it', async()=>{
    expect((await post('/api/agency/claim/start',{organizationId:'org-test',email:'someone@gmail.com'})).status).toBe(409);
  });
});

describe('DataForSEO pull in the Worker', ()=>{
  const listing=(n:number,extra:Record<string,unknown>={})=>({title:'Agency '+n,category:'Home help service agency',place_id:'place-'+n,cid:String(n),
    phone:'+1804555'+String(1000+n),url:'https://agency'+n+'.example/',address_info:{address:n+' Main St',city:'Richmond',zip:'23219',region:'Virginia'},
    rating:{value:4.5,votes_count:n},...extra});
  function fakeApi(pages:any[][],total:number){
    const calls:any[]=[];
    const original=globalThis.fetch;
    globalThis.fetch=(async(_url:string,init:any)=>{
      const task=JSON.parse(init.body)[0];
      calls.push(task);
      const virginia=task.filters?.[0]?.[2]==='Virginia'&&task.categories?.[0]==='home_help_service_agency';
      if(task.limit===1)return new Response(JSON.stringify({status_code:20000,cost:0.01,tasks:[{status_code:20000,result:[{total_count:virginia?total:0,items:[]}]}]}));
      const page=pages.shift()||[];
      return new Response(JSON.stringify({status_code:20000,cost:0.5,tasks:[{status_code:20000,result:[{total_count:total,items:page,offset_token:pages.length?'next':''}]}]}));
    }) as any;
    return {calls,restore:()=>{globalThis.fetch=original}};
  }
  const creds={DATAFORSEO_LOGIN:'me@example.com',DATAFORSEO_PASSWORD:'pw'};
  const job=(id:string,mode:string,maxCost=10)=>DB.prepare("INSERT INTO dataforseo_import_jobs(id,states,mode,max_cost) VALUES (?,?,?,?)").bind(id,'VA',mode,maxCost).run();
  const status=(id:string)=>DB.prepare('SELECT * FROM dataforseo_import_jobs WHERE id=?').bind(id).first();

  it('an estimate only counts listings', async()=>{
    await DB.prepare("DELETE FROM dataforseo_import_jobs").run();
    await job('est','estimate');
    const api=fakeApi([],1500);
    try{await runDataForSeoJobs(env(creds))}finally{api.restore()}
    const row=await status('est') as any;
    expect(row.status).toBe('estimated');
    expect(row.listings).toBe(1500);
    expect(api.calls.every(c=>c.limit===1)).toBe(true);
    expect(JSON.parse(row.plan_json)).toEqual([expect.objectContaining({state:'VA',category:'home_help_service_agency',filterValue:'Virginia',total:1500})]);
  });

  it('an import pages through listings, saves agencies and retires stale ones', async()=>{
    await DB.prepare("DELETE FROM dataforseo_import_jobs").run();
    await DB.prepare("DELETE FROM agencies WHERE source='google_business'").run();
    await DB.prepare("INSERT INTO agencies(id,source,source_key,name,state,is_active,last_source_sync_at) VALUES ('old','google_business','place:gone','Closed Agency','VA',1,'2020-01-01 00:00:00')").run();
    await job('imp','import');
    const api=fakeApi([[listing(1),listing(2),listing(3,{address_info:{region:'Maryland'}})],[listing(4),listing(5,{title:'Richmond Medical Supply'})]],5);
    try{
      await runDataForSeoJobs(env(creds)); // probes
      expect((await status('imp') as any).status).toBe('running');
      await runDataForSeoJobs(env(creds)); // both pages
    }finally{api.restore()}
    const row=await status('imp') as any;
    expect(row.status).toBe('done');
    expect(row.agencies).toBe(4);
    expect(api.calls.filter(c=>c.limit===1000)[1].offset_token).toBe('next');
    const saved=(await DB.prepare("SELECT name,state,phone,website,rating,caregiver_match_eligible,is_active FROM agencies WHERE source='google_business' ORDER BY name").all()).results as any[];
    expect(saved.map(r=>r.name)).toEqual(['Agency 1','Agency 2','Agency 4','Closed Agency','Richmond Medical Supply']);
    expect(saved.find(r=>r.name==='Agency 1')).toMatchObject({state:'VA',phone:'(804) 555-1001',website:'https://agency1.example/',rating:4.5,caregiver_match_eligible:1,is_active:1});
    expect(saved.find(r=>r.name==='Richmond Medical Supply').caregiver_match_eligible).toBe(0);
    expect(saved.find(r=>r.name==='Closed Agency').is_active).toBe(0);
  });

  it('stops before passing the spend cap', async()=>{
    await DB.prepare("DELETE FROM dataforseo_import_jobs").run();
    await job('cap','import',0.6);
    const api=fakeApi([[listing(1)],[listing(2)],[listing(3)]],3000);
    try{await runDataForSeoJobs(env(creds));await runDataForSeoJobs(env(creds))}finally{api.restore()}
    const row=await status('cap') as any;
    expect(row.status).toBe('stopped');
    expect(row.spent).toBeLessThanOrEqual(0.6+0.5);
    expect(api.calls.filter(c=>c.limit===1000).length).toBe(1);
  });

  it('fails clearly without credentials', async()=>{
    await DB.prepare("DELETE FROM dataforseo_import_jobs").run();
    await job('nocreds','estimate');
    await runDataForSeoJobs(env());
    const row=await status('nocreds') as any;
    expect(row.status).toBe('failed');
    expect(row.error).toMatch(/DATAFORSEO_LOGIN/);
  });
});

describe('shared sign-in', ()=>{
  const ACCOUNT=/__Host-cj_account=([^;]+)/;
  async function signIn(email:string,next=''){
    sent.length=0;
    const requested=await post('/api/login/request',{email,next});
    expect(requested.status).toBe(200);
    expect(sent.map(m=>m.to)).toEqual([email]);
    const token=decodeURIComponent(sent[0].html!.match(/signin\?token=([^"&]+)/)![1]);
    const verified=await post('/api/login/verify',{token});
    expect(verified.status).toBe(200);
    const cookies=verified.headers.get('set-cookie')||'';
    const account=decodeURIComponent(cookies.match(ACCOUNT)![1]);
    const employer=cookies.match(/__Host-cj_session=([^;]+)/);
    const cookie='__Host-cj_account='+account+(employer?'; __Host-cj_session='+employer[1]:'');
    return {body:await verified.json() as any,cookie,token};
  }

  it('a caregiver signs in by email and lands on their dashboard', async()=>{
    const {body,cookie,token}=await signIn('baltimore@example.com');
    expect(body.redirect).toBe('/me');
    const me=await (await call('/api/me',{headers:{cookie}})).json() as any;
    expect(me.caregiver.id).toBe('baltimore');
    // An email sign-in is not an Auth0 subject, so nothing is written there.
    expect(await DB.prepare("SELECT auth0_sub FROM caregivers WHERE id='baltimore'").first()).toEqual({auth0_sub:null});
    // Links work once.
    expect((await post('/api/login/verify',{token})).status).toBe(400);
  });

  it('a signed-in caregiver can update the profile that blocked an anonymous resubmit', async()=>{
    const {cookie}=await signIn('towson@example.com');
    const res=await post('/api/caregiver-resume',{firstName:'Tia',lastName:'Test',email:'towson@example.com',phone:'4105550101',zip:'21204',role:'GNA'},{cookie});
    expect(res.status).toBe(200);
    expect(await DB.prepare("SELECT first_name,role FROM caregivers WHERE id='towson'").first()).toEqual({first_name:'Tia',role:'GNA'});
  });

  it('an agency or employer lands in the hiring workspace with the same sign-in', async()=>{
    const {body,cookie}=await signIn('pat@acme.test');
    expect(body.redirect).toBe('/app');
    expect(body.roles).toEqual({caregiver:false,employer:true,admin:false});
    const session=await (await call('/api/session',{headers:{cookie}})).json() as any;
    expect(session.employer.id).toBe('emp1');
  });

  it('a new email lands on the welcome page and can set up hiring without a second email', async()=>{
    const {body,cookie}=await signIn('new.owner@homecare.test','/app');
    expect(body.redirect).toBe('/welcome');
    const account=await (await call('/api/account',{headers:{cookie}})).json() as any;
    expect(account).toMatchObject({signedIn:true,email:'new.owner@homecare.test',roles:{caregiver:false,employer:false}});
    sent.length=0;
    const res=await post('/api/employers',{companyName:'Home Care Co',contactName:'Nia',email:'new.owner@homecare.test',zip:'21201',rolesNeeded:'CNA'},{cookie});
    expect(res.status).toBe(201);
    const created=await res.json() as any;
    expect(created.redirect).toContain('/app?opening=');
    expect(sent.length).toBe(0);
    expect(res.headers.get('set-cookie')).toContain('__Host-cj_session=');
    expect(((await (await call('/api/account',{headers:{cookie}})).json()) as any).roles.employer).toBe(true);
  });

  it('never sends anyone off-site or into /admin without being an admin', async()=>{
    expect((await signIn('ada.new@example.com','//evil.example/x')).body.redirect).toBe('/me');
    expect((await signIn('ada.new@example.com','/admin')).body.redirect).toBe('/welcome');
    expect((await signIn('ada.new@example.com','/jobs/abc')).body.redirect).toBe('/jobs/abc');
  });

  it('signing out ends every session in the browser', async()=>{
    const {cookie}=await signIn('pat@acme.test');
    const out=await call('/api/logout',{method:'POST',headers:{cookie}});
    expect(out.headers.get('set-cookie')).toContain('__Host-cj_account=;');
    expect(((await (await call('/api/account',{headers:{cookie}})).json()) as any).signedIn).toBe(false);
    expect((await call('/api/session',{headers:{cookie}})).status).toBe(401);
  });
});

describe('agency walkthrough from a real agency', ()=>{
  const admin=(path:string,body?:object)=>call(path,body?{method:'POST',headers:{cookie:'cj_session='+SESSION,origin:'https://carejoys.com','content-type':'application/json'},body:JSON.stringify(body)}:{headers:{cookie:'cj_session='+SESSION}},{ADMIN_EMAILS:'pat@acme.test'});
  beforeAll(async()=>{
    await DB.prepare("INSERT OR REPLACE INTO agency_organizations(id,organization_key,canonical_name,primary_domain,primary_website,primary_email,city,state,zip,provider_types,is_active) VALUES ('org-real','org-real','Harbor Home Health','harbor.test','https://harbor.test','jobs@harbor.test','Towson','MD','21204','Residential Service Agency',1)").run();
    await DB.prepare("INSERT OR REPLACE INTO caregiver_jobs(id,agency_organization_id,dedupe_key,source_provider,source_url,title,role,employer_name,city,state,zip,pay_min,pay_max,pay_period,status,is_published) VALUES ('job-real','org-real','job-real','test','https://harbor.test/jobs/1','HHA - Weekends','HHA','Harbor Home Health','Towson','MD','21204',17,20,'hour','current',1)").run();
    await DB.prepare("INSERT OR REPLACE INTO agency_org_candidate_matches(id,organization_id,caregiver_id,fit_score,geography_score,role_score,freshness_score,provider_score,match_reason,status) VALUES ('m-real','org-real','towson',80,40,10,15,15,'{}','matched')").run();
    await DB.prepare("INSERT OR REPLACE INTO employer_leads(id,company_name,contact_name,email,zip,roles_needed,status) VALUES ('emp-walk','Walk','Rebecca','rebecca+agency@example.com','21204','HHA','active')").run();
    await DB.prepare("INSERT OR REPLACE INTO employer_sessions(id,employer_id,session_hash,expires_at) VALUES ('s-walk','emp-walk',?,?)").bind(await sha256Hex('walk-session'),new Date(Date.now()+86400000).toISOString()).run();
  });

  it('lists real agencies with data and copies one into the hidden test agency', async()=>{
    const list=await (await admin('/api/admin/agencies?q=harbor')).json() as any;
    expect(list.agencies[0]).toMatchObject({id:'org-real',name:'Harbor Home Health',jobs:1,matches:1});
    sent.length=0;
    const res=await admin('/api/admin/agency-test',{sourceId:'org-real',to:'rebecca+agency@example.com'});
    expect(res.status).toBe(200);
    expect((await res.json() as any).result).toMatchObject({agencyName:'Harbor Home Health (test copy)',candidateCount:1,jobCount:1,email:'rebecca+agency@example.com'});
    // Only the admin's chosen inbox hears about it; the real agency is untouched.
    expect(sent.map(m=>m.to)).toEqual(['rebecca+agency@example.com']);
    expect(await DB.prepare("SELECT claimed_employer_id,teaser_send_count FROM agency_organizations WHERE id='org-real'").first()).toEqual({claimed_employer_id:null,teaser_send_count:0});
    // The copied job never goes public.
    expect(await DB.prepare("SELECT is_published FROM caregiver_jobs WHERE agency_organization_id='carejoys-test-agency'").first()).toEqual({is_published:0});
    expect((await call('/jobs/test-job-real',{},htmlAssets)).status).not.toBe(200);
  });

  it('the claimed copy shows its jobs as live, and hide/show never publishes them', async()=>{
    await DB.prepare("UPDATE agency_organizations SET claimed_employer_id='emp-walk' WHERE id='carejoys-test-agency'").run();
    const auth={cookie:'cj_session=walk-session'};
    const jobs=(await (await call('/api/agency/jobs',{headers:auth})).json() as any).jobs;
    expect(jobs.map((j:any)=>[j.id,j.published])).toEqual([['test-job-real',true]]);
    expect((await post('/api/agency/jobs/test-job-real',{action:'hide'},auth)).status).toBe(200);
    expect((await post('/api/agency/jobs/test-job-real',{action:'show'},auth)).status).toBe(200);
    expect(await DB.prepare("SELECT is_published,publication_reason FROM caregiver_jobs WHERE id='test-job-real'").first()).toEqual({is_published:0,publication_reason:'test_agency_copy'});
    expect((await admin('/api/admin/agency-test',{reset:true})).status).toBe(200);
    expect(await DB.prepare("SELECT COUNT(*) AS n FROM caregiver_jobs WHERE agency_organization_id='carejoys-test-agency'").first()).toEqual({n:0});
  });
});
