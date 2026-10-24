import { useEffect, useState } from 'react';
import { useCaregiverAuth } from './caregiverAuth';
import { LoginForm, Shell } from './LoginPage';
import { ResumeFileInput } from './ApplyForMe';
import { jobsHubPath, usState } from './usStates';
import { payLabel, tidyTitle } from './jobFormat';
import { rememberDashboard } from './dashboardHome';
import { AccountMenu, CloseAccountSide } from './AccountLink';
import { ProfilePhotoSection } from './ProfilePhotoSection';
import { IntroVideoSection } from './IntroVideoSection';
import { CaregiverProfileEditor, PROFILE_ITEMS, profileGaps, type CaregiverProfileData } from './CaregiverProfile';
import { TalentCard, type TalentCandidate } from './TalentCard';
import { CaregiverCard, type PublicCaregiverCard } from './CaregiverDirectory';
import { CaregiverInviteControls, type HiddenAgency } from './CaregiverInviteControls';
import { lockedYesText } from './caregiverProtectionRules';
import { JobList, applyWhere, type PublicCaregiverJob } from './CaregiverJobsHub';
import './workspace.css';

type Slot={id:string;startsAt:string;durationMinutes:number;timezone:string};
type Invite={
  id:string;stage:string;response?:string|null;contactedAt?:string;interviewAt?:string|null;interviewBooked:boolean;
  company?:string;title?:string;role?:string;city?:string;state?:string;payMin?:number|null;payMax?:number|null;shifts?:string;requirements?:string;
  locked?:boolean;slots:Slot[];
};
type NearbyJob={id:string;title:string;employerName?:string;city?:string;state?:string;payMin?:number|null;payMax?:number|null;payPeriod?:string;employerOnCareJoys?:boolean;applyForMe?:boolean;distanceMiles?:number|null};
type Application={jobId:string;title:string;employerName?:string;at:string;applicationUrl?:string;appliedOnCareJoys:boolean;openedEmployerSite:boolean;employerOnCareJoys:boolean;submittedOnEmployerSite?:boolean};

function applicationStatus(a:Application){
  if(a.submittedOnEmployerSite)return 'CareJoys applied for you on the employer’s site';
  if(a.appliedOnCareJoys&&a.employerOnCareJoys)return 'Sent to the employer through CareJoys';
  return 'Sent to the employer through CareJoys';
}
type Caregiver=CaregiverProfileData&{
  id:string;email?:string;profilePhotoUrl?:string|null;freshness?:string;locationCheck?:{zipPlace:string}|null;invitesPausedUntil?:string|null;autoApply?:boolean;
};
type Dashboard={resume?:{fileName:string;updatedAt?:string}|null;caregiver:Caregiver|null;invites?:Invite[];nearbyJobs?:NearbyJob[];applications?:Application[];hiddenAgencies?:HiddenAgency[]};

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
  // The hide-profile box shows the new choice while it saves, instead of springing back until the reload.
  const [hideChoice,setHideChoice]=useState<boolean|null>(null);
  const [notice,setNotice]=useState('');
  const [autoChoice,setAutoChoice]=useState<boolean|null>(null);
  // The public directory listing: its own yes, separate from being findable by signed-in employers.
  type Listing={listed:boolean;optedIn:boolean;photo:boolean;hasPhoto:boolean;reasons:string[];card:PublicCaregiverCard;pageUrl:string;profileUrl:string};
  const [listing,setListing]=useState<Listing|null>(null);
  useEffect(()=>{if(!auth.isAuthenticated)return;fetch('/api/me/public-listing').then(r=>r.json()).then((r:Listing&{ok?:boolean})=>{if(r.ok)setListing(r)}).catch(()=>{})},[auth.isAuthenticated]);
  async function updateListing(change:{listed?:boolean;photo?:boolean}){
    setBusy('listing');
    try{const r=await api<Listing>('/api/me/public-listing',{method:'POST',body:JSON.stringify(change)});setListing(r);
      setNotice(change.listed===false?'Your public listing is off.':change.listed===true?(r.listed?'You’re listed. Employers near you can find you.':'Saved. '+(r.reasons[0]||'')):change.photo?'Your photo is shown on your listing.':'Your photo is off your listing.');
    }catch(e){setNotice(e instanceof Error?e.message:'Could not save.')}finally{setBusy('')}
  }
  const [alerts,setAlerts]=useState<boolean|null>(null);
  useEffect(()=>{if(!auth.isAuthenticated)return;fetch('/api/me/job-alerts').then(r=>r.json()).then((r:{emailEnabled?:boolean})=>setAlerts(!!r.emailEnabled)).catch(()=>setAlerts(null))},[auth.isAuthenticated]);
  async function updateAlerts(enabled:boolean){setBusy('alerts');try{await api('/api/me/job-alerts',{method:'POST',body:JSON.stringify({emailEnabled:enabled})});setAlerts(enabled);setNotice(enabled?'Weekly job emails enabled.':'Weekly job emails turned off.')}catch(e){setNotice(e instanceof Error?e.message:'Could not update alerts.')}finally{setBusy('')}}

  async function api<T>(path:string,init?:RequestInit):Promise<T>{
    const res=await fetch(path,{...init,headers:{'content-type':'application/json',...(init?.headers||{})}});
    const body=await res.json() as T&{error?:string};
    if(!res.ok)throw new Error(body.error||'Request failed');
    return body;
  }
  async function load(){
    try{const body=await api<Dashboard>('/api/me');setData(body);setError('');if(body.caregiver)rememberDashboard('me')}
    catch(e){setError(e instanceof Error?e.message:'Could not load your dashboard')}
  }
  useEffect(()=>{if(auth.isAuthenticated)void load()},[auth.isAuthenticated]);
  // Applications moved from a dashboard section to their own page; old links still land there.
  useEffect(()=>{if(window.location.pathname==='/dashboard'&&window.location.hash==='#applications')window.location.replace('/dashboard/applications')},[]);

  async function act(key:string,path:string,body:Record<string,unknown>,message:string){
    setBusy(key);setNotice('');
    try{const r=await api<{message?:string}>(path,{method:'POST',body:JSON.stringify(body)});setNotice(r.message||message);await load()}
    catch(e){setNotice(e instanceof Error?e.message:'Something went wrong')}
    finally{setBusy('')}
  }

  async function apply(job:NearbyJob){
    setBusy('apply:'+job.id);setNotice('');
    try{
      const r=await api<{employerOnCareJoys:boolean;employerName?:string}>('/api/me/apply/'+encodeURIComponent(job.id),{method:'POST',body:'{}'});
      const who=r.employerName||job.employerName||'The employer';
      setNotice(`Applied. ${who} gets your profile and resume in CareJoys.`);
      await load();
    }catch(e){setNotice(e instanceof Error?e.message:'Could not send your application.')}
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
      <a className="nav-link" href={data?.caregiver?'/dashboard#matches':jobsHubPath(usState(data?.caregiver?.state||'')||usState('MD')!)}>Find jobs</a>
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
        {/* An agency already has a workspace: open it rather than starting a second hiring setup. */}
        {auth.roles?.employer
          ?<a className="button secondary" href="/hiring">Open your hiring workspace</a>
          :<a className="button secondary" href="/hire-caregivers">I’m hiring caregivers</a>}
      </div>
    </div>
  </main></div>;

  const c=data.caregiver;
  const invites=data.invites||[];
  const open=invites.filter(i=>!i.response&&i.stage==='contacted');
  const gaps=profileGaps(c,!!data.resume);
  const pctComplete=Math.round(100*(PROFILE_ITEMS-gaps.length)/PROFILE_ITEMS);
  const editing=window.location.pathname==='/dashboard/profile';
  const previewing=window.location.pathname==='/dashboard/profile/preview';
  const settings=window.location.pathname==='/dashboard/settings';
  const allJobs=window.location.pathname==='/dashboard/jobs';
  const applicationsPage=window.location.pathname==='/dashboard/applications';

  const sections=[
    {id:'matches',label:'My job matches'},
    ...(invites.length?[{id:'interviews',label:'Interviews'}]:[]),
  ];
  // The profile pages keep the same side nav; its section links lead back to the dashboard.
  if(previewing)return <div>{header}
    <main className="app-wrap app-content dash-layout">
      <DashNav sections={sections} page="profile"/>
      <div className="dash-main-col profile-page">
        <EmployerViewPreview gaps={gaps} pctComplete={pctComplete}/>
      </div>
    </main>
  </div>;

  if(applicationsPage)return <div>{header}
    <main className="app-wrap app-content dash-layout">
      <DashNav sections={sections} page="applications"/>
      <div className="dash-main-col">
        <div className="page-head"><h1>Applications</h1></div>
        {(data.applications||[]).length===0
          ?<div className="empty"><strong>No applications yet.</strong><div>Jobs you apply to or save show up here. <a className="text-link" href="/dashboard/jobs">Find jobs</a></div></div>
          :<div className="settings-card">{(data.applications||[]).map(a=><div key={a.jobId+a.at} className="job-meta">
            <a className="text-link" href={'/jobs/'+encodeURIComponent(a.jobId)}>{a.title}</a>{a.employerName?' · '+a.employerName:''} · {applicationStatus(a)} · {when(a.at)}
            {!a.employerOnCareJoys&&!a.submittedOnEmployerSite&&a.applicationUrl&&<> · <a className="text-link" href={a.applicationUrl} target="_blank" rel="noreferrer nofollow">Finish on {a.employerName||'the employer'}’s site ↗</a></>}
          </div>)}</div>}
      </div>
    </main>
  </div>;

  if(allJobs)return <div>{header}
    <main className="app-wrap app-content dash-layout">
      <DashNav sections={sections} page="jobs"/>
      <div className="dash-main-col"><AllJobs zip={c.zip||''} state={c.state||''} miles={c.travelMiles||25}/></div>
    </main>
  </div>;

  const hiddenProfile=hideChoice??(c.workStatus==='not_looking'||c.workStatus==='maybe_later');
  if(settings)return <div>{header}
    <main className="app-wrap app-content dash-layout">
      <DashNav sections={sections} page="settings"/>
      <div className="dash-main-col">
        <div className="page-head"><h1>Settings</h1></div>
        {notice&&<div className="notice" role="status">{notice}</div>}
        <section className="section-block" id="visibility">
          <div className="section-heading"><h2>Profile visibility</h2><p>{hiddenProfile?'Employers can’t find you or invite you right now.':'Employers can find you and invite you to jobs.'}</p></div>
          <label className="check-row"><input type="checkbox" checked={hiddenProfile} disabled={!!busy} onChange={e=>{const hide=e.target.checked;setHideChoice(hide);void act('avail','/api/me/availability',{workStatus:hide?'not_looking':'actively_looking'},hide?'Your profile is hidden from employers.':'You’re shown to employers again.').finally(()=>setHideChoice(null))}} /><span>Hide my profile from employers</span></label>
        </section>
        <section className="section-block" id="public-listing">
          <div className="section-heading"><h2>Public listing</h2><p>{listing?.listed?<>You’re listed on <a className="text-link" href={listing.pageUrl}>the caregiver directory</a>, so employers near you can find you without signing in.</>:'A public card lets employers near you find you. It shows your first name, role, area, pay floor and availability. Never your contact details, last name or exact ZIP.'}</p></div>
          {listing&&<>
            <label className="check-row"><input type="checkbox" checked={listing.optedIn} disabled={!!busy} onChange={e=>void updateListing({listed:e.target.checked})} /><span>List my profile so local employers can find me</span></label>
            {listing.optedIn&&listing.hasPhoto&&<label className="check-row"><input type="checkbox" checked={listing.photo} disabled={!!busy} onChange={e=>void updateListing({photo:e.target.checked})} /><span>Show my photo on the listing</span></label>}
            {listing.optedIn&&!listing.listed&&listing.reasons.length>0&&<div className="notice">Not shown yet: {listing.reasons.join(' ')}</div>}
            {listing.optedIn&&<details className="listing-preview"><summary>Preview my public card</summary><div className="jobs caregiver-public-job-list"><CaregiverCard card={listing.card} invite={false} full/></div></details>}
          </>}
        </section>
        <section className="section-block" id="auto-apply">
          <div className="section-heading"><h2>Auto-apply</h2><p>CareJoys applies to your best new matches for you. If an employer’s form asks something only you can answer, we skip that job.</p></div>
          <label className="check-row"><input type="checkbox" checked={autoChoice??!!c.autoApply} disabled={!!busy||!data.resume} onChange={e=>{const on=e.target.checked;setAutoChoice(on);void act('auto','/api/me/auto-apply',{enabled:on},on?'Auto-apply is on. We’ll apply to up to 3 of your best new matches a day.':'Auto-apply is off.').finally(()=>setAutoChoice(null))}} /><span>Apply to my best new matches for me (up to 3 a day)</span></label>
          {!data.resume&&<p className="muted">Add your resume on <a className="text-link" href="/dashboard/profile">your profile</a> to turn this on.</p>}
        </section>
        <section className="section-block" id="emails">
          <div className="section-heading"><h2>Weekly job email</h2><p>New jobs that match you, once a week.</p></div>
          <label className="check-row"><input type="checkbox" checked={alerts===true} disabled={alerts===null||!!busy} onChange={e=>void updateAlerts(e.target.checked)} /><span>Email me weekly job matches</span></label>
        </section>
        <section className="section-block" id="privacy">
          <div className="section-heading"><h2>Who can invite you</h2><p>Agencies only get your contact details after you say yes.</p></div>
          <CaregiverInviteControls pausedUntil={c.invitesPausedUntil} hidden={data.hiddenAgencies||[]} onChange={setNotice}/>
        </section>
      </div>
    </main>
  </div>;

  if(editing)return <div>{header}
    <main className="app-wrap app-content dash-layout">
      <DashNav sections={sections} page="profile"/>
      <div className="dash-main-col profile-page">
        <div className="page-head"><h1>Your profile</h1><p>Employers see this when CareJoys matches you. The more you fill in, the better your matches.</p></div>
        <CaregiverProfileEditor caregiver={c} save={async body=>{await api('/api/me/profile',{method:'POST',body:JSON.stringify(body)});window.location.assign('/dashboard?saved=1')}}/>
        <section className="section-block profile-files" id="resume">
          <div className="section-heading"><div><h2>Your files</h2><p>Each one saves on its own; no need to press Save.</p></div></div>
          <section className="settings-card profile-section">
            <h3>Your resume</h3>
            <p className="job-meta">CareJoys attaches it when it applies for you. Only you and the employers you apply to see it.</p>
            <div className="resume-card">
              {data.resume?<span><a className="text-link" href="/api/me/resume">{data.resume.fileName}</a>{data.resume.updatedAt?' · added '+when(data.resume.updatedAt):''}</span>:<span>No resume file yet.</span>}
              <ResumeFileInput label={data.resume?'Replace resume':'Add your resume'} onSaved={()=>{setNotice('Resume saved.');void load()}}/>
            </div>
            {notice&&<div className="notice" role="status">{notice}</div>}
          </section>
          <ProfilePhotoSection hasPhoto={!!c.profilePhotoUrl}/>
          <IntroVideoSection/>
        </section>
        <CloseAccountSide side="caregiver"/>
      </div>
    </main>
  </div>;

  return <div>{header}
    <main className="app-wrap app-content dash-layout">
      <DashNav sections={sections}/>
      <div className="dash-main-col">
      <div className="page-head page-head-row">
        <div>
          <h1>Hi {c.firstName||'there'}.</h1>
          <p>{[c.role,c.city,c.state].filter(Boolean).join(' · ')}</p>
        </div>
        <a className="profile-pill" href="/dashboard/profile">
          <span className="profile-pill-ring" style={{['--pct' as string]:pctComplete+'%'}} aria-hidden="true"/>
          Edit profile<span className="profile-pill-pct">{pctComplete}% complete</span>
        </a>
      </div>
      {(notice||new URLSearchParams(window.location.search).get('saved'))&&<div className="alert-status workspace-alert" role="status">{notice||'Profile saved. Your matches were refreshed.'}</div>}

      {c.locationCheck&&<div className="settings-card profile-checklist location-check" role="status">
        <div>
          <div className="modal-kicker">Check your location</div>
          <h3>Your ZIP {c.zip}{c.locationCheck.zipPlace?' is in '+c.locationCheck.zipPlace:''}, but your profile says {[c.city,c.state].filter(Boolean).join(', ')}.</h3>
          <div className="job-meta">Employers near you can’t see how far away you are until these match. Confirm your home ZIP and we’ll update the rest.</div>
        </div>
        <a className="button" href="/dashboard/profile">Fix my location</a>
      </div>}

      {invites.length>0&&<section className="section-block invite-banner" id="interviews">
        <div className="section-heading"><h2>{open.length?'An employer wants to interview you':'Your employer invitations'}</h2><p>{open.length?`${open.length} waiting on your answer.`:'Interviews and replies from employers who reached out to you.'}</p></div>
        <div className="job-list">{invites.map((invite,i)=><article className={'job-card '+cardTone(i)} key={invite.id}>
          <div className="job-card-main">
            <h3>{invite.title||invite.role||'Caregiver opening'}</h3>
            <div className="job-meta">{[invite.company,[invite.city,invite.state].filter(Boolean).join(', '),pay(invite.payMin,invite.payMax),invite.shifts].filter(Boolean).join(' · ')}</div>
            <div className="job-badges"><span className={invite.interviewBooked||invite.response==='interested'?'status applied':'status'}>{inviteStatus(invite)}</span>{invite.interviewAt&&<span className="badge">{when(invite.interviewAt)}</span>}</div>
            {invite.requirements&&<div className="job-card-cue">{invite.requirements}</div>}
            {!invite.response&&invite.stage==='contacted'&&<p className="job-meta">If you choose interested, this employer can see your contact email and follow up directly. Interview scheduling is optional.</p>}
            {!invite.response&&invite.stage==='contacted'&&<div className="empty-actions">
              <button className="button" disabled={!!busy} onClick={()=>void act(invite.id,`/api/me/invites/${encodeURIComponent(invite.id)}/respond`,{choice:'interested'},'Great! The employer has been told you’re interested.')}>I’m interested</button>
              <button className="button secondary" disabled={!!busy} onClick={()=>void act(invite.id,`/api/me/invites/${encodeURIComponent(invite.id)}/respond`,{choice:'not_interested'},'Thanks for letting them know.')}>Not interested</button>
            </div>}
            {invite.response==='interested'&&!invite.interviewBooked&&invite.locked&&<div className="job-meta" style={{marginTop:12}}>{lockedYesText(invite.company)}</div>}
            {invite.response==='interested'&&!invite.interviewBooked&&!invite.locked&&(invite.slots.length?<div className="empty-actions">
              {invite.slots.map(slot=><button key={slot.id} className="button secondary" disabled={!!busy} onClick={()=>void act(invite.id,`/api/me/invites/${encodeURIComponent(invite.id)}/book`,{slotId:slot.id},'Interview booked. Check your email for the calendar invite.')}>{when(slot.startsAt,slot.timezone)}</button>)}
            </div>:<div className="job-meta" style={{marginTop:12}}>The employer will add interview times soon.</div>)}
          </div>
        </article>)}</div>
      </section>}


      <section className="section-block" id="matches">
        <div className="section-heading"><h2>Best matches near you</h2><p>Ranked by your credentials, pay and distance, within {c.travelMiles||25} miles of {c.zip||'your ZIP'}.</p></div>
        {(data.nearbyJobs||[]).length===0?<div className="empty"><strong>No nearby postings right now.</strong><div>Try a wider travel distance in <a className="text-link" href="/dashboard/profile">your profile</a>.</div></div>:
        <div className="job-list">{(data.nearbyJobs||[]).map((job,i)=>{
          const applied=(data.applications||[]).find(a=>a.jobId===job.id&&(a.appliedOnCareJoys||a.submittedOnEmployerSite));
          const href='/jobs/'+encodeURIComponent(job.id);
          return <article className={'job-card job-card-apply '+cardTone(i)} key={job.id}>
            <div className="job-card-main">
              <h3><a className="job-title-link" href={href}>{job.title}</a></h3>
              <div className="job-meta">{[job.employerName,[job.city,job.state].filter(Boolean).join(', '),job.distanceMiles!=null?job.distanceMiles+' mi':''].filter(Boolean).join(' · ')}</div>
              {pay(job.payMin,job.payMax,job.payPeriod)&&<div className="job-badges"><span className="badge">{pay(job.payMin,job.payMax,job.payPeriod)}</span></div>}
            </div>
            <div className="job-card-actions">
              {!applied?(job.employerOnCareJoys
                ?<button className="button" disabled={!!busy} onClick={()=>void apply(job)}>{busy==='apply:'+job.id?'Applying…':'Apply'}</button>
                :<a className="button" href={href}>View job</a>)
              :<span className="status applied">Applied</span>}
              {!applied&&<span className="apply-where">{applyWhere(job)}</span>}
            </div>
          </article>})}</div>}
        <p className="job-meta browse-all-jobs"><a className="text-link" href="/dashboard/jobs">Browse all jobs near you</a></p>
      </section>

      {c.workStatus==='not_looking'||c.workStatus==='maybe_later'
        ?<section className="section-block"><div className="settings-card profile-checklist">
          <div><div className="modal-kicker">Hidden from employers</div><h3>You’re not shown as looking for work.</h3><div className="job-meta">Turn it back on whenever you’re ready.</div></div>
          <button className="button" disabled={!!busy} onClick={()=>void act('avail','/api/me/availability',{workStatus:'actively_looking'},'You’re shown to employers again.')}>I’m looking again</button>
        </div></section>
        :gaps.length===0?<section className="section-block"><div className="settings-card profile-checklist">
          <div>
            <div className="modal-kicker">Your profile is complete</div>
            <h3>You’re all set for employer matches.</h3>
            <div className="profile-progress"><span style={{width:'100%'}}/></div>
            <div className="job-meta">Keep your availability and pay current so your matches stay accurate.</div>
          </div>
          <a className="button" href="/dashboard/profile">Edit my profile</a>
        </div></section>
        :<section className="section-block"><div className="settings-card profile-checklist">
          <div>
            <div className="modal-kicker">Your profile is {pctComplete}% complete</div>
            <h3>Finish your profile to get better matches.</h3>
            <div className="profile-progress"><span style={{width:pctComplete+'%'}}/></div>
            <ul>{gaps.slice(0,4).map(g=><li key={g.key}>{g.label}</li>)}{gaps.length>4&&<li>and {gaps.length-4} more</li>}</ul>
          </div>
          <a className="button" href="/dashboard/profile">Finish my profile</a>
        </div></section>}



      </div>
    </main>
  </div>;
}

/** Left side nav on desktop, a scrolling tab row on phones. Links jump to sections; the one in view is highlighted. */
function DashNav({sections,page='dashboard'}:{sections:{id:string;label:string}[];page?:'dashboard'|'profile'|'settings'|'jobs'|'applications'}){
  const [active,setActive]=useState(page!=='dashboard'?'':sections[0]?.id||'');
  useEffect(()=>{
    if(page!=='dashboard')return;
    const els=sections.map(s=>document.getElementById(s.id)).filter((e):e is HTMLElement=>!!e);
    if(!els.length||typeof IntersectionObserver==='undefined')return;
    const io=new IntersectionObserver(entries=>{
      const top=entries.filter(e=>e.isIntersecting).sort((a,b)=>a.boundingClientRect.top-b.boundingClientRect.top)[0];
      if(top)setActive(top.target.id);
    },{rootMargin:'-30% 0px -60% 0px'});
    els.forEach(e=>io.observe(e));
    return ()=>io.disconnect();
  },[sections.map(s=>s.id).join()]);
  return <nav className="dash-sidenav" aria-label="Dashboard sections">
    <div className="dash-sidenav-label">Dashboard</div>
    {sections.map(s=><a key={s.id} href={(page==='dashboard'?'':'/dashboard')+'#'+s.id} className={active===s.id?'active':undefined} aria-current={active===s.id?'true':undefined} onClick={()=>setActive(s.id)}>{s.label}</a>)}
    <a href="/dashboard/applications" className={page==='applications'?'active':undefined} aria-current={page==='applications'?'page':undefined}>Applications</a>
    <a href="/dashboard/profile" className={page==='profile'?'active':undefined} aria-current={page==='profile'?'page':undefined}>Profile</a>
    <a href="/dashboard/settings" className={page==='settings'?'active':undefined} aria-current={page==='settings'?'page':undefined}>Settings</a>
  </nav>;
}

// Short names for missing profile items, for the one-line status on the preview card.
const GAP_SHORT:Record<string,string>={availability:'shifts',start:'start date',hours:'hours',certs:'certifications',license:'license number',skills:'skills',transport:'transportation',pay:'pay',phone:'mobile number',resume:'resume'};

/** "View my profile": the caregiver's card exactly as employers see it in search. Private, never a public page. */
function EmployerViewPreview({gaps,pctComplete}:{gaps:{key:string;label:string}[];pctComplete:number}){
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
    <div className="page-head"><h1>How employers see you</h1><p>This is your profile when an approved employer searches CareJoys or you’re matched to their opening. Your profile is not a public web page and doesn’t appear on Google.</p></div>
    {error&&<div className="notice">{error}</div>}
    {!view&&!error&&<div className="empty">Loading…</div>}
    {view&&<>
      {!view.visible&&<div className="notice">You’re hidden from employer search because your profile says you’re not looking for work. Turn on “Show me to employers as looking” in <a className="text-link" href="/dashboard/profile">your profile</a> to appear again.</div>}
      <div className="job-list profile-preview"><TalentCard candidate={view.candidate} tone="job-card-sky" expanded status={<>
        <strong>{pctComplete}% complete</strong>
        {gaps.length>0&&<span>Missing: {gaps.map(g=>GAP_SHORT[g.key]||g.label).join(', ')}</span>}
      </>}/></div>

      <section className="settings-card profile-visibility">
        <h3>Who sees what</h3>
        <p>Employers searching CareJoys see your profile above, with your first name and last initial. They can’t see your phone, email, license number or resume.</p>
        <p>Employers you apply to or say yes to also get your full name, phone, email and resume, so they can reach you.</p>
      </section>
    </>}
    <div className="profile-save-bar profile-preview-actions"><a className="button" href="/dashboard/profile">Edit my profile</a><a className="text-link" href="/dashboard">Back to dashboard</a></div>
  </>;
}

const JOB_ROLES=['CNA','GNA','HHA','PCA','DSP','Caregiver'];
const JOB_MILES=[10,25,50,100];

/** Every current job near the caregiver, nearest first; each one opens in the side panel (JobDrawer). */
function AllJobs({zip:homeZip,state,miles:homeMiles}:{zip:string;state:string;miles:number}){
  const [zip,setZip]=useState(homeZip);
  const [miles,setMiles]=useState(JOB_MILES.includes(homeMiles)?homeMiles:25);
  const [role,setRole]=useState('');
  const [jobs,setJobs]=useState<PublicCaregiverJob[]|null>(null);
  useEffect(()=>{
    if(!/^\d{5}$/.test(zip))return;
    setJobs(null);
    const p=new URLSearchParams({zip,radius:String(miles),limit:'100',state:state||'ALL'});
    if(role)p.set('role',role);
    fetch('/api/public/caregiver-jobs?'+p.toString()).then(r=>r.json())
      .then((d:any)=>setJobs((Array.isArray(d?.jobs)?d.jobs as PublicCaregiverJob[]:[]).sort((a,b)=>(a.distanceMiles??999)-(b.distanceMiles??999))))
      .catch(()=>setJobs([]));
  },[zip,miles,role]);
  return <>
    <div className="page-head"><h1>All jobs</h1><p>Every current caregiver job near you, nearest first. Open one to read it and apply without leaving this list.</p></div>
    <div className="all-jobs-filters">
      <label>ZIP<input value={zip} onChange={e=>setZip(e.target.value.replace(/\D/g,'').slice(0,5))} inputMode="numeric" maxLength={5}/></label>
      <label>Distance<select value={miles} onChange={e=>setMiles(Number(e.target.value))}>{JOB_MILES.map(m=><option key={m} value={m}>Within {m} miles</option>)}</select></label>
    </div>
    <div className="hub-filters" role="group" aria-label="Filter by role">
      {['',...JOB_ROLES].map(r=><button key={r||'all'} className={'hub-filter '+(role===r?'active':'')} onClick={()=>setRole(r)}>{r||'All roles'}</button>)}
    </div>
    {!/^\d{5}$/.test(zip)?<div className="empty"><strong>Enter a 5-digit ZIP.</strong></div>
      :jobs===null?<div className="empty"><strong>Loading jobs…</strong></div>
      :jobs.length===0?<div className="empty"><strong>No current {role||'caregiver'} jobs within {miles} miles of {zip}.</strong><div>Try a wider distance.</div></div>
      :<><p className="job-meta">{jobs.length}{jobs.length===100?'+':''} job{jobs.length===1?'':'s'} within {miles} miles of {zip}</p><JobList jobs={jobs}/></>}
  </>;
}
