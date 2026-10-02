import { useEffect, useState, type FormEvent } from 'react';
import { useCaregiverAuth } from './caregiverAuth';
import { LoginForm, Shell } from './LoginPage';
import { ResumeFileInput } from './ApplyForMe';
import { jobsHubPath, usState } from './usStates';
import { IntakeModal } from './IntakeModal';
import { rememberDashboard } from './dashboardHome';
import './workspace.css';

type Slot={id:string;startsAt:string;durationMinutes:number;timezone:string};
type Invite={
  id:string;stage:string;response?:string|null;contactedAt?:string;interviewAt?:string|null;interviewBooked:boolean;
  company?:string;title?:string;role?:string;city?:string;state?:string;payMin?:number|null;payMax?:number|null;shifts?:string;requirements?:string;
  slots:Slot[];
};
type NearbyJob={id:string;title:string;employerName?:string;city?:string;state?:string;payMin?:number|null;payMax?:number|null;payPeriod?:string;distanceMiles?:number|null};
type Application={jobId:string;title:string;employerName?:string;at:string;applicationUrl?:string;appliedOnCareJoys:boolean;openedEmployerSite:boolean;employerOnCareJoys:boolean;submittedOnEmployerSite?:boolean};

function applicationStatus(a:Application){
  if(a.submittedOnEmployerSite)return 'CareJoys applied for you on the employer’s site';
  if(a.appliedOnCareJoys&&a.employerOnCareJoys)return 'Sent to the employer through CareJoys';
  if(a.appliedOnCareJoys)return 'Saved on CareJoys';
  return a.openedEmployerSite?'Opened the employer’s application':'Started on CareJoys';
}
type Caregiver={
  id:string;firstName?:string;email?:string;city?:string;state?:string;zip?:string;role?:string;shifts?:string;desiredWage?:string;
  travelMiles?:number|null;profilePhotoUrl?:string|null;workStatus?:string;freshness?:string;
};
type Dashboard={resume?:{fileName:string;updatedAt?:string}|null;caregiver:Caregiver|null;invites?:Invite[];nearbyJobs?:NearbyJob[];applications?:Application[]};

const cardTone=(index:number)=>['job-card-sky','job-card-mint','job-card-lilac','job-card-peach'][index%4];
const pay=(min?:number|null,max?:number|null,period='hour')=>min||max?`$${min||'—'}–$${max||'—'}/${period==='year'?'yr':'hr'}`:'';
function when(iso?:string|null,timeZone?:string){
  if(!iso)return '';
  try{return new Intl.DateTimeFormat('en-US',{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZone:timeZone||undefined}).format(new Date(iso))}catch{return iso}
}
function inviteStatus(invite:Invite){
  if(invite.stage==='hired')return 'Hired';
  if(invite.interviewBooked)return 'Interview booked';
  if(invite.response==='interested')return 'You said interested';
  if(invite.response==='not_interested'||invite.stage==='rejected')return 'Closed';
  return 'Waiting on your answer';
}

export function CaregiverDashboard(){
  const auth=useCaregiverAuth();
  const [data,setData]=useState<Dashboard|null>(null);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState('');
  const [notice,setNotice]=useState('');
  const [hiring,setHiring]=useState(false);

  async function api<T>(path:string,init?:RequestInit):Promise<T>{
    const token=await auth.getIdToken();
    const res=await fetch(path,{...init,headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{}),...(init?.headers||{})}});
    const body=await res.json() as T&{error?:string};
    if(!res.ok)throw new Error(body.error||'Request failed');
    return body;
  }
  async function load(){
    try{const body=await api<Dashboard>('/api/me');setData(body);setError('');if(body.caregiver)rememberDashboard('me')}
    catch(e){setError(e instanceof Error?e.message:'Could not load your dashboard')}
  }
  useEffect(()=>{if(auth.isAuthenticated)void load()},[auth.isAuthenticated]);

  async function act(key:string,path:string,body:Record<string,unknown>,message:string){
    setBusy(key);setNotice('');
    try{await api(path,{method:'POST',body:JSON.stringify(body)});setNotice(message);await load()}
    catch(e){setNotice(e instanceof Error?e.message:'Something went wrong')}
    finally{setBusy('')}
  }

  async function savePreferences(e:FormEvent<HTMLFormElement>){
    e.preventDefault();
    const fd=new FormData(e.currentTarget);
    await act('prefs','/api/me/preferences',{zip:fd.get('zip'),shifts:fd.get('shifts'),desiredWage:fd.get('desiredWage'),travelMiles:Number(fd.get('travelMiles')||0)},'Preferences saved. Your matches were refreshed.');
  }

  if(auth.loading)return <div className="loading-screen">Loading CareJoys…</div>;

  if(!auth.isAuthenticated)return <Shell>
    <LoginForm next="/me" kicker="For caregivers" title="Your CareJoys jobs." google={auth.googleAvailable?()=>void auth.loginGoogle({next:'/me'}):undefined}/>
    <p className="login-alt">New to CareJoys? <a className="text-link" href="/caregiver-resume">Build your profile</a> first.</p>
  </Shell>;

  const header=<header className="app-header"><div className="app-wrap header-inner">
    <a className="brand" href="/">CareJoys</a>
    <nav className="app-nav">
      <a className="nav-link" href={jobsHubPath(usState(data?.caregiver?.state||'')||usState('MD')!)}>Jobs</a>
      {auth.roles?.employer&&<a className="nav-link" href="/app">Hiring workspace</a>}
      <button className="nav-button" onClick={auth.logout}>Sign out</button>
    </nav>
  </div></header>;

  if(error)return <div>{header}<main className="app-wrap app-content"><div className="notice">{error}</div></main></div>;
  if(!data)return <div className="loading-screen">Loading your matches…</div>;

  if(!data.caregiver)return <div>{header}<main className="app-wrap app-content">
    <div className="beta-hero">
      <div className="modal-kicker">Signed in as {auth.email}</div>
      <h1>Welcome to CareJoys.</h1>
      <p>Caregivers: upload your resume once and we’ll match you with local care jobs. Agencies and employers: describe the role and see matched local caregivers.</p>
      <div className="empty-actions">
        <a className="button" href="/caregiver-resume">I’m a caregiver</a>
        <button className="button secondary" onClick={()=>setHiring(true)}>I’m hiring caregivers</button>
      </div>
    </div>
    {hiring&&<IntakeModal kind="employer" lockedEmail={auth.email} onClose={()=>setHiring(false)}/>}
  </main></div>;

  const c=data.caregiver;
  const invites=data.invites||[];
  const open=invites.filter(i=>!i.response&&i.stage==='contacted');
  const looking=c.workStatus==='actively_looking';

  return <div>{header}
    <main className="app-wrap app-content">
      <div className="page-head page-head-row">
        <div>
          <h1>Hi {c.firstName||'there'}.</h1>
          <p>{[c.role,c.city,c.state].filter(Boolean).join(' · ')}</p>
        </div>
      </div>
      {notice&&<div className="alert-status workspace-alert" role="status">{notice}</div>}

      <section className="section-block">
        <div className="settings-card">
          <div className="modal-kicker">Availability</div>
          <h3 style={{margin:'4px 0 6px'}}>{looking?'You’re shown as looking for work.':'You’re not shown as looking right now.'}</h3>
          <div className="job-meta">{c.freshness}. Employers see recently confirmed caregivers first.</div>
          <div className="empty-actions">
            <button className="button" disabled={!!busy} onClick={()=>void act('avail','/api/me/availability',{workStatus:'actively_looking'},'Thanks! Your availability is confirmed for today.')}>{looking?'Still looking':'I’m looking for work'}</button>
            <button className="button secondary" disabled={!!busy} onClick={()=>void act('avail','/api/me/availability',{workStatus:'maybe_later'},'Got it. We’ll check back later.')}>Maybe later</button>
            <button className="button secondary" disabled={!!busy} onClick={()=>void act('avail','/api/me/availability',{workStatus:'not_looking'},'You’re hidden from employer search until you turn this back on.')}>Not looking</button>
          </div>
        </div>
      </section>

      <section className="section-block">
        <div className="section-heading"><h2>Employer invitations</h2><p>{open.length?`${open.length} waiting on your answer.`:'Employers who want to interview you will show up here.'}</p></div>
        {invites.length===0?<div className="empty"><strong>No invitations yet.</strong><div>Keep your availability current to rank higher in employer matches.</div></div>:
        <div className="job-list">{invites.map((invite,i)=><article className={'job-card '+cardTone(i)} key={invite.id}>
          <div className="job-card-main">
            <h3>{invite.title||invite.role||'Caregiver opening'}</h3>
            <div className="job-meta">{[invite.company,[invite.city,invite.state].filter(Boolean).join(', '),pay(invite.payMin,invite.payMax),invite.shifts].filter(Boolean).join(' · ')}</div>
            <div className="job-badges"><span className={invite.interviewBooked||invite.response==='interested'?'status applied':'status'}>{inviteStatus(invite)}</span>{invite.interviewAt&&<span className="badge">{when(invite.interviewAt)}</span>}</div>
            {invite.requirements&&<div className="job-card-cue">{invite.requirements}</div>}
            {!invite.response&&invite.stage==='contacted'&&<div className="empty-actions">
              <button className="button" disabled={!!busy} onClick={()=>void act(invite.id,`/api/me/invites/${encodeURIComponent(invite.id)}/respond`,{choice:'interested'},'Great! The employer has been told you’re interested.')}>I’m interested</button>
              <button className="button secondary" disabled={!!busy} onClick={()=>void act(invite.id,`/api/me/invites/${encodeURIComponent(invite.id)}/respond`,{choice:'not_interested'},'Thanks for letting them know.')}>Not interested</button>
            </div>}
            {invite.response==='interested'&&!invite.interviewBooked&&(invite.slots.length?<div className="empty-actions">
              {invite.slots.map(slot=><button key={slot.id} className="button secondary" disabled={!!busy} onClick={()=>void act(invite.id,`/api/me/invites/${encodeURIComponent(invite.id)}/book`,{slotId:slot.id},'Interview booked. Check your email for the calendar invite.')}>{when(slot.startsAt,slot.timezone)}</button>)}
            </div>:<div className="job-meta" style={{marginTop:12}}>The employer will add interview times soon.</div>)}
          </div>
        </article>)}</div>}
      </section>

      <section className="section-block">
        <div className="section-heading"><h2>Jobs near you</h2><p>Current caregiver openings within {c.travelMiles||25} miles of {c.zip||'your ZIP'}.</p></div>
        {(data.nearbyJobs||[]).length===0?<div className="empty"><strong>No nearby postings right now.</strong><div>Try widening your travel distance below.</div></div>:
        <div className="job-list">{(data.nearbyJobs||[]).map((job,i)=><a className={'job-card '+cardTone(i)} key={job.id} href={'/jobs/'+encodeURIComponent(job.id)}>
          <div className="job-card-main">
            <h3>{job.title}</h3>
            <div className="job-meta">{[job.employerName,[job.city,job.state].filter(Boolean).join(', '),job.distanceMiles!=null?job.distanceMiles+' mi':''].filter(Boolean).join(' · ')}</div>
            {pay(job.payMin,job.payMax,job.payPeriod)&&<div className="job-badges"><span className="badge">{pay(job.payMin,job.payMax,job.payPeriod)}</span></div>}
          </div>
        </a>)}</div>}
      </section>

      {(data.applications||[]).length>0&&<section className="section-block">
        <div className="section-heading"><h2>Jobs you applied to</h2></div>
        <div className="settings-card">{(data.applications||[]).map(a=><div key={a.jobId+a.at} className="job-meta">
          <a className="text-link" href={'/jobs/'+encodeURIComponent(a.jobId)}>{a.title}</a>{a.employerName?' · '+a.employerName:''} · {applicationStatus(a)} · {when(a.at)}
          {!a.employerOnCareJoys&&!a.submittedOnEmployerSite&&a.applicationUrl&&<> · <a className="text-link" href={a.applicationUrl} target="_blank" rel="noreferrer nofollow">Finish on {a.employerName||'the employer'}’s site ↗</a></>}
        </div>)}</div>
      </section>}

      <section className="section-block">
        <div className="section-heading"><h2>Your resume</h2><p>CareJoys attaches it when it applies for you. Only you and the employers you apply to see it.</p></div>
        <div className="settings-card resume-card">
          {data.resume?<span><a className="text-link" href="/api/me/resume">{data.resume.fileName}</a>{data.resume.updatedAt?' · added '+when(data.resume.updatedAt):''}</span>:<span>No resume file yet.</span>}
          <ResumeFileInput getToken={auth.getIdToken} label={data.resume?'Replace resume':'Add your resume'} onSaved={()=>{setNotice('Resume saved.');void load()}}/>
        </div>
      </section>

      <section className="section-block">
        <div className="section-heading"><h2>Match preferences</h2><p>Used to find openings within your commute.</p></div>
        <form className="settings-card intake-form" onSubmit={savePreferences} key={c.zip+String(c.travelMiles)}>
          <div className="form-grid">
            <label>Home ZIP<input name="zip" defaultValue={c.zip||''} inputMode="numeric" required /></label>
            <label>Travel distance<select name="travelMiles" defaultValue={String(c.travelMiles||25)}>{[5,10,15,25,35,50].map(m=><option key={m} value={m}>{m} miles</option>)}</select></label>
          </div>
          <div className="form-grid">
            <label>Preferred shifts<input name="shifts" defaultValue={c.shifts||''} placeholder="Days, nights, weekends" /></label>
            <label>Desired pay<input name="desiredWage" defaultValue={c.desiredWage||''} placeholder="$20–24/hr" /></label>
          </div>
          <button className="button" disabled={!!busy}>{busy==='prefs'?'Saving…':'Save preferences'}</button>
        </form>
      </section>
    </main>
  </div>;
}
