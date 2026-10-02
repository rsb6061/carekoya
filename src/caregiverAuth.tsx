import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Auth0Provider, useAuth0 } from '@auth0/auth0-react';

// Everyone signs in the same way: an emailed link from /login. Auth0 (Google) is an optional extra for
// caregivers and only appears when its keys are set on the Worker.
type PublicConfig={auth0Domain?:string|null;auth0ClientId?:string|null;googleSignIn?:boolean};
export type AccountRoles={caregiver:boolean;employer:boolean;admin:boolean};
type Account={signedIn:boolean;email?:string;roles?:AccountRoles};

type CaregiverAuthValue={
  configured:boolean;
  googleAvailable:boolean;
  loading:boolean;
  isAuthenticated:boolean;
  email:string;
  name:string;
  sub:string;
  roles:AccountRoles|null;
  loginGoogle:(options?:{next?:string})=>Promise<void>;
  loginEmail:(options?:{email?:string;next?:string})=>Promise<void>;
  logout:()=>void;
  getIdToken:()=>Promise<string>;
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
    configured:true,googleAvailable:google,loading:account===null,
    isAuthenticated:!!account?.signedIn,email:account?.email||'',name:'',sub:'',roles:account?.roles||null,
    loginGoogle:google?goToGoogle:async()=>{},loginEmail:goToLogin,
    logout:()=>{void signOut().then(()=>window.location.assign('/'))},
    getIdToken:async()=>''
  };
}
const CaregiverAuthContext=createContext<CaregiverAuthValue>(emailOnlyValue({signedIn:false}));

function Bridge({account,children}:{account:Account|null;children:ReactNode}){
  const {isLoading,isAuthenticated,user,loginWithPopup,loginWithRedirect,logout,getIdTokenClaims}=useAuth0();
  // Mobile browsers often block popups; fall back to a full-page redirect that comes back to this page.
  const login=async(authorizationParams:Record<string,string>)=>{
    try{await loginWithPopup({authorizationParams})}
    catch(error){
      if((error as {error?:string})?.error!=='popup_open')throw error;
      await loginWithRedirect({authorizationParams,appState:{returnTo:window.location.pathname+window.location.search}});
    }
  };
  const value=useMemo<CaregiverAuthValue>(()=>{
    const viaGoogle=!!isAuthenticated;
    return {
      configured:true,
      googleAvailable:true,
      loading:isLoading||account===null,
      isAuthenticated:viaGoogle||!!account?.signedIn,
      email:viaGoogle?user?.email||'':account?.email||'',
      name:viaGoogle?user?.name||'':'',
      sub:viaGoogle?user?.sub||'':'',
      roles:account?.roles||null,
      loginGoogle:()=>login({connection:'google-oauth2',prompt:'select_account'}),
      loginEmail:goToLogin,
      logout:()=>{void signOut().then(()=>viaGoogle?logout({logoutParams:{returnTo:window.location.origin}}):window.location.assign('/'))},
      getIdToken:async()=>viaGoogle?((await getIdTokenClaims())?.__raw||''):''
    };
  },[isLoading,isAuthenticated,user?.email,user?.name,user?.sub,account,loginWithPopup,loginWithRedirect,logout,getIdTokenClaims]);
  return <CaregiverAuthContext.Provider value={value}>{children}</CaregiverAuthContext.Provider>;
}

export function CaregiverAuthProvider({children}:{children:ReactNode}){
  const [config,setConfig]=useState<PublicConfig|null>(null);
  const [account,setAccount]=useState<Account|null>(null);
  useEffect(()=>{
    fetch('/api/config').then(r=>r.json()).then((data:any)=>setConfig({
      auth0Domain:data?.auth0Domain||null,
      auth0ClientId:data?.auth0ClientId||null,
      googleSignIn:data?.googleSignIn===true
    })).catch(()=>setConfig({}));
    fetch('/api/account').then(r=>r.json()).then((data:any)=>setAccount({
      signedIn:data?.signedIn===true,email:data?.email||'',roles:data?.roles||undefined
    })).catch(()=>setAccount({signedIn:false}));
  },[]);

  // Direct Google sign-in replaces Auth0 when its keys are set.
  if(config?.auth0Domain&&config?.auth0ClientId&&!config.googleSignIn){
    return <Auth0Provider
      domain={config.auth0Domain}
      clientId={config.auth0ClientId}
      authorizationParams={{redirect_uri:window.location.origin}}
      // Caregivers stay signed in across visits; refresh tokens fall back to silent auth if the tenant has them off.
      useRefreshTokens
      useRefreshTokensFallback
      cacheLocation="localstorage"
      onRedirectCallback={(appState)=>{
        const returnTo=typeof appState?.returnTo==='string'&&appState.returnTo.startsWith('/')&&!appState.returnTo.startsWith('//')?appState.returnTo:'/';
        if(returnTo!==window.location.pathname)window.location.replace(returnTo);
        else window.history.replaceState(null,'',returnTo);
      }}
    ><Bridge account={account}>{children}</Bridge></Auth0Provider>;
  }

  const value=emailOnlyValue(config===null?null:account,!!config?.googleSignIn);
  return <CaregiverAuthContext.Provider value={value}>{children}</CaregiverAuthContext.Provider>;
}

export function useCaregiverAuth(){
  return useContext(CaregiverAuthContext);
}
