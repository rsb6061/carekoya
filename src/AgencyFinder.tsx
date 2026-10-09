import { useEffect, useState, type FormEvent, type KeyboardEvent } from 'react';
import { TurnstileField } from './TurnstileField';

// Self-serve agency claiming, used on the public employer pages and inside the workspace.
export type AgencyResult={id:string;name:string;city?:string;state?:string;zip?:string;providerTypes?:string;website?:string;domain?:string;claimed:boolean;emailOnFile:string|null;domainMatch?:boolean};
type ClaimResponse={ok?:boolean;claimed?:boolean;manual?:boolean;sentTo?:string;message?:string;error?:string;needsEmail?:boolean};

async function startClaim(body:Record<string,unknown>){
  const res=await fetch('/api/agency/claim/start',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  const data=await res.json() as ClaimResponse;
  if(!res.ok&&!data.needsEmail)throw new Error(data.error||'Could not start verification');
  return data;
}

function ClaimPanel({agency,onDone,onClose}:{agency:AgencyResult;onDone?:(r:ClaimResponse)=>void;onClose:()=>void}){
  const [email,setEmail]=useState('');
  const [turnstileToken,setTurnstileToken]=useState('');
  const [status,setStatus]=useState<'idle'|'sending'|'done'|'error'>('idle');
  const [message,setMessage]=useState('');
  const [needsEmail,setNeedsEmail]=useState(!agency.emailOnFile);

  async function submit(e:FormEvent){
    e.preventDefault();setStatus('sending');setMessage('');
    try{
      const result=await startClaim({organizationId:agency.id,email,turnstileToken});
      if(result.needsEmail){setNeedsEmail(true);setStatus('error');setMessage(result.error||'Enter your work email.');return;}
      setStatus('done');setMessage(result.message||'Check your email.');onDone?.(result);
    }catch(error){setStatus('error');setMessage(error instanceof Error?error.message:'Something went wrong')}
  }

  return <div className="modal-backdrop" onMouseDown={onClose}><div className="modal-panel" onMouseDown={e=>e.stopPropagation()}>
    <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
    <div className="modal-kicker">Claim your agency</div>
    <h2>{agency.name}</h2>
    <p className="modal-intro">{[agency.city,agency.state,agency.providerTypes].filter(Boolean).join(' · ')}</p>
    {status==='done'?<div className="modal-success"><div className="success-mark">✓</div><p>{message}</p><button className="btn" onClick={onClose}>Done</button></div>:
    <form className="intake-form" onSubmit={submit}>
      <p className="agency-claim-explainer">
        {agency.domain?<>If you have an email at <strong>{agency.domain}</strong>, enter it and we’ll send your sign-in link there. </>:null}
        {agency.emailOnFile?<>Otherwise we’ll send it to the email on the agency’s public record ({agency.emailOnFile}).</>:<>We have no email on file for this agency, so CareJoys will confirm you by hand.</>}
      </p>
      <label>Work email{needsEmail?'':' (optional)'}<input type="email" value={email} onChange={e=>setEmail(e.target.value)} required={needsEmail} placeholder={agency.domain?'you@'+agency.domain:'you@youragency.com'} /></label>
      <TurnstileField onToken={setTurnstileToken}/>
      {message&&<div className="notice">{message}</div>}
      <button className="btn submit-button" disabled={status==='sending'}>{status==='sending'?'Sending…':'Send my sign-in link'}</button>
    </form>}
  </div></div>;
}

function AgencyRow({agency,onClaim,busy}:{agency:AgencyResult;onClaim:(a:AgencyResult)=>void;busy?:boolean}){
  return <div className="agency-result">
    <div><strong>{agency.name}</strong><span>{[agency.city,agency.state,agency.providerTypes].filter(Boolean).join(' · ')}</span></div>
    {agency.claimed?<span className="agency-result-claimed">Already on CareJoys · <a className="text-link" href="/app">Sign in</a></span>:
      <button className="btn secondary" disabled={busy} onClick={()=>onClaim(agency)}>{agency.domainMatch?'Link to my workspace':'This is my agency'}</button>}
  </div>;
}

/** Public agency claim search: show matching agencies as the visitor types. */
export function AgencyFinder({stateCode}:{stateCode?:string}){
  const [q,setQ]=useState('');
  const [zip,setZip]=useState('');
  const [results,setResults]=useState<AgencyResult[]|null>(null);
  const [suggestions,setSuggestions]=useState<AgencyResult[]>([]);
  const [showSuggestions,setShowSuggestions]=useState(false);
  const [activeIndex,setActiveIndex]=useState(-1);
  const [claiming,setClaiming]=useState<AgencyResult|null>(null);
  const [loading,setLoading]=useState(false);
  const [suggestLoading,setSuggestLoading]=useState(false);
  const [suggestError,setSuggestError]=useState(false);
  const validQuery=q.trim().length>=2||/^\d{5}$/.test(zip.trim());

  useEffect(()=>{
    if(!validQuery){setSuggestions([]);setShowSuggestions(false);setSuggestLoading(false);setSuggestError(false);setActiveIndex(-1);return;}
    const controller=new AbortController();
    const timer=window.setTimeout(async()=>{
      setSuggestLoading(true);setSuggestError(false);
      const params=new URLSearchParams({q:q.trim(),zip:zip.trim()});
      if(stateCode)params.set('state',stateCode);
      try{
        const response=await fetch('/api/agency/search?'+params.toString(),{signal:controller.signal});
        if(!response.ok)throw new Error('Agency search unavailable');
        const data=await response.json() as {agencies?:AgencyResult[]};
        if(controller.signal.aborted)return;
        setSuggestions(data.agencies||[]);
        setActiveIndex(-1);
      }catch{
        if(!controller.signal.aborted){setSuggestions([]);setSuggestError(true);}
      }finally{if(!controller.signal.aborted)setSuggestLoading(false)}
    },250);
    return ()=>{window.clearTimeout(timer);controller.abort()};
  },[q,zip,stateCode,validQuery]);

  function chooseAgency(agency:AgencyResult){
    setQ(agency.name);
    setSuggestions([]);
    setShowSuggestions(false);
    setActiveIndex(-1);
    if(agency.claimed)setResults([agency]);
    else setClaiming(agency);
  }

  function onSearchKey(e:KeyboardEvent<HTMLInputElement>){
    if(!showSuggestions||!suggestions.length)return;
    if(e.key==='ArrowDown'){e.preventDefault();setActiveIndex(i=>(i+1)%suggestions.length);}
    else if(e.key==='ArrowUp'){e.preventDefault();setActiveIndex(i=>(i<=0?suggestions.length-1:i-1));}
    else if(e.key==='Escape'){e.preventDefault();setShowSuggestions(false);setActiveIndex(-1);}
    else if(e.key==='Enter'&&activeIndex>=0){e.preventDefault();chooseAgency(suggestions[activeIndex]);}
  }

  async function search(e:FormEvent){
    e.preventDefault();
    if(!validQuery)return;
    setShowSuggestions(false);setLoading(true);
    try{
      const params=new URLSearchParams({q:q.trim(),zip:zip.trim()});
      if(stateCode)params.set('state',stateCode);
      const response=await fetch('/api/agency/search?'+params.toString());
      if(!response.ok)throw new Error('Agency search unavailable');
      const data=await response.json() as {agencies?:AgencyResult[]};
      setResults(data.agencies||[]);
    }catch{setResults([])}finally{setLoading(false)}
  }

  return <div className="agency-finder settings-card">
    <div className="agency-finder-search-wrap"
      onBlurCapture={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node|null))setShowSuggestions(false)}}>
      <form className="agency-finder-form" onSubmit={search}>
        <input value={q} onChange={e=>{setQ(e.target.value);setResults(null);setShowSuggestions(true)}}
          onFocus={()=>{if(validQuery)setShowSuggestions(true)}} onKeyDown={onSearchKey}
          placeholder="Agency name" aria-label="Agency name" role="combobox" aria-autocomplete="list"
          aria-controls="agency-search-suggestions" aria-expanded={showSuggestions&&validQuery}
          aria-activedescendant={showSuggestions&&activeIndex>=0?'agency-suggestion-'+activeIndex:undefined}
          autoComplete="off"/>
        <input value={zip} onChange={e=>{setZip(e.target.value.replace(/\D/g,'').slice(0,5));setResults(null);setShowSuggestions(true)}}
          onFocus={()=>{if(validQuery)setShowSuggestions(true)}} placeholder="ZIP (optional)"
          inputMode="numeric" pattern="[0-9]*" maxLength={5} aria-label="Agency ZIP"/>
        <button className="btn" disabled={loading||!validQuery}>{loading?'Searching…':'Find my agency'}</button>
      </form>
      {showSuggestions&&validQuery&&<div className="agency-finder-dropdown" id="agency-search-suggestions" role="listbox" aria-label="Matching agencies">
        {suggestLoading?<div className="agency-finder-dropdown-status" role="status">Finding agencies…</div>
        :suggestError?<div className="agency-finder-dropdown-status">Search unavailable. Try Find my agency.</div>
        :suggestions.length?suggestions.map((agency,i)=><button key={agency.id} id={'agency-suggestion-'+i}
            type="button" role="option" aria-selected={i===activeIndex}
            className={'agency-finder-option'+(i===activeIndex?' active':'')}
            onMouseDown={e=>e.preventDefault()} onClick={()=>chooseAgency(agency)}>
            <strong>{agency.name}</strong>
            <span>{[agency.city,agency.state,agency.zip].filter(Boolean).join(' · ')}{agency.claimed?' · Already claimed':''}</span>
          </button>)
        :<div className="agency-finder-dropdown-status">No agencies match. Try another name or ZIP.</div>}
      </div>}
    </div>
    {results&&(results.length?<div className="agency-results">{results.map(a=><AgencyRow key={a.id} agency={a} onClaim={setClaiming}/>)}</div>
      :<p className="agency-finder-empty">No match yet. <a className="text-link" href="/hire-caregivers">Create a workspace</a> and CareJoys will link your agency once it’s in the directory.</p>)}
    {claiming&&<ClaimPanel agency={claiming} onClose={()=>setClaiming(null)}/>}
  </div>;
}

/** Workspace banner: "Is this your agency?" for a signed-in employer with no linked agency. */
export function AgencySuggestions({onLinked}:{onLinked:()=>void}){
  const [agencies,setAgencies]=useState<AgencyResult[]>([]);
  const [claiming,setClaiming]=useState<AgencyResult|null>(null);
  const [busy,setBusy]=useState('');
  const [message,setMessage]=useState('');
  const [showSearch,setShowSearch]=useState(false);

  useEffect(()=>{
    fetch('/api/agency/suggestions').then(r=>r.json()).then((d:any)=>setAgencies(Array.isArray(d?.agencies)?d.agencies:[])).catch(()=>{});
  },[]);

  async function claim(agency:AgencyResult){
    if(!agency.domainMatch){setClaiming(agency);return;}
    setBusy(agency.id);setMessage('');
    try{
      const result=await startClaim({organizationId:agency.id});
      setMessage(result.message||'');
      if(result.claimed)onLinked();
    }catch(error){setMessage(error instanceof Error?error.message:'Could not link the agency')}finally{setBusy('')}
  }

  return <section className="settings-card agency-suggestions">
    <div className="modal-kicker">Run a home-care agency?</div>
    <h3>{agencies.length?'Is this your agency?':'Link your agency'}</h3>
    <p>Linking your licensed agency turns on always-on caregiver matches, your Inbox, and control over the jobs CareJoys shows from your careers page.</p>
    {agencies.length>0&&<div className="agency-results">{agencies.map(a=><AgencyRow key={a.id} agency={a} onClaim={claim} busy={busy===a.id}/>)}</div>}
    {message&&<div className="notice">{message}</div>}
    {showSearch?<AgencyFinder/>:<button className="text-button" onClick={()=>setShowSearch(true)}>{agencies.length?'Not listed? Search for your agency':'Search for your agency'}</button>}
    {claiming&&<ClaimPanel agency={claiming} onClose={()=>setClaiming(null)}/>}
  </section>;
}

type AgencyJob={id:string;title:string;role?:string;city?:string;state?:string;payMin?:number|null;payMax?:number|null;payPeriod?:string;sourceUrl:string;published:boolean;hidden:boolean;lastSeenAt?:string;applyClicks:number};

/** The claimed agency's scraped jobs, with hide/show. Edits happen on the agency's own careers page. */
export function AgencyJobsPanel({onRecruit}:{onRecruit?:(openingId:string)=>void}={}){
  const [jobs,setJobs]=useState<AgencyJob[]|null>(null);
  const [busy,setBusy]=useState('');
  async function load(){
    try{const d=await (await fetch('/api/agency/jobs')).json() as {jobs?:AgencyJob[]};setJobs(d.jobs||[])}catch{setJobs([])}
  }
  useEffect(()=>{void load()},[]);
  async function toggle(job:AgencyJob){
    setBusy(job.id);
    try{
      await fetch('/api/agency/jobs/'+encodeURIComponent(job.id),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:job.hidden?'show':'hide'})});
      await load();
    }finally{setBusy('')}
  }
  async function recruit(job:AgencyJob){
    setBusy(job.id);
    try{
      const d=await (await fetch('/api/agency/jobs/'+encodeURIComponent(job.id),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'recruit'})})).json() as {openingId?:string};
      if(d.openingId)onRecruit?.(d.openingId);
    }finally{setBusy('')}
  }
  if(!jobs)return null;
  return <div className="agency-jobs">
    <div className="section-heading agency-match-head"><h2>Your published jobs</h2><p>CareJoys reads these from your careers page. To change one, update it there and CareJoys picks it up on the next scan; hide any you don’t want shown.</p></div>
    {jobs.length===0?<div className="empty"><strong>No jobs found on your careers page yet.</strong><div>CareJoys checks your site regularly.</div></div>:
    <div className="job-list">{jobs.map(job=><article className={'job-card '+(job.hidden?'job-card-muted':'')} key={job.id}>
      <div className="job-card-main"><h3>{job.hidden?job.title:<a href={'/jobs/'+encodeURIComponent(job.id)} target="_blank">{job.title}</a>}</h3>
        <div className="job-meta">{[job.role,[job.city,job.state].filter(Boolean).join(', '),job.applyClicks?job.applyClicks+' apply click'+(job.applyClicks===1?'':'s'):''].filter(Boolean).join(' · ')}</div>
        <div className="job-badges"><span className={job.hidden?'status':'status applied'}>{job.hidden?'Hidden on CareJoys':'Live on CareJoys'}</span><a className="text-link" href={job.sourceUrl} target="_blank" rel="noreferrer">Your listing ↗</a></div></div>
      <div className="job-card-actions">{onRecruit&&!job.hidden&&<button className="button" disabled={busy===job.id} onClick={()=>void recruit(job)}>Find caregivers for this job</button>}<button className="button secondary" disabled={busy===job.id} onClick={()=>toggle(job)}>{job.hidden?'Show again':'Hide'}</button></div>
    </article>)}</div>}
  </div>;
}
