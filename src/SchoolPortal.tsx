import { useEffect, useState, type FormEvent } from 'react';
import { TurnstileField } from './TurnstileField';
import './workspace.css';
import './activation.css';

async function api<T>(path:string,init?:RequestInit):Promise<T>{
  const res=await fetch(path,{...init,headers:{'content-type':'application/json',...(init?.headers||{})}});
  const body=await res.json() as T & {error?:string};
  if(!res.ok)throw new Error(body.error||'Request failed');
  return body;
}

export function SchoolProgramPage(){
  const slug=decodeURIComponent(window.location.pathname.split('/').filter(Boolean)[1]||'');
  const [program,setProgram]=useState<any>(null);
  const [status,setStatus]=useState<'loading'|'ready'|'sending'|'sent'|'pending'|'error'>('loading');
  const [message,setMessage]=useState('');
  const [turnstileToken,setTurnstileToken]=useState('');

  useEffect(()=>{
    api<any>('/api/school/program/'+encodeURIComponent(slug))
      .then(data=>{setProgram(data.program);document.title=data.program.name+' | CareJoys';setStatus('ready')})
      .catch(error=>{setMessage(error instanceof Error?error.message:'Could not load program');setStatus('error')});
  },[slug]);

  async function requestAccess(e:FormEvent<HTMLFormElement>){
    e.preventDefault();setStatus('sending');setMessage('');
    const fd=new FormData(e.currentTarget);
    const data=Object.fromEntries(fd.entries()) as any;
    data.slug=slug;data.turnstileToken=turnstileToken;
    try{
      const result=await api<any>('/api/school/claim/request',{method:'POST',body:JSON.stringify(data)});
      setMessage(result.message||'Request received.');
      setStatus(result.pending?'pending':'sent');
    }catch(error){
      setMessage(error instanceof Error?error.message:'Could not request access');setStatus('ready');
    }
  }

  if(status==='loading')return <div className="activation-shell"><div className="activation-card"><div className="activation-kicker">CareJoys</div><h1>Loading program…</h1></div></div>;
  if(status==='error'||!program)return <div className="activation-shell"><div className="activation-card"><div className="activation-kicker">CareJoys</div><h1>Program not found.</h1><p>{message}</p></div></div>;

  return <div className="activation-shell">
    <header className="activation-nav"><a className="brand" href="/">CareJoys</a></header>
    <main className="activation-card">
      <div className="activation-kicker">Maryland training partner</div>
      <h1>{program.name}</h1>
      <p className="activation-intro">{[program.providerType,program.city,program.state].filter(Boolean).join(' · ')}</p>
      <div className="agency-source-note"><strong>{program.programType}</strong><span>Current Maryland Board of Nursing status: {program.currentStatus}</span></div>

      <div className="activation-section-head"><h2>Free graduate placement network</h2><p>Give graduates one CareJoys link. We track signup → employer interest → interview → hire for your program.</p></div>
      <div className="response-actions"><a className="btn" href={program.referralUrl}>Open graduate signup link</a></div>

      {status==='sent'||status==='pending'?<div className="activation-success">
        <div className="success-mark">✓</div><h2>{status==='sent'?'Check your work email.':'Access request received.'}</h2><p>{message}</p>
      </div>:<form className="activation-form" onSubmit={requestAccess}>
        <div className="activation-section-head"><h2>Claim this program</h2><p>Program staff can get a placement dashboard and tracked graduate referral link.</p></div>
        <div className="form-grid"><label>Your name<input name="contactName" required /></label><label>Work email<input type="email" name="email" required /></label></div>
        <label>Phone<input name="phone" /></label>
        <TurnstileField onToken={setTurnstileToken}/>
        {message&&<div className="notice">{message}</div>}
        <button className="btn activation-submit" disabled={status==='sending'}>{status==='sending'?'Requesting…':'Request program access'}</button>
      </form>}
    </main>
  </div>;
}

export function SchoolAuth(){
  const token=new URLSearchParams(window.location.search).get('token')||'';
  const [status,setStatus]=useState<'loading'|'error'>('loading');
  const [message,setMessage]=useState('');
  useEffect(()=>{
    if(!token){setStatus('error');setMessage('This sign-in link is missing.');return;}
    api('/api/school/auth/verify',{method:'POST',body:JSON.stringify({token})})
      .then(()=>{window.location.href='/school-dashboard'})
      .catch(error=>{setMessage(error instanceof Error?error.message:'Could not sign in');setStatus('error')});
  },[token]);
  return <div className="activation-shell"><div className="activation-card"><div className="activation-kicker">CareJoys</div><h1>{status==='loading'?'Signing you in…':'We couldn’t sign you in.'}</h1>{message&&<p>{message}</p>}</div></div>;
}

export function SchoolDashboard(){
  const [data,setData]=useState<any>(null);
  const [error,setError]=useState('');
  const [copied,setCopied]=useState('');
  const [cohortOpen,setCohortOpen]=useState(false);
  const [savingCohort,setSavingCohort]=useState(false);
  const [message,setMessage]=useState('');

  async function load(){
    try{setData(await api<any>('/api/school/dashboard'));setError('')}
    catch(e){setError(e instanceof Error?e.message:'Sign in required')}
  }
  useEffect(()=>{void load()},[]);
  async function logout(){await api('/api/school/logout',{method:'POST'});window.location.href='/'}
  async function copy(url:string,key:string){
    if(!url)return;
    await navigator.clipboard.writeText(url);
    setCopied(key);
    setTimeout(()=>setCopied(''),1800);
  }
  async function createCohort(e:FormEvent<HTMLFormElement>){
    e.preventDefault();setSavingCohort(true);setMessage('');
    const fd=new FormData(e.currentTarget);
    try{
      await api('/api/school/cohorts',{method:'POST',body:JSON.stringify({
        name:String(fd.get('name')||''),
        expectedGraduationDate:String(fd.get('expectedGraduationDate')||''),
        expectedGraduates:Number(fd.get('expectedGraduates')||0)||null
      })});
      setMessage('Cohort created. Its referral link is ready to share.');
      setCohortOpen(false);
      await load();
    }catch(e){setMessage(e instanceof Error?e.message:'Could not create cohort')}
    finally{setSavingCohort(false)}
  }

  if(error)return <div className="app-empty"><div className="app-wrap"><div className="beta-hero app-empty-card"><div className="modal-kicker">School dashboard</div><h1>Sign in required.</h1><p>{error}</p></div></div></div>;
  if(!data)return <div className="loading-screen">Loading CareJoys…</div>;
  const s=data.stats||{},school=data.school||{},cohorts=data.cohorts||[];

  return <div>
    <header className="app-header"><div className="app-wrap header-inner"><a className="brand" href="/">CareJoys</a><nav className="app-nav"><button className="nav-button" onClick={logout}>Sign out</button></nav></div></header>
    <main className="app-wrap app-content">
      <section className="page-head page-head-row">
        <div><div className="modal-kicker">Training program placement dashboard</div><h1>{school.name}</h1><p>{[school.providerType,school.city,school.state].filter(Boolean).join(' · ')}</p></div>
        <div className="header-action"><button className="button" onClick={()=>setCohortOpen(true)}>+ New cohort</button></div>
      </section>

      <div className="school-stats">
        <div className="settings-card"><strong>{s.signups||0}</strong><span>Graduate signups</span></div>
        <div className="settings-card"><strong>{s.activeProfiles||0}</strong><span>Active profiles</span></div>
        <div className="settings-card"><strong>{s.interested||0}</strong><span>Employer interest</span></div>
        <div className="settings-card"><strong>{s.interviews||0}</strong><span>Interviews</span></div>
        <div className="settings-card"><strong>{s.hires||0}</strong><span>Hires</span></div>
      </div>

      {message&&<div className="alert-status workspace-alert">✓ {message}</div>}

      <section className="section-block"><div className="section-heading"><h2>Program referral link</h2><p>Use this for general referrals. CareJoys attributes downstream placement activity back to your program.</p></div>
        <div className="settings-card referral-box"><code>{school.referralUrl}</code><button className="button" onClick={()=>copy(school.referralUrl,'program')}>{copied==='program'?'Copied':'Copy link'}</button></div>
      </section>

      <section className="section-block">
        <div className="section-heading"><h2>Cohorts</h2><p>Create a separate link for each graduating class so you can see which cohorts generate interviews and hires.</p></div>
        {cohorts.length===0?<div className="empty"><strong>No cohorts yet.</strong><div>Create one for your next graduating class.</div></div>:
        <div className="job-list">{cohorts.map((cohort:any,i:number)=><article className={'job-card '+['job-card-sky','job-card-mint','job-card-lilac','job-card-peach'][i%4]} key={cohort.id}>
          <div className="job-card-main">
            <div className="job-card-title-row"><h3>{cohort.name}</h3></div>
            <div className="job-meta">{[cohort.expectedGraduationDate?('Graduation '+cohort.expectedGraduationDate):'',cohort.expectedGraduates?cohort.expectedGraduates+' expected graduates':''].filter(Boolean).join(' · ')}</div>
            <div className="job-badges"><span className="badge">{cohort.signups||0} signups</span><span className="badge">{cohort.interested||0} interested</span><span className="badge">{cohort.interviews||0} interviews</span><span className="status applied">{cohort.hires||0} hires</span></div>
            <div className="referral-inline"><code>{cohort.referralUrl}</code></div>
          </div>
          <div className="job-card-side"><button className="button secondary" onClick={()=>copy(cohort.referralUrl,cohort.id)}>{copied===cohort.id?'Copied':'Copy link'}</button></div>
        </article>)}</div>}
      </section>

      <section className="section-block"><div className="section-heading"><h2>How attribution works</h2><p>CareJoys tracks each referred caregiver from profile creation through interested employer, booked interview, and recorded hire.</p></div>
        <div className="pipeline-legend"><span>Program / cohort</span><b>→</b><span>Caregiver profile</span><b>→</b><span>Employer interest</span><b>→</b><span>Interview</span><b>→</b><span>Hire</span></div>
      </section>

      {cohortOpen&&<div className="modal-backdrop" onMouseDown={()=>setCohortOpen(false)}><div className="modal-panel" onMouseDown={e=>e.stopPropagation()}>
        <button className="modal-close" onClick={()=>setCohortOpen(false)}>×</button>
        <div className="modal-kicker">New graduating cohort</div><h2>Create a trackable referral link.</h2>
        <p className="modal-intro">Use one cohort per class or graduation period. The link will attribute signups, interviews, and hires to that group.</p>
        <form className="intake-form" onSubmit={createCohort}>
          <label>Cohort name<input name="name" required placeholder="Spring 2027 CNA class" /></label>
          <div className="form-grid"><label>Expected graduation<input type="date" name="expectedGraduationDate" /></label><label>Expected graduates<input type="number" min="1" max="1000" name="expectedGraduates" /></label></div>
          <button className="button submit-button" disabled={savingCohort}>{savingCohort?'Creating…':'Create cohort link'}</button>
        </form>
      </div></div>}
    </main>
  </div>;
}
