import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Auth0Provider, useAuth0 } from '@auth0/auth0-react';

type PublicConfig={auth0Domain?:string|null;auth0ClientId?:string|null};

type CaregiverAuthValue={
  configured:boolean;
  loading:boolean;
  isAuthenticated:boolean;
  email:string;
  name:string;
  sub:string;
  loginGoogle:()=>Promise<void>;
  loginEmail:()=>Promise<void>;
  logout:()=>void;
  getIdToken:()=>Promise<string>;
};

const fallback:CaregiverAuthValue={
  configured:false,loading:false,isAuthenticated:false,email:'',name:'',sub:'',
  loginGoogle:async()=>{},loginEmail:async()=>{},logout:()=>{},getIdToken:async()=>''
};
const CaregiverAuthContext=createContext<CaregiverAuthValue>(fallback);

function Bridge({children}:{children:ReactNode}){
  const {isLoading,isAuthenticated,user,loginWithPopup,logout,getIdTokenClaims}=useAuth0();
  const value=useMemo<CaregiverAuthValue>(()=>({
    configured:true,
    loading:isLoading,
    isAuthenticated:!!isAuthenticated,
    email:user?.email||'',
    name:user?.name||'',
    sub:user?.sub||'',
    loginGoogle:()=>loginWithPopup({authorizationParams:{connection:'google-oauth2',prompt:'select_account'}}),
    loginEmail:()=>loginWithPopup({authorizationParams:{prompt:'login'}}),
    logout:()=>logout({logoutParams:{returnTo:window.location.origin}}),
    getIdToken:async()=>((await getIdTokenClaims())?.__raw||'')
  }),[isLoading,isAuthenticated,user?.email,user?.name,user?.sub,loginWithPopup,logout,getIdTokenClaims]);
  return <CaregiverAuthContext.Provider value={value}>{children}</CaregiverAuthContext.Provider>;
}

export function CaregiverAuthProvider({children}:{children:ReactNode}){
  const [config,setConfig]=useState<PublicConfig|null>(null);
  useEffect(()=>{
    fetch('/api/config').then(r=>r.json()).then((data:any)=>setConfig({
      auth0Domain:data?.auth0Domain||null,
      auth0ClientId:data?.auth0ClientId||null
    })).catch(()=>setConfig({}));
  },[]);

  if(config?.auth0Domain&&config?.auth0ClientId){
    return <Auth0Provider
      domain={config.auth0Domain}
      clientId={config.auth0ClientId}
      authorizationParams={{redirect_uri:window.location.origin+window.location.pathname}}
      useRefreshTokens={false}
      cacheLocation="memory"
    ><Bridge>{children}</Bridge></Auth0Provider>;
  }

  return <CaregiverAuthContext.Provider value={{...fallback,loading:config===null}}>{children}</CaregiverAuthContext.Provider>;
}

export function useCaregiverAuth(){
  return useContext(CaregiverAuthContext);
}
