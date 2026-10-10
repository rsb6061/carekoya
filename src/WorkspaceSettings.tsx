import { useEffect, useState, type FormEvent } from 'react';

type Settings={digest:boolean;atsEmail:string;about:string;benefits:string};
type Team={me:string;owner:{email:string;name:string};members:{id:string;email:string;addedAt:string}[]};

async function api<T>(path:string,init?:RequestInit):Promise<T>{
  const res=await fetch(path,{credentials:'include',...init,headers:{'content-type':'application/json',...(init?.headers||{})}});
  const body=await res.json().catch(()=>({})) as T&{error?:string};
  if(!res.ok)throw new Error(body.error||'Something went wrong. Try again.');
  return body;
}

/**
 * Set up once: what caregivers read about the agency, who else on the team signs in, which emails arrive, where
 * candidates are forwarded, and the export.
 */
export function WorkspaceSettings({agency}:{agency:boolean}){
  const [settings,setSettings]=useState<Settings|null>(null);
  const [team,setTeam]=useState<Team|null>(null);
  const [notice,setNotice]=useState<{text:string;tone:'ok'|'error'}|null>(null);
  const [newMember,setNewMember]=useState('');
  const [busy,setBusy]=useState(false);

  useEffect(()=>{
    api<{settings:Settings}>('/api/workspace/settings').then(d=>setSettings(d.settings)).catch(e=>setNotice({text:e.message,tone:'error'}));
    api<Team>('/api/team').then(setTeam).catch(()=>{});
  },[]);

  async function save(patch:Partial<Settings>,done:string){
    setBusy(true);
    try{const d=await api<{settings:Settings}>('/api/workspace/settings',{method:'POST',body:JSON.stringify(patch)});setSettings(d.settings);setNotice({text:done,tone:'ok'})}
    catch(e){setNotice({text:(e as Error).message,tone:'error'})}
    finally{setBusy(false)}
  }
  async function saveProfile(e:FormEvent<HTMLFormElement>){
    e.preventDefault();
    const form=new FormData(e.currentTarget);
    await save({about:String(form.get('about')||''),benefits:String(form.get('benefits')||'')},'Saved. Caregivers see this on your invitations'+(agency?' and job pages.':'.'));
  }
  async function saveAts(e:FormEvent<HTMLFormElement>){
    e.preventDefault();
    const ats=String(new FormData(e.currentTarget).get('atsEmail')||'').trim();
    await save({atsEmail:ats},ats?'New candidates will be forwarded to '+ats+'.':'Forwarding is off.');
  }
  async function addMember(e:FormEvent<HTMLFormElement>){
    e.preventDefault();
    setBusy(true);
    try{
      await api('/api/team',{method:'POST',body:JSON.stringify({email:newMember})});
      setTeam(await api<Team>('/api/team'));
      setNotice({text:'Added. '+newMember+' gets an email to sign in.',tone:'ok'});
      setNewMember('');
    }catch(err){setNotice({text:(err as Error).message,tone:'error'})}
    finally{setBusy(false)}
  }
  async function removeMember(id:string,email:string){
    if(!window.confirm('Remove '+email+' from this workspace? They’ll be signed out.'))return;
    try{await api('/api/team/'+encodeURIComponent(id),{method:'DELETE'});setTeam(await api<Team>('/api/team'));setNotice({text:email+' was removed.',tone:'ok'})}
    catch(err){setNotice({text:(err as Error).message,tone:'error'})}
  }

  if(!settings)return <section className="section-block"><div className="section-heading"><h2>Settings</h2></div>{notice?<div className="alert-status alert-error">{notice.text}</div>:<p className="job-meta">Loading…</p>}</section>;
  return <section className="section-block workspace-settings">
    <div className="section-heading"><h2>Settings</h2></div>
    {notice&&<div className={'alert-status workspace-alert'+(notice.tone==='ok'?'':' alert-error')} role="status">{notice.tone==='ok'?'✓ ':''}{notice.text}</div>}

    <div className="settings-card">
      <h3>What caregivers see about you</h3>
      <p className="job-meta">Shown on your invitations{agency?' and your CareJoys job pages':''}. A sentence or two on what it’s like to work with you does more than a long description.</p>
      <form className="intake-form" onSubmit={saveProfile}>
        <label>About your {agency?'agency':'company'}<textarea name="about" rows={3} maxLength={1000} defaultValue={settings.about} placeholder="Family-owned since 2009. Clients in Towson and Parkville, steady weekly hours, a coordinator who answers the phone."/></label>
        <label>Benefits<textarea name="benefits" rows={2} maxLength={600} defaultValue={settings.benefits} placeholder="Weekly pay, mileage, paid training, health insurance after 60 days"/></label>
        <button className="button" disabled={busy}>Save</button>
      </form>
    </div>

    <div className="settings-card">
      <h3>Team</h3>
      <p className="job-meta">Teammates sign in with their own email and see the same openings and candidates. Emails about new caregivers go to everyone here.</p>
      {team&&<ul className="team-list">
        <li><span>{team.owner.email}{team.owner.email===team.me?' (you)':''}</span><span className="job-meta">Main contact</span></li>
        {team.members.map(m=><li key={m.id}><span>{m.email}{m.email===team.me?' (you)':''}</span><button type="button" className="text-button" onClick={()=>void removeMember(m.id,m.email)}>Remove</button></li>)}
      </ul>}
      <form className="inline-form" onSubmit={addMember}>
        <input type="email" required value={newMember} onChange={e=>setNewMember(e.target.value)} placeholder="recruiter@youragency.com" aria-label="Teammate email"/>
        <button className="button secondary" disabled={busy||!newMember}>Add teammate</button>
      </form>
    </div>

    <div className="settings-card">
      <h3>Email</h3>
      <label className="check-row"><input type="checkbox" checked={settings.digest} disabled={busy} onChange={e=>void save({digest:e.target.checked},e.target.checked?'You’ll get a morning email when caregivers are waiting on you.':'Morning email turned off.')}/>
        <span><strong>Morning digest.</strong> One email at about 7am Eastern on days when someone applied, someone is waiting on your reply, or you have interviews. You’ll still get an email the moment a caregiver says yes.</span></label>
      <p className="job-meta">On the 1st of each month you also get last month’s numbers: job views, applications, invitations, yeses and hires.</p>
    </div>

    <div className="settings-card">
      <h3>Get candidates into your own system</h3>
      <p className="job-meta">Most applicant tracking systems (WellSky, AxisCare, ClearCare, BambooHR and others) give you an email address that turns emails into applicants. Paste it here and CareJoys forwards each new applicant and each caregiver who says yes, with their contact details, once.</p>
      <form className="inline-form" onSubmit={saveAts}>
        <input type="email" name="atsEmail" defaultValue={settings.atsEmail} placeholder="applicants@youragency.applytojob.com" aria-label="ATS email"/>
        <button className="button secondary" disabled={busy}>{settings.atsEmail?'Update':'Turn on forwarding'}</button>
      </form>
      <p><a className="text-button" href="/api/workspace/candidates.csv" download>Download all candidates (CSV)</a></p>
    </div>
  </section>;
}
