import { useEffect, useState } from 'react';
import { CaregiverOnboarding } from './CaregiverOnboarding';
import { isNationalJobsPath, jobsHubPath, parseJobsHubPath, stateForZipPrefix, usState } from './usStates';
import { SiteFooter, SiteHeader } from './SiteChrome';
import { payLabel, pillLabel } from './jobFormat';
import './styles.css';

// Serves /caregiver-jobs (all states), every /caregiver-jobs/{state}[/{city}] hub, and /join/{referral}.
type PublicCaregiverJob={
  id:string;title:string;role:string;employerName:string;city?:string;state?:string;zip?:string;
  employmentType?:string;payMin?:number|null;payMax?:number|null;payPeriod?:string;distanceMiles?:number|null;
};
type Hub={total:number;page:number;pages:number;city:string;cities:{city:string;slug:string;count:number}[];metro?:{name:string;area:string}|null;jobs:PublicCaregiverJob[]};
type National={total:number;page:number;pages:number;jobs:PublicCaregiverJob[];
  states:{code:string;name:string;slug:string;count:number}[];
  cities:{city:string;slug:string;state:string;stateSlug:string;count:number}[]};

const ROLES=['CNA','GNA','HHA','PCA','DSP','Caregiver'];
const NEAR_MILES=25;

function employmentPills(value?:string){
  return (value||'').split(/[,;|]+/).map(v=>pillLabel(v)).filter(Boolean);
}

/** City, state or ZIP. A state or city opens its page; a ZIP lists jobs near it on /caregiver-jobs. */
export function JobsSearch({defaultValue=''}:{defaultValue?:string}){
  return <form className="search jobs-search" action="/caregiver-jobs" method="get" role="search">
    <input name="q" defaultValue={defaultValue} placeholder="City, state or ZIP" aria-label="City, state or ZIP" autoComplete="address-level2" required />
    <button className="btn" type="submit">Search jobs</button>
  </form>;
}

function JobList({jobs}:{jobs:PublicCaregiverJob[]}){
  return <div className="jobs caregiver-public-job-list">
    {jobs.map(job=>{
      const pay=payLabel(job);
      const href='/jobs/'+encodeURIComponent(job.id);
      return <article className="job" key={job.id}>
        <div>
          <h3><a href={href}>{job.title}</a></h3>
          <div className="meta">{[job.employerName,[job.city,job.state].filter(Boolean).join(', ')||job.zip,typeof job.distanceMiles==='number'?job.distanceMiles+' mi away':''].filter(Boolean).join(' · ')}</div>
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
  </div>;
}

function RoleFilters({role,onChange}:{role:string;onChange:(role:string)=>void}){
  return <div className="hub-filters" role="group" aria-label="Filter by role">
    {['',...ROLES].map(r=><button key={r||'all'} className={'hub-filter '+(role===r?'active':'')} onClick={()=>onChange(r)}>{r||'All roles'}</button>)}
  </div>;
}

function Pager({page,pages,onChange}:{page:number;pages:number;onChange:(page:number)=>void}){
  if(pages<=1)return null;
  return <nav className="hub-pager" aria-label="Pages">
    <button className="btn secondary" disabled={page<=1} onClick={()=>{onChange(page-1);window.scrollTo({top:0})}}>Previous</button>
    <span>Page {page} of {pages}</span>
    <button className="btn secondary" disabled={page>=pages} onClick={()=>{onChange(page+1);window.scrollTo({top:0})}}>Next</button>
  </nav>;
}

function HowItWorks(){
  return <section className="section"><div className="wrap">
    <h2>One profile. Relevant jobs. Your choice.</h2>
    <div className="jobs">
      <div className="job"><div><h3>Upload once</h3><div className="meta">CareJoys extracts your experience, credentials and caregiver skills.</div></div><div className="meta">01</div></div>
      <div className="job"><div><h3>Fill only the gaps</h3><div className="meta">Confirm anything missing plus shifts, pay, transportation and travel radius.</div></div><div className="meta">02</div></div>
      <div className="job"><div><h3>Apply and get matched</h3><div className="meta">Use the same profile for current jobs and future employer matches.</div></div><div className="meta">03</div></div>
    </div>
  </div></section>;
}

// Keep the address bar shareable without a reload.
function syncQuery(values:Record<string,string>){
  const next=new URLSearchParams();
  for(const [k,v] of Object.entries(values))if(v)next.set(k,v);
  const qs=next.toString();
  window.history.replaceState(null,'',window.location.pathname+(qs?'?'+qs:'')+window.location.hash);
}

export function CaregiverJobsHub(){
  return isNationalJobsPath(window.location.pathname)?<NationalJobsPage/>:<StateJobsPage/>;
}

function NationalJobsPage(){
  const params=new URLSearchParams(window.location.search);
  const q=(params.get('q')||'').trim();
  const zip=(q.match(/^(\d{5})(?:-\d{4})?$/)||[])[1]||'';
  const [role,setRole]=useState(params.get('role')||'');
  const [page,setPage]=useState(Math.max(1,Number(params.get('page')||1)||1));
  const [data,setData]=useState<National|null>(null);
  const [loading,setLoading]=useState(true);
  const [near,setNear]=useState<PublicCaregiverJob[]|null>(null);

  useEffect(()=>{
    setLoading(true);
    const p=new URLSearchParams({page:String(page)});
    if(role)p.set('role',role);
    fetch('/api/public/jobs-national?'+p.toString())
      .then(r=>r.json()).then((d:any)=>{if(Array.isArray(d?.jobs))setData(d)}).catch(()=>{}).finally(()=>setLoading(false));
    syncQuery({q,role,page:page>1?String(page):''});
  },[role,page]);

  useEffect(()=>{
    if(!zip)return;
    // Unknown ZIPs fall back to their state rather than the API's Maryland default.
    const p=new URLSearchParams({zip,radius:String(NEAR_MILES),limit:'50',state:stateForZipPrefix(zip)||'NONE'});
    if(role)p.set('role',role);
    fetch('/api/public/caregiver-jobs?'+p.toString()).then(r=>r.json()).then((d:any)=>setNear(Array.isArray(d?.jobs)?d.jobs:[])).catch(()=>setNear([]));
  },[zip,role]);

  const zipState=zip?usState(stateForZipPrefix(zip)):null;

  return <div>
    <SiteHeader/>
    <main className="maryland-caregiver-page">
      <section className="caregiver-campaign-hero"><div className="wrap caregiver-campaign-grid">
        <div>
          <div className="hub-breadcrumb"><a href="/">CareJoys</a> › Caregiver jobs</div>
          <div className="modal-kicker">Caregiver jobs</div>
          <h1>Caregiver jobs near you</h1>
          <p>Search by city, state or ZIP. Create one free profile, resume optional, and CareJoys matches you with caregiver jobs and employers near you.</p>
          <JobsSearch defaultValue={q}/>
          {data&&data.states.length>0&&<div className="hub-quick-states job-tags">
            {data.states.slice(0,8).map(s=><a className="pill" key={s.code} href={'/caregiver-jobs/'+s.slug}>{s.name}</a>)}
          </div>}
        </div>
        <div className="campaign-form-card" id="caregiver-profile">
          <CaregiverOnboarding referralSlug="" />
        </div>
      </div></section>

      {q&&<section className="section caregiver-jobs-section" id="search-results"><div className="wrap">
        {zip
          ?<>
            <div className="section-heading"><div>
              <div className="modal-kicker">Near {zip}</div>
              <h2>Caregiver jobs within {NEAR_MILES} miles of {zip}</h2>
            </div></div>
            {near===null
              ?<div className="empty"><strong>Looking for jobs near {zip}…</strong></div>
              :near.length===0
                ?<div className="empty"><strong>No current caregiver jobs within {NEAR_MILES} miles of {zip} yet.</strong><div>{zipState?<>Try <a className="text-link" href={jobsHubPath(zipState)}>all caregiver jobs in {zipState.name}</a>, or upload</>:'Upload'} your resume above and we’ll match you as openings are confirmed.</div></div>
                :<JobList jobs={near}/>}
          </>
          :<div className="empty"><strong>We couldn’t find caregiver jobs for “{q}”.</strong><div>Try a city and state like “Baltimore, MD”, a ZIP code, or pick a state below.</div></div>}
      </div></section>}

      <section className="section caregiver-jobs-section" id="states"><div className="wrap">
        <div className="section-heading"><div>
          <div className="modal-kicker">Browse</div>
          <h2>Caregiver jobs by state</h2>
          <p>{data?.total?data.total+' current opening'+(data.total===1?'':'s')+' in '+data.states.length+' state'+(data.states.length===1?'':'s')+', verified from care-employer career pages.':'Verified from care-employer career pages.'}</p>
        </div></div>
        {loading&&!data
          ?<div className="empty"><strong>Loading states…</strong></div>
          :!data||data.states.length===0
            ?<div className="empty"><strong>CareJoys is adding verified caregiver jobs now.</strong><div>Create your free profile above and we’ll match you as openings are confirmed.</div></div>
            :<div className="state-grid">{data.states.map(s=><a key={s.code} className="state-card" href={'/caregiver-jobs/'+s.slug}><strong>{s.name}</strong><span>{s.count} job{s.count===1?'':'s'}</span></a>)}</div>}
        {data&&data.cities.length>0&&<div className="hub-cities">
          <h3>Popular cities</h3>
          <div className="job-tags">{data.cities.map(c=><a className="pill" key={c.state+c.slug} href={'/caregiver-jobs/'+c.stateSlug+'/'+c.slug}>{c.city}, {c.state} ({c.count})</a>)}</div>
        </div>}
      </div></section>

      <section className="section caregiver-jobs-section" id="current-jobs"><div className="wrap">
        <div className="section-heading"><div>
          <div className="modal-kicker">Current openings</div>
          <h2>Newest caregiver jobs</h2>
          <p>Open a job on CareJoys, then apply with the same reusable profile.</p>
        </div></div>
        <RoleFilters role={role} onChange={r=>{setRole(r);setPage(1)}}/>
        {loading&&!data
          ?<div className="empty"><strong>Loading current openings…</strong></div>
          :data&&data.jobs.length>0?<JobList jobs={data.jobs}/>:<div className="empty"><strong>No current {role||'caregiver'} jobs yet.</strong></div>}
        {data&&<Pager page={data.page} pages={data.pages} onChange={setPage}/>}
      </div></section>

      <HowItWorks/>
    </main>
    <SiteFooter/>
  </div>;
}

function StateJobsPage(){
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
    syncQuery({role,page:page>1?String(page):''});
  },[referralSlug,state.code,citySlug,role,page]);

  const place=hub?.city?hub.city+', '+state.code:state.name;

  return <div>
    <SiteHeader/>

    <main className="maryland-caregiver-page">
      <section className="caregiver-campaign-hero"><div className="wrap caregiver-campaign-grid">
        <div>
          {!program&&<div className="hub-breadcrumb"><a href="/">CareJoys</a> › <a href="/caregiver-jobs">Caregiver jobs</a> › {citySlug?<><a href={jobsHubPath(state)}>{state.name}</a> › {hub?.city||'…'}</>:state.name}</div>}
          <div className="modal-kicker">{program?program.name:state.name+' caregivers'}</div>
          <h1>{program?'Get matched after training.':hub?.metro?'CNA and caregiver jobs in the '+hub.metro.name+' area':(state.code==='MD'?'CNA, GNA and caregiver jobs in ':'CNA and caregiver jobs in ')+place}</h1>
          <p>{program
            ?'Create one free profile, resume optional. CareJoys matches you with care employers near you.'
            :'Create one free profile, resume optional. CareJoys matches you with caregiver jobs and employers near you.'}</p>
          {!program&&<JobsSearch/>}
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

        <RoleFilters role={role} onChange={r=>{setRole(r);setPage(1)}}/>

        {jobsLoading&&!hub
          ?<div className="empty"><strong>Loading current openings…</strong></div>
          :!hub||hub.jobs.length===0
            ?<div className="empty"><strong>CareJoys is adding verified caregiver jobs in {place} now.</strong><div>Create your free profile above and we’ll match you as openings are confirmed, or <a className="text-link" href="/caregiver-jobs">browse jobs in other states</a>.</div></div>
            :<JobList jobs={hub.jobs}/>}

        {hub&&<Pager page={hub.page} pages={hub.pages} onChange={setPage}/>}

        {!citySlug&&hub&&hub.cities.length>0&&<div className="hub-cities">
          <h3>Caregiver jobs by city</h3>
          <div className="job-tags">{hub.cities.map(c=><a className="pill" key={c.slug} href={jobsHubPath(state,c.slug)}>{c.city} ({c.count})</a>)}</div>
        </div>}
        <p className="hub-other-states"><a className="text-link" href="/caregiver-jobs">Caregiver jobs in other states →</a></p>
      </div></section>}

      <HowItWorks/>
    </main>

    <SiteFooter/>
  </div>;
}
