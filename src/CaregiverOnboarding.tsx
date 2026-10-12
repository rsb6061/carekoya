import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { parseResumeFile, type ParsedResume } from './resumeParser';
import { workerVisitorId } from './workerFunnelClient';
import { hourlyPayFloor } from './payPreferences';
import { TurnstileField } from './TurnstileField';
import { ProfilePhotoStep } from './ProfilePhotoStep';
import { useCaregiverAuth } from './caregiverAuth';
import { jobsHubPath, stateForZipPrefix, usState } from './usStates';
import { SMS_CONSENT_TEXT } from './smsConsent';

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
  // Unticked until they tick it: text consent is optional and never assumed.
  const [smsConsent,setSmsConsent]=useState(false);
  // A signed-in caregiver's saved profile, so applying never asks again for what CareJoys already has. undefined = still checking.
  const [saved,setSaved]=useState<SavedProfile|null|undefined>(draft?null:undefined);
  const [form,setForm]=useState<ResumeForm>(()=>{const p=new URLSearchParams(window.location.search);const initial=draft?.form||{...empty,zip:p.get('zip')||'',role:p.get('role')||'',desiredWage:p.get('payMin')||'',shifts:p.get('shifts')||''};return {...initial,desiredWage:String(hourlyPayFloor(initial.desiredWage)??'')};});
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
  // Shown after a submit with something missing: the fields are outlined and named, instead of the browser's own bubble.
  const [showErrors,setShowErrors]=useState(false);
  const formRef=useRef<HTMLFormElement>(null);
  const [sendProfile,setSendProfile]=useState(true);
  const [continuing,setContinuing]=useState(false);
  // While applying, shifts/pay/transport are tucked behind a link unless they already have answers.
  const [showPrefs,setShowPrefs]=useState(()=>!!(form.shifts||form.desiredWage||form.transportation));

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
        shifts:prev.shifts||text(c.shifts),desiredWage:prev.desiredWage||String(hourlyPayFloor(text(c.desiredWage))??''),
        transportation:prev.transportation||text(c.transportation),travelMiles:c.travelMiles?String(c.travelMiles):prev.travelMiles
      }));
      if(c.shifts||c.desiredWage||c.transportation)setShowPrefs(true);
      setStage(s=>s==='upload'?(targetJobId?'profile':'known'):s);
    })().catch(()=>{if(live)setSaved(null)});
    return ()=>{live=false};
  },[auth.loading,auth.isAuthenticated]);

  // After signing in to claim an existing profile, send the same answers again automatically.
  useEffect(()=>{
    // Signed-in saves skip the security check, so this can go as soon as they are back.
    if(!pendingResubmit||!auth.isAuthenticated||stage!=='profile'||status==='saving')return;
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
    const invalid=Object.entries(missing).filter(([,v])=>v).map(([k])=>k);
    if(invalid.length){
      setShowErrors(true);setStatus('error');
      setMessage('Fill in the '+(invalid.length===1?'highlighted field':'highlighted fields')+' to continue.');
      setTimeout(()=>(formRef.current?.querySelector('[aria-invalid="true"]') as HTMLElement|null)?.focus(),0);
      return;
    }
    setShowErrors(false);
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
        payMin:form.desiredWage?Number(form.desiredWage):null,
        jobAlertsEmailOptIn:emailAlerts,
        smsConsent:smsConsent&&!!form.phone.trim(),
        funnelVisitorId:workerVisitorId(),
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
    firstName:!form.firstName.trim(),lastName:!form.lastName.trim(),email:!auth.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()),
    zip:!/^\d{5}$/.test(form.zip.trim()),state:needsState&&!/^[A-Za-z]{2}$/.test(form.state),role:!form.role
  }),[form,auth.email,needsState]);
  // The fields stay on screen once shown, so fixing one doesn't make the row disappear under the cursor.
  const shown=useRef({name:false,email:false,place:false,state:false}).current;
  if(missing.firstName||missing.lastName)shown.name=true;
  if(missing.email)shown.email=true;
  if(missing.zip||missing.role||missing.state)shown.place=true;
  if(missing.state)shown.state=true;
  const bad=(key:keyof typeof missing)=>showErrors&&missing[key];
  const fieldError=(key:keyof typeof missing,text='Required')=>bad(key)?<span className="field-error">{text}</span>:null;
  const foundCount=[form.firstName,form.lastName,form.email||auth.email,form.phone,form.zip,form.role,form.certifications,form.specialties].filter(Boolean).length;

  // Counts that are zero are left out, and the job they are applying to isn't offered back to them as a match.
  const otherJobs=(result?.topJobs||[]).filter(job=>job.id!==result?.targetJob?.id);
  const orgs=result?.matchedOrganizations||0;
  const matchLine=orgs?<strong>{orgs} relevant care organization{orgs===1?'':'s'}</strong>:null;
  if(stage==='success'&&result){
    const target=result.targetJob?.applicationUrl?result.targetJob:null;
    const employer=target?.employerName||'the employer';
    const photo=result.id&&result.profilePhotoToken?<ProfilePhotoStep caregiverId={result.id} token={result.profilePhotoToken} existingPhotoUrl={result.profilePhotoUrl}/>:null;
    const matches=<>
      {matchLine&&<p>CareJoys found {matchLine}.</p>}
      {!!otherJobs.length&&<strong className="onboarding-more-jobs">More jobs near you</strong>}
      {!!otherJobs.length&&<ul className="onboarding-top-jobs">
        {otherJobs.map(job=><li key={job.id}><a href={'/jobs/'+encodeURIComponent(job.id)}><strong>{job.title}</strong></a><span>{[job.employerName,[job.city,job.state].filter(Boolean).join(', '),job.distanceMiles!=null?job.distanceMiles+' mi':''].filter(Boolean).join(' · ')}</span></li>)}
      </ul>}
    </>;
    return <div className={'caregiver-onboarding '+(compact?'compact':'')}>
      <div className="onboarding-success">
        <div className="success-mark">✓</div>
        {target?<>
          {/* Mid-apply, the one thing left is the employer's own form, so it comes first and the extras after. */}
          <div className="modal-kicker">Profile saved</div>
          <h2>Finish applying to {employer}.</h2>
          <p>{employer} takes applications on their own site. We saved {target.title||'this job'} to your dashboard.</p>
          <div className="onboarding-final-action">
            <label className="check-row"><input type="checkbox" checked={sendProfile} onChange={e=>setSendProfile(e.target.checked)} /><span>Also send my CareJoys profile to {employer} so they can contact me</span></label>
            <button className="btn" onClick={continueApplication} disabled={continuing}>{continuing?'Opening application…':'Continue to '+employer+'’s application'}</button>
          </div>
          {(photo||matchLine||otherJobs.length>0)&&<div className="onboarding-after-apply">
            {photo}
            {matches}
          </div>}
        </>:<>
          <div className="modal-kicker">Profile ready</div>
          <h2>You’re matched.</h2>
          {matches}
          {photo}
          {auth.isAuthenticated
            ?<a className="btn" href="/dashboard">Open your dashboard</a>
            :<a className="btn" href={jobsHubPath(usState(form.state)||usState(inferState(form.zip))||usState('MD')!)+'#current-jobs'}>See more jobs</a>}
        </>}
        {!auth.isAuthenticated&&<div className="onboarding-save-login">
          <strong>Come back to your matches anytime</strong>
          {emailAlerts&&<span>To activate your weekly job emails, verify this email address using a CareJoys sign-in link.</span>}
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
      <form ref={formRef} className="resume-profile-form onboarding-missing-form" onSubmit={onSubmit} noValidate>
        {(shown.name||editParsed)&&<div className="form-grid">
          <label>First name<input value={form.firstName} onChange={e=>patch('firstName',e.target.value)} autoComplete="given-name" aria-invalid={bad('firstName')} />{fieldError('firstName')}</label>
          <label>Last name<input value={form.lastName} onChange={e=>patch('lastName',e.target.value)} autoComplete="family-name" aria-invalid={bad('lastName')} />{fieldError('lastName')}</label>
        </div>}
        {!auth.isAuthenticated&&(shown.email||editParsed)&&<label>Email<input type="email" value={form.email} onChange={e=>patch('email',e.target.value)} autoComplete="email" aria-invalid={bad('email')} />{fieldError('email',form.email?'Enter a valid email':'Required')}</label>}
        {(shown.place||editParsed)&&<div className="form-grid">
          <label>ZIP code<input value={form.zip} onChange={e=>{patch('zip',e.target.value);if(!form.state)patch('state',inferState(e.target.value))}} inputMode="numeric" autoComplete="postal-code" maxLength={5} aria-invalid={bad('zip')} />{fieldError('zip',form.zip?'Enter a 5-digit ZIP':'Required')}</label>
          <label>Role<select value={form.role} onChange={e=>patch('role',e.target.value)} aria-invalid={bad('role')}><option value="">Select</option><option>CNA</option><option>GNA</option><option>HHA</option><option>PCA</option><option>DSP</option><option>Caregiver</option><option>Other</option></select>{fieldError('role')}</label>
        </div>}
        {(shown.state||editParsed)&&<label>State<input value={form.state} onChange={e=>patch('state',e.target.value.toUpperCase().slice(0,2))} maxLength={2} placeholder="MD" aria-invalid={bad('state')} />{fieldError('state','Enter a two-letter state')}</label>}

        {targetJobId&&!showPrefs?<button type="button" className="text-button onboarding-prefs-toggle" onClick={()=>setShowPrefs(true)}>Add job preferences (optional)</button>
        :<div className="onboarding-match-fields">
          <strong>What kind of job fits?{targetJobId&&<span className="onboarding-optional"> Optional</span>}</strong>
          <div className="form-grid">
            <label>Preferred shifts<input value={form.shifts} onChange={e=>patch('shifts',e.target.value)} placeholder="Days, nights, weekends" /></label>
            <label>Minimum hourly pay ($)<input type="number" inputMode="decimal" min="0" max="200" step="0.5" value={form.desiredWage} onChange={e=>patch('desiredWage',e.target.value)} placeholder="e.g. 20" /></label>
          </div>
          <div className="form-grid">
            <label>Transportation<select value={form.transportation} onChange={e=>patch('transportation',e.target.value)}><option value="">Select</option><option value="own_car">Own car</option><option value="reliable_transportation">Reliable transportation</option><option value="public_transit">Public transit</option><option value="other">Other</option></select></label>
            <label>Travel radius (miles)<input type="number" min="1" max="100" value={form.travelMiles} onChange={e=>patch('travelMiles',e.target.value)} /></label>
          </div>
        </div>}

        {editParsed&&<>
          <div className="form-grid"><label>Years of experience<input type="number" min="0" max="60" value={form.yearsExperience} onChange={e=>patch('yearsExperience',e.target.value)} /></label><label>Languages<input value={form.languages} onChange={e=>patch('languages',e.target.value)} /></label></div>
          <label>Certifications<input value={form.certifications} onChange={e=>patch('certifications',e.target.value)} /></label>
          <label>Caregiving skills<input value={form.specialties} onChange={e=>patch('specialties',e.target.value)} /></label>
        </>}
        {(parsed||saved)&&<button type="button" className="text-button onboarding-edit" onClick={()=>setEditParsed(v=>!v)}>{editParsed?'Hide details':parsed?'Review or edit resume details':'Review or edit all details'}</button>}
        <label>Mobile phone (optional)<input type="tel" autoComplete="tel" value={form.phone} onChange={e=>patch('phone',e.target.value)} placeholder="410-555-0123" /></label>
        <label className="check-row sms-consent"><input type="checkbox" checked={smsConsent} onChange={e=>setSmsConsent(e.target.checked)}/><span>{SMS_CONSENT_TEXT}</span></label>
        <label className="check-row"><input type="checkbox" checked={emailAlerts} onChange={e=>setEmailAlerts(e.target.checked)}/><span>Email me a free weekly digest of relevant caregiver jobs. Optional; unsubscribe any time.</span></label>
        {!auth.isAuthenticated&&<TurnstileField onToken={setTurnstileToken}/>}
        {status==='error'&&<div className="notice">{message}</div>}
        <button className="btn submit-button" disabled={status==='saving'}>{status==='saving'?'Finding matches…':targetJobId?'Apply':'Find jobs'}</button>
        <div className="resume-privacy">Your profile stays hidden from employers until you verify your email and confirm availability in your dashboard. Once you make it visible, your profile may be shown to participating care employers for recruiting. See our <a href="/privacy-policy">Privacy Policy</a> and <a href="/terms-of-service">Terms</a>.</div>
      </form>
    </div>;
  }

  return <div className={'caregiver-onboarding '+(compact?'compact':'')}>
    <div className="resume-upload-card onboarding-upload-card">
      <div className="resume-upload-icon">↑</div>
      <h2>{heading}</h2>
      <p>{subheading}</p>
      <label className="btn resume-file-button">{parsing?'Reading resume…':'Upload resume'}<input type="file" accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" onChange={onFile} disabled={parsing}/></label>
      <div className="onboarding-file-note">PDF, DOCX or TXT. We fill in your profile from it.</div>
      <button className="text-button onboarding-skip-resume" onClick={()=>afterResume(null)} disabled={parsing}>No resume? Continue without one</button>
      {status==='error'&&<div className="notice">{message}</div>}
    </div>
  </div>;
}
