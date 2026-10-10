import { useEffect, useState } from 'react';
import { HomeJobPreview } from './HomeJobPreview';

type HomeJob={id:string;title:string;employerName:string;city:string;state:string;payMin:number|null;payMax:number|null;firstSeenAt:string;applyForMe:boolean};
type Stats={jobs:number;states:number;employersWatched:number;newThisWeek:number;latest:HomeJob[]};

// Rounded down to the hundred so the claim stays true between refreshes.
const rounded=(n:number)=>n<1000?n.toLocaleString('en-US'):(Math.floor(n/100)*100).toLocaleString('en-US')+'+';
// "22k+": rounded down to the thousand.
const thousands=(n:number)=>Math.floor(n/1000)+'k+';
const pay=(j:HomeJob)=>{
  const fmt=(n:number)=>'$'+(Number.isInteger(n)?n:n.toFixed(2));
  if(j.payMin&&j.payMax&&j.payMin!==j.payMax)return fmt(j.payMin)+'–'+fmt(j.payMax)+'/hr';
  return j.payMax?fmt(j.payMax)+'/hr':'';
};

// One request serves both the hero and the dashboard section.
let statsRequest:Promise<Stats|null>|null=null;
function useHomeStats(){
  const [stats,setStats]=useState<Stats|null>(null);
  useEffect(()=>{
    statsRequest??=fetch('/api/public/home-stats').then(r=>r.ok?r.json():null).then(b=>b?.ok?b as Stats:null).catch(()=>null);
    let live=true;
    statsRequest.then(s=>{if(live)setStats(s)});
    return ()=>{live=false};
  },[]);
  return stats;
}

export function HomeHero(){
  const stats=useHomeStats();
  const watched=stats&&stats.employersWatched>=1000?thousands(stats.employersWatched)+' ':'';
  return <section className="hero home-ai-hero">
    <div className="wrap">
      <h1>
        <span className="hero-title-line">Match with the best CNA and caregiver jobs near you.</span>{' '}
        <span className="hero-title-accent">Let AI do the legwork.</span>
      </h1>
      <p>CareJoys finds jobs from {watched}home-care agencies and assisted living facilities and matches you with the best ones, automatically.</p>
      <HomeJobPreview/>
    </div>
  </section>;
}

export function HomeMatchesSection(){
  const stats=useHomeStats();
  return <section className="section" id="matches">
    <div className="wrap">
      <h2>Automatically matching caregivers with the best jobs</h2>
      <DashboardPreview stats={stats}/>
    </div>
  </section>;
}

// A scaled-down copy of the real caregiver dashboard (/dashboard), filled with the newest real openings.
const TONES=['sky','mint','lilac','peach'];
function DashboardPreview({stats}:{stats:Stats|null}){
  const jobs=stats?.latest||[];
  return <div className="dash-preview" aria-label="Preview of the CareJoys caregiver dashboard">
    <div className="dash-bar" aria-hidden="true">
      <span className="dash-brand">CareJoys</span>
      <span className="dash-bar-links"><span>Jobs</span><span className="dash-account"><span className="dash-avatar">M</span>Maria ▾</span></span>
    </div>
    <div className="dash-layout-mock">
    <div className="dash-side" aria-hidden="true">
      <div className="dash-side-label">Dashboard</div>
      <span className="active">My matches</span><span>Applications</span><span>Weekly email</span><span>Resume</span><span>Profile</span>
    </div>
    <div className="dash-body">
      <div className="dash-head">
        <div><div className="dash-hi">Hi Maria.</div><div className="dash-sub">CNA · Baltimore · MD</div></div>
        <span className="dash-pill" aria-hidden="true"><span className="dash-ring"/>Edit profile<span className="dash-pct">80% complete</span></span>
      </div>
      <div className="dash-section-head"><strong>Best matches near you</strong><span>Ranked by your credentials, pay and distance.</span></div>
      <div className="dash-cards">
        {jobs.length?jobs.map((j,i)=><a key={j.id} className={'dash-card dash-'+TONES[i%4]} href={'/jobs/'+encodeURIComponent(j.id)}>
          <strong>{j.title}</strong>
          <span className="dash-card-meta">{j.employerName} · {j.city}, {j.state}</span>
          {pay(j)&&<span className="dash-badge">{pay(j)}</span>}
          <span className="dash-apply">{j.applyForMe?'Apply for me':'Apply'}</span>
        </a>):[0,1,2,3].map(i=><div key={i} className={'dash-card skeleton dash-'+TONES[i]} aria-hidden="true"/>)}
      </div>
    </div>
    </div>
  </div>;
}
