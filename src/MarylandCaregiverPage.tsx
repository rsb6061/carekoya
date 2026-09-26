import { useEffect, useState, type FormEvent } from 'react';
import { TurnstileField } from './TurnstileField';
import { ProfilePhotoStep } from './ProfilePhotoStep';
import './styles.css';

async function submit(data:Record<string,unknown>){
  const res=await fetch('/api/caregivers',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});
  const body=await res.json() as {ok?:boolean;error?:string;matchedOrganizations?:number;matchedOpenings?:number;marylandMatching?:boolean;existing?:boolean};
  if(!res.ok)throw new Error(body.error||'Could not join CareJoys');
  return body;
}

export function MarylandCaregiverPage(){
  const referralSlug=window.location.pathname.startsWith('/join/')?decodeURIComponent(window.location.pathname.split('/').filter(Boolean)[1]||''):'';
  const [program,setProgram]=useState<{name:string;city?:string;state?:string;zip?:string;providerType?:string}|null>(null);
  const [status,setStatus]=useState<'idle'|'saving'|'success'|'error'>('idle');
  const [message,setMessage]=useState('');
  const [matchResult,setMatchResult]=useState<{id?:string;matchedOrganizations?:number;matchedOpenings?:number;existing?:boolean;profilePhotoToken?:string;profilePhotoUrl?:string|null}|null>(null);
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
    try{const result=await submit(data);setMatchResult(result);setStatus('success')}
    catch(error){setMessage(error instanceof Error?error.message:'Could not join CareJoys');setStatus('error')}
  }

  return <div>
    <header className="nav"><div className="wrap nav-inner"><a className="brand" href="/">CareJoys</a><nav className="navlinks"><a href="/hire-caregivers/maryland">For employers</a></nav></div></header>
    <main className="maryland-caregiver-page">
      <section className="caregiver-campaign-hero"><div className="wrap caregiver-campaign-grid">
        <div>
          <div className="modal-kicker">{program?program.name:'Maryland caregivers'}</div>
          <h1>{program?'Free job matching for your graduates.':'Caregiver jobs in Maryland'}</h1>
          <p>{program?`Create one free CareJoys profile and get matched with Maryland care employers hiring graduates from programs like ${program.name}.`:'Find CNA, GNA, HHA, PCA, private-duty and home-care jobs near you. Create one CareJoys profile and get matched with relevant local employers.'}</p>
          <div className="caregiver-resume-cta"><a className="text-link" href="/caregiver-resume">Already have a resume? Upload it and get matched →</a></div>
          <div className="caregiver-proof">
            <div><strong>Free to join</strong><span>No fees or subscription.</span></div>
            <div><strong>One profile</strong><span>Skip repeating the same application.</span></div>
            <div><strong>You choose</strong><span>Only move forward on jobs you want.</span></div>
          </div>
        </div>

        <div className="campaign-form-card">
          {status==='success'?<div className="modal-success">
            <div className="success-mark">✓</div>
            <h2>{matchResult?.existing?'Your CareJoys profile is updated.':'Your CareJoys profile is live.'}</h2>
            <p>We found <strong>{matchResult?.matchedOrganizations||0} relevant care organizations</strong>{typeof matchResult?.matchedOpenings==='number'?<> and <strong>{matchResult.matchedOpenings} current opening{matchResult.matchedOpenings===1?'':'s'}</strong></>:null} based on your profile.</p>
            {matchResult?.id&&matchResult?.profilePhotoToken&&<ProfilePhotoStep caregiverId={matchResult.id} token={matchResult.profilePhotoToken} existingPhotoUrl={matchResult.profilePhotoUrl}/>}
            <div className="caregiver-next-steps"><strong>Optional: make your profile stronger</strong><p>Add a resume so CareJoys can capture experience, certifications, and caregiver skills automatically.</p><div className="hero-actions"><a className="btn secondary" href="/caregiver-resume">Add resume</a><a className="text-link" href="/">Done</a></div></div>
          </div>:<>
            <div className="modal-kicker">{program?`Referred by ${program.name}`:'Create your caregiver profile'}</div>
            <h2>Tell us what fits.</h2>
            <form className="intake-form" onSubmit={onSubmit}>
              <div className="form-grid"><label>First name<input name="firstName" required /></label><label>Last name<input name="lastName" required /></label></div>
              <div className="form-grid"><label>Email<input type="email" name="email" required /></label><label>Mobile phone<input name="phone" required /></label></div>
              <div className="form-grid"><label>Maryland ZIP code<input name="zip" inputMode="numeric" pattern="[0-9]{5}" required /></label><label>Role<select name="role" required defaultValue=""><option value="" disabled>Select</option><option>CNA</option><option>GNA</option><option>HHA</option><option>PCA</option><option>Caregiver</option><option>Other</option></select></label></div>
              <div className="form-grid"><label>Preferred shifts<input name="shifts" placeholder="Days, nights, weekends" /></label><label>Desired hourly pay<input name="desiredWage" placeholder="$20–24/hr" /></label></div>
              <label>Transportation<select name="transportation" defaultValue=""><option value="">Select</option><option value="own_car">Own car</option><option value="reliable_transportation">Reliable transportation</option><option value="public_transit">Public transit</option><option value="other">Other</option></select></label>
              <label className="check-row"><input type="checkbox" name="smsConsent" /><span>I agree to receive CareJoys texts about job opportunities and availability. Message/data rates may apply. Reply STOP to opt out.</span></label>
              <TurnstileField onToken={setTurnstileToken}/>
              {status==='error'&&<div className="notice">{message}</div>}
              <button className="btn submit-button" disabled={status==='saving'}>{status==='saving'?'Finding jobs…':'Find jobs'}</button>
            </form>
          </>}
        </div>
      </div></section>

      <section className="section"><div className="wrap">
        <h2>One profile. Relevant jobs. Your choice.</h2>
        <p className="meta">New to caregiving? <a className="text-link" href="/resources/how-to-become-a-caregiver-in-maryland">How to become a caregiver in Maryland →</a></p>
        <div className="jobs">
          <div className="job"><div><h3>Create your profile once</h3><div className="meta">Add your role, ZIP, shifts, pay preference, transportation, and availability.</div></div><div className="meta">01</div></div>
          <div className="job"><div><h3>See better-fit opportunities</h3><div className="meta">CareJoys matches your preferences with participating Maryland care employers.</div></div><div className="meta">02</div></div>
          <div className="job"><div><h3>Choose what moves forward</h3><div className="meta">You decide which matches interest you before an interview.</div></div><div className="meta">03</div></div>
        </div>
      </div></section>
    </main>
    <footer className="footer"><div className="wrap">CareJoys · <a href="/privacy-policy">Privacy</a> · <a href="/terms-of-service">Terms</a></div></footer>
  </div>;
}
