import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPlatformProxy } from 'wrangler';
import worker from '../src/worker';
import { unsubscribeLink } from '../src/emailPreferences';
import { runOutreach } from '../src/outreach';
import { runDataForSeoJobs } from '../src/dataforseo';
import { pullClarityInsights } from '../src/clarity';
import { sendAgencyHiringInvites, friendlyAgencyName } from '../src/agencyFeatures';
import { adminRecipients, alertNewClientErrors, alertRecipients, runDailyMonitor } from '../src/monitoring';
import { sendHiringFollowups } from '../src/employerFollowups';
import { forwardToAts, sendDailyDigests, sendMonthlyResults } from '../src/settingsApi';

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
  for(const t of ['talent_alerts','caregiver_intro_videos','worker_funnel_events','worker_funnel_links','caregiver_job_alert_preferences','caregiver_resume_files','candidate_pipeline','interview_slots','openings','employer_sessions','employer_auth_tokens','availability_events','outreach_events','caregiver_resume_imports','caregiver_referrals','agency_org_candidate_matches','caregivers','employer_members','employer_leads','email_suppressions','email_unsubscribe_tokens','outreach_runs','analytics_events','rate_limits','employer_billing','login_tokens','account_sessions']){
    await DB.prepare(`DELETE FROM ${t}`).run();
  }
  await addCaregiver('baltimore','21201');
  await addCaregiver('towson','21204');
  await addCaregiver('dc','20001');
  await addCaregiver('la','90001');
  await DB.prepare("INSERT INTO employer_leads(id,company_name,contact_name,email,zip,roles_needed,status,approved_at) VALUES ('emp1','Acme Care','Pat','pat@acme.test','21201','CNA','active',CURRENT_TIMESTAMP)").run();
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
  it('approves a company email only at the domain of an agency or care community on record', async()=>{
    await DB.prepare("INSERT INTO agency_organizations(id,organization_key,canonical_name,primary_domain,city,state,is_active,provider_kind) VALUES ('org-oak','org-oak','Oak Grove Senior Living','oakgrove-living.test','Towson','MD',1,'facility')").run();
    const cases:[string,string,unknown][]=[
      ['emp-unknown','owner@acrepermit.test',{approved:false,reason:'pending'}],
      ['emp-oak','hr@oakgrove-living.test',{approved:true,reason:'agency_domain'}],
      ['emp-oak-sub','hr@towson.oakgrove-living.test',{approved:true,reason:'agency_domain'}],
      ['emp-lookalike','hr@notoakgrove-living.test',{approved:false,reason:'pending'}]
    ];
    for(const [id,email,expected] of cases){
      await DB.prepare("INSERT INTO employer_leads(id,company_name,contact_name,email,zip,roles_needed,status) VALUES (?,?,'Kim',?,'21204','CNA','active')").bind(id,id,email).run();
      await DB.prepare("INSERT INTO employer_sessions(id,employer_id,session_hash,expires_at) VALUES (?,?,?,?)").bind(id+'-s',id,await sha256Hex(id+'-cookie'),new Date(Date.now()+86400000).toISOString()).run();
      const ws=await (await call('/api/workspace',{headers:{cookie:'cj_session='+id+'-cookie'}})).json() as any;
      expect([email,ws.approval]).toEqual([email,expected]);
    }
    expect((await call('/api/candidates?zip=21204',{headers:{cookie:'cj_session=emp-unknown-cookie'}})).status).toBe(403);
    expect((await call('/api/candidates?zip=21204',{headers:{cookie:'cj_session=emp-oak-cookie'}})).status).toBe(200);
  });
  it('free-mail employers wait for an admin before seeing caregivers', async()=>{
    await DB.prepare("INSERT INTO employer_leads(id,company_name,contact_name,email,zip,roles_needed,status) VALUES ('empfree','Solo Care','Sam','sam@gmail.com','21201','CNA','active')").run();
    await DB.prepare("INSERT INTO employer_sessions(id,employer_id,session_hash,expires_at) VALUES ('s2','empfree',?,?)").bind(await sha256Hex('free-session'),new Date(Date.now()+86400000).toISOString()).run();
    sent.length=0;
    const asFree=(extra:Record<string,unknown>={})=>call('/api/candidates?zip=21201',{headers:{cookie:'cj_session=free-session'}},{ADMIN_EMAILS:'boss@carejoys.com',...extra});
    const blocked=await asFree();
    expect(blocked.status).toBe(403);
    expect(((await blocked.json()) as any).pendingApproval).toBe(true);
    expect(sent.map(m=>m.to)).toEqual([['boss@carejoys.com','myersrebeccal@gmail.com']]);
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
  it('talent search leaves out non-US caregivers, drops mileage when the ZIP contradicts the state, and groups by commute', async()=>{
    await addCaregiver('abroad','21204',{state:'South Africa',city:'Johannesburg'});
    await addCaregiver('misplaced','21204',{state:'CA',city:'Hesperia'});
    try{
      const all=await (await call('/api/candidates?zip=21201&radius=all',{headers:{cookie:'cj_session='+SESSION}})).json() as any;
      const ids=all.candidates.map((c:any)=>c.id);
      expect(ids).not.toContain('abroad');
      expect(all.nearby).toBe(2);
      expect(all.candidates.slice(0,2).map((c:any)=>c.withinCommute)).toEqual([true,true]);
      const misplaced=all.candidates.find((c:any)=>c.id==='misplaced');
      expect(misplaced.distanceMiles).toBeNull();
      expect(misplaced.withinCommute).toBe(false);
      expect(ids.at(-1)).toBe('misplaced');
      expect((await call('/api/candidates/abroad',{headers:{cookie:'cj_session='+SESSION}})).status).toBe(404);
    }finally{
      await DB.prepare("DELETE FROM caregivers WHERE id IN ('abroad','misplaced')").run();
    }
  });
  it('opens one network caregiver and adds them to an opening for an invite', async()=>{
    const one=await (await call('/api/candidates/towson?zip=21201',{headers:{cookie:'cj_session='+SESSION}})).json() as any;
    expect(one.candidate.id).toBe('towson');
    expect(one.candidate.distanceMiles).toBeGreaterThan(5);
    expect((await call('/api/candidates/towson',{headers:{cookie:'cj_session=emp-unknown-cookie'}})).status).toBe(403);
    const created=await call('/api/openings',{method:'POST',headers:{cookie:'cj_session='+SESSION,'content-type':'application/json'},body:JSON.stringify({title:'Network pick',role:'CNA',zip:'21201'})});
    const {id}=await created.json() as any;
    const add=(caregiverId='towson')=>call(`/api/openings/${id}/candidates`,{method:'POST',headers:{cookie:'cj_session='+SESSION,'content-type':'application/json'},body:JSON.stringify({caregiverId})});
    // Los Angeles is far beyond any commute to a Baltimore opening, so nobody can invite them to it.
    const far=await add('la');
    expect(far.status).toBe(409);
    expect((await far.json() as any).error).toMatch(/too far/);
    const first=await (await add()).json() as any;
    expect(first.stage).toBe('matched');
    const again=await (await add()).json() as any;
    expect(again.pipelineId).toBe(first.pipelineId);
    expect(await DB.prepare('SELECT source FROM candidate_pipeline WHERE id=?').bind(first.pipelineId).first()).toEqual({source:'talent_network'});
    await DB.prepare('DELETE FROM candidate_pipeline WHERE opening_id=?').bind(id).run();
    await DB.prepare('DELETE FROM openings WHERE id=?').bind(id).run();
  });
  it('saved searches email new nearby caregivers once, and the email link turns the alert off', async()=>{
    const headers={cookie:'cj_session='+SESSION,'content-type':'application/json'};
    const saved=await (await call('/api/talent-alerts',{method:'POST',headers,body:JSON.stringify({query:'zip=21201&radius=25&evil=1'})})).json() as any;
    expect(saved.alerts).toHaveLength(1);
    expect(saved.alerts[0].query).toBe('zip=21201&radius=25');
    expect(saved.alerts[0].label).toBe('within 25 mi of 21201');
    try{
      await DB.prepare("UPDATE talent_alerts SET last_checked_at='2000-01-01 00:00:00'").run();
      sent.length=0;
      await worker.scheduled({cron:'41 15 * * *'},env(),{waitUntil:()=>{}});
      const mail=sent.filter(m=>JSON.stringify(m.to).includes('pat@acme.test'));
      expect(mail).toHaveLength(1);
      expect(mail[0].subject).toBe('2 new caregivers for your search: within 25 mi of 21201');
      sent.length=0;
      await worker.scheduled({cron:'41 15 * * *'},env(),{waitUntil:()=>{}});
      expect(sent).toHaveLength(0);
      const {off_token}=await DB.prepare('SELECT off_token FROM talent_alerts').first() as any;
      expect((await call('/talent-alert/off?token='+encodeURIComponent(off_token))).status).toBe(200);
      expect((await (await call('/api/talent-alerts',{headers})).json() as any).alerts).toHaveLength(0);
    }finally{
      await DB.prepare('DELETE FROM talent_alerts').run();
    }
  });
  it('filters the network by pay, language and a confirmed checklist item', async()=>{
    await DB.prepare("UPDATE caregivers SET hourly_rate_min=30,languages='English, Spanish',checklist='background_check' WHERE id='towson'").run();
    try{
      const ids=async(q:string)=>((await (await call('/api/candidates?zip=21201&radius=25&'+q,{headers:{cookie:'cj_session='+SESSION}})).json()) as any).candidates.map((c:any)=>c.id).sort();
      expect(await ids('payMax=25')).toEqual(['baltimore']);
      expect(await ids('language=Spanish')).toEqual(['towson']);
      expect(await ids('checked=background_check')).toEqual(['towson']);
    }finally{
      await DB.prepare("UPDATE caregivers SET hourly_rate_min=NULL,languages=NULL,checklist=NULL WHERE id='towson'").run();
    }
  });
  it('opening match uses commute radius and infers location from ZIP', async()=>{
    const created=await call('/api/openings',{method:'POST',headers:{cookie:'cj_session='+SESSION,'content-type':'application/json'},body:JSON.stringify({title:'CNA days',role:'CNA',zip:'21201'})});
    const {id}=await created.json() as any;
    const opening=await DB.prepare('SELECT city,state FROM openings WHERE id=?').bind(id).first();
    expect(opening).toEqual({city:'Baltimore',state:'MD'});
    const match=await (await call(`/api/openings/${id}/match`,{method:'POST',headers:{cookie:'cj_session='+SESSION}})).json() as any;
    expect(match.top.map((c:any)=>c.id).sort()).toEqual(['baltimore','towson']);
  });
  it('stores an opening schedule and shows it as plain-words shift hours', async()=>{
    const schedule={days:{mon:{start:'07:00',end:'15:00'},tue:{start:'07:00',end:'15:00'},sat:{start:'23:00',end:'07:00'}},liveIn:false};
    const created=await call('/api/openings',{method:'POST',headers:{cookie:'cj_session='+SESSION,'content-type':'application/json'},body:JSON.stringify({title:'CNA',role:'CNA',zip:'21201',shifts:'ignored',schedule:JSON.stringify(schedule)})});
    const {id}=await created.json() as any;
    const row=await DB.prepare('SELECT shift_preferences,schedule_json FROM openings WHERE id=?').bind(id).first() as any;
    expect(row.shift_preferences).toBe('Mon, Tue 7am–3pm · Sat 11pm–7am');
    expect(JSON.parse(row.schedule_json)).toEqual(schedule);
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
    expect(sent.map(x=>x.to)).toEqual([['boss@carejoys.com','myersrebeccal@gmail.com']]);
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
  it('invites only the caregivers the employer picked and keeps caregiver-only stages out of manual edits', async()=>{
    const headers={cookie:'cj_session='+SESSION,'content-type':'application/json'};
    const {id}=await (await call('/api/openings',{method:'POST',headers,body:JSON.stringify({title:'CNA picked',role:'CNA',zip:'21201'})})).json() as any;
    await call('/api/openings/'+id+'/match',{method:'POST',headers});
    const rows=(await (await call('/api/pipeline?openingId='+id,{headers})).json() as any).pipeline;
    expect(rows.length).toBeGreaterThan(1);
    const pick=rows.find((r:any)=>r.caregiver_id==='towson');
    expect(pick.profile.name).toBe(pick.name);
    expect(pick.match_reasons).toContain('role match');
    expect(pick.profile.email).toBeUndefined();
    sent.length=0;
    const outcome=await (await call('/api/openings/'+id+'/contact',{method:'POST',headers,body:JSON.stringify({pipelineIds:[pick.id]})})).json() as any;
    expect(outcome.sent).toBe(1);
    expect(sent.map(m=>m.to)).toEqual(['towson@example.com']);
    const after=(await (await call('/api/pipeline?openingId='+id,{headers})).json() as any).pipeline;
    expect(after.filter((r:any)=>r.stage==='contacted').map((r:any)=>r.caregiver_id)).toEqual(['towson']);
    const other=after.find((r:any)=>r.caregiver_id!=='towson');
    // Interviewing is the employer's own mark, but only for someone who said yes.
    expect((await call('/api/pipeline/'+other.id,{method:'PATCH',headers,body:JSON.stringify({stage:'interview'})})).status).toBe(409);
    expect((await call('/api/pipeline/'+other.id,{method:'PATCH',headers,body:JSON.stringify({stage:'rejected'})})).status).toBe(200);
    const final=(await (await call('/api/pipeline?openingId='+id,{headers})).json() as any).pipeline;
    expect(final.find((r:any)=>r.id===other.id)).toMatchObject({stage:'rejected',rejected_reason:'employer_not_a_fit',interview_at:null});
  });
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
  it('sends admin notifications to ADMIN_EMAILS and the owner accounts, without duplicates',async()=>{
    const owner='myersrebeccal@gmail.com';
    expect(await adminRecipients(env({ADMIN_EMAILS:'ops@carejoys.com, MyersRebeccaL@gmail.com'}))).toEqual(['ops@carejoys.com',owner]);
    expect(await adminRecipients(env())).toEqual([owner]);
    expect(await alertRecipients(env({ADMIN_EMAILS:'ops@carejoys.com'}))).toEqual(['ops@carejoys.com',owner]);
    expect(await alertRecipients(env({ALERT_EMAILS:'oncall@carejoys.com'}))).toEqual(['oncall@carejoys.com']);
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
  it('records a summary run, and notes a schedule it does not recognise', async()=>{
    const at=Date.parse('2026-10-09T21:07:00Z');
    await worker.scheduled({cron:'2,7,12,17,22,27,32,37,42,47,52,57 * * * *',scheduledTime:at},env(),{waitUntil:()=>{}});
    await worker.scheduled({cron:'7-59/5 * * * *',scheduledTime:at},env(),{waitUntil:()=>{}});
    const runs=await DB.prepare("SELECT kind,trigger FROM outreach_runs WHERE kind IN ('job_summaries','unmatched_cron') ORDER BY kind,trigger").all();
    expect(runs.results).toEqual([
      {kind:'job_summaries',trigger:'2,7,12,17,22,27,32,37,42,47,52,57 * * * *'},
      {kind:'job_summaries',trigger:'7-59/5 * * * *'},
      {kind:'unmatched_cron',trigger:'7-59/5 * * * *'}
    ]);
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

describe('billing checkout', ()=>{
  it('uses the yearly price when asked and it is configured, else the monthly one', async()=>{
    const stripe={STRIPE_SECRET_KEY:'sk_test',STRIPE_PRICE_ID:'price_month',STRIPE_PRICE_ID_YEARLY:'price_year'};
    const original=globalThis.fetch;const bodies:string[]=[];
    globalThis.fetch=(async(url:string,init:any)=>{
      if(String(url).startsWith('https://api.stripe.com/'))return (bodies.push(String(init.body)),new Response(JSON.stringify({url:'https://checkout.stripe.test/s'}),{status:200}));
      return original(url as any,init);
    }) as any;
    try{
      const headers={cookie:'cj_session='+SESSION,'content-type':'application/json',origin:'https://carejoys.com'};
      expect((await (await call('/api/billing',{headers},stripe)).json() as any).yearly).toBe(true);
      expect((await call('/api/billing/checkout',{method:'POST',headers,body:JSON.stringify({plan:'yearly'})},stripe)).status).toBe(200);
      expect((await call('/api/billing/checkout',{method:'POST',headers,body:JSON.stringify({plan:'monthly'})},stripe)).status).toBe(200);
      expect((await call('/api/billing/checkout',{method:'POST',headers,body:JSON.stringify({plan:'yearly'})},{...stripe,STRIPE_PRICE_ID_YEARLY:''})).status).toBe(200);
      expect(bodies.map(b=>new URLSearchParams(b).get('line_items[0][price]'))).toEqual(['price_year','price_month','price_month']);
      // Per-location pricing: the employer sets the number of locations at checkout.
      const first=new URLSearchParams(bodies[0]);
      expect(first.get('line_items[0][quantity]')).toBe('1');
      expect(first.get('line_items[0][adjustable_quantity][enabled]')).toBe('true');
      expect((await call('/api/billing/checkout',{method:'POST',headers,body:JSON.stringify({locations:3})},stripe)).status).toBe(200);
      expect(new URLSearchParams(bodies[3]).get('line_items[0][quantity]')).toBe('3');
      // Stripe Tax only when switched on.
      expect(first.get('automatic_tax[enabled]')).toBeNull();
      expect((await call('/api/billing/checkout',{method:'POST',headers,body:'{}'},{...stripe,STRIPE_AUTOMATIC_TAX:'1'})).status).toBe(200);
      const taxed=new URLSearchParams(bodies[4]);
      expect(taxed.get('automatic_tax[enabled]')).toBe('true');
      expect(taxed.get('billing_address_collection')).toBe('required');
      expect(taxed.get('tax_id_collection[enabled]')).toBe('true');
    }finally{globalThis.fetch=original}
  });

  it('keeps access while a card is retried, sends existing subscribers to the portal, and dedupes double clicks', async()=>{
    const stripe={STRIPE_SECRET_KEY:'sk_test',STRIPE_PRICE_ID:'price_month'};
    const original=globalThis.fetch;const calls:{url:string;key:string|null}[]=[];
    globalThis.fetch=(async(url:string,init:any)=>{
      if(String(url).startsWith('https://api.stripe.com/'))return (calls.push({url:String(url),key:new Headers(init.headers).get('idempotency-key')}),new Response(JSON.stringify({url:String(url).includes('billing_portal')?'https://portal.stripe.test/p':'https://checkout.stripe.test/s'}),{status:200}));
      return original(url as any,init);
    }) as any;
    const headers={cookie:'cj_session='+SESSION,'content-type':'application/json',origin:'https://carejoys.com'};
    try{
      // Double click: both checkout requests carry the same idempotency key, so Stripe returns one session.
      await call('/api/billing/checkout',{method:'POST',headers,body:'{}'},stripe);
      await call('/api/billing/checkout',{method:'POST',headers,body:'{}'},stripe);
      expect(calls[0].key).toBeTruthy();
      expect(calls[1].key).toBe(calls[0].key);
      // A failing card: still subscribed while Stripe retries, with a payment notice.
      await DB.prepare("INSERT INTO employer_billing(employer_id,stripe_customer_id,stripe_subscription_id,status) VALUES ('emp1','cus_1','sub_1','past_due') ON CONFLICT(employer_id) DO UPDATE SET stripe_customer_id='cus_1',status='past_due'").run();
      let status=await (await call('/api/billing',{headers},stripe)).json() as any;
      expect(status.subscribed).toBe(true);
      expect(status.paymentIssue).toBe(true);
      // Upgrade with a subscription still open goes to the billing portal, not a second checkout.
      calls.length=0;
      expect((await (await call('/api/billing/checkout',{method:'POST',headers,body:'{}'},stripe)).json() as any).url).toBe('https://portal.stripe.test/p');
      expect(calls.map(c=>c.url.split('/v1/')[1])).toEqual(['billing_portal/sessions']);
      // Once Stripe gives up, unlimited introductions end.
      await DB.prepare("UPDATE employer_billing SET status='unpaid' WHERE employer_id='emp1'").run();
      status=await (await call('/api/billing',{headers},stripe)).json() as any;
      expect(status.subscribed).toBe(false);
      expect(status.paymentIssue).toBe(true);
    }finally{globalThis.fetch=original;await DB.prepare("DELETE FROM employer_billing WHERE employer_id='emp1'").run()}
  });
});

describe('free introductions', ()=>{
  it('counts an introduction when a caregiver says yes and hides contact past the free ones', async()=>{
    const stripe={STRIPE_SECRET_KEY:'sk_test',STRIPE_PRICE_ID:'price_test',FREE_CONTACTS:'1'};
    await DB.prepare("INSERT INTO employer_leads(id,company_name,contact_name,email,zip,roles_needed,status,approved_at) VALUES ('emp-intro','Intro Care','Lee','lee@introcare.test','21201','CNA','active',CURRENT_TIMESTAMP)").run();
    await DB.prepare("INSERT INTO employer_sessions(id,employer_id,session_hash,expires_at) VALUES ('intro-s','emp-intro',?,?)").bind(await sha256Hex('intro-cookie'),new Date(Date.now()+86400000).toISOString()).run();
    const headers={cookie:'cj_session=intro-cookie','content-type':'application/json'};
    const {id}=await (await call('/api/openings',{method:'POST',headers,body:JSON.stringify({title:'CNA intro',role:'CNA',zip:'21201'})},stripe)).json() as any;
    await call('/api/openings/'+id+'/match',{method:'POST',headers},stripe);
    sent.length=0;
    // Inviting two uses no introductions yet.
    expect((await (await call('/api/openings/'+id+'/contact',{method:'POST',headers,body:JSON.stringify({limit:2})},stripe)).json() as any).sent).toBe(2);
    expect((await (await call('/api/billing',{headers},stripe)).json() as any).freeContactsRemaining).toBe(1);
    const tokens=sent.filter(m=>m.html?.includes('/respond?token=')).map(m=>decodeURIComponent(m.html!.match(/respond\?token=([^"&\s]+)/)![1]));
    expect(tokens).toHaveLength(2);
    sent.length=0;
    for(const token of tokens){
      const res=await call('/api/respond',{method:'POST',headers:{'content-type':'application/json',origin:'https://carejoys.com'},body:JSON.stringify({token,choice:'interested'})},stripe);
      expect(res.status).toBe(200);
    }
    const notices=sent.filter(m=>m.subject.startsWith('Interested candidate:'));
    expect(notices).toHaveLength(2);
    expect(notices[0].html).toMatch(/@example\.com/);
    expect(notices[1].html).not.toMatch(/@example\.com/);
    expect(notices[1].html).toContain('free introductions');
    const rows=(await (await call('/api/pipeline?openingId='+id,{headers},stripe)).json() as any).pipeline.filter((r:any)=>r.stage==='interested');
    expect(rows.filter((r:any)=>r.contact_email).length).toBe(1);
    expect(rows.filter((r:any)=>r.contact_locked&&!r.contact_email).length).toBe(1);
    // The locked caregiver can't book interview times the employer can't see.
    const lockedToken=tokens[1];
    expect((await (await call('/api/respond?token='+encodeURIComponent(lockedToken),{},stripe)).json() as any).opportunity.slots).toEqual([]);
    expect((await call('/api/openings/'+id+'/contact',{method:'POST',headers,body:'{}'},stripe)).status).toBe(402);
    // A subscription unlocks everyone.
    await DB.prepare("INSERT INTO employer_billing(employer_id,status) VALUES ('emp-intro','active')").run();
    const unlocked=(await (await call('/api/pipeline?openingId='+id,{headers},stripe)).json() as any).pipeline.filter((r:any)=>r.stage==='interested');
    expect(unlocked.every((r:any)=>r.contact_email&&!r.contact_locked)).toBe(true);
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
  it('nurse aide registry page lists every state with official links', async()=>{
    const page=await call('/resources/nurse-aide-registry-by-state',{},htmlAssets);
    expect(page.status).toBe(200);
    const html=await page.text();
    expect(html).toContain('<tr id="north-carolina">');
    expect(html).toContain('<tr id="maryland">');
    expect(html.match(/<tr id="/g)?.length).toBe(51);
    expect(await (await call('/sitemaps/pages.xml')).text()).toContain('/resources/nurse-aide-registry-by-state');
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
  it('CNA pages list only CNA and GNA jobs, link to the caregiver page, and the search box opens them', async()=>{
    const ids=Array.from({length:10},(_,i)=>'job-cna-'+i);
    for(const id of ids)await DB.prepare("INSERT OR REPLACE INTO caregiver_jobs(id,agency_organization_id,dedupe_key,source_provider,source_url,title,role,employer_name,city,state,zip,status,is_published) VALUES (?,'org-test',?,'test',?,'CNA Nights','CNA','Sunrise Home Care','Towson','MD','21204','current',1)")
      .bind(id,id,'https://sunrisecare.test/jobs/'+id).run();
    await DB.prepare("INSERT OR REPLACE INTO caregiver_jobs(id,agency_organization_id,dedupe_key,source_provider,source_url,title,role,employer_name,city,state,zip,status,is_published) VALUES ('job-companion','org-test','job-companion','test','https://sunrisecare.test/jobs/c','Companion','Caregiver','Sunrise Home Care','Towson','MD','21204','current',1)").run();
    try{
      // Two Baltimore CNA jobs from earlier fixtures plus ten Towson ones; the companion job stays on the caregiver page only.
      const page=await call('/cna-jobs/maryland/baltimore',{},htmlAssets);
      expect(page.status).toBe(200);
      const html=await page.text();
      expect(html).toContain('<title>CNA Jobs in Baltimore, MD Area: GNA &amp; Nursing Assistant</title>');
      expect(html).toContain('<h1>CNA and GNA jobs in the Baltimore area</h1>');
      expect(html).toContain('12 current CNA and GNA jobs in the Baltimore area');
      expect(html).not.toContain('Companion');
      expect(html).not.toContain('noindex');
      expect(html).toContain('<a href="/caregiver-jobs/maryland/baltimore">See all 13 caregiver jobs in the Baltimore area</a>');
      const caregiver=await (await call('/caregiver-jobs/maryland/baltimore',{},htmlAssets)).text();
      expect(caregiver).toContain('<h1>Caregiver jobs in the Baltimore area</h1>');
      expect(caregiver).toContain('<a href="/cna-jobs/maryland/baltimore">See 12 CNA and GNA jobs in the Baltimore area</a>');
      const go=async(q:string)=>(await call('/caregiver-jobs?q='+encodeURIComponent(q),{},htmlAssets)).headers.get('location');
      expect(await go('cna jobs towson')).toBe('https://carejoys.com/cna-jobs/maryland/towson');
      expect(await go('CNA Baltimore, MD')).toBe('https://carejoys.com/cna-jobs/maryland/baltimore');
      expect(await go('gna jobs in maryland')).toBe('https://carejoys.com/cna-jobs/maryland');
      const api=await (await call('/api/public/jobs-hub?state=MD&city=baltimore&cna=1')).json() as any;
      expect([api.total,api.cna,api.sibling]).toEqual([12,true,13]);
      const sitemap=await (await call('/sitemaps/locations.xml')).text();
      expect(sitemap).toContain('<loc>https://carejoys.com/cna-jobs/maryland/baltimore</loc>');
      expect(sitemap).toContain('<loc>https://carejoys.com/cna-jobs/maryland/towson</loc>');
      expect(sitemap).toContain('<loc>https://carejoys.com/cna-jobs/maryland</loc>');
    }finally{
      await DB.prepare("DELETE FROM caregiver_jobs WHERE id LIKE 'job-cna-%' OR id='job-companion'").run();
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

  it('a facility pull saves facilities and leaves home care listings alone', async()=>{
    await DB.prepare("DELETE FROM dataforseo_import_jobs").run();
    await DB.prepare("DELETE FROM agencies WHERE source='google_business'").run();
    await DB.prepare("INSERT INTO agencies(id,source,source_key,name,state,is_active,last_source_sync_at) VALUES ('legacy','google_business','place:legacy','Old Home Care','VA',1,'2020-01-01 00:00:00')").run();
    await DB.prepare("INSERT INTO agencies(id,source,source_key,name,state,is_active,last_source_sync_at,provider_kind,google_pull_category) VALUES ('gone-alf','google_business','place:gone-alf','Closed Assisted Living','VA',1,'2020-01-01 00:00:00','facility','assisted_living_facility')").run();
    await DB.prepare("INSERT INTO dataforseo_import_jobs(id,states,mode,max_cost,categories) VALUES ('fac','VA','import',10,'assisted_living_facility')").run();
    const calls:any[]=[];
    const original=globalThis.fetch;
    globalThis.fetch=(async(_url:string,init:any)=>{
      const task=JSON.parse(init.body)[0];
      calls.push(task);
      const virginia=task.filters?.[0]?.[2]==='Virginia';
      if(task.limit===1)return new Response(JSON.stringify({status_code:20000,cost:0.01,tasks:[{status_code:20000,result:[{total_count:virginia?1:0,items:[]}]}]}));
      return new Response(JSON.stringify({status_code:20000,cost:0.5,tasks:[{status_code:20000,result:[{total_count:1,items:[listing(9,{title:'Oak Grove Assisted Living',category:'Assisted living facility'})]}]}]}));
    }) as any;
    try{await runDataForSeoJobs(env(creds));await runDataForSeoJobs(env(creds))}finally{globalThis.fetch=original}
    expect((await status('fac') as any).status).toBe('done');
    expect(calls.every(c=>c.categories[0]==='assisted_living_facility')).toBe(true);
    const rows=Object.fromEntries(((await DB.prepare("SELECT name,provider_kind,google_pull_category,is_active FROM agencies WHERE source='google_business'").all()).results as any[]).map(r=>[r.name,r]));
    expect(rows['Oak Grove Assisted Living']).toMatchObject({provider_kind:'facility',google_pull_category:'assisted_living_facility',is_active:1});
    expect(rows['Closed Assisted Living'].is_active).toBe(0);
    expect(rows['Old Home Care'].is_active).toBe(1);
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
      workConditions:['pets'],checklist:['over18','background_check','bogus'],payMin:19,transportation:'own_car',travelMiles:15},{cookie});
    expect(res.status).toBe(200);
    const row=await DB.prepare("SELECT shift_preferences,employment_types,license_state,desired_wage,work_status FROM caregivers WHERE id='baltimore'").first() as any;
    expect(row).toEqual({shift_preferences:'Mornings, Overnights, Weekends, Live-in',employment_types:'full_time',license_state:'MD',desired_wage:'$19+/hr',work_status:'actively_looking'});
    const me=await (await call('/api/me',{headers:{cookie}})).json() as any;
    expect(me.caregiver.availability.days.mon).toEqual(['morning','overnight']);
    expect(me.caregiver.availability.days.tue).toEqual([]);
    expect(me.caregiver.availability.liveIn).toBe(true);
    expect(me.caregiver.workConditions).toEqual(['pets']);
    expect(me.caregiver.checklist).toEqual(['over18','background_check']);
  });

  it('a caregiver previews their card exactly as employers see it, without contact details', async()=>{
    expect((await call('/api/me/employer-view')).status).toBe(401);
    const {cookie}=await signIn('baltimore@example.com');
    const view=await (await call('/api/me/employer-view',{headers:{cookie}})).json() as any;
    expect(view.visible).toBe(true);
    expect(view.candidate.name).toBe('Bea M.');
    expect(view.candidate.shifts).toBe('Mornings, Overnights, Weekends, Live-in');
    expect(view.candidate.schedule).toBe('Mon: mornings, overnights · Sat: mornings');
    expect(view.candidate.checklist).toEqual(['over18','background_check']);
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
    expect(mine[0].subject).toBe('Your job is live on CareJoys, Brightway Care');
    expect(mine[0].html).toContain('1 of your jobs is already listed on CareJoys');
    expect(mine[0].html).toContain('See your jobs and inbox');
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

  it('never emails a senior living facility or a chain board, even with live jobs and an email', async()=>{
    await DB.prepare("INSERT INTO agency_organizations(id,organization_key,canonical_name,primary_email,city,state,is_active,provider_kind) VALUES ('org-facility','org-facility','Oak Grove Assisted Living','jobs@oakgrove.test','Towson','MD',1,'facility')").run();
    await DB.prepare("INSERT INTO caregiver_jobs(id,agency_organization_id,dedupe_key,source_provider,source_url,title,role,employer_name,city,state,status,is_published) VALUES ('job-facility','org-facility','job-facility','test','https://oakgrove.test/jobs/1','CNA','CNA','Oak Grove','Towson','MD','current',1)").run();
    await DB.prepare("UPDATE agency_organizations SET primary_email='talent@brookdale.test' WHERE id='org_chain_brookdale'").run();
    await DB.prepare("INSERT INTO caregiver_jobs(id,agency_organization_id,dedupe_key,source_provider,source_url,title,role,employer_name,city,state,status,is_published) VALUES ('job-chain','org_chain_brookdale','job-chain','icims','https://jobs-brookdale.icims.com/jobs/1/cna/job','CNA','CNA','Brookdale Senior Living','Towson','MD','current',1)").run();
    sent.length=0;
    await sendAgencyHiringInvites(env(),50);
    expect(sent.map(m=>m.to)).not.toContain('jobs@oakgrove.test');
    expect(sent.map(m=>m.to)).not.toContain('talent@brookdale.test');
    // The chain boards are seeded as facilities on their corporate job boards.
    expect(await DB.prepare("SELECT provider_kind,is_chain,primary_careers_url FROM agency_organizations WHERE id='org_chain_erickson'").first())
      .toEqual({provider_kind:'facility',is_chain:1,primary_careers_url:'https://erickson.wd108.myworkdayjobs.com/en-US/External'});
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

describe('agency always-on opening', ()=>{
  it('matches hiring preferences with the same distance and role rules as any opening', async()=>{
    await DB.prepare("INSERT OR REPLACE INTO agency_organizations(id,organization_key,canonical_name,primary_domain,primary_email,city,state,zip,is_active,claimed_employer_id) VALUES ('org-claimed','org-claimed','Acme Care','acme.test','jobs@acme.test','Baltimore','MD','21201',1,'emp1')").run();
    const headers={cookie:'cj_session='+SESSION,'content-type':'application/json',origin:'https://carejoys.com'};
    const res=await call('/api/agency/hiring-profile',{method:'POST',headers,body:JSON.stringify({hiringStatus:'hiring',roles:'CNA'})});
    expect(res.status).toBe(200);
    const {openingId}=await res.json() as any;
    const rows=(await (await call('/api/pipeline?openingId='+openingId,{headers})).json() as any).pipeline;
    const ids=rows.map((r:any)=>r.caregiver_id);
    expect(ids).toContain('baltimore');
    expect(ids).not.toContain('la');
    expect(ids).not.toContain('dc');
    expect(rows.find((r:any)=>r.caregiver_id==='baltimore').match_reasons).toContain('role match');
  });
  it('turns one of the agency’s job listings into an opening with matches', async()=>{
    await DB.prepare(`INSERT OR REPLACE INTO caregiver_jobs(id,agency_organization_id,dedupe_key,source_provider,source_url,title,role,employer_name,city,state,zip,pay_min,pay_max,pay_period,status,is_published)
      VALUES ('job-recruit','org-claimed','dr','ats','https://acme.test/jobs/1','Certified Nursing Assistant (CNA) - Weekends','','Acme Care','Baltimore','MD','21201',18,21,'hour','current',1)`).run();
    const headers={cookie:'cj_session='+SESSION,'content-type':'application/json',origin:'https://carejoys.com'};
    const first=await (await call('/api/agency/jobs/job-recruit',{method:'POST',headers,body:JSON.stringify({action:'recruit'})})).json() as any;
    const again=await (await call('/api/agency/jobs/job-recruit',{method:'POST',headers,body:JSON.stringify({action:'recruit'})})).json() as any;
    expect(again.openingId).toBe(first.openingId);
    expect(await DB.prepare('SELECT title,role,zip,pay_min,pay_max,source FROM openings WHERE id=?').bind(first.openingId).first())
      .toEqual({title:'Certified Nursing Assistant (CNA) - Weekends',role:'CNA',zip:'21201',pay_min:18,pay_max:21,source:'agency_job'});
    const match=await (await call('/api/openings/'+first.openingId+'/match',{method:'POST',headers})).json() as any;
    expect(match.top.map((c:any)=>c.id)).toContain('baltimore');
  });
});

describe('reviewing candidates', ()=>{
  const stripe={STRIPE_SECRET_KEY:'sk_test',STRIPE_PRICE_ID:'price_test',FREE_CONTACTS:'1'};
  const headers={cookie:'cj_session=tools-cookie','content-type':'application/json',origin:'https://carejoys.com'};
  let openingId='',rowId='';
  beforeAll(async()=>{
    await DB.prepare("INSERT INTO employer_leads(id,company_name,contact_name,email,zip,roles_needed,status,approved_at) VALUES ('emp-tools','Tools Care','Sam','sam@toolscare.test','21401','CNA','active',CURRENT_TIMESTAMP)").run();
    await DB.prepare("INSERT INTO employer_sessions(id,employer_id,session_hash,expires_at) VALUES ('tools-s','emp-tools',?,?)").bind(await sha256Hex('tools-cookie'),new Date(Date.now()+86400000).toISOString()).run();
    await addCaregiver('annapolis','21401',{checklist:'over18,can_lift'});
    await DB.prepare("INSERT INTO caregiver_resume_files(caregiver_id,file_blob,file_name,content_type,byte_size) VALUES ('annapolis',?,'annapolis.pdf','application/pdf',8)").bind(new TextEncoder().encode('%PDF-1.4')).run();
    openingId=((await (await call('/api/openings',{method:'POST',headers,body:JSON.stringify({title:'CNA Annapolis',role:'CNA',zip:'21401'})},stripe)).json()) as any).id;
    await call('/api/openings/'+openingId+'/match',{method:'POST',headers},stripe);
    const rows=(await (await call('/api/pipeline?openingId='+openingId,{headers},stripe)).json() as any).pipeline;
    rowId=rows.find((r:any)=>r.caregiver_id==='annapolis').id;
  });

  it('shows the caregiver’s checklist, and shares the resume only after they say yes', async()=>{
    const row=(await (await call('/api/pipeline?openingId='+openingId,{headers},stripe)).json() as any).pipeline.find((r:any)=>r.id===rowId);
    expect(row.profile.checklist).toEqual(['over18','can_lift']);
    expect(row.resume_url).toBeNull();
    expect((await call('/api/pipeline/'+rowId+'/resume',{headers},stripe)).status).toBe(403);
    // Another employer can't reach it at all.
    expect((await call('/api/pipeline/'+rowId+'/resume',{headers:{cookie:'cj_session='+SESSION}},stripe)).status).toBe(404);
    sent.length=0;
    await call('/api/openings/'+openingId+'/contact',{method:'POST',headers,body:JSON.stringify({pipelineIds:[rowId]})},stripe);
    const token=decodeURIComponent(sent.find(m=>m.html?.includes('/respond?token='))!.html!.match(/respond\?token=([^"&\s]+)/)![1]);
    await call('/api/respond',{method:'POST',headers:{'content-type':'application/json',origin:'https://carejoys.com'},body:JSON.stringify({token,choice:'interested'})},stripe);
    const after=(await (await call('/api/pipeline?openingId='+openingId,{headers},stripe)).json() as any).pipeline.find((r:any)=>r.id===rowId);
    expect(after.resume_url).toBe('/api/pipeline/'+rowId+'/resume');
    const file=await call(after.resume_url,{headers},stripe);
    expect(file.status).toBe(200);
    expect(file.headers.get('content-disposition')).toContain('annapolis.pdf');
    expect(await file.text()).toBe('%PDF-1.4');
  });

  it('stars a caregiver, and restores only the ones the employer marked not a fit', async()=>{
    const patch=(body:unknown)=>call('/api/pipeline/'+rowId,{method:'PATCH',headers,body:JSON.stringify(body)},stripe);
    const get=async()=>(await (await call('/api/pipeline?openingId='+openingId,{headers},stripe)).json() as any).pipeline.find((r:any)=>r.id===rowId);
    expect((await patch({favorite:true})).status).toBe(200);
    expect((await get()).favorite).toBe(true);
    expect((await patch({stage:'restore'})).status).toBe(409);
    await patch({stage:'rejected'});
    expect((await get()).stage).toBe('rejected');
    expect(await (await patch({stage:'restore'})).json()).toEqual({ok:true,stage:'interested'});
    expect((await get()).stage).toBe('interested');
    await patch({favorite:false});
    expect((await get()).favorite).toBe(false);
    // A caregiver's own "not interested" can't be undone by the employer.
    await DB.prepare("UPDATE candidate_pipeline SET stage='rejected',rejected_reason='candidate_not_interested' WHERE id=?").bind(rowId).run();
    expect((await patch({stage:'restore'})).status).toBe(409);
    await DB.prepare("UPDATE candidate_pipeline SET stage='interested',rejected_reason=NULL WHERE id=?").bind(rowId).run();
  });

  it('job-page interest uses an introduction, and past the free ones its contact and resume wait for billing', async()=>{
    await DB.prepare("INSERT INTO agency_organizations(id,organization_key,canonical_name,city,state,zip,is_active,claimed_employer_id) VALUES ('org-tools','org-tools','Tools Care','Annapolis','MD','21401',1,'emp-tools')").run();
    await DB.prepare("INSERT INTO agency_interests(id,organization_id,caregiver_id,job_key,source,created_at) VALUES ('ai-tools','org-tools','annapolis','','job_apply',datetime('now','+1 minute'))").run();
    expect((await (await call('/api/billing',{headers},stripe)).json() as any).contactsUsed).toBe(2);
    const inbox=await (await call('/api/agency/inbox',{headers},stripe)).json() as any;
    const item=inbox.items.find((i:any)=>i.id==='ai-tools');
    expect(item.contactLocked).toBe(true);
    expect(item.caregiver.email).toBe('');
    expect(item.resumeUrl).toBeNull();
    expect((await call('/api/agency/inbox/ai-tools/resume',{headers},stripe)).status).toBe(402);
    // The earlier yes is still the free one.
    const row=(await (await call('/api/pipeline?openingId='+openingId,{headers},stripe)).json() as any).pipeline.find((r:any)=>r.id===rowId);
    expect(row.contact_locked).toBe(false);
    // Without billing turned on nothing is locked.
    const open=(await (await call('/api/agency/inbox',{headers})).json() as any).items.find((i:any)=>i.id==='ai-tools');
    expect(open.caregiver.email).toBe('annapolis@example.com');
    expect(open.resumeUrl).toBe('/api/agency/inbox/ai-tools/resume');
    expect((await call(open.resumeUrl,{headers})).status).toBe(200);
  });

  it('saves email templates for the employer who made them only', async()=>{
    expect((await call('/api/email-templates',{method:'POST',headers,body:JSON.stringify({name:'Phone screen',subject:'Hi',body:''})})).status).toBe(400);
    const made=await call('/api/email-templates',{method:'POST',headers,body:JSON.stringify({name:'Phone screen',subject:'{opening} at {company}',body:'Hi {first_name}'})});
    expect(made.status).toBe(201);
    const {id}=await made.json() as any;
    await call('/api/email-templates',{method:'POST',headers,body:JSON.stringify({id,name:'Phone screen',subject:'Call about {opening}',body:'Hi {first_name}'})});
    const list=(await (await call('/api/email-templates',{headers})).json() as any).templates;
    expect(list.map((t:any)=>[t.name,t.subject])).toEqual([['Phone screen','Call about {opening}']]);
    const other={cookie:'cj_session='+SESSION,origin:'https://carejoys.com'};
    expect((await (await call('/api/email-templates',{headers:other})).json() as any).templates).toEqual([]);
    await call('/api/email-templates/'+id,{method:'DELETE',headers:other});
    expect((await (await call('/api/email-templates',{headers})).json() as any).templates).toHaveLength(1);
    await call('/api/email-templates/'+id,{method:'DELETE',headers});
    expect((await (await call('/api/email-templates',{headers})).json() as any).templates).toEqual([]);
  });
});

describe('homepage hero stats',()=>{
  it('returns live counts and newest paid openings, one per employer',async()=>{
    const res=await call('/api/public/home-stats');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('max-age');
    const body=await res.json() as any;
    expect(body.ok).toBe(true);
    for(const k of ['jobs','states','employersWatched','newThisWeek'])expect(typeof body[k]).toBe('number');
    expect(body.latest.length).toBeLessThanOrEqual(4);
    const employers=body.latest.map((j:any)=>j.employerName.toLowerCase());
    expect(new Set(employers).size).toBe(employers.length);
    for(const j of body.latest)expect(j.payMax).not.toBeNull();
  });
});

describe('site monitoring', ()=>{
  const report=(body:unknown,ua='Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1')=>call('/api/client-errors',
    {method:'POST',headers:{'content-type':'application/json',origin:'https://carejoys.com','user-agent':ua},body:JSON.stringify(body)});
  beforeAll(async()=>{for(const t of ['client_errors','monitor_alerts','analytics_events','worker_funnel_events'])await DB.prepare(`DELETE FROM ${t}`).run();});
  it('stores browser errors grouped across deploys, and drops bots, extensions and other sites\' scripts', async()=>{
    expect((await report({kind:'error',message:"Cannot read properties of undefined (reading 'id')",source:'https://carejoys.com/assets/index-AbC12345.js:1:200',path:'/jobs/job-1?zip=21201'})).status).toBe(204);
    await report({kind:'error',message:"Cannot read properties of undefined (reading 'id')",source:'https://carejoys.com/assets/index-ZzZ98765.js:1:999',path:'/jobs/job-2'});
    await report({kind:'api',message:'POST /api/caregivers returned 500',path:'/caregiver-resume'});
    await report({kind:'error',message:'boom',source:'chrome-extension://abc/content.js:1:1',path:'/'});
    await report({kind:'error',message:'boom from an ad',source:'https://ads.example.net/tag.js:1:1',path:'/'});
    await report({kind:'error',message:'Script error.',path:'/'});
    await report({kind:'rejection',message:'Object Not Found Matching Id:4, MethodName:update, ParamCount:4',path:'/agency'},'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36');
    await report({kind:'error',message:'crawler error',source:'https://carejoys.com/assets/x.js:1:1',path:'/'},'Googlebot/2.1');
    expect((await call('/api/client-errors',{method:'POST',headers:{'content-type':'application/json',origin:'https://evil.test'},body:'{}'})).status).toBe(403);
    const rows=(await DB.prepare('SELECT kind,message,count,first_path,last_path FROM client_errors ORDER BY kind').all()).results;
    expect(rows).toEqual([
      {kind:'api',message:'POST /api/caregivers returned 500',count:1,first_path:'/caregiver-resume',last_path:'/caregiver-resume'},
      {kind:'error',message:"Cannot read properties of undefined (reading 'id')",count:2,first_path:'/jobs/job-1',last_path:'/jobs/job-2'},
    ]);
  });
  it('records uncaught Worker exceptions and still fails the request', async()=>{
    const broken={ASSETS:{fetch:async()=>{throw new Error('asset store down')}}};
    await expect(call('/missing-file.css',{},broken)).rejects.toThrow('asset store down');
    const row=await DB.prepare("SELECT message,source FROM client_errors WHERE kind='server'").first() as any;
    expect(row).toEqual({message:'GET /missing-file.css: asset store down',source:'worker'});
  });
  it('emails new errors once, at most every 30 minutes', async()=>{
    sent.length=0;
    const first=await alertNewClientErrors(env({ALERT_EMAILS:'alerts@carejoys.test'}));
    expect(first).toMatchObject({sent:true,count:3});
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual(['alerts@carejoys.test']);
    expect(sent[0].subject).toBe('CareJoys alert: 3 new site errors');
    expect((sent[0] as any).text).toContain('API call failed on /caregiver-resume: POST /api/caregivers returned 500');
    // Nothing new: no email.
    expect(await alertNewClientErrors(env({ALERT_EMAILS:'alerts@carejoys.test'}))).toMatchObject({sent:false,count:0});
    // A new problem inside the 30 minutes waits for the next window.
    await report({kind:'react',message:'Minified React error #31',source:'https://carejoys.com/assets/index-AbC12345.js:2:10',path:'/app'});
    expect(await alertNewClientErrors(env({ALERT_EMAILS:'alerts@carejoys.test'}))).toMatchObject({sent:false,count:1});
    expect(sent).toHaveLength(1);
    // With no ALERT_EMAILS or ADMIN_EMAILS the owner accounts get it.
    await DB.prepare("UPDATE monitor_alerts SET created_at=datetime('now','-31 minutes')").run();
    expect(await alertNewClientErrors(env())).toMatchObject({sent:true,count:1});
    expect(sent[1].to).toContain('myersrebeccal@gmail.com');
  });
  it('daily funnel alarm fires only when a step that was due dropped to zero', async()=>{
    const add=async(table:string,type:string,daysAgo:number,n:number)=>{
      for(let i=0;i<n;i++){
        const at=new Date(Date.now()-daysAgo*86400000-i*60000).toISOString().replace('T',' ').slice(0,19);
        if(table==='analytics_events')await DB.prepare("INSERT INTO analytics_events(id,event_type,path,created_at) VALUES (?,'page_view','/',?)").bind(crypto.randomUUID(),at).run();
        else await DB.prepare('INSERT INTO worker_funnel_events(id,visitor_id,event_type,created_at) VALUES (?,?,?,?)').bind(crypto.randomUUID(),crypto.randomUUID(),type,at).run();
      }
    };
    // Two weeks of 20 page views and 5 ZIP searches a day; today 20 page views and no searches.
    for(let d=1;d<=14;d++){await add('analytics_events','',d+0.1,20);await add('worker_funnel_events','preview_jobs',d+0.1,5);}
    await add('analytics_events','',0.1,20);
    sent.length=0;
    const result=await runDailyMonitor(env({ALERT_EMAILS:'alerts@carejoys.test'}));
    expect(result.findings.map((f:any)=>f.key)).toEqual(['zip_searches']);
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toBe('CareJoys alert: Job searches by ZIP dropped to zero');
    expect((sent[0] as any).text).toContain('20 page views in the same 24 hours');
    // One search today: healthy, no email.
    await add('worker_funnel_events','preview_empty',0.1,1);
    sent.length=0;
    expect((await runDailyMonitor(env({ALERT_EMAILS:'alerts@carejoys.test'}))).findings).toEqual([]);
    expect(sent).toHaveLength(0);
  });
  it('daily alarm reports Clarity rage clicks and the admin report shows everything', async()=>{
    const today=new Date().toISOString().slice(0,10);
    await DB.prepare("INSERT OR REPLACE INTO clarity_insights(pulled_on,dimension,status,payload,pulled_at) VALUES (?,'','ok',?,?)")
      .bind(today,JSON.stringify([{metricName:'RageClickCount',information:[{sessionsCount:9,sessionsWithMetricPercentage:11.11,subTotal:3}]},{metricName:'DeadClickCount',information:[{sessionsCount:9,sessionsWithMetricPercentage:11.11,subTotal:4}]}]),today).run();
    sent.length=0;
    const result=await runDailyMonitor(env({ALERT_EMAILS:'alerts@carejoys.test'}));
    expect(result.clicks).toEqual(['3 rage clicks (someone clicking the same spot over and over), in 11.11% of 9 sessions']);
    expect(sent[0].subject).toBe('CareJoys alert: visitors struggling with clicks');
    await DB.prepare("DELETE FROM clarity_insights WHERE pulled_on=?").bind(today).run();
    expect((await call('/api/admin/monitoring')).status).toBe(401);
  });
});

describe('opening follow-through', ()=>{
  const headers={cookie:'cj_session=follow-cookie','content-type':'application/json'};
  const ago=(days:number)=>new Date(Date.now()-days*86400000).toISOString().replace('T',' ').slice(0,19);
  async function inviteBoth(title:string){
    const {id}=await (await call('/api/openings',{method:'POST',headers,body:JSON.stringify({title,role:'CNA',zip:'21201'})})).json() as any;
    await call('/api/openings/'+id+'/match',{method:'POST',headers});
    const rows=(await (await call('/api/pipeline?openingId='+id,{headers})).json() as any).pipeline;
    const ids=rows.filter((r:any)=>['fu-near','fu-towson'].includes(r.caregiver_id)).map((r:any)=>r.id);
    sent.length=0;
    await call('/api/openings/'+id+'/contact',{method:'POST',headers,body:JSON.stringify({pipelineIds:ids})});
    const token=(to:string)=>decodeURIComponent(sent.find(m=>m.to===to)!.html!.match(/respond\?token=([^"&\s]+)/)![1]);
    return {id,yes:async(to:string)=>call('/api/respond',{method:'POST',headers:{'content-type':'application/json',origin:'https://carejoys.com'},body:JSON.stringify({token:token(to),choice:'interested'})})};
  }
  beforeAll(async()=>{
    await DB.prepare("INSERT INTO employer_leads(id,company_name,contact_name,email,zip,roles_needed,status,approved_at) VALUES ('emp-follow','Follow Care','Sam Lee','sam@followcare.test','21201','CNA','active',CURRENT_TIMESTAMP)").run();
    await addCaregiver('fu-near','21201');
    await addCaregiver('fu-towson','21204');
    await DB.prepare("INSERT INTO employer_sessions(id,employer_id,session_hash,expires_at) VALUES ('follow-s','emp-follow',?,?)").bind(await sha256Hex('follow-cookie'),new Date(Date.now()+86400000).toISOString()).run();
  });

  it('names an opening from the role and city when the title is left blank', async()=>{
    const {id}=await (await call('/api/openings',{method:'POST',headers,body:JSON.stringify({role:'CMT / Med Tech',zip:'21201'})})).json() as any;
    expect(await DB.prepare('SELECT title,city FROM openings WHERE id=?').bind(id).first()).toEqual({title:'CMT / Med Tech · Baltimore',city:'Baltimore'});
    expect((await call('/api/openings',{method:'POST',headers,body:JSON.stringify({role:'CNA'})})).status).toBe(400);
  });

  it('reminds an unanswered caregiver and nudges the employer once each, after two days', async()=>{
    const {id,yes}=await inviteBoth('CNA follow-ups');
    expect((await yes('fu-near@example.com')).status).toBe(200);
    expect(await sendHiringFollowups(env())).toEqual({reminders:0,nudges:0});
    await DB.prepare("UPDATE candidate_pipeline SET contacted_at=? WHERE opening_id=? AND stage='contacted'").bind(ago(3),id).run();
    await DB.prepare("UPDATE candidate_pipeline SET responded_at=?,response_at=?,updated_at=? WHERE opening_id=? AND stage='interested'").bind(ago(3),ago(3),ago(3),id).run();
    sent.length=0;
    expect(await sendHiringFollowups(env())).toEqual({reminders:1,nudges:1});
    expect(sent.find(m=>m.to==='fu-towson@example.com')?.subject).toBe('Still interested? Follow Care is waiting to hear from you');
    const nudge=sent.find(m=>m.to==='sam@followcare.test');
    expect(nudge?.html).toContain('/app?candidate=');
    expect(await sendHiringFollowups(env())).toEqual({reminders:0,nudges:0});
  });

  it('edits and closes an opening, telling waiting caregivers the role is filled', async()=>{
    const {id,yes}=await inviteBoth('CNA to close');
    await yes('fu-near@example.com');
    const edited=await call('/api/openings/'+id,{method:'PATCH',headers,body:JSON.stringify({title:'CNA evenings',role:'CNA',zip:'21204',payMin:20})});
    expect(edited.status).toBe(200);
    expect(await DB.prepare('SELECT title,city,pay_min FROM openings WHERE id=?').bind(id).first()).toEqual({title:'CNA evenings',city:'Towson',pay_min:20});
    // Invited caregivers stay on the list after the re-match.
    const rows=(await (await call('/api/pipeline?openingId='+id,{headers})).json() as any).pipeline;
    expect(rows.filter((r:any)=>['contacted','interested'].includes(r.stage))).toHaveLength(2);
    sent.length=0;
    const closed=await call('/api/openings/'+id,{method:'PATCH',headers,body:JSON.stringify({status:'closed'})});
    expect((await closed.json() as any).notified).toBe(1);
    expect(sent.map(m=>m.to)).toEqual(['fu-near@example.com']);
    expect((await call('/api/openings/'+id+'/match',{method:'POST',headers})).status).toBe(409);
    expect((await call('/api/openings/'+id+'/contact',{method:'POST',headers,body:'{}'})).status).toBe(409);
    expect(await sendHiringFollowups(env())).toEqual({reminders:0,nudges:0});
    // Reopening and closing again doesn't email the same caregiver twice.
    await call('/api/openings/'+id,{method:'PATCH',headers,body:JSON.stringify({status:'open'})});
    expect(await DB.prepare('SELECT status FROM openings WHERE id=?').bind(id).first()).toEqual({status:'open'});
    sent.length=0;
    await call('/api/openings/'+id,{method:'PATCH',headers,body:JSON.stringify({status:'closed'})});
    expect(sent).toHaveLength(0);
  });

  it('sends a short note when an interested caregiver is marked not a fit', async()=>{
    const {id,yes}=await inviteBoth('CNA not a fit');
    await yes('fu-towson@example.com');
    const row=(await (await call('/api/pipeline?openingId='+id,{headers})).json() as any).pipeline.find((r:any)=>r.caregiver_id==='fu-towson');
    sent.length=0;
    expect((await call('/api/pipeline/'+row.id,{method:'PATCH',headers,body:JSON.stringify({stage:'rejected'})})).status).toBe(200);
    expect(sent.map(m=>m.to)).toEqual(['fu-towson@example.com']);
  });

  it('saves where an interview happens', async()=>{
    const {id}=await (await call('/api/openings',{method:'POST',headers,body:JSON.stringify({role:'CNA',zip:'21201'})})).json() as any;
    const path='/api/openings/'+id+'/interview-slots';
    await call(path,{method:'POST',headers,body:JSON.stringify({location:'Phone call, we will ring you',slots:[{startsAt:new Date(Date.now()+2*86400000).toISOString(),timezone:'America/New_York',durationMinutes:30}]})});
    expect((await (await call(path,{headers})).json() as any).slots[0].location).toBe('Phone call, we will ring you');
  });

  it('stores the employer type from intake and ignores unknown values', async()=>{
    const intake=(email:string,employerType:string)=>post('/api/employers',{companyName:'Oak Grove',contactName:'Ana',email,zip:'21030',rolesNeeded:'Resident Assistant',employerType});
    expect((await intake('ana@oakgrove.test','assisted_living')).status).toBe(201);
    expect((await intake('bo@oakgrove.test','spaceship')).status).toBe(201);
    const types=Object.fromEntries(((await DB.prepare("SELECT email,employer_type FROM employer_leads WHERE email LIKE '%@oakgrove.test'").all()).results as any[]).map(r=>[r.email,r.employer_type]));
    expect(types).toEqual({'ana@oakgrove.test':'assisted_living','bo@oakgrove.test':null});
  });
});

describe('agency buyer: claim, team, settings and pricing', ()=>{
  const headers={cookie:'cj_session=buy-cookie','content-type':'application/json',origin:'https://carejoys.com'};
  const stripe={STRIPE_SECRET_KEY:'sk_test',STRIPE_PRICE_ID:'price_test'};
  let openingId='';
  beforeAll(async()=>{
    await DB.prepare("INSERT INTO employer_leads(id,company_name,contact_name,email,zip,roles_needed,status,approved_at) VALUES ('emp-buy','Buy Care','Jo Park','owner@buy.test','21204','CNA','active',CURRENT_TIMESTAMP)").run();
    await DB.prepare("INSERT INTO employer_sessions(id,employer_id,session_hash,expires_at) VALUES ('buy-s','emp-buy',?,?)").bind(await sha256Hex('buy-cookie'),new Date(Date.now()+86400000).toISOString()).run();
    await DB.prepare("INSERT INTO agency_organizations(id,organization_key,canonical_name,city,state,zip,is_active,claimed_employer_id) VALUES ('org-buy','org-buy','Buy Care','Towson','MD','21204',1,'emp-buy')").run();
    await DB.prepare("INSERT INTO caregiver_jobs(id,agency_organization_id,dedupe_key,source_provider,source_url,title,role,employer_name,city,state,zip,status,is_published) VALUES ('job-buy','org-buy','job-buy','test','https://buy.test/jobs/1','CNA Days','CNA','Buy Care','Towson','MD','21204','current',1)").run();
    await addCaregiver('buy-near','21204');
    await addCaregiver('buy-app','21204',{certifications:'CNA',state:'MD'});
    await DB.prepare("INSERT INTO agency_interests(id,organization_id,caregiver_id,caregiver_job_id,job_key,source,caregiver_note,created_at) VALUES ('ai-buy','org-buy','buy-app','job-buy','job-buy','job_apply','=HYPERLINK(\"x\")',datetime('now','-1 hour'))").run();
  });

  it('one click on the emailed claim link signs the agency in, with no second email', async()=>{
    await DB.prepare("INSERT INTO agency_organizations(id,organization_key,canonical_name,primary_email,city,state,zip,is_active) VALUES ('org-claim1','org-claim1','Claim Care','owner@claimcare.test','Towson','MD','21204',1)").run();
    await DB.prepare("INSERT INTO agency_teaser_tokens(id,organization_id,token_hash,recipient_email,expires_at,sent_at) VALUES ('tt-claim1','org-claim1',?,'owner@claimcare.test',?,CURRENT_TIMESTAMP)").bind(await sha256Hex('claim-token-1'),new Date(Date.now()+86400000).toISOString()).run();
    sent.length=0;
    const res=await post('/api/agency/claim/request',{token:'claim-token-1'},{origin:'https://carejoys.com'});
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ok:true,redirect:'/app?tab=jobs'});
    const cookies=res.headers.get('set-cookie')||'';
    expect(cookies).toContain('__Host-cj_session=');
    expect(cookies).toContain('__Host-cj_account=');
    expect(sent).toHaveLength(0);
    const org=await DB.prepare("SELECT claimed_employer_id FROM agency_organizations WHERE id='org-claim1'").first() as any;
    expect(org.claimed_employer_id).toBeTruthy();
    const session=cookies.match(/__Host-cj_session=([^;]+)/)![1];
    expect((await (await call('/api/session',{headers:{cookie:'__Host-cj_session='+session}})).json() as any).employer.id).toBe(org.claimed_employer_id);
    // The link works once.
    expect((await post('/api/agency/claim/request',{token:'claim-token-1'},{origin:'https://carejoys.com'})).status).toBe(409);
  });

  it('never matches or invites a caregiver who already applied to the agency', async()=>{
    openingId=((await (await call('/api/openings',{method:'POST',headers,body:JSON.stringify({title:'CNA Towson',role:'CNA',zip:'21204'})})).json()) as any).id;
    await call('/api/openings/'+openingId+'/match',{method:'POST',headers});
    const ids=(await (await call('/api/pipeline?openingId='+openingId,{headers})).json() as any).pipeline.map((r:any)=>r.caregiver_id);
    expect(ids).toContain('buy-near');
    expect(ids).not.toContain('buy-app');
  });

  it('adds a teammate who signs in to the same workspace, and removing them signs them out', async()=>{
    sent.length=0;
    const added=await call('/api/team',{method:'POST',headers,body:JSON.stringify({email:'Recruiter@Buy.test'})});
    expect(added.status).toBe(200);
    const memberId=(await added.json() as any).member.id;
    expect(sent.find(m=>m.to==='recruiter@buy.test')?.subject).toBe('Jo Park added you to Buy Care on CareJoys');
    expect((await call('/api/team',{method:'POST',headers,body:JSON.stringify({email:'recruiter@buy.test'})})).status).toBe(409);
    expect((await call('/api/team',{method:'POST',headers,body:JSON.stringify({email:'owner@buy.test'})})).status).toBe(409);
    // Another workspace can't remove them.
    expect((await call('/api/team/'+memberId,{method:'DELETE',headers:{cookie:'cj_session='+SESSION,origin:'https://carejoys.com'}})).status).toBe(404);

    sent.length=0;
    await post('/api/login/request',{email:'recruiter@buy.test'});
    const token=decodeURIComponent(sent.find(m=>m.to==='recruiter@buy.test')!.html!.match(/token=([^"&]+)/)![1]);
    const verified=await post('/api/login/verify',{token});
    expect((await verified.json() as any).redirect).toBe('/app');
    const workspace=verified.headers.get('set-cookie')!.match(/__Host-cj_session=([^;]+)/)![1];
    const team=await (await call('/api/team',{headers:{cookie:'__Host-cj_session='+workspace}})).json() as any;
    expect(team).toMatchObject({me:'recruiter@buy.test',owner:{email:'owner@buy.test'}});
    expect((await call('/api/session',{headers:{cookie:'__Host-cj_session='+workspace}})).status).toBe(200);

    expect((await call('/api/team/'+memberId,{method:'DELETE',headers})).status).toBe(200);
    expect((await call('/api/session',{headers:{cookie:'__Host-cj_session='+workspace}})).status).toBe(401);
    // Back on for the emails below.
    await call('/api/team',{method:'POST',headers,body:JSON.stringify({email:'recruiter@buy.test'})});
  });

  it('shows the agency’s own words on invitations and job pages', async()=>{
    const saved=await call('/api/workspace/settings',{method:'POST',headers,body:JSON.stringify({about:'Family owned in Towson since 2009.',benefits:'Weekly pay, mileage'})});
    expect((await saved.json() as any).settings).toMatchObject({about:'Family owned in Towson since 2009.',benefits:'Weekly pay, mileage',digest:true,atsEmail:''});
    const row=(await (await call('/api/pipeline?openingId='+openingId,{headers})).json() as any).pipeline.find((r:any)=>r.caregiver_id==='buy-near');
    sent.length=0;
    await call('/api/openings/'+openingId+'/contact',{method:'POST',headers,body:JSON.stringify({pipelineIds:[row.id]})});
    const invite=sent.find(m=>m.to==='buy-near@example.com')!;
    expect(invite.html).toContain('Family owned in Towson since 2009.');
    expect(invite.html).toContain('Weekly pay, mileage');
    const page=await (await call('/jobs/job-buy',{},htmlAssets)).text();
    expect(page).toContain('Family owned in Towson since 2009.');
    // The caregiver's yes goes to the owner and the teammate.
    const respondToken=decodeURIComponent(invite.html!.match(/respond\?token=([^"&\s]+)/)![1]);
    expect((await (await call('/api/respond?token='+encodeURIComponent(respondToken))).json() as any).opportunity.about).toBe('Family owned in Towson since 2009.');
    sent.length=0;
    await post('/api/respond',{token:respondToken,choice:'interested'},{origin:'https://carejoys.com'});
    expect(sent.find(m=>m.subject.startsWith('Interested candidate:'))?.to).toEqual(['owner@buy.test','recruiter@buy.test']);
  });

  it('forwards new candidates to the ATS inbox once, and exports everyone as CSV', async()=>{
    expect((await call('/api/workspace/settings',{method:'POST',headers,body:JSON.stringify({atsEmail:'not-an-email'})})).status).toBe(400);
    await DB.prepare("UPDATE candidate_pipeline SET responded_at=datetime('now','-1 hour') WHERE caregiver_id='buy-near' AND response_value='interested'").run();
    await call('/api/workspace/settings',{method:'POST',headers,body:JSON.stringify({atsEmail:'apply@ats.test'})});
    await addCaregiver('buy-new','21204');
    await DB.prepare("INSERT INTO agency_interests(id,organization_id,caregiver_id,job_key,source,created_at) VALUES ('ai-buy-new','org-buy','buy-new','','mcp',datetime('now','+1 minute'))").run();
    sent.length=0;
    await forwardToAts(env());
    const forwarded=sent.filter(m=>m.to==='apply@ats.test');
    // Only the one who arrived after forwarding was turned on; the earlier applicant and yes stay out.
    expect(forwarded.map(m=>m.subject)).toEqual(['Candidate: buy-new Test (CareJoys)']);
    expect(forwarded[0].html).toContain('buy-new@example.com');
    sent.length=0;
    await forwardToAts(env());
    expect(sent.filter(m=>m.to==='apply@ats.test')).toHaveLength(0);

    const csv=await call('/api/workspace/candidates.csv',{headers});
    expect(csv.headers.get('content-type')).toContain('text/csv');
    const text=await csv.text();
    const lines=text.trim().split('\r\n');
    expect(lines[0]).toBe('Name,Email,Phone,City,State,ZIP,Role,Certifications,Years experience,Position,Source,Stage,Date,Their note,Your notes');
    expect(lines.find(l=>l.startsWith('buy-app Test,buy-app@example.com'))).toContain('Applied from CareJoys job page');
    // A caregiver's note can't run as a spreadsheet formula.
    expect(text).toContain(`"'=HYPERLINK(""x"")"`);
    expect(lines.find(l=>l.startsWith('buy-near Test'))).toContain('Said yes');
    expect((await call('/api/workspace/candidates.csv')).status).toBe(401);
  });

  it('sends one morning digest to the team, and none when it is turned off', async()=>{
    sent.length=0;
    await sendDailyDigests(env(),1000);
    const digest=sent.find(m=>Array.isArray(m.to)&&m.to.includes('owner@buy.test'));
    expect(digest?.to).toEqual(['owner@buy.test','recruiter@buy.test']);
    expect(digest?.html).toContain('buy-app Test');
    expect(digest?.html).toContain('/app?tab=settings');
    sent.length=0;
    await sendDailyDigests(env(),1000);
    expect(sent.filter(m=>JSON.stringify(m.to).includes('owner@buy.test'))).toHaveLength(0);
    await call('/api/workspace/settings',{method:'POST',headers,body:JSON.stringify({digest:false})});
    await DB.prepare("UPDATE employer_leads SET last_digest_at=NULL WHERE id='emp-buy'").run();
    await sendDailyDigests(env(),1000);
    expect(sent.filter(m=>JSON.stringify(m.to).includes('owner@buy.test'))).toHaveLength(0);
  });

  it('sends last month’s results on the 1st, once', async()=>{
    const now=new Date();
    const first=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()+1,1,11));
    expect(await sendMonthlyResults(env(),new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),2,11)))).toEqual({sent:0});
    sent.length=0;
    await sendMonthlyResults(env(),first,1000);
    const mail=sent.find(m=>JSON.stringify(m.to).includes('owner@buy.test'));
    expect(mail?.subject).toMatch(/^Buy Care on CareJoys in \w+: 3 caregivers interested, 0 hired$/);
    sent.length=0;
    await sendMonthlyResults(env(),first,1000);
    expect(sent.filter(m=>JSON.stringify(m.to).includes('owner@buy.test'))).toHaveLength(0);
  });

  it('keeps each employer’s own license checks, for their own candidates only', async()=>{
    const check=(id:string,result:string,h=headers)=>call('/api/license-checks/'+id,{method:'POST',headers:h,body:JSON.stringify({result})});
    expect((await check('buy-app','maybe')).status).toBe(400);
    expect((await check('la','active')).status).toBe(404);
    expect((await check('buy-app','active')).status).toBe(200);
    const mine=(await (await call('/api/license-checks',{headers})).json() as any).checks;
    expect(mine['buy-app']).toMatchObject({result:'active',checkedBy:'owner@buy.test'});
    const theirs=(await (await call('/api/license-checks',{headers:{cookie:'cj_session='+SESSION}})).json() as any).checks;
    expect(theirs['buy-app']).toBeUndefined();
    expect((await check('buy-app','')).status).toBe(200);
    expect((await (await call('/api/license-checks',{headers})).json() as any).checks['buy-app']).toBeUndefined();
  });

  it('is free until the first hire, then new introductions and invitations wait for a subscription', async()=>{
    let status=await (await call('/api/billing',{headers},stripe)).json() as any;
    expect(status).toMatchObject({enabled:true,subscribed:false,firstHire:false,freeContacts:25});
    expect(status.freeContactsRemaining).toBeGreaterThan(0);
    expect((await call('/api/agency/inbox/ai-buy',{method:'POST',headers,body:JSON.stringify({stage:'hired'})},stripe)).status).toBe(200);
    status=await (await call('/api/billing',{headers},stripe)).json() as any;
    expect(status).toMatchObject({firstHire:true,freeContactsRemaining:0});
    const blocked=await call('/api/openings/'+openingId+'/contact',{method:'POST',headers,body:'{}'},stripe);
    expect(blocked.status).toBe(402);
    expect((await blocked.json() as any).error).toContain('first hire');
    await addCaregiver('buy-later','21204');
    await DB.prepare("INSERT INTO agency_interests(id,organization_id,caregiver_id,job_key,source,created_at) VALUES ('ai-buy-later','org-buy','buy-later','','job_apply',datetime('now','+5 minutes'))").run();
    const items=(await (await call('/api/agency/inbox',{headers},stripe)).json() as any).items;
    expect(items.find((i:any)=>i.id==='ai-buy-later').contactLocked).toBe(true);
    expect(items.find((i:any)=>i.id==='ai-buy').contactLocked).toBe(false);
    await DB.prepare("INSERT INTO employer_billing(employer_id,status) VALUES ('emp-buy','active')").run();
    expect((await (await call('/api/agency/inbox',{headers},stripe)).json() as any).items.every((i:any)=>!i.contactLocked)).toBe(true);
  });
});
