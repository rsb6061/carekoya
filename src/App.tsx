import { ArrowRight, Check, GraduationCap, MapPin, Search, MessageSquareText, CalendarCheck2, ShieldCheck, UsersRound, Sparkles } from 'lucide-react';

const candidates = [
  { initials:'JM', role:'CNA', location:'Baltimore, MD', freshness:'Confirmed today', shift:'Days + weekends', radius:'12 mi' },
  { initials:'AR', role:'HHA', location:'Silver Spring, MD', freshness:'Confirmed yesterday', shift:'Evenings', radius:'8 mi' },
  { initials:'KS', role:'Caregiver', location:'Towson, MD', freshness:'Confirmed 2 days ago', shift:'Nights + weekends', radius:'15 mi' }
];

const features = [
  [Search,'Fresh talent network','Search by role, geography, shift, commute, pay expectations, and how recently a caregiver confirmed availability.'],
  [MessageSquareText,'Automated activation','Contact matched candidates, confirm interest, collect screening answers, and reactivate dormant workers.'],
  [CalendarCheck2,'Interview-ready','Move beyond raw leads. Qualified candidates can select interview times and enter a simple recruiting pipeline.'],
  [ShieldCheck,'Readiness passport','Track credentials, transportation, schedule, work preferences, and document readiness without overstating verification.'],
  [GraduationCap,'School-to-work pipeline','Training programs can invite graduating cohorts for free and track placement while employers get first access to new supply.'],
  [UsersRound,'Longitudinal workforce graph','A caregiver can return whenever they change jobs, shifts, credentials, pay expectations, or location.']
] as const;

export function App() {
  return <div>
    <header className="header">
      <a className="brand" href="#"><span>C</span>CareJoys</a>
      <nav><a href="#how">How it works</a><a href="#network">Talent network</a><a href="#schools">For schools</a></nav>
      <a className="button dark" href="mailto:hello@carejoys.com?subject=CareJoys employer access">Find caregivers</a>
    </header>

    <main>
      <section className="hero">
        <div className="eyebrow"><Sparkles size={14}/> The active caregiver network</div>
        <h1>Caregivers ready to work.<br/>Interviews ready for you.</h1>
        <p>CareJoys helps home-care and senior-care employers find CNAs, HHAs, and caregivers nearby, confirm who is actually looking, screen fit, and turn matches into interviews.</p>
        <div className="actions">
          <a className="button primary big" href="mailto:hello@carejoys.com?subject=Find caregivers">Find caregivers <ArrowRight size={18}/></a>
          <a className="button light big" href="mailto:hello@carejoys.com?subject=Join CareJoys caregiver network">Join the network</a>
        </div>
        <div className="trust">
          <span><Check size={15}/> Recent availability</span>
          <span><Check size={15}/> Local matching</span>
          <span><Check size={15}/> Structured screening</span>
          <span><Check size={15}/> No long-term contract required</span>
        </div>

        <div className="product">
          <div className="toolbar"><div><small>OPENING</small><strong>CNA · Baltimore · Days</strong></div><b>Recruiting</b></div>
          <div className="metrics">
            <div><span>Matched</span><strong>24</strong></div>
            <div><span>Responded</span><strong>14</strong></div>
            <div><span>Qualified</span><strong>8</strong></div>
            <div className="lime"><span>Interviews</span><strong>5</strong></div>
          </div>
          <div className="candidate-list">
            {candidates.map(c => <div className="candidate" key={c.initials}>
              <div className="avatar">{c.initials}</div>
              <div><strong>{c.role}</strong><span><MapPin size={12}/>{c.location}</span></div>
              <div><em>● {c.freshness}</em><span>{c.shift} · {c.radius}</span></div>
              <button>Invite</button>
            </div>)}
          </div>
        </div>
      </section>

      <section className="split" id="how">
        <div><div className="eyebrow muted">Recruiting without the resume graveyard</div><h2>Stop paying for applicants who disappeared weeks ago.</h2></div>
        <div className="copy"><p>Most recruiting products optimize for applicant volume. CareJoys is built around the harder question: <strong>who is reachable, qualified enough for this opening, and interested now?</strong></p><p>Every worker record gets more useful as availability, location, shifts, wage expectations, responses, interviews, and hires are refreshed over time.</p></div>
      </section>

      <section className="section" id="network">
        <div className="section-head"><div className="eyebrow muted">The platform</div><h2>Own the worker relationship, not just the lead.</h2><p>CareJoys is designed as a persistent workforce network with recruiting automation on top.</p></div>
        <div className="features">{features.map(([Icon,title,text]) => <article key={title}><div className="icon"><Icon size={22}/></div><h3>{title}</h3><p>{text}</p></article>)}</div>
      </section>

      <section className="school" id="schools">
        <div><div className="eyebrow">For training programs</div><h2>Turn graduation day into a hiring pipeline.</h2><p>Give CNA, HHA, and direct-care training programs a free way to invite graduating cohorts, help students become visible to local employers, and track placement outcomes.</p><a className="button dark big" href="mailto:hello@carejoys.com?subject=CareJoys school partnership">Partner with CareJoys <ArrowRight size={18}/></a></div>
        <div className="cohort"><div className="toolbar"><div><small>SPRING COHORT</small><strong>Example CNA Program</strong></div><GraduationCap/></div><div className="cohort-metrics"><div><b>63</b><span>students</span></div><div><b>51</b><span>profiles</span></div><div><b>32</b><span>interviewing</span></div><div><b>—</b><span>placement</span></div></div></div>
      </section>

      <section className="section">
        <div className="section-head center"><div className="eyebrow muted">A different recruiting model</div><h2>Measure hires, not database size.</h2></div>
        <div className="compare">
          <article className="old"><small>TRADITIONAL SOURCING</small><h3>Here are 50 applicants.</h3><p>Recruiter chases every candidate. Availability gets stale. Shared applicants apply everywhere. Value stops at the lead.</p></article>
          <article className="new"><small>CAREJOYS</small><h3>Here are the people ready to interview.</h3><p>Availability is refreshed. Outreach and screening are automated. Employers see response and qualification status. Every interaction strengthens the network.</p></article>
        </div>
      </section>

      <section className="cta"><div><div className="eyebrow">Care workforce infrastructure</div><h2>Your next caregiver may already be looking.</h2></div><a className="button cream big" href="mailto:hello@carejoys.com?subject=CareJoys employer access">Start recruiting <ArrowRight size={18}/></a></section>
    </main>

    <footer><a className="brand" href="#"><span>C</span>CareJoys</a><p>Built for the direct-care workforce.</p><p>© 2026 CareJoys</p></footer>
  </div>
}