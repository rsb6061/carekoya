import { useEffect, useState } from 'react';
import { CaregiverOnboarding } from './CaregiverOnboarding';
import './styles.css';

type PublicCaregiverJob={
  id:string;title:string;role:string;employerName:string;city?:string;state?:string;zip?:string;
  employmentType?:string;payMin?:number|null;payMax?:number|null;sourceUrl:string;datePosted?:string;lastSeenAt?:string;
};

function payLabel(job:PublicCaregiverJob){
  const min=Number(job.payMin||0),max=Number(job.payMax||0);
  if(min&&max)return '

export function MarylandCaregiverPage(){
  const referralSlug=window.location.pathname.startsWith('/join/')
    ?decodeURIComponent(window.location.pathname.split('/').filter(Boolean)[1]||'')
    :'';
  const [program,setProgram]=useState<{name:string;city?:string;state?:string;zip?:string;providerType?:string}|null>(null);
  const [jobs,setJobs]=useState<PublicCaregiverJob[]>([]);
  const [jobsLoading,setJobsLoading]=useState(!referralSlug);

  useEffect(()=>{
    document.title='Caregiver Jobs in Maryland | CareJoys';
    if(referralSlug){
      fetch('/api/public/training-program/'+encodeURIComponent(referralSlug))
        .then(r=>r.json())
        .then((data:any)=>{
          if(data?.program){setProgram(data.program);document.title='CareJoys for '+data.program.name}
        }).catch(()=>{});
    }else{
      fetch('/api/public/caregiver-jobs?limit=24')
        .then(r=>r.json())
        .then((data:any)=>{if(Array.isArray(data?.jobs))setJobs(data.jobs)})
        .catch(()=>{})
        .finally(()=>setJobsLoading(false));
    }
  },[referralSlug]);

  return <div>
    <header className="nav"><div className="wrap nav-inner">
      <a className="brand" href="/">CareJoys</a>
      <nav className="navlinks"><a href="/training-programs/maryland">Training programs</a><a href="/hire-caregivers/maryland">For employers</a></nav>
    </div></header>

    <main className="maryland-caregiver-page">
      <section className="caregiver-campaign-hero"><div className="wrap caregiver-campaign-grid">
        <div>
          <div className="modal-kicker">{program?program.name:'Maryland caregivers'}</div>
          <h1>{program?'Get matched after training.':'Caregiver jobs in Maryland'}</h1>
          <p>{program
            ?'Upload your resume once. CareJoys builds your caregiver profile and matches you with Maryland care employers.'
            :'Upload your resume once. CareJoys matches you with caregiver jobs and employers near you.'}</p>
        </div>

        <div className="campaign-form-card" id="caregiver-profile">
          <CaregiverOnboarding referralSlug={referralSlug} />
        </div>
      </div></section>

      {!referralSlug&&<section className="section caregiver-jobs-section" id="current-jobs"><div className="wrap">
        <div className="section-heading">
          <div>
            <div className="modal-kicker">Current openings</div>
            <h2>Current caregiver jobs in Maryland</h2>
            <p>Verified from care-employer career pages. Open a job on CareJoys, then apply with the same reusable profile.</p>
          </div>
        </div>

        {jobsLoading
          ?<div className="empty"><strong>Loading current openings…</strong></div>
          :jobs.length===0
            ?<div className="empty"><strong>CareJoys is adding verified Maryland caregiver jobs now.</strong><div>Upload your resume above and we’ll match you as openings are confirmed.</div></div>
            :<div className="jobs caregiver-public-job-list">
              {jobs.map(job=>{
                const pay=payLabel(job);
                const href='/jobs/'+encodeURIComponent(job.id);
                return <article className="job" key={job.id}>
                  <div>
                    <h3><a href={href}>{job.title}</a></h3>
                    <div className="meta">{[job.employerName,[job.city,job.state].filter(Boolean).join(', ')||job.zip].filter(Boolean).join(' · ')}</div>
                    <div className="job-tags">
                      <span className="pill">{pillLabel(job.role)}</span>
                      {employmentPills(job.employmentType).map(type=><span className="pill" key={type}>{type}</span>)}
                      {pay&&<span className="pill">{pay}</span>}
                    </div>
                  </div>
                  <div className="public-job-actions">
                    <a className="btn job-apply-primary" href={href}>Apply</a>
                  </div>
                </article>;
              })}
            </div>}
      </div></section>}

      <section className="section"><div className="wrap">
        <h2>One profile. Relevant jobs. Your choice.</h2>
        <div className="jobs">
          <div className="job"><div><h3>Upload once</h3><div className="meta">CareJoys extracts your experience, credentials and caregiver skills.</div></div><div className="meta">01</div></div>
          <div className="job"><div><h3>Fill only the gaps</h3><div className="meta">Confirm anything missing plus shifts, pay, transportation and travel radius.</div></div><div className="meta">02</div></div>
          <div className="job"><div><h3>Apply and get matched</h3><div className="meta">Use the same profile for current jobs and future employer matches.</div></div><div className="meta">03</div></div>
        </div>
      </div></section>
    </main>

    <footer className="footer"><div className="wrap">CareJoys · <a href="/privacy-policy">Privacy</a> · <a href="/terms-of-service">Terms</a></div></footer>
  </div>;
}
+min+'–

export function MarylandCaregiverPage(){
  const referralSlug=window.location.pathname.startsWith('/join/')
    ?decodeURIComponent(window.location.pathname.split('/').filter(Boolean)[1]||'')
    :'';
  const [program,setProgram]=useState<{name:string;city?:string;state?:string;zip?:string;providerType?:string}|null>(null);
  const [jobs,setJobs]=useState<PublicCaregiverJob[]>([]);
  const [jobsLoading,setJobsLoading]=useState(!referralSlug);

  useEffect(()=>{
    document.title='Caregiver Jobs in Maryland | CareJoys';
    if(referralSlug){
      fetch('/api/public/training-program/'+encodeURIComponent(referralSlug))
        .then(r=>r.json())
        .then((data:any)=>{
          if(data?.program){setProgram(data.program);document.title='CareJoys for '+data.program.name}
        }).catch(()=>{});
    }else{
      fetch('/api/public/caregiver-jobs?limit=24')
        .then(r=>r.json())
        .then((data:any)=>{if(Array.isArray(data?.jobs))setJobs(data.jobs)})
        .catch(()=>{})
        .finally(()=>setJobsLoading(false));
    }
  },[referralSlug]);

  return <div>
    <header className="nav"><div className="wrap nav-inner">
      <a className="brand" href="/">CareJoys</a>
      <nav className="navlinks"><a href="/training-programs/maryland">Training programs</a><a href="/hire-caregivers/maryland">For employers</a></nav>
    </div></header>

    <main className="maryland-caregiver-page">
      <section className="caregiver-campaign-hero"><div className="wrap caregiver-campaign-grid">
        <div>
          <div className="modal-kicker">{program?program.name:'Maryland caregivers'}</div>
          <h1>{program?'Get matched after training.':'Caregiver jobs in Maryland'}</h1>
          <p>{program
            ?'Upload your resume once. CareJoys builds your caregiver profile and matches you with Maryland care employers.'
            :'Upload your resume once. CareJoys matches you with caregiver jobs and employers near you.'}</p>
        </div>

        <div className="campaign-form-card" id="caregiver-profile">
          <CaregiverOnboarding referralSlug={referralSlug} />
        </div>
      </div></section>

      {!referralSlug&&<section className="section caregiver-jobs-section" id="current-jobs"><div className="wrap">
        <div className="section-heading">
          <div>
            <div className="modal-kicker">Current openings</div>
            <h2>Current caregiver jobs in Maryland</h2>
            <p>Verified from care-employer career pages. Open a job on CareJoys, then apply with the same reusable profile.</p>
          </div>
        </div>

        {jobsLoading
          ?<div className="empty"><strong>Loading current openings…</strong></div>
          :jobs.length===0
            ?<div className="empty"><strong>CareJoys is adding verified Maryland caregiver jobs now.</strong><div>Upload your resume above and we’ll match you as openings are confirmed.</div></div>
            :<div className="jobs caregiver-public-job-list">
              {jobs.map(job=>{
                const pay=payLabel(job);
                const href='/jobs/'+encodeURIComponent(job.id);
                return <article className="job" key={job.id}>
                  <div>
                    <h3><a href={href}>{job.title}</a></h3>
                    <div className="meta">{[job.employerName,[job.city,job.state].filter(Boolean).join(', ')||job.zip].filter(Boolean).join(' · ')}</div>
                    <div className="job-tags">
                      <span className="pill">{job.role}</span>
                      {job.employmentType&&<span className="pill">{job.employmentType}</span>}
                      {pay&&<span className="pill">{pay}</span>}
                    </div>
                  </div>
                  <div className="public-job-actions">
                    <a className="btn job-apply-primary" href={href}>Apply</a>
                  </div>
                </article>;
              })}
            </div>}
      </div></section>}

      <section className="section"><div className="wrap">
        <h2>One profile. Relevant jobs. Your choice.</h2>
        <div className="jobs">
          <div className="job"><div><h3>Upload once</h3><div className="meta">CareJoys extracts your experience, credentials and caregiver skills.</div></div><div className="meta">01</div></div>
          <div className="job"><div><h3>Fill only the gaps</h3><div className="meta">Confirm anything missing plus shifts, pay, transportation and travel radius.</div></div><div className="meta">02</div></div>
          <div className="job"><div><h3>Apply and get matched</h3><div className="meta">Use the same profile for current jobs and future employer matches.</div></div><div className="meta">03</div></div>
        </div>
      </div></section>
    </main>

    <footer className="footer"><div className="wrap">CareJoys · <a href="/privacy-policy">Privacy</a> · <a href="/terms-of-service">Terms</a></div></footer>
  </div>;
}
+max+'/hr';
  if(min)return 'From 

export function MarylandCaregiverPage(){
  const referralSlug=window.location.pathname.startsWith('/join/')
    ?decodeURIComponent(window.location.pathname.split('/').filter(Boolean)[1]||'')
    :'';
  const [program,setProgram]=useState<{name:string;city?:string;state?:string;zip?:string;providerType?:string}|null>(null);
  const [jobs,setJobs]=useState<PublicCaregiverJob[]>([]);
  const [jobsLoading,setJobsLoading]=useState(!referralSlug);

  useEffect(()=>{
    document.title='Caregiver Jobs in Maryland | CareJoys';
    if(referralSlug){
      fetch('/api/public/training-program/'+encodeURIComponent(referralSlug))
        .then(r=>r.json())
        .then((data:any)=>{
          if(data?.program){setProgram(data.program);document.title='CareJoys for '+data.program.name}
        }).catch(()=>{});
    }else{
      fetch('/api/public/caregiver-jobs?limit=24')
        .then(r=>r.json())
        .then((data:any)=>{if(Array.isArray(data?.jobs))setJobs(data.jobs)})
        .catch(()=>{})
        .finally(()=>setJobsLoading(false));
    }
  },[referralSlug]);

  return <div>
    <header className="nav"><div className="wrap nav-inner">
      <a className="brand" href="/">CareJoys</a>
      <nav className="navlinks"><a href="/training-programs/maryland">Training programs</a><a href="/hire-caregivers/maryland">For employers</a></nav>
    </div></header>

    <main className="maryland-caregiver-page">
      <section className="caregiver-campaign-hero"><div className="wrap caregiver-campaign-grid">
        <div>
          <div className="modal-kicker">{program?program.name:'Maryland caregivers'}</div>
          <h1>{program?'Get matched after training.':'Caregiver jobs in Maryland'}</h1>
          <p>{program
            ?'Upload your resume once. CareJoys builds your caregiver profile and matches you with Maryland care employers.'
            :'Upload your resume once. CareJoys matches you with caregiver jobs and employers near you.'}</p>
        </div>

        <div className="campaign-form-card" id="caregiver-profile">
          <CaregiverOnboarding referralSlug={referralSlug} />
        </div>
      </div></section>

      {!referralSlug&&<section className="section caregiver-jobs-section" id="current-jobs"><div className="wrap">
        <div className="section-heading">
          <div>
            <div className="modal-kicker">Current openings</div>
            <h2>Current caregiver jobs in Maryland</h2>
            <p>Verified from care-employer career pages. Open a job on CareJoys, then apply with the same reusable profile.</p>
          </div>
        </div>

        {jobsLoading
          ?<div className="empty"><strong>Loading current openings…</strong></div>
          :jobs.length===0
            ?<div className="empty"><strong>CareJoys is adding verified Maryland caregiver jobs now.</strong><div>Upload your resume above and we’ll match you as openings are confirmed.</div></div>
            :<div className="jobs caregiver-public-job-list">
              {jobs.map(job=>{
                const pay=payLabel(job);
                const href='/jobs/'+encodeURIComponent(job.id);
                return <article className="job" key={job.id}>
                  <div>
                    <h3><a href={href}>{job.title}</a></h3>
                    <div className="meta">{[job.employerName,[job.city,job.state].filter(Boolean).join(', ')||job.zip].filter(Boolean).join(' · ')}</div>
                    <div className="job-tags">
                      <span className="pill">{job.role}</span>
                      {job.employmentType&&<span className="pill">{job.employmentType}</span>}
                      {pay&&<span className="pill">{pay}</span>}
                    </div>
                  </div>
                  <div className="public-job-actions">
                    <a className="btn job-apply-primary" href={href}>Apply</a>
                  </div>
                </article>;
              })}
            </div>}
      </div></section>}

      <section className="section"><div className="wrap">
        <h2>One profile. Relevant jobs. Your choice.</h2>
        <div className="jobs">
          <div className="job"><div><h3>Upload once</h3><div className="meta">CareJoys extracts your experience, credentials and caregiver skills.</div></div><div className="meta">01</div></div>
          <div className="job"><div><h3>Fill only the gaps</h3><div className="meta">Confirm anything missing plus shifts, pay, transportation and travel radius.</div></div><div className="meta">02</div></div>
          <div className="job"><div><h3>Apply and get matched</h3><div className="meta">Use the same profile for current jobs and future employer matches.</div></div><div className="meta">03</div></div>
        </div>
      </div></section>
    </main>

    <footer className="footer"><div className="wrap">CareJoys · <a href="/privacy-policy">Privacy</a> · <a href="/terms-of-service">Terms</a></div></footer>
  </div>;
}
+min+'/hr';
  if(max)return 'Up to 

export function MarylandCaregiverPage(){
  const referralSlug=window.location.pathname.startsWith('/join/')
    ?decodeURIComponent(window.location.pathname.split('/').filter(Boolean)[1]||'')
    :'';
  const [program,setProgram]=useState<{name:string;city?:string;state?:string;zip?:string;providerType?:string}|null>(null);
  const [jobs,setJobs]=useState<PublicCaregiverJob[]>([]);
  const [jobsLoading,setJobsLoading]=useState(!referralSlug);

  useEffect(()=>{
    document.title='Caregiver Jobs in Maryland | CareJoys';
    if(referralSlug){
      fetch('/api/public/training-program/'+encodeURIComponent(referralSlug))
        .then(r=>r.json())
        .then((data:any)=>{
          if(data?.program){setProgram(data.program);document.title='CareJoys for '+data.program.name}
        }).catch(()=>{});
    }else{
      fetch('/api/public/caregiver-jobs?limit=24')
        .then(r=>r.json())
        .then((data:any)=>{if(Array.isArray(data?.jobs))setJobs(data.jobs)})
        .catch(()=>{})
        .finally(()=>setJobsLoading(false));
    }
  },[referralSlug]);

  return <div>
    <header className="nav"><div className="wrap nav-inner">
      <a className="brand" href="/">CareJoys</a>
      <nav className="navlinks"><a href="/training-programs/maryland">Training programs</a><a href="/hire-caregivers/maryland">For employers</a></nav>
    </div></header>

    <main className="maryland-caregiver-page">
      <section className="caregiver-campaign-hero"><div className="wrap caregiver-campaign-grid">
        <div>
          <div className="modal-kicker">{program?program.name:'Maryland caregivers'}</div>
          <h1>{program?'Get matched after training.':'Caregiver jobs in Maryland'}</h1>
          <p>{program
            ?'Upload your resume once. CareJoys builds your caregiver profile and matches you with Maryland care employers.'
            :'Upload your resume once. CareJoys matches you with caregiver jobs and employers near you.'}</p>
        </div>

        <div className="campaign-form-card" id="caregiver-profile">
          <CaregiverOnboarding referralSlug={referralSlug} />
        </div>
      </div></section>

      {!referralSlug&&<section className="section caregiver-jobs-section" id="current-jobs"><div className="wrap">
        <div className="section-heading">
          <div>
            <div className="modal-kicker">Current openings</div>
            <h2>Current caregiver jobs in Maryland</h2>
            <p>Verified from care-employer career pages. Open a job on CareJoys, then apply with the same reusable profile.</p>
          </div>
        </div>

        {jobsLoading
          ?<div className="empty"><strong>Loading current openings…</strong></div>
          :jobs.length===0
            ?<div className="empty"><strong>CareJoys is adding verified Maryland caregiver jobs now.</strong><div>Upload your resume above and we’ll match you as openings are confirmed.</div></div>
            :<div className="jobs caregiver-public-job-list">
              {jobs.map(job=>{
                const pay=payLabel(job);
                const href='/jobs/'+encodeURIComponent(job.id);
                return <article className="job" key={job.id}>
                  <div>
                    <h3><a href={href}>{job.title}</a></h3>
                    <div className="meta">{[job.employerName,[job.city,job.state].filter(Boolean).join(', ')||job.zip].filter(Boolean).join(' · ')}</div>
                    <div className="job-tags">
                      <span className="pill">{job.role}</span>
                      {job.employmentType&&<span className="pill">{job.employmentType}</span>}
                      {pay&&<span className="pill">{pay}</span>}
                    </div>
                  </div>
                  <div className="public-job-actions">
                    <a className="btn job-apply-primary" href={href}>Apply</a>
                  </div>
                </article>;
              })}
            </div>}
      </div></section>}

      <section className="section"><div className="wrap">
        <h2>One profile. Relevant jobs. Your choice.</h2>
        <div className="jobs">
          <div className="job"><div><h3>Upload once</h3><div className="meta">CareJoys extracts your experience, credentials and caregiver skills.</div></div><div className="meta">01</div></div>
          <div className="job"><div><h3>Fill only the gaps</h3><div className="meta">Confirm anything missing plus shifts, pay, transportation and travel radius.</div></div><div className="meta">02</div></div>
          <div className="job"><div><h3>Apply and get matched</h3><div className="meta">Use the same profile for current jobs and future employer matches.</div></div><div className="meta">03</div></div>
        </div>
      </div></section>
    </main>

    <footer className="footer"><div className="wrap">CareJoys · <a href="/privacy-policy">Privacy</a> · <a href="/terms-of-service">Terms</a></div></footer>
  </div>;
}
+max+'/hr';
  return '';
}
function pillLabel(value:string){
  const normalized=value.replace(/[_-]+/g,' ').replace(/\s+/g,' ').trim().toLowerCase();
  return normalized?normalized.charAt(0).toUpperCase()+normalized.slice(1):'';
}
function employmentPills(value?:string){
  return (value||'').split(/[,;|]+/).map(v=>pillLabel(v)).filter(Boolean);
}

export function MarylandCaregiverPage(){
  const referralSlug=window.location.pathname.startsWith('/join/')
    ?decodeURIComponent(window.location.pathname.split('/').filter(Boolean)[1]||'')
    :'';
  const [program,setProgram]=useState<{name:string;city?:string;state?:string;zip?:string;providerType?:string}|null>(null);
  const [jobs,setJobs]=useState<PublicCaregiverJob[]>([]);
  const [jobsLoading,setJobsLoading]=useState(!referralSlug);

  useEffect(()=>{
    document.title='Caregiver Jobs in Maryland | CareJoys';
    if(referralSlug){
      fetch('/api/public/training-program/'+encodeURIComponent(referralSlug))
        .then(r=>r.json())
        .then((data:any)=>{
          if(data?.program){setProgram(data.program);document.title='CareJoys for '+data.program.name}
        }).catch(()=>{});
    }else{
      fetch('/api/public/caregiver-jobs?limit=24')
        .then(r=>r.json())
        .then((data:any)=>{if(Array.isArray(data?.jobs))setJobs(data.jobs)})
        .catch(()=>{})
        .finally(()=>setJobsLoading(false));
    }
  },[referralSlug]);

  return <div>
    <header className="nav"><div className="wrap nav-inner">
      <a className="brand" href="/">CareJoys</a>
      <nav className="navlinks"><a href="/training-programs/maryland">Training programs</a><a href="/hire-caregivers/maryland">For employers</a></nav>
    </div></header>

    <main className="maryland-caregiver-page">
      <section className="caregiver-campaign-hero"><div className="wrap caregiver-campaign-grid">
        <div>
          <div className="modal-kicker">{program?program.name:'Maryland caregivers'}</div>
          <h1>{program?'Get matched after training.':'Caregiver jobs in Maryland'}</h1>
          <p>{program
            ?'Upload your resume once. CareJoys builds your caregiver profile and matches you with Maryland care employers.'
            :'Upload your resume once. CareJoys matches you with caregiver jobs and employers near you.'}</p>
        </div>

        <div className="campaign-form-card" id="caregiver-profile">
          <CaregiverOnboarding referralSlug={referralSlug} />
        </div>
      </div></section>

      {!referralSlug&&<section className="section caregiver-jobs-section" id="current-jobs"><div className="wrap">
        <div className="section-heading">
          <div>
            <div className="modal-kicker">Current openings</div>
            <h2>Current caregiver jobs in Maryland</h2>
            <p>Verified from care-employer career pages. Open a job on CareJoys, then apply with the same reusable profile.</p>
          </div>
        </div>

        {jobsLoading
          ?<div className="empty"><strong>Loading current openings…</strong></div>
          :jobs.length===0
            ?<div className="empty"><strong>CareJoys is adding verified Maryland caregiver jobs now.</strong><div>Upload your resume above and we’ll match you as openings are confirmed.</div></div>
            :<div className="jobs caregiver-public-job-list">
              {jobs.map(job=>{
                const pay=payLabel(job);
                const href='/jobs/'+encodeURIComponent(job.id);
                return <article className="job" key={job.id}>
                  <div>
                    <h3><a href={href}>{job.title}</a></h3>
                    <div className="meta">{[job.employerName,[job.city,job.state].filter(Boolean).join(', ')||job.zip].filter(Boolean).join(' · ')}</div>
                    <div className="job-tags">
                      <span className="pill">{job.role}</span>
                      {job.employmentType&&<span className="pill">{job.employmentType}</span>}
                      {pay&&<span className="pill">{pay}</span>}
                    </div>
                  </div>
                  <div className="public-job-actions">
                    <a className="btn job-apply-primary" href={href}>Apply</a>
                  </div>
                </article>;
              })}
            </div>}
      </div></section>}

      <section className="section"><div className="wrap">
        <h2>One profile. Relevant jobs. Your choice.</h2>
        <div className="jobs">
          <div className="job"><div><h3>Upload once</h3><div className="meta">CareJoys extracts your experience, credentials and caregiver skills.</div></div><div className="meta">01</div></div>
          <div className="job"><div><h3>Fill only the gaps</h3><div className="meta">Confirm anything missing plus shifts, pay, transportation and travel radius.</div></div><div className="meta">02</div></div>
          <div className="job"><div><h3>Apply and get matched</h3><div className="meta">Use the same profile for current jobs and future employer matches.</div></div><div className="meta">03</div></div>
        </div>
      </div></section>
    </main>

    <footer className="footer"><div className="wrap">CareJoys · <a href="/privacy-policy">Privacy</a> · <a href="/terms-of-service">Terms</a></div></footer>
  </div>;
}
