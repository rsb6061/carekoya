import { useEffect, useState, type FormEvent } from 'react';
import { TurnstileField } from './TurnstileField';
import { GoogleMark } from './GoogleMark';
import { loginPath, useCaregiverAuth } from './caregiverAuth';

// The first step of Apply for someone who isn't signed in: Google or an emailed link, then back to this job to
// upload a resume and fill in what it didn't cover. Signing in from here always leads to a caregiver profile;
// employers sign up from /hire-caregivers instead.

// finishOn names an employer CareJoys can't send the application to, so the caregiver knows before signing in.
export function ApplySignIn({jobTitle,next,onGuest,finishOn=''}:{jobTitle:string;next:string;onGuest:()=>void;finishOn?:string}){
  const auth=useCaregiverAuth();
  const [email,setEmail]=useState('');
  const [turnstileToken,setTurnstileToken]=useState('');
  const [turnstileRequired,setTurnstileRequired]=useState(false);
  const [status,setStatus]=useState<'idle'|'sending'|'sent'|'error'>('idle');
  const [message,setMessage]=useState('');
  useEffect(()=>{fetch('/api/config').then(r=>r.json()).then((c:any)=>setTurnstileRequired(!!c?.turnstileSiteKey)).catch(()=>{})},[]);
  const checking=turnstileRequired&&!turnstileToken;

  async function submit(e:FormEvent){
    e.preventDefault();
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())){setStatus('error');setMessage('Enter your email address.');return}
    setStatus('sending');setMessage('');
    try{
      const res=await fetch('/api/login/request',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:email.trim(),next,turnstileToken})});
      const body=await res.json() as {code?:boolean;error?:string};
      if(!res.ok)throw new Error(body.error||'Could not send a sign-in link.');
      // CareJoys' own test addresses sign in with a typed code, which only the full sign-in page asks for.
      if(body.code){window.location.href=loginPath(next,email.trim());return}
      setStatus('sent');
    }catch(error){
      setTurnstileToken('');
      setStatus('error');setMessage(error instanceof Error?error.message:'Could not send a sign-in link.');
    }
  }

  if(status==='sent')return <div className="apply-signin">
    <div className="resume-upload-icon">✉</div>
    <h2>Check your email</h2>
    <p className="apply-signin-sub">We sent a sign-in link to <strong>{email.trim()}</strong>. Open it and you’ll come straight back to this job to finish applying.</p>
    <button className="text-button" onClick={()=>setStatus('idle')}>Use a different email</button>
  </div>;

  return <div className="apply-signin">
    <div className="modal-kicker">Apply on CareJoys</div>
    <h2>{jobTitle}</h2>
    <p className="apply-signin-sub">{finishOn
      ?<>Free for caregivers. Sign in and add your resume once; it’s ready for every job. {finishOn} takes applications on their own site, so you’ll finish there.</>
      :'Free for caregivers. Sign in, add your resume, and we’ll fill in the rest.'}</p>
    {auth.googleAvailable&&<>
      <button type="button" className="apply-google" onClick={()=>void auth.loginGoogle({next})}><GoogleMark/>Continue with Google</button>
      <div className="apply-or"><span>or continue with email</span></div>
    </>}
    <form className="apply-signin-form" onSubmit={submit} noValidate>
      <label htmlFor="apply-email">Email address</label>
      <input id="apply-email" type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" aria-invalid={status==='error'&&!email.trim()} />
      <TurnstileField onToken={setTurnstileToken}/>
      {status==='error'&&<div className="notice">{message}</div>}
      <button className="btn apply-continue" disabled={status==='sending'||checking}>{status==='sending'?'Sending…':checking?'One moment…':'Continue'}</button>
    </form>
    <button type="button" className="text-button apply-guest" onClick={onGuest}>Apply without signing in</button>
    <p className="apply-signin-terms">No password needed. CareJoys is for adults: by continuing you confirm you’re 18 or older and agree to the <a href="/terms-of-service">Terms</a> and <a href="/privacy-policy">Privacy Policy</a>.</p>
    <p className="apply-signin-employer">Hiring caregivers? <a href="/hire-caregivers">Set up an employer account</a></p>
  </div>;
}
