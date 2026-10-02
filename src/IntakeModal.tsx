import { useState, type FormEvent } from 'react';
import { TurnstileField } from './TurnstileField';

export type FormKind = 'employer' | 'school' | null;

export type EmployerPreset = { role?: string; zip?: string };

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
    outOfArea?: boolean;
    redirect?: string;
  };
  if (!response.ok) throw new Error(body.error || 'Something went wrong');
  return body;
}

export function IntakeModal({
  kind,
  onClose,
  employerPreset,
  lockedEmail
}: {
  kind: Exclude<FormKind, null>;
  onClose: () => void;
  employerPreset?: EmployerPreset;
  /** The signed-in email: the workspace opens right away instead of emailing a link. */
  lockedEmail?: string;
}) {
  const [status, setStatus] = useState<'idle'|'saving'|'success'|'error'>('idle');
  const [message, setMessage] = useState('');
  const [turnstileToken, setTurnstileToken] = useState('');

  const titles = {
    employer: ['Find caregivers', 'Tell us who you need. CareJoys will create the opening, match local caregivers, and email you a secure link to review matches.'],
    school: ['Request program addition', 'Can’t find your caregiver training program? Send it to CareJoys and we’ll review it for the Maryland directory.']
  } as const;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus('saving');
    setMessage('');
    const fd = new FormData(event.currentTarget);
    const data = Object.fromEntries(fd.entries()) as Record<string, unknown>;
    data.turnstileToken = turnstileToken;

    try {
      const result = await submitJson(
        kind === 'employer' ? '/api/employers' : '/api/schools',
        data
      );
      if (result.redirect) { window.location.assign(result.redirect); return; }
      if (kind === 'employer') {
        setMessage('Check your email. The secure link takes you straight to your matches.'+(result.outOfArea?' CareJoys is newest outside Maryland, so your first matches may be fewer while caregivers in your area join.':''));
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
        <h2>{kind === 'employer' ? 'Check your email.' : 'Thanks, we have it.'}</h2>
        <p>{kind === 'employer' ? (message || 'We sent a secure sign-in link to your email.')  : 'We received your information. CareJoys will use it to start the right next step for you.'}</p>
        <button className="btn" onClick={onClose}>Done</button>
      </div> : <>
        <div className="modal-kicker">{kind === 'employer' ? 'For employers' : 'For training programs'}</div>
        <h2>{titles[kind][0]}</h2>
        <p className="modal-intro">{titles[kind][1]}</p>
        <form className="intake-form" onSubmit={handleSubmit}>
          {kind === 'employer' && <>
            <label>Company name<input name="companyName" required /></label>
            <label>Your name<input name="contactName" required /></label>
            <div className="form-grid"><label>Email<input type="email" name="email" required defaultValue={lockedEmail || ''} readOnly={!!lockedEmail} /></label><label>Phone<input name="phone" /></label></div>
            <div className="form-grid"><label>Hiring ZIP<input name="zip" inputMode="numeric" required defaultValue={employerPreset?.zip || ''} /></label><label>Role needed<select name="rolesNeeded" required defaultValue={employerPreset?.role || ''}><option value="" disabled>Select</option><option>CNA</option><option>GNA</option><option>HHA</option><option>PCA</option><option>Caregiver</option><option>DSP</option></select></label></div>
            <div className="form-grid"><label>Shift<input name="shifts" placeholder="Days, nights, weekends" /></label><label>Transportation<select name="transportationRequired" defaultValue=""><option value="">Not specified</option><option value="yes">Required</option><option value="no">Not required</option></select></label></div>
            <div className="form-grid"><label>Min pay / hr<input type="number" name="payMin" min="0" /></label><label>Max pay / hr<input type="number" name="payMax" min="0" /></label></div>
            <label>Must-have requirements<textarea name="hiringNotes" rows={3} placeholder="Experience, credential, schedule, client requirements..." /></label>
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
          <button className="btn submit-button" disabled={status === 'saving'}>{status === 'saving' ? 'Submitting…' : kind === 'employer' ? 'Find matches' : 'Request addition'}</button>
        </form>
      </>}
    </div>
  </div>;
}

