import { useEffect, useMemo, useState } from 'react';

type Stage='new'|'contacted'|'interview'|'hired'|'not_fit';
type InboxItem={
  id:string;stage:Stage;createdAt:string;viewed:boolean;source:string;note:string|null;notes:string;
  job:{id:string;title:string;url:string}|null;
  caregiver:{
    name:string;email:string;phone:string;city:string;state:string;zip:string;role:string;certifications:string;
    yearsExperience:number|null;shifts:string;desiredWage:string;transportation:string;freshness:string;photoUrl:string|null;
  };
};
const STAGES:Stage[]=['new','contacted','interview','hired','not_fit'];
const LABELS:Record<Stage,string>={new:'Needs reply',contacted:'Contacted',interview:'Interview',hired:'Hired',not_fit:'Not a fit'};
const cardTone=(index:number)=>['job-card-sky','job-card-mint','job-card-lilac','job-card-peach'][index%4];

async function api<T>(path:string,init?:RequestInit):Promise<T>{
  const res=await fetch(path,{...init,headers:{'content-type':'application/json',...(init?.headers||{})}});
  const body=await res.json() as T & {error?:string};
  if(!res.ok)throw new Error(body.error||'Request failed');
  return body;
}
function received(value:string){
  const d=new Date(value.includes('T')?value:value.replace(' ','T')+'Z');
  return Number.isFinite(d.getTime())?d.toLocaleDateString(undefined,{month:'short',day:'numeric'}):'';
}

// Caregivers who asked to be sent to this agency. Stages are the agency's own; Email marks a new one Contacted.
export function AgencyInbox({onCount}:{onCount?:(waiting:number)=>void}){
  const [items,setItems]=useState<InboxItem[]>([]);
  const [filter,setFilter]=useState<Stage|'all'>('all');
  const [status,setStatus]=useState<'loading'|'ready'|'error'>('loading');
  const [message,setMessage]=useState('');

  useEffect(()=>{
    api<{items:InboxItem[]}>('/api/agency/inbox')
      .then(data=>{setItems(data.items||[]);setStatus('ready')})
      .catch(error=>{setMessage(error instanceof Error?error.message:'Could not load your Inbox.');setStatus('error')});
  },[]);
  const counts=useMemo(()=>Object.fromEntries(STAGES.map(s=>[s,items.filter(i=>i.stage===s).length])) as Record<Stage,number>,[items]);
  useEffect(()=>{onCount?.(counts.new||0)},[counts.new]);
  const visible=filter==='all'?items:items.filter(i=>i.stage===filter);

  async function save(id:string,patch:{stage?:Stage;notes?:string}){
    const before=items;
    setItems(items.map(i=>i.id===id?{...i,...patch}:i));
    try{await api('/api/agency/inbox/'+encodeURIComponent(id),{method:'POST',body:JSON.stringify(patch)})}
    catch(error){setItems(before);setMessage(error instanceof Error?error.message:'Could not save that change.')}
  }

  return <section className="section-block">
    <div className="section-heading"><h2>Inbox</h2><p>Caregivers who asked CareJoys to send you their profile. Reply quickly: they are looking now.</p></div>
    <div className="inbox-filters">
      <button className={'inbox-filter '+(filter==='all'?'active':'')} onClick={()=>setFilter('all')}>All <b>{items.length}</b></button>
      {STAGES.map(s=><button key={s} className={'inbox-filter '+(filter===s?'active':'')+(s==='new'&&counts.new?' needs-reply':'')} onClick={()=>setFilter(s)}>{LABELS[s]} <b>{counts[s]}</b></button>)}
    </div>
    {message&&<div className="notice">{message}</div>}
    {status==='loading'?<div className="empty">Loading your Inbox…</div>:
    visible.length===0?<div className="empty"><strong>{items.length?'Nothing in this stage.':'No caregivers yet.'}</strong><div>When a caregiver sends you their profile from a CareJoys job page or through an AI assistant, they land here.</div></div>:
    <div className="job-list">{visible.map((item,i)=>{
      const c=item.caregiver;
      const mail=`mailto:${c.email}?subject=${encodeURIComponent((item.job?.title||'Caregiver role')+' — CareJoys')}`;
      return <article className={'job-card inbox-card '+cardTone(i)} key={item.id}>
        <div className="job-card-main">
          <div className="candidate-name-row">
            {c.photoUrl?<img className="candidate-avatar" src={c.photoUrl} alt="" />:<span className="candidate-avatar candidate-avatar-empty">{c.name.slice(0,1)||'?'}</span>}
            <h3>{c.name}</h3>
            {!item.viewed&&<span className="status applied">New</span>}
          </div>
          <div className="job-meta">{[c.role,[c.city,c.state].filter(Boolean).join(', '),c.yearsExperience?c.yearsExperience+' yrs':''].filter(Boolean).join(' · ')}</div>
          <div className="job-badges">
            <span className="status">{item.job?<a className="text-link" href={item.job.url} target="_blank" rel="noreferrer">{item.job.title}</a>:'Any open role'}</span>
            <span className="status">{c.freshness}</span>
            {c.shifts&&<span className="badge">{c.shifts}</span>}
            {c.desiredWage&&<span className="badge">{c.desiredWage}</span>}
          </div>
          {c.certifications&&<div className="job-card-cue">{c.certifications}</div>}
          {item.note&&<blockquote className="inbox-note">“{item.note}”</blockquote>}
          <div className="inbox-contact">
            {c.email&&<span>{c.email}</span>}{c.phone&&<span>{c.phone}</span>}
            <span className="inbox-source">{item.source} · {received(item.createdAt)}</span>
          </div>
          <textarea className="inbox-notes" rows={2} defaultValue={item.notes} placeholder="Private notes" aria-label={'Notes on '+c.name}
            onBlur={e=>{if(e.target.value!==item.notes)void save(item.id,{notes:e.target.value})}} />
        </div>
        <div className="job-card-side opening-actions">
          {c.email&&<a className="job-card-action" href={mail} onClick={()=>{if(item.stage==='new')void save(item.id,{stage:'contacted'})}}>Email</a>}
          {c.phone&&<a className="button secondary" href={'tel:'+c.phone.replace(/[^\d+]/g,'')} onClick={()=>{if(item.stage==='new')void save(item.id,{stage:'contacted'})}}>Call</a>}
          <select className="pipeline-select" aria-label="Stage" value={item.stage} onChange={e=>void save(item.id,{stage:e.target.value as Stage})}>
            {STAGES.map(s=><option key={s} value={s}>{LABELS[s]}</option>)}
          </select>
        </div>
      </article>;
    })}</div>}
  </section>;
}
