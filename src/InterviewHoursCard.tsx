import { useEffect, useState, type FormEvent } from 'react';
import { INTERVIEW_FORMATS, WEEKDAYS, type InterviewHours } from './quickApplyShared';

// Settings › Interview times: when the agency takes interviews. Applicants who pass its questions book one of these
// times on the spot, right after applying, and both sides get a calendar invite. With none set, applicants say which
// times suit a call instead.
const DAY_LABEL:Record<string,string>={mon:'Mon',tue:'Tue',wed:'Wed',thu:'Thu',fri:'Fri',sat:'Sat',sun:'Sun'};
const TIMES=Array.from({length:27},(_,i)=>{const m=7*60+i*30;const h=Math.floor(m/60),mm=m%60;
  return [String(h).padStart(2,'0')+':'+String(mm).padStart(2,'0'),((h+11)%12+1)+':'+String(mm).padStart(2,'0')+(h<12?' AM':' PM')] as const});

export function InterviewHoursCard(){
  const [hours,setHours]=useState<InterviewHours|null>(null);
  const [preview,setPreview]=useState<string[]>([]);
  const [draft,setDraft]=useState<InterviewHours>({days:['tue','thu'],start:'10:00',end:'14:00',duration:30,format:'phone',location:'',
    timezone:Intl.DateTimeFormat().resolvedOptions().timeZone||'America/New_York'});
  const [loaded,setLoaded]=useState(false);
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState<{text:string;ok:boolean}|null>(null);

  useEffect(()=>{
    fetch('/api/agency/interview-hours',{credentials:'include'}).then(r=>r.json()).then((b:{hours?:InterviewHours|null;preview?:string[]})=>{
      if(b.hours){setHours(b.hours);setDraft(b.hours)}
      setPreview(b.preview||[]);
    }).catch(()=>{}).finally(()=>setLoaded(true));
  },[]);

  async function put(body:unknown,done:string){
    setBusy(true);setNotice(null);
    try{
      const res=await fetch('/api/agency/interview-hours',{method:'PUT',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
      const b=await res.json() as {hours?:InterviewHours|null;preview?:string[];error?:string};
      if(!res.ok)throw new Error(b.error||'Could not save.');
      setHours(b.hours||null);setPreview(b.preview||[]);setNotice({text:done,ok:true});
    }catch(e){setNotice({text:e instanceof Error?e.message:'Could not save.',ok:false})}
    finally{setBusy(false)}
  }
  function save(e:FormEvent){e.preventDefault();void put(draft,'Saved. Applicants can now book these times right after they apply.')}

  return <div className="settings-card interview-hours-card" id="interview-times">
    <h3>Interview times</h3>
    <p className="job-meta">Applicants who pass your questions book one of these times the moment they apply. You both get a calendar invite.{hours?'':' Until you set times, applicants tell you when suits them for a call.'}</p>
    {!loaded?<p className="job-meta">Loading…</p>:<form className="intake-form" onSubmit={save}>
      <div className="ih-days" role="group" aria-label="Days">
        {WEEKDAYS.map(d=>{const on=draft.days.includes(d);return <button type="button" key={d} className={'chip'+(on?' on':'')} aria-pressed={on}
          onClick={()=>setDraft(x=>({...x,days:on?x.days.filter(y=>y!==d):[...x.days,d]}))}>{DAY_LABEL[d]}</button>})}
      </div>
      <div className="ih-row">
        <label>From<select value={draft.start} onChange={e=>setDraft(x=>({...x,start:e.target.value}))}>{TIMES.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
        <label>Until<select value={draft.end} onChange={e=>setDraft(x=>({...x,end:e.target.value}))}>{TIMES.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
        <label>Each interview<select value={draft.duration} onChange={e=>setDraft(x=>({...x,duration:Number(e.target.value)}))}>{[15,20,30,45,60].map(n=><option key={n} value={n}>{n} minutes</option>)}</select></label>
      </div>
      <div className="ih-row">
        <label>How<select value={draft.format} onChange={e=>setDraft(x=>({...x,format:e.target.value as InterviewHours['format']}))}>{INTERVIEW_FORMATS.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
        <label className="ih-wide">{draft.format==='in_person'?'Address':draft.format==='video'?'Video link':'Note (optional)'}
          <input value={draft.location} maxLength={300} onChange={e=>setDraft(x=>({...x,location:e.target.value}))} placeholder={draft.format==='in_person'?'1 Main St, Towson, MD':draft.format==='video'?'https://meet.google.com/…':'We’ll call you from 410-555-0100'}/></label>
      </div>
      <p className="job-meta">Times are in {draft.timezone.replace(/_/g,' ')}.{preview.length&&hours?' Next open: '+preview.join(' · '):''}</p>
      {notice&&<div className={'alert-status'+(notice.ok?'':' alert-error')} role="status">{notice.text}</div>}
      <div className="ih-actions">
        <button className="button" disabled={busy}>{hours?'Save times':'Turn on booking'}</button>
        {hours&&<button type="button" className="text-button" disabled={busy} onClick={()=>void put({off:true},'Booking is off. Applicants will tell you when suits them for a call.')}>Turn off</button>}
      </div>
    </form>}
  </div>;
}
