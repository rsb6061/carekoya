import { useEffect, useState } from 'react';
import './styles.css';

async function api<T>(path:string):Promise<T>{
  const res=await fetch(path);
  const body=await res.json() as T & {error?:string};
  if(!res.ok)throw new Error(body.error||'Request failed');
  return body;
}

export function TrainingOrganizationPage(){
  const slug=decodeURIComponent(window.location.pathname.split('/').filter(Boolean).pop()||'');
  const [data,setData]=useState<any>(null);
  const [error,setError]=useState('');

  useEffect(()=>{
    api<any>('/api/public/training-organization/'+encodeURIComponent(slug))
      .then(result=>{
        setData(result);
        document.title=(result.organization?.name||'Caregiver Training Program')+' | CareJoys';
      })
      .catch(err=>setError(err instanceof Error?err.message:'Could not load training program'));
  },[slug]);

  if(error)return <div className="activation-shell"><div className="activation-card"><div className="activation-kicker">CareJoys</div><h1>Training program not found.</h1><p>{error}</p></div></div>;
  if(!data)return <div className="loading-screen">Loading CareJoys…</div>;

  const org=data.organization||{};
  const programs=data.programs||[];

  return <div>
    <header className="nav"><div className="wrap nav-inner"><a className="brand" href="/">CareJoys</a><nav className="navlinks"><a href="/training-programs/maryland">Maryland programs</a><a href="/caregiver-jobs/maryland">For caregivers</a><a href="/hire-caregivers/maryland">For employers</a></nav></div></header>
    <main>
      <section className="hero school-directory-hero"><div className="wrap">
        <div className="modal-kicker">Caregiver Training Program · {org.credentialCategories||'CNA/GNA'}</div>
        <h1>{org.name}</h1>
        <p>{org.locationCount>1?org.locationCount+' Maryland training locations':'Maryland caregiver training program'} connected to CareJoys graduate placement.</p>
        <div className="source-strip school-directory-source">
          <div className="source-strip-title">Credential pathway: {org.credentialCategories||'CNA/GNA'}</div>
          <div className="meta">CareJoys tracks approved training locations separately so graduate signups can be attributed to the correct campus and cohort.</div>
        </div>
      </div></section>

      <section className="section"><div className="wrap">
        <div className="section-heading"><h2>Training locations</h2><p>{programs.length} active Maryland program record{programs.length===1?'':'s'}</p></div>
        <div className="school-directory-grid">
          {programs.map((p:any)=><article className="school-directory-card" key={p.id}>
            <div className="modal-kicker">{p.credentialCategory||'CNA/GNA'} · {p.providerType}</div>
            <h3>{p.name}</h3>
            <div className="meta">{[p.city,p.state,p.zip].filter(Boolean).join(' · ')}</div>
            <div className="school-directory-program">{p.programType}</div>
            <div className="meta">Maryland Board of Nursing status: {p.currentStatus||'Approved'}</div>
            <div className="school-directory-actions">
              {p.referralUrl&&<a className="btn secondary" href={p.referralUrl}>Graduate signup</a>}
              {p.legacyProgramUrl&&<a className="text-link" href={p.legacyProgramUrl}>Program staff / claim ↗</a>}
            </div>
          </article>)}
        </div>
      </div></section>

      <section className="section"><div className="wrap">
        <div className="jobcta">
          <div><strong>Free graduate placement for caregiver training programs.</strong><span>Share a tracked CareJoys link with each class. CareJoys attributes profiles, employer interest, interviews, and recorded hires back to the program and cohort.</span></div>
          <a className="btn" href="/training-programs/maryland">Browse Maryland programs</a>
        </div>
      </div></section>
    </main>
    <footer className="footer"><div className="wrap">CareJoys · Caregiver Training Programs · CNA/GNA graduate placement · <a href="/privacy-policy">Privacy</a> · <a href="/terms-of-service">Terms</a></div></footer>
  </div>;
}
