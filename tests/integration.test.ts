import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPlatformProxy } from 'wrangler';
import worker from '../src/worker';
import { unsubscribeLink } from '../src/emailPreferences';
import { runOutreach } from '../src/outreach';
import { runDataForSeoJobs } from '../src/dataforseo';
import { pullClarityInsights } from '../src/clarity';
import { sendAgencyHiringInvites, friendlyAgencyName } from '../src/agencyFeatures';

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
  const row={id,first_name:id,last_name:'Test',email:id+'@example.com',zip,state:'',role:'CNA',work_status:'actively_looking',last_confirmed_at:recent,source:'organic',is_active:1,auth0_email_verified:1,...extra};
  const keys=Object.keys(row);
  await DB.prepare(`INSERT INTO caregivers(${keys.join(',')}) VALUES (${keys.map(()=>'?').join(',')})`).bind(...Object.values(row)).run();
}

beforeAll(async()=>{
  proxy=await getPlatformProxy({configPath:'tests/wrangler.test.jsonc',persist:{path:'.wrangler/test/v3'}});
  DB=(proxy.env as any).DB;
  for(const t of ['caregiver_intro_videos','worker_funnel_events','worker_funnel_links','caregiver_job_alert_preferences','caregiver_resume_files','candidate_pipeline','interview_slots','openings','employer_sessions','employer_auth_tokens','availability_events','outreach_events','caregiver_resume_imports','caregiver_referrals','agency_org_candidate_matches','caregivers','employer_leads','email_suppressions','email_unsubscribe_tokens','outreach_runs','analytics_events','rate_limits','employer_billing','login_tokens','account_sessions']){
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
  it('pricing supply check returns only counts and hides small ones', async()=>{
    expect((await call('/api/public/caregiver-supply?zip=abc')).status).toBe(400);
    const body=await (await call('/api/public/caregiver-supply?zip=21201')).json() as any;
    expect(body.ok).toBe(true);
    expect(Object.keys(body).sort()).toEqual(['caregivers','caregiversBelow','city','found','jobs','miles','ok','state','zip']);
    // Baltimore has two seeded verified caregivers: too few to show as a number.
    expect(body.caregivers).toBeNull();
    expect(body.caregiversBelow).toBe(5);
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

describe('admin privileges do not approve an employer account',()=>{
  it('shows the owner’s separate test employer in the approval queue and requires a manual click',async()=>{
    const email='myersrebeccal@gmail.com';
    await DB.prepare("INSERT INTO employer_leads(id,company_name,contact_name,email,zip,roles_needed,status) VALUES ('acre-test','AcrePermit','Owner',?,'21030','CNA','active')").bind(email).run();
    await DB.prepare("INSERT INTO employer_sessions(id,employer_id,session_hash,expires_at) VALUES ('acre-session','acre-test',?,?)")
      .bind(await sha256Hex('acre-session-cookie'),new Date(Date.now()+86400000).toISOString()).run();
    const sessionHeaders={cookie:'cj_session=acre-session-cookie'};
    const dashboard=await call('/api/workspace',{headers:sessionHeaders});
    expect((await dashboard.json() as any).approval).toEqual({approved:false,reason:'pending'});
    expect((await call('/api/candidates?zip=21030',{headers:sessionHeaders})).status).toBe(403);
    const result=await (await call('/api/admin/overview',{headers:{authorization:'Bearer administrator'}},{ADMIN_TOKEN:'administrator'})).json() as any;
    const row=result.employers.find((e:any)=>e.id==='acre-test');
    expect(row?.approval).toBe('pending');
    const approval=await call('/api/admin/employers/acre-test/approve',{method:'POST',headers:{authorization:'Bearer administrator','content-type':'application/json'},body:'{}'},{ADMIN_TOKEN:'administrator'});
    expect(approval.status).toBe(200);
    const approved=await call('/api/workspace',{headers:sessionHeaders});
    expect((await approved.json() as any).approval).toEqual({approved:true,reason:'manual'});
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
    // Default directory browse exposes eligible nationwide supply but ranks realistic
    // local commutes ahead of distant caregivers, instead of silently cutting to 25 mi.
    const all=await (await call('/api/candidates?zip=21201&radius=all',{headers:{cookie:'cj_session='+SESSION}})).json() as any;
    expect(all.radiusMiles).toBeNull();
    expect(all.candidates.map((c:any)=>c.id).sort()).toEqual(['baltimore','dc','la','towson']);
    expect(all.candidates.slice(0,2).map((c:any)=>c.id)).toEqual(['baltimore','towson']);
    expect(all.candidates.find((c:any)=>c.id==='la').distanceMiles).toBeGreaterThan(100);
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

describe('employer booking and approval gates', ()=>{
  it('notifies administrators when a pending employer opens their workspace, without exposing matches',async()=>{
    await DB.prepare("INSERT INTO employer_leads(id,company_name,contact_name,email,zip,roles_needed,status) VALUES ('review2','Pending Care','Pat','other@outlook.com','21201','CNA','active')").run();
    await DB.prepare("INSERT INTO employer_sessions(id,employer_id,session_hash,expires_at) VALUES ('review2session','review2',?,?)")
      .bind(await sha256Hex('review2-cookie'),new Date(Date.now()+86400000).toISOString()).run();
    sent.length=0;
    const signed={headers:{cookie:'cj_session=review2-cookie'}};
    const ws=await call('/api/workspace',signed,{ADMIN_EMAILS:'boss@carejoys.com'});
    expect(ws.status).toBe(200);
    expect((await ws.json() as any).approval.approved).toBe(false);
    expect(sent.map(x=>x.to)).toEqual([['boss@carejoys.com']]);
    await call('/api/workspace',signed,{ADMIN_EMAILS:'boss@carejoys.com'});
    expect(sent).toHaveLength(1);
    const opening=await (await call('/api/openings',{method:'POST',headers:{cookie:'cj_session=review2-cookie','content-type':'application/json'},body:JSON.stringify({title:'CNA',role:'CNA',zip:'21201'})})).json() as any;
    const deny=await call('/api/openings/'+opening.id+'/match',{method:'POST',headers:{cookie:'cj_session=review2-cookie'}},{ADMIN_EMAILS:'boss@carejoys.com'});
    expect(deny.status).toBe(403);
  });
  it('creates, displays and safely removes unbooked interview slots',async()=>{
    const opening=await (await call('/api/openings',{method:'POST',headers:{cookie:'cj_session='+SESSION,'content-type':'application/json'},body:JSON.stringify({title:'CNA mornings',role:'CNA',zip:'21201'})})).json() as any;
    const path='/api/openings/'+opening.id+'/interview-slots';
    const headers={cookie:'cj_session='+SESSION,'content-type':'application/json'};
    const start=new Date(Date.now()+2*86400000).toISOString();
    const add=await call(path,{method:'POST',headers,body:JSON.stringify({slots:[{startsAt:start,timezone:'America/New_York',durationMinutes:30}]})});
    expect(add.status).toBe(200);
    expect((await add.json() as any).added).toBe(1);
    const slots=(await (await call(path,{headers})).json() as any).slots;
    expect(slots).toHaveLength(1);
    const drop=await call(path,{method:'POST',headers,body:JSON.stringify({action:'cancel',slotId:slots[0].id})});
    expect(drop.status).toBe(200);
    expect((await (await call(path,{headers})).json() as any).slots[0].status).toBe('cancelled');
    expect((await call(path,{method:'POST',headers,body:JSON.stringify({action:'cancel',slotId:slots[0].id})})).status).toBe(409);
    // Removal leaves no availability, but introductions remain an independent feature.
    const noSlots=await call('/api/openings/'+opening.id+'/contact',{method:'POST',headers,body:'{}'});
    expect(noSlots.status).toBe(200);
  });
});

describe('optional interview scheduling and verified owner admin', ()=>{
  it('sends an introduction without interview slots and reveals contact email only after the worker explicitly agrees', async()=>{
    const headers={cookie:'cj_session='+SESSION,'content-type':'application/json'};
    const opened=await call('/api/openings',{method:'POST',headers,body:JSON.stringify({title:'CNA day position',role:'CNA',zip:'21201'})});
    const id=(await opened.json() as any).id;
    const match=await call('/api/openings/'+id+'/match',{method:'POST',headers});
    expect(match.status).toBe(200);
    sent.length=0;
    const contact=await call('/api/openings/'+id+'/contact',{method:'POST',headers,body:JSON.stringify({limit:2})});
    const outcome=await contact.json() as any;
    expect(contact.status).toBe(200);
    expect(outcome.sent).toBeGreaterThan(0);
    const before=await (await call('/api/pipeline?openingId='+id,{headers})).json() as any;
    expect(before.pipeline.every((p:any)=>p.contact_email==null)).toBe(true);
    const invite=sent.find(m=>m.to==='baltimore@example.com');
    expect(invite?.html).toContain('/respond?token=');
    const token=decodeURIComponent(invite!.html!.match(/respond\?token=([^"&\s]+)/)![1]);
    const interest=await call('/api/respond',{method:'POST',headers:{'content-type':'application/json',origin:'https://carejoys.com'},body:JSON.stringify({token,choice:'interested'})});
    expect(interest.status).toBe(200);
    const after=await (await call('/api/pipeline?openingId='+id,{headers})).json() as any;
    expect(after.pipeline.find((p:any)=>p.caregiver_id==='baltimore')?.contact_email).toBe('baltimore@example.com');
    const employerNotice=sent.find(m=>m.subject.startsWith('Interested candidate:'));
    expect(employerNotice?.html).toContain('baltimore@example.com');
    const slots=await (await call('/api/openings/'+id+'/interview-slots',{headers})).json() as any;
    expect(slots.slots).toHaveLength(0);
    // The optional scheduling flow must work after a caregiver accepts an invitation.
    const startsAt=new Date(Date.now()+2*86400000).toISOString();
    const created=await call('/api/openings/'+id+'/interview-slots',{method:'POST',headers,body:JSON.stringify({
      slots:[{startsAt,timezone:'America/New_York',durationMinutes:30}]
    })});
    expect(created.status).toBe(200);
    expect((await created.json() as any).added).toBe(1);
    const available=(await (await call('/api/openings/'+id+'/interview-slots',{headers})).json() as any).slots;
    expect(available).toHaveLength(1);
    const response=(await (await call('/api/respond?token='+encodeURIComponent(token))).json() as any).opportunity;
    expect(response.slots.some((s:any)=>s.id===available[0].id)).toBe(true);
    const booking=await call('/api/respond/interview',{method:'POST',headers:{'content-type':'application/json',origin:'https://carejoys.com'},body:JSON.stringify({
      token,slotId:available[0].id
    })});
    expect(booking.status).toBe(200);
    const booked=(await (await call('/api/openings/'+id+'/interview-slots',{headers})).json() as any).slots;
    expect(booked[0].status).toBe('booked');
    const piped=(await (await call('/api/pipeline?openingId='+id,{headers})).json() as any).pipeline;
    expect(piped.find((p:any)=>p.caregiver_id==='baltimore')?.stage).toBe('interview');
    expect(sent.some(m=>m.subject.includes('Interview')&&m.to==='baltimore@example.com')).toBe(true);
    expect(sent.some(m=>m.subject.includes('Interview')&&m.to==='pat@acme.test')).toBe(true);
    expect((await call('/api/respond/interview',{method:'POST',headers:{'content-type':'application/json',origin:'https://carejoys.com'},body:JSON.stringify({token,slotId:available[0].id})})).status).toBe(409);
  });
  it('authorizes the designated owner only after a real email-based account session',async()=>{
    const owner='myersrebeccal@gmail.com';
    const other='unapproved_admin@example.com';
    expect((await DB.prepare('SELECT email FROM admin_authorizations WHERE email=?').bind(owner).first()) as any).toMatchObject({email:owner});
    for(const [label,email] of [['owner',owner],['outsider',other]]){
      const secret='admin-test-'+label;
      await DB.prepare('INSERT INTO account_sessions(id,email,session_hash,expires_at) VALUES (?,?,?,?)')
        .bind(crypto.randomUUID(),email,await sha256Hex(secret),new Date(Date.now()+86400000).toISOString()).run();
      const check=await call('/api/admin/overview',{headers:{cookie:'__Host-cj_account='+secret}});
      expect(check.status).toBe(label==='owner'?200:401);
    }
    sent.length=0;
    const response=await call('/api/admin/auth/request',{method:'POST',headers:{'content-type':'application/json',origin:'https://carejoys.com'},body:JSON.stringify({email:owner})});
    expect(response.status).toBe(200);
    expect(sent.some(m=>m.to===owner)).toBe(true);
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
    expect(Array.isArray(teaser.jobs)).toBe(true);
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

describe('site-owner tags', ()=>{
  const ids={CLARITY_PROJECT_ID:'abc123xyz',GOOGLE_SITE_VERIFICATION:'g-token_1',BING_SITE_VERIFICATION:'B1NG'};
  it('adds Clarity and verification tags to public pages only when configured', async()=>{
    const plain=await (await call('/privacy-policy',{},htmlAssets)).text();
    expect(plain).not.toContain('clarity.ms');
    expect(plain).not.toContain('google-site-verification');
    const html=await (await call('/privacy-policy',{},{...htmlAssets,...ids})).text();
    expect(html).toContain('<meta name="google-site-verification" content="g-token_1" />');
    expect(html).toContain('<meta name="msvalidate.01" content="B1NG" />');
    expect(html).toContain('"clarity","script","abc123xyz"');
  });
  it('never loads Clarity on signed-in pages', async()=>{
    for(const path of ['/dashboard','/admin','/app']){
      const html=await (await call(path,{},{...htmlAssets,...ids})).text();
      expect(html).not.toContain('clarity.ms');
      expect(html).toContain('google-site-verification');
    }
  });
});

describe('clarity data export', ()=>{
  it('saves one row per breakdown, skips a second pull the same day, and stops on quota errors', async()=>{
    await DB.prepare('DELETE FROM clarity_insights').run();
    const urls:string[]=[];
    const ok=async(url:any,init:any)=>{urls.push(String(url));expect(init.headers.authorization).toBe('Bearer tok');
      return new Response(JSON.stringify([{metricName:'Traffic',information:[{totalSessionCount:'12'}]}]),{status:200});};
    expect(await pullClarityInsights(env(),{fetcher:ok as any})).toEqual({ok:false,error:'CLARITY_API_TOKEN not set'});
    const first=await pullClarityInsights(env({CLARITY_API_TOKEN:'tok'}),{fetcher:ok as any}) as any;
    expect(Object.values(first.results)).toEqual(['ok','ok','ok','ok','ok']);
    expect(urls[0]).toBe('https://www.clarity.ms/export-data/api/v1/project-live-insights?numOfDays=1');
    expect(urls[1]).toContain('&dimension1=URL');
    const again=await pullClarityInsights(env({CLARITY_API_TOKEN:'tok'}),{fetcher:ok as any}) as any;
    expect(Object.values(again.results).every(v=>v==='already pulled')).toBe(true);
    expect(urls.length).toBe(5);
    let calls=0;
    const limited=async()=>{calls++;return new Response('Too many',{status:429});};
    const forced=await pullClarityInsights(env({CLARITY_API_TOKEN:'tok'}),{force:true,fetcher:limited as any}) as any;
    expect(calls).toBe(1);
    expect(forced.results.total).toBe('http_429');
    // A failed re-pull keeps the data already saved.
    expect(await DB.prepare("SELECT payload IS NOT NULL AS kept FROM clarity_insights WHERE dimension=''").first()).toEqual({kept:1});
    const view=await (await call('/api/admin/clarity',{headers:{authorization:'Bearer t0ken'}},{ADMIN_TOKEN:'t0ken'})).json() as any;
    expect(view.rows.find((r:any)=>r.dimension==='URL').data[0].metricName).toBe('Traffic');
  });
});


describe('worker acquisition: optional phone and linked 24-hour retention',()=>{
  it('links a job preview, creates a phone-free profile, persists opt-in, verifies email and records a genuine later job view',async()=>{
    const visitor=crypto.randomUUID(),email='worker-retention@careworker.test';
    const preview=await call('/api/public/job-preview?zip=21201&role=CNA',{headers:{'X-CareJoys-Funnel-Id':visitor}});
    expect(preview.status).toBe(200);
    expect(await DB.prepare('SELECT COUNT(*) AS n FROM worker_funnel_events WHERE visitor_id=?').bind(visitor).first()).toEqual({n:1});
    const create=await call('/api/caregiver-resume',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({
      firstName:'Worker',lastName:'Retention',email,zip:'21201',role:'CNA',funnelVisitorId:visitor,jobAlertsEmailOptIn:true
    })});
    expect(create.status).toBe(201);
    const {id}=await create.json() as any;
    expect(await DB.prepare('SELECT phone,auth0_email_verified FROM caregivers WHERE id=?').bind(id).first()).toEqual({phone:'',auth0_email_verified:0});
    expect(await DB.prepare('SELECT visitor_id FROM worker_funnel_links WHERE caregiver_id=?').bind(id).first()).toEqual({visitor_id:visitor});
    expect(await DB.prepare('SELECT email_enabled FROM caregiver_job_alert_preferences WHERE caregiver_id=?').bind(id).first()).toEqual({email_enabled:1});
    const auth=await call('/api/login/request',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email})});
    expect(auth.status).toBe(200);
    const ownerMail=sent.find(m=>m.to===email);
    expect(ownerMail?.html).toContain('token=');
    const token=decodeURIComponent(ownerMail!.html!.match(/token=([^"&]+)/)![1]);
    const verified=await call('/api/login/verify',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token})});
    expect(verified.status).toBe(200);
    expect(await DB.prepare('SELECT auth0_email_verified FROM caregivers WHERE id=?').bind(id).first()).toEqual({auth0_email_verified:1});
    const cookie=verified.headers.get('set-cookie')?.match(/__Host-cj_account=([^;]+)/)?.[1];
    expect(cookie).toBeTruthy();
    // Seed a published job unrelated to public inventory timing, then simulate a 24h-old worker.
    await DB.prepare("INSERT OR REPLACE INTO agency_organizations(id,organization_key,canonical_name,primary_domain,primary_website,city,state,is_active) VALUES ('funnel-org','funnel-org','Funnel Care','funnel.test','https://funnel.test','Baltimore','MD',1)").run();
    await DB.prepare("INSERT OR REPLACE INTO caregiver_jobs(id,agency_organization_id,dedupe_key,source_provider,source_url,title,role,employer_name,city,state,zip,status,is_published) VALUES ('funnel-job','funnel-org','funnel-job','test','https://funnel.test/jobs','CNA day','CNA','Funnel Care','Baltimore','MD','21201','current',1)").run();
    const event=await call('/api/me/worker-activity',{method:'POST',headers:{cookie:'__Host-cj_account='+cookie,'content-type':'application/json'},body:JSON.stringify({jobId:'funnel-job'})});
    expect(event.status).toBe(200);
    const early=await (await call('/api/admin/overview?window=30',{headers:{authorization:'Bearer t0ken'}},{ADMIN_TOKEN:'t0ken'})).json() as any;
    expect(early.funnel.workerFunnel.signups).toBeGreaterThanOrEqual(1);
    expect(early.funnel.workerFunnel.verified).toBeGreaterThanOrEqual(1);
    // A same-day revisit is not 24-hour retention.
    const before=early.funnel.workerFunnel.returned;
    await DB.prepare("UPDATE caregivers SET created_at=datetime('now','-2 days') WHERE id=?").bind(id).run();
    await DB.prepare("UPDATE worker_funnel_events SET created_at=datetime('now','-3 days') WHERE visitor_id=?").bind(visitor).run();
    const mature=await (await call('/api/admin/overview?window=30',{headers:{authorization:'Bearer t0ken'}},{ADMIN_TOKEN:'t0ken'})).json() as any;
    expect(mature.funnel.workerFunnel.returned).toBe(before+1);
    expect(mature.funnel.workerFunnel.eligibleReturn).toBeGreaterThanOrEqual(1);
    expect(mature.funnel.workerFunnel.withJobs+mature.funnel.workerFunnel.emptyPreviews).toBeGreaterThanOrEqual(1);
  });
  it('does not count anonymous previews as returning workers or allow unauthenticated activity',async()=>{
    const visitor=crypto.randomUUID();
    expect((await call('/api/me/worker-activity',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jobId:'funnel-job'})})).status).toBe(401);
    await call('/api/public/job-preview?zip=21201&role=CNA',{headers:{'X-CareJoys-Funnel-Id':visitor}});
    const result=await (await call('/api/admin/overview?window=30',{headers:{authorization:'Bearer t0ken'}},{ADMIN_TOKEN:'t0ken'})).json() as any;
    expect(result.funnel.workerFunnel.previews).toBeGreaterThanOrEqual(2);
  });
});

describe('pay preferences and verified caregiver availability',()=>{
  it('keeps unsigned profiles hidden, stores an hourly floor and requires explicit availability',async()=>{
    const email='pay-floor-worker@realcare.test';
    const req={firstName:'Pay',lastName:'Floor',email,zip:'21201',role:'CNA',desiredWage:'$24–30/hr'};
    const created=await post('/api/caregiver-resume',req);
    expect(created.status).toBe(201);
    const {id}=await created.json() as any;
    expect(await DB.prepare('SELECT phone,hourly_rate_min,desired_wage,work_status,last_confirmed_at FROM caregivers WHERE id=?').bind(id).first())
      .toEqual({phone:'',hourly_rate_min:24,desired_wage:'$24+/hr',work_status:'unknown',last_confirmed_at:null});
    const search=await (await call('/api/candidates?zip=21201',{headers:{cookie:'cj_session='+SESSION}})).json() as any;
    expect(search.candidates.some((c:any)=>c.id===id)).toBe(false);
    const invalid=await post('/api/caregiver-resume',{firstName:'Bad',lastName:'Pay',email:'invalid-pay-worker@realcare.test',zip:'21201',role:'CNA',desiredWage:'50000/year'});
    expect(invalid.status).toBe(400);
    sent.length=0;
    const login=await post('/api/login/request',{email});
    expect(login.status).toBe(200);
    const token=decodeURIComponent(sent.find(x=>x.to===email)!.html!.match(/signin\?token=([^"&]+)/)![1]);
    const proof=await post('/api/login/verify',{token});
    expect(proof.status).toBe(200);
    expect((await DB.prepare('SELECT auth0_email_verified,work_status FROM caregivers WHERE id=?').bind(id).first())).toEqual({auth0_email_verified:1,work_status:'unknown'});
    const cookie=proof.headers.get('set-cookie')?.match(/__Host-cj_account=([^;]+)/)?.[1];
    expect(cookie).toBeTruthy();
    const confirm=await post('/api/me/availability',{workStatus:'actively_looking'},{cookie:'__Host-cj_account='+cookie});
    expect(confirm.status).toBe(200);
    const after=await (await call('/api/candidates?zip=21201',{headers:{cookie:'cj_session='+SESSION}})).json() as any;
    expect(after.candidates.some((c:any)=>c.id===id)).toBe(true);
  });
  it('shows separate agency and school outreach campaigns with their actual configured status',async()=>{
    const res=await call('/api/admin/overview',{headers:{authorization:'Bearer t0ken'}},{ADMIN_TOKEN:'t0ken',AGENCY_HIRING_INVITES_ENABLED:'true',AGENCY_HIRING_INVITE_DAILY_CAP:'20',OUTREACH_ENABLED:'false',WEEKLY_DIGEST_ENABLED:'true'});
    expect(res.status).toBe(200);
    const body=await res.json() as any;
    expect(body.funnel.outreachChannels.agencyHiring.enabled).toBe(true);
    expect(body.funnel.outreachChannels.agencyHiring.cap).toBe(20);
    expect(body.funnel.outreachChannels.agencyHiring.perHour).toBe(1);
    expect(body.funnel.outreachChannels.agencyInboxAlerts.unclaimedEnabled).toBe(false);
    expect(body.funnel.outreachChannels.weeklyDigest.enabled).toBe(true);
    expect(typeof body.funnel.outreachChannels.reactivationReminders.sent).toBe('number');
    expect(body.funnel.outreachChannels.generalBulk.enabled).toBe(false);
    expect(body.funnel.outreachChannels.schools.mode).toBe('manual');
  });
});

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
  it('GNA jobs and Baltimore CNA classes pages list Maryland jobs and programs', async()=>{
    const add=(id:string,role:string,city:string,zip:string)=>DB.prepare("INSERT OR REPLACE INTO caregiver_jobs(id,agency_organization_id,dedupe_key,source_provider,source_url,title,role,employer_name,city,state,zip,status,is_published) VALUES (?,'org-test',?,'test',?,?,?,'Sunrise Home Care',?,'MD',?,'current',1)")
      .bind(id,id,'https://sunrisecare.test/jobs/'+id,role+' Evenings',role,city,zip).run();
    await add('gna-balt','GNA','Towson','21204');await add('cna-balt','CNA','Parkville','21234');
    await add('gna-fred','GNA','Frederick','21701');await add('hha-balt','HHA','Towson','21204');
    await DB.prepare("INSERT OR REPLACE INTO training_organizations(id,organization_key,canonical_name,slug,credential_categories,is_active) VALUES ('torg-balt','torg-balt','Harbor CNA Academy','harbor-cna-academy','CNA/GNA',1),('torg-fred','torg-fred','Frederick CNA School','frederick-cna-school','CNA/GNA',1)").run();
    await DB.prepare("INSERT OR REPLACE INTO training_programs(id,source,source_key,organization_id,program_name,provider_type,zip,is_active) VALUES ('tp-balt','test','tp-balt','torg-balt','Harbor CNA Academy','Freestanding Program','21201',1),('tp-fred','test','tp-fred','torg-fred','Frederick CNA School','Freestanding Program','21701',1)").run();
    try{
      const md=await (await call('/gna-jobs/maryland',{},htmlAssets)).text();
      expect(md).toContain('<h1>GNA jobs in Maryland</h1>');
      expect(md).toContain('/jobs/gna-fred');
      expect(md).not.toContain('/jobs/hha-balt');
      const balt=await (await call('/gna-jobs/maryland/baltimore',{},htmlAssets)).text();
      expect(balt).toContain('/jobs/gna-balt');
      expect(balt).toContain('/jobs/cna-balt');
      expect(balt).not.toContain('/jobs/gna-fred');
      // GNA postings come before CNA ones.
      expect(balt.indexOf('/jobs/gna-balt')).toBeLessThan(balt.indexOf('/jobs/cna-balt'));
      const api=await (await call('/api/public/gna-jobs?area=baltimore')).json() as any;
      const ids=api.jobs.map((j:any)=>j.id);
      expect(ids[0]).toBe('gna-balt');
      expect(ids).toContain('cna-balt');
      expect(ids).not.toContain('gna-fred');
      expect(api.gna).toBe(1);
      expect((await call('/gna-jobs/texas',{},htmlAssets)).status).toBe(404);
      expect((await call('/gna-jobs/maryland/maryland',{},htmlAssets)).status).toBe(404);
      expect((await call('/gna-jobs')).headers.get('location')).toBe('https://carejoys.com/gna-jobs/maryland');
      const classes=await (await call('/cna-classes/baltimore',{},htmlAssets)).text();
      expect(classes).toContain('<h1>CNA classes in Baltimore, MD</h1>');
      expect(classes).toContain('href="/training-programs/harbor-cna-academy"');
      expect(classes).not.toContain('frederick-cna-school');
      expect((await call('/cna-classes/maryland')).headers.get('location')).toBe('https://carejoys.com/training-programs/maryland');
      const pages=await (await call('/sitemaps/pages.xml')).text();
      expect(pages).toContain('/gna-jobs/maryland/baltimore<');
      expect(pages).toContain('/cna-classes/baltimore<');
    }finally{
      await DB.prepare("DELETE FROM caregiver_jobs WHERE id IN ('gna-balt','cna-balt','gna-fred','hha-balt')").run();
      await DB.prepare("DELETE FROM training_programs WHERE id IN ('tp-balt','tp-fred')").run();
      await DB.prepare("DELETE FROM training_organizations WHERE id IN ('torg-balt','torg-fred')").run();
    }
  });
  it('the Baltimore metro page rolls up suburb jobs and suburb pages link up to it', async()=>{
    const add=(id:string,city:string,zip:string)=>DB.prepare("INSERT OR REPLACE INTO caregiver_jobs(id,agency_organization_id,dedupe_key,source_provider,source_url,title,role,employer_name,city,state,zip,status,is_published) VALUES (?,'org-test',?,'test',?,'GNA Evenings','GNA','Sunrise Home Care',?,'MD',?,'current',1)")
      .bind(id,id,'https://sunrisecare.test/jobs/'+id,city,zip).run();
    await add('job-towson-1','Towson','21204');await add('job-towson-2','Towson','21204');await add('job-towson-3','Towson','21286');
    await add('job-parkville','Parkville','21234');
    // A job mislabeled "Phoenix, MD" with an Arizona ZIP stays out of the metro.
    await add('job-phoenix-az','Phoenix','85004');
    try{
    const page=await call('/caregiver-jobs/maryland/baltimore',{},htmlAssets);
    expect(page.status).toBe(200);
    const html=await page.text();
    expect(html).toContain('<h1>CNA and caregiver jobs in the Baltimore area</h1>');
    // The Baltimore job seeded above plus four suburb jobs.
    expect(html).toContain('6 current caregiver and CNA jobs in the Baltimore area');
    expect(html).toContain('<a href="/caregiver-jobs/maryland/towson">Towson</a>: 3 jobs');
    expect(html).not.toContain('noindex');
    const towson=await (await call('/caregiver-jobs/maryland/towson',{},htmlAssets)).text();
    expect(towson).toContain('<a href="/caregiver-jobs/maryland/baltimore">See all 6 caregiver jobs in the Baltimore area</a>');
    const api=await (await call('/api/public/jobs-hub?state=MD&city=baltimore')).json() as any;
    expect(api.total).toBe(6);
    expect(api.metro).toEqual({name:'Baltimore',area:'Baltimore City and Baltimore County'});
    const sitemap=await (await call('/sitemaps/locations.xml')).text();
    expect(sitemap.match(/caregiver-jobs\/maryland\/baltimore</g)?.length).toBe(1);
    }finally{
      await DB.prepare("DELETE FROM caregiver_jobs WHERE id IN ('job-towson-1','job-towson-2','job-towson-3','job-parkville','job-phoenix-az')").run();
    }
  });
  it('/caregiver-jobs lists every state with jobs and the search box resolves places', async()=>{
    await DB.prepare("INSERT OR REPLACE INTO caregiver_jobs(id,agency_organization_id,dedupe_key,source_provider,source_url,title,role,employer_name,city,state,zip,status,is_published) VALUES ('job-tx','org-test','job-tx','test','https://sunrisecare.test/jobs/2','HHA Weekends','HHA','Sunrise Home Care','San Antonio','TX','78201','current',1)").run();
    const page=await call('/caregiver-jobs',{},htmlAssets);
    expect(page.status).toBe(200);
    const html=await page.text();
    expect(html).toContain('<link rel="canonical" href="https://carejoys.com/caregiver-jobs" />');
    expect(html).toContain('href="/caregiver-jobs/maryland"');
    expect(html).toContain('href="/caregiver-jobs/texas"');
    const api=await (await call('/api/public/jobs-national')).json() as any;
    expect(api.states.map((s:any)=>s.code).sort()).toEqual(['MD','TX']);
    const go=async(q:string)=>(await call('/caregiver-jobs?q='+encodeURIComponent(q),{},htmlAssets));
    expect((await go('Texas')).headers.get('location')).toBe('https://carejoys.com/caregiver-jobs/texas');
    expect((await go('md')).headers.get('location')).toBe('https://carejoys.com/caregiver-jobs/maryland');
    expect((await go('san antonio')).headers.get('location')).toBe('https://carejoys.com/caregiver-jobs/texas/san-antonio');
    expect((await go('Baltimore, MD')).headers.get('location')).toBe('https://carejoys.com/caregiver-jobs/maryland/baltimore');
    expect((await go('Austin TX')).headers.get('location')).toBe('https://carejoys.com/caregiver-jobs/texas');
    // A ZIP or an unknown place stays on the page, out of the index.
    const zip=await go('21201');
    expect(zip.status).toBe(200);
    expect(await zip.text()).toContain('noindex');
    expect((await go('Nowhereville')).status).toBe(200);
    const sitemap=await (await call('/sitemaps/locations.xml')).text();
    expect(sitemap).toContain('<loc>https://carejoys.com/caregiver-jobs</loc>');
    // Texas has one job here, under STATE_PAGE_MIN_JOBS, so its page stays out of the sitemap.
    expect(sitemap).not.toContain('/caregiver-jobs/texas<');
    await DB.prepare("DELETE FROM caregiver_jobs WHERE id='job-tx'").run();
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
    // Once claimed, the agency's website widget can read its jobs from any origin.
    const widget=await call('/api/public/agency-jobs/org-test');
    expect(widget.headers.get('access-control-allow-origin')).toBe('*');
    const feed=await widget.json() as any;
    expect(feed.jobs.map((j:any)=>[j.id,j.url])).toEqual([['job-test','https://carejoys.com/jobs/job-test?ref=widget']]);
    expect((await call('/api/public/agency-jobs/no-such-org')).status).toBe(404);
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
    expect(body.redirect).toBe('/dashboard');
    const me=await (await call('/api/me',{headers:{cookie}})).json() as any;
    expect(me.caregiver.id).toBe('baltimore');
    // The whole saved profile comes back, so applying to a job doesn't ask for it again.
    for(const key of ['firstName','lastName','phone','zip','role','shifts','transportation','specialties'])expect(me.caregiver).toHaveProperty(key);
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
    expect(body.roles).toEqual({caregiver:false,employer:true,admin:false,school:false});
    const session=await (await call('/api/session',{headers:{cookie}})).json() as any;
    expect(session.employer.id).toBe('emp1');
  });

  it('a new agency lands in the hiring workspace and can set it up without a second email', async()=>{
    const {body,cookie}=await signIn('new.owner@homecare.test','/app');
    expect(body.redirect).toBe('/app');
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

  it('the hiring workspace opens from the shared sign-in when its own session is missing', async()=>{
    const {cookie}=await signIn('pat@acme.test');
    const accountOnly=cookie.split('; ')[0];
    const res=await call('/api/session',{headers:{cookie:accountOnly}});
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).employer.id).toBe('emp1');
    expect(res.headers.get('set-cookie')).toContain('__Host-cj_session=');
    // A caregiver-only sign-in still has no workspace.
    const caregiver=(await signIn('baltimore@example.com')).cookie;
    expect((await call('/api/session',{headers:{cookie:caregiver}})).status).toBe(401);
  });

  it('signing in as someone else drops a workspace session left in the browser', async()=>{
    sent.length=0;
    await post('/api/login/request',{email:'baltimore@example.com'});
    const token=decodeURIComponent(sent[0].html!.match(/signin\?token=([^"&]+)/)![1]);
    const verified=await post('/api/login/verify',{token},{cookie:'__Host-cj_session='+SESSION});
    const cookies=verified.headers.get('set-cookie')||'';
    expect(cookies).toContain('__Host-cj_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0');
    expect(cookies).toContain('__Host-cj_school_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0');
  });

  it('an emailed workspace link also signs in to the shared account', async()=>{
    sent.length=0;
    await post('/api/auth/request',{email:'pat@acme.test'});
    const token=decodeURIComponent(sent[0].html!.match(/auth\?token=([^"&]+)/)![1]);
    const verified=await post('/api/auth/verify',{token});
    expect(verified.status).toBe(200);
    const cookies=verified.headers.get('set-cookie')||'';
    expect(cookies).toContain('__Host-cj_session=');
    const account=decodeURIComponent(cookies.match(ACCOUNT)![1]);
    const status=await (await call('/api/account',{headers:{cookie:'__Host-cj_account='+account}})).json() as any;
    expect(status).toMatchObject({signedIn:true,email:'pat@acme.test',roles:{employer:true}});
  });

  it('admins reach /admin through the shared sign-in alone', async()=>{
    await DB.prepare('DELETE FROM rate_limits').run();
    const {cookie}=await signIn('pat@acme.test');
    const accountOnly=cookie.split('; ')[0];
    expect((await call('/api/admin/health',{headers:{cookie:accountOnly}},{ADMIN_EMAILS:'pat@acme.test'})).status).toBe(200);
    expect((await call('/api/admin/health',{headers:{cookie:accountOnly}},{ADMIN_EMAILS:'boss@carejoys.com'})).status).toBe(401);
  });

  it('a new device opens the dashboard this account used last', async()=>{
    await DB.prepare('DELETE FROM rate_limits').run();
    await DB.prepare("INSERT INTO caregivers(id,first_name,last_name,email,zip,state,role) VALUES ('pat-cg2','Pat','Lee','pat@acme.test','21201','MD','CNA')").run();
    const {cookie}=await signIn('pat@acme.test');
    expect((await post('/api/account/last-dashboard',{kind:'me'},{cookie})).status).toBe(200);
    expect((await post('/api/account/last-dashboard',{kind:'nope'},{cookie})).status).toBe(400);
    expect((await post('/api/account/last-dashboard',{kind:'me'})).status).toBe(401);
    // No cookie on this browser, so the account's own memory decides.
    expect((await signIn('pat@acme.test')).body.redirect).toBe('/dashboard');
    await post('/api/account/last-dashboard',{kind:'app'},{cookie});
    expect((await signIn('pat@acme.test')).body.redirect).toBe('/app');
    await DB.prepare("DELETE FROM caregivers WHERE id='pat-cg2'").run();
    await DB.prepare("DELETE FROM account_preferences").run();
  });

  it('a person can close their hiring workspace or remove their caregiver profile, and come back', async()=>{
    await DB.prepare('DELETE FROM rate_limits').run();
    await DB.prepare("INSERT INTO employer_leads(id,company_name,contact_name,email,zip,roles_needed,status) VALUES ('emp-close','Close Co','Cy','cy@close.test','21201','CNA','active')").run();
    await addCaregiver('cy','21201',{email:'cy@close.test'});
    const {cookie}=await signIn('cy@close.test');
    expect((await post('/api/account/close',{side:'nope'},{cookie})).status).toBe(400);
    const hiring=await post('/api/account/close',{side:'hiring'},{cookie});
    expect(hiring.status).toBe(200);
    expect(await hiring.json()).toMatchObject({roles:{caregiver:true,employer:false},redirect:'/dashboard'});
    expect(hiring.headers.get('set-cookie')).toContain('__Host-cj_session=; ');
    expect((await call('/api/session',{headers:{cookie}})).status).toBe(401);
    const caregiver=await (await post('/api/account/close',{side:'caregiver'},{cookie})).json() as any;
    expect(caregiver.roles).toMatchObject({caregiver:false,employer:false});
    expect(await DB.prepare("SELECT work_status,is_active FROM caregivers WHERE id='cy'").first()).toEqual({work_status:'closed',is_active:0});
    expect(((await (await call('/api/me',{headers:{cookie}})).json()) as any).caregiver).toBe(null);
    expect(((await (await call('/api/candidates?zip=21201',{headers:{cookie:'cj_session='+SESSION}})).json()) as any).candidates.some((c:any)=>c.caregiverId==='cy'||c.id==='cy')).toBe(false);
    // Building a profile again with the same signed-in email brings it back.
    const back=await post('/api/caregiver-resume',{firstName:'Cy',lastName:'Test',email:'cy@close.test',phone:'4105550102',zip:'21201',role:'CNA'},{cookie});
    expect(back.status).toBe(200);
    expect(((await (await call('/api/account',{headers:{cookie}})).json()) as any).roles.caregiver).toBe(true);
  });

  it('signed-in visitors skip the marketing home page for their own dashboard', async()=>{
    await DB.prepare('DELETE FROM rate_limits').run();
    const caregiver=(await signIn('baltimore@example.com')).cookie;
    const res=await call('/',{headers:{cookie:caregiver},redirect:'manual'});
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/dashboard');
    const agency=(await signIn('pat@acme.test')).cookie.split('; ')[0];
    expect((await call('/',{headers:{cookie:agency+'; cj_last_dashboard=app'},redirect:'manual'})).headers.get('location')).toBe('/app');
    // Signed out, or a stale cookie: the normal home page.
    expect((await call('/',{redirect:'manual'})).status).toBe(200);
    expect((await call('/',{headers:{cookie:'__Host-cj_account=stale'},redirect:'manual'})).status).toBe(200);
  });

  it('the public config no longer mentions Auth0', async()=>{
    const config=await (await call('/api/config')).json() as any;
    expect(config).not.toHaveProperty('auth0Domain');
    expect(config).toHaveProperty('googleSignIn');
  });

  it('an email with both roles returns to the dashboard it used last', async()=>{
    await DB.prepare("INSERT INTO caregivers(id,first_name,last_name,email,zip,state,role) VALUES ('pat-cg','Pat','Lee','pat@acme.test','21201','MD','CNA')").run();
    expect((await signIn('pat@acme.test')).body.redirect).toBe('/app');
    sent.length=0;
    await post('/api/login/request',{email:'pat@acme.test'});
    const token=decodeURIComponent(sent[0].html!.match(/signin\?token=([^"&]+)/)![1]);
    const verified=await post('/api/login/verify',{token},{cookie:'cj_last_dashboard=me'});
    expect(((await verified.json()) as any).redirect).toBe('/dashboard');
    await DB.prepare("DELETE FROM caregivers WHERE id='pat-cg'").run();
  });

  it('training-program staff sign in like everyone else and land on their placement dashboard', async()=>{
    await DB.prepare("INSERT INTO school_leads(id,organization_name,contact_name,email,status) VALUES ('sl-test','Test Nursing School','Dana Lee','dana@school.test','claimed')").run();
    await DB.prepare("INSERT INTO training_programs(id,source,source_key,program_name,claimed_school_lead_id) VALUES ('tp-test','test','tp-test','Test CNA Program','sl-test')").run();
    const {body,cookie}=await signIn('dana@school.test');
    expect(body.roles.school).toBe(true);
    expect(body.redirect).toBe('/school-dashboard');
    const dash=await call('/api/school/dashboard',{headers:{cookie}});
    expect(dash.status).toBe(200);
    expect(((await dash.json()) as any).school.name).toBe('Test CNA Program');
    expect(((await (await call('/api/account',{headers:{cookie}})).json()) as any).name).toBe('Dana');
    await DB.prepare("DELETE FROM training_programs WHERE id='tp-test'").run();
    await DB.prepare("DELETE FROM school_leads WHERE id='sl-test'").run();
  });

  it('a caregiver saves their full profile, including when they can work', async()=>{
    const {cookie}=await signIn('baltimore@example.com');
    const res=await post('/api/me/profile',{firstName:'Bea',lastName:'More',phone:'4105550123',zip:'21201',role:'CNA',
      certifications:['CNA','CPR / First Aid'],licenseNumber:'A123',licenseState:'md',yearsExperience:4,specialties:['Hoyer lift'],careSettings:['Home care'],languages:['English'],
      availability:{days:{mon:['morning','overnight'],sat:['morning'],tue:['bogus']},liveIn:true},employmentTypes:['full_time','nope'],startAvailability:'2_weeks',
      workConditions:['pets'],payMin:19,transportation:'own_car',travelMiles:15},{cookie});
    expect(res.status).toBe(200);
    const row=await DB.prepare("SELECT shift_preferences,employment_types,license_state,desired_wage,work_status FROM caregivers WHERE id='baltimore'").first() as any;
    expect(row).toEqual({shift_preferences:'Mornings, Overnights, Weekends, Live-in',employment_types:'full_time',license_state:'MD',desired_wage:'$19+/hr',work_status:'actively_looking'});
    const me=await (await call('/api/me',{headers:{cookie}})).json() as any;
    expect(me.caregiver.availability.days.mon).toEqual(['morning','overnight']);
    expect(me.caregiver.availability.days.tue).toEqual([]);
    expect(me.caregiver.availability.liveIn).toBe(true);
    expect(me.caregiver.workConditions).toEqual(['pets']);
  });

  it('a caregiver previews their card exactly as employers see it, without contact details', async()=>{
    expect((await call('/api/me/employer-view')).status).toBe(401);
    const {cookie}=await signIn('baltimore@example.com');
    const view=await (await call('/api/me/employer-view',{headers:{cookie}})).json() as any;
    expect(view.visible).toBe(true);
    expect(view.candidate.name).toBe('Bea M.');
    expect(view.candidate.shifts).toBe('Mornings, Overnights, Weekends, Live-in');
    expect(view.candidate.schedule).toBe('Mon: mornings, overnights · Sat: mornings');
    expect(JSON.stringify(view)).not.toMatch(/4105550123|baltimore@example\.com/);
  });

  it('old /me links redirect to the caregiver dashboard at /dashboard', async()=>{
    const res=await call('/me/profile?x=1',{redirect:'manual'});
    expect(res.status).toBe(301);
    expect(new URL(res.headers.get('location')!).pathname+new URL(res.headers.get('location')!).search).toBe('/dashboard/profile?x=1');
  });

  it('never sends anyone off-site or into /admin without being an admin', async()=>{
    expect((await signIn('ada.new@example.com','//evil.example/x')).body.redirect).toBe('/dashboard');
    expect((await signIn('ada.new@example.com','/admin')).body.redirect).toBe('/dashboard');
    expect((await signIn('ada.new@example.com','/welcome')).body.redirect).toBe('/dashboard');
    expect((await signIn('ada.new@example.com','/jobs/abc')).body.redirect).toBe('/jobs/abc');
  });

  it('a signed-in caregiver applies in one click; claimed employers get it in their Inbox', async()=>{
    await DB.prepare("INSERT OR REPLACE INTO agency_organizations(id,organization_key,canonical_name,primary_domain,primary_email,city,state,zip,is_active,claimed_employer_id) VALUES ('org-claimed','org-claimed','Acme Care','acme.test','jobs@acme.test','Baltimore','MD','21201',1,'emp1')").run();
    await DB.prepare("INSERT OR REPLACE INTO agency_organizations(id,organization_key,canonical_name,primary_domain,primary_email,city,state,zip,is_active) VALUES ('org-open','org-open','Bay Home Care','bay.test','jobs@bay.test','Baltimore','MD','21201',1)").run();
    for(const [id,org,name] of [['job-claimed','org-claimed','Acme Care'],['job-open','org-open','Bay Home Care']]){
      await DB.prepare("INSERT OR REPLACE INTO caregiver_jobs(id,agency_organization_id,dedupe_key,source_provider,source_url,title,role,employer_name,city,state,zip,status,is_published) VALUES (?,?,?,'test',?,'CNA Days','CNA',?,'Baltimore','MD','21201','current',1)")
        .bind(id,org,id,'https://'+org+'.test/apply',name).run();
    }
    expect((await post('/api/me/apply/job-claimed',{})).status).toBe(401);
    const {cookie}=await signIn('dc@example.com');
    sent.length=0;
    const first=await post('/api/me/apply/job-claimed',{},{cookie});
    expect(first.status).toBe(201);
    expect(await first.json()).toMatchObject({status:'applied',employerOnCareJoys:true,applicationUrl:'https://org-claimed.test/apply'});
    expect(await DB.prepare("SELECT source FROM agency_interests WHERE organization_id='org-claimed' AND caregiver_id='dc'").first()).toEqual({source:'job_apply'});
    // The caregiver gets a receipt and the claimed agency hears about it.
    expect(sent.map(m=>m.to).sort()).toEqual(['dc@example.com','pat@acme.test']);
    sent.length=0;
    expect(await (await post('/api/me/apply/job-claimed',{},{cookie})).json()).toMatchObject({status:'already_applied'});
    expect(sent).toEqual([]);
    // An unclaimed agency is not emailed while outreach is off, so the caregiver is pointed to its own site.
    const open=await post('/api/me/apply/job-open',{},{cookie});
    expect(await open.json()).toMatchObject({status:'applied',employerOnCareJoys:false});
    expect(sent.map(m=>m.to)).toEqual(['dc@example.com']);
    expect(sent[0].html).toContain('https://org-open.test/apply');
    const me=await (await call('/api/me',{headers:{cookie}})).json() as any;
    expect(me.applications.map((a:any)=>[a.jobId,a.appliedOnCareJoys,a.employerOnCareJoys]).sort()).toEqual([['job-claimed',true,true],['job-open',true,false]]);
  });

  it('stores the resume file and only starts Apply for me where it can', async()=>{
    await DB.prepare("INSERT OR REPLACE INTO caregiver_jobs(id,agency_organization_id,dedupe_key,source_provider,source_url,title,role,employer_name,city,state,zip,status,is_published) VALUES ('job-paylocity','org-open','job-paylocity','test','https://recruiting.paylocity.com/Recruiting/Jobs/Details/1','HHA Days','HHA','Bay Home Care','Baltimore','MD','21201','current',1)").run();
    expect(((await (await call('/api/public/caregiver-jobs/job-paylocity')).json()) as any).job.applyForMe).toBe(true);
    expect(((await (await call('/api/public/caregiver-jobs/job-open')).json()) as any).job.applyForMe).toBe(false);
    const {cookie}=await signIn('dc@example.com');
    const pdf=new TextEncoder().encode('%PDF-1.4 test resume for apply for me');
    const upload=(path:string,headers:Record<string,string>)=>call(path,{method:'POST',headers:{'content-type':'application/pdf','x-file-name':'Dee%20Resume.pdf',...headers},body:pdf});
    // Not signed in, or not a PDF: refused.
    expect((await upload('/api/me/resume',{})).status).toBe(401);
    expect((await call('/api/me/resume',{method:'POST',headers:{cookie,'content-type':'application/pdf'},body:new TextEncoder().encode('not really a pdf file')})).status).toBe(400);
    // Without a resume file, Apply for me asks for one... once Browser Rendering is bound.
    expect((await post('/api/me/apply-agent/job-paylocity',{},{cookie})).status).toBe(503);
    expect((await post('/api/me/apply-agent/job-open',{},{cookie})).status).toBe(422);
    expect((await upload('/api/me/resume',{cookie})).status).toBe(200);
    const me=await (await call('/api/me',{headers:{cookie}})).json() as any;
    expect(me.resume).toMatchObject({fileName:'Dee Resume.pdf'});
    const download=await call('/api/me/resume',{headers:{cookie}});
    expect(download.headers.get('content-type')).toBe('application/pdf');
    expect(new Uint8Array(await download.arrayBuffer())).toEqual(pdf);
  });

  it('a new caregiver’s resume file is stored with the one-time token from saving the profile', async()=>{
    const saved=await post('/api/caregiver-resume',{firstName:'Rae',lastName:'New',email:'rae.new@example.com',phone:'4105550111',zip:'21201',role:'CNA'});
    const body=await saved.json() as any;
    expect(body.resumeUploadToken).toBeTruthy();
    const send=(token:string)=>call('/api/caregivers/'+body.id+'/resume-file',{method:'POST',headers:{'content-type':'application/pdf','x-carejoys-profile-token':token},body:new TextEncoder().encode('%PDF-1.4 rae resume for the test')});
    expect((await send('wrong')).status).toBe(401);
    expect((await send(body.resumeUploadToken)).status).toBe(200);
    // Works once.
    expect((await send(body.resumeUploadToken)).status).toBe(401);
    expect(await DB.prepare("SELECT file_name,content_type FROM caregiver_resume_files WHERE caregiver_id=?").bind(body.id).first()).toEqual({file_name:'resume.pdf',content_type:'application/pdf'});
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

  it('admin sees which job sites current jobs use', async()=>{
    const body=await (await admin('/api/admin/job-sites')).json() as any;
    expect(body.total).toBeGreaterThan(0);
    expect(body.sites.find((s:any)=>s.site==='Paylocity')).toMatchObject({supported:true,sampleJobId:'job-paylocity'});
    expect((await call('/api/admin/job-sites')).status).toBe(401);
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

describe('Continue with Google', ()=>{
  const keys={GOOGLE_CLIENT_ID:'cid.apps.googleusercontent.com',GOOGLE_CLIENT_SECRET:'shh'};
  const idToken=(claims:Record<string,unknown>)=>'h.'+btoa(JSON.stringify(claims)).replace(/=+$/,'').replace(/\+/g,'-').replace(/\//g,'_')+'.s';
  async function start(next='/dashboard'){
    const res=await call('/api/auth/google/start?next='+encodeURIComponent(next),{},keys);
    expect(res.status).toBe(302);
    const location=new URL(res.headers.get('location')!);
    expect(location.origin).toBe('https://accounts.google.com');
    expect(location.searchParams.get('redirect_uri')).toBe('https://carejoys.com/api/auth/google/callback');
    const stateCookie=res.headers.get('set-cookie')!.match(/__Host-cj_google_state=([^;]+)/)![1];
    return {state:location.searchParams.get('state')!,cookie:'__Host-cj_google_state='+stateCookie};
  }
  async function callback(state:string,cookie:string,claims:Record<string,unknown>){
    const realFetch=globalThis.fetch;
    globalThis.fetch=(async(input:RequestInfo|URL)=>String(input).startsWith('https://oauth2.googleapis.com/token')
      ?new Response(JSON.stringify({id_token:idToken(claims)}),{headers:{'content-type':'application/json'}}):realFetch(input as any)) as typeof fetch;
    try{return await call('/api/auth/google/callback?code=c0de&state='+encodeURIComponent(state),{headers:{cookie}},keys)}
    finally{globalThis.fetch=realFetch}
  }
  const good={iss:'https://accounts.google.com',aud:keys.GOOGLE_CLIENT_ID,email:'baltimore@example.com',email_verified:true};

  it('is offered only when both keys are set', async()=>{
    expect(((await (await call('/api/config')).json()) as any).googleSignIn).toBe(false);
    expect(((await (await call('/api/config',{},keys)).json()) as any).googleSignIn).toBe(true);
    expect((await call('/api/auth/google/start')).headers.get('location')).toBe('https://carejoys.com/login');
  });

  it('signs a verified Google email into the same account and lands where it was headed', async()=>{
    const {state,cookie}=await start('/dashboard');
    const res=await callback(state,cookie,good);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/dashboard');
    const account=decodeURIComponent(res.headers.get('set-cookie')!.match(/__Host-cj_account=([^;]+)/)![1]);
    const me=await (await call('/api/me',{headers:{cookie:'__Host-cj_account='+account}})).json() as any;
    expect(me.caregiver.id).toBe('baltimore');
  });

  it('refuses a mismatched state, an unverified email or another app’s token', async()=>{
    const {state,cookie}=await start();
    expect((await callback('forged',cookie,good)).headers.get('location')).toBe('/login?error=google_cancelled');
    expect((await callback(state,cookie,{...good,email_verified:false})).headers.get('location')).toBe('/login?error=google_failed');
    expect((await callback(state,cookie,{...good,aud:'other-app'})).headers.get('location')).toBe('/login?error=google_failed');
  });
});

describe('agency hiring-needs invites', ()=>{
  it('emails each unclaimed agency with live jobs once, and the link opens a page showing its jobs', async()=>{
    await DB.prepare("INSERT INTO agency_organizations(id,organization_key,canonical_name,primary_email,primary_contact_name,city,state,is_active) VALUES ('org-invite','org-invite','Brightway Care, LLC','jobs@brightway.test','Dana Lee','Towson','MD',1)").run();
    await DB.prepare("INSERT INTO caregiver_jobs(id,agency_organization_id,dedupe_key,source_provider,source_url,title,role,employer_name,city,state,status,is_published) VALUES ('job-invite','org-invite','job-invite','test','https://brightway.test/jobs/1','Home Health Aide','HHA','Brightway Care','Towson','MD','current',1)").run();
    sent.length=0;
    const first=await sendAgencyHiringInvites(env(),50,'hello@carejoys.com');
    const mine=sent.filter(m=>m.to==='jobs@brightway.test');
    expect(mine).toHaveLength(1);
    expect(mine[0].subject).toBe('The most qualified caregivers for Brightway Care, matched to what you need');
    expect(mine[0].html).toContain('Verify your agency needs');
    expect(mine[0].headers?.['List-Unsubscribe']).toBeTruthy();
    expect(sent.filter(m=>m.to==='hello@carejoys.com')).toHaveLength(1);
    expect(first.sent).toBeGreaterThan(0);
    const token=decodeURIComponent(mine[0].html!.match(/agency\?token=([^"&\s]+)/)![1]);
    const teaser=await (await call('/api/agency/teaser?token='+encodeURIComponent(token))).json() as any;
    expect(teaser.jobs.map((j:any)=>j.title)).toEqual(['Home Health Aide']);
    // A second run never emails the same agency again.
    sent.length=0;
    await sendAgencyHiringInvites(env(),50);
    expect(sent.filter(m=>m.to==='jobs@brightway.test')).toHaveLength(0);
    expect(friendlyAgencyName('Sunrise Home Care Inc.')).toBe('Sunrise Home Care');
  });

  it('stops at a sending limit and keeps the agency queued', async()=>{
    await DB.prepare("INSERT INTO agency_organizations(id,organization_key,canonical_name,primary_email,city,state,is_active) VALUES ('org-quota','org-quota','Quota Care','jobs@quota.test','Towson','MD',1)").run();
    await DB.prepare("INSERT INTO caregiver_jobs(id,agency_organization_id,dedupe_key,source_provider,source_url,title,role,employer_name,city,state,status,is_published) VALUES ('job-quota','org-quota','job-quota','test','https://quota.test/jobs/1','Caregiver','Caregiver','Quota Care','Towson','MD','current',1)").run();
    const limited={...env(),EMAIL:{send:async()=>{throw new Error('account daily sending quota exceeded');}}};
    const result=await sendAgencyHiringInvites(limited as any,50);
    expect(result.failed).toBe(0);
    const failed=await DB.prepare("SELECT COUNT(*) AS n FROM agency_outreach_events WHERE organization_id='org-quota'").first() as {n:number}|null;
    expect(failed?.n).toBe(0);
    sent.length=0;
    await sendAgencyHiringInvites(env(),50);
    expect(sent.filter(m=>m.to==='jobs@quota.test')).toHaveLength(1);
  });
});

describe('thin page content from real data', ()=>{
  const job=(id:string,city:string,zip:string,extra='')=>DB.prepare(`INSERT OR REPLACE INTO caregiver_jobs(id,agency_organization_id,dedupe_key,source_provider,source_url,title,role,employer_name,city,state,zip,status,is_published,pay_min,pay_max,pay_period) VALUES (?,?,?,?,?,?,?,?,?,?,?,'current',1,?,?,?)`)
    .bind(id,'org-test',id,'test','https://sunrisecare.test/'+id,'Home Health Aide','HHA','Sunrise Home Care',city,'TX',zip,18,20,'hour').run();
  it('hire-caregivers state pages show jobs, pay, roles, cities and employers, and need 5 jobs to be indexed', async()=>{
    await DB.prepare("DELETE FROM caregiver_jobs WHERE state='TX'").run();
    for(const [i,city] of ['San Antonio','San Antonio','San Antonio','Austin'].entries())await job('tx-'+i,city,'78201');
    let html=await (await call('/hire-caregivers/texas',{},htmlAssets)).text();
    expect(html).toContain('<meta name="robots" content="noindex,follow" />');
    await job('tx-4','Austin','78701');
    html=await (await call('/hire-caregivers/texas',{},htmlAssets)).text();
    expect(html).not.toContain('noindex');
    expect(html).toContain('5 current caregiver jobs posted by Texas employers');
    expect(html).toContain('the middle posted rate is $19.00 an hour');
    expect(html).toContain('Home health aide (HHA): 5 open jobs');
    expect(html).toContain('<a href="/caregiver-jobs/texas/san-antonio">San Antonio</a>: 3 jobs');
    expect(html).toContain('Sunrise Home Care (5)');
    await DB.prepare("DELETE FROM caregiver_jobs WHERE state='TX'").run();
  });
  it('training program pages list caregiver jobs near the program', async()=>{
    await DB.prepare("INSERT OR REPLACE INTO training_organizations(id,organization_key,canonical_name,slug) VALUES ('to-near','to-near','Near CNA Academy','near-cna-academy')").run();
    await DB.prepare("INSERT OR REPLACE INTO training_programs(id,source,source_key,program_name,organization_id,city,state,zip,program_type,provider_type,current_status,is_active) VALUES ('tp-near','test','tp-near','Near CNA Academy','to-near','Baltimore','MD','21201','Certified Nursing Assistant Training Program','Freestanding Program','Approved',1)").run();
    await DB.prepare("INSERT OR REPLACE INTO caregiver_jobs(id,agency_organization_id,dedupe_key,source_provider,source_url,title,role,employer_name,city,state,zip,status,is_published) VALUES ('job-near','org-test','job-near','test','https://sunrisecare.test/near','CNA Days','CNA','Sunrise Home Care','Baltimore','MD','21202','current',1)").run();
    const html=await (await call('/training-programs/near-cna-academy',{},htmlAssets)).text();
    expect(html).toMatch(/current caregiver jobs? (is|are) open within 15 miles of Near CNA Academy/);
    expect(html).toContain('<a href="/jobs/job-near">CNA Days</a>');
    expect(html).toContain('Freestanding Program · Approved');
    await DB.prepare("DELETE FROM caregiver_jobs WHERE id='job-near'").run();
  });
});

describe('optional intro video', ()=>{
  // A stand-in for the Cloudflare Stream binding: records what the Worker asks of it.
  const videos=new Map<string,{state:string;ready:boolean}>();
  const deleted:string[]=[];
  let next=0;
  const STREAM={
    createDirectUpload:async(params:any)=>{
      expect(params).toMatchObject({maxDurationSeconds:60,requireSignedURLs:true});
      const id='vid'+(++next);videos.set(id,{state:'pendingupload',ready:false});
      return {id,uploadURL:'https://upload.videodelivery.net/'+id};
    },
    video:(id:string)=>({
      details:async()=>{const v=videos.get(id);if(!v)throw new Error('not found');
        return {readyToStream:v.ready,status:{state:v.state},duration:42.4,thumbnail:'https://customer-abc.cloudflarestream.com/'+id+'/thumbnails/thumbnail.jpg'}},
      delete:async()=>{deleted.push(id);videos.delete(id)},
      generateToken:async()=>'signed-'+id,
    }),
  };
  const withStream={STREAM};
  const secret='intro-video-session';
  const me={cookie:'__Host-cj_account='+secret,'content-type':'application/json',origin:'https://carejoys.com'};
  const employer={cookie:'cj_session='+SESSION};
  const towsonCard=async()=>((await (await call('/api/candidates?zip=21201&radius=25',{headers:employer},withStream)).json()) as any).candidates.find((c:any)=>c.id==='towson');
  const upload=async()=>{
    const res=await call('/api/me/video/upload',{method:'POST',headers:me,body:JSON.stringify({consent:true})},withStream);
    expect(res.status).toBe(200);
    const {uploadURL}=await res.json() as any;
    videos.set(uploadURL.split('/').pop(),{state:'ready',ready:true}); // the browser's upload to Stream
    expect((await call('/api/me/video/complete',{method:'POST',headers:me,body:'{}'},withStream)).status).toBe(200);
    return uploadURL.split('/').pop() as string;
  };

  beforeAll(async()=>{
    await DB.prepare('INSERT INTO account_sessions(id,email,session_hash,expires_at) VALUES (?,?,?,?)')
      .bind(crypto.randomUUID(),'towson@example.com',await sha256Hex(secret),new Date(Date.now()+86400000).toISOString()).run();
  });

  it('needs a signed-in caregiver, their consent, and Stream turned on', async()=>{
    expect((await call('/api/me/video')).status).toBe(401);
    expect(((await (await call('/api/me/video',{headers:me})).json()) as any)).toEqual({ok:true,enabled:false,video:null});
    expect((await call('/api/me/video/upload',{method:'POST',headers:me,body:JSON.stringify({consent:true})})).status).toBe(503);
    expect((await call('/api/me/video/upload',{method:'POST',headers:me,body:'{}'},withStream)).status).toBe(400);
    expect((await call('/api/me/video/upload',{method:'POST',headers:{...me,origin:'https://evil.example'},body:JSON.stringify({consent:true})},withStream)).status).toBe(403);
  });

  it('an unfinished upload is not submitted', async()=>{
    await call('/api/me/video/upload',{method:'POST',headers:me,body:JSON.stringify({consent:true})},withStream);
    expect((await call('/api/me/video/complete',{method:'POST',headers:me,body:'{}'},withStream)).status).toBe(400);
  });

  it('employers see a video only after an admin approves it', async()=>{
    const id=await upload();
    const status=await (await call('/api/me/video',{headers:me},withStream)).json() as any;
    expect(status.video).toMatchObject({status:'review',playbackUrl:'https://customer-abc.cloudflarestream.com/signed-'+id+'/iframe',durationSeconds:42});
    expect((await towsonCard()).introVideoUrl).toBeUndefined();
    expect((await call('/api/caregivers/towson/video',{headers:employer},withStream)).status).toBe(404);

    const admin={authorization:'Bearer t0ken','content-type':'application/json'};
    expect((await call('/api/admin/videos',{},{...withStream,ADMIN_TOKEN:'t0ken'})).status).toBe(401);
    const queue=await (await call('/api/admin/videos',{headers:admin},{...withStream,ADMIN_TOKEN:'t0ken'})).json() as any;
    expect(queue.videos.map((v:any)=>v.caregiverId)).toEqual(['towson']);
    expect((await call('/api/admin/videos/towson/approve',{method:'POST',headers:admin,body:'{}'},{...withStream,ADMIN_TOKEN:'t0ken'})).status).toBe(200);

    expect((await towsonCard()).introVideoUrl).toBe('/api/caregivers/towson/video');
    expect((await call('/api/caregivers/towson/video')).status).toBe(401);
    expect(((await (await call('/api/caregivers/towson/video',{headers:employer},withStream)).json()) as any).playbackUrl).toBe('https://customer-abc.cloudflarestream.com/signed-'+id+'/iframe');
    const preview=await (await call('/api/me/employer-view',{headers:me},withStream)).json() as any;
    expect(preview.candidate.introVideoUrl).toBe('/api/me/video');
  });

  it('replacing a video sends it back to review and removes the old one', async()=>{
    const old=((await (await call('/api/caregivers/towson/video',{headers:employer},withStream)).json()) as any).playbackUrl.match(/signed-(\w+)/)[1];
    await upload();
    expect(deleted).toContain(old);
    expect((await towsonCard()).introVideoUrl).toBeUndefined();
  });

  it('a rejected video is deleted from Stream, and the caregiver can delete theirs any time', async()=>{
    const admin={authorization:'Bearer t0ken','content-type':'application/json'};
    const current=[...videos.keys()].pop()!;
    expect((await call('/api/admin/videos/towson/reject',{method:'POST',headers:admin,body:'{}'},{...withStream,ADMIN_TOKEN:'t0ken'})).status).toBe(200);
    expect(deleted).toContain(current);
    expect(((await (await call('/api/me/video',{headers:me},withStream)).json()) as any).video).toEqual({status:'rejected'});
    const again=await upload();
    expect((await call('/api/me/video/delete',{method:'POST',headers:me,body:'{}'},withStream)).status).toBe(200);
    expect(deleted).toContain(again);
    expect(((await (await call('/api/me/video',{headers:me},withStream)).json()) as any).video).toBeNull();
  });
});
