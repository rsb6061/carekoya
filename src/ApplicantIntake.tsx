import { useEffect, useState, type FormEvent } from 'react';
import { ReactivationCard } from './ReactivationCard';
import { APPLICANT_SOURCE_LABELS, APPLICANT_SOURCES, type ApplicantSource, type ApplicantStage, type ApplicantView } from './applicants';

type ImportRun={id:string;source:string;filename:string;total:number;added:number;duplicate:number;skipped:number;importedBy:string;createdAt:string};
type ImportResult={total:number;added:number;duplicate:number;skipped:number};

const STAGE_LABELS:Record<ApplicantStage,string>={new:'New',contacted:'Contacted',screened:'Screened',interview:'Interview',hired:'Hired',not_fit:'Not a fit'};
// Forwarded Indeed emails arrive on their own once that route exists; an upload is one of the others.
const UPLOAD_SOURCES=APPLICANT_SOURCES.filter(s=>s!=='indeed-forward');
const UPLOAD_HELP:Partial<Record<ApplicantSource,string>>={
  csv:'New applicants exported from Indeed, CareerPlug or another job board.',
  'dead-pile':'Past applicants who weren’t hired, to reach out to again for the agency.'
};
// +14105550101 → (410) 555-0101; anything else as stored.
const phoneText=(p:string)=>{const m=p.match(/^\+1(\d{3})(\d{3})(\d{4})$/);return m?`(${m[1]}) ${m[2]}-${m[3]}`:p};
const day=(iso:string)=>iso?new Date(iso.includes('T')?iso:iso.replace(' ','T')+'Z').toLocaleDateString(undefined,{month:'short',day:'numeric'}):'';

/** What came of the "still looking?" email, for under the stage. */
function replyText(a:ApplicantView){
  const r=a.reactivation;
  if(r.response==='yes')return 'Said yes, still looking'+(r.replyPhone?` · ${phoneText(r.replyPhone)}`:'')+(a.poolOptIn?' · wants other CareJoys jobs':'');
  if(r.response==='no')return 'Said not looking right now';
  if(r.status==='failed')return 'Email failed';
  return r.sentAt?`Emailed ${day(r.sentAt)}`:'';
}

function summary(r:ImportResult){
  const parts=[`Added ${r.added} applicant${r.added===1?'':'s'}.`];
  if(r.duplicate)parts.push(`${r.duplicate} ${r.duplicate===1?'was':'were'} already on the list.`);
  if(r.skipped)parts.push(`${r.skipped} row${r.skipped===1?'':'s'} skipped (no phone or email, or repeated in the file).`);
  return parts.join(' ');
}

/**
 * The agency's own applicants: upload a CSV, see who came from where, and move each one along.
 * `base` is /api/workspace/applicants for the agency, or /api/admin/applicants with `employerId` for a CareJoys operator.
 */
export function ApplicantIntake({base,employerId='',title='Applicants',reactivation}:{base:string;employerId?:string;title?:string;
  /** Admin only: where the "still looking?" email to past applicants is sent from. */
  reactivation?:{url:string;agencyName:string;testTo:string}}){
  const query=employerId?'?employer='+encodeURIComponent(employerId):'';
  const [applicants,setApplicants]=useState<ApplicantView[]|null>(null);
  const [imports,setImports]=useState<ImportRun[]>([]);
  const [notice,setNotice]=useState<{text:string;tone:'ok'|'error'}|null>(null);
  const [busy,setBusy]=useState(false);
  const [source,setSource]=useState<ApplicantSource>('csv');
  const [sourceFilter,setSourceFilter]=useState('');
  const [stageFilter,setStageFilter]=useState('');
  const [replyFilter,setReplyFilter]=useState('');
  // Bumped on every reload, so the email card recounts who's ready after an upload.
  const [version,setVersion]=useState(0);

  async function api<T>(path:string,init?:RequestInit):Promise<T>{
    const res=await fetch(base+path+query,{credentials:'include',...init,headers:{'content-type':'application/json',...(init?.headers||{})}});
    const body=await res.json().catch(()=>({})) as T&{error?:string};
    if(!res.ok)throw new Error(body.error||'Something went wrong. Try again.');
    return body;
  }
  async function load(){
    try{const d=await api<{applicants:ApplicantView[];imports:ImportRun[]}>('');setApplicants(d.applicants);setImports(d.imports);setVersion(v=>v+1)}
    catch(e){setNotice({text:(e as Error).message,tone:'error'})}
  }
  useEffect(()=>{setApplicants(null);void load()},[base,employerId]);

  async function upload(e:FormEvent<HTMLFormElement>){
    e.preventDefault();
    const form=e.currentTarget;
    const file=(form.elements.namedItem('file') as HTMLInputElement).files?.[0];
    if(!file){setNotice({text:'Choose a CSV file.',tone:'error'});return}
    setBusy(true);setNotice(null);
    try{
      const csv=await file.text();
      const sourceDetail=String(new FormData(form).get('sourceDetail')||'').trim();
      const r=await api<ImportResult>('',{method:'POST',body:JSON.stringify({csv,source,filename:file.name,sourceDetail})});
      setNotice({text:summary(r),tone:'ok'});form.reset();
      await load();
    }catch(err){setNotice({text:(err as Error).message,tone:'error'})}
    finally{setBusy(false)}
  }
  async function update(id:string,patch:{stage?:ApplicantStage;notes?:string}){
    try{
      const d=await api<{applicant:ApplicantView}>('/'+encodeURIComponent(id),{method:'POST',body:JSON.stringify(patch)});
      setApplicants(list=>(list||[]).map(a=>a.id===id?d.applicant:a));
    }catch(err){setNotice({text:(err as Error).message,tone:'error'})}
  }

  const list=applicants||[];
  const replyOf=(a:ApplicantView)=>a.reactivation.response||(a.reactivation.status==='sent'?'waiting':'');
  const shown=list.filter(a=>(!sourceFilter||a.source===sourceFilter)&&(!stageFilter||a.stage===stageFilter)&&(!replyFilter||replyOf(a)===replyFilter));
  const emailed=list.some(a=>a.reactivation.sentAt);
  const bySource=APPLICANT_SOURCES.map(s=>({s,n:list.filter(a=>a.source===s).length})).filter(x=>x.n);

  return <section className="section-block applicant-intake">
    <div className="section-heading"><h2>{title}</h2>
      <p>Applicants from the agency’s own job posts and past applicant lists. They stay the agency’s: they aren’t added to CareJoys caregiver matching.</p></div>
    {notice&&<div className={'alert-status workspace-alert'+(notice.tone==='ok'?'':' alert-error')} role="status">{notice.tone==='ok'?'✓ ':''}{notice.text}</div>}

    <div className="settings-card">
      <h3>Upload applicants</h3>
      <form className="intake-form" onSubmit={upload}>
        <label>Where they came from
          <select className="pipeline-select" value={source} onChange={e=>setSource(e.target.value as ApplicantSource)}>
            {UPLOAD_SOURCES.map(s=><option key={s} value={s}>{APPLICANT_SOURCE_LABELS[s]}</option>)}
          </select>
        </label>
        {UPLOAD_HELP[source]&&<p className="job-meta">{UPLOAD_HELP[source]}</p>}
        <label>CSV file<input type="file" name="file" accept=".csv,text/csv" required/></label>
        <label>Details (optional)<input name="sourceDetail" maxLength={200} placeholder="Indeed export, Sept 1–30"/></label>
        <p className="job-meta">Columns we read: name (or first and last name), phone, email, location or city/state/ZIP, job title, and date applied. Each row needs a phone or an email.</p>
        <button className="button" disabled={busy}>{busy?'Uploading…':'Upload'}</button>
      </form>
      {imports.length>0&&<p className="job-meta">Last upload: {imports[0].filename||'CSV'}, {APPLICANT_SOURCE_LABELS[imports[0].source as ApplicantSource]||imports[0].source}, {day(imports[0].createdAt)}. {imports[0].added} added of {imports[0].total} rows.</p>}
    </div>

    {reactivation&&<ReactivationCard url={reactivation.url} agencyName={reactivation.agencyName} defaultTestTo={reactivation.testTo} version={version} onSent={()=>void load()}/>}

    {applicants===null?<p className="job-meta">Loading…</p>:list.length===0?<div className="settings-card"><strong>No applicants yet.</strong><p className="job-meta">Upload a CSV to start the list.</p></div>:<>
      <div className="admin-subheading">
        <h3>{shown.length} of {list.length} applicant{list.length===1?'':'s'}</h3>
        <select className="pipeline-select" value={sourceFilter} onChange={e=>setSourceFilter(e.target.value)} aria-label="Filter by source">
          <option value="">All sources</option>
          {bySource.map(({s,n})=><option key={s} value={s}>{APPLICANT_SOURCE_LABELS[s]} ({n})</option>)}
        </select>
        <select className="pipeline-select" value={stageFilter} onChange={e=>setStageFilter(e.target.value)} aria-label="Filter by stage">
          <option value="">All stages</option>
          {(Object.keys(STAGE_LABELS) as ApplicantStage[]).map(s=><option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
        </select>
        {emailed&&<select className="pipeline-select" value={replyFilter} onChange={e=>setReplyFilter(e.target.value)} aria-label="Filter by reply">
          <option value="">All replies</option><option value="yes">Said yes</option><option value="no">Said no</option><option value="waiting">Emailed, no answer</option>
        </select>}
      </div>
      <div className="settings-card admin-table-scroll">
        <table className="admin-data-table">
          <thead><tr><th>Applicant</th><th>Contact</th><th>Job</th><th>Source</th><th>Applied</th><th>Stage</th><th>Notes</th></tr></thead>
          <tbody>{shown.map(a=><tr key={a.id}>
            <td><strong>{a.name}</strong><small>{[a.city,a.state,a.zip].filter(Boolean).join(', ')}</small></td>
            <td>{a.phone&&<a className="text-link" href={'tel:'+a.phone}>{phoneText(a.phone)}</a>}{a.email&&<small><a className="text-link" href={'mailto:'+a.email}>{a.email}</a></small>}</td>
            <td>{a.position||'—'}</td>
            <td>{APPLICANT_SOURCE_LABELS[a.source]||a.source}{a.sourceDetail&&<small>{a.sourceDetail}</small>}</td>
            <td>{day(a.appliedAt)||'—'}<small>Received {day(a.receivedAt)}</small></td>
            <td><select className="pipeline-select" value={a.stage} onChange={e=>void update(a.id,{stage:e.target.value as ApplicantStage})} aria-label={'Stage for '+a.name}>
              {(Object.keys(STAGE_LABELS) as ApplicantStage[]).map(s=><option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
            </select>{replyText(a)&&<small>{replyText(a)}</small>}</td>
            <td><input className="pipeline-select" defaultValue={a.notes} maxLength={2000} aria-label={'Notes for '+a.name} placeholder="Add a note"
              onBlur={e=>{if(e.target.value!==a.notes)void update(a.id,{notes:e.target.value})}}/></td>
          </tr>)}</tbody>
        </table>
      </div>
    </>}
  </section>;
}
