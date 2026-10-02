import { useEffect, useState } from 'react';
import { useCaregiverAuth } from './caregiverAuth';
import { LoginForm, Shell } from './LoginPage';
import { ResumeFileInput } from './ApplyForMe';
import { jobsHubPath, usState } from './usStates';
import { payLabel, tidyTitle } from './jobFormat';
import { IntakeModal } from './IntakeModal';
import { rememberDashboard } from './dashboardHome';
import { AccountMenu } from './AccountLink';
import { CaregiverProfileEditor, PROFILE_ITEMS, profileGaps, type CaregiverProfileData } from './CaregiverProfile';
import { TalentCard, type TalentCandidate } from './TalentCard';
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
type Caregiver=CaregiverProfileData&{
  id:string;email?:string;profilePhotoUrl?:string|null;freshness?:string;
};
type Dashboard={resume?:{fileName:string;updatedAt?:string}|null;caregiver:Caregiver|null;invites?:Invite[];nearbyJobs?:NearbyJob[];applications?:Application[]};

const cardTone=(index:number)=>['job-card-sky','job-card-mint','job-card-lilac','job-card-peach'][index%4];
const pay=(min?:number|null,max?:number|null,period='hour')=>payLabel({payMin:min,payMax:max,payPeriod:period});
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

  if(auth.loading)return <div className="loading-screen">Loading CareJoys…</div>;

  if(!auth.isAuthenticated)return <Shell>
    <LoginForm next="/dashboard" kicker="For caregivers" title="Your CareJoys jobs." google={auth.googleAvailable?()=>void auth.loginGoogle({next:'/dashboard'}):undefined}/>
    <p className="login-alt">New to CareJoys? <a className="text-link" href="/caregiver-resume">Build your profile</a> first.</p>
  </Shell>;

  const header=<header className="app-header"><div className="app-wrap header-inner">
    <a className="brand" href="/">CareJoys</a>
    <nav className="app-nav">
      <a className="nav-link" href={jobsHubPath(usState(data?.caregiver?.state||'')||usState('MD')!)}>Jobs</a>
      <AccountMenu/>
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
  const gaps=profileGaps(c,!!data.resume);
  const editing=window.location.pathname==='/dashboard/profile';
  const previewing=window.location.pathname==='/dashboard/profile/preview';

  if(previewing)return <div>{header}
    <main className="app-wrap app-content profile-page">
      <EmployerViewPreview/>
    </main>
  </div>;

  if(editing)return <div>{header}
    <main className="app-wrap app-content profile-page">
      <div className="page-head"><h1>Your profile</h1><p>Employers see this when CareJoys matches you. The more you fill in, the better your matches.</p></div>
      <CaregiverProfileEditor caregiver={c} save={async body=>{await api('/api/me/profile',{method:'POST',body:JSON.stringify(body)});window.location.assign('/dashboard?saved=1')}}/>
    </main>
  </div>;

  return <div>{header}
    <main className="app-wrap app-content">
      <div className="page-head page-head-row">
        <div>
          <h1>Hi {c.firstName||'there'}.</h1>
          <p>{[c.role,c.city,c.state].filter(Boolean).join(' · ')}</p>
        </div>
        <div className="header-action"><a className="button secondary" href="/dashboard/profile/preview">View my profile</a><a className="button secondary" href="/dashboard/profile">Edit my profile</a></div>
      </div>
      {(notice||new URLSearchParams(window.location.search).get('saved'))&&<div className="alert-status workspace-alert" role="status">{notice||'Profile saved. Your matches were refreshed.'}</div>}

      {invites.length>0&&<section className="section-block invite-banner">
        <div className="section-heading"><h2>{open.length?'An employer wants to interview you':'Your employer invitations'}</h2><p>{open.length?`${open.length} waiting on your answer.`:'Interviews and replies from employers who reached out to you.'}</p></div>
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
        </article>)}</div>
      </section>}


      <section className="section-block">
        <div className="section-heading"><h2>Jobs near you</h2><p>Current caregiver openings within {c.travelMiles||25} miles of {c.zip||'your ZIP'}.</p></div>
        {(data.nearbyJobs||[]).length===0?<div className="empty"><strong>No nearby postings right now.</strong><div>Try a wider travel distance in <a className="text-link" href="/dashboard/profile">your profile</a>.</div></div>:
        <div className="job-list">{(data.nearbyJobs||[]).map((job,i)=><a className={'job-card '+cardTone(i)} key={job.id} href={'/jobs/'+encodeURIComponent(job.id)}>
          <div className="job-card-main">
            <h3>{tidyTitle(job.title)}</h3>
            <div className="job-meta">{[job.employerName,[job.city,job.state].filter(Boolean).join(', '),job.distanceMiles!=null?job.distanceMiles+' mi':''].filter(Boolean).join(' · ')}</div>
            {pay(job.payMin,job.payMax,job.payPeriod)&&<div className="job-badges"><span className="badge">{pay(job.payMin,job.payMax,job.payPeriod)}</span></div>}
          </div>
        </a>)}</div>}
      </section>

      {c.workStatus==='not_looking'||c.workStatus==='maybe_later'
        ?<section className="section-block"><div className="settings-card profile-checklist">
          <div><div className="modal-kicker">Hidden from employers</div><h3>You’re not shown as looking for work.</h3><div className="job-meta">Turn it back on whenever you’re ready.</div></div>
          <button className="button" disabled={!!busy} onClick={()=>void act('avail','/api/me/availability',{workStatus:'actively_looking'},'You’re shown to employers again.')}>I’m looking again</button>
        </div></section>
        :gaps.length>0&&<section className="section-block"><div className="settings-card profile-checklist">
          <div>
            <div className="modal-kicker">Your profile is {Math.round(100*(PROFILE_ITEMS-gaps.length)/PROFILE_ITEMS)}% complete</div>
            <h3>Finish your profile to get better matches.</h3>
            <div className="profile-progress"><span style={{width:Math.round(100*(PROFILE_ITEMS-gaps.length)/PROFILE_ITEMS)+'%'}}/></div>
            <ul>{gaps.slice(0,4).map(g=><li key={g.key}>{g.label}</li>)}{gaps.length>4&&<li>and {gaps.length-4} more</li>}</ul>
          </div>
          <a className="button" href="/dashboard/profile">Finish my profile</a>
        </div></section>}


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

    </main>
  </div>;
}

/** "View my profile": the caregiver's card exactly as employers see it in search. Private, never a public page. */
function EmployerViewPreview(){
  const [view,setView]=useState<{visible:boolean;candidate:TalentCandidate}|null>(null);
  const [error,setError]=useState('');
  useEffect(()=>{
    fetch('/api/me/employer-view',{credentials:'include'}).then(async r=>{
      const body=await r.json().catch(()=>({}));
      if(!r.ok)throw new Error(body.error||'Could not load your profile.');
      setView(body);
    }).catch(e=>setError(e instanceof Error?e.message:'Could not load your profile.'));
  },[]);
  return <>
    <div className="page-head"><h1>How employers see you</h1><p>This is your card when an approved employer searches CareJoys or you’re matched to their opening. Your profile is not a public web page and doesn’t appear on Google.</p></div>
    {error&&<div className="notice">{error}</div>}
    {!view&&!error&&<div className="empty">Loading…</div>}
    {view&&<>
      {!view.visible&&<div className="notice">You’re hidden from employer search because your profile says you’re not looking for work. Turn on “Show me to employers as looking” in <a className="text-link" href="/dashboard/profile">your profile</a> to appear again.</div>}
      <div className="job-list profile-preview"><TalentCard candidate={view.candidate} tone="job-card-sky"/></div>
      <section className="settings-card profile-visibility">
        <h3>Who sees what</h3>
        <p><strong>Employers searching CareJoys</strong> see the card above: your first name and last initial, photo, role, city, shifts, pay and certifications. They can’t see your phone, email or resume.</p>
        <p><strong>Employers you apply to or say yes to</strong> also get your full name, phone, email and resume, so they can reach you.</p>
      </section>
    </>}
    <div className="profile-save-bar profile-preview-actions"><a className="button" href="/dashboard/profile">Edit my profile</a><a className="text-link" href="/dashboard">Back to dashboard</a></div>
  </>;
}
