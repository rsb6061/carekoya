import { useEffect, useMemo, useState, type FormEvent } from 'react';
import './workspace.css';
import { ArrowLeft, BriefcaseBusiness, Check, ChevronRight, CircleDot, Search, Sparkles, UsersRound } from 'lucide-react';

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
      <a href="/" className="back-link"><ArrowLeft size={16}/> Back to CareJoys</a>
      <div className="app-empty-card">
        <div className="eyebrow muted">Employer workspace</div>
        <h1>Start with a hiring request.</h1>
        <p>Create an employer workspace from the CareJoys homepage. Your recruiting workspace will open automatically.</p>
        <a className="button dark big" href="/">Find caregivers</a>
      </div>
    </div>
  }
  if(loading) return <div className="app-loading">Loading CareJoys…</div>;

  return <div className="workspace-shell">
    <aside className="workspace-sidebar">
      <a className="brand" href="/"><span>C</span>CareJoys</a>
      <div className="workspace-company"><small>WORKSPACE</small><strong>{workspace?.company_name||'Employer'}</strong></div>
      <nav>
        <button className={tab==='openings'?'active':''} onClick={()=>setTab('openings')}><BriefcaseBusiness size={18}/> Openings</button>
        <button className={tab==='talent'?'active':''} onClick={()=>setTab('talent')}><Search size={18}/> Talent network</button>
        <button className={tab==='pipeline'?'active':''} onClick={()=>setTab('pipeline')}><UsersRound size={18}/> Pipeline</button>
      </nav>
      <a className="workspace-back" href="/"><ArrowLeft size={15}/> Public site</a>
    </aside>

    <main className="workspace-main">
      <div className="workspace-topbar">
        <div><div className="eyebrow muted">Recruiting workspace</div><h1>{workspace?.company_name||'CareJoys'}</h1></div>
        <button className="button dark" onClick={()=>setShowOpening(true)}>+ New opening</button>
      </div>

      <div className="workspace-metrics">
        <div><span>Open roles</span><strong>{openings.filter(o=>o.status==='open').length}</strong></div>
        <div><span>Matched</span><strong>{counts.matched}</strong></div>
        <div><span>Qualified</span><strong>{counts.qualified}</strong></div>
        <div><span>Interviews</span><strong>{counts.interview}</strong></div>
        <div><span>Hired</span><strong>{counts.hired}</strong></div>
      </div>

      {message && <div className="workspace-notice"><Sparkles size={16}/>{message}</div>}

      {tab==='openings' && <section className="workspace-panel">
        <div className="panel-head"><div><h2>Openings</h2><p>Create a role, then let CareJoys score the network against it.</p></div></div>
        {openings.length===0 ? <div className="empty-list"><BriefcaseBusiness size={26}/><h3>No openings yet</h3><p>Add the first job you want CareJoys to recruit for.</p><button className="button primary" onClick={()=>setShowOpening(true)}>Create opening</button></div> :
        <div className="opening-list">{openings.map(o=><article key={o.id} className="opening-row">
          <div><small>{o.status?.toUpperCase()}</small><h3>{o.title}</h3><p>{[o.role,o.city,o.state,o.zip].filter(Boolean).join(' · ')}</p></div>
          <div className="opening-meta">{o.shift_preferences&&<span>{o.shift_preferences}</span>}{(o.pay_min||o.pay_max)&&<span>${o.pay_min||'—'}–${o.pay_max||'—'}/hr</span>}</div>
          <button className="button light" onClick={()=>runMatch(o.id)}>Find matches <ChevronRight size={16}/></button>
        </article>)}</div>}
      </section>}

      {tab==='talent' && <section className="workspace-panel">
        <div className="panel-head"><div><h2>Talent network</h2><p>Contact details stay private until a caregiver is activated into a recruiting flow.</p></div></div>
        <form className="talent-filters" onSubmit={searchTalent}>
          <input value={filters.role} onChange={e=>setFilters({...filters,role:e.target.value})} placeholder="Role: CNA, HHA, caregiver" />
          <input value={filters.zip} onChange={e=>setFilters({...filters,zip:e.target.value})} placeholder="ZIP" />
          <input value={filters.state} onChange={e=>setFilters({...filters,state:e.target.value})} placeholder="State" />
          <select value={filters.freshness} onChange={e=>setFilters({...filters,freshness:e.target.value})}><option value="all">Any availability</option><option value="confirmed">Confirmed in last 30 days</option></select>
          <button className="button dark">Search</button>
        </form>
        {candidates.length===0 ? <div className="empty-list"><Search size={26}/><h3>Search the network</h3><p>Legacy profiles will show as availability unconfirmed until they opt back in.</p></div> :
        <div className="talent-grid">{candidates.map(c=><article className="talent-card" key={c.id}>
          <div className="talent-card-top"><div className="avatar">{c.name.split(' ').map(x=>x[0]).join('').slice(0,2)}</div><div><h3>{c.name}</h3><p>{[c.role,c.city,c.state].filter(Boolean).join(' · ')}</p></div></div>
          <div className={c.workStatus==='actively_looking'?'freshness good':'freshness'}><CircleDot size={12}/>{c.freshness}</div>
          {c.certifications&&<p className="talent-detail"><b>Credentials</b>{c.certifications}</p>}
          {c.shifts&&<p className="talent-detail"><b>Shifts</b>{c.shifts}</p>}
          {c.desiredWage&&<p className="talent-detail"><b>Desired pay</b>{c.desiredWage}</p>}
        </article>)}</div>}
      </section>}

      {tab==='pipeline' && <section className="workspace-panel">
        <div className="panel-head"><div><h2>Candidate pipeline</h2><p>Move matched caregivers through qualification, interview, and hire.</p></div></div>
        {pipeline.length===0 ? <div className="empty-list"><UsersRound size={26}/><h3>No matched caregivers yet</h3><p>Run matching on an opening to populate this pipeline.</p></div> :
        <div className="pipeline-table">{pipeline.map(row=><article className="pipeline-row" key={row.id}>
          <div><strong>{row.name}</strong><span>{[row.role,row.city,row.state].filter(Boolean).join(' · ')}</span></div>
          <div className="score-pill">{row.match_score||0}% match</div>
          <div><span>{row.title}</span><small>{row.freshness}</small></div>
          <select value={row.stage} onChange={e=>moveStage(row.id,e.target.value)}>
            <option value="matched">Matched</option><option value="contacted">Contacted</option><option value="interested">Interested</option><option value="qualified">Qualified</option><option value="interview">Interview</option><option value="hired">Hired</option><option value="rejected">Rejected</option>
          </select>
        </article>)}</div>}
      </section>}

      {showOpening&&<div className="modal-backdrop" onMouseDown={()=>setShowOpening(false)}><div className="modal" onMouseDown={e=>e.stopPropagation()}>
        <button className="modal-close" onClick={()=>setShowOpening(false)}>×</button>
        <div className="eyebrow muted">New opening</div><h2>Who do you need?</h2>
        <form className="intake-form" onSubmit={createOpening}>
          <label>Job title<input name="title" required placeholder="CNA — day shift" /></label>
          <div className="form-grid"><label>Role<select name="role" required defaultValue=""><option value="" disabled>Select</option><option value="CNA">CNA</option><option value="GNA">GNA</option><option value="HHA">HHA</option><option value="PCA">PCA</option><option value="Caregiver">Caregiver</option></select></label><label>ZIP<input name="zip" /></label></div>
          <div className="form-grid"><label>City<input name="city" /></label><label>State<input name="state" /></label></div>
          <div className="form-grid"><label>Min pay / hr<input type="number" name="payMin" /></label><label>Max pay / hr<input type="number" name="payMax" /></label></div>
          <label>Shift<input name="shifts" placeholder="Days, nights, weekends" /></label>
          <label>Requirements<textarea name="requirements" rows={4} placeholder="Experience, credential, schedule, client requirements..." /></label>
          <label className="check-row"><input type="checkbox" name="transportationRequired" /><span>Reliable transportation required</span></label>
          <button className="button primary big submit-button">Create opening</button>
        </form>
      </div></div>}
    </main>
  </div>;
}