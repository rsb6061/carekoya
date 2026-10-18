import { useEffect, useState } from 'react';
import { SiteHeader } from './SiteChrome';
import './activation.css';

// carejoys.com/book/<token>: one of an agency's own applicants picks an interview time (src/applicantBooking.ts).
type Slot={id:string;label:string;durationMinutes:number;where:string;title:string};
type Booking={company:string;firstName:string;position:string;booked:{label:string;where:string}|null;slots:Slot[]};

async function api<T>(init?:RequestInit,query=''):Promise<T>{
  const res=await fetch('/api/applicant-booking'+query,{...init,headers:{'content-type':'application/json',...(init?.headers||{})}});
  const body=await res.json().catch(()=>({})) as T&{error?:string};
  if(!res.ok)throw new Error(body.error||'Something went wrong. Try again.');
  return body;
}

export function ApplicantBookingPage(){
  const token=decodeURIComponent(window.location.pathname.replace(/^\/book\//,'').split('/')[0]||'');
  const [data,setData]=useState<Booking|null>(null);
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');
  const [selected,setSelected]=useState('');
  const [busy,setBusy]=useState(false);
  const [changing,setChanging]=useState(false);

  async function load(){
    try{setData(await api<Booking>(undefined,'?token='+encodeURIComponent(token)))}
    catch(e){setError((e as Error).message)}
  }
  useEffect(()=>{void load()},[]);

  async function submit(body:Record<string,unknown>,done:string){
    setBusy(true);setMessage('');
    try{await api({method:'POST',body:JSON.stringify({token,...body})});setMessage(done);setSelected('');setChanging(false);await load()}
    catch(e){setMessage((e as Error).message);await load()}
    finally{setBusy(false)}
  }

  if(error)return <div className="activation-shell"><SiteHeader/><div className="activation-card"><div className="activation-kicker">Interview</div><h1>We couldn’t open this link.</h1><p>{error}</p></div></div>;
  if(!data)return <div className="activation-shell"><SiteHeader/><div className="activation-card"><div className="activation-kicker">Interview</div><h1>Loading…</h1></div></div>;

  const picking=!data.booked||changing;
  return <div className="activation-shell">
    <SiteHeader/>
    <main className="activation-card">
      <div className="activation-kicker">Interview with {data.company}</div>
      <h1>{data.booked&&!changing?'You’re on the calendar.':`Hi ${data.firstName||'there'}, choose your interview time`}</h1>
      {data.position&&<p className="activation-intro">For the <strong>{data.position}</strong> job at <strong>{data.company}</strong>.</p>}
      {message&&<div className="notice" role="status">{message}</div>}

      {data.booked&&!changing&&<>
        <div className="opportunity-summary"><div><strong>When</strong><span>{data.booked.label}</span></div>
          {data.booked.where&&<div><strong>Where</strong><span>{data.booked.where}</span></div>}</div>
        <p className="login-sub">The calendar invite was emailed to you and to {data.company}.</p>
        <div className="response-actions">
          {data.slots.length>0&&<button className="btn secondary" disabled={busy} onClick={()=>setChanging(true)}>Choose a different time</button>}
          <button className="btn secondary" disabled={busy} onClick={()=>void submit({action:'cancel'},'Your interview is cancelled.')}>Cancel the interview</button>
        </div>
      </>}

      {picking&&(data.slots.length===0
        ?<div className="notice">{data.company} has no open interview times right now. They’ll be in touch, or you can contact them directly.</div>
        :<form className="activation-form" onSubmit={e=>{e.preventDefault();if(selected)void submit({slotId:selected},'Booked. Check your email for the calendar invite.')}}>
          <div className="status-choices">
            {data.slots.map(s=><button type="button" key={s.id} className={'status-choice '+(selected===s.id?'selected':'')} aria-pressed={selected===s.id} onClick={()=>setSelected(s.id)}>
              <strong>{s.label}</strong><span>{[s.durationMinutes+' minutes',s.where,s.title].filter(Boolean).join(' · ')}</span>
            </button>)}
          </div>
          <button className="btn activation-submit" disabled={!selected||busy}>{busy?'Booking…':'Book this time'}</button>
          {changing&&<button type="button" className="btn secondary" onClick={()=>setChanging(false)}>Keep my current time</button>}
        </form>)}
    </main>
  </div>;
}
