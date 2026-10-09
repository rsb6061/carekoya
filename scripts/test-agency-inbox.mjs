import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModules, createEnv, seed, addEmployerSession, finishSession, tokenFromEmail } from './harness.mjs';

const mod=await loadModules();
function fresh(){const t=createEnv();seed(t.db);return t;}
function addCaregiver(db,{id='cg-1',email='sam@example.com',first='Sam',phone='410-555-0199',role='GNA',state='MD',zip='21201',certs='GNA'}={}){
  db.prepare(`INSERT INTO caregivers(id,first_name,last_name,display_name,email,phone,zip,state,city,role,certifications,shift_preferences,work_status,last_confirmed_at,auth0_sub)
    VALUES (?,?,?,?,?,?,?,?,'Baltimore',?,?,'Nights','actively_looking',CURRENT_TIMESTAMP,?)`).run(id,first,'Rivera',first+' Rivera',email,phone,zip,state,role,certs,'auth0|'+id);
  return id;
}
async function claimed(t,orgId='org-a',employerId='emp-a',email='owner@harbor.example'){
  const {token}=addEmployerSession(t.db,{employerId,email,orgId});
  const {cookie}=await finishSession(t.db,token,employerId,mod.sha256Hex);
  return cookie;
}
const req=(path,{method='GET',cookie,body}={})=>new Request('https://carejoys.com'+path,{method,headers:{'content-type':'application/json',...(cookie?{cookie}:{})},body:body?JSON.stringify(body):undefined});

test('stages: the agency mark wins, otherwise it needs a reply',()=>{
  assert.equal(mod.interestStage({agency_stage:null}),'new');
  assert.equal(mod.interestStage({agency_stage:'hired'}),'hired');
  assert.equal(mod.interestStage({agency_stage:'bogus'}),'new');
  assert.equal(mod.STAGE_LABELS.new,'Needs reply');
});

test('job page: a verified sign-in sends at once; a duplicate is reported, not repeated',async()=>{
  const t=fresh();
  const cookie=await claimed(t);
  addCaregiver(t.db);
  const identity={sub:'auth0|cg-1',email:'sam@example.com',emailVerified:true};
  const first=await (await mod.sendProfileFromJobPage(req('/api/public/caregiver-jobs/job-1/interest',{method:'POST',body:{}}),t.env,'job-1',identity)).json();
  assert.equal(first.status,'sent');
  assert.equal(first.results[0].status,'sent');
  // Claimed agency: the owner hears about it, with the caregiver's first name.
  assert.equal(t.sent.length,1);
  assert.equal(t.sent[0].to,'owner@harbor.example');
  assert.match(t.sent[0].text,/Sam · GNA/);
  assert.match(t.sent[0].text,/app\?tab=inbox/);
  const second=await (await mod.sendProfileFromJobPage(req('/api/public/caregiver-jobs/job-1/interest',{method:'POST',body:{}}),t.env,'job-1',identity)).json();
  assert.equal(second.results[0].status,'already_sent');
  assert.equal(t.sent.length,1);
  void cookie;
});

test('job page without a verified sign-in emails the profile owner a Send link',async()=>{
  const t=fresh();
  addCaregiver(t.db);
  const res=await (await mod.sendProfileFromJobPage(req('/api/public/caregiver-jobs/job-3/interest',{method:'POST',body:{caregiverId:'cg-1'}}),t.env,'job-3',null)).json();
  assert.equal(res.status,'check_email');
  assert.equal(t.sent.length,1);
  assert.equal(t.sent[0].to,'sam@example.com');
  assert.equal(t.db.prepare('SELECT COUNT(*) n FROM agency_interests').get().n,0);
  const token=tokenFromEmail(t.sent[0]);
  const done=await (await mod.confirmInterestRequest(req('/api/interest-confirm',{method:'POST',body:{token}}),t.env)).json();
  assert.equal(done.status,'sent');
  assert.equal(t.db.prepare("SELECT source FROM agency_interests").get().source,'job_page');
  const unknown=await mod.sendProfileFromJobPage(req('/x',{method:'POST',body:{caregiverId:'nobody'}}),t.env,'job-3',null);
  assert.equal(unknown.status,404);
});

test('an existing profile keeps its details when an assistant request is sent',async()=>{
  const t=fresh();
  addCaregiver(t.db,{email:'maria@example.com',first:'Mariana',role:'GNA',certs:'GNA, CPR'});
  const id=await mod.upsertCaregiverFromProfile(t.env,mod.validateProfile({full_name:'Maria Lopez',email:'MARIA@example.com',zip:'21230',role:'CNA'}));
  assert.equal(id,'cg-1');
  const row=t.db.prepare('SELECT first_name,role,zip,certifications FROM caregivers WHERE id=?').get(id);
  assert.deepEqual({...row},{first_name:'Mariana',role:'GNA',zip:'21201',certifications:'GNA, CPR'});
});

test('agencies get at most one email a day; the hourly sweep sends the rest',async()=>{
  const t=fresh();
  await claimed(t);
  addCaregiver(t.db,{id:'cg-1',email:'a@example.com'});
  addCaregiver(t.db,{id:'cg-2',email:'b@example.com',first:'Bo'});
  const targets=await mod.resolveTargets(t.env,{jobIds:['job-1']});
  await mod.createAgencyInterests(t.env,{caregiverId:'cg-1',targets,source:'job_page'});
  await mod.createAgencyInterests(t.env,{caregiverId:'cg-2',targets,source:'job_page'});
  assert.equal(t.sent.length,1);
  assert.equal((await mod.notifyAgenciesOfInterestsBatch(t.env)).sent,0);
  t.db.exec("UPDATE agency_interests SET agency_notified_at=datetime('now','-2 days') WHERE agency_notified_at IS NOT NULL");
  assert.equal((await mod.notifyAgenciesOfInterestsBatch(t.env)).sent,1);
  assert.match(t.sent[1].text,/Bo · GNA/);
  assert.doesNotMatch(t.sent[1].text,/Sam/);
});

test('the Inbox shows full contact details to the claimed agency only, and saves stages and notes',async()=>{
  const t=fresh();
  const cookie=await claimed(t);
  const otherCookie=await claimed(t,'org-b','emp-b','owner@chesapeake.example');
  addCaregiver(t.db);
  const [result]=await mod.createAgencyInterests(t.env,{caregiverId:'cg-1',targets:await mod.resolveTargets(t.env,{jobIds:['job-1']}),source:'mcp',note:'I can start Monday'});
  const inbox=await (await mod.getAgencyInbox(req('/api/agency/inbox',{cookie}),t.env)).json();
  assert.equal(inbox.agency.name,'Harbor Home Care');
  assert.equal(inbox.items.length,1);
  const item=inbox.items[0];
  assert.equal(item.stage,'new');
  assert.equal(item.viewed,false);
  assert.equal(item.source,'AI assistant');
  assert.equal(item.note,'I can start Monday');
  assert.equal(item.caregiver.email,'sam@example.com');
  assert.equal(item.caregiver.phone,'410-555-0199');
  assert.equal(item.job.title,'CNA Day Shift');
  const reread=await (await mod.getAgencyInbox(req('/api/agency/inbox',{cookie}),t.env)).json();
  assert.equal(reread.items[0].viewed,true);

  const other=await (await mod.getAgencyInbox(req('/api/agency/inbox',{cookie:otherCookie}),t.env)).json();
  assert.equal(other.items.length,0);
  assert.equal((await mod.updateAgencyInterest(req('/x',{method:'POST',cookie:otherCookie,body:{stage:'hired'}}),t.env,result.interestId)).status,404);
  assert.equal((await mod.getAgencyInbox(req('/api/agency/inbox'),t.env)).status,401);

  const bad=await mod.updateAgencyInterest(req('/x',{method:'POST',cookie,body:{stage:'maybe'}}),t.env,result.interestId);
  assert.equal(bad.status,400);
  const moved=await (await mod.updateAgencyInterest(req('/x',{method:'POST',cookie,body:{stage:'interview',notes:'Call back Tuesday'}}),t.env,result.interestId)).json();
  assert.deepEqual([moved.stage,moved.notes],['interview','Call back Tuesday']);
  const back=await (await mod.updateAgencyInterest(req('/x',{method:'POST',cookie,body:{stage:'new'}}),t.env,result.interestId)).json();
  assert.equal(back.stage,'new');
  const events=t.db.prepare('SELECT event_type FROM agency_interest_events ORDER BY rowid').all().map(r=>r.event_type);
  assert.deepEqual(events,['created','stage_changed','stage_changed']);
});

test('unclaimed agencies get no email while outreach is off or after they unsubscribe; claimed agencies still do',async()=>{
  const t=fresh();
  t.env.OUTREACH_ENABLED='false';
  addCaregiver(t.db);
  await mod.createAgencyInterests(t.env,{caregiverId:'cg-1',targets:await mod.resolveTargets(t.env,{agencyIds:['org-b']}),source:'job_page'});
  assert.equal(t.sent.length,0);
  assert.equal((await mod.notifyAgenciesOfInterestsBatch(t.env)).attempted,0);
  await claimed(t);
  await mod.createAgencyInterests(t.env,{caregiverId:'cg-1',targets:await mod.resolveTargets(t.env,{agencyIds:['org-a']}),source:'job_page'});
  assert.equal(t.sent.length,1);
  assert.equal(t.sent[0].to,'owner@harbor.example');
  const email=t.db.prepare("SELECT primary_email FROM agency_organizations WHERE id='org-b'").get().primary_email;
  t.db.prepare("INSERT INTO email_suppressions(email) VALUES (?)").run(email.toLowerCase());
  t.env.OUTREACH_ENABLED='true';
  assert.equal((await mod.notifyAgenciesOfInterestsBatch(t.env)).attempted,0);
  t.db.exec('DELETE FROM email_suppressions');
  assert.equal((await mod.notifyAgenciesOfInterestsBatch(t.env)).sent,1);
  assert.match(t.sent[1].text,/Unsubscribe: https:\/\/carejoys\.com\/api\/unsubscribe/);
  assert.ok(t.sent[1].headers['List-Unsubscribe']);
});

test('the claim page an activation email opens lists waiting caregivers without names',async()=>{
  const t=fresh();
  addCaregiver(t.db);
  await mod.createAgencyInterests(t.env,{caregiverId:'cg-1',targets:await mod.resolveTargets(t.env,{agencyIds:['org-b']}),source:'job_page'});
  const link=/agency\?token=([^\s]+)/.exec(t.sent[0].text)[1];
  const page=await (await mod.getAgencyTeaser(new URL('https://carejoys.com/api/agency/teaser?token='+link),t.env)).json();
  assert.equal(page.interests.length,1);
  assert.equal(page.interests[0].role,'GNA');
  assert.doesNotMatch(JSON.stringify(page),/Sam|sam@example|410-555/);
});

test('hourly rescoring keeps match rows a caregiver acted on',async()=>{
  const t=fresh();
  addCaregiver(t.db);
  await mod.scoreAgencyMatches(t.env);
  const before=t.db.prepare("SELECT COUNT(*) n FROM agency_org_candidate_matches WHERE caregiver_id='cg-1'").get().n;
  assert.ok(before>0);
  await mod.createAgencyInterests(t.env,{caregiverId:'cg-1',targets:await mod.resolveTargets(t.env,{jobIds:['job-1']}),source:'job_page'});
  assert.equal(t.db.prepare("SELECT caregiver_interest FROM agency_org_candidate_matches WHERE organization_id='org-a' AND caregiver_id='cg-1'").get().caregiver_interest,'interested');
  await mod.scoreAgencyMatches(t.env);
  assert.equal(t.db.prepare("SELECT caregiver_interest FROM agency_org_candidate_matches WHERE organization_id='org-a' AND caregiver_id='cg-1'").get().caregiver_interest,'interested');
  assert.equal(t.db.prepare("SELECT COUNT(*) n FROM agency_org_candidate_matches WHERE caregiver_id='cg-1'").get().n,before);
});
