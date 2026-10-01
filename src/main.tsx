import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { MarylandCaregiverPage } from './MarylandCaregiverPage';
import { SchoolProgramPage, SchoolAuth, SchoolDashboard } from './SchoolPortal';
import { CaregiverAuthProvider } from './caregiverAuth';
import './styles.css';

const path=window.location.pathname;
const Root=path.startsWith('/school-auth')?SchoolAuth:path.startsWith('/school-dashboard')?SchoolDashboard:path.startsWith('/school/')?SchoolProgramPage:(path.startsWith('/caregiver-jobs/maryland')||path.startsWith('/join/'))?MarylandCaregiverPage:App;

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

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><CaregiverAuthProvider><Root /></CaregiverAuthProvider></React.StrictMode>
);
