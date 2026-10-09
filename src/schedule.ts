// An opening's weekly schedule: the hours worked on each day, plus live-in.
// Stored as JSON in openings.schedule_json. Shared by the browser form, the Worker and matching.

export const SCHEDULE_DAYS=[['mon','Mon'],['tue','Tue'],['wed','Wed'],['thu','Thu'],['fri','Fri'],['sat','Sat'],['sun','Sun']] as const;
export type ScheduleDay=typeof SCHEDULE_DAYS[number][0];
export type ShiftHours={start:string;end:string};
export type OpeningSchedule={days:Partial<Record<ScheduleDay,ShiftHours>>;liveIn:boolean};

const TIME=/^([01]\d|2[0-3]):([0-5]\d)$/;
const minutes=(t:string)=>{const m=TIME.exec(t);return m?Number(m[1])*60+Number(m[2]):null};

/** Reads stored or submitted schedule JSON, keeping only valid days with a real start and end. */
export function parseOpeningSchedule(value:unknown):OpeningSchedule{
  let raw:any=value;
  if(typeof value==='string'){try{raw=JSON.parse(value.slice(0,4000)||'null')}catch{raw=null}}
  const days:OpeningSchedule['days']={};
  for(const [d] of SCHEDULE_DAYS){
    const h=raw?.days?.[d];
    const start=typeof h?.start==='string'?h.start:'',end=typeof h?.end==='string'?h.end:'';
    if(minutes(start)!==null&&minutes(end)!==null&&start!==end)days[d]={start,end};
  }
  return {days,liveIn:raw?.liveIn===true};
}

export const hasSchedule=(s:OpeningSchedule)=>s.liveIn||Object.keys(s.days).length>0;

/** Start and end in minutes from that day's midnight; a shift ending at or before it starts runs past midnight. */
function span(h:ShiftHours):[number,number]{
  const a=minutes(h.start)!,b=minutes(h.end)!;
  return [a,b<=a?b+1440:b];
}

export const shiftHours=(h:ShiftHours)=>{const [a,b]=span(h);return (b-a)/60};
export const weeklyHours=(s:OpeningSchedule)=>Math.round(Object.values(s.days).reduce((n,h)=>n+shiftHours(h!),0)*10)/10;

/** "7am", "3:30pm", "12am". */
export function timeLabel(t:string){
  const m=minutes(t);if(m===null)return t;
  const h=Math.floor(m/60),mm=m%60,h12=h%12||12;
  return h12+(mm?':'+String(mm).padStart(2,'0'):'')+(h<12?'am':'pm');
}
const hoursLabel=(h:ShiftHours)=>timeLabel(h.start)+'–'+timeLabel(h.end);

/** Plain-words schedule that groups neighboring days with the same hours: "Mon–Fri 7am–3pm · Sat 7am–7pm". */
export function scheduleSummary(s:OpeningSchedule){
  const groups:{from:number;to:number;hours:string}[]=[];
  SCHEDULE_DAYS.forEach(([d],i)=>{
    const h=s.days[d];if(!h)return;
    const hours=hoursLabel(h),last=groups[groups.length-1];
    if(last&&last.hours===hours&&last.to===i-1)last.to=i;else groups.push({from:i,to:i,hours});
  });
  const parts=groups.map(g=>{
    const from=SCHEDULE_DAYS[g.from][1],to=SCHEDULE_DAYS[g.to][1];
    return (g.from===g.to?from:g.to===g.from+1?from+', '+to:from+'–'+to)+' '+g.hours;
  });
  if(s.liveIn)parts.push('Live-in');
  return parts.join(' · ');
}

// The caregiver availability grid's blocks (src/CaregiverProfile.tsx), in minutes from that day's midnight.
const BLOCK_SPANS:Record<string,[number,number]>={morning:[420,900],afternoon:[660,1140],evening:[900,1380],overnight:[1380,1860]};

/** How much of one shift the caregiver's blocks for that day cover, from 0 to 1. */
function dayCoverage(h:ShiftHours,blocks:string[]){
  const [a,b]=span(h);
  const ranges=blocks.map(x=>BLOCK_SPANS[x]).filter(Boolean).sort((x,y)=>x[0]-y[0]);
  let covered=0,cursor=a;
  for(const [s,e] of ranges){
    const from=Math.max(s,cursor),to=Math.min(e,b);
    if(to>from){covered+=to-from;cursor=to}
  }
  return covered/(b-a);
}

/**
 * Compares an opening's schedule with a caregiver's availability grid (caregivers.availability_json).
 * A shift counts as workable when the caregiver's blocks that day cover at least 80% of it.
 * Returns null when either side has nothing to compare.
 */
export function scheduleFit(schedule:OpeningSchedule,availabilityJson:unknown){
  let raw:any=null;
  try{raw=typeof availabilityJson==='string'?JSON.parse(availabilityJson||'null'):availabilityJson}catch{raw=null}
  const caregiverDays:Record<string,string[]>={};
  for(const [d] of SCHEDULE_DAYS)caregiverDays[d]=Array.isArray(raw?.days?.[d])?raw.days[d].filter((x:unknown)=>typeof x==='string'):[];
  const caregiverLiveIn=raw?.liveIn===true;
  const hasGrid=caregiverLiveIn||Object.values(caregiverDays).some(b=>b.length>0);
  const shifts=Object.entries(schedule.days) as [ScheduleDay,ShiftHours][];
  if(!hasGrid||(!shifts.length&&!schedule.liveIn))return null;
  if(schedule.liveIn)return {shifts:1,workable:caregiverLiveIn?1:0};
  return {shifts:shifts.length,workable:shifts.filter(([d,h])=>dayCoverage(h,caregiverDays[d])>=0.8).length};
}
