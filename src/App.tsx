import { useState, type FormEvent } from 'react';
import { EmployerWorkspace } from './EmployerWorkspace';
import { CaregiverActivation } from './CaregiverActivation';

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

  const titles = {
    employer: ['Find caregivers', 'Tell us what you are hiring for. We will use this to build your initial recruiting pipeline.'],
    caregiver: ['Join the CareJoys network', 'Create a simple work profile so local care employers can find you when you are looking.'],
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
      const result = await submitJson(
        kind === 'employer' ? '/api/employers' : kind === 'caregiver' ? '/api/caregivers' : '/api/schools',
        data
      );
      if (kind === 'employer' && result.workspaceId) {
        window.location.href = result.workspaceUrl || '/app?workspace=' + result.workspaceId;
        return;
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
        <h2>You're in.</h2>
        <p>We received your information. CareJoys will use it to start the right next step for you.</p>
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
            <div className="form-grid"><label>Hiring ZIP<input name="zip" inputMode="numeric" required defaultValue={employerPreset?.zip || ''} /></label><label>Roles needed<input name="rolesNeeded" placeholder="CNA, HHA, caregiver" defaultValue={employerPreset?.role || ''} /></label></div>
            <label>What are you hiring for?<textarea name="hiringNotes" rows={4} placeholder="Shift, pay range, number of openings, must-have requirements..." /></label>
          </>}
          {kind === 'caregiver' && <>
            <div className="form-grid"><label>First name<input name="firstName" required /></label><label>Last name<input name="lastName" required /></label></div>
            <div className="form-grid"><label>Email<input type="email" name="email" required /></label><label>Mobile phone<input name="phone" required /></label></div>
            <div className="form-grid"><label>ZIP code<input name="zip" inputMode="numeric" required /></label><label>Role<select name="role" required defaultValue=""><option value="" disabled>Select</option><option>CNA</option><option>GNA</option><option>HHA</option><option>PCA</option><option>Caregiver</option><option>Other</option></select></label></div>
            <div className="form-grid"><label>Preferred shifts<input name="shifts" placeholder="Days, nights, weekends" /></label><label>Desired hourly pay<input name="desiredWage" placeholder="$20–24/hr" /></label></div>
            <label>Transportation<select name="transportation" defaultValue=""><option value="">Select</option><option value="own_car">Own car</option><option value="reliable_transportation">Reliable transportation</option><option value="public_transit">Public transit</option><option value="other">Other</option></select></label>
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
          {status === 'error' && <div className="notice">{message}</div>}
          <button className="btn submit-button" disabled={status === 'saving'}>{status === 'saving' ? 'Submitting…' : kind === 'employer' ? 'Start recruiting' : kind === 'caregiver' ? 'Join CareJoys' : 'Request partnership'}</button>
        </form>
      </>}
    </div>
  </div>;
}

export function App() {
  if (window.location.pathname.startsWith('/activate')) return <CaregiverActivation />;
  if (window.location.pathname.startsWith('/app')) return <EmployerWorkspace />;

  const [form, setForm] = useState<FormKind>(null);
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
          <a className="hide-sm" href="#how">How it works</a>
          <a className="hide-sm" href="#caregivers">For caregivers</a>
          <a className="hide-sm" href="#schools">For schools</a>
          <a href="/app">Employer workspace</a>
          <button id="nav-primary" onClick={() => { setEmployerPreset({}); setForm('employer'); }}>Find caregivers</button>
        </nav>
      </div>
    </header>

    <main>
      <section className="hero">
        <div className="wrap">
          <h1>
            <span className="hero-title-line">Caregivers ready to work.</span>
            <span className="hero-title-line">Interviews ready for you.</span>
          </h1>
          <p>CareJoys helps home-care and senior-care employers find CNAs, HHAs, and caregivers nearby, confirm who is actually looking, screen fit, and turn matches into interviews.</p>
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

      <section className="section source-section">
        <div className="wrap">
          <div className="source-strip">
            <div className="source-strip-title">A fresher caregiver network</div>
            <div className="meta">CareJoys is built around current availability, location, shift preferences, and response—not a pile of old resumes.</div>
          </div>
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
            <button className="btn" onClick={() => setForm('caregiver')}>Join the network</button>
          </div>
        </div>
      </section>

      <section className="section" id="schools">
        <div className="wrap">
          <h2>For training programs</h2>
          <div className="jobs">
            <div className="job">
              <div><h3>Turn graduation day into a hiring pipeline</h3><div className="meta">CNA, HHA, and direct-care programs can introduce graduating cohorts to local employers and track placement outcomes.</div><div className="job-tags"><span className="pill">Free for schools</span><span className="pill">Cohort placement</span></div></div>
              <button className="btn secondary" onClick={() => setForm('school')}>Partner with CareJoys</button>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <h2>Measure hires, not database size.</h2>
          <div className="jobs">
            <div className="job">
              <div><h3>Availability is a live signal</h3><div className="meta">Imported or older profiles are not labeled active until the caregiver reconfirms. Freshness is visible instead of implied.</div></div>
              <span className="pill">Availability unconfirmed until refreshed</span>
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
      <div className="wrap">CareJoys · Caregivers ready to work. Interviews ready for you. · <a href="#caregivers">For caregivers</a> · <a href="#schools">For schools</a></div>
    </footer>

    {form && <IntakeModal kind={form} employerPreset={employerPreset} onClose={() => setForm(null)} />}
  </div>
}