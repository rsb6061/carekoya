import { useEffect, useState } from 'react';
import { CaregiverOnboarding } from './CaregiverOnboarding';
import { jobsHubPath, parseJobsHubPath, usState } from './usStates';
import { SiteFooter, SiteHeader } from './SiteChrome';
import { payLabel, pillLabel } from './jobFormat';
import './styles.css';

// Serves every /caregiver-jobs/{state}[/{city}] hub and /join/{referral}; the file keeps its original name.
type PublicCaregiverJob={
  id:string;title:string;role:string;employerName:string;city?:string;state?:string;zip?:string;
  employmentType?:string;payMin?:number|null;payMax?:number|null;payPeriod?:string;
};
type Hub={total:number;page:number;pages:number;city:string;cities:{city:string;slug:string;count:number}[];jobs:PublicCaregiverJob[]};

const ROLES=['CNA','GNA','HHA','PCA','DSP','Caregiver'];

function employmentPills(value?:string){
  return (value||'').split(/[,;|]+/).map(v=>pillLabel(v)).filter(Boolean);
}

export function MarylandCaregiverPage(){
  const referralSlug=window.location.pathname.startsWith('/join/')
    ?decodeURIComponent(window.location.pathname.split('/').filter(Boolean)[1]||'')
    :'';
  const parsed=parseJobsHubPath(window.location.pathname);
  const state=parsed?.state||usState('MD')!;
  const citySlug=parsed?.citySlug||'';
  const params=new URLSearchParams(window.location.search);
  const [role,setRole]=useState(params.get('role')||'');
  const [page,setPage]=useState(Math.max(1,Number(params.get('page')||1)||1));
  const [program,setProgram]=useState<{name:string;city?:string;state?:string;zip?:string;providerType?:string}|null>(null);
  const [hub,setHub]=useState<Hub|null>(null);
  const [jobsLoading,setJobsLoading]=useState(!referralSlug);

  useEffect(()=>{
    if(!referralSlug)return;
    fetch('/api/public/training-program/'+encodeURIComponent(referralSlug))
      .then(r=>r.json())
      .then((data:any)=>{
        if(data?.program){setProgram(data.program);document.title='CareJoys for '+data.program.name}
      }).catch(()=>{});
  },[referralSlug]);

  useEffect(()=>{
    if(referralSlug)return;
    setJobsLoading(true);
    const q=new URLSearchParams({state:state.code,page:String(page)});
    if(citySlug)q.set('city',citySlug);
    if(role)q.set('role',role);
    fetch('/api/public/jobs-hub?'+q.toString())
      .then(r=>r.json())
      .then((data:any)=>{if(Array.isArray(data?.jobs))setHub(data)})
      .catch(()=>{})
      .finally(()=>setJobsLoading(false));
    // Keep the address bar shareable without a reload.
    const next=new URLSearchParams();
    if(role)next.set('role',role);
    if(page>1)next.set('page',String(page));
    const qs=next.toString();
    window.history.replaceState(null,'',window.location.pathname+(qs?'?'+qs:'')+window.location.hash);
  },[referralSlug,state.code,citySlug,role,page]);

  const place=hub?.city?hub.city+', '+state.code:state.name;

  return <div>
    <SiteHeader jobsHref={jobsHubPath(state)} employersHref={'/hire-caregivers/'+state.slug}/>

    <main className="maryland-caregiver-page">
      <section className="caregiver-campaign-hero"><div className="wrap caregiver-campaign-grid">
        <div>
          {!program&&<div className="hub-breadcrumb"><a href="/">CareJoys</a> › {citySlug?<><a href={jobsHubPath(state)}>{state.name}</a> › {hub?.city||'…'}</>:state.name}</div>}
          <div className="modal-kicker">{program?program.name:state.name+' caregivers'}</div>
          <h1>{program?'Get matched after training.':'Caregiver jobs in '+place}</h1>
          <p>{program
            ?'Upload your resume once. CareJoys builds your caregiver profile and matches you with care employers near you.'
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
            <h2>Current caregiver jobs in {place}</h2>
            <p>{hub?.total?hub.total+' current opening'+(hub.total===1?'':'s')+', verified from care-employer career pages. ':'Verified from care-employer career pages. '}Open a job on CareJoys, then apply with the same reusable profile.</p>
          </div>
        </div>

        <div className="hub-filters" role="group" aria-label="Filter by role">
          {['',...ROLES].map(r=><button key={r||'all'} className={'hub-filter '+(role===r?'active':'')} onClick={()=>{setRole(r);setPage(1)}}>{r||'All roles'}</button>)}
        </div>

        {jobsLoading&&!hub
          ?<div className="empty"><strong>Loading current openings…</strong></div>
          :!hub||hub.jobs.length===0
            ?<div className="empty"><strong>CareJoys is adding verified caregiver jobs in {place} now.</strong><div>Upload your resume above and we’ll match you as openings are confirmed.</div></div>
            :<div className="jobs caregiver-public-job-list">
              {hub.jobs.map(job=>{
                const pay=payLabel(job);
                const href='/jobs/'+encodeURIComponent(job.id);
                return <article className="job" key={job.id}>
                  <div>
                    <h3><a href={href}>{job.title}</a></h3>
                    <div className="meta">{[job.employerName,[job.city,job.state].filter(Boolean).join(', ')||job.zip].filter(Boolean).join(' · ')}</div>
                    <div className="job-tags">
                      {job.role&&<span className="pill">{pillLabel(job.role)}</span>}
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

        {hub&&hub.pages>1&&<nav className="hub-pager" aria-label="Pages">
          <button className="btn secondary" disabled={page<=1} onClick={()=>{setPage(page-1);window.scrollTo({top:0})}}>Previous</button>
          <span>Page {hub.page} of {hub.pages}</span>
          <button className="btn secondary" disabled={page>=hub.pages} onClick={()=>{setPage(page+1);window.scrollTo({top:0})}}>Next</button>
        </nav>}

        {!citySlug&&hub&&hub.cities.length>0&&<div className="hub-cities">
          <h3>Caregiver jobs by city</h3>
          <div className="job-tags">{hub.cities.map(c=><a className="pill" key={c.slug} href={jobsHubPath(state,c.slug)}>{c.city} ({c.count})</a>)}</div>
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

    <SiteFooter jobsHref={jobsHubPath(state)} employersHref={'/hire-caregivers/'+state.slug}/>
  </div>;
}
