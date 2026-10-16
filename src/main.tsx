import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { CaregiverAuthProvider } from './caregiverAuth';
import { automatedBrowser, installErrorReporter, reactErrorHandler } from './errorReporter';
import { keepDrawingWithoutStylesheets } from './lazyPage';
import './styles.css';

const path=window.location.pathname;
installErrorReporter();
keepDrawingWithoutStylesheets();

function trackPageView(){
  try{
    const params=new URLSearchParams(window.location.search);
    const body=JSON.stringify({type:'page_view',path:window.location.pathname,referrer:document.referrer,
      utmSource:params.get('utm_source')||'',utmMedium:params.get('utm_medium')||'',utmCampaign:params.get('utm_campaign')||''});
    if(!navigator.sendBeacon?.('/api/events',new Blob([body],{type:'application/json'})))
      void fetch('/api/events',{method:'POST',headers:{'content-type':'application/json'},body,keepalive:true}).catch(()=>{});
  }catch{}
}
if(!path.startsWith('/admin')&&!automatedBrowser())trackPageView();

ReactDOM.createRoot(document.getElementById('root')!,{
  onUncaughtError:(error,info)=>{console.error(error);reactErrorHandler(error,info)}
}).render(
  <React.StrictMode><CaregiverAuthProvider><App /></CaregiverAuthProvider></React.StrictMode>
);
