import { useEffect, useMemo, useState, type FormEvent } from 'react';
import './workspace.css';

type Opening = {
  id: string; title: string; role: string; city?: string; state?: string; zip?: string;
  pay_min?: number; pay_max?: number; shift_preferences?: string; status?: string;
};
type Candidate = {
  id: string; name: string; city?: string; state?: string; zip?: string; role?: string;
  certifications?: string; specialties?: string; yearsExperience?: number; desiredWage?: string;
  shifts?: string; travelMiles?: number; freshness?: string; workStatus?: string;
};
type PipelineRow = {
  id: string; opening_id: string; title: string; opening_role: string; caregiver_id: string;
  name: string; city?: string; state?: string; role?: string; certifications?: string;
  match_score?: number; match_reason?: string; stage: string; freshness?: string;
};

async function api<T>(path:string, init?:RequestInit):Promise<T>{
  const res=await fetch(path,{...init,headers:{'content-type':'application/json',...(init?.headers||{})}});
  const body=await res.json() as T & {error?:string};
  if(!res.ok) throw new Error(body.error||'Request failed');
  return body;
}
function getWorkspaceId(){
  const params=new URLSearchParams(window.location.search);
  return params.get('workspace') || localStorage.getItem('carejoys_workspace') || '';
}
const cardTone=(index:number)=>['job-card-sky','job-card-mint','job-card-lilac','job-card-peach'][index%4];

export function EmployerWorkspace(){
  const [workspaceId]=useState(getWorkspaceId);
  const [workspace,setWorkspace]=useState<any>(null);
  const [openings,setOpenings]=useState<Opening[]>([]);
  const [pipeline,setPipeline]=useState<PipelineRow[]>([]);
  const [candidates,setCandidates]=useState<Candidate[]>([]);
  const [tab,setTab]=useState<'openings'|'talent'|'pipeline'>('openings');
  const [loading,setLoading]=useState(true);
  const [message,setMessage]=useState('');
  const [filters,setFilters]=useState({role:'',zip:'',state:'',freshness:'all'});
  const [showOpening,setShowOpening]=useState(false);

  async function refreshWorkspace(){
    if(!workspaceId){setLoading(false);return;}
    try{
      localStorage.setItem('carejoys_workspace',workspaceId);
      const data=await api<any>(`/api/workspace/${workspaceId}`);
      setWorkspace(data.workspace);
      setOpenings(data.openings||[]);
      const p=await api<any>(`/api/workspace/${workspaceId}/pipeline`);
      setPipeline(p.pipeline||[]);
    }catch(e){setMessage(e instanceof Error?e.message:'Could not load workspace');}
    finally{setLoading(false);}
  }
  useEffect(()=>{refreshWorkspace();},[]);

  async function searchTalent(e?:FormEvent){
    e?.preventDefault();
    const params=new URLSearchParams();
    Object.entries(filters).forEach(([k,v])=>{if(v&&v!=='all')params.set(k,v)});
    const data=await api<any>(`/api/candidates?${params}`);
    setCandidates(data.candidates||[]);
    setTab('talent');
  }
  async function createOpening(e:FormEvent<HTMLFormElement>){
    e.preventDefault();
    const fd=new FormData(e.currentTarget);
    const data=Object.fromEntries(fd.entries()) as any;
    data.transportationRequired=fd.get('transportationRequired')==='on';
    await api(`/api/workspace/${workspaceId}/openings`,{method:'POST',body:JSON.stringify(data)});
    setShowOpening(false);
    setMessage('Opening created.');
    await refreshWorkspace();
  }
  async function runMatch(openingId:string){
    setMessage('Matching caregivers…');
    const result=await api<any>(`/api/workspace/${workspaceId}/openings/${openingId}/match`,{method:'POST'});
    setMessage(`${result.matched||0} caregivers matched to this opening.`);
    await refreshWorkspace();
    setTab('pipeline');
  }
  async function moveStage(id:string,stage:string){
    await api(`/api/workspace/${workspaceId}/pipeline/${id}`,{method:'PATCH',body:JSON.stringify({stage})});
    const p=await api<any>(`/api/workspace/${workspaceId}/pipeline`);
    setPipeline(p.pipeline||[]);
  }

  const counts=useMemo(()=>{
    const by=(s:string)=>pipeline.filter(p=>p.stage===s).length;
    return {matched:pipeline.length,qualified:by('qualified'),interview:by('interview'),hired:by('hired')};
  },[pipeline]);

  if(!workspaceId){
    return <div className="app-empty">
      <div className="app-wrap">
        <a href="/" className="text-link">← Back to CareJoys</a>
        <div className="beta-hero app-empty-card">
          <h1>Start with a hiring request.</h1>
          <p>Create an employer workspace from the CareJoys homepage. Your recruiting workspace will open automatically.</p>
          <a className="button" href="/">Find caregivers</a>
        </div>
      </div>
    </div>;
  }
  if(loading) return <div className="loading-screen">Loading CareJoys…</div>;

  return <div>
    <header className="app-header">
      <div className="app-wrap header-inner">
        <a className="brand" href="/app?workspace=">CareJoys</a>
        <nav className="app-nav">
          <button className={'nav-button '+(tab==='openings'?'active':'')} onClick={()=>setTab('openings')}>Openings</button>
          <button className={'nav-button '+(tab==='talent'?'active':'')} onClick={()=>setTab('talent')}>Talent network</button>
          <button className={'nav-button '+(tab==='pipeline'?'active':'')} onClick={()=>setTab('pipeline')}>Pipeline</button>
          <a className="nav-link" href="/">Public site</a>
        </nav>
      </div>
    </header>

    <main className="app-wrap app-content">
      <section className="page-head page-head-row">
        <div>
          <h1>{workspace?.company_name||'Recruiting workspace'}</h1>
          <p>Find, match, and move caregivers into interviews.</p>
        </div>
        <div className="header-action"><button className="button" onClick={()=>setShowOpening(true)}>+ New opening</button></div>
      </section>

      <div className="result-summary workspace-summary">
        <strong>{openings.filter(o=>o.status==='open').length} open roles</strong>
        <span>{counts.matched} matched</span>
        <span>{counts.qualified} qualified</span>
        <span>{counts.interview} interviews</span>
        <span>{counts.hired} hired</span>
      </div>

      {message&&<div className="alert-status workspace-alert">✓ {message}</div>}

      {tab==='openings'&&<section className="section-block">
        <div className="section-heading"><h2>Openings</h2><p>Create a role, then let CareJoys score the network against it.</p></div>
        {openings.length===0?<div className="empty"><strong>No openings yet.</strong><div>Add the first job you want CareJoys to recruit for.</div><div className="empty-actions"><button className="button secondary" onClick={()=>setShowOpening(true)}>Create opening</button></div></div>:
        <div className="job-list">{openings.map((o,i)=><article key={o.id} className={'job-card '+cardTone(i)}>
          <div className="job-card-main">
            <div className="job-card-title-row"><h3>{o.title}</h3></div>
            <div className="job-meta">{[o.role,o.city,o.state,o.zip].filter(Boolean).join(' · ')}</div>
            <div className="job-badges">
              {o.shift_preferences&&<span className="badge">{o.shift_preferences}</span>}
              {(o.pay_min||o.pay_max)&&<span className="badge">${o.pay_min||'—'}–${o.pay_max||'—'}/hr</span>}
              <span className="status">{o.status||'open'}</span>
            </div>
            <div className="job-card-cue">Match against CareJoys <span>→</span></div>
          </div>
          <div className="job-card-side"><button className="job-card-action job-card-apply" onClick={()=>runMatch(o.id)}>Find matches</button></div>
        </article>)}</div>}
      </section>}

      {tab==='talent'&&<section className="section-block">
        <div className="section-heading"><h2>Talent network</h2><p>Search by role, location, and availability freshness.</p></div>
        <form className="talent-filters settings-card" onSubmit={searchTalent}>
          <input value={filters.role} onChange={e=>setFilters({...filters,role:e.target.value})} placeholder="Role: CNA, HHA, caregiver" />
          <input value={filters.zip} onChange={e=>setFilters({...filters,zip:e.target.value})} placeholder="ZIP" />
          <input value={filters.state} onChange={e=>setFilters({...filters,state:e.target.value})} placeholder="State" />
          <select value={filters.freshness} onChange={e=>setFilters({...filters,freshness:e.target.value})}><option value="all">Any availability</option><option value="confirmed">Confirmed in last 30 days</option></select>
          <button className="button">Search</button>
        </form>
        {candidates.length===0?<div className="empty"><strong>Search the network.</strong><div>Legacy profiles show as availability unconfirmed until they opt back in.</div></div>:
        <div className="job-list">{candidates.map((c,i)=><article className={'job-card '+cardTone(i)} key={c.id}>
          <div className="job-card-main">
            <div className="job-card-title-row"><h3>{c.name}</h3></div>
            <div className="job-meta">{[c.role,c.city,c.state].filter(Boolean).join(' · ')}</div>
            <div className="job-badges">
              <span className={c.workStatus==='actively_looking'?'status applied':'status'}>{c.freshness}</span>
              {c.shifts&&<span className="badge">{c.shifts}</span>}
              {c.desiredWage&&<span className="badge">{c.desiredWage}</span>}
            </div>
            {c.certifications&&<div className="job-card-cue">{c.certifications}</div>}
          </div>
        </article>)}</div>}
      </section>}

      {tab==='pipeline'&&<section className="section-block">
        <div className="section-heading"><h2>Candidate pipeline</h2><p>Move matched caregivers through qualification, interview, and hire.</p></div>
        {pipeline.length===0?<div className="empty"><strong>No matched caregivers yet.</strong><div>Run matching on an opening to populate this pipeline.</div></div>:
        <div className="job-list">{pipeline.map((row,i)=><article className={'job-card '+cardTone(i)} key={row.id}>
          <div className="job-card-main">
            <div className="job-card-title-row"><h3>{row.name}</h3></div>
            <div className="job-meta">{[row.role,row.city,row.state].filter(Boolean).join(' · ')}</div>
            <div className="job-badges"><span className="badge">{row.match_score||0}% match</span><span className="status">{row.title}</span><span className="status">{row.freshness}</span></div>
          </div>
          <div className="job-card-side">
            <select className="pipeline-select" value={row.stage} onChange={e=>moveStage(row.id,e.target.value)}>
              <option value="matched">Matched</option><option value="contacted">Contacted</option><option value="interested">Interested</option><option value="qualified">Qualified</option><option value="interview">Interview</option><option value="hired">Hired</option><option value="rejected">Rejected</option>
            </select>
          </div>
        </article>)}</div>}
      </section>}

      {showOpening&&<div className="modal-backdrop" onMouseDown={()=>setShowOpening(false)}><div className="modal-panel" onMouseDown={e=>e.stopPropagation()}>
        <button className="modal-close" onClick={()=>setShowOpening(false)}>×</button>
        <div className="modal-kicker">New opening</div><h2>Who do you need?</h2>
        <p className="modal-intro">Add the role, location, pay, and shift. CareJoys will use those details to rank the network.</p>
        <form className="intake-form" onSubmit={createOpening}>
          <label>Job title<input name="title" required placeholder="CNA — day shift" /></label>
          <div className="form-grid"><label>Role<select name="role" required defaultValue=""><option value="" disabled>Select</option><option value="CNA">CNA</option><option value="GNA">GNA</option><option value="HHA">HHA</option><option value="PCA">PCA</option><option value="Caregiver">Caregiver</option></select></label><label>ZIP<input name="zip" /></label></div>
          <div className="form-grid"><label>City<input name="city" /></label><label>State<input name="state" /></label></div>
          <div className="form-grid"><label>Min pay / hr<input type="number" name="payMin" /></label><label>Max pay / hr<input type="number" name="payMax" /></label></div>
          <label>Shift<input name="shifts" placeholder="Days, nights, weekends" /></label>
          <label>Requirements<textarea name="requirements" rows={4} placeholder="Experience, credential, schedule, client requirements..." /></label>
          <label className="check-row"><input type="checkbox" name="transportationRequired" /><span>Reliable transportation required</span></label>
          <button className="button submit-button">Create opening</button>
        </form>
      </div></div>}
    </main>

    <footer className="app-footer"><div className="app-wrap">CareJoys · Caregivers ready to work. Interviews ready for you.</div></footer>
  </div>;
}