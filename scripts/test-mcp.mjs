import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModules, createEnv, seed, mcpCall, callTool, tokenFromEmail } from './harness.mjs';

const mod=await loadModules();
function fresh(){const t=createEnv();seed(t.db);return t;}
const profile={full_name:'Maria Lopez',email:'maria@example.com',phone:'410-555-0100',zip:'21201',role:'CNA',certifications:['CNA','CPR'],years_experience:4};

test('initialize negotiates the protocol version',async()=>{
  const {env}=fresh();
  const known=await mcpCall(mod,env,'initialize',{protocolVersion:'2025-06-18'});
  assert.equal(known.body.result.protocolVersion,'2025-06-18');
  assert.equal(known.body.result.serverInfo.name,'CareJoys');
  const unknown=await mcpCall(mod,env,'initialize',{protocolVersion:'1999-01-01'});
  assert.equal(unknown.body.result.protocolVersion,mod.MCP_PROTOCOL_VERSIONS[0]);
});

test('tools/list describes every tool with a title and annotations',async()=>{
  const {env}=fresh();
  const {body}=await mcpCall(mod,env,'tools/list',{});
  const names=body.result.tools.map(t=>t.name);
  assert.deepEqual(names,['search_caregiver_jobs','get_caregiver_job','find_hiring_agencies','prepare_job_interest','confirm_job_interest','get_interest_status']);
  for(const t of body.result.tools){assert.ok(t.title);assert.equal(typeof t.annotations.readOnlyHint,'boolean');assert.equal(t.inputSchema.type,'object')}
});

test('transport: origins, notifications, bad JSON and GET',async()=>{
  const {env}=fresh();
  assert.equal((await mcpCall(mod,env,'ping',{},{origin:'https://evil.example'})).status,403);
  const claude=await mcpCall(mod,env,'ping',{},{origin:'https://claude.ai'});
  assert.equal(claude.status,200);
  assert.equal(claude.headers.get('access-control-allow-origin'),'https://claude.ai');
  const note=await mod.handleMcp(new Request('https://carejoys.com/api/mcp',{method:'POST',body:JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})}),env);
  assert.equal(note.status,202);
  const bad=await mod.handleMcp(new Request('https://carejoys.com/api/mcp',{method:'POST',body:'{nope'}),env);
  assert.equal((await bad.json()).error.code,-32700);
  assert.equal((await mod.handleMcp(new Request('https://carejoys.com/api/mcp'),env)).status,405);
  const unknown=await mcpCall(mod,env,'tools/call',{name:'drop_tables',arguments:{}});
  assert.equal(unknown.body.error.code,-32602);
});

test('search_caregiver_jobs returns published jobs only, nearest ZIP first, with pay filter',async()=>{
  const {env}=fresh();
  const all=(await callTool(mod,env,'search_caregiver_jobs',{})).structuredContent;
  assert.deepEqual(all.jobs.map(j=>j.id).sort(),['job-1','job-2','job-3']);
  const near=(await callTool(mod,env,'search_caregiver_jobs',{zip:'21230'})).structuredContent;
  assert.equal(near.jobs[0].id,'job-2');
  assert.ok(near.jobs.every(j=>j.location.includes('212')));
  const paid=(await callTool(mod,env,'search_caregiver_jobs',{pay_min:18})).structuredContent;
  assert.deepEqual(paid.jobs.map(j=>j.id).sort(),['job-1','job-3']); // job-3 has no published pay, so it stays
  const cna=(await callTool(mod,env,'search_caregiver_jobs',{role:'cna'})).structuredContent;
  assert.deepEqual(cna.jobs.map(j=>j.id),['job-1']);
  assert.equal(cna.jobs[0].url,'https://carejoys.com/jobs/job-1');
  assert.equal(cna.jobs[0].pay,'$19–$22/hr');
});

test('get_caregiver_job and find_hiring_agencies',async()=>{
  const {env}=fresh();
  const job=(await callTool(mod,env,'get_caregiver_job',{job_id:'job-1'})).structuredContent;
  assert.equal(job.description,'Visit clients in Baltimore.');
  const hidden=await callTool(mod,env,'get_caregiver_job',{job_id:'job-hidden'});
  assert.equal(hidden.isError,true);
  const agencies=(await callTool(mod,env,'find_hiring_agencies',{})).structuredContent.agencies;
  assert.deepEqual(agencies.map(a=>[a.id,a.openJobs]),[['org-a',2],['org-b',1]]);
});

test('prepare_job_interest validates input and contacts nobody',async()=>{
  const {env,sent,db}=fresh();
  const noLast=await callTool(mod,env,'prepare_job_interest',{...profile,full_name:'Maria',job_ids:['job-1']});
  assert.equal(noLast.isError,true);
  assert.match(noLast.content[0].text,/first and last name/);
  const noTarget=await callTool(mod,env,'prepare_job_interest',profile);
  assert.match(noTarget.content[0].text,/at least one job or agency/);
  const closed=await callTool(mod,env,'prepare_job_interest',{...profile,agency_ids:['org-c']});
  assert.equal(closed.isError,true);
  const ok=(await callTool(mod,env,'prepare_job_interest',{...profile,job_ids:['job-1'],agency_ids:['org-b']})).structuredContent;
  assert.ok(ok.confirmationToken.length>40);
  assert.deepEqual(ok.summary.sendTo.map(t=>t.agency),['Harbor Home Care','Chesapeake Caregivers']);
  assert.equal(sent.length,0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM agency_interests').get().n,0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM caregivers').get().n,0);
});

test('nothing reaches an agency until the caregiver presses Send',async()=>{
  const {env,sent,db}=fresh();
  const {confirmationToken}=(await callTool(mod,env,'prepare_job_interest',{...profile,job_ids:['job-1'],agency_ids:['org-b'],note:'Available weekdays'})).structuredContent;
  const unconfirmed=await callTool(mod,env,'confirm_job_interest',{confirmation_token:confirmationToken});
  assert.equal(unconfirmed.isError,true);
  const confirmed=(await callTool(mod,env,'confirm_job_interest',{confirmation_token:confirmationToken,user_confirmed:true})).structuredContent;
  assert.equal(confirmed.status,'awaiting_caregiver_email_confirmation');
  assert.equal(confirmed.emailedTo,'m***@example.com');
  assert.equal(sent.length,1);
  assert.equal(sent[0].to,'maria@example.com');
  assert.match(sent[0].subject,/2 agencies/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM agency_interests').get().n,0);
  const waiting=(await callTool(mod,env,'get_interest_status',{request_token:confirmed.requestToken})).structuredContent;
  assert.equal(waiting.status,'awaiting_caregiver_email_confirmation');

  // Opening the link (GET) shows the summary and still sends nothing.
  const token=tokenFromEmail(sent[0]);
  const view=await (await mod.getInterestConfirmation(new URL('https://carejoys.com/api/interest-confirm?token='+encodeURIComponent(token)),env)).json();
  assert.equal(view.status,'ready');
  assert.equal(view.viaAssistant,true);
  assert.equal(sent.length,1);

  const press=await mod.confirmInterestRequest(new Request('https://carejoys.com/api/interest-confirm',{method:'POST',body:JSON.stringify({token})}),env);
  const pressed=await press.json();
  assert.equal(pressed.status,'sent');
  assert.deepEqual(pressed.results.map(r=>r.status),['sent','sent']);
  const caregiver=db.prepare("SELECT * FROM caregivers WHERE email='maria@example.com'").get();
  assert.equal(caregiver.source,'ai_assistant');
  assert.equal(caregiver.work_status,'actively_looking');
  assert.equal(caregiver.state,'MD');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM agency_interests WHERE caregiver_id=?').get(caregiver.id).n,2);

  // Both agencies are unclaimed, so each gets one de-identified activation email at its listed address.
  const agencyMail=sent.slice(1);
  assert.deepEqual(agencyMail.map(m=>m.to).sort(),['hello@chesapeake.example','jobs@harbor.example']);
  for(const m of agencyMail){
    assert.doesNotMatch(m.text,/Maria|Lopez|maria@example\.com|410-555/);
    assert.match(m.text,/carejoys\.com\/agency\?token=/);
  }

  // Pressing Send twice changes nothing.
  const again=await (await mod.confirmInterestRequest(new Request('https://carejoys.com/api/interest-confirm',{method:'POST',body:JSON.stringify({token})}),env)).json();
  assert.equal(again.status,'sent');
  assert.equal(sent.length,3);

  const status=(await callTool(mod,env,'get_interest_status',{request_token:confirmed.requestToken})).structuredContent;
  assert.equal(status.status,'sent');
  assert.deepEqual(status.agencies.map(a=>a.status),['Sent; waiting for the agency','Sent; waiting for the agency']);
});

test('a confirmation token expires and an email link is single-purpose',async()=>{
  const {env,db}=fresh();
  const {confirmationToken}=(await callTool(mod,env,'prepare_job_interest',{...profile,job_ids:['job-1']})).structuredContent;
  db.exec("UPDATE interest_requests SET prepare_expires_at='2000-01-01T00:00:00.000Z'");
  const late=await callTool(mod,env,'confirm_job_interest',{confirmation_token:confirmationToken,user_confirmed:true});
  assert.match(late.content[0].text,/expired/);
  const wrong=await (await mod.confirmInterestRequest(new Request('https://carejoys.com/api/interest-confirm',{method:'POST',body:JSON.stringify({token:confirmationToken})}),env)).json();
  assert.equal(wrong.ok,false); // the assistant's token cannot press Send
});

test('rate limits per email address',async()=>{
  const {env}=fresh();
  for(let i=0;i<5;i++)assert.ok(!(await callTool(mod,env,'prepare_job_interest',{...profile,job_ids:['job-1']})).isError);
  const sixth=await callTool(mod,env,'prepare_job_interest',{...profile,job_ids:['job-1']});
  assert.match(sixth.content[0].text,/Too many requests for this email/);
});

test('server card points at the endpoint',()=>{
  const card=mod.mcpServerCard();
  assert.equal(card.remotes[0].url,'https://carejoys.com/api/mcp');
  assert.equal(card.tools.length,6);
});

test('agencies CareJoys cannot reach are marked and refused',async()=>{
  const {env,db}=fresh();
  db.exec("UPDATE agency_organizations SET primary_email='' WHERE id='org-b'");
  const jobs=(await callTool(mod,env,'search_caregiver_jobs',{})).structuredContent.jobs;
  assert.equal(jobs.find(j=>j.id==='job-3').canSendProfile,false);
  assert.equal(jobs.find(j=>j.id==='job-1').canSendProfile,true);
  const refused=await callTool(mod,env,'prepare_job_interest',{...profile,job_ids:['job-3']});
  assert.match(refused.content[0].text,/can't receive profiles/);
});
