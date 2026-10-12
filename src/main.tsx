import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { CaregiverAuthProvider } from './caregiverAuth';
import { installErrorReporter, reactErrorHandler } from './errorReporter';
import './styles.css';

const path=window.location.pathname;
installErrorReporter();

// A page's own JS/CSS file failed to load: a dropped connection, or an old tab asking for a file a deploy replaced.
// Reload once to get a fresh copy instead of a blank page; if it fails again within a minute, let the crash be reported.
window.addEventListener('vite:preloadError',event=>{
  try{
    const last=Number(sessionStorage.getItem('cj_preload_reload')||0);
    if(Date.now()-last<60000)return;
    sessionStorage.setItem('cj_preload_reload',String(Date.now()));
  }catch{return}
  event.preventDefault();
  window.location.reload();
});

function trackPageView(){
  try{
    const params=new URLSearchParams(window.location.search);
    const body=JSON.stringify({type:'page_view',path:window.location.pathname,referrer:document.referrer,
      utmSource:params.get('utm_source')||'',utmMedium:params.get('utm_medium')||'',utmCampaign:params.get('utm_campaign')||''});
    if(!navigator.sendBeacon?.('/api/events',new Blob([body],{type:'application/json'})))
      void fetch('/api/events',{method:'POST',headers:{'content-type':'application/json'},body,keepalive:true}).catch(()=>{});
  }catch{}
}
if(!path.startsWith('/admin'))trackPageView();

ReactDOM.createRoot(document.getElementById('root')!,{
  onUncaughtError:(error,info)=>{console.error(error);reactErrorHandler(error,info)}
}).render(
  <React.StrictMode><CaregiverAuthProvider><App /></CaregiverAuthProvider></React.StrictMode>
);
