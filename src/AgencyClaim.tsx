import { SiteHeader } from './SiteChrome';
import { useEffect, useState } from 'react';
import { TurnstileField } from './TurnstileField';
import './activation.css';

type InterestPreview={role:string;area:string;jobTitle:string|null;experience:string};
type JobPreview={title:string;area:string};
type AgencyPreview={name:string;city?:string;state?:string;providerTypes?:string;claimed?:boolean;claimRequested?:boolean};

async function api<T>(path:string,init?:RequestInit):Promise<T>{
  const res=await fetch(path,{...init,headers:{'content-type':'application/json',...(init?.headers||{})}});
  const body=await res.json() as T & {error?:string};
  if(!res.ok)throw new Error(body.error||'Request failed');
  return body;
}

const ROLES=['CNA','HHA','PCA','Companion','Live-in'];
const SHIFTS=['Days','Evenings','Nights','Weekends'];
const COUNTS=['1–2','3–5','6+'];
const SOURCES=['Indeed','CareerPlug','Our website','Referrals','Other'];
const toggle=(list:string[],v:string)=>list.includes(v)?list.filter(x=>x!==v):[...list,v];

function Chips({label,options,value,onChange}:{label:string;options:string[];value:string[];onChange:(next:string[])=>void}){
  return <div className="needs-field"><span>{label}</span>
    <div className="needs-chips">{options.map(o=><button type="button" key={o} className={'needs-chip'+(value.includes(o)?' on':'')} aria-pressed={value.includes(o)} onClick={()=>onChange(toggle(value,o))}>{o}</button>)}</div>
  </div>;
}

export function AgencyClaim(){
  const token=new URLSearchParams(window.location.search).get('token')||'';
  const [agency,setAgency]=useState<AgencyPreview|null>(null);
  // What they're hiring for, ticked on the page; saved with the claim.
  const [roles,setRoles]=useState<string[]>([]);
  const [shifts,setShifts]=useState<string[]>([]);
  const [count,setCount]=useState('');
  const [sources,setSources]=useState<string[]>([]);
  const [interests,setInterests]=useState<InterestPreview[]>([]);
  const [jobs,setJobs]=useState<JobPreview[]>([]);
  const [jobCount,setJobCount]=useState(0);
  const [turnstileToken,setTurnstileToken]=useState('');
  const [status,setStatus]=useState<'loading'|'ready'|'sending'|'error'>('loading');
  const [message,setMessage]=useState('');

  useEffect(()=>{
    if(!token){setStatus('error');setMessage('This agency link is missing.');return;}
    api<{agency:AgencyPreview;interests?:InterestPreview[];jobs?:JobPreview[];jobCount?:number}>('/api/agency/teaser?token='+encodeURIComponent(token))
      .then(data=>{setAgency(data.agency);setInterests(data.interests||[]);setJobs(data.jobs||[]);setJobCount(data.jobCount||0);setStatus('ready')})
      .catch(error=>{setStatus('error');setMessage(error instanceof Error?error.message:'Could not open this agency link.')});
  },[token]);

  async function claim(){
    setStatus('sending');setMessage('');
    try{
      const needs={roles,shifts,count,sources};
      const data=await api<{redirect:string}>('/api/agency/claim/request',{method:'POST',body:JSON.stringify({token,turnstileToken,needs})});
      window.location.assign(data.redirect||'/hiring');
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
      <h1>Hire caregivers faster.</h1>
      <p className="activation-intro">Every applicant answered in 30 minutes, screened, and booked into your calendar. Tell us what you’re hiring for and we start this week.</p>
      {!agency.claimed&&<div className="needs-form">
        <Chips label="What are you hiring for?" options={ROLES} value={roles} onChange={setRoles}/>
        <Chips label="Shifts" options={SHIFTS} value={shifts} onChange={setShifts}/>
        <Chips label="How many do you need this month?" options={COUNTS} value={count?[count]:[]} onChange={next=>setCount(next.filter(c=>c!==count)[0]||'')}/>
        <Chips label="Where do applicants come from today?" options={SOURCES} value={sources} onChange={setSources}/>
      </div>}
      {jobCount>0&&<p className="activation-intro">We already list {jobCount===1?'one of your openings':jobCount+' of your openings'} on CareJoys{jobs[0]?' ('+jobs.map(j=>j.title).slice(0,3).join(', ')+(jobCount>3?', …':'')+')':''}, so caregivers nearby can apply there too.</p>}
      </>}

      <div className="agency-source-note">
        <strong>{agency.name}</strong>
        <span>{[agency.city,agency.state,agency.providerTypes].filter(Boolean).join(' · ')}</span>
      </div>

      {agency.claimed?<>
        <div className="notice">This agency is already linked to a CareJoys workspace. Sign in to continue.</div>
        <a className="btn" href="/login?next=/hiring">Sign in to CareJoys</a>
      </>:<>
        <p className="activation-intro">This link was sent to {agency.name}’s email, so one click opens your dashboard. Your first month is free.</p>
        <TurnstileField onToken={setTurnstileToken}/>
        {message&&<div className="notice">{message}</div>}
        <button className="btn activation-submit" onClick={claim} disabled={status==='sending'}>{status==='sending'?'Opening…':interests.length?'Open my inbox':'Start hiring faster'}</button>
      </>}
    </main>
  </div>;
}
