import { useEffect, useState, type FormEvent } from 'react';
import './activation.css';

type Caregiver = {
  firstName?: string;
  city?: string;
  state?: string;
  zip?: string;
  role?: string;
  shifts?: string;
  desiredWage?: string;
  travelMiles?: number;
  transportation?: string;
  workStatus?: string;
};

async function api<T>(path:string, init?:RequestInit):Promise<T>{
  const res=await fetch(path,{...init,headers:{'content-type':'application/json',...(init?.headers||{})}});
  const body=await res.json() as T & {error?:string};
  if(!res.ok) throw new Error(body.error||'Request failed');
  return body;
}

export function CaregiverActivation(){
  const token=new URLSearchParams(window.location.search).get('token')||'';
  const [caregiver,setCaregiver]=useState<Caregiver|null>(null);
  const [status,setStatus]=useState<'loading'|'ready'|'saving'|'done'|'error'>('loading');
  const [error,setError]=useState('');
  const [workStatus,setWorkStatus]=useState('actively_looking');
  const [completedStatus,setCompletedStatus]=useState('');

  useEffect(()=>{
    if(!token){setError('This activation link is missing.');setStatus('error');return;}
    api<any>('/api/activate?token='+encodeURIComponent(token))
      .then(data=>{
        setCaregiver(data.caregiver||{});
        setWorkStatus(data.caregiver?.workStatus==='not_looking'||data.caregiver?.workStatus==='maybe_later'?data.caregiver.workStatus:'actively_looking');
        setStatus('ready');
      })
      .catch(err=>{setError(err instanceof Error?err.message:'This activation link is invalid.');setStatus('error');});
  },[token]);

  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();
    setStatus('saving');
    setError('');
    try{
      const fd=new FormData(e.currentTarget);
      const data=Object.fromEntries(fd.entries()) as Record<string,unknown>;
      data.token=token;
      data.workStatus=workStatus;
      data.smsConsent=fd.get('smsConsent')==='on';
      const result=await api<any>('/api/activate',{method:'POST',body:JSON.stringify(data)});
      setCompletedStatus(result.status||workStatus);
      setStatus('done');
    }catch(err){
      setError(err instanceof Error?err.message:'Could not update your profile.');
      setStatus('ready');
    }
  }

  if(status==='loading') return <div className="activation-shell"><div className="activation-card"><div className="activation-kicker">CareJoys</div><h1>Loading your profile…</h1></div></div>;
  if(status==='error') return <div className="activation-shell"><div className="activation-card"><div className="activation-kicker">CareJoys</div><h1>We couldn’t open this link.</h1><p>{error}</p><a className="btn" href="/">Go to CareJoys</a></div></div>;
  if(status==='done'){
    const active=completedStatus==='actively_looking';
    return <div className="activation-shell"><div className="activation-card activation-success">
      <div className="success-mark">✓</div>
      <div className="activation-kicker">Profile updated</div>
      <h1>{active?'You’re back in the CareJoys network.':'Your availability is updated.'}</h1>
      <p>{active?'Employers can now find your refreshed profile based on your location, role, and preferences.':'We will not show you as actively looking right now.'}</p>
      <a className="btn" href="/">Done</a>
    </div></div>;
  }

  const first=caregiver?.firstName||'there';
  return <div className="activation-shell">
    <header className="activation-nav"><a className="brand" href="/">CareJoys</a></header>
    <main className="activation-card">
      <div className="activation-kicker">Welcome back, {first}</div>
      <h1>Are you looking for caregiver work right now?</h1>
      <p className="activation-intro">You previously created a caregiver profile on CareKoya. CareJoys is the new caregiver network. We have <strong>not</strong> marked you as actively looking until you confirm here.</p>

      <form className="activation-form" onSubmit={submit}>
        <div className="status-choices">
          <button type="button" className={workStatus==='actively_looking'?'status-choice selected':''} onClick={()=>setWorkStatus('actively_looking')}>
            <strong>Yes, I’m looking</strong><span>Show my refreshed profile to relevant employers.</span>
          </button>
          <button type="button" className={workStatus==='maybe_later'?'status-choice selected':''} onClick={()=>setWorkStatus('maybe_later')}>
            <strong>Maybe later</strong><span>Keep my profile, but don’t show me as available.</span>
          </button>
          <button type="button" className={workStatus==='not_looking'?'status-choice selected':''} onClick={()=>setWorkStatus('not_looking')}>
            <strong>No, not looking</strong><span>Do not show my profile to employers.</span>
          </button>
        </div>

        {workStatus==='actively_looking'&&<div className="activation-details">
          <div className="activation-section-head"><h2>Refresh your preferences</h2><p>This takes about a minute.</p></div>
          <div className="form-grid">
            <label>Role<select name="role" defaultValue={caregiver?.role||'Caregiver'}><option>CNA</option><option>GNA</option><option>HHA</option><option>PCA</option><option>Caregiver</option><option>Other</option></select></label>
            <label>ZIP code<input name="zip" defaultValue={caregiver?.zip||''} inputMode="numeric" /></label>
          </div>
          <div className="form-grid">
            <label>City<input name="city" defaultValue={caregiver?.city||''} /></label>
            <label>State<input name="state" defaultValue={caregiver?.state||''} /></label>
          </div>
          <div className="form-grid">
            <label>Preferred shifts<input name="shifts" defaultValue={caregiver?.shifts||''} placeholder="Days, nights, weekends" /></label>
            <label>Desired hourly pay<input name="desiredWage" defaultValue={caregiver?.desiredWage||''} placeholder="$20–24/hr" /></label>
          </div>
          <div className="form-grid">
            <label>Commute radius<select name="travelMiles" defaultValue={String(caregiver?.travelMiles||'')}><option value="">Select</option><option value="5">5 miles</option><option value="10">10 miles</option><option value="15">15 miles</option><option value="25">25 miles</option><option value="40">40 miles</option><option value="60">60+ miles</option></select></label>
            <label>Transportation<select name="transportation" defaultValue={caregiver?.transportation||''}><option value="">Select</option><option value="own_car">Own car</option><option value="reliable_transportation">Reliable transportation</option><option value="public_transit">Public transit</option><option value="other">Other</option></select></label>
          </div>
          <label className="check-row"><input type="checkbox" name="smsConsent" /><span>Text me about relevant caregiver jobs and to confirm my availability. Message/data rates may apply. Reply STOP to opt out.</span></label>
        </div>}

        {error&&<div className="notice">{error}</div>}
        <button className="btn activation-submit" disabled={status==='saving'}>{status==='saving'?'Saving…':workStatus==='actively_looking'?'Confirm I’m looking':'Save my status'}</button>
        <p className="activation-fineprint">Your old profile stays unavailable to employers until you choose “Yes, I’m looking” and submit this form.</p>
      </form>
    </main>
  </div>;
}