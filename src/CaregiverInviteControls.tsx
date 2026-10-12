import { useEffect, useState } from 'react';

// The caregiver's say over who can find and invite them: pause invitations for two weeks, and hide their
// profile from named agencies (e.g. a current employer). Each change saves right away.

export type HiddenAgency={id:string;name:string};

async function post<T>(path:string,body:unknown):Promise<T>{
  const res=await fetch(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  const data=await res.json().catch(()=>({})) as T&{error?:string};
  if(!res.ok)throw new Error(data.error||'Something went wrong');
  return data;
}
const day=(iso:string)=>{try{return new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric'}).format(new Date(iso))}catch{return iso}};

export function CaregiverInviteControls({pausedUntil,hidden,onChange}:{pausedUntil?:string|null;hidden:HiddenAgency[];onChange:(notice:string)=>void}){
  const [until,setUntil]=useState(pausedUntil||null);
  const [list,setList]=useState(hidden);
  const [query,setQuery]=useState('');
  const [results,setResults]=useState<HiddenAgency[]|null>([]);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');

  useEffect(()=>{
    const q=query.trim();
    if(q.length<2){setResults([]);return}
    setResults(null);
    const t=setTimeout(()=>{fetch('/api/me/agency-search?q='+encodeURIComponent(q)).then(r=>r.json()).then((r:{agencies?:HiddenAgency[]})=>setResults(r.agencies||[])).catch(()=>setResults([]))},250);
    return ()=>clearTimeout(t);
  },[query]);

  async function run(work:()=>Promise<string>){
    setBusy(true);setError('');
    try{onChange(await work())}catch(e){setError(e instanceof Error?e.message:'Something went wrong')}
    finally{setBusy(false)}
  }
  const pause=(paused:boolean)=>run(async()=>{
    const r=await post<{invitesPausedUntil:string|null}>('/api/me/invite-pause',{paused});
    setUntil(r.invitesPausedUntil);
    return paused?'Invitations paused for 2 weeks.':'Invitations are back on.';
  });
  const hide=(agency:HiddenAgency,on:boolean)=>run(async()=>{
    const r=await post<{hiddenAgencies:HiddenAgency[]}>('/api/me/hidden-agencies',{employerId:agency.id,hidden:on});
    setList(r.hiddenAgencies);setQuery('');setResults([]);
    return on?`Hidden from ${agency.name}.`:`${agency.name} can see your profile again.`;
  });

  return <div className="settings-card invite-controls">
    <h3>Pause invitations</h3>
    {until
      ?<><p className="job-meta">Paused until {day(until)}. Agencies can’t find or invite you until then.</p><button type="button" className="button secondary" disabled={busy} onClick={()=>void pause(false)}>Resume invitations</button></>
      :<><p className="job-meta">Taking a break? Agencies won’t find or invite you for 2 weeks.</p><button type="button" className="button secondary" disabled={busy} onClick={()=>void pause(true)}>Pause invitations for 2 weeks</button></>}

    <h3>Hide my profile from specific agencies</h3>
    <p className="job-meta">For example, your current employer. They won’t see you in search or invite you. Agencies you apply to still see your application.</p>
    {list.length>0&&<ul className="hidden-agencies">{list.map(a=><li key={a.id}><span>{a.name}</span> <button type="button" className="text-button" disabled={busy} onClick={()=>void hide(a,false)}>Show again</button></li>)}</ul>}
    <label>Find an agency<input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Agency name" aria-label="Agency name"/></label>
    {(results||[]).filter(r=>!list.some(a=>a.id===r.id)).map(r=><div key={r.id} className="job-meta"><span>{r.name}</span> <button type="button" className="text-button" disabled={busy} onClick={()=>void hide(r,true)}>Hide from them</button></div>)}
    {query.trim().length>=2&&results?.length===0&&<p className="job-meta">No agency on CareJoys matches that name.</p>}
    {error&&<div className="notice">{error}</div>}
  </div>;
}
