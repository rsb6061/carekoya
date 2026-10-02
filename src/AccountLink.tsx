import { useEffect, useRef, useState } from 'react';
import { useCaregiverAuth } from './caregiverAuth';
import { homePath, lastDashboard } from './dashboardHome';

/** The header's account control on every page: "Sign in" when signed out, an account menu when signed in. */
export function AccountLink({className}:{className?:string}){
  const auth=useCaregiverAuth();
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
        {item('/me','My dashboard')}
        {item('/me/profile','Edit my profile')}
      </>:!roles.employer&&!roles.school&&!roles.admin&&item(homePath(roles,lastDashboard()),'My dashboard')}
      {roles.employer&&item('/app','Hiring workspace')}
      {roles.school&&item('/school-dashboard','School dashboard')}
      {roles.admin&&item('/admin','Admin')}
      <button type="button" role="menuitem" onClick={auth.logout}>Sign out</button>
    </div>}
  </div>;
}
