import { useEffect, useState, type FormEvent } from 'react';
import { TurnstileField } from './TurnstileField';
import './workspace.css';

type Count={count:number};
type Overview={
  admin:{via:string;email:string};
  funnel:{
    window:string;
    employerFunnel:Array<{step:string;count:number}>;
    caregiverSignups:Array<{source:string}&Count>;
    reactivation:{legacyTotal:number;sent:number;opened:number;completed:number;activelyLooking:number};
    agencyClaims:{teasersSent:number;teasersOpened:number;claimsRequested:number;claimed:number};
    jobApplies:Array<{event_type:string}&Count>;
    traffic:{pageViews:number;topPaths:Array<{path:string}&Count>;topSources:Array<{source:string}&Count>};
  };
  outreach:{
    enabled:boolean;reactivationQueue:number;unsubscribes:number;
    today:Array<{kind:'reactivation'|'agency_teasers';cap:number;sentToday:number}>;
    recentRuns:Array<{kind:string;trigger:string;attempted:number;sent:number;failed:number;created_at:string}>;
  };
  employers:Array<{id:string;company_name:string;contact_name?:string;email:string;zip?:string;created_at:string;last_login_at?:string;openings:number;contacted:number;interviews:number;claimed_agency?:string;approval:string}>;
};

const STEP_LABELS:Record<string,string>={employers:'Employer signups',openings:'Openings',matched:'Matches',contacted:'Contacted',interested:'Interested',interviews:'Interviews booked',hired:'Hired'};
const KIND_LABELS:Record<string,string>={reactivation:'Caregiver reactivation',agency_teasers:'Agency teasers'};
const pct=(a:number,b:number)=>b>0?Math.round(a/b*100)+'%':'—';
const day=(iso?:string)=>iso?new Date(iso.replace(' ','T')+(iso.endsWith('Z')?'':'Z')).toLocaleDateString('en-US',{month:'short',day:'numeric'}):'—';

async function api<T>(path:string,init?:RequestInit):Promise<T>{
  const res=await fetch(path,{...init,headers:{'content-type':'application/json',...(init?.headers||{})}});
  const body=await res.json() as T&{error?:string};
  if(!res.ok)throw Object.assign(new Error(body.error||'Request failed'),{status:res.status});
  return body;
}

function AdminSignIn(){
  const [email,setEmail]=useState('');
  const [turnstileToken,setTurnstileToken]=useState('');
  const [message,setMessage]=useState('');
  async function submit(e:FormEvent){
    e.preventDefault();
    try{const body=await api<{message:string}>('/api/admin/auth/request',{method:'POST',body:JSON.stringify({email,turnstileToken})});setMessage(body.message)}
    catch(err){setMessage(err instanceof Error?err.message:'Could not send sign-in link')}
  }
  return <div className="app-empty"><div className="app-wrap"><div className="beta-hero app-empty-card">
    <div className="modal-kicker">CareJoys admin</div>
    <h1>Admin sign-in</h1>
    <p>We’ll email a one-time sign-in link to approved admin addresses.</p>
    <form className="auth-form" onSubmit={submit}>
      <input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@carejoys.com" required />
      <TurnstileField onToken={setTurnstileToken}/>
      {message&&<div className="alert-status">{message}</div>}
      <button className="button">Email me a sign-in link</button>
    </form>
  </div></div></div>;
}

function Stat({label,value,sub}:{label:string;value:number|string;sub?:string}){
  return <div className="settings-card"><div className="job-meta">{label}</div><div style={{fontSize:30,fontWeight:600}}>{value}</div>{sub&&<div className="job-meta">{sub}</div>}</div>;
}
const grid={display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(170px,100%),1fr))',gap:12} as const;

type AgencyOption={id:string;name:string;city?:string;state?:string;jobs:number;matches:number;claimed:boolean};

export function AdminConsole(){
  const [data,setData]=useState<Overview|null>(null);
  const [needsLogin,setNeedsLogin]=useState(false);
  const [windowKey,setWindowKey]=useState('30');
  const [notice,setNotice]=useState('');
  const [busy,setBusy]=useState(false);

  async function load(key=windowKey){
    try{setData(await api<Overview>('/api/admin/overview?window='+key))}
    catch(err){if((err as {status?:number}).status===401)setNeedsLogin(true);else setNotice(err instanceof Error?err.message:'Could not load')}
  }
  useEffect(()=>{void load(windowKey)},[windowKey]);

  async function run(kind:string){
    if(!window.confirm(`Send today's remaining ${KIND_LABELS[kind].toLowerCase()} emails now?`))return;
    setBusy(true);setNotice('');
    try{
      const body=await api<{result:{sent:number;failed:number;skipped?:string}}>('/api/admin/outreach/run',{method:'POST',body:JSON.stringify({kind})});
      setNotice(body.result.skipped?`Nothing sent: ${body.result.skipped.replace(/_/g,' ')}.`:`Sent ${body.result.sent}${body.result.failed?`, ${body.result.failed} failed`:''}.`);
      await load();
    }catch(err){setNotice(err instanceof Error?err.message:'Send failed')}
    finally{setBusy(false)}
  }

  async function approve(id:string,name:string){
    if(!window.confirm(`Approve ${name}? They'll be able to see caregiver profiles and get an email saying so.`))return;
    setBusy(true);setNotice('');
    try{await api('/api/admin/employers/'+encodeURIComponent(id)+'/approve',{method:'POST',body:'{}'});setNotice(name+' approved.');await load()}
    catch(err){setNotice(err instanceof Error?err.message:'Approve failed')}
    finally{setBusy(false)}
  }

  async function test(kind:string){
    setBusy(true);setNotice('');
    try{
      const body=await api<{result:{to:string}}>('/api/admin/outreach/test',{method:'POST',body:JSON.stringify({kind})});
      setNotice(`Test ${KIND_LABELS[kind].toLowerCase()} email sent to ${body.result.to}.`);
    }catch(err){setNotice(err instanceof Error?err.message:'Test send failed')}
    finally{setBusy(false)}
  }

  // Walkthrough source: a real agency to copy (its profile, jobs and matches), and the inbox the teaser goes to.
  const [agencyQuery,setAgencyQuery]=useState('');
  const [agencyOptions,setAgencyOptions]=useState<AgencyOption[]>([]);
  const [sourceAgency,setSourceAgency]=useState<AgencyOption|null>(null);
  const [testEmail,setTestEmail]=useState('');
  useEffect(()=>{
    if(needsLogin||!data)return;
    const t=window.setTimeout(()=>{
      api<{agencies:AgencyOption[]}>('/api/admin/agencies?q='+encodeURIComponent(agencyQuery)).then(b=>setAgencyOptions(b.agencies)).catch(()=>{});
    },250);
    return ()=>window.clearTimeout(t);
  },[agencyQuery,!!data,needsLogin]);

  async function agencyTest(reset=false){
    if(reset&&!window.confirm('Reset the test agency? This removes its claim, hiring profile and pipeline so you can start over.'))return;
    setBusy(true);setNotice('');
    try{
      const body=await api<{result?:{to?:string;email:string;candidateCount:number;agencyName?:string;jobCount?:number}}>('/api/admin/agency-test',{method:'POST',body:JSON.stringify({reset,sourceId:sourceAgency?.id||'',to:testEmail.trim()})});
      const r=body.result!;
      setNotice(reset?'Test agency reset.':`Live teaser for ${r.agencyName||'CareJoys Test Agency'} (${r.candidateCount} matched caregivers, ${r.jobCount||0} jobs) sent to ${r.email}.`);
    }catch(err){setNotice(err instanceof Error?err.message:'Test agency failed')}
    finally{setBusy(false)}
  }

  if(needsLogin)return <AdminSignIn/>;
  if(!data)return <div className="loading-screen">{notice||'Loading admin…'}</div>;
  const f=data.funnel;
  const steps=f.employerFunnel;

  return <div>
    <header className="app-header"><div className="app-wrap header-inner">
      <a className="brand" href="/admin">CareJoys admin</a>
      <nav className="app-nav">
        {['7','30','90','all'].map(k=><button key={k} className={'nav-button '+(windowKey===k?'active':'')} onClick={()=>setWindowKey(k)}>{k==='all'?'All time':`${k} days`}</button>)}
        <a className="nav-link" href="/api/admin/health" target="_blank">Raw health</a>
      </nav>
    </div></header>
    <main className="app-wrap app-content">
      {notice&&<div className="alert-status workspace-alert" role="status">{notice}</div>}

      <section className="section-block" style={{marginTop:0}}>
        <div className="section-heading"><h2>Employer funnel</h2><p>Signup to hire, {f.window==='all'?'all time':`last ${f.window} days`}. Percent is conversion from the previous step.</p></div>
        <div style={grid}>{steps.map((s,i)=><Stat key={s.step} label={STEP_LABELS[s.step]||s.step} value={s.count} sub={i>1?pct(s.count,steps[i-1].count):undefined}/>)}</div>
      </section>

      <section className="section-block">
        <div className="section-heading"><h2>Outreach</h2><p>{data.outreach.enabled?'Daily sends are on (15:41 UTC).':'Daily sends are off. Set OUTREACH_ENABLED to "true" in wrangler.jsonc to turn them on.'} {data.outreach.unsubscribes} unsubscribed.</p></div>
        <div style={grid}>{data.outreach.today.map(t=><div className="settings-card" key={t.kind}>
          <div className="job-meta">{KIND_LABELS[t.kind]}</div>
          <div style={{fontSize:30,fontWeight:600}}>{t.sentToday} / {t.cap}</div>
          <div className="job-meta">sent today{t.kind==='reactivation'?` · ${data.outreach.reactivationQueue} still to reach`:''}</div>
          <div className="empty-actions" style={{marginTop:10}}>
            <button className="button secondary" disabled={busy} onClick={()=>void test(t.kind)}>Send test to me</button>
            <button className="button secondary" disabled={busy||t.sentToday>=t.cap} onClick={()=>void run(t.kind)}>Send today’s remaining</button>
          </div>
        </div>)}
          <div className="settings-card">
            <div className="job-meta">Agency walkthrough</div>
            <div style={{fontWeight:600,margin:'6px 0'}}>{sourceAgency?sourceAgency.name+' (test copy)':'CareJoys Test Agency'}</div>
            <div className="job-meta">Pick a real agency below to copy its profile, current jobs and matched caregivers (or none for a generic Baltimore agency). The live teaser comes to you so you can claim it and onboard like that agency would. The real agency is never contacted or changed, and the copy never shows publicly.</div>
            <input style={{width:'100%',marginTop:10}} className="pipeline-select" value={agencyQuery} onChange={e=>setAgencyQuery(e.target.value)} placeholder="Search agencies (blank = most jobs)" />
            <div style={{display:'grid',gap:4,marginTop:6,maxHeight:220,overflow:'auto'}}>
              {agencyOptions.map(a=><button key={a.id} className={'nav-button '+(sourceAgency?.id===a.id?'active':'')} style={{textAlign:'left'}} onClick={()=>setSourceAgency(sourceAgency?.id===a.id?null:a)}>
                {a.name} · {[a.city,a.state].filter(Boolean).join(', ')} · {a.jobs} jobs · {a.matches} matches{a.claimed?' · claimed':''}
              </button>)}
            </div>
            <input style={{width:'100%',marginTop:8}} className="pipeline-select" type="email" value={testEmail} onChange={e=>setTestEmail(e.target.value)} placeholder="Send to (blank = your admin email), e.g. you+agency@gmail.com" />
            <div className="empty-actions" style={{marginTop:10}}>
              <button className="button secondary" disabled={busy} onClick={()=>void agencyTest()}>Send me a live agency teaser</button>
              <button className="button secondary" disabled={busy} onClick={()=>void agencyTest(true)}>Reset test agency</button>
            </div>
          </div>
        </div>
        <div style={{...grid,marginTop:12}}>
          <Stat label="Legacy caregivers" value={f.reactivation.legacyTotal}/>
          <Stat label="Reactivation sent" value={f.reactivation.sent}/>
          <Stat label="Opened" value={f.reactivation.opened} sub={pct(f.reactivation.opened,f.reactivation.sent)}/>
          <Stat label="Confirmed" value={f.reactivation.completed} sub={`${f.reactivation.activelyLooking} looking`}/>
          <Stat label="Agency teasers" value={f.agencyClaims.teasersSent}/>
          <Stat label="Teasers opened" value={f.agencyClaims.teasersOpened} sub={pct(f.agencyClaims.teasersOpened,f.agencyClaims.teasersSent)}/>
          <Stat label="Agencies claimed" value={f.agencyClaims.claimed} sub={`${f.agencyClaims.claimsRequested} requested`}/>
        </div>
        {data.outreach.recentRuns.length>0&&<div className="settings-card" style={{marginTop:12}}>{data.outreach.recentRuns.map(r=><div className="job-meta" key={r.created_at+r.kind}>{day(r.created_at)} · {KIND_LABELS[r.kind]||r.kind} · {r.trigger} · sent {r.sent}{r.failed?`, failed ${r.failed}`:''}</div>)}</div>}
      </section>

      <section className="section-block">
        <div className="section-heading"><h2>Caregiver supply</h2></div>
        <div style={grid}>
          {f.caregiverSignups.length===0?<Stat label="New caregivers" value={0}/>:f.caregiverSignups.map(s=><Stat key={s.source} label={s.source.replace(/_/g,' ')} value={s.count}/>)}
          {f.jobApplies.map(a=><Stat key={a.event_type} label={a.event_type.replace(/_/g,' ')} value={a.count}/>)}
        </div>
      </section>

      <section className="section-block">
        <div className="section-heading"><h2>Traffic</h2><p>{f.traffic.pageViews} page views. Cookie-less, path only.</p></div>
        <div style={{...grid,gridTemplateColumns:'repeat(auto-fit,minmax(min(320px,100%),1fr))'}}>
          <div className="settings-card"><div className="modal-kicker">Top pages</div>{f.traffic.topPaths.map(p=><div className="job-meta" key={p.path}>{p.count} · {p.path}</div>)}</div>
          <div className="settings-card"><div className="modal-kicker">Top sources</div>{f.traffic.topSources.map(s=><div className="job-meta" key={s.source}>{s.count} · {s.source}</div>)}</div>
        </div>
      </section>

      <section className="section-block">
        <div className="section-heading"><h2>Recent employers{data.employers.filter(e=>e.approval==='pending').length?` · ${data.employers.filter(e=>e.approval==='pending').length} waiting for approval`:''}</h2><p>Employers on personal email addresses (Gmail, Yahoo…) can't see caregiver profiles until you approve them. Company emails and claimed agencies get in automatically.</p></div>
        <div className="settings-card" style={{overflowX:'auto'}}>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:14}}>
            <thead><tr style={{textAlign:'left'}}>{['Company','Contact','Signed up','Last login','Openings','Contacted','Interviews','Agency','Access'].map(h=><th key={h} style={{padding:'6px 8px'}}>{h}</th>)}</tr></thead>
            <tbody>{data.employers.map(e=><tr key={e.id} style={{borderTop:'1px solid var(--line)'}}>
              <td style={{padding:'6px 8px'}}>{e.company_name}</td>
              <td style={{padding:'6px 8px'}}>{[e.contact_name,e.email].filter(Boolean).join(' · ')}</td>
              <td style={{padding:'6px 8px'}}>{day(e.created_at)}</td>
              <td style={{padding:'6px 8px'}}>{day(e.last_login_at)}</td>
              <td style={{padding:'6px 8px'}}>{e.openings}</td>
              <td style={{padding:'6px 8px'}}>{e.contacted}</td>
              <td style={{padding:'6px 8px'}}>{e.interviews}</td>
              <td style={{padding:'6px 8px'}}>{e.claimed_agency||''}</td>
              <td style={{padding:'6px 8px'}}>{e.approval==='pending'
                ?<button className="button secondary" disabled={busy} onClick={()=>void approve(e.id,e.company_name)}>Approve</button>
                :({manual:'Approved',agency:'Agency',business_email:'Company email',admin:'Admin'} as Record<string,string>)[e.approval]||e.approval}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </section>
    </main>
  </div>;
}
