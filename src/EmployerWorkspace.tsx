import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { LoginForm, Shell } from './LoginPage';
import { useCaregiverAuth } from './caregiverAuth';
import { rememberDashboard } from './dashboardHome';
import { payLabel } from './jobFormat';
import { AccountMenu, CloseAccountSide } from './AccountLink';
import { AgencyJobsPanel, AgencySuggestions } from './AgencyFinder';
import { JobsWidgetCard } from './JobsWidgetCard';
import { AgencyInbox } from './AgencyInboxTab';
import { TalentCard, type TalentCandidate } from './TalentCard';
import './workspace.css';

type Opening={
  id:string;title:string;role:string;city?:string;state?:string;zip?:string;
  pay_min?:number;pay_max?:number;shift_preferences?:string;status?:string;
  source?:string;agency_organization_id?:string;available_interview_slots?:number;
};
type InterviewSlot={id:string;starts_at:string;duration_minutes:number;timezone:string;status:string};
type AgencyMatch={
  caregiverId:string;name:string;city?:string;state?:string;role?:string;
  certifications?:string;yearsExperience?:number;desiredWage?:string;shifts?:string;
  fitScore:number;freshness?:string;
};
type AgencyNetwork={agency:any|null;hiringProfile:any|null;matches:AgencyMatch[]};
type Candidate=TalentCandidate;
type PipelineRow={
  id:string;opening_id:string;title:string;opening_role:string;caregiver_id:string;
  name:string;city?:string;state?:string;role?:string;certifications?:string;
  match_score?:number;match_reason?:string;stage:string;freshness?:string;interview_at?:string;profilePhotoUrl?:string;
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
  const auth=useCaregiverAuth();
  if(auth.loading)return <div className="loading-screen">Loading CareJoys…</div>;
  return <Shell>
    {auth.isAuthenticated
      ?<div className="login-card">
        <div className="modal-kicker">Signed in as {auth.email}</div>
        <h1>No hiring workspace yet.</h1>
        <p>This email doesn’t have an agency or employer workspace on CareJoys. Set one up in a minute, or sign out and use your agency email.</p>
        <div className="empty-actions"><a className="button" href="/hire-caregivers">Set up hiring</a><button className="button secondary" onClick={auth.logout}>Sign out</button></div>
      </div>
      :<LoginForm next={window.location.pathname+window.location.search} kicker="Agencies and employers" title="Sign in to CareJoys." google={auth.googleAvailable?()=>void auth.loginGoogle():undefined}/>}
  </Shell>;
}

export function EmployerWorkspace(){
  const [session,setSession]=useState<SessionEmployer|null>(null);
  const [authLoading,setAuthLoading]=useState(true);
  const [workspace,setWorkspace]=useState<any>(null);
  const [openings,setOpenings]=useState<Opening[]>([]);
  const [pipeline,setPipeline]=useState<PipelineRow[]>([]);
  const [candidates,setCandidates]=useState<Candidate[]>([]);
  const [agencyNetwork,setAgencyNetwork]=useState<AgencyNetwork>({agency:null,hiringProfile:null,matches:[]});
  const [tab,setTab]=useState<'hiring'|'openings'|'talent'|'pipeline'|'inbox'|'jobs'>(()=>{const t=new URLSearchParams(window.location.search).get('tab');return t==='inbox'?'inbox':'openings'});
  const [inboxWaiting,setInboxWaiting]=useState(0);
  const [loading,setLoading]=useState(false);
  const [message,setMessageText]=useState('');
  const [messageTone,setMessageTone]=useState<'ok'|'info'|'error'>('ok');
  function setMessage(text:string,tone:'ok'|'info'|'error'='ok'){setMessageText(text);setMessageTone(tone)}
  const [pendingApproval,setPendingApproval]=useState(false);
  const [approvalKnown,setApprovalKnown]=useState(false);
  const [billing,setBilling]=useState<{enabled:boolean;subscribed:boolean;freeContacts:number;freeContactsRemaining:number|null}|null>(null);
  const [filters,setFilters]=useState({role:'',zip:'',radius:'25',state:'',freshness:'all'});
  const [showOpening,setShowOpening]=useState(false);
  const [slotsFor,setSlotsFor]=useState<Opening|null>(null);
  const [slotInputs,setSlotInputs]=useState([{startsAt:'',durationMinutes:30}]);
  const [existingSlots,setExistingSlots]=useState<InterviewSlot[]>([]);
  const [slotNotice,setSlotNotice]=useState('');
  const [intakeOpeningId,setIntakeOpeningId]=useState(()=>new URLSearchParams(window.location.search).get('opening')||'');
  const intakeHandled=useRef(false);

  async function loadSession(){
    try{
      const data=await api<{employer:SessionEmployer}>('/api/session');
      setSession(data.employer);
      rememberDashboard('app');
    }catch{
      setSession(null);
    }finally{
      setAuthLoading(false);
    }
  }

  async function refreshWorkspace(employerId=session?.id){
    if(!employerId)return;
    setLoading(true);
    try{
      const data=await api<any>('/api/workspace');
      setWorkspace(data.workspace);
      setOpenings(data.openings||[]);
      setPendingApproval(data.approval?.approved===false);
      setApprovalKnown(true);
      const p=data.approval?.approved===false?{pipeline:[]}:await api<any>('/api/pipeline');
      setPipeline(p.pipeline||[]);
      const network=await api<AgencyNetwork>('/api/agency/network');
      setAgencyNetwork(network);
      setBilling(await api<any>('/api/billing').catch(()=>null));
    }catch(e){
      if(e instanceof Error&&e.message==='Sign in required')setSession(null);
      else setMessage(e instanceof Error?e.message:'Could not load workspace','error');
    }finally{
      setLoading(false);
    }
  }

  useEffect(()=>{void loadSession()},[]);
  // A claim link lands on /app?tab=hiring; open that tab once the linked agency has loaded.
  useEffect(()=>{
    const t=new URLSearchParams(window.location.search).get('tab');
    if(agencyNetwork.agency&&(t==='hiring'||t==='jobs'))setTab(t);
  },[agencyNetwork.agency]);
  useEffect(()=>{if(session)void refreshWorkspace(session.id)},[session?.id]);

  useEffect(()=>{
    if(!session||!approvalKnown||pendingApproval||intakeHandled.current||openings.length===0)return;
    const params=new URLSearchParams(window.location.search);
    const openingId=params.get('opening')||'';
    const shouldMatch=params.get('match')==='1';
    if(!openingId||!shouldMatch||!openings.some(o=>o.id===openingId))return;
    intakeHandled.current=true;
    setIntakeOpeningId(openingId);
    window.history.replaceState({},'', '/app');
    void runMatch(openingId);
  },[session?.id,openings.length,approvalKnown,pendingApproval]);

  async function searchTalent(e?:FormEvent){
    e?.preventDefault();
    if(pendingApproval)return;
    setMessage('Searching caregiver network…','info');
    const params=new URLSearchParams();
    Object.entries(filters).forEach(([k,v])=>{if(v&&v!=='all')params.set(k,v)});
    try{
      const data=await api<any>('/api/candidates?'+params);
      setCandidates(data.candidates||[]);
      setTab('talent');
      setMessage('');
    }catch(error){setMessage(error instanceof Error?error.message:'Could not search caregivers','error');}
  }

  async function createOpening(e:FormEvent<HTMLFormElement>){
    e.preventDefault();
    if(!session)return;
    const fd=new FormData(e.currentTarget);
    const data=Object.fromEntries(fd.entries()) as any;
    data.transportationRequired=fd.get('transportationRequired')==='on';
    try{
      const result=await api<{id:string}>('/api/openings',{method:'POST',body:JSON.stringify(data)});
      setShowOpening(false);
      setIntakeOpeningId(result.id);
      await refreshWorkspace();
      await runMatch(result.id);
    }catch(error){
      setMessage(error instanceof Error?error.message:'Could not create opening','error');
    }
  }

  async function runMatch(openingId:string){
    if(!session)return;
    if(pendingApproval){setMessage('');setTab('openings');return;}
    setMessage('Matching caregivers…','info');
    try{
      const result=await api<any>('/api/openings/'+openingId+'/match',{method:'POST'});
      if(result.matched)setMessage(result.matched+' caregiver'+(result.matched===1?'':'s')+' matched. Review the matches, then add interview times before contacting candidates.');
      else setMessage('No caregivers match this opening yet. CareJoys keeps looking and adds matches as caregivers near you join.','info');
      await refreshWorkspace();
      setTab('pipeline');
    }catch(error){
      setMessage(error instanceof Error?error.message:'Could not match caregivers','error');
    }
  }

  async function contact(openingId:string){
    if(!session||pendingApproval)return;
    setMessage('Contacting top matches…','info');
    try{
      const result=await api<any>('/api/openings/'+openingId+'/contact',{method:'POST',body:JSON.stringify({limit:5})});
      setMessage(result.sent+' caregiver'+(result.sent===1?'':'s')+' contacted'+(result.failed?' · '+result.failed+' failed':'')+'.',result.sent?'ok':'info');
      await refreshWorkspace();
      setTab('pipeline');
    }catch(error){
      setMessage(error instanceof Error?error.message:'Could not contact matches','error');
    }
  }

  async function openBilling(kind:'checkout'|'portal'){
    try{
      const result=await api<{url:string}>('/api/billing/'+kind,{method:'POST'});
      window.location.href=result.url;
    }catch(error){setMessage(error instanceof Error?error.message:'Could not open billing','error')}
  }

  async function moveStage(id:string,stage:string){
    if(!session)return;
    await api('/api/pipeline/'+id,{method:'PATCH',body:JSON.stringify({stage})});
    await refreshWorkspace();
  }

  async function openInterviewSlots(opening:Opening){
    setSlotNotice('');setExistingSlots([]);setSlotInputs([{startsAt:'',durationMinutes:30}]);setSlotsFor(opening);
    try{
      const data=await api<{slots:InterviewSlot[]}>('/api/openings/'+opening.id+'/interview-slots');
      setExistingSlots((data.slots||[]).filter(s=>s.status==='available'&&Date.parse(s.starts_at)>Date.now()));
    }catch(error){setSlotNotice(error instanceof Error?error.message:'Could not load existing interview times')}
  }

  async function cancelInterviewSlot(id:string){
    if(!slotsFor||!window.confirm('Remove this available interview time?'))return;
    try{
      await api('/api/openings/'+slotsFor.id+'/interview-slots',{method:'POST',body:JSON.stringify({action:'cancel',slotId:id})});
      setExistingSlots(items=>items.filter(s=>s.id!==id));
      setSlotNotice('Interview time removed.');
      await refreshWorkspace();
    }catch(error){setSlotNotice(error instanceof Error?error.message:'Could not remove the interview time')}
  }

  async function saveSlots(e:FormEvent){
    e.preventDefault();
    if(!session||!slotsFor)return;
    const timezone=Intl.DateTimeFormat().resolvedOptions().timeZone||'America/New_York';
    const slots=slotInputs
      .filter(s=>s.startsAt)
      .map(s=>({startsAt:new Date(s.startsAt).toISOString(),durationMinutes:s.durationMinutes,timezone}));
    try{
      const result=await api<any>('/api/openings/'+slotsFor.id+'/interview-slots',{method:'POST',body:JSON.stringify({slots})});
      setMessage(result.added+' interview time'+(result.added===1?'':'s')+' added. Review your matches, then contact the strongest candidates.');
      setSlotsFor(null);
      setSlotInputs([{startsAt:'',durationMinutes:30}]);
      await refreshWorkspace();
      setTab(pendingApproval?'openings':'pipeline');
    }catch(error){
      setMessage(error instanceof Error?error.message:'Could not save interview times','error');
    }
  }

  async function saveHiringProfile(e:FormEvent<HTMLFormElement>){
    e.preventDefault();
    const fd=new FormData(e.currentTarget);
    const data={
      hiringStatus:String(fd.get('hiringStatus')||'unknown'),
      roles:String(fd.get('roles')||''),
      shifts:String(fd.get('shifts')||''),
      payMin:Number(fd.get('payMin')||0)||null,
      payMax:Number(fd.get('payMax')||0)||null,
      serviceRadiusMiles:Number(fd.get('serviceRadiusMiles')||0)||null,
      serviceAreas:String(fd.get('serviceAreas')||''),
      transportationRequired:fd.get('transportationRequired')==='on',
      requirements:String(fd.get('requirements')||'')
    };
    setMessage('Saving hiring preferences and refreshing matches…','info');
    try{
      await api('/api/agency/hiring-profile',{method:'POST',body:JSON.stringify(data)});
      setMessage('Hiring preferences saved. CareJoys will keep matching your agency to caregivers.');
      await refreshWorkspace();
    }catch(error){
      setMessage(error instanceof Error?error.message:'Could not save hiring preferences','error');
    }
  }

  async function logout(){
    await api('/api/auth/logout',{method:'POST'});
    setSession(null);setWorkspace(null);setOpenings([]);setPipeline([]);
  }

  const counts=useMemo(()=>{
    const by=(s:string)=>pipeline.filter(p=>p.stage===s).length;
    return{matched:by('matched'),contacted:by('contacted'),interested:by('interested'),interview:by('interview'),hired:by('hired')};
  },[pipeline]);
  const visiblePipeline=useMemo(
    ()=>intakeOpeningId?pipeline.filter(p=>p.opening_id===intakeOpeningId):pipeline,
    [pipeline,intakeOpeningId]
  );
  const intakeOpening=useMemo(
    ()=>openings.find(o=>o.id===intakeOpeningId)||null,
    [openings,intakeOpeningId]
  );

  if(authLoading)return <div className="loading-screen">Loading CareJoys…</div>;
  if(!session)return <EmployerSignIn/>;
  if(loading&&!workspace)return <div className="loading-screen">Loading CareJoys…</div>;

  return <div>
    <header className="app-header"><div className="app-wrap header-inner">
      <a className="brand" href="/">CareJoys</a>
      <nav className="app-nav">
        {agencyNetwork.agency&&<button className={'nav-button '+(tab==='inbox'?'active':'')} onClick={()=>setTab('inbox')}>Inbox{inboxWaiting?` (${inboxWaiting})`:''}</button>}
        <button className={'nav-button '+(tab==='openings'?'active':'')} onClick={()=>{setIntakeOpeningId('');setTab('openings')}}>Openings</button>
        <button className={'nav-button '+(tab==='pipeline'?'active':'')} onClick={()=>{setIntakeOpeningId('');setTab('pipeline')}}>Pipeline</button>
        <button className={'nav-button '+(tab==='talent'?'active':'')} onClick={()=>setTab('talent')} disabled={pendingApproval} title={pendingApproval?'Available after approval':undefined}>Talent network</button>
        {agencyNetwork.agency&&<button className={'nav-button '+(tab==='jobs'?'active':'')} onClick={()=>setTab('jobs')}>Jobs</button>}
        {agencyNetwork.agency&&<button className={'nav-button '+(tab==='hiring'?'active':'')} onClick={()=>setTab('hiring')}>Hiring preferences</button>}
        <WorkspaceAccount logout={logout}/>
      </nav>
    </div></header>

    <main className="app-wrap app-content">
      <section className="page-head page-head-row">
        <div><h1>{workspace?.company_name||session.companyName||'Recruiting workspace'}</h1><p>From hiring need to interested caregiver to booked interview.</p></div>
        <div className="header-action"><button className="button" onClick={()=>setShowOpening(true)}>+ New opening</button></div>
      </section>

      <div className="result-summary workspace-summary">
        <strong>{openings.filter(o=>o.status==='open').length} open roles</strong>
        <span>{pendingApproval?'—':counts.matched} matched</span><span>{pendingApproval?'—':counts.contacted} contacted</span><span>{pendingApproval?'—':counts.interested} interested</span>
        <span>{pendingApproval?'—':counts.interview} interviews</span><span>{pendingApproval?'—':counts.hired} hired</span>
      </div>
      <div className="pipeline-legend"><span>Matched</span><b>→</b><span>Interview times</span><b>→</b><span>Contacted</span><b>→</b><span>Interested</span><b>→</b><span>Interview booked</span><b>→</b><span>Hired</span></div>
      {pendingApproval&&<div className="alert-status workspace-alert" role="status"><strong>Caregiver matching is awaiting account approval.</strong> You can create openings and add interview availability now. Caregiver profiles and outreach unlock after approval. Use a verified agency email or claim your agency to verify automatically, or wait for manual review. <button className="text-button" onClick={()=>void refreshWorkspace()} disabled={loading}>Recheck approval</button></div>}
      {billing?.enabled&&<div className="settings-card workspace-alert" style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,flexWrap:'wrap'}}>
        {billing.subscribed
          ?<><span><strong>CareJoys Pro</strong> · unlimited candidate contacts</span><button className="button secondary" onClick={()=>void openBilling('portal')}>Manage billing</button></>
          :<><span><strong>{billing.freeContactsRemaining??0} of {billing.freeContacts}</strong> free candidate contacts left. Matching and browsing are always free.</span><button className="button" onClick={()=>void openBilling('checkout')}>Upgrade</button></>}
      </div>}
      {message&&<div className={'alert-status workspace-alert'+(messageTone==='ok'?'':' alert-'+messageTone)}>{messageTone==='ok'?'✓ ':''}{message}</div>}

      {agencyNetwork.agency&&<div hidden={tab!=='inbox'}><AgencyInbox onCount={setInboxWaiting}/></div>}

      {tab==='openings'&&<section className="section-block">
        <div className="section-heading"><h2>Openings</h2><p>Describe the role once. CareJoys matches the network; you add interview times before outreach.</p></div>
        {openings.length===0?<div className="empty"><strong>No openings yet.</strong><div>Add the first job you want CareJoys to recruit for.</div><div className="empty-actions"><button className="button secondary" onClick={()=>setShowOpening(true)}>Create opening</button></div></div>:
        <div className="job-list">{openings.map((o,i)=><article key={o.id} className={'job-card '+cardTone(i)}>
          <div className="job-card-main">
            <div className="job-card-title-row"><h3>{o.title}</h3></div>
            <div className="job-meta">{[o.role,o.city,o.state,o.zip].filter(Boolean).join(' · ')}</div>
            <div className="job-badges">
              {o.shift_preferences&&<span className="badge">{o.shift_preferences}</span>}
              {payLabel({payMin:o.pay_min,payMax:o.pay_max,payPeriod:'hour'})&&<span className="badge">{payLabel({payMin:o.pay_min,payMax:o.pay_max,payPeriod:'hour'})}</span>}
              <span className="status">{o.source==='agency_profile'?'Always-on':o.source==='employer_intake'?'Created from your request':(o.status||'open')}</span>
              {Number(o.available_interview_slots||0)>0&&<span className="badge">{o.available_interview_slots} interview time{Number(o.available_interview_slots)===1?'':'s'} ready</span>}
            </div>
          </div>
          <div className="job-card-side opening-actions">
            {/* One primary button per card: the next step when interview times are missing, otherwise matches. */}
            <button className={Number(o.available_interview_slots||0)>0?'button':'button secondary'} disabled={pendingApproval} title={pendingApproval?'Matching unlocks after account approval':undefined} onClick={()=>{setIntakeOpeningId(o.id);void runMatch(o.id)}}>{pendingApproval?'Matches available after approval':'View matches'}</button>
            {Number(o.available_interview_slots||0)>0
              ?<><button className="button secondary" onClick={()=>void openInterviewSlots(o)}>Manage interview times</button><button className="button secondary" disabled={pendingApproval} onClick={()=>contact(o.id)}>Contact top 5</button></>
              // Contacting needs a time interested caregivers can book, so the first step is the button itself, not a disabled one.
              :<><button className="button" onClick={()=>void openInterviewSlots(o)}>Add interview times</button><span className="opening-next-step">Add an available time now. After account approval, match and contact caregivers.</span></>}
          </div>
        </article>)}</div>}
      </section>}

      {tab==='pipeline'&&<section className="section-block">
        <div className="section-heading">
          <h2>{intakeOpening?'Your caregiver matches':'Candidate pipeline'}</h2>
          <p>{intakeOpening?'CareJoys ranked the strongest local matches for this opening.':'Interested responses and interview bookings update automatically.'}</p>
        </div>
        {intakeOpening&&<div className="agency-next-action">
          <div>
            <strong>{Number(intakeOpening.available_interview_slots||0)>0?'Ready to contact candidates':'Next: add interview times'}</strong>
            <p>{Number(intakeOpening.available_interview_slots||0)>0?'Your interview availability is ready. Contact the strongest matches and interested caregivers can book immediately.':'Add at least one interview time before outreach so an interested caregiver can go straight from “yes” to a booked interview.'}</p>
          </div>
          <div className="hero-actions">
            <button className="button secondary" onClick={()=>void openInterviewSlots(intakeOpening)}>{Number(intakeOpening.available_interview_slots||0)>0?'Manage interview times':'Add interview times'}</button>
            {Number(intakeOpening.available_interview_slots||0)>0&&<button className="button" disabled={pendingApproval} onClick={()=>contact(intakeOpening.id)}>Contact top 5</button>}
          </div>
        </div>}
        {visiblePipeline.length===0?<div className="empty"><strong>No matched caregivers yet.</strong><div>CareJoys will keep scoring the network as caregiver availability changes.</div></div>:
        <div className="job-list">{visiblePipeline.map((row,i)=><article className={'job-card '+cardTone(i)} key={row.id}>
          <div className="job-card-main">
            <div className="job-card-title-row"><div className="candidate-name-row">{row.profilePhotoUrl?<img className="candidate-avatar" src={row.profilePhotoUrl} alt="" />:<span className="candidate-avatar candidate-avatar-empty">{row.name?.slice(0,1)||'?'}</span>}<h3>{row.name}</h3></div></div>
            <div className="job-meta">{[row.role,row.city,row.state].filter(Boolean).join(' · ')}</div>
            <div className="job-badges"><span className="badge">{row.match_score||0}% match</span><span className="status">{row.title}</span><span className="status">{row.freshness}</span>{row.interview_at&&<span className="status applied">{new Date(row.interview_at).toLocaleString()}</span>}</div>
          </div>
          <div className="job-card-side">
            <select className="pipeline-select" value={row.stage} onChange={e=>moveStage(row.id,e.target.value)}>
              <option value="matched">Matched</option><option value="contacted">Contacted</option><option value="interested">Interested</option>
              <option value="interview">Interview booked</option><option value="hired">Hired</option><option value="rejected">Rejected</option>
            </select>
          </div>
        </article>)}</div>}
      </section>}

      {tab==='talent'&&<section className="section-block">
        <div className="section-heading"><h2>Talent network</h2><p>Confirmed availability ranks above older, unconfirmed profiles.</p></div>
        <form className="talent-filters settings-card" onSubmit={searchTalent}>
          <input value={filters.role} onChange={e=>setFilters({...filters,role:e.target.value})} placeholder="Role: CNA, HHA, caregiver" />
          <input value={filters.zip} onChange={e=>setFilters({...filters,zip:e.target.value})} placeholder="ZIP" inputMode="numeric" />
          <select value={filters.radius} onChange={e=>setFilters({...filters,radius:e.target.value})} aria-label="Distance from ZIP"><option value="10">Within 10 mi</option><option value="25">Within 25 mi</option><option value="50">Within 50 mi</option><option value="100">Within 100 mi</option></select>
          <input value={filters.state} onChange={e=>setFilters({...filters,state:e.target.value})} placeholder="State" />
          <select value={filters.freshness} onChange={e=>setFilters({...filters,freshness:e.target.value})}><option value="all">Any availability</option><option value="confirmed">Confirmed in last 30 days</option></select>
          <button className="button">Search</button>
        </form>
        {candidates.length===0?<div className="empty"><strong>Search the network.</strong><div>Confirmed candidates rank higher in matching.</div></div>:
        <div className="job-list">{candidates.map((candidate,i)=><TalentCard candidate={candidate} tone={cardTone(i)} key={candidate.id}/>)}</div>}
      </section>}

      {!loading&&workspace&&!agencyNetwork.agency&&tab==='openings'&&<AgencySuggestions onLinked={()=>void refreshWorkspace()}/>}

      {tab==='hiring'&&agencyNetwork.agency&&<section className="section-block">
        <div className="section-heading"><h2>Always-on hiring preferences</h2><p>Optional: save your usual hiring needs so CareJoys can keep scoring new caregivers even when you do not have an urgent opening.</p></div>
        <div className="agency-profile-grid">
          <div className="settings-card agency-profile-card">
            <div className="modal-kicker">Licensed provider</div>
            <h3>{agencyNetwork.agency.name}</h3>
            <div className="job-meta">{[agencyNetwork.agency.city,agencyNetwork.agency.state,agencyNetwork.agency.providerTypes].filter(Boolean).join(' · ')}</div>
            <div className="job-badges">
              <span className="badge">{agencyNetwork.agency.currentHiringSignal==='hiring_detected'?'Careers page shows hiring':agencyNetwork.agency.currentHiringSignal||'Hiring unknown'}</span>
              {agencyNetwork.agency.website&&<a className="text-link" href={agencyNetwork.agency.website} target="_blank">Website ↗</a>}
              {agencyNetwork.agency.careersUrl&&<a className="text-link" href={agencyNetwork.agency.careersUrl} target="_blank">Careers ↗</a>}
            </div>
          </div>
          <form className="settings-card intake-form" onSubmit={saveHiringProfile} key={agencyNetwork.hiringProfile?.updated_at||'profile'}>
            <div className="form-grid">
              <label>Hiring status<select name="hiringStatus" defaultValue={agencyNetwork.hiringProfile?.hiring_status||'unknown'}><option value="always_hiring">Always hiring good caregivers</option><option value="hiring">Hiring now</option><option value="not_hiring">Not hiring right now</option><option value="unknown">Not sure</option></select></label>
              <label>Roles<input name="roles" defaultValue={agencyNetwork.hiringProfile?.roles||agencyNetwork.agency.inferredRoles||''} placeholder="CNA, HHA, PCA, Caregiver" /></label>
            </div>
            <div className="form-grid"><label>Min pay / hr<input name="payMin" type="number" defaultValue={agencyNetwork.hiringProfile?.pay_min||''} /></label><label>Max pay / hr<input name="payMax" type="number" defaultValue={agencyNetwork.hiringProfile?.pay_max||''} /></label></div>
            <div className="form-grid"><label>Shifts<input name="shifts" defaultValue={agencyNetwork.hiringProfile?.shifts||''} placeholder="Days, nights, weekends" /></label><label>Service radius<input name="serviceRadiusMiles" type="number" defaultValue={agencyNetwork.hiringProfile?.service_radius_miles||''} placeholder="25" /></label></div>
            <label>Service areas<input name="serviceAreas" defaultValue={agencyNetwork.hiringProfile?.service_areas||[agencyNetwork.agency.city,agencyNetwork.agency.state].filter(Boolean).join(', ')} placeholder="Baltimore County, Towson, Timonium…" /></label>
            <label>Requirements<textarea name="requirements" rows={3} defaultValue={agencyNetwork.hiringProfile?.requirements||''} placeholder="Credentials, experience, schedule, client requirements…" /></label>
            <label className="check-row"><input type="checkbox" name="transportationRequired" defaultChecked={!!agencyNetwork.hiringProfile?.transportation_required} /><span>Reliable transportation required</span></label>
            <button className="button">Save hiring preferences</button>
          </form>
        </div>
        <div className="section-heading agency-match-head"><h2>Continuous matches</h2><p>{agencyNetwork.matches.length} caregivers currently score against these preferences.</p></div>
        {agencyNetwork.matches.length===0?<div className="empty"><strong>No local matches yet.</strong><div>CareJoys will keep this profile active as the network grows.</div></div>:
        <div className="job-list">{agencyNetwork.matches.slice(0,20).map((match,i)=><article className={'job-card '+cardTone(i)} key={match.caregiverId}>
          <div className="job-card-main"><h3>{match.name}</h3><div className="job-meta">{[match.role,match.city,match.state].filter(Boolean).join(' · ')}</div>
          <div className="job-badges"><span className="badge">{match.fitScore}% fit</span><span className="status">{match.freshness}</span>{match.desiredWage&&<span className="badge">{match.desiredWage}</span>}</div>
          {match.certifications&&<div className="job-card-cue">{match.certifications}</div>}</div>
        </article>)}</div>}
      </section>}

      {tab==='jobs'&&agencyNetwork.agency&&<section className="section-block">
        <JobsWidgetCard agencyId={agencyNetwork.agency.id}/>
        <AgencyJobsPanel/>
      </section>}

      {showOpening&&<div className="modal-backdrop" onMouseDown={()=>setShowOpening(false)}><div className="modal-panel" onMouseDown={e=>e.stopPropagation()}>
        <button className="modal-close" onClick={()=>setShowOpening(false)}>×</button>
        <div className="modal-kicker">New opening</div><h2>Who do you need?</h2><p className="modal-intro">Add the role once. CareJoys uses it to rank the caregiver network immediately.</p>
        <form className="intake-form" onSubmit={createOpening}>
          <label>Job title<input name="title" required placeholder="CNA — day shift" /></label>
          <div className="form-grid"><label>Role<select name="role" required defaultValue=""><option value="" disabled>Select</option><option>CNA</option><option>GNA</option><option>HHA</option><option>PCA</option><option>Caregiver</option><option>DSP</option></select></label><label>ZIP<input name="zip" /></label></div>
          <div className="form-grid"><label>City<input name="city" /></label><label>State<input name="state" /></label></div>
          <div className="form-grid"><label>Min pay / hr<input type="number" name="payMin" /></label><label>Max pay / hr<input type="number" name="payMax" /></label></div>
          <label>Shift<input name="shifts" placeholder="Days, nights, weekends" /></label>
          <label>Requirements<textarea name="requirements" rows={4} placeholder="Experience, credential, schedule, client requirements..." /></label>
          <label className="check-row"><input type="checkbox" name="transportationRequired" /><span>Reliable transportation required</span></label>
          <button className="button submit-button">{pendingApproval?'Create opening':'Create & match'}</button>
        </form>
      </div></div>}

      {slotsFor&&<div className="modal-backdrop" onMouseDown={()=>setSlotsFor(null)}><div className="modal-panel" onMouseDown={e=>e.stopPropagation()}>
        <button className="modal-close" onClick={()=>setSlotsFor(null)}>×</button>
        <div className="modal-kicker">Interview availability</div><h2>Add times caregivers can book.</h2><p className="modal-intro">Interested caregivers see these times immediately, so a “yes” can become a booked interview in the same session.</p>
        {existingSlots.length>0&&<div className="agency-existing-slots"><strong>Available times</strong>{existingSlots.map(s=><div className="agency-existing-slot" key={s.id}><span>{new Date(s.starts_at).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'})} · {s.duration_minutes} min</span><button className="text-button" type="button" onClick={()=>void cancelInterviewSlot(s.id)}>Remove</button></div>)}</div>}
        {slotNotice&&<p className="notice" role="status">{slotNotice}</p>}
        <form className="intake-form" onSubmit={saveSlots}>
          {slotInputs.map((slot,index)=><div className="form-grid" key={index}><label>Interview time<input type="datetime-local" value={slot.startsAt} onChange={e=>setSlotInputs(slotInputs.map((s,i)=>i===index?{...s,startsAt:e.target.value}:s))} required /></label><label>Duration<select value={slot.durationMinutes} onChange={e=>setSlotInputs(slotInputs.map((s,i)=>i===index?{...s,durationMinutes:Number(e.target.value)}:s))}><option value={15}>15 min</option><option value={30}>30 min</option><option value={45}>45 min</option><option value={60}>60 min</option></select></label></div>)}
          {slotInputs.length<5&&<button type="button" className="button secondary" onClick={()=>setSlotInputs([...slotInputs,{startsAt:'',durationMinutes:30}])}>+ Add another time</button>}
          <button className="button submit-button">Save interview times</button>
        </form>
      </div></div>}
    </main>
    <footer className="app-footer"><div className="app-wrap">CareJoys · Caregivers ready to work. Interviews ready for you.<CloseWorkspace/></div></footer>
  </div>;
}

/** Only a shared sign-in can close the workspace, since closing is per email. */
function CloseWorkspace(){
  const auth=useCaregiverAuth();
  return auth.isAuthenticated?<CloseAccountSide side="hiring"/>:null;
}

/** The account menu, or a plain Sign out for an older hiring-only session that has no shared sign-in. */
function WorkspaceAccount({logout}:{logout:()=>void}){
  const auth=useCaregiverAuth();
  if(auth.loading)return null;
  return auth.isAuthenticated?<AccountMenu/>:<button className="nav-button" onClick={logout}>Sign out</button>;
}
