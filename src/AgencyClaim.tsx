import { SiteHeader } from './SiteChrome';
import { useEffect, useState } from 'react';
import { TurnstileField } from './TurnstileField';
import './activation.css';

type CandidatePreview={role:string;area:string;experience:string;freshness:string;fitScore:number};
type InterestPreview={role:string;area:string;jobTitle:string|null;experience:string};
type JobPreview={title:string;area:string};
type AgencyPreview={name:string;city?:string;state?:string;providerTypes?:string;claimed?:boolean;claimRequested?:boolean};

async function api<T>(path:string,init?:RequestInit):Promise<T>{
  const res=await fetch(path,{...init,headers:{'content-type':'application/json',...(init?.headers||{})}});
  const body=await res.json() as T & {error?:string};
  if(!res.ok)throw new Error(body.error||'Request failed');
  return body;
}

export function AgencyClaim(){
  const token=new URLSearchParams(window.location.search).get('token')||'';
  const [agency,setAgency]=useState<AgencyPreview|null>(null);
  const [candidates,setCandidates]=useState<CandidatePreview[]>([]);
  const [count,setCount]=useState(0);
  const [interests,setInterests]=useState<InterestPreview[]>([]);
  const [jobs,setJobs]=useState<JobPreview[]>([]);
  const [jobCount,setJobCount]=useState(0);
  const [turnstileToken,setTurnstileToken]=useState('');
  const [status,setStatus]=useState<'loading'|'ready'|'sending'|'error'>('loading');
  const [message,setMessage]=useState('');

  useEffect(()=>{
    if(!token){setStatus('error');setMessage('This agency link is missing.');return;}
    api<{agency:AgencyPreview;candidateCount:number;candidates:CandidatePreview[];interests?:InterestPreview[];jobs?:JobPreview[];jobCount?:number}>('/api/agency/teaser?token='+encodeURIComponent(token))
      .then(data=>{setAgency(data.agency);setInterests(data.interests||[]);setCandidates(data.candidates||[]);setCount(data.candidateCount||0);setJobs(data.jobs||[]);setJobCount(data.jobCount||0);setStatus('ready')})
      .catch(error=>{setStatus('error');setMessage(error instanceof Error?error.message:'Could not open this agency link.')});
  },[token]);

  async function claim(){
    setStatus('sending');setMessage('');
    try{
      const data=await api<{redirect:string}>('/api/agency/claim/request',{method:'POST',body:JSON.stringify({token,turnstileToken})});
      window.location.assign(data.redirect||'/app');
    }catch(error){
      setMessage(error instanceof Error?error.message:'Could not open your dashboard.');
      setStatus('ready');
    }
  }

  if(status==='loading')return <div className="activation-shell"><SiteHeader/><div className="activation-card"><div className="activation-kicker">CareJoys</div><h1>Loading…</h1></div></div>;
  if(status==='error')return <div className="activation-shell"><SiteHeader/><div className="activation-card"><div className="activation-kicker">CareJoys</div><h1>We couldn’t open this link.</h1><p>{message}</p><a className="btn" href="/">Go to CareJoys</a></div></div>;
  if(!agency)return null;

  return <div className="activation-shell">
    <SiteHeader/>
    <main className="activation-card">
      <div className="activation-kicker">{interests.length?'Caregivers waiting for '+agency.name:agency.name+' on CareJoys'}</div>
      {interests.length?<>
        <h1>{interests.length===1?'A caregiver wants':interests.length+' caregivers want'} to work with you.</h1>
        <p className="activation-intro">{interests.length===1?'This caregiver':'These caregivers'} asked CareJoys to send {interests.length===1?'their profile':'their profiles'} to your agency. Open your inbox to see full profiles and contact details.</p>
        <div className="candidate-preview-list">
          {interests.map((c,i)=><div className="candidate-preview" key={'i'+i}>
            <strong>{c.role}{c.jobTitle?' · '+c.jobTitle:''}</strong>
            <span>{[c.area,c.experience].filter(Boolean).join(' · ')}</span>
          </div>)}
        </div>
      </>:<>
      <h1>{jobCount===1?'Your job is':'Your jobs are'} live on CareJoys.</h1>
      <p className="activation-intro">Caregivers can apply in a minute, and every application lands in one free inbox. Open your dashboard to see who applies and to copy a free widget for your own careers page.</p>
      {jobCount>0&&<>
        <div className="activation-kicker">Your openings on CareJoys{jobCount>jobs.length?' ('+jobCount+')':''}</div>
        <div className="candidate-preview-list">
          {jobs.map((j,i)=><div className="candidate-preview" key={'j'+i}><strong>{j.title}</strong>{j.area&&<span>{j.area}</span>}</div>)}
        </div>
      </>}
      </>}
      {count>0&&<>
        <div className="activation-kicker">Caregivers near you on CareJoys</div>
        <div className="candidate-preview-list">
          {candidates.map((c,i)=><div className="candidate-preview" key={i}>
            <strong>{c.role}</strong>
            <span>{[c.area,c.experience,c.freshness].filter(Boolean).join(' · ')}</span>
          </div>)}
        </div>
      </>}

      <div className="agency-source-note">
        <strong>{agency.name}</strong>
        <span>{[agency.city,agency.state,agency.providerTypes].filter(Boolean).join(' · ')}</span>
      </div>

      {agency.claimed?<>
        <div className="notice">This agency is already linked to a CareJoys workspace. Sign in to continue.</div>
        <a className="btn" href="/login?next=/app">Sign in to CareJoys</a>
      </>:<>
        <p className="activation-intro">This link was sent to your agency email, so one click opens your dashboard. Your first 5 caregiver introductions are free.</p>
        <TurnstileField onToken={setTurnstileToken}/>
        {message&&<div className="notice">{message}</div>}
        <button className="btn activation-submit" onClick={claim} disabled={status==='sending'}>{status==='sending'?'Opening…':interests.length?'Open my inbox':'Open my dashboard'}</button>
      </>}
    </main>
  </div>;
}
