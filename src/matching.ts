import { DEFAULT_COMMUTE_MILES, rowDistanceMiles } from './geo';
import { hasSchedule, parseOpeningSchedule, scheduleFit } from './schedule';

type Row=Record<string,unknown>;
const clean=(v:unknown,max=500)=>typeof v==='string'?v.trim().slice(0,max):'';

export function ageDays(timestamp:unknown,now=Date.now()){
  const value=clean(timestamp,80);
  if(!value)return null;
  const ms=now-new Date(value).getTime();
  return Number.isFinite(ms)?Math.max(0,ms/86400000):null;
}

export function freshnessLabel(status:unknown,confirmedAt:unknown,now=Date.now()){
  const s=clean(status,80);
  const days=ageDays(confirmedAt,now);
  if(s==='actively_looking'&&days!==null){
    if(days<1)return 'Confirmed today';
    if(days<=7)return `Confirmed ${Math.floor(days)}d ago`;
    if(days<=30)return 'Confirmed this month';
  }
  if(s==='not_looking')return 'Not currently looking';
  return 'Availability unconfirmed';
}

function splitTerms(value:string){
  return value.toLowerCase().split(/[^a-z0-9]+/).filter(x=>x.length>2);
}

/** A caregiver's commute radius: their own setting when present, otherwise the default, clamped to 5-100 miles. */
export function commuteRadiusMiles(caregiver:Row){
  const miles=Number(caregiver.travel_distance_miles||0);
  return Math.max(5,Math.min(100,miles>0?miles:DEFAULT_COMMUTE_MILES));
}

const ROLE_ALIASES:Record<string,string[]>={
  cna:['cna','certified nursing assistant','nursing assistant'],
  gna:['gna','geriatric nursing assistant','nursing assistant'],
  hha:['hha','home health aide'],
  pca:['pca','personal care aide'],
  caregiver:['caregiver','personal care','home health','cna','hha','pca'],
  // Assisted living roles.
  'cmt / med tech':['cmt','med tech','medication technician','medication aide'],
  'resident assistant':['resident assistant','cna','gna','pca','caregiver','personal care'],
  'memory care aide':['memory care','dementia','alzheimer','cna','gna']
};

/**
 * Scores a caregiver for an opening (0-100). Rows may carry `geo_lat`/`geo_lng` from zip_geo;
 * when both do, geography is distance-based and caregivers outside their commute radius are excluded (score 0).
 */
export function scoreCandidate(opening:Row,c:Row,now=Date.now()){
  if(c.auth0_email_verified!==undefined&&Number(c.auth0_email_verified)!==1&&!(c.source==='legacy_carekoya'&&c.activation_completed_at))return {score:0,reasons:['email not verified'],distanceMiles:null};
  if(c.work_status!==undefined&&c.work_status!=='actively_looking')return {score:0,reasons:['availability not confirmed'],distanceMiles:null};
  let score=0;
  const reasons:string[]=[];
  const distanceMiles=rowDistanceMiles(opening,c);

  if(distanceMiles!==null){
    const radius=commuteRadiusMiles(c);
    if(distanceMiles>radius)return {score:0,reasons:['outside commute radius'],distanceMiles};
    const miles=Math.round(distanceMiles);
    if(distanceMiles<=5){score+=25;reasons.push(miles<=1?'within 1 mi':`${miles} mi away`)}
    else if(distanceMiles<=10){score+=22;reasons.push(`${miles} mi away`)}
    else if(distanceMiles<=20){score+=18;reasons.push(`${miles} mi away`)}
    else {score+=12;reasons.push(`${miles} mi away`)}
  }else{
    const openingZip=clean(opening.zip),caregiverZip=clean(c.zip);
    const openingState=clean(opening.state).toLowerCase(),caregiverState=clean(c.state).toLowerCase();
    const openingCity=clean(opening.city).toLowerCase(),caregiverCity=clean(c.city).toLowerCase();
    if(openingState&&caregiverState&&openingState!==caregiverState)return {score:0,reasons:['different state'],distanceMiles};
    if(openingZip&&caregiverZip&&openingZip===caregiverZip){score+=25;reasons.push('same ZIP')}
    else if(openingCity&&caregiverCity&&openingCity===caregiverCity&&openingState===caregiverState){score+=20;reasons.push('same city')}
    else if(openingState&&caregiverState){score+=10;reasons.push('same state')}
  }

  const targetRole=clean(opening.role).toLowerCase();
  const roleText=[clean(c.role),clean(c.certifications),clean(c.specialties)].join(' ').toLowerCase();
  if(targetRole){
    const terms=ROLE_ALIASES[targetRole]||[targetRole];
    if(roleText.includes(targetRole)){score+=40;reasons.push('role match')}
    else if(terms.some(term=>roleText.includes(term))){score+=35;reasons.push('related credential')}
    else return {score:0,reasons:['required role or credential missing'],distanceMiles};
  }

  const days=ageDays(c.last_confirmed_at,now);
  if(clean(c.work_status)==='actively_looking'&&days!==null){
    if(days<=7){score+=25;reasons.push('recently confirmed')}
    else if(days<=30){score+=18;reasons.push('confirmed this month')}
    else if(days<=90){score+=8;reasons.push('older availability')}
  }

  // A day-by-day schedule is compared with the caregiver's weekly grid; older openings fall back to shift words.
  const schedule=parseOpeningSchedule(opening.schedule_json);
  const fit=hasSchedule(schedule)?scheduleFit(schedule,c.availability_json):null;
  if(fit){
    score+=Math.round(15*fit.workable/fit.shifts);
    if(schedule.liveIn)reasons.push(fit.workable?'open to live-in':'not open to live-in');
    else reasons.push(fit.workable===fit.shifts?(fit.shifts===1?'available for the shift':`available all ${fit.shifts} shifts`):fit.workable?`available ${fit.workable} of ${fit.shifts} shifts`:'schedule does not overlap');
  }else{
    const targetShift=clean(opening.shift_preferences),candidateShift=clean(c.shift_preferences);
    if(targetShift&&candidateShift&&splitTerms(targetShift).some(term=>candidateShift.toLowerCase().includes(term))){
      score+=10;reasons.push('shift overlap');
    }
  }
  if(Number(opening.transportation_required||0)===1&&(clean(c.transportation)||Number(c.willing_to_drive||0)===1)){
    score+=5;reasons.push('transportation');
  }
  return {score:Math.min(100,score),reasons,distanceMiles};
}
