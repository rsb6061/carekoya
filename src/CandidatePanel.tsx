import { useEffect, useRef, useState } from 'react';
import { IntroVideo, TalentDetails } from './TalentCard';
import { CHECKLIST } from './checklist';
import { fitSummary } from './fitSummary';
import { statusOf, type MatchRow } from './MatchList';
import { templateMailto, type EmailTemplate, type TemplateValues } from './emailTemplateFill';

export type CandidateActions={
  onInvite:(rows:MatchRow[])=>Promise<void>;
  onDecide:(row:MatchRow,stage:'hired'|'rejected')=>Promise<void>;
  onNotes:(row:MatchRow,notes:string)=>Promise<void>;
  onFavorite:(row:MatchRow,on:boolean)=>Promise<void>;
  onRestore:(row:MatchRow)=>Promise<void>;
};
type DetailProps={row:MatchRow;actions:CandidateActions;templates:EmailTemplate[];sender:Omit<TemplateValues,'firstName'|'opening'>;disabled?:boolean};

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
  const summary=fitSummary({name:r.name,reasons:r.match_reasons||[],profile:p});
  const run=async(fn:()=>Promise<void>)=>{setBusy(true);try{await fn()}finally{setBusy(false)}};
  const off=disabled||busy;

  return <div className="candidate-detail">
    <div className="candidate-detail-head">
      {r.profilePhotoUrl?<img className="candidate-avatar large" src={r.profilePhotoUrl} alt=""/>:<span className="candidate-avatar candidate-avatar-empty large">{r.name?.slice(0,1)||'?'}</span>}
      <div className="candidate-detail-name">
        <h2>{r.name}</h2>
        <div className="job-meta">{[r.role,[r.city,r.state].filter(Boolean).join(', '),'For '+r.title].filter(Boolean).join(' · ')}</div>
        <span className={'match-status '+status.tone}>{status.label}</span>
      </div>
      <button type="button" className={'save-button'+(r.favorite?' on':'')} aria-pressed={!!r.favorite} disabled={off} onClick={()=>void run(()=>actions.onFavorite(r,!r.favorite))}>{r.favorite?'Saved':'Save'}</button>
    </div>

    {(summary||r.match_reasons?.length)?<section className="candidate-fit">
      <h3>Why they fit</h3>
      {summary&&<p>{summary}</p>}
      <div className="match-reasons">
        {r.match_score?<span className="badge strong">{r.match_score}% match</span>:null}
        {(r.match_reasons||[]).filter(x=>!/confirmed|availability/.test(x)).map(x=><span className="badge" key={x}>{x}</span>)}
      </div>
    </section>:null}

    <section className="candidate-reach">
      <div className="candidate-actions">
        {r.stage==='matched'&&<button className="button" disabled={off} onClick={()=>void run(()=>actions.onInvite([r]))}>Invite</button>}
        {r.contact_email&&template&&<>
          <select aria-label="Email template" value={template.id} onChange={e=>setTemplateId(e.target.value)}>{templates.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select>
          <a className="button" href={templateMailto(r.contact_email,template,values)}>Email</a>
        </>}
        {r.contact_phone&&<a className="button secondary" href={'tel:'+r.contact_phone.replace(/[^\d+]/g,'')}>Call</a>}
        {r.resume_url&&<a className="button secondary" href={r.resume_url}>Download resume</a>}
        {['interested','interview'].includes(r.stage)&&<button className="button secondary" disabled={off} onClick={()=>void run(()=>actions.onDecide(r,'hired'))}>Mark hired</button>}
        {!['hired','rejected'].includes(r.stage)&&<button className="text-button" disabled={off} onClick={()=>void run(()=>actions.onDecide(r,'rejected'))}>Not a fit</button>}
        {canRestore(r)&&<button className="button secondary" disabled={off} onClick={()=>void run(()=>actions.onRestore(r))}>Restore</button>}
      </div>
      {(r.contact_email||r.contact_phone)&&<p className="match-contact">{[r.contact_email,r.contact_phone].filter(Boolean).join(' · ')}</p>}
      {r.contact_locked?<p className="job-meta">You’ve used your free introductions. Upgrade to see {firstName(r.name)}’s email, phone and resume.</p>
        :!r.contact_email&&r.stage!=='rejected'&&<p className="job-meta">Email, phone{p?.hasResume?' and resume':''} are shared once {firstName(r.name)||'they'} says they’re interested.</p>}
    </section>

    {p?.introVideoUrl&&<section><h3>Intro video</h3><IntroVideo url={p.introVideoUrl}/></section>}

    <section>
      <h3>What employers check first</h3>
      <ul className="candidate-checklist">{CHECKLIST.map(([k,label])=>{const yes=!!p?.checklist?.includes(k);return <li key={k} className={yes?'yes':''}><span aria-hidden="true">{yes?'✓':'–'}</span>{label}{yes?'':<em> · not answered</em>}</li>})}</ul>
    </section>

    {p&&<section><h3>Profile</h3><TalentDetails candidate={p} hideChecklist/></section>}

    <section>
      <h3>Private notes</h3>
      <textarea className="inbox-notes" rows={3} key={r.id} defaultValue={r.employer_notes||''} placeholder="Only your team sees these" aria-label={'Notes on '+r.name}
        onBlur={e=>{if(e.target.value!==(r.employer_notes||''))void actions.onNotes(r,e.target.value)}}/>
    </section>
  </div>;
}

/** The candidate in a right-side panel over the list, so the recruiter keeps their place. */
export function CandidatePanel({onClose,onOpenPage,...props}:DetailProps&{onClose:()=>void;onOpenPage:()=>void}){
  const closeRef=useRef<HTMLButtonElement>(null);
  useEffect(()=>{
    closeRef.current?.focus();
    const onKey=(e:KeyboardEvent)=>{if(e.key==='Escape')onClose()};
    window.addEventListener('keydown',onKey);
    const overflow=document.body.style.overflow;document.body.style.overflow='hidden';
    return ()=>{window.removeEventListener('keydown',onKey);document.body.style.overflow=overflow};
  },[props.row.id]);
  return <div className="candidate-drawer-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}>
    <aside className="candidate-drawer" role="dialog" aria-modal="true" aria-label={props.row.name}>
      <div className="candidate-drawer-bar">
        <button type="button" className="text-button" onClick={onOpenPage}>Open full page ↗</button>
        <button type="button" className="icon-button" ref={closeRef} onClick={onClose} aria-label="Close">×</button>
      </div>
      <CandidateDetail {...props}/>
    </aside>
  </div>;
}

/** The same candidate as its own page at /app?candidate=…, with a link a teammate can open. */
export function CandidatePage({onBack,...props}:DetailProps&{onBack:()=>void}){
  return <section className="section-block candidate-page">
    <button type="button" className="text-button" onClick={onBack}>← Back to candidates</button>
    <CandidateDetail {...props}/>
  </section>;
}
