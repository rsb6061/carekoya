// A caregiver as employers see them in Talent network search. The caregiver's own "View my profile"
// preview renders this same card, so what they see is exactly what employers see.

export type TalentCandidate={
  id:string;name:string;city?:string;state?:string;zip?:string;role?:string;
  certifications?:string;specialties?:string;yearsExperience?:number;desiredWage?:string;
  shifts?:string;travelMiles?:number;freshness?:string;workStatus?:string;profilePhotoUrl?:string;distanceMiles?:number|null;
};

export function TalentCard({candidate,tone}:{candidate:TalentCandidate;tone:string}){
  return <article className={'job-card '+tone}>
    <div className="job-card-main"><div className="candidate-name-row">{candidate.profilePhotoUrl?<img className="candidate-avatar" src={candidate.profilePhotoUrl} alt="" />:<span className="candidate-avatar candidate-avatar-empty">{candidate.name?.slice(0,1)||'?'}</span>}<h3>{candidate.name}</h3></div><div className="job-meta">{[candidate.role,candidate.city,candidate.state,candidate.distanceMiles!=null?candidate.distanceMiles+' mi away':''].filter(Boolean).join(' · ')}</div>
    <div className="job-badges"><span className={candidate.workStatus==='actively_looking'?'status applied':'status'}>{candidate.freshness}</span>{candidate.shifts&&<span className="badge">{candidate.shifts}</span>}{candidate.desiredWage&&<span className="badge">{candidate.desiredWage}</span>}</div>
    {candidate.certifications&&<div className="job-card-cue">{candidate.certifications}</div>}</div>
  </article>;
}
