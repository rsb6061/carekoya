import { useEffect, useState, type FormEvent } from 'react';
import { AgencyFinder } from './AgencyFinder';
import { jobsHubPath, usState } from './usStates';
import { SiteFooter, SiteHeader } from './SiteChrome';
import './styles.css';

export function EmployerRecruitingPage(){
  const state=usState(decodeURIComponent(window.location.pathname.split('/')[2]||''))||usState('MD')!;
  const isMaryland=state.code==='MD';
  const [freeContacts,setFreeContacts]=useState<number|null>(null);
  useEffect(()=>{fetch('/api/public/pricing').then(r=>r.json()).then((d:any)=>setFreeContacts(typeof d?.freeContacts==='number'?d.freeContacts:null)).catch(()=>{})},[]);
  // This page is lazy-loaded: the hash is processed by the browser before #claim-agency exists.
  useEffect(()=>{
    const scrollToClaim=()=>{
      if(window.location.hash==='#claim-agency')window.requestAnimationFrame(()=>document.getElementById('claim-agency')?.scrollIntoView({block:'start'}));
    };
    scrollToClaim();
    window.addEventListener('hashchange',scrollToClaim);
    return ()=>window.removeEventListener('hashchange',scrollToClaim);
  },[]);
  return <div>
    <SiteHeader audience="employer" jobsHref={jobsHubPath(state)}/>
    <main>
      <section className="hero"><div className="wrap">
        <div className="modal-kicker">Hire caregivers</div>
        <h1>Hire caregivers in {state.name}.</h1>
        <p>Find local CNAs, {isMaryland?'GNAs, ':''}HHAs, PCAs and caregivers who are actually interested in your opening.</p>
        <div className="hero-actions"><a className="btn" href="/hire-caregivers">Hire caregivers</a><a className="btn secondary" href="#claim-agency">Claim your agency free</a></div>
      </div></section>

      <section className="section" id="claim-agency"><div className="wrap">
        <h2>Already a licensed home-care agency?</h2>
        <p className="section-lead">Find your agency to claim it. Claimed agencies get always-on caregiver matches, an Inbox of caregivers who asked to work with them, and control over the jobs CareJoys shows from their careers page.</p>
        <AgencyFinder stateCode={state.code}/>
      </div></section>

      <section className="section" id="pricing"><div className="wrap">
        <h2>Pricing</h2>
        <div className="jobs">
          <div className="job"><div><h3>Searching and matching are free</h3><div className="meta">Post openings, see ranked local matches, and keep always-on hiring preferences at no cost.</div></div><div className="meta">Free</div></div>
          <div className="job"><div><h3>{freeContacts===0?'Contacting caregivers':'Your first '+(freeContacts??5)+' caregiver contacts are free'}</h3><div className="meta">CareJoys contacts matched caregivers for you, confirms interest, and lets them book your interview times.</div></div><div className="meta">{freeContacts===0?'Subscription':'Free'}</div></div>
          <div className="job"><div><h3>Then a monthly subscription</h3><div className="meta">Contacting more caregivers after the free allowance needs a CareJoys subscription, which you can start or cancel from your workspace.</div></div><div className="meta">Monthly</div></div>
        </div>
      </div></section>

      <section className="section"><div className="wrap">
        <h2>What CareJoys does for care employers</h2>
        <div className="jobs">
          <div className="job"><div><h3>Find relevant local caregivers</h3><div className="meta">Match against caregiver role, ZIP, commute, shifts, desired pay, transportation, certifications, specialties, and availability freshness.</div></div><div className="meta">01</div></div>
          <div className="job"><div><h3>Confirm who is actually interested</h3><div className="meta">CareJoys is built to distinguish a profile in a database from a caregiver who is currently looking and wants to hear about your opening.</div></div><div className="meta">02</div></div>
          <div className="job"><div><h3>Move matches into interviews</h3><div className="meta">Track matched, contacted, interested, qualified, interview, and hired stages without forcing your team to manage another giant applicant database.</div></div><div className="meta">03</div></div>
        </div>
      </div></section>

      <section className="section"><div className="wrap">
        <h2>Caregiver roles CareJoys supports</h2>
        <div className="jobcta"><div><strong>CNA · {isMaryland?'GNA · ':''}HHA · PCA · Caregiver</strong><span>CareJoys models credentials, experience, work preferences, transportation, and current availability separately from job title so employers can match the actual requirements of the role.</span></div><a className="btn secondary" href={jobsHubPath(state)}>Caregiver jobs in {state.name}</a></div>
      </div></section>

      <section className="section"><div className="wrap">
        <h2>How CareJoys is different from a job board</h2>
        <div className="jobs">
          <div className="job"><div><h3>One persistent caregiver profile</h3><div className="meta">Caregivers do not need to rebuild the same basic work profile for every employer.</div></div></div>
          <div className="job"><div><h3>Availability is a live signal</h3><div className="meta">CareJoys labels whether a caregiver recently confirmed they are looking instead of treating every old profile as an active candidate.</div></div></div>
          <div className="job"><div><h3>Training-to-hire attribution</h3><div className="meta">Caregiver training programs can refer graduates through tracked links so CareJoys can measure profiles, matches, employer interest, interviews, and recorded hires.</div></div></div>
        </div>
      </div></section>
    </main>
    <SiteFooter jobsHref={jobsHubPath(state)} showTraining={isMaryland}/>
  </div>;
}

export function AboutCareJoysPage(){
  return <div>
    <SiteHeader/>
    <main>
      <section className="hero"><div className="wrap">
        <div className="modal-kicker">About CareJoys</div>
        <h1>Free job matching for caregivers. Real introductions for employers.</h1>
        <p><strong>CareJoys is a free job-matching service for caregivers, CNAs and GNAs.</strong> Caregivers find nearby jobs that fit their pay and schedule. Training programs share it free with graduates. Home-care agencies, assisted living and senior-care communities pay to be introduced to caregivers who verified their email and said they are interested.</p>
      </div></section>

      <section className="section"><div className="wrap">
        <h2>What is CareJoys?</h2>
        <div className="jobs">
          <div className="job"><div><h3>For caregivers</h3><div className="meta">Always free. Preview nearby jobs without a resume, create one profile, and choose which employers see it.</div></div><a className="text-link" href="/caregiver-jobs">Find jobs →</a></div>
          <div className="job"><div><h3>For caregiver training programs</h3><div className="meta">Free. Give graduates a CareJoys link and see how many create profiles, get matched and get hired.</div></div><a className="text-link" href="/training-programs/maryland">Maryland training programs →</a></div>
          <div className="job"><div><h3>For care employers</h3><div className="meta">Get introduced to local caregivers who fit the role and confirmed they're interested. First introductions free, then $35 a month per location.</div></div><a className="text-link" href="/pricing">See pricing →</a></div>
        </div>
      </div></section>

      <section className="section"><div className="wrap">
        <h2>What CareJoys is not</h2>
        <div className="source-strip"><div className="source-strip-title">Not a credentialing body and not a generic resume database</div><div className="meta">State regulators and approved training programs remain the source of credential and training status. CareJoys is also not a staffing agency: it charges no placement fees, and employers hire caregivers directly.</div></div>
      </div></section>

      <section className="section"><div className="wrap">
        <h2>Current focus</h2>
        <p>CareJoys started in Maryland and now lists caregiver jobs and home-care agencies in more states, for CNA, GNA, HHA, PCA, caregiver, and related direct-care roles. <a className="text-link" href="/caregiver-jobs">See caregiver jobs by state</a>. The network grows by role and geography where there is enough real employer and caregiver activity to make matching useful; caregiver training-program listings cover Maryland today.</p>
      </div></section>
    </main>
    <SiteFooter/>
  </div>;
}

const PLANS={monthly:{price:'$35',per:'/month'},yearly:{price:'$350',per:'/year'}} as const;

type Supply={found:boolean;city?:string;state?:string;miles?:number;jobs?:number;caregivers?:number|null;caregiversBelow?:number|null};

/** "Who is near you" before any price: verified, actively looking caregivers and current jobs around the employer's ZIP. */
function LocalSupplyCheck(){
  const [zip,setZip]=useState('');
  const [status,setStatus]=useState<'idle'|'loading'|'ready'|'error'>('idle');
  const [supply,setSupply]=useState<Supply|null>(null);
  async function check(e:FormEvent){
    e.preventDefault();
    if(!/^\d{5}$/.test(zip)){setStatus('error');return;}
    setStatus('loading');
    try{
      const d=await fetch('/api/public/caregiver-supply?zip='+zip).then(r=>r.json()) as Supply&{ok:boolean};
      if(!d.ok)throw new Error('lookup failed');
      setSupply(d);setStatus('ready');
    }catch{setStatus('error');}
  }
  const place=supply?.city?supply.city+', '+supply.state:'ZIP '+zip;
  return <div className="pricing-supply">
    <form className="search" onSubmit={check}>
      <label className="sr-only" htmlFor="supply-zip">Your ZIP code</label>
      <input id="supply-zip" inputMode="numeric" maxLength={5} placeholder="Your ZIP code" value={zip} onChange={e=>setZip(e.target.value.replace(/\D/g,''))}/>
      <button className="btn" type="submit" disabled={status==='loading'}>{status==='loading'?'Checking…':'See who is near you'}</button>
    </form>
    {status==='error'&&<p role="alert" className="notice">Enter a five-digit ZIP code and try again.</p>}
    {status==='ready'&&supply&&(supply.found?<p className="pricing-supply-result" aria-live="polite">
      Within {supply.miles} miles of {place}: <strong>{supply.caregivers!=null?supply.caregivers+' verified caregivers':'fewer than '+supply.caregiversBelow+' verified caregivers'}</strong> actively looking, and {supply.jobs} current caregiver jobs.
      {supply.caregivers==null&&' CareJoys is still growing here. Post your opening free and we will introduce caregivers as they join.'}
    </p>:<p className="pricing-supply-result" aria-live="polite">CareJoys doesn't cover that ZIP yet.</p>)}
  </div>;
}

/** /pricing: where "For employers" lands. Shows local supply first, then the free start, then the price. Checkout isn't live yet, so the button starts employer sign-up. */
export function PricingPage(){
  const [plan,setPlan]=useState<keyof typeof PLANS>('monthly');
  const p=PLANS[plan];
  const [freeContacts,setFreeContacts]=useState<number|null>(null);
  useEffect(()=>{fetch('/api/public/pricing').then(r=>r.json()).then((d:any)=>setFreeContacts(typeof d?.freeContacts==='number'?d.freeContacts:null)).catch(()=>{})},[]);
  const free=freeContacts??5;
  return <div>
    <SiteHeader audience="employer"/>
    <main>
      <section className="hero pricing-hero"><div className="wrap pricing-grid">
        <div>
          <div className="modal-kicker">For home-care agencies, assisted living and senior-care communities</div>
          <h1>Hire caregivers who already want to work near you.</h1>
          <p>CareJoys introduces you to local CNAs, GNAs, HHAs, PCAs and caregivers who verified their email and told us they are looking. Caregivers join free through job search and Maryland CNA/GNA training programs.</p>
          <LocalSupplyCheck/>
          <ol className="pricing-steps">
            <li><strong>Post an opening.</strong> Role, ZIP, shifts and pay. Already listed on CareJoys? <a className="text-link" href="/hire-caregivers#claim-agency">Claim your agency free</a>.</li>
            <li><strong>We find caregivers who fit.</strong> Matched by distance, shift and pay, and each one confirms they're interested.</li>
            <li><strong>You get their contact.</strong> Call or email them directly. Interview booking is there if you want it.</li>
          </ol>
        </div>
        <div className="pricing-offer">
          <div className="pricing-toggle" role="group" aria-label="Billing period">
            {(['monthly','yearly'] as const).map(k=><button key={k} type="button" className={'pricing-toggle-btn'+(plan===k?' active':'')} aria-pressed={plan===k} onClick={()=>setPlan(k)}>{k==='monthly'?'Monthly':'Annually'}</button>)}
          </div>
          <article className="plan-card">
            <div className="plan-head">
              <div><h2>Hiring</h2><span className="plan-note">Per location</span></div>
              <div className="plan-price"><strong>{p.price}</strong><span>{p.per}</span></div>
            </div>
            <a className="btn plan-cta" href={'/hire-caregivers?plan='+plan}>{free>0?'Start free':'Start hiring for '+p.price+p.per}</a>
            {free>0&&<div className="plan-free">Your first {free} caregiver introductions are free. Pay only when you want more.</div>}
            {plan==='yearly'&&<div className="plan-save">Save $70 per year</div>}
            <ul className="plan-list">
              <li>Ranked local caregiver matches for every opening, by role, ZIP, shift and pay.</li>
              <li>CareJoys contacts them for you and only introduces caregivers who say yes.</li>
              <li>Every interested caregiver by email and in one inbox. Interview booking optional.</li>
              <li>No placement fees and no per-hire charges. Keep your existing hiring process.</li>
            </ul>
          </article>
        </div>
      </div></section>
    </main>
    <SiteFooter/>
  </div>;
}
