import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import { TurnstileField } from './TurnstileField';
import { ProfilePhotoStep } from './ProfilePhotoStep';
import { CHECKLIST } from './checklist';
import { workerVisitorId } from './workerFunnelClient';
import { CALL_TIME_OPTIONS, EXPERIENCE_OPTIONS, ROLE_OPTIONS, SHIFT_OPTIONS, TRANSPORT_OPTIONS, WORK_TYPE_OPTIONS } from './quickApplyShared';

// /apply/:id for someone with no CareJoys profile: three short steps, no account or resume, about two minutes.
// 1. Who and where (name, email, mobile, ZIP with how far the job is, role). 2. Taps: hours, shifts, experience,
// transportation, what employers check first, and the agency's own questions. 3. The result: sent (and book an
// interview now), or, for an employer not on CareJoys, finish on its site. Resume and photo are optional extras after.

type Question={id:string;label:string;type:'yes_no'|'text';knockout?:'yes'|'no'};
type Time={at:string;label:string};
type Result={
  status:'applied'|'already_applied'|'not_sent'|'not_a_fit';caregiverId:string;profilePhotoToken?:string|null;resumeUploadToken?:string|null;
  employerName:string;applicationUrl:string;knockouts?:string[];error?:string;bookingToken?:string;grade?:string;
  interview?:{mode:'book';format:string;formatLabel:string;location:string;times:Time[]}|{mode:'prefer';options:{key:string;label:string}[]};
};
export type QuickApplyJob={id:string;title:string;employerName:string;employerOnCareJoys?:boolean;payText?:string;where?:string};

const TOTAL=3;
function Chips<T extends string>({options,value,onChange,multi,label,invalid}:{options:readonly (readonly [T,string])[];value:T[];onChange:(v:T[])=>void;multi?:boolean;label:string;invalid?:boolean}){
  return <div className={'qa-chips'+(invalid?' invalid':'')} role="group" aria-label={label}>
    {options.map(([key,text])=>{const on=value.includes(key);
      return <button type="button" key={key} className={'qa-chip'+(on?' on':'')} aria-pressed={on}
        onClick={()=>onChange(multi?(on?value.filter(v=>v!==key):[...value,key]):[key])}>{text}</button>})}
  </div>;
}
/** One question: a <label> around a text input, or a plain block around a row of chips (a label would click the first chip). */
function Field({label,hint,error,children,chips}:{label:string;hint?:ReactNode;error?:string;children:ReactNode;chips?:boolean}){
  const inner=<><span className="qa-label">{label}</span>{children}{hint&&<span className="qa-hint">{hint}</span>}{error&&<span className="field-error">{error}</span>}</>;
  return chips?<div className="qa-field">{inner}</div>:<label className="qa-field">{inner}</label>;
}

export function QuickApply({job,signedInEmail,onSignIn}:{job:QuickApplyJob;signedInEmail?:string;onSignIn:()=>void}){
  const [step,setStep]=useState<1|2|3>(1);
  const [form,setForm]=useState({firstName:'',lastName:'',email:signedInEmail||'',phone:'',zip:''});
  const [role,setRole]=useState<string[]>([]);
  const [workType,setWorkType]=useState<string[]>([]);
  const [shifts,setShifts]=useState<string[]>([]);
  const [experience,setExperience]=useState<string[]>([]);
  const [transportation,setTransportation]=useState<string[]>([]);
  const [checklist,setChecklist]=useState<string[]>([]);
  const [questions,setQuestions]=useState<Question[]>([]);
  const [screening,setScreening]=useState<Record<string,string>>({});
  const [miles,setMiles]=useState<number|null>(null);
  const [showErrors,setShowErrors]=useState(false);
  const [turnstileToken,setTurnstileToken]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [result,setResult]=useState<Result|null>(null);
  const rootRef=useRef<HTMLDivElement>(null);

  useEffect(()=>{rootRef.current?.scrollIntoView({block:'start',behavior:'smooth'})},[step]);
  // The agency's questions now; how far the job is once the ZIP has five digits.
  useEffect(()=>{
    const zip=/^\d{5}$/.test(form.zip.trim())?form.zip.trim():'';
    let live=true;
    fetch('/api/public/caregiver-jobs/'+encodeURIComponent(job.id)+'/apply-form'+(zip?'?zip='+zip:''))
      .then(r=>r.json()).then((b:{questions?:Question[];miles?:number|null})=>{if(!live)return;setQuestions(b.questions||[]);setMiles(zip&&typeof b.miles==='number'?b.miles:null)})
      .catch(()=>{});
    return ()=>{live=false};
  },[job.id,form.zip]);

  const set=(k:keyof typeof form)=>(e:ChangeEvent<HTMLInputElement>)=>setForm(f=>({...f,[k]:e.target.value}));
  const phoneDigits=form.phone.replace(/\D/g,'').replace(/^1(?=\d{10}$)/,'');
  const missing1={firstName:!form.firstName.trim(),lastName:!form.lastName.trim(),email:!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()),
    phone:phoneDigits.length!==10,zip:!/^\d{5}$/.test(form.zip.trim()),role:!role.length};
  const yesNo=questions.filter(q=>q.type==='yes_no');
  const missing2={workType:!workType.length,shifts:!shifts.length,experience:!experience.length,transportation:!transportation.length,
    questions:yesNo.some(q=>!screening[q.id])};
  const err=(bad:boolean,text='Required')=>showErrors&&bad?text:undefined;
  const sends=!!job.employerOnCareJoys;

  function next(e:FormEvent){
    e.preventDefault();
    if(Object.values(missing1).some(Boolean)){setShowErrors(true);setError('Fill in the highlighted fields.');return}
    setShowErrors(false);setError('');setStep(2);
  }
  async function submit(e:FormEvent){
    e.preventDefault();
    if(Object.values(missing2).some(Boolean)){setShowErrors(true);setError('Answer the highlighted questions.');return}
    setShowErrors(false);setError('');setBusy(true);
    try{
      const res=await fetch('/api/apply/'+encodeURIComponent(job.id),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({
        ...form,email:signedInEmail||form.email.trim(),role:role[0],workType:workType[0],shifts,experience,transportation:transportation[0],checklist,screening,
        turnstileToken,funnelVisitorId:workerVisitorId()})});
      const body=await res.json() as Result&{ok?:boolean;error?:string;needsSignIn?:boolean};
      if(!res.ok){setTurnstileToken('');throw new Error(body.error||'Could not send your application.')}
      setResult(body);setStep(3);
    }catch(e){setError(e instanceof Error?e.message:'Could not send your application.')}
    finally{setBusy(false)}
  }

  const progress=<div className="qa-progress" aria-label={'Step '+step+' of '+TOTAL}>
    <span>Step {step} of {TOTAL}</span><span className="qa-bar"><span style={{width:(step/TOTAL*100)+'%'}}/></span><span>About 2 minutes</span>
  </div>;

  if(step===3&&result)return <div ref={rootRef} className="quick-apply">{progress}<QuickApplyResult job={job} result={result} email={signedInEmail||form.email.trim()} signedIn={!!signedInEmail} firstName={form.firstName.trim()}/></div>;

  if(step===2)return <div ref={rootRef} className="quick-apply">
    {progress}
    <h2>A few quick questions</h2>
    <p className="qa-sub">Tap your answers. {sends?job.employerName+' sees them with your application.':'They go on your CareJoys profile for every job.'}</p>
    <form onSubmit={submit} noValidate className="qa-form">
      <Field chips label="Are you looking for full-time or part-time work?" error={err(missing2.workType,'Choose one')}><Chips label="Hours" options={WORK_TYPE_OPTIONS} value={workType} onChange={setWorkType} invalid={showErrors&&missing2.workType}/></Field>
      <Field chips label="When can you work? Choose all that fit." error={err(missing2.shifts,'Choose at least one')}><Chips label="Shifts" multi options={SHIFT_OPTIONS} value={shifts} onChange={setShifts} invalid={showErrors&&missing2.shifts}/></Field>
      <Field chips label="Have you cared for older adults before? Choose all that fit." error={err(missing2.experience,'Choose at least one')}><Chips label="Experience" multi options={EXPERIENCE_OPTIONS} value={experience} onChange={setExperience} invalid={showErrors&&missing2.experience}/></Field>
      <Field chips label="How would you get to clients?" error={err(missing2.transportation,'Choose one')}><Chips label="Transportation" options={TRANSPORT_OPTIONS} value={transportation} onChange={setTransportation} invalid={showErrors&&missing2.transportation}/></Field>
      <Field chips label="Tap everything that’s true for you."><Chips label="Checklist" multi options={CHECKLIST} value={checklist} onChange={setChecklist}/></Field>
      {questions.length>0&&<div className="qa-agency-questions">
        <div className="qa-agency-head">{job.employerName} also asks</div>
        {questions.map(q=>q.type==='yes_no'
          ?<Field chips key={q.id} label={q.label} error={err(!screening[q.id],'Choose yes or no')}><Chips label={q.label} options={[['yes','Yes'],['no','No']] as const} value={screening[q.id]?[screening[q.id] as 'yes'|'no']:[]} onChange={v=>setScreening(s=>({...s,[q.id]:v[0]}))} invalid={showErrors&&!screening[q.id]}/></Field>
          :<Field key={q.id} label={q.label+' (optional)'}><input className="qa-input" value={screening[q.id]||''} maxLength={300} onChange={e=>{const v=e.target.value;setScreening(s=>({...s,[q.id]:v}))}}/></Field>)}
      </div>}
      <TurnstileField onToken={setTurnstileToken}/>
      {error&&<div className="notice">{error}</div>}
      <div className="qa-actions">
        <button type="button" className="text-button qa-back" onClick={()=>{setStep(1);setError('');setShowErrors(false)}}>← Back</button>
        <button className="btn qa-submit" disabled={busy}>{busy?'Sending…':sends?'Send my application':'Save and continue'}</button>
      </div>
    </form>
  </div>;

  return <div ref={rootRef} className="quick-apply">
    {progress}
    <h2>Apply in about 2 minutes</h2>
    <p className="qa-sub">No account and no resume needed.{sends?' Your application goes straight to '+job.employerName+'.':' We’ll save your answers, then you finish on '+job.employerName+'’s site.'}</p>
    <form onSubmit={next} noValidate className="qa-form">
      <div className="qa-row">
        <Field label="First name" error={err(missing1.firstName)}><input className="qa-input" value={form.firstName} onChange={set('firstName')} autoComplete="given-name" aria-invalid={showErrors&&missing1.firstName}/></Field>
        <Field label="Last name" error={err(missing1.lastName)}><input className="qa-input" value={form.lastName} onChange={set('lastName')} autoComplete="family-name" aria-invalid={showErrors&&missing1.lastName}/></Field>
      </div>
      {!signedInEmail&&<Field label="Email" error={err(missing1.email,'Enter a valid email')}><input className="qa-input" type="email" value={form.email} onChange={set('email')} autoComplete="email" inputMode="email" aria-invalid={showErrors&&missing1.email}/></Field>}
      <div className="qa-row">
        <Field label="Mobile phone" error={err(missing1.phone,'Enter a 10-digit number')}><input className="qa-input" type="tel" value={form.phone} onChange={set('phone')} autoComplete="tel" inputMode="tel" placeholder="410-555-0123" aria-invalid={showErrors&&missing1.phone}/></Field>
        <Field label="ZIP code" error={err(missing1.zip,'Enter a 5-digit ZIP')} hint={miles!==null?<span className="qa-distance">{miles<1?'Under a mile from this job':'About '+Math.round(miles)+' miles from this job'}{miles<=15?' — a short drive!':''}</span>:undefined}>
          <input className="qa-input" value={form.zip} onChange={set('zip')} inputMode="numeric" maxLength={5} autoComplete="postal-code" aria-invalid={showErrors&&missing1.zip}/>
        </Field>
      </div>
      <Field chips label="Your role" error={err(missing1.role,'Choose one')}><Chips label="Role" options={ROLE_OPTIONS.map(r=>[r,r] as const)} value={role} onChange={setRole} invalid={showErrors&&missing1.role}/></Field>
      {error&&<div className="notice">{error}</div>}
      <button className="btn qa-submit">Continue</button>
      <p className="qa-fine">By continuing you confirm you’re 18 or older and agree to the <a href="/terms-of-service" target="_blank" rel="noopener">Terms</a> and <a href="/privacy-policy" target="_blank" rel="noopener">Privacy Policy</a>. We’ll email you about this application.</p>
      {!signedInEmail&&<p className="qa-fine">Already on CareJoys? <button type="button" className="qa-link" onClick={onSignIn}>Sign in to apply with your profile</button></p>}
    </form>
  </div>;
}

function QuickApplyResult({job,result,email,signedIn,firstName}:{job:QuickApplyJob;result:Result;email:string;signedIn:boolean;firstName:string}){
  const employer=result.employerName||job.employerName||'the employer';
  if(result.status==='not_a_fit')return <div className="qa-result">
    <div className="modal-kicker">Not sent</div>
    <h2>This job isn’t a match.</h2>
    {result.error?<p>{result.error}</p>:<p>{employer} needs a different answer to: <strong>{(result.knockouts||[]).join('; ')}</strong>. We didn’t send your application, and your answers are saved for other jobs.</p>}
    <div className="qa-actions-col"><a className="btn" href="/caregiver-jobs">See other jobs near you</a></div>
    <Extras result={result} email={email} signedIn={signedIn}/>
  </div>;
  if(result.status==='not_sent')return <div className="qa-result">
    <div className="success-mark">✓</div>
    <div className="modal-kicker">Profile saved</div>
    <h2>Last step: finish on {employer}’s site.</h2>
    <p>{employer} takes applications on its own site, so CareJoys can’t send this one for you. Your answers are saved for other jobs.</p>
    <div className="qa-actions-col"><a className="btn" href={result.applicationUrl} target="_blank" rel="noreferrer nofollow"
      onClick={()=>void fetch('/api/public/caregiver-jobs/'+encodeURIComponent(job.id)+'/apply',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({caregiverId:result.caregiverId}),keepalive:true}).catch(()=>{})}>Finish on {employer}’s site ↗</a></div>
    <Extras result={result} email={email} signedIn={signedIn}/>
  </div>;
  return <div className="qa-result">
    <div className="success-mark">✓</div>
    <div className="modal-kicker">{result.status==='already_applied'?'Already applied':'Application sent'}</div>
    <h2>{firstName?firstName+', you’re applied.':'You’re applied.'}</h2>
    <p>{employer} has your application for <strong>{job.title}</strong>. We emailed a receipt to {email}.</p>
    {result.bookingToken&&result.interview&&<InterviewStep token={result.bookingToken} interview={result.interview} employer={employer}/>}
    <Extras result={result} email={email} signedIn={signedIn}/>
  </div>;
}

function InterviewStep({token,interview,employer}:{token:string;interview:NonNullable<Result['interview']>;employer:string}){
  const [times,setTimes]=useState<Time[]>(interview.mode==='book'?interview.times:[]);
  const [picked,setPicked]=useState<string[]>([]);
  const [busy,setBusy]=useState(false);
  const [done,setDone]=useState('');
  const [error,setError]=useState('');
  async function send(body:Record<string,unknown>){
    setBusy(true);setError('');
    try{
      const res=await fetch('/api/apply-interview',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token,...body})});
      const b=await res.json() as {ok?:boolean;error?:string;label?:string;how?:string;times?:Time[]};
      if(!res.ok){if(b.times)setTimes(b.times);throw new Error(b.error||'Could not save that.')}
      setDone(b.label?'Booked: '+b.label+'. '+(b.how||'')+' A calendar invite is on its way to your email.':'Thanks. '+employer+' will call you at those times.');
    }catch(e){setError(e instanceof Error?e.message:'Could not save that.')}
    finally{setBusy(false)}
  }
  if(done)return <div className="qa-interview done"><strong>{done}</strong></div>;
  if(interview.mode==='book')return <div className="qa-interview">
    <h3>Book your interview now</h3>
    <p className="qa-sub">{interview.formatLabel}{interview.location?' · '+interview.location:''}. Pick a time that works.</p>
    <div className="qa-times">{times.map(t=><button type="button" key={t.at} className="qa-chip" disabled={busy} onClick={()=>void send({at:t.at})}>{t.label}</button>)}</div>
    {error&&<div className="notice">{error}</div>}
    <p className="qa-fine">None of these work? {employer} will contact you.</p>
  </div>;
  return <div className="qa-interview">
    <h3>When’s good for a quick call?</h3>
    <p className="qa-sub">{employer} will call you. Tell them when suits you.</p>
    <Chips label="Best times to call" multi options={CALL_TIME_OPTIONS} value={picked as typeof CALL_TIME_OPTIONS[number][0][]} onChange={setPicked}/>
    {error&&<div className="notice">{error}</div>}
    <button type="button" className="btn secondary qa-send-times" disabled={busy||!picked.length} onClick={()=>void send({callTimes:picked})}>{busy?'Saving…':'Send these times'}</button>
  </div>;
}

/** Optional once applied: a resume and a photo make the profile stronger for this and every other job. */
function Extras({result,email,signedIn}:{result:Result;email:string;signedIn:boolean}){
  const [resume,setResume]=useState<'idle'|'saving'|'saved'|'error'>('idle');
  async function upload(e:ChangeEvent<HTMLInputElement>){
    const file=e.target.files?.[0];
    if(!file||!result.resumeUploadToken)return;
    setResume('saving');
    const res=await fetch('/api/caregivers/'+encodeURIComponent(result.caregiverId)+'/resume-file',{method:'POST',
      headers:{'content-type':file.type||'application/octet-stream','x-file-name':encodeURIComponent(file.name),'x-carejoys-profile-token':result.resumeUploadToken},body:file}).catch(()=>null);
    setResume(res?.ok?'saved':'error');
  }
  return <div className="qa-extras">
    <h3>Make your profile stronger (optional)</h3>
    <div className="qa-extra-row">
      <span>Add a resume</span>
      {resume==='saved'?<strong>Saved ✓</strong>:<label className="btn secondary qa-file">{resume==='saving'?'Uploading…':'Upload resume'}<input type="file" accept=".pdf,.docx,.txt" onChange={e=>void upload(e)} disabled={resume==='saving'}/></label>}
    </div>
    {resume==='error'&&<div className="notice">That file didn’t upload. Try a PDF under 2 MB.</div>}
    {result.profilePhotoToken&&<div className="qa-extra-photo"><ProfilePhotoStep caregiverId={result.caregiverId} token={result.profilePhotoToken} bare/></div>}
    <p className="qa-fine">{signedIn?<>See your applications and job matches on <a href="/dashboard/applications">your dashboard</a>.</>:<>We sent a sign-in link to {email}. Open it any time to see your applications and job matches.</>}</p>
  </div>;
}
