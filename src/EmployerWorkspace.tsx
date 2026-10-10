import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { LoginForm, Shell } from './LoginPage';
import { useCaregiverAuth } from './caregiverAuth';
import { rememberDashboard } from './dashboardHome';
import { payLabel } from './jobFormat';
import { AccountMenu, CloseAccountSide } from './AccountLink';
import { AgencyJobsPanel, AgencySuggestions } from './AgencyFinder';
import { JobsWidgetCard } from './JobsWidgetCard';
import { TalentCard, type TalentCandidate } from './TalentCard';
import { ScheduleEditor } from './ScheduleEditor';
import { MatchList, STAGE_LABELS, needsReply, type DecideStage, type MatchRow } from './MatchList';
import { APPLICATION_PREFIX, INBOX_STAGE_FOR, mergeCandidates, resultsOf, stageCounts, type InboxItem } from './candidates';
import { CandidatePage, CandidatePanel, type CandidateActions, type LicenseCheck } from './CandidatePanel';
import { TalentPage, TalentPanel, type TalentActions } from './TalentPanel';
import { shiftsLabel } from './profileTags';
import { CHECKLIST } from './checklist';
import { EmailTemplatesModal } from './EmailTemplatesModal';
import { mergeTemplates, type EmailTemplate } from './emailTemplateFill';
import { parseOpeningSchedule } from './schedule';
import { WorkspaceSettings } from './WorkspaceSettings';
import './workspace.css';

type Opening={
  id:string;title:string;role:string;city?:string;state?:string;zip?:string;
  pay_min?:number;pay_max?:number;shift_preferences?:string;status?:string;
  source?:string;agency_organization_id?:string;available_interview_slots?:number;
  schedule_json?:string|null;requirements?:string;transportation_required?:number;created_at?:string;service_radius_miles?:number|null;
};
type InterviewSlot={id:string;starts_at:string;duration_minutes:number;timezone:string;status:string;location?:string|null};
type StageFilter=''|'matched'|'contacted'|'interested'|'interview'|'hired';
// Home care roles first for agencies, assisted living roles first for communities.
const HOME_CARE_ROLES=['CNA','GNA','HHA','PCA','Caregiver','DSP'];
const ASSISTED_LIVING_ROLES=['CMT / Med Tech','Resident Assistant','Memory Care Aide'];
const rolesFor=(type?:string)=>type==='assisted_living'?[...ASSISTED_LIVING_ROLES,...HOME_CARE_ROLES]:[...HOME_CARE_ROLES,...ASSISTED_LIVING_ROLES];
const postedLabel=(v?:string)=>v?'Posted '+new Date(v.includes('T')?v:v.replace(' ','T')+'Z').toLocaleDateString(undefined,{month:'short',day:'numeric'}):'';
const MAX_SLOTS=10;
function timeZoneLabel(){
  try{return new Intl.DateTimeFormat(undefined,{timeZoneName:'long'}).formatToParts(new Date()).find(p=>p.type==='timeZoneName')?.value||Intl.DateTimeFormat().resolvedOptions().timeZone}
  catch{return Intl.DateTimeFormat().resolvedOptions().timeZone||'your local time'}
}
type AgencyNetwork={agency:any|null};
type Candidate=TalentCandidate;
type PipelineRow=MatchRow;
type SessionEmployer={id:string;companyName:string;contactName:string;email:string;zip?:string};

async function api<T>(path:string,init?:RequestInit):Promise<T>{
  const res=await fetch(path,{...init,headers:{'content-type':'application/json',...(init?.headers||{})}});
  const body=await res.json() as T & {error?:string};
  if(!res.ok)throw new Error(body.error||'Request failed');
  return body;
}
const EMPTY_FILTERS={role:'',zip:'',radius:'commute',state:'',freshness:'all',shift:'',hours:'',cert:'',car:'',sort:'',payMax:'',language:'',checked:''};
type TalentFilterState=typeof EMPTY_FILTERS;
/** Find caregivers filters from the page URL, so a saved-search email opens on that search. */
const filtersFromUrl=():TalentFilterState=>{
  const q=new URLSearchParams(window.location.search);
  if(q.get('tab')!=='talent')return EMPTY_FILTERS;
  return Object.fromEntries(Object.entries(EMPTY_FILTERS).map(([k,v])=>[k,q.get(k)||v])) as TalentFilterState;
};
const LANGUAGES=['Spanish','French','Haitian Creole','Amharic','Tagalog','Portuguese','Russian','Arabic','Mandarin','Swahili'];
type TalentAlert={id:string;label:string;query:string};
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
  const [talentNearby,setTalentNearby]=useState(0);
  const [talentPanelId,setTalentPanelId]=useState('');
  const [talentPageId,setTalentPageId]=useState(()=>new URLSearchParams(window.location.search).get('talent')||'');
  const firstTalentLoad=useRef('');
  const [agencyNetwork,setAgencyNetwork]=useState<AgencyNetwork>({agency:null});
  const [tab,setTab]=useState<'openings'|'talent'|'pipeline'|'jobs'|'plan'|'settings'>(()=>{const q=new URLSearchParams(window.location.search),t=q.get('tab');return t==='inbox'||t==='candidates'||q.get('candidate')?'pipeline':t==='plan'?'plan':t==='talent'?'talent':t==='settings'?'settings':'openings'});
  const [applications,setApplications]=useState<InboxItem[]>([]);
  const [licenseChecks,setLicenseChecks]=useState<Record<string,LicenseCheck>>({});
  const [loading,setLoading]=useState(false);
  const [message,setMessageText]=useState('');
  const [messageTone,setMessageTone]=useState<'ok'|'info'|'error'>('ok');
  function setMessage(text:string,tone:'ok'|'info'|'error'='ok'){setMessageText(text);setMessageTone(tone)}
  const [pendingApproval,setPendingApproval]=useState(false);
  const [approvalKnown,setApprovalKnown]=useState(false);
  const [billing,setBilling]=useState<{enabled:boolean;subscribed:boolean;freeContacts:number;freeContactsRemaining:number|null;firstHire?:boolean;yearly?:boolean;paymentIssue?:boolean}|null>(null);
  const [billingBusy,setBillingBusy]=useState(false);
  // Coming back from Stripe with the browser's back button restores this page from cache, so re-enable the buttons.
  useEffect(()=>{const reset=()=>setBillingBusy(false);window.addEventListener('pageshow',reset);return ()=>window.removeEventListener('pageshow',reset)},[]);
  const [filters,setFilters]=useState(filtersFromUrl);
  const [alerts,setAlerts]=useState<TalentAlert[]>([]);
  const [showOpening,setShowOpening]=useState(false);
  const [editingOpening,setEditingOpening]=useState<Opening|null>(null);
  const [stageFilter,setStageFilter]=useState<StageFilter>('');
  const [slotLocation,setSlotLocation]=useState('');
  const [slotsFor,setSlotsFor]=useState<Opening|null>(null);
  const [slotInputs,setSlotInputs]=useState([{startsAt:'',durationMinutes:30}]);
  const [existingSlots,setExistingSlots]=useState<InterviewSlot[]>([]);
  const [slotNotice,setSlotNotice]=useState('');
  const [intakeOpeningId,setIntakeOpeningId]=useState(()=>new URLSearchParams(window.location.search).get('opening')||'');
  const intakeHandled=useRef(false);
  const [panelRowId,setPanelRowId]=useState('');
  const [pageRowId,setPageRowId]=useState(()=>new URLSearchParams(window.location.search).get('candidate')||'');
  const [candidateView,setCandidateView]=useState<'active'|'archived'>('active');
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
      setApplications(network.agency&&data.approval?.approved!==false?(await api<{items:InboxItem[]}>('/api/agency/inbox').catch(()=>({items:[]}))).items||[]:[]);
      setLicenseChecks((await api<{checks:Record<string,LicenseCheck>}>('/api/license-checks').catch(()=>({checks:{}}))).checks||{});
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
  // A claim link lands on /app?tab=jobs; open that tab once the linked agency has loaded.
  useEffect(()=>{
    if(agencyNetwork.agency&&new URLSearchParams(window.location.search).get('tab')==='jobs')setTab('jobs');
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
    const params=talentParams(chosen);
    const primaryRole=openings.find(o=>o.status==='open')?.role;
    if(primaryRole&&!chosen.role)params.set('preferredRole',primaryRole);
    try{
      const data=await api<{total:number;nearby?:number;candidates:Candidate[]}>('/api/candidates?'+params.toString());
      setCandidates(data.candidates||[]);
      setTalentTotal(data.total||0);
      setTalentNearby(data.nearby||0);
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
    // Nearby first: only caregivers whose own commute reaches this ZIP. Any distance is one click away.
    const initial={...filters,zip:filters.zip||homeZip,radius:filters.radius||'commute'};
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
      if(editingOpening){
        const result=await api<{matched?:number}>('/api/openings/'+editingOpening.id,{method:'PATCH',body:JSON.stringify(data)});
        setShowOpening(false);setEditingOpening(null);
        setMessage(result.matched!==undefined?'Opening saved. '+result.matched+' caregiver'+(result.matched===1?'':'s')+' match it now.':'Opening saved.');
        await refreshWorkspace();
        return;
      }
      const result=await api<{id:string}>('/api/openings',{method:'POST',body:JSON.stringify(data)});
      setShowOpening(false);
      setIntakeOpeningId(result.id);
      await refreshWorkspace();
      await runMatch(result.id);
    }catch(error){
      setMessage(error instanceof Error?error.message:'Could not save the opening','error');
    }
  }

  async function setOpeningStatus(opening:Opening,status:'open'|'closed'){
    if(status==='closed'&&!window.confirm('Close '+opening.title+'? Caregivers who said yes and are still waiting get a short note that the role is filled.'))return;
    try{
      const result=await api<{notified?:number}>('/api/openings/'+opening.id,{method:'PATCH',body:JSON.stringify({status})});
      setMessage(status==='closed'?opening.title+' is closed.'+(result.notified?' '+result.notified+' caregiver'+(result.notified===1?' was':'s were')+' told the role is filled.':''):opening.title+' is open again.');
      await refreshWorkspace();
    }catch(error){setMessage(error instanceof Error?error.message:'Could not update the opening','error')}
  }
  function openOpeningForm(opening:Opening|null){setEditingOpening(opening);setShowOpening(true)}
  function showCandidates(stage:StageFilter){leavePage();setIntakeOpeningId('');setCandidateView('active');setStageFilter(stage);setTab('pipeline')}

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

  /** Adds network caregivers to an opening's candidates, then sends the usual invitations in one go. */
  async function inviteFromTalent(chosen:Candidate|Candidate[],openingId:string){
    const list=Array.isArray(chosen)?chosen:[chosen];
    if(!session||pendingApproval||!list.length)return;
    const title=openings.find(o=>o.id===openingId)?.title||'this opening';
    try{
      const pipelineIds:string[]=[];
      for(const c of list){
        const added=await api<{pipelineId:string;stage:string}>('/api/openings/'+openingId+'/candidates',{method:'POST',body:JSON.stringify({caregiverId:c.id})});
        if(added.stage==='matched')pipelineIds.push(added.pipelineId);
      }
      if(!pipelineIds.length)setMessage((list.length===1?list[0].name+' is':'They are')+' already in your candidates for that opening.','info');
      else{
        const result=await api<any>('/api/openings/'+openingId+'/contact',{method:'POST',body:JSON.stringify({pipelineIds})});
        const sent=Number(result.sent||0);
        const who=list.length===1?list[0].name:sent+' caregiver'+(sent===1?'':'s');
        setMessage(sent?who+(sent===1&&list.length===1?' was':' were')+' invited to '+title+'. They’re in your candidates now.':'Added to your candidates, but the invitations didn’t send.',sent?'ok':'info');
      }
    }catch(error){
      setMessage(error instanceof Error?error.message:'Could not invite these caregivers','error');
    }
    await refreshWorkspace();
  }

  async function loadAlerts(){
    try{setAlerts((await api<{alerts:TalentAlert[]}>('/api/talent-alerts')).alerts||[])}catch{setAlerts([])}
  }
  async function saveAlert(){
    try{
      setAlerts((await api<{alerts:TalentAlert[]}>('/api/talent-alerts',{method:'POST',body:JSON.stringify({query:talentParams(filters).toString()})})).alerts||[]);
      setMessage('Saved. We’ll email '+(session?.email||'you')+' when new caregivers match this search.','ok');
    }catch(error){setMessage(error instanceof Error?error.message:'Could not save this alert','error')}
  }
  async function removeAlert(id:string){
    try{await api('/api/talent-alerts/'+encodeURIComponent(id),{method:'DELETE'});setAlerts(list=>list.filter(a=>a.id!==id))}
    catch(error){setMessage(error instanceof Error?error.message:'Could not turn off this alert','error')}
  }
  useEffect(()=>{if(tab==='talent'&&session&&approvalKnown&&!pendingApproval)void loadAlerts()},[tab,session?.id,approvalKnown,pendingApproval]);

  async function openBilling(kind:'checkout'|'portal',plan:'monthly'|'yearly'='monthly'){
    if(billingBusy)return;
    setBillingBusy(true);
    try{
      const result=await api<{url:string}>('/api/billing/'+kind,{method:'POST',body:JSON.stringify({plan})});
      window.location.href=result.url;
    }catch(error){setBillingBusy(false);setMessage(error instanceof Error?error.message:'Could not open billing','error')}
  }

  const patchRow=(id:string,change:Partial<PipelineRow>)=>setPipeline(rows=>rows.map(r=>r.id===id?{...r,...change}:r));
  const patchApplication=(id:string,change:Partial<InboxItem>)=>setApplications(items=>items.map(i=>i.id===id?{...i,...change}:i));
  /** Saves a stage or notes on an application (a caregiver who applied to the agency). */
  async function saveApplication(row:PipelineRow,patch:{stage?:InboxItem['stage'];notes?:string}){
    const id=row.application_id||row.id.slice(APPLICATION_PREFIX.length);
    await api('/api/agency/inbox/'+encodeURIComponent(id),{method:'POST',body:JSON.stringify(patch)});
    patchApplication(id,patch);
  }
  async function saveNotes(row:PipelineRow,notes:string){
    try{
      if(row.kind==='application')await saveApplication(row,{notes});
      else{await api('/api/pipeline/'+row.id,{method:'PATCH',body:JSON.stringify({notes})});patchRow(row.id,{employer_notes:notes})}
    }catch(error){setMessage(error instanceof Error?error.message:'Could not save notes','error')}
  }
  /** Emailing or calling an applicant who was waiting means they've heard back. */
  function reach(row:PipelineRow){
    if(row.kind==='application'&&row.stage==='interested'&&!row.reached)void saveApplication(row,{stage:INBOX_STAGE_FOR.reached}).catch(()=>{});
  }

  async function restore(row:PipelineRow){
    try{
      if(row.kind==='application'){await saveApplication(row,{stage:INBOX_STAGE_FOR.restore});setMessage(row.name+' is back in your candidates.');return}
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

  function closeCandidatePage(){
    window.history.pushState(null,'','/app?tab=candidates');
    setPageRowId('');setTab('pipeline');
  }
  useEffect(()=>{
    const onPop=()=>{const q=new URLSearchParams(window.location.search);setPageRowId(q.get('candidate')||'');setTalentPageId(q.get('talent')||'')};
    window.addEventListener('popstate',onPop);
    return ()=>window.removeEventListener('popstate',onPop);
  },[]);

  async function decide(row:PipelineRow,stage:DecideStage){
    if(!session)return;
    if(stage==='rejected'&&!window.confirm('Mark '+row.name+' as not a fit'+(row.title?' for '+row.title:'')+'?'))return;
    try{
      if(row.kind==='application'){await saveApplication(row,{stage:INBOX_STAGE_FOR[stage]});return}
      await api('/api/pipeline/'+row.id,{method:'PATCH',body:JSON.stringify({stage})});
      await refreshWorkspace();
    }catch(error){setMessage(error instanceof Error?error.message:'Could not update this caregiver','error')}
  }

  async function openInterviewSlots(opening:Opening){
    setSlotNotice('');setExistingSlots([]);setSlotInputs([{startsAt:'',durationMinutes:30}]);setSlotLocation('');setSlotsFor(opening);
    try{
      const data=await api<{slots:InterviewSlot[]}>('/api/openings/'+opening.id+'/interview-slots');
      const upcoming=(data.slots||[]).filter(s=>s.status==='available'&&Date.parse(s.starts_at)>Date.now());
      setExistingSlots(upcoming);
      setSlotLocation([...(data.slots||[])].reverse().find(s=>s.location)?.location||'');
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
      const result=await api<any>('/api/openings/'+slotsFor.id+'/interview-slots',{method:'POST',body:JSON.stringify({slots,location:slotLocation})});
      setMessage(result.added+' interview time'+(result.added===1?'':'s')+' added. Interested caregivers may book these times, or you can follow up directly.');
      setSlotsFor(null);
      setSlotInputs([{startsAt:'',durationMinutes:30}]);
      // Stay where the employer was, so adding times from a match list doesn't lose their place.
      await refreshWorkspace();
    }catch(error){
      setMessage(error instanceof Error?error.message:'Could not save interview times','error');
    }
  }

  async function logout(){
    await api('/api/auth/logout',{method:'POST'});
    setSession(null);setWorkspace(null);setOpenings([]);setPipeline([]);
  }

  // Everyone in one list: caregivers who applied to the agency and caregivers matched to openings, one set of stages.
  const everyone=useMemo(()=>mergeCandidates(pipeline,applications),[pipeline,applications]);
  const counts=useMemo(()=>stageCounts(everyone),[everyone]);
  const results=useMemo(()=>resultsOf(everyone),[everyone]);
  const waitingReply=everyone.filter(needsReply);
  const openingPipeline=useMemo(
    ()=>intakeOpeningId?everyone.filter(p=>p.opening_id===intakeOpeningId):everyone,
    [everyone,intakeOpeningId]
  );
  const viewCounts={active:openingPipeline.filter(p=>p.stage!=='rejected').length,archived:openingPipeline.filter(p=>p.stage==='rejected').length};
  const visiblePipeline=useMemo(
    ()=>openingPipeline.filter(p=>candidateView==='archived'?p.stage==='rejected':p.stage!=='rejected'&&(!stageFilter||p.stage===stageFilter)),
    [openingPipeline,candidateView,stageFilter]
  );
  // What's waiting on the employer right now, most urgent first. Empty when there's nothing to do.
  const needsYou=useMemo(()=>{
    if(pendingApproval)return [];
    const items:{key:string;text:string;action:string;go:()=>void}[]=[];
    const soon=Date.now()+2*86400000;
    pipeline.filter(p=>p.stage==='interview'&&p.interview_at&&Date.parse(p.interview_at)>Date.now()&&Date.parse(p.interview_at)<soon)
      .sort((a,b)=>Date.parse(a.interview_at!)-Date.parse(b.interview_at!))
      .forEach(p=>items.push({key:'iv'+p.id,text:'Interview with '+p.name+', '+new Date(p.interview_at!).toLocaleDateString(undefined,{weekday:'long'})+' at '+new Date(p.interview_at!).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'}),action:'View',go:()=>setPanelRowId(p.id)}));
    // Caregivers who applied or said yes and haven't heard back: the most urgent thing an agency can act on.
    const waiting=everyone.filter(needsReply);
    const what=(p:PipelineRow)=>p.kind==='application'?'applied'+(p.title?' to '+p.title:''):'said yes to '+p.title;
    if(waiting.length===1)items.unshift({key:'yes',text:waiting[0].name+' '+what(waiting[0])+' and needs a reply',action:'Reply',go:()=>setPanelRowId(waiting[0].id)});
    else if(waiting.length>1)items.unshift({key:'yes',text:waiting.length+' caregivers applied or said yes and need a reply',action:'Review',go:()=>showCandidates('interested')});
    const fresh=everyone.filter(p=>p.stage==='matched').length;
    if(fresh)items.push({key:'new',text:fresh+' matched caregiver'+(fresh===1?'':'s')+' not invited yet',action:'Pick who to invite',go:()=>showCandidates('matched')});
    return items;
  },[everyone,pipeline,pendingApproval]);
  const openOpenings=openings.filter(o=>o.status!=='closed');
  const closedOpenings=openings.filter(o=>o.status==='closed');
  // First visit: three steps until the employer has invited someone and added interview times (or the list is long enough to know their way around).
  const setupSteps=[
    {done:pipeline.length>0,label:'Review your matches',go:()=>openOpenings[0]&&void runMatch(openOpenings[0].id)},
    {done:pipeline.some(p=>!!p.contacted_at),label:'Invite the caregivers you like',go:()=>showCandidates('matched')},
    {done:openings.some(o=>Number(o.available_interview_slots||0)>0),label:'Add interview times (optional)',go:()=>openOpenings[0]&&void openInterviewSlots(openOpenings[0])}
  ];
  const showSetup=!pendingApproval&&openOpenings.length>0&&openings.length<=2&&setupSteps.some(x=>!x.done)&&!everyone.some(p=>['interested','interview','hired'].includes(p.stage));
  const templates=useMemo(()=>mergeTemplates(savedTemplates),[savedTemplates]);
  async function checkLicense(row:MatchRow,result:LicenseCheck['result']|''){
    try{
      const data=await api<{check:LicenseCheck|null}>('/api/license-checks/'+encodeURIComponent(row.caregiver_id),{method:'POST',body:JSON.stringify({result})});
      setLicenseChecks(prev=>{const next={...prev};if(data.check)next[row.caregiver_id]=data.check;else delete next[row.caregiver_id];return next});
    }catch(error){setMessage(error instanceof Error?error.message:'Could not save the license check','error')}
  }
  const candidateActions:CandidateActions={onInvite:invite,onDecide:decide,onNotes:saveNotes,onRestore:restore,onReach:reach,licenseChecks,onLicenseCheck:checkLicense};
  const talentActions:TalentActions={
    openings:openings.filter(o=>o.status==='open').map(o=>({id:o.id,title:o.title})),
    pipelineFor:id=>everyone.filter(p=>p.caregiver_id===id&&p.stage!=='rejected').map(p=>({rowId:p.id,title:p.kind==='application'?'your agency (applied'+(p.title?' to '+p.title:'')+')':p.title,applied:p.kind==='application'})),
    onInvite:inviteFromTalent,disabled:pendingApproval
  };
  const talentPanel=candidates.find(c=>c.id===talentPanelId)||null;
  const homeZip=String(workspace?.zip||session?.zip||'').trim().slice(0,5);
  const sender={company:workspace?.company_name||session?.companyName||'',contactName:session?.contactName||''};
  const shownTab=pageRowId||talentPageId?'':tab;
  function leavePage(){if(pageRowId||talentPageId){window.history.pushState(null,'','/app');setPageRowId('');setTalentPageId('')}}
  const panelRow=everyone.find(p=>p.id===panelRowId)||null;
  const pageRow=everyone.find(p=>p.id===pageRowId)||null;
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
        <WorkspaceAccount logout={logout}/>
      </nav>
    </div></header>

    <main className="app-wrap app-content dash-layout">
     <nav className="dash-sidenav" aria-label="Workspace">
      <div className="dash-sidenav-label">Hiring</div>
      <button className={'dash-sidenav-item '+(tab==='openings'?'active':'')} onClick={()=>{leavePage();setIntakeOpeningId('');setTab('openings')}}>Openings</button>
      <button className={'dash-sidenav-item '+(tab==='pipeline'?'active':'')} onClick={()=>{leavePage();setIntakeOpeningId('');setStageFilter('');setTab('pipeline')}}>Candidates{waitingReply.length?` (${waitingReply.length} new)`:''}</button>
      <button className={'dash-sidenav-item '+(tab==='talent'?'active':'')} onClick={()=>{leavePage();setTab('talent')}} disabled={pendingApproval} title={pendingApproval?'Available after approval':undefined}>Find caregivers</button>
      {agencyNetwork.agency&&<button className={'dash-sidenav-item '+(tab==='jobs'?'active':'')} onClick={()=>{leavePage();setTab('jobs')}}>Jobs</button>}
      {billing?.enabled&&<button className={'dash-sidenav-item '+(tab==='plan'?'active':'')} onClick={()=>{leavePage();setTab('plan')}}>Plan</button>}
      <button className={'dash-sidenav-item '+(tab==='settings'?'active':'')} onClick={()=>{leavePage();setTab('settings')}}>Settings</button>
     </nav>
     <div className="dash-main-col">
      <section className="page-head page-head-row">
        <div><h1>{workspace?.company_name||session.companyName||'Recruiting workspace'}</h1></div>
        <div className="header-action"><button className="button" onClick={()=>openOpeningForm(null)}>+ New opening</button></div>
      </section>

      <div className="result-summary workspace-summary">
        <strong>{openOpenings.length} open role{openOpenings.length===1?'':'s'}</strong>
        {([['matched','to review',counts.matched],['contacted','invited',counts.contacted],['interested',applications.length?'said yes or applied':'said yes',counts.interested],['interview',counts.interview===1?'interview':'interviews',counts.interview],['hired','hired',counts.hired]] as const)
          .map(([stage,label,n])=>pendingApproval?<span key={stage}>— {label}</span>
            :<button type="button" key={stage} className={'summary-chip'+(tab==='pipeline'&&stageFilter===stage?' on':'')} onClick={()=>showCandidates(stage)}>{n} {label}</button>)}
      </div>
      {needsYou.length>0&&<section className="needs-you" aria-label="Needs you">
        <div className="needs-you-label">Needs you</div>
        {needsYou.map(item=><button type="button" key={item.key} className="needs-you-item" onClick={item.go}><span>{item.text}</span><strong>{item.action}</strong></button>)}
      </section>}
      {pendingApproval&&<div className="alert-status workspace-alert" role="status"><strong>Caregiver matching is awaiting account approval.</strong> You can create openings and add interview availability now. Caregiver profiles and outreach unlock after approval. Use a verified agency email or claim your agency to verify automatically, or wait for manual review. <button className="text-button" onClick={()=>void refreshWorkspace()} disabled={loading}>Recheck approval</button></div>}
      {billing?.paymentIssue&&<div className="alert-status alert-error workspace-alert" role="status"><strong>Your last payment didn’t go through.</strong> Update your card to keep unlimited introductions. <button className="text-button upgrade-link" disabled={billingBusy} onClick={()=>void openBilling('portal')}>Update card</button></div>}
      {billing?.enabled&&!billing.subscribed&&!billing.paymentIssue&&billing.freeContactsRemaining===0&&<div className="alert-status alert-info workspace-alert" role="status"><strong>{billing.firstHire?'You made your first hire through CareJoys.':'You’ve used your '+billing.freeContacts+' free introductions.'}</strong> New caregivers’ contact details stay hidden until you upgrade. <button className="text-button upgrade-link" disabled={billingBusy} onClick={()=>void openBilling('checkout')}>Upgrade · $79/month</button></div>}
      {message&&<div className={'alert-status workspace-alert'+(messageTone==='ok'?'':' alert-'+messageTone)}>{messageTone==='ok'?'✓ ':''}{message}</div>}


      {pageRowId&&(pageRow
        ?<CandidatePage row={pageRow} actions={candidateActions} templates={templates} sender={sender} disabled={pendingApproval} onBack={closeCandidatePage}/>
        :<section className="section-block"><div className="empty"><strong>{loading?'Loading this caregiver…':'This caregiver isn’t in your candidates.'}</strong><div className="empty-actions"><button className="button secondary" onClick={closeCandidatePage}>Back to candidates</button></div></div></section>)}

      {talentPageId&&<TalentPage id={talentPageId} zip={homeZip} actions={talentActions} onBack={()=>{window.history.pushState(null,'','/app');setTalentPageId('');setTab('talent')}}/>}

      {shownTab==='openings'&&showSetup&&<section className="setup-steps" aria-label="Get started">
        <div className="needs-you-label">Get started</div>
        <ol>{setupSteps.map((step,i)=><li key={i} className={step.done?'done':''}>
          {step.done?<span>{step.label}</span>:<button type="button" className="text-button" onClick={step.go}>{step.label}</button>}
        </li>)}</ol>
      </section>}

      {shownTab==='openings'&&<section className="section-block">
        <div className="section-heading"><h2>Openings</h2><p>Describe the role once, see matches and invite caregivers. Adding interview times is optional.</p></div>
        {results.invited+results.applied>0&&<p className="results-line" role="status"><strong>Your results on CareJoys:</strong> {[results.applied?results.applied+' applied':'',results.invited?results.invited+' invited · '+results.yes+' said yes':'',results.hired+' hired'].filter(Boolean).join(' · ')}</p>}
        {openings.length===0?<div className="empty"><strong>No openings yet.</strong><div>Add the first job you want CareJoys to recruit for.</div><div className="empty-actions"><button className="button secondary" onClick={()=>openOpeningForm(null)}>Create opening</button></div></div>:
        <>{openOpenings.length===0&&<div className="empty"><strong>No open roles.</strong><div>Reopen one below or add a new opening.</div></div>}
        <div className="job-list">{openOpenings.map((o,i)=><OpeningCard key={o.id} opening={o} tone={cardTone(i)} pipeline={pipeline} pendingApproval={pendingApproval}
          onMatch={()=>{setIntakeOpeningId(o.id);void runMatch(o.id)}} onSlots={()=>void openInterviewSlots(o)} onEdit={()=>openOpeningForm(o)} onClose={()=>void setOpeningStatus(o,'closed')}/>)}</div>
        {closedOpenings.length>0&&<div className="closed-openings">
          <h3>Closed</h3>
          {closedOpenings.map(o=><div className="closed-opening" key={o.id}><span><strong>{o.title}</strong>{o.zip?' · '+o.zip:''}</span><button type="button" className="text-button" onClick={()=>void setOpeningStatus(o,'open')}>Reopen</button></div>)}
        </div>}</>}
      </section>}

      {billing?.enabled&&(shownTab==='openings'||shownTab==='plan')&&<section className="section-block plan-section">
        <div className="section-heading"><h2>Your plan</h2><p>{billing.subscribed?'Change locations, switch between monthly and yearly, update your card or see invoices.':'CareJoys is free until your first hire through it. Mark a caregiver hired when they start, and upgrade then to keep getting introductions.'}</p></div>
        {billing.subscribed
          ?<><p className="plan-line"><strong>CareJoys Hiring</strong> · unlimited caregiver introductions.</p><div className="plan-actions"><button className="button secondary" disabled={billingBusy} onClick={()=>void openBilling('portal')}>Manage billing</button></div></>
          :<><p className="plan-line">{billing.firstHire?<><strong>Your free period ended with your first hire.</strong> Caregivers introduced before it stay visible. Unlimited introductions are $79/month per location.</>:<><strong>Free until your first hire</strong> · {billing.freeContactsRemaining??0} of {billing.freeContacts} free introductions left. Then $79/month per location.</>}</p>
            <div className="plan-actions"><button className="button" disabled={billingBusy} onClick={()=>void openBilling('checkout')}>Upgrade · $79/month</button>{billing.yearly&&<button className="text-button" disabled={billingBusy} onClick={()=>void openBilling('checkout','yearly')}>or $790/year</button>}</div></>}
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
          <p>{agencyNetwork.agency?'Caregivers who applied to your jobs and caregivers matched to your openings, in one list.':'Caregivers matched to your openings, by stage. Answers and interview bookings update automatically.'}</p>
        </div>}
        {openingPipeline.length===0?<div className="empty"><strong>{intakeOpening?'No matched caregivers for this opening yet.':'No candidates yet.'}</strong><div>{intakeOpening?'CareJoys will keep looking as verified, available caregivers join nearby. Check the role, ZIP, pay and schedule, or revisit other openings.':agencyNetwork.agency?'Caregivers who apply to your jobs and caregivers matched to your openings show here.':'Matches appear here after you view matches for an opening.'}</div><div className="empty-actions"><button className="button secondary" onClick={()=>{setIntakeOpeningId('');setTab('openings')}}>Back to openings</button><button className="button secondary" onClick={()=>{setIntakeOpeningId('');setTab('talent')}} disabled={pendingApproval}>Find caregivers</button></div></div>:
        <><div className="candidate-views">
          <div className="inbox-filters" role="group" aria-label="Show">
            {([['active','Active'],['archived','Not a fit']] as const).map(([k,label])=><button type="button" key={k} className={'chip'+(candidateView===k&&!(k==='active'&&stageFilter)?' on':'')} aria-pressed={candidateView===k} onClick={()=>{setCandidateView(k);setStageFilter('')}}>{label} <strong>{viewCounts[k]}</strong></button>)}
            {stageFilter&&candidateView==='active'&&<button type="button" className="chip on" aria-pressed="true" onClick={()=>setStageFilter('')} title="Show everyone">{STAGE_LABELS[stageFilter]} <strong>{visiblePipeline.length}</strong> ×</button>}
          </div>
          <button type="button" className="text-button" onClick={()=>setShowTemplates(true)}>Email templates</button>
        </div>
        {visiblePipeline.length===0&&stageFilter&&candidateView==='active'?<div className="empty"><strong>Nobody here right now.</strong><div><button type="button" className="text-button" onClick={()=>setStageFilter('')}>Show all candidates</button></div></div>
        :visiblePipeline.length===0?<div className="empty"><strong>{candidateView==='archived'?'Nobody is marked not a fit.':'Everyone here is marked not a fit.'}</strong><div>{candidateView==='archived'?'Caregivers you mark not a fit, or who decline, show here. You can restore the ones you marked.':'Open Not a fit to restore someone.'}</div></div>
        :<MatchList rows={visiblePipeline} showOpening={!intakeOpening} disabled={pendingApproval} onInvite={invite} onDecide={decide} onNotes={saveNotes} onOpen={r=>setPanelRowId(r.id)} onRestore={restore} onReach={reach}/>}</>}
      </section>}

      {shownTab==='talent'&&<section className="section-block">
        <div className="section-heading"><h2>Find caregivers</h2><p>Everyone available near you, closest first. Invite someone to an opening to start working with them.</p></div>
        <form className="talent-filters settings-card" onSubmit={searchTalent}>
          <div className="talent-filters-row">
            <input value={filters.role} onChange={e=>setFilters({...filters,role:e.target.value})} placeholder="Role or skill: CNA, dementia" aria-label="Role or skill" />
            <input value={filters.zip} onChange={e=>setFilters({...filters,zip:e.target.value})} placeholder="ZIP" inputMode="numeric" aria-label="ZIP" />
            <select value={filters.radius} onChange={e=>setFilters({...filters,radius:e.target.value})} aria-label="Distance from ZIP"><option value="commute">Commuting distance</option><option value="all">Any distance</option><option value="10">Within 10 mi</option><option value="25">Within 25 mi</option><option value="50">Within 50 mi</option><option value="100">Within 100 mi</option></select>
            <button className="button">Search</button>
          </div>
          <div className="talent-filters-row more">
            <select value={filters.shift} onChange={e=>setFilters({...filters,shift:e.target.value})} aria-label="Shift"><option value="">Any shift</option><option value="overnight">Overnights</option><option value="live_in">Live-in</option><option value="weekends">Weekends</option></select>
            <select value={filters.hours} onChange={e=>setFilters({...filters,hours:e.target.value})} aria-label="Hours"><option value="">Any hours</option><option value="full_time">Full time</option><option value="part_time">Part time</option><option value="per_diem">Per diem</option></select>
            <select value={filters.cert} onChange={e=>setFilters({...filters,cert:e.target.value})} aria-label="Certification"><option value="">Any certification</option><option value="CNA">CNA</option><option value="GNA">GNA</option><option value="HHA">HHA</option><option value="CMT">CMT</option><option value="CPR">CPR / First Aid</option></select>
            <select value={filters.freshness} onChange={e=>setFilters({...filters,freshness:e.target.value})} aria-label="Availability"><option value="all">Any availability</option><option value="confirmed">Confirmed in last 30 days</option></select>
            <select value={filters.sort} onChange={e=>setFilters({...filters,sort:e.target.value})} aria-label="Sort"><option value="">Closest first</option><option value="recent">Recently confirmed</option></select>
            <select value={filters.payMax} onChange={e=>setFilters({...filters,payMax:e.target.value})} aria-label="Pay"><option value="">Any pay</option>{[18,20,22,25,30].map(n=><option key={n} value={String(n)}>Up to ${n}/hr</option>)}</select>
            <select value={filters.language} onChange={e=>setFilters({...filters,language:e.target.value})} aria-label="Language"><option value="">Any language</option>{LANGUAGES.map(l=><option key={l}>{l}</option>)}</select>
            <select value={filters.checked} onChange={e=>setFilters({...filters,checked:e.target.value})} aria-label="Confirmed"><option value="">Any checks</option>{CHECKLIST.map(([k,label])=><option key={k} value={k}>{label}</option>)}</select>
            <label className="check-row talent-car"><input type="checkbox" checked={filters.car==='1'} onChange={e=>setFilters({...filters,car:e.target.checked?'1':''})}/><span>Has a car</span></label>
            <button type="button" className="text-button talent-clear" onClick={()=>{const reset={...EMPTY_FILTERS,zip:homeZip};setFilters(reset);void searchTalent(undefined,reset)}}>Clear</button>
          </div>
        </form>
        {alerts.length>0&&<div className="talent-alerts"><span>Email alerts:</span>{alerts.map(a=><span className="badge" key={a.id}>{a.label}<button type="button" className="badge-remove" aria-label={'Turn off alert '+a.label} onClick={()=>void removeAlert(a.id)}>×</button></span>)}</div>}
        {talentState==='loading'?<div className="empty"><strong>Loading available caregivers…</strong></div>:
         talentState==='error'?<div className="empty"><strong>Couldn't load caregivers.</strong><div>Retry the search to view available profiles.</div></div>:
         talentState==='ready'&&candidates.length===0?<div className="empty"><strong>{filters.radius==='commute'?'No caregivers near '+(talentSearchedZip||'you')+' match yet.':'No caregivers match these filters yet.'}</strong><div>{filters.radius==='commute'?'Nobody who matches lives within commuting distance yet. Save this search and CareJoys emails you when someone nearby joins.':'Caregivers show here once they confirm their availability and verify their profile. Try clearing the filters.'}</div>{filters.radius==='commute'&&<div className="empty-actions"><button type="button" className="button secondary" onClick={()=>void saveAlert()}>Email me when someone nearby joins</button></div>}</div>:
         talentState==='ready'?<TalentResults candidates={candidates} total={talentTotal} nearby={talentNearby} zip={talentSearchedZip} sortedByDistance={!filters.sort&&!!talentSearchedZip} actions={talentActions} onOpen={c=>setTalentPanelId(c.id)} onSaveAlert={()=>void saveAlert()}/>:
         <div className="empty"><strong>Loading available caregivers…</strong></div>}
      </section>}

      {!loading&&workspace&&pendingApproval&&!agencyNetwork.agency&&shownTab==='openings'&&<AgencySuggestions onLinked={()=>void refreshWorkspace()}/>}

      {shownTab==='settings'&&<WorkspaceSettings agency={!!agencyNetwork.agency}/>}

      {shownTab==='jobs'&&agencyNetwork.agency&&<section className="section-block">
        <JobsWidgetCard agencyId={agencyNetwork.agency.id}/>
        <AgencyJobsPanel onRecruit={openingId=>void (async()=>{await refreshWorkspace();await runMatch(openingId)})()}/>
      </section>}

      {panelRow&&!pageRowId&&<CandidatePanel row={panelRow} actions={candidateActions} templates={templates} sender={sender} disabled={pendingApproval} onClose={()=>setPanelRowId('')}/>}
      {talentPanel&&!talentPageId&&<TalentPanel candidate={talentPanel} actions={talentActions} onClose={()=>setTalentPanelId('')}/>}
      {showTemplates&&<EmailTemplatesModal templates={templates} onSave={saveTemplate} onDelete={deleteTemplate} onClose={()=>setShowTemplates(false)}/>}
      {showOpening&&<OpeningForm opening={editingOpening} roles={rolesFor(workspace?.employer_type)} serviceArea={workspace?.employer_type!=='assisted_living'} pendingApproval={pendingApproval} onSubmit={createOpening} onCancel={()=>{setShowOpening(false);setEditingOpening(null)}}/>}

      {slotsFor&&<div className="modal-backdrop" onMouseDown={()=>setSlotsFor(null)}><div className="modal-panel" onMouseDown={e=>e.stopPropagation()}>
        <button className="modal-close" onClick={()=>setSlotsFor(null)}>×</button>
        <div className="modal-kicker">Interview availability</div><h2>Add times caregivers can book.</h2><p className="modal-intro">Interested caregivers see these times immediately, so a “yes” can become a booked interview in the same session. Times are in {timeZoneLabel()}.</p>
        {existingSlots.length>0&&<div className="agency-existing-slots"><strong>Available times</strong>{existingSlots.map(s=><div className="agency-existing-slot" key={s.id}><span>{new Date(s.starts_at).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'})} · {s.duration_minutes} min{s.location?' · '+s.location:''}</span><button className="text-button" type="button" onClick={()=>void cancelInterviewSlot(s.id)}>Remove</button></div>)}</div>}
        {slotNotice&&<p className="notice" role="status">{slotNotice}</p>}
        <form className="intake-form" onSubmit={saveSlots}>
          {slotInputs.map((slot,index)=><div className="form-grid" key={index}><label>Interview time<input type="datetime-local" value={slot.startsAt} onChange={e=>setSlotInputs(slotInputs.map((s,i)=>i===index?{...s,startsAt:e.target.value}:s))} required /></label><label>Duration<select value={slot.durationMinutes} onChange={e=>setSlotInputs(slotInputs.map((s,i)=>i===index?{...s,durationMinutes:Number(e.target.value)}:s))}><option value={15}>15 min</option><option value={30}>30 min</option><option value={45}>45 min</option><option value={60}>60 min</option></select></label></div>)}
          {existingSlots.length+slotInputs.length<MAX_SLOTS&&<button type="button" className="button secondary" onClick={()=>setSlotInputs([...slotInputs,{startsAt:'',durationMinutes:30}])}>+ Add another time</button>}
          <label>Where<input value={slotLocation} onChange={e=>setSlotLocation(e.target.value)} maxLength={300} placeholder="Phone call, a video link, or your address" /></label>
          <button className="button submit-button">Save interview times</button>
        </form>
      </div></div>}
     </div>
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

/** The search as URL params: everything set, with "all" meaning no filter (except radius, where "all" is a real choice). */
function talentParams(chosen:TalentFilterState){
  const params=new URLSearchParams();
  Object.entries(chosen).forEach(([k,v])=>{if(v&&(k==='radius'||v!=='all'))params.set(k,v)});
  return params;
}

/**
 * Search results: caregivers within commuting range first, then everyone farther away under a divider. Tiles can be
 * picked and invited to one opening together.
 */
function TalentResults({candidates,total,nearby,zip,sortedByDistance,actions,onOpen,onSaveAlert}:{candidates:Candidate[];total:number;nearby:number;zip:string;sortedByDistance:boolean;actions:TalentActions;onOpen:(c:Candidate)=>void;onSaveAlert:()=>void}){
  const near=sortedByDistance?candidates.filter(c=>c.withinCommute):candidates;
  const far=sortedByDistance?candidates.filter(c=>!c.withinCommute):[];
  const [picked,setPicked]=useState<Set<string>>(new Set());
  const [openingId,setOpeningId]=useState(actions.openings[0]?.id||'');
  const [busy,setBusy]=useState(false);
  useEffect(()=>{if(!actions.openings.some(o=>o.id===openingId))setOpeningId(actions.openings[0]?.id||'')},[actions.openings.map(o=>o.id).join()]);
  // Someone who lives beyond their own commute from the searched ZIP can't take the job, so they can't be invited.
  const tooFar=(c:Candidate)=>c.distanceMiles!=null&&!c.withinCommute;
  const canPick=(c:Candidate)=>actions.openings.length>0&&!actions.pipelineFor(c.id).length&&!tooFar(c);
  const pickable=near.filter(canPick);
  const chosen=candidates.filter(c=>picked.has(c.id)&&canPick(c));
  const allPicked=pickable.length>0&&pickable.every(c=>picked.has(c.id));
  const toggle=(id:string)=>setPicked(prev=>{const next=new Set(prev);next.has(id)?next.delete(id):next.add(id);return next});
  async function inviteChosen(){
    setBusy(true);
    try{await actions.onInvite(chosen,openingId);setPicked(new Set())}finally{setBusy(false)}
  }
  const tile=(c:Candidate,i:number)=>{
    const spots=actions.pipelineFor(c.id);
    const quickInvite=canPick(c)&&actions.openings.length===1&&!chosen.length;
    return <TalentCard candidate={c} tone={cardTone(i)} key={c.id} onOpen={()=>onOpen(c)}
      selected={canPick(c)?picked.has(c.id):undefined} onSelect={canPick(c)?()=>toggle(c.id):undefined}
      note={spots.length?'In your candidates for '+spots.map(s=>s.title).join(', '):tooFar(c)?'Lives beyond their commute from '+zip:undefined}
      action={quickInvite?<button type="button" className="button compact" disabled={actions.disabled} onClick={()=>void actions.onInvite(c,actions.openings[0].id)}>Invite</button>:undefined}/>;
  };
  return <>
    <div className="talent-results-head">
      <p className="talent-results-meta" role="status">{total} caregiver{total===1?'':'s'}{zip?' · '+nearby+' within commuting distance of '+zip:''}</p>
      <button type="button" className="text-button" onClick={onSaveAlert}>Email me new matches</button>
    </div>
    {pickable.length>0&&<div className="match-toolbar talent-toolbar">
      <label className="match-select-all"><input type="checkbox" checked={allPicked} disabled={actions.disabled||busy} onChange={()=>setPicked(allPicked?new Set():new Set(pickable.map(c=>c.id)))}/><span>{chosen.length?chosen.length+' selected':'Select all nearby ('+pickable.length+')'}</span></label>
      <div className="invite-to-opening">
        {actions.openings.length>1&&<select aria-label="Opening to invite to" value={openingId} onChange={e=>setOpeningId(e.target.value)}>{actions.openings.map(o=><option key={o.id} value={o.id}>{o.title}</option>)}</select>}
        <button type="button" className="button" disabled={actions.disabled||busy||!chosen.length||!openingId} onClick={()=>void inviteChosen()}>{busy?'Inviting…':chosen.length?'Invite '+chosen.length+' selected':'Invite selected'}</button>
      </div>
    </div>}
    {near.length>0&&<div className="job-list talent-list">{near.map(tile)}</div>}
    {far.length>0&&<><div className="talent-divider"><span>Farther away</span></div><div className="job-list talent-list">{far.map((c,i)=>tile(c,i+near.length))}</div></>}
  </>;
}

function OpeningCard({opening:o,tone,pipeline,pendingApproval,onMatch,onSlots,onEdit,onClose}:{
  opening:Opening;tone:string;pipeline:PipelineRow[];pendingApproval:boolean;
  onMatch:()=>void;onSlots:()=>void;onEdit:()=>void;onClose:()=>void;
}){
  const rows=pipeline.filter(p=>p.opening_id===o.id);
  const invited=rows.filter(p=>!!p.contacted_at).length;
  const yes=rows.filter(p=>p.response_value==='interested').length;
  const hired=rows.filter(p=>p.stage==='hired').length;
  const pay=payLabel({payMin:o.pay_min,payMax:o.pay_max,payPeriod:'hour'});
  const slots=Number(o.available_interview_slots||0);
  return <article className={'job-card '+tone}>
    <div className="job-card-main">
      <div className="job-card-title-row"><h3>{o.title}</h3></div>
      <div className="job-meta">{[o.role,o.city,o.state,o.zip].filter(Boolean).join(' · ')}</div>
      <div className="job-badges">
        {Number(o.service_radius_miles||0)>0&&<span className="badge">Clients within {o.service_radius_miles} mi</span>}
        {shiftsLabel(o.shift_preferences)&&<span className="badge">{shiftsLabel(o.shift_preferences)}</span>}
        {pay&&<span className="badge">{pay}</span>}
        <span className="status">{o.source==='agency_profile'?'Always-on':postedLabel(o.created_at)||'Open'}</span>
        {rows.length>0&&<span className="badge">{invited?invited+' invited · '+yes+' said yes'+(hired?' · '+hired+' hired':''):rows.length+' matched'}</span>}
        {slots>0&&<span className="badge">{slots} interview time{slots===1?'':'s'} ready</span>}
      </div>
      <div className="opening-links">
        <button type="button" className="opening-interview-link" onClick={onSlots}>{slots>0?'Manage interview times':'Set interview times'}</button>
        <button type="button" className="opening-interview-link" onClick={onEdit}>Edit</button>
        {o.source!=='agency_profile'&&<button type="button" className="opening-interview-link" onClick={onClose}>Close, role filled</button>}
      </div>
    </div>
    <div className="job-card-side opening-actions">
      <button className="button secondary" disabled={pendingApproval} title={pendingApproval?'Matching unlocks after account approval':undefined} onClick={onMatch}>{pendingApproval?'Matches available after approval':'View matches'}</button>
      {pendingApproval&&<span className="opening-next-step">Invitations unlock after account approval.</span>}
    </div>
  </article>;
}

function OpeningForm({opening,roles,serviceArea,pendingApproval,onSubmit,onCancel}:{
  opening:Opening|null;roles:string[];serviceArea:boolean;pendingApproval:boolean;
  onSubmit:(e:FormEvent<HTMLFormElement>)=>void;onCancel:()=>void;
}){
  const [busy,setBusy]=useState(false);
  const roleOptions=opening?.role&&!roles.includes(opening.role)?[opening.role,...roles]:roles;
  async function submit(e:FormEvent<HTMLFormElement>){
    if(busy){e.preventDefault();return}
    setBusy(true);
    try{await onSubmit(e)}finally{setBusy(false)}
  }
  return <div className="modal-backdrop" onMouseDown={onCancel}><div className="modal-panel" onMouseDown={e=>e.stopPropagation()}>
    <button className="modal-close" onClick={onCancel}>×</button>
    <div className="modal-kicker">{opening?'Edit opening':'New opening'}</div>
    <h2>{opening?'Update this opening.':'Who do you need?'}</h2>
    <p className="modal-intro">{opening?'Saving re-ranks the caregiver network for this opening. Caregivers you already invited stay on your list.':'Add the role once. CareJoys uses it to rank the caregiver network immediately.'}</p>
    <form className="intake-form" onSubmit={submit}>
      <div className="form-grid">
        <label>ZIP code<input name="zip" required inputMode="numeric" pattern="[0-9]{5}" maxLength={5} defaultValue={opening?.zip||''} placeholder="21030" /></label>
        <label>Role<select name="role" required defaultValue={opening?.role||''}><option value="" disabled>Select</option>{roleOptions.map(r=><option key={r}>{r}</option>)}</select></label>
      </div>
      <p className="field-hint">We fill in the city and state from the ZIP code.</p>
      {serviceArea&&<label>Where the work is<select name="serviceRadiusMiles" defaultValue={String(opening?.service_radius_miles||'')}>
        <option value="">At one location</option>
        {[10,15,25,50].map(n=><option key={n} value={n}>Clients’ homes within {n} miles</option>)}
      </select></label>}
      <label><span>Job title <span className="optional">(optional)</span></span><input name="title" defaultValue={opening?.title||''} placeholder="We’ll name it from the role and city" /></label>
      <div className="form-grid"><label>Min pay / hr<input type="number" name="payMin" defaultValue={opening?.pay_min??''} /></label><label>Max pay / hr<input type="number" name="payMax" defaultValue={opening?.pay_max??''} /></label></div>
      <ScheduleEditor initial={parseOpeningSchedule(opening?.schedule_json)}/>
      <label>Requirements<textarea name="requirements" rows={4} defaultValue={opening?.requirements||''} placeholder="Experience, credential, schedule, client requirements..." /></label>
      <label className="check-row"><input type="checkbox" name="transportationRequired" defaultChecked={Number(opening?.transportation_required||0)===1} /><span>Reliable transportation required</span></label>
      <button className="button submit-button" disabled={busy}>{opening?'Save':pendingApproval?'Create opening':'Create & match'}</button>
    </form>
  </div></div>;
}
