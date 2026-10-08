import { useEffect, useState, type FormEvent } from 'react';
import { TurnstileField } from './TurnstileField';
import { useCaregiverAuth } from './caregiverAuth';
import { Shell } from './LoginPage';
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

const ROLES = ['CNA', 'GNA', 'HHA', 'PCA', 'Caregiver', 'DSP'];

/** /hire-caregivers: an employer describes the opening on its own page, laid out like sign-in. */
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
      if (kind === 'employer') setMessage('The secure link in your email takes you straight to your matches.'+(result.outOfArea?' CareJoys is still growing in your area, so your first matches may be fewer while caregivers near you join.':''));
      setStatus('success');
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : 'Something went wrong');
    }
  }

  if (auth.loading) return <div className="loading-screen">Loading CareJoys…</div>;

  if (status === 'success') return <Shell><div className="login-card">
    <div className="success-mark">✓</div>
    <h1 style={{marginTop:18}}>{kind === 'employer' ? 'Check your email.' : 'Thanks, we have it.'}</h1>
    <p className="login-sub">{kind === 'employer' ? message : 'CareJoys will review your program for the Maryland directory and reply by email.'}</p>
    <div className="empty-actions"><a className="button secondary" href="/">Back to CareJoys</a></div>
  </div></Shell>;

  return <Shell wide><div className="intake-page login-card">
    <div className="modal-kicker">{kind === 'employer' ? 'For employers' : 'For training programs'}</div>
    <h1>{kind === 'employer' ? 'Hire caregivers' : 'Add your training program'}</h1>
    <p className="login-sub">{kind === 'employer'
      ? 'Tell us who you need. CareJoys creates the opening, matches local caregivers, and '+(lockedEmail?'opens your matches.':'emails you a secure link to review them.')
      : 'Can’t find your caregiver training program? Send it to CareJoys and we’ll review it for the Maryland directory.'}</p>
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
        <details className="intake-more">
          <summary>Add shift, pay and requirements (optional)</summary>
          <div className="intake-form">
            <div className="form-grid"><label>Shift<input name="shifts" placeholder="Days, nights, weekends" /></label><label>Transportation<select name="transportationRequired" defaultValue=""><option value="">Not specified</option><option value="yes">Required</option><option value="no">Not required</option></select></label></div>
            <div className="form-grid"><label>Min pay / hr<input type="number" name="payMin" min="0" /></label><label>Max pay / hr<input type="number" name="payMax" min="0" /></label></div>
            <label>Must-have requirements<textarea name="hiringNotes" rows={3} placeholder="Experience, credential, schedule, client requirements..." /></label>
          </div>
        </details>
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
      <button className="button login-continue" disabled={status === 'saving'}>{status === 'saving' ? 'Submitting…' : kind === 'employer' ? 'Find matches' : 'Request addition'}</button>
    </form>
  </div></Shell>;
}
