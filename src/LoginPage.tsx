import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { TurnstileField } from './TurnstileField';
import { IntakeModal } from './IntakeModal';
import { loginPath, useCaregiverAuth } from './caregiverAuth';
import './workspace.css';

// The one sign-in and sign-up for caregivers, agencies and employers: enter an email, click the link.

async function post<T>(path:string,data:Record<string,unknown>):Promise<T>{
  const res=await fetch(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});
  const body=await res.json() as T&{error?:string};
  if(!res.ok)throw new Error(body.error||'Request failed');
  return body;
}

/** Email-link sign-in form. `next` is where to land afterwards (when this account can use it). */
const GOOGLE_ERRORS:Record<string,string>={
  google_cancelled:'Google sign-in was cancelled. Try again, or use your email.',
  google_failed:'Google couldn’t confirm that account. Try again, or use your email.',
  google_unavailable:'Google sign-in isn’t available right now. Use your email instead.'
};

export function LoginForm({next='',kicker='Sign in or sign up',title='Welcome to CareJoys.',google}:{next?:string;kicker?:string;title?:string;google?:()=>void}){
  const params=new URLSearchParams(window.location.search);
  const [email,setEmail]=useState(params.get('email')||'');
  const [turnstileToken,setTurnstileToken]=useState('');
  const [status,setStatus]=useState<'idle'|'sending'|'sent'|'error'>('idle');
  const [message,setMessage]=useState(GOOGLE_ERRORS[params.get('error')||'']||'');

  async function submit(e:FormEvent){
    e.preventDefault();setStatus('sending');setMessage('');
    try{
      await post('/api/login/request',{email,next:next||params.get('next')||'',turnstileToken});
      setStatus('sent');
    }catch(error){
      setStatus('error');setMessage(error instanceof Error?error.message:'Could not send a sign-in link.');
    }
  }

  return <div className="beta-hero app-empty-card">
    <div className="modal-kicker">{kicker}</div>
    {status==='sent'?<>
      <h1>Check your email.</h1>
      <p>We sent a secure sign-in link to <strong>{email}</strong>. It works once and expires in an hour. You can close this tab.</p>
      <button className="text-button" onClick={()=>setStatus('idle')}>Use a different email</button>
    </>:<>
      <h1>{title}</h1>
      <p>One account for caregivers, agencies and employers. No password needed, and new emails get an account automatically.</p>
      {status==='idle'&&message&&<div className="notice">{message}</div>}
      {google&&<><button type="button" className="button google-button" onClick={google}>Continue with Google</button><div className="login-or">or get a link by email</div></>}
      <form className="auth-form" onSubmit={submit}>
        <input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" required />
        <TurnstileField onToken={setTurnstileToken}/>
        {status==='error'&&<div className="notice">{message}</div>}
        <button className="button" disabled={status==='sending'}>{status==='sending'?'Sending…':'Email me a sign-in link'}</button>
      </form>
    </>}
  </div>;
}

function Shell({children}:{children:ReactNode}){
  return <div className="app-empty"><div className="app-wrap">
    <a href="/" className="text-link">← Back to CareJoys</a>
    {children}
  </div></div>;
}

export function LoginPage(){
  const auth=useCaregiverAuth();
  const next=new URLSearchParams(window.location.search).get('next')||'';
  // Already signed in: go straight on to where they were headed, or their dashboards.
  useEffect(()=>{
    if(!auth.loading&&auth.isAuthenticated)window.location.replace(next&&next.startsWith('/')&&!next.startsWith('//')?next:'/welcome');
  },[auth.loading,auth.isAuthenticated]);
  if(auth.loading)return <div className="loading-screen">Loading CareJoys…</div>;
  return <Shell>
    <LoginForm next={next} google={auth.googleAvailable?()=>void auth.loginGoogle({next}):undefined}/>
  </Shell>;
}

/** Where the emailed link lands: proves the email, then opens the right dashboard. */
export function SignInLinkPage(){
  const token=new URLSearchParams(window.location.search).get('token')||'';
  const [error,setError]=useState('');
  useEffect(()=>{
    if(!token){setError('This sign-in link is missing.');return;}
    post<{redirect?:string}>('/api/login/verify',{token})
      .then(body=>window.location.replace(body.redirect||'/welcome'))
      .catch(e=>setError(e instanceof Error?e.message:'This sign-in link is invalid.'));
  },[token]);
  return <Shell><div className="beta-hero app-empty-card">
    <div className="modal-kicker">CareJoys</div>
    {error?<><h1>This link can’t be used.</h1><p>{error}</p><div className="empty-actions"><a className="button" href="/login">Send a new link</a></div></>
      :<><h1>Signing you in…</h1><p>Verifying your secure CareJoys link.</p></>}
  </div></Shell>;
}

/** The account home: links to each dashboard this email has, and a way to start the other side. */
export function WelcomePage(){
  const auth=useCaregiverAuth();
  const [hiring,setHiring]=useState(false);
  useEffect(()=>{
    if(!auth.loading&&!auth.isAuthenticated)window.location.replace(loginPath('/welcome'));
  },[auth.loading,auth.isAuthenticated]);
  if(auth.loading||!auth.isAuthenticated)return <div className="loading-screen">Loading CareJoys…</div>;
  const roles=auth.roles||{caregiver:false,employer:false,admin:false};
  const fresh=!roles.caregiver&&!roles.employer;

  return <Shell>
    <div className="beta-hero app-empty-card">
      <div className="modal-kicker">Signed in as {auth.email}</div>
      <h1>{fresh?'What brings you to CareJoys?':'Where to?'}</h1>
      {fresh&&<p>Pick one to set up your account. You can add the other later with the same sign-in.</p>}
      <div className="welcome-choices">
        <div className="welcome-choice">
          <strong>I’m a caregiver</strong>
          <span>{roles.caregiver?'See invitations, book interviews and keep your availability current.':'Upload your resume once and get matched with local care jobs.'}</span>
          <a className="button" href={roles.caregiver?'/me':'/caregiver-resume'}>{roles.caregiver?'Open my caregiver dashboard':'Build my caregiver profile'}</a>
        </div>
        <div className="welcome-choice">
          <strong>I’m hiring caregivers</strong>
          <span>{roles.employer?'Your openings, matched caregivers, agency inbox and interviews.':'For home-care agencies and employers. Describe the role and see matched local caregivers.'}</span>
          {roles.employer?<a className="button" href="/app">Open my hiring workspace</a>:<button className="button" onClick={()=>setHiring(true)}>Set up hiring</button>}
        </div>
        {roles.admin&&<div className="welcome-choice"><strong>CareJoys admin</strong><span>Funnel, employers and outreach.</span><a className="button secondary" href="/admin">Open admin</a></div>}
      </div>
      <div className="empty-actions"><button className="text-button" onClick={auth.logout}>Sign out</button></div>
    </div>
    {hiring&&<IntakeModal kind="employer" lockedEmail={auth.email} onClose={()=>setHiring(false)}/>}
  </Shell>;
}
