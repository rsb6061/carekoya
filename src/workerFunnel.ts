import { caregiverForIdentity, type CaregiverIdentity } from './caregiverApi';
import type { FeatureEnv } from './serverFeatures';

type Row=Record<string,unknown>;
type FunnelEnv=Pick<FeatureEnv,'DB'>;
const clean=(v:unknown,max=150)=>typeof v==='string'?v.trim().slice(0,max):'';
const validVisitor=(v:unknown)=>{const s=clean(v,80).toLowerCase();return /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(s)?s:''};
const json=(body:unknown,init:ResponseInit={})=>new Response(JSON.stringify(body),{...init,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...(init.headers||{})}});

/** One successful preview request; no exact ZIP or personal details are stored. */
export async function recordWorkerPreview(env:FunnelEnv,rawVisitor:unknown,hasJobs:boolean){
 if(!env.DB)return;
 const visitor=validVisitor(rawVisitor);
 if(!visitor)return;
 await env.DB.prepare('INSERT INTO worker_funnel_events(id,visitor_id,event_type) VALUES (?,?,?)')
  .bind(crypto.randomUUID(),visitor,hasJobs?'preview_jobs':'preview_empty').run();
}

/** Link a newly-created profile to a recent anonymous preview; no linkage by guessed email. */
export async function linkWorkerSignup(env:FunnelEnv,caregiverId:string,rawVisitor:unknown){
 if(!env.DB)return;
 const visitor=validVisitor(rawVisitor);
 if(!visitor)return;
 await env.DB.prepare(`INSERT OR IGNORE INTO worker_funnel_links(caregiver_id,visitor_id)
  SELECT ?,? WHERE EXISTS(SELECT 1 FROM worker_funnel_events
    WHERE visitor_id=? AND event_type IN ('preview_jobs','preview_empty') AND datetime(created_at)>=datetime('now','-30 days'))`)
  .bind(caregiverId,visitor,visitor).run();
}

/** Signed-in, verified worker engages with an actual published job. */
export async function recordWorkerJobActivity(request:Request,env:FeatureEnv,identity:CaregiverIdentity|null){
 if(!env.DB)return json({ok:false,error:'Service unavailable'},{status:503});
 const caregiverId=await caregiverForIdentity(env,identity);
 if(!caregiverId)return json({ok:false,error:'Sign in to track jobs'},{status:401});
 const data=await request.json().catch(()=>null) as Row|null;
 const jobId=clean(data?.jobId,120);
 if(!jobId)return json({ok:false,error:'Invalid job'},{status:400});
 const exists=await env.DB.prepare("SELECT 1 FROM caregiver_jobs WHERE id=? AND is_published=1 AND status='current' LIMIT 1").bind(jobId).first();
 if(!exists)return json({ok:false,error:'Job is no longer current'},{status:404});
 // Page reloads do not produce dozens of engagement events.
 await env.DB.prepare(`INSERT INTO worker_funnel_events(id,caregiver_id,event_type,job_id)
  SELECT ?,?,'job_view',? WHERE NOT EXISTS (
    SELECT 1 FROM worker_funnel_events WHERE caregiver_id=? AND event_type='job_view'
      AND job_id=? AND date(created_at)=date('now'))`)
  .bind(crypto.randomUUID(),caregiverId,jobId,caregiverId,jobId).run();
 return json({ok:true});
}

/** True cohort: every downstream count belongs to an anonymous visitor who previewed jobs in the selected window. */
export async function workerFunnelReport(env:FunnelEnv,windowKey:string){
 const days=windowKey==='7'?7:windowKey==='90'?90:windowKey==='all'?null:30;
 const limit=days?`AND datetime(created_at)>=datetime('now','-${days} days')`:'';
 const sql=`WITH previews AS (
   SELECT visitor_id,MIN(created_at) AS first_preview_at,
    MAX(CASE WHEN event_type='preview_jobs' THEN 1 ELSE 0 END) AS had_jobs,
    MAX(CASE WHEN event_type='preview_empty' THEN 1 ELSE 0 END) AS had_empty
   FROM worker_funnel_events
   WHERE visitor_id IS NOT NULL AND event_type IN ('preview_jobs','preview_empty') ${limit}
   GROUP BY visitor_id
  ), cohort AS (
   SELECT p.visitor_id,p.had_jobs,p.had_empty,
    c.id AS caregiver_id,c.created_at AS signed_up_at,c.auth0_email_verified AS email_verified
   FROM previews p
   LEFT JOIN worker_funnel_links l ON l.visitor_id=p.visitor_id
   LEFT JOIN caregivers c ON c.id=l.caregiver_id
    AND datetime(c.created_at)>=datetime(p.first_preview_at)
    AND datetime(c.created_at)<=datetime(p.first_preview_at,'+30 days')
    AND COALESCE(c.work_status,'') NOT IN ('closed','merged_duplicate')
    AND lower(c.email) NOT LIKE '%@example.com'
    AND lower(c.email) NOT LIKE '%@example.test'
    AND lower(c.email) NOT LIKE '%@carejoys.com'
  )
  SELECT COUNT(DISTINCT visitor_id) AS previews,
   COUNT(DISTINCT CASE WHEN had_jobs=1 THEN visitor_id END) AS with_jobs,
   COUNT(DISTINCT CASE WHEN had_empty=1 THEN visitor_id END) AS empty,
   COUNT(DISTINCT caregiver_id) AS signups,
   COUNT(DISTINCT CASE WHEN email_verified=1 THEN caregiver_id END) AS verified,
   COUNT(DISTINCT CASE WHEN datetime(signed_up_at)<=datetime('now','-1 day') THEN caregiver_id END) AS eligible_return,
   COUNT(DISTINCT CASE WHEN datetime(signed_up_at)<=datetime('now','-1 day') AND EXISTS (
     SELECT 1 FROM worker_funnel_events a
     WHERE a.caregiver_id=cohort.caregiver_id AND a.event_type='job_view'
       AND datetime(a.created_at)>=datetime(cohort.signed_up_at,'+1 day')
   ) THEN caregiver_id END) AS returned
  FROM cohort`;
 const row=await env.DB!.prepare(sql).first<Row>();
 const n=(key:string)=>Number(row?.[key]||0);
 return {previews:n('previews'),withJobs:n('with_jobs'),emptyPreviews:n('empty'),signups:n('signups'),
   verified:n('verified'),eligibleReturn:n('eligible_return'),returned:n('returned'),
   availableSince:'October 2026',conversionWindowDays:30};
}
