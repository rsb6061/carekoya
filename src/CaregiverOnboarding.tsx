import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import { parseResumeFile, type ParsedResume } from './resumeParser';
import { TurnstileField } from './TurnstileField';
import { ProfilePhotoStep } from './ProfilePhotoStep';
import { useCaregiverAuth } from './caregiverAuth';

type ResumeForm={
  firstName:string;lastName:string;email:string;phone:string;zip:string;state:string;role:string;
  shifts:string;desiredWage:string;transportation:string;travelMiles:string;certifications:string;
  specialties:string;languages:string;yearsExperience:string;
};
type MatchResult={
  ok?:boolean;id?:string;matchedOrganizations?:number;matchedOpenings?:number;marylandMatching?:boolean;
  existing?:boolean;profilePhotoToken?:string;profilePhotoUrl?:string|null;error?:string;
  targetJob?:{id:string;title?:string;employerName?:string;applicationUrl?:string}|null;
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
function inferState(zip:string){
  const prefix=Number(zip.slice(0,3));
  return zip&&prefix>=206&&prefix<=219?'MD':'';
}
function summaryValue(label:string,value:string){
  return value?<span className="onboarding-summary-item"><strong>{label}</strong>{value}</span>:null;
}

export function CaregiverOnboarding({referralSlug='',targetJobId='',compact=false,heading='Upload your resume',subheading='We’ll build your CareJoys profile and ask only for anything missing.'}:Props){
  const auth=useCaregiverAuth();
  const [stage,setStage]=useState<'upload'|'auth'|'profile'|'success'>('upload');
  const [form,setForm]=useState<ResumeForm>(empty);
  const [parsed,setParsed]=useState<ParsedResume|null>(null);
  const [fileMeta,setFileMeta]=useState<{name:string;type:string;size:number}|null>(null);
  const [parsing,setParsing]=useState(false);
  const [status,setStatus]=useState<'idle'|'saving'|'error'>('idle');
  const [message,setMessage]=useState('');
  const [result,setResult]=useState<MatchResult|null>(null);
  const [turnstileToken,setTurnstileToken]=useState('');
  const [editParsed,setEditParsed]=useState(false);

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
    setStage(auth.configured&&!auth.isAuthenticated?'auth':'profile');
  }

  async function onFile(e:ChangeEvent<HTMLInputElement>){
    const file=e.target.files?.[0];
    if(!file)return;
    setParsing(true);setMessage('');setStatus('idle');
    try{
      const found=await parseResumeFile(file);
      setFileMeta({name:file.name,type:file.type||'application/octet-stream',size:file.size});
      afterResume(found);
    }catch(error){
      setStatus('error');setMessage(error instanceof Error?error.message:'Could not read that resume.');
    }finally{setParsing(false)}
  }

  async function login(kind:'google'|'email'){
    setStatus('idle');setMessage('');
    try{
      if(kind==='google')await auth.loginGoogle();
      else await auth.loginEmail();
    }catch(error){
      setStatus('error');setMessage(error instanceof Error?error.message:'Could not sign in.');
    }
  }

  async function onSubmit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();setStatus('saving');setMessage('');
    try{
      const idToken=auth.configured?await auth.getIdToken():'';
      const payload={
        ...form,
        email:auth.email||form.email,
        yearsExperience:Number(form.yearsExperience||0)||null,
        travelMiles:Number(form.travelMiles||0)||null,
        smsConsent:new FormData(e.currentTarget).get('smsConsent')==='on',
        turnstileToken,
        sourceFilename:fileMeta?.name||'',
        sourceMimeType:fileMeta?.type||'',
        sourceFileSize:fileMeta?.size||0,
        referralSlug,
        targetJobId
      };
      const res=await fetch('/api/caregiver-resume',{
        method:'POST',
        headers:{'content-type':'application/json',...(idToken?{authorization:'Bearer '+idToken}:{})},
        body:JSON.stringify(payload)
      });
      const body=await res.json() as MatchResult;
      if(!res.ok)throw new Error(body.error||'Could not save your CareJoys profile.');
      setResult(body);setStage('success');setStatus('idle');
    }catch(error){
      setStatus('error');setMessage(error instanceof Error?error.message:'Could not save your profile.');
    }
  }

  async function continueApplication(){
    const target=result?.targetJob;
    if(!target?.id||!target.applicationUrl)return;
    try{
      const idToken=auth.configured?await auth.getIdToken():'';
      const res=await fetch('/api/public/caregiver-jobs/'+encodeURIComponent(target.id)+'/apply',{
        method:'POST',
        headers:{'content-type':'application/json',...(idToken?{authorization:'Bearer '+idToken}:{})},
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
    zip:!form.zip,state:!form.state,role:!form.role
  }),[form,auth.email]);
  const foundCount=[form.firstName,form.lastName,form.email||auth.email,form.phone,form.zip,form.role,form.certifications,form.specialties].filter(Boolean).length;

  if(stage==='success'&&result){
    return <div className={'caregiver-onboarding '+(compact?'compact':'')}>
      <div className="onboarding-success">
        <div className="success-mark">✓</div>
        <div className="modal-kicker">{result.targetJob?'Application ready':'Profile ready'}</div>
        <h2>{result.targetJob?'Your CareJoys profile is ready.':'You’re matched.'}</h2>
        <p>CareJoys found <strong>{result.matchedOrganizations||0} relevant care organizations</strong>{typeof result.matchedOpenings==='number'?<> and <strong>{result.matchedOpenings} current opening{result.matchedOpenings===1?'':'s'}</strong></>:null}.</p>
        {result.id&&result.profilePhotoToken&&<ProfilePhotoStep caregiverId={result.id} token={result.profilePhotoToken} existingPhotoUrl={result.profilePhotoUrl}/>}
        {result.targetJob?.applicationUrl
          ?<div className="onboarding-final-action"><button className="btn" onClick={continueApplication}>Continue application</button><span>You’ll finish on {result.targetJob.employerName||'the employer'}’s site.</span></div>
          :<a className="btn" href="/caregiver-jobs/maryland#current-jobs">See matching jobs</a>}
      </div>
    </div>;
  }

  if(stage==='auth'){
    return <div className={'caregiver-onboarding '+(compact?'compact':'')}>
      <div className="onboarding-auth">
        <div className="modal-kicker">Save your profile</div>
        <h2>One quick sign in.</h2>
        <p>We parsed your resume. Sign in so you can save the profile, apply, and reuse it for other caregiver jobs.</p>
        {fileMeta&&<div className="resume-file-meta">{fileMeta.name} · {foundCount} profile details found</div>}
        <div className="auth-choice">
          <button className="btn auth-google" onClick={()=>login('google')}>Continue with Google</button>
          <button className="btn secondary" onClick={()=>login('email')}>Continue with email</button>
        </div>
        <button className="text-button" onClick={()=>setStage('upload')}>Use a different resume</button>
        {status==='error'&&<div className="notice">{message}</div>}
      </div>
    </div>;
  }

  if(stage==='profile'){
    return <div className={'caregiver-onboarding '+(compact?'compact':'')}>
      <div className="modal-kicker">{parsed?'Resume parsed':'CareJoys profile'}</div>
      <h2>{parsed?'Just a few things left.':'Tell us what fits.'}</h2>
      {auth.isAuthenticated&&<div className="auth-signed-in">Signed in as <strong>{auth.email}</strong></div>}
      {parsed&&<div className="onboarding-summary">
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
          <label>Mobile phone<input value={form.phone} onChange={e=>patch('phone',e.target.value)} required /></label>
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
            <label>Travel radius<input type="number" min="1" max="100" value={form.travelMiles} onChange={e=>patch('travelMiles',e.target.value)} /> miles</label>
          </div>
        </div>

        {editParsed&&<>
          <div className="form-grid"><label>Years of experience<input type="number" min="0" max="60" value={form.yearsExperience} onChange={e=>patch('yearsExperience',e.target.value)} /></label><label>Languages<input value={form.languages} onChange={e=>patch('languages',e.target.value)} /></label></div>
          <label>Certifications<input value={form.certifications} onChange={e=>patch('certifications',e.target.value)} /></label>
          <label>Caregiving skills<input value={form.specialties} onChange={e=>patch('specialties',e.target.value)} /></label>
        </>}
        {parsed&&<button type="button" className="text-button onboarding-edit" onClick={()=>setEditParsed(v=>!v)}>{editParsed?'Hide resume details':'Review or edit resume details'}</button>}
        <label className="check-row"><input type="checkbox" name="smsConsent" /><span>I agree to receive CareJoys texts about job opportunities and availability. Message/data rates may apply. Reply STOP to opt out.</span></label>
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
      <label className="btn resume-file-button">{parsing?'Reading resume…':'Upload resume'}<input type="file" accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" onChange={onFile} disabled={parsing}/></label>
      <div className="onboarding-file-note">PDF, DOCX or TXT · Free</div>
      <button className="text-button" onClick={()=>afterResume(null)}>No resume? Start from scratch</button>
      {status==='error'&&<div className="notice">{message}</div>}
    </div>
  </div>;
}
