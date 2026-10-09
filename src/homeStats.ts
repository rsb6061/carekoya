// Live numbers and newest jobs for the homepage hero, so its claims always match the data.
import { detectApplyProvider } from './applyAgentRules';
import { type FeatureEnv } from './serverFeatures';

type Row=Record<string,unknown>;
const clean=(v:unknown,max=500)=>typeof v==='string'?v.trim().slice(0,max):'';
const num=(v:unknown)=>{const n=Number(v);return Number.isFinite(n)?n:null};

export type HomeJob={id:string;title:string;employerName:string;city:string;state:string;payMin:number|null;payMax:number|null;firstSeenAt:string;applyForMe:boolean};
export type HomeStats={jobs:number;states:number;employersWatched:number;newThisWeek:number;latest:HomeJob[]};

export async function homeStats(env:FeatureEnv):Promise<HomeStats>{
  if(!env.DB)return {jobs:0,states:0,employersWatched:0,newThisWeek:0,latest:[]};
  const totals=await env.DB.prepare(`SELECT
      (SELECT COUNT(*) FROM caregiver_jobs WHERE is_published=1 AND status='current') AS jobs,
      (SELECT COUNT(DISTINCT state) FROM caregiver_jobs WHERE is_published=1 AND status='current') AS states,
      (SELECT COUNT(*) FROM caregiver_jobs WHERE is_published=1 AND status='current' AND first_seen_at>=datetime('now','-7 days')) AS new_this_week,
      (SELECT COUNT(*) FROM agency_job_scan_state WHERE last_scanned_at>=datetime('now','-7 days')) AS employers_watched`).first<Row>();
  // Newest openings that list pay, one per employer so a single big posting run doesn't fill the preview.
  const rows=(await env.DB.prepare(`SELECT id,title,employer_name,city,state,pay_min,pay_max,first_seen_at,source_url FROM caregiver_jobs
    WHERE is_published=1 AND status='current' AND pay_max IS NOT NULL AND COALESCE(employer_name,'')!='' AND COALESCE(city,'')!=''
    ORDER BY first_seen_at DESC LIMIT 40`).all<Row>()).results||[];
  const seen=new Set<string>();
  const latest:HomeJob[]=[];
  for(const r of rows){
    const employerName=clean(r.employer_name,120);
    if(seen.has(employerName.toLowerCase()))continue;
    seen.add(employerName.toLowerCase());
    latest.push({id:clean(r.id,80),title:clean(r.title,120),employerName,city:clean(r.city,80),state:clean(r.state,4),
      payMin:num(r.pay_min),payMax:num(r.pay_max),firstSeenAt:clean(r.first_seen_at,40),applyForMe:!!detectApplyProvider(clean(r.source_url,1000))});
    if(latest.length>=4)break;
  }
  return {jobs:num(totals?.jobs)||0,states:num(totals?.states)||0,employersWatched:num(totals?.employers_watched)||0,newThisWeek:num(totals?.new_this_week)||0,latest};
}

export async function homeStatsResponse(env:FeatureEnv){
  const stats=await homeStats(env);
  return new Response(JSON.stringify({ok:true,...stats}),{headers:{'content-type':'application/json; charset=utf-8','cache-control':'public,max-age=600'}});
}

