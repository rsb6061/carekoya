import { useEffect, useRef, useState } from 'react';
import { useCaregiverAuth } from './caregiverAuth';
import { homePath, lastDashboard } from './dashboardHome';

/** The header's account control on every page: "Sign in" when signed out, an account menu when signed in. */
export function AccountLink({className,cta=false}:{className?:string;cta?:boolean}){
  const auth=useCaregiverAuth();
  // Homepage: a blue signup button leads, with Sign in as a quieter link beside it.
  if(cta&&!auth.isAuthenticated)return <>
    <a href="/login" style={auth.loading?{visibility:'hidden'}:undefined}>Sign in</a>
    <a className="nav-cta" href="/caregiver-resume">Get started<span className="hide-sm"> free</span></a>
  </>;
  // Keep the space while the session loads so the header doesn't jump.
  if(auth.loading)return <a className={className} href="/login" style={{visibility:'hidden'}} aria-hidden="true" tabIndex={-1}>Sign in</a>;
  if(!auth.isAuthenticated)return <a className={className} href="/login">Sign in</a>;
  return <AccountMenu/>;
}

/** Name button with a drop-down: each dashboard this email has, profile editing, and sign out. */
export function AccountMenu(){
  const auth=useCaregiverAuth();
  const [open,setOpen]=useState(false);
  const ref=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    if(!open)return;
    const close=(e:MouseEvent|KeyboardEvent)=>{
      if(e instanceof KeyboardEvent?e.key==='Escape':!ref.current?.contains(e.target as Node))setOpen(false);
    };
    document.addEventListener('mousedown',close);document.addEventListener('keydown',close);
    return ()=>{document.removeEventListener('mousedown',close);document.removeEventListener('keydown',close)};
  },[open]);
  if(!auth.isAuthenticated)return null;
  const roles=auth.roles||{caregiver:false,employer:false,admin:false,school:false};
  const label=auth.name||auth.email.split('@')[0]||'Account';
  const here=window.location.pathname;
  const item=(href:string,text:string)=><a role="menuitem" href={href} className={here===href?'active':undefined}>{text}</a>;
  return <div className="account-menu" ref={ref}>
    <button type="button" className="account-menu-button" aria-haspopup="menu" aria-expanded={open} onClick={()=>setOpen(v=>!v)}>
      <span className="account-avatar" aria-hidden="true">{label.slice(0,1).toUpperCase()}</span>
      <span className="account-name">{label}</span>
      <span aria-hidden="true" className="account-caret">▾</span>
    </button>
    {open&&<div className="account-menu-panel" role="menu">
      <div className="account-menu-email">{auth.email}</div>
      {roles.caregiver?<>
        {item('/dashboard','My dashboard')}
        {item('/dashboard/profile/preview','View my profile')}
        {item('/dashboard/profile','Edit my profile')}
      </>:!roles.employer&&!roles.school&&!roles.admin&&item(homePath(roles,lastDashboard()),'My dashboard')}
      {roles.employer&&item('/app','Hiring workspace')}
      {roles.school&&item('/school-dashboard','School dashboard')}
      {roles.admin&&item('/admin','Admin')}
      <button type="button" role="menuitem" onClick={auth.logout}>Sign out</button>
    </div>}
  </div>;
}

/** Leave one side of CareJoys: close the hiring workspace, or take the caregiver profile down. Signing up again restores it. */
export function CloseAccountSide({side}:{side:'hiring'|'caregiver'}){
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const text=side==='hiring'
    ?{button:'Close hiring workspace',confirm:'Close your hiring workspace? Your openings stop recruiting and you lose access to /app. Setting up hiring again with this email brings it back.'}
    :{button:'Remove my caregiver profile',confirm:'Remove your caregiver profile? Employers stop seeing you and CareJoys stops sending you jobs. Building a profile again with this email brings it back.'};
  async function close(){
    if(!window.confirm(text.confirm))return;
    setBusy(true);setError('');
    try{
      const res=await fetch('/api/account/close',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({side})});
      const body=await res.json() as {redirect?:string;error?:string};
      if(!res.ok)throw new Error(body.error||'Could not close it.');
      window.location.assign(body.redirect||'/');
    }catch(e){setError(e instanceof Error?e.message:'Could not close it.');setBusy(false)}
  }
  return <div className="close-account-side">
    <button type="button" className="text-button" disabled={busy} onClick={()=>void close()}>{busy?'Closing…':text.button}</button>
    {error&&<div className="notice">{error}</div>}
  </div>;
}
