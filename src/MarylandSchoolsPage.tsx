import { useEffect, useMemo, useState } from 'react';
import './styles.css';

type Program={
  name:string;providerType:string;city?:string;state?:string;zip?:string;
  programType?:string;renewalDue?:string;website?:string|null;slug:string;
  referralUrl:string;programUrl:string;
};

export function MarylandSchoolsPage(){
  const [programs,setPrograms]=useState<Program[]>([]);
  const [query,setQuery]=useState('');
  const [provider,setProvider]=useState('all');
  const [loading,setLoading]=useState(true);

  useEffect(()=>{
    document.title='Maryland CNA & GNA Training Programs | CareJoys';
    fetch('/api/public/training-programs')
      .then(r=>r.json())
      .then((data:any)=>setPrograms(data.programs||[]))
      .finally(()=>setLoading(false));
  },[]);

  const providers=useMemo(()=>Array.from(new Set(programs.map(p=>p.providerType).filter(Boolean))).sort(),[programs]);
  const filtered=useMemo(()=>{
    const q=query.trim().toLowerCase();
    return programs.filter(p=>(provider==='all'||p.providerType===provider)&&(!q||[p.name,p.city,p.zip,p.programType].join(' ').toLowerCase().includes(q)));
  },[programs,query,provider]);

  return <div>
    <header className="nav"><div className="wrap nav-inner"><a className="brand" href="/">CareJoys</a><nav className="navlinks"><a href="/caregiver-jobs/maryland">For caregivers</a><a href="/app">For employers</a></nav></div></header>
    <main>
      <section className="hero school-directory-hero"><div className="wrap">
        <div className="modal-kicker">Maryland training programs</div>
        <h1><span className="hero-title-line">Free graduate placement.</span><span className="hero-title-line">One tracked link per program.</span></h1>
        <p>CareJoys gives Maryland CNA/GNA and nursing-assistant programs a free graduate referral link and tracks placement outcomes from profile creation through employer interest, interview, and hire.</p>
        <div className="source-strip school-directory-source">
          <div className="source-strip-title">Maryland Board of Nursing directory</div>
          <div className="meta">Program records are synchronized from the official Maryland approved nursing-assistant training program directory. Program staff can claim their CareJoys page and share the graduate link at no cost.</div>
        </div>
      </div></section>

      <section className="section"><div className="wrap">
        <div className="section-heading"><h2>Find your program</h2><p>{loading?'Loading approved programs…':filtered.length+' approved training program records'}</p></div>
        <div className="school-directory-filters">
          <input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search school, city, ZIP…" />
          <select value={provider} onChange={e=>setProvider(e.target.value)}>
            <option value="all">All provider types</option>
            {providers.map(p=><option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div className="school-directory-grid">
          {filtered.map(p=><article className="school-directory-card" key={p.slug}>
            <div className="modal-kicker">{p.providerType}</div>
            <h3>{p.name}</h3>
            <div className="meta">{[p.city,p.state,p.zip].filter(Boolean).join(' · ')}</div>
            <div className="school-directory-program">{p.programType}</div>
            {p.renewalDue&&<div className="meta">Renewal due: {p.renewalDue}</div>}
            <div className="school-directory-actions"><a className="btn secondary" href={p.programUrl}>Program page</a><a className="text-link" href={p.referralUrl}>Graduate signup ↗</a></div>
          </article>)}
        </div>
      </div></section>
    </main>
    <footer className="footer"><div className="wrap">CareJoys · Free graduate placement for Maryland training programs · <a href="/privacy-policy">Privacy</a> · <a href="/terms-of-service">Terms</a></div></footer>
  </div>;
}
