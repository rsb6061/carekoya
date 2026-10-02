import { SiteHeader } from './SiteChrome';
import { useEffect, useState } from 'react';
import './activation.css';

type Preview={label:string;detail:string};
type Confirmation={
  status:'ready'|'sent';firstName:string;email:string;viaAssistant:boolean;note:string|null;targets:Preview[];
  profile:{role:string;zip:string;certifications:string;phone:string}|null;
};

async function api<T>(path:string,init?:RequestInit):Promise<T>{
  const res=await fetch(path,{...init,headers:{'content-type':'application/json',...(init?.headers||{})}});
  const body=await res.json() as T & {error?:string};
  if(!res.ok)throw new Error(body.error||'Request failed');
  return body;
}

// The caregiver's last step: nothing reaches an agency until Send is pressed here.
export function ConfirmInterest(){
  const token=new URLSearchParams(window.location.search).get('token')||'';
  const [data,setData]=useState<Confirmation|null>(null);
  const [status,setStatus]=useState<'loading'|'ready'|'sending'|'sent'|'error'>('loading');
  const [message,setMessage]=useState('');

  useEffect(()=>{
    if(!token){setStatus('error');setMessage('This link is missing its code.');return;}
    api<Confirmation>('/api/interest-confirm?token='+encodeURIComponent(token))
      .then(d=>{setData(d);setStatus(d.status==='sent'?'sent':'ready')})
      .catch(error=>{setStatus('error');setMessage(error instanceof Error?error.message:'Could not open this link.')});
  },[token]);

  async function send(){
    setStatus('sending');setMessage('');
    try{
      await api('/api/interest-confirm',{method:'POST',body:JSON.stringify({token})});
      setStatus('sent');
    }catch(error){
      setStatus('ready');setMessage(error instanceof Error?error.message:'Could not send your profile.');
    }
  }

  if(status==='loading')return <div className="activation-shell"><SiteHeader/><div className="activation-card"><div className="activation-kicker">CareJoys</div><h1>Loading…</h1></div></div>;
  if(status==='error'||!data)return <div className="activation-shell"><SiteHeader/><div className="activation-card"><div className="activation-kicker">CareJoys</div><h1>We couldn’t open this link.</h1><p>{message}</p><a className="btn" href="/caregiver-jobs/maryland">See caregiver jobs</a></div></div>;
  const one=data.targets.length===1;

  return <div className="activation-shell">
    <SiteHeader/>
    <main className="activation-card">
      {status==='sent'?<div className="activation-success">
        <div className="success-mark">✓</div>
        <div className="activation-kicker">Profile sent</div>
        <h2>{one?data.targets[0].label+' has':'The agencies have'} your profile.</h2>
        <p>They’ll contact you at {data.email}{data.profile?.phone?' or by phone':''}. You can also apply on {one?'their':'each agency’s'} own site.</p>
        <a className="btn" href="/caregiver-jobs/maryland">See more caregiver jobs</a>
      </div>:<>
        <div className="activation-kicker">{data.viaAssistant?'Requested through your AI assistant':'Your CareJoys profile'}</div>
        <h1>Send your profile to {one?data.targets[0].label:data.targets.length+' agencies'}?</h1>
        <p className="activation-intro">Hi {data.firstName||'there'}. {one?'This agency':'Each agency'} will see your name, contact details, role and work preferences, and can reach out to you directly.</p>
        <div className="candidate-preview-list">
          {data.targets.map((t,i)=><div className="candidate-preview" key={i}><strong>{t.label}</strong><span>{t.detail}</span></div>)}
        </div>
        {data.profile&&<div className="agency-source-note"><strong>Your profile</strong><span>{[data.profile.role,data.profile.certifications,'ZIP '+data.profile.zip,data.email].filter(Boolean).join(' · ')}</span></div>}
        {data.note&&<p className="activation-intro">Your note: “{data.note}”</p>}
        {message&&<div className="notice">{message}</div>}
        <button className="btn activation-submit" onClick={send} disabled={status==='sending'}>{status==='sending'?'Sending…':'Send my profile'}</button>
        <p className="activation-intro">Didn’t ask for this? Close this page and nothing will be sent.</p>
      </>}
    </main>
  </div>;
}
