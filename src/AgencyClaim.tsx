import { useEffect, useState } from 'react';
import { TurnstileField } from './TurnstileField';
import './activation.css';

type CandidatePreview={role:string;area:string;experience:string;freshness:string;fitScore:number};
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
  const [turnstileToken,setTurnstileToken]=useState('');
  const [status,setStatus]=useState<'loading'|'ready'|'sending'|'sent'|'error'>('loading');
  const [message,setMessage]=useState('');

  useEffect(()=>{
    if(!token){setStatus('error');setMessage('This agency link is missing.');return;}
    api<{agency:AgencyPreview;candidateCount:number;candidates:CandidatePreview[]}>('/api/agency/teaser?token='+encodeURIComponent(token))
      .then(data=>{setAgency(data.agency);setCandidates(data.candidates||[]);setCount(data.candidateCount||0);setStatus('ready')})
      .catch(error=>{setStatus('error');setMessage(error instanceof Error?error.message:'Could not open this agency link.')});
  },[token]);

  async function claim(){
    setStatus('sending');setMessage('');
    try{
      const data=await api<{message:string}>('/api/agency/claim/request',{method:'POST',body:JSON.stringify({token,turnstileToken})});
      setMessage(data.message||'Check your agency email for a secure CareJoys sign-in link.');
      setStatus('sent');
    }catch(error){
      setMessage(error instanceof Error?error.message:'Could not start agency verification.');
      setStatus('ready');
    }
  }

  if(status==='loading')return <div className="activation-shell"><div className="activation-card"><div className="activation-kicker">CareJoys</div><h1>Loading caregiver matches…</h1></div></div>;
  if(status==='error')return <div className="activation-shell"><div className="activation-card"><div className="activation-kicker">CareJoys</div><h1>We couldn’t open this link.</h1><p>{message}</p><a className="btn" href="/">Go to CareJoys</a></div></div>;
  if(!agency)return null;

  return <div className="activation-shell">
    <header className="activation-nav"><a className="brand" href="/">CareJoys</a></header>
    <main className="activation-card">
      <div className="activation-kicker">Caregiver matches for {agency.name}</div>
      <h1>{count} caregiver match{count===1?'':'es'} near your agency.</h1>
      <p className="activation-intro">CareJoys matched these profiles using location, caregiver role, and your Maryland provider record. The previews are intentionally de-identified until your agency is verified.</p>

      <div className="candidate-preview-list">
        {candidates.map((c,i)=><div className="candidate-preview" key={i}>
          <strong>{c.role}</strong>
          <span>{[c.area,c.experience,c.freshness].filter(Boolean).join(' · ')}</span>
        </div>)}
      </div>

      <div className="agency-source-note">
        <strong>{agency.name}</strong>
        <span>{[agency.city,agency.state,agency.providerTypes].filter(Boolean).join(' · ')}</span>
      </div>

      {agency.claimed?<div className="notice">This agency is already linked to a CareJoys employer workspace. Sign in to continue.</div>:
      status==='sent'?<div className="activation-success">
        <div className="success-mark">✓</div>
        <div className="activation-kicker">Verification sent</div>
        <h2>Check your agency email.</h2>
        <p>{message}</p>
      </div>:<>
        <p className="activation-intro">Claim your agency to review the matching caregiver profiles, confirm what you hire for, and contact interested caregivers. Your first 5 interested caregiver candidates are free during the pilot.</p>
        <TurnstileField onToken={setTurnstileToken}/>
        {message&&<div className="notice">{message}</div>}
        <button className="btn activation-submit" onClick={claim} disabled={status==='sending'}>{status==='sending'?'Sending verification…':'Claim agency and review matches'}</button>
      </>}
      {agency.claimed&&<a className="btn" href="/app">Sign in to CareJoys</a>}
    </main>
  </div>;
}
