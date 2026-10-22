import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useCaregiverAuth } from './caregiverAuth';
import { AGENCY_SMS_CONSENT_TEXT } from './smsConsent';

type Settings={digest:boolean;atsEmail:string;about:string;benefits:string;smsAlerts:boolean;smsAlertPhone:string};
type TalentAlert={id:string;label:string;query:string};

async function api<T>(path:string,init?:RequestInit):Promise<T>{
  const res=await fetch(path,{credentials:'include',...init,headers:{'content-type':'application/json',...(init?.headers||{})}});
  const body=await res.json().catch(()=>({})) as T&{error?:string};
  if(!res.ok)throw new Error(body.error||'Something went wrong. Try again.');
  return body;
}

/**
 * Set up once: what caregivers read about the agency, which emails arrive, where
 * candidates are forwarded, and the export.
 */
export function WorkspaceSettings({agency,applicants,widget,focus='',homeAlertQuery,onOpenTemplates}:{agency:boolean;
  /** The applicant forwarding, upload and screening cards, for an agency with its own job posts. */
  applicants?:ReactNode;
  /** The copy-paste jobs widget, for a claimed agency. */
  widget?:ReactNode;
  /** `applicants` or `widget` scrolls to those cards once the page has loaded. */
  focus?:string;homeAlertQuery:string;onOpenTemplates:()=>void}){
  const profilePath=useCaregiverAuth().employerProfilePath;
  const [settings,setSettings]=useState<Settings|null>(null);
  // Saved caregiver searches that email new matches; null while loading or when the workspace can't use them yet.
  const [alerts,setAlerts]=useState<TalentAlert[]|null>(null);
  const [notice,setNotice]=useState<{text:string;tone:'ok'|'error'}|null>(null);
  const [busy,setBusy]=useState(false);

  useEffect(()=>{
    api<{settings:Settings}>('/api/workspace/settings').then(d=>setSettings(d.settings)).catch(e=>setNotice({text:e.message,tone:'error'}));
    api<{alerts:TalentAlert[]}>('/api/talent-alerts').then(d=>setAlerts(d.alerts||[])).catch(()=>setAlerts(null));
  },[]);
  // The server stores the search's keys in its own order, so compare them sorted.
  const sorted=(q:string)=>{const p=new URLSearchParams(q);p.sort();return p.toString()};
  const homeAlert=alerts?.find(a=>sorted(a.query)===sorted(homeAlertQuery));
  async function toggleHomeAlert(on:boolean){
    setBusy(true);
    try{
      if(on)setAlerts((await api<{alerts:TalentAlert[]}>('/api/talent-alerts',{method:'POST',body:JSON.stringify({query:homeAlertQuery})})).alerts||[]);
      else if(homeAlert){await api('/api/talent-alerts/'+encodeURIComponent(homeAlert.id),{method:'DELETE'});setAlerts(list=>(list||[]).filter(a=>a.id!==homeAlert.id))}
      setNotice({text:on?'You’ll get an email when new caregivers join near you.':'New-caregiver emails turned off.',tone:'ok'});
    }catch(e){setNotice({text:(e as Error).message,tone:'error'})}
    finally{setBusy(false)}
  }
  async function removeAlert(id:string){
    try{await api('/api/talent-alerts/'+encodeURIComponent(id),{method:'DELETE'});setAlerts(list=>(list||[]).filter(a=>a.id!==id))}
    catch(e){setNotice({text:(e as Error).message,tone:'error'})}
  }
  const otherAlerts=(alerts||[]).filter(a=>a.id!==homeAlert?.id);
  useEffect(()=>{
    const id={applicants:'applicant-forwarding',widget:'jobs-widget'}[focus];
    if(!settings||!id)return;
    const t=setTimeout(()=>document.getElementById(id)?.scrollIntoView({behavior:'smooth',block:'start'}),50);
    return()=>clearTimeout(t);
  },[settings,focus]);

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
  async function saveTexts(e:FormEvent<HTMLFormElement>){
    e.preventDefault();
    const form=new FormData(e.currentTarget);
    const on=form.get('smsAlerts')==='on';
    await save({smsAlerts:on,smsAlertPhone:String(form.get('smsAlertPhone')||'').trim()},on?'We’ll text you when a caregiver says yes.':'Texts are off. You’ll still get the email.');
  }
  if(!settings)return <section className="section-block">{notice?<div className="alert-status alert-error">{notice.text}</div>:<p className="job-meta">Loading…</p>}</section>;
  return <section className="section-block workspace-settings">
    {notice&&<div className={'alert-status workspace-alert'+(notice.tone==='ok'?'':' alert-error')} role="status">{notice.tone==='ok'?'✓ ':''}{notice.text}</div>}

    <div className="settings-card">
      <h3>Your profile</h3>
      {profilePath&&<p><a className="text-link" href={profilePath} target="_blank" rel="noopener">View public profile ↗</a></p>}
      <form className="intake-form" onSubmit={saveProfile}>
        <label>About<textarea name="about" rows={3} maxLength={1000} defaultValue={settings.about} placeholder="Family-owned since 2009. Clients in Towson and Parkville, steady weekly hours, a coordinator who answers the phone."/></label>
        <label>Benefits<textarea name="benefits" rows={2} maxLength={600} defaultValue={settings.benefits} placeholder="Weekly pay, mileage, paid training, health insurance after 60 days"/></label>
        <button className="button" disabled={busy}>Save</button>
      </form>
    </div>

    {applicants}

    {widget&&<div className="settings-group-heading" id="jobs-widget"><h3>Your website</h3>
      <p className="job-meta">Show your CareJoys job listings on your own careers page. Caregivers who apply through it land in Candidates.</p></div>}
    {widget}

    <div className="settings-card">
      <h3>Email</h3>
      <label className="check-row"><input type="checkbox" checked={settings.digest} disabled={busy} onChange={e=>void save({digest:e.target.checked},e.target.checked?'You’ll get a morning email when caregivers are waiting on you.':'Morning email turned off.')}/>
        <span><strong>Morning digest</strong> when caregivers are waiting on you</span></label>
      {alerts&&homeAlertQuery&&<label className="check-row"><input type="checkbox" checked={!!homeAlert} disabled={busy} onChange={e=>void toggleHomeAlert(e.target.checked)}/>
        <span><strong>New caregivers near you</strong></span></label>}
      {otherAlerts.length>0&&<div className="talent-alerts"><span>Saved searches:</span>{otherAlerts.map(a=><span className="badge" key={a.id}>{a.label}<button type="button" className="badge-remove" aria-label={'Turn off alert '+a.label} onClick={()=>void removeAlert(a.id)}>×</button></span>)}</div>}
    </div>

    <div className="settings-card">
      <h3>Text alerts</h3>
      <form className="intake-form" onSubmit={saveTexts} key={String(settings.smsAlerts)+settings.smsAlertPhone}>
        <label className="check-row"><input type="checkbox" name="smsAlerts" defaultChecked={settings.smsAlerts}/><span><strong>Text me when a caregiver says yes.</strong> {AGENCY_SMS_CONSENT_TEXT}</span></label>
        <label>Your mobile number<input type="tel" name="smsAlertPhone" autoComplete="tel" defaultValue={settings.smsAlertPhone} placeholder="410-555-0123"/></label>
        <button className="button secondary" disabled={busy}>Save</button>
      </form>
    </div>

    <div className="settings-card">
      <h3>Email templates</h3>
      <button type="button" className="button secondary" onClick={onOpenTemplates}>Edit email templates</button>
    </div>

    <div className="settings-card">
      <h3>Send candidates to your ATS</h3>
      <form className="inline-form" onSubmit={saveAts}>
        <input type="email" name="atsEmail" defaultValue={settings.atsEmail} placeholder="Your ATS intake email" aria-label="ATS email"/>
        <button className="button secondary" disabled={busy}>{settings.atsEmail?'Update':'Turn on forwarding'}</button>
      </form>
      <p><a className="text-button" href="/api/workspace/candidates.csv" download>Download all candidates (CSV)</a></p>
    </div>
  </section>;
}
