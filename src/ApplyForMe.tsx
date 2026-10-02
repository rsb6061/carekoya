import { useState, type ChangeEvent, type FormEvent } from 'react';

type Question={id:string;label:string;canonicalKey:string|null;kind:'text'|'number'|'date'|'email'|'tel'|'select'|'yesno'|'choice'|'agree';options:string[];required:boolean;eeoCategory?:string};
type Stage=
  |{kind:'idle'}
  |{kind:'running'}
  |{kind:'questions';sessionId:string;questions:Question[]}
  |{kind:'handoff';liveViewUrl:string;message:string;fallbackUrl:string}
  |{kind:'submitted'}
  |{kind:'error';message:string;fallbackUrl?:string};

/** Uploads the caregiver's resume file to their CareJoys account. */
export async function uploadMyResume(file:File,token:string){
  const res=await fetch('/api/me/resume',{method:'POST',headers:{'content-type':file.type||'application/octet-stream','x-file-name':encodeURIComponent(file.name),...(token?{authorization:'Bearer '+token}:{})},body:file});
  const body=await res.json().catch(()=>({})) as {error?:string};
  if(!res.ok)throw new Error(body.error||'Could not save your resume.');
}

export function ResumeFileInput({getToken,onSaved,label='Add your resume file'}:{getToken:()=>Promise<string>;onSaved:(name:string)=>void;label?:string}){
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  async function onFile(e:ChangeEvent<HTMLInputElement>){
    const file=e.target.files?.[0];
    if(!file)return;
    setBusy(true);setError('');
    try{await uploadMyResume(file,await getToken());onSaved(file.name)}
    catch(err){setError(err instanceof Error?err.message:'Could not save your resume.')}
    finally{setBusy(false);e.target.value=''}
  }
  return <div className="resume-file-input">
    <label className="btn secondary resume-file-button">{busy?'Saving…':label}<input type="file" accept=".pdf,.docx,.doc,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword,text/plain" onChange={onFile} disabled={busy}/></label>
    {error&&<div className="notice">{error}</div>}
  </div>;
}

/**
 * "Apply for me": CareJoys fills in the employer's own application with the caregiver's profile and resume,
 * asks here for anything it doesn't know, and hands over the employer's page for CAPTCHAs and signatures.
 */
export function ApplyForMe({jobId,employerName,hasResume,getToken,onActive,onSubmitted}:{
  jobId:string;employerName:string;hasResume:boolean;getToken:()=>Promise<string>;onActive:(active:boolean)=>void;onSubmitted:()=>void;
}){
  const [stage,setStageRaw]=useState<Stage>({kind:'idle'});
  const [resumeName,setResumeName]=useState(hasResume?'saved':'');
  const [answers,setAnswers]=useState<Record<string,string>>({});
  const [remember,setRemember]=useState<Record<string,boolean>>({});
  const setStage=(next:Stage)=>{setStageRaw(next);onActive(next.kind!=='idle');if(next.kind==='submitted')onSubmitted()};

  async function call(path:string,body:unknown){
    const token=await getToken();
    const res=await fetch(path,{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});
    const data=await res.json().catch(()=>({})) as any;
    if(data.status==='submitted'||data.status==='already_applied')return setStage({kind:'submitted'});
    if(data.status==='needs_answers'){setAnswers({});setRemember({});return setStage({kind:'questions',sessionId:data.sessionId,questions:data.questions||[]})}
    if(data.status==='handoff_required')return setStage({kind:'handoff',liveViewUrl:data.liveViewUrl,message:data.blockerMessage||'',fallbackUrl:data.fallbackUrl||''});
    if(data.resumeRequired){setResumeName('');return setStage({kind:'idle'})}
    setStage({kind:'error',message:data.error||'CareJoys could not finish this application by itself.',fallbackUrl:data.fallbackUrl});
  }
  async function start(){
    setStage({kind:'running'});
    try{await call('/api/me/apply-agent/'+encodeURIComponent(jobId),{})}
    catch{setStage({kind:'error',message:'Could not reach CareJoys. Try again.'})}
  }
  async function submitAnswers(e:FormEvent){
    e.preventDefault();
    if(stage.kind!=='questions')return;
    const sessionId=stage.sessionId;
    const list=stage.questions.filter(q=>answers[q.id]!==undefined&&answers[q.id]!=='').map(q=>({
      id:q.id,value:q.kind==='yesno'?answers[q.id]==='Yes':q.kind==='agree'?true:answers[q.id],remember:remember[q.id]!==false
    }));
    setStage({kind:'running'});
    try{await call('/api/me/apply-agent/continue',{sessionId,answers:list})}
    catch{setStage({kind:'error',message:'Could not reach CareJoys. Try again.'})}
  }

  if(stage.kind==='running')return <div className="apply-agent-status"><div className="apply-agent-spinner" aria-hidden="true"/>
    <strong>Filling in {employerName}’s application…</strong><span>This usually takes under a minute. Keep this page open.</span></div>;

  if(stage.kind==='questions')return <form className="apply-agent-questions intake-form" onSubmit={submitAnswers}>
    <div className="modal-kicker">A few questions from {employerName}</div>
    <p className="apply-with-profile-sub">CareJoys doesn’t know these yet. Your answers go only into this application{stage.questions.some(q=>q.canonicalKey)?', and you can let CareJoys remember them for next time':''}.</p>
    {stage.questions.map(q=>{
      const value=answers[q.id]||'';
      const set=(v:string)=>setAnswers(prev=>({...prev,[q.id]:v}));
      const label=q.label+(q.required?' *':'');
      let field;
      if(q.kind==='agree')field=<label className="check-row"><input type="checkbox" checked={value==='yes'} onChange={e=>set(e.target.checked?'yes':'')} required={q.required}/><span>{q.label}</span></label>;
      else if(q.kind==='yesno'||q.kind==='choice'||q.kind==='select')field=<label>{label}<select value={value} onChange={e=>set(e.target.value)} required={q.required}>
        <option value="">Choose…</option>{(q.kind==='yesno'?['Yes','No']:q.options).map(o=><option key={o} value={o}>{o}</option>)}</select></label>;
      else field=<label>{label}<input type={q.kind==='text'?'text':q.kind} value={value} onChange={e=>set(e.target.value)} required={q.required}/></label>;
      return <div key={q.id} className="apply-agent-question">{field}
        {q.canonicalKey&&!q.eeoCategory&&<label className="check-row apply-agent-remember"><input type="checkbox" checked={remember[q.id]!==false} onChange={e=>setRemember(prev=>({...prev,[q.id]:e.target.checked}))}/><span>Remember for next time</span></label>}
      </div>;
    })}
    <button className="btn submit-button">Continue application</button>
  </form>;

  if(stage.kind==='handoff')return <div className="apply-agent-status">
    <strong>Almost done. {employerName} needs you for one step.</strong>
    <span>{stage.message}</span>
    {stage.liveViewUrl&&<a className="btn" href={stage.liveViewUrl} target="_blank" rel="noreferrer">Open the application</a>}
    <span>Your answers are already filled in there. If that page has closed, {stage.fallbackUrl?<a className="text-link" href={stage.fallbackUrl} target="_blank" rel="noreferrer nofollow">apply on {employerName}’s site</a>:'apply on the employer’s site'}.</span>
  </div>;

  if(stage.kind==='submitted')return <div className="onboarding-success">
    <div className="success-mark">✓</div>
    <div className="modal-kicker">Application submitted</div>
    <h2>CareJoys applied for you.</h2>
    <p>Your application and resume are in with <strong>{employerName}</strong>. We emailed you a receipt, and it’s on your dashboard.</p>
    <div className="onboarding-final-action"><a className="btn" href="/me">See your applications</a></div>
  </div>;

  return <div className="apply-agent-start">
    {stage.kind==='error'&&<div className="notice">{stage.message}{stage.fallbackUrl&&<> <a className="text-link" href={stage.fallbackUrl} target="_blank" rel="noreferrer nofollow">Apply on {employerName}’s site</a></>}</div>}
    {!resumeName
      ?<><p className="apply-with-profile-sub">Add your resume file and CareJoys can fill in {employerName}’s application for you.</p>
        <ResumeFileInput getToken={getToken} onSaved={setResumeName}/></>
      :<button className="btn submit-button" onClick={()=>void start()}>Apply for me on {employerName}’s site</button>}
    <p className="apply-agent-note">CareJoys fills in {employerName}’s application with your profile and resume and asks you about anything it doesn’t know. It never answers background-check, demographic or signature questions for you.</p>
  </div>;
}
