// Offline test harness: bundles the Worker's TypeScript modules with esbuild and runs them against an
// in-memory SQLite database built from every migration, with a fake email binding.
import { build } from 'esbuild';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root=join(dirname(fileURLToPath(import.meta.url)),'..');

export async function loadModules(){
  const dir=mkdtempSync(join(tmpdir(),'carejoys-test-'));
  const entry=join(dir,'entry.ts');
  writeFileSync(entry,[
    `export * from ${JSON.stringify(join(root,'src/agencyInbox.ts'))};`,
    `export * from ${JSON.stringify(join(root,'src/mcp.ts'))};`,
    `export { scoreAgencyMatches, getAgencyTeaser } from ${JSON.stringify(join(root,'src/agencyFeatures.ts'))};`
  ].join('\n'));
  const outfile=join(dir,'bundle.mjs');
  await build({entryPoints:[entry],bundle:true,format:'esm',platform:'neutral',outfile,logLevel:'error'});
  return import(pathToFileURL(outfile).href);
}

const toSql=v=>v===undefined?null:typeof v==='boolean'?(v?1:0):v;

// The subset of Cloudflare D1 the Worker uses.
export function createD1(){
  const db=new DatabaseSync(':memory:');
  for(const file of readdirSync(join(root,'migrations')).filter(f=>f.endsWith('.sql')).sort())
    db.exec(readFileSync(join(root,'migrations',file),'utf8'));
  const statement=(sql,values=[])=>({
    bind:(...v)=>statement(sql,v.map(toSql)),
    async run(){const r=db.prepare(sql).run(...values);return {success:true,meta:{changes:Number(r.changes)}}},
    async all(){return {success:true,results:db.prepare(sql).all(...values).map(r=>({...r}))}},
    async first(){const r=db.prepare(sql).get(...values);return r?{...r}:null}
  });
  return {prepare:sql=>statement(sql),raw:db};
}

export function createEnv(){
  const sent=[];
  const DB=createD1();
  return {
    env:{DB,OUTREACH_ENABLED:'true',EMAIL:{async send(message){sent.push(message);return {messageId:'m'+sent.length}}}},
    sent,
    db:DB.raw
  };
}

export function seed(db){
  db.exec(`
    INSERT INTO agency_organizations(id,organization_key,canonical_name,primary_email,primary_contact_name,city,state,zip,is_active,caregiver_relevance_score)
      VALUES ('org-a','a','Harbor Home Care','jobs@harbor.example','Dana Smith','Baltimore','MD','21201',1,90),
             ('org-b','b','Chesapeake Caregivers','hello@chesapeake.example','','Towson','MD','21204',1,70),
             ('org-c','c','Closed Agency','x@closed.example','','Baltimore','MD','21201',0,50);
    INSERT INTO caregiver_jobs(id,agency_organization_id,dedupe_key,source_provider,source_url,title,role,employer_name,city,state,zip,pay_min,pay_max,pay_period,status,is_published,date_posted,description_text)
      VALUES ('job-1','org-a','d1','ats','https://harbor.example/apply/1','CNA Day Shift','CNA','Harbor Home Care','Baltimore','MD','21201',19,22,'hour','current',1,'2026-09-20','Visit clients in Baltimore.'),
             ('job-2','org-a','d2','ats','https://harbor.example/apply/2','HHA Weekends','HHA','Harbor Home Care','Baltimore','MD','21230',16,17,'hour','current',1,'2026-09-25',''),
             ('job-3','org-b','d3','ats','https://chesapeake.example/apply','Caregiver','Caregiver','Chesapeake Caregivers','Towson','MD','21204',NULL,NULL,NULL,'current',1,'2026-09-10',''),
             ('job-hidden','org-b','d4','ats','https://chesapeake.example/x','Hidden CNA','CNA','Chesapeake Caregivers','Towson','MD','21204',30,30,'hour','current',0,'2026-09-28','');
  `);
}

export function addEmployerSession(db,{employerId,email,orgId}){
  const token='session-'+employerId;
  db.prepare("INSERT INTO employer_leads(id,company_name,contact_name,email,zip,status) VALUES (?,?,?,?,?,'active')").run(employerId,'Co '+employerId,'Pat Lee',email,'21201');
  if(orgId)db.prepare('UPDATE agency_organizations SET claimed_employer_id=? WHERE id=?').run(employerId,orgId);
  return {token,hashPending:token};
}
export async function finishSession(db,token,employerId,sha256Hex){
  db.prepare("INSERT INTO employer_sessions(id,employer_id,session_hash,expires_at) VALUES (?,?,?,datetime('now','+1 day'))").run('s-'+employerId,employerId,await sha256Hex(token));
  return {cookie:'__Host-cj_session='+token};
}

let rpcId=0;
export async function mcpCall(mod,env,method,params,headers={}){
  const req=new Request('https://carejoys.com/api/mcp',{method:'POST',headers:{'content-type':'application/json','cf-connecting-ip':'203.0.113.9',...headers},
    body:JSON.stringify({jsonrpc:'2.0',id:++rpcId,method,params})});
  const res=await mod.handleMcp(req,env);
  return {status:res.status,headers:res.headers,body:res.status===202?null:await res.json()};
}
export async function callTool(mod,env,name,args){
  const {body}=await mcpCall(mod,env,'tools/call',{name,arguments:args});
  if(body.error)throw new Error('protocol error '+body.error.message);
  return body.result;
}
export const tokenFromEmail=message=>decodeURIComponent(/confirm-interest\?token=([^\s"&<]+)/.exec(message.text)[1]);
