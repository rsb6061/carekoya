import { useState, type FormEvent } from 'react';
import { workerVisitorId } from './workerFunnelClient';

type PreviewJob={id:string;title:string;employerName?:string;city?:string;state?:string;payMin?:number|null;payMax?:number|null;distanceMiles?:number|null};
type Preview={jobs:PreviewJob[];total:number};
const ROLES=['Caregiver','CNA','GNA','HHA','PCA','DSP'];
export function HomeJobPreview(){
  const [zip,setZip]=useState('');
  const [role,setRole]=useState('Caregiver');
  const [minimumPay,setMinimumPay]=useState('');
  const [shifts,setShifts]=useState('');
  const [status,setStatus]=useState<'idle'|'loading'|'ready'|'error'>('idle');
  const [message,setMessage]=useState('');
  const [result,setResult]=useState<Preview|null>(null);
  async function preview(e:FormEvent){
    e.preventDefault();
    if(!/^\d{5}$/.test(zip)){setMessage('Enter a five-digit ZIP code.');setStatus('error');return}
    setStatus('loading');setMessage('');
    const p=new URLSearchParams({zip,role});
    if(minimumPay)p.set('payMin',minimumPay);
    if(shifts)p.set('shifts',shifts);
    try{
      const response=await fetch('/api/public/job-preview?'+p.toString(),{headers:{'X-CareJoys-Funnel-Id':workerVisitorId()}});
      const body=await response.json() as Preview&{error?:string};
      if(!response.ok)throw new Error(body.error||'Could not load jobs right now');
      setResult(body);setStatus('ready');
    }catch(error){setMessage(error instanceof Error?error.message:'Could not load jobs right now');setStatus('error')}
  }
  const p=new URLSearchParams({zip,role});
  if(minimumPay)p.set('payMin',minimumPay);
  if(shifts)p.set('shifts',shifts);
  return <div className="home-job-preview">
    <form className="search" onSubmit={preview}>
      <label className="sr-only" htmlFor="preview-role">Your role</label>
      <select id="preview-role" value={role} onChange={e=>setRole(e.target.value)}>{ROLES.map(r=><option key={r} value={r}>{r}</option>)}</select>
      <label className="sr-only" htmlFor="preview-zip">Your ZIP code</label>
      <input id="preview-zip" value={zip} onChange={e=>setZip(e.target.value)} placeholder="Your ZIP code" inputMode="numeric" pattern="[0-9]{5}" maxLength={5} required />
      <button className="btn" type="submit" disabled={status==='loading'}>{status==='loading'?'Finding jobs…':'Preview my jobs'}</button>
    </form>
    <div className="home-preview-options">
      <label>Minimum hourly pay <input type="number" min="0" max="100" step="1" value={minimumPay} onChange={e=>setMinimumPay(e.target.value)} placeholder="Any" /></label>
      <label>Preferred shift <select value={shifts} onChange={e=>setShifts(e.target.value)}><option value="">Any shift</option><option value="days">Days</option><option value="evenings">Evenings</option><option value="nights">Nights</option><option value="weekends">Weekends</option></select></label>
    </div>
    {status==='error'&&<p role="alert" className="notice">{message}</p>}
    {status==='ready'&&result&&<div className="home-preview-results" aria-live="polite">
      <h2>{result.jobs.length?'A few matches near you':'No suitable local jobs found yet'}</h2>
      <p>{result.jobs.length?'Preview real openings without uploading a resume or sharing your contact information.':'Try a nearby ZIP, different shift or lower pay minimum.'}</p>
      <div className="home-preview-list">{result.jobs.map(j=><a className="home-preview-job" key={j.id} href={'/jobs/'+encodeURIComponent(j.id)}>
        <strong>{j.title}</strong>
        <span>{[j.employerName,[j.city,j.state].filter(Boolean).join(', '),j.distanceMiles!=null?Math.round(j.distanceMiles)+' miles':'',j.payMax?'Up to $'+j.payMax+'/hr':''].filter(Boolean).join(' · ')}</span>
      </a>)}</div>
      <a className="btn" href={'/caregiver-resume?'+p.toString()}>Create my free profile for personalized matches</a>
    </div>}
    {status!=='ready'&&<p className="home-preview-privacy">No resume or contact details needed to preview jobs. Free for caregivers.</p>}
  </div>;
}
