import { useEffect, useState } from 'react';
import { CaregiverOnboarding } from './CaregiverOnboarding';
import { JobList, type PublicCaregiverJob } from './CaregiverJobsHub';
import { SiteFooter, SiteHeader } from './SiteChrome';
import './styles.css';

// Maryland landing pages for "gna jobs" and "cna classes baltimore", built on the /caregiver-resume layout.
const AREA_NAMES:Record<string,string>={maryland:'Maryland',baltimore:'Baltimore'};

function useJson<T>(url:string){
  const [data,setData]=useState<T|null>(null);
  const [failed,setFailed]=useState(false);
  useEffect(()=>{fetch(url).then(r=>r.json()).then(d=>d?.ok?setData(d):setFailed(true)).catch(()=>setFailed(true))},[url]);
  return {data,failed};
}

function Hero({kicker,title,lead,points}:{kicker:string;title:string;lead:string;points:string[]}){
  return <section className="resume-hero"><div className="wrap resume-hero-grid">
    <div>
      <div className="modal-kicker">{kicker}</div>
      <h1>{title}</h1>
      <p>{lead}</p>
      <div className="resume-points">{points.map(p=><span key={p}>{p}</span>)}</div>
    </div>
    <div className="campaign-form-card"><CaregiverOnboarding /></div>
  </div></section>;
}

export function GnaJobsPage(){
  const slug=window.location.pathname.split('/')[3]||'maryland';
  const place=AREA_NAMES[slug]||'Maryland';
  const where=slug==='baltimore'?'the Baltimore area':'Maryland';
  const {data,failed}=useJson<{total:number;gna:number;jobs:PublicCaregiverJob[]}>('/api/public/gna-jobs?area='+encodeURIComponent(slug));
  return <div>
    <SiteHeader/>
    <main>
      <Hero kicker="GNA jobs" title={'GNA jobs in '+place} lead={'GNA (now CNA-I) and CNA jobs in '+where+', checked on each employer\'s own careers page, with pay shown when the employer lists it. Create one free profile and only the employers you pick see it.'}
        points={['Resume optional','Free to use','No calls, no texts']}/>

      <section className="section"><div className="wrap">
        <h2>Current GNA and CNA jobs in {where}</h2>
        {data&&data.jobs.length>0?<>
          <p className="meta">{data.total} current opening{data.total===1?'':'s'}{data.gna?', '+data.gna+' listed as GNA':''}.</p>
          <JobList jobs={data.jobs}/>
        </>:<div className="empty"><strong>{data||failed?'No current GNA jobs here yet.':'Loading jobs…'}</strong>{(data||failed)&&<span> Create your free profile and CareJoys will email you when one is confirmed.</span>}</div>}
      </div></section>

      <section className="section"><div className="wrap">
        <h2>Is GNA still a Maryland certification?</h2>
        <p>Not as a separate title. On April 1, 2026 the Maryland Board of Nursing replaced CNA/GNA with CNA-I. If you were a GNA, your certificate became CNA-I with the same number, and you can keep working in any setting, including nursing homes. Many employers still post these jobs as GNA.</p>
        <div className="jobcta">
          <div><strong>Not certified yet?</strong><span>Compare Maryland Board-approved CNA training programs near Baltimore.</span></div>
          <a className="btn" href="/cna-classes/baltimore">CNA classes in Baltimore</a>
        </div>
        <p className="meta">{slug==='baltimore'?<a className="text-link" href="/gna-jobs/maryland">GNA jobs across Maryland</a>:<a className="text-link" href="/gna-jobs/maryland/baltimore">GNA jobs in Baltimore</a>} · <a className="text-link" href="/resources/how-to-become-a-caregiver-in-maryland">How to become a CNA in Maryland</a></p>
      </div></section>
    </main>
    <SiteFooter/>
  </div>;
}

export function CnaClassesPage(){
  const {data,failed}=useJson<{programs:{name:string;slug:string;credentials:string;town:string}[];jobs:number}>('/api/public/cna-classes?area=baltimore');
  return <div>
    <SiteHeader/>
    <main>
      <Hero kicker="CNA classes" title="CNA classes in Baltimore, MD" lead="CNA training programs with a location in Baltimore City or Baltimore County, from the Maryland Board of Nursing list of approved programs. Already training? Create your free profile now and get matched to jobs when you finish."
        points={['Board-approved programs','Free job matching','Resume optional']}/>

      <section className="section"><div className="wrap">
        <h2>{data?data.programs.length+' CNA training programs in the Baltimore area':'CNA training programs in the Baltimore area'}</h2>
        {data&&data.programs.length>0?<div className="jobs">
          {data.programs.map(p=><div className="job" key={p.slug}><div><h3><a href={'/training-programs/'+encodeURIComponent(p.slug)}>{p.name}</a></h3><div className="meta">{[p.town,'Maryland'].filter(Boolean).join(', ')}</div></div><span className="pill">{p.credentials}</span></div>)}
        </div>:<div className="empty"><strong>{data||failed?'No programs listed yet.':'Loading programs…'}</strong>{(data||failed)&&<span> <a className="text-link" href="/training-programs/maryland">Browse all Maryland programs</a>.</span>}</div>}
      </div></section>

      <section className="section"><div className="wrap">
        <h2>How to choose a CNA class</h2>
        <div className="jobs">
          <div className="job"><div><h3>Check it is Board-approved</h3><div className="meta">Since April 1, 2026, new Maryland nursing assistants certify as CNA-I, which replaced CNA/GNA and covers nursing homes too.</div></div></div>
          <div className="job"><div><h3>Ask about cost and schedule</h3><div className="meta">Total cost, day, evening or weekend classes, and when clinical hours happen.</div></div></div>
          <div className="job"><div><h3>Ask where graduates work</h3><div className="meta">How many pass the competency exam, and which employers hire them.</div></div></div>
        </div>
      </div></section>

      <section className="section"><div className="wrap">
        <h2>After you finish</h2>
        <div className="jobcta">
          <div><strong>{data&&data.jobs?data.jobs+' caregiver jobs are open in the Baltimore area right now.':'Find your first CNA job.'}</strong><span>CareJoys emails you new jobs near you each week. No calls, no texts.</span></div>
          <a className="btn" href="/gna-jobs/maryland/baltimore">GNA and CNA jobs in Baltimore</a>
        </div>
      </div></section>
    </main>
    <SiteFooter/>
  </div>;
}
