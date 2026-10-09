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

// Caregivers who asked to be sent to this agency, shown inside Candidates. Stages are the agency's own; Email or Call marks a new one Contacted.
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

  const STATUS:Record<Stage,{label:string;tone:string}>={
    new:{label:'Sent you their profile · needs a reply',tone:''},contacted:{label:'You reached out',tone:''},
    interview:{label:'Interviewing',tone:'applied'},hired:{label:'Hired',tone:'applied'},not_fit:{label:'Not a fit',tone:'muted'}
  };
  if(status==='ready'&&items.length===0)return null;
  return <section className="candidate-group">
    <div className="candidate-group-head"><h3>Sent to you from your job pages</h3><p>These caregivers asked CareJoys to send you their profile. Reply quickly: they are looking now.</p></div>
    {items.length>0&&<div className="inbox-filters">
      <button className={'inbox-filter '+(filter==='all'?'active':'')} onClick={()=>setFilter('all')}>All <b>{items.length}</b></button>
      {STAGES.map(s=><button key={s} className={'inbox-filter '+(filter===s?'active':'')+(s==='new'&&counts.new?' needs-reply':'')} onClick={()=>setFilter(s)}>{LABELS[s]} <b>{counts[s]}</b></button>)}
    </div>}
    {message&&<div className="notice">{message}</div>}
    {status==='loading'?<div className="empty">Loading…</div>:
    visible.length===0?<div className="empty"><strong>Nothing in this stage.</strong></div>:
    <div className="match-list">{visible.map(item=>{
      const c=item.caregiver;
      const mail=`mailto:${c.email}?subject=${encodeURIComponent((item.job?.title||'Caregiver role')+' — CareJoys')}`;
      const reached=()=>{if(item.stage==='new')void save(item.id,{stage:'contacted'})};
      const st=STATUS[item.stage];
      return <article className="match-tile no-pick" key={item.id}>
        <div className="match-body">
          <div className="match-head">
            {c.photoUrl?<img className="candidate-avatar" src={c.photoUrl} alt="" />:<span className="candidate-avatar candidate-avatar-empty">{c.name.slice(0,1)||'?'}</span>}
            <div className="match-name">
              <h3>{c.name}</h3>
              <div className="job-meta">{[c.role,[c.city,c.state].filter(Boolean).join(', '),c.yearsExperience?c.yearsExperience+' yrs':'',item.job?'For '+item.job.title:'Any open role'].filter(Boolean).join(' · ')}</div>
            </div>
            <span className={'match-status '+st.tone}>{st.label}</span>
          </div>
          <div className="match-reasons">
            <span className="badge">{c.freshness.replace(/^Confirmed/,'Available, confirmed')}</span>
            {c.shifts&&<span className="badge">{c.shifts}</span>}
            {c.desiredWage&&<span className="badge">{c.desiredWage}</span>}
            {c.certifications&&<span className="badge">{c.certifications}</span>}
            <span className="badge">{item.source} · {received(item.createdAt)}</span>
          </div>
          {item.note&&<blockquote className="inbox-note">“{item.note}”</blockquote>}
          <textarea className="inbox-notes" rows={2} defaultValue={item.notes} placeholder="Private notes" aria-label={'Notes on '+c.name}
            onBlur={e=>{if(e.target.value!==item.notes)void save(item.id,{notes:e.target.value})}} />
        </div>
        <div className="match-actions">
          {c.email&&<a className="button" href={mail} onClick={reached}>Email</a>}
          {c.phone&&<a className="button secondary" href={'tel:'+c.phone.replace(/[^\d+]/g,'')} onClick={reached}>Call</a>}
          {(c.email||c.phone)&&<span className="match-contact">{[c.email,c.phone].filter(Boolean).join(' · ')}</span>}
          {['new','contacted'].includes(item.stage)&&<button className="button secondary" onClick={()=>void save(item.id,{stage:'interview'})}>Interviewing</button>}
          {item.stage==='interview'&&<button className="button secondary" onClick={()=>void save(item.id,{stage:'hired'})}>Mark hired</button>}
          {!['hired','not_fit'].includes(item.stage)&&<button className="text-button" onClick={()=>void save(item.id,{stage:'not_fit'})}>Not a fit</button>}
        </div>
      </article>;
    })}</div>}
  </section>;
}
