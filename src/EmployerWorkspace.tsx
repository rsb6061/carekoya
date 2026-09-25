import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { TurnstileField } from './TurnstileField';
import './workspace.css';

type Opening={
  id:string;title:string;role:string;city?:string;state?:string;zip?:string;
  pay_min?:number;pay_max?:number;shift_preferences?:string;status?:string;
};
type Candidate={
  id:string;name:string;city?:string;state?:string;zip?:string;role?:string;
  certifications?:string;specialties?:string;yearsExperience?:number;desiredWage?:string;
  shifts?:string;travelMiles?:number;freshness?:string;workStatus?:string;
};
type PipelineRow={
  id:string;opening_id:string;title:string;opening_role:string;caregiver_id:string;
  name:string;city?:string;state?:string;role?:string;certifications?:string;
  match_score?:number;match_reason?:string;stage:string;freshness?:string;interview_at?:string;
};
type SessionEmployer={id:string;companyName:string;contactName:string;email:string;zip?:string};

async function api<T>(path:string,init?:RequestInit):Promise<T>{
  const res=await fetch(path,{...init,headers:{'content-type':'application/json',...(init?.headers||{})}});
  const body=await res.json() as T & {error?:string};
  if(!res.ok)throw new Error(body.error||'Request failed');
  return body;
}
const cardTone=(index:number)=>['job-card-sky','job-card-mint','job-card-lilac','job-card-peach'][index%4];

function EmployerSignIn(){
  const [email,setEmail]=useState('');
  const [turnstileToken,setTurnstileToken]=useState('');
  const [status,setStatus]=useState<'idle'|'sending'|'sent'|'error'>('idle');
  const [message,setMessage]=useState('');

  async function submit(e:FormEvent){
    e.preventDefault();setStatus('sending');setMessage('');
    try{
      await api('/api/auth/request',{method:'POST',body:JSON.stringify({email,turnstileToken})});
      setStatus('sent');setMessage('Check your email for a secure CareJoys sign-in link.');
    }catch(error){
      setStatus('error');setMessage(error instanceof Error?error.message:'Could not send sign-in link.');
    }
  }
  return <div className="app-empty"><div className="app-wrap">
    <a href="/" className="text-link">← Back to CareJoys</a>
    <div className="beta-hero app-empty-card">
      <div className="modal-kicker">Employer access</div>
      <h1>Sign in to your recruiting workspace.</h1>
      <p>Enter the email you used with CareJoys. We’ll email you a secure one-time sign-in link — no password required.</p>
      <form className="auth-form" onSubmit={submit}>
        <input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@company.com" required />
        <TurnstileField onToken={setTurnstileToken}/>
        {message&&<div className={status==='error'?'notice':'alert-status'}>{message}</div>}
        {status!=='sent'&&<button className="button" disabled={status==='sending'}>{status==='sending'?'Sending…':'Email me a sign-in link'}</button>}
      </form>
    </div>
  </div></div>;
}

export function EmployerWorkspace(){
  const [session,setSession]=useState<SessionEmployer|null>(null);
  const [authLoading,setAuthLoading]=useState(true);
  const [workspace,setWorkspace]=useState<any>(null);
  const [openings,setOpenings]=useState<Opening[]>([]);
  const [pipeline,setPipeline]=useState<PipelineRow[]>([]);
  const [candidates,setCandidates]=useState<Candidate[]>([]);
  const [tab,setTab]=useState<'openings'|'talent'|'pipeline'>('openings');
  const [loading,setLoading]=useState(false);
  const [message,setMessage]=useState('');
  const [filters,setFilters]=useState({role:'',zip:'',state:'',freshness:'all'});
  const [showOpening,setShowOpening]=useState(false);
  const [slotsFor,setSlotsFor]=useState<Opening|null>(null);
  const [slotInputs,setSlotInputs]=useState([{startsAt:'',durationMinutes:30}]);

  async function loadSession(){
    try{const data=await api<{employer:SessionEmployer}>('/api/session');setSession(data.employer)}
    catch{setSession(null)}
    finally{setAuthLoading(false)}
  }
  async function refreshWorkspace(employerId=session?.id){
    if(!employerId)return;
    setLoading(true);
    try{
      const data=await api<any>('/api/workspace');
      setWorkspace(data.workspace);setOpenings(data.openings||[]);
      const p=await api<any>('/api/pipeline');setPipeline(p.pipeline||[]);
    }catch(e){
      if(e instanceof Error&&e.message==='Sign in required')setSession(null);
      else setMessage(e instanceof Error?e.message:'Could not load workspace');
    }finally{setLoading(false)}
  }

  useEffect(()=>{void loadSession()},[]);
  useEffect(()=>{if(session)void refreshWorkspace(session.id)},[session?.id]);

  async function searchTalent(e?:FormEvent){
    e?.preventDefault();const params=new URLSearchParams();
    Object.entries(filters).forEach(([k,v])=>{if(v&&v!=='all')params.set(k,v)});
    const data=await api<any>('/api/candidates?'+params);setCandidates(data.candidates||[]);setTab('talent');
  }
  async function createOpening(e:FormEvent<HTMLFormElement>){
    e.preventDefault();if(!session)return;
    const fd=new FormData(e.currentTarget);const data=Object.fromEntries(fd.entries()) as any;
    data.transportationRequired=fd.get('transportationRequired')==='on';
    await api('/api/openings',{method:'POST',body:JSON.stringify(data)});
    setShowOpening(false);setMessage('Opening created.');await refreshWorkspace();
  }
  async function runMatch(openingId:string){
    if(!session)return;setMessage('Matching caregivers…');
    const result=await api<any>('/api/openings/'+openingId+'/match',{method:'POST'});
    setMessage((result.matched||0)+' caregivers matched. Review them in Pipeline, then contact the strongest matches.');
    await refreshWorkspace();setTab('pipeline');
  }
  async function contact(openingId:string){
    if(!session)return;setMessage('Contacting top matches…');
    try{
      const result=await api<any>('/api/openings/'+openingId+'/contact',{method:'POST',body:JSON.stringify({limit:5})});
      setMessage(result.sent+' caregiver'+(result.sent===1?'':'s')+' contacted'+(result.failed?' · '+result.failed+' failed':'')+'.');
      await refreshWorkspace();setTab('pipeline');
    }catch(error){setMessage(error instanceof Error?error.message:'Could not contact matches')}
  }
  async function moveStage(id:string,stage:string){
    if(!session)return;
    await api('/api/pipeline/'+id,{method:'PATCH',body:JSON.stringify({stage})});await refreshWorkspace();
  }
  async function saveSlots(e:FormEvent){
    e.preventDefault();if(!session||!slotsFor)return;
    const timezone=Intl.DateTimeFormat().resolvedOptions().timeZone||'America/New_York';
    const slots=slotInputs.filter(s=>s.startsAt).map(s=>({startsAt:new Date(s.startsAt).toISOString(),durationMinutes:s.durationMinutes,timezone}));
    try{
      const result=await api<any>('/api/openings/'+slotsFor.id+'/interview-slots',{method:'POST',body:JSON.stringify({slots})});
      setMessage(result.added+' interview time'+(result.added===1?'':'s')+' added. Interested caregivers can book these directly.');
      setSlotsFor(null);setSlotInputs([{startsAt:'',durationMinutes:30}]);
    }catch(error){setMessage(error instanceof Error?error.message:'Could not save interview times')}
  }
  async function logout(){
    await api('/api/auth/logout',{method:'POST'});setSession(null);setWorkspace(null);setOpenings([]);setPipeline([]);
  }

  const counts=useMemo(()=>{const by=(s:string)=>pipeline.filter(p=>p.stage===s).length;return{matched:by('matched'),contacted:by('contacted'),interested:by('interested'),interview:by('interview'),hired:by('hired')}},[pipeline]);

  if(authLoading)return <div className="loading-screen">Loading CareJoys…</div>;
  if(!session)return <EmployerSignIn/>;
  if(loading&&!workspace)return <div className="loading-screen">Loading CareJoys…</div>;

  return <div>
    <header className="app-header"><div className="app-wrap header-inner">
      <a className="brand" href="/app">CareJoys</a>
      <nav className="app-nav">
        <button className={'nav-button '+(tab==='openings'?'active':'')} onClick={()=>setTab('openings')}>Openings</button>
        <button className={'nav-button '+(tab==='talent'?'active':'')} onClick={()=>setTab('talent')}>Talent network</button>
        <button className={'nav-button '+(tab==='pipeline'?'active':'')} onClick={()=>setTab('pipeline')}>Pipeline</button>
        <a className="nav-link" href="/">Public site</a><button className="nav-button" onClick={logout}>Sign out</button>
      </nav>
    </div></header>

    <main className="app-wrap app-content">
      <section className="page-head page-head-row"><div><h1>{workspace?.company_name||session.companyName||'Recruiting workspace'}</h1><p>From hiring need to interested caregiver to booked interview.</p></div>
      <div className="header-action"><button className="button" onClick={()=>setShowOpening(true)}>+ New opening</button></div></section>

      <div className="result-summary workspace-summary"><strong>{openings.filter(o=>o.status==='open').length} open roles</strong><span>{counts.matched} matched</span><span>{counts.contacted} contacted</span><span>{counts.interested} interested</span><span>{counts.interview} interviews</span><span>{counts.hired} hired</span></div>
      <div className="pipeline-legend"><span>Matched</span><b>→</b><span>Contacted</span><b>→</b><span>Interested</span><b>→</b><span>Interview booked</span><b>→</b><span>Hired</span></div>
      {message&&<div className="alert-status workspace-alert">✓ {message}</div>}

      {tab==='openings'&&<section className="section-block"><div className="section-heading"><h2>Openings</h2><p>Create a role, match the network, add interview times, then contact the strongest candidates.</p></div>
      {openings.length===0?<div className="empty"><strong>No openings yet.</strong><div>Add the first job you want CareJoys to recruit for.</div><div className="empty-actions"><button className="button secondary" onClick={()=>setShowOpening(true)}>Create opening</button></div></div>:
      <div className="job-list">{openings.map((o,i)=><article key={o.id} className={'job-card '+cardTone(i)}>
        <div className="job-card-main"><div className="job-card-title-row"><h3>{o.title}</h3></div><div className="job-meta">{[o.role,o.city,o.state,o.zip].filter(Boolean).join(' · ')}</div>
        <div className="job-badges">{o.shift_preferences&&<span className="badge">{o.shift_preferences}</span>}{(o.pay_min||o.pay_max)&&<span className="badge">{'$'+(o.pay_min||'—')+'–$'+(o.pay_max||'—')+'/hr'}</span>}<span className="status">{o.status||'open'}</span></div></div>
        <div className="job-card-side opening-actions"><button className="job-card-action" onClick={()=>runMatch(o.id)}>Find matches</button><button className="button secondary" onClick={()=>setSlotsFor(o)}>Interview times</button><button className="button secondary" onClick={()=>contact(o.id)}>Contact top 5</button></div>
      </article>)}</div>}</section>}

      {tab==='talent'&&<section className="section-block"><div className="section-heading"><h2>Talent network</h2><p>Older profiles remain discoverable with availability clearly marked unconfirmed. Recent confirmations rank higher.</p></div>
        <form className="talent-filters settings-card" onSubmit={searchTalent}><input value={filters.role} onChange={e=>setFilters({...filters,role:e.target.value})} placeholder="Role: CNA, HHA, caregiver" /><input value={filters.zip} onChange={e=>setFilters({...filters,zip:e.target.value})} placeholder="ZIP" /><input value={filters.state} onChange={e=>setFilters({...filters,state:e.target.value})} placeholder="State" /><select value={filters.freshness} onChange={e=>setFilters({...filters,freshness:e.target.value})}><option value="all">Any availability</option><option value="confirmed">Confirmed in last 30 days</option></select><button className="button">Search</button></form>
        {candidates.length===0?<div className="empty"><strong>Search the network.</strong><div>Caregivers with unconfirmed availability can still appear, but confirmed candidates rank higher in matching.</div></div>:
        <div className="job-list">{candidates.map((c,i)=><article className={'job-card '+cardTone(i)} key={c.id}><div className="job-card-main"><div className="job-card-title-row"><h3>{c.name}</h3></div><div className="job-meta">{[c.role,c.city,c.state].filter(Boolean).join(' · ')}</div><div className="job-badges"><span className={c.workStatus==='actively_looking'?'status applied':'status'}>{c.freshness}</span>{c.shifts&&<span className="badge">{c.shifts}</span>}{c.desiredWage&&<span className="badge">{c.desiredWage}</span>}</div>{c.certifications&&<div className="job-card-cue">{c.certifications}</div>}</div></article>)}</div>}</section>}

      {tab==='pipeline'&&<section className="section-block"><div className="section-heading"><h2>Candidate pipeline</h2><p>Interested responses and interview bookings update automatically. You can still advance or reject candidates manually.</p></div>
        {pipeline.length===0?<div className="empty"><strong>No matched caregivers yet.</strong><div>Run matching on an opening to populate this pipeline.</div></div>:
        <div className="job-list">{pipeline.map((row,i)=><article className={'job-card '+cardTone(i)} key={row.id}><div className="job-card-main"><div className="job-card-title-row"><h3>{row.name}</h3></div><div className="job-meta">{[row.role,row.city,row.state].filter(Boolean).join(' · ')}</div><div className="job-badges"><span className="badge">{row.match_score||0}% match</span><span className="status">{row.title}</span><span className="status">{row.freshness}</span>{row.interview_at&&<span className="status applied">{new Date(row.interview_at).toLocaleString()}</span>}</div></div><div className="job-card-side"><select className="pipeline-select" value={row.stage} onChange={e=>moveStage(row.id,e.target.value)}><option value="matched">Matched</option><option value="contacted">Contacted</option><option value="interested">Interested</option><option value="interview">Interview booked</option><option value="hired">Hired</option><option value="rejected">Rejected</option></select></div></article>)}</div>}</section>}

      {showOpening&&<div className="modal-backdrop" onMouseDown={()=>setShowOpening(false)}><div className="modal-panel" onMouseDown={e=>e.stopPropagation()}><button className="modal-close" onClick={()=>setShowOpening(false)}>×</button><div className="modal-kicker">New opening</div><h2>Who do you need?</h2><p className="modal-intro">Add the role, location, pay, and shift. CareJoys uses these details to rank the network.</p>
        <form className="intake-form" onSubmit={createOpening}><label>Job title<input name="title" required placeholder="CNA — day shift" /></label><div className="form-grid"><label>Role<select name="role" required defaultValue=""><option value="" disabled>Select</option><option>CNA</option><option>GNA</option><option>HHA</option><option>PCA</option><option>Caregiver</option></select></label><label>ZIP<input name="zip" /></label></div><div className="form-grid"><label>City<input name="city" /></label><label>State<input name="state" /></label></div><div className="form-grid"><label>Min pay / hr<input type="number" name="payMin" /></label><label>Max pay / hr<input type="number" name="payMax" /></label></div><label>Shift<input name="shifts" placeholder="Days, nights, weekends" /></label><label>Requirements<textarea name="requirements" rows={4} placeholder="Experience, credential, schedule, client requirements..." /></label><label className="check-row"><input type="checkbox" name="transportationRequired" /><span>Reliable transportation required</span></label><button className="button submit-button">Create opening</button></form>
      </div></div>}

      {slotsFor&&<div className="modal-backdrop" onMouseDown={()=>setSlotsFor(null)}><div className="modal-panel" onMouseDown={e=>e.stopPropagation()}><button className="modal-close" onClick={()=>setSlotsFor(null)}>×</button><div className="modal-kicker">Interview availability</div><h2>Add times caregivers can book.</h2><p className="modal-intro">Interested caregivers will see these times immediately. Booking reserves the slot and emails both sides a calendar invite.</p>
        <form className="intake-form" onSubmit={saveSlots}>{slotInputs.map((slot,index)=><div className="form-grid" key={index}><label>Interview time<input type="datetime-local" value={slot.startsAt} onChange={e=>setSlotInputs(slotInputs.map((s,i)=>i===index?{...s,startsAt:e.target.value}:s))} required /></label><label>Duration<select value={slot.durationMinutes} onChange={e=>setSlotInputs(slotInputs.map((s,i)=>i===index?{...s,durationMinutes:Number(e.target.value)}:s))}><option value={15}>15 min</option><option value={30}>30 min</option><option value={45}>45 min</option><option value={60}>60 min</option></select></label></div>)}{slotInputs.length<5&&<button type="button" className="button secondary" onClick={()=>setSlotInputs([...slotInputs,{startsAt:'',durationMinutes:30}])}>+ Add another time</button>}<button className="button submit-button">Save interview times</button></form>
      </div></div>}
    </main>
    <footer className="app-footer"><div className="app-wrap">CareJoys · Caregivers ready to work. Interviews ready for you.</div></footer>
  </div>;
}
