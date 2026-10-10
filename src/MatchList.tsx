import { useMemo, useState } from 'react';
import { TalentDetails, type TalentCandidate } from './TalentCard';
import { profileTags } from './profileTags';

/**
 * One person in the employer's candidates. Two sources share this shape and one set of stages:
 * - a match ("kind" match): CareJoys matched them to an opening, the employer invites, they answer;
 * - an application ("kind" application): they sent their profile to the agency from a job page, the widget or an AI assistant.
 */
export type MatchRow={
  id:string;opening_id:string;stage:string;match_score?:number;match_reasons?:string[];
  contacted_at?:string|null;responded_at?:string|null;interview_at?:string|null;hired_at?:string|null;
  response_value?:string|null;rejected_reason?:string|null;title:string;caregiver_id:string;favorite?:boolean;resume_url?:string|null;
  name:string;city?:string;state?:string;role?:string;profilePhotoUrl?:string;contact_email?:string|null;contact_phone?:string|null;contact_locked?:boolean;employer_notes?:string;profile?:TalentCandidate|null;
  kind?:'match'|'application';
  /** Applications: the agency already emailed or called them. */
  reached?:boolean;
  /** Applications: where they applied from ("CareJoys job page", "AI assistant") and what they wrote. */
  source_label?:string;caregiver_note?:string|null;
  /** Applications: the inbox item id the stage and notes are saved on. */
  application_id?:string;
};

export const day=(v?:string|null)=>v?new Date(v.includes('T')?v:v.replace(' ','T')+'Z').toLocaleDateString(undefined,{month:'short',day:'numeric'}):'';
export const when=(v?:string|null)=>v?new Date(v).toLocaleString(undefined,{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'';

/** Stages in the order a candidate moves through them, with the words the dashboard uses. */
export const STAGE_LABELS:Record<string,string>={matched:'Not invited yet',contacted:'Invited',interested:'Said yes',interview:'Interviewing',hired:'Hired'};

/** A caregiver who said yes or applied and is waiting on the employer. */
export const needsReply=(r:MatchRow)=>r.stage==='interested'&&!r.reached;

/** Where a candidate stands, in the employer's words. Only real invitations and caregiver answers move a match to Invited or Said yes. */
export function statusOf(r:MatchRow):{label:string;tone:string}{
  const app=r.kind==='application';
  switch(r.stage){
    case 'matched':return {label:'Not invited yet',tone:''};
    case 'contacted':return {label:'Invited '+day(r.contacted_at)+' · waiting for a reply',tone:''};
    case 'interested':
      if(r.contact_locked)return {label:(app?'Applied':'Said yes')+' · upgrade to see contact',tone:'applied'};
      return {label:(app?'Applied ':'Said yes ')+day(r.responded_at)+(r.reached?' · you reached out':' · needs your reply'),tone:'applied'};
    case 'interview':return {label:r.interview_at?'Interview '+when(r.interview_at):'Interviewing',tone:'applied'};
    case 'hired':return {label:'Hired',tone:'applied'};
    case 'rejected':return {label:r.response_value==='not_interested'?'Not interested':'Not a fit',tone:'muted'};
    default:return {label:r.stage,tone:''};
  }
}

/** "Applied from your CareJoys job page · Oct 10" or "Matched to CNA · Baltimore". */
export function sourceOf(r:MatchRow){
  return r.kind==='application'?'Applied from '+(r.source_label==='AI assistant'?'an AI assistant':'your job page')+(r.title?' for '+r.title:''):'Matched to '+r.title;
}

export type DecideStage='interview'|'hired'|'rejected';

/**
 * Candidates as selectable tiles: why each one is here, where they stand, and the next action. Invitations go out per
 * caregiver or for the selected ones; the employer's own marks are Interviewing, Hired and Not a fit.
 */
export function MatchList({rows,showOpening,disabled,onInvite,onDecide,onNotes,onOpen,onRestore,onReach}:{
  rows:MatchRow[];showOpening:boolean;disabled?:boolean;
  onInvite:(rows:MatchRow[])=>Promise<void>;onDecide:(row:MatchRow,stage:DecideStage)=>Promise<void>;
  onNotes?:(row:MatchRow,notes:string)=>Promise<void>;
  onOpen?:(row:MatchRow)=>void;onRestore?:(row:MatchRow)=>Promise<void>;onReach?:(row:MatchRow)=>void;
}){
  const [selected,setSelected]=useState<Set<string>>(new Set());
  const [busy,setBusy]=useState(false);
  const invitable=useMemo(()=>rows.filter(r=>r.stage==='matched'),[rows]);
  const picked=invitable.filter(r=>selected.has(r.id));
  const allPicked=invitable.length>0&&picked.length===invitable.length;

  const toggle=(id:string)=>setSelected(prev=>{const next=new Set(prev);next.has(id)?next.delete(id):next.add(id);return next});
  async function invite(list:MatchRow[]){
    if(!list.length)return;
    setBusy(true);
    try{await onInvite(list);setSelected(new Set())}finally{setBusy(false)}
  }

  return <div className="match-list">
    {invitable.length>0&&<div className="match-toolbar">
      <label className="match-select-all"><input type="checkbox" checked={allPicked} disabled={disabled||busy} onChange={()=>setSelected(allPicked?new Set():new Set(invitable.map(r=>r.id)))}/><span>{picked.length?picked.length+' selected':'Select all not yet invited ('+invitable.length+')'}</span></label>
      <button className="button" disabled={disabled||busy||!picked.length} onClick={()=>void invite(picked)}>{busy?'Sending…':picked.length?'Invite '+picked.length+' selected':'Invite selected'}</button>
    </div>}
    {rows.map(r=>{
      const status=statusOf(r);
      const canPick=r.stage==='matched';
      const reach=()=>onReach?.(r);
      const mail=r.contact_email?'mailto:'+r.contact_email+(r.kind==='application'?'?subject='+encodeURIComponent((r.title||'Caregiver role')+' — CareJoys'):''):'';
      // Every tile keeps the checkbox column while anyone in the list can be invited, so the tiles line up.
      return <article className={'match-tile'+(selected.has(r.id)?' picked':'')+(invitable.length?'':' no-pick')} key={r.id}>
        {invitable.length>0&&<div className="match-pick">{canPick&&<input type="checkbox" aria-label={'Select '+r.name} checked={selected.has(r.id)} disabled={disabled||busy} onChange={()=>toggle(r.id)}/>}</div>}
        <div className="match-body">
          <div className="match-head">
            {r.profilePhotoUrl?<img className="candidate-avatar" src={r.profilePhotoUrl} alt=""/>:<span className="candidate-avatar candidate-avatar-empty">{r.name?.slice(0,1)||'?'}</span>}
            <div className="match-name">
              <h3>{onOpen?<button type="button" className="match-name-button" onClick={()=>onOpen(r)}>{r.name}</button>:r.name}</h3>
              <div className="job-meta">{[r.role,[r.city,r.state].filter(Boolean).join(', '),showOpening||r.kind==='application'?sourceOf(r):''].filter(Boolean).join(' · ')}</div>
            </div>
            {r.stage!=='matched'&&<span className={'match-status '+status.tone}>{status.label}</span>}
          </div>
          <div className="match-reasons">
            {profileTags({matchScore:r.match_score,reasons:r.match_reasons,freshness:r.profile?.freshness,employmentTypes:r.profile?.employmentTypes,shifts:r.profile?.shifts,desiredWage:r.profile?.desiredWage}).map(t=><span className={'badge'+(t.tone?' '+t.tone:'')} key={t.label}>{t.label}</span>)}
          </div>
          {r.caregiver_note&&<blockquote className="inbox-note">“{r.caregiver_note}”</blockquote>}
          {onOpen?<button type="button" className="text-button match-open" onClick={()=>onOpen(r)}>View profile</button>
            :r.profile&&<details className="talent-more"><summary>Full profile</summary><TalentDetails candidate={r.profile}/></details>}
          {onOpen&&r.employer_notes&&<p className="match-note-preview"><strong>Note:</strong> {r.employer_notes}</p>}
          {onNotes&&!onOpen&&r.stage!=='matched'&&<textarea className="inbox-notes" rows={2} defaultValue={r.employer_notes||''} placeholder="Private notes" aria-label={'Notes on '+r.name}
            onBlur={e=>{if(e.target.value!==(r.employer_notes||''))void onNotes(r,e.target.value)}}/>}
        </div>
        <div className="match-actions">
          {r.stage==='matched'&&<button className="button" disabled={disabled||busy} onClick={()=>void invite([r])}>Invite</button>}
          {mail&&<a className="button" href={mail} onClick={reach}>Email</a>}
          {r.contact_phone&&<a className="button secondary" href={'tel:'+r.contact_phone.replace(/[^\d+]/g,'')} onClick={reach}>Call</a>}
          {r.resume_url&&<a className="text-button" href={r.resume_url}>Resume</a>}
          {(r.contact_email||r.contact_phone)&&<span className="match-contact">{[r.contact_email,r.contact_phone].filter(Boolean).join(' · ')}</span>}
          {r.contact_locked&&<span className="match-contact">Upgrade to see contact details and resume.</span>}
          {r.stage==='interested'&&<button className="button secondary" disabled={disabled} onClick={()=>void onDecide(r,'interview')}>Interviewing</button>}
          {['interested','interview'].includes(r.stage)&&<button className="button secondary" disabled={disabled} onClick={()=>void onDecide(r,'hired')}>Mark hired</button>}
          {!['hired','rejected'].includes(r.stage)&&<button className="text-button" disabled={disabled} onClick={()=>void onDecide(r,'rejected')}>Not a fit</button>}
          {onRestore&&r.stage==='rejected'&&r.rejected_reason==='employer_not_a_fit'&&<button className="button secondary" disabled={disabled} onClick={()=>void onRestore(r)}>Restore</button>}
        </div>
      </article>;
    })}
  </div>;
}
