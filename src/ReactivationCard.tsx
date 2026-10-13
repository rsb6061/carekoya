import { useEffect, useState } from 'react';

type Status={ready:number;sent:number;failed:number;yes:number;no:number;lastSend:{senderName:string;payText:string;sent:number;failed:number;sentBy:string;at:string}|null};

async function call<T>(url:string,init?:RequestInit):Promise<T>{
  const res=await fetch(url,{credentials:'include',...init,headers:{'content-type':'application/json',...(init?.headers||{})}});
  const body=await res.json().catch(()=>({})) as T&{error?:string};
  if(!res.ok)throw new Error(body.error||'Something went wrong. Try again.');
  return body;
}

/**
 * Admin only: email an agency's past applicants ("still looking?") for the agency. A test copy first, then a send
 * the operator confirms. Nothing goes out on a schedule.
 */
export function ReactivationCard({url,agencyName,defaultTestTo,version,onSent}:{url:string;agencyName:string;defaultTestTo:string;version:number;onSent:()=>void}){
  const [status,setStatus]=useState<Status|null>(null);
  const [senderName,setSenderName]=useState('');
  const [payText,setPayText]=useState('');
  const [testTo,setTestTo]=useState(defaultTestTo);
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState<{text:string;tone:'ok'|'error'}|null>(null);

  useEffect(()=>{
    setStatus(null);setSenderName('');setPayText('');
    call<Status>(url).then(s=>{setStatus(s);if(s.lastSend){setSenderName(s.lastSend.senderName);setPayText(s.lastSend.payText)}}).catch(e=>setNotice({text:e.message,tone:'error'}));
  },[url]);
  // Recount after the list reloads (an upload, a send); keeps what the operator typed.
  useEffect(()=>{if(version>1)call<Status>(url).then(setStatus).catch(()=>{})},[version]);

  async function run(test:boolean){
    if(!test&&!window.confirm(`Email ${Math.min(status?.ready||0,100)} past applicants as ${senderName} with ${agencyName}?`))return;
    setBusy(true);setNotice(null);
    try{
      if(test){
        const r=await call<{to:string}>(url,{method:'POST',body:JSON.stringify({senderName,payText,testTo})});
        setNotice({text:`Test sent to ${r.to}.`,tone:'ok'});
      }else{
        const r=await call<{batch:{attempted:number;sent:number;failed:number};status:Status}>(url,{method:'POST',body:JSON.stringify({senderName,payText})});
        setStatus(r.status);
        setNotice({text:`Emailed ${r.batch.sent} past applicant${r.batch.sent===1?'':'s'}.${r.batch.failed?` ${r.batch.failed} failed.`:''}${r.status.ready?` ${r.status.ready} still to send.`:''}`,tone:r.batch.failed?'error':'ok'});
        onSent();
      }
    }catch(e){setNotice({text:(e as Error).message,tone:'error'})}
    finally{setBusy(false)}
  }

  if(!status)return notice?<div className="alert-status alert-error">{notice.text}</div>:null;
  return <div className="settings-card">
    <h3>Email past applicants</h3>
    <p className="job-meta">A “still looking?” email from {agencyName} to applicants uploaded as <strong>Past applicants</strong>, with one-tap Yes and No buttons. Each person gets it once. A yes moves them to Contacted.</p>
    <p><strong>{status.ready} ready to email</strong> · {status.sent} emailed · {status.yes} said yes · {status.no} said no{status.failed?` · ${status.failed} failed`:''}</p>
    <div className="intake-form">
      <label>From (first name)<input value={senderName} onChange={e=>setSenderName(e.target.value)} maxLength={80} placeholder="Sam"/></label>
      <label>Pay to mention (optional)<input value={payText} onChange={e=>setPayText(e.target.value)} maxLength={80} placeholder="$17–$20/hr"/></label>
      <p className="job-meta">Reads: “This is {senderName||'Sam'} with {agencyName}. You applied with us for a Caregiver position a while back, and we have open shifts now{payText?` paying ${payText}`:''}.” Replies go to hello@carejoys.com.</p>
      <div className="inline-form">
        <input type="email" value={testTo} onChange={e=>setTestTo(e.target.value)} placeholder="you@carejoys.com" aria-label="Test email address"/>
        <button type="button" className="button secondary" disabled={busy||!senderName.trim()} onClick={()=>void run(true)}>Send me a test</button>
      </div>
      <button type="button" className="button" disabled={busy||!senderName.trim()||!status.ready} onClick={()=>void run(false)}>
        {status.ready?`Email ${Math.min(status.ready,100)} past applicant${status.ready===1?'':'s'}`:'No past applicants to email'}
      </button>
    </div>
    {notice&&<div className={'alert-status workspace-alert'+(notice.tone==='ok'?'':' alert-error')} role="status">{notice.tone==='ok'?'✓ ':''}{notice.text}</div>}
    {status.lastSend&&<p className="job-meta">Last send: {status.lastSend.sent} emailed as {status.lastSend.senderName}{status.lastSend.sentBy?` by ${status.lastSend.sentBy}`:''}, {new Date(status.lastSend.at.replace(' ','T')+'Z').toLocaleString()}.</p>}
  </div>;
}
