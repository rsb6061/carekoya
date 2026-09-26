import { useState, type FormEvent } from 'react';
import { EmployerWorkspace } from './EmployerWorkspace';
import { CaregiverActivation } from './CaregiverActivation';
import { EmployerAuth } from './EmployerAuth';
import { CandidateResponse } from './CandidateResponse';
import { TurnstileField } from './TurnstileField';
import { LegalPage } from './LegalPage';
import { AgencyClaim } from './AgencyClaim';
import { MarylandCaregiverPage } from './MarylandCaregiverPage';
import { SchoolProgramPage, SchoolAuth, SchoolDashboard } from './SchoolPortal';
import { MarylandSchoolsPage } from './MarylandSchoolsPage';
import { TrainingOrganizationPage } from './TrainingOrganizationPage';
import { EmployerRecruitingPage, AboutCareJoysPage } from './PublicInfoPages';
import { HowToBecomeCaregiverMarylandPage } from './CaregiverResourcePage';
import { CaregiverResumePage } from './CaregiverResumePage';

type FormKind = 'employer' | 'caregiver' | 'school' | null;

type EmployerPreset = { role?: string; zip?: string };

async function submitJson(path: string, data: Record<string, unknown>) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(data)
  });
  const body = await response.json() as {
    ok?: boolean;
    error?: string;
    workspaceId?: string;
    workspaceUrl?: string;
    matchedOrganizations?: number;
    matchedOpenings?: number;
    existing?: boolean;
  };
  if (!response.ok) throw new Error(body.error || 'Something went wrong');
  return body;
}

function IntakeModal({
  kind,
  onClose,
  employerPreset
}: {
  kind: Exclude<FormKind, null>;
  onClose: () => void;
  employerPreset?: EmployerPreset;
}) {
  const [status, setStatus] = useState<'idle'|'saving'|'success'|'error'>('idle');
  const [message, setMessage] = useState('');
  const [turnstileToken, setTurnstileToken] = useState('');

  const titles = {
    employer: ['Find caregivers', 'Tell us who you need. CareJoys will create the opening, match local caregivers, and email you a secure link to review matches.'],
    caregiver: ['Find caregiver jobs', 'Create one profile and get matched with local care employers based on your role, location, shifts, and pay preferences.'],
    school: ['Request program addition', 'Can’t find your caregiver training program? Send it to CareJoys and we’ll review it for the Maryland directory.']
  } as const;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus('saving');
    setMessage('');
    const fd = new FormData(event.currentTarget);
    const data = Object.fromEntries(fd.entries()) as Record<string, unknown>;
    if (kind === 'caregiver') data.smsConsent = fd.get('smsConsent') === 'on';
    data.turnstileToken = turnstileToken;

    try {
      const result = await submitJson(
        kind === 'employer' ? '/api/employers' : kind === 'caregiver' ? '/api/caregivers' : '/api/schools',
        data
      );
      if (kind === 'employer') {
        setMessage('Check your email. Your opening is already created, and the secure link will take you straight to your matches.');
      } else if (kind === 'caregiver') {
        setMessage('We found '+Number(result.matchedOrganizations||0)+' relevant care organizations and '+Number(result.matchedOpenings||0)+' current openings based on your profile.');
      }
      setStatus('success');
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : 'Something went wrong');
    }
  }

  return <div className="modal-backdrop" onMouseDown={onClose}>
    <div className="modal-panel" onMouseDown={e => e.stopPropagation()}>
      <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
      {status === 'success' ? <div className="modal-success">
        <div className="success-mark">✓</div>
        <h2>{kind === 'employer' ? 'Check your email.' : "You're in."}</h2>
        <p>{kind === 'employer' ? (message || 'We sent a secure sign-in link to your email.') : kind === 'caregiver' ? (message || 'Your profile is in the CareJoys network.') : 'We received your information. CareJoys will use it to start the right next step for you.'}</p>
        <button className="btn" onClick={onClose}>Done</button>
      </div> : <>
        <div className="modal-kicker">{kind === 'employer' ? 'For employers' : kind === 'caregiver' ? 'For caregivers' : 'For training programs'}</div>
        <h2>{titles[kind][0]}</h2>
        <p className="modal-intro">{titles[kind][1]}</p>
        <form className="intake-form" onSubmit={handleSubmit}>
          {kind === 'employer' && <>
            <label>Company name<input name="companyName" required /></label>
            <label>Your name<input name="contactName" required /></label>
            <div className="form-grid"><label>Email<input type="email" name="email" required /></label><label>Phone<input name="phone" /></label></div>
            <div className="form-grid"><label>Hiring ZIP<input name="zip" inputMode="numeric" required defaultValue={employerPreset?.zip || ''} /></label><label>Role needed<select name="rolesNeeded" required defaultValue={employerPreset?.role || ''}><option value="" disabled>Select</option><option>CNA</option><option>GNA</option><option>HHA</option><option>PCA</option><option>Caregiver</option><option>DSP</option></select></label></div>
            <div className="form-grid"><label>Shift<input name="shifts" placeholder="Days, nights, weekends" /></label><label>Transportation<select name="transportationRequired" defaultValue=""><option value="">Not specified</option><option value="yes">Required</option><option value="no">Not required</option></select></label></div>
            <div className="form-grid"><label>Min pay / hr<input type="number" name="payMin" min="0" /></label><label>Max pay / hr<input type="number" name="payMax" min="0" /></label></div>
            <label>Must-have requirements<textarea name="hiringNotes" rows={3} placeholder="Experience, credential, schedule, client requirements..." /></label>
          </>}
          {kind === 'caregiver' && <>
            <div className="form-grid"><label>First name<input name="firstName" required /></label><label>Last name<input name="lastName" required /></label></div>
            <div className="form-grid"><label>Email<input type="email" name="email" required /></label><label>Mobile phone<input name="phone" required /></label></div>
            <div className="form-grid"><label>ZIP code<input name="zip" inputMode="numeric" required /></label><label>Role<select name="role" required defaultValue=""><option value="" disabled>Select</option><option>CNA</option><option>GNA</option><option>HHA</option><option>PCA</option><option>Caregiver</option><option>Other</option></select></label></div>
            <div className="form-grid"><label>Preferred shifts<input name="shifts" placeholder="Days, nights, weekends" /></label><label>Desired hourly pay<input name="desiredWage" placeholder="$20–24/hr" /></label></div>
            <label>Transportation<select name="transportation" defaultValue=""><option value="">Select</option><option value="own_car">Own car</option><option value="reliable_transportation">Reliable transportation</option><option value="public_transit">Public transit</option><option value="other">Other</option></select></label>
            <div className="legal-consent">By joining CareJoys, you understand that your caregiver work profile may be shown to participating care employers for recruiting. Your current availability is labeled separately, and you can mark yourself not looking to leave employer search. See our <a href="/privacy-policy" target="_blank">Privacy Policy</a> and <a href="/terms-of-service" target="_blank">Terms</a>.</div>
            <label className="check-row"><input type="checkbox" name="smsConsent" /><span>I agree to receive CareJoys texts about job opportunities and availability. Message/data rates may apply. Reply STOP to opt out.</span></label>
          </>}
          {kind === 'school' && <>
            <label>School / program name<input name="organizationName" required /></label>
            <label>Your name<input name="contactName" required /></label>
            <div className="form-grid"><label>Email<input type="email" name="email" required /></label><label>Phone<input name="phone" /></label></div>
            <div className="form-grid"><label>City<input name="city" /></label><label>State<input name="state" /></label></div>
            <div className="form-grid"><label>Programs<input name="programTypes" placeholder="CNA, HHA..." /></label><label>Graduates per year<input name="graduatingCount" inputMode="numeric" /></label></div>
            <label>Notes<textarea name="notes" rows={4} placeholder="Cohort timing, placement process, employer partners..." /></label>
          </>}
          <TurnstileField onToken={setTurnstileToken} />
          {status === 'error' && <div className="notice">{message}</div>}
          <button className="btn submit-button" disabled={status === 'saving'}>{status === 'saving' ? 'Submitting…' : kind === 'employer' ? 'Find matches' : kind === 'caregiver' ? 'Find jobs' : 'Request addition'}</button>
        </form>
      </>}
    </div>
  </div>;
}

export function App() {
  if (window.location.pathname.startsWith('/hire-caregivers/maryland')) return <EmployerRecruitingPage />;
  if (window.location.pathname.startsWith('/caregiver-resume')) return <CaregiverResumePage />;
  if (window.location.pathname.startsWith('/resources/how-to-become-a-caregiver-in-maryland')) return <HowToBecomeCaregiverMarylandPage />;
  if (window.location.pathname === '/about' || window.location.pathname.startsWith('/about/')) return <AboutCareJoysPage />;
  if (window.location.pathname.startsWith('/activate')) return <CaregiverActivation />;
  if (window.location.pathname.startsWith('/auth')) return <EmployerAuth />;
  if (window.location.pathname.startsWith('/respond')) return <CandidateResponse />;
  if (window.location.pathname.startsWith('/agency')) return <AgencyClaim />;
  if (window.location.pathname.startsWith('/caregiver-jobs/maryland') || window.location.pathname.startsWith('/join/')) return <MarylandCaregiverPage />;
  if (window.location.pathname.startsWith('/training-programs/maryland') || window.location.pathname.startsWith('/schools/maryland')) return <MarylandSchoolsPage />;
  if (window.location.pathname.startsWith('/training-programs/')) return <TrainingOrganizationPage />;
  if (window.location.pathname.startsWith('/school-auth')) return <SchoolAuth />;
  if (window.location.pathname.startsWith('/school-dashboard')) return <SchoolDashboard />;
  if (window.location.pathname.startsWith('/school/')) return <SchoolProgramPage />;
  if (window.location.pathname.startsWith('/privacy-policy')) return <LegalPage kind="privacy" />;
  if (window.location.pathname.startsWith('/terms-of-service')) return <LegalPage kind="terms" />;
  if (window.location.pathname.startsWith('/app')) return <EmployerWorkspace />;

  const [form, setForm] = useState<FormKind>(() => new URLSearchParams(window.location.search).get('hire') === '1' ? 'employer' : null);
  const [employerPreset, setEmployerPreset] = useState<EmployerPreset>({});

  function handleHeroSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    setEmployerPreset({
      role: String(fd.get('role') || ''),
      zip: String(fd.get('location') || '')
    });
    setForm('employer');
  }

  return <div>
    <header className="nav">
      <div className="wrap nav-inner">
        <a className="brand" href="/">CareJoys</a>
        <nav className="navlinks">
          <a className="hide-sm" href="/about">How it works</a>
          <a className="hide-sm" href="/caregiver-jobs/maryland">Caregiver jobs</a>
          <a className="hide-sm" href="/training-programs/maryland">Training programs</a>
          <a href="/hire-caregivers/maryland">For employers</a>
          <button id="nav-primary" onClick={() => { setEmployerPreset({}); setForm('employer'); }}>Find caregivers</button>
        </nav>
      </div>
    </header>

    <main>
      <section className="hero">
        <div className="wrap">
          <h1>
            <span className="hero-title-line">Caregiver recruiting in Maryland.</span>
            <span className="hero-title-line">Interviews ready for you.</span>
          </h1>
          <p>CareJoys helps Maryland home-care agencies and employers match with local caregivers ready to work.</p>
          <form className="search" onSubmit={handleHeroSearch}>
            <select name="role" defaultValue="">
              <option value="">All caregiver roles</option>
              <option value="CNA">CNA</option>
              <option value="GNA">GNA</option>
              <option value="HHA">HHA</option>
              <option value="PCA">PCA</option>
              <option value="Caregiver">Caregiver</option>
            </select>
            <input name="location" placeholder="City, state, or ZIP" />
            <button className="btn" type="submit">Find caregivers</button>
          </form>
        </div>
      </section>

      <section className="section" id="how">
        <div className="wrap">
          <h2>From hiring need to interview</h2>
          <div className="jobs">
            <div className="job">
              <div><h3>Find the right local caregivers</h3><div className="meta">Search by role, geography, shift, pay expectations, commute, and availability freshness.</div><div className="job-tags"><span className="pill">Fresh talent network</span></div></div>
              <div className="meta">01</div>
            </div>
            <div className="job">
              <div><h3>Confirm who is actually interested</h3><div className="meta">CareJoys is designed to reactivate candidates and confirm fit before your team spends time chasing them.</div><div className="job-tags"><span className="pill">Automated activation</span></div></div>
              <div className="meta">02</div>
            </div>
            <div className="job">
              <div><h3>Move qualified people into interviews</h3><div className="meta">Track matched, contacted, interested, qualified, interview, and hired stages in one simple recruiting workspace.</div><div className="job-tags"><span className="pill">Interview-ready</span></div></div>
              <div className="meta">03</div>
            </div>
          </div>
        </div>
      </section>

      <section className="section" id="caregivers">
        <div className="wrap">
          <h2>For caregivers</h2>
          <div className="jobcta">
            <div>
              <strong>One profile. Better local opportunities.</strong>
              <span>Tell CareJoys where you work, what shifts you want, and when you are looking. Keep your availability current without rebuilding a resume for every employer.</span>
            </div>
            <a className="btn" href="/caregiver-jobs/maryland">Find jobs</a>
          </div>
        </div>
      </section>

      <section className="section" id="schools">
        <div className="wrap">
          <h2>For caregiver training programs</h2>
          <div className="jobs">
            <div className="job">
              <div><h3>Turn graduation day into a hiring pipeline</h3><div className="meta">CNA/GNA and other direct-care training programs can introduce graduating cohorts to local employers and track placement outcomes.</div><div className="job-tags"><span className="pill">Free for schools</span><span className="pill">Cohort placement</span></div></div>
              <div className="school-home-actions"><a className="btn secondary" href="/training-programs/maryland">Find your Maryland program</a><button className="text-button" onClick={() => setForm('school')}>Program not listed? Request addition</button></div>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <h2>Measure hires, not database size.</h2>
          <div className="jobs">
            <div className="job">
              <div><h3>Availability is a live signal</h3><div className="meta">Older caregiver profiles can remain discoverable, but their availability is clearly labeled unconfirmed until they refresh it. Recent confirmations rank higher.</div></div>
              <span className="pill">Freshness shown explicitly</span>
            </div>
            <div className="job">
              <div><h3>Every recruiting interaction improves the network</h3><div className="meta">Responses, preferences, interviews, and hires create a longitudinal workforce record rather than a one-time lead.</div></div>
              <span className="pill">Persistent workforce graph</span>
            </div>
          </div>
        </div>
      </section>
    </main>

    <footer className="footer">
      <div className="wrap">CareJoys · Maryland caregiver recruiting and placement · <a href="/hire-caregivers/maryland">For employers</a> · <a href="/caregiver-jobs/maryland">Caregiver jobs</a> · <a href="/training-programs/maryland">Training programs</a> · <a href="/about">About</a> · <a href="/privacy-policy">Privacy</a> · <a href="/terms-of-service">Terms</a></div>
    </footer>

    {form && <IntakeModal kind={form} employerPreset={employerPreset} onClose={() => setForm(null)} />}
  </div>
}