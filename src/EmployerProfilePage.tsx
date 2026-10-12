import { useEffect, useState } from 'react';
import { CaregiverOnboarding } from './CaregiverOnboarding';
import { SiteFooter, SiteHeader } from './SiteChrome';
import type { EmployerProfile } from './employerProfile';
import './styles.css';

/** An employer's public page at /employers/<name>-<id>: who they are, About, Benefits and their open jobs. */
export function EmployerProfilePage(){
  const slug=decodeURIComponent(window.location.pathname.split('/').filter(Boolean).pop()||'');
  const [employer,setEmployer]=useState<EmployerProfile|null>(null);
  const [error,setError]=useState('');

  useEffect(()=>{
    fetch('/api/public/employer/'+encodeURIComponent(slug))
      .then(async res=>{const body=await res.json().catch(()=>({})) as {employer?:EmployerProfile;error?:string};if(!res.ok||!body.employer)throw new Error(body.error||'This employer page isn’t available.');return body.employer})
      .then(e=>{setEmployer(e);document.title=e.name+': Caregiver Jobs | CareJoys'})
      .catch(err=>setError(err instanceof Error?err.message:'This employer page isn’t available.'));
  },[slug]);

  if(error)return <div className="activation-shell"><SiteHeader/><div className="activation-card"><div className="activation-kicker">CareJoys</div><h1>Employer not found.</h1><p>{error}</p></div></div>;
  if(!employer)return <div className="loading-screen">Loading CareJoys…</div>;

  const where=[employer.city,employer.state].filter(Boolean).join(', ');
  return <div>
    <SiteHeader/>
    <main>
      <section className="resume-hero"><div className="wrap resume-hero-grid">
        <div>
          <div className="modal-kicker">{['Caregiver employer',where].filter(Boolean).join(' · ')}</div>
          <h1>{employer.name}</h1>
          {employer.about&&<p>{employer.about}</p>}
          <div className="resume-points">
            <span>{employer.jobs.length?employer.jobs.length+' open job'+(employer.jobs.length===1?'':'s'):'Hiring on CareJoys'}</span>
            {employer.providerTypes&&<span>{employer.providerTypes}</span>}
            {employer.website&&<a className="text-link" href={employer.website} target="_blank" rel="noreferrer nofollow">Website ↗</a>}
          </div>
        </div>
        <div className="campaign-form-card"><CaregiverOnboarding /></div>
      </div></section>

      {employer.benefits&&<section className="section"><div className="wrap">
        <h2>Benefits</h2>
        <p>{employer.benefits}</p>
      </div></section>}

      <section className="section"><div className="wrap">
        <h2>Open jobs</h2>
        {employer.jobs.length?<div className="jobs caregiver-public-job-list">
          {employer.jobs.map(j=><article className="job" key={j.id}>
            <div>
              <h3>{j.jobPath?<a href={j.jobPath}>{j.title}</a>:j.title}</h3>
              <div className="meta">{[j.role,[j.city,j.state].filter(Boolean).join(', '),j.shift].filter(Boolean).join(' · ')}</div>
              {j.pay&&<div className="job-tags"><span className="pill">{j.pay}</span></div>}
            </div>
            <div className="public-job-actions"><a className="btn job-apply-primary" href={j.jobPath||'/caregiver-resume'}>{j.jobPath?'Apply':'Get matched'}</a></div>
          </article>)}
        </div>:<div className="empty"><strong>No open jobs right now.</strong> <a className="text-link" href="/caregiver-jobs">Browse caregiver jobs near you</a>.</div>}
      </div></section>
    </main>
    <SiteFooter/>
  </div>;
}
