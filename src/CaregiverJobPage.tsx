import { useEffect, useState } from 'react';
import { CaregiverOnboarding } from './CaregiverOnboarding';
import './styles.css';

type Job={
  id:string;title:string;role:string;employerName:string;city?:string;state?:string;zip?:string;
  employmentType?:string;payMin?:number|null;payMax?:number|null;description?:string;sourceUrl:string;
  datePosted?:string;lastSeenAt?:string;lastCheckedAt?:string;
};

function pay(job:Job){
  const min=Number(job.payMin||0),max=Number(job.payMax||0);
  if(min&&max)return '$'+min+'–$'+max+'/hr';
  if(min)return 'From $'+min+'/hr';
  if(max)return 'Up to $'+max+'/hr';
  return '';
}

export function CaregiverJobPage(){
  const id=decodeURIComponent(window.location.pathname.split('/').filter(Boolean)[1]||'');
  const [job,setJob]=useState<Job|null>(null);
  const [loading,setLoading]=useState(true);
  const [applyOpen,setApplyOpen]=useState(false);

  useEffect(()=>{
    fetch('/api/public/caregiver-jobs/'+encodeURIComponent(id))
      .then(async r=>{const body=await r.json();if(!r.ok)throw new Error(body.error||'Job not found');return body})
      .then((body:any)=>{setJob(body.job);document.title=body.job.title+' | '+body.job.employerName+' | CareJoys'})
      .catch(()=>setJob(null))
      .finally(()=>setLoading(false));
  },[id]);

  if(loading)return <main className="job-detail-shell"><div className="wrap"><div className="empty">Loading job…</div></div></main>;
  if(!job)return <main className="job-detail-shell"><div className="wrap"><a className="text-link" href="/caregiver-jobs/maryland">← Caregiver jobs</a><div className="empty"><strong>This job is no longer available.</strong></div></div></main>;

  const location=[job.city,job.state,job.zip].filter(Boolean).join(', ');
  const payText=pay(job);

  return <div>
    <header className="nav"><div className="wrap nav-inner"><a className="brand" href="/">CareJoys</a><nav className="navlinks"><a href="/caregiver-jobs/maryland">Caregiver jobs</a><a href="/training-programs/maryland">Training programs</a></nav></div></header>
    <main className="job-detail-shell">
      <div className="wrap job-detail-wrap">
        <a className="text-link job-back-link" href="/caregiver-jobs/maryland">← All Maryland caregiver jobs</a>
        <section className="job-detail-card">
          <div className="modal-kicker">{job.role} · Maryland</div>
          <h1>{job.title}</h1>
          <div className="job-detail-employer">{job.employerName}</div>
          <div className="job-tags">
            {location&&<span className="pill">{location}</span>}
            {job.employmentType&&<span className="pill">{job.employmentType}</span>}
            {payText&&<span className="pill">{payText}</span>}
          </div>
          <div className="job-detail-actions">
            <button className="btn job-apply-primary" onClick={()=>setApplyOpen(true)}>Apply</button>
            <a className="text-link" href={job.sourceUrl} target="_blank" rel="noreferrer">Original employer listing ↗</a>
          </div>
          <div className="job-detail-source">CareJoys verified this opening from the employer’s public careers page. Last checked {job.lastCheckedAt?new Date(job.lastCheckedAt).toLocaleDateString():new Date(job.lastSeenAt||Date.now()).toLocaleDateString()}.</div>
        </section>

        {job.description&&<section className="section job-description-section"><h2>About this job</h2><p>{job.description}</p></section>}
      </div>
    </main>

    {applyOpen&&<div className="modal-backdrop" onMouseDown={()=>setApplyOpen(false)}>
      <div className="modal-panel caregiver-apply-modal" onMouseDown={e=>e.stopPropagation()}>
        <button className="modal-close" onClick={()=>setApplyOpen(false)} aria-label="Close">×</button>
        <CaregiverOnboarding
          compact
          targetJobId={job.id}
          heading="Upload your resume to apply"
          subheading={'We’ll build your CareJoys profile, ask only for anything missing, then send you to '+job.employerName+' to finish the application.'}
        />
      </div>
    </div>}

    <footer className="footer"><div className="wrap">CareJoys · <a href="/caregiver-jobs/maryland">Caregiver jobs</a> · <a href="/privacy-policy">Privacy</a> · <a href="/terms-of-service">Terms</a></div></footer>
  </div>;
}
