import { useEffect, useMemo, useState } from 'react';
import './styles.css';

type Program={
  name:string;providerType:string;city?:string;state?:string;zip?:string;
  programType?:string;credentialCategory?:string;renewalDue?:string;website?:string|null;slug:string;
  organizationName?:string;organizationSlug?:string|null;organizationUrl?:string|null;
  referralUrl:string;programUrl:string;
};

type TrainingOrg={
  key:string;name:string;providerTypes:string[];credentialCategories:string[];
  locations:Program[];organizationUrl:string|null;
};

export function MarylandSchoolsPage(){
  const [programs,setPrograms]=useState<Program[]>([]);
  const [query,setQuery]=useState('');
  const [provider,setProvider]=useState('all');
  const [loading,setLoading]=useState(true);

  useEffect(()=>{
    document.title='Maryland Caregiver Training Programs | CareJoys';
    fetch('/api/public/training-programs')
      .then(r=>r.json())
      .then((data:any)=>setPrograms(data.programs||[]))
      .finally(()=>setLoading(false));
  },[]);

  const providers=useMemo(()=>Array.from(new Set(programs.map(p=>p.providerType).filter(Boolean))).sort(),[programs]);

  const organizations=useMemo<TrainingOrg[]>(()=>{
    const map=new Map<string,TrainingOrg>();
    for(const p of programs){
      const key=p.organizationSlug||p.slug;
      if(!map.has(key))map.set(key,{
        key,
        name:p.organizationName||p.name,
        providerTypes:[],
        credentialCategories:[],
        locations:[],
        organizationUrl:p.organizationUrl||null
      });
      const item=map.get(key)!;
      item.locations.push(p);
      if(p.providerType&&!item.providerTypes.includes(p.providerType))item.providerTypes.push(p.providerType);
      const credential=p.credentialCategory||'CNA/GNA';
      if(!item.credentialCategories.includes(credential))item.credentialCategories.push(credential);
      if(!item.organizationUrl&&p.organizationUrl)item.organizationUrl=p.organizationUrl;
    }
    return Array.from(map.values()).sort((a,b)=>a.name.localeCompare(b.name));
  },[programs]);

  const filtered=useMemo(()=>{
    const q=query.trim().toLowerCase();
    return organizations.filter(org=>{
      const providerOk=provider==='all'||org.providerTypes.includes(provider);
      const text=[
        org.name,
        ...org.credentialCategories,
        ...org.locations.flatMap(p=>[p.name,p.city,p.zip,p.programType])
      ].filter(Boolean).join(' ').toLowerCase();
      return providerOk&&(!q||text.includes(q));
    });
  },[organizations,query,provider]);

  return <div>
    <header className="nav"><div className="wrap nav-inner"><a className="brand" href="/">CareJoys</a><nav className="navlinks"><a href="/caregiver-jobs/maryland">Caregiver jobs</a><a href="/hire-caregivers/maryland">For employers</a></nav></div></header>
    <main>
      <section className="hero school-directory-hero"><div className="wrap">
        <div className="modal-kicker">Maryland caregiver training programs</div>
        <h1><span className="hero-title-line">Maryland CNA/GNA caregiver training programs.</span><span className="hero-title-line">Free graduate placement.</span></h1>
        <p>CareJoys connects graduates from Maryland caregiver training programs with local care employers and tracks outcomes from profile creation through employer interest, interview, and hire.</p>
      </div></section>

      <section className="section"><div className="wrap">
        <div className="section-heading"><h2>Find a caregiver training program</h2><p>{loading?'Loading approved programs…':filtered.length+' training organizations · '+programs.length+' active program/location records'}</p></div>
        <div className="school-directory-filters">
          <input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search program, city, ZIP…" />
          <select value={provider} onChange={e=>setProvider(e.target.value)}>
            <option value="all">All provider types</option>
            {providers.map(p=><option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div className="school-directory-grid">
          {filtered.map(org=>{
            const cities=Array.from(new Set(org.locations.map(p=>p.city).filter(Boolean))) as string[];
            const single=org.locations.length===1?org.locations[0]:null;
            return <article className="school-directory-card" key={org.key}>
              <div className="modal-kicker">{org.credentialCategories.join(' / ')||'CNA/GNA'}</div>
              <h3>{org.name}</h3>
              <div className="meta">{org.providerTypes.join(' · ')}</div>
              <div className="school-directory-program">{org.locations.length} location{org.locations.length===1?'':'s'}{cities.length?' · '+cities.slice(0,3).join(', ')+(cities.length>3?' +'+(cities.length-3):''):''}</div>
              <div className="school-directory-actions">
                <a className="btn secondary" href={org.organizationUrl||single?.programUrl||'#'}>Training program page</a>
                {single&&<a className="text-link" href={single.referralUrl}>Graduate signup ↗</a>}
              </div>
            </article>;
          })}
        </div>
      </div></section>
    </main>
    <footer className="footer"><div className="wrap">CareJoys · Caregiver Training Programs · CNA/GNA graduate placement · <a href="/privacy-policy">Privacy</a> · <a href="/terms-of-service">Terms</a></div></footer>
  </div>;
}
