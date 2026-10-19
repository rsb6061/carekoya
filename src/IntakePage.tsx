import { useEffect, useState, type FormEvent } from 'react';
import { TurnstileField } from './TurnstileField';
import { useCaregiverAuth } from './caregiverAuth';
import { Shell } from './LoginPage';
import { AgencyFinder } from './AgencyFinder';
import { ScheduleEditor } from './ScheduleEditor';
import './workspace.css';

type Kind = 'employer' | 'school';

async function submitJson(path: string, data: Record<string, unknown>) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(data)
  });
  const body = await response.json() as { ok?: boolean; error?: string; outOfArea?: boolean; redirect?: string };
  if (!response.ok) throw new Error(body.error || 'Something went wrong');
  return body;
}

const ROLES = ['CNA', 'GNA', 'HHA', 'PCA', 'Caregiver', 'DSP', 'CMT / Med Tech', 'Resident Assistant', 'Memory Care Aide'];

/** /hire-caregivers: the step after /pricing. An employer tells us about their hiring, then can book a call from the confirmation. */
export function FindCaregiversPage() {
  return <IntakePage kind="employer" />;
}

/** /add-training-program: a school asks to be added to the training-program directory. */
export function AddTrainingProgramPage() {
  return <IntakePage kind="school" />;
}

function IntakePage({ kind }: { kind: Kind }) {
  const auth = useCaregiverAuth();
  const params = new URLSearchParams(window.location.search);
  const presetRole = ROLES.includes(params.get('role') || '') ? params.get('role') || '' : '';
  const presetZip = (params.get('zip') || '').replace(/\D/g, '').slice(0, 5);
  // Signed in: the opening is created for this email and the workspace opens right away.
  const lockedEmail = auth.isAuthenticated ? auth.email : '';
  const [status, setStatus] = useState<'idle'|'saving'|'success'|'error'>('idle');
  const [message, setMessage] = useState('');
  const [turnstileToken, setTurnstileToken] = useState('');
  // A signed-in employer's company, name, phone and ZIP are already on file.
  const [known, setKnown] = useState<{companyName?:string;contactName?:string;phone?:string;zip?:string}|null>(null);
  // Booking link for the confirmation screen; set as EMPLOYER_CALL_URL on the Worker.
  const [callUrl, setCallUrl] = useState('');
  useEffect(() => {
    if (kind !== 'employer') return;
    fetch('/api/public/pricing').then(r => r.json()).then((d: any) => setCallUrl(typeof d?.callUrl === 'string' ? d.callUrl : '')).catch(() => {});
  }, [kind]);
  useEffect(() => {
    if(kind!=='employer')return;
    const goToClaim=()=>{if(window.location.hash==='#claim-agency')window.requestAnimationFrame(()=>document.getElementById('claim-agency')?.scrollIntoView({block:'start'}))};
    goToClaim();
    window.addEventListener('hashchange',goToClaim);
    return ()=>window.removeEventListener('hashchange',goToClaim);
  },[kind,auth.loading]);
  useEffect(() => {
    if (kind !== 'employer' || !auth.isAuthenticated) return;
    fetch('/api/session').then(r => r.ok ? r.json() : null).then((d: any) => setKnown(d?.employer || {})).catch(() => setKnown({}));
  }, [kind, auth.isAuthenticated]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus('saving');
    setMessage('');
    const data = Object.fromEntries(new FormData(event.currentTarget).entries()) as Record<string, unknown>;
    data.turnstileToken = turnstileToken;
    try {
      const result = await submitJson(kind === 'employer' ? '/api/employers' : '/api/schools', data);
      if (result.redirect) { window.location.assign(result.redirect); return; }
      if (kind === 'employer') setMessage('We emailed you a secure link to your hiring workspace.'+(result.outOfArea?' CareJoys is still growing in your area, so we’ll talk through coverage on the call.':''));
      setStatus('success');
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : 'Something went wrong');
    }
  }

  if (auth.loading) return <div className="loading-screen">Loading CareJoys…</div>;

  if (status === 'success') return <Shell><div className="login-card">
    <div className="success-mark">✓</div>
    <h1 style={{marginTop:18}}>{kind === 'employer' ? 'You’re in. Let’s pick a time.' : 'Thanks, we have it.'}</h1>
    <p className="login-sub">{kind === 'employer'
      ? (callUrl ? 'Book a 30-minute call and we’ll walk through your openings and how we’ll take over your applicant pipeline. '+message : message+' Reply to that email and we’ll set up a 30-minute call about your openings.')
      : 'CareJoys will review your program for the Maryland directory and reply by email.'}</p>
    <div className="empty-actions">
      {kind === 'employer' && callUrl && <a className="button" href={callUrl} target="_blank" rel="noopener noreferrer">Book a call</a>}
      <a className="button secondary" href="/">Back to CareJoys</a>
    </div>
  </div></Shell>;

  return <Shell wide><div className="intake-page login-card">
    <div className="modal-kicker">{kind === 'employer' ? 'For employers' : 'For training programs'}</div>
    <h1>{kind === 'employer' ? 'Tell us about your hiring' : 'Add your training program'}</h1>
    <p className="login-sub">{kind === 'employer'
      ? 'We’ll take over your applicant pipeline. Every applicant contacted right away, screened, and scheduled.'
      : 'Can’t find your caregiver training program? Send it to CareJoys and we’ll review it for the Maryland directory.'}</p>
    {kind==='employer'&&<p className="login-sub">Already listed as a licensed agency? <a className="text-link" href="#claim-agency">Claim your agency free</a>.</p>}
    <form className="intake-form" onSubmit={handleSubmit}>
      {kind === 'employer' ? <>
        <div className="form-grid">
          <label>Role needed<select name="rolesNeeded" required defaultValue={presetRole}><option value="" disabled>Select</option>{ROLES.map(r => <option key={r}>{r}</option>)}</select></label>
          <label>Hiring ZIP<input name="zip" inputMode="numeric" pattern="[0-9]{5}" maxLength={5} required defaultValue={presetZip || known?.zip || ''} key={'zip'+(known?.zip||'')} /></label>
        </div>
        <label>Company name<input name="companyName" required defaultValue={known?.companyName || ''} key={'co'+(known?.companyName||'')} /></label>
        <label>Your name<input name="contactName" required defaultValue={known?.contactName || ''} key={'cn'+(known?.contactName||'')} /></label>
        <div className="form-grid">
          <label>Email<input type="email" name="email" required defaultValue={lockedEmail} readOnly={!!lockedEmail} /></label>
          <label>Phone (optional)<input name="phone" defaultValue={known?.phone || ''} key={'ph'+(known?.phone||'')} /></label>
        </div>
      </> : <>
        <label>School / program name<input name="organizationName" required /></label>
        <label>Your name<input name="contactName" required /></label>
        <div className="form-grid"><label>Email<input type="email" name="email" required defaultValue={lockedEmail} /></label><label>Phone (optional)<input name="phone" /></label></div>
        <div className="form-grid"><label>City<input name="city" /></label><label>State<input name="state" /></label></div>
        <div className="form-grid"><label>Programs<input name="programTypes" placeholder="CNA, HHA..." /></label><label>Graduates per year<input name="graduatingCount" inputMode="numeric" /></label></div>
        <label>Notes<textarea name="notes" rows={4} placeholder="Cohort timing, placement process, employer partners..." /></label>
      </>}
      <TurnstileField onToken={setTurnstileToken} />
      {status === 'error' && <div className="notice">{message}</div>}
      <button className="button login-continue" disabled={status === 'saving'}>{status === 'saving' ? 'Submitting…' : kind === 'employer' ? 'Get started' : 'Request addition'}</button>
    </form>
  </div>
  {kind==='employer'&&<section id="claim-agency" className="intake-agency-claim" aria-label="Claim your agency">
    <h2>Already a licensed home-care agency?</h2>
    <p>Find your agency in our directory and claim it free. We’ll verify your agency before linking its jobs and caregiver matches to your workspace.</p>
    <AgencyFinder/>
  </section>}
  </Shell>;
}
