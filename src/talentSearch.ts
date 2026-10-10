// Pure pieces of Talent network search: whether a caregiver's stated location agrees with their ZIP, the agency
// filters that read the profile rather than a single column, and the closest-first ordering.
import { ageDays, commuteRadiusMiles } from './matching';
import { parseAvailability } from './caregiverApi';
import { hourlyPayFloor } from './payPreferences';
import { parseChecklist } from './checklist';

type Row=Record<string,unknown>;
const text=(v:unknown)=>typeof v==='string'?v.trim():'';

export { inUs, locationMatchesZip } from './caregiverLocation';

export type TalentFilters={shift?:string;hours?:string;cert?:string;car?:boolean;payMax?:number;language?:string;checked?:string};

/**
 * Shift, hours, certification, car, pay, language and one confirmed checklist item, read from the availability grid and
 * profile fields. A caregiver who left pay blank is kept under a pay limit: blank is not "too expensive".
 */
export function matchesTalentFilters(c:Row,f:TalentFilters){
  const shiftWords=text(c.shift_preferences).toLowerCase();
  if(f.shift){
    const a=parseAvailability(c.availability_json);
    const days=Object.values(a.days);
    const ok=f.shift==='overnight'?days.some(d=>d.includes('overnight'))||/overnight/.test(shiftWords)
      :f.shift==='live_in'?a.liveIn||/live[\s-]?in/.test(shiftWords)
      :f.shift==='weekends'?(a.days.sat?.length||0)+(a.days.sun?.length||0)>0||/weekend/.test(shiftWords)
      :true;
    if(!ok)return false;
  }
  if(f.hours&&!(text(c.employment_types)+' '+shiftWords).toLowerCase().replace(/[\s-]+/g,'_').includes(f.hours))return false;
  if(f.cert){
    const certs=(text(c.certifications)+' '+text(c.role)).toLowerCase();
    if(!new RegExp('\\b'+f.cert.toLowerCase().replace(/[^a-z0-9]/g,'')).test(certs.replace(/\//g,' ')))return false;
  }
  if(f.car&&!(text(c.transportation)==='own_car'||Number(c.willing_to_drive||0)===1))return false;
  if(f.payMax){
    const floor=Number(c.hourly_rate_min)||hourlyPayFloor(c.desired_wage);
    if(floor&&floor>f.payMax)return false;
  }
  if(f.language&&!text(c.languages).toLowerCase().includes(f.language.toLowerCase()))return false;
  if(f.checked&&!parseChecklist(c.checklist).includes(f.checked as never))return false;
  return true;
}

export type Ranked={c:Row;distanceMiles:number|null};

export const withinCommute=(r:Ranked)=>r.distanceMiles!==null&&r.distanceMiles<=commuteRadiusMiles(r.c);

/**
 * Closest first: caregivers within their own commute range lead, ordered by distance, then everyone farther away
 * (or with no usable location) after them. "recent" orders by last confirmation instead, still commute-range first.
 */
export function sortTalent(rows:Ranked[],sort:'closest'|'recent'='closest'){
  return [...rows].sort((a,b)=>{
    const ac=withinCommute(a)?0:1,bc=withinCommute(b)?0:1;
    const aAge=ageDays(a.c.last_confirmed_at)??9999,bAge=ageDays(b.c.last_confirmed_at)??9999;
    const ad=a.distanceMiles??99999,bd=b.distanceMiles??99999;
    return ac-bc||(sort==='recent'?aAge-bAge||ad-bd:ad-bd||aAge-bAge);
  });
}
