import { useEffect, useState, type FormEvent } from 'react';
import { TurnstileField } from './TurnstileField';
import { Shell } from './LoginPage';
import { rememberDashboard } from './dashboardHome';
import { AccountMenu } from './AccountLink';
import './workspace.css';

type Count={count:number};
type Overview={
  admin:{via:string;email:string};
  funnel:{
    window:string;
    employerFunnel:Array<{step:string;count:number}>;
    caregiverSignups:Array<{source:string}&Count>;
    workerFunnel:{previews:number;withJobs:number;emptyPreviews:number;signups:number;verified:number;eligibleReturn:number;returned:number;availableSince:string;conversionWindowDays:number};
    outreachChannels:{
      agencyHiring:{enabled:boolean;cap:number;perHour:number;today:number;total:number;schedule:string};
      generalBulk:{enabled:boolean};reactivationReminders:{enabled:boolean;sent:number};
      agencyInboxAlerts:{claimedLast24h:number;unclaimedLast24h:number;unclaimedEnabled:boolean;dailyLimit:number};
      weeklyDigest:{enabled:boolean;subscribed:number;verified:number;sentLast7Days:number};
      schools:{mode:string;cap:number;today:number;contactable:number;intros:number;claimed:number;referrals:number;
        prospects:Array<{id:string;name:string;city:string;type:string;email:string;referralSlug?:string|null}>};
    };
    reactivation:{legacyTotal:number;sent:number;opened:number;completed:number;activelyLooking:number};
    agencyClaims:{teasersSent:number;teasersOpened:number;claimsRequested:number;claimed:number};
    jobApplies:Array<{event_type:string}&Count>;
    traffic:{pageViews:number;topPaths:Array<{path:string}&Count>;topSources:Array<{source:string}&Count>};
  };
  outreach:{
    enabled:boolean;reactivationQueue:number;unsubscribes:number;
    today:Array<{kind:'reactivation'|'agency_teasers';cap:number;sentToday:number}>;
    recentRuns:Array<{kind:string;trigger:string;attempted:number;sent:number;failed:number;created_at:string}>;
  };
  employers:Array<{id:string;company_name:string;contact_name?:string;email:string;zip?:string;created_at:string;last_login_at?:string;openings:number;contacted:number;interviews:number;claimed_agency?:string;approval:string}>;
};

const STEP_LABELS:Record<string,string>={employers:'Employer signups',openings:'Openings',matched:'Matches',contacted:'Contacted',interested:'Interested',interviews:'Interviews booked',hired:'Hired'};
const KIND_LABELS:Record<string,string>={reactivation:'Caregiver reactivation',agency_teasers:'Agency teasers'};
const caregiverSourceLabel=(source:string)=>({
  legacy_carekoya:'Imported legacy caregivers',resume_upload:'Resume signups',organic:'Direct caregiver signups',school_referral:'School referrals'
} as Record<string,string>)[source]||source.replace(/_/g,' ');
const applicationEventLabel=(event:string)=>({
  external_redirect_clicked:'Clicked external application',carejoys_applied:'Applied through CareJoys',
  apply_started:'Application started',apply_completed:'Application submitted'
} as Record<string,string>)[event]||event.replace(/_/g,' ');
const approvalLabel=(status:string)=>({
  manual:'Approved manually',agency:'Verified agency',business_email:'Company email (automatic)'
} as Record<string,string>)[status]||status;
const pct=(a:number,b:number)=>b>0?Math.round(a/b*100)+'%':'—';
const day=(iso?:string)=>iso?new Date(iso.replace(' ','T')+(iso.endsWith('Z')?'':'Z')).toLocaleDateString('en-US',{month:'short',day:'numeric'}):'—';

async function api<T>(path:string,init?:RequestInit):Promise<T>{
  const res=await fetch(path,{...init,headers:{'content-type':'application/json',...(init?.headers||{})}});
  const body=await res.json() as T&{error?:string};
  if(!res.ok)throw Object.assign(new Error(body.error||'Request failed'),{status:res.status});
  return body;
}

function AdminSignIn(){
  const [email,setEmail]=useState('');
  const [turnstileToken,setTurnstileToken]=useState('');
  const [message,setMessage]=useState('');
  async function submit(e:FormEvent){
    e.preventDefault();
    try{const body=await api<{message:string}>('/api/admin/auth/request',{method:'POST',body:JSON.stringify({email,turnstileToken})});setMessage(body.message)}
    catch(err){setMessage(err instanceof Error?err.message:'Could not send sign-in link')}
  }
  return <Shell><div className="login-card">
    <div className="modal-kicker">CareJoys admin</div>
    <h1>Admin sign-in</h1>
    <p>We’ll email a one-time sign-in link to approved admin addresses.</p>
    <form className="auth-form" onSubmit={submit}>
      <input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@carejoys.com" required />
      <TurnstileField onToken={setTurnstileToken}/>
      {message&&<div className="alert-status">{message}</div>}
      <button className="button">Email me a sign-in link</button>
    </form>
  </div></Shell>;
}

function Stat({label,value,sub}:{label:string;value:number|string;sub?:string}){
  return <div className="settings-card"><div className="job-meta">{label}</div><div style={{fontSize:30,fontWeight:600}}>{value}</div>{sub&&<div className="job-meta">{sub}</div>}</div>;
}
const grid={display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(min(132px,100%),1fr))',gap:12} as const;

type AgencyOption={id:string;name:string;city?:string;state?:string;jobs:number;matches:number;claimed:boolean};

export function AdminConsole(){
  const [data,setData]=useState<Overview|null>(null);
  const [needsLogin,setNeedsLogin]=useState(false);
  type AdminSection='overview'|'employers'|'caregivers'|'jobs'|'outreach'|'advanced';
  const allowedSections:AdminSection[]=['overview','employers','caregivers','jobs','outreach','advanced'];
  const [section,setSection]=useState<AdminSection>(()=>{
    const hash=window.location.hash.slice(1) as AdminSection;
    return allowedSections.includes(hash)?hash:'overview';
  });
  function goToSection(next:AdminSection){
    setSection(next);
    window.history.replaceState(null,'','#'+next);
    window.scrollTo({top:0,behavior:'smooth'});
  }
  const [employerQuery,setEmployerQuery]=useState('');
  const [windowKey,setWindowKey]=useState('30');
  const [notice,setNotice]=useState('');
  const [busy,setBusy]=useState(false);

  async function load(key=windowKey){
    try{setData(await api<Overview>('/api/admin/overview?window='+key));rememberDashboard('admin')}
    catch(err){if((err as {status?:number}).status===401)setNeedsLogin(true);else setNotice(err instanceof Error?err.message:'Could not load')}
  }
  useEffect(()=>{void load(windowKey)},[windowKey]);

  async function run(kind:string){
    if(!window.confirm(`Send today's remaining ${KIND_LABELS[kind].toLowerCase()} emails now?`))return;
    setBusy(true);setNotice('');
    try{
      const body=await api<{result:{sent:number;failed:number;skipped?:string}}>('/api/admin/outreach/run',{method:'POST',body:JSON.stringify({kind})});
      setNotice(body.result.skipped?`Nothing sent: ${body.result.skipped.replace(/_/g,' ')}.`:`Sent ${body.result.sent}${body.result.failed?`, ${body.result.failed} failed`:''}.`);
      await load();
    }catch(err){setNotice(err instanceof Error?err.message:'Send failed')}
    finally{setBusy(false)}
  }

  async function approve(id:string,name:string){
    if(!window.confirm(`Approve ${name}? They'll be able to see caregiver profiles and get an email saying so.`))return;
    setBusy(true);setNotice('');
    try{await api('/api/admin/employers/'+encodeURIComponent(id)+'/approve',{method:'POST',body:'{}'});setNotice(name+' approved.');await load()}
    catch(err){setNotice(err instanceof Error?err.message:'Approve failed')}
    finally{setBusy(false)}
  }

  async function test(kind:string){
    setBusy(true);setNotice('');
    try{
      const body=await api<{result:{to:string}}>('/api/admin/outreach/test',{method:'POST',body:JSON.stringify({kind})});
      setNotice(`Test ${KIND_LABELS[kind].toLowerCase()} email sent to ${body.result.to}.`);
    }catch(err){setNotice(err instanceof Error?err.message:'Test send failed')}
    finally{setBusy(false)}
  }

  // Walkthrough source: a real agency to copy (its profile, jobs and matches), and the inbox the teaser goes to.
  const [agencyQuery,setAgencyQuery]=useState('');
  const [agencyOptions,setAgencyOptions]=useState<AgencyOption[]>([]);
  const [sourceAgency,setSourceAgency]=useState<AgencyOption|null>(null);
  const [testEmail,setTestEmail]=useState('');
  useEffect(()=>{
    if(needsLogin||!data)return;
    const t=window.setTimeout(()=>{
      api<{agencies:AgencyOption[]}>('/api/admin/agencies?q='+encodeURIComponent(agencyQuery)).then(b=>setAgencyOptions(b.agencies)).catch(()=>{});
    },250);
    return ()=>window.clearTimeout(t);
  },[agencyQuery,!!data,needsLogin]);

  async function agencyTest(reset=false){
    if(reset&&!window.confirm('Reset the test agency? This removes its claim, hiring profile and pipeline so you can start over.'))return;
    setBusy(true);setNotice('');
    try{
      const body=await api<{result?:{to?:string;email:string;candidateCount:number;agencyName?:string;jobCount?:number}}>('/api/admin/agency-test',{method:'POST',body:JSON.stringify({reset,sourceId:sourceAgency?.id||'',to:testEmail.trim()})});
      const r=body.result!;
      setNotice(reset?'Test agency reset.':`Live teaser for ${r.agencyName||'CareJoys Test Agency'} (${r.candidateCount} matched caregivers, ${r.jobCount||0} jobs) sent to ${r.email}.`);
    }catch(err){setNotice(err instanceof Error?err.message:'Test agency failed')}
    finally{setBusy(false)}
  }

  if(needsLogin)return <AdminSignIn/>;
  if(!data)return <div className="loading-screen">{notice||'Loading admin…'}</div>;
  const f=data.funnel;
  const oc=f.outreachChannels;
  const steps=f.employerFunnel;
  const pending=data.employers.filter(e=>e.approval==='pending');
  const caregiverNew=f.caregiverSignups.reduce((sum,row)=>sum+row.count,0);


  return <div>
    <header className="app-header admin-app-header"><div className="app-wrap header-inner admin-header-inner">
      <a className="brand" href="/">CareJoys <span className="admin-brand-tag">Admin</span></a>
      <nav className="app-nav admin-section-nav" aria-label="Admin sections">
        {(['overview','employers','caregivers','jobs','outreach','advanced'] as const).map(tab=><button key={tab}
          className={'nav-button '+(section===tab?'active':'')}
          aria-current={section===tab?'page':undefined}
          onClick={()=>goToSection(tab)}>
          {{overview:'Overview',employers:'Employers',caregivers:'Caregivers',jobs:'Jobs',outreach:'Outreach',advanced:'Advanced'}[tab]}
          {tab==='employers'&&pending.length>0&&<span className="admin-nav-count">{pending.length}</span>}
        </button>)}
      </nav>
      <AccountMenu/>
    </div></header>
    <main className="app-wrap app-content admin-main">
      <div className="admin-page-heading">
        <div><div className="modal-kicker">CareJoys operations</div><h1>{{
          overview:'Your business at a glance',employers:'Employer approvals & accounts',
          caregivers:'Caregiver growth',jobs:'Job coverage & applications',outreach:'Agency & school outreach',advanced:'Advanced operations'
        }[section]}</h1>
        <p>{{
          overview:'Start with anything that needs attention. The numbers below describe real activity, not projected hires.',
          employers:'Review new employers before giving them access to candidate profiles.',
          caregivers:'Track worker profiles, recruiting campaigns and application activity.',
          jobs:'Check how much job inventory the application agent can work with.',
          outreach:'See which campaigns are running, review school prospects and measure real responses.',
          advanced:'Outreach controls, test environments and technical diagnostics.'
        }[section]}</p></div>
        <button className="button secondary" onClick={()=>void load()} disabled={busy}>Refresh data</button>
      </div>
      {notice&&<div className="alert-status workspace-alert" role="status">{notice}</div>}
      {(section==='overview'||section==='caregivers'||section==='jobs'||section==='outreach'||section==='advanced')&&<div className="admin-date-row">
        <span>Reporting period</span>
        {['7','30','90','all'].map(k=><button key={k} className={'nav-button '+(windowKey===k?'active':'')} onClick={()=>setWindowKey(k)}>{k==='all'?'All time':k+' days'}</button>)}
        <small>Approval queue always shows all pending employers.</small>
      </div>}
      {section==='overview'&&<>
        {pending.length>0?<section className="admin-alert-card">
          <div><strong>{pending.length} employer{pending.length===1?'':'s'} need approval</strong>
            <p>{pending.slice(0,3).map(e=>e.company_name).join(', ')}{pending.length>3?' and more':''}. Review these before they can contact caregivers.</p></div>
          <button className="button" onClick={()=>goToSection('employers')}>Review employers</button>
        </section>:<div className="admin-ok-note"><strong>Employer approvals are up to date.</strong> New review requests will appear here.</div>}
        <section className="section-block admin-overview-cards">
          <div className="admin-stat-grid">
            <Stat label="Employer signups" value={f.employerFunnel[0]?.count||0} sub="New hiring accounts in period"/>
            <Stat label="Caregiver profiles added" value={caregiverNew} sub="Includes imported profiles; not all are active"/>
            <Stat label="Invitations sent" value={f.employerFunnel.find(x=>x.step==='contacted')?.count||0} sub="Employer contact events in period"/>
            <Stat label="Workers interested" value={f.employerFunnel.find(x=>x.step==='interested')?.count||0} sub="Positive candidate replies in period"/>
          </div>
        </section>
        <section className="section-block" style={{marginTop:0}}>
        <div className="section-heading"><h2>Hiring activity</h2><p>Separate counts of new employers, openings and candidate actions for this period. These are not a sequential conversion cohort.</p></div>
        <div style={grid}>{steps.map(s=><Stat key={s.step} label={STEP_LABELS[s.step]||s.step} value={s.count}/>)}</div>
      </section>
        <section className="section-block">
          <div className="section-heading"><h2>What to do next</h2><p>CareJoys is still building a reliably reachable candidate network.</p></div>
          <div className="admin-next-grid">
            <button className="settings-card admin-next-action" onClick={()=>goToSection('employers')}><strong>Approve & activate employers</strong><span>Review pending accounts, then have them view matches and contact consenting caregivers.</span></button>
            <button className="settings-card admin-next-action" onClick={()=>goToSection('caregivers')}><strong>Grow the active worker network</strong><span>Check new profiles, confirmed legacy workers and application activity.</span></button>
            <button className="settings-card admin-next-action" onClick={()=>goToSection('jobs')}><strong>Inspect job inventory</strong><span>Review supported application sites and test the candidate application assistant.</span></button>
          </div>
        </section>
      </>}
      {section==='employers'&&
<section className="section-block admin-employers">
  <div className="section-heading"><h2>Review employers</h2>
    <p>Approve only organizations you recognize. This gives access to caregiver matches and introductions; it does not claim a licensed agency directory listing.</p></div>
  <div className="admin-approval-summary">
    <div><strong>{pending.length} waiting for approval</strong><span>Accounts using personal email addresses</span></div>
    <button className="button secondary" disabled={busy} onClick={()=>void load()}>Refresh requests</button>
  </div>
  {pending.length>0?<div className="admin-approval-grid">{pending.map(e=><article className="settings-card admin-approval-card" key={e.id}>
    <div className="admin-status-label">Needs review</div>
    <h3>{e.company_name||'Unnamed employer'}</h3>
    <p>{[e.contact_name,e.email].filter(Boolean).join(' · ')}</p>
    <p className="job-meta">Joined {day(e.created_at)} · {e.openings} opening{e.openings===1?'':'s'} · ZIP {e.zip||'not provided'}</p>
    <button className="button" disabled={busy} onClick={()=>void approve(e.id,e.company_name)}>Approve employer</button>
  </article>)}</div>:<div className="settings-card admin-quiet"><strong>No employer accounts awaiting approval.</strong><p>Personal-email employers appear here. Verified company-domain employers and claimed agencies receive automatic access.</p></div>}
  <div className="admin-subheading"><h3>All employer accounts</h3><input className="pipeline-select" value={employerQuery} onChange={e=>setEmployerQuery(e.target.value)} aria-label="Search employers" placeholder="Search company or email"/></div>
  <div className="settings-card admin-table-scroll">
    <table className="admin-data-table">
      <thead><tr><th>Employer</th><th>Contact</th><th>Openings</th><th>Contacted</th><th>Interviews</th><th>Access</th></tr></thead>
      <tbody>{data.employers.filter(e=>[e.company_name,e.contact_name,e.email,e.claimed_agency].join(' ').toLowerCase().includes(employerQuery.trim().toLowerCase())).map(e=><tr key={e.id}>
        <td><strong>{e.company_name}</strong><small>Joined {day(e.created_at)} · Last login {day(e.last_login_at)}</small></td>
        <td>{e.contact_name||'—'}<small>{e.email}</small></td>
        <td>{e.openings}</td><td>{e.contacted}</td><td>{e.interviews}</td>
        <td>{e.approval==='pending'?<button className="button secondary" disabled={busy} onClick={()=>void approve(e.id,e.company_name)}>Approve</button>:<span className="admin-access-status">{approvalLabel(e.approval)}{e.claimed_agency?' · Agency claimed':''}</span>}</td>
      </tr>)}</tbody>
    </table>
  </div>
</section>
}
      {section==='caregivers'&&<>
        <section className="section-block admin-worker-funnel">
          <div className="section-heading"><h2>Preview → signup → verified → returned</h2><p>All stages come from the SAME visitors who successfully previewed jobs during this reporting period.</p></div>
          <div className="admin-stat-grid">
            <Stat label="Unique ZIP-preview visitors" value={f.workerFunnel.previews} sub="Loaded a job preview"/>
            <Stat label="Created a profile" value={f.workerFunnel.signups} sub={pct(f.workerFunnel.signups,f.workerFunnel.previews)+' of preview visitors'}/>
            <Stat label="Verified email" value={f.workerFunnel.verified} sub={pct(f.workerFunnel.verified,f.workerFunnel.signups)+' of linked profiles'}/>
            <Stat label="Returned to view jobs" value={f.workerFunnel.returned} sub={pct(f.workerFunnel.returned,f.workerFunnel.eligibleReturn)+' of profiles old enough to return'}/>
          </div>
          <div className="admin-info-note">
            Preview visitors who saw matches: <strong style={{display:'inline'}}>{f.workerFunnel.withJobs}</strong> · Saw an empty result: <strong style={{display:'inline'}}>{f.workerFunnel.emptyPreviews}</strong> · Profiles eligible for 24-hour retention: <strong style={{display:'inline'}}>{f.workerFunnel.eligibleReturn}</strong>.
            <div>Visitors may have both a match and an empty preview across searches. A return means an authenticated job view 24+ hours after signup. No contact details or ZIPs are stored in acquisition events. Standard test email domains are excluded from signup conversions. New tracking only; no historical backfill.</div>
          </div>
        </section>
        <section className="section-block admin-caregiver-summary">
          <div className="admin-stat-grid">
            <Stat label="Profiles created" value={caregiverNew} sub="During selected reporting period"/>
            <Stat label="Imported legacy profiles" value={f.reactivation.legacyTotal} sub="Existing records, not new organic signups"/>
            <Stat label="Legacy workers confirmed" value={f.reactivation.completed} sub="Completed reactivation in selected period"/>
            <Stat label="Confirmed looking" value={f.reactivation.activelyLooking} sub="Among reactivated legacy workers"/>
          </div>
        </section>
        <section className="section-block">
        <div className="section-heading"><h2>Profile acquisition by source</h2><p>Counts of caregiver profiles created during the selected period, including imported legacy records.</p></div>
        <div style={grid}>
          {f.caregiverSignups.length===0?<Stat label="New caregivers" value={0}/>:f.caregiverSignups.map(s=><Stat key={s.source} label={caregiverSourceLabel(s.source)} value={s.count}/>)}

        </div>
      </section>

      </>}
      {section==='jobs'&&<>
        <section className="section-block">
          <div className="section-heading"><h2>Caregiver applications</h2><p>Actions tracked on job listings during this reporting period. These are not confirmed hires.</p></div>
          <div className="admin-stat-grid">
            {f.jobApplies.length?f.jobApplies.map(a=><Stat key={a.event_type} label={applicationEventLabel(a.event_type)} value={a.count}/>):<Stat label="Tracked job actions" value={0}/>}
          </div>
        </section>
        <JobSites/>
      </>}
      {section==='advanced'&&<section className="section-block"><div className="section-heading"><h2>Technical diagnostics</h2><p>Technical testing and troubleshooting.</p></div>
          <a className="button secondary" href="/api/admin/health" target="_blank" rel="noopener noreferrer">Open raw system health</a>
        </section>}
      {section==='outreach'&&<>
        <section className="section-block admin-campaigns">
  <div className="section-heading"><h2>What's actually sending</h2>
    <p>Separate outbound channels with independent schedules and caps. A disabled bulk campaign does not stop hourly agency hiring invitations.</p></div>
  <div className="admin-stat-grid">
    <Stat label="Agency hiring invites" value={oc.agencyHiring.enabled?'On':'Off'} sub={oc.agencyHiring.today+' of '+oc.agencyHiring.cap+' sent today, about '+oc.agencyHiring.perHour+' an hour · '+oc.agencyHiring.total+' sent in total'}/>
    <Stat label="Agency inbox alerts" value={oc.agencyInboxAlerts.unclaimedEnabled?'On':'Claimed only'} sub={oc.agencyInboxAlerts.claimedLast24h+' to claimed agencies, '+oc.agencyInboxAlerts.unclaimedLast24h+' to unclaimed in the last 24 hours · hourly, at most one per agency a day'}/>
    <Stat label="General bulk outreach" value={oc.generalBulk.enabled?'On':'Off'} sub="Legacy caregiver reactivation and agency teasers, once a day"/>
    <Stat label="Reactivation reminders" value={oc.reactivationReminders.enabled?'On':'Off'} sub={oc.reactivationReminders.sent+' sent · one reminder per legacy caregiver, once a day'}/>
    <Stat label="Weekly job emails to caregivers" value={oc.weeklyDigest.enabled?'On':'Off'} sub={oc.weeklyDigest.verified+' of '+oc.weeklyDigest.subscribed+' opted-in caregivers verified · '+oc.weeklyDigest.sentLast7Days+' sent in the last 7 days'}/>
    <Stat label="Training-school invitations" value={oc.schools.mode==='automatic'?'On':'Manual'} sub={oc.schools.today+' of '+oc.schools.cap+' sent today · '+oc.schools.intros+' recorded introductions'}/>
  </div>
  <div className="admin-info-note">Each channel has its own switch. Turning off general bulk outreach does not stop agency hiring invites or reminders. Agency inbox alerts always go to agencies that claimed their page; unclaimed agencies get them only while general bulk outreach is on. School invitations have their own switch and daily cap. Weekly job emails go only to caregivers who opted in and verified their email.</div>
</section>
<section className="section-block admin-school-outreach">
  <div className="section-heading"><h2>Maryland training-school prospects</h2><p>Start with freestanding CNA academies and colleges. These are contact leads, not confirmed partners. Drafting an email here does not count as a sent introduction.</p></div>
  <div className="admin-stat-grid">
    <Stat label="Contactable programs" value={f.outreachChannels.schools.contactable}/>
    <Stat label="Recorded school introductions" value={f.outreachChannels.schools.intros}/>
    <Stat label="Programs claimed" value={f.outreachChannels.schools.claimed}/>
    <Stat label="Caregivers referred by schools" value={f.outreachChannels.schools.referrals}/>
  </div>
  <div className="settings-card" style={{marginTop:16}}>
    {f.outreachChannels.schools.prospects.length===0?<p>No contactable, uncontacted programs remain in this sample. Review the directory enrichment queue.</p>:
      f.outreachChannels.schools.prospects.map(p=>{
        const url=p.referralSlug?'https://carejoys.com/school/'+encodeURIComponent(p.referralSlug):'https://carejoys.com/training-programs/maryland';
        const subject='Free career placement resource for your CNA/GNA graduates';
        const body='Hello,\n\nCareJoys helps Maryland caregivers and CNA/GNA graduates discover nearby jobs matched to pay and schedule preferences, without requiring a resume. It is free for programs and graduates.\n\nYour program can review the free resource here: '+url+'\n\nWould your placement coordinator be open to sharing it with upcoming graduates?\n\nCareJoys';
        const href='mailto:'+encodeURIComponent(p.email)+'?subject='+encodeURIComponent(subject)+'&body='+encodeURIComponent(body);
        return <div className="agency-existing-slot" key={p.id} style={{padding:'10px 0',borderBottom:'1px solid var(--lavender)'}}>
          <div><strong>{p.name}</strong><div className="job-meta">{p.type} · {p.city||'Maryland'} · {p.email}</div></div>
          <a className="button secondary" href={href}>Draft intro</a>
        </div>;
      })}
  </div>
</section>

        <section className="section-block">
        <div className="section-heading"><h2>Bulk outreach & test tools</h2><p>{data.outreach.enabled?'Daily sends are on (15:41 UTC).':'Daily sends are off. Set OUTREACH_ENABLED to "true" in wrangler.jsonc to turn them on.'} {data.outreach.unsubscribes} unsubscribed.</p></div>
        <div style={{...grid,gridTemplateColumns:'repeat(auto-fit,minmax(min(380px,100%),1fr))',alignItems:'start'}}>{data.outreach.today.map(t=><div className="settings-card" key={t.kind}>
          <div className="job-meta">{KIND_LABELS[t.kind]}</div>
          <div style={{fontSize:30,fontWeight:600}}>{t.sentToday} / {t.cap}</div>
          <div className="job-meta">sent today{t.kind==='reactivation'?` · ${data.outreach.reactivationQueue} still to reach`:''}</div>
          <div className="empty-actions" style={{marginTop:10}}>
            <button className="button secondary" disabled={busy} onClick={()=>void test(t.kind)}>Send test to me</button>
            <button className="button secondary" disabled={busy||t.sentToday>=t.cap} onClick={()=>void run(t.kind)}>Send today’s remaining</button>
          </div>
        </div>)}
          <div className="settings-card" style={{gridColumn:'1/-1'}}>
            <div className="job-meta">Agency walkthrough</div>
            <div style={{fontWeight:600,margin:'6px 0'}}>{sourceAgency?sourceAgency.name+' (test copy)':'CareJoys Test Agency'}</div>
            <div className="job-meta">Pick a real agency below to copy its profile, current jobs and matched caregivers (or none for a generic Baltimore agency). The live teaser comes to you so you can claim it and onboard like that agency would. The real agency is never contacted or changed, and the copy never shows publicly.</div>
            <input style={{width:'100%',marginTop:10}} className="pipeline-select" value={agencyQuery} onChange={e=>setAgencyQuery(e.target.value)} placeholder="Search agencies (blank = most jobs)" />
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(min(300px,100%),1fr))',gap:4,marginTop:6,maxHeight:220,overflow:'auto'}}>
              {agencyOptions.map(a=><button key={a.id} className={'nav-button '+(sourceAgency?.id===a.id?'active':'')} style={{textAlign:'left'}} onClick={()=>setSourceAgency(sourceAgency?.id===a.id?null:a)}>
                {a.name} · {[a.city,a.state].filter(Boolean).join(', ')} · {a.jobs} jobs · {a.matches} matches{a.claimed?' · claimed':''}
              </button>)}
            </div>
            <input style={{width:'100%',marginTop:8}} className="pipeline-select" type="email" value={testEmail} onChange={e=>setTestEmail(e.target.value)} placeholder="Send to (blank = your admin email), e.g. you+agency@gmail.com" />
            <div className="empty-actions" style={{marginTop:10}}>
              <button className="button secondary" disabled={busy} onClick={()=>void agencyTest()}>Send me a live agency teaser</button>
              <button className="button secondary" disabled={busy} onClick={()=>void agencyTest(true)}>Reset test agency</button>
            </div>
          </div>
        </div>
        <div style={{...grid,marginTop:12}}>
          <Stat label="Legacy caregivers" value={f.reactivation.legacyTotal}/>
          <Stat label="Reactivation sent" value={f.reactivation.sent}/>
          <Stat label="Opened" value={f.reactivation.opened} sub={pct(f.reactivation.opened,f.reactivation.sent)}/>
          <Stat label="Confirmed" value={f.reactivation.completed} sub={`${f.reactivation.activelyLooking} looking`}/>
          <Stat label="Agency teasers" value={f.agencyClaims.teasersSent}/>
          <Stat label="Teasers opened" value={f.agencyClaims.teasersOpened} sub={pct(f.agencyClaims.teasersOpened,f.agencyClaims.teasersSent)}/>
          <Stat label="Agencies claimed" value={f.agencyClaims.claimed} sub={`${f.agencyClaims.claimsRequested} requested`}/>
        </div>
        {data.outreach.recentRuns.length>0&&<div className="settings-card" style={{marginTop:12}}>{data.outreach.recentRuns.map(r=><div className="job-meta" key={r.created_at+r.kind}>{day(r.created_at)} · {KIND_LABELS[r.kind]||r.kind} · {r.trigger} · sent {r.sent}{r.failed?`, failed ${r.failed}`:''}</div>)}</div>}
      </section>
      </>}
      {section==='advanced'&&<><section className="section-block">
        <div className="section-heading"><h2>Traffic</h2><p>{f.traffic.pageViews} page views. Cookie-less, path only.</p></div>
        <div style={{...grid,gridTemplateColumns:'repeat(auto-fit,minmax(min(320px,100%),1fr))'}}>
          <div className="settings-card"><div className="modal-kicker">Top pages</div>{f.traffic.topPaths.map(p=><div className="job-meta" key={p.path}>{p.count} · {p.path}</div>)}</div>
          <div className="settings-card"><div className="modal-kicker">Top sources</div>{f.traffic.topSources.map(s=><div className="job-meta" key={s.source}>{s.count} · {s.source}</div>)}</div>
        </div>
      </section>
      </>}
    </main>
  </div>;

}

type JobSite={site:string;jobs:number;supported:boolean;sampleJobId:string};
type FillTest={ok:boolean;error?:string;currentUrl?:string;filled?:{label:string;key:string|null}[];wouldAsk?:{label:string}[];needsCandidateInBrowser?:{text:string}[];nextAction?:string|null;captcha?:boolean;screenshotJpeg?:string|null;job?:{title:string;employerName:string}};

/** Which job sites current jobs use, which ones "Apply for me" can fill in, and a safe fill-only test. */
function JobSites(){
  const [data,setData]=useState<{total:number;supportedJobs:number;sites:JobSite[]}|null>(null);
  const [testing,setTesting]=useState('');
  const [result,setResult]=useState<FillTest|null>(null);
  useEffect(()=>{api<{total:number;supportedJobs:number;sites:JobSite[]}>('/api/admin/job-sites').then(setData).catch(()=>{})},[]);
  async function test(jobId:string){
    setTesting(jobId);setResult(null);
    try{setResult(await api<FillTest>('/api/admin/apply-test',{method:'POST',body:JSON.stringify({jobId})}))}
    catch(e){setResult({ok:false,error:e instanceof Error?e.message:'Test failed'})}
    finally{setTesting('')}
  }
  if(!data)return null;
  return <section className="section-block">
    <div className="section-heading"><h2>Apply for me · job sites</h2><p>{data.supportedJobs} of {data.total} current jobs are on a job site CareJoys can fill in for caregivers. A test fills page one with a made-up caregiver and stops; it never submits or attaches a file.</p></div>
    <div className="settings-card">
      {data.sites.map(s=><div className="job-meta" key={s.site}>{s.jobs} · {s.site} · {s.supported?'supported':'not yet'}
        {s.supported&&s.sampleJobId&&<> · <button className="text-button" style={{display:'inline',margin:0}} disabled={!!testing} onClick={()=>void test(s.sampleJobId)}>{testing===s.sampleJobId?'Testing…':'Test fill'}</button></>}
      </div>)}
    </div>
    {result&&<div className="settings-card" style={{marginTop:12}}>
      {result.ok?<>
        <div className="modal-kicker">{result.job?.title} · {result.job?.employerName}</div>
        <div className="job-meta">Filled: {(result.filled||[]).map(f=>f.label).join(', ')||'nothing'}</div>
        <div className="job-meta">Would ask the caregiver: {(result.wouldAsk||[]).map(q=>q.label).join(', ')||'nothing'}</div>
        <div className="job-meta">Needs the caregiver in the browser: {(result.needsCandidateInBrowser||[]).map(q=>q.text.slice(0,80)).join(' · ')||'nothing'}{result.captcha?' · CAPTCHA':''}</div>
        <div className="job-meta">Next button: {result.nextAction||'none found'}</div>
        {result.screenshotJpeg&&<img alt="Filled application" src={'data:image/jpeg;base64,'+result.screenshotJpeg} style={{width:'100%',marginTop:12,borderRadius:12}}/>}
      </>:<div className="notice">{result.error}</div>}
    </div>}
  </section>;
}
