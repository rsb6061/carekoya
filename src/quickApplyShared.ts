// The three-step Apply with CareJoys (no account, no resume) and what it leaves for the agency: a grade with a one-line
// reason, and interview times the applicant can book on the spot. Pure, so the Worker, the browser and the tests share it.

export const ROLE_OPTIONS=['CNA','GNA','HHA','PCA','Caregiver','Other'] as const;

export const WORK_TYPE_OPTIONS=[['full_time','Full-time'],['part_time','Part-time'],['either','Either']] as const;
export type WorkType=typeof WORK_TYPE_OPTIONS[number][0];

/** Shift choices, stored as the plain words employers already read in shift_preferences. */
export const SHIFT_OPTIONS=[['days','Days'],['evenings','Evenings'],['overnights','Overnights'],['weekends','Weekends'],['live_in','Live-in']] as const;
export type ShiftKey=typeof SHIFT_OPTIONS[number][0];

export const EXPERIENCE_OPTIONS=[
  ['new','I’m new to caregiving and ready to start'],
  ['family','I’ve cared for family or friends'],
  ['agency','I’ve worked for a home care agency'],
  ['facility','I’ve worked in a facility or hospital']
] as const;
export type ExperienceKey=typeof EXPERIENCE_OPTIONS[number][0];

export const TRANSPORT_OPTIONS=[['own_car','My own car'],['public_transit','Public transit'],['other','A ride or other']] as const;

/** Ways a caregiver can say when a call suits them, when the agency hasn't set interview times. */
export const CALL_TIME_OPTIONS=[['weekday_mornings','Weekday mornings'],['weekday_afternoons','Weekday afternoons'],['weekday_evenings','Weekday evenings'],['saturday','Saturday']] as const;

export const INTERVIEW_FORMATS=[['phone','Phone call'],['video','Video call'],['in_person','In person']] as const;
export type InterviewFormat=typeof INTERVIEW_FORMATS[number][0];

const pick=<T extends readonly (readonly [string,string])[]>(options:T,v:unknown)=>options.some(([k])=>k===v)?v as T[number][0]:null;
const pickMany=<T extends readonly (readonly [string,string])[]>(options:T,v:unknown)=>
  [...new Set(Array.isArray(v)?v.filter(x=>options.some(([k])=>k===x)):[])] as T[number][0][];
export const labelOf=(options:readonly (readonly [string,string])[],key:string)=>options.find(([k])=>k===key)?.[1]||key;

export type QuickAnswers={workType:WorkType|null;shifts:ShiftKey[];experience:ExperienceKey[];transportation:string|null;callTimes:string[]};
export function cleanQuickAnswers(input:unknown):QuickAnswers{
  const raw=(input&&typeof input==='object'?input:{}) as Record<string,unknown>;
  return {workType:pick(WORK_TYPE_OPTIONS,raw.workType),shifts:pickMany(SHIFT_OPTIONS,raw.shifts),experience:pickMany(EXPERIENCE_OPTIONS,raw.experience),
    transportation:pick(TRANSPORT_OPTIONS,raw.transportation),callTimes:pickMany(CALL_TIME_OPTIONS,raw.callTimes)};
}
/** "Days, Weekends, Live-in" for shift_preferences. */
export const shiftsText=(shifts:string[])=>shifts.map(s=>labelOf(SHIFT_OPTIONS,s)).join(', ');
/** full_time / part_time list for caregivers.employment_types. */
export const employmentTypesFor=(w:WorkType|null)=>w==='either'?'full_time,part_time':w||'';

export type Grade='qualified'|'review';
export const GRADE_LABELS:Record<Grade,string>={qualified:'Qualified',review:'Review'};

/**
 * How an application lands with the agency. Qualified: no question left open on the agency's list and they live within
 * a short drive (20 miles). Anything else is Review, with what to check. Knocked-out applicants never reach the agency.
 */
export function gradeApplication(input:{miles:number|null;unanswered:number;role:string;transportation:string|null;shifts:string[];answers:{label:string;answer:string}[]}){
  const checks:string[]=[];
  if(input.miles===null)checks.push('distance unknown');
  else if(input.miles>20)checks.push(Math.round(input.miles)+' miles away');
  if(input.unanswered>0)checks.push(input.unanswered===1?'1 question unanswered':input.unanswered+' questions unanswered');
  const grade:Grade=checks.length?'review':'qualified';
  const parts=[input.role||'Caregiver',input.miles===null?'':(input.miles<1?'under 1 mi':Math.round(input.miles)+' mi'),
    input.transportation==='own_car'?'has a car':input.transportation==='public_transit'?'takes transit':'',
    input.shifts.length?shiftsText(input.shifts).toLowerCase():''].filter(Boolean);
  return {grade,reason:parts.join(' · ')+(checks.length?' — check: '+checks.join(', '):'')};
}

// ---------- Interview times an applicant books right after applying ----------

export const WEEKDAYS=['mon','tue','wed','thu','fri','sat','sun'] as const;
export type InterviewHours={days:string[];start:string;end:string;duration:number;format:InterviewFormat;location:string;timezone:string};
const hm=(v:unknown)=>typeof v==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(v)?v:null;
const minutes=(v:string)=>Number(v.slice(0,2))*60+Number(v.slice(3,5));

export function cleanInterviewHours(input:unknown):InterviewHours|null{
  const raw=(input&&typeof input==='object'?input:{}) as Record<string,unknown>;
  const days=WEEKDAYS.filter(d=>Array.isArray(raw.days)&&raw.days.includes(d));
  const start=hm(raw.start),end=hm(raw.end);
  const duration=[15,20,30,45,60].includes(Number(raw.duration))?Number(raw.duration):30;
  if(!days.length||!start||!end||minutes(end)-minutes(start)<duration)return null;
  const format=pick(INTERVIEW_FORMATS,raw.format)||'phone';
  const location=typeof raw.location==='string'?raw.location.replace(/\s+/g,' ').trim().slice(0,300):'';
  let timezone=typeof raw.timezone==='string'&&raw.timezone?raw.timezone.slice(0,60):'America/New_York';
  try{new Intl.DateTimeFormat('en-US',{timeZone:timezone})}catch{timezone='America/New_York'}
  return {days,start,end,duration,format,location,timezone};
}

/** Minutes the zone is ahead of UTC at that instant (America/New_York in winter: -300). */
function zoneOffset(at:number,timeZone:string){
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone,hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'})
    .formatToParts(new Date(at)).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));
  return (Date.UTC(parts.year,parts.month-1,parts.day,parts.hour,parts.minute,parts.second)-Math.floor(at/1000)*1000)/60000;
}
/** The UTC instant of a wall-clock time in a zone. */
function zonedInstant(y:number,m:number,d:number,minuteOfDay:number,timeZone:string){
  const guess=Date.UTC(y,m,d,0,minuteOfDay);
  const first=guess-zoneOffset(guess,timeZone)*60000;
  return guess-zoneOffset(first,timeZone)*60000;
}

/**
 * The next open interview times, as ISO strings: on the agency's days, inside its hours, at least `leadHours` from now,
 * skipping times already booked. Looks up to 14 days ahead.
 */
export function upcomingInterviewTimes(hours:InterviewHours,now:number,booked:Set<string>,count=8,leadHours=12){
  const out:string[]=[];
  const earliest=now+leadHours*3600000;
  const startMin=minutes(hours.start),endMin=minutes(hours.end);
  for(let i=0;i<15&&out.length<count;i++){
    const local=new Date(now+zoneOffset(now,hours.timezone)*60000+i*86400000);
    const y=local.getUTCFullYear(),m=local.getUTCMonth(),d=local.getUTCDate();
    const weekday=WEEKDAYS[(local.getUTCDay()+6)%7];
    if(!hours.days.includes(weekday))continue;
    for(let t=startMin;t+hours.duration<=endMin&&out.length<count;t+=hours.duration){
      const at=zonedInstant(y,m,d,t,hours.timezone);
      const iso=new Date(at).toISOString();
      if(at>=earliest&&!booked.has(iso))out.push(iso);
    }
  }
  return out;
}

/** "Tue, Nov 17, 10:30 AM" in the agency's zone. */
export function interviewTimeLabel(iso:string,timeZone:string){
  return new Date(iso).toLocaleString('en-US',{timeZone,weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
}
