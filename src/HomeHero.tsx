import { useEffect, useState } from 'react';
import { Bell, Bot, LayoutGrid, Mail, MessageCircle, Search, Send, Sparkles } from 'lucide-react';
import { HomeJobPreview } from './HomeJobPreview';

type HomeJob={id:string;title:string;employerName:string;city:string;state:string;payMin:number|null;payMax:number|null;firstSeenAt:string;applyForMe:boolean};
type Stats={jobs:number;states:number;employersWatched:number;newThisWeek:number;latest:HomeJob[]};

// Rounded down to the hundred so the claim stays true between refreshes.
const rounded=(n:number)=>n<1000?n.toLocaleString('en-US'):(Math.floor(n/100)*100).toLocaleString('en-US')+'+';
const pay=(j:HomeJob)=>{
  const fmt=(n:number)=>'$'+(Number.isInteger(n)?n:n.toFixed(2));
  if(j.payMin&&j.payMax&&j.payMin!==j.payMax)return fmt(j.payMin)+'–'+fmt(j.payMax)+'/hr';
  return j.payMax?fmt(j.payMax)+'/hr':'';
};
function ago(sqlTime:string){
  const t=Date.parse(sqlTime.replace(' ','T')+'Z');
  if(!Number.isFinite(t))return 'New';
  const mins=Math.max(1,Math.round((Date.now()-t)/60000));
  if(mins<60)return 'Found '+mins+' min ago';
  const hours=Math.round(mins/60);
  if(hours<24)return 'Found '+hours+' hr ago';
  const days=Math.round(hours/24);
  return 'Found '+days+(days===1?' day':' days')+' ago';
}
const TINTS=['#fff3c9','#dcf5e7','#e6e1ff','#ffe1e6'];

export function HomeHero(){
  const [stats,setStats]=useState<Stats|null>(null);
  useEffect(()=>{
    fetch('/api/public/home-stats').then(r=>r.ok?r.json():null).then(b=>{if(b?.ok)setStats(b)}).catch(()=>{});
  },[]);
  const watched=stats?.employersWatched?rounded(stats.employersWatched)+' ':'';
  return <section className="hero home-ai-hero">
    <div className="wrap">
      <div className="ai-badge"><Sparkles size={15} aria-hidden="true"/> AI job agent for caregivers <span>Free</span></div>
      <h1>
        <span className="hero-title-line">Be first to every better-paying CNA and caregiver job near you.</span>{' '}
        <span className="hero-title-accent">Let AI do the legwork.</span>
      </h1>
      <p>CareJoys checks the job pages of {watched&&<strong>{watched}</strong>}home-care agencies, nursing homes and senior-care employers every week and shows you new openings with pay. On jobs marked <strong>Apply&nbsp;for&nbsp;me</strong>, CareJoys AI fills in the employer’s application from your free profile.</p>
      <HomeJobPreview/>
      <div className="also-on">
        <span>Also available in</span>
        <a href="/agent"><Bot size={15} aria-hidden="true"/> Claude</a>
        <a href="/agent"><MessageCircle size={15} aria-hidden="true"/> ChatGPT</a>
        <a href="/caregiver-resume"><Mail size={15} aria-hidden="true"/> Weekly job email</a>
      </div>
      <DashboardPreview stats={stats}/>
    </div>
  </section>;
}

// A picture of the caregiver dashboard, filled with the newest real openings so it never shows made-up jobs.
function DashboardPreview({stats}:{stats:Stats|null}){
  const jobs=stats?.latest||[];
  return <div className="dash-preview" aria-label="Preview of the CareJoys caregiver dashboard">
    <aside className="dash-side" aria-hidden="true">
      <div className="dash-brand"><span>C</span> CareJoys</div>
      <div className="dash-nav-label">Dashboard</div>
      <div className="dash-nav active"><LayoutGrid size={15}/> My matches</div>
      <div className="dash-nav"><Search size={15}/> Browse jobs</div>
      <div className="dash-nav"><Send size={15}/> Applications</div>
      <div className="dash-nav"><Mail size={15}/> Weekly email</div>
    </aside>
    <div className="dash-main">
      <div className="dash-top">
        <strong>New jobs CareJoys found</strong>
        <span className="dash-search"><Search size={14} aria-hidden="true"/> CNA, caregiver, GNA…</span>
        <Bell size={17} aria-hidden="true" className="dash-bell"/>
      </div>
      {stats&&<div className="dash-stats">
        <div><b>{stats.jobs.toLocaleString('en-US')}</b><span>open caregiver jobs</span></div>
        <div><b>{stats.newThisWeek.toLocaleString('en-US')}</b><span>found this week</span></div>
        <div><b>{rounded(stats.employersWatched)}</b><span>employers checked weekly</span></div>
      </div>}
      <div className="dash-cards">
        {jobs.length?jobs.map((j,i)=><a key={j.id} className="dash-card" href={'/jobs/'+encodeURIComponent(j.id)} style={{background:TINTS[i%TINTS.length]}}>
          <span className="dash-card-employer">{j.employerName}</span>
          <strong>{j.title}</strong>
          <span className="dash-card-meta">{j.city}, {j.state}{pay(j)?' · '+pay(j):''}</span>
          <span className="dash-card-foot"><em>{ago(j.firstSeenAt)}</em>{j.applyForMe&&<span className="dash-chip"><Sparkles size={12} aria-hidden="true"/> Apply for me</span>}</span>
        </a>):[0,1,2,3].map(i=><div key={i} className="dash-card skeleton" style={{background:TINTS[i]}} aria-hidden="true"/>)}
      </div>
    </div>
  </div>;
}
