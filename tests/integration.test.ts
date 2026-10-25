import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPlatformProxy } from 'wrangler';
import worker from '../src/worker';
import { unsubscribeLink } from '../src/emailPreferences';
import { runOutreach } from '../src/outreach';
import { runDataForSeoJobs } from '../src/dataforseo';
import { pullClarityInsights } from '../src/clarity';
import { sendAgencyHiringInvites, sendAgencyHiringReinvites, friendlyAgencyName, sendFacilityPilotInvites, recheckAgencyEmailBatch } from '../src/agencyFeatures';
import { adminRecipients, alertNewClientErrors, alertRecipients, runDailyMonitor } from '../src/monitoring';
import { sendHiringFollowups } from '../src/employerFollowups';
import { refreshPostedJobs } from '../src/postedJobs';
import { sendFirstJobNudges } from '../src/firstJobNudge';
import { lookupCareersPagesBatch, lookupCareersPagesBoost } from '../src/careersLookup';
import { sendStillLookingEmails } from '../src/publicDirectory';
import { inviteText, runCareJoysSmsJobs, saveCaregiverSmsConsent, sendCareJoysSms, sendInterviewReminders, textJobInvite, timeZoneFor } from '../src/carejoysSms';
import { AGENCY_SMS_CONSENT_TEXT, SMS_CONSENT_TEXT } from '../src/smsConsent';
import { recordSmsConsent, twilioSignature } from '../src/sms';
import { forwardToAts, sendDailyDigests, sendMonthlyResults } from '../src/settingsApi';
import { runAutoApply } from '../src/applyAgent';
import { sendReplyYesBatch } from '../src/replyYesOutreach';
import { sendJobAlerts } from '../src/jobAlertSignups';

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
  for(const t of ['talent_alerts','caregiver_intro_videos','worker_funnel_events','worker_funnel_links','caregiver_job_alert_preferences','caregiver_resume_files','candidate_pipeline','interview_slots','openings','employer_sessions','employer_auth_tokens','availability_events','outreach_events','caregiver_resume_imports','caregiver_referrals','agency_org_candidate_matches','caregivers','employer_leads','email_suppressions','email_unsubscribe_tokens','outreach_runs','analytics_events','rate_limits','employer_billing','login_tokens','account_sessions']){
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
    // Searching the caregiver's own area shows them as close, but the Baltimore job is still out of their reach.
    const la=await (await call('/api/candidates/la?zip=90001',{headers:{cookie:'cj_session='+SESSION}})).json() as any;
    expect(la.candidate.withinCommute).toBe(true);
    expect(la.candidate.invitableOpeningIds).not.toContain(id);
    expect((await (await call('/api/candidates/towson?zip=21201',{headers:{cookie:'cj_session='+SESSION}})).json() as any).candidate.invitableOpeningIds).toContain(id);
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
  it('admin agency walkthrough sends the live hiring invite for a hidden test agency', async()=>{
    sent.length=0;
    const post=(body:object)=>call('/api/admin/agency-test',{method:'POST',headers:{cookie:'cj_session='+SESSION,origin:'https://carejoys.com','content-type':'application/json'},body:JSON.stringify(body)},{ADMIN_EMAILS:'pat@acme.test'});
    const res=await post({});
    expect(res.status).toBe(200);
    expect((await res.json() as any).result.candidateCount).toBeGreaterThan(0);
    expect(sent.map(m=>m.to)).toEqual(['pat@acme.test']);
    expect(sent[0].subject).toBe('[Test] CareJoys Test Agency: answer every caregiver applicant in 30 minutes');
    expect(sent[0].html).toContain('Set up my hiring');
    const token=decodeURIComponent((sent[0].html||'').match(/agency\?token=([^"&\s]+)/)![1]);
    const teaser=await (await call('/api/agency/teaser?token='+encodeURIComponent(token))).json() as any;
    expect(teaser.agency.name).toBe('CareJoys Test Agency');
    expect(teaser.candidateCount).toBeGreaterThan(0);
    expect(Array.isArray(teaser.jobs)).toBe(true);
    // Hidden from public search and not counted as real outreach.
    expect((await (await call('/api/agency/search?q=carejoys')).json() as any).agencies).toEqual([]);
    expect(await DB.prepare("SELECT COUNT(*) AS n FROM agency_outreach_events WHERE event_type IN ('candidate_teaser','hiring_needs_invite')").first()).toEqual({n:0});
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
      // The key is per minute, so don't start the pair in a minute's last seconds.
      const msLeft=60000-Date.now()%60000;
      if(msLeft<5000)await new Promise(r=>setTimeout(r,msLeft+50));
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
    for(const path of ['/dashboard','/admin','/hiring']){
      const html=await (await call(path,{},{...htmlAssets,...ids})).text();
      expect(html).not.toContain('clarity.ms');
      expect(html).toContain('google-site-verification');
    }
  });
});

describe('agency workspace address', ()=>{
  it('moves /app links, including the ones in emails already sent, to /hiring', async()=>{
    for(const [from,to] of [['/app','/hiring'],['/app?tab=candidates&source=posts','/hiring?tab=candidates&source=posts'],['/app/x','/hiring/x']]){
      const res=await call(from,{redirect:'manual'});
      expect(res.status).toBe(301);
      expect(new URL(res.headers.get('location')!).pathname+new URL(res.headers.get('location')!).search).toBe(to);
    }
    // Only the workspace itself moves.
    expect((await call('/applicants',{redirect:'manual'})).status).not.toBe(301);
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
  it('keeps unsigned profiles hidden until the email is verified, then shows them with no extra step, and stores an hourly floor',async()=>{
    const email='pay-floor-worker@realcare.test';
    const req={firstName:'Pay',lastName:'Floor',email,zip:'21201',role:'CNA',desiredWage:'$24–30/hr',
      availability:{days:{mon:['morning'],sat:['overnight']},liveIn:false},checklist:['over18','work_authorized','not_a_key']};
    const created=await post('/api/caregiver-resume',req);
    expect(created.status).toBe(201);
    const {id}=await created.json() as any;
    // Signing up means looking for work, so the profile is ready to show; the shift grid becomes the shifts summary.
    expect(await DB.prepare('SELECT phone,hourly_rate_min,desired_wage,work_status,last_confirmed_at IS NOT NULL AS confirmed,shift_preferences,availability_json,checklist FROM caregivers WHERE id=?').bind(id).first())
      .toEqual({checklist:'over18,work_authorized',phone:'',hourly_rate_min:24,desired_wage:'$24+/hr',work_status:'actively_looking',confirmed:1,shift_preferences:'Mornings, Overnights, Weekends',
        availability_json:JSON.stringify({days:{mon:['morning'],tue:[],wed:[],thu:[],fri:[],sat:['overnight'],sun:[]},liveIn:false})});
    // An unverified email could be anyone's, so the profile stays out of search until it is verified.
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
    expect((await DB.prepare('SELECT auth0_email_verified,work_status FROM caregivers WHERE id=?').bind(id).first())).toEqual({auth0_email_verified:1,work_status:'actively_looking'});
    const after=await (await call('/api/candidates?zip=21201',{headers:{cookie:'cj_session='+SESSION}})).json() as any;
    expect(after.candidates.some((c:any)=>c.id===id)).toBe(true);
  });
  it('shows separate agency and school outreach campaigns with their actual configured status',async()=>{
    const res=await call('/api/admin/overview',{headers:{authorization:'Bearer t0ken'}},{ADMIN_TOKEN:'t0ken',AGENCY_HIRING_INVITES_ENABLED:'true',AGENCY_HIRING_INVITE_DAILY_CAP:'20',OUTREACH_ENABLED:'false',WEEKLY_DIGEST_ENABLED:'true'});
    expect(res.status).toBe(200);
    const body=await res.json() as any;
    expect(body.funnel.outreachChannels.agencyHiring.enabled).toBe(true);
    expect(body.funnel.outreachChannels.agencyHiring.cap).toBe(20);
    expect(body.funnel.outreachChannels.agencyHiring.perHour).toBe(3);
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

describe('public employer pages', ()=>{
  const ID='abcd1234-0000-4000-8000-000000000001';
  beforeAll(async()=>{
    await DB.prepare("INSERT INTO employer_leads(id,company_name,contact_name,email,zip,roles_needed,status,approved_at,company_about,company_benefits) VALUES (?,'Bright Home Care','Lee','lee@bright.test','21201','CNA','active',CURRENT_TIMESTAMP,'Family-owned since 2009.','Weekly pay')").bind(ID).run();
    await DB.prepare("INSERT INTO employer_leads(id,company_name,contact_name,email,zip,roles_needed,status) VALUES ('ffff9999-0000-4000-8000-000000000002','Unchecked Care','Al','al@unchecked.test','21201','CNA','active')").run();
    await DB.prepare("INSERT INTO openings(id,employer_id,title,role,city,state,zip,pay_min,pay_max,status) VALUES ('pub-open','"+ID+"','CNA weekends','CNA','Baltimore','MD','21201',18,21,'open')").run();
    await DB.prepare("INSERT INTO openings(id,employer_id,title,role,zip,status) VALUES ('pub-closed','"+ID+"','Old job','CNA','21201','closed')").run();
  });
  afterAll(async()=>{
    await DB.prepare("DELETE FROM openings WHERE id IN ('pub-open','pub-closed')").run();
    await DB.prepare("DELETE FROM employer_leads WHERE id IN (?,'ffff9999-0000-4000-8000-000000000002')").bind(ID).run();
  });
  it('shows an approved employer with About, Benefits and only open jobs', async()=>{
    const res=await call('/api/public/employer/bright-home-care-abcd1234');
    expect(res.status).toBe(200);
    const {employer}=await res.json() as any;
    expect(employer).toMatchObject({name:'Bright Home Care',path:'/employers/bright-home-care-abcd1234',city:'Baltimore',state:'MD',about:'Family-owned since 2009.',benefits:'Weekly pay'});
    expect(employer.jobs.map((j:any)=>j.title)).toEqual(['CNA weekends']);
    const page=await call('/employers/bright-home-care-abcd1234',{},htmlAssets);
    expect(page.status).toBe(200);
    const html=await page.text();
    expect(html).toContain('Family-owned since 2009.');
    expect(html).toContain('"@type":"Organization"');
  });
  it('redirects an old name to the current page and hides unapproved workspaces', async()=>{
    const old=await call('/employers/old-name-abcd1234',{},htmlAssets);
    expect(old.status).toBe(301);
    expect(old.headers.get('location')).toBe('https://carejoys.com/employers/bright-home-care-abcd1234');
    expect((await call('/api/public/employer/unchecked-care-ffff9999')).status).toBe(404);
    expect((await call('/employers/unchecked-care-ffff9999',{},htmlAssets)).status).toBe(404);
  });
  it('shows a workspace that claimed its agency, with no manual approval', async()=>{
    const id='cccc5555-0000-4000-8000-000000000003';
    await DB.prepare("INSERT INTO employer_leads(id,company_name,contact_name,email,zip,roles_needed,status) VALUES (?,'Claimed Care','Jo','jo@claimed.test','21201','CNA','active')").bind(id).run();
    await DB.prepare("INSERT INTO agency_organizations(id,organization_key,canonical_name,city,state,is_active,claimed_employer_id) VALUES ('org-claimed-pub','org-claimed-pub','Claimed Care','Towson','MD',1,?)").bind(id).run();
    try{
      const res=await call('/api/public/employer/claimed-care-cccc5555');
      expect(res.status).toBe(200);
      expect(((await res.json()) as any).employer).toMatchObject({name:'Claimed Care',path:'/employers/claimed-care-cccc5555'});
    }finally{
      await DB.prepare("DELETE FROM agency_organizations WHERE id='org-claimed-pub'").run();
      await DB.prepare('DELETE FROM employer_leads WHERE id=?').bind(id).run();
    }
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
  it('job lists say when each job was posted and checked, and filter by hours and pay', async()=>{
    await DB.prepare("UPDATE caregiver_jobs SET date_posted='Posted 3 Days Ago',employment_type='Full time, Part time' WHERE id='job-test'").run();
    await DB.prepare("INSERT OR REPLACE INTO caregiver_jobs(id,agency_organization_id,dedupe_key,source_provider,source_url,title,role,employer_name,city,state,zip,employment_type,date_posted,status,is_published) VALUES ('job-prn','org-test','job-prn','test','https://sunrisecare.test/jobs/prn','HHA Per Diem','HHA','Sunrise Home Care','Baltimore','MD','21201','Per diem','2026-01-02','current',1)").run();
    const html=await (await call('/caregiver-jobs/maryland',{},htmlAssets)).text();
    // Workday's relative date is read against the day CareJoys last saw the job (today, in this test).
    expect(html).toContain('CNA - Day Shift</a> — Sunrise Home Care · Baltimore, MD · $18–$22/hr <small>Posted 3 days ago · Checked today</small>');
    expect(html).toContain('<a href="/caregiver-jobs/maryland?hours=part-time">Part-time</a>');
    // Filtered views are the reader's own, not pages for Google.
    const partTime=await call('/caregiver-jobs/maryland?hours=part-time',{},htmlAssets);
    const ptHtml=await partTime.text();
    expect(ptHtml).toContain('<meta name="robots" content="noindex,follow"');
    expect(ptHtml).toContain('CNA - Day Shift');
    expect(ptHtml).not.toContain('HHA Per Diem');
    const api=await (await call('/api/public/jobs-hub?state=MD&hours=per-diem')).json() as any;
    expect(api.jobs.map((j:any)=>j.id)).toEqual(['job-prn']);
    expect(api.jobs[0].datePosted).toBe('2026-01-02');
    const paid=await (await call('/api/public/jobs-national?pay=shown')).json() as any;
    expect(paid.jobs.map((j:any)=>j.id)).toContain('job-test');
    expect(paid.jobs.map((j:any)=>j.id)).not.toContain('job-prn');
    await DB.prepare("DELETE FROM caregiver_jobs WHERE id='job-prn'").run();
    await DB.prepare("UPDATE caregiver_jobs SET date_posted=NULL,employment_type=NULL WHERE id='job-test'").run();
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
    // CNA jobs have their own all-states page; old ?role= filter links land on one of the two pages.
    const cnaPage=await call('/cna-jobs',{},htmlAssets);
    expect(cnaPage.status).toBe(200);
    expect(await cnaPage.text()).toContain('<link rel="canonical" href="https://carejoys.com/cna-jobs" />');
    expect((await call('/caregiver-jobs?role=CNA',{},htmlAssets)).headers.get('location')).toBe('/cna-jobs');
    expect((await call('/caregiver-jobs/maryland?role=HHA',{},htmlAssets)).headers.get('location')).toBe('/caregiver-jobs/maryland');
    // A city with no current jobs opens its state page rather than a dead end.
    expect((await call('/cna-jobs/texas/nowhere',{},htmlAssets)).headers.get('location')).toBe('/cna-jobs/texas');
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

    // A second pull of the same listings writes nothing for the unchanged ones.
    await DB.prepare("UPDATE agencies SET updated_at='2026-01-01 00:00:00' WHERE source='google_business' AND is_active=1").run();
    await DB.prepare("DELETE FROM dataforseo_import_jobs").run();
    await job('imp2','import');
    const again=fakeApi([[listing(1),listing(2,{title:'Agency 2 Renamed'}),listing(3,{address_info:{region:'Maryland'}})],[listing(4),listing(5,{title:'Richmond Medical Supply'})]],5);
    try{await runDataForSeoJobs(env(creds));await runDataForSeoJobs(env(creds))}finally{again.restore()}
    const stamps=Object.fromEntries(((await DB.prepare("SELECT name,updated_at FROM agencies WHERE source='google_business' AND is_active=1").all()).results as any[]).map(r=>[r.name,r.updated_at]));
    expect(stamps['Agency 1']).toBe('2026-01-01 00:00:00');
    expect(stamps['Agency 2 Renamed']).not.toBe('2026-01-01 00:00:00');
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
    expect(body.redirect).toBe('/hiring');
    expect(body.roles).toEqual({caregiver:false,employer:true,admin:false,school:false});
    const session=await (await call('/api/session',{headers:{cookie}})).json() as any;
    expect(session.employer.id).toBe('emp1');
  });

  it('a new agency lands in the hiring workspace and can set it up without a second email', async()=>{
    const {body,cookie}=await signIn('new.owner@homecare.test','/hiring');
    expect(body.redirect).toBe('/hiring');
    const account=await (await call('/api/account',{headers:{cookie}})).json() as any;
    expect(account).toMatchObject({signedIn:true,email:'new.owner@homecare.test',roles:{caregiver:false,employer:false}});
    sent.length=0;
    const res=await post('/api/employers',{companyName:'Home Care Co',contactName:'Nia',email:'new.owner@homecare.test',zip:'21201',rolesNeeded:'CNA'},{cookie});
    expect(res.status).toBe(201);
    const created=await res.json() as any;
    expect(created.redirect).toContain('/hiring?opening=');
    // No second email to the agency; the admins still hear about the new lead.
    expect(sent.filter(m=>!m.subject.startsWith('New hire form:'))).toHaveLength(0);
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
    expect((await signIn('pat@acme.test')).body.redirect).toBe('/hiring');
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
    expect((await call('/',{headers:{cookie:agency+'; cj_last_dashboard=app'},redirect:'manual'})).headers.get('location')).toBe('/hiring');
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
    expect((await signIn('pat@acme.test')).body.redirect).toBe('/hiring');
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
    // No saving: an employer not on CareJoys gets nothing, so nothing is recorded or emailed and the caregiver
    // is pointed to its own site.
    const open=await post('/api/me/apply/job-open',{},{cookie});
    expect(await open.json()).toMatchObject({status:'not_sent',employerOnCareJoys:false,applicationUrl:'https://org-open.test/apply'});
    expect(sent).toEqual([]);
    expect(await DB.prepare("SELECT COUNT(*) AS n FROM caregiver_job_apply_events WHERE caregiver_id='dc' AND caregiver_job_id='job-open'").first()).toEqual({n:0});
    const me=await (await call('/api/me',{headers:{cookie}})).json() as any;
    expect(me.applications.map((a:any)=>[a.jobId,a.appliedOnCareJoys,a.employerOnCareJoys])).toEqual([['job-claimed',true,true]]);
  });

  it('counts each step on the apply page, and only the known ones', async()=>{
    const step=(body:object)=>post('/api/public/caregiver-jobs/job-open/apply',body);
    for(const body of [{step:'apply_page_opened'},{step:'apply_signed_in'},{step:'carejoys_applied'},{}])expect((await step(body)).status).toBe(200);
    const rows=(await DB.prepare("SELECT event_type,COUNT(*) AS n FROM caregiver_job_apply_events WHERE caregiver_job_id='job-open' GROUP BY event_type ORDER BY event_type").all()).results;
    // An unknown step is never stored as itself: it counts as the employer-site click it always was.
    expect(rows).toEqual([{event_type:'apply_page_opened',n:1},{event_type:'apply_signed_in',n:1},{event_type:'external_redirect_clicked',n:2}]);
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

  it('auto-apply sends up to 3 a day to employers on CareJoys, once per job, only when switched on', async()=>{
    await DB.prepare("INSERT OR REPLACE INTO agency_organizations(id,organization_key,canonical_name,primary_domain,city,state,zip,is_active,claimed_employer_id) VALUES ('org-auto','org-auto','Auto Care','auto.test','Baltimore','MD','21201',1,'emp1')").run();
    await DB.prepare("INSERT OR REPLACE INTO employer_leads(id,company_name,contact_name,email,zip,roles_needed,status) VALUES ('emp-hidden','Hidden Care','Hal','hal@hidden.test','21201','CNA','active')").run();
    await DB.prepare("INSERT OR REPLACE INTO agency_organizations(id,organization_key,canonical_name,primary_domain,city,state,zip,is_active,claimed_employer_id) VALUES ('org-hidden','org-hidden','Hidden Care','hidden.test','Baltimore','MD','21201',1,'emp-hidden')").run();
    for(const [id,org] of [['auto-1','org-auto'],['auto-2','org-auto'],['auto-3','org-auto'],['auto-4','org-auto'],['auto-5','org-auto'],['auto-hidden','org-hidden']]){
      await DB.prepare("INSERT OR REPLACE INTO caregiver_jobs(id,agency_organization_id,dedupe_key,source_provider,source_url,title,role,employer_name,city,state,zip,status,is_published) VALUES (?,?,?,'test',?,'CNA Days','CNA','Auto Care','Baltimore','MD','21201','current',1)")
        .bind(id,org,id,'https://'+org+'.test/apply/'+id).run();
    }
    await addCaregiver('auto','21201',{auto_apply:1});
    await addCaregiver('auto-test','21201',{auto_apply:1,is_test:1});
    await addCaregiver('auto-off','21201');
    for(const id of ['auto','auto-test','auto-off'])await DB.prepare("INSERT INTO caregiver_resume_files(caregiver_id,file_name,content_type,byte_size,file_blob) VALUES (?,'r.pdf','application/pdf',4,?)").bind(id,new Uint8Array([37,80,68,70])).run();
    await DB.prepare("INSERT INTO caregiver_hidden_employers(caregiver_id,employer_id) VALUES ('auto','emp-hidden')").run();
    // Already applied to this one by hand: never sent again.
    await DB.prepare("INSERT INTO caregiver_job_apply_events(id,caregiver_job_id,caregiver_id,event_type,source) VALUES ('ev-hand','auto-1','auto','carejoys_applied','carejoys_profile')").run();
    const autoJobs=async(id:string)=>((await DB.prepare("SELECT caregiver_job_id AS job FROM caregiver_job_apply_events WHERE caregiver_id=? AND event_type='auto_applied'").bind(id).all()).results||[]).map((r:any)=>r.job).sort();
    // Off site-wide: nothing happens.
    expect(await runAutoApply(env())).toEqual({caregivers:0,applied:0});
    expect(await autoJobs('auto')).toEqual([]);
    const on=env({AUTO_APPLY_ENABLED:'true'});
    const first=await runAutoApply(on);
    expect(first.applied).toBe(3);
    const done=await autoJobs('auto');
    expect(done).toHaveLength(3);
    expect(done).not.toContain('auto-1');
    expect(done).not.toContain('auto-hidden');
    // Each one is a real application the caregiver sees on the dashboard.
    for(const job of done)expect(await DB.prepare("SELECT 1 AS hit FROM caregiver_job_apply_events WHERE caregiver_id='auto' AND caregiver_job_id=? AND event_type='carejoys_applied'").bind(job).first()).toBeTruthy();
    // Test accounts and caregivers who didn't switch it on are left alone, and the daily cap holds.
    expect(await autoJobs('auto-test')).toEqual([]);
    expect(await autoJobs('auto-off')).toEqual([]);
    await runAutoApply(on);
    expect(await autoJobs('auto')).toEqual(done);
    await DB.prepare("UPDATE caregiver_jobs SET is_published=0 WHERE id LIKE 'auto-%'").run();
  });

  it('caregivers switch auto-apply on and off from Settings', async()=>{
    const {cookie}=await signIn('dc@example.com');
    expect((await post('/api/me/auto-apply',{enabled:true})).status).toBe(401);
    expect(await (await post('/api/me/auto-apply',{enabled:true},{cookie})).json()).toMatchObject({ok:true,autoApply:true});
    expect(((await (await call('/api/me',{headers:{cookie}})).json()) as any).caregiver.autoApply).toBe(true);
    await post('/api/me/auto-apply',{enabled:false},{cookie});
    expect(((await (await call('/api/me',{headers:{cookie}})).json()) as any).caregiver.autoApply).toBe(false);
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
    expect(mine[0].subject).toBe('Brightway Care: answer every caregiver applicant in 30 minutes');
    expect(mine[0].html).toContain('We already list one of your openings on CareJoys, so caregivers near Towson can apply there too.');
    expect(mine[0].html).toContain('Set up my hiring');
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

  it('re-sends the new copy to agencies that only saw the old invite, openers first, once', async()=>{
    const org=(id:string,email:string)=>DB.prepare("INSERT INTO agency_organizations(id,organization_key,canonical_name,primary_email,city,state,is_active) VALUES (?,?,?,?,'Towson','MD',1)").bind(id,id,id,email).run();
    await org('org-old-open','open@oldcopy.test');await org('org-old-cold','cold@oldcopy.test');await org('org-old-claimed','claimed@oldcopy.test');
    await DB.prepare("INSERT INTO employer_leads(id,company_name,contact_name,email,zip,roles_needed,status) VALUES ('emp-oldcopy','Old Copy Care','Jo','claimed@oldcopy.test','21204','CNA','active')").run();
    await DB.prepare("UPDATE agency_organizations SET claimed_employer_id='emp-oldcopy' WHERE id='org-old-claimed'").run();
    for(const id of ['org-old-open','org-old-cold','org-old-claimed'])
      await DB.prepare("INSERT INTO agency_outreach_events(id,organization_id,event_type,recipient_email,created_at) VALUES (?,?,'hiring_needs_invite',?,'2026-10-12 15:00:00')").bind('ev-'+id,id,id+'@x').run();
    await DB.prepare("INSERT INTO agency_teaser_tokens(id,organization_id,token_hash,recipient_email,expires_at,sent_at,opened_at) VALUES ('tt-old-open','org-old-open','h-old-open','open@oldcopy.test',?,'2026-10-12 15:00:00','2026-10-13 09:00:00')").bind(new Date(Date.now()+86400000).toISOString()).run();
    // Brightway got its invite today, with the new copy, so it is never re-sent.
    sent.length=0;
    expect(await sendAgencyHiringReinvites(env(),50,'')).toEqual({attempted:0,sent:0,failed:0});
    expect(sent).toHaveLength(0);
    await sendAgencyHiringReinvites(env(),50,'openers');
    expect(sent.map(m=>m.to)).toEqual(['open@oldcopy.test']);
    expect(sent[0].subject).toBe('org-old-open: answer every caregiver applicant in 30 minutes');
    sent.length=0;
    await sendAgencyHiringReinvites(env(),50,'all');
    expect(sent.map(m=>m.to)).toEqual(['cold@oldcopy.test']);
    sent.length=0;
    await sendAgencyHiringReinvites(env(),50,'all');
    expect(sent).toHaveLength(0);
    // Re-sent agencies are still excluded from the first-time batch.
    await sendAgencyHiringInvites(env(),50);
    expect(sent.map(m=>m.to).filter(t=>t.endsWith('@oldcopy.test'))).toEqual([]);
  });

  it('an inbox scanner loading the link right after sending is not an open; a later visit is', async()=>{
    await DB.prepare("INSERT INTO agency_organizations(id,organization_key,canonical_name,primary_email,city,state,is_active) VALUES ('org-scan','org-scan','Scan Care','owner@scan.test','Towson','MD',1)").run();
    const add=async(id:string,token:string,sentAt:string)=>DB.prepare("INSERT INTO agency_teaser_tokens(id,organization_id,token_hash,recipient_email,expires_at,sent_at) VALUES (?,?,?,'owner@scan.test',?,?)")
      .bind(id,'org-scan',await sha256Hex(token),new Date(Date.now()+86400000).toISOString(),sentAt).run();
    await add('tt-scan-now','scan-now',new Date().toISOString().replace('T',' ').slice(0,19));
    await add('tt-scan-later','scan-later','2026-10-12 15:00:00');
    expect((await call('/api/agency/teaser?token=scan-now')).status).toBe(200);
    expect((await call('/api/agency/teaser?token=scan-later')).status).toBe(200);
    const opened=Object.fromEntries(((await DB.prepare("SELECT id,opened_at FROM agency_teaser_tokens WHERE organization_id='org-scan'").all()).results as any[]).map(r=>[r.id,!!r.opened_at]));
    expect(opened).toEqual({'tt-scan-now':false,'tt-scan-later':true});
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

describe('reply-yes outreach from rebecca@', ()=>{
  it('waits for rebecca@ routing, then emails real agencies once each in plain text, most jobs first', async()=>{
    const org=(id:string,name:string,email:string,extra:Record<string,unknown>={})=>{
      const row={id,organization_key:id,canonical_name:name,primary_email:email,city:'Towson',state:'MD',is_active:1,...extra};
      const keys=Object.keys(row);
      return DB.prepare(`INSERT INTO agency_organizations(${keys.join(',')}) VALUES (${keys.map(()=>'?').join(',')})`).bind(...Object.values(row)).run();
    };
    await org('org-ry-jobs','SUNNY DAYS HOME CARE, LLC','owner@sunnydays.test',{primary_contact_name:'Maria Lopez',sources:'google_business',provider_types:'Google listing: Home health care service'});
    await DB.prepare("INSERT INTO caregiver_jobs(id,agency_organization_id,dedupe_key,source_provider,source_url,title,role,employer_name,city,state,status,is_published) VALUES ('job-ry','org-ry-jobs','job-ry','test','https://sunnydays.test/jobs/1','HHA','HHA','Sunny Days','Towson','MD','current',1)").run();
    await org('org-ry-license','Kind Hands Care','info@kindhands.test',{sources:'maryland_license'});
    await org('org-ry-same-email','Kind Hands Care East','info@kindhands.test',{sources:'maryland_license'});
    await org('org-ry-roofer','Perma-Tech Roofing Supply','info@roofer.test',{sources:'google_business',provider_types:'Google listing: Home health care service'});
    await org('org-ry-recent','Recent Care','office@recent.test',{sources:'maryland_license'});
    await DB.prepare("INSERT INTO agency_outreach_events(id,organization_id,event_type,recipient_email) VALUES ('ev-ry-recent','org-ry-recent','hiring_needs_invite','office@recent.test')").run();
    sent.length=0;
    expect(await sendReplyYesBatch(env(),50)).toMatchObject({sent:0,waitingForRouting:true});
    expect(sent).toHaveLength(0);
    // A reply to rebecca@ reaching the Worker proves the routing rule exists.
    await DB.prepare("INSERT INTO email_messages(id,direction,mailbox,from_email,subject,kind,status) VALUES ('em-ry-proof','inbound','rebecca@carejoys.com','rebecca@gmail.test','Re: [Test] Quick question','reply','new')").run();
    await sendReplyYesBatch(env(),50);
    const to=sent.map(m=>m.to);
    expect(to[0]).toBe('owner@sunnydays.test');
    expect(to.filter(t=>t==='info@kindhands.test')).toHaveLength(1);
    expect(to).not.toContain('info@roofer.test');
    expect(to).not.toContain('office@recent.test');
    const first=sent[0] as any;
    expect(first.from).toBe('Rebecca Myers <rebecca@carejoys.com>');
    expect(first.replyTo).toBe('rebecca@carejoys.com');
    expect(first.html).toBeUndefined();
    expect(first.text).toContain('Hi Maria,');
    // The note opens with the agency's own jobs on CareJoys (Rebecca's pick 2026-10-25).
    expect(first.text).toMatch(/CareJoys lists (an open caregiver job at Sunny Days Home Care|\d+ of Sunny Days Home Care's open caregiver jobs)/);
    expect(first.text).toContain('Reply "yes"');
    expect(first.headers?.['List-Unsubscribe']).toBeTruthy();
    expect(first.subject).toMatch(/^Your (\d+ )?caregiver jobs? on CareJoys$/);
    sent.length=0;
    await sendReplyYesBatch(env(),50);
    expect(sent.map(m=>m.to).filter(t=>t==='owner@sunnydays.test'||t==='info@kindhands.test')).toHaveLength(0);
  });
});

describe('Rebecca\'s mail from the admin console', ()=>{
  const admin=(path:string,body?:unknown)=>call(path,body===undefined?{headers:{authorization:'Bearer t0ken'}}:{method:'POST',headers:{authorization:'Bearer t0ken','content-type':'application/json',origin:'https://carejoys.com'},body:JSON.stringify(body)},{ADMIN_TOKEN:'t0ken',INBOUND_FORWARD_TO:'rebecca@gmail.test'});
  // The replies-to-hello@ tests below count every recorded message, so these leave none behind.
  afterAll(async()=>{await DB.prepare("DELETE FROM email_messages WHERE direction='outbound' OR id IN ('em-hello-q','em-ry-proof','em-conv-1','em-conv-ooo')").run()});
  it('saves a draft, then sends it from rebecca@ with a copy to the owner inbox', async()=>{
    const saved=await (await admin('/api/admin/mail/drafts',{to:'Owner@Tuparan.test',subject:'Checking in',text:'Hi, quick note.'})).json() as any;
    expect(saved.ok).toBe(true);
    let mail=await (await admin('/api/admin/mail')).json() as any;
    expect(mail.drafts.map((d:any)=>d.to)).toContain('owner@tuparan.test');
    sent.length=0;
    const res=await admin('/api/admin/mail/send',{to:'owner@tuparan.test',subject:'Checking in',text:'Hi, quick note, edited.',draftId:saved.id});
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({from:'Rebecca Myers <rebecca@carejoys.com>',to:'owner@tuparan.test',bcc:'rebecca@gmail.test',text:'Hi, quick note, edited.'});
    mail=await (await admin('/api/admin/mail')).json() as any;
    expect(mail.drafts.map((d:any)=>d.id)).not.toContain(saved.id);
    expect(mail.sent.find((d:any)=>d.id===saved.id)?.text).toBe('Hi, quick note, edited.');
  });
  it('answers a recorded reply in the same thread, from the address it was sent to', async()=>{
    await DB.prepare("INSERT INTO email_messages(id,direction,mailbox,from_email,subject,snippet,message_id,kind,status) VALUES ('em-hello-q','inbound','hello@carejoys.com','gina@families.test','Question','How much is it?','<abc123@mail.test>','reply','new')").run();
    sent.length=0;
    expect((await admin('/api/admin/mail/send',{to:'gina@families.test',subject:'Re: Question',text:'Free for the first month.',inReplyToId:'em-hello-q'})).status).toBe(200);
    expect(sent[0]).toMatchObject({from:'Rebecca at CareJoys <hello@carejoys.com>',replyTo:'hello@carejoys.com',headers:{'In-Reply-To':'<abc123@mail.test>',References:'<abc123@mail.test>'}});
    expect((await DB.prepare("SELECT status FROM email_messages WHERE id='em-hello-q'").first() as any).status).toBe('handled');
    expect((await admin('/api/admin/mail/send',{to:'not-an-email',subject:'x',text:'y'})).status).toBe(400);
  });
  it('groups mail into one conversation per person, with the outreach note that started it', async()=>{
    await DB.prepare("INSERT INTO agency_organizations(id,organization_key,canonical_name,primary_email,primary_contact_name,city,state,is_active) VALUES ('org-conv','org-conv','Bright Path Care, LLC','owner@brightpath.test','Lee Park','Towson','MD',1)").run();
    await DB.prepare("INSERT INTO agency_outreach_events(id,organization_id,event_type,recipient_email,payload,created_at) VALUES ('ev-conv','org-conv','reply_yes_invite','owner@brightpath.test','{\"variant\":\"a\"}','2026-10-20 10:00:00')").run();
    await DB.prepare("INSERT INTO email_messages(id,direction,mailbox,from_email,from_name,subject,snippet,kind,status,created_at) VALUES ('em-conv-1','inbound','rebecca@carejoys.com','Owner@BrightPath.test','Lee Park','Re: Quick question about Bright Path Care','yes','reply','new','2026-10-21 09:00:00')").run();
    await DB.prepare("INSERT INTO email_messages(id,direction,mailbox,from_email,subject,snippet,kind,status) VALUES ('em-conv-ooo','inbound','rebecca@carejoys.com','away@elsewhere.test','Out of office','Back Monday','auto_reply','handled')").run();
    let inbox=await (await admin('/api/admin/conversations')).json() as any;
    let convo=inbox.conversations.find((c:any)=>c.email==='owner@brightpath.test');
    expect(convo.needsReply).toBe(true);
    expect(convo.messages.map((m:any)=>[m.direction,!!m.outreach])).toEqual([['outbound',true],['inbound',false]]);
    expect(convo.messages[0].text).toContain('Hi Lee,');
    expect(convo.messages[0].subject).toBe('Quick question about Bright Path Care');
    expect(inbox.conversations.find((c:any)=>c.email==='away@elsewhere.test')).toBeUndefined();
    expect(inbox.automatic.map((m:any)=>m.id)).toContain('em-conv-ooo');
    // Answering puts Rebecca's reply in the same conversation, without the quoted original, and clears Needs reply.
    expect((await admin('/api/admin/mail/send',{to:'owner@brightpath.test',subject:'Re: Quick question about Bright Path Care',text:'Great, setting it up.\n\nOn Lee Park wrote:\n> yes',inReplyToId:'em-conv-1'})).status).toBe(200);
    inbox=await (await admin('/api/admin/conversations')).json() as any;
    convo=inbox.conversations.find((c:any)=>c.email==='owner@brightpath.test');
    expect(convo.needsReply).toBe(false);
    expect(convo.replied).toBe(true);
    expect(convo.messages[2]).toMatchObject({direction:'outbound',text:'Great, setting it up.'});
    // Marking it as needing a reply and then Done round-trips.
    await admin('/api/admin/conversations/status',{email:'owner@brightpath.test',status:'new'});
    expect((await (await admin('/api/admin/conversations')).json() as any).conversations.find((c:any)=>c.email==='owner@brightpath.test').needsReply).toBe(true);
    await admin('/api/admin/conversations/status',{email:'owner@brightpath.test',status:'handled'});
    expect((await (await admin('/api/admin/conversations')).json() as any).conversations.find((c:any)=>c.email==='owner@brightpath.test').needsReply).toBe(false);
  });
});

describe('facility outreach pilot', ()=>{
  it('emails only facilities marked for the pilot, once each, with a claim link', async()=>{
    await DB.prepare("INSERT INTO agency_organizations(id,organization_key,canonical_name,primary_email,primary_contact_name,city,state,is_active,provider_kind,outreach_pilot) VALUES ('org-pilot','org-pilot','Maple House Assisted Living, LLC','director@maplehouse.test','Ana Ruiz','Fresno','CA',1,'facility','facility_2026_10')").run();
    await DB.prepare("INSERT INTO agency_organizations(id,organization_key,canonical_name,primary_email,city,state,is_active,provider_kind) VALUES ('org-unpicked','org-unpicked','Cedar Assisted Living','office@cedar.test','Fresno','CA',1,'facility')").run();
    sent.length=0;
    const result=await sendFacilityPilotInvites(env(),50,'hello@carejoys.com');
    expect(result.sent).toBe(1);
    const mine=sent.filter(m=>m.to==='director@maplehouse.test');
    expect(mine).toHaveLength(1);
    expect(mine[0].subject).toBe('Caregivers and CNAs near Fresno for Maple House Assisted Living');
    expect(mine[0].html).toContain('Hi Ana,');
    // No openings listed yet, so the email doesn't claim any.
    expect(mine[0].html).not.toContain('We already show');
    expect(mine[0].html).toMatch(/agency\?token=/);
    expect(mine[0].headers?.['List-Unsubscribe']).toBeTruthy();
    expect(sent.map(m=>m.to)).not.toContain('office@cedar.test');
    expect(sent.filter(m=>m.to==='hello@carejoys.com')).toHaveLength(1);
    sent.length=0;
    await sendFacilityPilotInvites(env(),50);
    expect(sent).toHaveLength(0);
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
    await report({kind:'react',message:'Unable to preload CSS for /assets/x.css',source:'https://carejoys.com/assets/index-AbC12345.js:1:1',path:'/jobs/job-3'},'Lightpanda/1.0');
    // The same scraper with a borrowed Chrome user agent.
    await report({kind:'api',message:'GET /api/account returned 607',path:'/jobs/job-3'},'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36');
    await report({kind:'api',message:'GET /api/config did not reach CareJoys (fetch error)',path:'/jobs/job-3'});
    // A scraper passing as a two-year-old Chrome.
    await report({kind:'api',message:'GET /api/public/caregiver-jobs/:id did not reach CareJoys (Failed to fetch)',path:'/jobs/job-3'},'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
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
    await report({kind:'react',message:'Minified React error #31',source:'https://carejoys.com/assets/index-AbC12345.js:2:10',path:'/hiring'});
    expect(await alertNewClientErrors(env({ALERT_EMAILS:'alerts@carejoys.test'}))).toMatchObject({sent:false,count:1});
    expect(sent).toHaveLength(1);
    // With no ALERT_EMAILS or ADMIN_EMAILS the owner accounts get it.
    await DB.prepare("UPDATE monitor_alerts SET created_at=datetime('now','-31 minutes')").run();
    expect(await alertNewClientErrors(env())).toMatchObject({sent:true,count:1});
    expect(sent[1].to).toContain('myersrebeccal@gmail.com');
  });
  it('emails a request that never reached CareJoys only once it happens again', async()=>{
    await DB.prepare("UPDATE monitor_alerts SET created_at=datetime('now','-31 minutes')").run();
    sent.length=0;
    await report({kind:'api',message:'GET /api/config did not reach CareJoys (Load failed)',path:'/'});
    expect(await alertNewClientErrors(env({ALERT_EMAILS:'alerts@carejoys.test'}))).toMatchObject({sent:false,count:0});
    await report({kind:'api',message:'GET /api/config did not reach CareJoys (Load failed)',path:'/jobs'});
    expect(await alertNewClientErrors(env({ALERT_EMAILS:'alerts@carejoys.test'}))).toMatchObject({sent:true,count:1});
    expect((sent[0] as any).text).toContain('GET /api/config did not reach CareJoys (Load failed) (2 times');
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
    // Each test invites the same two caregivers again: move earlier invitations out of this week's caps.
    await DB.prepare("UPDATE candidate_pipeline SET contacted_at=datetime(contacted_at,'-8 days'),response_expires_at=datetime('now','-1 minute') WHERE caregiver_id IN ('fu-near','fu-towson') AND contacted_at IS NOT NULL").run();
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
    expect(nudge?.html).toContain('/hiring?candidate=');
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

describe('agency buyer: claim, settings and pricing', ()=>{
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
    const res=await post('/api/agency/claim/request',{token:'claim-token-1',needs:{roles:['CNA','HHA'],shifts:['Nights','Weekends'],count:'3–5',sources:['Indeed']}},{origin:'https://carejoys.com'});
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ok:true,redirect:'/hiring'});
    // What they ticked on the page is their hiring profile and Always-on opening.
    expect(await DB.prepare("SELECT hiring_status,roles,shifts,requirements,roles_source FROM agency_org_hiring_profiles WHERE organization_id='org-claim1'").first())
      .toEqual({hiring_status:'hiring',roles:'CNA, HHA',shifts:'Nights, Weekends',requirements:'Needs this month: 3–5. Applicants come from: Indeed.',roles_source:'employer_confirmed'});
    expect(await DB.prepare("SELECT title,role,status FROM openings WHERE agency_organization_id='org-claim1' AND source='agency_profile'").first()).toEqual({title:'CNA / HHA hiring',role:'CNA',status:'open'});
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
    const respondToken=decodeURIComponent(invite.html!.match(/respond\?token=([^"&\s]+)/)![1]);
    expect((await (await call('/api/respond?token='+encodeURIComponent(respondToken))).json() as any).opportunity.about).toBe('Family owned in Towson since 2009.');
    sent.length=0;
    await post('/api/respond',{token:respondToken,choice:'interested'},{origin:'https://carejoys.com'});
    expect(sent.find(m=>m.subject.startsWith('Interested candidate:'))?.to).toBe('owner@buy.test');
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

  it('sends one morning digest, and none when it is turned off', async()=>{
    sent.length=0;
    await sendDailyDigests(env(),1000);
    const digest=sent.find(m=>m.to==='owner@buy.test');
    expect(digest?.html).toContain('buy-app Test');
    expect(digest?.html).toContain('/hiring?tab=settings');
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
});

describe('sms', ()=>{
  const TWILIO={TWILIO_ACCOUNT_SID:'ACtest',TWILIO_AUTH_TOKEN:'twilio-token',TWILIO_MESSAGING_SERVICE_SID:'MGtest'};
  const ON={...TWILIO,SMS_ENABLED:'true'};
  const PHONE='+14105550199';
  // Midday Eastern today, inside the 8am-9pm texting window whenever the tests run.
  const NOON=new Date(new Date().toISOString().slice(0,10)+'T16:00:00Z');
  const twilioCalls:Array<{url:string;body:URLSearchParams}>=[];
  let nextSid=0;
  const realFetch=globalThis.fetch;
  // No real texts: every Twilio API call in this block lands here.
  beforeAll(()=>{
    globalThis.fetch=(async(input:RequestInfo|URL,init?:RequestInit)=>{
      const url=String(input);
      if(!url.startsWith('https://api.twilio.com/'))return realFetch(input,init);
      const body=new URLSearchParams(String(init?.body));
      twilioCalls.push({url,body});
      if(body.get('To')==='+14105550111')return Response.json({code:21610,message:'Attempt to send to unsubscribed recipient'},{status:400});
      return Response.json({sid:'SM'+(++nextSid),status:'queued'},{status:201});
    }) as typeof fetch;
  });
  afterAll(()=>{globalThis.fetch=realFetch});
  const webhook=async(path:string,fields:Record<string,string>,{sign=true,extra=TWILIO as Record<string,unknown>}={})=>{
    const url='https://carejoys.com'+path;
    const params=new URLSearchParams({AccountSid:'ACtest',...fields});
    const signature=sign?await twilioSignature('twilio-token',url,params):'bad';
    return call(path,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded','x-twilio-signature':signature},body:params.toString()},extra);
  };
  const bySid=(sid:string)=>DB.prepare('SELECT * FROM sms_messages WHERE twilio_sid=?').bind(sid).first();
  const consent=(phone:string)=>DB.prepare("SELECT status FROM sms_consents WHERE brand='carejoys' AND phone=?").bind(phone).first();

  it('stays dormant without credentials and texts only numbers with a logged opt-in', async()=>{
    expect((await call('/api/sms/inbound',{method:'POST',body:''})).status).toBe(503);
    expect((await call('/api/sms/status',{method:'POST',body:''})).status).toBe(503);
    expect(await sendCareJoysSms(env(),{to:PHONE,body:'hi'})).toEqual({ok:false,reason:'not_configured'});
    expect(await sendCareJoysSms(env(TWILIO),{to:PHONE,body:'hi'})).toEqual({ok:false,reason:'disabled'});
    expect(await sendCareJoysSms(env(ON),{to:'555',body:'hi'})).toEqual({ok:false,reason:'invalid_phone'});
    expect(await sendCareJoysSms(env(ON),{to:PHONE,body:'hi'})).toEqual({ok:false,reason:'no_consent'});
    expect(twilioCalls).toHaveLength(0);
    await recordSmsConsent(env(),{brand:'carejoys',phone:'(410) 555-0199',event:'opt_in',source:'application',consentText:'Text me about this job'});
    expect(await DB.prepare("SELECT event,source,consent_text FROM sms_consent_events WHERE phone=?").bind(PHONE).first()).toEqual({event:'opt_in',source:'application',consent_text:'Text me about this job'});
  });

  it('sends through the Messaging Service with a status callback and logs the message', async()=>{
    const result=await sendCareJoysSms(env(ON),{to:PHONE,body:'Still interested in the CNA job? Reply YES',template:'screen_v1',relatedType:'candidate_pipeline',relatedId:'cp1',now:NOON});
    expect(result).toMatchObject({ok:true,sid:'SM1',status:'queued'});
    expect(twilioCalls[0].url).toBe('https://api.twilio.com/2010-04-01/Accounts/ACtest/Messages.json');
    expect(Object.fromEntries(twilioCalls[0].body)).toMatchObject({To:PHONE,MessagingServiceSid:'MGtest',StatusCallback:'https://carejoys.com/api/sms/status'});
    expect(await bySid('SM1')).toMatchObject({direction:'outbound',status:'queued',template:'screen_v1',related_type:'candidate_pipeline',related_id:'cp1'});
  });

  it('rejects unsigned webhooks and records delivery without moving backwards', async()=>{
    expect((await webhook('/api/sms/status',{MessageSid:'SM1',MessageStatus:'delivered'},{sign:false})).status).toBe(403);
    expect((await bySid('SM1')).status).toBe('queued');
    expect((await webhook('/api/sms/status',{MessageSid:'SM1',MessageStatus:'delivered'})).status).toBe(204);
    expect((await webhook('/api/sms/status',{MessageSid:'SM1',MessageStatus:'sent'})).status).toBe(204);
    const row=await bySid('SM1');
    expect(row.status).toBe('delivered');
    expect(row.delivered_at).toBeTruthy();
  });

  it('keeps "not delivered" apart from "no reply", with the carrier reason', async()=>{
    await recordSmsConsent(env(),{brand:'carejoys',phone:'+14105550122',event:'opt_in',source:'application'});
    const r=await sendCareJoysSms(env(ON),{to:'+14105550122',body:'Hi',template:'screen_v1',now:NOON}) as any;
    await webhook('/api/sms/status',{MessageSid:r.sid,MessageStatus:'undelivered',ErrorCode:'30007'});
    expect(await bySid(r.sid)).toMatchObject({status:'undelivered',error_code:'30007'});
    expect((await bySid(r.sid)).error_message).toMatch(/Filtered by the carrier/);
  });

  it('links a reply to the text it answers and passes it on as a yes', async()=>{
    const res=await webhook('/api/sms/inbound',{MessageSid:'SMin1',From:PHONE,To:'+18885550100',Body:'Yes!'});
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/xml/);
    expect(await res.text()).toContain('no open job invitations');
    const reply=await bySid('SMin1');
    expect(reply).toMatchObject({direction:'inbound',intent:'yes',related_type:'candidate_pipeline',related_id:'cp1',template:'screen_v1'});
    expect(reply.in_reply_to).toBe((await bySid('SM1')).id);
    // Twilio retries are ignored.
    await webhook('/api/sms/inbound',{MessageSid:'SMin1',From:PHONE,To:'+18885550100',Body:'Yes!'});
    expect((await DB.prepare("SELECT COUNT(*) AS n FROM sms_messages WHERE twilio_sid='SMin1'").first()).n).toBe(1);
  });

  it('STOP opts the number out, clears the profile flag and blocks later sends; START opts back in', async()=>{
    await addCaregiver('texter','21201',{phone:'(410) 555-0199',sms_consent:1});
    await webhook('/api/sms/inbound',{MessageSid:'SMin2',From:PHONE,Body:'STOP',OptOutType:'STOP'});
    expect(await consent(PHONE)).toEqual({status:'opted_out'});
    expect((await DB.prepare("SELECT sms_consent FROM caregivers WHERE id='texter'").first()).sms_consent).toBe(0);
    const calls=twilioCalls.length;
    expect(await sendCareJoysSms(env(ON),{to:PHONE,body:'hi'})).toEqual({ok:false,reason:'opted_out'});
    expect(twilioCalls).toHaveLength(calls);
    await webhook('/api/sms/inbound',{MessageSid:'SMin3',From:PHONE,Body:'START'});
    expect(await consent(PHONE)).toEqual({status:'opted_in'});
    const events=(await DB.prepare("SELECT event FROM sms_consent_events WHERE phone=? ORDER BY created_at,rowid").bind(PHONE).all()).results.map((e:any)=>e.event);
    expect(events).toEqual(['opt_in','opt_out','opt_in']);
  });

  it('records Twilio’s own opt-out refusal (21610) as an opt-out', async()=>{
    await recordSmsConsent(env(),{brand:'carejoys',phone:'+14105550111',event:'opt_in',source:'application'});
    expect(await sendCareJoysSms(env(ON),{to:'+14105550111',body:'hi',now:NOON})).toMatchObject({ok:false,reason:'opted_out'});
    expect(await consent('+14105550111')).toEqual({status:'opted_out'});
  });

  it('admin can see delivery and reply counts and send a test text', async()=>{
    const admin={authorization:'Bearer t0ken'};
    expect((await call('/api/admin/sms')).status).toBe(401);
    const report=await (await call('/api/admin/sms',{headers:admin},{...ON,ADMIN_TOKEN:'t0ken'})).json() as any;
    expect(report).toMatchObject({ok:true,configured:true,sendingEnabled:true});
    expect(report.totals.find((t:any)=>t.template==='screen_v1')).toMatchObject({sent:2,delivered:1,not_delivered:1,replied:1});
    const test=await call('/api/admin/sms/test',{method:'POST',headers:admin,body:JSON.stringify({to:'410-555-0177'})},{...ON,ADMIN_TOKEN:'t0ken'});
    expect(test.status).toBe(200);
    expect(await consent('+14105550177')).toEqual({status:'opted_in'});
    expect((await call('/api/admin/sms/test',{method:'POST',headers:admin,body:JSON.stringify({to:'410-555-0177'})},{...TWILIO,ADMIN_TOKEN:'t0ken'})).status).toBe(503);
    // A number that texted STOP is not opted back in by an admin test.
    expect((await call('/api/admin/sms/test',{method:'POST',headers:admin,body:JSON.stringify({to:'+14105550111'})},{...ON,ADMIN_TOKEN:'t0ken'})).status).toBe(409);
    expect(await consent('+14105550111')).toEqual({status:'opted_out'});
  });

  // ---------- Consent capture and the CareJoys flows (all no-ops until SMS_ENABLED) ----------

  const consentEvents=(phone:string)=>DB.prepare("SELECT event,source,consent_text,ip,user_agent FROM sms_consent_events WHERE phone=? ORDER BY created_at,rowid").bind(phone).all().then((r:any)=>r.results);
  const smsTo=(phone:string)=>DB.prepare("SELECT * FROM sms_messages WHERE phone=? AND direction='outbound' ORDER BY rowid").bind(phone).all().then((r:any)=>r.results);
  const nyHour=(iso:string)=>Number(new Date(iso).toLocaleString('en-US',{timeZone:'America/New_York',hour:'numeric',hourCycle:'h23'}));

  it('records a caregiver’s opt-in with the exact wording, IP and browser, and unticking on the profile revokes it', async()=>{
    const headers={'user-agent':'vitest-browser','cf-connecting-ip':'203.0.113.9'};
    const base={lastName:'Text',zip:'21204',role:'CNA'};
    expect((await post('/api/caregiver-resume',{...base,firstName:'Optin',email:'sms-optin@example.test',phone:'410-555-0144',smsConsent:true},headers)).ok).toBe(true);
    expect((await post('/api/caregiver-resume',{...base,firstName:'Nobox',email:'sms-nobox@example.test',phone:'410-555-0145'},headers)).ok).toBe(true);
    const flag=(email:string)=>DB.prepare('SELECT sms_consent FROM caregivers WHERE email=?').bind(email).first().then((r:any)=>r.sms_consent);
    expect(await flag('sms-optin@example.test')).toBe(1);
    expect(await flag('sms-nobox@example.test')).toBe(0);
    expect(await consentEvents('+14105550145')).toEqual([]);
    expect(await consentEvents('+14105550144')).toEqual([{event:'opt_in',source:'caregiver_signup',consent_text:SMS_CONSENT_TEXT,ip:'203.0.113.9',user_agent:'vitest-browser'}]);
    expect(SMS_CONSENT_TEXT).toBe("Text me job invitations and interview reminders from CareJoys. Msg & data rates may apply. Up to 4 msgs/week. Reply STOP to opt out, HELP for help. Consent isn't required to use CareJoys.");

    // The profile shows the choice and unticking it revokes; ticking again opts back in.
    await DB.prepare('INSERT INTO account_sessions(id,email,session_hash,expires_at) VALUES (?,?,?,?)').bind('sms-acct','sms-optin@example.test',await sha256Hex('sms-account'),new Date(Date.now()+86400000).toISOString()).run();
    const me={cookie:'__Host-cj_account=sms-account'};
    const profile=async()=>((await (await call('/api/me',{headers:me})).json()) as any).caregiver;
    expect((await profile()).smsConsent).toBe(true);
    const save=(smsConsent:boolean)=>post('/api/me/profile',{firstName:'Optin',lastName:'Text',zip:'21204',phone:'410-555-0144',smsConsent},{...me,...headers});
    expect((await save(true)).ok).toBe(true);
    expect(await consentEvents('+14105550144')).toHaveLength(1);
    expect((await save(false)).ok).toBe(true);
    expect(await flag('sms-optin@example.test')).toBe(0);
    expect(await consent('+14105550144')).toEqual({status:'opted_out'});
    expect((await profile()).smsConsent).toBe(false);
    expect((await consentEvents('+14105550144')).map((e:any)=>[e.event,e.source])).toEqual([['opt_in','caregiver_signup'],['opt_out','caregiver_profile']]);
    await save(true);
    expect(await consent('+14105550144')).toEqual({status:'opted_in'});
    expect((await profile()).smsConsent).toBe(true);
  });

  it('holds a text that lands outside 8am-9pm local time and sends it from the cron when the window opens', async()=>{
    const P='+14105550155';
    await recordSmsConsent(env(),{brand:'carejoys',phone:P,event:'opt_in',source:'test'});
    const day=new Date().toISOString().slice(0,10);
    const calls=twilioCalls.length;
    // 9am Eastern goes now; the same moment is before 8am in Los Angeles, so that text waits.
    const morning=new Date(day+'T13:30:00Z');
    expect(await sendCareJoysSms(env(ON),{to:P,body:'East',now:morning})).toMatchObject({ok:true,status:'queued'});
    const held=await sendCareJoysSms(env(ON),{to:P,body:'West',timeZone:'America/Los_Angeles',now:morning}) as any;
    expect(held).toMatchObject({ok:true,queued:true});
    expect(Number(new Date(held.sendAfter).toLocaleString('en-US',{timeZone:'America/Los_Angeles',hour:'numeric',hourCycle:'h23'}))).toBe(8);
    // 11pm Eastern waits for the next 8am Eastern.
    const night=await sendCareJoysSms(env(ON),{to:P,body:'Night',now:new Date(day+'T03:30:00Z')}) as any;
    expect(night.queued).toBe(true);
    expect(nyHour(night.sendAfter)).toBe(8);
    // A reminder that would still be waiting when its interview starts is dropped instead.
    expect(await sendCareJoysSms(env(ON),{to:P,body:'Late',now:new Date(day+'T03:30:00Z'),expiresAt:new Date(day+'T05:00:00Z').toISOString()})).toMatchObject({ok:false,reason:'expired'});
    expect(twilioCalls.length).toBe(calls+1);
    expect((await smsTo(P)).map((m:any)=>[m.body,m.status])).toEqual([['East','queued'],['West','scheduled'],['Night','scheduled'],['Late','expired']]);

    // Before the window nothing moves; once it opens the cron sends each held text once.
    const first=Math.min(Date.parse(held.sendAfter),Date.parse(night.sendAfter)),last=Math.max(Date.parse(held.sendAfter),Date.parse(night.sendAfter));
    expect((await runCareJoysSmsJobs(env(ON),new Date(first-60000)))!.queued.sent).toBe(0);
    expect((await runCareJoysSmsJobs(env(ON),new Date(last+60000)))!.queued.sent).toBe(2);
    expect((await runCareJoysSmsJobs(env(ON),new Date(last+120000)))!.queued.sent).toBe(0);
    expect(twilioCalls.length).toBe(calls+3);
    expect((await smsTo(P)).filter((m:any)=>m.status==='queued'&&m.twilio_sid)).toHaveLength(3);
  });

  it('caps each number at 4 texts in 7 days and logs the rest as dropped', async()=>{
    const P='+14105550166';
    await recordSmsConsent(env(),{brand:'carejoys',phone:P,event:'opt_in',source:'test'});
    const calls=twilioCalls.length;
    for(let i=0;i<4;i++)expect((await sendCareJoysSms(env(ON),{to:P,body:'Text '+i,now:NOON})).ok).toBe(true);
    expect(await sendCareJoysSms(env(ON),{to:P,body:'Fifth',now:NOON})).toMatchObject({ok:false,reason:'weekly_cap'});
    expect(twilioCalls.length).toBe(calls+4);
    expect((await smsTo(P)).at(-1)).toMatchObject({body:'Fifth',status:'capped'});
    // Eight days later the week has rolled over.
    expect((await sendCareJoysSms(env(ON),{to:P,body:'Next week',now:new Date(NOON.getTime()+8*86400000)})).ok).toBe(true);
  });

  it('works out the recipient’s time zone from ZIP and state', ()=>{
    expect(timeZoneFor('MD','21204')).toBe('America/New_York');
    expect(timeZoneFor('','90001')).toBe('America/Los_Angeles');
    expect(timeZoneFor('FL','32501')).toBe('America/Chicago');
    expect(timeZoneFor('TX','79901')).toBe('America/Denver');
    expect(timeZoneFor('','')).toBe('America/New_York');
  });

  describe('invitations by text', ()=>{
    const YES='+14105550181',NO='+14105550183',REM='+14105550184',LEGACY='+14105550182',AGENCY='+14105550190';
    const headers={cookie:'cj_session=sms-session','content-type':'application/json'};
    const pipe=(id:string)=>DB.prepare('SELECT * FROM candidate_pipeline WHERE id=?').bind(id).first();
    beforeAll(async()=>{
      await DB.prepare("INSERT INTO employer_leads(id,company_name,contact_name,email,zip,roles_needed,status,approved_at) VALUES ('smsemp','SMS Home Care','Lee','lee@smshome.test','21204','CNA','active',CURRENT_TIMESTAMP)").run();
      await DB.prepare("INSERT INTO employer_sessions(id,employer_id,session_hash,expires_at) VALUES ('sms-s','smsemp',?,?)").bind(await sha256Hex('sms-session'),new Date(Date.now()+86400000).toISOString()).run();
      for(const [id,phone,consented,extra] of [['smsyes',YES,true,{}],['smsno',NO,true,{}],['smsrem',REM,true,{}],
        // A legacy import with a number and an old CareKoya flag, but no CareJoys opt-in on record.
        ['smslegacy',LEGACY,false,{source:'legacy_carekoya',activation_completed_at:recent,sms_consent:1}]] as const){
        await addCaregiver(id,'21204',{phone,state:'MD',...extra});
        if(consented)await saveCaregiverSmsConsent(env(),new Request('https://carejoys.com/'),{caregiverId:id,consent:true,source:'test'});
      }
      for(const opening of ['sms-off','sms-on']){
        await DB.prepare("INSERT INTO openings(id,employer_id,title,role,city,state,zip,pay_min,pay_max,shift_preferences,status) VALUES (?,'smsemp','CNA Towson','CNA','Towson','MD','21204',19,22,'Weekday days','open')").bind(opening).run();
        for(const c of ['smsyes','smsno','smsrem','smslegacy'])await DB.prepare("INSERT INTO candidate_pipeline(id,opening_id,caregiver_id,stage) VALUES (?,?,?,'matched')").bind(opening+'-'+c,opening,c).run();
      }
    });

    it('sends nothing at all while SMS is switched off', async()=>{
      const calls=twilioCalls.length,rows=(await DB.prepare("SELECT COUNT(*) AS n FROM sms_messages").first()).n;
      sent.length=0;
      const ids=['smsyes','smsno','smsrem','smslegacy'].map(c=>'sms-off-'+c);
      // Twilio credentials set but SMS_ENABLED not "true": the emails go, no texts.
      expect(await (await call('/api/openings/sms-off/contact',{method:'POST',headers,body:JSON.stringify({pipelineIds:ids})},TWILIO)).json()).toMatchObject({sent:4});
      expect(sent).toHaveLength(4);
      expect(await textJobInvite(env(TWILIO),'sms-off-smsyes')).toBeNull();
      expect(await runCareJoysSmsJobs(env(TWILIO))).toBeNull();
      await DB.prepare("UPDATE candidate_pipeline SET contacted_at=datetime('now','-3 days') WHERE id='sms-off-smsrem'").run();
      sent.length=0;
      await sendHiringFollowups(env(TWILIO));
      expect(sent.some(m=>m.to==='smsrem@example.com')).toBe(true);
      expect(twilioCalls.length).toBe(calls);
      expect((await DB.prepare("SELECT COUNT(*) AS n FROM sms_messages").first()).n).toBe(rows);
      expect((await pipe('sms-off-smsyes')).sms_invited_at).toBeNull();
      // Close the off-run invitations so replies below answer the texted ones.
      await DB.prepare("UPDATE candidate_pipeline SET stage='rejected',response_value='not_interested' WHERE opening_id='sms-off'").run();
    });

    it('texts the invitation next to the email, only to caregivers who opted in', async()=>{
      sent.length=0;
      const ids=['smsyes','smsno','smsrem','smslegacy'].map(c=>'sms-on-'+c);
      expect(await (await call('/api/openings/sms-on/contact',{method:'POST',headers,body:JSON.stringify({pipelineIds:ids})},ON)).json()).toMatchObject({sent:4});
      expect(sent).toHaveLength(4);
      expect(await smsTo(LEGACY)).toEqual([]);
      const [text]=await smsTo(YES);
      expect(text).toMatchObject({template:'job_invite_v1',related_type:'candidate_pipeline',related_id:'sms-on-smsyes'});
      // Sent straight away in the daytime, held for 8am at night.
      expect(['queued','scheduled']).toContain(text.status);
      expect(text.body).toMatch(/^CareJoys: SMS Home Care has a CNA job in Towson, \$19–22\/hr, Weekday days\. Interested\? Reply YES or NO\. Details: carejoys\.com\/r\/[A-Za-z0-9]{10}\. Reply STOP to opt out\.$/);
      expect(text.body.length).toBeLessThanOrEqual(300);
      expect((await pipe('sms-on-smsyes')).sms_invited_at).toBeTruthy();
      // The short link opens the same invitation as the email's link.
      const code=text.body.match(/\/r\/([A-Za-z0-9]+)/)[1];
      const hop=await call('/r/'+code);
      expect(hop.status).toBe(302);
      expect(hop.headers.get('location')).toBe('/respond?token='+code);
      expect((await (await call('/api/respond?token='+code)).json() as any).opportunity).toMatchObject({company:'SMS Home Care',title:'CNA Towson'});
      expect((await call('/api/respond?token=NotARealCode1')).status).toBe(404);
    });

    it('keeps long invitations under 300 characters', ()=>{
      const text=inviteText({company:'A Very Long Agency Name That Goes On And On Home Health Services LLC',role:'HHA',city:'Towson',pay:'$19–22/hr',shift:'Weekday days, some weekends, rotating holidays, live-in available for the right person, flexible hours',link:'carejoys.com/r/abcdefghij'});
      expect(text.length).toBeLessThanOrEqual(300);
      expect(text).toMatch(/has an HHA job in Towson/);
      expect(text).toMatch(/Reply STOP to opt out\.$/);
    });

    it('a YES reply says yes to the invitation like the email button, and tells an agency that opted in to texts', async()=>{
      // Agencies are on email unless they opt in from Settings.
      const settings=await call('/api/workspace/settings',{method:'POST',headers:{...headers,'user-agent':'agency-browser'},body:JSON.stringify({smsAlerts:true,smsAlertPhone:'410-555-0190'})});
      expect((await settings.json() as any).settings).toMatchObject({smsAlerts:true,smsAlertPhone:AGENCY});
      expect(await consentEvents(AGENCY)).toEqual([{event:'opt_in',source:'agency_settings',consent_text:AGENCY_SMS_CONSENT_TEXT,ip:null,user_agent:'agency-browser'}]);
      expect((await call('/api/workspace/settings',{method:'POST',headers,body:JSON.stringify({smsAlerts:true,smsAlertPhone:'12'})})).status).toBe(400);

      const unclear=await (await webhook('/api/sms/inbound',{MessageSid:'SMflow1',From:YES,Body:'what time is it'},{extra:ON})).text();
      expect(unclear).toMatch(/CareJoys: Reply YES or NO, or tap the link: carejoys\.com\/r\/[A-Za-z0-9]{10}/);
      expect((await pipe('sms-on-smsyes')).response_value).toBeNull();

      sent.length=0;
      const yes=await (await webhook('/api/sms/inbound',{MessageSid:'SMflow2',From:YES,Body:'Yes'},{extra:ON})).text();
      expect(yes).toContain('We told SMS Home Care you’re interested');
      expect(await pipe('sms-on-smsyes')).toMatchObject({stage:'interested',response_value:'interested'});
      expect(await DB.prepare("SELECT channel FROM outreach_events WHERE caregiver_id='smsyes' AND event_type='job_interest_response'").first()).toEqual({channel:'sms'});
      expect(sent.find(m=>m.subject.startsWith('Interested candidate:'))?.to).toBe('lee@smshome.test');
      const [alert]=await smsTo(AGENCY);
      expect(alert).toMatchObject({template:'agency_yes_v1',body:'CareJoys: smsyes said yes to CNA Towson. Call them now: (410) 555-0181. Reply STOP to opt out.'});
      expect((await pipe('sms-on-smsyes')).agency_texted_at).toBeTruthy();

      // Nothing left open for this number.
      expect(await (await webhook('/api/sms/inbound',{MessageSid:'SMflow3',From:YES,Body:'yes'},{extra:ON})).text()).toContain('no open job invitations');
      expect(await smsTo(AGENCY)).toHaveLength(1);
      // Turning alerts off logs the opt-out.
      await call('/api/workspace/settings',{method:'POST',headers,body:JSON.stringify({smsAlerts:false})});
      expect(await consent(AGENCY)).toEqual({status:'opted_out'});
    });

    it('a NO reply turns the invitation down', async()=>{
      const no=await (await webhook('/api/sms/inbound',{MessageSid:'SMflow4',From:NO,Body:'No thanks'},{extra:ON})).text();
      expect(no).toContain('We told SMS Home Care you’re not interested');
      expect(await pipe('sms-on-smsno')).toMatchObject({stage:'rejected',response_value:'not_interested'});
    });

    it('sends the 2-day reminder by text instead of a second email when the caregiver opted in', async()=>{
      await DB.prepare("UPDATE candidate_pipeline SET contacted_at=datetime('now','-3 days') WHERE id='sms-on-smsrem'").run();
      sent.length=0;
      await sendHiringFollowups(env(ON));
      expect(sent.some(m=>m.to==='smsrem@example.com')).toBe(false);
      const reminder=(await smsTo(REM)).find((m:any)=>m.template==='invite_reminder_v1');
      expect(reminder.body).toMatch(/^CareJoys: Still interested in the CNA Towson with SMS Home Care\? Reply YES or NO\. Details: carejoys\.com\/r\/[A-Za-z0-9]{10}\. Reply STOP to opt out\.$/);
      expect(await DB.prepare("SELECT channel FROM outreach_events WHERE caregiver_id='smsrem' AND event_type='invite_reminder' AND opening_id=(SELECT opening_id FROM candidate_pipeline WHERE id='sms-on-smsrem')").first()).toEqual({channel:'sms'});
    });

    it('texts interview reminders the day before and 2 hours before, once each', async()=>{
      const at=new Date(NOON.getTime()+22*3600000);
      await DB.prepare("UPDATE candidate_pipeline SET stage='interview',interview_at=? WHERE id='sms-on-smsyes'").bind(at.toISOString()).run();
      expect(await sendInterviewReminders(env(ON),NOON)).toBe(1);
      expect(await sendInterviewReminders(env(ON),new Date(NOON.getTime()+3600000))).toBe(0);
      expect(await sendInterviewReminders(env(ON),new Date(at.getTime()-90*60000))).toBe(1);
      expect(await sendInterviewReminders(env(ON),new Date(at.getTime()-60*60000))).toBe(0);
      const texts=(await smsTo(YES)).filter((m:any)=>m.template?.startsWith('interview_'));
      expect(texts.map((m:any)=>m.template)).toEqual(['interview_day_v1','interview_soon_v1']);
      expect(texts[0].body).toMatch(/^CareJoys reminder: your interview with SMS Home Care for CNA Towson is \w{3}, \w{3} \d+, \d+:00 [AP]M E[DS]T\. Reply STOP to opt out\.$/);
      expect(texts[1].body).toContain('in about 2 hours');
    });
  });
});

describe('test accounts sign in with a code', ()=>{
  const EMAIL_ADDR='agency-test@carejoys.com';
  // The real code is never in the repository: the test gives its address a code of its own.
  const CODE='ABCD-EFGH-JKLM-NPQR';
  beforeAll(async()=>{await DB.prepare('UPDATE test_logins SET code_hash=? WHERE email=?').bind(await sha256Hex(CODE.replace(/-/g,'')),EMAIL_ADDR).run()});
  const ACCOUNT=/__Host-cj_account=([^;]+)/;
  const cookieFrom=(res:Response)=>{
    const set=res.headers.get('set-cookie')||'';
    const employer=set.match(/__Host-cj_session=([^;]+)/);
    return '__Host-cj_account='+set.match(ACCOUNT)![1]+(employer&&employer[1]?'; __Host-cj_session='+employer[1]:'');
  };

  it('asks a test address for its code instead of emailing it, and no other address can use a code', async()=>{
    sent.length=0;
    const res=await post('/api/login/request',{email:'Agency-Test@carejoys.com'});
    expect(await res.json()).toMatchObject({ok:true,code:true});
    expect(sent).toHaveLength(0);
    expect((await post('/api/login/code',{email:EMAIL_ADDR,code:'WRONG-CODE'})).status).toBe(400);
    expect((await post('/api/login/code',{email:'pat@acme.test',code:CODE})).status).toBe(400);
  });

  it('walks agency sign-up as a test workspace that never reaches caregivers, then resets', async()=>{
    // Not signed in: the hiring form sends the test address on to its code, with no email.
    sent.length=0;
    const intake=await post('/api/employers',{companyName:'Test Agency',contactName:'Rebecca',email:EMAIL_ADDR,zip:'21201',rolesNeeded:'CNA'});
    const intakeBody=await intake.json() as any;
    expect(intakeBody.redirect).toMatch(/^\/login\?email=agency-test%40carejoys.com&next=%2Fhiring%3Fopening%3D/);
    expect(sent).toHaveLength(0);
    const signIn=await post('/api/login/code',{email:EMAIL_ADDR,code:CODE.toLowerCase().replace(/-/g,' '),next:new URLSearchParams(intakeBody.redirect.split('?')[1]).get('next')});
    expect(signIn.status).toBe(200);
    expect((await signIn.json() as any).redirect).toMatch(/^\/hiring\?opening=/);
    const headers={cookie:cookieFrom(signIn),'content-type':'application/json'};
    const lead=await DB.prepare('SELECT id,is_test,approved_by FROM employer_leads WHERE email=?').bind(EMAIL_ADDR).first() as any;
    expect(lead).toMatchObject({is_test:1,approved_by:'test_account'});

    // Inviting marks caregivers contacted for the walkthrough but emails nobody and never shows on their dashboard.
    const {id}=await (await call('/api/openings',{method:'POST',headers,body:JSON.stringify({title:'CNA test',role:'CNA',zip:'21201'})})).json() as any;
    await call('/api/openings/'+id+'/match',{method:'POST',headers});
    sent.length=0;
    const outcome=await (await call('/api/openings/'+id+'/contact',{method:'POST',headers,body:JSON.stringify({limit:2})})).json() as any;
    expect(outcome.sent).toBeGreaterThan(0);
    expect(sent).toHaveLength(0);
    const contacted=await DB.prepare("SELECT cp.caregiver_id FROM candidate_pipeline cp WHERE cp.opening_id=? AND cp.stage='contacted' LIMIT 1").bind(id).first() as any;
    const caregiverEmail=(await DB.prepare('SELECT email FROM caregivers WHERE id=?').bind(contacted.caregiver_id).first() as any).email;
    const caregiver=await post('/api/login/request',{email:caregiverEmail});
    expect(caregiver.status).toBe(200);
    const token=decodeURIComponent(sent.at(-1)!.html!.match(/signin\?token=([^"&]+)/)![1]);
    const caregiverCookie=cookieFrom(await post('/api/login/verify',{token}));
    const me=await (await call('/api/me',{headers:{cookie:caregiverCookie}})).json() as any;
    expect(JSON.stringify(me)).not.toContain('CNA test');
    await DB.prepare("UPDATE candidate_pipeline SET contacted_at=datetime('now','-3 days') WHERE opening_id=?").bind(id).run();
    sent.length=0;
    await sendHiringFollowups(env());
    expect(sent).toHaveLength(0);

    // Admin numbers leave it out.
    const admin=await (await call('/api/admin/overview?window=all',{headers:{authorization:'Bearer t0ken'}},{ADMIN_TOKEN:'t0ken'})).json() as any;
    expect(JSON.stringify(admin.employers)).not.toContain(EMAIL_ADDR);

    // Reset erases the workspace so sign-up starts over.
    const reset=await post('/api/login/code',{email:EMAIL_ADDR,code:CODE,reset:true});
    expect(reset.status).toBe(200);
    expect((await reset.json() as any).redirect).toBe('/hiring');
    expect(await DB.prepare('SELECT id FROM employer_leads WHERE email=?').bind(EMAIL_ADDR).first()).toBeNull();
    expect(await DB.prepare('SELECT id FROM openings WHERE id=?').bind(id).first()).toBeNull();
  });

  it('walks the caregiver side as a test profile that never reaches a real agency, then resets', async()=>{
    const CAREGIVER='caregiver-test@carejoys.com';
    await DB.prepare('UPDATE test_logins SET code_hash=? WHERE email=?').bind(await sha256Hex(CODE.replace(/-/g,'')),CAREGIVER).run();
    // A real agency on CareJoys with an open job and an opening nearby.
    await DB.prepare("INSERT INTO employer_leads(id,company_name,contact_name,email,zip,roles_needed,status,approved_at) VALUES ('emp-real-t','Real Care','Lee','lee@realcare.test','21230','CNA','active',CURRENT_TIMESTAMP)").run();
    await DB.prepare("INSERT INTO openings(id,employer_id,title,role,zip,status) VALUES ('op-real-t','emp-real-t','CNA Days','CNA','21230','open')").run();
    await DB.prepare("INSERT OR REPLACE INTO agency_organizations(id,organization_key,canonical_name,primary_domain,primary_email,city,state,zip,is_active,claimed_employer_id) VALUES ('org-real-t','org-real-t','Real Care','realcare.test','jobs@realcare.test','Baltimore','MD','21230',1,'emp-real-t')").run();
    await DB.prepare("INSERT OR REPLACE INTO caregiver_jobs(id,agency_organization_id,dedupe_key,source_provider,source_url,title,role,employer_name,city,state,zip,status,is_published) VALUES ('job-real-t','org-real-t','job-real-t','test','https://realcare.test/apply','CNA Days','CNA','Real Care','Baltimore','MD','21230','current',1)").run();

    const signIn=await post('/api/login/code',{email:CAREGIVER,code:CODE});
    expect((await signIn.json() as any).redirect).toBe('/dashboard');
    const cookie=cookieFrom(signIn);
    // A signed-in profile save needs no security check.
    const saved=await post('/api/caregiver-resume',{firstName:'Test',lastName:'Caregiver',email:CAREGIVER,zip:'21230',role:'CNA',targetJobId:'job-real-t'},{cookie},{TURNSTILE_SECRET_KEY:'secret'});
    expect(saved.status).toBe(201);
    const profile=await DB.prepare('SELECT id,is_test FROM caregivers WHERE email=?').bind(CAREGIVER).first() as any;
    expect(profile.is_test).toBe(1);
    await DB.prepare("UPDATE caregivers SET work_status='actively_looking',auth0_email_verified=1 WHERE id=?").bind(profile.id).run();

    // Applying looks the same to them, but no agency inbox, email or match ever sees the test profile.
    sent.length=0;
    expect(await (await post('/api/me/apply/job-real-t',{},{cookie})).json()).toMatchObject({status:'applied',employerOnCareJoys:true});
    expect(await DB.prepare('SELECT id FROM agency_interests WHERE caregiver_id=?').bind(profile.id).first()).toBeNull();
    expect(sent.every(m=>m.to===CAREGIVER)).toBe(true);
    expect(await DB.prepare('SELECT id FROM candidate_pipeline WHERE caregiver_id=?').bind(profile.id).first()).toBeNull();
    // Apply for me only ever practices for a test account: it never starts a real run that could submit.
    expect((await post('/api/me/apply-agent/job-real-t',{},{cookie})).status).toBe(422);
    expect((await post('/api/me/apply-agent/job-paylocity',{},{cookie})).status).toBe(503);
    expect(await DB.prepare('SELECT id FROM apply_agent_sessions WHERE caregiver_id=?').bind(profile.id).first()).toBeNull();

    // Erase and start over: the old profile is retired and sign-up starts fresh.
    const reset=await post('/api/login/code',{email:CAREGIVER,code:CODE,reset:true});
    expect((await reset.json() as any).redirect).toBe('/dashboard');
    expect(await DB.prepare('SELECT id FROM caregivers WHERE email=?').bind(CAREGIVER).first()).toBeNull();
    expect(await DB.prepare('SELECT work_status,is_active FROM caregivers WHERE id=?').bind(profile.id).first()).toEqual({work_status:'merged_duplicate',is_active:0});
  });
});

describe('caregiver protection', ()=>{
  // Chicago, away from every other test's caregivers.
  const ZIP='60601';
  const as=(cookie:string)=>({cookie:'cj_session='+cookie,'content-type':'application/json'});
  const stripe={STRIPE_SECRET_KEY:'sk_test',STRIPE_PRICE_ID:'price_test'};
  async function workspace(id:string,name:string){
    await DB.prepare("INSERT INTO employer_leads(id,company_name,contact_name,email,zip,roles_needed,status,approved_at) VALUES (?,?,'Lee',?,?,'CNA','active',CURRENT_TIMESTAMP)").bind(id,name,id+'@guard.test',ZIP).run();
    await DB.prepare("INSERT INTO employer_sessions(id,employer_id,session_hash,expires_at) VALUES (?,?,?,?)").bind(id+'-s',id,await sha256Hex(id+'-cookie'),new Date(Date.now()+86400000).toISOString()).run();
    return as(id+'-cookie');
  }
  /** A new opening, matched, and the pipeline row of each named caregiver on it. */
  async function opening(headers:Record<string,string>,title:string,extra:Record<string,unknown>={}){
    const {id}=await (await call('/api/openings',{method:'POST',headers,body:JSON.stringify({title,role:'CNA',zip:ZIP})},extra)).json() as any;
    await call('/api/openings/'+id+'/match',{method:'POST',headers},extra);
    const rows=(await (await call('/api/pipeline?openingId='+id,{headers},extra)).json() as any).pipeline as any[];
    return {id,row:(caregiverId:string)=>rows.find(r=>r.caregiver_id===caregiverId)};
  }
  const invite=async(headers:Record<string,string>,openingId:string,pipelineIds:string[],extra:Record<string,unknown>={})=>
    await (await call('/api/openings/'+openingId+'/contact',{method:'POST',headers,body:JSON.stringify({pipelineIds})},extra)).json() as any;
  const stage=async(pipelineId:string)=>((await DB.prepare('SELECT stage FROM candidate_pipeline WHERE id=?').bind(pipelineId).first()) as any).stage;
  const searchIds=async(headers:Record<string,string>)=>((await (await call('/api/candidates?zip='+ZIP+'&radius=all',{headers})).json() as any).candidates as any[]).map(c=>c.id);
  async function caregiverCookie(email:string){
    sent.length=0;
    await post('/api/login/request',{email});
    const token=decodeURIComponent(sent.at(-1)!.html!.match(/signin\?token=([^"&]+)/)![1]);
    const res=await post('/api/login/verify',{token});
    return {cookie:'__Host-cj_account='+(res.headers.get('set-cookie')||'').match(/__Host-cj_account=([^;]+)/)![1],'content-type':'application/json'};
  }
  let guard:Record<string,string>,other:Record<string,string>;
  beforeAll(async()=>{
    guard=await workspace('emp-guard','Guard Care');
    other=await workspace('emp-guard2','Other Guard Care');
    for(const id of ['g-unsub','g-ok','g-busy','g-pend','g-hide','g-pause','g-bio'])await addCaregiver(id,ZIP);
  });

  it('skips caregivers who unsubscribed from email', async()=>{
    await DB.prepare("INSERT INTO email_suppressions(email,reason) VALUES ('G-Unsub@example.com','unsubscribe')").run();
    const o=await opening(guard,'Unsub check');
    sent.length=0;
    const result=await invite(guard,o.id,[o.row('g-unsub').id,o.row('g-ok').id]);
    expect(result.sent).toBe(1);
    expect(sent.map(m=>m.to)).toEqual(['g-ok@example.com']);
    expect(await stage(o.row('g-unsub').id)).toBe('matched');
  });

  it('holds back a caregiver who already has 3 invitations this week', async()=>{
    for(let i=0;i<3;i++){
      const {id}=await (await call('/api/openings',{method:'POST',headers:other,body:JSON.stringify({title:'Other '+i,role:'CNA',zip:ZIP})})).json() as any;
      await DB.prepare("INSERT INTO candidate_pipeline(id,opening_id,caregiver_id,stage,contacted_at,response_value) VALUES (?,?,'g-busy','contacted',datetime('now','-1 day'),'not_interested')").bind('busy-'+i,id).run();
    }
    const o=await opening(guard,'Busy check');
    const result=await invite(guard,o.id,[o.row('g-busy').id]);
    expect(result).toMatchObject({sent:0,heldBack:1,held:{caregiverWeekly:1,pendingFromYou:0,weeklyLimit:0,freeLimit:0}});
    expect(result.notice).toBe('1 caregiver already has enough invitations this week. Try them again next week.');
    expect(await stage(o.row('g-busy').id)).toBe('matched');
    // A week later they can be invited again.
    await DB.prepare("UPDATE candidate_pipeline SET contacted_at=datetime('now','-8 days') WHERE caregiver_id='g-busy' AND id LIKE 'busy-%'").run();
    expect((await invite(guard,o.id,[o.row('g-busy').id])).sent).toBe(1);
  });

  it('allows only one unanswered invitation from the same agency', async()=>{
    const a=await opening(guard,'Pending A'),b=await opening(guard,'Pending B');
    expect((await invite(guard,a.id,[a.row('g-pend').id])).sent).toBe(1);
    const second=await invite(guard,b.id,[b.row('g-pend').id]);
    expect(second).toMatchObject({sent:0,held:{pendingFromYou:1}});
    expect(second.notice).toContain('already has an invitation from you waiting for an answer');
    // Another agency can still invite them.
    const c=await opening(other,'Pending other');
    expect((await invite(other,c.id,[c.row('g-pend').id])).sent).toBe(1);
  });

  it('caps a workspace at 15 invitations a week, 75 on the paid plan, and shows the count', async()=>{
    const capped=await workspace('emp-guard3','Capped Care');
    const filler=await (await call('/api/openings',{method:'POST',headers:capped,body:JSON.stringify({title:'Filler',role:'CNA',zip:'99501'})})).json() as any;
    for(let i=0;i<15;i++){
      await addCaregiver('g-fill-'+i,'99501');
      await DB.prepare("INSERT INTO candidate_pipeline(id,opening_id,caregiver_id,stage,contacted_at) VALUES (?,?,?,'contacted',datetime('now','-2 days'))").bind('fill-'+i,filler.id,'g-fill-'+i).run();
    }
    await addCaregiver('g-cap',ZIP);
    const o=await opening(capped,'Cap check');
    const result=await invite(capped,o.id,[o.row('g-cap').id]);
    expect(result).toMatchObject({sent:0,heldBack:1,held:{weeklyLimit:1},inviteAllowance:{used:15,limit:15}});
    expect(result.notice).toBe('You can send 15 invitations a week, so 1 caregiver wasn’t invited. Try again next week.');
    expect((await (await call('/api/workspace',{headers:capped})).json() as any).inviteAllowance).toEqual({used:15,limit:15});
    // Billing on but unpaid is still 15; paid is 75 and the invitation goes out.
    expect((await (await call('/api/billing',{headers:capped},stripe)).json() as any).inviteAllowance).toEqual({used:15,limit:15});
    await DB.prepare("INSERT INTO employer_billing(employer_id,status) VALUES ('emp-guard3','active')").run();
    expect((await (await call('/api/workspace',{headers:capped},stripe)).json() as any).inviteAllowance).toEqual({used:15,limit:75});
    expect(await invite(capped,o.id,[o.row('g-cap').id],stripe)).toMatchObject({sent:1,heldBack:0,inviteAllowance:{used:16,limit:75}});
  });

  it('keeps an unpaid workspace to 3 unanswered invitations per free introduction left, and is honest about a locked yes', async()=>{
    const free=await workspace('emp-guard4','Free Four Care');
    const billing={...stripe,FREE_CONTACTS:'1'};
    const ids=['g-free-1','g-free-2','g-free-3','g-free-4'];
    for(const id of ids)await addCaregiver(id,ZIP);
    const o=await opening(free,'Free check',billing);
    sent.length=0;
    const result=await invite(free,o.id,ids.map(id=>o.row(id).id),billing);
    expect(result).toMatchObject({sent:3,heldBack:1,held:{freeLimit:1}});
    expect(result.notice).toContain('Upgrade to invite more.');
    const token=(to:string)=>decodeURIComponent(sent.find(m=>m.to===to)!.html!.match(/respond\?token=([^"&\s]+)/)![1]);
    const yes=async(to:string)=>await (await call('/api/respond',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:token(to),choice:'interested'})},billing)).json() as any;
    expect(await yes('g-free-1@example.com')).toEqual({ok:true,choice:'interested',locked:false});
    const locked=await yes('g-free-2@example.com');
    expect(locked).toMatchObject({locked:true,message:"Thanks! Free Four Care will see your answer once they upgrade their CareJoys plan. We'll let you know if they reach out."});
    const page=await (await call('/api/respond?token='+encodeURIComponent(token('g-free-2@example.com')),{},billing)).json() as any;
    expect(page.opportunity).toMatchObject({locked:true,slots:[]});
    // Free introductions are used up now: no more invitations until they upgrade.
    expect((await call('/api/openings/'+o.id+'/contact',{method:'POST',headers:free,body:'{}'},billing)).status).toBe(402);
  });

  it('hides a caregiver from an agency they picked, but not from one they applied to', async()=>{
    const before=await opening(guard,'Hide check');
    const me=await caregiverCookie('g-hide@example.com');
    const found=await (await call('/api/me/agency-search?q=guard',{headers:me})).json() as any;
    expect(found.agencies).toEqual(expect.arrayContaining([{id:'emp-guard',name:'Guard Care'},{id:'emp-guard2',name:'Other Guard Care'}]));
    expect(JSON.stringify(found)).not.toContain('@');
    const hid=await (await post('/api/me/hidden-agencies',{employerId:'emp-guard'},me)).json() as any;
    expect(hid.hiddenAgencies).toEqual([{id:'emp-guard',name:'Guard Care'}]);
    expect((await (await call('/api/me',{headers:me})).json() as any).hiddenAgencies).toEqual([{id:'emp-guard',name:'Guard Care'}]);

    expect(await searchIds(guard)).not.toContain('g-hide');
    expect(await searchIds(other)).toContain('g-hide');
    expect((await call('/api/candidates/g-hide',{headers:guard})).status).toBe(404);
    expect((await call('/api/candidates/g-hide',{headers:other})).status).toBe(200);
    expect((await post('/api/openings/'+before.id+'/candidates',{caregiverId:'g-hide'},{cookie:guard.cookie})).status).toBe(404);
    // A match made before hiding is neither shown nor invited, and new matching leaves them out.
    expect(before.row('g-hide')).toBeDefined();
    expect((await invite(guard,before.id,[before.row('g-hide').id])).sent).toBe(0);
    expect(await stage(before.row('g-hide').id)).toBe('matched');
    expect((await opening(guard,'Hide check 2')).row('g-hide')).toBeUndefined();
    const pipeline=(await (await call('/api/pipeline?openingId='+before.id,{headers:guard})).json() as any).pipeline as any[];
    expect(pipeline.find(r=>r.caregiver_id==='g-hide')).toBeUndefined();

    // Applying to the agency makes them its applicant again.
    await DB.prepare("INSERT INTO agency_organizations(id,organization_key,canonical_name,city,state,is_active,claimed_employer_id) VALUES ('org-guard','org-guard','Guard Care','Chicago','IL',1,'emp-guard')").run();
    await DB.prepare("INSERT INTO agency_interests(id,organization_id,caregiver_id,job_key,source) VALUES ('ai-guard','org-guard','g-hide','','job_apply')").run();
    expect(await searchIds(guard)).toContain('g-hide');
    expect((await call('/api/candidates/g-hide',{headers:guard})).status).toBe(200);

    expect((await (await post('/api/me/hidden-agencies',{employerId:'emp-guard',hidden:false},me)).json() as any).hiddenAgencies).toEqual([]);
    expect((await post('/api/me/hidden-agencies',{employerId:'no-such-agency'},me)).status).toBe(404);
  });

  it('pauses invitations for 2 weeks across every agency, and resumes them', async()=>{
    const before=await opening(other,'Pause check');
    const me=await caregiverCookie('g-pause@example.com');
    const paused=await (await post('/api/me/invite-pause',{paused:true},me)).json() as any;
    expect(Date.parse(paused.invitesPausedUntil)-Date.now()).toBeGreaterThan(13*86400000);
    expect((await (await call('/api/me',{headers:me})).json() as any).caregiver.invitesPausedUntil).toBe(paused.invitesPausedUntil);
    expect(await searchIds(guard)).not.toContain('g-pause');
    expect(await searchIds(other)).not.toContain('g-pause');
    expect((await call('/api/candidates/g-pause',{headers:other})).status).toBe(404);
    expect((await invite(other,before.id,[before.row('g-pause').id])).sent).toBe(0);
    expect((await opening(guard,'Pause check 2')).row('g-pause')).toBeUndefined();
    // Saving their profile while paused doesn't match them to openings either.
    const saved=await (await post('/api/me/preferences',{zip:ZIP,travelMiles:25},me)).json() as any;
    expect(saved.matchedOpenings).toBe(0);

    expect((await (await post('/api/me/invite-pause',{paused:false},me)).json() as any).invitesPausedUntil).toBeNull();
    expect(await searchIds(other)).toContain('g-pause');
    expect((await invite(other,before.id,[before.row('g-pause').id])).sent).toBe(1);
  });

  it('shows city and distance but no ZIP, and no contact details in the bio, before a yes', async()=>{
    await DB.prepare("UPDATE caregivers SET city='Chicago',state='IL',bio=? WHERE id='g-bio'").bind('Kind CNA. Text me at 312-555-0199 or g.bio@gmail.com, or see www.gbio.com').run();
    const profile=(await (await call('/api/candidates/g-bio?zip='+ZIP,{headers:guard})).json() as any).candidate;
    expect(profile).toMatchObject({city:'Chicago',state:'IL',distanceMiles:0,bio:'Kind CNA. Text me at or, or see'});
    expect(profile).not.toHaveProperty('zip');
    const listed=((await (await call('/api/candidates?zip='+ZIP,{headers:guard})).json() as any).candidates as any[]).find(c=>c.id==='g-bio');
    expect(listed).not.toHaveProperty('zip');
    // Opening ids are random UUIDs and can contain 555 themselves.
    expect(JSON.stringify({...listed,invitableOpeningIds:undefined})).not.toMatch(/555|@gmail|www\./);
  });

  it('limits a workspace to 100 searches and 300 profile views a day', async()=>{
    const busy=await workspace('emp-guard5','Busy Care');
    const today=new Date().toISOString().slice(0,10);
    await DB.prepare("INSERT INTO rate_limits(bucket,identity,window_start,count) VALUES ('talent_search','emp-guard5',?,99),('talent_view','emp-guard5',?,300)").bind(today,today).run();
    expect((await call('/api/candidates?zip='+ZIP,{headers:busy})).status).toBe(200);
    const over=await call('/api/candidates?zip='+ZIP,{headers:busy});
    expect(over.status).toBe(429);
    expect((await over.json() as any).error).toBe("You've reached today's limit of 100 caregiver searches. Try again tomorrow.");
    expect((await call('/api/candidates/g-ok',{headers:busy})).status).toBe(429);
    // Other workspaces are unaffected.
    expect((await call('/api/candidates/g-ok',{headers:guard})).status).toBe(200);
  });
});

describe('agency applicants',()=>{
  const agency={cookie:'cj_session='+SESSION,'content-type':'application/json',origin:'https://carejoys.com'};
  const csv='Name,Phone,Email,Job Title\nAna Lopez,410-555-0101,ana@example.com,Caregiver\nBo Kim,,bo@example.com,GNA\n';

  it('requires a signed-in agency',async()=>{
    expect((await call('/api/workspace/applicants')).status).toBe(401);
  });

  it('imports a CSV with its source, skips people already on the list, and never adds them to the caregiver pool',async()=>{
    const caregiversBefore=(await DB.prepare('SELECT COUNT(*) AS n FROM caregivers').first()).n;
    const first=await (await call('/api/workspace/applicants',{method:'POST',headers:agency,body:JSON.stringify({csv,source:'csv',filename:'indeed.csv'})})).json() as any;
    expect(first).toMatchObject({ok:true,total:2,added:2,duplicate:0,skipped:0});
    const again=await (await call('/api/workspace/applicants',{method:'POST',headers:agency,body:JSON.stringify({csv,source:'dead-pile'})})).json() as any;
    expect(again).toMatchObject({ok:true,added:0,duplicate:2});
    expect((await DB.prepare('SELECT COUNT(*) AS n FROM caregivers').first()).n).toBe(caregiversBefore);
    const list=await (await call('/api/workspace/applicants',{headers:agency})).json() as any;
    expect(list.applicants).toHaveLength(2);
    expect(list.applicants.every((a:any)=>a.source==='csv'&&a.sourceDetail==='indeed.csv'&&a.stage==='new'&&a.receivedAt)).toBe(true);
    expect(list.imports.map((i:any)=>i.added)).toEqual(expect.arrayContaining([2,0]));
  });

  it('rejects a source outside the list',async()=>{
    const res=await call('/api/workspace/applicants',{method:'POST',headers:agency,body:JSON.stringify({csv,source:'facebook'})});
    expect(res.status).toBe(400);
  });

  it('stamps first contact and screening as the stage moves, and keeps notes',async()=>{
    const list=await (await call('/api/workspace/applicants',{headers:agency})).json() as any;
    const ana=list.applicants.find((a:any)=>a.email==='ana@example.com');
    const contacted=await (await call('/api/workspace/applicants/'+ana.id,{method:'POST',headers:agency,body:JSON.stringify({stage:'contacted',notes:'Left a voicemail'})})).json() as any;
    expect(contacted.applicant).toMatchObject({stage:'contacted',notes:'Left a voicemail',screenedAt:''});
    expect(contacted.applicant.firstContactAt).not.toBe('');
    const screened=await (await call('/api/workspace/applicants/'+ana.id,{method:'POST',headers:agency,body:JSON.stringify({stage:'screened'})})).json() as any;
    expect(screened.applicant.screenedAt).not.toBe('');
    expect(screened.applicant.firstContactAt).toBe(contacted.applicant.firstContactAt);
    expect((await call('/api/workspace/applicants/'+ana.id,{method:'POST',headers:agency,body:JSON.stringify({stage:'maybe'})})).status).toBe(400);
  });

  it('keeps one agency out of another agency’s list',async()=>{
    await DB.prepare("INSERT OR IGNORE INTO employer_leads(id,company_name,contact_name,email,zip,roles_needed,status,approved_at) VALUES ('emp-other','Other Care','Lee','lee@other.test','21201','CNA','active',CURRENT_TIMESTAMP)").run();
    await DB.prepare("INSERT OR IGNORE INTO employer_sessions(id,employer_id,session_hash,expires_at) VALUES ('s-other','emp-other',?,?)").bind(await sha256Hex('other-session'),new Date(Date.now()+86400000).toISOString()).run();
    const other={cookie:'cj_session=other-session','content-type':'application/json',origin:'https://carejoys.com'};
    expect(((await (await call('/api/workspace/applicants',{headers:other})).json()) as any).applicants).toHaveLength(0);
    const ana=((await (await call('/api/workspace/applicants',{headers:agency})).json()) as any).applicants[0];
    expect((await call('/api/workspace/applicants/'+ana.id,{method:'POST',headers:other,body:JSON.stringify({stage:'hired'})})).status).toBe(404);
  });

  it('lets a CareJoys admin upload and work an agency’s list',async()=>{
    const admin={authorization:'Bearer ops','content-type':'application/json',origin:'https://carejoys.com'};
    expect((await call('/api/admin/applicants?employer=emp1',{headers:{'content-type':'application/json'}},{ADMIN_TOKEN:'ops'})).status).toBe(401);
    expect((await call('/api/admin/applicants',{headers:admin},{ADMIN_TOKEN:'ops'})).status).toBe(400);
    expect((await call('/api/admin/applicants?employer=nope',{headers:admin},{ADMIN_TOKEN:'ops'})).status).toBe(404);
    const r=await (await call('/api/admin/applicants?employer=emp1',{method:'POST',headers:admin,body:JSON.stringify({csv:'First Name,Last Name,Mobile\nCy,Doe,4105550199\n',source:'referral',sourceDetail:'Ana Lopez'})},{ADMIN_TOKEN:'ops'})).json() as any;
    expect(r).toMatchObject({ok:true,added:1});
    const list=await (await call('/api/workspace/applicants',{headers:agency})).json() as any;
    expect(list.applicants.find((a:any)=>a.phone==='+14105550199')).toMatchObject({name:'Cy Doe',source:'referral',sourceDetail:'Ana Lopez'});
  });
});

describe('dead-pile reactivation',()=>{
  const admin={authorization:'Bearer ops','content-type':'application/json',origin:'https://carejoys.com'};
  const ops={ADMIN_TOKEN:'ops'};
  const url='/api/admin/applicant-reactivation?employer=emp1';
  const csv='Name,Email,Job Title\nDee Past,dee@example.com,Caregiver\nEd Past,ed@example.com,GNA\nFay Gone,fay@example.com,Caregiver\nNo Email,,\n';

  it('is admin only and needs a sender name',async()=>{
    expect((await call(url,{},ops)).status).toBe(401);
    expect((await call(url,{method:'POST',headers:admin,body:JSON.stringify({senderName:' '})},ops)).status).toBe(400);
  });

  it('sends a test, then emails each past applicant once, skipping unsubscribed addresses',async()=>{
    await call('/api/admin/applicants?employer=emp1',{method:'POST',headers:admin,body:JSON.stringify({csv,source:'dead-pile'})},ops);
    await DB.prepare("INSERT INTO email_suppressions(email,reason,source) VALUES ('fay@example.com','unsubscribe','test') ON CONFLICT(email) DO NOTHING").run();
    const before=await (await call(url,{headers:admin},ops)).json() as any;
    expect(before).toMatchObject({ok:true,ready:2,sent:0,yes:0});

    const at=sent.length;
    const test=await call(url,{method:'POST',headers:admin,body:JSON.stringify({senderName:'Sam',payText:'$17–$20/hr',testTo:'boss@carejoys.com'})},ops);
    expect(test.status).toBe(200);
    expect(sent.slice(at)).toHaveLength(1);
    expect(sent[at]).toMatchObject({to:'boss@carejoys.com'});
    expect(sent[at].subject).toMatch(/^\[Test\]/);
    expect(((await (await call(url,{headers:admin},ops)).json()) as any).sent).toBe(0);

    const r=await (await call(url,{method:'POST',headers:admin,body:JSON.stringify({senderName:'Sam',payText:'$17–$20/hr'})},ops)).json() as any;
    expect(r.batch).toEqual({attempted:2,sent:2,failed:0});
    expect(r.status).toMatchObject({ready:0,sent:2});
    const mails=sent.slice(at+1);
    expect(mails.map(m=>m.to).sort()).toEqual(['dee@example.com','ed@example.com']);
    const company=(await DB.prepare("SELECT company_name c FROM employer_leads WHERE id='emp1'").first()).c;
    expect((mails[0] as any).from).toBe(company+' via CareJoys <hello@carejoys.com>');
    expect(mails[0].html).toContain(`This is Sam with <strong>${company}</strong>`);
    expect(mails[0].html).toContain('paying $17–$20/hr');
    expect(mails[0].headers?.['List-Unsubscribe']).toMatch(/unsubscribe/);

    const again=await (await call(url,{method:'POST',headers:admin,body:JSON.stringify({senderName:'Sam'})},ops)).json() as any;
    expect(again.batch.attempted).toBe(0);
  });

  it('records a yes with a better phone and the separate CareJoys opt-in, and a no',async()=>{
    const linkFor=(to:string)=>{const m=sent.filter(x=>x.to===to).pop() as any;return (m.text as string).match(/https:\/\/carejoys\.com\/still-looking\?token=[^&\s]+/)![0].replace('https://carejoys.com','')};
    const dee=linkFor('dee@example.com');
    const page=await call(dee+'&answer=yes');
    expect(page.status).toBe(200);
    const company=(await DB.prepare("SELECT company_name c FROM employer_leads WHERE id='emp1'").first()).c;
    expect(await page.text()).toContain(`Tell ${company} you’re still looking`);
    // Opening the link alone (a mail scanner) records nothing.
    expect((await DB.prepare("SELECT reactivation_response r FROM agency_applicants WHERE email='dee@example.com'").first()).r).toBeNull();
    const yes=await call(dee,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded',origin:'https://carejoys.com'},body:'answer=yes&phone=410-555-0177&pool=1'});
    expect(yes.status).toBe(200);
    const row=await DB.prepare("SELECT * FROM agency_applicants WHERE email='dee@example.com'").first();
    expect(row).toMatchObject({reactivation_response:'yes',stage:'contacted',reply_phone:'+14105550177',pool_opt_in:1});
    expect(row.first_contact_at).toBeTruthy();
    expect(await DB.prepare("SELECT COUNT(*) n FROM caregivers WHERE email='dee@example.com'").first()).toMatchObject({n:0});

    await call(linkFor('ed@example.com'),{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded',origin:'https://carejoys.com'},body:'answer=no'});
    expect(await DB.prepare("SELECT reactivation_response r,stage,pool_opt_in p FROM agency_applicants WHERE email='ed@example.com'").first()).toMatchObject({r:'no',stage:'new',p:0});

    const list=await (await call('/api/admin/applicants?employer=emp1',{headers:admin},ops)).json() as any;
    expect(list.applicants.find((a:any)=>a.email==='dee@example.com').reactivation).toMatchObject({response:'yes',replyPhone:'+14105550177',status:'sent'});
    expect(((await (await call(url,{headers:admin},ops)).json()) as any)).toMatchObject({yes:1,no:1});
  });

  it('turns away unknown links and explains test links',async()=>{
    expect((await call('/still-looking?token=nope&answer=yes')).status).toBe(404);
    const preview=await call('/still-looking?token=preview&answer=yes');
    expect(preview.status).toBe(200);
    expect(await preview.text()).toContain('This is a test email.');
  });
});

describe('applicant screening and show-up',()=>{
  const agency={cookie:'cj_session='+SESSION,'content-type':'application/json',origin:'https://carejoys.com'};
  const url='/api/workspace/applicant-screening';
  const post=(id:string,body:object,headers:Record<string,string>=agency)=>call('/api/workspace/applicants/'+id,{method:'POST',headers,body:JSON.stringify(body)});
  let id='';

  it('starts an agency on the caregiver default list and saves its own',async()=>{
    expect((await call(url)).status).toBe(401);
    const first=await (await call(url,{headers:agency})).json() as any;
    expect(first).toMatchObject({ok:true,isDefault:true});
    expect(first.questions.find((q:any)=>q.id==='car')).toMatchObject({type:'yes_no',knockout:'no'});
    expect((await call(url,{method:'POST',headers:agency,body:JSON.stringify({questions:[]})})).status).toBe(400);
    const saved=await (await call(url,{method:'POST',headers:agency,body:JSON.stringify({questions:[...first.questions,{label:'Are you OK with pets?',type:'yes_no',knockout:'no'}]})})).json() as any;
    const email=(await DB.prepare("SELECT email FROM employer_leads WHERE id='emp1'").first() as any).email;
    expect(saved).toMatchObject({ok:true,isDefault:false,updatedBy:email});
    expect(saved.questions.at(-1)).toEqual({id:'are_you_ok_with_pets',label:'Are you OK with pets?',type:'yes_no',knockout:'no'});
    expect(((await (await call(url,{headers:agency})).json()) as any).questions).toHaveLength(first.questions.length+1);
  });

  it('saves a screen, flags knockouts, and moves a new applicant to Screened',async()=>{
    await call('/api/workspace/applicants',{method:'POST',headers:agency,body:JSON.stringify({csv:'Name,Phone\nDee Screen,4105550177\n',source:'csv'})});
    const list=await (await call('/api/workspace/applicants',{headers:agency})).json() as any;
    id=list.applicants.find((a:any)=>a.phone==='+14105550177').id;
    const r=await (await post(id,{screeningAnswers:{car:'yes',are_you_ok_with_pets:'no',pay:'$18',unknown:'x'}})).json() as any;
    expect(r.applicant.stage).toBe('screened');
    expect(r.applicant.screenedAt).not.toBe('');
    expect(r.applicant.firstContactAt).not.toBe('');
    expect(r.applicant.screening).toEqual({answers:{car:'yes',are_you_ok_with_pets:'no',pay:'$18'},knockouts:['Are you OK with pets?'],screenedBy:(await DB.prepare("SELECT email FROM employer_leads WHERE id='emp1'").first() as any).email});
  });

  it('moves to Interview with a time and Hired with a start date, never backward',async()=>{
    expect((await post(id,{interviewAt:'next tuesday'})).status).toBe(400);
    expect((await post(id,{interviewOutcome:'late'})).status).toBe(400);
    expect((await post(id,{startDate:'10/20/2026'})).status).toBe(400);
    expect((await post(id,{day30:'maybe'})).status).toBe(400);
    const interview=await (await post(id,{interviewAt:'2026-10-15T14:00',interviewOutcome:'showed'})).json() as any;
    expect(interview.applicant).toMatchObject({stage:'interview',showUp:{interviewAt:'2026-10-15T14:00',interviewOutcome:'showed'}});
    const hired=await (await post(id,{startDate:'2026-10-20',day30:'working'})).json() as any;
    expect(hired.applicant).toMatchObject({stage:'hired',showUp:{startDate:'2026-10-20',day30:'working',day90:''}});
    // A later screen or interview change doesn't pull a hire back.
    const again=await (await post(id,{screeningAnswers:{car:'yes'},interviewAt:'2026-10-16T09:00'})).json() as any;
    expect(again.applicant.stage).toBe('hired');
    expect(again.applicant.screening.knockouts).toEqual([]);
    // An explicit stage in the same request wins.
    const notFit=await (await post(id,{day90:'left',stage:'not_fit'})).json() as any;
    expect(notFit.applicant).toMatchObject({stage:'not_fit',showUp:{day90:'left'}});
  });

  it('keeps each agency’s questions and applicants to itself',async()=>{
    await DB.prepare("INSERT OR IGNORE INTO employer_leads(id,company_name,contact_name,email,zip,roles_needed,status,approved_at) VALUES ('emp-other','Other Care','Lee','lee@other.test','21201','CNA','active',CURRENT_TIMESTAMP)").run();
    await DB.prepare("INSERT OR IGNORE INTO employer_sessions(id,employer_id,session_hash,expires_at) VALUES ('s-other','emp-other',?,?)").bind(await sha256Hex('other-session'),new Date(Date.now()+86400000).toISOString()).run();
    const other={cookie:'cj_session=other-session','content-type':'application/json',origin:'https://carejoys.com'};
    expect(((await (await call(url,{headers:other})).json()) as any).isDefault).toBe(true);
    expect((await post(id,{startDate:'2026-11-01'},other)).status).toBe(404);
  });

  it('lets a CareJoys admin edit an agency’s questions',async()=>{
    const admin={authorization:'Bearer ops','content-type':'application/json',origin:'https://carejoys.com'};
    const r=await (await call('/api/admin/applicant-screening?employer=emp-other',{method:'POST',headers:admin,body:JSON.stringify({questions:[{label:'CNA?',type:'yes_no'}]})},{ADMIN_TOKEN:'ops'})).json() as any;
    expect(r).toMatchObject({ok:true,isDefault:false,questions:[{id:'cna',label:'CNA?',type:'yes_no'}]});
    expect((await call('/api/admin/applicant-screening',{headers:admin},{ADMIN_TOKEN:'ops'})).status).toBe(400);
  });
});

describe('referral links',()=>{
  const agency={cookie:'cj_session='+SESSION,'content-type':'application/json',origin:'https://carejoys.com'};
  const admin={authorization:'Bearer ops','content-type':'application/json',origin:'https://carejoys.com'};
  const ops={ADMIN_TOKEN:'ops'};
  const url='/api/workspace/applicant-referrers';
  const form={'content-type':'application/x-www-form-urlencoded',origin:'https://carejoys.com'};
  const apply=(path:string,body:string)=>call(path,{method:'POST',headers:form,body});
  let path='';

  it('adds a referrer with a link, needing a phone or email',async()=>{
    expect((await call(url)).status).toBe(401);
    expect((await call(url,{method:'POST',headers:agency,body:JSON.stringify({name:'Ana Ref'})})).status).toBe(400);
    const r=await (await call(url,{method:'POST',headers:agency,body:JSON.stringify({name:'Ana Ref',phone:'410-555-0230',email:'ana.ref@example.com'})})).json() as any;
    expect(r).toMatchObject({ok:true,rewardCents:2500,referrers:[{name:'Ana Ref',phone:'+14105550230',referred:0,earnedCents:0}]});
    expect(r.referrers[0].link).toMatch(/^https:\/\/carejoys\.com\/refer\/[a-z2-9]{10}$/);
    path=r.referrers[0].link.replace('https://carejoys.com','');
    // The same person can't get a second link.
    expect((await call(url,{method:'POST',headers:agency,body:JSON.stringify({name:'Ana again',email:'ANA.REF@example.com'})})).status).toBe(400);
  });

  it('puts whoever applies through the link on the agency’s list as a referral',async()=>{
    const company=(await DB.prepare("SELECT company_name c FROM employer_leads WHERE id='emp1'").first()).c;
    const page=await call(path);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain(`Ana thinks you’d be a great fit at ${company}`);
    expect((await call('/refer/nosuchcode1')).status).toBe(404);
    expect((await apply(path,'first=Bea&phone=12')).status).toBe(400);
    const ok=await apply(path,'first=Bea&last=Referred&phone=410-555-0231&email=bea@example.com&zip=21201');
    expect(ok.status).toBe(200);
    expect(await ok.text()).toContain('Thanks, Bea.');
    const row=await DB.prepare("SELECT a.*,r.name AS referrer FROM agency_applicants a JOIN agency_referrers r ON r.id=a.referrer_id WHERE a.phone='+14105550231'").first();
    expect(row).toMatchObject({employer_id:'emp1',source:'referral',source_detail:'Referred by Ana Ref',stage:'new',zip:'21201',referrer:'Ana Ref'});
    expect(await DB.prepare("SELECT COUNT(*) n FROM caregivers WHERE email='bea@example.com'").first()).toMatchObject({n:0});
  });

  it('gives no credit for the referrer themselves or someone already on the list',async()=>{
    await apply(path,'first=Ana&phone=4105550230');
    expect(await DB.prepare("SELECT referrer_id,source_detail FROM agency_applicants WHERE phone='+14105550230'").first()).toMatchObject({referrer_id:null,source_detail:'Used their own referral link (Ana Ref)'});
    await call('/api/workspace/applicants',{method:'POST',headers:agency,body:JSON.stringify({csv:'Name,Email\nCal Known,cal@example.com\n',source:'csv'})});
    const again=await apply(path,'first=Cal&phone=410-555-0232&email=cal@example.com');
    expect(await again.text()).toContain('already on');
    expect(await DB.prepare("SELECT COUNT(*) n FROM agency_applicants WHERE employer_id='emp1' AND (phone='+14105550232' OR email='cal@example.com')").first()).toMatchObject({n:1});
    expect(await DB.prepare("SELECT referrer_id FROM agency_applicants WHERE email='cal@example.com'").first()).toMatchObject({referrer_id:null});
  });

  it('earns the reward on a screen with no knockout, and takes it back if one is added before approval',async()=>{
    const list=await (await call('/api/workspace/applicants',{headers:agency})).json() as any;
    const bea=list.applicants.find((a:any)=>a.phone==='+14105550231');
    expect(bea.referral).toMatchObject({referrerName:'Ana Ref',rewardStatus:''});
    const out=await (await call('/api/workspace/applicants/'+bea.id,{method:'POST',headers:agency,body:JSON.stringify({screeningAnswers:{car:'no'}})})).json() as any;
    expect(out.applicant.referral.rewardStatus).toBe('');
    const passed=await (await call('/api/workspace/applicants/'+bea.id,{method:'POST',headers:agency,body:JSON.stringify({screeningAnswers:{car:'yes'}})})).json() as any;
    expect(passed.applicant.referral).toMatchObject({rewardStatus:'earned',rewardCents:2500});
    const failed=await (await call('/api/workspace/applicants/'+bea.id,{method:'POST',headers:agency,body:JSON.stringify({screeningAnswers:{car:'no'}})})).json() as any;
    expect(failed.applicant.referral.rewardStatus).toBe('');
    await call('/api/workspace/applicants/'+bea.id,{method:'POST',headers:agency,body:JSON.stringify({screeningAnswers:{car:'yes'}})});
    const refs=await (await call(url,{headers:agency})).json() as any;
    expect(refs.referrers[0]).toMatchObject({referred:1,screened:1,earnedCents:2500,paidCents:0});
    expect(refs.rewards).toMatchObject([{applicantName:'Bea Referred',referrerName:'Ana Ref',status:'earned',amountCents:2500}]);
  });

  it('lets only a CareJoys admin approve and mark a reward paid',async()=>{
    const bea=(await DB.prepare("SELECT id FROM agency_applicants WHERE phone='+14105550231'").first()).id;
    const rewardUrl='/api/admin/applicant-referral-rewards/'+bea+'?employer=emp1';
    expect((await call(rewardUrl,{method:'POST',headers:agency,body:JSON.stringify({status:'approved'})})).status).toBe(401);
    expect((await call(rewardUrl,{method:'POST',headers:admin,body:JSON.stringify({status:'paid'})},ops)).status).toBe(400);
    const approved=await (await call(rewardUrl,{method:'POST',headers:admin,body:JSON.stringify({status:'approved'})},ops)).json() as any;
    expect(approved.rewards[0]).toMatchObject({status:'approved',approvedBy:'admin'});
    // Once approved, a later knockout no longer takes it back.
    await call('/api/workspace/applicants/'+bea,{method:'POST',headers:agency,body:JSON.stringify({screeningAnswers:{car:'no'}})});
    const paid=await (await call(rewardUrl,{method:'POST',headers:admin,body:JSON.stringify({status:'paid'})},ops)).json() as any;
    expect(paid.rewards[0]).toMatchObject({status:'paid'});
    expect(paid.rewards[0].paidAt).not.toBe('');
    expect(paid.referrers[0]).toMatchObject({earnedCents:2500,paidCents:2500});
    expect((await call('/api/admin/applicant-referral-rewards/nope?employer=emp1',{method:'POST',headers:admin,body:JSON.stringify({status:'approved'})},ops)).status).toBe(404);
  });
});

describe('replies to hello@',()=>{
  const forwards:string[]=[];
  const message=(raw:string,from='lead@facility.test')=>({from,to:'hello@carejoys.com',headers:new Headers(),
    raw:new Response(raw).body!,forward:async(to:string)=>{forwards.push(to)}});
  const raw=(from:string,subject:string,body:string,id:string)=>`From: ${from}\r\nSubject: ${subject}\r\nMessage-ID: <${id}>\r\nContent-Type: text/plain\r\n\r\n${body}`;
  const admin={authorization:'Bearer ops'};
  beforeAll(async()=>{
    await DB.prepare("INSERT OR IGNORE INTO agency_organizations(id,organization_key,canonical_name,primary_email) VALUES ('org-reply','org-reply','Sunrise Manor','Lead@Facility.test')").run();
  });

  it('forwards, records the reply against its lead, and stores a retry once',async()=>{
    const m=raw('Dana <lead@facility.test>','Re: Hiring help','Yes, call me Thursday.\n\nOn Mon CareJoys wrote:\n> hi','r1@facility.test');
    await worker.email(message(m) as any,env({ADMIN_EMAILS:'owner@gmail.test'}));
    await worker.email(message(m) as any,env({ADMIN_EMAILS:'owner@gmail.test'}));
    expect(forwards).toEqual(['owner@gmail.test','owner@gmail.test']);
    const body=await (await call('/api/admin/inbox?kind=reply',{headers:admin},{ADMIN_TOKEN:'ops'})).json() as any;
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0]).toMatchObject({fromEmail:'lead@facility.test',fromName:'Dana',kind:'reply',status:'new',snippet:'Yes, call me Thursday.',forwarded:true,lead:{type:'agency',id:'org-reply',name:'Sunrise Manor'}});
    expect(body.counts.reply).toEqual({total:1,open:1});
    const done=await call('/api/admin/inbox/'+body.messages[0].id,{method:'POST',headers:{...admin,'content-type':'application/json',origin:'https://carejoys.com'},body:JSON.stringify({status:'handled'})},{ADMIN_TOKEN:'ops'});
    expect(done.status).toBe(200);
    expect((await call('/api/admin/inbox',{headers:{}})).status).toBe(401);
  });

  it('suppresses unsubscribes and hard bounces, and skips its own mail',async()=>{
    await worker.email(message(raw('stop@facility.test','Re: CareJoys','Please take me off this list','u1@facility.test'),'stop@facility.test') as any,env({ADMIN_EMAILS:'owner@gmail.test'}));
    const bounce='From: MAILER-DAEMON@mx.test\r\nSubject: Undeliverable\r\nMessage-ID: <b1@mx.test>\r\nContent-Type: multipart/report; report-type=delivery-status; boundary=x\r\n\r\n--x\r\nContent-Type: message/delivery-status\r\n\r\nFinal-Recipient: rfc822; gone@facility.test\r\nStatus: 5.1.1\r\n--x--';
    await worker.email(message(bounce,'MAILER-DAEMON@mx.test') as any,env({ADMIN_EMAILS:'owner@gmail.test'}));
    await worker.email(message(raw('CareJoys <hello@carejoys.com>','Copy','outreach copy','own1@carejoys.com'),'hello@carejoys.com') as any,env({ADMIN_EMAILS:'owner@gmail.test'}));
    const rows=(await DB.prepare("SELECT email,reason FROM email_suppressions WHERE email IN ('stop@facility.test','gone@facility.test') ORDER BY email").all()).results;
    expect(rows).toEqual([{email:'gone@facility.test',reason:'bounce'},{email:'stop@facility.test',reason:'unsubscribe'}]);
    expect((await DB.prepare("SELECT COUNT(*) AS n FROM email_messages WHERE from_email='hello@carejoys.com'").first() as any).n).toBe(0);
  });

  it('keeps a "Stop" reply out of the forwarded inbox and suppresses the agency address the outreach went to',async()=>{
    await DB.prepare("INSERT OR IGNORE INTO agency_organizations(id,organization_key,canonical_name,primary_email) VALUES ('org-stop','org-stop','Stay Home','Info@StayHome.test')").run();
    await DB.prepare("INSERT OR IGNORE INTO agency_organizations(id,organization_key,canonical_name,primary_email) VALUES ('org-other','org-other','Other','info@other.test')").run();
    forwards.length=0;
    const stop=raw('Aimee <aimee@stayhome.test>','Re: Quick question','Stop\n\nAimee Hamrick, Program Coordinator\n\nOn Fri Rebecca wrote:\n> reply yes','s1@stayhome.test');
    await worker.email(message(stop,'aimee@stayhome.test') as any,env({ADMIN_EMAILS:'owner@gmail.test'}));
    expect(forwards).toEqual([]);
    const rows=(await DB.prepare("SELECT email FROM email_suppressions WHERE email IN ('aimee@stayhome.test','info@stayhome.test','info@other.test') ORDER BY email").all()).results;
    expect(rows).toEqual([{email:'aimee@stayhome.test'},{email:'info@stayhome.test'}]);
    expect((await DB.prepare("SELECT kind,forwarded FROM email_messages WHERE message_id='<s1@stayhome.test>'").first() as any)).toEqual({kind:'unsubscribe',forwarded:0});
    // A free-mail sender only suppresses itself, never everyone at gmail.
    await worker.email(message(raw('pat@gmail.com','Re: hi','unsubscribe','s2@gmail.com'),'pat@gmail.com') as any,env({ADMIN_EMAILS:'owner@gmail.test'}));
    expect((await DB.prepare("SELECT COUNT(*) AS n FROM email_suppressions WHERE email LIKE '%@gmail.com'").first() as any).n).toBe(1);
    // Ordinary replies still forward.
    await worker.email(message(raw('aimee@stayhome.test','Re: hi','Actually, tell me more','s3@stayhome.test'),'aimee@stayhome.test') as any,env({ADMIN_EMAILS:'owner@gmail.test'}));
    expect(forwards).toEqual(['owner@gmail.test']);
  });

  it('still records the message when forwarding fails',async()=>{
    const failing={...message(raw('x@facility.test','Hi','Hello','f1@facility.test'),'x@facility.test'),forward:async()=>{throw new Error('unverified')}};
    await worker.email(failing as any,env({ADMIN_EMAILS:'owner@gmail.test'}));
    expect((await DB.prepare("SELECT forwarded FROM email_messages WHERE message_id='<f1@facility.test>'").first() as any).forwarded).toBe(0);
  });

  it('alerts the admins about a new hire form, with Reply going to the lead',async()=>{
    sent.length=0;
    const res=await call('/api/employers',{method:'POST',headers:{'content-type':'application/json',origin:'https://carejoys.com'},
      body:JSON.stringify({companyName:'Bright Home Care',contactName:'Sam',email:'sam@bright.test',zip:'21201',rolesNeeded:'CNA',phone:'410-555-0100'})},{ADMIN_EMAILS:'owner@gmail.test'});
    expect(res.status).toBe(201);
    const alert=sent.find(m=>m.subject==='New hire form: Bright Home Care') as any;
    expect(alert.replyTo).toBe('sam@bright.test');
    expect(alert.to).toContain('owner@gmail.test');
    expect(alert.text).toContain('Phone: 410-555-0100');
  });
});

describe('operated service',()=>{
  const OP_SESSION='op-session-token';
  const agency={cookie:'cj_session='+OP_SESSION,'content-type':'application/json',origin:'https://carejoys.com'};
  const forwards:string[]=[];
  const mail=(to:string,raw:string)=>({from:'alert@indeed.com',to,headers:new Headers(),raw:new Response(raw).body!,forward:async(t:string)=>{forwards.push(t)}});
  let address='';
  beforeAll(async()=>{
    await DB.prepare("INSERT INTO employer_leads(id,company_name,contact_name,email,zip,roles_needed,status,approved_at) VALUES ('emp-op','Harbor Home Care','Lee Owner','owner@harbor.test','21201','CNA','active',CURRENT_TIMESTAMP)").run();
    await DB.prepare("INSERT INTO employer_sessions(id,employer_id,session_hash,expires_at) VALUES ('s-op','emp-op',?,?)").bind(await sha256Hex(OP_SESSION),new Date(Date.now()+86400000).toISOString()).run();
  });

  it('gives each agency a forwarding address and reads a job board email into its list without forwarding it',async()=>{
    const first=await (await call('/api/workspace/applicants',{headers:agency})).json() as any;
    address=first.intake.address;
    expect(address).toMatch(/^apply\+[a-z0-9]{10}@carejoys\.com$/);
    expect((await (await call('/api/workspace/applicants',{headers:agency})).json() as any).intake.address).toBe(address);
    const raw=`From: Indeed <alert@indeed.com>\r\nSubject: Maria Santos applied to your Caregiver job\r\nMessage-ID: <in1@indeed.com>\r\nDate: ${new Date().toUTCString()}\r\nContent-Type: text/plain\r\n\r\nNew applicant\r\nName: Maria Santos\r\nPhone: (410) 555-0177\r\nEmail: maria.s@example.com\r\nLocation: Towson, MD 21204\r\n`;
    await worker.email(mail(address.toUpperCase(),raw) as any,env({ADMIN_EMAILS:'owner@gmail.test'}));
    await worker.email(mail(address,raw.replace('in1@','in2@')) as any,env({ADMIN_EMAILS:'owner@gmail.test'}));
    expect(forwards).toEqual([]);
    const list=await (await call('/api/workspace/applicants',{headers:agency})).json() as any;
    expect(list.applicants).toHaveLength(1);
    expect(list.applicants[0]).toMatchObject({firstName:'Maria',lastName:'Santos',phone:'+14105550177',email:'maria.s@example.com',city:'Towson',state:'MD',zip:'21204',
      position:'Caregiver',source:'indeed-forward',sourceDetail:'Indeed email',stage:'new'});
    expect(list.intake.lastReceivedAt).not.toBe('');
    expect(list.week).toMatchObject({received:1,live:1,waiting:1,contacted:0});
  });

  it('forwards and shows a message it cannot read, and ignores unknown addresses',async()=>{
    const confirm='From: Gmail Team <forwarding-noreply@google.com>\r\nSubject: Gmail Forwarding Confirmation\r\nMessage-ID: <g1@google.com>\r\nContent-Type: text/plain\r\n\r\nConfirmation code: 123456789\r\n';
    await worker.email(mail(address,confirm) as any,env({ADMIN_EMAILS:'owner@gmail.test'}));
    await worker.email(mail('apply+nosuchagency@carejoys.com',confirm.replace('g1@','g2@')) as any,env({ADMIN_EMAILS:'owner@gmail.test'}));
    expect(forwards).toEqual(['owner@gmail.test','owner@gmail.test']);
    const list=await (await call('/api/workspace/applicants',{headers:agency})).json() as any;
    expect(list.applicants).toHaveLength(1);
    expect(list.intake.unread).toMatchObject({subject:'Gmail Forwarding Confirmation'});
    expect(list.intake.unread.snippet).toContain('123456789');
    const inbox=await (await call('/api/admin/inbox?kind=intake',{headers:{authorization:'Bearer ops'}},{ADMIN_TOKEN:'ops'})).json() as any;
    expect(inbox.counts.intake).toEqual({total:4,open:2});
  });

  it('books an outside applicant through a link, moves it, and cancels it',async()=>{
    const maria=(await DB.prepare("SELECT id FROM agency_applicants WHERE employer_id='emp-op'").first()).id;
    const link='/api/workspace/applicants/'+maria+'/booking-link';
    const none=await (await call(link,{method:'POST',headers:agency,body:'{}'})).json() as any;
    expect(none).toMatchObject({ok:true,slots:0});
    await DB.prepare("INSERT INTO openings(id,employer_id,title,role,zip,status) VALUES ('op-open','emp-op','Caregiver','Caregiver','21201','open')").run();
    const at=(h:number)=>new Date(Math.ceil(Date.now()/3600000)*3600000+h*3600000).toISOString();
    for(const [id,h] of [['op-s1',26],['op-s2',50]] as const)
      await DB.prepare("INSERT INTO interview_slots(id,opening_id,employer_id,starts_at,duration_minutes,timezone,location) VALUES (?,'op-open','emp-op',?,30,'America/New_York','12 Main St')").bind(id,at(h)).run();
    sent.length=0;
    const r=await (await call(link,{method:'POST',headers:agency,body:JSON.stringify({send:true})})).json() as any;
    expect(r).toMatchObject({ok:true,slots:2,emailed:true});
    const token=r.url.split('/book/')[1];
    expect(sent.find(m=>m.to==='maria.s@example.com')?.subject).toBe('Harbor Home Care: choose your interview time');
    // The earlier link stopped working when this one was made.
    expect((await call('/api/applicant-booking?token='+none.url.split('/book/')[1])).status).toBe(404);
    const view=await (await call('/api/applicant-booking?token='+token)).json() as any;
    expect(view).toMatchObject({company:'Harbor Home Care',firstName:'Maria',booked:null});
    expect(view.slots.map((s:any)=>s.id)).toEqual(['op-s1','op-s2']);
    const post=(body:object)=>call('/api/applicant-booking',{method:'POST',headers:{'content-type':'application/json',origin:'https://carejoys.com'},body:JSON.stringify({token,...body})});
    sent.length=0;
    expect((await post({slotId:'op-s1'})).status).toBe(200);
    expect(sent.map(m=>m.to).sort()).toEqual(['maria.s@example.com','owner@harbor.test']);
    expect((sent[0] as any).attachments[0].filename).toBe('carejoys-interview.ics');
    let row=await DB.prepare("SELECT stage,interview_slot_id,interview_at,interview_booked_at,first_contact_at FROM agency_applicants WHERE id=?").bind(maria).first();
    expect(row).toMatchObject({stage:'interview',interview_slot_id:'op-s1'});
    expect(row.interview_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(row.interview_booked_at).not.toBeNull();
    expect((await post({slotId:'op-s2'})).status).toBe(200);
    const slots=(await DB.prepare("SELECT id,status,booked_applicant_id FROM interview_slots WHERE opening_id='op-open' ORDER BY id").all()).results;
    expect(slots).toEqual([{id:'op-s1',status:'available',booked_applicant_id:null},{id:'op-s2',status:'booked',booked_applicant_id:maria}]);
    const week=(await (await call('/api/workspace/applicants',{headers:agency})).json() as any).week;
    expect(week).toMatchObject({received:1,contacted:1,withinTarget:1,booked:1,waiting:0});
    expect((await post({action:'cancel'})).status).toBe(200);
    row=await DB.prepare("SELECT interview_slot_id,interview_booked_at FROM agency_applicants WHERE id=?").bind(maria).first();
    expect(row).toEqual({interview_slot_id:null,interview_booked_at:null});
    expect((await DB.prepare("SELECT status FROM interview_slots WHERE id='op-s2'").first()).status).toBe('available');
    expect((await post({slotId:'nope'})).status).toBe(400);
  });

  it('sends the Monday report once, only to agencies with applicants',async()=>{
    const { sendWeeklyApplicantReports }=await import('../src/applicantReport');
    // The next Monday at the digest hour, so this week's applicants are inside its seven days.
    const monday=new Date();monday.setUTCHours(11,0,0,0);
    while(monday.getUTCDay()!==1||monday.getTime()<=Date.now())monday.setUTCDate(monday.getUTCDate()+1);
    sent.length=0;
    expect(await sendWeeklyApplicantReports(env(),new Date(monday.getTime()+86400000))).toEqual({sent:0});
    await sendWeeklyApplicantReports(env(),monday);
    await sendWeeklyApplicantReports(env(),monday);
    const reports=sent.filter(m=>m.subject.startsWith('Harbor Home Care last week'));
    expect(reports).toHaveLength(1);
    expect(reports[0].to).toBe('owner@harbor.test');
    expect((reports[0] as any).text).toContain('New applicants: 1');
  });

  it('starts the applicant follow-up plan as its own Stripe price and records it',async()=>{
    const fetched:Array<{url:string;body:string}>=[];
    const realFetch=globalThis.fetch;
    globalThis.fetch=(async(url:any,init:any)=>{fetched.push({url:String(url),body:String(init?.body||'')});return new Response(JSON.stringify({url:'https://checkout.stripe.test/s'}),{status:200})}) as any;
    try{
      const stripe={STRIPE_SECRET_KEY:'sk_test',STRIPE_PRICE_ID_OPERATED:'price_operated'};
      const status=await (await call('/api/billing',{headers:agency},stripe)).json() as any;
      expect(status.operated).toEqual({available:true,subscribed:false});
      expect((await call('/api/billing/checkout',{method:'POST',headers:agency,body:JSON.stringify({plan:'operated'})},stripe)).status).toBe(200);
      const params=new URLSearchParams(fetched[0].body);
      expect(params.get('line_items[0][price]')).toBe('price_operated');
      expect(params.get('subscription_data[metadata][plan]')).toBe('operated');
      // Without the introductions price, only the operated plan can be bought.
      expect((await call('/api/billing/checkout',{method:'POST',headers:agency,body:'{}'},stripe)).status).toBe(503);
    }finally{globalThis.fetch=realFetch}
  });
});

describe('job listings posted as CareJoys job pages',()=>{
  const ws={cookie:'cj_session=post-session','content-type':'application/json',origin:'https://carejoys.com'};
  const opening=(body:object)=>call('/api/openings',{method:'POST',headers:ws,body:JSON.stringify(body)});
  const patch=(id:string,body:object)=>call('/api/openings/'+id,{method:'PATCH',headers:ws,body:JSON.stringify(body)});
  const page=async(jobId:string)=>call('/api/public/caregiver-jobs/'+encodeURIComponent(jobId));
  let openingId='',jobId='';

  beforeAll(async()=>{
    await DB.prepare("INSERT OR IGNORE INTO employer_leads(id,company_name,contact_name,email,zip,roles_needed,status,approved_at) VALUES ('emp-post','Indeed Only Care','Lee','lee@indeedonly.test','21201','CNA','active',CURRENT_TIMESTAMP)").run();
    await DB.prepare("INSERT OR IGNORE INTO employer_sessions(id,employer_id,session_hash,expires_at) VALUES ('s-post','emp-post',?,?)").bind(await sha256Hex('post-session'),new Date(Date.now()+86400000).toISOString()).run();
  });

  it('posts nothing until the agency has claimed its profile',async()=>{
    const r=await (await opening({role:'CNA',zip:'21201',title:'Unclaimed CNA'})).json() as any;
    expect(r).toMatchObject({ok:true,jobId:null});
    expect(await DB.prepare("SELECT COUNT(*) n FROM caregiver_jobs WHERE source_provider='carejoys' AND source_job_id=?").bind(r.id).first()).toMatchObject({n:0});
    openingId=r.id;
  });

  it('puts a claimed agency’s listings up as job pages, including ones made before the claim',async()=>{
    await DB.prepare("INSERT OR REPLACE INTO agency_organizations(id,organization_key,canonical_name,primary_domain,primary_email,city,state,zip,is_active,claimed_employer_id) VALUES ('org-post','org-post','Indeed Only Care','indeedonly.test','lee@indeedonly.test','Baltimore','MD','21201',1,'emp-post')").run();
    // Editing the earlier listing posts it now that the agency is claimed.
    await patch(openingId,{role:'CNA',zip:'21201',title:'Unclaimed CNA'});
    const r=await (await opening({role:'GNA',zip:'21201',title:'GNA weekends',payMin:18,payMax:21,shifts:'weekends',transportationRequired:true,requirements:'One year of home care.'})).json() as any;
    expect(r.jobId).toBeTruthy();
    jobId=r.jobId;
    const job=(await (await page(jobId)).json() as any).job;
    expect(job).toMatchObject({title:'GNA weekends',employerName:'Indeed Only Care',city:'Baltimore',state:'MD',payMin:18,payMax:21,payPeriod:'hour',postedOnCareJoys:true,employerOnCareJoys:true,applyForMe:false});
    expect(job.sourceUrl).toBe('https://carejoys.com/jobs/'+jobId);
    expect(job.description).toContain('Indeed Only Care is hiring a GNA in Baltimore, MD.');
    expect(job.description).toContain('• Pay: $18–$21/hr');
    expect(job.description).toContain('• A reliable car is required.');
    const seo=await (await call('/jobs/'+jobId,{},htmlAssets)).text();
    expect(seo).toContain('Posted on CareJoys by Indeed Only Care');
    expect(seo).not.toContain('original employer listing');
    const ws1=await (await call('/api/workspace',{headers:ws})).json() as any;
    expect(ws1.openings.find((o:any)=>o.id===r.id).job_page_id).toBe(jobId);
    expect(ws1.openings.find((o:any)=>o.id===openingId).job_page_id).toBeTruthy();
    // Not listed again among the jobs CareJoys found on the agency's careers page.
    expect(((await (await call('/api/agency/jobs',{headers:ws})).json()) as any).jobs).toEqual([]);
  });

  it('sends applications to the agency’s Candidates',async()=>{
    sent.length=0;
    await post('/api/login/request',{email:'dc@example.com'});
    const token=decodeURIComponent(sent[0].html!.match(/signin\?token=([^"&]+)/)![1]);
    const verified=await post('/api/login/verify',{token});
    const cookie='__Host-cj_account='+decodeURIComponent((verified.headers.get('set-cookie')||'').match(/__Host-cj_account=([^;]+)/)![1]);
    const applied=await (await post('/api/me/apply/'+jobId,{},{cookie})).json() as any;
    expect(applied).toMatchObject({status:'applied',employerOnCareJoys:true});
    expect(await DB.prepare("SELECT source,caregiver_job_id FROM agency_interests WHERE organization_id='org-post' AND caregiver_id='dc'").first()).toEqual({source:'job_apply',caregiver_job_id:jobId});
  });

  it('keeps the page in step with the listing: edits, closing, reopening, and a page the agency hid',async()=>{
    const id=(await DB.prepare("SELECT source_job_id s FROM caregiver_jobs WHERE id=?").bind(jobId).first() as any).s;
    await patch(id,{role:'GNA',zip:'21201',title:'GNA weekend days',payMin:19,payMax:22});
    expect(((await (await page(jobId)).json()) as any).job).toMatchObject({title:'GNA weekend days',payMin:19});
    await patch(id,{status:'closed'});
    expect((await page(jobId)).status).toBe(404);
    await patch(id,{status:'open'});
    expect((await page(jobId)).status).toBe(200);
    await DB.prepare("UPDATE caregiver_jobs SET is_published=0,publication_reason='hidden_by_employer' WHERE id=?").bind(jobId).run();
    await patch(id,{role:'GNA',zip:'21201',title:'GNA weekend days'});
    expect((await page(jobId)).status).toBe(404);
    await DB.prepare("UPDATE caregiver_jobs SET is_published=1,publication_reason='posted_on_carejoys' WHERE id=?").bind(jobId).run();
  });

  it('stays fresh for Google while the listing is open',async()=>{
    await DB.prepare("UPDATE caregiver_jobs SET last_seen_at=datetime('now','-30 days'),last_checked_at=datetime('now','-30 days') WHERE id=?").bind(jobId).run();
    await refreshPostedJobs(DB as any);
    const row=await DB.prepare("SELECT status,is_published,last_checked_at FROM caregiver_jobs WHERE id=?").bind(jobId).first() as any;
    expect(row).toMatchObject({status:'current',is_published:1});
    expect(Date.parse(row.last_checked_at.replace(' ','T')+'Z')).toBeGreaterThan(Date.now()-3600000);
  });
});

describe('agency email recheck', ()=>{
  it('reads the Contact page of agencies crawled without an email, once each', async()=>{
    await DB.prepare("INSERT INTO agency_organizations(id,organization_key,canonical_name,primary_domain,primary_website,city,state,is_active,last_enriched_at) VALUES ('org-mail','org-mail','Mail Care','mailcare.test','https://mailcare.test/','Las Vegas','NV',1,'2026-10-01 00:00:00')").run();
    const original=globalThis.fetch;
    const seen:string[]=[];
    globalThis.fetch=(async(url:string)=>{
      seen.push(String(url));
      const html=String(url).endsWith('/contact')?'<p>Email us: office@mailcare.test</p>':'<a href="/contact">Contact</a>';
      return new Response(html,{headers:{'content-type':'text/html'}});
    }) as any;
    try{
      await recheckAgencyEmailBatch(env(),5);
      const looks=seen.filter(u=>u.includes('mailcare.test')).length;
      await recheckAgencyEmailBatch(env(),5);
      expect(seen.filter(u=>u.includes('mailcare.test')).length).toBe(looks);
    }finally{globalThis.fetch=original}
    expect(seen).toContain('https://mailcare.test/contact');
    expect(await DB.prepare("SELECT primary_email FROM agency_organizations WHERE id='org-mail'").first()).toEqual({primary_email:'office@mailcare.test'});
  });
});

describe('first job nudge', ()=>{
  it('emails a claimed agency with no jobs once, two days after the claim, only when switched on', async()=>{
    await DB.prepare("INSERT INTO employer_leads(id,company_name,contact_name,email,zip,roles_needed,status,approved_at) VALUES ('emp-nudge','Maple Care LLC','Jo Lee','jo@maplecare.test','21204','CNA','active',CURRENT_TIMESTAMP)").run();
    await DB.prepare("INSERT INTO agency_organizations(id,organization_key,canonical_name,city,state,is_active,claimed_employer_id) VALUES ('org-nudge','org-nudge','Maple Care LLC','Towson','MD',1,'emp-nudge')").run();
    await DB.prepare("INSERT INTO agency_outreach_events(id,organization_id,event_type,created_at) VALUES ('ev-nudge','org-nudge','agency_claim_verified',datetime('now','-3 days'))").run();
    expect(await sendFirstJobNudges(env())).toEqual({sent:0,failed:0});
    // A claim before the start date was pitched already.
    expect(await sendFirstJobNudges(env({FIRST_JOB_NUDGE_ENABLED:'true',FIRST_JOB_NUDGE_SINCE:new Date().toISOString().slice(0,10)}))).toEqual({sent:0,failed:0});
    const before=sent.length;
    expect(await sendFirstJobNudges(env({FIRST_JOB_NUDGE_ENABLED:'true'}))).toEqual({sent:1,failed:0});
    const mail=sent[before];
    expect(mail.to).toBe('jo@maplecare.test');
    expect(mail.subject).toBe('Post your first caregiver job on CareJoys');
    expect(mail.html).toContain('Hi Jo,');
    expect(mail.html).toContain('Maple Care on CareJoys');
    expect(mail.html).toContain('Unsubscribe');
    expect(mail.headers?.['List-Unsubscribe']).toBeTruthy();
    expect(await sendFirstJobNudges(env({FIRST_JOB_NUDGE_ENABLED:'true'}))).toEqual({sent:0,failed:0});
  });
});

describe('careers page lookup order', ()=>{
  it('takes one agency per short city in turn before the rest, and pays per search', async()=>{
    const orgs:[string,string,string][]=[['cl-sd1','San Diego','CA'],['cl-sd2','San Diego','CA'],['cl-bak','Bakersfield','CA'],['cl-bk','Brooklyn','NY'],['cl-balt','Baltimore','MD'],['cl-else','Boise','ID']];
    for(const [id,city,state] of orgs){
      await DB.prepare("INSERT INTO agency_organizations(id,organization_key,canonical_name,city,state,is_active,primary_website,primary_domain) VALUES (?,?,?,?,?,1,?,?)").bind(id,id,id+' Home Care',city,state,`https://${id}.test/`,`${id}.test`).run();
      await DB.prepare("INSERT INTO agency_job_scan_state(organization_id,last_status) VALUES (?,'no_job_board_found')").bind(id).run();
    }
    const asked:string[]=[];
    const realFetch=globalThis.fetch;
    globalThis.fetch=(async(_url:any,init:any)=>{
      asked.push(JSON.parse(init.body)[0].keyword);
      return new Response(JSON.stringify({tasks:[{status_code:20000,cost:0.002,result:[{items:[]}]}]}),{status:200});
    }) as any;
    try{
      const run=await lookupCareersPagesBatch(env({DATAFORSEO_LOGIN:'u',DATAFORSEO_PASSWORD:'p',CAREERS_LOOKUP_DAILY_USD:'1'}),4);
      expect(run).toEqual({searched:4,found:0,spent:0.008});
    }finally{globalThis.fetch=realFetch}
    // San Diego, Bakersfield and New York (Brooklyn) each get one before San Diego's second; Baltimore and Boise wait.
    expect(asked.map(q=>q.split(' ')[0])).toEqual(['cl-sd1','cl-bak','cl-bk','cl-sd2']);
    const rows=(await DB.prepare("SELECT organization_id FROM careers_lookups WHERE organization_id LIKE 'cl-%' ORDER BY organization_id").all()).results.map((r:any)=>r.organization_id);
    expect(rows).toEqual(['cl-bak','cl-bk','cl-sd1','cl-sd2']);
  });
  it('the one-time run takes target cities only, on its own budget, and ends when the budget is spent', async()=>{
    for(const [id,city,state] of [['cl-phx','Phoenix','AZ'],['cl-chi','Chicago','IL'],['cl-sea','Seattle','WA']]){
      await DB.prepare("INSERT INTO agency_organizations(id,organization_key,canonical_name,city,state,is_active) VALUES (?,?,?,?,?,1)").bind(id,id,id+' Home Care',city,state).run();
      await DB.prepare("INSERT INTO agency_job_scan_state(organization_id,last_status) VALUES (?,'fetch_failed')").bind(id).run();
    }
    const asked:string[]=[];
    const realFetch=globalThis.fetch;
    globalThis.fetch=(async(_url:any,init:any)=>{
      asked.push(JSON.parse(init.body)[0].keyword.split(' ')[0]);
      return new Response(JSON.stringify({tasks:[{status_code:20000,cost:0.002,result:[{items:[]}]}]}),{status:200});
    }) as any;
    try{
      const boost=env({DATAFORSEO_LOGIN:'u',DATAFORSEO_PASSWORD:'p',CAREERS_LOOKUP_DAILY_USD:'1',CAREERS_LOOKUP_BOOST_USD:'0.004'});
      expect(await lookupCareersPagesBoost(boost,10)).toEqual({searched:2,found:0,spent:0.004});
      // Baltimore and Boise are not target cities; the budget is spent, so the next run does nothing.
      expect(asked).toEqual(['cl-phx','cl-chi']);
      expect(await lookupCareersPagesBoost(boost,10)).toEqual({searched:0,found:0,spent:0.004});
      expect(await lookupCareersPagesBoost(env({DATAFORSEO_LOGIN:'u',DATAFORSEO_PASSWORD:'p'}),10)).toEqual({searched:0,found:0,spent:0});
    }finally{globalThis.fetch=realFetch}
    const budgets=(await DB.prepare("SELECT budget,COUNT(*) AS n,ROUND(SUM(cost),3) AS spent FROM careers_lookups WHERE organization_id LIKE 'cl-%' GROUP BY budget ORDER BY budget").all()).results;
    expect(budgets).toEqual([{budget:'boost',n:2,spent:0.004},{budget:'daily',n:4,spent:0.008}]);
  });
});

describe('public caregiver directory', ()=>{
  const headers={'content-type':'application/json'};
  const listed=(id:string,zip:string,extra:Record<string,unknown>={})=>addCaregiver(id,zip,{public_listing:1,public_listing_at:recent,bio:'Hospice and dementia care. Text 410-555-0100.',desired_wage:'$18+/hr',certifications:'CPR',...extra});
  beforeAll(async()=>{
    await listed('dir-1','21201');
    // Opted in but not shown: not looking, unverified, confirmed too long ago, no yes at all, a test account, and a ZIP nobody knows.
    await listed('dir-notlooking','21201',{work_status:'not_looking'});
    await listed('dir-unverified','21201',{auth0_email_verified:0});
    await listed('dir-stale','21201',{last_confirmed_at:new Date(Date.now()-40*86400000).toISOString()});
    await addCaregiver('dir-noyes','21201');
    await listed('dir-test','21201',{is_test:1});
    await listed('dir-nozip','00000');
    await listed('dir-tx','75201');
  });
  it('lists only caregivers who said yes, verified, and confirmed within 30 days, and shows no contact details', async()=>{
    const api=await (await call('/api/public/caregivers?state=MD&city=baltimore')).json() as any;
    expect(api.cards.map((c:any)=>c.id)).toEqual(['dir-1']);
    expect(api.cards[0].name).toBe('dir-1 T.');
    expect(api.cards[0].zipArea).toBe('212xx');
    expect(api.cards[0].bio).not.toContain('410-555');
    expect(JSON.stringify(api.cards[0])).not.toContain('example.com');
    const national=await (await call('/api/public/caregivers')).json() as any;
    expect(national.states.map((s:any)=>[s.code,s.count])).toEqual([['MD',1],['TX',1]]);
  });
  it('renders the pages, noindex until five are listed, with a 302 for an empty city and 410 after a listing ends', async()=>{
    const city=await (await call('/caregivers/maryland/baltimore',{},htmlAssets)).text();
    expect(city).toContain('<h1>Caregivers looking for work in Baltimore, MD</h1>');
    expect(city).toContain('<a href="/caregiver/dir-1">dir-1 T.</a> · Verified email · Confirmed ');
    expect(city).toContain('<meta name="robots" content="noindex,follow"');
    expect(city).toContain('<link rel="canonical" href="https://carejoys.com/caregivers/maryland/baltimore" />');
    expect(city).not.toContain('dir-1@example.com');
    const state=await (await call('/caregivers/maryland',{},htmlAssets)).text();
    expect(state).toContain('<a href="/caregivers/maryland/baltimore">Caregivers in Baltimore</a> (1)');
    expect((await call('/caregivers/maryland/nowhere',{},htmlAssets)).headers.get('location')).toBe('/caregivers/maryland');
    expect((await call('/caregivers/md',{},htmlAssets)).status).toBe(404);
    const profile=await call('/caregiver/dir-1',{},htmlAssets);
    expect(profile.status).toBe(200);
    expect(await profile.text()).toContain('<meta name="robots" content="noindex,follow"');
    // Five listed caregivers make the city page worth indexing and put it in the sitemap.
    for(const n of [2,3,4,5])await listed('dir-'+n,'21201');
    const indexed=await (await call('/caregivers/maryland/baltimore',{},htmlAssets)).text();
    expect(indexed).toContain('5 caregivers in Baltimore, MD listed in the last 30 days.');
    expect(indexed).not.toContain('noindex');
    const sitemap=await (await call('/sitemaps/locations.xml')).text();
    expect(sitemap).toContain('https://carejoys.com/caregivers/maryland/baltimore<');
    expect(sitemap).toContain('https://carejoys.com/caregivers/maryland<');
    expect(sitemap).not.toContain('/caregivers/texas<');
    // The caregiver turns the listing off: their page answers 410, and their old card is gone.
    await DB.prepare("UPDATE caregivers SET public_listing=0 WHERE id='dir-1'").run();
    expect((await call('/caregiver/dir-1',{},htmlAssets)).status).toBe(410);
    expect((await call('/api/public/caregivers/dir-1')).status).toBe(410);
    expect((await call('/api/public/caregivers/dir-never')).status).toBe(404);
    expect((await call('/api/public/caregivers/dir-noyes/photo')).status).toBe(404);
  });
  it('records the signup choice and lets the caregiver change it from the dashboard', async()=>{
    const no=await call('/api/caregiver-resume',{method:'POST',headers,body:JSON.stringify({firstName:'Opt',lastName:'Out',email:'opt-out@example.com',zip:'21201',role:'CNA',publicListing:false})});
    expect(no.status).toBe(201);
    const yes=await call('/api/caregiver-resume',{method:'POST',headers,body:JSON.stringify({firstName:'Opt',lastName:'In',email:'opt-in@example.com',zip:'21201',role:'CNA',publicListing:true})});
    const {id}=await yes.json() as any;
    expect(await DB.prepare("SELECT public_listing,public_listing_source FROM caregivers WHERE email='opt-out@example.com'").first()).toEqual({public_listing:0,public_listing_source:'caregiver_signup'});
    expect(await DB.prepare('SELECT public_listing FROM caregivers WHERE id=?').bind(id).first()).toEqual({public_listing:1});
    // Signed in by email link; the API explains why a yes isn't shown yet.
    sent.length=0;
    await call('/api/login/request',{method:'POST',headers,body:JSON.stringify({email:'opt-in@example.com'})});
    const token=decodeURIComponent(sent.at(-1)!.html!.match(/token=([^"&]+)/)![1]);
    const verify=await call('/api/login/verify',{method:'POST',headers,body:JSON.stringify({token})});
    const cookie=(verify.headers.get('set-cookie')||'').match(/__Host-cj_account=[^;]+/)![0];
    // Signing in verified the email and confirmed they are looking, so the yes now shows.
    const shown=await (await call('/api/me/public-listing',{headers:{cookie}})).json() as any;
    expect(shown.optedIn).toBe(true);
    expect(shown.listed).toBe(true);
    expect(shown.pageUrl).toBe('/caregivers/maryland/baltimore');
    expect(shown.card.name).toBe('Opt I.');
    // Saying they are not looking takes the card down and the API says why.
    await DB.prepare("UPDATE caregivers SET work_status='not_looking' WHERE id=?").bind(id).run();
    const hidden=await (await call('/api/me/public-listing',{headers:{cookie}})).json() as any;
    expect(hidden.listed).toBe(false);
    expect(hidden.reasons.join(' ')).toContain('not looking');
    const off=await (await call('/api/me/public-listing',{method:'POST',headers:{cookie,...headers,origin:'https://carejoys.com'},body:JSON.stringify({listed:false})})).json() as any;
    expect(off.optedIn).toBe(false);
    expect(off.listed).toBe(false);
  });
  it('asks "still looking?" after two weeks, once per confirmation, and a tap answers it', async()=>{
    const old=new Date(Date.now()-15*86400000).toISOString();
    await listed('dir-ask','21201',{last_confirmed_at:old});
    await DB.prepare("INSERT INTO email_suppressions(email,reason) VALUES ('dir-quiet@example.com','unsubscribe')").run();
    await listed('dir-quiet','21201',{last_confirmed_at:old});
    sent.length=0;
    // dir-stale (confirmed 40 days ago, listing lapsed) is asked too; dir-quiet unsubscribed.
    expect(await sendStillLookingEmails(env())).toEqual({sent:2,failed:0});
    expect(sent.map(m=>m.to).sort()).toEqual(['dir-ask@example.com','dir-stale@example.com']);
    const ask=sent.find(m=>m.to==='dir-ask@example.com')!;
    expect(ask.subject).toBe('Still looking for caregiver work?');
    expect(ask.headers?.['List-Unsubscribe']).toBeTruthy();
    // Not again while the question is open.
    expect(await sendStillLookingEmails(env())).toEqual({sent:0,failed:0});
    const yes=ask.html!.match(/href="([^"]*\/api\/still-looking\?t=[^"]*&amp;a=yes)"/)![1].replace(/&amp;/g,'&').replace('https://carejoys.com','');
    const answered=await call(yes);
    expect(answered.status).toBe(200);
    expect(await answered.text()).toContain('still listed');
    const row=await DB.prepare("SELECT work_status,still_looking_token_hash,datetime(last_confirmed_at)>datetime('now','-1 day') AS fresh FROM caregivers WHERE id='dir-ask'").first() as any;
    expect(row.work_status).toBe('actively_looking');
    expect(row.still_looking_token_hash).toBeNull();
    expect(row.fresh).toBe(1);
    expect((await call(yes)).status).toBe(410);
    expect(await DB.prepare("SELECT source FROM availability_events WHERE caregiver_id='dir-ask' ORDER BY confirmed_at DESC LIMIT 1").first()).toEqual({source:'still_looking_email'});
  });
});

describe('one-field job alerts', ()=>{
  it('confirms by email with today’s jobs, then sends only new nearby jobs at most weekly', async()=>{
    await DB.prepare("DELETE FROM job_alert_signups").run();
    await DB.prepare("INSERT OR REPLACE INTO agency_organizations(id,organization_key,canonical_name,is_active) VALUES ('org-alerts','org-alerts','Valley Care',1)").run();
    const addJob=(id:string,title:string,role:string,zip:string,city:string,state:string)=>DB.prepare(`INSERT OR REPLACE INTO caregiver_jobs(id,agency_organization_id,dedupe_key,source_provider,source_url,title,role,employer_name,city,state,zip,status,is_published,first_seen_at)
      VALUES (?,'org-alerts',?,'test','https://valley.test/apply',?,?,'Valley Care',?,?,?,'current',1,datetime('now','-2 days'))`).bind(id,id,title,role,city,state,zip).run();
    await addJob('alert-cna','CNA Days Missoula','CNA','59801','Missoula','MT');
    await addJob('alert-hha','HHA Weekends Missoula','HHA','59801','Missoula','MT');
    await addJob('alert-far','CNA Nights Los Angeles','CNA','90001','Los Angeles','CA');

    expect((await post('/api/public/job-alerts',{email:'nope',zip:'59801'})).status).toBe(400);
    expect((await post('/api/public/job-alerts',{email:'alert@example.com',zip:'123'})).status).toBe(400);
    sent.length=0;
    const res=await post('/api/public/job-alerts',{email:'Alert@Example.com',zip:'59801',role:'CNA',source:'/jobs/alert-cna'});
    expect(await res.json()).toEqual({ok:true,status:'pending'});
    expect(sent.map(m=>[m.to,m.subject])).toEqual([['alert@example.com','Confirm your CNA jobs near 59801']]);
    const confirm=sent[0].html!;
    expect(confirm).toContain('CNA Days Missoula');
    expect(confirm).not.toContain('HHA Weekends');
    expect(confirm).not.toContain('Los Angeles');
    expect((sent[0] as any).from).toBe('CareJoys <hello@carejoys.com>');
    // Sending the form again the same day doesn't send a second confirm email.
    sent.length=0;
    expect(await (await post('/api/public/job-alerts',{email:'alert@example.com',zip:'59801',role:'CNA'})).json()).toEqual({ok:true,status:'pending'});
    expect(sent).toEqual([]);

    const link=(confirm.match(/href="(https:\/\/carejoys\.com\/api\/public\/job-alerts\/confirm\?token=[^"]+)"/)||[])[1]!;
    const landed=await call(link.replace('https://carejoys.com','').replace(/&amp;/g,'&'),{redirect:'manual'});
    expect(landed.status).toBe(302);
    expect(landed.headers.get('location')).toBe('https://carejoys.com/cna-jobs?alert=on&q=59801#search-results');
    expect(await (await post('/api/public/job-alerts',{email:'alert@example.com',zip:'59801',role:'CNA'})).json()).toEqual({ok:true,status:'active'});
    // An unconfirmed signup never gets the weekly email.
    await post('/api/public/job-alerts',{email:'pending@example.com',zip:'59801',role:'CNA'});

    expect(await sendJobAlerts(env())).toEqual({sent:0,skipped:0,disabled:true});
    sent.length=0;
    // Nothing new since they confirmed: no email.
    expect(await sendJobAlerts(env({JOB_ALERTS_ENABLED:'true'}))).toMatchObject({sent:0});
    await DB.prepare("UPDATE job_alert_signups SET confirmed_at=datetime('now','-1 hour') WHERE email='alert@example.com'").run();
    await DB.prepare("INSERT INTO caregiver_jobs(id,agency_organization_id,dedupe_key,source_provider,source_url,title,role,employer_name,city,state,zip,status,is_published) VALUES ('alert-new','org-alerts','alert-new','test','https://valley.test/apply','CNA Evenings Missoula','CNA','Valley Care','Missoula','MT','59801','current',1)").run();
    expect(await sendJobAlerts(env({JOB_ALERTS_ENABLED:'true'}))).toMatchObject({sent:1});
    expect(sent.map(m=>[m.to,m.subject])).toEqual([['alert@example.com','1 new CNA job near 59801']]);
    expect(sent[0].html).toContain('CNA Evenings Missoula');
    expect(sent[0].html).not.toContain('CNA Days Missoula');
    expect(sent[0].headers?.['List-Unsubscribe']).toContain('/api/unsubscribe?token=');
    // At most once a week.
    sent.length=0;
    expect(await sendJobAlerts(env({JOB_ALERTS_ENABLED:'true'}))).toMatchObject({sent:0});
    expect(sent).toEqual([]);
  });

  it('limits sign-ups from one connection', async()=>{
    const statuses:number[]=[];
    for(let i=0;i<6;i++)statuses.push((await call('/api/public/job-alerts',{method:'POST',headers:{'content-type':'application/json','CF-Connecting-IP':'203.0.113.9'},body:JSON.stringify({email:'many'+i+'@example.com',zip:'59801'})})).status);
    expect(statuses).toEqual([200,200,200,200,200,429]);
  });
});
