import { useId, useState, type FormEvent } from 'react';

/**
 * "Email me new CNA jobs near 21030": the one-field alert on job and city pages, so a visitor who isn't ready to apply
 * still leaves a way to bring them back. The first email shows today's jobs and asks them to confirm (jobAlertSignups.ts).
 */
export function JobAlertSignup({role,zip=''}:{role:'CNA'|'Caregiver';zip?:string}){
  const noun=role==='CNA'?'CNA jobs':'caregiver jobs';
  const [email,setEmail]=useState('');
  const [where,setWhere]=useState(zip);
  const [status,setStatus]=useState<'idle'|'sending'|'pending'|'active'>('idle');
  const [error,setError]=useState('');
  // A job panel can open over a list that has its own form, so the ZIP label needs its own id.
  const zipId=useId();

  async function submit(event:FormEvent){
    event.preventDefault();
    setStatus('sending');setError('');
    try{
      const res=await fetch('/api/public/job-alerts',{method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({email,zip:where,role,source:window.location.pathname})});
      const body=await res.json().catch(()=>({})) as {status?:'pending'|'active';error?:string};
      if(!res.ok)throw new Error(body.error||'Could not sign you up.');
      setStatus(body.status==='active'?'active':'pending');
    }catch(err){setError(err instanceof Error?err.message:'Could not sign you up.');setStatus('idle')}
  }

  if(status==='pending'||status==='active')return <div className="job-alert job-alert-done" role="status">
    <strong>{status==='active'?'You’re already set.':'Check your email.'}</strong>
    <span>{status==='active'
      ?` We’ll email ${email} when new ${noun} are posted near ${where}.`
      :` We sent today’s ${noun} near ${where} to ${email}. Tap “Yes, email me new jobs” in it to keep them coming.`}</span>
  </div>;

  return <form className="job-alert" onSubmit={e=>void submit(e)} aria-label="Job alerts">
    <label className="job-alert-head" htmlFor={zipId}>Email me new {noun} near</label>
    <div className="job-alert-row">
      <input id={zipId} className="job-alert-zip" inputMode="numeric" autoComplete="postal-code" placeholder="ZIP" maxLength={5} required
        pattern="\d{5}" aria-label="ZIP code" value={where} onChange={e=>setWhere(e.target.value.replace(/\D/g,'').slice(0,5))}/>
      <input type="email" autoComplete="email" placeholder="Your email" required aria-label="Email address" value={email} onChange={e=>setEmail(e.target.value)}/>
      <button className="btn" type="submit" disabled={status==='sending'}>{status==='sending'?'Sending…':'Email me'}</button>
    </div>
    {error&&<div className="notice">{error}</div>}
    <p className="job-alert-note">Free. At most one email a week, only when there are new jobs. Unsubscribe anytime.</p>
  </form>;
}
