import { useEffect, useState } from 'react';
import { Drawer, ProfileBody, ProfileHead } from './CandidatePanel';
import { type TalentCandidate } from './TalentCard';
import { profileTags } from './profileTags';

export type TalentOpening={id:string;title:string};
/** Where this caregiver already is in the employer's candidates: the opening and the row to open. */
export type PipelineSpot={rowId:string;title:string;applied?:boolean};
export type TalentActions={
  openings:TalentOpening[];
  pipelineFor:(caregiverId:string)=>PipelineSpot[];
  onInvite:(candidate:TalentCandidate|TalentCandidate[],openingId:string)=>Promise<void>;
  disabled?:boolean;
};

const talentPageUrl=(id:string)=>'/app?talent='+encodeURIComponent(id);

/** "Invite to …": picks one of the employer's open openings, or invites straight away when there is only one. */
function InviteToOpening({candidate,actions}:{candidate:TalentCandidate;actions:TalentActions}){
  const spots=actions.pipelineFor(candidate.id);
  const placed=new Set(spots.map(s=>s.title));
  const options=actions.openings.filter(o=>!placed.has(o.title));
  const [openingId,setOpeningId]=useState(options[0]?.id||'');
  const [busy,setBusy]=useState(false);
  useEffect(()=>{if(!options.some(o=>o.id===openingId))setOpeningId(options[0]?.id||'')},[options.map(o=>o.id).join()]);
  // Already applied to the agency, or lives beyond their own commute: nothing to invite them to.
  if(spots.some(s=>s.applied))return null;
  if(candidate.distanceMiles!=null&&candidate.withinCommute===false)return <span className="job-meta">Lives beyond their commute from you</span>;
  if(!actions.openings.length)return <a className="button secondary" href="/app?tab=openings">Add an opening to invite</a>;
  if(!options.length)return null;
  const go=async()=>{setBusy(true);try{await actions.onInvite(candidate,openingId)}finally{setBusy(false)}};
  return <div className="invite-to-opening">
    {options.length>1&&<select aria-label="Opening to invite to" value={openingId} onChange={e=>setOpeningId(e.target.value)}>{options.map(o=><option key={o.id} value={o.id}>{o.title}</option>)}</select>}
    <button type="button" className="button" disabled={actions.disabled||busy||!openingId} onClick={()=>void go()}>{busy?'Inviting…':options.length>1?'Invite':'Invite to '+options[0].title}</button>
  </div>;
}

/** One network caregiver: the same head, tags and profile as a matched candidate, with Invite in place of a stage. */
export function TalentDetail({candidate:c,actions}:{candidate:TalentCandidate;actions:TalentActions}){
  const spots=actions.pipelineFor(c.id);
  return <div className="candidate-detail">
    <ProfileHead name={c.name} photo={c.profilePhotoUrl} role={c.role} meta={[c.role,[c.city,c.state].filter(Boolean).join(', ')].filter(Boolean).join(' · ')}
      status={spots.length?{label:'In your candidates for '+spots.map(s=>s.title).join(', '),tone:'applied'}:undefined}
      actions={<InviteToOpening candidate={c} actions={actions}/>}
      tags={profileTags({distanceMiles:c.distanceMiles,freshness:c.freshness,employmentTypes:c.employmentTypes,shifts:c.shifts,desiredWage:c.desiredWage})}
      certifications={c.certifications}/>
    <ProfileBody candidate={c}/>
    <p className="job-meta">Email, phone{c.hasResume?' and resume':''} are shared once {c.name.split(/\s+/)[0]||'they'} says yes to an invitation.</p>
  </div>;
}

export function TalentPanel({candidate,actions,onClose}:{candidate:TalentCandidate;actions:TalentActions;onClose:()=>void}){
  return <Drawer label={candidate.name} pageUrl={talentPageUrl(candidate.id)} onClose={onClose}><TalentDetail candidate={candidate} actions={actions}/></Drawer>;
}

/** The same caregiver as its own page at /app?talent=…, for a new tab or a teammate. */
export function TalentPage({id,zip,actions,onBack}:{id:string;zip?:string;actions:TalentActions;onBack:()=>void}){
  const [candidate,setCandidate]=useState<TalentCandidate|null>(null);
  const [error,setError]=useState('');
  useEffect(()=>{
    let live=true;
    setCandidate(null);setError('');
    fetch('/api/candidates/'+encodeURIComponent(id)+(zip?'?zip='+encodeURIComponent(zip):''),{credentials:'same-origin'})
      .then(async res=>{const body=await res.json().catch(()=>({})) as {candidate?:TalentCandidate;error?:string};if(!res.ok||!body.candidate)throw new Error(body.error||'Could not load this caregiver.');if(live)setCandidate(body.candidate)})
      .catch(err=>{if(live)setError(err instanceof Error?err.message:'Could not load this caregiver.')});
    return ()=>{live=false};
  },[id,zip]);
  return <section className="section-block candidate-page">
    <button type="button" className="text-button" onClick={onBack}>← Back to Find caregivers</button>
    {candidate?<TalentDetail candidate={candidate} actions={actions}/>
      :<div className="empty"><strong>{error||'Loading this caregiver…'}</strong></div>}
  </section>;
}
