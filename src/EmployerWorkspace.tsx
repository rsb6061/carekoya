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
import { ScheduleEditor } from './ScheduleEditor';
import { MatchList, type MatchRow } from './MatchList';
import { CandidatePage, CandidatePanel, type CandidateActions } from './CandidatePanel';
import { EmailTemplatesModal } from './EmailTemplatesModal';
import { mergeTemplates, type EmailTemplate } from './emailTemplateFill';
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
type PipelineRow=MatchRow;
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
  const [talentState,setTalentState]=useState<'idle'|'loading'|'ready'|'error'>('idle');
  const [talentTotal,setTalentTotal]=useState(0);
  const [talentSearchedZip,setTalentSearchedZip]=useState('');
  const firstTalentLoad=useRef('');
  const [agencyNetwork,setAgencyNetwork]=useState<AgencyNetwork>({agency:null,hiringProfile:null,matches:[]});
  const [tab,setTab]=useState<'hiring'|'openings'|'talent'|'pipeline'|'jobs'>(()=>{const q=new URLSearchParams(window.location.search),t=q.get('tab');return t==='inbox'||t==='candidates'||q.get('candidate')?'pipeline':'openings'});
  const [inboxWaiting,setInboxWaiting]=useState(0);
  const [loading,setLoading]=useState(false);
  const [message,setMessageText]=useState('');
  const [messageTone,setMessageTone]=useState<'ok'|'info'|'error'>('ok');
  function setMessage(text:string,tone:'ok'|'info'|'error'='ok'){setMessageText(text);setMessageTone(tone)}
  const [pendingApproval,setPendingApproval]=useState(false);
  const [approvalKnown,setApprovalKnown]=useState(false);
  const [billing,setBilling]=useState<{enabled:boolean;subscribed:boolean;freeContacts:number;freeContactsRemaining:number|null;yearly?:boolean}|null>(null);
  const [filters,setFilters]=useState({role:'',zip:'',radius:'all',state:'',freshness:'all'});
  const [showOpening,setShowOpening]=useState(false);
  const [slotsFor,setSlotsFor]=useState<Opening|null>(null);
  const [slotInputs,setSlotInputs]=useState([{startsAt:'',durationMinutes:30}]);
  const [existingSlots,setExistingSlots]=useState<InterviewSlot[]>([]);
  const [slotNotice,setSlotNotice]=useState('');
  const [intakeOpeningId,setIntakeOpeningId]=useState(()=>new URLSearchParams(window.location.search).get('opening')||'');
  const intakeHandled=useRef(false);
  const [panelRowId,setPanelRowId]=useState('');
  const [pageRowId,setPageRowId]=useState(()=>new URLSearchParams(window.location.search).get('candidate')||'');
  const [candidateView,setCandidateView]=useState<'active'|'favorites'|'archived'>('active');
  const [savedTemplates,setSavedTemplates]=useState<EmailTemplate[]>([]);
  const [showTemplates,setShowTemplates]=useState(false);

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
      if(network.agency)void api<{items:{stage:string}[]}>('/api/agency/inbox').then(d=>setInboxWaiting((d.items||[]).filter(i=>i.stage==='new').length)).catch(()=>{});
      setBilling(await api<any>('/api/billing').catch(()=>null));
      setSavedTemplates((await api<{templates:EmailTemplate[]}>('/api/email-templates').catch(()=>({templates:[]}))).templates||[]);
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

  async function searchTalent(e?:FormEvent,chosen=filters){
    e?.preventDefault();
    if(pendingApproval)return;
    setTalentState('loading');
    const params=new URLSearchParams();
    Object.entries(chosen).forEach(([k,v])=>{if(v&&(k==='radius'||v!=='all'))params.set(k,v)});
    const primaryRole=openings.find(o=>o.status==='open')?.role;
    if(primaryRole&&!chosen.role)params.set('preferredRole',primaryRole);
    try{
      const data=await api<{total:number;candidates:Candidate[]}>('/api/candidates?'+params.toString());
      setCandidates(data.candidates||[]);
      setTalentTotal(data.total||0);
      setTalentSearchedZip(chosen.zip);
      setTalentState('ready');
      setTab('talent');
      setMessage('');
    }catch(error){
      setTalentState('error');
      setMessage(error instanceof Error?error.message:'Could not search caregivers','error');
    }
  }

  // The talent tab opens as a real directory, not a blank search form. The employer ZIP
  // supplies ranking distance; the default does not silently hide the remaining network.
  useEffect(()=>{
    if(tab!=='talent'||!session||!approvalKnown||pendingApproval||firstTalentLoad.current===session.id)return;
    firstTalentLoad.current=session.id;
    const homeZip=String(workspace?.zip||session.zip||openings.find(o=>o.status==='open')?.zip||'').trim().slice(0,5);
    const initial={...filters,zip:filters.zip||homeZip,radius:'all'};
    setFilters(initial);
    void searchTalent(undefined,initial);
  },[tab,session?.id,approvalKnown,pendingApproval,workspace?.zip,openings.length]);

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
      if(result.matched)setMessage(result.matched+' caregiver'+(result.matched===1?'':'s')+' matched. Pick who to invite below.');
      else setMessage('No caregivers match this opening yet. CareJoys keeps looking and adds matches as caregivers near you join.','info');
      await refreshWorkspace();
      setIntakeOpeningId(openingId);
      setTab('pipeline');
    }catch(error){
      setMessage(error instanceof Error?error.message:'Could not match caregivers','error');
    }
  }

  /** Invites the chosen caregivers, one request per opening they matched. */
  async function invite(rows:PipelineRow[]){
    if(!session||pendingApproval||!rows.length)return;
    setMessage('Sending invitations…','info');
    let sent=0,failed=0;
    try{
      for(const openingId of [...new Set(rows.map(r=>r.opening_id))]){
        const ids=rows.filter(r=>r.opening_id===openingId).map(r=>r.id);
        const result=await api<any>('/api/openings/'+openingId+'/contact',{method:'POST',body:JSON.stringify({pipelineIds:ids})});
        sent+=Number(result.sent||0);failed+=Number(result.failed||0);
      }
      setMessage(sent?sent+' caregiver'+(sent===1?'':'s')+' invited. Each one gets an email with this job and can say they’re interested.'+(failed?' '+failed+' failed.':''):(failed?'No invitations were delivered. '+failed+' failed.':'Those caregivers can’t be invited right now.'),sent?'ok':'info');
    }catch(error){
      setMessage(error instanceof Error?error.message:'Could not send invitations','error');
    }
    await refreshWorkspace();
  }

  async function openBilling(kind:'checkout'|'portal',plan:'monthly'|'yearly'='monthly'){
    try{
      const result=await api<{url:string}>('/api/billing/'+kind,{method:'POST',body:JSON.stringify({plan})});
      window.location.href=result.url;
    }catch(error){setMessage(error instanceof Error?error.message:'Could not open billing','error')}
  }

  const patchRow=(id:string,change:Partial<PipelineRow>)=>setPipeline(rows=>rows.map(r=>r.id===id?{...r,...change}:r));
  async function saveNotes(row:PipelineRow,notes:string){
    try{await api('/api/pipeline/'+row.id,{method:'PATCH',body:JSON.stringify({notes})});patchRow(row.id,{employer_notes:notes})}
    catch(error){setMessage(error instanceof Error?error.message:'Could not save notes','error')}
  }
  async function favorite(row:PipelineRow,on:boolean){
    patchRow(row.id,{favorite:on});
    try{await api('/api/pipeline/'+row.id,{method:'PATCH',body:JSON.stringify({favorite:on})})}
    catch(error){patchRow(row.id,{favorite:!on});setMessage(error instanceof Error?error.message:'Could not save this caregiver','error')}
  }
  async function restore(row:PipelineRow){
    try{
      await api('/api/pipeline/'+row.id,{method:'PATCH',body:JSON.stringify({stage:'restore'})});
      setMessage(row.name+' is back in your candidates.');
      await refreshWorkspace();
    }catch(error){setMessage(error instanceof Error?error.message:'Could not restore this caregiver','error')}
  }
  async function saveTemplate(t:{id?:string;name:string;subject:string;body:string}){
    await api('/api/email-templates',{method:'POST',body:JSON.stringify(t)});
    setSavedTemplates((await api<{templates:EmailTemplate[]}>('/api/email-templates')).templates||[]);
  }
  async function deleteTemplate(t:EmailTemplate){
    try{
      await api('/api/email-templates/'+encodeURIComponent(t.id),{method:'DELETE'});
      setSavedTemplates(list=>list.filter(x=>x.id!==t.id));
    }catch(error){setMessage(error instanceof Error?error.message:'Could not delete the template','error')}
  }
  function openCandidatePage(id:string){
    window.history.pushState(null,'','/app?candidate='+encodeURIComponent(id));
    setPanelRowId('');setPageRowId(id);window.scrollTo(0,0);
  }
  function closeCandidatePage(){
    window.history.pushState(null,'','/app?tab=candidates');
    setPageRowId('');setTab('pipeline');
  }
  useEffect(()=>{
    const onPop=()=>setPageRowId(new URLSearchParams(window.location.search).get('candidate')||'');
    window.addEventListener('popstate',onPop);
    return ()=>window.removeEventListener('popstate',onPop);
  },[]);

  async function decide(row:PipelineRow,stage:'hired'|'rejected'){
    if(!session)return;
    if(stage==='rejected'&&!window.confirm('Mark '+row.name+' as not a fit for '+row.title+'?'))return;
    try{
      await api('/api/pipeline/'+row.id,{method:'PATCH',body:JSON.stringify({stage})});
      await refreshWorkspace();
    }catch(error){setMessage(error instanceof Error?error.message:'Could not update this caregiver','error')}
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
      setMessage(result.added+' interview time'+(result.added===1?'':'s')+' added. Interested caregivers may book these times, or you can follow up directly.');
      setSlotsFor(null);
      setSlotInputs([{startsAt:'',durationMinutes:30}]);
      await refreshWorkspace();
      setIntakeOpeningId('');
      setTab('openings');
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
  const openingPipeline=useMemo(
    ()=>intakeOpeningId?pipeline.filter(p=>p.opening_id===intakeOpeningId):pipeline,
    [pipeline,intakeOpeningId]
  );
  const viewCounts={active:openingPipeline.filter(p=>p.stage!=='rejected').length,favorites:openingPipeline.filter(p=>p.favorite).length,archived:openingPipeline.filter(p=>p.stage==='rejected').length};
  const visiblePipeline=useMemo(
    ()=>openingPipeline.filter(p=>candidateView==='favorites'?p.favorite:candidateView==='archived'?p.stage==='rejected':p.stage!=='rejected'),
    [openingPipeline,candidateView]
  );
  const templates=useMemo(()=>mergeTemplates(savedTemplates),[savedTemplates]);
  const candidateActions:CandidateActions={onInvite:invite,onDecide:decide,onNotes:saveNotes,onFavorite:favorite,onRestore:restore};
  const sender={company:workspace?.company_name||session?.companyName||'',contactName:session?.contactName||''};
  const shownTab=pageRowId?'':tab;
  function leavePage(){if(pageRowId){window.history.pushState(null,'','/app');setPageRowId('')}}
  const panelRow=pipeline.find(p=>p.id===panelRowId)||null;
  const pageRow=pipeline.find(p=>p.id===pageRowId)||null;
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
        <button className={'nav-button '+(tab==='openings'?'active':'')} onClick={()=>{leavePage();setIntakeOpeningId('');setTab('openings')}}>Openings</button>
        <button className={'nav-button '+(tab==='pipeline'?'active':'')} onClick={()=>{leavePage();setIntakeOpeningId('');setTab('pipeline')}}>Candidates{inboxWaiting?` (${inboxWaiting} new)`:''}</button>
        <button className={'nav-button '+(tab==='talent'?'active':'')} onClick={()=>{leavePage();setTab('talent')}} disabled={pendingApproval} title={pendingApproval?'Available after approval':undefined}>Talent network</button>
        {agencyNetwork.agency&&<button className={'nav-button '+(tab==='jobs'?'active':'')} onClick={()=>{leavePage();setTab('jobs')}}>Jobs</button>}
        {agencyNetwork.agency&&<button className={'nav-button '+(tab==='hiring'?'active':'')} onClick={()=>{leavePage();setTab('hiring')}}>Hiring preferences</button>}
        <WorkspaceAccount logout={logout}/>
      </nav>
    </div></header>

    <main className="app-wrap app-content">
      <section className="page-head page-head-row">
        <div><h1>{workspace?.company_name||session.companyName||'Recruiting workspace'}</h1><p>From hiring need to interested caregiver to booked interview.</p></div>
        <div className="header-action"><button className="button" onClick={()=>setShowOpening(true)}>+ New opening</button></div>
      </section>

      <div className="result-summary workspace-summary">
        <strong>{openings.filter(o=>o.status==='open').length} open role{openings.filter(o=>o.status==='open').length===1?'':'s'}</strong>
        <span>{pendingApproval?'—':counts.matched} to review</span><span>{pendingApproval?'—':counts.contacted} invited</span><span>{pendingApproval?'—':counts.interested} interested</span>
        <span>{pendingApproval?'—':counts.interview} interviews</span><span>{pendingApproval?'—':counts.hired} hired</span>
      </div>
      {pendingApproval&&<div className="alert-status workspace-alert" role="status"><strong>Caregiver matching is awaiting account approval.</strong> You can create openings and add interview availability now. Caregiver profiles and outreach unlock after approval. Use a verified agency email or claim your agency to verify automatically, or wait for manual review. <button className="text-button" onClick={()=>void refreshWorkspace()} disabled={loading}>Recheck approval</button></div>}
      {billing?.enabled&&<div className="settings-card workspace-alert" style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,flexWrap:'wrap'}}>
        {billing.subscribed
          ?<><span><strong>CareJoys Hiring</strong> · unlimited caregiver introductions</span><button className="button secondary" onClick={()=>void openBilling('portal')}>Manage billing</button></>
          :<><span><strong>{billing.freeContactsRemaining??0} of {billing.freeContacts}</strong> free introductions left. An introduction counts when a caregiver says they’re interested or sends you their profile; inviting is free.</span><span style={{display:'flex',gap:12,alignItems:'center'}}><button className="button" onClick={()=>void openBilling('checkout')}>Upgrade · $79/month</button>{billing.yearly&&<button className="text-button" onClick={()=>void openBilling('checkout','yearly')}>or $790/year</button>}</span></>}
      </div>}
      {message&&<div className={'alert-status workspace-alert'+(messageTone==='ok'?'':' alert-'+messageTone)}>{messageTone==='ok'?'✓ ':''}{message}</div>}


      {pageRowId&&(pageRow
        ?<CandidatePage row={pageRow} actions={candidateActions} templates={templates} sender={sender} disabled={pendingApproval} onBack={closeCandidatePage}/>
        :<section className="section-block"><div className="empty"><strong>{loading?'Loading this caregiver…':'This caregiver isn’t in your candidates.'}</strong><div className="empty-actions"><button className="button secondary" onClick={closeCandidatePage}>Back to candidates</button></div></div></section>)}

      {shownTab==='openings'&&<section className="section-block">
        <div className="section-heading"><h2>Openings</h2><p>Describe the role once, see matches and invite caregivers. Adding interview times is optional.</p></div>
        {openings.length===0?<div className="empty"><strong>No openings yet.</strong><div>Add the first job you want CareJoys to recruit for.</div><div className="empty-actions"><button className="button secondary" onClick={()=>setShowOpening(true)}>Create opening</button></div></div>:
        <div className="job-list">{openings.map((o,i)=><article key={o.id} className={'job-card '+cardTone(i)}>
          <div className="job-card-main">
            <div className="job-card-title-row"><h3>{o.title}</h3></div>
            <div className="job-meta">{[o.role,o.city,o.state,o.zip].filter(Boolean).join(' · ')}</div>
            <div className="job-badges">
              {o.shift_preferences&&<span className="badge">{o.shift_preferences}</span>}
              {payLabel({payMin:o.pay_min,payMax:o.pay_max,payPeriod:'hour'})&&<span className="badge">{payLabel({payMin:o.pay_min,payMax:o.pay_max,payPeriod:'hour'})}</span>}
              <span className="status">{o.source==='agency_profile'?'Always-on':o.source==='employer_intake'?'Created from your request':(o.status||'open')}</span>
              {pipeline.some(p=>p.opening_id===o.id)&&<span className="badge">{pipeline.filter(p=>p.opening_id===o.id).length} matched · {pipeline.filter(p=>p.opening_id===o.id&&['interested','interview','hired'].includes(p.stage)).length} interested</span>}
              {Number(o.available_interview_slots||0)>0&&<span className="badge">{o.available_interview_slots} interview time{Number(o.available_interview_slots)===1?'':'s'} ready</span>}
            </div>
            <button type="button" className="opening-interview-link" onClick={()=>void openInterviewSlots(o)}>{Number(o.available_interview_slots||0)>0?'Manage interview times':'Set interview times'}</button>
          </div>
          <div className="job-card-side opening-actions">
            <button className="button secondary" disabled={pendingApproval} title={pendingApproval?'Matching unlocks after account approval':undefined} onClick={()=>{setIntakeOpeningId(o.id);void runMatch(o.id)}}>{pendingApproval?'Matches available after approval':'View matches'}</button>
            {pendingApproval&&<span className="opening-next-step">Invitations unlock after account approval.</span>}
          </div>
        </article>)}</div>}
      </section>}

      {shownTab==='pipeline'&&<section className="section-block">
        {intakeOpening?<div className="match-opening-head">
          <button className="text-button" onClick={()=>{setIntakeOpeningId('');setTab('openings')}}>← All openings</button>
          <h2>Matches for {intakeOpening.title}</h2>
          <div className="job-meta">{[intakeOpening.role,[intakeOpening.city,intakeOpening.state].filter(Boolean).join(', ')+(intakeOpening.zip?' '+intakeOpening.zip:''),intakeOpening.shift_preferences,payLabel({payMin:intakeOpening.pay_min,payMax:intakeOpening.pay_max,payPeriod:'hour'})].filter(Boolean).join(' · ')}</div>
          <div className="match-opening-links">
            <span>{visiblePipeline.filter(p=>p.stage==='matched').length} not yet invited · {visiblePipeline.filter(p=>['contacted','interested','interview','hired'].includes(p.stage)).length} invited</span>
            <button className="text-button" onClick={()=>void openInterviewSlots(intakeOpening)}>{Number(intakeOpening.available_interview_slots||0)>0?'Manage interview times ('+intakeOpening.available_interview_slots+')':'Add interview times (optional)'}</button>
            <button className="text-button" onClick={()=>{setIntakeOpeningId('');setTab('pipeline')}}>All candidates</button>
          </div>
        </div>:<div className="section-heading">
          <h2>All candidates</h2>
          <p>Everyone matched to your openings. Interest and interview bookings update automatically.</p>
        </div>}
        {agencyNetwork.agency&&<div hidden={!!intakeOpening}><AgencyInbox onCount={setInboxWaiting}/></div>}
        {openingPipeline.length===0?<div className="empty"><strong>{intakeOpening?'No matched caregivers for this opening yet.':'No candidates yet.'}</strong><div>{intakeOpening?'CareJoys will keep looking as verified, available caregivers join nearby. Check the role, ZIP, pay and schedule, or revisit other openings.':'Matches appear here after you view matches for an opening.'}</div><div className="empty-actions"><button className="button secondary" onClick={()=>{setIntakeOpeningId('');setTab('openings')}}>Back to openings</button><button className="button secondary" onClick={()=>{setIntakeOpeningId('');setTab('talent')}} disabled={pendingApproval}>Search talent network</button></div></div>:
        <>{!intakeOpening&&agencyNetwork.agency&&<div className="candidate-group-head"><h3>Matched to your openings</h3></div>}
        <div className="candidate-views">
          <div className="inbox-filters" role="group" aria-label="Show">
            {([['active','Active'],['favorites','Saved'],['archived','Not a fit']] as const).map(([k,label])=><button type="button" key={k} className={'chip'+(candidateView===k?' on':'')} aria-pressed={candidateView===k} onClick={()=>setCandidateView(k)}>{label} <strong>{viewCounts[k]}</strong></button>)}
          </div>
          <button type="button" className="text-button" onClick={()=>setShowTemplates(true)}>Email templates</button>
        </div>
        {visiblePipeline.length===0?<div className="empty"><strong>{candidateView==='favorites'?'Nobody saved yet.':candidateView==='archived'?'Nobody is marked not a fit.':'Everyone here is marked not a fit.'}</strong><div>{candidateView==='favorites'?'Tap Save on a caregiver to keep them here for follow-up.':candidateView==='archived'?'Caregivers you mark not a fit, or who decline, show here. You can restore the ones you marked.':'Open Not a fit to restore someone.'}</div></div>
        :<MatchList rows={visiblePipeline} showOpening={!intakeOpening} disabled={pendingApproval} onInvite={invite} onDecide={decide} onNotes={saveNotes} onOpen={r=>setPanelRowId(r.id)} onFavorite={favorite} onRestore={restore}/>}</>}
      </section>}

      {shownTab==='talent'&&<section className="section-block">
        <div className="section-heading"><h2>Talent network</h2><p>Browse all available caregivers. Prioritizes local commutes, hiring needs and confirmed availability.</p></div>
        <form className="talent-filters settings-card" onSubmit={searchTalent}>
          <input value={filters.role} onChange={e=>setFilters({...filters,role:e.target.value})} placeholder="Role: CNA, HHA, caregiver" />
          <input value={filters.zip} onChange={e=>setFilters({...filters,zip:e.target.value})} placeholder="ZIP" inputMode="numeric" />
          <select value={filters.radius} onChange={e=>setFilters({...filters,radius:e.target.value})} aria-label="Distance from ZIP"><option value="all">All distances</option><option value="10">Within 10 mi</option><option value="25">Within 25 mi</option><option value="50">Within 50 mi</option><option value="100">Within 100 mi</option></select>
          <input value={filters.state} onChange={e=>setFilters({...filters,state:e.target.value})} placeholder="State" />
          <select value={filters.freshness} onChange={e=>setFilters({...filters,freshness:e.target.value})}><option value="all">Any availability</option><option value="confirmed">Confirmed in last 30 days</option></select>
          <button className="button">Search</button>
        </form>
        {talentState==='loading'?<div className="empty"><strong>Loading available caregivers…</strong></div>:
         talentState==='error'?<div className="empty"><strong>Couldn't load the network.</strong><div>Retry the search to view available profiles.</div></div>:
         talentState==='ready'&&candidates.length===0?<div className="empty"><strong>No employer-visible caregivers match these filters yet.</strong><div>Caregivers must confirm their availability and verify their profiles before employers can see them. Try All distances and clear the role or state filters.</div></div>:
         talentState==='ready'?<><p className="talent-results-meta" role="status">{talentTotal} available caregiver{talentTotal===1?'':'s'} · {talentSearchedZip?'Near '+talentSearchedZip+' prioritized · ':''}Employer-visible and actively looking</p><div className="job-list">{candidates.map((candidate,i)=><TalentCard candidate={candidate} tone={cardTone(i)} key={candidate.id}/>)}</div></>:
         <div className="empty"><strong>Loading available caregivers…</strong></div>}
      </section>}

      {!loading&&workspace&&pendingApproval&&!agencyNetwork.agency&&shownTab==='openings'&&<AgencySuggestions onLinked={()=>void refreshWorkspace()}/>}

      {shownTab==='hiring'&&agencyNetwork.agency&&<section className="section-block">
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

      {shownTab==='jobs'&&agencyNetwork.agency&&<section className="section-block">
        <JobsWidgetCard agencyId={agencyNetwork.agency.id}/>
        <AgencyJobsPanel onRecruit={openingId=>void (async()=>{await refreshWorkspace();await runMatch(openingId)})()}/>
      </section>}

      {panelRow&&!pageRowId&&<CandidatePanel row={panelRow} actions={candidateActions} templates={templates} sender={sender} disabled={pendingApproval} onClose={()=>setPanelRowId('')} onOpenPage={()=>openCandidatePage(panelRow.id)}/>}
      {showTemplates&&<EmailTemplatesModal templates={templates} onSave={saveTemplate} onDelete={deleteTemplate} onClose={()=>setShowTemplates(false)}/>}
      {showOpening&&<div className="modal-backdrop" onMouseDown={()=>setShowOpening(false)}><div className="modal-panel" onMouseDown={e=>e.stopPropagation()}>
        <button className="modal-close" onClick={()=>setShowOpening(false)}>×</button>
        <div className="modal-kicker">New opening</div><h2>Who do you need?</h2><p className="modal-intro">Add the role once. CareJoys uses it to rank the caregiver network immediately.</p>
        <form className="intake-form" onSubmit={createOpening}>
          <label>Job title<input name="title" required placeholder="CNA — day shift" /></label>
          <div className="form-grid"><label>Role<select name="role" required defaultValue=""><option value="" disabled>Select</option><option>CNA</option><option>GNA</option><option>HHA</option><option>PCA</option><option>Caregiver</option><option>DSP</option></select></label><label>ZIP<input name="zip" /></label></div>
          <div className="form-grid"><label>City<input name="city" /></label><label>State<input name="state" /></label></div>
          <div className="form-grid"><label>Min pay / hr<input type="number" name="payMin" /></label><label>Max pay / hr<input type="number" name="payMax" /></label></div>
          <ScheduleEditor/>
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
