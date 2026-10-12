// An employer's public page at /employers/<name>-<id>: who they are, where, their About and Benefits text and the
// jobs they have open now. Only approved workspaces have one, so a sign-up nobody has checked is never shown.
import type { FeatureEnv } from './serverFeatures';
import { employerProfileKey, employerProfilePath } from './employerProfilePath';
import { payText } from './seo';

type Row=Record<string,unknown>;
const clean=(v:unknown,max=500)=>typeof v==='string'?v.trim().slice(0,max):(typeof v==='number'?String(v):'');

export type EmployerProfileJob={id:string;title:string;role:string;city:string;state:string;pay:string;shift:string;jobPath:string};
export type EmployerProfile={
  name:string;path:string;city:string;state:string;about:string;benefits:string;website:string;providerTypes:string;
  jobs:EmployerProfileJob[];isTest:boolean;
};

/** A workspace may have a public page once CareJoys approved it (or it is a CareJoys test workspace). */
export const PROFILE_VISIBLE_SQL="e.status!='disabled' AND (e.approved_at IS NOT NULL OR COALESCE(e.is_test,0)=1)";

/** The public page path for an approved workspace, or '' when it has none yet. */
export async function profilePathFor(env:FeatureEnv,employerId:string){
  const row=await env.DB!.prepare(`SELECT e.id,e.company_name FROM employer_leads e WHERE e.id=? AND ${PROFILE_VISIBLE_SQL} LIMIT 1`).bind(employerId).first<Row>();
  return row?employerProfilePath(row.company_name,row.id):'';
}

export async function loadEmployerProfile(env:FeatureEnv,slug:string):Promise<EmployerProfile|null>{
  const key=employerProfileKey(slug);
  if(!key||!env.DB)return null;
  const rows=(await env.DB.prepare(`SELECT e.id,e.company_name,e.company_about,e.company_benefits,e.zip,COALESCE(e.is_test,0) AS is_test,
      zg.city AS zip_city,zg.state AS zip_state,ao.id AS org_id,ao.city AS org_city,ao.state AS org_state,ao.primary_website,ao.provider_types
    FROM employer_leads e LEFT JOIN zip_geo zg ON zg.zip=substr(trim(COALESCE(e.zip,'')),1,5)
    LEFT JOIN agency_organizations ao ON ao.claimed_employer_id=e.id AND ao.is_active=1
    WHERE lower(substr(replace(e.id,'-',''),1,8))=? AND ${PROFILE_VISIBLE_SQL} LIMIT 2`).bind(key).all<Row>()).results||[];
  // Two workspaces sharing the first 8 characters of their id is vanishingly rare; neither gets the page then.
  if(rows.length!==1)return null;
  const e=rows[0];
  const openings=(await env.DB.prepare(`SELECT o.id,o.title,o.role,o.city,o.state,o.pay_min,o.pay_max,o.shift_preferences,o.caregiver_job_id
    FROM openings o WHERE o.employer_id=? AND o.status='open' AND COALESCE(o.source,'')!='agency_profile' ORDER BY o.created_at DESC LIMIT 50`).bind(e.id).all<Row>()).results||[];
  const found=e.org_id?(await env.DB.prepare(`SELECT j.id,j.title,j.role,j.city,j.state,j.pay_min,j.pay_max,j.pay_period,j.employment_type
    FROM caregiver_jobs j WHERE j.agency_organization_id=? AND j.is_published=1 AND j.status='current' ORDER BY j.last_seen_at DESC LIMIT 50`).bind(e.org_id).all<Row>()).results||[]:[];
  const listed=new Set(openings.map(o=>clean(o.caregiver_job_id,200)).filter(Boolean));
  const jobs:EmployerProfileJob[]=[
    ...openings.map(o=>({id:clean(o.id,100),title:clean(o.title,200),role:clean(o.role,80),city:clean(o.city,120),state:clean(o.state,20),
      pay:payText(o.pay_min,o.pay_max,'hour'),shift:clean(o.shift_preferences,200),jobPath:o.caregiver_job_id?'/jobs/'+encodeURIComponent(clean(o.caregiver_job_id,200)):''})),
    ...found.filter(j=>!listed.has(clean(j.id,200))).map(j=>({id:clean(j.id,200),title:clean(j.title,200),role:clean(j.role,80),city:clean(j.city,120),state:clean(j.state,20),
      pay:payText(j.pay_min,j.pay_max,j.pay_period),shift:clean(j.employment_type,200),jobPath:'/jobs/'+encodeURIComponent(clean(j.id,200))}))
  ].slice(0,50);
  return {name:clean(e.company_name,200)||'Employer',path:employerProfilePath(e.company_name,e.id),
    city:clean(e.org_city,120)||clean(e.zip_city,120),state:clean(e.org_state,20)||clean(e.zip_state,20),
    about:clean(e.company_about,2000),benefits:clean(e.company_benefits,1200),website:clean(e.primary_website,500),providerTypes:clean(e.provider_types,300),
    jobs,isTest:Number(e.is_test)===1};
}
