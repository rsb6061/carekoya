import { useEffect, useState, type FormEvent } from 'react';
import './activation.css';

type Slot={id:string;startsAt:string;durationMinutes:number;timezone:string};
type Opportunity={
  company:string;title:string;role:string;city?:string;state?:string;zip?:string;
  payMin?:number;payMax?:number;shift?:string;requirements?:string;
  stage?:string;response?:string;interviewBookedAt?:string;slots:Slot[];
};

async function api<T>(path:string,init?:RequestInit):Promise<T>{
  const res=await fetch(path,{...init,headers:{'content-type':'application/json',...(init?.headers||{})}});
  const body=await res.json() as T & {error?:string};
  if(!res.ok)throw new Error(body.error||'Request failed');
  return body;
}

function fmtSlot(slot:Slot){
  try{
    return new Intl.DateTimeFormat('en-US',{
      weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',
      timeZone:slot.timezone,timeZoneName:'short'
    }).format(new Date(slot.startsAt));
  }catch{
    return new Date(slot.startsAt).toLocaleString();
  }
}

export function CandidateResponse(){
  const token=new URLSearchParams(window.location.search).get('token')||'';
  const [opportunity,setOpportunity]=useState<Opportunity|null>(null);
  const [status,setStatus]=useState<'loading'|'ready'|'saving'|'booked'|'error'>('loading');
  const [message,setMessage]=useState('');
  const [selectedSlot,setSelectedSlot]=useState('');

  async function load(){
    if(!token){setStatus('error');setMessage('This job-response link is missing.');return;}
    try{
      const data=await api<{opportunity:Opportunity}>('/api/respond?token='+encodeURIComponent(token));
      setOpportunity(data.opportunity);
      if(data.opportunity.interviewBookedAt)setStatus('booked');
      else setStatus('ready');
    }catch(error){
      setStatus('error');
      setMessage(error instanceof Error?error.message:'Could not load this opportunity.');
    }
  }
  useEffect(()=>{void load()},[]);

  async function respond(choice:'interested'|'not_interested'){
    setStatus('saving');setMessage('');
    try{
      await api('/api/respond',{method:'POST',body:JSON.stringify({token,choice})});
      if(choice==='not_interested'){
        setOpportunity(o=>o?{...o,response:'not_interested',stage:'rejected'}:o);
        setMessage('Thanks — we marked you as not interested in this job.');
      }else{
        setOpportunity(o=>o?{...o,response:'interested',stage:'interested'}:o);
        setMessage('Great — your interest is confirmed. Choose an interview time below if one is available.');
      }
      setStatus('ready');
    }catch(error){
      setStatus('ready');
      setMessage(error instanceof Error?error.message:'Could not save your response.');
    }
  }

  async function book(e:FormEvent){
    e.preventDefault();
    if(!selectedSlot)return;
    setStatus('saving');setMessage('');
    try{
      const result=await api<{label:string}>('/api/respond/interview',{method:'POST',body:JSON.stringify({token,slotId:selectedSlot})});
      setMessage('Interview confirmed for '+result.label+'. A calendar invite was emailed to you and the employer.');
      setStatus('booked');
      await load();
    }catch(error){
      setStatus('ready');
      setMessage(error instanceof Error?error.message:'Could not book that time.');
      await load();
    }
  }

  if(status==='loading')return <div className="activation-shell"><div className="activation-card"><div className="activation-kicker">CareJoys</div><h1>Loading opportunity…</h1></div></div>;
  if(status==='error')return <div className="activation-shell"><div className="activation-card"><div className="activation-kicker">CareJoys</div><h1>We couldn’t open this job.</h1><p>{message}</p><a className="btn" href="/">Go to CareJoys</a></div></div>;
  if(!opportunity)return null;

  const location=[opportunity.city,opportunity.state,opportunity.zip].filter(Boolean).join(', ');
  const pay=opportunity.payMin||opportunity.payMax?('$'+(opportunity.payMin||'—')+'–$'+(opportunity.payMax||'—')+'/hr'):'Pay discussed with employer';
  const interested=opportunity.response==='interested'||opportunity.stage==='interview';
  const declined=opportunity.response==='not_interested'||opportunity.stage==='rejected';

  return <div className="activation-shell">
    <header className="activation-nav"><a className="brand" href="/">CareJoys</a></header>
    <main className="activation-card">
      <div className="activation-kicker">Job opportunity</div>
      <h1>{opportunity.title}</h1>
      <p className="activation-intro"><strong>{opportunity.company}</strong> · {[opportunity.role,location].filter(Boolean).join(' · ')}</p>

      <div className="opportunity-summary">
        <div><strong>Pay</strong><span>{pay}</span></div>
        <div><strong>Shift</strong><span>{opportunity.shift||'See employer details'}</span></div>
        {opportunity.requirements&&<div><strong>Requirements</strong><span>{opportunity.requirements}</span></div>}
      </div>

      {message&&<div className="notice">{message}</div>}

      {!interested&&!declined&&<div className="response-actions">
        <button className="btn" disabled={status==='saving'} onClick={()=>respond('interested')}>I’m interested</button>
        <button className="btn secondary" disabled={status==='saving'} onClick={()=>respond('not_interested')}>Not interested</button>
      </div>}

      {declined&&<div className="activation-section-head"><h2>Response saved</h2><p>We will not move you forward for this opening.</p></div>}

      {interested&&status!=='booked'&&<>
        <div className="activation-section-head"><h2>Choose an interview time</h2><p>Your interest also refreshes your CareJoys availability.</p></div>
        {opportunity.slots.length===0?<div className="notice">No interview times are available yet. The employer has your interest and can add times or follow up.</div>:
        <form className="activation-form" onSubmit={book}>
          <div className="status-choices">
            {opportunity.slots.map(slot=><button type="button" key={slot.id} className={'status-choice '+(selectedSlot===slot.id?'selected':'')} onClick={()=>setSelectedSlot(slot.id)}>
              <strong>{fmtSlot(slot)}</strong><span>{slot.durationMinutes} minutes</span>
            </button>)}
          </div>
          <button className="btn activation-submit" disabled={!selectedSlot||status==='saving'}>{status==='saving'?'Booking…':'Book interview'}</button>
        </form>}
      </>}

      {status==='booked'&&<div className="activation-success">
        <div className="success-mark">✓</div>
        <div className="activation-kicker">Interview booked</div>
        <h2>You’re on the calendar.</h2>
        <p>CareJoys emailed the calendar invite to you and the employer.</p>
      </div>}
    </main>
  </div>;
}
