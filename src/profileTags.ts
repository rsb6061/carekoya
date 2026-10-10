// One set of caregiver tags for every employer-facing view (Talent network, Candidates, the profile panel and the
// agency inbox), so the same caregiver reads the same way everywhere. Profiles store raw codes ("part_time"), bare
// pay numbers ("50") and long shift lists; these turn them into short, plain labels in a fixed order.

export type ProfileTag={label:string;tone?:'strong'|'good'};

const HOURS:Record<string,string>={full_time:'Full time',part_time:'Part time',per_diem:'Per diem',prn:'Per diem'};
const SHIFTS:Record<string,string>={morning:'Mornings',mornings:'Mornings',afternoon:'Afternoons',afternoons:'Afternoons',evening:'Evenings',evenings:'Evenings',
  overnight:'Overnights',overnights:'Overnights',weekend:'Weekends',weekends:'Weekends',live_in:'Live-in',days:'Days',nights:'Nights'};

const split=(raw:unknown)=>String(raw??'').split(',').map(x=>x.trim()).filter(Boolean);
/** "part_time" → "Part time"; already-readable words are kept, only the first letter is raised. */
const humanize=(x:string)=>{const key=x.toLowerCase().replace(/[\s-]+/g,'_');const t=HOURS[key]||SHIFTS[key]||x.replace(/_/g,' ');return t.charAt(0).toUpperCase()+t.slice(1)};

/** Shift or hours preferences as one short label: at most two items, then "+N". */
export function shiftsLabel(raw:unknown){
  const items=[...new Set(split(raw).map(humanize))];
  if(!items.length)return '';
  return items.slice(0,2).join(', ')+(items.length>2?' +'+(items.length-2):'');
}

/** Desired pay as "$50/hr"; text that already reads as pay ("$25+/hr", "$20–24/hr") is kept. */
export function wageLabel(raw:unknown){
  const v=String(raw??'').trim();
  if(!v)return '';
  const range=v.match(/^\$?\s*(\d+(?:\.\d+)?)\s*(?:[-–]\s*\$?\s*(\d+(?:\.\d+)?))?\s*(\+)?\s*(?:\/?\s*(?:hr|hour|an hour|per hour))?$/i);
  if(range){
    const n=(s:string)=>String(Number(s));
    return '$'+n(range[1])+(range[2]?'–'+n(range[2]):'')+(range[3]||'')+'/hr';
  }
  return v;
}

/** Miles as a tag: "Under 1 mi" or "12 mi away". */
export function distanceLabel(miles:number|null|undefined){
  if(miles==null||!Number.isFinite(miles))return '';
  return miles<1?'Under 1 mi':Math.round(miles)+' mi away';
}

/**
 * Match reasons worth a tag. Role, credential and freshness are already said by the match score and the
 * availability tag, and distance gets its own tag, so they are dropped here.
 */
function reasonTag(reason:string){
  const r=reason.trim();
  if(!r||/^(role match|related credential|same state|transportation|shift overlap|recently confirmed|confirmed this month|older availability)$/i.test(r))return '';
  if(/^within 1 mi$|mi away$/.test(r))return '';
  return r.charAt(0).toUpperCase()+r.slice(1);
}

/** Distance from a match reason ("within 1 mi", "12 mi away") when the row has no number of its own. */
export function reasonMiles(reasons:string[]|undefined){
  for(const r of reasons||[]){
    if(r==='within 1 mi')return 0.5;
    const m=r.match(/^(\d+) mi away$/);if(m)return Number(m[1]);
  }
  return null;
}

export function profileTags(p:{
  matchScore?:number|null;distanceMiles?:number|null;reasons?:string[];freshness?:string;
  shifts?:string;employmentTypes?:string;desiredWage?:unknown;
},max=4):ProfileTag[]{
  const tags:ProfileTag[]=[];
  if(p.matchScore)tags.push({label:p.matchScore+'% match',tone:'strong'});
  const distance=distanceLabel(p.distanceMiles??reasonMiles(p.reasons));
  if(distance)tags.push({label:distance});
  if(p.freshness)tags.push({label:p.freshness,tone:/^Confirmed/.test(p.freshness)?'good':undefined});
  for(const r of p.reasons||[]){const t=reasonTag(r);if(t)tags.push({label:t})}
  const hours=shiftsLabel(p.employmentTypes||p.shifts);
  if(hours)tags.push({label:hours});
  const wage=wageLabel(p.desiredWage);
  if(wage)tags.push({label:wage});
  return tags.slice(0,max);
}

/** Certifications as a short line: the first three, then "+N". */
export function certificationsLabel(raw:unknown){
  const items=[...new Set(split(raw))];
  return items.slice(0,3).join(' · ')+(items.length>3?' · +'+(items.length-3):'');
}

/** Certifications minus the one already shown as the role ("CNA · Baltimore" needn't repeat "CNA"). */
export const withoutRole=(certifications:unknown,role?:string)=>split(certifications).filter(x=>x.toLowerCase()!==String(role||'').trim().toLowerCase()).join(', ');
