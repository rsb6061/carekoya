import { useEffect, useState, type FormEvent } from 'react';
import { TurnstileField } from './TurnstileField';
import './styles.css';

async function submit(data:Record<string,unknown>){
  const res=await fetch('/api/caregivers',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});
  const body=await res.json() as {ok?:boolean;error?:string};
  if(!res.ok)throw new Error(body.error||'Could not join CareJoys');
  return body;
}

export function MarylandCaregiverPage(){
  const referralSlug=window.location.pathname.startsWith('/join/')?decodeURIComponent(window.location.pathname.split('/').filter(Boolean)[1]||''):'';
  const [program,setProgram]=useState<{name:string;city?:string;state?:string;zip?:string;providerType?:string}|null>(null);
  const [status,setStatus]=useState<'idle'|'saving'|'success'|'error'>('idle');
  const [message,setMessage]=useState('');
  const [turnstileToken,setTurnstileToken]=useState('');

  useEffect(()=>{
    document.title='Caregiver Jobs in Maryland | CareJoys';
    if(referralSlug){
      fetch('/api/public/training-program/'+encodeURIComponent(referralSlug)).then(r=>r.json()).then((data:any)=>{
        if(data?.program){setProgram(data.program);document.title='CareJoys for '+data.program.name;}
      }).catch(()=>{});
    }
    const existing=document.querySelector('meta[name="description"]');
    if(existing)existing.setAttribute('content','Join CareJoys free and get matched with Maryland care employers looking for CNAs, GNAs, HHAs, PCAs, and caregivers.');
  },[]);

  async function onSubmit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();setStatus('saving');setMessage('');
    const fd=new FormData(e.currentTarget);
    const data=Object.fromEntries(fd.entries()) as Record<string,unknown>;
    data.smsConsent=fd.get('smsConsent')==='on';
    data.turnstileToken=turnstileToken;
    if(referralSlug)data.referralSlug=referralSlug;
    try{await submit(data);setStatus('success')}
    catch(error){setMessage(error instanceof Error?error.message:'Could not join CareJoys');setStatus('error')}
  }

  return <div>
    <header className="nav"><div className="wrap nav-inner"><a className="brand" href="/">CareJoys</a><nav className="navlinks"><a href="/caregiver-recruiting/maryland">For employers</a></nav></div></header>
    <main className="maryland-caregiver-page">
      <section className="caregiver-campaign-hero"><div className="wrap caregiver-campaign-grid">
        <div>
          <div className="modal-kicker">{program?program.name:'Maryland caregivers'}</div>
          <h1>{program?'Free job-matching network for your graduates.':'Caregiver jobs in Maryland, matched to you.'}</h1>
          <p>{program?`CareJoys partners with training programs like ${program.name} to help graduates get discovered by relevant Maryland care employers. Create one profile and choose which opportunities interest you.`:'Join CareJoys free as a CNA, GNA, HHA, PCA, or caregiver. Tell us where you can work, the shifts you want, and your pay preference. CareJoys uses that profile to connect you with relevant care employers.'}</p>
          <div className="caregiver-proof">
            <div><strong>Free for caregivers</strong><span>No application fees or subscription.</span></div>
            <div><strong>Your availability stays current</strong><span>Confirm when you are looking; mark not looking any time.</span></div>
            <div><strong>Fewer blind applications</strong><span>CareJoys is built to confirm employer and caregiver interest before interviews.</span></div>
          </div>
        </div>

        <div className="campaign-form-card">
          {status==='success'?<div className="modal-success">
            <div className="success-mark">✓</div>
            <h2>You’re in the CareJoys network.</h2>
            <p>We’ll use your profile to identify relevant Maryland care employers. When there is a match, CareJoys can ask whether you are interested before moving you forward.</p>
            <a className="btn" href="/">Done</a>
          </div>:<>
            <div className="modal-kicker">{program?`Referred by ${program.name}`:'Create your caregiver profile'}</div>
            <h2>Tell us what you’re looking for.</h2>
            <form className="intake-form" onSubmit={onSubmit}>
              <div className="form-grid"><label>First name<input name="firstName" required /></label><label>Last name<input name="lastName" required /></label></div>
              <div className="form-grid"><label>Email<input type="email" name="email" required /></label><label>Mobile phone<input name="phone" required /></label></div>
              <div className="form-grid"><label>Maryland ZIP code<input name="zip" inputMode="numeric" pattern="[0-9]{5}" required /></label><label>Role<select name="role" required defaultValue=""><option value="" disabled>Select</option><option>CNA</option><option>GNA</option><option>HHA</option><option>PCA</option><option>Caregiver</option><option>Other</option></select></label></div>
              <div className="form-grid"><label>Preferred shifts<input name="shifts" placeholder="Days, nights, weekends" /></label><label>Desired hourly pay<input name="desiredWage" placeholder="$20–24/hr" /></label></div>
              <label>Transportation<select name="transportation" defaultValue=""><option value="">Select</option><option value="own_car">Own car</option><option value="reliable_transportation">Reliable transportation</option><option value="public_transit">Public transit</option><option value="other">Other</option></select></label>
              <div className="legal-consent">By joining CareJoys, you understand that your caregiver work profile may be shown to participating care employers for recruiting. Current availability is shown separately. See our <a href="/privacy-policy" target="_blank">Privacy Policy</a> and <a href="/terms-of-service" target="_blank">Terms</a>.</div>
              <label className="check-row"><input type="checkbox" name="smsConsent" /><span>I agree to receive CareJoys texts about job opportunities and availability. Message/data rates may apply. Reply STOP to opt out.</span></label>
              <TurnstileField onToken={setTurnstileToken}/>
              {status==='error'&&<div className="notice">{message}</div>}
              <button className="btn submit-button" disabled={status==='saving'}>{status==='saving'?'Joining…':'Join CareJoys free'}</button>
            </form>
          </>}
        </div>
      </div></section>

      <section className="section"><div className="wrap">
        <h2>Built for ongoing caregiver work, not one application.</h2>
        <div className="jobs">
          <div className="job"><div><h3>Create one work profile</h3><div className="meta">Role, ZIP, shifts, pay preference, transportation, and current availability.</div></div><div className="meta">01</div></div>
          <div className="job"><div><h3>Get routed to relevant employers</h3><div className="meta">CareJoys uses your work preferences and geography to identify participating care employers that may fit.</div></div><div className="meta">02</div></div>
          <div className="job"><div><h3>Choose what interests you</h3><div className="meta">A match is not an application. You decide whether you want to move forward before an interview is booked.</div></div><div className="meta">03</div></div>
        </div>
      </div></section>
    </main>
    <footer className="footer"><div className="wrap">CareJoys · <a href="/privacy-policy">Privacy</a> · <a href="/terms-of-service">Terms</a></div></footer>
  </div>;
}
