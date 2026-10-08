import { useEffect, useState } from 'react';
import { CaregiverOnboarding } from './CaregiverOnboarding';
import { useCaregiverAuth } from './caregiverAuth';
import { ApplyForMe } from './ApplyForMe';
import { jobsHubPath, usState } from './usStates';
import { SiteFooter, SiteHeader } from './SiteChrome';
import { descriptionBlocks, payLabel, pillLabel } from './jobFormat';
import './styles.css';

type Job={
  id:string;title:string;role:string;roles?:string[];employerName:string;city?:string;state?:string;zip?:string;
  employmentType?:string;payMin?:number|null;payMax?:number|null;payPeriod?:string;description?:string;sourceUrl:string;
  datePosted?:string;lastSeenAt?:string;lastCheckedAt?:string;applyForMe?:boolean;employerOnCareJoys?:boolean;
};

type JobContext={
  similar:{id:string;title:string;employerName:string;city:string;state:string;pay:string;distanceMiles:number|null}[];
  employer:{name:string;city:string;state:string;providerTypes:string;website:string;otherOpenJobs:number}|null;
  payContext:{role:string;state:string;median:number;count:number;unit:string;position:'above'|'near'|'below'|null}|null;
};

type MyProfile={
  caregiver:{firstName?:string;lastName?:string;email?:string;city?:string;state?:string;zip?:string;role?:string;certifications?:string;shifts?:string;desiredWage?:string;freshness?:string}|null;
  applications?:{jobId:string;appliedOnCareJoys:boolean;submittedOnEmployerSite?:boolean;employerOnCareJoys?:boolean}[];
  resume?:{fileName:string}|null;
};
type ApplyResult={status:'applied'|'already_applied';employerOnCareJoys:boolean;employerName:string;applicationUrl:string};

function employmentPills(value?:string){
  return (value||'').split(/[,;|]+/).map(v=>pillLabel(v)).filter(Boolean);
}

export function CaregiverJobPage(){
  const id=decodeURIComponent(window.location.pathname.split('/').filter(Boolean)[1]||'');
  const [job,setJob]=useState<Job|null>(null);
  const [loading,setLoading]=useState(true);
  const [applyOpen,setApplyOpen]=useState(()=>window.location.hash==='#apply');
  const [context,setContext]=useState<JobContext|null>(null);
  const [leaving,setLeaving]=useState(false);
  const auth=useCaregiverAuth();
  const [me,setMe]=useState<MyProfile|null>(null);
  const [applying,setApplying]=useState(false);
  const [applyError,setApplyError]=useState('');
  const [applied,setApplied]=useState<ApplyResult|null>(null);

  // A signed-in caregiver with a profile applies in one click; everyone else uploads a resume first.
  useEffect(()=>{
    if(!auth.isAuthenticated){setMe(null);return}
    (async()=>{
      const token=await auth.getIdToken();
      const res=await fetch('/api/me',{headers:token?{authorization:'Bearer '+token}:{}});
      if(res.ok)setMe(await res.json() as MyProfile);
    })().catch(()=>{});
  },[auth.isAuthenticated]);
  const profile=me?.caregiver||null;
  const alreadyApplied=!!applied||!!me?.applications?.some(a=>a.jobId===id&&a.appliedOnCareJoys);
  const myApplication=me?.applications?.find(a=>a.jobId===id&&a.appliedOnCareJoys);
  // Only an employer on CareJoys (or an Apply for me submission) actually receives the application.
  const applicationSent=!!applied?.employerOnCareJoys||!!myApplication?.employerOnCareJoys||!!myApplication?.submittedOnEmployerSite;

  async function applyWithProfile(){
    if(!job)return;
    setApplying(true);setApplyError('');
    try{
      const token=await auth.getIdToken();
      const res=await fetch('/api/me/apply/'+encodeURIComponent(job.id),{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:'{}'});
      const body=await res.json() as ApplyResult&{error?:string};
      if(!res.ok)throw new Error(body.error||'Could not send your application.');
      setApplied(body);
    }catch(error){setApplyError(error instanceof Error?error.message:'Could not send your application.')}
    finally{setApplying(false)}
  }

  useEffect(()=>{
    fetch('/api/public/caregiver-jobs/'+encodeURIComponent(id))
      .then(async r=>{const body=await r.json();if(!r.ok)throw new Error(body.error||'Job not found');return body})
      .then((body:any)=>setJob(body.job))
      .catch(()=>setJob(null))
      .finally(()=>setLoading(false));
    fetch('/api/public/caregiver-jobs/'+encodeURIComponent(id)+'/context').then(r=>r.ok?r.json():null).then((body:any)=>{if(body?.ok)setContext(body)}).catch(()=>{});
  },[id]);

  // Quick apply: straight to the employer's own application, recorded so CareJoys can count it.
  async function applyOnEmployerSite(){
    if(!job)return;
    setLeaving(true);
    try{
      const res=await fetch('/api/public/caregiver-jobs/'+encodeURIComponent(job.id)+'/apply',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
      const body=await res.json() as {applicationUrl?:string};
      window.location.href=body.applicationUrl||job.sourceUrl;
    }catch{window.location.href=job.sourceUrl}
  }

  if(loading)return <main className="job-detail-shell"><div className="wrap"><div className="empty">Loading job…</div></div></main>;
  if(!job)return <main className="job-detail-shell"><div className="wrap"><a className="text-link" href="/caregiver-jobs">← Caregiver jobs</a><div className="empty"><strong>This job is no longer available.</strong></div></div></main>;

  const location=[job.city,job.state,job.zip].filter(Boolean).join(', ');
  const payText=payLabel(job);
  const description=job.description?descriptionBlocks(job.description):null;
  const state=usState(job.state||'');
  const hubHref=state?jobsHubPath(state):'/caregiver-jobs';

  return <div>
    <SiteHeader jobsHref={hubHref}/>
    <main className="job-detail-shell">
      <div className="wrap job-detail-wrap">
        <a className="text-link job-back-link" href={hubHref}>← All {state?state.name:''} caregiver jobs</a>
        <section className="job-detail-card">
          <div className="modal-kicker">{pillLabel(job.role)}{state?' · '+state.name:''}</div>
          <h1>{job.title}</h1>
          <div className="job-detail-employer">{job.employerName}</div>
          <div className="job-tags">
            {location&&<span className="pill">{location}</span>}
            {(job.roles?.length?job.roles:[job.role]).map(role=><span className="pill" key={role}>{pillLabel(role)}</span>)}
            {employmentPills(job.employmentType).map(type=><span className="pill" key={type}>{type}</span>)}
            {payText&&<span className="pill">{payText}</span>}
          </div>
          <div className="job-detail-actions">
            <button className="btn job-apply-primary" onClick={()=>setApplyOpen(true)}>{applicationSent?'Applied ✓':alreadyApplied?'Saved ✓':'Apply'}</button>
            <button className="text-button job-apply-direct" onClick={applyOnEmployerSite} disabled={leaving}>{leaving?'Opening…':'Or apply on '+job.employerName+'’s site'}</button>
          </div>
          <div className="job-detail-source">CareJoys verified this opening from the employer’s public careers page. Last checked {job.lastCheckedAt?new Date(job.lastCheckedAt).toLocaleDateString():new Date(job.lastSeenAt||Date.now()).toLocaleDateString()}.</div>
        </section>

        {description?.lead&&<section className="section job-description-section"><h2>About this job</h2><p>{description.lead}</p>{description.bullets.length>0&&<ul className="job-description-list">{description.bullets.map((b,i)=><li key={i}>{b}</li>)}</ul>}<p className="job-summary-note">Summary written by CareJoys. See the full posting on <a className="text-link" href={job.sourceUrl} target="_blank" rel="noreferrer nofollow">{job.employerName}’s site</a>.</p></section>}
        {context?.payContext&&<section className="section job-description-section"><h2>Pay for {context.payContext.role} jobs in {context.payContext.state}</h2><p>The median advertised pay across {context.payContext.count} current {context.payContext.role} jobs in {context.payContext.state} is ${context.payContext.median.toFixed(2)}/hr{context.payContext.position?<>; this job is <strong>{context.payContext.position}</strong> that median.</>:'.'}</p></section>}
        {context?.employer&&<section className="section job-description-section"><h2>About {context.employer.name}</h2>
          <p>{[context.employer.providerTypes,[context.employer.city,context.employer.state].filter(Boolean).join(', ')].filter(Boolean).join(' · ')}</p>
          {context.employer.otherOpenJobs>0&&<p>{context.employer.otherOpenJobs} other current opening{context.employer.otherOpenJobs===1?'':'s'} at this employer on CareJoys.</p>}
          {context.employer.website&&<a className="text-link" href={context.employer.website} target="_blank" rel="noreferrer">Employer website ↗</a>}
        </section>}
        {context&&context.similar.length>0&&<section className="section job-description-section"><h2>Similar caregiver jobs nearby</h2>
          <div className="jobs">{context.similar.map(j=><article className="job" key={j.id}><div><h3><a href={'/jobs/'+encodeURIComponent(j.id)}>{j.title}</a></h3><div className="meta">{[j.employerName,[j.city,j.state].filter(Boolean).join(', '),j.pay,j.distanceMiles!==null?j.distanceMiles+' mi away':''].filter(Boolean).join(' · ')}</div></div></article>)}</div>
        </section>}
        <p className="job-detail-source"><a className="text-link" href={job.sourceUrl} target="_blank" rel="noreferrer nofollow">Original employer listing ↗</a></p>
      </div>
    </main>

    {applyOpen&&<div className="modal-backdrop" onMouseDown={()=>setApplyOpen(false)}>
      <div className="modal-panel caregiver-apply-modal" onMouseDown={e=>e.stopPropagation()}>
        <button className="modal-close" onClick={()=>setApplyOpen(false)} aria-label="Close">×</button>
        {profile?<ApplyWithProfile job={job} profile={profile} hasResume={!!me?.resume} getToken={auth.getIdToken} result={applied} alreadyApplied={alreadyApplied} applicationSent={applicationSent} applying={applying} error={applyError} onApply={()=>void applyWithProfile()} onEmployerSite={applyOnEmployerSite}/>
        :<CaregiverOnboarding
          compact
          targetJobId={job.id}
          heading="Upload your resume to apply"
          subheading={'We’ll build your CareJoys profile, ask only for anything missing, then send you to '+job.employerName+' to finish the application.'}
        />}
      </div>
    </div>}

    <SiteFooter/>
  </div>;
}


function ApplyWithProfile({job,profile,hasResume,getToken,result,alreadyApplied,applicationSent,applying,error,onApply,onEmployerSite}:{
  job:Job;profile:NonNullable<MyProfile['caregiver']>;hasResume:boolean;getToken:()=>Promise<string>;result:ApplyResult|null;alreadyApplied:boolean;applicationSent:boolean;applying:boolean;error:string;
  onApply:()=>void;onEmployerSite:()=>void;
}){
  const [agentActive,setAgentActive]=useState(false);
  const [agentSubmitted,setAgentSubmitted]=useState(false);
  const agent=job.applyForMe&&!result&&!alreadyApplied||agentSubmitted
    ?<ApplyForMe jobId={job.id} employerName={job.employerName||'the employer'} hasResume={hasResume} getToken={getToken} onActive={setAgentActive} onSubmitted={()=>setAgentSubmitted(true)}/>
    :null;
  if(agentActive||agentSubmitted)return <div className="caregiver-onboarding compact apply-with-profile">{agent}</div>;
  const employer=job.employerName||'the employer';
  if(result||alreadyApplied){
    const onCareJoys=applicationSent;
    return <div className="caregiver-onboarding compact"><div className="onboarding-success">
      <div className="success-mark">✓</div>
      <div className="modal-kicker">{onCareJoys?'Application sent':'Saved, not sent yet'}</div>
      <h2>{onCareJoys?<>You applied to {job.title}.</>:<>Finish applying on {employer}’s site.</>}</h2>
      {onCareJoys
        ?<p>We sent your CareJoys profile to <strong>{employer}</strong>. When they reply you’ll get an email, and you can follow it on your dashboard.</p>
        :<p><strong>{employer}</strong> takes applications on their own site, so they haven’t seen your application yet. We saved {job.title} on your CareJoys dashboard so you can come back to it.</p>}
      <div className="onboarding-final-action">
        {!onCareJoys&&<button className="btn" onClick={onEmployerSite}>Finish on {employer}’s site</button>}
        <a className={onCareJoys?'btn':'text-link'} href="/dashboard">See your applications</a>
      </div>
    </div></div>;
  }
  const rows:[string,string][]=([
    ['Name',[profile.firstName,profile.lastName].filter(Boolean).join(' ')],
    ['Role',[profile.role,profile.certifications].filter(Boolean).join(' · ')],
    ['Location',[profile.city,profile.state,profile.zip].filter(Boolean).join(', ')],
    ['Shifts',profile.shifts||''],
    ['Desired pay',profile.desiredWage||''],
    ['Availability',profile.freshness||''],
    ['Email',profile.email||'']
  ] as [string,string][]).filter(r=>r[1]);
  return <div className="caregiver-onboarding compact apply-with-profile">
    <div className="modal-kicker">Apply with your CareJoys profile</div>
    <h2>{job.title}</h2>
    <p className="apply-with-profile-sub">{job.employerOnCareJoys?<>{employer} will see this profile. You don’t need to upload your resume again.</>:<>{employer} takes applications on their own site. We’ll save this job to your dashboard, then you finish on their site.</>}</p>
    <dl className="apply-profile-summary">{rows.map(([k,v])=><div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
    <a className="text-link" href="/dashboard">Update your profile first</a>
    {error&&<div className="notice">{error}</div>}
    {agent}
    <button className={agent?'text-button apply-profile-only':'btn submit-button'} onClick={onApply} disabled={applying}>{applying?'Saving…':job.employerOnCareJoys?(agent?'Just send my CareJoys profile instead':'Send my application'):(agent?'Just save it to my dashboard instead':'Save to my dashboard')}</button>
  </div>;
}
