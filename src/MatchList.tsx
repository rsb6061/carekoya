import { useMemo, useState } from 'react';
import { TalentDetails, type TalentCandidate } from './TalentCard';
import { profileTags } from './profileTags';

export type MatchRow={
  id:string;opening_id:string;stage:string;match_score?:number;match_reasons?:string[];
  contacted_at?:string|null;responded_at?:string|null;interview_at?:string|null;hired_at?:string|null;
  response_value?:string|null;rejected_reason?:string|null;title:string;caregiver_id:string;favorite?:boolean;resume_url?:string|null;
  name:string;city?:string;state?:string;role?:string;profilePhotoUrl?:string;contact_email?:string|null;contact_phone?:string|null;contact_locked?:boolean;employer_notes?:string;profile?:TalentCandidate;
};

export const day=(v?:string|null)=>v?new Date(v.includes('T')?v:v.replace(' ','T')+'Z').toLocaleDateString(undefined,{month:'short',day:'numeric'}):'';
export const when=(v?:string|null)=>v?new Date(v).toLocaleString(undefined,{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'';

/** Where a match stands, in the employer's words. Only real invitations and caregiver answers move these. */
export function statusOf(r:MatchRow):{label:string;tone:string}{
  switch(r.stage){
    case 'matched':return {label:'Not invited yet',tone:''};
    case 'contacted':return {label:'Invited '+day(r.contacted_at)+' · waiting for a reply',tone:''};
    case 'interested':return {label:r.contact_locked?'Interested · upgrade to see contact':'Interested',tone:'applied'};
    case 'interview':return {label:'Interview '+when(r.interview_at),tone:'applied'};
    case 'hired':return {label:'Hired',tone:'applied'};
    case 'rejected':return {label:r.response_value==='not_interested'?'Not interested':'Not a fit',tone:'muted'};
    default:return {label:r.stage,tone:''};
  }
}

/**
 * Matched caregivers as selectable tiles: why each one matched, where they stand, and the next action.
 * Invitations go out per caregiver or for the selected ones; the employer's only manual marks are Hired and Not a fit.
 */
export function MatchList({rows,showOpening,disabled,onInvite,onDecide,onNotes,onOpen,onRestore}:{
  rows:MatchRow[];showOpening:boolean;disabled?:boolean;
  onInvite:(rows:MatchRow[])=>Promise<void>;onDecide:(row:MatchRow,stage:'hired'|'rejected')=>Promise<void>;
  onNotes?:(row:MatchRow,notes:string)=>Promise<void>;
  onOpen?:(row:MatchRow)=>void;onRestore?:(row:MatchRow)=>Promise<void>;
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
      return <article className={'match-tile'+(selected.has(r.id)?' picked':'')} key={r.id}>
        <div className="match-pick">{canPick&&<input type="checkbox" aria-label={'Select '+r.name} checked={selected.has(r.id)} disabled={disabled||busy} onChange={()=>toggle(r.id)}/>}</div>
        <div className="match-body">
          <div className="match-head">
            {r.profilePhotoUrl?<img className="candidate-avatar" src={r.profilePhotoUrl} alt=""/>:<span className="candidate-avatar candidate-avatar-empty">{r.name?.slice(0,1)||'?'}</span>}
            <div className="match-name">
              <h3>{onOpen?<button type="button" className="match-name-button" onClick={()=>onOpen(r)}>{r.name}</button>:r.name}</h3>
              <div className="job-meta">{[r.role,[r.city,r.state].filter(Boolean).join(', '),showOpening?'For '+r.title:''].filter(Boolean).join(' · ')}</div>
            </div>
            {r.stage!=='matched'&&<span className={'match-status '+status.tone}>{status.label}</span>}
          </div>
          <div className="match-reasons">
            {profileTags({matchScore:r.match_score,reasons:r.match_reasons,freshness:r.profile?.freshness,employmentTypes:r.profile?.employmentTypes,shifts:r.profile?.shifts,desiredWage:r.profile?.desiredWage}).map(t=><span className={'badge'+(t.tone?' '+t.tone:'')} key={t.label}>{t.label}</span>)}
          </div>
          {onOpen?<button type="button" className="text-button match-open" onClick={()=>onOpen(r)}>View profile</button>
            :r.profile&&<details className="talent-more"><summary>Full profile</summary><TalentDetails candidate={r.profile}/></details>}
          {onOpen&&r.employer_notes&&<p className="match-note-preview"><strong>Note:</strong> {r.employer_notes}</p>}
          {onNotes&&!onOpen&&r.stage!=='matched'&&<textarea className="inbox-notes" rows={2} defaultValue={r.employer_notes||''} placeholder="Private notes" aria-label={'Notes on '+r.name}
            onBlur={e=>{if(e.target.value!==(r.employer_notes||''))void onNotes(r,e.target.value)}}/>}
        </div>
        <div className="match-actions">
          {r.stage==='matched'&&<button className="button" disabled={disabled||busy} onClick={()=>void invite([r])}>Invite</button>}
          {r.contact_email&&<a className="button" href={'mailto:'+r.contact_email}>Email</a>}
          {r.contact_phone&&<a className="button secondary" href={'tel:'+r.contact_phone.replace(/[^\d+]/g,'')}>Call</a>}
          {r.resume_url&&<a className="text-button" href={r.resume_url}>Resume</a>}
          {(r.contact_email||r.contact_phone)&&<span className="match-contact">{[r.contact_email,r.contact_phone].filter(Boolean).join(' · ')}</span>}
          {['interested','interview'].includes(r.stage)&&<button className="button secondary" disabled={disabled} onClick={()=>void onDecide(r,'hired')}>Mark hired</button>}
          {!['hired','rejected'].includes(r.stage)&&<button className="text-button" disabled={disabled} onClick={()=>void onDecide(r,'rejected')}>Not a fit</button>}
          {onRestore&&r.stage==='rejected'&&r.rejected_reason==='employer_not_a_fit'&&<button className="button secondary" disabled={disabled} onClick={()=>void onRestore(r)}>Restore</button>}
        </div>
      </article>;
    })}
  </div>;
}
