import { useState } from 'react';
import { SCHEDULE_DAYS, scheduleSummary, shiftHours, weeklyHours, type OpeningSchedule, type ScheduleDay } from './schedule';

// Common shifts in home care and assisted living; picking one fills the checked days (Mon–Fri when none are).
const PRESETS=[
  {label:'Days 7am–3pm',start:'07:00',end:'15:00'},
  {label:'Evenings 3pm–11pm',start:'15:00',end:'23:00'},
  {label:'Nights 11pm–7am',start:'23:00',end:'07:00'},
  {label:'12-hr days 7am–7pm',start:'07:00',end:'19:00'},
  {label:'12-hr nights 7pm–7am',start:'19:00',end:'07:00'}
];
const WEEKDAYS:ScheduleDay[]=['mon','tue','wed','thu','fri'];

/**
 * The hours worked on each day of the week, for a new opening or one being edited. Submits as JSON in a hidden `schedule` field,
 * so it works inside any plain form.
 */
export function ScheduleEditor({name='schedule',initial}:{name?:string;initial?:OpeningSchedule|null}){
  const [days,setDays]=useState<OpeningSchedule['days']>(initial?.days||{});
  const [liveIn,setLiveIn]=useState(!!initial?.liveIn);
  const schedule:OpeningSchedule={days,liveIn};

  const setDay=(d:ScheduleDay,hours:{start:string;end:string}|null)=>setDays(prev=>{
    const next={...prev};
    if(hours)next[d]=hours;else delete next[d];
    return next;
  });
  function applyPreset(start:string,end:string){
    setLiveIn(false);
    setDays(prev=>{
      const chosen=Object.keys(prev) as ScheduleDay[];
      return Object.fromEntries((chosen.length?chosen:WEEKDAYS).map(d=>[d,{start,end}]));
    });
  }
  const total=weeklyHours(schedule);
  const summary=scheduleSummary(schedule);

  return <fieldset className="schedule-editor">
    <legend>Schedule</legend>
    <p className="schedule-help">Check the days this person works and set the hours for each. CareJoys matches them against each caregiver's weekly availability.</p>
    <div className="schedule-presets">{PRESETS.map(p=><button type="button" key={p.label} className="schedule-preset" onClick={()=>applyPreset(p.start,p.end)} disabled={liveIn}>{p.label}</button>)}</div>
    <div className="schedule-rows" role="group" aria-label="Hours for each day">
      {SCHEDULE_DAYS.map(([d,label])=>{
        const h=days[d];
        return <div className={'schedule-row'+(h?' on':'')} key={d}>
          <label className="schedule-day"><input type="checkbox" checked={!!h} disabled={liveIn} onChange={e=>setDay(d,e.target.checked?(Object.values(days)[0]||{start:'07:00',end:'15:00'}):null)}/><span>{label}</span></label>
          {h?<>
            <input type="time" step={900} aria-label={label+' start'} value={h.start} onChange={e=>e.target.value&&setDay(d,{...h,start:e.target.value})}/>
            <span className="schedule-to">to</span>
            <input type="time" step={900} aria-label={label+' end'} value={h.end} onChange={e=>e.target.value&&setDay(d,{...h,end:e.target.value})}/>
            <span className="schedule-hours">{h.start===h.end?'':shiftHours(h)+' hr'}</span>
          </>:<span className="schedule-off">Off</span>}
        </div>;
      })}
    </div>
    <label className="check-row"><input type="checkbox" checked={liveIn} onChange={e=>{setLiveIn(e.target.checked);if(e.target.checked)setDays({})}}/><span>Live-in position</span></label>
    {(summary||total>0)&&<p className="schedule-summary" role="status">{summary}{total>0&&!liveIn?' · '+total+' hr/week':''}</p>}
    <input type="hidden" name={name} value={JSON.stringify(schedule)}/>
  </fieldset>;
}
