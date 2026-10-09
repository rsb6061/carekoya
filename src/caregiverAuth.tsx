import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

// Everyone signs in the same way: an emailed link from /login, or "Continue with Google" (Google Cloud OAuth,
// run by the Worker) when its keys are set. Both land in the same CareJoys account session.
type PublicConfig={googleSignIn?:boolean};
export type AccountRoles={caregiver:boolean;employer:boolean;admin:boolean;school?:boolean};
type Account={signedIn:boolean;email?:string;name?:string;roles?:AccountRoles};

type CaregiverAuthValue={
  googleAvailable:boolean;
  loading:boolean;
  isAuthenticated:boolean;
  email:string;
  name:string;
  roles:AccountRoles|null;
  loginGoogle:(options?:{next?:string})=>Promise<void>;
  loginEmail:(options?:{email?:string;next?:string})=>Promise<void>;
  logout:()=>void;
};

export function loginPath(next?:string,email?:string){
  const params=new URLSearchParams();
  if(next)params.set('next',next);
  if(email)params.set('email',email);
  const query=params.toString();
  return '/login'+(query?'?'+query:'');
}
/** Sends the browser to the shared sign-in page; resolves never, because the page is leaving. */
function goToLogin(options?:{email?:string;next?:string}){
  window.location.href=loginPath(options?.next??window.location.pathname+window.location.search,options?.email);
  return new Promise<void>(()=>{});
}
/** "Continue with Google" through the Worker, landing in the same account an emailed link gives. */
function goToGoogle(options?:{next?:string}){
  window.location.href='/api/auth/google/start?next='+encodeURIComponent(options?.next??window.location.pathname+window.location.search);
  return new Promise<void>(()=>{});
}
async function signOut(){
  await fetch('/api/logout',{method:'POST'}).catch(()=>{});
}

function emailOnlyValue(account:Account|null,google=false):CaregiverAuthValue{
  return {
    googleAvailable:google,loading:account===null,
    isAuthenticated:!!account?.signedIn,email:account?.email||'',name:account?.name||'',roles:account?.roles||null,
    loginGoogle:google?goToGoogle:async()=>{},loginEmail:goToLogin,
    logout:()=>{void signOut().then(()=>window.location.assign('/'))}
  };
}
const CaregiverAuthContext=createContext<CaregiverAuthValue>(emailOnlyValue({signedIn:false}));

export function CaregiverAuthProvider({children}:{children:ReactNode}){
  const [config,setConfig]=useState<PublicConfig|null>(null);
  const [account,setAccount]=useState<Account|null>(null);
  useEffect(()=>{
    fetch('/api/config').then(r=>r.json()).then((data:any)=>setConfig({googleSignIn:data?.googleSignIn===true})).catch(()=>setConfig({}));
    fetch('/api/account').then(r=>r.json()).then((data:any)=>setAccount({
      signedIn:data?.signedIn===true,email:data?.email||'',name:data?.name||'',roles:data?.roles||undefined
    })).catch(()=>setAccount({signedIn:false}));
  },[]);

  const value=emailOnlyValue(config===null?null:account,!!config?.googleSignIn);
  return <CaregiverAuthContext.Provider value={value}>{children}</CaregiverAuthContext.Provider>;
}

export function useCaregiverAuth(){
  return useContext(CaregiverAuthContext);
}
