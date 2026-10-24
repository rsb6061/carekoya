import { useEffect, useState } from 'react';
import { CaregiverOnboarding } from './CaregiverOnboarding';
import { useCaregiverAuth } from './caregiverAuth';
import { ApplyForMe } from './ApplyForMe';
import { ApplySignIn } from './ApplySignIn';
import { jobsHubPath, usState } from './usStates';
import { SiteFooter, SiteHeader } from './SiteChrome';
import { descriptionBlocks, payLabel, pillLabel } from './jobFormat';
import './styles.css';
import { JobAlertSignup } from './JobAlertSignup';

type Job={
  id:string;title:string;role:string;roles?:string[];employerName:string;city?:string;state?:string;zip?:string;
  employmentType?:string;payMin?:number|null;payMax?:number|null;payPeriod?:string;description?:string;sourceUrl:string;
  /** The agency posted this job on CareJoys, so there's no employer site to send anyone to. */
  postedOnCareJoys?:boolean;
  datePosted?:string;lastSeenAt?:string;lastCheckedAt?:string;applyForMe?:boolean;employerOnCareJoys?:boolean;
};

type JobContext={
  similar:{id:string;title:string;employerName:string;city:string;state:string;pay:string;distanceMiles:number|null}[];
  employer:{name:string;city:string;state:string;providerTypes:string;website:string;otherOpenJobs:number;about?:string;benefits?:string;profilePath?:string}|null;
  payContext:{role:string;state:string;median:number;count:number;unit:string;position:'above'|'near'|'below'|null}|null;
};

type MyProfile={
  caregiver:{firstName?:string;lastName?:string;email?:string;city?:string;state?:string;zip?:string;role?:string;certifications?:string;shifts?:string;desiredWage?:string;freshness?:string}|null;
  applications?:{jobId:string;appliedOnCareJoys:boolean;submittedOnEmployerSite?:boolean;employerOnCareJoys?:boolean}[];
  resume?:{fileName:string}|null;
};
type ApplyResult={status:'applied'|'already_applied'|'not_sent';employerOnCareJoys:boolean;employerName:string;applicationUrl:string};

function employmentPills(value?:string){
  return (value||'').split(/[,;|]+/).map(v=>pillLabel(v)).filter(Boolean);
}

export function CaregiverJobPage(){
  const id=decodeURIComponent(window.location.pathname.split('/').filter(Boolean)[1]||'');
  // Older #apply links (emails, the server snapshot, sign-in returns) land on the apply page instead.
  if(window.location.hash==='#apply'){window.location.replace(applyPath(id));return null}
  return <JobDetail id={id}/>;
}

/** Applying happens on its own page, opened in a new tab, so the caregiver's job list stays where they left it. */
export const applyPath=(id:string)=>'/apply/'+encodeURIComponent(id);

/** The job, and what the signed-in caregiver has already sent, for the job page and the apply page. */
function useJobAndMe(id:string){
  const [job,setJob]=useState<Job|null>(null);
  const [loading,setLoading]=useState(true);
  const auth=useCaregiverAuth();
  const [me,setMe]=useState<MyProfile|null>(null);
  useEffect(()=>{
    if(!auth.isAuthenticated){setMe(null);return}
    (async()=>{
      const res=await fetch('/api/me');
      if(res.ok)setMe(await res.json() as MyProfile);
    })().catch(()=>{});
  },[auth.isAuthenticated]);
  useEffect(()=>{
    fetch('/api/public/caregiver-jobs/'+encodeURIComponent(id))
      .then(async r=>{const body=await r.json();if(!r.ok)throw new Error(body.error||'Job not found');return body})
      .then((body:any)=>setJob(body.job))
      .catch(()=>setJob(null))
      .finally(()=>setLoading(false));
  },[id]);
  return {job,loading,auth,me};
}

// The employer's own application opens in a new tab (a real link, so no popup blocker), and the click is recorded
// so CareJoys can count it.
function recordEmployerSiteClick(jobId:string){recordApplyStep(jobId,'')}

/** One step of applying, counted for the admin Jobs tab: '' is the click out to the employer's own site. */
function recordApplyStep(jobId:string,step:''|'apply_page_opened'|'apply_signed_in'){
  void fetch('/api/public/caregiver-jobs/'+encodeURIComponent(jobId)+'/apply',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(step?{step}:{}),keepalive:true}).catch(()=>{});
}

/**
 * One job: the /jobs/:id page, or (embedded) the side panel that job lists open it in (JobDrawer.tsx),
 * so a caregiver can read and apply without leaving the list.
 */
export function JobDetail({id,embedded=false}:{id:string;embedded?:boolean}){
  const {job,loading,auth,me}=useJobAndMe(id);
  const [context,setContext]=useState<JobContext|null>(null);
  const [leaving,setLeaving]=useState(false);

  useEffect(()=>{
    if(!auth.isAuthenticated||!job?.id||!me?.caregiver)return;
    void fetch('/api/me/worker-activity',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jobId:job.id})}).catch(()=>{});
  },[auth.isAuthenticated,job?.id,!!me?.caregiver]);
  // No saving: a job is applied to only when the application reached the employer (on CareJoys, or Apply for me submitted).
  const applicationSent=!!me?.applications?.some(a=>a.jobId===id);

  useEffect(()=>{
    fetch('/api/public/caregiver-jobs/'+encodeURIComponent(id)+'/context').then(r=>r.ok?r.json():null).then((body:any)=>{if(body?.ok)setContext(body)}).catch(()=>{});
  },[id]);

  function applyOnEmployerSite(){
    if(!job)return;
    setLeaving(true);
    recordEmployerSiteClick(job.id);
  }

  // CareJoys can't send this application (employer not on CareJoys, job site Apply for me doesn't support). Apply with
  // CareJoys still builds the caregiver's profile, and says up front that they finish on the employer's site.
  const externalOnly=!!job&&!job.employerOnCareJoys&&!job.applyForMe;

  if(loading)return <main className="job-detail-shell"><div className="wrap"><div className="empty">Loading job…</div></div></main>;
  if(!job)return <main className="job-detail-shell"><div className="wrap">{!embedded&&<a className="text-link" href="/caregiver-jobs">← Caregiver jobs</a>}<div className="empty"><strong>This job is no longer available.</strong></div></div></main>;

  const location=[job.city,job.state,job.zip].filter(Boolean).join(', ');
  const payText=payLabel(job);
  const description=job.description?descriptionBlocks(job.description):null;
  const state=usState(job.state||'');
  const hubHref=state?jobsHubPath(state):'/caregiver-jobs';

  return <div>
    {/* A caregiver mid-apply doesn't need the employer button as the loudest thing on the page. */}
    {!embedded&&<SiteHeader jobsHref={hubHref} hireButton={false}/>}
    <main className="job-detail-shell">
      <div className="wrap job-detail-wrap">
        {!embedded&&<a className="text-link job-back-link" href={hubHref}>← All {state?state.name:''} caregiver jobs</a>}
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
            <a className="btn job-apply-primary" href={applyPath(job.id)} target="_blank" rel="noopener">{applicationSent?'Applied ✓':'Apply with CareJoys'}</a>
            {!job.postedOnCareJoys&&<a className="text-button job-apply-direct" href={job.sourceUrl} target="_blank" rel="noreferrer nofollow" onClick={applyOnEmployerSite}>Or apply on {job.employerName}’s site ↗</a>}
          </div>
          {!applicationSent&&<p className="apply-where">{leaving?'Opened in a new tab. Finish your application there; this page stays here.':externalOnly?`Free CareJoys profile, then you finish on ${job.employerName||'the employer'}’s site`:'Applies through CareJoys'}</p>}
          <div className="job-detail-source">{job.postedOnCareJoys?`Posted on CareJoys by ${job.employerName}.`:<>CareJoys verified this opening from the employer’s public careers page. Last checked {job.lastCheckedAt?new Date(job.lastCheckedAt).toLocaleDateString():new Date(job.lastSeenAt||Date.now()).toLocaleDateString()}.</>}</div>
        </section>
        {/* Caregivers with a profile already get the weekly job email; everyone else can leave just an email and ZIP. */}
        {!me?.caregiver&&!applicationSent&&<JobAlertSignup role={/^(CNA|GNA)$/i.test(job.role||'')?'CNA':'Caregiver'} zip={(job.zip||'').slice(0,5)}/>}

        {description?.lead&&<section className="section job-description-section"><h2>About this job</h2><p>{description.lead}</p>{description.bullets.length>0&&<ul className="job-description-list">{description.bullets.map((b,i)=><li key={i}>{b}</li>)}</ul>}{!job.postedOnCareJoys&&<p className="job-summary-note">Summary written by CareJoys. See the full posting on <a className="text-link" href={job.sourceUrl} target="_blank" rel="noreferrer nofollow">{job.employerName}’s site</a>.</p>}</section>}
        {context?.payContext&&<section className="section job-description-section"><h2>Pay for {context.payContext.role} jobs in {context.payContext.state}</h2><p>The median advertised pay across {context.payContext.count} current {context.payContext.role} jobs in {context.payContext.state} is ${context.payContext.median.toFixed(2)}/hr{context.payContext.position?<>; this job is <strong>{context.payContext.position}</strong> that median.</>:'.'}</p></section>}
        {context?.employer&&<section className="section job-description-section"><h2>About {context.employer.name}</h2>
          <p>{[context.employer.providerTypes,[context.employer.city,context.employer.state].filter(Boolean).join(', ')].filter(Boolean).join(' · ')}</p>
          {context.employer.about&&<p>{context.employer.about}</p>}
          {context.employer.benefits&&<p><strong>Benefits:</strong> {context.employer.benefits}</p>}
          {context.employer.otherOpenJobs>0&&<p>{context.employer.otherOpenJobs} other current opening{context.employer.otherOpenJobs===1?'':'s'} at this employer on CareJoys.</p>}
          {context.employer.profilePath&&<p><a className="text-link" href={context.employer.profilePath}>See {context.employer.name}’s profile and all their jobs</a></p>}
          {context.employer.website&&<a className="text-link" href={context.employer.website} target="_blank" rel="noreferrer">Employer website ↗</a>}
        </section>}
        {context&&context.similar.length>0&&<section className="section job-description-section"><h2>Similar caregiver jobs nearby</h2>
          <div className="jobs">{context.similar.map(j=><article className="job" key={j.id}><div><h3><a href={'/jobs/'+encodeURIComponent(j.id)}>{j.title}</a></h3><div className="meta">{[j.employerName,[j.city,j.state].filter(Boolean).join(', '),j.pay,j.distanceMiles!==null?j.distanceMiles+' mi away':''].filter(Boolean).join(' · ')}</div></div></article>)}</div>
        </section>}
        {!job.postedOnCareJoys&&<p className="job-detail-source"><a className="text-link" href={job.sourceUrl} target="_blank" rel="noreferrer nofollow">Original employer listing ↗</a></p>}
      </div>
    </main>

    {!embedded&&<SiteFooter/>}
  </div>;
}


/**
 * /apply/:id, opened in a new tab from a job's Apply with CareJoys: sign in, a resume and the few missing fields, then
 * the application goes to the employer, or (when CareJoys can't send it) the caregiver finishes on the employer's site.
 * Every caregiver builds a CareJoys profile on the way.
 */
export function ApplyPage(){
  const id=decodeURIComponent(window.location.pathname.split('/').filter(Boolean)[1]||'');
  const {job,loading,auth,me}=useJobAndMe(id);
  const [leaving,setLeaving]=useState(false);
  const [applying,setApplying]=useState(false);
  const [applyError,setApplyError]=useState('');
  const [applied,setApplied]=useState<ApplyResult|null>(null);
  // Apply starts with sign-in; "Apply without signing in" skips it for this visit.
  const [guest,setGuest]=useState(false);
  const profile=me?.caregiver||null;
  const applicationSent=(!!applied&&applied.status!=='not_sent')||!!me?.applications?.some(a=>a.jobId===id);
  // Counted once per visit: the page opened, then (now or after sign-in) a signed-in caregiver on it.
  const jobFound=!!job?.id;
  useEffect(()=>{if(jobFound)recordApplyStep(id,'apply_page_opened')},[id,jobFound]);
  useEffect(()=>{if(jobFound&&auth.isAuthenticated)recordApplyStep(id,'apply_signed_in')},[id,jobFound,auth.isAuthenticated]);

  async function applyWithProfile(){
    if(!job)return;
    setApplying(true);setApplyError('');
    try{
      const res=await fetch('/api/me/apply/'+encodeURIComponent(job.id),{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
      const body=await res.json() as ApplyResult&{error?:string};
      if(!res.ok)throw new Error(body.error||'Could not send your application.');
      setApplied(body);
    }catch(error){setApplyError(error instanceof Error?error.message:'Could not send your application.')}
    finally{setApplying(false)}
  }
  function applyOnEmployerSite(){
    if(!job)return;
    setLeaving(true);
    recordEmployerSiteClick(job.id);
  }

  if(loading)return <main className="job-detail-shell"><div className="wrap"><div className="empty">Loading job…</div></div></main>;
  if(!job)return <main className="job-detail-shell"><div className="wrap"><a className="text-link" href="/caregiver-jobs">← Caregiver jobs</a><div className="empty"><strong>This job is no longer available.</strong></div></div></main>;
  const externalOnly=!job.employerOnCareJoys&&!job.applyForMe;
  const state=usState(job.state||'');
  const where=[job.city,job.state].filter(Boolean).join(', ');
  const payText=payLabel(job);

  return <div>
    <SiteHeader jobsHref={state?jobsHubPath(state):'/caregiver-jobs'} hireButton={false}/>
    <main className="job-detail-shell apply-page">
      <div className="wrap apply-page-wrap">
        <div className="apply-page-job">
          <div className="modal-kicker">Applying to</div>
          <h1>{job.title}</h1>
          <div className="job-detail-employer">{[job.employerName,where,payText].filter(Boolean).join(' · ')}</div>
          <a className="text-link" href={'/jobs/'+encodeURIComponent(job.id)}>Job details</a>
        </div>
        <section className="job-detail-card apply-page-card">
          {auth.loading?<div className="caregiver-onboarding compact"><div className="onboarding-file-note">Loading…</div></div>
          :!auth.isAuthenticated&&!guest?<ApplySignIn jobTitle={job.title} finishOn={externalOnly?job.employerName||'the employer':''} next={applyPath(job.id)} onGuest={()=>setGuest(true)}/>
          :profile?<ApplyWithProfile job={job} profile={profile} hasResume={!!me?.resume} applicationSent={applicationSent} applying={applying} error={applyError} onApply={()=>void applyWithProfile()} onEmployerSite={applyOnEmployerSite} leaving={leaving}/>
          :<CaregiverOnboarding
            compact
            targetJobId={job.id}
            heading="Upload your resume to apply"
            subheading={job.employerOnCareJoys
              ?'We’ll read it, ask only for anything missing, then send your application to '+job.employerName+'.'
              :'We’ll read it, ask only for anything missing, then send you to '+job.employerName+' to finish the application.'}
          />}
        </section>
      </div>
    </main>
    <SiteFooter/>
  </div>;
}

function ApplyWithProfile({job,profile,hasResume,applicationSent,applying,error,onApply,onEmployerSite,leaving}:{
  job:Job;profile:NonNullable<MyProfile['caregiver']>;hasResume:boolean;applicationSent:boolean;applying:boolean;error:string;
  onApply:()=>void;onEmployerSite:()=>void;leaving:boolean;
}){
  const [agentActive,setAgentActive]=useState(false);
  const [agentSubmitted,setAgentSubmitted]=useState(false);
  // The key keeps one ApplyForMe across the two layouts below; without it React remounts it the moment it starts,
  // dropping its progress, questions and errors and asking for the resume again.
  const agent=job.applyForMe&&!applicationSent||agentSubmitted
    ?<ApplyForMe key="apply-for-me" jobId={job.id} employerName={job.employerName||'the employer'} hasResume={hasResume} onActive={setAgentActive} onSubmitted={()=>setAgentSubmitted(true)}/>
    :null;
  if(agentActive||agentSubmitted)return <div className="caregiver-onboarding compact apply-with-profile">{agent}</div>;
  const employer=job.employerName||'the employer';
  if(applicationSent)return <div className="caregiver-onboarding compact"><div className="onboarding-success">
    <div className="success-mark">✓</div>
    <div className="modal-kicker">Application sent</div>
    <h2>You applied to {job.title}.</h2>
    <p>Your application is in with <strong>{employer}</strong>. When they reply you’ll get an email, and you can follow it on your Applications page.</p>
    <div className="onboarding-final-action"><a className="btn" href="/dashboard/applications">See your applications</a></div>
  </div></div>;
  const rows:[string,string][]=([
    ['Name',[profile.firstName,profile.lastName].filter(Boolean).join(' ')],
    ['Role',[profile.role,(profile.certifications||'').split(',').map(x=>x.trim()).filter(x=>x&&x.toLowerCase()!==(profile.role||'').toLowerCase()).join(', ')].filter(Boolean).join(' · ')],
    ['Location',[profile.city,profile.state,profile.zip].filter(Boolean).join(', ')],
    ['Availability',profile.shifts||''],
    ['Desired pay',profile.desiredWage||''],
    ['Email',profile.email||'']
  ] as [string,string][]).filter(r=>r[1]);
  // We either apply or we don't: an employer on CareJoys gets the profile, Apply for me fills the employer's own
  // form, and anything else goes straight to the employer's site. Nothing is saved for later.
  return <div className="caregiver-onboarding compact apply-with-profile">
    <div className="modal-kicker">Apply with your CareJoys profile</div>
    <h2>{job.title}</h2>
    <p className="apply-with-profile-sub">{employer}</p>
    <div className="apply-profile-head"><strong>Applying as</strong><a className="text-link" href="/dashboard/profile">Edit</a></div>
    <dl className="apply-profile-summary">{rows.map(([k,v])=><div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
    {error&&<div className="notice">{error}</div>}
    {!job.employerOnCareJoys&&!agent&&<p className="apply-finish-note">{employer} takes applications on their own site, and CareJoys can’t send this one for you yet. Your profile is saved; finish your application there.</p>}
    {agent}
    {job.employerOnCareJoys
      ?<button className={agent?'text-button apply-profile-only':'btn submit-button'} onClick={onApply} disabled={applying}>{applying?'Sending…':agent?'Just send my CareJoys profile instead':'Send my application'}</button>
      :!agent&&<a className="btn submit-button" href={job.sourceUrl} target="_blank" rel="noreferrer nofollow" onClick={onEmployerSite}>{leaving?'Opened in a new tab ✓':'Finish on '+employer+'’s site ↗'}</a>}
  </div>;
}
