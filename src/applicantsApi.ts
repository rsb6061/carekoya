import { employerSession, type FeatureEnv } from './serverFeatures';
import { importApplicants, listApplicants, updateApplicant, type ApplicantDb } from './applicants';

// The applicant list over HTTP: an agency works its own list from its workspace, and a CareJoys admin works any
// agency's list from the admin console (the operated service). Same storage, same rules.

type Row=Record<string,unknown>;
const json=(body:unknown,init:ResponseInit={})=>new Response(JSON.stringify(body),{
  ...init,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...(init.headers||{})}
});
const db=(env:FeatureEnv)=>env.DB as unknown as ApplicantDb;
const clean=(v:unknown,max=200)=>typeof v==='string'?v.trim().slice(0,max):'';

async function respond(env:FeatureEnv,employerId:string,request:Request,id:string,actor:string){
  const store=db(env);
  if(request.method==='GET')return json({ok:true,...await listApplicants(store,employerId)});
  const data=await request.json().catch(()=>null) as Row|null;
  if(!data)return json({ok:false,error:'Nothing to save.'},{status:400});
  const result=id?await updateApplicant(store,employerId,id,data):await importApplicants(store,employerId,{csv:data.csv,source:data.source,filename:data.filename,sourceDetail:data.sourceDetail},actor);
  return json(result,{status:result.ok?200:(result.error==='Applicant not found.'?404:400)});
}

/** /api/workspace/applicants[/:id] for the signed-in agency. */
export async function workspaceApplicants(request:Request,env:FeatureEnv,id=''){
  const employer=await employerSession(request,env);
  if(!employer)return json({ok:false,error:'Sign in required'},{status:401});
  return respond(env,clean(employer.id,100),request,id,clean(employer.email,320));
}

/** /api/admin/applicants[/:id]?employer=<id> for a CareJoys operator. The caller has already checked admin access. */
export async function adminApplicants(request:Request,env:FeatureEnv,adminEmail:string,id=''){
  const employerId=clean(new URL(request.url).searchParams.get('employer'),100);
  if(!employerId)return json({ok:false,error:'Choose an employer.'},{status:400});
  const employer=await env.DB!.prepare('SELECT id FROM employer_leads WHERE id=? LIMIT 1').bind(employerId).first<Row>();
  if(!employer)return json({ok:false,error:'Employer not found.'},{status:404});
  return respond(env,employerId,request,id,adminEmail||'admin');
}
