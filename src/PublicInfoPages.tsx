import { useEffect, useState } from 'react';
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
    <SiteHeader jobsHref={jobsHubPath(state)}/>
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
          <div className="job"><div><h3>{freeContacts===0?'Caregiver introductions':'Your first '+(freeContacts??5)+' caregiver introductions are free'}</h3><div className="meta">CareJoys invites matched caregivers for you. An introduction counts only when a caregiver says they’re interested.</div></div><div className="meta">{freeContacts===0?'Subscription':'Free'}</div></div>
          <div className="job"><div><h3>Then a monthly subscription</h3><div className="meta">More introductions after the free ones need a CareJoys subscription, which you can start or cancel from your workspace.</div></div><div className="meta">Monthly</div></div>
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
          <div className="job"><div><h3>For care employers</h3><div className="meta">Get introduced to local caregivers who fit the role and confirmed they're interested. First introductions free, then $99 a month per location.</div></div><a className="text-link" href="/pricing">See pricing →</a></div>
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

const PRICE='$99';

/** /pricing: where "Faster AI Hiring" lands. The founding pilot: we work the agency's own applicants. The button starts the intake form. */
export function PricingPage(){
  return <div>
    <SiteHeader/>
    <main>
      <section className="hero pricing-hero"><div className="wrap pricing-grid">
        <div>
          <div className="modal-kicker">For home-care agencies and senior living</div>
          <h1>Turn caregiver applicants into interviews.</h1>
          <p>We work the applicants you already get from Indeed, your website and CareJoys: each one texted, screened against your questions, and booked onto your calendar. Your job ads stay yours; we don’t sell leads.</p>
        </div>
        <div className="pricing-offer">
          <article className="plan-card">
            <div className="plan-head">
              <div><h2>Applicant follow-up</h2><span className="plan-note">Founding pilot</span></div>
              <div className="plan-price"><strong>{PRICE}</strong><span>/month</span></div>
            </div>
            <a className="btn plan-cta" href="/hire-caregivers">Get started →</a>
            <div className="plan-terms">One location, up to 75 applicants a month. Those are applicants we work, not leads we supply. We’ll tell you before you hit it.</div>
            <div className="plan-terms">Month-to-month. Cancel anytime. No placement fees or per-hire charges.</div>
            <ul className="plan-list">
              <li>Every applicant from a connected source texted within 30 minutes, 8am to 9pm.</li>
              <li>Screened by text with your questions: certification, transportation, shifts and pay.</li>
              <li>Candidates who pass your screening questions and want an interview are booked onto your calendar.</li>
              <li>We set it up, and a person reviews every screening and every booking before it reaches you.</li>
              <li>Weekly numbers: applicants received, reached, screened, interviews booked, hired.</li>
            </ul>
          </article>
        </div>
      </div></section>

      <section className="section"><div className="wrap">
        <div className="modal-kicker">How it works</div>
        <h2>From applicant to interview, without the phone tag</h2>
        <div className="steps">
          <div className="step">
            <div className="modal-kicker">1 · Connect</div>
            <h3>Connect your applicants</h3>
            <p className="meta">Tell us your openings and your must-haves, then point your Indeed and website applicant emails at us. Already listed on CareJoys? <a className="text-link" href="/hire-caregivers#claim-agency">Claim your agency free</a>.</p>
          </div>
          <div className="step">
            <div className="modal-kicker">2 · We work it</div>
            <h3>We work every applicant</h3>
            <p className="meta">Each one is texted within 30 minutes during the day, asked your screening questions, and kept warm so nobody goes cold waiting on a callback.</p>
          </div>
          <div className="step">
            <div className="modal-kicker">3 · You interview</div>
            <h3>You interview and hire</h3>
            <p className="meta">Candidates who pass and want to talk land on your calendar with reminders sent. You meet them and make the call.</p>
          </div>
        </div>
      </div></section>
    </main>
    <SiteFooter/>
  </div>;
}
