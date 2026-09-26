import { useState, type FormEvent, type ChangeEvent } from 'react';
import { TurnstileField } from './TurnstileField';
import { parseResumeFile, type ParsedResume } from './resumeParser';
import './styles.css';

type ResumeForm={
  firstName:string;lastName:string;email:string;phone:string;zip:string;state:string;role:string;
  shifts:string;desiredWage:string;transportation:string;travelMiles:string;certifications:string;
  specialties:string;languages:string;yearsExperience:string;
};
type MatchResult={ok?:boolean;id?:string;matchedOrganizations?:number;matchedOpenings?:number;marylandMatching?:boolean;error?:string};

const empty:ResumeForm={
  firstName:'',lastName:'',email:'',phone:'',zip:'',state:'',role:'Caregiver',shifts:'',
  desiredWage:'',transportation:'',travelMiles:'25',certifications:'',specialties:'',languages:'',yearsExperience:''
};

export function CaregiverResumePage(){
  const [form,setForm]=useState<ResumeForm>(empty);
  const [parsed,setParsed]=useState<ParsedResume|null>(null);
  const [fileMeta,setFileMeta]=useState<{name:string;type:string;size:number}|null>(null);
  const [parsing,setParsing]=useState(false);
  const [status,setStatus]=useState<'idle'|'saving'|'success'|'error'>('idle');
  const [message,setMessage]=useState('');
  const [result,setResult]=useState<MatchResult|null>(null);
  const [turnstileToken,setTurnstileToken]=useState('');

  function patch<K extends keyof ResumeForm>(key:K,value:ResumeForm[K]){
    setForm(prev=>({...prev,[key]:value}));
  }

  async function onFile(e:ChangeEvent<HTMLInputElement>){
    const file=e.target.files?.[0];
    if(!file)return;
    setParsing(true);setMessage('');setStatus('idle');
    try{
      const found=await parseResumeFile(file);
      setParsed(found);
      setFileMeta({name:file.name,type:file.type||'application/octet-stream',size:file.size});
      setForm(prev=>({
        ...prev,
        firstName:found.firstName||prev.firstName,
        lastName:found.lastName||prev.lastName,
        email:found.email||prev.email,
        phone:found.phone||prev.phone,
        zip:found.zip||prev.zip,
        state:(found.zip&&Number(found.zip.slice(0,3))>=206&&Number(found.zip.slice(0,3))<=219)?'MD':prev.state,
        role:found.role||prev.role,
        certifications:found.certifications.join(', '),
        specialties:found.specialties.join(', '),
        languages:found.languages.join(', ')
      }));
      document.getElementById('resume-profile')?.scrollIntoView({behavior:'smooth',block:'start'});
    }catch(err){
      setStatus('error');setMessage(err instanceof Error?err.message:'Could not read that resume.');
    }finally{setParsing(false)}
  }

  async function onSubmit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();setStatus('saving');setMessage('');
    const payload={
      ...form,
      yearsExperience:Number(form.yearsExperience||0)||null,
      travelMiles:Number(form.travelMiles||0)||null,
      smsConsent:new FormData(e.currentTarget).get('smsConsent')==='on',
      turnstileToken,
      sourceFilename:fileMeta?.name||'',
      sourceMimeType:fileMeta?.type||'',
      sourceFileSize:fileMeta?.size||0
    };
    try{
      const res=await fetch('/api/caregiver-resume',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
      const body=await res.json() as MatchResult;
      if(!res.ok)throw new Error(body.error||'Could not create your caregiver profile.');
      setResult(body);setStatus('success');
      window.scrollTo({top:0,behavior:'smooth'});
    }catch(err){setStatus('error');setMessage(err instanceof Error?err.message:'Could not create your profile.')}
  }

  if(status==='success'&&result){
    return <div>
      <header className="nav"><div className="wrap nav-inner"><a className="brand" href="/">CareJoys</a><nav className="navlinks"><a href="/caregiver-jobs/maryland">Caregiver jobs</a><a href="/training-programs/maryland">Training programs</a></nav></div></header>
      <main className="resume-success-shell"><div className="wrap resume-success-card">
        <div className="success-mark">✓</div>
        <div className="modal-kicker">Your CareJoys profile is live</div>
        <h1>{result.marylandMatching?'You’re matched into the Maryland care network.':'Your caregiver profile is ready.'}</h1>
        {result.marylandMatching?<p>CareJoys found <strong>{result.matchedOrganizations||0} relevant care organizations</strong>{typeof result.matchedOpenings==='number'?<> and <strong>{result.matchedOpenings} current opening{result.matchedOpenings===1?'':'s'}</strong></>:null} based on your profile. We’ll use your current availability and preferences when employers are looking.</p>:<p>Your resume has been turned into a structured caregiver profile. Maryland employer matching is live today; CareJoys can use this profile as the network expands.</p>}
        <div className="hero-actions"><a className="btn" href="/caregiver-jobs/maryland">See caregiver jobs</a><a className="btn secondary" href="/">Done</a></div>
      </div></main>
    </div>;
  }

  return <div>
    <header className="nav"><div className="wrap nav-inner"><a className="brand" href="/">CareJoys</a><nav className="navlinks"><a href="/caregiver-jobs/maryland">Caregiver jobs</a><a href="/training-programs/maryland">Training programs</a><a href="/hire-caregivers/maryland">For employers</a></nav></div></header>
    <main>
      <section className="resume-hero"><div className="wrap resume-hero-grid">
        <div>
          <div className="modal-kicker">Caregiver resume</div>
          <h1>Add your resume, get matched to the best caregiver jobs near you.</h1>
          <p>Upload your resume or start from scratch below. CareJoys matches you with the best caregiver employers and agencies.</p>
          <div className="resume-points"><span>PDF, DOCX or TXT</span><span>Free to use</span><span>No raw resume file stored</span></div>
        </div>
        <div className="resume-upload-card">
          <div className="resume-upload-icon">↑</div>
          <h2>Upload your resume</h2>
          <p>We’ll pull out your contact info, caregiver role, certifications and relevant skills. You review everything before it is saved.</p>
          <label className="btn resume-file-button">{parsing?'Reading resume…':'Choose resume'}<input type="file" accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" onChange={onFile} disabled={parsing}/></label>
          <button className="text-button" onClick={()=>document.getElementById('resume-profile')?.scrollIntoView({behavior:'smooth'})}>Start from scratch instead</button>
          {status==='error'&&message&&<div className="notice">{message}</div>}
        </div>
      </div></section>

      <section className="section" id="resume-profile"><div className="wrap resume-profile-wrap">
        <div className="section-heading">
          <div><div className="modal-kicker">{parsed?'Resume parsed':'CareJoys profile'}</div><h2>{parsed?'Review what we found.':'Create your caregiver profile.'}</h2></div>
          {fileMeta&&<div className="resume-file-meta">{fileMeta.name}</div>}
        </div>
        {parsed&&(parsed.certifications.length>0||parsed.specialties.length>0)&&<div className="resume-detected">
          <strong>Detected from your resume</strong>
          <div className="job-tags">{[...parsed.certifications,...parsed.specialties].slice(0,12).map(x=><span className="pill" key={x}>{x}</span>)}</div>
        </div>}
        <form className="resume-profile-form" onSubmit={onSubmit}>
          <div className="form-grid"><label>First name<input value={form.firstName} onChange={e=>patch('firstName',e.target.value)} required /></label><label>Last name<input value={form.lastName} onChange={e=>patch('lastName',e.target.value)} required /></label></div>
          <div className="form-grid"><label>Email<input type="email" value={form.email} onChange={e=>patch('email',e.target.value)} required /></label><label>Mobile phone<input value={form.phone} onChange={e=>patch('phone',e.target.value)} required /></label></div>
          <div className="form-grid"><label>ZIP code<input value={form.zip} onChange={e=>patch('zip',e.target.value)} inputMode="numeric" pattern="[0-9]{5}" required /></label><label>State<input value={form.state} onChange={e=>patch('state',e.target.value.toUpperCase().slice(0,2))} placeholder="MD" maxLength={2} required /></label></div>
          <div className="form-grid"><label>Primary role<select value={form.role} onChange={e=>patch('role',e.target.value)} required><option>Caregiver</option><option>CNA</option><option>GNA</option><option>HHA</option><option>PCA</option><option>DSP</option><option>Other</option></select></label><label>Years of experience<input type="number" min="0" max="60" value={form.yearsExperience} onChange={e=>patch('yearsExperience',e.target.value)} placeholder="3" /></label></div>
          <label>Certifications<input value={form.certifications} onChange={e=>patch('certifications',e.target.value)} placeholder="CNA, CPR, First Aid" /></label>
          <label>Caregiving skills<input value={form.specialties} onChange={e=>patch('specialties',e.target.value)} placeholder="Dementia care, ADLs, Hoyer lift, companionship" /></label>
          <div className="form-grid"><label>Preferred shifts<input value={form.shifts} onChange={e=>patch('shifts',e.target.value)} placeholder="Days, nights, weekends" /></label><label>Desired hourly pay<input value={form.desiredWage} onChange={e=>patch('desiredWage',e.target.value)} placeholder="$20–24/hr" /></label></div>
          <div className="form-grid"><label>Transportation<select value={form.transportation} onChange={e=>patch('transportation',e.target.value)}><option value="">Select</option><option value="own_car">Own car</option><option value="reliable_transportation">Reliable transportation</option><option value="public_transit">Public transit</option><option value="other">Other</option></select></label><label>Travel radius<input type="number" min="1" max="100" value={form.travelMiles} onChange={e=>patch('travelMiles',e.target.value)} /> miles</label></div>
          <label>Languages<input value={form.languages} onChange={e=>patch('languages',e.target.value)} placeholder="English, Spanish" /></label>
          <label className="check-row"><input type="checkbox" name="smsConsent" /><span>I agree to receive CareJoys texts about job opportunities and availability. Message/data rates may apply. Reply STOP to opt out.</span></label>
          <TurnstileField onToken={setTurnstileToken}/>
          {status==='error'&&message&&<div className="notice">{message}</div>}
          <button className="btn submit-button" disabled={status==='saving'}>{status==='saving'?'Matching…':'Create profile & find matches'}</button>
          <div className="resume-privacy">By creating a profile, you understand it may be shown to participating care employers for recruiting. See our <a href="/privacy-policy">Privacy Policy</a> and <a href="/terms-of-service">Terms</a>.</div>
        </form>
      </div></section>

      <section className="section" id="caregiver-resume-example"><div className="wrap">
        <h2>Caregiver resume example</h2>
        <div className="resume-example">
          <div><strong>Professional summary</strong><p>Compassionate caregiver with experience supporting older adults with activities of daily living, mobility, meal preparation and companionship. Reliable, patient and comfortable working in private homes.</p></div>
          <div><strong>Skills to include when they are true for you</strong><div className="job-tags"><span className="pill">ADLs</span><span className="pill">Dementia care</span><span className="pill">Transfers</span><span className="pill">Hoyer lift</span><span className="pill">Meal preparation</span><span className="pill">Medication reminders</span><span className="pill">Companionship</span><span className="pill">CPR / First Aid</span></div></div>
        </div>
      </div></section>

      <section className="section"><div className="wrap">
        <h2>What should a caregiver resume include?</h2>
        <div className="jobs">
          <div className="job"><div><h3>Your actual caregiving experience</h3><div className="meta">List the people or settings you supported, the duties you performed and the dates you worked. Family caregiving can be relevant when described accurately.</div></div></div>
          <div className="job"><div><h3>Credentials and hands-on skills</h3><div className="meta">Include active certifications and skills you have actually used: CNA/CNA-I, HHA, CPR/BLS, ADLs, dementia care, transfers, vital signs, hospice, meal prep and similar experience.</div></div></div>
          <div className="job"><div><h3>Availability employers can use</h3><div className="meta">Your resume rarely says when you can work, how far you can travel or what shifts you want. CareJoys captures those separately so matching is more useful.</div></div></div>
        </div>
      </div></section>

      <section className="section"><div className="wrap">
        <h2>Caregiver resume with no experience?</h2>
        <p>Do not invent paid experience. Include relevant family caregiving, volunteer work, training, certifications, dependable transportation and transferable responsibilities that are genuinely yours. If you need formal CNA training, browse Maryland caregiver training programs.</p>
        <div className="hero-actions"><a className="btn secondary" href="/training-programs/maryland">Find Maryland training</a><a className="text-link" href="/resources/how-to-become-a-caregiver-in-maryland">How to become a caregiver →</a></div>
      </div></section>
    </main>
    <footer className="footer"><div className="wrap">CareJoys · <a href="/caregiver-jobs/maryland">Caregiver jobs</a> · <a href="/training-programs/maryland">Training programs</a> · <a href="/privacy-policy">Privacy</a> · <a href="/terms-of-service">Terms</a></div></footer>
  </div>;
}
