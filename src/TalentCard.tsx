import { useState, type ReactNode } from 'react';
import { CHECKLIST } from './checklist';
import { certificationsLabel, profileTags, shiftsLabel, withoutRole } from './profileTags';
// A caregiver as employers see them in Talent network search. The caregiver's own "View my profile"
// preview renders this same card, so what they see is exactly what employers see.

export type TalentCandidate={
  id:string;name:string;city?:string;state?:string;zip?:string;role?:string;
  certifications?:string;specialties?:string;languages?:string;careSettings?:string;preferredSettings?:string;bio?:string;
  employmentTypes?:string;startAvailability?:string;licensed?:boolean;licenseState?:string;hasResume?:boolean;checklist?:string[];
  yearsExperience?:number;desiredWage?:string;transportation?:string;
  shifts?:string;schedule?:string;travelMiles?:number;freshness?:string;workStatus?:string;profilePhotoUrl?:string;introVideoUrl?:string;distanceMiles?:number|null;withinCommute?:boolean;
};

const START:Record<string,string>={now:'Can start now','2_weeks':'Can start within 2 weeks','1_month':'Can start within a month',later:'Starting later'};
const TRANSPORT:Record<string,string>={own_car:'Has own car',reliable_transportation:'Reliable transportation',public_transit:'Public transit',other:'Other transportation'};
const HOURS:Record<string,string>={full_time:'Full time',part_time:'Part time',per_diem:'Per diem'};

/**
 * The rest of the profile, below the summary card: bio, experience, skills, languages and logistics. Only checklist
 * items the caregiver confirmed are listed; unanswered ones are the caregiver's to fix, not the employer's to read.
 */
export function TalentDetails({candidate:c,hideChecklist=false,resumeUrl}:{candidate:TalentCandidate;hideChecklist?:boolean;resumeUrl?:string|null}){
  const hours=(c.employmentTypes||'').split(',').map(x=>HOURS[x.trim()]||x.trim()).filter(Boolean).join(', ');
  const resume:ReactNode=resumeUrl?<a href={resumeUrl} target="_blank" rel="noopener">View resume</a>:c.hasResume?'On file, shared when they say yes':'';
  const rows:[string,ReactNode][]=([
    ['Schedule',c.schedule||''],
    ['Experience',c.yearsExperience?c.yearsExperience+(c.yearsExperience===1?' year':' years'):''],
    ['License',c.licensed?('On file'+(c.licenseState?' ('+c.licenseState+')':'')):''],
    ['Skills',c.specialties||''],
    ['Wants to work in',c.preferredSettings||''],
    ['Where they’ve worked',c.careSettings||''],
    ['Languages',c.languages||''],
    ['Hours',hours],
    ['Start',START[c.startAvailability||'']||''],
    ['Travel',[c.travelMiles?'Up to '+c.travelMiles+' miles':'',TRANSPORT[c.transportation||'']||c.transportation||''].filter(Boolean).join(' · ')],
    ['Resume',resume],
    ['Checked',hideChecklist?'':CHECKLIST.filter(([k])=>c.checklist?.includes(k)).map(([,label])=>label).join(' · ')],
  ] as [string,ReactNode][]).filter(([,v])=>v);
  if(!c.bio&&!rows.length)return null;
  return <div className="talent-details">
    {c.bio&&<p className="talent-bio">{c.bio}</p>}
    {rows.length>0&&<dl className="apply-profile-summary">{rows.map(([k,v])=><div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>}
  </div>;
}

/** "Watch intro video": asks for a short-lived signed player link only when someone actually wants to watch. */
export function IntroVideo({url}:{url:string}){
  const [player,setPlayer]=useState('');
  const [state,setState]=useState<'idle'|'loading'|'error'>('idle');
  const [error,setError]=useState('');
  async function open(){
    setState('loading');
    try{
      const res=await fetch(url,{credentials:'same-origin'});
      const body=await res.json().catch(()=>({})) as {playbackUrl?:string|null;error?:string};
      if(!res.ok||!body.playbackUrl)throw new Error(body.error||'This video is still processing.');
      setPlayer(body.playbackUrl);setState('idle');
    }catch(err){setError(err instanceof Error?err.message:'Could not load the video.');setState('error')}
  }
  if(player)return <div className="intro-video-frame"><iframe src={player} title="Intro video" allow="encrypted-media; picture-in-picture; fullscreen" allowFullScreen/></div>;
  return <div className="intro-video-open"><button type="button" className="button secondary" onClick={()=>void open()} disabled={state==='loading'}>{state==='loading'?'Loading…':'▶ Watch intro video'}</button>
    {state==='error'&&<span className="job-meta"> {error}</span>}</div>;
}

/**
 * One caregiver as a Talent network tile: who, where, the shared profile tags and certifications. With `onOpen` the
 * whole tile opens the profile panel; `expanded` (the caregiver's own preview) shows the full profile inline instead.
 */
export function TalentCard({candidate:c,tone,expanded=false,status,onOpen,note,action}:{candidate:TalentCandidate;tone:string;expanded?:boolean;status?:ReactNode;onOpen?:()=>void;note?:string;action?:ReactNode}){
  // Three tags on a tile (distance, availability, pay); hours and the rest are one click away in the panel.
  const tags=expanded?profileTags({distanceMiles:c.distanceMiles,freshness:c.freshness,employmentTypes:c.employmentTypes,shifts:shiftsLabel(c.employmentTypes)?undefined:c.shifts,desiredWage:c.desiredWage})
    :profileTags({distanceMiles:c.distanceMiles,freshness:c.freshness,desiredWage:c.desiredWage},3);
  const certs=certificationsLabel(withoutRole(c.certifications,c.role));
  const where=[c.city,c.state].filter(Boolean).join(', ');
  return <article className={'job-card talent-card '+tone+(onOpen?' clickable':'')} onClick={onOpen?e=>{if(!(e.target as HTMLElement).closest('a,button,details'))onOpen()}:undefined}>
    <div className="job-card-main">
      <div className="candidate-name-row">
        {c.profilePhotoUrl?<img className="candidate-avatar" src={c.profilePhotoUrl} alt="" />:<span className="candidate-avatar candidate-avatar-empty">{c.name?.slice(0,1)||'?'}</span>}
        <div className="talent-card-name"><h3>{onOpen?<button type="button" className="match-name-button" onClick={onOpen}>{c.name}</button>:c.name}</h3><div className="job-meta">{[c.role,where].filter(Boolean).join(' · ')}</div></div>
        {status&&<div className="talent-card-status">{status}</div>}
      </div>
      {tags.length>0&&<div className="match-reasons">{tags.map(t=><span className={'badge'+(t.tone?' '+t.tone:'')} key={t.label}>{t.label}</span>)}</div>}
      {certs&&<div className="job-card-cue">{certs}</div>}
      {expanded&&c.introVideoUrl&&<IntroVideo url={c.introVideoUrl}/>}
      {expanded&&<TalentDetails candidate={c}/>}
      {note&&<div className="talent-card-note">{note}</div>}
      {(onOpen||action)&&<div className="talent-card-foot">{onOpen&&<button type="button" className="text-button match-open" onClick={onOpen}>View profile</button>}{action}</div>}
    </div>
  </article>;
}
