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

export function LoginForm({next='',kicker='',title,subtitle='Sign in or create a free account.',google}:{next?:string;kicker?:string;title?:string;subtitle?:string;google?:()=>void}){
  const params=new URLSearchParams(window.location.search);
  const signup=window.location.pathname==='/signup';
  const heading=title||(signup?'Join CareJoys':'Welcome to CareJoys');
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

  return <div className="login-card">
    {kicker&&<div className="modal-kicker">{kicker}</div>}
    {status==='sent'?<>
      <h1>Check your email</h1>
      <p className="login-sub">We sent a secure sign-in link to <strong>{email}</strong>. It works once and expires in an hour. You can close this tab.</p>
      <button className="text-button login-again" onClick={()=>setStatus('idle')}>Use a different email</button>
    </>:<>
      <h1>{heading}</h1>
      <p className="login-sub">{subtitle}</p>
      {status==='idle'&&message&&<div className="notice">{message}</div>}
      {google&&<><button type="button" className="google-button" onClick={google}><GoogleMark/>Continue with Google</button><div className="login-or"><span>or</span></div></>}
      <form className="auth-form" onSubmit={submit}>
        <label className="auth-label" htmlFor="login-email">Email</label>
        <input id="login-email" type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" required />
        <TurnstileField onToken={setTurnstileToken}/>
        {status==='error'&&<div className="notice">{message}</div>}
        <button className="button login-continue" disabled={status==='sending'}>{status==='sending'?'Sending…':'Continue'}</button>
      </form>
      <p className="login-terms">We’ll email you a secure sign-in link, no password needed. By continuing you agree to the <a href="/terms-of-service">Terms</a> and <a href="/privacy-policy">Privacy Policy</a>.</p>
    </>}
  </div>;
}

/** Google's own multicolor "G", as its sign-in branding asks for. */
function GoogleMark(){
  return <svg className="google-mark" viewBox="0 0 48 48" width="18" height="18" aria-hidden="true">
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
  </svg>;
}

/** Sign-in pages: a quiet header and footer around one centered column. */
export function Shell({children,wide=false}:{children:ReactNode;wide?:boolean}){
  return <div className="auth-page">
    <header className="nav"><div className="wrap nav-inner">
      <a className="brand" href="/">CareJoys</a>
      <nav className="navlinks"><a href="mailto:hello@carejoys.com">Need help?</a></nav>
    </div></header>
    <main className={'app-shell-col'+(wide?' wide':'')}>{children}</main>
    <footer className="footer"><div className="wrap footer-inner">
      <span>© {new Date().getFullYear()} CareJoys. All rights reserved.</span>
      <nav className="footer-links"><a href="/terms-of-service">Terms</a><a href="/privacy-policy">Privacy</a></nav>
    </div></footer>
  </div>;
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
  return <Shell><div className="login-card">
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

  return <Shell wide>
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
