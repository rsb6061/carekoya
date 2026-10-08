// A caregiver as employers see them in Talent network search. The caregiver's own "View my profile"
// preview renders this same card, so what they see is exactly what employers see.

export type TalentCandidate={
  id:string;name:string;city?:string;state?:string;zip?:string;role?:string;
  certifications?:string;specialties?:string;languages?:string;careSettings?:string;bio?:string;
  employmentTypes?:string;startAvailability?:string;licensed?:boolean;licenseState?:string;hasResume?:boolean;
  yearsExperience?:number;desiredWage?:string;transportation?:string;
  shifts?:string;travelMiles?:number;freshness?:string;workStatus?:string;profilePhotoUrl?:string;distanceMiles?:number|null;
};

const START:Record<string,string>={now:'Can start now','2_weeks':'Can start within 2 weeks','1_month':'Can start within a month',later:'Starting later'};
const TRANSPORT:Record<string,string>={own_car:'Has own car',reliable_transportation:'Reliable transportation',public_transit:'Public transit',other:'Other transportation'};
const HOURS:Record<string,string>={full_time:'Full time',part_time:'Part time',per_diem:'Per diem'};

/** The rest of the profile, below the summary card: bio, experience, skills, languages and logistics. */
function TalentDetails({candidate:c}:{candidate:TalentCandidate}){
  const hours=(c.employmentTypes||'').split(',').map(x=>HOURS[x.trim()]||x.trim()).filter(Boolean).join(', ');
  const rows:[string,string][]=([
    ['Experience',c.yearsExperience?c.yearsExperience+(c.yearsExperience===1?' year':' years'):''],
    ['License',c.licensed?('On file'+(c.licenseState?' ('+c.licenseState+')':'')):''],
    ['Skills',c.specialties||''],
    ['Where they’ve worked',c.careSettings||''],
    ['Languages',c.languages||''],
    ['Hours',hours],
    ['Start',START[c.startAvailability||'']||''],
    ['Travel',[c.travelMiles?'Up to '+c.travelMiles+' miles':'',TRANSPORT[c.transportation||'']||c.transportation||''].filter(Boolean).join(' · ')],
    ['Resume',c.hasResume?'On file, shared when they apply or say yes':''],
  ] as [string,string][]).filter(([,v])=>v);
  if(!c.bio&&!rows.length)return null;
  return <div className="talent-details">
    {c.bio&&<p className="talent-bio">{c.bio}</p>}
    {rows.length>0&&<dl className="apply-profile-summary">{rows.map(([k,v])=><div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>}
  </div>;
}

export function TalentCard({candidate,tone,expanded=false}:{candidate:TalentCandidate;tone:string;expanded?:boolean}){
  const c=candidate;
  const hasDetails=!!(c.bio||c.yearsExperience||c.licensed||c.specialties||c.careSettings||c.languages||c.employmentTypes||START[c.startAvailability||'']||c.travelMiles||c.transportation||c.hasResume);
  const details=<TalentDetails candidate={candidate}/>;
  return <article className={'job-card '+tone}>
    <div className="job-card-main"><div className="candidate-name-row">{candidate.profilePhotoUrl?<img className="candidate-avatar" src={candidate.profilePhotoUrl} alt="" />:<span className="candidate-avatar candidate-avatar-empty">{candidate.name?.slice(0,1)||'?'}</span>}<h3>{candidate.name}</h3></div><div className="job-meta">{[candidate.role,candidate.city,candidate.state,candidate.distanceMiles!=null?candidate.distanceMiles+' mi away':''].filter(Boolean).join(' · ')}</div>
    <div className="job-badges"><span className={candidate.workStatus==='actively_looking'?'status applied':'status'}>{candidate.freshness}</span>{candidate.shifts&&<span className="badge">{candidate.shifts}</span>}{candidate.desiredWage&&<span className="badge">{candidate.desiredWage}</span>}</div>
    {candidate.certifications&&<div className="job-card-cue">{candidate.certifications}</div>}
    {hasDetails&&(expanded?details:<details className="talent-more"><summary>Full profile</summary>{details}</details>)}</div>
  </article>;
}
