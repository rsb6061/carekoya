import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { parseResumeFile, type ParsedResume } from './resumeParser';
import { TurnstileField } from './TurnstileField';
import { ProfilePhotoStep } from './ProfilePhotoStep';
import { useCaregiverAuth } from './caregiverAuth';
import { jobsHubPath, stateForZipPrefix, usState } from './usStates';

type ResumeForm={
  firstName:string;lastName:string;email:string;phone:string;zip:string;state:string;role:string;
  shifts:string;desiredWage:string;transportation:string;travelMiles:string;certifications:string;
  specialties:string;languages:string;yearsExperience:string;
};
type MatchResult={
  ok?:boolean;id?:string;matchedOrganizations?:number;matchedOpenings?:number;marylandMatching?:boolean;
  existing?:boolean;profilePhotoToken?:string;resumeUploadToken?:string;profilePhotoUrl?:string|null;error?:string;needsVerifiedSignIn?:boolean;authenticated?:boolean;
  topJobs?:{id:string;title:string;employerName?:string;city?:string;state?:string;distanceMiles?:number|null}[];
  targetJob?:{id:string;title?:string;employerName?:string;applicationUrl?:string}|null;
};
type SavedProfile={
  firstName?:string;lastName?:string;phone?:string;zip?:string;state?:string;role?:string;certifications?:string;specialties?:string;
  languages?:string;yearsExperience?:number|null;shifts?:string;desiredWage?:string;transportation?:string;travelMiles?:number|null;
};
type Props={
  referralSlug?:string;
  targetJobId?:string;
  compact?:boolean;
  heading?:string;
  subheading?:string;
};

const empty:ResumeForm={
  firstName:'',lastName:'',email:'',phone:'',zip:'',state:'',role:'',shifts:'',
  desiredWage:'',transportation:'',travelMiles:'25',certifications:'',specialties:'',languages:'',yearsExperience:''
};

function splitName(name:string){
  const parts=name.trim().split(/\s+/).filter(Boolean);
  return {firstName:parts[0]||'',lastName:parts.length>1?parts[parts.length-1]:''};
}
// Only used for display; the server works out the state from any US ZIP.
const inferState=(zip:string)=>stateForZipPrefix(zip);
const phoneOk=(value:string)=>{const d=value.replace(/\D/g,'');return d.length===10||(d.length===11&&d.startsWith('1'))};
// The parsed resume survives the trip to the emailed sign-in link, which often opens in a new tab, for up to two hours.
const DRAFT_KEY='carejoys:onboarding-draft';
const DRAFT_MS=2*3600000;
type Draft={form:ResumeForm;parsed:ParsedResume|null;fileMeta:{name:string;type:string;size:number}|null;resubmit:boolean;savedAt?:number};
function readDraft():Draft|null{
  try{
    const raw=localStorage.getItem(DRAFT_KEY);
    const draft=raw?JSON.parse(raw) as Draft:null;
    if(draft&&Date.now()-(draft.savedAt||0)<DRAFT_MS)return draft;
    localStorage.removeItem(DRAFT_KEY);
    return null;
  }catch{return null}
}
function writeDraft(draft:Draft|null){
  try{if(draft)localStorage.setItem(DRAFT_KEY,JSON.stringify({...draft,savedAt:Date.now()}));else localStorage.removeItem(DRAFT_KEY)}catch{}
}
function summaryValue(label:string,value:string){
  return value?<span className="onboarding-summary-item"><strong>{label}</strong>{value}</span>:null;
}

export function CaregiverOnboarding({referralSlug='',targetJobId='',compact=false,heading='Upload your resume',subheading='We’ll build your CareJoys profile and ask only for anything missing.'}:Props){
  const auth=useCaregiverAuth();
  const [draft]=useState(readDraft);
  const [stage,setStage]=useState<'upload'|'known'|'auth'|'profile'|'success'>(draft?'profile':'upload');
  const [emailAlerts,setEmailAlerts]=useState(false);
  // A signed-in caregiver's saved profile, so applying never asks again for what CareJoys already has. undefined = still checking.
  const [saved,setSaved]=useState<SavedProfile|null|undefined>(draft?null:undefined);
  const [form,setForm]=useState<ResumeForm>(()=>{const p=new URLSearchParams(window.location.search);return draft?.form||{...empty,zip:p.get('zip')||'',role:p.get('role')||'',desiredWage:p.get('payMin')?'
  const [parsed,setParsed]=useState<ParsedResume|null>(draft?.parsed||null);
  const [fileMeta,setFileMeta]=useState<{name:string;type:string;size:number}|null>(draft?.fileMeta||null);
  const [needsState,setNeedsState]=useState(false);
  const [pendingResubmit,setPendingResubmit]=useState(!!draft?.resubmit);
  const [parsing,setParsing]=useState(false);
  const [status,setStatus]=useState<'idle'|'saving'|'error'>('idle');
  const [message,setMessage]=useState('');
  const [result,setResult]=useState<MatchResult|null>(null);
  // The resume file itself, kept so it can be stored with the profile once that is saved.
  const resumeFileRef=useRef<File|null>(null);
  const [turnstileToken,setTurnstileToken]=useState('');
  const [editParsed,setEditParsed]=useState(false);
  const smsConsentRef=useRef(false);
  const [turnstileRequired,setTurnstileRequired]=useState(false);
  useEffect(()=>{fetch('/api/config').then(r=>r.json()).then((c:any)=>setTurnstileRequired(!!c?.turnstileSiteKey)).catch(()=>{})},[]);
  const [sendProfile,setSendProfile]=useState(true);
  const [continuing,setContinuing]=useState(false);

  function patch<K extends keyof ResumeForm>(key:K,value:ResumeForm[K]){
    setForm(prev=>({...prev,[key]:value}));
  }

  useEffect(()=>{
    if(!auth.isAuthenticated)return;
    const name=splitName(auth.name);
    setForm(prev=>({
      ...prev,
      firstName:prev.firstName||name.firstName,
      lastName:prev.lastName||name.lastName,
      email:auth.email||prev.email
    }));
    if(stage==='auth')setStage('profile');
  },[auth.isAuthenticated,auth.email,auth.name,stage]);

  useEffect(()=>{
    if(auth.loading)return;
    if(!auth.isAuthenticated||draft){setSaved(null);return;}
    let live=true;
    (async()=>{
      const res=await fetch('/api/me');
      const c=res.ok?(await res.json() as {caregiver?:SavedProfile|null}).caregiver:null;
      if(!live)return;
      setSaved(c||null);
      if(!c)return;
      const text=(v:unknown)=>v==null?'':String(v);
      setForm(prev=>({...prev,
        firstName:prev.firstName||text(c.firstName),lastName:prev.lastName||text(c.lastName),phone:prev.phone||text(c.phone),
        zip:prev.zip||text(c.zip),state:prev.state||text(c.state),role:prev.role||text(c.role),
        certifications:prev.certifications||text(c.certifications),specialties:prev.specialties||text(c.specialties),
        languages:prev.languages||text(c.languages),yearsExperience:prev.yearsExperience||text(c.yearsExperience),
        shifts:prev.shifts||text(c.shifts),desiredWage:prev.desiredWage||text(c.desiredWage),
        transportation:prev.transportation||text(c.transportation),travelMiles:c.travelMiles?String(c.travelMiles):prev.travelMiles
      }));
      setStage(s=>s==='upload'?(targetJobId?'profile':'known'):s);
    })().catch(()=>{if(live)setSaved(null)});
    return ()=>{live=false};
  },[auth.loading,auth.isAuthenticated]);

  // After signing in to claim an existing profile, send the same answers again automatically.
  useEffect(()=>{
    if(!pendingResubmit||!auth.isAuthenticated||stage!=='profile'||status==='saving')return;
    if(turnstileRequired&&!turnstileToken)return;
    setPendingResubmit(false);
    void save();
  },[pendingResubmit,auth.isAuthenticated,stage,turnstileToken]);

  function afterResume(found:ParsedResume|null){
    if(found){
      setParsed(found);
      setForm(prev=>({
        ...prev,
        firstName:found.firstName||prev.firstName,
        lastName:found.lastName||prev.lastName,
        email:found.email||prev.email,
        phone:found.phone||prev.phone,
        zip:found.zip||prev.zip,
        state:inferState(found.zip)||prev.state,
        role:found.role||prev.role,
        certifications:found.certifications.join(', '),
        specialties:found.specialties.join(', '),
        languages:found.languages.join(', ')
      }));
    }
    // Sign-in is optional now: everyone goes straight to the profile, and only an existing profile asks for it.
    setStage('profile');
  }

  async function onFile(e:ChangeEvent<HTMLInputElement>){
    const file=e.target.files?.[0];
    if(!file)return;
    setParsing(true);setMessage('');setStatus('idle');
    try{
      const found=await parseResumeFile(file);
      setFileMeta({name:file.name,type:file.type||'application/octet-stream',size:file.size});
      resumeFileRef.current=file;
      afterResume(found);
    }catch(error){
      setStatus('error');setMessage(error instanceof Error?error.message:'Could not read that resume.');
    }finally{setParsing(false)}
  }

  async function login(kind:'google'|'email'){
    setStatus('idle');setMessage('');
    // Keep the answers in case the browser blocks the popup and sign-in falls back to a full-page redirect.
    if(stage!=='success')writeDraft({form,parsed,fileMeta,resubmit:stage==='auth'});
    try{
      if(kind==='google')await auth.loginGoogle({next:stage==='success'?'/dashboard':window.location.pathname+window.location.search});
      else await auth.loginEmail({email:form.email,next:stage==='success'?'/dashboard':window.location.pathname+window.location.search});
      if(stage==='auth')setPendingResubmit(true);
      return true;
    }catch(error){
      setStatus('error');setMessage(error instanceof Error?error.message:'Could not sign in.');
      return false;
    }
  }

  async function onSubmit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();
    smsConsentRef.current=new FormData(e.currentTarget).get('smsConsent')==='on';
    if(!phoneOk(form.phone)){setStatus('error');setMessage('Enter a 10-digit mobile phone number.');return;}
    await save();
  }

  async function save(){
    setStatus('saving');setMessage('');
    try{
      const payload={
        ...form,
        email:auth.email||form.email,
        yearsExperience:Number(form.yearsExperience||0)||null,
        travelMiles:Number(form.travelMiles||0)||null,
        smsConsent:smsConsentRef.current,
        jobAlertsEmailOptIn:emailAlerts,
        turnstileToken,
        sourceFilename:fileMeta?.name||'',
        sourceMimeType:fileMeta?.type||'',
        sourceFileSize:fileMeta?.size||0,
        referralSlug,
        targetJobId
      };
      const res=await fetch('/api/caregiver-resume',{
        method:'POST',
        headers:{'content-type':'application/json'},
        body:JSON.stringify(payload)
      });
      const body=await res.json() as MatchResult;
      if(res.status===409&&body.needsVerifiedSignIn){
        setStatus('idle');setMessage(body.error||'');setTurnstileToken('');setStage('auth');
        return;
      }
      if(!res.ok){
        if(/two-letter state/i.test(body.error||''))setNeedsState(true);
        throw new Error(body.error||'Could not save your CareJoys profile.');
      }
      writeDraft(null);
      const file=resumeFileRef.current;
      if(file&&body.id&&body.resumeUploadToken){
        // Stored so CareJoys can attach it when it applies for them; a failure here doesn't block the profile.
        await fetch('/api/caregivers/'+encodeURIComponent(body.id)+'/resume-file',{method:'POST',
          headers:{'content-type':file.type||'application/octet-stream','x-file-name':encodeURIComponent(file.name),'x-carejoys-profile-token':body.resumeUploadToken},body:file}).catch(()=>null);
      }
      setResult(body);setStage('success');setStatus('idle');
    }catch(error){
      setStatus('error');setMessage(error instanceof Error?error.message:'Could not save your profile.');
    }
  }

  async function continueApplication(){
    const target=result?.targetJob;
    if(!target?.id||!target.applicationUrl)return;
    setContinuing(true);
    try{
      if(sendProfile){
        // Also put the caregiver in the agency's CareJoys Inbox. Without a verified sign-in this emails them a Send link.
        await fetch('/api/public/caregiver-jobs/'+encodeURIComponent(target.id)+'/interest',{
          method:'POST',
          headers:{'content-type':'application/json'},
          body:JSON.stringify({caregiverId:result?.id})
        }).catch(()=>null);
      }
      const res=await fetch('/api/public/caregiver-jobs/'+encodeURIComponent(target.id)+'/apply',{
        method:'POST',
        headers:{'content-type':'application/json'},
        body:JSON.stringify({caregiverId:result?.id})
      });
      const body=await res.json() as {applicationUrl?:string};
      window.location.href=body.applicationUrl||target.applicationUrl;
    }catch{
      window.location.href=target.applicationUrl;
    }
  }

  const missing=useMemo(()=>({
    firstName:!form.firstName,lastName:!form.lastName,email:!form.email&&!auth.email,phone:!form.phone,
    zip:!form.zip,state:needsState&&!form.state,role:!form.role
  }),[form,auth.email]);
  const foundCount=[form.firstName,form.lastName,form.email||auth.email,form.phone,form.zip,form.role,form.certifications,form.specialties].filter(Boolean).length;

  if(stage==='success'&&result){
    return <div className={'caregiver-onboarding '+(compact?'compact':'')}>
      <div className="onboarding-success">
        <div className="success-mark">✓</div>
        <div className="modal-kicker">{result.targetJob?'Application ready':'Profile ready'}</div>
        <h2>{result.targetJob?'Your CareJoys profile is ready.':'You’re matched.'}</h2>
        <p>CareJoys found <strong>{result.matchedOrganizations||0} relevant care organizations</strong>{typeof result.matchedOpenings==='number'?<> and <strong>{result.matchedOpenings} current job{result.matchedOpenings===1?'':'s'} near you</strong></>:null}.</p>
        {!!result.topJobs?.length&&<ul className="onboarding-top-jobs">
          {result.topJobs.map(job=><li key={job.id}><a href={'/jobs/'+encodeURIComponent(job.id)}><strong>{job.title}</strong></a><span>{[job.employerName,[job.city,job.state].filter(Boolean).join(', '),job.distanceMiles!=null?job.distanceMiles+' mi':''].filter(Boolean).join(' · ')}</span></li>)}
        </ul>}
        {result.id&&result.profilePhotoToken&&<ProfilePhotoStep caregiverId={result.id} token={result.profilePhotoToken} existingPhotoUrl={result.profilePhotoUrl}/>}
        {result.targetJob?.applicationUrl
          ?<div className="onboarding-final-action">
            <label className="check-row"><input type="checkbox" checked={sendProfile} onChange={e=>setSendProfile(e.target.checked)} /><span>Also send my CareJoys profile to {result.targetJob.employerName||'this employer'} so they can contact me</span></label>
            <button className="btn" onClick={continueApplication} disabled={continuing}>{continuing?'Opening application…':'Continue application'}</button><span>You’ll finish on {result.targetJob.employerName||'the employer'}’s site.</span>
          </div>
          :auth.isAuthenticated
            ?<a className="btn" href="/dashboard">Open your dashboard</a>
            :<a className="btn" href={jobsHubPath(usState(form.state)||usState(inferState(form.zip))||usState('MD')!)+'#current-jobs'}>See more jobs</a>}
        {!auth.isAuthenticated&&<div className="onboarding-save-login">
          <strong>Come back to your matches anytime</strong>
          <span>Sign in once to see employer invites, update availability and track applications.</span>
          <div className="auth-choice">
            <button className="btn secondary" onClick={()=>void login('email')}>Email me a sign-in link</button>
            {auth.googleAvailable&&<button className="text-button auth-google" onClick={async()=>{if(await login('google'))window.location.href='/dashboard'}}>Continue with Google</button>}
          </div>
        </div>}
      </div>
    </div>;
  }

  if(auth.loading||saved===undefined)return <div className={'caregiver-onboarding '+(compact?'compact':'')}><div className="onboarding-file-note">Loading your profile…</div></div>;

  if(stage==='known'){
    return <div className={'caregiver-onboarding '+(compact?'compact':'')}>
      <div className="onboarding-auth">
        <div className="modal-kicker">Signed in as {auth.email}</div>
        <h2>Welcome back{form.firstName?', '+form.firstName:''}.</h2>
        <p>Your CareJoys profile is saved. Open any job and apply with it in one step, or update your details.</p>
        <div className="onboarding-summary">
          {summaryValue('Role',form.role)}
          {summaryValue('ZIP',form.zip)}
          {summaryValue('Shifts',form.shifts)}
          {summaryValue('Credentials',form.certifications)}
        </div>
        <div className="auth-choice">
          <a className="btn" href="/dashboard">Open my dashboard</a>
          <a className="btn secondary" href="/dashboard/profile">Update my profile</a>
        </div>
      </div>
    </div>;
  }

  if(stage==='auth'){
    return <div className={'caregiver-onboarding '+(compact?'compact':'')}>
      <div className="onboarding-auth">
        <div className="modal-kicker">Welcome back</div>
        <h2>You already have a CareJoys profile.</h2>
        <p>Sign in with the same email to update it. We’ll email you a link; your answers are saved and will be sent as soon as you’re signed in.</p>
        {fileMeta&&<div className="resume-file-meta">{fileMeta.name} · {foundCount} profile details found</div>}
        <div className="auth-choice">
          <button className="btn" onClick={()=>login('email')}>Email me a sign-in link</button>
          {auth.googleAvailable&&<button className="btn secondary auth-google" onClick={()=>login('google')}>Continue with Google</button>}
        </div>
        <button className="text-button" onClick={()=>{setStage('profile');setEditParsed(true);setMessage('')}}>Use a different email</button>
        {status==='error'&&<div className="notice">{message}</div>}
      </div>
    </div>;
  }

  if(stage==='profile'){
    return <div className={'caregiver-onboarding '+(compact?'compact':'')}>
      <div className="modal-kicker">{parsed?'Resume parsed':saved?'Your CareJoys profile':'CareJoys profile'}</div>
      <h2>{parsed?'Just a few things left.':saved?(targetJobId?'Apply with your saved profile.':'Update your profile.'):'Tell us what fits.'}</h2>
      {auth.isAuthenticated&&<div className="auth-signed-in">Signed in as <strong>{auth.email}</strong></div>}
      {(parsed||saved)&&<div className="onboarding-summary">
        {summaryValue('Role',form.role)}
        {summaryValue('ZIP',form.zip)}
        {summaryValue('Credentials',form.certifications)}
        {summaryValue('Skills',form.specialties)}
      </div>}
      <form className="resume-profile-form onboarding-missing-form" onSubmit={onSubmit}>
        {(missing.firstName||missing.lastName||editParsed)&&<div className="form-grid">
          <label>First name<input value={form.firstName} onChange={e=>patch('firstName',e.target.value)} required /></label>
          <label>Last name<input value={form.lastName} onChange={e=>patch('lastName',e.target.value)} required /></label>
        </div>}
        {(missing.email||missing.phone||editParsed)&&<div className="form-grid">
          {!auth.isAuthenticated&&<label>Email<input type="email" value={form.email} onChange={e=>patch('email',e.target.value)} required /></label>}
          <label>Mobile phone<input type="tel" inputMode="tel" autoComplete="tel" value={form.phone} onChange={e=>patch('phone',e.target.value)} required /></label>
        </div>}
        {(missing.zip||missing.state||missing.role||editParsed)&&<div className="form-grid">
          <label>ZIP code<input value={form.zip} onChange={e=>{patch('zip',e.target.value);if(!form.state)patch('state',inferState(e.target.value))}} inputMode="numeric" pattern="[0-9]{5}" required /></label>
          <label>Role<select value={form.role} onChange={e=>patch('role',e.target.value)} required><option value="">Select</option><option>CNA</option><option>GNA</option><option>HHA</option><option>PCA</option><option>DSP</option><option>Caregiver</option><option>Other</option></select></label>
        </div>}
        {(missing.state||editParsed)&&<label>State<input value={form.state} onChange={e=>patch('state',e.target.value.toUpperCase().slice(0,2))} maxLength={2} placeholder="MD" required /></label>}

        <div className="onboarding-match-fields">
          <strong>What kind of job fits?</strong>
          <div className="form-grid">
            <label>Preferred shifts<input value={form.shifts} onChange={e=>patch('shifts',e.target.value)} placeholder="Days, nights, weekends" /></label>
            <label>Desired hourly pay<input value={form.desiredWage} onChange={e=>patch('desiredWage',e.target.value)} placeholder="$20–24/hr" /></label>
          </div>
          <div className="form-grid">
            <label>Transportation<select value={form.transportation} onChange={e=>patch('transportation',e.target.value)}><option value="">Select</option><option value="own_car">Own car</option><option value="reliable_transportation">Reliable transportation</option><option value="public_transit">Public transit</option><option value="other">Other</option></select></label>
            <label>Travel radius (miles)<input type="number" min="1" max="100" value={form.travelMiles} onChange={e=>patch('travelMiles',e.target.value)} /></label>
          </div>
        </div>

        {editParsed&&<>
          <div className="form-grid"><label>Years of experience<input type="number" min="0" max="60" value={form.yearsExperience} onChange={e=>patch('yearsExperience',e.target.value)} /></label><label>Languages<input value={form.languages} onChange={e=>patch('languages',e.target.value)} /></label></div>
          <label>Certifications<input value={form.certifications} onChange={e=>patch('certifications',e.target.value)} /></label>
          <label>Caregiving skills<input value={form.specialties} onChange={e=>patch('specialties',e.target.value)} /></label>
        </>}
        {(parsed||saved)&&<button type="button" className="text-button onboarding-edit" onClick={()=>setEditParsed(v=>!v)}>{editParsed?'Hide details':parsed?'Review or edit resume details':'Review or edit all details'}</button>}
        <label className="check-row"><input type="checkbox" checked={emailAlerts} onChange={e=>setEmailAlerts(e.target.checked)}/><span>Email me a free weekly digest of relevant caregiver jobs. Optional; unsubscribe any time.</span></label>
        <TurnstileField onToken={setTurnstileToken}/>
        {status==='error'&&<div className="notice">{message}</div>}
        <button className="btn submit-button" disabled={status==='saving'}>{status==='saving'?'Finding matches…':targetJobId?'Apply':'Find jobs'}</button>
        <div className="resume-privacy">By continuing, your caregiver work profile may be shown to participating care employers for recruiting. See our <a href="/privacy-policy">Privacy Policy</a> and <a href="/terms-of-service">Terms</a>.</div>
      </form>
    </div>;
  }

  return <div className={'caregiver-onboarding '+(compact?'compact':'')}>
    <div className="resume-upload-card onboarding-upload-card">
      <div className="resume-upload-icon">↑</div>
      <h2>{heading}</h2>
      <p>{subheading}</p>
      <button className="btn" onClick={()=>afterResume(null)}>Continue without a resume</button>
      <label className="btn secondary resume-file-button">{parsing?'Reading resume…':'Or upload resume'}<input type="file" accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" onChange={onFile} disabled={parsing}/></label>
      <div className="onboarding-file-note">PDF, DOCX or TXT · Free</div>
      <div className="onboarding-file-note">Uploading is optional. You can add a resume later.</div>
      {status==='error'&&<div className="notice">{message}</div>}
    </div>
  </div>;
}
+p.get('payMin')+'+/hr':'',shifts:p.get('shifts')||''}});
  const [parsed,setParsed]=useState<ParsedResume|null>(draft?.parsed||null);
  const [fileMeta,setFileMeta]=useState<{name:string;type:string;size:number}|null>(draft?.fileMeta||null);
  const [needsState,setNeedsState]=useState(false);
  const [pendingResubmit,setPendingResubmit]=useState(!!draft?.resubmit);
  const [parsing,setParsing]=useState(false);
  const [status,setStatus]=useState<'idle'|'saving'|'error'>('idle');
  const [message,setMessage]=useState('');
  const [result,setResult]=useState<MatchResult|null>(null);
  // The resume file itself, kept so it can be stored with the profile once that is saved.
  const resumeFileRef=useRef<File|null>(null);
  const [turnstileToken,setTurnstileToken]=useState('');
  const [editParsed,setEditParsed]=useState(false);
  const smsConsentRef=useRef(false);
  const [turnstileRequired,setTurnstileRequired]=useState(false);
  useEffect(()=>{fetch('/api/config').then(r=>r.json()).then((c:any)=>setTurnstileRequired(!!c?.turnstileSiteKey)).catch(()=>{})},[]);
  const [sendProfile,setSendProfile]=useState(true);
  const [continuing,setContinuing]=useState(false);

  function patch<K extends keyof ResumeForm>(key:K,value:ResumeForm[K]){
    setForm(prev=>({...prev,[key]:value}));
  }

  useEffect(()=>{
    if(!auth.isAuthenticated)return;
    const name=splitName(auth.name);
    setForm(prev=>({
      ...prev,
      firstName:prev.firstName||name.firstName,
      lastName:prev.lastName||name.lastName,
      email:auth.email||prev.email
    }));
    if(stage==='auth')setStage('profile');
  },[auth.isAuthenticated,auth.email,auth.name,stage]);

  useEffect(()=>{
    if(auth.loading)return;
    if(!auth.isAuthenticated||draft){setSaved(null);return;}
    let live=true;
    (async()=>{
      const res=await fetch('/api/me');
      const c=res.ok?(await res.json() as {caregiver?:SavedProfile|null}).caregiver:null;
      if(!live)return;
      setSaved(c||null);
      if(!c)return;
      const text=(v:unknown)=>v==null?'':String(v);
      setForm(prev=>({...prev,
        firstName:prev.firstName||text(c.firstName),lastName:prev.lastName||text(c.lastName),phone:prev.phone||text(c.phone),
        zip:prev.zip||text(c.zip),state:prev.state||text(c.state),role:prev.role||text(c.role),
        certifications:prev.certifications||text(c.certifications),specialties:prev.specialties||text(c.specialties),
        languages:prev.languages||text(c.languages),yearsExperience:prev.yearsExperience||text(c.yearsExperience),
        shifts:prev.shifts||text(c.shifts),desiredWage:prev.desiredWage||text(c.desiredWage),
        transportation:prev.transportation||text(c.transportation),travelMiles:c.travelMiles?String(c.travelMiles):prev.travelMiles
      }));
      setStage(s=>s==='upload'?(targetJobId?'profile':'known'):s);
    })().catch(()=>{if(live)setSaved(null)});
    return ()=>{live=false};
  },[auth.loading,auth.isAuthenticated]);

  // After signing in to claim an existing profile, send the same answers again automatically.
  useEffect(()=>{
    if(!pendingResubmit||!auth.isAuthenticated||stage!=='profile'||status==='saving')return;
    if(turnstileRequired&&!turnstileToken)return;
    setPendingResubmit(false);
    void save();
  },[pendingResubmit,auth.isAuthenticated,stage,turnstileToken]);

  function afterResume(found:ParsedResume|null){
    if(found){
      setParsed(found);
      setForm(prev=>({
        ...prev,
        firstName:found.firstName||prev.firstName,
        lastName:found.lastName||prev.lastName,
        email:found.email||prev.email,
        phone:found.phone||prev.phone,
        zip:found.zip||prev.zip,
        state:inferState(found.zip)||prev.state,
        role:found.role||prev.role,
        certifications:found.certifications.join(', '),
        specialties:found.specialties.join(', '),
        languages:found.languages.join(', ')
      }));
    }
    // Sign-in is optional now: everyone goes straight to the profile, and only an existing profile asks for it.
    setStage('profile');
  }

  async function onFile(e:ChangeEvent<HTMLInputElement>){
    const file=e.target.files?.[0];
    if(!file)return;
    setParsing(true);setMessage('');setStatus('idle');
    try{
      const found=await parseResumeFile(file);
      setFileMeta({name:file.name,type:file.type||'application/octet-stream',size:file.size});
      resumeFileRef.current=file;
      afterResume(found);
    }catch(error){
      setStatus('error');setMessage(error instanceof Error?error.message:'Could not read that resume.');
    }finally{setParsing(false)}
  }

  async function login(kind:'google'|'email'){
    setStatus('idle');setMessage('');
    // Keep the answers in case the browser blocks the popup and sign-in falls back to a full-page redirect.
    if(stage!=='success')writeDraft({form,parsed,fileMeta,resubmit:stage==='auth'});
    try{
      if(kind==='google')await auth.loginGoogle({next:stage==='success'?'/dashboard':window.location.pathname+window.location.search});
      else await auth.loginEmail({email:form.email,next:stage==='success'?'/dashboard':window.location.pathname+window.location.search});
      if(stage==='auth')setPendingResubmit(true);
      return true;
    }catch(error){
      setStatus('error');setMessage(error instanceof Error?error.message:'Could not sign in.');
      return false;
    }
  }

  async function onSubmit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();
    smsConsentRef.current=new FormData(e.currentTarget).get('smsConsent')==='on';
    if(!phoneOk(form.phone)){setStatus('error');setMessage('Enter a 10-digit mobile phone number.');return;}
    await save();
  }

  async function save(){
    setStatus('saving');setMessage('');
    try{
      const payload={
        ...form,
        email:auth.email||form.email,
        yearsExperience:Number(form.yearsExperience||0)||null,
        travelMiles:Number(form.travelMiles||0)||null,
        smsConsent:smsConsentRef.current,
        jobAlertsEmailOptIn:emailAlerts,
        turnstileToken,
        sourceFilename:fileMeta?.name||'',
        sourceMimeType:fileMeta?.type||'',
        sourceFileSize:fileMeta?.size||0,
        referralSlug,
        targetJobId
      };
      const res=await fetch('/api/caregiver-resume',{
        method:'POST',
        headers:{'content-type':'application/json'},
        body:JSON.stringify(payload)
      });
      const body=await res.json() as MatchResult;
      if(res.status===409&&body.needsVerifiedSignIn){
        setStatus('idle');setMessage(body.error||'');setTurnstileToken('');setStage('auth');
        return;
      }
      if(!res.ok){
        if(/two-letter state/i.test(body.error||''))setNeedsState(true);
        throw new Error(body.error||'Could not save your CareJoys profile.');
      }
      writeDraft(null);
      const file=resumeFileRef.current;
      if(file&&body.id&&body.resumeUploadToken){
        // Stored so CareJoys can attach it when it applies for them; a failure here doesn't block the profile.
        await fetch('/api/caregivers/'+encodeURIComponent(body.id)+'/resume-file',{method:'POST',
          headers:{'content-type':file.type||'application/octet-stream','x-file-name':encodeURIComponent(file.name),'x-carejoys-profile-token':body.resumeUploadToken},body:file}).catch(()=>null);
      }
      setResult(body);setStage('success');setStatus('idle');
    }catch(error){
      setStatus('error');setMessage(error instanceof Error?error.message:'Could not save your profile.');
    }
  }

  async function continueApplication(){
    const target=result?.targetJob;
    if(!target?.id||!target.applicationUrl)return;
    setContinuing(true);
    try{
      if(sendProfile){
        // Also put the caregiver in the agency's CareJoys Inbox. Without a verified sign-in this emails them a Send link.
        await fetch('/api/public/caregiver-jobs/'+encodeURIComponent(target.id)+'/interest',{
          method:'POST',
          headers:{'content-type':'application/json'},
          body:JSON.stringify({caregiverId:result?.id})
        }).catch(()=>null);
      }
      const res=await fetch('/api/public/caregiver-jobs/'+encodeURIComponent(target.id)+'/apply',{
        method:'POST',
        headers:{'content-type':'application/json'},
        body:JSON.stringify({caregiverId:result?.id})
      });
      const body=await res.json() as {applicationUrl?:string};
      window.location.href=body.applicationUrl||target.applicationUrl;
    }catch{
      window.location.href=target.applicationUrl;
    }
  }

  const missing=useMemo(()=>({
    firstName:!form.firstName,lastName:!form.lastName,email:!form.email&&!auth.email,phone:!form.phone,
    zip:!form.zip,state:needsState&&!form.state,role:!form.role
  }),[form,auth.email]);
  const foundCount=[form.firstName,form.lastName,form.email||auth.email,form.phone,form.zip,form.role,form.certifications,form.specialties].filter(Boolean).length;

  if(stage==='success'&&result){
    return <div className={'caregiver-onboarding '+(compact?'compact':'')}>
      <div className="onboarding-success">
        <div className="success-mark">✓</div>
        <div className="modal-kicker">{result.targetJob?'Application ready':'Profile ready'}</div>
        <h2>{result.targetJob?'Your CareJoys profile is ready.':'You’re matched.'}</h2>
        <p>CareJoys found <strong>{result.matchedOrganizations||0} relevant care organizations</strong>{typeof result.matchedOpenings==='number'?<> and <strong>{result.matchedOpenings} current job{result.matchedOpenings===1?'':'s'} near you</strong></>:null}.</p>
        {!!result.topJobs?.length&&<ul className="onboarding-top-jobs">
          {result.topJobs.map(job=><li key={job.id}><a href={'/jobs/'+encodeURIComponent(job.id)}><strong>{job.title}</strong></a><span>{[job.employerName,[job.city,job.state].filter(Boolean).join(', '),job.distanceMiles!=null?job.distanceMiles+' mi':''].filter(Boolean).join(' · ')}</span></li>)}
        </ul>}
        {result.id&&result.profilePhotoToken&&<ProfilePhotoStep caregiverId={result.id} token={result.profilePhotoToken} existingPhotoUrl={result.profilePhotoUrl}/>}
        {result.targetJob?.applicationUrl
          ?<div className="onboarding-final-action">
            <label className="check-row"><input type="checkbox" checked={sendProfile} onChange={e=>setSendProfile(e.target.checked)} /><span>Also send my CareJoys profile to {result.targetJob.employerName||'this employer'} so they can contact me</span></label>
            <button className="btn" onClick={continueApplication} disabled={continuing}>{continuing?'Opening application…':'Continue application'}</button><span>You’ll finish on {result.targetJob.employerName||'the employer'}’s site.</span>
          </div>
          :auth.isAuthenticated
            ?<a className="btn" href="/dashboard">Open your dashboard</a>
            :<a className="btn" href={jobsHubPath(usState(form.state)||usState(inferState(form.zip))||usState('MD')!)+'#current-jobs'}>See more jobs</a>}
        {!auth.isAuthenticated&&<div className="onboarding-save-login">
          <strong>Come back to your matches anytime</strong>
          <span>Sign in once to see employer invites, update availability and track applications.</span>
          <div className="auth-choice">
            <button className="btn secondary" onClick={()=>void login('email')}>Email me a sign-in link</button>
            {auth.googleAvailable&&<button className="text-button auth-google" onClick={async()=>{if(await login('google'))window.location.href='/dashboard'}}>Continue with Google</button>}
          </div>
        </div>}
      </div>
    </div>;
  }

  if(auth.loading||saved===undefined)return <div className={'caregiver-onboarding '+(compact?'compact':'')}><div className="onboarding-file-note">Loading your profile…</div></div>;

  if(stage==='known'){
    return <div className={'caregiver-onboarding '+(compact?'compact':'')}>
      <div className="onboarding-auth">
        <div className="modal-kicker">Signed in as {auth.email}</div>
        <h2>Welcome back{form.firstName?', '+form.firstName:''}.</h2>
        <p>Your CareJoys profile is saved. Open any job and apply with it in one step, or update your details.</p>
        <div className="onboarding-summary">
          {summaryValue('Role',form.role)}
          {summaryValue('ZIP',form.zip)}
          {summaryValue('Shifts',form.shifts)}
          {summaryValue('Credentials',form.certifications)}
        </div>
        <div className="auth-choice">
          <a className="btn" href="/dashboard">Open my dashboard</a>
          <a className="btn secondary" href="/dashboard/profile">Update my profile</a>
        </div>
      </div>
    </div>;
  }

  if(stage==='auth'){
    return <div className={'caregiver-onboarding '+(compact?'compact':'')}>
      <div className="onboarding-auth">
        <div className="modal-kicker">Welcome back</div>
        <h2>You already have a CareJoys profile.</h2>
        <p>Sign in with the same email to update it. We’ll email you a link; your answers are saved and will be sent as soon as you’re signed in.</p>
        {fileMeta&&<div className="resume-file-meta">{fileMeta.name} · {foundCount} profile details found</div>}
        <div className="auth-choice">
          <button className="btn" onClick={()=>login('email')}>Email me a sign-in link</button>
          {auth.googleAvailable&&<button className="btn secondary auth-google" onClick={()=>login('google')}>Continue with Google</button>}
        </div>
        <button className="text-button" onClick={()=>{setStage('profile');setEditParsed(true);setMessage('')}}>Use a different email</button>
        {status==='error'&&<div className="notice">{message}</div>}
      </div>
    </div>;
  }

  if(stage==='profile'){
    return <div className={'caregiver-onboarding '+(compact?'compact':'')}>
      <div className="modal-kicker">{parsed?'Resume parsed':saved?'Your CareJoys profile':'CareJoys profile'}</div>
      <h2>{parsed?'Just a few things left.':saved?(targetJobId?'Apply with your saved profile.':'Update your profile.'):'Tell us what fits.'}</h2>
      {auth.isAuthenticated&&<div className="auth-signed-in">Signed in as <strong>{auth.email}</strong></div>}
      {(parsed||saved)&&<div className="onboarding-summary">
        {summaryValue('Role',form.role)}
        {summaryValue('ZIP',form.zip)}
        {summaryValue('Credentials',form.certifications)}
        {summaryValue('Skills',form.specialties)}
      </div>}
      <form className="resume-profile-form onboarding-missing-form" onSubmit={onSubmit}>
        {(missing.firstName||missing.lastName||editParsed)&&<div className="form-grid">
          <label>First name<input value={form.firstName} onChange={e=>patch('firstName',e.target.value)} required /></label>
          <label>Last name<input value={form.lastName} onChange={e=>patch('lastName',e.target.value)} required /></label>
        </div>}
        {(missing.email||missing.phone||editParsed)&&<div className="form-grid">
          {!auth.isAuthenticated&&<label>Email<input type="email" value={form.email} onChange={e=>patch('email',e.target.value)} required /></label>}
          <label>Mobile phone<input type="tel" inputMode="tel" autoComplete="tel" value={form.phone} onChange={e=>patch('phone',e.target.value)} required /></label>
        </div>}
        {(missing.zip||missing.state||missing.role||editParsed)&&<div className="form-grid">
          <label>ZIP code<input value={form.zip} onChange={e=>{patch('zip',e.target.value);if(!form.state)patch('state',inferState(e.target.value))}} inputMode="numeric" pattern="[0-9]{5}" required /></label>
          <label>Role<select value={form.role} onChange={e=>patch('role',e.target.value)} required><option value="">Select</option><option>CNA</option><option>GNA</option><option>HHA</option><option>PCA</option><option>DSP</option><option>Caregiver</option><option>Other</option></select></label>
        </div>}
        {(missing.state||editParsed)&&<label>State<input value={form.state} onChange={e=>patch('state',e.target.value.toUpperCase().slice(0,2))} maxLength={2} placeholder="MD" required /></label>}

        <div className="onboarding-match-fields">
          <strong>What kind of job fits?</strong>
          <div className="form-grid">
            <label>Preferred shifts<input value={form.shifts} onChange={e=>patch('shifts',e.target.value)} placeholder="Days, nights, weekends" /></label>
            <label>Desired hourly pay<input value={form.desiredWage} onChange={e=>patch('desiredWage',e.target.value)} placeholder="$20–24/hr" /></label>
          </div>
          <div className="form-grid">
            <label>Transportation<select value={form.transportation} onChange={e=>patch('transportation',e.target.value)}><option value="">Select</option><option value="own_car">Own car</option><option value="reliable_transportation">Reliable transportation</option><option value="public_transit">Public transit</option><option value="other">Other</option></select></label>
            <label>Travel radius (miles)<input type="number" min="1" max="100" value={form.travelMiles} onChange={e=>patch('travelMiles',e.target.value)} /></label>
          </div>
        </div>

        {editParsed&&<>
          <div className="form-grid"><label>Years of experience<input type="number" min="0" max="60" value={form.yearsExperience} onChange={e=>patch('yearsExperience',e.target.value)} /></label><label>Languages<input value={form.languages} onChange={e=>patch('languages',e.target.value)} /></label></div>
          <label>Certifications<input value={form.certifications} onChange={e=>patch('certifications',e.target.value)} /></label>
          <label>Caregiving skills<input value={form.specialties} onChange={e=>patch('specialties',e.target.value)} /></label>
        </>}
        {(parsed||saved)&&<button type="button" className="text-button onboarding-edit" onClick={()=>setEditParsed(v=>!v)}>{editParsed?'Hide details':parsed?'Review or edit resume details':'Review or edit all details'}</button>}
        <label className="check-row"><input type="checkbox" checked={emailAlerts} onChange={e=>setEmailAlerts(e.target.checked)}/><span>Email me a free weekly digest of relevant caregiver jobs. Optional; unsubscribe any time.</span></label>
        <TurnstileField onToken={setTurnstileToken}/>
        {status==='error'&&<div className="notice">{message}</div>}
        <button className="btn submit-button" disabled={status==='saving'}>{status==='saving'?'Finding matches…':targetJobId?'Apply':'Find jobs'}</button>
        <div className="resume-privacy">By continuing, your caregiver work profile may be shown to participating care employers for recruiting. See our <a href="/privacy-policy">Privacy Policy</a> and <a href="/terms-of-service">Terms</a>.</div>
      </form>
    </div>;
  }

  return <div className={'caregiver-onboarding '+(compact?'compact':'')}>
    <div className="resume-upload-card onboarding-upload-card">
      <div className="resume-upload-icon">↑</div>
      <h2>{heading}</h2>
      <p>{subheading}</p>
      <button className="btn" onClick={()=>afterResume(null)}>Continue without a resume</button>
      <label className="btn secondary resume-file-button">{parsing?'Reading resume…':'Or upload resume'}<input type="file" accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" onChange={onFile} disabled={parsing}/></label>
      <div className="onboarding-file-note">PDF, DOCX or TXT · Free</div>
      <div className="onboarding-file-note">Uploading is optional. You can add a resume later.</div>
      {status==='error'&&<div className="notice">{message}</div>}
    </div>
  </div>;
}
