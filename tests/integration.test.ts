import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPlatformProxy } from 'wrangler';
import worker from '../src/worker';
import { unsubscribeLink } from '../src/emailPreferences';
import { runOutreach } from '../src/outreach';

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
  for(const t of ['candidate_pipeline','interview_slots','openings','employer_sessions','employer_auth_tokens','availability_events','outreach_events','caregiver_resume_imports','caregiver_referrals','agency_org_candidate_matches','caregivers','employer_leads','email_suppressions','email_unsubscribe_tokens','outreach_runs','analytics_events','rate_limits','employer_billing']){
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
