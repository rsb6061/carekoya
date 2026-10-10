import { useEffect, useRef, useState, type ReactNode } from 'react';
import { IntroVideo, TalentDetails, type TalentCandidate } from './TalentCard';
import { certificationsLabel, profileTags, withoutRole, type ProfileTag } from './profileTags';
import { CHECKLIST } from './checklist';
import { fitSummary } from './fitSummary';
import { sourceOf, statusOf, type DecideStage, type MatchRow } from './MatchList';
import { templateMailto, type EmailTemplate, type TemplateValues } from './emailTemplateFill';
import { NURSE_AIDE_REGISTRIES } from './nurseAideRegistries';

export type CandidateActions={
  onInvite:(rows:MatchRow[])=>Promise<void>;
  onDecide:(row:MatchRow,stage:DecideStage)=>Promise<void>;
  onNotes:(row:MatchRow,notes:string)=>Promise<void>;
  onRestore:(row:MatchRow)=>Promise<void>;
  /** An applicant was emailed or called: they no longer need a reply. */
  onReach?:(row:MatchRow)=>void;
  /** The employer's own nurse-aide registry checks, by caregiver id. */
  licenseChecks?:Record<string,LicenseCheck>;
  onLicenseCheck?:(row:MatchRow,result:LicenseCheck['result']|'')=>Promise<void>;
};
export type LicenseCheck={result:'active'|'not_found';checkedBy:string;checkedAt:string};
type DetailProps={row:MatchRow;actions:CandidateActions;templates:EmailTemplate[];sender:Omit<TemplateValues,'firstName'|'opening'>;disabled?:boolean};

const CERTIFIED=/\b(CNA|GNA|CMT|HHA|CNA-?II|nurse aide|nursing assistant|medication tech)/i;

/**
 * The nurse-aide registry check every agency does by hand: a link to the caregiver's state registry and a place to
 * record what it said. State registries have no public API, so the employer looks it up and CareJoys keeps the result.
 */
function LicenseCheckSection({row:r,check,onCheck,disabled}:{row:MatchRow;check?:LicenseCheck;onCheck:(result:LicenseCheck['result']|'')=>Promise<void>;disabled?:boolean}){
  const p=r.profile;
  const certified=!!p?.licensed||CERTIFIED.test([p?.certifications,r.role].filter(Boolean).join(' '));
  if(!certified)return null;
  const state=(p?.licenseState||r.state||'').toUpperCase();
  const registry=NURSE_AIDE_REGISTRIES.find(x=>x.code===state);
  const when=check?new Date(check.checkedAt.includes('T')?check.checkedAt:check.checkedAt.replace(' ','T')+'Z').toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}):'';
  return <section className="candidate-license">
    <h3>License</h3>
    {check?<p><span className={'badge'+(check.result==='active'?' good':' warn')}>{check.result==='active'?'Active on the '+state+' registry':'Not found on the '+state+' registry'}</span> <span className="job-meta">Checked {when}{check.checkedBy?' by '+check.checkedBy:''}</span></p>
      :<p className="job-meta">{firstName(r.name)||'They'} list{firstName(r.name)?'s':''} {p?.certifications||r.role}. Look them up on the {registry?.agency||'state nurse-aide registry'}, then record what you found.</p>}
    <div className="license-check">
      {registry?.lookupUrl&&<a className="button secondary" href={registry.lookupUrl} target="_blank" rel="noreferrer">Look up on the {state} registry ↗</a>}
      {check?<button type="button" className="text-button" disabled={disabled} onClick={()=>void onCheck('')}>Clear</button>
        :<><button type="button" className="button secondary" disabled={disabled} onClick={()=>void onCheck('active')}>Active</button>
          <button type="button" className="text-button" disabled={disabled} onClick={()=>void onCheck('not_found')}>Not found</button></>}
    </div>
  </section>;
}

export const canRestore=(r:MatchRow)=>r.stage==='rejected'&&r.rejected_reason==='employer_not_a_fit';
const firstName=(name:string)=>(name||'').trim().split(/\s+/)[0]||'';

/**
 * Everything about one matched caregiver for one opening: why they fit, where they stand, how to reach them, and the
 * full profile. The side panel and the full-profile page both render this.
 */
export function CandidateDetail({row:r,actions,templates,sender,disabled}:DetailProps){
  const status=statusOf(r);
  const p=r.profile;
  const [templateId,setTemplateId]=useState(templates[0]?.id||'');
  const [busy,setBusy]=useState(false);
  const template=templates.find(t=>t.id===templateId)||templates[0];
  const values:TemplateValues={...sender,firstName:firstName(r.name),opening:r.title};
  const summary=fitSummary({name:r.name,reasons:r.match_reasons||[],profile:p||undefined});
  const run=async(fn:()=>Promise<void>)=>{setBusy(true);try{await fn()}finally{setBusy(false)}};
  const off=disabled||busy;

  const decideButtons=<>
    {r.stage==='matched'&&<button className="button" disabled={off} onClick={()=>void run(()=>actions.onInvite([r]))}>Invite</button>}
    {!['hired','rejected'].includes(r.stage)&&<button className="text-button" disabled={off} onClick={()=>void run(()=>actions.onDecide(r,'rejected'))}>Not a fit</button>}
    {canRestore(r)&&<button className="button secondary" disabled={off} onClick={()=>void run(()=>actions.onRestore(r))}>Restore</button>}
  </>;

  return <div className="candidate-detail">
    <ProfileHead name={r.name} photo={r.profilePhotoUrl} role={r.role} meta={[r.role,[r.city,r.state].filter(Boolean).join(', '),sourceOf(r)].filter(Boolean).join(' · ')}
      status={r.stage==='matched'?undefined:status} actions={decideButtons}
      tags={profileTags({matchScore:r.match_score,reasons:r.match_reasons,freshness:p?.freshness||r.profile?.freshness,employmentTypes:p?.employmentTypes,shifts:p?.shifts,desiredWage:p?.desiredWage})}
      certifications={p?.certifications}/>

    {r.caregiver_note&&<blockquote className="inbox-note">“{r.caregiver_note}”</blockquote>}

    {summary?<section className="candidate-fit">
      <h3>Why they fit</h3>
      <p>{summary}</p>
    </section>:null}

    {(r.contact_email||r.contact_phone||r.resume_url||['interested','interview'].includes(r.stage)||r.contact_locked||r.stage!=='rejected')&&<section className="candidate-reach">
      <div className="candidate-actions">
        {r.contact_email&&template&&<>
          <select aria-label="Email template" value={template.id} onChange={e=>setTemplateId(e.target.value)}>{templates.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select>
          <a className="button" href={templateMailto(r.contact_email,template,values)} onClick={()=>actions.onReach?.(r)}>Email</a>
        </>}
        {r.contact_phone&&<a className="button secondary" href={'tel:'+r.contact_phone.replace(/[^\d+]/g,'')} onClick={()=>actions.onReach?.(r)}>Call</a>}
        {r.stage==='interested'&&<button className="button secondary" disabled={off} onClick={()=>void run(()=>actions.onDecide(r,'interview'))}>Interviewing</button>}
        {['interested','interview'].includes(r.stage)&&<button className="button secondary" disabled={off} onClick={()=>void run(()=>actions.onDecide(r,'hired'))}>Mark hired</button>}
      </div>
      {(r.contact_email||r.contact_phone)&&<p className="match-contact">{[r.contact_email,r.contact_phone].filter(Boolean).join(' · ')}</p>}
      {r.contact_locked?<p className="job-meta">You’ve used your free introductions. Upgrade to see {firstName(r.name)}’s email, phone and resume.</p>
        :!r.contact_email&&r.stage!=='rejected'&&<p className="job-meta">Email, phone{p?.hasResume?' and resume':''} are shared once {firstName(r.name)||'they'} says they’re interested.</p>}
    </section>}

    {actions.onLicenseCheck&&<LicenseCheckSection row={r} check={actions.licenseChecks?.[r.caregiver_id]} onCheck={result=>run(()=>actions.onLicenseCheck!(r,result))} disabled={off}/>}

    {p&&<ProfileBody candidate={p} resumeUrl={r.resume_url}/>}

    <section>
      <h3>Private notes</h3>
      <textarea className="inbox-notes" rows={3} key={r.id} defaultValue={r.employer_notes||''} placeholder="Only your team sees these" aria-label={'Notes on '+r.name}
        onBlur={e=>{if(e.target.value!==(r.employer_notes||''))void actions.onNotes(r,e.target.value)}}/>
    </section>
  </div>;
}

/** The candidate in a right-side panel over the list, so the recruiter keeps their place. */
export function CandidatePanel({onClose,...props}:DetailProps&{onClose:()=>void}){
  return <Drawer label={props.row.name} pageUrl={'/app?candidate='+encodeURIComponent(props.row.id)} onClose={onClose}><CandidateDetail {...props}/></Drawer>;
}

/** The same candidate as its own page at /app?candidate=…, with a link a teammate can open. */
export function CandidatePage({onBack,...props}:DetailProps&{onBack:()=>void}){
  return <section className="section-block candidate-page">
    <button type="button" className="text-button" onClick={onBack}>← Back to candidates</button>
    <CandidateDetail {...props}/>
  </section>;
}

/** Avatar, name, location line and status, with the main actions top right, then the shared tags. */
export function ProfileHead({name,photo,meta,role,status,actions,tags,certifications}:{name:string;photo?:string;meta:string;role?:string;status?:{label:string;tone:string};actions?:ReactNode;tags:ProfileTag[];certifications?:string}){
  const certs=certificationsLabel(withoutRole(certifications,role));
  return <div className="candidate-detail-top">
    <div className="candidate-detail-head">
      {photo?<img className="candidate-avatar large" src={photo} alt=""/>:<span className="candidate-avatar candidate-avatar-empty large">{name?.slice(0,1)||'?'}</span>}
      <div className="candidate-detail-name">
        <h2>{name}</h2>
        <div className="job-meta">{meta}</div>
        {status&&<span className={'match-status '+status.tone}>{status.label}</span>}
      </div>
      {actions&&<div className="candidate-head-actions">{actions}</div>}
    </div>
    {tags.length>0&&<div className="match-reasons">{tags.map(t=><span className={'badge'+(t.tone?' '+t.tone:'')} key={t.label}>{t.label}</span>)}</div>}
    {certs&&<div className="job-card-cue">{certs}</div>}
  </div>;
}

/** Intro video, the checklist items the caregiver confirmed, and the full profile. Shared by every profile view. */
export function ProfileBody({candidate:p,resumeUrl}:{candidate:TalentCandidate;resumeUrl?:string|null}){
  const confirmed=CHECKLIST.filter(([k])=>p.checklist?.includes(k));
  return <>
    {p.introVideoUrl&&<section><h3>Intro video</h3><IntroVideo url={p.introVideoUrl}/></section>}
    {confirmed.length>0&&<section>
      <h3>What employers check first</h3>
      <ul className="candidate-checklist">{confirmed.map(([k,label])=><li key={k} className="yes"><span aria-hidden="true">✓</span>{label}</li>)}</ul>
    </section>}
    <section><h3>Profile</h3><TalentDetails candidate={p} hideChecklist resumeUrl={resumeUrl}/></section>
  </>;
}

/** The right-side panel over a list, so the recruiter keeps their place; the full profile opens in a new tab. */
export function Drawer({label,pageUrl,onClose,children}:{label:string;pageUrl:string;onClose:()=>void;children:ReactNode}){
  const closeRef=useRef<HTMLButtonElement>(null);
  useEffect(()=>{
    closeRef.current?.focus();
    const onKey=(e:KeyboardEvent)=>{if(e.key==='Escape')onClose()};
    window.addEventListener('keydown',onKey);
    const overflow=document.body.style.overflow;document.body.style.overflow='hidden';
    return ()=>{window.removeEventListener('keydown',onKey);document.body.style.overflow=overflow};
  },[label]);
  return <div className="candidate-drawer-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}>
    <aside className="candidate-drawer" role="dialog" aria-modal="true" aria-label={label}>
      <div className="candidate-drawer-bar">
        <a className="text-button" href={pageUrl} target="_blank" rel="noopener">Open in new tab ↗</a>
        <button type="button" className="icon-button" ref={closeRef} onClick={onClose} aria-label="Close">×</button>
      </div>
      {children}
    </aside>
  </div>;
}
