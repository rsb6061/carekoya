import { useEffect, useRef, useState } from 'react';

declare global {
  interface Window {
    turnstile?: {
      render: (element: HTMLElement, options: {
        sitekey: string;
        theme?: 'auto'|'light'|'dark';
        size?: 'normal'|'flexible'|'compact';
        callback: (token:string)=>void;
        'expired-callback'?: ()=>void;
        'error-callback'?: ()=>void;
      }) => string;
      reset: (widgetId?:string)=>void;
    };
  }
}

let scriptPromise:Promise<void>|null=null;
function loadTurnstile(){
  if(window.turnstile)return Promise.resolve();
  if(scriptPromise)return scriptPromise;
  scriptPromise=new Promise((resolve,reject)=>{
    const existing=document.querySelector('script[data-carejoys-turnstile]') as HTMLScriptElement|null;
    if(existing){
      existing.addEventListener('load',()=>resolve(),{once:true});
      existing.addEventListener('error',()=>reject(new Error('Turnstile failed to load')),{once:true});
      return;
    }
    const script=document.createElement('script');
    script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async=true;
    script.defer=true;
    script.dataset.carejoysTurnstile='true';
    script.onload=()=>resolve();
    script.onerror=()=>reject(new Error('Turnstile failed to load'));
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export function TurnstileField({onToken}:{onToken:(token:string)=>void}){
  const ref=useRef<HTMLDivElement>(null);
  const [siteKey,setSiteKey]=useState<string|null>(null);
  const [failed,setFailed]=useState(false);

  useEffect(()=>{
    let active=true;
    fetch('/api/config').then(r=>r.json()).then((data:any)=>{
      if(!active)return;
      if(data.turnstileSiteKey)setSiteKey(data.turnstileSiteKey);
      else onToken('');
    }).catch(()=>{if(active)setFailed(true)});
    return()=>{active=false};
  },[]);

  useEffect(()=>{
    if(!siteKey||!ref.current)return;
    let mounted=true;
    loadTurnstile().then(()=>{
      if(!mounted||!ref.current||!window.turnstile)return;
      ref.current.innerHTML='';
      window.turnstile.render(ref.current,{
        sitekey:siteKey,
        theme:'light',
        size:'flexible',
        callback:onToken,
        'expired-callback':()=>onToken(''),
        'error-callback':()=>{onToken('');setFailed(true)}
      });
    }).catch(()=>setFailed(true));
    return()=>{mounted=false};
  },[siteKey]);

  if(failed)return <div className="turnstile-note">Security check could not load. Refresh and try again.</div>;
  if(!siteKey)return null;
  return <div className="turnstile-wrap"><div ref={ref}/></div>;
}
