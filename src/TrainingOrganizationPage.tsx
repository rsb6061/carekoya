import { useEffect, useState } from 'react';
import { CaregiverOnboarding } from './CaregiverOnboarding';
import { SiteFooter, SiteHeader } from './SiteChrome';
import './styles.css';

async function api<T>(path:string):Promise<T>{
  const res=await fetch(path);
  const body=await res.json() as T & {error?:string};
  if(!res.ok)throw new Error(body.error||'Request failed');
  return body;
}

type NearbyJob={id:string;title:string;employerName:string;city:string;pay:string;miles:number};

// A training program's public page, laid out like /caregiver-resume: what the program is, where it runs,
// the jobs its graduates can apply to nearby, and a quiet note for program staff at the end.
export function TrainingOrganizationPage(){
  const slug=decodeURIComponent(window.location.pathname.split('/').filter(Boolean).pop()||'');
  const [data,setData]=useState<any>(null);
  const [error,setError]=useState('');

  useEffect(()=>{
    api<any>('/api/public/training-organization/'+encodeURIComponent(slug))
      .then(result=>{
        setData(result);
        document.title=(result.organization?.name||'Caregiver Training Program')+': CNA Classes | CareJoys';
      })
      .catch(err=>setError(err instanceof Error?err.message:'Could not load training program'));
  },[slug]);

  if(error)return <div className="activation-shell"><SiteHeader/><div className="activation-card"><div className="activation-kicker">CareJoys</div><h1>Training program not found.</h1><p>{error}</p></div></div>;
  if(!data)return <div className="loading-screen">Loading CareJoys…</div>;

  const org=data.organization||{};
  const programs:any[]=data.programs||[];
  const nearby:{total:number;town:string;jobs:NearbyJob[]}=data.nearby||{total:0,town:'',jobs:[]};
  const credentials=org.credentialCategories||'CNA/GNA';
  const towns=[...new Set(programs.map(p=>p.city).filter((c:string)=>c&&/^[A-Za-z .'-]{3,40}$/.test(c)))] as string[];
  const where=towns[0]||nearby.town||'';
  const jobsNear=nearby.town||where;
  const referral=programs.find(p=>p.referralUrl);
  const claim=referral?.legacyProgramUrl||'/add-training-program';

  return <div>
    <SiteHeader/>
    <main>
      <section className="resume-hero"><div className="wrap resume-hero-grid">
        <div>
          <div className="modal-kicker">CNA training program · Maryland</div>
          <h1>{org.name}</h1>
          <p>Maryland Board of Nursing approved {credentials} training{where?' in '+where:''}. Training here, or already finished? Create a free CareJoys profile and get matched to caregiver jobs near the program.</p>
          <div className="resume-points">
            <span>{programs.length>1?programs.length+' locations':'1 location'}</span>
            <span>Status: {programs[0]?.currentStatus||'Approved'}</span>
            <span>Free job matching</span>
          </div>
        </div>
        <div className="campaign-form-card"><CaregiverOnboarding /></div>
      </div></section>

      <section className="section"><div className="wrap">
        <h2>Training {programs.length===1?'location':'locations'}</h2>
        <div className="jobs">
          {programs.map(p=><article className="job" key={p.id}>
            <div>
              <h3>{p.name}</h3>
              <div className="meta">{[p.address,[p.city,p.state].filter(Boolean).join(', '),p.zip].filter(Boolean).join(' · ')}</div>
              <div className="job-tags">
                {p.programType&&<span className="pill">{p.programType}</span>}
                <span className="pill">Board status: {p.currentStatus||'Approved'}</span>
              </div>
            </div>
            {p.website&&<div className="public-job-actions"><a className="btn secondary" href={p.website} target="_blank" rel="noopener">Program website</a></div>}
          </article>)}
        </div>
      </div></section>

      <section className="section"><div className="wrap">
        <h2>Caregiver jobs{jobsNear?' near '+jobsNear:''}</h2>
        {nearby.jobs.length>0?<>
          <p className="meta">{nearby.total} current caregiver job{nearby.total===1?' is':'s are'} open within 15 miles of this program.</p>
          <div className="jobs caregiver-public-job-list">
            {nearby.jobs.map(j=><article className="job" key={j.id}>
              <div>
                <h3><a href={'/jobs/'+encodeURIComponent(j.id)}>{j.title}</a></h3>
                <div className="meta">{[j.employerName,j.city,j.miles+' mi away'].filter(Boolean).join(' · ')}</div>
                {j.pay&&<div className="job-tags"><span className="pill">{j.pay}</span></div>}
              </div>
              <div className="public-job-actions"><a className="btn job-apply-primary" href={'/jobs/'+encodeURIComponent(j.id)}>Apply</a></div>
            </article>)}
          </div>
          <p><a className="text-link" href={referral?.referralUrl||'/caregiver-jobs/maryland'}>See all caregiver jobs near this program</a></p>
        </>:<div className="empty"><strong>No jobs listed within 15 miles yet.</strong> <a className="text-link" href="/caregiver-jobs/maryland">Browse all Maryland caregiver jobs</a>.</div>}
      </div></section>

      <section className="section"><div className="wrap">
        <div className="jobcta">
          <div><strong>Do you run this program?</strong><span>Get a free CareJoys link to share with each class, and see which graduates get hired and where.</span></div>
          <a className="btn secondary" href={claim}>Claim this program</a>
        </div>
        <p className="meta"><a className="text-link" href="/training-programs/maryland">All Maryland training programs</a> · <a className="text-link" href="/resources/how-to-become-a-caregiver-in-maryland">How to become a CNA in Maryland</a></p>
      </div></section>
    </main>
    <SiteFooter/>
  </div>;
}
