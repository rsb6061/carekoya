import { useEffect, useState } from 'react';
import { CaregiverOnboarding } from './CaregiverOnboarding';
import { jobsHubPath, usState } from './usStates';
import { SiteFooter, SiteHeader } from './SiteChrome';
import { descriptionBlocks, payLabel, pillLabel } from './jobFormat';
import './styles.css';

type Job={
  id:string;title:string;role:string;roles?:string[];employerName:string;city?:string;state?:string;zip?:string;
  employmentType?:string;payMin?:number|null;payMax?:number|null;payPeriod?:string;description?:string;sourceUrl:string;
  datePosted?:string;lastSeenAt?:string;lastCheckedAt?:string;
};

type JobContext={
  similar:{id:string;title:string;employerName:string;city:string;state:string;pay:string;distanceMiles:number|null}[];
  employer:{name:string;city:string;state:string;providerTypes:string;website:string;otherOpenJobs:number}|null;
  payContext:{role:string;state:string;median:number;count:number;unit:string;position:'above'|'near'|'below'|null}|null;
};

function employmentPills(value?:string){
  return (value||'').split(/[,;|]+/).map(v=>pillLabel(v)).filter(Boolean);
}

export function CaregiverJobPage(){
  const id=decodeURIComponent(window.location.pathname.split('/').filter(Boolean)[1]||'');
  const [job,setJob]=useState<Job|null>(null);
  const [loading,setLoading]=useState(true);
  const [applyOpen,setApplyOpen]=useState(()=>window.location.hash==='#apply');
  const [context,setContext]=useState<JobContext|null>(null);
  const [leaving,setLeaving]=useState(false);

  useEffect(()=>{
    fetch('/api/public/caregiver-jobs/'+encodeURIComponent(id))
      .then(async r=>{const body=await r.json();if(!r.ok)throw new Error(body.error||'Job not found');return body})
      .then((body:any)=>setJob(body.job))
      .catch(()=>setJob(null))
      .finally(()=>setLoading(false));
    fetch('/api/public/caregiver-jobs/'+encodeURIComponent(id)+'/context').then(r=>r.ok?r.json():null).then((body:any)=>{if(body?.ok)setContext(body)}).catch(()=>{});
  },[id]);

  // Quick apply: straight to the employer's own application, recorded so CareJoys can count it.
  async function applyOnEmployerSite(){
    if(!job)return;
    setLeaving(true);
    try{
      const res=await fetch('/api/public/caregiver-jobs/'+encodeURIComponent(job.id)+'/apply',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
      const body=await res.json() as {applicationUrl?:string};
      window.location.href=body.applicationUrl||job.sourceUrl;
    }catch{window.location.href=job.sourceUrl}
  }

  if(loading)return <main className="job-detail-shell"><div className="wrap"><div className="empty">Loading job…</div></div></main>;
  if(!job)return <main className="job-detail-shell"><div className="wrap"><a className="text-link" href="/caregiver-jobs/maryland">← Caregiver jobs</a><div className="empty"><strong>This job is no longer available.</strong></div></div></main>;

  const location=[job.city,job.state,job.zip].filter(Boolean).join(', ');
  const payText=payLabel(job);
  const description=job.description?descriptionBlocks(job.description):null;
  const state=usState(job.state||'');
  const hubHref=state?jobsHubPath(state):'/caregiver-jobs/maryland';

  return <div>
    <SiteHeader jobsHref={hubHref}/>
    <main className="job-detail-shell">
      <div className="wrap job-detail-wrap">
        <a className="text-link job-back-link" href={hubHref}>← All {state?state.name:''} caregiver jobs</a>
        <section className="job-detail-card">
          <div className="modal-kicker">{pillLabel(job.role)}{state?' · '+state.name:''}</div>
          <h1>{job.title}</h1>
          <div className="job-detail-employer">{job.employerName}</div>
          <div className="job-tags">
            {location&&<span className="pill">{location}</span>}
            {(job.roles?.length?job.roles:[job.role]).map(role=><span className="pill" key={role}>{pillLabel(role)}</span>)}
            {employmentPills(job.employmentType).map(type=><span className="pill" key={type}>{type}</span>)}
            {payText&&<span className="pill">{payText}</span>}
          </div>
          <div className="job-detail-actions">
            <button className="btn job-apply-primary" onClick={()=>setApplyOpen(true)}>Apply</button>
            <button className="btn secondary" onClick={applyOnEmployerSite} disabled={leaving}>{leaving?'Opening…':'Quick apply on '+job.employerName+'’s site'}</button>
          </div>
          <div className="job-detail-source">CareJoys verified this opening from the employer’s public careers page. Last checked {job.lastCheckedAt?new Date(job.lastCheckedAt).toLocaleDateString():new Date(job.lastSeenAt||Date.now()).toLocaleDateString()}.</div>
        </section>

        {description&&<section className="section job-description-section"><h2>About this job</h2>{description.lead&&<p>{description.lead}</p>}{description.bullets.length>0&&<ul className="job-description-list">{description.bullets.map((b,i)=><li key={i}>{b}</li>)}</ul>}</section>}
        {context?.payContext&&<section className="section job-description-section"><h2>Pay for {context.payContext.role} jobs in {context.payContext.state}</h2><p>The median advertised pay across {context.payContext.count} current {context.payContext.role} jobs in {context.payContext.state} is ${context.payContext.median.toFixed(2)}/hr{context.payContext.position?<>; this job is <strong>{context.payContext.position}</strong> that median.</>:'.'}</p></section>}
        {context?.employer&&<section className="section job-description-section"><h2>About {context.employer.name}</h2>
          <p>{[context.employer.providerTypes,[context.employer.city,context.employer.state].filter(Boolean).join(', ')].filter(Boolean).join(' · ')}</p>
          {context.employer.otherOpenJobs>0&&<p>{context.employer.otherOpenJobs} other current opening{context.employer.otherOpenJobs===1?'':'s'} at this employer on CareJoys.</p>}
          {context.employer.website&&<a className="text-link" href={context.employer.website} target="_blank" rel="noreferrer">Employer website ↗</a>}
        </section>}
        {context&&context.similar.length>0&&<section className="section job-description-section"><h2>Similar caregiver jobs nearby</h2>
          <div className="jobs">{context.similar.map(j=><article className="job" key={j.id}><div><h3><a href={'/jobs/'+encodeURIComponent(j.id)}>{j.title}</a></h3><div className="meta">{[j.employerName,[j.city,j.state].filter(Boolean).join(', '),j.pay,j.distanceMiles!==null?j.distanceMiles+' mi away':''].filter(Boolean).join(' · ')}</div></div></article>)}</div>
        </section>}
        <p className="job-detail-source"><a className="text-link" href={job.sourceUrl} target="_blank" rel="noreferrer nofollow">Original employer listing ↗</a></p>
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

    <SiteFooter/>
  </div>;
}
