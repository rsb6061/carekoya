import { useState, type FormEvent } from 'react';
import { ArrowRight, Check, GraduationCap, MapPin, Search, MessageSquareText, CalendarCheck2, ShieldCheck, UsersRound, Sparkles, X } from 'lucide-react';
import { EmployerWorkspace } from './EmployerWorkspace';

type FormKind = 'employer' | 'caregiver' | 'school' | null;

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

async function submitJson(path: string, data: Record<string, unknown>) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(data)
  });
  const body = await response.json() as { ok?: boolean; error?: string };
  if (!response.ok) throw new Error(body.error || 'Something went wrong');
  return body;
}

function IntakeModal({ kind, onClose }: { kind: Exclude<FormKind, null>, onClose: () => void }) {
  const [status, setStatus] = useState<'idle'|'saving'|'success'|'error'>('idle');
  const [message, setMessage] = useState('');

  const titles = {
    employer: ['Find caregivers', 'Tell us what you are hiring for. We will use this to build your initial recruiting pipeline.'],
    caregiver: ['Join the CareJoys network', 'Create a lightweight work profile so local care employers can find you when you are looking.'],
    school: ['Partner with CareJoys', 'Help graduates get discovered by local care employers and track placement outcomes.']
  } as const;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus('saving');
    setMessage('');
    const fd = new FormData(event.currentTarget);
    const data = Object.fromEntries(fd.entries()) as Record<string, unknown>;
    if (kind === 'caregiver') data.smsConsent = fd.get('smsConsent') === 'on';

    try {
      await submitJson(
        kind === 'employer' ? '/api/employers' : kind === 'caregiver' ? '/api/caregivers' : '/api/schools',
        data
      );
      setStatus('success');
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : 'Something went wrong');
    }
  }

  return <div className="modal-backdrop" onMouseDown={onClose}>
    <div className="modal" onMouseDown={e => e.stopPropagation()}>
      <button className="modal-close" onClick={onClose} aria-label="Close"><X size={20}/></button>
      {status === 'success' ? <div className="success-state">
        <div className="success-icon"><Check size={24}/></div>
        <h2>You're in.</h2>
        <p>We received your information. CareJoys will use it to start the right next step for you.</p>
        <button className="button dark big" onClick={onClose}>Done</button>
      </div> : <>
        <div className="eyebrow muted">{kind === 'employer' ? 'For employers' : kind === 'caregiver' ? 'For caregivers' : 'For training programs'}</div>
        <h2>{titles[kind][0]}</h2>
        <p className="modal-intro">{titles[kind][1]}</p>
        <form className="intake-form" onSubmit={handleSubmit}>
          {kind === 'employer' && <>
            <label>Company name<input name="companyName" required /></label>
            <label>Your name<input name="contactName" required /></label>
            <div className="form-grid"><label>Email<input type="email" name="email" required /></label><label>Phone<input name="phone" /></label></div>
            <div className="form-grid"><label>Hiring ZIP<input name="zip" inputMode="numeric" required /></label><label>Roles needed<input name="rolesNeeded" placeholder="CNA, HHA, caregiver" /></label></div>
            <label>What are you hiring for?<textarea name="hiringNotes" rows={4} placeholder="Shift, pay range, number of openings, must-have requirements..." /></label>
          </>}
          {kind === 'caregiver' && <>
            <div className="form-grid"><label>First name<input name="firstName" required /></label><label>Last name<input name="lastName" required /></label></div>
            <div className="form-grid"><label>Email<input type="email" name="email" required /></label><label>Mobile phone<input name="phone" required /></label></div>
            <div className="form-grid"><label>ZIP code<input name="zip" inputMode="numeric" required /></label><label>Role<select name="role" required defaultValue=""><option value="" disabled>Select</option><option>CNA</option><option>GNA</option><option>HHA</option><option>PCA</option><option>Caregiver</option><option>Other</option></select></label></div>
            <div className="form-grid"><label>Preferred shifts<input name="shifts" placeholder="Days, nights, weekends" /></label><label>Desired hourly pay<input name="desiredWage" placeholder="$20–24/hr" /></label></div>
            <label>Transportation<select name="transportation" defaultValue=""><option value="">Select</option><option value="own_car">Own car</option><option value="reliable_transportation">Reliable transportation</option><option value="public_transit">Public transit</option><option value="other">Other</option></select></label>
            <label className="check-row"><input type="checkbox" name="smsConsent" /> <span>I agree to receive CareJoys texts about job opportunities and availability. Message/data rates may apply. Reply STOP to opt out.</span></label>
          </>}
          {kind === 'school' && <>
            <label>School / program name<input name="organizationName" required /></label>
            <label>Your name<input name="contactName" required /></label>
            <div className="form-grid"><label>Email<input type="email" name="email" required /></label><label>Phone<input name="phone" /></label></div>
            <div className="form-grid"><label>City<input name="city" /></label><label>State<input name="state" /></label></div>
            <div className="form-grid"><label>Programs<input name="programTypes" placeholder="CNA, HHA..." /></label><label>Graduates per year<input name="graduatingCount" inputMode="numeric" /></label></div>
            <label>Notes<textarea name="notes" rows={4} placeholder="Cohort timing, placement process, employer partners..." /></label>
          </>}
          {status === 'error' && <div className="form-error">{message}</div>}
          <button className="button primary big submit-button" disabled={status === 'saving'}>{status === 'saving' ? 'Submitting…' : kind === 'employer' ? 'Start recruiting' : kind === 'caregiver' ? 'Join CareJoys' : 'Request partnership'}</button>
        </form>
      </>}
    </div>
  </div>;
}

export function App() {
  if (window.location.pathname.startsWith('/app')) return <EmployerWorkspace />;
  const [form, setForm] = useState<FormKind>(null);

  return <div>
    <header className="header">
      <a className="brand" href="#"><span>C</span>CareJoys</a>
      <nav><a href="#how">How it works</a><a href="#network">Talent network</a><a href="#schools">For schools</a></nav>
      <button className="button dark header-button" onClick={() => setForm('employer')}>Find caregivers</button>
    </header>

    <main>
      <section className="hero">
        <div className="eyebrow"><Sparkles size={14}/> The active caregiver network</div>
        <h1>Caregivers ready to work.<br/>Interviews ready for you.</h1>
        <p>CareJoys helps home-care and senior-care employers find CNAs, HHAs, and caregivers nearby, confirm who is actually looking, screen fit, and turn matches into interviews.</p>
        <div className="actions">
          <button className="button primary big" onClick={() => setForm('employer')}>Find caregivers <ArrowRight size={18}/></button>
          <button className="button light big" onClick={() => setForm('caregiver')}>Join the network</button>
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
              <button type="button">Invite</button>
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
        <div><div className="eyebrow">For training programs</div><h2>Turn graduation day into a hiring pipeline.</h2><p>Give CNA, HHA, and direct-care training programs a free way to invite graduating cohorts, help students become visible to local employers, and track placement outcomes.</p><button className="button dark big" onClick={() => setForm('school')}>Partner with CareJoys <ArrowRight size={18}/></button></div>
        <div className="cohort"><div className="toolbar"><div><small>SPRING COHORT</small><strong>Example CNA Program</strong></div><GraduationCap/></div><div className="cohort-metrics"><div><b>63</b><span>students</span></div><div><b>51</b><span>profiles</span></div><div><b>32</b><span>interviewing</span></div><div><b>—</b><span>placement</span></div></div></div>
      </section>

      <section className="section">
        <div className="section-head center"><div className="eyebrow muted">A different recruiting model</div><h2>Measure hires, not database size.</h2></div>
        <div className="compare">
          <article className="old"><small>TRADITIONAL SOURCING</small><h3>Here are 50 applicants.</h3><p>Recruiter chases every candidate. Availability gets stale. Shared applicants apply everywhere. Value stops at the lead.</p></article>
          <article className="new"><small>CAREJOYS</small><h3>Here are the people ready to interview.</h3><p>Availability is refreshed. Outreach and screening are automated. Employers see response and qualification status. Every interaction strengthens the network.</p></article>
        </div>
      </section>

      <section className="cta"><div><div className="eyebrow">Care workforce infrastructure</div><h2>Your next caregiver may already be looking.</h2></div><button className="button cream big" onClick={() => setForm('employer')}>Start recruiting <ArrowRight size={18}/></button></section>
    </main>

    <footer><a className="brand" href="#"><span>C</span>CareJoys</a><p>Built for the direct-care workforce.</p><p>© 2026 CareJoys</p></footer>

    {form && <IntakeModal kind={form} onClose={() => setForm(null)} />}
  </div>
}